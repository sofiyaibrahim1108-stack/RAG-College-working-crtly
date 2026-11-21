const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSqlPool, querySql } = require('../config/sql.db');
const { MYSQL_DATABASE } = require('../config/env');
const { generateText } = require('./llm.service');
const { generateEmbedding, generateEmbeddingsBatch } = require('./embedding.service');
const SqlEmbedding = require('../models/SqlEmbedding');
const sqlVectorService = require('./sql-vector.service');
const sqlQueryTool = require('./sql-query.tool');
const {
  isCellEmpty,
  inspectWorkbookFile,
  normalizeDateValue,
  buildPreflightReport
} = require('./sql-inspector.service');

const TEMP_TTL_MS = Number(process.env.SQL_IMPORT_TEMP_TTL_MS) || 30 * 60 * 1000;
const EMBED_BATCH_SIZE = Number(process.env.SQL_EMBEDDING_BATCH_SIZE) || 16;
const ROW_DUP_SCAN_LIMIT = Number(process.env.SQL_ROW_DUP_SCAN_LIMIT) || 5000;
const EXCLUDED_TABLES = new Set(
  (process.env.SQL_EXCLUDED_TABLES || 'sql_dataset_registry')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
);

// In-memory staging map for uploaded files awaiting admin confirmation
const stagedUploads = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function cleanupExpiredUploads() {
  const now = Date.now();
  for (const [uploadId, entry] of stagedUploads.entries()) {
    if (now - entry.createdAt > TEMP_TTL_MS) {
      safeUnlink(entry.filePath);
      stagedUploads.delete(uploadId);
    }
  }
}

setInterval(cleanupExpiredUploads, 5 * 60 * 1000).unref();

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {
    // Ignore cleanup errors
  }
}

function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function yieldEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function escapeId(identifier) {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function parseJsonSafely(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function normalizeFingerprintValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildRowFingerprint(rowObj, keyColumns) {
  return keyColumns.map((col) => normalizeFingerprintValue(rowObj[col])).join('||');
}

/* ------------------------------------------------------------------ */
/* 1. Live MySQL Schema Inspection (Existing Tables Only)             */
/* ------------------------------------------------------------------ */

async function getExistingMysqlSchemas() {
  const rows = await querySql(
    `SELECT
       TABLE_NAME,
       COLUMN_NAME,
       DATA_TYPE,
       COLUMN_TYPE,
       IS_NULLABLE,
       COLUMN_DEFAULT,
       COLUMN_KEY,
       EXTRA,
       ORDINAL_POSITION
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [MYSQL_DATABASE]
  );

  const tableMap = new Map();

  for (const r of rows) {
    const tableName = r.TABLE_NAME;
    if (EXCLUDED_TABLES.has(tableName.toLowerCase())) continue;

    if (!tableMap.has(tableName)) {
      tableMap.set(tableName, {
        tableName,
        primaryKey: null,
        columns: []
      });
    }

    const isAutoIncrement = String(r.EXTRA || '').toLowerCase().includes('auto_increment');
    const isPrimaryKey = r.COLUMN_KEY === 'PRI';
    const hasDefault = r.COLUMN_DEFAULT !== null && r.COLUMN_DEFAULT !== undefined;
    const isRequired = r.IS_NULLABLE === 'NO' && !isAutoIncrement && !hasDefault;

    const tableEntry = tableMap.get(tableName);
    if (isPrimaryKey && !tableEntry.primaryKey) {
      tableEntry.primaryKey = r.COLUMN_NAME;
    }

    tableEntry.columns.push({
      name: r.COLUMN_NAME,
      dataType: r.DATA_TYPE,
      columnType: r.COLUMN_TYPE,
      nullable: r.IS_NULLABLE === 'YES',
      defaultValue: r.COLUMN_DEFAULT,
      isPrimaryKey,
      isAutoIncrement,
      isRequired
    });
  }

  return Array.from(tableMap.values());
}

/* ------------------------------------------------------------------ */
/* 2. Dynamic Row-Level Duplicate Checker (Schema-Driven)             */
/* ------------------------------------------------------------------ */

async function fetchExistingRowFingerprints(targetTable, keyColumns) {
  if (!targetTable || !Array.isArray(keyColumns) || keyColumns.length === 0) {
    return new Set();
  }

  const escapedTable = escapeId(targetTable);
  const escapedCols = keyColumns.map(escapeId).join(', ');
  const existingRows = await querySql(
    `SELECT ${escapedCols} FROM ${escapedTable} LIMIT ${ROW_DUP_SCAN_LIMIT}`
  );

  const fingerprints = new Set();
  for (const r of existingRows) {
    const fp = buildRowFingerprint(r, keyColumns);
    if (fp.replace(/\|/g, '') !== '') {
      fingerprints.add(fp);
    }
  }
  return fingerprints;
}

async function previewRowDuplicates(targetTable, tableSchema, columnMappings, sheets) {
  const activeMappings = (columnMappings || []).filter((m) => m && m.fileColumn && m.dbColumn);
  if (!targetTable || !tableSchema || activeMappings.length === 0) {
    return { duplicateCount: 0, matchedColumns: [], sampleMatches: [] };
  }

  const colMetaByName = new Map(tableSchema.columns.map((c) => [c.name, c]));
  const mappedRequired = activeMappings
    .map((m) => m.dbColumn)
    .filter((col) => colMetaByName.get(col)?.isRequired);

  const keyColumns = mappedRequired.length > 0 ? mappedRequired : activeMappings.map((m) => m.dbColumn);
  const existingSet = await fetchExistingRowFingerprints(targetTable, keyColumns);
  if (existingSet.size === 0) {
    return { duplicateCount: 0, matchedColumns: keyColumns, sampleMatches: [] };
  }

  const mappingByDbCol = new Map(activeMappings.map((m) => [m.dbColumn, m.fileColumn]));
  const sampleMatches = [];
  let duplicateCount = 0;

  for (const sheet of sheets) {
    const dateColMap = new Map((sheet.dateColumns || []).map((d) => [d.header, d]));

    for (const row of sheet.rows) {
      const candidate = {};
      let canCompare = true;

      for (const dbCol of keyColumns) {
        const fileCol = mappingByDbCol.get(dbCol);
        const rawVal = row.data[fileCol];
        if (isCellEmpty(rawVal)) {
          canCompare = false;
          break;
        }
        const colMeta = colMetaByName.get(dbCol);
        const dateInfo = dateColMap.get(fileCol);
        try {
          candidate[dbCol] = coerceValueForColumn(rawVal, colMeta, {
            format: dateInfo?.format || dateInfo?.suggestedFormat || 'DD-MM-YYYY',
            dayOnlyConfirmed: false
          });
        } catch (_) {
          canCompare = false;
          break;
        }
      }

      if (!canCompare) continue;

      const fp = buildRowFingerprint(candidate, keyColumns);
      if (existingSet.has(fp)) {
        duplicateCount += 1;
        if (sampleMatches.length < 10) {
          sampleMatches.push({
            sheetName: sheet.sheetName,
            rowNumber: row.rowNumber,
            matchedValues: candidate
          });
        }
      }
    }
  }

  return { duplicateCount, matchedColumns: keyColumns, sampleMatches };
}

/* ------------------------------------------------------------------ */
/* 3. Stage 2: LLM Table & Column Mapping Suggestion                  */
/* ------------------------------------------------------------------ */

async function suggestMappingWithLLM(fileName, headers, sampleRows, schemas) {
  const compactSchemas = schemas.map((t) => ({
    tableName: t.tableName,
    columns: t.columns
      .filter((c) => !c.isAutoIncrement)
      .map((c) => ({
        name: c.name,
        type: c.dataType,
        required: c.isRequired
      }))
  }));

  const systemPrompt = `You are a database schema mapping assistant.
Compare the uploaded spreadsheet headers and sample rows against ONLY the existing MySQL tables provided.
NEVER invent new tables or columns.
Return ONLY a valid JSON object matching this exact schema:
{
  "suggestedTable": "exact_table_name_or_null",
  "confidence": 0.0,
  "reason": "short explanation",
  "columnMappings": [
    { "fileColumn": "Header From File", "dbColumn": "exact_db_column_or_null", "reason": "short reason" }
  ],
  "datasetDescription": "1-2 sentence description of what this dataset contains",
  "generatedSummary": "2-3 sentence semantic summary mentioning the domain, entity types, key columns, and example topics for search discovery"
}

Rules:
- If NO existing MySQL table matches the uploaded file's domain, set "suggestedTable": null and set all "dbColumn": null.
- Every "dbColumn" must exactly match a column name in "suggestedTable" (excluding auto_increment IDs), or null if the file column should be skipped.
- Do not map two different file columns to the same dbColumn.`;

  const userPrompt = `Uploaded File: ${fileName}
File Headers: ${JSON.stringify(headers)}
Sample Rows (first ${sampleRows.length}):
${JSON.stringify(sampleRows, null, 2)}

Existing MySQL Tables:
${JSON.stringify(compactSchemas, null, 2)}

Return ONLY valid JSON:`;

  let parsed = null;
  try {
    const raw = await generateText({
      prompt: userPrompt,
      system: systemPrompt,
      temperature: 0,
      maxTokens: 700
    });
    parsed = parseJsonSafely(raw);
  } catch (err) {
    console.warn(`[SqlImport] LLM mapping call failed (${err.message}), falling back to heuristic matcher.`);
  }

  const schemaByName = new Map(schemas.map((s) => [s.tableName, s]));
  let suggestedTable =
    parsed?.suggestedTable && schemaByName.has(parsed.suggestedTable)
      ? parsed.suggestedTable
      : null;

  let mappings = [];
  if (suggestedTable && Array.isArray(parsed?.columnMappings)) {
    const validCols = new Set(
      schemaByName.get(suggestedTable).columns.filter((c) => !c.isAutoIncrement).map((c) => c.name)
    );
    const usedDbCols = new Set();

    for (const header of headers) {
      const match = parsed.columnMappings.find((m) => m && m.fileColumn === header);
      const dbCol =
        match?.dbColumn && validCols.has(match.dbColumn) && !usedDbCols.has(match.dbColumn)
          ? match.dbColumn
          : null;
      if (dbCol) usedDbCols.add(dbCol);

      mappings.push({
        fileColumn: header,
        dbColumn: dbCol,
        reason: match?.reason || (dbCol ? 'LLM matched column' : 'Unmapped / skip')
      });
    }
  } else {
    const fallback = heuristicMap(headers, schemas);
    if (!parsed) {
      suggestedTable = fallback.suggestedTable;
      mappings = fallback.columnMappings;
    } else {
      mappings = headers.map((h) => ({ fileColumn: h, dbColumn: null, reason: 'No matching table found' }));
    }
  }

  const missingRequiredColumns = [];
  if (suggestedTable) {
    const mappedSet = new Set(mappings.filter((m) => m.dbColumn).map((m) => m.dbColumn));
    for (const col of schemaByName.get(suggestedTable).columns) {
      if (col.isRequired && !mappedSet.has(col.name)) {
        missingRequiredColumns.push(col.name);
      }
    }
  }

  return {
    suggestedTable,
    confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : suggestedTable ? 0.7 : 0,
    reason:
      parsed?.reason ||
      (suggestedTable
        ? 'Matched against existing MySQL schema.'
        : 'No suitable existing MySQL table matched this file.'),
    columnMappings: mappings,
    missingRequiredColumns,
    datasetDescription: parsed?.datasetDescription || `Uploaded structured dataset from ${fileName}.`,
    generatedSummary:
      parsed?.generatedSummary ||
      `Dataset "${fileName}" containing ${headers.length} columns (${headers.join(', ')}) mapped to ${suggestedTable || 'unassigned'}.`
  };
}

function normalizeToken(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function heuristicMap(headers, schemas) {
  let bestTable = null;
  let bestScore = 0;
  let bestMappings = headers.map((h) => ({ fileColumn: h, dbColumn: null, reason: 'Unmapped' }));

  for (const schema of schemas) {
    const cols = schema.columns.filter((c) => !c.isAutoIncrement);
    const used = new Set();
    let matches = 0;

    const candidateMappings = headers.map((h) => {
      const nh = normalizeToken(h);
      const found = cols.find(
        (c) =>
          !used.has(c.name) &&
          (normalizeToken(c.name) === nh ||
            normalizeToken(c.name).includes(nh) ||
            nh.includes(normalizeToken(c.name)))
      );
      if (found) {
        used.add(found.name);
        matches += 1;
        return { fileColumn: h, dbColumn: found.name, reason: 'Header name similarity' };
      }
      return { fileColumn: h, dbColumn: null, reason: 'No column match' };
    });

    const ratio = headers.length > 0 ? matches / headers.length : 0;
    if (matches >= 2 && ratio > bestScore) {
      bestScore = ratio;
      bestTable = schema.tableName;
      bestMappings = candidateMappings;
    }
  }

  return { suggestedTable: bestTable, columnMappings: bestMappings };
}

/* ------------------------------------------------------------------ */
/* 4. Step 1 API Handler: Inspect -> Diagnose -> LLM Map              */
/* ------------------------------------------------------------------ */

async function analyzeUploadedFile(file, options = {}) {
  cleanupExpiredUploads();

  const filePath = file.path;
  const fileName = file.originalname;
  const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'csv';
  const fileHash = computeFileHash(filePath);

  // Stage 1: Deterministic Structural Inspector
  const inspection = inspectWorkbookFile(filePath, fileName);
  const nonEmptySheets = inspection.sheets.filter((s) => !s.empty);

  if (nonEmptySheets.length === 0) {
    safeUnlink(filePath);
    throw new Error('Uploaded file contains no data rows.');
  }

  const primarySheet =
    (options.sheetName && nonEmptySheets.find((s) => s.sheetName === options.sheetName)) ||
    nonEmptySheets[0];

  if (!primarySheet.headers || primarySheet.headers.length === 0) {
    safeUnlink(filePath);
    throw new Error('Could not detect valid column headers in the uploaded file.');
  }

  const schemas = await getExistingMysqlSchemas();
  if (schemas.length === 0) {
    safeUnlink(filePath);
    throw new Error('No existing MySQL tables are available for import.');
  }

  // Pick up to 5 representative non-blank sample rows for LLM context
  const richSampleRows = primarySheet.rows
    .filter((r) => primarySheet.headers.filter((h) => !isCellEmpty(r.data[h])).length >= Math.min(2, primarySheet.headers.length))
    .slice(0, 5)
    .map((r) => r.data);

  const sampleRows =
    richSampleRows.length > 0 ? richSampleRows : primarySheet.rows.slice(0, 5).map((r) => r.data);

  // File-level duplicate check
  const existingDuplicates = await querySql(
    `SELECT id, file_name, target_table, row_count, inserted_row_count, upload_status, created_at
     FROM sql_dataset_registry
     WHERE file_hash = ? AND upload_status = 'completed'
     ORDER BY created_at DESC
     LIMIT 3`,
    [fileHash]
  );

  const fileDuplicateWarning =
    existingDuplicates.length > 0
      ? {
          isDuplicate: true,
          message: `This exact file was previously uploaded to "${existingDuplicates[0].target_table}" on ${existingDuplicates[0].created_at}.`,
          previousUploads: existingDuplicates
        }
      : { isDuplicate: false, previousUploads: [] };

  // Stage 2: Lightweight LLM Semantic Mapper (receives cleaned headers & samples only)
  const suggestion = await suggestMappingWithLLM(fileName, primarySheet.headers, sampleRows, schemas);

  // Row-level duplicate preview against live MySQL target table
  const suggestedSchema = schemas.find((s) => s.tableName === suggestion.suggestedTable) || null;
  const sheetsForDupPreview = inspection.allSheetsCompatible ? nonEmptySheets : [primarySheet];
  const rowDuplicateSummary = suggestedSchema
    ? await previewRowDuplicates(
        suggestion.suggestedTable,
        suggestedSchema,
        suggestion.columnMappings,
        sheetsForDupPreview
      )
    : { duplicateCount: 0, matchedColumns: [], sampleMatches: [] };

  // Build plain-language Preflight Diagnostic Report
  const preflightReport = buildPreflightReport(inspection, {
    suggestedTable: suggestion.suggestedTable,
    missingRequiredColumns: suggestion.missingRequiredColumns,
    fileDuplicateWarning,
    rowDuplicateSummary
  });

  const totalRowsAcrossCompatible = sheetsForDupPreview.reduce((sum, s) => sum + s.rows.length, 0);

  const uploadId = crypto.randomUUID();
  stagedUploads.set(uploadId, {
    uploadId,
    filePath,
    fileName,
    fileType: ext,
    fileHash,
    sheetNames: inspection.sheetNames,
    selectedSheet: primarySheet.sheetName,
    headers: primarySheet.headers,
    rowCount: primarySheet.rows.length,
    createdAt: Date.now()
  });

  return {
    uploadId,
    fileName,
    fileType: ext,
    fileHash,
    sheetNames: inspection.sheetNames,
    selectedSheet: primarySheet.sheetName,
    compatibleSheetNames: inspection.compatibleSheetNames,
    allSheetsCompatible: inspection.allSheetsCompatible,
    rowCount: primarySheet.rows.length,
    totalRowsAcrossCompatibleSheets: totalRowsAcrossCompatible,
    headers: primarySheet.headers,
    sampleRows,
    duplicateWarning: fileDuplicateWarning,
    rowDuplicateSummary,
    preflightReport,
    suggestion,
    availableTables: schemas
  };
}

/* ------------------------------------------------------------------ */
/* 5. Row Type Coercion & Validation                                  */
/* ------------------------------------------------------------------ */

function coerceValueForColumn(rawVal, colMeta, dateOptions = {}) {
  const isEmpty = rawVal === null || rawVal === undefined || String(rawVal).trim() === '';
  if (isEmpty) {
    if (colMeta.defaultValue !== null && colMeta.defaultValue !== undefined) {
      return colMeta.defaultValue;
    }
    if (colMeta.nullable) return null;
    throw new Error(`Missing required value for "${colMeta.name}"`);
  }

  const dt = String(colMeta.dataType || '').toLowerCase();

  if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint'].includes(dt)) {
    const cleaned = String(rawVal)
      .replace(/[,_\s]/g, '')
      .replace(/^[^\d.+-]+|[^\d.]+$/g, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num) || cleaned === '') {
      throw new Error(`Invalid integer "${rawVal}" for "${colMeta.name}"`);
    }
    return Math.round(num);
  }

  if (['decimal', 'numeric', 'float', 'double'].includes(dt)) {
    const cleaned = String(rawVal)
      .replace(/[,_\s]/g, '')
      .replace(/^[^\d.+-]+|[^\d.]+$/g, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num) || cleaned === '') {
      throw new Error(`Invalid number "${rawVal}" for "${colMeta.name}"`);
    }
    return num;
  }

  if (dt === 'date') {
    const normalized = normalizeDateValue(rawVal, dateOptions);
    if (!normalized) throw new Error(`Invalid date value "${rawVal}" for "${colMeta.name}"`);
    return normalized;
  }

  if (dt === 'datetime' || dt === 'timestamp') {
    const normalized = normalizeDateValue(rawVal, dateOptions);
    if (!normalized) throw new Error(`Invalid datetime value "${rawVal}" for "${colMeta.name}"`);
    return `${normalized} 00:00:00`;
  }

  if (dt === 'boolean' || dt === 'bool') {
    const s = String(rawVal).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(s)) return 1;
    if (['0', 'false', 'no', 'n'].includes(s)) return 0;
    throw new Error(`Invalid boolean "${rawVal}" for "${colMeta.name}"`);
  }

  return String(rawVal).trim();
}

function applyConfirmedForwardFill(sheet) {
  if (!Array.isArray(sheet.verticalMerges) || sheet.verticalMerges.length === 0) return;
  for (const merge of sheet.verticalMerges) {
    for (const row of sheet.rows) {
      if (row.rowNumber > merge.startRowNumber && row.rowNumber <= merge.endRowNumber) {
        if (isCellEmpty(row.data[merge.column])) {
          row.data[merge.column] = merge.anchorValue;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. Stage 3 API Handler: Explicit Admin Confirmation & Commit       */
/* ------------------------------------------------------------------ */

async function confirmAndInsertDataset({
  uploadId,
  targetTable,
  columnMappings,
  sheetName = null,
  selectedSheets = null,
  defaultValues = {},
  confirmations = {},
  datasetDescription = '',
  generatedSummary = '',
  allowDuplicate = false,
  rowDuplicateAction = 'import', // 'skip' | 'import'
  skipInvalidRows = false,
  skipPartialRows = false,
  skipFooterRows = false,
  editedCells = [],
  skippedRowKeys = [],
  uploadedBy = null
}) {
  const staged = stagedUploads.get(uploadId);
  if (!staged) {
    throw new Error('Upload session not found or expired. Please upload the file again.');
  }

  // Re-validate targetTable & mapped columns strictly against live MySQL schema
  const schemas = await getExistingMysqlSchemas();
  const tableSchema = schemas.find((s) => s.tableName === targetTable);
  if (!tableSchema) {
    throw new Error(`Target table "${targetTable}" does not exist in MySQL.`);
  }

  if (!allowDuplicate) {
    const dup = await querySql(
      `SELECT id, created_at FROM sql_dataset_registry
       WHERE file_hash = ? AND target_table = ? AND upload_status = 'completed'
       LIMIT 1`,
      [staged.fileHash, targetTable]
    );
    if (dup.length > 0) {
      const err = new Error(
        `Duplicate upload blocked: this file was already imported into "${targetTable}" (datasetId=${dup[0].id}). Pass allowDuplicate=true to import anyway.`
      );
      err.status = 409;
      throw err;
    }
  }

  const colMetaByName = new Map(tableSchema.columns.map((c) => [c.name, c]));
  const activeMappings = (Array.isArray(columnMappings) ? columnMappings : []).filter(
    (m) => m && m.fileColumn && m.dbColumn
  );

  if (activeMappings.length === 0) {
    throw new Error('At least one valid column mapping is required.');
  }

  const usedDbCols = new Set();
  for (const m of activeMappings) {
    const col = colMetaByName.get(m.dbColumn);
    if (!col) {
      throw new Error(`Mapped column "${m.dbColumn}" does not exist in table "${targetTable}".`);
    }
    if (col.isAutoIncrement) {
      throw new Error(`Cannot map directly to auto_increment column "${m.dbColumn}".`);
    }
    if (usedDbCols.has(m.dbColumn)) {
      throw new Error(`Duplicate mapping for target column "${m.dbColumn}".`);
    }
    usedDbCols.add(m.dbColumn);
  }

  // Validate explicit admin-supplied defaultValues for unmapped columns
  const validatedDefaults = {};
  for (const [dbCol, rawDefault] of Object.entries(defaultValues || {})) {
    if (isCellEmpty(rawDefault)) continue;
    const colMeta = colMetaByName.get(dbCol);
    if (!colMeta || colMeta.isAutoIncrement) continue;
    if (!usedDbCols.has(dbCol)) {
      validatedDefaults[dbCol] = coerceValueForColumn(rawDefault, colMeta);
      usedDbCols.add(dbCol);
    }
  }

  // Ensure all required NOT NULL columns (without DB defaults) are mapped or given an explicit default
  const missingRequired = tableSchema.columns
    .filter((c) => c.isRequired && !usedDbCols.has(c.name))
    .map((c) => c.name);
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required fields for "${targetTable}": ${missingRequired.join(', ')}. Map a column or provide a default value.`
    );
  }

  // Re-inspect workbook deterministically
  const inspection = inspectWorkbookFile(staged.filePath, staged.fileName);
  const targetSheetNames =
    Array.isArray(selectedSheets) && selectedSheets.length > 0
      ? selectedSheets
      : [sheetName || staged.selectedSheet];

  const chosenSheets = inspection.sheets.filter((s) => targetSheetNames.includes(s.sheetName));
  if (chosenSheets.length === 0) {
    throw new Error(`None of the requested sheet(s) were found: ${targetSheetNames.join(', ')}`);
  }

  // Build lookup maps for admin manual edits & skipped rows (e.g. OCR rows)
  const editLookup = new Map();
  for (const edit of Array.isArray(editedCells) ? editedCells : []) {
    if (edit && edit.sheetName && edit.rowNumber && edit.column) {
      editLookup.set(`${edit.sheetName}:${edit.rowNumber}:${edit.column}`, edit.value);
    }
  }
  const skippedKeySet = new Set(Array.isArray(skippedRowKeys) ? skippedRowKeys : []);

  // Build confirmed day-only date plan per sheet (ONLY applied when explicitly confirmed)
  const dayOnlyConf = confirmations?.dayOnlyDates || {};
  const dayOnlyConfirmed = Boolean(dayOnlyConf.confirmed);
  const sheetDatePlanMap = new Map(
    (Array.isArray(dayOnlyConf.sheetDatePlan) ? dayOnlyConf.sheetDatePlan : []).map((p) => [
      p.sheetName,
      { month: Number(p.month), year: Number(p.year) }
    ])
  );
  const confirmedDateFormat = confirmations?.dateFormat || null;
  const forwardFillConfirmed = Boolean(confirmations?.forwardFillConfirmed);

  // Build final insert column order (mapped columns + admin default columns)
  const defaultDbCols = Object.keys(validatedDefaults);
  const dbCols = [...activeMappings.map((m) => m.dbColumn), ...defaultDbCols];

  // Fetch existing DB fingerprints for row-level duplicate handling
  const keyColumnsForDup = dbCols.filter((c) => colMetaByName.get(c)?.isRequired);
  const dupKeyCols = keyColumnsForDup.length > 0 ? keyColumnsForDup : dbCols;
  const existingRowFingerprints =
    rowDuplicateAction === 'skip'
      ? await fetchExistingRowFingerprints(targetTable, dupKeyCols)
      : new Set();

  const validValueRows = [];
  const validObjectRows = [];
  const validationErrors = [];
  let totalEvaluatedRows = 0;
  let skippedPartialCount = 0;
  let skippedFooterCount = 0;
  let skippedManualCount = 0;
  let skippedDuplicateCount = 0;

  for (const sheet of chosenSheets) {
    if (forwardFillConfirmed) {
      applyConfirmedForwardFill(sheet);
    }

    const dateColMap = new Map((sheet.dateColumns || []).map((d) => [d.header, d]));
    const sheetDateOverride = sheetDatePlanMap.get(sheet.sheetName) || null;

    // Include footer rows ONLY if admin did NOT confirm skipping them
    const rowsToProcess = [...sheet.rows];
    if (!skipFooterRows && sheet.footerRows.length > 0) {
      for (const f of sheet.footerRows) {
        rowsToProcess.push({ sheetName: sheet.sheetName, rowNumber: f.rowNumber, data: f.preview });
      }
    } else {
      skippedFooterCount += sheet.footerRows.length;
    }

    for (const row of rowsToProcess) {
      totalEvaluatedRows += 1;
      const rowKey = `${sheet.sheetName}:${row.rowNumber}`;

      if (skippedKeySet.has(rowKey)) {
        skippedManualCount += 1;
        continue;
      }

      // Check if row is missing any required mapped field (partial row)
      const missingRequiredInRow = activeMappings.some((m) => {
        const colMeta = colMetaByName.get(m.dbColumn);
        if (!colMeta?.isRequired) return false;
        const editKey = `${sheet.sheetName}:${row.rowNumber}:${m.fileColumn}`;
        const val = editLookup.has(editKey) ? editLookup.get(editKey) : row.data[m.fileColumn];
        return isCellEmpty(val);
      });

      if (missingRequiredInRow && (skipPartialRows || skipInvalidRows)) {
        skippedPartialCount += 1;
        continue;
      }

      try {
        const valueRow = [];
        const objRow = {};

        for (const m of activeMappings) {
          const colMeta = colMetaByName.get(m.dbColumn);
          const editKey = `${sheet.sheetName}:${row.rowNumber}:${m.fileColumn}`;
          const rawVal = editLookup.has(editKey) ? editLookup.get(editKey) : row.data[m.fileColumn];
          const detectedDate = dateColMap.get(m.fileColumn);

          const dateOptions = {
            format:
              confirmedDateFormat ||
              detectedDate?.format ||
              detectedDate?.suggestedFormat ||
              'DD-MM-YYYY',
            dayOnlyConfirmed: dayOnlyConfirmed && detectedDate?.kind === 'day_only',
            month: sheetDateOverride?.month || detectedDate?.inferredMonth || null,
            year: sheetDateOverride?.year || detectedDate?.inferredYear || null
          };

          const coerced = coerceValueForColumn(rawVal, colMeta, dateOptions);
          valueRow.push(coerced);
          objRow[m.dbColumn] = coerced;
        }

        for (const defCol of defaultDbCols) {
          valueRow.push(validatedDefaults[defCol]);
          objRow[defCol] = validatedDefaults[defCol];
        }

        // Row-level duplicate skip (when admin chooses 'skip')
        if (rowDuplicateAction === 'skip') {
          const fp = buildRowFingerprint(objRow, dupKeyCols);
          if (existingRowFingerprints.has(fp)) {
            skippedDuplicateCount += 1;
            continue;
          }
          existingRowFingerprints.add(fp);
        }

        validValueRows.push(valueRow);
        validObjectRows.push({
          sheetName: sheet.sheetName,
          rowNumber: row.rowNumber,
          data: objRow
        });
      } catch (rowErr) {
        validationErrors.push({
          sheetName: sheet.sheetName,
          rowNumber: row.rowNumber,
          error: rowErr.message
        });
      }
    }
  }

  if (validationErrors.length > 0 && !skipInvalidRows) {
    const err = new Error(
      `Validation failed on ${validationErrors.length} row(s). Review the affected rows or enable skipInvalidRows.`
    );
    err.status = 400;
    err.validationErrors = validationErrors.slice(0, 50);
    throw err;
  }

  if (validValueRows.length === 0) {
    throw new Error('No valid rows remain to insert after applying your selections.');
  }

  // Transactional bulk insert into target MySQL table + registry record
  const pool = getSqlPool();
  const conn = await pool.getConnection();
  let datasetId = null;
  const insertedRowIds = [];
  const combinedSheetLabel = chosenSheets
    .map((s) => s.sheetName)
    .join(', ')
    .slice(0, 255);

  try {
    await conn.beginTransaction();

    const escapedTable = escapeId(targetTable);
    const escapedCols = dbCols.map(escapeId).join(', ');
    const insertSql = `INSERT INTO ${escapedTable} (${escapedCols}) VALUES ?`;

    const CHUNK_SIZE = 500;
    for (let i = 0; i < validValueRows.length; i += CHUNK_SIZE) {
      const slice = validValueRows.slice(i, i + CHUNK_SIZE);
      const [result] = await conn.query(insertSql, [slice]);

      if (result.insertId && result.affectedRows > 0) {
        const startId = Number(result.insertId);
        for (let offset = 0; offset < result.affectedRows; offset++) {
          insertedRowIds.push(startId + offset);
        }
      }
    }

    const finalDescription =
      (datasetDescription || '').trim() ||
      `Structured dataset imported from ${staged.fileName} into ${targetTable}.`;
    const finalSummary =
      (generatedSummary || '').trim() ||
      `Table ${targetTable} dataset from ${staged.fileName} with ${validValueRows.length} records and columns: ${dbCols.join(', ')}.`;

    const columnsMetaPayload = {
      fileHeaders: chosenSheets[0].headers,
      mappedDbColumns: dbCols,
      defaultValuesApplied: validatedDefaults,
      selectedSheets: chosenSheets.map((s) => s.sheetName),
      primaryKey: tableSchema.primaryKey || null,
      insertedIdRange:
        insertedRowIds.length > 0
          ? { first: insertedRowIds[0], last: insertedRowIds[insertedRowIds.length - 1] }
          : null
    };

    const [regResult] = await conn.execute(
      `INSERT INTO sql_dataset_registry
        (file_name, file_hash, file_type, sheet_name, target_table, dataset_description, generated_summary,
         columns_json, column_mapping_json, row_count, inserted_row_count, upload_status, embedding_status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'pending', ?)`,
      [
        staged.fileName,
        staged.fileHash,
        staged.fileType,
        combinedSheetLabel,
        targetTable,
        finalDescription,
        finalSummary,
        JSON.stringify(columnsMetaPayload),
        JSON.stringify(activeMappings),
        totalEvaluatedRows,
        validValueRows.length,
        uploadedBy ? String(uploadedBy) : null
      ]
    );

    datasetId = Number(regResult.insertId);
    await conn.commit();
  } catch (dbErr) {
    await conn.rollback();
    throw dbErr;
  } finally {
    conn.release();
  }

  // Clean up temp upload and refresh Phase 1 SQL schema cache immediately
  safeUnlink(staged.filePath);
  stagedUploads.delete(uploadId);

  if (typeof sqlQueryTool.invalidateSqlSchemaCache === 'function') {
    sqlQueryTool.invalidateSqlSchemaCache();
  }

  const rowsForEmbedding = validObjectRows.map((entry, idx) => ({
    mysqlRowId:
      insertedRowIds[idx] !== undefined ? String(insertedRowIds[idx]) : `row_${entry.rowNumber}`,
    rowIndex: entry.rowNumber,
    data: entry.data
  }));

  setImmediate(() => {
    runDatasetEmbeddingJob({
      datasetId,
      targetTable,
      fileName: staged.fileName,
      sheetName: combinedSheetLabel,
      mappedDbColumns: dbCols,
      datasetDescription: (datasetDescription || '').trim(),
      generatedSummary: (generatedSummary || '').trim(),
      rows: rowsForEmbedding
    }).catch((err) => {
      console.error(`[SqlImport] Background embedding job failed for datasetId=${datasetId}:`, err.message);
    });
  });

  return {
    datasetId,
    targetTable,
    fileName: staged.fileName,
    sheetName: combinedSheetLabel,
    selectedSheets: chosenSheets.map((s) => s.sheetName),
    totalRows: totalEvaluatedRows,
    insertedRows: validValueRows.length,
    skippedRows: validationErrors.length + skippedPartialCount + skippedManualCount + skippedDuplicateCount,
    skippedBreakdown: {
      validationErrors: validationErrors.length,
      partialRows: skippedPartialCount,
      footerRows: skippedFooterCount,
      manualSkippedRows: skippedManualCount,
      duplicateRows: skippedDuplicateCount
    },
    validationErrors: validationErrors.slice(0, 50),
    uploadStatus: 'completed',
    embeddingStatus: 'pending'
  };
}

/* ------------------------------------------------------------------ */
/* 7. Async Background Embedding (MongoDB First -> Isolated Vectra)   */
/* ------------------------------------------------------------------ */

function serializeSqlRow(targetTable, rowObj) {
  const pairs = Object.entries(rowObj)
    .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '')
    .map(([key, val]) => `${key}: ${val}`);
  return `Table: ${targetTable} | ${pairs.join(' | ')}`;
}

function buildDatasetSummaryText({
  targetTable,
  fileName,
  mappedDbColumns,
  datasetDescription,
  generatedSummary
}) {
  return [
    `MySQL Table: ${targetTable}`,
    `Source File: ${fileName}`,
    `Columns: ${(mappedDbColumns || []).join(', ')}`,
    datasetDescription ? `Description: ${datasetDescription}` : '',
    generatedSummary ? `Summary: ${generatedSummary}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function runDatasetEmbeddingJob({
  datasetId,
  targetTable,
  fileName,
  sheetName,
  mappedDbColumns,
  datasetDescription,
  generatedSummary,
  rows
}) {
  const embeddingRef = `sql_dataset:${datasetId}`;
  console.log(
    `[SqlImport] Starting background embedding for datasetId=${datasetId} (${rows.length} rows -> ${targetTable})`
  );

  try {
    await querySql(
      `UPDATE sql_dataset_registry
       SET embedding_status = 'processing', embedding_error = NULL
       WHERE id = ?`,
      [datasetId]
    );

    const summaryText = buildDatasetSummaryText({
      targetTable,
      fileName,
      mappedDbColumns,
      datasetDescription,
      generatedSummary
    });
    const summaryVector = await generateEmbedding(summaryText);

    const summaryDoc = await SqlEmbedding.create({
      datasetId,
      recordType: 'sql_dataset_summary',
      targetTable,
      mysqlRowId: null,
      content: summaryText,
      metadata: {
        fileName,
        sheetName: sheetName || null,
        columns: mappedDbColumns || [],
        rowIndex: null
      },
      embedding: summaryVector
    });

    await sqlVectorService.addItems([summaryDoc]);

    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
      const serializedTexts = batch.map((r) => serializeSqlRow(targetTable, r.data));
      const vectors = await generateEmbeddingsBatch(serializedTexts, EMBED_BATCH_SIZE);

      const docsToInsert = [];
      for (let j = 0; j < batch.length; j++) {
        if (!Array.isArray(vectors[j]) || vectors[j].length === 0) continue;
        docsToInsert.push({
          datasetId,
          recordType: 'sql_row',
          targetTable,
          mysqlRowId: batch[j].mysqlRowId,
          content: serializedTexts[j],
          metadata: {
            fileName,
            sheetName: sheetName || null,
            columns: mappedDbColumns || [],
            rowIndex: batch[j].rowIndex
          },
          embedding: vectors[j]
        });
      }

      if (docsToInsert.length > 0) {
        const savedDocs = await SqlEmbedding.insertMany(docsToInsert);
        await sqlVectorService.addItems(savedDocs);
      }

      await yieldEventLoop();
    }

    await querySql(
      `UPDATE sql_dataset_registry
       SET embedding_status = 'completed', embedding_ref = ?, embedding_error = NULL
       WHERE id = ?`,
      [embeddingRef, datasetId]
    );

    console.log(`[SqlImport] Completed embedding for datasetId=${datasetId} (ref=${embeddingRef})`);
  } catch (err) {
    console.error(`[SqlImport] Embedding failed for datasetId=${datasetId}:`, err.message);
    await querySql(
      `UPDATE sql_dataset_registry
       SET embedding_status = 'failed', embedding_error = ?
       WHERE id = ?`,
      [String(err.message || 'Unknown embedding error').slice(0, 1000), datasetId]
    ).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* 8. Registry Queries, Startup Recovery & Idempotent Retry           */
/* ------------------------------------------------------------------ */

async function listRegistry(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return querySql(`SELECT * FROM sql_dataset_registry ORDER BY created_at DESC LIMIT ${safeLimit}`);
}

async function getRegistryById(datasetId) {
  const rows = await querySql(`SELECT * FROM sql_dataset_registry WHERE id = ? LIMIT 1`, [
    Number(datasetId)
  ]);
  return rows[0] || null;
}

async function recoverInterruptedEmbeddings() {
  try {
    const result = await querySql(
      `UPDATE sql_dataset_registry
       SET embedding_status = 'failed',
           embedding_error = 'Interrupted by server restart'
       WHERE embedding_status = 'processing'`
    );
    if (result && result.affectedRows > 0) {
      console.warn(
        `[SqlImport] Marked ${result.affectedRows} interrupted embedding job(s) as failed.`
      );
    }
  } catch (err) {
    console.warn(`[SqlImport] Startup recovery warning: ${err.message}`);
  }
}

async function retryDatasetEmbedding(datasetId) {
  const record = await getRegistryById(datasetId);
  if (!record) {
    const err = new Error(`Registry record ${datasetId} not found.`);
    err.status = 404;
    throw err;
  }

  const columnsMeta =
    typeof record.columns_json === 'string'
      ? JSON.parse(record.columns_json)
      : record.columns_json || {};

  const pk = columnsMeta.primaryKey;
  const range = columnsMeta.insertedIdRange;
  const targetTable = record.target_table;

  await SqlEmbedding.deleteMany({ datasetId: Number(datasetId) });
  await sqlVectorService.removeDatasetVectors(Number(datasetId));

  let fetchedRows = [];
  if (pk && range && range.first !== undefined && range.last !== undefined) {
    const sql = `SELECT * FROM ${escapeId(targetTable)} WHERE ${escapeId(pk)} BETWEEN ? AND ? ORDER BY ${escapeId(pk)} ASC`;
    const dbRows = await querySql(sql, [range.first, range.last]);
    fetchedRows = dbRows.map((row, idx) => ({
      mysqlRowId: String(row[pk]),
      rowIndex: idx + 1,
      data: row
    }));
  } else {
    throw new Error(
      `Cannot re-fetch rows automatically for table "${targetTable}" because no primary key range was recorded.`
    );
  }

  await querySql(
    `UPDATE sql_dataset_registry SET embedding_status = 'pending', embedding_error = NULL WHERE id = ?`,
    [Number(datasetId)]
  );

  setImmediate(() => {
    runDatasetEmbeddingJob({
      datasetId: Number(datasetId),
      targetTable,
      fileName: record.file_name,
      sheetName: record.sheet_name,
      mappedDbColumns: columnsMeta.mappedDbColumns || [],
      datasetDescription: record.dataset_description || '',
      generatedSummary: record.generated_summary || '',
      rows: fetchedRows
    }).catch((err) => {
      console.error(`[SqlImport] Retry embedding failed for datasetId=${datasetId}:`, err.message);
    });
  });

  return {
    datasetId: Number(datasetId),
    targetTable,
    rowsQueued: fetchedRows.length,
    embeddingStatus: 'pending'
  };
}

module.exports = {
  getExistingMysqlSchemas,
  analyzeUploadedFile,
  confirmAndInsertDataset,
  listRegistry,
  getRegistryById,
  recoverInterruptedEmbeddings,
  retryDatasetEmbedding
};