const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * OpenAI OSS Provider for AI Gateway v2.0
 * Supports gpt-oss models via Ollama API with Harmony format handling
 * Features: Chain-of-thought reasoning, local inference, automatic safety filtering
 */
class OpenAIOSSProvider extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || 'openai-oss';
    this.name = config.name || 'Ollama Open Source Models';
    this.type = 'ollama_compatible';
    this.endpoint = config.endpoint || `${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api`;
    this.models = config.models || [
      'llama3:latest', 'llama3.1:8b', 'llama3.1:70b',
      'medgemma:latest', 'medgemma:7b', 'medgemma:2b',
      'openai-oss:latest', 'openai-oss:8b', 'openai-oss:70b',
      'qwen:latest', 'qwen2:7b', 'qwen2:72b',
      'codellama:latest', 'codellama:7b', 'codellama:13b',
      'mistral:latest', 'mistral:7b', 'mixtral:8x7b',
      'phi3:latest', 'phi3:mini', 'phi3:medium'
    ];
    this.capabilities = [
      'chat', 'reasoning', 'analysis', 'function_calling', 'chain_of_thought'
    ];
    this.status = 'inactive';
    this.lastHealthCheck = null;
    this.requestCount = 0;
    this.errorCount = 0;
    
    // OpenAI OSS specific features
    this.features = {
      harmonyFormatHandled: true,
      reasoningLevels: ['low', 'medium', 'high'],
      chainOfThought: true,
      localInference: true,
      safetyFiltering: true
    };
    
    // Harmony format configuration
    this.harmonyFormat = {
      specialTokens: {
        start: '<|start|>',
        message: '<|message|>',
        end: '<|end|>',
        channel: '<|channel|>',
        call: '<|call|>',
        return: '<|return|>'
      },
      channels: {
        analysis: 'chain-of-thought reasoning (filtered by Ollama)',
        final: 'user-facing response content'
      },
      messageStructure: '<|start|>{header}<|message|>{content}<|end|>',
      reasoningControl: 'System message: \'Reasoning: [low|medium|high]\''
    };
    
    this.httpClient = axios.create({
      baseURL: this.endpoint,
      timeout: 120000, // Longer timeout for local inference
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Gateway-v2.0'
      }
    });
  }

  /**
   * Initialize the OpenAI OSS provider
   */
  async initialize() {
    try {
      console.log(`[OpenAI OSS Provider] Initializing ${this.name}...`);
      
      await this.validateConnection();
      this.status = 'active';
      
      console.log(`[OpenAI OSS Provider] ${this.name} initialized successfully`);
      this.emit('initialized', { provider: this.id, status: this.status });
      
      return true;
    } catch (error) {
      console.error(`[OpenAI OSS Provider] Initialization failed:`, error.message);
      this.status = 'error';
      this.emit('error', { provider: this.id, error: error.message });
      throw error;
    }
  }

  /**
   * Validate connection to Ollama API
   */
  async validateConnection() {
    try {
      // First try to get available models from /api/tags
      try {
        const tagsResponse = await this.httpClient.get('/tags');
        if (tagsResponse.status === 200 && tagsResponse.data && tagsResponse.data.models) {
          this.models = tagsResponse.data.models.map(model => model.name);
          console.log(`[OpenAI OSS Provider] Fetched ${this.models.length} models from Ollama: ${this.models.join(', ')}`);
        } else {
          throw new Error('No models returned from /api/tags');
        }
      } catch (tagsError) {
        console.warn(`[OpenAI OSS Provider] Could not fetch models from /api/tags: ${tagsError.message}`);
        // Fallback to known models
        this.models = ['llama3.2:3b', 'gemma2:2b'];
        console.log(`[OpenAI OSS Provider] Using fallback models: ${this.models.join(', ')}`);
      }
      
      // Test with generate endpoint to validate connection
      const testResponse = await this.httpClient.post('/generate', {
        model: this.models[0], // Use first available model
        prompt: 'test',
        stream: false
      });
      
      if (testResponse.status === 200) {
        console.log(`[OpenAI OSS Provider] Ollama connection validated via generate endpoint`);
        console.log(`[OpenAI OSS Provider] Available models: ${this.models.length}`);
        
        this.lastHealthCheck = new Date().toISOString();
        return true;
      }
      
      throw new Error('Invalid response from Ollama API');
    } catch (error) {
      console.error(`[OpenAI OSS Provider] Connection validation failed:`, error.message);
      throw new Error(`Ollama API connection failed: ${error.message}`);
    }
  }

  

  /**
   * Transform AI Gateway request to Ollama format with Harmony support
   */
  transformRequest(request) {
    const ollamaRequest = {
      model: request.model,
      messages: this.prepareMessagesWithReasoning(request.messages, request.reasoning),
      stream: request.stream || false,
      options: {
        temperature: request.temperature || 0.7,
        top_p: request.top_p || 0.9,
        max_tokens: request.max_tokens || 4096
      }
    };

    // Add reasoning level control
    if (request.reasoning && ['low', 'medium', 'high'].includes(request.reasoning)) {
      // Ollama will handle Harmony format internally
      console.log(`[OpenAI OSS Provider] Using reasoning level: ${request.reasoning}`);
    }
    
    return ollamaRequest;
  }

  /**
   * Process chat completion request
   */
  async processChatCompletion(request) {
    try {
      this.requestCount++;
      
      const ollamaRequest = this.transformRequest(request);
      console.log(`[OpenAI OSS Provider] Processing chat completion for model: ${ollamaRequest.model}`);
      
      const response = await this.httpClient.post('/chat', ollamaRequest);
      
      if (response.status === 200) {
        const transformedResponse = this.transformResponse(response.data, request);
        
        this.emit('request_completed', {
          provider: this.id,
          model: ollamaRequest.model,
          reasoning: transformedResponse.reasoning || 'medium',
          localInference: true
        });
        
        return transformedResponse;
      }
      
      throw new Error(`Ollama API error: ${response.status}`);
    } catch (error) {
      this.errorCount++;
      console.error(`[OpenAI OSS Provider] Chat completion failed:`, error.message);
      
      this.emit('request_failed', {
        provider: this.id,
        error: error.message,
        model: request.model
      });
      
      throw error;
    }
  }

  /**
   * Prepare messages with reasoning level control
   */
  prepareMessagesWithReasoning(messages, reasoningLevel = 'medium') {
    const preparedMessages = [...messages];
    
    // Add or update system message with reasoning control
    const systemMessageIndex = preparedMessages.findIndex(msg => msg.role === 'system');
    const reasoningInstruction = `Reasoning: ${reasoningLevel}`;
    
    if (systemMessageIndex >= 0) {
      // Append to existing system message
      preparedMessages[systemMessageIndex].content += `\n\n${reasoningInstruction}`;
    } else {
      // Add new system message at the beginning
      preparedMessages.unshift({
        role: 'system',
        content: reasoningInstruction
      });
    }
    
    return preparedMessages;
  }

  /**
   * Transform Ollama response to AI Gateway format
   */
  transformResponse(ollamaResponse, originalRequest) {
    // Ollama handles Harmony format internally and returns clean response
    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: ollamaResponse.model,
      provider: this.id,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: ollamaResponse.message?.content || ollamaResponse.response
        },
        finish_reason: ollamaResponse.done ? 'stop' : 'length'
      }],
      usage: {
        prompt_tokens: ollamaResponse.prompt_eval_count || 0,
        completion_tokens: ollamaResponse.eval_count || 0,
        total_tokens: (ollamaResponse.prompt_eval_count || 0) + (ollamaResponse.eval_count || 0)
      },
      reasoning: originalRequest.reasoning || 'medium',
      harmonyHandled: true,
      localInference: true
    };

    // Add performance metrics if available
    if (ollamaResponse.total_duration) {
      response.performance = {
        total_duration: ollamaResponse.total_duration,
        load_duration: ollamaResponse.load_duration,
        prompt_eval_duration: ollamaResponse.prompt_eval_duration,
        eval_duration: ollamaResponse.eval_duration
      };
    }
    
    return response;
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
  getModels() {
    return this.models.map(model => ({
      id: model,
      name: model,
      provider: this.id,
      capabilities: this.capabilities,
      features: this.features,
      pricing: {
        input: 0,
        output: 0,
        unit: 'free'
      }
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
   * Pull/download a model if not available
   */
  async pullModel(modelName) {
    try {
      console.log(`[OpenAI OSS Provider] Pulling model: ${modelName}`);
      
      const response = await this.httpClient.post('/pull', {
        name: modelName,
        stream: false
      });
      
      if (response.status === 200) {
        console.log(`[OpenAI OSS Provider] Model ${modelName} pulled successfully`);
        
        // Refresh available models
        await this.validateConnection();
        
        this.emit('model_pulled', {
          provider: this.id,
          model: modelName,
          status: 'success'
        });
        
        return true;
      }
      
      throw new Error(`Failed to pull model: ${response.status}`);
    } catch (error) {
      console.error(`[OpenAI OSS Provider] Model pull failed:`, error.message);
      
      this.emit('model_pull_failed', {
        provider: this.id,
        model: modelName,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log(`[OpenAI OSS Provider] Cleaning up ${this.name}...`);
    this.removeAllListeners();
    this.status = 'inactive';
  }
}

module.exports = OpenAIOSSProvider;
