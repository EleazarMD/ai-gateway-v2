const { EventEmitter } = require('events');
const axios = require('axios');

/**
 * Google Gemini Provider for AI Gateway v2.0
 * Supports Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash, and 1.5 models
 * Features: Vision, audio, video, function calling, code execution, thinking
 */
class GoogleProvider extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.id = config.id || config.name || 'google'; // CRITICAL: routing engine needs this
    this.name = config.name || 'google';
    this.type = 'google';
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.baseURL = config.baseURL || 'https://generativelanguage.googleapis.com/v1beta';
    this.isInitialized = false;
    this.isHealthy = false;
    
    // Model configurations with latest pricing and capabilities
    this.models = {
      'gemini-3-flash-preview': {
        id: 'models/gemini-3-flash-preview',
        name: 'Gemini 3 Flash Preview',
        description: 'Long-context specialist with 1M token window, optimized for speed',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.075,  // $0.075/MTok
        outputPricing: 0.30,  // $0.30/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'pdf', 'tools', 'code_execution', 'thinking', 'structured_output', 'long_context']
      },
      'gemini-2-5-pro': {
        id: 'models/gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'State-of-the-art thinking model for complex reasoning',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 1.25,   // $1.25/MTok
        outputPricing: 5.00,  // $5.00/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'pdf', 'tools', 'code_execution', 'thinking', 'structured_output']
      },
      'gemini-2-5-flash': {
        id: 'models/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Best price-performance model with thinking capabilities',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.075,  // $0.075/MTok
        outputPricing: 0.30,  // $0.30/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution', 'thinking', 'structured_output']
      },
      'gemini-2-5-flash-lite': {
        id: 'models/gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        description: 'Most cost-effective model for high-throughput tasks',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.0375, // $0.0375/MTok
        outputPricing: 0.15,  // $0.15/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'pdf', 'tools', 'code_execution', 'thinking', 'structured_output']
      },
      'gemini-2-0-flash': {
        id: 'models/gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        description: 'Balanced multimodal model built for the era of Agents',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.075,  // $0.075/MTok
        outputPricing: 0.30,  // $0.30/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution', 'image_generation']
      },
      'gemini-2-0-flash-lite': {
        id: 'models/gemini-2.0-flash-lite',
        name: 'Gemini 2.0 Flash-Lite',
        description: 'Smallest and most cost-effective model for scale',
        maxTokens: 65536,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.0375, // $0.0375/MTok
        outputPricing: 0.15,  // $0.15/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution']
      },
      'gemini-1-5-flash': {
        id: 'models/gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast and versatile performance across diverse tasks',
        maxTokens: 8192,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.075,  // $0.075/MTok
        outputPricing: 0.30,  // $0.30/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution']
      },
      'gemini-1-5-flash-8b': {
        id: 'models/gemini-1.5-flash-8b',
        name: 'Gemini 1.5 Flash-8B',
        description: 'High volume and lower intelligence tasks',
        maxTokens: 8192,
        contextWindow: 1048576, // 1M tokens
        inputPricing: 0.0375, // $0.0375/MTok
        outputPricing: 0.15,  // $0.15/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools']
      },
      'gemini-1-5-pro': {
        id: 'models/gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Mid-size multimodal model for scaling across tasks',
        maxTokens: 8192,
        contextWindow: 2097152, // 2M tokens
        inputPricing: 1.25,   // $1.25/MTok
        outputPricing: 5.00,  // $5.00/MTok
        capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution']
      }
    };

    this.defaultModel = config.defaultModel || 'gemini-3-flash-preview';
    this.requestTimeout = config.timeout || 120000; // 2 minutes
  }

  async initialize() {
    try {
      // Check if AI Inferencing is enabled - if so, we can initialize without an API key
      // because the key will be fetched at request time from AI Inferencing
      const aiInferencingEnabled = process.env.ENABLE_AI_INFERENCING !== 'false';
      
      if (!this.apiKey && !aiInferencingEnabled) {
        throw new Error('Google API key is required (set GOOGLE_API_KEY or enable AI Inferencing)');
      }

      if (this.apiKey) {
        // Test API connectivity only if we have a key
        await this.healthCheck();
      } else {
        // No key but AI Inferencing enabled - mark as available but untested
        console.log('[Google Provider] No API key configured, will use AI Inferencing for keys at request time');
      }
      
      this.isInitialized = true;
      this.isHealthy = true; // Assume healthy, will fail at request time if key is invalid
      
      this.emit('initialized', {
        provider: this.name,
        models: Object.keys(this.models),
        keySource: this.apiKey ? 'environment' : 'ai-inferencing',
        timestamp: new Date().toISOString()
      });

      return true;
    } catch (error) {
      this.isInitialized = false;
      this.isHealthy = false;
      this.emit('error', {
        provider: this.name,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async healthCheck() {
    try {
      const response = await axios.get(`${this.baseURL}/models`, {
        params: {
          key: this.apiKey
        },
        timeout: 10000
      });

      this.isHealthy = response.status === 200;
      return this.isHealthy;
    } catch (error) {
      this.isHealthy = false;
      throw new Error(`Google Gemini API health check failed: ${error.message}`);
    }
  }

  /**
   * Validate connection to Google Gemini API
   * Required by Provider Manager for provider initialization
   */
  async validateConnection() {
    try {
      console.log('[Google Provider] Validating connection...');
      
      if (!this.apiKey) {
        throw new Error('Google API key is required');
      }

      // Verify API key format
      if (!this.apiKey.startsWith('AIza') || this.apiKey.length < 35) {
        throw new Error('Invalid Google API key format');
      }

      // Test connection by listing models
      const response = await axios.get(`${this.baseURL}/models`, {
        params: {
          key: this.apiKey
        },
        timeout: 10000
      });

      if (response.status !== 200) {
        throw new Error(`API returned status ${response.status}`);
      }

      const models = response.data?.models || [];
      console.log(`[Google Provider] Connection validated, found ${models.length} models`);
      
      this.isHealthy = true;
      return true;
    } catch (error) {
      this.isHealthy = false;
      console.error('[Google Provider] Connection validation failed:', error.message);
      throw new Error(`Google Gemini API connection failed: ${error.message}`);
    }
  }

  getAvailableModels() {
    const models = Object.entries(this.models).map(([key, model]) => ({
      id: key,
      name: model.name,
      description: model.description,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow,
      capabilities: model.capabilities,
      pricing: {
        input: model.inputPricing,
        output: model.outputPricing,
        unit: 'MTok'
      },
      provider: 'Google Gemini' // Match health check response
    }));
    console.log(`[Google Provider] getAvailableModels() returning ${models.length} models`);
    return models;
  }

  async processChatCompletion(request) {
    try {
      // Use API key from AI Inferencing if provided, otherwise fall back to instance key
      const effectiveApiKey = request._inferencingKey?.provider === 'google' 
        ? request._inferencingKey.apiKey 
        : this.apiKey;
      
      if (!effectiveApiKey) {
        throw new Error('Google API key not available (neither from AI Inferencing nor environment)');
      }

      // Allow requests even if provider wasn't fully initialized (key came from AI Inferencing)
      if (!effectiveApiKey && (!this.isInitialized || !this.isHealthy)) {
        throw new Error('Google provider not initialized or unhealthy');
      }

      const modelConfig = this.models[request.model] || this.models[this.defaultModel];
      if (!modelConfig) {
        throw new Error(`Model ${request.model} not supported by Google provider`);
      }

      // Transform request to Gemini format
      const geminiRequest = this.transformRequest(request, modelConfig);
      
      this.emit('request', {
        provider: this.name,
        model: request.model,
        timestamp: new Date().toISOString()
      });

      const response = await axios.post(
        `${this.baseURL}/${modelConfig.id}:generateContent`,
        geminiRequest,
        {
          params: {
            key: effectiveApiKey
          },
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: this.requestTimeout
        }
      );

      // Transform response to standardized format
      const transformedResponse = this.transformResponse(response.data, request);
      
      this.emit('response', {
        provider: this.name,
        model: request.model,
        usage: transformedResponse.usage,
        timestamp: new Date().toISOString()
      });

      return transformedResponse;
    } catch (error) {
      // Log detailed error for debugging
      console.error('[Google Provider] Request failed:', {
        model: request.model,
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        geminiError: JSON.stringify(error.response?.data, null, 2)
      });
      
      this.emit('error', {
        provider: this.name,
        model: request.model,
        error: error.message,
        geminiDetails: error.response?.data,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  transformRequest(request, modelConfig) {
    const geminiRequest = {
      contents: [],
      generationConfig: {
        maxOutputTokens: Math.min(request.max_tokens || 4096, modelConfig.maxTokens),
        temperature: request.temperature || 0.7
      }
    };

    // Consolidate ALL system messages into one systemInstruction block
    // Gemini supports context caching via systemInstruction for repeated prompts
    const systemMessages = [];
    let messages = [];
    
    for (const msg of (request.messages || [])) {
      if (msg.role === 'system' && msg.content) {
        const text = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (text) systemMessages.push(text);
      } else {
        messages.push(msg);
      }
    }

    if (systemMessages.length > 0) {
      const consolidated = systemMessages.join('\n\n---\n\n');
      geminiRequest.systemInstruction = {
        parts: [{ text: consolidated }]
      };
      if (systemMessages.length > 1) {
        console.log(`[Google Provider] Consolidated ${systemMessages.length} system messages into systemInstruction`);
      }
    }

    // Transform messages to Gemini format
    let currentRole = null;
    let currentParts = [];

    for (const message of messages) {
      const role = message.role === 'assistant' ? 'model' : 'user';
      
      if (role !== currentRole) {
        if (currentParts.length > 0) {
          geminiRequest.contents.push({
            role: currentRole,
            parts: currentParts
          });
        }
        currentRole = role;
        currentParts = [];
      }

      if (typeof message.content === 'string') {
        currentParts.push({ text: message.content });
      } else if (Array.isArray(message.content)) {
        // Handle multimodal content
        for (const item of message.content) {
          if (item.type === 'text') {
            currentParts.push({ text: item.text });
          } else if (item.type === 'image_url') {
            // Convert base64 image/document to Gemini format
            const url = item.image_url.url;
            const base64Data = url.split(',')[1] || url;
            const mimeType = url.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
            
            console.log('[Google Provider] Processing multimodal content:', {
              mimeType,
              dataLength: base64Data?.length || 0,
              urlPrefix: url.substring(0, 50)
            });
            
            currentParts.push({
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            });
          }
        }
      }
    }

    // Add the last message
    if (currentParts.length > 0) {
      geminiRequest.contents.push({
        role: currentRole,
        parts: currentParts
      });
    }

    // Handle tools/functions
    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }))
      }];
    }

    // Handle thinking for supported models
    if (modelConfig.capabilities.includes('thinking') && request.thinking) {
      geminiRequest.generationConfig.responseSchema = {
        type: 'object',
        properties: {
          thinking: { type: 'string' },
          response: { type: 'string' }
        }
      };
    }

    return geminiRequest;
  }

  transformResponse(geminiResponse, originalRequest) {
    const response = {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: originalRequest.model,
      provider: this.name,
      choices: [],
      usage: {
        prompt_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
        completion_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0
      }
    };

    // Handle candidates
    if (geminiResponse.candidates && geminiResponse.candidates.length > 0) {
      const candidate = geminiResponse.candidates[0];
      
      let content = '';
      let toolCalls = [];

      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) {
            content += part.text;
          } else if (part.functionCall) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {})
              }
            });
          }
        }
      }

      const choice = {
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: this.mapFinishReason(candidate.finishReason)
      };

      if (toolCalls.length > 0) {
        choice.message.tool_calls = toolCalls;
      }

      response.choices.push(choice);
    }

    // Calculate cost
    const modelConfig = this.models[originalRequest.model];
    if (modelConfig && response.usage) {
      response.cost = this.calculateCost(modelConfig, response.usage);
    }

    return response;
  }

  mapFinishReason(geminiFinishReason) {
    const mapping = {
      'STOP': 'stop',
      'MAX_TOKENS': 'length',
      'SAFETY': 'content_filter',
      'RECITATION': 'content_filter',
      'OTHER': 'stop'
    };
    return mapping[geminiFinishReason] || 'stop';
  }

  calculateCost(modelConfig, usage) {
    const inputCost = (usage.prompt_tokens / 1000000) * modelConfig.inputPricing;
    const outputCost = (usage.completion_tokens / 1000000) * modelConfig.outputPricing;
    return {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
      currency: 'USD'
    };
  }

  getStatus() {
    return {
      name: this.name,
      type: this.type,
      initialized: this.isInitialized,
      healthy: this.isHealthy,
      models: Object.keys(this.models),
      capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'code_execution', 'thinking'],
      lastHealthCheck: new Date().toISOString()
    };
  }

  /**
   * Get available models (alias for routing engine compatibility)
   */
  getAvailableModels() {
    return Object.keys(this.models).map(model => ({
      id: model,
      name: model,
      provider: this.name,
      capabilities: this.models[model].capabilities,
      pricing: {
        input: this.models[model].inputPricing,
        output: this.models[model].outputPricing
      }
    }));
  }

  /**
   * Get models method required by Provider Manager
   * Returns list of available models in standardized format
   */
  getModels() {
    return Object.entries(this.models).map(([key, model]) => ({
      id: key,
      name: model.name,
      provider: this.name,
      type: 'chat',
      capabilities: model.capabilities,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow,
      pricing: {
        input: model.inputPricing,
        output: model.outputPricing,
        unit: 'MTok'
      }
    }));
  }

  /**
   * Health check method for routing engine
   */
  async healthCheck() {
    try {
      // Simple health check - verify API key format
      if (!this.apiKey || this.apiKey.length < 20) {
        throw new Error('Invalid Google API key');
      }
      
      return {
        provider: this.name,
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        models: Object.keys(this.models)
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  async updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    // Update relevant properties
    if (newConfig.apiKey) {
      this.apiKey = newConfig.apiKey;
    }
    if (newConfig.baseURL) {
      this.baseURL = newConfig.baseURL;
    }
    if (newConfig.defaultModel) {
      this.defaultModel = newConfig.defaultModel;
    }

    this.emit('configUpdated', {
      provider: this.name,
      oldConfig,
      newConfig: this.config,
      timestamp: new Date().toISOString()
    });

    // Re-initialize if critical config changed
    if (newConfig.apiKey || newConfig.baseURL) {
      await this.initialize();
    }
  }
}

module.exports = GoogleProvider;
