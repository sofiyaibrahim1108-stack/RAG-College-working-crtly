const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const IMAGES_BASE_DIR = path.resolve(__dirname, '../../data/images');

// Complex shape threshold: increased to 8 to ignore 4-corner rounded cards
const MIN_COMPLEX_PATHS = parseInt(process.env.DIAGRAM_MIN_COMPLEX_PATHS, 10) || 8;
const GEOMETRY_EPSILON = 0.5;

/**
 * Detects whether page text is code syntax rather than diagram prose/captions
 */
function isCodeContent(text) {
  if (!text) return false;
  const patterns = [
    /\bconst\s+/i,
    /\blet\s+/i,
    /\bvar\s+/i,
    /return\s*[\(\{]/i,
    /\bimport\s+.*from/i,
    /\bexport\s+/i,
    /\bfunction\s*\w*\(/i,
    /\.safeParse\(/i,
    /extraReducers:/i,
    /router\.(get|post|put|delete|use)\(/i,
    /app\.(use|get|post)\(/i,
    /=>\s*\{?/,
    /module\.exports\s*=/i,
    /require\(['"][^'"]+['"]\)/i
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * Walks the vector drawing operations of a page and counts:
 *  - complexPaths: paths with curves or diagonal segments
 *  - simplePaths: axis-aligned rectangles / straight horizontal-vertical lines
 */
function analyzePageGraphics(mupdf, page) {
  const stats = { complexPaths: 0, simplePaths: 0 };

  const classify = (pathObj) => {
    let hasCurve = false;
    let hasDiagonal = false;
    let lastX = null;
    let lastY = null;

    pathObj.walk({
      moveTo(x, y) {
        lastX = x;
        lastY = y;
      },
      lineTo(x, y) {
        if (
          lastX !== null &&
          Math.abs(x - lastX) > GEOMETRY_EPSILON &&
          Math.abs(y - lastY) > GEOMETRY_EPSILON
        ) {
          hasDiagonal = true;
        }
        lastX = x;
        lastY = y;
      },
      curveTo(x1, y1, x2, y2, x3, y3) {
        hasCurve = true;
        lastX = x3;
        lastY = y3;
      },
      closePath() {}
    });

    if (hasCurve || hasDiagonal) stats.complexPaths++;
    else stats.simplePaths++;
  };

  const device = new mupdf.Device({
    fillPath(p) {
      classify(p);
    },
    strokePath(p) {
      classify(p);
    }
  });

  try {
    page.run(device, mupdf.Matrix.identity);
  } finally {
    if (typeof device.close === 'function') device.close();
  }

  return stats;
}

async function extractDocumentImages(filePath, originalFilename, docId) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found for image extraction: ${filePath}`);
  }

  const effectiveName = originalFilename || filePath;
  const ext = path.extname(effectiveName).toLowerCase();
  const docDir = path.join(IMAGES_BASE_DIR, docId.toString());

  if (!fs.existsSync(docDir)) {
    fs.mkdirSync(docDir, { recursive: true });
  }

  const extractedImages = [];

  switch (ext) {
    case '.pdf': {
      try {
        const buffer = fs.readFileSync(filePath);
        let globalIdx = 0;

        // 1. Extract embedded raster photos via pdf-parse
        const dominantRasterPages = new Set();
        try {
          const { PDFParse } = require('pdf-parse');
          const parser = new PDFParse({ data: buffer });
          const imgResult = await parser.getImage({ imageBuffer: true });

          if (imgResult && Array.isArray(imgResult.pages)) {
            for (const page of imgResult.pages) {
              const pageNum = page.pageNumber || 1;
              const imagesOnPage = page.images || [];

              for (const img of imagesOnPage) {
                if (!img.data || img.data.length < 2048) continue;

                if (img.data.length > 40000) {
                  dominantRasterPages.add(pageNum);
                }

                globalIdx++;
                const imageFilename = `img_p${pageNum}_${globalIdx}.png`;
                const targetPath = path.join(docDir, imageFilename);

                fs.writeFileSync(targetPath, Buffer.from(img.data));

                extractedImages.push({
                  imagePath: targetPath,
                  filePath: targetPath,
                  originalFilename: effectiveName,
                  imageFilename,
                  mimeType: 'image/png',
                  pageNumber: pageNum,
                  slideNumber: null,
                  sheetName: null,
                  width: img.width || null,
                  height: img.height || null,
                  caption: `Figure from ${effectiveName} (Page ${pageNum})`,
                  surroundingText: `Page ${pageNum} figure`
                });
              }
            }
          }
        } catch (rasterErr) {
          console.warn('[ImageExtractor] Raster extraction note:', rasterErr.message);
        }

        // 2. MuPDF vector diagram detection
        try {
          const mupdfLib = await import('mupdf');
          const mupdf = mupdfLib.default || mupdfLib;

          const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
          const totalPages = doc.countPages();

          const pageProfiles = [];
          for (let i = 0; i < totalPages; i++) {
            const pageNum = i + 1;
            const page = doc.loadPage(i);
            let text = '';
            let title = '';

            try {
              const structured = page.toStructuredText();
              text = structured ? structured.asText().trim() : '';
              const lines = text
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 2 && !/^\d+$/.test(l));

              if (lines.length > 0) {
                title = lines[0].slice(0, 100);
              }
            } catch (tErr) {
              text = '';
            }

            pageProfiles.push({
              pageIndex: i,
              pageNum,
              charCount: text.length,
              text,
              title,
              page
            });
          }

          // Dynamic density calculation: prose pages vs diagram pages
          const populatedCounts = pageProfiles
            .map((p) => p.charCount)
            .filter((c) => c > 50)
            .sort((a, b) => a - b);

          let dynamicMedian = 1500;
          if (populatedCounts.length > 0) {
            const mid = Math.floor(populatedCounts.length / 2);
            dynamicMedian =
              populatedCounts.length % 2 !== 0
                ? populatedCounts[mid]
                : Math.round((populatedCounts[mid - 1] + populatedCounts[mid]) / 2);
          }

          const dynamicDiagramCeiling = Math.max(500, Math.round(dynamicMedian * 0.5));

          for (const profile of pageProfiles) {
            if (dominantRasterPages.has(profile.pageNum)) continue;

            // Reject pages dominated by code snippets
            if (isCodeContent(profile.text)) {
              continue;
            }

            // Stage 1: cheap text-density pre-filter
            const isLowTextPage =
              profile.charCount >= 15 &&
              profile.charCount <= dynamicDiagramCeiling;

            if (!isLowTextPage) continue;

            // Stage 2: geometry check
            let stats;
            try {
              stats = analyzePageGraphics(mupdf, profile.page);
            } catch (gErr) {
              console.warn(`[ImageExtractor] Could not analyze graphics on page ${profile.pageNum}, skipping:`, gErr.message);
              continue;
            }

            if (stats.complexPaths < MIN_COMPLEX_PATHS) {
              console.log(
                `[ImageExtractor] Skipped page ${profile.pageNum}: not a diagram (complex shapes: ${stats.complexPaths}, simple shapes: ${stats.simplePaths})`
              );
              continue;
            }

            try {
              const pixmap = profile.page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false);
              const pngBuffer = pixmap.asPNG();

              globalIdx++;
              const imageFilename = `img_render_p${profile.pageNum}_${globalIdx}.png`;
              const targetPath = path.join(docDir, imageFilename);

              fs.writeFileSync(targetPath, Buffer.from(pngBuffer));

              const captionText = profile.title || `Diagram from Page ${profile.pageNum}`;

              extractedImages.push({
                imagePath: targetPath,
                filePath: targetPath,
                originalFilename: effectiveName,
                imageFilename,
                mimeType: 'image/png',
                pageNumber: profile.pageNum,
                slideNumber: null,
                sheetName: null,
                width: pixmap.getWidth(),
                height: pixmap.getHeight(),
                caption: `${captionText} from ${effectiveName} (Page ${profile.pageNum})`,
                surroundingText: `Page ${profile.pageNum}: ${captionText}`
              });

              console.log(
                `[ImageExtractor] Captured vector diagram: Page ${profile.pageNum} ("${captionText}") [${profile.charCount} chars, complex shapes: ${stats.complexPaths}]`
              );
            } catch (renderErr) {
              console.warn(`[ImageExtractor] Failed to render page ${profile.pageNum}:`, renderErr.message);
            }
          }
        } catch (muErr) {
          console.error('[ImageExtractor] MuPDF dynamic processing error:', muErr.message);
        }
      } catch (pdfErr) {
        console.warn(`[ImageExtractor] PDF processing error:`, pdfErr.message);
      }
      break;
    }

    case '.docx': {
      try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        let idx = 0;

        for (const entry of entries) {
          if (entry.entryName.startsWith('word/media/') && !entry.isDirectory) {
            const entryExt = path.extname(entry.entryName).toLowerCase() || '.png';
            if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(entryExt)) {
              idx++;
              const imageFilename = `img_docx_${idx}${entryExt}`;
              const targetPath = path.join(docDir, imageFilename);

              fs.writeFileSync(targetPath, entry.getData());

              extractedImages.push({
                imagePath: targetPath,
                filePath: targetPath,
                originalFilename: effectiveName,
                imageFilename,
                mimeType: entryExt === '.jpg' || entryExt === '.jpeg' ? 'image/jpeg' : 'image/png',
                pageNumber: Math.max(1, Math.ceil(idx / 2)),
                slideNumber: null,
                sheetName: null,
                width: null,
                height: null,
                caption: `Embedded image ${idx} from ${effectiveName}`,
                surroundingText: `Document figure ${idx}`
              });
            }
          }
        }
      } catch (docxErr) {
        console.warn(`[ImageExtractor] DOCX processing error:`, docxErr.message);
      }
      break;
    }

    case '.pptx': {
      try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();

        const mediaToSlideMap = new Map();
        const slideRelsRegex = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/i;

        for (const entry of entries) {
          const match = entry.entryName.match(slideRelsRegex);
          if (match) {
            const slideNum = parseInt(match[1], 10);
            const relsXml = entry.getData().toString('utf8');
            const targetMatches = relsXml.matchAll(/Target="(?:\.\.\/)*media\/([^"]+)"/g);
            for (const tm of targetMatches) {
              const targetName = path.basename(tm[1]).toLowerCase();
              mediaToSlideMap.set(targetName, slideNum);
            }
          }
        }

        const slideTitleMap = new Map();
        const slideXmlRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

        for (const entry of entries) {
          const match = entry.entryName.match(slideXmlRegex);
          if (match) {
            const slideNum = parseInt(match[1], 10);
            const xmlContent = entry.getData().toString('utf8');
            const textMatches = Array.from(xmlContent.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g))
              .map((m) => m[1].trim())
              .filter(Boolean);

            if (textMatches.length > 0) {
              slideTitleMap.set(slideNum, textMatches.slice(0, 4).join(' '));
            }
          }
        }

        let imgIdx = 0;
        for (const entry of entries) {
          if (entry.entryName.startsWith('ppt/media/') && !entry.isDirectory) {
            const entryExt = path.extname(entry.entryName).toLowerCase() || '.png';
            if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(entryExt)) {
              imgIdx++;
              const rawFilename = path.basename(entry.entryName).toLowerCase();
              const targetSlideNum = mediaToSlideMap.get(rawFilename) || null;
              const slideTitle = targetSlideNum ? slideTitleMap.get(targetSlideNum) : null;

              const imageFilename = `img_slide_${imgIdx}${entryExt}`;
              const targetPath = path.join(docDir, imageFilename);

              fs.writeFileSync(targetPath, entry.getData());

              let captionText = '';
              if (slideTitle && targetSlideNum) {
                captionText = `${slideTitle} from ${effectiveName} (Slide ${targetSlideNum})`;
              } else if (targetSlideNum) {
                captionText = `Slide diagram from ${effectiveName} (Slide ${targetSlideNum})`;
              } else {
                captionText = `Slide diagram from ${effectiveName}`;
              }

              extractedImages.push({
                imagePath: targetPath,
                filePath: targetPath,
                originalFilename: effectiveName,
                imageFilename,
                mimeType: entryExt === '.jpg' || entryExt === '.jpeg' ? 'image/jpeg' : 'image/png',
                pageNumber: null,
                slideNumber: targetSlideNum,
                sheetName: null,
                width: null,
                height: null,
                caption: captionText,
                surroundingText: slideTitle ? `Slide ${targetSlideNum}: ${slideTitle}` : `Slide ${targetSlideNum || imgIdx} diagram`
              });
            }
          }
        }
      } catch (pptxErr) {
        console.warn(`[ImageExtractor] PPTX processing error:`, pptxErr.message);
      }
      break;
    }

    case '.xlsx': {
      try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        let idx = 0;

        for (const entry of entries) {
          if (entry.entryName.startsWith('xl/media/') && !entry.isDirectory) {
            const entryExt = path.extname(entry.entryName).toLowerCase() || '.png';
            if (['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(entryExt)) {
              idx++;
              const imageFilename = `img_sheet_${idx}${entryExt}`;
              const targetPath = path.join(docDir, imageFilename);

              fs.writeFileSync(targetPath, entry.getData());

              extractedImages.push({
                imagePath: targetPath,
                filePath: targetPath,
                originalFilename: effectiveName,
                imageFilename,
                mimeType: entryExt === '.jpg' || entryExt === '.jpeg' ? 'image/jpeg' : 'image/png',
                pageNumber: null,
                slideNumber: null,
                sheetName: 'Sheet 1',
                width: null,
                height: null,
                caption: `Chart/Image ${idx} from spreadsheet ${effectiveName}`,
                surroundingText: `Spreadsheet figure ${idx}`
              });
            }
          }
        }
      } catch (xlsxErr) {
        console.warn(`[ImageExtractor] XLSX processing error:`, xlsxErr.message);
      }
      break;
    }

    default:
      break;
  }

  console.log(`[ImageExtractor] Extracted ${extractedImages.length} images from "${effectiveName}" (${ext})`);
  return extractedImages;
}

function removeExtractedImages(docId) {
  const docDir = path.join(IMAGES_BASE_DIR, docId.toString());
  if (fs.existsSync(docDir)) {
    try {
      fs.rmSync(docDir, { recursive: true, force: true });
      console.log(`[ImageExtractor] Cleaned up directory: ${docDir}`);
    } catch (err) {
      console.warn(`[ImageExtractor] Cleanup failure:`, err.message);
    }
  }
}

module.exports = {
  extractDocumentImages,
  removeExtractedImages,
  IMAGES_BASE_DIR
};