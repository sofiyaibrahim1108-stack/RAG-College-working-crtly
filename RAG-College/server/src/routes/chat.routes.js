const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

// Chat and session management routes (User / Authenticated)
router.post('/', protect, chatController.sendMessage);
router.get('/conversations', protect, chatController.listConversations);
router.get('/history/:sessionId', protect, chatController.getHistory);
router.delete('/conversations/:sessionId', protect, chatController.deleteConversation);
router.delete('/history/:sessionId/from/:messageId', protect, chatController.truncateHistoryFrom);

// Feedback routes
// POST: Submit feedback (open to authenticated users / guest sessions without 401 blocks)
router.post('/feedback', chatController.submitFeedback);

// GET: Retrieve feedback logs (strictly restricted to administrators)
router.get('/feedback', protect, authorize('admin'), chatController.listFeedback);

module.exports = router;