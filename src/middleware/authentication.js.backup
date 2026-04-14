/**
 * Authentication Middleware
 * Validates API keys for internal and external requests with component identification
 */

const API_KEY = process.env.API_KEY || 'ai-gateway-api-key-2024';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'ai-gateway-admin-key-2024';
const CHILD_SAFETY_KEY = process.env.CHILD_SAFETY_API_KEY || 'child-safety-key';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';

// API Key Service instance (will be injected)
let apiKeyService = null;

/**
 * Initialize authentication with API Key Service
 */
function initializeAuthentication(apiKeyServiceInstance) {
  apiKeyService = apiKeyServiceInstance;
  console.log('[Authentication] Initialized with API Key Service');
}

/**
 * Authenticate internal API requests (Port 7777)
 * Requires X-API-Key header with admin key
 */
async function authenticateInternal(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['x-admin-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing API key',
      message: 'X-API-Key or X-Admin-Key header required'
    });
  }
  
  // Use API Key Service if available
  if (apiKeyService) {
    const validation = await apiKeyService.validateKey(apiKey);
    
    if (!validation.valid) {
      return res.status(403).json({ 
        error: 'Invalid API key',
        message: validation.reason || 'The provided API key is not valid'
      });
    }
    
    // Attach component info to request
    req.apiKey = apiKey;
    req.component = validation.component;
    req.componentType = validation.componentType;
    req.componentName = validation.keyName;
    req.scopes = validation.scopes;
    req.rateLimitTier = validation.rateLimitTier;
    req.isInternal = validation.isInternal;
    
    return next();
  }
  
  // Fallback to legacy validation
  if (apiKey !== ADMIN_API_KEY && apiKey !== API_KEY) {
    return res.status(403).json({ 
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
  }
  
  req.apiKey = apiKey;
  req.component = 'legacy-client';
  req.componentType = 'client';
  
  next();
}

/**
 * Authenticate external API requests (Port 8777)
 * More permissive - allows standard API key and child safety key
 */
async function authenticateExternal(req, res, next) {
  const apiKey = req.headers['x-api-key'] || 
                 req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Missing API key',
      message: 'X-API-Key header or Authorization Bearer token required'
    });
  }
  
  // Use API Key Service if available
  if (apiKeyService) {
    const validation = await apiKeyService.validateKey(apiKey);
    
    if (!validation.valid) {
      return res.status(403).json({ 
        error: 'Invalid API key',
        message: validation.reason || 'The provided API key is not valid'
      });
    }
    
    // Attach component info to request
    req.apiKey = apiKey;
    req.component = validation.component;
    req.componentType = validation.componentType;
    req.componentName = validation.keyName;
    req.scopes = validation.scopes;
    req.rateLimitTier = validation.rateLimitTier;
    req.isInternal = validation.isInternal;
    
    // Mark request as child request if using child safety key
    if (apiKey === CHILD_SAFETY_KEY) {
      req.isChildRequest = true;
      req.enforcedSafetyLevel = 'strict';
    }
    
    return next();
  }
  
  // Fallback to legacy validation
  const validKeys = [API_KEY, ADMIN_API_KEY, CHILD_SAFETY_KEY];
  if (OPENCLAW_API_KEY) validKeys.push(OPENCLAW_API_KEY);
  
  if (!validKeys.includes(apiKey)) {
    return res.status(403).json({ 
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
  }
  
  req.apiKey = apiKey;
  req.component = 'legacy-client';
  req.componentType = 'client';
  
  // Mark request as child request if using child safety key
  if (apiKey === CHILD_SAFETY_KEY) {
    req.isChildRequest = true;
    req.enforcedSafetyLevel = 'strict';
  }
  
  // Identify openclaw requests
  if (apiKey === OPENCLAW_API_KEY) {
    req.component = 'openclaw-agent';
    req.componentType = 'service';
    req.serviceId = 'openclaw-agent';
  }
  
  next();
}

module.exports = {
  authenticateInternal,
  authenticateExternal,
  initializeAuthentication
};
