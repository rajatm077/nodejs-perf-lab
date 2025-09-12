# Complete Node.js Performance Lab Setup

## Project Structure
```
nodejs-perf-lab/
├── src/
│   ├── app.js
│   ├── metrics.js
│   ├── routes/
│   │   ├── users.js
│   │   ├── products.js
│   │   └── orders.js
│   └── bottlenecks/
│       └── scenarios.js
├── docker-compose.yml
├── prometheus.yml
├── stress-test/
│   ├── basic-load.js
│   └── scenarios.yml
├── grafana/
│   └── dashboards/
│       └── nodejs-dashboard.json
└── package.json
```

## 1. Node.js Application Setup

### package.json
```json
{
  "name": "nodejs-perf-lab",
  "version": "1.0.0",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js",
    "stress": "node stress-test/basic-load.js",
    "stress:k6": "k6 run stress-test/k6-script.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongodb": "^5.7.0",
    "mongoose": "^7.4.0",
    "redis": "^4.6.7",
    "ioredis": "^5.3.2",
    "prom-client": "^14.2.0",
    "morgan": "^1.10.0",
    "compression": "^1.7.4",
    "bcrypt": "^5.1.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1",
    "autocannon": "^7.12.0",
    "k6": "^0.46.0"
  }
}
```

### src/app.js
```javascript
const express = require('express');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const compression = require('compression');
const morgan = require('morgan');
const { register, collectDefaultMetrics, httpDuration, httpRequestCounter } = require('./metrics');

const app = express();
const PORT = process.env.PORT || 3000;

// Redis connection
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/perflab', {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000
});

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Prometheus metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode.toString())
      .observe(duration / 1000);
    
    httpRequestCounter
      .labels(req.method, req.route?.path || req.path, res.statusCode.toString())
      .inc();
  });
  
  next();
});

// Make Redis available in req
app.use((req, res, next) => {
  req.redis = redis;
  next();
});

// Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid
  });
});

// Start collecting default metrics
collectDefaultMetrics({ register });

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Metrics available at http://localhost:${PORT}/metrics`);
});
```

### src/metrics.js
```javascript
const promClient = require('prom-client');

const register = new promClient.Registry();

// Default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['operation', 'collection'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

const cacheHitRate = new promClient.Counter({
  name: 'cache_operations_total',
  help: 'Cache hit/miss rate',
  labelNames: ['operation', 'result']
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections'
});

const memoryLeakGauge = new promClient.Gauge({
  name: 'potential_memory_leak_bytes',
  help: 'Tracking potential memory leaks'
});

// Register metrics
register.registerMetric(httpDuration);
register.registerMetric(httpRequestCounter);
register.registerMetric(dbQueryDuration);
register.registerMetric(cacheHitRate);
register.registerMetric(activeConnections);
register.registerMetric(memoryLeakGauge);

module.exports = {
  register,
  httpDuration,
  httpRequestCounter,
  dbQueryDuration,
  cacheHitRate,
  activeConnections,
  memoryLeakGauge,
  collectDefaultMetrics: promClient.collectDefaultMetrics
};
```

### src/routes/users.js
```javascript
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { dbQueryDuration, cacheHitRate, memoryLeakGauge } = require('../metrics');
const { createBottleneck } = require('../bottlenecks/scenarios');

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, index: true },
  email: { type: String, required: true, index: true },
  password: String,
  profile: {
    age: Number,
    location: String,
    preferences: Object
  },
  loginHistory: [{ timestamp: Date, ip: String }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Memory leak simulation (for learning)
let leakyArray = [];

// GET all users with pagination
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  try {
    // Check cache first
    const cacheKey = `users:${page}:${limit}`;
    const cached = await req.redis.get(cacheKey);
    
    if (cached) {
      cacheHitRate.labels('get', 'hit').inc();
      return res.json(JSON.parse(cached));
    }
    
    cacheHitRate.labels('get', 'miss').inc();
    
    // Deliberate N+1 query problem (for learning)
    const users = await User.find()
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Simulate additional queries per user (N+1 problem)
    for (let user of users) {
      const loginCount = await User.countDocuments({ 
        'loginHistory.timestamp': { $gte: new Date(Date.now() - 86400000) }
      });
      user.recentLogins = loginCount;
    }
    
    // Cache the result
    await req.redis.setex(cacheKey, 60, JSON.stringify(users));
    
    dbQueryDuration.labels('find', 'users').observe((Date.now() - startTime) / 1000);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create user with deliberate bottlenecks
router.post('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { username, email, password, scenario } = req.body;
    
    // Apply bottleneck scenarios for learning
    if (scenario) {
      await createBottleneck(scenario);
    }
    
    // Expensive password hashing (deliberate high cost)
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Memory leak simulation (for learning)
    leakyArray.push(new Array(1000).fill(req.body));
    memoryLeakGauge.set(leakyArray.length * 1000 * 100); // Approximate bytes
    
    const user = new User({
      username,
      email,
      password: hashedPassword,
      profile: req.body.profile || {}
    });
    
    await user.save();
    
    // Invalidate cache
    const keys = await req.redis.keys('users:*');
    if (keys.length) {
      await req.redis.del(...keys);
    }
    
    dbQueryDuration.labels('insert', 'users').observe((Date.now() - startTime) / 1000);
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET user search (unoptimized regex)
router.get('/search', async (req, res) => {
  const { q } = req.query;
  const startTime = Date.now();
  
  try {
    // Deliberate inefficient regex search (for learning)
    const users = await User.find({
      $or: [
        { username: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
        { 'profile.location': new RegExp(q, 'i') }
      ]
    }).limit(100);
    
    dbQueryDuration.labels('search', 'users').observe((Date.now() - startTime) / 1000);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### src/bottlenecks/scenarios.js
```javascript
// Deliberate bottlenecks for learning purposes
const crypto = require('crypto');

const scenarios = {
  // CPU intensive operation
  cpuIntensive: async (duration = 1000) => {
    const start = Date.now();
    while (Date.now() - start < duration) {
      crypto.pbkdf2Sync('secret', 'salt', 100000, 64, 'sha512');
    }
  },

  // Memory intensive operation
  memoryIntensive: async (sizeMB = 50) => {
    const bigArray = new Array(sizeMB * 1024 * 1024 / 8).fill(Math.random());
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 100));
    return bigArray.length;
  },

  // Event loop blocking
  blockEventLoop: async (duration = 500) => {
    const start = Date.now();
    while (Date.now() - start < duration) {
      // Tight loop blocking event loop
      Math.sqrt(Math.random());
    }
  },

  // Slow I/O operation
  slowIO: async (delay = 2000) => {
    await new Promise(resolve => setTimeout(resolve, delay));
  },

  // Database connection exhaustion
  dbConnectionLeak: async () => {
    const mongoose = require('mongoose');
    // Create new connection without closing (leak)
    const conn = await mongoose.createConnection(process.env.MONGODB_URI || 'mongodb://localhost:27017/perflab');
    // Deliberately not closing connection
  }
};

module.exports = {
  createBottleneck: async (scenario) => {
    if (scenarios[scenario]) {
      await scenarios[scenario]();
    }
  },
  scenarios
};
```

## 2. Docker Compose Setup

### docker-compose.yml
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - MONGODB_URI=mongodb://mongodb:27017/perflab
      - REDIS_HOST=redis
    depends_on:
      - mongodb
      - redis
    networks:
      - monitoring

  mongodb:
    image: mongo:6
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    networks:
      - monitoring

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - monitoring

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ADMIN_USER=admin
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
    networks:
      - monitoring

networks:
  monitoring:
    driver: bridge

volumes:
  mongodb_data:
  prometheus_data:
  grafana_data:
```

### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/app.js"]
```

### prometheus.yml
```yaml
global:
  scrape_interval: 5s
  evaluation_interval: 5s

scrape_configs:
  - job_name: 'nodejs-app'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'mongodb-exporter'
    static_configs:
      - targets: ['mongodb-exporter:9216']

  - job_name: 'redis-exporter'
    static_configs:
      - targets: ['redis-exporter:9121']
```

## 3. Stress Testing Scripts

### stress-test/basic-load.js
```javascript
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
  console.log('=' * 50);
  
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
```

### stress-test/k6-script.js
```javascript
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
```

## 4. Quick Start Guide

### Option A: Local Setup (Recommended for Learning)

```bash
# Clone and setup
git clone <your-repo>
cd nodejs-perf-lab

# Install dependencies
npm install

# Start everything with Docker Compose
docker-compose up -d

# Verify services
curl http://localhost:3000/health
curl http://localhost:3000/metrics

# Access UIs
# - App: http://localhost:3000
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001 (admin/admin)
```

### Option B: Free Cloud Services

#### Grafana Cloud (Free Tier)
1. Sign up at https://grafana.com/auth/sign-up/create-user
2. Get free account with:
   - 10,000 series for Prometheus metrics
   - 50 GB logs
   - 50 GB traces
3. Configure remote_write in prometheus.yml:

```yaml
remote_write:
  - url: https://prometheus-blocks-prod-us-central1.grafana.net/api/prom/push
    basic_auth:
      username: YOUR_METRICS_USER_ID
      password: YOUR_API_KEY
```

#### Alternative Free Options:
- **Railway.app**: Deploy entire stack free (limited hours/month)
- **Render.com**: Free PostgreSQL + Redis
- **MongoDB Atlas**: Free 512MB cluster
- **Upstash Redis**: Free Redis with 10,000 commands/day

### Running Stress Tests

```bash
# Basic load test
npm run stress

# K6 advanced test
k6 run stress-test/k6-script.js

# Custom autocannon test
npx autocannon -c 100 -d 30 http://localhost:3000/api/users

# Monitor while testing
watch -n 1 'curl -s http://localhost:3000/metrics | grep http_request'
```

## 5. Grafana Dashboard Setup

After accessing Grafana:
1. Add Prometheus data source: http://prometheus:9090
2. Import dashboard ID: 11159 (Node.js dashboard)
3. Create custom panels for:
   - Request rate: `rate(http_requests_total[1m])`
   - P95 latency: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`
   - Error rate: `rate(http_requests_total{status=~"5.."}[1m])`
   - Memory leak gauge: `potential_memory_leak_bytes`

## 6. Learning Exercises

### Week 1 Exercises:
1. Generate 10K requests and identify the slowest endpoint
2. Find the memory leak using heap snapshots
3. Identify the N+1 query problem in metrics
4. Create alert for P99 latency > 1s

### Week 2 Exercises:
1. Optimize the bcrypt rounds based on CPU metrics
2. Fix the connection pool exhaustion
3. Implement proper caching strategy
4. Reduce event loop lag under load

## Bottleneck Scenarios to Practice

1. **CPU Bottleneck**: Enable `cpuIntensive` scenario
2. **Memory Leak**: Watch `potential_memory_leak_bytes` grow
3. **Event Loop Blocking**: Enable `blockEventLoop` scenario
4. **Database Issues**: Disable MongoDB indexes
5. **Cache Misses**: Flush Redis during load test