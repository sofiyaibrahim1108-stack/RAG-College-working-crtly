const express = require('express');
const router = express.Router();
const driveController = require('../controllers/drive.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Google Drive Auth & Status
router.get('/status', driveController.getAuthStatus);
router.get('/auth', protect, authorize('admin'), driveController.getAuthUrl);
router.get('/callback', driveController.handleCallback);
router.post('/disconnect', protect, authorize('admin'), driveController.disconnect);

// Google Drive File Operations
router.get('/files', driveController.listFiles);
router.get('/files/:fileId', driveController.getFileMetadata);
router.post('/import', protect, authorize('admin'), driveController.importFile);

module.exports = router;
