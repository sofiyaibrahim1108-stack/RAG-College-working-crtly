const { AutoTokenizer, AutoModelForSequenceClassification } = require('@xenova/transformers');

const MODEL_ID = process.env.RERANKER_MODEL || 'Xenova/bge-reranker-base';
const DEFAULT_POOL_SIZE = 20;
const DEFAULT_MAX_LENGTH = 192;
const DEFAULT_BATCH_SIZE = 4;
const MAX_CHUNKS_PER_DOC = 3;
const RELEVANCE_THRESHOLD = 0.01; // Relaxed threshold so relevant chunks are not accidentally discarded

let loadPromise = null;

function loadReranker() {
  if (!loadPromise) {
    loadPromise = Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { quantized: true })
    ])
      .then(([tokenizer, model]) => ({ tokenizer, model }))
      .catch((err) => {
        loadPromise = null;
        throw err;
      });
  }
  return loadPromise;
}

async function warmupReranker() {
  try {
    const { tokenizer, model } = await loadReranker();
    const inputs = await tokenizer(['warmup'], {
      text_pair: ['warmup'],
      padding: true,
      truncation: true,
      max_length: 16
    });
    await model(inputs);
    console.log('[Reranker] Warmup complete');
  } catch (err) {
    console.warn('[Reranker] Warmup failed:', err.message);
  }
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Cross-Encoder Reranker using Transformers.js (ONNX), batched inference
 */
async function rerankChunks(candidates, query, topK = 5, options = {}) {
  const tStart = Date.now();

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { rankedChunks: [], rerankingMs: 0 };
  }

  // Pool size and limits for fast CPU inference
  const poolSize = Math.min(options.poolSize || DEFAULT_POOL_SIZE, 20);
  const maxLength = Math.min(options.maxLength || DEFAULT_MAX_LENGTH, 192);
  const batchSize = Math.min(options.batchSize || DEFAULT_BATCH_SIZE, 4);
  const maxPerDoc = options.maxPerDoc || MAX_CHUNKS_PER_DOC;
  const minScore = options.relevanceThreshold || RELEVANCE_THRESHOLD;

  try {
    const { tokenizer, model } = await loadReranker();

    const items = [];
    for (const chunk of candidates.slice(0, poolSize)) {
      const fileName = chunk.fileName || chunk.file || chunk.documentId?.originalFilename || '';
      const rawContent = chunk.content || chunk.text || '';
      if (!rawContent.trim()) continue;
      const text = fileName ? `Document: ${fileName}\n\n${rawContent}` : rawContent;
      items.push({ chunk, fileName, text });
    }

    if (items.length === 0) {
      return { rankedChunks: candidates.slice(0, topK), rerankingMs: Date.now() - tStart };
    }

    const scoredChunks = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const inputs = await tokenizer(new Array(batch.length).fill(query), {
        text_pair: batch.map((b) => b.text),
        padding: true,
        truncation: true,
        max_length: maxLength
      });

      const output = await model(inputs);
      const logits = output.logits || output;
      const numLabels = logits.dims?.[1] || 1;

      batch.forEach((item, idx) => {
        const rawLogit = Number(logits.data[idx * numLabels]);
        const score = sigmoid(rawLogit);

        scoredChunks.push({
          ...item.chunk,
          file: item.fileName,
          rawLogit: Number(rawLogit.toFixed(3)),
          rerankScore: Number(score.toFixed(4)),
          score: Number(score.toFixed(4))
        });
      });
    }

    // Sort all scored chunks by rerank score descending
    scoredChunks.sort((a, b) => b.rerankScore - a.rerankScore);

    // 1. Filter out completely unrelated chunks using threshold
    const relevantChunks = scoredChunks.filter(
      (chunk) => (chunk.rerankScore || chunk.score) >= minScore
    );

    // 2. Minimum guarantee: retain at least 3 chunks if available to avoid starvation
    let candidatePool = relevantChunks;
    if (candidatePool.length < 3 && scoredChunks.length >= 3) {
      candidatePool = scoredChunks.slice(0, 3);
    } else if (candidatePool.length === 0) {
      candidatePool = scoredChunks;
    }

    // 3. Diversity guard across documents
    const docCounts = new Map();
    const diverseChunks = [];

    for (const chunk of candidatePool) {
      const docKey = chunk.file || 'unknown';
      const count = docCounts.get(docKey) || 0;
      if (count < maxPerDoc) {
        diverseChunks.push(chunk);
        docCounts.set(docKey, count + 1);
      }
      if (diverseChunks.length >= topK) break;
    }

    const finalTopK = diverseChunks.length > 0 ? diverseChunks : candidatePool.slice(0, topK);

    return {
      rankedChunks: finalTopK.slice(0, topK),
      rerankingMs: Date.now() - tStart
    };
  } catch (err) {
    console.error('[ONNX Reranker ERROR]:', err);
    return {
      rankedChunks: candidates.slice(0, topK),
      rerankingMs: Date.now() - tStart
    };
  }
}

module.exports = {
  rerankChunks,
  warmupReranker
};