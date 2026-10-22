const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const { parseOffice } = require('officeparser');

/**
 * Robustly and safely extract plain text from any parser result or AST structure.
 * Handles strings, Buffers, officeparser v8 ASTs, arrays, and structured objects.
 */
async function extractTextFromParserResult(raw) {
  if (!raw) return '';

  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8').trim();
  }

  // officeparser v8+ returns an OfficeDocument AST with .to('text') method
  if (typeof raw.to === 'function') {
    try {
      const output = await raw.to('text');
      if (typeof output === 'string') {
        return output.trim();
      }
      if (output && typeof output.value === 'string') {
        return output.value.trim();
      }
    } catch (err) {
      console.warn('[ParserService] raw.to("text") failed, falling back to AST traversal:', err.message);
    }
  }

  if (typeof raw.value === 'string') {
    return raw.value.trim();
  }

  if (typeof raw.text === 'string') {
    return raw.text.trim();
  }

  // Handle AST nodes with children (e.g. officeparser content array or node tree)
  if (Array.isArray(raw.content)) {
    const parts = [];
    for (const node of raw.content) {
      const part = await extractTextFromParserResult(node);
      if (part) parts.push(part);
    }
    return parts.join('\n\n').trim();
  }

  if (Array.isArray(raw.children)) {
    const parts = [];
    for (const child of raw.children) {
      const part = await extractTextFromParserResult(child);
      if (part) parts.push(part);
    }
    return parts.join('\n').trim();
  }

  if (Array.isArray(raw)) {
    const parts = [];
    for (const item of raw) {
      const part = await extractTextFromParserResult(item);
      if (part) parts.push(part);
    }
    return parts.join('\n\n').trim();
  }

  return '';
}

/**
 * Universal document parser
 * Extracts structured text and rich metadata across:
 * PDF, DOC, DOCX, CSV, XLS, XLSX, TXT, PPT, PPTX
 */
async function parseDocument(filePath, originalFilename) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found on disk: ${filePath}`);
  }

  const ext = path.extname(originalFilename || filePath).toLowerCase();
  const stats = fs.statSync(filePath);

  if (stats.size === 0) {
    throw new Error('File is empty (0 bytes)');
  }

  let text = '';
  let metadata = {
    pageCount: 0,
    slideCount: 0,
    sheetNames: [],
    rowCount: 0,
    pages: [],
    slides: []
  };

  switch (ext) {
    case '.pdf': {
      const buffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      text = await extractTextFromParserResult(result?.text || result);
      metadata.pageCount = result?.total || (Array.isArray(result?.pages) ? result.pages.length : 1);
      if (Array.isArray(result?.pages)) {
        metadata.pages = result.pages.map((p, idx) => ({
          pageNumber: idx + 1,
          text: (typeof p?.text === 'string' ? p.text : '').trim()
        }));
      }
      break;
    }

    case '.docx': {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        text = await extractTextFromParserResult(result);
        if (!text) {
          const officeRes = await parseOffice(filePath);
          text = await extractTextFromParserResult(officeRes);
        }
      } catch (err) {
        try {
          const officeRes = await parseOffice(filePath);
          text = await extractTextFromParserResult(officeRes);
        } catch (officeErr) {
          throw new Error(`Failed to parse DOCX: ${err.message}`);
        }
      }
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      metadata.pageCount = Math.max(1, Math.ceil(words / 400));
      break;
    }

    case '.doc': {
      try {
        const officeRes = await parseOffice(filePath);
        text = await extractTextFromParserResult(officeRes);
      } catch (err) {
        // Fallback reading buffer for legacy .doc
        const raw = fs.readFileSync(filePath, 'binary');
        text = raw.replace(/[^\x20-\x7E\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
      }
      const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
      metadata.pageCount = Math.max(1, Math.ceil(words / 400));
      break;
    }

    case '.xlsx':
    case '.xls':
    case '.csv': {
      const workbook = xlsx.readFile(filePath);
      metadata.sheetNames = workbook.SheetNames || [];
      let combined = [];
      let totalRows = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csvContent = xlsx.utils.sheet_to_csv(sheet);
        const rows = csvContent.split('\n').filter((r) => r.trim().length > 0);
        totalRows += rows.length;
        combined.push(`--- Sheet: ${sheetName} (${rows.length} rows) ---\n${csvContent}`);
      }

      text = combined.join('\n\n').trim();
      metadata.rowCount = totalRows;
      metadata.pageCount = workbook.SheetNames.length;
      break;
    }

    case '.ppt':
    case '.pptx': {
      const officeRes = await parseOffice(filePath);
      text = await extractTextFromParserResult(officeRes);

      // Extract slide breakdowns if structured AST is available
      const slides = [];
      if (officeRes && Array.isArray(officeRes.content)) {
        for (let i = 0; i < officeRes.content.length; i++) {
          const node = officeRes.content[i];
          if (node && (node.type === 'slide' || Array.isArray(node.children))) {
            const slideNum = node.metadata?.slideNumber || i + 1;
            const slideText = await extractTextFromParserResult(node);
            if (slideText) {
              slides.push({
                slideNumber: slideNum,
                text: slideText
              });
            }
          }
        }
      }

      if (slides.length > 0) {
        metadata.slides = slides;
        metadata.slideCount = slides.length;
      } else {
        // Fallback regex detection on raw text if AST slides were not structured
        const slideMatches = text.split(/\n(?=(?:Slide|SLIDE)\s*\d+)/i);
        metadata.slideCount = Math.max(1, slideMatches.length);
      }
      metadata.pageCount = metadata.slideCount;
      break;
    }

    case '.txt': {
      text = (await fs.promises.readFile(filePath, 'utf8')).trim();
      const lines = text.split('\n');
      metadata.rowCount = lines.length;
      metadata.pageCount = Math.max(1, Math.ceil(lines.length / 50));
      break;
    }

    default:
      throw new Error(`Unsupported document extension: ${ext}`);
  }

  // Final validation and safety check
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('No readable text could be extracted from the document');
  }

  return {
    text: text.trim(),
    metadata
  };
}

module.exports = {
  parseDocument,
  extractTextFromParserResult
};
