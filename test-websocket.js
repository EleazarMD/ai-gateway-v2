#!/usr/bin/env node

/**
 * WebSocket Test Script for AI Gateway v2.0 Dashboard Integration
 * Tests WebSocket connection and channel subscriptions for Dashboard team
 */

const WebSocket = require('ws');

const WEBSOCKET_URL = 'ws://localhost:7777/ws';
const API_KEY = 'ai-gateway-api-key-2024';

console.log('🔌 Testing AI Gateway v2.0 WebSocket Integration');
console.log(`📡 Connecting to: ${WEBSOCKET_URL}`);

// Create WebSocket connection with API key authentication
const ws = new WebSocket(`${WEBSOCKET_URL}?apiKey=${API_KEY}`);

ws.on('open', () => {
  console.log('✅ WebSocket connection established');
  
  // Test channel subscriptions
  const channels = ['health', 'metrics', 'events'];
  
  channels.forEach((channel, index) => {
    setTimeout(() => {
      console.log(`📋 Subscribing to channel: ${channel}`);
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: channel
      }));
    }, index * 1000);
  });
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    console.log(`📨 Received message:`, {
      type: message.type,
      channel: message.channel || 'N/A',
      timestamp: message.timestamp || message.data?.timestamp,
      dataKeys: message.data ? Object.keys(message.data) : []
    });
    
    // Show sample data for different message types
    if (message.type === 'health' && message.data) {
      console.log(`   💚 Health Status: ${message.data.status}, Memory: ${Math.round(message.data.memory?.heapUsed / 1024 / 1024)}MB`);
    } else if (message.type === 'metrics' && message.data) {
      console.log(`   📊 Metrics: ${Object.keys(message.data).join(', ')}`);
    } else if (message.type === 'connection_established') {
      console.log(`   🔗 Connection confirmed at: ${message.data?.timestamp}`);
    } else if (message.type === 'subscription_confirmed') {
      console.log(`   ✅ Subscription confirmed for: ${message.data?.channel}`);
    }
  } catch (error) {
    console.log(`📨 Raw message:`, data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔌 WebSocket connection closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
});

// Test duration - give more time for subscriptions
setTimeout(() => {
  console.log('⏰ Test completed. Closing connection...');
  ws.close();
}, 20000);

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted. Closing connection...');
  ws.close();
  process.exit(0);
});
