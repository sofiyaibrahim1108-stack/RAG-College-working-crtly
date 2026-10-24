const AuditLog = require('../models/AuditLog');

exports.logAction = async ({ req, action, resourceType, resourceId = null, details = {} }) => {
  try {
    const user = req?.user || null;
    const ip = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    const userAgent = req?.headers?.['user-agent'] || '';

    await AuditLog.create({
      userId: user?._id || user?.id || null,
      userEmail: user?.email || 'anonymous',
      userRole: user?.role || 'user',
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : null,
      details,
      ipAddress: typeof ip === 'string' ? ip.split(',')[0].trim() : '',
      userAgent
    });
  } catch (err) {
    console.error('[AuditLog] Failed to record audit log:', err.message);
  }
};