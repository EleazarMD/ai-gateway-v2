/**
 * API Key Manager for AI Gateway v2.0
 * Handles secure storage, validation, and management of LLM provider API keys
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const winston = require('winston');

class APIKeyManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.postgresWrapper = config.postgresWrapper;
    this.redisClient = config.redisClient;
    this.encryptionKey = config.encryptionKey || process.env.API_KEY_ENCRYPTION_KEY || this.generateEncryptionKey();
    
    // In-memory cache for active API keys
    this.keyCache = new Map();
    
    // Logger setup
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './logs/api-key-manager.log' })
      ]
    });
    
    this.logger.info('API Key Manager initialized');
  }
  
  /**
   * Initialize API Key Manager
   */
  async initialize() {
    try {
      await this.createTables();
      await this.loadCachedKeys();
      this.logger.info('API Key Manager initialized successfully');
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize API Key Manager', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Create database tables for API key storage
   */
  async createTables() {
    if (!this.postgresWrapper) {
      this.logger.warn('PostgreSQL not available, using in-memory storage only');
      return;
    }
    
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        provider_id TEXT NOT NULL UNIQUE,
        provider_name TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_validated TIMESTAMP,
        validation_status TEXT DEFAULT 'pending',
        metadata JSONB DEFAULT '{}'
      );
      
      CREATE TABLE IF NOT EXISTS api_key_usage (
        id SERIAL PRIMARY KEY,
        provider_id TEXT NOT NULL,
        usage_date DATE DEFAULT CURRENT_DATE,
        request_count INTEGER DEFAULT 0,
        token_count INTEGER DEFAULT 0,
        cost_usd DECIMAL(10,4) DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider_id, usage_date)
      );
      
      CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider_id);
      CREATE INDEX IF NOT EXISTS idx_api_key_usage_provider_date ON api_key_usage(provider_id, usage_date);
    `;
    
    await this.postgresWrapper.exec(createTableSQL);
    this.logger.info('API Key database tables created');
  }
  
  /**
   * Generate a secure encryption key
   */
  generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }
  
  /**
   * Encrypt API key for secure storage
   */
  encryptAPIKey(apiKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }
  
  /**
   * Decrypt API key for use
   */
  decryptAPIKey(encryptedKey) {
    const parts = encryptedKey.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  
  /**
   * Create hash of API key for validation
   */
  hashAPIKey(apiKey) {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }
  
  /**
   * Store API key for a provider
   */
  async storeAPIKey(providerId, providerName, apiKey, metadata = {}) {
    try {
      const encryptedKey = this.encryptAPIKey(apiKey);
      const keyHash = this.hashAPIKey(apiKey);
      
      // Store in database if available
      if (this.postgresWrapper) {
        await this.postgresWrapper.query(
          `INSERT INTO api_keys (provider_id, provider_name, encrypted_key, key_hash, metadata, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (provider_id) 
           DO UPDATE SET 
             encrypted_key = $3,
             key_hash = $4,
             metadata = $5,
             updated_at = CURRENT_TIMESTAMP`,
          [providerId, providerName, encryptedKey, keyHash, JSON.stringify(metadata)]
        );
      }
      
      // Cache the decrypted key for immediate use
      this.keyCache.set(providerId, {
        apiKey,
        providerName,
        metadata,
        storedAt: new Date(),
        isActive: true
      });
      
      // Store in Redis for distributed access
      if (this.redisClient) {
        await this.redisClient.hset('api_keys', providerId, JSON.stringify({
          encryptedKey,
          providerName,
          metadata,
          storedAt: new Date().toISOString()
        }));
      }
      
      this.logger.info('API key stored successfully', { providerId, providerName });
      this.emit('key_stored', { providerId, providerName, metadata });
      
      return { success: true, providerId };
    } catch (error) {
      this.logger.error('Failed to store API key', { providerId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Retrieve API key for a provider
   */
  async getAPIKey(providerId) {
    try {
      // Check cache first
      if (this.keyCache.has(providerId)) {
        const cached = this.keyCache.get(providerId);
        if (cached.isActive) {
          return cached.apiKey;
        }
      }
      
      // Check Redis
      if (this.redisClient) {
        const redisData = await this.redisClient.hget('api_keys', providerId);
        if (redisData) {
          const parsed = JSON.parse(redisData);
          const decryptedKey = this.decryptAPIKey(parsed.encryptedKey);
          
          // Update cache
          this.keyCache.set(providerId, {
            apiKey: decryptedKey,
            providerName: parsed.providerName,
            metadata: parsed.metadata,
            storedAt: new Date(parsed.storedAt),
            isActive: true
          });
          
          return decryptedKey;
        }
      }
      
      // Check database
      if (this.postgresWrapper) {
        const result = await this.postgresWrapper.get(
          'SELECT encrypted_key, provider_name, metadata FROM api_keys WHERE provider_id = $1 AND is_active = true',
          [providerId]
        );
        
        if (result) {
          const decryptedKey = this.decryptAPIKey(result.encrypted_key);
          
          // Update cache
          this.keyCache.set(providerId, {
            apiKey: decryptedKey,
            providerName: result.provider_name,
            metadata: result.metadata || {},
            storedAt: new Date(),
            isActive: true
          });
          
          return decryptedKey;
        }
      }
      
      return null;
    } catch (error) {
      this.logger.error('Failed to retrieve API key', { providerId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Validate API key with provider
   */
  async validateAPIKey(providerId, apiKey) {
    try {
      // This would typically make a test API call to the provider
      // For now, we'll implement basic validation
      const isValid = apiKey && apiKey.length > 10;
      
      if (this.postgresWrapper) {
        await this.postgresWrapper.query(
          'UPDATE api_keys SET last_validated = CURRENT_TIMESTAMP, validation_status = $1 WHERE provider_id = $2',
          [isValid ? 'valid' : 'invalid', providerId]
        );
      }
      
      this.logger.info('API key validation completed', { providerId, isValid });
      this.emit('key_validated', { providerId, isValid });
      
      return isValid;
    } catch (error) {
      this.logger.error('Failed to validate API key', { providerId, error: error.message });
      return false;
    }
  }
  
  /**
   * Remove API key for a provider
   */
  async removeAPIKey(providerId) {
    try {
      // Remove from database
      if (this.postgresWrapper) {
        await this.postgresWrapper.query(
          'UPDATE api_keys SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE provider_id = $1',
          [providerId]
        );
      }
      
      // Remove from cache
      this.keyCache.delete(providerId);
      
      // Remove from Redis
      if (this.redisClient) {
        await this.redisClient.hdel('api_keys', providerId);
      }
      
      this.logger.info('API key removed successfully', { providerId });
      this.emit('key_removed', { providerId });
      
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to remove API key', { providerId, error: error.message });
      throw error;
    }
  }
  
  /**
   * List all configured providers
   */
  async listProviders() {
    try {
      const providers = [];
      
      // Get from database if available
      if (this.postgresWrapper) {
        const results = await this.postgresWrapper.all(
          `SELECT provider_id, provider_name, validation_status, last_validated, 
                  created_at, updated_at, metadata
           FROM api_keys WHERE is_active = true
           ORDER BY provider_name`
        );
        
        for (const row of results) {
          providers.push({
            providerId: row.provider_id,
            providerName: row.provider_name,
            hasAPIKey: true,
            validationStatus: row.validation_status,
            lastValidated: row.last_validated,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            metadata: row.metadata || {}
          });
        }
      } else {
        // Fallback to cache
        for (const [providerId, data] of this.keyCache.entries()) {
          if (data.isActive) {
            providers.push({
              providerId,
              providerName: data.providerName,
              hasAPIKey: true,
              validationStatus: 'pending',
              lastValidated: null,
              createdAt: data.storedAt,
              updatedAt: data.storedAt,
              metadata: data.metadata || {}
            });
          }
        }
      }
      
      return providers;
    } catch (error) {
      this.logger.error('Failed to list providers', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Get provider statistics
   */
  async getProviderStats(providerId, days = 30) {
    try {
      if (!this.postgresWrapper) {
        return { requestCount: 0, tokenCount: 0, costUsd: 0 };
      }
      
      const result = await this.postgresWrapper.get(
        `SELECT 
           SUM(request_count) as total_requests,
           SUM(token_count) as total_tokens,
           SUM(cost_usd) as total_cost
         FROM api_key_usage 
         WHERE provider_id = $1 
           AND usage_date >= CURRENT_DATE - INTERVAL '${days} days'`,
        [providerId]
      );
      
      return {
        requestCount: parseInt(result?.total_requests || 0),
        tokenCount: parseInt(result?.total_tokens || 0),
        costUsd: parseFloat(result?.total_cost || 0)
      };
    } catch (error) {
      this.logger.error('Failed to get provider stats', { providerId, error: error.message });
      return { requestCount: 0, tokenCount: 0, costUsd: 0 };
    }
  }
  
  /**
   * Record API usage
   */
  async recordUsage(providerId, requestCount = 1, tokenCount = 0, costUsd = 0) {
    try {
      if (!this.postgresWrapper) {
        return;
      }
      
      await this.postgresWrapper.query(
        `INSERT INTO api_key_usage (provider_id, request_count, token_count, cost_usd)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider_id, usage_date)
         DO UPDATE SET 
           request_count = api_key_usage.request_count + $2,
           token_count = api_key_usage.token_count + $3,
           cost_usd = api_key_usage.cost_usd + $4,
           last_updated = CURRENT_TIMESTAMP`,
        [providerId, requestCount, tokenCount, costUsd]
      );
      
      this.emit('usage_recorded', { providerId, requestCount, tokenCount, costUsd });
    } catch (error) {
      this.logger.error('Failed to record usage', { providerId, error: error.message });
    }
  }
  
  /**
   * Load cached keys from storage
   */
  async loadCachedKeys() {
    try {
      if (this.redisClient) {
        const keys = await this.redisClient.hgetall('api_keys');
        for (const [providerId, data] of Object.entries(keys)) {
          const parsed = JSON.parse(data);
          const decryptedKey = this.decryptAPIKey(parsed.encryptedKey);
          
          this.keyCache.set(providerId, {
            apiKey: decryptedKey,
            providerName: parsed.providerName,
            metadata: parsed.metadata,
            storedAt: new Date(parsed.storedAt),
            isActive: true
          });
        }
        
        this.logger.info(`Loaded ${Object.keys(keys).length} API keys from cache`);
      }
    } catch (error) {
      this.logger.error('Failed to load cached keys', { error: error.message });
    }
  }
  
  /**
   * Get API Key Manager status
   */
  getStatus() {
    return {
      initialized: true,
      cachedKeys: this.keyCache.size,
      hasPostgres: !!this.postgresWrapper,
      hasRedis: !!this.redisClient,
      encryptionEnabled: !!this.encryptionKey
    };
  }
}

module.exports = APIKeyManager;
