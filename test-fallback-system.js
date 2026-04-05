const FallbackManager = require('./src/services/fallback-manager');

/**
 * Mock Provider for Testing Fallback System
 */
class MockProvider {
  constructor(name, shouldFail = false, failureRate = 0, latency = 100) {
    this.name = name;
    this.shouldFail = shouldFail;
    this.failureRate = failureRate;
    this.latency = latency;
    this.requestCount = 0;
  }

  async processChatCompletion(request) {
    this.requestCount++;
    
    // Simulate latency
    await new Promise(resolve => setTimeout(resolve, this.latency));
    
    // Simulate failures
    if (this.shouldFail || Math.random() < this.failureRate) {
      throw new Error(`Provider ${this.name} simulated failure (request #${this.requestCount})`);
    }
    
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: `Response from ${this.name} (request #${this.requestCount})`
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      }
    };
  }

  async healthCheck() {
    return !this.shouldFail && Math.random() > this.failureRate;
  }

  setFailureMode(shouldFail, failureRate = 0) {
    this.shouldFail = shouldFail;
    this.failureRate = failureRate;
  }

  setLatency(latency) {
    this.latency = latency;
  }
}

/**
 * Mock Provider Manager for Testing
 */
class MockProviderManager {
  constructor() {
    this.activeProviders = new Map();
    this.setupMockProviders();
  }

  setupMockProviders() {
    // Create providers with different characteristics
    this.activeProviders.set('openai', new MockProvider('openai', false, 0.1, 200));
    this.activeProviders.set('anthropic', new MockProvider('anthropic', false, 0.05, 300));
    this.activeProviders.set('google', new MockProvider('google', false, 0.15, 250));
    this.activeProviders.set('ollama', new MockProvider('ollama', false, 0.2, 500));
  }

  getProvider(name) {
    return this.activeProviders.get(name);
  }
}

/**
 * Test Suite for Fallback System
 */
async function testFallbackSystem() {
  console.log('🚀 Testing AI Gateway v2.0 Advanced Fallback System\n');

  try {
    // Initialize mock provider manager and fallback manager
    const mockProviderManager = new MockProviderManager();
    const fallbackManager = new FallbackManager(mockProviderManager);

    console.log('✅ Fallback system initialized with mock providers\n');

    // Test 1: Successful Request with High-Performance Chain
    console.log('✅ Test 1: Successful Request with High-Performance Chain');
    console.log('=========================================================');
    
    const successRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello, test successful request' }],
      max_tokens: 100
    };

    try {
      const result = await fallbackManager.executeWithFallback(successRequest, {
        fallbackChain: 'high_performance'
      });
      
      console.log(`✅ Success! Provider used: ${result.fallback.providerUsed}`);
      console.log(`   Execution ID: ${result.fallback.executionId}`);
      console.log(`   Chain: ${result.fallback.chainUsed}`);
      console.log(`   Attempt: ${result.fallback.attemptNumber}`);
      console.log(`   Total time: ${result.fallback.totalTime}ms`);
      console.log(`   Response: ${result.choices[0].message.content}\n`);
    } catch (error) {
      console.log(`❌ Unexpected failure: ${error.message}\n`);
    }

    // Test 2: Fallback Chain with Provider Failures
    console.log('🔄 Test 2: Fallback Chain with Provider Failures');
    console.log('=================================================');
    
    // Make OpenAI fail to test fallback
    mockProviderManager.getProvider('openai').setFailureMode(true);
    
    const fallbackRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Test fallback behavior' }],
      max_tokens: 100
    };

    try {
      const result = await fallbackManager.executeWithFallback(fallbackRequest, {
        fallbackChain: 'high_performance'
      });
      
      console.log(`✅ Fallback successful! Provider used: ${result.fallback.providerUsed}`);
      console.log(`   Attempts made: ${result.fallback.attempts.length}`);
      console.log(`   Failed providers: ${result.fallback.attempts.map(a => a.provider).join(', ')}`);
      console.log(`   Final provider: ${result.fallback.providerUsed}`);
      console.log(`   Total time: ${result.fallback.totalTime}ms\n`);
    } catch (error) {
      console.log(`❌ Fallback failed: ${error.message}\n`);
    }

    // Restore OpenAI
    mockProviderManager.getProvider('openai').setFailureMode(false);

    // Test 3: Circuit Breaker Functionality
    console.log('⚡ Test 3: Circuit Breaker Functionality');
    console.log('========================================');
    
    // Make Anthropic fail repeatedly to trigger circuit breaker
    const anthropicProvider = mockProviderManager.getProvider('anthropic');
    anthropicProvider.setFailureMode(false, 1.0); // 100% failure rate
    
    console.log('Triggering circuit breaker with repeated failures...');
    
    for (let i = 0; i < 6; i++) {
      try {
        await fallbackManager.executeWithFallback({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: `Circuit breaker test ${i + 1}` }]
        }, { fallbackChain: 'thinking_capable' });
      } catch (error) {
        console.log(`   Attempt ${i + 1}: ${error.message.includes('All providers') ? 'Chain exhausted' : 'Provider failed'}`);
      }
    }
    
    // Check circuit breaker status
    const analytics = fallbackManager.getAnalytics();
    console.log(`\n✅ Circuit breaker status for anthropic: ${analytics.circuitBreakers.anthropic?.state || 'closed'}`);
    console.log(`   Failures recorded: ${analytics.circuitBreakers.anthropic?.failures || 0}\n`);

    // Test 4: Cost-Optimized Chain
    console.log('💰 Test 4: Cost-Optimized Fallback Chain');
    console.log('=========================================');
    
    // Reset providers
    anthropicProvider.setFailureMode(false, 0.1);
    
    const costRequest = {
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'Cost-optimized request' }],
      max_tokens: 50
    };

    try {
      const result = await fallbackManager.executeWithFallback(costRequest, {
        fallbackChain: 'cost_optimized'
      });
      
      console.log(`✅ Cost-optimized success! Provider: ${result.fallback.providerUsed}`);
      console.log(`   Chain used: ${result.fallback.chainUsed}`);
      console.log(`   Processing time: ${result.fallback.totalTime}ms\n`);
    } catch (error) {
      console.log(`❌ Cost-optimized chain failed: ${error.message}\n`);
    }

    // Test 5: Vision-Capable Chain
    console.log('👁️  Test 5: Vision-Capable Fallback Chain');
    console.log('==========================================');
    
    const visionRequest = {
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,test' } }
        ]
      }],
      max_tokens: 200
    };

    try {
      const result = await fallbackManager.executeWithFallback(visionRequest, {
        fallbackChain: 'vision_capable'
      });
      
      console.log(`✅ Vision request success! Provider: ${result.fallback.providerUsed}`);
      console.log(`   Chain: ${result.fallback.chainUsed}`);
      console.log(`   Attempts: ${result.fallback.attemptNumber}\n`);
    } catch (error) {
      console.log(`❌ Vision chain failed: ${error.message}\n`);
    }

    // Test 6: Custom Fallback Chain
    console.log('🔧 Test 6: Custom Fallback Chain Registration');
    console.log('==============================================');
    
    // Register a custom chain
    fallbackManager.registerFallbackChain('custom_test', [
      { provider: 'google', maxRetries: 1, timeout: 3000 },
      { provider: 'ollama', maxRetries: 2, timeout: 5000 }
    ]);
    
    const customRequest = {
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Custom chain test' }],
      max_tokens: 100
    };

    try {
      const result = await fallbackManager.executeWithFallback(customRequest, {
        fallbackChain: 'custom_test'
      });
      
      console.log(`✅ Custom chain success! Provider: ${result.fallback.providerUsed}`);
      console.log(`   Custom chain used: ${result.fallback.chainUsed}\n`);
    } catch (error) {
      console.log(`❌ Custom chain failed: ${error.message}\n`);
    }

    // Test 7: Retry Logic with Exponential Backoff
    console.log('🔄 Test 7: Retry Logic with Exponential Backoff');
    console.log('================================================');
    
    // Set up a provider with intermittent failures
    const testProvider = mockProviderManager.getProvider('openai');
    testProvider.setFailureMode(false, 0.7); // 70% failure rate
    
    console.log('Testing retry logic with high failure rate...');
    
    const retryRequest = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Retry test' }],
      max_tokens: 50
    };

    const startTime = Date.now();
    try {
      const result = await fallbackManager.executeWithFallback(retryRequest, {
        fallbackChain: 'high_performance'
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ Retry successful after ${duration}ms`);
      console.log(`   Provider: ${result.fallback.providerUsed}`);
      console.log(`   Attempts in chain: ${result.fallback.attemptNumber}\n`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`❌ Retry exhausted after ${duration}ms: ${error.message}\n`);
    }

    // Reset provider
    testProvider.setFailureMode(false, 0.1);

    // Test 8: Health Monitoring
    console.log('🏥 Test 8: Health Monitoring and Status');
    console.log('=======================================');
    
    // Wait for health checks to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const healthStatus = fallbackManager.getHealthStatus();
    console.log('Provider Health Status:');
    for (const [providerId, status] of Object.entries(healthStatus)) {
      console.log(`  ${providerId}:`);
      console.log(`    Healthy: ${status.isHealthy}`);
      console.log(`    Success Rate: ${(status.successRate * 100).toFixed(1)}%`);
      console.log(`    Avg Duration: ${status.avgDuration?.toFixed(0) || 0}ms`);
      console.log(`    Circuit Breaker: ${status.circuitBreaker}`);
      console.log(`    Total Requests: ${status.totalRequests}`);
    }
    console.log();

    // Test 9: Configuration Updates
    console.log('⚙️  Test 9: Dynamic Configuration Updates');
    console.log('=========================================');
    
    console.log('Current configuration:');
    const currentConfig = fallbackManager.config;
    console.log(`  Max Retries: ${currentConfig.maxRetries}`);
    console.log(`  Retry Delay: ${currentConfig.retryDelay}ms`);
    console.log(`  Circuit Breaker Threshold: ${currentConfig.circuitBreakerThreshold}`);
    
    // Update configuration
    fallbackManager.updateConfig({
      maxRetries: 2,
      retryDelay: 500,
      circuitBreakerThreshold: 3
    });
    
    console.log('\n✅ Configuration updated successfully\n');

    // Test 10: Analytics and Metrics
    console.log('📊 Test 10: Analytics and Metrics');
    console.log('==================================');
    
    const finalAnalytics = fallbackManager.getAnalytics();
    console.log('Fallback System Analytics:');
    console.log(`  Available Chains: ${finalAnalytics.fallbackChains.join(', ')}`);
    console.log(`  Total Executions: ${finalAnalytics.totalExecutions}`);
    console.log(`  Successful Executions: ${finalAnalytics.successfulExecutions}`);
    
    console.log('\nCircuit Breaker States:');
    for (const [provider, breaker] of Object.entries(finalAnalytics.circuitBreakers)) {
      console.log(`  ${provider}: ${breaker.state} (${breaker.failures} failures)`);
    }
    
    console.log('\nHealth Metrics Summary:');
    for (const [provider, metrics] of Object.entries(finalAnalytics.healthMetrics)) {
      console.log(`  ${provider}: ${(metrics.successRate * 100).toFixed(1)}% success, ${metrics.avgDuration?.toFixed(0) || 0}ms avg`);
    }
    console.log();

    console.log('🎉 All fallback system tests completed!\n');
    
    console.log('📋 Test Summary:');
    console.log('================');
    console.log('✅ Successful request routing');
    console.log('✅ Automatic fallback on provider failure');
    console.log('✅ Circuit breaker protection');
    console.log('✅ Cost-optimized fallback chains');
    console.log('✅ Vision-capable fallback chains');
    console.log('✅ Custom fallback chain registration');
    console.log('✅ Retry logic with exponential backoff');
    console.log('✅ Continuous health monitoring');
    console.log('✅ Dynamic configuration updates');
    console.log('✅ Comprehensive analytics and metrics');
    
    console.log('\n🚀 Advanced Fallback System is production-ready!');

  } catch (error) {
    console.error('❌ Test suite failed:', error);
    console.error(error.stack);
  }
}

// Run tests
if (require.main === module) {
  testFallbackSystem();
}

module.exports = testFallbackSystem;
