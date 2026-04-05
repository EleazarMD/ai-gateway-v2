#!/usr/bin/env node

const { Pool } = require('pg');

async function fixDatabaseConfig() {
  // Use the exact same connection settings as the AI Gateway
  const pool = new Pool({
    host: process.env.DATABASE_HOST || 'host.docker.internal',
    port: parseInt(process.env.DATABASE_PORT) || 5432,
    database: process.env.DATABASE_NAME || 'ai_gateway_db',
    user: process.env.DATABASE_USER || 'eleazar',
    password: process.env.DATABASE_PASSWORD || ''
  });

  try {
    console.log('🔗 Connecting to AI Gateway database...');
    
    // Check if table exists and what config is stored
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE '%config%'
    `);
    
    console.log('📋 Config tables found:', tables.rows.map(r => r.table_name));
    
    for (const table of tables.rows) {
      const tableName = table.table_name;
      console.log(`\n🔍 Checking table: ${tableName}`);
      
      try {
        const configs = await pool.query(`SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 2`);
        
        if (configs.rows.length > 0) {
          console.log(`   Found ${configs.rows.length} configurations`);
          
          for (const config of configs.rows) {
            if (config.config) {
              const parsed = JSON.parse(config.config);
              console.log(`   Config ID ${config.id}: defaultProvider = ${parsed.defaultProvider}`);
              
              if (parsed.providers) {
                parsed.providers.forEach(p => {
                  console.log(`     Provider: ${p.id} (type: ${p.type})`);
                });
              }
            }
          }
          
          // Clear outdated configs
          console.log(`\n🧹 Clearing outdated configurations from ${tableName}...`);
          const deleteResult = await pool.query(`DELETE FROM ${tableName}`);
          console.log(`✅ Cleared ${deleteResult.rowCount} entries from ${tableName}`);
        } else {
          console.log(`   No configurations found in ${tableName}`);
        }
      } catch (error) {
        console.log(`   Error reading ${tableName}: ${error.message}`);
      }
    }
    
    console.log('\n✅ Database configuration cleanup complete');
    console.log('   AI Gateway will now use default openai-oss configuration');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Set environment variables to match AI Gateway deployment
process.env.DATABASE_HOST = 'host.docker.internal';
process.env.DATABASE_PORT = '5432';  
process.env.DATABASE_NAME = 'ai_gateway_db';
process.env.DATABASE_USER = 'eleazar';
process.env.DATABASE_PASSWORD = '';

fixDatabaseConfig().catch(console.error);
