# Multiple Instance Prevention

**Date:** 2025-11-02  
**Issue:** Multiple AI Gateway instances running simultaneously  
**Impact:** Telemetry routing failures, stale code persistence  
**Status:** ✅ PROTECTED

## The Problem

### What Happened

Multiple AI Gateway instances were running simultaneously as different processes:
- PID 6269, 25044, 28014, 45836, 47788, 61305 (6+ instances!)
- Only ONE bound to ports 7777/8777
- Others were zombie processes with STALE CODE
- Old instances still had the fast-path bug even after we fixed it
- Telemetry was routing through old code paths

### Why It's Dangerous

1. **Stale Code Persistence**
   - Old instances may have bugs (e.g., fast-path bypass)
   - Code changes don't take effect
   - Debugging becomes impossible

2. **Telemetry Routing Failures**
   - Some requests hit old instances
   - No telemetry gets logged
   - Activity Logs show no data despite active LLM usage

3. **Race Conditions**
   - Multiple instances competing
   - Inconsistent behavior
   - Hard to reproduce bugs

4. **Resource Waste**
   - Memory duplication
   - CPU usage multiplied
   - Port conflicts

## The Solution

### 1. Startup Script Protection (PRIMARY)

**File:** `/tools/monitoring/ecosystem-dashboard/scripts/start-services.sh`

**Protection Added:**
```bash
# CRITICAL: Kill ALL existing AI Gateway instances
local existing_pids=$(pgrep -f "node.*server.js.*ai-gateway-v2" || true)
if [ -n "$existing_pids" ]; then
    pkill -9 -f "node.*server.js.*ai-gateway-v2"
    sleep 2
fi

# Double-check port is free
if check_service $AI_GATEWAY_PORT; then
    lsof -ti:$AI_GATEWAY_PORT | xargs kill -9
    sleep 1
fi
```

**What It Does:**
- Searches for ALL Node.js processes running `server.js` in `ai-gateway-v2` directory
- Kills them ALL before starting
- Double-checks ports are free
- Ensures clean slate

### 2. Process Name Pattern Matching

**Pattern:** `node.*server.js.*ai-gateway-v2`

**Why This Pattern:**
- Specific to AI Gateway (not other servers)
- Catches all instances regardless of working directory
- Works even with full paths

### 3. Port-Based Cleanup

**Fallback:** If pattern matching misses something, kill by port:
```bash
lsof -ti:8777 | xargs kill -9
lsof -ti:7777 | xargs kill -9
```

## How to Use

### Starting Services (Recommended)

```bash
# Use the startup script - automatically handles cleanup
cd /Users/eleazar/Projects/AIHomelab/tools/monitoring/ecosystem-dashboard
./scripts/start-services.sh
```

### Manual Startup (If Needed)

```bash
# 1. Kill all existing instances
pkill -9 -f "node.*server.js.*ai-gateway-v2"
lsof -ti:8777 | xargs kill -9 2>/dev/null || true
lsof -ti:7777 | xargs kill -9 2>/dev/null || true

# 2. Wait for cleanup
sleep 2

# 3. Start fresh instance
cd /Users/eleazar/Projects/AIHomelab/core/ai-gateway-v2
node server.js
```

### Verifying Single Instance

```bash
# Check running processes
ps aux | grep "node.*server.js" | grep ai-gateway | grep -v grep

# Check port binding
lsof -i:8777 -i:7777 | grep LISTEN

# Both should show ONLY ONE process with the same PID
```

## Prevention Checklist

Before ANY AI Gateway code change or restart:

- [ ] Run `pkill -9 -f "node.*server.js.*ai-gateway-v2"`
- [ ] Verify no processes: `ps aux | grep ai-gateway | grep -v grep`
- [ ] Check ports are free: `lsof -i:8777 -i:7777`
- [ ] Use startup script (don't manually run `node server.js`)
- [ ] Verify single instance after startup

## Debugging Multiple Instances

If you suspect multiple instances:

```bash
# 1. List ALL Node.js processes
ps aux | grep "node.*server.js" | grep -v grep

# 2. Check which ones are AI Gateway
ps aux | grep ai-gateway

# 3. Kill them all
pkill -9 -f "node.*server.js.*ai-gateway-v2"

# 4. Verify cleanup
ps aux | grep ai-gateway | grep -v grep
# Should show nothing

# 5. Start fresh
./scripts/start-services.sh
```

## Telemetry Impact

### Symptoms of Multiple Instances

- ✅ LLM calls work
- ❌ No telemetry in Activity Logs
- ❌ Database shows old data only
- ❌ Code changes don't take effect
- ❌ Logs show "already running" but behavior unchanged

### Verification After Fix

```bash
# 1. Make a test LLM call from Workspace AI

# 2. Check database for NEW telemetry
psql -U eleazar -d ai_inferencing_db -c "
  SELECT timestamp, service_id, provider, model 
  FROM telemetry_events 
  WHERE timestamp > NOW() - INTERVAL '1 minute'
  ORDER BY timestamp DESC;
"

# 3. Should see NEW row within seconds
```

## Related Documents

- **Fast-Path Removal:** `/core/ai-gateway-v2/FAST_PATH_REMOVAL.md`
- **Service Discovery:** `/AIHDS_SERVICE_DISCOVERY_STANDARD.md`
- **Global Rules:** `~/.codeium/windsurf/memories/global_rules.md`

## Future Enhancements

### Option 1: PID File

```bash
# Write PID on startup
echo $$ > /tmp/ai-gateway.pid

# Check PID file on next startup
if [ -f /tmp/ai-gateway.pid ]; then
    old_pid=$(cat /tmp/ai-gateway.pid)
    kill -9 $old_pid 2>/dev/null || true
fi
```

### Option 2: Process Monitor (PM2)

```bash
# Install PM2
npm install -g pm2

# Start with PM2 (automatically prevents duplicates)
pm2 start server.js --name ai-gateway

# PM2 ensures only one instance
pm2 restart ai-gateway
```

### Option 3: Docker Container

```dockerfile
# Docker naturally prevents multiple instances
# Each container is isolated
docker run --name ai-gateway -p 8777:8777 ai-gateway:latest
```

---

**Status:** Protected via startup script. Always use `/scripts/start-services.sh` to start AI Gateway. 🛡️
