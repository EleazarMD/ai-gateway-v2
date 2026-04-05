# Component API Keys Setup Guide

## Quick Reference

Each ecosystem component now has a unique API key for proper identification in the AI Gateway.

| Component | API Key | Purpose |
|-----------|---------|---------|
| **Ecosystem Dashboard** | `dashboard-main-2024-prod-key` | Main monitoring dashboard |
| **AI Inferencing Service** | `ai-inferencing-service-2024-key` | Core AI inference service |
| **Hermes Orchestrator** | `hermes-orchestrator-2024-key` | Workflow orchestration |
| **Hermes Memory** | `hermes-memory-service-2024-key` | Memory/context management |
| **Hermes Tools** | `hermes-tools-service-2024-key` | Tool execution service |
| **MCP Perplexity** | `mcp-perplexity-server-2024-key` | Perplexity API integration |
| **MCP Workspace Books** | `mcp-workspace-books-2024-key` | Documentation/books access |
| **Test Client** | `client-test-2024-key` | Testing and development |
| **Legacy** | `ai-gateway-api-key-2024` | Backward compatibility |

## Configuration Instructions

### 1. Ecosystem Dashboard

**Location:** `/home/eleazar/Projects/AIHomelab/ecosystem-dashboard/.env.local`

```bash
# Update or add these lines
AI_GATEWAY_URL=http://localhost:8777
AI_GATEWAY_API_KEY=dashboard-main-2024-prod-key
```

**Restart command:**
```bash
cd /home/eleazar/Projects/AIHomelab/ecosystem-dashboard
npm run dev  # or pm2 restart ecosystem-dashboard
```

### 2. AI Inferencing Service

**Location:** Service configuration or environment variables

```bash
# Environment variables
export AI_GATEWAY_URL=http://localhost:8777
export AI_GATEWAY_API_KEY=ai-inferencing-service-2024-key
```

### 3. Hermes Core Services

Each Hermes service needs its own configuration:

**Hermes Orchestrator:**
```bash
export AI_GATEWAY_API_KEY=hermes-orchestrator-2024-key
```

**Hermes Memory Service:**
```bash
export AI_GATEWAY_API_KEY=hermes-memory-service-2024-key
```

**Hermes Tools Service:**
```bash
export AI_GATEWAY_API_KEY=hermes-tools-service-2024-key
```

### 4. MCP Servers

**MCP Perplexity Server:**
```json
{
  "mcpServers": {
    "perplexity-ask": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "AI_GATEWAY_API_KEY": "mcp-perplexity-server-2024-key"
      }
    }
  }
}
```

**MCP Workspace Books:**
```json
{
  "mcpServers": {
    "workspace-books": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "AI_GATEWAY_API_KEY": "mcp-workspace-books-2024-key"
      }
    }
  }
}
```

## Verification

### Test Component Identification

Make a test request with each component's API key:

```bash
# Test Dashboard key
curl -H "X-API-Key: dashboard-main-2024-prod-key" \
  http://localhost:8777/api/v1/chat/completions \
  -X POST -H "Content-Type: application/json" \
  -d '{"model":"gemini-2-0-flash","messages":[{"role":"user","content":"test"}]}'

# Check audit log
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT actor, resource, outcome FROM audit_events 
   ORDER BY timestamp DESC LIMIT 1;"
```

**Expected output:** `actor` should show `ecosystem-dashboard` instead of `api-key-xxxxxxxx`

### View All Component Activity

```bash
# See which components are making requests
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT actor, COUNT(*) as requests, 
   COUNT(*) FILTER (WHERE outcome = 'denied') as denied
   FROM audit_events 
   WHERE timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY actor 
   ORDER BY requests DESC;"
```

### Check Rate Limit Violations by Component

```bash
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT actor, resource, COUNT(*) as violations
   FROM audit_events 
   WHERE outcome = 'denied' 
   AND severity = 'warning'
   AND timestamp > NOW() - INTERVAL '1 hour'
   GROUP BY actor, resource 
   ORDER BY violations DESC;"
```

## Benefits

### Before (Generic Keys)
```
Alert Email:
Top Violators:
- api-key-ai-gatew: 2,076 violations
- api-key-ai-gatew: 58 violations
```
❌ **Cannot identify which service is causing the problem**

### After (Component Keys)
```
Alert Email:
Top Violators:
- ecosystem-dashboard @ /api/v1/embeddings: 2,076 violations
- hermes-orchestrator @ /api/v1/chat/completions: 58 violations
```
✅ **Immediately know which service to investigate**

## Troubleshooting

### Component Still Shows as "api-key-xxxxxxxx"

**Cause:** Component not using the correct API key

**Solution:**
1. Verify the API key in the component's configuration
2. Restart the component after updating the key
3. Check the component mapping:
   ```bash
   docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
     "SELECT * FROM api_key_components;"
   ```

### Component Shows as "legacy-client"

**Cause:** Component is using the old generic API key `ai-gateway-api-key-2024`

**Solution:** Update the component to use its unique API key from the table above

### Component Shows as "unknown"

**Cause:** API Key Service not initialized or database connection issue

**Solution:**
1. Check AI Gateway logs: `docker logs ai-gateway | grep APIKeyService`
2. Verify database connectivity
3. Restart AI Gateway: `docker restart ai-gateway`

## Adding New Components

To add a new component to the system:

```bash
# 1. Generate a unique API key
NEW_KEY="my-new-component-2024-key"

# 2. Add to component mapping
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c "
INSERT INTO api_key_components (api_key_hash, component_name, component_type) 
VALUES (
  encode(digest('${NEW_KEY}', 'sha256'), 'hex'),
  'my-new-component',
  'service'
);"

# 3. Restart AI Gateway to refresh cache
docker restart ai-gateway

# 4. Configure the new component with the API key
export AI_GATEWAY_API_KEY="${NEW_KEY}"
```

## Migration Checklist

- [ ] Update Ecosystem Dashboard configuration
- [ ] Update AI Inferencing Service
- [ ] Update Hermes Orchestrator
- [ ] Update Hermes Memory Service
- [ ] Update Hermes Tools Service
- [ ] Update MCP Perplexity Server
- [ ] Update MCP Workspace Books
- [ ] Test each component with a sample request
- [ ] Verify component names in audit logs
- [ ] Monitor alert emails for proper component identification
- [ ] Deprecate legacy API key usage

## Next Steps

1. **Update all components** with their unique API keys
2. **Monitor audit logs** to verify component identification
3. **Check alert emails** - they will now show specific components
4. **Review rate limit violations** by component to identify problem sources
5. **Adjust rate limits** per component as needed

## Support

If you encounter issues:
1. Check AI Gateway logs: `docker logs ai-gateway`
2. Verify component mapping: `SELECT * FROM api_key_components;`
3. Test with curl to isolate the issue
4. Review the full documentation: `docs/API_KEY_MANAGEMENT.md`
