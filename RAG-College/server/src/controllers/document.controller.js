const mongoose = require('mongoose');
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
const {
  resolveActor,
  toIdString,
  uniqueIds,
  getUserDepartmentIds,
  isAdmin,
  isSuperAdmin,
  isScopedAdmin
} = require('../services/access.service');

/* ------------------------------------------------------------------ */
/* Document-specific access helpers                                    */
/* ------------------------------------------------------------------ */

function getDocumentDepartmentIds(doc) {
  const source =
    Array.isArray(doc.departmentIds) && doc.departmentIds.length > 0
      ? doc.departmentIds
      : doc.departmentId
        ? [doc.departmentId]
        : [];
  return uniqueIds(source);
}

function canReadDocument(user, doc) {
  if (!user) return true; // keeps the previous behaviour when no user is attached
  if (isSuperAdmin(user)) return true;
  if (doc.isPublic) return true;
  const userDepts = getUserDepartmentIds(user);
  return getDocumentDepartmentIds(doc).some((id) => userDepts.includes(id));
}

// A scoped admin may manage a document only if ALL its departments are theirs.
function canManageDocument(user, doc) {
  if (!isAdmin(user)) return false;
  if (isSuperAdmin(user)) return true;
  const docDepts = getDocumentDepartmentIds(doc);
  const userDepts = getUserDepartmentIds(user);
  return docDepts.length > 0 && docDepts.every((id) => userDepts.includes(id));
}

function parseDepartmentIds(body) {
  const raw = body.departmentIds !== undefined ? body.departmentIds : body.departmentId;
  if (raw === undefined || raw === null || raw === '') return [];

  let ids;
  if (Array.isArray(raw)) {
    ids = raw;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      ids = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      ids = [raw];
    }
  } else {
    ids = [raw];
  }
  return uniqueIds(ids);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanupUploadedFiles(files) {
  for (const file of files || []) {
    try {
      if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch (e) {
      // ignore cleanup failure
    }
  }
}

/* ------------------------------------------------------------------ */
/* Controllers                                                         */
/* ------------------------------------------------------------------ */

async function getDocuments(req, res) {
  try {
    const { departmentId, status, search } = req.query;
    const actor = await resolveActor(req);
    const conditions = [];

    if (actor) {
      const actorDepts = getUserDepartmentIds(actor);

      if (isAdmin(actor)) {
        // Department Admin: only documents in their own departments.
        // Super Admin: no restriction.
        if (actorDepts.length > 0) {
          conditions.push({
            $or: [
              { departmentIds: { $in: actorDepts } },
              { departmentId: { $in: actorDepts } }
            ]
          });
        }
      } else {
        conditions.push({
          $or: [
            { isPublic: true },
            { departmentIds: { $in: actorDepts } },
            { departmentId: { $in: actorDepts } }
          ]
        });
      }
    }

    if (departmentId) {
      if (!mongoose.isValidObjectId(departmentId)) {
        return res.json({ success: true, data: [] });
      }
      conditions.push({
        $or: [{ departmentIds: departmentId }, { departmentId }]
      });
    }

    if (status) conditions.push({ status });
    if (search) {
      conditions.push({ originalFilename: { $regex: escapeRegex(search), $options: 'i' } });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};
    const documents = await Document.find(query).sort({ createdAt: -1 });
    return res.json({ success: true, data: documents });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function uploadDocuments(req, res) {
  try {
    const actor = await resolveActor(req);

    if (!isAdmin(actor)) {
      cleanupUploadedFiles(req.files);
      return res.status(403).json({ success: false, message: 'Admin privileges required to upload documents' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const departmentIds = parseDepartmentIds(req.body).filter(Boolean);

    if (departmentIds.some((id) => !mongoose.isValidObjectId(id))) {
      cleanupUploadedFiles(req.files);
      return res.status(400).json({ success: false, message: 'One or more department ids are invalid' });
    }

    let isPublic = req.body.isPublic === 'true' || req.body.isPublic === true;

    if (isScopedAdmin(actor)) {
      const actorDepts = getUserDepartmentIds(actor);

      if (departmentIds.length === 0) {
        cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Select at least one of your assigned departments for this upload'
        });
      }

      const outOfScope = departmentIds.filter((id) => !actorDepts.includes(id));
      if (outOfScope.length > 0) {
        cleanupUploadedFiles(req.files);
        return res.status(403).json({
          success: false,
          message: 'You can only upload to departments assigned to you'
        });
      }

      // Public (all-users) documents are managed by Super Admins only.
      isPublic = false;
    }

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
        departmentIds,
        departmentId: departmentIds[0] || null,
        isPublic,
        status: 'pending'
      });

      uploadedDocs.push(doc);

      for (const dId of departmentIds) {
        await Department.findByIdAndUpdate(dId, { $inc: { documentCount: 1 } }).catch(() => {});
      }

      logAction({
        req,
        action: 'DOCUMENT_UPLOAD',
        resourceType: 'Document',
        resourceId: doc._id,
        details: { filename: doc.originalFilename, isPublic, departmentIds }
      });

      processDocument(doc._id).catch((err) => console.error('[Processor] Background error:', err));
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

    const actor = await resolveActor(req);
    if (!canReadDocument(actor, doc)) {
      return res.status(403).json({ success: false, message: 'Access denied to this document' });
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

    const actor = await resolveActor(req);
    if (!canReadDocument(actor, doc)) {
      return res.status(403).json({ success: false, message: 'Access denied to this file' });
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

    const actor = await resolveActor(req);
    if (!canReadDocument(actor, doc)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
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

    const actor = await resolveActor(req);
    if (!canManageDocument(actor, doc)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this document'
      });
    }

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
    for (const dId of getDocumentDepartmentIds(doc)) {
      await Department.findByIdAndUpdate(dId, { $inc: { documentCount: -1 } }).catch(() => {});
    }

    await DocumentChunk.deleteMany({ documentId: doc._id });
    await Image.deleteMany({ documentId: doc._id });
    await Document.findByIdAndDelete(doc._id);

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