/**
 * Enhanced Configuration Service Unit Tests
 * Tests the 4-tier hybrid storage architecture and fault tolerance
 */

const EnhancedConfigService = require('../src/storage/enhanced-config-service');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('ioredis');
jest.mock('axios');
jest.mock('../src/storage/postgres-wrapper');

describe('EnhancedConfigService', () => {
  let configService;
  let mockRedis;
  let mockPostgres;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock Redis
    mockRedis = {
      ping: jest.fn().mockResolvedValue('PONG'),
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      publish: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn().mockResolvedValue('OK'),
      status: 'ready'
    };
    Redis.mockImplementation(() => mockRedis);

    // Mock PostgreSQL
    const PostgreSQLWrapper = require('../src/storage/postgres-wrapper');
    mockPostgres = {
      connect: jest.fn().mockResolvedValue(true),
      exec: jest.fn().mockResolvedValue(),
      query: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(),
      isConnected: true
    };
    PostgreSQLWrapper.mockImplementation(() => mockPostgres);

    // Create service instance
    configService = new EnhancedConfigService({
      dashboardUrl: 'http://test-dashboard:8404',
      syncInterval: 1000,
      enabled: true
    });
  });

  afterEach(async () => {
    if (configService) {
      await configService.stop();
    }
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(configService.dashboardUrl).toBe('http://test-dashboard:8404');
      expect(configService.syncInterval).toBe(1000);
      expect(configService.enabled).toBe(true);
    });

    test('should initialize PostgreSQL storage', async () => {
      await configService.initializePostgreSQL();
      
      expect(mockPostgres.connect).toHaveBeenCalled();
      expect(mockPostgres.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
    });

    test('should initialize Redis storage', async () => {
      await configService.initializeRedis();
      
      expect(Redis).toHaveBeenCalledWith(expect.objectContaining({
        host: 'redis-service',
        port: 6379
      }));
      expect(mockRedis.ping).toHaveBeenCalled();
      expect(mockRedis.subscribe).toHaveBeenCalledWith('ai-gateway:config:updates');
    });

    test('should handle Redis initialization failure gracefully', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Redis connection failed'));
      
      await configService.initializeRedis();
      
      expect(configService.storage.redis).toBeNull();
    });
  });

  describe('Configuration Loading Strategy', () => {
    test('should load configuration from PostgreSQL (primary)', async () => {
      const dbConfig = {
        providers: [{ id: 'pg_provider', name: 'PG Provider', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' }],
        defaultProvider: 'pg_provider',
        version: '1.0.0'
      };

      mockPostgres.query.mockResolvedValueOnce({ rows: [{ config_data: JSON.stringify(dbConfig) }] });

      await configService.initializePostgreSQL();
      const config = await configService.loadConfigurationDatabaseFirst();

      expect(config.defaultProvider).toBe('pg_provider');
      expect(mockPostgres.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT config_data FROM provider_configs')
      );
    });

    test('should load from dashboard when database has no active config', async () => {
      const dashConfig = {
        providers: [{ id: 'dash_provider', name: 'Dash Provider', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' }],
        defaultProvider: 'dash_provider',
        version: '1.0.0'
      };

      // DB returns no rows
      mockPostgres.query.mockResolvedValueOnce({ rows: [] });

      // Mock dashboard response
      const mockAxios = require('axios');
      mockAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ status: 200, data: dashConfig })
      });

      await configService.initializePostgreSQL();
      await configService.initializeDashboardClient();
      const config = await configService.loadConfigurationDatabaseFirst();

      expect(config.defaultProvider).toBe('dash_provider');
      // persistConfig should have inserted into DB (UPDATE + INSERT)
      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE provider_configs SET is_active = false'));
      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_configs'), expect.any(Array));
    });

    test('should persist default configuration when DB empty and dashboard unavailable', async () => {
      // DB empty
      mockPostgres.query.mockResolvedValueOnce({ rows: [] });

      // Dashboard failure
      const mockAxios = require('axios');
      mockAxios.create.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Dashboard unavailable'))
      });

      await configService.initializePostgreSQL();
      await configService.initializeDashboardClient();
      const config = await configService.loadConfigurationDatabaseFirst();

      expect(config).toHaveProperty('providers');
      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_configs'), expect.any(Array));
    });
  });

  describe('Configuration Persistence', () => {
    test('should persist configuration to PostgreSQL and Redis cache', async () => {
      const testConfig = {
        providers: [{ id: 'test', name: 'Test', type: 'ollama', endpoint: 'http://localhost:11434' }],
        defaultProvider: 'test',
        version: '1.0.0'
      };

      await configService.initializePostgreSQL();
      await configService.initializeRedis();
      await configService.persistConfig(testConfig, 'test');

      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE provider_configs SET is_active = false'));
      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_configs'), expect.any(Array));
      expect(mockPostgres.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO config_history'), expect.any(Array));
      expect(mockRedis.setex).toHaveBeenCalledWith('ai-gateway:config:current', 3600, JSON.stringify(testConfig));
      expect(mockRedis.publish).toHaveBeenCalled();
    });
  });

  describe('Configuration Application', () => {
    test('should apply configuration to memory storage', async () => {
      const testConfig = {
        providers: [
          { id: 'provider1', name: 'Provider 1', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' },
          { id: 'provider2', name: 'Provider 2', type: 'openai', enabled: false, endpoint: 'https://api.openai.com/v1' }
        ],
        defaultProvider: 'provider1'
      };

      await configService.initializePostgreSQL();
      // Mock persistence queries
      mockPostgres.query
        .mockResolvedValueOnce({}) // UPDATE provider_configs
        .mockResolvedValueOnce({}) // INSERT provider_configs
        .mockResolvedValueOnce({}); // INSERT config_history
      await configService.applyConfiguration(testConfig, 'test');

      expect(configService.storage.memory.size).toBe(2);
      expect(configService.storage.memory.get('provider1')).toEqual(testConfig.providers[0]);
      expect(configService.currentConfig).toEqual(testConfig);
    });

    test('should emit configuration update event', async () => {
      const testConfig = {
        providers: [
          { id: 'evt_provider', name: 'Evt Provider', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' }
        ],
        defaultProvider: 'evt_provider'
      };
      const eventSpy = jest.fn();
      configService.on('config_updated', eventSpy);

      await configService.initializePostgreSQL();
      mockPostgres.query
        .mockResolvedValueOnce({}) // UPDATE provider_configs
        .mockResolvedValueOnce({}) // INSERT provider_configs
        .mockResolvedValueOnce({}); // INSERT config_history
      await configService.applyConfiguration(testConfig, 'test');

      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
        config: testConfig,
        source: 'test'
      }));
    });

    test('should validate configuration before applying', async () => {
      const invalidConfig = { invalid: 'config' };

      await expect(configService.applyConfiguration(invalidConfig, 'test'))
        .rejects.toThrow('Invalid configuration structure');
    });
  });

  describe('Provider Management', () => {
    beforeEach(async () => {
      const testConfig = {
        providers: [
          { id: 'provider1', name: 'Provider 1', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' },
          { id: 'provider2', name: 'Provider 2', type: 'openai', enabled: false, endpoint: 'https://api.openai.com/v1' }
        ],
        defaultProvider: 'provider1'
      };
      await configService.initializePostgreSQL();
      mockPostgres.query
        .mockResolvedValueOnce({}) // UPDATE provider_configs
        .mockResolvedValueOnce({}) // INSERT provider_configs
        .mockResolvedValueOnce({}); // INSERT config_history
      await configService.applyConfiguration(testConfig, 'test');
    });

    test('should get provider by ID', () => {
      const provider = configService.getProvider('provider1');
      expect(provider).toEqual(expect.objectContaining({
        id: 'provider1',
        name: 'Provider 1'
      }));
    });

    test('should get enabled providers only', () => {
      const enabledProviders = configService.getEnabledProviders();
      expect(enabledProviders).toHaveLength(1);
      expect(enabledProviders[0].id).toBe('provider1');
    });

    test('should get default provider', () => {
      const defaultProvider = configService.getDefaultProvider();
      expect(defaultProvider.id).toBe('provider1');
    });

    test('should fallback to first enabled provider when default not found', async () => {
      const testConfig = {
        providers: [
          { id: 'provider1', name: 'Provider 1', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' }
        ],
        defaultProvider: 'non_existent'
      };
      await configService.applyConfiguration(testConfig, 'test');

      const defaultProvider = configService.getDefaultProvider();
      expect(defaultProvider.id).toBe('provider1');
    });
  });

  describe('Health Status', () => {
    test('should return comprehensive health status', () => {
      const health = configService.getHealthStatus();

      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('providersCount');
      expect(health).toHaveProperty('storage');
      expect(health.storage).toHaveProperty('memory');
      expect(health.storage).toHaveProperty('redis');
      expect(health.storage).toHaveProperty('postgres');
      expect(health.storage).toHaveProperty('dashboard');
    });
  });

  describe('Configuration Hash Generation', () => {
    test('should generate consistent hash for same configuration', () => {
      const config1 = { providers: [{ id: 'test' }], defaultProvider: 'test' };
      const config2 = { providers: [{ id: 'test' }], defaultProvider: 'test' };

      const hash1 = configService.generateConfigHash(config1);
      const hash2 = configService.generateConfigHash(config2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    test('should generate different hash for different configurations', () => {
      const config1 = { providers: [{ id: 'test1' }], defaultProvider: 'test1' };
      const config2 = { providers: [{ id: 'test2' }], defaultProvider: 'test2' };

      const hash1 = configService.generateConfigHash(config1);
      const hash2 = configService.generateConfigHash(config2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Service Lifecycle', () => {
    test('should start service successfully', async () => {
      const mockAxios = require('axios');
      const dashConfig = {
        providers: [
          { id: 'dash_provider', name: 'Dash Provider', type: 'ollama', enabled: true, endpoint: 'http://localhost:11434' }
        ],
        defaultProvider: 'dash_provider',
        version: '1.0.0'
      };
      mockAxios.create.mockReturnValue({
        get: jest.fn().mockResolvedValue({ status: 200, data: dashConfig })
      });

      const eventSpy = jest.fn();
      configService.on('service_started', eventSpy);

      // Database connectivity check and initial config load
      mockPostgres.query
        // verifyDatabaseConnectivity SELECT 1 as test
        .mockResolvedValueOnce({ rows: [{ test: 1 }] })
        // loadConfigurationDatabaseFirst: SELECT config_data ... returns empty to force dashboard path
        .mockResolvedValueOnce({ rows: [] })
        // persistConfig UPDATE provider_configs
        .mockResolvedValueOnce({})
        // persistConfig INSERT provider_configs
        .mockResolvedValueOnce({})
        // persistConfig INSERT config_history
        .mockResolvedValueOnce({});

      await configService.start();

      expect(configService.isHealthy).toBe(true);
      expect(eventSpy).toHaveBeenCalled();

      // Cleanup to prevent open handles from timers/transports
      await configService.stop();
    });

    test('should stop service gracefully', async () => {
      const eventSpy = jest.fn();
      configService.on('service_stopped', eventSpy);
      await configService.initializePostgreSQL();
      await configService.initializeRedis();
      await configService.stop();

      expect(configService.isHealthy).toBe(false);
      expect(mockRedis.disconnect).toHaveBeenCalled();
      expect(mockPostgres.disconnect).toHaveBeenCalled();
      expect(eventSpy).toHaveBeenCalled();
    });

    test('should handle service start failure', async () => {
      mockPostgres.connect.mockRejectedValue(new Error('PostgreSQL connection failed'));

      const eventSpy = jest.fn();
      configService.on('service_error', eventSpy);

      await expect(configService.start()).rejects.toThrow();
      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('Real-time Updates', () => {
    test('should apply external configuration updates', async () => {
      const update = {
        type: 'config_update',
        config: {
          providers: [{ id: 'updated', name: 'Updated Provider', type: 'ollama', endpoint: 'http://localhost:11434' }],
          defaultProvider: 'updated'
        }
      };

      await configService.initializePostgreSQL();
      mockPostgres.query
        .mockResolvedValueOnce({}) // UPDATE provider_configs
        .mockResolvedValueOnce({}) // INSERT provider_configs
        .mockResolvedValueOnce({}); // INSERT config_history
      await configService.applyConfigUpdate(update, 'external');

      expect(configService.storage.memory.get('updated')).toBeDefined();
      expect(configService.currentConfig.defaultProvider).toBe('updated');
    });

    test('should ignore duplicate configuration updates', async () => {
      const config = {
        providers: [{ id: 'test', name: 'Test', type: 'ollama', endpoint: 'http://localhost:11434' }],
        defaultProvider: 'test'
      };
      await configService.initializePostgreSQL();
      mockPostgres.query
        .mockResolvedValueOnce({}) // UPDATE provider_configs
        .mockResolvedValueOnce({}) // INSERT provider_configs
        .mockResolvedValueOnce({}); // INSERT config_history
      await configService.applyConfiguration(config, 'initial');
      const initialVersion = configService.configVersion;

      const update = {
        type: 'config_update',
        config: config // Same configuration
      };

      await configService.applyConfigUpdate(update, 'external');

      expect(configService.configVersion).toBe(initialVersion);
    });
  });
});
