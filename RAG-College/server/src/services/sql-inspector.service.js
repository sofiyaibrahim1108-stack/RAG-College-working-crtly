const XLSX = require('xlsx');

// Build standard locale month lookup dynamically from JS Intl API (zero hardcoded month map)
function getStandardMonthLookup() {
  const lookup = new Map();
  const longFmt = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
  const shortFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

  for (let m = 0; m < 12; m++) {
    const sampleDate = new Date(Date.UTC(2000, m, 15));
    const longName = longFmt.format(sampleDate).toLowerCase();
    const shortName = shortFmt.format(sampleDate).toLowerCase().replace(/\.$/, '');
    lookup.set(longName, m + 1);
    lookup.set(shortName, m + 1);
  }
  return lookup;
}

const STANDARD_MONTHS = getStandardMonthLookup();

function cleanCellString(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n?/g, '\n').trim();
}

function cleanHeaderText(value) {
  return cleanCellString(value).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isCellEmpty(value) {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' && value.trim() === '';
}

function parseMonthFromLabel(label) {
  const tokens = String(label || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  for (const tok of tokens) {
    if (STANDARD_MONTHS.has(tok)) return STANDARD_MONTHS.get(tok);
    // Match 4-letter standard prefix (e.g. "sept") against Intl month names
    for (const [name, num] of STANDARD_MONTHS.entries()) {
      if (tok.length >= 3 && name.startsWith(tok)) return num;
    }
  }
  return null;
}

function extractYearRangeFromText(text) {
  const str = String(text || '');
  const rangeMatch = str.match(/\b((?:19|20)\d{2})\s*[-_/–]\s*((?:19|20)\d{2}|\d{2})\b/);
  if (rangeMatch) {
    const startYear = Number(rangeMatch[1]);
    let endYear = Number(rangeMatch[2]);
    if (endYear < 100) endYear = Math.floor(startYear / 100) * 100 + endYear;
    if (endYear >= startYear) {
      return { type: 'range', startYear, endYear, label: `${startYear}-${endYear}` };
    }
  }

  const singleMatch = str.match(/\b((?:19|20)\d{2})\b/);
  if (singleMatch) {
    const year = Number(singleMatch[1]);
    return { type: 'single', startYear: year, endYear: year, label: String(year) };
  }

  return null;
}

/**
 * Infers year per sheet dynamically from workbook sheet order without assuming a start month.
 * Whenever sequential month numbers wrap around (e.g. 12 -> 1), the year increments.
 */
function inferSheetYearSequence(sheetNames, yearContext) {
  const result = new Map();
  if (!yearContext) return result;

  let currentYear = yearContext.startYear;
  let prevMonth = null;

  for (const name of sheetNames) {
    const month = parseMonthFromLabel(name);
    if (month !== null) {
      if (prevMonth !== null && month < prevMonth && currentYear < yearContext.endYear) {
        currentYear += 1;
      }
      result.set(name, { month, year: currentYear });
      prevMonth = month;
    }
  }

  return result;
}

/**
 * Pure character-encoding heuristic for OCR / legacy-font corruption.
 * Detects replacement characters, control chars, or Latin-1 mojibake mixed into ASCII text.
 */
function isCorruptedEncodingText(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 3) return false;

  // Unicode replacement char or C0/C1 control characters (excluding \t, \n, \r)
  if (/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text)) {
    return true;
  }

  const extendedLatinMatches = text.match(/[\u00A1-\u00FF]/g) || [];
  const hasAsciiLetters = /[A-Za-z]/.test(text);

  // Multiple Latin-1 supplement chars mixed with ASCII or punctuation-inside-words
  if (extendedLatinMatches.length >= 2 && hasAsciiLetters) return true;
  if (/[A-Za-z][<$>|»¿\u00A1-\u00FF][A-Za-z]/.test(text)) return true;

  return false;
}

function classifySingleValue(val) {
  if (isCellEmpty(val)) return 'empty';
  if (val instanceof Date && !Number.isNaN(val.getTime())) return 'date';

  if (typeof val === 'number' && Number.isFinite(val)) {
    return Number.isInteger(val) ? 'integer' : 'number';
  }

  const str = cleanCellString(val);
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(str)) {
    return 'iso_date';
  }
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(str)) {
    return 'delimited_date';
  }

  // Numeric string (allowing optional commas and single currency prefix/suffix)
  const strippedNum = str.replace(/[,_\s]/g, '').replace(/^[^\d.+-]+|[^\d.]+$/g, '');
  if (strippedNum !== '' && !Number.isNaN(Number(strippedNum)) && /\d/.test(strippedNum)) {
    return Number.isInteger(Number(strippedNum)) ? 'integer' : 'number';
  }

  return 'string';
}

/**
 * Structurally detects the header row by skipping blank rows and merged title banners.
 */
function detectHeaderRowIndex(matrix, merges = []) {
  const maxScan = Math.min(matrix.length, 20);
  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let r = 0; r < maxScan; r++) {
    const row = matrix[r] || [];
    const filled = [];

    for (let c = 0; c < row.length; c++) {
      if (!isCellEmpty(row[c])) {
        filled.push({ col: c, raw: row[c], text: cleanHeaderText(row[c]) });
      }
    }

    if (filled.length === 0) continue;

    // Skip single-cell merged banner rows spanning multiple columns
    const isMergedBanner =
      filled.length === 1 &&
      merges.some((m) => m.s.r === r && m.e.r === r && m.e.c > m.s.c);
    if (isMergedBanner) continue;

    const nonNumericStrings = filled.filter((x) => classifySingleValue(x.raw) === 'string');
    const uniqueLabels = new Set(filled.map((x) => x.text.toLowerCase()));

    let score = 0;
    score += filled.length * 3;
    score += nonNumericStrings.length * 4;
    score += uniqueLabels.size * 2;
    if (filled.length === 1) score -= 10;

    // Bonus if subsequent rows exist and have comparable or greater density
    const nextRow = matrix[r + 1] || [];
    const nextFilled = nextRow.filter((v) => !isCellEmpty(v)).length;
    if (nextFilled >= 2) score += 4;

    // Slight preference for earlier rows on exact ties
    score -= r * 0.25;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  return bestIdx;
}

/**
 * Removes completely empty spacer columns (commonly caused by horizontal cell merges).
 */
function extractActiveColumns(matrix, headerRowIdx, merges = []) {
  const headerRow = matrix[headerRowIdx] || [];
  const maxCols = matrix.reduce((max, row) => Math.max(max, (row || []).length), 0);

  const horizontalSpannedCols = new Set();
  for (const m of merges) {
    if (m.s.r === headerRowIdx && m.e.c > m.s.c) {
      for (let c = m.s.c + 1; c <= m.e.c; c++) {
        horizontalSpannedCols.add(c);
      }
    }
  }

  const activeCols = [];
  const seenHeaders = new Map();
  let removedSpacerCols = 0;

  for (let c = 0; c < maxCols; c++) {
    const rawHeader = cleanHeaderText(headerRow[c]);
    let hasDataBelow = false;

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      if (!isCellEmpty((matrix[r] || [])[c])) {
        hasDataBelow = true;
        break;
      }
    }

    if (!rawHeader && (!hasDataBelow || horizontalSpannedCols.has(c))) {
      removedSpacerCols += 1;
      continue;
    }

    let header = rawHeader || `Column_${c + 1}`;
    const lower = header.toLowerCase();
    if (seenHeaders.has(lower)) {
      const count = seenHeaders.get(lower) + 1;
      seenHeaders.set(lower, count);
      header = `${header}_${count}`;
    } else {
      seenHeaders.set(lower, 1);
    }

    activeCols.push({ colIndex: c, header });
  }

  return { activeCols, removedSpacerCols };
}

/**
 * Profiles each column purely from its cell values (zero header-name assumptions).
 */
function profileColumns(headers, rawRows) {
  const profiles = new Map();

  for (const header of headers) {
    const counts = {
      integer: 0,
      number: 0,
      iso_date: 0,
      delimited_date: 0,
      date: 0,
      string: 0,
      empty: 0
    };

    for (const row of rawRows) {
      const kind = classifySingleValue(row.data[header]);
      counts[kind] = (counts[kind] || 0) + 1;
    }

    const nonEmpty = rawRows.length - counts.empty;
    let dominantType = 'empty';
    let dominantCount = 0;

    for (const [k, cnt] of Object.entries(counts)) {
      if (k === 'empty') continue;
      if (cnt > dominantCount) {
        dominantCount = cnt;
        dominantType = k;
      }
    }

    const numericTotal = counts.integer + counts.number;
    const dateTotal = counts.iso_date + counts.delimited_date + counts.date;

    let semanticGroup = 'string';
    if (nonEmpty === 0) semanticGroup = 'empty';
    else if (dateTotal / nonEmpty >= 0.6) semanticGroup = 'date';
    else if (numericTotal / nonEmpty >= 0.7) semanticGroup = 'numeric';

    profiles.set(header, {
      header,
      nonEmpty,
      fillRatio: rawRows.length > 0 ? nonEmpty / rawRows.length : 0,
      dominantType,
      semanticGroup,
      counts
    });
  }

  return profiles;
}

/**
 * Structurally detects trailing summary/footer rows without any keyword list.
 * A trailing row is flagged if it violates the established column types (e.g., text inside a
 * numeric/date primary column) while having sparse fill compared to normal rows.
 */
function detectStructuralFooterRows(rawRows, headers, colProfiles) {
  if (rawRows.length < 3) return new Set();

  const fillCounts = rawRows
    .map((r) => headers.filter((h) => !isCellEmpty(r.data[h])).length)
    .sort((a, b) => a - b);
  const medianFill = fillCounts[Math.floor(fillCounts.length / 2)] || 1;

  const footerRowNumbers = new Set();
  const maxTrailingCheck = Math.min(3, rawRows.length - 1);

  for (let i = rawRows.length - 1; i >= rawRows.length - maxTrailingCheck; i--) {
    const row = rawRows[i];
    const filledHeaders = headers.filter((h) => !isCellEmpty(row.data[h]));
    if (filledHeaders.length === 0) continue;

    let typeBreakCount = 0;
    for (const h of filledHeaders) {
      const profile = colProfiles.get(h);
      if (!profile) continue;
      const cellKind = classifySingleValue(row.data[h]);
      if (
        (profile.semanticGroup === 'numeric' || profile.semanticGroup === 'date') &&
        cellKind === 'string'
      ) {
        typeBreakCount += 1;
      }
    }

    const isSparse = filledHeaders.length <= Math.max(2, Math.floor(medianFill * 0.6));
    if (typeBreakCount > 0 && isSparse) {
      footerRowNumbers.add(row.rowNumber);
    } else {
      // Stop scanning upwards once we hit a normal data row
      break;
    }
  }

  return footerRowNumbers;
}

/**
 * Pure value-based date format analysis for each column.
 */
function analyzeDateColumns(headers, dataRows, sheetName, inferredDateContext) {
  const dateColumns = [];

  for (const header of headers) {
    const values = dataRows
      .map((r) => r.data[header])
      .filter((v) => !isCellEmpty(v));

    if (values.length === 0) continue;

    let isoCount = 0;
    let delimitedCount = 0;
    let dmyDefinite = 0;
    let mdyDefinite = 0;
    let excelSerialCount = 0;
    let dayIntValues = [];

    for (const raw of values) {
      if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        isoCount += 1;
        continue;
      }

      if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (Number.isInteger(raw) && raw >= 1 && raw <= 31) {
          dayIntValues.push(raw);
        } else if (raw >= 25000 && raw <= 60000) {
          excelSerialCount += 1;
        }
        continue;
      }

      const str = cleanCellString(raw);
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
        isoCount += 1;
      } else if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.test(str)) {
        delimitedCount += 1;
        const [, p1, p2] = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
        const n1 = Number(p1);
        const n2 = Number(p2);
        if (n1 > 12 && n2 <= 12) dmyDefinite += 1;
        else if (n2 > 12 && n1 <= 12) mdyDefinite += 1;
      } else if (/^\d{1,2}$/.test(str)) {
        const n = Number(str);
        if (n >= 1 && n <= 31) dayIntValues.push(n);
      }
    }

    const total = values.length;

    if (delimitedCount / total >= 0.6) {
      if (dmyDefinite > 0 && mdyDefinite === 0) {
        dateColumns.push({
          header,
          kind: 'delimited_dmy',
          format: 'DD-MM-YYYY',
          requiresConfirmation: false
        });
      } else if (mdyDefinite > 0 && dmyDefinite === 0) {
        dateColumns.push({
          header,
          kind: 'delimited_mdy',
          format: 'MM-DD-YYYY',
          requiresConfirmation: false
        });
      } else {
        dateColumns.push({
          header,
          kind: 'ambiguous_delimited',
          suggestedFormat: 'DD-MM-YYYY',
          requiresConfirmation: true
        });
      }
      continue;
    }

    if (isoCount / total >= 0.6) {
      dateColumns.push({
        header,
        kind: 'iso',
        format: 'YYYY-MM-DD',
        requiresConfirmation: false
      });
      continue;
    }

    if (excelSerialCount / total >= 0.7) {
      dateColumns.push({
        header,
        kind: 'excel_serial',
        format: 'Excel Serial Date',
        requiresConfirmation: false
      });
      continue;
    }

    // Day-only numeric sequence (purely value-driven: 1..31 sequential integers when sheet has a calendar month)
    if (
      inferredDateContext &&
      inferredDateContext.month &&
      dayIntValues.length / total >= 0.8 &&
      dayIntValues.length >= 15
    ) {
      const uniqueDays = new Set(dayIntValues);
      if (uniqueDays.size >= 15 && Math.min(...dayIntValues) === 1 && Math.max(...dayIntValues) <= 31) {
        dateColumns.push({
          header,
          kind: 'day_only',
          requiresConfirmation: true,
          inferredMonth: inferredDateContext.month,
          inferredYear: inferredDateContext.year,
          sheetName
        });
      }
    }
  }

  return dateColumns;
}

/**
 * Deterministic date normalizer used during /confirm using explicit admin choices.
 */
function normalizeDateValue(raw, options = {}) {
  if (isCellEmpty(raw)) return null;

  const {
    format = 'DD-MM-YYYY',
    dayOnlyConfirmed = false,
    month = null,
    year = null
  } = options;

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (dayOnlyConfirmed && month && year) {
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n >= 1 && n <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
    }
  }

  if (typeof raw === 'number' && raw >= 25000 && raw <= 60000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const str = cleanCellString(raw);
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const delimited = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (delimited) {
    const p1 = Number(delimited[1]);
    const p2 = Number(delimited[2]);
    let y = Number(delimited[3]);
    if (y < 100) y += 2000;

    const mon = format === 'MM-DD-YYYY' ? p1 : p2;
    const day = format === 'MM-DD-YYYY' ? p2 : p1;

    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const fallback = new Date(str);
  if (!Number.isNaN(fallback.getTime())) {
    const y = fallback.getUTCFullYear();
    const m = String(fallback.getUTCMonth() + 1).padStart(2, '0');
    const d = String(fallback.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Inspects a single worksheet deterministically without mutating ambiguous data.
 */
function inspectWorksheet(sheet, sheetName, inferredDateContext) {
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true
  });

  if (!matrix || matrix.length === 0) {
    return {
      sheetName,
      empty: true,
      headerRowNumber: 1,
      skippedTopRows: 0,
      removedSpacerCols: 0,
      headers: [],
      rows: [],
      completelyEmptyRowNumbers: [],
      footerRows: [],
      partialRows: [],
      verticalMerges: [],
      ocrCorruptedCells: [],
      dateColumns: []
    };
  }

  const headerRowIdx = detectHeaderRowIndex(matrix, merges);
  const { activeCols, removedSpacerCols } = extractActiveColumns(matrix, headerRowIdx, merges);
  const headers = activeCols.map((c) => c.header);
  const colIndexToHeader = new Map(activeCols.map((c) => [c.colIndex, c.header]));

  // Detect vertically merged cells inside the data region (suggest forward-fill, never auto-apply)
  const verticalMerges = [];
  for (const m of merges) {
    if (m.s.r > headerRowIdx && m.e.r > m.s.r) {
      const header = colIndexToHeader.get(m.s.c);
      if (!header) continue;
      const anchorValue = cleanCellString((matrix[m.s.r] || [])[m.s.c]);
      if (anchorValue) {
        verticalMerges.push({
          sheetName,
          column: header,
          startRowNumber: m.s.r + 1,
          endRowNumber: m.e.r + 1,
          rowSpan: m.e.r - m.s.r + 1,
          anchorValue
        });
      }
    }
  }

  const completelyEmptyRowNumbers = [];
  const nonEmptyRows = [];

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const rawRow = matrix[r] || [];
    const rowObj = {};
    let filledCount = 0;

    for (const col of activeCols) {
      const val = rawRow[col.colIndex];
      const cleaned = typeof val === 'string' ? cleanCellString(val) : val;
      rowObj[col.header] = isCellEmpty(cleaned) ? null : cleaned;
      if (!isCellEmpty(cleaned)) filledCount += 1;
    }

    if (filledCount === 0) {
      completelyEmptyRowNumbers.push(r + 1);
    } else {
      nonEmptyRows.push({
        sheetName,
        rowNumber: r + 1,
        filledCount,
        data: rowObj
      });
    }
  }

  const colProfiles = profileColumns(headers, nonEmptyRows);
  const footerRowSet = detectStructuralFooterRows(nonEmptyRows, headers, colProfiles);

  const footerRows = [];
  const dataRows = [];
  const partialRows = [];
  const ocrCorruptedCells = [];

  for (const row of nonEmptyRows) {
    if (footerRowSet.has(row.rowNumber)) {
      footerRows.push({
        sheetName,
        rowNumber: row.rowNumber,
        preview: row.data
      });
      continue;
    }

    const missingColumns = headers.filter((h) => isCellEmpty(row.data[h]));
    if (missingColumns.length > 0) {
      partialRows.push({
        sheetName,
        rowNumber: row.rowNumber,
        missingColumns,
        preview: row.data
      });
    }

    for (const h of headers) {
      const val = row.data[h];
      if (isCorruptedEncodingText(val)) {
        ocrCorruptedCells.push({
          sheetName,
          rowNumber: row.rowNumber,
          column: h,
          rawValue: val
        });
      }
    }

    dataRows.push(row);
  }

  const dateColumns = analyzeDateColumns(headers, dataRows, sheetName, inferredDateContext);

  return {
    sheetName,
    empty: dataRows.length === 0,
    headerRowNumber: headerRowIdx + 1,
    skippedTopRows: headerRowIdx,
    removedSpacerCols,
    headers,
    rows: dataRows,
    completelyEmptyRowNumbers,
    footerRows,
    partialRows,
    verticalMerges,
    ocrCorruptedCells,
    dateColumns
  };
}

/**
 * Inspects an entire CSV/XLS/XLSX workbook across all visible sheets.
 */
function inspectWorkbookFile(filePath, originalFileName = '') {
  const workbook = XLSX.readFile(filePath, {
    cellDates: false,
    cellNF: false,
    cellText: false
  });

  const wbMeta = workbook.Workbook?.Sheets || [];
  const visibleSheetNames = workbook.SheetNames.filter((_name, idx) => {
    const meta = wbMeta[idx];
    return !meta || !meta.Hidden;
  });

  const hiddenSheetNames = workbook.SheetNames.filter((name) => !visibleSheetNames.includes(name));
  const yearContext = extractYearRangeFromText(originalFileName);
  const sheetYearMap = inferSheetYearSequence(visibleSheetNames, yearContext);

  const sheets = visibleSheetNames.map((name) =>
    inspectWorksheet(workbook.Sheets[name], name, sheetYearMap.get(name) || null)
  );

  const nonEmptySheets = sheets.filter((s) => !s.empty);
  const referenceSheet = nonEmptySheets[0] || sheets[0];
  const refSignature = (referenceSheet?.headers || []).map((h) => h.toLowerCase()).join('|');

  const compatibleSheetNames = nonEmptySheets
    .filter((s) => s.headers.map((h) => h.toLowerCase()).join('|') === refSignature)
    .map((s) => s.sheetName);

  const incompatibleSheetNames = nonEmptySheets
    .filter((s) => !compatibleSheetNames.includes(s.sheetName))
    .map((s) => s.sheetName);

  return {
    sheetNames: visibleSheetNames,
    hiddenSheetNames,
    yearContext,
    compatibleSheetNames,
    incompatibleSheetNames,
    allSheetsCompatible:
      nonEmptySheets.length > 1 && compatibleSheetNames.length === nonEmptySheets.length,
    sheets
  };
}

/**
 * Builds plain-language Preflight Diagnostic Report grouped into
 * autoHandled, needsConfirmation, and blockers.
 */
function buildPreflightReport(inspection, options = {}) {
  const {
    suggestedTable = null,
    missingRequiredColumns = [],
    fileDuplicateWarning = null,
    rowDuplicateSummary = null
  } = options;

  const autoHandled = [];
  const needsConfirmation = [];
  const blockers = [];

  const totalSkippedTop = inspection.sheets.reduce((sum, s) => sum + s.skippedTopRows, 0);
  const totalSpacerCols = inspection.sheets.reduce((sum, s) => sum + s.removedSpacerCols, 0);
  const totalEmptyRows = inspection.sheets.reduce((sum, s) => sum + s.completelyEmptyRowNumbers.length, 0);

  if (totalSkippedTop > 0) {
    autoHandled.push({
      code: 'HEADER_ROW_DETECTED',
      title: 'Title/blank rows above headers skipped',
      details: `Detected the actual column headers below top banner or blank rows across ${
        inspection.sheets.filter((s) => s.skippedTopRows > 0).length
      } sheet(s).`
    });
  }

  if (totalSpacerCols > 0) {
    autoHandled.push({
      code: 'SPACER_COLUMNS_REMOVED',
      title: 'Empty merged spacer columns cleaned',
      details: `Removed ${totalSpacerCols} blank spacer column(s) created by horizontal cell merges.`
    });
  }

  if (totalEmptyRows > 0) {
    autoHandled.push({
      code: 'COMPLETELY_EMPTY_ROWS_SKIPPED',
      title: 'Completely empty rows skipped',
      details: `Skipped ${totalEmptyRows} completely blank row(s) containing no values.`,
      affectedCount: totalEmptyRows
    });
  }

  if (inspection.hiddenSheetNames.length > 0) {
    autoHandled.push({
      code: 'HIDDEN_SHEETS_IGNORED',
      title: 'Hidden sheets ignored',
      details: `Ignored ${inspection.hiddenSheetNames.length} hidden sheet(s): ${inspection.hiddenSheetNames.join(', ')}.`
    });
  }

  // 1. Multi-sheet workbook
  if (inspection.sheetNames.length > 1) {
    needsConfirmation.push({
      code: 'MULTI_SHEET_DETECTED',
      problem: `${inspection.sheetNames.length} sheets detected in this workbook`,
      affectedLocation: `Sheets: ${inspection.sheetNames.join(', ')}`,
      whyItMatters: 'Only one sheet is imported by default unless you choose to combine matching sheets.',
      suggestion: inspection.allSheetsCompatible
        ? `All ${inspection.compatibleSheetNames.length} sheets share the same columns. Combine all sheets into one import.`
        : `Select which sheet(s) you want to import (${inspection.compatibleSheetNames.length} sheet(s) share matching columns).`,
      actionType: 'select_sheets',
      meta: {
        compatibleSheetNames: inspection.compatibleSheetNames,
        incompatibleSheetNames: inspection.incompatibleSheetNames
      }
    });
  }

  // 2. Day-only dates (ALWAYS require admin confirmation)
  const dayOnlyCols = inspection.sheets.flatMap((s) =>
    s.dateColumns
      .filter((d) => d.kind === 'day_only')
      .map((d) => ({ ...d, sheetName: s.sheetName }))
  );

  if (dayOnlyCols.length > 0) {
    const sample = dayOnlyCols[0];
    needsConfirmation.push({
      code: 'DAY_ONLY_DATES',
      problem: 'Dates contain only day numbers (1–31)',
      affectedLocation: `${dayOnlyCols.length} sheet(s), column "${sample.header}"`,
      whyItMatters: 'Complete calendar dates (day, month, and year) are needed so date queries work accurately.',
      suggestion: inspection.yearContext
        ? `Combine each sheet's month name with year ${inspection.yearContext.label} to build full dates.`
        : 'Confirm the month and year to combine with these day numbers.',
      actionType: 'confirm_day_only_dates',
      meta: {
        column: sample.header,
        yearContext: inspection.yearContext,
        sheetDatePlan: dayOnlyCols.map((d) => ({
          sheetName: d.sheetName,
          month: d.inferredMonth,
          year: d.inferredYear
        }))
      }
    });
  }

  // 3. Ambiguous delimited dates (DD-MM vs MM-DD)
  const ambiguousDateCols = inspection.sheets.flatMap((s) =>
    s.dateColumns
      .filter((d) => d.kind === 'ambiguous_delimited')
      .map((d) => ({ sheetName: s.sheetName, header: d.header, suggestedFormat: d.suggestedFormat }))
  );

  if (ambiguousDateCols.length > 0) {
    needsConfirmation.push({
      code: 'AMBIGUOUS_DATE_FORMAT',
      problem: 'Date order (Day/Month vs Month/Day) could not be determined with certainty',
      affectedLocation: ambiguousDateCols.map((d) => `${d.sheetName} ("${d.header}")`).join(', '),
      whyItMatters: 'Dates like 04-06-2027 can mean either 4 June or 6 April.',
      suggestion: 'Confirm whether these dates use DD-MM-YYYY or MM-DD-YYYY.',
      actionType: 'confirm_date_format',
      meta: { columns: ambiguousDateCols }
    });
  }

  // 4. Vertically merged cells (suggest forward-fill, never auto-apply)
  const allVerticalMerges = inspection.sheets.flatMap((s) => s.verticalMerges);
  if (allVerticalMerges.length > 0) {
    needsConfirmation.push({
      code: 'VERTICAL_MERGED_CELLS',
      problem: `${allVerticalMerges.length} vertically merged cell group(s) detected`,
      affectedLocation: allVerticalMerges
        .slice(0, 5)
        .map((m) => `${m.sheetName} (Row ${m.startRowNumber}–${m.endRowNumber}, "${m.column}")`)
        .join('; '),
      whyItMatters: 'Rows below the first merged cell appear blank unless the value is copied down.',
      suggestion: 'Confirm if you want to copy the merged value down to the spanned rows (forward-fill).',
      actionType: 'confirm_forward_fill',
      meta: { merges: allVerticalMerges }
    });
  }

  // 5. OCR / encoding-corrupted text (exact sheet + row, never auto-rewritten)
  const allOcrCells = inspection.sheets.flatMap((s) => s.ocrCorruptedCells);
  if (allOcrCells.length > 0) {
    needsConfirmation.push({
      code: 'UNREADABLE_TEXT_DETECTED',
      problem: `${allOcrCells.length} unreadable or corrupted text cell(s) detected`,
      affectedLocation: allOcrCells
        .slice(0, 8)
        .map((c) => `${c.sheetName} Row ${c.rowNumber} ("${c.column}")`)
        .join(', '),
      whyItMatters: 'These values appear garbled (often from PDF-to-Excel conversion) and will not be auto-rewritten.',
      suggestion: 'Review and edit these cells manually, skip those rows, or keep them as-is.',
      actionType: 'resolve_corrupted_cells',
      meta: { cells: allOcrCells }
    });
  }

  // 6. Summary / footer rows (identified separately, never silently discarded)
  const allFooterRows = inspection.sheets.flatMap((s) => s.footerRows);
  if (allFooterRows.length > 0) {
    needsConfirmation.push({
      code: 'SUMMARY_FOOTER_ROWS',
      problem: `${allFooterRows.length} summary or footer row(s) detected at the bottom of sheet(s)`,
      affectedLocation: allFooterRows
        .slice(0, 8)
        .map((r) => `${r.sheetName} Row ${r.rowNumber}`)
        .join(', '),
      whyItMatters: 'Summary totals or notes are usually not individual data records.',
      suggestion: 'Exclude these summary/footer rows from the import.',
      actionType: 'confirm_skip_footer_rows',
      meta: { rows: allFooterRows }
    });
  }

  // 7. Partially filled rows (identified separately, never silently discarded)
  const allPartialRows = inspection.sheets.flatMap((s) => s.partialRows);
  if (allPartialRows.length > 0) {
    needsConfirmation.push({
      code: 'PARTIALLY_FILLED_ROWS',
      problem: `${allPartialRows.length} partially filled row(s) have one or more blank columns`,
      affectedLocation: `${inspection.sheets.filter((s) => s.partialRows.length > 0).length} sheet(s) (e.g. ${allPartialRows
        .slice(0, 5)
        .map((r) => `${r.sheetName} Row ${r.rowNumber}`)
        .join(', ')})`,
      whyItMatters: 'Rows missing required information cannot be saved unless skipped or given a default value.',
      suggestion: 'Review these rows and choose whether to skip rows missing required fields.',
      actionType: 'confirm_partial_rows',
      meta: {
        count: allPartialRows.length,
        sampleRows: allPartialRows.slice(0, 15)
      }
    });
  }

  // 8. Missing required destination fields
  if (missingRequiredColumns.length > 0) {
    needsConfirmation.push({
      code: 'MISSING_REQUIRED_FIELDS',
      problem: `Required field(s) missing from this file: ${missingRequiredColumns.join(', ')}`,
      affectedLocation: 'Entire file',
      whyItMatters: 'The destination table requires a value for these fields on every imported record.',
      suggestion: 'Map an existing column or provide a default value to apply during import.',
      actionType: 'provide_default_values',
      meta: { missingRequiredColumns }
    });
  }

  // 9. File-level duplicate
  if (fileDuplicateWarning?.isDuplicate) {
    needsConfirmation.push({
      code: 'FILE_DUPLICATE_WARNING',
      problem: 'This exact file was already imported earlier',
      affectedLocation: 'Entire file',
      whyItMatters: 'Re-importing the same file may create duplicate records.',
      suggestion: 'Review previous uploads and confirm whether you still want to proceed.',
      actionType: 'confirm_file_duplicate',
      meta: { previousUploads: fileDuplicateWarning.previousUploads || [] }
    });
  }

  // 10. Row-level duplicate
  if (rowDuplicateSummary && rowDuplicateSummary.duplicateCount > 0) {
    needsConfirmation.push({
      code: 'ROW_DUPLICATE_WARNING',
      problem: `${rowDuplicateSummary.duplicateCount} row(s) appear to match existing database records`,
      affectedLocation: rowDuplicateSummary.sampleMatches
        .slice(0, 5)
        .map((m) => `${m.sheetName} Row ${m.rowNumber}`)
        .join(', '),
      whyItMatters: 'Importing these rows may duplicate records that already exist.',
      suggestion: 'Choose whether to skip duplicate rows or import all rows anyway.',
      actionType: 'confirm_row_duplicates',
      meta: rowDuplicateSummary
    });
  }

  // Blocker: no matching SQL table
  if (!suggestedTable) {
    blockers.push({
      code: 'NO_MATCHING_SQL_TABLE',
      problem: 'No matching database table was found for this file',
      affectedLocation: 'Entire file',
      whyItMatters: 'This file does not match any existing structured SQL table.',
      suggestion: 'Select a target table manually if applicable, or upload this file to the Document Knowledge Base instead.',
      actionType: 'fallback_to_document_rag'
    });
  }

  return {
    autoHandled,
    needsConfirmation,
    blockers
  };
}

module.exports = {
  cleanCellString,
  cleanHeaderText,
  isCellEmpty,
  inspectWorkbookFile,
  inspectWorksheet,
  normalizeDateValue,
  buildPreflightReport
};