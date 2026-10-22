import React, { useRef, useEffect, useState } from 'react';
import { Paperclip, SendHorizontal, Square, FileUp } from 'lucide-react';
import { GoogleDriveIcon } from './Icons';
import VisualModeDropdown from './VisualModeDropdown';

export default function ChatComposer({
  inputQuery,
  setInputQuery,
  onSendMessage,
  onStopGeneration,
  onOpenUpload,
  onOpenDrive,
  isSending,
  selectedDepartmentName,
  visualMode = null,
  setVisualMode
}) {
  const textareaRef = useRef(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef(null);

  // Auto-resize textarea based on input content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputQuery]);

  // Close attach menu on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputQuery.trim() && !isSending) {
        onSendMessage();
      }
    }
  };

  const handleSendClick = (e) => {
    e.preventDefault();
    if (inputQuery.trim() && !isSending) {
      onSendMessage();
    }
  };

  const placeholderText = selectedDepartmentName
    ? `Type your message in [${selectedDepartmentName}]...`
    : 'Type your message...';

  return (
    <div className="composer-outer">
      <div className="composer-pill-box">
        {/* Attachment Paperclip Button & Popover */}
        <div style={{ position: 'relative' }} ref={attachMenuRef}>
          <button
            type="button"
            className={`btn-composer-attach ${attachMenuOpen ? 'active' : ''}`}
            onClick={() => setAttachMenuOpen((prev) => !prev)}
            title="Attach file or import from Google Drive"
            aria-label="Attach file"
          >
            <Paperclip size={18} strokeWidth={2} />
          </button>

          {attachMenuOpen && (
            <div className="composer-attach-dropdown">
              <div
                className="attach-dropdown-item"
                onClick={() => {
                  setAttachMenuOpen(false);
                  if (onOpenUpload) onOpenUpload();
                }}
              >
                <FileUp size={15} />
                <span>Upload Document</span>
              </div>
              <div
                className="attach-dropdown-item"
                onClick={() => {
                  setAttachMenuOpen(false);
                  if (onOpenDrive) onOpenDrive();
                }}
              >
                <GoogleDriveIcon size={15} />
                <span>Google Drive</span>
              </div>
            </div>
          )}
        </div>

        {/* Visual Mode Dropdown: between paperclip and textarea */}
        <VisualModeDropdown visualMode={visualMode} setVisualMode={setVisualMode} />

        {/* Center Text Input Area */}
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          rows={1}
          placeholder={placeholderText}
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {/* Send / Stop Action Button */}
        {isSending ? (
          <button
            key="composer-stop-btn"
            type="button"
            className="btn-composer-send stop"
            onClick={onStopGeneration}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <Square size={13} fill="#FFFFFF" strokeWidth={0} />
          </button>
        ) : (
          <button
            key="composer-send-btn"
            type="button"
            className={`btn-composer-send ${inputQuery.trim() ? 'active' : ''}`}
            disabled={!inputQuery.trim()}
            onClick={handleSendClick}
            title="Send question"
            aria-label="Send question"
          >
            <SendHorizontal size={16} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}
