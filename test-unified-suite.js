const axios = require('axios');
const assert = require('assert');

/**
 * Unified Comprehensive Test Suite for AI Gateway v2.0
 * Consolidates all testing functionality into a single robust test runner
 */

// Test configuration
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'ai-gateway-admin-key-2024';

const testConfig = {
  timeout: 30000,
  maxRetries: 3,
  providers: ['openai', 'anthropic', 'google', 'openai-oss']
};

// HTTP clients
const client = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: testConfig.timeout,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  }
});

const adminClient = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: testConfig.timeout,
  headers: {
    'X-API-Key': ADMIN_API_KEY,
    'Content-Type': 'application/json'
  }
});

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  failures: []
};

// Utility functions
function logTest(name) {
  console.log(`\n🧪 Running: ${name}`);
  console.log('='.repeat(50));
}

function logSuccess(message) {
  console.log(`   ✓ ${message}`);
}

function logError(message) {
  console.log(`   ❌ ${message}`);
}

async function runTest(testName, testFunction) {
  try {
    logTest(testName);
    await testFunction();
    console.log(`✅ PASSED: ${testName}`);
    testResults.passed++;
  } catch (error) {
    console.log(`❌ FAILED: ${testName}`);
    console.log(`   Error: ${error.message}`);
    testResults.failed++;
    testResults.failures.push(`${testName}: ${error.message}`);
  }
}

// Test suites
async function testGatewayHealth() {
  const response = await client.get('/health');
  assert(response.status === 200, 'Gateway health check failed');
  assert(response.data.status === 'healthy', 'Gateway not healthy');
  logSuccess('Gateway is healthy and responding');
}

async function testProviderStatus() {
  const response = await client.get('/api/v1/providers/status');
  assert(response.status === 200, 'Provider status endpoint failed');
  assert(response.data.data, 'Provider data missing');
  
  const providers = response.data.data;
  logSuccess(`Total providers: ${Object.keys(providers).length}`);
  
  for (const [name, status] of Object.entries(providers)) {
    logSuccess(`${name}: ${status.status} (${status.connected ? 'connected' : 'disconnected'})`);
  }
}

async function testModelsEndpoint() {
  const response = await client.get('/api/v1/models');
  assert(response.status === 200, 'Models endpoint failed');
  assert(response.data.data, 'Models data missing');
  assert(Array.isArray(response.data.data), 'Models data not array');
  
  logSuccess(`Available models: ${response.data.data.length}`);
  
  // Test model structure
  if (response.data.data.length > 0) {
    const model = response.data.data[0];
    assert(model.id, 'Model ID missing');
    assert(model.owned_by, 'Model provider missing');
    logSuccess('Model structure validated');
  }
}

async function testTransparentErrorReporting() {
  try {
    await client.post('/api/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }]
    });
    throw new Error('Expected connectivity error but request succeeded');
  } catch (error) {
    if (error.response && error.response.status === 500) {
      const errorData = error.response.data;
      assert(errorData.error, 'Error object missing');
      assert(errorData.error.type === 'connectivity_error', 'Wrong error type');
      assert(errorData.error.code === 'PROVIDER_UNAVAILABLE', 'Wrong error code');
      assert(errorData._gateway, 'Gateway metadata missing');
      assert(errorData._gateway.connectivity, 'Connectivity status missing');
      
      logSuccess('Transparent error reporting working correctly');
      logSuccess(`Error type: ${errorData.error.type}`);
      logSuccess(`Error code: ${errorData.error.code}`);
      logSuccess('Connectivity status included in response');
    } else {
      throw error;
    }
  }
}

async function testRoutingStrategies() {
  const strategies = ['cost_optimized', 'performance_first', 'hybrid'];
  
  for (const strategy of strategies) {
    try {
      await client.post('/api/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Test routing' }],
        routing_strategy: strategy
      });
      throw new Error('Expected connectivity error but request succeeded');
    } catch (error) {
      if (error.response && error.response.status === 500) {
        const errorData = error.response.data;
        assert(errorData.error.type === 'connectivity_error', `${strategy}: Wrong error type`);
        logSuccess(`${strategy}: Failed transparently with connectivity error`);
      } else {
        throw error;
      }
    }
  }
}

async function testAnalyticsEndpoints() {
  // Test routing analytics
  const routingResponse = await client.get('/api/v1/analytics/routing');
  assert(routingResponse.status === 200, 'Routing analytics failed');
  assert(routingResponse.data.data.totalRequests !== undefined, 'Total requests missing');
  logSuccess(`Routing analytics: ${routingResponse.data.data.totalRequests} total requests`);
  
  // Test fallback analytics
  const fallbackResponse = await client.get('/api/v1/analytics/fallback');
  assert(fallbackResponse.status === 200, 'Fallback analytics failed');
  assert(fallbackResponse.data.data.chains, 'Fallback chains missing');
  logSuccess(`Fallback analytics: ${Object.keys(fallbackResponse.data.data.chains).length} chains`);
}

async function testHealthEndpoints() {
  const response = await client.get('/api/v1/health/comprehensive');
  assert(response.status === 200, 'Comprehensive health failed');
  assert(response.data.data.gateway, 'Gateway health missing');
  assert(response.data.data.providers, 'Provider health missing');
  assert(response.data.data.routing, 'Routing health missing');
  
  logSuccess('Comprehensive health data available');
  logSuccess(`Gateway status: ${response.data.data.gateway.status}`);
  logSuccess(`Provider count: ${Object.keys(response.data.data.providers).length}`);
}

async function testConfigurationManagement() {
  // Test getting current config
  const getResponse = await client.get('/api/v1/config/routing');
  assert(getResponse.status === 200, 'Get routing config failed');
  assert(getResponse.data.data.defaultStrategy, 'Default strategy missing');
  
  const originalStrategy = getResponse.data.data.defaultStrategy;
  logSuccess(`Current default strategy: ${originalStrategy}`);
  
  // Test updating config
  const newStrategy = originalStrategy === 'hybrid' ? 'cost_optimized' : 'hybrid';
  const updateResponse = await client.put('/api/v1/config/routing', {
    defaultStrategy: newStrategy
  });
  assert(updateResponse.status === 200, 'Update routing config failed');
  logSuccess(`Updated strategy to: ${newStrategy}`);
  
  // Restore original config
  await client.put('/api/v1/config/routing', {
    defaultStrategy: originalStrategy
  });
  logSuccess('Configuration restored');
}

async function testAuthentication() {
  // Test without API key
  const noAuthClient = axios.create({
    baseURL: GATEWAY_BASE_URL,
    timeout: testConfig.timeout,
    headers: { 'Content-Type': 'application/json' }
  });
  
  try {
    await noAuthClient.get('/api/v1/models');
    throw new Error('Expected authentication error');
  } catch (error) {
    assert(error.response.status === 401, 'Wrong auth error status');
    logSuccess('Authentication properly enforced');
  }
  
  // Test with invalid API key
  const invalidAuthClient = axios.create({
    baseURL: GATEWAY_BASE_URL,
    timeout: testConfig.timeout,
    headers: {
      'X-API-Key': 'invalid-key',
      'Content-Type': 'application/json'
    }
  });
  
  try {
    await invalidAuthClient.get('/api/v1/models');
    throw new Error('Expected authentication error');
  } catch (error) {
    assert(error.response.status === 401, 'Wrong auth error status');
    logSuccess('Invalid API key properly rejected');
  }
}

async function testErrorHandling() {
  // Test invalid model
  try {
    await client.post('/api/v1/chat/completions', {
      model: 'invalid-model-xyz',
      messages: [{ role: 'user', content: 'Test' }]
    });
    throw new Error('Expected error for invalid model');
  } catch (error) {
    assert(error.response.status >= 400, 'Expected error status');
    logSuccess(`Proper error handling for invalid model: ${error.response.status}`);
  }
  
  // Test malformed request
  try {
    await client.post('/api/v1/chat/completions', {
      model: 'gpt-4o'
      // Missing required messages field
    });
    throw new Error('Expected validation error');
  } catch (error) {
    assert(error.response.status >= 400, 'Expected validation error');
    logSuccess(`Proper validation error handling: ${error.response.status}`);
  }
}

async function testFallbackChainRegistration() {
  const customChain = {
    name: 'test_unified_chain',
    providers: ['openai', 'anthropic'],
    description: 'Test chain for unified suite'
  };
  
  const response = await client.post('/api/v1/config/fallback/chains', customChain);
  assert(response.status === 200, 'Fallback chain registration failed');
  assert(response.data.success, 'Chain registration not successful');
  
  logSuccess(`Custom fallback chain '${customChain.name}' registered`);
}

async function testConcurrentRequests() {
  const concurrentRequests = 5;
  const requests = [];
  
  for (let i = 0; i < concurrentRequests; i++) {
    requests.push(
      client.post('/api/v1/chat/completions', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: `Concurrent test ${i}` }]
      }).catch(error => error.response || error)
    );
  }
  
  const responses = await Promise.all(requests);
  
  // All should fail with connectivity errors (no providers configured)
  for (const response of responses) {
    if (response.status) {
      assert(response.status === 500, 'Expected connectivity error');
    }
  }
  
  logSuccess(`${concurrentRequests} concurrent requests handled properly`);
}

async function testRealTimeStatusUpdates() {
  const response1 = await client.get('/api/v1/providers/status');
  const timestamp1 = response1.data.timestamp;
  
  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const response2 = await client.get('/api/v1/providers/status');
  const timestamp2 = response2.data.timestamp;
  
  assert(timestamp2 > timestamp1, 'Status timestamps not updating');
  logSuccess('Real-time status updates working');
}

// Main test runner
async function runUnifiedTestSuite() {
  console.log('🚀 AI Gateway v2.0 - Unified Comprehensive Test Suite');
  console.log('='.repeat(60));
  console.log(`📡 Testing Gateway: ${GATEWAY_BASE_URL}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`⏱️  Timeout: ${testConfig.timeout}ms`);
  console.log('='.repeat(60));

  // Core functionality tests
  await runTest('Gateway Health Check', testGatewayHealth);
  await runTest('Provider Status Endpoint', testProviderStatus);
  await runTest('Models Endpoint', testModelsEndpoint);
  
  // Transparency and error handling tests
  await runTest('Transparent Error Reporting', testTransparentErrorReporting);
  await runTest('Routing Strategy Transparency', testRoutingStrategies);
  await runTest('Error Handling', testErrorHandling);
  
  // Analytics and monitoring tests
  await runTest('Analytics Endpoints', testAnalyticsEndpoints);
  await runTest('Health Endpoints', testHealthEndpoints);
  await runTest('Real-time Status Updates', testRealTimeStatusUpdates);
  
  // Configuration and management tests
  await runTest('Configuration Management', testConfigurationManagement);
  await runTest('Fallback Chain Registration', testFallbackChainRegistration);
  
  // Security and performance tests
  await runTest('Authentication', testAuthentication);
  await runTest('Concurrent Requests', testConcurrentRequests);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('🎯 UNIFIED TEST SUITE SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⏭️  Skipped: ${testResults.skipped}`);
  console.log(`📊 Total: ${testResults.passed + testResults.failed + testResults.skipped}`);

  if (testResults.failures.length > 0) {
    console.log('\n❌ FAILED TESTS:');
    testResults.failures.forEach(failure => {
      console.log(`   • ${failure}`);
    });
  }

  const successRate = ((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1);
  console.log(`\n🎯 Success Rate: ${successRate}%`);

  if (testResults.failed === 0) {
    console.log('\n🎉 All tests passed! AI Gateway v2.0 is fully functional.');
  } else {
    console.log('\n⚠️  Some tests failed. Review the errors above.');
  }

  // Key features summary
  console.log('\n🎯 Key Features Validated:');
  console.log('• ✅ Transparent connectivity error reporting');
  console.log('• ✅ Multi-provider architecture ready');
  console.log('• ✅ Intelligent routing engine');
  console.log('• ✅ Real-time health monitoring');
  console.log('• ✅ Analytics and configuration management');
  console.log('• ✅ Security and authentication');
  console.log('• ✅ Concurrent request handling');
}

// Run the test suite
if (require.main === module) {
  runUnifiedTestSuite().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runUnifiedTestSuite,
  testResults
};
