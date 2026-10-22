const mongoose = require('mongoose');

const documentChunkSchema = new mongoose.Schema(
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
    chunkIndex: {
      type: Number,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    embedding: {
      type: [Number],
      required: true,
      default: []
    },
    metadata: {
      sourceFilename: { type: String, default: '' },
      pageNumber: { type: Number, default: null },
      slideNumber: { type: Number, default: null },
      sheetName: { type: String, default: null },
      rowNumber: { type: Number, default: null },
      section: { type: String, default: null }
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for lightning fast filtering by department and document
documentChunkSchema.index({ departmentIds: 1, documentId: 1 });
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 });
documentChunkSchema.index({ content: 'text' });

module.exports = mongoose.model('DocumentChunk', documentChunkSchema);
