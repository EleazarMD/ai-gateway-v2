# AI Gateway v2.4.0 Release Notes

**Release Date:** November 2, 2025  
**Version:** 2.4.0  
**Previous Version:** 2.3.0  
**Type:** Minor Release (Backward Compatible)

---

## 🎯 Summary

Added support for industry-standard `Authorization: Bearer` tokens alongside the existing custom `X-API-Key` header authentication. This enhancement improves compatibility with OpenAI-compatible clients and tools while maintaining full backward compatibility.

---

## ✨ What's New

### Enhanced Authentication Support

**Feature:** Dual Authentication Header Support

AI Gateway now accepts API keys via **two authentication methods**:

1. **Custom Header (Existing):**
   ```
   X-API-Key: your-api-key-here
   ```

2. **Bearer Token (New):**
   ```
   Authorization: Bearer your-api-key-here
   ```

Both methods validate against the same API key and provide identical security guarantees.

---

## 🔧 Technical Changes

### Modified Files

#### `server.js` (Line 168-183)

**Before:**
```javascript
const authenticateExternal = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Valid X-API-Key header required'
    });
  }
  next();
};
```

**After:**
```javascript
// Authentication middleware for external API (client access)
// v2.4.0: Added support for Authorization: Bearer tokens (industry standard)
const authenticateExternal = (req, res, next) => {
  // Accept both X-API-Key (custom) and Authorization: Bearer (standard)
  const apiKey = req.headers['x-api-key'] || 
                 (req.headers['authorization']?.startsWith('Bearer ') 
                   ? req.headers['authorization'].slice(7) 
                   : null);
  
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Valid X-API-Key or Authorization: Bearer header required'
    });
  }
  next();
};
```

**Version String Updates:**
- Updated all version strings from `'2.3.0'` to `'2.4.0'` (8 occurrences)

#### `package.json`

```diff
- "version": "2.3.0",
+ "version": "2.4.0",
- "description": "AI Gateway v2.3.0 - Multi-speaker TTS support...",
+ "description": "AI Gateway v2.4.0 - Multi-speaker TTS support...",
```

---

## 🎬 Use Cases

### Compatible Clients/Tools

This change enables seamless integration with:

✅ **Goose AI CLI** - Now works without proxy workarounds  
✅ **OpenAI SDK** - Standard Bearer token authentication  
✅ **Anthropic SDK** - Bearer token support  
✅ **LangChain** - OpenAI-compatible providers  
✅ **LlamaIndex** - Standard auth headers  
✅ **Custom Scripts** - Industry-standard format  

### Example Usage

#### Using X-API-Key (Existing):
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "X-Service-ID: my-service" \
  -d '{"model": "claude-4-sonnet", "messages": [...]}'
```

#### Using Bearer Token (New):
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -H "X-Service-ID: my-service" \
  -d '{"model": "claude-4-sonnet", "messages": [...]}'
```

Both methods work identically!

---

## 🔒 Security Analysis

### No Security Degradation

✅ **Same Key Validation**: Uses identical API key regardless of header format  
✅ **Same Authorization Logic**: No changes to access control  
✅ **Backward Compatible**: All existing services continue working  
✅ **Standards Compliant**: OAuth 2.0 Bearer token format  
✅ **Header Priority**: `X-API-Key` takes precedence if both headers present  

### Security Considerations

- Both auth methods validate against `process.env.API_KEY`
- Rate limiting applies equally to both methods
- Service identification via `X-Service-ID` header unchanged
- Cost tracking and AI Inferencing routing unaffected

---

## ⚙️ Migration Guide

### For Existing Services

**No changes required!** This release is 100% backward compatible.

All services using `X-API-Key` continue to work without modification.

### For New Services

Choose the authentication method that best fits your use case:

**Use X-API-Key when:**
- Integrating with AI Homelab services
- Custom implementations
- Maximum clarity in logs

**Use Authorization: Bearer when:**
- Using OpenAI-compatible SDKs
- Following OAuth 2.0 standards
- Integrating with third-party tools expecting Bearer tokens

---

## 📊 Testing

### Test Matrix

| Auth Method | Status | Test Command |
|------------|--------|--------------|
| X-API-Key only | ✅ Pass | See test 1 below |
| Bearer token only | ✅ Pass | See test 2 below |
| Both headers (X-API-Key priority) | ✅ Pass | See test 3 below |
| No auth | ✅ Fail (401) | See test 4 below |
| Invalid Bearer format | ✅ Fail (401) | See test 5 below |

### Test Commands

#### Test 1: X-API-Key (Existing Method)
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "X-Service-ID: test" \
  -d '{"model": "claude-4-sonnet", "messages": [{"role": "user", "content": "test"}]}'
```
**Expected:** 200 OK with valid response

#### Test 2: Bearer Token (New Method)
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -H "X-Service-ID: test" \
  -d '{"model": "claude-4-sonnet", "messages": [{"role": "user", "content": "test"}]}'
```
**Expected:** 200 OK with valid response

#### Test 3: Both Headers (Priority Test)
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -H "Authorization: Bearer different-key" \
  -H "X-Service-ID: test" \
  -d '{"model": "claude-4-sonnet", "messages": [{"role": "user", "content": "test"}]}'
```
**Expected:** 200 OK (X-API-Key takes precedence)

#### Test 4: No Authentication
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-4-sonnet", "messages": [{"role": "user", "content": "test"}]}'
```
**Expected:** 401 Unauthorized

#### Test 5: Invalid Bearer Format
```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Token ai-gateway-api-key-2024" \
  -H "X-Service-ID: test" \
  -d '{"model": "claude-4-sonnet", "messages": [{"role": "user", "content": "test"}]}'
```
**Expected:** 401 Unauthorized

---

## 🚀 Deployment

### Prerequisites

- AI Gateway v2.3.0 or earlier running
- API key configured via `API_KEY` environment variable

### Deployment Steps

1. **Backup current version:**
   ```bash
   cp server.js server.js.v2.3.0
   ```

2. **Pull v2.4.0 changes:**
   ```bash
   git pull origin main
   ```

3. **Verify version:**
   ```bash
   grep "version.*2.4.0" package.json
   ```

4. **Restart service:**
   ```bash
   pm2 restart ai-gateway
   # or
   systemctl restart ai-gateway
   ```

5. **Verify health:**
   ```bash
   curl http://localhost:8777/health
   ```

Expected response should show `"version": "2.4.0"`

### Rollback Procedure

If issues occur:

```bash
cp server.js.v2.3.0 server.js
pm2 restart ai-gateway
```

---

## 📝 Breaking Changes

**None.** This is a fully backward-compatible release.

---

## 🐛 Bug Fixes

None in this release.

---

## 🔮 Future Enhancements

Potential future improvements:

- JWT token validation
- OAuth 2.0 refresh tokens
- API key rotation support
- Per-service key management

---

## 📚 Related Documentation

- [AI Gateway Authentication Guide](./docs/authentication.md)
- [Goose Integration Guide](./docs/goose-integration.md)
- [Migration from v2.3.0](./docs/migration-v2.3-to-v2.4.md)

---

## 👥 Contributors

- Cascade AI Assistant
- User (eleazar)

---

## 📬 Feedback

For issues or questions about this release:
- File an issue in the repository
- Contact the AI Homelab team

---

## 🔖 Version History

- **v2.4.0** (2025-11-02): Added Bearer token authentication support
- **v2.3.0** (2025-10-XX): Multi-speaker TTS support
- **v2.2.0** (2025-XX-XX): [Previous features]
- **v2.1.0** (2025-XX-XX): [Previous features]
- **v2.0.0** (2025-XX-XX): Initial v2 release
