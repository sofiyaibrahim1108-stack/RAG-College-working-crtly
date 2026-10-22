import React from 'react';

export default function ProgressSidebar({ steps, isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <aside className="w-72 border-l border-gray-200 bg-gray-50/50 p-4 flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="flex items-center justify-between pb-3 border-b border-gray-200 mb-4">
        <h3 className="text-sm font-semibold text-gray-800">Progress</h3>
        {onClose && (
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 text-xs font-bold px-1 rounded"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 text-xs">
        {steps.map((step, index) => {
          const isActive = step.status === 'active';
          const isDone = step.status === 'done';

          return (
            <div key={index} className="flex items-start gap-3">
              {/* Status Indicator */}
              <div className="mt-0.5">
                {isDone ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block" />
                ) : isActive ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping block" />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300 block" />
                )}
              </div>

              {/* Step Title & Details */}
              <div className="flex flex-col">
                <span className={`font-medium ${isActive ? 'text-gray-900 font-semibold' : isDone ? 'text-gray-700' : 'text-gray-400'}`}>
                  {step.title}
                </span>
                {step.detail && (
                  <span className="text-[11px] text-gray-500 mt-0.5">
                    {step.detail}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}