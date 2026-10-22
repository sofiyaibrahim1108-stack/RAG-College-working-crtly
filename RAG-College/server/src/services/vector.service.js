const path = require('path');
const fs = require('fs');
const { LocalIndex } = require('vectra');
const { EMBEDDING_DIMENSION } = require('./embedding.service');
const {
  VECTOR_POOL_MIN_UNFILTERED,
  VECTOR_POOL_MULTIPLIER_UNFILTERED,
  VECTOR_POOL_MIN_FILTERED,
  VECTOR_POOL_MULTIPLIER_FILTERED,
  VECTOR_POOL_RETRY_MIN,
  VECTOR_POOL_RETRY_MULTIPLIER
} = require('../config/env');

const VECTOR_DIR = path.resolve(__dirname, '../../data/vector-index');

class VectorService {
  constructor() {
    this.index = null;
    this.initialized = false;
  }

  /**
   * Initialize local vector index from persistent storage
   */
  async init() {
    if (this.initialized && this.index) return this.index;

    if (!fs.existsSync(VECTOR_DIR)) {
      fs.mkdirSync(VECTOR_DIR, { recursive: true });
    }

    this.index = new LocalIndex(VECTOR_DIR);

    const isCreated = await this.index.isIndexCreated();
    if (!isCreated) {
      console.log(`[VectorService] Creating new local HNSW/ANN vector index in: ${VECTOR_DIR}`);
      await this.index.createIndex({ version: 1, deleteIfExists: true });
    } else {
      console.log(`[VectorService] Loaded existing local vector index from: ${VECTOR_DIR}`);
    }

    this.initialized = true;
    return this.index;
  }

  /**
   * Add a single chunk with its embedding and department/document metadata
   */
  async addChunk(chunk) {
    await this.init();
    if (!chunk.embedding || chunk.embedding.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Embedding must be of dimension ${EMBEDDING_DIMENSION}`);
    }

    const deptStrings = (chunk.departmentIds || []).map((d) => (d._id || d).toString());

    await this.index.insertItem({
      vector: chunk.embedding,
      metadata: {
        chunkId: (chunk._id || chunk.id).toString(),
        documentId: (chunk.documentId._id || chunk.documentId).toString(),
        departmentIds: deptStrings,
        sourceFilename: chunk.metadata?.sourceFilename || '',
        pageNumber: chunk.metadata?.pageNumber || null,
        sheetName: chunk.metadata?.sheetName || null
      }
    });
  }

  /**
   * Batch add chunks to the local vector index
   */
  async addChunks(chunks) {
    await this.init();
    if (!chunks || chunks.length === 0) return;

    await this.index.beginUpdate();
    try {
      for (const chunk of chunks) {
        if (chunk.embedding && chunk.embedding.length === EMBEDDING_DIMENSION) {
          const deptStrings = (chunk.departmentIds || []).map((d) => (d._id || d).toString());
          await this.index.insertItem({
            vector: chunk.embedding,
            metadata: {
              chunkId: (chunk._id || chunk.id).toString(),
              documentId: (chunk.documentId._id || chunk.documentId).toString(),
              departmentIds: deptStrings,
              sourceFilename: chunk.metadata?.sourceFilename || '',
              pageNumber: chunk.metadata?.pageNumber || null,
              sheetName: chunk.metadata?.sheetName || null
            }
          });
        }
      }
      await this.index.endUpdate();
      console.log(`[VectorService] Batch indexed ${chunks.length} chunks into local vector store.`);
    } catch (err) {
      await this.index.cancelUpdate();
      throw err;
    }
  }

  /**
   * Fast ANN Vector Search with pre/post department and document filtering
   * Avoids scanning the complete collection
   */
  async search(queryVector, topK = 5, departmentIds = null, documentId = null) {
    await this.init();

    if (!queryVector || queryVector.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Query vector must have dimension ${EMBEDDING_DIMENSION}`);
    }

    // Apply department and document filtering setup
    let targetDeptSet = null;
    if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
      targetDeptSet = new Set(departmentIds.map((d) => (d._id || d).toString()));
    }

    const isFiltered = Boolean(targetDeptSet);
    const poolMin = isFiltered ? VECTOR_POOL_MIN_FILTERED : VECTOR_POOL_MIN_UNFILTERED;
    const poolMultiplier = isFiltered ? VECTOR_POOL_MULTIPLIER_FILTERED : VECTOR_POOL_MULTIPLIER_UNFILTERED;
    const candidatePoolSize = Math.max(poolMin, topK * poolMultiplier);

    const filterCandidates = (matches) => {
      const results = [];
      for (const match of matches) {
        const item = match.item;
        const meta = item.metadata || {};

        // Document filter if specified
        if (documentId && meta.documentId !== documentId.toString()) {
          continue;
        }

        // Department filter if specified
        if (targetDeptSet) {
          const itemDepts = meta.departmentIds || [];
          const hasDeptMatch = itemDepts.some((d) => targetDeptSet.has(d));
          if (!hasDeptMatch) {
            continue;
          }
        }

        results.push({
          chunkId: meta.chunkId,
          documentId: meta.documentId,
          score: match.score, // Cosine similarity score
          metadata: meta
        });

        if (results.length >= topK) break;
      }
      return results;
    };

    // Initial retrieval with candidate pool
    const candidates = await this.index.queryItems(queryVector, '', candidatePoolSize);
    let filtered = filterCandidates(candidates);

    // If filtered results are fewer than topK and department filtering was requested, retry once with a larger retry pool
    if (filtered.length < topK && isFiltered) {
      const retryPoolSize = Math.max(VECTOR_POOL_RETRY_MIN, topK * VECTOR_POOL_RETRY_MULTIPLIER);
      if (retryPoolSize > candidatePoolSize) {
        const retryCandidates = await this.index.queryItems(queryVector, '', retryPoolSize);
        filtered = filterCandidates(retryCandidates);
      }
    }

    return filtered;
  }

  /**
   * Remove all vectors associated with a deleted or reprocessed document
   */
  async removeDocumentChunks(documentId) {
    await this.init();
    const docIdStr = documentId.toString();

    const items = await this.index.listItems();
    const toDelete = items.filter((item) => item.metadata?.documentId === docIdStr);

    if (toDelete.length > 0) {
      await this.index.beginUpdate();
      try {
        for (const item of toDelete) {
          await this.index.deleteItem(item.id);
        }
        await this.index.endUpdate();
        console.log(`[VectorService] Removed ${toDelete.length} vector items for document: ${docIdStr}`);
      } catch (err) {
        await this.index.cancelUpdate();
        throw err;
      }
    }
  }

  /**
   * Rebuild the entire index from MongoDB DocumentChunks
   */
  async rebuild(DocumentChunkModel) {
    await this.init();
    console.log('[VectorService] Rebuilding vector index from MongoDB DocumentChunks...');
    await this.index.createIndex({ version: 1, deleteIfExists: true });

    const allChunks = await DocumentChunkModel.find({
      embedding: { $exists: true, $ne: [] }
    });

    await this.addChunks(allChunks);
    console.log(`[VectorService] Rebuild complete: ${allChunks.length} chunks indexed.`);
    return allChunks.length;
  }

  /**
   * Get vector index statistics
   */
  async getStats() {
    await this.init();
    const items = await this.index.listItems();
    return {
      vectorCount: items.length,
      dimension: EMBEDDING_DIMENSION,
      path: VECTOR_DIR
    };
  }
}

// Singleton instance
const vectorService = new VectorService();

module.exports = vectorService;
