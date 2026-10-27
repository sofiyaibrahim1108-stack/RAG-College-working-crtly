const DocumentChunk = require('../models/DocumentChunk');
const vectorService = require('./vector.service');
const { searchKeywords } = require('./keyword-search.service');

// Configurable RRF constant (default standard 60)
const RRF_K = parseInt(process.env.RAG_RRF_K || '60', 10);

/**
 * Apply Reciprocal Rank Fusion (RRF) on dense vector and keyword search candidates
 */
function applyReciprocalRankFusion(denseCandidates = [], keywordCandidates = [], rrfK = RRF_K) {
  const fusionMap = new Map();

  // 1. Process dense vector candidates
  denseCandidates.forEach((cand, idx) => {
    const chunkId = cand.chunkId ? cand.chunkId.toString() : '';
    if (!chunkId) return;

    const denseRank = idx + 1;
    const denseContribution = 1 / (rrfK + denseRank);

    fusionMap.set(chunkId, {
      chunkId,
      documentId: cand.documentId ? cand.documentId.toString() : '',
      rrfScore: denseContribution,
      denseRank,
      keywordRank: null,
      denseScore: cand.score || null,
      keywordScore: null,
      fusionSources: ['dense'],
      metadata: cand.metadata || {}
    });
  });

  // 2. Process keyword candidates
  keywordCandidates.forEach((cand, idx) => {
    const chunkId = cand.chunkId ? cand.chunkId.toString() : '';
    if (!chunkId) return;

    const keywordRank = idx + 1;
    const keywordContribution = 1 / (rrfK + keywordRank);

    if (fusionMap.has(chunkId)) {
      const existing = fusionMap.get(chunkId);
      existing.rrfScore += keywordContribution;
      existing.keywordRank = keywordRank;
      existing.keywordScore = cand.score || null;
      existing.fusionSources.push('keyword');
    } else {
      fusionMap.set(chunkId, {
        chunkId,
        documentId: cand.documentId ? cand.documentId.toString() : '',
        rrfScore: keywordContribution,
        denseRank: null,
        keywordRank,
        denseScore: null,
        keywordScore: cand.score || null,
        fusionSources: ['keyword'],
        metadata: cand.metadata || {}
      });
    }
  });

  // 3. Sort merged unique candidates by RRF score descending
  const sorted = Array.from(fusionMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  return sorted;
}

/**
 * Execute Hybrid Retrieval: Dense ANN Search + Keyword Search + Reciprocal Rank Fusion
 */
async function retrieveHybridChunks({
  question,
  queryEmbedding,
  topK = 5,
  candidateLimit = null,
  departmentIds = null,
  documentId = null
}) {
  const tTotalStart = Date.now();

  const defaultPool = 60;
  const poolLimit = candidateLimit || defaultPool;
  const candidatePoolSize = Math.min(Math.max(poolLimit, 40), 100);

  let denseCandidates = [];
  let keywordCandidates = [];
  let vectorRetrievalMs = 0;
  let keywordRetrievalMs = 0;

  // NOTE: Pre-filtering by departmentId at vector/keyword layer wipes out isPublic files!
  // We pass null for departmentIds to retrieve broader candidates, then enforce strict
  // Level 2 Security (Selected Dept + Public Files) in Step 5.
  
  // 1. Dense Semantic Vector Search
  const tVecStart = Date.now();
  try {
    if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
      denseCandidates = await vectorService.search(
        queryEmbedding,
        candidatePoolSize,
        null, // Pass null so public files are never excluded early
        documentId
      );
    }
  } catch (vecErr) {
    console.warn('[Hybrid Retrieval] Dense vector search failed, continuing with keyword search:', vecErr.message);
    denseCandidates = [];
  }
  vectorRetrievalMs = Date.now() - tVecStart;

  // 2. Keyword Search
  const tKwStart = Date.now();
  try {
    keywordCandidates = await searchKeywords(question, {
      departmentIds: null, // Pass null so public circulars match keyword terms
      documentId,
      limit: candidatePoolSize
    });
  } catch (kwErr) {
    console.warn('[Hybrid Retrieval] Keyword search failed, continuing with vector candidates:', kwErr.message);
    keywordCandidates = [];
  }
  keywordRetrievalMs = Date.now() - tKwStart;

  // 3. Reciprocal Rank Fusion (RRF)
  const tFusionStart = Date.now();
  const fusedList = applyReciprocalRankFusion(denseCandidates, keywordCandidates, RRF_K);

  // 4. Fetch full MongoDB chunk records
  const candidateChunkIds = fusedList.map((f) => f.chunkId).filter(Boolean);
  let chunksFromDb = [];

  if (candidateChunkIds.length > 0) {
    chunksFromDb = await DocumentChunk.find({ _id: { $in: candidateChunkIds } })
      .populate('documentId', 'originalFilename source isPublic departmentIds driveFileId driveMetadata')
      .lean();
  }

  // 5. Enforce department isolation & Public file access
  let targetDeptSet = null;
  if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
    targetDeptSet = new Set(departmentIds.map((d) => (d && d._id ? d._id.toString() : d.toString())));
  }

  console.log('[DEBUG ISOLATION FILTER] targetDeptSet:', targetDeptSet ? Array.from(targetDeptSet) : 'ALL/NONE');

  const finalChunks = [];
  for (const item of fusedList) {
    const chunkDoc = chunksFromDb.find((c) => c._id.toString() === item.chunkId);
    if (!chunkDoc) continue;

    if (targetDeptSet) {
      const parentDoc = chunkDoc.documentId || {};
      const isPublic = Boolean(chunkDoc.isPublic || parentDoc.isPublic);

      // Public documents remain accessible across all department views
      if (!isPublic) {
        const rawDepts = [
          ...(chunkDoc.departmentIds || []),
          ...(parentDoc.departmentIds || [])
        ];
        const chunkDepts = rawDepts.map((d) => (d._id || d).toString());
        const hasDeptAccess = chunkDepts.some((d) => targetDeptSet.has(d));

        if (!hasDeptAccess) {
          // Exclude document from other departments
          continue;
        }
      }
    }

    finalChunks.push({
      ...chunkDoc,
      score: item.rrfScore,
      rrfScore: item.rrfScore,
      denseRank: item.denseRank,
      keywordRank: item.keywordRank,
      denseScore: item.denseScore,
      keywordScore: item.keywordScore,
      fusionSources: item.fusionSources
    });

    if (finalChunks.length >= candidatePoolSize) break;
  }

  const hybridFusionMs = Date.now() - tFusionStart;
  const textRetrievalMs = Date.now() - tTotalStart;

  return {
    chunks: finalChunks,
    timings: {
      vectorRetrievalMs,
      keywordRetrievalMs,
      hybridFusionMs,
      textRetrievalMs
    }
  };
}

module.exports = {
  retrieveHybridChunks,
  applyReciprocalRankFusion,
  RRF_K
};