/**
 * Admin API Routes for Client Registry
 * Provides endpoints to manage and monitor registered clients
 */

const express = require('express');
const router = express.Router();

module.exports = function(clientRegistry) {
  
  /**
   * GET /admin/clients
   * List all registered clients with optional stats
   */
  router.get('/', (req, res) => {
    try {
      const includeStats = req.query.stats === 'true';
      const clients = clientRegistry.listClients(includeStats);
      
      res.json({
        success: true,
        count: clients.length,
        clients,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * GET /admin/clients/traffic
   * Get traffic summary by client
   */
  router.get('/traffic', (req, res) => {
    try {
      const summary = clientRegistry.getTrafficSummary();
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        ...summary,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * GET /admin/clients/:clientId
   * Get specific client info
   */
  router.get('/:clientId', (req, res) => {
    try {
      const client = clientRegistry.getClient(req.params.clientId);
      const stats = clientRegistry.getClientStats(req.params.clientId);
      
      if (!client) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      
      res.json({
        success: true,
        client: {
          ...client,
          apiKey: undefined, // Don't expose API key
        },
        stats,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * POST /admin/clients
   * Register a new client
   */
  router.post('/', (req, res) => {
    try {
      const { clientId, name, description, type, endpoints, quotas, priority } = req.body;
      
      if (!clientId || !name) {
        return res.status(400).json({ 
          success: false, 
          error: 'clientId and name are required' 
        });
      }
      
      // Check if client already exists
      if (clientRegistry.getClient(clientId)) {
        return res.status(409).json({ 
          success: false, 
          error: 'Client already registered' 
        });
      }
      
      const client = clientRegistry.registerClient({
        clientId,
        name,
        description,
        type: type || 'external',
        endpoints,
        quotas,
        priority,
      });
      
      res.status(201).json({
        success: true,
        client: {
          clientId: client.clientId,
          name: client.name,
          apiKey: client.apiKey, // Return API key on registration
          endpoints: client.endpoints,
          quotas: client.quotas,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * PUT /admin/clients/:clientId/disable
   * Disable a client
   */
  router.put('/:clientId/disable', (req, res) => {
    try {
      const success = clientRegistry.disableClient(req.params.clientId);
      
      if (!success) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      
      res.json({ success: true, message: 'Client disabled' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  /**
   * PUT /admin/clients/:clientId/enable
   * Enable a client
   */
  router.put('/:clientId/enable', (req, res) => {
    try {
      const success = clientRegistry.enableClient(req.params.clientId);
      
      if (!success) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      
      res.json({ success: true, message: 'Client enabled' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  return router;
};
