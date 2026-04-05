/**
 * GraphQL Service for AI Gateway v2.0
 * Structured service mesh queries and subscriptions
 */

const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');

class GraphQLService {
  constructor(app, authenticateInternal) {
    this.app = app;
    this.authenticate = authenticateInternal;
    this.services = new Map();
    this.metrics = {
      queries: 0,
      mutations: 0,
      subscriptions: 0,
      errors: 0
    };
    
    this.setupGraphQLSchema();
    this.setupGraphQLEndpoint();
  }

  setupGraphQLSchema() {
    this.schema = buildSchema(`
      type Service {
        id: String!
        name: String!
        version: String!
        status: String!
        port: Int
        capabilities: [String!]!
        metadata: ServiceMetadata
        health: HealthStatus
        metrics: ServiceMetrics
        registeredAt: String!
        lastSeen: String!
      }

      type ServiceMetadata {
        provider: String
        environment: String
        cluster: String
        namespace: String
      }

      type HealthStatus {
        status: String!
        uptime: Float!
        memory: MemoryUsage!
        timestamp: String!
      }

      type MemoryUsage {
        rss: Float!
        heapTotal: Float!
        heapUsed: Float!
        external: Float!
      }

      type ServiceMetrics {
        requestCount: Int!
        errorCount: Int!
        avgResponseTime: Float!
        lastRequestAt: String
      }

      type SystemHealth {
        status: String!
        uptime: Float!
        memory: MemoryUsage!
        services: Int!
        ports: PortConfiguration!
        timestamp: String!
      }

      type PortConfiguration {
        internal: Int!
        external: Int!
      }

      type Connection {
        name: String!
        endpoint: String!
        status: String!
        configured: Boolean!
      }

      type Query {
        services: [Service!]!
        service(id: String!): Service
        systemHealth: SystemHealth!
        connections: [Connection!]!
        metrics: SystemMetrics!
      }

      type SystemMetrics {
        uptime: Float!
        memory: MemoryUsage!
        graphql: GraphQLMetrics!
        timestamp: String!
      }

      type GraphQLMetrics {
        queries: Int!
        mutations: Int!
        subscriptions: Int!
        errors: Int!
      }

      type Mutation {
        registerService(input: ServiceInput!): Service!
        updateServiceStatus(id: String!, status: String!): Service!
        removeService(id: String!): Boolean!
      }

      input ServiceInput {
        id: String!
        name: String!
        version: String
        port: Int
        capabilities: [String!]
        metadata: ServiceMetadataInput
      }

      input ServiceMetadataInput {
        provider: String
        environment: String
        cluster: String
        namespace: String
      }
    `);

    this.resolvers = {
      services: () => {
        this.metrics.queries++;
        return Array.from(this.services.values()).map(service => ({
          ...service,
          health: this.getServiceHealth(service.id),
          metrics: this.getServiceMetrics(service.id)
        }));
      },

      service: ({ id }) => {
        this.metrics.queries++;
        const service = this.services.get(id);
        if (!service) return null;
        
        return {
          ...service,
          health: this.getServiceHealth(id),
          metrics: this.getServiceMetrics(id)
        };
      },

      systemHealth: () => {
        this.metrics.queries++;
        return {
          status: 'healthy',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          services: this.services.size,
          ports: {
            internal: parseInt(process.env.INTERNAL_PORT) || 7777,
            external: parseInt(process.env.EXTERNAL_PORT) || 8777
          },
          timestamp: new Date().toISOString()
        };
      },

      connections: () => {
        this.metrics.queries++;
        return [
          {
            name: 'Ollama',
            endpoint: process.env.OLLAMA_HOST || 'http://localhost:11434',
            status: 'connected', // This would be checked dynamically
            configured: true
          },
          {
            name: 'Perplexity',
            endpoint: 'https://api.perplexity.ai',
            status: process.env.PERPLEXITY_API_KEY ? 'connected' : 'not_configured',
            configured: !!process.env.PERPLEXITY_API_KEY
          }
        ];
      },

      metrics: () => {
        this.metrics.queries++;
        return {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          graphql: { ...this.metrics },
          timestamp: new Date().toISOString()
        };
      },

      registerService: ({ input }) => {
        this.metrics.mutations++;
        const service = {
          id: input.id,
          name: input.name,
          version: input.version || '1.0.0',
          status: 'active',
          port: input.port,
          capabilities: input.capabilities || [],
          metadata: input.metadata || {},
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };

        this.services.set(input.id, service);
        console.log(`[INTERNAL-7777] GraphQL: Service registered via mutation: ${input.id}`);
        
        return {
          ...service,
          health: this.getServiceHealth(service.id),
          metrics: this.getServiceMetrics(service.id)
        };
      },

      updateServiceStatus: ({ id, status }) => {
        this.metrics.mutations++;
        const service = this.services.get(id);
        if (!service) {
          this.metrics.errors++;
          throw new Error(`Service not found: ${id}`);
        }

        service.status = status;
        service.lastSeen = new Date().toISOString();
        this.services.set(id, service);

        console.log(`[INTERNAL-7777] GraphQL: Service status updated: ${id} -> ${status}`);
        
        return {
          ...service,
          health: this.getServiceHealth(id),
          metrics: this.getServiceMetrics(id)
        };
      },

      removeService: ({ id }) => {
        this.metrics.mutations++;
        const deleted = this.services.delete(id);
        
        if (deleted) {
          console.log(`[INTERNAL-7777] GraphQL: Service removed: ${id}`);
        } else {
          this.metrics.errors++;
        }
        
        return deleted;
      }
    };
  }

  setupGraphQLEndpoint() {
    // GraphQL endpoint with authentication
    this.app.use('/graphql', this.authenticate, (req, res, next) => {
      // Add request context
      req.context = {
        timestamp: new Date().toISOString(),
        clientIP: req.ip,
        userAgent: req.get('User-Agent')
      };
      next();
    });

    this.app.use('/graphql', graphqlHTTP((req) => ({
      schema: this.schema,
      rootValue: this.resolvers,
      graphiql: process.env.NODE_ENV === 'development', // Enable GraphiQL in development
      context: req.context,
      customFormatErrorFn: (error) => {
        this.metrics.errors++;
        console.error('[INTERNAL-7777] GraphQL error:', error);
        return {
          message: error.message,
          locations: error.locations,
          path: error.path,
          timestamp: new Date().toISOString()
        };
      }
    })));

    console.log('[INTERNAL-7777] GraphQL endpoint initialized at /graphql');
    if (process.env.NODE_ENV === 'development') {
      console.log('[INTERNAL-7777] GraphiQL interface available at /graphql');
    }
  }

  getServiceHealth(serviceId) {
    // Mock health data - in production this would query actual service health
    return {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  getServiceMetrics(serviceId) {
    // Mock metrics data - in production this would query actual service metrics
    return {
      requestCount: Math.floor(Math.random() * 1000),
      errorCount: Math.floor(Math.random() * 10),
      avgResponseTime: Math.random() * 100,
      lastRequestAt: new Date().toISOString()
    };
  }

  // Method to register services from other components
  registerService(serviceData) {
    const service = {
      id: serviceData.id,
      name: serviceData.name,
      version: serviceData.version || '1.0.0',
      status: serviceData.status || 'active',
      port: serviceData.port,
      capabilities: serviceData.capabilities || [],
      metadata: serviceData.metadata || {},
      registeredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    this.services.set(serviceData.id, service);
    console.log(`[INTERNAL-7777] GraphQL: Service registered programmatically: ${serviceData.id}`);
    
    return service;
  }

  // Method to update service status
  updateServiceStatus(serviceId, status) {
    const service = this.services.get(serviceId);
    if (service) {
      service.status = status;
      service.lastSeen = new Date().toISOString();
      this.services.set(serviceId, service);
    }
    return service;
  }

  getStats() {
    return {
      services: this.services.size,
      metrics: { ...this.metrics },
      endpoint: '/graphql',
      schema: 'service_mesh_v1'
    };
  }

  shutdown() {
    console.log('[INTERNAL-7777] Shutting down GraphQL service...');
    this.services.clear();
    this.metrics = { queries: 0, mutations: 0, subscriptions: 0, errors: 0 };
  }
}

module.exports = GraphQLService;
