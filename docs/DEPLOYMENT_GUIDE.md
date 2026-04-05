# AI Gateway v2.0 Deployment Guide

## Overview

This guide covers the complete deployment of AI Gateway v2.0 with Enhanced Configuration Service in the AI Homelab ecosystem using k3d Kubernetes.

## Prerequisites

### System Requirements
- **Docker**: Version 20.10+
- **k3d**: Version 5.4+
- **kubectl**: Version 1.24+
- **Node.js**: Version 18+ (for local development)

### Infrastructure Dependencies
- **PostgreSQL@14**: Uses existing unified ecosystem database (`ai_gateway_db`)
- **Ollama**: Local AI models at `localhost:11434` 
- **Persistent Storage**: For configuration and conversation history

**IMPORTANT**: AI Gateway connects to the host PostgreSQL database - it does NOT deploy its own database instance.

## Quick Start

### 1. Cluster Setup

Create the k3d cluster with proper port mappings:

```bash
# Create cluster with dual-port architecture
k3d cluster create ai-homelab-unified \
  --port "7777:7777@loadbalancer" \
  --port "8777:8777@loadbalancer" \
  --agents 2

# Verify cluster is running
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

# Check services
kubectl get services

# Test health endpoint
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health
```

## Detailed Deployment

### Database Configuration

The AI Gateway connects to the existing unified PostgreSQL@14 database (`ai_gateway_db`). The database schema is automatically created on first startup:

```sql
-- Tables are created automatically in the ai_gateway_db database
-- No manual database setup required - uses existing ecosystem database
```

### Environment Variables

Required environment variables for the deployment:

```yaml
env:
  # Database Configuration (Connects to Host PostgreSQL@14)
  - name: DATABASE_HOST
    value: "host.k3d.internal"
  - name: DATABASE_PORT
    value: "5432"
  - name: DATABASE_NAME
    value: "ai_gateway_db"
  - name: DATABASE_USER
    value: "eleazar"
  - name: DATABASE_PASSWORD
    value: ""
  
  # Redis Configuration
  - name: REDIS_HOST
    value: "redis-service"
  - name: REDIS_PORT
    value: "6379"
  
  # Service Configuration
  - name: API_KEY
    value: "ai-gateway-api-key-2024"
  - name: ADMIN_API_KEY
    value: "ai-gateway-admin-key-2024"
  - name: NODE_ENV
    value: "development"
  
  # Enhanced Configuration Service
  - name: ENABLE_ENHANCED_CONFIG
    value: "true"
  - name: CONFIG_PERSISTENCE_ENABLED
    value: "true"
  - name: CONFIG_VERSION_CONTROL
    value: "true"
```

### Kubernetes Manifests

#### Deployment Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-gateway-v2-dual-port
  labels:
    app: ai-gateway-v2
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ai-gateway-v2
  template:
    metadata:
      labels:
        app: ai-gateway-v2
    spec:
      containers:
      - name: ai-gateway
        image: ai-gateway-v2:latest
        ports:
        - containerPort: 7777
          name: internal
        - containerPort: 8777
          name: external
        env:
        # Environment variables as listed above
        livenessProbe:
          httpGet:
            path: /health
            port: 8777
            httpHeaders:
            - name: X-API-Key
              value: "ai-gateway-api-key-2024"
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8777
            httpHeaders:
            - name: X-API-Key
              value: "ai-gateway-api-key-2024"
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### Service Configuration

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: ai-gateway-internal
spec:
  type: LoadBalancer
  ports:
  - port: 7777
    targetPort: 7777
    name: internal
  selector:
    app: ai-gateway-v2

---
apiVersion: v1
kind: Service
metadata:
  name: ai-gateway-external
spec:
  type: LoadBalancer
  ports:
  - port: 8777
    targetPort: 8777
    name: external
  selector:
    app: ai-gateway-v2
```

## Architecture Overview

### Port Configuration

Following the AI Homelab PORT_REGISTRY.yml:

- **Port 7777**: Internal service mesh communication
- **Port 8777**: External client access for AI inference
- **Port 5432**: PostgreSQL database (ecosystem-wide)
- **Port 6379**: Redis cache (optional)

### Service Architecture

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

## Configuration Management

### Enhanced Configuration Service Features

1. **Database-First Persistence**: All configurations stored in PostgreSQL
2. **Version Control**: Complete history of configuration changes
3. **Real-time Sync**: Live configuration updates without restart
4. **Fallback Chains**: Automatic provider failover
5. **Analytics Integration**: Usage tracking and performance metrics

### Configuration Loading Order

1. **PostgreSQL Database**: Primary configuration source
2. **Environment Variables**: Override specific settings
3. **Default Configuration**: Fallback for missing settings

### Provider Configuration Example

```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "type": "openai",
      "enabled": true,
      "priority": 1,
      "endpoint": "https://api.openai.com/v1",
      "models": ["gpt-4", "gpt-3.5-turbo"],
      "capabilities": ["chat", "reasoning", "vision"],
      "pricing": {
        "input": 0.03,
        "output": 0.06
      }
    }
  ],
  "routing": {
    "strategy": "hybrid",
    "costOptimization": true,
    "fallbackEnabled": true
  }
}
```

## Monitoring and Health Checks

### Health Endpoints

```bash
# Basic health check
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health

# Comprehensive health status
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/health/comprehensive

# Provider status
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/providers/status
```

### Log Monitoring

```bash
# View AI Gateway logs
kubectl logs -f deployment/ai-gateway-v2-dual-port

# View Enhanced Configuration Service logs
kubectl logs -f deployment/ai-gateway-v2-dual-port | grep "EnhancedConfigService"

# View database connection logs
kubectl logs -f deployment/ai-gateway-v2-dual-port | grep "PostgreSQL"
```

### Performance Metrics

Key metrics to monitor:

- **Request Latency**: Response time per provider
- **Success Rate**: Percentage of successful requests
- **Provider Health**: Connectivity status of AI providers
- **Database Performance**: Query execution times
- **Memory Usage**: Service memory consumption
- **Configuration Changes**: Frequency of config updates

## Troubleshooting

### Common Issues

#### 1. Service Won't Start

**Symptoms**: Pods in CrashLoopBackOff state

**Diagnosis**:
```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

**Common Causes**:
- Database connection failure
- Missing environment variables
- Invalid API keys
- Port conflicts

**Solutions**:
- Verify PostgreSQL connectivity
- Check environment variable configuration
- Validate API key format
- Ensure port mappings are correct

#### 2. Configuration Not Persisting

**Symptoms**: Settings reset after pod restart

**Diagnosis**:
```bash
# Check database connectivity
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "\dt"

# Verify Enhanced Configuration Service logs
kubectl logs <pod-name> | grep "EnhancedConfigService"
```

**Solutions**:
- Verify database schema creation
- Check PostgreSQL user permissions
- Validate configuration service initialization

#### 3. External Port Not Accessible

**Symptoms**: Connection refused on port 8777

**Diagnosis**:
```bash
# Check k3d port mappings
k3d cluster list
kubectl get services
```

**Solutions**:
- Recreate cluster with proper port mappings
- Verify LoadBalancer service configuration
- Check firewall rules

### Debug Commands

```bash
# Check cluster status
kubectl cluster-info
kubectl get nodes
kubectl get pods -o wide

# Verify services
kubectl get services
kubectl describe service ai-gateway-external

# Test connectivity
curl -v -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health

# Database connectivity test
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "SELECT version();"
```

## Security Considerations

### API Key Management

- **Production Keys**: Use strong, unique API keys
- **Kubernetes Secrets**: Store sensitive credentials securely
- **Key Rotation**: Regular API key updates
- **Access Control**: Limit administrative access

### Database Security

- **Encrypted Connections**: Use SSL/TLS for database connections
- **User Permissions**: Minimal required database privileges
- **Network Isolation**: Restrict database access to authorized services
- **Audit Logging**: Track all database operations

### Network Security

- **Internal Communication**: Use service mesh for internal traffic
- **External Access**: Limit external endpoints to necessary ports
- **TLS Termination**: Implement HTTPS for external access
- **Rate Limiting**: Prevent abuse of API endpoints

## Performance Optimization

### Database Optimization

```sql
-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_provider_configs_active ON provider_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_config_history_version ON config_history(version);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_provider ON routing_metrics(provider_id);
```

### Memory Management

- **Connection Pooling**: Optimize database connections
- **Cache Strategy**: Implement intelligent caching
- **Memory Limits**: Set appropriate Kubernetes resource limits
- **Garbage Collection**: Monitor Node.js memory usage

### Scaling Considerations

```yaml
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ai-gateway-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ai-gateway-v2-dual-port
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

## Backup and Recovery

### Configuration Backup

```bash
# Export current configuration
kubectl exec -it <pod-name> -- pg_dump -h host.k3d.internal -U ai_gateway ai_gateway > ai_gateway_backup.sql

# Backup configuration to file
curl -H "X-API-Key: ai-gateway-admin-key-2024" http://localhost:8777/api/v1/config/export > config_backup.json
```

### Disaster Recovery

1. **Database Restore**: Restore PostgreSQL from backup
2. **Configuration Import**: Load configuration from backup file
3. **Service Verification**: Verify all services are operational
4. **Health Checks**: Run comprehensive health validation

## Maintenance

### Regular Tasks

- **Log Rotation**: Manage log file sizes
- **Database Maintenance**: Regular VACUUM and ANALYZE
- **Configuration Audit**: Review and validate configurations
- **Security Updates**: Keep dependencies updated
- **Performance Review**: Monitor and optimize performance

### Update Procedure

1. **Backup Current State**: Export configuration and data
2. **Build New Image**: Create updated Docker image
3. **Rolling Update**: Deploy with zero downtime
4. **Verification**: Validate functionality post-update
5. **Rollback Plan**: Prepare rollback if issues occur

---

**Version**: 2.0.0  
**Last Updated**: 2025-09-25  
**Deployment Status**: Production Ready  
**Dashboard Integration**: SDK v2.1.0 Fixed
