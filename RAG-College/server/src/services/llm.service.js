const { OLLAMA_BASE_URL, LLM_MODEL } = require('../config/env');

const DEFAULT_MODEL = 'qwen2.5-coder:3b';

// Optional tuning, all driven by .env (nothing is forced if unset)
const KEEP_ALIVE = process.env.LLM_KEEP_ALIVE || '10m';
const NUM_CTX = parseInt(process.env.LLM_NUM_CTX, 10);

/**
 * Normalizes keep_alive for Ollama API:
 * If '-1' or -1 is passed, it returns the integer -1 (indefinite keep-alive).
 * Otherwise, it retains the time duration string (e.g., '10m', '24h').
 */
function parseKeepAlive(val) {
  if (val === undefined || val === null || val === '') return '10m';
  if (String(val).trim() === '-1') return -1;
  return val;
}

function buildPayload({ prompt, system, temperature, format, maxTokens, stream }) {
  const options = {
    temperature,
    num_predict: maxTokens,
    num_thread: 8
  };

  if (Number.isFinite(NUM_CTX) && NUM_CTX > 0) {
    options.num_ctx = NUM_CTX;
  }

  const payload = {
    model: LLM_MODEL || DEFAULT_MODEL,
    prompt,
    stream,
    keep_alive: parseKeepAlive(KEEP_ALIVE),
    options
  };

  if (system) {
    payload.system = system;
  }

  if (format === 'json') {
    payload.format = 'json';
  }

  return payload;
}

/**
 * Universal LLM generation service calling Ollama (waits for the full answer)
 */
async function generateText({ prompt, system = '', temperature = 0.2, format = null, maxTokens = 1024 }) {
  const url = `${OLLAMA_BASE_URL}/api/generate`;
  const payload = buildPayload({ prompt, system, temperature, format, maxTokens, stream: false });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama LLM generation error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.response ? data.response.trim() : '';
}

/**
 * Streaming version: calls onToken(piece) for every piece of text as Ollama
 * produces it, and still resolves with the complete text at the end.
 */
async function streamText({
  prompt,
  system = '',
  temperature = 0.2,
  format = null,
  maxTokens = 1024,
  onToken = null,
  signal = undefined
}) {
  const url = `${OLLAMA_BASE_URL}/api/generate`;
  const payload = buildPayload({ prompt, system, temperature, format, maxTokens, stream: true });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama LLM generation error (${response.status}): ${errText}`);
  }

  if (!response.body) {
    throw new Error('Ollama LLM returned an empty stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  // Ollama streams one JSON object per line (NDJSON)
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (_) {
      return;
    }

    if (data.error) {
      throw new Error(`Ollama LLM stream error: ${data.error}`);
    }

    if (data.response) {
      fullText += data.response;
      if (typeof onToken === 'function') onToken(data.response);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  buffer += decoder.decode();
  handleLine(buffer);

  return fullText.trim();
}

module.exports = {
  generateText,
  streamText
};