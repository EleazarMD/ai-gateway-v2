/**
 * Security Metrics Service
 * Collects and aggregates security metrics
 */

const EventEmitter = require('events');

class SecurityMetricsService extends EventEmitter {
  constructor(postgresWrapper) {
    super();
    this.db = postgresWrapper;
    
    // In-memory counters for real-time metrics
    this.counters = {
      totalRequests: 0,
      blockedRequests: 0,
      failedLogins: 0,
      rateLimited: 0,
      contentFiltered: 0,
      approvalsPending: 0,
      approvalsApproved: 0,
      approvalsDenied: 0
    };
    
    // Flush metrics to database every minute
    this.flushInterval = setInterval(() => this.flushMetrics(), 60 * 1000);
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    console.log('[SecurityMetrics] Service initialized');
    return true;
  }
  
  /**
   * Increment a metric counter
   */
  increment(metricType, value = 1) {
    if (this.counters.hasOwnProperty(metricType)) {
      this.counters[metricType] += value;
    }
  }
  
  /**
   * Record a metric value
   */
  async recordMetric(metricType, category, value, unit = 'count', metadata = {}) {
    if (!this.db) {
      return null;
    }
    
    const query = `
      INSERT INTO security_metrics (metric_type, metric_category, metric_value, metric_unit, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const values = [metricType, category, value, unit, JSON.stringify(metadata)];
    
    try {
      const result = await this.db.query(query, values);
      return result.rows[0];
    } catch (error) {
      console.error('[SecurityMetrics] Error recording metric:', error.message);
      return null;
    }
  }
  
  /**
   * Flush in-memory counters to database
   */
  async flushMetrics() {
    if (!this.db) {
      return;
    }
    
    const timestamp = new Date();
    
    for (const [metricType, value] of Object.entries(this.counters)) {
      if (value > 0) {
        await this.recordMetric(metricType, 'overview', value, 'count', { timestamp });
      }
    }
    
    // Reset counters
    for (const key in this.counters) {
      this.counters[key] = 0;
    }
  }
  
  /**
   * Get overview metrics
   */
  async getOverviewMetrics(timeRange = '24h') {
    if (!this.db) {
      return {
        securityScore: 94,
        totalRequests: 0,
        blockedRequests: 0,
        approvalRate: 0
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      const query = `
        SELECT 
          metric_type,
          SUM(metric_value) as total_value
        FROM security_metrics
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
          AND metric_category = 'overview'
        GROUP BY metric_type
      `;
      
      const result = await this.db.query(query);
      
      const metrics = {};
      for (const row of result.rows) {
        metrics[row.metric_type] = parseFloat(row.total_value);
      }
      
      // Calculate security score
      const totalRequests = metrics.totalRequests || 0;
      const blockedRequests = metrics.blockedRequests || 0;
      const securityScore = totalRequests > 0 
        ? Math.round(((totalRequests - blockedRequests) / totalRequests) * 100)
        : 100;
      
      // Calculate approval rate
      const approvalsTotal = (metrics.approvalsApproved || 0) + (metrics.approvalsDenied || 0);
      const approvalRate = approvalsTotal > 0
        ? Math.round((metrics.approvalsApproved / approvalsTotal) * 100)
        : 0;
      
      return {
        securityScore,
        totalRequests: metrics.totalRequests || 0,
        blockedRequests: metrics.blockedRequests || 0,
        approvalRate
      };
    } catch (error) {
      console.error('[SecurityMetrics] Error fetching overview metrics:', error.message);
      return {
        securityScore: 0,
        totalRequests: 0,
        blockedRequests: 0,
        approvalRate: 0
      };
    }
  }
  
  /**
   * Get authentication metrics
   */
  async getAuthMetrics(timeRange = '24h') {
    if (!this.db) {
      return {
        totalLogins: 0,
        failedLogins: 0,
        successRate: 0
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      const query = `
        SELECT 
          COUNT(*) FILTER (WHERE event_type = 'login_success') as successful_logins,
          COUNT(*) FILTER (WHERE event_type = 'login_failure') as failed_logins
        FROM audit_events
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
          AND category = 'authentication'
      `;
      
      const result = await this.db.query(query);
      const row = result.rows[0];
      
      const successfulLogins = parseInt(row.successful_logins) || 0;
      const failedLogins = parseInt(row.failed_logins) || 0;
      const totalLogins = successfulLogins + failedLogins;
      const successRate = totalLogins > 0 
        ? Math.round((successfulLogins / totalLogins) * 100)
        : 0;
      
      return {
        totalLogins,
        successfulLogins,
        failedLogins,
        successRate
      };
    } catch (error) {
      console.error('[SecurityMetrics] Error fetching auth metrics:', error.message);
      return {
        totalLogins: 0,
        successfulLogins: 0,
        failedLogins: 0,
        successRate: 0
      };
    }
  }
  
  /**
   * Get rate limiting metrics
   */
  async getRateLimitMetrics(timeRange = '24h') {
    if (!this.db) {
      return {
        totalChecks: 0,
        rateLimited: 0,
        limitRate: 0
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      const query = `
        SELECT 
          SUM(metric_value) FILTER (WHERE metric_type = 'totalRequests') as total_checks,
          SUM(metric_value) FILTER (WHERE metric_type = 'rateLimited') as rate_limited
        FROM security_metrics
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
          AND metric_category = 'overview'
      `;
      
      const result = await this.db.query(query);
      const row = result.rows[0];
      
      const totalChecks = parseFloat(row.total_checks) || 0;
      const rateLimited = parseFloat(row.rate_limited) || 0;
      const limitRate = totalChecks > 0
        ? Math.round((rateLimited / totalChecks) * 100)
        : 0;
      
      return {
        totalChecks,
        rateLimited,
        limitRate
      };
    } catch (error) {
      console.error('[SecurityMetrics] Error fetching rate limit metrics:', error.message);
      return {
        totalChecks: 0,
        rateLimited: 0,
        limitRate: 0
      };
    }
  }
  
  /**
   * Get content filter metrics
   */
  async getContentFilterMetrics(timeRange = '24h') {
    if (!this.db) {
      return {
        totalScanned: 0,
        blocked: 0,
        blockRate: 0
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      const query = `
        SELECT 
          SUM(metric_value) FILTER (WHERE metric_type = 'totalRequests') as total_scanned,
          SUM(metric_value) FILTER (WHERE metric_type = 'contentFiltered') as blocked
        FROM security_metrics
        WHERE timestamp >= NOW() - INTERVAL '${hours} hours'
          AND metric_category = 'overview'
      `;
      
      const result = await this.db.query(query);
      const row = result.rows[0];
      
      const totalScanned = parseFloat(row.total_scanned) || 0;
      const blocked = parseFloat(row.blocked) || 0;
      const blockRate = totalScanned > 0
        ? Math.round((blocked / totalScanned) * 100)
        : 0;
      
      return {
        totalScanned,
        blocked,
        blockRate
      };
    } catch (error) {
      console.error('[SecurityMetrics] Error fetching content filter metrics:', error.message);
      return {
        totalScanned: 0,
        blocked: 0,
        blockRate: 0
      };
    }
  }
  
  /**
   * Get approval metrics
   */
  async getApprovalMetrics(timeRange = '24h') {
    if (!this.db) {
      return {
        totalRequests: 0,
        pending: 0,
        approved: 0,
        denied: 0,
        approvalRate: 0
      };
    }
    
    const hours = this.parseTimeRange(timeRange);
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'denied') as denied
        FROM approval_requests
        WHERE requested_at >= NOW() - INTERVAL '${hours} hours'
      `;
      
      const result = await this.db.query(query);
      const row = result.rows[0];
      
      const approved = parseInt(row.approved) || 0;
      const denied = parseInt(row.denied) || 0;
      const total = approved + denied;
      const approvalRate = total > 0
        ? Math.round((approved / total) * 100)
        : 0;
      
      return {
        totalRequests: parseInt(row.total) || 0,
        pending: parseInt(row.pending) || 0,
        approved,
        denied,
        approvalRate
      };
    } catch (error) {
      console.error('[SecurityMetrics] Error fetching approval metrics:', error.message);
      return {
        totalRequests: 0,
        pending: 0,
        approved: 0,
        denied: 0,
        approvalRate: 0
      };
    }
  }
  
  /**
   * Get all metrics for dashboard
   */
  async getAllMetrics(timeRange = '24h') {
    const [overview, auth, rateLimit, contentFilter, approvals] = await Promise.all([
      this.getOverviewMetrics(timeRange),
      this.getAuthMetrics(timeRange),
      this.getRateLimitMetrics(timeRange),
      this.getContentFilterMetrics(timeRange),
      this.getApprovalMetrics(timeRange)
    ]);
    
    return {
      overview,
      authentication: auth,
      rateLimit,
      contentFilter,
      approvals,
      timestamp: new Date().toISOString()
    };
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
   * Shutdown the service
   */
  shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushMetrics(); // Final flush
    }
    console.log('[SecurityMetrics] Service shutdown');
  }
}

module.exports = SecurityMetricsService;
