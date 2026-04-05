-- Security Tables Migration
-- AI Gateway v2.5 - Security Integration
-- Created: 2026-02-19

-- ============================================================================
-- 1. Security Anomalies Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_anomalies (
  id SERIAL PRIMARY KEY,
  anomaly_id VARCHAR(50) UNIQUE NOT NULL,
  anomaly_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'investigating', 'resolved', 'dismissed')),
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  source VARCHAR(100),
  description TEXT,
  confidence DECIMAL(3,2),
  affected_resources JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for security_anomalies
CREATE INDEX IF NOT EXISTS idx_anomalies_status ON security_anomalies(status);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON security_anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_detected ON security_anomalies(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON security_anomalies(anomaly_type);

-- ============================================================================
-- 2. Audit Events Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_events (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(50) UNIQUE NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  event_type VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('authentication', 'authorization', 'data_access', 'configuration', 'security', 'system')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  actor VARCHAR(255) NOT NULL,
  actor_type VARCHAR(50) NOT NULL CHECK (actor_type IN ('user', 'system', 'agent', 'api')),
  resource VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  ip_address INET,
  user_agent TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit_events
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_events(category);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor);
CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_events(outcome);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_events(severity);
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_events(event_type);

-- ============================================================================
-- 3. Security Metrics Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_metrics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metric_type VARCHAR(100) NOT NULL,
  metric_category VARCHAR(50) NOT NULL,
  metric_value DECIMAL(12,2),
  metric_unit VARCHAR(20),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for security_metrics
CREATE INDEX IF NOT EXISTS idx_metrics_type_timestamp ON security_metrics(metric_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_category ON security_metrics(metric_category);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON security_metrics(timestamp DESC);

-- ============================================================================
-- 4. Extend API Keys Table
-- ============================================================================
-- Add new columns to existing api_keys table
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '["read"]';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER DEFAULT 60;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER DEFAULT 3600;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_day INTEGER DEFAULT 86400;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(100);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes JSONB DEFAULT '["chat", "embeddings"]';

-- Indexes for extended api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires ON api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at DESC);

-- ============================================================================
-- 5. API Key Rate Limiting Tracking Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_key_rate_limits (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start TIMESTAMP NOT NULL,
  window_type VARCHAR(20) NOT NULL CHECK (window_type IN ('minute', 'hour', 'day')),
  request_count INTEGER DEFAULT 0,
  last_request TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(api_key_id, window_start, window_type)
);

-- Indexes for rate limiting
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_window ON api_key_rate_limits(api_key_id, window_start, window_type);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON api_key_rate_limits(window_start);

-- ============================================================================
-- 6. Security Health Checks Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS security_health_checks (
  id SERIAL PRIMARY KEY,
  check_id VARCHAR(50) UNIQUE NOT NULL,
  component_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
  message TEXT,
  latency_ms INTEGER,
  uptime_percentage DECIMAL(5,2),
  last_incident TIMESTAMP,
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for health checks
CREATE INDEX IF NOT EXISTS idx_health_component ON security_health_checks(component_name);
CREATE INDEX IF NOT EXISTS idx_health_status ON security_health_checks(status);
CREATE INDEX IF NOT EXISTS idx_health_checked ON security_health_checks(checked_at DESC);

-- ============================================================================
-- 7. Approval Requests Table (for HITL)
-- ============================================================================
CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  request_id VARCHAR(50) UNIQUE NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  agent_name VARCHAR(100),
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  request_data JSONB NOT NULL,
  justification TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by VARCHAR(255),
  expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for approval requests
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approvals_risk ON approval_requests(risk_level);
CREATE INDEX IF NOT EXISTS idx_approvals_requested ON approval_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_tool ON approval_requests(tool_name);

-- ============================================================================
-- 8. Create updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to tables with updated_at
DROP TRIGGER IF EXISTS update_security_anomalies_updated_at ON security_anomalies;
CREATE TRIGGER update_security_anomalies_updated_at
    BEFORE UPDATE ON security_anomalies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_approval_requests_updated_at ON approval_requests;
CREATE TRIGGER update_approval_requests_updated_at
    BEFORE UPDATE ON approval_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 9. Insert sample data for testing (optional)
-- ============================================================================

-- Sample anomalies
INSERT INTO security_anomalies (anomaly_id, anomaly_type, severity, status, source, description, confidence, affected_resources)
VALUES 
  ('anom-001', 'rate_spike', 'high', 'active', 'api-gateway', 'Unusual request rate detected from IP 203.0.113.45', 0.92, '["POST /api/v1/chat/completions"]'),
  ('anom-002', 'failed_auth', 'medium', 'investigating', 'auth-service', 'Multiple failed authentication attempts', 0.85, '["GET /api/v1/providers/status"]'),
  ('anom-003', 'unusual_pattern', 'low', 'resolved', 'monitoring', 'Unusual access pattern detected', 0.67, '["GET /api/v1/embeddings"]')
ON CONFLICT (anomaly_id) DO NOTHING;

-- Sample audit events
INSERT INTO audit_events (event_id, event_type, category, severity, actor, actor_type, resource, action, outcome, ip_address)
VALUES
  ('evt-001', 'api_key_created', 'security', 'info', 'admin@example.com', 'user', 'api_keys', 'create', 'success', '192.168.1.100'),
  ('evt-002', 'failed_login', 'authentication', 'warning', 'user@example.com', 'user', 'auth', 'login', 'failure', '203.0.113.45'),
  ('evt-003', 'config_updated', 'configuration', 'info', 'system', 'system', 'provider_config', 'update', 'success', NULL)
ON CONFLICT (event_id) DO NOTHING;

-- Sample metrics
INSERT INTO security_metrics (metric_type, metric_category, metric_value, metric_unit)
VALUES
  ('total_requests', 'overview', 125847, 'count'),
  ('blocked_requests', 'overview', 342, 'count'),
  ('failed_logins', 'authentication', 23, 'count'),
  ('rate_limited', 'rate_limit', 156, 'count')
ON CONFLICT DO NOTHING;

-- Sample approval requests
INSERT INTO approval_requests (request_id, tool_name, agent_name, risk_level, status, request_data, justification, expires_at)
VALUES
  ('req-001', 'file_delete', 'cleanup-agent', 'high', 'pending', '{"path": "/tmp/old_data.txt"}', 'Cleanup old temporary files', NOW() + INTERVAL '24 hours'),
  ('req-002', 'database_query', 'analytics-agent', 'medium', 'approved', '{"query": "SELECT * FROM users LIMIT 10"}', 'User analytics report', NOW() + INTERVAL '24 hours'),
  ('req-003', 'api_call', 'research-agent', 'low', 'pending', '{"endpoint": "https://api.example.com/data"}', 'Fetch research data', NOW() + INTERVAL '24 hours')
ON CONFLICT (request_id) DO NOTHING;

-- ============================================================================
-- Migration Complete
-- ============================================================================
