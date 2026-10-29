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
  CheckCircle2,
  Eye,
  EyeOff,
  ChevronDown
} from 'lucide-react';
import { isDepartmentAdmin } from '../utils/access';

// ── Users page + Add User modal styles (kept in this file; no separate CSS needed) ──
const MODAL_CSS = `
/* ============================================================
   Add User modal — scoped styles (all classes prefixed "um-")
   ============================================================ */

@keyframes um-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes um-pop  { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }

.um-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(4px);
  animation: um-fade .15s ease;
}

.um-modal {
  --um-primary: #2563eb;
  --um-primary-hover: #1d4ed8;
  --um-ring: rgba(37, 99, 235, .18);
  --um-border: #e2e8f0;
  --um-border-strong: #d3dbe6;
  --um-text: #0f172a;
  --um-label: #334155;
  --um-muted: #64748b;
  --um-placeholder: #94a3b8;
  --um-subtle: #f8fafc;
  --um-danger: #dc2626;
  --um-danger-bg: #fef2f2;
  --um-danger-border: #fecaca;
  --um-success: #059669;
  --um-success-bg: #ecfdf5;
  --um-success-border: #a7f3d0;
  --um-warn: #b45309;
  --um-warn-bg: #fffbeb;
  --um-warn-border: #fde68a;

  display: flex; flex-direction: column;
  width: 100%; max-width: 560px;
  max-height: min(92vh, 740px);
  background: #fff; color: var(--um-text);
  border-radius: 16px;
  box-shadow: 0 24px 60px -12px rgba(15, 23, 42, .35), 0 0 0 1px rgba(15, 23, 42, .06);
  overflow: hidden;
  animation: um-pop .18s ease;
  transition: max-width .15s ease;
}
.um-modal.wide { max-width: 640px; }
.um-modal button, .um-modal input, .um-modal select { font-family: inherit; }

/* ---------- Header ---------- */
.um-header {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 22px 24px 18px;
}
.um-header-icon {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: #eff6ff; color: var(--um-primary);
  box-shadow: inset 0 0 0 1px #dbeafe;
}
.um-header-text { flex: 1; min-width: 0; padding-top: 1px; }
.um-title { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; color: var(--um-text); }
.um-subtitle { margin: 3px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--um-muted); }
.um-close {
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--um-muted); cursor: pointer;
  transition: background .12s, color .12s;
}
.um-close:hover:not(:disabled) { background: #f1f5f9; color: var(--um-text); }
.um-close:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--um-ring); }
.um-close:disabled { opacity: .4; cursor: not-allowed; }

/* ---------- Tabs (segmented) ---------- */
.um-tabs-wrap { padding: 0 24px 18px; }
.um-tabs {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
  padding: 4px; border-radius: 12px; background: #f1f5f9;
}
.um-tab {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 36px; border: none; border-radius: 9px; background: transparent;
  font-size: 13.5px; font-weight: 500; color: var(--um-muted); cursor: pointer;
  transition: background .15s, color .15s, box-shadow .15s;
}
.um-tab:hover:not(:disabled):not(.active) { color: var(--um-text); }
.um-tab.active {
  background: #fff; color: var(--um-primary); font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .08), 0 0 0 1px rgba(15, 23, 42, .04);
}
.um-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--um-ring); }
.um-tab:disabled { cursor: not-allowed; opacity: .6; }

/* ---------- Body (scrollable) ---------- */
.um-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 4px 24px 22px;
  display: flex; flex-direction: column; gap: 16px;
  border-top: 1px solid transparent;
  scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;
}
.um-body::-webkit-scrollbar { width: 8px; }
.um-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 8px; border: 2px solid #fff; }
.um-body::-webkit-scrollbar-track { background: transparent; }

/* ---------- Fields ---------- */
.um-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 520px) { .um-grid-2 { grid-template-columns: 1fr; } }

.um-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.um-label { font-size: 13px; font-weight: 600; color: var(--um-label); }
.um-label .req { color: var(--um-danger); margin-left: 2px; }
.um-label .opt { margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--um-muted); }
.um-help { margin: 0; font-size: 12px; color: var(--um-muted); }

.um-input-wrap { position: relative; display: flex; align-items: center; }
.um-input-wrap > .um-icon {
  position: absolute; left: 13px; color: var(--um-placeholder); pointer-events: none;
  transition: color .12s;
}
.um-input-wrap:focus-within > .um-icon { color: var(--um-primary); }

.um-modal .um-input {
  width: 100%; height: 42px; padding: 0 12px 0 38px;
  border: 1px solid var(--um-border-strong); border-radius: 10px;
  background: #fff; color: var(--um-text); font-size: 14px;
  appearance: none; -webkit-appearance: none; outline: none;
  transition: border-color .12s, box-shadow .12s, background .12s;
}
.um-modal .um-input::placeholder { color: var(--um-placeholder); }
.um-modal .um-input:hover:not(:disabled):not(:focus) { border-color: #b8c4d4; }
.um-modal .um-input:focus { border-color: var(--um-primary); box-shadow: 0 0 0 3px var(--um-ring); }
.um-modal .um-input:disabled { background: var(--um-subtle); color: var(--um-muted); cursor: not-allowed; }
.um-modal .um-input.pr { padding-right: 42px; }
select.um-input { cursor: pointer; text-overflow: ellipsis; }

.um-trailing {
  position: absolute; right: 6px; width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--um-placeholder); cursor: pointer;
  transition: background .12s, color .12s;
}
.um-trailing:hover { background: #f1f5f9; color: var(--um-label); }
.um-trailing:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--um-ring); }
.um-chevron { position: absolute; right: 13px; color: var(--um-placeholder); pointer-events: none; }

/* ---------- Footer ---------- */
.um-footer {
  display: flex; justify-content: flex-end; align-items: center; gap: 10px;
  padding: 14px 24px; border-top: 1px solid var(--um-border); background: var(--um-subtle);
}
.um-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 40px; padding: 0 18px; border-radius: 10px;
  font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background .12s, border-color .12s, box-shadow .12s, transform .05s;
}
.um-btn:active:not(:disabled) { transform: translateY(1px); }
.um-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--um-ring); }
.um-btn:disabled { opacity: .55; cursor: not-allowed; }
.um-btn-ghost { background: #fff; border: 1px solid var(--um-border-strong); color: var(--um-label); }
.um-btn-ghost:hover:not(:disabled) { background: #f1f5f9; border-color: #b8c4d4; }
.um-btn-primary {
  background: var(--um-primary); border: 1px solid var(--um-primary); color: #fff;
  box-shadow: 0 1px 2px rgba(37, 99, 235, .25), inset 0 1px 0 rgba(255, 255, 255, .12);
}
.um-btn-primary:hover:not(:disabled) { background: var(--um-primary-hover); border-color: var(--um-primary-hover); }
.um-btn-sm { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 8px; }

/* ---------- Bulk: info row ---------- */
.um-info {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 12px 14px; border: 1px solid var(--um-border); border-radius: 12px; background: var(--um-subtle);
}
.um-info-text { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--um-muted); line-height: 1.4; }
.um-info-text strong { color: var(--um-text); font-weight: 600; }
.um-info-icon {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--um-success-bg); color: var(--um-success);
}

/* ---------- Bulk: dropzone ---------- */
.um-dropzone {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 30px 20px; text-align: center; cursor: pointer;
  border: 1.5px dashed #c3cddb; border-radius: 14px; background: var(--um-subtle);
  transition: border-color .15s, background .15s;
}
.um-dropzone:hover, .um-dropzone.dragging { border-color: var(--um-primary); background: #f5f9ff; }
.um-dropzone:focus-visible { outline: none; border-color: var(--um-primary); box-shadow: 0 0 0 3px var(--um-ring); }
.um-dropzone-icon {
  width: 48px; height: 48px; border-radius: 14px; margin-bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  background: #fff; color: var(--um-primary);
  box-shadow: 0 1px 3px rgba(15, 23, 42, .1), 0 0 0 1px rgba(15, 23, 42, .05);
}
.um-dropzone-title { font-size: 14.5px; font-weight: 600; color: var(--um-text); }
.um-dropzone-or { font-size: 12.5px; color: var(--um-muted); }
.um-dropzone-formats { margin-top: 4px; font-size: 12px; color: var(--um-muted); }
.um-sr-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* ---------- Bulk: file card + preview ---------- */
.um-file {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border: 1px solid var(--um-border); border-radius: 12px; background: #fff;
}
.um-file-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.um-file-name { font-size: 14px; font-weight: 600; color: var(--um-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.um-file-meta { margin-top: 1px; font-size: 12.5px; color: var(--um-muted); }
.um-file-meta .ok { color: var(--um-success); font-weight: 600; }
.um-file-meta .bad { color: var(--um-danger); font-weight: 600; }

.um-section-label { margin: 0 0 8px; font-size: 12.5px; font-weight: 600; color: var(--um-muted); }
.um-table-wrap { border: 1px solid var(--um-border); border-radius: 12px; overflow: hidden; overflow-x: auto; }
.um-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
.um-table th {
  padding: 9px 12px; background: var(--um-subtle); border-bottom: 1px solid var(--um-border);
  font-size: 12px; font-weight: 600; color: var(--um-muted); white-space: nowrap;
}
.um-table td { padding: 9px 12px; color: var(--um-muted); border-bottom: 1px solid #eef2f7; white-space: nowrap; }
.um-table tr:last-child td { border-bottom: none; }
.um-table td.strong { color: var(--um-text); font-weight: 500; }
.um-more { margin-top: 6px; font-size: 12px; color: var(--um-muted); }

/* ---------- Alerts ---------- */
.um-alert {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 14px; border-radius: 12px; border: 1px solid; font-size: 13px; line-height: 1.5;
}
.um-alert svg { flex-shrink: 0; margin-top: 2px; }
.um-alert ul { margin: 4px 0 0 16px; padding: 0; }
.um-alert-title { font-weight: 600; }
.um-alert.error { background: var(--um-danger-bg); border-color: var(--um-danger-border); color: var(--um-danger); }
.um-alert.warn { background: var(--um-warn-bg); border-color: var(--um-warn-border); color: var(--um-warn); }
.um-alert.success { background: var(--um-success-bg); border-color: var(--um-success-border); color: var(--um-success); }
.um-alert.info { background: #eff6ff; border-color: #bfdbfe; color: var(--um-primary-hover); }

.um-progress { height: 6px; margin-top: 10px; border-radius: 6px; background: #dbeafe; overflow: hidden; }
.um-progress > span { display: block; height: 100%; background: var(--um-primary); border-radius: 6px; transition: width .2s ease; }

.um-center { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 26px 0; font-size: 13.5px; color: var(--um-muted); }

@media (prefers-reduced-motion: reduce) {
  .um-backdrop, .um-modal { animation: none; }
  .um-modal, .um-btn, .um-tab, .um-input { transition: none; }
}
/* ---------- Users page: filters, table header, row actions ---------- */
.um-filter {
  height: 42px; padding: 0 34px 0 12px; border: 1px solid #d9e0ea; border-radius: 10px;
  background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
  font: inherit; font-size: 14px; color: #334155; cursor: pointer;
  appearance: none; -webkit-appearance: none; outline: none;
  transition: border-color .12s, box-shadow .12s;
}
.um-filter:hover { border-color: #b8c4d4; }
.um-filter:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .18); }
.um-link-btn {
  border: none; background: none; padding: 0 4px; font: inherit; font-size: 13px; font-weight: 600;
  color: #2563eb; cursor: pointer;
}
.um-link-btn:hover { text-decoration: underline; }

.um-users-table thead tr { background: var(--surface-hover, #f8fafc); border-bottom: 1px solid var(--border, #e2e8f0); }
.um-users-table th {
  padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600;
  letter-spacing: 0; text-transform: none; color: #64748b;
}
.um-users-table th:first-child { padding-left: 20px; }
.um-users-table th:last-child { padding-right: 20px; text-align: right; }

.um-acts { display: inline-flex; align-items: center; gap: 2px; }
.um-act {
  width: 34px; height: 34px; border-radius: 8px; border: none; background: transparent; color: #94a3b8;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .12s, color .12s;
}
.um-act:hover { background: #f1f5f9; color: #334155; }
.um-act.warn:hover { background: #fffbeb; color: #b45309; }
.um-act.ok:hover { background: #ecfdf5; color: #059669; }
.um-act.danger:hover { background: #fef2f2; color: #dc2626; }
.um-act:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(37, 99, 235, .18); }

/* ---------- Page scrolling ----------
   Cards keep their natural height so the page scrolls (instead of the table being squeezed
   and clipped), with a slim scrollbar that only shows while the pointer is over the page. */
.page-container.um-page > * { flex-shrink: 0; }
.page-container.um-page::-webkit-scrollbar { width: 10px; height: 10px; }
.page-container.um-page::-webkit-scrollbar-track { background: transparent; }
.page-container.um-page::-webkit-scrollbar-thumb {
  background-color: transparent; border-radius: 999px;
  border: 3px solid transparent; background-clip: padding-box;
  transition: background-color .2s ease;
}
.page-container.um-page:hover::-webkit-scrollbar-thumb,
.page-container.um-page:focus-within::-webkit-scrollbar-thumb { background-color: rgba(100, 116, 139, .45); }
.page-container.um-page::-webkit-scrollbar-thumb:hover { background-color: rgba(100, 116, 139, .75); }
[data-theme="dark"] .page-container.um-page:hover::-webkit-scrollbar-thumb,
[data-theme="dark"] .page-container.um-page:focus-within::-webkit-scrollbar-thumb { background-color: rgba(148, 163, 184, .4); }
[data-theme="dark"] .page-container.um-page::-webkit-scrollbar-thumb:hover { background-color: rgba(148, 163, 184, .7); }
@supports not selector(::-webkit-scrollbar) {
  .page-container.um-page { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .page-container.um-page:hover, .page-container.um-page:focus-within { scrollbar-color: rgba(100, 116, 139, .5) transparent; }
}

`;

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

// `scoped` = the signed-in user is a Department Admin:
//   - every imported user is a Staff account
//   - the department must be one of the departments passed in (already limited by the backend)
function processParsedRows(rawRows, departments, options = {}) {
  const scoped = !!options.scoped;
  const validUsers = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowNum = index + 2;
    const name = (row.name || row.fullname || row.username || row['fullname'] || '').trim();
    const email = (row.email || row.collegeemail || row.mail || row['collegeemail'] || '').trim().toLowerCase();
    let password = (row.password || row.initialpassword || row.pass || row['initialpassword'] || '').trim();
    let role = (row.role || row.userrole || '').trim().toLowerCase();
    role = scoped ? 'user' : role === 'admin' ? 'admin' : 'user';

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
      } else if (scoped) {
        errors.push(`Row ${rowNum} (${name}): "${row.department || row.dept}" is not one of your departments.`);
        return;
      } else {
        departmentDisplay = row.department || row.dept || 'Unknown';
      }
    } else if (scoped) {
      if (departments && departments.length === 1) {
        departmentId = departments[0]._id;
        departmentDisplay = `${departments[0].name} (${departments[0].code})`;
      } else {
        errors.push(`Row ${rowNum} (${name}): Department is required.`);
        return;
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
  const scoped = isDepartmentAdmin(currentUser);
  // A Department Admin with exactly one department never has to pick it manually.
  const defaultDeptId = scoped && departments.length === 1 ? departments[0]._id : '';

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all'); // 'all' | 'user' | 'admin'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'suspended'
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
  const [showPassword, setShowPassword] = useState(false);

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
    setShowPassword(false);
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

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch =
      (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || (u.role === 'admin' ? 'admin' : 'user') === roleFilter;
    const userActive = (u.status || 'active') === 'active';
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'active') === userActive;
    return matchesSearch && matchesRole && matchesStatus;
  });
  const hasActiveFilters = search !== '' || roleFilter !== 'all' || statusFilter !== 'all';

  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onCreateUser({
        ...formData,
        role: scoped ? 'user' : formData.role,
        departmentId: formData.departmentId || defaultDeptId
      });
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

      const { validUsers, errors } = processParsedRows(rawRows, departments, { scoped });

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
    // Sample rows use a real department from the list this user can access.
    const sampleDept = departments[0]?.name || 'Department name';
    let csvContent =
      'Name,Email,Password,Role,Department\n' +
      `Prof. Alex Johnson,alex.johnson@college.edu,Welcome@2025,user,${sampleDept}\n` +
      `Prof. Alan Turing,alan.turing@college.edu,Welcome@2025,user,${sampleDept}\n`;

    if (!scoped) {
      csvContent += `Dr. Maria Garcia,maria.garcia@college.edu,Welcome@2025,admin,${sampleDept}\n`;
    }

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

  const busy = isSubmitting || isImporting;

  return (
    <div className="page-container um-page">
      <style>{MODAL_CSS}</style>

      {/* ── Page Header ── */}
      <div className="page-header-row">
        <div>
          <h1 className="page-title">Users &amp; Staff</h1>
          <p className="page-subtitle">
            {scoped
              ? 'Manage staff accounts and login access for your departments.'
              : 'Manage teacher and staff accounts, roles, department scope, and login access.'}
          </p>
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

      {/* ── Filter / Search Bar ── */}
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
        {!scoped && (
          <select
            className="um-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            <option value="user">Staff</option>
            <option value="admin">Admin</option>
          </select>
        )}
        <select
          className="um-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            className="um-link-btn"
            onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); }}
          >
            Clear filters
          </button>
        )}
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {filteredUsers.length} of {users.length} {users.length === 1 ? 'user' : 'users'}
        </span>
      </div>

      {/* ── Users Table ── */}
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
            {scoped
              ? 'No staff in your departments yet. Add individual staff or bulk-import a spreadsheet.'
              : 'Add individual staff or teachers, or bulk-import a spreadsheet to get started.'}
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
            <table className="um-users-table" style={{ width: '100%', minWidth: '680px', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                          <div className="um-acts">
                            <button
                              type="button"
                              className={`um-act ${isActive ? 'warn' : 'ok'}`}
                              title={isActive ? 'Suspend user' : 'Activate user'}
                              aria-label={isActive ? 'Suspend user' : 'Activate user'}
                              onClick={() => onToggleStatus(u._id, isActive ? 'suspended' : 'active')}
                            >
                              <Power size={15} />
                            </button>
                            <button
                              type="button"
                              className="um-act danger"
                              title="Delete user"
                              aria-label="Delete user"
                              onClick={() => onDeleteUser(u)}
                            >
                              <Trash2 size={15} />
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

      {/* ── Add User Modal (redesigned) ── */}
      {showAddModal && (
        <div className="um-backdrop" onClick={() => { if (!busy) handleCloseModal(); }}>
          <div
            className={`um-modal${modalTab === 'bulk' ? ' wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="um-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="um-header">
              <div className="um-header-icon">
                <UserPlus size={20} strokeWidth={2} />
              </div>
              <div className="um-header-text">
                <h2 className="um-title" id="um-title">Add college user</h2>
                <p className="um-subtitle">
                  {modalTab === 'single'
                    ? 'Create an account with a department and role.'
                    : 'Upload a spreadsheet to import multiple accounts at once.'}
                </p>
              </div>
              <button
                type="button"
                className="um-close"
                onClick={handleCloseModal}
                disabled={busy}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Tabs */}
            <div className="um-tabs-wrap">
              <div className="um-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === 'single'}
                  className={`um-tab ${modalTab === 'single' ? 'active' : ''}`}
                  onClick={() => { setModalTab('single'); setBulkError(''); }}
                  disabled={busy}
                >
                  <User size={15} />
                  <span>Single user</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === 'bulk'}
                  className={`um-tab ${modalTab === 'bulk' ? 'active' : ''}`}
                  onClick={() => { setModalTab('bulk'); setBulkError(''); }}
                  disabled={busy}
                >
                  <FileSpreadsheet size={15} />
                  <span>Bulk import</span>
                </button>
              </div>
            </div>

            {/* ── TAB 1: Single User ── */}
            {modalTab === 'single' && (
              <form onSubmit={handleSingleSubmit} style={{ display: 'contents' }}>
                <div className="um-body">
                  <div className="um-field">
                    <label className="um-label" htmlFor="um-name">Full name<span className="req">*</span></label>
                    <div className="um-input-wrap">
                      <User size={16} className="um-icon" />
                      <input
                        id="um-name"
                        type="text"
                        required
                        autoFocus
                        className="um-input"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Prof. John Doe"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="um-field">
                    <label className="um-label" htmlFor="um-email">College email<span className="req">*</span></label>
                    <div className="um-input-wrap">
                      <Mail size={16} className="um-icon" />
                      <input
                        id="um-email"
                        type="email"
                        required
                        className="um-input"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="john@college.edu"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="um-field">
                    <label className="um-label" htmlFor="um-password">
                      Initial password<span className="opt">Optional</span>
                    </label>
                    <div className="um-input-wrap">
                      <Lock size={16} className="um-icon" />
                      <input
                        id="um-password"
                        type={showPassword ? 'text' : 'password'}
                        className="um-input pr"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="Minimum 6 characters"
                        autoComplete="new-password"
                        disabled={isSubmitting}
                      />
                      <button
                        type="button"
                        className="um-trailing"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="um-grid-2">
                    <div className="um-field">
                      <label className="um-label" htmlFor="um-role">Role</label>
                      <div className="um-input-wrap">
                        <Shield size={16} className="um-icon" />
                        <select
                          id="um-role"
                          className="um-input pr"
                          value={scoped ? 'user' : formData.role}
                          onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                          disabled={isSubmitting}
                        >
                          <option value="user">Teacher / Staff</option>
                          {!scoped && <option value="admin">Administrator</option>}
                        </select>
                        <ChevronDown size={16} className="um-chevron" />
                      </div>
                    </div>

                    <div className="um-field">
                      <label className="um-label" htmlFor="um-dept">
                        Department{scoped && <span className="req">*</span>}
                      </label>
                      <div className="um-input-wrap">
                        <Building2 size={16} className="um-icon" />
                        <select
                          id="um-dept"
                          className="um-input pr"
                          value={formData.departmentId || defaultDeptId}
                          onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                          required={scoped}
                          disabled={isSubmitting}
                        >
                          {scoped ? (
                            <option value="" disabled>Select department</option>
                          ) : (
                            <option value="">All / General</option>
                          )}
                          {departments.map((d) => (
                            <option key={d._id} value={d._id}>
                              {d.name} ({d.code})
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="um-chevron" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="um-footer">
                  <button
                    type="button"
                    className="um-btn um-btn-ghost"
                    onClick={handleCloseModal}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="um-btn um-btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <>
                        <Loader2 size={15} className="spin" />
                        <span>Creating…</span>
                      </>
                    ) : (
                      <span>Create user</span>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ── TAB 2: Bulk Import ── */}
            {modalTab === 'bulk' && (
              <>
                <div className="um-body">
                  {/* Template row */}
                  <div className="um-info">
                    <div className="um-info-text">
                      <span className="um-info-icon"><FileSpreadsheet size={16} /></span>
                      <span>
                        Required columns: <strong>Name, Email</strong>.{' '}
                        {scoped
                          ? 'Optional: Password, Department. Everyone is added as staff in one of your departments.'
                          : 'Optional: Password, Role, Department.'}
                      </span>
                    </div>
                    <button type="button" className="um-btn um-btn-ghost um-btn-sm" onClick={handleDownloadTemplate}>
                      <Download size={14} />
                      <span>Sample template</span>
                    </button>
                  </div>

                  {/* Dropzone */}
                  {!selectedFile && (
                    <div
                      className={`um-dropzone${isDragging ? ' dragging' : ''}`}
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
                        className="um-sr-file"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) handleFileProcess(e.target.files[0]);
                        }}
                        tabIndex={-1}
                      />
                      <div className="um-dropzone-icon">
                        <UploadCloud size={24} strokeWidth={1.8} />
                      </div>
                      <div className="um-dropzone-title">
                        {isDragging ? 'Drop your file here' : 'Drag and drop your spreadsheet'}
                      </div>
                      <div className="um-dropzone-or">or</div>
                      <button
                        type="button"
                        className="um-btn um-btn-ghost um-btn-sm"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      >
                        Browse files
                      </button>
                      <div className="um-dropzone-formats">Supports .xlsx and .csv</div>
                    </div>
                  )}

                  {/* Parsing */}
                  {isParsing && (
                    <div className="um-center">
                      <Loader2 size={22} className="spin" style={{ color: 'var(--um-primary, #2563eb)' }} />
                      <span>Reading spreadsheet rows…</span>
                    </div>
                  )}

                  {/* File card + preview */}
                  {selectedFile && !isParsing && (
                    <>
                      <div className="um-file">
                        <div className="um-file-left">
                          <span className="um-info-icon" style={{ width: 36, height: 36, borderRadius: 10 }}>
                            <FileSpreadsheet size={18} />
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="um-file-name">{selectedFile.name}</div>
                            <div className="um-file-meta">
                              {selectedFile.size} &nbsp;·&nbsp;{' '}
                              <span className={parsedUsers.length > 0 ? 'ok' : 'bad'}>
                                {parsedUsers.length} {parsedUsers.length === 1 ? 'user' : 'users'} ready to import
                              </span>
                            </div>
                          </div>
                        </div>
                        {!isImporting && (
                          <button
                            type="button"
                            className="um-close"
                            title="Remove file"
                            aria-label="Remove file"
                            onClick={() => {
                              setSelectedFile(null);
                              setParsedUsers([]);
                              setParseErrors([]);
                              setBulkError('');
                              setImportStatus(null);
                              if (fileInputRef.current) fileInputRef.current.value = '';
                            }}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>

                      {parsedUsers.length > 0 && (
                        <div>
                          <p className="um-section-label">
                            Preview: first {Math.min(5, parsedUsers.length)} of {parsedUsers.length} rows
                          </p>
                          <div className="um-table-wrap">
                            <table className="um-table">
                              <thead>
                                <tr>
                                  {['Name', 'Email', 'Role', 'Department'].map((h) => (
                                    <th key={h}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {parsedUsers.slice(0, 5).map((row, idx) => (
                                  <tr key={idx}>
                                    <td className="strong">{row.name}</td>
                                    <td>{row.email}</td>
                                    <td>
                                      <span className={`role-badge ${row.role === 'admin' ? 'admin' : 'user'}`}>
                                        {row.role === 'admin' ? 'Admin' : 'Staff'}
                                      </span>
                                    </td>
                                    <td>{row.departmentDisplay}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {parsedUsers.length > 5 && (
                            <div className="um-more">+ {parsedUsers.length - 5} more users will be imported</div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Skipped rows */}
                  {parseErrors.length > 0 && (
                    <div className="um-alert warn">
                      <AlertCircle size={15} />
                      <div>
                        <div className="um-alert-title">
                          {parseErrors.length} row{parseErrors.length > 1 ? 's' : ''} skipped
                        </div>
                        <ul>
                          {parseErrors.slice(0, 3).map((err, i) => <li key={i}>{err}</li>)}
                          {parseErrors.length > 3 && <li>…and {parseErrors.length - 3} more</li>}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* File error */}
                  {bulkError && (
                    <div className="um-alert error">
                      <AlertCircle size={15} />
                      <span>{bulkError}</span>
                    </div>
                  )}

                  {/* Import progress / result */}
                  {importStatus && (
                    isImporting ? (
                      <div className="um-alert info" style={{ display: 'block' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Loader2 size={15} className="spin" style={{ marginTop: 0 }} />
                          <span>
                            Importing {importStatus.current} of {importStatus.total}
                            {importStatus.userEmail ? ` (${importStatus.userEmail})` : ''}…
                          </span>
                        </div>
                        <div className="um-progress">
                          <span style={{ width: `${(importStatus.current / importStatus.total) * 100}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className={`um-alert ${importStatus.failed > 0 ? 'error' : 'success'}`}>
                        <CheckCircle2 size={15} />
                        <div>
                          <div className="um-alert-title">
                            {importStatus.success} created successfully
                            {importStatus.failed > 0 && `, ${importStatus.failed} failed`}
                          </div>
                          {importStatus.errors && importStatus.errors.length > 0 && (
                            <ul>
                              {importStatus.errors.slice(0, 4).map((err, idx) => <li key={idx}>{err}</li>)}
                              {importStatus.errors.length > 4 && <li>…and {importStatus.errors.length - 4} more</li>}
                            </ul>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>

                <div className="um-footer">
                  <button
                    type="button"
                    className="um-btn um-btn-ghost"
                    onClick={handleCloseModal}
                    disabled={isImporting}
                  >
                    {importStatus && !isImporting ? 'Close' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    className="um-btn um-btn-primary"
                    onClick={handleBulkImport}
                    disabled={parsedUsers.length === 0 || isImporting}
                  >
                    {isImporting ? (
                      <>
                        <Loader2 size={15} className="spin" />
                        <span>Importing ({importStatus?.current || 0}/{parsedUsers.length})…</span>
                      </>
                    ) : (
                      <>
                        <Check size={15} />
                        <span>Import {parsedUsers.length > 0 ? `${parsedUsers.length} users` : 'users'}</span>
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