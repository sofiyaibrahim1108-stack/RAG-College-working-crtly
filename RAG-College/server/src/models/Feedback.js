const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    userEmail: {
      type: String,
      default: 'anonymous'
    },
    conversationId: {
      type: String,
      default: null
    },
    sessionId: {
      type: String,
      default: null
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null
    },
    query: {
      type: String,
      default: ''
    },
    response: {
      type: String,
      default: ''
    },
    rating: {
      type: String,
      enum: ['up', 'down', 'like', 'dislike'],
      required: true
    },
    reason: {
      type: String,
      default: ''
    },
    sources: {
      type: Array,
      default: []
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Feedback', feedbackSchema);