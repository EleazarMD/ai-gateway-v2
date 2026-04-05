/**
 * Multi-Tenant API Key Manager for AI Gateway v2.0
 * 
 * Supports hierarchical API key management:
 * Project → Service → Provider → API Key
 * 
 * Features:
 * - Project-level isolation
 * - Service-specific keys
 * - Multiple keys per service+provider
 * - Primary key selection
 * - Usage tracking per service
 * - Cost limits and rate limits
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class MultiTenantAPIKeyManager extends EventEmitter {
  constructor(postgresWrapper, config = {}) {
    super();
    
    this.db = postgresWrapper;
    this.encryptionKey = config.encryptionKey || process.env.API_KEY_ENCRYPTION_KEY;
    
    if (!this.encryptionKey) {
      this.encryptionKey = crypto.randomBytes(32);
      console.warn('[Multi-Tenant API Key Manager] No encryption key provided, generated random key');
    }
    
    // In-memory cache for fast lookups
    this.keyCache = new Map(); // service_id:provider -> key_data
    
    console.log('[Multi-Tenant API Key Manager] Initialized');
  }
  
  /**
   * Initialize the manager and create tables
   */
  async initialize() {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const schemaPath = path.join(__dirname, '../storage/multi-tenant-api-keys-schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      await this.db.exec(schema);
      
      console.log('[Multi-Tenant API Key Manager] Database schema initialized');
      
      // Load active keys into cache
      await this.refreshCache();
      
      return true;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Encrypt an API key
   */
  encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.isBuffer(this.encryptionKey) ? this.encryptionKey : Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }
  
  /**
   * Decrypt an API key
   */
  decrypt(encrypted) {
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.isBuffer(this.encryptionKey) ? this.encryptionKey : Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  /**
   * Hash a key for quick lookup (without exposing the key)
   */
  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
  
  /**
   * Add or update an API key for a service
   */
  async setKey(projectId, serviceId, provider, apiKey, options = {}) {
    try {
      const keyId = `${projectId}-${serviceId}-${provider}-${Date.now()}`;
      const encryptedKey = this.encrypt(apiKey);
      const keyHash = this.hashKey(apiKey);
      
      const isPrimary = options.isPrimary !== undefined ? options.isPrimary : true;
      
      // If setting as primary, unset any existing primary keys
      if (isPrimary) {
        await this.db.exec(
          `UPDATE api_keys_multi_tenant 
           SET is_primary = false 
           WHERE service_id = $1 AND provider = $2 AND is_primary = true`,
          [serviceId, provider]
        );
      }
      
      const result = await this.db.query(
        `INSERT INTO api_keys_multi_tenant (
          key_id, project_id, service_id, provider, provider_display_name,
          encrypted_key, key_hash, is_active, is_primary,
          rate_limit_per_minute, rate_limit_per_day,
          cost_limit_daily, cost_limit_monthly,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (service_id, provider, key_hash) 
        DO UPDATE SET 
          is_active = $8,
          is_primary = $9,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [
          keyId,
          projectId,
          serviceId,
          provider,
          options.displayName || this.getProviderDisplayName(provider),
          encryptedKey,
          keyHash,
          true, // is_active
          isPrimary,
          options.rateLimitPerMinute || null,
          options.rateLimitPerDay || null,
          options.costLimitDaily || null,
          options.costLimitMonthly || null,
          JSON.stringify(options.metadata || {})
        ]
      );
      
      // Update cache
      await this.refreshCache();
      
      console.log(`[Multi-Tenant API Key Manager] Set key for ${projectId}/${serviceId}/${provider}`);
      
      this.emit('keyAdded', { projectId, serviceId, provider, keyId });
      
      return result.rows[0];
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to set key:', error);
      throw error;
    }
  }
  
  /**
   * Get the primary API key for a service+provider combination
   */
  async getKey(serviceId, provider) {
    try {
      // Check cache first
      const cacheKey = `${serviceId}:${provider}`;
      if (this.keyCache.has(cacheKey)) {
        const cached = this.keyCache.get(cacheKey);
        if (cached && cached.is_active) {
          return this.decrypt(cached.encrypted_key);
        }
      }
      
      // Query database
      const result = await this.db.query(
        `SELECT encrypted_key, is_active 
         FROM api_keys_multi_tenant 
         WHERE service_id = $1 AND provider = $2 AND is_primary = true AND is_active = true
         LIMIT 1`,
        [serviceId, provider]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const decryptedKey = this.decrypt(result.rows[0].encrypted_key);
      
      // Update cache
      this.keyCache.set(cacheKey, result.rows[0]);
      
      return decryptedKey;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to get key:', error);
      return null;
    }
  }
  
  /**
   * Get all keys for a service
   */
  async getServiceKeys(serviceId) {
    try {
      const result = await this.db.query(
        `SELECT 
          k.key_id, k.project_id, k.service_id, k.provider, k.provider_display_name,
          k.is_active, k.is_primary, k.last_validated, k.validation_status,
          k.rate_limit_per_minute, k.rate_limit_per_day,
          k.cost_limit_daily, k.cost_limit_monthly,
          k.created_at, k.updated_at, k.metadata
         FROM api_keys_multi_tenant k
         WHERE k.service_id = $1
         ORDER BY k.provider, k.is_primary DESC, k.created_at DESC`,
        [serviceId]
      );
      
      return result.rows;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to get service keys:', error);
      return [];
    }
  }
  
  /**
   * Get all keys for a project
   */
  async getProjectKeys(projectId) {
    try {
      const result = await this.db.query(
        `SELECT 
          k.key_id, k.project_id, k.service_id, k.provider, k.provider_display_name,
          k.is_active, k.is_primary, k.last_validated, k.validation_status,
          s.name as service_name,
          k.created_at, k.updated_at
         FROM api_keys_multi_tenant k
         JOIN services s ON k.service_id = s.service_id
         WHERE k.project_id = $1
         ORDER BY s.name, k.provider, k.is_primary DESC`,
        [projectId]
      );
      
      return result.rows;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to get project keys:', error);
      return [];
    }
  }
  
  /**
   * List all projects
   */
  async listProjects() {
    try {
      const result = await this.db.query(
        `SELECT p.*, 
          (SELECT COUNT(*) FROM services WHERE project_id = p.project_id) as service_count,
          (SELECT COUNT(*) FROM api_keys_multi_tenant WHERE project_id = p.project_id) as key_count
         FROM projects p
         ORDER BY p.name`
      );
      
      return result.rows;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to list projects:', error);
      return [];
    }
  }
  
  /**
   * List services for a project
   */
  async listServices(projectId = null) {
    try {
      const query = projectId
        ? `SELECT s.*,
            p.name as project_name,
            (SELECT COUNT(*) FROM api_keys_multi_tenant WHERE service_id = s.service_id) as key_count
           FROM services s
           JOIN projects p ON s.project_id = p.project_id
           WHERE s.project_id = $1
           ORDER BY s.name`
        : `SELECT s.*,
            p.name as project_name,
            (SELECT COUNT(*) FROM api_keys_multi_tenant WHERE service_id = s.service_id) as key_count
           FROM services s
           JOIN projects p ON s.project_id = p.project_id
           ORDER BY p.name, s.name`;
      
      const result = projectId
        ? await this.db.query(query, [projectId])
        : await this.db.query(query);
      
      return result.rows;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to list services:', error);
      return [];
    }
  }
  
  /**
   * Create a new project
   */
  async createProject(projectId, name, description = '') {
    try {
      const result = await this.db.query(
        `INSERT INTO projects (project_id, name, description, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING *`,
        [projectId, name, description]
      );
      
      console.log(`[Multi-Tenant API Key Manager] Created project: ${projectId}`);
      return result.rows[0];
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to create project:', error);
      throw error;
    }
  }
  
  /**
   * Create a new service
   */
  async createService(projectId, serviceId, name, description = '') {
    try {
      const result = await this.db.query(
        `INSERT INTO services (service_id, project_id, name, description, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING *`,
        [serviceId, projectId, name, description]
      );
      
      console.log(`[Multi-Tenant API Key Manager] Created service: ${serviceId} in project ${projectId}`);
      return result.rows[0];
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to create service:', error);
      throw error;
    }
  }
  
  /**
   * Delete an API key
   */
  async deleteKey(keyId) {
    try {
      await this.db.exec(
        `DELETE FROM api_keys_multi_tenant WHERE key_id = $1`,
        [keyId]
      );
      
      await this.refreshCache();
      
      console.log(`[Multi-Tenant API Key Manager] Deleted key: ${keyId}`);
      this.emit('keyDeleted', { keyId });
      
      return true;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to delete key:', error);
      throw error;
    }
  }
  
  /**
   * Record API key usage
   */
  async recordUsage(serviceId, provider, metrics) {
    try {
      // Find the key that was used
      const keyResult = await this.db.query(
        `SELECT key_id FROM api_keys_multi_tenant
         WHERE service_id = $1 AND provider = $2 AND is_primary = true`,
        [serviceId, provider]
      );
      
      if (keyResult.rows.length === 0) {
        console.warn(`[Multi-Tenant API Key Manager] No key found for usage recording: ${serviceId}/${provider}`);
        return;
      }
      
      const keyId = keyResult.rows[0].key_id;
      
      // Get project_id
      const serviceResult = await this.db.query(
        `SELECT project_id FROM services WHERE service_id = $1`,
        [serviceId]
      );
      
      if (serviceResult.rows.length === 0) {
        console.warn(`[Multi-Tenant API Key Manager] Service not found: ${serviceId}`);
        return;
      }
      
      const projectId = serviceResult.rows[0].project_id;
      
      // Update or insert usage record
      await this.db.exec(
        `INSERT INTO api_key_usage_multi_tenant (
          key_id, project_id, service_id, provider,
          usage_date, request_count, success_count, error_count,
          prompt_tokens, completion_tokens, total_tokens, cost_usd
        ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (key_id, usage_date)
        DO UPDATE SET
          request_count = api_key_usage_multi_tenant.request_count + $5,
          success_count = api_key_usage_multi_tenant.success_count + $6,
          error_count = api_key_usage_multi_tenant.error_count + $7,
          prompt_tokens = api_key_usage_multi_tenant.prompt_tokens + $8,
          completion_tokens = api_key_usage_multi_tenant.completion_tokens + $9,
          total_tokens = api_key_usage_multi_tenant.total_tokens + $10,
          cost_usd = api_key_usage_multi_tenant.cost_usd + $11,
          last_updated = CURRENT_TIMESTAMP`,
        [
          keyId,
          projectId,
          serviceId,
          provider,
          metrics.requestCount || 1,
          metrics.successCount || (metrics.error ? 0 : 1),
          metrics.errorCount || (metrics.error ? 1 : 0),
          metrics.promptTokens || 0,
          metrics.completionTokens || 0,
          metrics.totalTokens || 0,
          metrics.cost || 0
        ]
      );
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to record usage:', error);
    }
  }
  
  /**
   * Get usage summary for a service
   */
  async getServiceUsage(serviceId, days = 30) {
    try {
      const result = await this.db.query(
        `SELECT 
          provider,
          SUM(request_count) as total_requests,
          SUM(success_count) as total_success,
          SUM(error_count) as total_errors,
          SUM(total_tokens) as total_tokens,
          SUM(cost_usd) as total_cost
         FROM api_key_usage_multi_tenant
         WHERE service_id = $1 
           AND usage_date >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY provider
         ORDER BY total_requests DESC`,
        [serviceId]
      );
      
      return result.rows;
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to get service usage:', error);
      return [];
    }
  }
  
  /**
   * Refresh the in-memory cache
   */
  async refreshCache() {
    try {
      const result = await this.db.query(
        `SELECT service_id, provider, encrypted_key, is_active
         FROM api_keys_multi_tenant
         WHERE is_primary = true AND is_active = true`
      );
      
      this.keyCache.clear();
      
      for (const row of result.rows) {
        const cacheKey = `${row.service_id}:${row.provider}`;
        this.keyCache.set(cacheKey, row);
      }
      
      console.log(`[Multi-Tenant API Key Manager] Cache refreshed: ${this.keyCache.size} keys loaded`);
    } catch (error) {
      console.error('[Multi-Tenant API Key Manager] Failed to refresh cache:', error);
    }
  }
  
  /**
   * Get provider display name
   */
  getProviderDisplayName(provider) {
    const names = {
      'openai': 'OpenAI',
      'google': 'Google Gemini',
      'anthropic': 'Anthropic Claude',
      'ollama': 'Ollama (Local)',
      'perplexity': 'Perplexity',
    };
    
    return names[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

module.exports = MultiTenantAPIKeyManager;
