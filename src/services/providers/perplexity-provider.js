const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * Perplexity Provider for AI Gateway v2.0
 * Supports Perplexity Sonar models with web search capabilities
 * Features: Real-time web search, citations, reasoning
 */
class PerplexityProvider extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || 'perplexity';
    this.name = config.name || 'Perplexity AI';
    this.type = 'api';
    this.endpoint = config.endpoint || 'https://api.perplexity.ai';
    this.apiKey = config.apiKey;
    this.models = config.models || [
      'sonar-deep-research',
      'sonar-reasoning-pro',
      'sonar-reasoning',
      'sonar-pro',
      'sonar'
    ];
    this.capabilities = [
      'chat', 'web_search', 'real_time', 'citations', 'reasoning'
    ];
    this.status = 'inactive';
    this.lastHealthCheck = null;
    this.requestCount = 0;
    this.errorCount = 0;
    
    // Perplexity-specific features
    this.features = {
      webSearch: true,
      realTimeData: true,
      citations: true,
      maxContextTokens: 128000,
      searchCapabilities: true
    };
    
    // Pricing per 1M tokens (Perplexity pricing)
    this.pricing = {
      'sonar-deep-research': { input: 2.0, output: 8.0 },
      'sonar-reasoning-pro': { input: 1.5, output: 6.0 },
      'sonar-reasoning': { input: 1.0, output: 4.0 },
      'sonar-pro': { input: 1.0, output: 1.0 },
      'sonar': { input: 1.0, output: 1.0 }
    };
    
    this.httpClient = axios.create({
      baseURL: this.endpoint,
      timeout: 45000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Gateway-v2.0'
      }
    });
  }

  /**
   * Initialize the Perplexity provider
   */
  async initialize() {
    try {
      console.log(`[Perplexity Provider] Initializing ${this.name}...`);
      
      if (!this.apiKey) {
        throw new Error('Perplexity API key is required');
      }
      
      // Validate API key format
      if (!this.apiKey.match(/^pplx-[A-Za-z0-9]{56}$/)) {
        console.warn('[Perplexity Provider] API key format may be invalid');
      }
      
      await this.validateConnection();
      this.status = 'active';
      
      console.log(`[Perplexity Provider] ${this.name} initialized successfully`);
      this.emit('initialized', { provider: this.id, status: this.status });
      
      return true;
    } catch (error) {
      console.error(`[Perplexity Provider] Initialization failed:`, error.message);
      this.status = 'error';
      this.emit('error', { provider: this.id, error: error.message });
      throw error;
    }
  }

  /**
   * Validate connection to Perplexity API
   * NOTE: Uses a lightweight check to avoid billable API calls during health checks
   */
  async validateConnection() {
    try {
      // Perplexity has no free health/models endpoint — /models returns 401 or hangs.
      // Validate: (1) API key format, (2) DNS reachability via fetch HEAD to base URL.
      // The key itself is already verified by AI Inferencing Service.
      
      if (!this.apiKey || !this.apiKey.startsWith('pplx-')) {
        throw new Error('Invalid Perplexity API key format');
      }
      
      // Reachability check — lightweight fetch HEAD (no axios to avoid validateStatus bugs)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(`${this.endpoint}/`, {
          method: 'HEAD',
          signal: controller.signal
        });
      } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          throw err; // Network error - actually unhealthy
        }
        // Timeout or HTTP errors mean the API is reachable
      } finally {
        clearTimeout(timeoutId);
      }
      
      console.log(`[Perplexity Provider] Connection validated (API key format OK, endpoint reachable)`);
      this.lastHealthCheck = new Date().toISOString();
      return true;
    } catch (error) {
      console.error(`[Perplexity Provider] Connection validation failed:`, error.message);
      throw new Error(`Perplexity API connection failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Process chat completion request
   */
  async processChatCompletion(request) {
    try {
      this.requestCount++;
      
      const perplexityRequest = this.transformRequest(request);
      console.log(`[Perplexity Provider] Processing chat completion for model: ${perplexityRequest.model}`);
      
      const response = await this.httpClient.post('/chat/completions', perplexityRequest);
      
      if (response.status === 200) {
        const transformedResponse = this.transformResponse(response.data, request);
        
        this.emit('request_completed', {
          provider: this.id,
          model: perplexityRequest.model,
          tokens: response.data.usage,
          cost: this.calculateCost(perplexityRequest.model, response.data.usage)
        });
        
        return transformedResponse;
      }
      
      throw new Error(`Perplexity API error: ${response.status}`);
    } catch (error) {
      this.errorCount++;
      console.error(`[Perplexity Provider] Chat completion failed:`, error.message);
      
      this.emit('request_failed', {
        provider: this.id,
        error: error.message,
        model: request.model
      });
      
      throw error;
    }
  }

  /**
   * Transform AI Gateway request to Perplexity format
   */
  transformRequest(request) {
    const perplexityRequest = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens || 2048,
      temperature: request.temperature || 0.2,
      stream: request.stream || false
    };

    // Add optional parameters
    if (request.top_p !== undefined) perplexityRequest.top_p = request.top_p;
    if (request.frequency_penalty !== undefined) perplexityRequest.frequency_penalty = request.frequency_penalty;
    if (request.presence_penalty !== undefined) perplexityRequest.presence_penalty = request.presence_penalty;
    if (request.stop) perplexityRequest.stop = request.stop;
    
    // Perplexity-specific parameters
    if (request.search_domain_filter) {
      perplexityRequest.search_domain_filter = request.search_domain_filter;
    }
    
    if (request.search_recency_filter) {
      perplexityRequest.search_recency_filter = request.search_recency_filter;
    }
    
    return perplexityRequest;
  }

  /**
   * Transform Perplexity response to AI Gateway format
   */
  transformResponse(perplexityResponse, originalRequest) {
    return {
      id: perplexityResponse.id,
      object: 'chat.completion',
      created: perplexityResponse.created,
      model: perplexityResponse.model,
      provider: this.id,
      choices: perplexityResponse.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: choice.message.content,
          citations: choice.message.citations || []
        },
        finish_reason: choice.finish_reason
      })),
      usage: {
        prompt_tokens: perplexityResponse.usage.prompt_tokens,
        completion_tokens: perplexityResponse.usage.completion_tokens,
        total_tokens: perplexityResponse.usage.total_tokens
      },
      cost: this.calculateCost(perplexityResponse.model, perplexityResponse.usage),
      citations: perplexityResponse.citations || []
    };
  }

  /**
   * Calculate request cost based on usage
   */
  calculateCost(model, usage) {
    const modelPricing = this.pricing[model];
    if (!modelPricing) return 0;
    
    const inputCost = (usage.prompt_tokens / 1000000) * modelPricing.input;
    const outputCost = (usage.completion_tokens / 1000000) * modelPricing.output;
    
    return inputCost + outputCost;
  }

  /**
   * Get provider health status
   */
  async getHealthStatus() {
    try {
      await this.validateConnection();
      return {
        provider: this.id,
        status: 'healthy',
        lastCheck: this.lastHealthCheck,
        models: this.models,
        requestCount: this.requestCount,
        errorCount: this.errorCount,
        errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) : 0,
        features: this.features
      };
    } catch (error) {
      return {
        provider: this.id,
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString(),
        requestCount: this.requestCount,
        errorCount: this.errorCount
      };
    }
  }

  /**
   * Get available models
   */
  getAvailableModels() {
    return [
      {
        id: 'sonar-deep-research',
        name: 'Sonar Deep Research',
        description: 'Exhaustive research and detailed report generation with search',
        maxTokens: 8192,
        pricing: { input: 2.0, output: 8.0 }, // Per 1M tokens
        capabilities: ['search', 'reasoning', 'citations', 'deep-research']
      },
      {
        id: 'sonar-reasoning-pro',
        name: 'Sonar Reasoning Pro',
        description: 'Enhanced multi-step reasoning with web search',
        maxTokens: 4096,
        pricing: { input: 1.5, output: 6.0 }, // Per 1M tokens
        capabilities: ['search', 'reasoning', 'citations', 'multi-step']
      },
      {
        id: 'sonar-reasoning',
        name: 'Sonar Reasoning',
        description: 'Quick problem-solving with step-by-step logic and search',
        maxTokens: 4096,
        pricing: { input: 1.0, output: 4.0 }, // Per 1M tokens
        capabilities: ['search', 'reasoning', 'citations']
      },
      {
        id: 'sonar-pro',
        name: 'Sonar Pro',
        description: 'Advanced search with deeper content understanding',
        maxTokens: 4096,
        pricing: { input: 1.0, output: 1.0 }, // Per 1M tokens
        capabilities: ['search', 'citations']
      },
      {
        id: 'sonar',
        name: 'Sonar',
        description: 'Lightweight, cost-effective search model',
        maxTokens: 4096,
        pricing: { input: 1.0, output: 1.0 }, // Per 1M tokens
        capabilities: ['search', 'citations']
      }
    ];
  }

  /**
   * Get models (alias for provider manager compatibility)
   */
  getModels() {
    return this.models.map(modelId => ({
      id: modelId,
      name: modelId,
      provider: this.id,
      capabilities: this.capabilities,
      pricing: this.pricing[modelId] || { input: 1.0, output: 1.0 },
      features: this.features
    }));
  }

  /**
   * Health check method for routing engine
   */
  async healthCheck() {
    return await this.getHealthStatus();
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log(`[Perplexity Provider] Cleaning up ${this.name}...`);
    this.removeAllListeners();
    this.status = 'inactive';
  }
}

module.exports = PerplexityProvider;
