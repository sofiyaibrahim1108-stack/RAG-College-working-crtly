const Document = require('../models/Document');
const DocumentChunk = require('../models/DocumentChunk');
const Image = require('../models/Image');
const Department = require('../models/Department');
const { processDocument } = require('../services/processor.service');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const vectorService = require('../services/vector.service');
const imageVectorService = require('../services/image-vector.service');
const { logAction } = require('../services/audit.service');

async function getDocuments(req, res) {
  try {
    const { departmentId, status, search } = req.query;
    const query = {};

    if (req.user && req.user.role !== 'admin') {
      const userDepts = req.user.departmentIds || (req.user.departmentId ? [req.user.departmentId] : []);
      query.$or = [
        { isPublic: true },
        { departmentIds: { $in: userDepts } },
        { departmentId: { $in: userDepts } }
      ];
    }

    if (departmentId) query.departmentIds = departmentId;
    if (status) query.status = status;
    if (search) {
      query.originalFilename = { $regex: search, $options: 'i' };
    }

    const documents = await Document.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, data: documents });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function uploadDocuments(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    // Properly parse departmentIds and isPublic sent from UploadModal frontend
    let departmentIds = [];
    if (req.body.departmentIds) {
      try {
        departmentIds = typeof req.body.departmentIds === 'string' 
          ? JSON.parse(req.body.departmentIds) 
          : req.body.departmentIds;
      } catch (e) {
        departmentIds = [req.body.departmentIds];
      }
    } else if (req.body.departmentId) {
      departmentIds = [req.body.departmentId];
    }

    const isPublic = req.body.isPublic === 'true' || req.body.isPublic === true;
    const uploadedDocs = [];

    for (const file of req.files) {
      const fileBuffer = fs.readFileSync(file.path);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

      const doc = await Document.create({
        originalFilename: file.originalname,
        filename: file.filename,
        storagePath: file.path,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileType: ext || 'pdf',
        fileHash,
        departmentIds: departmentIds.filter(Boolean),
        departmentId: departmentIds[0] || null,
        isPublic,
        status: 'pending'
      });

      uploadedDocs.push(doc);

      // Increment department document counts
      for (const dId of departmentIds) {
        if (dId) {
          await Department.findByIdAndUpdate(dId, { $inc: { documentCount: 1 } }).catch(() => {});
        }
      }

      // Record audit log
      logAction({
        req,
        action: 'DOCUMENT_UPLOAD',
        resourceType: 'Document',
        resourceId: doc._id,
        details: { filename: doc.originalFilename, isPublic }
      });
      
      processDocument(doc._id).catch(err => console.error('[Processor] Background error:', err));
    }

    return res.status(201).json({ success: true, data: uploadedDocs });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getDocumentById(req, res) {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    if (req.user && req.user.role !== 'admin') {
      const userDepts = req.user.departmentIds || (req.user.departmentId ? [req.user.departmentId] : []);
      const hasAccess = doc.isPublic || 
        (doc.departmentIds && doc.departmentIds.some(id => userDepts.includes(id.toString()))) ||
        (doc.departmentId && userDepts.includes(doc.departmentId.toString()));
      
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Access denied to this document' });
      }
    }

    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getDocumentFile(req, res) {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document record not found' });
    }

    if (req.user && req.user.role !== 'admin') {
      const userDepts = req.user.departmentIds || (req.user.departmentId ? [req.user.departmentId] : []);
      const hasAccess = doc.isPublic || 
        (doc.departmentIds && doc.departmentIds.some(id => userDepts.includes(id.toString()))) ||
        (doc.departmentId && userDepts.includes(doc.departmentId.toString()));
      
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Access denied to this file' });
      }
    }
    
    const targetPath = doc.storagePath || doc.filePath;
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, message: 'File not found on disk' });
    }
    return res.sendFile(path.resolve(targetPath));
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function getDocumentImages(req, res) {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    if (req.user && req.user.role !== 'admin') {
      const userDepts = req.user.departmentIds || (req.user.departmentId ? [req.user.departmentId] : []);
      const hasAccess = doc.isPublic || 
        (doc.departmentIds && doc.departmentIds.some(id => userDepts.includes(id.toString()))) ||
        (doc.departmentId && userDepts.includes(doc.departmentId.toString()));
      
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const images = await Image.find({ documentId: req.params.id }).sort({ pageNumber: 1, createdAt: 1 });
    return res.json({ success: true, count: images.length, data: images });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

    // 1. Remove physical file from disk
    const targetPath = doc.storagePath || doc.filePath;
    if (targetPath && fs.existsSync(targetPath)) {
      try { fs.unlinkSync(targetPath); } catch (e) {}
    }

    // 2. Remove extracted diagram/image files directory if it exists
    const imgDir = path.join(__dirname, '../../data/images', String(doc._id));
    if (fs.existsSync(imgDir)) {
      try {
        fs.rmSync(imgDir, { recursive: true, force: true });
      } catch (e) {}
    }

    // 3. Clean up text vector database chunks to prevent ghost results
    try {
      if (vectorService && typeof vectorService.removeDocumentChunks === 'function') {
        await vectorService.removeDocumentChunks(doc._id);
      }
    } catch (vecErr) {
      console.error('[VectorCleanup] Text vector warning:', vecErr);
    }

    // 4. Clean up image vector database embeddings to prevent ghost diagrams
    try {
      if (imageVectorService && typeof imageVectorService.removeDocumentImages === 'function') {
        await imageVectorService.removeDocumentImages(doc._id);
      }
    } catch (imgVecErr) {
      console.error('[VectorCleanup] Image vector warning:', imgVecErr);
    }

    // 5. Decrement department document counts
    const deptList = doc.departmentIds && doc.departmentIds.length > 0 ? doc.departmentIds : (doc.departmentId ? [doc.departmentId] : []);
    for (const dId of deptList) {
      if (dId) {
        await Department.findByIdAndUpdate(dId, { $inc: { documentCount: -1 } }).catch(() => {});
      }
    }

    await DocumentChunk.deleteMany({ documentId: doc._id });
    await Image.deleteMany({ documentId: doc._id });
    await Document.findByIdAndDelete(doc._id);

    // Record audit log for deletion
    logAction({
      req,
      action: 'DOCUMENT_DELETE',
      resourceType: 'Document',
      resourceId: doc._id,
      details: { filename: doc.originalFilename }
    });

    return res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getDocuments,
  uploadDocuments,
  getDocumentById,
  getDocumentFile,
  getDocumentImages,
  deleteDocument
};