/**
 * Tenant Management API Routes
 * Handles tenant, membership, and invitation operations
 */

const express = require('express');

function createTenantRoutes(dependencies) {
  const router = express.Router();
  const { tenantUserService, authenticateInternal } = dependencies;

  if (!tenantUserService) {
    console.warn('[TenantRoutes] TenantUserService not available');
    return router;
  }

  // ==================== TENANT ROUTES ====================

  /**
   * GET /tenants
   * Get all tenants for the authenticated user
   */
  router.get('/tenants', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      
      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const tenants = await tenantUserService.getUserTenants(userId);
      res.json({ tenants });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get tenants:', error);
      res.status(500).json({ error: 'Failed to get tenants' });
    }
  });

  /**
   * POST /tenants
   * Create a new tenant
   */
  router.post('/tenants', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const userEmail = req.user?.email || req.headers['x-user-email'];
      
      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const { name, slug, description, plan, settings, metadata } = req.body;

      if (!name || !slug) {
        return res.status(400).json({ error: 'Name and slug are required' });
      }

      const tenant = await tenantUserService.createTenant({
        name,
        slug,
        description,
        ownerUserId: userId,
        ownerEmail: userEmail,
        plan,
        settings,
        metadata
      });

      res.status(201).json({ tenant });
    } catch (error) {
      console.error('[TenantRoutes] Failed to create tenant:', error);
      
      if (error.code === '23505') { // Unique violation
        return res.status(409).json({ error: 'Tenant with this slug already exists' });
      }
      
      res.status(500).json({ error: 'Failed to create tenant' });
    }
  });

  /**
   * GET /tenants/:tenantId
   * Get tenant details
   */
  router.get('/tenants/:tenantId', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;

      // Check membership
      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const tenant = await tenantUserService.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const stats = await tenantUserService.getTenantStats(tenantId);

      res.json({ tenant, stats });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get tenant:', error);
      res.status(500).json({ error: 'Failed to get tenant' });
    }
  });

  /**
   * PATCH /tenants/:tenantId
   * Update tenant settings
   */
  router.patch('/tenants/:tenantId', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;

      // Check admin permission
      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const tenant = await tenantUserService.updateTenant(tenantId, req.body);
      res.json({ tenant });
    } catch (error) {
      console.error('[TenantRoutes] Failed to update tenant:', error);
      res.status(500).json({ error: 'Failed to update tenant' });
    }
  });

  // ==================== MEMBER ROUTES ====================

  /**
   * GET /tenants/:tenantId/members
   * Get all members of a tenant
   */
  router.get('/tenants/:tenantId/members', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const members = await tenantUserService.getTenantMembers(tenantId);
      res.json({ members });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get members:', error);
      res.status(500).json({ error: 'Failed to get members' });
    }
  });

  /**
   * PATCH /tenants/:tenantId/members/:memberId
   * Update member role
   */
  router.patch('/tenants/:tenantId/members/:memberId', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId, memberId } = req.params;
      const { role } = req.body;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      if (!['viewer', 'developer', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const member = await tenantUserService.updateMemberRole(tenantId, memberId, role, userId);
      res.json({ member });
    } catch (error) {
      console.error('[TenantRoutes] Failed to update member:', error);
      res.status(500).json({ error: 'Failed to update member' });
    }
  });

  /**
   * DELETE /tenants/:tenantId/members/:memberId
   * Remove a member from tenant
   */
  router.delete('/tenants/:tenantId/members/:memberId', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId, memberId } = req.params;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      // Prevent removing owner
      const membership = await tenantUserService.getMembership(tenantId, memberId);
      if (membership?.role === 'owner') {
        return res.status(400).json({ error: 'Cannot remove tenant owner' });
      }

      await tenantUserService.removeMember(tenantId, memberId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('[TenantRoutes] Failed to remove member:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  // ==================== INVITATION ROUTES ====================

  /**
   * GET /tenants/:tenantId/invitations
   * Get pending invitations
   */
  router.get('/tenants/:tenantId/invitations', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const invitations = await tenantUserService.getTenantInvitations(tenantId);
      res.json({ invitations });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get invitations:', error);
      res.status(500).json({ error: 'Failed to get invitations' });
    }
  });

  /**
   * POST /tenants/:tenantId/invitations
   * Create an invitation
   */
  router.post('/tenants/:tenantId/invitations', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;
      const { email, role = 'member' } = req.body;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const invitation = await tenantUserService.createInvitation(tenantId, {
        email,
        role,
        invitedBy: userId
      });

      // Generate invitation URL
      const inviteUrl = `${process.env.DASHBOARD_URL || 'http://localhost:3000'}/invite/${invitation.token}`;

      res.status(201).json({ 
        invitation,
        inviteUrl
      });
    } catch (error) {
      console.error('[TenantRoutes] Failed to create invitation:', error);
      
      if (error.message.includes('already a member')) {
        return res.status(409).json({ error: error.message });
      }
      
      res.status(500).json({ error: 'Failed to create invitation' });
    }
  });

  /**
   * DELETE /tenants/:tenantId/invitations/:invitationId
   * Revoke an invitation
   */
  router.delete('/tenants/:tenantId/invitations/:invitationId', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId, invitationId } = req.params;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      await tenantUserService.revokeInvitation(invitationId, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('[TenantRoutes] Failed to revoke invitation:', error);
      res.status(500).json({ error: 'Failed to revoke invitation' });
    }
  });

  /**
   * GET /invitations/:token
   * Get invitation details by token (public endpoint)
   */
  router.get('/invitations/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const invitation = await tenantUserService.getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({ error: 'Invitation not found' });
      }

      if (invitation.status !== 'pending') {
        return res.status(400).json({ error: `Invitation is ${invitation.status}` });
      }

      if (new Date(invitation.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invitation has expired' });
      }

      // Return limited info (don't expose sensitive data)
      res.json({
        invitation: {
          email: invitation.email,
          role: invitation.role,
          tenantName: invitation.tenant_name,
          tenantSlug: invitation.tenant_slug,
          expiresAt: invitation.expires_at
        }
      });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get invitation:', error);
      res.status(500).json({ error: 'Failed to get invitation' });
    }
  });

  /**
   * POST /invitations/:token/accept
   * Accept an invitation
   */
  router.post('/invitations/:token/accept', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const userEmail = req.user?.email || req.headers['x-user-email'];
      const { token } = req.params;

      if (!userId) {
        return res.status(401).json({ error: 'User ID required' });
      }

      const membership = await tenantUserService.acceptInvitation(token, userId, userEmail);
      res.json({ membership });
    } catch (error) {
      console.error('[TenantRoutes] Failed to accept invitation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ==================== PROJECT ACCESS ROUTES ====================

  /**
   * GET /tenants/:tenantId/projects
   * Get projects user has access to in this tenant
   */
  router.get('/tenants/:tenantId/projects', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'viewer');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const projects = await tenantUserService.getUserProjects(userId, tenantId);
      res.json({ projects });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get projects:', error);
      res.status(500).json({ error: 'Failed to get projects' });
    }
  });

  /**
   * POST /tenants/:tenantId/projects/:projectId/access
   * Grant user access to a project
   */
  router.post('/tenants/:tenantId/projects/:projectId/access', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId, projectId } = req.params;
      const { targetUserId, role, permissions } = req.body;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const access = await tenantUserService.grantProjectAccess(
        projectId, tenantId, targetUserId, role, permissions
      );

      res.json({ access });
    } catch (error) {
      console.error('[TenantRoutes] Failed to grant project access:', error);
      res.status(500).json({ error: 'Failed to grant project access' });
    }
  });

  // ==================== AUDIT LOG ROUTES ====================

  /**
   * GET /tenants/:tenantId/audit-log
   * Get tenant audit log
   */
  router.get('/tenants/:tenantId/audit-log', authenticateInternal, async (req, res) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { tenantId } = req.params;
      const { limit, offset, action } = req.query;

      const hasAccess = await tenantUserService.hasPermission(tenantId, userId, 'admin');
      if (!hasAccess) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const events = await tenantUserService.getTenantAuditLog(tenantId, {
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
        action
      });

      res.json({ events });
    } catch (error) {
      console.error('[TenantRoutes] Failed to get audit log:', error);
      res.status(500).json({ error: 'Failed to get audit log' });
    }
  });

  return router;
}

module.exports = { createTenantRoutes };
