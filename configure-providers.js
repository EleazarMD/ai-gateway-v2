#!/usr/bin/env node

/**
 * AI Gateway Provider Configuration Script
 * Sets up all supported providers with API keys and tests connectivity
 */

const axios = require('axios');

// Provider configurations
const PROVIDERS = {
  'openai': {
    id: 'openai',
    name: 'OpenAI',
    type: 'api',
    endpoint: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    capabilities: ['chat', 'reasoning', 'analysis', 'function_calling', 'vision', 'long_context'],
    priority: 1,
    costOptimization: true,
    status: 'active'
  },
  'anthropic': {
    id: 'anthropic-default',
    name: 'Anthropic Claude',
    type: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    models: [
      'claude-haiku-4-5',                  // Haiku 4.5 (Latest)
      'claude-3-7-sonnet-20250219',        // Sonnet 3.7 (Latest)
      'claude-3-5-sonnet-20241022',        // Sonnet 3.5
      'claude-3-5-haiku-20241022',         // Haiku 3.5
      'claude-3-opus-20240229'             // Opus 3
    ],
    capabilities: ['chat', 'reasoning', 'analysis', 'vision', 'tool_use', 'extended_thinking', 'computer_use'],
    priority: 2,
    costOptimization: true,
    status: 'active'
  },
  'google': {
    id: 'google',
    name: 'Google Gemini',
    type: 'api',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    capabilities: ['chat', 'reasoning', 'vision', 'audio', 'video', 'function_calling', 'code_execution'],
    priority: 3,
    costOptimization: true,
    status: 'active'
  },
  'perplexity': {
    id: 'perplexity',
    name: 'Perplexity',
    type: 'api',
    endpoint: 'https://api.perplexity.ai',
    models: [
      'sonar',
      'sonar-pro', 
      'sonar-reasoning',
      'sonar-reasoning-pro',
      'sonar-deep-research',
      'llama-3.1-sonar-large-128k-online',
      'llama-3.1-sonar-small-128k-online'
    ],
    capabilities: ['chat', 'web_search', 'real_time_info', 'citations', 'reasoning'],
    priority: 4,
    costOptimization: false,
    status: 'active'
  },
  'openai-oss': {
    id: 'openai-oss',
    name: 'OpenAI OSS (Ollama)',
    type: 'local',
    endpoint: 'http://localhost:11434',
    models: ['llama3.2:3b', 'gemma3:4b', 'gemma3:latest'],
    capabilities: ['chat', 'reasoning', 'local_inference', 'privacy'],
    priority: 5,
    costOptimization: true,
    status: 'active'
  }
};

// API key prompts
const API_KEY_PROMPTS = {
  'openai': 'Please provide your OpenAI API key (sk-...):',
  'anthropic': 'Please provide your Anthropic API key (sk-ant-...):',
  'google': 'Please provide your Google AI API key:',
  'perplexity': 'Please provide your Perplexity API key (pplx-...):'
};

async function configureProviders() {
  console.log('🚀 AI Gateway Provider Configuration');
  console.log('=====================================\n');

  const configurations = [];
  
  for (const [providerId, config] of Object.entries(PROVIDERS)) {
    console.log(`\n📡 Configuring ${config.name}...`);
    
    let apiKey = null;
    
    // Skip API key for local providers
    if (config.type === 'local') {
      console.log(`✅ Local provider - no API key required`);
    } else {
      // Check environment variable first
      const envKey = `${providerId.toUpperCase().replace('-', '_')}_API_KEY`;
      apiKey = process.env[envKey];
      
      if (!apiKey) {
        console.log(`❌ No API key found in environment variable: ${envKey}`);
        console.log(`💡 To configure automatically, set: export ${envKey}="your-api-key"`);
        console.log(`⚠️  Provider ${config.name} will be configured but inactive until API key is provided\n`);
        config.status = 'inactive';
      } else {
        console.log(`✅ API key found in environment`);
        
        // Test API key validity
        const isValid = await testProviderConnection(providerId, apiKey, config);
        if (!isValid) {
          console.log(`❌ API key validation failed for ${config.name}`);
          config.status = 'inactive';
        } else {
          console.log(`✅ API key validated successfully`);
        }
      }
    }
    
    // Add API key to configuration
    const providerConfig = {
      ...config,
      apiKey: apiKey
    };
    
    configurations.push(providerConfig);
  }
  
  // Send configurations to AI Gateway
  console.log('\n🔄 Applying provider configurations to AI Gateway...');
  
  try {
    const response = await axios.post('http://localhost:8777/api/v1/config/providers', {
      providers: configurations
    }, {
      headers: {
        'X-API-Key': 'ai-gateway-api-key-2024',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    console.log('✅ Provider configurations applied successfully');
    console.log(`📊 Active providers: ${configurations.filter(p => p.status === 'active').length}`);
    console.log(`📊 Total models available: ${configurations.reduce((sum, p) => sum + p.models.length, 0)}`);
    
  } catch (error) {
    console.error('❌ Failed to apply provider configurations:', error.message);
    
    // Fallback: Save to local file for manual import
    const fs = require('fs');
    const configPath = '/tmp/ai-gateway-providers.json';
    fs.writeFileSync(configPath, JSON.stringify({ providers: configurations }, null, 2));
    console.log(`💾 Configuration saved to: ${configPath}`);
  }
  
  console.log('\n🎯 Configuration Summary:');
  configurations.forEach(config => {
    const status = config.status === 'active' ? '✅' : '⚠️';
    console.log(`${status} ${config.name}: ${config.models.length} models, ${config.capabilities.length} capabilities`);
  });
  
  console.log('\n📋 Next Steps:');
  console.log('1. Set missing API keys as environment variables');
  console.log('2. Restart AI Gateway to load new configurations');
  console.log('3. Test intelligent routing with: curl -X POST http://localhost:8777/v1/chat/completions');
  console.log('4. Monitor provider status: curl http://localhost:8777/api/v1/providers/status');
}

async function testProviderConnection(providerId, apiKey, config) {
  try {
    console.log(`🔍 Testing ${config.name} connectivity...`);
    
    switch (providerId) {
      case 'openai':
        const openaiResponse = await axios.get('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          timeout: 10000
        });
        return openaiResponse.status === 200;
        
      case 'anthropic':
        const anthropicResponse = await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        }, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 10000
        });
        return anthropicResponse.status === 200;
        
      case 'google':
        const googleResponse = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
          timeout: 10000
        });
        return googleResponse.status === 200;
        
      case 'perplexity':
        const perplexityResponse = await axios.post('https://api.perplexity.ai/chat/completions', {
          model: 'llama-3.1-sonar-small-128k-online',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        return perplexityResponse.status === 200;
        
      default:
        return false;
    }
  } catch (error) {
    console.log(`❌ Connection test failed: ${error.message}`);
    return false;
  }
}

// Run configuration
if (require.main === module) {
  configureProviders().catch(console.error);
}

module.exports = { configureProviders, PROVIDERS };
