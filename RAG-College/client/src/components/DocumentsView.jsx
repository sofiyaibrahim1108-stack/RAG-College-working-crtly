import React, { useState, useRef } from 'react';
import {
  FileText,
  Upload,
  Search,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  FileCode,
  File,
  Loader2
} from 'lucide-react';
import { GoogleDriveIcon } from './Icons';

export default function DocumentsView({
  documents = [],
  departments = [],
  isLoading,
  onOpenUpload,
  onOpenDrive,
  onDeleteDocument,
  onReuploadDocument,
  onOpenReupload,
  currentUser = null
}) {
  const isAdmin = currentUser?.role === 'admin';
  const [search, setSearch] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedFileType, setSelectedFileType] = useState('');
  const [reuploadingDocId, setReuploadingDocId] = useState(null);

  const fileInputRef = useRef(null);
  const targetReuploadDocRef = useRef(null);

  // Department name resolver
  const getDeptNames = (deptIds) => {
    if (!deptIds || deptIds.length === 0) return 'General';
    return deptIds
      .map((id) => {
        const d = departments.find((dept) => dept._id === id);
        return d ? d.code : null;
      })
      .filter(Boolean)
      .join(', ') || 'General';
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Recently';
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return 'Today';
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Get appropriate icon for file extension
  const getDocTypeIcon = (ext) => {
    const e = (ext || '').toLowerCase();
    if (e === 'xlsx' || e === 'xls' || e === 'csv') {
      return <FileSpreadsheet size={20} className="doc-icon-spreadsheet" />;
    }
    if (e === 'json' || e === 'txt') {
      return <FileCode size={20} className="doc-icon-code" />;
    }
    if (e === 'pdf') {
      return <FileText size={20} className="doc-icon-pdf" />;
    }
    return <File size={20} className="doc-icon-generic" />;
  };

  const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

  const isLargeDoc = (d) => {
    if (d?.fileSize === undefined || d?.fileSize === null) return false;
    const num = Number(d.fileSize);
    return !isNaN(num) && num > LARGE_FILE_THRESHOLD;
  };

  const handleReuploadClick = async (doc) => {
    if (doc.source === 'google_drive') {
      if (onReuploadDocument) {
        setReuploadingDocId(doc._id);
        try {
          await onReuploadDocument(doc, null);
        } finally {
          setReuploadingDocId(null);
        }
      }
    } else if (onOpenReupload) {
      // Reuse the upload modal so department selection stays required
      onOpenReupload(doc);
    } else {
      targetReuploadDocRef.current = doc;
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
    }
  };

  const handleFileInputChange = async (e) => {
    const file = e.target.files?.[0];
    const targetDoc = targetReuploadDocRef.current;
    if (file && targetDoc && onReuploadDocument) {
      setReuploadingDocId(targetDoc._id);
      try {
        await onReuploadDocument(targetDoc, file);
      } finally {
        setReuploadingDocId(null);
        targetReuploadDocRef.current = null;
      }
    }
  };

  // Helper to reliably resolve status across models and API formats
  const resolveDocStatus = (doc) => {
    const raw = (doc?.status || doc?.processingStatus || 'pending').toLowerCase();
    if (raw === 'completed' || raw === 'ready') return 'ready';
    if (raw === 'failed') return 'failed';
    return 'processing';
  };

  // Processing state detection for dynamic loading UI
  const processingDocs = documents.filter((d) => resolveDocStatus(d) === 'processing' || reuploadingDocId === d._id);
  const hasProcessingDocs = processingDocs.length > 0;
  const hasLargeProcessingDoc = processingDocs.some(isLargeDoc);

  // Filtering
  const filteredDocs = documents.filter((doc) => {
    const filename = (doc.filename || doc.originalFilename || doc.originalName || '').toLowerCase();
    const matchesSearch = !search || filename.includes(search.toLowerCase());

    const matchesDept =
      !selectedDeptId ||
      (doc.departmentIds && doc.departmentIds.includes(selectedDeptId));

    const matchesStatus =
      !selectedStatus ||
      resolveDocStatus(doc) === selectedStatus.toLowerCase();

    const matchesType =
      !selectedFileType ||
      (doc.fileType || '').toLowerCase() === selectedFileType.toLowerCase();

    return matchesSearch && matchesDept && matchesStatus && matchesType;
  });

  return (
    <div className="page-container">
      {/* Hidden file input for single-document re-upload */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Header Row */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Knowledge Base</h1>
          <p className="page-subtitle">Manage files and lecture resources that power your college knowledge base.</p>
        </div>

        <div className="page-header-actions">
          {isAdmin ? (
            <>
              <button
                type="button"
                className="btn-drive-action"
                onClick={onOpenDrive}
                title="Import documents from Google Drive"
              >
                <GoogleDriveIcon size={16} />
                <span>Google Drive</span>
              </button>

              <button
                type="button"
                className="btn-primary-action"
                onClick={onOpenUpload}
              >
                <Upload size={15} strokeWidth={2.2} />
                <span>Upload Document</span>
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="role-badge user">Viewer</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Admin role required to manage documents</span>
            </div>
          )}
        </div>
      </div>

      {/* Knowledge Base Dynamic Loading Status Banner */}
      {hasProcessingDocs && (
        <div className="upload-progress-container kb-processing-banner">
          <div className="upload-progress-header">
            <Loader2 size={16} className="spin upload-spinner" style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span>
              {hasLargeProcessingDoc
                ? 'Just a moment, your file is large so it takes some time to extract text and diagrams...'
                : 'Uploading and processing document...'}
            </span>
            <span className="kb-processing-count">
              ({processingDocs.length} {processingDocs.length === 1 ? 'document' : 'documents'} in progress)
            </span>
          </div>
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" />
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="filter-bar">
        <div className="filter-search-box">
          <Search size={15} className="search-icon-muted" />
          <input
            type="text"
            className="search-input"
            placeholder="Search documents by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Department Filter */}
        <select
          className="filter-select"
          value={selectedDeptId}
          onChange={(e) => setSelectedDeptId(e.target.value)}
          aria-label="Filter by department"
        >
          <option value="">All Departments</option>
          {departments.map((dept) => (
            <option key={dept._id} value={dept._id}>
              {dept.code} — {dept.name}
            </option>
          ))}
        </select>

        {/* File Type Filter */}
        <select
          className="filter-select"
          value={selectedFileType}
          onChange={(e) => setSelectedFileType(e.target.value)}
          aria-label="Filter by file type"
        >
          <option value="">All File Types</option>
          <option value="pdf">PDF</option>
          <option value="docx">DOCX</option>
          <option value="doc">DOC</option>
          <option value="csv">CSV</option>
          <option value="xlsx">XLSX</option>
          <option value="xls">XLS</option>
          <option value="txt">TXT</option>
          <option value="pptx">PPTX</option>
        </select>

        {/* Status Filter */}
        <select
          className="filter-select"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Document Cards Grid / Empty State */}
      {isLoading ? (
        <div className="empty-placeholder">
          <Clock size={28} className="spin icon-brand-wine" />
          <div className="empty-title">Loading documents...</div>
          <div className="empty-subtext">Fetching knowledge base documents from college database.</div>
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-placeholder">
          <div className="empty-icon-circle">
            <FileText size={32} strokeWidth={1.8} />
          </div>
          <div className="empty-title">No documents yet</div>
          <div className="empty-subtext">
            Upload your college documents or import them from Google Drive to start asking questions.
          </div>
          <div className="empty-actions-row">
            <button
              type="button"
              className="btn-primary-action"
              onClick={onOpenUpload}
            >
              <Upload size={15} strokeWidth={2.2} />
              <span>Upload Document</span>
            </button>
            <button
              type="button"
              className="btn-drive-action"
              onClick={onOpenDrive}
            >
              <GoogleDriveIcon size={16} />
              <span>Google Drive</span>
            </button>
          </div>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="empty-placeholder">
          <Search size={32} className="search-icon-muted" />
          <div className="empty-title">No matching documents</div>
          <div className="empty-subtext">Try changing your search term or department filter.</div>
        </div>
      ) : (
        <div className="doc-cards-grid">
          {filteredDocs.map((doc) => {
            const displayName = doc.filename || doc.originalFilename || doc.originalName || 'Untitled Document';
            const ext = doc.fileType || displayName.split('.').pop() || 'FILE';
            const status = resolveDocStatus(doc);
            const isDrive = doc.source === 'google_drive';
            const deptText = getDeptNames(doc.departmentIds);
            const sizeText = formatSize(doc.fileSize);
            const isReuploading = reuploadingDocId === doc._id;

            return (
              <div key={doc._id} className="doc-card">
                {/* Top Section: Icon, Name & Drive Badge */}
                <div className="doc-card-header">
                  <div className="doc-card-icon-wrap">
                    {getDocTypeIcon(ext)}
                  </div>

                  <div className="doc-card-title-wrap">
                    <span className="doc-card-name" title={displayName}>
                      {displayName}
                    </span>

                    <div className="doc-card-meta-line">
                      <span className="doc-type-badge">{ext.toUpperCase()}</span>
                      <span className="doc-meta-dot">•</span>
                      <span className="doc-dept-badge">{deptText}</span>
                      {sizeText && (
                        <>
                          <span className="doc-meta-dot">•</span>
                          <span className="doc-size-text">{sizeText}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isDrive && (
                    <div className="doc-drive-pill" title="Imported from Google Drive">
                      <GoogleDriveIcon size={13} />
                      <span>Drive</span>
                    </div>
                  )}
                </div>

                {/* Status & Upload Date Row */}
                <div className="doc-card-status-row">
                  <span
                    className={`status-pill ${status}`}
                    title={doc.processingError ? `Processing failed: ${doc.processingError}` : undefined}
                  >
                    {status === 'ready' && <CheckCircle2 size={11} />}
                    {status === 'processing' && <Clock size={11} className="spin" />}
                    {status === 'failed' && <XCircle size={11} />}
                    <span style={{ textTransform: 'capitalize' }}>{status}</span>
                  </span>

                  <span className="doc-card-date">
                    Added {formatDate(doc.createdAt)}
                  </span>
                </div>

                {/* Card-level Dynamic Loading Status */}
                {(status === 'processing' || isReuploading) && (
                  <div className="doc-card-processing-status">
                    <Loader2 size={13} className="spin upload-spinner" style={{ color: 'var(--primary)', flexShrink: 0 }} />
                    <span>
                      {isLargeDoc(doc)
                        ? 'Just a moment, your file is large so it takes some time to extract text and diagrams...'
                        : 'Uploading and processing document...'}
                    </span>
                  </div>
                )}

                {status === 'failed' && doc.processingError && (
                  <div className="doc-card-error-msg" title={doc.processingError}>
                    {doc.processingError}
                  </div>
                )}

                {/* Bottom Actions Row: [Re-upload] [Delete] (Admin only) */}
                {isAdmin && (
                  <div className="doc-card-actions">
                    <button
                      type="button"
                      className="btn-doc-card-action reupload"
                      onClick={() => handleReuploadClick(doc)}
                      disabled={isReuploading}
                      title="Replace or re-upload this document"
                    >
                      <RefreshCw size={13} className={isReuploading ? 'spin' : ''} />
                      <span>{isReuploading ? 'Updating...' : 'Re-upload'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-doc-card-action delete"
                      onClick={() => onDeleteDocument(doc)}
                      title="Delete document"
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
