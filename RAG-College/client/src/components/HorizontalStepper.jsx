import React from 'react';
import { Check } from 'lucide-react';

export default function HorizontalStepper({ steps = [] }) {
  const currentActive = steps.find((s) => s.status === 'active') || steps.find((s) => s.status === 'pending');
  const activeMessage = currentActive?.detail || currentActive?.title || 'Processing your request...';

  return (
    <div className="stepper-container">
      {/* Track & Step Indicators */}
      <div className="stepper-track-row">
        {steps.map((step, idx) => {
          const isDone = step.status === 'done';
          const isActive = step.status === 'active';
          const isLast = idx === steps.length - 1;
          const statusClass = isDone ? 'done' : isActive ? 'active' : 'pending';

          return (
            <React.Fragment key={step.id || idx}>
              {/* Step Circle */}
              <div
                className={`stepper-circle ${statusClass}`}
                title={step.title || step.shortTitle || `Step ${idx + 1}`}
                aria-label={step.title || `Step ${idx + 1}: ${step.status}`}
              >
                {isDone ? (
                  <Check size={13} strokeWidth={2.8} />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>

              {/* Connecting Line between steps */}
              {!isLast && (
                <div className={`stepper-line ${isDone ? 'done' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Step Short Labels */}
      <div className="stepper-labels-row">
        {steps.map((step, idx) => {
          const isDone = step.status === 'done';
          const isActive = step.status === 'active';
          const statusClass = isDone ? 'done' : isActive ? 'active' : 'pending';

          return (
            <div
              key={`label-${step.id || idx}`}
              className={`stepper-label-item ${statusClass}`}
            >
              {step.shortTitle || `Step ${idx + 1}`}
            </div>
          );
        })}
      </div>

      {/* Active Stage Live Status */}
      <div className="stepper-active-status" role="status" aria-live="polite">
        <span className="stepper-pulse-dot" aria-hidden="true" />
        <span>{activeMessage}</span>
      </div>
    </div>
  );
}
