#!/usr/bin/env node

/**
 * AI Gateway v2.5.0 - Modular Architecture Entry Point
 * 
 * Dual Port Architecture:
 * - Port 7777: Internal service mesh API (health, admin, monitoring)
 * - Port 8777: External AI inference API (chat completions, embeddings)
 * 
 * Modular structure:
 * - src/apps/ - Express app factories
 * - src/routes/ - Route handlers (internal, external)
 * - src/middleware/ - Reusable middleware (auth, model normalizer)
 * - src/handlers/ - Business logic handlers
 * - src/services/ - Service integrations
 */

require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { createInternalApp, createExternalApp } = require('./src/apps/app-factory');

// Services
const ServiceMeshIntegration = require('./src/service-mesh-integration');
const DashboardConfigService = require('./src/services/dashboard-config-service');
const AHISIntegrationService = require('./src/services/ahis-integration-service');
const ProviderManager = require('./src/services/provider-manager');
const APIKeyManager = require('./src/services/api-key-manager');
const AIInferencingClient = require('./src/clients/ai-inferencing-client');
const WebSocketService = require('./src/services/websocket-service');

// Handlers
const ChatCompletionsHandler = require('./src/handlers/chat-completions-handler');
const EmbeddingsHandler = require('./src/handlers/embeddings-handler');
const ImageGenerationHandler = require('./src/handlers/image-generation-handler');
const StreamingRAGHandler = require('./src/handlers/streaming-rag-handler');
const OpenClawProxyHandler = require('./src/handlers/openclaw-proxy-handler');

// Routes
const workspaceProxy = require('./src/routes/workspace-proxy');

// Security Integration
const {
  initializeSecurityServices,
  applySecurityMiddleware,
  addSecurityRoutes,
  runSecurityMigrations
} = require('./src/security-integration');

// MCP and Monitoring
const MCPSSEBridge = require('./src/services/mcp-sse-bridge');
const RequestTracingService = require('./src/services/request-tracing-service');
const CostTrackingService = require('./src/services/cost-tracking-service');
const AlertService = require('./src/services/alert-service');
const ClientRegistryService = require('./src/services/client-registry-service');
const TraceStorage = require('./src/storage/trace-storage');
const CostStorage = require('./src/storage/cost-storage');
const AlertStorage = require('./src/storage/alert-storage');
const PostgreSQLWrapper = require('./src/storage/postgres-wrapper');

// Configuration
const INTERNAL_PORT = process.env.INTERNAL_PORT || 7777;
const EXTERNAL_PORT = process.env.EXTERNAL_PORT || 8777;

console.log('\n' + '='.repeat(80));
console.log('🚀 AI Gateway v2.5.0 - Modular Architecture Starting...');
console.log('='.repeat(80) + '\n');

/**
 * Initialize all services and dependencies
 */
async function initializeServices() {
  console.log('📦 Initializing services...');
  
  // Initialize PostgreSQL (optional, for security features)
  let postgresWrapper = null;
  try {
    postgresWrapper = new PostgreSQLWrapper();
    await postgresWrapper.connect(3, 2000); // 3 retries, 2s delay
  } catch (error) {
    console.log('⚠️  PostgreSQL not available, security features will run in limited mode');
  }
  
  // Run security database migrations
  if (postgresWrapper) {
    await runSecurityMigrations(postgresWrapper);
  }
  
  // Note: WebSocket service will be initialized after server creation
  // Security services will be updated with websocket reference later
  const securityServices = await initializeSecurityServices(postgresWrapper, null, null);
  
  // Initialize storage with database config
  const dbConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5434,
    database: process.env.POSTGRES_DATABASE || 'ai_gateway',
    user: process.env.POSTGRES_USER || 'aigateway',
    password: process.env.POSTGRES_PASSWORD || 'aigateway_password'
  };
  const traceStorage = new TraceStorage(dbConfig);
  const costStorage = new CostStorage(dbConfig);
  const alertStorage = new AlertStorage(dbConfig);
  
  // Initialize monitoring services
  const requestTracingService = new RequestTracingService(traceStorage);
  const costTrackingService = new CostTrackingService(costStorage);
  const alertService = new AlertService(alertStorage);
  
  // Initialize AI Inferencing client
  const aiInferencingClient = new AIInferencingClient({
    baseUrl: process.env.AI_INFERENCING_URL || 'http://localhost:9000',
    apiKey: process.env.AI_INFERENCING_API_KEY || 'ai-inferencing-admin-key-2024'
  });
  
  // Initialize provider manager (auto-initializes routing and fallback)
  const providerManager = new ProviderManager();
  
  // Load providers from AI Inferencing Service (centralized key management)
  console.log('🔌 Loading providers from AI Inferencing Service (port 9000)...\n');
  
  const ENABLE_AI_INFERENCING = process.env.ENABLE_AI_INFERENCING !== 'false';
  
  if (ENABLE_AI_INFERENCING) {
    try {
      // Fetch all provider keys from AI Inferencing Service
      const providersToLoad = [
        { id: 'anthropic-default', type: 'anthropic', provider: 'anthropic' },
        { id: 'openai-default', type: 'openai', provider: 'openai' },
        { id: 'google-default', type: 'google', provider: 'google' },
        { id: 'perplexity-default', type: 'perplexity', provider: 'perplexity' }
      ];
      
      for (const providerConfig of providersToLoad) {
        try {
          // Fetch API key from AI Inferencing Service
          // serviceId: ai-gateway (AI Gateway service)
          // provider: anthropic, openai, google, perplexity
          const apiKey = await aiInferencingClient.getKey('ai-gateway', providerConfig.provider);
          
          if (apiKey) {
            console.log(`✅ Fetched ${providerConfig.provider} key from AI Inferencing Service`);
            await providerManager.loadProvider({
              id: providerConfig.id,
              type: providerConfig.type,
              apiKey: apiKey,
              enabled: true
            });
          } else {
            console.log(`⚠️  ${providerConfig.provider} - No API key found in key management`);
          }
        } catch (e) {
          console.log(`⚠️  ${providerConfig.provider} failed:`, e.message);
        }
      }
    } catch (e) {
      console.error('❌ Failed to load providers from AI Inferencing Service:', e.message);
      console.log('⚠️  Falling back to .env API keys...\n');
      
      // Fallback to .env keys
      const envProviders = [
        { id: 'anthropic-default', type: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
        { id: 'openai-default', type: 'openai', key: process.env.OPENAI_API_KEY },
        { id: 'google-default', type: 'google', key: process.env.GOOGLE_API_KEY },
        { id: 'perplexity-default', type: 'perplexity', key: process.env.PERPLEXITY_API_KEY }
      ];
      
      for (const provider of envProviders) {
        if (provider.key) {
          try {
            await providerManager.loadProvider({
              id: provider.id,
              type: provider.type,
              apiKey: provider.key,
              enabled: true
            });
          } catch (e) {
            console.log(`⚠️  ${provider.type} (.env fallback) failed:`, e.message);
          }
        }
      }
    }
  } else {
    console.log('⚠️  AI Inferencing integration disabled, using .env keys\n');
    
    // Use .env keys
    const envProviders = [
      { id: 'anthropic-default', type: 'anthropic', key: process.env.ANTHROPIC_API_KEY },
      { id: 'openai-default', type: 'openai', key: process.env.OPENAI_API_KEY },
      { id: 'google-default', type: 'google', key: process.env.GOOGLE_API_KEY },
      { id: 'perplexity-default', type: 'perplexity', key: process.env.PERPLEXITY_API_KEY }
    ];
    
    for (const provider of envProviders) {
      if (provider.key) {
        try {
          await providerManager.loadProvider({
            id: provider.id,
            type: provider.type,
            apiKey: provider.key,
            enabled: true
          });
        } catch (e) {
          console.log(`⚠️  ${provider.type} failed:`, e.message);
        }
      }
    }
  }
  
  // Load local endpoints from AI Inferencing (Qwen3-8B, etc.)
  if (ENABLE_AI_INFERENCING) {
    try {
      console.log('🔍 Discovering local endpoints from AI Inferencing...\n');
      const endpointsResponse = await fetch('http://localhost:9000/api/v1/admin/endpoints/endpoints', {
        headers: {
          'X-Service-ID': 'ai-gateway',
          'X-Admin-Key': process.env.AI_INFERENCING_API_KEY || 'ai-inferencing-admin-key-2024'
        }
      });
      
      if (endpointsResponse.ok) {
        const endpointsData = await endpointsResponse.json();
        const endpoints = endpointsData.endpoints || [];
        
        // Filter for OpenAI-compatible local endpoints (like Qwen3-8B)
        const localEndpoints = endpoints.filter(ep => 
          ep.is_active && 
          ep.provider === 'openai' && 
          ep.base_url.includes('localhost')
        );
        
        for (const endpoint of localEndpoints) {
          try {
            console.log(`✅ Discovered local endpoint: ${endpoint.endpoint_name} at ${endpoint.base_url}`);
            
            // Query model compatibility for this endpoint
            const modelsResponse = await fetch(`http://localhost:9000/api/v1/admin/endpoints/endpoints`, {
              headers: {
                'X-Service-ID': 'ai-gateway',
                'X-Admin-Key': process.env.AI_INFERENCING_API_KEY || 'ai-inferencing-admin-key-2024'
              }
            });
            
            let supportedModels = [];
            // Query actual models from vLLM endpoint instead of inferring from name
            try {
              const vllmModels = await fetch(endpoint.base_url + '/v1/models');
              if (vllmModels.ok) {
                const vllmData = await vllmModels.json();
                supportedModels = vllmData.data?.map(m => m.id) || [];
                console.log(`   Models from vLLM: ${supportedModels.join(', ')}`);
              }
            } catch (e) {
              // Fallback: infer from endpoint name
              const modelName = endpoint.endpoint_name.replace('-local', '');
              supportedModels = [modelName];
              console.log(`   Fallback model name: ${modelName}`);
            }
            
            await providerManager.loadProvider({
              id: endpoint.endpoint_id,
              name: endpoint.endpoint_name,
              type: 'openai',
              apiKey: 'local-endpoint-no-key-needed',
              endpoint: endpoint.base_url + '/v1',
              models: supportedModels,
              enabled: true
            });
          } catch (e) {
            console.log(`⚠️  Failed to load ${endpoint.endpoint_name}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.log('⚠️  Endpoint discovery failed:', e.message);
    }
  }
  
  // Load Qwen Vision model for email image analysis (zero-trust compliant)
  // This routes vision requests through the gateway for audit logging
  try {
    console.log('📸 Loading Qwen Vision provider for email image analysis...');
    await providerManager.loadProvider({
      id: 'qwen-vision-local',
      name: 'Qwen Vision (Qwen2.5-VL-7B)',
      type: 'openai',
      apiKey: 'local-endpoint-no-key-needed',
      endpoint: 'http://localhost:8792/v1',
      models: ['qwen-vision', 'Qwen2.5-VL-7B-Instruct'],
      enabled: true,
      capabilities: ['vision', 'multimodal', 'image_analysis']
    });
    console.log('✅ Qwen Vision provider loaded');
  } catch (e) {
    console.log('⚠️  Qwen Vision provider failed:', e.message);
  }
  
  // Load MiniMax M2.7 provider (OpenAI-compatible API via local ik_llama.cpp)
  // MiniMax uses OpenAI chat completions format on port 8010
  if (process.env.MINIMAX_API_KEY) {
    try {
      console.log('🤖 Loading MiniMax M2.7 provider...');
      await providerManager.loadProvider({
        id: 'minimax-default',
        name: 'MiniMax M2.7 (230B MoE)',
        type: 'openai',
        apiKey: process.env.MINIMAX_API_KEY,
        endpoint: process.env.MINIMAX_ENDPOINT || 'http://localhost:8010/v1',
        models: ['minimax-m2.7', 'minimax-m2-7', 'minimax-m2.5', 'minimax-m2-5'],
        enabled: true,
        capabilities: ['chat', 'reasoning', 'function_calling', 'agentic', 'long_context', 'tool_use', 'browser_automation']
      });
      console.log('✅ MiniMax M2.7 provider loaded');
    } catch (e) {
      console.log('⚠️  MiniMax provider failed:', e.message);
    }
  } else {
    console.log('ℹ️  MiniMax provider skipped (no MINIMAX_API_KEY set)');
  }
  
  console.log(`\n✅ Loaded ${providerManager.activeProviders.size} providers\n`);
  
  // Load persistent routing rules from config file
  try {
    const fs = require('fs');
    const path = require('path');
    const rulesPath = path.join(__dirname, 'config', 'routing-rules.json');
    if (fs.existsSync(rulesPath)) {
      const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
      const rules = rulesData.routing_rules || [];
      if (rules.length > 0) {
        providerManager.updateRoutingConfig({ routingRules: rules });
        console.log(`✅ Loaded ${rules.length} routing rules from ${rulesPath}`);
        for (const rule of rules) {
          console.log(`   ${rule.name}`);
        }
      }
    } else {
      console.log('⚠️  No routing rules config found at', rulesPath);
    }
  } catch (e) {
    console.error('⚠️  Failed to load routing rules:', e.message);
  }
  
  // Initialize API key manager with PostgreSQL connection
  const apiKeyManager = new APIKeyManager({
    postgresWrapper: postgresWrapper,
    aiInferencingClient: aiInferencingClient
  });
  await apiKeyManager.initialize();
  
  // Initialize client registry
  const clientRegistry = new ClientRegistryService();
  console.log(`✅ Client Registry initialized with ${clientRegistry.clients.size} registered clients`);
  
  // Initialize handlers (using positional parameters)
  const chatCompletionsHandler = new ChatCompletionsHandler(
    providerManager,
    requestTracingService,
    costTrackingService,
    aiInferencingClient
  );
  
  const embeddingsHandler = new EmbeddingsHandler(
    providerManager,
    requestTracingService,
    costTrackingService
  );

  const imageGenerationHandler = new ImageGenerationHandler(
    aiInferencingClient
  );
  
  // Initialize Streaming RAG handler
  const streamingRAGHandler = new StreamingRAGHandler({
    tracingService: requestTracingService,
    costService: costTrackingService,
    inferencingClient: aiInferencingClient
  });
  
  // Initialize OpenClaw Proxy handler
  const openclawProxyHandler = new OpenClawProxyHandler({
    tracingService: requestTracingService
  });
  
  // Initialize MCP bridge
  const mcpBridge = new MCPSSEBridge();
  
  // Initialize service mesh integration
  const serviceMeshIntegration = new ServiceMeshIntegration();
  
  // Initialize dashboard config service
  const dashboardConfigService = new DashboardConfigService();
  
  // Initialize AHIS integration (optional)
  let ahisIntegrationService = null;
  try {
    ahisIntegrationService = new AHISIntegrationService();
    await ahisIntegrationService.initialize();
  } catch (error) {
    console.log('⚠️  AHIS integration unavailable, continuing without it...');
  }
  
  console.log('✅ All services initialized\n');
  
  return {
    providerManager,
    apiKeyManager,
    clientRegistry,
    chatCompletionsHandler,
    embeddingsHandler,
    imageGenerationHandler,
    streamingRAGHandler,
    openclawProxyHandler,
    requestTracingService,
    costTrackingService,
    alertService,
    mcpBridge,
    serviceMeshIntegration,
    dashboardConfigService,
    ahisIntegrationService,
    workspaceProxy,
    postgresWrapper,
    ...securityServices
  };
}

/**
 * Start the AI Gateway servers
 */
async function start() {
  try {
    // Initialize all services
    const dependencies = await initializeServices();
    
    // Create Express apps
    console.log('🔧 Creating Express applications...');
    const internalApp = createInternalApp(dependencies);
    const externalApp = createExternalApp(dependencies);
    console.log('✅ Express apps created\n');
    
    // Create HTTP servers
    const internalServer = http.createServer(internalApp);
    const externalServer = http.createServer(externalApp);
    
    // Initialize WebSocket service on internal port
    console.log('🌐 Initializing WebSocket service...');
    const { authenticateInternal } = require('./src/middleware/authentication');
    const websocketService = new WebSocketService(internalServer, authenticateInternal);
    
    // Connect WebSocket service to alert rules engine for real-time alerts
    if (dependencies.alertRulesEngine && websocketService) {
      dependencies.alertRulesEngine.websocketService = websocketService;
      console.log('✅ WebSocket service connected to alert rules engine');
    }
    
    console.log('✅ WebSocket service initialized\n');
    
    // Start servers
    await new Promise((resolve, reject) => {
      internalServer.listen(INTERNAL_PORT, (err) => {
        if (err) reject(err);
        else {
          console.log('='.repeat(80));
          console.log(`✅ INTERNAL API (Service Mesh) running on port ${INTERNAL_PORT}`);
          console.log(`   Health: http://localhost:${INTERNAL_PORT}/health`);
          console.log(`   Metrics: http://localhost:${INTERNAL_PORT}/metrics`);
          console.log(`   Admin: http://localhost:${INTERNAL_PORT}/admin/config`);
          console.log(`   WebSocket: ws://localhost:${INTERNAL_PORT}/ws`);
          console.log('='.repeat(80) + '\n');
          resolve();
        }
      });
    });
    
    await new Promise((resolve, reject) => {
      externalServer.listen(EXTERNAL_PORT, (err) => {
        if (err) reject(err);
        else {
          console.log('='.repeat(80));
          console.log(`✅ EXTERNAL API (AI Inference) running on port ${EXTERNAL_PORT}`);
          console.log(`   Chat: http://localhost:${EXTERNAL_PORT}/api/v1/chat/completions`);
          console.log(`   Embeddings: http://localhost:${EXTERNAL_PORT}/api/v1/embeddings`);
          console.log(`   Info: http://localhost:${EXTERNAL_PORT}/api/v1/info`);
          console.log(`   Health: http://localhost:${EXTERNAL_PORT}/health`);
          console.log('='.repeat(80) + '\n');
          resolve();
        }
      });
    });
    
    console.log('🎉 AI Gateway v2.5.0 is ready and accepting requests!\n');
    
    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);
      
      internalServer.close(() => {
        console.log('✅ Internal server closed');
      });
      
      externalServer.close(() => {
        console.log('✅ External server closed');
      });
      
      wss.close(() => {
        console.log('✅ WebSocket server closed');
      });
      
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start AI Gateway:', error);
    process.exit(1);
  }
}

// Start the server
if (require.main === module) {
  start();
}

module.exports = { start };
