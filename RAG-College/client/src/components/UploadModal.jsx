import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  AlertCircle,
  Loader2,
  Globe,
  Lock,
  FileText,
  Info,
  Building2
} from 'lucide-react';
import MultiSelectDropdown from './MultiSelectDropdown';
import { getFriendlyErrorMessage } from '../utils/errorHandler';
import { isDepartmentAdmin, getUserDepartmentIds } from '../utils/access';

export default function UploadModal({
  isOpen,
  onClose,
  departments = [],
  onUploadSuccess,
  onToast,
  reuploadDoc = null,
  onReupload,
  currentUser = null
}) {
  const [stagedFiles, setStagedFiles] = useState([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [isPublic, setIsPublic] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deptError, setDeptError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const deptDropdownRef = useRef(null);

  const isReupload = !!reuploadDoc;
  const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024;
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const MAX_BATCH_FILES = 10;
  const DROPZONE_MIN_HEIGHT = '160px'; // change this to make the drop zone taller or shorter

  const supportedExtensions = ['.pdf', '.doc', '.docx', '.csv', '.xls', '.xlsx', '.txt', '.ppt', '.pptx'];

  // Department Admins upload into their own department(s).
  const scoped = isDepartmentAdmin(currentUser);
  // With exactly one department there is nothing to choose, so it is fixed.
  const lockedDept = scoped && departments.length === 1 ? departments[0] : null;
  // Super Admin, or a Department Admin with more than 1 department, can publish to everyone.
  const canPublish = !scoped || getUserDepartmentIds(currentUser).length > 1;
  const publicMode = canPublish && isPublic;
  const effectiveDeptIds = lockedDept ? [String(lockedDept._id)] : selectedDeptIds;

  const handleClose = () => {
    if (isUploading) return;
    setStagedFiles([]);
    setIsLargeFile(false);
    setIsPublic(false);
    setSelectedDeptIds([]);
    setErrorMsg('');
    setDeptError('');
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setStagedFiles([]);
      setIsLargeFile(false);
      setIsUploading(false);
      setErrorMsg('');
      setDeptError('');
      setIsPublic(Boolean(reuploadDoc?.isPublic));
      setSelectedDeptIds(reuploadDoc?.departmentIds ? [...reuploadDoc.departmentIds] : []);
    }
  }, [isOpen, reuploadDoc]);

  if (!isOpen) return null;

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getExtLabel = (name) => {
    const parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toUpperCase().slice(0, 4) : 'FILE';
  };

  const totalBatchSize = stagedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const maxSizeLabel = formatSize(MAX_FILE_SIZE).replace('.0', '');

  const handleFiles = (incomingFiles) => {
    setErrorMsg('');
    const newValidFiles = [];
    const incomingArray = Array.from(incomingFiles);

    if (!isReupload && stagedFiles.length + incomingArray.length > MAX_BATCH_FILES) {
      setErrorMsg(`Max ${MAX_BATCH_FILES} files allowed.`);
      return;
    }

    for (const file of incomingArray) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!supportedExtensions.includes(ext)) {
        setErrorMsg(`"${file.name}" has an unsupported format.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setErrorMsg(`"${file.name}" exceeds 25 MB.`);
        continue;
      }
      const isDuplicate = stagedFiles.some((f) => f.name === file.name && f.size === file.size);
      if (!isDuplicate) newValidFiles.push(file);
    }

    if (newValidFiles.length > 0) {
      const nextFiles = isReupload ? [newValidFiles[0]] : [...stagedFiles, ...newValidFiles];
      setStagedFiles(nextFiles);
      setIsLargeFile(nextFiles.some((f) => f.size > LARGE_FILE_THRESHOLD));
    }
  };

  const handleUploadSubmit = async () => {
    if (!publicMode && effectiveDeptIds.length === 0) {
      setDeptError('Please assign at least 1 department.');
      deptDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      deptDropdownRef.current?.focus();
      return;
    }

    if (stagedFiles.length === 0) {
      setErrorMsg('Please select a document to upload.');
      return;
    }

    setIsUploading(true);
    setErrorMsg('');
    setDeptError('');

    try {
      if (isReupload) {
        await onReupload(reuploadDoc, stagedFiles[0], effectiveDeptIds);
        handleClose();
        return;
      }

      const formData = new FormData();
      stagedFiles.forEach((f) => formData.append('files', f));
      formData.append('departmentIds', JSON.stringify(effectiveDeptIds));
      formData.append('isPublic', String(publicMode));

      await onUploadSuccess(formData);
      if (onToast) onToast('Documents uploaded successfully!', 'success');
      handleClose();
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'upload'));
    } finally {
      setIsUploading(false);
    }
  };

  // ---- Derived UI state (display only) ----
  const hasFiles = stagedFiles.length > 0;
  const needsDepartment = !publicMode && effectiveDeptIds.length === 0;
  const uploadDisabled = isUploading || !hasFiles;

  let footerHint = '';
  if (!hasFiles) footerHint = 'Add at least one file to continue';
  else if (needsDepartment) footerHint = 'Select a department before uploading';

  const primaryLabel = isUploading
    ? 'Uploading...'
    : isReupload
      ? 'Replace File'
      : hasFiles
        ? `Upload ${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''}`
        : 'Upload Now';

  const handleDropzoneKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <style>{`
        @keyframes upload-progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>

      <div
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-label={isReupload ? 'Replace Document' : 'Upload Documents'}
        style={{
          maxWidth: '580px',
          width: '92%',
          background: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '92vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          borderBottom: '1px solid #E2E8F0'
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              {isReupload ? 'Replace Document' : 'Upload Documents'}
            </h2>
            <p style={{ fontSize: '13.5px', color: '#475569', margin: '4px 0 0' }}>
              Add PDF, Word, Excel, or Text files to the knowledge base
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Close"
            style={{
              background: '#F1F5F9',
              border: 'none',
              borderRadius: '10px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              color: '#334155',
              flexShrink: 0
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: '1 1 auto', minHeight: 'min(460px, calc(92vh - 200px))' }}>
          {/* Access toggle + helper text */}
          <div style={{ marginBottom: '18px' }}>
            <div style={{
              background: '#F8FAFC',
              padding: '10px 14px',
              borderRadius: '12px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {publicMode ? <Globe size={17} color="#15803D" /> : <Lock size={17} color="#334155" />}
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1E293B' }}>
                  {publicMode ? 'Public (All Departments)' : 'Department Private Access'}
                </span>
              </div>

              {/* Super Admin, or a Department Admin with more than 1 department, can publish to everyone */}
              {canPublish && (
                <div style={{ display: 'flex', background: '#E2E8F0', padding: '3px', borderRadius: '9px', gap: '2px' }}>
                  <button
                    type="button"
                    aria-pressed={!isPublic}
                    onClick={() => { setIsPublic(false); setDeptError(''); }}
                    style={{
                      border: 'none',
                      padding: '6px 14px',
                      minHeight: '32px',
                      borderRadius: '7px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: !isPublic ? '#FFFFFF' : 'transparent',
                      color: !isPublic ? '#0F172A' : '#475569',
                      boxShadow: !isPublic ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
                    }}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    aria-pressed={isPublic}
                    onClick={() => { setIsPublic(true); setSelectedDeptIds([]); setDeptError(''); }}
                    style={{
                      border: 'none',
                      padding: '6px 14px',
                      minHeight: '32px',
                      borderRadius: '7px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: isPublic ? '#15803D' : 'transparent',
                      color: isPublic ? '#FFFFFF' : '#475569',
                      boxShadow: isPublic ? '0 1px 3px rgba(0,0,0,0.12)' : 'none'
                    }}
                  >
                    Public
                  </button>
                </div>
              )}
            </div>
            <p style={{ fontSize: '12.5px', color: '#475569', margin: '8px 2px 0', lineHeight: 1.4 }}>
              {publicMode
                ? 'Everyone in every department can view and search these files.'
                : !canPublish
                  ? 'Only people in your department can view and search these files.'
                  : 'Only the selected departments can view and search these files.'}
            </p>
          </div>

          {/* Department: fixed label for a single-department admin, dropdown otherwise */}
          {!publicMode && lockedDept && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Uploading to department
              </div>
              <div style={{
                minHeight: '42px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 14px',
                borderRadius: '10px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: '14px',
                fontWeight: 600,
                color: '#0F172A'
              }}>
                <Building2 size={16} color="#1D4ED8" />
                <span>{lockedDept.name}</span>
                {lockedDept.code && (
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#1D4ED8',
                    background: '#EFF6FF',
                    padding: '2px 8px',
                    borderRadius: '6px'
                  }}>
                    {lockedDept.code}
                  </span>
                )}
              </div>
            </div>
          )}

          {!publicMode && !lockedDept && (
            <div style={{ marginBottom: '18px' }}>
              <MultiSelectDropdown
                ref={deptDropdownRef}
                label="Assign Target Department(s)"
                required={true}
                options={departments}
                selectedIds={selectedDeptIds}
                onChange={(ids) => {
                  setSelectedDeptIds(ids);
                  if (ids.length > 0) setDeptError('');
                }}
                error={deptError}
                placeholder="Choose 1 or more departments..."
                id="upload-dept-select"
              />
            </div>
          )}

          {/* Dropzone */}
          <div
            className="upload-dz-compact"
            role="button"
            tabIndex={0}
            aria-label="Browse or drag and drop files"
            onKeyDown={handleDropzoneKey}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '20px 16px',
              boxSizing: 'border-box',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: DROPZONE_MIN_HEIGHT,
              textAlign: 'center',
              border: isDragging ? '2px dashed #1D4ED8' : '2px dashed #93B4F5',
              borderRadius: '12px',
              cursor: 'pointer',
              background: isDragging ? '#DBEAFE' : '#F5F8FF',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: 'background 0.15s ease, border-color 0.15s ease'
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple={!isReupload}
              accept={supportedExtensions.join(',')}
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = null;
              }}
            />
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: '#DBEAFE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <UploadCloud size={26} color="#1D4ED8" />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                Click to browse or drag & drop files
              </div>
              <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '2px' }}>
                PDF, DOCX, XLSX, TXT, CSV · up to {maxSizeLabel} each
              </div>
            </div>
          </div>

          {/* Inline error */}
          {errorMsg && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '10px',
                color: '#991B1B',
                fontSize: '13px',
                marginTop: '12px'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Staged Files */}
          {hasFiles && (
            <div style={{ marginTop: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '13px',
                color: '#475569',
                marginBottom: '8px'
              }}>
                <span style={{ fontWeight: 600, color: '#1E293B' }}>
                  Selected files ({stagedFiles.length})
                </span>
                {!isReupload && (
                  <button
                    type="button"
                    onClick={() => setStagedFiles([])}
                    disabled={isUploading}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px 6px',
                      color: '#B91C1C',
                      cursor: isUploading ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div style={{
                maxHeight: '170px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                {stagedFiles.map((file, idx) => (
                  <div
                    key={`${file.name}-${file.size}-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 8px 8px 12px',
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '10px'
                    }}
                  >
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: '#EEF2FF',
                      color: '#3730A3',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      {getExtLabel(file.name) || <FileText size={16} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13.5px',
                        color: '#0F172A',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#475569', marginTop: '1px' }}>
                        {formatSize(file.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      disabled={isUploading}
                      onClick={() => {
                        const next = stagedFiles.filter((_, i) => i !== idx);
                        setStagedFiles(next);
                        setIsLargeFile(next.some((f) => f.size > LARGE_FILE_THRESHOLD));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#475569',
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>

              {isLargeFile && !isUploading && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '10px',
                  fontSize: '12.5px',
                  color: '#475569'
                }}>
                  <Info size={14} style={{ flexShrink: 0 }} />
                  <span>Larger files can take a little longer to upload and process.</span>
                </div>
              )}
            </div>
          )}

          {/* Upload progress (indeterminate, since the upload API reports no percentage) */}
          {isUploading && (
            <div style={{ marginTop: '16px' }} role="status" aria-live="polite">
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12.5px',
                color: '#334155',
                marginBottom: '6px',
                fontWeight: 600
              }}>
                <span>Uploading {stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''}...</span>
                <span style={{ fontWeight: 500, color: '#475569' }}>{formatSize(totalBatchSize)}</span>
              </div>
              <div style={{
                height: '6px',
                width: '100%',
                background: '#E2E8F0',
                borderRadius: '999px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: '30%',
                  background: '#1D4ED8',
                  borderRadius: '999px',
                  animation: 'upload-progress-slide 1.2s ease-in-out infinite'
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          background: '#F8FAFC'
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: '#334155', fontWeight: 600 }}>
              {hasFiles
                ? `${stagedFiles.length} file${stagedFiles.length > 1 ? 's' : ''} · ${formatSize(totalBatchSize)}`
                : 'No files selected'}
            </div>
            {footerHint && !isUploading && (
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                {footerHint}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={isUploading}
              style={{
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: '10px',
                padding: '0 16px',
                minHeight: '40px',
                fontSize: '13.5px',
                fontWeight: 600,
                color: '#334155',
                cursor: isUploading ? 'not-allowed' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUploadSubmit}
              disabled={uploadDisabled}
              title={!hasFiles ? 'Add at least one file to upload' : undefined}
              style={{
                background: uploadDisabled ? '#94A3B8' : '#1D4ED8',
                border: 'none',
                borderRadius: '10px',
                padding: '0 18px',
                minHeight: '40px',
                fontSize: '13.5px',
                fontWeight: 600,
                color: '#FFFFFF',
                cursor: uploadDisabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isUploading ? <Loader2 size={15} className="spin" /> : null}
              <span>{primaryLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}