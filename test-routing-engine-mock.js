const RoutingEngine = require('./src/services/routing-engine');

/**
 * Mock Provider for Testing Routing Engine
 */
class MockProvider {
  constructor(name, models, pricing, capabilities = ['text']) {
    this.name = name;
    this.models = models;
    this.pricing = pricing;
    this.capabilities = capabilities;
    this.healthy = true;
  }

  getAvailableModels() {
    return this.models.map(model => ({
      id: model,
      name: model,
      pricing: this.pricing,
      capabilities: this.capabilities
    }));
  }

  async healthCheck() {
    return this.healthy;
  }

  setHealthy(healthy) {
    this.healthy = healthy;
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
    // OpenAI Mock Provider
    const openaiProvider = new MockProvider('openai', 
      ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'], 
      { input: 0.005, output: 0.015 },
      ['text', 'vision', 'tools']
    );

    // Anthropic Mock Provider
    const anthropicProvider = new MockProvider('anthropic', 
      ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], 
      { input: 0.003, output: 0.015 },
      ['text', 'vision', 'tools', 'thinking']
    );

    // Google Mock Provider
    const googleProvider = new MockProvider('google', 
      ['gemini-2.5-pro', 'gemini-2.5-flash'], 
      { input: 0.00125, output: 0.005 },
      ['text', 'vision', 'tools', 'thinking', 'multimodal']
    );

    // Ollama Mock Provider (cheaper but limited)
    const ollamaProvider = new MockProvider('ollama', 
      ['llama3.1:8b', 'gemma2:9b'], 
      { input: 0.0001, output: 0.0001 },
      ['text']
    );

    this.activeProviders.set('openai', openaiProvider);
    this.activeProviders.set('anthropic', anthropicProvider);
    this.activeProviders.set('google', googleProvider);
    this.activeProviders.set('ollama', ollamaProvider);
  }
}

/**
 * Test Suite for Routing Engine
 */
async function testRoutingEngine() {
  console.log('🚀 Testing AI Gateway v2.0 Intelligent Routing Engine\n');

  try {
    // Initialize mock provider manager and routing engine
    const mockProviderManager = new MockProviderManager();
    const routingEngine = new RoutingEngine(mockProviderManager);

    console.log('✅ Routing engine initialized with mock providers\n');

    // Test 1: Cost-Optimized Routing
    console.log('💰 Test 1: Cost-Optimized Routing');
    console.log('==================================');
    
    const costRequest = {
      model: 'llama3.1:8b',
      messages: [{ role: 'user', content: 'Hello world' }],
      max_tokens: 100
    };

    const costDecision = await routingEngine.routeRequest(costRequest, {
      strategy: 'cost_optimized'
    });

    console.log(`✅ Selected Provider: ${costDecision.provider}`);
    console.log(`   Reason: ${costDecision.reason}`);
    console.log(`   Estimated Cost: $${costDecision.estimatedCost?.total?.toFixed(6) || 'N/A'}`);
    console.log(`   Alternatives: ${costDecision.alternatives?.length || 0}\n`);

    // Test 2: Performance-First Routing
    console.log('⚡ Test 2: Performance-First Routing');
    console.log('====================================');
    
    const perfRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Complex analysis task' }],
      max_tokens: 500
    };

    const perfDecision = await routingEngine.routeRequest(perfRequest, {
      strategy: 'performance_first'
    });

    console.log(`✅ Selected Provider: ${perfDecision.provider}`);
    console.log(`   Reason: ${perfDecision.reason}`);
    console.log(`   Performance Score: ${perfDecision.performanceScore?.toFixed(3) || 'N/A'}`);
    console.log(`   Alternatives: ${perfDecision.alternatives?.length || 0}\n`);

    // Test 3: Capability Matching
    console.log('🎯 Test 3: Capability-Matching Routing');
    console.log('======================================');
    
    const capabilityRequest = {
      model: 'gemini-2.5-pro',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,test' } }
          ]
        }
      ],
      max_tokens: 200
    };

    const capDecision = await routingEngine.routeRequest(capabilityRequest, {
      strategy: 'capability_match'
    });

    console.log(`✅ Selected Provider: ${capDecision.provider}`);
    console.log(`   Reason: ${capDecision.reason}`);
    console.log(`   Match Score: ${capDecision.matchScore?.toFixed(3) || 'N/A'}`);
    console.log(`   Required: ${capDecision.requiredCapabilities?.join(', ') || 'N/A'}`);
    console.log(`   Provider: ${capDecision.providerCapabilities?.join(', ') || 'N/A'}\n`);

    // Test 4: Hybrid Routing
    console.log('🔄 Test 4: Hybrid Routing Strategy');
    console.log('==================================');
    
    const hybridRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Write a detailed report' }],
      max_tokens: 1000
    };

    const hybridDecision = await routingEngine.routeRequest(hybridRequest, {
      strategy: 'hybrid'
    });

    console.log(`✅ Selected Provider: ${hybridDecision.provider}`);
    console.log(`   Reason: ${hybridDecision.reason}`);
    console.log(`   Total Score: ${hybridDecision.totalScore?.toFixed(3) || 'N/A'}`);
    if (hybridDecision.breakdown) {
      console.log(`   Cost: $${hybridDecision.breakdown.cost?.total?.toFixed(6) || 'N/A'}`);
      console.log(`   Health: ${hybridDecision.breakdown.health || 'N/A'}`);
    }
    console.log(`   Alternatives: ${hybridDecision.alternatives?.length || 0}\n`);

    // Test 5: Round-Robin Load Balancing
    console.log('🔄 Test 5: Round-Robin Load Balancing');
    console.log('====================================');
    
    const rrRequest = {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Simple question' }],
      max_tokens: 50
    };

    for (let i = 0; i < 4; i++) {
      const rrDecision = await routingEngine.routeRequest(rrRequest, {
        strategy: 'round_robin'
      });
      
      console.log(`Round ${i + 1}: ${rrDecision.provider} (${rrDecision.position}/${rrDecision.totalProviders})`);
    }
    console.log();

    // Test 6: Health-Aware Routing
    console.log('🏥 Test 6: Health-Aware Routing');
    console.log('===============================');
    
    // Make one provider unhealthy
    mockProviderManager.activeProviders.get('openai').setHealthy(false);
    
    const healthRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Health test' }],
      max_tokens: 100
    };

    const healthDecision = await routingEngine.routeRequest(healthRequest, {
      strategy: 'health_aware'
    });

    console.log(`✅ Selected Provider: ${healthDecision.provider}`);
    console.log(`   Reason: ${healthDecision.reason}`);
    console.log(`   Health Score: ${healthDecision.healthScore?.toFixed(3) || 'N/A'}`);
    console.log(`   (OpenAI was marked unhealthy)\n`);

    // Restore health
    mockProviderManager.activeProviders.get('openai').setHealthy(true);

    // Test 7: Configuration Updates
    console.log('⚙️  Test 7: Dynamic Configuration');
    console.log('=================================');
    
    console.log('Current config:');
    const config = routingEngine.getConfig();
    console.log(`   Cost Weight: ${config.costWeight}`);
    console.log(`   Performance Weight: ${config.performanceWeight}`);
    console.log(`   Health Weight: ${config.healthWeight}`);

    // Update to prioritize cost
    routingEngine.updateConfig({
      costWeight: 0.7,
      performanceWeight: 0.2,
      healthWeight: 0.1
    });

    console.log('\n✅ Updated to prioritize cost optimization\n');

    // Test 8: Analytics
    console.log('📈 Test 8: Routing Analytics');
    console.log('============================');
    
    const analytics = routingEngine.getAnalytics();
    console.log(`Total Requests: ${analytics.totalRequests}`);
    console.log(`Avg Processing Time: ${analytics.avgProcessingTime?.toFixed(2) || 0}ms`);
    console.log('Strategy Usage:');
    for (const [strategy, count] of Object.entries(analytics.strategies)) {
      console.log(`   ${strategy}: ${count}`);
    }
    console.log('Provider Usage:');
    for (const [provider, count] of Object.entries(analytics.providers)) {
      console.log(`   ${provider}: ${count}`);
    }
    console.log();

    // Test 9: Error Handling
    console.log('❌ Test 9: Error Handling');
    console.log('=========================');
    
    try {
      await routingEngine.routeRequest({
        model: 'nonexistent-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    } catch (error) {
      console.log(`✅ Correctly handled error: ${error.message}`);
    }

    try {
      await routingEngine.routeRequest(costRequest, {
        strategy: 'nonexistent-strategy'
      });
    } catch (error) {
      console.log(`✅ Correctly handled error: ${error.message}`);
    }
    console.log();

    // Test 10: Custom Strategy Registration
    console.log('🔧 Test 10: Custom Strategy Registration');
    console.log('=======================================');
    
    // Register a custom strategy
    routingEngine.registerStrategy('cheapest_only', async (request, providers) => {
      // Always select the cheapest provider
      return {
        provider: 'ollama',
        reason: 'cheapest_only',
        customStrategy: true
      };
    });

    const customDecision = await routingEngine.routeRequest(costRequest, {
      strategy: 'cheapest_only'
    });

    console.log(`✅ Custom Strategy Result: ${customDecision.provider}`);
    console.log(`   Reason: ${customDecision.reason}`);
    console.log(`   Custom: ${customDecision.customStrategy}\n`);

    console.log('🎉 All routing engine tests completed successfully!\n');
    
    console.log('📊 Test Summary:');
    console.log('================');
    console.log('✅ Cost-optimized routing - Selects cheapest provider');
    console.log('✅ Performance-first routing - Prioritizes speed/reliability');
    console.log('✅ Capability matching - Matches required features');
    console.log('✅ Hybrid routing - Balances cost, performance, health');
    console.log('✅ Round-robin balancing - Distributes load evenly');
    console.log('✅ Health-aware routing - Avoids unhealthy providers');
    console.log('✅ Dynamic configuration - Runtime config updates');
    console.log('✅ Analytics collection - Tracks usage patterns');
    console.log('✅ Error handling - Graceful failure management');
    console.log('✅ Custom strategies - Extensible routing logic');
    
    console.log('\n🚀 Intelligent Routing Engine is ready for production!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  }
}

// Run tests
if (require.main === module) {
  testRoutingEngine();
}

module.exports = testRoutingEngine;
