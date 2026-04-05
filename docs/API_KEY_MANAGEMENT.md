# API Key Management System

## Overview

The AI Gateway now implements a comprehensive API key management system that provides unique identifiers for each ecosystem component. This enables precise tracking, diagnostics, and rate limiting per component.

## Key Features

- **Component Identification**: Each API key is associated with a specific component name
- **Usage Tracking**: Detailed logging of API key usage with per-component analytics
- **Rate Limiting Tiers**: Different rate limits based on component type and needs
- **Scopes**: Fine-grained permissions (read, write, admin)
- **Expiration**: Optional key expiration for temporary access
- **Caching**: High-performance validation with intelligent caching

## Database Schema

### `api_keys` Table
```sql
- key_id (UUID): Primary key
- api_key (VARCHAR): The actual API key
- key_name (VARCHAR): Human-readable name
- component_name (VARCHAR): Unique component identifier
- component_type (VARCHAR): Type of component (service, dashboard, client, integration)
- scopes (TEXT[]): Permissions array
- rate_limit_tier (VARCHAR): Rate limiting tier
- is_active (BOOLEAN): Active status
- is_internal (BOOLEAN): Internal vs external
- last_used_at (TIMESTAMP): Last usage timestamp
- total_requests (BIGINT): Total request count
```

### `api_key_usage` Table
```sql
- usage_id (UUID): Primary key
- key_id (UUID): Foreign key to api_keys
- component_name (VARCHAR): Component identifier
- endpoint (VARCHAR): API endpoint accessed
- method (VARCHAR): HTTP method
- status_code (INTEGER): Response status
- outcome (VARCHAR): success, denied, error
- timestamp (TIMESTAMP): Request timestamp
```

## Ecosystem Component API Keys

### Pre-configured Components

| Component | API Key | Component Name | Type | Rate Limit |
|-----------|---------|----------------|------|------------|
| **Ecosystem Dashboard** | `dashboard-main-2024-prod-key` | `ecosystem-dashboard` | dashboard | high |
| **AI Inferencing Service** | `ai-inferencing-service-2024-key` | `ai-inferencing` | service | unlimited |
| **Hermes Orchestrator** | `hermes-orchestrator-2024-key` | `hermes-orchestrator` | service | high |
| **Hermes Memory Service** | `hermes-memory-service-2024-key` | `hermes-memory` | service | high |
| **Hermes Tools Service** | `hermes-tools-service-2024-key` | `hermes-tools` | service | high |
| **MCP Perplexity Server** | `mcp-perplexity-server-2024-key` | `mcp-perplexity` | integration | standard |
| **MCP Workspace Books** | `mcp-workspace-books-2024-key` | `mcp-workspace-books` | integration | standard |
| **Test Client** | `client-test-2024-key` | `test-client` | client | standard |
| **Legacy Key** | `ai-gateway-api-key-2024` | `legacy-client` | client | standard |

## Configuration Instructions

### 1. Ecosystem Dashboard

Update the dashboard's environment variables or configuration:

```bash
# .env or .env.local
AI_GATEWAY_URL=http://localhost:8777
AI_GATEWAY_API_KEY=dashboard-main-2024-prod-key
```

### 2. AI Inferencing Service

Update the AI Inferencing service configuration:

```bash
# Environment variables
AI_GATEWAY_URL=http://localhost:8777
AI_GATEWAY_API_KEY=ai-inferencing-service-2024-key
```

### 3. Hermes Core Services

Each Hermes service needs its own unique key:

**Orchestrator:**
```bash
AI_GATEWAY_API_KEY=hermes-orchestrator-2024-key
```

**Memory Service:**
```bash
AI_GATEWAY_API_KEY=hermes-memory-service-2024-key
```

**Tools Service:**
```bash
AI_GATEWAY_API_KEY=hermes-tools-service-2024-key
```

### 4. MCP Servers

Update MCP server configurations:

**Perplexity:**
```bash
AI_GATEWAY_API_KEY=mcp-perplexity-server-2024-key
```

**Workspace Books:**
```bash
AI_GATEWAY_API_KEY=mcp-workspace-books-2024-key
```

## Usage in Code

### Making Authenticated Requests

```bash
# Using X-API-Key header
curl -H "X-API-Key: dashboard-main-2024-prod-key" \
  http://localhost:8777/api/v1/chat/completions

# Using Authorization Bearer token
curl -H "Authorization: Bearer dashboard-main-2024-prod-key" \
  http://localhost:8777/api/v1/embeddings
```

### JavaScript/Node.js Example

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'http://localhost:8777',
  headers: {
    'X-API-Key': 'dashboard-main-2024-prod-key'
  }
});

// Make requests
const response = await client.post('/api/v1/chat/completions', {
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

### Python Example

```python
import requests

headers = {
    'X-API-Key': 'ai-inferencing-service-2024-key',
    'Content-Type': 'application/json'
}

response = requests.post(
    'http://localhost:8777/api/v1/chat/completions',
    headers=headers,
    json={
        'model': 'gpt-4',
        'messages': [{'role': 'user', 'content': 'Hello!'}]
    }
)
```

## API Key Management Endpoints

### Get All API Keys (Admin Only)

```bash
curl -H "X-Admin-Key: ai-gateway-admin-key-2024" \
  http://localhost:7777/api/v1/security/api-keys
```

### Get Component Usage Statistics

```bash
curl -H "X-API-Key: dashboard-main-2024-prod-key" \
  http://localhost:8777/api/v1/security/api-keys/ecosystem-dashboard/usage
```

### Create New API Key (Admin Only)

```bash
curl -X POST \
  -H "X-Admin-Key: ai-gateway-admin-key-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "new-component-2024-key",
    "keyName": "New Component",
    "componentName": "new-component",
    "componentType": "service",
    "description": "Description of the new component",
    "scopes": ["read", "write"],
    "rateLimitTier": "standard"
  }' \
  http://localhost:7777/api/v1/security/api-keys
```

### Revoke API Key (Admin Only)

```bash
curl -X DELETE \
  -H "X-Admin-Key: ai-gateway-admin-key-2024" \
  http://localhost:7777/api/v1/security/api-keys/old-component-key
```

## Rate Limiting Tiers

| Tier | Requests/Minute | Use Case |
|------|-----------------|----------|
| **standard** | 100 | External clients, testing |
| **high** | 500 | Internal services, dashboards |
| **unlimited** | No limit | Critical infrastructure |

## Monitoring & Diagnostics

### View Rate Limit Violations by Component

```bash
# Check which components are being rate-limited
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT actor, resource, COUNT(*) as violations 
   FROM audit_events 
   WHERE outcome = 'denied' 
   AND timestamp > NOW() - INTERVAL '1 hour' 
   GROUP BY actor, resource 
   ORDER BY violations DESC;"
```

### View Component Usage Statistics

```bash
# Get usage stats for a specific component
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT * FROM api_keys_with_stats 
   WHERE component_name = 'ecosystem-dashboard';"
```

### Alert Email Diagnostics

With the new API key system, alert emails now show:
- **Component Name** instead of truncated API key
- **Endpoint** being accessed
- **Violation Count** per component
- **Time Distribution** of violations

Example alert email content:
```
Top Violators:
┌─────────────────────────────┬─────────────────────────┬────────────┐
│ Endpoint                    │ Component               │ Violations │
├─────────────────────────────┼─────────────────────────┼────────────┤
│ /api/v1/embeddings          │ ecosystem-dashboard     │ 2,076      │
│ /api/v1/chat/completions    │ hermes-orchestrator     │ 58         │
└─────────────────────────────┴─────────────────────────┴────────────┘
```

## Migration Guide

### Step 1: Run Database Migration

The migration is automatically run on AI Gateway startup. To manually run:

```bash
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db \
  -f /app/migrations/003_api_key_management.sql
```

### Step 2: Update Each Component

Update each ecosystem component with its unique API key:

1. **Ecosystem Dashboard**: Update `.env.local`
2. **AI Inferencing**: Update service configuration
3. **Hermes Services**: Update each service's environment
4. **MCP Servers**: Update MCP configuration files

### Step 3: Verify Component Identification

Make a test request and verify the component is identified:

```bash
# Make a request
curl -H "X-API-Key: dashboard-main-2024-prod-key" \
  http://localhost:8777/api/v1/info

# Check audit log
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT actor, resource, timestamp 
   FROM audit_events 
   ORDER BY timestamp DESC LIMIT 5;"
```

You should see `ecosystem-dashboard` as the actor instead of `api-key-ai-gatew`.

### Step 4: Monitor for Legacy Key Usage

```bash
# Find requests still using legacy key
docker exec ai-gateway-postgres psql -U aigateway -d aigateway_db -c \
  "SELECT COUNT(*) as legacy_requests 
   FROM audit_events 
   WHERE actor = 'legacy-client' 
   AND timestamp > NOW() - INTERVAL '1 hour';"
```

## Security Best Practices

1. **Rotate Keys Regularly**: Create new keys and deprecate old ones
2. **Use Expiration**: Set `expires_at` for temporary access
3. **Monitor Usage**: Review `api_key_usage` table regularly
4. **Revoke Unused Keys**: Disable keys that haven't been used in 30+ days
5. **Separate Internal/External**: Use `is_internal` flag appropriately
6. **Audit Logs**: Review audit events for suspicious patterns

## Troubleshooting

### Component Not Identified

**Symptom**: Audit logs show `api-key-xxxxxxxx` instead of component name

**Solution**: 
1. Verify API key is in database: `SELECT * FROM api_keys WHERE api_key = 'your-key';`
2. Check if key is active: `is_active = true`
3. Verify authentication middleware is initialized
4. Check AI Gateway logs for API Key Service initialization

### Rate Limiting Issues

**Symptom**: Component getting rate-limited unexpectedly

**Solution**:
1. Check rate limit tier: `SELECT rate_limit_tier FROM api_keys WHERE component_name = 'your-component';`
2. Upgrade tier if needed: `UPDATE api_keys SET rate_limit_tier = 'high' WHERE component_name = 'your-component';`
3. Review usage patterns in `api_key_usage` table

### Key Validation Failures

**Symptom**: 403 Invalid API key errors

**Solution**:
1. Verify key exists and is active
2. Check expiration: `SELECT expires_at FROM api_keys WHERE api_key = 'your-key';`
3. Clear cache: Restart AI Gateway to refresh key cache
4. Check database connectivity

## Support

For issues or questions about API key management:
1. Check AI Gateway logs: `docker logs ai-gateway`
2. Review database state: `SELECT * FROM api_keys_with_stats;`
3. Test with admin key first to isolate authentication issues
4. Check WebSocket monitoring for real-time diagnostics
