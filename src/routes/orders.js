const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { dbQueryDuration, cacheHitRate } = require('../metrics');
const { createBottleneck } = require('../bottlenecks/scenarios');

// Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, default: uuidv4 },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  items: [{
    productId: mongoose.Schema.Types.ObjectId,
    quantity: Number,
    price: Number
  }],
  totalAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  shippingAddress: {
    street: String,
    city: String,
    zipCode: String,
    country: String
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

// GET all orders with pagination and filtering
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { status, userId, page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const cacheKey = `orders:${status || 'all'}:${userId || 'all'}:${page}:${limit}`;
    const cached = await req.redis.get(cacheKey);
    
    if (cached) {
      cacheHitRate.labels('get', 'hit').inc();
      return res.json(JSON.parse(cached));
    }
    
    cacheHitRate.labels('get', 'miss').inc();

    // Build query
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    // Deliberate inefficient population (for learning)
    const orders = await Order.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Simulate N+1 problem by fetching user details for each order
    for (let order of orders) {
      const User = mongoose.model('User');
      const user = await User.findById(order.userId).select('username email');
      order.userDetails = user;
    }

    // Cache for 2 minutes
    await req.redis.setex(cacheKey, 120, JSON.stringify(orders));
    
    dbQueryDuration.labels('find', 'orders').observe((Date.now() - startTime) / 1000);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create order
router.post('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { userId, items, shippingAddress, scenario } = req.body;
    
    // Apply bottleneck scenarios for learning
    if (scenario) {
      await createBottleneck(scenario);
    }
    
    // Calculate total (inefficient way for learning)
    let totalAmount = 0;
    for (let item of items) {
      const Product = mongoose.model('Product');
      const product = await Product.findById(item.productId);
      if (product) {
        totalAmount += product.price * item.quantity;
        item.price = product.price;
      }
    }
    
    const order = new Order({
      userId,
      items,
      totalAmount,
      shippingAddress
    });
    
    await order.save();
    
    // Invalidate caches
    const keys = await req.redis.keys('orders:*');
    if (keys.length) {
      await req.redis.del(...keys);
    }
    
    dbQueryDuration.labels('insert', 'orders').observe((Date.now() - startTime) / 1000);
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET order by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const cacheKey = `order:${req.params.id}`;
    const cached = await req.redis.get(cacheKey);
    
    if (cached) {
      cacheHitRate.labels('get', 'hit').inc();
      return res.json(JSON.parse(cached));
    }
    
    cacheHitRate.labels('get', 'miss').inc();
    
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Inefficient population for learning
    const User = mongoose.model('User');
    const user = await User.findById(order.userId).select('username email');
    order.userDetails = user;
    
    // Cache for 5 minutes
    await req.redis.setex(cacheKey, 300, JSON.stringify(order));
    
    dbQueryDuration.labels('findById', 'orders').observe((Date.now() - startTime) / 1000);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update order status
router.put('/:id/status', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { status } = req.body;
    
    const order = await Order.findByIdAndUpdate(
      req.params.id, 
      { status, updatedAt: new Date() },
      { new: true }
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Invalidate caches
    await req.redis.del(`order:${req.params.id}`);
    const keys = await req.redis.keys('orders:*');
    if (keys.length) {
      await req.redis.del(...keys);
    }
    
    dbQueryDuration.labels('update', 'orders').observe((Date.now() - startTime) / 1000);
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;