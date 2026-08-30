import React, { useState, useEffect } from 'react';
import { Icon } from './Icons';

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
                             settings screens (small uppercase title,
                             optional subtitle, ▲/▼ chevron, px-4 pb-4
                             content). Default: closed.

   Both listen for the global "lab:toggle-all-sections" event dispatched by
   the top-bar "Expand all / Collapse all" button of the experiment pages.
   ========================================================================= */

// One-shot "expand all / collapse all" command. Kept for a short window so
// nested sections that MOUNT only after their parent opens (the event has
// already fired by then) still honour it.
let sectionsCommand = null;
const SECTIONS_COMMAND_TTL = 2000;

export const CollapsibleSection = ({
  title, icon, defaultOpen = false, children, headerExtra, className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Nested sections mount AFTER the toggle event (once their parent opens);
  // honour a recent expand-all/collapse-all command so subsections follow too.
  useEffect(() => {
    if (sectionsCommand && Date.now() - sectionsCommand.at < SECTIONS_COMMAND_TTL) {
      setIsOpen(sectionsCommand.open);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to the top-bar "Expand all / Collapse all" button.
  useEffect(() => {
    const onToggle = (e) => {
      const open = !!(e && e.detail && e.detail.open);
      sectionsCommand = { open, at: Date.now() };
      setIsOpen(open);
    };
    window.addEventListener('lab:toggle-all-sections', onToggle);
    return () => window.removeEventListener('lab:toggle-all-sections', onToggle);
  }, []);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-3 break-inside-avoid ${className}`}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left cursor-pointer ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <Icon name={icon} size={18} className="shrink-0 text-slate-500" />}
          <h3 className="text-sm font-bold text-slate-800 truncate select-none">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {isOpen && <div className="p-3">{children}</div>}
    </div>
  );
};

export const CollapsibleSectionPanel = ({ id, title, subtitle, defaultOpen = false, children, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  // Honour the top-bar "Expand all / Collapse all" command (and the short
  // mount window for nested panels).
  useEffect(() => {
    if (sectionsCommand && Date.now() - sectionsCommand.at < SECTIONS_COMMAND_TTL) {
      setOpen(sectionsCommand.open);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onToggle = (e) => {
      const next = !!(e && e.detail && e.detail.open);
      sectionsCommand = { open: next, at: Date.now() };
      setOpen(next);
    };
    window.addEventListener('lab:toggle-all-sections', onToggle);
    return () => window.removeEventListener('lab:toggle-all-sections', onToggle);
  }, []);

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
