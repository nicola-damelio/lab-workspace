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

import { RECT_MIN, RECT_MAX, normFreeRect } from './figureLayout';

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

/* ── LES QUATRE COINS D'UNE FIGURE ───────────────────────────────────────────
   La poignée d'une figure ne se trouvait qu'au coin BAS-DROITE et ne suivait
   que la moitié du pointeur (deux plaintes : « I can only resize from the
   bottom-right corner » et « it goes too slow »). Les quatre coins sont
   désormais des poignées, et le coin TENU suit le pointeur ONE TO ONE : `dxMm`
   et `dyMm` sont exactement le déplacement de la souris en millimètres. */

/** Les quatre coins d'une figure, dans l'ordre d'affichage — `n` = haut,
 *  `w` = gauche (le vocabulaire des poignées : `nw`, `ne`, `sw`, `se`). */
export const FIGURE_CORNERS = ['nw', 'ne', 'sw', 'se'];

/** Est-ce un coin connu ? Ce qui n'en est pas un retombe sur `se`, le geste
 *  d'avant (la poignée du coin bas-droite). */
export const isFigureCorner = (corner) => FIGURE_CORNERS.includes(corner);

/** Les quatre CENTRES de poignée d'une figure, calculés sur sa boîte VISIBLE
 *  (mm de canevas — `objFigureGeom` fournit `vX/vY/vW/vH`). `panel` et `margin`
 *  ramènent une poignée DANS le panneau : une figure poussée hors de son cadre
 *  est découpée par le panneau, sa poignée le serait aussi — invisible, donc
 *  impossible à reprendre. `margin` = le rayon de la zone de saisie.
 *  @param {{x,y,w,h}} box    boîte visible de la figure (mm)
 *  @param {{x,y,w,h}} [panel]  boîte du panneau (mm) — facultative
 *  @param {number} [margin]  rayon de la poignée (mm)
 *  @returns {Array<{corner:string,x:number,y:number}>} */
export const figureCornerPoints = (box, panel = null, margin = 0) => {
  const b = box || {};
  const x1 = num(b.x), y1 = num(b.y);
  const x2 = x1 + num(b.w), y2 = y1 + num(b.h);
  const pts = [
    { corner: 'nw', x: x1, y: y1 },
    { corner: 'ne', x: x2, y: y1 },
    { corner: 'sw', x: x1, y: y2 },
    { corner: 'se', x: x2, y: y2 }
  ];
  if (!panel) return pts;
  const m = Math.max(0, num(margin));
  const loX = num(panel.x) + m, hiX = num(panel.x) + num(panel.w) - m;
  const loY = num(panel.y) + m, hiY = num(panel.y) + num(panel.h) - m;
  const inside = (v, lo, hi) => +Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi)).toFixed(3);
  return pts.map((p) => ({ corner: p.corner, x: inside(p.x, loX, hiX), y: inside(p.y, loY, hiY) }));
};

/** Le facteur de redimensionnement de la FIGURE tenue, lu sur l'instantané du
 *  début du glissement (`dxMm`/`dyMm` = déplacement de la souris en mm).
 *  `corner` est le coin TENU : chaque axe est signé par la direction qui
 *  AGRANDIT (tirer vers la gauche agrandit un coin `w`, vers la droite un coin
 *  `e`) et c'est l'axe le plus franchement tiré qui donne le facteur — un geste
 *  franchement horizontal agrandit donc autant qu'un geste diagonal, un geste
 *  franchement vertical agrandit aussi (l'ancienne formule ignorait `dyMm`), et
 *  jamais « au ralenti » (l'ancienne moitié de pointeur). La taille reste
 *  PROPORTIONNELLE : un seul facteur pour la largeur et la hauteur.
 *  Les bornes sont celles de la poignée d'une figure seule : jamais moins de
 *  10 % / plus de 600 % pour une figure libre, 30 %…400 % pour une figure en
 *  grille. */
export const figureResizeFactor = (refFig, { dxMm, dyMm, corner = 'se', cellW, panelW, imgCols } = {}) => {
  const panel = Math.max(1e-6, num(panelW, 1));
  const cell = Math.max(1e-6, num(cellW, 1));
  const sx = String(corner).includes('w') ? -1 : 1;
  const sy = String(corner).includes('n') ? -1 : 1;
  const rect = refFig && refFig.rect;
  if (rect) {
    const baseW = Math.max(2, num(rect.w) * panel * cell);
    const baseH = Math.max(2, num(rect.h) * panel * cell);
    return clampFactor(1 + pulledMost(sx * num(dxMm), baseW, sy * num(dyMm), baseH), 0.1, 6);
  }
  /* Repli : une figure qui n'a PAS de rectangle (elle est encore rangée par la
     grille du panneau). La grille ne connaît qu'une largeur de cellule — les
     deux axes partagent donc la même base. */
  const figW = Math.max(10, (panel * cell) / Math.max(1, Math.round(num(imgCols, 2))));
  return clampFactor(1 + pulledMost(sx * num(dxMm), figW, sy * num(dyMm), figW), 0.3, 4);
};

/** L'axe le plus franchement tiré, en proportion de SA base : `vx` mm sur
 *  `baseX` mm d'un côté, `vy` mm sur `baseY` mm de l'autre. Un geste d'un seul
 *  axe (l'autre à zéro) gagne toujours — c'est lui qui est franc — et un geste
 *  diagonal donne le même facteur des deux côtés. */
const pulledMost = (vx, baseX, vy, baseY) => {
  const rx = num(vx) / Math.max(1e-6, num(baseX, 1));
  const ry = num(vy) / Math.max(1e-6, num(baseY, 1));
  return Math.abs(rx) >= Math.abs(ry) ? rx : ry;
};
const clampFactor = (v, lo, hi) => Math.max(lo, Math.min(hi, num(v, 1)));

const rectSide = (v) => round4(Math.max(RECT_MIN, Math.min(RECT_MAX, num(v))));

/** La boîte d'une figure au coin tenu : elle reçoit la taille `(w, h)` et le
 *  coin OPPOSÉ à la poignée reste exactement où il était — c'est l'ANCRE du
 *  geste (le coin ne fuit jamais sous la main). Une figure `nw` grandit donc
 *  vers le haut-gauche : son bord droit et son bord bas ne bougent pas. */
const cornerRect = (rect, corner, w, h) => {
  const side = rectSide(w), other = rectSide(h);
  return {
    x: round4(corner.includes('w') ? num(rect.x) + num(rect.w) - side : num(rect.x)),
    y: round4(corner.includes('n') ? num(rect.y) + num(rect.h) - other : num(rect.y)),
    w: side,
    h: other
  };
};

/** Les nouvelles boîtes des figures d'une sélection multiple : la RÉFÉRENCE
 *  (celle qu'on tient) donne SA taille, chaque autre figure garde sa place.
 *  `corner` est le coin TENU (voir cornerRect) : une figure `nw` grandit vers
 *  le haut-gauche, son coin bas-droite ne bougeant pas.
 *  @param {Array} figs   instantané `[{ idx, rect|null, scale }]` (voir figureSnapshot)
 *  @param {number} refIdx  l'index de la figure tenue (la première sélectionnée)
 *  @param {number} factor  son facteur de redimensionnement
 *  @param {string} [corner]  le coin de la poignée tenue (`se` par défaut)
 *  @returns {object} `{ [idx]: patch }` — `{ rect }` pour une figure libre,
 *  `{ scale }` pour une figure encore en grille */
export const resizeFiguresPatches = (figs, refIdx, factor, corner = 'se') => {
  const list = (Array.isArray(figs) ? figs : []).filter(Boolean);
  const f = Math.max(0.05, num(factor, 1));
  const c = isFigureCorner(corner) ? corner : 'se';
  const ref = list.find((x) => x.idx === refIdx) || null;
  const size = ref && ref.rect
    ? { w: rectSide(num(ref.rect.w) * f), h: rectSide(num(ref.rect.h) * f) }
    : null;
  const out = {};
  list.forEach((fig) => {
    const rect = fig.rect;
    if (rect && size) out[fig.idx] = { rect: cornerRect(rect, c, size.w, size.h) };
    else if (rect) out[fig.idx] = { rect: cornerRect(rect, c, num(rect.w) * f, num(rect.h) * f) };
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

/* ═══════════════════════════════════════════════════════════════════════════
   ALIGNER ET RÉPARTIR PLUSIEURS FIGURES D'UN PANNEAU.

   Les figures cochées « ☑ » d'un panneau (avec la figure ACTIVE pour référence,
   voir ImageBuilder) peuvent être rangées les unes PAR RAPPORT AUX AUTRES :
   alignées sur un bord du GROUPE — le plus à gauche de tous, son milieu… — ou
   réparties à intervalles ÉGAUX.

   Deux règles :

     • la référence est la BOÎTE DU GROUPE, jamais la figure tenue : l'extrême
       ne bouge donc pas, et la commande est symétrique (aligner à gauche puis à
       droite ramène les figures exactement où elles étaient, au dix-millième) ;
     • les deux fonctions travaillent sur les rectangles des figures DÉJÀ gelées
       (l'appelant appelle freezeFigures avant — voir utils/figureLayout.js) :
       une figure encore rangée par la grille reçoit d'abord la boîte EXACTE
       qu'elle montre à l'écran, sinon « aligner » serait le moment où le
       panneau se re-flowe.

   Comme moveFiguresPatches, une boîte peut dépasser du panneau mais jamais le
   quitter entièrement (il en reste toujours une lisière attrapable), et rien ne
   bouge → `{}` : ni écriture, ni étape d'historique.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les six alignements et les deux axes de répartition acceptés. */
export const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
export const DISTRIBUTE_AXES = ['h', 'v'];

/** Une position de boîte libre (fractions du panneau) : finie, jamais assez
 *  loin pour qu'une figure quitte entièrement son panneau (voir moveFiguresPatches). */
const rectPos = (v, size) => round4(Math.max(RECT_MIN - num(size), Math.min(1 - RECT_MIN, num(v))));

/** L'instantané utilisable d'un groupe : `[{ idx, rect }]`, boîtes validées. */
const rectList = (figs) => (Array.isArray(figs) ? figs : [])
  .map((f) => (f ? { idx: Number(f.idx), rect: normFreeRect(f.rect) } : null))
  .filter((f) => f && f.rect && Number.isFinite(f.idx));

/* ═══════════════════════════════════════════════════════════════════════════
   ALIGNER ET RÉPARTIR UN GROUPE **MIXTE** : LES FIGURES **ET** LES TEXTES.

   Un panneau porte des FIGURES et des TEXTES, et « ⇹ » range les deux (c'est
   la demande : « l'outil d'alignement doit servir aux figures ou aux textes
   d'un panneau »). L'appelant (ImageBuilder.jsx) convertit chaque élément en une
   BOÎTE exprimée en FRACTIONS du panneau — le rectangle libre d'une figure, ou
   la boîte d'un texte (sa position en mm, sa largeur estimée et son corps de
   police) — et donne à chacun un identifiant. Ces deux fonctions-ci ne
   connaissent QUE des boîtes : elles servent donc à une figure, à un texte, ou
   aux deux à la fois, sans le savoir.

   Les fonctions historiques (alignFiguresPatches / distributeFiguresPatches,
   vérifiées par _builder_multiselect_test.mjs) sont désormais de minces
   enveloppes autour de celles-ci : une seule géométrie, deux emballages.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les boîtes utilisables d'un groupe mixte : `[{ id, box }]`, boîtes validées. */
const boxList = (boxes) => (Array.isArray(boxes) ? boxes : [])
  .map((b) => (b && b.id != null && String(b.id) ? { id: String(b.id), box: normFreeRect(b.box) } : null))
  .filter((b) => b && b.box);

/**
 * Les nouvelles positions d'un groupe MIXTE aligné sur la boîte du groupe.
 * @param {Array} boxes  `[{ id, box: {x,y,w,h} }]` — fractions du panneau
 * @param {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} mode
 * @returns {object} `{ [id]: { x, y } }` — vide quand il n'y a rien à faire
 *                   (moins de deux boîtes, mode inconnu, ou déjà alignées)
 */
export const alignGroupPatches = (boxes, mode) => {
  const list = boxList(boxes);
  if (list.length < 2 || !ALIGN_MODES.includes(mode)) return {};
  const left = Math.min(...list.map((b) => b.box.x));
  const right = Math.max(...list.map((b) => b.box.x + b.box.w));
  const top = Math.min(...list.map((b) => b.box.y));
  const bottom = Math.max(...list.map((b) => b.box.y + b.box.h));
  const out = {};
  list.forEach((b) => {
    const r = b.box;
    let x = r.x;
    let y = r.y;
    if (mode === 'left') x = left;
    else if (mode === 'right') x = right - r.w;
    else if (mode === 'hcenter') x = (left + right) / 2 - r.w / 2;
    else if (mode === 'top') y = top;
    else if (mode === 'bottom') y = bottom - r.h;
    else y = (top + bottom) / 2 - r.h / 2;
    const nx = rectPos(x, r.w);
    const ny = rectPos(y, r.h);
    if (Math.abs(nx - r.x) > 1e-4 || Math.abs(ny - r.y) > 1e-4) out[b.id] = { x: nx, y: ny };
  });
  return out;
};

/* ═══════════════════════════════════════════════════════════════════════════
   RÉPARTIR UN GROUPE MIXTE : le même intervalle entre deux voisins, le long
   d'un axe. Les deux extrêmes ne bougent pas — c'est ce qui rend la commande
   prévisible (elle répartit ce qui est ENTRE eux). Sous trois éléments, ou quand
   rien ne bouge → `{}`.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les nouvelles positions d'un groupe MIXTE réparti le long d'un axe.
 * @param {Array} boxes  `[{ id, box: {x,y,w,h} }]` — fractions du panneau
 * @param {'h'|'v'} axis  horizontal (l'axe des x) ou vertical (l'axe des y)
 * @returns {object} `{ [id]: { x } }` ou `{ [id]: { y } }` selon l'axe
 */
export const distributeGroupPatches = (boxes, axis = 'h') => {
  const list = boxList(boxes);
  if (list.length < 3 || !DISTRIBUTE_AXES.includes(axis)) return {};
  const k = axis === 'h' ? 'x' : 'y';
  const s = axis === 'h' ? 'w' : 'h';
  // Départage stable : à positions égales, l'identifiant décide (deux textes
  // posés au même endroit gardent donc le même ordre d'un clic à l'autre).
  const sorted = list.slice().sort((a, b) => (a.box[k] - b.box[k]) || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = first.box[k];
  const span = (last.box[k] + last.box[s]) - start;
  const total = sorted.reduce((acc, b) => acc + b.box[s], 0);
  const gap = (span - total) / (sorted.length - 1);
  const out = {};
  let cursor = start;
  sorted.forEach((b, i) => {
    if (i > 0 && i < sorted.length - 1) {
      const nv = rectPos(cursor, b.box[s]);
      /* Le patch ne porte QUE l'axe réparti : l'autre coordonnée n'est pas
         écrite, et les deux extrêmes n'ont aucun patch. C'est un DELTA, pas une
         boîte — l'appelant le FUSIONNE donc avec la boîte de l'élément
         (`{ ...boîte, ...patch }`). Lire `patch.x` et `patch.y` comme une boîte
         complète donne `undefined` → NaN millimètres → l'élément disparaît
         (c'est ce que faisait ImageBuilder pour les textes : 7 objets répartis,
         5 disparus, seuls les deux extrêmes restaient). */
      if (Math.abs(nv - b.box[k]) > 1e-4) out[b.id] = { [k]: nv };
    }
    cursor += b.box[s] + gap;
  });
  return out;
};

/** Les patchs d'un groupe mixte remis en patchs de FIGURES : `{ [idx]: { rect } }`. */
const numberedPatches = (list, patches) => {
  const out = {};
  list.forEach((f) => {
    const p = patches[String(f.idx)];
    if (p) out[f.idx] = { rect: { ...f.rect, ...p } };
  });
  return out;
};

/**
 * Les nouvelles boîtes des figures d'un groupe ALIGNÉ sur la boîte du groupe.
 * @param {Array} figs  instantané `[{ idx, rect }]` (toutes avec un rectangle)
 * @param {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} mode
 * @returns {object} `{ [idx]: { rect } }` — vide quand il n'y a rien à faire
 *                   (moins de deux figures, mode inconnu, ou déjà alignées)
 */
export const alignFiguresPatches = (figs, mode) => {
  const list = rectList(figs);
  return numberedPatches(list, alignGroupPatches(list.map((f) => ({ id: String(f.idx), box: f.rect })), mode));
};

/**
 * Les nouvelles boîtes d'un groupe RÉPARTI : le même intervalle entre deux
 * figures voisines, le long d'un axe. Les deux extrêmes ne bougent pas — c'est
 * ce qui rend la commande prévisible (elle répartit ce qui est entre eux).
 * @param {Array} figs  instantané `[{ idx, rect }]`
 * @param {'h'|'v'} axis  horizontal (l'axe des x, colonnes) ou vertical (y)
 * @returns {object} `{ [idx]: { rect } }` — vide sous trois figures (répartir
 *                   deux figures n'a aucun sens) ou quand rien ne bouge
 */
export const distributeFiguresPatches = (figs, axis = 'h') => {
  const list = rectList(figs);
  return numberedPatches(list, distributeGroupPatches(list.map((f) => ({ id: String(f.idx), box: f.rect })), axis));
};

/* ════════════════════════════════════════════════════════════════════════════
   ALIGNER / RÉPARTIR LES PANNEAUX (les “objets” du canvas) — même grammaire que
   pour les figures, mais sur la GRILLE : un panneau occupe des CELLULES entières
   (`{ x, y, w, h }` en cellules, voir blankObject), donc ces commandes rendent
   des positions de cellules, arrondies et ramenées DANS la grille.
   `gridCols` / `gridRows` bornent le résultat : un panneau aligné ne peut pas
   sortir du canvas (il serait inatteignable à la souris).

   Les deux extrêmes ne bougent pas quand on répartit (la commande répartit ce
   qui est ENTRE eux), et rien à faire → `{}` : ni écriture, ni étape
   d'historique.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une boîte de panneau utilisable : cellules entières, taille ≥ 1 cellule. */
const cellBox = (b) => {
  if (!b) return null;
  return {
    id: String(b.id == null ? '' : b.id),
    w: Math.max(1, Math.round(num(b.w, 1))),
    h: Math.max(1, Math.round(num(b.h, 1))),
    x: Math.round(num(b.x, 0)),
    y: Math.round(num(b.y, 0))
  };
};
const cellList = (boxes) => (Array.isArray(boxes) ? boxes : []).map(cellBox).filter((b) => b && b.id);

/**
 * Les nouvelles positions (cellules) d'un groupe de PANNEAUX aligné.
 * @param {Array} boxes  `[{ id, x, y, w, h }]` en cellules
 * @param {'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom'} mode
 * @param {{gridCols?:number, gridRows?:number}} grid  bornes du canvas
 * @returns {object} `{ [id]: { x, y } }` — vide s'il n'y a rien à faire
 */
export const alignBoxesPatches = (boxes, mode, { gridCols = 99, gridRows = 99 } = {}) => {
  const list = cellList(boxes);
  if (list.length < 2 || !ALIGN_MODES.includes(mode)) return {};
  const left = Math.min(...list.map((b) => b.x));
  const right = Math.max(...list.map((b) => b.x + b.w));
  const top = Math.min(...list.map((b) => b.y));
  const bottom = Math.max(...list.map((b) => b.y + b.h));
  const out = {};
  list.forEach((b) => {
    let x = b.x;
    let y = b.y;
    if (mode === 'left') x = left;
    else if (mode === 'right') x = right - b.w;
    else if (mode === 'hcenter') x = Math.round((left + right) / 2 - b.w / 2);
    else if (mode === 'top') y = top;
    else if (mode === 'bottom') y = bottom - b.h;
    else y = Math.round((top + bottom) / 2 - b.h / 2);
    const nx = Math.max(0, Math.min(Math.max(0, gridCols - b.w), x));
    const ny = Math.max(0, Math.min(Math.max(0, gridRows - b.h), y));
    if (nx !== b.x || ny !== b.y) out[b.id] = { x: nx, y: ny };
  });
  return out;
};

/**
 * Les nouvelles positions (cellules) d'un groupe de PANNEAUX réparti : le même
 * intervalle entre deux voisins, le long d'un axe. Les deux extrêmes ne bougent
 * pas. Sous trois panneaux, ou quand rien ne bouge → `{}`.
 * @param {Array} boxes  `[{ id, x, y, w, h }]` en cellules
 * @param {'h'|'v'} axis  horizontal (colonnes) ou vertical (lignes)
 * @param {{gridCols?:number, gridRows?:number}} grid
 */
export const distributeBoxesPatches = (boxes, axis = 'h', { gridCols = 99, gridRows = 99 } = {}) => {
  const list = cellList(boxes);
  if (list.length < 3 || !DISTRIBUTE_AXES.includes(axis)) return {};
  const k = axis === 'h' ? 'x' : 'y';
  const s = axis === 'h' ? 'w' : 'h';
  const bound = axis === 'h' ? gridCols : gridRows;
  const sorted = list.slice().sort((a, b) => (a[k] - b[k]) || a.id.localeCompare(b.id));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = first[k];
  const span = (last[k] + last[s]) - start;      // du bord du premier au bord opposé du dernier
  const total = sorted.reduce((acc, b) => acc + b[s], 0);
  // L'intervalle commun peut être NÉGATIF (des panneaux se chevauchent) : ils se
  // chevauchent alors également, ce qui est le sens de la commande.
  const gap = (span - total) / (sorted.length - 1);
  const out = {};
  let cursor = start;
  sorted.forEach((b, i) => {
    if (i > 0 && i < sorted.length - 1) {
      const nv = Math.max(0, Math.min(Math.max(0, bound - b[s]), Math.round(cursor)));
      if (nv !== b[k]) out[b.id] = { [k]: nv };
    }
    cursor += b[s] + gap;
  });
  return out;
};

