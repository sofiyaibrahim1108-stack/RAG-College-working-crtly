const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    detectedIntent: {
      type: String,
      enum: ['casual', 'rag', 'document', 'system', 'tabular', 'unknown'],
      default: 'unknown'
    },
    detectedDepartments: [
      {
        type: String
      }
    ],
    suggestedQuestions: [
      {
        type: String
      }
    ],
    sources: [
      {
        citationIndex: Number,
        citationMarker: String,
        type: { type: String, default: 'document' },
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
        chunkId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentChunk' },
        content: String,
        snippet: String,
        filename: String,
        page: Number,
        pageNumber: Number,
        slideNumber: Number,
        sheetName: String,
        label: String,
        source: { type: String, default: 'upload' },
        sourceType: String,
        webViewLink: String,
        imageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Image' },
        imagePath: String,
        caption: String
      }
    ],
    timings: {
      routingMs: { type: Number, default: 0 },
      embeddingMs: { type: Number, default: 0 },
      textRetrievalMs: { type: Number, default: 0 },
      vectorRetrievalMs: { type: Number, default: 0 },
      keywordRetrievalMs: { type: Number, default: 0 },
      hybridFusionMs: { type: Number, default: 0 },
      rerankingMs: { type: Number, default: 0 },
      retrievalMs: { type: Number, default: 0 },
      imageRetrievalMs: { type: Number, default: 0 },
      parallelRetrievalMs: { type: Number, default: 0 },
      generationMs: { type: Number, default: 0 },
      groundingMs: { type: Number, default: 0 },
      totalMs: { type: Number, default: 0 }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Message', messageSchema);
