/**
 * Database Configuration Manager
 * Provides environment-agnostic database connection configuration
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class DatabaseConfig {
  constructor(environment = process.env.NODE_ENV || 'development') {
    this.environment = environment;
    this.config = this.loadConfiguration();
  }

  /**
   * Load configuration based on environment
   */
  loadConfiguration() {
    // Priority 1: DATABASE_URL environment variable
    if (process.env.DATABASE_URL) {
      return this.parseConnectionUrl(process.env.DATABASE_URL);
    }

    // Priority 2: Individual environment variables
    if (process.env.DATABASE_HOST) {
      return this.parseEnvironmentVariables();
    }

    // Priority 3: Environment-specific config files
    const configFile = path.join(__dirname, '../../config/database', `${this.environment}.yaml`);
    if (fs.existsSync(configFile)) {
      const fileConfig = yaml.load(fs.readFileSync(configFile, 'utf8'));
      return this.processFileConfig(fileConfig);
    }

    // Priority 4: Default development configuration
    return this.getDefaultConfig();
  }

  /**
   * Parse DATABASE_URL connection string
   */
  parseConnectionUrl(url) {
    const parsed = new URL(url);
    
    return {
      provider: this.inferProvider(parsed.protocol),
      host: parsed.hostname,
      port: parseInt(parsed.port) || this.getDefaultPort(parsed.protocol),
      database: parsed.pathname.slice(1), // Remove leading slash
      user: parsed.username,
      password: parsed.password,
      ssl: this.getSSLConfig(),
      pool: this.getPoolConfig(),
      connectionString: url
    };
  }

  /**
   * Parse individual environment variables
   */
  parseEnvironmentVariables() {
    return {
      provider: process.env.DATABASE_PROVIDER || 'postgresql',
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT) || 5432,
      database: process.env.DATABASE_NAME || process.env.DATABASE_DB,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: this.getSSLConfig(),
      pool: this.getPoolConfig()
    };
  }

  /**
   * Process configuration from YAML file
   */
  processFileConfig(fileConfig) {
    return {
      provider: fileConfig.provider || 'postgresql',
      host: fileConfig.host,
      port: fileConfig.port || 5432,
      database: fileConfig.database,
      user: fileConfig.user,
      password: fileConfig.password,
      ssl: fileConfig.ssl || this.getSSLConfig(),
      pool: fileConfig.pool || this.getPoolConfig(),
      readReplica: fileConfig.readReplica,
      failover: fileConfig.failover || false
    };
  }

  /**
   * Get default development configuration
   */
  getDefaultConfig() {
    return {
      provider: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'ai_gateway',
      user: 'ai_gateway',
      password: 'ai_gateway_secure_2024',
      ssl: { rejectUnauthorized: false },
      pool: this.getPoolConfig()
    };
  }

  /**
   * Get SSL configuration based on environment
   */
  getSSLConfig() {
    const sslMode = process.env.DATABASE_SSL_MODE || 
                   (this.environment === 'production' ? 'require' : 'disable');

    switch (sslMode) {
      case 'require':
        return { rejectUnauthorized: true };
      case 'prefer':
        return { rejectUnauthorized: false };
      case 'disable':
      default:
        return false;
    }
  }

  /**
   * Get connection pool configuration
   */
  getPoolConfig() {
    return {
      min: parseInt(process.env.DATABASE_POOL_MIN) || 5,
      max: parseInt(process.env.DATABASE_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DATABASE_POOL_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT) || 10000
    };
  }

  /**
   * Infer database provider from protocol
   */
  inferProvider(protocol) {
    const protocolMap = {
      'postgres:': 'postgresql',
      'postgresql:': 'postgresql',
      'mysql:': 'mysql',
      'mysql2:': 'mysql'
    };
    return protocolMap[protocol] || 'postgresql';
  }

  /**
   * Get default port for protocol
   */
  getDefaultPort(protocol) {
    const portMap = {
      'postgres:': 5432,
      'postgresql:': 5432,
      'mysql:': 3306,
      'mysql2:': 3306
    };
    return portMap[protocol] || 5432;
  }

  /**
   * Get configuration for specific use case
   */
  getConfig(type = 'write') {
    if (type === 'read' && this.config.readReplica) {
      return {
        ...this.config,
        ...this.parseConnectionUrl(this.config.readReplica)
      };
    }
    return this.config;
  }

  /**
   * Validate configuration
   */
  validate() {
    const required = ['host', 'port', 'database', 'user'];
    const missing = required.filter(field => !this.config[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
    }

    return true;
  }

  /**
   * Get connection string for logging (without password)
   */
  getConnectionString(includePassword = false) {
    const { provider, host, port, database, user, password } = this.config;
    const auth = includePassword ? `${user}:${password}` : user;
    return `${provider}://${auth}@${host}:${port}/${database}`;
  }

  /**
   * Get environment-specific configuration summary
   */
  getSummary() {
    return {
      environment: this.environment,
      provider: this.config.provider,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      ssl: !!this.config.ssl,
      poolMax: this.config.pool?.max,
      hasReadReplica: !!this.config.readReplica,
      failoverEnabled: !!this.config.failover
    };
  }
}

module.exports = DatabaseConfig;
