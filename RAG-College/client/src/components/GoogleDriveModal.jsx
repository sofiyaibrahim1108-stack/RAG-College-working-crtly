import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  ExternalLink,
  Globe,
  Lock,
  Check,
  MoreHorizontal,
  LogOut,
  Building2
} from 'lucide-react';
import {
  fetchDriveStatus,
  fetchDriveAuthUrl,
  disconnectDrive,
  fetchDriveFiles,
  importDriveFile
} from '../api';
import { GoogleDriveIcon } from './Icons';
import MultiSelectDropdown from './MultiSelectDropdown';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { isDepartmentAdmin } from '../utils/access';

// Layout settings (change here, not inside the JSX)
const MODAL_CONFIG = {
  maxWidth: 760,
  height: 'min(840px, 92vh)',
  listMinHeight: 160,
  searchDebounceMs: 400
};

// Colour tokens
const C = {
  text: '#0F172A',
  textSoft: '#334155',
  muted: '#475569',
  border: '#E2E8F0',
  surface: '#F8FAFC',
  field: '#F1F5F9',
  primary: '#1D4ED8',
  primarySoft: '#EFF6FF',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  success: '#15803D'
};

// One radius scale so every control looks like part of the same family
const R = {
  modal: '16px',
  card: '12px',
  control: '10px',
  chip: '6px'
};

export default function GoogleDriveModal({
  isOpen,
  onClose,
  departments = [],
  onImportSuccess,
  onToast,
  currentUser = null
}) {
  const [authStatus, setAuthStatus] = useState({ configured: false, authenticated: false });
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [driveFiles, setDriveFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // MULTI-SELECTION STATE (Array of selected file objects)
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressText, setImportProgressText] = useState('');
  const [importDone, setImportDone] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [deptError, setDeptError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const deptDropdownRef = useRef(null);
  const latestRequestRef = useRef(0);
  const lastSearchedRef = useRef('');

  // Department Admins always import privately into their own department(s).
  const scoped = isDepartmentAdmin(currentUser);
  // With exactly one department there is nothing to choose, so it is fixed.
  const lockedDept = scoped && departments.length === 1 ? departments[0] : null;
  const publicMode = !scoped && isPublic;
  const effectiveDeptIds = lockedDept ? [String(lockedDept._id)] : selectedDeptIds;
  // Only a Super Admin may connect or disconnect the shared Google account.
  const canManageConnection = authStatus.canManageConnection !== false && !scoped;

  // Live search: run automatically shortly after the user stops typing
  useEffect(() => {
    if (!isOpen || !authStatus.authenticated) return undefined;
    const timer = setTimeout(() => {
      if (lastSearchedRef.current !== searchQuery) {
        loadFiles(searchQuery);
      }
    }, MODAL_CONFIG.searchDebounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, isOpen, authStatus.authenticated]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setDeptError('');
      setIsImporting(false);
      setImportDone(0);
      setIsPublic(false);
      setSelectedDeptIds([]);
      setSelectedFiles([]);
      setMenuOpen(false);
      setConfirmDisconnect(false);
      checkStatusAndLoad();
    }
  }, [isOpen]);

  // Close the account menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = () => {
      setMenuOpen(false);
      setConfirmDisconnect(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const checkStatusAndLoad = async () => {
    setIsLoadingStatus(true);
    setErrorMsg('');
    try {
      const status = await fetchDriveStatus();
      setAuthStatus(status);
      if (status.authenticated) {
        await loadFiles();
      }
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const loadFiles = async (search = searchQuery) => {
    // Ignore out-of-date responses if the user keeps typing
    const requestId = ++latestRequestRef.current;
    lastSearchedRef.current = search;
    setIsLoadingFiles(true);
    setErrorMsg('');
    try {
      const res = await fetchDriveFiles({ search });
      if (requestId !== latestRequestRef.current) return;
      setDriveFiles(res.files || []);
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    } finally {
      if (requestId === latestRequestRef.current) {
        setIsLoadingFiles(false);
      }
    }
  };

  const handleConnect = async () => {
    setErrorMsg('');
    try {
      const res = await fetchDriveAuthUrl();
      if (res.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          res.authUrl,
          'GoogleDriveAuth',
          `width=${width},height=${height},top=${top},left=${left}`
        );

        const timer = setInterval(async () => {
          if (!popup || popup.closed) {
            clearInterval(timer);
            await checkStatusAndLoad();
          }
        }, 1000);
      }
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectDrive();
      setAuthStatus((prev) => ({ ...prev, authenticated: false }));
      setDriveFiles([]);
      setSelectedFiles([]);
      if (onToast) onToast('Google Drive disconnected', 'info');
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    }
  };

  const handleScopeChange = (scopeIsPublic) => {
    setIsPublic(scopeIsPublic);
    setDeptError('');
    if (scopeIsPublic) {
      setSelectedDeptIds([]);
    }
  };

  // Toggle selection for multiple files
  const toggleFileSelect = (file) => {
    setSelectedFiles((prev) => {
      const exists = prev.some((f) => f.id === file.id);
      if (exists) {
        return prev.filter((f) => f.id !== file.id);
      }
      return [...prev, file];
    });
  };

  // Batch import handler
  const handleBatchImport = async () => {
    if (!publicMode && effectiveDeptIds.length === 0) {
      setDeptError('Please assign at least 1 department');
      deptDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      deptDropdownRef.current?.focus();
      return;
    }

    if (selectedFiles.length === 0) {
      setErrorMsg('Please select at least 1 file to import.');
      return;
    }

    setIsImporting(true);
    setImportDone(0);
    setErrorMsg('');
    setDeptError('');

    let successCount = 0;
    const errors = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const currentFile = selectedFiles[i];
        setImportProgressText(`Importing (${i + 1}/${selectedFiles.length}): "${currentFile.name}"...`);

        try {
          const res = await importDriveFile({
            fileId: currentFile.id,
            departmentIds: effectiveDeptIds,
            isPublic: publicMode,
            forceReimport: false
          });

          successCount++;
          if (onImportSuccess && res.data) {
            await onImportSuccess(res.data);
          }
        } catch (itemErr) {
          const msg = itemErr.response?.data?.message || itemErr.message;
          errors.push(`"${currentFile.name}": ${msg}`);
        }

        setImportDone(i + 1);
      }

      if (successCount > 0 && onToast) {
        onToast(`Successfully imported ${successCount} document(s) from Drive!`, 'success');
      }

      if (errors.length > 0) {
        setErrorMsg(`Imported ${successCount}/${selectedFiles.length}. Errors:\n` + errors.join('; '));
      } else {
        setSelectedFiles([]);
        setSelectedDeptIds([]);
        onClose();
      }
    } catch (generalErr) {
      setErrorMsg(getFriendlyErrorMessage(generalErr, 'drive'));
    } finally {
      setIsImporting(false);
      setImportProgressText('');
    }
  };

  const getFileInfo = (fileType, name = '') => {
    // Only treat the text after the last dot as an extension when it really looks like one.
    // Google Docs names have no extension, so the whole title must not be used as the label.
    const dotIndex = name.lastIndexOf('.');
    const rawExt = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
    const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '';
    const type = (fileType || ext || 'pdf').toLowerCase();

    if (type.includes('pdf') || ext === 'pdf') {
      return { label: 'PDF', bg: '#FEE2E2', color: '#991B1B' };
    }
    if (type.includes('sheet') || type.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext)) {
      return { label: ext ? ext.toUpperCase() : 'XLSX', bg: '#DCFCE7', color: '#166534' };
    }
    return { label: ext ? ext.toUpperCase() : 'DOC', bg: '#DBEAFE', color: '#1E40AF' };
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    const num = Number(bytes);
    if (isNaN(num)) return '';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  const selectedIds = new Set(selectedFiles.map((f) => f.id));
  const allSelected = driveFiles.length > 0 && driveFiles.every((f) => selectedIds.has(f.id));
  const progressPct = selectedFiles.length > 0
    ? Math.max(4, Math.round((importDone / selectedFiles.length) * 100))
    : 0;

  // Display-only hint that explains why Import is not ready yet
  let footerHint = '';
  if (selectedFiles.length === 0) footerHint = 'Select at least one file to import';
  else if (!publicMode && effectiveDeptIds.length === 0) footerHint = 'Select a department before importing';

  const trimmedQuery = searchQuery.trim();

  const segmentStyle = (active) => ({
    height: '34px',
    padding: '0 14px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: isImporting ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: active ? '#FFFFFF' : 'transparent',
    color: active ? C.text : C.muted,
    boxShadow: active ? '0 1px 3px rgba(15,23,42,0.15)' : 'none'
  });

  return (
    <div className="modal-backdrop" onClick={isImporting ? undefined : onClose}>
      <style>{`
        /* Use the app's own font everywhere inside the modal (buttons and inputs don't inherit by default) */
        .gd-modal, .gd-modal * { font-family: inherit; }
        .gd-modal button, .gd-modal input { font-family: inherit; }
        .gd-modal input::placeholder { color: #64748B; }
        .gd-row:hover:not(:disabled) { background: #F5F8FF; }
        .gd-row:focus-visible, .gd-modal button:focus-visible {
          outline: 2px solid #1D4ED8; outline-offset: 2px;
        }
        .gd-search:focus-within {
          border-color: #1D4ED8 !important;
          box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.15);
        }
        .gd-icon-btn:hover:not(:disabled) { background: #E2E8F0; }
        .gd-menu-item:hover { background: #F1F5F9; }
        .gd-scroll::-webkit-scrollbar { width: 6px; }
        .gd-scroll::-webkit-scrollbar-thumb { background: #D5DAE1; border-radius: 8px; }
        .gd-scroll::-webkit-scrollbar-track { background: transparent; }
        /* soft fade at the bottom of the file list so it does not collide with the footer */
        .gd-list-wrap::after {
          content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 22px;
          background: linear-gradient(rgba(255,255,255,0), #FFFFFF); pointer-events: none;
        }
      `}</style>

      <div
        className="modal-container gd-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import from Google Drive"
        style={{
          width: '94%',
          maxWidth: `${MODAL_CONFIG.maxWidth}px`,
          height: MODAL_CONFIG.height,
          background: '#FFFFFF',
          borderRadius: R.modal,
          boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexShrink: 0,
          borderBottom: `1px solid ${C.border}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: R.card,
              background: C.field,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <GoogleDriveIcon size={24} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: 700,
                color: C.text,
                margin: 0
              }}>
                Import from Google Drive
              </h2>
              <p style={{ fontSize: '13.5px', color: C.muted, margin: '2px 0 0' }}>
                Pick the files to add to your knowledge base.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {authStatus.authenticated && canManageConnection && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="gd-icon-btn"
                  aria-label="Account options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  disabled={isImporting}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDisconnect(false);
                    setMenuOpen((v) => !v);
                  }}
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: R.control,
                    border: 'none',
                    background: C.field,
                    color: C.textSoft,
                    cursor: isImporting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: '42px',
                      zIndex: 30,
                      width: confirmDisconnect ? '248px' : '208px',
                      background: '#FFFFFF',
                      border: `1px solid ${C.border}`,
                      borderRadius: R.card,
                      boxShadow: '0 12px 28px -8px rgba(15, 23, 42, 0.25)',
                      padding: '6px'
                    }}
                  >
                    {!confirmDisconnect ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="gd-menu-item"
                        onClick={() => setConfirmDisconnect(true)}
                        style={{
                          width: '100%',
                          minHeight: '40px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '0 10px',
                          border: 'none',
                          background: 'transparent',
                          borderRadius: '8px',
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: C.danger,
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                      >
                        <LogOut size={15} />
                        <span>Disconnect Google Drive</span>
                      </button>
                    ) : (
                      <div style={{ padding: '8px 8px 6px' }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 600, color: C.text }}>
                          Disconnect Google Drive?
                        </div>
                        <div style={{ fontSize: '12.5px', color: C.muted, margin: '4px 0 10px', lineHeight: 1.4 }}>
                          You will need to authorize again to import files.
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDisconnect(false);
                              setMenuOpen(false);
                            }}
                            style={{
                              minHeight: '34px',
                              padding: '0 12px',
                              borderRadius: '8px',
                              border: `1px solid ${C.border}`,
                              background: '#FFFFFF',
                              fontSize: '13px',
                              fontWeight: 600,
                              color: C.textSoft,
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              setMenuOpen(false);
                              setConfirmDisconnect(false);
                              await handleDisconnect();
                            }}
                            style={{
                              minHeight: '34px',
                              padding: '0 12px',
                              borderRadius: '8px',
                              border: 'none',
                              background: C.danger,
                              fontSize: '13px',
                              fontWeight: 600,
                              color: '#FFFFFF',
                              cursor: 'pointer'
                            }}
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="gd-icon-btn"
              onClick={onClose}
              disabled={isImporting}
              aria-label="Close"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: R.control,
                border: 'none',
                background: C.field,
                color: C.textSoft,
                cursor: isImporting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 24px 0',
          gap: '14px'
        }}>
          {isLoadingStatus ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }} role="status" aria-live="polite">
              <Loader2 size={24} className="spin" style={{ color: C.primary, margin: '0 auto 8px' }} />
              <div style={{ fontSize: '13.5px', color: C.muted }}>Connecting to Drive...</div>
            </div>
          ) : !authStatus.authenticated ? (
            <div style={{
              textAlign: 'center',
              padding: '48px 16px',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: R.card
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: R.card,
                background: '#FFFFFF',
                boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 14px'
              }}>
                <GoogleDriveIcon size={28} />
              </div>
              {canManageConnection ? (
                <>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 6px' }}>
                    Connect your account
                  </h3>
                  <p style={{ fontSize: '14px', color: C.muted, maxWidth: '360px', margin: '0 auto 18px', lineHeight: 1.5 }}>
                    Link your Google Drive securely to browse and import your college documents.
                  </p>
                  <button
                    type="button"
                    onClick={handleConnect}
                    style={{
                      background: C.primary,
                      color: '#FFFFFF',
                      minHeight: '42px',
                      padding: '0 20px',
                      borderRadius: R.control,
                      border: 'none',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>Authorize Google Drive</span>
                    <ExternalLink size={14} />
                  </button>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 6px' }}>
                    Google Drive is not connected
                  </h3>
                  <p style={{ fontSize: '14px', color: C.muted, maxWidth: '360px', margin: '0 auto', lineHeight: 1.5 }}>
                    Ask a Super Admin to connect Google Drive. Once it is connected, you can import files into your department.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Settings: departments + who can see */}
              <div style={{
                padding: '14px 16px',
                borderRadius: R.card,
                background: C.surface,
                border: `1px solid ${C.border}`,
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {publicMode ? (
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: C.textSoft, marginBottom: '6px' }}>
                          Add to departments
                        </div>
                        <div style={{
                          height: '42px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '0 14px',
                          borderRadius: R.control,
                          background: '#FFFFFF',
                          border: `1px solid ${C.border}`,
                          fontSize: '13.5px',
                          color: C.muted
                        }}>
                          <Globe size={15} color={C.success} />
                          <span>All departments can see these files</span>
                        </div>
                      </div>
                    ) : lockedDept ? (
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: C.textSoft, marginBottom: '6px' }}>
                          Importing to department
                        </div>
                        <div style={{
                          height: '42px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '0 14px',
                          borderRadius: R.control,
                          background: '#FFFFFF',
                          border: `1px solid ${C.border}`,
                          fontSize: '14px',
                          fontWeight: 600,
                          color: C.text
                        }}>
                          <Building2 size={16} color={C.primary} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {lockedDept.name}
                          </span>
                          {lockedDept.code && (
                            <span style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: C.primary,
                              background: C.primarySoft,
                              padding: '2px 8px',
                              borderRadius: R.chip,
                              flexShrink: 0
                            }}>
                              {lockedDept.code}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <MultiSelectDropdown
                        ref={deptDropdownRef}
                        label="Add to departments"
                        required={true}
                        options={departments}
                        selectedIds={selectedDeptIds}
                        onChange={(newIds) => {
                          setSelectedDeptIds(newIds);
                          if (newIds.length > 0) setDeptError('');
                        }}
                        error={deptError}
                        placeholder="Select 1 or more departments..."
                        id="gdrive-dept-select"
                      />
                    )}
                  </div>

                  {/* Only a Super Admin can publish documents to everyone */}
                  {!scoped && (
                    <div style={{ flexShrink: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: C.textSoft, marginBottom: '6px' }}>
                        Who can see
                      </div>
                      <div style={{
                        display: 'flex',
                        background: C.border,
                        padding: '3px',
                        borderRadius: R.control,
                        gap: '2px'
                      }}>
                        <button
                          type="button"
                          onClick={() => handleScopeChange(false)}
                          disabled={isImporting}
                          aria-pressed={!isPublic}
                          style={segmentStyle(!isPublic)}
                        >
                          <Lock size={13} />
                          Private
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScopeChange(true)}
                          disabled={isImporting}
                          aria-pressed={isPublic}
                          style={segmentStyle(isPublic)}
                        >
                          <Globe size={13} />
                          Public
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <p style={{ fontSize: '12.5px', color: C.muted, margin: '10px 2px 0', lineHeight: 1.4 }}>
                  {publicMode
                    ? 'Everyone in every department can view and search these files.'
                    : scoped
                      ? 'Only people in your department can view and search these files.'
                      : 'Only the selected departments can view and search these files.'}
                </p>
              </div>

              {/* Search */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <label
                  className="gd-search"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    height: '44px',
                    padding: '0 14px',
                    borderRadius: R.control,
                    background: '#FFFFFF',
                    border: `1px solid #CBD5E1`
                  }}
                >
                  <Search size={17} color={C.muted} />
                  <input
                    type="text"
                    placeholder="Search your Drive"
                    aria-label="Search your Drive"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFiles(searchQuery)}
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: '14.5px',
                      color: C.text
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery('')}
                      style={{
                        width: '26px',
                        height: '26px',
                        border: 'none',
                        background: 'transparent',
                        borderRadius: '6px',
                        color: C.muted,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
                <button
                  type="button"
                  className="gd-icon-btn"
                  onClick={() => loadFiles()}
                  disabled={isLoadingFiles}
                  title="Refresh file list"
                  aria-label="Refresh file list"
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: R.control,
                    border: `1px solid #CBD5E1`,
                    background: '#FFFFFF',
                    color: C.textSoft,
                    cursor: isLoadingFiles ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <RefreshCw size={16} className={isLoadingFiles ? 'spin' : ''} />
                </button>
              </div>

              {/* List label + select all */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 4px',
                flexShrink: 0
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: C.textSoft }}>
                  Files{driveFiles.length > 0 ? ` (${driveFiles.length})` : ''}
                </span>
                {driveFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedFiles(allSelected ? [] : [...driveFiles])}
                    disabled={isImporting}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: '4px 6px',
                      color: C.primary,
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>

              {/* Files list */}
              <div
                className="gd-list-wrap"
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: `${MODAL_CONFIG.listMinHeight}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  margin: '0 -8px'
                }}
              >
                <div
                  className="gd-scroll"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '0 8px 16px'
                  }}
                >
                  {isLoadingFiles ? (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{ padding: '50px 0', textAlign: 'center', color: C.muted, fontSize: '13.5px' }}
                    >
                      <Loader2 size={20} className="spin" style={{ margin: '0 auto 8px', color: C.primary }} />
                      Loading files...
                    </div>
                  ) : driveFiles.length === 0 ? (
                    <div style={{ padding: '50px 16px', textAlign: 'center', color: C.muted, fontSize: '14px' }}>
                      {trimmedQuery ? `No files match "${trimmedQuery}".` : 'No files found.'}
                    </div>
                  ) : (
                    driveFiles.map((f) => {
                      const isSelected = selectedIds.has(f.id);
                      const info = getFileInfo(f.fileType, f.name);
                      const sizeStr = formatSize(f.size);

                      return (
                        <button
                          key={f.id}
                          type="button"
                          className="gd-row"
                          aria-pressed={isSelected}
                          disabled={isImporting}
                          title={f.name}
                          onClick={() => toggleFileSelect(f)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '14px',
                            padding: '10px 12px',
                            borderRadius: R.card,
                            border: 'none',
                            textAlign: 'left',
                            cursor: isImporting ? 'not-allowed' : 'pointer',
                            flexShrink: 0,
                            width: '100%',
                            boxSizing: 'border-box',
                            background: isSelected ? C.primarySoft : 'transparent',
                            transition: 'background 0.12s ease'
                          }}
                        >
                          <span style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: R.control,
                            background: info.bg,
                            color: info.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.02em'
                          }}>
                            {info.label}
                          </span>

                          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{
                              fontSize: '14.5px',
                              fontWeight: 600,
                              color: C.text,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              {f.name}
                            </span>
                            <span style={{ fontSize: '12.5px', color: C.muted }}>
                              {info.label}{sizeStr && ` · ${sizeStr}`}
                            </span>
                          </span>

                          {/* Square checkbox: makes it clear that several files can be picked */}
                          <span style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: R.chip,
                            border: `1.5px solid ${isSelected ? C.primary : '#94A3B8'}`,
                            background: isSelected ? C.primary : '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            boxSizing: 'border-box'
                          }}>
                            {isSelected && <Check size={14} color="#FFFFFF" strokeWidth={3.2} />}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {/* Progress during batch execution */}
          {isImporting && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: '12px 14px',
                background: C.primarySoft,
                border: '1px solid #BFDBFE',
                borderRadius: R.card,
                fontSize: '13px',
                color: '#1E40AF',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Loader2 size={15} className="spin" />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {importProgressText || 'Importing selected files...'}
                </span>
              </div>
              <div style={{ height: '6px', borderRadius: '999px', background: '#DBEAFE', overflow: 'hidden' }}>
                <div style={{
                  height: '6px',
                  width: `${progressPct}%`,
                  borderRadius: '999px',
                  background: C.primary,
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 14px',
                background: C.dangerSoft,
                border: '1px solid #FECACA',
                borderRadius: R.card,
                color: '#991B1B',
                fontSize: '13px',
                flexShrink: 0
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ whiteSpace: 'pre-line' }}>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {authStatus.authenticated && (
          <div style={{
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexShrink: 0,
            borderTop: `1px solid ${C.border}`,
            background: C.surface
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: C.textSoft }}>
                {selectedFiles.length === 0
                  ? 'No files selected'
                  : `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} selected`}
              </div>
              {footerHint && !isImporting && (
                <div style={{ fontSize: '12.5px', color: C.muted, marginTop: '2px' }}>
                  {footerHint}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isImporting}
                style={{
                  minHeight: '40px',
                  padding: '0 16px',
                  borderRadius: R.control,
                  border: `1px solid #CBD5E1`,
                  background: '#FFFFFF',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: C.textSoft,
                  cursor: isImporting ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBatchImport}
                disabled={isImporting || selectedFiles.length === 0}
                style={{
                  minHeight: '40px',
                  padding: '0 20px',
                  borderRadius: R.control,
                  border: 'none',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  background: selectedFiles.length > 0 ? C.primary : '#94A3B8',
                  cursor: selectedFiles.length > 0 && !isImporting ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {isImporting ? <Loader2 size={15} className="spin" /> : null}
                <span>
                  {isImporting
                    ? 'Importing...'
                    : selectedFiles.length > 0
                      ? `Import ${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'}`
                      : 'Import'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}