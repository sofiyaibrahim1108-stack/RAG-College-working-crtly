const express = require('express');
const router = express.Router();
const { 
  getMediaLibrary, 
  saveToMediaLibrary, 
  downloadMediaItem, 
  removeMediaItem 
} = require('../controllers/media.controller');
const { protect: requireAuth } = require('../middlewares/auth.middleware');

router.get('/', requireAuth, getMediaLibrary);
router.post('/', requireAuth, saveToMediaLibrary);
router.get('/:id/download', requireAuth, downloadMediaItem);
router.delete('/:id', requireAuth, removeMediaItem);

module.exports = router;