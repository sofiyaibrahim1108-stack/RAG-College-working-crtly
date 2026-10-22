const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const googleDriveService = require('../services/google-drive.service');
const Document = require('../models/Document');
const Department = require('../models/Department');
const { processDocument } = require('../services/processor.service');const { CLIENT_URL } = require('../config/env');

const UPLOAD_DIR = path.resolve(__dirname, '../../data/uploads');

// GET /api/drive/status
exports.getAuthStatus = async (req, res) => {
  try {
    const configured = googleDriveService.isConfigured();
    const authenticated = googleDriveService.isAuthenticated();

    return res.json({
      success: true,
      configured,
      authenticated
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to check Google Drive authentication status',
      error: err.message
    });
  }
};

// GET /api/drive/auth
exports.getAuthUrl = async (req, res) => {
  try {
    if (!googleDriveService.isConfigured()) {
      return res.status(400).json({
        success: false,
        message: 'Google OAuth credentials not configured in environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)'
      });
    }

    const state = req.query.state || '';
    const authUrl = googleDriveService.getAuthUrl(state);

    return res.json({
      success: true,
      authUrl
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to generate authorization URL',
      error: err.message
    });
  }
};

// GET /api/drive/callback
exports.handleCallback = async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.warn('[Google Drive Auth] User denied access or error:', error);
    return res.redirect(`${CLIENT_URL}?driveAuth=error&message=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${CLIENT_URL}?driveAuth=error&message=No+code+provided`);
  }

  try {
    await googleDriveService.handleCallback(code);
    return res.redirect(`${CLIENT_URL}?driveAuth=success`);
  } catch (err) {
    console.error('[Google Drive Auth] Callback error:', err.message);
    return res.redirect(`${CLIENT_URL}?driveAuth=error&message=${encodeURIComponent(err.message)}`);
  }
};

// POST /api/drive/disconnect
exports.disconnect = async (req, res) => {
  try {
    const result = googleDriveService.disconnect();
    return res.json({
      success: true,
      message: result.message
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to disconnect Google Drive',
      error: err.message
    });
  }
};

// GET /api/drive/files
exports.listFiles = async (req, res) => {
  try {
    if (!googleDriveService.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Google Drive is not authenticated. Please connect your Google account first.'
      });
    }

    const { pageSize, pageToken, search } = req.query;
    const result = await googleDriveService.listFiles({
      pageSize: pageSize ? parseInt(pageSize, 10) : 30,
      pageToken,
      search
    });

    // Check which files have already been imported into MongoDB
    const driveIds = result.files.map((f) => f.id);
    const existingDocs = await Document.find({
      driveFileId: { $in: driveIds }
    }).select('driveFileId _id status originalFilename').lean();

    const existingMap = new Map();
    existingDocs.forEach((d) => existingMap.set(d.driveFileId, d));

    const enrichedFiles = result.files.map((f) => {
      const existing = existingMap.get(f.id);
      return {
        ...f,
        isImported: Boolean(existing),
        importedDocumentId: existing ? existing._id : null,
        importedStatus: existing ? existing.status : null
      };
    });

    return res.json({
      success: true,
      files: enrichedFiles,
      nextPageToken: result.nextPageToken
    });
  } catch (err) {
    console.error('[Google Drive] listFiles error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to list Google Drive files',
      error: err.message
    });
  }
};

// GET /api/drive/files/:fileId
exports.getFileMetadata = async (req, res) => {
  try {
    if (!googleDriveService.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Google Drive is not authenticated'
      });
    }

    const { fileId } = req.params;
    const metadata = await googleDriveService.getFileMetadata(fileId);

    return res.json({
      success: true,
      data: metadata
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve file metadata',
      error: err.message
    });
  }
};

// POST /api/drive/import
exports.importFile = async (req, res) => {
  try {
    const { fileId, forceReimport, simulatedFilePath } = req.body;
    let departmentIds = req.body.departmentIds;

    if (!fileId || typeof fileId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'A valid fileId is required'
      });
    }

    // Step 6: Avoid duplicate imports by default
    const existingDoc = await Document.findOne({ driveFileId: fileId });
    if (existingDoc && !forceReimport) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `File has already been imported into knowledge base as "${existingDoc.originalFilename}".`,
        data: existingDoc
      });
    }

    if (!simulatedFilePath && !googleDriveService.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Google Drive is not authenticated. Please connect first.'
      });
    }

    // Parse and validate departmentIds
    if (typeof departmentIds === 'string') {
      try {
        departmentIds = JSON.parse(departmentIds);
      } catch {
        departmentIds = departmentIds.split(',').map((id) => id.trim()).filter(Boolean);
      }
    }

    if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one department must be selected for the imported document'
      });
    }

    const validDeptIds = [];
    for (const dId of departmentIds) {
      if (mongoose.Types.ObjectId.isValid(dId)) {
        const dept = await Department.findById(dId);
        if (dept) validDeptIds.push(dept._id);
      }
    }

    if (validDeptIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'None of the provided department IDs exist in the database'
      });
    }

    // Download/export from Google Drive (or handle simulated file in test mode)
    let downloaded;
    if (req.body.simulatedFilePath && fs.existsSync(req.body.simulatedFilePath)) {
      const simPath = req.body.simulatedFilePath;
      const stats = fs.statSync(simPath);
      const ext = path.extname(simPath).toLowerCase();
      const filename = req.body.originalFilename || path.basename(simPath);
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetPath = path.join(UPLOAD_DIR, `drive_${fileId}_${Date.now()}_${safeName}`);
      fs.copyFileSync(simPath, targetPath);

      downloaded = {
        filePath: targetPath,
        originalFilename: filename,
        fileType: ext.replace('.', '') || 'pdf',
        fileSize: stats.size,
        mimeType: req.body.mimeType || 'application/pdf',
        exportMimeType: null,
        webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
        modifiedTime: new Date(),
        isGoogleNative: false
      };
    } else {
      if (!googleDriveService.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Google Drive is not authenticated. Please connect first.'
        });
      }
      console.log(`[Google Drive Import] Downloading/exporting fileId: ${fileId}...`);
      downloaded = await googleDriveService.downloadFile(fileId, UPLOAD_DIR);
    }

    let doc;
    if (existingDoc && forceReimport) {
      // Re-use existing document record if re-importing
      existingDoc.originalFilename = downloaded.originalFilename;
      existingDoc.fileType = downloaded.fileType;
      existingDoc.fileSize = downloaded.fileSize;
      existingDoc.storagePath = downloaded.filePath;
      existingDoc.source = 'google_drive';
      existingDoc.driveFileId = fileId;
      existingDoc.driveMetadata = {
        webViewLink: downloaded.webViewLink,
        mimeType: downloaded.mimeType,
        modifiedTime: downloaded.modifiedTime,
        exportMimeType: downloaded.exportMimeType
      };
      existingDoc.departmentIds = validDeptIds;
      existingDoc.status = 'pending';
      doc = await existingDoc.save();
    } else {
      doc = new Document({
        originalFilename: downloaded.originalFilename,
        fileType: downloaded.fileType,
        fileSize: downloaded.fileSize,
        storagePath: downloaded.filePath,
        source: 'google_drive',
        driveFileId: fileId,
        driveMetadata: {
          webViewLink: downloaded.webViewLink,
          mimeType: downloaded.mimeType,
          modifiedTime: downloaded.modifiedTime,
          exportMimeType: downloaded.exportMimeType
        },
        departmentIds: validDeptIds,
        status: 'pending'
      });
      await doc.save();
    }

    // Process through the existing pipeline
    console.log(`[Google Drive Import] Processing document through existing RAG pipeline: "${doc.originalFilename}" (${doc._id})...`);
await processDocument(doc._id);
    const updatedDoc = await Document.findById(doc._id).populate('departmentIds', 'name code');
    const isSuccess = updatedDoc && updatedDoc.status === 'completed';

    return res.status(isSuccess ? 201 : 422).json({
      success: isSuccess,
      message: isSuccess
        ? `Document "${doc.originalFilename}" successfully imported from Google Drive and indexed.`
        : `Document "${doc.originalFilename}" was imported but failed processing: ${updatedDoc?.processingError || 'Unknown error'}`,
      data: updatedDoc
    });
  } catch (err) {
    console.error('[Google Drive Import] Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to import document from Google Drive',
      error: err.message
    });
  }
};
