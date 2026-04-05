/**
 * Rate Limiting Middleware
 * Implements per-API-key rate limiting with Redis backing
 * and per-key concurrency semaphore with queuing.
 *
 * Tiered limits aligned with ecosystem subscription tiers:
 *   admin     → unlimited (bypass all limits)
 *   premium   → generous limits for power users
 *   family    → moderate limits for family plan
 *   free      → conservative but usable limits
 *
 * Internal infrastructure keys (OpenClaw, gateway) bypass entirely.
 */

// ─── Tiered rate limit configuration ────────────────────────────────────────
const TIER_LIMITS = {
  admin:   { perMinute: Infinity, perHour: Infinity,  perDay: Infinity,   maxConcurrent: 128 },
  premium: { perMinute: 120,      perHour: 5000,      perDay: 50000,      maxConcurrent: 32  },
  family:  { perMinute: 60,       perHour: 2000,      perDay: 20000,      maxConcurrent: 16  },
  free:    { perMinute: 20,       perHour: 500,       perDay: 5000,       maxConcurrent: 8   },
};

// Fallback when DB is unavailable — generous enough not to block local dev
const FALLBACK_LIMITS = TIER_LIMITS.premium;

// How long a queued request waits for a slot before being rejected (ms)
const CONCURRENCY_QUEUE_TIMEOUT_MS = 60000;

// API keys that bypass rate limiting entirely (local/internal services)
const RATE_LIMIT_EXEMPT_KEYS = new Set([
  process.env.OPENCLAW_API_KEY,
  process.env.API_KEY,
  process.env.ADMIN_API_KEY,
  'ai-gateway-api-key-2024',
].filter(Boolean));

class RateLimitingMiddleware {
  constructor(postgresWrapper, redisClient = null) {
    this.db = postgresWrapper;
    this.redis = redisClient;
    
    // In-memory fallback if Redis is not available
    this.inMemoryLimits = new Map();
    
    // Per-key concurrency tracking: key -> { inflight: number, queue: Array<{resolve, reject, timer}> }
    this.concurrency = new Map();
    
    // Cleanup interval for in-memory limits
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }
  
  /**
   * Rate limiting middleware function
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Extract API key from request
        const apiKey = req.headers['x-api-key'] || 
                       req.headers['authorization']?.replace('Bearer ', '');
        
        if (!apiKey) {
          return next(); // No API key, skip rate limiting
        }
        
        // Exempt internal/local API keys from rate limiting
        if (RATE_LIMIT_EXEMPT_KEYS.has(apiKey)) {
          return next();
        }
        
        // Get rate limit configuration for this key based on subscription tier
        const config = await this.getRateLimitConfig(apiKey, req);
        
        if (!config) {
          return next(); // No rate limit configured
        }
        
        // Check rate limits (requests per time window)
        const allowed = await this.checkRateLimit(apiKey, config);
        
        if (!allowed) {
          // Log rate limit violation
          if (req.anomalyService) {
            await req.anomalyService.detectRateLimitAnomaly(apiKey, req.path);
          }
          
          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: 60
          });
        }
        
        // Acquire concurrency slot (may queue if at capacity)
        const maxConcurrent = config.maxConcurrent || DEFAULT_MAX_CONCURRENT;
        try {
          await this.acquireConcurrencySlot(apiKey, maxConcurrent);
        } catch (concurrencyErr) {
          return res.status(429).json({
            error: 'Concurrency limit exceeded',
            message: concurrencyErr.message,
            retryAfter: 5
          });
        }
        
        // Set concurrency headers for observability
        const slot = this.concurrency.get(apiKey);
        res.setHeader('X-Concurrent-Inflight', slot ? slot.inflight : 0);
        res.setHeader('X-Concurrent-Limit', maxConcurrent);
        res.setHeader('X-Concurrent-Queued', slot ? slot.queue.length : 0);
        
        // Release slot when response finishes (success or error)
        res.on('finish', () => this.releaseConcurrencySlot(apiKey));
        res.on('close', () => this.releaseConcurrencySlot(apiKey));
        // Guard against double-release
        req._concurrencyKey = apiKey;
        req._concurrencyReleased = false;
        const origRelease = this.releaseConcurrencySlot.bind(this);
        const self = this;
        res.on('finish', function onFinish() {
          if (!req._concurrencyReleased) {
            req._concurrencyReleased = true;
            origRelease(apiKey);
          }
        });
        // Remove the duplicate close handler, finish covers it
        
        // Track the request
        await this.trackRequest(apiKey);
        
        next();
      } catch (error) {
        console.error('[RateLimiting] Error:', error.message);
        next(); // Don't block on errors
      }
    };
  }
  
  /**
   * Acquire a concurrency slot for an API key.
   * If at capacity, the request queues and waits up to CONCURRENCY_QUEUE_TIMEOUT_MS.
   * Resolves when a slot is available, rejects on timeout.
   */
  acquireConcurrencySlot(apiKey, maxConcurrent) {
    if (!this.concurrency.has(apiKey)) {
      this.concurrency.set(apiKey, { inflight: 0, queue: [] });
    }
    const slot = this.concurrency.get(apiKey);
    
    if (slot.inflight < maxConcurrent) {
      slot.inflight++;
      return Promise.resolve();
    }
    
    // At capacity — queue with timeout
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = slot.queue.findIndex(q => q.timer === timer);
        if (idx !== -1) slot.queue.splice(idx, 1);
        reject(new Error(
          `Concurrency limit reached (${maxConcurrent} in-flight). ` +
          `${slot.queue.length} queued. Timed out after ${CONCURRENCY_QUEUE_TIMEOUT_MS / 1000}s.`
        ));
      }, CONCURRENCY_QUEUE_TIMEOUT_MS);
      
      slot.queue.push({ resolve, reject, timer });
      console.log(`[RateLimiting] Queued request for key ${apiKey.substring(0, 8)}... ` +
        `(${slot.inflight}/${maxConcurrent} inflight, ${slot.queue.length} queued)`);
    });
  }
  
  /**
   * Release a concurrency slot. If requests are queued, dequeue the next one.
   */
  releaseConcurrencySlot(apiKey) {
    const slot = this.concurrency.get(apiKey);
    if (!slot) return;
    
    if (slot.queue.length > 0) {
      // Hand the slot to the next queued request
      const next = slot.queue.shift();
      clearTimeout(next.timer);
      next.resolve();
    } else {
      slot.inflight = Math.max(0, slot.inflight - 1);
      // Clean up empty entries
      if (slot.inflight === 0) {
        this.concurrency.delete(apiKey);
      }
    }
  }
  
  /**
   * Resolve subscription tier from request context.
   * Priority: auth middleware rateLimitTier → X-Subscription-Tier header → DB lookup → 'free'
   */
  async resolveTier(apiKey, req) {
    // 1. Auth middleware may have already resolved the tier
    if (req && req.rateLimitTier && TIER_LIMITS[req.rateLimitTier]) {
      return req.rateLimitTier;
    }
    
    // 2. Explicit header (set by dashboard/iOS when session tier is known)
    const headerTier = req?.headers?.['x-subscription-tier'];
    if (headerTier && TIER_LIMITS[headerTier]) {
      return headerTier;
    }
    
    // 3. Platform-admin role → admin tier
    const platformRole = req?.headers?.['x-platform-role'];
    if (platformRole === 'platform-admin') {
      return 'admin';
    }
    
    // 4. DB lookup via user_feature_access (if DB is available and user ID is known)
    const userId = req?.headers?.['x-user-id'];
    if (this.db && userId) {
      try {
        const result = await this.db.query(
          `SELECT subscription_tier FROM user_feature_access WHERE user_id = $1`,
          [userId]
        );
        if (result.rows.length > 0 && TIER_LIMITS[result.rows[0].subscription_tier]) {
          return result.rows[0].subscription_tier;
        }
      } catch {
        // DB error — fall through to default
      }
    }
    
    // 5. Default
    return 'free';
  }
  
  /**
   * Get rate limit configuration for API key based on subscription tier.
   * Admin tier returns null → bypasses all rate limits.
   */
  async getRateLimitConfig(apiKey, req) {
    const tier = await this.resolveTier(apiKey, req);
    
    // Admin tier bypasses all rate limits
    if (tier === 'admin') {
      return null;
    }
    
    const limits = TIER_LIMITS[tier] || FALLBACK_LIMITS;
    return {
      perMinute: limits.perMinute,
      perHour: limits.perHour,
      perDay: limits.perDay,
      maxConcurrent: limits.maxConcurrent,
    };
  }
  
  /**
   * Check if request is within rate limits
   */
  async checkRateLimit(apiKey, config) {
    if (this.redis) {
      return this.checkRateLimitRedis(apiKey, config);
    } else {
      return this.checkRateLimitMemory(apiKey, config);
    }
  }
  
  /**
   * Check rate limit using Redis
   */
  async checkRateLimitRedis(apiKey, config) {
    const now = Date.now();
    const minuteKey = `ratelimit:${apiKey}:minute:${Math.floor(now / 60000)}`;
    const hourKey = `ratelimit:${apiKey}:hour:${Math.floor(now / 3600000)}`;
    const dayKey = `ratelimit:${apiKey}:day:${Math.floor(now / 86400000)}`;
    
    try {
      const [minuteCount, hourCount, dayCount] = await Promise.all([
        this.redis.incr(minuteKey),
        this.redis.incr(hourKey),
        this.redis.incr(dayKey)
      ]);
      
      // Set expiration on first increment
      if (minuteCount === 1) await this.redis.expire(minuteKey, 60);
      if (hourCount === 1) await this.redis.expire(hourKey, 3600);
      if (dayCount === 1) await this.redis.expire(dayKey, 86400);
      
      // Check limits
      if (minuteCount > config.perMinute) return false;
      if (hourCount > config.perHour) return false;
      if (dayCount > config.perDay) return false;
      
      return true;
    } catch (error) {
      console.error('[RateLimiting] Redis error:', error.message);
      return true; // Allow on error
    }
  }
  
  /**
   * Check rate limit using in-memory storage
   */
  checkRateLimitMemory(apiKey, config) {
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60000);
    const hourWindow = Math.floor(now / 3600000);
    const dayWindow = Math.floor(now / 86400000);
    
    const minuteKey = `${apiKey}:minute:${minuteWindow}`;
    const hourKey = `${apiKey}:hour:${hourWindow}`;
    const dayKey = `${apiKey}:day:${dayWindow}`;
    
    const minuteCount = (this.inMemoryLimits.get(minuteKey) || 0) + 1;
    const hourCount = (this.inMemoryLimits.get(hourKey) || 0) + 1;
    const dayCount = (this.inMemoryLimits.get(dayKey) || 0) + 1;
    
    // Check limits
    if (minuteCount > config.perMinute) return false;
    if (hourCount > config.perHour) return false;
    if (dayCount > config.perDay) return false;
    
    // Update counts
    this.inMemoryLimits.set(minuteKey, minuteCount);
    this.inMemoryLimits.set(hourKey, hourCount);
    this.inMemoryLimits.set(dayKey, dayCount);
    
    return true;
  }
  
  /**
   * Track request for usage statistics
   */
  async trackRequest(apiKey) {
    if (!this.db) {
      return;
    }
    
    try {
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      
      // Update last_used_at and usage_count
      const query = `
        UPDATE api_keys
        SET last_used_at = CURRENT_TIMESTAMP,
            usage_count = usage_count + 1
        WHERE key_hash = $1
      `;
      
      await this.db.query(query, [keyHash]);
    } catch (error) {
      console.error('[RateLimiting] Error tracking request:', error.message);
    }
  }
  
  /**
   * Cleanup old in-memory limits
   */
  cleanup() {
    const now = Date.now();
    const hourAgo = now - 3600000;
    
    for (const [key] of this.inMemoryLimits) {
      const parts = key.split(':');
      const window = parseInt(parts[2]);
      const windowType = parts[1];
      
      let windowMs;
      if (windowType === 'minute') {
        windowMs = window * 60000;
      } else if (windowType === 'hour') {
        windowMs = window * 3600000;
      } else if (windowType === 'day') {
        windowMs = window * 86400000;
      }
      
      if (windowMs < hourAgo) {
        this.inMemoryLimits.delete(key);
      }
    }
  }
  
  /**
   * Get concurrency stats for monitoring
   */
  getConcurrencyStats() {
    const stats = {};
    for (const [key, slot] of this.concurrency.entries()) {
      const masked = key.substring(0, 8) + '...';
      stats[masked] = {
        inflight: slot.inflight,
        queued: slot.queue.length
      };
    }
    return stats;
  }
  
  /**
   * Migrate DB schema to add max_concurrent_requests column
   */
  async migrateSchema() {
    if (!this.db) return;
    try {
      await this.db.query(`
        ALTER TABLE api_keys
        ADD COLUMN IF NOT EXISTS max_concurrent_requests INTEGER DEFAULT ${DEFAULT_MAX_CONCURRENT}
      `);
      console.log('[RateLimiting] Schema migration complete: max_concurrent_requests column ensured');
    } catch (error) {
      // Column may already exist or table doesn't exist yet — not fatal
      console.warn('[RateLimiting] Schema migration skipped:', error.message);
    }
  }
  
  /**
   * Shutdown the middleware
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    // Reject all queued requests
    for (const [, slot] of this.concurrency.entries()) {
      for (const queued of slot.queue) {
        clearTimeout(queued.timer);
        queued.reject(new Error('Rate limiter shutting down'));
      }
    }
    this.concurrency.clear();
  }
}

module.exports = RateLimitingMiddleware;
