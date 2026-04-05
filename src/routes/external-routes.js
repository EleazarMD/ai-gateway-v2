/**
 * External API Routes (Port 8777)
 * AI inference endpoints - chat completions, embeddings, models
 */

const express = require('express');
const { authenticateExternal } = require('../middleware/authentication');
const { normalizeModelName } = require('../middleware/model-normalizer');

function createExternalRoutes(dependencies) {
  const router = express.Router();
  const { 
    chatCompletionsHandler,
    embeddingsHandler,
    imageGenerationHandler,
    streamingRAGHandler,
    openclawProxyHandler,
    providerManager,
    workspaceProxy
  } = dependencies;

  // ==================== Health Check ====================
  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      service: 'ai-gateway-external',
      version: '2.5.0',
      port: process.env.EXTERNAL_PORT || 8777,
      endpoints: [
        'POST /api/chat/completions',
        'POST /api/v1/chat/completions',
        'POST /v1/messages (Anthropic)',
        'POST /v1beta/models/:model/generateContent (Google)',
        'POST /api/v1/embeddings',
        'GET /api/v1/info'
      ],
      timestamp: new Date().toISOString()
    });
  });

  // ==================== OpenAI-compatible Chat Completions (no version) ====================
  router.use('/api/chat/completions', express.json({ limit: '10mb' }));
  router.use('/api/chat/completions', (req, res, next) => {
    console.log(`[EXTERNAL-8777] (compat) Chat completion request: ${req.method} ${req.url}`);
    next();
  });
  router.use('/api/chat/completions', normalizeModelName);
  router.use('/api/chat/completions', authenticateExternal);
  router.post('/api/chat/completions', authenticateExternal, async (req, res) => {
    try {
      await chatCompletionsHandler.handle(req, res);
    } catch (error) {
      console.error('[External Routes] Chat completions error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  // ==================== OpenAI Chat Completions API (v1) ====================
  router.use('/api/v1/chat/completions', express.json({ limit: '10mb' }));
  router.use('/api/v1/chat/completions', (req, res, next) => {
    console.log(`[EXTERNAL-8777] Chat completion request: ${req.method} ${req.url}`);
    next();
  });
  router.use('/api/v1/chat/completions', normalizeModelName);
  router.use('/api/v1/chat/completions', authenticateExternal);
  router.post('/api/v1/chat/completions', authenticateExternal, async (req, res) => {
    try {
      await chatCompletionsHandler.handle(req, res);
    } catch (error) {
      console.error('[External Routes] Chat completions (v1) error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  // ==================== Standard OpenAI path (no /api/ prefix) ====================
  // OpenClaw SDK and standard OpenAI clients use /v1/chat/completions directly.
  router.use('/v1/chat/completions', express.json({ limit: '10mb' }));
  router.use('/v1/chat/completions', normalizeModelName);
  router.use('/v1/chat/completions', authenticateExternal);
  router.post('/v1/chat/completions', authenticateExternal, async (req, res) => {
    try {
      console.log(`[EXTERNAL-8777] (standard) Chat completion request: ${req.method} ${req.url}`);
      await chatCompletionsHandler.handle(req, res);
    } catch (error) {
      console.error('[External Routes] Chat completions (standard) error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  // ==================== OpenAI Responses API (for OpenClaw openai-responses compatibility) ====================
  router.use('/api/v1/responses', express.json({ limit: '10mb' }));
  router.use('/api/v1/responses', (req, res, next) => {
    console.log(`[EXTERNAL-8777] Responses API request: ${req.method} ${req.url}`);
    next();
  });
  router.use('/api/v1/responses', authenticateExternal);
  router.post('/api/v1/responses', authenticateExternal, async (req, res) => {
    try {
      const { model, input, instructions, tools, max_output_tokens, store, stream, previous_response_id, ...rest } = req.body;

      // Build messages array from Responses API input
      let messages = [];
      if (instructions) {
        messages.push({ role: 'system', content: instructions });
      }
      if (typeof input === 'string') {
        messages.push({ role: 'user', content: input });
      } else if (Array.isArray(input)) {
        for (const item of input) {
          if (typeof item === 'string') {
            messages.push({ role: 'user', content: item });
          } else if (item.role && item.content) {
            // Convert content items: input_text -> text for chat completions
            if (Array.isArray(item.content)) {
              const converted = item.content.map(c => {
                if (c.type === 'input_text') return { type: 'text', text: c.text };
                if (c.type === 'input_image') return { type: 'image_url', image_url: { url: c.image_url } };
                return c;
              });
              messages.push({ role: item.role, content: converted });
            } else {
              messages.push({ role: item.role, content: item.content });
            }
          } else if (item.type === 'message') {
            const content = Array.isArray(item.content)
              ? item.content.map(c => c.type === 'output_text' ? c.text : c).join('')
              : item.content;
            messages.push({ role: item.role || 'assistant', content });
          }
        }
      }

      // Transform tools from Responses API format to Chat Completions format
      let chatTools;
      if (tools && Array.isArray(tools)) {
        chatTools = tools.map(t => {
          if (t.type === 'function') return t;
          return t;
        });
      }

      // Build chat completions request — omit tools for local llama.cpp which 500s on many tools
      const chatReqBody = {
        model: model,
        messages: messages,
        max_tokens: max_output_tokens || 4096,
        stream: false,
      };

      console.log(`[Responses API] Transformed: model=${model}, messages=${messages.length}, tools=${chatTools?.length || 0}`);

      // Make internal HTTP call to chat completions endpoint
      const axios = require('axios');
      const externalPort = process.env.EXTERNAL_PORT || 8777;
      const chatResponse = await axios.post(
        `http://127.0.0.1:${externalPort}/api/v1/chat/completions`,
        chatReqBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': req.headers['authorization'] || `Bearer ${process.env.API_KEY || 'ai-gateway-api-key-2024'}`
          },
          timeout: 120000
        }
      );

      const chatData = chatResponse.data;
      const crypto = require('crypto');
      const respId = 'resp_' + crypto.randomBytes(16).toString('hex');
      const msgId = 'msg_' + crypto.randomBytes(16).toString('hex');
      const now = Math.floor(Date.now() / 1000);

      const choice = chatData?.choices?.[0];
      const assistantContent = choice?.message?.content || '';
      const toolCalls = choice?.message?.tool_calls;

      const output = [];
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          output.push({
            type: 'function_call',
            id: tc.id || ('call_' + crypto.randomBytes(8).toString('hex')),
            call_id: tc.id || ('call_' + crypto.randomBytes(8).toString('hex')),
            name: tc.function?.name,
            arguments: tc.function?.arguments || '{}'
          });
        }
      }
      output.push({
        type: 'message',
        id: msgId,
        status: 'completed',
        role: 'assistant',
        content: [
          { type: 'output_text', text: assistantContent, annotations: [] }
        ]
      });

      res.json({
        id: respId,
        object: 'response',
        created_at: now,
        status: 'completed',
        completed_at: now,
        error: null,
        incomplete_details: null,
        instructions: instructions || null,
        max_output_tokens: max_output_tokens || null,
        model: chatData?.model || model,
        output: output,
        parallel_tool_calls: true,
        previous_response_id: previous_response_id || null,
        reasoning: { effort: null, summary: null },
        store: store !== undefined ? store : true,
        temperature: 1.0,
        text: { format: { type: 'text' } },
        tool_choice: 'auto',
        tools: tools || [],
        top_p: 1.0,
        truncation: 'disabled',
        usage: {
          input_tokens: chatData?.usage?.prompt_tokens || 0,
          input_tokens_details: { cached_tokens: chatData?.usage?.cached_tokens || 0 },
          output_tokens: chatData?.usage?.completion_tokens || 0,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: chatData?.usage?.total_tokens || 0
        },
        user: null,
        metadata: {}
      });
    } catch (error) {
      console.error('[External Routes] Responses API error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({
          id: 'resp_error',
          object: 'response',
          status: 'failed',
          error: { type: 'server_error', message: error.message || 'Internal server error' }
        });
      }
    }
  });

  // ==================== Embeddings API ====================
  router.post('/api/v1/embeddings', authenticateExternal, async (req, res) => {
    try {
      if (embeddingsHandler && typeof embeddingsHandler.handle === 'function') {
        await embeddingsHandler.handle(req, res);
      } else {
        res.status(501).json({ error: 'Embeddings endpoint not implemented' });
      }
    } catch (error) {
      console.error('[External Routes] Embeddings error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  // ==================== Image Generation API ====================
  router.use('/api/v1/images/generate', express.json());
  router.post('/api/v1/images/generate', authenticateExternal, async (req, res) => {
    try {
      await imageGenerationHandler.handle(req, res);
    } catch (error) {
      console.error('[External Routes] Image generation error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  router.use('/api/v1/images/generate/stream', express.json());
  router.post('/api/v1/images/generate/stream', authenticateExternal, async (req, res) => {
    try {
      await imageGenerationHandler.handleStream(req, res);
    } catch (error) {
      console.error('[External Routes] Image generation stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    }
  });

  // ==================== Streaming RAG API ====================
  // Zero-tolerance compliant streaming retrieval-augmented generation
  // See: docs/technical-reference/chapters/22_STREAMING_RAG.md
  if (streamingRAGHandler) {
    router.use('/api/v1/rag', authenticateExternal, streamingRAGHandler.getRouter());
    console.log('[External Routes] Streaming RAG endpoints registered at /api/v1/rag');
  }

  // ==================== OpenClaw Proxy API ====================
  // Proxies requests to OpenClaw Gateway (18789) through AI Gateway security perimeter
  // Endpoints: /api/openclaw/chat, /api/openclaw/chat/stream, /api/openclaw/status
  if (openclawProxyHandler) {
    router.use('/api/openclaw', authenticateExternal, openclawProxyHandler.getRouter());
    console.log('[External Routes] OpenClaw proxy endpoints registered at /api/openclaw');
  }

  // ==================== PIC (Personal Identity Core) Proxy API ====================
  // Proxies requests to PIC service through AI Gateway security perimeter
  // Zero-tolerance security: All PIC access must be audited and rate-limited
  // See: docs/technical-reference/chapters/02_AI_GATEWAY.md#pic-proxy-endpoints
  const picProxy = require('./pic-proxy');
  router.use('/api/v1/pic', authenticateExternal, picProxy);
  console.log('[External Routes] PIC proxy endpoints registered at /api/v1/pic');

  // ==================== Hermes Core Proxy API ====================
  // Proxies requests to Hermes Core through AI Gateway security perimeter
  const hermesProxy = require('./hermes-proxy');
  router.use('/api/hermes', authenticateExternal, hermesProxy);
  console.log('[External Routes] Hermes proxy endpoints registered at /api/hermes');

  // ==================== Anthropic Messages API ====================
  router.post('/v1/messages', authenticateExternal, async (req, res) => {
    // Transform Anthropic format to OpenAI format
    const anthropicRequest = req.body;
    const openaiRequest = {
      model: anthropicRequest.model,
      messages: anthropicRequest.messages,
      max_tokens: anthropicRequest.max_tokens,
      temperature: anthropicRequest.temperature,
      stream: anthropicRequest.stream || false
    };
    
    req.body = openaiRequest;
    await chatCompletionsHandler.handle(req, res);
  });

  // ==================== Google Gemini Native API ====================
  router.post('/v1beta/models/:model/generateContent', authenticateExternal, async (req, res) => {
    console.log(`[EXTERNAL-8777] Google Gemini native request: ${req.params.model}`);
    
    // Default serviceId for Gemini CLI (doesn't support custom headers like Claude CLI)
    if (!req.headers['x-service-id']) {
      req.headers['x-service-id'] = 'gemini-cli';
      req.headers['x-project-id'] = req.headers['x-project-id'] || 'goose-agent';
      console.log(`[EXTERNAL-8777] Defaulting to serviceId: gemini-cli (Gemini CLI doesn't support custom headers)`);
    }
    
    // Transform Google Gemini format to OpenAI format
    const geminiRequest = req.body;
    const model = req.params.model;
    
    // Extract messages from Gemini contents array
    const messages = [];
    
    // Handle systemInstruction if present
    if (geminiRequest.systemInstruction) {
      const systemText = geminiRequest.systemInstruction.parts?.[0]?.text || '';
      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
    }
    
    // Transform contents to messages
    if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
      for (const content of geminiRequest.contents) {
        const role = content.role === 'model' ? 'assistant' : 'user';
        const text = content.parts?.[0]?.text || '';
        if (text) {
          messages.push({ role, content: text });
        }
      }
    }
    
    const openaiRequest = {
      model: model,
      messages: messages,
      max_tokens: geminiRequest.generationConfig?.maxOutputTokens || 4096,
      temperature: geminiRequest.generationConfig?.temperature || 0.7,
      stream: false
    };
    
    req.body = openaiRequest;
    await chatCompletionsHandler.handle(req, res);
  });

  // ==================== Google Gemini All Actions (catch-all) ====================
  router.post('/v1beta/models/*', async (req, res) => {
    const fullPath = decodeURIComponent(req.params[0]); // Decode URL-encoded colons
    console.log(`[EXTERNAL-8777] Google Gemini request: ${fullPath}`);
    
    // Extract model name (everything before : or /generateContent)
    const modelName = fullPath.split(/[:/]/)[0];
    const isStreaming = fullPath.includes('stream');
    
    console.log(`[EXTERNAL-8777] Extracted model: ${modelName}, streaming: ${isStreaming}`);
    
    // Default serviceId for Gemini CLI (doesn't support custom headers like Claude CLI)
    if (!req.headers['x-service-id']) {
      req.headers['x-service-id'] = 'gemini-cli';
      req.headers['x-project-id'] = req.headers['x-project-id'] || 'goose-agent';
      console.log(`[EXTERNAL-8777] Defaulting to serviceId: gemini-cli`);
    }
    
    // Transform Google Gemini format to OpenAI format
    const geminiRequest = req.body;
    
    // Extract messages from Gemini contents array
    const messages = [];
    
    // Handle systemInstruction if present
    if (geminiRequest.systemInstruction) {
      const systemText = geminiRequest.systemInstruction.parts?.[0]?.text || '';
      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
    }
    
    // Transform contents to messages
    if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
      for (const content of geminiRequest.contents) {
        const role = content.role === 'model' ? 'assistant' : 'user';
        const text = content.parts?.[0]?.text || '';
        if (text) {
          messages.push({ role, content: text });
        }
      }
    }
    
    const openaiRequest = {
      model: modelName,
      messages: messages,
      max_tokens: geminiRequest.generationConfig?.maxOutputTokens || 4096,
      temperature: geminiRequest.generationConfig?.temperature || 0.7,
      stream: isStreaming
    };
    
    req.body = openaiRequest;
    
    // Intercept response to transform from OpenAI format back to Google format
    const originalSend = res.send;
    const originalWrite = res.write;
    const originalEnd = res.end;
    
    if (isStreaming) {
      // Handle streaming response transformation
      res.write = function(chunk) {
        try {
          const chunkStr = chunk.toString();
          if (chunkStr.includes('data: ')) {
            // Transform OpenAI SSE to Google SSE format
            const lines = chunkStr.split('\n');
            const transformedLines = lines.map(line => {
              if (line.startsWith('data: ')) {
                if (line.includes('[DONE]')) {
                  // Transform OpenAI [DONE] to Google format
                  return 'data: {"candidates":[{"finishReason":"STOP"}]}';
                }
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices && data.choices[0] && data.choices[0].delta) {
                    const content = data.choices[0].delta.content || '';
                    if (content) {
                      // Transform to Google streaming format
                      const googleChunk = {
                        candidates: [{
                          content: {
                            parts: [{ text: content }],
                            role: 'model'
                          }
                        }]
                      };
                      return `data: ${JSON.stringify(googleChunk)}`;
                    }
                  }
                } catch (e) {
                  // If parsing fails, return original line
                  return line;
                }
              }
              return line;
            });
            return originalWrite.call(this, transformedLines.join('\n'));
          }
        } catch (e) {
          // If transformation fails, pass through original
        }
        return originalWrite.call(this, chunk);
      };
    } else {
      // Handle non-streaming response transformation
      res.send = function(data) {
        try {
          if (typeof data === 'string') {
            const openaiResponse = JSON.parse(data);
            if (openaiResponse.choices && openaiResponse.choices[0]) {
              const content = openaiResponse.choices[0].message?.content || '';
              // Transform to Google response format
              const googleResponse = {
                candidates: [{
                  content: {
                    parts: [{ text: content }],
                    role: 'model'
                  },
                  finishReason: 'STOP'
                }],
                usageMetadata: {
                  promptTokenCount: openaiResponse.usage?.prompt_tokens || 0,
                  candidatesTokenCount: openaiResponse.usage?.completion_tokens || 0,
                  totalTokenCount: openaiResponse.usage?.total_tokens || 0
                }
              };
              return originalSend.call(this, JSON.stringify(googleResponse));
            }
          }
        } catch (e) {
          // If transformation fails, pass through original
        }
        return originalSend.call(this, data);
      };
    }
    
    await chatCompletionsHandler.handle(req, res);
  });

  // ==================== Provider Management ====================
  router.post('/api/providers/select', authenticateExternal, (req, res) => {
    const { providerId, model } = req.body;
    
    if (!providerId) {
      return res.status(400).json({ error: 'providerId is required' });
    }
    
    // Store provider preference (simplified)
    res.json({
      success: true,
      providerId,
      model: model || 'default',
      message: `Provider ${providerId} selected`
    });
  });

  // ==================== Gateway Info ====================
  router.get('/api/v1/info', authenticateExternal, (req, res) => {
    res.json({
      version: '2.5.0',
      service: 'AI Gateway',
      capabilities: [
        'chat-completions',
        'embeddings',
        'streaming',
        'multi-provider',
        'cost-tracking'
      ],
      providers: ['openai', 'anthropic', 'google', 'perplexity'],
      endpoints: {
        chat: '/api/v1/chat/completions',
        embeddings: '/api/v1/embeddings',
        anthropic: '/v1/messages',
        google: '/v1beta/models/:model/generateContent',
        info: '/api/v1/info'
      },
      timestamp: new Date().toISOString()
    });
  });

  // ==================== Analytics & Monitoring ====================
  router.get('/api/v1/analytics/routing', authenticateExternal, async (req, res) => {
    res.json({
      routing_decisions: [],
      timestamp: new Date().toISOString()
    });
  });

  router.get('/api/v1/analytics/fallback', authenticateExternal, async (req, res) => {
    res.json({
      fallback_triggers: [],
      timestamp: new Date().toISOString()
    });
  });

  router.get('/api/v1/providers/status', authenticateExternal, async (req, res) => {
    try {
      const status = await providerManager.getComprehensiveHealthStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/api/v1/health/comprehensive', authenticateExternal, async (req, res) => {
    try {
      const health = await providerManager.getComprehensiveHealthStatus();
      res.json(health);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Configuration ====================
  const normalizeRoutingRules = (rules) => {
    if (!Array.isArray(rules)) {
      return [];
    }

    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      condition: rule.condition || {},
      targetProvider: rule.targetProvider,
      targetModel: rule.targetModel || rule.model,
      fallbackProviders: rule.fallbackProviders || [],
      enabled: rule.enabled !== false
    }));
  };

  router.get('/api/v1/config/routing', authenticateExternal, async (req, res) => {
    const routingEngine = providerManager.getRoutingEngine?.();
    const routingConfig = routingEngine?.getConfig?.() || {};
    res.json({
      routing_rules: routingConfig.routingRules || [],
      timestamp: new Date().toISOString()
    });
  });

  router.put('/api/v1/config/routing', authenticateExternal, async (req, res) => {
    const incomingRules = req.body?.routing_rules || req.body?.routingRules || req.body?.rules;
    const normalizedRules = normalizeRoutingRules(incomingRules);

    console.log('[External Routes] PUT /api/v1/config/routing - Normalized rules count:', normalizedRules.length);
    providerManager.updateRoutingConfig({ routingRules: normalizedRules });
    console.log('[External Routes] updateRoutingConfig called successfully');

    res.json({
      success: true,
      updated: {
        routing_rules: normalizedRules
      }
    });
  });

  router.put('/api/v1/config/fallback', authenticateExternal, async (req, res) => {
    res.json({ success: true, updated: req.body });
  });

  // ==================== Workspace Proxy ====================
  if (workspaceProxy) {
    router.use('/api/workspace', workspaceProxy);
  }

  // ==================== Security Routes ====================
  if (dependencies.securityHandler) {
    // Anomalies
    router.get('/api/v1/security/anomalies', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getAnomalies(req, res)
    );
    router.put('/api/v1/security/anomalies/:id', authenticateExternal, (req, res) => 
      dependencies.securityHandler.updateAnomaly(req, res)
    );
    
    // Metrics
    router.get('/api/v1/security/metrics', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getMetrics(req, res)
    );
    
    // Audit Log
    router.get('/api/v1/security/audit-log', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getAuditLog(req, res)
    );
    router.get('/api/v1/security/audit-log/export', authenticateExternal, (req, res) => 
      dependencies.securityHandler.exportAuditLog(req, res)
    );
    
    // Health
    router.get('/api/v1/security/health', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getHealthStatus(req, res)
    );
    
    // Alert Rules
    router.get('/api/v1/security/alerts/rules', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getAlertRules(req, res)
    );
    
    // Alert History
    router.get('/api/v1/security/alerts/history', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getAlertHistory(req, res)
    );
    
    // Acknowledge Alert
    router.post('/api/v1/security/alerts/:id/acknowledge', authenticateExternal, (req, res) => 
      dependencies.securityHandler.acknowledgeAlert(req, res)
    );
    
    // Notification Channels
    router.get('/api/v1/security/notifications/channels', authenticateExternal, (req, res) => 
      dependencies.securityHandler.getNotificationChannels(req, res)
    );
    
    // Test Notification (admin only - but accessible via external for testing)
    router.post('/api/v1/security/notifications/channels/:channelId/test', authenticateExternal, (req, res) => 
      dependencies.securityHandler.testNotificationChannel(req, res)
    );
  }

  return router;
}

module.exports = createExternalRoutes;
