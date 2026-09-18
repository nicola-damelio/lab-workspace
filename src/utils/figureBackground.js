/* =========================================================================
   src/utils/figureBackground.js
   « ENLÈVE LE FOND DE LA FIGURE » — le fond devient TRANSPARENT.

   Une capture de graphe est un JPEG (fond blanc) : posée dans un panneau, elle
   se comporte comme un rectangle — impossible de la faire épouser la forme de
   ce qu'elle montre, et son ombre (voir utils/figureArrows, ombre de FIGURE)
   suit son rectangle au lieu de suivre son contenu.

   On ne peut pas effacer un fond en SVG : une couleur N'EST PAS une forme (le
   blanc du fond est le même blanc que celui des légendes). C'est donc un vrai
   travail sur les PIXELS — l'alpha de la source — fait une fois, à la demande,
   par ImageBuilder :
     1. les pixels de l'image sont lus dans un canvas (borné : BG_MAX_SIDE) ;
     2. removeBackgroundKey() met à 0 l'alpha de la couleur de fond — le fond
        CONNEXE aux bords (mode « flood », le défaut : le blanc à l'INTÉRIEUR
        d'un dessin est conservé) ou partout (mode « all ») ;
     3. softenBackgroundEdges() adoucit le bord : un pixel qui garde un reste de
        la couleur de fond devient PARTIELLEMENT transparent (sinon la découpe
        traîne un liseré clair) ;
     4. le canvas est ré-exporté en PNG, et ce sont CES pixels qui deviennent
        ceux de la figure (`im.imgSrc` + `im.imgThumb`, donc aussi la vignette
        que le canvas persiste) ;
     5. `im.bg = { color, tol, mode }` garde la trace du réglage — la fenêtre de
        l'objet peut dire « cette figure a été détourée » — et Ctrl+Z remet
        l'image d'origine (une seule étape d'historique).

   Tout est PUR (aucun DOM) et travaille sur des octets RGBA (`Uint8ClampedArray`
   de ImageData) : _builder_bgremove_test.mjs vérifie exactement ce code-ci avec
   de minuscules images fabriquées à la main.
   ========================================================================= */

/** Tolérance par défaut (unités de distance RGB, voir colorDistance) : assez
 *  large pour absorber le bruit d'un JPEG (quelques unités), assez serrée pour
 *  ne pas manger un trait clair sur fond blanc. */
export const BG_DEFAULT_TOL = 36;

/** Bornes de la tolérance : 0 = la couleur exacte seulement. 160 (sur ~442 de
 *  distance maximale) reste un détourage, pas un massacre. */
export const BG_TOL_MIN = 0;
export const BG_TOL_MAX = 160;

/** Côté le plus long des pixels lus par le détourage. Une capture de 6000 px
 *  ferait travailler le navigateur sur 36 millions de pixels pour un résultat
 *  invisible dans un panneau : le détourage travaille sur une copie bornée. */
export const BG_MAX_SIDE = 1800;

/** Les deux façons de choisir ce qui disparaît. */
export const BG_MODES = ['flood', 'all'];

/** La tolérance valide la plus proche de `v` (bornée, jamais NaN). */
export const clampBgTol = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return BG_DEFAULT_TOL;
  return Math.max(BG_TOL_MIN, Math.min(BG_TOL_MAX, Math.round(n)));
};

const byte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));

/** `[r, g, b]` → `'#rrggbb'` (composantes bornées à 0…255). */
export const rgbToHex = (rgb) => {
  const [r, g, b] = Array.isArray(rgb) ? rgb : [0, 0, 0];
  return `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`;
};

/** `'#rrggbb'` / `'#rgb'` → `[r, g, b]`, ou `null` quand ce n'est pas une couleur. */
export const hexToRgb = (hex) => {
  const s = String(hex == null ? '' : hex).trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** Distance euclidienne de deux couleurs dans RGB : 0 = identiques, ~441.7 =
 *  blanc contre noir. C'est l'unité de la tolérance. */
export const colorDistance = (a, b) => {
  const x = Array.isArray(a) ? a : [0, 0, 0];
  const y = Array.isArray(b) ? b : [0, 0, 0];
  return Math.sqrt(
    ((Number(x[0]) || 0) - (Number(y[0]) || 0)) ** 2
    + ((Number(x[1]) || 0) - (Number(y[1]) || 0)) ** 2
    + ((Number(x[2]) || 0) - (Number(y[2]) || 0)) ** 2
  );
};


/** Une couleur de fond acceptée par les fonctions ci-dessous : `'#ffffff'`,
 *  `[255, 255, 255]` ou `{ r, g, b }`. */
const toRgb = (c) => {
  if (Array.isArray(c)) return c.length >= 3 ? [byte(c[0]), byte(c[1]), byte(c[2])] : null;
  if (c && typeof c === 'object') {
    if (!['r', 'g', 'b'].every((k) => Number.isFinite(Number(c[k])))) return null;
    return [byte(c.r), byte(c.g), byte(c.b)];
  }
  return hexToRgb(c);
};

/** La liste (sans doublon) des couleurs visées par un détourage : une seule
 *  couleur, ou plusieurs (les quatre coins d'une image, mode automatique). */
export const backgroundKeysOf = (key) => {
  const isTriplet = (v) => Array.isArray(v) && v.length >= 3
    && v.slice(0, 3).every((n) => Number.isFinite(Number(n)));
  const list = Array.isArray(key) && key.length && !isTriplet(key) ? key : [key];
  const out = [];
  list.forEach((k) => {
    const rgb = toRgb(k);
    if (!rgb) return;
    if (!out.some((o) => o[0] === rgb[0] && o[1] === rgb[1] && o[2] === rgb[2])) out.push(rgb);
  });
  return out;
};

const distToKeys = (data, off, keys) => {
  const r = data[off], g = data[off + 1], b = data[off + 2];
  let best = Infinity;
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const d = Math.sqrt((r - k[0]) ** 2 + (g - k[1]) ** 2 + (b - k[2]) ** 2);
    if (d < best) best = d;
  }
  return best;
};

const sizeOf = (data, width, height) => {
  const w = Math.max(0, Math.floor(Number(width) || 0));
  const h = Math.max(0, Math.floor(Number(height) || 0));
  if (!data || !w || !h || data.length < w * h * 4) return null;
  return { w, h };
};

/** Les couleurs de fond d'une image : celles de ses QUATRE COINS (les pixels
 *  déjà transparents sont ignorés, les doublons fondus). C'est le réglage
 *  « automatique » du détourage — un JPEG de graphe a son fond clair dans ses
 *  quatre coins, une image déjà détourée n'en donne aucun.
 *  @returns {string[]} 0 à 4 couleurs `'#rrggbb'` */
export const cornerColors = ({ data, width, height } = {}) => {
  const s = sizeOf(data, width, height);
  if (!s) return [];
  const { w, h } = s;
  const out = [];
  [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].forEach(([x, y]) => {
    const off = (y * w + x) * 4;
    if (data[off + 3] === 0) return;                       // déjà transparent
    const hex = rgbToHex([data[off], data[off + 1], data[off + 2]]);
    if (!out.includes(hex)) out.push(hex);
  });
  return out;
};

/* Le fond CONNEXE aux bords : un remplissage (BFS) qui part des quatre bords et
   s'arrête dès que la couleur s'éloigne de la clé. C'est ce qui distingue « le
   fond de l'image » du « blanc à l'intérieur du dessin » : une légende blanche
   posée AU MILIEU d'un graphe n'est pas atteignable depuis les bords, elle est
   donc conservée. */
const floodMask = (data, w, h, keys, tol) => {
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (idx) => {
    if (mask[idx]) return;
    const off = idx * 4;
    if (data[off + 3] === 0) return;                       // déjà transparent
    if (distToKeys(data, off, keys) > tol) return;         // ce n'est plus le fond
    mask[idx] = 1;
    stack[sp] = idx;
    sp += 1;
  };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    sp -= 1;
    const idx = stack[sp];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }
  return mask;
};

/* Le fond PARTOUT : chaque pixel de la couleur, où qu'il soit (un fond qui
   n'est pas connexe — un damier, une image posée sur deux fonds). */
const allMask = (data, w, h, keys, tol) => {
  const mask = new Uint8Array(w * h);
  for (let idx = 0; idx < w * h; idx += 1) {
    const off = idx * 4;
    if (data[off + 3] === 0) continue;
    if (distToKeys(data, off, keys) <= tol) mask[idx] = 1;
  }
  return mask;
};


/**
 * Le fond devient TRANSPARENT : les pixels visés passent à alpha 0, sur place.
 * @param {{data:Uint8ClampedArray, width:number, height:number,
 *          key:string|number[]|Array, tol:number, mode:'flood'|'all'}} opts
 * @returns {{removed:number, mask:Uint8Array}} `removed` = pixels enlevés,
 *          `mask` = 1 pour chaque pixel enlevé (voir softenBackgroundEdges)
 */
export const removeBackgroundKey = ({ data, width, height, key, tol, mode = 'flood' } = {}) => {
  const s = sizeOf(data, width, height);
  const keys = backgroundKeysOf(key);
  if (!s || !keys.length) return { removed: 0, mask: new Uint8Array(0) };
  const t = clampBgTol(tol);
  const mask = (BG_MODES.includes(mode) ? mode : 'flood') === 'all'
    ? allMask(data, s.w, s.h, keys, t)
    : floodMask(data, s.w, s.h, keys, t);
  let removed = 0;
  for (let idx = 0; idx < mask.length; idx += 1) {
    if (!mask[idx]) continue;
    data[idx * 4 + 3] = 0;
    removed += 1;
  }
  return { removed, mask };
};

/**
 * Le BORD de la découpe : un pixel CONSERVÉ qui touche un pixel enlevé et qui
 * garde un reste de la couleur de fond (l'anti-aliasing d'un JPEG) devient
 * PARTIELLEMENT transparent — sinon la découpe traîne un liseré clair.
 * @returns {number} nombre de pixels adoucis
 */
export const softenBackgroundEdges = ({ data, width, height, key, tol, mask } = {}) => {
  const s = sizeOf(data, width, height);
  const keys = backgroundKeysOf(key);
  const t = clampBgTol(tol);
  if (!s || !keys.length || !mask || mask.length < s.w * s.h || t < 1) return 0;
  const { w, h } = s;
  let changed = 0;
  for (let idx = 0; idx < w * h; idx += 1) {
    if (mask[idx]) continue;
    const x = idx % w;
    const y = (idx - x) / w;
    const border = (x > 0 && mask[idx - 1]) || (x < w - 1 && mask[idx + 1])
      || (y > 0 && mask[idx - w]) || (y < h - 1 && mask[idx + w]);
    if (!border) continue;
    const off = idx * 4;
    const a = data[off + 3];
    if (a === 0) continue;
    const d = distToKeys(data, off, keys);
    if (d > t * 2) continue;                               // assez loin du fond : intact
    const ramp = byte(255 * ((d - t) / t));
    if (ramp >= a) continue;
    data[off + 3] = ramp;
    changed += 1;
  }
  return changed;
};

/**
 * Ce qu'un détourage a laissé sur une figure : `im.bg = { color, tol, mode }`.
 * Idem `cropOf` : une donnée abîmée ne raconte rien plutôt que n'importe quoi.
 * @returns {{color:string, tol:number, mode:'flood'|'all'}|null}
 */
export const bgRecordOf = (im) => {
  const b = im && im.bg;
  if (!b || typeof b !== 'object') return null;
  const rgb = hexToRgb(b.color);
  if (!rgb) return null;
  return {
    color: rgbToHex(rgb),
    tol: clampBgTol(b.tol),
    mode: BG_MODES.includes(b.mode) ? b.mode : 'flood'
  };
};

/** La taille des pixels réellement lus par un détourage, bornée à BG_MAX_SIDE :
 *  partagée par tout ce qui ouvre vraiment l'image (ImageBuilder). */
export const bgPixelSize = (naturalWidth, naturalHeight, maxSide = BG_MAX_SIDE) => {
  const w = Math.max(1, Math.round(Number(naturalWidth) || 1));
  const h = Math.max(1, Math.round(Number(naturalHeight) || 1));
  const cap = Math.max(16, Number(maxSide) || BG_MAX_SIDE);
  const scale = Math.min(1, cap / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};
