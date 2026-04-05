/**
 * Anomaly Detection Service
 * Detects and tracks security anomalies in the AI Gateway
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class AnomalyDetectionService extends EventEmitter {
  constructor(postgresWrapper) {
    super();
    this.db = postgresWrapper;
    
    // In-memory tracking for real-time detection
    this.requestCounts = new Map(); // IP -> count
    this.failedAuthAttempts = new Map(); // IP -> count
    this.rateLimitViolations = new Map(); // API key -> count
    
    // Thresholds
    this.thresholds = {
      requestsPerMinute: 100,
      failedAuthPerHour: 5,
      rateLimitViolationsPerHour: 10
    };
    
    // Cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    console.log('[AnomalyDetection] Service initialized');
    return true;
  }
  
  /**
   * Detect anomalies in request patterns
   */
  async detectRequestAnomaly(ip, endpoint, method) {
    const key = `${ip}:${Date.now() - (Date.now() % 60000)}`; // 1-minute window
    const count = (this.requestCounts.get(key) || 0) + 1;
    this.requestCounts.set(key, count);
    
    if (count > this.thresholds.requestsPerMinute) {
      await this.createAnomaly({
        type: 'rate_spike',
        severity: 'high',
        source: 'api-gateway',
        description: `Unusual request rate from IP ${ip}: ${count} requests/minute`,
        confidence: 0.90,
        affectedResources: [`${method} ${endpoint}`],
        metadata: { ip, endpoint, method, count }
      });
      
      this.emit('anomaly:detected', { type: 'rate_spike', ip, count });
      return true;
    }
    
    return false;
  }
  
  /**
   * Detect failed authentication anomalies
   */
  async detectAuthAnomaly(ip, username) {
    const key = `${ip}:${Date.now() - (Date.now() % 3600000)}`; // 1-hour window
    const count = (this.failedAuthAttempts.get(key) || 0) + 1;
    this.failedAuthAttempts.set(key, count);
    
    if (count > this.thresholds.failedAuthPerHour) {
      await this.createAnomaly({
        type: 'failed_auth',
        severity: count > 10 ? 'critical' : 'high',
        source: 'auth-service',
        description: `Multiple failed authentication attempts from IP ${ip}`,
        confidence: 0.95,
        affectedResources: ['authentication'],
        metadata: { ip, username, count }
      });
      
      this.emit('anomaly:detected', { type: 'failed_auth', ip, count });
      return true;
    }
    
    return false;
  }
  
  /**
   * Detect rate limit violations
   */
  async detectRateLimitAnomaly(apiKey, endpoint) {
    const key = `${apiKey}:${Date.now() - (Date.now() % 3600000)}`; // 1-hour window
    const count = (this.rateLimitViolations.get(key) || 0) + 1;
    this.rateLimitViolations.set(key, count);
    
    if (count > this.thresholds.rateLimitViolationsPerHour) {
      await this.createAnomaly({
        type: 'rate_limit_violation',
        severity: 'medium',
        source: 'rate-limiter',
        description: `Excessive rate limit violations for API key`,
        confidence: 0.88,
        affectedResources: [endpoint],
        metadata: { apiKey: apiKey.substring(0, 8) + '...', endpoint, count }
      });
      
      this.emit('anomaly:detected', { type: 'rate_limit_violation', apiKey, count });
      return true;
    }
    
    return false;
  }
  
  /**
   * Create a new anomaly record
   */
  async createAnomaly(data) {
    if (!this.db) {
      console.warn('[AnomalyDetection] Database not available, skipping anomaly creation');
      return null;
    }
    
    const anomalyId = `anom-${crypto.randomBytes(6).toString('hex')}`;
    
    const query = `
      INSERT INTO security_anomalies (
        anomaly_id, anomaly_type, severity, status, source, 
        description, confidence, affected_resources, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (anomaly_id) DO NOTHING
      RETURNING *
    `;
    
    const values = [
      anomalyId,
      data.type,
      data.severity,
      'active',
      data.source,
      data.description,
      data.confidence,
      JSON.stringify(data.affectedResources || []),
      JSON.stringify(data.metadata || {})
    ];
    
    try {
      const result = await this.db.query(query, values);
      console.log(`[AnomalyDetection] Created anomaly: ${anomalyId} (${data.type})`);
      return result.rows[0];
    } catch (error) {
      console.error('[AnomalyDetection] Error creating anomaly:', error.message);
      return null;
    }
  }
  
  /**
   * Get anomalies with filtering
   */
  async getAnomalies(filters = {}) {
    if (!this.db) {
      return { anomalies: [], stats: { total: 0, active: 0, resolved: 0, critical: 0 } };
    }
    
    let query = 'SELECT * FROM security_anomalies WHERE 1=1';
    const values = [];
    let paramCount = 1;
    
    if (filters.severity) {
      query += ` AND severity = $${paramCount++}`;
      values.push(filters.severity);
    }
    
    if (filters.status) {
      query += ` AND status = $${paramCount++}`;
      values.push(filters.status);
    }
    
    if (filters.type) {
      query += ` AND anomaly_type = $${paramCount++}`;
      values.push(filters.type);
    }
    
    if (filters.range) {
      const hours = this.parseTimeRange(filters.range);
      query += ` AND detected_at >= NOW() - INTERVAL '${hours} hours'`;
    }
    
    query += ' ORDER BY detected_at DESC LIMIT 100';
    
    try {
      const result = await this.db.query(query, values);
      
      // Get stats
      const statsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical
        FROM security_anomalies
      `;
      const statsResult = await this.db.query(statsQuery);
      
      return {
        anomalies: result.rows,
        stats: statsResult.rows[0]
      };
    } catch (error) {
      console.error('[AnomalyDetection] Error fetching anomalies:', error.message);
      return { anomalies: [], stats: { total: 0, active: 0, resolved: 0, critical: 0 } };
    }
  }
  
  /**
   * Update anomaly status
   */
  async updateAnomaly(anomalyId, updates) {
    if (!this.db) {
      return null;
    }
    
    const setClauses = [];
    const values = [];
    let paramCount = 1;
    
    if (updates.status) {
      setClauses.push(`status = $${paramCount++}`);
      values.push(updates.status);
      
      if (updates.status === 'resolved') {
        setClauses.push(`resolved_at = CURRENT_TIMESTAMP`);
      }
    }
    
    if (setClauses.length === 0) {
      return null;
    }
    
    values.push(anomalyId);
    const query = `
      UPDATE security_anomalies 
      SET ${setClauses.join(', ')}
      WHERE anomaly_id = $${paramCount}
      RETURNING *
    `;
    
    try {
      const result = await this.db.query(query, values);
      console.log(`[AnomalyDetection] Updated anomaly: ${anomalyId}`);
      return result.rows[0];
    } catch (error) {
      console.error('[AnomalyDetection] Error updating anomaly:', error.message);
      return null;
    }
  }
  
  /**
   * Parse time range to hours
   */
  parseTimeRange(range) {
    const ranges = {
      '1h': 1,
      '24h': 24,
      '7d': 168,
      '30d': 720
    };
    return ranges[range] || 24;
  }
  
  /**
   * Cleanup old tracking data
   */
  cleanup() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    
    // Clean up old request counts
    for (const [key] of this.requestCounts) {
      const timestamp = parseInt(key.split(':')[1]);
      if (timestamp < hourAgo) {
        this.requestCounts.delete(key);
      }
    }
    
    // Clean up old auth attempts
    for (const [key] of this.failedAuthAttempts) {
      const timestamp = parseInt(key.split(':')[1]);
      if (timestamp < hourAgo) {
        this.failedAuthAttempts.delete(key);
      }
    }
    
    // Clean up old rate limit violations
    for (const [key] of this.rateLimitViolations) {
      const timestamp = parseInt(key.split(':')[1]);
      if (timestamp < hourAgo) {
        this.rateLimitViolations.delete(key);
      }
    }
  }
  
  /**
   * Shutdown the service
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    console.log('[AnomalyDetection] Service shutdown');
  }
}

module.exports = AnomalyDetectionService;
