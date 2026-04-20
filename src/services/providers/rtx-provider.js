/**
 * RTX Workstation Provider
 * 
 * Handles routing to NVIDIA NIM models running on RTX workstation
 * Models: Llama 3.1 70B, Llama 3.3 70B, Mistral 7B, NV-EmbedQA-E5-v5
 * 
 * Architecture: NVIDIA NIM containers
 * - NIM models use OpenAI-compatible API
 * - No authentication required (Tailscale private network)
 * - Direct routing to specific ports per model
 * - Tailscale IP: 100.108.41.22
 */

const fetch = require('node-fetch');
const logger = require('../../utils/logger');

class RTXProvider {
  constructor(db) {
    this.db = db;
    this.providerId = 'rtx-workstation';
    this.providerName = 'RTX Workstation (NVIDIA NIM)';
    this.tailscaleIp = '100.108.41.22';  // Tailscale IP
    this.models = new Map();
    this.endpoints = new Map();
  }

  /**
   * Initialize provider - load models and endpoints from database
   */
  async initialize() {
    try {
      logger.info(`[RTX Provider] Initializing...`);
      
      // Load models from database
      const modelsResult = await this.db.query(`
        SELECT 
          model_id,
          model_name,
          display_name,
          capabilities,
          metadata,
          is_active
        FROM provider_models
        WHERE provider_id = $1 AND is_active = true
        ORDER BY model_id
      `, [this.providerId]);

      // Load endpoints from database
      const endpointsResult = await this.db.query(`
        SELECT 
          endpoint_id,
          endpoint_path,
          base_url,
          metadata
        FROM provider_endpoints
        WHERE provider_id = $1
      `, [this.providerId]);

      // Store models
      modelsResult.rows.forEach(model => {
        const port = model.capabilities?.port || 8000;
        const tailscaleIp = model.capabilities?.tailscale_ip || this.tailscaleIp;
        
        this.models.set(model.model_id, {
          id: model.model_id,
          name: model.model_name,
          displayName: model.display_name,
          capabilities: model.capabilities,
          metadata: model.metadata,
          port: port,
          baseUrl: `http://${tailscaleIp}:${port}`
        });
        
        logger.info(`[RTX Provider] Registered model ${model.model_id} at ${tailscaleIp}:${port}`);
      });

      // Store endpoints
      endpointsResult.rows.forEach(endpoint => {
        const modelId = endpoint.metadata?.model;
        if (modelId) {
          this.endpoints.set(modelId, {
            path: endpoint.endpoint_path,
            baseUrl: endpoint.base_url
          });
        }
      });

      logger.info(`[RTX Provider] Loaded ${this.models.size} models from database`);
      logger.info(`[RTX Provider] Models: ${Array.from(this.models.keys()).join(', ')}`);
      
      return true;
    } catch (error) {
      logger.error(`[RTX Provider] Initialization failed:`, error);
      return false;
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels() {
    return Array.from(this.models.values()).map(model => ({
      id: model.id,
      object: 'model',
      owned_by: 'rtx-workstation',
      displayName: model.displayName,
      capabilities: model.capabilities,
      pricing: {
        input: 0.0,  // Free (local)
        output: 0.0
      },
      metadata: model.metadata
    }));
  }

  /**
   * Get endpoint for specific model
   */
  async getEndpointForModel(modelId) {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found in XRT provider`);
    }
    
    // NIM containers use OpenAI-compatible endpoint
    const endpoint = {
      baseUrl: model.baseUrl,
      path: '/v1/chat/completions'
    };
    
    logger.info(`[RTX Provider] Using endpoint: ${endpoint.baseUrl}${endpoint.path} for ${modelId}`);
    return endpoint;
  }

  /**
   * Send request to vLLM model
   */
  async sendRequest(model, messages, options = {}) {
    try {
      const endpoint = await this.getEndpointForModel(model);
      const url = `${endpoint.baseUrl}${endpoint.path}`;

      logger.info(`[RTX Provider] Sending request to ${url}`);
      logger.debug(`[RTX Provider] Model: ${model}, Messages: ${messages.length}`);

      // NIM uses OpenAI-compatible API
      const requestBody = {
        model: model,
        messages: messages,
        max_tokens: options.max_tokens || 2048,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
        stream: false,
        ...options
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // NIM doesn't require authentication for Tailscale access
        },
        body: JSON.stringify(requestBody),
        timeout: 120000  // 2 minute timeout for large models
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[RTX Provider] Request failed: ${response.status} ${errorText}`);
        throw new Error(`XRT request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      logger.info(`[RTX Provider] Request successful`);
      
      return data;
    } catch (error) {
      logger.error(`[RTX Provider] Error:`, error);
      throw error;
    }
  }

  /**
   * Handle streaming responses
   */
  async handleStreaming(model, messages, options = {}, responseStream) {
    try {
      const endpoint = await this.getEndpointForModel(model);
      const url = `${endpoint.baseUrl}${endpoint.path}`;

      logger.info(`[RTX Provider] Streaming request to ${url}`);

      const requestBody = {
        model: model,
        messages: messages,
        max_tokens: options.max_tokens || 2048,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
        stream: true,
        ...options
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`XRT streaming failed: ${response.status}`);
      }

      // Forward SSE stream
      response.body.on('data', (chunk) => {
        responseStream.write(chunk);
      });

      response.body.on('end', () => {
        responseStream.end();
      });

      response.body.on('error', (error) => {
        logger.error(`[RTX Provider] Streaming error:`, error);
        responseStream.end();
      });

    } catch (error) {
      logger.error(`[RTX Provider] Streaming error:`, error);
      throw error;
    }
  }

  /**
   * Check if model is supported
   */
  supportsModel(modelId) {
    return this.models.has(modelId);
  }

  /**
   * Get model info
   */
  getModelInfo(modelId) {
    return this.models.get(modelId);
  }
}

module.exports = RTXProvider;
