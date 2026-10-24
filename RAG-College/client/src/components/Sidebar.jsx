import React, { useState, useRef, useEffect } from 'react';
import {
  GraduationCap,
  MessageSquare,
  Search,
  Building2,
  Settings,
  BookOpen,
  User,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  LogIn,
  Users,
  ShieldAlert
} from 'lucide-react';

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
  const diffHour = Math.floor(diffMin / 24);
  if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Sidebar({
  activeView,
  setActiveView,
  conversations = [],
  activeConvId,
  setActiveConvId,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  pinnedIds = [],
  onTogglePinConversation,
  searchQuery,
  setSearchQuery,
  documentCount = 0,
  departmentCount = 0,
  onOpenSettings,
  onOpenDrive,
  isMobileOpen = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
  currentUser = null,
  onOpenAuth,
  onLogout
}) {
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const searchInputRef = useRef(null);
  const menuRef = useRef(null);

  // Close 3-dot dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showSearchInput && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearchInput]);

  const filteredConversations = conversations.filter((c) =>
    (c.title || '').toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  const pinnedConversations = filteredConversations.filter((c) => pinnedIds.includes(c.id));
  const recentConversations = filteredConversations.filter((c) => !pinnedIds.includes(c.id));

  const handleStartRename = (conv, e) => {
    e.stopPropagation();
    setMenuOpenId(null);
    setRenamingId(conv.id);
    setRenameValue(conv.title || '');
  };

  const handleSaveRename = (convId) => {
    if (renameValue.trim() && onRenameConversation) {
      onRenameConversation(convId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleSelectConv = (convId) => {
    setActiveView('chat');
    setActiveConvId(convId);
    if (onCloseMobile) onCloseMobile();
  };

  const handleNavClick = (view) => {
    setActiveView(view);
    if (onCloseMobile) onCloseMobile();
  };

  const renderChatItem = (conv, isPinnedItem = false) => {
    const isActive = activeView === 'chat' && activeConvId === conv.id;
    const isEditing = renamingId === conv.id;
    const isPinned = pinnedIds.includes(conv.id);

    return (
      <div
        key={conv.id}
        className={`history-item ${isActive ? 'active' : ''}`}
        onClick={() => {
          if (!isEditing) {
            handleSelectConv(conv.id);
          }
        }}
      >
        <div className="history-item-left">
          {isPinnedItem ? (
            <Pin size={15} strokeWidth={2} className="history-chat-icon pinned" />
          ) : (
            <MessageSquare size={15} strokeWidth={1.7} className="history-chat-icon" />
          )}

          {isEditing ? (
            <input
              type="text"
              className="rename-input"
              value={renameValue}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleSaveRename(conv.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename(conv.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
            />
          ) : (
            <div className="history-text-col">
              <span className="history-item-title" title={conv.title || 'Untitled Conversation'}>
                {conv.title || 'Untitled Conversation'}
              </span>
              <span className="history-item-time">
                {conv.updatedAt ? formatRelativeTime(conv.updatedAt) : 'Just now'}
              </span>
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="history-actions-wrapper" ref={menuOpenId === conv.id ? menuRef : null}>
            <button
              type="button"
              className="btn-history-menu"
              title="Conversation options"
              aria-label="Conversation options"
              onClick={(e) => {
                e.stopPropagation();
                if (menuOpenId === conv.id) {
                  setMenuOpenId(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                const menuWidth = 170;
                const menuHeight = 130;
                const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                const top = rect.bottom + 6 + menuHeight > window.innerHeight
                  ? Math.max(8, rect.top - menuHeight - 6)
                  : rect.bottom + 6;
                setMenuPos({ top, left });
                setMenuOpenId(conv.id);
              }}
            >
              <MoreHorizontal size={14} />
            </button>

            {menuOpenId === conv.id && (
              <div
                className="header-dropdown-menu history-menu-dropdown"
                style={{ top: menuPos.top, left: menuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="dropdown-option"
                  onClick={() => {
                    setMenuOpenId(null);
                    if (onTogglePinConversation) {
                      onTogglePinConversation(conv.id);
                    }
                  }}
                >
                  <span className="dropdown-label-flex">
                    {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                    {isPinned ? 'Unpin' : 'Pin'}
                  </span>
                </div>

                <div
                  className="dropdown-option"
                  onClick={(e) => handleStartRename(conv, e)}
                >
                  <span className="dropdown-label-flex">
                    <Pencil size={13} />
                    Rename
                  </span>
                </div>

                <div
                  className="dropdown-option danger"
                  onClick={() => {
                    setMenuOpenId(null);
                    onDeleteConversation(conv.id);
                  }}
                >
                  <span className="dropdown-label-flex danger">
                    <Trash2 size={13} />
                    Delete
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div className="sidebar-mobile-backdrop" onClick={onCloseMobile} />
      )}

      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'open' : ''}`}>
        {/* Brand Header */}
        <div className={`sidebar-brand-container ${isCollapsed ? 'collapsed' : ''}`}>
          {!isCollapsed ? (
            <>
              <div className="brand-header-left">
                <div className="brand-icon-box" title="RAG College">
                  <GraduationCap size={22} strokeWidth={2} />
                </div>
                <div className="brand-info">
                  <span className="brand-title">RAG College</span>
                  <span className="brand-subtitle">Your College Knowledge Assistant</span>
                </div>
              </div>
              <div className="sidebar-header-actions">
                {onToggleCollapse && (
                  <button
                    type="button"
                    className="btn-sidebar-toggle"
                    onClick={onToggleCollapse}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                  >
                    <PanelLeftClose size={18} strokeWidth={1.9} />
                  </button>
                )}
                {onCloseMobile && (
                  <button
                    type="button"
                    className="btn-sidebar-mobile-close"
                    onClick={onCloseMobile}
                    aria-label="Close sidebar"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn-sidebar-toggle"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen size={18} strokeWidth={1.9} />
            </button>
          )}
        </div>

        {/* Vertical Navigation Menu */}
        <div className="sidebar-nav-menu">
          {/* 1. New Chat (Highlighted) */}
          <button
            type="button"
            className="sidebar-nav-item active-new-chat"
            title="New Chat"
            onClick={() => {
              setActiveView('chat');
              onNewChat();
              if (onCloseMobile) onCloseMobile();
            }}
          >
            <MessageSquare size={17} strokeWidth={1.9} />
            {!isCollapsed && <span>New Chat</span>}
          </button>

          {/* 2. Search */}
          <button
            type="button"
            className={`sidebar-nav-item ${showSearchInput ? 'active' : ''}`}
            title="Search chats"
            onClick={() => {
              if (isCollapsed && onToggleCollapse) {
                onToggleCollapse();
                setShowSearchInput(true);
              } else {
                setShowSearchInput((prev) => !prev);
              }
            }}
          >
            <Search size={17} strokeWidth={1.9} />
            {!isCollapsed && <span>Search</span>}
          </button>

          {/* Search Input Box (Collapsible/Accessible) */}
          {!isCollapsed && showSearchInput && (
            <div className="sidebar-search-inline">
              <input
                ref={searchInputRef}
                type="text"
                className="search-input-field"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="btn-clear-search"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {/* 3. Knowledge Base (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === 'documents' ? 'active' : ''}`}
              title="Knowledge Base"
              onClick={() => handleNavClick('documents')}
            >
              <BookOpen size={17} strokeWidth={1.9} />
              {!isCollapsed && <span>Knowledge Base</span>}
            </button>
          )}

          {/* 4. Departments (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === 'departments' ? 'active' : ''}`}
              title="Departments"
              onClick={() => handleNavClick('departments')}
            >
              <Building2 size={17} strokeWidth={1.9} />
              {!isCollapsed && <span>Departments</span>}
            </button>
          )}

          {/* 5. Users & Staff (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === 'users' ? 'active' : ''}`}
              title="Users & Staff Management"
              onClick={() => handleNavClick('users')}
            >
              <Users size={17} strokeWidth={1.9} />
              {!isCollapsed && <span>Users & Staff</span>}
            </button>
          )}

          {/* 6. Audit Logs (Admin Only) */}
          {currentUser?.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-nav-item ${activeView === 'audit-logs' ? 'active' : ''}`}
              title="Security & Audit Logs"
              onClick={() => handleNavClick('audit-logs')}
            >
              <ShieldAlert size={17} strokeWidth={1.9} />
              {!isCollapsed && <span>Audit Logs</span>}
            </button>
          )}

          {/* 7. Settings */}
          <button
            type="button"
            className="sidebar-nav-item"
            title="Settings"
            onClick={() => {
              if (onOpenSettings) onOpenSettings();
              if (onCloseMobile) onCloseMobile();
            }}
          >
            <Settings size={17} strokeWidth={1.9} />
            {!isCollapsed && <span>Settings</span>}
          </button>
        </div>

        {/* Divider & Scrollable History Area (Expanded only) */}
        {!isCollapsed && (
          <>
            <div className="sidebar-divider-line" />
            <div className="sidebar-scroll-area">
              {/* Pinned Section */}
              {pinnedConversations.length > 0 && (
                <div className="sidebar-section">
                  <div className="sidebar-section-title">Pinned</div>
                  <div className="history-list">
                    {pinnedConversations.map((conv) => renderChatItem(conv, true))}
                  </div>
                </div>
              )}

              {/* Recent Chats Section */}
              <div className="sidebar-section">
                <div className="sidebar-section-title">Recent Chats</div>
                <div className="history-list">
                  {filteredConversations.length === 0 ? (
                    <div className="empty-history-box">
                      <div className="empty-history-title">No conversations yet</div>
                      <div className="empty-history-desc">
                        Start a new conversation to ask questions about college documents.
                      </div>
                    </div>
                  ) : recentConversations.length === 0 && pinnedConversations.length > 0 ? (
                    <div className="empty-history-text">All conversations pinned above</div>
                  ) : (
                    recentConversations.map((conv) => renderChatItem(conv, false))
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Sidebar Bottom: Knowledge Base + Student Profile */}
        {!isCollapsed ? (
          <div className="sidebar-bottom-container">
            {/* Knowledge Base Row (Admin Only) */}
            {currentUser?.role === 'admin' && (
              <div
                className="sidebar-bottom-card"
                onClick={() => handleNavClick('documents')}
                title="View College Knowledge Base Documents"
              >
                <div className="sidebar-bottom-left">
                  <div className="sidebar-bottom-icon">
                    <BookOpen size={17} strokeWidth={1.9} />
                  </div>
                  <div className="sidebar-bottom-meta">
                    <span className="bottom-meta-title">Knowledge Base</span>
                    <span className="bottom-meta-subtitle">Documents • Drive • Departments</span>
                  </div>
                </div>
                <ChevronRight size={15} className="bottom-chevron" />
              </div>
            )}

            {/* User Profile / Auth Row */}
            {currentUser ? (
              <div
                className="sidebar-bottom-card student-card"
                onClick={() => {
                  if (onOpenSettings) onOpenSettings();
                  if (onCloseMobile) onCloseMobile();
                }}
                title={`${currentUser.name} (${currentUser.role}) • Click for settings`}
              >
                <div className="sidebar-bottom-left" style={{ overflow: 'hidden' }}>
                  <div className="student-avatar-circle">
                    <User size={15} strokeWidth={2.4} color="#172554" />
                  </div>
                  <div className="sidebar-bottom-meta" style={{ minWidth: 0 }}>
                    <div className="sidebar-user-role-row">
                      <span className="bottom-meta-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentUser.name || 'User'}
                      </span>
                      <span className={`role-badge ${currentUser.role === 'admin' ? 'admin' : 'user'}`}>
                        {currentUser.role}
                      </span>
                    </div>
                    <span className="bottom-meta-subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {currentUser.email}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="sidebar-logout-btn"
                  title="Sign out"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onLogout) onLogout();
                  }}
                >
                  <LogOut size={15} />
                </button>
              </div>
            ) : (
              <div
                className="sidebar-login-card"
                onClick={() => {
                  if (onOpenAuth) onOpenAuth();
                  if (onCloseMobile) onCloseMobile();
                }}
                title="Sign in to your account"
              >
                <LogIn size={15} />
                <span>Sign In / Register</span>
              </div>
            )}
          </div>
        ) : (
          <div className="sidebar-bottom-container collapsed">
            {currentUser ? (
              <div
                className="sidebar-bottom-card student-card collapsed"
                onClick={() => {
                  if (onLogout) onLogout();
                }}
                title={`${currentUser.name} (${currentUser.role}) • Click to sign out`}
              >
                <div className="student-avatar-circle">
                  <User size={15} strokeWidth={2.4} color="#172554" />
                </div>
              </div>
            ) : (
              <div
                className="sidebar-bottom-card student-card collapsed"
                onClick={() => {
                  if (onOpenAuth) onOpenAuth();
                }}
                title="Sign In"
              >
                <div className="student-avatar-circle">
                  <LogIn size={15} strokeWidth={2.4} color="#172554" />
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}