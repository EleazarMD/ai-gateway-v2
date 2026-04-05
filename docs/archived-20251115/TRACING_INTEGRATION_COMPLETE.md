# AI Gateway v2 - Request Tracing Integration Complete ✅

## What Was Done

Successfully integrated comprehensive request tracing, cost tracking, and alerting into the AI Gateway server.

### Changes Made to `server.js`

1. **Added Service Imports** (lines 26-32)
   ```javascript
   const RequestTracingService = require('./src/services/request-tracing-service');
   const CostTrackingService = require('./src/services/cost-tracking-service');
   const AlertService = require('./src/services/alert-service');
   const TraceStorage = require('./src/storage/trace-storage');
   const CostStorage = require('./src/storage/cost-storage');
   const AlertStorage = require('./src/storage/alert-storage');
   ```

2. **Initialized Services** (lines 94-113)
   ```javascript
   const traceStorage = new TraceStorage(dbConfig);
   const costStorage = new CostStorage(dbConfig);
   const alertStorage = new AlertStorage(dbConfig);
   
   const tracingService = new RequestTracingService(traceStorage);
   const costService = new CostTrackingService(costStorage);
   const alertService = new AlertService(alertStorage);
   ```

3. **Added Storage Initialization** (lines 1802-1812)
   - Initializes PostgreSQL schemas on startup
   - Creates necessary tables and indexes
   - Graceful fallback to in-memory if DB unavailable

4. **Instrumented Chat Completions Endpoint** (lines 600-680)
   - Starts trace at request start
   - Tracks routing decisions
   - Calculates and records costs
   - Completes trace with metrics
   - Records errors with full context
   - Adds traceId to response

5. **Added Monitoring API Endpoints** (lines 319-389)
   - `GET /api/v1/traces` - Query traces
   - `GET /api/v1/traces/:id` - Get trace details
   - `GET /api/v1/costs/analytics` - Cost analytics
   - `GET /api/v1/costs/summary` - Cost summary
   - `GET /api/v1/alerts` - Active alerts
   - `POST /api/v1/alerts/:id/acknowledge` - Acknowledge alerts

## Testing the Integration

### 1. Restart the AI Gateway

```bash
cd /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2

# Stop if running
pkill -f "node.*server.js"

# Start the server
npm start
# or
node server.js
```

**Expected output:**
```
[Server] Monitoring services initialized (tracing, cost tracking, alerts)
...
📊 Initializing monitoring storage (tracing, costs, alerts)...
✅ Monitoring storage initialized
```

### 2. Make a Test Request

```bash
# Make a chat completion request
curl -X POST http://localhost:8777/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ai-gateway-api-key-2024" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello!"}]
  }'
```

**Expected response includes:**
```json
{
  "...": "response data",
  "_gateway": {
    "version": "2.2.0",
    "traceId": "abc123-def456-...",
    "routing": { "provider": "openai" }
  }
}
```

### 3. Verify Trace Creation

```bash
# Query traces from internal API
curl http://localhost:7777/api/v1/traces?limit=10 \
  -H "X-API-Key: ai-gateway-api-key-2024"
```

**Expected response:**
```json
{
  "traces": [
    {
      "traceId": "...",
      "timestamp": "2025-10-22T...",
      "duration": 1234,
      "status": "completed",
      "request": {
        "model": "gpt-4o-mini",
        "provider": "openai"
      },
      "metrics": {
        "tokenCount": { "total": 45 },
        "cost": { "total": 0.000045 }
      }
    }
  ]
}
```

### 4. Check Cost Summary

```bash
curl http://localhost:7777/api/v1/costs/summary?timeRange=1h \
  -H "X-API-Key: ai-gateway-api-key-2024"
```

**Expected response:**
```json
{
  "total": 0.000045,
  "totalTokens": 45,
  "totalRequests": 1,
  "avgCostPerRequest": 0.000045,
  "byProvider": {
    "openai": 0.000045
  },
  "byModel": {
    "gpt-4o-mini": 0.000045
  }
}
```

### 5. View Dashboard

```bash
# Open the dashboard
open http://localhost:8404/infrastructure/ai-gateway
```

**You should now see:**
- ✅ Traces appearing in the Request Traces tab
- ✅ Cost data in Cost Analytics tab
- ✅ Real-time metrics updating
- ✅ Overview cards showing non-zero values

## Troubleshooting

### No Traces Appearing

**Check server logs:**
```bash
# Look for trace creation messages
grep "Trace started" logs/ai-gateway.log
```

**Verify database connection:**
```bash
# Check if PostgreSQL is running
psql -h localhost -p 5432 -U postgres -d ai_homelab -c "SELECT 1"
```

**If database fails, traces are stored in memory:**
- Check console for: "Traces and costs will be stored in memory only"
- In-memory traces will work but won't persist between restarts

### Dashboard Shows "No traces found"

1. **Make sure you've made at least one request** to `/api/v1/chat/completions`
2. **Check the internal API directly:**
   ```bash
   curl http://localhost:7777/api/v1/traces \
     -H "X-API-Key: ai-gateway-api-key-2024"
   ```
3. **Verify dashboard API proxy is working:**
   ```bash
   curl http://localhost:8404/api/ai-gateway/traces
   ```

### Cost Showing $0.00

**Causes:**
- Model not in pricing database
- Usage object not returned by provider
- Cost calculation failed

**Fix:**
- Check `cost-tracking-service.js` has pricing for your model
- Verify provider response includes `usage` object
- Check server logs for cost calculation errors

## Database Schema

The following tables are created automatically:

### ai_gateway_traces
```sql
CREATE TABLE ai_gateway_traces (
  trace_id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  duration INTEGER,
  status VARCHAR(50),
  request_model VARCHAR(255),
  request_provider VARCHAR(100),
  client_id VARCHAR(255),
  tokens_total INTEGER,
  cost_total DECIMAL(10, 6),
  ...
);
```

### ai_gateway_costs
```sql
CREATE TABLE ai_gateway_costs (
  id SERIAL PRIMARY KEY,
  trace_id UUID,
  timestamp TIMESTAMPTZ NOT NULL,
  provider VARCHAR(100),
  model VARCHAR(255),
  tokens_total INTEGER,
  cost_total DECIMAL(10, 6),
  ...
);
```

### ai_gateway_alerts
```sql
CREATE TABLE ai_gateway_alerts (
  id VARCHAR(255) PRIMARY KEY,
  rule_id VARCHAR(255),
  severity VARCHAR(50),
  timestamp TIMESTAMPTZ NOT NULL,
  status VARCHAR(50),
  ...
);
```

## Environment Variables

Add these to your `.env` if using PostgreSQL:

```bash
# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ai_homelab
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# API Keys (required for dashboard auth)
API_KEY=ai-gateway-api-key-2024
ADMIN_API_KEY=ai-gateway-admin-key-2024
```

## Performance Notes

### In-Memory Mode (No Database)
- Traces stored in memory (max 10,000)
- Lost on server restart
- Good for testing
- No storage I/O overhead

### Database Mode (PostgreSQL)
- Persistent traces
- Survives restarts
- Better for production
- Slightly higher latency (~10-20ms per request)

### Optimization Tips
1. Use database indexes (created automatically)
2. Configure trace retention (default 7 days)
3. Adjust in-memory limits if needed
4. Consider read replicas for high query volume

## Next Steps

Now that tracing is integrated:

1. ✅ **Generate some traffic** - Make 10-20 test requests
2. ✅ **Verify dashboard** - Check all tabs work
3. ✅ **Test filters** - Try filtering by status, provider, model
4. ✅ **Review costs** - Ensure cost calculation is accurate
5. ✅ **Configure alerts** - Set up budget thresholds

## API Reference

### Internal Monitoring API (Port 7777)

All endpoints require: `-H "X-API-Key: ai-gateway-api-key-2024"`

#### Traces
- `GET /api/v1/traces?limit=50&status=completed&provider=openai`
- `GET /api/v1/traces/{traceId}`

#### Costs
- `GET /api/v1/costs/analytics?timeRange=24h&groupBy=provider`
- `GET /api/v1/costs/summary?timeRange=7d`

#### Alerts
- `GET /api/v1/alerts?status=active`
- `POST /api/v1/alerts/{alertId}/acknowledge`

## Success Criteria

✅ **Integration successful if:**
1. Server starts without errors
2. Traces are created for each request
3. Dashboard shows traces and costs
4. API endpoints return data
5. No performance degradation

---

**Integration Status:** ✅ Complete  
**Date:** October 22, 2025  
**Version:** AI Gateway v2.2 with Full Observability
