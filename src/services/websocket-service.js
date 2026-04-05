/**
 * WebSocket Service for AI Gateway v2.0
 * Real-time metrics and events streaming for Dashboard Team
 */

const WebSocket = require('ws');

class WebSocketService {
  constructor(server, authenticateInternal) {
    this.server = server;
    this.authenticate = authenticateInternal;
    this.wss = null;
    this.metricsInterval = null;
    this.healthInterval = null;
    this.clients = new Map();
    
    // Delay WebSocket setup to ensure server is ready
    setTimeout(() => {
      this.setupWebSocketServer();
    }, 1000);
  }

  setupWebSocketServer() {
    try {
      // Check if server is ready and listening
      if (!this.server || !this.server.listening) {
        console.log('[INTERNAL-7777] Server not ready, retrying WebSocket setup in 2 seconds...');
        setTimeout(() => this.setupWebSocketServer(), 2000);
        return;
      }

      // Create WebSocket server with only the server option
      this.wss = new WebSocket.Server({ 
        server: this.server,
        path: '/ws',
        verifyClient: (info) => {
          // Basic authentication check for WebSocket upgrade
          const apiKey = info.req.headers['x-api-key'];
          const adminKey = info.req.headers['x-admin-key'];
          
          // Also check query parameters for browser compatibility
          const url = new URL(info.req.url, 'http://localhost');
          const queryApiKey = url.searchParams.get('apiKey');
          
          return apiKey || adminKey || queryApiKey; // Allow if any key is present
        }
      });
      
      console.log('[INTERNAL-7777] WebSocket server successfully initialized on /ws');
    } catch (error) {
      console.error('[INTERNAL-7777] WebSocket server initialization failed:', error.message);
      // Retry after 5 seconds
      setTimeout(() => this.setupWebSocketServer(), 5000);
      return;
    }

    this.wss.on('connection', (ws, request) => {
      const clientId = this.generateClientId();
      const clientInfo = {
        id: clientId,
        ws: ws,
        subscriptions: new Set(),
        authenticated: this.checkAuthentication(request),
        connectedAt: new Date(),
        lastPing: new Date()
      };

      this.clients.set(clientId, clientInfo);
      console.log(`[INTERNAL-7777] WebSocket client connected: ${clientId}`);

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        clientId: clientId,
        timestamp: new Date().toISOString(),
        availableChannels: ['health', 'metrics', 'events', 'security:alerts', 'security:anomalies', 'security:audit']
      }));

      // Handle incoming messages
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleClientMessage(clientId, data);
        } catch (error) {
          this.sendError(ws, 'Invalid JSON message', error.message);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.log(`[INTERNAL-7777] WebSocket client disconnected: ${clientId}`);
        this.clients.delete(clientId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[INTERNAL-7777] WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });

      // Setup ping/pong for connection health
      ws.on('pong', () => {
        if (this.clients.has(clientId)) {
          this.clients.get(clientId).lastPing = new Date();
        }
      });
    });

    // Start broadcasting intervals
    this.startBroadcasting();
    console.log('[INTERNAL-7777] WebSocket server initialized on /ws/*');
  }

  checkAuthentication(request) {
    const apiKey = request.headers['x-api-key'];
    const adminKey = request.headers['x-admin-key'];
    
    return {
      hasApiKey: !!apiKey,
      hasAdminKey: !!adminKey,
      isAdmin: adminKey === process.env.ADMIN_API_KEY
    };
  }

  generateClientId() {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  handleClientMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (data.type) {
      case 'subscribe':
        this.handleSubscription(clientId, data.channel);
        break;
      
      case 'unsubscribe':
        this.handleUnsubscription(clientId, data.channel);
        break;
      
      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        break;
      
      case 'getStatus':
        this.sendCurrentStatus(client.ws);
        break;
      
      default:
        this.sendError(client.ws, 'Unknown message type', data.type);
    }
  }

  handleSubscription(clientId, channel) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const validChannels = ['health', 'metrics', 'events', 'security:alerts', 'security:anomalies', 'security:audit'];
    if (!validChannels.includes(channel)) {
      this.sendError(client.ws, 'Invalid channel', `Available: ${validChannels.join(', ')}`);
      return;
    }

    client.subscriptions.add(channel);
    client.ws.send(JSON.stringify({
      type: 'subscribed',
      channel: channel,
      timestamp: new Date().toISOString()
    }));

    console.log(`[INTERNAL-7777] Client ${clientId} subscribed to ${channel}`);
  }

  handleUnsubscription(clientId, channel) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscriptions.delete(channel);
    client.ws.send(JSON.stringify({
      type: 'unsubscribed',
      channel: channel,
      timestamp: new Date().toISOString()
    }));

    console.log(`[INTERNAL-7777] Client ${clientId} unsubscribed from ${channel}`);
  }

  sendError(ws, error, detail) {
    ws.send(JSON.stringify({
      type: 'error',
      error: error,
      detail: detail,
      timestamp: new Date().toISOString()
    }));
  }

  sendCurrentStatus(ws) {
    const status = {
      type: 'status',
      data: {
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        },
        websocket: {
          connectedClients: this.clients.size,
          totalConnections: this.clients.size
        }
      },
      timestamp: new Date().toISOString()
    };

    ws.send(JSON.stringify(status));
  }

  startBroadcasting() {
    // Broadcast health metrics every 10 seconds
    this.healthInterval = setInterval(() => {
      this.broadcastToChannel('health', {
        type: 'health',
        data: {
          status: 'healthy',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
          services: {
            ollama: process.env.OLLAMA_HOST || 'http://localhost:11434',
            perplexity: !!process.env.PERPLEXITY_API_KEY
          }
        }
      });
    }, 10000);

    // Broadcast detailed metrics every 30 seconds
    this.metricsInterval = setInterval(() => {
      this.broadcastToChannel('metrics', {
        type: 'metrics',
        data: {
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          ports: {
            internal: process.env.INTERNAL_PORT || 7777,
            external: process.env.EXTERNAL_PORT || 8777
          },
          websocket: {
            connectedClients: this.clients.size,
            subscriptions: this.getSubscriptionStats()
          },
          connections: {
            ollama: process.env.OLLAMA_HOST || 'http://localhost:11434',
            perplexity_configured: !!process.env.PERPLEXITY_API_KEY
          }
        }
      });
    }, 30000);

    // Connection health check every 60 seconds
    setInterval(() => {
      this.clients.forEach((client, clientId) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        } else {
          this.clients.delete(clientId);
        }
      });
    }, 60000);
  }

  broadcastToChannel(channel, message) {
    let broadcastCount = 0;
    
    this.clients.forEach((client) => {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
        broadcastCount++;
      }
    });

    if (broadcastCount > 0) {
      console.log(`[INTERNAL-7777] Broadcasted ${channel} to ${broadcastCount} clients`);
    }
  }

  broadcastEvent(eventType, eventData) {
    const event = {
      type: 'event',
      eventType: eventType,
      data: eventData,
      timestamp: new Date().toISOString()
    };

    this.broadcastToChannel('events', event);
  }

  getSubscriptionStats() {
    const stats = { 
      health: 0, 
      metrics: 0, 
      events: 0,
      'security:alerts': 0,
      'security:anomalies': 0,
      'security:audit': 0
    };
    
    this.clients.forEach((client) => {
      client.subscriptions.forEach((channel) => {
        if (stats[channel] !== undefined) {
          stats[channel]++;
        }
      });
    });

    return stats;
  }

  /**
   * Broadcast alert event to subscribed clients
   */
  broadcastAlert(alert) {
    const message = {
      type: 'security:alert',
      data: {
        alert_id: alert.alert_id || alert.alertId,
        rule_id: alert.rule_id || alert.ruleId,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        status: alert.status,
        triggered_at: alert.triggered_at || alert.triggeredAt,
        context: alert.context
      },
      timestamp: new Date().toISOString()
    };

    this.broadcastToChannel('security:alerts', message);
    console.log(`[WebSocket] Broadcasted alert: ${alert.title} (${alert.severity})`);
  }

  /**
   * Broadcast anomaly event to subscribed clients
   */
  broadcastAnomaly(anomaly) {
    const message = {
      type: 'security:anomaly',
      data: {
        anomaly_id: anomaly.anomaly_id || anomaly.anomalyId,
        anomaly_type: anomaly.anomaly_type || anomaly.anomalyType,
        severity: anomaly.severity,
        description: anomaly.description,
        detected_at: anomaly.detected_at || anomaly.detectedAt,
        status: anomaly.status,
        context: anomaly.context
      },
      timestamp: new Date().toISOString()
    };

    this.broadcastToChannel('security:anomalies', message);
    console.log(`[WebSocket] Broadcasted anomaly: ${anomaly.anomaly_type} (${anomaly.severity})`);
  }

  /**
   * Broadcast audit event to subscribed clients
   */
  broadcastAuditEvent(auditEvent) {
    const message = {
      type: 'security:audit',
      data: {
        event_id: auditEvent.event_id || auditEvent.eventId,
        event_type: auditEvent.event_type || auditEvent.eventType,
        actor: auditEvent.actor,
        action: auditEvent.action,
        resource: auditEvent.resource,
        outcome: auditEvent.outcome,
        severity: auditEvent.severity,
        timestamp: auditEvent.timestamp
      },
      timestamp: new Date().toISOString()
    };

    this.broadcastToChannel('security:audit', message);
  }

  getStats() {
    return {
      connectedClients: this.clients.size,
      subscriptions: this.getSubscriptionStats(),
      uptime: process.uptime()
    };
  }

  shutdown() {
    console.log('[INTERNAL-7777] Shutting down WebSocket service...');
    
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    
    // Close all client connections
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1000, 'Server shutdown');
      }
    });
    
    this.clients.clear();
    
    if (this.wss) {
      this.wss.close();
    }
  }
}

module.exports = WebSocketService;
