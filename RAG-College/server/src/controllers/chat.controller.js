const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { compiledRagGraph, filterSupportingSources } = require('../services/langgraph/workflow');
const { PipelineTimer } = require('../utils/timer');
const Feedback = require('../models/Feedback');

function openEventStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const isOpen = () => !res.writableEnded && !res.destroyed;

  const send = (event, data) => {
    if (!isOpen()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  const end = () => {
    if (isOpen()) res.end();
  };

  return { send, end };
}

exports.sendMessage = async (req, res) => {
  let stream = null;

  try {
    const {
      message,
      sessionId = 'default-session',
      departmentIds = [],
      documentId = null,
      answerLength = null,
      visualMode = null
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    const wantsStream =
      req.body.stream === true || String(req.headers.accept || '').includes('text/event-stream');

    if (wantsStream) {
      stream = openEventStream(res);
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    const currentUserObjectId = currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : null;

    // LEVEL 2 SECURITY ENFORCEMENT: RBAC Department Intersection & Super Admin check
    let allowedDepts = [];
    let isSuperAdmin = false;

    if (req.user) {
      const userDepts = [];
      if (req.user.departmentId) {
        userDepts.push(String(req.user.departmentId));
      }
      if (Array.isArray(req.user.departmentIds)) {
        req.user.departmentIds.forEach((id) => {
          if (id) userDepts.push(String(id._id || id));
        });
      }
      allowedDepts = Array.from(new Set(userDepts));

      // Super Admin: Admin role with NO assigned department restrictions
      isSuperAdmin = req.user.role === 'admin' && allowedDepts.length === 0;
    }

    const requestedDepts = (Array.isArray(departmentIds) ? departmentIds : [departmentIds])
      .filter(Boolean)
      .map((id) => String(id));

    let enforcedDepartments = [];

    if (isSuperAdmin) {
      // Super Admin can query any requested departments freely
      enforcedDepartments = requestedDepts;
    } else {
      // Scoped Department Admins and regular Staff are strictly restricted to their allowed departments
      if (requestedDepts.length > 0) {
        enforcedDepartments = requestedDepts.filter((id) => allowedDepts.includes(id));
      } else {
        enforcedDepartments = allowedDepts;
      }
    }

    let conversation = await Conversation.findOne({ sessionId });
    
    const isOwnedByOther = conversation && conversation.userId && currentUserObjectId &&
      String(conversation.userId) !== String(currentUserObjectId);

    if (!conversation || isOwnedByOther) {
      const targetSessionId = isOwnedByOther
        ? `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        : sessionId;

      conversation = await Conversation.create({
        sessionId: targetSessionId,
        userId: currentUserObjectId || undefined,
        title: message.trim().slice(0, 40),
        departmentContext: enforcedDepartments
      });
    } else {
      if (!conversation.userId && currentUserObjectId) {
        conversation.userId = currentUserObjectId;
      }
      conversation.updatedAt = new Date();
      await conversation.save();
    }

    const rawPreviousMessages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const conversationHistory = rawPreviousMessages.reverse().map((m) => ({
      role: m.role,
      content: m.content
    }));

    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: 'user',
      content: message.trim()
    });

    const startTime = Date.now();
    const graphInput = {
      question: message.trim(),
      sessionId: conversation.sessionId,
      selectedDepartments: enforcedDepartments,
      documentId,
      messages: conversationHistory,
      conversationHistory
    };

    if (answerLength && ['short', 'medium', 'detailed'].includes(answerLength)) {
      graphInput.answerLength = answerLength;
    }
    if (visualMode && ['image_only', 'both', 'text_only'].includes(visualMode)) {
      graphInput.visualMode = visualMode;
    } else {
      graphInput.visualMode = null;
    }

    const graphConfig = {
      configurable: {
        onToken: stream ? (text) => stream.send('token', { text }) : null,
        onReset: stream ? () => stream.send('reset', {}) : null
      }
    };

    const finalState = await compiledRagGraph.invoke(graphInput, graphConfig);
    const totalPipelineMs = Date.now() - startTime;

    const filteredResult = filterSupportingSources(
      finalState.answer,
      finalState.sources || [],
      { isVisualQuery: Boolean(finalState.isVisualQuery) }
    );
    const activeSources = filteredResult.sources || [];

    const mappedSources = activeSources.map((s) => ({
      citationIndex: s.citationIndex,
      citationMarker: s.citationMarker,
      type: s.type || 'document',
      documentId: s.documentId,
      chunkId: s.chunkId,
      content: s.content || s.snippet || '',
      snippet: s.snippet || s.content || s.label,
      filename: s.filename,
      page: s.pageNumber || s.page,
      pageNumber: s.pageNumber || s.page,
      slideNumber: s.slideNumber,
      sheetName: s.sheetName,
      source: s.source || 'upload',
      sourceType: s.sourceType || (s.source === 'google_drive' ? 'Google Drive' : 'Local Upload'),
      label: s.label,
      webViewLink: s.webViewLink,
      imageId: s.imageId,
      imagePath: s.imagePath,
      caption: s.caption
    }));

    const mappedImages = (finalState.imageResults || []).map((img) => ({
      _id: img._id,
      documentId: img.documentId?._id || img.documentId,
      filename: img.filename || img.originalFilename,
      originalFilename: img.originalFilename || img.filename,
      imageFilename: img.imageFilename,
      imagePath: img.imagePath || img.filePath,
      pageNumber: img.pageNumber || img.page,
      slideNumber: img.slideNumber,
      caption: img.caption,
      similarityScore: img.similarityScore
    }));

    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: 'assistant',
      content: finalState.answer || '',
      detectedIntent: finalState.intent,
      detectedDepartments: finalState.detectedDepartments || [],
      sources: mappedSources,
      imageResults: mappedImages,
      timings: finalState.timings || {}
    });

    const payload = {
      success: true,
      answer: finalState.answer,
      intent: finalState.intent,
      departments: finalState.detectedDepartments || [],
      sources: mappedSources,
      imageResults: mappedImages,
      suggestedQuestions: finalState.suggestedQuestions || [],
      timings: { ...(finalState.timings || {}), pipelineMs: totalPipelineMs },
      conversationId: conversation._id,
      sessionId: conversation.sessionId,
      userMessageId: userMessage._id,
      assistantMessageId: assistantMessage._id
    };

    if (stream) {
      stream.send('done', payload);
      stream.end();
      return;
    }

    if (!res.headersSent) {
      return res.status(200).json(payload);
    }
  } catch (error) {
    console.error('[ChatController] Error processing message:', error);

    if (stream) {
      stream.send('error', { message: error.message || 'Error executing RAG pipeline' });
      stream.end();
      return;
    }

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message || 'Error executing RAG pipeline'
      });
    }
  }
};

exports.getHistory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    if (
      req.user &&
      req.user.role !== 'admin' &&
      conversation.userId &&
      String(conversation.userId) !== String(currentUserId)
    ) {
      return res.status(403).json({ success: false, message: 'Access denied to this conversation history' });
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      count: messages.length,
      conversationId: conversation._id,
      data: messages
    });
  } catch (error) {
    console.error('[ChatController] Error fetching history:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listConversations = async (req, res) => {
  try {
    const filter = {};
    const currentUserId = req.user ? (req.user._id || req.user.id) : null;

    if (currentUserId) {
      const userObjId = mongoose.Types.ObjectId.isValid(currentUserId)
        ? new mongoose.Types.ObjectId(currentUserId)
        : null;

      filter.$or = [
        { userId: String(currentUserId) },
        ...(userObjId ? [{ userId: userObjId }] : [])
      ];
    } else {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const conversations = await Conversation.find(filter).sort({ updatedAt: -1 }).limit(30);
    return res.status(200).json({ success: true, count: conversations.length, data: conversations });
  } catch (error) {
    console.error('[ChatController] Error listing conversations:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(200).json({ success: true, message: 'Conversation not found or already deleted' });
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    if (
      req.user &&
      req.user.role !== 'admin' &&
      conversation.userId &&
      String(conversation.userId) !== String(currentUserId)
    ) {
      return res.status(403).json({ success: false, message: 'Access denied: cannot delete this conversation' });
    }

    const msgResult = await Message.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });

    return res.status(200).json({
      success: true,
      message: 'Conversation and all associated messages permanently deleted',
      deletedMessagesCount: msgResult.deletedCount
    });
  } catch (error) {
    console.error('[ChatController] Error deleting conversation:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.truncateHistoryFrom = async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const currentUserId = req.user ? (req.user._id || req.user.id) : null;
    if (
      req.user &&
      req.user.role !== 'admin' &&
      conversation.userId &&
      String(conversation.userId) !== String(currentUserId)
    ) {
      return res.status(403).json({ success: false, message: 'Access denied: cannot modify this conversation' });
    }

    let targetMsg = null;
    if (mongoose.Types.ObjectId.isValid(messageId)) {
      targetMsg = await Message.findOne({ _id: messageId, conversationId: conversation._id });
    }

    if (targetMsg) {
      const result = await Message.deleteMany({
        conversationId: conversation._id,
        $or: [{ _id: targetMsg._id }, { createdAt: { $gte: targetMsg.createdAt } }]
      });
      return res.status(200).json({
        success: true,
        message: 'Conversation branch truncated successfully',
        deletedCount: result.deletedCount
      });
    }

    return res.status(200).json({ success: true, message: 'Message not found in DB', deletedCount: 0 });
  } catch (error) {
    console.error('[ChatController] Error truncating history:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitFeedback = async (req, res) => {
  try {
    const {
      messageId,
      sessionId,
      rating,
      reason = '',
      feedbackText = '',
      answer = '',
      response: rawResponse = '',
      query = ''
    } = req.body;

    if (!rating || !['like', 'dislike', 'up', 'down'].includes(rating)) {
      return res.status(400).json({ success: false, message: 'Valid rating is required' });
    }

    const normalizedRating = (rating === 'like' || rating === 'up') ? 'up' : 'down';

    let targetMessage = null;
    if (messageId && mongoose.Types.ObjectId.isValid(String(messageId))) {
      targetMessage = await Message.findById(messageId);
    }

    let currentUserId = req.user ? (req.user._id || req.user.id) : null;
    let userEmail = req.user ? req.user.email : 'anonymous';

    if (!currentUserId && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.decode(token);
        if (decoded) {
          currentUserId = decoded.id || decoded._id || null;
          userEmail = decoded.email || userEmail;
        }
      } catch (err) {
        // silent fallback
      }
    }

    const safeUserId = (currentUserId && mongoose.Types.ObjectId.isValid(String(currentUserId)))
      ? new mongoose.Types.ObjectId(String(currentUserId))
      : null;

    const finalResponse = targetMessage ? targetMessage.content : (rawResponse || answer || 'N/A');
    const finalReason = reason || feedbackText || '';

    const feedbackDoc = await Feedback.create({
      userId: safeUserId,
      userEmail,
      sessionId: sessionId || null,
      messageId: targetMessage ? targetMessage._id : null,
      query: query || 'N/A',
      response: finalResponse,
      rating: normalizedRating,
      reason: finalReason,
      sources: targetMessage?.sources || []
    });

    if (targetMessage) {
      targetMessage.feedback = {
        rating: normalizedRating,
        reason: finalReason,
        updatedAt: new Date()
      };
      await targetMessage.save();
    }

    return res.status(201).json({
      success: true,
      message: 'Feedback recorded successfully',
      feedbackId: feedbackDoc._id
    });
  } catch (error) {
    console.error('[ChatController] Error submitting feedback:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error saving feedback'
    });
  }
};

exports.listFeedback = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const rating = req.query.rating;

    const filter = {};
    if (rating) {
      if (rating === 'up' || rating === 'like') {
        filter.rating = { $in: ['up', 'like'] };
      } else if (rating === 'down' || rating === 'dislike') {
        filter.rating = { $in: ['down', 'dislike'] };
      }
    }

    const total = await Feedback.countDocuments(filter);
    const feedbackList = await Feedback.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      total,
      data: feedbackList
    });
  } catch (error) {
    console.error('[ChatController] Error listing feedback:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};