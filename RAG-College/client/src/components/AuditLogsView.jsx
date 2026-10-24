import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldAlert, 
  RefreshCw, 
  Upload, 
  Trash2, 
  LogIn, 
  Layers, 
  ChevronLeft, 
  ChevronRight,
  AlertCircle,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  MessageSquareQuote
} from 'lucide-react';
import { getAuditLogs, getFeedbackLogs } from '../api';

export default function AuditLogsView() {
  const [activeTab, setActiveTab] = useState('security'); // 'security' | 'feedback'

  // Security Logs State
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Feedback State
  const [feedbackLogs, setFeedbackLogs] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState('');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotalPages, setFeedbackTotalPages] = useState(1);
  const [feedbackTotalCount, setFeedbackTotalCount] = useState(0);

  // Fetch Security Logs
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = { page, limit: 25 };
      if (actionFilter) params.action = actionFilter;

      const res = await getAuditLogs(params);
      if (res?.success) {
        setLogs(res.data || []);
        setTotalCount(res.total || 0);
        setTotalPages(Math.ceil((res.total || 0) / 25) || 1);
      } else {
        setError(res?.message || 'Unable to retrieve audit logs. Please try again.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Unable to retrieve audit logs. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  // Fetch Feedback Logs
  const fetchFeedback = useCallback(async () => {
    try {
      setFeedbackLoading(true);
      setError(null);
      const params = { page: feedbackPage, limit: 25 };
      if (feedbackFilter) params.rating = feedbackFilter;

      const res = await getFeedbackLogs(params);
      if (res?.success) {
        setFeedbackLogs(res.data || []);
        setFeedbackTotalCount(res.total || 0);
        setFeedbackTotalPages(Math.ceil((res.total || 0) / 25) || 1);
      } else {
        setError(res?.message || 'Unable to retrieve feedback logs.');
      }
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Unable to retrieve feedback logs.');
    } finally {
      setFeedbackLoading(false);
    }
  }, [feedbackPage, feedbackFilter]);

  useEffect(() => {
    if (activeTab === 'security') {
      fetchLogs();
    } else {
      fetchFeedback();
    }
  }, [activeTab, fetchLogs, fetchFeedback]);

  const getActionBadge = (action) => {
    const badgeBaseStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
      lineHeight: '1.4'
    };

    switch (action) {
      case 'DOCUMENT_UPLOAD':
        return (
          <span
            style={{
              ...badgeBaseStyle,
              backgroundColor: 'var(--status-ready-bg)',
              color: 'var(--status-ready)',
              border: '1px solid var(--status-ready-border)'
            }}
          >
            <Upload size={12} strokeWidth={2.2} />
            <span>Upload</span>
          </span>
        );
      case 'DOCUMENT_DELETE':
        return (
          <span
            style={{
              ...badgeBaseStyle,
              backgroundColor: 'var(--danger-light)',
              color: 'var(--danger)',
              border: '1px solid var(--danger-border)'
            }}
          >
            <Trash2 size={12} strokeWidth={2.2} />
            <span>Delete</span>
          </span>
        );
      case 'LOGIN':
        return (
          <span
            style={{
              ...badgeBaseStyle,
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              border: '1px solid var(--primary-border)'
            }}
          >
            <LogIn size={12} strokeWidth={2.2} />
            <span>Login</span>
          </span>
        );
      case 'DEPARTMENT_CREATE':
      case 'DEPARTMENT_UPDATE':
      case 'DEPARTMENT_DELETE':
        return (
          <span
            style={{
              ...badgeBaseStyle,
              backgroundColor: 'var(--status-processing-bg)',
              color: 'var(--status-processing)',
              border: '1px solid var(--status-processing-border)'
            }}
          >
            <Layers size={12} strokeWidth={2.2} />
            <span>Department</span>
          </span>
        );
      default:
        return (
          <span
            style={{
              ...badgeBaseStyle,
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)'
            }}
          >
            {action || 'UNKNOWN'}
          </span>
        );
    }
  };

  const formatDetails = (details) => {
    if (!details || (typeof details === 'object' && Object.keys(details).length === 0)) return '—';
    if (typeof details === 'string') return details;
    if (details.filenames && Array.isArray(details.filenames)) {
      return `Files: ${details.filenames.join(', ')}`;
    }
    if (details.deletedFilename) {
      return `Deleted file: ${details.deletedFilename}`;
    }
    if (details.name) {
      return `Name: ${details.name}${details.code ? ` (${details.code})` : ''}`;
    }
    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  };

  return (
    <div className="page-container">
      {/* ── Page Header ── */}
      <div className="page-header-row">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={24} style={{ color: 'var(--primary)' }} />
            <h1 className="page-title">Security &amp; Audit Logs</h1>
          </div>
          <p className="page-subtitle">
            Audit trail of administrative events, document modifications, and student feedback responses.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="btn-drive-action"
            onClick={() => (activeTab === 'security' ? fetchLogs() : fetchFeedback())}
            disabled={loading || feedbackLoading}
          >
            <RefreshCw size={14} className={(loading || feedbackLoading) ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Tabs Header ── */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
        <button
          type="button"
          onClick={() => { setActiveTab('security'); setPage(1); }}
          style={{
            padding: '8px 16px',
            fontSize: '13.5px',
            fontWeight: 600,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderBottom: activeTab === 'security' ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === 'security' ? 'var(--primary)' : 'var(--text-secondary)'
          }}
        >
          Security Logs
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('feedback'); setFeedbackPage(1); }}
          style={{
            padding: '8px 16px',
            fontSize: '13.5px',
            fontWeight: 600,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            borderBottom: activeTab === 'feedback' ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === 'feedback' ? 'var(--primary)' : 'var(--text-secondary)'
          }}
        >
          User Feedback &amp; Responses
        </button>
      </div>

      {/* ── TAB 1: SECURITY LOGS ── */}
      {activeTab === 'security' && (
        <>
          <div className="filter-bar">
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="filter-select"
            >
              <option value="">All Actions</option>
              <option value="DOCUMENT_UPLOAD">Uploads</option>
              <option value="DOCUMENT_DELETE">Deletions</option>
              <option value="LOGIN">User Logins</option>
              <option value="USER_STATUS_CHANGE">User Status Changes</option>
              <option value="DEPARTMENT_CREATE">Department Changes</option>
            </select>

            {actionFilter && (
              <button
                type="button"
                onClick={() => {
                  setActionFilter('');
                  setPage(1);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  padding: '0 4px'
                }}
              >
                Clear Filter
              </button>
            )}

            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              {totalCount} total {totalCount === 1 ? 'event' : 'events'}
            </span>
          </div>

          {error && (
            <div
              style={{
                padding: '12px 16px',
                backgroundColor: 'var(--danger-light)',
                border: '1px solid var(--danger-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--danger)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {loading && logs.length === 0 ? (
            <div className="empty-placeholder">
              <Loader2 size={26} className="spin" style={{ color: 'var(--primary)' }} />
              <div className="empty-title" style={{ marginTop: '10px' }}>Loading audit logs...</div>
            </div>
          ) : logs.length === 0 ? (
            <div className="empty-placeholder">
              <div className="empty-icon-circle">
                <ShieldAlert size={28} strokeWidth={1.8} />
              </div>
              <div className="empty-title">No audit events recorded yet</div>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-xs)'
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', fontSize: '13.5px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Timestamp</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>User</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Action</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Resource</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Details / Targets</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, idx) => {
                      const isLast = idx === logs.length - 1;
                      return (
                        <tr
                          key={log._id || idx}
                          style={{
                            borderBottom: isLast ? 'none' : '1px solid var(--border)',
                            transition: 'background-color 0.1s ease'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                        >
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '13px' }}>{log.userEmail || 'System'}</div>
                            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{log.userRole || 'system'}</span>
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{getActionBadge(log.action)}</td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>{log.resourceType || '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '12.5px', color: 'var(--text-secondary)', maxWidth: '380px' }}>
                            <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {formatDetails(log.details)}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                            {log.ipAddress || 'internal/direct'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <span>Showing {logs.length} of {totalCount} events</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="btn-drive-action">
                    <ChevronLeft size={15} />
                  </button>
                  <span style={{ fontWeight: 500, color: 'var(--text)' }}>Page {page} of {totalPages}</span>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="btn-drive-action">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: USER FEEDBACK & RESPONSES ── */}
      {activeTab === 'feedback' && (
        <>
          <div className="filter-bar">
            <select
              aria-label="Filter by rating"
              value={feedbackFilter}
              onChange={(e) => {
                setFeedbackFilter(e.target.value);
                setFeedbackPage(1);
              }}
              className="filter-select"
            >
              <option value="">All Ratings</option>
              <option value="up">Helpful (👍)</option>
              <option value="down">Not Helpful (👎)</option>
            </select>

            {feedbackFilter && (
              <button
                type="button"
                onClick={() => {
                  setFeedbackFilter('');
                  setFeedbackPage(1);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  padding: '0 4px'
                }}
              >
                Clear Filter
              </button>
            )}

            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              {feedbackTotalCount} total responses
            </span>
          </div>

          {feedbackLoading && feedbackLogs.length === 0 ? (
            <div className="empty-placeholder">
              <Loader2 size={26} className="spin" style={{ color: 'var(--primary)' }} />
              <div className="empty-title" style={{ marginTop: '10px' }}>Loading feedback entries...</div>
            </div>
          ) : feedbackLogs.length === 0 ? (
            <div className="empty-placeholder">
              <div className="empty-icon-circle">
                <MessageSquareQuote size={28} strokeWidth={1.8} />
              </div>
              <div className="empty-title">No user feedback submitted yet</div>
              <div className="empty-subtext">When users rate answers using 👍 or 👎 in chat, they will show up here.</div>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                boxShadow: 'var(--shadow-xs)'
              }}
            >
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', fontSize: '13.5px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Date</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>User</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Rating</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Reason / Issue</th>
                      <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Generated Answer Snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackLogs.map((item, idx) => {
                      const isLast = idx === feedbackLogs.length - 1;
                      const isGood = item.rating === 'up' || item.rating === 'like';

                      return (
                        <tr
                          key={item._id || idx}
                          style={{
                            borderBottom: isLast ? 'none' : '1px solid var(--border)',
                            transition: 'background-color 0.1s ease'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                        >
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {new Date(item.createdAt).toLocaleString()}
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '13px' }}>
                              {item.userEmail || 'Anonymous'}
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            {isGood ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '3px 8px',
                                  borderRadius: '12px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  backgroundColor: '#E8F5E9',
                                  color: '#2E7D32',
                                  border: '1px solid #C8E6C9'
                                }}
                              >
                                <ThumbsUp size={12} />
                                <span>Helpful</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '3px 8px',
                                  borderRadius: '12px',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  backgroundColor: '#FFEBEE',
                                  color: '#C62828',
                                  border: '1px solid #FFCDD2'
                                }}
                              >
                                <ThumbsDown size={12} />
                                <span>Not Helpful</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12.5px', color: isGood ? 'var(--text-muted)' : 'var(--danger)', fontWeight: isGood ? 400 : 500 }}>
                            {item.reason || item.feedbackText || (isGood ? '—' : 'No specific reason provided')}
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '12.5px', color: 'var(--text-secondary)', maxWidth: '380px' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={item.answer || item.response || ''}
                            >
                              {item.answer || item.response || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Feedback Pagination */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                <span>Showing {feedbackLogs.length} of {feedbackTotalCount} responses</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button type="button" onClick={() => setFeedbackPage((p) => Math.max(1, p - 1))} disabled={feedbackPage <= 1 || feedbackLoading} className="btn-drive-action">
                    <ChevronLeft size={15} />
                  </button>
                  <span style={{ fontWeight: 500, color: 'var(--text)' }}>Page {feedbackPage} of {feedbackTotalPages}</span>
                  <button type="button" onClick={() => setFeedbackPage((p) => Math.min(feedbackTotalPages, p + 1))} disabled={feedbackPage >= feedbackTotalPages || feedbackLoading} className="btn-drive-action">
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}