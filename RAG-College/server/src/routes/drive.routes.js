const express = require('express');
const router = express.Router();
const driveController = require('../controllers/drive.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Protected Google Drive administrative endpoints
router.get('/status', protect, authorize('admin'), driveController.getAuthStatus);
router.get('/auth', protect, authorize('admin'), driveController.getAuthUrl);
router.get('/callback', driveController.handleCallback);
router.post('/disconnect', protect, authorize('admin'), driveController.disconnect);

// Secured administrative Google Drive file listing & metadata operations
router.get('/files', protect, authorize('admin'), driveController.listFiles);
router.get('/files/:fileId', protect, authorize('admin'), driveController.getFileMetadata);
router.post('/import', protect, authorize('admin'), driveController.importFile);

module.exports = router;