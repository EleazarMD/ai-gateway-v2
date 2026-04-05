const axios = require('axios');
const assert = require('assert');

/**
 * Comprehensive Test Suite for AI Gateway v2.0
 * Tests all functionality: Multi-provider support, intelligent routing, fallback chains, health monitoring
 */

// Test configuration
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';

const testConfig = {
  timeout: 30000,
  maxRetries: 3,
  providers: ['openai', 'anthropic', 'google', 'ollama']
};

// HTTP client with default configuration
const client = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: testConfig.timeout,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Test Suite Runner
 */
class GatewayTestSuite {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  async runTest(testName, testFunction) {
    console.log(`\n🧪 Running: ${testName}`);
    console.log('='.repeat(50));
    
    try {
      await testFunction();
      this.results.passed++;
      console.log(`✅ PASSED: ${testName}`);
    } catch (error) {
      this.results.failed++;
      this.results.errors.push({ test: testName, error: error.message });
      console.log(`❌ FAILED: ${testName}`);
      console.log(`   Error: ${error.message}`);
    }
  }

  async skipTest(testName, reason) {
    this.results.skipped++;
    console.log(`⏭️  SKIPPED: ${testName} (${reason})`);
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏭️  Skipped: ${this.results.skipped}`);
    console.log(`📊 Total: ${this.results.passed + this.results.failed + this.results.skipped}`);
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.errors.forEach(({ test, error }) => {
        console.log(`   • ${test}: ${error}`);
      });
    }
    
    const successRate = (this.results.passed / (this.results.passed + this.results.failed)) * 100;
    console.log(`\n🎯 Success Rate: ${successRate.toFixed(1)}%`);
    
    if (this.results.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! AI Gateway is production-ready!');
    } else {
      console.log('\n⚠️  Some tests failed. Review the errors above.');
    }
  }
}

/**
 * Test Functions
 */

// Test 1: Gateway Health Check
async function testGatewayHealth() {
  const response = await client.get('/health');
  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.data.status, 'healthy');
  assert(response.data.timestamp);
  console.log('   ✓ Gateway is healthy and responding');
}

// Test 2: Models Endpoint
async function testModelsEndpoint() {
  const response = await client.get('/api/v1/models');
  assert.strictEqual(response.status, 200);
  assert(response.data.object === 'list');
  assert(Array.isArray(response.data.data));
  assert(response.data.data.length > 0);
  
  const model = response.data.data[0];
  assert(model.id);
  assert(model.object === 'model');
  assert(model.owned_by);
  
  console.log(`   ✓ Found ${response.data.data.length} available models`);
  console.log(`   ✓ Sample model: ${model.id} (${model.owned_by})`);
}

// Test 3: Basic Chat Completion
async function testBasicChatCompletion() {
  const request = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: 'Say "Hello from AI Gateway test suite!"' }
    ],
    max_tokens: 50
  };

  const response = await client.post('/api/v1/chat/completions', request);
  assert.strictEqual(response.status, 200);
  assert(response.data.choices);
  assert(response.data.choices.length > 0);
  assert(response.data.choices[0].message);
  assert(response.data.choices[0].message.content);
  assert(response.data._gateway);
  
  console.log(`   ✓ Response: ${response.data.choices[0].message.content.substring(0, 50)}...`);
  console.log(`   ✓ Gateway metadata present: v${response.data._gateway.version}`);
}

// Test 4: Intelligent Routing Strategies
async function testIntelligentRouting() {
  const strategies = ['cost_optimized', 'performance_first', 'hybrid', 'health_aware'];
  
  for (const strategy of strategies) {
    const request = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: `Test ${strategy} routing strategy` }
      ],
      max_tokens: 30
    };

    const response = await client.post('/api/v1/chat/completions', request, {
      headers: {
        'X-Routing-Strategy': strategy
      }
    });

    assert.strictEqual(response.status, 200);
    assert(response.data._gateway.routing);
    console.log(`   ✓ ${strategy}: Provider ${response.data._gateway.routing.provider}`);
  }
}

// Test 5: Fallback Chain Testing
async function testFallbackChains() {
  const chains = ['high_performance', 'cost_optimized', 'vision_capable'];
  
  for (const chain of chains) {
    const request = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: `Test ${chain} fallback chain` }
      ],
      max_tokens: 30
    };

    const response = await client.post('/api/v1/chat/completions', request, {
      headers: {
        'X-Fallback-Chain': chain
      }
    });

    assert.strictEqual(response.status, 200);
    console.log(`   ✓ ${chain}: Successfully processed`);
  }
}

// Test 6: Vision Capabilities
async function testVisionCapabilities() {
  const request = {
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see in this image?' },
        { 
          type: 'image_url', 
          image_url: { 
            url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=' 
          }
        }
      ]
    }],
    max_tokens: 100
  };

  const response = await client.post('/api/v1/chat/completions', request, {
    headers: {
      'X-Routing-Strategy': 'capability_match'
    }
  });

  assert.strictEqual(response.status, 200);
  assert(response.data._gateway.routing);
  console.log(`   ✓ Vision request routed to: ${response.data._gateway.routing.provider}`);
}

// Test 7: Routing Analytics
async function testRoutingAnalytics() {
  const response = await client.get('/api/v1/analytics/routing?timeRange=3600000');
  assert.strictEqual(response.status, 200);
  assert(response.data.success);
  assert(response.data.data);
  
  const analytics = response.data.data;
  console.log(`   ✓ Total requests tracked: ${analytics.totalRequests || 0}`);
  console.log(`   ✓ Average processing time: ${analytics.avgProcessingTime?.toFixed(2) || 0}ms`);
  
  if (analytics.strategies) {
    console.log(`   ✓ Strategy usage: ${Object.keys(analytics.strategies).join(', ')}`);
  }
}

// Test 8: Fallback Analytics
async function testFallbackAnalytics() {
  const response = await client.get('/api/v1/analytics/fallback');
  assert.strictEqual(response.status, 200);
  assert(response.data.success);
  assert(response.data.data);
  
  const analytics = response.data.data;
  console.log(`   ✓ Available fallback chains: ${analytics.fallbackChains?.join(', ') || 'none'}`);
  console.log(`   ✓ Total executions: ${analytics.totalExecutions || 0}`);
  console.log(`   ✓ Successful executions: ${analytics.successfulExecutions || 0}`);
}

// Test 9: Comprehensive Health Status
async function testComprehensiveHealth() {
  const response = await client.get('/api/v1/health/comprehensive');
  assert.strictEqual(response.status, 200);
  assert(response.data.success);
  assert(response.data.data);
  
  const health = response.data.data;
  console.log(`   ✓ Provider health data available: ${Object.keys(health.providers || {}).length} providers`);
  console.log(`   ✓ Fallback health data available: ${Object.keys(health.fallback || {}).length} providers`);
}

// Test 10: Configuration Management
async function testConfigurationManagement() {
  // Get current routing config
  const getResponse = await client.get('/api/v1/config/routing');
  assert.strictEqual(getResponse.status, 200);
  assert(getResponse.data.success);
  
  const originalConfig = getResponse.data.data;
  console.log(`   ✓ Current default strategy: ${originalConfig?.defaultStrategy || 'unknown'}`);
  
  // Update routing config
  const updateResponse = await client.put('/api/v1/config/routing', {
    costWeight: 0.5,
    performanceWeight: 0.3,
    healthWeight: 0.2
  });
  assert.strictEqual(updateResponse.status, 200);
  assert(updateResponse.data.success);
  console.log(`   ✓ Routing configuration updated successfully`);
}

// Test 11: Custom Fallback Chain Registration
async function testCustomFallbackChain() {
  const customChain = [
    { provider: 'google', maxRetries: 2, timeout: 5000 },
    { provider: 'openai', maxRetries: 1, timeout: 3000 }
  ];

  const response = await client.post('/api/v1/fallback/chains', {
    name: 'test_custom_chain',
    chain: customChain
  });

  assert.strictEqual(response.status, 200);
  assert(response.data.success);
  console.log(`   ✓ Custom fallback chain 'test_custom_chain' registered`);
}

// Test 12: Error Handling
async function testErrorHandling() {
  try {
    // Test with invalid model
    await client.post('/api/v1/chat/completions', {
      model: 'nonexistent-model-12345',
      messages: [{ role: 'user', content: 'test' }]
    });
    
    // Should not reach here
    throw new Error('Expected error for invalid model');
  } catch (error) {
    if (error.response && error.response.status >= 400) {
      console.log(`   ✓ Proper error handling for invalid model: ${error.response.status}`);
    } else {
      throw error;
    }
  }
}

// Test 13: Rate Limiting and Performance
async function testPerformanceAndConcurrency() {
  const concurrentRequests = 5;
  const requests = [];
  
  for (let i = 0; i < concurrentRequests; i++) {
    requests.push(
      client.post('/api/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: `Concurrent test ${i + 1}` }],
        max_tokens: 20
      })
    );
  }
  
  const startTime = Date.now();
  const responses = await Promise.all(requests);
  const duration = Date.now() - startTime;
  
  responses.forEach((response, index) => {
    assert.strictEqual(response.status, 200);
  });
  
  console.log(`   ✓ ${concurrentRequests} concurrent requests completed in ${duration}ms`);
  console.log(`   ✓ Average response time: ${(duration / concurrentRequests).toFixed(2)}ms`);
}

// Test 14: Authentication
async function testAuthentication() {
  try {
    // Test without API key
    await axios.post(`${GATEWAY_BASE_URL}/api/v1/chat/completions`, {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'test' }]
    });
    
    throw new Error('Expected authentication error');
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log(`   ✓ Proper authentication enforcement: ${error.response.status}`);
    } else {
      throw error;
    }
  }
}

// Test 15: API Compatibility
async function testOpenAICompatibility() {
  const request = {
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2+2?' }
    ],
    max_tokens: 50,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  };

  const response = await client.post('/api/v1/chat/completions', request);
  assert.strictEqual(response.status, 200);
  assert(response.data.id);
  assert(response.data.object === 'chat.completion');
  assert(response.data.created);
  assert(response.data.model);
  assert(response.data.choices);
  assert(response.data.usage);
  
  console.log(`   ✓ OpenAI-compatible response structure`);
  console.log(`   ✓ Usage tracking: ${response.data.usage.total_tokens} tokens`);
}

/**
 * Main Test Runner
 */
async function runComprehensiveTests() {
  console.log('🚀 AI Gateway v2.0 - Comprehensive Test Suite');
  console.log('='.repeat(60));
  console.log(`📡 Testing Gateway: ${GATEWAY_BASE_URL}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`⏱️  Timeout: ${testConfig.timeout}ms`);
  console.log('='.repeat(60));

  const testSuite = new GatewayTestSuite();

  // Core functionality tests
  await testSuite.runTest('Gateway Health Check', testGatewayHealth);
  await testSuite.runTest('Models Endpoint', testModelsEndpoint);
  await testSuite.runTest('Basic Chat Completion', testBasicChatCompletion);
  
  // Advanced routing tests
  await testSuite.runTest('Intelligent Routing Strategies', testIntelligentRouting);
  await testSuite.runTest('Fallback Chain Testing', testFallbackChains);
  await testSuite.runTest('Vision Capabilities', testVisionCapabilities);
  
  // Analytics and monitoring tests
  await testSuite.runTest('Routing Analytics', testRoutingAnalytics);
  await testSuite.runTest('Fallback Analytics', testFallbackAnalytics);
  await testSuite.runTest('Comprehensive Health Status', testComprehensiveHealth);
  
  // Configuration tests
  await testSuite.runTest('Configuration Management', testConfigurationManagement);
  await testSuite.runTest('Custom Fallback Chain Registration', testCustomFallbackChain);
  
  // Error handling and security tests
  await testSuite.runTest('Error Handling', testErrorHandling);
  await testSuite.runTest('Authentication', testAuthentication);
  
  // Performance and compatibility tests
  await testSuite.runTest('Performance and Concurrency', testPerformanceAndConcurrency);
  await testSuite.runTest('OpenAI API Compatibility', testOpenAICompatibility);

  testSuite.printSummary();
  
  return testSuite.results.failed === 0;
}

// Run tests if called directly
if (require.main === module) {
  runComprehensiveTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test suite crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runComprehensiveTests,
  GatewayTestSuite
};
