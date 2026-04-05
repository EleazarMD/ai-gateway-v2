#!/usr/bin/env node

const WebSocket = require('ws');

console.log('🔌 Simple WebSocket Test');
console.log('Connecting to ws://localhost:7777/ws...');

const ws = new WebSocket('ws://localhost:7777/ws?apiKey=ai-gateway-api-key-2024');

ws.on('open', () => {
  console.log('✅ Connected');
  
  // Wait 2 seconds, then send subscription
  setTimeout(() => {
    console.log('📤 Sending subscription...');
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'health'
    }));
  }, 2000);
  
  // Close after 10 seconds
  setTimeout(() => {
    console.log('⏰ Closing connection...');
    ws.close();
  }, 10000);
});

ws.on('message', (data) => {
  console.log('📨 Received:', data.toString());
});

ws.on('close', (code, reason) => {
  console.log(`🔌 Closed: ${code} - ${reason}`);
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ Error:', error.message);
});
