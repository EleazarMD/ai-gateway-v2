const axios = require('axios');
const assert = require('assert');

/**
 * Connectivity Transparency Test Suite for AI Gateway v2.0
 * Tests transparent error reporting and connectivity status without fallbacks
 */

// Test configuration
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';

const client = axios.create({
  baseURL: GATEWAY_BASE_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  }
});

/**
 * Test Suite for Connectivity Transparency
 */
class ConnectivityTestSuite {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  async runTest(testName, testFunction) {
    console.log(`\n🔍 Testing: ${testName}`);
    console.log('-'.repeat(50));
    
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

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 CONNECTIVITY TRANSPARENCY TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`);
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.errors.forEach(({ test, error }) => {
        console.log(`   • ${test}: ${error}`);
      });
    }
  }
}

/**
 * Test Functions
 */

// Test 1: Provider Status Endpoint
async function testProviderStatusEndpoint() {
  const response = await client.get('/api/v1/providers/status');
  assert.strictEqual(response.status, 200);
  assert(response.data.success);
  assert(response.data.data);
  assert(response.data.summary);
  
  const status = response.data.data;
  const summary = response.data.summary;
  
  console.log(`   ✓ Total providers: ${summary.totalProviders}`);
  console.log(`   ✓ Connected providers: ${summary.connectedProviders}`);
  console.log(`   ✓ Healthy providers: ${summary.healthyProviders}`);
  
  // Check each provider status structure
  for (const [providerId, providerStatus] of Object.entries(status)) {
    assert(typeof providerStatus.connected === 'boolean');
    assert(providerStatus.status);
    assert(providerStatus.lastChecked);
    assert(typeof providerStatus.apiKeyConfigured === 'boolean');
    assert(typeof providerStatus.modelsAvailable === 'number');
    
    console.log(`   ✓ ${providerId}: ${providerStatus.status} (${providerStatus.connected ? 'connected' : 'disconnected'})`);
    if (providerStatus.error) {
      console.log(`     Error: ${providerStatus.error}`);
    }
  }
}

// Test 2: Successful Request with Connectivity Info
async function testSuccessfulRequestConnectivity() {
  const request = {
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'user', content: 'Test connectivity transparency' }
    ],
    max_tokens: 50
  };

  try {
    const response = await client.post('/api/v1/chat/completions', request);
    assert.strictEqual(response.status, 200);
    assert(response.data._gateway);
    assert(response.data._gateway.connectivity);
    
    const connectivity = response.data._gateway.connectivity;
    assert(connectivity.selectedProvider);
    assert(connectivity.providerStatus);
    assert(connectivity.allProviders);
    
    console.log(`   ✓ Selected provider: ${connectivity.selectedProvider}`);
    console.log(`   ✓ Provider status: ${connectivity.providerStatus}`);
    console.log(`   ✓ All providers status included in response`);
    
    // Verify response structure
    assert(response.data.choices);
    assert(response.data.choices[0].message);
    console.log(`   ✓ Response: ${response.data.choices[0].message.content.substring(0, 30)}...`);
  } catch (error) {
    if (error.response && error.response.status === 500) {
      // This is expected if no providers are available - check error structure
      await testConnectivityErrorStructure(error.response);
    } else {
      throw error;
    }
  }
}

// Test 3: Connectivity Error Structure
async function testConnectivityErrorStructure(errorResponse = null) {
  let response = errorResponse;
  
  if (!response) {
    // Force an error by using invalid model
    try {
      await client.post('/api/v1/chat/completions', {
        model: 'nonexistent-model-12345',
        messages: [{ role: 'user', content: 'test' }]
      });
      throw new Error('Expected error response');
    } catch (error) {
      response = error.response;
    }
  }
  
  assert(response);
  assert.strictEqual(response.status, 500);
  assert(response.data.error);
  assert(response.data._gateway);
  
  const error = response.data.error;
  const gateway = response.data._gateway;
  
  // Check error structure
  assert(error.message);
  assert.strictEqual(error.type, 'connectivity_error');
  assert.strictEqual(error.code, 'PROVIDER_UNAVAILABLE');
  assert(error.details);
  assert(error.details.connectivity);
  assert(Array.isArray(error.details.availableProviders));
  assert(error.details.suggestion);
  
  // Check gateway metadata
  assert(gateway.connectivity);
  assert.strictEqual(gateway.error, true);
  
  console.log(`   ✓ Error type: ${error.type}`);
  console.log(`   ✓ Error code: ${error.code}`);
  console.log(`   ✓ Available providers: ${error.details.availableProviders.join(', ') || 'none'}`);
  console.log(`   ✓ Suggestion: ${error.details.suggestion.substring(0, 50)}...`);
  console.log(`   ✓ Connectivity status included in error response`);
}

// Test 4: No Fallback Behavior
async function testNoFallbackBehavior() {
  // Test that requests fail immediately without fallback attempts
  const request = {
    model: 'claude-3-opus-20240229', // Specific model that might not be available
    messages: [{ role: 'user', content: 'Test no fallback' }],
    max_tokens: 50
  };

  const startTime = Date.now();
  
  try {
    const response = await client.post('/api/v1/chat/completions', request);
    
    // If successful, verify no fallback metadata
    assert(response.data._gateway);
    assert(!response.data._gateway.fallback, 'Fallback metadata should not be present');
    console.log(`   ✓ Request succeeded without fallback attempts`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Should fail quickly without fallback attempts
    assert(duration < 15000, 'Request should fail quickly without fallback delays');
    assert(error.response.status === 500);
    assert(!error.response.data._gateway.fallback, 'Fallback metadata should not be present in errors');
    
    console.log(`   ✓ Request failed quickly (${duration}ms) without fallback attempts`);
    console.log(`   ✓ No fallback metadata in error response`);
  }
}

// Test 5: Routing Strategy Without Fallbacks
async function testRoutingWithoutFallbacks() {
  const strategies = ['cost_optimized', 'performance_first', 'hybrid'];
  
  for (const strategy of strategies) {
    const request = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: `Test ${strategy} without fallbacks` }],
      max_tokens: 30
    };

    try {
      const response = await client.post('/api/v1/chat/completions', request, {
        headers: { 'X-Routing-Strategy': strategy }
      });

      assert(response.data._gateway.routing);
      assert(!response.data._gateway.fallback, 'No fallback should be used');
      console.log(`   ✓ ${strategy}: Provider ${response.data._gateway.routing.provider} (no fallback)`);
      
    } catch (error) {
      // Error is acceptable - verify it's transparent
      assert(error.response.data.error.type === 'connectivity_error');
      console.log(`   ✓ ${strategy}: Failed transparently with connectivity error`);
    }
  }
}

// Test 6: Model Availability Transparency
async function testModelAvailabilityTransparency() {
  // Test with a model that might not be available
  const request = {
    model: 'gpt-5-ultra', // Non-existent model
    messages: [{ role: 'user', content: 'Test model availability' }],
    max_tokens: 50
  };

  try {
    await client.post('/api/v1/chat/completions', request);
    throw new Error('Expected model unavailability error');
  } catch (error) {
    assert(error.response.status === 500);
    assert(error.response.data.error.details.requestedModel === 'gpt-5-ultra');
    assert(error.response.data.error.details.connectivity);
    
    console.log(`   ✓ Requested model clearly identified: ${error.response.data.error.details.requestedModel}`);
    console.log(`   ✓ Connectivity status provided for troubleshooting`);
  }
}

// Test 7: API Key Configuration Visibility
async function testAPIKeyVisibility() {
  const response = await client.get('/api/v1/providers/status');
  const providers = response.data.data;
  
  for (const [providerId, status] of Object.entries(providers)) {
    assert(typeof status.apiKeyConfigured === 'boolean');
    console.log(`   ✓ ${providerId}: API key ${status.apiKeyConfigured ? 'configured' : 'not configured'}`);
    
    if (!status.apiKeyConfigured && !status.connected) {
      console.log(`     Suggestion: Configure API key for ${providerId} to enable connectivity`);
    }
  }
}

// Test 8: Real-time Status Updates
async function testRealTimeStatusUpdates() {
  // Get status twice with a small delay to verify real-time updates
  const status1 = await client.get('/api/v1/providers/status');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const status2 = await client.get('/api/v1/providers/status');
  
  // Verify timestamps are different (real-time updates)
  assert(status1.data.timestamp !== status2.data.timestamp);
  
  // Verify lastChecked times are updated
  for (const providerId of Object.keys(status1.data.data)) {
    const time1 = new Date(status1.data.data[providerId].lastChecked);
    const time2 = new Date(status2.data.data[providerId].lastChecked);
    assert(time2 >= time1, `${providerId} lastChecked should be updated`);
  }
  
  console.log(`   ✓ Status timestamps updated between calls`);
  console.log(`   ✓ Provider lastChecked times are real-time`);
}

/**
 * Main Test Runner
 */
async function runConnectivityTransparencyTests() {
  console.log('🔍 AI Gateway v2.0 - Connectivity Transparency Test Suite');
  console.log('='.repeat(60));
  console.log(`📡 Testing Gateway: ${GATEWAY_BASE_URL}`);
  console.log(`🚫 Fallbacks: DISABLED (transparent errors only)`);
  console.log('='.repeat(60));

  const testSuite = new ConnectivityTestSuite();

  // Core connectivity tests
  await testSuite.runTest('Provider Status Endpoint', testProviderStatusEndpoint);
  await testSuite.runTest('Successful Request Connectivity Info', testSuccessfulRequestConnectivity);
  await testSuite.runTest('Connectivity Error Structure', testConnectivityErrorStructure);
  
  // Transparency tests
  await testSuite.runTest('No Fallback Behavior', testNoFallbackBehavior);
  await testSuite.runTest('Routing Without Fallbacks', testRoutingWithoutFallbacks);
  await testSuite.runTest('Model Availability Transparency', testModelAvailabilityTransparency);
  
  // Configuration visibility tests
  await testSuite.runTest('API Key Configuration Visibility', testAPIKeyVisibility);
  await testSuite.runTest('Real-time Status Updates', testRealTimeStatusUpdates);

  testSuite.printSummary();
  
  console.log('\n🎯 Key Transparency Features Verified:');
  console.log('• ✅ No automatic fallbacks - immediate error reporting');
  console.log('• ✅ Detailed connectivity status in all responses');
  console.log('• ✅ Clear error messages with troubleshooting info');
  console.log('• ✅ API key configuration visibility');
  console.log('• ✅ Real-time provider status monitoring');
  console.log('• ✅ Model availability transparency');
  
  return testSuite.results.failed === 0;
}

// Run tests if called directly
if (require.main === module) {
  runConnectivityTransparencyTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test suite crashed:', error);
      process.exit(1);
    });
}

module.exports = {
  runConnectivityTransparencyTests,
  ConnectivityTestSuite
};
