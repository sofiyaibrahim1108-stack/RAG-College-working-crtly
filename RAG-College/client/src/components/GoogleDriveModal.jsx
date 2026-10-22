import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileText,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  ExternalLink,
  FileSpreadsheet,
  File
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

export default function GoogleDriveModal({
  isOpen,
  onClose,
  departments = [],
  onImportSuccess,
  onToast
}) {
  const [authStatus, setAuthStatus] = useState({ configured: false, authenticated: false });
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [driveFiles, setDriveFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deptError, setDeptError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  const deptDropdownRef = useRef(null);

  const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024; // 1 MB
  const isLargeFile =
    selectedFile?.size !== undefined &&
    selectedFile?.size !== null &&
    !isNaN(Number(selectedFile.size)) &&
    Number(selectedFile.size) > LARGE_FILE_THRESHOLD;

  // Check auth status whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setDeptError('');
      setDuplicateWarning(null);
      setIsImporting(false);
      checkStatusAndLoad();
    }
  }, [isOpen]);

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
      console.error('Failed to check Drive status:', err);
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const loadFiles = async (search = searchQuery) => {
    setIsLoadingFiles(true);
    setErrorMsg('');
    try {
      const res = await fetchDriveFiles({ search });
      setDriveFiles(res.files || []);
    } catch (err) {
      console.error('Failed to load Drive files:', err);
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    } finally {
      setIsLoadingFiles(false);
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
      console.error('OAuth connection error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectDrive();
      setAuthStatus((prev) => ({ ...prev, authenticated: false }));
      setDriveFiles([]);
      setSelectedFile(null);
      if (onToast) onToast('Google Drive disconnected', 'info');
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
    }
  };

  const handleImport = async (force = false) => {
    if (selectedDeptIds.length === 0) {
      setDeptError('Select at least one department');
      deptDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      deptDropdownRef.current?.focus();
      return;
    }

    if (!selectedFile) {
      setErrorMsg('Please select a file to import from Google Drive.');
      return;
    }

    setIsImporting(true);
    setErrorMsg('');
    setDeptError('');
    setDuplicateWarning(null);

    try {
      const res = await importDriveFile({
        fileId: selectedFile.id,
        departmentIds: selectedDeptIds,
        forceReimport: force
      });

      if (onToast) {
        onToast(`Imported "${selectedFile.name}" into knowledge base!`, 'success');
      }

      if (onImportSuccess) {
        await onImportSuccess(res.data);
      }

      setSelectedFile(null);
      setSelectedDeptIds([]);
      setDeptError('');
      onClose();
    } catch (err) {
      if (err.duplicate) {
        setDuplicateWarning(err.message);
      } else {
        setErrorMsg(getFriendlyErrorMessage(err, 'drive'));
      }
    } finally {
      setIsImporting(false);
    }
  };

  const getFileInfo = (fileType, name = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const type = (fileType || ext || 'pdf').toLowerCase();

    if (type.includes('pdf') || ext === 'pdf') {
      return { label: 'PDF', key: 'pdf', color: '#B42318', bg: '#FEE4E2' };
    }
    if (type.includes('sheet') || type.includes('excel') || ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      return { label: ext.toUpperCase() || 'XLSX', key: 'sheet', color: '#027A48', bg: '#D1FADF' };
    }
    if (type.includes('presentation') || type.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') {
      return { label: ext.toUpperCase() || 'PPTX', key: 'ppt', color: '#B54708', bg: '#FEF0C7' };
    }
    if (type.includes('word') || type.includes('document') || ext === 'docx' || ext === 'doc') {
      return { label: ext.toUpperCase() || 'DOCX', key: 'doc', color: '#175CD3', bg: '#D1E9FF' };
    }
    if (type.includes('text') || ext === 'txt') {
      return { label: 'TXT', key: 'txt', color: '#344054', bg: '#EAECF0' };
    }
    return { label: ext ? ext.toUpperCase() : 'DOC', key: 'file', color: '#475467', bg: '#F2F4F7' };
  };

  const formatModifiedDate = (dateString) => {
    if (!dateString) return 'Modified recently';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 'Modified recently';
      const now = new Date();
      const diffMs = now - d;
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffDays = diffHours / 24;

      if (diffHours < 24 && now.getDate() === d.getDate()) {
        return 'Modified today';
      }
      if (diffDays < 2) {
        return 'Modified yesterday';
      }
      if (diffDays < 7) {
        return `Modified ${Math.floor(diffDays)} days ago`;
      }
      return `Modified ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch {
      return 'Modified recently';
    }
  };

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return null;
    const num = Number(bytes);
    if (isNaN(num)) return null;
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={isImporting ? undefined : onClose}>
      <div
        className="modal-container gdrive-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gdrive-modal-title"
      >
        {/* Fixed Header */}
        <div className="modal-header-row">
          <div className="modal-header-text">
            <h2 id="gdrive-modal-title" className="modal-header-title">
              Google Drive
            </h2>
            <p className="modal-header-subtitle">
              Import documents directly from your Google Drive
            </p>
          </div>
          <button
            type="button"
            className="btn-modal-close-icon"
            onClick={onClose}
            disabled={isImporting}
            aria-label="Close Google Drive dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="modal-content-body gdrive-modal-body">
          {isLoadingStatus ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Loader2 size={28} className="spin" style={{ margin: '0 auto 12px', color: 'var(--primary)' }} />
              <div style={{ fontSize: '14.5px', fontWeight: '500' }}>Checking Google Drive connection...</div>
            </div>
          ) : !authStatus.configured ? (
            <div style={{ padding: '24px', background: '#FEF2F2', borderRadius: '12px', border: '1px solid #FEE2E2', textAlign: 'center' }}>
              <AlertCircle size={32} color="#DC2626" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontWeight: '700', color: '#991B1B', fontSize: '16px', marginBottom: '8px' }}>
                Google OAuth Not Configured
              </div>
              <p style={{ fontSize: '13.5px', color: '#7F1D1D', lineHeight: 1.5, margin: '0 0 16px', maxWidth: '460px', marginLeft: 'auto', marginRight: 'auto' }}>
                To enable Google Drive importing, add your Google OAuth client credentials in your server environment file.
              </p>
              <div style={{ fontSize: '12.5px', color: '#991B1B', background: '#FFFFFF', padding: '12px 14px', borderRadius: '8px', textAlign: 'left', fontFamily: 'monospace', border: '1px solid #FECACA', maxWidth: '440px', margin: '0 auto' }}>
                GOOGLE_CLIENT_ID=your_client_id<br />
                GOOGLE_CLIENT_SECRET=your_client_secret<br />
                GOOGLE_REDIRECT_URI=http://localhost:5000/api/drive/callback
              </div>
            </div>
          ) : !authStatus.authenticated ? (
            /* Auth / Empty State */
            <div className="gdrive-empty-auth-box">
              <div className="gdrive-empty-icon-circle">
                <GoogleDriveIcon size={38} />
              </div>
              <h3 className="gdrive-empty-title">Connect Google Drive</h3>
              <p className="gdrive-empty-desc">
                Connect your Google Drive to import documents into your private college knowledge base.
              </p>
              <button
                type="button"
                className="gdrive-connect-btn"
                onClick={handleConnect}
              >
                <GoogleDriveIcon size={18} />
                <span>Connect Google Drive</span>
                <ExternalLink size={15} />
              </button>
              <div className="gdrive-empty-trust">
                Your files remain private and are only imported when you select them.
              </div>
            </div>
          ) : (
            /* Connected Content */
            <>
              {/* 1. Department Selection (AT THE TOP) */}
              <MultiSelectDropdown
                ref={deptDropdownRef}
                label="Department"
                required={true}
                options={departments}
                selectedIds={selectedDeptIds}
                onChange={(newIds) => {
                  setSelectedDeptIds(newIds);
                  if (newIds.length > 0) setDeptError('');
                }}
                error={deptError}
                placeholder="Select departments"
                id="gdrive-dept-select"
              />

              {/* 2. Search Bar & Status Controls */}
              <div className="gdrive-top-bar">
                <div className="gdrive-search-wrap">
                  <Search size={16} className="gdrive-search-icon" />
                  <input
                    type="text"
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFiles(searchQuery)}
                    className="gdrive-search-input"
                    aria-label="Search Drive files"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="gdrive-search-clear"
                      onClick={() => {
                        setSearchQuery('');
                        loadFiles('');
                      }}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="gdrive-status-controls">
                  <span className="gdrive-status-badge">
                    <span className="gdrive-status-dot" /> Connected
                  </span>
                  <button
                    type="button"
                    className="btn-gdrive-action"
                    onClick={() => loadFiles()}
                    disabled={isLoadingFiles}
                    title="Refresh file list"
                    aria-label="Refresh files"
                  >
                    <RefreshCw size={14} className={isLoadingFiles ? 'spin' : ''} />
                  </button>
                  <button
                    type="button"
                    className="btn-gdrive-disconnect"
                    onClick={handleDisconnect}
                    title="Disconnect Google Drive"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* 3. Available Files Heading */}
              <div className="gdrive-section-title-row">
                <span className="gdrive-section-title">Available files</span>
                <span className="gdrive-section-count">
                  {driveFiles.length} {driveFiles.length === 1 ? 'file' : 'files'}
                </span>
              </div>

              {/* 4. Scrollable Available Files List ONLY */}
              <div className="gdrive-file-list" role="listbox" aria-label="Available Google Drive files">
                {isLoadingFiles ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
                    <Loader2 size={22} className="spin" style={{ margin: '0 auto 8px', color: 'var(--primary)' }} />
                    <div>Loading documents from Drive...</div>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
                    {searchQuery ? 'No documents match your search.' : 'No supported documents found in Google Drive.'}
                  </div>
                ) : (
                  driveFiles.map((f) => {
                    const isSelected = selectedFile?.id === f.id;
                    const info = getFileInfo(f.fileType, f.name);
                    const formattedDate = formatModifiedDate(f.modifiedTime);
                    const sizeStr = formatSize(f.size);

                    return (
                      <div
                        key={f.id}
                        className={`gdrive-file-row ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedFile(f)}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedFile(f);
                          }
                        }}
                      >
                        <div className="gdrive-file-left">
                          <div
                            className="gdrive-file-icon-box"
                            style={{ background: info.bg, color: info.color }}
                          >
                            {info.key === 'sheet' ? (
                              <FileSpreadsheet size={18} />
                            ) : info.key === 'file' ? (
                              <File size={18} />
                            ) : (
                              <FileText size={18} />
                            )}
                          </div>
                          <div className="gdrive-file-info">
                            <div className="gdrive-file-name" title={f.name}>
                              {f.name}
                            </div>
                            <div className="gdrive-file-meta">
                              <span className="gdrive-badge-type">{info.label}</span>
                              <span>•</span>
                              <span>{formattedDate}</span>
                              {sizeStr && (
                                <>
                                  <span>•</span>
                                  <span>{sizeStr}</span>
                                </>
                              )}
                              {f.isGoogleNative && (
                                <>
                                  <span>•</span>
                                  <span style={{ color: '#027A48' }}>Google Doc</span>
                                </>
                              )}
                              {f.isImported && (
                                <span className="gdrive-imported-pill">
                                  Imported
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="gdrive-file-right">
                          <div className={`gdrive-select-indicator ${isSelected ? 'selected' : ''}`}>
                            <div className="gdrive-radio-circle">
                              {isSelected && <div className="gdrive-radio-dot" />}
                            </div>
                            <span>
                              {isSelected ? 'Selected' : 'Select'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 5. Duplicate Warning Dialog */}
              {duplicateWarning && (
                <div style={{ padding: '12px 16px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '10px' }}>
                  <div style={{ fontSize: '13.5px', color: '#92400E', fontWeight: '600', marginBottom: '8px' }}>
                    {duplicateWarning}
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      onClick={() => handleImport(true)}
                      style={{
                        padding: '6px 14px',
                        background: '#D97706',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Re-import Document
                    </button>
                    <button
                      type="button"
                      onClick={() => setDuplicateWarning(null)}
                      style={{
                        padding: '6px 14px',
                        background: 'transparent',
                        border: '1px solid #D97706',
                        color: '#92400E',
                        borderRadius: '6px',
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Dynamic Loading Status UI */}
          {isImporting && (
            <div className="upload-progress-container" style={{ margin: '14px 0' }}>
              <div className="upload-progress-header">
                <Loader2 size={16} className="spin upload-spinner" style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <span>
                  {isLargeFile
                    ? 'Just a moment, your file is large so it takes some time to extract text and diagrams...'
                    : 'Uploading and processing document...'}
                </span>
              </div>
              <div className="upload-progress-bar">
                <div className="upload-progress-fill" />
              </div>
            </div>
          )}

          {/* General Error Message */}
          {errorMsg && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              background: '#FEF2F2',
              border: '1px solid #FEE2E2',
              borderRadius: '8px',
              color: 'var(--danger)',
              fontSize: '13px'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        {authStatus.authenticated && (
          <div className="modal-footer-row">
            <button
              type="button"
              className="btn-modal-cancel"
              onClick={onClose}
              disabled={isImporting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-modal-primary"
              onClick={() => handleImport(false)}
              disabled={isImporting || !selectedFile}
            >
              {isImporting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Importing Selected...</span>
                </>
              ) : (
                <span>Import Selected</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
