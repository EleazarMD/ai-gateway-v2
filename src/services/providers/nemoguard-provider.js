/**
 * NeMo Guard Provider for AI Gateway
 * Provides centralized content safety moderation using NVIDIA NeMo Guard
 * 
 * This provider wraps the llama-3.1-nemoguard-8b-content-safety NIM
 * for age-appropriate content screening across all services.
 */

const { EventEmitter } = require('events');

class NemoGuardProvider extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.name = config.name || 'nemoguard';
    this.type = 'nemoguard';
    this.baseUrl = config.baseUrl || process.env.NEMOGUARD_URL || 'http://localhost:8123';
    this.apiKey = config.apiKey || process.env.NGC_API_KEY || '';
    this.status = 'initializing';
    this.requestCount = 0;
    this.errorCount = 0;
    
    // Content safety model
    this.modelName = 'llama-3.1-nemoguard-8b-content-safety';
    
    // Available models for this provider
    this.models = [
      {
        id: 'llama-guard-3-8b',
        name: 'LLaMA Guard 3 8B',
        provider: 'nemoguard',
        description: 'Content safety screening model',
        capabilities: ['content-safety', 'moderation'],
        contextWindow: 8192,
        maxTokens: 1024
      },
      {
        id: 'nemoguard-content-safety',
        name: 'NeMo Guard Content Safety',
        provider: 'nemoguard',
        description: 'NVIDIA NeMo Guard for content moderation',
        capabilities: ['content-safety', 'moderation', 'child-safety'],
        contextWindow: 8192,
        maxTokens: 1024
      }
    ];
    
    console.log(`[NemoGuard Provider] Initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Initialize the provider
   */
  async initialize() {
    try {
      console.log('[NemoGuard Provider] Initializing...');
      
      // Check if the NeMo Guard service is available
      const isHealthy = await this.healthCheck();
      
      if (isHealthy) {
        this.status = 'active';
        console.log('[NemoGuard Provider] Successfully initialized');
        this.emit('initialized', { provider: this.name, status: 'active' });
      } else {
        this.status = 'unavailable';
        console.warn('[NemoGuard Provider] Service not available, will retry on requests');
      }
      
      return true;
    } catch (error) {
      console.error('[NemoGuard Provider] Initialization failed:', error.message);
      this.status = 'error';
      this.emit('error', { provider: this.name, error: error.message });
      throw error;
    }
  }

  /**
   * Validate connection to NeMo Guard service
   */
  async validateConnection() {
    return await this.healthCheck();
  }

  /**
   * Health check for NeMo Guard service
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/health/ready`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      return response.ok;
    } catch (error) {
      console.warn('[NemoGuard Provider] Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Get available models
   */
  getModels() {
    return this.models;
  }

  /**
   * Get available models (alias)
   */
  getAvailableModels() {
    return this.models;
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    const isHealthy = await this.healthCheck();
    return {
      provider: this.name,
      status: isHealthy ? 'healthy' : 'unhealthy',
      lastCheck: new Date().toISOString(),
      requestCount: this.requestCount,
      errorCount: this.errorCount
    };
  }

  /**
   * Process chat completion for content safety screening
   */
  async processChatCompletion(request) {
    this.requestCount++;
    
    try {
      console.log('[NemoGuard Provider] Processing content safety request');
      
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: request.messages,
          temperature: request.temperature || 0.1,
          max_tokens: request.max_tokens || 500
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NeMo Guard API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      this.emit('request_completed', {
        provider: this.name,
        model: this.modelName,
        success: true
      });

      return data;
    } catch (error) {
      this.errorCount++;
      console.error('[NemoGuard Provider] Request failed:', error.message);
      
      this.emit('request_failed', {
        provider: this.name,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Screen content for safety
   * Convenience method for content moderation
   */
  async screenContent(content, options = {}) {
    const { childAge = 10, categories = [] } = options;
    
    const prompt = `You are a content safety evaluator. Analyze the following content for age-appropriateness for a ${childAge}-year-old child.

Content to evaluate:
${content}

Categories to check: ${categories.length > 0 ? categories.join(', ') : 'violence, scary_content, mature_themes, language, sexual_content'}

Respond with:
SAFE: yes/no
VIOLATIONS: [list any violations found]
SEVERITY: mild/moderate/severe
RECOMMENDED_AGE: [minimum age recommendation]
EXPLANATION: [brief explanation]`;

    const response = await this.processChatCompletion({
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    return this.parseScreeningResponse(response);
  }

  /**
   * Parse screening response into structured format
   */
  parseScreeningResponse(response) {
    try {
      const content = response.choices?.[0]?.message?.content || '';
      
      const safeMatch = content.match(/SAFE:\s*(yes|no)/i);
      const violationsMatch = content.match(/VIOLATIONS:\s*\[(.*?)\]/i);
      const severityMatch = content.match(/SEVERITY:\s*(mild|moderate|severe)/i);
      const ageMatch = content.match(/RECOMMENDED_AGE:\s*(\d+)/i);
      
      return {
        safe: safeMatch ? safeMatch[1].toLowerCase() === 'yes' : true,
        violations: violationsMatch ? violationsMatch[1].split(',').map(v => v.trim()).filter(v => v) : [],
        severity: severityMatch ? severityMatch[1].toLowerCase() : 'mild',
        recommendedAge: ageMatch ? parseInt(ageMatch[1]) : 0,
        rawResponse: content
      };
    } catch (error) {
      console.error('[NemoGuard Provider] Failed to parse screening response:', error.message);
      return {
        safe: true,
        violations: [],
        severity: 'mild',
        recommendedAge: 0,
        error: error.message
      };
    }
  }

  /**
   * Cleanup provider resources
   */
  async cleanup() {
    console.log('[NemoGuard Provider] Cleaning up...');
    this.status = 'inactive';
    this.removeAllListeners();
  }
}

module.exports = NemoGuardProvider;
