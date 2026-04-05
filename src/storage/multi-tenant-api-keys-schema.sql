-- Multi-Tenant API Key Management Schema
-- Supports Project → Service → Provider hierarchy

-- Projects table (e.g., "AI Research", "Podcast Studio")
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

-- Services table (e.g., "research-agent", "podcast-generator")
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  service_id VARCHAR(255) UNIQUE NOT NULL,
  project_id VARCHAR(255) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  UNIQUE(project_id, service_id)
);

-- Multi-tenant API Keys table
CREATE TABLE IF NOT EXISTS api_keys_multi_tenant (
  id SERIAL PRIMARY KEY,
  key_id VARCHAR(255) UNIQUE NOT NULL,
  
  -- Hierarchy
  project_id VARCHAR(255) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  service_id VARCHAR(255) NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
  
  -- Provider info
  provider VARCHAR(100) NOT NULL, -- 'openai', 'google', 'anthropic', etc.
  provider_display_name VARCHAR(255),
  
  -- Encrypted key storage
  encrypted_key TEXT NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  
  -- Key properties
  is_active BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false, -- Primary key for this service+provider combo
  
  -- Validation
  last_validated TIMESTAMP,
  validation_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'valid', 'invalid', 'expired'
  validation_error TEXT,
  
  -- Usage limits
  rate_limit_per_minute INTEGER,
  rate_limit_per_day INTEGER,
  cost_limit_daily DECIMAL(10,4),
  cost_limit_monthly DECIMAL(10,4),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  
  -- Additional metadata
  metadata JSONB DEFAULT '{}',
  
  -- Unique constraint: one primary key per service+provider
  CONSTRAINT unique_primary_key UNIQUE(service_id, provider, is_primary) WHERE is_primary = true,
  CONSTRAINT unique_service_provider_key UNIQUE(service_id, provider, key_hash)
);

-- API Key usage tracking per service
CREATE TABLE IF NOT EXISTS api_key_usage_multi_tenant (
  id SERIAL PRIMARY KEY,
  key_id VARCHAR(255) NOT NULL REFERENCES api_keys_multi_tenant(key_id) ON DELETE CASCADE,
  project_id VARCHAR(255) NOT NULL,
  service_id VARCHAR(255) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  
  -- Usage metrics
  usage_date DATE DEFAULT CURRENT_DATE,
  request_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  
  -- Token usage
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  
  -- Cost tracking
  cost_usd DECIMAL(10,6) DEFAULT 0,
  
  -- Timestamps
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(key_id, usage_date)
);

-- Service-level usage aggregation
CREATE TABLE IF NOT EXISTS service_usage_summary (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  service_id VARCHAR(255) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  
  -- Time period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Aggregated metrics
  total_requests INTEGER DEFAULT 0,
  total_success INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost DECIMAL(10,6) DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(service_id, provider, period_start, period_end)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_services_project ON services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_api_keys_mt_project ON api_keys_multi_tenant(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_mt_service ON api_keys_multi_tenant(service_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_mt_provider ON api_keys_multi_tenant(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_mt_active ON api_keys_multi_tenant(is_active);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_mt_key ON api_key_usage_multi_tenant(key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_mt_date ON api_key_usage_multi_tenant(usage_date);
CREATE INDEX IF NOT EXISTS idx_service_usage_project_service ON service_usage_summary(project_id, service_id);

-- Insert default projects
INSERT INTO projects (project_id, name, description, status) VALUES
  ('ai-research', 'AI Research', 'AI research and analysis services', 'active'),
  ('podcast-studio', 'Podcast Studio', 'Podcast generation and production', 'active'),
  ('mexico-city-planner', 'Mexico City Trip Planner', 'Travel planning and recommendations', 'active'),
  ('knowledge-graph', 'Knowledge Graph', 'Knowledge graph and semantic search', 'active'),
  ('default', 'Default Project', 'Default project for ungrouped services', 'active')
ON CONFLICT (project_id) DO NOTHING;

-- Insert default services
INSERT INTO services (service_id, project_id, name, description, status) VALUES
  ('research-agent', 'ai-research', 'Research Agent', 'AI research and analysis agent', 'active'),
  ('podcast-generator', 'podcast-studio', 'Podcast Generator', 'Automated podcast generation', 'active'),
  ('trip-planner', 'mexico-city-planner', 'Trip Planner', 'Travel itinerary planning', 'active'),
  ('kg-ingestion', 'knowledge-graph', 'KG Ingestion', 'Knowledge graph data ingestion', 'active'),
  ('default-service', 'default', 'Default Service', 'Default service for testing', 'active')
ON CONFLICT (service_id) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE projects IS 'Top-level projects in the AI Homelab ecosystem';
COMMENT ON TABLE services IS 'Services within projects that use AI inference';
COMMENT ON TABLE api_keys_multi_tenant IS 'API keys scoped to specific project/service combinations';
COMMENT ON TABLE api_key_usage_multi_tenant IS 'Daily usage tracking per API key';
COMMENT ON TABLE service_usage_summary IS 'Aggregated usage statistics per service';

COMMENT ON COLUMN api_keys_multi_tenant.is_primary IS 'Primary key to use for this service+provider combination';
COMMENT ON COLUMN api_keys_multi_tenant.rate_limit_per_minute IS 'Optional rate limit enforcement';
COMMENT ON COLUMN api_keys_multi_tenant.cost_limit_daily IS 'Optional daily cost limit in USD';
