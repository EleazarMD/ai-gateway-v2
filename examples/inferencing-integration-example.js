/**
 * AI Inferencing Service Integration Example
 * 
 * This example shows how to integrate the AI Inferencing Service
 * into the AI Gateway for multi-tenant API key management.
 */

const AIInferencingClient = require('../src/clients/ai-inferencing-client');

// Initialize the inferencing client
const inferencingClient = new AIInferencingClient({
  baseUrl: process.env.AI_INFERENCING_URL || 'http://localhost:9000',
  apiKey: process.env.AI_INFERENCING_API_KEY, // Optional
  cacheTTL: 60000 // 1 minute cache
});

/**
 * Example: Chat Completions Handler with AI Inferencing
 */
async function handleChatCompletion(req, res) {
  try {
    // 1. Extract service context from request
    const serviceId = req.headers['x-service-id'] || 
                     req.body._context?.serviceId || 
                     'default-service';
    
    const model = req.body.model;
    
    console.log(`[Chat Completion] Service: ${serviceId}, Model: ${model}`);
    
    // 2. Determine provider from model name
    const provider = determineProvider(model);
    console.log(`[Chat Completion] Determined provider: ${provider}`);
    
    // 3. Get API key from AI Inferencing Service
    console.log(`[Chat Completion] Fetching API key for ${serviceId}/${provider}...`);
    const apiKey = await inferencingClient.getKey(serviceId, provider);
    
    if (!apiKey) {
      console.error(`[Chat Completion] No API key found for ${serviceId}/${provider}`);
      return res.status(404).json({
        error: 'API key not configured',
        message: `No API key found for service '${serviceId}' and provider '${provider}'. Please configure a key in the AI Inferencing Service.`,
        serviceId,
        provider
      });
    }
    
    console.log(`[Chat Completion] API key retrieved (cached: ${inferencingClient.cache.has(`${serviceId}:${provider}`)})`);
    
    // 4. Prepare upstream request
    const upstreamUrl = getProviderUrl(provider, model);
    const upstreamHeaders = getProviderHeaders(provider, apiKey, model);
    const upstreamBody = prepareProviderRequest(provider, req.body);
    
    console.log(`[Chat Completion] Routing to: ${upstreamUrl}`);
    
    // 5. Make upstream request to AI provider
    const startTime = Date.now();
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody)
    });
    
    const latency = Date.now() - startTime;
    console.log(`[Chat Completion] Provider response: ${response.status} (${latency}ms)`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Chat Completion] Provider error:`, errorText);
      return res.status(response.status).json({
        error: 'Provider request failed',
        provider,
        status: response.status,
        message: errorText
      });
    }
    
    const data = await response.json();
    
    // 6. Record usage (optional - implement based on your needs)
    recordUsage(serviceId, provider, {
      model,
      tokens: data.usage?.total_tokens || 0,
      latency,
      cost: calculateCost(provider, model, data.usage)
    });
    
    // 7. Return response to client
    res.json(data);
    
  } catch (error) {
    console.error('[Chat Completion] Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

/**
 * Determine AI provider from model name
 */
function determineProvider(model) {
  if (!model) return 'openai'; // default
  
  const modelLower = model.toLowerCase();
  
  // OpenAI models
  if (modelLower.startsWith('gpt-') || 
      modelLower.startsWith('o1-') || 
      modelLower.includes('davinci') ||
      modelLower.includes('turbo')) {
    return 'openai';
  }
  
  // Google Gemini models
  if (modelLower.startsWith('gemini-') || 
      modelLower.includes('palm')) {
    return 'google';
  }
  
  // Anthropic Claude models
  if (modelLower.startsWith('claude-')) {
    return 'anthropic';
  }
  
  // Ollama local models
  if (modelLower.includes('llama') || 
      modelLower.includes('mistral') ||
      modelLower.includes('mixtral') ||
      modelLower.includes('neural-chat') ||
      modelLower.includes('codellama')) {
    return 'ollama';
  }
  
  // Perplexity models
  if (modelLower.includes('sonar') || 
      modelLower.includes('pplx')) {
    return 'perplexity';
  }
  
  return 'openai'; // default fallback
}

/**
 * Get provider API URL
 */
function getProviderUrl(provider, model) {
  const urls = {
    openai: 'https://api.openai.com/v1/chat/completions',
    google: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    anthropic: 'https://api.anthropic.com/v1/messages',
    ollama: 'http://localhost:11434/api/chat',
    perplexity: 'https://api.perplexity.ai/chat/completions'
  };
  
  return urls[provider] || urls.openai;
}

/**
 * Get provider-specific headers
 */
function getProviderHeaders(provider, apiKey, model) {
  const baseHeaders = {
    'Content-Type': 'application/json'
  };
  
  switch (provider) {
    case 'openai':
    case 'perplexity':
      return {
        ...baseHeaders,
        'Authorization': `Bearer ${apiKey}`
      };
      
    case 'google':
      // Google uses API key in URL query param, not header
      return baseHeaders;
      
    case 'anthropic':
      return {
        ...baseHeaders,
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      };
      
    case 'ollama':
      // Ollama doesn't require API key for local instance
      return baseHeaders;
      
    default:
      return {
        ...baseHeaders,
        'Authorization': `Bearer ${apiKey}`
      };
  }
}

/**
 * Prepare request body for specific provider
 */
function prepareProviderRequest(provider, requestBody) {
  switch (provider) {
    case 'google':
      // Transform OpenAI format to Google Gemini format
      return {
        contents: requestBody.messages.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })),
        generationConfig: {
          temperature: requestBody.temperature,
          maxOutputTokens: requestBody.max_tokens
        }
      };
      
    case 'anthropic':
      // Transform to Anthropic format
      const { model, messages, max_tokens, temperature, ...rest } = requestBody;
      return {
        model,
        messages,
        max_tokens: max_tokens || 1024,
        temperature,
        ...rest
      };
      
    case 'ollama':
      // Ollama uses slightly different format
      return {
        model: requestBody.model,
        messages: requestBody.messages,
        stream: requestBody.stream || false,
        options: {
          temperature: requestBody.temperature,
          num_predict: requestBody.max_tokens
        }
      };
      
    default:
      // OpenAI and Perplexity use same format
      return requestBody;
  }
}

/**
 * Calculate cost based on usage
 */
function calculateCost(provider, model, usage) {
  if (!usage) return 0;
  
  // Rough pricing estimates (update with actual pricing)
  const pricing = {
    'gpt-4': { input: 0.03, output: 0.06 }, // per 1K tokens
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'gemini-pro': { input: 0.00025, output: 0.0005 }
  };
  
  const modelPricing = pricing[model] || { input: 0.001, output: 0.002 };
  
  const inputCost = (usage.prompt_tokens || 0) / 1000 * modelPricing.input;
  const outputCost = (usage.completion_tokens || 0) / 1000 * modelPricing.output;
  
  return inputCost + outputCost;
}

/**
 * Record usage for analytics
 */
function recordUsage(serviceId, provider, metrics) {
  // This would integrate with your usage tracking system
  console.log(`[Usage] ${serviceId}/${provider}:`, {
    model: metrics.model,
    tokens: metrics.tokens,
    latency: metrics.latency,
    cost: metrics.cost
  });
  
  // TODO: Send to AI Inferencing Service usage tracking
  // Or implement your own tracking system
}

/**
 * Test the integration
 */
async function testIntegration() {
  console.log('Testing AI Inferencing Integration...\n');
  
  // 1. Test health check
  console.log('1. Health Check:');
  const health = await inferencingClient.healthCheck();
  console.log('   ', health);
  console.log('');
  
  // 2. Test getting a key
  console.log('2. Get API Key:');
  try {
    const key = await inferencingClient.getKey('research-agent', 'openai');
    console.log('   ', key ? '✅ Key retrieved' : '❌ No key found');
  } catch (error) {
    console.log('   ', '❌ Error:', error.message);
  }
  console.log('');
  
  // 3. Test provider determination
  console.log('3. Provider Determination:');
  const tests = [
    { model: 'gpt-4', expected: 'openai' },
    { model: 'gemini-2.0-flash', expected: 'google' },
    { model: 'claude-3-opus', expected: 'anthropic' },
    { model: 'llama2', expected: 'ollama' }
  ];
  
  tests.forEach(({ model, expected }) => {
    const provider = determineProvider(model);
    const match = provider === expected ? '✅' : '❌';
    console.log(`   ${match} ${model} → ${provider} (expected: ${expected})`);
  });
  
  console.log('\n✅ Integration test complete!');
}

// Export functions
module.exports = {
  handleChatCompletion,
  determineProvider,
  getProviderUrl,
  getProviderHeaders,
  prepareProviderRequest,
  calculateCost,
  testIntegration,
  inferencingClient
};

// Run test if executed directly
if (require.main === module) {
  testIntegration().catch(console.error);
}
