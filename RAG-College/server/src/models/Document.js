const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    originalFilename: {
      type: String,
      required: [true, 'Original filename is required'],
      trim: true
    },
    fileType: {
      type: String,
      required: true,
      lowercase: true,
      trim: true // pdf, doc, docx, csv, xls, xlsx, txt, ppt, pptx
    },
    fileSize: {
      type: Number,
      required: true
    },
    storagePath: {
      type: String,
      default: null
    },
    // SHA-256 Hash for duplicate detection across uploads
    fileHash: {
      type: String,
      default: null,
      index: true
    },
    // Version increment counter for updated files with the same filename
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
      sparse: true,
      index: true
    },
    driveMetadata: {
      webViewLink: { type: String, default: null },
      mimeType: { type: String, default: null },
      modifiedTime: { type: Date, default: null },
      exportMimeType: { type: String, default: null }
    },
    departmentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department',
        index: true
      }
    ],
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    processingError: {
      type: String,
      default: null
    },
    totalChunks: {
      type: Number,
      default: 0
    },
    metadata: {
      pageCount: { type: Number, default: 0 },
      slideCount: { type: Number, default: 0 },
      sheetNames: [{ type: String }],
      rowCount: { type: Number, default: 0 },
      author: { type: String, default: null }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual to provide a unified processingStatus for frontend clients
documentSchema.virtual('processingStatus').get(function () {
  if (this.status === 'completed') return 'ready';
  return this.status; // 'pending', 'processing', 'failed'
});

documentSchema.index({ departmentIds: 1, status: 1 });
documentSchema.index({ fileHash: 1 });

module.exports = mongoose.model('Document', documentSchema);