import React, { useState } from 'react';
import { AlertCircle, X, Loader2 } from 'lucide-react';

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Delete item?',
  itemName = '',
  itemType = 'item',
  warningText = 'This action cannot be undone.'
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    setErrorMsg('');
    try {
      await onConfirm();
      setIsDeleting(false);
      onClose();
    } catch (err) {
      console.error('Delete action failed:', err);
      setErrorMsg(err.message || 'Unable to delete. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container" style={{ width: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-row">
          <div className="modal-header-title">{title}</div>
          <button
            type="button"
            className="btn-modal-close-icon"
            onClick={onClose}
            disabled={isDeleting}
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-content-body">
          <p style={{ fontSize: '0.88rem', color: '#171717', lineHeight: '1.5' }}>
            Are you sure you want to delete <strong style={{ color: 'var(--primary)' }}>{itemName}</strong>?
          </p>

          <p style={{ fontSize: '0.78rem', color: '#6B7280' }}>
            {warningText}
          </p>

          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', backgroundColor: '#FEF2F2', borderRadius: '4px', border: '1px solid #FEE2E2', color: '#DC2626', fontSize: '0.8rem' }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="modal-footer-actions">
          <button
            type="button"
            className="btn-secondary-action"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary-action"
            style={{ backgroundColor: '#DC2626' }}
            onClick={handleConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <span>Delete</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
