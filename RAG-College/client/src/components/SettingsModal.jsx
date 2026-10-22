import React, { useEffect } from 'react';
import { X, Sun, Moon } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  theme = 'light',
  onSelectTheme,
  onClearConversation,
  hasActiveMessages = false
}) {
  // Close modal when pressing Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-container chatgpt-settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="chatgpt-settings-header">
          <h2 className="chatgpt-settings-title">Settings</h2>
          <button
            type="button"
            className="chatgpt-settings-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content rows */}
        <div className="chatgpt-settings-body">
          {/* Row 1: Appearance / Theme */}
          <div className="chatgpt-settings-row">
            <div className="chatgpt-settings-meta">
              <span className="chatgpt-settings-label">Theme</span>
            </div>
            <div className="chatgpt-segmented-control" role="radiogroup" aria-label="Theme selection">
              <button
                type="button"
                className={`chatgpt-segment-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => onSelectTheme && onSelectTheme('light')}
                role="radio"
                aria-checked={theme === 'light'}
              >
                <Sun size={13} strokeWidth={2.2} />
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`chatgpt-segment-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => onSelectTheme && onSelectTheme('dark')}
                role="radio"
                aria-checked={theme === 'dark'}
              >
                <Moon size={13} strokeWidth={2.2} />
                <span>Dark</span>
              </button>
            </div>
          </div>

          <div className="chatgpt-settings-divider" />

          {/* Row 2: Clear Current Chat */}
          <div className="chatgpt-settings-row">
            <div className="chatgpt-settings-meta">
              <span className="chatgpt-settings-label">Clear current chat</span>
              <span className="chatgpt-settings-subtext">
                Permanently delete messages in the active conversation
              </span>
            </div>
            <button
              type="button"
              className="chatgpt-clear-btn"
              disabled={!hasActiveMessages}
              onClick={onClearConversation}
              title={hasActiveMessages ? 'Clear current chat' : 'No messages in current conversation'}
            >
              Clear
            </button>
          </div>

          <div className="chatgpt-settings-divider" />

          {/* Row 3: About */}
          <div className="chatgpt-settings-row">
            <div className="chatgpt-settings-meta">
              <span className="chatgpt-settings-label">RAG College Assistant</span>
              <span className="chatgpt-settings-subtext">
                Academic AI knowledge base for curriculum and syllabus documents
              </span>
            </div>
            <span className="chatgpt-version-badge">v1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
