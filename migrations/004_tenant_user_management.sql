-- Tenant/User Management Schema
-- Links users to projects with role-based access
-- Migration: 004_tenant_user_management.sql

-- Tenants table (organization-level grouping above projects)
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, archived
  plan VARCHAR(50) DEFAULT 'free', -- free, pro, enterprise
  
  -- Limits
  max_projects INTEGER DEFAULT 5,
  max_users INTEGER DEFAULT 10,
  max_api_keys INTEGER DEFAULT 20,
  
  -- Billing (optional)
  billing_email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  
  -- Metadata
  settings JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Owner reference (external user ID from ecosystem_unified.users)
  owner_user_id UUID NOT NULL
);

-- Tenant memberships (user-to-tenant mapping)
CREATE TABLE IF NOT EXISTS tenant_memberships (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- External user reference (from ecosystem_unified.users)
  user_id UUID NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  
  -- Role within tenant
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- owner, admin, developer, viewer
  
  -- Status
  status VARCHAR(50) DEFAULT 'active', -- active, invited, suspended, removed
  
  -- Invitation tracking
  invited_by UUID,
  invited_at TIMESTAMP,
  accepted_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(tenant_id, user_id)
);

-- Project memberships (user-to-project mapping within a tenant)
CREATE TABLE IF NOT EXISTS project_memberships (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- External user reference
  user_id UUID NOT NULL,
  
  -- Role within project (can be more specific than tenant role)
  role VARCHAR(50) NOT NULL DEFAULT 'developer', -- admin, developer, viewer
  
  -- Permissions (fine-grained access control)
  permissions JSONB DEFAULT '["read"]', -- read, write, delete, manage_keys, invite_users
  
  -- Status
  status VARCHAR(50) DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(project_id, user_id)
);

-- API Key ownership (link API keys to users)
ALTER TABLE api_key_components 
ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS project_id VARCHAR(255);

-- Update projects table to include tenant reference
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
ADD COLUMN IF NOT EXISTS visibility VARCHAR(50) DEFAULT 'private'; -- private, tenant, public

-- Tenant invitations (for pending invites)
CREATE TABLE IF NOT EXISTS tenant_invitations (
  id SERIAL PRIMARY KEY,
  invitation_id VARCHAR(255) UNIQUE NOT NULL,
  tenant_id VARCHAR(255) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- Invitation details
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  
  -- Token for accepting invitation
  token VARCHAR(255) UNIQUE NOT NULL,
  
  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, expired, revoked
  
  -- Tracking
  invited_by UUID NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  accepted_by_user_id UUID,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(tenant_id, email, status)
);

-- Audit log for tenant actions
CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  
  -- Actor
  user_id UUID NOT NULL,
  user_email VARCHAR(255),
  
  -- Action
  action VARCHAR(100) NOT NULL, -- user_invited, user_removed, role_changed, project_created, etc.
  resource_type VARCHAR(50), -- user, project, api_key, settings
  resource_id VARCHAR(255),
  
  -- Details
  details JSONB DEFAULT '{}',
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_status ON tenant_memberships(status);
CREATE INDEX IF NOT EXISTS idx_project_memberships_user ON project_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_project_memberships_project ON project_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON tenant_invitations(email);
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON tenant_invitations(token);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_tenant ON tenant_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_user ON tenant_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_log_action ON tenant_audit_log(action);

-- Create default tenant for existing projects
INSERT INTO tenants (tenant_id, name, slug, description, status, owner_user_id)
VALUES (
  'default-tenant',
  'AI Homelab',
  'ai-homelab',
  'Default tenant for AI Homelab ecosystem',
  'active',
  'dfd9379f-a9cd-4241-99e7-140f5e89e3cd'::uuid -- Eleazar's user ID
)
ON CONFLICT (tenant_id) DO NOTHING;

-- Link existing projects to default tenant
UPDATE projects 
SET tenant_id = 'default-tenant'
WHERE tenant_id IS NULL;

-- Add owner membership
INSERT INTO tenant_memberships (tenant_id, user_id, user_email, role, status, accepted_at)
VALUES (
  'default-tenant',
  'dfd9379f-a9cd-4241-99e7-140f5e89e3cd'::uuid,
  'eleazarf@icloud.com',
  'owner',
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Comments
COMMENT ON TABLE tenants IS 'Organization-level tenant grouping for multi-tenancy';
COMMENT ON TABLE tenant_memberships IS 'User membership in tenants with roles';
COMMENT ON TABLE project_memberships IS 'User access to specific projects within tenants';
COMMENT ON TABLE tenant_invitations IS 'Pending invitations to join tenants';
COMMENT ON TABLE tenant_audit_log IS 'Audit trail for tenant-level actions';

COMMENT ON COLUMN tenants.plan IS 'Subscription plan: free, pro, enterprise';
COMMENT ON COLUMN tenant_memberships.role IS 'Tenant role: owner, admin, developer, viewer';
COMMENT ON COLUMN project_memberships.permissions IS 'Fine-grained permissions array';
