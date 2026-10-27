import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  X,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Globe,
  Lock,
  Building2,
  CheckCircle2
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

  const supportedExtensions = ['.pdf', '.doc', '.docx', '.csv', '.xls', '.xlsx', '.txt', '.ppt', '.pptx'];

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

  const totalBatchSize = stagedFiles.reduce((acc, f) => acc + (f.size || 0), 0);

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
    if (!isPublic && selectedDeptIds.length === 0) {
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
        await onReupload(reuploadDoc, stagedFiles[0], selectedDeptIds);
        handleClose();
        return;
      }

      const formData = new FormData();
      stagedFiles.forEach((f) => formData.append('files', f));
      formData.append('departmentIds', JSON.stringify(selectedDeptIds));
      formData.append('isPublic', String(isPublic));

      await onUploadSuccess(formData);
      if (onToast) onToast('Documents uploaded successfully!', 'success');
      handleClose();
    } catch (err) {
      setErrorMsg(getFriendlyErrorMessage(err, 'upload'));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal-container"
        style={{
          maxWidth: '540px',
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
              {isReupload ? 'Replace Document' : 'Upload Documents'}
            </h2>
            <p style={{ fontSize: '12.5px', color: '#64748B', margin: '2px 0 0' }}>
              Add PDF, Word, Excel, or Text files to the knowledge base
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
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
          {/* Segmented Control Bar */}
          <div style={{
            background: '#F8FAFC',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid #E2E8F0',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isPublic ? <Globe size={16} color="#16A34A" /> : <Lock size={16} color="#475467" />}
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                {isPublic ? 'Public (All Departments)' : 'Department Private Access'}
              </span>
            </div>

            <div style={{ display: 'flex', background: '#E2E8F0', padding: '2px', borderRadius: '7px' }}>
              <button
                type="button"
                onClick={() => { setIsPublic(false); setDeptError(''); }}
                style={{
                  border: 'none',
                  padding: '4px 12px',
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
                onClick={() => { setIsPublic(true); setSelectedDeptIds([]); setDeptError(''); }}
                style={{
                  border: 'none',
                  padding: '4px 12px',
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

          {/* Department Select if Private */}
          {!isPublic && (
            <div style={{ marginBottom: '16px' }}>
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
            className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '24px 16px',
              border: isDragging ? '2px dashed #2563EB' : '2px dashed #E2E8F0',
              borderRadius: '12px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? '#EFF6FF' : '#FAFAFA'
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
            <UploadCloud size={30} color="#2563EB" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1E293B' }}>
              Click to browse or drag & drop files
            </div>
            <div style={{ fontSize: '11.5px', color: '#94A3B8', marginTop: '4px' }}>
              PDF, DOCX, XLSX, TXT, CSV (up to 25 MB)
            </div>
          </div>

          {/* Staged Files Cards */}
          {stagedFiles.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748B', marginBottom: '6px' }}>
                <span>Selected ({stagedFiles.length}) • {formatSize(totalBatchSize)}</span>
                <span
                  onClick={() => setStagedFiles([])}
                  style={{ color: '#DC2626', cursor: 'pointer', fontWeight: 500 }}
                >
                  Clear all
                </span>
              </div>
              <div style={{ maxHeight: '130px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {stagedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px'
                    }}
                  >
                    <div style={{ fontSize: '12.5px', color: '#1E293B', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '2px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
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
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid #F1F5F9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '8px',
          background: '#FAFAFA'
        }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
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
            onClick={handleUploadSubmit}
            disabled={isUploading || stagedFiles.length === 0}
            style={{
              background: stagedFiles.length > 0 ? '#2563EB' : '#94A3B8',
              border: 'none',
              borderRadius: '7px',
              padding: '7px 16px',
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#FFFFFF',
              cursor: stagedFiles.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isUploading ? <Loader2 size={14} className="spin" /> : null}
            <span>{isUploading ? 'Uploading...' : 'Upload Now'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}