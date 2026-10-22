const express = require('express');
const router = express.Router();
const { upload } = require('../middlewares/upload.middleware');
const {
  uploadDocuments,
  getDocuments,
  getDocumentById,
  getDocumentFile,
  getDocumentImages,
  deleteDocument
} = require('../controllers/document.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Upload up to 20 files at once (Admin only)
router.post('/upload', protect, authorize('admin'), upload.array('files', 20), uploadDocuments);
router.get('/', getDocuments);
router.get('/:id', getDocumentById);
router.get('/:id/file', getDocumentFile);
router.get('/:id/images', getDocumentImages);
router.delete('/:id', protect, authorize('admin'), deleteDocument);

module.exports = router;
