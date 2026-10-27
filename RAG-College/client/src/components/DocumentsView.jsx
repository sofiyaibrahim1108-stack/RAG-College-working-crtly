import React, { useState, useRef, useEffect } from 'react';
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

/* ------------------------------------------------------------------
   Slim auto-hiding scrollbar (kept in this file, no separate CSS).
   - Hidden by default, appears on hover or while scrolling.
   - Thin rounded thumb, no arrow buttons, darker on hover/drag.
   - Chrome / Edge / Safari use the webkit rules; Firefox uses the
     standard scrollbar-width / scrollbar-color fallback.
------------------------------------------------------------------ */
const KB_SCROLL_CSS = `
.kb-scrollhost::-webkit-scrollbar { width: 12px; height: 12px; }
.kb-scrollhost::-webkit-scrollbar-track { background: transparent; }
.kb-scrollhost::-webkit-scrollbar-corner { background: transparent; }
.kb-scrollhost::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
.kb-scrollhost::-webkit-scrollbar-thumb {
  min-height: 48px;
  border: 3px solid transparent;
  border-radius: 999px;
  background-color: transparent;
  background-clip: padding-box;
}
.kb-scrollhost:hover::-webkit-scrollbar-thumb,
.kb-scrollhost.kb-scrolling::-webkit-scrollbar-thumb {
  background-color: rgba(100, 116, 139, 0.40);
}
.kb-scrollhost::-webkit-scrollbar-thumb:hover,
.kb-scrollhost::-webkit-scrollbar-thumb:active {
  background-color: rgba(100, 116, 139, 0.70);
}
[data-theme='dark'] .kb-scrollhost:hover::-webkit-scrollbar-thumb,
[data-theme='dark'] .kb-scrollhost.kb-scrolling::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.35);
}
[data-theme='dark'] .kb-scrollhost::-webkit-scrollbar-thumb:hover,
[data-theme='dark'] .kb-scrollhost::-webkit-scrollbar-thumb:active {
  background-color: rgba(148, 163, 184, 0.65);
}

@supports not selector(::-webkit-scrollbar) {
  .kb-scrollhost { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .kb-scrollhost:hover, .kb-scrollhost.kb-scrolling { scrollbar-color: rgba(100, 116, 139, 0.45) transparent; }
}
`;

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
  const rootRef = useRef(null);

  // Find whichever ancestor actually scrolls this page and give it the slim,
  // auto-hiding scrollbar. Works even if the scroll container is outside this file.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    let host = null;
    let node = root;
    while (node && node !== document.body && node !== document.documentElement) {
      const { overflowY } = window.getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        host = node;
        break;
      }
      node = node.parentElement;
    }

    const usesWindow = !host;
    if (usesWindow) host = document.documentElement;

    host.classList.add('kb-scrollhost');

    let timer = null;
    const onScroll = () => {
      host.classList.add('kb-scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => host.classList.remove('kb-scrolling'), 900);
    };

    const target = usesWindow ? window : host;
    target.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      host.classList.remove('kb-scrollhost', 'kb-scrolling');
    };
  }, []);

  // Department name resolver
  const getDeptNames = (deptIds) => {
    if (!deptIds || !Array.isArray(deptIds) || deptIds.length === 0) return 'General';
    const names = deptIds
      .map((dept) => {
        if (typeof dept === 'object' && dept !== null && (dept.code || dept.name)) {
          return dept.code || dept.name;
        }
        const resolved = departments.find((d) => String(d._id) === String(dept));
        return resolved ? resolved.code || resolved.name : null;
      })
      .filter(Boolean);

    return names.length > 0 ? names.join(', ') : 'General';
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

  // Extract file extension reliably
  const extractExt = (doc) => {
    if (doc?.fileType && typeof doc.fileType === 'string' && !doc.fileType.includes('/')) {
      return doc.fileType.replace('.', '').toLowerCase().trim();
    }
    const name = doc?.filename || doc?.originalFilename || doc?.originalName || '';
    const parts = name.split('.');
    if (parts.length > 1) {
      return parts.pop().toLowerCase().trim();
    }
    return 'file';
  };

  // Get appropriate icon for file extension
  const getDocTypeIcon = (ext) => {
    const e = (ext || '').toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(e)) {
      return <FileSpreadsheet size={20} className="doc-icon-spreadsheet" />;
    }
    if (['json', 'txt'].includes(e)) {
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

  // Status Normalizer: handles 'ready', 'completed', 'failed', 'error', 'processing', etc.
  const resolveDocStatus = (doc) => {
    const raw = String(doc?.status || doc?.processingStatus || 'pending').toLowerCase().trim();
    if (['completed', 'ready', 'success', 'done'].includes(raw)) return 'ready';
    if (['failed', 'error'].includes(raw)) return 'failed';
    return 'processing';
  };

  // Processing state detection
  const processingDocs = documents.filter((d) => resolveDocStatus(d) === 'processing' || reuploadingDocId === d._id);
  const hasProcessingDocs = processingDocs.length > 0;
  const hasLargeProcessingDoc = processingDocs.some(isLargeDoc);

  // Complete Matching Logic for all 4 filters
  const filteredDocs = documents.filter((doc) => {
    const displayName = doc.filename || doc.originalFilename || doc.originalName || '';
    const matchesSearch = !search.trim() || displayName.toLowerCase().includes(search.trim().toLowerCase());

    // 1. Department matching
    const matchesDept =
      !selectedDeptId ||
      (Array.isArray(doc.departmentIds) &&
        doc.departmentIds.some((dept) => {
          const id = typeof dept === 'object' && dept !== null ? dept._id || dept.id : dept;
          return String(id) === String(selectedDeptId);
        }));

    // 2. Status matching
    const docStatus = resolveDocStatus(doc);
    const matchesStatus =
      !selectedStatus ||
      docStatus === selectedStatus.toLowerCase().trim();

    // 3. File type matching
    const docExt = extractExt(doc);
    const targetType = selectedFileType.toLowerCase().replace('.', '').trim();
    const matchesType = !targetType || docExt === targetType;

    return matchesSearch && matchesDept && matchesStatus && matchesType;
  });

  return (
    <div className="page-container" ref={rootRef}>
      <style>{KB_SCROLL_CSS}</style>

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

      {/* Dynamic Processing Status Banner */}
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

        {/* 1. Department Filter */}
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

        {/* 2. File Type Filter */}
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

        {/* 3. Status Filter */}
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

      {/* Document Grid / Empty State */}
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
          <div className="empty-subtext">Try changing your search term, file type, or status filter.</div>
        </div>
      ) : (
        <div className="doc-cards-grid">
          {filteredDocs.map((doc) => {
            const displayName = doc.filename || doc.originalFilename || doc.originalName || 'Untitled Document';
            const ext = extractExt(doc);
            const status = resolveDocStatus(doc);
            const isDrive = doc.source === 'google_drive';
            const deptText = getDeptNames(doc.departmentIds);
            const sizeText = formatSize(doc.fileSize);
            const isReuploading = reuploadingDocId === doc._id;

            return (
              <div key={doc._id} className="doc-card">
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