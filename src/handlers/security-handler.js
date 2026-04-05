/**
 * Security Handler
 * Handles all security-related API endpoints
 */

class SecurityHandler {
  constructor(anomalyDetectionService, auditLogService, securityMetricsService, postgresWrapper, healthCheckService = null, alertRulesEngine = null, notificationService = null) {
    this.anomalyService = anomalyDetectionService;
    this.auditService = auditLogService;
    this.metricsService = securityMetricsService;
    this.db = postgresWrapper;
    this.healthService = healthCheckService;
    this.alertEngine = alertRulesEngine;
    this.notificationService = notificationService;
  }
  
  /**
   * Get anomalies with filtering
   */
  async getAnomalies(req, res) {
    try {
      const filters = {
        severity: req.query.severity,
        status: req.query.status,
        type: req.query.type,
        range: req.query.range || '24h'
      };
      
      const result = await this.anomalyService.getAnomalies(filters);
      
      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching anomalies:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch anomalies',
        message: error.message
      });
    }
  }
  
  /**
   * Update anomaly status
   */
  async updateAnomaly(req, res) {
    try {
      const { id } = req.params;
      const updates = {
        status: req.body.status
      };
      
      const anomaly = await this.anomalyService.updateAnomaly(id, updates);
      
      if (!anomaly) {
        return res.status(404).json({
          success: false,
          error: 'Anomaly not found'
        });
      }
      
      // Log the update
      await this.auditService.logEvent({
        eventType: 'anomaly_updated',
        category: 'security',
        severity: 'info',
        actor: req.user?.email || 'system',
        actorType: 'user',
        resource: 'anomalies',
        action: 'update',
        outcome: 'success',
        details: { anomalyId: id, updates }
      });
      
      res.json({
        success: true,
        anomaly,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error updating anomaly:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update anomaly',
        message: error.message
      });
    }
  }
  
  /**
   * Get security metrics
   */
  async getMetrics(req, res) {
    try {
      const timeRange = req.query.range || '24h';
      const metrics = await this.metricsService.getAllMetrics(timeRange);
      
      res.json({
        success: true,
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Get audit log events
   */
  async getAuditLog(req, res) {
    try {
      const filters = {
        category: req.query.category,
        severity: req.query.severity,
        outcome: req.query.outcome,
        actor: req.query.actor,
        eventType: req.query.eventType,
        range: req.query.range || '24h',
        search: req.query.search
      };
      
      const result = await this.auditService.getEvents(filters);
      
      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching audit log:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch audit log',
        message: error.message
      });
    }
  }
  
  /**
   * Export audit log to CSV
   */
  async exportAuditLog(req, res) {
    try {
      const filters = {
        category: req.query.category,
        severity: req.query.severity,
        outcome: req.query.outcome,
        range: req.query.range || '24h'
      };
      
      const csv = await this.auditService.exportEvents(filters);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-log-${Date.now()}.csv`);
      res.send(csv);
    } catch (error) {
      console.error('[SecurityHandler] Error exporting audit log:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export audit log',
        message: error.message
      });
    }
  }
  
  /**
   * Get security health status
   */
  async getHealthStatus(req, res) {
    try {
      // If health service is available, use it for real-time checks
      if (this.healthService) {
        const summary = await this.healthService.getHealthSummary();
        return res.json({
          success: true,
          ...summary
        });
      }
      
      // Fallback to database records
      if (!this.db || !this.db.isConnected()) {
        return res.json({
          success: true,
          status: 'healthy',
          timestamp: new Date().toISOString(),
          checks: [],
          summary: { healthy: 0, degraded: 0, unhealthy: 0 }
        });
      }
      
      const query = `
        SELECT * FROM security_health_checks
        ORDER BY checked_at DESC
        LIMIT 20
      `;
      
      const result = await this.db.query(query);
      const checks = result.rows;
      
      // Calculate summary
      const summary = {
        healthy: checks.filter(c => c.status === 'healthy').length,
        degraded: checks.filter(c => c.status === 'degraded').length,
        unhealthy: checks.filter(c => c.status === 'unhealthy').length
      };
      
      // Determine overall status
      let status = 'healthy';
      if (summary.unhealthy > 0) {
        status = 'unhealthy';
      } else if (summary.degraded > 0) {
        status = 'degraded';
      }
      
      res.json({
        success: true,
        status,
        timestamp: new Date().toISOString(),
        checks,
        summary
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching health status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch health status',
        message: error.message
      });
    }
  }
  
  /**
   * Get API keys (admin only)
   */
  async getApiKeys(req, res) {
    try {
      if (!this.db) {
        return res.json({
          success: true,
          keys: [],
          stats: { total: 0, active: 0, expired: 0 }
        });
      }
      
      const query = `
        SELECT 
          id, provider_id, provider_name, is_active, created_at, 
          updated_at, last_used_at, usage_count, expires_at, 
          permissions, rate_limit_per_minute, description, scopes, tenant_id
        FROM api_keys
        ORDER BY created_at DESC
      `;
      
      const result = await this.db.query(query);
      
      // Calculate stats
      const now = new Date();
      const stats = {
        total: result.rows.length,
        active: result.rows.filter(k => k.is_active && (!k.expires_at || new Date(k.expires_at) > now)).length,
        expired: result.rows.filter(k => k.expires_at && new Date(k.expires_at) <= now).length
      };
      
      res.json({
        success: true,
        keys: result.rows,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching API keys:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch API keys',
        message: error.message
      });
    }
  }
  
  /**
   * Create API key (admin only)
   */
  async createApiKey(req, res) {
    try {
      const { name, permissions, rateLimit, expiresIn, description, scopes, tenantId } = req.body;
      
      if (!this.db) {
        return res.status(503).json({
          success: false,
          error: 'Database not available'
        });
      }
      
      // Calculate expiration
      let expiresAt = null;
      if (expiresIn) {
        const days = parseInt(expiresIn);
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
      
      const query = `
        INSERT INTO api_keys (
          provider_id, provider_name, encrypted_key, key_hash, is_active,
          permissions, rate_limit_per_minute, expires_at, description, scopes, tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, provider_id, provider_name, created_at, permissions, rate_limit_per_minute, expires_at
      `;
      
      const crypto = require('crypto');
      const apiKey = `sk-${crypto.randomBytes(32).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      const values = [
        `key-${crypto.randomBytes(6).toString('hex')}`,
        name,
        apiKey, // In production, encrypt this
        keyHash,
        true,
        JSON.stringify(permissions || ['read']),
        rateLimit || 60,
        expiresAt,
        description || '',
        JSON.stringify(scopes || ['chat', 'embeddings']),
        tenantId || null
      ];
      
      const result = await this.db.query(query, values);
      
      // Log the creation
      await this.auditService.logApiKey(
        req.user?.email || 'admin',
        'created',
        'success',
        result.rows[0].id,
        { name, permissions, rateLimit }
      );
      
      res.json({
        success: true,
        key: result.rows[0],
        apiKey, // Return the actual key only once
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error creating API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create API key',
        message: error.message
      });
    }
  }
  
  /**
   * Update API key (admin only)
   */
  async updateApiKey(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      if (!this.db) {
        return res.status(503).json({
          success: false,
          error: 'Database not available'
        });
      }
      
      const setClauses = [];
      const values = [];
      let paramCount = 1;
      
      if (updates.isActive !== undefined) {
        setClauses.push(`is_active = $${paramCount++}`);
        values.push(updates.isActive);
      }
      
      if (updates.permissions) {
        setClauses.push(`permissions = $${paramCount++}`);
        values.push(JSON.stringify(updates.permissions));
      }
      
      if (updates.rateLimit) {
        setClauses.push(`rate_limit_per_minute = $${paramCount++}`);
        values.push(updates.rateLimit);
      }
      
      if (setClauses.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid updates provided'
        });
      }
      
      values.push(id);
      const query = `
        UPDATE api_keys
        SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramCount}
        RETURNING *
      `;
      
      const result = await this.db.query(query, values);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'API key not found'
        });
      }
      
      // Log the update
      await this.auditService.logApiKey(
        req.user?.email || 'admin',
        'updated',
        'success',
        id,
        updates
      );
      
      res.json({
        success: true,
        key: result.rows[0],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error updating API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update API key',
        message: error.message
      });
    }
  }
  
  /**
   * Revoke API key (admin only)
   */
  async revokeApiKey(req, res) {
    try {
      const { id } = req.params;
      
      if (!this.db) {
        return res.status(503).json({
          success: false,
          error: 'Database not available'
        });
      }
      
      const query = `
        UPDATE api_keys
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `;
      
      const result = await this.db.query(query, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'API key not found'
        });
      }
      
      // Log the revocation
      await this.auditService.logApiKey(
        req.user?.email || 'admin',
        'revoked',
        'success',
        id
      );
      
      res.json({
        success: true,
        message: 'API key revoked successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error revoking API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke API key',
        message: error.message
      });
    }
  }
  
  /**
   * Get approval statistics
   */
  async getApprovalStats(req, res) {
    try {
      if (!this.db) {
        return res.json({
          success: true,
          stats: {
            pending: 0,
            approved: 0,
            denied: 0,
            expired: 0,
            avgResponseTime: 0,
            queueHealth: 'good'
          }
        });
      }
      
      const query = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'denied') as denied,
          COUNT(*) FILTER (WHERE status = 'expired') as expired,
          AVG(EXTRACT(EPOCH FROM (reviewed_at - requested_at))) FILTER (WHERE reviewed_at IS NOT NULL) as avg_response_time
        FROM approval_requests
        WHERE requested_at >= NOW() - INTERVAL '24 hours'
      `;
      
      const result = await this.db.query(query);
      const stats = result.rows[0];
      
      // Determine queue health
      const pending = parseInt(stats.pending) || 0;
      let queueHealth = 'good';
      if (pending > 50) {
        queueHealth = 'critical';
      } else if (pending > 20) {
        queueHealth = 'warning';
      }
      
      res.json({
        success: true,
        stats: {
          pending,
          approved: parseInt(stats.approved) || 0,
          denied: parseInt(stats.denied) || 0,
          expired: parseInt(stats.expired) || 0,
          avgResponseTime: parseFloat(stats.avg_response_time) || 0,
          queueHealth
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching approval stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch approval stats',
        message: error.message
      });
    }
  }

  /**
   * Get alert rules
   */
  async getAlertRules(req, res) {
    try {
      if (!this.db || !this.db.isConnected) {
        return res.json({ success: true, rules: [] });
      }

      const result = await this.db.query(
        'SELECT * FROM alert_rules ORDER BY severity DESC, name'
      );

      res.json({
        success: true,
        rules: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching alert rules:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alert rules',
        message: error.message
      });
    }
  }

  /**
   * Get alert history
   */
  async getAlertHistory(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const severity = req.query.severity;
      const status = req.query.status;

      if (!this.db || !this.db.isConnected) {
        return res.json({ success: true, alerts: [] });
      }

      let query = 'SELECT * FROM alert_history WHERE 1=1';
      const params = [];
      let paramCount = 1;

      if (severity) {
        query += ` AND severity = $${paramCount}`;
        params.push(severity);
        paramCount++;
      }

      if (status) {
        query += ` AND status = $${paramCount}`;
        params.push(status);
        paramCount++;
      }

      query += ` ORDER BY triggered_at DESC LIMIT $${paramCount}`;
      params.push(limit);

      const result = await this.db.query(query, params);

      res.json({
        success: true,
        alerts: result.rows,
        count: result.rows.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching alert history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch alert history',
        message: error.message
      });
    }
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(req, res) {
    try {
      const { id } = req.params;
      const { acknowledgedBy } = req.body;

      if (!this.alertEngine) {
        return res.status(503).json({
          success: false,
          error: 'Alert engine not available'
        });
      }

      const success = await this.alertEngine.acknowledgeAlert(id, acknowledgedBy || 'admin');

      if (success) {
        res.json({
          success: true,
          message: 'Alert acknowledged',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Alert not found or could not be acknowledged'
        });
      }
    } catch (error) {
      console.error('[SecurityHandler] Error acknowledging alert:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to acknowledge alert',
        message: error.message
      });
    }
  }

  /**
   * Test notification channel
   */
  async testNotificationChannel(req, res) {
    try {
      const { channelId } = req.params;

      if (!this.notificationService) {
        return res.status(503).json({
          success: false,
          error: 'Notification service not available'
        });
      }

      const result = await this.notificationService.testChannel(channelId);

      res.json({
        success: result.success,
        message: result.success ? 'Test notification sent successfully' : 'Failed to send test notification',
        error: result.error,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error testing notification channel:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to test notification channel',
        message: error.message
      });
    }
  }

  /**
   * Get notification channels
   */
  async getNotificationChannels(req, res) {
    try {
      if (!this.notificationService) {
        return res.json({ success: true, channels: [] });
      }

      const channels = this.notificationService.getChannels();

      res.json({
        success: true,
        channels: channels,
        count: channels.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[SecurityHandler] Error fetching notification channels:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch notification channels',
        message: error.message
      });
    }
  }
}

module.exports = SecurityHandler;
