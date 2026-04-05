# Multi-Tenant API Key Management - Complete Guide

## Overview

The AI Gateway now supports **hierarchical API key management** where different projects and services can use different API keys for the same providers.

### Architecture

```
Project (e.g., "AI Research")
  ├─ Service: research-agent
  │   ├─ Provider: OpenAI → API Key: sk-proj-research-xxx
  │   └─ Provider: Google → API Key: AIza-research-yyy
  │
  └─ Service: summary-generator
      ├─ Provider: OpenAI → API Key: sk-proj-summary-xxx
      └─ Provider: Anthropic → API Key: sk-ant-summary-zzz

Project (e.g., "Podcast Studio")
  └─ Service: podcast-generator
      ├─ Provider: OpenAI → API Key: sk-proj-podcast-xxx
      └─ Provider: Google → API Key: AIza-podcast-yyy
```

**Benefits:**
- ✅ Cost tracking per project/service
- ✅ Security isolation
- ✅ Different rate limits per service
- ✅ Independent API key rotation
- ✅ Usage analytics by service

---

## Database Schema

### Tables Created

```sql
projects
  ├─ project_id (primary key)
  ├─ name
  ├─ description
  ├─ status (active/inactive)
  └─ metadata (JSONB)

services
  ├─ service_id (primary key)
  ├─ project_id (foreign key)
  ├─ name
  ├─ description
  ├─ status
  └─ metadata (JSONB)

api_keys_multi_tenant
  ├─ key_id (primary key)
  ├─ project_id (foreign key)
  ├─ service_id (foreign key)
  ├─ provider (openai, google, anthropic, etc.)
  ├─ encrypted_key
  ├─ is_active
  ├─ is_primary (primary key for this service+provider)
  ├─ rate_limit_per_minute
  ├─ rate_limit_per_day
  ├─ cost_limit_daily
  ├─ cost_limit_monthly
  └─ validation_status

api_key_usage_multi_tenant
  ├─ key_id
  ├─ project_id
  ├─ service_id
  ├─ provider
  ├─ usage_date
  ├─ request_count
  ├─ total_tokens
  └─ cost_usd
```

---

## Client Integration - How to Call AI Gateway

### Standard Request Format

When making requests to AI Gateway, pass the service context:

```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "X-Service-ID: research-agent" \
  -H "X-Project-ID: ai-research" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

### Headers Explained

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes | AI Gateway access key |
| `X-Service-ID` | **Yes** | Service identifier (e.g., `research-agent`) |
| `X-Project-ID` | Optional | Project identifier (derived from service if omitted) |
| `X-Client-ID` | Optional | For tracking individual clients |

### JSON Body Alternative

You can also pass service context in the JSON body:

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "_context": {
    "serviceId": "research-agent",
    "projectId": "ai-research",
    "clientId": "research-ui-v1"
  }
}
```

---

## API Key Management Endpoints

All management endpoints are on the **internal port (7777)** and require admin authentication.

### 1. List All Projects

```bash
GET /api/v1/keys/projects
```

**Response:**
```json
{
  "projects": [
    {
      "project_id": "ai-research",
      "name": "AI Research",
      "description": "AI research and analysis services",
      "status": "active",
      "service_count": 2,
      "key_count": 4
    }
  ]
}
```

### 2. List Services in a Project

```bash
GET /api/v1/keys/projects/:projectId/services
```

**Response:**
```json
{
  "services": [
    {
      "service_id": "research-agent",
      "project_id": "ai-research",
      "name": "Research Agent",
      "description": "AI research agent",
      "status": "active",
      "key_count": 2
    }
  ]
}
```

### 3. Get Keys for a Service

```bash
GET /api/v1/keys/services/:serviceId/keys
```

**Response:**
```json
{
  "keys": [
    {
      "key_id": "ai-research-research-agent-openai-1234567890",
      "project_id": "ai-research",
      "service_id": "research-agent",
      "provider": "openai",
      "provider_display_name": "OpenAI",
      "is_active": true,
      "is_primary": true,
      "last_validated": "2025-10-23T01:00:00Z",
      "validation_status": "valid",
      "rate_limit_per_minute": 100,
      "cost_limit_daily": 50.00,
      "created_at": "2025-10-22T12:00:00Z"
    }
  ]
}
```

### 4. Add/Update API Key

```bash
POST /api/v1/keys/services/:serviceId/keys
```

**Request Body:**
```json
{
  "provider": "openai",
  "apiKey": "sk-proj-research-xxxxx",
  "isPrimary": true,
  "rateLimitPerMinute": 100,
  "rateLimitPerDay": 10000,
  "costLimitDaily": 50.00,
  "costLimitMonthly": 1000.00,
  "metadata": {
    "description": "Primary OpenAI key for research",
    "owner": "research-team"
  }
}
```

**Response:**
```json
{
  "success": true,
  "key": {
    "key_id": "ai-research-research-agent-openai-1234567890",
    "project_id": "ai-research",
    "service_id": "research-agent",
    "provider": "openai",
    "is_primary": true
  }
}
```

### 5. Delete API Key

```bash
DELETE /api/v1/keys/:keyId
```

**Response:**
```json
{
  "success": true,
  "message": "API key deleted successfully"
}
```

### 6. Get Usage Statistics

```bash
GET /api/v1/keys/services/:serviceId/usage?days=30
```

**Response:**
```json
{
  "usage": [
    {
      "provider": "openai",
      "total_requests": 1234,
      "total_success": 1200,
      "total_errors": 34,
      "total_tokens": 567890,
      "total_cost": 45.67
    }
  ]
}
```

### 7. Create Project

```bash
POST /api/v1/keys/projects
```

**Request Body:**
```json
{
  "projectId": "ai-research",
  "name": "AI Research",
  "description": "AI research and analysis services"
}
```

### 8. Create Service

```bash
POST /api/v1/keys/projects/:projectId/services
```

**Request Body:**
```json
{
  "serviceId": "research-agent",
  "name": "Research Agent",
  "description": "AI research agent"
}
```

---

## Request Flow

### Step-by-Step Process

1. **Client makes request** with `X-Service-ID` header
2. **AI Gateway receives request** on port 8777
3. **Gateway looks up service** → finds project
4. **Gateway queries API key** for service+provider combination
5. **Gateway decrypts API key** from secure storage
6. **Gateway makes upstream request** to AI provider with decrypted key
7. **Gateway records usage** for billing/analytics
8. **Gateway returns response** to client

### Example Flow

```
Client (research-agent)
  │
  ├─ POST /api/v1/chat/completions
  │  Headers: X-Service-ID: research-agent
  │  Body: {"model": "gpt-4", "messages": [...]}
  │
  ▼
AI Gateway (Port 8777)
  │
  ├─ Lookup: service_id=research-agent, provider=openai
  ├─ Find Key: project=ai-research, is_primary=true
  ├─ Decrypt: sk-proj-research-xxxxx
  │
  ▼
OpenAI API
  │
  ├─ Request with: Authorization: Bearer sk-proj-research-xxxxx
  ├─ Response: {...}
  │
  ▼
AI Gateway
  │
  ├─ Record usage: service=research-agent, tokens=456, cost=$0.02
  ├─ Return response to client
  │
  ▼
Client receives response
```

---

## Dashboard UI

### Project View

```
┌─────────────────────────────────────────────────────────┐
│ Projects                                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📁 AI Research                                         │
│     2 services • 4 API keys • $125.43 this month        │
│     [Manage Services] [View Usage]                      │
│                                                         │
│  📁 Podcast Studio                                      │
│     1 service • 2 API keys • $45.67 this month          │
│     [Manage Services] [View Usage]                      │
│                                                         │
│  [+ Create Project]                                     │
└─────────────────────────────────────────────────────────┘
```

### Service View (within a project)

```
┌─────────────────────────────────────────────────────────┐
│ AI Research → Services                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔧 research-agent                                      │
│     ✓ OpenAI (Primary) • Rate Limit: 100/min          │
│     ✓ Google Gemini (Primary) • Rate Limit: 60/min    │
│     [Manage Keys] [View Usage]                          │
│                                                         │
│  🔧 summary-generator                                   │
│     ✓ OpenAI (Primary) • Rate Limit: 50/min           │
│     ✓ Anthropic (Primary) • Cost Limit: $10/day       │
│     [Manage Keys] [View Usage]                          │
│                                                         │
│  [+ Add Service]                                        │
└─────────────────────────────────────────────────────────┘
```

### API Keys View (within a service)

```
┌─────────────────────────────────────────────────────────┐
│ AI Research → research-agent → API Keys                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  OpenAI                                                 │
│  ├─ Primary Key: sk-proj-...xxxxx                      │
│  │   Status: ✓ Valid • Last used: 2 hours ago         │
│  │   Limits: 100 req/min • $50/day                     │
│  │   Usage: 1,234 requests • $12.34 today              │
│  │   [Edit] [Rotate] [Delete]                          │
│  │                                                     │
│  └─ Backup Key: sk-proj-...yyyyy                       │
│      Status: ✓ Valid • Never used                      │
│      [Set as Primary] [Delete]                          │
│                                                         │
│  Google Gemini                                          │
│  └─ Primary Key: AIza...xxxxx                          │
│      Status: ✓ Valid • Last used: 15 min ago           │
│      Limits: 60 req/min • No cost limit                 │
│      Usage: 567 requests • $0.00 today (free tier)     │
│      [Edit] [Delete]                                    │
│                                                         │
│  [+ Add Provider Key]                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Migration Guide

### Existing Single-Tenant Setup

If you have existing API keys configured globally:

```javascript
// OLD WAY (environment variables)
OPENAI_API_KEY=sk-xxxxx
GOOGLE_API_KEY=AIza-yyyyy
```

**Migration Steps:**

1. **Create default project:**
   ```bash
   curl -X POST http://localhost:7777/api/v1/keys/projects \
     -H "X-API-Key: ai-gateway-api-key-2024" \
     -H "X-Admin-Key: ai-gateway-admin-key-2024" \
     -d '{"projectId": "default", "name": "Default Project"}'
   ```

2. **Create default service:**
   ```bash
   curl -X POST http://localhost:7777/api/v1/keys/projects/default/services \
     -H "X-API-Key: ai-gateway-api-key-2024" \
     -H "X-Admin-Key: ai-gateway-admin-key-2024" \
     -d '{"serviceId": "default-service", "name": "Default Service"}'
   ```

3. **Import existing keys:**
   ```bash
   # OpenAI
   curl -X POST http://localhost:7777/api/v1/keys/services/default-service/keys \
     -H "X-API-Key: ai-gateway-api-key-2024" \
     -H "X-Admin-Key: ai-gateway-admin-key-2024" \
     -d '{"provider": "openai", "apiKey": "sk-xxxxx", "isPrimary": true}'
   
   # Google
   curl -X POST http://localhost:7777/api/v1/keys/services/default-service/keys \
     -H "X-API-Key: ai-gateway-api-key-2024" \
     -H "X-Admin-Key: ai-gateway-admin-key-2024" \
     -d '{"provider": "google", "apiKey": "AIza-yyyyy", "isPrimary": true}'
   ```

### New Multi-Tenant Setup

For new deployments with multiple projects:

```bash
# 1. Create AI Research project
curl -X POST http://localhost:7777/api/v1/keys/projects \
  -d '{"projectId": "ai-research", "name": "AI Research", "description": "Research services"}'

# 2. Create research-agent service
curl -X POST http://localhost:7777/api/v1/keys/projects/ai-research/services \
  -d '{"serviceId": "research-agent", "name": "Research Agent"}'

# 3. Add OpenAI key
curl -X POST http://localhost:7777/api/v1/keys/services/research-agent/keys \
  -d '{"provider": "openai", "apiKey": "sk-proj-research-xxxxx", "isPrimary": true}'

# 4. Add Gemini key
curl -X POST http://localhost:7777/api/v1/keys/services/research-agent/keys \
  -d '{"provider": "google", "apiKey": "AIza-research-yyyyy", "isPrimary": true}'

# Repeat for Podcast Studio project...
```

---

## Cost Tracking & Analytics

### Per-Service Costs

```sql
-- Get cost by service for the last 30 days
SELECT 
  s.name as service_name,
  u.provider,
  SUM(u.cost_usd) as total_cost,
  SUM(u.request_count) as total_requests,
  SUM(u.total_tokens) as total_tokens
FROM api_key_usage_multi_tenant u
JOIN services s ON u.service_id = s.service_id
WHERE u.usage_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY s.name, u.provider
ORDER BY total_cost DESC;
```

### Per-Project Costs

```sql
-- Get cost by project
SELECT 
  p.name as project_name,
  SUM(u.cost_usd) as total_cost,
  SUM(u.request_count) as total_requests
FROM api_key_usage_multi_tenant u
JOIN projects p ON u.project_id = p.project_id
WHERE u.usage_date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY p.name
ORDER BY total_cost DESC;
```

---

## Security Features

### Encryption

- API keys encrypted with AES-256-CBC
- Unique encryption key per AI Gateway instance
- Keys never stored in plaintext
- Keys never logged or exposed in responses

### Access Control

- Admin-only key management endpoints
- Service-level isolation
- Project-level isolation
- Audit trail for all key operations

### Rate Limiting

- Per-key rate limits (requests/minute, requests/day)
- Cost limits (daily, monthly)
- Automatic enforcement by AI Gateway
- Alerts when approaching limits

---

## Troubleshooting

### No API Key Found

**Error:** `No API key found for service: research-agent, provider: openai`

**Solutions:**
1. Verify service exists:
   ```bash
   curl http://localhost:7777/api/v1/keys/services
   ```

2. Check if key is configured:
   ```bash
   curl http://localhost:7777/api/v1/keys/services/research-agent/keys
   ```

3. Ensure key is set as primary and active

### Request Missing Service Context

**Error:** `Service ID required for multi-tenant key management`

**Solutions:**
1. Add `X-Service-ID` header to request
2. Or add `_context.serviceId` in JSON body

### Permission Denied

**Error:** `Admin access required`

**Solutions:**
1. Ensure you're using admin API key
2. Add `X-Admin-Key` header
3. Verify admin key is correct

---

## Future Enhancements

- [ ] Automatic key rotation
- [ ] Budget alerts via email/webhook
- [ ] Key expiration dates
- [ ] Multi-region key support
- [ ] Key usage forecasting
- [ ] Advanced analytics dashboard
- [ ] API key templates
- [ ] Bulk import/export

---

**Version:** 1.0.0  
**Date:** October 23, 2025  
**Status:** Production Ready  
**Database:** Unified AI Homelab Database (ai_gateway_db)
