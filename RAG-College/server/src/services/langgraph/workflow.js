const { Annotation, StateGraph, START, END } = require('@langchain/langgraph');
const { routeQuery } = require('../router.service');
const { generateEmbedding } = require('../embedding.service');
const { retrieveHybridChunks } = require('../hybrid-retrieval.service');
const { rerankChunks } = require('../reranker.service');
const { verifyGrounding } = require('../grounding.service');
const { retrieveRelevantImages } = require('../image-retrieval.service');
const { generateText, streamText } = require('../llm.service');
const { executeTabularQuery } = require('../tabular.service');
const DocumentChunk = require('../../models/DocumentChunk');
const Document = require('../../models/Document');

// ---------- CONFIG (all numbers, prompts, messages) ----------
const int = (name, fallback) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
};

const float = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

const config = {
  retrieval: {
    topK: int('RAG_TOP_K', 10),
    candidatePoolMin: int('RAG_CANDIDATE_POOL_SIZE', 30),
    candidatePoolMultiplier: int('RAG_CANDIDATE_POOL_MULTIPLIER', 4),
    rerankTopN: int('RAG_RERANK_TOP_N', 10),
    minRelevanceScore: float('RAG_MIN_RELEVANCE_SCORE', 0),
    uncitedSourcesLimit: int('RAG_UNCITED_SOURCES_LIMIT', 2),
    // A reranked chunk is kept only if its score is at least this fraction of the best chunk's score
    relativeScoreFloor: float('RAG_RERANK_RELATIVE_FLOOR', 0.25),
    // Unranked hybrid candidates are used only to backfill up to this many chunks
    minContextChunks: int('RAG_MIN_CONTEXT_CHUNKS', 2)
  },

  tabular: {
    fallbackStatuses: (process.env.RAG_TABULAR_FALLBACK_STATUSES || 'unsupported,failed,no_data')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  },

  image: {
    topK: int('RAG_IMAGE_TOP_K', 3),
    minScore: float('RAG_IMAGE_MIN_SCORE', 0.12),
    // When the user names a document, the document itself is evidence. Images in it are accepted
    // if their score is at least this fraction of the best image score (SigLIP scores are low and
    // vary by query, so an absolute threshold alone rejects valid images).
    scopedRelativeFloor: float('RAG_IMAGE_SCOPED_RELATIVE_FLOOR', 0.3),
    suggestionTopK: int('RAG_IMAGE_SUGGESTION_TOP_K', 3),
    suggestionMinScore: float('RAG_IMAGE_SUGGESTION_MIN_SCORE', 0),
    candidateTopK: int('RAG_IMAGE_CANDIDATE_TOP_K', 30),
    maxDocuments: int('RAG_IMAGE_MAX_DOCUMENTS', 3)
  },

  context: {
    maxChunks: int('RAG_CONTEXT_MAX_CHUNKS', 6),
    filenameMaxLength: int('RAG_FILENAME_MAX_LENGTH', 30),
    adjacentChunkLimit: int('RAG_ADJACENT_CHUNK_LIMIT', 4),
    adjacentPageWindow: int('RAG_ADJACENT_PAGE_WINDOW', 1)
  },

  generation: {
    temperature: float('RAG_GEN_TEMPERATURE', 0.1),
    maxTokens: {
      short: int('RAG_MAX_TOKENS_SHORT', 600),
      medium: int('RAG_MAX_TOKENS_MEDIUM', 1500),
      detailed: int('RAG_MAX_TOKENS_DETAILED', 2500)
    },
    defaultLength: process.env.RAG_DEFAULT_LENGTH || 'medium',
    // If the model answers "not found" while context exists, retry once with a more permissive prompt
    retryOnNotFound: process.env.RAG_RETRY_ON_NOT_FOUND !== '0',
    // The grounding check runs a second LLM pass after the answer. The chat controller returns
    // the generated answer, so this pass only adds waiting time. Set RAG_ENABLE_GROUNDING=1 to turn it back on.
    groundingEnabled: process.env.RAG_ENABLE_GROUNDING === '1'
  },

  casual: {
    temperature: float('RAG_CASUAL_TEMPERATURE', 0.7),
    maxTokens: int('RAG_CASUAL_MAX_TOKENS', 100)
  },

  prompts: {
    casualSystem:
      'You are a polite, helpful AI assistant. Respond warmly and concisely in 1-2 sentences.',
    contextHeader: 'VERIFIED SOURCES LIST',

    generationSystem: `You are a verified knowledge assistant.
Answer the question based STRICTLY and ONLY on the facts present in the verified context.

RULES:
1. CITATIONS:
   - When citing a fact, use the exact SOURCE number shown in the context, like [1] or [1, 2].
   - Only cite source numbers that exist in the provided context.

2. QUERY FULFILLMENT & SCOPE:
   - Address every distinct requirement in the user prompt using the supporting information in verified context.
   - For queries asking for counts, seats, numbers, or rules, extract them directly from tables, charts, and text in context.
   - Complete all statements and lists fully. Do not truncate words or sentences.
   - Never extrapolate facts outside the context.

3. ANSWER LENGTH & DEPTH:
   - "short": Provide a crisp, direct answer.
   - "medium": Provide a balanced, structured explanation.
   - "detailed": Provide a comprehensive breakdown.

4. REJECTION:
   - The context may contain unrelated sources; ignore those and use only the sources that relate to the question.
   - The context may express the information differently from the question (examples, tables, code, symbols). Use it if it answers the question.
   - If some of the question can be answered, answer that part and state which part is missing.
   - Output EXACTLY the "not found" sentence provided ONLY if no source in the context relates to the question at all.

5. FORMATTING:
   - Write the answer in your own words as clear sentences. Do not wrap the whole answer in quotation marks.
   - Wrap every code snippet, operator, symbol, keyword, function name and literal value in single backticks, for example \`value\`, so it renders exactly as written.`,

    generationRetrySystem: `You are a verified knowledge assistant.
A previous attempt wrongly concluded the context had no answer. Read every source in the verified context again.

RULES:
1. Use only facts present in the verified context. Never add outside facts.
2. The relevant information may be written as examples, code, tables, symbols or lists rather than as a direct explanation. Explain it from what is shown.
3. Cite sources with their exact SOURCE number, like [1] or [1, 2]. Only cite numbers that exist.
4. If only part of the question is covered, answer that part and say what is missing.
5. Output EXACTLY the "not found" sentence provided ONLY if no source relates to the question at all.
6. Write in your own words as clear sentences, not wrapped in quotation marks. Wrap every code snippet, operator, symbol, keyword, function name and literal value in single backticks so it renders exactly as written.`
  },

  messages: {
    casualFallback: 'Hello! How can I assist you today?',
    notFound: "I couldn't find this information in the uploaded documents.",
    imageNotFound: "I couldn't find the requested image or diagram in the uploaded documents.",
    defaultFilename: 'Document',
    defaultImageCaption: 'diagram',
    embeddedLabel: 'Embedded',
    imageOnly: ({ label, marker }) =>
      `Here is the requested diagram: ${label} ${marker}. You can view it in the panel below.`,
    imageLead: ({ label, marker }) =>
      `Here is the diagram: ${label} ${marker}. You can view it in the panel below.\n\n`,
    suggestion: (filename) => `Explain more details about ${filename}`,
    moreDocuments: (n) =>
      `\n\nAt least ${n} more document${n === 1 ? '' : 's'} also have similar diagrams. Tell me the document or topic to narrow it down.`,
    imageMultiple: ({ items }) =>
      `I found matching diagrams in ${items.length} different documents:\n\n${items
        .map((it) => `- ${it.label}${it.marker}`)
        .join('\n')}\n\nYou can view them in the panel below. Tell me which document you want to focus on.`,
    imageSuggest: ({ items }) =>
      `I couldn't find an exact match for that image, but these are the closest ones in your documents:\n\n${items
        .map((it, n) => `${n + 1}.${it.label}`)
        .join('\n')}\n\nWhich one do you mean? You can also tell me the document or topic.`
  }
};

const {
  retrieval: RET,
  image: IMG,
  context: CTX,
  generation: GEN,
  casual: CASUAL,
  prompts: PROMPTS,
  messages: MSG,
  tabular: TAB
} = config;

const VALID_VISUAL_MODES = ['image_only', 'both', 'text_only'];
const VALID_LENGTHS = ['short', 'medium', 'detailed'];

const lastWins = { reducer: (x, y) => y ?? x };
const attr = (def) => Annotation({ ...lastWins, default: def });
const idOf = (v) => (v?._id || v)?.toString();

const truncateFilename = (name) =>
  name.length > CTX.filenameMaxLength ? `${name.substring(0, CTX.filenameMaxLength - 3)}...` : name;

const isVisualState = (state) => Boolean(state.isVisualQuery) && state.visualMode !== 'text_only';
const activeQueryOf = (state) => state.searchQuery || state.question;

const isScopeUnresolved = (state) =>
  Array.isArray(state.selectedDepartments) &&
  state.selectedDepartments.length > 0 &&
  !(state.detectedDepartmentIds?.length > 0);

// ---------- Streaming helpers ----------
// The chat controller passes onToken / onReset through the graph config:
//   graph.invoke(input, { configurable: { onToken, onReset } })
// When they are missing (for example when the graph is invoked elsewhere) the nodes behave exactly as before.
function streamHooksOf(runConfig) {
  const configurable = runConfig?.configurable || {};
  return {
    onToken: typeof configurable.onToken === 'function' ? configurable.onToken : null,
    onReset: typeof configurable.onReset === 'function' ? configurable.onReset : null
  };
}

// Holds back the first tokens while they could still turn out to be the "not found" sentence,
// so the user never sees that sentence flash on screen before a retry. As soon as the text
// diverges from it, everything held is released and tokens pass straight through.
function createNotFoundGate(sentence, emit) {
  const target = String(sentence || '').trim();
  let held = '';
  let open = false;

  return {
    push(chunk) {
      if (open || !target) {
        emit(chunk);
        return;
      }
      held += chunk;
      const probe = held.trimStart();
      const stillMatching = target.startsWith(probe) || probe.startsWith(target);
      if (!stillMatching) {
        open = true;
        emit(held);
        held = '';
      }
    },
    finish(isNotFound) {
      if (!open && !isNotFound && held) {
        open = true;
        emit(held);
        held = '';
      }
    }
  };
}

function diversifyByDocument(images, maxDocs, total) {
  const list = Array.isArray(images) ? images : [];
  const docKey = (img) => idOf(img.documentId) || String(img._id);
  const firstPerDoc = [];
  const seen = new Set();
  for (const img of list) {
    const key = docKey(img);
    if (seen.has(key)) continue;
    if (seen.size >= maxDocs) break;
    seen.add(key);
    firstPerDoc.push(img);
  }
  const picked = new Set(firstPerDoc);
  const rest = list.filter((img) => !picked.has(img));
  return [...firstPerDoc, ...rest].slice(0, total);
}

// ---------- Chunk selection helpers ----------
const chunkTextOf = (c) => c.content || c.text || '';

const chunkKeyOf = (c) =>
  (c._id || c.chunkId)?.toString() ||
  `${c.metadata?.sourceFilename || ''}|${c.metadata?.pageNumber || c.pageNumber || ''}|${chunkTextOf(c).slice(0, 80)}`;

const chunkScoreOf = (c) => {
  if (typeof c.rerankScore === 'number') return c.rerankScore;
  if (typeof c.score === 'number') return c.score;
  return null;
};

// Keeps reranked chunks whose score is within a fraction of the best score.
// Purely relative, so it adapts to whatever scale the reranker produces.
function selectRelevantRanked(rankedChunks) {
  const ranked = Array.isArray(rankedChunks) ? rankedChunks : [];
  if (ranked.length === 0) return [];

  const topScore = chunkScoreOf(ranked[0]);
  if (topScore === null || topScore <= 0) return ranked;

  return ranked.filter((c) => {
    const s = chunkScoreOf(c);
    return s === null || s >= topScore * RET.relativeScoreFloor;
  });
}

function pickContextChunks(rankedChunks, candidateChunks) {
  const seen = new Set();
  const picked = [];

  const add = (chunk) => {
    const key = chunkKeyOf(chunk);
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(chunk);
  };

  for (const chunk of selectRelevantRanked(rankedChunks)) {
    if (picked.length >= CTX.maxChunks) break;
    add(chunk);
  }

  // Unranked candidates only backfill when reranking left too little context
  for (const chunk of candidateChunks || []) {
    if (picked.length >= RET.minContextChunks) break;
    add(chunk);
  }

  return picked;
}

// 1. LangGraph State Schema
const RagStateAnnotation = Annotation.Root({
  question: attr(() => ''),
  messages: attr(() => []),
  searchQuery: attr(() => ''),
  sessionId: attr(() => ''),
  requestId: attr(() => ''),
  timer: attr(() => null),
  selectedDepartments: attr(() => []),
  detectedDepartments: attr(() => []),
  detectedDepartmentIds: attr(() => []),
  documentId: attr(() => null),
  intent: attr(() => 'rag'),
  tabularStatus: attr(() => ''),
  visualMode: attr(() => null),
  isVisualQuery: attr(() => false),
  hasImageEvidence: attr(() => false),
  answerLength: attr(() => null),
  queryEmbedding: attr(() => null),
  retrievedChunks: attr(() => []),
  imageResults: attr(() => []),
  imageSuggestions: attr(() => []),
  imageMoreDocuments: attr(() => 0),
  context: attr(() => ''),
  answer: attr(() => ''),
  verifiedAnswer: attr(() => ''),
  sources: attr(() => []),
  suggestedQuestions: attr(() => []),
  grounding: attr(() => null),
  groundingScore: attr(() => 1.0),
  isGrounded: attr(() => true),
  timings: Annotation({ reducer: (x, y) => ({ ...x, ...y }), default: () => ({}) })
});

// 2. Router Node
async function routerNode(state) {
  state.timer?.start('routing');
  const t0 = Date.now();
  try {
    const routeResult = await routeQuery(
      state.question,
      state.selectedDepartments,
      state.messages,
      { documentId: state.documentId }
    );
    const routingMs = Date.now() - t0;

    const isExplicitVisual = VALID_VISUAL_MODES.includes(state.visualMode);
    const visualMode = isExplicitVisual ? state.visualMode : routeResult.visualMode || 'text_only';
    const isVisual = isExplicitVisual
      ? state.visualMode !== 'text_only'
      : Boolean(routeResult.isVisualQuery && visualMode !== 'text_only');

    const isExplicitLength = VALID_LENGTHS.includes(state.answerLength);
    const answerLength = isExplicitLength ? state.answerLength : routeResult.answerLength || GEN.defaultLength;

    return {
      intent: routeResult.intent,
      visualMode,
      isVisualQuery: isVisual,
      answerLength,
      searchQuery: routeResult.searchQuery || state.question,
      detectedDepartments: routeResult.departments || [],
      detectedDepartmentIds: routeResult.departmentIds || [],
      timings: { routingMs }
    };
  } finally {
    state.timer?.end('routing');
  }
}

// 3. Casual Node
async function casualNode(state, runConfig) {
  state.timer?.start('generation');
  state.timer?.skip('retrieval');
  state.timer?.skip('grounding');
  const t0 = Date.now();
  const { onToken } = streamHooksOf(runConfig);
  try {
    const params = {
      prompt: state.question,
      system: PROMPTS.casualSystem,
      temperature: CASUAL.temperature,
      maxTokens: CASUAL.maxTokens
    };
    const answer = onToken
      ? await streamText({ ...params, onToken })
      : await generateText(params);

    const reply = answer || MSG.casualFallback;
    return {
      answer: reply,
      verifiedAnswer: reply,
      sources: [],
      imageResults: [],
      hasImageEvidence: false,
      timings: { generationMs: Date.now() - t0, imageRetrievalMs: 0 }
    };
  } finally {
    state.timer?.end('generation');
  }
}

// 4. Tabular Node
async function tabularNode(state) {
  state.timer?.start('tabular');
  const t0 = Date.now();
  try {
    const scope = {
      departmentIds: state.detectedDepartmentIds || [],
      documentId: state.documentId || null,
      blockAll: isScopeUnresolved(state)
    };
    const tabularResult = await executeTabularQuery(activeQueryOf(state), scope);
    const status = tabularResult.status || '';

    if (TAB.fallbackStatuses.includes(status)) {
      console.log(`[TabularNode] status=${status} -> forwarding to text retrieval`);
      return {
        tabularStatus: status,
        answer: '',
        verifiedAnswer: '',
        sources: [],
        imageResults: [],
        timings: { tabularMs: Date.now() - t0 }
      };
    }

    state.timer?.skip('grounding');
    return {
      tabularStatus: status,
      answer: tabularResult.answer,
      verifiedAnswer: tabularResult.answer,
      sources: tabularResult.sources,
      imageResults: [],
      timings: {
        generationMs: Date.now() - t0,
        textRetrievalMs: 0,
        imageRetrievalMs: 0,
        vectorRetrievalMs: 0,
        keywordRetrievalMs: 0,
        hybridFusionMs: 0,
        rerankingMs: 0,
        contextBuildingMs: 0,
        groundingMs: 0
      }
    };
  } finally {
    state.timer?.end('tabular');
  }
}

// 5. Text Retrieval Node
async function textRetrievalNode(state) {
  state.timer?.start('retrieval');
  const tStart = Date.now();
  const emptyTimings = {
    tTextStart: tStart,
    embeddingMs: 0,
    vectorRetrievalMs: 0,
    keywordRetrievalMs: 0,
    hybridFusionMs: 0,
    textRetrievalMs: 0,
    rerankingMs: 0,
    retrievalMs: 0
  };

  if (isScopeUnresolved(state)) {
    return { retrievedChunks: [], timings: { ...emptyTimings, tTextEnd: Date.now() } };
  }

  try {
    const activeQuery = activeQueryOf(state);
    const tEmb = Date.now();
    const queryEmbedding = await generateEmbedding(activeQuery);
    const embeddingMs = Date.now() - tEmb;

    const topK = RET.topK;
    const candidateLimit = Math.max(RET.candidatePoolMin, topK * RET.candidatePoolMultiplier);
    const departmentIds = state.detectedDepartmentIds?.length > 0 ? state.detectedDepartmentIds : null;

    const hybridResult = await retrieveHybridChunks({
      question: activeQuery,
      queryEmbedding,
      topK,
      candidateLimit,
      departmentIds,
      documentId: state.documentId
    });

    const candidateChunks = hybridResult.chunks || [];
    const { rankedChunks, rerankingMs } = await rerankChunks(
      candidateChunks,
      activeQuery,
      Math.max(RET.rerankTopN, topK),
      { queryEmbedding }
    );

    console.log('[DEBUG RETRIEVAL] Total candidates from hybrid:', candidateChunks.length);
    console.log('[DEBUG CANDIDATES FILES & PAGES]:', candidateChunks.map((c) => ({
      file: c.metadata?.sourceFilename || c.documentId?.originalFilename,
      page: c.metadata?.pageNumber || c.pageNumber,
      snippet: chunkTextOf(c).slice(0, 70).replace(/\n/g, ' ')
    })));

    console.log('[DEBUG RERANKED CHUNKS]:', (rankedChunks || []).map((c) => ({
      file: c.metadata?.sourceFilename || c.documentId?.originalFilename,
      page: c.metadata?.pageNumber || c.pageNumber,
      score: c.rerankScore ?? c.score,
      snippet: chunkTextOf(c).slice(0, 70).replace(/\n/g, ' ')
    })));

    const safeChunks = pickContextChunks(rankedChunks, candidateChunks);

    console.log('[DEBUG CONTEXT CHUNKS]:', safeChunks.map((c) => ({
      file: c.metadata?.sourceFilename || c.documentId?.originalFilename,
      page: c.metadata?.pageNumber || c.pageNumber,
      chars: chunkTextOf(c).length
    })));

    return {
      queryEmbedding,
      retrievedChunks: safeChunks,
      timings: {
        tTextStart: tStart,
        tTextEnd: Date.now(),
        embeddingMs,
        vectorRetrievalMs: hybridResult.timings?.vectorRetrievalMs || 0,
        keywordRetrievalMs: hybridResult.timings?.keywordRetrievalMs || 0,
        hybridFusionMs: hybridResult.timings?.hybridFusionMs || 0,
        textRetrievalMs: hybridResult.timings?.textRetrievalMs || 0,
        rerankingMs,
        retrievalMs: hybridResult.timings?.textRetrievalMs || 0
      }
    };
  } catch (err) {
    console.error('[TextRetrievalNode] Retrieval failed:', err.message);
    return {
      retrievedChunks: [],
      timings: { ...emptyTimings, tTextEnd: Date.now() }
    };
  }
}

// 6. Image Retrieval Node
async function imageRetrievalNode(state) {
  const tStart = Date.now();

  if (!isVisualState(state) || isScopeUnresolved(state)) {
    state.timer?.skip('siglip');
    return {
      hasImageEvidence: false,
      imageResults: [],
      timings: { tImgStart: tStart, tImgEnd: Date.now(), imageRetrievalMs: 0 }
    };
  }

  state.timer?.start('siglip');
  try {
    const activeQuery = activeQueryOf(state);
    let qEmbedding = state.queryEmbedding;
    if (!Array.isArray(qEmbedding) || qEmbedding.length === 0) {
      qEmbedding = await generateEmbedding(activeQuery);
    }

    const deptFilter = state.detectedDepartmentIds?.length > 0 ? state.detectedDepartmentIds : null;

    let explicitDocId = state.documentId || null;
    if (!explicitDocId) {
      const docMatch = activeQuery.match(/([a-zA-Z0-9_\-.]+\.(docx|pdf|xlsx|csv))/i);
      if (docMatch) {
        const foundDoc = await Document.findOne({ originalFilename: new RegExp(docMatch[1], 'i') }).select('_id');
        if (foundDoc) explicitDocId = foundDoc._id.toString();
      }
    }

    const retrievalOptions = {
      queryEmbedding: qEmbedding,
      retrievedChunks: state.retrievedChunks || [],
      isVisualQuery: true,
      visualMode: state.visualMode
    };

    const poolSize = Math.max(IMG.candidateTopK, IMG.topK);
    const suggestionsEnabled = IMG.suggestionTopK > 0;
    const searchMinScore = suggestionsEnabled ? Math.min(IMG.minScore, IMG.suggestionMinScore) : IMG.minScore;

    const imageRetResult = await retrieveRelevantImages(
      activeQuery,
      poolSize,
      deptFilter,
      explicitDocId,
      searchMinScore,
      retrievalOptions
    );

    let pool = imageRetResult.images || [];
    if (explicitDocId) {
      pool = pool.filter((img) => String(img.documentId?._id || img.documentId) === String(explicitDocId));
    }

    // The document counts as "named" when it was passed in, found by filename, or resolved by the
    // retrieval service from the question text (the service reports this in scopedDocumentIds).
    const isDocumentScoped =
      Boolean(explicitDocId) ||
      (Array.isArray(imageRetResult.scopedDocumentIds) && imageRetResult.scopedDocumentIds.length > 0);

    const numericScores = pool.map((img) => img.similarityScore).filter((s) => typeof s === 'number');
    const topScore = numericScores.length > 0 ? Math.max(...numericScores) : 0;

    const passesStrict = (img) => {
      const s = img.similarityScore;
      if (typeof s !== 'number') return true;
      if (s >= IMG.minScore) return true;
      // Named document: accept images that are close to the best match instead of using the absolute cutoff
      return isDocumentScoped && topScore > 0 && s >= topScore * IMG.scopedRelativeFloor;
    };
    const strictPool = pool.filter(passesStrict);
    const evidenceImages = diversifyByDocument(strictPool, IMG.maxDocuments, IMG.topK);

    const docIdOf = (img) => idOf(img.documentId) || String(img._id);
    const matchedDocs = new Set(strictPool.map(docIdOf));
    const shownDocs = new Set(evidenceImages.map(docIdOf));
    const imageMoreDocuments = Math.max(0, matchedDocs.size - shownDocs.size);

    const imageSuggestions =
      evidenceImages.length === 0 && suggestionsEnabled
        ? diversifyByDocument(pool, IMG.maxDocuments, IMG.suggestionTopK)
        : [];

    const tEnd = Date.now();

    return {
      queryEmbedding: qEmbedding,
      hasImageEvidence: evidenceImages.length > 0,
      imageResults: evidenceImages,
      imageSuggestions,
      imageMoreDocuments,
      timings: { tImgStart: tStart, tImgEnd: tEnd, imageRetrievalMs: tEnd - tStart }
    };
  } catch (err) {
    console.warn('[ImageRetrievalNode] Retrieval notice:', err.message);
    return {
      hasImageEvidence: false,
      imageResults: [],
      imageSuggestions: [],
      timings: { tImgStart: tStart, tImgEnd: Date.now(), imageRetrievalMs: 0 }
    };
  } finally {
    state.timer?.end('siglip');
  }
}

function sanitizeCitationMarkers(text, maxCitationIndex = 0) {
  if (!text || typeof text !== 'string') return '';
  if (maxCitationIndex <= 0) {
    return text.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  return text
    .replace(/\[([\d\s,]+)\]/g, (match, group) => {
      const nums = group
        .split(',')
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= maxCitationIndex);
      if (nums.length === 0) return '';
      return `[${Array.from(new Set(nums)).sort((a, b) => a - b).join(', ')}]`;
    })
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function normalizeMarkdownSpacing(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 7. Context Node
async function contextNode(state) {
  state.timer?.end('retrieval');
  state.timer?.start('contextBuilding');
  const tContextStart = Date.now();

  let chunks = [...(state.retrievedChunks || [])].slice(0, CTX.maxChunks);
  const isVisual = isVisualState(state);
  const images = isVisual ? state.imageResults || [] : [];

  const t = state.timings || {};
  let parallelRetrievalMs = 0;
  if (t.tTextStart && t.tTextEnd && t.tImgStart && t.tImgEnd) {
    parallelRetrievalMs = Math.max(
      0,
      Math.max(t.tTextEnd, t.tImgEnd) - Math.min(t.tTextStart, t.tImgStart)
    );
  } else {
    parallelRetrievalMs = Math.max(t.textRetrievalMs || 0, t.imageRetrievalMs || 0);
  }

  if (chunks.length === 0 && images.length === 0) {
    state.timer?.end('contextBuilding');
    return {
      context: '',
      sources: [],
      retrievedChunks: [],
      timings: {
        parallelRetrievalMs,
        retrievalMs: parallelRetrievalMs,
        contextBuildingMs: Date.now() - tContextStart
      }
    };
  }

  const contextBlocks = [];
  const sources = [];
  const sourceByKey = new Map();

  const getOrCreateSource = (sourceItem, key) => {
    if (!sourceByKey.has(key)) {
      const citationIndex = sources.length + 1;
      const enriched = { ...sourceItem, citationIndex, citationMarker: `[${citationIndex}]` };
      sources.push(enriched);
      sourceByKey.set(key, enriched);
      return enriched;
    }
    const existing = sourceByKey.get(key);
    if (sourceItem.content && (!existing.content || !existing.content.includes(sourceItem.content))) {
      existing.content = existing.content ? `${existing.content}\n\n---\n\n${sourceItem.content}` : sourceItem.content;
      existing.snippet = existing.content;
    }
    return existing;
  };

  const pageLabelOf = ({ pageNum, sheetName, slideNum, fallback = '' }) => {
    if (pageNum) return `Page ${pageNum}`;
    if (sheetName) return `Sheet ${sheetName}`;
    if (slideNum) return `Slide ${slideNum}`;
    return fallback;
  };

  for (const img of images) {
    const rawFilename = img.filename || img.originalFilename || MSG.defaultFilename;
    const cleanFilename = truncateFilename(rawFilename);
    const pageNum = img.pageNumber || img.page;
    const slideNum = img.slideNumber;
    const pageLabel = pageLabelOf({ pageNum, slideNum, fallback: MSG.embeddedLabel });
    const caption = img.caption || MSG.defaultImageCaption;

    const srcObj = getOrCreateSource(
      {
        type: 'image',
        documentId: img.documentId?._id || img.documentId,
        filename: cleanFilename,
        fullFilename: rawFilename,
        page: pageNum,
        pageNumber: pageNum,
        slideNumber: slideNum,
        sheetName: img.sheetName,
        imageId: img._id,
        imagePath: img.imagePath || img.filePath,
        caption,
        source: img.documentId?.source || 'upload',
        sourceType: img.documentId?.source === 'google_drive' ? 'Drive' : 'Upload',
        webViewLink: img.documentId?.driveMetadata?.webViewLink || null,
        label: `${caption} • ${pageLabel}`,
        snippet: `${caption} (${pageLabel})`
      },
      `image-${img._id}`
    );

    contextBlocks.push(`--- SOURCE [${srcObj.citationIndex}]: ${cleanFilename} (${pageLabel}) ---\nExtracted Figure/Diagram: "${caption}". The visual screenshot is available and loaded.`);
  }

  for (const chunk of chunks) {
    const rawFilename = chunk.metadata?.sourceFilename || chunk.documentId?.originalFilename || MSG.defaultFilename;
    const cleanFilename = truncateFilename(rawFilename);
    const pageNum = chunk.metadata?.pageNumber || chunk.pageNumber;
    const sheetName = chunk.metadata?.sheetName;
    const slideNum = chunk.metadata?.slideNumber || chunk.slideNumber;
    const pageLabel = pageLabelOf({ pageNum, sheetName, slideNum });
    const content = chunk.content || chunk.text || '';

    const srcObj = getOrCreateSource(
      {
        type: 'document',
        documentId: chunk.documentId?._id || chunk.documentId,
        chunkId: chunk._id,
        content,
        snippet: content,
        filename: cleanFilename,
        fullFilename: rawFilename,
        page: pageNum,
        pageNumber: pageNum,
        sheetName,
        slideNumber: slideNum,
        source: chunk.documentId?.source || 'upload',
        sourceType: chunk.documentId?.source === 'google_drive' ? 'Drive' : 'Upload',
        webViewLink: chunk.documentId?.driveMetadata?.webViewLink || null,
        label: pageLabel ? `${cleanFilename} • ${pageLabel}` : cleanFilename
      },
      `text-${rawFilename}-${pageLabel}`
    );

    contextBlocks.push(`--- SOURCE [${srcObj.citationIndex}]: ${cleanFilename} ${pageLabel} ---\n${content}`);
  }

  const numberedSourceIndex = sources.map((s) => `[${s.citationIndex}] ${s.label}`).join('\n');
  const fullContext = `${PROMPTS.contextHeader}:\n${numberedSourceIndex}\n\n${contextBlocks.join('\n\n---\n\n')}`;

  state.timer?.end('contextBuilding');
  return {
    context: fullContext,
    sources,
    retrievedChunks: chunks,
    timings: {
      parallelRetrievalMs,
      retrievalMs: parallelRetrievalMs,
      contextBuildingMs: Date.now() - tContextStart
    }
  };
}

// 8. Generator Node
async function generatorNode(state, runConfig) {
  state.timer?.start('generation');
  if (!GEN.groundingEnabled) state.timer?.skip('grounding');
  const t0 = Date.now();
  const { onToken, onReset } = streamHooksOf(runConfig);
  const done = (fields) => ({ ...fields, timings: { generationMs: Date.now() - t0 } });

  try {
    const isVisual = isVisualState(state);
    const vMode = isVisual ? state.visualMode || 'both' : 'text_only';
    const images = isVisual ? state.imageResults || [] : [];
    const sources = state.sources || [];

    const imageDisplay = (img) => {
      const caption = img.caption || MSG.defaultImageCaption;
      const filename = img.originalFilename || img.filename || MSG.defaultFilename;
      const pageNum = img.pageNumber || img.page;
      const src = sources.find((s) => s.type === 'image' && String(s.imageId) === String(img._id));
      const pageStr = pageNum ? ` (Page ${pageNum})` : '';
      const captionHasFile = caption.toLowerCase().includes(filename.toLowerCase());
      return {
        caption,
        filename,
        pageStr,
        label: captionHasFile ? caption : `${caption} — **${filename}**${pageStr}`,
        marker: src?.citationMarker || '[1]',
        src
      };
    };

    if (vMode === 'image_only') {
      if (state.hasImageEvidence && images.length > 0) {
        const bestImg = images[0];
        const d = imageDisplay(bestImg);
        const text = MSG.imageOnly(d);
        return done({
          answer: text,
          verifiedAnswer: text,
          sources: d.src ? [d.src] : sources.slice(0, 1),
          imageResults: images,
          suggestedQuestions: [MSG.suggestion(d.filename)]
        });
      }

      return done({
        answer: MSG.imageNotFound,
        verifiedAnswer: MSG.imageNotFound,
        sources: [],
        imageResults: [],
        suggestedQuestions: []
      });
    }

    if (!state.context && images.length === 0) {
      return done({
        answer: MSG.notFound,
        verifiedAnswer: MSG.notFound,
        sources: [],
        imageResults: [],
        suggestedQuestions: []
      });
    }

    const lengthKey = VALID_LENGTHS.includes((state.answerLength || '').toLowerCase())
      ? state.answerLength.toLowerCase()
      : GEN.defaultLength;

    const buildSystemPrompt = (base) =>
      `${base}\n\nNOT-FOUND SENTENCE: "${MSG.notFound}"\nCURRENT ANSWER LENGTH MODE: "${lengthKey}"`;
    const userPrompt = `Verified Context:\n${state.context}\n\nQuestion: ${activeQueryOf(state)}\n\nTarget Length: ${lengthKey}\n\nAnswer:`;

    const maxTokens = GEN.maxTokens[lengthKey] ?? GEN.maxTokens.medium;

    // When a diagram is attached, its lead-in line is shown first, then the model's text follows
    const leadText =
      isVisual && state.hasImageEvidence && images.length > 0 ? MSG.imageLead(imageDisplay(images[0])) : '';
    const emitLead = () => {
      if (onToken && leadText) onToken(leadText);
    };

    const runGeneration = async (baseSystem) => {
      const params = {
        prompt: userPrompt,
        system: buildSystemPrompt(baseSystem),
        temperature: GEN.temperature,
        maxTokens
      };

      if (!onToken) {
        return (await generateText(params)) || '';
      }

      const gate = createNotFoundGate(MSG.notFound, onToken);
      const text = (await streamText({ ...params, onToken: gate.push })) || '';
      gate.finish(text.includes(MSG.notFound));
      return text;
    };

    emitLead();
    let rawAnswer = await runGeneration(PROMPTS.generationSystem);

    // Rough size check: helps spot prompts that exceed the model's context window
    const promptChars = userPrompt.length + PROMPTS.generationSystem.length;
    console.log('[DEBUG GENERATION]', {
      sources: sources.length,
      promptChars,
      approxPromptTokens: Math.round(promptChars / 4),
      rawAnswerPreview: rawAnswer.slice(0, 120).replace(/\n/g, ' ')
    });

    let isFallback = rawAnswer.includes(MSG.notFound);

    if (isFallback && GEN.retryOnNotFound && state.context) {
      console.log('[GeneratorNode] Model returned not-found with context present, retrying once');
      // Clear whatever the client has already shown, then stream the retry from scratch
      if (onReset) onReset();
      emitLead();
      const retryAnswer = await runGeneration(PROMPTS.generationRetrySystem);
      if (retryAnswer && retryAnswer.trim().length > 0) {
        rawAnswer = retryAnswer;
        isFallback = rawAnswer.includes(MSG.notFound);
      }
    }

    const topFilename = sources[0]?.fullFilename;

    if (isFallback) {
      if (isVisual && state.hasImageEvidence && images.length > 0) {
        const d = imageDisplay(images[0]);
        const visualFallbackAnswer = `${MSG.imageLead(d)}I found the requested diagram above from ${d.filename}${d.pageStr}, though detailed accompanying text description was not found in the documents.`;
        return done({
          answer: visualFallbackAnswer,
          verifiedAnswer: visualFallbackAnswer,
          sources: sources.filter((s) => s.type === 'image'),
          imageResults: images,
          suggestedQuestions: [MSG.suggestion(d.filename)]
        });
      }

      return done({
        answer: MSG.notFound,
        verifiedAnswer: MSG.notFound,
        sources: [],
        imageResults: [],
        suggestedQuestions: []
      });
    }

    const structuredAnswer = normalizeMarkdownSpacing(sanitizeCitationMarkers(rawAnswer, sources.length));

    let finalAnswer = structuredAnswer;
    if (isVisual && state.hasImageEvidence && images.length > 0) {
      finalAnswer = MSG.imageLead(imageDisplay(images[0])) + structuredAnswer;
    }

    return done({
      answer: finalAnswer,
      verifiedAnswer: finalAnswer,
      sources,
      imageResults: images,
      suggestedQuestions: topFilename ? [MSG.suggestion(topFilename)] : []
    });
  } finally {
    state.timer?.end('generation');
  }
}

function filterSupportingSources(answer, sources, options = {}) {
  const { isVisualQuery = false, isFallback = false } = options || {};
  if (!sources || sources.length === 0) return { answer, sources: [] };
  if (!answer || typeof answer !== 'string') return { answer, sources };

  if (isFallback || answer.includes(MSG.notFound)) {
    return { answer, sources: [] };
  }

  const citedIndices = new Set();
  const markerRegex = /\[([\d\s,]+)\]/g;
  let match;
  while ((match = markerRegex.exec(answer)) !== null) {
    match[1]
      .split(',')
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n))
      .forEach((n) => citedIndices.add(n));
  }

  if (citedIndices.size === 0) {
    return { answer, sources: sources.slice(0, RET.uncitedSourcesLimit) };
  }

  const isIntentionalImage = (src) => isVisualQuery && src.type === 'image';
  const supporting = sources.filter(
    (src) => citedIndices.has(src.citationIndex) || src.type === 'tabular' || isIntentionalImage(src)
  );

  if (supporting.length === 0) return { answer, sources: [] };

  const oldToNew = new Map();
  const renumbered = supporting.map((src, idx) => {
    oldToNew.set(src.citationIndex, idx + 1);
    return { ...src, citationIndex: idx + 1, citationMarker: `[${idx + 1}]` };
  });

  const updatedAnswer = answer
    .replace(/\[([\d\s,]+)\]/g, (full, group) => {
      const remapped = group
        .split(',')
        .map((n) => oldToNew.get(parseInt(n.trim(), 10)))
        .filter((n) => n !== undefined);
      if (remapped.length === 0) return '';
      return `[${Array.from(new Set(remapped)).sort((a, b) => a - b).join(', ')}]`;
    })
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');

  return { answer: updatedAnswer, sources: renumbered };
}

// 9. Grounding Node
async function groundingNode(state) {
  state.timer?.start('grounding');
  const t0 = Date.now();
  try {
    const result = await verifyGrounding({
      question: activeQueryOf(state),
      answer: state.answer,
      contextChunks: state.retrievedChunks || [],
      context: state.context,
      sources: state.sources
    });

    return {
      grounding: result,
      groundingScore: result?.score ?? (result?.isGrounded ? 1.0 : 0.0),
      isGrounded: result?.isGrounded ?? true,
      verifiedAnswer: result?.verifiedAnswer || state.answer,
      timings: { groundingMs: Date.now() - t0 }
    };
  } catch (err) {
    console.warn('[GroundingNode Notice]:', err.message);
    return {
      grounding: { status: 'skipped_on_error', error: err.message },
      groundingScore: 1.0,
      isGrounded: true,
      verifiedAnswer: state.answer,
      timings: { groundingMs: Date.now() - t0 }
    };
  } finally {
    state.timer?.end('grounding');
  }
}

// 10. Response Node
async function responseNode(state) {
  console.log('[TIMINGS BREAKDOWN]:', JSON.stringify(state.timings, null, 2));

  const t = state.timings || {};
  const retrievalWallClockMs =
    t.parallelRetrievalMs !== undefined
      ? t.parallelRetrievalMs
      : (t.embeddingMs || 0) + (t.textRetrievalMs || 0) + (t.imageRetrievalMs || 0);

  const totalMs =
    (t.routingMs || 0) +
    (t.tabularMs || 0) +
    retrievalWallClockMs +
    (t.contextBuildingMs || 0) +
    (t.generationMs || 0) +
    (t.groundingMs || 0);

  const { tTextStart, tTextEnd, tImgStart, tImgEnd, ...cleanTimings } = t;
  return { timings: { ...cleanTimings, totalMs } };
}

function determineRoute(state) {
  if (state.intent === 'casual') return 'casualNode';
  if (state.intent === 'tabular' && !isVisualState(state)) return 'tabularNode';
  return 'textRetrievalNode';
}

function determineAfterTabular(state) {
  return TAB.fallbackStatuses.includes(state.tabularStatus) ? 'textRetrievalNode' : 'responseNode';
}

function determineAfterTextRetrieval(state) {
  return isVisualState(state) ? 'imageRetrievalNode' : 'contextNode';
}

function determineAfterGenerator() {
  return GEN.groundingEnabled ? 'groundingNode' : 'responseNode';
}

const workflow = new StateGraph(RagStateAnnotation)
  .addNode('routerNode', routerNode)
  .addNode('casualNode', casualNode)
  .addNode('tabularNode', tabularNode)
  .addNode('textRetrievalNode', textRetrievalNode)
  .addNode('imageRetrievalNode', imageRetrievalNode)
  .addNode('contextNode', contextNode)
  .addNode('generatorNode', generatorNode)
  .addNode('groundingNode', groundingNode)
  .addNode('responseNode', responseNode)

  .addEdge(START, 'routerNode')
  .addConditionalEdges('routerNode', determineRoute, {
    casualNode: 'casualNode',
    tabularNode: 'tabularNode',
    textRetrievalNode: 'textRetrievalNode'
  })
  .addEdge('casualNode', 'responseNode')
  .addConditionalEdges('tabularNode', determineAfterTabular, {
    textRetrievalNode: 'textRetrievalNode',
    responseNode: 'responseNode'
  })
  .addConditionalEdges('textRetrievalNode', determineAfterTextRetrieval, {
    imageRetrievalNode: 'imageRetrievalNode',
    contextNode: 'contextNode'
  })
  .addEdge('imageRetrievalNode', 'contextNode')
  .addEdge('contextNode', 'generatorNode')
  .addConditionalEdges('generatorNode', determineAfterGenerator, {
    groundingNode: 'groundingNode',
    responseNode: 'responseNode'
  })
  .addEdge('groundingNode', 'responseNode')
  .addEdge('responseNode', END);

const compiledRagGraph = workflow.compile();

module.exports = compiledRagGraph;
module.exports.compiledRagGraph = compiledRagGraph;
module.exports.filterSupportingSources = filterSupportingSources;