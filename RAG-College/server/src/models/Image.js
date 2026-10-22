const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true
    },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        index: true
      }
    ],
    // Both imagePath and filePath supported for compatibility
    imagePath: {
      type: String,
      required: true
    },
    filePath: {
      type: String,
      default: ''
    },
    originalFilename: {
      type: String,
      default: ''
    },
    imageFilename: {
      type: String,
      default: ''
    },
    mimeType: {
      type: String,
      default: 'image/png'
    },
    pageNumber: {
      type: Number,
      default: null
    },
    slideNumber: {
      type: Number,
      default: null
    },
    sheetName: {
      type: String,
      default: null
    },
    width: {
      type: Number,
      default: null
    },
    height: {
      type: Number,
      default: null
    },
    surroundingText: {
      type: String,
      default: ''
    },
    caption: {
      type: String,
      default: '',
      trim: true
    },
    embeddingStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'completed'
    },
    siglipEmbedding: {
      type: [Number],
      default: []
    },
    metadata: {
      pageOrSlide: { type: Number, default: null },
      format: { type: String, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Image', imageSchema);
