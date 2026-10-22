import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import MultiSelectDropdown from './MultiSelectDropdown';
import { getFriendlyErrorMessage } from '../utils/errorHandler';

export default function UploadModal({
  isOpen,
  onClose,
  departments = [],
  onUploadSuccess,
  onToast,
  reuploadDoc = null,
  onReupload
}) {
  const [stagedFiles, setStagedFiles] = useState([]);
  const [selectedDeptIds, setSelectedDeptIds] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [deptError, setDeptError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const deptDropdownRef = useRef(null);

  const isReupload = !!reuploadDoc;
  const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

  const handleClose = () => {
    if (isUploading) return;
    setStagedFiles([]);
    setIsLargeFile(false);
    setErrorMsg('');
    setDeptError('');
    onClose();
  };

  // Reset / prefill when the modal opens (re-upload prefills the document's departments)
  useEffect(() => {
    if (isOpen) {
      setStagedFiles([]);
      setIsLargeFile(false);
      setIsUploading(false);
      setErrorMsg('');
      setDeptError('');
      setSelectedDeptIds(reuploadDoc?.departmentIds ? [...reuploadDoc.departmentIds] : []);
    }
  }, [isOpen, reuploadDoc]);

  if (!isOpen) return null;

  const supportedExtensions = ['.pdf', '.doc', '.docx', '.csv', '.xls', '.xlsx', '.txt', '.ppt', '.pptx'];

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileBadge = (name = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return { label: 'PDF', bg: '#FEE4E2', color: '#B42318' };
    if (['xlsx', 'xls', 'csv'].includes(ext)) return { label: ext.toUpperCase(), bg: '#D1FADF', color: '#027A48' };
    if (['pptx', 'ppt'].includes(ext)) return { label: ext.toUpperCase(), bg: '#FEF0C7', color: '#B54708' };
    if (['docx', 'doc'].includes(ext)) return { label: ext.toUpperCase(), bg: '#D1E9FF', color: '#175CD3' };
    if (ext === 'txt') return { label: 'TXT', bg: '#EAECF0', color: '#344054' };
    return { label: ext ? ext.toUpperCase() : 'DOC', bg: '#F2F4F7', color: '#475467' };
  };

  const handleFiles = (incomingFiles) => {
    setErrorMsg('');
    const newValidFiles = [];

    Array.from(incomingFiles).forEach((file) => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (supportedExtensions.includes(ext)) {
        if (!stagedFiles.some((f) => f.name === file.name && f.size === file.size)) {
          newValidFiles.push(file);
        }
      } else {
        setErrorMsg(`"${file.name}" has an unsupported format. Please use PDF, Word, Excel, or PowerPoint files.`);
      }
    });

    if (newValidFiles.length > 0) {
      // Re-upload replaces with exactly one file
      const nextFiles = isReupload ? [newValidFiles[0]] : [...stagedFiles, ...newValidFiles];
      setStagedFiles(nextFiles);
      setIsLargeFile(nextFiles.some((f) => f.size > LARGE_FILE_THRESHOLD));
    }
  };

  const handleRemoveFile = (index) => {
    setStagedFiles((prev) => {
      const nextFiles = prev.filter((_, idx) => idx !== index);
      setIsLargeFile(nextFiles.some((f) => f.size > LARGE_FILE_THRESHOLD));
      return nextFiles;
    });
  };

  const handleUploadSubmit = async () => {
    if (selectedDeptIds.length === 0) {
      setDeptError('Select at least one department');
      deptDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      deptDropdownRef.current?.focus();
      return;
    }

    if (stagedFiles.length === 0) {
      setErrorMsg('Please select at least one document to upload.');
      return;
    }

    setIsLargeFile(stagedFiles.some((f) => f.size > LARGE_FILE_THRESHOLD));
    setIsUploading(true);
    setErrorMsg('');
    setDeptError('');

    try {
      if (isReupload) {
        await onReupload(reuploadDoc, stagedFiles[0], selectedDeptIds);
        setStagedFiles([]);
        setIsLargeFile(false);
        setSelectedDeptIds([]);
        onClose();
        return;
      }

      const formData = new FormData();
      stagedFiles.forEach((file) => {
        formData.append('files', file);
      });

      formData.append('departmentIds', JSON.stringify(selectedDeptIds));

      await onUploadSuccess(formData);

      if (onToast) {
        onToast(`Uploaded ${stagedFiles.length} ${stagedFiles.length === 1 ? 'document' : 'documents'} successfully!`, 'success');
      }

      // Reset state and close
      setStagedFiles([]);
      setIsLargeFile(false);
      setSelectedDeptIds([]);
      setDeptError('');
      onClose();
    } catch (err) {
      console.error('Upload failed:', err);
      setErrorMsg(getFriendlyErrorMessage(err, 'upload'));
      setIsLargeFile(false);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal-container upload-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-modal-title"
      >
        {/* Modal Header */}
        <div className="modal-header-row">
          <div className="modal-header-text">
            <h2 id="upload-modal-title" className="modal-header-title">
              {isReupload ? 'Re-upload Document' : 'Upload Document'}
            </h2>
            <p className="modal-header-subtitle">
              {isReupload
                ? `Select a replacement file for "${reuploadDoc.filename || reuploadDoc.originalFilename || reuploadDoc.originalName || 'this document'}"`
                : 'Add a document to your college knowledge base'}
            </p>
          </div>
          <button
            type="button"
            className="btn-modal-close-icon"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Close upload dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-content-body upload-modal-body">
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
            id="upload-dept-select"
          />

          {/* 2. Upload Dropzone */}
          <div
            className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) {
                handleFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple={!isReupload}
              accept={supportedExtensions.join(',')}
              className="upload-file-input"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
              }}
              tabIndex={-1}
            />
            <div className="upload-dropzone-icon">
              <UploadCloud size={34} strokeWidth={1.8} />
            </div>
            <div className="upload-dropzone-title">
              Drag & drop your document here
            </div>
            <div className="upload-dropzone-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="upload-choose-file-btn"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Choose File
            </button>
            <div className="upload-dropzone-formats">
              PDF • DOCX • XLSX • PPTX • TXT
            </div>
          </div>

          {/* 3. Staged Files List */}
          {stagedFiles.length > 0 && (
            <div className="upload-selected-section">
              <div className="upload-selected-title">
                Selected Documents ({stagedFiles.length})
              </div>
              <div className="upload-staged-list">
                {stagedFiles.map((file, idx) => {
                  const badge = getFileBadge(file.name);
                  return (
                    <div key={idx} className="upload-staged-card">
                      <div className="upload-staged-left">
                        <div className="upload-staged-check">
                          <Check size={14} strokeWidth={2.4} />
                        </div>
                        <div className="upload-staged-info">
                          <div className="upload-staged-name" title={file.name}>
                            {file.name}
                          </div>
                          <div className="upload-staged-meta">
                            <span className="upload-staged-type">{badge.label}</span>
                            <span>•</span>
                            <span>{formatSize(file.size)}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-remove-staged"
                        onClick={() => handleRemoveFile(idx)}
                        disabled={isUploading}
                        title="Remove file"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Upload Progress / Loading */}
          {isUploading && (
            <div className="upload-progress-container">
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

          {/* 5. General Error Message */}
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

        {/* Modal Footer */}
        <div className="modal-footer-row">
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={handleClose}
            disabled={isUploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-modal-primary"
            onClick={handleUploadSubmit}
            disabled={isUploading || stagedFiles.length === 0}
          >
            {isUploading ? (
              <>
                <Loader2 size={16} className="spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <span>{isReupload ? 'Replace Document' : 'Upload Document'}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
