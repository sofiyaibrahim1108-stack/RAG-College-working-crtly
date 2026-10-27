const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Document = require('../models/Document');
const Department = require('../models/Department');
const DocumentChunk = require('../models/DocumentChunk');
const Image = require('../models/Image');
const vectorService = require('../services/vector.service');
const imageVectorService = require('../services/image-vector.service');
const { removeExtractedImages } = require('../services/image-extractor.service');
const { processDocumentsBatch } = require('../services/processor.service');
const { logAction } = require('../services/audit.service');

// Helper to compute SHA-256 hash from file on disk
function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

// POST /api/documents/upload - Multi-file upload with duplicate skipping, versioning & audit logging
exports.uploadDocuments = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Parse isPublic flag from body (string 'true' or boolean true)
    const isPublic = req.body.isPublic === true || req.body.isPublic === 'true';

    // Parse departmentIds (JSON array string, comma-separated, or single ID)
    let departmentIds = req.body.departmentIds;
    if (typeof departmentIds === 'string') {
      try {
        departmentIds = JSON.parse(departmentIds);
      } catch {
        departmentIds = departmentIds.split(',').map((id) => id.trim()).filter(Boolean);
      }
    }

    // If document is private, at least one department is mandatory
    if (!isPublic && (!Array.isArray(departmentIds) || departmentIds.length === 0)) {
      req.files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json({
        success: false,
        message: 'Please select at least one department for private documents, or mark the document as Public.'
      });
    }

    // Validate that departmentIds exist in the database (if provided)
    const validDepts = [];
    if (Array.isArray(departmentIds)) {
      for (const dId of departmentIds) {
        if (mongoose.Types.ObjectId.isValid(dId)) {
          const dept = await Department.findById(dId);
          if (dept) validDepts.push(dept._id);
        }
      }
    }

    if (!isPublic && validDepts.length === 0) {
      req.files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json({
        success: false,
        message: 'None of the provided department IDs exist in the database'
      });
    }

    // 1. SHA-256 Hash Duplicate Validation (Skips duplicates without aborting the batch)
    const preparedFiles = [];
    const skippedDuplicates = [];

    for (const file of req.files) {
      const fileHash = await computeFileHash(file.path);

      // Check if identical hash already exists in the system
      const existingDuplicate = await Document.findOne({ fileHash });
      if (existingDuplicate) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        skippedDuplicates.push({
          filename: file.originalname,
          existingName: existingDuplicate.originalFilename
        });
        continue;
      }

      // Check version increment for same filename with updated content
      const previousVersionDoc = await Document.findOne({
        originalFilename: file.originalname
      }).sort({ version: -1 });

      const nextVersion = previousVersionDoc ? (previousVersionDoc.version || 1) + 1 : 1;

      preparedFiles.push({
        file,
        fileHash,
        version: nextVersion
      });
    }

    // If every uploaded file in the batch was a duplicate
    if (preparedFiles.length === 0) {
      return res.status(409).json({
        success: false,
        message: `All uploaded files already exist in the knowledge base! (${skippedDuplicates.map((d) => d.filename).join(', ')})`
      });
    }

    // 2. Create Document records in MongoDB
    const createdDocs = [];
    for (const item of preparedFiles) {
      const { file, fileHash, version } = item;
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

      const doc = await Document.create({
        originalFilename: file.originalname,
        fileType: ext,
        fileSize: file.size,
        storagePath: file.path,
        fileHash,
        version,
        source: 'upload',
        departmentIds: validDepts,
        isPublic,
        status: 'processing'
      });
      createdDocs.push(doc);
    }

    const docIds = createdDocs.map((d) => d._id);

    // Initial update of department document counts
    for (const dId of validDepts) {
      const count = await Document.countDocuments({ departmentIds: dId });
      await Department.findByIdAndUpdate(dId, { documentCount: count });
    }

    // 3. Record Audit Log for Document Upload
    logAction({
      req,
      action: 'DOCUMENT_UPLOAD',
      resourceType: 'Document',
      details: {
        count: createdDocs.length,
        filenames: createdDocs.map((d) => d.originalFilename),
        skippedDuplicatesCount: skippedDuplicates.length,
        skippedFiles: skippedDuplicates.map((d) => d.filename),
        departmentIds: validDepts,
        isPublic
      }
    });

    // 4. Send immediate response so frontend UI never blocks
    const skippedNote = skippedDuplicates.length > 0
      ? ` (${skippedDuplicates.length} duplicate file(s) skipped)`
      : '';

    res.status(202).json({
      success: true,
      message: `Uploaded ${createdDocs.length} file(s)${skippedNote}. Ingestion is running in the background.`,
      count: createdDocs.length,
      data: createdDocs
    });

    // 5. Run ingestion pipeline sequentially (concurrency: 1) to prevent vector lock collisions
    setImmediate(async () => {
      const ingestStart = Date.now();
      try {
        console.log(`\n[Ingestion] >>> Started background ingestion for ${docIds.length} file(s)...`);

        await processDocumentsBatch(docIds, 1);

        const ingestDuration = Date.now() - ingestStart;
        console.log('\n================ [INGESTION COMPLETED] ================');
        console.log(`Files Processed   : ${docIds.length}`);
        console.log(`Total Time Taken  : ${ingestDuration} ms (${(ingestDuration / 1000).toFixed(2)}s)`);
        console.log(`Average Per File  : ${(ingestDuration / docIds.length / 1000).toFixed(2)}s`);
        console.log('=======================================================\n');

        // Re-sync department document counts after ingestion completes
        for (const dId of validDepts) {
          const count = await Document.countDocuments({ departmentIds: dId });
          await Department.findByIdAndUpdate(dId, { documentCount: count });
        }
      } catch (bgError) {
        console.error('[Processor] Background ingestion failure:', bgError);
      }
    });
  } catch (error) {
    console.error('Error during uploadDocuments:', error);
    if (req.files) {
      req.files.forEach((f) => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'File upload failed'
    });
  }
};

// GET /api/documents - List documents with optional filters
exports.getDocuments = async (req, res) => {
  try {
    const { departmentId, status, search, isPublic } = req.query;
    const query = {};

    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      query.departmentIds = departmentId;
    }

    if (status) {
      query.status = status;
    }

    if (isPublic !== undefined) {
      query.isPublic = isPublic === 'true' || isPublic === true;
    }

    if (search) {
      query.originalFilename = { $regex: search, $options: 'i' };
    }

    const documents = await Document.find(query)
      .populate('departmentIds', 'name code')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: documents.length,
      data: documents
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// GET /api/documents/:id - Single document details
exports.getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }

    const doc = await Document.findById(id).populate('departmentIds', 'name code description');
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    return res.status(200).json({
      success: true,
      data: doc
    });
  } catch (error) {
    console.error('Error fetching document by ID:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/documents/:id/file - Serve/view physical document file safely
exports.getDocumentFile = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }

    const doc = await Document.findById(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (doc.source === 'google_drive' && doc.driveMetadata?.webViewLink) {
      return res.redirect(doc.driveMetadata.webViewLink);
    }

    const filePath = doc.storagePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Physical document file not found on disk' });
    }

    const ext = path.extname(doc.originalFilename).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.txt': 'text/plain; charset=utf-8',
      '.csv': 'text/csv; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    };

    if (mimeMap[ext]) {
      res.setHeader('Content-Type', mimeMap[ext]);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalFilename)}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.originalFilename)}"`);
    }

    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Error streaming document file:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/documents/:id/images - Get all extracted images for a document
exports.getDocumentImages = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }

    const images = await Image.find({ documentId: id }).sort({ pageNumber: 1, createdAt: 1 });
    return res.status(200).json({
      success: true,
      count: images.length,
      data: images
    });
  } catch (error) {
    console.error('Error fetching document images:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/documents/:id - Delete document, chunks, physical images, and vector entries
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID' });
    }

    const doc = await Document.findById(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    // 1. Remove physical document file from disk
    if (doc.storagePath && fs.existsSync(doc.storagePath)) {
      try {
        fs.unlinkSync(doc.storagePath);
      } catch (err) {
        console.warn(`Failed to delete file from disk: ${doc.storagePath}`, err.message);
      }
    }

    // 2. Delete chunks from MongoDB and remove vector entries from local text vector store
    await DocumentChunk.deleteMany({ documentId: id });
    await vectorService.removeDocumentChunks(id);

    // 3. Delete Image MongoDB records, physical image files, and image vectors
    await Image.deleteMany({ documentId: id });
    await imageVectorService.removeDocumentImages(id);
    removeExtractedImages(id);

    const deptIds = doc.departmentIds;
    await Document.findByIdAndDelete(id);

    // 4. Update document counts for affected departments
    if (deptIds && deptIds.length > 0) {
      for (const dId of deptIds) {
        const count = await Document.countDocuments({ departmentIds: dId });
        await Department.findByIdAndUpdate(dId, { documentCount: count });
      }
    }

    // 5. Record Audit Log for Document Deletion
    logAction({
      req,
      action: 'DOCUMENT_DELETE',
      resourceType: 'Document',
      resourceId: id,
      details: {
        deletedFilename: doc.originalFilename,
        departmentIds: deptIds
      }
    });

    return res.status(200).json({
      success: true,
      message: `Document "${doc.originalFilename}" and all associated images deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};