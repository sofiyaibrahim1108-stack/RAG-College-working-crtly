const { querySql, getSqlPool, isSqlConnected } = require('../config/sql.db');
const { MYSQL_DATABASE } = require('../config/env');
const { generateText } = require('./llm.service');
const { generateEmbedding } = require('./embedding.service');
const SqlEmbedding = require('../models/SqlEmbedding');
const sqlVectorService = require('./sql-vector.service');

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
const SEMANTIC_SUMMARY_MIN_SCORE = floatEnv('SQL_SEMANTIC_SUMMARY_MIN_SCORE', 0.45);
const SEMANTIC_ROW_MIN_SCORE = floatEnv('SQL_SEMANTIC_ROW_MIN_SCORE', 0.50);
const SEMANTIC_ROW_FALLBACK_MIN_SCORE = floatEnv('SQL_SEMANTIC_ROW_FALLBACK_MIN_SCORE', 0.55);
const SEMANTIC_ROW_TOP_K = posIntEnv('SQL_SEMANTIC_ROW_TOP_K', 6);
const SEMANTIC_ROW_PROMPT_HINTS = posIntEnv('SQL_SEMANTIC_ROW_PROMPT_HINTS', 3);

const EXCLUDED_TABLES = new Set(
  (process.env.SQL_EXCLUDED_TABLES || 'sql_dataset_registry')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
);

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
    if (EXCLUDED_TABLES.has(String(tName || '').toLowerCase())) continue;

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

    // Dynamically discover low-cardinality categorical column values
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
 * Ranks tables against table names, column names, and discovered categorical values.
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
 * Retrieves both summary-level and row-level semantic matches from the isolated
 * SQL vector index and hydrates row content from MongoDB SqlEmbedding.
 */
async function retrieveSemanticSqlContext(queryText) {
  const cleanQuery = String(queryText || '').trim();
  if (!cleanQuery) {
    return { summaryHits: [], rowHits: [], hydratedRows: [] };
  }

  try {
    const stats = await sqlVectorService.getStats();
    if (!stats || stats.vectorCount === 0) {
      return { summaryHits: [], rowHits: [], hydratedRows: [] };
    }

    const queryVector = await generateEmbedding(cleanQuery);

    const [summaryHits, rowHits] = await Promise.all([
      stats.summaryCount > 0
        ? sqlVectorService.searchSummaries(queryVector, 5, SEMANTIC_SUMMARY_MIN_SCORE)
        : Promise.resolve([]),
      stats.rowCount > 0
        ? sqlVectorService.searchRows(queryVector, null, SEMANTIC_ROW_TOP_K, SEMANTIC_ROW_MIN_SCORE)
        : Promise.resolve([])
    ]);

    let hydratedRows = [];
    if (rowHits.length > 0) {
      const embeddingIds = rowHits.map((h) => h.embeddingId).filter(Boolean);
      if (embeddingIds.length > 0) {
        const docs = await SqlEmbedding.find({ _id: { $in: embeddingIds } })
          .select('_id datasetId targetTable mysqlRowId content metadata')
          .lean();

        const docById = new Map(docs.map((d) => [String(d._id), d]));
        hydratedRows = rowHits
          .map((hit) => {
            const doc = docById.get(String(hit.embeddingId));
            if (!doc || !doc.content) return null;
            return {
              embeddingId: String(doc._id),
              datasetId: doc.datasetId,
              targetTable: doc.targetTable,
              mysqlRowId: doc.mysqlRowId || null,
              score: hit.score,
              content: doc.content,
              metadata: doc.metadata || {}
            };
          })
          .filter(Boolean);
      }
    }

    return { summaryHits, rowHits, hydratedRows };
  } catch (err) {
    console.warn('[SqlQueryTool] Semantic SQL retrieval warning:', err.message);
    return { summaryHits: [], rowHits: [], hydratedRows: [] };
  }
}

/**
 * Selects the most relevant tables by merging lexical schema scores with
 * dataset-summary and row-level semantic scores (prevents semantic tables from
 * being dropped by an incidental lexical word match on another table).
 */
function selectCandidateTables(allTables, queryText, semanticCtx) {
  const lexicalRanked = rankTablesForQuery(allTables, queryText);
  const summaryScoreByTable = new Map();
  const rowScoreByTable = new Map();

  for (const hit of semanticCtx.summaryHits || []) {
    const prev = summaryScoreByTable.get(hit.targetTable) || 0;
    if (hit.score > prev) summaryScoreByTable.set(hit.targetTable, hit.score);
  }

  for (const hit of semanticCtx.rowHits || []) {
    const prev = rowScoreByTable.get(hit.targetTable) || 0;
    if (hit.score > prev) rowScoreByTable.set(hit.targetTable, hit.score);
  }

  const combined = lexicalRanked.map((item) => {
    const tName = item.table.tableName;
    const summaryScore = summaryScoreByTable.get(tName) || 0;
    const rowScore = rowScoreByTable.get(tName) || 0;
    const semanticBoost = summaryScore * 4 + rowScore * 6;
    return {
      table: item.table,
      lexicalScore: item.score,
      summaryScore,
      rowScore,
      totalScore: item.score + semanticBoost,
      matchedWords: item.matchedWords
    };
  });

  combined.sort((a, b) => b.totalScore - a.totalScore);

  const relevant = combined.filter((c) => c.totalScore > 0);
  const chosen = relevant.length > 0 ? relevant : combined;
  return chosen.slice(0, MAX_TABLES_IN_PROMPT);
}

/**
 * Returns hints for MySQL tables matching lexical schema/categorical values,
 * dataset-summary embeddings, or row-level SQL embeddings.
 */
async function getSqlTableHints(queryText = '') {
  try {
    const tables = await getMySqlSchema();
    if (!tables || tables.length === 0) return [];

    const tableByName = new Map(tables.map((t) => [t.tableName, t]));
    const ranked = rankTablesForQuery(tables, queryText);
    const matching = ranked.filter((item) => item.score >= 2);

    const hintMap = new Map();
    for (const item of matching) {
      hintMap.set(item.table.tableName, {
        name: item.table.tableName,
        table: item.table.tableName,
        sourceType: 'mysql',
        columns: item.table.columns.map((c) => c.name),
        matchedWords: item.matchedWords
      });
    }

    const cleanQuery = String(queryText || '').trim();
    if (cleanQuery.length > 0) {
      try {
        const sqlVecStats = await sqlVectorService.getStats();
        if (sqlVecStats.vectorCount > 0) {
          const queryVector = await generateEmbedding(cleanQuery);
          const [summaryHits, rowHits] = await Promise.all([
            sqlVecStats.summaryCount > 0
              ? sqlVectorService.searchSummaries(queryVector, 5, SEMANTIC_SUMMARY_MIN_SCORE)
              : Promise.resolve([]),
            sqlVecStats.rowCount > 0
              ? sqlVectorService.searchRows(queryVector, null, 5, SEMANTIC_ROW_FALLBACK_MIN_SCORE)
              : Promise.resolve([])
          ]);

          for (const hit of [...summaryHits, ...rowHits]) {
            const liveTable = tableByName.get(hit.targetTable);
            if (!liveTable) continue;

            if (hintMap.has(hit.targetTable)) {
              const prev = hintMap.get(hit.targetTable).semanticScore || 0;
              hintMap.get(hit.targetTable).semanticScore = Math.max(prev, hit.score);
            } else {
              hintMap.set(hit.targetTable, {
                name: liveTable.tableName,
                table: liveTable.tableName,
                sourceType: 'mysql',
                columns: liveTable.columns.map((c) => c.name),
                matchedWords: [],
                semanticScore: hit.score
              });
            }
          }
        }
      } catch (semErr) {
        console.warn('[SqlQueryTool] Semantic table hint skipped:', semErr.message);
      }
    }

    return Array.from(hintMap.values());
  } catch (err) {
    console.warn('[SqlQueryTool] Failed to build SQL table hints:', err.message);
    return [];
  }
}

function sanitizeSqlOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  const fenceMatch = rawText.match(/```(?:sql|mysql)?\s*([\s\S]*?)```/i);
  let cleaned = (fenceMatch ? fenceMatch[1] : rawText).trim();

  // Match a real SQL CTE ("WITH name AS (") or SELECT — avoids matching English "with"
  const cteMatch = cleaned.match(/\bWITH\s+`?[a-zA-Z0-9_]+`?\s*(?:\([^)]*\))?\s+AS\s*\(/i);
  const selectIdx = cleaned.search(/\bSELECT\b/i);

  if (cteMatch && (selectIdx === -1 || cteMatch.index < selectIdx)) {
    cleaned = cleaned.slice(cteMatch.index).trim();
  } else if (selectIdx !== -1) {
    cleaned = cleaned.slice(selectIdx).trim();
  }

  cleaned = cleaned.split(/;\s*(?:\n|$)/)[0].trim();
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
 * Fallback that answers directly from semantically matched SQL row embeddings
 * whenever SQL generation/execution fails or returns 0 rows (e.g. synonyms or
 * alternate user phrasing). Returns null if the matched rows do not answer the question.
 */
async function trySemanticSqlRowFallback(cleanQuestion, hydratedRows) {
  const strongRows = (hydratedRows || []).filter(
    (r) => r.score >= SEMANTIC_ROW_FALLBACK_MIN_SCORE && r.content
  );
  if (strongRows.length === 0) return null;

  const contextBlock = strongRows
    .map((r, i) => `[${i + 1}] (score ${r.score.toFixed(2)}) ${r.content}`)
    .join('\n');

  const prompt = `User Question: ${cleanQuestion}

Retrieved Database Rows:
${contextBlock}

Rules:
- Answer strictly and concisely using ONLY the Retrieved Database Rows above.
- If the rows do NOT contain the answer to the User Question, reply with exactly: NO_MATCH
- Never invent or assume facts not present in the rows.`;

  try {
    const answer = await withTimeout(
      generateText({
        prompt,
        system:
          'You answer strictly from retrieved structured database rows. If the rows do not answer the question, output exactly NO_MATCH.',
        temperature: ANSWER_GEN_TEMPERATURE,
        maxTokens: ANSWER_GEN_MAX_TOKENS
      }),
      SQL_LLM_TIMEOUT_MS,
      'SQL semantic row fallback'
    );

    const trimmed = String(answer || '').trim();
    if (!trimmed || /^NO_MATCH\b/i.test(trimmed)) {
      return null;
    }

    const usedTables = Array.from(new Set(strongRows.map((r) => r.targetTable).filter(Boolean)));
    const sources = usedTables.map((tableName, idx) => ({
      type: 'sql',
      source: 'mysql',
      sourceType: 'MySQL (Semantic Row Match)',
      tableName,
      citationIndex: idx + 1,
      citationMarker: `[${idx + 1}]`,
      label: `${MYSQL_DATABASE}.${tableName}`,
      snippet: `Matched ${strongRows.length} embedded row(s)`
    }));

    console.log(
      `[SqlQueryTool] Answered via SQL row embeddings fallback (${strongRows.length} rows, tables=${JSON.stringify(usedTables)})`
    );

    return {
      status: 'ok',
      sql: '',
      rowCount: strongRows.length,
      answer: trimmed,
      sources
    };
  } catch (err) {
    console.warn('[SqlQueryTool] Semantic row fallback failed:', err.message);
    return null;
  }
}

/**
 * Database Query Tool:
 * Blocks mutation intents, selects relevant tables using live schema + semantic
 * SQL embeddings, generates and executes a read-only SELECT query, and falls
 * back to semantic SQL row embeddings when SQL fails or returns 0 rows.
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
    const [allTables, semanticCtx] = await Promise.all([
      getMySqlSchema(),
      retrieveSemanticSqlContext(cleanQuestion)
    ]);

    if (!allTables || allTables.length === 0) {
      return {
        status: 'no_data',
        answer: 'No tables are available in the database.',
        sources: []
      };
    }

    const rankedCandidates = selectCandidateTables(allTables, cleanQuestion, semanticCtx);
    const selectedTables = rankedCandidates.map((c) => c.table);
    const allowedTableNames = allTables.map((t) => t.tableName);

    // Group top semantically matched rows by table to help the LLM match exact stored text/synonyms
    const semanticHintsByTable = new Map();
    for (const row of semanticCtx.hydratedRows || []) {
      const list = semanticHintsByTable.get(row.targetTable) || [];
      if (list.length < SEMANTIC_ROW_PROMPT_HINTS) {
        list.push(row.content);
        semanticHintsByTable.set(row.targetTable, list);
      }
    }

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
        const semRows = semanticHintsByTable.get(t.tableName) || [];
        const semRowsText =
          semRows.length > 0
            ? `\nClosest matching records (semantic hints): ${JSON.stringify(semRows)}`
            : '';
        return `Table ${escapeBacktickId(t.tableName)}: [${cols}]${categoriesText}${samples}${semRowsText}`;
      })
      .join('\n\n');

    const sqlSystemPrompt = `You generate one read-only MySQL SELECT query for the provided database schema and user question.
Rules:
1. Output ONLY a single valid MySQL SELECT query. No markdown, no code fences, no explanations, no trailing semicolons.
2. Use ONLY table names, column names, and data types from the provided schema.
3. Sample rows are only a tiny preview of the table—ALWAYS write a SELECT query to search the full table even if the requested value or date does not appear in Sample rows.
4. When matching text values, prefer flexible case-insensitive LIKE patterns or exact values seen in Closest matching records when available.
5. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, UNION, INTO, or comments.
6. Match exact categorical values shown in Distinct categorical values when filtering categorical columns.
7. Select clear, user-relevant columns and avoid unnecessary internal surrogate ID or audit timestamp columns unless explicitly requested. Give clear column aliases to aggregate expressions.`;

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
      console.warn('[SqlQueryTool] Blocked unsafe/invalid SQL:', guardErr.message, '| rawSql:', rawSql);
      const semanticFallback = await trySemanticSqlRowFallback(
        cleanQuestion,
        semanticCtx.hydratedRows
      );
      if (semanticFallback) return semanticFallback;
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
      const semanticFallback = await trySemanticSqlRowFallback(
        cleanQuestion,
        semanticCtx.hydratedRows
      );
      if (semanticFallback) return semanticFallback;
      return {
        status: 'failed',
        answer: 'An error occurred while executing the database query.',
        sources: []
      };
    }

    const rowList = Array.isArray(rows) ? rows : [];

    // If strict SQL returned 0 rows (e.g. synonym/wording mismatch), try semantic SQL row fallback
    if (rowList.length === 0) {
      const semanticFallback = await trySemanticSqlRowFallback(
        cleanQuestion,
        semanticCtx.hydratedRows
      );
      if (semanticFallback) return semanticFallback;
    }

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