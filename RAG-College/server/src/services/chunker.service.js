/**
 * Intelligent Document Chunker
 * Chunks documents to 600-800 characters with ~100 characters overlap
 * Preserves page numbers, slide numbers, sheet names, and rows
 * Chunks always start and end on whole words (no words cut in the middle)
 */

const TARGET_CHUNK_SIZE = 700;
const OVERLAP_SIZE = 100;

const isSpace = (ch) => /\s/.test(ch);

// Move an index forward to the start of the next whole word.
function snapToWordStart(text, index) {
  if (index <= 0 || index >= text.length || isSpace(text[index - 1])) return index;
  while (index < text.length && !isSpace(text[index])) index++;
  while (index < text.length && isSpace(text[index])) index++;
  return index;
}

// Move an index back so a chunk never ends in the middle of a word.
function snapToWordEnd(text, index, minIndex) {
  if (index >= text.length || isSpace(text[index]) || isSpace(text[index - 1])) return index;
  let i = index;
  while (i > minIndex && !isSpace(text[i - 1])) i--;
  return i > minIndex ? i : index;
}

function splitTextIntoChunks(rawText, baseMetadata = {}) {
  const text = typeof rawText === 'string' ? rawText.trim() : (rawText != null ? String(rawText).trim() : '');
  if (!text || text.length === 0) return [];

  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + TARGET_CHUNK_SIZE;

    if (endIndex < text.length) {
      // Find a clean break point (newline, period, or space)
      const lastNewline = text.lastIndexOf('\n', endIndex);
      const lastPeriod = text.lastIndexOf('. ', endIndex);
      const lastSpace = text.lastIndexOf(' ', endIndex);

      if (lastNewline > startIndex + TARGET_CHUNK_SIZE * 0.6) {
        endIndex = lastNewline + 1;
      } else if (lastPeriod > startIndex + TARGET_CHUNK_SIZE * 0.6) {
        endIndex = lastPeriod + 1;
      } else if (lastSpace > startIndex + TARGET_CHUNK_SIZE * 0.6) {
        endIndex = lastSpace + 1;
      }

      // No clean break found: never cut a word in half.
      endIndex = snapToWordEnd(text, endIndex, startIndex + 1);
    } else {
      endIndex = text.length;
    }

    const chunkContent = text.slice(startIndex, endIndex).trim();
    if (chunkContent.length > 20) {
      chunks.push({
        content: chunkContent,
        metadata: { ...(baseMetadata && typeof baseMetadata === 'object' ? baseMetadata : {}) }
      });
    }

    if (endIndex >= text.length) break;

    // Next chunk starts ~OVERLAP_SIZE characters back, moved forward to a whole word.
    const nextStart = snapToWordStart(text, endIndex - OVERLAP_SIZE);
    startIndex = Math.max(startIndex + 1, Math.min(nextStart, endIndex));
  }

  return chunks;
}

/**
 * Main chunking dispatcher respecting document types
 */
function chunkDocument(parsedData, originalFilename) {
  if (!parsedData || typeof parsedData !== 'object') {
    throw new Error('Invalid parsed document data provided to chunker');
  }

  const text = typeof parsedData.text === 'string' ? parsedData.text : (parsedData.text != null ? String(parsedData.text) : '');
  const metadata = parsedData.metadata && typeof parsedData.metadata === 'object' ? parsedData.metadata : {};
  const chunks = [];

  // 1. PDF with page breakdowns
  if (Array.isArray(metadata.pages) && metadata.pages.length > 0) {
    for (const page of metadata.pages) {
      const pageText = typeof page?.text === 'string' ? page.text : '';
      if (!pageText.trim()) continue;
      const pageChunks = splitTextIntoChunks(pageText, {
        sourceFilename: originalFilename,
        pageNumber: page.pageNumber
      });
      chunks.push(...pageChunks);
    }
    if (chunks.length > 0) return chunks;
  }

  // 2. Presentations with slide breakdowns
  if (Array.isArray(metadata.slides) && metadata.slides.length > 0) {
    for (const slide of metadata.slides) {
      const slideText = typeof slide?.text === 'string' ? slide.text : '';
      if (!slideText.trim()) continue;
      const slideChunks = splitTextIntoChunks(slideText, {
        sourceFilename: originalFilename,
        slideNumber: slide.slideNumber,
        pageNumber: slide.slideNumber
      });
      chunks.push(...slideChunks);
    }
    if (chunks.length > 0) return chunks;
  }

  // 3. Spreadsheets with sheet breakdowns
  if (Array.isArray(metadata.sheetNames) && metadata.sheetNames.length > 0) {
    const sheetSections = text.split(/--- Sheet:\s+/);
    for (const section of sheetSections) {
      if (!section || typeof section !== 'string' || !section.trim()) continue;
      const sheetNameMatch = section.match(/^([^\n(]+)/);
      const sheetName = sheetNameMatch ? sheetNameMatch[1].trim() : metadata.sheetNames[0];

      const sheetChunks = splitTextIntoChunks(section, {
        sourceFilename: originalFilename,
        sheetName
      });
      chunks.push(...sheetChunks);
    }
    if (chunks.length > 0) return chunks;
  }

  // 4. Fallback: Generic text chunking
  return splitTextIntoChunks(text, {
    sourceFilename: originalFilename,
    pageNumber: metadata.pageCount || 1,
    slideNumber: metadata.slideCount || null
  });
}

module.exports = {
  chunkDocument,
  splitTextIntoChunks,
  TARGET_CHUNK_SIZE,
  OVERLAP_SIZE
};