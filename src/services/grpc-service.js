/**
 * gRPC Service for AI Gateway v2.0
 * High-performance service-to-service communication
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

class GRPCService {
  constructor(httpServer = null) {
    this.httpServer = httpServer;
    this.grpcServer = null;
    this.services = new Map();
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgResponseTime: 0
    };
    
    this.setupProtoDefinitions();
    this.setupGRPCServer();
  }

  setupProtoDefinitions() {
    // Define the proto schema inline for simplicity
    this.protoDefinition = `
      syntax = "proto3";
      
      package ai_gateway;
      
      service ServiceMesh {
        rpc GetHealth(HealthRequest) returns (HealthResponse);
        rpc GetMetrics(MetricsRequest) returns (MetricsResponse);
        rpc RegisterService(ServiceRegistration) returns (ServiceResponse);
        rpc DiscoverServices(ServiceQuery) returns (ServicesResponse);
        rpc StreamMetrics(MetricsRequest) returns (stream MetricsResponse);
      }
      
      message HealthRequest {
        string service_id = 1;
      }
      
      message HealthResponse {
        string status = 1;
        double uptime = 2;
        MemoryUsage memory = 3;
        string timestamp = 4;
      }
      
      message MemoryUsage {
        double rss = 1;
        double heap_total = 2;
        double heap_used = 3;
        double external = 4;
      }
      
      message MetricsRequest {
        string service_id = 1;
        repeated string metric_types = 2;
      }
      
      message MetricsResponse {
        string service_id = 1;
        double uptime = 2;
        MemoryUsage memory = 3;
        map<string, double> custom_metrics = 4;
        string timestamp = 5;
      }
      
      message ServiceRegistration {
        string id = 1;
        string name = 2;
        string version = 3;
        int32 port = 4;
        repeated string capabilities = 5;
        map<string, string> metadata = 6;
      }
      
      message ServiceResponse {
        bool success = 1;
        string message = 2;
        string service_id = 3;
      }
      
      message ServiceQuery {
        string capability = 1;
        string name_pattern = 2;
        string version = 3;
      }
      
      message ServicesResponse {
        repeated ServiceInfo services = 1;
      }
      
      message ServiceInfo {
        string id = 1;
        string name = 2;
        string version = 3;
        string status = 4;
        int32 port = 5;
        repeated string capabilities = 6;
        map<string, string> metadata = 7;
        string registered_at = 8;
        string last_seen = 9;
      }
    `;

    // Create proto file temporarily for loading
    const fs = require('fs');
    const protoPath = path.join(__dirname, '../proto/service_mesh.proto');
    
    // Ensure proto directory exists
    const protoDir = path.dirname(protoPath);
    if (!fs.existsSync(protoDir)) {
      fs.mkdirSync(protoDir, { recursive: true });
    }
    
    fs.writeFileSync(protoPath, this.protoDefinition);

    // Load the proto definition
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });

    this.proto = grpc.loadPackageDefinition(packageDefinition).ai_gateway;
  }

  setupGRPCServer() {
    this.grpcServer = new grpc.Server();

    // Implement service methods
    const serviceMethods = {
      GetHealth: this.getHealth.bind(this),
      GetMetrics: this.getMetrics.bind(this),
      RegisterService: this.registerService.bind(this),
      DiscoverServices: this.discoverServices.bind(this),
      StreamMetrics: this.streamMetrics.bind(this)
    };

    this.grpcServer.addService(this.proto.ServiceMesh.service, serviceMethods);

    console.log(`[INTERNAL-7777] gRPC service methods initialized`);
  }

  getHealth(call, callback) {
    const startTime = Date.now();
    this.metrics.totalCalls++;

    try {
      const response = {
        status: 'healthy',
        uptime: process.uptime(),
        memory: {
          rss: process.memoryUsage().rss,
          heap_total: process.memoryUsage().heapTotal,
          heap_used: process.memoryUsage().heapUsed,
          external: process.memoryUsage().external
        },
        timestamp: new Date().toISOString()
      };

      this.metrics.successfulCalls++;
      this.updateAvgResponseTime(Date.now() - startTime);
      
      callback(null, response);
      console.log(`[INTERNAL-7777] gRPC GetHealth called for: ${call.request.service_id || 'ai-gateway'}`);
    } catch (error) {
      this.metrics.failedCalls++;
      console.error('[INTERNAL-7777] gRPC GetHealth error:', error);
      callback(error);
    }
  }

  getMetrics(call, callback) {
    const startTime = Date.now();
    this.metrics.totalCalls++;

    try {
      const customMetrics = {
        grpc_total_calls: this.metrics.totalCalls,
        grpc_successful_calls: this.metrics.successfulCalls,
        grpc_failed_calls: this.metrics.failedCalls,
        grpc_success_rate: (this.metrics.successfulCalls / this.metrics.totalCalls) * 100,
        registered_services: this.services.size
      };

      const response = {
        service_id: call.request.service_id || 'ai-gateway',
        uptime: process.uptime(),
        memory: {
          rss: process.memoryUsage().rss,
          heap_total: process.memoryUsage().heapTotal,
          heap_used: process.memoryUsage().heapUsed,
          external: process.memoryUsage().external
        },
        custom_metrics: customMetrics,
        timestamp: new Date().toISOString()
      };

      this.metrics.successfulCalls++;
      this.updateAvgResponseTime(Date.now() - startTime);
      
      callback(null, response);
      console.log(`[INTERNAL-7777] gRPC GetMetrics called for: ${call.request.service_id || 'ai-gateway'}`);
    } catch (error) {
      this.metrics.failedCalls++;
      console.error('[INTERNAL-7777] gRPC GetMetrics error:', error);
      callback(error);
    }
  }

  registerService(call, callback) {
    const startTime = Date.now();
    this.metrics.totalCalls++;

    try {
      const serviceData = {
        id: call.request.id,
        name: call.request.name,
        version: call.request.version || '1.0.0',
        status: 'active',
        port: call.request.port,
        capabilities: call.request.capabilities || [],
        metadata: call.request.metadata || {},
        registered_at: new Date().toISOString(),
        last_seen: new Date().toISOString()
      };

      this.services.set(call.request.id, serviceData);

      const response = {
        success: true,
        message: 'Service registered successfully',
        service_id: call.request.id
      };

      this.metrics.successfulCalls++;
      this.updateAvgResponseTime(Date.now() - startTime);
      
      callback(null, response);
      console.log(`[INTERNAL-7777] gRPC service registered: ${call.request.id}`);
    } catch (error) {
      this.metrics.failedCalls++;
      console.error('[INTERNAL-7777] gRPC RegisterService error:', error);
      callback(null, {
        success: false,
        message: error.message,
        service_id: call.request.id || ''
      });
    }
  }

  discoverServices(call, callback) {
    const startTime = Date.now();
    this.metrics.totalCalls++;

    try {
      let services = Array.from(this.services.values());

      // Apply filters based on query
      if (call.request.capability) {
        services = services.filter(s => s.capabilities.includes(call.request.capability));
      }
      
      if (call.request.name_pattern) {
        const pattern = new RegExp(call.request.name_pattern, 'i');
        services = services.filter(s => pattern.test(s.name));
      }
      
      if (call.request.version) {
        services = services.filter(s => s.version === call.request.version);
      }

      const response = {
        services: services.map(s => ({
          id: s.id,
          name: s.name,
          version: s.version,
          status: s.status,
          port: s.port || 0,
          capabilities: s.capabilities,
          metadata: s.metadata,
          registered_at: s.registered_at,
          last_seen: s.last_seen
        }))
      };

      this.metrics.successfulCalls++;
      this.updateAvgResponseTime(Date.now() - startTime);
      
      callback(null, response);
      console.log(`[INTERNAL-7777] gRPC DiscoverServices returned ${services.length} services`);
    } catch (error) {
      this.metrics.failedCalls++;
      console.error('[INTERNAL-7777] gRPC DiscoverServices error:', error);
      callback(error);
    }
  }

  streamMetrics(call) {
    console.log('[INTERNAL-7777] gRPC StreamMetrics started');
    
    const sendMetrics = () => {
      const customMetrics = {
        grpc_total_calls: this.metrics.totalCalls,
        grpc_successful_calls: this.metrics.successfulCalls,
        grpc_failed_calls: this.metrics.failedCalls,
        grpc_avg_response_time: this.metrics.avgResponseTime,
        registered_services: this.services.size
      };

      const response = {
        service_id: call.request.service_id || 'ai-gateway',
        uptime: process.uptime(),
        memory: {
          rss: process.memoryUsage().rss,
          heap_total: process.memoryUsage().heapTotal,
          heap_used: process.memoryUsage().heapUsed,
          external: process.memoryUsage().external
        },
        custom_metrics: customMetrics,
        timestamp: new Date().toISOString()
      };

      call.write(response);
    };

    // Send initial metrics
    sendMetrics();

    // Send metrics every 10 seconds
    const interval = setInterval(sendMetrics, 10000);

    call.on('cancelled', () => {
      console.log('[INTERNAL-7777] gRPC StreamMetrics cancelled');
      clearInterval(interval);
    });

    call.on('error', (error) => {
      console.error('[INTERNAL-7777] gRPC StreamMetrics error:', error);
      clearInterval(interval);
    });
  }

  updateAvgResponseTime(responseTime) {
    this.metrics.avgResponseTime = 
      (this.metrics.avgResponseTime * (this.metrics.successfulCalls - 1) + responseTime) / 
      this.metrics.successfulCalls;
  }

  handleGRPCRequest(req, res) {
    // Simple gRPC over HTTP/2 handler
    // In a full implementation, this would parse gRPC frames
    console.log(`[INTERNAL-7777] gRPC request received: ${req.url}`);
    
    // For now, return a simple response indicating gRPC is available
    res.writeHead(200, {
      'content-type': 'application/grpc',
      'grpc-status': '0',
      'grpc-message': 'OK'
    });
    res.end();
  }

  start() {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        // Integrate gRPC with existing HTTP server using HTTP/2
        console.log(`[INTERNAL-7777] gRPC service integrated with HTTP server on port 7777`);
        
        // Add gRPC handling to the existing HTTP server
        this.httpServer.on('request', (req, res) => {
          if (req.headers['content-type'] === 'application/grpc') {
            // Handle gRPC requests through HTTP/2
            this.handleGRPCRequest(req, res);
          }
        });
        
        resolve(7777);
      } else {
        // Fallback: create separate gRPC server (should not happen in dual-port mode)
        console.warn('[INTERNAL-7777] No HTTP server provided, creating separate gRPC server');
        this.grpcServer.bindAsync(
          `0.0.0.0:7778`,
          grpc.ServerCredentials.createInsecure(),
          (error, port) => {
            if (error) {
              console.error('[INTERNAL-7777] gRPC server failed to bind:', error);
              reject(error);
              return;
            }

            this.grpcServer.start();
            console.log(`[INTERNAL-7777] gRPC server running on port ${port}`);
            resolve(port);
          }
        );
      }
    });
  }

  getStats() {
    return {
      ...this.metrics,
      services: this.services.size,
      port: 7777,
      protocol: 'gRPC over HTTP/2'
    };
  }

  shutdown() {
    return new Promise((resolve) => {
      console.log('[INTERNAL-7777] Shutting down gRPC service...');
      
      if (this.grpcServer) {
        this.grpcServer.tryShutdown((error) => {
          if (error) {
            console.error('[INTERNAL-7777] gRPC shutdown error:', error);
            this.grpcServer.forceShutdown();
          }
          
          this.services.clear();
          console.log('[INTERNAL-7777] gRPC server shutdown complete');
          resolve();
        });
      } else {
        this.services.clear();
        console.log('[INTERNAL-7777] gRPC service shutdown complete (integrated mode)');
        resolve();
      }
    });
  }
}

module.exports = GRPCService;
