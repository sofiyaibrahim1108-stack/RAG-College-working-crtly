  const mongoose = require('mongoose');
  const DocumentChunk = require('../models/DocumentChunk');

  // Common English stopwords and conversational fillers to ignore during tokenization
  const STOPWORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'aren', 'arent', 'as', 'at', 'be', 'because', 'been', 'before',
    'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot',
    'could', 'couldn', 'couldnt', 'did', 'didn', 'didnt', 'do', 'does', 'doesn',
    'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'hadn', 'hadnt', 'has', 'hasn', 'hasnt', 'have', 'haven',
    'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here', 'heres',
    'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill',
    'im', 'ive', 'if', 'in', 'into', 'is', 'isn', 'isnt', 'it', 'its', 'itself',
    'lets', 'me', 'more', 'most', 'mustn', 'mustnt', 'my', 'myself', 'no', 'nor',
    'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our',
    'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shant', 'she', 'shed',
    'shell', 'shes', 'should', 'shouldn', 'shouldnt', 'so', 'some', 'such',
    'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves',
    'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll', 'theyre',
    'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
    'very', 'was', 'wasn', 'wasnt', 'we', 'wed', 'well', 'were', 'werent',
    'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who',
    'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldn', 'wouldnt',
    'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself',
    'yourselves', 'explain', 'describe', 'tell', 'show', 'give', 'please'
  ]);

  /**
   * Tokenize and normalize search query into meaningful keywords
   * @param {string} query
   * @returns {Array<string>}
   */
  function extractKeywords(query) {
    if (!query || typeof query !== 'string') return [];

    // Match words of 2 or more alphanumeric characters
    const rawWords = query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const filtered = rawWords.filter((w) => w.length >= 2 && !STOPWORDS.has(w));

    // If all words were stopwords, fallback to non-empty raw words of length >= 2
    return filtered.length > 0 ? filtered : rawWords.filter((w) => w.length >= 2);
  }

  /**
   * Escape special regex characters
   */
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Search DocumentChunks by keywords using MongoDB text search with regex fallback
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {Array<string>} [options.departmentIds] - Optional department IDs to restrict search
   * @param {string} [options.documentId] - Optional specific document ID filter
   * @param {number} [options.limit=25] - Maximum candidates to return
   * @returns {Promise<Array<Object>>} Ranked keyword candidates
   */
  async function searchKeywords(query, options = {}) {
    const { departmentIds = null, documentId = null, limit = 25 } = options;

    const keywords = extractKeywords(query);
    if (keywords.length === 0) {
      return [];
    }

    // 1. Build base filter for department & document isolation
    const baseFilter = {};

    if (departmentIds && Array.isArray(departmentIds) && departmentIds.length > 0) {
      const validDepts = departmentIds
        .map((d) => (d && d._id ? d._id.toString() : d.toString()))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validDepts.length > 0) {
        baseFilter.departmentIds = { $in: validDepts };
      }
    }

    if (documentId && mongoose.Types.ObjectId.isValid(documentId)) {
      baseFilter.documentId = new mongoose.Types.ObjectId(documentId);
    }

    const cleanSearchPhrase = keywords.join(' ');
    let results = [];

    // 2. Primary: MongoDB Native Text Search ($text with textScore)
    try {
      results = await DocumentChunk.find(
        {
          ...baseFilter,
          $text: { $search: cleanSearchPhrase }
        },
        {
          score: { $meta: 'textScore' },
          content: 1,
          documentId: 1,
          departmentIds: 1,
          chunkIndex: 1,
          metadata: 1
        }
      )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();
    } catch (textIndexErr) {
      // If text index is not yet built or returns error, proceed to fallback
      results = [];
    }

    // 3. Fallback / Enhancement: Regex Token Frequency Search
    // If MongoDB $text returns 0 results (e.g. specialized terminology, unindexed terms),
    // use regex pattern matching with keyword frequency scoring
    if (!results || results.length === 0) {
      const regexConditions = keywords.map((token) => ({
        content: { $regex: escapeRegex(token), $options: 'i' }
      }));

      if (regexConditions.length > 0) {
        const candidates = await DocumentChunk.find({
          ...baseFilter,
          $or: regexConditions
        })
          .select('content documentId departmentIds chunkIndex metadata')
          .limit(limit * 2)
          .lean();

        // Compute keyword term frequency score
        const scoredCandidates = candidates.map((chunk) => {
          let score = 0;
          const textLower = (chunk.content || '').toLowerCase();

          for (const token of keywords) {
            const tLower = token.toLowerCase();
            const regex = new RegExp(`\\b${escapeRegex(tLower)}`, 'gi');
            const matches = textLower.match(regex);
            if (matches) {
              score += matches.length * 1.5;
            } else if (textLower.includes(tLower)) {
              score += 0.8;
            }
          }

          return {
            ...chunk,
            score
          };
        });

        scoredCandidates.sort((a, b) => b.score - a.score);
        results = scoredCandidates.slice(0, limit);
      }
    }

    // 4. Normalize and format return candidate structure
    return results.map((item) => ({
      chunkId: item._id.toString(),
      documentId: (item.documentId?._id || item.documentId).toString(),
      score: typeof item.score === 'number' ? item.score : 1.0,
      metadata: item.metadata || {},
      content: item.content || '',
      departmentIds: (item.departmentIds || []).map((d) => (d._id || d).toString())
    }));
  }

  module.exports = {
    searchKeywords,
    extractKeywords
  };
