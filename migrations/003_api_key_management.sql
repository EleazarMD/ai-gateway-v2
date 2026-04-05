-- API Key Management System
-- Provides unique API keys for each ecosystem component with metadata

-- Component API Keys table (separate from provider api_keys)
CREATE TABLE IF NOT EXISTS component_api_keys (
    key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key VARCHAR(255) UNIQUE NOT NULL,
    key_name VARCHAR(255) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    component_type VARCHAR(100) NOT NULL, -- 'service', 'dashboard', 'client', 'integration'
    description TEXT,
    
    -- Permissions
    scopes TEXT[] DEFAULT ARRAY['read'], -- 'read', 'write', 'admin'
    rate_limit_tier VARCHAR(50) DEFAULT 'standard', -- 'standard', 'high', 'unlimited'
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_internal BOOLEAN DEFAULT false, -- Internal vs external API key
    
    -- Usage tracking
    last_used_at TIMESTAMP,
    total_requests BIGINT DEFAULT 0,
    
    -- Metadata
    created_by VARCHAR(255) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_component_name ON api_keys(component_name);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys(last_used_at);

-- API Key usage logs (for detailed analytics)
CREATE TABLE IF NOT EXISTS api_key_usage (
    usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id UUID REFERENCES api_keys(key_id) ON DELETE CASCADE,
    api_key VARCHAR(255) NOT NULL,
    component_name VARCHAR(255) NOT NULL,
    
    -- Request details
    endpoint VARCHAR(500),
    method VARCHAR(10),
    status_code INTEGER,
    response_time_ms INTEGER,
    
    -- Outcome
    outcome VARCHAR(50), -- 'success', 'denied', 'error'
    
    -- Timestamp
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Additional context
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for usage analytics
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id ON api_key_usage(key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_timestamp ON api_key_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_component ON api_key_usage(component_name);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_outcome ON api_key_usage(outcome);

-- Trigger to update api_keys.updated_at
CREATE OR REPLACE FUNCTION update_api_key_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_key_timestamp();

-- Insert default ecosystem component API keys
INSERT INTO api_keys (api_key, key_name, component_name, component_type, description, scopes, rate_limit_tier, is_internal, is_active)
VALUES
    -- Dashboard
    ('dashboard-main-2024-prod-key', 'Ecosystem Dashboard', 'ecosystem-dashboard', 'dashboard', 'Main dashboard for AI Homelab ecosystem monitoring and management', ARRAY['read', 'write', 'admin'], 'high', true, true),
    
    -- AI Inferencing Service
    ('ai-inferencing-service-2024-key', 'AI Inferencing Service', 'ai-inferencing', 'service', 'Core AI inference service for model management and inference', ARRAY['read', 'write'], 'unlimited', true, true),
    
    -- Hermes Core Services
    ('hermes-orchestrator-2024-key', 'Hermes Orchestrator', 'hermes-orchestrator', 'service', 'Hermes orchestration service for workflow management', ARRAY['read', 'write'], 'high', true, true),
    ('hermes-memory-service-2024-key', 'Hermes Memory Service', 'hermes-memory', 'service', 'Hermes memory and context management service', ARRAY['read', 'write'], 'high', true, true),
    ('hermes-tools-service-2024-key', 'Hermes Tools Service', 'hermes-tools', 'service', 'Hermes tool execution and integration service', ARRAY['read', 'write'], 'high', true, true),
    
    -- MCP Servers
    ('mcp-perplexity-server-2024-key', 'MCP Perplexity Server', 'mcp-perplexity', 'integration', 'MCP server for Perplexity API integration', ARRAY['read'], 'standard', true, true),
    ('mcp-workspace-books-2024-key', 'MCP Workspace Books', 'mcp-workspace-books', 'integration', 'MCP server for workspace books and documentation', ARRAY['read'], 'standard', true, true),
    
    -- External Clients (for testing)
    ('client-test-2024-key', 'Test Client', 'test-client', 'client', 'Test client for API validation and development', ARRAY['read', 'write'], 'standard', false, true),
    
    -- Legacy key (for backward compatibility - will be deprecated)
    ('ai-gateway-api-key-2024', 'Legacy API Key', 'legacy-client', 'client', 'Legacy API key for backward compatibility - DEPRECATED', ARRAY['read', 'write'], 'standard', false, true)
ON CONFLICT (api_key) DO NOTHING;

-- Create view for active API keys with usage stats
CREATE OR REPLACE VIEW api_keys_with_stats AS
SELECT 
    k.key_id,
    k.api_key,
    k.key_name,
    k.component_name,
    k.component_type,
    k.description,
    k.scopes,
    k.rate_limit_tier,
    k.is_active,
    k.is_internal,
    k.last_used_at,
    k.total_requests,
    k.created_at,
    k.expires_at,
    COUNT(u.usage_id) FILTER (WHERE u.timestamp > NOW() - INTERVAL '1 hour') as requests_last_hour,
    COUNT(u.usage_id) FILTER (WHERE u.timestamp > NOW() - INTERVAL '24 hours') as requests_last_day,
    COUNT(u.usage_id) FILTER (WHERE u.outcome = 'denied' AND u.timestamp > NOW() - INTERVAL '1 hour') as denied_last_hour
FROM api_keys k
LEFT JOIN api_key_usage u ON k.key_id = u.key_id
GROUP BY k.key_id, k.api_key, k.key_name, k.component_name, k.component_type, k.description, 
         k.scopes, k.rate_limit_tier, k.is_active, k.is_internal, k.last_used_at, 
         k.total_requests, k.created_at, k.expires_at;

-- Function to get component name from API key
CREATE OR REPLACE FUNCTION get_component_name(p_api_key VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_component_name VARCHAR;
BEGIN
    SELECT component_name INTO v_component_name
    FROM api_keys
    WHERE api_key = p_api_key AND is_active = true;
    
    RETURN COALESCE(v_component_name, 'unknown');
END;
$$ LANGUAGE plpgsql;

-- Function to log API key usage
CREATE OR REPLACE FUNCTION log_api_key_usage(
    p_api_key VARCHAR,
    p_endpoint VARCHAR,
    p_method VARCHAR,
    p_status_code INTEGER,
    p_response_time_ms INTEGER,
    p_outcome VARCHAR,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
DECLARE
    v_key_id UUID;
    v_component_name VARCHAR;
BEGIN
    -- Get key_id and component_name
    SELECT key_id, component_name INTO v_key_id, v_component_name
    FROM api_keys
    WHERE api_key = p_api_key;
    
    IF v_key_id IS NOT NULL THEN
        -- Insert usage log
        INSERT INTO api_key_usage (key_id, api_key, component_name, endpoint, method, status_code, response_time_ms, outcome, metadata)
        VALUES (v_key_id, p_api_key, v_component_name, p_endpoint, p_method, p_status_code, p_response_time_ms, p_outcome, p_metadata);
        
        -- Update last_used_at and total_requests
        UPDATE api_keys
        SET last_used_at = CURRENT_TIMESTAMP,
            total_requests = total_requests + 1
        WHERE key_id = v_key_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON api_keys TO aigateway;
GRANT SELECT, INSERT ON api_key_usage TO aigateway;
GRANT SELECT ON api_keys_with_stats TO aigateway;
GRANT EXECUTE ON FUNCTION get_component_name(VARCHAR) TO aigateway;
GRANT EXECUTE ON FUNCTION log_api_key_usage(VARCHAR, VARCHAR, VARCHAR, INTEGER, INTEGER, VARCHAR, JSONB) TO aigateway;
