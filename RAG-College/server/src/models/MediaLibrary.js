const mongoose = require('mongoose');

const MediaLibrarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  imageUrl: { type: String, required: true },
  imagePath: { type: String, required: true },
  caption: { type: String },
  pageNumber: { type: Number },
  savedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MediaLibrary', MediaLibrarySchema);