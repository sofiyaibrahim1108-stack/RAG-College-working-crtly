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
const ROW_DUP_SCAN_LIMIT = Number(process.env.SQL_ROW_DUP_SCAN_LIMIT) || 20000;
const TYPE_INFER_MAX_UNIQUE = Number(process.env.SQL_TYPE_INFER_MAX_UNIQUE) || 120;
// Max number of inserted row IDs stored explicitly in the registry (above this, only the numeric range is stored)
const STORE_IDS_MAX = Number(process.env.SQL_STORE_INSERTED_IDS_MAX) || 3000;
const ID_QUERY_CHUNK = 500;
const EXCLUDED_TABLES = new Set(
  (process.env.SQL_EXCLUDED_TABLES || 'sql_dataset_registry')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
);

const NON_LABEL_COLUMN_NAME =
  /^(?:s\.?\s*no|sl\.?|serial(?:\s*no)?|sr\.?\s*no|index|id|date|day)$/i;

const SERIAL_INDEX_HEADER =
  /^(?:s\.?\s*no\.?|sl\.?(?:\s*no\.?)?|sr\.?(?:\s*no\.?)?|serial(?:\s*no\.?)?|row(?:\s*no\.?)?|index|#)$/i;

const EXPLICIT_DATE_STRING_PATTERN =
  /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[a-zA-Z]{3,9}(?:,?\s+\d{2,4})?|[a-zA-Z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?)$/;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

// mysql2 returns DATE columns as local-midnight JS Dates. toISOString() converts to UTC and can
// shift the calendar day back by one (e.g. IST). Always format from LOCAL parts instead.
function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatLocalDateTime(d) {
  const h = d.getHours();
  const mi = d.getMinutes();
  const s = d.getSeconds();
  const date = formatLocalDate(d);
  return h || mi || s ? `${date} ${pad2(h)}:${pad2(mi)}:${pad2(s)}` : date;
}

function normalizeFingerprintValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return formatLocalDate(val);
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
        const canPreviewDayOnly = Boolean(
          dateInfo?.kind === 'day_only' && dateInfo?.inferredMonth && dateInfo?.inferredYear
        );
        try {
          candidate[dbCol] = coerceValueForColumn(rawVal, colMeta, {
            format: dateInfo?.format || dateInfo?.suggestedFormat || 'DD-MM-YYYY',
            dayOnlyConfirmed: canPreviewDayOnly,
            month: dateInfo?.inferredMonth || null,
            year: dateInfo?.inferredYear || null
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
/* 3. Stage 2: LLM + Heuristic Table & Column Mapping + AI Type Infer */
/* ------------------------------------------------------------------ */

function normalizeToken(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRealDateSampleValue(val) {
  if (val instanceof Date && !Number.isNaN(val.getTime())) return true;
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return false;
  if (EXPLICIT_DATE_STRING_PATTERN.test(s)) return true;
  try {
    return Boolean(normalizeDateValue(s, { dayOnlyConfirmed: false }));
  } catch (_) {
    return false;
  }
}

function isNumericSampleValue(val) {
  if (typeof val === 'number') return Number.isFinite(val);
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (!s || isRealDateSampleValue(s)) return false;
  const cleaned = s
    .replace(/[,_\s]/g, '')
    .replace(/^[^\d.+-]+|[^\d.]+$/g, '');
  return cleaned !== '' && Number.isFinite(Number(cleaned));
}

function isColumnMappingValueCompatible(header, dbColMeta, sampleRows = [], detectedDateHeaders = new Set()) {
  if (!dbColMeta) return false;

  const hTrim = String(header || '').trim();
  const hLower = hTrim.toLowerCase();
  const dt = String(dbColMeta.dataType || '').toLowerCase();
  const isDetectedDate = detectedDateHeaders.has(header);

  const vals = (sampleRows || [])
    .map((r) => r?.[header])
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');

  if (['date', 'datetime', 'timestamp'].includes(dt)) {
    if (SERIAL_INDEX_HEADER.test(hTrim) && !isDetectedDate) {
      return false;
    }
    if (isDetectedDate) return true;
    const headerLooksLikeDate =
      hLower.includes('date') ||
      hLower.includes('dob') ||
      (hLower.includes('day') && !hLower.includes('order') && !hLower.includes('working') && !hLower.includes('name'));
    if (vals.length === 0) return headerLooksLikeDate;
    if (vals.some(isRealDateSampleValue)) return true;
    return headerLooksLikeDate;
  }

  if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint', 'decimal', 'numeric', 'float', 'double'].includes(dt)) {
    if (isDetectedDate && vals.some(isRealDateSampleValue)) return false;
    if (vals.length > 0 && !vals.some(isNumericSampleValue)) return false;
  }

  return true;
}

function inferColumnRoleFromSamples(header, sampleRows = [], detectedDateHeaders = new Set()) {
  const hTrim = String(header || '').trim();
  const h = hTrim.toLowerCase();

  if (SERIAL_INDEX_HEADER.test(hTrim) && !detectedDateHeaders.has(header)) {
    return 'serial_index';
  }

  if (
    detectedDateHeaders.has(header) ||
    h.includes('date') ||
    (h.includes('day') && !h.includes('order') && !h.includes('working') && !h.includes('name'))
  ) {
    return 'date';
  }

  const vals = (sampleRows || [])
    .map((r) => r?.[header])
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (vals.length > 0 && vals.every(isRealDateSampleValue)) {
    return 'date';
  }

  if (
    h.includes('particular') ||
    h.includes('event') ||
    h.includes('title') ||
    h.includes('name') ||
    h.includes('subject') ||
    h.includes('activity') ||
    h.includes('program') ||
    h.includes('occasion')
  ) {
    return 'text_label';
  }
  return 'other';
}

function findUnmappedCategoryColumn(tableSchema, mappedDbColsSet) {
  if (!tableSchema || !Array.isArray(tableSchema.columns)) return null;
  return (
    tableSchema.columns.find((c) => {
      if (c.isAutoIncrement || c.isPrimaryKey || mappedDbColsSet.has(c.name)) return false;
      const dt = String(c.dataType || '').toLowerCase();
      if (!['varchar', 'char', 'text', 'enum'].includes(dt)) return false;
      return /(?:^|_)(?:type|category|kind|class|status|tag|group)$/i.test(String(c.name || ''));
    }) || null
  );
}

function findMappedLabelFileColumns(columnMappings, sheets = [], sampleRows = []) {
  const active = (columnMappings || []).filter((m) => m && m.fileColumn && m.dbColumn);
  const eligible = active.filter(
    (m) =>
      !NON_LABEL_COLUMN_NAME.test(String(m.fileColumn || '').trim()) &&
      !NON_LABEL_COLUMN_NAME.test(String(m.dbColumn || '').trim())
  );

  const labelMatches = eligible
    .filter((m) => {
      const dbLower = String(m.dbColumn || '').toLowerCase();
      const fileLower = String(m.fileColumn || '').toLowerCase();
      const role = inferColumnRoleFromSamples(m.fileColumn, sampleRows);
      return (
        role === 'text_label' ||
        /(?:title|event|name|particular|subject|summary|label|desc)/i.test(dbLower) ||
        /(?:title|event|name|particular|subject|summary|label|desc)/i.test(fileLower)
      );
    })
    .map((m) => m.fileColumn);

  if (labelMatches.length > 0) return Array.from(new Set(labelMatches));

  const fallbackCols = [];
  for (const m of eligible) {
    const vals = [];
    for (const sheet of sheets) {
      for (const row of sheet.rows || []) {
        const v = row?.data?.[m.fileColumn];
        if (!isCellEmpty(v)) vals.push(String(v).trim());
        if (vals.length >= 10) break;
      }
      if (vals.length >= 10) break;
    }
    const looksLikeText = vals.some((v) => /[a-zA-Z]{2,}/.test(v) && !isRealDateSampleValue(v));
    if (looksLikeText) fallbackCols.push(m.fileColumn);
  }
  return Array.from(new Set(fallbackCols));
}

function collectUniqueLabelValues(sheets = [], labelFileColumns = []) {
  const unique = [];
  const seen = new Set();

  for (const sheet of sheets) {
    for (const row of sheet.rows || []) {
      const pieces = [];
      for (const col of labelFileColumns) {
        const raw = row?.data?.[col];
        if (!isCellEmpty(raw)) {
          pieces.push(String(raw).trim());
        }
      }
      const combined = pieces.join(' - ').trim();
      if (!combined) continue;
      const key = combined.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(combined);
        if (unique.length >= TYPE_INFER_MAX_UNIQUE) {
          return unique;
        }
      }
    }
  }

  return unique;
}

async function inferTypesWithLLM({
  fileName,
  targetTable,
  categoryColMeta,
  uniqueLabels,
  existingValues = []
}) {
  const inferredByLabel = {};
  if (!categoryColMeta || !Array.isArray(uniqueLabels) || uniqueLabels.length === 0) {
    return inferredByLabel;
  }

  const systemPrompt = `You classify item titles/labels into concise category values for a database column.
Return ONLY a valid JSON object of the exact form:
{
  "classifications": {
    "<exact label from input>": "<concise category label>"
  }
}

Rules:
- Use ONLY the provided labels as keys; do not invent or alter keys.
- Assign each label a clear, concise category name that accurately reflects what the label is (for example: Holiday, Exam, Festival, Event, PTA, Meeting, or a category consistent with existing column values if provided).
- If a label is ambiguous or cannot be classified reliably, set its value to null rather than guessing.`;

  const existingHint =
    Array.isArray(existingValues) && existingValues.length > 0
      ? `Existing values seen in ${categoryColMeta.name}: ${JSON.stringify(existingValues)}\n`
      : '';

  const userPrompt = `File: ${fileName}
Target Table: ${targetTable}
Target Category Column: ${categoryColMeta.name} (${categoryColMeta.columnType || categoryColMeta.dataType})
${existingHint}Labels to classify:
${JSON.stringify(uniqueLabels, null, 2)}

Return ONLY valid JSON:`;

  try {
    const raw = await generateText({
      prompt: userPrompt,
      system: systemPrompt,
      temperature: 0,
      maxTokens: 900
    });
    const parsed = parseJsonSafely(raw);
    const mapObj =
      parsed?.classifications && typeof parsed.classifications === 'object'
        ? parsed.classifications
        : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : null;

    if (!mapObj) return inferredByLabel;

    for (const label of uniqueLabels) {
      const rawCat = Object.prototype.hasOwnProperty.call(mapObj, label)
        ? mapObj[label]
        : mapObj[label.toLowerCase()];
      if (typeof rawCat === 'string' && rawCat.trim() !== '') {
        inferredByLabel[label] = rawCat.trim();
      }
    }
  } catch (err) {
    console.warn(`[SqlImport] AI type classification skipped (${err.message})`);
  }

  return inferredByLabel;
}

function heuristicMap(headers, sampleRows, schemas, detectedDateHeaders = new Set()) {
  let bestTable = null;
  let bestScore = 0;
  let bestMappings = headers.map((h) => ({ fileColumn: h, dbColumn: null, reason: 'Unmapped' }));

  for (const schema of schemas) {
    const cols = schema.columns.filter((c) => !c.isAutoIncrement);
    const used = new Set();
    let score = 0;
    let matches = 0;

    const candidateMappings = headers.map((h) => {
      const nh = normalizeToken(h);
      const role = inferColumnRoleFromSamples(h, sampleRows, detectedDateHeaders);

      if (role === 'serial_index') {
        return { fileColumn: h, dbColumn: null, reason: 'Row index / serial column skipped' };
      }

      let found = cols.find(
        (c) =>
          !used.has(c.name) &&
          isColumnMappingValueCompatible(h, c, sampleRows, detectedDateHeaders) &&
          (normalizeToken(c.name) === nh ||
            (nh.length >= 3 && normalizeToken(c.name).includes(nh)) ||
            (normalizeToken(c.name).length >= 3 && nh.includes(normalizeToken(c.name))))
      );

      if (!found && role === 'date') {
        found = cols.find(
          (c) =>
            !used.has(c.name) &&
            ['date', 'datetime', 'timestamp'].includes(String(c.dataType || '').toLowerCase()) &&
            isColumnMappingValueCompatible(h, c, sampleRows, detectedDateHeaders)
        );
      }

      if (!found && role === 'text_label') {
        const textCols = cols.filter(
          (c) =>
            !used.has(c.name) &&
            ['varchar', 'char', 'text'].includes(String(c.dataType || '').toLowerCase()) &&
            isColumnMappingValueCompatible(h, c, sampleRows, detectedDateHeaders)
        );
        found =
          textCols.find((c) => c.isRequired) ||
          textCols.find((c) =>
            /(?:title|event|name|particular|subject|summary|label|activity|program|occasion)/i.test(
              String(c.name || '')
            )
          ) ||
          null;
      }

      if (found) {
        used.add(found.name);
        matches += 1;
        score += found.isRequired ? 2 : 1;
        return { fileColumn: h, dbColumn: found.name, reason: 'Matched schema & sample type' };
      }
      return { fileColumn: h, dbColumn: null, reason: 'No column match' };
    });

    if (matches >= 1 && score > bestScore) {
      bestScore = score;
      bestTable = schema.tableName;
      bestMappings = candidateMappings;
    }
  }

  return { suggestedTable: bestTable, columnMappings: bestMappings };
}

async function suggestMappingWithLLM(
  fileName,
  headers,
  sampleRows,
  schemas,
  sheets = [],
  detectedDateHeaders = new Set()
) {
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
- Match by semantic meaning of both headers AND sample row values (e.g. dates, schedules, programs, or entries map to matching date and title/label columns even when header names differ).
- Only set "suggestedTable": null if NO existing table has any semantic overlap with the data.
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
  const heuristicFallback = heuristicMap(headers, sampleRows, schemas, detectedDateHeaders);

  let suggestedTable =
    parsed?.suggestedTable && schemaByName.has(parsed.suggestedTable)
      ? parsed.suggestedTable
      : heuristicFallback.suggestedTable;

  let mappings = [];
  if (suggestedTable && Array.isArray(parsed?.columnMappings) && parsed.suggestedTable === suggestedTable) {
    const tableSchema = schemaByName.get(suggestedTable);
    const colMetaByName = new Map(
      tableSchema.columns.filter((c) => !c.isAutoIncrement).map((c) => [c.name, c])
    );
    const heuristicByHeader = new Map(
      heuristicFallback.columnMappings.map((m) => [m.fileColumn, m.dbColumn])
    );
    const llmByHeader = new Map();
    for (const m of parsed.columnMappings) {
      if (!m || !m.fileColumn) continue;
      llmByHeader.set(m.fileColumn, m);
      llmByHeader.set(String(m.fileColumn).trim().toLowerCase(), m);
    }

    const usedDbCols = new Set();
    const resolvedByHeader = new Map();

    // Pass 1: Honor valid, type-compatible LLM mappings first and respect explicit LLM null skips
    for (const header of headers) {
      const match =
        llmByHeader.get(header) || llmByHeader.get(String(header).trim().toLowerCase()) || null;

      if (!match) continue;

      if (match.dbColumn === null || match.dbColumn === undefined || match.dbColumn === '') {
        resolvedByHeader.set(header, {
          fileColumn: header,
          dbColumn: null,
          reason: match.reason || 'Unmapped / optional column',
          explicitNull: true
        });
        continue;
      }

      const colMeta = colMetaByName.get(match.dbColumn);
      if (
        colMeta &&
        !usedDbCols.has(match.dbColumn) &&
        isColumnMappingValueCompatible(header, colMeta, sampleRows, detectedDateHeaders)
      ) {
        usedDbCols.add(match.dbColumn);
        resolvedByHeader.set(header, {
          fileColumn: header,
          dbColumn: match.dbColumn,
          reason: match.reason || 'Matched schema & sample values',
          explicitNull: false
        });
      } else {
        resolvedByHeader.set(header, {
          fileColumn: header,
          dbColumn: null,
          reason: 'Skipped incompatible or duplicate column suggestion',
          explicitNull: false
        });
      }
    }

    // Pass 2: Fill headers omitted by the LLM using compatible heuristic matches
    for (const header of headers) {
      if (resolvedByHeader.has(header)) continue;
      const hCol = heuristicByHeader.get(header);
      const colMeta = hCol ? colMetaByName.get(hCol) : null;
      if (
        colMeta &&
        !usedDbCols.has(hCol) &&
        isColumnMappingValueCompatible(header, colMeta, sampleRows, detectedDateHeaders)
      ) {
        usedDbCols.add(hCol);
        resolvedByHeader.set(header, {
          fileColumn: header,
          dbColumn: hCol,
          reason: 'Matched schema & sample values',
          explicitNull: false
        });
      } else {
        resolvedByHeader.set(header, {
          fileColumn: header,
          dbColumn: null,
          reason: 'Unmapped / optional column',
          explicitNull: false
        });
      }
    }

    // Pass 3: Rescue any still-unmapped required DB column from compatible unmapped headers
    const unmappedRequiredCols = new Set(
      tableSchema.columns
        .filter((c) => c.isRequired && !c.isAutoIncrement && !usedDbCols.has(c.name))
        .map((c) => c.name)
    );
    if (unmappedRequiredCols.size > 0) {
      for (const header of headers) {
        const entry = resolvedByHeader.get(header);
        if (!entry || entry.dbColumn) continue;
        const hCol = heuristicByHeader.get(header);
        if (!hCol || !unmappedRequiredCols.has(hCol) || usedDbCols.has(hCol)) continue;
        const colMeta = colMetaByName.get(hCol);
        if (colMeta && isColumnMappingValueCompatible(header, colMeta, sampleRows, detectedDateHeaders)) {
          usedDbCols.add(hCol);
          unmappedRequiredCols.delete(hCol);
          resolvedByHeader.set(header, {
            fileColumn: header,
            dbColumn: hCol,
            reason: 'Matched required schema column from header & sample values',
            explicitNull: false
          });
        }
      }
    }

    mappings = headers.map((header) => {
      const entry = resolvedByHeader.get(header);
      return {
        fileColumn: header,
        dbColumn: entry?.dbColumn || null,
        reason: entry?.reason || 'Unmapped / optional column'
      };
    });
  } else if (suggestedTable && heuristicFallback.suggestedTable === suggestedTable) {
    mappings = heuristicFallback.columnMappings;
  } else {
    mappings = headers.map((h) => ({ fileColumn: h, dbColumn: null, reason: 'No matching table found' }));
  }

  const missingRequiredColumns = [];
  let inferredTypeSuggestions = null;

  if (suggestedTable) {
    const schemaObj = schemaByName.get(suggestedTable);
    const mappedSet = new Set(mappings.filter((m) => m.dbColumn).map((m) => m.dbColumn));
    for (const col of schemaObj.columns) {
      if (col.isRequired && !mappedSet.has(col.name)) {
        missingRequiredColumns.push(col.name);
      }
    }

    const unmappedCatCol = findUnmappedCategoryColumn(schemaObj, mappedSet);
    const labelFileCols = findMappedLabelFileColumns(mappings, sheets, sampleRows);
    const uniqueLabels = collectUniqueLabelValues(sheets, labelFileCols);

    if (unmappedCatCol && uniqueLabels.length > 0) {
      let existingVals = [];
      try {
        const distinctRows = await querySql(
          `SELECT DISTINCT ${escapeId(unmappedCatCol.name)} AS val
           FROM ${escapeId(suggestedTable)}
           WHERE ${escapeId(unmappedCatCol.name)} IS NOT NULL AND ${escapeId(unmappedCatCol.name)} <> ''
           LIMIT 25`
        );
        existingVals = (distinctRows || []).map((r) => String(r.val || '').trim()).filter(Boolean);
      } catch (_) {
        existingVals = [];
      }

      const inferredByLabel = await inferTypesWithLLM({
        fileName,
        targetTable: suggestedTable,
        categoryColMeta: unmappedCatCol,
        uniqueLabels,
        existingValues: existingVals
      });

      inferredTypeSuggestions = {
        targetColumn: unmappedCatCol.name,
        labelColumns: labelFileCols,
        inferredByLabel
      };
    }
  }

  return {
    suggestedTable,
    confidence:
      typeof parsed?.confidence === 'number' && parsed.confidence > 0
        ? parsed.confidence
        : suggestedTable
          ? 0.65
          : 0,
    reason:
      parsed?.reason ||
      (suggestedTable
        ? 'Matched against existing MySQL schema and sample data.'
        : 'No suitable existing MySQL table matched this file.'),
    columnMappings: mappings,
    missingRequiredColumns,
    inferredTypeSuggestions,
    datasetDescription: parsed?.datasetDescription || `Uploaded structured dataset from ${fileName}.`,
    generatedSummary:
      parsed?.generatedSummary ||
      `Dataset "${fileName}" containing ${headers.length} columns (${headers.join(', ')}) mapped to ${suggestedTable || 'unassigned'}.`
  };
}

/* ------------------------------------------------------------------ */
/* 4. Step 1 API Handler: Inspect -> Diagnose -> Map                  */
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

  // Pick up to 5 representative non-blank sample rows for mapping context
  const richSampleRows = primarySheet.rows
    .filter(
      (r) =>
        primarySheet.headers.filter((h) => !isCellEmpty(r.data[h])).length >=
        Math.min(2, primarySheet.headers.length)
    )
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

  const sheetsForDupPreview = inspection.allSheetsCompatible ? nonEmptySheets : [primarySheet];
  const detectedDateHeaders = new Set(
    (primarySheet.dateColumns || []).map((d) => d.header).filter(Boolean)
  );

  // Stage 2: Semantic + Heuristic Schema Mapper + AI Category Inference
  const suggestion = await suggestMappingWithLLM(
    fileName,
    primarySheet.headers,
    sampleRows,
    schemas,
    sheetsForDupPreview,
    detectedDateHeaders
  );

  // Row-level duplicate preview against live MySQL target table
  const suggestedSchema = schemas.find((s) => s.tableName === suggestion.suggestedTable) || null;
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
    inferredTypeSuggestions: suggestion.inferredTypeSuggestions || null,
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
  rowDuplicateAction = 'skip', // 'skip' (safe default) | 'import'
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

  // Optional AI category inference for an unmapped category/type column when no explicit default was forced
  const aiTypeEnabled = confirmations?.aiTypeInference !== false;
  const unmappedCatCol = aiTypeEnabled ? findUnmappedCategoryColumn(tableSchema, usedDbCols) : null;
  let inferredTypeByLabel = {};
  let labelFileColsForRows = [];

  if (unmappedCatCol) {
    labelFileColsForRows = findMappedLabelFileColumns(activeMappings, chosenSheets, []);
    const stagedMap =
      staged.inferredTypeSuggestions?.targetColumn === unmappedCatCol.name
        ? staged.inferredTypeSuggestions.inferredByLabel || {}
        : {};
    const uniqueLabels = collectUniqueLabelValues(chosenSheets, labelFileColsForRows);
    const missingLabels = uniqueLabels.filter(
      (lbl) => !Object.prototype.hasOwnProperty.call(stagedMap, lbl)
    );

    inferredTypeByLabel = { ...stagedMap };
    if (missingLabels.length > 0) {
      let existingVals = [];
      try {
        const distinctRows = await querySql(
          `SELECT DISTINCT ${escapeId(unmappedCatCol.name)} AS val
           FROM ${escapeId(targetTable)}
           WHERE ${escapeId(unmappedCatCol.name)} IS NOT NULL AND ${escapeId(unmappedCatCol.name)} <> ''
           LIMIT 25`
        );
        existingVals = (distinctRows || []).map((r) => String(r.val || '').trim()).filter(Boolean);
      } catch (_) {
        existingVals = [];
      }

      const freshMap = await inferTypesWithLLM({
        fileName: staged.fileName,
        targetTable,
        categoryColMeta: unmappedCatCol,
        uniqueLabels: missingLabels,
        existingValues: existingVals
      });
      Object.assign(inferredTypeByLabel, freshMap);
    }

    if (Object.keys(inferredTypeByLabel).length > 0) {
      usedDbCols.add(unmappedCatCol.name);
    }
  }

  // Ensure all required NOT NULL columns (without DB defaults) are mapped or satisfied
  const missingRequired = tableSchema.columns
    .filter((c) => c.isRequired && !usedDbCols.has(c.name))
    .map((c) => c.name);
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required fields for "${targetTable}": ${missingRequired.join(', ')}. Map a column or provide a default value.`
    );
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

  // Build final insert column order (mapped columns + admin default columns + inferred category column)
  const defaultDbCols = Object.keys(validatedDefaults);
  const inferredDbCols =
    unmappedCatCol && Object.keys(inferredTypeByLabel).length > 0 && !usedDbCols.has(unmappedCatCol.name)
      ? [unmappedCatCol.name]
      : unmappedCatCol && Object.keys(inferredTypeByLabel).length > 0 && !defaultDbCols.includes(unmappedCatCol.name)
        ? [unmappedCatCol.name]
        : [];
  const dbCols = [...activeMappings.map((m) => m.dbColumn), ...defaultDbCols, ...inferredDbCols];

  // Fetch existing DB fingerprints for row-level duplicate handling (safe default: 'skip')
  const effectiveDupAction = rowDuplicateAction === 'import' ? 'import' : 'skip';
  const keyColumnsForDup = dbCols.filter((c) => colMetaByName.get(c)?.isRequired);
  const dupKeyCols = keyColumnsForDup.length > 0 ? keyColumnsForDup : dbCols;
  const existingRowFingerprints =
    effectiveDupAction === 'skip'
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

        for (const infCol of inferredDbCols) {
          const labelKey = labelFileColsForRows
            .map((col) => {
              const editKey = `${sheet.sheetName}:${row.rowNumber}:${col}`;
              const val = editLookup.has(editKey) ? editLookup.get(editKey) : row.data[col];
              return isCellEmpty(val) ? '' : String(val).trim();
            })
            .filter(Boolean)
            .join(' - ')
            .trim();

          const inferredRaw = labelKey ? inferredTypeByLabel[labelKey] : null;
          const coercedInf = coerceValueForColumn(inferredRaw, colMetaByName.get(infCol));
          valueRow.push(coercedInf);
          objRow[infCol] = coercedInf;
        }

        // Row-level duplicate skip (default safe behavior — prevents duplicate rows & vectors)
        if (effectiveDupAction === 'skip') {
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

  const combinedSheetLabel = chosenSheets
    .map((s) => s.sheetName)
    .join(', ')
    .slice(0, 255);

  // Clean no-op result if every valid row already existed in MySQL
  if (validValueRows.length === 0 && skippedDuplicateCount > 0 && validationErrors.length === 0) {
    safeUnlink(staged.filePath);
    stagedUploads.delete(uploadId);

    return {
      datasetId: null,
      targetTable,
      fileName: staged.fileName,
      sheetName: combinedSheetLabel,
      selectedSheets: chosenSheets.map((s) => s.sheetName),
      totalRows: totalEvaluatedRows,
      insertedRows: 0,
      skippedRows: skippedPartialCount + skippedManualCount + skippedDuplicateCount,
      skippedBreakdown: {
        validationErrors: 0,
        partialRows: skippedPartialCount,
        footerRows: skippedFooterCount,
        manualSkippedRows: skippedManualCount,
        duplicateRows: skippedDuplicateCount
      },
      validationErrors: [],
      uploadStatus: 'skipped_duplicates',
      embeddingStatus: 'skipped',
      message: `All ${skippedDuplicateCount} valid row(s) already exist in "${targetTable}". No duplicate rows or vectors were created.`
    };
  }

  if (validValueRows.length === 0) {
    throw new Error('No valid rows remain to insert after applying your selections.');
  }

  // Transactional bulk insert into target MySQL table + registry record
  const pool = getSqlPool();
  const conn = await pool.getConnection();
  let datasetId = null;

  // One slot per inserted row (aligned with validObjectRows). A slot stays null only when the
  // table has no usable primary key we can resolve (then vectors cannot be live-verified).
  const insertedRowIds = new Array(validValueRows.length).fill(null);
  const pkName = tableSchema.primaryKey || null;
  const pkMeta = pkName ? colMetaByName.get(pkName) : null;
  const pkIsAutoIncrement = Boolean(pkMeta && pkMeta.isAutoIncrement);
  const pkIsInsertedColumn = Boolean(pkName && dbCols.includes(pkName));

  try {
    await conn.beginTransaction();

    // Auto-increment step can be > 1 (e.g. replicated setups); IDs are startId + k * step
    let autoIncStep = 1;
    if (pkIsAutoIncrement) {
      try {
        const [incRows] = await conn.query('SELECT @@auto_increment_increment AS inc');
        autoIncStep = Number(incRows && incRows[0] && incRows[0].inc) || 1;
      } catch (_) {
        autoIncStep = 1;
      }
    }

    const escapedTable = escapeId(targetTable);
    const escapedCols = dbCols.map(escapeId).join(', ');
    const insertSql = `INSERT INTO ${escapedTable} (${escapedCols}) VALUES ?`;

    const CHUNK_SIZE = 500;
    for (let i = 0; i < validValueRows.length; i += CHUNK_SIZE) {
      const slice = validValueRows.slice(i, i + CHUNK_SIZE);
      const [result] = await conn.query(insertSql, [slice]);

      if (Number(result.affectedRows) !== slice.length) {
        throw new Error(
          `Insert mismatch for "${targetTable}": expected ${slice.length} rows, MySQL reported ${result.affectedRows}.`
        );
      }

      const startId = Number(result.insertId) || 0;
      for (let k = 0; k < slice.length; k++) {
        const pos = i + k;
        if (pkIsInsertedColumn) {
          const v = validObjectRows[pos].data[pkName];
          insertedRowIds[pos] = v === null || v === undefined ? null : String(v);
        } else if (pkIsAutoIncrement && startId > 0) {
          insertedRowIds[pos] = String(startId + k * autoIncStep);
        }
      }
    }

    const finalDescription =
      (datasetDescription || '').trim() ||
      `Structured dataset imported from ${staged.fileName} into ${targetTable}.`;
    const finalSummary =
      (generatedSummary || '').trim() ||
      `Table ${targetTable} dataset from ${staged.fileName} with ${validValueRows.length} records and columns: ${dbCols.join(', ')}.`;

    const allIdsResolved = insertedRowIds.every((v) => v !== null);
    const numericIds = insertedRowIds
      .filter((v) => v !== null && /^\d+$/.test(v))
      .map((v) => Number(v));
    const rangeIsSafe = allIdsResolved && numericIds.length === insertedRowIds.length;

    const columnsMetaPayload = {
      fileHeaders: chosenSheets[0].headers,
      mappedDbColumns: dbCols,
      defaultValuesApplied: validatedDefaults,
      inferredCategoryColumn: inferredDbCols[0] || null,
      selectedSheets: chosenSheets.map((s) => s.sheetName),
      primaryKey: tableSchema.primaryKey || null,
      // Exact IDs (preferred for retry/delete); capped to keep the registry row small
      insertedIds: allIdsResolved && insertedRowIds.length <= STORE_IDS_MAX ? insertedRowIds : null,
      insertedIdRange: rangeIsSafe
        ? { first: Math.min(...numericIds), last: Math.max(...numericIds) }
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

  const unresolvedIdCount = insertedRowIds.filter((v) => v === null).length;
  if (unresolvedIdCount > 0) {
    console.warn(
      `[SqlImport] datasetId=${datasetId}: ${unresolvedIdCount} row(s) in "${targetTable}" have no resolvable primary key; their vectors cannot be live-verified at query time.`
    );
  }

  const rowsForEmbedding = validObjectRows.map((entry, idx) => ({
    mysqlRowId: insertedRowIds[idx] !== null ? insertedRowIds[idx] : `row_${entry.rowNumber}`,
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

function formatEmbeddingCell(val) {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return formatLocalDateTime(val);
  }
  return val;
}

function serializeSqlRow(targetTable, rowObj) {
  const pairs = Object.entries(rowObj)
    .map(([key, val]) => [key, formatEmbeddingCell(val)])
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

async function embedBatchWithRetry(texts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await generateEmbeddingsBatch(texts, EMBED_BATCH_SIZE);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw lastErr;
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

    let embeddedCount = 0;

    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
      const serializedTexts = batch.map((r) => serializeSqlRow(targetTable, r.data));
      const vectors = await embedBatchWithRetry(serializedTexts);

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
        embeddedCount += docsToInsert.length;
      }

      await yieldEventLoop();
    }

    // Do not report success when some rows silently got no vector
    if (embeddedCount < rows.length) {
      const msg = `Only ${embeddedCount} of ${rows.length} row(s) were embedded. Use retry to rebuild all vectors.`;
      console.warn(`[SqlImport] datasetId=${datasetId}: ${msg}`);
      await querySql(
        `UPDATE sql_dataset_registry
         SET embedding_status = 'failed', embedding_ref = ?, embedding_error = ?
         WHERE id = ?`,
        [embeddingRef, msg.slice(0, 1000), datasetId]
      );
      return;
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
/* 8. Registry Queries, Startup Recovery, Retry & Safe Delete         */
/* ------------------------------------------------------------------ */

function parseColumnsMeta(record) {
  if (!record) return {};
  try {
    return typeof record.columns_json === 'string'
      ? JSON.parse(record.columns_json)
      : record.columns_json || {};
  } catch (_) {
    return {};
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Re-fetch exactly the rows that belong to a dataset: explicit IDs first, numeric range as fallback
async function fetchDatasetRows(targetTable, columnsMeta) {
  const pk = columnsMeta.primaryKey;
  const ids = columnsMeta.insertedIds;
  const range = columnsMeta.insertedIdRange;

  if (pk && Array.isArray(ids) && ids.length > 0) {
    const rows = [];
    for (const chunk of chunkArray(ids, ID_QUERY_CHUNK)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const part = await querySql(
        `SELECT * FROM ${escapeId(targetTable)} WHERE ${escapeId(pk)} IN (${placeholders})`,
        chunk
      );
      rows.push(...part);
    }
    return rows;
  }

  if (pk && range && range.first !== undefined && range.last !== undefined) {
    return querySql(
      `SELECT * FROM ${escapeId(targetTable)} WHERE ${escapeId(pk)} BETWEEN ? AND ? ORDER BY ${escapeId(pk)} ASC`,
      [range.first, range.last]
    );
  }

  throw new Error(
    `Cannot re-fetch rows automatically for table "${targetTable}" because no inserted row IDs were recorded.`
  );
}

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
    // 'pending' jobs are also lost on restart (they only live in setImmediate)
    const result = await querySql(
      `UPDATE sql_dataset_registry
       SET embedding_status = 'failed',
           embedding_error = 'Interrupted by server restart'
       WHERE embedding_status IN ('processing', 'pending')`
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

  const columnsMeta = parseColumnsMeta(record);
  const pk = columnsMeta.primaryKey;
  const targetTable = record.target_table;
  const mappedCols = Array.isArray(columnsMeta.mappedDbColumns) ? columnsMeta.mappedDbColumns : [];

  const dbRows = await fetchDatasetRows(targetTable, columnsMeta);

  // Keep the embedded text identical to the original import (only imported columns, no PK/audit columns)
  const fetchedRows = dbRows.map((row, idx) => {
    const data = {};
    const cols = mappedCols.length > 0 ? mappedCols : Object.keys(row);
    for (const col of cols) {
      if (Object.prototype.hasOwnProperty.call(row, col)) data[col] = row[col];
    }
    return {
      mysqlRowId: String(row[pk]),
      rowIndex: idx + 1,
      data
    };
  });

  await SqlEmbedding.deleteMany({ datasetId: Number(datasetId) });
  await sqlVectorService.removeDatasetVectors(Number(datasetId));

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
      mappedDbColumns: mappedCols,
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

async function deleteDataset(datasetId) {
  const id = Number(datasetId);
  const record = await getRegistryById(id);
  if (!record) {
    const err = new Error(`Registry record ${id} not found.`);
    err.status = 404;
    throw err;
  }

  const columnsMeta = parseColumnsMeta(record);
  const pk = columnsMeta.primaryKey;
  const ids = columnsMeta.insertedIds;
  const range = columnsMeta.insertedIdRange;
  const targetTable = record.target_table;
  let deletedMysqlRows = 0;

  const pool = getSqlPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (pk && Array.isArray(ids) && ids.length > 0) {
      for (const chunk of chunkArray(ids, ID_QUERY_CHUNK)) {
        const placeholders = chunk.map(() => '?').join(', ');
        const [delRes] = await conn.execute(
          `DELETE FROM ${escapeId(targetTable)} WHERE ${escapeId(pk)} IN (${placeholders})`,
          chunk
        );
        deletedMysqlRows += Number(delRes.affectedRows) || 0;
      }
    } else if (pk && range && range.first !== undefined && range.last !== undefined) {
      const [delRes] = await conn.execute(
        `DELETE FROM ${escapeId(targetTable)} WHERE ${escapeId(pk)} BETWEEN ? AND ?`,
        [range.first, range.last]
      );
      deletedMysqlRows = Number(delRes.affectedRows) || 0;
    }

    await conn.execute(`DELETE FROM sql_dataset_registry WHERE id = ?`, [id]);
    await conn.commit();
  } catch (dbErr) {
    await conn.rollback();
    throw dbErr;
  } finally {
    conn.release();
  }

  const mongoRes = await SqlEmbedding.deleteMany({ datasetId: id });
  const removedVectors = await sqlVectorService.removeDatasetVectors(id);

  if (typeof sqlQueryTool.invalidateSqlSchemaCache === 'function') {
    sqlQueryTool.invalidateSqlSchemaCache();
  }

  return {
    datasetId: id,
    targetTable,
    deletedMysqlRows,
    deletedMongoEmbeddings: Number(mongoRes.deletedCount) || 0,
    removedVectors
  };
}

module.exports = {
  getExistingMysqlSchemas,
  analyzeUploadedFile,
  confirmAndInsertDataset,
  listRegistry,
  getRegistryById,
  recoverInterruptedEmbeddings,
  retryDatasetEmbedding,
  deleteDataset
};