import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  ImageIcon,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  GraduationCap,
  ExternalLink,
  Pencil,
  X,
  AlertCircle,
  Sparkles
} from 'lucide-react';
import { GoogleDriveIcon } from './Icons';


/**
 * Process text nodes to render citation badges [1], [2], highlight ==...==,
 * and inline markdown images ![alt](url) that ReactMarkdown doesn't handle.
 */
function processTextNode(text, onCitationClick) {
  if (!text || typeof text !== 'string') return text;

  // Split by highlight (==...==), citation markers ([1], [2], [1, 2]), and images (![alt](url))
  const tokens = text.split(/(==.*?==|\[\d+(?:,\s*\d+)*\]|!\[.*?\]\(.*?\))/g);

  const hasSpecialTokens = tokens.some(
    (tok) =>
      (tok.startsWith('==') && tok.endsWith('==') && tok.length >= 4) ||
      /^\[\d+(?:,\s*\d+)*\]$/.test(tok) ||
      /^!\[.*?\]\(.*?\)$/.test(tok)
  );

  if (!hasSpecialTokens) return text;

  return tokens.map((tok, idx) => {
    // Subtle wine highlight (==...==)
    if (tok.startsWith('==') && tok.endsWith('==') && tok.length >= 4) {
      return (
        <mark key={idx} className="markdown-mark">
          {tok.slice(2, -2)}
        </mark>
      );
    }
    // Inline citation marker (e.g. [1], [2])
    const citMatch = tok.match(/^\[(\d+)\]$/);
    if (citMatch) {
      const citNum = parseInt(citMatch[1], 10);
      return (
        <span
          key={idx}
          className="citation-ref-badge clickable"
          title={`Click to view Source [${citNum}]`}
          onClick={(e) => {
            e.stopPropagation();
            if (onCitationClick) onCitationClick(citNum);
          }}
        >
          {tok}
        </span>
      );
    }
    // Multi-citation marker (e.g. [1, 2])
    if (/^\[\d+(?:,\s*\d+)*\]$/.test(tok)) {
      return (
        <span key={idx} className="citation-ref-badge" title={`Citation ${tok}`}>
          {tok}
        </span>
      );
    }
    // Inline markdown image: ![alt](url)
    const imgMatch = tok.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch) {
      const altText = imgMatch[1];
      const imgSrc = imgMatch[2];
      return (
        <span key={idx} className="message-inline-image-wrapper">
          <img
            src={imgSrc}
            alt={altText || 'Image diagram'}
            className="message-inline-image"
            onClick={() => window.open(imgSrc, '_blank', 'noopener,noreferrer')}
            title={`Click to open full resolution: ${altText || 'Image'}`}
          />
          {altText && <span className="message-inline-image-caption">{altText}</span>}
        </span>
      );
    }
    return tok;
  });
}

/**
 * Recursively walk React children and process text nodes
 * to render citation badges and highlights.
 */
function processChildren(children, onCitationClick) {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return processTextNode(child, onCitationClick);
    }
    if (React.isValidElement(child) && child.props.children) {
      return React.cloneElement(child, {}, processChildren(child.props.children, onCitationClick));
    }
    return child;
  });
}

/**
 * Build ReactMarkdown component overrides that map to our existing CSS classes
 * and inject citation/highlight processing into text content.
 */
function getMarkdownComponents(onCitationClick) {
  return {
    p: ({ children }) => (
      <p className="markdown-p">{processChildren(children, onCitationClick)}</p>
    ),
    h1: ({ children }) => (
      <h1 className="markdown-h1">{processChildren(children, onCitationClick)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="markdown-h2">{processChildren(children, onCitationClick)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="markdown-h3">{processChildren(children, onCitationClick)}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="markdown-h4">{processChildren(children, onCitationClick)}</h4>
    ),
    h5: ({ children }) => (
      <h4 className="markdown-h4">{processChildren(children, onCitationClick)}</h4>
    ),
    h6: ({ children }) => (
      <h4 className="markdown-h4">{processChildren(children, onCitationClick)}</h4>
    ),
    ul: ({ children }) => <ul className="markdown-ul">{children}</ul>,
    ol: ({ children, start, ...props }) => (
      <ol className="markdown-ol" start={start} {...props}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="markdown-li">
        <div className="markdown-li-content">
          {processChildren(children, onCitationClick)}
        </div>
      </li>
    ),
    strong: ({ children }) => (
      <strong className="markdown-bold">{processChildren(children, onCitationClick)}</strong>
    ),
    em: ({ children }) => <em>{processChildren(children, onCitationClick)}</em>,
    code: ({ className, children, ...props }) => {
      // Fenced code block (rendered inside <pre> by ReactMarkdown)
      const isInline = !className;
      if (isInline) {
        return <code className="markdown-inline-code" {...props}>{children}</code>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    pre: ({ children }) => {
      // Extract language from the code child's className (e.g. "language-js")
      const codeChild = React.Children.toArray(children).find(
        (c) => React.isValidElement(c) && c.type === 'code'
      );
      const langClass = codeChild?.props?.className || '';
      const langMatch = langClass.match(/language-(\w+)/);
      const language = langMatch ? langMatch[1] : '';

      return (
        <div className="markdown-code-block">
          {language && <div className="code-lang-tag">{language}</div>}
          <pre>{children}</pre>
        </div>
      );
    },
    table: ({ children }) => (
      <div className="markdown-table-wrapper">
        <table className="markdown-table">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th>{processChildren(children, onCitationClick)}</th>
    ),
    td: ({ children }) => (
      <td>{processChildren(children, onCitationClick)}</td>
    ),
    mark: ({ children }) => (
      <mark className="markdown-mark">{children}</mark>
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
        {children}
      </a>
    ),
    hr: () => <hr className="markdown-hr" />,
    blockquote: ({ children }) => (
      <blockquote className="markdown-blockquote">{children}</blockquote>
    ),
  };
}

/**
 * Normalizes raw LLM Markdown output for ReactMarkdown + remarkGfm:
 * 1. Fenced code blocks: Ensures opening and closing code fences (```) are on their own lines
 *    with proper separation from surrounding prose, and moves inline code on fence lines to new lines.
 * 2. Headings: Ensures ATX headings (#, ##, ###) start on a new line and are separated from
 *    following text/list items so they don't merge into surrounding paragraphs or list items.
 * 3. Numbered & bullet lists: Ensures inline list items (e.g. "1. First... 2. Second...")
 *    start on clean new lines while preserving decimals (e.g. 3.14), inline code (`...`),
 *    and tight ordered list grouping.
 */
function normalizeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // 1. Separate code fences from surrounding text:
  result = result.replace(/([^\n])\s*(```[a-zA-Z0-9_-]*)/g, '$1\n\n$2');
  result = result.replace(/^([ \t]*```[a-zA-Z0-9_-]+)[ \t]+([^\r\n]+)$/gm, '$1\n$2');
  result = result.replace(/([^\n\s`])[ \t]+(```)[ \t]*$/gm, '$1\n$2');
  result = result.replace(/^([ \t]*```)[ \t]+([^\r\n]+)$/gm, '$1\n\n$2');

  const fenceCount = (result.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    result += '\n```';
  }

  // 2. Separate ATX headings (#, ##, ###)
  result = result.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2');
  result = result.replace(/^(#{1,6}\s+[^\r\n]+?)[ \t]+(\d+\.\s+)/gm, '$1\n\n$2');

  // 3. Process non-code chunks to normalize numbered lists:
  const parts = result.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let chunk = parts[i];

    chunk = chunk.replace(/([^\n])\s+(\d+\.\s+)/g, (match, p1, p2) => {
      return p1 + '\n\n' + p2;
    });

    chunk = chunk.replace(/(\d+\.[^\n]*?)\n\s*\n(?=\s*\d+\.\s+)/g, '$1\n');

    parts[i] = chunk;
  }
  result = parts.join('');

  return result;
}
function MarkdownRenderer({ content, onCitationClick }) {
  if (!content) return null;

  const normalizedContent = normalizeMarkdown(content);

  return (
    <div className="prose-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={getMarkdownComponents(onCitationClick)}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}

export default function MessageItem({
  message,
  onRegenerate,
  onEdit,
  onToast,
  onSendQuery,
  handleSendMessage,
  isRegenerating = false
}) {
  const [copied, setCopied] = useState(false);
  const [userCopied, setUserCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [activeCitationPreview, setActiveCitationPreview] = useState(null);

  const isUser = message.role === 'user';
  const isError = !isUser && Boolean(
    message.isError ||
    (message.id && String(message.id).startsWith('err-')) ||
    message.content === "Sorry, we couldn't generate your answer right now. Please try again later."
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    if (onToast) onToast('Copied answer to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyUserText = () => {
    navigator.clipboard.writeText(message.content);
    setUserCopied(true);
    if (onToast) onToast('Copied question to clipboard', 'success');
    setTimeout(() => setUserCopied(false), 2000);
  };

  const handleFeedback = (type) => {
    setFeedback((prev) => {
      const next = prev === type ? null : type;
      if (next && onToast) {
        onToast(next === 'like' ? 'Thanks for your feedback!' : 'Feedback recorded', 'success');
      }
      return next;
    });
  };

  // Open Document / Image / Google Drive relevant preview modal (NEVER open full doc directly)
  const handleOpenSource = (src) => {
    setActiveCitationPreview(src);
  };

  // Open complete file only if explicitly requested by user as a secondary action
  const handleOpenFullDocument = (src) => {
    // 1. Extracted Image / Diagram Source
    if (src.type === 'image' || src.imageId) {
      const imgId = src.imageId || src._id;
      if (imgId) {
        window.open(`http://localhost:5000/api/images/${imgId}/file`, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    // 2. Google Drive document with webViewLink
    const driveUrl = src.webViewLink || (src.documentId && src.documentId.driveMetadata?.webViewLink);
    if (src.source === 'google_drive' || driveUrl) {
      if (driveUrl) {
        window.open(driveUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    // 3. Local Document Source (PDF, TXT, CSV, DOCX, etc.)
    const docId = src.documentId?._id || src.documentId;
    if (docId) {
      const docFileUrl = `http://localhost:5000/api/documents/${docId}/file`;
      window.open(docFileUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    if (onToast) {
      onToast(`Unable to open full document for ${src.filename || src.label || 'this document'}`, 'error');
    }
  };

  // Handle inline citation click ([1], [2]): open relevant content preview modal
  const handleCitationClick = (citNum) => {
    const foundSource = (message.sources || []).find(
      (s) => s.citationIndex === citNum || s.citationMarker === `[${citNum}]`
    );

    if (foundSource) {
      setActiveCitationPreview(foundSource);
      return;
    }

    const cardEl = document.getElementById(`source-card-${citNum}`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      cardEl.classList.add('source-card-highlight');
      setTimeout(() => {
        cardEl.classList.remove('source-card-highlight');
      }, 1500);
    } else if (onToast) {
      onToast(`Source [${citNum}] details are listed below`, 'info');
    }
  };

  const imageSources = !isUser && message.sources
    ? message.sources.filter((s) => s.type === 'image' || s.imageId)
    : [];

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
        {!isUser && (
          <div className="assistant-identity">
            <div className="assistant-avatar-badge">
              <GraduationCap size={14} strokeWidth={2.4} />
            </div>
            <span className="assistant-title-text">Assistant</span>
          </div>
        )}

        {/* Message Content */}
        {isUser ? (
          <>
            <div className="message-user-text">{message.content}</div>
            <div className="user-actions-bar">
              <button
                type="button"
                className="btn-msg-action"
                onClick={handleCopyUserText}
                title="Copy question"
              >
                {userCopied ? <Check size={13} color="#15803D" /> : <Copy size={13} />}
                <span>{userCopied ? 'Copied' : 'Copy'}</span>
              </button>
              {onEdit && (
                <button
                  type="button"
                  className="btn-msg-action"
                  onClick={() => onEdit(message)}
                  title="Edit question"
                >
                  <Pencil size={13} />
                  <span>Edit</span>
                </button>
              )}
            </div>
          </>
        ) : isError ? (
          <div className="message-error-card" role="alert">
            <div className="message-error-icon-box">
              <AlertCircle size={18} className="message-error-icon" aria-hidden="true" />
            </div>
            <div className="message-error-body">
              <div className="message-error-title">Something went wrong</div>
              <p className="message-error-desc">
                Sorry, we couldn't generate your answer right now. Please try again later.
              </p>
              {onRegenerate && (
                <button
                  type="button"
                  className={`message-error-retry-btn ${isRegenerating ? 'loading' : ''}`}
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  title={isRegenerating ? 'Regenerating response...' : 'Try again'}
                >
                  <RotateCcw size={13} className={isRegenerating ? 'spin-icon' : ''} />
                  <span>{isRegenerating ? 'Retrying...' : 'Try again'}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="message-text-content">
            <MarkdownRenderer content={message.content} onCitationClick={handleCitationClick} />
            {isRegenerating && (
              <div className="regenerating-indicator">
                <span className="regenerating-dot" />
                <span>Regenerating response...</span>
              </div>
            )}
          </div>
        )}

        {/* Interactive Suggested Questions Pills */}
        {!isUser && !isError && message.suggestedQuestions && message.suggestedQuestions.length > 0 && (
          <div className="suggested-questions-container flex flex-wrap gap-2 mt-3">
            {message.suggestedQuestions.map((item, qIdx) => {
              const questionText = typeof item === 'string' ? item : (item?.question || item?.text || '');
              if (!questionText || !questionText.trim()) return null;
              const cleanText = questionText.trim();

              return (
                <button
                  key={qIdx}
                  type="button"
                  className="suggested-question-pill text-xs font-medium px-3.5 py-1.5 rounded-full border border-blue-500/30 bg-blue-50/60 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition shadow-sm cursor-pointer flex items-center gap-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    const sendFn = onSendQuery || handleSendMessage;
                    if (typeof sendFn === 'function') {
                      sendFn(cleanText);
                    }
                  }}
                  title={`Ask: "${cleanText}"`}
                >
                  <Sparkles size={13} className="shrink-0" aria-hidden="true" />
                  <span>{cleanText}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Attached Visual Diagrams / Screenshots (Rendered ABOVE normal citations row) */}
        {!isUser && !isError && imageSources.length > 0 && (
          <div className="message-attached-images">
            <div className="attached-images-heading">
              <ImageIcon size={14} className="image-source-heading-icon" />
              <span>Attached Diagrams &amp; Screenshots ({imageSources.length})</span>
            </div>
            <div className="attached-images-grid">
              {imageSources.map((imgSrc, imgIdx) => {
                const imgId = imgSrc.imageId || imgSrc._id;
                const fileUrl = `http://localhost:5000/api/images/${imgId}/file`;
                const citNum = imgSrc.citationIndex || (imgIdx + 1);

                return (
                  <div
                    key={imgIdx}
                    id={`attached-image-${citNum}`}
                    className="attached-image-card"
                    onClick={() => handleOpenSource(imgSrc)}
                    title={`Click to open full-resolution image: ${imgSrc.caption || imgSrc.filename}`}
                  >
                    <div className="attached-image-frame">
                      <img
                        src={fileUrl}
                        alt={imgSrc.caption || imgSrc.filename || 'Diagram'}
                        className="attached-image-thumbnail"
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                      <div className="attached-image-badge-chip">
                        <span>[{citNum}]</span>
                      </div>
                      <div className="attached-image-hover-action">
                        <ExternalLink size={13} color="#FFFFFF" />
                        <span>View Diagram</span>
                      </div>
                    </div>
                    <div className="attached-image-caption-row">
                      <span className="attached-image-caption-text">
                        {imgSrc.caption || imgSrc.filename}
                      </span>
                      <span className="attached-image-subtext">
                        {imgSrc.pageNumber ? `Page ${imgSrc.pageNumber}` : 'Diagram'}
                        {imgSrc.source === 'google_drive' || imgSrc.webViewLink ? ' • Google Drive' : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sources Section (Multimodal: Documents & Diagrams) */}
        {!isUser && !isError && message.sources && message.sources.length > 0 && (
          <div className="sources-container">
            <div className="sources-heading">
              Sources ({message.sources.length})
            </div>
            <div className="sources-cards-grid">
              {message.sources.map((src, idx) => {
                const isImage = src.type === 'image' || Boolean(src.imageId);
                const isDrive = src.source === 'google_drive' || Boolean(src.webViewLink);
                const citNum = src.citationIndex || (idx + 1);

                // Clean single-line document name without path clutter
                const rawFilename = src.filename || src.label || 'Document';
                const cleanFilename = rawFilename.split(/[/\\]/).pop();

                // Small metadata subtitle
                const pageNum = src.pageNumber || src.page;
                const sheetName = src.sheetName;
                const slideNum = src.slideNumber;

                let subtitle = '';
                if (isImage) {
                  const pageInfo = pageNum ? `Page ${pageNum}` : slideNum ? `Slide ${slideNum}` : '';
                  subtitle = pageInfo ? `Diagram • ${pageInfo}` : 'Diagram';
                } else {
                  if (pageNum) {
                    subtitle = `Page ${pageNum}`;
                  } else if (sheetName) {
                    subtitle = `Sheet ${sheetName}`;
                  } else if (slideNum) {
                    subtitle = `Slide ${slideNum}`;
                  } else {
                    subtitle = 'Document';
                  }
                }
                if (isDrive) {
                  subtitle += ' • Drive';
                }

                return (
                  <div
                    key={idx}
                    id={`source-card-${citNum}`}
                    className="source-card clickable"
                    onClick={() => handleOpenSource(src)}
                    title={`[${citNum}] ${cleanFilename} (${subtitle})`}
                  >
                    <span className="source-citation-num">
                      [{citNum}]
                    </span>

                    {isDrive ? (
                      <GoogleDriveIcon size={14} className="source-file-icon" />
                    ) : isImage ? (
                      <ImageIcon size={14} className="source-file-icon image-source" />
                    ) : (
                      <FileText size={14} className="source-file-icon" />
                    )}

                    <div className="source-details">
                      <span className="source-filename" title={cleanFilename}>
                        {cleanFilename}
                      </span>
                      <span className="source-subtext">
                        {subtitle}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Assistant Actions Bar (Copy, Regenerate, ThumbsUp, ThumbsDown) */}
        {!isUser && !isError && (
          <div className="assistant-actions-bar">
            <button
              type="button"
              className="btn-msg-action"
              onClick={handleCopy}
              title="Copy message"
            >
              {copied ? <Check size={14} color="#15803D" /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {onRegenerate && (
              <button
                type="button"
                className={`btn-msg-action ${isRegenerating ? 'loading' : ''}`}
                onClick={onRegenerate}
                disabled={isRegenerating}
                title={isRegenerating ? 'Regenerating response...' : 'Try again'}
              >
                <RotateCcw size={14} className={isRegenerating ? 'spin-icon' : ''} />
                <span>{isRegenerating ? 'Retrying...' : 'Try again'}</span>
              </button>
            )}

            <button
              type="button"
              className="btn-msg-action"
              style={{ color: feedback === 'like' ? '#15803D' : undefined }}
              onClick={() => handleFeedback('like')}
              title="Helpful"
            >
              <ThumbsUp size={14} />
            </button>

            <button
              type="button"
              className="btn-msg-action"
              style={{ color: feedback === 'dislike' ? '#B42318' : undefined }}
              onClick={() => handleFeedback('dislike')}
              title="Not helpful"
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        )}

        {/* Relevant Chunk/Diagram Preview Modal for Text/PDF/Image/Drive citations */}
        {activeCitationPreview && (
          <div className="modal-backdrop" onClick={() => setActiveCitationPreview(null)}>
            <div
              className="modal-container citation-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header-row">
                <div className="modal-header-text">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="source-citation-num">
                      [{activeCitationPreview.citationIndex}]
                    </span>
                    <h3 className="modal-header-title" style={{ fontSize: '1.05rem', margin: 0 }}>
                      Relevant Source Content
                    </h3>
                  </div>
                  <div
                    className="modal-header-subtitle"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      flexWrap: 'wrap',
                      marginTop: '4px'
                    }}
                  >
                    {activeCitationPreview.type === 'image' || activeCitationPreview.imageId ? (
                      <ImageIcon size={14} color="#C2185B" />
                    ) : activeCitationPreview.source === 'google_drive' || activeCitationPreview.webViewLink ? (
                      <GoogleDriveIcon size={14} />
                    ) : (
                      <FileText size={14} color="var(--primary)" />
                    )}
                    <strong style={{ color: 'var(--text)' }}>
                      {activeCitationPreview.filename || activeCitationPreview.label || 'Document'}
                    </strong>
                    {(activeCitationPreview.type === 'image' || activeCitationPreview.imageId) && (
                      <span className="diagram-tag" style={{ marginLeft: '2px' }}>[Diagram]</span>
                    )}
                    {activeCitationPreview.pageNumber && (
                      <span>• Page {activeCitationPreview.pageNumber}</span>
                    )}
                    {activeCitationPreview.sheetName && (
                      <span>• Sheet: {activeCitationPreview.sheetName}</span>
                    )}
                    {activeCitationPreview.slideNumber && (
                      <span>• Slide {activeCitationPreview.slideNumber}</span>
                    )}
                    {activeCitationPreview.source === 'google_drive' && (
                      <span>• Google Drive</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-modal-close-icon"
                  onClick={() => setActiveCitationPreview(null)}
                  title="Close preview"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="modal-content-body" style={{ padding: '18px 22px', maxHeight: '55vh', overflowY: 'auto' }}>
                {activeCitationPreview.type === 'image' || activeCitationPreview.imageId ? (
                  <div className="citation-image-preview-container">
                    <div className="citation-chunk-label" style={{ marginBottom: '10px' }}>
                      Relevant extracted diagram / figure used for answer:
                    </div>
                    <div style={{ textAlign: 'center', background: '#F8FAFC', borderRadius: '8px', padding: '12px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <img
                        src={`http://localhost:5000/api/images/${activeCitationPreview.imageId || activeCitationPreview._id}/file`}
                        alt={activeCitationPreview.caption || activeCitationPreview.filename || 'Extracted diagram'}
                        style={{ maxWidth: '100%', maxHeight: '42vh', objectFit: 'contain', borderRadius: '6px' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                    {activeCitationPreview.caption && (
                      <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <strong style={{ color: 'var(--text)' }}>Caption / Description:</strong> {activeCitationPreview.caption}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="citation-chunk-box">
                    <div className="citation-chunk-label">
                      {activeCitationPreview.type === 'tabular'
                        ? 'Relevant tabular data & calculations used for answer:'
                        : 'Retrieved text chunk used for answer:'}
                    </div>
                    <div className="citation-chunk-text" style={{ whiteSpace: 'pre-wrap' }}>
                      {activeCitationPreview.content || activeCitationPreview.snippet || 'No text extracted for this citation chunk.'}
                    </div>
                    {activeCitationPreview.chunkId && (
                      <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
                        Chunk ID: {typeof activeCitationPreview.chunkId === 'object' ? activeCitationPreview.chunkId._id || String(activeCitationPreview.chunkId) : activeCitationPreview.chunkId}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                className="modal-footer-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 22px'
                }}
              >
                <div>
                  {(activeCitationPreview.type === 'image' || activeCitationPreview.imageId) ? (
                    <button
                      type="button"
                      className="citation-open-full-btn"
                      onClick={() => handleOpenFullDocument(activeCitationPreview)}
                      title="Open full resolution image in new tab"
                    >
                      <ImageIcon size={14} />
                      <span>Open Full Image</span>
                      <ExternalLink size={12} style={{ marginLeft: '2px' }} />
                    </button>
                  ) : (activeCitationPreview.webViewLink || (activeCitationPreview.documentId && (activeCitationPreview.documentId._id || activeCitationPreview.documentId))) ? (
                    <button
                      type="button"
                      className="citation-open-full-btn"
                      onClick={() => handleOpenFullDocument(activeCitationPreview)}
                      title="Open complete document in new tab"
                    >
                      {activeCitationPreview.source === 'google_drive' || activeCitationPreview.webViewLink ? (
                        <>
                          <GoogleDriveIcon size={14} />
                          <span>Open in Google Drive</span>
                        </>
                      ) : (
                        <>
                          <FileText size={14} />
                          <span>Open Full Document</span>
                        </>
                      )}
                      <ExternalLink size={12} style={{ marginLeft: '2px' }} />
                    </button>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn-modal-cancel"
                  style={{ height: '36px', padding: '0 16px', fontSize: '13.5px' }}
                  onClick={() => setActiveCitationPreview(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
