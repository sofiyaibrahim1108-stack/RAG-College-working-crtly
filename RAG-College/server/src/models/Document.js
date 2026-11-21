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
    },

    // Excel/CSV only: layout analysis written by the LLM once, right after upload.
    // Used by tabular.service.js; ignored for every other file type.
    tabularProfile: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    tabularProfileStatus: {
      type: String,
      enum: ['none', 'pending', 'ready', 'failed'],
      default: 'none',
      index: true
    },
    tabularProfileError: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Document', DocumentSchema);