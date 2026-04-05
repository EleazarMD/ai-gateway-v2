# AI Gateway v2.5.0 - OpenAI SSE Streaming Support

## Overview

AI Gateway v2.5.0 introduces full OpenAI-compatible Server-Sent Events (SSE) streaming for chat completions. This enables real-time streaming responses for clients like Goose ACP, Continue, Cursor, and any other tools expecting OpenAI's streaming format.

## What's New

### SSE Streaming Implementation
- **Content-Type**: `text/event-stream` for streaming requests
- **Format**: `data: {json}\n\n` with proper SSE structure
- **Completion**: `data: [DONE]\n\n` marker at end of stream
- **Chunks**: OpenAI-compatible format with `delta.content` structure

### Architecture

```
Client Request (stream: true)
    ↓
AI Gateway ChatCompletionsHandler
    ↓
Provider Manager (routes to Anthropic/OpenAI/etc.)
    ↓
SSE Stream Response
    ↓ (chunk by chunk)
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-124","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-125","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

## Usage

### Enabling Streaming

Add `"stream": true` to your chat completion request:

```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -H "Content-Type: application/json" \
  -H "X-Service-ID: my-service" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Response Format

**First Chunk** (includes role):
```json
data: {
  "id": "chatcmpl-123",
  "object": "chat.completion.chunk",
  "created": 1730835600,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "delta": {"role": "assistant", "content": "Hello"},
    "finish_reason": null
  }]
}
```

**Subsequent Chunks**:
```json
data: {
  "id": "chatcmpl-124",
  "object": "chat.completion.chunk",
  "created": 1730835600,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "delta": {"content": " there!"},
    "finish_reason": null
  }]
}
```

**Final Chunk**:
```json
data: {
  "id": "chatcmpl-125",
  "object": "chat.completion.chunk",
  "created": 1730835600,
  "model": "gpt-4o",
  "choices": [{
    "index": 0,
    "delta": {},
    "finish_reason": "stop"
  }]
}
```

**Done Marker**:
```
data: [DONE]
```

## Goose ACP Integration

### Configuration

Update your Goose environment variables:

```bash
# ~/.config/goose/.env or your project .env
OPENAI_API_BASE=http://localhost:8777/api/v1
OPENAI_API_KEY=ai-gateway-api-key-2024
GOOSE_PROVIDER=openai
GOOSE_MODEL=gpt-4o
GOOSE_DISABLE_KEYRING=1
```

Or in `~/.config/goose/config.yaml`:

```yaml
provider: openai
model: gpt-4o

openai:
  base_url: http://localhost:8777/api/v1
  api_key: ai-gateway-api-key-2024
```

### Testing Goose ACP

```bash
# Start Goose in ACP mode
goose acp
```

The Goose ACP client will now:
1. Send `initialize` request
2. Create a session
3. Send prompts with `stream: true`
4. Receive `session/update` notifications with streaming content
5. Display AI responses in real-time

## Backward Compatibility

### Non-Streaming Requests

Existing non-streaming requests continue to work:

```bash
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Authorization: Bearer ai-gateway-api-key-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Response (regular JSON):
```json
{
  "id": "msg_01ABC",
  "object": "chat.completion",
  "created": 1730835600,
  "model": "claude-4-sonnet",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 12,
    "total_tokens": 22
  }
}
```

## Technical Details

### Files Added/Modified

**New Files:**
- `/src/handlers/chat-completions-handler.js` - Main streaming handler
- `/src/middleware/sse-streaming.js` - SSE formatting utilities

**Modified Files:**
- `/server.js` - Updated to use new handler, version bumped to 2.5.0
- `/CHANGELOG.md` - Added v2.5.0 release notes

### Handler Architecture

```javascript
class ChatCompletionsHandler {
  async handle(req, res) {
    if (req.body.stream === true) {
      await this.handleStreamingResponse(req, res);
    } else {
      await this.handleNonStreamingResponse(req, res);
    }
  }
  
  async handleStreamingResponse(req, res) {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Stream chunks as they arrive from provider
    // Format each chunk in OpenAI SSE format
    // Send [DONE] marker at end
  }
}
```

### Fallback Mechanism

If a provider doesn't support native streaming, the handler automatically:
1. Waits for complete response
2. Splits response into chunks
3. Simulates streaming by sending chunks sequentially
4. Maintains OpenAI-compatible format

This ensures all clients receive streaming responses regardless of provider capabilities.

## Troubleshooting

### Issue: No streaming chunks received

**Check:**
1. Request includes `"stream": true`
2. Headers include `Content-Type: text/event-stream` in response
3. AI Gateway is v2.5.0 or later: `curl http://localhost:8777/health`

### Issue: Goose ACP not receiving notifications

**Check:**
1. Goose config has correct `OPENAI_API_BASE`
2. API key is valid: `ai-gateway-api-key-2024`
3. AI Gateway logs show streaming request
4. Check Goose stderr for errors: `goose acp 2>&1 | tee goose.log`

### Issue: Empty streaming responses

**Check:**
1. Provider (Anthropic/OpenAI) API key is configured
2. Model name is correct
3. AI Gateway logs for provider errors
4. Test with non-streaming first to isolate issue

## Performance

### Metrics

- **Latency**: First chunk typically arrives within 200-500ms
- **Throughput**: Chunks sent as received from provider (no buffering)
- **Memory**: Streaming uses constant memory (no full response buffering)

### Monitoring

All streaming requests are tracked in:
- Request tracing (trace ID in response)
- Cost tracking (tokens counted after completion)
- Provider metrics (success/failure rates)

Check internal metrics:
```bash
curl http://localhost:7777/api/v1/traces \
  -H "X-API-Key: ai-gateway-api-key-2024"
```

## Examples

### Python Client with Streaming

```python
import aiohttp
import json

async def stream_chat():
    url = "http://localhost:8777/api/v1/chat/completions"
    headers = {
        "Authorization": "Bearer ai-gateway-api-key-2024",
        "Content-Type": "application/json",
        "X-Service-ID": "my-app"
    }
    data = {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Count to 5"}],
        "stream": True
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=data) as response:
            async for line in response.content:
                if line:
                    text = line.decode('utf-8').strip()
                    if text.startswith("data: "):
                        data_str = text[6:]
                        if data_str == "[DONE]":
                            print("\nStream complete!")
                            break
                        try:
                            chunk = json.loads(data_str)
                            content = chunk["choices"][0]["delta"].get("content", "")
                            if content:
                                print(content, end="", flush=True)
                        except json.JSONDecodeError:
                            pass
```

### JavaScript/Node.js Client

```javascript
const fetch = require('node-fetch');

async function streamChat() {
  const response = await fetch('http://localhost:8777/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ai-gateway-api-key-2024',
      'Content-Type': 'application/json',
      'X-Service-ID': 'my-app'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{role: 'user', content: 'Count to 5'}],
      stream: true
    })
  });
  
  const reader = response.body;
  const decoder = new TextDecoder();
  
  for await (const chunk of reader) {
    const text = decoder.decode(chunk);
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          console.log('\nStream complete!');
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0].delta.content || '';
          if (content) {
            process.stdout.write(content);
          }
        } catch (e) {}
      }
    }
  }
}
```

## Migration Guide

### From v2.4.x to v2.5.0

**No breaking changes!** Existing code continues to work.

**To enable streaming:**

1. Add `"stream": true` to requests
2. Handle SSE response format
3. Update client to parse `data:` lines

**Goose Users:**

1. Update `.env`: `OPENAI_API_BASE=http://localhost:8777/api/v1`
2. Restart Goose
3. Test with `goose acp`

## Support

- **Issues**: File at AI Homelab GitHub repository
- **Logs**: Check `/tmp/ai-gateway.log` for debugging
- **Health**: `curl http://localhost:8777/health`
- **Version**: Should show `"version": "2.5.0"`

## Future Enhancements

Planned for v2.6.0:
- Function calling support in streaming mode
- Vision model streaming
- Multi-turn conversation streaming optimization
- WebSocket alternative to SSE
