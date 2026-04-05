#!/usr/bin/env node

/**
 * Google Gemini Provider Integration Test for AI Gateway v2.0
 * Tests Google Gemini provider functionality, health checks, and chat completions
 */

const axios = require('axios');
const colors = require('colors');

// Configuration
const AI_GATEWAY_BASE_URL = process.env.AI_GATEWAY_BASE_URL || 'http://localhost:8777';
const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Test configuration
const TEST_CONFIG = {
  timeout: 30000,
  retries: 3,
  models: [
    'gemini-2-5-flash',
    'gemini-2-5-flash-lite',
    'gemini-2-5-pro',
    'gemini-2-0-flash',
    'gemini-1-5-flash'
  ]
};

class GoogleIntegrationTester {
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
    return this.runTest('Models Endpoint - Google Models', async () => {
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
      const googleModels = models.filter(model => model.owned_by === 'google');
      
      console.log(`   Total models: ${models.length}`.gray);
      console.log(`   Google models: ${googleModels.length}`.gray);
      
      if (googleModels.length === 0) {
        throw new Error('No Google models found in models endpoint');
      }
      
      googleModels.forEach(model => {
        console.log(`   - ${model.id} (${model.capabilities?.join(', ') || 'N/A'})`.gray);
      });
      
      return { total: models.length, google: googleModels.length, models: googleModels };
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
      const googleProvider = providers.google;
      
      if (!googleProvider) {
        throw new Error('Google provider not found in health status');
      }
      
      console.log(`   Google Provider Status: ${googleProvider.healthy ? 'Healthy' : 'Unhealthy'}`.gray);
      console.log(`   Initialized: ${googleProvider.initialized}`.gray);
      console.log(`   Models: ${googleProvider.models?.length || 0}`.gray);
      
      if (!googleProvider.healthy) {
        throw new Error('Google provider is not healthy');
      }
      
      return googleProvider;
    });
  }

  async testChatCompletion(model) {
    return this.runTest(`Chat Completion - ${model}`, async () => {
      const requestBody = {
        model: model,
        messages: [
          {
            role: 'user',
            content: 'Hello! Please respond with exactly "Google Gemini integration test successful" to confirm you are working correctly.'
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
    return this.runTest('Vision Capability - Gemini 2.5 Flash', async () => {
      // Simple base64 encoded 1x1 pixel blue image
      const bluePixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI/hRWkOAAAAABJRU5ErkJggg==';
      
      const requestBody = {
        model: 'gemini-2-5-flash',
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
                  url: `data:image/png;base64,${bluePixelBase64}`
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
      
      if (!content.includes('blue')) {
        throw new Error(`Expected color 'blue' in response, got: ${content}`);
      }
      
      return { content, usage: result.usage };
    });
  }

  async testThinkingCapability() {
    return this.runTest('Thinking Capability - Gemini 2.5 Pro', async () => {
      const requestBody = {
        model: 'gemini-2-5-pro',
        messages: [
          {
            role: 'user',
            content: 'Think step by step: What is 17 * 29? Show your reasoning process.'
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
        throw new Error(`Thinking test failed with status ${response.status}`);
      }
      
      const result = response.data;
      const content = result.choices[0].message.content;
      
      console.log(`   Thinking response length: ${content.length} chars`.gray);
      
      // Check if the response contains the correct answer (493)
      if (!content.includes('493')) {
        throw new Error(`Expected answer '493' in response, got: ${content.substring(0, 100)}...`);
      }
      
      return { content, usage: result.usage };
    });
  }

  async testFunctionCalling() {
    return this.runTest('Function Calling - Gemini 2.5 Flash', async () => {
      const requestBody = {
        model: 'gemini-2-5-flash',
        messages: [
          {
            role: 'user',
            content: 'What is the weather like in San Francisco today?'
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA'
                  }
                },
                required: ['location']
              }
            }
          }
        ],
        max_tokens: 150,
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
        throw new Error(`Function calling test failed with status ${response.status}`);
      }
      
      const result = response.data;
      const message = result.choices[0].message;
      
      console.log(`   Function calls: ${message.tool_calls?.length || 0}`.gray);
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        console.log(`   Function: ${toolCall.function.name}`.gray);
        console.log(`   Arguments: ${toolCall.function.arguments}`.gray);
        
        if (toolCall.function.name !== 'get_weather') {
          throw new Error(`Expected function 'get_weather', got: ${toolCall.function.name}`);
        }
      } else {
        console.log(`   No function calls detected - model may have responded directly`.yellow);
      }
      
      return { message, usage: result.usage };
    });
  }

  async runAllTests() {
    console.log('🚀 Starting Google Gemini Provider Integration Tests'.yellow.bold);
    console.log(`Gateway URL: ${AI_GATEWAY_BASE_URL}`.gray);
    console.log(`API Key: ${API_KEY ? 'Set' : 'Not Set'}`.gray);
    console.log(`Google API Key: ${GOOGLE_API_KEY ? 'Set' : 'Not Set'}`.gray);
    
    if (!GOOGLE_API_KEY) {
      console.log('⚠️  Warning: GOOGLE_API_KEY not set - some tests may fail'.yellow);
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
      if (GOOGLE_API_KEY) {
        try {
          await this.testVisionCapability();
        } catch (error) {
          console.log(`   Vision test failed: ${error.message}`.yellow);
        }
        
        try {
          await this.testThinkingCapability();
        } catch (error) {
          console.log(`   Thinking test failed: ${error.message}`.yellow);
        }
        
        try {
          await this.testFunctionCalling();
        } catch (error) {
          console.log(`   Function calling test failed: ${error.message}`.yellow);
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
  const tester = new GoogleIntegrationTester();
  tester.runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = GoogleIntegrationTester;
