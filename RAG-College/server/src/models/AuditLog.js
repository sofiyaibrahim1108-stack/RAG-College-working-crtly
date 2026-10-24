const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    userEmail: {
      type: String,
      default: 'system/anonymous'
    },
    userRole: {
      type: String,
      default: 'user'
    },
    action: {
      type: String,
      required: true,
      enum: [
        'LOGIN',
        'LOGOUT',
        'DOCUMENT_UPLOAD',
        'DOCUMENT_DELETE',
        'DOCUMENT_REUPLOAD',
        'DEPARTMENT_CREATE',
        'DEPARTMENT_UPDATE',
        'DEPARTMENT_DELETE',
        'USER_CREATE',
        'USER_UPDATE',
        'USER_STATUS_CHANGE',
        'USER_DELETE',
        'CHAT_QUERY'
      ]
    },
    resourceType: {
      type: String,
      enum: ['Document', 'Department', 'User', 'Chat', 'Auth', 'System'],
      required: true
    },
    resourceId: {
      type: String,
      default: null
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    ipAddress: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ userId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);