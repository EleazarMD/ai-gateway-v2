/**
 * Workspace Proxy Routes
 * Proxies workspace operations (pages, databases, blocks) to dashboard or core service
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

// Dashboard URL (where workspace core lives)
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:8404';

/**
 * Pages Endpoints
 */

// Create page
router.post('/pages', async (req, res) => {
  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/workspace/pages`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error creating page:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to create page'
    });
  }
});

// Get page
router.get('/pages/:pageId', async (req, res) => {
  try {
    const response = await axios.get(
      `${DASHBOARD_URL}/api/workspace/pages/${req.params.pageId}`,
      { params: req.query }
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error getting page:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to get page'
    });
  }
});

// Update page
router.put('/pages/:pageId', async (req, res) => {
  try {
    const response = await axios.put(
      `${DASHBOARD_URL}/api/workspace/pages/${req.params.pageId}`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error updating page:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to update page'
    });
  }
});

// Delete page
router.delete('/pages/:pageId', async (req, res) => {
  try {
    const response = await axios.delete(
      `${DASHBOARD_URL}/api/workspace/pages/${req.params.pageId}`,
      { data: req.body }
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error deleting page:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to delete page'
    });
  }
});

// List pages
router.get('/pages', async (req, res) => {
  try {
    const response = await axios.get(`${DASHBOARD_URL}/api/workspace/pages`, {
      params: req.query
    });
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error listing pages:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to list pages'
    });
  }
});

/**
 * Database Endpoints
 */

// Create database
router.post('/databases', async (req, res) => {
  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/workspace/databases`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error creating database:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to create database'
    });
  }
});

// Query database
router.post('/databases/:databaseId/query', async (req, res) => {
  try {
    const response = await axios.post(
      `${DASHBOARD_URL}/api/workspace/databases/${req.params.databaseId}/query`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error querying database:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to query database'
    });
  }
});

// Get database schema
router.get('/databases/:databaseId/schema', async (req, res) => {
  try {
    const response = await axios.get(
      `${DASHBOARD_URL}/api/workspace/databases/${req.params.databaseId}/schema`
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error getting schema:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to get schema'
    });
  }
});

/**
 * Block Endpoints
 */

// Create block
router.post('/blocks', async (req, res) => {
  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/workspace/blocks`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error creating block:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to create block'
    });
  }
});

// Update block
router.put('/blocks/:blockId', async (req, res) => {
  try {
    const response = await axios.put(
      `${DASHBOARD_URL}/api/workspace/blocks/${req.params.blockId}`,
      req.body
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error updating block:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to update block'
    });
  }
});

// Get page blocks
router.get('/pages/:pageId/blocks', async (req, res) => {
  try {
    const response = await axios.get(
      `${DASHBOARD_URL}/api/workspace/pages/${req.params.pageId}/blocks`
    );
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error getting blocks:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to get blocks'
    });
  }
});

/**
 * Search Endpoints
 */

// Search pages
router.get('/search/pages', async (req, res) => {
  try {
    const response = await axios.get(`${DASHBOARD_URL}/api/workspace/search/pages`, {
      params: req.query
    });
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error searching pages:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to search pages'
    });
  }
});

/**
 * Validation Endpoints
 */

// Validate schema
router.post('/validate/schema', async (req, res) => {
  try {
    const response = await axios.post(`${DASHBOARD_URL}/api/workspace/validate/schema`, req.body);
    res.json(response.data);
  } catch (error) {
    console.error('[Workspace Proxy] Error validating schema:', error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to validate schema'
    });
  }
});

module.exports = router;
