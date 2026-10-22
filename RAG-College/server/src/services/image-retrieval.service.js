const fs = require('fs');
const path = require('path');
const Image = require('../models/Image');
const Document = require('../models/Document');
const siglipService = require('./siglip.service');
const imageVectorService = require('./image-vector.service');

// ---------- CONFIG ----------
const int = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
};
const float = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};
const list = (name, fallback) =>
  (process.env[name] || fallback).split(',').map((s) => s.trim()).filter(Boolean);

const IMAGE_CONFIG = {
  defaultLimit: int('RAG_IMAGE_TOP_K', 3),
  defaultMinScore: float('RAG_IMAGE_MIN_SCORE', 0.15),
  candidateMultiplier: int('RAG_IMAGE_CANDIDATE_MULTIPLIER', 4),
  fallbackMinTermLength: int('RAG_IMAGE_FALLBACK_MIN_TERM_LENGTH', 4),
  fallbackMinScore: float('RAG_IMAGE_FALLBACK_MIN_SCORE', 0.05),
  logTopScores: int('RAG_IMAGE_LOG_TOP_SCORES', 5),
  exactPageBoost: float('RAG_IMAGE_PAGE_MATCH_BOOST', 0.15),
  adjacentPageBoost: float('RAG_IMAGE_ADJACENT_PAGE_BOOST', 0.08),
  docNameMinCoverage: float('RAG_DOC_NAME_MIN_COVERAGE', 0.6),
  docNameMinTokenLength: int('RAG_DOC_NAME_MIN_TOKEN_LENGTH', 2),
  docNameFields: list('RAG_DOC_NAME_FIELDS', 'originalFilename,filename,originalName,title,name'),
  docIndexTtlMs: int('RAG_DOC_INDEX_TTL_MS', 60000)
};
// ---------- END CONFIG ----------

const idStr = (val) => (val?._id || val)?.toString();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/* ------------------------------------------------------------------ */
/* Document-name scoping                                              */
/* ------------------------------------------------------------------ */

const tokenize = (text) =>
  String(text || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= IMAGE_CONFIG.docNameMinTokenLength);

let docIndexCache = { at: 0, docs: [] };

async function getDocumentIndex() {
  const now = Date.now();
  if (docIndexCache.docs.length > 0 && now - docIndexCache.at < IMAGE_CONFIG.docIndexTtlMs) {
    return docIndexCache.docs;
  }
  try {
    const raw = await Document.find({}).select(IMAGE_CONFIG.docNameFields.join(' ')).lean();
    const docs = raw
      .map((d) => ({
        id: d._id.toString(),
        nameTokens: IMAGE_CONFIG.docNameFields
          .map((field) => tokenize(d[field]))
          .filter((tokens) => tokens.length > 0)
      }))
      .filter((d) => d.nameTokens.length > 0);
    docIndexCache = { at: now, docs };
    return docs;
  } catch (err) {
    console.warn('[ImageRetrieval] Document index unavailable:', err.message);
    return docIndexCache.docs;
  }
}

async function resolveNamedDocuments(question) {
  const questionTokens = new Set(tokenize(question));
  if (questionTokens.size === 0) return [];

  const docs = await getDocumentIndex();
  const matches = [];

  for (const doc of docs) {
    let best = 0;
    let bestTokens = [];
    for (const tokens of doc.nameTokens) {
      const unique = [...new Set(tokens)];
      const hits = unique.filter((t) => questionTokens.has(t));
      const coverage = hits.length / unique.length;
      if (coverage > best) {
        best = coverage;
        bestTokens = hits;
      }
    }
    if (best >= IMAGE_CONFIG.docNameMinCoverage) {
      matches.push({ id: doc.id, coverage: best, matchedTokens: bestTokens });
    }
  }

  return matches;
}

const resolveNamedDocumentIds = async (question) =>
  (await resolveNamedDocuments(question)).map((m) => m.id);

/**
 * Retrieve the most relevant images & vector diagrams for a user question.
 */
async function retrieveRelevantImages(
  question,
  limit = IMAGE_CONFIG.defaultLimit,
  departmentIds = null,
  documentId = null,
  minScore = IMAGE_CONFIG.defaultMinScore,
  options = {}
) {
  if (!question || typeof question !== 'string') {
    return { images: [], count: 0 };
  }

  if (options.isVisualQuery === false || options.visualMode === 'text_only') {
    return { images: [], count: 0 };
  }

  const effectiveMinScore = isNum(minScore) ? minScore : IMAGE_CONFIG.defaultMinScore;

  try {
    // 0. Scope Resolution: Question Explicit Name OR Text Retrieval Context Fallback
    let scopedDocumentId = documentId;
    let namedMatches = [];

    if (!scopedDocumentId || (Array.isArray(scopedDocumentId) && scopedDocumentId.length === 0)) {
      namedMatches = await resolveNamedDocuments(question);
      if (namedMatches.length > 0) {
        const namedIds = namedMatches.map((m) => m.id);
        scopedDocumentId = namedIds.length === 1 ? namedIds[0] : namedIds;
        console.log(`[ImageRetrieval] Question names document(s), scoping to: ${namedIds.join(', ')}`);
      }
    }

    // FALLBACK SCOPING: If question does not name a doc, infer from top reranked text chunks
    const textChunks = Array.isArray(options.retrievedChunks) ? options.retrievedChunks : [];
    if (!scopedDocumentId && textChunks.length > 0) {
      const topDocId = idStr(textChunks[0].documentId);
      if (topDocId) {
        scopedDocumentId = topDocId;
        console.log(`[ImageRetrieval] Auto-scoping to top text chunk document: ${topDocId}`);
      }
    }

    const namedScope = Boolean(scopedDocumentId);
    const documentNameTokens = new Set(namedMatches.flatMap((m) => m.matchedTokens));
    const searchContextScope = namedMatches.length > 0 ? null : options.contextScope || null;

    // 1. SigLIP text embedding
    let textEmbedding = null;
    try {
      const siglipHealth = await siglipService.checkHealth();
      if (siglipHealth && siglipHealth.status === 'healthy') {
        textEmbedding = await siglipService.generateTextEmbedding(question);
      } else {
        console.warn('[ImageRetrieval] SigLIP service not healthy, using metadata fallback');
      }
    } catch (sigErr) {
      console.warn('[ImageRetrieval] SigLIP service embedding notice:', sigErr.message);
    }

    // 2. Primary retrieval: ANN vector search via Vectra
    let matchedImages = [];
    let retrievalPath = 'none';

    if (textEmbedding && Array.isArray(textEmbedding) && textEmbedding.length > 0) {
      try {
        const candidatePoolSize = Math.max(limit * IMAGE_CONFIG.candidateMultiplier, 30);
        const vectorResults = await imageVectorService.search(
          textEmbedding,
          candidatePoolSize,
          departmentIds,
          scopedDocumentId,
          searchContextScope
        );

        if (Array.isArray(vectorResults) && vectorResults.length > 0) {
          const imageIds = vectorResults.map((r) => r.imageId).filter(Boolean);
          const docs = await Image.find({ _id: { $in: imageIds } }).populate('documentId').lean();

          const docMap = new Map();
          docs.forEach((d) => docMap.set(d._id.toString(), d));

          matchedImages = vectorResults
            .map((r) => {
              const fullDoc = docMap.get(r.imageId.toString());
              if (!fullDoc) return null;
              return { ...fullDoc, similarityScore: r.score, scoreSource: 'vector' };
            })
            .filter(Boolean);
        }
      } catch (vecErr) {
        console.warn('[ImageRetrieval] Vector index search notice:', vecErr.message);
      }

      // Hard Enforce Scoping (Prevents ANN vector index leaks from other docs)
      if (scopedDocumentId && matchedImages.length > 0) {
        const allowed = new Set([].concat(scopedDocumentId).map(String));
        matchedImages = matchedImages.filter((img) => allowed.has(idStr(img.documentId)));
      }

      if (matchedImages.length > 0) retrievalPath = 'vector';
    }

    // 3. Metadata fallback & Document-Scoped Fallback
    if (matchedImages.length === 0) {
      const filter = {};

      if (scopedDocumentId) {
        filter.documentId = Array.isArray(scopedDocumentId) ? { $in: scopedDocumentId } : scopedDocumentId;
      }
      if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
        filter.departmentIds = { $in: departmentIds };
      }

      const rawTerms = [
        ...new Set(
          question
            .toLowerCase()
            .replace(/[^a-z0-9\s]/gi, ' ')
            .split(/\s+/)
            .map((term) => term.trim())
            .filter(
              (term) => term.length >= IMAGE_CONFIG.fallbackMinTermLength && !documentNameTokens.has(term)
            )
        )
      ];

      const poolSize = Math.max(limit * IMAGE_CONFIG.candidateMultiplier, 30);

      // 3A. Try strict keyword match on caption, surroundingText, and originalFilename
      if (rawTerms.length > 0) {
        const dynamicRegex = new RegExp(rawTerms.join('|'), 'i');
        const keywordFilter = {
          ...filter,
          $or: [
            { caption: dynamicRegex },
            { surroundingText: dynamicRegex },
            { originalFilename: dynamicRegex }
          ]
        };

        const found = await Image.find(keywordFilter).populate('documentId').limit(poolSize).lean();

        matchedImages = found
          .map((img) => {
            const haystack = [img.caption, img.surroundingText, img.originalFilename]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            const hits = rawTerms.filter((t) => haystack.includes(t)).length;
            return { ...img, similarityScore: hits / rawTerms.length, scoreSource: 'metadata' };
          })
          .sort((a, b) => b.similarityScore - a.similarityScore);

        if (matchedImages.length > 0) retrievalPath = 'metadata';
      }

      // 3B. Document-Scoped Safety Net:
      // If the document is known (e.g. Eye Disease) but captions lack exact keywords,
      // harvest all images from this document so valid screenshots/diagrams aren't dropped.
      if (matchedImages.length === 0 && scopedDocumentId) {
        const scopedDocs = await Image.find(filter).populate('documentId').limit(poolSize).lean();
        if (scopedDocs.length > 0) {
          matchedImages = scopedDocs.map((img) => ({
            ...img,
            similarityScore: 0.16, // Safe baseline above threshold
            scoreSource: 'scoped_fallback'
          }));
          retrievalPath = 'scoped_fallback';
        }
      }
    }

    // 4. Physical Disk Check: Drop ghost / deleted images that cause 404s
    matchedImages = matchedImages.filter((img) => {
      const checkPath = img.imagePath || img.filePath;
      if (!checkPath) return true;
      const existsDirect = fs.existsSync(checkPath);
      const existsRelative = fs.existsSync(path.resolve(process.cwd(), checkPath));
      return existsDirect || existsRelative;
    });

    // 5. Contextual Alignment (Page Proximity Boosting)
    if (textChunks.length > 0 && matchedImages.length > 0) {
      const docPageWeights = new Map();

      textChunks.forEach((chunk, index) => {
        const docId = idStr(chunk.documentId);
        const pageNum = chunk.metadata?.pageNumber || chunk.pageNumber;
        if (!docId || !pageNum) return;

        if (!docPageWeights.has(docId)) {
          docPageWeights.set(docId, new Map());
        }
        const pagesMap = docPageWeights.get(docId);
        const rankMultiplier = Math.max(0.5, 1 - index * 0.1);
        pagesMap.set(Number(pageNum), rankMultiplier);
      });

      matchedImages = matchedImages.map((img) => {
        const docId = idStr(img.documentId);
        const imgPage = Number(img.pageNumber || img.page);
        let adjustedScore = img.similarityScore;

        if (isNum(adjustedScore) && docId && imgPage && docPageWeights.has(docId)) {
          const pagesMap = docPageWeights.get(docId);
          if (pagesMap.has(imgPage)) {
            adjustedScore += IMAGE_CONFIG.exactPageBoost * pagesMap.get(imgPage);
          } else if (pagesMap.has(imgPage - 1) || pagesMap.has(imgPage + 1)) {
            adjustedScore += IMAGE_CONFIG.adjacentPageBoost;
          }
        }
        return { ...img, similarityScore: adjustedScore };
      });

      matchedImages.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
    }

    // 6. Log & Filter by Threshold
    if (IMAGE_CONFIG.logTopScores > 0 && matchedImages.length > 0) {
      const scores = matchedImages
        .slice(0, IMAGE_CONFIG.logTopScores)
        .map((img) => (isNum(img.similarityScore) ? img.similarityScore.toFixed(3) : 'n/a'));
      console.log(
        `[ImageRetrieval] path=${retrievalPath} raw top scores: [${scores.join(', ')}] minScore=${effectiveMinScore}`
      );
    }

    const finalImages = matchedImages
      .filter((img) => {
        if (!isNum(img.similarityScore)) return true;
        const floor =
          img.scoreSource === 'metadata' || img.scoreSource === 'scoped_fallback'
            ? IMAGE_CONFIG.fallbackMinScore
            : effectiveMinScore;
        return img.similarityScore >= floor;
      })
      .slice(0, limit);

    console.log(
      `[ImageRetrieval] Retrieved ${finalImages.length} images/diagrams (path=${retrievalPath}) for: "${question}"`
    );

    return {
      images: finalImages,
      count: finalImages.length,
      retrievalPath,
      scopedDocumentIds: scopedDocumentId ? [].concat(scopedDocumentId).map(String) : []
    };
  } catch (error) {
    console.error('[ImageRetrieval] Unexpected error during image retrieval:', error.message);
    return { images: [], count: 0 };
  }
}

module.exports = {
  retrieveRelevantImages,
  retrieveImages: retrieveRelevantImages,
  resolveNamedDocumentIds
};