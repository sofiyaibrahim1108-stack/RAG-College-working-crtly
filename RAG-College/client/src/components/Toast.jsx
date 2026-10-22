import React from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ toasts = [], onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const type = toast.type || 'info';

        return (
          <div key={toast.id} className={`toast-message ${type}`}>
            <div className="toast-icon-wrap">
              {type === 'success' && <CheckCircle2 size={16} className="toast-icon success" />}
              {type === 'error' && <AlertCircle size={16} className="toast-icon error" />}
              {type === 'warning' && <AlertTriangle size={16} className="toast-icon warning" />}
              {type === 'info' && <Info size={16} className="toast-icon info" />}
            </div>

            <div className="toast-body">
              <span className="toast-text">{toast.text}</span>
            </div>

            <button
              type="button"
              className="btn-toast-dismiss"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
