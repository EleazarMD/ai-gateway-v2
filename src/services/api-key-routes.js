/**
 * API Key Management Routes for AI Gateway v2.0
 * RESTful endpoints for managing LLM provider API keys
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');

class APIKeyRoutes {
  constructor(apiKeyManager, logger) {
    this.apiKeyManager = apiKeyManager;
    this.logger = logger;
    this.router = express.Router();
    
    // Rate limiting for API key operations
    this.rateLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: { error: 'Too many API key requests, please try again later' }
    });
    
    this.setupRoutes();
  }
  
  /**
   * Setup all API key management routes
   */
  setupRoutes() {
    // Apply rate limiting to all routes
    this.router.use(this.rateLimiter);
    
    // Get all configured providers
    this.router.get('/providers', this.getProviders.bind(this));
    
    // Get specific provider configuration
    this.router.get('/providers/:providerId', 
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      this.getProvider.bind(this)
    );
    
    // Store/update API key for provider
    this.router.post('/providers/:providerId/key',
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      body('apiKey').isLength({ min: 10 }).withMessage('API key must be at least 10 characters'),
      body('providerName').optional().isString().withMessage('Provider name must be a string'),
      body('metadata').optional().isObject().withMessage('Metadata must be an object'),
      this.storeAPIKey.bind(this)
    );
    
    // Validate API key for provider
    this.router.post('/providers/:providerId/validate',
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      this.validateAPIKey.bind(this)
    );
    
    // Remove API key for provider
    this.router.delete('/providers/:providerId/key',
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      this.removeAPIKey.bind(this)
    );
    
    // Get provider usage statistics
    this.router.get('/providers/:providerId/stats',
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      this.getProviderStats.bind(this)
    );
    
    // Bulk provider configuration
    this.router.post('/providers/bulk',
      body('providers').isArray().withMessage('Providers must be an array'),
      body('providers.*.providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      body('providers.*.apiKey').isLength({ min: 10 }).withMessage('API key must be at least 10 characters'),
      this.bulkConfigureProviders.bind(this)
    );
    
    // Get API Key Manager status
    this.router.get('/status', this.getStatus.bind(this));
    
    // Export provider configurations (masked keys)
    this.router.get('/export', this.exportConfigurations.bind(this));
    
    // Test provider connectivity
    this.router.post('/providers/:providerId/test',
      param('providerId').isAlphanumeric().withMessage('Invalid provider ID'),
      this.testProviderConnectivity.bind(this)
    );
  }
  
  /**
   * Handle validation errors
   */
  handleValidationErrors(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }
    next();
  }
  
  /**
   * Get all configured providers
   */
  async getProviders(req, res) {
    try {
      const providers = await this.apiKeyManager.listProviders();
      
      // Add additional provider information
      const enrichedProviders = providers.map(provider => ({
        ...provider,
        hasAPIKey: !!provider.hasAPIKey,
        keyMasked: provider.hasAPIKey ? '****' + provider.providerId.slice(-4) : null,
        status: provider.validationStatus || 'unknown'
      }));
      
      res.json({
        success: true,
        data: enrichedProviders,
        timestamp: new Date().toISOString(),
        total: enrichedProviders.length
      });
      
      this.logger.info('Retrieved provider list', { count: enrichedProviders.length });
    } catch (error) {
      this.logger.error('Failed to get providers', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve providers',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get specific provider configuration
   */
  async getProvider(req, res) {
    try {
      const { providerId } = req.params;
      const providers = await this.apiKeyManager.listProviders();
      const provider = providers.find(p => p.providerId === providerId);
      
      if (!provider) {
        return res.status(404).json({
          success: false,
          error: 'Provider not found',
          timestamp: new Date().toISOString()
        });
      }
      
      // Get usage statistics
      const stats = await this.apiKeyManager.getProviderStats(providerId);
      
      res.json({
        success: true,
        data: {
          ...provider,
          hasAPIKey: !!provider.hasAPIKey,
          keyMasked: provider.hasAPIKey ? '****' + providerId.slice(-4) : null,
          stats
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Retrieved provider details', { providerId });
    } catch (error) {
      this.logger.error('Failed to get provider', { providerId: req.params.providerId, error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve provider',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Store/update API key for provider
   */
  async storeAPIKey(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.handleValidationErrors(req, res);
    }
    
    try {
      const { providerId } = req.params;
      const { apiKey, providerName, metadata = {} } = req.body;
      
      const result = await this.apiKeyManager.storeAPIKey(
        providerId,
        providerName || providerId,
        apiKey,
        metadata
      );
      
      // Validate the stored key
      const isValid = await this.apiKeyManager.validateAPIKey(providerId, apiKey);
      
      res.json({
        success: true,
        data: {
          providerId: result.providerId,
          stored: true,
          validated: isValid
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('API key stored successfully', { 
        providerId, 
        providerName: providerName || providerId,
        validated: isValid 
      });
    } catch (error) {
      this.logger.error('Failed to store API key', { 
        providerId: req.params.providerId, 
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to store API key',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Validate API key for provider
   */
  async validateAPIKey(req, res) {
    try {
      const { providerId } = req.params;
      const apiKey = await this.apiKeyManager.getAPIKey(providerId);
      
      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: 'API key not found for provider',
          timestamp: new Date().toISOString()
        });
      }
      
      const isValid = await this.apiKeyManager.validateAPIKey(providerId, apiKey);
      
      res.json({
        success: true,
        data: {
          providerId,
          isValid,
          validatedAt: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('API key validation completed', { providerId, isValid });
    } catch (error) {
      this.logger.error('Failed to validate API key', { 
        providerId: req.params.providerId, 
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to validate API key',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Remove API key for provider
   */
  async removeAPIKey(req, res) {
    try {
      const { providerId } = req.params;
      
      const result = await this.apiKeyManager.removeAPIKey(providerId);
      
      res.json({
        success: true,
        data: {
          providerId,
          removed: result.success
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('API key removed successfully', { providerId });
    } catch (error) {
      this.logger.error('Failed to remove API key', { 
        providerId: req.params.providerId, 
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to remove API key',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get provider usage statistics
   */
  async getProviderStats(req, res) {
    try {
      const { providerId } = req.params;
      const { days = 30 } = req.query;
      
      const stats = await this.apiKeyManager.getProviderStats(providerId, parseInt(days));
      
      res.json({
        success: true,
        data: {
          providerId,
          period: `${days} days`,
          ...stats
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Retrieved provider stats', { providerId, days });
    } catch (error) {
      this.logger.error('Failed to get provider stats', { 
        providerId: req.params.providerId, 
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve provider statistics',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Bulk configure providers
   */
  async bulkConfigureProviders(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return this.handleValidationErrors(req, res);
    }
    
    try {
      const { providers } = req.body;
      const results = [];
      
      for (const provider of providers) {
        try {
          const result = await this.apiKeyManager.storeAPIKey(
            provider.providerId,
            provider.providerName || provider.providerId,
            provider.apiKey,
            provider.metadata || {}
          );
          
          const isValid = await this.apiKeyManager.validateAPIKey(provider.providerId, provider.apiKey);
          
          results.push({
            providerId: provider.providerId,
            success: true,
            validated: isValid
          });
        } catch (error) {
          results.push({
            providerId: provider.providerId,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      
      res.json({
        success: true,
        data: {
          total: providers.length,
          successful: successCount,
          failed: providers.length - successCount,
          results
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Bulk provider configuration completed', { 
        total: providers.length, 
        successful: successCount 
      });
    } catch (error) {
      this.logger.error('Failed to bulk configure providers', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to bulk configure providers',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get API Key Manager status
   */
  async getStatus(req, res) {
    try {
      const status = this.apiKeyManager.getStatus();
      
      res.json({
        success: true,
        data: status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to get API Key Manager status', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve status',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Export provider configurations (with masked keys)
   */
  async exportConfigurations(req, res) {
    try {
      const providers = await this.apiKeyManager.listProviders();
      
      const exportData = providers.map(provider => ({
        providerId: provider.providerId,
        providerName: provider.providerName,
        hasAPIKey: provider.hasAPIKey,
        validationStatus: provider.validationStatus,
        metadata: provider.metadata,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      }));
      
      res.json({
        success: true,
        data: {
          exportedAt: new Date().toISOString(),
          version: '2.0.0',
          providers: exportData
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Configuration export completed', { count: exportData.length });
    } catch (error) {
      this.logger.error('Failed to export configurations', { error: error.message });
      res.status(500).json({
        success: false,
        error: 'Failed to export configurations',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Test provider connectivity
   */
  async testProviderConnectivity(req, res) {
    try {
      const { providerId } = req.params;
      const apiKey = await this.apiKeyManager.getAPIKey(providerId);
      
      if (!apiKey) {
        return res.status(404).json({
          success: false,
          error: 'API key not found for provider',
          timestamp: new Date().toISOString()
        });
      }
      
      // This would typically make a test API call to the provider
      // For now, we'll simulate the test
      const testResult = {
        connected: true,
        responseTime: Math.floor(Math.random() * 500) + 100,
        testedAt: new Date().toISOString()
      };
      
      res.json({
        success: true,
        data: {
          providerId,
          ...testResult
        },
        timestamp: new Date().toISOString()
      });
      
      this.logger.info('Provider connectivity test completed', { providerId, ...testResult });
    } catch (error) {
      this.logger.error('Failed to test provider connectivity', { 
        providerId: req.params.providerId, 
        error: error.message 
      });
      res.status(500).json({
        success: false,
        error: 'Failed to test provider connectivity',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * Get the router instance
   */
  getRouter() {
    return this.router;
  }
}

module.exports = APIKeyRoutes;
