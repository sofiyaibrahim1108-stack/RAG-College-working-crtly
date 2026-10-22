const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const {
  sendMessage,
  getHistory,
  listConversations,
  deleteConversation,
  truncateHistoryFrom
} = require('../controllers/chat.controller');

// Protect chat history, conversation list, and Q&A from unauthenticated access
router.use(protect);

router.post('/', sendMessage);
router.get('/history/:sessionId', getHistory);
router.delete('/history/:sessionId/from/:messageId', truncateHistoryFrom);
router.get('/conversations', listConversations);
router.delete('/conversations/:sessionId', deleteConversation);

module.exports = router;

