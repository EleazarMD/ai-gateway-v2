# AI Gateway v2.1.0 API Reference

## Overview

The AI Gateway v2.1.0 provides a comprehensive REST API for managing AI providers, configurations, inference requests, and agent-specific routing configurations. All endpoints require authentication via the `X-API-Key` header.

## Authentication

All API requests must include the `X-API-Key` header:

```http
X-API-Key: ai-gateway-api-key-2024
```

For administrative operations, use the admin key:

```http
X-API-Key: ai-gateway-admin-key-2024
```

## Base URLs

- **External Access**: `http://localhost:8777` (client applications)
- **Internal Access**: `http://localhost:7777` (service mesh)

## Health & Status Endpoints

### GET /health

Returns basic service health status.

**Request:**
```http
GET /health
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-08-23T01:41:01.251Z",
  "version": "2.0.0",
  "service": "AI Gateway External",
  "uptime": 324.837984233,
  "port": "8777"
}
```

### GET /api/v1/health/comprehensive

Returns detailed health status including all services and dependencies.

**Request:**
```http
GET /api/v1/health/comprehensive
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-08-23T01:41:01.251Z",
  "version": "2.0.0",
  "services": {
    "providerManager": {
      "status": "healthy",
      "providersLoaded": 4,
      "activeProviders": 2
    },
    "enhancedConfigService": {
      "status": "healthy",
      "persistenceMode": "postgresql",
      "configurationVersion": "1.0.0",
      "lastSync": "2025-08-23T01:40:00.000Z"
    },
    "database": {
      "status": "connected",
      "type": "postgresql",
      "host": "host.k3d.internal",
      "connectionPool": {
        "active": 2,
        "idle": 3,
        "total": 5
      }
    }
  },
  "uptime": 324.837984233
}
```

## Provider Management

### GET /api/v1/providers/status

Returns the status of all configured AI providers.

**Request:**
```http
GET /api/v1/providers/status
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "openai": {
    "connected": true,
    "status": "healthy",
    "models": 8,
    "apiKeyConfigured": true,
    "lastHealthCheck": "2025-08-23T01:40:30.000Z",
    "capabilities": ["chat", "reasoning", "vision"]
  },
  "anthropic": {
    "connected": true,
    "status": "healthy",
    "models": 6,
    "apiKeyConfigured": true,
    "lastHealthCheck": "2025-08-23T01:40:30.000Z",
    "capabilities": ["chat", "reasoning", "vision", "thinking"]
  },
  "google": {
    "connected": false,
    "status": "api_key_missing",
    "models": 0,
    "apiKeyConfigured": false,
    "error": "GOOGLE_API_KEY environment variable not set"
  },
  "openai-oss": {
    "connected": true,
    "status": "healthy",
    "models": 21,
    "apiKeyConfigured": false,
    "endpoint": "http://host.k3d.internal:11434",
    "capabilities": ["chat", "reasoning"]
  }
}
```

### GET /api/v1/models

Returns all available models from active providers.

**Request:**
```http
GET /api/v1/models
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "data": [
    {
      "id": "gpt-4",
      "object": "model",
      "provider": "openai",
      "capabilities": ["chat", "reasoning", "vision"],
      "pricing": {
        "input": 0.03,
        "output": 0.06
      },
      "contextWindow": 8192,
      "maxOutputTokens": 4096
    },
    {
      "id": "claude-3-5-sonnet-20241022",
      "object": "model",
      "provider": "anthropic",
      "capabilities": ["chat", "reasoning", "vision", "thinking"],
      "pricing": {
        "input": 3.0,
        "output": 15.0
      },
      "contextWindow": 200000,
      "maxOutputTokens": 8192
    }
  ]
}
```

## Configuration Management

### GET /api/v1/config/routing

Returns current routing configuration.

**Request:**
```http
GET /api/v1/config/routing
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "strategy": "hybrid",
  "costOptimization": true,
  "performanceThreshold": 2000,
  "fallbackEnabled": true,
  "maxRetries": 3,
  "routingRules": [
    {
      "condition": "agent_id == 'tripcraft'",
      "provider": "openai",
      "priority": 1
    }
  ]
}
```

### PUT /api/v1/config/routing

Updates routing configuration.

**Request:**
```http
PUT /api/v1/config/routing
X-API-Key: ai-gateway-admin-key-2024
Content-Type: application/json

{
  "strategy": "cost_optimized",
  "costOptimization": true,
  "performanceThreshold": 3000,
  "fallbackEnabled": true,
  "maxRetries": 2
}
```

**Response:**
```json
{
  "success": true,
  "message": "Routing configuration updated",
  "version": "1.1.0",
  "appliedAt": "2025-08-23T01:45:00.000Z"
}
```

### GET /api/v1/config/fallback

Returns current fallback chain configuration.

**Request:**
```http
GET /api/v1/config/fallback
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "defaultChain": ["openai", "anthropic", "openai-oss"],
  "customChains": {
    "tripcraft_travel_chain": ["openai", "google", "anthropic"],
    "internal_cost_chain": ["openai-oss", "anthropic"]
  },
  "retryPolicy": {
    "maxRetries": 3,
    "backoffMultiplier": 2,
    "initialDelay": 1000
  }
}
```

### PUT /api/v1/config/fallback/chains

Creates or updates a custom fallback chain.

**Request:**
```http
PUT /api/v1/config/fallback/chains
X-API-Key: ai-gateway-admin-key-2024
Content-Type: application/json

{
  "chainName": "healthcare_chain",
  "providers": ["anthropic", "openai", "google"],
  "description": "Healthcare-optimized provider chain"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Fallback chain 'healthcare_chain' created",
  "chainName": "healthcare_chain",
  "providers": ["anthropic", "openai", "google"]
}
```

## AI Inference

### POST /api/v1/chat/completions

Performs AI inference using the configured routing strategy.

**Request:**
```http
POST /api/v1/chat/completions
X-API-Key: ai-gateway-api-key-2024
X-Agent-ID: tripcraft
Content-Type: application/json

{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "Plan a 3-day itinerary for Mexico City"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Response:**
```json
{
  "id": "chatcmpl-123456",
  "object": "chat.completion",
  "created": 1692901234,
  "model": "gpt-4",
  "provider": "openai",
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 250,
    "total_tokens": 265
  },
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Here's a 3-day Mexico City itinerary..."
      },
      "finish_reason": "stop"
    }
  ],
  "routing_info": {
    "strategy": "agent_preference",
    "selected_provider": "openai",
    "fallback_used": false,
    "response_time_ms": 1250
  }
}
```

### POST /api/v1/chat/completions/stream

Streaming AI inference endpoint.

**Request:**
```http
POST /api/v1/chat/completions/stream
X-API-Key: ai-gateway-api-key-2024
Content-Type: application/json

{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "Explain quantum computing"
    }
  ],
  "stream": true
}
```

**Response (Server-Sent Events):**
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Quantum"}}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" computing"}}]}

data: [DONE]
```

## Analytics

### GET /api/v1/analytics/routing

Returns routing analytics and performance metrics.

**Request:**
```http
GET /api/v1/analytics/routing
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "timeframe": "24h",
  "totalRequests": 1250,
  "providers": {
    "openai": {
      "requests": 750,
      "successRate": 98.5,
      "avgLatency": 1200,
      "totalCost": 15.75
    },
    "anthropic": {
      "requests": 300,
      "successRate": 99.2,
      "avgLatency": 1800,
      "totalCost": 12.45
    },
    "openai-oss": {
      "requests": 200,
      "successRate": 95.0,
      "avgLatency": 2200,
      "totalCost": 0.00
    }
  },
  "routingStrategies": {
    "cost_optimized": 45,
    "performance_first": 30,
    "hybrid": 25
  },
  "fallbackUsage": {
    "triggered": 25,
    "successful": 23,
    "failed": 2
  }
}
```

### GET /api/v1/analytics/fallback

Returns fallback chain analytics.

**Request:**
```http
GET /api/v1/analytics/fallback
X-API-Key: ai-gateway-api-key-2024
```

**Response:**
```json
{
  "timeframe": "24h",
  "totalFallbacks": 25,
  "chains": {
    "default": {
      "triggered": 15,
      "successful": 14,
      "avgFallbackTime": 2500
    },
    "tripcraft_travel_chain": {
      "triggered": 10,
      "successful": 9,
      "avgFallbackTime": 1800
    }
  },
  "failureReasons": {
    "timeout": 12,
    "rate_limit": 8,
    "api_error": 3,
    "network_error": 2
  }
}
```

## Administrative Endpoints

### POST /api/v1/admin/providers/reload

Reloads provider configurations from database.

**Request:**
```http
POST /api/v1/admin/providers/reload
X-API-Key: ai-gateway-admin-key-2024
```

**Response:**
```json
{
  "success": true,
  "message": "Providers reloaded successfully",
  "providersLoaded": 4,
  "timestamp": "2025-08-23T01:50:00.000Z"
}
```

### POST /api/v1/admin/config/backup

Creates a backup of current configuration.

**Request:**
```http
POST /api/v1/admin/config/backup
X-API-Key: ai-gateway-admin-key-2024
```

**Response:**
```json
{
  "success": true,
  "backupId": "backup_20250823_015000",
  "timestamp": "2025-08-23T01:50:00.000Z",
  "size": "2.5KB"
}
```

### POST /api/v1/admin/config/restore

Restores configuration from backup.

**Request:**
```http
POST /api/v1/admin/config/restore
X-API-Key: ai-gateway-admin-key-2024
Content-Type: application/json

{
  "backupId": "backup_20250823_015000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration restored from backup",
  "backupId": "backup_20250823_015000",
  "restoredAt": "2025-08-23T01:52:00.000Z"
}
```

## WebSocket Endpoints

### /ws/dashboard

WebSocket endpoint for real-time dashboard updates.

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:8777/ws/dashboard');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'auth',
    apiKey: 'ai-gateway-api-key-2024'
  }));
};
```

**Message Types:**
- `provider_status_update`: Real-time provider status changes
- `configuration_change`: Configuration updates
- `request_metrics`: Live request statistics
- `health_status`: Service health updates

## Error Responses

### Standard Error Format

```json
{
  "error": {
    "code": "INVALID_API_KEY",
    "message": "Invalid or missing API key",
    "details": "The X-API-Key header is required for all requests",
    "timestamp": "2025-08-23T01:45:00.000Z"
  }
}
```

### Common Error Codes

- `INVALID_API_KEY`: Missing or invalid API key
- `PROVIDER_UNAVAILABLE`: Requested provider is not available
- `CONFIGURATION_ERROR`: Invalid configuration data
- `RATE_LIMIT_EXCEEDED`: Request rate limit exceeded
- `INTERNAL_ERROR`: Internal server error
- `DATABASE_ERROR`: Database connection or query error
- `VALIDATION_ERROR`: Request validation failed

## Rate Limiting

### Default Limits

- **Standard API Key**: 1000 requests/hour
- **Admin API Key**: 10000 requests/hour
- **Per-endpoint limits**: Vary by endpoint complexity

### Rate Limit Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1692905400
```

## Agent Configuration Endpoints (v2.1.0)

### POST /api/agent/configure

Configure agent-specific model routing and preferences. This endpoint allows external systems (like Dashboard Agents Database) to notify the AI Gateway of agent configuration changes.

**Request:**
```http
POST /api/agent/configure
Host: localhost:8777
X-API-Key: ai-gateway-api-key-2024
X-Source: dashboard-agents-database
Content-Type: application/json

{
  "type": "agent:configuration:changed",
  "agentId": "dashboard-ai-assistant-dashai",
  "configuration": {
    "model": "mistral:latest",
    "temperature": 0.7,
    "maxTokens": 2000,
    "topP": 0.95,
    "topK": 40,
    "thinkingBudget": 10000,
    "safetyEnabled": true,
    "safetySettings": [],
    "streamingEnabled": true,
    "voiceEnabled": true,
    "isActive": true,
    "lastUpdated": "2025-09-28T21:29:29.000Z",
    "ecosystem": {
      "routing": {
        "priority": "high",
        "loadBalancing": false,
        "fallbackModels": ["llama3.2:3b", "gemini-1.5-flash"]
      }
    }
  },
  "changedFields": ["model", "temperature", "maxTokens"],
  "source": "dashboard_agents_database",
  "timestamp": "2025-09-28T21:29:29.000Z",
  "metadata": {
    "agentName": "Dashboard AI Assistant Agent (DashAI)",
    "projectId": "ai-homelab-dashboard"
  }
}
```

**Response:**
```json
{
  "success": true,
  "agentId": "dashboard-ai-assistant-dashai",
  "routingConfigured": true,
  "priority": "high",
  "primaryModel": "mistral:latest",
  "fallbackModels": ["llama3.2:3b", "gemini-1.5-flash"],
  "timestamp": "2025-09-28T21:29:29.000Z",
  "message": "Agent routing configuration updated successfully"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Invalid agent configuration",
  "details": "Missing required field: model",
  "agentId": "dashboard-ai-assistant-dashai"
}
```

## Request/Response Examples

### Complete Chat Completion Example

**Request:**
```http
POST /api/v1/chat/completions
Host: localhost:8777
X-API-Key: ai-gateway-api-key-2024
X-Agent-ID: healthcare-assistant
Content-Type: application/json

{
  "model": "claude-3-5-sonnet-20241022",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful medical information assistant."
    },
    {
      "role": "user",
      "content": "What are the symptoms of type 2 diabetes?"
    }
  ],
  "temperature": 0.3,
  "max_tokens": 500
}
```

**Response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999

{
  "id": "chatcmpl-healthcare-123456",
  "object": "chat.completion",
  "created": 1692901234,
  "model": "claude-3-5-sonnet-20241022",
  "provider": "anthropic",
  "usage": {
    "prompt_tokens": 45,
    "completion_tokens": 180,
    "total_tokens": 225
  },
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Type 2 diabetes symptoms often develop gradually and may include:\n\n1. **Increased thirst and frequent urination**\n2. **Increased hunger**\n3. **Unintended weight loss**\n4. **Fatigue**\n5. **Blurred vision**\n6. **Slow-healing sores**\n7. **Frequent infections**\n\nMany people with type 2 diabetes have no symptoms initially. It's important to consult healthcare professionals for proper diagnosis and treatment."
      },
      "finish_reason": "stop"
    }
  ],
  "routing_info": {
    "strategy": "agent_preference",
    "selected_provider": "anthropic",
    "fallback_used": false,
    "response_time_ms": 1850,
    "cost_usd": 0.0405
  }
}
```

---

**Version**: 2.1.0  
**Last Updated**: 2025-09-28  
**Authentication**: API Key Required
