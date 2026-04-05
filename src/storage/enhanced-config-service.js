/**
 * Enhanced Configuration Service for AI Gateway v2.0
 * Implements 4-tier hybrid storage architecture for fault-tolerant configuration management
 */

const PostgreSQLWrapper = require('./postgres-wrapper');
const DatabaseConfig = require('./database-config');
// const Redis = require('ioredis'); // Removed Redis dependency
const EventEmitter = require('events');
const axios = require('axios');
const winston = require('winston');
const Joi = require('joi');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
    
    // Dashboard integration disabled - using PostgreSQL-only mode
    this.dashboardUrl = null;
    this.syncInterval = 0; // Disabled
    this.apiKey = config.apiKey || process.env.API_KEY;
    this.enabled = config.enabled !== false;
    
    // Initialize database configuration using ecosystem-wide architecture
    this.databaseConfig = new DatabaseConfig();
    this.databaseConfig.configPath = '/Users/eleazar/Projects/AIHomelab/infrastructure/database/config';
    const postgresConfig = this.databaseConfig.getConfig('write');
    
    // Redis configuration disabled - using PostgreSQL-only mode
    let redisConfig = null;
    
    this.storageConfig = {
      postgres: postgresConfig
      // redis: redisConfig // Disabled
    };
    
    // Storage tiers (2-tier architecture: Memory + PostgreSQL)
    this.storage = {
      memory: new Map(), // Tier 1: In-memory cache
      postgres: null     // Tier 2: PostgreSQL persistent storage
      // redis: null,    // Disabled
      // dashboard: null // Disabled
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
    
    this.logger.info('Enhanced Configuration Service initialized (PostgreSQL-only mode)', {
      postgresHost: postgresConfig.host,
      postgresDatabase: postgresConfig.database
    });
  }
  
  /**
   * Initialize all storage tiers - DATABASE FIRST (no fallbacks allowed)
   */
  async initialize() {
    // Database initialization with retry logic for k3d deployment
    try {
      this.logger.info('Initializing database tier with retry logic');
      await this.initializePostgreSQL();
      this.logger.info('✅ PostgreSQL database initialized successfully');
    } catch (error) {
      this.logger.error('❌ CRITICAL: PostgreSQL initialization failed', { error: error.message });
      // Development override: allow no-DB mode for local testing
      if (process.env.DEV_GATEWAY_NO_DB === 'true') {
        this.logger.warn('⚠️ DEV OVERRIDE ENABLED: Running without PostgreSQL. Using in-memory config only.');
        // Mark postgres as unavailable; continue with memory-only mode
        this.storage.postgres = null;
        return true;
      }
      // Database persistence is mandatory per deployment rules
      this.logger.error('🛑 STARTUP ABORTED: Database is mandatory; no in-memory fallback permitted');
      throw new Error(`Database initialization failed: ${error.message}. Startup aborted to prevent running without persistence.`);
    }

    // Redis and Dashboard initialization disabled - using PostgreSQL-only mode
    this.logger.info('Storage tiers initialized (PostgreSQL-only mode)');
    return true;
  }
  
  /**
   * Initialize PostgreSQL database
   */
  async initializePostgreSQL() {
    try {
      this.storage.postgres = new PostgreSQLWrapper(this.storageConfig.postgres);
      await this.storage.postgres.connect();
      
      // Create schema
      await this.storage.postgres.exec(`
        CREATE TABLE IF NOT EXISTS provider_configs (
          id TEXT PRIMARY KEY,
          config_data TEXT NOT NULL,
          version INTEGER NOT NULL,
          config_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT true
        );
        
        CREATE TABLE IF NOT EXISTS config_history (
          id SERIAL PRIMARY KEY,
          config_hash TEXT NOT NULL,
          config_data TEXT NOT NULL,
          version INTEGER NOT NULL,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          source TEXT NOT NULL,
          success BOOLEAN DEFAULT true
        );
        
        CREATE TABLE IF NOT EXISTS routing_metrics (
          id SERIAL PRIMARY KEY,
          provider_id TEXT NOT NULL UNIQUE,
          request_count INTEGER DEFAULT 0,
          success_count INTEGER DEFAULT 0,
          avg_latency REAL DEFAULT 0,
          last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_config_history_version ON config_history(version);
        CREATE INDEX IF NOT EXISTS idx_config_history_applied_at ON config_history(applied_at);
        CREATE INDEX IF NOT EXISTS idx_routing_metrics_provider ON routing_metrics(provider_id);
      `);
      
      this.logger.info('PostgreSQL database initialized', { 
        host: this.storageConfig.postgres.host,
        database: this.storageConfig.postgres.database
      });
    } catch (error) {
      this.logger.error('Failed to initialize PostgreSQL', { error: error.message });
      throw error;
    }
  }
  
  // Redis initialization disabled in PostgreSQL-only mode
  
  // Dashboard client initialization disabled in PostgreSQL-only mode
  
  /**
   * Verify database connectivity before proceeding
   */
  async verifyDatabaseConnectivity() {
    if (!this.storage.postgres) {
      throw new Error('PostgreSQL connection not initialized');
    }
    
    try {
      // Test database connectivity with a simple query
      await this.storage.postgres.query('SELECT 1 as test');
      this.logger.info('✅ Database connectivity verified');
    } catch (error) {
      this.logger.error('❌ Database connectivity verification failed', { error: error.message });
      throw new Error(`Database connectivity verification failed: ${error.message}`);
    }
  }
  
  /**
   * Get default configuration for initial setup
   */
  getDefaultConfiguration() {
    return {
      providers: [
        {
          id: 'ollama_default',
          name: 'Ollama Local',
          type: 'ollama',
          enabled: true,
          priority: 1,
          endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434',
          models: ['llama3.2:3b', 'gemma3:4b', 'gemma3:latest'],
          capabilities: ['chat_completion']
        }
      ],
      defaultProvider: 'ollama_default',
      fallbackChain: ['ollama_default'],
      routingRules: [
        // ============================================================
        // UPSTREAM TASKS (10%) - Complex multi-step agentic workflows
        // Requires: planning, reasoning, multi-tool orchestration
        // ============================================================
        {
          id: 'tier0_perplexity_sonar',
          name: 'Tier 0: Perplexity Sonar → perplexity-default',
          priority: 1,
          condition: {
            anyOf: [
              { field: 'model', in: ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'] }
            ]
          },
          targetProvider: 'perplexity-default',
          targetModel: null,
          fallbackProviders: ['google-default'],
          enabled: true
        },
        {
          id: 'tier1_upstream_sonnet',
          name: 'Tier 1: Upstream (Complex Agentic) → Sonnet 4.5',
          priority: 10,
          condition: {
            anyOf: [
              // Explicit upstream task types
              { field: 'taskStream', equals: 'upstream' },
              { field: 'operationType', in: ['multi_step_workflow', 'agentic', 'complex_reasoning', 'planning', 'orchestration'] },
              // High complexity with tools = needs reasoning
              {
                allOf: [
                  { field: 'complexity', equals: 'high' },
                  { field: 'hasTools', equals: true }
                ]
              },
              // Multi-tool scenarios (3+ tools = orchestration needed)
              { field: 'toolCount', greaterThan: 2 }
            ]
          },
          targetProvider: 'anthropic-default',
          targetModel: 'claude-sonnet-4-5',
          fallbackProviders: ['google-default'],
          enabled: true
        },
        // ============================================================
        // MIDSTREAM TASKS (60%) - Standard tool execution
        // Single or dual tool calls, routine operations
        // ============================================================
        {
          id: 'tier2_midstream_haiku',
          name: 'Tier 2: Midstream (Standard Tools) → Haiku 4.5',
          priority: 20,
          condition: {
            allOf: [
              { field: 'hasTools', equals: true },
              {
                anyOf: [
                  { field: 'taskStream', equals: 'midstream' },
                  { field: 'operationType', in: ['email_search', 'calendar_ops', 'tool_calling', 'data_retrieval', 'crud_operation'] },
                  { field: 'complexity', in: ['medium', 'low'] },
                  // 1-2 tools = standard execution
                  { field: 'toolCount', lessThan: 3 }
                ]
              }
            ]
          },
          targetProvider: 'anthropic-default',
          targetModel: 'claude-haiku-4-5',
          fallbackProviders: ['google-default'],
          enabled: true
        },
        // ============================================================
        // DOWNSTREAM TASKS (20%) - Simple tool calls, classification
        // Single tool, extraction, formatting
        // ============================================================
        {
          id: 'tier3_downstream_gemini',
          name: 'Tier 3: Downstream (Simple Tools) → Gemini Flash',
          priority: 30,
          condition: {
            allOf: [
              { field: 'hasTools', equals: true },
              {
                anyOf: [
                  { field: 'taskStream', equals: 'downstream' },
                  { field: 'operationType', in: ['classification', 'extraction', 'single_tool', 'formatting', 'validation'] },
                  { field: 'complexity', equals: 'low' },
                  { field: 'toolCount', equals: 1 }
                ]
              }
            ]
          },
          targetProvider: 'google-default',
          targetModel: 'gemini-2-5-flash',
          fallbackProviders: ['anthropic-default'],
          enabled: true
        },
        // ============================================================
        // EDGE TASKS (10%) - No tools, simple chat/completion
        // Local processing, cost-free
        // ============================================================
        {
          id: 'tier4_edge_qwen',
          name: 'Tier 4: Edge (No Tools) → Qwen3-32B Local',
          priority: 40,
          condition: {
            allOf: [
              { field: 'hasTools', equals: false },
              {
                anyOf: [
                  { field: 'taskStream', equals: 'edge' },
                  { field: 'operationType', in: ['chat', 'completion', 'simple_qa', 'summarization', 'translation'] },
                  { field: 'complexity', in: ['low', 'medium'] }
                ]
              }
            ]
          },
          targetProvider: 'openai-qwen3-32b-local',
          targetModel: 'qwen3-32b',
          fallbackProviders: ['google-default', 'anthropic-default'],
          enabled: true
        }
      ],
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      source: 'default_config'
    };
  }

  /**
   * Start the configuration service - DATABASE FIRST ENFORCEMENT
   */
  async start() {
    if (!this.enabled) {
      this.logger.info('Configuration service disabled, skipping start');
      return;
    }
    
    // CRITICAL: Database initialization is MANDATORY
    try {
      this.logger.info('🚀 Starting Enhanced Configuration Service with DATABASE-FIRST enforcement');
      await this.initialize(); // This will throw if database fails
      
      // Verify database connectivity before proceeding (skip in dev no-DB mode)
      if (this.storage.postgres) {
        await this.verifyDatabaseConnectivity();
      } else if (process.env.DEV_GATEWAY_NO_DB === 'true') {
        this.logger.warn('⚠️ DEV OVERRIDE: Skipping database connectivity verification');
      }
      
      // Load initial configuration using DATABASE-FIRST strategy
      let config;
      if (this.storage.postgres) {
        config = await this.loadConfigurationDatabaseFirst();
      } else {
        // Use default configuration in memory for dev
        config = this.getDefaultConfiguration();
        this.logger.warn('⚠️ DEV OVERRIDE: Using default configuration in memory');
      }
      await this.applyConfiguration(config, 'startup');
      
      // Start periodic sync
      this.startPeriodicSync();
      
      this.isHealthy = true;
      this.emit('service_started', { timestamp: new Date().toISOString() });
      
      this.logger.info('✅ Enhanced Configuration Service started successfully with database persistence');
    } catch (error) {
      this.logger.error('❌ CRITICAL: Configuration service startup failed', { error: error.message });
      if (process.env.DEV_GATEWAY_NO_DB === 'true') {
        this.logger.warn('⚠️ DEV OVERRIDE: Continuing without database persistence');
      } else {
        this.logger.error('🛑 ABORTING STARTUP: Cannot continue without database persistence');
      }
      this.emit('service_error', { error: error.message, timestamp: new Date().toISOString() });
      if (process.env.DEV_GATEWAY_NO_DB === 'true') {
        return; // Already logged warning
      }
      throw new Error(`Configuration service startup failed: ${error.message}. Database persistence is mandatory.`);
    }
  }
  
  /**
   * DATABASE-FIRST configuration loading strategy (no in-memory fallbacks)
   */
  async loadConfigurationDatabaseFirst() {
    const loadStrategies = [
      // Strategy 1: PostgreSQL database (MANDATORY)
      async () => {
        this.logger.info('Loading configuration from PostgreSQL database (PRIMARY)');
        const result = await this.storage.postgres.query(
          'SELECT config_data FROM provider_configs WHERE is_active = true ORDER BY updated_at DESC LIMIT 1'
        );
        
        if (result.rows && result.rows.length > 0) {
          const config = JSON.parse(result.rows[0].config_data);
          this.logger.info('✅ Configuration loaded from PostgreSQL database');
          return config;
        }
        throw new Error('No active configuration found in database');
      },
      
      // Strategy 2: Dashboard sync disabled in PostgreSQL-only mode
      async () => {
        throw new Error('Dashboard sync disabled in PostgreSQL-only mode');
      },
      
      // Strategy 3: Default configuration (LAST RESORT - still persisted to database)
      async () => {
        this.logger.warn('⚠️  Loading default configuration as last resort');
        const defaultConfig = this.getDefaultConfiguration();
        await this.persistConfig(defaultConfig, 'default');
        this.logger.info('✅ Default configuration loaded and persisted to database');
        return defaultConfig;
      }
    ];
    
    // Execute strategies in DATABASE-FIRST order
    for (let i = 0; i < loadStrategies.length; i++) {
      try {
        const config = await loadStrategies[i]();
        this.logger.info(`✅ Configuration loaded using strategy ${i + 1}`);
        return config;
      } catch (error) {
        this.logger.warn(`Configuration load strategy ${i + 1} failed: ${error.message}`);
        if (i === loadStrategies.length - 1) {
          // Last strategy failed - this is critical
          this.logger.error('❌ CRITICAL: All configuration load strategies failed, including default');
          throw new Error('Failed to load any configuration, including defaults. Database persistence required.');
        }
        continue;
      }
    }
  }
  
  /**
   * Persist configuration to database
   */
  async persistConfig(config, source) {
    if (!this.storage.postgres) {
      throw new Error('PostgreSQL not available for persistence');
    }
    
    try {
      const configData = JSON.stringify(config);
      const configHash = this.generateConfigHash(config);
      
      // Deactivate previous configurations
      await this.storage.postgres.query('UPDATE provider_configs SET is_active = false');
      
      // Insert new configuration
      const id = require('crypto').randomUUID();
      await this.storage.postgres.query(
        'INSERT INTO provider_configs (id, config_data, version, config_hash, is_active) VALUES ($1, $2, $3, $4, $5)',
        [id, configData, this.configVersion || 1, configHash, true]
      );

      // Record history
      await this.storage.postgres.query(
        'INSERT INTO config_history (config_hash, config_data, version, applied_at, source, success) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)',
        [configHash, configData, this.configVersion || 1, source, true]
      );

      // Redis caching disabled in PostgreSQL-only mode
      
      this.logger.info(`Configuration persisted to database from source: ${source}`, { configHash });
    } catch (error) {
      this.logger.error('Failed to persist configuration to database', { error: error.message });
      throw error;
    }
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
        priority: rule.priority,
        condition: rule.condition || {},
        targetProvider: rule.targetProvider,
        targetModel: rule.targetModel || rule.model,
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
      const { error } = configSchema.validate(config, { allowUnknown: true });
      return !error;
    } catch (error) {
      this.logger.error('Configuration validation failed', { error: error.message });
      return false;
    }
  }
  
  // (Removed duplicate persistConfig that referenced SQLite to ensure single PostgreSQL-based persistence)
  
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
   * Periodic sync disabled in PostgreSQL-only mode
   */
  startPeriodicSync() {
    this.logger.info('Periodic sync disabled in PostgreSQL-only mode');
  }
  
  /**
   * Dashboard sync disabled in PostgreSQL-only mode
   */
  async syncFromDashboard() {
    this.logger.info('Dashboard sync disabled in PostgreSQL-only mode');
  }
  
  /**
   * Generate configuration hash for change detection
   */
  generateConfigHash(config) {
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
        postgres: !!this.storage.postgres?.isConnected
      },
      mode: 'postgresql-only'
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
    
    // Redis disconnection disabled in PostgreSQL-only mode
    
    if (this.storage.postgres) {
      await this.storage.postgres.disconnect();
    }
    
    this.isHealthy = false;
    this.emit('service_stopped', { timestamp: new Date().toISOString() });
    
    this.logger.info('Enhanced Configuration Service stopped');

    // Ensure Winston transports (especially File transport) are closed to avoid open handles in tests
    try {
      if (this.logger && typeof this.logger.close === 'function') {
        this.logger.close();
      } else if (this.logger && Array.isArray(this.logger.transports)) {
        this.logger.transports.forEach(t => {
          if (typeof t.close === 'function') {
            try { t.close(); } catch (_) { /* noop */ }
          }
        });
      }
    } catch (_) {
      // Swallow any logger closing errors to not interfere with shutdown
    }
  }
}

module.exports = EnhancedConfigService;
