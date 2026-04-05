/**
 * Hermes Core Proxy Routes
 *
 * Proxies Hermes Core requests through AI Gateway for:
 * - Centralized audit logging
 * - Rate limiting per service
 * - Authentication validation
 * - Service attribution
 *
 * Zero-Tolerance Security Architecture:
 * OpenClaw and other clients must route Hermes access through AI Gateway.
 */

const express = require('express');
const axios = require('axios');

const router = express.Router();

const HERMES_URL = (process.env.HERMES_CORE_URL || 'http://100.108.41.22:8780').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

function logHermesAccess(req, endpoint, method, statusCode) {
  const serviceId = req.headers['x-service-id'] || req.headers['x-forwarded-service'] || 'unknown';
  const userId = req.headers['x-user-id'] || req.query.user_id || req.body?.user_id || 'default';
  console.log(`[Hermes Proxy] ${method} ${endpoint} | service=${serviceId} user=${userId} status=${statusCode}`);
}

function buildHermesHeaders(req) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-Service': req.headers['x-service-id'] || 'ai-gateway',
    'X-Forwarded-For': req.ip || req.connection?.remoteAddress || 'unknown'
  };

  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  if (req.headers['x-user-id']) {
    headers['X-User-ID'] = req.headers['x-user-id'];
  }

  return headers;
}

router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${HERMES_URL}/health`, { timeout: 5000 });
    res.json({
      status: 'healthy',
      service: 'hermes-proxy',
      upstream: {
        url: HERMES_URL,
        status: response.status,
        healthy: true
      }
    });
  } catch (error) {
    res.json({
      status: 'degraded',
      service: 'hermes-proxy',
      upstream: {
        url: HERMES_URL,
        healthy: false,
        error: error.message
      }
    });
  }
});

router.all('/*', async (req, res) => {
  const endpoint = req.path;
  try {
    const response = await axios({
      method: req.method,
      url: `${HERMES_URL}${endpoint}`,
      headers: buildHermesHeaders(req),
      params: req.query,
      data: req.body,
      timeout: TIMEOUT_MS,
      validateStatus: () => true
    });

    logHermesAccess(req, endpoint, req.method, response.status);
    res.status(response.status).send(response.data);
  } catch (error) {
    const status = error.response?.status || 502;
    logHermesAccess(req, endpoint, req.method, status);
    console.error('[Hermes Proxy] Error:', error.message);
    res.status(status).json({
      error: error.response?.data?.error || 'Hermes proxy request failed',
      service: 'hermes-proxy'
    });
  }
});

module.exports = router;
