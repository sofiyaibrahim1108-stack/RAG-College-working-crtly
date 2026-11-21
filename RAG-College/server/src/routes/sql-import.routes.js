const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { protect, authorize } = require('../middlewares/auth.middleware');
const sqlImportService = require('../services/sql-import.service');
const sqlVectorService = require('../services/sql-vector.service');

const router = express.Router();

const TEMP_UPLOAD_DIR = path.join(__dirname, '../../uploads/sql-temp');
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.SQL_IMPORT_MAX_FILE_BYTES) || 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Only .csv, .xls, and .xlsx files are supported for SQL import.'));
    }
    cb(null, true);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/sql-import/schemas                                        */
/* ------------------------------------------------------------------ */
router.get('/schemas', protect, authorize('admin'), async (_req, res) => {
  try {
    const schemas = await sqlImportService.getExistingMysqlSchemas();
    return res.json({ success: true, data: schemas });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/sql-import/analyze                                       */
/* ------------------------------------------------------------------ */
router.post('/analyze', protect, authorize('admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a CSV or Excel file.' });
    }

    const sheetName = req.body?.sheetName || null;
    const result = await sqlImportService.analyzeUploadedFile(req.file, { sheetName });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/sql-import/confirm                                       */
/* ------------------------------------------------------------------ */
router.post('/confirm', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      uploadId,
      targetTable,
      columnMappings,
      sheetName,
      selectedSheets,
      defaultValues,
      confirmations,
      datasetDescription,
      generatedSummary,
      allowDuplicate,
      rowDuplicateAction,
      skipInvalidRows,
      skipPartialRows,
      skipFooterRows,
      editedCells,
      skippedRowKeys
    } = req.body || {};

    if (!uploadId || !targetTable || !Array.isArray(columnMappings)) {
      return res.status(400).json({
        success: false,
        message: 'uploadId, targetTable, and columnMappings[] are required.'
      });
    }

    const result = await sqlImportService.confirmAndInsertDataset({
      uploadId,
      targetTable,
      columnMappings,
      sheetName,
      selectedSheets,
      defaultValues,
      confirmations,
      datasetDescription,
      generatedSummary,
      allowDuplicate: Boolean(allowDuplicate),
      rowDuplicateAction: rowDuplicateAction || 'import',
      skipInvalidRows: Boolean(skipInvalidRows),
      skipPartialRows: Boolean(skipPartialRows),
      skipFooterRows: Boolean(skipFooterRows),
      editedCells: Array.isArray(editedCells) ? editedCells : [],
      skippedRowKeys: Array.isArray(skippedRowKeys) ? skippedRowKeys : [],
      uploadedBy: req.user?._id || req.user?.id || null
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      message: err.message,
      validationErrors: err.validationErrors || undefined
    });
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/sql-import/registry                                       */
/* ------------------------------------------------------------------ */
router.get('/registry', protect, authorize('admin'), async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const records = await sqlImportService.listRegistry(limit);
    const vectorStats =
      typeof sqlVectorService.getStats === 'function'
        ? await sqlVectorService.getStats()
        : null;

    return res.json({ success: true, data: records, vectorStats });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/sql-import/registry/:id                                   */
/* ------------------------------------------------------------------ */
router.get('/registry/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const record = await sqlImportService.getRegistryById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Dataset registry record not found.' });
    }
    return res.json({ success: true, data: record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/sql-import/registry/:id/retry                            */
/* ------------------------------------------------------------------ */
router.post('/registry/:id/retry', protect, authorize('admin'), async (req, res) => {
  try {
    const result = await sqlImportService.retryDatasetEmbedding(req.params.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
});

module.exports = router;