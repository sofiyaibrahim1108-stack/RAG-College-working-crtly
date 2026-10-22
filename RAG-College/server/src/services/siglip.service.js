const { SIGLIP_BASE_URL } = require('../config/env');

let currentDimension = 1152; // Default for SigLIP2 (google/siglip2-so400m-patch14-384)
let activeBaseUrl = SIGLIP_BASE_URL || 'http://127.0.0.1:8000';
// Learned SigLIP calibration: P(match) = sigmoid(scale * cosine + bias). Populated from the service /health.
let calibration = null;

const CANDIDATE_URLS = Array.from(
  new Set([
    SIGLIP_BASE_URL,
    'http://127.0.0.1:8000',
    'http://127.0.0.1:5001',
    'http://localhost:8000',
    'http://localhost:5001'
  ].filter(Boolean))
);

/**
 * Dynamically discover active SigLIP endpoint across candidate ports (8000 / 5001)
 */
async function getActiveBaseUrl() {
  if (activeBaseUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${activeBaseUrl}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        return activeBaseUrl;
      }
    } catch {
      // Fall through to probe candidates
    }
  }

  for (const url of CANDIDATE_URLS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        activeBaseUrl = url;
        return url;
      }
    } catch {
      // Continue probing next port
    }
  }

  return activeBaseUrl || 'http://127.0.0.1:8000';
}

/**
 * Check if the SigLIP2 Python service is healthy and dynamically update dimension
 */
async function checkHealth() {
  const baseUrl = await getActiveBaseUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${baseUrl}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { status: 'unavailable', error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.embedding_dimension) {
      currentDimension = data.embedding_dimension;
    }
    if (typeof data.logit_scale === 'number' && typeof data.logit_bias === 'number') {
      calibration = { scale: Math.exp(data.logit_scale), bias: data.logit_bias };
    }
    return {
      status: 'healthy',
      model: data.model,
      device: data.device,
      dimension: data.embedding_dimension || currentDimension,
      baseUrl
    };
  } catch (err) {
    return { status: 'unavailable', error: err.message };
  }
}

/**
 * Return current active SigLIP embedding dimension
 */
function getDimension() {
  return currentDimension;
}

/**
 * Return the model's learned calibration ({ scale, bias }) or null if the service did not report it
 */
function getCalibration() {
  return calibration;
}

/**
 * Convert a text-image cosine similarity into SigLIP's own match probability.
 * Probability >= 0.5 is the model's decision boundary (logit >= 0). Returns null if uncalibrated.
 */
function matchProbability(cosine) {
  if (!calibration || typeof cosine !== 'number' || Number.isNaN(cosine)) return null;
  const logit = calibration.scale * cosine + calibration.bias;
  return 1 / (1 + Math.exp(-logit));
}

/**
 * Generate normalized embedding for text using SigLIP2
 */
async function generateTextEmbedding(text) {
  if (!text || !text.trim()) {
    throw new Error('Text cannot be empty for SigLIP embedding');
  }

  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/embed/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim() })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(`SigLIP text embedding failed (${res.status}): ${errData.detail || errData.message}`);
  }

  const data = await res.json();
  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Invalid embedding returned by SigLIP service');
  }

  if (data.dimension) {
    currentDimension = data.dimension;
  }

  return data.embedding;
}

/**
 * Generate normalized embedding for an image using SigLIP2
 * Accepts absolute file path on disk
 */
async function generateImageEmbedding(imagePath) {
  if (!imagePath) {
    throw new Error('imagePath cannot be empty');
  }

  const baseUrl = await getActiveBaseUrl();
  const res = await fetch(`${baseUrl}/embed/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imagePath })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(`SigLIP image embedding failed (${res.status}): ${errData.detail || errData.message}`);
  }

  const data = await res.json();
  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Invalid embedding returned by SigLIP service');
  }

  if (data.dimension) {
    currentDimension = data.dimension;
  }

  return data.embedding;
}

/**
 * Generate normalized embeddings for multiple images in a single batch call
 */
async function generateImageEmbeddingsBatch(imagePaths) {
  if (!imagePaths || !Array.isArray(imagePaths) || imagePaths.length === 0) {
    return [];
  }

  const baseUrl = await getActiveBaseUrl();
  const BATCH_SIZE = 8; // Python CPU threads-kku yetha safe optimal batch size
  const allEmbeddings = [];

  for (let i = 0; i < imagePaths.length; i += BATCH_SIZE) {
    const batch = imagePaths.slice(i, i + BATCH_SIZE);
    
    const res = await fetch(`${baseUrl}/embed-images-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_paths: batch })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(`SigLIP batch embedding failed (${res.status}): ${errData.detail || errData.message}`);
    }

    const data = await res.json();
    if (data.embeddings && Array.isArray(data.embeddings)) {
      allEmbeddings.push(...data.embeddings);
    }
  }

  return allEmbeddings;
}

module.exports = {
  checkHealth,
  generateTextEmbedding,
  generateImageEmbedding,
  generateImageEmbeddingsBatch,
  getDimension,
  getCalibration,
  matchProbability,
  getActiveBaseUrl,
  get SIGLIP_DIMENSION() {
    return currentDimension;
  }
};
