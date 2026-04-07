/**
 * API Key Service
 * Manages API keys with component identification and usage tracking
 */

class APIKeyService {
  constructor(postgresWrapper) {
    this.db = postgresWrapper;
    this.keyCache = new Map(); // Cache for performance
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
    this.logger = {
      info: (...args) => console.log('[APIKeyService]', ...args),
      error: (...args) => console.error('[APIKeyService]', ...args),
      warn: (...args) => console.warn('[APIKeyService]', ...args)
    };
  }

  async initialize() {
    this.logger.info('Initializing API Key Service...');
    
    if (!this.db || !this.db.isConnected) {
      this.logger.warn('Database not connected, API key validation will be limited');
      return;
    }

    // Load all active keys into cache
    await this.refreshCache();
    
    // Refresh cache periodically
    setInterval(() => {
      this.refreshCache().catch(err => 
        this.logger.error('Failed to refresh key cache:', err)
      );
    }, this.cacheExpiry);

    this.logger.info('API Key Service initialized');
  }

  /**
   * Refresh the API key cache
   */
  async refreshCache() {
    if (!this.db || !this.db.isConnected) {
      return;
    }

    try {
      const result = await this.db.query(
        `SELECT component_name, component_type, api_key_hash
         FROM api_key_components`
      );

      this.keyCache.clear();
      for (const mapping of result.rows) {
        // Store by hash for quick lookup
        this.keyCache.set(mapping.api_key_hash, {
          component: mapping.component_name,
          componentType: mapping.component_type,
          cachedAt: Date.now()
        });
      }

      this.logger.info(`Cached ${this.keyCache.size} component API key mappings`);
    } catch (error) {
      this.logger.error('Failed to refresh cache:', error);
    }
  }

  /**
   * Validate an API key and return component information
   */
  async validateKey(apiKey) {
    if (!apiKey) {
      return {
        valid: false,
        component: 'unknown',
        componentType: 'unknown',
        reason: 'No API key provided'
      };
    }

    // Compute SHA256 hash of the API key
    const crypto = require('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Check cache first
    console.log('[APIKeyService] Looking up hash:', keyHash, 'cache size:', this.keyCache.size);
    const cached = this.keyCache.get(keyHash);
    console.log('[APIKeyService] Cache hit:', !!cached);
    if (cached) {
      // Check if cache is still fresh
      if (Date.now() - cached.cachedAt < this.cacheExpiry) {
        console.log('[APIKeyService] Returning valid from cache for:', cached.component);
        return {
          valid: true,
          component: cached.component,
          componentType: cached.componentType,
          scopes: ['read', 'write'],
          rateLimitTier: cached.componentType === 'service' ? 'high' : 'standard',
          isInternal: cached.componentType === 'service' || cached.componentType === 'dashboard'
        };
      }
    }

    // Fallback to database query
    if (!this.db || !this.db.isConnected) {
      // If DB is down, check environment variables for legacy keys
      if (apiKey === process.env.API_KEY) {
        return {
          valid: true,
          component: 'legacy-client',
          componentType: 'client',
          scopes: ['read', 'write'],
          rateLimitTier: 'standard',
          isInternal: false,
          fallback: true
        };
      }
      if (apiKey === process.env.ADMIN_KEY || apiKey === process.env.ADMIN_API_KEY) {
        return {
          valid: true,
          component: 'admin',
          componentType: 'admin',
          scopes: ['read', 'write', 'admin'],
          rateLimitTier: 'unlimited',
          isInternal: true,
          fallback: true
        };
      }
      return {
        valid: false,
        component: 'unknown',
        componentType: 'unknown',
        reason: 'Database unavailable'
      };
    }

    try {
      const result = await this.db.query(
        `SELECT component_name, component_type
         FROM api_key_components 
         WHERE api_key_hash = $1`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        // Not in component mapping, return generic identifier
        return {
          valid: true,
          component: `api-key-${apiKey.substring(0, 8)}`,
          componentType: 'client',
          scopes: ['read', 'write'],
          rateLimitTier: 'standard',
          isInternal: false
        };
      }

      const mapping = result.rows[0];
      
      // Update cache
      this.keyCache.set(keyHash, {
        component: mapping.component_name,
        componentType: mapping.component_type,
        cachedAt: Date.now()
      });

      return {
        valid: true,
        component: mapping.component_name,
        componentType: mapping.component_type,
        scopes: ['read', 'write'],
        rateLimitTier: mapping.component_type === 'service' ? 'high' : 'standard',
        isInternal: mapping.component_type === 'service' || mapping.component_type === 'dashboard'
      };
    } catch (error) {
      // If table doesn't exist or other DB error, fall back to env validation
      this.logger.warn('DB validation failed, falling back to env keys:', error.message);
      
      // Check environment variable keys as fallback
      if (apiKey === process.env.API_KEY) {
        return {
          valid: true,
          component: 'legacy-client',
          componentType: 'client',
          scopes: ['read', 'write'],
          rateLimitTier: 'standard',
          isInternal: false,
          fallback: true
        };
      }
      if (apiKey === process.env.ADMIN_KEY || apiKey === process.env.ADMIN_API_KEY) {
        return {
          valid: true,
          component: 'admin',
          componentType: 'admin',
          scopes: ['read', 'write', 'admin'],
          rateLimitTier: 'unlimited',
          isInternal: true,
          fallback: true
        };
      }
      if (apiKey === process.env.OPENCLAW_API_KEY) {
        return {
          valid: true,
          component: 'openclaw-agent',
          componentType: 'service',
          scopes: ['read', 'write'],
          rateLimitTier: 'high',
          isInternal: true,
          serviceId: 'openclaw-agent',
          fallback: true
        };
      }
      
      return {
        valid: false,
        component: 'unknown',
        componentType: 'unknown',
        reason: 'Validation error',
        error: error.message
      };
    }
  }

  /**
   * Log API key usage
   */
  async logUsage(apiKey, endpoint, method, statusCode, responseTimeMs, outcome, metadata = {}) {
    if (!this.db || !this.db.isConnected) {
      return;
    }

    try {
      await this.db.query(
        `SELECT log_api_key_usage($1, $2, $3, $4, $5, $6, $7)`,
        [apiKey, endpoint, method, statusCode, responseTimeMs, outcome, JSON.stringify(metadata)]
      );
    } catch (error) {
      // Don't throw - logging failures shouldn't break requests
      this.logger.error('Failed to log API key usage:', error);
    }
  }

  /**
   * Get component name from API key
   */
  async getComponentName(apiKey) {
    const validation = await this.validateKey(apiKey);
    return validation.component || 'unknown';
  }

  /**
   * Get all API keys (admin only)
   */
  async getAllKeys() {
    if (!this.db || !this.db.isConnected) {
      return [];
    }

    try {
      const result = await this.db.query(
        `SELECT * FROM api_keys_with_stats ORDER BY component_name`
      );
      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get API keys:', error);
      return [];
    }
  }

  /**
   * Create a new API key
   */
  async createKey(keyData) {
    if (!this.db || !this.db.isConnected) {
      throw new Error('Database not available');
    }

    const {
      apiKey,
      keyName,
      componentName,
      componentType,
      description,
      scopes = ['read'],
      rateLimitTier = 'standard',
      isInternal = false,
      expiresAt = null
    } = keyData;

    try {
      const result = await this.db.query(
        `INSERT INTO api_keys 
         (api_key, key_name, component_name, component_type, description, 
          scopes, rate_limit_tier, is_internal, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [apiKey, keyName, componentName, componentType, description, 
         scopes, rateLimitTier, isInternal, expiresAt]
      );

      // Refresh cache
      await this.refreshCache();

      this.logger.info(`Created API key for component: ${componentName}`);
      return result.rows[0];
    } catch (error) {
      this.logger.error('Failed to create API key:', error);
      throw error;
    }
  }

  /**
   * Revoke an API key
   */
  async revokeKey(apiKey) {
    if (!this.db || !this.db.isConnected) {
      throw new Error('Database not available');
    }

    try {
      await this.db.query(
        `UPDATE api_keys SET is_active = false WHERE api_key = $1`,
        [apiKey]
      );

      // Remove from cache
      this.keyCache.delete(apiKey);

      this.logger.info(`Revoked API key: ${apiKey}`);
    } catch (error) {
      this.logger.error('Failed to revoke API key:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics for a component
   */
  async getComponentUsage(componentName, hours = 24) {
    if (!this.db || !this.db.isConnected) {
      return null;
    }

    try {
      const result = await this.db.query(
        `SELECT 
           component_name,
           COUNT(*) as total_requests,
           COUNT(*) FILTER (WHERE outcome = 'success') as successful_requests,
           COUNT(*) FILTER (WHERE outcome = 'denied') as denied_requests,
           COUNT(*) FILTER (WHERE outcome = 'error') as error_requests,
           AVG(response_time_ms) as avg_response_time,
           MAX(timestamp) as last_request
         FROM api_key_usage
         WHERE component_name = $1
         AND timestamp > NOW() - INTERVAL '${hours} hours'
         GROUP BY component_name`,
        [componentName]
      );

      return result.rows[0] || null;
    } catch (error) {
      this.logger.error('Failed to get component usage:', error);
      return null;
    }
  }
}

module.exports = APIKeyService;
