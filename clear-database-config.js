#!/usr/bin/env node

const { Pool } = require('pg');

async function clearOutdatedConfig() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'host.docker.internal',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'unified_homelab',
    user: process.env.POSTGRES_USER || 'aihomelab',
    password: process.env.POSTGRES_PASSWORD || 'aihomelab2024'
  });

  try {
    console.log('🔗 Connecting to Unified Homelab Database...');
    
    // Check current config
    const currentConfig = await pool.query(
      'SELECT id, version, created_at, config FROM ai_gateway_config ORDER BY version DESC LIMIT 1'
    );
    
    if (currentConfig.rows.length > 0) {
      const config = currentConfig.rows[0];
      console.log('📋 Current stored configuration:');
      console.log(`   Version: ${config.version}`);
      console.log(`   Created: ${config.created_at}`);
      
      const parsedConfig = JSON.parse(config.config);
      console.log(`   Default Provider: ${parsedConfig.defaultProvider}`);
      
      if (parsedConfig.providers && parsedConfig.providers.length > 0) {
        console.log('   Providers:');
        parsedConfig.providers.forEach(p => {
          console.log(`     - ID: ${p.id}, Type: ${p.type}`);
        });
      }
      
      // Clear the outdated config
      console.log('\n🧹 Clearing outdated configuration...');
      await pool.query('DELETE FROM ai_gateway_config');
      console.log('✅ Configuration cleared from database');
      console.log('   AI Gateway will now use default openai-oss configuration');
    } else {
      console.log('📋 No configuration found in database');
    }
    
  } catch (error) {
    console.error('❌ Error clearing configuration:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

clearOutdatedConfig().catch(console.error);
