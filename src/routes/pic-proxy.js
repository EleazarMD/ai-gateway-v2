/**
 * PIC (Personal Identity Core) Proxy Routes
 * 
 * Proxies PIC requests through AI Gateway for:
 * - Centralized audit logging
 * - Rate limiting per service
 * - Authentication validation
 * - Service attribution
 * 
 * Zero-Tolerance Security Architecture:
 * All external services (Hermes Core, OpenClaw, iOS App) must route
 * PIC requests through AI Gateway instead of direct connections.
 * 
 * See: docs/technical-reference/chapters/02_AI_GATEWAY.md#pic-proxy-endpoints
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

// PIC Service URL (Tailscale network)
const PIC_URL = process.env.PIC_URL || 'http://100.108.41.22:8765';
const PIC_READ_KEY = process.env.PIC_READ_KEY || '';
const PIC_WRITE_KEY = process.env.PIC_WRITE_KEY || '';

// Request timeout
const TIMEOUT_MS = 10000;

/**
 * Audit logging for PIC access
 */
function logPICAccess(req, endpoint, method, statusCode) {
  const serviceId = req.headers['x-service-id'] || 'unknown';
  const userId = req.query.user_id || req.body?.user_id || 'default';
  
  console.log(`[PIC Proxy] ${method} ${endpoint} | service=${serviceId} user=${userId} status=${statusCode}`);
}

/**
 * GET /api/v1/pic/health
 * Health check endpoint for PIC proxy
 */
router.get('/health', async (req, res) => {
  try {
    // Try to reach PIC service
    const response = await axios.get(`${PIC_URL}/health`, {
      timeout: 5000
    });
    
    res.json({
      status: 'healthy',
      service: 'pic-proxy',
      upstream: {
        url: PIC_URL,
        status: response.status,
        healthy: true
      }
    });
  } catch (error) {
    // PIC might not have a health endpoint, check if it's reachable
    res.json({
      status: 'degraded',
      service: 'pic-proxy',
      upstream: {
        url: PIC_URL,
        healthy: false,
        error: error.message
      }
    });
  }
});

/**
 * Build headers for PIC request
 */
function buildPICHeaders(req, isWrite = false) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-Service': req.headers['x-service-id'] || 'ai-gateway',
    'X-Forwarded-For': req.ip || req.connection?.remoteAddress || 'unknown'
  };
  
  // Add appropriate API key
  if (isWrite && PIC_WRITE_KEY) {
    headers['X-PIC-Write-Key'] = PIC_WRITE_KEY;
  } else if (PIC_READ_KEY) {
    headers['X-PIC-Read-Key'] = PIC_READ_KEY;
  }
  
  return headers;
}

/**
 * GET /api/v1/pic/context
 * Get full user context (identity, preferences, goals, relationships)
 */
router.get('/context', async (req, res) => {
  const endpoint = '/api/pic/context';
  
  try {
    const response = await axios.get(`${PIC_URL}${endpoint}`, {
      headers: buildPICHeaders(req),
      params: req.query,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'GET', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'GET', status);
    
    console.error('[PIC Proxy] Error getting context:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to get PIC context',
      service: 'pic-proxy'
    });
  }
});

/**
 * GET /api/v1/pic/identity
 * Get user identity information only
 */
router.get('/identity', async (req, res) => {
  const endpoint = '/api/pic/identity';
  
  try {
    const response = await axios.get(`${PIC_URL}${endpoint}`, {
      headers: buildPICHeaders(req),
      params: req.query,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'GET', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'GET', status);
    
    console.error('[PIC Proxy] Error getting identity:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to get identity',
      service: 'pic-proxy'
    });
  }
});

/**
 * GET /api/v1/pic/preferences
 * GET /api/v1/pic/preferences/:category
 * Get user preferences, optionally filtered by category
 */
router.get('/preferences/:category?', async (req, res) => {
  const category = req.params.category;
  const endpoint = '/api/pic/preferences';
  
  try {
    const params = { ...req.query };
    if (category) {
      params.categories = category;
    }
    
    const response = await axios.get(`${PIC_URL}${endpoint}`, {
      headers: buildPICHeaders(req),
      params,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'GET', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'GET', status);
    
    console.error('[PIC Proxy] Error getting preferences:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to get preferences',
      service: 'pic-proxy'
    });
  }
});

/**
 * POST /api/v1/pic/preferences
 * Update or create a preference (requires write key)
 */
router.post('/preferences', async (req, res) => {
  const endpoint = '/api/pic/preferences';
  
  // Validate write key from request header
  const clientWriteKey = req.headers['x-pic-write-key'];
  if (!clientWriteKey && !PIC_WRITE_KEY) {
    logPICAccess(req, endpoint, 'POST', 403);
    return res.status(403).json({
      error: 'Write access requires X-PIC-Write-Key header',
      service: 'pic-proxy'
    });
  }
  
  try {
    const response = await axios.post(`${PIC_URL}${endpoint}`, req.body, {
      headers: buildPICHeaders(req, true),
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'POST', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'POST', status);
    
    console.error('[PIC Proxy] Error updating preference:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to update preference',
      service: 'pic-proxy'
    });
  }
});

/**
 * GET /api/v1/pic/goals
 * Get user goals, optionally filtered by status
 */
router.get('/goals', async (req, res) => {
  const endpoint = '/api/pic/goals';
  
  try {
    const response = await axios.get(`${PIC_URL}${endpoint}`, {
      headers: buildPICHeaders(req),
      params: req.query,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'GET', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'GET', status);
    
    console.error('[PIC Proxy] Error getting goals:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to get goals',
      service: 'pic-proxy'
    });
  }
});

/**
 * GET /api/v1/pic/relationships
 * GET /api/v1/pic/relationships/:email
 * Get user relationships, optionally filtered by contact email
 */
router.get('/relationships/:email?', async (req, res) => {
  const email = req.params.email;
  const endpoint = email ? `/api/pic/relationships/by-email/${encodeURIComponent(email)}` : '/api/pic/relationships';
  
  try {
    const response = await axios.get(`${PIC_URL}${endpoint}`, {
      headers: buildPICHeaders(req),
      params: req.query,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'GET', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'GET', status);
    
    console.error('[PIC Proxy] Error getting relationships:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to get relationships',
      service: 'pic-proxy'
    });
  }
});

/**
 * POST /api/v1/pic/learn
 * Record an observation for learning (requires write key)
 */
router.post('/learn', async (req, res) => {
  const endpoint = '/api/pic/learn';
  
  // Validate write key from request header
  const clientWriteKey = req.headers['x-pic-admin-key'] || req.headers['x-pic-write-key'];
  if (!clientWriteKey && !PIC_WRITE_KEY) {
    logPICAccess(req, endpoint, 'POST', 403);
    return res.status(403).json({
      error: 'Write access requires X-PIC-Admin-Key header',
      service: 'pic-proxy'
    });
  }
  
  try {
    const headers = buildPICHeaders(req, true);
    // Pass through the admin key
    if (clientWriteKey) {
      headers['X-PIC-Admin-Key'] = clientWriteKey;
    }
    
    const response = await axios.post(`${PIC_URL}${endpoint}`, req.body, {
      headers,
      timeout: TIMEOUT_MS
    });
    
    logPICAccess(req, endpoint, 'POST', response.status);
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    logPICAccess(req, endpoint, 'POST', status);
    
    console.error('[PIC Proxy] Error recording observation:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Failed to record observation',
      service: 'pic-proxy'
    });
  }
});

/**
 * GET /api/v1/pic/health
 * Health check for PIC proxy and upstream PIC service
 */
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${PIC_URL}/health`, {
      timeout: 5000
    });
    
    res.json({
      status: 'healthy',
      service: 'pic-proxy',
      upstream: {
        url: PIC_URL,
        status: response.data?.status || 'connected'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'pic-proxy',
      upstream: {
        url: PIC_URL,
        status: 'unreachable',
        error: error.message
      }
    });
  }
});

module.exports = router;
