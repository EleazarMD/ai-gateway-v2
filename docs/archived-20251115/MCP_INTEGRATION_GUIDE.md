# MCP Integration Guide - AI Homelab Ecosystem
**Version:** 1.0  
**Last Updated:** 2025-11-02  
**Authority:** Derived from Constitutional Global Rules v3.0  
**Status:** 🟢 CANONICAL REFERENCE

---

## Constitutional Authority

**⚠️ CRITICAL:** This document implements the MCP-as-a-Service standards defined in:

📖 **Constitutional Source:** `/Users/eleazar/.codeium/windsurf/memories/global_rules.md` Section VA

All MCP integrations MUST comply with the constitutional standards. This document provides implementation guidance only.

---

## Quick Start

### Adding a New MCP Provider (3 Steps)

**Step 1: Add Configuration (30 seconds)**
```json
// File: config/mcp-providers-config.json
{
  "providers": {
    "newprovider": {
      "baseUrl": "https://api.newprovider.com",
      "description": "What the provider does",
      "actions": {
        "action1": {
          "path": "/endpoint",
          "method": "POST",
          "auth": "bearer",
          "description": "What this action does"
        }
      },
      "keyProvider": "newprovider",
      "timeout": 30000,
      "costPerInvocation": 0.001
    }
  }
}
```

**Step 2: Add API Key (1 minute)**
```bash
POST http://localhost:9000/api/v1/admin/keys/services/ai-workspace-newprovider-service/keys
{
  "provider": "newprovider",
  "apiKey": "your-api-key",
  "isPrimary": true,
  "costLimitDaily": 5.0,
  "rateLimitPerMinute": 60
}
```

**Step 3: Test (30 seconds)**
```bash
curl -X POST http://localhost:8777/api/v1/mcp/newprovider/action1 \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "X-Service-ID: goose-agent" \
  -H "X-Project-ID: ai-workspace" \
  -d '{"param": "value"}'
```

**Result: Provider is live. Zero code changes.**

---

## Architecture Overview

### The Three-Layer Pattern

```
┌─────────────────┐
│  Client/Agent   │  Goose, WorkspaceAI, Custom Tools
└────────┬────────┘
         │ HTTP Request
         │ Headers: X-Service-ID, X-Project-ID, X-API-Key
         ▼
┌─────────────────┐
│   AI Gateway    │  Generic MCP Proxy
│   Port: 8777    │  Endpoint: /api/v1/mcp/:provider/:action
└────────┬────────┘
         │ 1. Load provider config
         │ 2. Fetch API key via AI Inferencing API
         │ 3. Start tracing & cost tracking
         ▼
┌─────────────────┐
│ AI Inferencing  │  Key Management & Telemetry
│   Port: 9000    │  Endpoint: /api/v1/admin/keys/services/{id}/keys/{provider}/decrypted
└────────┬────────┘
         │ Returns decrypted API key
         ▼
    [External MCP Provider API]
         │
         ▼
    [Response with full tracking]
```

### First-Class Infrastructure

Every MCP call automatically gets:
- ✅ **Trace ID** - Track request end-to-end
- ✅ **Cost Tracking** - Per-call cost recording
- ✅ **Performance Metrics** - Duration, latency
- ✅ **Error Tracking** - Failures with context
- ✅ **Response Headers** - X-Trace-ID, X-Cost, X-Duration

---

## Configuration Reference

### Provider Configuration Schema

```typescript
interface ProviderConfig {
  baseUrl: string;              // Provider API base URL
  description: string;          // What the provider does
  actions: {
    [actionName: string]: {
      path: string;            // API endpoint path
      method: string;          // HTTP method (POST, GET, etc.)
      auth: AuthType;          // Authentication scheme
      description?: string;    // What this action does
    };
  };
  keyProvider: string;          // Key identifier in AI Inferencing
  timeout: number;              // Request timeout (ms)
  costPerInvocation: number;    // Cost per call (USD)
}

type AuthType = 'bearer' | 'api-key' | 'query-token';
```

### Authentication Schemes

**Bearer Token (Recommended for most APIs)**
```json
{
  "auth": "bearer"
}
```
Results in: `Authorization: Bearer {api_key}`

**API Key Header (For APIs that use X-API-Key)**
```json
{
  "auth": "api-key"
}
```
Results in: `X-API-Key: {api_key}`

**Query Token (For APIs that use URL parameters)**
```json
{
  "auth": "query-token"
}
```
Results in: `URL?api_key={api_key}`

---

## MCP Wrapper Development

### When You Need a Wrapper

Create a custom MCP wrapper when:
- ✅ Official MCP package doesn't support custom base URLs
- ✅ Provider has no official MCP package
- ✅ Need to add custom transformation logic
- ❌ **NEVER** to bypass the AI Gateway proxy

### Standard Wrapper Template

See `/Users/eleazar/Projects/AIHomelab/mcp-servers/tavily-mcp-wrapper/index.js` for reference implementation.

**Key Components:**
1. MCP Server setup with `@modelcontextprotocol/sdk`
2. Axios instance with AI Gateway base URL and headers
3. Tool definitions for MCP protocol
4. Request handlers that proxy to AI Gateway

**Required Environment Variables:**
- `AI_GATEWAY_URL`: http://localhost:8777
- `SERVICE_ID`: goose-agent
- `PROJECT_ID`: ai-workspace

---

## Testing & Debugging

### Health Check
```bash
curl http://localhost:8777/health
```

### List Available Providers
```bash
# Check mcp-providers-config.json
cat config/mcp-providers-config.json | jq '.providers | keys'
```

### Test MCP Call
```bash
curl -X POST http://localhost:8777/api/v1/mcp/tavily/search \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "X-Service-ID: goose-agent" \
  -H "X-Project-ID: ai-workspace" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "test query",
    "max_results": 2
  }' | jq .
```

### Check Traces
```bash
# Get recent traces
curl http://localhost:7777/api/v1/traces?type=mcp_tool \
  -H "X-API-Key: ai-gateway-api-key-2024" | jq '.traces | length'

# Get specific trace
curl http://localhost:7777/api/v1/traces/{traceId} \
  -H "X-API-Key: ai-gateway-api-key-2024" | jq .
```

### Check Costs
```bash
curl "http://localhost:7777/api/v1/costs?serviceId=goose-agent&toolType=mcp" \
  -H "X-API-Key: ai-gateway-api-key-2024" | jq '.totalCost'
```

### View Logs
```bash
tail -f /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2/ai-gateway.log | grep "MCP Proxy"
```

---

## Service ID Convention

### Format
```
{project_id}-{provider}-service
```

### Examples
| Project | Provider | Service ID |
|---------|----------|------------|
| ai-workspace | tavily | `ai-workspace-tavily-service` |
| ai-workspace | serper | `ai-workspace-serper-service` |
| tripcraft | browserless | `tripcraft-browserless-service` |
| medgemma | firecrawl | `medgemma-firecrawl-service` |

### Why This Matters
- Enables multi-tenant key management
- Different projects can use different API keys for the same provider
- Cost attribution per project
- Rate limiting per project

---

## Compliance Checklist

Before deploying ANY MCP integration, verify:

### Configuration
- [ ] Provider added to `config/mcp-providers-config.json`
- [ ] Base URL is correct
- [ ] All actions have correct paths and methods
- [ ] Authentication scheme is correct
- [ ] Cost per invocation is set
- [ ] Timeout is appropriate

### Key Management
- [ ] API key added to AI Inferencing service
- [ ] Service ID follows `{project}-{provider}-service` format
- [ ] Key is marked as primary
- [ ] Cost limits set appropriately
- [ ] Rate limits configured

### Infrastructure
- [ ] Request tracing implemented (automatic via proxy)
- [ ] Cost tracking implemented (automatic via proxy)
- [ ] Performance monitoring (automatic via proxy)
- [ ] Error handling (automatic via proxy)
- [ ] Response headers include trace IDs (automatic)

### Testing
- [ ] Health check passes
- [ ] Direct API call succeeds
- [ ] Trace appears in traces endpoint
- [ ] Cost recorded in costs endpoint
- [ ] No errors in logs
- [ ] Response time acceptable

### Documentation
- [ ] Provider purpose documented
- [ ] Actions documented
- [ ] Cost structure noted
- [ ] Rate limits documented

---

## Common Issues & Solutions

### Issue: 404 Provider Not Found
**Symptom:** `{"error": "Provider not found", "message": "MCP provider 'xyz' is not configured"}`

**Solution:**
1. Check provider name spelling in config file
2. Verify `mcp-providers-config.json` loaded correctly
3. Restart AI Gateway if config was just added

### Issue: 500 API Key Not Available
**Symptom:** `{"error": "API key not available", "message": "Could not retrieve API key..."}`

**Solution:**
1. Verify key exists in AI Inferencing:
   ```bash
   curl http://localhost:9000/api/v1/admin/keys/services/{project}-{provider}-service/keys \
     -H "X-Admin-Key: ai-inferencing-admin-key-2024"
   ```
2. Check service ID format is correct
3. Verify key is marked as primary and active

### Issue: 404 Action Not Found
**Symptom:** `{"error": "Action not found", "message": "Action 'xyz' not found for provider..."}`

**Solution:**
1. Check action name spelling
2. Verify action exists in provider config
3. Check available actions: Look at `config/mcp-providers-config.json`

### Issue: 401 Unauthorized from Provider
**Symptom:** External provider returns 401

**Solution:**
1. Verify API key is valid (test directly with provider)
2. Check authentication scheme is correct (bearer vs api-key)
3. Ensure key hasn't expired
4. Validate key using AI Inferencing validation endpoint

---

## Performance Optimization

### Recommended Timeouts
- **Search APIs:** 10-30 seconds
- **Scraping APIs:** 60-120 seconds
- **Screenshot APIs:** 30-60 seconds
- **LLM APIs:** 60-180 seconds

### Cost Management
- Set `costPerInvocation` based on provider pricing
- Use AI Inferencing cost limits: `costLimitDaily`
- Monitor via costs endpoint regularly
- Set alerts for unexpected cost spikes

### Rate Limiting
- Configure in AI Inferencing: `rateLimitPerMinute`
- Provider-side limits are separate
- Monitor rejection rates
- Adjust limits based on usage patterns

---

## Migration Guide

### From Provider-Specific Endpoint

**Before (DEPRECATED):**
```javascript
POST /api/v1/tavily/search
```

**After (CONSTITUTIONAL):**
```javascript
POST /api/v1/mcp/tavily/search
```

**Steps:**
1. Add provider to `mcp-providers-config.json`
2. Update client code to use new endpoint
3. Test thoroughly
4. Keep old endpoint for 30-day grace period
5. Remove old endpoint
6. Update documentation

### From Direct Provider Calls

**Before (FORBIDDEN):**
```javascript
const apiKey = process.env.TAVILY_API_KEY;
const response = await axios.post('https://api.tavily.com/search', data, {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
```

**After (CONSTITUTIONAL):**
```javascript
const response = await axios.post('http://localhost:8777/api/v1/mcp/tavily/search', data, {
  headers: {
    'X-API-Key': 'ai-gateway-api-key-2024',
    'X-Service-ID': 'my-service',
    'X-Project-ID': 'my-project'
  }
});
```

---

## Reference Files

### Core Implementation
- **AI Gateway Server:** `/Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2/server.js` (lines 2056-2223)
- **Provider Config:** `/Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2/config/mcp-providers-config.json`
- **AI Inferencing Routes:** `/Users/eleazar/Projects/AIHomelab/services/ai-inferencing/src/routes/multi-tenant-api-key-routes.js`

### Example Implementations
- **Tavily Wrapper:** `/Users/eleazar/Projects/AIHomelab/mcp-servers/tavily-mcp-wrapper/`
- **Goose Config:** `/Users/eleazar/Projects/AIHomelab/mcp-servers/goose-config/mcp-servers.json`

### Constitutional Rules
- **Global Rules:** `/Users/eleazar/.codeium/windsurf/memories/global_rules.md` Section VA

---

## Support & Updates

**Questions?** Consult constitutional rules first:  
📖 `/Users/eleazar/.codeium/windsurf/memories/global_rules.md` Section VA

**Updates:** This document is automatically updated when constitutional rules change.

**Version History:**
- v1.0 (2025-11-02): Initial comprehensive guide based on Tavily integration lessons

---

**Last Updated:** 2025-11-02  
**Canonical Authority:** Constitutional Global Rules v3.0 Section VA  
**Maintainer:** AI Homelab Development Team  
**Status:** Active & Enforced
