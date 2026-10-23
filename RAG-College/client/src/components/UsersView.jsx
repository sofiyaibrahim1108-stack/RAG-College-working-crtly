import React, { useState, useRef, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  User,
  Trash2,
  Power,
  Search,
  Mail,
  Lock,
  Building2,
  FileSpreadsheet,
  UploadCloud,
  Download,
  Check,
  AlertCircle,
  Loader2,
  X,
  CheckCircle2
} from 'lucide-react';

// Lightweight pure-JS CSV Parser supporting quoted commas and newlines
function parseCSV(text) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentVal = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(currentVal.trim());
      if (row.some((cell) => cell.length > 0)) {
        lines.push(row);
      }
      row = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal.length > 0 || row.length > 0) {
    row.push(currentVal.trim());
    if (row.some((cell) => cell.length > 0)) {
      lines.push(row);
    }
  }

  if (lines.length < 2) return [];

  const headers = lines[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i];
    const rowObj = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] || '';
    });
    rows.push(rowObj);
  }

  return rows;
}

// Lightweight pure-JS XLSX Parser leveraging modern Web API DecompressionStream & DOMParser
async function parseXLSX(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const len = arrayBuffer.byteLength;

  // 1. Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  const minScan = Math.max(0, len - 65557);
  for (let i = len - 22; i >= minScan; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid Excel file format (ZIP header not found).');
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  const files = {};
  let curOffset = cdOffset;

  // 2. Scan Central Directory entries
  for (let entry = 0; entry < cdEntries && curOffset < len - 46; entry++) {
    if (view.getUint32(curOffset, true) !== 0x02014b50) break;

    const compMethod = view.getUint16(curOffset + 10, true);
    const compSize = view.getUint32(curOffset + 20, true);
    const nameLen = view.getUint16(curOffset + 28, true);
    const extraLen = view.getUint16(curOffset + 30, true);
    const commentLen = view.getUint16(curOffset + 32, true);
    const localHeaderOffset = view.getUint32(curOffset + 42, true);

    const nameBytes = new Uint8Array(arrayBuffer, curOffset + 46, nameLen);
    const fileName = new TextDecoder('utf-8').decode(nameBytes);

    if (
      fileName === 'xl/sharedStrings.xml' ||
      (fileName.startsWith('xl/worksheets/sheet') && fileName.endsWith('.xml'))
    ) {
      if (view.getUint32(localHeaderOffset, true) === 0x04034b50) {
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compBytes = new Uint8Array(arrayBuffer, dataStart, compSize);

        let content = '';
        if (compMethod === 0) {
          content = new TextDecoder('utf-8').decode(compBytes);
        } else if (compMethod === 8) {
          if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(compBytes);
            writer.close();
            const resp = new Response(ds.readable);
            const decompressedBuf = await resp.arrayBuffer();
            content = new TextDecoder('utf-8').decode(decompressedBuf);
          } else {
            throw new Error('DecompressionStream not supported in this browser.');
          }
        }
        files[fileName] = content;
      }
    }

    curOffset += 46 + nameLen + extraLen + commentLen;
  }

  // 3. Parse sharedStrings
  const sharedStrings = [];
  if (files['xl/sharedStrings.xml']) {
    const doc = new DOMParser().parseFromString(files['xl/sharedStrings.xml'], 'application/xml');
    const sis = doc.getElementsByTagName('si');
    for (let i = 0; i < sis.length; i++) {
      const texts = sis[i].getElementsByTagName('t');
      let str = '';
      for (let j = 0; j < texts.length; j++) {
        str += texts[j].textContent || '';
      }
      sharedStrings.push(str);
    }
  }

  // 4. Find primary worksheet
  const sheetKey =
    files['xl/worksheets/sheet1.xml']
      ? 'xl/worksheets/sheet1.xml'
      : Object.keys(files).find((k) => k.startsWith('xl/worksheets/sheet') && k.endsWith('.xml'));

  if (!sheetKey || !files[sheetKey]) {
    throw new Error('Worksheet data could not be found in Excel file.');
  }

  const sheetDoc = new DOMParser().parseFromString(files[sheetKey], 'application/xml');
  const rows = sheetDoc.getElementsByTagName('row');
  const table = [];

  for (let r = 0; r < rows.length; r++) {
    const rowElem = rows[r];
    const cells = rowElem.getElementsByTagName('c');
    const rowValues = [];

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const cellRef = cell.getAttribute('r') || '';
      const type = cell.getAttribute('t');
      const vElem = cell.getElementsByTagName('v')[0];
      let val = '';

      if (type === 's' && vElem) {
        const idx = parseInt(vElem.textContent, 10);
        val = sharedStrings[idx] ?? '';
      } else if (type === 'inlineStr') {
        const tElem = cell.getElementsByTagName('t')[0];
        val = tElem?.textContent || '';
      } else if (vElem) {
        val = vElem.textContent || '';
      }

      const colLetters = cellRef.replace(/[0-9]/g, '');
      let colIndex = 0;
      for (let l = 0; l < colLetters.length; l++) {
        colIndex = colIndex * 26 + (colLetters.charCodeAt(l) - 64);
      }
      colIndex = Math.max(0, colIndex - 1);
      rowValues[colIndex] = val.trim();
    }

    if (rowValues.some((v) => v !== undefined && v !== '')) {
      table.push(rowValues);
    }
  }

  if (table.length < 2) return [];

  const headers = table[0].map((h) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const parsedRows = [];

  for (let i = 1; i < table.length; i++) {
    const values = table[i];
    const rowObj = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] || '';
    });
    parsedRows.push(rowObj);
  }

  return parsedRows;
}

function processParsedRows(rawRows, departments) {
  const validUsers = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowNum = index + 2;
    const name = (row.name || row.fullname || row.username || row['fullname'] || '').trim();
    const email = (row.email || row.collegeemail || row.mail || row['collegeemail'] || '').trim().toLowerCase();
    let password = (row.password || row.initialpassword || row.pass || row['initialpassword'] || '').trim();
    let role = (row.role || row.userrole || '').trim().toLowerCase();
    role = role === 'admin' ? 'admin' : 'user';

    if (!name && !email) return;

    if (!name) {
      errors.push(`Row ${rowNum}: Name is missing.`);
      return;
    }

    if (!email || !email.includes('@')) {
      errors.push(`Row ${rowNum} (${name || 'Unnamed'}): Valid email is required.`);
      return;
    }

    if (!password) {
      password = 'ChangeMe123!';
    } else if (password.length < 6) {
      password = password.padEnd(6, '0');
    }

    const deptStr = (row.department || row.dept || row.departmentid || '').trim().toLowerCase();
    let departmentId = '';
    let departmentDisplay = 'All / General';

    if (deptStr && departments && departments.length > 0) {
      const match = departments.find(
        (d) =>
          (d._id && d._id.toLowerCase() === deptStr) ||
          (d.name && d.name.toLowerCase() === deptStr) ||
          (d.code && d.code.toLowerCase() === deptStr) ||
          (d.name && d.name.toLowerCase().includes(deptStr))
      );
      if (match) {
        departmentId = match._id;
        departmentDisplay = `${match.name} (${match.code})`;
      } else {
        departmentDisplay = row.department || row.dept || 'Unknown';
      }
    }

    validUsers.push({
      name,
      email,
      password,
      role,
      departmentId,
      departmentDisplay,
      rowNum
    });
  });

  return { validUsers, errors };
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColor(name) {
  const colors = [
    { bg: 'rgba(59, 130, 246, 0.14)', text: '#2563eb' },
    { bg: 'rgba(16, 185, 129, 0.14)', text: '#059669' },
    { bg: 'rgba(245, 158, 11, 0.14)', text: '#d97706' },
    { bg: 'rgba(139, 92, 246, 0.14)', text: '#7c3aed' },
    { bg: 'rgba(236, 72, 153, 0.14)', text: '#db2777' },
    { bg: 'rgba(20, 184, 166, 0.14)', text: '#0d9488' }
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function UsersView({
  users = [],
  departments = [],
  isLoading,
  onCreateUser,
  onToggleStatus,
  onDeleteUser,
  currentUser
}) {
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalTab, setModalTab] = useState('single'); // 'single' | 'bulk'

  // Single User State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    departmentId: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bulk Import State
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parsedUsers, setParsedUsers] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const [bulkError, setBulkError] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState(null); // { current, total, success, failed, errors }
  const fileInputRef = useRef(null);

  const handleCloseModal = () => {
    setShowAddModal(false);
    setFormData({ name: '', email: '', password: '', role: 'user', departmentId: '' });
    setSelectedFile(null);
    setParsedUsers([]);
    setParseErrors([]);
    setBulkError('');
    setImportStatus(null);
    setModalTab('single');
  };

  // Close modal with Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showAddModal && !isSubmitting && !isImporting) {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAddModal, isSubmitting, isImporting]);

  const filteredUsers = users.filter((u) =>
    (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onCreateUser(formData);
      handleCloseModal();
    } catch {
      // Error toast already handled by caller
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileProcess = async (file) => {
    if (!file) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (ext !== '.csv' && ext !== '.xlsx') {
      setBulkError('Unsupported file type. Please upload a .csv or .xlsx file.');
      return;
    }

    setIsParsing(true);
    setBulkError('');
    setParseErrors([]);
    setImportStatus(null);
    setSelectedFile({
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB'
    });

    try {
      let rawRows = [];
      if (ext === '.csv') {
        const text = await file.text();
        rawRows = parseCSV(text);
      } else {
        const buffer = await file.arrayBuffer();
        rawRows = await parseXLSX(buffer);
      }

      if (rawRows.length === 0) {
        setBulkError('No data rows found in spreadsheet. Please verify headers and content.');
        setParsedUsers([]);
        return;
      }

      const { validUsers, errors } = processParsedRows(rawRows, departments);

      if (validUsers.length === 0) {
        setBulkError('No valid user records could be recognized. Required columns: Name, Email.');
      }

      setParsedUsers(validUsers);
      setParseErrors(errors);
    } catch (err) {
      console.error('File parsing error:', err);
      setBulkError(err.message || 'Failed to parse file. Please verify file format or use CSV.');
      setParsedUsers([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      'Name,Email,Password,Role,Department\n' +
      'Prof. Alex Johnson,alex.johnson@college.edu,Welcome@2025,user,Computer Science\n' +
      'Dr. Maria Garcia,maria.garcia@college.edu,Welcome@2025,admin,Electronics\n' +
      'Prof. Alan Turing,alan.turing@college.edu,Welcome@2025,user,Information Technology\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'users_sample_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleBulkImport = async () => {
    if (parsedUsers.length === 0) return;
    setIsImporting(true);
    setBulkError('');
    setImportStatus({
      current: 0,
      total: parsedUsers.length,
      success: 0,
      failed: 0,
      errors: []
    });

    let successCount = 0;
    const failErrors = [];

    for (let i = 0; i < parsedUsers.length; i++) {
      const u = parsedUsers[i];
      setImportStatus((prev) => ({
        ...prev,
        current: i + 1,
        userEmail: u.email
      }));

      try {
        await onCreateUser({
          name: u.name,
          email: u.email,
          password: u.password,
          role: u.role,
          departmentId: u.departmentId || ''
        });
        successCount++;
      } catch (err) {
        failErrors.push(`${u.email}: ${err.message || 'Creation failed'}`);
      }
    }

    setIsImporting(false);

    if (failErrors.length === 0) {
      handleCloseModal();
    } else {
      setImportStatus((prev) => ({
        ...prev,
        success: successCount,
        failed: failErrors.length,
        errors: failErrors
      }));
    }
  };

  return (
    <div className="page-container">
      {/* â”€â”€ Page Header â”€â”€ */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Users &amp; Staff</h1>
          <p className="page-subtitle">Manage teacher and staff accounts, roles, department scope, and login access.</p>
        </div>
        <button
          type="button"
          className="btn-primary-action"
          onClick={() => { setShowAddModal(true); setModalTab('single'); }}
        >
          <UserPlus size={15} strokeWidth={2.2} />
          <span>Add Staff / User</span>
        </button>
      </div>

      {/* â”€â”€ Filter / Search Bar â”€â”€ */}
      <div className="filter-bar">
        <div className="filter-search-box">
          <Search size={15} className="search-icon-muted" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '13px', padding: '0 4px' }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {filteredUsers.length} of {users.length} {users.length === 1 ? 'user' : 'users'}
        </span>
      </div>

      {/* â”€â”€ Users Table â”€â”€ */}
      {isLoading ? (
        <div className="empty-placeholder">
          <Loader2 size={26} className="spin icon-brand-wine" />
          <div className="empty-title" style={{ marginTop: '10px' }}>Loading users...</div>
          <div className="empty-subtext">Fetching college user records from database.</div>
        </div>
      ) : users.length === 0 ? (
        <div className="empty-placeholder">
          <div className="empty-icon-circle">
            <Users size={28} strokeWidth={1.8} />
          </div>
          <div className="empty-title">No users registered yet</div>
          <div className="empty-subtext">
            Add individual staff or teachers, or bulk-import a spreadsheet to get started.
          </div>
          <div className="empty-actions-row">
            <button
              type="button"
              className="btn-primary-action"
              onClick={() => { setShowAddModal(true); setModalTab('single'); }}
            >
              <UserPlus size={14} strokeWidth={2.2} />
              <span>Add First User</span>
            </button>
          </div>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="empty-placeholder">
          <Search size={28} className="search-icon-muted" />
          <div className="empty-title" style={{ marginTop: '10px' }}>No matching users</div>
          <div className="empty-subtext">Try a different name or email address.</div>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', boxShadow: 'var(--shadow-xs)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '680px', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '11px 20px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    User / Staff
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Role
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Department
                  </th>
                  <th style={{ padding: '11px 16px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                    Status
                  </th>
                  <th style={{ padding: '11px 20px', fontWeight: 600, fontSize: '11.5px', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-secondary)', textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, idx) => {
                  const avatarColor = getAvatarColor(u.name);
                  const isCurrent = currentUser?.id === u._id;
                  const isActive = (u.status || 'active') === 'active';
                  const isLast = idx === filteredUsers.length - 1;

                  return (
                    <tr
                      key={u._id}
                      style={{
                        borderBottom: isLast ? 'none' : '1px solid var(--border)',
                        transition: 'background-color 0.1s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                    >
                      {/* Name + Email with avatar */}
                      <td style={{ padding: '13px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                          <div style={{
                            width: '34px', height: '34px', borderRadius: '50%',
                            background: avatarColor.bg, color: avatarColor.text,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: '12px', flexShrink: 0, letterSpacing: '0.02em'
                          }}>
                            {getInitials(u.name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                              {isCurrent && (
                                <span className="role-badge user" style={{ fontSize: '9px' }}>You</span>
                              )}
                            </div>
                            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Role badge */}
                      <td style={{ padding: '13px 16px' }}>
                        <span className={`role-badge ${u.role === 'admin' ? 'admin' : 'user'}`}>
                          {u.role === 'admin' ? <Shield size={10} style={{ marginRight: '3px' }} /> : <User size={10} style={{ marginRight: '3px' }} />}
                          {u.role === 'admin' ? 'Admin' : 'Staff'}
                        </span>
                      </td>

                      {/* Department */}
                      <td style={{ padding: '13px 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Building2 size={12} style={{ opacity: 0.55, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.departmentId ? `${u.departmentId.name} (${u.departmentId.code})` : 'All / General'}
                          </span>
                        </div>
                      </td>

                      {/* Status pill */}
                      <td style={{ padding: '13px 16px' }}>
                        <span className={`status-pill ${isActive ? 'ready' : 'failed'}`}>
                          {isActive ? <CheckCircle2 size={11} /> : <Power size={11} />}
                          <span style={{ textTransform: 'capitalize' }}>{isActive ? 'Active' : 'Suspended'}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                        {!isCurrent ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              type="button"
                              className="btn-card-action"
                              title={isActive ? 'Suspend User' : 'Activate User'}
                              aria-label={isActive ? 'Suspend User' : 'Activate User'}
                              onClick={() => onToggleStatus(u._id, isActive ? 'suspended' : 'active')}
                            >
                              <Power size={14} style={{ color: isActive ? 'var(--danger)' : 'var(--status-ready)' }} />
                            </button>
                            <button
                              type="button"
                              className="btn-card-action danger"
                              title="Delete User"
                              aria-label="Delete User"
                              onClick={() => onDeleteUser(u)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Protected
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* â”€â”€ Add User Modal â”€â”€ */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => { if (!isSubmitting && !isImporting) handleCloseModal(); }}>
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            style={{ width: modalTab === 'bulk' ? '600px' : '500px', transition: 'width 0.15s ease' }}
          >
            {/* Modal Header */}
            <div className="modal-header-row">
              <div className="modal-header-text">
                <p className="modal-header-title">Add College User / Staff</p>
                <p className="modal-header-subtitle">
                  {modalTab === 'single'
                    ? 'Create an individual account with a designated department and role.'
                    : 'Upload a spreadsheet to import multiple accounts at once.'}
                </p>
              </div>
              <button
                type="button"
                className="btn-modal-close-icon"
                onClick={handleCloseModal}
                disabled={isSubmitting || isImporting}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tab Switcher */}
            <div style={{ padding: '0 24px 4px' }}>
              <div className="auth-segmented-pill">
                <button
                  type="button"
                  className={`auth-pill-btn ${modalTab === 'single' ? 'active' : ''}`}
                  onClick={() => { setModalTab('single'); setBulkError(''); }}
                  disabled={isSubmitting || isImporting}
                >
                  <User size={13} />
                  <span>Single User</span>
                </button>
                <button
                  type="button"
                  className={`auth-pill-btn ${modalTab === 'bulk' ? 'active' : ''}`}
                  onClick={() => { setModalTab('bulk'); setBulkError(''); }}
                  disabled={isSubmitting || isImporting}
                >
                  <FileSpreadsheet size={13} />
                  <span>Bulk Import (Excel / CSV)</span>
                </button>
              </div>
            </div>

            {/* â”€â”€ TAB 1: Single User â”€â”€ */}
            {modalTab === 'single' && (
              <form onSubmit={handleSingleSubmit} style={{ display: 'contents' }}>
                <div className="modal-content-body">
                  <div className="form-field-group">
                    <label className="field-label">Full Name *</label>
                    <div className="auth-field-input-box">
                      <User size={14} className="auth-field-icon" />
                      <input
                        type="text"
                        required
                        className="auth-field-input"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Prof. John Doe"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="form-field-group">
                    <label className="field-label">College Email *</label>
                    <div className="auth-field-input-box">
                      <Mail size={14} className="auth-field-icon" />
                      <input
                        type="email"
                        required
                        className="auth-field-input"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="john@college.edu"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="form-field-group">
                    <label className="field-label">Initial Password (Optional)</label>
                    <div className="auth-field-input-box">
                      <Lock size={14} className="auth-field-icon" />
                      <input
                        type="password"
                        className="auth-field-input"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Min. 6 characters"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="form-field-group">
                    <label className="field-label">Role</label>
                    <select
                      className="field-input"
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      disabled={isSubmitting}
                    >
                      <option value="user">Teacher / Staff (User)</option>
                      <option value="admin">Administrator (Admin)</option>
                    </select>
                  </div>

                  <div className="form-field-group">
                    <label className="field-label">Department</label>
                    <select
                      className="field-input"
                      value={formData.departmentId}
                      onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                      disabled={isSubmitting}
                    >
                      <option value="">All / General Access</option>
                      {departments.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="modal-footer-actions">
                  <button
                    type="button"
                    className="btn-secondary-action"
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary-action"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <span>Create User</span>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* â”€â”€ TAB 2: Bulk Import â”€â”€ */}
            {modalTab === 'bulk' && (
              <>
                <div className="modal-content-body">
                  {/* Template Download Row */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-hover)', border: '1px solid var(--border)',
                    flexWrap: 'wrap', gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <FileSpreadsheet size={15} style={{ color: 'var(--status-ready)', flexShrink: 0 }} />
                      <span>Required columns: <strong style={{ color: 'var(--text)' }}>Name, Email</strong>, Password, Role, Department</span>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary-action"
                      onClick={handleDownloadTemplate}
                      style={{ height: '34px', padding: '0 14px', fontSize: '13px' }}
                    >
                      <Download size={13} />
                      <span>Sample Template</span>
                    </button>
                  </div>

                  {/* Drag-and-Drop Area â€” only when no file selected */}
                  {!selectedFile && (
                    <div
                      className={`upload-dropzone${isDragging ? ' dragging' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          handleFileProcess(e.dataTransfer.files[0]);
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); }
                      }}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                        className="upload-file-input"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) handleFileProcess(e.target.files[0]);
                        }}
                        tabIndex={-1}
                      />
                      <div className="upload-dropzone-icon">
                        <UploadCloud size={28} strokeWidth={1.8} />
                      </div>
                      <div className="upload-dropzone-title">
                        {isDragging ? 'Drop your file here' : 'Drag & drop your spreadsheet here'}
                      </div>
                      <div className="upload-dropzone-divider"><span>or</span></div>
                      <button
                        type="button"
                        className="upload-choose-file-btn"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      >
                        Browse File
                      </button>
                      <div className="upload-dropzone-formats">XLSX â€¢ CSV</div>
                    </div>
                  )}

                  {/* Parsing Spinner */}
                  {isParsing && (
                    <div className="empty-placeholder" style={{ padding: '24px' }}>
                      <Loader2 size={22} className="spin icon-brand-wine" />
                      <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '8px' }}>Reading spreadsheet rows...</div>
                    </div>
                  )}

                  {/* Selected File Card + Preview */}
                  {selectedFile && !isParsing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* File info row */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '34px', height: '34px', borderRadius: 'var(--radius-sm)',
                            background: 'var(--status-ready-bg)', color: 'var(--status-ready)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                          }}>
                            <FileSpreadsheet size={17} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{selectedFile.name}</div>
                            <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                              {selectedFile.size} &nbsp;Â·&nbsp;
                              <span style={{ color: parsedUsers.length > 0 ? 'var(--status-ready)' : 'var(--danger)', fontWeight: 600 }}>
                                {parsedUsers.length} {parsedUsers.length === 1 ? 'user' : 'users'} ready to import
                              </span>
                            </div>
                          </div>
                        </div>
                        {!isImporting && (
                          <button
                            type="button"
                            className="btn-remove-staged"
                            title="Remove file"
                            onClick={() => {
                              setSelectedFile(null);
                              setParsedUsers([]);
                              setParseErrors([]);
                              setBulkError('');
                              setImportStatus(null);
                              if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>

                      {/* Preview table */}
                      {parsedUsers.length > 0 && (
                        <div>
                          <div style={{ fontSize: '11.5px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                            Preview â€” first {Math.min(5, parsedUsers.length)} of {parsedUsers.length} rows
                          </div>
                          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                              <thead>
                                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--border)' }}>
                                  {['Name', 'Email', 'Role', 'Department'].map((h) => (
                                    <th key={h} style={{ padding: '7px 10px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {parsedUsers.slice(0, 5).map((row, idx) => (
                                  <tr key={idx} style={{ borderBottom: idx < Math.min(parsedUsers.length, 5) - 1 ? '1px solid var(--border)' : 'none' }}>
                                    <td style={{ padding: '7px 10px', fontWeight: 500, color: 'var(--text)' }}>{row.name}</td>
                                    <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>{row.email}</td>
                                    <td style={{ padding: '7px 10px' }}>
                                      <span className={`role-badge ${row.role === 'admin' ? 'admin' : 'user'}`}>
                                        {row.role}
                                      </span>
                                    </td>
                                    <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>{row.departmentDisplay}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {parsedUsers.length > 5 && (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                              + {parsedUsers.length - 5} more users will be imported
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Skipped row warnings */}
                  {parseErrors.length > 0 && (
                    <div style={{
                      background: 'var(--status-processing-bg)', border: '1px solid var(--status-processing-border)',
                      borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13px', color: 'var(--status-processing)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, marginBottom: '4px' }}>
                        <AlertCircle size={13} />
                        <span>{parseErrors.length} row{parseErrors.length > 1 ? 's' : ''} skipped</span>
                      </div>
                      <ul style={{ margin: '0 0 0 18px', padding: 0, lineHeight: 1.6 }}>
                        {parseErrors.slice(0, 3).map((err, i) => <li key={i}>{err}</li>)}
                        {parseErrors.length > 3 && <li>â€¦and {parseErrors.length - 3} more</li>}
                      </ul>
                    </div>
                  )}

                  {/* File error */}
                  {bulkError && (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: '8px',
                      background: 'var(--danger-light)', border: '1px solid var(--danger-border)',
                      borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: '13.5px', color: 'var(--danger)'
                    }}>
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                      <span>{bulkError}</span>
                    </div>
                  )}

                  {/* Import progress / result */}
                  {importStatus && (
                    <div style={{
                      background: importStatus.failed > 0 ? 'var(--danger-light)' : 'var(--status-ready-bg)',
                      border: `1px solid ${importStatus.failed > 0 ? 'var(--danger-border)' : 'var(--status-ready-border)'}`,
                      borderRadius: 'var(--radius-sm)', padding: '12px 14px'
                    }}>
                      {isImporting ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13.5px', color: 'var(--text)' }}>
                          <Loader2 size={15} className="spin" style={{ color: 'var(--primary)', flexShrink: 0 }} />
                          <span>Importing {importStatus.current} of {importStatus.total} ({importStatus.userEmail})â€¦</span>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13.5px', color: importStatus.failed > 0 ? 'var(--danger)' : 'var(--status-ready)' }}>
                            <CheckCircle2 size={15} />
                            <span>
                              {importStatus.success} created successfully
                              {importStatus.failed > 0 && ` Â· ${importStatus.failed} failed`}
                            </span>
                          </div>
                          {importStatus.errors && importStatus.errors.length > 0 && (
                            <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: '12.5px', color: 'var(--danger)', lineHeight: 1.6 }}>
                              {importStatus.errors.slice(0, 4).map((err, idx) => <li key={idx}>{err}</li>)}
                              {importStatus.errors.length > 4 && <li>â€¦and {importStatus.errors.length - 4} more</li>}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="modal-footer-actions">
                  <button
                    type="button"
                    className="btn-secondary-action"
                    onClick={handleCloseModal}
                    disabled={isImporting}
                  >
                    {importStatus && !isImporting ? 'Close' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary-action"
                    onClick={handleBulkImport}
                    disabled={parsedUsers.length === 0 || isImporting}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        <span>Importing ({importStatus?.current || 0}/{parsedUsers.length})â€¦</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>Import {parsedUsers.length > 0 ? `${parsedUsers.length} Users` : 'Users'}</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
