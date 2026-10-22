const path = require('path');
const { pipeline, env } = require('@xenova/transformers');
const {
  ONNX_EMBEDDING_MODEL,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_CACHE_DIR
} = require('../config/env');

// Configure cache directory dynamically from config or fallback to local directory
env.cacheDir = EMBEDDING_CACHE_DIR || path.join(__dirname, '..', '.cache');

// Target model identifier and runtime configuration
const MODEL_ID = ONNX_EMBEDDING_MODEL || 'Xenova/bge-large-en-v1.5';
const BATCH_SIZE = Number(EMBEDDING_BATCH_SIZE) || 36;
const DEFAULT_DIMENSION = 1024;

let extractorPromise = null;
let detectedDimension = null;

/**
 * Singleton loader for feature-extraction pipeline.
 * Shares a single load promise across concurrent execution calls.
 */
function getExtractor() {
  if (!extractorPromise) {
    console.log(`[ONNX Embedding] Initializing pipeline for model: "${MODEL_ID}" (quantized: true)...`);
    extractorPromise = pipeline('feature-extraction', MODEL_ID, { quantized: true })
      .then((pipe) => {
        console.log(`[ONNX Embedding] Model "${MODEL_ID}" loaded successfully into memory.`);
        return pipe;
      })
      .catch((err) => {
        extractorPromise = null;
        console.error(`[ONNX Embedding] Failed to load model "${MODEL_ID}":`, err.message);
        throw err;
      });
  }
  return extractorPromise;
}

/**
 * Normalizes input text strings
 */
function cleanText(text) {
  return text && typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Tracks and caches detected vector dimension
 */
function recordDimension(vector) {
  if (!detectedDimension && Array.isArray(vector) && vector.length > 0) {
    detectedDimension = vector.length;
    console.log(`[ONNX Embedding] Vector dimension verified: ${detectedDimension}`);
  }
}

/**
 * Returns dynamic vector dimension, probing model if uninitialized
 */
async function getEmbeddingDimension() {
  if (detectedDimension) return detectedDimension;
  await generateEmbedding('dimension detection probe');
  return detectedDimension || DEFAULT_DIMENSION;
}

/**
 * Generates an embedding vector for a single text string
 */
async function generateEmbedding(text) {
  const clean = cleanText(text);
  if (!clean) {
    throw new Error('Text must be a non-empty string');
  }

  const pipe = await getExtractor();
  const output = await pipe(clean, { pooling: 'cls', normalize: true });
  const vector = Array.from(output.data);

  recordDimension(vector);
  return vector;
}

/**
 * Generates embeddings in controlled batches via ONNX runtime
 */
async function generateEmbeddingsBatch(texts, batchSize = BATCH_SIZE) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const startedAt = Date.now();
  const pipe = await getExtractor();
  const results = new Array(texts.length).fill(null);
  const activeBatchSize = Number(batchSize) > 0 ? Number(batchSize) : BATCH_SIZE;

  for (let i = 0; i < texts.length; i += activeBatchSize) {
    const batchStart = Date.now();
    const validIndices = [];
    const validTexts = [];

    texts.slice(i, i + activeBatchSize).forEach((rawText, relIdx) => {
      const clean = cleanText(rawText);
      if (clean) {
        validTexts.push(clean);
        validIndices.push(i + relIdx);
      }
    });

    if (validTexts.length === 0) continue;

    try {
      const output = await pipe(validTexts, { pooling: 'cls', normalize: true });
      const vectors = output.tolist();

      vectors.forEach((vec, relIdx) => {
        results[validIndices[relIdx]] = vec;
      });

      if (vectors.length > 0) {
        recordDimension(vectors[0]);
      }

      console.log(
        `[ONNX Embedding] Batch ${i}-${i + validTexts.length} completed in ${Date.now() - batchStart}ms`
      );
    } catch (err) {
      console.error(
        `[ONNX Embedding] Batch failed at range [${i}, ${i + activeBatchSize}]:`,
        err.message
      );
    }
  }

  const failedCount = results.filter((r, idx) => r === null && cleanText(texts[idx]).length > 0).length;
  if (failedCount > 0) {
    console.warn(`[ONNX Embedding] Warning: ${failedCount} non-empty chunk(s) produced null vectors`);
  }

  console.log(`[ONNX Embedding] Processed ${texts.length} chunks in ${Date.now() - startedAt}ms`);
  return results;
}

module.exports = {
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingDimension,
  EMBEDDING_DIMENSION: DEFAULT_DIMENSION
};