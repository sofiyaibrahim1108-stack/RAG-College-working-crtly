import React, { useState, useEffect, useCallback } from 'react';
import {
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
  MessageSquareQuote,
  ShieldAlert,
  UserPlus,
  UserCog,
  UserMinus,
  Power,
  Activity
} from 'lucide-react';
import { getAuditLogs, getFeedbackLogs } from '../api';

/* ------------------------------------------------------------------
   Styles (kept in this file so no separate CSS is needed).
   Colours read your existing CSS variables first, with fallbacks,
   so light / dark themes keep working.
------------------------------------------------------------------ */
const AL_CSS = `
.al-page {
  --al-text: var(--text, #0f172a);
  --al-muted: var(--text-secondary, #64748b);
  --al-faint: var(--text-muted, #94a3b8);
  --al-border: var(--border, #e2e8f0);
  --al-surface: var(--surface, #ffffff);
  --al-subtle: var(--surface-hover, #f8fafc);
  --al-primary: var(--primary, #2563eb);
  --al-ring: rgba(37, 99, 235, .18);

  --al-green: var(--status-ready, #059669);
  --al-green-bg: var(--status-ready-bg, #ecfdf5);
  --al-green-bd: var(--status-ready-border, #a7f3d0);
  --al-red: var(--danger, #dc2626);
  --al-red-bg: var(--danger-light, #fef2f2);
  --al-red-bd: var(--danger-border, #fecaca);
  --al-blue: var(--primary, #2563eb);
  --al-blue-bg: var(--primary-light, #eff6ff);
  --al-blue-bd: var(--primary-border, #bfdbfe);
  --al-amber: var(--status-processing, #b45309);
  --al-amber-bg: var(--status-processing-bg, #fffbeb);
  --al-amber-bd: var(--status-processing-border, #fde68a);
  --al-violet: #7c3aed;
  --al-violet-bg: rgba(124, 58, 237, .10);
  --al-violet-bd: rgba(124, 58, 237, .28);
  --al-slate: var(--text-secondary, #475569);
  --al-slate-bg: var(--surface-hover, #f1f5f9);
  --al-slate-bd: var(--border, #e2e8f0);
}

@keyframes al-spin { to { transform: rotate(360deg); } }
.al-spin { animation: al-spin .8s linear infinite; }

/* Header button */
.al-btn {
  display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px;
  border: 1px solid var(--al-border); border-radius: 10px; background: var(--al-surface);
  color: var(--al-text); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
  transition: background .12s, border-color .12s, box-shadow .12s;
}
.al-btn:hover:not(:disabled) { background: var(--al-subtle); }
.al-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--al-ring); }
.al-btn:disabled { opacity: .6; cursor: not-allowed; }

/* Tabs */
.al-tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--al-border); }
.al-tab {
  position: relative; padding: 10px 14px; margin-bottom: -1px; border: none; background: none;
  border-bottom: 2px solid transparent; font: inherit; font-size: 14px; font-weight: 500;
  color: var(--al-muted); cursor: pointer; transition: color .12s, border-color .12s;
}
.al-tab:hover { color: var(--al-text); }
.al-tab.active { color: var(--al-primary); font-weight: 600; border-bottom-color: var(--al-primary); }
.al-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--al-ring); border-radius: 6px; }

/* Card */
.al-card {
  background: var(--al-surface); border: 1px solid var(--al-border); border-radius: 12px;
  overflow: hidden; box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
}
.al-toolbar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 16px; border-bottom: 1px solid var(--al-border);
}
.al-count { margin-left: auto; font-size: 13px; color: var(--al-muted); }
.al-select {
  height: 38px; min-width: 170px; padding: 0 34px 0 12px;
  border: 1px solid var(--al-border); border-radius: 10px;
  background: var(--al-surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
  font: inherit; font-size: 13.5px; color: var(--al-text); cursor: pointer;
  appearance: none; -webkit-appearance: none; outline: none;
  transition: border-color .12s, box-shadow .12s;
}
.al-select:hover { border-color: var(--al-faint); }
.al-select:focus { border-color: var(--al-primary); box-shadow: 0 0 0 3px var(--al-ring); }
.al-link {
  border: none; background: none; padding: 0 4px; font: inherit; font-size: 13px; font-weight: 600;
  color: var(--al-primary); cursor: pointer;
}
.al-link:hover { text-decoration: underline; }

/* Table */
.al-table-wrap { overflow-x: auto; transition: opacity .15s; }
.al-table-wrap.dim { opacity: .55; pointer-events: none; }
.al-table { width: 100%; min-width: 860px; border-collapse: collapse; text-align: left; font-size: 13.5px; }
.al-table th {
  padding: 11px 16px; background: var(--al-subtle); border-bottom: 1px solid var(--al-border);
  font-size: 12.5px; font-weight: 600; color: var(--al-muted); white-space: nowrap;
  text-transform: none; letter-spacing: 0;
}
.al-table td { padding: 13px 16px; border-bottom: 1px solid var(--al-border); vertical-align: middle; }
.al-table tbody tr:last-child td { border-bottom: none; }
.al-table tbody tr:hover td { background: var(--al-subtle); }
.nw { white-space: nowrap; }

.al-date { font-size: 13px; font-weight: 500; color: var(--al-text); }
.al-time { margin-top: 1px; font-size: 12px; color: var(--al-muted); }

.al-user { display: flex; align-items: center; gap: 10px; min-width: 0; }
.al-avatar {
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--al-blue-bg); color: var(--al-blue); font-size: 11.5px; font-weight: 700;
}
.al-avatar.muted { background: var(--al-slate-bg); color: var(--al-faint); }
.al-user-email { font-size: 13.5px; font-weight: 600; color: var(--al-text); }
.al-user-email.muted { color: var(--al-muted); font-weight: 500; }
.al-role { margin-top: 2px; font-size: 12px; color: var(--al-muted); text-transform: capitalize; }

.al-resource { font-size: 13.5px; font-weight: 500; color: var(--al-text); }
.al-ip { font-size: 13px; color: var(--al-muted); }
.al-ip.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }

/* Badges */
.al-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px;
  border: 1px solid; border-radius: 999px; font-size: 12.5px; font-weight: 600; line-height: 1.4; white-space: nowrap;
}
.al-badge.green  { background: var(--al-green-bg);  color: var(--al-green);  border-color: var(--al-green-bd); }
.al-badge.red    { background: var(--al-red-bg);    color: var(--al-red);    border-color: var(--al-red-bd); }
.al-badge.blue   { background: var(--al-blue-bg);   color: var(--al-blue);   border-color: var(--al-blue-bd); }
.al-badge.amber  { background: var(--al-amber-bg);  color: var(--al-amber);  border-color: var(--al-amber-bd); }
.al-badge.violet { background: var(--al-violet-bg); color: var(--al-violet); border-color: var(--al-violet-bd); }
.al-badge.slate  { background: var(--al-slate-bg);  color: var(--al-slate);  border-color: var(--al-slate-bd); }

/* Expandable text cell */
.al-clip {
  display: block; max-width: 360px; padding: 0; border: none; background: none; text-align: left;
  font: inherit; font-size: 13px; color: var(--al-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.al-clip.long { cursor: pointer; }
.al-clip.long:hover { color: var(--al-text); }
.al-clip.long:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--al-ring); border-radius: 4px; }
.al-clip.open { white-space: normal; overflow: visible; word-break: break-word; }
.al-clip.danger { color: var(--al-text); }
.al-clip.dash { color: var(--al-faint); }

/* Footer / pager */
.al-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 12px 16px; border-top: 1px solid var(--al-border); background: var(--al-subtle);
  font-size: 13px; color: var(--al-muted);
}
.al-pager { display: flex; align-items: center; gap: 10px; }
.al-pager-label { font-weight: 500; color: var(--al-text); min-width: 88px; text-align: center; }
.al-icon-btn {
  width: 34px; height: 34px; border: 1px solid var(--al-border); border-radius: 8px;
  background: var(--al-surface); color: var(--al-text);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .12s, border-color .12s;
}
.al-icon-btn:hover:not(:disabled) { background: var(--al-slate-bg); border-color: var(--al-faint); }
.al-icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--al-ring); }
.al-icon-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Alerts + empty */
.al-alert {
  display: flex; align-items: flex-start; gap: 10px; margin-bottom: 16px; padding: 12px 14px;
  border: 1px solid var(--al-red-bd); border-radius: 10px; background: var(--al-red-bg);
  color: var(--al-red); font-size: 13.5px; line-height: 1.5;
}
.al-alert svg { flex-shrink: 0; margin-top: 2px; }
.al-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 56px 20px; text-align: center;
}
.al-empty-icon {
  width: 52px; height: 52px; margin-bottom: 6px; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  background: var(--al-slate-bg); color: var(--al-faint);
}
.al-empty-title { font-size: 15px; font-weight: 600; color: var(--al-text); }
.al-empty-sub { max-width: 380px; font-size: 13.5px; line-height: 1.5; color: var(--al-muted); }

@media (prefers-reduced-motion: reduce) {
  .al-spin { animation-duration: 2s; }
}
`;

/* ------------------------------------------------------------------
   Helpers
------------------------------------------------------------------ */
const ACTION_META = {
  LOGIN: { label: 'Login', icon: LogIn, tone: 'blue' },
  DOCUMENT_UPLOAD: { label: 'Upload', icon: Upload, tone: 'green' },
  DOCUMENT_DELETE: { label: 'Delete', icon: Trash2, tone: 'red' },
  USER_CREATE: { label: 'User created', icon: UserPlus, tone: 'green' },
  USER_UPDATE: { label: 'User updated', icon: UserCog, tone: 'amber' },
  USER_DELETE: { label: 'User deleted', icon: UserMinus, tone: 'red' },
  USER_STATUS_CHANGE: { label: 'Status change', icon: Power, tone: 'amber' },
  DEPARTMENT_CREATE: { label: 'Department created', icon: Layers, tone: 'violet' },
  DEPARTMENT_UPDATE: { label: 'Department updated', icon: Layers, tone: 'violet' },
  DEPARTMENT_DELETE: { label: 'Department deleted', icon: Layers, tone: 'red' }
};

function humanizeAction(action) {
  if (!action) return 'Unknown';
  const text = String(action).toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDateParts(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return { date: '—', time: '' };
  return {
    date: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  };
}

function formatIp(ip) {
  if (!ip) return { text: 'Internal', mono: false };
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') {
    return { text: 'localhost', mono: false };
  }
  return { text: ip.replace('::ffff:', ''), mono: true };
}

function getInitials(value) {
  if (!value) return 'SY';
  const local = String(value).split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').trim();
  const parts = local.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function DateCell({ value }) {
  const { date, time } = formatDateParts(value);
  return (
    <>
      <div className="al-date">{date}</div>
      {time && <div className="al-time">{time}</div>}
    </>
  );
}

function ExpandableText({ text, tone = '' }) {
  const [open, setOpen] = useState(false);
  const value = text == null ? '' : String(text);
  const isDash = value === '—' || value === '';
  const isLong = value.length > 46;

  if (isDash) return <span className="al-clip dash">—</span>;

  return (
    <button
      type="button"
      className={`al-clip${isLong ? ' long' : ''}${open ? ' open' : ''}${tone ? ` ${tone}` : ''}`}
      onClick={() => isLong && setOpen((o) => !o)}
      title={isLong ? (open ? 'Click to collapse' : 'Click to expand') : undefined}
      tabIndex={isLong ? 0 : -1}
      style={{ cursor: isLong ? 'pointer' : 'default' }}
    >
      {value}
    </button>
  );
}

function Pager({ shown, total, noun, page, totalPages, loading, onPrev, onNext }) {
  return (
    <div className="al-footer">
      <span>
        Showing {shown} of {total} {noun}
      </span>
      <div className="al-pager">
        <button
          type="button"
          className="al-icon-btn"
          onClick={onPrev}
          disabled={page <= 1 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="al-pager-label">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="al-icon-btn"
          onClick={onNext}
          disabled={page >= totalPages || loading}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="al-empty">
      <div className="al-empty-icon">
        <Icon size={24} strokeWidth={1.8} />
      </div>
      <div className="al-empty-title">{title}</div>
      {subtitle && <div className="al-empty-sub">{subtitle}</div>}
    </div>
  );
}

function LoadingState({ label }) {
  return (
    <div className="al-empty">
      <Loader2 size={26} className="al-spin" style={{ color: 'var(--al-primary)' }} />
      <div className="al-empty-title" style={{ marginTop: 8 }}>{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
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
    const meta = ACTION_META[action] || { label: humanizeAction(action), icon: Activity, tone: 'slate' };
    const Icon = meta.icon;
    return (
      <span className={`al-badge ${meta.tone}`}>
        <Icon size={13} strokeWidth={2.2} />
        <span>{meta.label}</span>
      </span>
    );
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

  const isRefreshing = loading || feedbackLoading;

  return (
    <div className="page-container al-page">
      <style>{AL_CSS}</style>

      {/* ── Page Header ── */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Security &amp; Audit Logs</h1>
          <p className="page-subtitle">
            Audit trail of administrative events, document modifications, and student feedback responses.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            type="button"
            className="al-btn"
            onClick={() => (activeTab === 'security' ? fetchLogs() : fetchFeedback())}
            disabled={isRefreshing}
          >
            <RefreshCw size={15} className={isRefreshing ? 'al-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="al-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'security'}
          className={`al-tab ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => { setActiveTab('security'); setPage(1); }}
        >
          Security logs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'feedback'}
          className={`al-tab ${activeTab === 'feedback' ? 'active' : ''}`}
          onClick={() => { setActiveTab('feedback'); setFeedbackPage(1); }}
        >
          User feedback &amp; responses
        </button>
      </div>

      {error && (
        <div className="al-alert" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── TAB 1: SECURITY LOGS ── */}
      {activeTab === 'security' && (
        <div className="al-card">
          <div className="al-toolbar">
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="al-select"
            >
              <option value="">All actions</option>
              <option value="DOCUMENT_UPLOAD">Uploads</option>
              <option value="DOCUMENT_DELETE">Deletions</option>
              <option value="LOGIN">User logins</option>
              <option value="USER_STATUS_CHANGE">User status changes</option>
              <option value="DEPARTMENT_CREATE">Department changes</option>
            </select>

            {actionFilter && (
              <button
                type="button"
                className="al-link"
                onClick={() => {
                  setActionFilter('');
                  setPage(1);
                }}
              >
                Clear filter
              </button>
            )}

            <span className="al-count">
              {totalCount} total {totalCount === 1 ? 'event' : 'events'}
            </span>
          </div>

          {loading && logs.length === 0 ? (
            <LoadingState label="Loading audit logs…" />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title={actionFilter ? 'No events match this filter' : 'No audit events recorded yet'}
              subtitle={
                actionFilter
                  ? 'Try a different action type or clear the filter.'
                  : 'Administrative activity such as logins, uploads and deletions will appear here.'
              }
            />
          ) : (
            <>
              <div className={`al-table-wrap${loading ? ' dim' : ''}`}>
                <table className="al-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Details</th>
                      <th>IP address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, idx) => {
                      const ip = formatIp(log.ipAddress);
                      const isSystem = !log.userEmail;
                      return (
                        <tr key={log._id || idx}>
                          <td className="nw">
                            <DateCell value={log.createdAt} />
                          </td>
                          <td className="nw">
                            <div className="al-user">
                              <div className={`al-avatar${isSystem ? ' muted' : ''}`}>
                                {getInitials(log.userEmail)}
                              </div>
                              <div>
                                <div className={`al-user-email${isSystem ? ' muted' : ''}`}>
                                  {log.userEmail || 'System'}
                                </div>
                                <div className="al-role">{log.userRole || 'system'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="nw">{getActionBadge(log.action)}</td>
                          <td className="nw">
                            <span className="al-resource">{log.resourceType || '—'}</span>
                          </td>
                          <td>
                            <ExpandableText text={formatDetails(log.details)} />
                          </td>
                          <td className="nw">
                            <span className={`al-ip${ip.mono ? ' mono' : ''}`}>{ip.text}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pager
                shown={logs.length}
                total={totalCount}
                noun="events"
                page={page}
                totalPages={totalPages}
                loading={loading}
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
            </>
          )}
        </div>
      )}

      {/* ── TAB 2: USER FEEDBACK & RESPONSES ── */}
      {activeTab === 'feedback' && (
        <div className="al-card">
          <div className="al-toolbar">
            <select
              aria-label="Filter by rating"
              value={feedbackFilter}
              onChange={(e) => {
                setFeedbackFilter(e.target.value);
                setFeedbackPage(1);
              }}
              className="al-select"
            >
              <option value="">All ratings</option>
              <option value="up">Helpful</option>
              <option value="down">Not helpful</option>
            </select>

            {feedbackFilter && (
              <button
                type="button"
                className="al-link"
                onClick={() => {
                  setFeedbackFilter('');
                  setFeedbackPage(1);
                }}
              >
                Clear filter
              </button>
            )}

            <span className="al-count">{feedbackTotalCount} total responses</span>
          </div>

          {feedbackLoading && feedbackLogs.length === 0 ? (
            <LoadingState label="Loading feedback entries…" />
          ) : feedbackLogs.length === 0 ? (
            <EmptyState
              icon={MessageSquareQuote}
              title={feedbackFilter ? 'No responses match this filter' : 'No user feedback submitted yet'}
              subtitle={
                feedbackFilter
                  ? 'Try a different rating or clear the filter.'
                  : 'When users rate answers with thumbs up or down in chat, they will show up here.'
              }
            />
          ) : (
            <>
              <div className={`al-table-wrap${feedbackLoading ? ' dim' : ''}`}>
                <table className="al-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>User</th>
                      <th>Rating</th>
                      <th>Reason</th>
                      <th>Answer snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedbackLogs.map((item, idx) => {
                      const isGood = item.rating === 'up' || item.rating === 'like';
                      const who = item.userEmail || 'Anonymous';
                      const isAnon = !item.userEmail || String(item.userEmail).toLowerCase() === 'anonymous';
                      const reason = item.reason || item.feedbackText || (isGood ? '—' : 'No specific reason provided');

                      return (
                        <tr key={item._id || idx}>
                          <td className="nw">
                            <DateCell value={item.createdAt} />
                          </td>
                          <td className="nw">
                            <div className="al-user">
                              <div className={`al-avatar${isAnon ? ' muted' : ''}`}>
                                {isAnon ? '?' : getInitials(who)}
                              </div>
                              <div className={`al-user-email${isAnon ? ' muted' : ''}`}>
                                {isAnon ? 'Anonymous' : who}
                              </div>
                            </div>
                          </td>
                          <td className="nw">
                            {isGood ? (
                              <span className="al-badge green">
                                <ThumbsUp size={13} />
                                <span>Helpful</span>
                              </span>
                            ) : (
                              <span className="al-badge red">
                                <ThumbsDown size={13} />
                                <span>Not helpful</span>
                              </span>
                            )}
                          </td>
                          <td>
                            <ExpandableText text={reason} tone={isGood ? '' : 'danger'} />
                          </td>
                          <td>
                            <ExpandableText text={item.answer || item.response || '—'} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pager
                shown={feedbackLogs.length}
                total={feedbackTotalCount}
                noun="responses"
                page={feedbackPage}
                totalPages={feedbackTotalPages}
                loading={feedbackLoading}
                onPrev={() => setFeedbackPage((p) => Math.max(1, p - 1))}
                onNext={() => setFeedbackPage((p) => Math.min(feedbackTotalPages, p + 1))}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}