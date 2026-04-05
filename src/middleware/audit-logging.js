/**
 * Audit Logging Middleware
 * Automatically logs all API requests for security auditing
 */

class AuditLoggingMiddleware {
  constructor(auditLogService) {
    this.auditService = auditLogService;
  }
  
  /**
   * Audit logging middleware function
   */
  middleware() {
    return async (req, res, next) => {
      // Capture request start time
      const startTime = Date.now();
      
      // Store original end function
      const originalEnd = res.end;
      
      // Override res.end to capture response
      res.end = async function(chunk, encoding) {
        // Restore original end
        res.end = originalEnd;
        
        // Calculate response time
        const responseTime = Date.now() - startTime;
        
        // Determine outcome based on status code
        let outcome = 'success';
        if (res.statusCode >= 400 && res.statusCode < 500) {
          outcome = 'denied';
        } else if (res.statusCode >= 500) {
          outcome = 'failure';
        }
        
        // Determine severity based on status code and path
        let severity = 'info';
        if (res.statusCode >= 500) {
          severity = 'error';
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          severity = 'warning';
        } else if (res.statusCode === 429) {
          severity = 'warning';
        }
        
        // Determine category based on path
        let category = 'system';
        if (req.path.includes('/auth') || req.path.includes('/login')) {
          category = 'authentication';
        } else if (req.path.includes('/api-keys') || req.path.includes('/security')) {
          category = 'security';
        } else if (req.path.includes('/config') || req.path.includes('/providers')) {
          category = 'configuration';
        } else if (req.path.includes('/chat') || req.path.includes('/embeddings')) {
          category = 'data_access';
        }
        
        // Extract actor information - use component name if available
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        const actor = req.user?.email || req.component || (apiKey ? `api-key-${apiKey.substring(0, 8)}` : 'anonymous');
        const actorType = req.user ? 'user' : (apiKey ? 'api' : 'system');
        
        // Log the event
        try {
          await this.auditService.logEvent({
            eventType: `${req.method.toLowerCase()}_${req.path.split('/').pop() || 'root'}`,
            category,
            severity,
            actor,
            actorType,
            resource: req.path,
            action: req.method.toLowerCase(),
            outcome,
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            details: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              responseTime,
              query: req.query,
              body: this.sanitizeBody(req.body)
            }
          });
        } catch (error) {
          console.error('[AuditLogging] Error logging event:', error.message);
        }
        
        // Call original end
        res.end(chunk, encoding);
      }.bind(this);
      
      next();
    };
  }
  
  /**
   * Sanitize request body to remove sensitive data
   */
  sanitizeBody(body) {
    if (!body || typeof body !== 'object') {
      return body;
    }
    
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'apiKey', 'api_key', 'secret', 'token', 'encrypted_key'];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}

module.exports = AuditLoggingMiddleware;
