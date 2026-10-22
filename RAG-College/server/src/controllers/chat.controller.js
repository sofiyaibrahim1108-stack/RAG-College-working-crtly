const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { compiledRagGraph, filterSupportingSources } = require('../services/langgraph/workflow');
const { PipelineTimer } = require('../utils/timer');

// Opens a Server-Sent Events response. Every write is guarded, so a client that
// refreshed or disconnected never crashes the request (the answer is still saved in MongoDB).
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
    // Needed when a compression middleware buffers the response
    if (typeof res.flush === 'function') res.flush();
  };

  const end = () => {
    if (isOpen()) res.end();
  };

  return { send, end };
}

// POST /api/chat - Main RAG chat endpoint
// Streams (SSE) when the client sends { stream: true } or Accept: text/event-stream, plain JSON otherwise.
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

    // 1. Find or create Conversation session
    let conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      conversation = await Conversation.create({
        sessionId,
        title: message.trim().slice(0, 40),
        departmentContext: departmentIds
      });
    } else {
      conversation.updatedAt = new Date();
      await conversation.save();
    }

    // 2. Fetch recent conversation memory
    const rawPreviousMessages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const conversationHistory = rawPreviousMessages.reverse().map((m) => ({
      role: m.role,
      content: m.content
    }));

    // 3. Save User Message in MongoDB
    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: 'user',
      content: message.trim()
    });

    // 4. Build LangGraph Inputs
    const startTime = Date.now();
    const graphInput = {
      question: message.trim(),
      sessionId,
      selectedDepartments: departmentIds,
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

    // 5. Invoke LangGraph (token callbacks are only attached when streaming)
    const graphConfig = {
      configurable: {
        onToken: stream ? (text) => stream.send('token', { text }) : null,
        onReset: stream ? () => stream.send('reset', {}) : null
      }
    };

    const finalState = await compiledRagGraph.invoke(graphInput, graphConfig);
    const totalPipelineMs = Date.now() - startTime;

    // Filter sources cited in the final answer
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

    // 6. DB SAVE IS PROTECTED: Always executes even if client refreshed during generation
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
      userMessageId: userMessage._id,
      assistantMessageId: assistantMessage._id
    };

    // 7. Final result: streamed clients get a closing "done" event, others get plain JSON
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

// GET /api/chat/history/:sessionId
exports.getHistory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(200).json({ success: true, count: 0, data: [] });
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

// GET /api/chat/conversations
exports.listConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find().sort({ updatedAt: -1 }).limit(20);
    return res.status(200).json({ success: true, count: conversations.length, data: conversations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/chat/conversations/:sessionId
exports.deleteConversation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(200).json({ success: true, message: 'Conversation not found or already deleted' });
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

// DELETE /api/chat/history/:sessionId/from/:messageId
exports.truncateHistoryFrom = async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
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