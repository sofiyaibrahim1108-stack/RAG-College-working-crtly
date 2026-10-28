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
  Bookmark
} from 'lucide-react';
import { GoogleDriveIcon } from './Icons';

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:5000').replace(/\/api\/?$/, '');

function getAuthenticatedImageUrl(imgId) {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('jwt');
  const cleanToken = token ? token.replace(/^"|"$/g, '') : '';
  return `${API_BASE}/api/images/${imgId}/file${cleanToken ? `?token=${encodeURIComponent(cleanToken)}` : ''}`;
}

function processTextNode(text, onCitationClick) {
  if (!text || typeof text !== 'string') return text;

  const tokens = text.split(/(==.*?==|\[\d+(?:,\s*\d+)*\]|!\[.*?\]\(.*?\))/g);
  const hasSpecialTokens = tokens.some(
    (tok) =>
      (tok.startsWith('==') && tok.endsWith('==') && tok.length >= 4) ||
      /^\[\d+(?:,\s*\d+)*\]$/.test(tok) ||
      /^!\[.*?\]\(.*?\)$/.test(tok)
  );

  if (!hasSpecialTokens) return text;

  return tokens.map((tok, idx) => {
    if (tok.startsWith('==') && tok.endsWith('==') && tok.length >= 4) {
      return (
        <mark key={idx} className="markdown-mark">
          {tok.slice(2, -2)}
        </mark>
      );
    }
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
    if (/^\[\d+(?:,\s*\d+)*\]$/.test(tok)) {
      return (
        <span key={idx} className="citation-ref-badge" title={`Citation ${tok}`}>
          {tok}
        </span>
      );
    }
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
      const isInline = !className;
      if (isInline) {
        return <code className="markdown-inline-code" {...props}>{children}</code>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    pre: ({ children }) => {
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
    th: ({ children }) => <th>{processChildren(children, onCitationClick)}</th>,
    td: ({ children }) => <td>{processChildren(children, onCitationClick)}</td>,
    mark: ({ children }) => <mark className="markdown-mark">{children}</mark>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
        {children}
      </a>
    ),
    hr: () => <hr className="markdown-hr" />,
    blockquote: ({ children }) => (
      <blockquote className="markdown-blockquote">{children}</blockquote>
    )
  };
}

function normalizeMarkdown(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;
  result = result.replace(/([^\n])\s*(```[a-zA-Z0-9_-]*)/g, '$1\n\n$2');
  result = result.replace(/^([ \t]*```[a-zA-Z0-9_-]+)[ \t]+([^\r\n]+)$/gm, '$1\n$2');
  result = result.replace(/([^\n\s`])[ \t]+(```)[ \t]*$/gm, '$1\n$2');
  result = result.replace(/^([ \t]*```)[ \t]+([^\r\n]+)$/gm, '$1\n\n$2');

  const fenceCount = (result.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    result += '\n```';
  }

  result = result.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2');
  result = result.replace(/^(#{1,6}\s+[^\r\n]+?)[ \t]+(\d+\.\s+)/gm, '$1\n\n$2');

  const parts = result.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i += 2) {
    let chunk = parts[i];
    chunk = chunk.replace(/([^\n])\s+(\d+\.\s+)/g, (match, p1, p2) => p1 + '\n\n' + p2);
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
  sessionId,
  onRegenerate,
  onEdit,
  onToast,
  isRegenerating = false
}) {
  if (!message) return null;

  const [copied, setCopied] = useState(false);
  const [userCopied, setUserCopied] = useState(false);
  const [feedback, setFeedback] = useState(message?.feedback?.rating || null);
  const [activeCitationPreview, setActiveCitationPreview] = useState(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

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

  const submitFeedbackToServer = async (ratingType, reason = '') => {
    try {
      setIsSubmittingFeedback(true);

      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');

      const headers = {
        'Content-Type': 'application/json'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
      }

      const response = await fetch(`${API_BASE}/api/chat/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messageId: message._id || message.id,
          sessionId: sessionId || message.sessionId,
          rating: ratingType,
          reason,
          answer: message.content
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setFeedback(ratingType);
        if (onToast) {
          onToast(ratingType === 'like' ? 'Thanks for your feedback!' : 'Feedback recorded', 'success');
        }
      } else {
        if (onToast) onToast(data.message || 'Failed to submit feedback', 'error');
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      if (onToast) onToast('Failed to record feedback', 'error');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleFeedback = (type) => {
    if (isSubmittingFeedback) return;
    if (feedback === type) {
      setFeedback(null);
      return;
    }

    if (type === 'dislike') {
      const reasonPrompt = window.prompt(
        'What was wrong with this answer? (e.g. incorrect data, bad table, etc.)',
        ''
      );
      submitFeedbackToServer('dislike', reasonPrompt || '');
    } else {
      submitFeedbackToServer('like', '');
    }
  };

  const handleSaveToLibrary = async (imgSrc, e) => {
    e.stopPropagation();
    try {
      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');

      const headers = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
      }

      const res = await fetch(`${API_BASE}/api/media-library`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          documentId: imgSrc.documentId?._id || imgSrc.documentId,
          imageUrl: getAuthenticatedImageUrl(imgSrc.imageId || imgSrc._id),
          imagePath: imgSrc.imagePath || imgSrc.path || '',
          caption: imgSrc.caption || imgSrc.filename || 'Diagram',
          pageNumber: imgSrc.pageNumber || imgSrc.page || 1
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (onToast) onToast('Saved to Media Library successfully!', 'success');
      } else {
        if (onToast) onToast(data.message || 'Failed to save image', 'error');
      }
    } catch (err) {
      console.error('Error saving image:', err);
      if (onToast) onToast('Failed to save image to library', 'error');
    }
  };

  const handleOpenSource = (src) => {
    setActiveCitationPreview(src);
  };

  const handleAuthenticatedOpen = async (fileUrl) => {
    try {
      const token =
        localStorage.getItem('token') ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('jwt');

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token.replace(/^"|"$/g, '')}`;
      }

      const response = await fetch(fileUrl, { headers });
      if (!response.ok) {
        throw new Error('Failed to load file with authentication');
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Error opening file securely:', err);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenFullDocument = (src) => {
    if (src.type === 'image' || src.imageId) {
      const imgId = src.imageId || src._id;
      if (imgId) {
        handleAuthenticatedOpen(`${API_BASE}/api/images/${imgId}/file`);
        return;
      }
    }

    const driveUrl = src.webViewLink || (src.documentId && src.documentId.driveMetadata?.webViewLink);
    if (src.source === 'google_drive' || driveUrl) {
      if (driveUrl) {
        window.open(driveUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    const docId = src.documentId?._id || src.documentId;
    if (docId) {
      const docFileUrl = `${API_BASE}/api/documents/${docId}/file`;
      handleAuthenticatedOpen(docFileUrl);
      return;
    }

    if (onToast) {
      onToast(`Unable to open full document for ${src.filename || src.label || 'this document'}`, 'error');
    }
  };

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

        {/* Attached Visual Diagrams / Screenshots with ChatGPT style Bookmark button */}
        {!isUser && !isError && imageSources.length > 0 && (
          <div className="message-attached-images">
            <div className="attached-images-heading">
              <ImageIcon size={14} className="image-source-heading-icon" />
              <span>Attached Diagrams &amp; Screenshots ({imageSources.length})</span>
            </div>
            <div className="attached-images-grid">
              {imageSources.map((imgSrc, imgIdx) => {
                const imgId = imgSrc.imageId || imgSrc._id;
                const fileUrl = getAuthenticatedImageUrl(imgId);
                const citNum = imgSrc.citationIndex || (imgIdx + 1);

                return (
                  <div
                    key={imgIdx}
                    id={`attached-image-${citNum}`}
                    className="attached-image-card"
                    onClick={() => handleOpenSource(imgSrc)}
                    title={`Click to open full-resolution image: ${imgSrc.caption || imgSrc.filename}`}
                  >
                    <div className="attached-image-frame" style={{ position: 'relative' }}>
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
                      
                      {/* ChatGPT style Floating Bookmark Save Button */}
                      <button
                        type="button"
                        onClick={(e) => handleSaveToLibrary(imgSrc, e)}
                        title="Save to Media Library"
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          background: 'rgba(15, 23, 42, 0.8)',
                          backdropFilter: 'blur(4px)',
                          color: '#38BDF8',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: '6px',
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          zIndex: 10
                        }}
                      >
                        <Bookmark size={15} />
                      </button>

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

        {/* Sources Section */}
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

                const rawFilename = src.filename || src.label || 'Document';
                const cleanFilename = rawFilename.split(/[/\\]/).pop();

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

        {/* Assistant Actions Bar */}
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
              style={{
                color: feedback === 'like' ? '#15803D' : undefined,
                fontWeight: feedback === 'like' ? 600 : 'normal'
              }}
              onClick={() => handleFeedback('like')}
              title="Helpful"
            >
              <ThumbsUp size={14} />
            </button>

            <button
              type="button"
              className="btn-msg-action"
              style={{
                color: feedback === 'dislike' ? '#B42318' : undefined,
                fontWeight: feedback === 'dislike' ? 600 : 'normal'
              }}
              onClick={() => handleFeedback('dislike')}
              title="Not helpful"
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        )}

        {/* Source Content Preview Modal */}
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
                        src={getAuthenticatedImageUrl(activeCitationPreview.imageId || activeCitationPreview._id)}
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