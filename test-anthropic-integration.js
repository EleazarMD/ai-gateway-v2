#!/usr/bin/env node

/**
 * Anthropic Provider Integration Test for AI Gateway v2.0
 * Tests Anthropic Claude provider functionality, health checks, and chat completions
 */

const axios = require('axios');
const colors = require('colors');

// Configuration
const AI_GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Test configuration
const TEST_CONFIG = {
  timeout: 30000,
  retries: 3,
  models: [
    'claude-3-5-haiku',
    'claude-3-7-sonnet', 
    'claude-4-sonnet',
    'claude-3-haiku'
  ]
};

class AnthropicIntegrationTester {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runTest(name, testFn) {
    console.log(`\n🧪 Running test: ${name}`.cyan);
    try {
      const result = await testFn();
      console.log(`✅ ${name}: PASSED`.green);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED', result });
      return result;
    } catch (error) {
      console.log(`❌ ${name}: FAILED - ${error.message}`.red);
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', error: error.message });
      throw error;
    }
  }

  async testGatewayHealth() {
    return this.runTest('AI Gateway Health Check', async () => {
      const response = await axios.get(`${AI_GATEWAY_BASE_URL}/health`, {
        timeout: 5000
      });
      
      if (response.status !== 200) {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      
      console.log(`   Status: ${response.data.status}`.gray);
      console.log(`   Version: ${response.data.version}`.gray);
      return response.data;
    });
  }

  async testModelsEndpoint() {
    return this.runTest('Models Endpoint - Anthropic Models', async () => {
      const response = await axios.get(`${AI_GATEWAY_BASE_URL}/api/v1/models`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 10000
      });
      
      if (response.status !== 200) {
        throw new Error(`Models endpoint failed with status ${response.status}`);
      }
      
      const models = response.data.data || [];
      const anthropicModels = models.filter(model => model.owned_by === 'anthropic');
      
      console.log(`   Total models: ${models.length}`.gray);
      console.log(`   Anthropic models: ${anthropicModels.length}`.gray);
      
      if (anthropicModels.length === 0) {
        throw new Error('No Anthropic models found in models endpoint');
      }
      
      anthropicModels.forEach(model => {
        console.log(`   - ${model.id} (${model.capabilities?.join(', ') || 'N/A'})`.gray);
      });
      
      return { total: models.length, anthropic: anthropicModels.length, models: anthropicModels };
    });
  }

  async testProviderHealth() {
    return this.runTest('Provider Health Status', async () => {
      const response = await axios.get(`${AI_GATEWAY_BASE_URL}/api/v1/providers/health`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 10000
      });
      
      if (response.status !== 200) {
        throw new Error(`Provider health endpoint failed with status ${response.status}`);
      }
      
      const providers = response.data.providers || {};
      const anthropicProvider = providers.anthropic;
      
      if (!anthropicProvider) {
        throw new Error('Anthropic provider not found in health status');
      }
      
      console.log(`   Anthropic Provider Status: ${anthropicProvider.healthy ? 'Healthy' : 'Unhealthy'}`.gray);
      console.log(`   Initialized: ${anthropicProvider.initialized}`.gray);
      console.log(`   Models: ${anthropicProvider.models?.length || 0}`.gray);
      
      if (!anthropicProvider.healthy) {
        throw new Error('Anthropic provider is not healthy');
      }
      
      return anthropicProvider;
    });
  }

  async testChatCompletion(model) {
    return this.runTest(`Chat Completion - ${model}`, async () => {
      const requestBody = {
        model: model,
        messages: [
          {
            role: 'user',
            content: 'Hello! Please respond with exactly "Anthropic Claude integration test successful" to confirm you are working correctly.'
          }
        ],
        max_tokens: 100,
        temperature: 0.1
      };
      
      console.log(`   Testing model: ${model}`.gray);
      
      const response = await axios.post(
        `${AI_GATEWAY_BASE_URL}/api/v1/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: TEST_CONFIG.timeout
        }
      );
      
      if (response.status !== 200) {
        throw new Error(`Chat completion failed with status ${response.status}`);
      }
      
      const result = response.data;
      
      if (!result.choices || result.choices.length === 0) {
        throw new Error('No choices returned in response');
      }
      
      const message = result.choices[0].message;
      const content = message.content;
      
      console.log(`   Response: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`.gray);
      console.log(`   Usage: ${result.usage?.total_tokens || 'N/A'} tokens`.gray);
      console.log(`   Cost: $${result.cost?.total?.toFixed(6) || 'N/A'}`.gray);
      console.log(`   Provider: ${result.provider}`.gray);
      
      if (!content || content.length === 0) {
        throw new Error('Empty response content');
      }
      
      return {
        model: result.model,
        provider: result.provider,
        content: content,
        usage: result.usage,
        cost: result.cost
      };
    });
  }

  async testVisionCapability() {
    return this.runTest('Vision Capability - Claude 3.5 Haiku', async () => {
      // Simple base64 encoded 1x1 pixel red image
      const redPixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      
      const requestBody = {
        model: 'claude-3-5-haiku',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'What color is this image? Please respond with just the color name.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${redPixelBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      };
      
      const response = await axios.post(
        `${AI_GATEWAY_BASE_URL}/api/v1/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: TEST_CONFIG.timeout
        }
      );
      
      if (response.status !== 200) {
        throw new Error(`Vision test failed with status ${response.status}`);
      }
      
      const result = response.data;
      const content = result.choices[0].message.content.toLowerCase();
      
      console.log(`   Vision response: "${content}"`.gray);
      
      if (!content.includes('red')) {
        throw new Error(`Expected color 'red' in response, got: ${content}`);
      }
      
      return { content, usage: result.usage };
    });
  }

  async testExtendedThinking() {
    return this.runTest('Extended Thinking - Claude 3.7 Sonnet', async () => {
      const requestBody = {
        model: 'claude-3-7-sonnet',
        messages: [
          {
            role: 'user',
            content: 'Think step by step: What is 15 * 23? Show your reasoning process.'
          }
        ],
        max_tokens: 200,
        temperature: 0.1,
        thinking: true
      };
      
      const response = await axios.post(
        `${AI_GATEWAY_BASE_URL}/api/v1/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: TEST_CONFIG.timeout
        }
      );
      
      if (response.status !== 200) {
        throw new Error(`Extended thinking test failed with status ${response.status}`);
      }
      
      const result = response.data;
      const content = result.choices[0].message.content;
      
      console.log(`   Thinking response length: ${content.length} chars`.gray);
      
      // Check if the response contains the correct answer (345)
      if (!content.includes('345')) {
        throw new Error(`Expected answer '345' in response, got: ${content.substring(0, 100)}...`);
      }
      
      return { content, usage: result.usage };
    });
  }

  async runAllTests() {
    console.log('🚀 Starting Anthropic Provider Integration Tests'.yellow.bold);
    console.log(`Gateway URL: ${AI_GATEWAY_BASE_URL}`.gray);
    console.log(`API Key: ${API_KEY ? 'Set' : 'Not Set'}`.gray);
    console.log(`Anthropic API Key: ${ANTHROPIC_API_KEY ? 'Set' : 'Not Set'}`.gray);
    
    if (!ANTHROPIC_API_KEY) {
      console.log('⚠️  Warning: ANTHROPIC_API_KEY not set - some tests may fail'.yellow);
    }
    
    try {
      // Basic health and connectivity tests
      await this.testGatewayHealth();
      await this.testModelsEndpoint();
      await this.testProviderHealth();
      
      // Test chat completions for different models
      for (const model of TEST_CONFIG.models) {
        try {
          await this.testChatCompletion(model);
        } catch (error) {
          console.log(`   Skipping ${model} - may not be available`.yellow);
        }
      }
      
      // Advanced capability tests
      if (ANTHROPIC_API_KEY) {
        try {
          await this.testVisionCapability();
        } catch (error) {
          console.log(`   Vision test failed: ${error.message}`.yellow);
        }
        
        try {
          await this.testExtendedThinking();
        } catch (error) {
          console.log(`   Extended thinking test failed: ${error.message}`.yellow);
        }
      }
      
    } catch (error) {
      console.log(`\n💥 Test suite failed: ${error.message}`.red.bold);
    }
    
    // Print summary
    console.log('\n📊 Test Results Summary'.yellow.bold);
    console.log(`✅ Passed: ${this.results.passed}`.green);
    console.log(`❌ Failed: ${this.results.failed}`.red);
    console.log(`📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`);
    
    if (this.results.failed > 0) {
      console.log('\n🔍 Failed Tests:'.red.bold);
      this.results.tests
        .filter(test => test.status === 'FAILED')
        .forEach(test => {
          console.log(`   - ${test.name}: ${test.error}`.red);
        });
    }
    
    return this.results.failed === 0;
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new AnthropicIntegrationTester();
  tester.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = AnthropicIntegrationTester;
