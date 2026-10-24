const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const { action, limit = 50, page = 1 } = req.query;
    const filter = {};
    if (action) filter.action = action;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await AuditLog.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      data: logs
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;