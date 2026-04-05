## [2.5.0] - 2025-11-05

### Added - OpenAI-Compatible SSE Streaming Support 🎉
- **NEW**: Full OpenAI-compatible Server-Sent Events (SSE) streaming for chat completions
- **NEW**: Proper `Content-Type: text/event-stream` headers for streaming responses
- **NEW**: SSE format with `data: {json}\n\n` structure and `[DONE]` marker
- **NEW**: `ChatCompletionsHandler` class with streaming support
- **NEW**: Automatic fallback to simulated streaming for non-streaming providers
- **FIXED**: Goose ACP integration now receives streaming notifications properly
- **FIXED**: Compatible with all OpenAI-expecting clients (Goose, Continue, Cursor, etc.)

### Technical Implementation
- New `ChatCompletionsHandler` in `/src/handlers/chat-completions-handler.js`
- New `SSEStreamingHandler` middleware in `/src/middleware/sse-streaming.js`
- Streaming detection via `req.body.stream === true` parameter
- Proper chunk formatting: `{id, object, created, model, choices: [{delta: {content}}]}`
- Final chunk includes `finish_reason: 'stop'` before `[DONE]` marker
- Backward compatible: Non-streaming requests work as before

### Impact on Goose ACP
- **RESOLVED**: Goose ACP `session/update` notifications now working
- **RESOLVED**: AI responses properly streamed via SSE chunks
- **RESOLVED**: Goose CLI and Goose ACP can now use AI Gateway for streaming
- Authentication properly supported via `OPENAI_API_KEY` and `OPENAI_API_BASE` env vars

### Breaking Changes
- None - fully backward compatible with existing clients

### Upgrade Notes
- Existing non-streaming clients continue to work without changes
- To enable streaming, add `"stream": true` to chat completion requests
- Goose configuration requires `OPENAI_API_BASE=http://localhost:8777/api/v1`

---

## [2.4.1] - 2025-11-03

### Added - Workspace Proxy for Goose MCP Integration
- **NEW**: Workspace proxy routes at `/api/v1/workspace/*` for Goose AI integration
- **NEW**: Proxies workspace operations (pages, databases, blocks) to dashboard/core service
- **NEW**: Supports all Workspace MCP tools (31 tools total)
- **NEW**: Centralized routing for workspace CRUD operations through AI Gateway

### Endpoints Added
- `POST /api/v1/workspace/pages` - Create page
- `GET /api/v1/workspace/pages/:pageId` - Get page
- `PUT /api/v1/workspace/pages/:pageId` - Update page  
- `DELETE /api/v1/workspace/pages/:pageId` - Delete page
- `GET /api/v1/workspace/pages` - List pages
- `POST /api/v1/workspace/databases` - Create database
- `POST /api/v1/workspace/databases/:databaseId/query` - Query database
- `GET /api/v1/workspace/databases/:databaseId/schema` - Get schema
- `POST /api/v1/workspace/blocks` - Create block
- `PUT /api/v1/workspace/blocks/:blockId` - Update block
- `GET /api/v1/workspace/pages/:pageId/blocks` - Get page blocks
- `GET /api/v1/workspace/search/pages` - Search pages
- `POST /api/v1/workspace/validate/schema` - Validate schema

### Technical Details
- Workspace MCP server calls AI Gateway instead of dashboard directly
- AI Gateway proxies to dashboard at `http://localhost:8404/api/workspace/*`
- Enables centralized observability, rate limiting, and caching for workspace operations
- Follows "One Endpoint Per Capability" architecture pattern
- Goose config updated: `DASHBOARD_URL: http://localhost:8777/api/v1/workspace`

### Integration
- Workspace MCP extension in Goose now routes through AI Gateway
- User-toggleable in WorkspaceAI settings panel (Agentic mode only)
- Full integration guide: `/mcp-servers/WORKSPACE_AI_GATEWAY_INTEGRATION.md`

### Backward Compatibility
- ✅ No breaking changes to existing AI Gateway endpoints
- ✅ Workspace proxy is additive functionality
- ✅ Dashboard API unchanged (AI Gateway proxies to it)

---

## [2.3.0] - 2025-10-28

### Added - Multi-Speaker TTS Support
- **NEW**: Parameter-based multi-speaker TTS via `/api/v1/tts` endpoint
- **NEW**: Support for `mode: 'multi-speaker'` parameter for conversation-based audio generation
- **NEW**: `script` parameter accepts full conversation text with speaker transitions
- **NEW**: `speakerVoices` array maps speakers to voice IDs (e.g., `[{speaker: 'Joe', voiceName: 'Kore'}]`)
- **NEW**: Routes multi-speaker requests to AI Inferencing Service for Gemini multi-speaker API integration
- **NEW**: Response headers include `X-TTS-Mode` and `X-Speaker-Count` for debugging
- Generates entire podcast/conversation in a single API call (12x faster than sequential single-speaker)

### Technical Details
- Same endpoint `/api/v1/tts` handles both single-speaker and multi-speaker modes
- Detection logic: `mode === 'multi-speaker' && script && speakerVoices` → multi-speaker routing
- AI Inferencing Service integration at `http://host.k3d.internal:9000/api/tts/multi-speaker`
- Returns WAV audio buffer (consistent with single-speaker)
- 2-minute timeout for multi-speaker generation
- New service capability: `multi-speaker-tts` and `tts-routing`
- New dependency: `ai-inferencing-service`

### Backward Compatibility
- ✅ Existing single-speaker TTS calls work unchanged
- ✅ No breaking changes to API contract
- ✅ Gateway remains model-agnostic and extensible

### Example Request
```javascript
// Multi-speaker mode:
POST /api/v1/tts
{
  "mode": "multi-speaker",
  "script": "TTS the following conversation:\nJoe: Hello!\nJane: Hi there!",
  "speakerVoices": [
    { "speaker": "Joe", "voiceName": "Kore" },
    { "speaker": "Jane", "voiceName": "Puck" }
  ],
  "model": "google-gemini-2.5-pro-preview-tts"
}

// Single-speaker (unchanged):
POST /api/v1/tts
{
  "text": "Hello world",
  "voice": "Kore",
  "model": "google-gemini-2.5-pro-preview-tts"
}
```

---

## [2.2.1] - 2025-10-26

### Added - Multi-Tenant API Key Management
- **NEW**: Integration with AI Inferencing Service for dynamic API key management
- **NEW**: Support for per-agent API key isolation via `X-Service-ID` header
- **NEW**: Support for per-project API key grouping via `X-Project-ID` header
- **NEW**: Kubernetes secrets management for provider API keys (OpenAI, Anthropic, Google)
- **NEW**: Environment variables for AI Inferencing Service integration:
  - `AI_INFERENCING_URL` - URL of AI Inferencing Service (default: http://host.k3d.internal:9000)
  - `AI_INFERENCING_API_KEY` - Admin API key for AI Inferencing Service
  - `ENABLE_AI_INFERENCING` - Enable/disable AI Inferencing integration (default: true)

### Fixed
- **CRITICAL**: Fixed provider initialization to use Kubernetes secrets properly
- **CRITICAL**: Fixed Google Gemini provider loading (now loads 50+ models successfully)
- Google provider now validates connection during startup
- Improved error handling for provider failures (graceful degradation)

### Changed
- Provider API keys now loaded from Kubernetes secrets instead of environment variables
- Secrets format: `ai-gateway-secrets` with keys: `openai-api-key`, `anthropic-api-key`, `google-api-key`
- Provider Manager now continues loading other providers even if one fails
- Improved logging for provider initialization and failures

### Known Issues
- Anthropic provider has intermittent `validateConnection` method errors (non-blocking)
- OpenAI provider requires valid API key refresh (401 errors)
- Ollama provider validation needs endpoint format fix

### Deployment Notes
**Kubernetes Secrets Required:**
```bash
kubectl create secret generic ai-gateway-secrets \
  --from-literal=api-key=ai-gateway-api-key-2024 \
  --from-literal=admin-api-key=ai-gateway-admin-key-2024 \
  --from-literal=openai-api-key="$OPENAI_KEY" \
  --from-literal=google-api-key="$GOOGLE_KEY" \
  --from-literal=anthropic-api-key="$ANTHROPIC_KEY" \
  -n ai-homelab-unified
```

**Environment Variables for AI Inferencing:**
```yaml
env:
  - name: AI_INFERENCING_URL
    value: "http://host.k3d.internal:9000"
  - name: AI_INFERENCING_API_KEY
    value: "ai-inferencing-admin-key-2024"
  - name: ENABLE_AI_INFERENCING
    value: "true"
```

### Migration from 2.2.0 to 2.2.1
1. Create or update `ai-gateway-secrets` with provider API keys
2. Add AI Inferencing environment variables to deployment (already present in k8s manifests)
3. Build and import new image: `docker build -t ai-gateway:v2.2.1 . && k3d image import ai-gateway:v2.2.1`
4. Update deployment: `kubectl set image deployment/ai-gateway ai-gateway=ai-gateway:v2.2.1 -n ai-homelab-unified`
5. Verify provider loading: Check logs for "Provider google loaded successfully"

### Dashboard AI Agent Integration
- Dashboard AI Agent (port 8405) now successfully connects via AI Gateway
- Model format: Use hyphenated names (e.g., `gemini-2-0-flash` not `gemini-2.0-flash-exp`)
- Working architecture: Dashboard → AI Gateway (8777) → Google Gemini API
- Response time: ~750ms average for simple queries

---

# AI Gateway Changelog

## [2.2.0] - 2025-10-22

### Changed - TTS Endpoint Model-Agnostic Architecture
- **BREAKING**: TTS endpoint now requires `model`, `voice`, and `text` parameters (no defaults)
- Removed hardcoded model fallback (`gemini-2.5-pro-preview-tts`)
- Removed voice validation and fallback logic
- Gateway now acts as pure pass-through for TTS parameters
- Caller must specify exact model and voice (e.g., dashboard)

### Technical Details
- `model` parameter is now **required** in TTS requests
- `voice` parameter is now **required** (no default to 'Puck')
- Removed `validVoices` array - any voice name accepted
- Model name used directly in Google API call without modification
- Returns 400 Bad Request if required parameters missing

### Migration Notes
For clients calling `/api/v1/tts`:
```javascript
// Before (2.1.0):
{ text: "Hello", voice: "Charon" }  // model defaulted to gemini-2.5-pro-preview-tts

// After (2.2.0):
{ 
  text: "Hello", 
  voice: "Charon",
  model: "gemini-2.5-pro-preview-tts"  // REQUIRED
}
```

### Rationale
- Separates concerns: Gateway handles routing, clients handle business logic
- Allows flexibility for different TTS models (Pro vs Flash)
- Follows AI Gateway architectural principle of being model-agnostic
- Enables proper model selection at the application layer

---

## [2.1.0] - Previous Release

### Added
- Initial TTS support via `/api/v1/tts` endpoint
- Gemini 2.5 TTS voices integration
- Default model: `gemini-2.5-pro:generateContent` (incorrect - fixed in 2.2.0)

### Issues Fixed in 2.2.0
- Used text generation model instead of TTS-specific model
- Hardcoded defaults prevented flexible model selection
- Voice validation was too restrictive

---

## Version History
- **2.2.0** - Model-agnostic TTS endpoint (current)
- **2.1.0** - Initial TTS support (had hardcoded defaults)
- **2.0.0** - Dual-port architecture baseline
