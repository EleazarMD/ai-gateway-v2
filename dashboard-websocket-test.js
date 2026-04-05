#!/usr/bin/env node

/**
 * AI Gateway v2.0 Dashboard WebSocket Integration Test
 * 
 * This script validates WebSocket connectivity and real-time data streaming
 * for the AI Homelab Dashboard team integration.
 * 
 * Usage:
 *   node dashboard-websocket-test.js [--host=localhost] [--port=7777] [--duration=30]
 */

const WebSocket = require('ws');

// Configuration
const config = {
  host: process.argv.find(arg => arg.startsWith('--host='))?.split('=')[1] || 'localhost',
  port: process.argv.find(arg => arg.startsWith('--port='))?.split('=')[1] || '7777',
  duration: parseInt(process.argv.find(arg => arg.startsWith('--duration='))?.split('=')[1]) || 30,
  apiKey: 'ai-gateway-api-key-2024'
};

const WEBSOCKET_URL = `ws://${config.host}:${config.port}/ws`;

console.log('🚀 AI Gateway v2.0 Dashboard WebSocket Test');
console.log('=' .repeat(50));
console.log(`📡 Target: ${WEBSOCKET_URL}`);
console.log(`🔑 API Key: ${config.apiKey}`);
console.log(`⏱️  Duration: ${config.duration} seconds`);
console.log(`📅 Started: ${new Date().toISOString()}`);
console.log('=' .repeat(50));

// Test metrics
const metrics = {
  connectionAttempts: 0,
  connectionsEstablished: 0,
  messagesReceived: 0,
  subscriptionsConfirmed: 0,
  healthUpdates: 0,
  metricsUpdates: 0,
  errors: 0,
  startTime: Date.now()
};

function connectWebSocket() {
  metrics.connectionAttempts++;
  
  console.log(`\n🔌 Connection attempt #${metrics.connectionAttempts}`);
  
  const ws = new WebSocket(`${WEBSOCKET_URL}?apiKey=${config.apiKey}`);
  
  // Connection timeout
  const connectionTimeout = setTimeout(() => {
    console.log('⏰ Connection timeout - closing...');
    ws.close();
  }, 10000);
  
  ws.on('open', () => {
    clearTimeout(connectionTimeout);
    metrics.connectionsEstablished++;
    
    console.log('✅ WebSocket connection established');
    console.log(`   📊 Connection #${metrics.connectionsEstablished} of ${metrics.connectionAttempts} attempts`);
    
    // Subscribe to channels with delays
    const channels = ['health', 'metrics', 'events'];
    
    channels.forEach((channel, index) => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`📋 Subscribing to channel: ${channel}`);
          ws.send(JSON.stringify({
            type: 'subscribe',
            channel: channel,
            timestamp: new Date().toISOString()
          }));
        }
      }, (index + 1) * 2000); // 2 second intervals
    });
    
    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
    
    // Auto-close after test duration
    setTimeout(() => {
      console.log('\n⏰ Test duration completed. Closing connection...');
      clearInterval(pingInterval);
      ws.close(1000, 'Test completed');
    }, config.duration * 1000);
  });
  
  ws.on('message', (data) => {
    metrics.messagesReceived++;
    
    try {
      const message = JSON.parse(data);
      const timestamp = new Date().toISOString();
      
      console.log(`\n📨 [${metrics.messagesReceived}] Message received at ${timestamp}`);
      console.log(`   Type: ${message.type}`);
      
      switch (message.type) {
        case 'connection_established':
          console.log(`   🔗 Connection confirmed`);
          console.log(`   📅 Server timestamp: ${message.data?.timestamp}`);
          break;
          
        case 'subscription_confirmed':
          metrics.subscriptionsConfirmed++;
          console.log(`   ✅ Subscription confirmed for: ${message.data?.channel}`);
          console.log(`   📊 Total subscriptions: ${metrics.subscriptionsConfirmed}`);
          break;
          
        case 'health':
          metrics.healthUpdates++;
          console.log(`   💚 Health update #${metrics.healthUpdates}`);
          if (message.data) {
            console.log(`      Status: ${message.data.status}`);
            console.log(`      Uptime: ${Math.round(message.data.uptime)}s`);
            console.log(`      Memory RSS: ${Math.round(message.data.memory?.rss / 1024 / 1024)}MB`);
            console.log(`      Port: ${message.data.port}`);
          }
          break;
          
        case 'metrics':
          metrics.metricsUpdates++;
          console.log(`   📈 Metrics update #${metrics.metricsUpdates}`);
          if (message.data) {
            console.log(`      Requests: ${JSON.stringify(message.data.requests)}`);
            console.log(`      Providers: ${JSON.stringify(message.data.providers)}`);
            console.log(`      CPU: ${JSON.stringify(message.data.performance?.cpu)}`);
          }
          break;
          
        case 'events':
          console.log(`   📢 Event received`);
          console.log(`      Data: ${JSON.stringify(message.data)}`);
          break;
          
        default:
          console.log(`   ❓ Unknown message type: ${message.type}`);
          console.log(`      Data keys: ${message.data ? Object.keys(message.data) : 'none'}`);
      }
      
    } catch (error) {
      console.log(`   📨 Raw message: ${data.toString().substring(0, 200)}...`);
    }
  });
  
  ws.on('pong', () => {
    console.log('🏓 Pong received - connection alive');
  });
  
  ws.on('error', (error) => {
    clearTimeout(connectionTimeout);
    metrics.errors++;
    console.error(`\n❌ WebSocket error #${metrics.errors}:`, error.message);
    
    // Attempt reconnection after 5 seconds if within test duration
    const elapsed = (Date.now() - metrics.startTime) / 1000;
    if (elapsed < config.duration - 10) {
      console.log('🔄 Attempting reconnection in 5 seconds...');
      setTimeout(() => connectWebSocket(), 5000);
    }
  });
  
  ws.on('close', (code, reason) => {
    clearTimeout(connectionTimeout);
    const elapsed = Math.round((Date.now() - metrics.startTime) / 1000);
    
    console.log(`\n🔌 WebSocket connection closed after ${elapsed}s`);
    console.log(`   Code: ${code}`);
    console.log(`   Reason: ${reason || 'No reason provided'}`);
    
    // Print final metrics
    console.log('\n📊 Final Test Metrics:');
    console.log('=' .repeat(30));
    console.log(`Connection attempts: ${metrics.connectionAttempts}`);
    console.log(`Successful connections: ${metrics.connectionsEstablished}`);
    console.log(`Messages received: ${metrics.messagesReceived}`);
    console.log(`Subscriptions confirmed: ${metrics.subscriptionsConfirmed}`);
    console.log(`Health updates: ${metrics.healthUpdates}`);
    console.log(`Metrics updates: ${metrics.metricsUpdates}`);
    console.log(`Errors encountered: ${metrics.errors}`);
    console.log(`Test duration: ${elapsed}s`);
    console.log(`Success rate: ${Math.round((metrics.connectionsEstablished / metrics.connectionAttempts) * 100)}%`);
    
    // Determine test result
    const success = metrics.connectionsEstablished > 0 && 
                   metrics.subscriptionsConfirmed >= 2 && 
                   (metrics.healthUpdates > 0 || metrics.metricsUpdates > 0);
    
    console.log(`\n${success ? '✅ TEST PASSED' : '❌ TEST FAILED'}`);
    
    if (!success) {
      console.log('\n🔍 Troubleshooting tips:');
      console.log('- Ensure AI Gateway v2.0 is running on the specified host/port');
      console.log('- Verify the API key is correct');
      console.log('- Check if port forwarding is active (kubectl port-forward)');
      console.log('- Confirm WebSocket support is enabled in the deployment');
    }
    
    process.exit(success ? 0 : 1);
  });
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

// Start the test
console.log('\n🏁 Starting WebSocket connection test...');
connectWebSocket();
