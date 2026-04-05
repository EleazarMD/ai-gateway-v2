/**
 * Enhanced Configuration Service for AI Gateway v2.0
 * Implements 4-tier hybrid storage architecture for fault-tolerant configuration management
 */

const SQLiteWrapper = require('./sqlite-wrapper');
const Redis = require('ioredis');
const EventEmitter = require('events');
const axios = require('axios');
const winston = require('winston');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');

// Configuration validation schema
const configSchema = Joi.object({
  providers: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    type: Joi.string().valid('ollama', 'openai', 'anthropic', 'perplexity', 'google', 'custom').required(),
    enabled: Joi.boolean().default(true),
    priority: Joi.number().integer().min(1).default(1),
    endpoint: Joi.string().uri().required(),
    models: Joi.array().items(Joi.string()).default([]),
    capabilities: Joi.array().items(Joi.string()).default(['chat_completion'])
  })).required(),
  defaultProvider: Joi.string().required(),
  fallbackChain: Joi.array().items(Joi.string()).default([]),
  routingRules: Joi.array().items(Joi.object()).default([]),
  version: Joi.string().default('1.0.0')
});

class EnhancedConfigService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.dashboardUrl = config.dashboardUrl || process.env.DASHBOARD_URL || 'http://localhost:8404';
    this.syncInterval = config.syncInterval || parseInt(process.env.CONFIG_SYNC_INTERVAL) || 60000;
    this.apiKey = config.apiKey || process.env.API_KEY;
    this.enabled = config.enabled !== false;
    
    // Storage configuration
    this.storageConfig = {
      sqlite: {
        path: config.sqlitePath || './config/ai-gateway-config.db'
      },
      redis: {
        host: config.redisHost || process.env.REDIS_HOST || 'unified-redis',
        port: config.redisPort || process.env.REDIS_PORT || 6379,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      }
    };
    
    // Multi-tier storage
    this.storage = {
      memory: new Map(),
      redis: null,
      sqlite: null,
      dashboard: null
    };
    
    // Current state
    this.currentConfig = null;
    this.lastSyncTime = null;
    this.syncTimer = null;
    this.isHealthy = false;
    this.configVersion = 0;
    
    // Logger setup
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './logs/config-service.log' })
      ]
    });
    
    this.logger.info('Enhanced Configuration Service initialized', {
      dashboardUrl: this.dashboardUrl,
      syncInterval: this.syncInterval
    });
  }
  
  /**
   * Initialize all storage tiers
   */
  async initialize() {
    try {
      await this.initializeSQLite();
      await this.initializeRedis();
      await this.initializeDashboardClient();
      
      this.logger.info('All storage tiers initialized successfully');
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize storage tiers', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Initialize SQLite database
   */
  async initializeSQLite() {
    try {
      this.storage.sqlite = new SQLiteWrapper(this.storageConfig.sqlite.path);
      await this.storage.sqlite.connect();
      
      // Create schema
      await this.storage.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS provider_configs (
          id TEXT PRIMARY KEY,
          config_data TEXT NOT NULL,
          version INTEGER NOT NULL,
          config_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT 1
        );
        
        CREATE TABLE IF NOT EXISTS config_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          config_hash TEXT NOT NULL,
          config_data TEXT NOT NULL,
          version INTEGER NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          source TEXT NOT NULL,
          success BOOLEAN DEFAULT 1
        );
        
        CREATE TABLE IF NOT EXISTS routing_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider_id TEXT NOT NULL,
          request_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          avg_latency REAL DEFAULT 0,
          last_used DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(provider_id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_config_history_version ON config_history(version);
        CREATE INDEX IF NOT EXISTS idx_config_history_applied_at ON config_history(applied_at);
        CREATE INDEX IF NOT EXISTS idx_routing_metrics_provider ON routing_metrics(provider_id);
      `);
      
      this.logger.info('SQLite database initialized', { 
        path: this.storageConfig.sqlite.path 
      });
    } catch (error) {
      this.logger.error('Failed to initialize SQLite', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Initialize Redis connection
   */
  async initializeRedis() {
    try {
      this.storage.redis = new Redis(this.storageConfig.redis);
      
      this.storage.redis.on('connect', () => {
        this.logger.info('Redis connected successfully');
      });
      
      this.storage.redis.on('error', (error) => {
        this.logger.warn('Redis connection error', { error: error.message });
      });
      
      // Test connection
      await this.storage.redis.ping();
      
      // Subscribe to configuration updates
      await this.storage.redis.subscribe('ai-gateway:config:updates');
      this.storage.redis.on('message', async (channel, message) => {
        if (channel === 'ai-gateway:config:updates') {
          try {
            const update = JSON.parse(message);
            await this.applyConfigUpdate(update, 'redis_pubsub');
          } catch (error) {
            this.logger.error('Failed to process Redis config update', { error: error.message });
          }
        }
      });
      
    } catch (error) {
      this.logger.warn('Redis initialization failed, continuing without Redis', { 
        error: error.message 
      });
      this.storage.redis = null;
    }
  }
  
  /**
   * Initialize dashboard HTTP client
   */
  async initializeDashboardClient() {
    this.storage.dashboard = axios.create({
      baseURL: this.dashboardUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    });
    
    this.logger.info('Dashboard client initialized', { 
      baseURL: this.dashboardUrl 
    });
  }
  
  /**
   * Start the configuration service
   */
  async start() {
    if (!this.enabled) {
      this.logger.info('Configuration service disabled, skipping start');
      return;
    }
    
    try {
      await this.initialize();
      
      // Load initial configuration using multi-tier strategy
      const config = await this.loadConfiguration();
      await this.applyConfiguration(config, 'startup');
      
      // Start periodic sync
      this.startPeriodicSync();
      
      this.isHealthy = true;
      this.emit('service_started', { timestamp: new Date().toISOString() });
      
      this.logger.info('Enhanced Configuration Service started successfully');
    } catch (error) {
      this.logger.error('Failed to start configuration service', { error: error.message });
      this.emit('service_error', { error: error.message, timestamp: new Date().toISOString() });
      throw error;
    }
  }
  
  /**
   * Multi-tier configuration loading strategy
   */
  async loadConfiguration() {
    const loadStrategies = [
      // Strategy 1: Live dashboard sync (preferred)
      async () => {
        this.logger.info('Attempting to load configuration from dashboard');
        const response = await this.storage.dashboard.get('/ai-inferencing/api/v1/providers/config');
        
        if (response.status === 200 && response.data) {
          const config = this.processConfiguration(response.data);
          await this.persistConfig(config, 'dashboard');
          this.logger.info('Configuration loaded from dashboard successfully');
          return config;
        }
        throw new Error(`Dashboard returned status: ${response.status}`);
      },
      
      // Strategy 2: Redis cache (fast fallback)
      async () => {
        if (!this.storage.redis) throw new Error('Redis not available');
        
        this.logger.info('Attempting to load configuration from Redis cache');
        const cached = await this.storage.redis.get('ai-gateway:config:current');
        if (cached) {
          const config = JSON.parse(cached);
          if (this.isConfigValid(config)) {
            this.logger.info('Configuration loaded from Redis cache');
            return config;
          }
        }
        throw new Error('Redis cache invalid or expired');
      },
      
      // Strategy 3: SQLite persistence (reliable fallback)
      async () => {
        if (!this.storage.sqlite) throw new Error('SQLite not available');
        
        this.logger.info('Attempting to load configuration from SQLite');
        const row = await this.storage.sqlite.get(`
          SELECT config_data FROM provider_configs 
          WHERE is_active = 1 
          ORDER BY updated_at DESC 
          LIMIT 1
        `);
        
        if (row) {
          const config = JSON.parse(row.config_data);
          this.logger.info('Configuration loaded from SQLite');
          return config;
        }
        throw new Error('No valid SQLite configuration found');
      },
      
      // Strategy 4: Emergency defaults (last resort)
      async () => {
        this.logger.warn('Using emergency default configuration');
        return this.getEmergencyDefaults();
      }
    ];
    
    // Try each strategy in order until one succeeds
    for (const [index, strategy] of loadStrategies.entries()) {
      try {
        const config = await strategy();
        this.recordConfigLoad(config, `strategy_${index + 1}`);
        return config;
      } catch (error) {
        this.logger.warn(`Configuration load strategy ${index + 1} failed`, { 
          error: error.message 
        });
        continue;
      }
    }
    
    throw new Error('All configuration loading strategies failed');
  }
  
  /**
   * Get emergency default configuration
   */
  getEmergencyDefaults() {
    return {
      providers: [
        {
          id: 'ollama_emergency',
          name: 'Ollama (Emergency)',
          type: 'ollama',
          enabled: true,
          priority: 1,
          endpoint: 'http://localhost:11434',
          models: ['llama3.1:8b'],
          capabilities: ['chat_completion'],
          settings: {
            temperature: 0.7,
            maxTokens: 2048
          }
        }
      ],
      defaultProvider: 'ollama_emergency',
      fallbackChain: ['ollama_emergency'],
      routingRules: [],
      globalSettings: {
        enableFallback: true,
        maxRetries: 3,
        timeout: 30000
      },
      source: 'emergency_defaults',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Process raw dashboard configuration
   */
  processConfiguration(rawConfig) {
    const processed = {
      providers: [],
      defaultProvider: null,
      fallbackChain: [],
      routingRules: [],
      globalSettings: {
        enableFallback: true,
        maxRetries: 3,
        timeout: 30000,
        enableMetrics: true
      },
      lastSync: new Date().toISOString(),
      version: rawConfig.version || '1.0.0'
    };
    
    // Process providers
    if (rawConfig.providers && Array.isArray(rawConfig.providers)) {
      processed.providers = rawConfig.providers.map(provider => ({
        id: provider.id || provider.name?.toLowerCase().replace(/\s+/g, '_'),
        name: provider.name,
        type: this.mapProviderType(provider.type),
        enabled: provider.enabled !== false,
        priority: provider.priority || 1,
        endpoint: provider.endpoint,
        models: provider.models || [],
        capabilities: provider.capabilities || ['chat_completion'],
        settings: provider.settings || {},
        lastUpdated: new Date().toISOString()
      }));
    }
    
    // Set default provider
    processed.defaultProvider = rawConfig.defaultProvider || 
      (processed.providers.find(p => p.enabled)?.id) || null;
    
    // Process fallback chain
    if (rawConfig.fallbackChain && Array.isArray(rawConfig.fallbackChain)) {
      processed.fallbackChain = rawConfig.fallbackChain.filter(id => 
        processed.providers.some(p => p.id === id && p.enabled)
      );
    }
    
    // Process routing rules
    if (rawConfig.routingRules && Array.isArray(rawConfig.routingRules)) {
      processed.routingRules = rawConfig.routingRules.map(rule => ({
        id: rule.id || `rule_${Date.now()}`,
        name: rule.name || 'Unnamed Rule',
        condition: rule.condition || {},
        targetProvider: rule.targetProvider,
        fallbackProviders: rule.fallbackProviders || [],
        enabled: rule.enabled !== false
      }));
    }
    
    return processed;
  }
  
  /**
   * Map provider types
   */
  mapProviderType(dashboardType) {
    const typeMap = {
      'ollama': 'ollama',
      'openai': 'openai',
      'anthropic': 'anthropic',
      'perplexity': 'perplexity',
      'google': 'google',
      'custom': 'custom'
    };
    
    return typeMap[dashboardType?.toLowerCase()] || 'custom';
  }
  
  /**
   * Validate configuration
   */
  isConfigValid(config) {
    try {
      const { error } = configSchema.validate(config);
      return !error;
    } catch (error) {
      this.logger.error('Configuration validation failed', { error: error.message });
      return false;
    }
  }
  
  /**
   * Get provider by ID
   */
  getProvider(providerId) {
    return this.storage.memory.get(providerId);
  }
  
  /**
   * Get all enabled providers
   */
  getEnabledProviders() {
    return Array.from(this.storage.memory.values()).filter(p => p.enabled);
  }
  
  /**
   * Get default provider
   */
  getDefaultProvider() {
    if (this.currentConfig?.defaultProvider && 
        this.storage.memory.has(this.currentConfig.defaultProvider)) {
      return this.storage.memory.get(this.currentConfig.defaultProvider);
    }
    
    // Fallback to first enabled provider
    const enabledProviders = this.getEnabledProviders();
    return enabledProviders.length > 0 ? enabledProviders[0] : null;
  }
  
  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      healthy: this.isHealthy,
      lastSync: this.lastSyncTime,
      providersCount: this.storage.memory.size,
      enabledProvidersCount: this.getEnabledProviders().length,
      defaultProvider: this.currentConfig?.defaultProvider,
      configVersion: this.configVersion,
      storage: {
        memory: this.storage.memory.size > 0,
        redis: this.storage.redis?.status === 'ready',
        sqlite: this.storage.sqlite !== null,
        dashboard: this.storage.dashboard !== null
      },
      dashboardUrl: this.dashboardUrl,
      syncInterval: this.syncInterval
    };
  }
  
  /**
   * Stop the service
   */
  async stop() {
    this.logger.info('Stopping Enhanced Configuration Service');
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.storage.redis) {
      await this.storage.redis.disconnect();
    }
    
    if (this.storage.sqlite) {
      await this.storage.sqlite.close();
    }
    
    this.isHealthy = false;
    this.emit('service_stopped', { timestamp: new Date().toISOString() });
    
    this.logger.info('Enhanced Configuration Service stopped');
  }
}

  /**
   * Persist configuration to all available storage tiers
   */
  async persistConfig(config, source) {
    const configHash = this.generateConfigHash(config);
    const timestamp = new Date().toISOString();
    
    try {
      // Persist to SQLite (durable storage)
      if (this.storage.sqlite) {
        await this.storage.sqlite.run(`
          INSERT OR REPLACE INTO provider_configs 
          (id, config_data, version, config_hash, updated_at, is_active)
          VALUES (?, ?, ?, ?, ?, 1)
        `, ['current', JSON.stringify(config), this.configVersion, configHash, timestamp]);
        
        // Add to history
        await this.storage.sqlite.run(`
          INSERT INTO config_history 
          (config_hash, config_data, version, applied_at, source, success)
          VALUES (?, ?, ?, ?, ?, 1)
        `, [configHash, JSON.stringify(config), this.configVersion, timestamp, source]);
      }
      
      // Cache in Redis (fast access)
      if (this.storage.redis) {
        await this.storage.redis.setex('ai-gateway:config:current', 3600, JSON.stringify(config));
        await this.storage.redis.publish('ai-gateway:config:updates', JSON.stringify({
          type: 'config_update',
          config,
          source,
          timestamp
        }));
      }
      
      this.logger.info('Configuration persisted successfully', { source, configHash });
    } catch (error) {
      this.logger.error('Failed to persist configuration', { error: error.message, source });
      throw error;
    }
  }
  
  /**
   * Apply configuration to memory and emit events
   */
  async applyConfiguration(config, source) {
    try {
      // Validate configuration
      if (!this.isConfigValid(config)) {
        throw new Error('Invalid configuration structure');
      }
      
      // Clear existing memory cache
      this.storage.memory.clear();
      
      // Load providers into memory
      if (config.providers && Array.isArray(config.providers)) {
        config.providers.forEach(provider => {
          this.storage.memory.set(provider.id, provider);
        });
      }
      
      // Update current configuration
      this.currentConfig = config;
      this.configVersion++;
      this.lastSyncTime = new Date().toISOString();
      
      // Persist to storage tiers
      await this.persistConfig(config, source);
      
      // Emit configuration update event
      this.emit('config_updated', {
        config,
        source,
        version: this.configVersion,
        timestamp: this.lastSyncTime,
        providersCount: this.storage.memory.size
      });
      
      this.logger.info('Configuration applied successfully', {
        source,
        providersCount: this.storage.memory.size,
        defaultProvider: config.defaultProvider,
        version: this.configVersion
      });
      
    } catch (error) {
      this.logger.error('Failed to apply configuration', { error: error.message, source });
      throw error;
    }
  }
  
  /**
   * Start periodic configuration sync
   */
  startPeriodicSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncFromDashboard();
      } catch (error) {
        this.logger.warn('Periodic sync failed', { error: error.message });
      }
    }, this.syncInterval);
    
    this.logger.info('Periodic sync started', { interval: this.syncInterval });
  }
  
  /**
   * Sync configuration from dashboard
   */
  async syncFromDashboard() {
    try {
      const response = await this.storage.dashboard.get('/ai-inferencing/api/v1/providers/config');
      
      if (response.status === 200 && response.data) {
        const newConfig = this.processConfiguration(response.data);
        const newConfigHash = this.generateConfigHash(newConfig);
        const currentConfigHash = this.currentConfig ? 
          this.generateConfigHash(this.currentConfig) : null;
        
        if (newConfigHash !== currentConfigHash) {
          await this.applyConfiguration(newConfig, 'dashboard_sync');
          this.logger.info('Configuration updated from dashboard sync');
        }
      }
    } catch (error) {
      this.logger.warn('Dashboard sync failed', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Generate configuration hash for change detection
   */
  generateConfigHash(config) {
    const crypto = require('crypto');
    const configString = JSON.stringify(config, Object.keys(config).sort());
    return crypto.createHash('sha256').update(configString).digest('hex');
  }
  
  /**
   * Record configuration load event
   */
  recordConfigLoad(config, strategy) {
    this.logger.info('Configuration loaded', {
      strategy,
      providersCount: config.providers?.length || 0,
      defaultProvider: config.defaultProvider,
      version: config.version
    });
  }
  
  /**
   * Apply configuration update from external source
   */
  async applyConfigUpdate(update, source) {
    try {
      if (update.type === 'config_update' && update.config) {
        const currentHash = this.currentConfig ? 
          this.generateConfigHash(this.currentConfig) : null;
        const updateHash = this.generateConfigHash(update.config);
        
        if (updateHash !== currentHash) {
          await this.applyConfiguration(update.config, source);
          this.logger.info('Applied external configuration update', { source });
        }
      }
    } catch (error) {
      this.logger.error('Failed to apply external config update', { 
        error: error.message, 
        source 
      });
    }
  }
}

module.exports = EnhancedConfigService;
          return config;
        }
        throw new Error('No valid SQLite configuration found');
      },
      
      // Strategy 4: Emergency defaults (last resort)
      async () => {
        this.logger.warn('Using emergency default configuration');
        return this.getEmergencyDefaults();
      }
    ];
    
    // Try each strategy in order until one succeeds
    for (const [index, strategy] of loadStrategies.entries()) {
      try {
        const config = await strategy();
        this.recordConfigLoad(config, `strategy_${index + 1}`);
        return config;
      } catch (error) {
        this.logger.warn(`Configuration load strategy ${index + 1} failed`, { 
          error: error.message 
        });
        continue;
      }
    }
    
    throw new Error('All configuration loading strategies failed');
  }
  
  /**
   * Get emergency default configuration
   */
  getEmergencyDefaults() {
    return {
      providers: [
        {
          id: 'ollama_emergency',
          name: 'Ollama (Emergency)',
          type: 'ollama',
          enabled: true,
          priority: 1,
          endpoint: 'http://localhost:11434',
          models: ['llama3.1:8b'],
          capabilities: ['chat_completion'],
          settings: {
            temperature: 0.7,
            maxTokens: 2048
          }
        }
      ],
      defaultProvider: 'ollama_emergency',
      fallbackChain: ['ollama_emergency'],
      routingRules: [],
      globalSettings: {
        enableFallback: true,
        maxRetries: 3,
        timeout: 30000
      },
      source: 'emergency_defaults',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Process raw dashboard configuration
   */
  processConfiguration(rawConfig) {
    const processed = {
      providers: [],
      defaultProvider: null,
      fallbackChain: [],
      routingRules: [],
      globalSettings: {
        enableFallback: true,
        maxRetries: 3,
        timeout: 30000,
        enableMetrics: true
      },
      lastSync: new Date().toISOString(),
      version: rawConfig.version || '1.0.0'
    };
    
    // Process providers
    if (rawConfig.providers && Array.isArray(rawConfig.providers)) {
      processed.providers = rawConfig.providers.map(provider => ({
        id: provider.id || provider.name?.toLowerCase().replace(/\s+/g, '_'),
        name: provider.name,
        type: this.mapProviderType(provider.type),
        enabled: provider.enabled !== false,
        priority: provider.priority || 1,
        endpoint: provider.endpoint,
        models: provider.models || [],
        capabilities: provider.capabilities || ['chat_completion'],
        settings: provider.settings || {},
        lastUpdated: new Date().toISOString()
      }));
    }
    
    // Set default provider
    processed.defaultProvider = rawConfig.defaultProvider || 
      (processed.providers.find(p => p.enabled)?.id) || null;
    
    // Process fallback chain
    if (rawConfig.fallbackChain && Array.isArray(rawConfig.fallbackChain)) {
      processed.fallbackChain = rawConfig.fallbackChain.filter(id => 
        processed.providers.some(p => p.id === id && p.enabled)
      );
    }
    
    // Process routing rules
    if (rawConfig.routingRules && Array.isArray(rawConfig.routingRules)) {
      processed.routingRules = rawConfig.routingRules.map(rule => ({
        id: rule.id || `rule_${Date.now()}`,
        name: rule.name || 'Unnamed Rule',
        condition: rule.condition || {},
        targetProvider: rule.targetProvider,
        fallbackProviders: rule.fallbackProviders || [],
        enabled: rule.enabled !== false
      }));
    }
    
    return processed;
  }
  
  /**
   * Map provider types
   */
  mapProviderType(dashboardType) {
    const typeMap = {
      'ollama': 'ollama',
      'openai': 'openai',
      'anthropic': 'anthropic',
      'perplexity': 'perplexity',
      'google': 'google',
      'custom': 'custom'
    };
    
    return typeMap[dashboardType?.toLowerCase()] || 'custom';
  }
  
  /**
   * Validate configuration
   */
  isConfigValid(config) {
    try {
      const { error } = configSchema.validate(config);
      return !error;
    } catch (error) {
      this.logger.error('Configuration validation failed', { error: error.message });
      return false;
    }
  }
  
  /**
   * Persist configuration to all available storage tiers
   */
  async persistConfig(config, source) {
    const configHash = this.getConfigHash(config);
    const version = ++this.configVersion;
    
    try {
      // Persist to Redis (fast)
      if (this.storage.redis) {
        await this.storage.redis.setex(
          'ai-gateway:config:current',
          3600, // 1 hour TTL
          JSON.stringify(config)
        );
      }
      
      // Persist to SQLite (durable)
      if (this.storage.sqlite) {
        const stmt = this.storage.sqlite.prepare(`
          INSERT OR REPLACE INTO provider_configs 
          (id, config_data, version, config_hash, updated_at, is_active)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
        `);
        stmt.run('current', JSON.stringify(config), version, configHash);
        
        // Record in history
        const historyStmt = this.storage.sqlite.prepare(`
          INSERT INTO config_history 
          (config_hash, config_data, version, source, success)
          VALUES (?, ?, ?, ?, 1)
        `);
        historyStmt.run(configHash, JSON.stringify(config), version, source);
      }
      
      this.logger.info('Configuration persisted successfully', { 
        source, version, hash: configHash.substring(0, 8) 
      });
    } catch (error) {
      this.logger.error('Failed to persist configuration', { 
        error: error.message, source 
      });
    }
  }
  
  /**
   * Apply configuration to memory and emit events
   */
  async applyConfiguration(config, source) {
    try {
      // Validate configuration
      if (!this.isConfigValid(config)) {
        throw new Error('Invalid configuration structure');
      }
      
      // Update memory storage
      this.storage.memory.clear();
      config.providers.forEach(provider => {
        this.storage.memory.set(provider.id, provider);
      });
      
      // Update current state
      const previousConfig = this.currentConfig;
      this.currentConfig = config;
      this.lastSyncTime = new Date();
      
      // Emit configuration update event
      this.emit('config_updated', {
        config,
        previousConfig,
        source,
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Configuration applied successfully', {
        source,
        providersCount: config.providers.length,
        defaultProvider: config.defaultProvider
      });
      
    } catch (error) {
      this.logger.error('Failed to apply configuration', { 
        error: error.message, source 
      });
      throw error;
    }
  }
  
  /**
   * Generate configuration hash for change detection
   */
  getConfigHash(config) {
    const hashData = {
      providers: config.providers?.map(p => ({
        id: p.id,
        enabled: p.enabled,
        priority: p.priority,
        settings: p.settings
      })),
      defaultProvider: config.defaultProvider,
      fallbackChain: config.fallbackChain,
      routingRules: config.routingRules?.map(r => ({
        id: r.id,
        enabled: r.enabled,
        condition: r.condition,
        targetProvider: r.targetProvider
      }))
    };
    
    return require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(hashData))
      .digest('hex');
  }
  
  /**
   * Record configuration load event
   */
  recordConfigLoad(config, strategy) {
    this.logger.info('Configuration loaded successfully', {
      strategy,
      providersCount: config.providers?.length || 0,
      version: config.version,
      source: config.source
    });
  }
  
  /**
   * Start periodic synchronization
   */
  startPeriodicSync() {
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncConfiguration();
      } catch (error) {
        this.logger.error('Periodic sync failed', { error: error.message });
        this.emit('sync_error', { 
          error: error.message, 
          timestamp: new Date().toISOString() 
        });
      }
    }, this.syncInterval);
    
    this.logger.info('Periodic sync started', { interval: this.syncInterval });
  }
  
  /**
   * Sync configuration with dashboard
   */
  async syncConfiguration() {
    try {
      const config = await this.loadConfiguration();
      
      // Check if configuration has changed
      const configChanged = this.hasConfigurationChanged(config);
      
      if (configChanged) {
        await this.applyConfiguration(config, 'sync');
        this.logger.info('Configuration synchronized and updated');
      } else {
        this.logger.debug('No configuration changes detected during sync');
      }
      
      return config;
    } catch (error) {
      this.logger.error('Configuration sync failed', { error: error.message });
      
      // If we have a current config, continue using it
      if (this.currentConfig) {
        this.logger.warn('Continuing with cached configuration due to sync failure');
        return this.currentConfig;
      }
      
      throw error;
    }
  }
  
  /**
   * Check if configuration has changed
   */
  hasConfigurationChanged(newConfig) {
    if (!this.currentConfig) {
      return true;
    }
    
    const currentHash = this.getConfigHash(this.currentConfig);
    const newHash = this.getConfigHash(newConfig);
    
    return currentHash !== newHash;
  }
  
  /**
   * Get provider by ID
   */
  getProvider(providerId) {
    return this.storage.memory.get(providerId);
  }
  
  /**
   * Get all enabled providers
   */
  getEnabledProviders() {
    return Array.from(this.storage.memory.values()).filter(p => p.enabled);
  }
  
  /**
   * Get default provider
   */
  getDefaultProvider() {
    if (this.currentConfig?.defaultProvider && 
        this.storage.memory.has(this.currentConfig.defaultProvider)) {
      return this.storage.memory.get(this.currentConfig.defaultProvider);
    }
    
    // Fallback to first enabled provider
    const enabledProviders = this.getEnabledProviders();
    return enabledProviders.length > 0 ? enabledProviders[0] : null;
  }
  
  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      healthy: this.isHealthy,
      lastSync: this.lastSyncTime,
      providersCount: this.storage.memory.size,
      enabledProvidersCount: this.getEnabledProviders().length,
      defaultProvider: this.currentConfig?.defaultProvider,
      configVersion: this.configVersion,
      storage: {
        memory: this.storage.memory.size > 0,
        redis: this.storage.redis?.status === 'ready',
        sqlite: this.storage.sqlite !== null,
        dashboard: this.storage.dashboard !== null
      },
      dashboardUrl: this.dashboardUrl,
      syncInterval: this.syncInterval
    };
  }
  
  /**
   * Stop the service
   */
  async stop() {
    this.logger.info('Stopping Enhanced Configuration Service');
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    if (this.storage.redis) {
      await this.storage.redis.disconnect();
    }
    
    if (this.storage.sqlite) {
      this.storage.sqlite.close();
    }
    
    this.isHealthy = false;
    this.emit('service_stopped', { timestamp: new Date().toISOString() });
    
    this.logger.info('Enhanced Configuration Service stopped');
  }
}

module.exports = EnhancedConfigService;
