const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { OLLAMA_BASE_URL, EMBEDDING_MODEL, LLM_MODEL } = require('../config/env');
const vectorService = require('../services/vector.service');
const imageVectorService = require('../services/image-vector.service');
const siglipService = require('../services/siglip.service');

router.get('/', async (req, res) => {
  const mongoState = mongoose.connection.readyState;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const isDbHealthy = mongoState === 1;

  let collections = [];
  try {
    if (isDbHealthy && mongoose.connection.db) {
      const collList = await mongoose.connection.db.listCollections().toArray();
      collections = collList.map((c) => c.name);
    }
  } catch (err) {
    console.error('Error fetching collections in health check:', err.message);
  }

  // Check Ollama status
  let ollamaStatus = 'connected';
  try {
    const oRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(1200) });
    ollamaStatus = oRes.ok ? 'connected' : 'degraded';
  } catch {
    ollamaStatus = 'unavailable';
  }

  // Check SigLIP status
  const siglipCheck = await siglipService.checkHealth();
  const siglipStatus = siglipCheck.status === 'healthy' ? 'connected' : 'unavailable';

  // Check Text and Image vector index status
  let textVectorIndexStatus = 'ready';
  let imageVectorIndexStatus = 'ready';
  let textStats = null;
  let imageStats = null;

  try {
    textStats = await vectorService.getStats();
  } catch {
    textVectorIndexStatus = 'unavailable';
  }

  try {
    imageStats = await imageVectorService.getStats();
  } catch {
    imageVectorIndexStatus = 'unavailable';
  }

  return res.status(isDbHealthy ? 200 : 503).json({
    status: isDbHealthy ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      mongodb: stateMap[mongoState] || 'unknown',
      ollama: ollamaStatus,
      siglip: siglipStatus,
      textVectorIndex: textVectorIndexStatus,
      imageVectorIndex: imageVectorIndexStatus
    },
    database: {
      status: stateMap[mongoState] || 'unknown',
      name: mongoose.connection.name || 'rag_production_college',
      host: mongoose.connection.host || '127.0.0.1',
      port: mongoose.connection.port || 27017,
      collections
    },
    configuredModels: {
      ollamaBaseUrl: OLLAMA_BASE_URL,
      embeddingModel: EMBEDDING_MODEL,
      llmModel: LLM_MODEL,
      siglipModel: siglipCheck.model || 'google/siglip-base-patch16-224',
      siglipDevice: siglipCheck.device || 'cpu'
    },
    vectorIndexes: {
      text: textStats,
      images: imageStats
    }
  });
});

module.exports = router;
