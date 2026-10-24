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
  Loader2
} from 'lucide-react';
import { getAuditLogs } from '../api';

export default function AuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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
            Real-time audit trail of all administrative actions, document uploads, and authentication events.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="btn-drive-action"
            onClick={() => fetchLogs()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
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

      {/* ── Error Banner (if error occurred) ── */}
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
            gap: '8px'
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Main Content Area ── */}
      {loading && logs.length === 0 ? (
        <div className="empty-placeholder">
          <Loader2 size={26} className="spin" style={{ color: 'var(--primary)' }} />
          <div className="empty-title" style={{ marginTop: '10px' }}>Loading audit logs...</div>
          <div className="empty-subtext">Fetching audit trail records from database.</div>
        </div>
      ) : logs.length === 0 ? (
        <div className="empty-placeholder">
          <div className="empty-icon-circle">
            <ShieldAlert size={28} strokeWidth={1.8} />
          </div>
          <div className="empty-title">No audit events recorded yet</div>
          <div className="empty-subtext">
            {actionFilter
              ? 'Try selecting a different action or clearing the filter.'
              : 'Administrative and security events will be automatically logged here.'}
          </div>
          {actionFilter && (
            <div style={{ marginTop: '14px' }}>
              <button
                type="button"
                className="btn-drive-action"
                onClick={() => {
                  setActionFilter('');
                  setPage(1);
                }}
              >
                Clear Filter
              </button>
            </div>
          )}
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
            <table
              style={{
                width: '100%',
                minWidth: '820px',
                borderCollapse: 'collapse',
                fontSize: '13.5px',
                textAlign: 'left'
              }}
            >
              <thead>
                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    Timestamp
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    User
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    Action
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    Resource
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Details / Targets
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    IP Address
                  </th>
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
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                      }}
                    >
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '13px' }}>
                          {log.userEmail || 'System'}
                        </div>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                          {log.userRole || 'system'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        {getActionBadge(log.action)}
                      </td>
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                        {log.resourceType || '—'}
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
                          title={typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '')}
                        >
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

          {/* ── Pagination Footer ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: 'var(--surface)',
              borderTop: '1px solid var(--border)',
              fontSize: '12.5px',
              color: 'var(--text-secondary)'
            }}
          >
            <span>
              Showing {logs.length} of {totalCount} events
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 8px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  cursor: (page <= 1 || loading) ? 'not-allowed' : 'pointer',
                  opacity: (page <= 1 || loading) ? 0.4 : 1,
                  transition: 'background-color 0.1s ease'
                }}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <span style={{ fontWeight: 500, color: 'var(--text)' }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '5px 8px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  cursor: (page >= totalPages || loading) ? 'not-allowed' : 'pointer',
                  opacity: (page >= totalPages || loading) ? 0.4 : 1,
                  transition: 'background-color 0.1s ease'
                }}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}