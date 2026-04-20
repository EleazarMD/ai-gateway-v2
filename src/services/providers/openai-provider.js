const axios = require('axios');
const { EventEmitter } = require('events');
const { Pool } = require('pg');

/**
 * OpenAI Provider for AI Gateway v2.0
 * Supports GPT-4.1, GPT-4.1-mini, GPT-4.1-nano, GPT-4o, GPT-3.5-turbo
 * Features: Prompt caching, vision, function calling, long context
 */
class OpenAIProvider extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || 'openai';
    this.name = config.name || 'OpenAI';
    this.type = 'api';
    this.endpoint = config.endpoint || 'https://api.openai.com/v1';
    this.apiKey = config.apiKey;
    
    // Database connection for model registry
    this.db = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: 'ai_inferencing_db',
      user: process.env.POSTGRES_USER || 'eleazar',
      password: process.env.POSTGRES_PASSWORD || '',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });
    
    // Models will be loaded from database during initialization
    this.models = config.models || [];
    this.capabilities = [
      'chat', 'reasoning', 'analysis', 'function_calling', 
      'vision', 'long_context'
    ];
    this.status = 'inactive';
    this.lastHealthCheck = null;
    this.requestCount = 0;
    this.errorCount = 0;
    
    // OpenAI-specific features
    this.features = {
      promptCaching: true,
      cachingDiscount: 0.75,
      maxContextTokens: 1000000,
      visionSupport: true,
      batchAPI: true
    };
    
    // Pricing per 1M tokens
    this.pricing = {
      'gpt-4.1': { input: 0.002, output: 0.008, cached: 0.0005 },
      'gpt-4.1-mini': { input: 0.0004, output: 0.0016, cached: 0.0001 },
      'gpt-4.1-nano': { input: 0.0001, output: 0.0004, cached: 0.000025 },
      'gpt-4o': { input: 0.005, output: 0.015, cached: 0.00125 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006, cached: 0.0000375 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015, cached: 0.000125 },
      // O1 series - reasoning models (no caching, no streaming, no function calling)
      'o1': { input: 15, output: 60 },
      'o1-pro': { input: 30, output: 120 },
      'o1-mini': { input: 3, output: 12 },
      'o1-preview': { input: 15, output: 60 },
      // O3 series - most powerful reasoning models (33% cheaper than o1-preview)
      'o3': { input: 10, output: 40 },
      'o3-mini': { input: 2, output: 8 },
      // O3/O4 Deep Research series - advanced reasoning with web search & code execution
      'o3-deep-research-2025-06-26': { input: 10, output: 40 },
      'o4-mini-deep-research-2025-06-26': { input: 2, output: 8 }
    };
    
    this.httpClient = axios.create({
      baseURL: this.endpoint,
      timeout: 300000, // 5 minutes for long script generation
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Gateway-v2.0'
      }
    });
  }

  /**
   * Initialize the OpenAI provider
   */
  async initialize() {
    try {
      console.log(`[OpenAI Provider] Initializing ${this.name}...`);
      
      if (!this.apiKey) {
        throw new Error('OpenAI API key is required');
      }
      
      // Check if this is a local endpoint (localhost or 127.0.0.1)
      const isLocalEndpoint = this.endpoint.includes('localhost') || this.endpoint.includes('127.0.0.1');
      
      // Validate API key format only for standard OpenAI API
      // Custom endpoints (z.ai, etc.) may use different key formats
      const isOpenAIEndpoint = this.endpoint.includes('api.openai.com');
      if (isOpenAIEndpoint && !this.apiKey.match(/^sk-[A-Za-z0-9-_]{20,}$/)) {
        throw new Error('Invalid OpenAI API key format');
      }
      
      // Load models from database
      await this.loadModelsFromDatabase();
      console.log(`[OpenAI Provider] Loaded ${this.models.length} models from database`);
      
      // Skip connection validation for local endpoints
      if (!isLocalEndpoint) {
        await this.validateConnection();
      } else {
        console.log(`[OpenAI Provider] Skipping connection validation for local endpoint`);
      }
      
      this.status = 'active';
      
      console.log(`[OpenAI Provider] ${this.name} initialized successfully`);
      this.emit('initialized', { provider: this.id, status: this.status });
      
      return true;
    } catch (error) {
      console.error(`[OpenAI Provider] Initialization failed:`, error.message);
      this.status = 'error';
      this.emit('error', { provider: this.id, error: error.message });
      throw error;
    }
  }

  /**
   * Load available models from database
   */
  async loadModelsFromDatabase() {
    // If models were explicitly configured (zhipu, minimax, etc), never overwrite them
    if (this._configModels && this._configModels.length > 0) {
      this.models = this._configModels;
      console.log('[OpenAI Provider] Preserving config models (not overwriting from DB):', this.models.join(', '));
      return;
    }
    try {
      // If models are explicitly configured (e.g., zhipu, custom endpoints), use those
      if (this.models && this.models.length > 0 && typeof this.models[0] === 'string') {
        this._configModels = [...this.models];  // Save original config models
        console.log(`[OpenAI Provider] Using ${this.models.length} models from config`);
        this.models.forEach(modelId => {
          if (!this.pricing[modelId]) {
            this.pricing[modelId] = { input: 0.0001, output: 0.0001 };
          }
        });
        return;
      }
      
      // Check if this is a local endpoint - if so, use config models
      const isLocalEndpoint = this.endpoint.includes('localhost') || this.endpoint.includes('127.0.0.1');
      
      if (isLocalEndpoint && this.models && this.models.length > 0) {
        // For local endpoints, use models from config and set minimal pricing
        console.log(`[OpenAI Provider] Using ${this.models.length} models from config for local endpoint`);
        // Set minimal pricing for local models (routing engine rejects 0)
        this.models.forEach(modelId => {
          if (!this.pricing[modelId]) {
            this.pricing[modelId] = { input: 0.0001, output: 0.0001 };
          }
        });
        return;
      }
      
      const result = await this.db.query(`
        SELECT 
          model_id,
          model_name,
          input_cost_per_1k_tokens,
          output_cost_per_1k_tokens,
          capabilities
        FROM provider_models
        WHERE provider_id = $1 AND is_active = true
        ORDER BY model_id
      `, [this.id]);
      
      if (result.rows.length === 0) {
        console.warn(`[OpenAI Provider] No models found in database, using defaults`);
        this.models = [
          'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo',
          'o1', 'o1-pro', 'o1-mini', 'o3', 'o3-mini'
        ];
        return;
      }
      
      // Update models list
      this.models = result.rows.map(row => row.model_id);
      
      // Update pricing from database
      result.rows.forEach(row => {
        if (row.input_cost_per_1k_tokens && row.output_cost_per_1k_tokens) {
          this.pricing[row.model_id] = {
            input: parseFloat(row.input_cost_per_1k_tokens),
            output: parseFloat(row.output_cost_per_1k_tokens)
          };
        }
      });
      
      console.log(`[OpenAI Provider] Database models:`, this.models.join(', '));
    } catch (error) {
      console.error(`[OpenAI Provider] Failed to load models from database:`, error.message);
      // Fall back to hardcoded models if database fails
      this.models = [
        'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo',
        'o1', 'o1-pro', 'o1-mini', 'o3', 'o3-mini'
      ];
      console.warn(`[OpenAI Provider] Using fallback hardcoded models`);
    }
  }

  /**
   * Get endpoint path for a specific model from database
   */
  async getEndpointForModel(modelId) {
    try {
      const result = await this.db.query(`
        SELECT pe.endpoint_path
        FROM model_endpoint_mapping mem
        JOIN provider_endpoints pe ON mem.endpoint_id = pe.endpoint_id
        WHERE mem.model_id = $1 AND mem.is_primary_endpoint = true
      `, [modelId]);
      
      if (result.rows.length > 0) {
        return result.rows[0].endpoint_path;
      }
      
      // Default fallback based on model naming
      if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
        return '/responses';  // Reasoning models use Responses API
      }
      
      return '/chat/completions';  // Standard chat models
    } catch (error) {
      console.error(`[OpenAI Provider] Failed to get endpoint for model ${modelId}:`, error.message);
      // Fallback logic
      if (modelId.startsWith('o1') || modelId.startsWith('o3')) {
        return '/responses';
      }
      return '/chat/completions';
    }
  }

  /**
   * Validate connection to OpenAI API
   */
  async validateConnection() {
    try {
      const response = await this.httpClient.get('/models');
      
      if (response.status === 200 && response.data.data) {
        const availableModels = response.data.data.map(model => model.id);
        console.log(`[OpenAI Provider] OpenAI API reports ${availableModels.length} models via /models endpoint`);
        
        // DON'T filter models loaded from database
        // Reasoning models (o1, o3 series) may not appear in /models API but are still accessible
        // Database is source of truth for model availability
        console.log(`[OpenAI Provider] Using ${this.models.length} models from database (not filtering)`);
        
        this.lastHealthCheck = new Date().toISOString();
        return true;
      }
      
      throw new Error('Invalid response from OpenAI API');
    } catch (error) {
      console.warn(`[OpenAI Provider] Connection validation skipped (endpoint may not support /models): ${error.message}`);
      // Don't throw - many OpenAI-compatible endpoints don't support /models
      // If we have config models, trust those
      if (this.models && this.models.length > 0) {
        this.lastHealthCheck = new Date().toISOString();
        return true;
      }
      throw new Error(`OpenAI API connection failed: ${error.message}`);
    }
  }

  /**
   * Process chat completion request
   */
  async processChatCompletion(request) {
    try {
      this.requestCount++;
      
      const openaiRequest = this.transformRequest(request);
      console.log(`[OpenAI Provider] Processing chat completion for model: ${openaiRequest.model}`);
      
      // Get correct endpoint from database
      const endpointPath = await this.getEndpointForModel(openaiRequest.model);
      console.log(`[OpenAI Provider] Using endpoint: ${endpointPath}`);
      
      // Use 5 minute timeout for all requests (long script generation, reasoning models, etc.)
      const timeout = parseInt(process.env.REQUEST_TIMEOUT) || 300000;
      
      console.log(`[OpenAI Provider] Request body: ${JSON.stringify(openaiRequest).substring(0, 300)}`); console.log(`[OpenAI Provider] Full URL: ${this.endpoint}${endpointPath}`);
      const response = await this.httpClient.post(endpointPath, openaiRequest, {
        timeout: timeout
      });
      
      if (response.status === 200) {
        // If upstream returned an error object, surface it cleanly
        if (response.data && response.data.error) {
          const errMsg = response.data.error.message || 'OpenAI API returned an error';
          throw new Error(errMsg);
        }

        const transformedResponse = this.transformResponse(response.data || {}, request);
        
        this.emit('request_completed', {
          provider: this.id,
          model: openaiRequest.model,
          tokens: response.data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          cost: this.calculateCost(openaiRequest.model, response.data?.usage || {})
        });
        
        return transformedResponse;
      }
      
      throw new Error(`OpenAI API error: ${response.status}`);
    } catch (error) {
      this.errorCount++;
      console.error(`[OpenAI Provider] Chat completion failed:`, error.message);
      
      this.emit('request_failed', {
        provider: this.id,
        error: error.message,
        model: request.model
      });
      
      throw error;
    }
  }

  /**
   * Transform AI Gateway request to OpenAI format
   */
  transformRequest(request) {
    const isO1Model = request.model.startsWith('o1');
    const isDeepResearchModel = request.model.includes('deep-research');
    const isReasoningModel = isO1Model || isDeepResearchModel;
    
    const openaiRequest = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature || 0.7,
      // Force stream: false for all models - AI Gateway will convert response to SSE
      // This is because axios doesn't handle SSE streaming responses correctly
      stream: false
    };

    // Add optional parameters (skip for reasoning models which have restrictions)
    if (!isReasoningModel) {
      if (request.top_p !== undefined) openaiRequest.top_p = request.top_p;
      if (request.frequency_penalty !== undefined) openaiRequest.frequency_penalty = request.frequency_penalty;
      if (request.presence_penalty !== undefined) openaiRequest.presence_penalty = request.presence_penalty;
      if (request.stop) openaiRequest.stop = request.stop;
      
      // Function calling support (NOT supported by O1)
      if (request.functions) {
        openaiRequest.functions = request.functions;
        if (request.function_call) openaiRequest.function_call = request.function_call;
      }
      
      // Tools support (newer format, NOT supported by O1)
      if (request.tools) {
        openaiRequest.tools = request.tools;
        if (request.tool_choice) openaiRequest.tool_choice = request.tool_choice;
      }
      
      // Vision support (NOT supported by O1)
      if (request.images && request.images.length > 0) {
        openaiRequest.messages = this.addImagesToMessages(openaiRequest.messages, request.images);
      }
    } else {
      // Reasoning model-specific handling
      if (isDeepResearchModel) {
        console.log(`[OpenAI Provider] Using Deep Research model: ${request.model} (with web search & code execution support)`);
      } else {
        console.log(`[OpenAI Provider] Using O1 reasoning model: ${request.model} (streaming, function calling, and vision disabled)`);
      }
    }
    
    return openaiRequest;
  }

  /**
   * Transform OpenAI response to AI Gateway format
   */
  transformResponse(openaiResponse, originalRequest) {
    // Defensive parsing for error or incomplete payloads
    if (openaiResponse && openaiResponse.error) {
      throw new Error(openaiResponse.error.message || 'OpenAI API error');
    }
    const choicesArray = Array.isArray(openaiResponse?.choices) ? openaiResponse.choices : [];
    const usage = openaiResponse?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return {
      id: openaiResponse.id,
      object: 'chat.completion',
      created: openaiResponse.created,
      model: openaiResponse.model,
      provider: this.id,
      choices: choicesArray.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          // MiniMax/DeepSeek reasoning models return reasoning_content instead of content
          content: choice.message.content || null,  // do NOT fall back to reasoning_content — SSE emits reasoning separately
          reasoning_content: choice.message.reasoning_content,
          function_call: choice.message.function_call,
          tool_calls: choice.message.tool_calls
        },
        finish_reason: choice.finish_reason
      })),
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
        cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0
      },
      cost: this.calculateCost(openaiResponse.model, usage)
    };
  }

  /**
   * Add images to messages for vision support
   */
  addImagesToMessages(messages, images) {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      const content = [
        { type: 'text', text: lastMessage.content }
      ];
      
      images.forEach(image => {
        content.push({
          type: 'image_url',
          image_url: {
            url: image.url || `data:${image.mime_type};base64,${image.data}`,
            detail: image.detail || 'auto'
          }
        });
      });
      
      lastMessage.content = content;
    }
    
    return messages;
  }

  /**
   * Calculate request cost based on usage
   */
  calculateCost(model, usage) {
    const modelPricing = this.pricing[model];
    if (!modelPricing) return 0;
    
    const inputCost = (usage.prompt_tokens / 1000000) * modelPricing.input;
    const outputCost = (usage.completion_tokens / 1000000) * modelPricing.output;
    const cachedCost = (usage.prompt_tokens_details?.cached_tokens || 0) / 1000000 * modelPricing.cached;
    
    return inputCost + outputCost - cachedCost; // Subtract cached savings
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
        errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) : 0
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
  getModels() {
    return this.models.map(model => ({
      id: model,
      name: model,
      provider: this.id,
      capabilities: this.capabilities,
      pricing: this.pricing[model],
      features: this.features
    }));
  }

  /**
   * Get available models (alias for routing engine compatibility)
   */
  getAvailableModels() {
    return this.getModels();
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
    console.log(`[OpenAI Provider] Cleaning up ${this.name}...`);
    this.removeAllListeners();
    this.status = 'inactive';
    
    // Close database connection
    if (this.db) {
      await this.db.end();
    }
  }
}

module.exports = OpenAIProvider;
