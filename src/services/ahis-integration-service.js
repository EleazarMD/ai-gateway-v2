/**
 * AHIS Integration Service for AI Gateway v2.0
 * Enhanced with official AHIS Client SDK v2.2.0
 * Handles integration with AI Homelab Infrastructure Services (AHIS) server
 * to discover platform-specific LLM providers, AI agents, and features
 */

// Fallback AHIS integration without SDK dependency for k3d compatibility
// const { EnhancedAHISClient, createEnhancedAHISClient, generateServiceId } = require('@ai-homelab/ahis-client-sdk');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class AHISIntegrationService extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.ahisUrl = config.ahisUrl || process.env.AHIS_URL || 'http://localhost:8404';
    this.syncInterval = config.syncInterval || 120000; // 2 minutes default
    this.apiKey = config.apiKey || process.env.API_KEY;
    this.enabled = config.enabled !== false; // Default enabled
    
    // Current state
    this.registeredServices = new Map();
    this.platformProviders = new Map();
    this.platformAgents = new Map();
    this.lastSyncTime = null;
    this.syncTimer = null;
    this.isHealthy = false;
    
    // Fallback HTTP client for AHIS communication (k3d compatibility)
    this.serviceId = `ai-gateway-v2-${uuidv4().substring(0, 8)}`;
    this.httpClient = axios.create({
      baseURL: this.ahisUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    });
    
    console.log(`[AHISIntegrationService] Initialized with fallback HTTP client (k3d compatibility)`);
    console.log(`[AHISIntegrationService] Service ID: ${this.serviceId}`);
    console.log(`[AHISIntegrationService] AHIS URL: ${this.ahisUrl}`);
  }

  /**
   * Start the AHIS integration service
   */
  async start() {
    if (!this.enabled) {
      console.log('[AHISIntegrationService] Service disabled, skipping start');
      return;
    }

    console.log('[AHISIntegrationService] Starting AHIS integration service...');
    
    try {
      // Register AI Gateway with AHIS
      await this.registerAIGateway();
      
      // Initial sync of platform services
      await this.syncPlatformServices();
      
      // Start periodic sync
      this.startPeriodicSync();
      
      this.isHealthy = true;
      this.emit('service_started', { timestamp: new Date().toISOString() });
      
      console.log('[AHISIntegrationService] AHIS integration service started successfully');
    } catch (error) {
      console.error('[AHISIntegrationService] Failed to register AI Gateway with Enhanced SDK:', error.message);
      this.emit('registration_error', { 
        error: error.message, 
        timestamp: new Date().toISOString() 
      });
      
      // Enhanced error handling with SDK diagnostics
      if (this.ahisClient && this.ahisClient.getConnectionStatus) {
        const connectionStatus = this.ahisClient.getConnectionStatus();
        console.error('[AHISIntegrationService] AHIS Client Connection Status:', connectionStatus);
      }
      
      throw error;
    }
  }

  /**
   * Stop the AHIS integration service
   */
  stop() {
    console.log('[AHISIntegrationService] Stopping AHIS integration service...');
    
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    this.isHealthy = false;
    this.emit('service_stopped', { timestamp: new Date().toISOString() });
    
    console.log('[AHISIntegrationService] AHIS integration service stopped');
  }

  /**
   * Register AI Gateway with AHIS server using Enhanced SDK
   */
  async registerAIGateway() {
    try {
      console.log('[AHISIntegrationService] Registering AI Gateway with Enhanced AHIS Client SDK...');
      
      // Fallback HTTP registration
      const registrationData = {
        id: this.serviceId,
        name: 'AI Gateway v2.0',
        type: 'AI_GATEWAY',
        version: '2.0.0',
        capabilities: [
          'llm_routing',
          'provider_management',
          'chat_completions',
          'streaming_responses',
          'model_discovery',
          'transparent_error_handling',
          'dashboard_integration',
          'api_key_management'
        ],
        endpoints: {
          health: '/health',
          info: '/api/v1/info',
          chat_completions: '/api/v1/chat/completions',
          models: '/api/v1/models',
          providers_status: '/api/v1/providers/status',
          routing_config: '/api/v1/config/routing',
          analytics: '/api/v1/analytics/routing',
          fallback_chains: '/api/v1/config/fallback/chains',
          comprehensive_health: '/api/v1/health/comprehensive'
        },
        ports: {
          primary: parseInt(process.env.EXTERNAL_PORT) || 8777,
          secondary: parseInt(process.env.INTERNAL_PORT) || 7777
        },
        metadata: {
          architecture: 'dual-port',
          external_port: parseInt(process.env.EXTERNAL_PORT) || 8777,
          internal_port: parseInt(process.env.INTERNAL_PORT) || 7777,
          protocols: ['http', 'websocket', 'grpc'],
          provider_types: ['openai', 'anthropic', 'google', 'ollama'],
          features: [
            'transparent_error_handling',
            'dashboard_integration',
            'api_key_management',
            'agent_specific_routing',
            'cost_optimization',
            'real_time_monitoring'
          ]
        },
        status: 'active'
      };
      
      const response = await this.httpClient.post('/api/v1/services/register', registrationData);
      const registrationResult = { success: response.data?.success, registrationId: response.data?.id };
      
      if (registrationResult.success) {
        console.log('[AHISIntegrationService] AI Gateway registered successfully with fallback HTTP client');
        console.log(`[AHISIntegrationService] Registration ID: ${registrationResult.registrationId}`);
        
        this.registeredServices.set('ai-gateway-v2', {
          serviceId: this.serviceId,
          registrationId: registrationResult.registrationId,
          registeredAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
          fallbackMode: true
        });
        
        this.emit('gateway_registered', { 
          serviceId: this.serviceId,
          registrationId: registrationResult.registrationId,
          timestamp: new Date().toISOString() 
        });
      } else {
        throw new Error(`Registration failed: ${registrationResult.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[AHISIntegrationService] Failed to register AI Gateway with Enhanced SDK:', error.message);
      this.emit('registration_error', { 
        error: error.message, 
        timestamp: new Date().toISOString() 
      });
      
      // Enhanced error handling with SDK diagnostics
      if (this.ahisClient && this.ahisClient.getConnectionStatus) {
        const connectionStatus = this.ahisClient.getConnectionStatus();
        console.error('[AHISIntegrationService] AHIS Client Connection Status:', connectionStatus);
      }
      
      throw error;
    }
  }

  /**
   * Legacy HTTP-based platform services sync (fallback)
   */
  async syncPlatformServicesLegacy() {
    try {
      console.log('[AHISIntegrationService] Using legacy HTTP sync as fallback...');
      
      // Create temporary HTTP client if needed
      const axios = require('axios');
      const httpClient = axios.create({
        baseURL: this.ahisUrl,
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        }
      });
      
      const response = await httpClient.get('/api/ahis/v1/services');
      
      if (response.status === 200 && response.data.success) {
        const services = response.data.services || [];
        const { providers, agents } = this.processServices(services);
        
        this.updatePlatformProviders(providers);
        this.updatePlatformAgents(agents);
        this.lastSyncTime = new Date();
        
        console.log(`[AHISIntegrationService] Legacy sync complete: ${providers.length} providers, ${agents.length} agents`);
        return { providers, agents };
      } else {
        throw new Error(`Legacy AHIS services fetch failed with status: ${response.status}`);
      }
    } catch (error) {
      console.error('[AHISIntegrationService] Legacy platform services sync failed:', error.message);
      throw error;
    }
  }

  /**
   * Start periodic synchronization with AHIS using Enhanced SDK
   */
  startPeriodicSync() {
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncPlatformServices();
        
        // Send heartbeat using Enhanced SDK
        if (this.ahisClient && this.ahisClient.sendHeartbeat) {
          await this.ahisClient.sendHeartbeat({
            status: 'healthy',
            metadata: {
              lastSync: this.lastSyncTime?.toISOString(),
              providersCount: this.platformProviders.size,
              agentsCount: this.platformAgents.size
            }
          });
        }
      } catch (error) {
        console.error('[AHISIntegrationService] Periodic sync failed:', error.message);
        this.emit('sync_error', { error: error.message, timestamp: new Date().toISOString() });
      }
    }, this.syncInterval);
    
    console.log(`[AHISIntegrationService] Enhanced SDK periodic sync started (interval: ${this.syncInterval}ms)`);
  }

  /**
   * Sync platform services from AHIS using Enhanced SDK
   */
  async syncPlatformServices() {
    try {
      console.log('[AHISIntegrationService] Syncing platform services using Enhanced AHIS Client SDK...');
      
      // Use Enhanced AHIS Client SDK for service discovery
      const discoveryResult = await this.ahisClient.discoverServices({
        serviceTypes: ['llm_provider', 'ai_agent', 'inference_service'],
        capabilities: ['chat_completions', 'text_generation', 'model_serving'],
        includeMetadata: true
      });
      
      if (discoveryResult.success) {
        const services = discoveryResult.services || [];
        
        // Process services to extract LLM providers and AI agents
        const { providers, agents } = this.processServices(services);
        
        // Update internal state
        this.updatePlatformProviders(providers);
        this.updatePlatformAgents(agents);
        
        this.lastSyncTime = new Date();
        
        this.emit('platform_sync_complete', {
          providersCount: providers.length,
          agentsCount: agents.length,
          timestamp: this.lastSyncTime.toISOString(),
          sdkVersion: '2.2.0'
        });
        
        console.log(`[AHISIntegrationService] Enhanced SDK sync complete: ${providers.length} providers, ${agents.length} agents`);
        
        return { providers, agents };
      } else {
        throw new Error(`AHIS service discovery failed: ${discoveryResult.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('[AHISIntegrationService] Enhanced SDK platform services sync failed:', error.message);
      
      // Fallback to legacy HTTP client if SDK fails
      console.log('[AHISIntegrationService] Attempting fallback to legacy HTTP sync...');
      return await this.syncPlatformServicesLegacy();
    }
  }

  /**
   * Process AHIS services to extract LLM providers and AI agents
   */
  processServices(services) {
    const providers = [];
    const agents = [];
    
    services.forEach(service => {
      // Identify LLM providers
      if (this.isLLMProvider(service)) {
        const provider = this.extractProviderInfo(service);
        if (provider) {
          providers.push(provider);
        }
      }
      
      // Identify AI agents
      if (this.isAIAgent(service)) {
        const agent = this.extractAgentInfo(service);
        if (agent) {
          agents.push(agent);
        }
      }
    });
    
    return { providers, agents };
  }

  /**
   * Check if service is an LLM provider
   */
  isLLMProvider(service) {
    const llmIndicators = [
      'llm',
      'language_model',
      'chat_completion',
      'text_generation',
      'ollama',
      'perplexity',
      'openai',
      'anthropic',
      'gemma',
      'llama'
    ];
    
    const capabilities = service.capabilities || [];
    const serviceType = (service.type || '').toLowerCase();
    const serviceName = (service.name || '').toLowerCase();
    
    return llmIndicators.some(indicator => 
      capabilities.some(cap => cap.toLowerCase().includes(indicator)) ||
      serviceType.includes(indicator) ||
      serviceName.includes(indicator)
    );
  }

  /**
   * Check if service is an AI agent
   */
  isAIAgent(service) {
    const agentIndicators = [
      'agent',
      'assistant',
      'bot',
      'ai_agent',
      'conversational',
      'intelligent'
    ];
    
    const capabilities = service.capabilities || [];
    const serviceType = (service.type || '').toLowerCase();
    const serviceName = (service.name || '').toLowerCase();
    
    return agentIndicators.some(indicator => 
      capabilities.some(cap => cap.toLowerCase().includes(indicator)) ||
      serviceType.includes(indicator) ||
      serviceName.includes(indicator)
    );
  }

  /**
   * Extract provider information from AHIS service
   */
  extractProviderInfo(service) {
    try {
      const metadata = service.metadata || {};
      const capabilities = service.capabilities || [];
      
      return {
        id: service.id,
        name: service.name,
        type: this.mapProviderType(service),
        enabled: service.status === 'active',
        priority: metadata.priority || 1,
        settings: {
          temperature: metadata.temperature,
          maxTokens: metadata.maxTokens || metadata.max_tokens,
          topP: metadata.topP || metadata.top_p,
          timeout: metadata.timeout || 30000,
          retryAttempts: metadata.retryAttempts || 3,
          streamingEnabled: metadata.streamingEnabled !== false,
          customHeaders: metadata.customHeaders || {}
        },
        capabilities: capabilities,
        models: metadata.models || metadata.supportedModels || [],
        endpoint: this.buildServiceEndpoint(service),
        apiKey: metadata.apiKey,
        lastUpdated: service.lastHeartbeat || service.registrationDate,
        source: 'ahis',
        serviceId: service.id,
        ports: service.ports || {}
      };
    } catch (error) {
      console.error(`[AHISIntegrationService] Error extracting provider info for ${service.id}:`, error.message);
      return null;
    }
  }

  /**
   * Extract agent information from AHIS service
   */
  extractAgentInfo(service) {
    try {
      const metadata = service.metadata || {};
      const capabilities = service.capabilities || [];
      
      return {
        id: service.id,
        name: service.name,
        type: 'ai_agent',
        enabled: service.status === 'active',
        capabilities: capabilities,
        specializations: metadata.specializations || [],
        supportedLanguages: metadata.supportedLanguages || ['en'],
        endpoint: this.buildServiceEndpoint(service),
        version: service.version,
        lastUpdated: service.lastHeartbeat || service.registrationDate,
        source: 'ahis',
        serviceId: service.id,
        ports: service.ports || {},
        metadata: metadata
      };
    } catch (error) {
      console.error(`[AHISIntegrationService] Error extracting agent info for ${service.id}:`, error.message);
      return null;
    }
  }

  /**
   * Map AHIS service to provider type
   */
  mapProviderType(service) {
    const serviceName = (service.name || '').toLowerCase();
    const serviceType = (service.type || '').toLowerCase();
    const metadata = service.metadata || {};
    
    if (serviceName.includes('ollama') || metadata.provider === 'ollama') {
      return 'ollama';
    } else if (serviceName.includes('perplexity') || metadata.provider === 'perplexity') {
      return 'perplexity';
    } else if (serviceName.includes('openai') || metadata.provider === 'openai') {
      return 'openai';
    } else if (serviceName.includes('anthropic') || metadata.provider === 'anthropic') {
      return 'anthropic';
    } else if (serviceName.includes('gemma') || metadata.provider === 'gemma') {
      return 'custom';
    } else {
      return 'custom';
    }
  }

  /**
   * Build service endpoint URL
   */
  buildServiceEndpoint(service) {
    const ports = service.ports || {};
    const primaryPort = ports.primary || ports.port || 8080;
    const host = service.host || 'localhost';
    const protocol = service.protocol || 'http';
    
    return `${protocol}://${host}:${primaryPort}`;
  }

  /**
   * Update platform providers
   */
  updatePlatformProviders(providers) {
    this.platformProviders.clear();
    providers.forEach(provider => {
      this.platformProviders.set(provider.id, provider);
    });
    
    this.emit('providers_updated', {
      count: providers.length,
      providers: providers.map(p => ({ id: p.id, name: p.name, type: p.type }))
    });
  }

  /**
   * Update platform agents
   */
  updatePlatformAgents(agents) {
    this.platformAgents.clear();
    agents.forEach(agent => {
      this.platformAgents.set(agent.id, agent);
    });
    
    this.emit('agents_updated', {
      count: agents.length,
      agents: agents.map(a => ({ id: a.id, name: a.name, capabilities: a.capabilities }))
    });
  }

  /**
   * Get all platform providers
   */
  getPlatformProviders() {
    return Array.from(this.platformProviders.values());
  }

  /**
   * Get platform provider by ID
   */
  getPlatformProvider(providerId) {
    return this.platformProviders.get(providerId);
  }

  /**
   * Get all platform agents
   */
  getPlatformAgents() {
    return Array.from(this.platformAgents.values());
  }

  /**
   * Get platform agent by ID
   */
  getPlatformAgent(agentId) {
    return this.platformAgents.get(agentId);
  }

  /**
   * Search providers by capability
   */
  findProvidersByCapability(capability) {
    return this.getPlatformProviders().filter(provider =>
      provider.capabilities.includes(capability)
    );
  }

  /**
   * Search agents by capability
   */
  findAgentsByCapability(capability) {
    return this.getPlatformAgents().filter(agent =>
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      healthy: this.isHealthy,
      lastSync: this.lastSyncTime,
      providersCount: this.platformProviders.size,
      agentsCount: this.platformAgents.size,
      ahisUrl: this.ahisUrl,
      syncInterval: this.syncInterval
    };
  }

  /**
   * Force immediate sync with AHIS
   */
  async forceSync() {
    console.log('[AHISIntegrationService] Forcing immediate AHIS sync...');
    return await this.syncPlatformServices();
  }
}

module.exports = AHISIntegrationService;
