import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, FileText, Image as ImageIcon, Layers, Check } from 'lucide-react';

const MODE_OPTIONS = [
  {
    id: 'auto',
    label: 'Auto',
    icon: Sparkles
  },
  {
    id: 'both',
    label: 'Both',
    icon: Layers
  },
  {
    id: 'text_only',
    label: 'Text Only',
    icon: FileText
  },
  {
    id: 'image_only',
    label: 'Image Only',
    icon: ImageIcon
  }
];

export default function VisualModeDropdown({ visualMode = null, setVisualMode }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close menu on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const normalizedMode = (!visualMode || visualMode === 'auto') ? 'auto' : visualMode;
  const currentOption = MODE_OPTIONS.find((m) => m.id === normalizedMode) || MODE_OPTIONS[0];
  const CurrentIcon = currentOption.icon;

  const handleSelect = (modeId) => {
    if (setVisualMode) {
      setVisualMode(modeId === 'auto' ? null : modeId);
    }
    setIsOpen(false);
  };

  return (
    <div className="relative visual-mode-dropdown-root" ref={dropdownRef}>
      {/* Trigger Button inside Input Pill */}
      <button
        type="button"
        id="visual-mode-trigger-btn"
        className={`visual-mode-trigger-btn flex items-center justify-center w-[34px] h-[34px] rounded-full transition-all cursor-pointer flex-shrink-0 ${
          isOpen
            ? 'active bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
            : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
        }`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={`Visual Mode: ${currentOption.label} (Click to change)`}
        aria-label={`Visual mode: ${currentOption.label}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <CurrentIcon size={17} strokeWidth={2} />
      </button>

      {/* Popup Menu Anchored Right Above */}
      {isOpen && (
        <div
          className="visual-mode-menu-popup absolute bottom-full mb-2 left-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg p-1.5 min-w-[170px] z-50 flex flex-col gap-0.5"
          role="menu"
          aria-label="Select visual mode"
        >
          {MODE_OPTIONS.map((opt) => {
            const isSelected = normalizedMode === opt.id;
            const Icon = opt.icon;

            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                className={`visual-mode-menu-item w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                  isSelected
                    ? 'selected bg-blue-50/70 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
                onClick={() => handleSelect(opt.id)}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    size={15}
                    className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}
                  />
                  <span>{opt.label}</span>
                </div>
                {isSelected && (
                  <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0 ml-2" strokeWidth={2.5} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
