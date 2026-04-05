#!/usr/bin/env node

/**
 * OpenAI Provider Integration Test for AI Gateway v2.0
 * Tests OpenAI and OpenAI-OSS provider functionality
 */

require('dotenv').config();
const axios = require('axios');

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Test configuration
const TEST_CONFIG = {
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  }
};

/**
 * Test AI Gateway health endpoint
 */
async function testHealth() {
  console.log('\n🔍 Testing AI Gateway Health...');
  
  try {
    const response = await axios.get(`${AI_GATEWAY_URL}/health`, {
      headers: TEST_CONFIG.headers,
      timeout: TEST_CONFIG.timeout
    });
    
    console.log('✅ Health Check Passed');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Version: ${response.data.version}`);
    console.log(`   Active Providers: ${response.data.providers?.join(', ') || 'None'}`);
    console.log(`   Total Models: ${response.data.totalModels || 0}`);
    
    return response.data;
  } catch (error) {
    console.error('❌ Health Check Failed:', error.message);
    throw error;
  }
}

/**
 * Test models endpoint
 */
async function testModels() {
  console.log('\n🔍 Testing Models Endpoint...');
  
  try {
    const response = await axios.get(`${AI_GATEWAY_URL}/api/v1/models`, {
      headers: TEST_CONFIG.headers,
      timeout: TEST_CONFIG.timeout
    });
    
    console.log('✅ Models Endpoint Passed');
    console.log(`   Total Models: ${response.data.data?.length || 0}`);
    
    if (response.data.data && response.data.data.length > 0) {
      console.log('   Available Models:');
      response.data.data.forEach(model => {
        console.log(`     - ${model.id} (${model.owned_by})`);
        if (model.capabilities) {
          console.log(`       Capabilities: ${model.capabilities.join(', ')}`);
        }
      });
    }
    
    return response.data.data;
  } catch (error) {
    console.error('❌ Models Endpoint Failed:', error.message);
    throw error;
  }
}

/**
 * Test OpenAI provider chat completion
 */
async function testOpenAICompletion(models) {
  if (!OPENAI_API_KEY) {
    console.log('\n⚠️  Skipping OpenAI test - no API key provided');
    return;
  }
  
  console.log('\n🔍 Testing OpenAI Provider Chat Completion...');
  
  // Find an OpenAI model
  const openaiModel = models.find(model => 
    model.owned_by === 'openai' && 
    (model.id.includes('gpt-4') || model.id.includes('gpt-3.5'))
  );
  
  if (!openaiModel) {
    console.log('⚠️  No OpenAI models available for testing');
    return;
  }
  
  try {
    const response = await axios.post(`${AI_GATEWAY_URL}/api/v1/chat/completions`, {
      model: openaiModel.id,
      messages: [
        {
          role: 'user',
          content: 'Hello! Please respond with exactly "OpenAI integration test successful" to confirm the connection.'
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    }, {
      headers: TEST_CONFIG.headers,
      timeout: TEST_CONFIG.timeout
    });
    
    console.log('✅ OpenAI Chat Completion Passed');
    console.log(`   Model: ${response.data.model}`);
    console.log(`   Provider: ${response.data.provider}`);
    console.log(`   Response: ${response.data.choices[0]?.message?.content}`);
    console.log(`   Usage: ${response.data.usage?.total_tokens} tokens`);
    if (response.data.cost) {
      console.log(`   Cost: $${response.data.cost.toFixed(6)}`);
    }
    
    return response.data;
  } catch (error) {
    console.error('❌ OpenAI Chat Completion Failed:', error.message);
    if (error.response?.data) {
      console.error('   Error Details:', error.response.data);
    }
    throw error;
  }
}

/**
 * Test OpenAI-OSS provider chat completion
 */
async function testOpenAIOSSCompletion(models) {
  console.log('\n🔍 Testing OpenAI-OSS Provider Chat Completion...');
  
  // Find an OpenAI-OSS model
  const ossModel = models.find(model => 
    model.owned_by === 'openai-oss' || 
    model.id.includes('gpt-oss')
  );
  
  if (!ossModel) {
    console.log('⚠️  No OpenAI-OSS models available for testing');
    return;
  }
  
  try {
    const response = await axios.post(`${AI_GATEWAY_URL}/api/v1/chat/completions`, {
      model: ossModel.id,
      messages: [
        {
          role: 'system',
          content: 'Reasoning: medium'
        },
        {
          role: 'user',
          content: 'What is 2+2? Please show your reasoning.'
        }
      ],
      max_tokens: 200,
      temperature: 0.1,
      reasoning: 'medium'
    }, {
      headers: TEST_CONFIG.headers,
      timeout: TEST_CONFIG.timeout
    });
    
    console.log('✅ OpenAI-OSS Chat Completion Passed');
    console.log(`   Model: ${response.data.model}`);
    console.log(`   Provider: ${response.data.provider}`);
    console.log(`   Response: ${response.data.choices[0]?.message?.content}`);
    console.log(`   Usage: ${response.data.usage?.total_tokens} tokens`);
    console.log(`   Reasoning Level: ${response.data.reasoning || 'N/A'}`);
    console.log(`   Harmony Handled: ${response.data.harmonyHandled || false}`);
    console.log(`   Local Inference: ${response.data.localInference || false}`);
    
    return response.data;
  } catch (error) {
    console.error('❌ OpenAI-OSS Chat Completion Failed:', error.message);
    if (error.response?.data) {
      console.error('   Error Details:', error.response.data);
    }
    throw error;
  }
}

/**
 * Test provider health status
 */
async function testProviderHealth() {
  console.log('\n🔍 Testing Provider Health Status...');
  
  try {
    const response = await axios.get(`${AI_GATEWAY_URL}/health`, {
      headers: TEST_CONFIG.headers,
      timeout: TEST_CONFIG.timeout
    });
    
    if (response.data.providers && response.data.providers.length > 0) {
      console.log('✅ Provider Health Check Passed');
      console.log(`   Active Providers: ${response.data.providers.length}`);
      
      // Additional provider stats if available
      if (response.data.providerStats) {
        console.log('   Provider Statistics:');
        Object.entries(response.data.providerStats).forEach(([provider, stats]) => {
          console.log(`     ${provider}: ${stats.status} (${stats.models || 0} models)`);
        });
      }
    } else {
      console.log('⚠️  No active providers found');
    }
    
    return response.data;
  } catch (error) {
    console.error('❌ Provider Health Check Failed:', error.message);
    throw error;
  }
}

/**
 * Run all integration tests
 */
async function runIntegrationTests() {
  console.log('🚀 Starting OpenAI Provider Integration Tests');
  console.log(`   AI Gateway URL: ${AI_GATEWAY_URL}`);
  console.log(`   OpenAI API Key: ${OPENAI_API_KEY ? 'Configured' : 'Not configured'}`);
  
  const results = {
    health: null,
    models: null,
    openaiCompletion: null,
    openaiOSSCompletion: null,
    providerHealth: null,
    success: false,
    errors: []
  };
  
  try {
    // Test 1: Health check
    results.health = await testHealth();
    
    // Test 2: Models endpoint
    results.models = await testModels();
    
    // Test 3: Provider health
    results.providerHealth = await testProviderHealth();
    
    // Test 4: OpenAI completion (if API key available)
    try {
      results.openaiCompletion = await testOpenAICompletion(results.models);
    } catch (error) {
      results.errors.push(`OpenAI completion: ${error.message}`);
    }
    
    // Test 5: OpenAI-OSS completion
    try {
      results.openaiOSSCompletion = await testOpenAIOSSCompletion(results.models);
    } catch (error) {
      results.errors.push(`OpenAI-OSS completion: ${error.message}`);
    }
    
    // Determine overall success
    results.success = results.health && results.models && results.errors.length === 0;
    
    // Print summary
    console.log('\n📊 Integration Test Summary');
    console.log('=' .repeat(50));
    console.log(`✅ Health Check: ${results.health ? 'PASSED' : 'FAILED'}`);
    console.log(`✅ Models Endpoint: ${results.models ? 'PASSED' : 'FAILED'}`);
    console.log(`✅ Provider Health: ${results.providerHealth ? 'PASSED' : 'FAILED'}`);
    console.log(`${results.openaiCompletion ? '✅' : '⚠️ '} OpenAI Completion: ${results.openaiCompletion ? 'PASSED' : 'SKIPPED/FAILED'}`);
    console.log(`${results.openaiOSSCompletion ? '✅' : '⚠️ '} OpenAI-OSS Completion: ${results.openaiOSSCompletion ? 'PASSED' : 'SKIPPED/FAILED'}`);
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      results.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    console.log(`\n🎯 Overall Result: ${results.success ? '✅ SUCCESS' : '⚠️  PARTIAL SUCCESS'}`);
    
    return results;
    
  } catch (error) {
    console.error('\n💥 Integration Tests Failed:', error.message);
    results.success = false;
    results.errors.push(error.message);
    return results;
  }
}

// Run tests if called directly
if (require.main === module) {
  runIntegrationTests()
    .then(results => {
      process.exit(results.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { runIntegrationTests };
