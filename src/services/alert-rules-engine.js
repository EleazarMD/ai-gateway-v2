/**
 * Alert Rules Engine
 * Evaluates alert rules and triggers notifications
 */

class AlertRulesEngine {
  constructor(postgresWrapper, notificationService, services = {}) {
    this.db = postgresWrapper;
    this.notificationService = notificationService;
    this.anomalyService = services.anomalyService;
    this.metricsService = services.metricsService;
    this.healthService = services.healthService;
    this.websocketService = services.websocketService;
    this.rules = new Map();
    this.checkInterval = null;
    this.logger = {
      info: (...args) => console.log('[AlertRulesEngine]', ...args),
      error: (...args) => console.error('[AlertRulesEngine]', ...args),
      warn: (...args) => console.warn('[AlertRulesEngine]', ...args)
    };
  }

  async initialize() {
    this.logger.info('Initializing alert rules engine...');
    await this.loadRules();
    this.startPeriodicChecks(60); // Check every 60 seconds
    this.logger.info('Alert rules engine initialized');
  }

  /**
   * Load alert rules from database
   */
  async loadRules() {
    if (!this.db || !this.db.isConnected) {
      this.logger.warn('Database not connected, skipping rule load');
      return;
    }

    try {
      const result = await this.db.query(
        'SELECT * FROM alert_rules WHERE enabled = true ORDER BY severity DESC'
      );
      
      this.rules.clear();
      for (const rule of result.rows) {
        this.rules.set(rule.rule_id, rule);
      }
      
      this.logger.info(`Loaded ${this.rules.size} alert rules`);
    } catch (error) {
      this.logger.error('Failed to load alert rules:', error);
    }
  }

  /**
   * Start periodic rule checks
   */
  startPeriodicChecks(intervalSeconds = 60) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.logger.info(`Starting periodic checks every ${intervalSeconds} seconds`);
    
    // Run immediately
    this.checkAllRules().catch(err => 
      this.logger.error('Error in periodic check:', err)
    );

    // Then run periodically
    this.checkInterval = setInterval(() => {
      this.checkAllRules().catch(err => 
        this.logger.error('Error in periodic check:', err)
      );
    }, intervalSeconds * 1000);
  }

  /**
   * Stop periodic checks
   */
  stopPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.info('Stopped periodic checks');
    }
  }

  /**
   * Check all enabled rules
   */
  async checkAllRules() {
    if (!this.db || !this.db.isConnected) {
      return;
    }

    // Reload rules to get fresh last_triggered_at timestamps for cooldown
    await this.loadRules();

    for (const [ruleId, rule] of this.rules) {
      if (!rule.enabled) continue;

      try {
        await this.checkRule(rule);
      } catch (error) {
        this.logger.error(`Error checking rule ${ruleId}:`, error);
      }
    }
  }

  /**
   * Check a specific rule
   */
  async checkRule(rule) {
    // Check if rule is in cooldown
    if (await this.isInCooldown(rule)) {
      return;
    }

    // Evaluate rule based on type
    let triggered = false;
    let triggeredBy = null;

    switch (rule.rule_type) {
      case 'anomaly_threshold':
        ({ triggered, triggeredBy } = await this.checkAnomalyThreshold(rule));
        break;
      case 'rate_limit':
        ({ triggered, triggeredBy } = await this.checkRateLimit(rule));
        break;
      case 'health_check':
        ({ triggered, triggeredBy } = await this.checkHealthStatus(rule));
        break;
      case 'custom':
        ({ triggered, triggeredBy } = await this.checkCustomRule(rule));
        break;
      default:
        this.logger.warn(`Unknown rule type: ${rule.rule_type}`);
        return;
    }

    if (triggered) {
      await this.triggerAlert(rule, triggeredBy);
    }
  }

  /**
   * Check if rule is in cooldown period
   */
  async isInCooldown(rule) {
    if (!rule.last_triggered_at || !rule.cooldown_minutes) {
      return false;
    }

    const lastTriggered = new Date(rule.last_triggered_at);
    const cooldownMs = rule.cooldown_minutes * 60 * 1000;
    const timeSinceLastTrigger = Date.now() - lastTriggered.getTime();

    return timeSinceLastTrigger < cooldownMs;
  }

  /**
   * Check anomaly threshold rule
   */
  async checkAnomalyThreshold(rule) {
    const conditions = rule.conditions;
    const windowMinutes = conditions.window_minutes || 10;
    
    try {
      // Get anomalies from the last N minutes
      const result = await this.db.query(
        `SELECT COUNT(*) as count, severity 
         FROM security_anomalies 
         WHERE detected_at > NOW() - INTERVAL '${windowMinutes} minutes'
         ${conditions.severity ? `AND severity = $1` : ''}
         GROUP BY severity`,
        conditions.severity ? [conditions.severity] : []
      );

      const count = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
      const threshold = conditions.threshold || 5;

      if (this.evaluateOperator(count, conditions.operator, threshold)) {
        return {
          triggered: true,
          triggeredBy: {
            anomaly_count: count,
            window_minutes: windowMinutes,
            threshold: threshold,
            severity: conditions.severity || 'all'
          }
        };
      }
    } catch (error) {
      this.logger.error('Error checking anomaly threshold:', error);
    }

    return { triggered: false };
  }

  /**
   * Check rate limit rule
   */
  async checkRateLimit(rule) {
    const conditions = rule.conditions;
    const windowMinutes = conditions.window_minutes || 5;

    try {
      // Get rate limited requests from audit log
      const result = await this.db.query(
        `SELECT COUNT(*) as count 
         FROM audit_events 
         WHERE timestamp > NOW() - INTERVAL '${windowMinutes} minutes'
         AND outcome = 'denied'
         AND severity = 'warning'`
      );

      const count = parseInt(result.rows[0]?.count || 0);
      const threshold = conditions.threshold || 100;

      if (this.evaluateOperator(count, conditions.operator, threshold)) {
        // Get detailed breakdown for better diagnostics
        const breakdown = await this.db.query(
          `SELECT resource, actor, COUNT(*) as violations
           FROM audit_events 
           WHERE timestamp > NOW() - INTERVAL '${windowMinutes} minutes'
           AND outcome = 'denied'
           AND severity = 'warning'
           GROUP BY resource, actor
           ORDER BY violations DESC
           LIMIT 5`
        );

        // Get time distribution (per minute)
        const timeDistribution = await this.db.query(
          `SELECT DATE_TRUNC('minute', timestamp) as minute, COUNT(*) as count
           FROM audit_events 
           WHERE timestamp > NOW() - INTERVAL '${windowMinutes} minutes'
           AND outcome = 'denied'
           AND severity = 'warning'
           GROUP BY minute
           ORDER BY minute DESC
           LIMIT 5`
        );

        return {
          triggered: true,
          triggeredBy: {
            rate_limited_count: count,
            window_minutes: windowMinutes,
            threshold: threshold,
            top_violators: breakdown.rows.map(r => ({
              endpoint: r.resource,
              actor: r.actor,
              violations: parseInt(r.violations)
            })),
            time_distribution: timeDistribution.rows.map(r => ({
              minute: r.minute,
              count: parseInt(r.count)
            }))
          }
        };
      }
    } catch (error) {
      this.logger.error('Error checking rate limit:', error);
    }

    return { triggered: false };
  }

  /**
   * Check health status rule
   */
  async checkHealthStatus(rule) {
    const conditions = rule.conditions;

    try {
      if (!this.healthService) {
        return { triggered: false };
      }

      const summary = await this.healthService.getHealthSummary();
      
      // Check if any component is unhealthy
      if (conditions.status === 'unhealthy') {
        const unhealthyChecks = summary.checks.filter(c => c.status === 'unhealthy');
        
        if (unhealthyChecks.length > 0) {
          return {
            triggered: true,
            triggeredBy: {
              unhealthy_components: unhealthyChecks.map(c => c.component),
              count: unhealthyChecks.length,
              details: unhealthyChecks
            }
          };
        }
      }

      // Check specific component
      if (conditions.component && conditions.component !== 'any') {
        const componentCheck = summary.checks.find(c => c.component === conditions.component);
        
        if (componentCheck && componentCheck.status === conditions.status) {
          return {
            triggered: true,
            triggeredBy: {
              component: conditions.component,
              status: componentCheck.status,
              message: componentCheck.message
            }
          };
        }
      }
    } catch (error) {
      this.logger.error('Error checking health status:', error);
    }

    return { triggered: false };
  }

  /**
   * Check custom rule
   */
  async checkCustomRule(rule) {
    const conditions = rule.conditions;

    try {
      // Security score check
      if (conditions.metric === 'security_score' && this.metricsService) {
        const metrics = await this.metricsService.getMetrics({ range: '1h' });
        const score = metrics.overview?.securityScore || 100;

        if (this.evaluateOperator(score, conditions.operator, conditions.threshold)) {
          return {
            triggered: true,
            triggeredBy: {
              metric: 'security_score',
              current_value: score,
              threshold: conditions.threshold,
              operator: conditions.operator
            }
          };
        }
      }
    } catch (error) {
      this.logger.error('Error checking custom rule:', error);
    }

    return { triggered: false };
  }

  /**
   * Evaluate operator
   */
  evaluateOperator(value, operator, threshold) {
    switch (operator) {
      case '>':
      case 'greater_than':
        return value > threshold;
      case '<':
      case 'less_than':
        return value < threshold;
      case '>=':
      case 'greater_than_or_equal':
        return value >= threshold;
      case '<=':
      case 'less_than_or_equal':
        return value <= threshold;
      case '==':
      case 'equals':
        return value === threshold;
      case '!=':
      case 'not_equals':
        return value !== threshold;
      default:
        return false;
    }
  }

  /**
   * Trigger an alert
   */
  async triggerAlert(rule, triggeredBy) {
    const alertId = `alert-${rule.rule_id}-${Date.now()}`;
    
    const alert = {
      alert_id: alertId,
      rule_id: rule.rule_id,
      severity: rule.severity,
      title: rule.name,
      message: this.formatAlertMessage(rule, triggeredBy),
      triggered_by: triggeredBy,
      metadata: {},
      status: 'triggered',
      triggered_at: new Date().toISOString()
    };

    // Store alert in database
    try {
      await this.db.query(
        `INSERT INTO alert_history 
         (alert_id, rule_id, severity, title, message, triggered_by, status, triggered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          alert.alert_id,
          alert.rule_id,
          alert.severity,
          alert.title,
          alert.message,
          JSON.stringify(alert.triggered_by),
          alert.status,
          alert.triggered_at
        ]
      );

      // Update rule last triggered time and count
      await this.db.query(
        `UPDATE alert_rules 
         SET last_triggered_at = $1, trigger_count = trigger_count + 1
         WHERE rule_id = $2`,
        [alert.triggered_at, rule.rule_id]
      );

      this.logger.info(`Alert triggered: ${rule.name} (${alertId})`);

      // Send notifications
      await this.sendNotifications(rule, alert);

      // Broadcast alert via WebSocket
      if (this.websocketService) {
        this.websocketService.broadcastAlert(alert);
      }

    } catch (error) {
      this.logger.error('Failed to store alert:', error);
    }
  }

  /**
   * Format alert message
   */
  formatAlertMessage(rule, triggeredBy) {
    let message = rule.description || rule.name;

    if (triggeredBy) {
      message += '\n\nDetails:\n';
      for (const [key, value] of Object.entries(triggeredBy)) {
        message += `- ${key}: ${JSON.stringify(value)}\n`;
      }
    }

    return message;
  }

  /**
   * Send notifications through configured channels
   */
  async sendNotifications(rule, alert) {
    const channels = rule.notification_channels || [];
    const notificationResults = [];

    for (const channelType of channels) {
      try {
        // Find channel by type
        const availableChannels = this.notificationService.getChannels();
        const channel = availableChannels.find(c => c.channel_type === channelType);

        if (channel) {
          const result = await this.notificationService.sendNotification(channel.channel_id, alert);
          notificationResults.push({
            channel: channelType,
            channel_id: channel.channel_id,
            success: result.success,
            error: result.error
          });

          this.logger.info(`Notification sent via ${channelType}: ${result.success ? 'success' : 'failed'}`);
        } else {
          this.logger.warn(`No ${channelType} channel configured`);
          notificationResults.push({
            channel: channelType,
            success: false,
            error: 'Channel not configured'
          });
        }
      } catch (error) {
        this.logger.error(`Error sending notification via ${channelType}:`, error);
        notificationResults.push({
          channel: channelType,
          success: false,
          error: error.message
        });
      }
    }

    // Update alert with notification results
    try {
      await this.db.query(
        `UPDATE alert_history 
         SET notifications_sent = $1
         WHERE alert_id = $2`,
        [JSON.stringify(notificationResults), alert.alert_id]
      );
    } catch (error) {
      this.logger.error('Failed to update notification results:', error);
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(limit = 50) {
    if (!this.db || !this.db.isConnected) {
      return [];
    }

    try {
      const result = await this.db.query(
        `SELECT * FROM alert_history 
         ORDER BY triggered_at DESC 
         LIMIT $1`,
        [limit]
      );
      
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get recent alerts:', error);
      return [];
    }
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId, acknowledgedBy) {
    if (!this.db || !this.db.isConnected) {
      return false;
    }

    try {
      await this.db.query(
        `UPDATE alert_history 
         SET status = 'acknowledged', 
             acknowledged_by = $1, 
             acknowledged_at = CURRENT_TIMESTAMP
         WHERE alert_id = $2`,
        [acknowledgedBy, alertId]
      );
      
      this.logger.info(`Alert acknowledged: ${alertId} by ${acknowledgedBy}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to acknowledge alert:', error);
      return false;
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId) {
    if (!this.db || !this.db.isConnected) {
      return false;
    }

    try {
      await this.db.query(
        `UPDATE alert_history 
         SET status = 'resolved', 
             resolved_at = CURRENT_TIMESTAMP
         WHERE alert_id = $2`,
        [alertId]
      );
      
      this.logger.info(`Alert resolved: ${alertId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to resolve alert:', error);
      return false;
    }
  }

  /**
   * Reload rules from database
   */
  async reloadRules() {
    await this.loadRules();
  }
}

module.exports = AlertRulesEngine;
