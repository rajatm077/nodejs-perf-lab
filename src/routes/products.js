const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { dbQueryDuration, cacheHitRate } = require('../metrics');

// Product Schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  description: String,
  price: { type: Number, required: true },
  category: { type: String, index: true },
  stock: { type: Number, default: 0 },
  tags: [String],
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// GET all products with filtering
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { category, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const cacheKey = `products:${category || 'all'}:${minPrice || 0}:${maxPrice || 'max'}:${page}:${limit}`;
    const cached = await req.redis.get(cacheKey);
    
    if (cached) {
      cacheHitRate.labels('get', 'hit').inc();
      return res.json(JSON.parse(cached));
    }
    
    cacheHitRate.labels('get', 'miss').inc();

    // Build query
    const query = {};
    if (category) query.category = category;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    const products = await Product.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Cache for 5 minutes
    await req.redis.setex(cacheKey, 300, JSON.stringify(products));
    
    dbQueryDuration.labels('find', 'products').observe((Date.now() - startTime) / 1000);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create product
router.post('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const product = new Product(req.body);
    await product.save();
    
    // Invalidate related caches
    const keys = await req.redis.keys('products:*');
    if (keys.length) {
      await req.redis.del(...keys);
    }
    
    dbQueryDuration.labels('insert', 'products').observe((Date.now() - startTime) / 1000);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET product by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const cacheKey = `product:${req.params.id}`;
    const cached = await req.redis.get(cacheKey);
    
    if (cached) {
      cacheHitRate.labels('get', 'hit').inc();
      return res.json(JSON.parse(cached));
    }
    
    cacheHitRate.labels('get', 'miss').inc();
    
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Cache individual product for 10 minutes
    await req.redis.setex(cacheKey, 600, JSON.stringify(product));
    
    dbQueryDuration.labels('findById', 'products').observe((Date.now() - startTime) / 1000);
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;