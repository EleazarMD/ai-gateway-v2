# AI Gateway + AHIS Server K3d Deployment Guide

**Version:** v2.2.0  
**Created:** 2025-09-09  
**Updated:** 2025-09-18  
**PORT_REGISTRY Compliant:** ✅  
**LoadBalancer Ready:** ✅  

## Overview

This deployment provides a complete k3d Kubernetes cluster for the AI Gateway and AHIS Server ecosystem, with proper LoadBalancer services and connection to the local Unified Homelab Database.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    K3D AI Gateway Ecosystem                         │
│                         Cluster Name: ai-gateway-ecosystem          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                          ▼                   ▼
            ┌─────────────────────────┐    ┌─────────────────────────┐
            │      AI Gateway         │    │     AHIS Server         │
            │   Dual-Port Service     │    │  Infrastructure Service │
            └─────────────────────────┘    └─────────────────────────┘
                          │                           │
              ┌─────────────────────┐                 │
              │                     │                 │
              ▼                     ▼                 ▼
    ┌─────────────────┐   ┌─────────────────┐  ┌─────────────────┐
    │   Port 7777     │   │   Port 8777     │  │   Port 8888     │
    │   Internal      │   │   External      │  │   AHIS API      │
    │  ClusterIP      │   │ LoadBalancer    │  │ LoadBalancer    │
    └─────────────────┘   └─────────────────┘  └─────────────────┘
```

## Port Configuration (PORT_REGISTRY Compliant)

### AI Gateway
- **Port 7777** (Internal): Service mesh operations, AHIS integration, admin functions
- **Port 8777** (External): Client AI inference API, LoadBalancer accessible

### AHIS Server  
- **Port 8888**: Infrastructure services API, LoadBalancer accessible

### Database Connection
- **Local PostgreSQL**: `host.docker.internal:5432`
- **Unified Homelab Database**: Shared database instance

## Files Structure

```
/ai-gateway-v2/
├── k3d-cluster-config.yaml      # Main k3d cluster configuration
├── deploy-k3d.sh                # Deployment script
├── K3D_DEPLOYMENT_GUIDE.md      # This guide
└── k8s-manifests/
    ├── namespace.yaml           # ai-homelab-unified namespace
    ├── ai-gateway-deployment.yaml   # AI Gateway deployment & services
    ├── ahis-server-deployment.yaml # AHIS Server deployment & services
    └── persistent-volumes.yaml     # PVCs and ConfigMaps
```

## Deployment Instructions

### Prerequisites
- Docker Desktop running
- k3d installed (`brew install k3d`)
- kubectl installed (`brew install kubectl`)
- Local PostgreSQL database running on port 5432

### Quick Deployment
```bash
# Navigate to ai-gateway-v2 directory
cd /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2

# Run deployment script
./deploy-k3d.sh
```

### Manual Deployment
```bash
# Create cluster
k3d cluster create --config k3d-cluster-config.yaml

# Apply manifests
kubectl apply -f k8s-manifests/

# Wait for deployments
kubectl -n ai-homelab-unified rollout status deployment/ai-gateway
kubectl -n ai-homelab-unified rollout status deployment/ahis-server
```

## Service Access

### External Access (LoadBalancer)
- **AI Gateway External API**: `http://localhost:8777`
- **AHIS Server API**: `http://localhost:8888`

### Internal Access (ClusterIP)
- **AI Gateway Internal**: `http://ai-gateway-internal.ai-homelab-unified.svc.cluster.local:7777`
- **AHIS Server Internal**: `http://ahis-server.ai-homelab-unified.svc.cluster.local:8888`

## Testing Commands

### AI Gateway Health Check
```bash
# External API (Client Access)
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/health

# Test AI Models Endpoint  
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/models
```

### AHIS Server Health Check
```bash
# Basic health check
curl http://localhost:8888/health

# Service registry check
curl http://localhost:8888/api/v1/services
```

## Database Configuration

### AI Gateway Database
- **Database**: `ai_gateway_db`
- **User**: `eleazar` 
- **Host**: `host.docker.internal:5432`

### AHIS Server Database  
- **Database**: `ahis_db`
- **User**: `eleazar`
- **Host**: `host.docker.internal:5432`

## Management Commands

### Cluster Operations
```bash
# View cluster status
k3d cluster list

# Delete cluster  
k3d cluster delete ai-gateway-ecosystem

# Get cluster kubeconfig
k3d kubeconfig get ai-gateway-ecosystem
```

### Kubernetes Operations
```bash
# View pods
kubectl -n ai-homelab-unified get pods

# View services
kubectl -n ai-homelab-unified get services

# View logs
kubectl -n ai-homelab-unified logs -f deployment/ai-gateway
kubectl -n ai-homelab-unified logs -f deployment/ahis-server

# Scale deployments
kubectl -n ai-homelab-unified scale deployment/ai-gateway --replicas=3
```

## Troubleshooting

### Common Issues

#### Port Conflicts
If ports 7777, 8777, or 8888 are already in use:
```bash
# Find and terminate conflicting processes
lsof -i :7777
lsof -i :8777  
lsof -i :8888

# Kill process by PID
kill <PID>
```

#### Database Connection Issues
Ensure PostgreSQL is running and accessible:
```bash
# Test database connectivity
psql -h localhost -p 5432 -U eleazar -l
```

#### LoadBalancer Not Accessible
Check LoadBalancer services:
```bash
kubectl -n ai-homelab-unified get services -o wide
kubectl -n ai-homelab-unified describe service ai-gateway-external
```

### Logs and Debugging
```bash
# Get detailed pod information
kubectl -n ai-homelab-unified describe pod <pod-name>

# View events
kubectl -n ai-homelab-unified get events --sort-by='.lastTimestamp'

# Check resource usage
kubectl -n ai-homelab-unified top pods
```

## Compliance & Security

### PORT_REGISTRY Compliance ✅
- All port assignments follow the official AIHDS Port Registry
- No dynamic port changes - terminates conflicting processes
- Proper port separation between internal and external APIs

### Security Features ✅
- API key authentication for all endpoints
- Separate admin API keys for elevated operations
- Network isolation between internal and external services
- Resource limits and health checks configured

## Integration Points

### TripCraft Application
```javascript
// Connect to external LoadBalancer for AI inference
const response = await fetch('http://localhost:8777/api/v1/perplexity/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'ai-gateway-api-key-2024'
  },
  body: JSON.stringify({
    query: 'Best restaurants in Mexico City',
    model: 'sonar'
  })
});
```

### Ecosystem Services
```javascript
// Internal service mesh access
const response = await fetch('http://ai-gateway-internal.ai-homelab-unified.svc.cluster.local:7777/api/services', {
  headers: {
    'X-API-Key': 'ai-gateway-api-key-2024'
  }
});
```

## Version Information

- **Cluster Configuration**: v2.1.0
- **AI Gateway**: Dual-port architecture (ports 7777/8777)
- **AHIS Server**: v2.1.0 (port 8888)
- **Kubernetes**: v1.31.5+k3s1
- **Namespace**: ai-homelab-unified

---

**Status**: ✅ Production Ready - Fully functional k3d deployment with LoadBalancer support and database connectivity.
