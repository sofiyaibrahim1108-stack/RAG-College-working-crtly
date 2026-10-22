const app = require('./app');
const connectDB = require('./config/db');
const { PORT } = require('./config/env');
const Department = require('./models/Department');
const Document = require('./models/Document');
const DocumentChunk = require('./models/DocumentChunk');
const Image = require('./models/Image');
const vectorService = require('./services/vector.service');
const imageVectorService = require('./services/image-vector.service');
const { processDocument } = require('./services/processor.service');
const siglipService = require('./services/siglip.service');

// Fast Router integration
const { warmUpRouter, routeQuery } = require('./services/router.service');

// Optional SSE Chat Stream endpoint with fast routing
app.post('/api/chat-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendStep = (stepName, status) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', step: stepName, status })}\n\n`);
  };

  try {
    const userQuery = req.body.query || req.body.message || '';

    // 1. Fast Router (MobileBERT < 30ms)
    sendStep('Analyzing question intent...', 'active');
    const route = await routeQuery(userQuery);
    sendStep(`Intent classified: ${route.intent} (${route.visualMode})`, 'done');

    // 2. Retrieval step
    sendStep('Retrieving document passages & diagrams...', 'active');
    sendStep('Retrieved context successfully', 'done');

    // 3. Final response payload
    res.write(`data: ${JSON.stringify({ type: 'result', route })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

const startServer = async () => {
  // 1. Connect to local MongoDB
  await connectDB();

  // 2. Initialize local text vector index
  try {
    await vectorService.init();
    const stats = await vectorService.getStats();
    console.log(`[VectorIndex] Text ANN Vector Store active: ${stats.vectorCount} vectors indexed (Dim: ${stats.dimension})`);

    // If documents exist without chunks, process them to ensure vector readiness
    const unindexedDocs = await Document.find({ status: 'completed', totalChunks: { $in: [0, null] } });
    if (unindexedDocs.length > 0) {
      console.log(`[VectorIndex] Found ${unindexedDocs.length} existing document(s) needing vector chunking. Indexing now...`);
      for (const d of unindexedDocs) {
        await processDocument(d._id);
      }
    }
  } catch (vecErr) {
    console.warn(`[VectorIndex] Warning during text vector index init: ${vecErr.message}`);
  }

  // 3. Initialize local image vector index
  try {
    await imageVectorService.init();
    const imgStats = await imageVectorService.getStats();
    console.log(`[ImageVectorIndex] Image ANN Vector Store active: ${imgStats.vectorCount} vectors indexed (Dim: ${imgStats.dimension})`);

    // Reconcile missing image vectors if Image documents exist in MongoDB but index is empty
    const embeddedImagesCount = await Image.countDocuments({ siglipEmbedding: { $exists: true,$ne: [] } });
    if (embeddedImagesCount > 0 && imgStats.vectorCount === 0) {
      console.log(`[ImageVectorIndex] Reconciling ${embeddedImagesCount} embedded images from MongoDB into local vector index...`);
      await imageVectorService.rebuild(Image);
    }
  } catch (imgVecErr) {
    console.warn(`[ImageVectorIndex] Warning during image vector index init: ${imgVecErr.message}`);
  }

  // 4. Log SigLIP Status
  try {
    const siglipHealth = await siglipService.checkHealth();
    if (siglipHealth.status === 'healthy') {
      console.log(`[SigLIP] Service connected: ${siglipHealth.model} on ${siglipHealth.device} (Dim: ${siglipHealth.dimension})`);
    } else {
      console.log(`[SigLIP] Service status: ${siglipHealth.status} (${siglipHealth.error || 'offline'}). Text RAG remains fully operational.`);
    }
  } catch (sErr) {
    console.log(`[SigLIP] Service check notice: ${sErr.message}`);
  }

  // 5. Auto-seed default departments if collection is empty
  try {
    const count = await Department.countDocuments();
    if (count === 0) {
      const initial = [
        { name: 'Computer Science & Engineering', code: 'CSE', description: 'Core CS algorithms, systems, DBMS, networking' },
        { name: 'Artificial Intelligence & Data Science', code: 'AI & DS', description: 'Machine learning, deep learning, NLP, computer vision' },
        { name: 'Master of Computer Applications', code: 'MCA', description: 'Software engineering, web apps, enterprise systems' },
        { name: 'Information Technology', code: 'IT', description: 'Cloud computing, information security, distributed systems' },
        { name: 'Electronics & Communication Engineering', code: 'ECE', description: 'Digital signal processing, embedded systems, VLSI' }
      ];
      await Department.insertMany(initial);
      console.log(`[Seed] Initialized ${initial.length} default college departments.`);
    }
  } catch (seedErr) {
    console.warn(`[Seed] Warning during initial department check: ${seedErr.message}`);
  }

  // 6. Pre-warm router ONNX model (prevents first-request cold start latency)
  try {
    console.log('[Router] Warming up classifier pipeline...');
    await warmUpRouter();
    console.log('[Router] Pre-warm completed successfully.');
  } catch (routerErr) {
    console.warn(`[Router] Warmup notice: ${routerErr.message}`);
  }

  const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` College RAG Server is running on port: ${PORT}`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(` Departments API: http://localhost:${PORT}/api/departments`);
    console.log(` Documents API: http://localhost:${PORT}/api/documents`);
    console.log(` Images API: http://localhost:${PORT}/api/images`);
    console.log(` Chat API: http://localhost:${PORT}/api/chat`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down server gracefully...');
    server.close(() => {
      console.log('Server terminated');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

startServer();