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

   Both subscribe to the "Expand all / Collapse all" command issued by the
   top-bar button of the experiment pages (see setSectionsCommand below).
   ========================================================================= */

// ---- "Expand all / Collapse all" command store -------------------------
// The top-bar button calls setSectionsCommand(true/false). Every collapsible
// subscribes via useSectionsCommand(). The command is kept for a short window
// so NESTED sections that only mount after their parent opens still honour it.
let sectionsCmd = null;
const SECTIONS_CMD_TTL = 3000;
const sectionsCmdListeners = new Set();

export const setSectionsCommand = (open) => {
  sectionsCmd = { open: !!open, at: Date.now() };
  sectionsCmdListeners.forEach((fn) => fn(!!open));
};

const subscribeSectionsCommand = (fn) => {
  sectionsCmdListeners.add(fn);
  return () => { sectionsCmdListeners.delete(fn); };
};

const isSectionsCommandFresh = () =>
  !!sectionsCmd && Date.now() - sectionsCmd.at < SECTIONS_CMD_TTL;

/** Reactively returns the latest "expand all / collapse all" command
 *  (true/false) or null when none is pending. Consuming components re-render
 *  whenever a new command is issued. */
export const useSectionsCommand = () => {
  const [cmd, setCmd] = useState(() => (isSectionsCommandFresh() ? sectionsCmd.open : null));
  useEffect(() => subscribeSectionsCommand((open) => setCmd(open)), []);
  return cmd;
};

// Bridge the shared window event into the store (kept for any external
// dispatcher; the top-bar button uses setSectionsCommand directly).
if (typeof window !== 'undefined') {
  window.addEventListener('lab:toggle-all-sections', (e) => {
    if (e && e.detail && typeof e.detail.open === 'boolean') setSectionsCommand(e.detail.open);
  });
}

// ---- Per-experiment section memory --------------------------------------
// Leaving the experiment page (to consult the Library, the Projects, the Lab
// Notebook…) UNMOUNTS it, so every section used to collapse and its scroll
// position was lost: coming back meant reopening the same subsections again.
//
// Sections now remember whether they were open, PER EXPERIMENT (the active
// test id), so returning to an experiment restores the very same view — and
// two different experiments each keep their own layout.
//
// The scope comes from <SectionsScope>, which App.jsx wraps around the
// experiment page. Sections rendered outside that scope (Library, Settings…)
// keep their current, non-persistent behaviour on purpose: their titles are
// not unique enough to be used as keys.
export const SectionsScope = React.createContext(null);

const SECTION_MEMORY_KEY = 'labWorkspace_sectionMemory';
// Safety bound: only the most recently opened experiments are remembered
// (insertion order = first-visit order, so the oldest entries are dropped).
const SECTION_MEMORY_MAX_TESTS = 200;
let sectionMemoryCache = null;

const loadSectionMemory = () => {
  if (sectionMemoryCache) return sectionMemoryCache;
  try {
    const raw = JSON.parse(localStorage.getItem(SECTION_MEMORY_KEY) || 'null');
    sectionMemoryCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    sectionMemoryCache = {};
  }
  return sectionMemoryCache;
};

/** Open state remembered for `key` inside `scope` (a test id), or `fallback`. */
const readSectionOpen = (scope, key, fallback) => {
  if (!scope || !key) return fallback;
  const bucket = loadSectionMemory()[scope];
  const saved = bucket ? bucket[key] : undefined;
  return typeof saved === 'boolean' ? saved : fallback;
};

/** Remember the open state of one section for the next visit. */
const writeSectionOpen = (scope, key, open) => {
  if (!scope || !key) return;
  try {
    const mem = loadSectionMemory();
    if (!mem[scope]) mem[scope] = {};
    mem[scope][key] = !!open;
    const scopes = Object.keys(mem);
    if (scopes.length > SECTION_MEMORY_MAX_TESTS) {
      scopes.slice(0, scopes.length - SECTION_MEMORY_MAX_TESTS).forEach((k) => delete mem[k]);
    }
    localStorage.setItem(SECTION_MEMORY_KEY, JSON.stringify(mem));
  } catch {
    /* localStorage full or unavailable — the page keeps working, only the
       open/closed state is not remembered. */
  }
};

// ---- Per-condition scroll memory ----------------------------------------
// Same idea as the section memory above, for the SCROLL OFFSET. The
// experiment page's scroll container is destroyed when the page unmounts, so
// coming back (sidebar « ↩ Back to experiment », Projects → experiment…)
// dumped the user at the very top instead of the subsection they were
// reading. The offset is remembered PER CONDITION (the active test id, exactly
// like the sections) and re-applied as soon as the page is laid out again.
//
// sessionStorage on purpose (not localStorage): this is a "where was I a
// minute ago" shortcut for the current tab — it survives a reload and is gone
// with the tab.
const SCROLL_MEMORY_KEY = 'labExperimentScroll';
// Safety bound: only the most recently visited conditions are remembered
// (insertion order = last-visit order, so the oldest entries are dropped).
const SCROLL_MEMORY_MAX_TESTS = 200;
// Below this range the container simply cannot scroll (the layout switches at
// the md breakpoint: the page root scrolls on mobile, the inner body on
// desktop — so we ask the element instead of assuming).
const SCROLL_RANGE_MIN = 8;
let scrollMemoryCache = null;

const loadScrollMemory = () => {
  if (scrollMemoryCache) return scrollMemoryCache;
  try {
    const raw = JSON.parse(sessionStorage.getItem(SCROLL_MEMORY_KEY) || 'null');
    scrollMemoryCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    scrollMemoryCache = {};
  }
  return scrollMemoryCache;
};

/** Scroll offset remembered for `scope` (an active test id); 0 when unknown. */
export const readViewScroll = (scope) => {
  if (!scope) return 0;
  const saved = loadScrollMemory()[scope];
  return Number.isFinite(saved) && saved > 0 ? saved : 0;
};

/** Remember the scroll offset of `scope` for the next visit. A value of 0 (or
 *  less) simply forgets it — the user is back at the top of the page. */
export const writeViewScroll = (scope, top) => {
  if (!scope) return;
  const value = Math.max(0, Math.round(Number(top) || 0));
  const mem = loadScrollMemory();
  delete mem[scope];
  if (value > 0) mem[scope] = value; // re-insert → refreshed in the bound below
  try {
    const scopes = Object.keys(mem);
    if (scopes.length > SCROLL_MEMORY_MAX_TESTS) {
      scopes.slice(0, scopes.length - SCROLL_MEMORY_MAX_TESTS).forEach((k) => delete mem[k]);
    }
    sessionStorage.setItem(SCROLL_MEMORY_KEY, JSON.stringify(mem));
  } catch {
    /* sessionStorage full or unavailable — only the scroll memory is lost. */
  }
};

/** Can the user actually scroll `el` right now? */
const isScrollContainer = (el) => {
  if (!el || el.scrollHeight - el.clientHeight <= SCROLL_RANGE_MIN) return false;
  try {
    const oy = window.getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll';
  } catch {
    return false;
  }
};

/**
 * Remember the page scroll offset PER CONDITION and restore it when the user
 * comes back to that condition (see the comment block above).
 *
 * @param scope  the active test id (same scope as the section memory)
 * @param refs   the candidate scroll containers of the page, outer first (the
 *               layout switches at the md breakpoint: the page root scrolls on
 *               mobile, the inner body on desktop)
 */
export const useExperimentScrollMemory = (scope, refs) => {
  // Keep the caller's ref list in a ref: it is a fresh array on every render.
  const refsRef = React.useRef(refs);
  refsRef.current = refs;
  const latest = React.useRef(0);        // last user-driven offset
  const restoring = React.useRef(false); // our own scrollTop writes → ignore
  const timer = React.useRef(0);

  const elements = () => (refsRef.current || []).map((r) => r && r.current).filter(Boolean);

  const flush = () => {
    // Only real positions are remembered: writing 0 would erase a position the
    // user may still want back (e.g. the page was not laid out yet).
    if (latest.current > 0) writeViewScroll(scope, latest.current);
  };

  // ── Save: every scroll of the page container, and on the way out ─────────
  useEffect(() => {
    // New scope (the user switched condition) → the offset recorded so far
    // belonged to the previous condition and was just flushed by the previous
    // run's cleanup, so start over. Nothing is written until the user really
    // scrolls, which keeps the position already remembered for THIS condition.
    latest.current = 0;
    const onScroll = (e) => {
      const el = e.currentTarget;
      if (restoring.current || !isScrollContainer(el)) return;
      latest.current = el.scrollTop;
      if (timer.current) return; // trailing throttle: one write per 200 ms
      timer.current = window.setTimeout(() => { timer.current = 0; flush(); }, 200);
    };
    const els = elements();
    els.forEach((el) => el.addEventListener('scroll', onScroll, { passive: true }));
    return () => {
      els.forEach((el) => el.removeEventListener('scroll', onScroll));
      if (timer.current) { window.clearTimeout(timer.current); timer.current = 0; }
      flush(); // leaving the page (or switching condition): remember where we were
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // ── Restore: on mount, and every time the user switches condition ────────
  useEffect(() => {
    const saved = readViewScroll(scope);
    if (!saved) return undefined;

    restoring.current = true;
    let done = false;
    let tries = 0;
    const timers = [];
    // Stop as soon as the user takes over (wheel, touch, click, keyboard) so
    // the restore never fights a manual scroll.
    const opts = { passive: true };
    const stop = () => {
      if (done) return;
      done = true;
      restoring.current = false;
      timers.forEach((id) => window.clearTimeout(id));
      elements().forEach((el) => {
        el.removeEventListener('wheel', stop, opts);
        el.removeEventListener('touchstart', stop, opts);
        el.removeEventListener('pointerdown', stop, opts);
        el.removeEventListener('keydown', stop);
      });
    };
    const apply = () => {
      if (done) return;
      const el = elements().find(isScrollContainer);
      if (el) {
        const wanted = Math.min(saved, el.scrollHeight - el.clientHeight);
        if (el.scrollTop !== wanted) el.scrollTop = wanted;
      }
      // Sections, charts and images keep growing the page for a moment: keep
      // retrying (with the ORIGINAL offset) until the layout has settled.
      tries += 1;
      if (tries >= 12) { stop(); return; }
      timers.push(window.setTimeout(apply, tries < 4 ? 60 : 150));
    };
    elements().forEach((el) => {
      el.addEventListener('wheel', stop, opts);
      el.addEventListener('touchstart', stop, opts);
      el.addEventListener('pointerdown', stop, opts);
      el.addEventListener('keydown', stop);
    });
    // Give the sections their first paint (they reopen from their own memory)
    // before positioning the page.
    timers.push(window.setTimeout(apply, 30));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
};

/**
 * Same per-experiment memory as <CollapsibleSection>, for the page's OWN group
 * toggles: the big "GENERAL" / "SETUP" / "DATA AND ANALYSIS" / "REPORT" areas
 * of the experiment pages are plain local state (not sections), so they used
 * to collapse again every time the page was left and reopened.
 *
 * Returns [open, setOpen]; setOpen takes a boolean (never an updater), because
 * the page header's "expand all / collapse all" button drives it too.
 */
export const useSectionMemory = (key, fallback = false) => {
  const scope = React.useContext(SectionsScope);
  const memoryKey = scope ? String(key || '') : null;
  const [open, setOpen] = useState(() => readSectionOpen(scope, memoryKey, fallback));
  const sectionsCmd = useSectionsCommand();

  // Every change — user click, docking auto-open, "expand all" command — is
  // remembered for the next visit. The setter stays the plain useState one, so
  // callers can keep putting it in their effect dependencies.
  useEffect(() => {
    writeSectionOpen(scope, memoryKey, open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) setOpen(sectionsCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsCmd]);

  return [open, setOpen];
};

export const CollapsibleSection = ({
  title, icon, defaultOpen = false, children, headerExtra, className = '', openWhen = false
}) => {
  // Per-experiment memory (see SectionsScope above): the section reopens the
  // way the user left it when coming back to this experiment.
  const scope = React.useContext(SectionsScope);
  const memoryKey = scope ? String(title || '') : null;
  const [isOpen, setIsOpen] = useState(() => readSectionOpen(scope, memoryKey, defaultOpen));
  const sectionsCmd = useSectionsCommand();

  // Open/close AND remember it, so the choice survives leaving the page.
  const applyOpen = (next) => {
    setIsOpen(next);
    writeSectionOpen(scope, memoryKey, next);
  };

  // Apply expand-all / collapse-all (also covers nested sections that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) applyOpen(sectionsCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsCmd]);

  // Auto-open when something important appears (e.g. imported docking data) —
  // e.g. "Instrumental Setup" opens once raw_input.toml is attached.
  useEffect(() => {
    if (openWhen) applyOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWhen]);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-3 break-inside-avoid ${className}`}>
      <div
        onClick={() => applyOpen(!isOpen)}
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
  // Same per-experiment memory as CollapsibleSection (see SectionsScope).
  const scope = React.useContext(SectionsScope);
  const memoryKey = scope ? String(id || title || '') : null;
  const [open, setOpen] = useState(() => readSectionOpen(scope, memoryKey, defaultOpen));
  const sectionsCmd = useSectionsCommand();

  const applyOpen = (next) => {
    setOpen(next);
    writeSectionOpen(scope, memoryKey, next);
  };

  useEffect(() => {
    // A section already remembered for this experiment keeps ITS state; only
    // panels without memory follow the caller's default (e.g. the Library
    // opens the panel matching the current selection).
    if (!scope || readSectionOpen(scope, memoryKey, undefined) === undefined) setOpen(defaultOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  // Apply expand-all / collapse-all (also covers nested panels that mount
  // right after their parent opened).
  useEffect(() => {
    if (sectionsCmd !== null && sectionsCmd !== undefined) applyOpen(sectionsCmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsCmd]);

  return (
    <div id={id} className={`bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible scroll-mt-6 ${className}`}>
      <button
        type="button"
        onClick={() => applyOpen(!open)}
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
