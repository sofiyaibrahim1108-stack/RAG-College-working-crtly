const path = require('path');
const fs = require('fs');
const { LocalIndex } = require('vectra');
const { EMBEDDING_DIMENSION } = require('./embedding.service');

const SQL_VECTOR_DIR = path.resolve(__dirname, '../../data/sql-vector-index');

class SqlVectorService {
  constructor() {
    this.index = null;
    this.initialized = false;
    this._writeQueue = Promise.resolve();
  }

  /**
   * Serialize all Vectra index mutations to prevent concurrent beginUpdate() collisions
   */
  _withWriteLock(taskFn) {
    const next = this._writeQueue.then(taskFn, taskFn);
    this._writeQueue = next.catch(() => {});
    return next;
  }

  /**
   * Initialize dedicated local Vectra index for SQL summaries and row embeddings
   */
  async init() {
    if (this.initialized && this.index) return this.index;

    if (!fs.existsSync(SQL_VECTOR_DIR)) {
      fs.mkdirSync(SQL_VECTOR_DIR, { recursive: true });
    }

    this.index = new LocalIndex(SQL_VECTOR_DIR);

    const isCreated = await this.index.isIndexCreated();
    if (!isCreated) {
      console.log(`[SqlVectorService] Creating new isolated SQL vector index in: ${SQL_VECTOR_DIR}`);
      await this.index.createIndex({ version: 1, deleteIfExists: true });
    } else {
      console.log(`[SqlVectorService] Loaded existing SQL vector index from: ${SQL_VECTOR_DIR}`);
    }

    this.initialized = true;
    return this.index;
  }

  /**
   * Batch insert SqlEmbedding documents into the isolated SQL Vectra index
   */
  async addItems(docs) {
    await this.init();
    if (!Array.isArray(docs) || docs.length === 0) return 0;

    return this._withWriteLock(async () => {
      let inserted = 0;
      await this.index.beginUpdate();
      try {
        for (const doc of docs) {
          if (!Array.isArray(doc.embedding) || doc.embedding.length !== EMBEDDING_DIMENSION) {
            continue;
          }

          await this.index.insertItem({
            vector: doc.embedding,
            metadata: {
              embeddingId: (doc._id || doc.id || '').toString(),
              datasetId: Number(doc.datasetId),
              recordType: doc.recordType, // 'sql_dataset_summary' | 'sql_row'
              targetTable: doc.targetTable,
              mysqlRowId: doc.mysqlRowId !== null && doc.mysqlRowId !== undefined
                ? String(doc.mysqlRowId)
                : '',
              fileName: doc.metadata?.fileName || '',
              sheetName: doc.metadata?.sheetName || ''
            }
          });
          inserted += 1;
        }
        await this.index.endUpdate();
        return inserted;
      } catch (err) {
        await this.index.cancelUpdate();
        throw err;
      }
    });
  }

  /**
   * Semantic search across dataset summaries to discover matching MySQL tables
   */
  async searchSummaries(queryVector, topK = 5, minScore = 0.45) {
    await this.init();
    if (!Array.isArray(queryVector) || queryVector.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Query vector must have dimension ${EMBEDDING_DIMENSION}`);
    }

    const poolSize = Math.max(50, topK * 15);
    const candidates = await this.index.queryItems(queryVector, '', poolSize);

    const bestByTable = new Map();
    for (const match of candidates) {
      const meta = match.item?.metadata || {};
      if (meta.recordType !== 'sql_dataset_summary') continue;
      if (match.score < minScore) continue;
      if (!meta.targetTable) continue;

      const existing = bestByTable.get(meta.targetTable);
      if (!existing || match.score > existing.score) {
        bestByTable.set(meta.targetTable, {
          embeddingId: meta.embeddingId,
          datasetId: meta.datasetId,
          targetTable: meta.targetTable,
          score: match.score,
          metadata: meta
        });
      }
    }

    return Array.from(bestByTable.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Semantic search across embedded SQL rows (optionally scoped to a target table)
   */
  async searchRows(queryVector, targetTable = null, topK = 5, minScore = 0.40) {
    await this.init();
    if (!Array.isArray(queryVector) || queryVector.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Query vector must have dimension ${EMBEDDING_DIMENSION}`);
    }

    const poolSize = Math.max(60, topK * 20);
    const candidates = await this.index.queryItems(queryVector, '', poolSize);

    const results = [];
    for (const match of candidates) {
      const meta = match.item?.metadata || {};
      if (meta.recordType !== 'sql_row') continue;
      if (match.score < minScore) continue;
      if (targetTable && meta.targetTable !== targetTable) continue;

      results.push({
        embeddingId: meta.embeddingId,
        datasetId: meta.datasetId,
        targetTable: meta.targetTable,
        mysqlRowId: meta.mysqlRowId || null,
        score: match.score,
        metadata: meta
      });

      if (results.length >= topK) break;
    }

    return results;
  }

  /**
   * Remove all vectors belonging to a specific datasetId (used on delete or retry)
   */
  async removeDatasetVectors(datasetId) {
    await this.init();
    const targetId = Number(datasetId);

    return this._withWriteLock(async () => {
      const items = await this.index.listItems();
      const toDelete = items.filter((item) => Number(item.metadata?.datasetId) === targetId);

      if (toDelete.length === 0) return 0;

      await this.index.beginUpdate();
      try {
        for (const item of toDelete) {
          await this.index.deleteItem(item.id);
        }
        await this.index.endUpdate();
        console.log(`[SqlVectorService] Removed ${toDelete.length} vector(s) for datasetId=${targetId}`);
        return toDelete.length;
      } catch (err) {
        await this.index.cancelUpdate();
        throw err;
      }
    });
  }

  /**
   * Rebuild data/sql-vector-index directly from MongoDB SqlEmbedding (zero ONNX calls)
   */
  async rebuild(SqlEmbeddingModel) {
    await this.init();

    return this._withWriteLock(async () => {
      console.log('[SqlVectorService] Rebuilding isolated SQL vector index from MongoDB SqlEmbedding...');
      await this.index.createIndex({ version: 1, deleteIfExists: true });

      const cursor = SqlEmbeddingModel.find({
        embedding: { $exists: true, $ne: [] }
      })
        .lean()
        .cursor();

      const batch = [];
      let totalIndexed = 0;

      const flushBatch = async () => {
        if (batch.length === 0) return;
        await this.index.beginUpdate();
        try {
          for (const doc of batch) {
            if (!Array.isArray(doc.embedding) || doc.embedding.length !== EMBEDDING_DIMENSION) {
              continue;
            }
            await this.index.insertItem({
              vector: doc.embedding,
              metadata: {
                embeddingId: String(doc._id),
                datasetId: Number(doc.datasetId),
                recordType: doc.recordType,
                targetTable: doc.targetTable,
                mysqlRowId: doc.mysqlRowId !== null && doc.mysqlRowId !== undefined
                  ? String(doc.mysqlRowId)
                  : '',
                fileName: doc.metadata?.fileName || '',
                sheetName: doc.metadata?.sheetName || ''
              }
            });
            totalIndexed += 1;
          }
          await this.index.endUpdate();
        } catch (err) {
          await this.index.cancelUpdate();
          throw err;
        }
        batch.length = 0;
      };

      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= 200) {
          await flushBatch();
        }
      }
      await flushBatch();

      console.log(`[SqlVectorService] Rebuild complete: ${totalIndexed} SQL vector(s) indexed.`);
      return totalIndexed;
    });
  }

  /**
   * Return index statistics
   */
  async getStats() {
    await this.init();
    const items = await this.index.listItems();
    let summaryCount = 0;
    let rowCount = 0;

    for (const item of items) {
      if (item.metadata?.recordType === 'sql_dataset_summary') summaryCount += 1;
      else if (item.metadata?.recordType === 'sql_row') rowCount += 1;
    }

    return {
      vectorCount: items.length,
      summaryCount,
      rowCount,
      dimension: EMBEDDING_DIMENSION,
      path: SQL_VECTOR_DIR
    };
  }
}

const sqlVectorService = new SqlVectorService();

module.exports = sqlVectorService;