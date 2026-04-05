const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * Request Tracing Service for AI Gateway v2.1
 * Comprehensive request/response tracking, tracing, and debugging
 * Features: Distributed tracing, request history, error tracking, performance analysis
 */
class RequestTracingService extends EventEmitter {
  constructor(storage) {
    super();
    this.storage = storage;
    this.activeTraces = new Map();
    this.traceRetention = 7 * 24 * 60 * 60 * 1000; // 7 days
    this.maxInMemoryTraces = 10000;
    
    console.log('[Request Tracing] Service initialized');
    
    // Cleanup old traces periodically
    setInterval(() => this.cleanupOldTraces(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Start a new trace for an incoming request
   */
  startTrace(request, metadata = {}) {
    const traceId = uuidv4();
    const spanId = uuidv4();
    
    const trace = {
      traceId,
      spanId,
      parentSpanId: metadata.parentSpanId || null,
      timestamp: new Date().toISOString(),
      startTime: Date.now(),
      endTime: null,
      duration: null,
      
      // Request information
      request: {
        method: request.method || 'POST',
        path: request.path || '/api/v1/chat/completions',
        model: request.model,
        provider: request.provider || null,
        stream: request.stream || false,
        messages: request.messages ? request.messages.length : 0,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        topP: request.top_p,
        headers: this.sanitizeHeaders(request.headers || {}),
      },
      
      // Client information
      client: {
        id: metadata.clientId || 'unknown',
        ip: metadata.clientIp || 'unknown',
        userAgent: metadata.userAgent || 'unknown',
        authMethod: metadata.authMethod || 'api_key',
      },
      
      // Routing information
      routing: {
        strategy: metadata.routingStrategy || 'unknown',
        selectedProvider: null,
        fallbackChain: [],
        retries: 0,
      },
      
      // Response information (populated later)
      response: null,
      
      // Error information (if any)
      error: null,
      
      // Performance metrics
      metrics: {
        tokenCount: {
          prompt: 0,
          completion: 0,
          total: 0,
        },
        latency: {
          routing: 0,
          provider: 0,
          total: 0,
        },
        cost: {
          prompt: 0,
          completion: 0,
          total: 0,
        },
      },
      
      // Status
      status: 'in_progress',
      statusCode: null,
    };
    
    this.activeTraces.set(traceId, trace);
    this.emit('trace_started', { traceId, spanId });
    
    return { traceId, spanId };
  }

  /**
   * Update trace with routing decision
   */
  updateRouting(traceId, routingInfo) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      console.warn(`[Request Tracing] Trace not found: ${traceId}`);
      return;
    }
    
    trace.routing.selectedProvider = routingInfo.provider;
    trace.routing.strategy = routingInfo.strategy;
    trace.routing.fallbackChain = routingInfo.fallbackChain || [];
    trace.metrics.latency.routing = routingInfo.routingTime || 0;
    
    this.emit('trace_routing_updated', { traceId, routingInfo });
  }

  /**
   * Update trace with provider request details
   */
  updateProviderRequest(traceId, providerInfo) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;
    
    trace.request.provider = providerInfo.provider;
    trace.routing.selectedProvider = providerInfo.provider;
    
    this.emit('trace_provider_request', { traceId, provider: providerInfo.provider });
  }

  /**
   * Complete trace with response data
   */
  completeTrace(traceId, response, metrics = {}) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      console.warn(`[Request Tracing] Trace not found: ${traceId}`);
      return;
    }
    
    const endTime = Date.now();
    trace.endTime = endTime;
    trace.duration = endTime - trace.startTime;
    trace.status = 'completed';
    trace.statusCode = response.statusCode || 200;
    
    // Store response data
    trace.response = {
      statusCode: response.statusCode || 200,
      model: response.model,
      provider: response.provider,
      finishReason: response.finishReason,
      content: response.stream ? '[streaming]' : this.truncateContent(response.content),
      usage: response.usage || null,
    };
    
    // Update metrics
    if (metrics.tokens) {
      trace.metrics.tokenCount = metrics.tokens;
    }
    if (metrics.cost) {
      trace.metrics.cost = metrics.cost;
    }
    if (metrics.latency) {
      trace.metrics.latency.provider = metrics.latency.provider || 0;
      trace.metrics.latency.total = trace.duration;
    }
    
    // Move to storage
    this.persistTrace(trace);
    this.activeTraces.delete(traceId);
    
    this.emit('trace_completed', { traceId, duration: trace.duration });
  }

  /**
   * Record trace error
   */
  recordError(traceId, error, statusCode = 500) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      console.warn(`[Request Tracing] Trace not found: ${traceId}`);
      return;
    }
    
    const endTime = Date.now();
    trace.endTime = endTime;
    trace.duration = endTime - trace.startTime;
    trace.status = 'error';
    trace.statusCode = statusCode;
    
    trace.error = {
      message: error.message || error.toString(),
      code: error.code || 'UNKNOWN_ERROR',
      provider: error.provider || trace.routing.selectedProvider,
      stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : null,
    };
    
    // Update retry count if applicable
    if (error.retry) {
      trace.routing.retries += 1;
    }
    
    // Move to storage
    this.persistTrace(trace);
    this.activeTraces.delete(traceId);
    
    this.emit('trace_error', { traceId, error: trace.error });
  }

  /**
   * Query traces with filters
   */
  async queryTraces(filters = {}, options = {}) {
    const {
      startDate = null,
      endDate = null,
      status = null,
      provider = null,
      model = null,
      clientId = null,
      minDuration = null,
      maxDuration = null,
      hasError = null,
      limit = 100,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = { ...filters, ...options };
    
    try {
      const traces = await this.storage.queryTraces({
        startDate,
        endDate,
        status,
        provider,
        model,
        clientId,
        minDuration,
        maxDuration,
        hasError,
        limit,
        offset,
        sortBy,
        sortOrder,
      });
      
      return traces;
    } catch (error) {
      console.error('[Request Tracing] Query error:', error);
      return [];
    }
  }

  /**
   * Get trace by ID
   */
  async getTrace(traceId) {
    // Check active traces first
    if (this.activeTraces.has(traceId)) {
      return this.activeTraces.get(traceId);
    }
    
    // Query from storage
    try {
      return await this.storage.getTrace(traceId);
    } catch (error) {
      console.error('[Request Tracing] Get trace error:', error);
      return null;
    }
  }

  /**
   * Get aggregated statistics
   */
  async getStatistics(timeRange = '1h') {
    try {
      const stats = await this.storage.getTraceStatistics(timeRange);
      return stats;
    } catch (error) {
      console.error('[Request Tracing] Statistics error:', error);
      return this.getDefaultStatistics();
    }
  }

  /**
   * Persist trace to storage
   */
  async persistTrace(trace) {
    try {
      await this.storage.saveTrace(trace);
    } catch (error) {
      console.error('[Request Tracing] Persist error:', error);
      // Fallback to in-memory if storage fails
    }
  }

  /**
   * Cleanup old traces
   */
  async cleanupOldTraces() {
    const cutoffDate = new Date(Date.now() - this.traceRetention);
    try {
      const deleted = await this.storage.deleteTracesBefore(cutoffDate);
      if (deleted > 0) {
        console.log(`[Request Tracing] Cleaned up ${deleted} old traces`);
      }
    } catch (error) {
      console.error('[Request Tracing] Cleanup error:', error);
    }
  }

  /**
   * Helper: Sanitize headers (remove sensitive data)
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveKeys = ['authorization', 'x-api-key', 'cookie', 'x-auth-token'];
    
    sensitiveKeys.forEach(key => {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Helper: Truncate content for storage
   */
  truncateContent(content, maxLength = 1000) {
    if (!content) return null;
    if (typeof content !== 'string') {
      content = JSON.stringify(content);
    }
    return content.length > maxLength 
      ? content.substring(0, maxLength) + '... [truncated]'
      : content;
  }

  /**
   * Helper: Default statistics
   */
  getDefaultStatistics() {
    return {
      totalRequests: 0,
      successRate: 0,
      errorRate: 0,
      avgDuration: 0,
      avgCost: 0,
      totalCost: 0,
      totalTokens: 0,
      byProvider: {},
      byModel: {},
      byStatus: {},
    };
  }

  /**
   * Get current active traces count
   */
  getActiveTracesCount() {
    return this.activeTraces.size;
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      activeTraces: this.activeTraces.size,
      maxInMemory: this.maxInMemoryTraces,
      utilizationPercent: (this.activeTraces.size / this.maxInMemoryTraces) * 100,
    };
  }
}

module.exports = RequestTracingService;
