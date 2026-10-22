const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { CLIENT_URL } = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const departmentRoutes = require('./routes/department.routes');
const documentRoutes = require('./routes/document.routes');
const chatRoutes = require('./routes/chat.routes');
const imageRoutes = require('./routes/image.routes');
const driveRoutes = require('./routes/drive.routes');
const Image = require('./models/Image');
const crypto = require('crypto');
const authRoutes = require('./routes/auth.routes');

const app = express();

// Middlewares
app.use(
  cors({
    origin: CLIENT_URL || 'http://localhost:5173',
    credentials: true
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lightweight request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.includes('/health')) {
      console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    }
  });
  next();
});

// Mount Standard Routes
app.use('/api/health', healthRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/auth', authRoutes);

// Direct route handler for frontend image streaming fallback (e.g. GET /:id/file)
app.get('/:id/file', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid image ID' });
    }

    const image = await Image.findById(id);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    const filePath = image.filePath || image.imagePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Physical image file not found on disk' });
    }

    res.setHeader('Content-Type', image.mimeType || 'image/png');
    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Error streaming image file:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'College RAG API',
    version: '1.0.0',
    phase: 'Phase 4 - Multimodal RAG with SigLIP',
    status: 'online'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});


// Request ID Tracing Middleware
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

module.exports = app;
