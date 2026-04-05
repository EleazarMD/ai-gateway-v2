/**
 * Tenant User Service
 * Manages multi-tenant user access, memberships, and invitations
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class TenantUserService extends EventEmitter {
  constructor(postgresWrapper) {
    super();
    this.db = postgresWrapper;
    console.log('[TenantUserService] Initialized');
  }

  /**
   * Generate a unique ID
   */
  generateId(prefix = '') {
    const id = crypto.randomBytes(8).toString('hex');
    return prefix ? `${prefix}-${id}` : id;
  }

  /**
   * Generate invitation token
   */
  generateInvitationToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Resolve user email for a given user ID (fallback only)
   */
  async resolveUserEmail(userId, fallbackEmail) {
    if (fallbackEmail) return fallbackEmail;
    if (!userId) return null;
    try {
      const result = await this.db.query(
        'SELECT email FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
      return result.rows[0]?.email || null;
    } catch (error) {
      console.error('[TenantUserService] Failed to resolve user email:', error);
      return null;
    }
  }

  // ==================== TENANT OPERATIONS ====================

  /**
   * Create a new tenant
   */
  async createTenant(data) {
    const {
      name,
      slug,
      description,
      ownerUserId,
      ownerEmail,
      plan = 'free',
      settings = {},
      metadata = {}
    } = data;

    const tenantId = this.generateId('tenant');

    try {
      // Create tenant
      const result = await this.db.query(
        `INSERT INTO tenants (
          tenant_id, name, slug, description, status, plan,
          owner_user_id, settings, metadata
        ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)
        RETURNING *`,
        [tenantId, name, slug, description, plan, ownerUserId, 
         JSON.stringify(settings), JSON.stringify(metadata)]
      );

      const tenant = result.rows[0];

      const resolvedOwnerEmail = await this.resolveUserEmail(ownerUserId, ownerEmail);
      if (!resolvedOwnerEmail) {
        throw new Error('Owner email not found for user ID');
      }

      // Add owner as member
      await this.addMember(tenantId, {
        userId: ownerUserId,
        email: resolvedOwnerEmail,
        role: 'owner'
      });

      this.emit('tenantCreated', tenant);
      console.log(`[TenantUserService] Created tenant: ${name} (${tenantId})`);

      return tenant;
    } catch (error) {
      console.error('[TenantUserService] Failed to create tenant:', error);
      throw error;
    }
  }

  /**
   * Get tenant by ID
   */
  async getTenant(tenantId) {
    const result = await this.db.query(
      `SELECT * FROM tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get tenant by slug
   */
  async getTenantBySlug(slug) {
    const result = await this.db.query(
      `SELECT * FROM tenants WHERE slug = $1`,
      [slug]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all tenants for a user
   */
  async getUserTenants(userId) {
    const result = await this.db.query(
      `SELECT t.*, tm.role as user_role, tm.status as membership_status
       FROM tenants t
       JOIN tenant_memberships tm ON t.tenant_id = tm.tenant_id
       WHERE tm.user_id = $1 AND tm.status = 'active'
       ORDER BY t.name`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Update tenant
   */
  async updateTenant(tenantId, updates) {
    const allowedFields = ['name', 'description', 'status', 'plan', 'settings', 'metadata',
                           'max_projects', 'max_users', 'max_api_keys', 'billing_email'];
    
    const setClause = [];
    const values = [tenantId];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = $${paramIndex}`);
        values.push(key.includes('settings') || key.includes('metadata') 
          ? JSON.stringify(value) : value);
        paramIndex++;
      }
    }

    if (setClause.length === 0) return null;

    setClause.push(`updated_at = CURRENT_TIMESTAMP`);

    const result = await this.db.query(
      `UPDATE tenants SET ${setClause.join(', ')} WHERE tenant_id = $1 RETURNING *`,
      values
    );

    if (result.rows[0]) {
      this.emit('tenantUpdated', result.rows[0]);
    }

    return result.rows[0] || null;
  }

  // ==================== MEMBERSHIP OPERATIONS ====================

  /**
   * Add a member to a tenant
   */
  async addMember(tenantId, data) {
    const { userId, email, role = 'member', invitedBy = null } = data;

    try {
      const result = await this.db.query(
        `INSERT INTO tenant_memberships (
          tenant_id, user_id, user_email, role, status,
          invited_by, invited_at, accepted_at
        ) VALUES ($1, $2, $3, $4, 'active', $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, user_id) 
        DO UPDATE SET role = $4, status = 'active', updated_at = CURRENT_TIMESTAMP
        RETURNING *`,
        [tenantId, userId, email, role, invitedBy, invitedBy ? new Date() : null]
      );

      const membership = result.rows[0];
      this.emit('memberAdded', { tenantId, userId, role });
      
      // Log audit event
      await this.logAuditEvent(tenantId, invitedBy || userId, 'member_added', 'user', userId, {
        email, role
      });

      return membership;
    } catch (error) {
      console.error('[TenantUserService] Failed to add member:', error);
      throw error;
    }
  }

  /**
   * Get all members of a tenant
   */
  async getTenantMembers(tenantId) {
    const result = await this.db.query(
      `SELECT * FROM tenant_memberships 
       WHERE tenant_id = $1 AND status IN ('active', 'invited')
       ORDER BY role, user_email`,
      [tenantId]
    );
    return result.rows;
  }

  /**
   * Get a user's membership in a tenant
   */
  async getMembership(tenantId, userId) {
    const result = await this.db.query(
      `SELECT * FROM tenant_memberships 
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update member role
   */
  async updateMemberRole(tenantId, userId, newRole, updatedBy) {
    const result = await this.db.query(
      `UPDATE tenant_memberships 
       SET role = $3, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND user_id = $2
       RETURNING *`,
      [tenantId, userId, newRole]
    );

    if (result.rows[0]) {
      this.emit('memberRoleChanged', { tenantId, userId, newRole });
      await this.logAuditEvent(tenantId, updatedBy, 'role_changed', 'user', userId, {
        newRole
      });
    }

    return result.rows[0] || null;
  }

  /**
   * Remove a member from a tenant
   */
  async removeMember(tenantId, userId, removedBy) {
    const result = await this.db.query(
      `UPDATE tenant_memberships 
       SET status = 'removed', updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND user_id = $2
       RETURNING *`,
      [tenantId, userId]
    );

    if (result.rows[0]) {
      this.emit('memberRemoved', { tenantId, userId });
      await this.logAuditEvent(tenantId, removedBy, 'member_removed', 'user', userId, {});
    }

    return result.rows[0] || null;
  }

  // ==================== INVITATION OPERATIONS ====================

  /**
   * Create an invitation
   */
  async createInvitation(tenantId, data) {
    const { email, role = 'member', invitedBy, expiresInDays = 7 } = data;

    const invitationId = this.generateId('inv');
    const token = this.generateInvitationToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    try {
      // Check if user already a member
      const existingMember = await this.db.query(
        `SELECT * FROM tenant_memberships 
         WHERE tenant_id = $1 AND user_email = $2 AND status = 'active'`,
        [tenantId, email]
      );

      if (existingMember.rows.length > 0) {
        throw new Error('User is already a member of this tenant');
      }

      // Revoke any existing pending invitations
      await this.db.query(
        `UPDATE tenant_invitations 
         SET status = 'revoked'
         WHERE tenant_id = $1 AND email = $2 AND status = 'pending'`,
        [tenantId, email]
      );

      const result = await this.db.query(
        `INSERT INTO tenant_invitations (
          invitation_id, tenant_id, email, role, token,
          status, invited_by, expires_at
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
        RETURNING *`,
        [invitationId, tenantId, email, role, token, invitedBy, expiresAt]
      );

      const invitation = result.rows[0];
      this.emit('invitationCreated', invitation);

      await this.logAuditEvent(tenantId, invitedBy, 'user_invited', 'invitation', invitationId, {
        email, role
      });

      return invitation;
    } catch (error) {
      console.error('[TenantUserService] Failed to create invitation:', error);
      throw error;
    }
  }

  /**
   * Get invitation by token
   */
  async getInvitationByToken(token) {
    const result = await this.db.query(
      `SELECT i.*, t.name as tenant_name, t.slug as tenant_slug
       FROM tenant_invitations i
       JOIN tenants t ON i.tenant_id = t.tenant_id
       WHERE i.token = $1`,
      [token]
    );
    return result.rows[0] || null;
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(token, userId, userEmail) {
    const invitation = await this.getInvitationByToken(token);

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error(`Invitation is ${invitation.status}`);
    }

    if (new Date(invitation.expires_at) < new Date()) {
      throw new Error('Invitation has expired');
    }

    try {
      // Update invitation status
      await this.db.query(
        `UPDATE tenant_invitations 
         SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, accepted_by_user_id = $2
         WHERE token = $1`,
        [token, userId]
      );

      const resolvedUserEmail = await this.resolveUserEmail(userId, userEmail);
      if (!resolvedUserEmail) {
        throw new Error('User email not found for invitation acceptance');
      }

      // Add user as member
      const membership = await this.addMember(invitation.tenant_id, {
        userId,
        email: resolvedUserEmail,
        role: invitation.role,
        invitedBy: invitation.invited_by
      });

      this.emit('invitationAccepted', { invitation, userId });

      return membership;
    } catch (error) {
      console.error('[TenantUserService] Failed to accept invitation:', error);
      throw error;
    }
  }

  /**
   * Get pending invitations for a tenant
   */
  async getTenantInvitations(tenantId) {
    const result = await this.db.query(
      `SELECT * FROM tenant_invitations 
       WHERE tenant_id = $1 AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows;
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(invitationId, revokedBy) {
    const result = await this.db.query(
      `UPDATE tenant_invitations 
       SET status = 'revoked'
       WHERE invitation_id = $1 AND status = 'pending'
       RETURNING *`,
      [invitationId]
    );

    if (result.rows[0]) {
      await this.logAuditEvent(result.rows[0].tenant_id, revokedBy, 
        'invitation_revoked', 'invitation', invitationId, {});
    }

    return result.rows[0] || null;
  }

  // ==================== PROJECT MEMBERSHIP ====================

  /**
   * Grant user access to a project
   */
  async grantProjectAccess(projectId, tenantId, userId, role = 'developer', permissions = ['read']) {
    const result = await this.db.query(
      `INSERT INTO project_memberships (
        project_id, tenant_id, user_id, role, permissions, status
      ) VALUES ($1, $2, $3, $4, $5, 'active')
      ON CONFLICT (project_id, user_id)
      DO UPDATE SET role = $4, permissions = $5, status = 'active', updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [projectId, tenantId, userId, role, JSON.stringify(permissions)]
    );

    return result.rows[0];
  }

  /**
   * Get user's project access
   */
  async getUserProjectAccess(userId, projectId) {
    const result = await this.db.query(
      `SELECT * FROM project_memberships 
       WHERE user_id = $1 AND project_id = $2 AND status = 'active'`,
      [userId, projectId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all projects a user has access to
   */
  async getUserProjects(userId, tenantId = null) {
    let query = `
      SELECT p.*, pm.role as user_role, pm.permissions
      FROM projects p
      JOIN project_memberships pm ON p.project_id = pm.project_id
      WHERE pm.user_id = $1 AND pm.status = 'active'
    `;
    const params = [userId];

    if (tenantId) {
      query += ` AND pm.tenant_id = $2`;
      params.push(tenantId);
    }

    query += ` ORDER BY p.name`;

    const result = await this.db.query(query, params);
    return result.rows;
  }

  // ==================== AUTHORIZATION ====================

  /**
   * Check if user has permission in tenant
   */
  async hasPermission(tenantId, userId, requiredRole = 'viewer') {
    const roleHierarchy = ['viewer', 'developer', 'admin', 'owner'];
    
    const membership = await this.getMembership(tenantId, userId);
    
    if (!membership || membership.status !== 'active') {
      return false;
    }

    const userRoleIndex = roleHierarchy.indexOf(membership.role);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    return userRoleIndex >= requiredRoleIndex;
  }

  /**
   * Check if user can access project
   */
  async canAccessProject(userId, projectId, requiredPermission = 'read') {
    const access = await this.getUserProjectAccess(userId, projectId);
    
    if (!access) return false;

    const permissions = typeof access.permissions === 'string' 
      ? JSON.parse(access.permissions) 
      : access.permissions;

    return permissions.includes(requiredPermission) || permissions.includes('admin');
  }

  // ==================== AUDIT LOGGING ====================

  /**
   * Log a tenant audit event
   */
  async logAuditEvent(tenantId, userId, action, resourceType, resourceId, details = {}) {
    try {
      await this.db.query(
        `INSERT INTO tenant_audit_log (
          tenant_id, user_id, action, resource_type, resource_id, details
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, userId, action, resourceType, resourceId, JSON.stringify(details)]
      );
    } catch (error) {
      console.error('[TenantUserService] Failed to log audit event:', error);
    }
  }

  /**
   * Get audit log for a tenant
   */
  async getTenantAuditLog(tenantId, options = {}) {
    const { limit = 100, offset = 0, action = null, userId = null } = options;

    let query = `SELECT * FROM tenant_audit_log WHERE tenant_id = $1`;
    const params = [tenantId];
    let paramIndex = 2;

    if (action) {
      query += ` AND action = $${paramIndex}`;
      params.push(action);
      paramIndex++;
    }

    if (userId) {
      query += ` AND user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.db.query(query, params);
    return result.rows;
  }

  // ==================== STATS ====================

  /**
   * Get tenant statistics
   */
  async getTenantStats(tenantId) {
    const [members, projects, invitations] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*) as count FROM tenant_memberships 
         WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId]
      ),
      this.db.query(
        `SELECT COUNT(*) as count FROM projects WHERE tenant_id = $1`,
        [tenantId]
      ),
      this.db.query(
        `SELECT COUNT(*) as count FROM tenant_invitations 
         WHERE tenant_id = $1 AND status = 'pending'`,
        [tenantId]
      )
    ]);

    return {
      memberCount: parseInt(members.rows[0]?.count || 0),
      projectCount: parseInt(projects.rows[0]?.count || 0),
      pendingInvitations: parseInt(invitations.rows[0]?.count || 0)
    };
  }
}

module.exports = TenantUserService;
