#!/bin/bash

# Archive old documentation files - consolidating to Technical Reference
# Run from: /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2

set -e

ARCHIVE_DIR="./docs/archived-$(date +%Y%m%d)"
mkdir -p "$ARCHIVE_DIR"

echo "📦 Archiving old documentation to: $ARCHIVE_DIR"
echo ""

# List of files to archive (keeping only README.md)
FILES_TO_ARCHIVE=(
  "DASHBOARD_READY.md"
  "DATABASE_CONNECTIONS_REPORT.md"
  "DEEP_RESEARCH_MODELS_COMPLETE.md"
  "DEPLOYMENT_STATUS_REPORT.md"
  "DEPLOYMENT_V2.2.1_COMPLETE.md"
  "DUAL_PORT_ARCHITECTURE.md"
  "FAST_PATH_REMOVAL.md"
  "K3D_DEPLOYMENT_GUIDE.md"
  "K3D_DEPLOYMENT_V2.2.1.md"
  "KNOWLEDGE_GRAPH_REQUIREMENTS.md"
  "LOADBALANCER_IMPLEMENTATION.md"
  "MCP_INTEGRATION_GUIDE.md"
  "MULTIPLE_INSTANCE_PREVENTION.md"
  "MULTI_TENANT_API_KEYS.md"
  "MULTI_TENANT_IMPLEMENTATION_COMPLETE.md"
  "NATIVE_MIGRATION_GUIDE.md"
  "NATIVE_MIGRATION_SUCCESS.md"
  "O1_DEEP_RESEARCH_FIX.md"
  "README_MCP.md"
  "RELEASE_NOTES_v2.4.0.md"
  "STREAMING_SUPPORT.md"
  "TRACING_INTEGRATION_COMPLETE.md"
  "ENDPOINT_ARCHITECTURE.md.deprecated"
  "MCP_PROXY_ARCHITECTURE.md.deprecated"
  "QUICK_REFERENCE.md.deprecated"
)

# Move files to archive
for file in "${FILES_TO_ARCHIVE[@]}"; do
  if [ -f "$file" ]; then
    echo "📄 Archiving: $file"
    mv "$file" "$ARCHIVE_DIR/"
  else
    echo "⚠️  Not found: $file"
  fi
done

echo ""
echo "✅ Documentation cleanup complete!"
echo ""
echo "📚 Single Source of Truth:"
echo "   → /Users/eleazar/Projects/AIHomelab/docs/technical-reference/chapters/02_AI_GATEWAY.md"
echo ""
echo "📁 Archived files:"
echo "   → $ARCHIVE_DIR/"
echo ""
echo "📝 Remaining docs:"
echo "   → README.md (project overview)"
echo "   → CHANGELOG.md (version history)"
