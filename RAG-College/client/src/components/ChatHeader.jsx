import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Database, User, PanelLeft, PanelLeftOpen } from 'lucide-react';

export default function ChatHeader({
  departments = [],
  selectedDepartmentId,
  setSelectedDepartmentId,
  onToggleSidebar,
  isSidebarCollapsed = false,
  activeViewTitle
}) {
  const [kbDropdownOpen, setKbDropdownOpen] = useState(false);
  const kbRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (kbRef.current && !kbRef.current.contains(e.target)) {
        setKbDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedDept = departments.find((d) => d._id === selectedDepartmentId);
  const kbLabel = selectedDept ? (selectedDept.code || selectedDept.name) : 'All Departments';

  return (
    <header className="top-header">
      <div className="header-left">
        {/* Sidebar Toggle Button (visible on mobile or when desktop sidebar is collapsed) */}
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
                <span>All Departments</span>
                {!selectedDepartmentId && <Check size={13} />}
              </div>

              {departments.length > 0 && (
                <>
                  <div className="dropdown-divider" />
                  <div className="dropdown-section-title">Filter by Department</div>
                  {departments.map((dept) => {
                    const isSelected = selectedDepartmentId === dept._id;
                    return (
                      <div
                        key={dept._id}
                        className={`dropdown-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedDepartmentId(dept._id);
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
            </div>
          )}
        </div>

        {/* Student Avatar Circle */}
        <div className="header-avatar-circle" title="Student Profile">
          <User size={14} strokeWidth={2.4} color="#FFFFFF" />
        </div>
      </div>
    </header>
  );
}
