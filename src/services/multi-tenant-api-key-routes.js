/**
 * Multi-Tenant API Key Management Routes
 * 
 * RESTful API for hierarchical API key management:
 * - Projects
 * - Services
 * - API Keys
 * - Usage analytics
 */

const express = require('express');

class MultiTenantAPIKeyRoutes {
  constructor(keyManager) {
    this.keyManager = keyManager;
    this.router = express.Router();
    this.setupRoutes();
  }
  
  setupRoutes() {
    // Projects
    this.router.get('/projects', this.listProjects.bind(this));
    this.router.post('/projects', this.createProject.bind(this));
    this.router.get('/projects/:projectId', this.getProject.bind(this));
    
    // Services
    this.router.get('/services', this.listAllServices.bind(this));
    this.router.get('/projects/:projectId/services', this.listProjectServices.bind(this));
    this.router.post('/projects/:projectId/services', this.createService.bind(this));
    this.router.get('/services/:serviceId', this.getService.bind(this));
    
    // API Keys
    this.router.get('/services/:serviceId/keys', this.getServiceKeys.bind(this));
    this.router.post('/services/:serviceId/keys', this.addKey.bind(this));
    this.router.delete('/keys/:keyId', this.deleteKey.bind(this));
    this.router.patch('/keys/:keyId', this.updateKey.bind(this));
    
    // Usage
    this.router.get('/services/:serviceId/usage', this.getServiceUsage.bind(this));
    this.router.get('/projects/:projectId/usage', this.getProjectUsage.bind(this));
    
    // Bulk operations
    this.router.get('/keys/all', this.getAllKeys.bind(this));
    this.router.post('/keys/bulk-import', this.bulkImportKeys.bind(this));
  }
  
  /**
   * List all projects
   */
  async listProjects(req, res) {
    try {
      const projects = await this.keyManager.listProjects();
      res.json({ projects });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error listing projects:', error);
      res.status(500).json({ error: 'Failed to list projects', message: error.message });
    }
  }
  
  /**
   * Create a new project
   */
  async createProject(req, res) {
    try {
      const { projectId, name, description } = req.body;
      
      if (!projectId || !name) {
        return res.status(400).json({ error: 'projectId and name are required' });
      }
      
      const project = await this.keyManager.createProject(projectId, name, description);
      res.json({ success: true, project });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error creating project:', error);
      res.status(500).json({ error: 'Failed to create project', message: error.message });
    }
  }
  
  /**
   * Get a specific project with details
   */
  async getProject(req, res) {
    try {
      const { projectId } = req.params;
      
      const projects = await this.keyManager.listProjects();
      const project = projects.find(p => p.project_id === projectId);
      
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      
      // Get services for this project
      const services = await this.keyManager.listServices(projectId);
      
      // Get keys for this project
      const keys = await this.keyManager.getProjectKeys(projectId);
      
      res.json({ project, services, keys });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting project:', error);
      res.status(500).json({ error: 'Failed to get project', message: error.message });
    }
  }
  
  /**
   * List all services across all projects
   */
  async listAllServices(req, res) {
    try {
      const services = await this.keyManager.listServices();
      res.json({ services });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error listing services:', error);
      res.status(500).json({ error: 'Failed to list services', message: error.message });
    }
  }
  
  /**
   * List services in a project
   */
  async listProjectServices(req, res) {
    try {
      const { projectId } = req.params;
      const services = await this.keyManager.listServices(projectId);
      res.json({ services });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error listing project services:', error);
      res.status(500).json({ error: 'Failed to list services', message: error.message });
    }
  }
  
  /**
   * Create a new service
   */
  async createService(req, res) {
    try {
      const { projectId } = req.params;
      const { serviceId, name, description } = req.body;
      
      if (!serviceId || !name) {
        return res.status(400).json({ error: 'serviceId and name are required' });
      }
      
      const service = await this.keyManager.createService(projectId, serviceId, name, description);
      res.json({ success: true, service });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error creating service:', error);
      res.status(500).json({ error: 'Failed to create service', message: error.message });
    }
  }
  
  /**
   * Get a specific service with keys
   */
  async getService(req, res) {
    try {
      const { serviceId } = req.params;
      
      const services = await this.keyManager.listServices();
      const service = services.find(s => s.service_id === serviceId);
      
      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }
      
      const keys = await this.keyManager.getServiceKeys(serviceId);
      
      res.json({ service, keys });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting service:', error);
      res.status(500).json({ error: 'Failed to get service', message: error.message });
    }
  }
  
  /**
   * Get all API keys for a service
   */
  async getServiceKeys(req, res) {
    try {
      const { serviceId } = req.params;
      const keys = await this.keyManager.getServiceKeys(serviceId);
      
      // Mask the actual keys for security
      const maskedKeys = keys.map(key => ({
        ...key,
        key_preview: '••••••••', // Never expose actual keys
      }));
      
      res.json({ keys: maskedKeys });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting service keys:', error);
      res.status(500).json({ error: 'Failed to get keys', message: error.message });
    }
  }
  
  /**
   * Add or update an API key for a service
   */
  async addKey(req, res) {
    try {
      const { serviceId } = req.params;
      const {
        provider,
        apiKey,
        isPrimary,
        rateLimitPerMinute,
        rateLimitPerDay,
        costLimitDaily,
        costLimitMonthly,
        displayName,
        metadata
      } = req.body;
      
      if (!provider || !apiKey) {
        return res.status(400).json({ error: 'provider and apiKey are required' });
      }
      
      // Get service to find project_id
      const services = await this.keyManager.listServices();
      const service = services.find(s => s.service_id === serviceId);
      
      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }
      
      const key = await this.keyManager.setKey(
        service.project_id,
        serviceId,
        provider,
        apiKey,
        {
          isPrimary,
          rateLimitPerMinute,
          rateLimitPerDay,
          costLimitDaily,
          costLimitMonthly,
          displayName,
          metadata
        }
      );
      
      // Don't return the actual key
      const { encrypted_key, ...safeKey } = key;
      
      res.json({ success: true, key: safeKey });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error adding key:', error);
      res.status(500).json({ error: 'Failed to add key', message: error.message });
    }
  }
  
  /**
   * Delete an API key
   */
  async deleteKey(req, res) {
    try {
      const { keyId } = req.params;
      
      await this.keyManager.deleteKey(keyId);
      
      res.json({ success: true, message: 'API key deleted successfully' });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error deleting key:', error);
      res.status(500).json({ error: 'Failed to delete key', message: error.message });
    }
  }
  
  /**
   * Update an API key (primarily for settings like rate limits)
   */
  async updateKey(req, res) {
    try {
      const { keyId } = req.params;
      // For now, recommend deleting and re-adding
      // Future: implement direct update
      res.status(501).json({ 
        error: 'Not implemented', 
        message: 'Please delete and re-add the key with new settings' 
      });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error updating key:', error);
      res.status(500).json({ error: 'Failed to update key', message: error.message });
    }
  }
  
  /**
   * Get usage statistics for a service
   */
  async getServiceUsage(req, res) {
    try {
      const { serviceId } = req.params;
      const days = parseInt(req.query.days || '30');
      
      const usage = await this.keyManager.getServiceUsage(serviceId, days);
      
      res.json({ usage });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting service usage:', error);
      res.status(500).json({ error: 'Failed to get usage', message: error.message });
    }
  }
  
  /**
   * Get usage statistics for a project
   */
  async getProjectUsage(req, res) {
    try {
      const { projectId } = req.params;
      const days = parseInt(req.query.days || '30');
      
      // Get all services in project
      const services = await this.keyManager.listServices(projectId);
      
      // Get usage for each service
      const usagePromises = services.map(service =>
        this.keyManager.getServiceUsage(service.service_id, days)
      );
      
      const usageResults = await Promise.all(usagePromises);
      
      // Aggregate by provider
      const aggregated = {};
      
      usageResults.forEach(serviceUsage => {
        serviceUsage.forEach(record => {
          if (!aggregated[record.provider]) {
            aggregated[record.provider] = {
              provider: record.provider,
              total_requests: 0,
              total_success: 0,
              total_errors: 0,
              total_tokens: 0,
              total_cost: 0
            };
          }
          
          aggregated[record.provider].total_requests += parseInt(record.total_requests || 0);
          aggregated[record.provider].total_success += parseInt(record.total_success || 0);
          aggregated[record.provider].total_errors += parseInt(record.total_errors || 0);
          aggregated[record.provider].total_tokens += parseInt(record.total_tokens || 0);
          aggregated[record.provider].total_cost += parseFloat(record.total_cost || 0);
        });
      });
      
      res.json({ usage: Object.values(aggregated) });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting project usage:', error);
      res.status(500).json({ error: 'Failed to get usage', message: error.message });
    }
  }
  
  /**
   * Get all API keys (admin only)
   */
  async getAllKeys(req, res) {
    try {
      const projects = await this.keyManager.listProjects();
      
      const allKeys = [];
      
      for (const project of projects) {
        const keys = await this.keyManager.getProjectKeys(project.project_id);
        allKeys.push(...keys.map(k => ({ ...k, project_name: project.name })));
      }
      
      res.json({ keys: allKeys, total: allKeys.length });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error getting all keys:', error);
      res.status(500).json({ error: 'Failed to get keys', message: error.message });
    }
  }
  
  /**
   * Bulk import keys from JSON
   */
  async bulkImportKeys(req, res) {
    try {
      const { keys } = req.body;
      
      if (!Array.isArray(keys)) {
        return res.status(400).json({ error: 'keys array is required' });
      }
      
      const results = {
        success: [],
        failed: []
      };
      
      for (const keyData of keys) {
        try {
          const { projectId, serviceId, provider, apiKey, ...options } = keyData;
          
          await this.keyManager.setKey(projectId, serviceId, provider, apiKey, options);
          results.success.push({ serviceId, provider });
        } catch (error) {
          results.failed.push({ 
            serviceId: keyData.serviceId, 
            provider: keyData.provider, 
            error: error.message 
          });
        }
      }
      
      res.json({ 
        success: true, 
        imported: results.success.length,
        failed: results.failed.length,
        results 
      });
    } catch (error) {
      console.error('[Multi-Tenant API Routes] Error bulk importing keys:', error);
      res.status(500).json({ error: 'Failed to import keys', message: error.message });
    }
  }
  
  getRouter() {
    return this.router;
  }
}

module.exports = MultiTenantAPIKeyRoutes;
