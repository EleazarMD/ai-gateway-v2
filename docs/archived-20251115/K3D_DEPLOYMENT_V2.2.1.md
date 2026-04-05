# AI Gateway v2.2.1 - K3D Deployment Guide

## Overview
This guide covers deployment of AI Gateway v2.2.1 with multi-tenant API key management and Google Gemini provider support.

## Prerequisites
- K3D cluster running (`ai-gateway-ecosystem`)
- Provider API keys (OpenAI, Google, Anthropic)
- AI Inferencing Service running on port 9000 (optional)
- Docker and kubectl installed

## Quick Start

### Step 1: Set Provider API Keys

```bash
# Export your API keys (get these from provider dashboards)
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="AIza..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Step 2: Create Kubernetes Secrets

```bash
# Create ai-gateway-secrets with provider API keys
kubectl create secret generic ai-gateway-secrets \
  --from-literal=api-key=ai-gateway-api-key-2024 \
  --from-literal=admin-api-key=ai-gateway-admin-key-2024 \
  --from-literal=openai-api-key="$OPENAI_API_KEY" \
  --from-literal=google-api-key="$GOOGLE_API_KEY" \
  --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY" \
  --from-literal=perplexity-api-key="" \
  --dry-run=client -o yaml | kubectl apply -n ai-homelab-unified -f -

# Verify secret creation
kubectl get secret ai-gateway-secrets -n ai-homelab-unified
```

### Step 3: Build and Deploy

```bash
cd /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2

# Build Docker image
docker build -t ai-gateway:v2.2.1 .

# Import to k3d cluster
k3d image import ai-gateway:v2.2.1 -c ai-gateway-ecosystem

# Update deployment to use new image
kubectl set image deployment/ai-gateway \
  ai-gateway=ai-gateway:v2.2.1 \
  -n ai-homelab-unified

# Wait for rollout
kubectl rollout status deployment/ai-gateway -n ai-homelab-unified --timeout=120s
```

### Step 4: Verify Deployment

```bash
# Check pod status
kubectl get pods -n ai-homelab-unified -l app=ai-gateway

# Check logs for provider initialization
kubectl logs -n ai-homelab-unified deployment/ai-gateway --tail=100 | \
  grep -E "Provider|google|Configuration applied"

# Expected output:
# [Google Provider] Connection validated, found 50 models
# ✅ Provider Manager initialized with providers: [ 'google' ]
```

## Testing

### Health Check

```bash
curl -s http://localhost:8777/health | jq
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "AI Gateway External",
  "version": "2.2.0"
}
```

### List Available Models

```bash
curl -s http://localhost:8777/api/v1/models \
  -H "X-API-Key: ai-gateway-api-key-2024" | jq '.data[] | .id' | head -10
```

**Expected Output:**
```
"gemini-2-5-pro"
"gemini-2-5-flash"
"gemini-2-0-flash"
"gemini-1-5-pro"
...
```

### Test Chat Completion

```bash
curl -s -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -d '{
    "model": "gemini-2-0-flash",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }' | jq '.choices[0].message.content'
```

**Expected:** AI-generated response

## Configuration Reference

### Environment Variables

The deployment includes these critical environment variables:

```yaml
# AI Inferencing Service Integration
- name: AI_INFERENCING_URL
  value: "http://host.k3d.internal:9000"
- name: AI_INFERENCING_API_KEY
  value: "ai-inferencing-admin-key-2024"
- name: ENABLE_AI_INFERENCING
  value: "true"

# Provider API Keys (from secrets)
- name: OPENAI_API_KEY
  valueFrom:
    secretKeyRef:
      name: ai-gateway-secrets
      key: openai-api-key
      optional: true

- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: ai-gateway-secrets
      key: anthropic-api-key
      optional: true

- name: GOOGLE_API_KEY
  valueFrom:
    secretKeyRef:
      name: ai-gateway-secrets
      key: google-api-key
      optional: true
```

### Port Configuration

- **8777**: External API (Dashboard, agents, public access)
- **7777**: Internal API (WebSocket, admin operations)
- **Host Access**: Via k3d port mapping to localhost

### Resource Limits

```yaml
resources:
  requests:
    cpu: "200m"
    memory: "256Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

## Troubleshooting

### Issue: "No available providers for this request"

**Cause:** Provider API keys not configured or invalid

**Solution:**
```bash
# 1. Verify secret exists
kubectl get secret ai-gateway-secrets -n ai-homelab-unified -o yaml

# 2. Check secret has keys
kubectl get secret ai-gateway-secrets -n ai-homelab-unified -o json | \
  jq '.data | keys'

# 3. Check logs for provider loading
kubectl logs -n ai-homelab-unified deployment/ai-gateway --tail=200 | \
  grep -E "Provider|Failed|Error"

# 4. Recreate secret with valid API keys
kubectl delete secret ai-gateway-secrets -n ai-homelab-unified
# Then run Step 2 again with valid keys
```

### Issue: Model Not Found (e.g., "gemini-2.0-flash-exp")

**Cause:** Model ID format mismatch

**Solution:** Use hyphenated format without experimental suffix
```bash
# Wrong: gemini-2.0-flash-exp
# Correct: gemini-2-0-flash

# List available models
curl -s http://localhost:8777/api/v1/models | jq '.data[] | .id'
```

### Issue: Anthropic Provider Fails

**Known Issue:** Intermittent `validateConnection` method error

**Workaround:** Use Google or OpenAI providers instead
```bash
# Check which providers are loaded
kubectl logs -n ai-homelab-unified deployment/ai-gateway --tail=100 | \
  grep "Provider.*loaded successfully"
```

### Issue: Pod CrashLoopBackOff

**Solution:**
```bash
# Check pod logs
kubectl logs -n ai-homelab-unified -l app=ai-gateway --tail=100

# Common causes:
# - Missing secrets
# - Invalid API keys
# - Port conflicts

# Restart deployment
kubectl rollout restart deployment/ai-gateway -n ai-homelab-unified
```

## Dashboard AI Agent Integration

### Configuration

Dashboard AI Agent connects to AI Gateway on port 8405:

```javascript
// Agent configuration
{
  "model": "gemini-2-0-flash",  // Use hyphenated format
  "endpoint": "http://localhost:8777/api/v1/chat/completions",
  "apiKey": "ai-gateway-api-key-2024"
}
```

### Testing Dashboard Connection

```bash
# Test A2A message to Dashboard AI Agent
curl -s -X POST http://localhost:8405/a2a/message \
  -H "Content-Type: application/json" \
  -d '{
    "type":"user_query",
    "payload":{
      "query":"Hello world",
      "sessionId":"test-123",
      "userId":"test-user"
    },
    "requestId":"test-456",
    "sender":"test"
  }' | jq '.response.response'
```

**Expected:** AI-generated greeting response

## Maintenance

### Updating to Newer Version

```bash
# 1. Build new version
docker build -t ai-gateway:v2.2.2 .

# 2. Import to k3d
k3d image import ai-gateway:v2.2.2 -c ai-gateway-ecosystem

# 3. Update deployment
kubectl set image deployment/ai-gateway \
  ai-gateway=ai-gateway:v2.2.2 \
  -n ai-homelab-unified

# 4. Monitor rollout
kubectl rollout status deployment/ai-gateway -n ai-homelab-unified
```

### Viewing Logs

```bash
# Real-time logs
kubectl logs -n ai-homelab-unified deployment/ai-gateway -f

# Last 200 lines
kubectl logs -n ai-homelab-unified deployment/ai-gateway --tail=200

# Filter for errors
kubectl logs -n ai-homelab-unified deployment/ai-gateway --tail=500 | \
  grep -i "error\|failed\|warn"
```

### Backup Configuration

```bash
# Export current deployment
kubectl get deployment ai-gateway -n ai-homelab-unified -o yaml > \
  ai-gateway-deployment-backup-$(date +%Y%m%d).yaml

# Export secrets (base64 encoded)
kubectl get secret ai-gateway-secrets -n ai-homelab-unified -o yaml > \
  ai-gateway-secrets-backup-$(date +%Y%m%d).yaml
```

## Version History

- **v2.2.1** (2025-10-26): Multi-tenant API keys, Kubernetes secrets, Google provider fix
- **v2.2.0** (2025-10-22): Model-agnostic TTS endpoint
- **v2.1.0**: Initial TTS support  
- **v2.0.0**: Dual-port architecture baseline

## Related Documentation

- `CHANGELOG.md` - Full version history and changes
- `MULTI_TENANT_API_KEYS.md` - API key management architecture
- `DASHBOARD_READY.md` - Dashboard integration guide
- `K3D_DEPLOYMENT_GUIDE.md` - Legacy deployment guide (pre-v2.2.1)
