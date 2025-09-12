#!/usr/bin/env node

const autocannon = require('autocannon');

const scenarios = [
  {
    name: 'Basic Load Test',
    url: 'http://localhost:3000/api/users',
    connections: 10,
    duration: 30,
    pipelining: 1,
    requests: [
      {
        method: 'GET',
        path: '/api/users?page=1&limit=10'
      }
    ]
  },
  {
    name: 'Write Heavy Load',
    url: 'http://localhost:3000/api/users',
    connections: 50,
    duration: 30,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'user_' + Date.now(),
      email: 'test@example.com',
      password: 'password123',
      scenario: 'cpuIntensive' // Enable bottleneck
    })
  },
  {
    name: 'Mixed Load Pattern',
    url: 'http://localhost:3000',
    connections: 100,
    duration: 60,
    requests: [
      {
        method: 'GET',
        path: '/api/users',
        weight: 7
      },
      {
        method: 'GET',
        path: '/api/users/search?q=test',
        weight: 2
      },
      {
        method: 'POST',
        path: '/api/users',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'load_test',
          email: 'load@test.com',
          password: 'test123'
        }),
        weight: 1
      }
    ]
  }
];

async function runScenario(scenario) {
  console.log(`\n🚀 Running: ${scenario.name}`);
  console.log('='.repeat(50));
  
  const result = await autocannon(scenario);
  
  console.log('\n📊 Results:');
  console.log(`Latency (avg): ${result.latency.mean} ms`);
  console.log(`Latency (p99): ${result.latency.p99} ms`);
  console.log(`Requests/sec: ${result.requests.mean}`);
  console.log(`Bytes/sec: ${result.throughput.mean}`);
  console.log(`Errors: ${result.errors}`);
  console.log(`Timeouts: ${result.timeouts}`);
}

async function runAllScenarios() {
  for (const scenario of scenarios) {
    await runScenario(scenario);
    // Wait between scenarios
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// Run specific scenario or all
const scenarioIndex = process.argv[2];
if (scenarioIndex) {
  runScenario(scenarios[scenarioIndex]);
} else {
  runAllScenarios();
}