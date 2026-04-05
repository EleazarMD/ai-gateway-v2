/**
 * MCP (Model Context Protocol) Service for AI Gateway v2.0
 * AI Homelab ecosystem service communication
 */

class MCPService {
  constructor(app, authenticateInternal) {
    this.app = app;
    this.authenticate = authenticateInternal;
    this.services = new Map();
    this.resources = new Map();
    this.tools = new Map();
    
    this.setupMCPEndpoints();
    this.initializeDefaultResources();
  }

  setupMCPEndpoints() {
    // MCP Service Discovery
    this.app.post('/mcp/services', this.authenticate, (req, res) => {
      try {
        const { action, service } = req.body;
        
        switch (action) {
          case 'register':
            this.registerService(service);
            res.json({
              status: 'success',
              message: 'Service registered',
              serviceId: service.id
            });
            break;
            
          case 'discover':
            const services = this.discoverServices(req.body.query);
            res.json({
              status: 'success',
              services: services
            });
            break;
            
          case 'list':
            res.json({
              status: 'success',
              services: Array.from(this.services.values())
            });
            break;
            
          default:
            res.status(400).json({ error: 'Invalid action' });
        }
      } catch (error) {
        console.error('[INTERNAL-7777] MCP services error:', error);
        res.status(500).json({ error: 'MCP service error', detail: error.message });
      }
    });

    // MCP Resource Management
    this.app.post('/mcp/resources', this.authenticate, (req, res) => {
      try {
        const { action, resource } = req.body;
        
        switch (action) {
          case 'register':
            this.registerResource(resource);
            res.json({
              status: 'success',
              message: 'Resource registered',
              resourceId: resource.id
            });
            break;
            
          case 'get':
            const resourceData = this.getResource(req.body.resourceId);
            if (resourceData) {
              res.json({
                status: 'success',
                resource: resourceData
              });
            } else {
              res.status(404).json({ error: 'Resource not found' });
            }
            break;
            
          case 'list':
            res.json({
              status: 'success',
              resources: Array.from(this.resources.values())
            });
            break;
            
          default:
            res.status(400).json({ error: 'Invalid action' });
        }
      } catch (error) {
        console.error('[INTERNAL-7777] MCP resources error:', error);
        res.status(500).json({ error: 'MCP resource error', detail: error.message });
      }
    });

    // MCP Tool Integration
    this.app.post('/mcp/tools', this.authenticate, (req, res) => {
      try {
        const { action, tool } = req.body;
        
        switch (action) {
          case 'register':
            this.registerTool(tool);
            res.json({
              status: 'success',
              message: 'Tool registered',
              toolId: tool.id
            });
            break;
            
          case 'execute':
            this.executeTool(req.body.toolId, req.body.parameters)
              .then(result => {
                res.json({
                  status: 'success',
                  result: result
                });
              })
              .catch(error => {
                res.status(500).json({ error: 'Tool execution failed', detail: error.message });
              });
            break;
            
          case 'list':
            res.json({
              status: 'success',
              tools: Array.from(this.tools.values())
            });
            break;
            
          default:
            res.status(400).json({ error: 'Invalid action' });
        }
      } catch (error) {
        console.error('[INTERNAL-7777] MCP tools error:', error);
        res.status(500).json({ error: 'MCP tool error', detail: error.message });
      }
    });

    // MCP Health Check
    this.app.get('/mcp/health', this.authenticate, (req, res) => {
      res.json({
        status: 'healthy',
        protocol: 'MCP',
        version: '1.0.0',
        services: this.services.size,
        resources: this.resources.size,
        tools: this.tools.size,
        timestamp: new Date().toISOString()
      });
    });

    console.log('[INTERNAL-7777] MCP service endpoints initialized');
  }

  registerService(service) {
    const serviceData = {
      id: service.id,
      name: service.name,
      version: service.version || '1.0.0',
      capabilities: service.capabilities || [],
      endpoints: service.endpoints || {},
      metadata: service.metadata || {},
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    this.services.set(service.id, serviceData);
    console.log(`[INTERNAL-7777] MCP service registered: ${service.id}`);
    
    return serviceData;
  }

  discoverServices(query = {}) {
    const services = Array.from(this.services.values());
    
    if (!query || Object.keys(query).length === 0) {
      return services;
    }

    return services.filter(service => {
      if (query.capability && !service.capabilities.includes(query.capability)) {
        return false;
      }
      
      if (query.name && !service.name.toLowerCase().includes(query.name.toLowerCase())) {
        return false;
      }
      
      if (query.version && service.version !== query.version) {
        return false;
      }
      
      return true;
    });
  }

  registerResource(resource) {
    const resourceData = {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      uri: resource.uri,
      description: resource.description || '',
      metadata: resource.metadata || {},
      provider: resource.provider || 'ai-gateway',
      registeredAt: new Date().toISOString()
    };

    this.resources.set(resource.id, resourceData);
    console.log(`[INTERNAL-7777] MCP resource registered: ${resource.id}`);
    
    return resourceData;
  }

  getResource(resourceId) {
    return this.resources.get(resourceId);
  }

  registerTool(tool) {
    const toolData = {
      id: tool.id,
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || {},
      handler: tool.handler,
      metadata: tool.metadata || {},
      registeredAt: new Date().toISOString()
    };

    this.tools.set(tool.id, toolData);
    console.log(`[INTERNAL-7777] MCP tool registered: ${tool.id}`);
    
    return toolData;
  }

  async executeTool(toolId, parameters = {}) {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    if (typeof tool.handler === 'function') {
      return await tool.handler(parameters);
    } else if (typeof tool.handler === 'string') {
      // Handle tool execution by endpoint or command
      return await this.executeToolByEndpoint(tool.handler, parameters);
    } else {
      throw new Error(`Invalid tool handler for: ${toolId}`);
    }
  }

  async executeToolByEndpoint(endpoint, parameters) {
    // Basic implementation for endpoint-based tool execution
    // This would be extended based on specific tool requirements
    return {
      status: 'executed',
      endpoint: endpoint,
      parameters: parameters,
      timestamp: new Date().toISOString()
    };
  }

  initializeDefaultResources() {
    // Register AI Gateway resources
    this.registerResource({
      id: 'ai-gateway-health',
      name: 'AI Gateway Health',
      type: 'health',
      uri: '/health',
      description: 'AI Gateway health status endpoint'
    });

    this.registerResource({
      id: 'ai-gateway-metrics',
      name: 'AI Gateway Metrics',
      type: 'metrics',
      uri: '/metrics',
      description: 'AI Gateway performance metrics'
    });

    this.registerResource({
      id: 'ollama-models',
      name: 'Ollama Models',
      type: 'models',
      uri: '/api/v1/models',
      description: 'Available Ollama AI models',
      metadata: {
        provider: 'ollama',
        endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434'
      }
    });

    if (process.env.PERPLEXITY_API_KEY) {
      this.registerResource({
        id: 'perplexity-search',
        name: 'Perplexity Search',
        type: 'search',
        uri: '/api/v1/perplexity/search',
        description: 'Real-time web search via Perplexity',
        metadata: {
          provider: 'perplexity',
          capabilities: ['web_search', 'citations', 'streaming']
        }
      });
    }

    // Register default tools
    this.registerTool({
      id: 'system-status',
      name: 'System Status',
      description: 'Get current system status and metrics',
      handler: () => ({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        services: this.services.size,
        resources: this.resources.size
      })
    });

    this.registerTool({
      id: 'service-discovery',
      name: 'Service Discovery',
      description: 'Discover available services',
      parameters: {
        capability: { type: 'string', optional: true },
        name: { type: 'string', optional: true }
      },
      handler: (params) => this.discoverServices(params)
    });
  }

  getStats() {
    return {
      services: this.services.size,
      resources: this.resources.size,
      tools: this.tools.size,
      protocol: 'MCP',
      version: '1.0.0'
    };
  }

  shutdown() {
    console.log('[INTERNAL-7777] Shutting down MCP service...');
    this.services.clear();
    this.resources.clear();
    this.tools.clear();
  }
}

module.exports = MCPService;
