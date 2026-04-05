#!/bin/bash
# Apply 4-tier cost-optimized routing rules to AI Gateway
# Run this after gateway starts to activate routing rules

echo "⏳ Waiting for AI Gateway to be healthy..."
until curl -s http://100.108.41.22:8777/health | grep -q "healthy"; do
  sleep 2
done

echo "✅ AI Gateway is healthy, applying routing rules..."

curl -s -X PUT http://100.108.41.22:8777/api/v1/config/routing \
  -H "Authorization: Bearer ai-gateway-admin-key-2024" \
  -H "Content-Type: application/json" \
  -d '{
  "routing_rules": [
    {
      "id": "tier1_critical_sonnet",
      "name": "Tier 1: Critical Tasks → Sonnet 4.5 (10%)",
      "priority": 10,
      "condition": {
        "anyOf": [
          {"field": "tenantId", "exists": true},
          {"field": "sensitivity", "in": ["high", "restricted", "critical"]},
          {"field": "operationType", "in": ["multi_step_workflow", "agentic", "complex_reasoning"]},
          {"field": "complexity", "equals": "high"}
        ]
      },
      "targetProvider": "anthropic-default",
      "targetModel": "claude-sonnet-4-5",
      "fallbackProviders": ["google-default"],
      "enabled": true
    },
    {
      "id": "tier2_standard_tools_haiku",
      "name": "Tier 2: Standard Tool-Calling → Haiku 4.5 (60%)",
      "priority": 20,
      "condition": {
        "allOf": [
          {"field": "hasTools", "equals": true},
          {
            "anyOf": [
              {"field": "operationType", "in": ["email_search", "calendar_ops", "tool_calling"]},
              {"field": "complexity", "in": ["medium", "low"]},
              {"field": "sensitivity", "in": ["medium", "low", "public"]}
            ]
          }
        ]
      },
      "targetProvider": "anthropic-default",
      "targetModel": "claude-haiku-4-5",
      "fallbackProviders": ["google-default"],
      "enabled": true
    },
    {
      "id": "tier3_simple_tools_gemini",
      "name": "Tier 3: Simple Tool-Calling → Gemini Flash (20%)",
      "priority": 30,
      "condition": {
        "allOf": [
          {"field": "hasTools", "equals": true},
          {
            "anyOf": [
              {"field": "operationType", "in": ["classification", "extraction", "single_tool"]},
              {"field": "complexity", "equals": "low"},
              {"field": "maxTokens", "lessThan": 500}
            ]
          }
        ]
      },
      "targetProvider": "google-default",
      "targetModel": "gemini-2-5-flash",
      "fallbackProviders": ["anthropic-default"],
      "enabled": true
    },
    {
      "id": "tier4_no_tools_qwen",
      "name": "Tier 4: No Tools → Qwen3-32B Local (10%)",
      "priority": 40,
      "condition": {
        "allOf": [
          {"field": "hasTools", "equals": false},
          {
            "anyOf": [
              {"field": "operationType", "in": ["chat", "completion", "simple_qa", "summarization"]},
              {"field": "complexity", "equals": "low"},
              {"field": "sensitivity", "in": ["low", "public"]},
              {"field": "maxTokens", "lessThan": 1000}
            ]
          }
        ]
      },
      "targetProvider": "openai-qwen3-32b-local",
      "targetModel": "qwen3-32b",
      "fallbackProviders": ["google-default", "anthropic-default"],
      "enabled": true
    }
  ]
}' | jq '.success'

echo ""
echo "✅ Routing rules applied successfully!"
echo ""
echo "Tier 1: Critical → Sonnet 4.5 (high sensitivity, multi-tenant)"
echo "Tier 2: Standard Tools → Haiku 4.5 (tool calling, medium complexity)"
echo "Tier 3: Simple Tools → Gemini Flash (low complexity tools)"
echo "Tier 4: No Tools → Qwen3-32B Local (simple chat, free)"
echo ""
echo "Expected cost savings: 70-80% vs all-Sonnet"
