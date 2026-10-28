import React, { useState, useRef, useEffect } from 'react';
import {
  GraduationCap,
  MessageSquare,
  Search,
  Building2,
  BookOpen,
  User,
  Settings,
  MoreHorizontal,
  Trash2,
  Pencil,
  Pin,
  PinOff,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Users,
  ShieldAlert,
  Plus,
  ChevronUp,
  ChevronDown,
  ImageIcon
} from 'lucide-react';
import { isAdmin, isSuperAdmin } from '../utils/access';

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
  onOpenSettings,
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
  const [showTopSearch, setShowTopSearch] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const searchInputRef = useRef(null);
  const menuRef = useRef(null);
  const profileMenuRef = useRef(null);

  // Role-based navigation:
  //  - every admin sees Knowledge Base and Users & Staff (their own scope is enforced by the backend)
  //  - only a Super Admin sees Departments and Audit Logs
  const isAdminUser = isAdmin(currentUser);
  const superAdmin = isSuperAdmin(currentUser);

  const roleLabel = !currentUser
    ? 'User'
    : isAdminUser
      ? superAdmin
        ? 'Super Admin'
        : 'Department Admin'
      : currentUser.role || 'User';

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpenId(null);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setIsProfileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showTopSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showTopSearch]);

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

  const renderNavItem = (view, Icon, label) => {
    const isActiveNav = activeView === view;
    return (
      <div
        key={view}
        onClick={() => handleNavClick(view)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '9.5px 12px',
          borderRadius: '8px',
          cursor: 'pointer',
          background: isActiveNav ? 'rgba(37, 99, 235, 0.45)' : 'transparent',
          color: isActiveNav ? '#38BDF8' : '#FFFFFF',
          borderLeft: isActiveNav ? '3px solid #38BDF8' : '3px solid transparent',
          transition: 'all 0.15s ease'
        }}
        className="exact-nav-link"
      >
        <Icon size={16} strokeWidth={isActiveNav ? 2.2 : 1.9} color={isActiveNav ? '#38BDF8' : '#FFFFFF'} />
        <span style={{ fontSize: '13.5px', fontWeight: isActiveNav ? 650 : 500, color: '#FFFFFF' }}>
          {label}
        </span>
      </div>
    );
  };

  const renderChatItem = (conv, isPinnedItem = false) => {
    const isActive = activeView === 'chat' && activeConvId === conv.id;
    const isEditing = renamingId === conv.id;
    const isPinned = pinnedIds.includes(conv.id);

    return (
      <div
        key={conv.id}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8.5px 12px',
          borderRadius: '8px',
          marginBottom: '2px',
          cursor: 'pointer',
          background: isActive ? 'rgba(37, 99, 235, 0.45)' : 'transparent',
          color: '#FFFFFF',
          transition: 'all 0.15s ease'
        }}
        className="sidebar-chat-row"
        onClick={() => {
          if (!isEditing) handleSelectConv(conv.id);
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          {isPinnedItem ? (
            <Pin size={15} color="#38BDF8" style={{ flexShrink: 0, transform: 'rotate(45deg)' }} />
          ) : (
            <MessageSquare size={15} style={{ flexShrink: 0, color: isActive ? '#38BDF8' : '#94A3B8' }} />
          )}

          {isEditing ? (
            <input
              type="text"
              value={renameValue}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleSaveRename(conv.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename(conv.id);
                if (e.key === 'Escape') setRenamingId(null);
              }}
              style={{
                width: '100%',
                background: '#0B132B',
                border: '1px solid #38BDF8',
                borderRadius: '4px',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                padding: '2px 6px',
                outline: 'none'
              }}
            />
          ) : (
            <span
              style={{
                fontSize: '13.5px',
                fontWeight: isActive ? 600 : 450,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: '#FFFFFF',
                letterSpacing: '-0.1px'
              }}
              title={conv.title || 'Untitled Conversation'}
            >
              {conv.title || 'Untitled Conversation'}
            </span>
          )}
        </div>

        {!isEditing && (
          <div style={{ display: 'flex', alignItems: 'center' }} ref={menuOpenId === conv.id ? menuRef : null}>
            <button
              type="button"
              className="chat-row-more-btn"
              title="Options"
              aria-label="Options"
              onClick={(e) => {
                e.stopPropagation();
                if (menuOpenId === conv.id) {
                  setMenuOpenId(null);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                setMenuPos({ top: rect.bottom + 4, left: Math.max(10, rect.right - 140) });
                setMenuOpenId(conv.id);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                padding: '3px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <MoreHorizontal size={14} />
            </button>

            {menuOpenId === conv.id && (
              <div
                style={{
                  position: 'fixed',
                  top: menuPos.top,
                  left: menuPos.left,
                  width: '140px',
                  background: '#0F1D3D',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  boxShadow: '0 12px 30px -5px rgba(0,0,0,0.6)',
                  padding: '4px',
                  zIndex: 9999
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  onClick={() => {
                    setMenuOpenId(null);
                    if (onTogglePinConversation) onTogglePinConversation(conv.id);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    color: '#FFFFFF',
                    cursor: 'pointer'
                  }}
                  className="dropdown-menu-item"
                >
                  {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                  <span>{isPinned ? 'Unpin' : 'Pin chat'}</span>
                </div>

                <div
                  onClick={(e) => handleStartRename(conv, e)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    color: '#FFFFFF',
                    cursor: 'pointer'
                  }}
                  className="dropdown-menu-item"
                >
                  <Pencil size={13} />
                  <span>Rename</span>
                </div>

                <div
                  onClick={() => {
                    setMenuOpenId(null);
                    onDeleteConversation(conv.id);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    color: '#F87171',
                    cursor: 'pointer'
                  }}
                  className="dropdown-menu-item danger"
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
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
      {isMobileOpen && <div className="sidebar-mobile-backdrop" onClick={onCloseMobile} />}

      <aside
        style={{
          width: isCollapsed ? '68px' : '285px',
          height: '100vh',
          background: '#070E1E',
          borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 50,
          userSelect: 'none'
        }}
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'open' : ''}`}
      >
        {/* 1. Header (Brand Logo, Search Icon, Collapse Icon) */}
        <div style={{
          padding: isCollapsed ? '18px 10px' : '18px 16px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between'
        }}>
          {!isCollapsed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
                }}>
                  <GraduationCap size={20} strokeWidth={2.1} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.2px', lineHeight: 1.2 }}>
                    College RAG
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#94A3B8', fontWeight: 500 }}>
                    Knowledge Assistant
                  </div>
                </div>
              </div>

              {/* Top Icons: Search & Collapse */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setShowTopSearch((prev) => !prev)}
                  title="Search chats"
                  style={{
                    background: showTopSearch ? '#0F1A30' : 'transparent',
                    border: 'none',
                    color: showTopSearch ? '#38BDF8' : '#CBD5E1',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  className="sidebar-top-icon-btn"
                >
                  <Search size={17} />
                </button>

                {onToggleCollapse && (
                  <button
                    type="button"
                    onClick={onToggleCollapse}
                    title="Collapse sidebar"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#CBD5E1',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    className="sidebar-top-icon-btn"
                  >
                    <PanelLeftClose size={18} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Expand sidebar"
              style={{ background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: '6px' }}
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
        </div>

        {/* Top Search Input Box */}
        {!isCollapsed && showTopSearch && (
          <div style={{ padding: '0 14px 10px' }}>
            <div style={{ position: 'relative' }}>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0F1A30',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  borderRadius: '7px',
                  padding: '6px 26px 6px 10px',
                  fontSize: '12.5px',
                  color: '#FFFFFF',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '6px', top: '7px', background: 'none', border: 'none', color: '#CBD5E1', cursor: 'pointer' }}
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* 2. New Chat Pill Button */}
        <div style={{ padding: isCollapsed ? '10px 8px' : '0 14px 14px' }}>
          <button
            type="button"
            onClick={() => {
              setActiveView('chat');
              onNewChat();
              if (onCloseMobile) onCloseMobile();
            }}
            title="Start new conversation"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              gap: '9px',
              padding: isCollapsed ? '10px 0' : '9.5px 14px',
              borderRadius: '9px',
              background: '#0F1A30',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#FFFFFF',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            className="btn-exact-new-chat"
          >
            <Plus size={16} color="#FFFFFF" strokeWidth={2.4} />
            {!isCollapsed && <span>New chat</span>}
          </button>
        </div>

        {/* 3. MANAGE Section */}
        {!isCollapsed && (
          <div style={{ padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              padding: '0 8px 6px'
            }}>
              Manage
            </div>

            {/* Visible for all users */}
            {renderNavItem('media-library', ImageIcon, 'Media Library')}

            {/* Every admin: Knowledge Base + Users & Staff (data is scoped by the backend) */}
            {isAdminUser && renderNavItem('documents', BookOpen, 'Knowledge Base')}

            {/* Super Admin only */}
            {superAdmin && renderNavItem('departments', Building2, 'Departments')}

            {isAdminUser && renderNavItem('users', Users, 'Users & Staff')}

            {/* Super Admin only */}
            {superAdmin && renderNavItem('audit-logs', ShieldAlert, 'Audit Logs')}
          </div>
        )}

        {/* 4. RECENT CHATS Section */}
        {!isCollapsed && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 10px' }}>
            <div style={{
              padding: '6px 8px 8px',
              fontSize: '11px',
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.8px'
            }}>
              Recent Chats
            </div>

            <div
              className="sidebar-custom-scroll-area"
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                paddingRight: '4px'
              }}
            >
              {pinnedConversations.length > 0 && (
                <div style={{ marginBottom: '8px' }}>
                  {pinnedConversations.map((conv) => renderChatItem(conv, true))}
                </div>
              )}

              {filteredConversations.length === 0 ? (
                <div style={{ padding: '24px 10px', textAlign: 'center', color: '#94A3B8', fontSize: '12.5px' }}>
                  No conversations yet
                </div>
              ) : (
                recentConversations.map((conv) => renderChatItem(conv, false))
              )}
            </div>
          </div>
        )}

        {/* 5. Bottom User Profile Card */}
        <div
          ref={profileMenuRef}
          style={{
            position: 'relative',
            padding: isCollapsed ? '12px 8px' : '12px 14px 16px',
            background: '#070E1E'
          }}
        >
          {isProfileMenuOpen && currentUser && !isCollapsed && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                left: '14px',
                right: '14px',
                background: '#0F1A30',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '12px',
                boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.7)',
                padding: '6px',
                zIndex: 9999
              }}
            >
              <div
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  if (onOpenSettings) onOpenSettings('profile');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  cursor: 'pointer'
                }}
                className="dropdown-menu-item"
              >
                <User size={15} color="#38BDF8" />
                <span>Profile</span>
              </div>

              <div
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  if (onOpenSettings) onOpenSettings('appearance');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  cursor: 'pointer'
                }}
                className="dropdown-menu-item"
              >
                <Settings size={15} color="#38BDF8" />
                <span>Settings</span>
              </div>

              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />

              <div
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  if (onLogout) onLogout();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '7px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#F87171',
                  cursor: 'pointer'
                }}
                className="dropdown-menu-item danger"
              >
                <LogOut size={15} />
                <span>Log out</span>
              </div>
            </div>
          )}

          {!isCollapsed ? (
            currentUser ? (
              <div
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  background: '#0D172E',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
                className="exact-bottom-profile-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#2563EB',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    flexShrink: 0
                  }}>
                    {currentUser.name ? currentUser.name.slice(0, 2).toUpperCase() : 'SA'}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {currentUser.name || 'System Admin'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#CBD5E1', textTransform: 'capitalize' }}>
                      {roleLabel}
                    </div>
                  </div>
                </div>

                {isProfileMenuOpen ? (
                  <ChevronDown size={15} color="#FFFFFF" />
                ) : (
                  <ChevronUp size={15} color="#FFFFFF" />
                )}
              </div>
            ) : (
              <div
                onClick={() => {
                  if (onOpenAuth) onOpenAuth();
                  if (onCloseMobile) onCloseMobile();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Sign In
              </div>
            )
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                onClick={() => {
                  if (currentUser && onLogout) onLogout();
                  else if (onOpenAuth) onOpenAuth();
                }}
                title={currentUser ? `${currentUser.name} (Click to logout)` : 'Sign In'}
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  background: '#2563EB',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700
                }}
              >
                {currentUser ? (
                  currentUser.name ? currentUser.name.slice(0, 2).toUpperCase() : 'SA'
                ) : (
                  '?'
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}