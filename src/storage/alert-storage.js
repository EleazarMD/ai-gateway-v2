const { Pool } = require('pg');

/**
 * PostgreSQL storage for alerts
 * Handles persistence and querying of alert history
 */
class AlertStorage {
  constructor(dbConfig) {
    this.pool = new Pool(dbConfig);
    this.initialized = false;
    console.log('[Alert Storage] Initializing PostgreSQL storage');
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      await this.createSchema();
      await this.createIndexes();
      this.initialized = true;
      console.log('[Alert Storage] Schema initialized successfully');
    } catch (error) {
      console.error('[Alert Storage] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Create database schema
   */
  async createSchema() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_gateway_alerts (
        id VARCHAR(255) PRIMARY KEY,
        rule_id VARCHAR(255) NOT NULL,
        rule_name VARCHAR(255) NOT NULL,
        description TEXT,
        severity VARCHAR(50) NOT NULL,
        metric VARCHAR(100) NOT NULL,
        current_value TEXT,
        threshold TEXT,
        timestamp TIMESTAMPTZ NOT NULL,
        status VARCHAR(50) NOT NULL,
        cleared_at TIMESTAMPTZ,
        acknowledged_by VARCHAR(255),
        acknowledged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    await this.pool.query(createTableQuery);
  }

  /**
   * Create indexes
   */
  async createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON ai_gateway_alerts(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_rule_id ON ai_gateway_alerts(rule_id)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_severity ON ai_gateway_alerts(severity)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_status ON ai_gateway_alerts(status)',
      'CREATE INDEX IF NOT EXISTS idx_alerts_created ON ai_gateway_alerts(created_at DESC)',
    ];
    
    for (const indexQuery of indexes) {
      await this.pool.query(indexQuery);
    }
  }

  /**
   * Save alert
   */
  async saveAlert(alert) {
    const query = `
      INSERT INTO ai_gateway_alerts (
        id, rule_id, rule_name, description, severity, metric,
        current_value, threshold, timestamp, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        cleared_at = EXCLUDED.cleared_at,
        acknowledged_by = EXCLUDED.acknowledged_by,
        acknowledged_at = EXCLUDED.acknowledged_at
    `;
    
    const values = [
      alert.id,
      alert.ruleId,
      alert.ruleName,
      alert.description,
      alert.severity,
      alert.metric,
      String(alert.currentValue),
      String(alert.threshold),
      alert.timestamp,
      alert.status,
    ];
    
    await this.pool.query(query, values);
  }

  /**
   * Update alert
   */
  async updateAlert(alertId, updates) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;
    
    if (updates.status) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    
    if (updates.clearedAt) {
      setClauses.push(`cleared_at = $${paramIndex++}`);
      values.push(updates.clearedAt);
    }
    
    if (updates.acknowledgedBy) {
      setClauses.push(`acknowledged_by = $${paramIndex++}`);
      values.push(updates.acknowledgedBy);
    }
    
    if (updates.acknowledgedAt) {
      setClauses.push(`acknowledged_at = $${paramIndex++}`);
      values.push(updates.acknowledgedAt);
    }
    
    if (setClauses.length === 0) return;
    
    values.push(alertId);
    const query = `UPDATE ai_gateway_alerts SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
    
    await this.pool.query(query, values);
  }

  /**
   * Query alerts
   */
  async queryAlerts(filters = {}) {
    const {
      status,
      severity,
      ruleId,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = filters;
    
    let query = 'SELECT * FROM ai_gateway_alerts WHERE 1=1';
    const values = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }
    
    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      values.push(severity);
    }
    
    if (ruleId) {
      query += ` AND rule_id = $${paramIndex++}`;
      values.push(ruleId);
    }
    
    if (startDate) {
      query += ` AND timestamp >= $${paramIndex++}`;
      values.push(startDate);
    }
    
    if (endDate) {
      query += ` AND timestamp <= $${paramIndex++}`;
      values.push(endDate);
    }
    
    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(limit, offset);
    
    const result = await this.pool.query(query, values);
    return result.rows;
  }

  /**
   * Get alert by ID
   */
  async getAlert(alertId) {
    const query = 'SELECT * FROM ai_gateway_alerts WHERE id = $1';
    const result = await this.pool.query(query, [alertId]);
    return result.rows[0] || null;
  }

  /**
   * Get alert statistics
   */
  async getStatistics(timeRange = '24h') {
    const interval = this.getTimeInterval(timeRange);
    
    const query = `
      SELECT
        COUNT(*) as total_alerts,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
        COUNT(*) FILTER (WHERE severity = 'warning') as warning_count,
        COUNT(*) FILTER (WHERE severity = 'info') as info_count,
        COUNT(*) FILTER (WHERE status = 'active') as active_count,
        COUNT(*) FILTER (WHERE status = 'cleared') as cleared_count
      FROM ai_gateway_alerts
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
    `;
    
    const result = await this.pool.query(query);
    return result.rows[0];
  }

  /**
   * Delete old alerts
   */
  async deleteAlertsBefore(cutoffDate) {
    const query = 'DELETE FROM ai_gateway_alerts WHERE timestamp < $1';
    const result = await this.pool.query(query, [cutoffDate]);
    return result.rowCount;
  }

  /**
   * Helper: Get time interval
   */
  getTimeInterval(timeRange) {
    const map = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    return map[timeRange] || '24 hours';
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = AlertStorage;
