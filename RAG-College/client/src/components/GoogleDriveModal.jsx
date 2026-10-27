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
  File,
  Globe,
  Lock,
  CheckSquare,
  Square
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
  // MULTI-SELECTION STATE (Array of selected file objects)
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressText, setImportProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [deptError, setDeptError] = useState('');

  const deptDropdownRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setDeptError('');
      setIsImporting(false);
      setIsPublic(false);
      setSelectedDeptIds([]);
      setSelectedFiles([]);
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
      } else {
        return [...prev, file];
      }
    });
  };

  // Batch import handler
  const handleBatchImport = async () => {
    if (!isPublic && selectedDeptIds.length === 0) {
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
            departmentIds: selectedDeptIds,
            isPublic: isPublic,
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
    const ext = (name.split('.').pop() || '').toLowerCase();
    const type = (fileType || ext || 'pdf').toLowerCase();

    if (type.includes('pdf') || ext === 'pdf') {
      return { label: 'PDF', bg: '#FEE4E2', color: '#B42318', icon: <FileText size={18} /> };
    }
    if (type.includes('sheet') || type.includes('excel') || ['xlsx', 'xls', 'csv'].includes(ext)) {
      return { label: ext.toUpperCase() || 'XLSX', bg: '#D1FADF', color: '#027A48', icon: <FileSpreadsheet size={18} /> };
    }
    return { label: ext ? ext.toUpperCase() : 'DOC', bg: '#EFF4FF', color: '#175CD3', icon: <File size={18} /> };
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

  return (
    <div className="modal-backdrop" onClick={isImporting ? undefined : onClose}>
      <div
        className="modal-container"
        style={{
          maxWidth: '560px',
          width: '92%',
          background: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #F1F5F9'
        }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Import from Google Drive
            </h2>
            <p style={{ fontSize: '12.5px', color: '#64748B', margin: '2px 0 0' }}>
              Select one or multiple documents to index into the knowledge base
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            style={{
              background: '#F8FAFC',
              border: 'none',
              borderRadius: '8px',
              padding: '6px',
              cursor: 'pointer',
              color: '#64748B'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: '70vh' }}>
          {isLoadingStatus ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Loader2 size={24} className="spin" style={{ color: '#2563EB', margin: '0 auto 8px' }} />
              <div style={{ fontSize: '13px', color: '#64748B' }}>Connecting to Drive...</div>
            </div>
          ) : !authStatus.authenticated ? (
            <div style={{
              textAlign: 'center',
              padding: '32px 16px',
              background: '#F8FAFC',
              borderRadius: '12px',
              border: '1px dashed #CBD5E1'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: '#FFFFFF',
                boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px'
              }}>
                <GoogleDriveIcon size={26} />
              </div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>
                Connect your account
              </h3>
              <p style={{ fontSize: '12.5px', color: '#64748B', maxWidth: '340px', margin: '0 auto 16px' }}>
                Link your Google Drive securely to browse and import your college documents.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                style={{
                  background: '#2563EB',
                  color: '#FFFFFF',
                  padding: '9px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
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
            </div>
          ) : (
            <>
              {/* Access Control Switcher */}
              <div style={{
                background: '#F8FAFC',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid #E2E8F0',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isPublic ? <Globe size={16} color="#16A34A" /> : <Lock size={16} color="#475467" />}
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                    {isPublic ? 'Public Document (All Departments)' : 'Department Private Access'}
                  </span>
                </div>

                <div style={{ display: 'flex', background: '#E2E8F0', padding: '2px', borderRadius: '7px' }}>
                  <button
                    type="button"
                    onClick={() => handleScopeChange(false)}
                    style={{
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '5px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: !isPublic ? '#FFFFFF' : 'transparent',
                      color: !isPublic ? '#0F172A' : '#64748B',
                      boxShadow: !isPublic ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                    }}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScopeChange(true)}
                    style={{
                      border: 'none',
                      padding: '4px 10px',
                      borderRadius: '5px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: isPublic ? '#16A34A' : 'transparent',
                      color: isPublic ? '#FFFFFF' : '#64748B',
                      boxShadow: isPublic ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                    }}
                  >
                    Public
                  </button>
                </div>
              </div>

              {/* Department Selector */}
              {!isPublic && (
                <div style={{ marginBottom: '14px' }}>
                  <MultiSelectDropdown
                    ref={deptDropdownRef}
                    label="Assign Target Department(s)"
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
                </div>
              )}

              {/* Search & Actions Bar */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '10px'
              }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
                  <input
                    type="text"
                    placeholder="Search drive files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadFiles(searchQuery)}
                    style={{
                      width: '100%',
                      padding: '6px 10px 6px 30px',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {/* Quick Select All / Deselect All Toggle */}
                {driveFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedFiles.length === driveFiles.length) {
                        setSelectedFiles([]);
                      } else {
                        setSelectedFiles([...driveFiles]);
                      }
                    }}
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '6px 10px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: '#475467',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {selectedFiles.length === driveFiles.length ? 'Clear All' : 'Select All'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => loadFiles()}
                  disabled={isLoadingFiles}
                  title="Refresh"
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    color: '#64748B'
                  }}
                >
                  <RefreshCw size={13} className={isLoadingFiles ? 'spin' : ''} />
                </button>
              </div>

              {/* Files Multi-Select List */}
              <div style={{
                maxHeight: '220px',
                overflowY: 'auto',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                background: '#FFFFFF'
              }}>
                {isLoadingFiles ? (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: '#94A3B8', fontSize: '12px' }}>
                    <Loader2 size={18} className="spin" style={{ margin: '0 auto 6px', color: '#2563EB' }} />
                    Loading files...
                  </div>
                ) : driveFiles.length === 0 ? (
                  <div style={{ padding: '30px 0', textAlign: 'center', color: '#94A3B8', fontSize: '12.5px' }}>
                    No files found.
                  </div>
                ) : (
                  driveFiles.map((f) => {
                    const isSelected = selectedFiles.some((selected) => selected.id === f.id);
                    const info = getFileInfo(f.fileType, f.name);
                    const sizeStr = formatSize(f.size);

                    return (
                      <div
                        key={f.id}
                        onClick={() => toggleFileSelect(f)}
                        style={{
                          padding: '9px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          cursor: 'pointer',
                          background: isSelected ? '#EFF6FF' : '#FFFFFF',
                          borderBottom: '1px solid #F1F5F9',
                          transition: 'background 0.1s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <div style={{
                            padding: '6px',
                            borderRadius: '6px',
                            background: info.bg,
                            color: info.color,
                            flexShrink: 0,
                            display: 'flex'
                          }}>
                            {info.icon}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: '12.5px',
                              fontWeight: isSelected ? 600 : 500,
                              color: isSelected ? '#1E40AF' : '#1E293B',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}>
                              {f.name}
                            </div>
                            <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                              {info.label} {sizeStr && `• ${sizeStr}`}
                            </div>
                          </div>
                        </div>

                        {isSelected ? (
                          <CheckSquare size={18} color="#2563EB" style={{ flexShrink: 0 }} />
                        ) : (
                          <Square size={18} color="#CBD5E1" style={{ flexShrink: 0 }} />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Progress message during batch execution */}
          {isImporting && (
            <div style={{
              marginTop: '12px',
              padding: '10px 14px',
              background: '#EFF6FF',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: '#1E40AF'
            }}>
              <Loader2 size={15} className="spin" />
              <span>{importProgressText || 'Importing selected files...'}</span>
            </div>
          )}

          {errorMsg && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 12px',
              background: '#FEF2F2',
              borderRadius: '8px',
              color: '#DC2626',
              fontSize: '12px',
              marginTop: '12px'
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span style={{ whiteSpace: 'pre-line' }}>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        {authStatus.authenticated && (
          <div style={{
            padding: '14px 24px',
            borderTop: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#FAFAFA'
          }}>
            <button
              type="button"
              onClick={handleDisconnect}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: '11.5px',
                cursor: 'pointer'
              }}
            >
              Disconnect Drive
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isImporting}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: '7px',
                  padding: '7px 14px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: '#475467',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBatchImport}
                disabled={isImporting || selectedFiles.length === 0}
                style={{
                  background: selectedFiles.length > 0 ? '#2563EB' : '#94A3B8',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '7px 16px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  cursor: selectedFiles.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {isImporting ? <Loader2 size={14} className="spin" /> : null}
                <span>
                  {selectedFiles.length > 0
                    ? `Import (${selectedFiles.length}) Files`
                    : 'Import Selected'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}