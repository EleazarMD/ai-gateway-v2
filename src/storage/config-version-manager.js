/**
 * Configuration Version Manager for AI Gateway v2.0
 * Handles configuration versioning, rollback, and history management
 */

const winston = require('winston');

class ConfigVersionManager {
  constructor(storage, logger) {
    this.storage = storage;
    this.logger = logger || winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()]
    });
  }
  
  /**
   * Rollback to a specific configuration version
   */
  async rollbackToVersion(version) {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available for rollback');
      }
      
      this.logger.info('Attempting rollback to version', { version });
      
      const stmt = this.storage.sqlite.prepare(`
        SELECT config_data, config_hash FROM config_history 
        WHERE version = ? AND success = 1
        ORDER BY applied_at DESC 
        LIMIT 1
      `);
      
      const historicalConfig = stmt.get(version);
      
      if (!historicalConfig) {
        throw new Error(`Version ${version} not found or invalid`);
      }
      
      const config = JSON.parse(historicalConfig.config_data);
      
      // Apply the historical configuration
      await this.applyConfiguration(config, 'rollback');
      
      // Record the rollback in history
      const rollbackStmt = this.storage.sqlite.prepare(`
        INSERT INTO config_history 
        (config_hash, config_data, version, source, success)
        VALUES (?, ?, ?, ?, 1)
      `);
      
      rollbackStmt.run(
        historicalConfig.config_hash,
        historicalConfig.config_data,
        version,
        `rollback_to_${version}`
      );
      
      this.logger.info('Successfully rolled back to version', { version });
      return config;
      
    } catch (error) {
      this.logger.error('Rollback failed', { 
        version, 
        error: error.message 
      });
      throw error;
    }
  }
  
  /**
   * Get configuration history
   */
  async getConfigHistory(limit = 10) {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available');
      }
      
      const stmt = this.storage.sqlite.prepare(`
        SELECT 
          version,
          applied_at,
          source,
          success,
          config_hash,
          substr(config_data, 1, 200) as config_preview
        FROM config_history 
        ORDER BY applied_at DESC 
        LIMIT ?
      `);
      
      const history = stmt.all(limit);
      
      return history.map(record => ({
        version: record.version,
        appliedAt: record.applied_at,
        source: record.source,
        success: Boolean(record.success),
        configHash: record.config_hash.substring(0, 8),
        configPreview: record.config_preview
      }));
      
    } catch (error) {
      this.logger.error('Failed to get configuration history', { 
        error: error.message 
      });
      throw error;
    }
  }
  
  /**
   * Get configuration versions summary
   */
  async getVersionsSummary() {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available');
      }
      
      const stmt = this.storage.sqlite.prepare(`
        SELECT 
          COUNT(*) as total_versions,
          COUNT(CASE WHEN success = 1 THEN 1 END) as successful_versions,
          COUNT(CASE WHEN success = 0 THEN 1 END) as failed_versions,
          MAX(version) as latest_version,
          MIN(applied_at) as first_config,
          MAX(applied_at) as last_config
        FROM config_history
      `);
      
      const summary = stmt.get();
      
      return {
        totalVersions: summary.total_versions,
        successfulVersions: summary.successful_versions,
        failedVersions: summary.failed_versions,
        latestVersion: summary.latest_version,
        firstConfig: summary.first_config,
        lastConfig: summary.last_config
      };
      
    } catch (error) {
      this.logger.error('Failed to get versions summary', { 
        error: error.message 
      });
      throw error;
    }
  }
  
  /**
   * Compare two configuration versions
   */
  async compareVersions(version1, version2) {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available');
      }
      
      const stmt = this.storage.sqlite.prepare(`
        SELECT version, config_data, applied_at, source
        FROM config_history 
        WHERE version IN (?, ?) AND success = 1
        ORDER BY version
      `);
      
      const configs = stmt.all(version1, version2);
      
      if (configs.length !== 2) {
        throw new Error('One or both versions not found');
      }
      
      const config1 = JSON.parse(configs[0].config_data);
      const config2 = JSON.parse(configs[1].config_data);
      
      const differences = this.findConfigDifferences(config1, config2);
      
      return {
        version1: {
          version: configs[0].version,
          appliedAt: configs[0].applied_at,
          source: configs[0].source
        },
        version2: {
          version: configs[1].version,
          appliedAt: configs[1].applied_at,
          source: configs[1].source
        },
        differences
      };
      
    } catch (error) {
      this.logger.error('Failed to compare versions', { 
        version1, 
        version2, 
        error: error.message 
      });
      throw error;
    }
  }
  
  /**
   * Find differences between two configurations
   */
  findConfigDifferences(config1, config2) {
    const differences = {
      providers: {
        added: [],
        removed: [],
        modified: []
      },
      defaultProvider: {
        changed: config1.defaultProvider !== config2.defaultProvider,
        from: config1.defaultProvider,
        to: config2.defaultProvider
      },
      fallbackChain: {
        changed: JSON.stringify(config1.fallbackChain) !== JSON.stringify(config2.fallbackChain),
        from: config1.fallbackChain,
        to: config2.fallbackChain
      }
    };
    
    // Compare providers
    const providers1 = new Map(config1.providers.map(p => [p.id, p]));
    const providers2 = new Map(config2.providers.map(p => [p.id, p]));
    
    // Find added providers
    for (const [id, provider] of providers2) {
      if (!providers1.has(id)) {
        differences.providers.added.push(provider);
      }
    }
    
    // Find removed providers
    for (const [id, provider] of providers1) {
      if (!providers2.has(id)) {
        differences.providers.removed.push(provider);
      }
    }
    
    // Find modified providers
    for (const [id, provider1] of providers1) {
      if (providers2.has(id)) {
        const provider2 = providers2.get(id);
        if (JSON.stringify(provider1) !== JSON.stringify(provider2)) {
          differences.providers.modified.push({
            id,
            from: provider1,
            to: provider2
          });
        }
      }
    }
    
    return differences;
  }
  
  /**
   * Create a configuration snapshot
   */
  async createSnapshot(config, description = '') {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available');
      }
      
      const version = Date.now(); // Use timestamp as version for snapshots
      const configHash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(config))
        .digest('hex');
      
      const stmt = this.storage.sqlite.prepare(`
        INSERT INTO config_history 
        (config_hash, config_data, version, source, success)
        VALUES (?, ?, ?, ?, 1)
      `);
      
      stmt.run(
        configHash,
        JSON.stringify(config),
        version,
        `snapshot: ${description}`
      );
      
      this.logger.info('Configuration snapshot created', { 
        version, 
        description,
        hash: configHash.substring(0, 8)
      });
      
      return {
        version,
        hash: configHash,
        description,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Failed to create snapshot', { 
        error: error.message,
        description
      });
      throw error;
    }
  }
  
  /**
   * Clean up old configuration history
   */
  async cleanupHistory(keepDays = 30) {
    try {
      if (!this.storage.sqlite) {
        throw new Error('SQLite storage not available');
      }
      
      const stmt = this.storage.sqlite.prepare(`
        DELETE FROM config_history 
        WHERE applied_at < datetime('now', '-' || ? || ' days')
        AND source NOT LIKE 'snapshot:%'
      `);
      
      const result = stmt.run(keepDays);
      
      this.logger.info('Configuration history cleaned up', {
        deletedRecords: result.changes,
        keepDays
      });
      
      return result.changes;
      
    } catch (error) {
      this.logger.error('Failed to cleanup history', { 
        error: error.message,
        keepDays
      });
      throw error;
    }
  }
}

module.exports = ConfigVersionManager;
