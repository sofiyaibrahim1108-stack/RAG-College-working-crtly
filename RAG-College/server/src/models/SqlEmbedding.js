const mongoose = require('mongoose');

const sqlEmbeddingSchema = new mongoose.Schema(
  {
    datasetId: {
      type: Number,
      required: true,
      index: true
    },
    recordType: {
      type: String,
      enum: ['sql_dataset_summary', 'sql_row'],
      required: true,
      index: true
    },
    targetTable: {
      type: String,
      required: true,
      index: true
    },
    mysqlRowId: {
      type: String,
      default: null
    },
    content: {
      type: String,
      required: true
    },
    metadata: {
      fileName: { type: String, default: '' },
      sheetName: { type: String, default: null },
      columns: { type: [String], default: [] },
      rowIndex: { type: Number, default: null }
    },
    embedding: {
      type: [Number],
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'sqlembeddings'
  }
);

sqlEmbeddingSchema.index({ datasetId: 1, recordType: 1 });
sqlEmbeddingSchema.index({ recordType: 1, targetTable: 1 });

module.exports = mongoose.model('SqlEmbedding', sqlEmbeddingSchema);