const { EventEmitter } = require('events');

/**
 * Advanced Fallback Manager for AI Gateway v2.0
 * Provides intelligent fallback chains, circuit breaker patterns, and health monitoring
 */
class FallbackManager extends EventEmitter {
  constructor(providerManager) {
    super();
    this.providerManager = providerManager;
    this.fallbackChains = new Map();
    this.circuitBreakers = new Map();
    this.healthMetrics = new Map();
    this.retryPolicies = new Map();
    
    // Default configuration
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      healthCheckInterval: 30000,
      fallbackTimeout: 10000,
      enableMetrics: true
    };
    
    // Initialize default fallback chains
    this.initializeDefaultChains();
    
    // Start health monitoring
    this.startHealthMonitoring();
    
    console.log('[Fallback Manager] Initialized with advanced fallback capabilities');
  }

  /**
   * Initialize default fallback chains for common scenarios
   */
  initializeDefaultChains() {
    // High-performance chain: OpenAI -> Anthropic -> Google -> Ollama
    this.registerFallbackChain('high_performance', [
      { provider: 'openai', maxRetries: 2, timeout: 5000 },
      { provider: 'anthropic', maxRetries: 2, timeout: 7000 },
      { provider: 'google', maxRetries: 2, timeout: 8000 },
      { provider: 'ollama', maxRetries: 1, timeout: 10000 }
    ]);

    // Cost-optimized chain: Ollama -> Google -> OpenAI -> Anthropic
    this.registerFallbackChain('cost_optimized', [
      { provider: 'ollama', maxRetries: 2, timeout: 8000 },
      { provider: 'google', maxRetries: 2, timeout: 6000 },
      { provider: 'openai', maxRetries: 1, timeout: 5000 },
      { provider: 'anthropic', maxRetries: 1, timeout: 7000 }
    ]);

    // Vision-capable chain: Google -> OpenAI -> Anthropic
    this.registerFallbackChain('vision_capable', [
      { provider: 'google', maxRetries: 2, timeout: 8000 },
      { provider: 'openai', maxRetries: 2, timeout: 6000 },
      { provider: 'anthropic', maxRetries: 1, timeout: 7000 }
    ]);

    // Thinking-capable chain: Anthropic -> Google -> OpenAI
    this.registerFallbackChain('thinking_capable', [
      { provider: 'anthropic', maxRetries: 2, timeout: 10000 },
      { provider: 'google', maxRetries: 2, timeout: 8000 },
      { provider: 'openai', maxRetries: 1, timeout: 6000 }
    ]);

    console.log('[Fallback Manager] Default fallback chains initialized');
  }

  /**
   * Register a custom fallback chain
   */
  registerFallbackChain(name, chain) {
    this.fallbackChains.set(name, chain);
    console.log(`[Fallback Manager] Registered fallback chain: ${name} (${chain.length} providers)`);
  }

  /**
   * Execute request with fallback chain
   */
  async executeWithFallback(request, options = {}) {
    const chainName = options.fallbackChain || 'high_performance';
    const chain = this.fallbackChains.get(chainName);
    
    if (!chain) {
      throw new Error(`Fallback chain not found: ${chainName}`);
    }

    const executionId = this.generateExecutionId();
    const startTime = Date.now();
    
    console.log(`[Fallback Manager] Starting execution ${executionId} with chain: ${chainName}`);
    
    let lastError = null;
    const attemptResults = [];

    for (let i = 0; i < chain.length; i++) {
      const providerConfig = chain[i];
      const provider = this.providerManager.activeProviders.get(providerConfig.provider);
      
      if (!provider) {
        console.warn(`[Fallback Manager] Provider ${providerConfig.provider} not available, skipping`);
        continue;
      }

      // Check circuit breaker
      if (this.isCircuitBreakerOpen(providerConfig.provider)) {
        console.warn(`[Fallback Manager] Circuit breaker open for ${providerConfig.provider}, skipping`);
        continue;
      }

      try {
        console.log(`[Fallback Manager] Attempting provider ${providerConfig.provider} (${i + 1}/${chain.length})`);
        
        const result = await this.executeWithRetry(
          provider,
          request,
          providerConfig,
          executionId
        );

        // Success - record metrics and return
        this.recordSuccess(providerConfig.provider, Date.now() - startTime);
        
        const response = {
          ...result,
          fallback: {
            executionId,
            chainUsed: chainName,
            providerUsed: providerConfig.provider,
            attemptNumber: i + 1,
            totalTime: Date.now() - startTime,
            attempts: attemptResults
          }
        };

        this.emit('fallback_success', {
          executionId,
          chainName,
          providerUsed: providerConfig.provider,
          attemptNumber: i + 1,
          totalTime: Date.now() - startTime
        });

        return response;

      } catch (error) {
        lastError = error;
        const attemptResult = {
          provider: providerConfig.provider,
          error: error.message,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime
        };
        
        attemptResults.push(attemptResult);
        
        console.warn(`[Fallback Manager] Provider ${providerConfig.provider} failed: ${error.message}`);
        
        // Record failure and update circuit breaker
        this.recordFailure(providerConfig.provider, error);
        
        // Continue to next provider in chain
        continue;
      }
    }

    // All providers in chain failed
    const totalTime = Date.now() - startTime;
    
    this.emit('fallback_exhausted', {
      executionId,
      chainName,
      totalTime,
      attempts: attemptResults,
      lastError: lastError?.message
    });

    throw new Error(`All providers in fallback chain '${chainName}' failed. Last error: ${lastError?.message}`);
  }

  /**
   * Execute request with retry logic
   */
  async executeWithRetry(provider, request, providerConfig, executionId) {
    const maxRetries = providerConfig.maxRetries || this.config.maxRetries;
    const timeout = providerConfig.timeout || this.config.fallbackTimeout;
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Apply timeout to the request
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), timeout);
        });
        
        const requestPromise = provider.processChatCompletion(request);
        
        const result = await Promise.race([requestPromise, timeoutPromise]);
        
        if (attempt > 0) {
          console.log(`[Fallback Manager] Provider ${providerConfig.provider} succeeded on attempt ${attempt + 1}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          console.log(`[Fallback Manager] Retry ${attempt + 1}/${maxRetries} for ${providerConfig.provider} in ${delay}ms`);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(attempt) {
    if (!this.config.exponentialBackoff) {
      return this.config.retryDelay;
    }
    
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
    
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Circuit breaker implementation
   */
  isCircuitBreakerOpen(providerId) {
    const breaker = this.circuitBreakers.get(providerId);
    if (!breaker) return false;
    
    const now = Date.now();
    
    // Check if circuit breaker should reset
    if (breaker.state === 'open' && now - breaker.lastFailure > this.config.circuitBreakerTimeout) {
      breaker.state = 'half-open';
      breaker.failures = 0;
      console.log(`[Fallback Manager] Circuit breaker for ${providerId} moved to half-open`);
    }
    
    return breaker.state === 'open';
  }

  /**
   * Record successful request
   */
  recordSuccess(providerId, duration) {
    // Update circuit breaker
    const breaker = this.circuitBreakers.get(providerId) || {
      state: 'closed',
      failures: 0,
      lastFailure: 0
    };
    
    if (breaker.state === 'half-open') {
      breaker.state = 'closed';
      breaker.failures = 0;
      console.log(`[Fallback Manager] Circuit breaker for ${providerId} closed after successful request`);
    }
    
    this.circuitBreakers.set(providerId, breaker);
    
    // Update health metrics
    this.updateHealthMetrics(providerId, true, duration);
  }

  /**
   * Record failed request
   */
  recordFailure(providerId, error) {
    // Update circuit breaker
    const breaker = this.circuitBreakers.get(providerId) || {
      state: 'closed',
      failures: 0,
      lastFailure: 0
    };
    
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    if (breaker.failures >= this.config.circuitBreakerThreshold) {
      breaker.state = 'open';
      console.log(`[Fallback Manager] Circuit breaker for ${providerId} opened after ${breaker.failures} failures`);
    }
    
    this.circuitBreakers.set(providerId, breaker);
    
    // Update health metrics
    this.updateHealthMetrics(providerId, false, 0, error.message);
  }

  /**
   * Update health metrics
   */
  updateHealthMetrics(providerId, success, duration, error = null) {
    const metrics = this.healthMetrics.get(providerId) || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalDuration: 0,
      avgDuration: 0,
      successRate: 1.0,
      lastSuccess: null,
      lastFailure: null,
      recentErrors: []
    };
    
    metrics.totalRequests++;
    
    if (success) {
      metrics.successfulRequests++;
      metrics.totalDuration += duration;
      metrics.avgDuration = metrics.totalDuration / metrics.successfulRequests;
      metrics.lastSuccess = new Date().toISOString();
    } else {
      metrics.failedRequests++;
      metrics.lastFailure = new Date().toISOString();
      
      // Keep track of recent errors (last 10)
      metrics.recentErrors.unshift({
        error,
        timestamp: new Date().toISOString()
      });
      
      if (metrics.recentErrors.length > 10) {
        metrics.recentErrors.pop();
      }
    }
    
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
    
    this.healthMetrics.set(providerId, metrics);
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring() {
    setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    
    console.log(`[Fallback Manager] Health monitoring started (interval: ${this.config.healthCheckInterval}ms)`);
  }

  /**
   * Perform health checks on all providers
   */
  async performHealthChecks() {
    const healthResults = {};
    
    for (const [providerId, provider] of this.providerManager.activeProviders) {
      try {
        const startTime = Date.now();
        const isHealthy = await provider.healthCheck();
        const duration = Date.now() - startTime;
        
        healthResults[providerId] = {
          healthy: isHealthy,
          responseTime: duration,
          timestamp: new Date().toISOString()
        };
        
        if (isHealthy) {
          this.recordSuccess(providerId, duration);
        }
        
      } catch (error) {
        healthResults[providerId] = {
          healthy: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
        
        this.recordFailure(providerId, error);
      }
    }
    
    this.emit('health_check_completed', healthResults);
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus() {
    const status = {};
    
    for (const [providerId, metrics] of this.healthMetrics) {
      const breaker = this.circuitBreakers.get(providerId);
      
      status[providerId] = {
        ...metrics,
        circuitBreaker: breaker ? breaker.state : 'closed',
        isHealthy: metrics.successRate > 0.8 && (!breaker || breaker.state !== 'open')
      };
    }
    
    return status;
  }

  /**
   * Get fallback analytics
   */
  getAnalytics() {
    const analytics = {
      chains: {},
      circuitBreakers: {},
      healthMetrics: {},
      totalExecutions: 0,
      successfulExecutions: 0
    };
    
    // Convert fallback chains to expected format
    for (const [chainName, providers] of this.fallbackChains) {
      analytics.chains[chainName] = {
        providers: providers,
        executions: 0,
        successes: 0
      };
    }
    
    // Circuit breaker status
    for (const [providerId, breaker] of this.circuitBreakers) {
      analytics.circuitBreakers[providerId] = {
        state: breaker.state,
        failures: breaker.failures,
        lastFailure: breaker.lastFailure ? new Date(breaker.lastFailure).toISOString() : null
      };
    }
    
    // Health metrics summary
    for (const [providerId, metrics] of this.healthMetrics) {
      analytics.healthMetrics[providerId] = {
        successRate: metrics.successRate,
        avgDuration: metrics.avgDuration,
        totalRequests: metrics.totalRequests,
        lastSuccess: metrics.lastSuccess,
        lastFailure: metrics.lastFailure
      };
      
      analytics.totalExecutions += metrics.totalRequests;
      analytics.successfulExecutions += metrics.successfulRequests;
    }
    
    return analytics;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.emit('config_updated', this.config);
    console.log('[Fallback Manager] Configuration updated:', newConfig);
  }

  /**
   * Reset circuit breakers and metrics
   */
  reset() {
    this.circuitBreakers.clear();
    this.healthMetrics.clear();
    console.log('[Fallback Manager] Reset completed - all circuit breakers and metrics cleared');
  }

  /**
   * Utility methods
   */
  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FallbackManager;
