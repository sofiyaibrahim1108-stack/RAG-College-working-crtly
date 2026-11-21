const { querySql, getSqlPool, isSqlConnected } = require('../config/sql.db');
const { MYSQL_DATABASE } = require('../config/env');
const { generateText } = require('./llm.service');

const intEnv = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

const posIntEnv = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const floatEnv = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

const SCHEMA_CACHE_TTL_MS = posIntEnv('SQL_SCHEMA_CACHE_TTL_MS', 60000);
const SAMPLE_ROWS_LIMIT = posIntEnv('SQL_SAMPLE_ROWS_LIMIT', 2);
const SAMPLE_CELL_MAX_CHARS = posIntEnv('SQL_SAMPLE_CELL_MAX_CHARS', 120);
const CATEGORY_COL_MAX_LEN = posIntEnv('SQL_CATEGORY_COL_MAX_LEN', 100);
const CATEGORY_MAX_DISTINCT = posIntEnv('SQL_CATEGORY_MAX_DISTINCT', 20);
const CATEGORY_VAL_MAX_CHARS = posIntEnv('SQL_CATEGORY_VAL_MAX_CHARS', 32);
const MAX_TABLES_IN_PROMPT = posIntEnv('SQL_MAX_TABLES_IN_PROMPT', 4);
const MAX_RESULT_ROWS = posIntEnv('SQL_MAX_RESULT_ROWS', 50);
const LLM_SYNTHESIS_MAX_ROWS = intEnv('SQL_LLM_SYNTHESIS_MAX_ROWS', 4);
const SQL_QUERY_TIMEOUT_MS = posIntEnv('SQL_QUERY_TIMEOUT_MS', 8000);
const SQL_LLM_TIMEOUT_MS = posIntEnv('SQL_LLM_TIMEOUT_MS', 90000);
const SQL_GEN_TEMPERATURE = floatEnv('SQL_GEN_TEMPERATURE', 0);
const SQL_GEN_MAX_TOKENS = posIntEnv('SQL_GEN_MAX_TOKENS', 300);
const ANSWER_GEN_TEMPERATURE = floatEnv('SQL_ANSWER_TEMPERATURE', 0.1);
const ANSWER_GEN_MAX_TOKENS = posIntEnv('SQL_ANSWER_MAX_TOKENS', 400);

const BLOCKED_SQL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|INTO|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|LOAD_FILE)\b/i;

const BLOCKED_SYSTEM_SCHEMAS = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys'
]);

const FORBIDDEN_ANYWHERE = /(;|--|\/\*|\*\/|#)/;

const CATEGORICAL_DATA_TYPES = new Set(['varchar', 'char', 'enum']);

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'from', 'with', 'about', 'into', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
  'should', 'may', 'might', 'this', 'that', 'these', 'those', 'there', 'their',
  'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how', 'all', 'any',
  'some', 'many', 'much', 'more', 'most', 'each', 'every', 'between', 'after',
  'before', 'during', 'list', 'show', 'give', 'tell', 'find', 'get', 'please',
  'according', 'available', 'scheduled'
]);

const MUTATION_INTENT_START =
  /^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(delete|remove|drop|truncate|update|insert|alter|erase|wipe|clear|destroy|modify|overwrite)\b/i;

const MUTATION_INTENT_TARGET =
  /\b(delete|remove|drop|truncate|update|insert|alter|erase|wipe|clear|destroy|overwrite)\b[\s\S]{0,60}\b(from|into|table|records?|rows?|entries|database|db|column|schema)\b/i;

let schemaCache = { tables: null, loadedAt: 0 };
let inFlightSchemaPromise = null;

function safeIsSqlConnected() {
  try {
    return typeof isSqlConnected === 'function' ? Boolean(isSqlConnected()) : false;
  } catch (_) {
    return false;
  }
}

function escapeBacktickId(identifier) {
  return `\`${String(identifier || '').replace(/`/g, '``')}\``;
}

function invalidateSqlSchemaCache() {
  schemaCache = { tables: null, loadedAt: 0 };
  inFlightSchemaPromise = null;
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function getTokenVariants(token) {
  const variants = new Set([token]);
  if (token.length > 4 && token.endsWith('ies')) {
    variants.add(`${token.slice(0, -3)}y`);
  }
  if (token.length > 3 && token.endsWith('es')) {
    variants.add(token.slice(0, -2));
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    variants.add(token.slice(0, -1));
  }
  return Array.from(variants);
}

function tokenizeMeaningful(text) {
  const raw = String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return Array.from(new Set(raw));
}

function identifierParts(name) {
  const parts = String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !STOP_WORDS.has(p));

  const expanded = new Set();
  for (const p of parts) {
    for (const v of getTokenVariants(p)) {
      expanded.add(v);
    }
  }
  return expanded;
}

function isReadOnlyMutationRequest(question) {
  const q = String(question || '').trim();
  if (!q) return false;
  return MUTATION_INTENT_START.test(q) || MUTATION_INTENT_TARGET.test(q);
}

function sanitizeSampleRow(row) {
  if (!row || typeof row !== 'object') return row;
  const clean = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && v.length > SAMPLE_CELL_MAX_CHARS) {
      clean[k] = `${v.slice(0, SAMPLE_CELL_MAX_CHARS)}...`;
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

async function fetchSchemaFromDb() {
  if (!MYSQL_DATABASE) return [];
  const pool = getSqlPool();
  if (!pool) return [];

  const rows = await querySql(
    `SELECT TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType,
            COLUMN_KEY AS columnKey,
            CHARACTER_MAXIMUM_LENGTH AS maxLength
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [MYSQL_DATABASE],
    SQL_QUERY_TIMEOUT_MS
  );

  if (!Array.isArray(rows) || rows.length === 0) return [];

  const grouped = new Map();
  for (const r of rows) {
    const tName = r.tableName;
    if (!grouped.has(tName)) {
      grouped.set(tName, {
        tableName: tName,
        columns: [],
        sampleRows: [],
        categoricalValues: {}
      });
    }
    grouped.get(tName).columns.push({
      name: r.columnName,
      type: r.dataType,
      key: r.columnKey || '',
      maxLength: Number(r.maxLength) || 0
    });
  }

  for (const tableInfo of grouped.values()) {
    const quotedTable = escapeBacktickId(tableInfo.tableName);

    try {
      const sampleRows = await querySql(
        `SELECT * FROM ${quotedTable} LIMIT ${SAMPLE_ROWS_LIMIT}`,
        [],
        SQL_QUERY_TIMEOUT_MS
      );
      tableInfo.sampleRows = Array.isArray(sampleRows) ? sampleRows.map(sanitizeSampleRow) : [];
    } catch (_) {
      tableInfo.sampleRows = [];
    }

    // Dynamically discover low-cardinality categorical column values (no hardcoded column names)
    for (const col of tableInfo.columns) {
      const dt = String(col.type || '').toLowerCase();
      if (!CATEGORICAL_DATA_TYPES.has(dt)) continue;
      if (dt !== 'enum' && col.maxLength > CATEGORY_COL_MAX_LEN) continue;

      try {
        const quotedCol = escapeBacktickId(col.name);
        const distinctRows = await querySql(
          `SELECT DISTINCT ${quotedCol} AS val
           FROM ${quotedTable}
           WHERE ${quotedCol} IS NOT NULL AND ${quotedCol} <> ''
           LIMIT ${CATEGORY_MAX_DISTINCT + 1}`,
          [],
          SQL_QUERY_TIMEOUT_MS
        );

        if (
          Array.isArray(distinctRows) &&
          distinctRows.length > 0 &&
          distinctRows.length <= CATEGORY_MAX_DISTINCT
        ) {
          const vals = distinctRows
            .map((r) => String(r.val || '').trim())
            .filter(Boolean);

          const allCompact = vals.every((v) => v.length <= CATEGORY_VAL_MAX_CHARS);
          if (allCompact && vals.length > 0) {
            tableInfo.categoricalValues[col.name] = vals;
          }
        }
      } catch (_) {
        // Ignore individual column introspection errors
      }
    }
  }

  return Array.from(grouped.values());
}

/**
 * Fetches MySQL tables, columns, data types, compact sample rows, and dynamic
 * low-cardinality categorical values with TTL caching and request deduplication.
 */
async function getMySqlSchema(forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    schemaCache.tables &&
    schemaCache.tables.length > 0 &&
    now - schemaCache.loadedAt < SCHEMA_CACHE_TTL_MS
  ) {
    return schemaCache.tables;
  }

  if (inFlightSchemaPromise) {
    return inFlightSchemaPromise;
  }

  inFlightSchemaPromise = (async () => {
    try {
      const tables = await fetchSchemaFromDb();
      if (tables.length > 0) {
        schemaCache = { tables, loadedAt: Date.now() };
      }
      return tables;
    } catch (err) {
      console.warn('[SqlQueryTool] Schema fetch warning:', err.message);
      return [];
    } finally {
      inFlightSchemaPromise = null;
    }
  })();

  return inFlightSchemaPromise;
}

/**
 * Ranks tables strictly against table names, column names, and discovered
 * low-cardinality categorical values (never raw free-text sample descriptions).
 */
function rankTablesForQuery(tables, queryText = '') {
  const tokens = tokenizeMeaningful(queryText);
  if (tokens.length === 0) {
    return tables.map((t) => ({ table: t, score: 0, matchedWords: [] }));
  }

  return tables
    .map((t) => {
      const tableParts = identifierParts(t.tableName);
      const colParts = new Set();
      for (const c of t.columns) {
        for (const p of identifierParts(c.name)) colParts.add(p);
      }

      const categoryParts = new Set();
      for (const vals of Object.values(t.categoricalValues || {})) {
        for (const v of vals) {
          for (const p of identifierParts(v)) categoryParts.add(p);
        }
      }

      let score = 0;
      const matchedWords = [];

      for (const tok of tokens) {
        const variants = getTokenVariants(tok);
        let hit = false;

        if (variants.some((v) => tableParts.has(v))) {
          score += 3;
          hit = true;
        }
        if (variants.some((v) => colParts.has(v))) {
          score += 2;
          hit = true;
        }
        if (variants.some((v) => categoryParts.has(v))) {
          score += 2;
          hit = true;
        }
        if (hit) matchedWords.push(tok);
      }

      return { table: t, score, matchedWords };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Returns hints only for MySQL tables whose schema or categorical values
 * match the query, preventing unrelated PDF/DOC questions from entering SQL.
 */
async function getSqlTableHints(queryText = '') {
  try {
    const tables = await getMySqlSchema();
    if (!tables || tables.length === 0) return [];

    const ranked = rankTablesForQuery(tables, queryText);
    const matching = ranked.filter((item) => item.score >= 2);

    return matching.map((item) => ({
      name: item.table.tableName,
      table: item.table.tableName,
      sourceType: 'mysql',
      columns: item.table.columns.map((c) => c.name),
      matchedWords: item.matchedWords
    }));
  } catch (err) {
    console.warn('[SqlQueryTool] Failed to build SQL table hints:', err.message);
    return [];
  }
}

function sanitizeSqlOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText
    .replace(/```sql/gi, '')
    .replace(/```/g, '')
    .trim();

  const cteOrSelectIdx = cleaned.search(/\b(?:WITH|SELECT)\b/i);
  if (cteOrSelectIdx !== -1) {
    cleaned = cleaned.slice(cteOrSelectIdx).trim();
  }

  cleaned = cleaned.replace(/;+\s*$/g, '').trim();
  return cleaned;
}

function stripStringLiterals(sql) {
  return sql.replace(/'(?:''|\\'|[^'])*'/g, "''").replace(/"(?:""|\\"|[^"])*"/g, '""');
}

function extractCteNames(withoutStrings) {
  const cteNames = new Set();
  const cteRegex = /\b(?:WITH|,)\s*`?([a-zA-Z0-9_]+)`?\s*(?:\([^)]*\))?\s+AS\s*\(/gi;
  for (const m of withoutStrings.matchAll(cteRegex)) {
    const name = String(m[1] || '').trim().toLowerCase();
    if (name) cteNames.add(name);
  }
  return cteNames;
}

function extractReferencedTables(sql) {
  const withoutStrings = stripStringLiterals(sql);
  const cteNames = extractCteNames(withoutStrings);
  const refs = [];

  const clauseRegex =
    /\b(?:FROM|JOIN)\s+((?:`[^`]+`|[a-zA-Z0-9_]+)(?:\s*\.\s*(?:`[^`]+`|[a-zA-Z0-9_]+))?)/gi;
  for (const m of withoutStrings.matchAll(clauseRegex)) {
    const rawRef = m[1].replace(/`/g, '').trim();
    const parts = rawRef.split('.').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      refs.push({ schema: parts[0].toLowerCase(), table: parts[1].toLowerCase(), isCte: false });
    } else if (parts.length === 1) {
      const tbl = parts[0].toLowerCase();
      refs.push({ schema: null, table: tbl, isCte: cteNames.has(tbl) });
    }
  }

  return refs;
}

function assertReadOnlySelect(sql, allowedTables = []) {
  if (!sql || typeof sql !== 'string') {
    throw new Error('Generated SQL is empty');
  }

  const withoutStrings = stripStringLiterals(sql);

  if (FORBIDDEN_ANYWHERE.test(withoutStrings)) {
    throw new Error('Disallowed SQL characters, comments, or statement terminators detected');
  }

  if (!/^\s*(?:SELECT|WITH)\b/i.test(withoutStrings)) {
    throw new Error('Only read-only SELECT statements are permitted');
  }

  if (BLOCKED_SQL_KEYWORDS.test(withoutStrings)) {
    throw new Error('Mutating or restricted SQL keyword detected');
  }

  if (/\bUNION\b/i.test(withoutStrings)) {
    throw new Error('UNION queries are not permitted');
  }

  const allowedSet = new Set(allowedTables.map((t) => String(t).toLowerCase()));
  const refs = extractReferencedTables(sql);

  if (refs.length === 0) {
    throw new Error('SELECT statement must reference at least one table');
  }

  const actualTables = [];
  for (const ref of refs) {
    if (
      ref.schema &&
      (BLOCKED_SYSTEM_SCHEMAS.has(ref.schema) ||
        ref.schema !== String(MYSQL_DATABASE || '').toLowerCase())
    ) {
      throw new Error(`Access to schema "${ref.schema}" is not permitted`);
    }
    if (BLOCKED_SYSTEM_SCHEMAS.has(ref.table)) {
      throw new Error(`Table "${ref.table}" is not in the allowed schema`);
    }
    if (!ref.isCte) {
      if (allowedSet.size > 0 && !allowedSet.has(ref.table)) {
        throw new Error(`Table "${ref.table}" is not in the allowed schema`);
      }
      actualTables.push(ref.table);
    }
  }

  if (actualTables.length === 0) {
    throw new Error('SELECT statement must reference at least one base database table');
  }

  return Array.from(new Set(actualTables));
}

function enforceDatabaseRowLimit(sql, maxRows = MAX_RESULT_ROWS) {
  const safeLimit = Math.max(1, parseInt(maxRows, 10) || 50);
  return `SELECT * FROM (${sql}) AS _sql_tool_subq LIMIT ${safeLimit}`;
}

function humanizeColumnName(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatRowsForPrompt(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '[]';
  return JSON.stringify(rows.slice(0, MAX_RESULT_ROWS));
}

function formatRowsDeterministically(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'No matching records were found in the database.';
  }

  const capped = rows.slice(0, MAX_RESULT_ROWS);
  const lines = capped.map((row) => {
    const entries = Object.entries(row || {}).filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim() !== ''
    );
    const formattedFields = entries.map(([k, v]) => `**${humanizeColumnName(k)}:** ${v}`);
    return `- ${formattedFields.join(' | ')}`;
  });

  return `Found ${capped.length} matching record${capped.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`;
}

/**
 * Database Query Tool:
 * Blocks mutation intents, selects relevant tables using live schema + categorical
 * metadata, generates a read-only SELECT query, executes with a DB row limit and
 * timeout, cites only used tables, and formats answers fast without clogging Ollama.
 */
async function executeSqlQuery(question, _scope = null) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    return {
      status: 'no_data',
      answer: 'Please provide a question to query the database.',
      sources: []
    };
  }

  if (isReadOnlyMutationRequest(cleanQuestion)) {
    return {
      status: 'ok',
      sql: '',
      rowCount: 0,
      answer:
        'This database assistant operates in read-only mode and cannot delete, insert, update, or modify database records.',
      sources: []
    };
  }

  try {
    const allTables = await getMySqlSchema();
    if (!allTables || allTables.length === 0) {
      return {
        status: 'no_data',
        answer: 'No tables are available in the database.',
        sources: []
      };
    }

    const ranked = rankTablesForQuery(allTables, cleanQuestion);
    const matching = ranked.filter((item) => item.score > 0);
    const selectedTables = (matching.length > 0 ? matching : ranked)
      .slice(0, MAX_TABLES_IN_PROMPT)
      .map((item) => item.table);

    const allowedTableNames = allTables.map((t) => t.tableName);
    const schemaDescription = selectedTables
      .map((t) => {
        const cols = t.columns.map((c) => `${escapeBacktickId(c.name)} (${c.type})`).join(', ');
        const catEntries = Object.entries(t.categoricalValues || {});
        const categoriesText =
          catEntries.length > 0
            ? `\nDistinct categorical values: ${catEntries
                .map(([colName, vals]) => `${escapeBacktickId(colName)}=${JSON.stringify(vals)}`)
                .join('; ')}`
            : '';
        const samples =
          t.sampleRows && t.sampleRows.length > 0
            ? `\nSample rows: ${JSON.stringify(t.sampleRows)}`
            : '';
        return `Table ${escapeBacktickId(t.tableName)}: [${cols}]${categoriesText}${samples}`;
      })
      .join('\n\n');

    const sqlSystemPrompt = `You generate one read-only MySQL SELECT query for the provided database schema and user question.
Rules:
1. Output ONLY a single valid MySQL SELECT query. No markdown, no code fences, no explanations, no trailing semicolons.
2. Use ONLY table names, column names, and data types from the provided schema.
3. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, UNION, INTO, or comments.
4. Match exact categorical values shown in Distinct categorical values when filtering categorical columns.
5. Select clear, user-relevant columns and avoid unnecessary internal surrogate ID or audit timestamp columns unless explicitly requested. Give clear column aliases to aggregate expressions.`;

    const sqlUserPrompt = `Database Schema:\n${schemaDescription}\n\nUser Question: ${cleanQuestion}\n\nSQL:`;

    const rawSql = await withTimeout(
      generateText({
        prompt: sqlUserPrompt,
        system: sqlSystemPrompt,
        temperature: SQL_GEN_TEMPERATURE,
        maxTokens: SQL_GEN_MAX_TOKENS
      }),
      SQL_LLM_TIMEOUT_MS,
      'SQL generation'
    );

    const sql = sanitizeSqlOutput(rawSql);

    let usedTableNamesLower = [];
    try {
      usedTableNamesLower = assertReadOnlySelect(sql, allowedTableNames);
    } catch (guardErr) {
      console.warn('[SqlQueryTool] Blocked unsafe/invalid SQL:', guardErr.message);
      return {
        status: 'failed',
        answer: 'Unable to construct a valid read-only database query for this request.',
        sources: []
      };
    }

    const boundedSql = enforceDatabaseRowLimit(sql, MAX_RESULT_ROWS);
    let rows = [];
    try {
      rows = await querySql(boundedSql, [], SQL_QUERY_TIMEOUT_MS);
    } catch (dbErr) {
      console.error('[SqlQueryTool] MySQL query execution error:', dbErr.message);
      return {
        status: 'failed',
        answer: 'An error occurred while executing the database query.',
        sources: []
      };
    }

    const rowList = Array.isArray(rows) ? rows : [];
    let finalAnswer = '';

    if (rowList.length === 0) {
      finalAnswer = 'No matching records were found in the database.';
    } else if (LLM_SYNTHESIS_MAX_ROWS > 0 && rowList.length <= LLM_SYNTHESIS_MAX_ROWS) {
      const formattedData = formatRowsForPrompt(rowList);
      const answerPrompt = `User Question: ${cleanQuestion}
Query Results (JSON):
${formattedData}

Rules:
- Answer strictly from the Query Results above.
- Do not invent or assume facts not present in the results.
- Be clear, accurate, and concise.`;

      try {
        finalAnswer = await withTimeout(
          generateText({
            prompt: answerPrompt,
            system: 'You answer strictly from the provided database query results without adding external facts.',
            temperature: ANSWER_GEN_TEMPERATURE,
            maxTokens: ANSWER_GEN_MAX_TOKENS
          }),
          SQL_LLM_TIMEOUT_MS,
          'SQL answer synthesis'
        );
      } catch (synthErr) {
        console.warn('[SqlQueryTool] Answer synthesis fallback:', synthErr.message);
        finalAnswer = formatRowsDeterministically(rowList);
      }
    } else {
      // Multi-row result: format directly without an extra LLM pass to keep latency low
      finalAnswer = formatRowsDeterministically(rowList);
    }

    const usedSet = new Set(usedTableNamesLower);
    const actualTablesUsed = allowedTableNames.filter((tName) =>
      usedSet.has(String(tName).toLowerCase())
    );

    const sources = actualTablesUsed.map((tableName, idx) => ({
      type: 'sql',
      source: 'mysql',
      sourceType: 'MySQL',
      tableName,
      citationIndex: idx + 1,
      citationMarker: `[${idx + 1}]`,
      label: `${MYSQL_DATABASE}.${tableName}`,
      snippet: `Rows returned: ${rowList.length}`
    }));

    return {
      status: 'ok',
      sql,
      rowCount: rowList.length,
      answer: finalAnswer || formatRowsDeterministically(rowList),
      sources
    };
  } catch (err) {
    console.error('[SqlQueryTool] Unexpected error:', err.message);
    return {
      status: 'failed',
      answer: 'Unable to complete the database query right now.',
      sources: [],
      connected: safeIsSqlConnected()
    };
  }
}

module.exports = {
  getMySqlSchema,
  invalidateSqlSchemaCache,
  getSqlTableHints,
  isReadOnlyMutationRequest,
  sanitizeSqlOutput,
  assertReadOnlySelect,
  enforceDatabaseRowLimit,
  formatRowsDeterministically,
  executeSqlQuery
};