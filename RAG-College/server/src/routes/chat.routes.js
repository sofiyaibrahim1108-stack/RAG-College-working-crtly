const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middlewares/auth.middleware');

// protect middleware moolama dhaan req.user kedaikkum
router.post('/', protect, chatController.sendMessage);
router.get('/conversations', protect, chatController.listConversations);
router.get('/history/:sessionId', protect, chatController.getHistory);
router.delete('/conversations/:sessionId', protect, chatController.deleteConversation);
router.delete('/history/:sessionId/from/:messageId', protect, chatController.truncateHistoryFrom);

module.exports = router;