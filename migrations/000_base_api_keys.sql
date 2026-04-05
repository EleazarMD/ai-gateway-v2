-- Base API Keys Table
-- Create the base api_keys table if it doesn't exist

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  provider_id VARCHAR(100) NOT NULL,
  provider_name VARCHAR(100) NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
