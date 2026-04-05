/**
 * AI Inferencing Client
 * 
 * Client library for services to request API keys from AI Inferencing Service
 * Used by: AI Gateway, individual services, etc.
 */

class AIInferencingClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.AI_INFERENCING_URL || 'http://localhost:9000';
    this.apiKey = config.apiKey || process.env.AI_INFERENCING_API_KEY;
    this.timeout = config.timeout || 5000;
    
    // In-memory cache to reduce network calls
    this.cache = new Map();
    this.cacheTTL = config.cacheTTL || 60000; // 1 minute default
    
    console.log(`[AI Inferencing Client] Initialized with baseUrl: ${this.baseUrl}`);
  }
  
  /**
   * Get API key for a service + provider combination
   */
  async getKey(serviceId, provider) {
    try {
      const cacheKey = `${serviceId}:${provider}`;
      
      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          console.log(`[AI Inferencing Client] Cache hit: ${cacheKey}`);
          return cached.apiKey;
        }
        // Cache expired, remove it
        this.cache.delete(cacheKey);
      }
      
      // Fetch from API Inferencing service
      console.log(`[AI Inferencing Client] Fetching key: ${serviceId}/${provider}`);
      
      const url = `${this.baseUrl}/api/v1/keys/${serviceId}/${provider}`;
      const headers = {};
      
      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`Failed to get API key: ${error.error || response.statusText}`);
      }
      
      const data = await response.json();
      
      // Cache the result
      this.cache.set(cacheKey, {
        apiKey: data.apiKey,
        timestamp: Date.now()
      });
      
      console.log(`[AI Inferencing Client] Key retrieved and cached: ${serviceId}/${provider}`);
      
      return data.apiKey;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error(`[AI Inferencing Client] Request timeout: ${serviceId}/${provider}`);
        throw new Error('AI Inferencing service timeout');
      }
      
      console.error(`[AI Inferencing Client] Error getting key:`, error);
      throw error;
    }
  }
  
  /**
   * Clear cache for a specific service+provider or entire cache
   */
  clearCache(serviceId = null, provider = null) {
    if (serviceId && provider) {
      const cacheKey = `${serviceId}:${provider}`;
      this.cache.delete(cacheKey);
      console.log(`[AI Inferencing Client] Cache cleared: ${cacheKey}`);
    } else {
      this.cache.clear();
      console.log(`[AI Inferencing Client] All cache cleared`);
    }
  }
  
  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        return { healthy: false, error: response.statusText };
      }
      
      const data = await response.json();
      return { healthy: true, ...data };
      
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
  
  /**
   * Get metrics
   */
  async getMetrics() {
    try {
      const response = await fetch(`${this.baseUrl}/metrics`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeout)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get metrics: ${response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      console.error('[AI Inferencing Client] Error getting metrics:', error);
      throw error;
    }
  }

  /**
   * Check content safety using Llama Guard 3 via AI Inferencing Service
   */
  async checkContentSafety(content, safetyLevel = 'standard', context = 'general') {
    try {
      const url = `${this.baseUrl}/api/v1/moderation/check`;
      const headers = {
        'Content-Type': 'application/json',
        'X-Service-ID': 'ai-gateway',
        'X-Project-ID': 'ai-gateway'
      };
      
      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }
      
      const body = {
        content,
        context,
        level: safetyLevel
      };

      console.log(`[AI Inferencing Client] Checking content safety with Llama Guard 3: level=${safetyLevel}, context=${context}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`Content safety check failed: ${error.error || response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[AI Inferencing Client] Content safety check timeout');
        throw new Error('Content safety check timeout');
      }
      
      console.error('[AI Inferencing Client] Error checking content safety:', error);
      throw error;
    }
  }

  /**
   * Generate image via AI Inferencing Service
   */
  async generateImage(request) {
    try {
      const url = `${this.baseUrl}/v1/images/generations`;
      const headers = {
        'Content-Type': 'application/json',
        'X-Service-ID': request.serviceId || 'ai-gateway',
        'X-Project-ID': request.projectId || 'default'
      };
      
      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }

      if (request.userId) {
        headers['X-User-ID'] = request.userId;
      }
      
      const body = {
        prompt: request.prompt,
        negative_prompt: request.negative_prompt,
        model: request.model,
        width: request.width,
        height: request.height,
        steps: request.steps,
        cfg_scale: request.cfg_scale,
        seed: request.seed,
        safetyLevel: request.safetyLevel,
        isChild: request.isChild
      };

      console.log(`[AI Inferencing Client] Generating image with safetyLevel: ${request.safetyLevel}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout for image generation
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        // Handle blocked content
        if (response.status === 400 && error.error?.code === 'content_blocked') {
          return {
            blocked: true,
            message: error.error.message,
            safetyLevel: error.error.safetyLevel,
            violations: error.error.violations
          };
        }
        
        throw new Error(`Image generation failed: ${error.error?.message || response.statusText}`);
      }
      
      return await response.json();
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[AI Inferencing Client] Image generation timeout');
        throw new Error('Image generation timeout');
      }
      
      console.error('[AI Inferencing Client] Error generating image:', error);
      throw error;
    }
  }
}

module.exports = AIInferencingClient;
