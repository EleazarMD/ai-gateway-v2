-- Alert Rules and Alert History Tables
-- Migration: 002_alerting_system.sql

-- Alert Rules: Define conditions that trigger alerts
CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,
    rule_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Rule configuration
    rule_type VARCHAR(50) NOT NULL, -- 'anomaly_threshold', 'rate_limit', 'health_check', 'custom'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    enabled BOOLEAN DEFAULT true,
    
    -- Condition configuration (JSON)
    conditions JSONB NOT NULL, -- e.g., {"metric": "anomaly_count", "operator": ">", "threshold": 5, "window_minutes": 10}
    
    -- Notification configuration
    notification_channels JSONB DEFAULT '[]'::jsonb, -- e.g., ["email", "slack", "webhook"]
    notification_config JSONB DEFAULT '{}'::jsonb, -- Channel-specific config
    
    -- Rate limiting for alerts
    cooldown_minutes INTEGER DEFAULT 15, -- Minimum time between alerts
    max_alerts_per_hour INTEGER DEFAULT 10,
    
    -- Metadata
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at TIMESTAMP,
    trigger_count INTEGER DEFAULT 0
);

-- Alert History: Track all triggered alerts
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    rule_id VARCHAR(100) NOT NULL REFERENCES alert_rules(rule_id) ON DELETE CASCADE,
    
    -- Alert details
    severity VARCHAR(20) NOT NULL,
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    
    -- Context
    triggered_by JSONB, -- What triggered the alert (anomaly, metric, etc.)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'triggered' CHECK (status IN ('triggered', 'acknowledged', 'resolved', 'muted')),
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,
    
    -- Notification tracking
    notifications_sent JSONB DEFAULT '[]'::jsonb, -- Track which channels were notified
    notification_errors JSONB DEFAULT '[]'::jsonb,
    
    -- Timestamps
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alert Mutes: Temporarily disable specific alerts
CREATE TABLE IF NOT EXISTS alert_mutes (
    id SERIAL PRIMARY KEY,
    mute_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- What to mute
    rule_id VARCHAR(100) REFERENCES alert_rules(rule_id) ON DELETE CASCADE,
    mute_type VARCHAR(50) NOT NULL, -- 'rule', 'severity', 'all'
    
    -- Mute configuration
    reason TEXT,
    muted_by VARCHAR(100),
    muted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT true
);

-- Notification Channels: Configure notification destinations
CREATE TABLE IF NOT EXISTS notification_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(100) UNIQUE NOT NULL,
    
    -- Channel details
    channel_type VARCHAR(50) NOT NULL, -- 'email', 'slack', 'webhook', 'discord', 'sms'
    name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Configuration (channel-specific)
    config JSONB NOT NULL, -- e.g., {"smtp_host": "...", "from": "..."} or {"webhook_url": "..."}
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_alert_rules_severity ON alert_rules(severity);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_status ON alert_history(status);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered ON alert_history(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_severity ON alert_history(severity);
CREATE INDEX IF NOT EXISTS idx_alert_mutes_rule ON alert_mutes(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_mutes_active ON alert_mutes(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_notification_channels_type ON notification_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_notification_channels_enabled ON notification_channels(enabled);

-- Sample alert rules
INSERT INTO alert_rules (rule_id, name, description, rule_type, severity, conditions, notification_channels, cooldown_minutes)
VALUES 
(
    'critical-anomalies-spike',
    'Critical Anomalies Spike',
    'Alert when more than 5 critical anomalies detected in 10 minutes',
    'anomaly_threshold',
    'critical',
    '{"metric": "anomaly_count", "severity": "critical", "operator": ">", "threshold": 5, "window_minutes": 10}'::jsonb,
    '["email", "webhook"]'::jsonb,
    15
),
(
    'high-rate-limit-violations',
    'High Rate Limit Violations',
    'Alert when rate limiting blocks more than 100 requests in 5 minutes',
    'rate_limit',
    'warning',
    '{"metric": "rate_limited_requests", "operator": ">", "threshold": 100, "window_minutes": 5}'::jsonb,
    '["email"]'::jsonb,
    30
),
(
    'health-check-failure',
    'Component Health Check Failure',
    'Alert when any component health check fails',
    'health_check',
    'critical',
    '{"component": "any", "status": "unhealthy"}'::jsonb,
    '["email", "webhook"]'::jsonb,
    10
),
(
    'security-score-drop',
    'Security Score Drop',
    'Alert when security score drops below 80',
    'custom',
    'warning',
    '{"metric": "security_score", "operator": "<", "threshold": 80}'::jsonb,
    '["email"]'::jsonb,
    60
);

-- Sample notification channel (email)
INSERT INTO notification_channels (channel_id, channel_type, name, description, config)
VALUES 
(
    'default-email',
    'email',
    'Default Email Notifications',
    'Primary email notification channel',
    '{"smtp_host": "localhost", "smtp_port": 25, "from": "security@ai-homelab.local", "to": ["admin@ai-homelab.local"]}'::jsonb
);

-- Update trigger for alert_rules
CREATE OR REPLACE FUNCTION update_alert_rules_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alert_rules_updated
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_alert_rules_timestamp();

-- Update trigger for notification_channels
CREATE TRIGGER notification_channels_updated
    BEFORE UPDATE ON notification_channels
    FOR EACH ROW
    EXECUTE FUNCTION update_alert_rules_timestamp();
