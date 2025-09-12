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