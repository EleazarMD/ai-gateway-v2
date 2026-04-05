# AI Gateway v2.2

A high-performance AI inference gateway with multi-provider support, intelligent routing, TTS capabilities, and PostgreSQL-based persistence for enterprise AI applications.

## 📚 Documentation

**📖 Complete Technical Reference (SINGLE SOURCE OF TRUTH):**  
**[Chapter 2: AI Gateway](/Users/eleazar/Projects/AIHomelab/docs/technical-reference/chapters/02_AI_GATEWAY.md)**

This document contains:
- API endpoints and request formats
- Provider implementation details
- **Streaming responses & tool calls** ✅ NEW
- Database schema and queries
- Troubleshooting guides
- Configuration examples

**All scattered markdown files have been archived.** The Technical Reference is now the authoritative documentation.

---

## 🚀 Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google Gemini, OpenAI-OSS (Ollama)
- **Text-to-Speech (TTS)**: Model-agnostic Gemini TTS endpoint with full parameter pass-through (v2.2.0)
- **Enhanced Configuration Service**: PostgreSQL-only mode with full persistence
- **Agent Configuration Routing**: Per-agent model preferences and routing configuration (v2.1.0)
- **Intelligent Routing**: Cost optimization, performance-based selection, custom fallback chains
- **Conversation History**: Complete request/response persistence and analytics
- **Real-time Configuration**: Dynamic provider management without restarts
- **Dashboard Integration**: Native web interface for configuration and monitoring
- **Enterprise Security**: API key management, rate limiting, audit logging
- **Kubernetes Ready**: Production deployment with k3d and persistent storage

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI GATEWAY v2.0 ARCHITECTURE                 │
│                                                                 │
│  ┌─────────────────┐           ┌─────────────────┐              │
│  │   CLIENT        │           │   DASHBOARD     │              │
│  │ APPLICATIONS    │◄─────────►│   INTERFACE     │              │
│  │  (Port 8777)    │           │  (Port 8404)    │              │
│  └─────────────────┘           └─────────────────┘              │
│           │                             │                       │
│           ▼                             ▼                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                AI GATEWAY CORE                          │   │
│  │  ┌─────────────────┐  ┌─────────────────┐              │   │
│  │  │   PROVIDER      │  │   ENHANCED      │              │   │
│  │  │   MANAGER       │  │ CONFIGURATION   │              │   │
│  │  │                 │  │    SERVICE      │              │   │
│  │  └─────────────────┘  └─────────────────┘              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                 │
│                              ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              PERSISTENCE LAYER                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │ IN-MEMORY   │  │    REDIS    │  │   POSTGRESQL    │  │   │
│  │  │   CACHE     │◄►│   CACHE     │◄►│ (Authoritative) │  │   │
│  │  │(Fast Read)  │  │ (Pub/Sub)   │  │   Persistence   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

### System Requirements
- **Docker**: Version 20.10+
- **k3d**: Version 5.4+
- **kubectl**: Version 1.24+
- **Node.js**: Version 18+ (for local development)

### Infrastructure Dependencies
- **PostgreSQL**: Centralized database at `host.k3d.internal:5432`
- **Kubernetes**: k3d cluster with proper port mappings
- **Persistent Storage**: For configuration and conversation history

## 🚀 Quick Start

### 1. Cluster Setup

```bash
# Create k3d cluster with dual-port architecture
k3d cluster create ai-homelab-unified \
  --port "7777:7777@loadbalancer" \
  --port "8777:8777@loadbalancer" \
  --agents 2

# Verify cluster
kubectl cluster-info
```

### 2. Build and Deploy

```bash
# Navigate to AI Gateway directory
cd /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2

# Build Docker image
docker build -t ai-gateway-v2:latest .

# Import image to k3d
k3d image import ai-gateway-v2:latest -c ai-homelab-unified

# Deploy to cluster
kubectl apply -f k3d-dual-port-deployment.yaml
```

### 3. Verify Deployment

```bash
# Check pod status
kubectl get pods

# Test health endpoint
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health
```

## 🔧 Configuration

### Environment Variables

```bash
# Database Configuration (Required)
POSTGRES_HOST=host.k3d.internal
POSTGRES_PORT=5432
POSTGRES_DB=ai_gateway
POSTGRES_USER=ai_gateway
POSTGRES_PASSWORD=ai_gateway_secure_2024

# Service Configuration
API_KEY=ai-gateway-api-key-2024
ADMIN_API_KEY=ai-gateway-admin-key-2024
NODE_ENV=production

# Enhanced Configuration Service
ENABLE_ENHANCED_CONFIG=true
CONFIG_PERSISTENCE_ENABLED=true
CONFIG_VERSION_CONTROL=true

# Redis Configuration
REDIS_HOST=redis-service
REDIS_PORT=6379

# AI Provider API Keys (Optional)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_API_KEY=your_google_key
```

### 3-Tier Hybrid Storage

The Enhanced Configuration Service operates with a 3-tier hybrid storage architecture:

- ✅ **In-Memory Cache**: Fast read access for frequently used data
- ✅ **Redis Cache**: Distributed caching and pub/sub messaging
- ✅ **PostgreSQL**: Authoritative persistent storage
- ✅ **Full Persistence**: Conversation history and configuration management
- ✅ **Version Control**: Complete configuration change tracking
- ✅ **Real-time Sync**: Redis pub/sub for configuration updates

## 📡 API Usage

### Basic Chat Completion

```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Perplexity Search with Real-time Data

```bash
curl -X POST http://localhost:8777/api/v1/perplexity/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -d '{
    "query": "Latest developments in AI education technology",
    "domain_filter": ["edu", "org"],
    "max_results": 5,
    "search_recency_filter": "month"
  }'
```

### Provider Status

```bash
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/providers/status
```

### Comprehensive Health Check

```bash
curl -H "X-API-Key: ai-gateway-api-key-2024" \
  http://localhost:8777/api/v1/health/comprehensive
```

## 🎯 Key Features

### Agent Integration Ready

- **Educational AI Agents**: Fully integrated with TEKS curriculum development agents
- **Research Workflows**: Real-time educational research through Perplexity Sonar models
- **Citation Support**: Automatic source citations and educational credibility validation
- **Multi-Modal Learning**: Support for visual, auditory, and kinesthetic learning preferences
- **Standards Alignment**: Direct integration with Texas Essential Knowledge and Skills (TEKS)

### Enhanced Configuration Service

- **Database-First Persistence**: All configurations stored in PostgreSQL
- **Conversation History**: Complete request/response audit trail
- **Version Control**: Track all configuration changes with rollback capability
- **Real-time Sync**: Live configuration updates without service restart
- **Performance Analytics**: Provider usage statistics and optimization

### Multi-Provider Support

| Provider | Models | Capabilities | Status |
|----------|--------|-------------|---------|
| OpenAI | GPT-4, GPT-3.5 | Chat, Vision, Reasoning | ✅ Active |
| Anthropic | Claude 3.5, Claude 3 | Chat, Vision, Thinking | ✅ Active |
| Google | Gemini Pro, Flash | Chat, Vision, Multimodal | ✅ Active |
| **Perplexity** | **Sonar-Pro, Sonar-Reasoning, Sonar-Deep-Research** | **Web Search, Real-time, Citations, Reasoning** | ✅ **Active** |
| OpenAI-OSS | Ollama Models | Chat, Reasoning | ✅ Active |

### Intelligent Routing

- **Cost Optimization**: Automatic selection of most cost-effective provider
- **Performance First**: Route to fastest responding provider
- **Hybrid Strategy**: Balance cost and performance
- **Custom Fallback Chains**: Agent-specific provider preferences
- **Health-Based Routing**: Avoid unhealthy providers automatically

## 📚 Documentation

- **[Enhanced Configuration Service](docs/ENHANCED_CONFIGURATION_SERVICE.md)** - Detailed service architecture and features
- **[API Reference](docs/API_REFERENCE.md)** - Complete API endpoint documentation
- **[Deployment Guide](docs/DEPLOYMENT_GUIDE.md)** - Production deployment instructions
- **[PostgreSQL-Only Mode](docs/POSTGRESQL_ONLY_MODE.md)** - Simplified architecture documentation

## 🔍 Monitoring & Health

### Health Endpoints

- `/health` - Basic service health
- `/api/v1/health/comprehensive` - Detailed system status
- `/api/v1/providers/status` - Provider connectivity status

### Key Metrics

- **Request Latency**: Response time per provider
- **Success Rate**: Percentage of successful requests
- **Provider Health**: Real-time connectivity monitoring
- **Configuration Changes**: Track all config modifications
- **Cost Analytics**: Usage and cost optimization metrics

## 🚨 Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check pod logs
kubectl logs deployment/ai-gateway-v2-dual-port

# Verify database connectivity
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "SELECT version();"
```

#### Configuration Not Persisting
```bash
# Check Enhanced Configuration Service logs
kubectl logs deployment/ai-gateway-v2-dual-port | grep "EnhancedConfigService"

# Verify database schema
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "\dt"
```

#### External Port Not Accessible
```bash
# Check k3d port mappings
k3d cluster list

# Verify LoadBalancer services
kubectl get services
```

## 🔐 Security

- **API Key Authentication**: All endpoints require valid API keys
- **Database Security**: Encrypted connections and minimal privileges
- **Rate Limiting**: Prevent API abuse
- **Audit Logging**: Complete request/response tracking
- **Kubernetes Secrets**: Secure credential management

## 🎯 Production Deployment Status

✅ **Deployed**: AI Gateway v2.0 running in `k3d-ai-homelab-unified`  
✅ **Persistent**: PostgreSQL database with full schema  
✅ **Healthy**: All health checks passing  
✅ **Accessible**: External port 8777 available for client applications  
✅ **Scalable**: 2 replicas with horizontal scaling capability  

## 📄 License

MIT License - see LICENSE file for details.

---

**Version**: 2.1.0  
**Status**: Production Ready  
**Perplexity Integration**: Complete (Sonar Models Active)  
**Agent Integration**: Validated (TEKS Workflow Ready)  
**Last Updated**: 2025-09-29
