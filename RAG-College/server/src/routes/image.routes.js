const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Image = require('../models/Image');

// Handler for serving physical image file safely
async function serveImageFile(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid image ID' });
    }

    const image = await Image.findById(id);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    const filePath = image.filePath || image.imagePath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Physical image file not found on disk' });
    }

    res.setHeader('Content-Type', image.mimeType || 'image/png');
    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Error streaming image file:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

// GET /api/images/:id - Get image metadata
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid image ID' });
    }

    const image = await Image.findById(id).populate('documentId', 'originalFilename').populate('departmentIds', 'name code');
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        ...image.toObject(),
        url: `/api/images/${id}/file`
      }
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/images/:id/file
router.get('/:id/file', serveImageFile);

module.exports = router;
module.exports.serveImageFile = serveImageFile;