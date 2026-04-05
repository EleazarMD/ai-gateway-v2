#!/bin/bash
# AI Gateway + AHIS Server k3d Deployment Script
# Version: v2.2.1
# Created: 2025-09-09
# PORT_REGISTRY Compliant

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLUSTER_NAME="ai-gateway-ecosystem"
NAMESPACE="ai-homelab-unified"
CONFIG_FILE="k3d-cluster-config.yaml"

echo -e "${BLUE}🚀 AI Gateway + AHIS Server k3d Deployment${NC}"
echo "=============================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
if ! command_exists k3d; then
    echo -e "${RED}❌ k3d is not installed. Please install k3d first.${NC}"
    exit 1
fi

if ! command_exists kubectl; then
    echo -e "${RED}❌ kubectl is not installed. Please install kubectl first.${NC}"
    exit 1
fi

if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if cluster already exists
if k3d cluster list | grep -q "$CLUSTER_NAME"; then
    echo -e "${YELLOW}⚠️  Cluster '$CLUSTER_NAME' already exists.${NC}"
    read -p "Do you want to delete and recreate it? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}🗑️  Deleting existing cluster...${NC}"
        k3d cluster delete "$CLUSTER_NAME"
    else
        echo -e "${GREEN}✅ Using existing cluster.${NC}"
        kubectl config use-context "k3d-$CLUSTER_NAME"
        exit 0
    fi
fi

# Create k3d cluster
echo -e "${BLUE}🏗️  Creating k3d cluster '$CLUSTER_NAME'...${NC}"
if [ -f "$CONFIG_FILE" ]; then
    k3d cluster create --config "$CONFIG_FILE"
else
    echo -e "${RED}❌ Configuration file '$CONFIG_FILE' not found.${NC}"
    exit 1
fi

# Wait for cluster to be ready
echo -e "${YELLOW}⏳ Waiting for cluster to be ready...${NC}"
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Verify namespace creation
echo -e "${BLUE}🔍 Verifying namespace '$NAMESPACE'...${NC}"
if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo -e "${YELLOW}📦 Creating namespace '$NAMESPACE'...${NC}"
    kubectl apply -f k8s-manifests/namespace.yaml
fi

# Apply all manifests
echo -e "${BLUE}📋 Applying Kubernetes manifests...${NC}"
kubectl apply -f k8s-manifests/

# Wait for deployments to be ready
echo -e "${YELLOW}⏳ Waiting for deployments to be ready...${NC}"
kubectl -n "$NAMESPACE" rollout status deployment/ai-gateway --timeout=300s
kubectl -n "$NAMESPACE" rollout status deployment/ahis-server --timeout=300s

# Verify services
echo -e "${BLUE}🔍 Verifying services...${NC}"
kubectl -n "$NAMESPACE" get services

# Test connectivity
echo -e "${BLUE}🧪 Testing service connectivity...${NC}"

# Check if LoadBalancer services are accessible
AI_GATEWAY_IP=$(kubectl -n "$NAMESPACE" get service ai-gateway-external -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "localhost")
AHIS_SERVER_IP=$(kubectl -n "$NAMESPACE" get service ahis-server-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "localhost")

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo -e "${BLUE}📊 Service Information:${NC}"
echo "========================="
echo -e "🤖 AI Gateway External API: http://$AI_GATEWAY_IP:8777"
echo -e "🔒 AI Gateway Internal API: http://ai-gateway-internal.ai-homelab-unified.svc.cluster.local:7777"
echo -e "🏢 AHIS Server API: http://$AHIS_SERVER_IP:8888"
echo ""
echo -e "${BLUE}🧪 Test Commands:${NC}"
echo "=================="
echo -e "# Test AI Gateway External Health:"
echo -e "curl -H \"X-API-Key: ai-gateway-api-key-2024\" http://localhost:8777/health"
echo ""
echo -e "# Test AHIS Server Health:"
echo -e "curl http://localhost:8888/health"
echo ""
echo -e "${BLUE}🔧 Management Commands:${NC}"
echo "======================="
echo -e "# View cluster status:"
echo -e "k3d cluster list"
echo ""
echo -e "# Delete cluster:"
echo -e "k3d cluster delete $CLUSTER_NAME"
echo ""
echo -e "# View pods:"
echo -e "kubectl -n $NAMESPACE get pods"
echo ""
echo -e "# View logs:"
echo -e "kubectl -n $NAMESPACE logs -f deployment/ai-gateway"
echo -e "kubectl -n $NAMESPACE logs -f deployment/ahis-server"
