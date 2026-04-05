const { EventEmitter } = require('events');
const OpenAIProvider = require('./providers/openai-provider');
const OpenAIOSSProvider = require('./providers/openai-oss-provider');
const AnthropicProvider = require('./providers/anthropic-provider');
const GoogleProvider = require('./providers/google-provider');
const PerplexityProvider = require('./providers/perplexity-provider');
const RoutingEngine = require('./routing-engine');
const FallbackManager = require('./fallback-manager');

/**
 * Provider Manager for AI Gateway v2.0
 * Manages dynamic loading and routing of LLM providers
 * Supports OpenAI, OpenAI OSS (via Ollama), Perplexity, and future providers
 */
class ProviderManager extends EventEmitter {
  constructor() {
    super();
    this.providers = new Map();
    this.activeProviders = new Map();
    this.providerClasses = new Map();
    this.routingCapabilities = new Map();
    this.healthStatus = new Map();
    this.routingEngine = null;
    this.fallbackManager = null;
    
    // Register built-in provider classes
    this.registerProviderClass('openai', OpenAIProvider);
    this.registerProviderClass('openai-oss', OpenAIOSSProvider);
    this.registerProviderClass('anthropic', AnthropicProvider);
    this.registerProviderClass('google', GoogleProvider);
    this.registerProviderClass('perplexity', PerplexityProvider);
    
    console.log('[Provider Manager] Initialized with built-in providers');
    
    // Initialize routing engine and fallback manager after provider setup
    this.initializeRoutingEngine();
    this.initializeFallbackManager();
  }

  /**
   * Initialize the intelligent routing engine
   */
  initializeRoutingEngine() {
    this.routingEngine = new RoutingEngine(this);
    
    // Listen for routing events
    this.routingEngine.on('routing_decision', (decision) => {
      this.emit('routing_decision', decision);
    });
    
    this.routingEngine.on('routing_error', (error) => {
      this.emit('routing_error', error);
    });
    
    console.log('[Provider Manager] Routing engine initialized');
  }

  /**
   * Initialize the fallback manager
   */
  initializeFallbackManager() {
    this.fallbackManager = new FallbackManager(this);
    
    // Listen for fallback events
    this.fallbackManager.on('fallback_success', (event) => {
      this.emit('fallback_success', event);
    });
    
    this.fallbackManager.on('fallback_exhausted', (event) => {
      this.emit('fallback_exhausted', event);
    });
    
    this.fallbackManager.on('health_check_completed', (results) => {
      this.emit('health_check_completed', results);
    });
    
    console.log('[Provider Manager] Fallback manager initialized');
  }

  /**
   * Register a provider class for dynamic loading
   */
  registerProviderClass(type, ProviderClass) {
    this.providerClasses.set(type, ProviderClass);
    console.log(`[Provider Manager] Registered provider class: ${type}`);
  }

  /**
   * Load and initialize a provider from configuration
   */
  async loadProvider(providerConfig) {
    try {
      console.log(`[Provider Manager] Loading provider: ${providerConfig.id} (${providerConfig.type})`);
      
      const ProviderClass = this.getProviderClass(providerConfig.type);
      if (!ProviderClass) {
        throw new Error(`Unknown provider type: ${providerConfig.type}`);
      }
      
      // Create provider instance
      const providerInstance = new ProviderClass(providerConfig);
      
      // Set up event listeners
      this.setupProviderEventListeners(providerInstance);
      
      // Initialize the provider
      await providerInstance.initialize();
      
      // Validate connection only if not a local endpoint
      const isLocalEndpoint = providerConfig.endpoint && 
        (providerConfig.endpoint.includes('localhost') || providerConfig.endpoint.includes('127.0.0.1'));
      
      if (!isLocalEndpoint) {
        await providerInstance.validateConnection();
      }
      
      // Store provider
      this.providers.set(providerConfig.id, providerConfig);
      this.activeProviders.set(providerConfig.id, providerInstance);
      
      // Update routing capabilities
      this.updateRoutingCapabilities(providerConfig.id, providerConfig.capabilities);
      
      console.log(`[Provider Manager] Provider ${providerConfig.id} loaded successfully`);
      this.emit('provider_loaded', { 
        providerId: providerConfig.id, 
        type: providerConfig.type,
        models: providerInstance.getModels()
      });
      
      return providerInstance;
    } catch (error) {
      console.error(`[Provider Manager] Failed to load provider ${providerConfig.id}:`, error.message);
      this.emit('provider_load_failed', { 
        providerId: providerConfig.id, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get provider class by type
   */
  getProviderClass(type) {
    return this.providerClasses.get(type);
  }

  /**
   * Set up event listeners for a provider instance
   */
  setupProviderEventListeners(providerInstance) {
    providerInstance.on('initialized', (data) => {
      this.emit('provider_initialized', data);
    });
    
    providerInstance.on('error', (data) => {
      this.healthStatus.set(data.provider, { status: 'error', error: data.error });
      this.emit('provider_error', data);
    });
    
    providerInstance.on('request_completed', (data) => {
      this.emit('request_completed', data);
    });
    
    providerInstance.on('request_failed', (data) => {
      this.emit('request_failed', data);
    });
  }

  /**
   * Update routing capabilities for a provider
   */
  updateRoutingCapabilities(providerId, capabilities = []) {
    this.routingCapabilities.set(providerId, capabilities);
    if (capabilities && capabilities.length > 0) {
      console.log(`[Provider Manager] Updated routing capabilities for ${providerId}: ${capabilities.join(', ')}`);
    }
  }

  /**
   * Unload a provider
   */
  async unloadProvider(providerId) {
    try {
      console.log(`[Provider Manager] Unloading provider: ${providerId}`);
      
      const providerInstance = this.activeProviders.get(providerId);
      if (providerInstance) {
        await providerInstance.cleanup();
        this.activeProviders.delete(providerId);
      }
      
      this.providers.delete(providerId);
      this.routingCapabilities.delete(providerId);
      this.healthStatus.delete(providerId);
      
      console.log(`[Provider Manager] Provider ${providerId} unloaded successfully`);
      this.emit('provider_unloaded', { providerId });
      
      return true;
    } catch (error) {
      console.error(`[Provider Manager] Failed to unload provider ${providerId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get provider instance by ID
   */
  getProvider(providerId) {
    return this.activeProviders.get(providerId);
  }

  /**
   * Get all active providers
   */
  getActiveProviders() {
    return Array.from(this.activeProviders.keys());
  }

  /**
   * Get provider by model name
   */
  getProviderForModel(modelName) {
    console.log(`[Provider Manager] Looking for provider for model: "${modelName}"`);
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        const models = providerInstance.getModels();
        console.log(`[Provider Manager] ${providerId} returned ${models?.length} models`);
        if (Array.isArray(models)) {
          // Filter out any undefined/null models and check
          const validModels = models.filter(m => m && (m.id || m.name));
          console.log(`[Provider Manager] ${providerId} has ${validModels.length} valid models`);
          const found = validModels.some(model => model.id === modelName || model.name === modelName);
          console.log(`[Provider Manager] ${providerId} has model "${modelName}": ${found}`);
          if (found) {
            return providerInstance;
          }
        }
      } catch (error) {
        console.error(`[Provider Manager] Error getting models from ${providerId}:`, error.message);
      }
    }
    console.log(`[Provider Manager] No provider found for model: "${modelName}"`);
    return null;
  }

  /**
   * Get all available models from all providers
   */
  getAllAvailableModels() {
    const allModels = [];
    console.log(`[Provider Manager] getAllAvailableModels() - Active providers: ${this.activeProviders.size}`);
    
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        console.log(`[Provider Manager] Getting models from provider: ${providerId}`);
        const models = providerInstance.getAvailableModels();
        console.log(`[Provider Manager] Provider ${providerId} returned ${models.length} models`);
        allModels.push(...models);
      } catch (error) {
        console.error(`[Provider Manager] Error getting models from ${providerId}:`, error.message);
      }
    }
    
    console.log(`[Provider Manager] Total models aggregated: ${allModels.length}`);
    return allModels;
  }

  /**
   * Get routing engine instance
   */
  getRoutingEngine() {
    return this.routingEngine;
  }

  /**
   * Update routing engine configuration
   */
  updateRoutingConfig(config) {
    if (this.routingEngine) {
      this.routingEngine.updateConfig(config);
    }
  }

  /**
   * Get routing analytics
   */
  getRoutingAnalytics(timeRange) {
    if (this.routingEngine) {
      return this.routingEngine.getAnalytics(timeRange);
    }
    return null;
  }

  /**
   * Execute request with advanced fallback chains
   */
  async executeWithFallback(request, options = {}) {
    if (!this.fallbackManager) {
      throw new Error('Fallback manager not initialized');
    }
    
    return await this.fallbackManager.executeWithFallback(request, options);
  }

  /**
   * Get fallback manager instance
   */
  getFallbackManager() {
    return this.fallbackManager;
  }

  /**
   * Get comprehensive health status including fallback metrics
   */
  getComprehensiveHealthStatus() {
    const basicHealth = this.getHealthStatus();
    const fallbackHealth = this.fallbackManager ? this.fallbackManager.getHealthStatus() : {};
    
    return {
      providers: basicHealth,
      fallback: fallbackHealth,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get fallback analytics
   */
  getFallbackAnalytics() {
    if (this.fallbackManager) {
      return this.fallbackManager.getAnalytics();
    }
    return null;
  }

  /**
   * Register custom fallback chain
   */
  registerFallbackChain(name, chain) {
    if (this.fallbackManager) {
      this.fallbackManager.registerFallbackChain(name, chain);
    }
  }

  /**
   * Update fallback configuration
   */
  updateFallbackConfig(config) {
    if (this.fallbackManager) {
      this.fallbackManager.updateConfig(config);
    }
  }

  /**
   * Get detailed provider connectivity status
   */
  async getProviderConnectivityStatus() {
    const connectivityStatus = {};
    
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        const startTime = Date.now();
        const isHealthy = await providerInstance.healthCheck();
        const responseTime = Date.now() - startTime;
        
        const modelsList = (typeof providerInstance.getAvailableModels === 'function'
          ? (providerInstance.getAvailableModels() || [])
          : (typeof providerInstance.getModels === 'function' ? (providerInstance.getModels() || []) : []));

        connectivityStatus[providerId] = {
          connected: isHealthy,
          responseTime: responseTime,
          status: isHealthy ? 'healthy' : 'unhealthy',
          lastChecked: new Date().toISOString(),
          apiKeyConfigured: !!providerInstance.apiKey,
          modelsAvailable: Array.isArray(modelsList) ? modelsList.length : 0
        };
      } catch (error) {
        connectivityStatus[providerId] = {
          connected: false,
          status: 'error',
          error: error.message,
          lastChecked: new Date().toISOString(),
          apiKeyConfigured: !!providerInstance.apiKey,
          modelsAvailable: 0
        };
      }
    }
    
    return connectivityStatus;
  }

  /**
   * Get all available models from all providers
   */
  getAllAvailableModels() {
    const allModels = [];
    
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        if (providerInstance.getAvailableModels) {
          const models = providerInstance.getAvailableModels();
          allModels.push(...models);
        } else if (providerInstance.getModels) {
          const models = providerInstance.getModels();
          allModels.push(...models);
        }
      } catch (error) {
        console.error(`[Provider Manager] Failed to get models from ${providerId}:`, error.message);
      }
    }
    
    return allModels;
  }

  /**
   * Get comprehensive health status
   */
  async getComprehensiveHealthStatus() {
    const providers = {};
    
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        providers[providerId] = {
          status: providerInstance.status || 'unknown',
          healthy: providerInstance.status === 'active',
          lastCheck: new Date().toISOString(),
          requestCount: providerInstance.requestCount || 0,
          errorCount: providerInstance.errorCount || 0
        };
      } catch (error) {
        providers[providerId] = {
          status: 'error',
          healthy: false,
          error: error.message,
          lastCheck: new Date().toISOString()
        };
      }
    }
    
    // Safe fallback chain access
    let fallbackChains = [];
    try {
      if (this.fallbackManager && this.fallbackManager.fallbackChains && typeof this.fallbackManager.fallbackChains.keys === 'function') {
        fallbackChains = Array.from(this.fallbackManager.fallbackChains.keys());
      }
    } catch (error) {
      console.error('[Provider Manager] Error accessing fallback chains:', error.message);
      fallbackChains = [];
    }
    
    return {
      gateway: {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      },
      providers,
      routing: {
        engine: this.routingEngine ? 'active' : 'inactive',
        strategies: this.routingEngine ? this.routingEngine.getAvailableStrategies() : []
      },
      fallback: {
        manager: this.fallbackManager ? 'active' : 'inactive',
        chains: fallbackChains
      }
    };
  }

  /**
   * Get routing analytics
   */
  getRoutingAnalytics() {
    if (!this.routingEngine) {
      return {
        totalRequests: 0,
        averageProcessingTime: 0,
        strategyUsage: {},
        providerUsage: {}
      };
    }
    
    return this.routingEngine.getAnalytics();
  }

  /**
   * Get fallback analytics
   */
  getFallbackAnalytics() {
    if (!this.fallbackManager) {
      return {
        chains: {},
        totalExecutions: 0,
        successfulExecutions: 0
      };
    }
    
    return this.fallbackManager.getAnalytics();
  }

  /**
   * Update routing configuration
   */
  updateRoutingConfig(config) {
    if (this.routingEngine) {
      this.routingEngine.updateConfig(config);
    }
  }

  /**
   * Update fallback configuration
   */
  updateFallbackConfig(config) {
    if (this.fallbackManager) {
      this.fallbackManager.updateConfig(config);
    }
  }

  /**
   * Get routing engine
   */
  getRoutingEngine() {
    return this.routingEngine;
  }

  /**
   * Route request using intelligent routing engine
   */
  async routeRequest(request, options = {}) {
    try {
      // Check for aliasing bypass flag
      const skipAliasing = options.skipAliasing === true;
      
      // Model normalization - only Claude internal aliases
      // NOTE: GPT→Claude translation removed after Goose ACP bypass
      if (!skipAliasing && request && typeof request.model === 'string') {
        const original = request.model;
        let normalized = original;
        
        // Only handle Claude internal naming variants
        if (original === 'claude-sonnet-4-0') {
          normalized = 'claude-3-5-sonnet';  // Use stable Claude 3.5 Sonnet
        }
        
        if (normalized !== original) {
          console.log(`[Provider Manager] Model normalized (Claude internal): ${original} → ${normalized}`);
          request.model = normalized;
        }
      }

      if (!this.routingEngine) {
        throw new Error('Routing engine not initialized');
      }

      // Get routing decision from intelligent routing engine
      const routingDecision = await this.routingEngine.routeRequest(request, options);
      
      // Get the selected provider instance
      const provider = this.activeProviders.get(routingDecision.provider);
      if (!provider) {
        throw new Error(`Provider ${routingDecision.provider} not found or not active`);
      }

      console.log(`[Provider Manager] Intelligent routing selected: ${routingDecision.provider} (${routingDecision.reason})`);
      
      // Execute the request with the selected provider
      const startTime = Date.now();
      let response;
      try {
        console.log(`[Provider Manager] Calling processChatCompletion on provider: ${provider.name || 'unnamed'}`);
        response = await provider.processChatCompletion(request);
      } catch (error) {
        console.error(`[Provider Manager] processChatCompletion failed:`, error.message);
        console.error(`[Provider Manager] Error stack:`, error.stack);
        throw error;
      }
      const processingTime = Date.now() - startTime;
      
      // Emit routing success event with metrics
      this.emit('request_completed', {
        provider: routingDecision.provider,
        processingTime,
        routingDecision,
        success: true,
        timestamp: new Date().toISOString()
      });
      
      return {
        ...response,
        routing: {
          provider: routingDecision.provider,
          reason: routingDecision.reason,
          processingTime,
          alternatives: Array.isArray(routingDecision.alternatives) ? routingDecision.alternatives : []
        }
      };
    } catch (error) {
      console.error(`[Provider Manager] Intelligent routing failed:`, error.message);
      
      // Emit routing failure event
      this.emit('request_failed', {
        error: error.message,
        request: request,
        timestamp: new Date().toISOString()
      });
      
      // Attempt fallback routing if enabled
      if (options.enableFallback !== false) {
        return await this.fallbackRouting(request, error);
      }
      
      throw error;
    }
  }

  /**
   * Fallback routing when intelligent routing fails
   */
  async fallbackRouting(request, originalError) {
    console.log('[Provider Manager] Attempting fallback routing...');
    
    try {
      // Simple fallback: find first healthy provider that supports the model
      for (const [providerId, providerInstance] of this.activeProviders) {
        try {
          const models = providerInstance.getAvailableModels();
          if (Array.isArray(models) && models.some(model => model.id === request.model)) {
            const isHealthy = await providerInstance.healthCheck();
            if (isHealthy) {
              console.log(`[Provider Manager] Fallback routing to: ${providerId}`);
              const response = await providerInstance.processChatCompletion(request);
              
              return {
                ...response,
                routing: {
                  provider: providerId,
                  reason: 'fallback',
                  originalError: originalError.message
                }
              };
            }
          }
        } catch (providerError) {
          console.warn(`[Provider Manager] Fallback provider ${providerId} failed:`, providerError.message);
          continue;
        }
      }
      
      throw new Error(`No fallback providers available. Original error: ${originalError.message}`);
    } catch (fallbackError) {
      console.error('[Provider Manager] Fallback routing failed:', fallbackError.message);
      throw fallbackError;
    }
  }

  /**
   * Update routing configuration (rules, strategies, etc.)
   */
  updateRoutingConfig(config) {
    if (this.routingEngine) {
      Object.assign(this.routingEngine.config, config);
      console.log(`[Provider Manager] Routing config updated: ${Object.keys(config).join(', ')}`);
      if (config.routingRules) {
        console.log(`[Provider Manager] ${config.routingRules.length} routing rules active`);
      }
    } else {
      console.warn('[Provider Manager] Cannot update routing config - routing engine not initialized');
    }
  }

  /**
   * Get the routing engine instance
   */
  getRoutingEngine() {
    return this.routingEngine;
  }

  /**
   * Get providers by capability
   */
  getProvidersByCapability(capability) {
    const matchingProviders = [];
    
    for (const [providerId, capabilities] of this.routingCapabilities) {
      if (capabilities.includes(capability)) {
        const providerInstance = this.activeProviders.get(providerId);
        if (providerInstance) {
          matchingProviders.push(providerInstance);
        }
      }
    }
    
    return matchingProviders;
  }

  /**
   * Perform health check on all providers
   */
  async performHealthCheck() {
    const healthResults = {};
    
    for (const [providerId, providerInstance] of this.activeProviders) {
      try {
        const health = await providerInstance.getHealthStatus();
        healthResults[providerId] = health;
        this.healthStatus.set(providerId, health);
      } catch (error) {
        const errorHealth = {
          provider: providerId,
          status: 'unhealthy',
          error: error.message,
          lastCheck: new Date().toISOString()
        };
        healthResults[providerId] = errorHealth;
        this.healthStatus.set(providerId, errorHealth);
      }
    }
    
    this.emit('health_check_completed', healthResults);
    return healthResults;
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus() {
    const status = {};
    for (const [providerId, health] of this.healthStatus) {
      status[providerId] = health;
    }
    return status;
  }

  /**
   * Apply configuration changes
   */
  async applyConfiguration(config) {
    try {
      console.log('[Provider Manager] Applying configuration changes...');
      
      const currentProviders = new Set(this.activeProviders.keys());
      const newProviders = new Set(config.providers.map(p => p.id));
      
      // Remove providers that are no longer in config
      for (const providerId of currentProviders) {
        if (!newProviders.has(providerId)) {
          await this.unloadProvider(providerId);
        }
      }
      
      // Load new providers or update existing ones (with resilient error handling)
      const loadErrors = [];
      for (const providerConfig of config.providers) {
        if (providerConfig.status === 'active') {
          try {
            if (this.activeProviders.has(providerConfig.id)) {
              // Provider exists, check if config changed
              const currentConfig = this.providers.get(providerConfig.id);
              if (JSON.stringify(currentConfig) !== JSON.stringify(providerConfig)) {
                console.log(`[Provider Manager] Reloading provider with updated config: ${providerConfig.id}`);
                await this.unloadProvider(providerConfig.id);
                await this.loadProvider(providerConfig);
              }
            } else {
              // New provider
              await this.loadProvider(providerConfig);
            }
          } catch (error) {
            console.error(`[Provider Manager] Failed to load provider ${providerConfig.id}: ${error.message}`);
            loadErrors.push({ providerId: providerConfig.id, error: error.message });
            // Continue loading other providers instead of failing completely
          }
        }
      }
      
      // Log summary of loaded providers
      const activeCount = this.getActiveProviders().length;
      console.log(`[Provider Manager] Configuration applied: ${activeCount} providers active, ${loadErrors.length} failed`);
      
      if (loadErrors.length > 0) {
        console.warn('[Provider Manager] Provider load errors:', loadErrors);
      }
      
      console.log('[Provider Manager] Configuration applied successfully');
      this.emit('configuration_applied', { 
        activeProviders: this.getActiveProviders(),
        totalModels: this.getAllAvailableModels().length
      });
      
      return true;
    } catch (error) {
      console.error('[Provider Manager] Configuration application failed:', error.message);
      this.emit('configuration_failed', { error: error.message });
      // Don't throw error if some providers loaded successfully
      const activeCount = this.getActiveProviders().length;
      if (activeCount > 0) {
        console.log(`[Provider Manager] Continuing with ${activeCount} successfully loaded providers`);
        return true;
      }
      throw error;
    }
  }

  /**
   * Get provider statistics
   */
  getStatistics() {
    const stats = {
      totalProviders: this.activeProviders.size,
      totalModels: this.getAllAvailableModels().length,
      providerTypes: {},
      capabilities: {},
      healthySummary: { healthy: 0, unhealthy: 0, unknown: 0 }
    };
    
    // Count provider types
    for (const [providerId, providerInstance] of this.activeProviders) {
      const type = providerInstance.type;
      stats.providerTypes[type] = (stats.providerTypes[type] || 0) + 1;
    }
    
    // Count capabilities
    for (const capabilities of this.routingCapabilities.values()) {
      for (const capability of capabilities) {
        stats.capabilities[capability] = (stats.capabilities[capability] || 0) + 1;
      }
    }
    
    // Health summary
    for (const health of this.healthStatus.values()) {
      if (health.status === 'healthy') {
        stats.healthySummary.healthy++;
      } else if (health.status === 'unhealthy') {
        stats.healthySummary.unhealthy++;
      } else {
        stats.healthySummary.unknown++;
      }
    }
    
    return stats;
  }

  /**
   * Cleanup all providers
   */
  async cleanup() {
    console.log('[Provider Manager] Cleaning up all providers...');
    
    const cleanupPromises = [];
    for (const [providerId, providerInstance] of this.activeProviders) {
      cleanupPromises.push(providerInstance.cleanup());
    }
    
    await Promise.all(cleanupPromises);
    
    this.providers.clear();
    this.activeProviders.clear();
    this.routingCapabilities.clear();
    this.healthStatus.clear();
    this.removeAllListeners();
    
    console.log('[Provider Manager] Cleanup completed');
  }
}

module.exports = ProviderManager;
