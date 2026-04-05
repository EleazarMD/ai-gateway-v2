/**
 * Express App Factory
 * Creates internal and external Express applications
 */

const express = require('express');
const cors = require('cors');
const createInternalRoutes = require('../routes/internal-routes');
const createExternalRoutes = require('../routes/external-routes');

/**
 * Create Internal Express App (Port 7777)
 * Service mesh, admin, monitoring
 */
function createInternalApp(dependencies) {
  const app = express();
  
  // CORS - restrictive for internal API
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));
  
  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  
  // Logging
  app.use((req, res, next) => {
    console.log(`[INTERNAL-7777] ${req.method} ${req.url}`);
    next();
  });
  
  // Apply security middleware (if available)
  // Rate limiting on internal port - prevents runaway internal services
  if (dependencies.rateLimitingMiddleware) {
    app.use(dependencies.rateLimitingMiddleware.middleware());
  }
  if (dependencies.anomalyDetectionMiddleware) {
    app.use(dependencies.anomalyDetectionMiddleware.middleware());
  }
  if (dependencies.auditLoggingMiddleware) {
    app.use(dependencies.auditLoggingMiddleware.middleware());
  }
  
  // Mount routes
  const routes = createInternalRoutes(dependencies);
  app.use('/', routes);
  
  return app;
}

/**
 * Create External Express App (Port 8777)
 * AI inference API - chat completions, embeddings
 */
function createExternalApp(dependencies) {
  const app = express();
  
  // CORS - permissive for external API
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Service-ID', 'X-Use-Native-Model']
  }));
  
  // Body parsing (except for routes that handle it themselves)
  app.use((req, res, next) => {
    // Skip JSON parsing for routes that handle streaming
    if (req.path.includes('/chat/completions')) {
      return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true }));
  
  // Logging
  app.use((req, res, next) => {
    console.log(`[EXTERNAL-8777] ${req.method} ${req.url}`);
    next();
  });
  
  // Apply security middleware (if available)
  if (dependencies.anomalyDetectionMiddleware) {
    app.use(dependencies.anomalyDetectionMiddleware.middleware());
    app.use(dependencies.anomalyDetectionMiddleware.authFailureMiddleware());
  }
  if (dependencies.auditLoggingMiddleware) {
    app.use(dependencies.auditLoggingMiddleware.middleware());
  }
  if (dependencies.rateLimitingMiddleware) {
    app.use(dependencies.rateLimitingMiddleware.middleware());
  }
  
  // Mount routes
  const routes = createExternalRoutes(dependencies);
  app.use('/', routes);
  
  return app;
}

module.exports = {
  createInternalApp,
  createExternalApp
};
