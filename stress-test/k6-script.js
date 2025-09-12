import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 100 },  // Spike to 100
    { duration: '1m', target: 100 },   // Stay at 100
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    errors: ['rate<0.1'],              // Error rate under 10%
  },
};

const BASE_URL = 'http://localhost:3000';

export default function () {
  // Scenario weights
  const scenario = Math.random();
  
  if (scenario < 0.7) {
    // 70% - Read operations
    const res = http.get(`${BASE_URL}/api/users?page=${Math.floor(Math.random() * 10) + 1}`);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
    });
    apiLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    
  } else if (scenario < 0.9) {
    // 20% - Search operations
    const searchTerms = ['john', 'admin', 'test', 'user'];
    const query = searchTerms[Math.floor(Math.random() * searchTerms.length)];
    const res = http.get(`${BASE_URL}/api/users/search?q=${query}`);
    check(res, {
      'search status is 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    
  } else {
    // 10% - Write operations
    const payload = JSON.stringify({
      username: `user_${Date.now()}_${Math.random()}`,
      email: `test${Math.random()}@example.com`,
      password: 'password123',
      profile: {
        age: Math.floor(Math.random() * 50) + 18,
        location: 'Test City'
      }
    });
    
    const params = {
      headers: { 'Content-Type': 'application/json' },
    };
    
    const res = http.post(`${BASE_URL}/api/users`, payload, params);
    check(res, {
      'create status is 201': (r) => r.status === 201,
    });
    errorRate.add(res.status !== 201);
  }
  
  sleep(Math.random() * 2); // Random sleep between 0-2 seconds
}

export function handleSummary(data) {
  return {
    'summary.json': JSON.stringify(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}