# MCP Integration - AI Gateway

## 📖 Canonical Documentation

**⚠️ IMPORTANT:** All MCP integration documentation has been consolidated and standardized.

### Primary Reference (Constitutional Authority)
📜 **Global Rules v3.0 - Section VA: MCP-as-a-Service**  
Location: `/Users/eleazar/.codeium/windsurf/memories/global_rules.md`

This is the **constitutional standard** that all MCP integrations MUST follow.

### Implementation Guide
📘 **MCP Integration Guide**  
Location: `/Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2/MCP_INTEGRATION_GUIDE.md`

Complete implementation guide with:
- Quick start (3 steps to add a provider)
- Architecture overview
- Configuration reference
- MCP wrapper development
- Testing & debugging
- Troubleshooting

### Deprecated Files ⚠️

The following files are **deprecated** and should not be used:
- `ENDPOINT_ARCHITECTURE.md.deprecated` - Replaced by constitutional rules
- `MCP_PROXY_ARCHITECTURE.md.deprecated` - Replaced by MCP Integration Guide
- `QUICK_REFERENCE.md.deprecated` - Replaced by MCP Integration Guide

## Quick Reference

### Adding a New MCP Provider

**3 Steps - 2 Minutes Total:**

1. **Add to config** (`config/mcp-providers-config.json`)
2. **Add API key** (via AI Inferencing API)
3. **Test** (curl command)

**Result:** Provider live with full tracking. Zero code changes.

### Key Files

```
core/ai-gateway-v2/
├── server.js                          ← MCP proxy implementation (lines 2056-2223)
├── config/
│   └── mcp-providers-config.json     ← Provider definitions
└── MCP_INTEGRATION_GUIDE.md          ← Complete guide

mcp-servers/
├── tavily-mcp-wrapper/               ← Example wrapper implementation
└── goose-config/
    └── mcp-servers.json              ← Goose MCP configuration
```

### Architecture Pattern

```
Client → AI Gateway → AI Inferencing API → External Provider
           ↓
    (Full Tracking: Traces, Costs, Performance)
```

**Constitutional Rule:** AI Gateway NEVER accesses databases directly.

---

## Workspace Proxy (v2.4.1+)

**NEW:** AI Gateway now includes workspace proxy routes for Goose MCP integration.

### Endpoints

```
/api/v1/workspace/pages               - Page CRUD operations
/api/v1/workspace/databases           - Database operations
/api/v1/workspace/blocks              - Block manipulation
/api/v1/workspace/search/pages        - Search functionality
/api/v1/workspace/validate/schema     - Schema validation
```

### Integration Flow

```
Goose AI (with Workspace MCP extension)
  ↓
Workspace MCP Server
  ↓
AI Gateway /api/v1/workspace/*
  ↓
Dashboard API /api/workspace/*
  ↓
Workspace Core / Database
```

### Configuration

```yaml
# ~/.config/goose/config.yaml
extensions:
  workspace:
    envs:
      DASHBOARD_URL: http://localhost:8777/api/v1/workspace
```

### Documentation

- **Implementation:** `src/routes/workspace-proxy.js`
- **Integration Guide:** `/mcp-servers/WORKSPACE_AI_GATEWAY_INTEGRATION.md`
- **Tools Supported:** 31 workspace tools (pages, databases, blocks, search, validation)

### Benefits

✅ Centralized routing through AI Gateway  
✅ Unified observability for workspace operations  
✅ Future-ready for caching and rate limiting  
✅ Clean separation of concerns  

---

## Support

**Questions?** Check in this order:
1. Constitutional Rules (Section VA)
2. MCP Integration Guide
3. Reference implementation (`tavily-mcp-wrapper/`)

**Issues?** Verify compliance checklist in MCP Integration Guide.

---

**Last Updated:** 2025-11-02  
**Status:** Active & Enforced  
**Authority:** Constitutional Global Rules v3.0
