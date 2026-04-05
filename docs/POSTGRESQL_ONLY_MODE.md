# AI Gateway v2.0 Database Configuration

## Overview

The AI Gateway v2.0 connects to the unified PostgreSQL@14 database running on the host system. The database provides persistent storage for configuration, routing metrics, and API key management.

**IMPORTANT**: The AI Gateway does NOT deploy its own PostgreSQL instance. It connects to the existing unified ecosystem database.

## Architecture Changes

### Before: 4-Tier Hybrid Storage
```
┌─────────────────────────────────────────────────────────────────┐
│                    ORIGINAL ARCHITECTURE                        │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ IN-MEMORY   │  │ POSTGRESQL  │  │    REDIS    │  │DASHBOARD│ │
│  │   CACHE     │  │ PERSISTENCE │  │   CACHE     │  │  SYNC   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### After: 2-Tier PostgreSQL-Only
```
┌─────────────────────────────────────────────────────────────────┐
│                  POSTGRESQL-ONLY MODE                           │
│                                                                 │
│  ┌─────────────────┐           ┌─────────────────┐              │
│  │   IN-MEMORY     │           │   POSTGRESQL    │              │
│  │     CACHE       │◄─────────►│   PERSISTENCE   │              │
│  │   (Fast Read)   │           │  (Authoritative) │              │
│  └─────────────────┘           └─────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### Removed Dependencies

#### Redis Integration
- **Disabled**: Redis client initialization
- **Removed**: Pub/sub messaging for configuration updates
- **Replaced**: Direct PostgreSQL queries for configuration sync

#### Dashboard Integration
- **Disabled**: Dashboard HTTP client
- **Removed**: Real-time sync with Dashboard service
- **Replaced**: PostgreSQL-based configuration management

### Modified Components

#### 1. Enhanced Configuration Service (`src/storage/enhanced-config-service.js`)

**Changes Made:**
- Lines 6-8: Removed Redis and Dashboard client imports
- Lines 39-64: Disabled Redis client initialization
- Lines 98-119: Disabled Dashboard client initialization
- Lines 157-179: Modified configuration loading to skip Redis/Dashboard
- Lines 261-283: Disabled Redis pub/sub subscription
- Lines 322-342: Disabled Dashboard sync operations
- Lines 474-504: Modified health status to exclude Redis/Dashboard
- Lines 571-593: Disabled graceful shutdown for Redis/Dashboard

#### 2. AI Gateway Server (`server.js`)

**Changes Made:**
- Lines 1505-1553: Updated Enhanced Configuration Service initialization
- Removed Dashboard URL and Redis connection parameters
- Added PostgreSQL-only mode configuration
- Improved error handling for simplified architecture

### Configuration Loading Strategy

#### PostgreSQL-Only Flow
1. **Database Connection**: Establish PostgreSQL connection
2. **Schema Validation**: Verify required tables exist
3. **Configuration Load**: Load active configuration from database
4. **Memory Cache**: Populate in-memory cache for fast access
5. **Periodic Sync**: Regular database synchronization (no external deps)

#### Fallback Behavior
- **Primary**: PostgreSQL database (required)
- **Secondary**: In-memory cache (performance optimization)
- **No Fallbacks**: Hard failure if PostgreSQL unavailable

## Environment Configuration

### Required Variables
```bash
# Database Configuration (Connects to Host PostgreSQL@14)
DATABASE_HOST=host.k3d.internal
DATABASE_PORT=5432
DATABASE_NAME=ai_gateway_db
DATABASE_USER=eleazar
DATABASE_PASSWORD=""

# Service Configuration
API_KEY=ai-gateway-api-key-2024
NODE_ENV=development

# Enhanced Configuration Service
ENABLE_ENHANCED_CONFIG=true
CONFIG_PERSISTENCE_MODE=postgresql
```

### Removed Variables
```bash
# No longer required
REDIS_URL=redis://redis-service:6379
DASHBOARD_URL=http://ai-homelab-inference:8404
ENABLE_DASHBOARD_SYNC=false
ENABLE_REDIS_CACHE=false
```

## Database Schema

### Core Tables
```sql
-- Provider configurations
CREATE TABLE IF NOT EXISTS provider_configs (
    id SERIAL PRIMARY KEY,
    config_data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    config_hash VARCHAR(64) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Configuration change history
CREATE TABLE IF NOT EXISTS config_history (
    id SERIAL PRIMARY KEY,
    config_hash VARCHAR(64) NOT NULL,
    config_data JSONB NOT NULL,
    version INTEGER NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(50) NOT NULL DEFAULT 'manual',
    description TEXT
);

-- Provider performance metrics
CREATE TABLE IF NOT EXISTS routing_metrics (
    id SERIAL PRIMARY KEY,
    provider_id VARCHAR(50) NOT NULL,
    request_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    avg_latency FLOAT DEFAULT 0,
    last_used TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes for Performance
```sql
CREATE INDEX IF NOT EXISTS idx_provider_configs_active ON provider_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_provider_configs_hash ON provider_configs(config_hash);
CREATE INDEX IF NOT EXISTS idx_config_history_version ON config_history(version);
CREATE INDEX IF NOT EXISTS idx_config_history_applied_at ON config_history(applied_at);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_provider ON routing_metrics(provider_id);
CREATE INDEX IF NOT EXISTS idx_routing_metrics_last_used ON routing_metrics(last_used);
```

## Operational Benefits

### Simplified Deployment
- **Reduced Dependencies**: Only PostgreSQL required
- **Easier Troubleshooting**: Single persistence layer
- **Lower Resource Usage**: No Redis memory overhead
- **Faster Startup**: No external service dependencies

### Improved Reliability
- **Single Point of Truth**: PostgreSQL as authoritative source
- **Consistent State**: No synchronization issues between services
- **Atomic Operations**: Database transactions ensure consistency
- **Simpler Recovery**: Single backup/restore process

### Performance Characteristics
- **Read Performance**: In-memory cache for frequent operations
- **Write Performance**: Direct PostgreSQL writes
- **Consistency**: ACID compliance through PostgreSQL
- **Scalability**: Horizontal scaling through database replication

## Migration from 4-Tier to PostgreSQL-Only

### Pre-Migration Checklist
- [ ] Backup existing Redis data (if applicable)
- [ ] Export Dashboard configurations (if applicable)
- [ ] Verify PostgreSQL connectivity and permissions
- [ ] Test Enhanced Configuration Service in isolation

### Migration Steps
1. **Stop Current Services**: Gracefully shutdown AI Gateway
2. **Deploy Updated Image**: Use PostgreSQL-only version
3. **Verify Database Schema**: Ensure all tables are created
4. **Import Existing Config**: Load previous configurations
5. **Start Services**: Deploy updated AI Gateway
6. **Validate Functionality**: Test all endpoints and features

### Post-Migration Validation
```bash
# Verify Enhanced Configuration Service is running
kubectl logs -f deployment/ai-gateway-v2-dual-port | grep "EnhancedConfigService"

# Check PostgreSQL connectivity
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/health/comprehensive

# Validate configuration persistence
curl -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/providers/status
```

## Troubleshooting PostgreSQL-Only Mode

### Common Issues

#### Service Fails to Initialize
**Symptoms**: Enhanced Configuration Service not starting
**Cause**: PostgreSQL connection failure
**Solution**:
```bash
# Check database connectivity
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "SELECT version();"

# Verify environment variables
kubectl describe pod <pod-name> | grep -A 20 "Environment:"
```

#### Configuration Not Persisting
**Symptoms**: Settings lost after restart
**Cause**: Database write permissions or schema issues
**Solution**:
```bash
# Check table existence
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "\dt"

# Verify user permissions
kubectl exec -it <pod-name> -- psql -h host.k3d.internal -U ai_gateway -d ai_gateway -c "SELECT current_user, session_user;"
```

#### Performance Issues
**Symptoms**: Slow configuration loading
**Cause**: Missing indexes or inefficient queries
**Solution**:
```sql
-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM provider_configs WHERE is_active = true;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch 
FROM pg_stat_user_indexes 
WHERE schemaname = 'public';
```

### Debug Commands
```bash
# View Enhanced Configuration Service logs
kubectl logs deployment/ai-gateway-v2-dual-port | grep "EnhancedConfigService"

# Check database connection status
kubectl logs deployment/ai-gateway-v2-dual-port | grep "PostgreSQL"

# Monitor configuration changes
kubectl logs deployment/ai-gateway-v2-dual-port | grep "Configuration applied"

# Verify health status
curl -s -H "X-API-Key: ai-gateway-api-key-2024" http://localhost:8777/api/v1/health/comprehensive | jq '.enhancedConfigService'
```

## Performance Monitoring

### Key Metrics
- **Database Connection Pool**: Active/idle connections
- **Query Performance**: Average query execution time
- **Configuration Load Time**: Time to load configuration from database
- **Memory Usage**: In-memory cache size and hit ratio

### Monitoring Queries
```sql
-- Check connection pool status
SELECT state, count(*) FROM pg_stat_activity WHERE datname = 'ai_gateway' GROUP BY state;

-- Monitor query performance
SELECT query, mean_exec_time, calls FROM pg_stat_statements WHERE query LIKE '%provider_configs%' ORDER BY mean_exec_time DESC;

-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size 
FROM pg_tables WHERE schemaname = 'public';
```

## Future Considerations

### Re-enabling External Dependencies
If Redis or Dashboard integration needs to be restored:

1. **Conditional Initialization**: Check for service availability
2. **Graceful Degradation**: Continue operation if external services fail
3. **Configuration Flags**: Environment variables to enable/disable features
4. **Health Monitoring**: Include external service status in health checks

### Scaling Considerations
- **Read Replicas**: PostgreSQL read replicas for high-read workloads
- **Connection Pooling**: External connection pooler (PgBouncer)
- **Caching Layer**: Optional Redis for high-frequency reads
- **Horizontal Scaling**: Multiple AI Gateway instances with shared database

---

**Version**: 2.0.0  
**Mode**: PostgreSQL-Only  
**Status**: Production Ready  
**Last Updated**: 2025-09-25
