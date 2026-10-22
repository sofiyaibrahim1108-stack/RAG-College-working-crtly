const path = require('path');
const fs = require('fs');
const { LocalIndex } = require('vectra');
const { getDimension } = require('./siglip.service');

const IMAGE_VECTOR_DIR = path.resolve(__dirname, '../../data/vector-index/images');

class ImageVectorService {
  constructor() {
    this.index = null;
    this.initialized = false;
    this.init = this.init.bind(this);
    this.addImage = this.addImage.bind(this);
    this.addImages = this.addImages.bind(this);
    this.search = this.search.bind(this);
    this.hasCandidatesInScope = this.hasCandidatesInScope.bind(this);
    this.removeDocumentImages = this.removeDocumentImages.bind(this);
    this.rebuild = this.rebuild.bind(this);
    this.syncPendingImages = this.syncPendingImages.bind(this);
    this.getStats = this.getStats.bind(this);
  }

  /**
   * Initialize local image vector index from persistent storage
   */
  async init() {
    if (this.initialized && this.index) return this.index;

    if (!fs.existsSync(IMAGE_VECTOR_DIR)) {
      fs.mkdirSync(IMAGE_VECTOR_DIR, { recursive: true });
    }

    this.index = new LocalIndex(IMAGE_VECTOR_DIR);

    const isCreated = await this.index.isIndexCreated();
    if (!isCreated) {
      console.log(`[ImageVectorService] Creating new local image ANN vector index in: ${IMAGE_VECTOR_DIR}`);
      await this.index.createIndex({ version: 1, deleteIfExists: true });
    } else {
      console.log(`[ImageVectorService] Loaded existing local image vector index from: ${IMAGE_VECTOR_DIR}`);
    }

    this.initialized = true;
    return this.index;
  }

  /**
   * Add a single image record with its SigLIP embedding to the index
   */
  async addImage(image) {
    await this.init();
    const expectedDim = getDimension();
    if (!image.siglipEmbedding || !Array.isArray(image.siglipEmbedding) || image.siglipEmbedding.length !== expectedDim) {
      throw new Error(`Image embedding must be of dimension ${expectedDim}`);
    }

    const deptStrings = (image.departmentIds || []).map((d) => (d._id || d).toString());

    await this.index.insertItem({
      vector: image.siglipEmbedding,
      metadata: {
        imageId: (image._id || image.id).toString(),
        documentId: (image.documentId._id || image.documentId).toString(),
        departmentIds: deptStrings,
        imagePath: image.imagePath || image.filePath || '',
        filePath: image.filePath || image.imagePath || '',
        originalFilename: image.originalFilename || '',
        imageFilename: image.imageFilename || '',
        pageNumber: image.pageNumber || null,
        slideNumber: image.slideNumber || null,
        sheetName: image.sheetName || null,
        caption: image.caption || image.surroundingText || '',
        width: image.width || null,
        height: image.height || null
      }
    });
  }

  /**
   * Batch add multiple images to the local index
   */
  async addImages(images) {
    await this.init();
    if (!images || images.length === 0) return;

    await this.index.beginUpdate();
    try {
      const expectedDim = getDimension();
      for (const img of images) {
        if (img.siglipEmbedding && img.siglipEmbedding.length === expectedDim) {
          const deptStrings = (img.departmentIds || []).map((d) => (d._id || d).toString());
          await this.index.insertItem({
            vector: img.siglipEmbedding,
            metadata: {
              imageId: (img._id || img.id).toString(),
              documentId: (img.documentId._id || img.documentId).toString(),
              departmentIds: deptStrings,
              imagePath: img.imagePath || img.filePath || '',
              filePath: img.filePath || img.imagePath || '',
              originalFilename: img.originalFilename || '',
              imageFilename: img.imageFilename || '',
              pageNumber: img.pageNumber || null,
              slideNumber: img.slideNumber || null,
              sheetName: img.sheetName || null,
              caption: img.caption || img.surroundingText || '',
              width: img.width || null,
              height: img.height || null
            }
          });
        }
      }
      await this.index.endUpdate();
      console.log(`[ImageVectorService] Batch indexed ${images.length} images into local image vector store.`);
    } catch (err) {
      await this.index.cancelUpdate();
      throw err;
    }
  }

  /**
   * Helper to verify if candidate image metadata falls within scope
   */
  matchesScope(meta, contextScope) {
    if (!contextScope) return true;
    const docId = meta.documentId;
    const docScope = contextScope[docId];
    if (!docScope) return false;

    if (docScope.hasPageScope || docScope.hasSlideScope) {
      const imgPage = meta.pageNumber != null ? parseInt(meta.pageNumber, 10) : null;
      const imgSlide = meta.slideNumber != null ? parseInt(meta.slideNumber, 10) : null;

      const hasImgPage = imgPage != null && !isNaN(imgPage);
      const hasImgSlide = imgSlide != null && !isNaN(imgSlide);

      if (hasImgPage && docScope.hasPageScope) {
        return docScope.pages.includes(imgPage);
      }
      if (hasImgSlide && docScope.hasSlideScope) {
        return docScope.slides.includes(imgSlide);
      }
      if (hasImgPage && !docScope.hasPageScope && docScope.hasSlideScope) {
        return false;
      }
      if (hasImgSlide && !docScope.hasSlideScope && docScope.hasPageScope) {
        return false;
      }
      return true;
    }

    return true;
  }

  /**
   * Check if candidate images exist within department, document, and scope boundaries
   */
  async hasCandidatesInScope(departmentIds = null, documentId = null, contextScope = null) {
    await this.init();
    const items = await this.index.listItems();
    if (!items || items.length === 0) return false;

    let targetDeptSet = null;
    if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
      targetDeptSet = new Set(departmentIds.map((d) => (d._id || d).toString()));
    }

    let targetDocIdList = null;
    if (documentId) {
      targetDocIdList = Array.isArray(documentId)
        ? documentId.map((id) => (id && id._id ? id._id.toString() : id.toString()))
        : [documentId._id ? documentId._id.toString() : documentId.toString()];
    }

    for (const item of items) {
      const meta = item.metadata || {};

      if (targetDocIdList && !targetDocIdList.includes(meta.documentId)) {
        continue;
      }

      if (targetDeptSet) {
        const itemDepts = meta.departmentIds || [];
        const hasDeptMatch = itemDepts.some((d) => targetDeptSet.has(d));
        if (!hasDeptMatch) continue;
      }

      if (contextScope && !this.matchesScope(meta, contextScope)) {
        continue;
      }

      return true;
    }

    return false;
  }

  /**
   * ANN Image Search
   */
  async search(queryVector, topK = 3, departmentIds = null, documentId = null, contextScope = null) {
    await this.init();

    const expectedDim = getDimension();
    if (!queryVector || queryVector.length !== expectedDim) {
      throw new Error(`Query vector must have dimension ${expectedDim}`);
    }

    const candidatePoolSize = Math.max(20, topK * 4);
    const candidates = await this.index.queryItems(queryVector, '', candidatePoolSize);

    let targetDeptSet = null;
    if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
      targetDeptSet = new Set(departmentIds.map((d) => (d._id || d).toString()));
    }

    let targetDocIdList = null;
    if (documentId) {
      targetDocIdList = Array.isArray(documentId)
        ? documentId.map((id) => (id && id._id ? id._id.toString() : id.toString()))
        : [documentId._id ? documentId._id.toString() : documentId.toString()];
    }

    const filterCandidateList = (matches) => {
      const filtered = [];
      for (const match of matches) {
        const item = match.item;
        const meta = item.metadata || {};

        if (targetDocIdList && !targetDocIdList.includes(meta.documentId)) {
          continue;
        }

        if (targetDeptSet) {
          const itemDepts = meta.departmentIds || [];
          const hasDeptMatch = itemDepts.some((d) => targetDeptSet.has(d));
          if (!hasDeptMatch) {
            continue;
          }
        }

        if (contextScope && !this.matchesScope(meta, contextScope)) {
          continue;
        }

        filtered.push({
          imageId: meta.imageId,
          documentId: meta.documentId,
          score: match.score,
          metadata: meta
        });

        if (filtered.length >= topK) break;
      }
      return filtered;
    };

    let filtered = filterCandidateList(candidates);

    if (filtered.length < topK && (targetDocIdList || targetDeptSet || contextScope)) {
      const items = await this.index.listItems();
      const retryPoolSize = Math.min(items.length, Math.max(100, topK * 10));
      if (retryPoolSize > candidatePoolSize) {
        const retryCandidates = await this.index.queryItems(queryVector, '', retryPoolSize);
        filtered = filterCandidateList(retryCandidates);
      }
    }

    return filtered;
  }

  /**
   * Remove all image vectors associated with a document
   */
  async removeDocumentImages(documentId) {
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
        console.log(`[ImageVectorService] Removed ${toDelete.length} image vector items for document: ${docIdStr}`);
      } catch (err) {
        await this.index.cancelUpdate();
        throw err;
      }
    }
    return toDelete.length;
  }

  /**
   * Rebuild the entire image index from MongoDB Image records
   */
  async rebuild(ImageModel) {
    await this.init();
    console.log('[ImageVectorService] Rebuilding image vector index from MongoDB...');
    await this.index.createIndex({ version: 1, deleteIfExists: true });

    const allImages = await ImageModel.find({
      siglipEmbedding: { $exists: true,$ne: [] }
    });

    await this.addImages(allImages);
    console.log(`[ImageVectorService] Rebuild complete: ${allImages.length} images indexed.`);
    return allImages.length;
  }

  /**
   * Generate SigLIP embeddings and index pending images
   */
  async syncPendingImages(ImageModel) {
    await this.init();
    const Image = ImageModel || require('../models/Image');
    const { checkHealth, generateImageEmbedding, getDimension } = require('./siglip.service');

    const health = await checkHealth();
    if (health.status !== 'healthy') {
      return 0;
    }

    const expectedDim = getDimension();

    const pendingImages = await Image.find({
      $or: [
        { siglipEmbedding: { $exists: false } },
        { siglipEmbedding: { $size: 0 } },
        { embeddingStatus: 'pending' }
      ]
    });

    if (pendingImages && pendingImages.length > 0) {
      console.log(`[ImageVectorService] Found ${pendingImages.length} pending images. Generating SigLIP embeddings...`);
      const newlyEmbedded = [];
      for (const img of pendingImages) {
        const diskPath = img.filePath || img.imagePath;
        if (diskPath && fs.existsSync(diskPath)) {
          try {
            const vector = await generateImageEmbedding(diskPath);
            img.siglipEmbedding = vector;
            img.embeddingStatus = 'completed';
            await img.save();
            newlyEmbedded.push(img);
          } catch (err) {
            console.warn(`[ImageVectorService] Failed embedding ${img.imageFilename}:`, err.message);
          }
        }
      }
      if (newlyEmbedded.length > 0) {
        await this.addImages(newlyEmbedded);
        console.log(`[ImageVectorService] Successfully indexed ${newlyEmbedded.length} images into ANN store.`);
      }
    }

    const items = await this.index.listItems();
    if (items.length === 0) {
      const allEmbeddedImages = await Image.find({
        siglipEmbedding: { $exists: true,$ne: [] }
      });
      const validImages = allEmbeddedImages.filter(
        (img) => Array.isArray(img.siglipEmbedding) && img.siglipEmbedding.length === expectedDim
      );
      if (validImages.length > 0) {
        console.log(`[ImageVectorService] Hydrating ANN index with ${validImages.length} images from database...`);
        await this.addImages(validImages);
      }
    }

    const currentStats = await this.getStats();
    return currentStats.vectorCount;
  }

  /**
   * Get image vector index statistics
   */
  async getStats() {
    await this.init();
    const items = await this.index.listItems();
    return {
      vectorCount: items.length,
      dimension: getDimension(),
      path: IMAGE_VECTOR_DIR
    };
  }
}

const imageVectorService = new ImageVectorService();

module.exports = imageVectorService;
module.exports.default = imageVectorService;
module.exports.imageVectorService = imageVectorService;