/**
 * Audit Log Service
 * Comprehensive audit logging for security events
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class AuditLogService extends EventEmitter {
  constructor(postgresWrapper) {
    super();
    this.db = postgresWrapper;
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    console.log('[AuditLog] Service initialized');
    return true;
  }
  
  /**
   * Log an audit event
   */
  async logEvent(eventData) {
    if (!this.db) {
      console.warn('[AuditLog] Database not available, skipping audit log');
      return null;
    }
    
    const eventId = `evt-${crypto.randomBytes(6).toString('hex')}`;
    
    const query = `
      INSERT INTO audit_events (
        event_id, event_type, category, severity, actor, actor_type,
        resource, action, outcome, ip_address, user_agent, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    
    const values = [
      eventId,
      eventData.eventType,
      eventData.category,
      eventData.severity || 'info',
      eventData.actor,
      eventData.actorType || 'user',
      eventData.resource,
      eventData.action,
      eventData.outcome,
      eventData.ipAddress || null,
      eventData.userAgent || null,
      JSON.stringify(eventData.details || {})
    ];
    
    try {
      const result = await this.db.query(query, values);
      this.emit('audit:logged', result.rows[0]);
      return result.rows[0];
    } catch (error) {
      console.error('[AuditLog] Error logging event:', error.message);
      return null;
    }
  }
  
  /**
   * Log authentication event
   */
  async logAuth(actor, outcome, ipAddress, details = {}) {
    return this.logEvent({
      eventType: outcome === 'success' ? 'login_success' : 'login_failure',
      category: 'authentication',
      severity: outcome === 'success' ? 'info' : 'warning',
      actor,
      actorType: 'user',
      resource: 'auth',
      action: 'login',
      outcome,
      ipAddress,
      details
    });
  }
  
  /**
   * Log API key event
   */
  async logApiKey(actor, action, outcome, keyId, details = {}) {
    return this.logEvent({
      eventType: `api_key_${action}`,
      category: 'security',
      severity: action === 'revoked' ? 'warning' : 'info',
      actor,
      actorType: 'user',
      resource: 'api_keys',
      action,
      outcome,
      details: { ...details, keyId }
    });
  }
  
  /**
   * Log configuration change
   */
  async logConfigChange(actor, resource, action, outcome, details = {}) {
    return this.logEvent({
      eventType: 'config_change',
      category: 'configuration',
      severity: 'info',
      actor,
      actorType: 'user',
      resource,
      action,
      outcome,
      details
    });
  }
  
  /**
   * Log data access
   */
  async logDataAccess(actor, resource, action, outcome, details = {}) {
    return this.logEvent({
      eventType: 'data_access',
      category: 'data_access',
      severity: outcome === 'denied' ? 'warning' : 'info',
      actor,
      actorType: 'user',
      resource,
      action,
      outcome,
      details
    });
  }
  
  /**
   * Log security event
   */
  async logSecurityEvent(eventType, severity, actor, resource, outcome, details = {}) {
    return this.logEvent({
      eventType,
      category: 'security',
      severity,
      actor,
      actorType: 'system',
      resource,
      action: 'security_check',
      outcome,
      details
    });
  }
  
  /**
   * Get audit events with filtering
   */
  async getEvents(filters = {}) {
    if (!this.db) {
      return { events: [], stats: { total: 0, success: 0, failure: 0, denied: 0 } };
    }
    
    let query = 'SELECT * FROM audit_events WHERE 1=1';
    const values = [];
    let paramCount = 1;
    
    if (filters.category) {
      query += ` AND category = $${paramCount++}`;
      values.push(filters.category);
    }
    
    if (filters.severity) {
      query += ` AND severity = $${paramCount++}`;
      values.push(filters.severity);
    }
    
    if (filters.outcome) {
      query += ` AND outcome = $${paramCount++}`;
      values.push(filters.outcome);
    }
    
    if (filters.actor) {
      query += ` AND actor ILIKE $${paramCount++}`;
      values.push(`%${filters.actor}%`);
    }
    
    if (filters.eventType) {
      query += ` AND event_type = $${paramCount++}`;
      values.push(filters.eventType);
    }
    
    if (filters.range) {
      const hours = this.parseTimeRange(filters.range);
      query += ` AND timestamp >= NOW() - INTERVAL '${hours} hours'`;
    }
    
    if (filters.search) {
      query += ` AND (
        actor ILIKE $${paramCount} OR 
        resource ILIKE $${paramCount} OR 
        event_type ILIKE $${paramCount}
      )`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }
    
    query += ' ORDER BY timestamp DESC LIMIT 1000';
    
    try {
      const result = await this.db.query(query, values);
      
      // Get stats
      const statsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE outcome = 'success') as success,
          COUNT(*) FILTER (WHERE outcome = 'failure') as failure,
          COUNT(*) FILTER (WHERE outcome = 'denied') as denied,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical,
          COUNT(*) FILTER (WHERE severity = 'warning') as warning
        FROM audit_events
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
      `;
      const statsResult = await this.db.query(statsQuery);
      
      return {
        events: result.rows,
        stats: statsResult.rows[0]
      };
    } catch (error) {
      console.error('[AuditLog] Error fetching events:', error.message);
      return { events: [], stats: { total: 0, success: 0, failure: 0, denied: 0 } };
    }
  }
  
  /**
   * Get event by ID
   */
  async getEventById(eventId) {
    if (!this.db) {
      return null;
    }
    
    const query = 'SELECT * FROM audit_events WHERE event_id = $1';
    
    try {
      const result = await this.db.query(query, [eventId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('[AuditLog] Error fetching event:', error.message);
      return null;
    }
  }
  
  /**
   * Export events to CSV
   */
  async exportEvents(filters = {}) {
    const { events } = await this.getEvents(filters);
    
    if (events.length === 0) {
      return '';
    }
    
    // CSV header
    const headers = ['Timestamp', 'Event Type', 'Category', 'Severity', 'Actor', 'Resource', 'Action', 'Outcome', 'IP Address'];
    let csv = headers.join(',') + '\n';
    
    // CSV rows
    for (const event of events) {
      const row = [
        event.timestamp,
        event.event_type,
        event.category,
        event.severity,
        event.actor,
        event.resource,
        event.action,
        event.outcome,
        event.ip_address || ''
      ];
      csv += row.map(field => `"${field}"`).join(',') + '\n';
    }
    
    return csv;
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
   * Get audit statistics
   */
  async getStats(timeRange = '24h') {
    if (!this.db) {
      return {
        total: 0,
        byCategory: {},
        bySeverity: {},
        byOutcome: {},
        topActors: [],
        recentEvents: []
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      // Overall stats
      const statsQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE category = 'authentication') as auth,
          COUNT(*) FILTER (WHERE category = 'authorization') as authz,
          COUNT(*) FILTER (WHERE category = 'security') as security,
          COUNT(*) FILTER (WHERE category = 'configuration') as config,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical,
          COUNT(*) FILTER (WHERE severity = 'error') as error,
          COUNT(*) FILTER (WHERE severity = 'warning') as warning,
          COUNT(*) FILTER (WHERE outcome = 'success') as success,
          COUNT(*) FILTER (WHERE outcome = 'failure') as failure,
          COUNT(*) FILTER (WHERE outcome = 'denied') as denied
        FROM audit_events
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
      `;
      const statsResult = await this.db.query(statsQuery);
      
      // Top actors
      const actorsQuery = `
        SELECT actor, COUNT(*) as count
        FROM audit_events
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
        GROUP BY actor
        ORDER BY count DESC
        LIMIT 10
      `;
      const actorsResult = await this.db.query(actorsQuery);
      
      return {
        total: parseInt(statsResult.rows[0].total),
        byCategory: {
          authentication: parseInt(statsResult.rows[0].auth),
          authorization: parseInt(statsResult.rows[0].authz),
          security: parseInt(statsResult.rows[0].security),
          configuration: parseInt(statsResult.rows[0].config)
        },
        bySeverity: {
          critical: parseInt(statsResult.rows[0].critical),
          error: parseInt(statsResult.rows[0].error),
          warning: parseInt(statsResult.rows[0].warning)
        },
        byOutcome: {
          success: parseInt(statsResult.rows[0].success),
          failure: parseInt(statsResult.rows[0].failure),
          denied: parseInt(statsResult.rows[0].denied)
        },
        topActors: actorsResult.rows
      };
    } catch (error) {
      console.error('[AuditLog] Error fetching stats:', error.message);
      return {
        total: 0,
        byCategory: {},
        bySeverity: {},
        byOutcome: {},
        topActors: []
      };
    }
  }
}

module.exports = AuditLogService;
