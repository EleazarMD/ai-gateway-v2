/**
 * Internal API Routes (Port 7777)
 * Service mesh, health checks, admin, monitoring
 */

const express = require('express');
const { authenticateInternal } = require('../middleware/authentication');
const createClientRoutes = require('./admin/clients');

function createInternalRoutes(dependencies) {
  const router = express.Router();
  const { 
    providerManager,
    apiKeyManager,
    requestTracingService, 
    costTrackingService, 
    alertService,
    mcpBridge,
    dashboardConfigService,
    clientRegistry
  } = dependencies;

  // Health check
  router.get('/health', authenticateInternal, (req, res) => {
    res.json({
      status: 'healthy',
      service: 'ai-gateway-v2',
      version: '2.5.0',
      ports: {
        internal: process.env.INTERNAL_PORT || 7777,
        external: process.env.EXTERNAL_PORT || 8777
      },
      timestamp: new Date().toISOString()
    });
  });

  // Prometheus metrics
  router.get('/metrics', authenticateInternal, (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send('# AI Gateway Metrics\n# TODO: Implement Prometheus metrics\n');
  });

  // Provider status
  router.get('/api/v1/providers/status', authenticateInternal, async (req, res) => {
    try {
      const status = await providerManager.getComprehensiveHealthStatus();
      res.json(status);
    } catch (error) {
      console.error('[Internal Routes] Provider status error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Provider configuration
  router.get('/api/v1/providers/config', authenticateInternal, async (req, res) => {
    try {
      const providers = providerManager.getActiveProviders();
      res.json({
        providers: providers,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Internal Routes] Provider config error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get provider API key (for internal services like Nova)
  router.get('/api/v1/providers/:providerId/key', authenticateInternal, async (req, res) => {
    try {
      const { providerId } = req.params;
      const apiKey = await apiKeyManager.getAPIKey(providerId);
      
      if (!apiKey) {
        return res.status(404).json({ 
          error: 'API key not found',
          providerId: providerId
        });
      }
      
      res.json({
        providerId: providerId,
        apiKey: apiKey,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Internal Routes] Provider key retrieval error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Request traces
  router.get('/api/v1/traces', authenticateInternal, async (req, res) => {
    const traces = await requestTracingService.getRecentTraces(100);
    res.json({ traces });
  });

  router.get('/api/v1/traces/:id', authenticateInternal, async (req, res) => {
    const trace = await requestTracingService.getTrace(req.params.id);
    if (!trace) {
      return res.status(404).json({ error: 'Trace not found' });
    }
    res.json(trace);
  });

  // Cost analytics
  router.get('/api/v1/costs/analytics', authenticateInternal, async (req, res) => {
    const analytics = await costTrackingService.getCostAnalytics();
    res.json(analytics);
  });

  router.get('/api/v1/costs/summary', authenticateInternal, async (req, res) => {
    const summary = await costTrackingService.getCostSummary();
    res.json(summary);
  });

  // Alerts
  router.get('/api/v1/alerts', authenticateInternal, async (req, res) => {
    const alerts = await alertService.getAlerts();
    res.json({ alerts });
  });

  router.post('/api/v1/alerts/:id/acknowledge', authenticateInternal, async (req, res) => {
    await alertService.acknowledgeAlert(req.params.id);
    res.json({ success: true });
  });

  // Admin config
  router.get('/admin/config', (req, res) => {
    res.json({
      providers: providerManager.providers || [],
      environment: process.env.NODE_ENV || 'development',
      ports: {
        internal: process.env.INTERNAL_PORT || 7777,
        external: process.env.EXTERNAL_PORT || 8777
      }
    });
  });

  router.put('/admin/providers/:providerId', authenticateInternal, async (req, res) => {
    const { providerId } = req.params;
    const config = req.body;
    
    try {
      await providerManager.updateProviderConfig(providerId, config);
      res.json({ success: true, providerId });
    } catch (error) {
      console.error('[Internal Routes] Provider update error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Service registry
  router.get('/api/services', authenticateInternal, (req, res) => {
    res.json({
      services: [],
      timestamp: new Date().toISOString()
    });
  });

  // Client registry routes
  if (clientRegistry) {
    router.use('/admin/clients', authenticateInternal, createClientRoutes(clientRegistry));
  }

  // MCP endpoint
  router.post('/api/v1/mcp', authenticateInternal, async (req, res) => {
    try {
      const result = await mcpBridge.handleRequest(req.body);
      res.json(result);
    } catch (error) {
      console.error('[Internal Routes] MCP error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Admin Security Routes ====================
  if (dependencies.securityHandler) {
    // API Keys Management
    router.get('/api/v1/security/api-keys', authenticateInternal, (req, res) => 
      dependencies.securityHandler.getApiKeys(req, res)
    );
    router.post('/api/v1/security/api-keys', authenticateInternal, (req, res) => 
      dependencies.securityHandler.createApiKey(req, res)
    );
    router.put('/api/v1/security/api-keys/:id', authenticateInternal, (req, res) => 
      dependencies.securityHandler.updateApiKey(req, res)
    );
    router.delete('/api/v1/security/api-keys/:id', authenticateInternal, (req, res) => 
      dependencies.securityHandler.revokeApiKey(req, res)
    );
    
    // Approval Statistics
    router.get('/api/v1/security/approvals/stats', authenticateInternal, (req, res) => 
      dependencies.securityHandler.getApprovalStats(req, res)
    );
  }

  // Concurrency stats (rate limiter)
  if (dependencies.rateLimitingMiddleware) {
    router.get('/api/v1/rate-limits/concurrency', authenticateInternal, (req, res) => {
      res.json({
        concurrency: dependencies.rateLimitingMiddleware.getConcurrencyStats(),
        defaults: { maxConcurrent: 8, queueTimeoutMs: 30000 },
        timestamp: new Date().toISOString()
      });
    });
  }

  // Catch-all 404
  router.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`,
      availableEndpoints: [
        'GET /health',
        'GET /metrics',
        'GET /api/v1/providers/status',
        'GET /api/v1/traces',
        'GET /api/v1/costs/analytics',
        'GET /api/v1/alerts',
        'GET /admin/clients',
        'GET /admin/clients/traffic',
        'POST /admin/clients',
        'GET /api/v1/security/api-keys',
        'POST /api/v1/security/api-keys',
        'GET /api/v1/rate-limits/concurrency'
      ]
    });
  });

  return router;
}

module.exports = createInternalRoutes;
