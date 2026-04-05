/**
 * Security Routes
 * API endpoints for security features
 */

const express = require('express');
const { authenticateExternal, authenticateInternal } = require('../middleware/authentication');

function createSecurityRoutes(dependencies) {
  const router = express.Router();
  
  const {
    securityHandler,
    rateLimitingMiddleware,
    auditLoggingMiddleware,
    anomalyDetectionMiddleware
  } = dependencies;
  
  // Apply middleware to all routes
  if (auditLoggingMiddleware) {
    router.use(auditLoggingMiddleware.middleware());
  }
  
  if (anomalyDetectionMiddleware) {
    router.use(anomalyDetectionMiddleware.middleware());
  }
  
  // ==================== External Routes (Port 8777) ====================
  
  // Anomalies
  router.get('/api/v1/security/anomalies', 
    authenticateExternal,
    (req, res) => securityHandler.getAnomalies(req, res)
  );
  
  router.put('/api/v1/security/anomalies/:id',
    authenticateExternal,
    (req, res) => securityHandler.updateAnomaly(req, res)
  );
  
  // Metrics
  router.get('/api/v1/security/metrics',
    authenticateExternal,
    (req, res) => securityHandler.getMetrics(req, res)
  );
  
  // Audit Log
  router.get('/api/v1/security/audit-log',
    authenticateExternal,
    (req, res) => securityHandler.getAuditLog(req, res)
  );
  
  router.get('/api/v1/security/audit-log/export',
    authenticateExternal,
    (req, res) => securityHandler.exportAuditLog(req, res)
  );
  
  // Health
  router.get('/api/v1/security/health',
    authenticateExternal,
    (req, res) => securityHandler.getHealthStatus(req, res)
  );
  
  // ==================== Internal Routes (Port 7777) ====================
  
  // API Keys Management (Admin only)
  router.get('/api/v1/security/api-keys',
    authenticateInternal,
    (req, res) => securityHandler.getApiKeys(req, res)
  );
  
  router.post('/api/v1/security/api-keys',
    authenticateInternal,
    (req, res) => securityHandler.createApiKey(req, res)
  );
  
  router.put('/api/v1/security/api-keys/:id',
    authenticateInternal,
    (req, res) => securityHandler.updateApiKey(req, res)
  );
  
  router.delete('/api/v1/security/api-keys/:id',
    authenticateInternal,
    (req, res) => securityHandler.revokeApiKey(req, res)
  );
  
  // Approval Statistics (Admin only)
  router.get('/api/v1/security/approvals/stats',
    authenticateInternal,
    (req, res) => securityHandler.getApprovalStats(req, res)
  );
  
  // ==================== Alert Management Routes ====================
  
  // Alert Rules (External - Read only)
  router.get('/api/v1/security/alerts/rules',
    authenticateExternal,
    (req, res) => securityHandler.getAlertRules(req, res)
  );
  
  // Alert History (External)
  router.get('/api/v1/security/alerts/history',
    authenticateExternal,
    (req, res) => securityHandler.getAlertHistory(req, res)
  );
  
  // Acknowledge Alert (External)
  router.post('/api/v1/security/alerts/:id/acknowledge',
    authenticateExternal,
    (req, res) => securityHandler.acknowledgeAlert(req, res)
  );
  
  // Notification Channels (External - Read only)
  router.get('/api/v1/security/notifications/channels',
    authenticateExternal,
    (req, res) => securityHandler.getNotificationChannels(req, res)
  );
  
  // Test Notification Channel (Internal - Admin only)
  router.post('/api/v1/security/notifications/channels/:channelId/test',
    authenticateInternal,
    (req, res) => securityHandler.testNotificationChannel(req, res)
  );
  
  return router;
}

module.exports = createSecurityRoutes;
