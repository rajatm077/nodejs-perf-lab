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
    await mongoose.createConnection(process.env.MONGODB_URI || 'mongodb://localhost:27017/perflab');
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