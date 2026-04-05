#!/usr/bin/env node

/**
 * Update Perplexity Configuration in Running AI Gateway
 * Ensures Sonar models are properly configured and available
 */

const axios = require('axios');
require('dotenv').config();

const AI_GATEWAY_URL = 'http://localhost:8777';
const API_KEY = 'ai-gateway-api-key-2024';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

const UPDATED_PERPLEXITY_CONFIG = {
  id: 'perplexity',
  name: 'Perplexity AI',
  type: 'api',
  endpoint: 'https://api.perplexity.ai',
  apiKey: PERPLEXITY_API_KEY,
  models: [
    'sonar-deep-research',
    'sonar-reasoning-pro', 
    'sonar-reasoning',
    'sonar-pro',
    'sonar',
    'llama-3.1-sonar-large-128k-online',
    'llama-3.1-sonar-small-128k-online'
  ],
  capabilities: ['chat', 'web_search', 'real_time_info', 'citations', 'reasoning'],
  priority: 1, // High priority for research tasks
  costOptimization: false,
  status: 'active',
  enabled: true
};

async function updatePerplexityConfiguration() {
  console.log('🔧 Updating Perplexity Configuration in AI Gateway...');
  console.log('='*60);
  
  if (!PERPLEXITY_API_KEY) {
    console.error('❌ PERPLEXITY_API_KEY not found in environment');
    process.exit(1);
  }
  
  try {
    // Step 1: Check AI Gateway health
    console.log('\n1. 🔍 Checking AI Gateway Health...');
    const healthResponse = await axios.get(`${AI_GATEWAY_URL}/health`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 10000
    });
    
    if (healthResponse.data.status === 'healthy') {
      console.log('   ✅ AI Gateway is healthy');
    } else {
      throw new Error('AI Gateway is not healthy');
    }
    
    // Step 2: Update provider configuration
    console.log('\n2. 📡 Updating Perplexity Provider Configuration...');
    const configResponse = await axios.post(`${AI_GATEWAY_URL}/api/v1/config/providers`, {
      providers: [UPDATED_PERPLEXITY_CONFIG]
    }, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    if (configResponse.data.success) {
      console.log('   ✅ Perplexity configuration updated successfully');
      console.log(`   📊 Active providers: ${configResponse.data.data.activeProviders}`);
    } else {
      throw new Error('Configuration update failed');
    }
    
    // Step 3: Verify provider status
    console.log('\n3. 🔍 Verifying Provider Status...');
    const statusResponse = await axios.get(`${AI_GATEWAY_URL}/api/v1/providers/status`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 15000
    });
    
    const perplexityStatus = statusResponse.data.data.perplexity;
    if (perplexityStatus) {
      console.log(`   📍 Perplexity Status: ${perplexityStatus.status}`);
      console.log(`   🔌 Connected: ${perplexityStatus.connected}`);
      console.log(`   🔑 API Key Configured: ${perplexityStatus.apiKeyConfigured}`);
      console.log(`   📱 Models Available: ${perplexityStatus.modelsAvailable || 'N/A'}`);
      console.log(`   ⏱️  Response Time: ${perplexityStatus.responseTime || 'N/A'}ms`);
    } else {
      console.log('   ⚠️ Perplexity status not found in response');
    }
    
    // Step 4: Test model availability
    console.log('\n4. 🧪 Testing Model Availability...');
    const modelsResponse = await axios.get(`${AI_GATEWAY_URL}/api/v1/models`, {
      headers: { 'X-API-Key': API_KEY },
      timeout: 10000
    });
    
    const sonarModels = modelsResponse.data.data.filter(model => model.id.includes('sonar'));
    console.log(`   📋 Sonar Models Available: ${sonarModels.length}`);
    
    sonarModels.forEach(model => {
      console.log(`   ✅ ${model.id} (${model.owned_by})`);
    });
    
    if (sonarModels.length === 0) {
      console.log('   ⚠️ No Sonar models found - configuration may need restart');
    }
    
    // Step 5: Test a Sonar model request
    console.log('\n5. 🚀 Testing Sonar-Pro Model...');
    try {
      const testResponse = await axios.post(`${AI_GATEWAY_URL}/api/v1/chat/completions`, {
        model: 'sonar-pro',
        messages: [
          { role: 'user', content: 'Test message for Sonar Pro model' }
        ],
        max_tokens: 50
      }, {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      if (testResponse.data.choices && testResponse.data.choices[0]) {
        console.log('   ✅ Sonar-Pro test successful');
        console.log(`   📝 Response: ${testResponse.data.choices[0].message.content.substring(0, 100)}...`);
        console.log(`   🏷️  Model Used: ${testResponse.data.model}`);
        console.log(`   🔧 Provider: ${testResponse.data.provider || 'Not specified'}`);
      } else {
        console.log('   ⚠️ Sonar-Pro test returned empty response');
      }
    } catch (testError) {
      console.log('   ❌ Sonar-Pro test failed:', testError.response?.data?.error?.message || testError.message);
      
      // If direct model test fails, check the error details
      if (testError.response?.data?.error?.details) {
        const details = testError.response.data.error.details;
        console.log('   📊 Available Providers:', details.availableProviders);
        console.log('   💡 Suggestion:', details.suggestion);
      }
    }
    
    // Step 6: Summary and recommendations
    console.log('\n📋 CONFIGURATION UPDATE SUMMARY');
    console.log('='*60);
    
    if (sonarModels.length > 0) {
      console.log('✅ SUCCESS: Perplexity Sonar models are configured and available');
      console.log(`📊 Models Available: ${sonarModels.map(m => m.id).join(', ')}`);
      console.log('🎯 Agents can now use: sonar-pro, sonar-reasoning, sonar-deep-research');
    } else {
      console.log('⚠️ PARTIAL: Configuration updated but models not yet available');
      console.log('💡 Recommendation: Restart AI Gateway pod in k3d cluster');
      console.log('🔄 Command: kubectl rollout restart deployment/ai-gateway-v2-dual-port');
    }
    
    console.log('\n🏁 Configuration update completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Configuration update failed:', error.message);
    
    if (error.response?.data) {
      console.error('📋 Error details:', JSON.stringify(error.response.data, null, 2));
    }
    
    console.log('\n🔧 Troubleshooting Steps:');
    console.log('1. Verify AI Gateway is running: kubectl get pods');
    console.log('2. Check pod logs: kubectl logs deployment/ai-gateway-v2-dual-port');
    console.log('3. Verify port-forward: kubectl port-forward svc/ai-gateway-ai-client 8777:8777');
    console.log('4. Test API key: curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health');
    
    process.exit(1);
  }
}

// Run the configuration update
if (require.main === module) {
  updatePerplexityConfiguration().catch(console.error);
}

module.exports = { updatePerplexityConfiguration, UPDATED_PERPLEXITY_CONFIG };
