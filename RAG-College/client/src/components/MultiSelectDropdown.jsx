import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';

const MultiSelectDropdown = forwardRef(function MultiSelectDropdown(
  {
    label = 'Department',
    required = true,
    options = [],
    selectedIds = [],
    onChange,
    error = '',
    placeholder = 'Select departments',
    id = 'dept-multi-select'
  },
  ref
) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const containerRef = useRef(null);

  // Expose focus and scrollIntoView methods to parent component ref
  useImperativeHandle(ref, () => ({
    focus: () => {
      triggerRef.current?.focus();
    },
    scrollIntoView: (options) => {
      containerRef.current?.scrollIntoView(options);
    }
  }));

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const allSelected = options.length > 0 && selectedIds.length === options.length;

  const handleToggleOption = (optionId) => {
    const next = selectedIds.includes(optionId)
      ? selectedIds.filter((id) => id !== optionId)
      : [...selectedIds, optionId];
    onChange?.(next);
  };

  const handleToggleSelectAll = () => {
    if (allSelected) {
      onChange?.([]);
    } else {
      onChange?.(options.map((o) => o._id));
    }
  };

  const getSummary = () => {
    const count = selectedIds.length;
    if (count === 0) return placeholder;
    if (options.length > 0 && count === options.length) return 'All departments';
    if (count === 1) return '1 selected';
    return `${count} selected`;
  };

  return (
    <div className="multi-select-dropdown-container" ref={containerRef}>
      {label && (
        <div className="multi-select-label-row">
          <label htmlFor={id} className="multi-select-label">
            {label}
            {required && <span className="required-asterisk">*</span>}
          </label>
        </div>
      )}

      <div className="multi-select-trigger-wrapper">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={`multi-select-trigger ${isOpen ? 'open' : ''} ${error ? 'has-error' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-invalid={Boolean(error)}
        >
          <span className={selectedIds.length === 0 ? 'multi-select-placeholder' : 'multi-select-value'}>
            {getSummary()}
          </span>
          <ChevronDown
            size={16}
            className={`multi-select-arrow ${isOpen ? 'rotated' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="multi-select-panel" role="listbox" aria-multiselectable="true">
            {options.length > 0 && (
              <>
                <div
                  className={`multi-select-option select-all ${allSelected ? 'selected' : ''}`}
                  onClick={handleToggleSelectAll}
                  role="option"
                  aria-selected={allSelected}
                >
                  <input
                    type="checkbox"
                    className="multi-select-checkbox"
                    checked={allSelected}
                    onChange={() => {}}
                    tabIndex={-1}
                    aria-label="Select all departments"
                  />
                  <span className="multi-select-option-title select-all-text">Select All</span>
                  <span className="multi-select-option-count">({options.length})</span>
                </div>
                <div className="multi-select-divider" />
              </>
            )}

            {options.length === 0 ? (
              <div className="multi-select-empty">No departments available</div>
            ) : (
              options.map((opt) => {
                const isSelected = selectedIds.includes(opt._id);
                return (
                  <div
                    key={opt._id}
                    className={`multi-select-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleOption(opt._id)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <input
                      type="checkbox"
                      className="multi-select-checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      tabIndex={-1}
                      aria-label={opt.code || opt.name}
                    />
                    <span className="multi-select-option-code">{opt.code}</span>
                    {opt.name && opt.name !== opt.code && (
                      <span className="multi-select-option-desc">{opt.name}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="multi-select-error-text" role="alert">
          <AlertCircle size={14} className="error-icon" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
});

export default MultiSelectDropdown;
