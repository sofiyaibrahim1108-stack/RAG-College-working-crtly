import React from 'react';
import { Building2, Plus, Trash2, Edit2, Clock } from 'lucide-react';

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

  return (
    <div className="page-container">
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

      {/* Departments Grid */}
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
      ) : (
        <div className="dept-grid">
          {departments.map((dept) => {
            const count = getDocCount(dept);

            return (
              <div key={dept._id} className="dept-card">
                <div className="dept-card-body">
                  <div className="dept-card-top">
                    <span className="dept-card-code">{dept.code}</span>
                    {isAdmin && (
                      <div className="dept-card-actions">
                        <button
                          type="button"
                          className="btn-card-action"
                          title="Edit Department"
                          aria-label="Edit department"
                          onClick={() => onEditDept(dept)}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-card-action danger"
                          title="Delete Department"
                          aria-label="Delete department"
                          onClick={() => onDeleteDept(dept)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  <h3 className="dept-card-name">{dept.name}</h3>
                  <p className="dept-card-desc">
                    {dept.description || 'Academic department knowledge repository and curriculum files.'}
                  </p>
                </div>

                <div className="dept-card-bottom">
                  <span className="dept-doc-count">
                    {count} {count === 1 ? 'Document' : 'Documents'}
                  </span>
                  <span className="dept-active-badge">Active</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
