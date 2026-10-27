import React, { useState, useMemo } from 'react';
import { Building2, Plus, Trash2, Edit2, Clock, Search, X, CheckCircle2 } from 'lucide-react';

export default function DepartmentsView({
  departments = [],
  documents = [],
  isLoading,
  onOpenCreateDept,
  onEditDept,
  onDeleteDept,
  currentUser = null
}) {
  const isAdmin = currentUser?.role === 'admin';
  const [query, setQuery] = useState('');

  // Count documents per department:
  // 1. Prefer documentCount provided directly by the backend /api/departments response
  // 2. Fall back to counting matching documents if documentCount is missing,
  //    supporting both populated department objects ({ _id }) and raw string IDs.
  const getDocCount = (deptOrId) => {
    const deptObj =
      typeof deptOrId === 'object' && deptOrId !== null
        ? deptOrId
        : departments.find((d) => d._id === deptOrId);

    if (typeof deptObj?.documentCount === 'number') {
      return deptObj.documentCount;
    }

    const deptId = String(deptObj?._id || deptOrId || '');
    if (!deptId || !Array.isArray(documents)) return 0;

    return documents.filter((d) => {
      if (!Array.isArray(d?.departmentIds)) return false;
      return d.departmentIds.some((entry) => {
        if (!entry) return false;
        const entryId = typeof entry === 'object' ? String(entry._id || '') : String(entry);
        return entryId === deptId;
      });
    }).length;
  };

  // Badge text: the department code, or initials of the name when no code exists
  const getBadgeText = (dept) => {
    const code = String(dept?.code || '').trim();
    if (code) return code;
    const initials = String(dept?.name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return initials || '?';
  };

  // "Oct 26, 2026" style date, only when the record really has a valid creation date
  const formatCreated = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Search across name, code, description and aliases
  const filteredDepartments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((dept) => {
      const haystack = [
        dept?.name,
        dept?.code,
        dept?.description,
        ...(Array.isArray(dept?.aliases) ? dept.aliases : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [departments, query]);

  const hasQuery = query.trim().length > 0;

  // Compact summary numbers (always based on all departments, not the search result)
  const stats = useMemo(() => {
    const perDeptCounts = departments.map((d) => getDocCount(d));
    const totalDocs =
      Array.isArray(documents) && documents.length > 0
        ? documents.length
        : perDeptCounts.reduce((sum, n) => sum + n, 0);
    return {
      totalDepartments: departments.length,
      totalDocs,
      withDocs: perDeptCounts.filter((n) => n > 0).length
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments, documents]);

  return (
    <div className="page-container dv-wrap">
      <style>{`
        .dv-toolbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap; margin-bottom: 20px;
        }
        .dv-search-wrap { position: relative; width: 100%; max-width: 350px; }
        .dv-search-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: #64748B; pointer-events: none;
        }
        .dv-search {
          width: 100%; box-sizing: border-box; height: 42px; padding: 0 36px 0 40px;
          border: 1px solid #E5E7EB; border-radius: 8px; background: #FFFFFF;
          font-size: 14px; color: inherit; font-family: inherit;
        }
        .dv-search::placeholder { color: #64748B; }
        .dv-search:focus {
          outline: none; border-color: #2563EB;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
        }
        .dv-search-clear {
          position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
          width: 30px; height: 30px; border: none; background: transparent;
          border-radius: 6px; color: #64748B; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .dv-search-clear:hover { background: #F1F5F9; }

        .dv-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .dv-chip {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
          border: 1px solid #E5E7EB; border-radius: 999px; background: #FFFFFF;
          font-size: 13px; color: #475569; font-weight: 500;
        }
        .dv-chip strong { color: #0F172A; font-weight: 700; }

        /* Compact table */
        .dv-table-wrap {
          background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 10px;
          overflow-x: auto;
        }
        .dv-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .dv-table th {
          text-align: left; padding: 12px 20px; background: #F8FAFC;
          font-size: 12.5px; font-weight: 600; color: #475569; letter-spacing: 0.02em;
          border-bottom: 1px solid #E5E7EB; white-space: nowrap;
        }
        .dv-table td {
          padding: 12px 20px; border-bottom: 1px solid #F1F5F9;
          color: #334155; vertical-align: middle; white-space: nowrap;
        }
        .dv-table tbody tr:last-child td { border-bottom: none; }
        .dv-table tbody tr:hover td { background: #F8FAFC; }
        .dv-dept { display: flex; align-items: center; gap: 12px; min-width: 200px; }
        .dv-tile {
          width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
          background: #EEF2FF; color: #2563EB;
          display: flex; align-items: center; justify-content: center;
        }
        .dv-name { font-weight: 600; color: #0F172A; font-size: 14.5px; }
        .dv-desc {
          font-size: 12.5px; color: #64748B; margin-top: 1px;
          max-width: 340px; overflow: hidden; text-overflow: ellipsis;
        }
        .dv-code {
          display: inline-flex; padding: 3px 10px; border-radius: 6px;
          background: #DBEAFE; color: #1E40AF; font-size: 12.5px; font-weight: 700;
        }
        .dv-num { font-weight: 600; color: #0F172A; }
        .dv-pill {
          display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
          border-radius: 999px; background: #DCFCE7; color: #15803D;
          font-size: 13px; font-weight: 600;
        }
        .dv-actions-cell { text-align: right; width: 1%; }
        .dv-icon-btn {
          width: 34px; height: 34px; border: none; background: transparent;
          border-radius: 8px; color: #475569; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .dv-icon-btn:hover { background: #F1F5F9; color: #0F172A; }
        .dv-icon-btn.danger { color: #DC2626; }
        .dv-icon-btn.danger:hover { background: #FEF2F2; color: #B91C1C; }
        .dv-icon-btn:focus-visible { outline: 2px solid #2563EB; outline-offset: 1px; }
        .dv-sr-only {
          position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip: rect(0 0 0 0); white-space: nowrap;
        }
        @media (max-width: 1000px) { .dv-col-created { display: none; } }
        @media (max-width: 720px)  { .dv-col-status { display: none; } }
      `}</style>

      {/* Header Row */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-subtitle">Organize your college knowledge base by academic departments and curricula.</p>
        </div>

        {isAdmin ? (
          <button
            type="button"
            className="btn-primary-action"
            onClick={onOpenCreateDept}
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>Create Department</span>
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="role-badge user">Viewer</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Admin role required to manage departments</span>
          </div>
        )}
      </div>

      {/* Search + compact summary */}
      {!isLoading && departments.length > 0 && (
        <div className="dv-toolbar">
          <div className="dv-search-wrap">
            <Search size={16} className="dv-search-icon" />
            <input
              type="text"
              className="dv-search"
              placeholder="Search departments by name or code"
              aria-label="Search departments"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {hasQuery && (
              <button
                type="button"
                className="dv-search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="dv-chips">
            <span className="dv-chip">
              <strong>{hasQuery ? `${filteredDepartments.length}/${stats.totalDepartments}` : stats.totalDepartments}</strong>
              {stats.totalDepartments === 1 ? 'department' : 'departments'}
            </span>
            <span className="dv-chip">
              <strong>{stats.totalDocs}</strong>
              {stats.totalDocs === 1 ? 'document' : 'documents'}
            </span>
            <span className="dv-chip">
              <strong>{stats.withDocs}</strong> with documents
            </span>
          </div>
        </div>
      )}

      {/* Departments list */}
      {isLoading ? (
        <div className="empty-placeholder">
          <Clock size={28} className="spin icon-brand-wine" />
          <div className="empty-title">Loading departments...</div>
          <div className="empty-subtext">Fetching department records from college database.</div>
        </div>
      ) : departments.length === 0 ? (
        <div className="empty-placeholder">
          <div className="empty-icon-circle">
            <Building2 size={32} strokeWidth={1.8} />
          </div>
          <div className="empty-title">No departments found</div>
          <div className="empty-subtext">
            Create academic departments (e.g. CSE, ECE, MECH) to categorize curriculum documents.
          </div>
          {isAdmin && (
            <button
              type="button"
              className="btn-primary-action"
              onClick={onOpenCreateDept}
            >
              <Plus size={14} strokeWidth={2.2} />
              <span>Create Department</span>
            </button>
          )}
        </div>
      ) : filteredDepartments.length === 0 ? (
        <div className="empty-placeholder">
          <div className="empty-icon-circle">
            <Search size={28} strokeWidth={1.8} />
          </div>
          <div className="empty-title">No matching departments</div>
          <div className="empty-subtext">Try a different name or code.</div>
          <button
            type="button"
            className="btn-secondary-action"
            onClick={() => setQuery('')}
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="dv-table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Code</th>
                <th>Documents</th>
                <th className="dv-col-status">Status</th>
                <th className="dv-col-created">Created</th>
                {isAdmin && (
                  <th className="dv-actions-cell">
                    <span className="dv-sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredDepartments.map((dept) => {
                const count = getDocCount(dept);
                const description = String(dept.description || '').trim();
                const created = formatCreated(dept.createdAt);

                return (
                  <tr key={dept._id}>
                    <td>
                      <div className="dv-dept">
                        <div className="dv-tile">
                          <Building2 size={18} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="dv-name">{dept.name}</div>
                          {description && <div className="dv-desc" title={description}>{description}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="dv-code">{getBadgeText(dept)}</span>
                    </td>
                    <td className="dv-num">{count}</td>
                    <td className="dv-col-status">
                      <span className="dv-pill">
                        <CheckCircle2 size={14} />
                        Active
                      </span>
                    </td>
                    <td className="dv-col-created">{created || '—'}</td>
                    {isAdmin && (
                      <td className="dv-actions-cell">
                        <button
                          type="button"
                          className="dv-icon-btn"
                          title="Edit department"
                          aria-label={`Edit ${dept.name}`}
                          onClick={() => onEditDept(dept)}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          type="button"
                          className="dv-icon-btn danger"
                          title="Delete department"
                          aria-label={`Delete ${dept.name}`}
                          onClick={() => onDeleteDept(dept)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}