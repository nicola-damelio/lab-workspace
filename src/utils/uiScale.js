/* =========================================================================
   src/utils/uiScale.js
   Display scale — ONE number that rescales every page of the program.

   Tailwind v4 (src/index.css → @import "tailwindcss") computes every text size
   and every spacing step from the ROOT character size (text-sm = 0.875rem,
   p-3 = 0.75rem, the sidebar w-64 = 16rem …). Moving that root size therefore
   scales the whole interface — characters, paddings, gaps, the sidebar, the
   modals — without touching a single component. src/index.css honours the same
   promise for the tiny arbitrary tokens (text-[8px] … text-[15px]) by restating
   them in rem.

   Stored per BROWSER (localStorage): how big the program has to be is a
   property of the screen/machine, not of the dataset, so it is deliberately
   NOT part of the dataset or of the Doc.

   Applied by main.jsx before the first render (so no page is ever painted at
   the wrong size) and by the Settings page → Display scale (see
   DisplayScaleControl in settingsModule.jsx).
   ========================================================================= */

export const UI_SCALE_KEY = 'labWorkspace_uiScale';

/* 0 = leave the browser's own default size (normally 16px) in place. */
export const UI_SCALE_BROWSER = 0;

/* A touch denser than 16px: the same page shows ~6% more content, which is
   what keeps the wide strips of the experiment header on ONE line on a
   laptop screen instead of wrapping into several rows. */
export const UI_SCALE_DEFAULT = 15;

/* Range that keeps the interface usable: 12px is low enough to still read
   (the 12px readability floor becomes 9px) and 18px is a comfortable
   large-screen size. */
export const UI_SCALE_MIN = 12;
export const UI_SCALE_MAX = 18;

/* What the Settings page offers, with the share of the standard 16px size. */
export const UI_SCALE_PRESETS = [
  { id: 'compact', px: 13, label: 'Compact', hint: '81%' },
  { id: 'tight', px: 14, label: 'Tight', hint: '88%' },
  { id: 'normal', px: 15, label: 'Normal', hint: '94%' },
  { id: 'browser', px: UI_SCALE_BROWSER, label: 'Browser default', hint: '100%' }
];

/* The stored value, always usable: anything unreadable falls back to the
   default and the number is clamped (a value written by an older/newer build
   must never be able to shrink the program to nothing). */
export const readUiScale = () => {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY);
    if (raw === null) return UI_SCALE_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
    if (n === UI_SCALE_BROWSER) return UI_SCALE_BROWSER;
    return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n)));
  } catch {
    /* Private mode / storage disabled: the default is perfectly usable. */
    return UI_SCALE_DEFAULT;
  }
};

/* `px = 0` removes the override and gives back the browser's own default size —
   that is what an accessibility setting (or a screen rendered by a reader)
   expects, so it must stay reachable. */
export const applyUiScale = (px) => {
  if (typeof document === 'undefined') return; // unit tests (node) have no DOM
  const root = document.documentElement;
  if (!root) return;
  if (!px) root.style.removeProperty('font-size');
  else root.style.fontSize = `${px}px`;
};

export const saveUiScale = (px) => {
  try { localStorage.setItem(UI_SCALE_KEY, String(px)); } catch { /* ignore */ }
  applyUiScale(px);
};

/* Called once by main.jsx, before React renders. */
export const applyStoredUiScale = () => applyUiScale(readUiScale());
