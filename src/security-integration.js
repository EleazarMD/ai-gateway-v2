/**
 * Security Integration Module
 * Initializes all security services and middleware
 */

// Security Services
const AnomalyDetectionService = require('./services/anomaly-detection-service');
const AuditLogService = require('./services/audit-log-service');
const SecurityMetricsService = require('./services/security-metrics-service');
const HealthCheckService = require('./services/health-check-service');
const NotificationService = require('./services/notification-service');
const AlertRulesEngine = require('./services/alert-rules-engine');
const APIKeyService = require('./services/api-key-service');
const TenantUserService = require('./services/tenant-user-service');

// Security Handler
const SecurityHandler = require('./handlers/security-handler');

// Security Middleware
const RateLimitingMiddleware = require('./middleware/rate-limiting');
const AuditLoggingMiddleware = require('./middleware/audit-logging');
const AnomalyDetectionMiddleware = require('./middleware/anomaly-detection');

// Security Routes
const createSecurityRoutes = require('./routes/security-routes');
const { createTenantRoutes } = require('./routes/tenant-routes');

/**
 * Initialize security services
 */
async function initializeSecurityServices(postgresWrapper, redisClient = null, websocketService = null) {
  console.log('🔐 Initializing security services...');
  
  // Initialize API Key Service first
  const apiKeyService = new APIKeyService(postgresWrapper);
  await apiKeyService.initialize();
  
  // Initialize Tenant User Service
  const tenantUserService = new TenantUserService(postgresWrapper);
  console.log('✅ Tenant User Service initialized');
  
  // Initialize authentication with API Key Service
  const { initializeAuthentication } = require('./middleware/authentication');
  initializeAuthentication(apiKeyService);
  
  // Initialize services
  const anomalyDetectionService = new AnomalyDetectionService(postgresWrapper);
  await anomalyDetectionService.initialize();
  
  const auditLogService = new AuditLogService(postgresWrapper);
  await auditLogService.initialize();
  
  const securityMetricsService = new SecurityMetricsService(postgresWrapper);
  await securityMetricsService.initialize();
  
  const healthCheckService = new HealthCheckService(postgresWrapper, redisClient);
  // Start periodic health checks every 5 minutes
  healthCheckService.startPeriodicChecks(5);
  
  // Initialize notification service
  const notificationService = new NotificationService(postgresWrapper);
  await notificationService.initialize();
  
  // Initialize alert rules engine
  const alertRulesEngine = new AlertRulesEngine(
    postgresWrapper,
    notificationService,
    {
      anomalyService: anomalyDetectionService,
      metricsService: securityMetricsService,
      healthService: healthCheckService,
      websocketService: websocketService
    }
  );
  await alertRulesEngine.initialize();
  
  // Initialize handler
  const securityHandler = new SecurityHandler(
    anomalyDetectionService,
    auditLogService,
    securityMetricsService,
    postgresWrapper,
    healthCheckService,
    alertRulesEngine,
    notificationService
  );
  
  // Initialize middleware
  const rateLimitingMiddleware = new RateLimitingMiddleware(postgresWrapper, redisClient);
  await rateLimitingMiddleware.migrateSchema();
  const auditLoggingMiddleware = new AuditLoggingMiddleware(auditLogService);
  const anomalyDetectionMiddleware = new AnomalyDetectionMiddleware(
    anomalyDetectionService,
    securityMetricsService
  );
  
  console.log('✅ Security services initialized\n');
  
  return {
    apiKeyService,
    tenantUserService,
    anomalyDetectionService,
    auditLogService,
    securityMetricsService,
    healthCheckService,
    notificationService,
    alertRulesEngine,
    securityHandler,
    rateLimitingMiddleware,
    auditLoggingMiddleware,
    anomalyDetectionMiddleware
  };
}

/**
 * Apply security middleware to Express app
 */
function applySecurityMiddleware(app, securityDependencies) {
  const {
    rateLimitingMiddleware,
    auditLoggingMiddleware,
    anomalyDetectionMiddleware
  } = securityDependencies;
  
  // Apply global middleware
  if (anomalyDetectionMiddleware) {
    app.use(anomalyDetectionMiddleware.middleware());
    app.use(anomalyDetectionMiddleware.authFailureMiddleware());
  }
  
  if (auditLoggingMiddleware) {
    app.use(auditLoggingMiddleware.middleware());
  }
  
  if (rateLimitingMiddleware) {
    app.use(rateLimitingMiddleware.middleware());
  }
  
  console.log('✅ Security middleware applied');
}

/**
 * Add security routes to Express app
 */
function addSecurityRoutes(app, securityDependencies) {
  const securityRouter = createSecurityRoutes(securityDependencies);
  app.use(securityRouter);
  
  // Add tenant routes
  if (securityDependencies.tenantUserService) {
    const tenantRouter = createTenantRoutes(securityDependencies);
    app.use('/api/v1', tenantRouter);
    console.log('✅ Tenant routes added');
  }
  
  console.log('✅ Security routes added');
}

/**
 * Run database migrations
 */
async function runSecurityMigrations(postgresWrapper) {
  if (!postgresWrapper) {
    console.log('⚠️  PostgreSQL not available, skipping migrations');
    return false;
  }
  
  console.log('📊 Running security database migrations...');
  
  const fs = require('fs');
  const path = require('path');
  
  try {
    const migrationPath = path.join(__dirname, '../migrations/001_security_tables.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.log('⚠️  Migration file not found, skipping');
      return false;
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await postgresWrapper.exec(migrationSQL);
    
    console.log('✅ Security database migrations completed\n');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('⚠️  Continuing without migrations...\n');
    return false;
  }
}

module.exports = {
  initializeSecurityServices,
  applySecurityMiddleware,
  addSecurityRoutes,
  runSecurityMigrations
};
