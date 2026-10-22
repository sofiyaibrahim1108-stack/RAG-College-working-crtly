import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Loader2 } from 'lucide-react';

export default function DepartmentModal({
  isOpen,
  onClose,
  onSubmit,
  department = null
}) {
  const isEdit = Boolean(department && department._id);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [aliasesStr, setAliasesStr] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(department?.name || '');
      setCode(department?.code || '');
      setDescription(department?.description || '');
      setAliasesStr(Array.isArray(department?.aliases) ? department.aliases.join(', ') : '');
      setErrorMsg('');
    }
  }, [isOpen, department]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();
    const cleanDesc = description.trim();

    if (!cleanName) {
      setErrorMsg('Department name is required.');
      return;
    }
    if (!cleanCode) {
      setErrorMsg('Department code is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const parsedAliases = aliasesStr
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      await onSubmit({
        name: cleanName,
        code: cleanCode,
        description: cleanDesc,
        aliases: parsedAliases
      });
      onClose();
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} department:`, err);
      setErrorMsg(err.message || `Unable to ${isEdit ? 'update' : 'create'} department.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !isSubmitting && onClose()}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header-row">
          <div className="modal-header-title">
            {isEdit ? 'Edit Department' : 'Create Department'}
          </div>
          <button
            type="button"
            className="btn-modal-close-icon"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit}>
          <div className="modal-content-body">
            <div className="form-field-group">
              <label className="field-label">Department Name *</label>
              <input
                type="text"
                className="field-input"
                placeholder="e.g. Computer Science & Engineering"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="form-field-group">
              <label className="field-label">Department Code *</label>
              <input
                type="text"
                className="field-input"
                placeholder="e.g. CSE"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="form-field-group">
              <label className="field-label">Aliases (comma-separated, optional)</label>
              <input
                type="text"
                className="field-input"
                placeholder="e.g. computer science, cs"
                value={aliasesStr}
                onChange={(e) => setAliasesStr(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="form-field-group">
              <label className="field-label">Description</label>
              <textarea
                className="field-input"
                rows={3}
                placeholder="Brief description of this academic department..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                style={{ resize: 'none' }}
              />
            </div>

            {errorMsg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#DC2626' }}>
                <AlertCircle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          <div className="modal-footer-actions">
            <button
              type="button"
              className="btn-secondary-action"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary-action"
              disabled={!name.trim() || !code.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="spin" />
                  <span>{isEdit ? 'Saving...' : 'Creating...'}</span>
                </>
              ) : (
                <span>{isEdit ? 'Save Changes' : 'Create Department'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
