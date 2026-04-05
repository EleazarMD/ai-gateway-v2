/**
 * Real-time Configuration Synchronization for AI Gateway v2.0
 * Handles WebSocket, Redis pub/sub, and polling-based configuration updates
 */

const WebSocket = require('ws');
const winston = require('winston');

class RealtimeConfigSync {
  constructor(storage, configService, options = {}) {
    this.storage = storage;
    this.configService = configService;
    this.dashboardUrl = options.dashboardUrl || process.env.DASHBOARD_URL || 'http://localhost:8404';
    this.syncStrategies = options.syncStrategies || ['websocket', 'polling', 'redis_pubsub'];
    this.pollInterval = options.pollInterval || 30000; // 30 seconds
    
    // WebSocket connection
    this.websocket = null;
    this.websocketReconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000;
    
    // Polling timer
    this.pollTimer = null;
    
    // State tracking
    this.isActive = false;
    this.lastUpdateTime = null;
    
    // Logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './logs/realtime-sync.log' })
      ]
    });
    
    this.logger.info('Real-time Configuration Sync initialized', {
      dashboardUrl: this.dashboardUrl,
      strategies: this.syncStrategies
    });
  }
  
  /**
   * Start real-time synchronization
   */
  async startRealtimeSync() {
    try {
      this.isActive = true;
      
      // Start WebSocket connection if enabled
      if (this.syncStrategies.includes('websocket')) {
        await this.startWebSocketSync();
      }
      
      // Start Redis pub/sub if enabled and available
      if (this.syncStrategies.includes('redis_pubsub') && this.storage.redis) {
        await this.startRedisPubSubSync();
      }
      
      // Start polling fallback if enabled
      if (this.syncStrategies.includes('polling')) {
        this.startPollingSync();
      }
      
      this.logger.info('Real-time synchronization started', {
        activeStrategies: this.getActiveStrategies()
      });
      
    } catch (error) {
      this.logger.error('Failed to start real-time sync', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Start WebSocket-based synchronization
   */
  async startWebSocketSync() {
    try {
      const wsUrl = this.dashboardUrl.replace(/^http/, 'ws') + '/ws/config/updates';
      this.logger.info('Connecting to WebSocket', { url: wsUrl });
      
      this.websocket = new WebSocket(wsUrl, {
        headers: {
          'X-API-Key': process.env.API_KEY
        }
      });
      
      this.websocket.on('open', () => {
        this.logger.info('WebSocket connection established');
        this.websocketReconnectAttempts = 0;
        
        // Send initial handshake
        this.websocket.send(JSON.stringify({
          type: 'handshake',
          clientId: 'ai-gateway-v2',
          timestamp: new Date().toISOString()
        }));
      });
      
      this.websocket.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleWebSocketMessage(message);
        } catch (error) {
          this.logger.error('Failed to process WebSocket message', { 
            error: error.message,
            data: data.toString()
          });
        }
      });
      
      this.websocket.on('close', (code, reason) => {
        this.logger.warn('WebSocket connection closed', { 
          code, 
          reason: reason.toString() 
        });
        
        if (this.isActive) {
          this.scheduleWebSocketReconnect();
        }
      });
      
      this.websocket.on('error', (error) => {
        this.logger.error('WebSocket error', { error: error.message });
      });
      
    } catch (error) {
      this.logger.error('Failed to start WebSocket sync', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Handle WebSocket messages
   */
  async handleWebSocketMessage(message) {
    try {
      switch (message.type) {
        case 'config_update':
          await this.applyConfigUpdate(message.data, 'websocket');
          break;
          
        case 'provider_status_update':
          await this.handleProviderStatusUpdate(message.data);
          break;
          
        case 'ping':
          // Respond to ping with pong
          if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString()
            }));
          }
          break;
          
        case 'handshake_ack':
          this.logger.info('WebSocket handshake acknowledged', message.data);
          break;
          
        default:
          this.logger.warn('Unknown WebSocket message type', { type: message.type });
      }
    } catch (error) {
      this.logger.error('Failed to handle WebSocket message', { 
        error: error.message,
        messageType: message.type
      });
    }
  }
  
  /**
   * Schedule WebSocket reconnection
   */
  scheduleWebSocketReconnect() {
    if (this.websocketReconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max WebSocket reconnection attempts reached');
      return;
    }
    
    this.websocketReconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.websocketReconnectAttempts - 1);
    
    this.logger.info('Scheduling WebSocket reconnection', { 
      attempt: this.websocketReconnectAttempts,
      delay
    });
    
    setTimeout(() => {
      if (this.isActive) {
        this.startWebSocketSync();
      }
    }, delay);
  }
  
  /**
   * Start Redis pub/sub synchronization
   */
  async startRedisPubSubSync() {
    try {
      if (!this.storage.redis) {
        throw new Error('Redis not available');
      }
      
      // Subscribe to configuration updates
      await this.storage.redis.subscribe('ai-gateway:config:updates');
      await this.storage.redis.subscribe('ai-gateway:provider:status');
      
      this.storage.redis.on('message', async (channel, message) => {
        try {
          const data = JSON.parse(message);
          
          switch (channel) {
            case 'ai-gateway:config:updates':
              await this.applyConfigUpdate(data, 'redis_pubsub');
              break;
              
            case 'ai-gateway:provider:status':
              await this.handleProviderStatusUpdate(data);
              break;
          }
        } catch (error) {
          this.logger.error('Failed to process Redis pub/sub message', { 
            error: error.message,
            channel,
            message
          });
        }
      });
      
      this.logger.info('Redis pub/sub synchronization started');
      
    } catch (error) {
      this.logger.error('Failed to start Redis pub/sub sync', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Start polling-based synchronization
   */
  startPollingSync() {
    this.pollTimer = setInterval(async () => {
      try {
        // Only poll if WebSocket is not connected
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
          await this.pollForUpdates();
        }
      } catch (error) {
        this.logger.error('Polling sync failed', { error: error.message });
      }
    }, this.pollInterval);
    
    this.logger.info('Polling synchronization started', { 
      interval: this.pollInterval 
    });
  }
  
  /**
   * Poll for configuration updates
   */
  async pollForUpdates() {
    try {
      this.logger.debug('Polling for configuration updates');
      
      const response = await this.storage.dashboard.get('/ai-inferencing/api/v1/providers/config', {
        params: {
          lastUpdate: this.lastUpdateTime?.toISOString()
        }
      });
      
      if (response.status === 200 && response.data) {
        const hasUpdates = response.data.hasUpdates !== false;
        
        if (hasUpdates) {
          await this.applyConfigUpdate(response.data, 'polling');
          this.logger.info('Configuration updated via polling');
        } else {
          this.logger.debug('No configuration updates available');
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to poll for updates', { error: error.message });
    }
  }
  
  /**
   * Apply configuration update from any source
   */
  async applyConfigUpdate(updateData, source) {
    try {
      // Validate update data
      if (!this.validateConfigUpdate(updateData)) {
        throw new Error('Invalid configuration update data');
      }
      
      this.logger.info('Applying configuration update', { 
        source,
        version: updateData.version,
        timestamp: updateData.timestamp
      });
      
      // Process the configuration
      const config = this.configService.processConfiguration(updateData.config || updateData);
      
      // Apply to memory
      await this.configService.applyConfiguration(config, source);
      
      // Persist to storage tiers
      await this.configService.persistConfig(config, source);
      
      // Broadcast to other instances via Redis if this update didn't come from Redis
      if (source !== 'redis_pubsub' && this.storage.redis) {
        await this.storage.redis.publish('ai-gateway:config:updates', JSON.stringify({
          config,
          source: `${source}_broadcast`,
          timestamp: new Date().toISOString(),
          version: updateData.version
        }));
      }
      
      // Update last update time
      this.lastUpdateTime = new Date();
      
      this.logger.info('Configuration update applied successfully', { 
        source,
        providersCount: config.providers?.length || 0
      });
      
    } catch (error) {
      this.logger.error('Failed to apply configuration update', { 
        error: error.message,
        source
      });
      
      // Emit error event
      this.configService.emit('config_update_failed', { 
        error: error.message, 
        source, 
        updateData,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Handle provider status updates
   */
  async handleProviderStatusUpdate(statusData) {
    try {
      this.logger.info('Received provider status update', {
        providerId: statusData.providerId,
        status: statusData.status
      });
      
      // Update provider status in memory
      const provider = this.storage.memory.get(statusData.providerId);
      if (provider) {
        provider.status = statusData.status;
        provider.lastStatusUpdate = new Date().toISOString();
        
        // Update routing metrics if available
        if (this.storage.sqlite && statusData.metrics) {
          const stmt = this.storage.sqlite.prepare(`
            INSERT OR REPLACE INTO routing_metrics 
            (provider_id, request_count, success_count, avg_latency, last_used)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);
          
          stmt.run(
            statusData.providerId,
            statusData.metrics.requestCount || 0,
            statusData.metrics.successCount || 0,
            statusData.metrics.avgLatency || 0
          );
        }
        
        // Emit status update event
        this.configService.emit('provider_status_updated', {
          providerId: statusData.providerId,
          status: statusData.status,
          metrics: statusData.metrics,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      this.logger.error('Failed to handle provider status update', { 
        error: error.message,
        statusData
      });
    }
  }
  
  /**
   * Validate configuration update data
   */
  validateConfigUpdate(updateData) {
    if (!updateData) {
      return false;
    }
    
    // Check for required fields
    const config = updateData.config || updateData;
    if (!config.providers || !Array.isArray(config.providers)) {
      return false;
    }
    
    // Validate each provider has required fields
    for (const provider of config.providers) {
      if (!provider.id || !provider.name || !provider.type) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Get active synchronization strategies
   */
  getActiveStrategies() {
    const active = [];
    
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      active.push('websocket');
    }
    
    if (this.storage.redis && this.storage.redis.status === 'ready') {
      active.push('redis_pubsub');
    }
    
    if (this.pollTimer) {
      active.push('polling');
    }
    
    return active;
  }
  
  /**
   * Get synchronization status
   */
  getSyncStatus() {
    return {
      isActive: this.isActive,
      activeStrategies: this.getActiveStrategies(),
      lastUpdateTime: this.lastUpdateTime,
      websocket: {
        connected: this.websocket?.readyState === WebSocket.OPEN,
        reconnectAttempts: this.websocketReconnectAttempts
      },
      redis: {
        connected: this.storage.redis?.status === 'ready'
      },
      polling: {
        active: this.pollTimer !== null,
        interval: this.pollInterval
      }
    };
  }
  
  /**
   * Stop real-time synchronization
   */
  async stop() {
    this.logger.info('Stopping real-time synchronization');
    
    this.isActive = false;
    
    // Close WebSocket connection
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    
    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    // Unsubscribe from Redis channels
    if (this.storage.redis) {
      await this.storage.redis.unsubscribe('ai-gateway:config:updates');
      await this.storage.redis.unsubscribe('ai-gateway:provider:status');
    }
    
    this.logger.info('Real-time synchronization stopped');
  }
}

module.exports = RealtimeConfigSync;
