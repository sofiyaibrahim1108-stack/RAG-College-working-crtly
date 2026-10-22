const Document = require('../models/Document');
const Department = require('../models/Department');
const DocumentChunk = require('../models/DocumentChunk');
const Image = require('../models/Image');
const { parseDocument } = require('./parser.service');
const { chunkDocument } = require('./chunker.service');
const { generateEmbeddingsBatch } = require('./embedding.service');
const vectorService = require('./vector.service');
const imageVectorService = require('./image-vector.service');
const { extractDocumentImages, removeExtractedImages } = require('./image-extractor.service');
const siglipService = require('./siglip.service');

/**
 * Small helper to log how long each ingestion step takes
 */
function createTimer(label) {
  const t0 = Date.now();
  return () => console.log(`[Processor][Timing] ${label}: ${Date.now() - t0}ms`);
}

/**
 * Controlled concurrency document processor
 * Parses text, extracts metadata & embedded images, generates embeddings,
 * stores chunks & images in MongoDB, and indexes them in local vector stores.
 */
async function processDocument(docId) {
  const doc = await Document.findById(docId);
  if (!doc) return;

  try {
    // 1. Mark as processing
    doc.status = 'processing';
    doc.processingError = null;
    await doc.save();

    console.log(`[Processor] Processing document: "${doc.originalFilename}" (${doc._id})`);

    // 2. Clean previous chunks, text vectors, images, image files, and image vectors
    await DocumentChunk.deleteMany({ documentId: doc._id });
    await vectorService.removeDocumentChunks(doc._id);

    await Image.deleteMany({ documentId: doc._id });
    await imageVectorService.removeDocumentImages(doc._id);
    removeExtractedImages(doc._id);

    // 3. Parse text and extract text metadata
    let done = createTimer('parse');
    const parsedData = await parseDocument(doc.storagePath, doc.originalFilename);
    done();

    // 4. Chunk text preserving page/slide/sheet metadata
    done = createTimer('chunk');
    const rawChunks = chunkDocument(parsedData, doc.originalFilename);
    done();
    console.log(`[Processor] Generated ${rawChunks.length} chunks for "${doc.originalFilename}"`);

    let createdChunks = [];
    if (rawChunks.length > 0) {
      // 5. Generate text embeddings for all chunks in batch (uses service default batch size)
      done = createTimer('text embeddings');
      const chunkTexts = rawChunks.map((c) => c.content);
      const embeddings = await generateEmbeddingsBatch(chunkTexts);
      done();

      // 6. Create DocumentChunk records in MongoDB
      done = createTimer('mongo insert + vector index');
      const chunkDocs = rawChunks.map((chunk, idx) => ({
        documentId: doc._id,
        departmentIds: doc.departmentIds,
        chunkIndex: idx,
        content: chunk.content,
        embedding: embeddings[idx],
        metadata: {
          sourceFilename: doc.originalFilename,
          pageNumber: chunk.metadata?.pageNumber || null,
          slideNumber: chunk.metadata?.slideNumber || null,
          sheetName: chunk.metadata?.sheetName || null,
          rowNumber: chunk.metadata?.rowNumber || null,
          section: chunk.metadata?.section || null
        }
      }));

      createdChunks = await DocumentChunk.insertMany(chunkDocs);

      // 7. Add chunks to local text vector index
      await vectorService.addChunks(createdChunks);
      done();
    }

    // 8. Phase 4: Extract embedded images & diagrams
    let createdImages = [];
    try {
      done = createTimer('image extraction');
      const extractedImages = await extractDocumentImages(doc.storagePath, doc.originalFilename, doc._id);
      done();

      if (extractedImages.length > 0) {
        console.log(`[Processor] Extracted ${extractedImages.length} images from "${doc.originalFilename}". Embedding via SigLIP...`);

        // Check SigLIP service availability
        const siglipHealth = await siglipService.checkHealth();
        const isSiglipReady = siglipHealth.status === 'healthy';

        if (!isSiglipReady) {
          console.warn('[Processor] SigLIP service unavailable; storing images without embeddings.');
        }

        // Generate SigLIP embeddings in a single batch pass
        done = createTimer('SigLIP image embeddings');
        const imageDocsToInsert = [];

        let allEmbeddings = [];
        if (isSiglipReady) {
          try {
            const diskPaths = extractedImages.map((img) => img.filePath || img.imagePath);
            if (typeof siglipService.generateImageEmbeddingsBatch === 'function') {
              allEmbeddings = await siglipService.generateImageEmbeddingsBatch(diskPaths);
            } else {
              // Fallback just in case batch function miss aanaal
              for (const p of diskPaths) {
                const single = await siglipService.generateImageEmbedding(p);
                allEmbeddings.push(single);
              }
            }
          } catch (embedErr) {
            console.warn('[Processor] Batch image embedding failed:', embedErr.message);
          }
        }

        for (let idx = 0; idx < extractedImages.length; idx++) {
          const img = extractedImages[idx];
          const embedding = allEmbeddings[idx] || [];
          const embeddingStatus = embedding.length > 0 ? 'completed' : 'failed';

          imageDocsToInsert.push({
            documentId: doc._id,
            departmentIds: doc.departmentIds,
            imagePath: img.imagePath,
            filePath: img.filePath || img.imagePath,
            originalFilename: img.originalFilename,
            imageFilename: img.imageFilename,
            mimeType: img.mimeType || 'image/png',
            pageNumber: img.pageNumber,
            slideNumber: img.slideNumber,
            sheetName: img.sheetName,
            width: img.width,
            height: img.height,
            caption: img.caption,
            surroundingText: img.surroundingText,
            embeddingStatus,
            processingStatus: 'completed',
            siglipEmbedding: embedding
          });
        }
        done();

        if (imageDocsToInsert.length > 0) {
          createdImages = await Image.insertMany(imageDocsToInsert);

          // Index embedded images into local Image Vector Store
          const imagesToIndex = createdImages.filter(
            (img) => img.siglipEmbedding && Array.isArray(img.siglipEmbedding) && img.siglipEmbedding.length > 0
          );

          if (imagesToIndex.length > 0) {
            await imageVectorService.addImages(imagesToIndex);
            console.log(`[Image Vector Index] Added ${imagesToIndex.length} image vectors for "${doc.originalFilename}".`);
          }
        }
      }
    } catch (imageErr) {
      console.warn(`[Processor] Image processing encountered an error for "${doc.originalFilename}":`, imageErr.message);
    }

    // 9. Update Document record with status and metadata
    doc.status = 'completed';
    doc.totalChunks = createdChunks.length;
    doc.metadata = {
      pageCount: parsedData.metadata.pageCount || 0,
      slideCount: parsedData.metadata.slideCount || 0,
      sheetNames: parsedData.metadata.sheetNames || [],
      rowCount: parsedData.metadata.rowCount || 0,
      imageCount: createdImages.length,
      author: null
    };
    await doc.save();

    // 10. Update department document counts
    if (doc.departmentIds && doc.departmentIds.length > 0) {
      for (const deptId of doc.departmentIds) {
        const count = await Document.countDocuments({ departmentIds: deptId });
        await Department.findByIdAndUpdate(deptId, { documentCount: count });
      }
    }

    console.log(
      `[Processor] Successfully indexed "${doc.originalFilename}": ${createdChunks.length} chunks and ${createdImages.length} images indexed.`
    );
    return doc;
  } catch (error) {
    console.error(`[Processor] Failed to process "${doc.originalFilename}":`, error.message);

    try {
      await DocumentChunk.deleteMany({ documentId: doc._id });
      await vectorService.removeDocumentChunks(doc._id);
      await Image.deleteMany({ documentId: doc._id });
      await imageVectorService.removeDocumentImages(doc._id);
      removeExtractedImages(doc._id);
    } catch (cleanupErr) {
      console.warn(`[Processor] Cleanup after failure failed for "${doc.originalFilename}":`, cleanupErr.message);
    }

    doc.status = 'failed';
    doc.processingError = error.message || 'Document processing failed';
    doc.totalChunks = 0;
    await doc.save();
    return doc;
  }
}

async function processDocumentsBatch(docIds, concurrency = 2) {
  const results = [];
  const queue = [...docIds];

  const worker = async () => {
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (nextId) {
        const res = await processDocument(nextId);
        results.push(res);
      }
    }
  };

  const pool = [];
  const activeWorkers = Math.min(concurrency, queue.length);
  for (let i = 0; i < activeWorkers; i++) {
    pool.push(worker());
  }

  await Promise.all(pool);
  return results;
}

module.exports = {
  processDocument,
  processDocumentsBatch
};