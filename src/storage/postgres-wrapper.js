/**
 * PostgreSQL Wrapper for AI Gateway v2.0
 * Replaces SQLite3 for k3d deployment compatibility
 */

const { Pool } = require('pg');
const EventEmitter = require('events');

class PostgreSQLWrapper extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      host: config.host || process.env.POSTGRES_HOST || 'localhost',
      port: config.port || process.env.POSTGRES_PORT || 5432,
      database: config.database || process.env.POSTGRES_DB || 'ai_gateway',
      user: config.user || process.env.POSTGRES_USER || 'ai_gateway',
      password: config.password || process.env.POSTGRES_PASSWORD || 'ai_gateway_pass',
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    };
    
    this.pool = null;
    this.isConnected = false;
  }
  
  /**
   * Connect to PostgreSQL database with retry logic
   */
  async connect(maxRetries = 10, retryDelay = 2000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.pool = new Pool(this.config);
        
        // Test connection
        const client = await this.pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        
        this.isConnected = true;
        this.emit('connected');
        
        console.log(`[PostgreSQLWrapper] Connected to PostgreSQL at ${this.config.host}:${this.config.port} (attempt ${attempt})`);
        return true;
      } catch (error) {
        lastError = error;
        console.log(`[PostgreSQLWrapper] Connection attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          console.log(`[PostgreSQLWrapper] Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          
          // Close any existing pool before retry
          if (this.pool) {
            try {
              await this.pool.end();
            } catch (e) {
              // Ignore cleanup errors
            }
            this.pool = null;
          }
        }
      }
    }
    
    console.error(`[PostgreSQLWrapper] Failed to connect after ${maxRetries} attempts:`, lastError.message);
    this.emit('error', lastError);
    throw lastError;
  }
  
  /**
   * Disconnect from PostgreSQL database
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      this.emit('disconnected');
      console.log('[PostgreSQLWrapper] Disconnected from PostgreSQL');
    }
  }
  
  /**
   * Execute SQL query
   */
  async query(text, params = []) {
    if (!this.isConnected) {
      throw new Error('PostgreSQL not connected');
    }
    
    try {
      const result = await this.pool.query(text, params);
      return result;
    } catch (error) {
      console.error('[PostgreSQLWrapper] Query failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Execute multiple SQL statements
   */
  async exec(sql) {
    if (!this.isConnected) {
      throw new Error('PostgreSQL not connected');
    }
    
    try {
      const statements = sql.split(';').filter(stmt => stmt.trim());
      const results = [];
      
      for (const statement of statements) {
        if (statement.trim()) {
          const result = await this.pool.query(statement);
          results.push(result);
        }
      }
      
      return results;
    } catch (error) {
      console.error('[PostgreSQLWrapper] Exec failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Get a single row
   */
  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }
  
  /**
   * Get all rows
   */
  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }
  
  /**
   * Run SQL with no return value expected
   */
  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return {
      changes: result.rowCount,
      lastID: result.rows[0]?.id || null
    };
  }
  
  /**
   * Begin transaction
   */
  async beginTransaction() {
    return await this.query('BEGIN');
  }
  
  /**
   * Commit transaction
   */
  async commitTransaction() {
    return await this.query('COMMIT');
  }
  
  /**
   * Rollback transaction
   */
  async rollbackTransaction() {
    return await this.query('ROLLBACK');
  }
  
  /**
   * Check if table exists
   */
  async tableExists(tableName) {
    const result = await this.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  }
  
  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      poolSize: this.pool ? this.pool.totalCount : 0,
      idleConnections: this.pool ? this.pool.idleCount : 0,
      waitingClients: this.pool ? this.pool.waitingCount : 0
    };
  }
}

module.exports = PostgreSQLWrapper;
