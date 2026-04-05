#!/bin/bash

# AI Gateway v2 - Native Startup Script
# Migrated from K3D to run natively on host machine

set -e

echo "🚀 Starting AI Gateway v2 (Native Mode)"
echo "========================================"

# Check if .env.native exists
if [ ! -f .env.native ]; then
    echo "❌ Error: .env.native file not found"
    echo "   Please create .env.native with your configuration"
    exit 1
fi

# Load environment variables
echo "📝 Loading environment from .env.native..."
export $(grep -v '^#' .env.native | xargs)

# Create data directory if it doesn't exist
mkdir -p ./data

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    exit 1
fi
echo "  ✅ Node.js: $(node --version)"

# Check if AI Inferencing Service is running
echo "🔗 Checking AI Inferencing Service..."
if curl -s "http://localhost:9000/health" > /dev/null; then
    echo "  ✅ AI Inferencing Service is running on port 9000"
else
    echo "  ⚠️  Warning: AI Inferencing Service not reachable on port 9000"
    echo "     Gateway will start but dynamic config may fail"
fi

# Check if ports are available
echo "🔌 Checking port availability..."
if lsof -ti:7777 > /dev/null 2>&1; then
    echo "  ⚠️  Port 7777 (internal) is in use"
    echo "     Stopping existing process..."
    kill $(lsof -ti:7777) 2>/dev/null || true
    sleep 2
fi

if lsof -ti:8777 > /dev/null 2>&1; then
    echo "  ⚠️  Port 8777 (external) is in use"
    echo "     Stopping existing process..."
    kill $(lsof -ti:8777) 2>/dev/null || true
    sleep 2
fi

echo "  ✅ Ports 7777 and 8777 are available"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Stop K3D gateway if running
echo "🛑 Checking for K3D gateway..."
if kubectl get deployment ai-gateway -n ai-homelab-unified &> /dev/null; then
    echo "  ⚠️  K3D gateway is running. Scaling down..."
    kubectl scale deployment ai-gateway -n ai-homelab-unified --replicas=0
    echo "  ✅ K3D gateway scaled down"
else
    echo "  ✅ K3D gateway not running"
fi

# Start the gateway
echo ""
echo "🎯 Starting AI Gateway with dynamic provider configuration..."
echo "   Internal Port: ${INTERNAL_PORT}"
echo "   External Port: ${EXTERNAL_PORT}"
echo "   AI Inferencing: ${AI_INFERENCING_URL}"
echo "   Dynamic Providers: ${ENABLE_DYNAMIC_PROVIDERS}"
echo ""
echo "📊 Logs will appear below..."
echo "   Press Ctrl+C to stop"
echo "========================================"
echo ""

# Run the server
node server.js
