const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    originalFilename: {
      type: String,
      required: true,
      trim: true
    },
    fileType: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    storagePath: {
      type: String,
      required: true
    },
    fileHash: {
      type: String,
      required: true,
      index: true
    },
    version: {
      type: Number,
      default: 1
    },
    source: {
      type: String,
      enum: ['upload', 'google_drive'],
      default: 'upload'
    },
    driveFileId: {
      type: String,
      default: null,
      index: true
    },
    driveMetadata: {
      webViewLink: String,
      mimeType: String,
      modifiedTime: Date,
      exportMimeType: String
    },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        index: true
      }
    ],
    isPublic: {
      type: Boolean,
      default: false,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'ready', 'failed'],
      default: 'pending',
      index: true
    },
    processingError: {
      type: String,
      default: null
    },
    chunkCount: {
      type: Number,
      default: 0
    },
    imageCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Document', DocumentSchema);