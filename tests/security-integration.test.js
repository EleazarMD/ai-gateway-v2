/**
 * Security Integration Tests
 * Tests for security services, middleware, and API endpoints
 */

const request = require('supertest');
const express = require('express');
const PostgreSQLWrapper = require('../src/storage/postgres-wrapper');
const {
  initializeSecurityServices,
  applySecurityMiddleware,
  addSecurityRoutes
} = require('../src/security-integration');

// Test configuration
const TEST_DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  database: 'ai_gateway_db',
  user: 'eleazar',
  password: ''
};

const TEST_API_KEY = 'test-api-key-12345';

describe('Security Integration Tests', () => {
  let postgresWrapper;
  let securityServices;
  let app;

  // Setup before all tests
  beforeAll(async () => {
    // Initialize PostgreSQL
    postgresWrapper = new PostgreSQLWrapper(TEST_DB_CONFIG);
    await postgresWrapper.connect(3, 1000);

    // Initialize security services
    securityServices = await initializeSecurityServices(postgresWrapper, null);

    // Create test Express app
    app = express();
    app.use(express.json());

    // Apply security middleware
    if (securityServices.auditLoggingMiddleware) {
      app.use(securityServices.auditLoggingMiddleware.middleware());
    }
    if (securityServices.anomalyDetectionMiddleware) {
      app.use(securityServices.anomalyDetectionMiddleware.middleware());
    }

    // Add test routes
    app.get('/api/v1/security/anomalies', (req, res) => 
      securityServices.securityHandler.getAnomalies(req, res)
    );
    app.get('/api/v1/security/metrics', (req, res) => 
      securityServices.securityHandler.getMetrics(req, res)
    );
    app.get('/api/v1/security/audit-log', (req, res) => 
      securityServices.securityHandler.getAuditLog(req, res)
    );
    app.get('/api/v1/security/health', (req, res) => 
      securityServices.securityHandler.getHealthStatus(req, res)
    );

    // Test endpoint for triggering events
    app.post('/api/test/trigger-event', (req, res) => {
      res.json({ success: true });
    });
  });

  // Cleanup after all tests
  afterAll(async () => {
    if (postgresWrapper) {
      await postgresWrapper.disconnect();
    }
  });

  // ==================== Service Tests ====================

  describe('Anomaly Detection Service', () => {
    test('should detect request rate anomalies', async () => {
      const { anomalyDetectionService } = securityServices;

      // Simulate multiple requests from same IP
      for (let i = 0; i < 105; i++) {
        await anomalyDetectionService.detectRequestAnomaly(
          '192.168.1.100',
          '/api/v1/chat/completions',
          'POST'
        );
      }

      // Check if anomaly was created
      const { anomalies } = await anomalyDetectionService.getAnomalies({
        type: 'rate_spike'
      });

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].anomaly_type).toBe('rate_spike');
      expect(anomalies[0].severity).toBe('high');
    });

    test('should detect failed authentication anomalies', async () => {
      const { anomalyDetectionService } = securityServices;

      // Simulate multiple failed auth attempts
      for (let i = 0; i < 6; i++) {
        await anomalyDetectionService.detectAuthAnomaly(
          '203.0.113.45',
          'attacker@example.com'
        );
      }

      // Check if anomaly was created
      const { anomalies } = await anomalyDetectionService.getAnomalies({
        type: 'failed_auth'
      });

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].anomaly_type).toBe('failed_auth');
    });

    test('should update anomaly status', async () => {
      const { anomalyDetectionService } = securityServices;

      // Get an existing anomaly
      const { anomalies } = await anomalyDetectionService.getAnomalies({
        status: 'active'
      });

      if (anomalies.length > 0) {
        const anomalyId = anomalies[0].anomaly_id;

        // Update status to resolved
        const updated = await anomalyDetectionService.updateAnomaly(anomalyId, {
          status: 'resolved'
        });

        expect(updated.status).toBe('resolved');
        expect(updated.resolved_at).toBeTruthy();
      }
    });
  });

  describe('Audit Log Service', () => {
    test('should log authentication events', async () => {
      const { auditLogService } = securityServices;

      await auditLogService.logAuth(
        'test@example.com',
        'success',
        '192.168.1.50',
        { method: 'password' }
      );

      const { events } = await auditLogService.getEvents({
        category: 'authentication',
        range: '1h'
      });

      expect(events.length).toBeGreaterThan(0);
      const authEvent = events.find(e => e.actor === 'test@example.com');
      expect(authEvent).toBeTruthy();
      expect(authEvent.outcome).toBe('success');
    });

    test('should log API key events', async () => {
      const { auditLogService } = securityServices;

      await auditLogService.logApiKey(
        'admin@example.com',
        'created',
        'success',
        'key-123',
        { name: 'Test Key' }
      );

      const { events } = await auditLogService.getEvents({
        category: 'security',
        eventType: 'api_key_created'
      });

      expect(events.length).toBeGreaterThan(0);
    });

    test('should export events to CSV', async () => {
      const { auditLogService } = securityServices;

      const csv = await auditLogService.exportEvents({
        range: '24h'
      });

      expect(csv).toContain('Timestamp');
      expect(csv).toContain('Event Type');
      expect(csv).toContain('Category');
    });

    test('should get audit statistics', async () => {
      const { auditLogService } = securityServices;

      const stats = await auditLogService.getStats('24h');

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('bySeverity');
      expect(stats).toHaveProperty('byOutcome');
    });
  });

  describe('Security Metrics Service', () => {
    test('should record metrics', async () => {
      const { securityMetricsService } = securityServices;

      await securityMetricsService.recordMetric(
        'test_metric',
        'test_category',
        100,
        'count',
        { source: 'test' }
      );

      // Metrics are flushed periodically, so we test the increment function
      securityMetricsService.increment('totalRequests', 10);
      expect(securityMetricsService.counters.totalRequests).toBe(10);
    });

    test('should get overview metrics', async () => {
      const { securityMetricsService } = securityServices;

      const metrics = await securityMetricsService.getOverviewMetrics('24h');

      expect(metrics).toHaveProperty('securityScore');
      expect(metrics).toHaveProperty('totalRequests');
      expect(metrics).toHaveProperty('blockedRequests');
      expect(metrics).toHaveProperty('approvalRate');
    });

    test('should get all metrics', async () => {
      const { securityMetricsService } = securityServices;

      const allMetrics = await securityMetricsService.getAllMetrics('24h');

      expect(allMetrics).toHaveProperty('overview');
      expect(allMetrics).toHaveProperty('authentication');
      expect(allMetrics).toHaveProperty('rateLimit');
      expect(allMetrics).toHaveProperty('contentFilter');
      expect(allMetrics).toHaveProperty('approvals');
    });
  });

  // ==================== Middleware Tests ====================

  describe('Audit Logging Middleware', () => {
    test('should log all requests', async () => {
      const { auditLogService } = securityServices;

      // Make a test request
      await request(app)
        .post('/api/test/trigger-event')
        .send({ test: 'data' })
        .expect(200);

      // Wait a bit for async logging
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if event was logged
      const { events } = await auditLogService.getEvents({
        range: '1h'
      });

      const testEvent = events.find(e => e.resource.includes('/api/test/trigger-event'));
      expect(testEvent).toBeTruthy();
    });
  });

  describe('Anomaly Detection Middleware', () => {
    test('should track request patterns', async () => {
      const { securityMetricsService } = securityServices;

      const initialCount = securityMetricsService.counters.totalRequests;

      // Make a request
      await request(app)
        .get('/api/v1/security/health')
        .expect(200);

      // Counter should increment
      expect(securityMetricsService.counters.totalRequests).toBeGreaterThan(initialCount);
    });
  });

  // ==================== API Endpoint Tests ====================

  describe('Security API Endpoints', () => {
    test('GET /api/v1/security/anomalies should return anomalies', async () => {
      const response = await request(app)
        .get('/api/v1/security/anomalies')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('anomalies');
      expect(response.body).toHaveProperty('stats');
      expect(Array.isArray(response.body.anomalies)).toBe(true);
    });

    test('GET /api/v1/security/anomalies with filters should work', async () => {
      const response = await request(app)
        .get('/api/v1/security/anomalies?severity=high&status=active')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.anomalies)).toBe(true);
    });

    test('GET /api/v1/security/metrics should return metrics', async () => {
      const response = await request(app)
        .get('/api/v1/security/metrics')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('metrics');
      expect(response.body.metrics).toHaveProperty('overview');
      expect(response.body.metrics).toHaveProperty('authentication');
    });

    test('GET /api/v1/security/audit-log should return events', async () => {
      const response = await request(app)
        .get('/api/v1/security/audit-log')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('stats');
      expect(Array.isArray(response.body.events)).toBe(true);
    });

    test('GET /api/v1/security/audit-log with filters should work', async () => {
      const response = await request(app)
        .get('/api/v1/security/audit-log?category=authentication&severity=warning')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.events)).toBe(true);
    });

    test('GET /api/v1/security/health should return health status', async () => {
      const response = await request(app)
        .get('/api/v1/security/health')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  // ==================== Database Tests ====================

  describe('Database Schema', () => {
    test('security_anomalies table should exist', async () => {
      const exists = await postgresWrapper.tableExists('security_anomalies');
      expect(exists).toBe(true);
    });

    test('audit_events table should exist', async () => {
      const exists = await postgresWrapper.tableExists('audit_events');
      expect(exists).toBe(true);
    });

    test('security_metrics table should exist', async () => {
      const exists = await postgresWrapper.tableExists('security_metrics');
      expect(exists).toBe(true);
    });

    test('api_keys table should exist with extended columns', async () => {
      const exists = await postgresWrapper.tableExists('api_keys');
      expect(exists).toBe(true);

      // Check if extended columns exist
      const result = await postgresWrapper.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'api_keys' 
        AND column_name IN ('permissions', 'rate_limit_per_minute', 'expires_at')
      `);

      expect(result.rows.length).toBe(3);
    });

    test('approval_requests table should exist', async () => {
      const exists = await postgresWrapper.tableExists('approval_requests');
      expect(exists).toBe(true);
    });

    test('security_health_checks table should exist', async () => {
      const exists = await postgresWrapper.tableExists('security_health_checks');
      expect(exists).toBe(true);
    });
  });
});

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('Running security integration tests...');
  console.log('Make sure PostgreSQL is running and the database is migrated.');
}
