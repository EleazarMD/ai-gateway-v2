/**
 * MCP-SSE Bridge
 * 
 * Bridges STDIO-based MCP servers to SSE/HTTP endpoints for Goose ACP integration.
 * This allows Goose to connect to already-running MCP servers via SSE URLs instead
 * of spawning new processes.
 * 
 * Architecture:
 * Client (Goose ACP) → SSE Endpoint → This Bridge → STDIO MCP Server
 * 
 * Based on: https://www.ragie.ai/blog/building-a-server-sent-events-sse-mcp-server-with-fastapi
 * Adapted from: AI Gateway v2.5.0 SSE streaming infrastructure
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

class MCPSSEBridge extends EventEmitter {
  constructor(mcpServerConfig) {
    super();
    
    this.config = mcpServerConfig;
    this.process = null;
    this.sessions = new Map(); // sessionId -> { reader, writer, queue }
    this.messageId = 0;
    this.pendingRequests = new Map(); // requestId -> { resolve, reject }
    this.isReady = false;
    this.startupError = null;
  }
  
  /**
   * Start the MCP server process
   */
  async start() {
    if (this.process) {
      console.log('[MCP-SSE Bridge] Server already running');
      return;
    }
    
    console.log('[MCP-SSE Bridge] Starting MCP server:', {
      command: this.config.command,
      args: this.config.args
    });
    
    try {
      // Spawn the MCP server process
      this.process = spawn(this.config.command, this.config.args, {
        cwd: this.config.cwd || process.cwd(),
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // Set up error handling
      this.process.on('error', (error) => {
        console.error('[MCP-SSE Bridge] Process error:', error);
        this.startupError = error;
        this.emit('error', error);
      });
      
      this.process.on('exit', (code, signal) => {
        console.log('[MCP-SSE Bridge] Process exited:', { code, signal });
        this.cleanup();
      });
      
      // Handle stderr
      this.process.stderr.on('data', (data) => {
        console.error('[MCP-SSE Bridge] stderr:', data.toString());
      });
      
      // Set up stdout reader for JSON-RPC responses
      this.setupStdoutReader();
      
      // Wait a bit for the MCP server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Initialize the MCP server with a handshake
      await this.initialize();
      
      this.isReady = true;
      console.log('[MCP-SSE Bridge] MCP server ready');
      
    } catch (error) {
      console.error('[MCP-SSE Bridge] Failed to start:', error);
      this.startupError = error;
      throw error;
    }
  }
  
  /**
   * Set up stdout reader to parse JSON-RPC messages
   */
  setupStdoutReader() {
    let buffer = '';
    
    this.process.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process complete JSON-RPC messages (one per line)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this.handleResponse(message);
          } catch (error) {
            console.error('[MCP-SSE Bridge] Failed to parse response:', error, line);
          }
        }
      }
    });
  }
  
  /**
   * Handle JSON-RPC response from MCP server
   */
  handleResponse(message) {
    // Check if this is a response to a pending request
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      
      if (message.error) {
        reject(new Error(message.error.message || 'MCP server error'));
      } else {
        resolve(message.result);
      }
    } else {
      // This might be a notification or unsolicited message
      console.log('[MCP-SSE Bridge] Received message:', message);
      this.emit('message', message);
    }
  }
  
  /**
   * Send JSON-RPC request to MCP server
   */
  async sendRequest(method, params = {}) {
    if (!this.process) {
      throw new Error('MCP server process not started');
    }
    
    const id = ++this.messageId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };
    
    return new Promise((resolve, reject) => {
      // Store promise handlers
      this.pendingRequests.set(id, { resolve, reject });
      
      // Send request
      const requestStr = JSON.stringify(request) + '\n';
      this.process.stdin.write(requestStr, (error) => {
        if (error) {
          this.pendingRequests.delete(id);
          reject(error);
        }
      });
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }
  
  /**
   * Initialize the MCP server connection
   */
  async initialize() {
    try {
      console.log('[MCP-SSE Bridge] Sending initialize request...');
      
      // Send initialize request
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'ai-gateway-mcp-bridge',
          version: '1.0.0'
        }
      });
      
      console.log('[MCP-SSE Bridge] Initialize response:', JSON.stringify(result));
      
      // Send initialized notification (no response expected)
      console.log('[MCP-SSE Bridge] Sending initialized notification...');
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      };
      this.process.stdin.write(JSON.stringify(notification) + '\n');
      
      console.log('[MCP-SSE Bridge] Initialization complete');
      return result;
    } catch (error) {
      console.error('[MCP-SSE Bridge] Initialization failed:', error.message);
      console.error('[MCP-SSE Bridge] Error stack:', error.stack);
      throw error;
    }
  }
  
  /**
   * List available tools from MCP server
   */
  async listTools() {
    return await this.sendRequest('tools/list', {});
  }
  
  /**
   * Call a tool on the MCP server
   */
  async callTool(name, args) {
    return await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
  }
  
  /**
   * Handle SSE connection for a client
   * This creates an SSE stream that forwards MCP messages
   */
  async handleSSEConnection(req, res) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('[MCP-SSE Bridge] New SSE connection:', sessionId);
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Send initial connection event with endpoint URL
    const messageEndpoint = `/messages?session_id=${sessionId}`;
    res.write(`event: endpoint\n`);
    res.write(`data: ${messageEndpoint}\n\n`);
    
    // Store session
    this.sessions.set(sessionId, {
      res,
      queue: []
    });
    
    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: ping - ${new Date().toISOString()}\n\n`);
      } else {
        clearInterval(pingInterval);
        this.sessions.delete(sessionId);
      }
    }, 30000);
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('[MCP-SSE Bridge] SSE connection closed:', sessionId);
      clearInterval(pingInterval);
      this.sessions.delete(sessionId);
    });
  }
  
  /**
   * Handle POST message for a session
   */
  async handlePostMessage(sessionId, message) {
    console.log('[MCP-SSE Bridge] Received POST message for session:', sessionId, message);
    
    try {
      // Forward the JSON-RPC request to the MCP server
      const result = await this.sendRequest(message.method, message.params);
      
      // Send response back through SSE
      const session = this.sessions.get(sessionId);
      if (session && !session.res.writableEnded) {
        session.res.write(`event: message\n`);
        session.res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
      }
      
      return { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      console.error('[MCP-SSE Bridge] POST message error:', error);
      
      // Send error response
      const errorResponse = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error.message || 'Internal error'
        }
      };
      
      const session = this.sessions.get(sessionId);
      if (session && !session.res.writableEnded) {
        session.res.write(`event: message\n`);
        session.res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
      }
      
      return errorResponse;
    }
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    console.log('[MCP-SSE Bridge] Cleaning up...');
    
    // Close all sessions
    for (const [sessionId, session] of this.sessions) {
      if (!session.res.writableEnded) {
        session.res.end();
      }
    }
    this.sessions.clear();
    
    // Clear pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new Error('Server shutting down'));
    }
    this.pendingRequests.clear();
    
    // Kill process if running
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
    
    this.isReady = false;
  }
  
  /**
   * Stop the bridge
   */
  async stop() {
    this.cleanup();
  }
}

module.exports = MCPSSEBridge;
