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

   OWNED BY THE OPERATOR (see « À QUI APPARTIENT LA PEAU » below): how the
   program looks follows the SIGNED-IN OPERATOR — on a shared computer, signing
   in as somebody else repaints the program with HIS skin, and the skin travels
   with him to another computer (the `labWorkspace_uiSkin*` keys ride along with
   the other browser keys, see utils/workspaceKeyStore.js). It is still never
   part of the dataset or of the Doc, and EVERY user sees the control (like the
   display scale, see utils/uiScale.js).

   The default skin is the shipped palette itself: applying it REMOVES the
   attribute (nothing is restated for it, so it can never drift away from
   Tailwind's own values).
   ========================================================================= */

import { opNameKey } from './auth.js';

export const UI_SKIN_KEY = 'labWorkspace_uiSkin';

/* The reference — the colours the program ships with: no override at all. */
export const UI_SKIN_DEFAULT = 'slate';

/* LA PEAU PERSONNALISÉE — son id est déclaré ICI parce que le registre ci-dessous
   le référence (voir la section « LA PEAU PERSONNALISÉE », plus bas, pour tout le
   reste : l'accent, la famille neutre, la dérivation des onze crans). */
export const UI_SKIN_CUSTOM = 'custom';

/* ── À QUI APPARTIENT LA PEAU ───────────────────────────────────────────────
   « the skin must be associated to the operator as each operator must be able
   to choose his own preferred skin » : la peau n'est donc plus celle du POSTE,
   mais celle de l'OPÉRATEUR qui l'a choisie.

   DEUX ÉTAGES, parce qu'il y a deux échelles :
     · `labWorkspace_uiSkin_<propriétaire>` — la peau de CET opérateur ;
     · `labWorkspace_uiSkin` — celle du POSTE : ce qu'on voit quand personne
       n'est connecté (écran d'entrée, session fermée), ET la valeur de départ
       d'un opérateur qui n'a encore rien choisi — un poste neuf ne change donc
       pas de couleur sous les yeux de celui qui s'assied devant.

   Le PROPRIÉTAIRE est l'identifiant de l'opérateur (`currentUser.id`, celui de
   la liste des comptes) ou, tant qu'il n'y en a pas, son nom replié (opNameKey,
   voir utils/auth.js) : l'appariement des identités de ce programme se fait par
   le NOM (`operatorForName`, `memberIdentity`), donc ce repli désigne le même
   opérateur d'un chemin de connexion à l'autre. */
export const uiSkinOwnerOf = (operator) => {
  const op = operator && typeof operator === 'object' ? operator : {};
  const id = String(op.id == null ? '' : op.id).trim();
  return id || opNameKey(op.name);
};

/** La clé du navigateur qui porte la peau d'un opérateur — celle du POSTE quand
 *  on n'en connaît aucun. `base` nomme le réglage (la peau, son accent…) : le
 *  suffixe du propriétaire est le même pour tous. PUR. */
export const uiSkinKeyOf = (operator = null, base = UI_SKIN_KEY) => {
  const owner = uiSkinOwnerOf(operator);
  return owner ? `${base}_${owner}` : base;
};

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
  { id: 'purple', kind: 'hue', label: 'Purple', hint: 'purple accents', swatch: ['#fafafc', '#3b3355', '#241a3d', '#9810fa'] },
  { id: 'red', kind: 'hue', label: 'Red', hint: 'red accents', swatch: ['#faf7f6', '#4a3230', '#2b1b1a', '#e7000b'] },
  { id: 'rose', kind: 'hue', label: 'Rose', hint: 'rose accents', swatch: ['#fbf7f7', '#4a2f33', '#2c1a1d', '#ec003f'] },
  { id: 'dim', kind: 'tone', label: 'Dimmed', hint: 'softer light', swatch: ['#e8ebef', '#2b394d', '#172336', '#295dc4'] },
  { id: 'contrast', kind: 'tone', label: 'High contrast', hint: 'bolder ink', swatch: ['#fbfcfd', '#0c192a', '#030b1c', '#003dce'] },
  /* ── LA PEAU QUE L'UTILISATEUR POSSÈDE ─────────────────────────────────────
     La demande de cette session : « the skins in the setup are all too similar
     and NOT customizable ». Celle-ci répond aux deux : l'accent est CELUI QUE
     L'UTILISATEUR CHOISIT (huit propositions + une pipette libre) et la famille
     neutre se choisit aussi (celle du programme, le gris pur, le chaud). Les
     onze crans de l'accent sont DÉRIVÉS d'une seule couleur (voir
     uiSkinCustomRamp) : la palette garde la forme de celle du programme. */
  { id: UI_SKIN_CUSTOM, kind: 'hue', label: 'Custom…', hint: 'your accent + neutral', swatch: ['#f8fafc', '#314158', '#1d293d', '#009689'] }
];

/* ── LA PEAU PERSONNALISÉE ────────────────────────────────────────────────── */

/* (`UI_SKIN_CUSTOM` est déclaré plus haut, avec la référence : le registre le
   référence.) Ses onze crans d'accent ne vivent PAS dans index.css — ils sont
   écrits EN LIGNE par `applyUiSkin`, à partir d'UNE couleur (voir
   uiSkinCustomRamp). */

/** Clé localStorage du réglage — par OPÉRATEUR, comme la peau elle-même (voir
 *  uiSkinKeyOf) : deux opérateurs peuvent donc avoir chacun SON accent. */
export const UI_CUSTOM_KEY = 'labWorkspace_uiSkinCustom';

/** La clé qui porte l'accent + la famille neutre d'un opérateur (celle du POSTE
 *  quand on n'en connaît aucun). PUR. */
export const uiCustomSkinKeyOf = (operator = null) => uiSkinKeyOf(operator, UI_CUSTOM_KEY);

/** L'accent livré : le bleu du programme, pour qu'une peau personnalisée jamais
 *  réglée ressemble à la référence. */
export const UI_CUSTOM_ACCENT_DEFAULT = '#155dfc';

/** Le cran qui REÇOIT la couleur choisie. */
export const UI_CUSTOM_ACCENT_STOP = 600;

/** Les huit accents proposés — les hexadécimaux EXACTS des crans 600 de la
 *  palette que Tailwind livre (relevés dans son thème, pas inventés). */
export const UI_CUSTOM_ACCENTS = [
  { id: 'blue', label: 'Blue', color: '#155dfc' },
  { id: 'teal', label: 'Teal', color: '#009689' },
  { id: 'emerald', label: 'Emerald', color: '#009966' },
  { id: 'cyan', label: 'Cyan', color: '#0092b8' },
  { id: 'purple', label: 'Purple', color: '#9810fa' },
  { id: 'rose', label: 'Rose', color: '#ec003f' },
  { id: 'orange', label: 'Orange', color: '#f54900' },
  { id: 'pink', label: 'Pink', color: '#e60076' }
];

/** Les familles NEUTRES empruntables : celle du programme, le gris pur (les
 *  valeurs de la peau Graphite) et le chaud (celles de Warm paper). Le choix
 *  pose `data-tone` sur <html>, et index.css porte les valeurs. */
export const UI_CUSTOM_NEUTRALS = [
  { id: 'slate', label: 'Slate (shipped)' },
  { id: 'zinc', label: 'Zinc (pure grey)' },
  { id: 'stone', label: 'Stone (warm)' }
];
export const UI_CUSTOM_NEUTRAL_DEFAULT = 'slate';

/** LA FORME DU DÉGRADÉ LIVRÉ — les onze crans de bleu (L et C de chacun). C'est
 *  cette forme que la couleur choisie recolore : un accent personnalisé garde
 *  donc la STRUCTURE de luminosité de la référence, contraste compris. */
const BLUE_SHAPE = [
  [50, 97.0, 0.014], [100, 93.2, 0.032], [200, 88.2, 0.059], [300, 80.9, 0.105],
  [400, 70.7, 0.165], [500, 62.3, 0.214], [600, 54.6, 0.245], [700, 48.8, 0.243],
  [800, 42.4, 0.199], [900, 37.9, 0.146], [950, 28.2, 0.091]
];

/** sRGB hex → OKLCH (Ottosson) : l'inverse exact de ce qu'index.css écrit.
 *  `null` quand ce n'est pas une couleur hexadécimale à six chiffres. PUR. */
export const hexToOklch = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * mm - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.8086757660 * s;
  return { L: L * 100, C: Math.sqrt(A * A + B * B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
};

/** LES ONZE CRANS d'une couleur d'accent : le cran 600 EST la couleur choisie,
 *  et les dix autres gardent la forme du dégradé livré (même écart de
 *  luminosité, chroma proportionnel au cran 600). PUR. */
export const uiSkinCustomRamp = (accent = UI_CUSTOM_ACCENT_DEFAULT) => {
  const okl = hexToOklch(accent) || hexToOklch(UI_CUSTOM_ACCENT_DEFAULT);
  const dL = okl.L - 54.6;
  const k = okl.C / 0.245;
  const out = {};
  BLUE_SHAPE.forEach(([stop, l, c]) => {
    const L = Math.max(6, Math.min(99, l + dL));
    out[`--color-blue-${stop}`] = `oklch(${L.toFixed(1)}% ${Math.max(0, c * k).toFixed(3)} ${okl.H.toFixed(1)})`;
  });
  return out;
};

/** Le réglage retenu, toujours utilisable (une couleur illisible ou une famille
 *  inconnue retombent sur le défaut livré). PUR. */
export const uiCustomSkinOf = (raw) => ({
  accent: (raw && /^#[0-9a-f]{6}$/i.test(String(raw.accent || '')))
    ? String(raw.accent).toLowerCase() : UI_CUSTOM_ACCENT_DEFAULT,
  neutral: UI_CUSTOM_NEUTRALS.some((n) => n.id === (raw && raw.neutral))
    ? raw.neutral : UI_CUSTOM_NEUTRAL_DEFAULT
});

/** Les variables d'une peau personnalisée : les onze crans de l'accent, plus
 *  `--lab-tone` (la famille neutre, pour la miniature ET pour <html>). PUR. */
export const uiSkinCustomVars = (raw) => {
  const custom = uiCustomSkinOf(raw);
  return { ...uiSkinCustomRamp(custom.accent), '--lab-tone': custom.neutral };
};

/** Le réglage stocké (localStorage indisponible ⇒ le défaut livré) — celui de
 *  CET opérateur, sinon celui du POSTE, comme pour la peau elle-même. */
export const readUiCustomSkin = (operator = null) => {
  try {
    const own = uiCustomSkinKeyOf(operator);
    const raw = localStorage.getItem(own);
    if (raw !== null) return uiCustomSkinOf(JSON.parse(raw || 'null'));
    if (own !== UI_CUSTOM_KEY) return uiCustomSkinOf(JSON.parse(localStorage.getItem(UI_CUSTOM_KEY) || 'null'));
    return uiCustomSkinOf(null);
  } catch { return uiCustomSkinOf(null); }
};

/** Écrire le réglage — et APPLIQUER tout de suite quand la peau personnalisée
 *  est celle en service (sinon le réglage resterait sans effet). */
export const saveUiCustomSkin = (raw, operator = null) => {
  const custom = uiCustomSkinOf(raw);
  try { localStorage.setItem(uiCustomSkinKeyOf(operator), JSON.stringify(custom)); } catch { /* ignore */ }
  if (readUiSkin(operator) === UI_SKIN_CUSTOM) applyUiSkin(UI_SKIN_CUSTOM, operator);
  return custom;
};

/* The skin an id names, or the reference — so a name written by an older (or
   newer) build can never leave the program unstyled. */
export const uiSkinById = (id) => UI_SKINS.find((s) => s.id === id) || UI_SKINS[0];

/* The stored skin, always usable: anything unreadable or unknown falls back to
   the reference (localStorage may be unavailable — private mode).

   `operator` = the operator whose skin we want. When he has never chosen one,
   the COMPUTER's skin is the starter value (a machine that was already painted
   stays painted the same way the first time somebody signs in on it); without
   any operator at all, this IS the computer's skin. */
export const readUiSkin = (operator = null) => {
  try {
    const own = uiSkinKeyOf(operator);
    const raw = localStorage.getItem(own);
    if (raw !== null) return uiSkinById(raw).id;
    if (own !== UI_SKIN_KEY) {
      const device = localStorage.getItem(UI_SKIN_KEY);
      if (device !== null) return uiSkinById(device).id;
    }
    return UI_SKIN_DEFAULT;
  } catch {
    return UI_SKIN_DEFAULT;
  }
};

/* `id` = the reference ⇒ the attribute is REMOVED (the shipped palette comes
   back exactly as Tailwind defines it). The custom skin is the one case whose
   accent ramp is NOT in the stylesheet: its eleven stops depend on a colour the
   user picked, so they are written INLINE on <html> — and cleared for every
   other skin, or they would outlive the choice.
   `operator` : l'accent lu (peau personnalisée) est celui de CET opérateur. */
export const applyUiSkin = (id, operator = null) => {
  if (typeof document === 'undefined') return; // unit tests (node) have no DOM
  const root = document.documentElement;
  if (!root) return;
  const skin = uiSkinById(id);
  if (!root.dataset) return;
  const customKeys = [...Object.keys(uiSkinCustomRamp(UI_CUSTOM_ACCENT_DEFAULT)), '--lab-tone'];
  const clearCustom = () => {
    if (root.style) customKeys.forEach((k) => root.style.removeProperty(k));
    delete root.dataset.tone;
  };
  if (skin.id === UI_SKIN_CUSTOM) {
    const custom = readUiCustomSkin(operator);
    if (root.style) Object.entries(uiSkinCustomVars(custom)).forEach(([k, v]) => root.style.setProperty(k, v));
    root.dataset.tone = custom.neutral;
    root.dataset.skin = UI_SKIN_CUSTOM;
    return;
  }
  clearCustom();
  if (skin.id === UI_SKIN_DEFAULT) delete root.dataset.skin;
  else root.dataset.skin = skin.id;
};

/* Écrire la peau — celle de CET opérateur quand on en connaît un, celle du
   POSTE sinon (et c'est celle-ci qui sert de départ à tout opérateur : c'est
   donc aussi le geste de l'écran d'entrée, avant toute connexion). */
export const saveUiSkin = (id, operator = null) => {
  const skin = uiSkinById(id);
  try { localStorage.setItem(uiSkinKeyOf(operator), skin.id); } catch { /* ignore */ }
  applyUiSkin(skin.id, operator);
};

/* L'identité de l'onglet telle qu'App.jsx la mémorise (sessionStorage) : la peau
   de l'opérateur connecté peut donc être posée AVANT le premier rendu, sans
   attendre React — sinon un rechargement peindrait d'abord la palette du poste
   avant de revenir à la sienne. */
export const SESSION_OPERATOR_KEY = 'labCurrentUser';

/** L'opérateur de CETTE session, tel que l'application l'a mémorisé (null quand
 *  personne n'est connecté, ou quand la mémoire est illisible). Ne lit que
 *  sessionStorage — aucun effet de bord. */
export const sessionOperator = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_OPERATOR_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
};

/* Called once by main.jsx, before React renders — with the operator of the tab
   session when there is one. */
export const applyStoredUiSkin = (operator = null) => applyUiSkin(readUiSkin(operator), operator);

/* …et l'appel de main.jsx : la peau de l'opérateur de la session, sinon celle du
   poste. */
export const applyStoredUiSkinForSession = () => applyStoredUiSkin(sessionOperator());
