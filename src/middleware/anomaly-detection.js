/**
 * Anomaly Detection Middleware
 * Real-time detection of suspicious request patterns
 */

class AnomalyDetectionMiddleware {
  constructor(anomalyDetectionService, securityMetricsService) {
    this.anomalyService = anomalyDetectionService;
    this.metricsService = securityMetricsService;
  }
  
  /**
   * Anomaly detection middleware function
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Extract request information
        const ip = req.ip || req.connection.remoteAddress;
        const endpoint = req.path;
        const method = req.method;
        
        // Detect request rate anomalies
        await this.anomalyService.detectRequestAnomaly(ip, endpoint, method);
        
        // Track metrics
        if (this.metricsService) {
          this.metricsService.increment('totalRequests');
        }
        
        // Store anomaly service in request for later use
        req.anomalyService = this.anomalyService;
        
        next();
      } catch (error) {
        console.error('[AnomalyDetection] Error:', error.message);
        next(); // Don't block on errors
      }
    };
  }
  
  /**
   * Middleware for failed authentication detection
   */
  authFailureMiddleware() {
    return async (req, res, next) => {
      // Store original json function
      const originalJson = res.json;
      
      // Override res.json to detect auth failures
      res.json = async function(data) {
        // Check if this is an auth failure
        if (res.statusCode === 401 || res.statusCode === 403) {
          const ip = req.ip || req.connection.remoteAddress;
          const username = req.body?.username || req.body?.email || 'unknown';
          
          try {
            await this.anomalyService.detectAuthAnomaly(ip, username);
            
            if (this.metricsService) {
              this.metricsService.increment('failedLogins');
            }
          } catch (error) {
            console.error('[AnomalyDetection] Error detecting auth anomaly:', error.message);
          }
        }
        
        // Call original json
        originalJson.call(res, data);
      }.bind(this);
      
      next();
    };
  }
}

module.exports = AnomalyDetectionMiddleware;
