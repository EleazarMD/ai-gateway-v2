const { Pool } = require('pg');

/**
 * PostgreSQL storage for request traces
 * Handles persistence, querying, and aggregation of trace data
 */
class TraceStorage {
  constructor(dbConfig) {
    this.pool = new Pool(dbConfig);
    this.initialized = false;
    console.log('[Trace Storage] Initializing PostgreSQL storage');
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      await this.createSchema();
      await this.createIndexes();
      this.initialized = true;
      console.log('[Trace Storage] Schema initialized successfully');
    } catch (error) {
      console.error('[Trace Storage] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Create database schema
   */
  async createSchema() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_gateway_traces (
        trace_id UUID PRIMARY KEY,
        span_id UUID NOT NULL,
        parent_span_id UUID,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        start_time BIGINT NOT NULL,
        end_time BIGINT,
        duration INTEGER,
        
        -- Request data
        request_method VARCHAR(10),
        request_path VARCHAR(255),
        request_model VARCHAR(255),
        request_provider VARCHAR(100),
        request_stream BOOLEAN,
        request_messages_count INTEGER,
        request_temperature REAL,
        request_max_tokens INTEGER,
        
        -- Client data
        client_id VARCHAR(255),
        client_ip VARCHAR(45),
        client_user_agent TEXT,
        client_auth_method VARCHAR(50),
        
        -- Routing data
        routing_strategy VARCHAR(100),
        routing_selected_provider VARCHAR(100),
        routing_fallback_chain JSONB,
        routing_retries INTEGER DEFAULT 0,
        
        -- Response data
        response_status_code INTEGER,
        response_model VARCHAR(255),
        response_provider VARCHAR(100),
        response_finish_reason VARCHAR(50),
        response_content TEXT,
        
        -- Error data
        error_message TEXT,
        error_code VARCHAR(100),
        error_provider VARCHAR(100),
        error_stack TEXT,
        
        -- Metrics
        tokens_prompt INTEGER DEFAULT 0,
        tokens_completion INTEGER DEFAULT 0,
        tokens_total INTEGER DEFAULT 0,
        latency_routing INTEGER DEFAULT 0,
        latency_provider INTEGER DEFAULT 0,
        latency_total INTEGER DEFAULT 0,
        cost_prompt DECIMAL(10, 6) DEFAULT 0,
        cost_completion DECIMAL(10, 6) DEFAULT 0,
        cost_total DECIMAL(10, 6) DEFAULT 0,
        
        -- Status
        status VARCHAR(50) NOT NULL,
        status_code INTEGER,
        
        -- Indexes
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    await this.pool.query(createTableQuery);
  }

  /**
   * Create indexes for performance
   */
  async createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON ai_gateway_traces(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_traces_status ON ai_gateway_traces(status)',
      'CREATE INDEX IF NOT EXISTS idx_traces_provider ON ai_gateway_traces(response_provider)',
      'CREATE INDEX IF NOT EXISTS idx_traces_model ON ai_gateway_traces(request_model)',
      'CREATE INDEX IF NOT EXISTS idx_traces_client ON ai_gateway_traces(client_id)',
      'CREATE INDEX IF NOT EXISTS idx_traces_duration ON ai_gateway_traces(duration)',
      'CREATE INDEX IF NOT EXISTS idx_traces_cost ON ai_gateway_traces(cost_total)',
      'CREATE INDEX IF NOT EXISTS idx_traces_created ON ai_gateway_traces(created_at DESC)',
    ];
    
    for (const indexQuery of indexes) {
      await this.pool.query(indexQuery);
    }
  }

  /**
   * Save trace to database
   */
  async saveTrace(trace) {
    const query = `
      INSERT INTO ai_gateway_traces (
        trace_id, span_id, parent_span_id, timestamp, start_time, end_time, duration,
        request_method, request_path, request_model, request_provider, request_stream,
        request_messages_count, request_temperature, request_max_tokens,
        client_id, client_ip, client_user_agent, client_auth_method,
        routing_strategy, routing_selected_provider, routing_fallback_chain, routing_retries,
        response_status_code, response_model, response_provider, response_finish_reason, response_content,
        error_message, error_code, error_provider, error_stack,
        tokens_prompt, tokens_completion, tokens_total,
        latency_routing, latency_provider, latency_total,
        cost_prompt, cost_completion, cost_total,
        status, status_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34, $35,
        $36, $37, $38,
        $39, $40, $41,
        $42, $43
      )
      ON CONFLICT (trace_id) DO UPDATE SET
        end_time = EXCLUDED.end_time,
        duration = EXCLUDED.duration,
        response_status_code = EXCLUDED.response_status_code,
        response_model = EXCLUDED.response_model,
        response_provider = EXCLUDED.response_provider,
        response_finish_reason = EXCLUDED.response_finish_reason,
        response_content = EXCLUDED.response_content,
        error_message = EXCLUDED.error_message,
        error_code = EXCLUDED.error_code,
        error_provider = EXCLUDED.error_provider,
        error_stack = EXCLUDED.error_stack,
        tokens_prompt = EXCLUDED.tokens_prompt,
        tokens_completion = EXCLUDED.tokens_completion,
        tokens_total = EXCLUDED.tokens_total,
        latency_routing = EXCLUDED.latency_routing,
        latency_provider = EXCLUDED.latency_provider,
        latency_total = EXCLUDED.latency_total,
        cost_prompt = EXCLUDED.cost_prompt,
        cost_completion = EXCLUDED.cost_completion,
        cost_total = EXCLUDED.cost_total,
        status = EXCLUDED.status,
        status_code = EXCLUDED.status_code
    `;
    
    const values = [
      trace.traceId,
      trace.spanId,
      trace.parentSpanId,
      trace.timestamp,
      trace.startTime,
      trace.endTime,
      trace.duration,
      trace.request?.method,
      trace.request?.path,
      trace.request?.model,
      trace.request?.provider,
      trace.request?.stream,
      trace.request?.messages,
      trace.request?.temperature,
      trace.request?.maxTokens,
      trace.client?.id,
      trace.client?.ip,
      trace.client?.userAgent,
      trace.client?.authMethod,
      trace.routing?.strategy,
      trace.routing?.selectedProvider,
      JSON.stringify(trace.routing?.fallbackChain || []),
      trace.routing?.retries || 0,
      trace.response?.statusCode,
      trace.response?.model,
      trace.response?.provider,
      trace.response?.finishReason,
      trace.response?.content,
      trace.error?.message,
      trace.error?.code,
      trace.error?.provider,
      trace.error?.stack,
      trace.metrics?.tokenCount?.prompt || 0,
      trace.metrics?.tokenCount?.completion || 0,
      trace.metrics?.tokenCount?.total || 0,
      trace.metrics?.latency?.routing || 0,
      trace.metrics?.latency?.provider || 0,
      trace.metrics?.latency?.total || 0,
      trace.metrics?.cost?.prompt || 0,
      trace.metrics?.cost?.completion || 0,
      trace.metrics?.cost?.total || 0,
      trace.status,
      trace.statusCode,
    ];
    
    await this.pool.query(query, values);
  }

  /**
   * Query traces with filters
   */
  async queryTraces(filters) {
    const {
      startDate,
      endDate,
      status,
      provider,
      model,
      clientId,
      minDuration,
      maxDuration,
      hasError,
      limit = 100,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = filters;
    
    let query = 'SELECT * FROM ai_gateway_traces WHERE 1=1';
    const values = [];
    let paramIndex = 1;
    
    if (startDate) {
      query += ` AND timestamp >= $${paramIndex++}`;
      values.push(startDate);
    }
    
    if (endDate) {
      query += ` AND timestamp <= $${paramIndex++}`;
      values.push(endDate);
    }
    
    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }
    
    if (provider) {
      query += ` AND response_provider = $${paramIndex++}`;
      values.push(provider);
    }
    
    if (model) {
      query += ` AND request_model = $${paramIndex++}`;
      values.push(model);
    }
    
    if (clientId) {
      query += ` AND client_id = $${paramIndex++}`;
      values.push(clientId);
    }
    
    if (minDuration !== null && minDuration !== undefined) {
      query += ` AND duration >= $${paramIndex++}`;
      values.push(minDuration);
    }
    
    if (maxDuration !== null && maxDuration !== undefined) {
      query += ` AND duration <= $${paramIndex++}`;
      values.push(maxDuration);
    }
    
    if (hasError !== null && hasError !== undefined) {
      if (hasError) {
        query += ` AND error_message IS NOT NULL`;
      } else {
        query += ` AND error_message IS NULL`;
      }
    }
    
    const validSortColumns = ['timestamp', 'duration', 'cost_total', 'created_at'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'timestamp';
    const sortDir = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY ${sortColumn} ${sortDir}`;
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(limit, offset);
    
    const result = await this.pool.query(query, values);
    return result.rows.map(row => this.deserializeTrace(row));
  }

  /**
   * Get single trace by ID
   */
  async getTrace(traceId) {
    const query = 'SELECT * FROM ai_gateway_traces WHERE trace_id = $1';
    const result = await this.pool.query(query, [traceId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.deserializeTrace(result.rows[0]);
  }

  /**
   * Get trace statistics
   */
  async getTraceStatistics(timeRange = '1h') {
    const timeRangeMap = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    
    const interval = timeRangeMap[timeRange] || '1 hour';
    
    const query = `
      SELECT
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_requests,
        COUNT(*) FILTER (WHERE status = 'error') as failed_requests,
        AVG(duration) as avg_duration,
        AVG(cost_total) as avg_cost,
        SUM(cost_total) as total_cost,
        SUM(tokens_total) as total_tokens,
        jsonb_object_agg(
          COALESCE(response_provider, 'unknown'),
          provider_count
        ) as by_provider
      FROM ai_gateway_traces
      CROSS JOIN LATERAL (
        SELECT COUNT(*) as provider_count
        FROM ai_gateway_traces t2
        WHERE t2.response_provider = ai_gateway_traces.response_provider
          AND t2.timestamp >= NOW() - INTERVAL '${interval}'
      ) provider_stats
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
    `;
    
    const result = await this.pool.query(query);
    const row = result.rows[0];
    
    return {
      totalRequests: parseInt(row.total_requests) || 0,
      successfulRequests: parseInt(row.successful_requests) || 0,
      failedRequests: parseInt(row.failed_requests) || 0,
      successRate: row.total_requests > 0 
        ? (row.successful_requests / row.total_requests) * 100 
        : 0,
      errorRate: row.total_requests > 0 
        ? (row.failed_requests / row.total_requests) * 100 
        : 0,
      avgDuration: parseFloat(row.avg_duration) || 0,
      avgCost: parseFloat(row.avg_cost) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      byProvider: row.by_provider || {},
    };
  }

  /**
   * Delete traces before a certain date
   */
  async deleteTracesBefore(cutoffDate) {
    const query = 'DELETE FROM ai_gateway_traces WHERE timestamp < $1';
    const result = await this.pool.query(query, [cutoffDate]);
    return result.rowCount;
  }

  /**
   * Deserialize database row to trace object
   */
  deserializeTrace(row) {
    return {
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id,
      timestamp: row.timestamp,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      request: {
        method: row.request_method,
        path: row.request_path,
        model: row.request_model,
        provider: row.request_provider,
        stream: row.request_stream,
        messages: row.request_messages_count,
        temperature: row.request_temperature,
        maxTokens: row.request_max_tokens,
      },
      client: {
        id: row.client_id,
        ip: row.client_ip,
        userAgent: row.client_user_agent,
        authMethod: row.client_auth_method,
      },
      routing: {
        strategy: row.routing_strategy,
        selectedProvider: row.routing_selected_provider,
        fallbackChain: row.routing_fallback_chain,
        retries: row.routing_retries,
      },
      response: row.response_status_code ? {
        statusCode: row.response_status_code,
        model: row.response_model,
        provider: row.response_provider,
        finishReason: row.response_finish_reason,
        content: row.response_content,
      } : null,
      error: row.error_message ? {
        message: row.error_message,
        code: row.error_code,
        provider: row.error_provider,
        stack: row.error_stack,
      } : null,
      metrics: {
        tokenCount: {
          prompt: row.tokens_prompt,
          completion: row.tokens_completion,
          total: row.tokens_total,
        },
        latency: {
          routing: row.latency_routing,
          provider: row.latency_provider,
          total: row.latency_total,
        },
        cost: {
          prompt: parseFloat(row.cost_prompt),
          completion: parseFloat(row.cost_completion),
          total: parseFloat(row.cost_total),
        },
      },
      status: row.status,
      statusCode: row.status_code,
      createdAt: row.created_at,
    };
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = TraceStorage;
