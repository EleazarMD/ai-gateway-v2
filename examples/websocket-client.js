#!/usr/bin/env node

/**
 * WebSocket Client Example
 * Demonstrates real-time security alerts, anomalies, and audit events
 * 
 * Usage:
 *   node examples/websocket-client.js
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:7777/ws?apiKey=ai-gateway-api-key-2024';

console.log('🌐 Connecting to AI Gateway WebSocket...');
console.log(`   URL: ${WS_URL}\n`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server\n');
  
  // Subscribe to security channels
  console.log('📡 Subscribing to security channels...');
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'security:alerts'
  }));
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'security:anomalies'
  }));
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'security:audit'
  }));
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'health'
  }));
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'metrics'
  }));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    
    switch (message.type) {
      case 'connection':
        console.log('✅ Connection established');
        console.log(`   Client ID: ${message.clientId}`);
        console.log(`   Available channels: ${message.availableChannels.join(', ')}\n`);
        break;
      
      case 'subscribed':
        console.log(`✅ Subscribed to channel: ${message.channel}`);
        break;
      
      case 'security:alert':
        console.log('\n🚨 ALERT RECEIVED:');
        console.log(`   Alert ID: ${message.data.alert_id}`);
        console.log(`   Severity: ${message.data.severity.toUpperCase()}`);
        console.log(`   Title: ${message.data.title}`);
        console.log(`   Message: ${message.data.message}`);
        console.log(`   Status: ${message.data.status}`);
        console.log(`   Triggered: ${message.data.triggered_at}`);
        if (message.data.context) {
          console.log(`   Context: ${JSON.stringify(message.data.context, null, 2)}`);
        }
        console.log('');
        break;
      
      case 'security:anomaly':
        console.log('\n⚠️  ANOMALY DETECTED:');
        console.log(`   Anomaly ID: ${message.data.anomaly_id}`);
        console.log(`   Type: ${message.data.anomaly_type}`);
        console.log(`   Severity: ${message.data.severity}`);
        console.log(`   Description: ${message.data.description}`);
        console.log(`   Detected: ${message.data.detected_at}`);
        console.log('');
        break;
      
      case 'security:audit':
        console.log('\n📋 AUDIT EVENT:');
        console.log(`   Event ID: ${message.data.event_id}`);
        console.log(`   Type: ${message.data.event_type}`);
        console.log(`   Actor: ${message.data.actor}`);
        console.log(`   Action: ${message.data.action}`);
        console.log(`   Outcome: ${message.data.outcome}`);
        console.log('');
        break;
      
      case 'health':
        console.log(`💚 Health update: ${message.data.status} (uptime: ${Math.floor(message.data.uptime)}s)`);
        break;
      
      case 'metrics':
        console.log(`📊 Metrics update: ${message.data.websocket.connectedClients} clients connected`);
        break;
      
      case 'error':
        console.error(`❌ Error: ${message.error}`);
        if (message.detail) {
          console.error(`   Detail: ${message.detail}`);
        }
        break;
      
      default:
        console.log(`📨 Message: ${message.type}`);
    }
  } catch (error) {
    console.error('Failed to parse message:', error.message);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('\n❌ Disconnected from WebSocket server');
  process.exit(0);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Closing connection...');
  ws.close();
});

console.log('👂 Listening for real-time security events...');
console.log('   Press Ctrl+C to exit\n');
