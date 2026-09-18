/* =========================================================================
   src/utils/panelSelection.js
   « RÉGLER PLUSIEURS PANNEAUX D'UN COUP » — la sélection multiple du builder.

   Le canvas est une grille : un panneau est une boîte en CASES (x, y, w, h) et
   les gestes de la souris (déplacer, redimensionner) la bornent à la grille —
   un panneau ne sort jamais du canvas. Sélectionner PLUSIEURS panneaux (Ctrl+clic
   sur le canvas, ou les pastilles « Panels ») ne change qu'une chose : le
   panneau TENU est la RÉFÉRENCE — le PREMIER sélectionné — et les autres le
   suivent :
     • le déplacer les déplace tous du même écart ;
     • le redimensionner leur donne SA taille.

   Deux règles valent pour les deux gestes :
     • personne ne quitte la grille : l'écart commun est borné par le panneau le
       plus contraint du groupe, et une taille qui ferait sortir un panneau le
       ramène dans la grille (quitte à le décaler) ;
     • tout est calculé depuis un INSTANTANÉ pris au DÉBUT du glissement
       (`boxes` / `figs`) : les écritures sont ABSOLUES, un long glissement
       n'accumule aucun arrondi, et relâcher puis reprendre la souris repart de
       la même base.

   Les mêmes règles servent aux FIGURES d'un panneau : celle qui porte les
   poignées (l'ACTIVE) est la référence, celles qui sont cochées dans la liste
   « Figures in this panel » prennent sa taille et suivent ses déplacements —
   chacune à SA place.

   Tout est PUR (aucun DOM) : _builder_multiselect_test.mjs vérifie ce code-ci.
   ========================================================================= */

import { RECT_MIN, RECT_MAX } from './figureLayout';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round4 = (v) => +num(v).toFixed(4);

/** L'écart de grille que le groupe peut encore prendre sans que PERSONNE ne
 *  quitte le canvas. Un groupe dont un panneau est déjà hors grille (canvas
 *  enregistré avant un changement de format) ne bouge pas : mieux vaut un geste
 *  sans effet qu'un saut inattendu.
 *  @param {object} boxes  instantané `{ id: { x, y, w, h } }`
 *  @returns {{dxMin:number, dxMax:number, dyMin:number, dyMax:number}} */
export const moveDeltaRange = (boxes, gridCols, gridRows) => {
  const cols = Math.max(1, num(gridCols, 1));
  const rows = Math.max(1, num(gridRows, 1));
  const list = Object.keys(boxes || {}).map((k) => boxes[k]).filter(Boolean);
  if (!list.length) return { dxMin: 0, dxMax: 0, dyMin: 0, dyMax: 0 };
  let dxMin = -Infinity, dxMax = Infinity, dyMin = -Infinity, dyMax = Infinity;
  list.forEach((b) => {
    const x = num(b.x), y = num(b.y);
    const w = Math.max(1, num(b.w, 1)), h = Math.max(1, num(b.h, 1));
    dxMin = Math.max(dxMin, -x);
    dxMax = Math.min(dxMax, cols - x - w);
    dyMin = Math.max(dyMin, -y);
    dyMax = Math.min(dyMax, rows - y - h);
  });
  if (dxMin > dxMax) dxMin = dxMax = 0;
  if (dyMin > dyMax) dyMin = dyMax = 0;
  return { dxMin, dxMax, dyMin, dyMax };
};

/** Un écart ramené dans ses bornes. */
export const clampDelta = (v, min, max) => {
  const n = Math.round(num(v));
  return Math.max(min, Math.min(max, n));
};

/** Les nouvelles places d'un déplacement GROUPÉ : le même écart pour tous,
 *  borné pour que personne ne quitte la grille.
 *  @returns {object} `{ id: { x, y } }` — les cases d'arrivée, en nombres entiers
 *  (un panneau est toujours ENTIER sur la grille). */
export const moveSelectionPatches = (boxes, dCols, dRows, gridCols, gridRows) => {
  const range = moveDeltaRange(boxes, gridCols, gridRows);
  const dx = clampDelta(dCols, range.dxMin, range.dxMax);
  const dy = clampDelta(dRows, range.dyMin, range.dyMax);
  const out = {};
  Object.keys(boxes || {}).forEach((id) => {
    const b = boxes[id];
    if (!b) return;
    out[id] = { x: Math.round(num(b.x) + dx), y: Math.round(num(b.y) + dy) };
  });
  return out;
};

/** La taille du panneau de RÉFÉRENCE après un glissement de `dCols`/`dRows`
 *  cases : la même formule que la poignée d'un panneau seul — au moins 1 case,
 *  et jamais au-delà du bord droit / bas de la grille (le panneau tenu garde son
 *  coin haut-gauche, donc sa taille est bornée par sa propre position). */
export const resizedBox = (box, dCols, dRows, gridCols, gridRows) => {
  const cols = Math.max(1, num(gridCols, 1));
  const rows = Math.max(1, num(gridRows, 1));
  const x = num(box && box.x), y = num(box && box.y);
  return {
    w: Math.max(1, Math.min(cols - x, num(box && box.w, 1) + Math.round(num(dCols)))),
    h: Math.max(1, Math.min(rows - y, num(box && box.h, 1) + Math.round(num(dRows))))
  };
};


/** « resize them all as the first selected » : la taille de la RÉFÉRENCE est
 *  écrite sur CHAQUE panneau sélectionné. Chacun garde sa place — ramenée dans
 *  la grille si la nouvelle taille l'en ferait sortir : un panneau doit rester
 *  ENTIER sur le canvas (sinon la moitié de sa figure disparaîtrait de la
 *  composition). La référence, elle, garde son coin : sa taille a été bornée par
 *  `resizedBox` à ce que sa propre position permet.
 *  @param {object} boxes   instantané `{ id: { x, y, w, h } }`
 *  @param {string} refId   l'identifiant de la référence (celle qu'on tient)
 *  @param {{w:number, h:number}} size  la taille d'arrivée de la référence
 *  @returns {object} `{ id: { w, h } }` (et `x`/`y` pour ceux qu'il faut replacer) */
export const resizeSelectionPatches = (boxes, refId, size, gridCols, gridRows) => {
  const cols = Math.max(1, num(gridCols, 1));
  const rows = Math.max(1, num(gridRows, 1));
  const w = Math.max(1, Math.min(cols, Math.round(num(size && size.w, 1))));
  const h = Math.max(1, Math.min(rows, Math.round(num(size && size.h, 1))));
  const out = {};
  Object.keys(boxes || {}).forEach((id) => {
    const b = boxes[id];
    if (!b) return;
    if (id === refId) { out[id] = { w, h }; return; }
    out[id] = {
      w,
      h,
      x: Math.max(0, Math.min(cols - w, Math.round(num(b.x)))),
      y: Math.max(0, Math.min(rows - h, Math.round(num(b.y))))
    };
  });
  return out;
};

/* ── LES FIGURES D'UN PANNEAU ────────────────────────────────────────────────
   Mêmes deux gestes, une seule différence : la taille d'une figure est une
   BOÎTE en fractions du panneau (`im.rect` — voir utils/figureLayout.js) pour
   une figure en disposition LIBRE, ou une ÉCHELLE (`im.scale`) pour une figure
   encore rangée dans la grille du panneau. Une figure libre reçoit donc la
   BOÎTE de la référence (sa taille exacte) ; une figure en grille grandit du
   même FACTEUR — elle n'a pas de boîte à copier. */

/** Le facteur de redimensionnement de la FIGURE tenue, lu sur l'instantané du
 *  début du glissement (`dxMm` = déplacement horizontal de la souris en mm).
 *  Les bornes sont celles de la poignée d'une figure seule : jamais moins de
 *  10 % / plus de 600 % pour une figure libre, 30 %…400 % pour une figure en
 *  grille. */
export const figureResizeFactor = (refFig, { dxMm, cellW, panelW, imgCols } = {}) => {
  const dx = num(dxMm);
  const panel = Math.max(1e-6, num(panelW, 1));
  const cell = Math.max(1e-6, num(cellW, 1));
  const rect = refFig && refFig.rect;
  if (rect) {
    const base = Math.max(2, num(rect.w) * panel * cell);
    return Math.max(0.1, Math.min(6, (base + dx) / base));
  }
  const figW = Math.max(10, (panel * cell) / Math.max(1, Math.round(num(imgCols, 2))));
  return Math.max(0.3, Math.min(4, 1 + dx / figW));
};

const rectSide = (v) => round4(Math.max(RECT_MIN, Math.min(RECT_MAX, num(v))));

/** Les nouvelles boîtes des figures d'une sélection multiple : la RÉFÉRENCE
 *  (celle qu'on tient) donne SA taille, chaque autre figure garde sa place.
 *  @param {Array} figs   instantané `[{ idx, rect|null, scale }]` (voir figureSnapshot)
 *  @param {number} refIdx  l'index de la figure tenue (la première sélectionnée)
 *  @param {number} factor  son facteur de redimensionnement
 *  @returns {object} `{ [idx]: patch }` — `{ rect }` pour une figure libre,
 *  `{ scale }` pour une figure encore en grille */
export const resizeFiguresPatches = (figs, refIdx, factor) => {
  const list = (Array.isArray(figs) ? figs : []).filter(Boolean);
  const f = Math.max(0.05, num(factor, 1));
  const ref = list.find((x) => x.idx === refIdx) || null;
  const size = ref && ref.rect
    ? { w: rectSide(num(ref.rect.w) * f), h: rectSide(num(ref.rect.h) * f) }
    : null;
  const out = {};
  list.forEach((fig) => {
    const rect = fig.rect;
    if (rect && size) out[fig.idx] = { rect: { ...rect, w: size.w, h: size.h } };
    else if (rect) out[fig.idx] = { rect: { ...rect, w: rectSide(num(rect.w) * f), h: rectSide(num(rect.h) * f) } };
    else out[fig.idx] = { scale: +(num(fig.scale, 1) * f).toFixed(3) };
  });
  return out;
};

/** Les nouvelles places des figures d'un DÉPLACEMENT groupé : le même écart en
 *  millimètres pour toutes, chacune dans SA coordonnée (la boîte libre d'une
 *  part, le décalage `dx`/`dy` de la grille d'autre part). Une boîte libre peut
 *  sortir du panneau — c'est ainsi qu'on en cache une partie — mais jamais
 *  entièrement : il en reste toujours une lisière attrapable.
 *  @param {Array} figs  instantané `[{ idx, rect|null, dx, dy }]`
 *  @param {{dxMm:number, dyMm:number, panelWmm:number, panelHmm:number}} opts
 *  @returns {object} `{ [idx]: { rect } | { dx, dy } }` */
export const moveFiguresPatches = (figs, { dxMm, dyMm, panelWmm, panelHmm } = {}) => {
  const dx = num(dxMm), dy = num(dyMm);
  const pw = Math.max(1e-6, num(panelWmm, 1));
  const ph = Math.max(1e-6, num(panelHmm, 1));
  const out = {};
  (Array.isArray(figs) ? figs : []).forEach((fig) => {
    if (!fig) return;
    if (!fig.rect) {
      out[fig.idx] = { dx: +(num(fig.dx) + dx).toFixed(2), dy: +(num(fig.dy) + dy).toFixed(2) };
      return;
    }
    const r = fig.rect;
    out[fig.idx] = {
      rect: {
        ...r,
        x: round4(Math.max(RECT_MIN - num(r.w), Math.min(1 - RECT_MIN, num(r.x) + dx / pw))),
        y: round4(Math.max(RECT_MIN - num(r.h), Math.min(1 - RECT_MIN, num(r.y) + dy / ph)))
      }
    };
  });
  return out;
};
