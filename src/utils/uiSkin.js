/* =========================================================================
   src/utils/uiSkin.js
   Interface SKINS — one palette for the whole program, chosen in Settings.

   Tailwind v4 does not inline its colours: `bg-slate-800` compiles to
   `background-color: var(--color-slate-800)` and `text-white` to
   `color: var(--color-white)`. src/index.css therefore only has to RESTATE
   those variables under `[data-skin="…"]` for every page, modal, badge and
   button to follow — not one component is touched, not one class edited.

   `data-skin` is set on <html> (by main.jsx, before the first paint) and may
   be set on ANY element: custom properties are inherited, so Settings shows a
   LIVE miniature of the interface by wrapping a small demo in the attribute.

   Stored per BROWSER (localStorage): how the program looks is a property of
   the machine and of the eyes in front of it, never of the dataset — so it is
   deliberately not part of the dataset or of the Doc, and EVERY user sees the
   control (like the display scale, see utils/uiScale.js).

   The default skin is the shipped palette itself: applying it REMOVES the
   attribute (nothing is restated for it, so it can never drift away from
   Tailwind's own values).
   ========================================================================= */

export const UI_SKIN_KEY = 'labWorkspace_uiSkin';

/* The reference — the colours the program ships with: no override at all. */
export const UI_SKIN_DEFAULT = 'slate';

/* ── The skins ──────────────────────────────────────────────────────────────
   `kind` is how the palette is derived, and the probe test holds each kind to
   its own rule: a `hue` skin SWAPS one accent family with another (so it may
   never move a stop by more than 4 points of OKLCH lightness), a `tone` skin
   restates a ramp stop for stop (`dim`, `contrast`) or borrows another neutral
   family (`graphite`, `warm`).
   `swatch` is only the picture of the four chips shown in Settings (page ·
   ink · chrome · accent) — the colours that PAINT the program live in
   src/index.css, one block per skin id. */
export const UI_SKINS = [
  { id: UI_SKIN_DEFAULT, kind: 'tone', label: 'Slate & blue', hint: 'the shipped look', swatch: ['#f8fafc', '#314158', '#1d293d', '#155dfc'] },
  { id: 'graphite', kind: 'tone', label: 'Graphite', hint: 'pure greys', swatch: ['#fafafa', '#3f3f46', '#27272a', '#155dfc'] },
  { id: 'warm', kind: 'tone', label: 'Warm paper', hint: 'warm neutrals', swatch: ['#fafaf9', '#44403b', '#292524', '#155dfc'] },
  { id: 'indigo', kind: 'hue', label: 'Indigo', hint: 'indigo accents', swatch: ['#f8fafc', '#314158', '#1d293d', '#4f39f6'] },
  { id: 'violet', kind: 'hue', label: 'Violet', hint: 'violet accents', swatch: ['#f8fafc', '#314158', '#1d293d', '#7f22fe'] },
  { id: 'dim', kind: 'tone', label: 'Dimmed', hint: 'softer light', swatch: ['#e8ebef', '#2b394d', '#172336', '#295dc4'] },
  { id: 'contrast', kind: 'tone', label: 'High contrast', hint: 'bolder ink', swatch: ['#fbfcfd', '#0c192a', '#030b1c', '#003dce'] }
];

/* The skin an id names, or the reference — so a name written by an older (or
   newer) build can never leave the program unstyled. */
export const uiSkinById = (id) => UI_SKINS.find((s) => s.id === id) || UI_SKINS[0];

/* The stored skin, always usable: anything unreadable or unknown falls back to
   the reference (localStorage may be unavailable — private mode). */
export const readUiSkin = () => {
  try {
    const raw = localStorage.getItem(UI_SKIN_KEY);
    if (raw === null) return UI_SKIN_DEFAULT;
    return uiSkinById(raw).id;
  } catch {
    return UI_SKIN_DEFAULT;
  }
};

/* `id` = the reference ⇒ the attribute is REMOVED (the shipped palette comes
   back exactly as Tailwind defines it). */
export const applyUiSkin = (id) => {
  if (typeof document === 'undefined') return; // unit tests (node) have no DOM
  const root = document.documentElement;
  if (!root) return;
  const skin = uiSkinById(id);
  if (!root.dataset) return;
  if (skin.id === UI_SKIN_DEFAULT) delete root.dataset.skin;
  else root.dataset.skin = skin.id;
};

export const saveUiSkin = (id) => {
  const skin = uiSkinById(id);
  try { localStorage.setItem(UI_SKIN_KEY, skin.id); } catch { /* ignore */ }
  applyUiSkin(skin.id);
};

/* Called once by main.jsx, before React renders. */
export const applyStoredUiSkin = () => applyUiSkin(readUiSkin());
