/**
 * Chat Completions Handler with OpenAI SSE Streaming Support
 * Properly implements streaming responses for compatibility with clients like Goose ACP
 */

const SSEStreamingHandler = require('../middleware/sse-streaming');

class ChatCompletionsHandler {
  constructor(providerManager, tracingService, costService, inferencingClient) {
    this.providerManager = providerManager;
    this.tracingService = tracingService;
    this.costService = costService;
    this.inferencingClient = inferencingClient;
    
    // Daily budget cap for paid providers (Anthropic, etc.)
    // Override with X-Budget-Override: <admin-key> header
    this.budgetTracker = {
      dailyLimitUSD: parseFloat(process.env.DAILY_BUDGET_LIMIT_USD || '10.00'),
      currentDaySpend: 0,
      currentDay: new Date().toISOString().split('T')[0],
      requestCount: 0,
      overrideKey: process.env.BUDGET_OVERRIDE_KEY || 'ai-gateway-admin-key-2024'
    };
    console.log(`[Budget Guard] Daily limit: $${this.budgetTracker.dailyLimitUSD}`);
  }
  
  /**
   * Check budget and estimate cost before making a paid API call
   */
  checkBudget(req, model) {
    const bt = this.budgetTracker;
    const today = new Date().toISOString().split('T')[0];
    
    // Reset daily tracker at midnight
    if (today !== bt.currentDay) {
      console.log(`[Budget Guard] New day - resetting. Yesterday: $${bt.currentDaySpend.toFixed(4)} across ${bt.requestCount} requests`);
      bt.currentDaySpend = 0;
      bt.requestCount = 0;
      bt.currentDay = today;
    }
    
    // Skip budget check for free/local models
    const isLocalModel = model && (model.includes('qwen') || model.includes('local') || model.includes('minimax'));
    const isGemini = model && model.includes('gemini');
    if (isLocalModel) return { allowed: true, reason: 'local_model' };
    
    // Check for manual override header
    const overrideHeader = req.headers['x-budget-override'];
    if (overrideHeader === bt.overrideKey) {
      return { allowed: true, reason: 'manual_override' };
    }
    
    // Estimate cost for this request
    const inputTokens = this.estimateInputTokens(req.body);
    const isHaiku = model && model.includes('haiku');
    const isSonnet = model && (model.includes('sonnet') || model.includes('claude-4'));
    
    let estimatedCost = 0;
    if (isHaiku) {
      estimatedCost = (inputTokens / 1_000_000) * 0.80 + 0.002; // ~$0.80/MTok input + output estimate
    } else if (isSonnet) {
      estimatedCost = (inputTokens / 1_000_000) * 3.0 + 0.01;  // ~$3/MTok input + output estimate
    } else if (isGemini) {
      estimatedCost = 0.001; // Gemini is very cheap
    } else {
      estimatedCost = (inputTokens / 1_000_000) * 3.0 + 0.01;  // Default to Sonnet pricing
    }
    
    if (bt.currentDaySpend + estimatedCost > bt.dailyLimitUSD) {
      console.warn(`[Budget Guard] ⛔ BLOCKED: $${bt.currentDaySpend.toFixed(4)} + ~$${estimatedCost.toFixed(4)} exceeds daily limit of $${bt.dailyLimitUSD}`);
      return { 
        allowed: false, 
        reason: 'daily_limit_exceeded',
        currentSpend: bt.currentDaySpend,
        estimatedCost,
        limit: bt.dailyLimitUSD
      };
    }
    
    return { allowed: true, estimatedCost, reason: 'within_budget' };
  }
  
  /**
   * Record actual spend after a request completes
   */
  recordSpend(cost) {
    this.budgetTracker.currentDaySpend += cost;
    this.budgetTracker.requestCount++;
  }
  
  /**
   * Prompt token budget audit (observe-only, no mutations)
   * 
   * The gateway does NOT modify prompt content — that is OpenClaw's domain.
   * OpenClaw assembles the system prompt from SOUL.md, AGENTS.md, USER.md,
   * MEMORY.md, etc. which are kept in sync with PIC by openclaw_memory_sync.py.
   * 
   * The gateway's role is LIMITED to:
   *   1. Logging prompt size per tier for cost visibility
   *   2. Warning when prompts exceed tier-appropriate budgets
   *   3. Providing metrics for optimization decisions
   * 
   * Token budgets per tier (warning thresholds, NOT enforcement):
   *   T1 Sonnet  ($3/MTok)    → warn > 4000 tokens (system prompt overhead)
   *   T2 Haiku   ($0.80/MTok) → warn > 6000 tokens
   *   T3 Qwen    (FREE)       → no budget concern
   *   T4 Gemini  ($0.075/MTok)→ no budget concern (1M context)
   */
  auditPromptTokenBudget(body, model) {
    if (!body.messages || !Array.isArray(body.messages)) return;
    
    // Count system prompt tokens
    let systemTokens = 0;
    let systemMessageCount = 0;
    for (const msg of body.messages) {
      if (msg.role === 'system' && typeof msg.content === 'string') {
        systemTokens += Math.ceil(msg.content.length / 4);
        systemMessageCount++;
      }
    }
    
    // Count tool schema tokens
    let toolTokens = 0;
    if (body.tools && Array.isArray(body.tools)) {
      toolTokens = Math.ceil(JSON.stringify(body.tools).length / 4);
    }
    
    const totalOverhead = systemTokens + toolTokens;
    
    // Determine tier and warn threshold
    const isSonnet = model && model.includes('sonnet');
    const isHaiku = model && model.includes('haiku');
    const isQwen = model && (model.includes('qwen') || model.includes('local') || model.includes('minimax'));
    const isGemini = model && model.includes('gemini');
    
    let tier = 'unknown';
    let warnThreshold = Infinity;
    let costPerMTok = 0;
    
    if (isSonnet) { tier = 'T1-Sonnet'; warnThreshold = 4000; costPerMTok = 3.0; }
    else if (isHaiku) { tier = 'T2-Haiku'; warnThreshold = 6000; costPerMTok = 0.8; }
    else if (isQwen) { tier = 'T3-Qwen'; costPerMTok = 0; }
    else if (isGemini) { tier = 'T4-Gemini'; costPerMTok = 0.075; }
    
    const overheadCost = (totalOverhead / 1_000_000) * costPerMTok;
    
    if (totalOverhead > warnThreshold) {
      console.warn(`[Prompt Audit] ⚠️ ${tier}: ${totalOverhead} overhead tokens (${systemMessageCount} system msgs + ${body.tools?.length || 0} tools) exceeds ${warnThreshold} threshold (~$${overheadCost.toFixed(4)}/req)`);
    } else if (costPerMTok > 0) {
      console.log(`[Prompt Audit] ${tier}: ${totalOverhead} overhead tokens (~$${overheadCost.toFixed(4)}/req)`);
    }
  }
  
  /**
   * Rough input token estimate from request body
   */
  estimateInputTokens(body) {
    let chars = 0;
    if (body.messages) {
      for (const msg of body.messages) {
        if (typeof msg.content === 'string') chars += msg.content.length;
        else if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.text) chars += item.text.length;
          }
        }
      }
    }
    if (body.tools) chars += JSON.stringify(body.tools).length;
    return Math.ceil(chars / 4); // ~4 chars per token
  }

  async ensurePerplexityProviderForSonar(model) {
    const normalizedModel = typeof model === 'string' ? model.toLowerCase() : '';
    if (!normalizedModel.startsWith('sonar')) {
      return;
    }

    const activeProviders = this.providerManager.getActiveProviders();
    if (activeProviders.includes('perplexity-default')) {
      return;
    }

    if (!this.inferencingClient) {
      console.warn('[Chat Completions] sonar requested but AI Inferencing client unavailable for Perplexity resync');
      return;
    }

    try {
      const apiKey = await this.inferencingClient.getKey('ai-gateway', 'perplexity');
      if (!apiKey) {
        console.warn('[Chat Completions] sonar requested but no Perplexity key returned by AI Inferencing');
        return;
      }

      await this.providerManager.loadProvider({
        id: 'perplexity-default',
        type: 'perplexity',
        apiKey,
        enabled: true
      });

      console.log('[Chat Completions] Re-synced Perplexity provider from AI Inferencing for sonar request');
    } catch (error) {
      console.warn('[Chat Completions] Failed to re-sync Perplexity provider for sonar request:', error.message);
    }
  }
  
  /**
   * Handle chat completion request with streaming support
   */
  async handle(req, res) {
    // Start request tracing
    const { traceId, spanId } = this.tracingService.startTrace(req.body, {
      clientId: req.headers['x-client-id'] || 'unknown',
      clientIp: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      routingStrategy: req.headers['x-routing-strategy'] || 'hybrid',
      streaming: req.body.stream === true
    });
    
    const requestStartTime = Date.now();
    
    try {
      // Extract service context
      const serviceId = req.headers['x-service-id'] || req.body._context?.serviceId || 'default-service';
      const projectId = req.headers['x-project-id'] || req.body._context?.projectId || null;
      let model = req.body.model;
      
      // Model aliasing for compatibility
      model = this.applyModelAliasing(model);
      req.body.model = model;

      await this.ensurePerplexityProviderForSonar(model);
      
      // TRAVEL-AWARE REGIONALIZATION: Extract timezone from headers
      // Priority: 1. X-User-Timezone header, 2. _context.timezone, 3. Default (America/Chicago)
      const userTimezone = req.headers['x-user-timezone'] || req.body._context?.timezone || 'America/Chicago';
      const userLocation = req.headers['x-user-location'] || req.body._context?.location || null;
      
      // Inject timezone into _context for downstream services
      if (!req.body._context) req.body._context = {};
      req.body._context.timezone = userTimezone;
      if (userLocation) req.body._context.location = userLocation;
      
      // iOS FAST/DEEP MODE: Extract from header or _context
      // fast = homelab-only (emails, research studio, workspace AI, calendar)
      // deep = external sources (web search, Perplexity, document analysis)
      const mode = req.headers['x-mode'] || req.body._context?.mode || null;
      if (mode) req.body._context.mode = mode;
      
      // USER-CONTROLLED COST/QUALITY KNOBS (from iOS settings)
      // cache_strategy: "aggressive" (max caching, lower cost) | "balanced" | "none" (no caching, max freshness)
      // prompt_mode: "full" (all context) | "minimal" (core identity + query only) | "auto" (tier-appropriate)
      const cacheStrategy = req.headers['x-cache-strategy'] || req.body._context?.cache_strategy || 'balanced';
      const promptMode = req.headers['x-prompt-mode'] || req.body._context?.prompt_mode || 'auto';
      req.body._context.cache_strategy = cacheStrategy;
      req.body._context.prompt_mode = promptMode;
      
      // Log timezone if different from default (indicates travel)
      if (userTimezone !== 'America/Chicago') {
        console.log(`[Chat Completions] TRAVEL MODE: Using timezone ${userTimezone} (from header)`);
      }
      
      console.log(`[Chat Completions] Request from ${serviceId}, model: ${model}, mode: ${mode || 'auto'}, cache: ${cacheStrategy}, streaming: ${req.body.stream} [Trace: ${traceId}]`);
      
      // Auto-force tool usage when tools are present (fix for Goose ACP not setting tool_choice)
      if (req.body.tools && req.body.tools.length > 0 && !req.body.tool_choice) {
        req.body.tool_choice = 'auto';
        console.log(`[Chat Completions] Auto-setting tool_choice='auto' for ${req.body.tools.length} tools`);
      }
      
      // Strip tool_choice when tools is not provided (fix for OpenClaw sending tool_choice without tools)
      if (req.body.tool_choice && (!req.body.tools || req.body.tools.length === 0)) {
        console.log(`[Chat Completions] Stripping tool_choice='${req.body.tool_choice}' (no tools provided)`);
        delete req.body.tool_choice;
      }
      
      // Qwen3 instruct optimization: apply recommended sampling parameters
      // Per Qwen3 best practices: temp=0.7, top_p=0.8, presence_penalty=1.05
      // Avoids greedy decoding (temp=0) which causes repetition loops
      if (req.body.model && (req.body.model.includes('qwen') || req.body.model === 'auto')) {
        if (!req.body.temperature || req.body.temperature === 0) {
          req.body.temperature = 0.7;
        }
        if (!req.body.top_p) {
          req.body.top_p = 0.8;
        }
        if (!req.body.presence_penalty) {
          req.body.presence_penalty = 1.05;
        }
        // Enforce min max_tokens=1024 so Qwen3 can complete responses
        // iOS sends 250 which starves the model (especially with thinking)
        const minTokens = 1024;
        if (req.body.max_tokens && req.body.max_tokens < minTokens) {
          console.log(`[Chat Completions] Qwen3: Raising max_tokens ${req.body.max_tokens} → ${minTokens}`);
          req.body.max_tokens = minTokens;
        }
      }

      // Strip tools for local Qwen model (vLLM has issues with complex tool schemas)
      // TODO: Implement proper tool schema validation/transformation for vLLM
      if (req.body.model && (req.body.model.includes('qwen') || req.body.model === 'openai/qwen3-32b')) {
        if (req.body.tools && req.body.tools.length > 0) {
          const originalToolCount = req.body.tools.length;
          req.body.tools = req.body.tools.filter((t) => {
            return t && t.type === 'function' && t.function && typeof t.function.name === 'string' && t.function.name.length > 0;
          });
          if (req.body.tools.length !== originalToolCount) {
            console.log(`[Chat Completions] Filtered tools for Qwen model: ${originalToolCount} → ${req.body.tools.length}`);
          }
          if (req.body.tools.length === 0) {
            console.log(`[Chat Completions] Stripping tool_choice/tools for Qwen model (no valid tools after filtering)`);
            delete req.body.tools;
            delete req.body.tool_choice;
          }
        }
      }
      
      // VOICE MODE: Enforce max_tokens limit and disable thinking for edge/voice requests
      // Edge requests (task_stream: "edge") are voice interactions that need concise, direct answers
      const taskStream = req.body._context?.task_stream || req.body._context?.taskStream;
      const operationType = req.body._context?.operation_type || req.body._context?.operationType;
      const isVoiceRequest = taskStream === 'edge' || operationType === 'voice_chat' || operationType === 'voice';
      
      if (isVoiceRequest) {
        // Detect OpenClaw agent requests: tools are added DOWNSTREAM by the embedded agent,
        // so they arrive here without tools. Never classify these as "simple".
        const isOpenClawAgent = req.body.stream_options?.format === 'openclaw.v1'
          || (req.body.stream_options?.channels && Array.isArray(req.body.stream_options.channels));
        const hasTools = req.body.tools && req.body.tools.length > 0;
        const complexity = req.body._context?.complexity;
        // OpenClaw agent always gets "complex" treatment (it has tools downstream)
        const isSimpleQuery = !isOpenClawAgent && !hasTools && complexity !== 'high';
        
        if (isSimpleQuery) {
          const VOICE_MAX_TOKENS = 250; // Strict limit for simple voice responses
          const currentMaxTokens = req.body.max_tokens || 4096;
          if (currentMaxTokens > VOICE_MAX_TOKENS) {
            console.log(`[Chat Completions] VOICE MODE (simple): Limiting max_tokens to ${VOICE_MAX_TOKENS}`);
            req.body.max_tokens = VOICE_MAX_TOKENS;
          }
          
          // Disable Qwen3 thinking mode for simple voice queries
          if (req.body.model && req.body.model.includes('qwen') && Array.isArray(req.body.messages)) {
            const lastUserMsgIdx = req.body.messages.map(m => m.role).lastIndexOf('user');
            if (lastUserMsgIdx >= 0) {
              const lastUserMsg = req.body.messages[lastUserMsgIdx];
              if (typeof lastUserMsg.content === 'string' && !lastUserMsg.content.includes('/no_think')) {
                req.body.messages[lastUserMsgIdx].content = lastUserMsg.content + ' /no_think';
                console.log(`[Chat Completions] VOICE MODE: Injected /no_think for simple query`);
              }
            }
            
            const voiceInstruction = {
              role: 'system',
              content: 'CRITICAL: This is a VOICE response. Answer in 1-3 sentences MAX. Give the direct answer first, no preamble, no lists, no step-by-step instructions. Be conversational like talking to a friend.'
            };
            req.body.messages.splice(lastUserMsgIdx, 0, voiceInstruction);
            console.log(`[Chat Completions] VOICE MODE: Injected conciseness instruction`);
          }
        } else {
          // OpenClaw agent or complex voice query: allow thinking, generous token budget
          // Multi-step tool reasoning (search → refine → synthesize) needs headroom
          const VOICE_COMPLEX_MAX_TOKENS = 2048;
          const currentMaxTokens = req.body.max_tokens || 4096;
          if (currentMaxTokens > VOICE_COMPLEX_MAX_TOKENS) {
            console.log(`[Chat Completions] VOICE MODE (complex/agent): Limiting max_tokens to ${VOICE_COMPLEX_MAX_TOKENS}`);
            req.body.max_tokens = VOICE_COMPLEX_MAX_TOKENS;
          }
          if (isOpenClawAgent) {
            console.log(`[Chat Completions] VOICE MODE: OpenClaw agent detected — thinking enabled, max_tokens=${req.body.max_tokens}`);
          }
        }
      }
      
      if (Array.isArray(req.body.tools)) {
        const normalizeSchema = (tool) => {
          if (!tool || typeof tool !== 'object') return undefined;
          if (tool.input_schema && typeof tool.input_schema === 'object') return tool.input_schema;
          if (tool.inputSchema && typeof tool.inputSchema === 'object') return tool.inputSchema;
          if (tool.parameters && typeof tool.parameters === 'object') return tool.parameters;
          if (tool.schema && typeof tool.schema === 'object') return tool.schema;
          if (tool.args && typeof tool.args === 'object') return tool.args;
          return undefined;
        };
        req.body.tools = req.body.tools.map((tool) => {
          if (!tool || typeof tool !== 'object') return tool;
          if (tool.type === 'function' && tool.function && tool.function.name) return tool;
          if (tool.type && !tool.function && tool.name && (tool.input_schema || tool.inputSchema)) return tool;
          if (tool.name) {
            const parameters = normalizeSchema(tool);
            if (parameters) {
              return {
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description || '',
                  parameters
                }
              };
            }
          }
          if (tool.function && tool.function.name && !tool.function.parameters) {
            const parameters = normalizeSchema(tool) || normalizeSchema(tool.function) || { type: 'object', properties: {} };
            return {
              type: 'function',
              function: {
                name: tool.function.name,
                description: tool.function.description || tool.description || '',
                parameters
              }
            };
          }
          return tool;
        });
      }

      // AUTO-ROUTING: Resolve "auto" model to concrete model via routing rules
      // This enables OpenClaw to delegate model selection to the gateway based on mode/complexity
      if (model === 'auto') {
        const resolvedModel = this.resolveAutoModel(req);
        console.log(`[Auto-Routing] Resolved model: auto → ${resolvedModel}`);
        model = resolvedModel;
        req.body.model = resolvedModel;
      }
      
      // Fetch API key if using AI Inferencing Service
      await this.fetchProviderKey(req, serviceId, model);
      
      // PROMPT AUDIT: Log token overhead per tier (observe-only, no mutations)
      this.auditPromptTokenBudget(req.body, model);
      
      // BUDGET GUARD: Check daily spending limit before dispatching to paid providers
      const budgetCheck = this.checkBudget(req, model);
      if (!budgetCheck.allowed) {
        console.warn(`[Budget Guard] Request blocked: ${budgetCheck.reason} (spent: $${budgetCheck.currentSpend?.toFixed(4)}, limit: $${budgetCheck.limit})`);
        return res.status(429).json({
          error: {
            message: `Daily budget limit of $${budgetCheck.limit} exceeded. Current spend: $${budgetCheck.currentSpend?.toFixed(2)}. Use X-Budget-Override header to bypass.`,
            type: 'budget_exceeded',
            code: 'DAILY_BUDGET_EXCEEDED'
          }
        });
      }
      if (budgetCheck.estimatedCost) {
        this.recordSpend(budgetCheck.estimatedCost);
      }
      
      const _SONAR_MODELS = ['sonar-pro', 'sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'sonar-deep-research'];
      const requestOptions = {
        strategy: req.headers['x-routing-strategy'] || 'hybrid',
        enableFallback: false,
        skipAliasing: req.headers['x-use-native-model'] === 'true' ||  req.headers['x-skip-aliasing'] === 'true',
        stream: req.body.stream === true,
        // Inject high-priority routing rule for Perplexity/sonar models.
        // DB-loaded routing rules don't include a Perplexity entry, so we inject
        // one here at priority 1 to ensure sonar models always route to perplexity-default.
        ...(_SONAR_MODELS.includes(model) ? {
          routingRules: [{
            id: 'perplexity_sonar_override',
            name: 'Perplexity Sonar → perplexity-default',
            priority: 1,
            condition: { field: 'model', in: _SONAR_MODELS },
            targetProvider: 'perplexity-default',
            targetModel: null,
            fallbackProviders: ['google-default'],
            enabled: true
          }]
        } : {})
      };
      
      // Check if request wants streaming
      if (req.body.stream === true) {
        console.log(`[Chat Completions] Using SSE streaming mode [Trace: ${traceId}]`);
        await this.handleStreamingResponse(req, res, requestOptions, traceId, requestStartTime);
      } else {
        console.log(`[Chat Completions] Using non-streaming mode [Trace: ${traceId}]`);
        await this.handleNonStreamingResponse(req, res, requestOptions, traceId, requestStartTime);
      }
      
    } catch (error) {
      console.error('[Chat Completions] Request failed:', error?.message || error);
      await this.handleError(req, res, error, traceId);
    }
  }
  
  /**
   * Handle streaming response with SSE
   */
  async handleStreamingResponse(req, res, requestOptions, traceId, requestStartTime) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const timestamp = Math.floor(Date.now() / 1000);
    let chunkCount = 0;
    let fullText = '';
    let provider = 'unknown';
    let usage = null;
    
    try {
      // Get provider connectivity
      const connectivityStatus = await this.providerManager.getProviderConnectivityStatus();
      
      // Route request and get streaming response
      const routingStartTime = Date.now();
      
      // For streaming, the provider manager doesn't support callbacks yet
      // So we get the full response and convert it to SSE
      const response = await this.providerManager.routeRequest(req.body, requestOptions);
      const routingDuration = Date.now() - routingStartTime;
      
      // Extract model/provider info for frontend visibility
      const actualModel = response?.model || req.body.model || 'unknown';
      const actualProvider = response?.routing?.provider || response?.provider || 'unknown';
      
      // Set response headers with model metadata (for clients that read headers)
      res.setHeader('X-AI-Model', actualModel);
      res.setHeader('X-AI-Provider', actualProvider);
      res.setHeader('X-AI-Gateway-Version', '2.5.0');
      
      // Send metadata SSE event FIRST (before content chunks)
      // Only send if client requests it via header (to avoid breaking OpenClaw/other clients)
      const includeMetadata = req.headers['x-include-metadata'] === 'true';
      if (includeMetadata) {
        const metadataEvent = {
          event: 'metadata',
          model: actualModel,
          provider: actualProvider,
          routing: response?.routing || {},
          trace_id: traceId,
          timestamp: new Date().toISOString()
        };
        res.write(`event: metadata\ndata: ${JSON.stringify(metadataEvent)}\n\n`);
        console.log(`[Chat Completions] Sent metadata event: model=${actualModel}, provider=${actualProvider}`);
      }
      
      // Update trace
      if (response && response.routing) {
        this.tracingService.updateRouting(traceId, {
          provider: response.routing.provider,
          strategy: requestOptions.strategy,
          routingTime: routingDuration,
        });
      }
      
      // Qwen3 XML tool-call recovery: vLLM's qwen3_xml parser sometimes fails to
      // extract <tool_call> blocks from content, returning them as raw XML in the
      // content field with an empty tool_calls array. Parse them here so OpenClaw
      // receives proper structured tool_calls it can dispatch to its skill system.
      this.recoverQwen3ToolCalls(response);

      // Always convert to SSE for streaming requests
      console.log(`[Chat Completions] Converting response to SSE - response: ${JSON.stringify(response?.choices?.[0]?.message || response || "null").substring(0, 200)}`);
      await this.convertNonStreamingToSSE(res, response, req.body.model, traceId, timestamp);
      
      // Record metrics
      if (response && response.usage) {
        await this.recordMetrics(traceId, response.routing?.provider, req.body.model, response.usage, requestStartTime, routingStartTime);
      }
      
    } catch (error) {
      console.error('[Chat Completions] Streaming error:', error);
      const errorChunk = {
        error: {
          message: error.message || 'Internal error',
          type: 'api_error'
        }
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.end();
    }
  }
  
  /**
   * Convert non-streaming response to SSE format
   * This is a fallback when the provider doesn't support native streaming
   */
  async convertNonStreamingToSSE(res, response, model, traceId, timestamp) {
    // Extract content and tool_calls from response
    const content = this.extractContentFromResponse(response);
    const toolCalls = response?.choices?.[0]?.message?.tool_calls || null;
    
    // If there are tool calls, send them in a single chunk
    if (toolCalls && toolCalls.length > 0) {
      console.log(`[Chat Completions] SSE: Sending ${toolCalls.length} tool calls`);
      
      // First chunk with role
      const roleChunk = {
        id: `chatcmpl-${traceId}-0`,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: model,
        choices: [{
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null
        }]
      };
      res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
      
      // Tool calls chunk
      const toolCallChunk = {
        id: `chatcmpl-${traceId}-1`,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: model,
        choices: [{
          index: 0,
          delta: { tool_calls: toolCalls },
          finish_reason: null
        }]
      };
      res.write(`data: ${JSON.stringify(toolCallChunk)}\n\n`);
      
      // Final chunk
      const finalChunk = {
        id: `chatcmpl-${traceId}-final`,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'tool_calls'
        }]
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    
    // Handle text content (original logic)
    if (!content) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    
    // Split content into chunks (simulate streaming) without reformatting
    const chunkSize = 48; // Characters per chunk
    let streamedText = '';
    
    for (let i = 0; i < content.length; i += chunkSize) {
      const chunkText = content.slice(i, i + chunkSize);
      streamedText += chunkText;
      
      const chunk = {
        id: `chatcmpl-${traceId}-${Math.floor(i / chunkSize)}`,
        object: 'chat.completion.chunk',
        created: timestamp,
        model: model,
        choices: [{
          index: 0,
          delta: i === 0 ? { role: 'assistant', content: chunkText } : { content: chunkText },
          finish_reason: null
        }]
      };
      
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      
      // Small delay to simulate streaming
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    const streamHash = SSEStreamingHandler.hashText(streamedText);
    const finalHash = SSEStreamingHandler.hashText(content);
    if (streamHash !== finalHash) {
      console.warn(`[Chat Completions] Stream/final mismatch [Trace: ${traceId}] STREAM_HASH=${streamHash} FINAL_HASH=${finalHash}`);
    } else {
      console.log(`[Chat Completions] Stream/final match [Trace: ${traceId}] STREAM_HASH=${streamHash} FINAL_HASH=${finalHash}`);
    }

    // Send final chunk
    const finalChunk = {
      id: `chatcmpl-${traceId}-final`,
      object: 'chat.completion.chunk',
      created: timestamp,
      model: model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }]
    };
    
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
  
  /**
   * Handle non-streaming response (regular JSON)
   */
  async handleNonStreamingResponse(req, res, requestOptions, traceId, requestStartTime) {
    const routingStartTime = Date.now();
    const response = await this.providerManager.routeRequest(req.body, requestOptions);
    const routingDuration = Date.now() - routingStartTime;
    
    // Extract model/provider info for frontend visibility
    const actualModel = response?.model || req.body.model || 'unknown';
    const actualProvider = response?.routing?.provider || response?.provider || 'unknown';
    
    // Set response headers with model metadata
    res.setHeader('X-AI-Model', actualModel);
    res.setHeader('X-AI-Provider', actualProvider);
    res.setHeader('X-AI-Gateway-Version', '2.5.0');
    
    // Update trace
    if (response && response.routing) {
      this.tracingService.updateRouting(traceId, {
        provider: response.routing.provider,
        strategy: requestOptions.strategy,
        routingTime: routingDuration,
      });
    }
    
    // Record metrics
    if (response && response.usage) {
      await this.recordMetrics(traceId, response.routing?.provider, req.body.model, response.usage, requestStartTime, routingStartTime);
    }
    
    // Add gateway metadata
    const connectivityStatus = await this.providerManager.getProviderConnectivityStatus();
    if (response && typeof response === 'object') {
      response._gateway = {
        version: '2.5.0',
        timestamp: new Date().toISOString(),
        traceId: traceId,
        routing: response.routing || null,
        connectivity: {
          selectedProvider: response.routing?.provider,
          providerStatus: connectivityStatus[response.routing?.provider] || 'unknown',
          allProviders: connectivityStatus
        }
      };
    }
    
    // Qwen3 XML tool-call recovery (same as streaming path)
    this.recoverQwen3ToolCalls(response);

    // Clean response option: strip non-standard OpenAI fields for strict SDK compatibility
    const cleanResponse = req.headers['x-clean-response'] === 'true' || req.query.clean === 'true';
    if (cleanResponse && response && typeof response === 'object') {
      // Keep only standard OpenAI fields
      const standardFields = ['id', 'object', 'created', 'model', 'choices', 'usage', 'system_fingerprint'];
      const cleanedResponse = {};
      for (const field of standardFields) {
        if (response[field] !== undefined) {
          cleanedResponse[field] = response[field];
        }
      }
      return res.json(cleanedResponse);
    }

    res.json(response);
  }

  /**
   * Recover structured tool_calls from Qwen3's raw <tool_call> XML in content.
   * vLLM's qwen3_xml parser sometimes fails to extract tool calls, leaving them
   * as raw XML in the content field. This parses them into proper OpenAI-format
   * tool_calls so downstream consumers (OpenClaw) can execute them.
   */
  recoverQwen3ToolCalls(response) {
    if (!response || !response.choices || !Array.isArray(response.choices)) return;
    for (const choice of response.choices) {
      const msg = choice.message;
      if (!msg || typeof msg.content !== 'string') continue;
      // Only recover if tool_calls is missing or empty
      if (msg.tool_calls && msg.tool_calls.length > 0) continue;
      
      const content = msg.content;
      const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
      const parsedCalls = [];
      let match;
      while ((match = toolCallRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (parsed && typeof parsed.name === 'string') {
            parsedCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'function',
              function: {
                name: parsed.name,
                arguments: JSON.stringify(parsed.arguments || {})
              }
            });
          }
        } catch (e) {
          // Skip malformed JSON in tool_call blocks
          console.warn(`[Qwen3 Tool Recovery] Failed to parse tool_call JSON: ${match[1].trim().slice(0, 100)}`);
        }
      }
      
      if (parsedCalls.length > 0) {
        msg.tool_calls = parsedCalls;
        // Strip <think> blocks and <tool_call> blocks from content, keep remaining text
        let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, '');
        cleaned = cleaned.replace(/<think>[\s\S]*/g, '');
        cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
        msg.content = cleaned.trim() || null;
        // Set finish_reason to tool_calls so OpenClaw knows to execute them
        choice.finish_reason = 'tool_calls';
        console.log(`[Qwen3 Tool Recovery] Recovered ${parsedCalls.length} tool call(s): ${parsedCalls.map(c => c.function.name).join(', ')}`);
      }
    }
  }
  
  /**
   * Apply model aliasing for compatibility
   * NOTE: GPT→Claude translation removed after bypassing Goose ACP-CLI
   * Now only maintains Claude internal model name consistency
   */
  applyModelAliasing(model) {
    // Model aliases for naming consistency
    const MODEL_ALIASES = {
      // Claude aliases
      'claude-sonnet-4-0': 'claude-3-5-sonnet',  // Use stable model name
      'claude-opus-4-0': 'claude-4-opus',
      'claude-opus-4-1-0': 'claude-4-1-opus',
      // Perplexity aliases (OpenClaw uses perplexity/model-name format)
      'perplexity/sonar-pro': 'sonar-pro',
      'perplexity/sonar': 'sonar',
      'perplexity/sonar-reasoning': 'sonar-reasoning',
      'perplexity/sonar-reasoning-pro': 'sonar-reasoning-pro',
      'perplexity/sonar-deep-research': 'sonar-deep-research',
    };
    
    // "auto" model triggers routing rule evaluation - return as-is for later resolution
    if (model === 'auto' || model === 'openai/auto') {
      console.log(`[Model Aliasing] Auto-routing requested, will resolve via routing rules`);
      return 'auto';
    }
    
    if (MODEL_ALIASES[model]) {
      console.log(`[Model Aliasing] ${model} → ${MODEL_ALIASES[model]}`);
      return MODEL_ALIASES[model];
    }
    
    // Strip provider prefix if present (e.g., "openai/gpt-4" -> "gpt-4")
    if (model && model.includes('/')) {
      const stripped = model.split('/').pop();
      console.log(`[Model Aliasing] Stripping prefix: ${model} → ${stripped}`);
      return stripped;
    }
    
    // Pass through all other model names unchanged
    return model;
  }
  
  /**
   * Resolve "auto" model to concrete model based on routing rules
   * Evaluates mode (fast/deep), complexity, hasTools, etc. from request context
   */
  resolveAutoModel(req) {
    const ctx = req.body._context || {};
    const tools = Array.isArray(req.body.tools) ? req.body.tools : [];
    const hasTools = tools.length > 0;
    const mode = ctx.mode; // fast or deep
    const complexity = ctx.complexity || 'low';
    const operationType = ctx.operationType || ctx.operation_type;
    const taskStream = ctx.taskStream || ctx.task_stream;
    const maxTokens = req.body.max_tokens;
    
    console.log(`[Auto-Routing] Context: mode=${mode}, complexity=${complexity}, hasTools=${hasTools}, operationType=${operationType}, taskStream=${taskStream}`);
    
    // Priority 1: Deep mode routing
    if (mode === 'deep') {
      // Deep + long-context/research → Gemini Flash (1M context)
      if (operationType === 'long_context' || operationType === 'document_analysis' || 
          operationType === 'research' || operationType === 'web_search' ||
          (maxTokens && maxTokens > 20000)) {
        console.log(`[Auto-Routing] Deep mode + long-context → gemini-3-flash-preview`);
        return 'gemini-3-flash-preview';
      }
      // Deep + complex/agentic/tools → MiniMax M2.7 (excellent tool use)
      if (complexity === 'high' || complexity === 'medium' || hasTools) {
        console.log(`[Auto-Routing] Deep mode + complex/tools → minimax-m2.7`);
        return 'minimax-m2.7';
      }
      // Deep + simple → MiniMax M2.7
      console.log(`[Auto-Routing] Deep mode + simple → minimax-m2.7`);
      return 'minimax-m2.7';
    }
    
    // Priority 2: Fast mode routing (homelab-only)
    if (mode === 'fast') {
      // Fast → MiniMax M2.7 (primary model)
      console.log(`[Auto-Routing] Fast mode → minimax-m2.7`);
      return 'minimax-m2.7';
    }
    
    // Priority 3: No mode specified - use task stream / complexity
    // Long context → Gemini Flash (1M context window)
    if (maxTokens && maxTokens > 20000) {
      console.log(`[Auto-Routing] Long context → gemini-3-flash-preview`);
      return 'gemini-3-flash-preview';
    }
    
    // All other tasks (agentic, tools, chat) → MiniMax M2.7
    // Primary model for all routing: excellent function calling, no refusals
    console.log(`[Auto-Routing] Default → minimax-m2.7 [UPDATED_2026_04_12]`);
    return 'minimax-m2.7';
  }
  
  /**
   * Fetch provider API key from AI Inferencing Service
   */
  async fetchProviderKey(req, serviceId, model) {
    const ENABLE_AI_INFERENCING = process.env.ENABLE_AI_INFERENCING !== 'false';
    
    if (ENABLE_AI_INFERENCING) {
      const provider = this.determineProviderFromModel(model);
      
      // Map service IDs to AI Inferencing service names
      // default-service and podcast-studio use the ecosystem-dashboard service
      const SERVICE_ID_MAPPING = {
        'default-service': 'ecosystem-dashboard',
        'podcast-studio': 'ecosystem-dashboard',
        'research-lab': 'ecosystem-dashboard',
        'workspace-ai': 'goose-agent',
        'page-agent': 'goose-agent',
        'dashboard-ai': 'goose-agent'
      };
      
      const mappedServiceId = SERVICE_ID_MAPPING[serviceId] || serviceId;
      
      if (provider) {
        try {
          console.log(`[AI Inferencing] Fetching ${provider} key for service: ${serviceId} → ${mappedServiceId}`);
          const apiKey = await this.inferencingClient.getKey(mappedServiceId, provider);
          
          if (apiKey) {
            console.log(`[AI Inferencing] ✅ Key retrieved for ${serviceId}/${provider}`);
            req.body._inferencingKey = { provider, apiKey, serviceId };
          } else {
            console.warn(`[AI Inferencing] ⚠️ No key found for ${serviceId}/${provider}`);
          }
        } catch (error) {
          console.error(`[AI Inferencing] ❌ Error fetching key:`, error.message);
        }
      }
    }
  }
  
  /**
   * Determine provider from model name
   */
  determineProviderFromModel(model) {
    if (!model) return null;
    const ml = model.toLowerCase();
    
    if (ml.includes('claude')) return 'anthropic';
    if (ml.includes('gpt') || ml.includes('o1')) return 'openai';
    if (ml.includes('gemini')) return 'google';
    if (ml.includes('llama') || ml.includes('mistral')) return 'ollama';
    
    return null;
  }
  
  /**
   * Extract text content from chunk (provider-agnostic)
   * Handles MiniMax/DeepSeek reasoning_content in streaming mode
   */
  extractTextFromChunk(chunk) {
    if (typeof chunk === 'string') return chunk;
    if (chunk.content) return chunk.content;
    if (chunk.text) return chunk.text;
    if (chunk.delta?.content) return chunk.delta.content;
    // MiniMax/DeepSeek reasoning models return reasoning_content instead of content
    if (chunk.delta?.reasoning_content) return chunk.delta.reasoning_content;
    if (chunk.delta?.text) return chunk.delta.text;
    return '';
  }
  
  /**
   * Extract content from full response
   */
  extractContentFromResponse(response) {
    if (!response) return '';
    if (typeof response === 'string') return response;
    if (response.choices && response.choices[0]) {
      const choice = response.choices[0];
      if (choice.message?.content) return choice.message.content;
      // DeepSeek/MiniMax reasoning models put output in reasoning_content
      if (choice.message?.reasoning_content) return choice.message.reasoning_content;
      if (choice.text) return choice.text;
    }
    if (response.content) return response.content;
    return '';
  }
  
  /**
   * Record metrics for cost tracking and tracing
   */
  async recordMetrics(traceId, provider, model, usage, requestStartTime, routingStartTime) {
    if (!usage) return;
    
    try {
      const cost = await this.costService.calculateCost(provider, model, usage);
      await this.costService.recordCost(traceId, provider, model, usage, {});
      
      const totalLatency = Date.now() - requestStartTime;
      const routingLatency = Date.now() - routingStartTime;
      
      this.tracingService.completeTrace(traceId, { usage, provider }, {
        tokens: usage,
        cost,
        latency: {
          routing: routingLatency,
          provider: totalLatency - routingLatency,
          total: totalLatency,
        },
      });
    } catch (error) {
      console.error('[Chat Completions] Error recording metrics:', error);
    }
  }
  
  /**
   * Handle error response
   */
  async handleError(req, res, error, traceId) {
    console.error('[Chat Completions] Error:', error?.message || error);
    
    // Record error in trace
    this.tracingService.recordError(traceId, error, 500);
    
    // Get connectivity status
    let connectivityStatus = {};
    try {
      connectivityStatus = await this.providerManager.getProviderConnectivityStatus() || {};
    } catch (e) {
      console.warn('[Chat Completions] Failed to fetch connectivity status:', e.message);
    }
    
    const availableProviders = Object.entries(connectivityStatus)
      .filter(([, status]) => status && status.connected)
      .map(([provider]) => provider);
    
    const suggestion = availableProviders.length > 0
      ? `Try using a model from available providers: ${availableProviders.join(', ')}`
      : 'No providers are currently available.';
    
    res.status(500).json({
      error: {
        message: error?.message || 'Unknown error',
        type: 'connectivity_error',
        code: 'PROVIDER_UNAVAILABLE',
        details: {
          requestedModel: req?.body?.model,
          connectivity: connectivityStatus,
          availableProviders,
          suggestion
        }
      },
      _gateway: {
        version: '2.5.0',
        timestamp: new Date().toISOString(),
        error: true,
        connectivity: connectivityStatus
      }
    });
  }
}

module.exports = ChatCompletionsHandler;
