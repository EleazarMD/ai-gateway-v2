/**
 * Dashboard Configuration Service for AI Gateway v2.0
 * Legacy service - replaced by EnhancedConfigService for 4-tier hybrid storage
 * Maintained for backward compatibility
 */

const EnhancedConfigService = require('../storage/enhanced-config-service');
const ConfigVersionManager = require('../storage/config-version-manager');
const RealtimeConfigSync = require('../storage/realtime-config-sync');

class DashboardConfigService extends EnhancedConfigService {
  constructor(config = {}) {
    super(config);
    
    // Initialize enhanced components
    this.versionManager = new ConfigVersionManager(this.storage, this.logger);
    this.realtimeSync = new RealtimeConfigSync(this.storage, this, {
      dashboardUrl: this.dashboardUrl,
      syncStrategies: ['websocket', 'polling', 'redis_pubsub']
    });
    
    this.logger.info('DashboardConfigService initialized with enhanced storage');
  }
  
  /**
   * Start the enhanced configuration service
   */
  async start() {
    await super.start();
    
    // Start real-time synchronization
    await this.realtimeSync.startRealtimeSync();
    
    this.logger.info('Enhanced DashboardConfigService started with real-time sync');
  }
  
  /**
   * Stop the enhanced configuration service
   */
  async stop() {
    await this.realtimeSync.stop();
    await super.stop();
    
    this.logger.info('Enhanced DashboardConfigService stopped');
  }
  
  /**
   * Get enhanced health status
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus();
    const syncStatus = this.realtimeSync.getSyncStatus();
    
    return {
      ...baseHealth,
      realTimeSync: syncStatus,
      versionManager: {
        available: this.versionManager !== null
      }
    };
  }
  
  /**
   * Rollback to previous configuration version
   */
  async rollbackToVersion(version) {
    return await this.versionManager.rollbackToVersion(version);
  }
  
  /**
   * Get configuration history
   */
  async getConfigHistory(limit = 10) {
    return await this.versionManager.getConfigHistory(limit);
  }
  
  /**
   * Create configuration snapshot
   */
  async createSnapshot(description = '') {
    return await this.versionManager.createSnapshot(this.currentConfig, description);
  }
  
  // Legacy methods maintained for backward compatibility
  async syncConfiguration() {
    return await super.syncConfiguration();
  }
  
  getProvider(providerId) {
    return super.getProvider(providerId);
  }
  
  getEnabledProviders() {
    return super.getEnabledProviders();
  }
  
  getDefaultProvider() {
    return super.getDefaultProvider();
  }
}

module.exports = DashboardConfigService;
