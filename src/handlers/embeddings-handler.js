/**
 * Embeddings Handler for AI Gateway v2.5.0
 * Supports multiple embedding providers with OpenAI-compatible API
 * 
 * Primary use case: NVIDIA NIM nv-embedqa-e5-v5 (1024 dimensions, FREE local)
 * Compatible with: NVIDIA NIM, OpenAI, Google, Ollama
 */

const axios = require('axios');

class EmbeddingsHandler {
  constructor(providerManager, costTrackingService, requestTracingService) {
    this.providerManager = providerManager;
    this.costTrackingService = costTrackingService;
    this.requestTracingService = requestTracingService;
    
    // Embedding model configurations
    this.modelConfigs = {
      'text-embedding-004': {
        provider: 'google',
        dimensions: 768,
        maxInputTokens: 2048,
        costPer1MChars: 0.00001
      },
      'text-embedding-3-small': {
        provider: 'openai',
        dimensions: 1536,
        maxInputTokens: 8191,
        costPer1MTokens: 0.02
      },
      'text-embedding-3-large': {
        provider: 'openai',
        dimensions: 3072,
        maxInputTokens: 8191,
        costPer1MTokens: 0.13
      },
      'text-embedding-ada-002': {
        provider: 'openai',
        dimensions: 1536,
        maxInputTokens: 8191,
        costPer1MTokens: 0.10
      },
      'nomic-embed-text': {
        provider: 'ollama',
        dimensions: 768,
        maxInputTokens: 2048,
        costPer1MTokens: 0 // Local, free
      },
      'nv-embedqa-e5-v5': {
        provider: 'nvidia',
        dimensions: 1024,
        maxInputTokens: 512,
        costPer1MTokens: 0 // Local NIM, free
      },
      'nvidia/nv-embedqa-e5-v5': {
        provider: 'nvidia',
        dimensions: 1024,
        maxInputTokens: 512,
        costPer1MTokens: 0 // Local NIM, free
      }
    };
  }

  /**
   * Main embedding generation endpoint
   * OpenAI-compatible format
   */
  async handleEmbeddingRequest(req, res) {
    const startTime = Date.now();
    const { input, model, provider, encoding_format, dimensions } = req.body;

    // Validate input
    if (!input) {
      return res.status(400).json({
        error: {
          message: 'Missing required parameter: input',
          type: 'invalid_request_error'
        }
      });
    }

    if (!model) {
      return res.status(400).json({
        error: {
          message: 'Missing required parameter: model',
          type: 'invalid_request_error'
        }
      });
    }

    // Normalize input to array
    const inputs = Array.isArray(input) ? input : [input];

    // Get model configuration
    const modelConfig = this.modelConfigs[model] || {
      provider: provider || 'google',
      dimensions: dimensions || 768,
      maxInputTokens: 2048,
      costPer1MChars: 0.00001
    };

    const detectedProvider = provider || modelConfig.provider;

    try {
      console.log(`[Embeddings] Generating embeddings: model=${model}, provider=${detectedProvider}, inputs=${inputs.length}`);

      let embeddings;
      
      switch (detectedProvider) {
        case 'nvidia':
          embeddings = await this.generateNvidiaEmbeddings(inputs, model);
          break;
        case 'google':
          embeddings = await this.generateGoogleEmbeddings(inputs, model);
          break;
        case 'openai':
          embeddings = await this.generateOpenAIEmbeddings(inputs, model);
          break;
        case 'ollama':
          embeddings = await this.generateOllamaEmbeddings(inputs, model);
          break;
        default:
          // Default to NVIDIA NIM for free local embeddings
          embeddings = await this.generateNvidiaEmbeddings(inputs, 'nv-embedqa-e5-v5');
      }

      const duration = Date.now() - startTime;

      // Calculate usage and costs
      const totalChars = inputs.join('').length;
      const estimatedTokens = Math.ceil(totalChars / 4); // Rough estimation

      let cost = 0;
      if (modelConfig.costPer1MChars) {
        cost = (totalChars / 1000000) * modelConfig.costPer1MChars;
      } else if (modelConfig.costPer1MTokens) {
        cost = (estimatedTokens / 1000000) * modelConfig.costPer1MTokens;
      }

      // Track costs (use recordCost method)
      if (this.costTrackingService && this.costTrackingService.recordCost) {
        try {
          await this.costTrackingService.recordCost(
            `emb-${Date.now()}`, // traceId
            detectedProvider,
            model,
            {
              prompt_tokens: estimatedTokens,
              completion_tokens: 0,
              total_tokens: estimatedTokens
            },
            {
              clientId: 'embeddings-api',
              tags: ['embeddings']
            }
          );
        } catch (err) {
          console.warn('[Embeddings] Cost tracking failed:', err.message);
        }
      }

      // Return OpenAI-compatible format
      res.json({
        object: 'list',
        data: embeddings.map((embedding, index) => ({
          object: 'embedding',
          embedding: embedding,
          index: index
        })),
        model: model,
        usage: {
          prompt_tokens: estimatedTokens,
          total_tokens: estimatedTokens
        }
      });

      console.log(`[Embeddings] Success: ${embeddings.length} embeddings in ${duration}ms, cost=$${cost.toFixed(6)}`);

    } catch (error) {
      console.error('[Embeddings] Error:', error.message);

      res.status(500).json({
        error: {
          message: error.message,
          type: 'api_error',
          provider: detectedProvider,
          model: model
        }
      });
    }
  }

  /**
   * Generate embeddings using Google Generative AI
   * Model: text-embedding-004 (768 dimensions)
   */
  async generateGoogleEmbeddings(inputs, model = 'text-embedding-004') {
    let GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    
    // Try to fetch from AI Inferencing if not in env
    if (!GOOGLE_API_KEY && this.aiInferencingClient) {
      try {
        GOOGLE_API_KEY = await this.aiInferencingClient.getKey('ai-gateway', 'google');
      } catch (e) {
        console.log('[Embeddings] Could not fetch Google key from AI Inferencing:', e.message);
      }
    }
    
    if (!GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not configured');
    }

    const embeddings = [];

    for (const text of inputs) {
      try {
        // Map model names to Google's actual model names
        // Google's available embedding model is gemini-embedding-001
        const googleModel = 'gemini-embedding-001';
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:embedContent?key=${GOOGLE_API_KEY}`,
          {
            model: `models/${googleModel}`,
            content: {
              parts: [{
                text: text
              }]
            }
          },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        if (response.data && response.data.embedding && response.data.embedding.values) {
          embeddings.push(response.data.embedding.values);
        } else {
          throw new Error('Invalid response from Google API');
        }
      } catch (error) {
        if (error.response) {
          throw new Error(`Google API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        }
        throw error;
      }
    }

    return embeddings;
  }

  /**
   * Generate embeddings using OpenAI
   */
  async generateOpenAIEmbeddings(inputs, model) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          input: inputs,
          model: model
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      return response.data.data.map(item => item.embedding);
    } catch (error) {
      if (error.response) {
        throw new Error(`OpenAI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Generate embeddings using Ollama (local)
   */
  async generateOllamaEmbeddings(inputs, model) {
    const OLLAMA_HOST = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';

    const embeddings = [];

    for (const text of inputs) {
      try {
        const response = await axios.post(
          `${OLLAMA_HOST}/api/embed`,
          {
            model: model,
            input: text
          },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );

        if (response.data && response.data.embeddings && response.data.embeddings[0]) {
          embeddings.push(response.data.embeddings[0]);
        } else {
          throw new Error('Invalid response from Ollama');
        }
      } catch (error) {
        if (error.response) {
          throw new Error(`Ollama API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        }
        throw error;
      }
    }

    return embeddings;
  }

  /**
   * Generate embeddings using NVIDIA NIM (local, free)
   * Model: nv-embedqa-e5-v5 (1024 dimensions)
   */
  async generateNvidiaEmbeddings(inputs, model = 'nv-embedqa-e5-v5') {
    const NIM_HOST = process.env.NVIDIA_NIM_EMBEDDINGS_URL || 'http://localhost:8006';
    
    // Normalize model name
    const nimModel = model.includes('/') ? model : `nvidia/${model}`;
    
    try {
      const response = await axios.post(
        `${NIM_HOST}/v1/embeddings`,
        {
          input: inputs,
          model: nimModel,
          input_type: 'query'  // Required for asymmetric models
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      if (response.data && response.data.data) {
        return response.data.data.map(item => item.embedding);
      } else {
        throw new Error('Invalid response from NVIDIA NIM');
      }
    } catch (error) {
      if (error.response) {
        throw new Error(`NVIDIA NIM API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Handle method (alias for handleEmbeddingRequest for route compatibility)
   */
  async handle(req, res) {
    return this.handleEmbeddingRequest(req, res);
  }

  /**
   * List available embedding models
   */
  getAvailableModels() {
    return Object.entries(this.modelConfigs).map(([id, config]) => ({
      id,
      provider: config.provider,
      dimensions: config.dimensions,
      maxInputTokens: config.maxInputTokens,
      type: 'embedding'
    }));
  }
}

module.exports = EmbeddingsHandler;
