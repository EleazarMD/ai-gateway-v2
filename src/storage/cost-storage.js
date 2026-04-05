const { Pool } = require('pg');

/**
 * PostgreSQL storage for cost tracking data
 * Handles persistence and aggregation of cost records
 */
class CostStorage {
  constructor(dbConfig) {
    this.pool = new Pool(dbConfig);
    this.initialized = false;
    console.log('[Cost Storage] Initializing PostgreSQL storage');
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
      console.log('[Cost Storage] Schema initialized successfully');
    } catch (error) {
      console.error('[Cost Storage] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Create database schema
   */
  async createSchema() {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_gateway_costs (
        id SERIAL PRIMARY KEY,
        trace_id UUID,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        provider VARCHAR(100) NOT NULL,
        model VARCHAR(255) NOT NULL,
        client_id VARCHAR(255),
        
        -- Token usage
        tokens_prompt INTEGER DEFAULT 0,
        tokens_completion INTEGER DEFAULT 0,
        tokens_total INTEGER DEFAULT 0,
        
        -- Costs in USD
        cost_prompt DECIMAL(10, 6) DEFAULT 0,
        cost_completion DECIMAL(10, 6) DEFAULT 0,
        cost_total DECIMAL(10, 6) DEFAULT 0,
        
        -- Metadata
        tags JSONB,
        
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;
    
    await this.pool.query(createTableQuery);
  }

  /**
   * Create indexes
   */
  async createIndexes() {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_costs_timestamp ON ai_gateway_costs(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_costs_provider ON ai_gateway_costs(provider)',
      'CREATE INDEX IF NOT EXISTS idx_costs_model ON ai_gateway_costs(model)',
      'CREATE INDEX IF NOT EXISTS idx_costs_client ON ai_gateway_costs(client_id)',
      'CREATE INDEX IF NOT EXISTS idx_costs_trace ON ai_gateway_costs(trace_id)',
    ];
    
    for (const indexQuery of indexes) {
      await this.pool.query(indexQuery);
    }
  }

  /**
   * Save cost record
   */
  async saveCostRecord(record) {
    const query = `
      INSERT INTO ai_gateway_costs (
        trace_id, timestamp, provider, model, client_id,
        tokens_prompt, tokens_completion, tokens_total,
        cost_prompt, cost_completion, cost_total, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;
    
    const values = [
      record.traceId,
      record.timestamp,
      record.provider,
      record.model,
      record.client,
      record.tokens.prompt_tokens || 0,
      record.tokens.completion_tokens || 0,
      record.tokens.total_tokens || 0,
      record.cost.prompt,
      record.cost.completion,
      record.cost.total,
      JSON.stringify(record.tags || []),
    ];
    
    await this.pool.query(query, values);
  }

  /**
   * Get cost analytics
   */
  async getCostAnalytics(filters) {
    const { timeRange, groupBy, clientId, provider, model } = filters;
    
    const interval = this.getTimeInterval(timeRange);
    const groupColumn = this.getGroupColumn(groupBy);
    
    let query = `
      SELECT
        ${groupColumn} as group_key,
        COUNT(*) as request_count,
        SUM(tokens_total) as total_tokens,
        SUM(cost_total) as total_cost,
        AVG(cost_total) as avg_cost,
        MIN(cost_total) as min_cost,
        MAX(cost_total) as max_cost
      FROM ai_gateway_costs
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
    `;
    
    const values = [];
    let paramIndex = 1;
    
    if (clientId) {
      query += ` AND client_id = $${paramIndex++}`;
      values.push(clientId);
    }
    
    if (provider) {
      query += ` AND provider = $${paramIndex++}`;
      values.push(provider);
    }
    
    if (model) {
      query += ` AND model = $${paramIndex++}`;
      values.push(model);
    }
    
    query += ` GROUP BY ${groupColumn} ORDER BY total_cost DESC`;
    
    const result = await this.pool.query(query, values);
    
    return {
      breakdown: result.rows.map(row => ({
        key: row.group_key,
        requests: parseInt(row.request_count),
        tokens: parseInt(row.total_tokens),
        totalCost: parseFloat(row.total_cost),
        avgCost: parseFloat(row.avg_cost),
        minCost: parseFloat(row.min_cost),
        maxCost: parseFloat(row.max_cost),
      })),
      total: result.rows.reduce((sum, row) => sum + parseFloat(row.total_cost), 0),
    };
  }

  /**
   * Get cost summary
   */
  async getCostSummary(timeRange = '24h') {
    const interval = this.getTimeInterval(timeRange);
    
    const query = `
      SELECT
        SUM(cost_total) as total_cost,
        SUM(tokens_total) as total_tokens,
        COUNT(*) as total_requests,
        AVG(cost_total) as avg_cost_per_request,
        
        -- By provider
        jsonb_object_agg(
          DISTINCT provider,
          (SELECT SUM(cost_total) FROM ai_gateway_costs c2 
           WHERE c2.provider = ai_gateway_costs.provider 
           AND c2.timestamp >= NOW() - INTERVAL '${interval}')
        ) FILTER (WHERE provider IS NOT NULL) as by_provider,
        
        -- By model
        jsonb_object_agg(
          DISTINCT model,
          (SELECT SUM(cost_total) FROM ai_gateway_costs c3 
           WHERE c3.model = ai_gateway_costs.model 
           AND c3.timestamp >= NOW() - INTERVAL '${interval}')
        ) FILTER (WHERE model IS NOT NULL) as by_model,
        
        -- By client
        jsonb_object_agg(
          DISTINCT client_id,
          (SELECT SUM(cost_total) FROM ai_gateway_costs c4 
           WHERE c4.client_id = ai_gateway_costs.client_id 
           AND c4.timestamp >= NOW() - INTERVAL '${interval}')
        ) FILTER (WHERE client_id IS NOT NULL) as by_client
        
      FROM ai_gateway_costs
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
    `;
    
    const result = await this.pool.query(query);
    const row = result.rows[0];
    
    // Get trend data
    const trendQuery = `
      SELECT
        DATE_TRUNC('hour', timestamp) as hour,
        SUM(cost_total) as cost,
        COUNT(*) as requests
      FROM ai_gateway_costs
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
      GROUP BY hour
      ORDER BY hour ASC
    `;
    
    const trendResult = await this.pool.query(trendQuery);
    
    return {
      total: parseFloat(row.total_cost) || 0,
      totalTokens: parseInt(row.total_tokens) || 0,
      totalRequests: parseInt(row.total_requests) || 0,
      avgCostPerRequest: parseFloat(row.avg_cost_per_request) || 0,
      byProvider: row.by_provider || {},
      byModel: row.by_model || {},
      byClient: row.by_client || {},
      trend: trendResult.rows.map(r => ({
        timestamp: r.hour,
        cost: parseFloat(r.cost),
        requests: parseInt(r.requests),
      })),
    };
  }

  /**
   * Get top spending entities
   */
  async getTopSpenders(type = 'client', limit = 10, timeRange = '24h') {
    const interval = this.getTimeInterval(timeRange);
    const column = type === 'client' ? 'client_id' : type === 'model' ? 'model' : 'provider';
    
    const query = `
      SELECT
        ${column} as entity,
        SUM(cost_total) as total_cost,
        SUM(tokens_total) as total_tokens,
        COUNT(*) as request_count
      FROM ai_gateway_costs
      WHERE timestamp >= NOW() - INTERVAL '${interval}'
        AND ${column} IS NOT NULL
      GROUP BY ${column}
      ORDER BY total_cost DESC
      LIMIT $1
    `;
    
    const result = await this.pool.query(query, [limit]);
    
    return result.rows.map(row => ({
      entity: row.entity,
      totalCost: parseFloat(row.total_cost),
      totalTokens: parseInt(row.total_tokens),
      requestCount: parseInt(row.request_count),
    }));
  }

  /**
   * Helper: Get time interval string
   */
  getTimeInterval(timeRange) {
    const map = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    return map[timeRange] || '24 hours';
  }

  /**
   * Helper: Get group by column
   */
  getGroupColumn(groupBy) {
    const map = {
      'provider': 'provider',
      'model': 'model',
      'client': 'client_id',
      'hour': "DATE_TRUNC('hour', timestamp)",
      'day': "DATE_TRUNC('day', timestamp)",
    };
    return map[groupBy] || 'provider';
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = CostStorage;
