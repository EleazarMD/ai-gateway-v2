const { EventEmitter } = require('events');

/**
 * Intelligent Routing Engine for AI Gateway v2.0
 * Provides cost-optimized, capability-aware routing across multiple LLM providers
 * Features: Cost optimization, load balancing, capability matching, health-aware routing
 */
class RoutingEngine extends EventEmitter {
  constructor(providerManager) {
    super();
    this.providerManager = providerManager;
    this.routingStrategies = new Map();
    this.costCache = new Map();
    this.performanceMetrics = new Map();
    this.routingHistory = [];
    this.maxHistorySize = 1000;
    
    // Default routing strategies
    this.registerStrategy('cost_optimized', this.costOptimizedRouting.bind(this));
    this.registerStrategy('performance_first', this.performanceFirstRouting.bind(this));
    this.registerStrategy('capability_match', this.capabilityMatchRouting.bind(this));
    this.registerStrategy('round_robin', this.roundRobinRouting.bind(this));
    this.registerStrategy('health_aware', this.healthAwareRouting.bind(this));
    this.registerStrategy('hybrid', this.hybridRouting.bind(this));
    
    // Default configuration
    this.config = {
      defaultStrategy: 'hybrid',
      costThreshold: 0.001, // $0.001 difference threshold
      performanceWeight: 0.3,
      costWeight: 0.4,
      healthWeight: 0.3,
      maxRetries: 3,
      fallbackEnabled: true,
      cacheTimeout: 300000, // 5 minutes
      enableMetrics: true,
      routingRules: []
    };
    
    console.log('[Routing Engine] Initialized with strategies:', Array.from(this.routingStrategies.keys()));
  }

  applyRoutingRules(request, options = {}) {
    const rules = Array.isArray(options.routingRules)
      ? options.routingRules
      : (this.config.routingRules || []);

    if (!rules.length) {
      return null;
    }

    const context = this.getRequestContext(request, options);
    const orderedRules = rules
      .filter(rule => rule && rule.enabled !== false)
      .slice()
      .sort((a, b) => (a.priority || 100) - (b.priority || 100));

    for (const rule of orderedRules) {
      if (this.matchesRuleCondition(rule.condition, context)) {
        return {
          id: rule.id,
          name: rule.name,
          targetProvider: rule.targetProvider,
          modelOverride: rule.targetModel || rule.model,
          fallbackProviders: Array.isArray(rule.fallbackProviders) ? rule.fallbackProviders : []
        };
      }
    }

    return null;
  }

  selectProviderFromRule(rule, request) {
    if (!rule) {
      return null;
    }

    const availableProviders = this.getAvailableProviders(request);
    const tryProvider = (providerId) => {
      if (!providerId) return null;
      const provider = availableProviders.find(p => p.id === providerId || p.name === providerId);
      if (!provider) return null;
      return {
        provider: provider.id,
        reason: 'routing_rule',
        ruleId: rule.id,
        ruleName: rule.name
      };
    };

    const primaryDecision = tryProvider(rule.targetProvider);
    if (primaryDecision) {
      return primaryDecision;
    }

    for (const fallbackId of rule.fallbackProviders || []) {
      const fallbackDecision = tryProvider(fallbackId);
      if (fallbackDecision) {
        return fallbackDecision;
      }
    }

    if (rule.targetProvider || (rule.fallbackProviders && rule.fallbackProviders.length > 0)) {
      console.warn('[Routing Engine] Routing rule matched but no providers available for rule', {
        ruleId: rule.id,
        targetProvider: rule.targetProvider,
        model: request.model
      });
    }

    return null;
  }

  getRequestContext(request, options = {}) {
    const ctx = request?._context || {};
    const tools = Array.isArray(request?.tools) ? request.tools : [];
    return {
      serviceId: ctx.serviceId,
      projectId: ctx.projectId,
      agentId: ctx.agentId || ctx.agent_id,
      userId: ctx.userId || ctx.user_id,
      // iOS fast/deep mode: fast=homelab-only, deep=external web sources
      mode: ctx.mode,
      // Task stream model: upstream (complex), midstream (standard), downstream (simple), edge (no tools)
      taskStream: ctx.taskStream || ctx.task_stream,
      complexity: ctx.complexity,
      sensitivity: ctx.sensitivity || ctx.sensitivityLevel,
      dataScope: ctx.dataScope || ctx.data_scope,
      operationType: ctx.operationType || ctx.operation_type,
      preferredProvider: ctx.preferredProvider || ctx.preferred_provider,
      preferredModel: ctx.preferredModel || ctx.preferred_model,
      // User-controlled cost/quality knobs from iOS headers
      cacheStrategy: ctx.cacheStrategy || ctx.cache_strategy,
      promptMode: ctx.promptMode || ctx.prompt_mode,
      hasTools: tools.length > 0,
      toolCount: tools.length,
      model: request?.model,
      maxTokens: request?.max_tokens,
      capabilities: this.extractRequiredCapabilities(request)
    };
  }

  matchesRuleCondition(condition, context) {
    if (!condition || Object.keys(condition).length === 0) {
      return true;
    }

    if (typeof condition === 'string') {
      return this.evaluateExpressionCondition(condition, context);
    }

    if (condition.anyOf) {
      return condition.anyOf.some(entry => this.matchesRuleCondition(entry, context));
    }

    if (condition.allOf) {
      return condition.allOf.every(entry => this.matchesRuleCondition(entry, context));
    }

    if (condition.not) {
      return !this.matchesRuleCondition(condition.not, context);
    }

    if (condition.field) {
      return this.evaluateFieldCondition(condition, context);
    }

    return Object.entries(condition).every(([key, value]) =>
      this.evaluateFieldCondition({ field: key, equals: value }, context)
    );
  }

  evaluateFieldCondition(condition, context) {
    const fieldValue = context[condition.field];

    if (Object.prototype.hasOwnProperty.call(condition, 'exists')) {
      return condition.exists ? fieldValue !== undefined && fieldValue !== null && fieldValue !== ''
        : fieldValue === undefined || fieldValue === null || fieldValue === '';
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
      return fieldValue === condition.equals;
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'in')) {
      return Array.isArray(condition.in) && condition.in.includes(fieldValue);
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'includes')) {
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(condition.includes);
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(condition.includes);
      }
      return false;
    }

    // Numeric comparisons for toolCount, maxTokens, etc.
    if (Object.prototype.hasOwnProperty.call(condition, 'greaterThan')) {
      const numValue = typeof fieldValue === 'number' ? fieldValue : parseInt(fieldValue, 10);
      return !isNaN(numValue) && numValue > condition.greaterThan;
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'lessThan')) {
      const numValue = typeof fieldValue === 'number' ? fieldValue : parseInt(fieldValue, 10);
      return !isNaN(numValue) && numValue < condition.lessThan;
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'greaterThanOrEqual')) {
      const numValue = typeof fieldValue === 'number' ? fieldValue : parseInt(fieldValue, 10);
      return !isNaN(numValue) && numValue >= condition.greaterThanOrEqual;
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'lessThanOrEqual')) {
      const numValue = typeof fieldValue === 'number' ? fieldValue : parseInt(fieldValue, 10);
      return !isNaN(numValue) && numValue <= condition.lessThanOrEqual;
    }

    return fieldValue === condition;
  }

  evaluateExpressionCondition(expression, context) {
    const match = expression.match(/^\s*([a-zA-Z0-9_\.]+)\s*(==|!=)\s*['"]?(.+?)['"]?\s*$/);
    if (!match) {
      return false;
    }

    const [, field, operator, value] = match;
    const fieldKey = field.replace(/\./g, '_');
    const fieldValue = context[fieldKey] ?? context[field];

    if (operator === '==') {
      return String(fieldValue) === value;
    }

    return String(fieldValue) !== value;
  }

  /**
   * Register a custom routing strategy
   */
  registerStrategy(name, strategyFunction) {
    this.routingStrategies.set(name, strategyFunction);
    console.log(`[Routing Engine] Registered strategy: ${name}`);
  }

  /**
   * Main routing function - selects best provider for a request
   */
  async routeRequest(request, options = {}) {
    try {
      // Check for aliasing bypass flag
      const skipAliasing = options.skipAliasing === true;
      
      // Model normalization - only Claude internal aliases
      // NOTE: GPT→Claude translation removed after Goose ACP bypass
      if (!skipAliasing && request && typeof request.model === 'string') {
        const original = request.model;
        let normalized = original;
        
        // Strip provider prefix for OpenClaw compatibility (openai/qwen3-32b -> qwen3-32b)
        if (original.startsWith('openai/')) {
          normalized = original.replace('openai/', '');
          console.log(`[Routing Engine] Stripped openai/ prefix: ${original} → ${normalized}`);
        }
        
        // Only handle Claude internal naming variants
        if (original === 'claude-sonnet-4-0') {
          normalized = 'claude-3-5-sonnet';  // Use stable Claude 3.5 Sonnet
        }
        
        if (normalized !== original) {
          console.log(`[Routing Engine] Model normalized (Claude internal): ${original} → ${normalized}`);
          request.model = normalized;
        }
      }
      const startTime = Date.now();

      const ruleMatch = this.applyRoutingRules(request, options);
      if (ruleMatch?.modelOverride) {
        console.log(`[Routing Engine] Routing rule model override: ${request.model} -> ${ruleMatch.modelOverride}`);
        request.model = ruleMatch.modelOverride;
      }
      const strategy = options.strategy || this.config.defaultStrategy;
      const routingFunction = this.routingStrategies.get(strategy);
      
      if (!routingFunction) {
        throw new Error(`Unknown routing strategy: ${strategy}`);
      }

      // Apply routing rule provider override (if any)
      if (ruleMatch?.targetProvider || (ruleMatch?.fallbackProviders && ruleMatch.fallbackProviders.length > 0)) {
        const ruleDecision = this.selectProviderFromRule(ruleMatch, request);
        if (ruleDecision) {
          const routingRecord = {
            timestamp: new Date().toISOString(),
            strategy: 'routing_rule',
            request: {
              model: request.model,
              tokens: this.estimateTokens(request),
              capabilities: this.extractRequiredCapabilities(request)
            },
            decision: ruleDecision,
            processingTime: Date.now() - startTime
          };

          this.recordRoutingDecision(routingRecord);
          this.emit('routing_decision', routingRecord);

          return ruleDecision;
        }
      }

      // Get available providers
      const availableProviders = this.getAvailableProviders(request);
      
      if (availableProviders.length === 0) {
        throw new Error('No available providers for this request');
      }

      // Apply routing strategy
      const routingDecision = await routingFunction(request, availableProviders, options);
      
      // Record routing decision
      const routingRecord = {
        timestamp: new Date().toISOString(),
        strategy,
        request: {
          model: request.model,
          tokens: this.estimateTokens(request),
          capabilities: this.extractRequiredCapabilities(request)
        },
        decision: routingDecision,
        processingTime: Date.now() - startTime
      };
      
      this.recordRoutingDecision(routingRecord);
      
      this.emit('routing_decision', routingRecord);
      
      return routingDecision;
    } catch (error) {
      // Enhanced error logging for debugging undefined provider issues
      console.error('[Routing Engine] routeRequest error:', error.message);
      if (error && error.stack) {
        console.error('[Routing Engine] routeRequest stack:', error.stack);
      }
      this.emit('routing_error', {
        error: error.message,
        request: request,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Cost-optimized routing strategy
   */
  async costOptimizedRouting(request, providers, options) {
    const costs = await Promise.all(
      providers.filter(p => p !== null && p !== undefined).map(async provider => {
        if (!provider) {
          console.error('[Routing Engine] ERROR: Undefined provider in cost calculation');
          return null;
        }
        const cost = await this.calculateRequestCost(request, provider);
        return { provider, cost };
      })
    ).then(results => results.filter(r => r !== null));

    // Sort by cost (ascending)
    costs.sort((a, b) => a.cost.total - b.cost.total);
    
    // Select cheapest healthy provider
    for (const { provider, cost } of costs) {
      if (await this.isProviderHealthy(provider)) {
        if (!provider) {
          console.error('[Routing Engine] ERROR: provider is undefined in cost-optimized routing');
          throw new Error('Provider is undefined in cost-optimized routing');
        }
        console.log(`[Routing Engine] Selected provider debug:`, {
          hasId: !!provider.id,
          id: provider.id,
          name: provider.name,
          type: provider.type
        });
        return {
          provider: provider.id, // Always use provider.id for ProviderManager Map lookup
          reason: 'cost_optimized',
          estimatedCost: cost,
          alternatives: costs.slice(1, 3).map(c => ({
            provider: c?.provider?.id || 'unknown',
            cost: c?.cost || 0
          }))
        };
      }
    }

    throw new Error('No healthy providers available for cost-optimized routing');
  }

  /**
   * Performance-first routing strategy
   */
  async performanceFirstRouting(request, providers, options) {
    const performances = providers.map(provider => {
      if (!provider) {
        console.error('[Routing Engine] ERROR: undefined provider in providers array');
        return null;
      }
      const metrics = this.performanceMetrics.get(provider.name) || {
        avgLatency: 1000,
        successRate: 0.95,
        throughput: 10
      };
      
      const score = (metrics.successRate * 0.5) + 
                   ((1000 / metrics.avgLatency) * 0.3) + 
                   ((metrics.throughput / 100) * 0.2);
      
      return { provider, score, metrics };
    }).filter(p => p !== null); // Filter out null providers

    // Sort by performance score (descending)
    performances.sort((a, b) => b.score - a.score);
    
    const best = performances[0];
    if (!best || !best.provider) {
      throw new Error('No valid provider found for performance routing');
    }
    return {
      provider: best.provider.id, // Always return provider.id
      reason: 'performance_first',
      performanceScore: best.score,
      metrics: best.metrics,
      alternatives: performances.slice(1, 3).map(p => ({
        provider: p?.provider?.id || 'unknown',
        score: p?.score || 0
      }))
    };
  }

  /**
   * Capability-matching routing strategy
   */
  async capabilityMatchRouting(request, providers, options) {
    const requiredCapabilities = this.extractRequiredCapabilities(request);
    
    const matches = providers.map(provider => {
      const providerCapabilities = provider.getAvailableModels()
        .find(model => model.id === request.model)?.capabilities || [];
      
      const matchScore = requiredCapabilities.reduce((score, capability) => {
        return score + (providerCapabilities.includes(capability) ? 1 : 0);
      }, 0) / requiredCapabilities.length;
      
      return { provider, matchScore, capabilities: providerCapabilities };
    });

    // Sort by capability match score (descending)
    matches.sort((a, b) => b.matchScore - a.matchScore);
    
    const best = matches[0];
    if (best.matchScore < 0.8) {
      console.warn(`[Routing Engine] Low capability match score: ${best.matchScore}`);
    }
    
    return {
      provider: best.provider.id || best.provider.name,
      reason: 'capability_match',
      matchScore: best.matchScore,
      requiredCapabilities,
      providerCapabilities: best.capabilities
    };
  }

  /**
   * Round-robin routing strategy
   */
  async roundRobinRouting(request, providers, options) {
    const healthyProviders = [];
    
    for (const provider of providers) {
      if (await this.isProviderHealthy(provider)) {
        healthyProviders.push(provider);
      }
    }
    
    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available for round-robin routing');
    }
    
    // Simple round-robin based on request count
    const requestCount = this.routingHistory.length;
    const selectedProvider = healthyProviders[requestCount % healthyProviders.length];
    
    return {
      provider: selectedProvider.id || selectedProvider.name,
      reason: 'round_robin',
      position: requestCount % healthyProviders.length,
      totalProviders: healthyProviders.length
    };
  }

  /**
   * Health-aware routing strategy
   */
  async healthAwareRouting(request, providers, options) {
    const healthScores = await Promise.all(
      providers.map(async (provider) => {
        const isHealthy = await this.isProviderHealthy(provider);
        const metrics = this.performanceMetrics.get(provider.name) || {};
        
        const healthScore = isHealthy ? 
          (metrics.successRate || 0.95) * (1 - (metrics.errorRate || 0.05)) : 0;
        
        return { provider, healthScore, isHealthy };
      })
    );

    // Sort by health score (descending)
    healthScores.sort((a, b) => b.healthScore - a.healthScore);
    
    const best = healthScores[0];
    if (!best.isHealthy) {
      throw new Error('No healthy providers available');
    }
    
    return {
      provider: best.provider.id || best.provider.name,
      reason: 'health_aware',
      healthScore: best.healthScore,
      alternatives: healthScores.slice(1, 3).map(h => ({
        provider: h.provider.id || h.provider.name,
        healthScore: h.healthScore
      }))
    };
  }

  /**
   * Hybrid routing strategy (combines cost, performance, and health)
   */
  async hybridRouting(request, providers, options) {
    const evaluations = await Promise.all(
      providers.map(async (provider) => {
        const cost = await this.calculateRequestCost(request, provider);
        const isHealthy = await this.isProviderHealthy(provider);
        const metrics = this.performanceMetrics.get(provider.name) || {
          avgLatency: 1000,
          successRate: 0.95,
          throughput: 10
        };
        
        if (!isHealthy) {
          return { provider, score: 0, cost, metrics, healthy: false };
        }
        
        // Normalize scores (0-1)
        const costScore = 1 / (1 + cost.total); // Lower cost = higher score
        const performanceScore = metrics.successRate * (1000 / metrics.avgLatency);
        const healthScore = metrics.successRate;
        
        // Weighted combination
        const totalScore = (
          costScore * this.config.costWeight +
          performanceScore * this.config.performanceWeight +
          healthScore * this.config.healthWeight
        );
        
        return { provider, score: totalScore, cost, metrics, healthy: true };
      })
    );

    // Sort by total score (descending)
    evaluations.sort((a, b) => b.score - a.score);
    
    const best = evaluations[0];
    if (!best.healthy) {
      throw new Error('No healthy providers available for hybrid routing');
    }
    
    return {
      provider: best.provider.id || best.provider.name,
      reason: 'hybrid',
      totalScore: best.score,
      breakdown: {
        cost: best.cost,
        performance: best.metrics,
        health: best.healthy
      },
      alternatives: evaluations.slice(1, 3).map(e => ({
        provider: e.provider.id || e.provider.name,
        score: e.score
      }))
    };
  }

  /**
   * Get available providers that support the requested model/capabilities
   */
  getAvailableProviders(request) {
    const allProviders = Array.from(this.providerManager.activeProviders.values()).filter(p => p !== null && p !== undefined);
    console.log(`[Routing Engine] Finding providers for model "${request.model}" from ${allProviders.length} active providers`);
    
    const availableProviders = allProviders.filter(provider => {
      // Safety check - should never happen but just in case
      if (!provider) {
        console.error('[Routing Engine] ERROR: Encountered undefined provider in filter');
        return false;
      }
      
      // Check if provider supports the requested model
      try {
        const models = provider.getAvailableModels();
        const hasModel = Array.isArray(models) && models.some(model => model.id === request.model);
        console.log(`[Routing Engine] Provider "${provider.name}" (id: ${provider.id}): ${hasModel ? 'HAS' : 'NO'} model ${request.model} (${models.length} total models)`);
        if (hasModel && !provider.id) {
          console.warn(`[Routing Engine] WARNING: Provider "${provider.name}" has model but missing id property!`);
        }
        return hasModel;
      } catch (error) {
        console.error(`[Routing Engine] Error getting models from provider "${provider.name}":`, error.message);
        return false;
      }
    });
    
    console.log(`[Routing Engine] Found ${availableProviders.length} providers with model "${request.model}"`);
    return availableProviders;
  }

  /**
   * Calculate estimated cost for a request with a specific provider
   */
  async calculateRequestCost(request, provider) {
    if (!provider) {
      console.error('[Routing Engine] ERROR: provider is undefined in calculateRequestCost');
      throw new Error('Provider is undefined in calculateRequestCost');
    }
    if (!provider.name) {
      console.error('[Routing Engine] ERROR: provider.name is undefined:', provider);
      throw new Error('Provider name is undefined');
    }
    
    const cacheKey = `${provider.name}-${request.model}-${JSON.stringify(request.messages)}`;
    
    if (this.costCache.has(cacheKey)) {
      const cached = this.costCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.config.cacheTimeout) {
        return cached.cost;
      }
    }
    
    const models = provider.getAvailableModels();
    const modelConfig = models.find(model => model.id === request.model);
    
    if (!modelConfig) {
      throw new Error(`Model ${request.model} not found in provider ${provider.name} (${provider.id})`);
    }
    
    if (!modelConfig.pricing || !modelConfig.pricing.input || !modelConfig.pricing.output) {
      console.error(`[Routing Engine] Model ${request.model} missing pricing data:`, modelConfig);
      throw new Error(`Model ${request.model} in provider ${provider.name} has invalid pricing configuration`);
    }
    
    const estimatedTokens = this.estimateTokens(request);
    const inputCost = (estimatedTokens.input / 1000000) * modelConfig.pricing.input;
    const outputCost = (estimatedTokens.output / 1000000) * modelConfig.pricing.output;
    
    const cost = {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
      currency: 'USD'
    };
    
    // Cache the result
    this.costCache.set(cacheKey, {
      cost,
      timestamp: Date.now()
    });
    
    return cost;
  }

  /**
   * Estimate token usage for a request
   */
  estimateTokens(request) {
    let inputTokens = 0;
    let outputTokens = request.max_tokens || 1000;
    
    if (request.messages) {
      for (const message of request.messages) {
        if (typeof message.content === 'string') {
          inputTokens += Math.ceil(message.content.length / 4); // Rough estimation
        } else if (Array.isArray(message.content)) {
          for (const item of message.content) {
            if (item.type === 'text') {
              inputTokens += Math.ceil(item.text.length / 4);
            } else if (item.type === 'image_url') {
              inputTokens += 1000; // Rough estimation for images
            }
          }
        }
      }
    }
    
    return { input: inputTokens, output: outputTokens };
  }

  /**
   * Extract required capabilities from a request
   */
  extractRequiredCapabilities(request) {
    const capabilities = ['text'];
    
    if (request.messages) {
      for (const message of request.messages) {
        if (Array.isArray(message.content)) {
          for (const item of message.content) {
            if (item.type === 'image_url') {
              capabilities.push('vision');
            }
          }
        }
      }
    }
    
    if (request.tools && request.tools.length > 0) {
      capabilities.push('tools');
    }
    
    if (request.thinking) {
      capabilities.push('thinking');
    }
    
    return [...new Set(capabilities)];
  }

  /**
   * Check if a provider is healthy
   */
  async isProviderHealthy(provider) {
    try {
      return await provider.healthCheck();
    } catch (error) {
      return false;
    }
  }

  /**
   * Record routing decision for analytics
   */
  recordRoutingDecision(record) {
    this.routingHistory.push(record);
    
    // Maintain history size limit
    if (this.routingHistory.length > this.maxHistorySize) {
      this.routingHistory.shift();
    }
    
    // Update performance metrics
    this.updatePerformanceMetrics(record);
  }

  /**
   * Update performance metrics based on routing results
   */
  updatePerformanceMetrics(record) {
    const providerName = record.decision.provider;
    const existing = this.performanceMetrics.get(providerName) || {
      avgLatency: 1000,
      successRate: 0.95,
      throughput: 10,
      totalRequests: 0,
      totalLatency: 0
    };
    
    existing.totalRequests++;
    existing.totalLatency += record.processingTime;
    existing.avgLatency = existing.totalLatency / existing.totalRequests;
    
    this.performanceMetrics.set(providerName, existing);
  }

  /**
   * Get routing analytics
   */
  getAnalytics(timeRange = 3600000) { // Default: 1 hour
    const cutoff = Date.now() - timeRange;
    const recentHistory = this.routingHistory.filter(
      record => new Date(record.timestamp).getTime() > cutoff
    );
    
    const analytics = {
      totalRequests: recentHistory.length,
      strategies: {},
      providers: {},
      avgProcessingTime: 0,
      costSavings: 0
    };
    
    let totalProcessingTime = 0;
    
    for (const record of recentHistory) {
      // Strategy breakdown
      analytics.strategies[record.strategy] = 
        (analytics.strategies[record.strategy] || 0) + 1;
      
      // Provider breakdown
      analytics.providers[record.decision.provider] = 
        (analytics.providers[record.decision.provider] || 0) + 1;
      
      totalProcessingTime += record.processingTime;
    }
    
    analytics.avgProcessingTime = totalProcessingTime / recentHistory.length || 0;
    
    return analytics;
  }

  /**
   * Update routing configuration
   */
  updateConfig(newConfig) {
    console.log('[Routing Engine] updateConfig called with:', JSON.stringify(newConfig, null, 2));
    console.log('[Routing Engine] Current config before update:', JSON.stringify(this.config, null, 2));
    this.config = { ...this.config, ...newConfig };
    console.log('[Routing Engine] Current config after update:', JSON.stringify(this.config, null, 2));
    console.log('[Routing Engine] Routing rules count:', this.config.routingRules?.length || 0);
    this.emit('config_updated', this.config);
  }

  /**
   * Get current routing configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get available routing strategies
   */
  getAvailableStrategies() {
    return Array.from(this.routingStrategies.keys());
  }

  /**
   * Clear caches and reset metrics
   */
  reset() {
    this.costCache.clear();
    this.performanceMetrics.clear();
    this.routingHistory.length = 0;
    console.log('[Routing Engine] Reset completed');
  }
}

module.exports = RoutingEngine;
