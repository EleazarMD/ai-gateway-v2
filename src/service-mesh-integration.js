/**
 * Service Mesh Integration Layer for AI Gateway v2.0
 * Manages WebSocket, MCP, GraphQL, and gRPC services
 */

const WebSocketService = require('./services/websocket-service');
const MCPService = require('./services/mcp-service');
const GraphQLService = require('./services/graphql-service');
const GRPCService = require('./services/grpc-service');

class ServiceMeshIntegration {
  constructor(internalApp, internalServer, authenticateInternal) {
    this.app = internalApp;
    this.server = internalServer;
    this.authenticate = authenticateInternal;
    this.services = {};
    this.stats = {
      initialized: false,
      protocols: [],
      startTime: new Date().toISOString()
    };
  }

  async initialize() {
    console.log('[INTERNAL-7777] Initializing Service Mesh protocols...');

    try {
      // Initialize WebSocket service
      this.services.websocket = new WebSocketService(this.server, this.authenticate);
      this.stats.protocols.push('WebSocket');

      // Initialize MCP service
      this.services.mcp = new MCPService(this.app, this.authenticate);
      this.stats.protocols.push('MCP');

      // Initialize GraphQL service
      this.services.graphql = new GraphQLService(this.app, this.authenticate);
      this.stats.protocols.push('GraphQL');

      // Initialize gRPC service (integrated with HTTP/2 on port 7777)
      this.services.grpc = new GRPCService(this.server);
      await this.services.grpc.start();
      this.stats.protocols.push('gRPC');

      this.stats.initialized = true;
      console.log(`[INTERNAL-7777] Service Mesh protocols initialized: ${this.stats.protocols.join(', ')}`);

      // Register AI Gateway itself as a service
      this.registerAIGatewayService();

      // Add service mesh status endpoint
      this.addServiceMeshEndpoints();

    } catch (error) {
      console.error('[INTERNAL-7777] Service Mesh initialization error:', error);
      throw error;
    }
  }

  registerAIGatewayService() {
    const aiGatewayService = {
      id: 'ai-gateway-v2-dual-port',
      name: 'AI Gateway v2.0',
      version: '2.0.0',
      capabilities: [
        'http', 'websocket', 'mcp', 'graphql', 'grpc',
        'ai-inference', 'service-mesh', 'health-monitoring',
        'ollama-proxy', 'perplexity-integration'
      ],
      metadata: {
        provider: 'ai-homelab',
        environment: process.env.NODE_ENV || 'development',
        ports: {
          internal: process.env.INTERNAL_PORT || 7777,
          external: process.env.EXTERNAL_PORT || 8777
        }
      }
    };

    // Register with MCP service
    if (this.services.mcp) {
      this.services.mcp.registerService(aiGatewayService);
    }

    // Register with GraphQL service
    if (this.services.graphql) {
      this.services.graphql.registerService(aiGatewayService);
    }

    console.log('[INTERNAL-7777] AI Gateway registered with service mesh');
  }

  addServiceMeshEndpoints() {
    // Service mesh protocol status endpoint
    this.app.get('/protocols', this.authenticate, (req, res) => {
      res.json({
        status: 'operational',
        protocols: this.getProtocolStatus(),
        stats: this.getOverallStats(),
        timestamp: new Date().toISOString()
      });
    });

    // WebSocket connection info
    this.app.get('/ws/info', this.authenticate, (req, res) => {
      res.json({
        endpoint: '/ws/*',
        channels: ['health', 'metrics', 'events'],
        authentication: 'X-API-Key or X-Admin-Key header required',
        example: {
          connect: 'ws://localhost:7777/ws',
          subscribe: { type: 'subscribe', channel: 'health' },
          unsubscribe: { type: 'unsubscribe', channel: 'health' }
        },
        stats: this.services.websocket ? this.services.websocket.getStats() : null
      });
    });

    // MCP protocol info
    this.app.get('/mcp/info', this.authenticate, (req, res) => {
      res.json({
        endpoints: ['/mcp/services', '/mcp/resources', '/mcp/tools', '/mcp/health'],
        authentication: 'X-API-Key or X-Admin-Key header required',
        version: '1.0.0',
        stats: this.services.mcp ? this.services.mcp.getStats() : null
      });
    });

    // GraphQL schema info
    this.app.get('/graphql/info', this.authenticate, (req, res) => {
      res.json({
        endpoint: '/graphql',
        schema: 'service_mesh_v1',
        authentication: 'X-API-Key or X-Admin-Key header required',
        graphiql: process.env.NODE_ENV === 'development',
        stats: this.services.graphql ? this.services.graphql.getStats() : null
      });
    });

    // gRPC service info
    this.app.get('/grpc/info', this.authenticate, (req, res) => {
      res.json({
        port: 7778,
        service: 'ai_gateway.ServiceMesh',
        methods: [
          'GetHealth', 'GetMetrics', 'RegisterService', 
          'DiscoverServices', 'StreamMetrics'
        ],
        authentication: 'Metadata-based authentication',
        stats: this.services.grpc ? this.services.grpc.getStats() : null
      });
    });

    console.log('[INTERNAL-7777] Service mesh status endpoints added');
  }

  getProtocolStatus() {
    return {
      http: { status: 'active', port: process.env.INTERNAL_PORT || 7777 },
      websocket: { 
        status: this.services.websocket ? 'active' : 'inactive',
        endpoint: '/ws/*',
        clients: this.services.websocket ? this.services.websocket.getStats().connectedClients : 0
      },
      mcp: { 
        status: this.services.mcp ? 'active' : 'inactive',
        endpoints: ['/mcp/services', '/mcp/resources', '/mcp/tools'],
        services: this.services.mcp ? this.services.mcp.getStats().services : 0
      },
      graphql: { 
        status: this.services.graphql ? 'active' : 'inactive',
        endpoint: '/graphql',
        services: this.services.graphql ? this.services.graphql.getStats().services : 0
      },
      grpc: { 
        status: this.services.grpc ? 'active' : 'inactive',
        port: 7778,
        calls: this.services.grpc ? this.services.grpc.getStats().totalCalls : 0
      }
    };
  }

  getOverallStats() {
    return {
      initialized: this.stats.initialized,
      protocols: this.stats.protocols,
      startTime: this.stats.startTime,
      uptime: process.uptime(),
      services: {
        websocket: this.services.websocket ? this.services.websocket.getStats() : null,
        mcp: this.services.mcp ? this.services.mcp.getStats() : null,
        graphql: this.services.graphql ? this.services.graphql.getStats() : null,
        grpc: this.services.grpc ? this.services.grpc.getStats() : null
      }
    };
  }

  // Method to broadcast events to WebSocket clients
  broadcastEvent(eventType, eventData) {
    if (this.services.websocket) {
      this.services.websocket.broadcastEvent(eventType, eventData);
    }
  }

  // Method to register services across all protocols
  registerService(serviceData) {
    const results = {};

    if (this.services.mcp) {
      results.mcp = this.services.mcp.registerService(serviceData);
    }

    if (this.services.graphql) {
      results.graphql = this.services.graphql.registerService(serviceData);
    }

    // Broadcast service registration event
    this.broadcastEvent('service_registered', {
      service_id: serviceData.id,
      name: serviceData.name,
      timestamp: new Date().toISOString()
    });

    return results;
  }

  async shutdown() {
    console.log('[INTERNAL-7777] Shutting down Service Mesh protocols...');

    // Shutdown in reverse order
    if (this.services.grpc) {
      await this.services.grpc.shutdown();
    }

    if (this.services.graphql) {
      this.services.graphql.shutdown();
    }

    if (this.services.mcp) {
      this.services.mcp.shutdown();
    }

    if (this.services.websocket) {
      this.services.websocket.shutdown();
    }

    this.stats.initialized = false;
    console.log('[INTERNAL-7777] Service Mesh protocols shutdown complete');
  }
}

module.exports = ServiceMeshIntegration;
