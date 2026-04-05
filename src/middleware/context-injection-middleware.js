/**
 * Personal Context Injection Middleware for AI Gateway
 * 
 * Automatically injects user's personal context (identity, preferences, memory)
 * into LLM requests before routing to providers.
 * 
 * Installation:
 * 1. Place this file in: /home/eleazar/Projects/AIHomelab/core/ai-gateway-v2/src/middleware/
 * 2. Import in chat-completions-handler.js
 * 3. Call before routing to LLM
 */

const https = require('https');

class ContextInjectionMiddleware {
  constructor(options = {}) {
    this.unifiedContextUrl = options.unifiedContextUrl || 'https://rtx-workstation.tailb64e64.ts.net:8031/api/context';
    this.enabled = options.enabled !== false;
    this.cacheTimeout = options.cacheTimeout || 300000; // 5 minutes
    this.cache = new Map();
    
    console.log('[Context Injection] Middleware initialized', {
      enabled: this.enabled,
      url: this.unifiedContextUrl
    });
  }
  
  /**
   * Inject personal context into request before sending to LLM
   * 
   * @param {Object} requestBody - The chat completion request body
   * @param {Object} headers - Request headers
   * @returns {Promise<Object>} Modified request body with injected context
   */
  async injectContext(requestBody, headers = {}) {
    if (!this.enabled) {
      return requestBody;
    }
    
    // Skip if no messages
    if (!requestBody.messages || requestBody.messages.length === 0) {
      return requestBody;
    }
    
    try {
      const serviceId = headers['x-service-id'] || 'default-service';
      const userId = headers['x-user-id'] || 'eleazar'; // Default homelab user
      const skipContext = headers['x-skip-context'] === 'true';
      
      if (skipContext) {
        console.log('[Context Injection] Skipped (x-skip-context header)');
        return requestBody;
      }
      
      // Fetch unified context
      const context = await this.fetchContext(serviceId, userId);
      
      if (!context || !context.personalization_prompt) {
        console.log('[Context Injection] No context available');
        return requestBody;
      }
      
      // Inject into messages
      const modifiedBody = { ...requestBody };
      modifiedBody.messages = this.injectIntoMessages(
        requestBody.messages,
        context.personalization_prompt
      );
      
      console.log('[Context Injection] ✅ Injected personal context', {
        serviceId,
        userId,
        contextLength: context.personalization_prompt.length,
        hasIdentity: !!context.identity,
        preferencesCount: context.preferences?.length || 0,
        topicsCount: context.recent_topics?.length || 0
      });
      
      return modifiedBody;
      
    } catch (error) {
      console.error('[Context Injection] Failed:', error.message);
      // Graceful degradation - return original request
      return requestBody;
    }
  }
  
  /**
   * Fetch unified context from GooseMind backend
   */
  async fetchContext(serviceId, userId) {
    const cacheKey = `${userId}:${serviceId}`;
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log('[Context Injection] Cache hit');
      return cached.data;
    }
    
    return new Promise((resolve, reject) => {
      const url = `${this.unifiedContextUrl}/full?agent_id=${serviceId}&action_type=chat&include_memory=true&include_identity=true&include_preferences=true`;
      
      const options = {
        method: 'GET',
        headers: {
          'X-User-ID': userId,
          'Accept': 'application/json'
        },
        // Allow self-signed certificates for internal services
        rejectUnauthorized: false
      };
      
      https.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const context = JSON.parse(data);
            
            // Cache the result
            this.cache.set(cacheKey, {
              data: context,
              timestamp: Date.now()
            });
            
            resolve(context);
          } catch (error) {
            console.error('[Context Injection] Parse error:', error.message);
            resolve(null);
          }
        });
      }).on('error', (error) => {
        console.error('[Context Injection] Fetch error:', error.message);
        resolve(null); // Graceful degradation
      });
    });
  }
  
  /**
   * Inject context into message array
   * 
   * Strategy:
   * 1. If system message exists, append to it
   * 2. If no system message, create one at the start
   */
  injectIntoMessages(messages, personalizationPrompt) {
    const messagesCopy = [...messages];
    
    // Find existing system message
    const systemMessageIndex = messagesCopy.findIndex(m => m.role === 'system');
    
    if (systemMessageIndex !== -1) {
      // Append to existing system message
      const systemMessage = messagesCopy[systemMessageIndex];
      messagesCopy[systemMessageIndex] = {
        ...systemMessage,
        content: systemMessage.content + '\n\n' + personalizationPrompt
      };
    } else {
      // Create new system message at the start
      messagesCopy.unshift({
        role: 'system',
        content: personalizationPrompt
      });
    }
    
    return messagesCopy;
  }
  
  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache() {
    this.cache.clear();
    console.log('[Context Injection] Cache cleared');
  }
  
  /**
   * Enable/disable context injection
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log('[Context Injection] Enabled:', enabled);
  }
}

module.exports = ContextInjectionMiddleware;
