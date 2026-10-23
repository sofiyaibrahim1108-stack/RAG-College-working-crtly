const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null
    },
    title: {
      type: String,
      default: 'New Conversation',
      trim: true
    },
    departmentContext: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department'
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Conversation', conversationSchema);