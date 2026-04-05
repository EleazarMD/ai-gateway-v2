/**
 * OpenClaw Proxy Handler
 * 
 * Proxies requests to the OpenClaw Gateway (port 18789) through the AI Gateway
 * security perimeter (port 8777). This allows iOS and other clients to connect
 * to OpenClaw via the unified security layer.
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  iOS App / Dashboard                                                │
 * │         │                                                           │
 * │         ▼                                                           │
 * │  AI Gateway (8777) ──► Security Pipeline                           │
 * │         │              - API Key auth                               │
 * │         │              - Rate limiting                              │
 * │         │              - Audit logging                              │
 * │         │                                                           │
 * │         ▼                                                           │
 * │  OpenClaw Proxy Handler                                             │
 * │         │                                                           │
 * │         ▼                                                           │
 * │  OpenClaw Gateway (18789)                                           │
 * │         │                                                           │
 * │         ▼                                                           │
 * │  LLM Providers (via AI Gateway internal)                           │
 * └─────────────────────────────────────────────────────────────────────┘
 * 
 * Endpoints proxied:
 * - POST /api/openclaw/chat         → OpenClaw /api/chat
 * - POST /api/openclaw/chat/stream  → OpenClaw /v1/chat/completions (SSE)
 * - GET  /api/openclaw/status       → OpenClaw /status
 * - POST /api/openclaw/action       → OpenClaw /api/action
 * 
 * @version 1.0.0
 * @author AI Homelab Team
 * @date February 2026
 */

const fetch = require('node-fetch');
const fs = require('fs');
const { execSync } = require('child_process');

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/home/eleazar/.openclaw/openclaw.json';

class OpenClawProxyHandler {
  constructor(options = {}) {
    this.openclawUrl = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
    this.timeout = options.timeout || 30000; // 30 second timeout
    this.tracingService = options.tracingService;
    
    console.log(`[OpenClaw Proxy] Initialized - proxying to ${this.openclawUrl}`);
  }

  /**
   * Get Express router for OpenClaw proxy endpoints
   */
  getRouter() {
    const express = require('express');
    const router = express.Router();

    // Chat endpoint (non-streaming)
    router.post('/chat', this.handleChat.bind(this));

    // Chat streaming endpoint (SSE)
    router.post('/chat/stream', this.handleChatStream.bind(this));

    // Status endpoint
    router.get('/status', this.handleStatus.bind(this));

    // Action endpoint (for skill execution)
    router.post('/action', this.handleAction.bind(this));

    // Health check
    router.get('/health', this.handleHealth.bind(this));

    // Model management
    router.get('/models', this.handleListModels.bind(this));
    router.put('/model', this.handleSwitchModel.bind(this));

    // Agent management
    router.get('/agents', this.handleListAgents.bind(this));
    router.get('/agents/:agentId/identity', this.handleAgentIdentity.bind(this));

    return router;
  }

  /**
   * Handle non-streaming chat request
   * POST /api/openclaw/chat
   */
  async handleChat(req, res) {
    const startTime = Date.now();
    const traceId = req.traceId || `oc-${Date.now()}`;

    try {
      // Extract user context from authenticated request
      const userId = req.headers['x-user-id'] || req.component || 'anonymous';
      const sessionId = req.headers['x-session-id'] || req.body.sessionId;
      const safetyLevel = req.headers['x-safety-level'] || 'standard';

      console.log(`[OpenClaw Proxy] Chat request: user=${userId}, session=${sessionId}`);

      // Forward to OpenClaw Gateway
      const response = await fetch(`${this.openclawUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (process.env.OPENCLAW_AUTH_TOKEN || 'a0d9bfb3e78ad6c148873de68b419a26a05be587a6c2d8a8'),
          'X-User-ID': userId,
          'X-Session-ID': sessionId || '',
          'X-Safety-Level': safetyLevel,
          'X-Trace-ID': traceId,
          'X-Forwarded-By': 'ai-gateway',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: req.body.message || '' }],
          stream: true,
          user: req.body.userId || userId,
          metadata: {
            voice_mode: req.body.voiceMode || false,
            session_id: sessionId
          }
        }),
        timeout: this.timeout,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenClaw Proxy] Chat error: ${response.status} - ${errorText}`);
        return res.status(response.status).json({
          error: 'OpenClaw request failed',
          status: response.status,
          message: errorText,
        });
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      console.log(`[OpenClaw Proxy] ✅ Chat completed in ${duration}ms`);

      // Add gateway metadata
      data._gateway = {
        traceId,
        proxyLatencyMs: duration,
        timestamp: new Date().toISOString(),
      };

      res.json(data);

    } catch (error) {
      console.error(`[OpenClaw Proxy] ❌ Chat error:`, error.message);
      res.status(502).json({
        error: 'OpenClaw Gateway unreachable',
        message: error.message,
        traceId,
      });
    }
  }

  /**
   * Handle streaming chat request (SSE passthrough)
   * POST /api/openclaw/chat/stream
   */
  async handleChatStream(req, res) {
    const traceId = req.traceId || `oc-stream-${Date.now()}`;

    try {
      // Extract user context
      const userId = req.headers['x-user-id'] || req.component || 'anonymous';
      const sessionId = req.headers['x-session-id'] || req.body.sessionId;
      const safetyLevel = req.headers['x-safety-level'] || 'standard';

      console.log(`[OpenClaw Proxy] Stream request: user=${userId}, session=${sessionId}`);

      // Set up SSE headers immediately
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Trace-ID', traceId);
      res.flushHeaders();

      // Route directly to AI Gateway's chat completions (OpenClaw HTTP endpoint is broken)
      // This maintains the security perimeter while providing working LLM access
      const internalGatewayUrl = 'http://127.0.0.1:8777';
      const response = await fetch(`${internalGatewayUrl}/api/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.AI_GATEWAY_API_KEY || 'ai-gateway-api-key-2024',
          'Accept': 'text/event-stream',
          'X-User-ID': userId,
          'X-Session-ID': sessionId || '',
          'X-Safety-Level': safetyLevel,
          'X-Trace-ID': traceId,
          'X-Forwarded-By': 'openclaw-proxy',
        },
        body: JSON.stringify(
          // Support both simple message format and full ChatCompletionRequest format
          req.body.messages ? {
            model: req.body.model || 'qwen3-32b',
            messages: req.body.messages,
            stream: true,
            user: req.body.userId || userId
          } : {
            model: 'qwen3-32b',
            messages: [{ role: 'user', content: req.body.message || '' }],
            stream: true,
            user: req.body.userId || userId
          }
        ),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenClaw Proxy] Stream error: ${response.status}`);
        res.write(`event: error\ndata: ${JSON.stringify({ error: errorText, status: response.status })}\n\n`);
        res.end();
        return;
      }

      // Pipe the SSE stream directly to client
      response.body.on('data', (chunk) => {
        res.write(chunk);
      });

      response.body.on('end', () => {
        console.log(`[OpenClaw Proxy] ✅ Stream completed`);
        res.end();
      });

      response.body.on('error', (error) => {
        console.error(`[OpenClaw Proxy] Stream pipe error:`, error.message);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });

      // Handle client disconnect
      req.on('close', () => {
        console.log(`[OpenClaw Proxy] Client disconnected`);
        response.body.destroy();
      });

    } catch (error) {
      console.error(`[OpenClaw Proxy] ❌ Stream error:`, error.message);
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message, fatal: true })}\n\n`);
      res.end();
    }
  }

  /**
   * Handle status request
   * GET /api/openclaw/status
   */
  async handleStatus(req, res) {
    try {
      const response = await fetch(`${this.openclawUrl}/status`, {
        method: 'GET',
        timeout: 5000,
      });

      if (!response.ok) {
        return res.status(response.status).json({
          running: false,
          error: `Status check failed: ${response.status}`,
        });
      }

      const data = await response.json();
      res.json(data);

    } catch (error) {
      res.json({
        running: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Handle action request (skill execution)
   * POST /api/openclaw/action
   */
  async handleAction(req, res) {
    const traceId = req.traceId || `oc-action-${Date.now()}`;

    try {
      const userId = req.headers['x-user-id'] || req.component || 'anonymous';

      console.log(`[OpenClaw Proxy] Action request: ${req.body.action_type}, user=${userId}`);

      const response = await fetch(`${this.openclawUrl}/api/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (process.env.OPENCLAW_AUTH_TOKEN || 'a0d9bfb3e78ad6c148873de68b419a26a05be587a6c2d8a8'),
          'X-User-ID': userId,
          'X-Trace-ID': traceId,
          'X-Forwarded-By': 'ai-gateway',
        },
        body: JSON.stringify(req.body),
        timeout: this.timeout,
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json(data);

    } catch (error) {
      console.error(`[OpenClaw Proxy] ❌ Action error:`, error.message);
      res.status(502).json({
        success: false,
        error: 'OpenClaw Gateway unreachable',
        message: error.message,
        traceId,
      });
    }
  }

  /**
   * Health check endpoint
   * GET /api/openclaw/health
   */
  async handleHealth(req, res) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.openclawUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      res.json({
        status: response.ok ? 'healthy' : 'unhealthy',
        openclaw: {
          url: this.openclawUrl,
          reachable: response.ok,
          statusCode: response.status,
        },
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        openclaw: {
          url: this.openclawUrl,
          reachable: false,
          error: error.message,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * List available models and current selection
   * GET /api/openclaw/models
   */
  async handleListModels(req, res) {
    try {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
      const currentModel = config.agents?.defaults?.model?.primary || 'openai/auto';
      const mainAgent = (config.agents?.list || []).find(a => a.id === 'main');
      const mainModel = mainAgent?.model || currentModel;

      const registeredModels = [];
      for (const [provider, providerConfig] of Object.entries(config.models?.providers || {})) {
        for (const model of (providerConfig.models || [])) {
          registeredModels.push({
            id: provider === 'openai' ? `openai/${model.id}` : `${provider}/${model.id}`,
            name: model.name,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            provider,
            isCurrent: `openai/${model.id}` === mainModel || `${provider}/${model.id}` === mainModel,
          });
        }
      }

      res.json({
        current: mainModel,
        models: registeredModels,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[OpenClaw Proxy] ❌ List models error:', error.message);
      res.status(500).json({ error: 'Failed to read OpenClaw config', message: error.message });
    }
  }

  /**
   * Switch the active model for the main agent
   * PUT /api/openclaw/model
   * Body: { "model": "openai/claude-haiku-4-5" }
   */
  async handleSwitchModel(req, res) {
    const { model } = req.body || {};
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "model" field' });
    }

    try {
      const path = require('path');
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));

      // Validate model exists in registered providers
      const allModelIds = [];
      for (const [provider, providerConfig] of Object.entries(config.models?.providers || {})) {
        for (const m of (providerConfig.models || [])) {
          allModelIds.push(`openai/${m.id}`);
          allModelIds.push(`${provider}/${m.id}`);
        }
      }

      if (!allModelIds.includes(model)) {
        return res.status(400).json({
          error: `Model "${model}" not registered`,
          available: [...new Set(allModelIds)],
        });
      }

      const previousModel = config.agents?.defaults?.model?.primary || 'unknown';

      // --- Layer 1: OpenClaw config (openclaw.json) ---
      // Keep openai/auto so the gateway's tiered routing stays in control
      // Only set per-agent model if explicitly not using auto-routing
      if (!config.agents) config.agents = {};
      if (!config.agents.defaults) config.agents.defaults = {};
      if (!config.agents.defaults.model) config.agents.defaults.model = {};
      config.agents.defaults.model.primary = 'openai/auto';

      // Remove per-agent model override so it inherits the auto default
      const mainAgent = (config.agents.list || []).find(a => a.id === 'main');
      if (mainAgent) {
        delete mainAgent.model;
      }

      fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2));

      // --- Layer 2: AI Gateway routing rules (routing-rules.json) ---
      const profilesDir = path.join(__dirname, '..', '..', 'config', 'profiles');
      const routingRulesPath = path.join(__dirname, '..', '..', 'config', 'routing-rules.json');
      const modelShortName = model.replace('openai/', '').replace('anthropic/', '');

      // Map model to routing profile
      const PROFILE_MAP = {
        'claude-haiku-4-5': 'haiku-default',
        'qwen3-32b': 'qwen3-default',
      };
      const profileName = PROFILE_MAP[modelShortName];
      let routingSwapped = false;

      if (profileName) {
        const profilePath = path.join(profilesDir, `${profileName}.routing-rules.json`);
        if (fs.existsSync(profilePath)) {
          fs.copyFileSync(profilePath, routingRulesPath);
          routingSwapped = true;
          console.log(`[OpenClaw Proxy] Routing rules swapped to profile: ${profileName}`);
        }
      }

      console.log(`[OpenClaw Proxy] Model switched: ${previousModel} → ${model} (routing: ${routingSwapped ? 'swapped' : 'unchanged'})`);

      // --- Restart services ---
      const restartResults = {};

      // Restart OpenClaw container
      try {
        execSync('docker restart openclaw', { timeout: 30000 });
        restartResults.openclaw = 'ok';
      } catch (err) {
        restartResults.openclaw = err.message;
      }

      // Restart AI Gateway to load new routing rules
      try {
        execSync('sudo systemctl restart ai-gateway', { timeout: 30000 });
        restartResults.aiGateway = 'ok';
      } catch (err) {
        restartResults.aiGateway = err.message;
      }

      const allOk = restartResults.openclaw === 'ok' && restartResults.aiGateway === 'ok';
      console.log(`[OpenClaw Proxy] ${allOk ? '✅' : '⚠️'} Restarts: openclaw=${restartResults.openclaw}, ai-gateway=${restartResults.aiGateway}`);

      res.json({
        success: true,
        previous: previousModel,
        current: model,
        routingProfile: profileName || 'unchanged',
        restarts: restartResults,
        message: `Switched to ${model}${routingSwapped ? ` with ${profileName} routing profile` : ''}`,
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      console.error('[OpenClaw Proxy] ❌ Switch model error:', error.message);
      res.status(500).json({ error: 'Failed to switch model', message: error.message });
    }
  }

  /**
   * List configured agents from OpenClaw config
   * GET /api/openclaw/agents
   */
  async handleListAgents(req, res) {
    try {
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
      const agentList = config.agents?.list || [];
      const defaultId = agentList.length > 0 ? (agentList.find(a => a.id === 'main')?.id || agentList[0].id) : null;

      const agents = agentList.map(a => ({
        id: a.id,
        name: a.name || a.id,
        model: a.model || config.agents?.defaults?.model?.primary || 'openai/auto',
        skills: Array.isArray(a.skills) ? a.skills.length : 0,
        hasHeartbeat: Boolean(a.heartbeat),
        hasMemorySearch: Boolean(a.memorySearch?.enabled),
      }));

      res.json({
        ok: true,
        result: {
          agents: agents.map(a => ({ id: a.id })),
          defaultId,
          enriched: agents,
        },
      });
    } catch (error) {
      console.error('[OpenClaw Proxy] \u274C List agents error:', error.message);
      res.status(500).json({ ok: false, error: 'Failed to read agent config', message: error.message });
    }
  }

  /**
   * Get agent identity info
   * GET /api/openclaw/agents/:agentId/identity
   */
  async handleAgentIdentity(req, res) {
    try {
      const { agentId } = req.params;
      const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8'));
      const agent = (config.agents?.list || []).find(a => a.id === agentId);

      if (!agent) {
        return res.status(404).json({ ok: false, error: `Agent "${agentId}" not found` });
      }

      // Try to read SOUL.md from agent directory for richer identity
      let soulSnippet = null;
      try {
        const agentDir = agent.agentDir || `/home/eleazar/.openclaw/agents/${agentId}/agent`;
        const soulPath = `${agentDir}/SOUL.md`;
        if (fs.existsSync(soulPath)) {
          const soul = fs.readFileSync(soulPath, 'utf8');
          // Extract first 200 chars as a description snippet
          soulSnippet = soul.slice(0, 200).trim();
        }
      } catch { /* ignore */ }

      res.json({
        ok: true,
        result: {
          agentId: agent.id,
          name: agent.name || agent.id,
          model: agent.model || config.agents?.defaults?.model?.primary || 'openai/auto',
          skills: agent.skills || [],
          soulSnippet,
        },
      });
    } catch (error) {
      console.error('[OpenClaw Proxy] \u274C Agent identity error:', error.message);
      res.status(500).json({ ok: false, error: 'Failed to read agent identity', message: error.message });
    }
  }
}

module.exports = OpenClawProxyHandler;
