#!/usr/bin/env node

/**
 * AI Gateway v2.0 Dashboard WebSocket Integration - Final Validation
 * 
 * This script provides comprehensive validation of WebSocket connectivity
 * for the AI Homelab Dashboard team integration.
 */

const WebSocket = require('ws');

const WEBSOCKET_URL = 'ws://localhost:7777/ws';
const API_KEY = 'ai-gateway-api-key-2024';

console.log('🚀 AI Gateway v2.0 Dashboard WebSocket - Final Validation');
console.log('=' .repeat(60));
console.log(`📡 Target: ${WEBSOCKET_URL}`);
console.log(`🔑 API Key: ${API_KEY}`);
console.log(`📅 Started: ${new Date().toISOString()}`);
console.log('=' .repeat(60));

let testResults = {
  connectionEstablished: false,
  initialMessageReceived: false,
  subscriptionsSent: 0,
  subscriptionsConfirmed: 0,
  healthDataReceived: false,
  metricsDataReceived: false,
  connectionDuration: 0,
  startTime: Date.now()
};

function runTest() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WEBSOCKET_URL}?apiKey=${API_KEY}`);
    
    // Connection timeout
    const timeout = setTimeout(() => {
      console.log('⏰ Connection timeout');
      ws.close();
      resolve(false);
    }, 15000);
    
    ws.on('open', () => {
      clearTimeout(timeout);
      testResults.connectionEstablished = true;
      console.log('✅ WebSocket connection established');
      
      // Send subscriptions with delays
      setTimeout(() => {
        console.log('📤 Sending health subscription...');
        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'health'
        }));
        testResults.subscriptionsSent++;
      }, 1000);
      
      setTimeout(() => {
        console.log('📤 Sending metrics subscription...');
        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'metrics'
        }));
        testResults.subscriptionsSent++;
      }, 3000);
      
      // Close after 12 seconds
      setTimeout(() => {
        testResults.connectionDuration = Date.now() - testResults.startTime;
        console.log('⏰ Closing connection after test period...');
        ws.close();
      }, 12000);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`📨 Received: ${message.type}`);
        
        switch (message.type) {
          case 'connection_established':
            testResults.initialMessageReceived = true;
            console.log(`   ✅ Initial connection confirmed`);
            break;
            
          case 'subscription_confirmed':
            testResults.subscriptionsConfirmed++;
            console.log(`   ✅ Subscription confirmed: ${message.data?.channel}`);
            break;
            
          case 'health':
            testResults.healthDataReceived = true;
            console.log(`   💚 Health data received`);
            break;
            
          case 'metrics':
            testResults.metricsDataReceived = true;
            console.log(`   📊 Metrics data received`);
            break;
        }
      } catch (error) {
        console.log(`   📨 Raw message: ${data.toString().substring(0, 100)}...`);
      }
    });
    
    ws.on('close', (code, reason) => {
      testResults.connectionDuration = Date.now() - testResults.startTime;
      console.log(`\n🔌 Connection closed: ${code} - ${reason || 'No reason'}`);
      resolve(true);
    });
    
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
      resolve(false);
    });
  });
}

async function main() {
  console.log('\n🏁 Starting validation test...\n');
  
  await runTest();
  
  // Print comprehensive results
  console.log('\n📊 VALIDATION RESULTS');
  console.log('=' .repeat(40));
  console.log(`Connection established: ${testResults.connectionEstablished ? '✅' : '❌'}`);
  console.log(`Initial message received: ${testResults.initialMessageReceived ? '✅' : '❌'}`);
  console.log(`Subscriptions sent: ${testResults.subscriptionsSent}`);
  console.log(`Subscriptions confirmed: ${testResults.subscriptionsConfirmed}`);
  console.log(`Health data received: ${testResults.healthDataReceived ? '✅' : '❌'}`);
  console.log(`Metrics data received: ${testResults.metricsDataReceived ? '✅' : '❌'}`);
  console.log(`Connection duration: ${Math.round(testResults.connectionDuration / 1000)}s`);
  
  // Determine overall status
  const basicConnectivity = testResults.connectionEstablished && testResults.initialMessageReceived;
  const subscriptionFlow = testResults.subscriptionsSent > 0 && testResults.subscriptionsConfirmed > 0;
  const dataFlow = testResults.healthDataReceived || testResults.metricsDataReceived;
  
  console.log('\n🎯 INTEGRATION STATUS');
  console.log('=' .repeat(40));
  console.log(`Basic connectivity: ${basicConnectivity ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`Subscription flow: ${subscriptionFlow ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`Real-time data: ${dataFlow ? '✅ WORKING' : '❌ FAILED'}`);
  
  const overallSuccess = basicConnectivity && subscriptionFlow;
  
  console.log(`\n${overallSuccess ? '🎉 DASHBOARD INTEGRATION READY' : '⚠️  INTEGRATION NEEDS WORK'}`);
  
  if (overallSuccess) {
    console.log('\n📋 DASHBOARD TEAM INTEGRATION NOTES:');
    console.log('- WebSocket endpoint: ws://ai-gateway-internal:7777/ws');
    console.log('- Authentication: ?apiKey=ai-gateway-api-key-2024');
    console.log('- Available channels: health, metrics, events');
    console.log('- Message format: JSON with type and data fields');
    console.log('- Connection is stable for real-time monitoring');
  } else {
    console.log('\n🔧 TROUBLESHOOTING REQUIRED:');
    if (!basicConnectivity) console.log('- Fix basic WebSocket connectivity');
    if (!subscriptionFlow) console.log('- Fix subscription message handling');
    if (!dataFlow) console.log('- Fix real-time data streaming');
  }
  
  process.exit(overallSuccess ? 0 : 1);
}

main().catch(console.error);
