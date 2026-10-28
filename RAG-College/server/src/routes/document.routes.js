const express = require('express');
const router = express.Router();
const documentController = require('../controllers/document.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const { upload } = require('../middlewares/upload.middleware'); // Destructured from your existing object export

router.get('/', protect, documentController.getDocuments);
router.post('/upload', protect, authorize('admin'), upload.array('files'), documentController.uploadDocuments);
router.get('/:id', protect, documentController.getDocumentById);
router.get('/:id/file', protect, documentController.getDocumentFile);
router.get('/:id/images', protect, documentController.getDocumentImages);
router.delete('/:id', protect, authorize('admin'), documentController.deleteDocument);

module.exports = router;