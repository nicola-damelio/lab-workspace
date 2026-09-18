/* =========================================================================
   src/utils/figureErase.js
   LA GOMME DE L'IMAGE BUILDER — effacer des PARTIES d'une figure.

   Une figure est un raster (dataURL) qui vit dans la bibliothèque d'images
   (Drive) : on ne peut donc pas modifier ses pixels — et surtout, le canvas
   n'en persiste qu'une VIGNETTE (`thumbnailsOf`), une retouche raster serait
   perdue au premier rechargement.

   La gomme est donc VECTORIELLE et NON DESTRUCTIVE : elle enregistre les
   TRAITS de la gomme dans le repère de la SOURCE (fractions 0…1 de l'image
   d'origine, comme le recadrage) et l'affichage pose un masque SVG sur la
   figure — les pixels touchés deviennent transparents, à la résolution de
   l'écran comme à 300 DPI (le masque est ré-évalué à chaque export).

     im.erase = [{ s: 0.034, p: [[0.12, 0.44], [0.13, 0.45], …] }, …]
                 s = diamètre du pinceau, en fraction de la LARGEUR de l'image
                 p = les points du trait, en fractions de la source

   Le diamètre suit donc la figure : redimensionner la figure agrandit le trou
   exactement comme les pixels autour de lui. Un trait d'un panneau ne touche
   jamais les figures qui n'ont pas été effleurées par le pinceau.

   Tout est PUR (aucun DOM, aucun React) : ImageBuilder.jsx s'en sert à l'écran
   et _builder_eraser_test.mjs vérifie exactement ce code-ci.
   ========================================================================= */

/** Diamètre du pinceau, en millimètres du canvas : bornes et valeur par défaut
 *  (réglable au clavier et à la souris — « une gomme dont on règle la taille »). */
export const ERASE_SIZE_MIN = 0.5;
export const ERASE_SIZE_MAX = 30;
export const ERASE_DEFAULT_SIZE = 4;

/** Deux points d'un même trait sont espacés d'au moins 35 % du pinceau : le
 *  trait reste lisse sans stocker des centaines de points (le canvas persiste
 *  ces traits) ; on n'en garde jamais plus de 240 par trait. */
export const ERASE_STEP = 0.35;
export const ERASE_MAX_POINTS = 240;

/** Le diamètre valide le plus proche de `mm` (borné, jamais NaN). */
export const clampEraseSize = (mm) => {
  const v = Number(mm);
  if (!Number.isFinite(v)) return ERASE_DEFAULT_SIZE;
  return Math.max(ERASE_SIZE_MIN, Math.min(ERASE_SIZE_MAX, +v.toFixed(2)));
};

const inUnit = (v) => Number.isFinite(v) && v >= -0.02 && v <= 1.02;

/** Les traits de gomme VALIDES d'une figure (idem `cropOf` : une donnée
 *  abîmée n'efface rien plutôt que d'effacer n'importe quoi). */
export const eraseStrokesOf = (im) => {
  const raw = im && im.erase;
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((st) => {
    const s = Number(st && st.s);
    if (!Number.isFinite(s) || s <= 0 || s > 0.5) return;      // 50 % de l'image au plus
    const pts = (Array.isArray(st && st.p) ? st.p : [])
      .filter((p) => Array.isArray(p) && inUnit(Number(p[0])) && inUnit(Number(p[1])))
      .map((p) => [+Number(p[0]).toFixed(4), +Number(p[1]).toFixed(4)]);
    if (!pts.length) return;
    out.push({ s: +s.toFixed(4), p: pts.slice(0, ERASE_MAX_POINTS) });
  });
  return out;
};

/** La boîte (mm du canvas) d'un trait en cours de tracé : ses points, élargis
 *  du rayon du pinceau. */
export const mmStrokeBox = (stroke) => {
  const pts = (stroke && stroke.pts) || [];
  if (!pts.length) return null;
  const r = clampEraseSize(stroke.sizeMm) / 2;
  const xs = pts.map((p) => Number(p[0]) || 0);
  const ys = pts.map((p) => Number(p[1]) || 0);
  const x = Math.min(...xs) - r, y = Math.min(...ys) - r;
  return { x, y, w: Math.max(...xs) + r - x, h: Math.max(...ys) + r - y };
};

/** Un trait touche-t-il la boîte (mm) d'une figure ? Évite de convertir un
 *  trait dans le repère de figures qu'il n'effleure même pas. */
export const mmStrokeHits = (stroke, box) => {
  const b = mmStrokeBox(stroke);
  if (!b || !box) return false;
  return b.x <= box.x + box.w && box.x <= b.x + b.w && b.y <= box.y + box.h && box.y <= b.y + b.h;
};

/** Ajoute un point au trait en cours (sans le dédoubler : deux points plus
 *  proches que le pas ne servent à rien). Renvoie le MÊME objet quand le point
 *  est ignoré — l'appelant peut donc éviter un rendu. */
export const pushStrokePoint = (stroke, x, y) => {
  const st = stroke && Array.isArray(stroke.pts) ? stroke : { sizeMm: clampEraseSize(stroke && stroke.sizeMm), pts: [] };
  if (st.pts.length >= ERASE_MAX_POINTS) return st;
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return st;
  const last = st.pts[st.pts.length - 1];
  if (last) {
    const step = Math.max(0.15, clampEraseSize(st.sizeMm) * ERASE_STEP);
    if (Math.hypot(px - last[0], py - last[1]) < step) return st;
  }
  return { ...st, pts: [...st.pts, [+px.toFixed(3), +py.toFixed(3)]] };
};


/** Le trait de la gomme dans le repère d'UNE figure : ses points deviennent des
 *  fractions de la source (les points hors de l'image sont ignorés — un trait
 *  qui frôle un panneau n'efface pas la figure voisine) et le pinceau une
 *  fraction de la largeur DESSINÉE (`geom` = ce que objFigureGeom vient de
 *  calculer : `iX/iY/iW/iH` = le rectangle qui porte l'image entière).
 *  @returns {{s:number,p:Array}|null} null quand le trait ne touche pas la figure */
export const mmStrokeToSource = (stroke, geom) => {
  const pts = (stroke && stroke.pts) || [];
  if (!pts.length || !geom || !(geom.iW > 0) || !(geom.iH > 0)) return null;
  const out = [];
  pts.forEach((p) => {
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < geom.iX || x > geom.iX + geom.iW || y < geom.iY || y > geom.iY + geom.iH) return;
    out.push([+((x - geom.iX) / geom.iW).toFixed(4), +((y - geom.iY) / geom.iH).toFixed(4)]);
  });
  if (!out.length) return null;
  const s = clampEraseSize(stroke.sizeMm) / geom.iW;
  return { s: +Math.max(0.0005, Math.min(0.5, s)).toFixed(4), p: out };
};

/** Le chemin SVG (mm du canvas) d'un trait de gomme STOCKÉ sur une figure —
 *  mêmes coordonnées que l'image, donc le masque tombe exactement dessus. */
export const strokePathMm = (stroke, geom) => {
  const pts = (stroke && stroke.p) || [];
  if (!pts.length || !geom) return '';
  const at = (p) => `${+(geom.iX + Number(p[0]) * geom.iW).toFixed(3)} ${+(geom.iY + Number(p[1]) * geom.iH).toFixed(3)}`;
  const head = `M ${at(pts[0])}`;
  if (pts.length === 1) return `${head} l 0.01 0`;   // un CLIC est un point : un point nul ne se dessine pas
  return head + pts.slice(1).map((p) => ` L ${at(p)}`).join('');
};

/** L'épaisseur (mm) du trait : le pinceau était rond à l'écran, il doit rester
 *  rond dans le masque. */
export const strokeWidthMm = (stroke, geom) => +(Number(stroke && stroke.s) * (geom ? geom.iW : 0)).toFixed(3);

/** Les traits prêts à peindre dans le masque d'une figure : `{ d, w }`.
 *  `extra` = le trait EN COURS de tracé (aperçu immédiat), déjà converti. */
export const maskStrokesMm = (strokes, geom, extra = null) => [...(strokes || []), ...(extra ? [extra] : [])]
  .map((st) => ({ d: strokePathMm(st, geom), w: strokeWidthMm(st, geom) }))
  .filter((st) => st.d && st.w > 0 && Number.isFinite(st.w));

/** Identifiant du masque SVG d'une figure. `sid` distingue les DEUX SVG de
 *  l'écran (la vue normale et le plein écran sont montés ensemble : deux
 *  éléments ne peuvent pas porter le même id). */
export const eraseMaskId = (sid, objId, idx) => `figerase-${sid || 'in'}-${objId}-${idx}`;
