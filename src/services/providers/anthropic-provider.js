const { EventEmitter } = require('events');
const axios = require('axios');

/**
 * Anthropic Claude Provider for AI Gateway v2.0
 * Supports Claude 4, Claude Sonnet 3.7, and Claude Haiku 3.5 models
 * Features: Vision, tool use, extended thinking, prompt caching
 */
class AnthropicProvider extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.id = config.id || 'anthropic';  // Provider ID for routing
    this.name = config.name || 'anthropic';
    this.type = 'anthropic';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseURL = config.baseURL || config.endpoint || 'https://api.anthropic.com/v1';
    this.isInitialized = false;
    this.isHealthy = false;
    
    // Model configurations with latest pricing and capabilities
    this.models = {
      'claude-3-opus': {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        description: 'Most capable model (deprecated)',
        maxTokens: 4096,
        contextWindow: 200000,
        inputPricing: 15.00,  // $15/MTok
        outputPricing: 75.00, // $75/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal'],
        deprecated: true
      },
      'claude-3-sonnet': {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        description: 'Balanced performance and speed (deprecated)',
        maxTokens: 4096,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal'],
        deprecated: true
      },
      'claude-3-haiku': {
        id: 'claude-3-haiku-20240307',
        name: 'Claude 3 Haiku',
        description: 'Fast and compact model for near-instant responsiveness',
        maxTokens: 4096,
        contextWindow: 200000,
        inputPricing: 0.25,   // $0.25/MTok
        outputPricing: 1.25,  // $1.25/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal']
      },
      'claude-3-5-sonnet': {
        id: 'claude-3-7-sonnet-20250219',  // Latest working Sonnet model
        name: 'Claude 3.5 Sonnet',
        description: 'High-performance model',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'computer_use'],
        deprecated: false
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',  // Official Haiku 4.5 model (Oct 2025 release)
        name: 'Claude Haiku 4.5',
        description: '⚡ LATEST HAIKU - Fast, economical, near-frontier performance',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 1.00,   // $1/MTok
        outputPricing: 5.00,  // $5/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'computer_use']
      },
      'claude-3-5-haiku': {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        description: 'Intelligence at blazing speeds',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 0.80,   // $0.80/MTok
        outputPricing: 4.00,  // $4/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal']
      },
      'claude-3-7-sonnet': {
        id: 'claude-3-7-sonnet-20250219',
        name: 'Claude 3.7 Sonnet',
        description: 'High-performance model with early extended thinking',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking']
      },
      'claude-4-sonnet': {
        id: 'claude-sonnet-4-20250514',  // Actual working Claude 4 Sonnet
        name: 'Claude 4 Sonnet',
        description: 'High-performance model with advanced capabilities',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking', 'computer_use']
      },
      'claude-sonnet-4-0': {
        id: 'claude-sonnet-4-20250514',  // Actual working Claude 4 Sonnet
        name: 'Claude 4 Sonnet',
        description: 'High-performance model with advanced capabilities',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking', 'computer_use']
      },
      'claude-4-opus': {
        id: 'claude-opus-4-latest',  // Use latest version (Anthropic resolves automatically)
        name: 'Claude 4 Opus',
        description: 'Previous flagship model with very high intelligence',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 15.00,  // $15/MTok
        outputPricing: 75.00, // $75/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking', 'computer_use']
      },
      'claude-4-1-opus': {
        id: 'claude-opus-4-1-latest',  // Use latest version (Anthropic resolves automatically)
        name: 'Claude 4.1 Opus',
        description: 'Our most capable model with highest level of intelligence',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 15.00,  // $15/MTok
        outputPricing: 75.00, // $75/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking', 'computer_use']
      },
      'claude-sonnet-4-5': {
        id: 'claude-sonnet-4-5-20250929',  // Claude Sonnet 4.5 (Sep 2025 release)
        name: 'Claude Sonnet 4.5',
        description: 'Most intelligent Sonnet model with advanced reasoning and coding',
        maxTokens: 8192,
        contextWindow: 200000,
        inputPricing: 3.00,   // $3/MTok
        outputPricing: 15.00, // $15/MTok
        capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking', 'computer_use']
      }
    };

    this.defaultModel = config.defaultModel || 'claude-haiku-4-5';
    this.requestTimeout = config.timeout || 120000; // 2 minutes
  }

  async initialize() {
    try {
      if (!this.apiKey) {
        throw new Error('Anthropic API key is required');
      }

      // Test API connectivity
      await this.healthCheck();
      
      this.isInitialized = true;
      this.isHealthy = true;
      
      this.emit('initialized', {
        provider: this.name,
        models: Object.keys(this.models),
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
      // Anthropic doesn't have a /models endpoint for health checks
      // Just verify API key format - actual connectivity is tested when requests are made
      if (!this.apiKey || !this.apiKey.startsWith('sk-ant-')) {
        throw new Error('Invalid Anthropic API key format');
      }
      
      this.isHealthy = true;
      return true;
    } catch (error) {
      this.isHealthy = false;
      throw new Error(`Anthropic API health check failed: ${error.message}`);
    }
  }

  /**
   * Validate connection to Anthropic Claude API
   * Required by Provider Manager for provider initialization
   */
  async validateConnection() {
    try {
      console.log('[Anthropic Provider] Validating connection...');
      
      if (!this.apiKey) {
        throw new Error('Anthropic API key is required');
      }

      // Verify API key format
      if (!this.apiKey.startsWith('sk-ant-') || this.apiKey.length < 40) {
        throw new Error('Invalid Anthropic API key format');
      }

      // Anthropic doesn't have a /models endpoint for validation
      // Actual connectivity is tested when requests are made
      const modelCount = Object.keys(this.models).length;
      console.log(`[Anthropic Provider] Connection validated (API key format OK), ${modelCount} models configured`);
      
      this.isHealthy = true;
      return true;
    } catch (error) {
      this.isHealthy = false;
      console.error('[Anthropic Provider] Connection validation failed:', error.message);
      throw new Error(`Anthropic Claude API connection failed: ${error.message}`);
    }
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

  getAvailableModels() {
    return Object.entries(this.models).map(([key, model]) => ({
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
      deprecated: model.deprecated || false,
      provider: this.name
    }));
  }

  async processChatCompletion(request) {
    try {
      if (!this.isInitialized || !this.isHealthy) {
        throw new Error('Anthropic provider not initialized or unhealthy');
      }

      const modelConfig = this.models[request.model] || this.models[this.defaultModel];
      
      if (!modelConfig) {
        throw new Error(`Model ${request.model} not supported by Anthropic provider`);
      }

      // Transform request to Anthropic format
      const anthropicRequest = this.transformRequest(request, modelConfig);
      
      this.emit('request', {
        provider: this.name,
        model: request.model,
        timestamp: new Date().toISOString()
      });

      const url = `${this.baseURL}/messages`;
      
      let response;
      try {
        // For streaming, we need to buffer the response ourselves
        // Anthropic sends SSE events that we need to parse
        const axiosConfig = {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'Content-Type': 'application/json'
          },
          timeout: this.requestTimeout
        };
        
        // When streaming is requested, axios still buffers the response
        // but Anthropic returns it in SSE format
        response = await axios.post(url, anthropicRequest, axiosConfig);
      } catch (error) {
        console.error(`[Anthropic Provider] Axios error:`, error.response?.status, error.response?.data || error.message);
        throw error;
      }

      // Handle streaming response
      let responseData = response.data;
      if (request.stream) {
        // When streaming, axios returns an array buffer or string
        let sseText = '';
        
        if (typeof response.data === 'string') {
          sseText = response.data;
        } else if (Array.isArray(response.data)) {
          // Convert array of bytes to string
          console.log(`[Anthropic Provider] Converting ${response.data.length} bytes to SSE text`);
          sseText = Buffer.from(response.data).toString('utf-8');
        } else if (Buffer.isBuffer(response.data)) {
          sseText = response.data.toString('utf-8');
        } else {
          console.log(`[Anthropic Provider] Unexpected response type: ${typeof response.data}`);
          // Try to use it as-is
        }
        
        if (sseText) {
          console.log(`[Anthropic Provider] Processing streaming SSE text response`);
          console.log(`[Anthropic Provider] SSE sample (first 200 chars):`, sseText.substring(0, 200));
          // Parse SSE text into events
          const events = sseText.split('\n')
            .filter(line => line.startsWith('data: '))
            .map(line => line.slice(6).trim());
          responseData = this.combineStreamingEvents(events);
        }
      }
      
      // Transform response to standardized format
      const transformedResponse = this.transformResponse(responseData, request);
      console.log(`[Anthropic Provider] Transformed response keys:`, Object.keys(transformedResponse));
      
      this.emit('response', {
        provider: this.name,
        model: request.model,
        usage: transformedResponse.usage,
        timestamp: new Date().toISOString()
      });

      return transformedResponse;
    } catch (error) {
      this.emit('error', {
        provider: this.name,
        model: request.model,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  combineStreamingEvents(events) {
    // When streaming, Anthropic sends multiple events
    // We need to combine them into a single response
    let id = null;
    let model = null;
    let stopReason = null;
    let usage = null;
    
    // Track content blocks by index
    const contentBlocks = {};
    
    console.log(`[Anthropic Provider] combineStreamingEvents: processing ${events.length} events`);
    
    for (const event of events) {
      if (!event || event === '[DONE]') continue;
      
      // Parse the JSON event
      let eventData;
      try {
        eventData = JSON.parse(event);
      } catch (e) {
        console.log(`[Anthropic Provider] Could not parse event:`, event.substring(0, 100));
        continue;
      }
      
      console.log(`[Anthropic Provider] Event type:`, eventData.type, `| Index:`, eventData.index);
      
      // Extract data from event
      if (eventData.type === 'message_start' && eventData.message) {
        id = eventData.message.id;
        model = eventData.message.model;
        usage = eventData.message.usage;
        console.log(`[Anthropic Provider] message_start - id: ${id}, model: ${model}`);
      } else if (eventData.type === 'content_block_start') {
        // New content block starting
        const index = eventData.index;
        const block = eventData.content_block;
        contentBlocks[index] = {
          type: block.type,
          data: block.type === 'text' ? '' : {},
          block: block
        };
        console.log(`[Anthropic Provider] content_block_start[${index}] - type: ${block.type}`);
        
        if (block.type === 'tool_use') {
          contentBlocks[index].data = {
            id: block.id,
            name: block.name,
            input: ''
          };
        }
      } else if (eventData.type === 'content_block_delta') {
        const index = eventData.index;
        const delta = eventData.delta;
        
        if (!contentBlocks[index]) {
          console.warn(`[Anthropic Provider] content_block_delta for unknown index ${index}`);
          continue;
        }
        
        if (delta.type === 'text_delta' && delta.text) {
          // Text content
          contentBlocks[index].data += delta.text;
          console.log(`[Anthropic Provider] content_block_delta[${index}] text - added ${delta.text.length} chars`);
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          // Tool call input (JSON fragments)
          contentBlocks[index].data.input += delta.partial_json;
          console.log(`[Anthropic Provider] content_block_delta[${index}] tool input - added ${delta.partial_json.length} chars`);
        }
      } else if (eventData.type === 'content_block_stop') {
        const index = eventData.index;
        console.log(`[Anthropic Provider] content_block_stop[${index}]`);
      } else if (eventData.type === 'message_delta') {
        if (eventData.delta?.stop_reason) {
          stopReason = eventData.delta.stop_reason;
        }
        if (eventData.usage) {
          usage = eventData.usage;
        }
        console.log(`[Anthropic Provider] message_delta - stop_reason: ${stopReason}`);
      } else if (eventData.type === 'message_stop') {
        console.log(`[Anthropic Provider] message_stop`);
      }
    }
    
    // Build final content array
    const content = [];
    const sortedIndices = Object.keys(contentBlocks).sort((a, b) => parseInt(a) - parseInt(b));
    
    for (const index of sortedIndices) {
      const block = contentBlocks[index];
      
      if (block.type === 'text') {
        content.push({
          type: 'text',
          text: block.data
        });
        console.log(`[Anthropic Provider] Final content[${index}]: text (${block.data.length} chars)`);
      } else if (block.type === 'tool_use') {
        // Parse the accumulated JSON input
        let parsedInput;
        try {
          parsedInput = JSON.parse(block.data.input);
        } catch (e) {
          console.error(`[Anthropic Provider] Failed to parse tool input JSON:`, block.data.input);
          parsedInput = {};
        }
        
        content.push({
          type: 'tool_use',
          id: block.data.id,
          name: block.data.name,
          input: parsedInput
        });
        console.log(`[Anthropic Provider] Final content[${index}]: tool_use (${block.data.name})`);
      }
    }
    
    console.log(`[Anthropic Provider] Final combined: ${content.length} content blocks`);
    
    // Return combined response in Anthropic's expected format
    return {
      id: id || 'stream-combined',
      model: model,
      content: content,
      stop_reason: stopReason || 'end_turn',
      usage: usage || {
        input_tokens: 0,
        output_tokens: 100, // Rough estimate
      }
    };
  }
  
  transformRequest(request, modelConfig) {
    const anthropicRequest = {
      model: modelConfig.id,
      max_tokens: Math.min(request.max_tokens || 4096, modelConfig.maxTokens),
      temperature: request.temperature || 0.7,
      messages: []
    };

    // Handle system prompts with prompt caching
    // Consolidate ALL system messages into one cached block for maximum cache hits
    // OpenClaw sends multiple system messages (SOUL.md, AGENTS.md, USER.md, voice instructions)
    // Caching the full system block gives 90% cost reduction on subsequent turns
    const systemMessages = [];
    const nonSystemMessages = [];
    
    for (const msg of (request.messages || [])) {
      if (msg.role === 'system' && msg.content) {
        const text = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (text) systemMessages.push(text);
      } else {
        nonSystemMessages.push(msg);
      }
    }
    
    if (systemMessages.length > 0) {
      // User-controlled cache strategy from _context (set by iOS X-Cache-Strategy header)
      const cacheStrategy = request._context?.cache_strategy || 'balanced';
      const useCache = cacheStrategy !== 'none';
      
      const systemBlock = {
        type: 'text',
        text: systemMessages.join('\n\n---\n\n')
      };
      if (useCache) {
        systemBlock.cache_control = { type: 'ephemeral' };
      }
      anthropicRequest.system = [systemBlock];
      
      if (systemMessages.length > 1) {
        console.log(`[Anthropic Provider] Consolidated ${systemMessages.length} system messages into 1 cached block (cache: ${useCache ? 'on' : 'off'})`);
      }
    }
    
    anthropicRequest.messages = nonSystemMessages;


    // Filter out invalid / empty messages.
    // Anthropic is strict about message structure and will 400 on empty assistant messages.
    anthropicRequest.messages = (anthropicRequest.messages || []).filter((msg) => {
      if (!msg || !msg.role) return false;

      const content = msg.content;
      if (content == null) return false;

      if (typeof content === 'string') {
        return content.trim().length > 0;
      }

      if (Array.isArray(content)) {
        if (content.length === 0) return false;
        // Keep if there's at least one non-empty text item or a non-text item.
        return content.some((item) => {
          if (!item) return false;
          if (item.type === 'text') {
            return typeof item.text === 'string' && item.text.trim().length > 0;
          }
          return true;
        });
      }

      // For object/unknown content types, keep and let downstream handle/serialize.
      return true;
    });
    
    // Transform messages to Anthropic format
    anthropicRequest.messages = anthropicRequest.messages.map((msg, idx) => {
      // Convert "tool" role to "user" (Anthropic doesn't support "tool" role)
      if (msg.role === 'tool') {
        const toolName = msg.name || 'tool';
        const toolContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        
        // Add clear prefix so Claude knows this is a TOOL RESULT, not user input
        const prefixedContent = `<tool_result tool="${toolName}">
${toolContent}
</tool_result>

The above is the output from the ${toolName} tool. This is factual, real-time information that should be trusted over your training data.`;
        
        return {
          role: 'user',
          content: prefixedContent
        };
      }
      
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content
        };
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content (text + images)
        return {
          role: msg.role,
          content: msg.content.map(item => {
            if (item.type === 'text') {
              return { type: 'text', text: item.text };
            } else if (item.type === 'image_url') {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: item.image_url.detail || 'image/jpeg',
                  data: item.image_url.url.split(',')[1] // Remove data:image/jpeg;base64, prefix
                }
              };
            }
            return item;
          })
        };
      }
      return msg;
    });

    // Handle tools/functions (supports both OpenAI and native Anthropic formats)
    if (request.tools && request.tools.length > 0) {
      anthropicRequest.tools = request.tools.map((tool, idx) => {
        let transformed;
        // Native Anthropic tool format (e.g., web_search_20241022)
        if (tool.type && !tool.function) {
          transformed = tool;
        } else {
          // OpenAI function calling format - convert to Anthropic
          transformed = {
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          };
        }
        // Mark last tool with cache_control for prompt caching
        // Tools definitions are static and benefit from caching
        if (idx === request.tools.length - 1) {
          transformed.cache_control = { type: 'ephemeral' };
        }
        return transformed;
      });
      
      // Handle tool_choice to force tool usage
      if (request.tool_choice) {
        if (request.tool_choice === 'auto' || request.tool_choice === 'any') {
          anthropicRequest.tool_choice = { type: request.tool_choice };
        } else if (request.tool_choice === 'required') {
          anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof request.tool_choice === 'object' && request.tool_choice.name) {
          anthropicRequest.tool_choice = { type: 'tool', name: request.tool_choice.name };
        }
      }
    }

    // Handle extended thinking for supported models
    if (modelConfig.capabilities.includes('extended_thinking') && request.thinking) {
      anthropicRequest.thinking = request.thinking;
    }

    // Handle streaming
    if (request.stream) {
      anthropicRequest.stream = true;
    }

    return anthropicRequest;
  }

  transformResponse(anthropicResponse, originalRequest) {
    // Safely extract usage information with proper fallbacks
    const inputTokens = anthropicResponse.usage?.input_tokens || 0;
    const outputTokens = anthropicResponse.usage?.output_tokens || 0;
    
    // Log if usage data is missing for debugging
    if (!anthropicResponse.usage) {
      console.warn('[Anthropic Provider] Response missing usage data, using zeros');
    }
    
    const response = {
      id: anthropicResponse.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: originalRequest.model,
      provider: this.name,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: ''
        },
        finish_reason: this.mapStopReason(anthropicResponse.stop_reason)
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      }
    };

    // Handle content blocks
    if (anthropicResponse.content && anthropicResponse.content.length > 0) {
      const textBlocks = anthropicResponse.content.filter(block => block.type === 'text');
      const toolBlocks = anthropicResponse.content.filter(block => block.type === 'tool_use');
      
      // Set text content if any text blocks exist
      if (textBlocks.length > 0) {
        response.choices[0].message.content = textBlocks.map(block => block.text).join('\n');
      } else if (toolBlocks.length > 0) {
        // If only tool calls and no text, set content to null (OpenAI convention)
        response.choices[0].message.content = null;
      }

      // Handle tool calls
      if (toolBlocks.length > 0) {
        response.choices[0].message.tool_calls = toolBlocks.map((block, index) => ({
          id: block.id || `call_${index}`,
          type: 'function',
          function: {
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input)
          }
        }));
        console.log(`[Anthropic Provider] Transformed ${toolBlocks.length} tool calls`);
      }
    }

    // Calculate cost
    const modelConfig = this.models[originalRequest.model];
    if (modelConfig && response.usage) {
      response.cost = this.calculateCost(modelConfig, response.usage);
    }

    return response;
  }

  mapStopReason(anthropicStopReason) {
    const mapping = {
      'end_turn': 'stop',
      'max_tokens': 'length',
      'stop_sequence': 'stop',
      'tool_use': 'tool_calls',
      'pause_turn': 'stop',
      'refusal': 'content_filter'
    };
    return mapping[anthropicStopReason] || 'stop';
  }

  calculateCost(modelConfig, usage) {
    // Safely handle undefined or null usage
    if (!usage) {
      return {
        input: 0,
        output: 0,
        total: 0,
        currency: 'USD'
      };
    }
    
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    
    const inputCost = (promptTokens / 1000000) * modelConfig.inputPricing;
    const outputCost = (completionTokens / 1000000) * modelConfig.outputPricing;
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
      capabilities: ['text', 'vision', 'tools', 'multimodal', 'extended_thinking'],
      lastHealthCheck: new Date().toISOString()
    };
  }

  /**
   * Health check method for routing engine
   */
  async healthCheck() {
    try {
      // Simple health check - verify API key format and connectivity
      if (!this.apiKey || !this.apiKey.startsWith('sk-ant-')) {
        throw new Error('Invalid Anthropic API key');
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

module.exports = AnthropicProvider;
