const promClient = require('prom-client');

const register = new promClient.Registry();

// Default metrics (CPU, memory, etc.)
// NOTE: Commented out to avoid duplicate registration - called in app.js instead
// promClient.collectDefaultMetrics({ register });

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