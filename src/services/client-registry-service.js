/**
 * Client Registry Service for AI Gateway v2.5
 * 
 * Fetches registered services from AI Inferencing Service (port 9000)
 * and tracks request statistics per client.
 * 
 * AI Inferencing is the source of truth for:
 * - Project → Service → Provider → API Key hierarchy
 * - Service registration and management
 * 
 * This service provides:
 * - Request attribution and tracking
 * - Usage statistics per client
 * - Traffic analytics for monitoring dashboard
 */

const crypto = require('crypto');
const EventEmitter = require('events');

class ClientRegistryService extends EventEmitter {
  constructor(aiInferencingClient = null) {
    super();
    
    this.aiInferencingClient = aiInferencingClient;
    this.aiInferencingUrl = process.env.AI_INFERENCING_URL || 'http://localhost:9000';
    this.adminKey = process.env.AI_INFERENCING_API_KEY || 'ai-inferencing-admin-key-2024';
    
    this.clients = new Map();
    this.clientStats = new Map();
    this.lastSync = null;
    this.syncInterval = 60000; // Sync every minute
    
    // Initial sync from AI Inferencing
    this.syncFromAIInferencing();
    
    // Periodic sync
    setInterval(() => this.syncFromAIInferencing(), this.syncInterval);
    
    console.log(`[Client Registry] Initialized - syncing from AI Inferencing at ${this.aiInferencingUrl}`);
  }
  
  /**
   * Sync registered services from AI Inferencing
   */
  async syncFromAIInferencing() {
    try {
      const response = await fetch(`${this.aiInferencingUrl}/api/v1/admin/keys/services`, {
        headers: {
          'X-Admin-Key': this.adminKey,
          'X-Service-ID': 'ai-gateway',
        },
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        console.warn(`[Client Registry] Failed to sync from AI Inferencing: ${response.status}`);
        return;
      }
      
      const data = await response.json();
      const services = data.services || [];
      
      for (const service of services) {
        if (!this.clients.has(service.service_id)) {
          this.registerClient({
            clientId: service.service_id,
            name: service.name,
            description: service.description,
            projectId: service.project_id,
            projectName: service.project_name,
            type: 'registered',
            status: service.status,
            keyCount: parseInt(service.key_count) || 0,
            registeredAt: service.created_at,
            isInternal: true,
          });
        }
      }
      
      this.lastSync = new Date().toISOString();
      console.log(`[Client Registry] Synced ${services.length} services from AI Inferencing`);
    } catch (e) {
      console.warn(`[Client Registry] Sync failed: ${e.message}`);
    }
  }
  
  /**
   * Generate a client API key
   */
  generateClientKey(clientId) {
    const prefix = 'aig_';
    const hash = crypto.createHash('sha256')
      .update(clientId + process.env.CLIENT_KEY_SECRET || 'default-secret')
      .digest('hex')
      .substring(0, 32);
    return prefix + hash;
  }
  
  /**
   * Register a new client
   */
  registerClient(clientData) {
    const client = {
      clientId: clientData.clientId,
      name: clientData.name,
      description: clientData.description || '',
      type: clientData.type || 'external',
      apiKey: clientData.apiKey || this.generateClientKey(clientData.clientId),
      endpoints: clientData.endpoints || ['/v1/chat/completions'],
      quotas: clientData.quotas || { requestsPerMinute: 10, tokensPerDay: 100000 },
      priority: clientData.priority || 'low',
      routingPreferences: clientData.routingPreferences || {},
      registeredAt: clientData.registeredAt || new Date().toISOString(),
      lastActivity: null,
      isActive: true,
      isInternal: clientData.isInternal || false,
    };
    
    this.clients.set(client.clientId, client);
    this.clientStats.set(client.clientId, {
      totalRequests: 0,
      totalTokens: 0,
      totalCost: 0,
      requestsToday: 0,
      tokensToday: 0,
      lastReset: new Date().toISOString(),
      recentRequests: [],
    });
    
    this.emit('client_registered', { clientId: client.clientId, name: client.name });
    
    return client;
  }
  
  /**
   * Validate client request
   * Returns client info if valid, null if invalid
   */
  validateClient(clientId, apiKey = null) {
    // If registration not required, allow unknown clients
    if (!this.requireRegistration && !clientId) {
      return {
        clientId: 'anonymous',
        name: 'Anonymous Client',
        type: 'anonymous',
        isValid: true,
        isRegistered: false,
      };
    }
    
    const client = this.clients.get(clientId);
    
    if (!client) {
      if (this.requireRegistration) {
        return { isValid: false, error: 'Client not registered' };
      }
      // Auto-register unknown client
      return {
        clientId: clientId || 'unknown',
        name: clientId || 'Unknown Client',
        type: 'unregistered',
        isValid: true,
        isRegistered: false,
      };
    }
    
    // Validate API key if provided
    if (apiKey && client.apiKey !== apiKey) {
      return { isValid: false, error: 'Invalid API key' };
    }
    
    if (!client.isActive) {
      return { isValid: false, error: 'Client is disabled' };
    }
    
    return {
      ...client,
      isValid: true,
      isRegistered: true,
    };
  }
  
  /**
   * Record client request
   */
  recordRequest(clientId, requestData) {
    const stats = this.clientStats.get(clientId);
    if (!stats) {
      // Create stats for unregistered client
      this.clientStats.set(clientId, {
        totalRequests: 1,
        totalTokens: requestData.tokens || 0,
        totalCost: requestData.cost || 0,
        requestsToday: 1,
        tokensToday: requestData.tokens || 0,
        lastReset: new Date().toISOString(),
        recentRequests: [requestData],
      });
      return;
    }
    
    stats.totalRequests++;
    stats.totalTokens += requestData.tokens || 0;
    stats.totalCost += requestData.cost || 0;
    stats.requestsToday++;
    stats.tokensToday += requestData.tokens || 0;
    
    // Keep last 100 requests
    stats.recentRequests.unshift({
      timestamp: new Date().toISOString(),
      model: requestData.model,
      tokens: requestData.tokens,
      latency: requestData.latency,
      status: requestData.status,
    });
    if (stats.recentRequests.length > 100) {
      stats.recentRequests = stats.recentRequests.slice(0, 100);
    }
    
    // Update client last activity
    const client = this.clients.get(clientId);
    if (client) {
      client.lastActivity = new Date().toISOString();
    }
    
    this.emit('request_recorded', { clientId, requestData });
  }
  
  /**
   * Check if client is within quota
   */
  checkQuota(clientId) {
    const client = this.clients.get(clientId);
    const stats = this.clientStats.get(clientId);
    
    if (!client || !stats) {
      return { allowed: true, reason: 'No quota configured' };
    }
    
    // Reset daily counters if needed
    const lastReset = new Date(stats.lastReset);
    const now = new Date();
    if (lastReset.toDateString() !== now.toDateString()) {
      stats.requestsToday = 0;
      stats.tokensToday = 0;
      stats.lastReset = now.toISOString();
    }
    
    // Check token quota
    if (client.quotas.tokensPerDay && stats.tokensToday >= client.quotas.tokensPerDay) {
      return { allowed: false, reason: 'Daily token quota exceeded' };
    }
    
    return { allowed: true };
  }
  
  /**
   * Get client info
   */
  getClient(clientId) {
    return this.clients.get(clientId) || null;
  }
  
  /**
   * Get client statistics
   */
  getClientStats(clientId) {
    return this.clientStats.get(clientId) || null;
  }
  
  /**
   * List all registered clients
   */
  listClients(includeStats = false) {
    const clients = [];
    
    for (const [clientId, client] of this.clients) {
      const clientInfo = {
        clientId: client.clientId,
        name: client.name,
        description: client.description,
        type: client.type,
        priority: client.priority,
        endpoints: client.endpoints,
        quotas: client.quotas,
        registeredAt: client.registeredAt,
        lastActivity: client.lastActivity,
        isActive: client.isActive,
        isInternal: client.isInternal,
      };
      
      if (includeStats) {
        const stats = this.clientStats.get(clientId);
        if (stats) {
          clientInfo.stats = {
            totalRequests: stats.totalRequests,
            totalTokens: stats.totalTokens,
            totalCost: stats.totalCost,
            requestsToday: stats.requestsToday,
            tokensToday: stats.tokensToday,
          };
        }
      }
      
      clients.push(clientInfo);
    }
    
    return clients.sort((a, b) => b.stats?.totalRequests - a.stats?.totalRequests || 0);
  }
  
  /**
   * Get traffic summary by client
   */
  getTrafficSummary() {
    const summary = {
      totalClients: this.clients.size,
      activeClients: 0,
      totalRequests: 0,
      totalTokens: 0,
      clients: [],
    };
    
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    for (const [clientId, client] of this.clients) {
      const stats = this.clientStats.get(clientId);
      if (!stats) continue;
      
      // Count recent requests (last hour)
      const recentRequests = stats.recentRequests.filter(r => 
        new Date(r.timestamp).getTime() > oneHourAgo
      );
      
      if (recentRequests.length > 0) {
        summary.activeClients++;
      }
      
      summary.totalRequests += stats.totalRequests;
      summary.totalTokens += stats.totalTokens;
      
      summary.clients.push({
        clientId,
        name: client.name,
        type: client.type,
        priority: client.priority,
        totalRequests: stats.totalRequests,
        requestsLastHour: recentRequests.length,
        totalTokens: stats.totalTokens,
        avgLatency: recentRequests.length > 0 
          ? recentRequests.reduce((s, r) => s + (r.latency || 0), 0) / recentRequests.length 
          : 0,
        lastActivity: client.lastActivity,
      });
    }
    
    // Sort by requests last hour
    summary.clients.sort((a, b) => b.requestsLastHour - a.requestsLastHour);
    
    return summary;
  }
  
  /**
   * Disable a client
   */
  disableClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.isActive = false;
      this.emit('client_disabled', { clientId });
      return true;
    }
    return false;
  }
  
  /**
   * Enable a client
   */
  enableClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      client.isActive = true;
      this.emit('client_enabled', { clientId });
      return true;
    }
    return false;
  }
  
  /**
   * Reset daily stats (called at midnight)
   */
  resetDailyStats() {
    for (const [clientId, stats] of this.clientStats) {
      stats.requestsToday = 0;
      stats.tokensToday = 0;
      stats.lastReset = new Date().toISOString();
    }
    console.log('[Client Registry] Daily stats reset');
  }
}

module.exports = ClientRegistryService;
