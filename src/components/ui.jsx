import React, { useState, useEffect } from 'react';

/* =========================================================================
   src/components/ui.jsx
   Shared UI primitives used across several pages of the app.

   Previously each page shipped its own private copy of these components
   (8+ duplicate CollapsibleSection implementations with subtly different
   behaviour). They now live here so all pages share one definition.

   CollapsibleSection      : accordion "card" style used by the test tabs
                             (title + optional icon, headerExtra, rotating
                             chevron, p-6 content). Default: closed.
   CollapsibleSectionPanel : plain "panel" style used in the library /
                             definitions screens (small uppercase title,
                             optional subtitle, ▲/▼ chevron, px-4 pb-4
                             content). Default: closed.
   ========================================================================= */

export const CollapsibleSection = ({
  title, icon, defaultOpen = false, children, headerExtra, className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left cursor-pointer ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate select-none">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

export const CollapsibleSectionPanel = ({ id, title, subtitle, defaultOpen = false, children, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <div id={id} className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible scroll-mt-6 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <span className="text-slate-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && <div className="px-4 pb-4 overflow-visible">{children}</div>}
    </div>
  );
};
