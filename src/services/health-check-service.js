/**
 * Health Check Service
 * Monitors critical components and stores health status in database
 */

// Simple logger fallback
const logger = {
  info: (...args) => console.log('[HealthCheck]', ...args),
  error: (...args) => console.error('[HealthCheck]', ...args),
  warning: (...args) => console.warn('[HealthCheck]', ...args)
};

class HealthCheckService {
  constructor(postgresWrapper, redisClient = null) {
    this.db = postgresWrapper;
    this.redis = redisClient;
    this.checks = new Map();
    this.checkInterval = null;
    
    // Register default health checks
    this.registerDefaultChecks();
  }

  registerDefaultChecks() {
    // Database health check
    this.registerCheck('postgresql', async () => {
      if (!this.db || !this.db.isConnected) {
        return { status: 'unhealthy', message: 'PostgreSQL not connected' };
      }
      
      try {
        const startTime = Date.now();
        const result = await this.db.query('SELECT 1 as health');
        const responseTime = Date.now() - startTime;
        return {
          status: 'healthy',
          message: 'PostgreSQL operational',
          metadata: { responseTime: `${responseTime}ms` }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: `PostgreSQL error: ${error.message}`,
          metadata: { error: error.message }
        };
      }
    });

    // Redis health check
    this.registerCheck('redis', async () => {
      if (!this.redis) {
        return { status: 'degraded', message: 'Redis not configured' };
      }
      
      try {
        await this.redis.ping();
        return {
          status: 'healthy',
          message: 'Redis operational',
          metadata: {}
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          message: `Redis error: ${error.message}`,
          metadata: { error: error.message }
        };
      }
    });

    // Memory health check
    this.registerCheck('memory', async () => {
      const usage = process.memoryUsage();
      const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
      const percentUsed = Math.round((usage.heapUsed / usage.heapTotal) * 100);
      
      let status = 'healthy';
      let message = 'Memory usage normal';
      
      if (percentUsed > 90) {
        status = 'unhealthy';
        message = 'Memory usage critical';
      } else if (percentUsed > 75) {
        status = 'degraded';
        message = 'Memory usage high';
      }
      
      return {
        status,
        message,
        metadata: {
          heapUsed: `${heapUsedMB}MB`,
          heapTotal: `${heapTotalMB}MB`,
          percentUsed: `${percentUsed}%`
        }
      };
    });

    // API response time check
    this.registerCheck('api_response', async () => {
      // This is a placeholder - actual implementation would measure real response times
      const avgResponseTime = 50; // ms
      
      let status = 'healthy';
      let message = 'API response time normal';
      
      if (avgResponseTime > 1000) {
        status = 'unhealthy';
        message = 'API response time critical';
      } else if (avgResponseTime > 500) {
        status = 'degraded';
        message = 'API response time slow';
      }
      
      return {
        status,
        message,
        metadata: { avgResponseTime: `${avgResponseTime}ms` }
      };
    });
  }

  registerCheck(componentName, checkFunction) {
    this.checks.set(componentName, checkFunction);
    logger.info(`[HealthCheck] Registered check: ${componentName}`);
  }

  async runCheck(componentName) {
    const checkFn = this.checks.get(componentName);
    if (!checkFn) {
      throw new Error(`Health check not found: ${componentName}`);
    }

    const startTime = Date.now();
    try {
      const result = await checkFn();
      const responseTime = Date.now() - startTime;
      
      return {
        component: componentName,
        status: result.status,
        message: result.message,
        responseTime,
        metadata: result.metadata || {},
        checkedAt: new Date()
      };
    } catch (error) {
      logger.error(`[HealthCheck] Error checking ${componentName}:`, error);
      return {
        component: componentName,
        status: 'unhealthy',
        message: `Check failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        metadata: { error: error.message },
        checkedAt: new Date()
      };
    }
  }

  async runAllChecks() {
    const results = [];
    
    for (const [componentName] of this.checks) {
      const result = await this.runCheck(componentName);
      results.push(result);
      
      // Store in database
      if (this.db && this.db.isConnected) {
        await this.storeHealthCheck(result);
      }
    }
    
    return results;
  }

  async storeHealthCheck(checkResult) {
    try {
      const checkId = `${checkResult.component}-${Date.now()}`;
      await this.db.query(
        `INSERT INTO security_health_checks 
         (check_id, component_name, status, message, latency_ms, metadata, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          checkId,
          checkResult.component,
          checkResult.status,
          checkResult.message,
          checkResult.responseTime,
          JSON.stringify(checkResult.metadata),
          checkResult.checkedAt
        ]
      );
    } catch (error) {
      logger.error('Failed to store health check:', error);
    }
  }

  async getRecentChecks(componentName = null, limit = 100) {
    if (!this.db || !this.db.isConnected) {
      return [];
    }

    try {
      let query = `
        SELECT * FROM security_health_checks
        ${componentName ? 'WHERE component_name = $1' : ''}
        ORDER BY checked_at DESC
        LIMIT ${componentName ? '$2' : '$1'}
      `;
      
      const params = componentName ? [componentName, limit] : [limit];
      const result = await this.db.query(query, params);
      
      return result.rows;
    } catch (error) {
      logger.error('[HealthCheck] Failed to get recent checks:', error);
      return [];
    }
  }

  async getHealthSummary() {
    const checks = await this.runAllChecks();
    
    const summary = {
      overall: 'healthy',
      timestamp: new Date(),
      checks: checks,
      stats: {
        total: checks.length,
        healthy: checks.filter(c => c.status === 'healthy').length,
        degraded: checks.filter(c => c.status === 'degraded').length,
        unhealthy: checks.filter(c => c.status === 'unhealthy').length
      }
    };
    
    // Determine overall status
    if (summary.stats.unhealthy > 0) {
      summary.overall = 'unhealthy';
    } else if (summary.stats.degraded > 0) {
      summary.overall = 'degraded';
    }
    
    return summary;
  }

  startPeriodicChecks(intervalMinutes = 5) {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    logger.info(`[HealthCheck] Starting periodic checks every ${intervalMinutes} minutes`);
    
    // Run immediately
    this.runAllChecks().catch(err => 
      logger.error('[HealthCheck] Error in periodic check:', err)
    );
    
    // Then run periodically
    this.checkInterval = setInterval(() => {
      this.runAllChecks().catch(err => 
        logger.error('[HealthCheck] Error in periodic check:', err)
      );
    }, intervalMinutes * 60 * 1000);
  }

  stopPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('[HealthCheck] Stopped periodic checks');
    }
  }
}

module.exports = HealthCheckService;
