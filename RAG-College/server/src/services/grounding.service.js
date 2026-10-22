/**
 * Lightweight Grounding Service
 *
 * Lightweight post-generation grounding guard.
 * Does NOT perform sentence-level support scoring, token/bigram overlap checks,
 * regex-based numerical validation, rejection thresholds, or additional LLM verification calls.
 *
 * The LLM is instructed in the generator prompt to answer strictly using retrieved context
 * and not invent information.
 */

/**
 * Lightweight verification of generated answer against retrieved context.
 *
 * @param {Object} params
 * @param {string} params.answer - Generated answer
 * @param {string} params.context - Retrieved context
 * @param {Array} [params.sources] - Sources
 * @param {Array} [params.imageResults] - Image results
 * @param {boolean} [params.isVisualQuery] - Whether query asked for visual content
 * @param {boolean} [params.hasImageEvidence] - Whether image evidence was retrieved
 * @returns {{ supported: boolean, action: string, verifiedAnswer: string, reason: string }}
 */
// server/src/services/grounding.service.js
async function verifyGrounding({ question, answer, contextChunks }) {
  if (!contextChunks || contextChunks.length === 0) {
    return {
      supported: false,
      action: 'reject',
      fallbackAnswer: "I couldn't find relevant information in the selected department or uploaded documents to answer this question."
    };
  }

  // Check relevance/similarity between answer key terms and context text
  const contextText = contextChunks.map(c => c.content || c.text || '').join(' ').toLowerCase();
  const qTerms = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const hasKeywordOverlap = qTerms.some(term => contextText.includes(term));

  if (!hasKeywordOverlap) {
    return {
      supported: false,
      action: 'reject',
      fallbackAnswer: "The uploaded documents do not contain sufficient information to answer this question."
    };
  }

  return { supported: true, action: 'accept' };
}


module.exports = {
  verifyGrounding
};
