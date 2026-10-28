const MediaLibrary = require('../models/MediaLibrary');
const path = require('path');
const fs = require('fs');

// 1. Get user's saved media library
async function getMediaLibrary(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const items = await MediaLibrary.find({ userId }).sort({ savedAt: -1 });
    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 2. Save an image to library
async function saveToMediaLibrary(req, res) {
  try {
    const userId = req.user._id || req.user.id;
    const { documentId, imageUrl, imagePath, caption, pageNumber } = req.body;

    const existing = await MediaLibrary.findOne({ userId, imagePath });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Image already saved in your library' });
    }

    const savedItem = await MediaLibrary.create({
      userId,
      documentId,
      imageUrl,
      imagePath,
      caption,
      pageNumber
    });

    return res.status(201).json({ success: true, data: savedItem, message: 'Saved to Media Library successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

async function downloadMediaItem(req, res) {
  try {
    const item = await MediaLibrary.findById(req.params.id);
    if (!item || !fs.existsSync(item.imagePath)) {
      return res.status(404).json({ success: false, message: 'Image file not found' });
    }
    
    // Explicit-ah image content type-ai set seyyungal (prevents opening in notepad)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(item.caption || 'diagram')}.png"`);
    
    const fileStream = fs.createReadStream(item.imagePath);
    fileStream.pipe(res);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 4. Remove from library
async function removeMediaItem(req, res) {
  try {
    await MediaLibrary.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Removed from library' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getMediaLibrary,
  saveToMediaLibrary,
  downloadMediaItem,
  removeMediaItem
};