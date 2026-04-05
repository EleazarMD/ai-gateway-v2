/*
 * AI Gateway Client SDK (v2)
 * CommonJS module for Node.js clients
 */

const axios = require('axios');
const WebSocket = require('ws');
const { EventEmitter } = require('events');

class AIGatewayClient {
  constructor(options = {}) {
    const {
      baseUrl = 'http://localhost:8777',
      internalBaseUrl = 'http://localhost:7777',
      apiKey,
      adminApiKey,
      defaultAgentId,
      timeoutMs = 60000,
    } = options;

    if (!apiKey) throw new Error('apiKey is required');

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.internalBaseUrl = internalBaseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.adminApiKey = adminApiKey || apiKey;
    this.defaultAgentId = defaultAgentId || undefined;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: timeoutMs,
    });

    this.internalHttp = axios.create({
      baseURL: this.internalBaseUrl,
      timeout: timeoutMs,
    });
  }

  // Internal: build headers for requests
  _headers({ admin = false, agentId } = {}) {
    const headers = admin
      ? { 'X-Admin-Key': this.adminApiKey }
      : { 'X-API-Key': this.apiKey };
    const effectiveAgent = agentId || this.defaultAgentId;
    if (effectiveAgent) headers['X-Agent-ID'] = effectiveAgent;
    return headers;
  }

  // Health & Status
  async health() {
    const { data } = await this.http.get('/health', { headers: this._headers() });
    return data;
  }

  async healthComprehensive() {
    const { data } = await this.http.get('/api/v1/health/comprehensive', { headers: this._headers() });
    return data;
  }

  // Providers & Models
  async providerStatus() {
    const { data } = await this.http.get('/api/v1/providers/status', { headers: this._headers() });
    return data;
  }

  async listModels() {
    const { data } = await this.http.get('/api/v1/models', { headers: this._headers() });
    return data;
  }

  // Configuration - Routing
  async getRoutingConfig() {
    const { data } = await this.http.get('/api/v1/config/routing', { headers: this._headers() });
    return data;
  }

  async updateRoutingConfig(config) {
    const { data } = await this.http.put('/api/v1/config/routing', config, { headers: this._headers() });
    return data;
  }

  // Configuration - Fallback
  async updateFallbackConfig(config) {
    const { data } = await this.http.put('/api/v1/config/fallback', config, { headers: this._headers() });
    return data;
  }

  async upsertFallbackChain({ name, providers, description }) {
    const payload = { name, providers, description };
    const { data } = await this.http.post('/api/v1/config/fallback/chains', payload, { headers: this._headers() });
    return data;
  }

  // Inference (Chat Completions)
  async chatCompletions(request, opts = {}) {
    const headers = this._headers({ agentId: opts.agentId });
    const { data } = await this.http.post('/api/v1/chat/completions', request, { headers });
    return data;
  }

  // Streaming via SSE-like stream; returns EventEmitter with events: 'chunk', 'done', 'error'
  streamChatCompletions(request, opts = {}) {
    const emitter = new EventEmitter();
    // Not supported by server.js currently; emit error immediately
    process.nextTick(() => emitter.emit('error', new Error('Streaming chat completions not supported by server')));
    return emitter;
  }

  // Perplexity Search (supports streaming via SSE)
  async perplexitySearch(request, { stream = false } = {}) {
    if (!stream) {
      const { data } = await this.http.post('/api/v1/perplexity/search', request, { headers: this._headers() });
      return data;
    }

    const emitter = new EventEmitter();
    this.http
      .post('/api/v1/perplexity/search', { ...request, stream: true }, {
        headers: { ...this._headers(), 'Content-Type': 'application/json' },
        responseType: 'stream',
      })
      .then((res) => {
        res.data.on('data', (buf) => {
          const text = buf.toString();
          text.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') {
              emitter.emit('done');
              return;
            }
            try {
              const json = JSON.parse(payload);
              emitter.emit('chunk', json);
            } catch (e) {
              // ignore non-JSON data lines
            }
          });
        });
        res.data.on('end', () => emitter.emit('done'));
        res.data.on('error', (err) => emitter.emit('error', err));
      })
      .catch((err) => emitter.emit('error', err));

    return emitter;
  }

  // Analytics
  async getRoutingAnalytics() {
    const { data } = await this.http.get('/api/v1/analytics/routing', { headers: this._headers() });
    return data;
  }

  async getFallbackAnalytics() {
    const { data } = await this.http.get('/api/v1/analytics/fallback', { headers: this._headers() });
    return data;
  }

  // Admin (internal port 7777)
  async getAdminConfig() {
    const { data } = await this.internalHttp.get('/admin/config', { headers: this._headers({ admin: true }) });
    return data;
  }

  async setProviderEnabled(providerId, enabled, updates = {}) {
    const { data } = await this.internalHttp.put(
      `/admin/providers/${encodeURIComponent(providerId)}`,
      { enabled, ...updates },
      { headers: this._headers({ admin: true }) }
    );
    return data;
  }

  // WebSocket: Dashboard stream (internal ws://host:7777/ws?apiKey=...)
  connectDashboardWS() {
    const wsUrl = this._toWsUrl(`${this.internalBaseUrl}/ws?apiKey=${encodeURIComponent(this.apiKey)}`);
    const ws = new WebSocket(wsUrl);
    return ws; // caller attaches event listeners
  }

  _stripProtocol(url) {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  _toWsUrl(httpUrl) {
    return httpUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  }
}

module.exports = { AIGatewayClient }; 
