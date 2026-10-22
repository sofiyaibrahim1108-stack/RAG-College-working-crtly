const { generateText } = require('./llm.service');
const { getTableHints } = require('./tabular.service');
const Department = require('../models/Department');

const OBJECT_ID_FORMAT = /^[0-9a-fA-F]{24}$/;

/* ------------------------------------------------------------------ */
/* Config (all driven by .env - strictly no hardcoded thresholds)     */
/* ------------------------------------------------------------------ */

const envNumber = (name, fallback) => {
  const value = parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const CLASSIFIER_ENABLED = process.env.ROUTER_USE_CLASSIFIER !== '0';
const CLASSIFIER_MODEL = process.env.ROUTER_CLASSIFIER_MODEL || 'Xenova/mobilebert-uncased-mnli';
const HYPOTHESIS_TEMPLATE = process.env.ROUTER_HYPOTHESIS_TEMPLATE || 'This message is {}.';
const INTENT_MIN_SCORE = envNumber('ROUTER_INTENT_MIN_SCORE', 0.45);
const CASUAL_MIN_SCORE = envNumber('ROUTER_CASUAL_MIN_SCORE', 0.40);
// "rag" is the expensive path (retrieval + sources), so the fast classifier must be
// more sure before choosing it. Below this floor the LLM router decides instead.
const RAG_MIN_SCORE = envNumber('ROUTER_RAG_MIN_SCORE', 0.65);
// Minimum gap between top-1 and top-2 intent scores for a "confident" decision
const INTENT_MIN_MARGIN = envNumber('ROUTER_INTENT_MIN_MARGIN', 0.10);
const VISUAL_MIN_SCORE = envNumber('ROUTER_VISUAL_MIN_SCORE', 0.50);
const STANDALONE_MIN_SCORE = envNumber('ROUTER_STANDALONE_MIN_SCORE', 0.55);
const LENGTH_MIN_SCORE = envNumber('ROUTER_ANSWER_LENGTH_MIN_SCORE', 0.6);
const ALWAYS_REWRITE = process.env.ROUTER_ALWAYS_REWRITE === '1';

// Used ONLY when no classifier result exists at all (classifier disabled / failed to load)
const NO_SIGNAL_INTENT = process.env.ROUTER_NO_SIGNAL_INTENT || 'rag';

// Dynamic configurable visual keywords list from .env
const DEFAULT_VISUAL_TERMS = 'diagram,diagrams,image,images,photo,photos,picture,pictures,chart,charts,figure,figures,architecture,flowchart,flowcharts,layout,layouts,screenshot,screenshots,drawing,drawings';
const VISUAL_KEYWORDS_RAW = process.env.ROUTER_VISUAL_KEYWORDS || DEFAULT_VISUAL_TERMS;
const VISUAL_KEYWORD_SET = new Set(
  VISUAL_KEYWORDS_RAW.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)
);

function checkVisualKeywordMatch(text) {
  if (!text || typeof text !== 'string') return false;
  const words = text.toLowerCase().split(/[^a-z0-9_-]+/);
  return words.some((word) => VISUAL_KEYWORD_SET.has(word));
}

// When indexed tables match the question, a "rag" classification is upgraded to "tabular"
const TABLE_HINT_ROUTING = process.env.ROUTER_TABLE_HINT_ROUTING !== '0';
const TABLE_HINT_MIN_SCORE = envNumber('ROUTER_TABLE_HINT_MIN_SCORE', 0);

// Router timeouts
const LLM_TIMEOUT_MS = envNumber('ROUTER_LLM_TIMEOUT_MS', 15000);
const REWRITE_TIMEOUT_MS = envNumber('ROUTER_REWRITE_TIMEOUT_MS', 4000);

const ROUTER_SCHEMA = {
  intent: {
    casual:
      'a greeting, thanks, small talk, or a question about the assistant itself',
    tabular:
      'a question about numbers or values in a spreadsheet table',
    rag:
      'a question about information written in documents'
  },
  wantsVisual: {
    visual: 'The user is asking to be shown a diagram, figure, picture, or chart',
    textual: 'The user is asking a question that is answered with text, facts, or numbers'
  },
  visualMode: {
    text_only: 'A question or request answered with text, facts, numbers, code, or a summary, without any visual aids',
    both: 'Text explanation explicitly requesting an accompanying diagram, architecture image, or flowchart',
    image_only: 'Displaying visual media, diagrams, or charts directly without explanatory text'
  },
  answerLength: {
    short: 'A concise or brief summary',
    medium: 'A standard balanced response',
    detailed: 'An in-depth comprehensive response'
  },
  context: {
    standalone: 'a complete question that names its own subject',
    follow_up: 'a short follow-up that refers back to an earlier message'
  }
};

const INTENTS = Object.keys(ROUTER_SCHEMA.intent);
const VISUAL_MODES = Object.keys(ROUTER_SCHEMA.visualMode);
const ANSWER_LENGTHS = Object.keys(ROUTER_SCHEMA.answerLength);

function buildResult(fields, departments = [], departmentIds = []) {
  return { ...fields, departments, departmentIds };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function enforceIntentConstraints(intent, isVisualQuery) {
  return isVisualQuery && intent === 'tabular' ? 'rag' : intent;
}

function resolveAnswerLength(intent, choice, score) {
  if (intent === 'tabular') return 'short';
  if (typeof score === 'number' && score < LENGTH_MIN_SCORE) return 'medium';
  return ANSWER_LENGTHS.includes(choice) ? choice : 'medium';
}

async function resolveDepartments(selectedDepartments) {
  if (!Array.isArray(selectedDepartments) || selectedDepartments.length === 0) {
    return { departments: [], departmentIds: [] };
  }

  try {
    const values = selectedDepartments.map((v) => String(v));
    const depts = await Department.find({
      $or: [
        { _id: { $in: values.filter((v) => OBJECT_ID_FORMAT.test(v)) } },
        { name: { $in: values } },
        { code: { $in: values } }
      ]
    }).select('_id name code');

    return {
      departments: depts.map((d) => d.name),
      departmentIds: depts.map((d) => d._id.toString())
    };
  } catch (err) {
    console.warn('[Router] Failed to resolve departments:', err.message);
    return { departments: [], departmentIds: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Table hints                                                        */
/* ------------------------------------------------------------------ */

const hintName = (hint) => hint.name || hint.tableName;

async function fetchTableHints(question, departmentIds, selectedDepartments, options) {
  try {
    const scope = {
      departmentIds,
      documentId: options?.documentId || null,
      blockAll: Array.isArray(selectedDepartments) && selectedDepartments.length > 0 && departmentIds.length === 0
    };
    const hints = await getTableHints(question, scope);
    if (!Array.isArray(hints)) return [];
    return hints.filter((h) => typeof h.score !== 'number' || h.score >= TABLE_HINT_MIN_SCORE);
  } catch (_) {
    return [];
  }
}

function applyTableEvidence(classified, tableHints) {
  if (!TABLE_HINT_ROUTING || !classified) return classified;

  const validHints = (tableHints || []).filter(
    (h) => h && (h.name || h.tableName || h.originalFilename || h.filename)
  );

  // The classifier says casual, but the message matches indexed table content (cell values,
  // column names or file names). Do not trust "casual" then: mark it contested so the LLM router decides.
  if (classified.intent === 'casual') {
    return validHints.length > 0 ? { ...classified, contested: true } : classified;
  }

  // Classifier said tabular but no indexed table matches the question: do not trust it.
  if (validHints.length === 0) {
    return classified.intent === 'tabular' ? { ...classified, intent: 'rag' } : classified;
  }

  if (classified.intent !== 'rag' || classified.isVisualQuery) return classified;
  return { ...classified, intent: 'tabular' };
}

/* ------------------------------------------------------------------ */
/* Zero-shot classifier (ONNX)                                        */
/* ------------------------------------------------------------------ */

let classifierPromise = null;

function getClassifier() {
  if (!CLASSIFIER_ENABLED) return Promise.resolve(null);

  if (!classifierPromise) {
    classifierPromise = (async () => {
      console.log(`[Router] Loading classifier "${CLASSIFIER_MODEL}"...`);
      const { pipeline } = await import('@xenova/transformers');
      const classifier = await pipeline('zero-shot-classification', CLASSIFIER_MODEL);
      console.log('[Router] Classifier ready.');
      return classifier;
    })().catch((err) => {
      console.warn(`[Router] Classifier failed to load (${err.message}). Using LLM routing only.`);
      return null;
    });
  }

  return classifierPromise;
}

async function warmUpRouter() {
  const classifier = await getClassifier();
  if (classifier) {
    await classifyWithModel('hello', false);
  }
}

async function classifyField(classifier, text, field) {
  const criteria = ROUTER_SCHEMA[field];
  const descriptionToKey = new Map(Object.entries(criteria).map(([key, description]) => [description, key]));

  const result = await classifier(text, Object.values(criteria), {
    multi_label: false,
    hypothesis_template: HYPOTHESIS_TEMPLATE
  });
  const choice = descriptionToKey.get(result.labels[0]);
  const top = Number(result.scores[0]);
  const second = result.scores.length > 1 ? Number(result.scores[1]) : 0;

  return choice ? { choice, score: top, margin: top - second } : null;
}

async function classifyWithModel(text, includeContext = false) {
  const classifier = await getClassifier();
  if (!classifier) return null;

  try {
    const [intent, wantsVisual, visualMode, length, context] = await Promise.all([
      classifyField(classifier, text, 'intent'),
      classifyField(classifier, text, 'wantsVisual'),
      classifyField(classifier, text, 'visualMode'),
      classifyField(classifier, text, 'answerLength'),
      includeContext ? classifyField(classifier, text, 'context') : Promise.resolve(null)
    ]);
    if (!intent || !wantsVisual || !visualMode || !length) return null;

    const hasKeyword = checkVisualKeywordMatch(text);
    const asksForVisual = wantsVisual.choice === 'visual' || hasKeyword;
    const visualScore = hasKeyword ? Math.max(wantsVisual.score, 0.95) : (asksForVisual ? wantsVisual.score : 1 - wantsVisual.score);
    const isConfidentVisual = asksForVisual && (hasKeyword || wantsVisual.score >= VISUAL_MIN_SCORE);

    const resolvedVisualMode = isConfidentVisual
      ? (visualMode.choice === 'text_only' ? 'both' : visualMode.choice)
      : 'text_only';

    const resolvedIntent = enforceIntentConstraints(intent.choice, isConfidentVisual);
    const intentUnchanged = resolvedIntent === intent.choice;
    const resolvedIntentScore = intentUnchanged ? intent.score : visualScore;
    const resolvedIntentMargin = intentUnchanged ? intent.margin : visualScore;

    const isStandalone =
      Boolean(context) && context.choice === 'standalone' && context.score >= STANDALONE_MIN_SCORE;

    return {
      intent: resolvedIntent,
      intentScore: resolvedIntentScore,
      intentMargin: resolvedIntentMargin,
      visualMode: resolvedVisualMode,
      visualScore,
      isVisualQuery: isConfidentVisual,
      answerLength: length.choice,
      lengthScore: length.score,
      isStandalone,
      contextChoice: context ? context.choice : null,
      contextScore: context ? context.score : null
    };
  } catch (err) {
    console.warn(`[Router] Classifier error (${err.message}), using LLM`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Confidence rules                                                   */
/* ------------------------------------------------------------------ */

const INTENT_FLOORS = {
  casual: CASUAL_MIN_SCORE,
  tabular: INTENT_MIN_SCORE,
  rag: RAG_MIN_SCORE
};

const intentFloorOf = (classified) => INTENT_FLOORS[classified.intent] ?? INTENT_MIN_SCORE;

// Confident = absolute score above the floor AND clear lead over the runner-up intent
const isIntentConfident = (classified) =>
  Boolean(classified) &&
  !classified.contested &&
  classified.intentScore >= intentFloorOf(classified) &&
  classified.intentMargin >= INTENT_MIN_MARGIN;

const isConfident = (classified) => isIntentConfident(classified);

function resolveVisual(classified) {
  const noVisual = { visualMode: 'text_only', isVisualQuery: false };
  if (!classified || classified.intent === 'casual') return noVisual;
  if (classified.visualMode === 'text_only') return noVisual;
  if (classified.visualScore < VISUAL_MIN_SCORE && !classified.isVisualQuery) return noVisual;
  return { visualMode: classified.visualMode, isVisualQuery: true };
}

/* ------------------------------------------------------------------ */
/* LLM paths                                                          */
/* ------------------------------------------------------------------ */

const DYNAMIC_ROUTER_PROMPT = `You are an intent classifier and query optimizer for an enterprise document assistant.
Analyze the user message and return ONLY a valid JSON object matching this exact schema:

{
  "intent": "rag" | "tabular" | "casual",
  "isVisualQuery": true | false,
  "visualMode": "text_only" | "both" | "image_only",
  "answerLength": "short" | "medium" | "detailed",
  "searchQuery": "standalone query string optimized for semantic search"
}

Guidelines:
- "intent":
  - "casual": conversation with the assistant itself. Greetings, thanks, small talk, questions about who or what the assistant is or what it can do, and requests for help that name no specific topic. These need no document lookup.
  - "tabular": requests querying, filtering, or aggregating structured tabular records. Choose "tabular" only when Available Tables are listed and the question asks for specific values, totals or records those tables could hold. If no Available Tables are listed, never choose "tabular".
  - "rag": a specific question whose answer would be found inside uploaded documents: facts, procedures, definitions, explanations, and requests for diagrams or figures from documents.
- "isVisualQuery": true if the user explicitly asks to be shown diagrams, visual charts, figures, flowcharts, or architecture images.
- "visualMode": "image_only" if solely visual is requested, "both" if visual plus text explanation is needed, else "text_only".
- "answerLength": detect tone/depth intent - "short" for summaries/brief answers, "detailed" for comprehensive breakdowns, otherwise "medium".
- "searchQuery": if query depends on prior conversational context, rewrite into an unambiguous standalone search phrase; otherwise retain user query.`;

const REWRITE_PROMPT = `You rewrite the latest user message into a single standalone question in natural language.
The message may depend on something said earlier: a pronoun, a shortened phrase, or an omitted subject.
Use the conversation history only to find what it refers to, and replace every such reference with the specific subject, so the question makes sense on its own without the history.
Take the subject mainly from the most recent user question; use the assistant answer only to fill in what was being discussed.
If the message is already fully standalone, return it exactly as written.
Never answer the question. Never output SQL, code, or a table. Keep the original language and wording.
Return ONLY the question text, nothing else.`;

const HISTORY_MESSAGE_MAX_CHARS = envNumber('ROUTER_HISTORY_MESSAGE_MAX_CHARS', 300);

function formatHistory(conversationHistory) {
  return (conversationHistory || [])
    .slice(-3)
    .map((m) => {
      const text = String(m.content || '');
      const content = text.length > HISTORY_MESSAGE_MAX_CHARS
        ? `${text.slice(0, HISTORY_MESSAGE_MAX_CHARS)}...`
        : text;
      return `${m.role}: ${content}`;
    })
    .join('\n');
}

function parseJsonObject(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start !== -1 && end !== -1 ? JSON.parse(raw.slice(start, end + 1)) : {};
}

async function rewriteQuery(question, historySnippet) {
  try {
    const raw = await withTimeout(
      generateText({
        prompt: `Conversation History:\n${historySnippet}\n\nUser Message: "${question}"\nStandalone query:`,
        system: REWRITE_PROMPT,
        temperature: 0,
        maxTokens: 60
      }),
      REWRITE_TIMEOUT_MS,
      'Router rewrite LLM call'
    );
    const cleaned = String(raw || '').trim().replace(/^["']|["']$/g, '');
    return cleaned.length > 0 ? cleaned : question;
  } catch (err) {
    console.warn(`[Router] Query rewrite skipped (${err.message}), using original query directly`);
    return question;
  }
}

async function routeWithLLM(question, historySnippet, tableHints) {
  const tableContext = tableHints.length > 0
    ? `Available Tables: ${JSON.stringify(tableHints.map(hintName))}\n\n`
    : '';

  const userPrompt = `${historySnippet ? `Conversation History:\n${historySnippet}\n\n` : ''}${tableContext}User Message: "${question}"\nJSON:`;

  const rawResult = await withTimeout(
    generateText({
      prompt: userPrompt,
      system: DYNAMIC_ROUTER_PROMPT,
      temperature: 0,
      maxTokens: 120
    }),
    LLM_TIMEOUT_MS,
    'Router LLM call'
  );

  const parsed = parseJsonObject(rawResult);

  const hasKeyword = checkVisualKeywordMatch(question);
  const isVisualQuery = Boolean(parsed.isVisualQuery) || hasKeyword;
  const parsedIntent = INTENTS.includes(parsed.intent) ? parsed.intent : NO_SIGNAL_INTENT;
  const intent = enforceIntentConstraints(parsedIntent, isVisualQuery);
  const visualMode = isVisualQuery
    ? (VISUAL_MODES.includes(parsed.visualMode) && parsed.visualMode !== 'text_only' ? parsed.visualMode : 'both')
    : 'text_only';
  const answerLength = resolveAnswerLength(intent, parsed.answerLength);
  // Rewriting is only needed to resolve references to earlier messages. Without history the
  // user's own wording is kept, so no part of the question (e.g. "and what is their role") is lost.
  const searchQuery =
    historySnippet && parsed.searchQuery && typeof parsed.searchQuery === 'string' && parsed.searchQuery.trim().length > 0
      ? parsed.searchQuery.trim()
      : question;

  return { intent, visualMode, isVisualQuery, answerLength, searchQuery };
}

// Used when the LLM path fails. Trust the classifier's top-scoring intent
// (relative score) instead of forcing a fixed default. Only when there is no
// classifier signal at all do we use the env-configured NO_SIGNAL_INTENT.
function fallbackFromClassifier(classified, searchQuery) {
  const baseIntent = classified
    ? (classified.contested ? 'tabular' : classified.intent)
    : NO_SIGNAL_INTENT;
  const visual = resolveVisual(classified && { ...classified, intent: baseIntent });
  const intent = enforceIntentConstraints(baseIntent, visual.isVisualQuery);

  return {
    intent,
    ...visual,
    answerLength: resolveAnswerLength(intent, classified?.answerLength || 'medium', classified?.lengthScore),
    searchQuery
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

async function routeQuery(question, selectedDepartments = [], conversationHistory = [], options = {}) {
  const t0 = Date.now();
  const trimmedQuestion = (question || '').trim();

  if (!trimmedQuestion) {
    const { departments, departmentIds } = await resolveDepartments(selectedDepartments);
    return buildResult(
      {
        intent: 'casual',
        visualMode: 'text_only',
        isVisualQuery: false,
        answerLength: 'medium',
        searchQuery: ''
      },
      departments,
      departmentIds
    );
  }

  const historySnippet = formatHistory(conversationHistory);
  const hasHistory = historySnippet.length > 0;
  const askContext = hasHistory && !ALWAYS_REWRITE;

  const [{ departments, departmentIds, tableHints }, rawClassified] = await Promise.all([
    resolveDepartments(selectedDepartments).then(async (resolved) => ({
      ...resolved,
      tableHints: await fetchTableHints(trimmedQuestion, resolved.departmentIds, selectedDepartments, options)
    })),
    classifyWithModel(trimmedQuestion, askContext)
  ]);

  const classified = applyTableEvidence(rawClassified, tableHints);
  const upgraded = Boolean(classified) && classified !== rawClassified && classified.intent !== rawClassified.intent;
  const tableLog = tableHints.length > 0
    ? ` tables=${JSON.stringify(tableHints.map(hintName))}${upgraded ? ' (upgraded rag->tabular)' : ''}`
    : ' tables=0';

  try {
    if (isConfident(classified)) {
      const needsRewrite =
        hasHistory &&
        classified.intent !== 'casual' &&
        (ALWAYS_REWRITE || !classified.isStandalone);

      const searchQuery = needsRewrite
        ? await rewriteQuery(trimmedQuestion, historySnippet)
        : trimmedQuestion;

      // The rewritten standalone query may point at a table even when the
      // original follow-up did not. Re-check table hints with it.
      let finalClassified = classified;
      let rewriteLog = '';
      if (needsRewrite) {
        const unchanged = searchQuery === trimmedQuestion;
        rewriteLog = ` searchQuery=${JSON.stringify(searchQuery)}${unchanged ? ' (unchanged)' : ''}`;

        if (!unchanged && finalClassified.intent === 'rag') {
          const rewrittenHints = await fetchTableHints(searchQuery, departmentIds, selectedDepartments, options);
          finalClassified = applyTableEvidence(finalClassified, rewrittenHints);
          if (finalClassified !== classified) {
            rewriteLog += ` rewrittenTables=${JSON.stringify(rewrittenHints.map(hintName))} (upgraded rag->tabular after rewrite)`;
          }
        }
      }

      const visual = resolveVisual(finalClassified);
      const answerLength = resolveAnswerLength(
        finalClassified.intent,
        finalClassified.answerLength,
        finalClassified.lengthScore
      );

      const contextLog = finalClassified.contextScore === null
        ? ''
        : ` context=${finalClassified.contextChoice}(${finalClassified.contextScore.toFixed(2)})`;
      console.log(
        `[Router Fast] intent=${finalClassified.intent}(${finalClassified.intentScore.toFixed(2)}, margin ${finalClassified.intentMargin.toFixed(2)}) visual=${visual.visualMode}(p=${finalClassified.visualScore.toFixed(2)}) length=${answerLength}(raw ${finalClassified.answerLength} ${finalClassified.lengthScore.toFixed(2)})${contextLog}${tableLog}${rewriteLog} rewrite=${needsRewrite} in ${Date.now() - t0}ms`
      );

      return buildResult(
        {
          intent: finalClassified.intent,
          ...visual,
          answerLength,
          searchQuery
        },
        departments,
        departmentIds
      );
    }

    const llmRaw = await routeWithLLM(trimmedQuestion, historySnippet, tableHints);

    // The LLM can also pick "tabular" when no indexed table matches the question.
    // Apply the same table-evidence rule as the fast path.
    const llmChecked = applyTableEvidence(llmRaw, tableHints);
    const llmResult = llmChecked.intent === llmRaw.intent
      ? llmRaw
      : { ...llmChecked, answerLength: resolveAnswerLength(llmChecked.intent, 'medium') };

    const hint = classified
      ? ` (classifier unsure: intent ${classified.intent} ${classified.intentScore.toFixed(2)}, margin ${classified.intentMargin.toFixed(2)}, visual p=${classified.visualScore.toFixed(2)})`
      : '';
    console.log(
      `[Router LLM] intent=${llmResult.intent} visual=${llmResult.visualMode} length=${llmResult.answerLength} query="${llmResult.searchQuery}"${tableLog} in ${Date.now() - t0}ms${hint}`
    );

    return buildResult(llmResult, departments, departmentIds);
  } catch (err) {
    const elapsed = Date.now() - t0;
    const slow = elapsed >= LLM_TIMEOUT_MS ? ` SLOW: router LLM call exceeded ${LLM_TIMEOUT_MS}ms (check Ollama model load/keep_alive).` : '';
    const scores = classified
      ? ` classifier: intent ${classified.intent} ${classified.intentScore.toFixed(2)}, margin ${classified.intentMargin.toFixed(2)}, visual p=${classified.visualScore.toFixed(2)}`
      : ' classifier: none';
    console.warn(`[Router Fallback] ${err.message} in ${elapsed}ms.${slow}${scores}${tableLog}`);

    return buildResult(
      fallbackFromClassifier(classified, trimmedQuestion),
      departments,
      departmentIds
    );
  }
}

module.exports = {
  routeQuery,
  warmUpRouter
};