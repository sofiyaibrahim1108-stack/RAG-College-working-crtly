import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Database, User, PanelLeft, PanelLeftOpen } from 'lucide-react';

export default function ChatHeader({
  departments = [],
  selectedDepartmentId,
  setSelectedDepartmentId,
  onToggleSidebar,
  isSidebarCollapsed = false,
  activeViewTitle,
  currentUser = null
}) {
  const [kbDropdownOpen, setKbDropdownOpen] = useState(false);
  const kbRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (kbRef.current && !kbRef.current.contains(e.target)) {
        setKbDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter departments accessible to the user
  const userAllowedDeptIds = new Set();
  if (currentUser) {
    if (currentUser.departmentId) {
      userAllowedDeptIds.add(String(currentUser.departmentId));
    }
    if (Array.isArray(currentUser.departmentIds)) {
      currentUser.departmentIds.forEach((d) => {
        const id = d?._id || d;
        if (id) userAllowedDeptIds.add(String(id));
      });
    }
  }

  const isAdmin = currentUser?.role === 'admin';
  const visibleDepartments = isAdmin
    ? departments
    : departments.filter((d) => userAllowedDeptIds.has(String(d._id || d.id)));

  // Separate Academic Departments vs General Categories
  const academicDepts = visibleDepartments.filter((d) => d.type !== 'general');
  const generalCategories = visibleDepartments.filter((d) => d.type === 'general');

  const selectedDept = departments.find((d) => String(d._id || d.id) === String(selectedDepartmentId));
  const kbLabel = selectedDept
    ? (selectedDept.code || selectedDept.name)
    : (isAdmin ? 'All Departments' : 'My Scope');

  return (
    <header className="top-header">
      <div className="header-left">
        {onToggleSidebar && (
          <button
            type="button"
            className={`btn-header-menu-toggle ${!isSidebarCollapsed ? 'hidden-desktop' : ''}`}
            onClick={onToggleSidebar}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle navigation menu"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen size={18} strokeWidth={2} />
            ) : (
              <PanelLeft size={18} strokeWidth={2} />
            )}
          </button>
        )}

        {activeViewTitle && (
          <span className="header-view-title">{activeViewTitle}</span>
        )}
      </div>

      <div className="header-right">
        {/* Department / Knowledge Base Scope Selector */}
        <div style={{ position: 'relative' }} ref={kbRef}>
          <button
            type="button"
            className={`header-pill-btn header-kb-pill ${selectedDepartmentId ? 'active-scope' : ''}`}
            onClick={() => setKbDropdownOpen(!kbDropdownOpen)}
            title={selectedDept ? `Scope: ${selectedDept.name}` : 'Knowledge Base Scope'}
          >
            <Database size={13} className="header-kb-icon" />
            <span className="header-kb-label">{kbLabel}</span>
            <ChevronDown size={12} className="header-chevron-icon" />
          </button>

          {kbDropdownOpen && (
            <div className="header-dropdown-menu right-aligned kb-menu">
              <div className="dropdown-section-title">Knowledge Base Scope</div>
              <div
                className={`dropdown-option ${!selectedDepartmentId ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedDepartmentId(null);
                  setKbDropdownOpen(false);
                }}
              >
                <span>{isAdmin ? 'All Departments' : 'All My Documents + Public'}</span>
                {!selectedDepartmentId && <Check size={13} />}
              </div>

              {/* Academic Departments List */}
              {academicDepts.length > 0 && (
                <>
                  <div className="dropdown-divider" />
                  <div className="dropdown-section-title">Academic Departments</div>
                  {academicDepts.map((dept) => {
                    const deptKey = String(dept._id || dept.id);
                    const isSelected = String(selectedDepartmentId) === deptKey;
                    return (
                      <div
                        key={deptKey}
                        className={`dropdown-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedDepartmentId(deptKey);
                          setKbDropdownOpen(false);
                        }}
                      >
                        <span>{dept.code ? `${dept.code} — ` : ''}{dept.name}</span>
                        {isSelected && <Check size={13} />}
                      </div>
                    );
                  })}
                </>
              )}

              {/* General / Public Categories List */}
              {generalCategories.length > 0 && (
                <>
                  <div className="dropdown-divider" />
                  <div className="dropdown-section-title">General Categories</div>
                  {generalCategories.map((cat) => {
                    const catKey = String(cat._id || cat.id);
                    const isSelected = String(selectedDepartmentId) === catKey;
                    return (
                      <div
                        key={catKey}
                        className={`dropdown-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedDepartmentId(catKey);
                          setKbDropdownOpen(false);
                        }}
                      >
                        <span>{cat.code ? `${cat.code} — ` : ''}{cat.name}</span>
                        {isSelected && <Check size={13} />}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* User Identity Indicator */}
        <div
          className="header-avatar-circle"
          title={currentUser ? `${currentUser.name} (${currentUser.role})` : 'Student Profile'}
        >
          <User size={14} strokeWidth={2.4} color="#FFFFFF" />
        </div>
      </div>
    </header>
  );
}