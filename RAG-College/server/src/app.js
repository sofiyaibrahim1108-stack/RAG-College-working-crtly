const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { CLIENT_URL } = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const departmentRoutes = require('./routes/department.routes');
const documentRoutes = require('./routes/document.routes');
const chatRoutes = require('./routes/chat.routes');
const imageRoutes = require('./routes/image.routes');
const driveRoutes = require('./routes/drive.routes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const auditRoutes = require('./routes/audit.routes');
const mediaRoutes = require('./routes/media.routes'); 

const app = express();

// Request ID Tracing Middleware (Must be before loggers and routes)
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// CORS Configuration
app.use(
  cors({
    origin: CLIENT_URL || 'http://localhost:5173',
    credentials: true
  })
);

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gracefully catch malformed JSON payloads
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or malformed JSON payload received'
    });
  }
  next(err);
});

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
app.use('/api/users', userRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/media-library', mediaRoutes); // 👈 Mounted here

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

module.exports = app;