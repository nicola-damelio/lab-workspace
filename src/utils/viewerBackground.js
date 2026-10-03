/* =========================================================================
   src/utils/viewerBackground.js
   LE FOND DU VIEWER : UNE COULEUR, OU UNE RAMPE DE DEUX COULEURS ET SA
   DIRECTION.

   LA DEMANDE DE CETTE SESSION : « in the background of the viewer allow
   gradients of two colors and their direction (clicking on background should
   display the options underneath and disappear when background is clicked
   again) ».

   POURQUOI C'EST UN MODULE À PART, ET POURQUOI UN DÉGRADÉ CSS SUFFIT.
   NGL 2.4 ne sait peindre QU'UNE couleur de fond : son `setBackground`
   (viewer.setBackground, _ngl_src/viewer__viewer.ts:842) fait exactement trois
   choses —
       this.setFog(p.backgroundColor)
       this.renderer.setClearColor(p.backgroundColor, 0)      ← ALPHA ZÉRO
       this.renderer.domElement.style.backgroundColor = p.backgroundColor.getStyle()
   Le fond que l'on VOIT à l'écran n'est donc pas dans la toile WebGL : c'est la
   COULEUR CSS DU CANVAS, vue à travers une toile transparente (c'est le fait
   qui a demandé `filmBackdropColor`, voir utils/viewerTrajectoryVideo.js). Une
   `backgroundImage` posée sur ce même canvas se peint donc PAR-DESSUS la
   couleur, sans que la moindre représentation soit touchée : le dégradé vit
   dans le CSS, pas dans la scène.

   LES TROIS CONSOMMATEURS DE LA MÊME SPÉCIFICATION
     · l'écran      — `backgroundCss` → le canvas vivant (voir applyBackgroundGradient
                      dans NMRMoleculeViewer.jsx) ;
     · un film 🎬🎞 — `paintViewerBackground` → la toile de film, qui n'a pas
                      d'alpha et doit donc PEINDRE la rampe avant la scène ;
     · le ✨ Ray    — `underlayBackdrop` → NGL, lui, rend le still d'un seul bloc
                      avec un fond OPAQUE (`makeImage` fait `setClearAlpha(s?0:1)`,
                      ngl 2.4) : la rampe est donc dessinée SOUS le PNG rendu
                      transparent. Sans cela, une still de fond dégradé serait
                      unie — la couleur du 🎨 de §2 Scene.

   LA SPÉCIFICATION, UN SEUL OBJET, TOUJOURS VALIDÉ :
       { on: bool, from: '#rrggbb', to: '#rrggbb', angle: 0…360 }
   `from` EST la couleur de la scène (le 🎨 de §2 Scene / du panneau 🧪 PyMOL) :
   il n'y a pas deux couleurs de fond dans le viewer, il y a UNE couleur et une
   rampe qui part d'elle. Un dégradé éteint ne laisse donc rien à deviner.

   Ce module ne connaît ni React ni NGL : il se teste sous node (les maths du
   tracé CSS) et dans un vrai navigateur (les pixels d'une toile 2D), voir
   _viewer_background_test.mjs et _viewer_background_pixels_test.cjs.
   ========================================================================= */

/** Le DÉFAUT de la seconde couleur : un gris clair, choisi pour que la rampe
 *  par défaut (fond blanc → gris clair, du haut vers le bas) reste discrète. */
export const BG_GRADIENT_DEFAULT_TO = '#cbd5e1';
/** 180° = du HAUT vers le BAS (la convention CSS : 0° va vers le haut). */
export const BG_GRADIENT_DEFAULT_ANGLE = 180;
/** Un fond dégradé n'est JAMAIS imposé : le viewer s'ouvre sur sa couleur unie. */
export const BG_GRADIENT_DEFAULT_ON = false;

/* LES HUIT DIRECTIONS QU'UN CLIC OFFRE — les angles de la convention CSS
   (0° en haut, dans le sens des aiguilles d'une montre), avec le glyphe du
   bouton et la phrase de sa bulle. L'ordre est celui du panneau : les quatre
   droites d'abord (↓ ↑ → ←), puis les quatre diagonales. */
export const BG_DIRECTIONS = Object.freeze([
  { key: 'down', glyph: '↓', angle: 180, what: 'from the top to the bottom' },
  { key: 'up', glyph: '↑', angle: 0, what: 'from the bottom to the top' },
  { key: 'right', glyph: '→', angle: 90, what: 'from the left to the right' },
  { key: 'left', glyph: '←', angle: 270, what: 'from the right to the left' },
  { key: 'down-right', glyph: '↘', angle: 135, what: 'from the top left corner to the bottom right one' },
  { key: 'up-left', glyph: '↖', angle: 315, what: 'from the bottom right corner to the top left one' },
  { key: 'down-left', glyph: '↙', angle: 225, what: 'from the top right corner to the bottom left one' },
  { key: 'up-right', glyph: '↗', angle: 45, what: 'from the bottom left corner to the top right one' },
]);
/** `#rrggbb` — la SEULE forme qu'un canvas et un `<input type="color">`
 *  comprennent tous les deux. Tout le reste (une couleur nommée, trois
 *  chiffres, du vide) retombe sur le secours : jamais sur du noir. */
export const normalizeBgColor = (value, fallback = '') => {
  const v = typeof value === 'string' ? value.trim() : '';
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  const f = typeof fallback === 'string' ? fallback.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(f) ? f.toLowerCase() : '';
};

/** L'angle d'une rampe, ramené dans [0, 360[ : un curseur peut envoyer 360,
 *  un fichier bricolé peut envoyer −90 ou « rouge » — la rampe, elle, tourne. */
export const normalizeBgAngle = (value, fallback = BG_GRADIENT_DEFAULT_ANGLE) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return normalizeBgAngle(fallback, BG_GRADIENT_DEFAULT_ANGLE);
  return ((Math.round(n) % 360) + 360) % 360;
};

/** L'état d'un dégradé, VALIDÉ — c'est ce que le viewer garde en mémoire et
 *  écrit dans localStorage / dans un ⚙️ setup. Un objet inconnu (ou rien)
 *  donne le dégradé par défaut : éteint. */
export const bgGradientOf = (value) => {
  const v = (value && typeof value === 'object') ? value : {};
  return {
    on: v.on === true,
    to: normalizeBgColor(v.to, BG_GRADIENT_DEFAULT_TO) || BG_GRADIENT_DEFAULT_TO,
    angle: normalizeBgAngle(v.angle, BG_GRADIENT_DEFAULT_ANGLE),
  };
};

/** Ce que localStorage rend : une CHAÎNE JSON (ou rien). Un magasin illisible
 *  rend le dégradé par défaut, jamais une exception. */
export const readBgGradient = (raw) => {
  if (raw == null || raw === '') return bgGradientOf(null);
  if (typeof raw === 'string') {
    try { return bgGradientOf(JSON.parse(raw)); } catch { return bgGradientOf(null); }
  }
  return bgGradientOf(raw);
};

/* LA SPÉCIFICATION DU FOND — la seule que les trois consommateurs lisent. */
export const backgroundSpecOf = (color, gradient) => {
  const g = bgGradientOf(gradient);
  return {
    on: g.on,
    from: normalizeBgColor(color, BG_GRADIENT_DEFAULT_TO) || BG_GRADIENT_DEFAULT_TO,
    to: g.to,
    angle: g.angle,
  };
};

/** La rampe peinte par un canvas / un film / une still, ou `null` quand le fond
 *  est uni. Une chaîne (`filmCanvasFor` recevait autrefois une simple couleur)
 *  n'est pas une spécification : `null`, donc aucun dégradé. */
export const gradientSpecOf = (spec) => {
  if (!spec || typeof spec !== 'object' || spec.on !== true) return null;
  const from = normalizeBgColor(spec.from);
  const to = normalizeBgColor(spec.to);
  if (!from || !to) return null;
  return { from, to, angle: normalizeBgAngle(spec.angle, BG_GRADIENT_DEFAULT_ANGLE) };
};

/** LA DIRECTION NOMMÉE — la promesse du panneau : un angle qui vaut exactement
 *  l'un des huit boutons le DIT. Un angle libre rend `null`. */
export const bgDirectionOf = (angle) => {
  const a = normalizeBgAngle(angle, BG_GRADIENT_DEFAULT_ANGLE);
  return BG_DIRECTIONS.find((d) => d.angle === a) || null;
};

/** LE CSS DU FOND VIVANT — `backgroundImage` du canvas NGL, ou `''` quand le
 *  fond est uni (le viewer pose alors la chaîne vide : la couleur de NGL reste).
 *  ⚠ La rampe part de `from` (0 %) et se termine à `to` (100 %) : les deux
 *  couleurs du panneau sont donc EXACTEMENT celles des deux bords. */
export const backgroundCss = (spec) => {
  const g = gradientSpecOf(spec);
  if (!g) return '';
  return `linear-gradient(${g.angle}deg, ${g.from} 0%, ${g.to} 100%)`;
};
/** LA LIGNE DE LA RAMPE, en coordonnées de canvas — les maths de la
 *  spécification CSS (css-images-3, §linear-gradient) :
 *    · la ligne passe par le CENTRE de la boîte ;
 *    · sa direction est « vers l'angle » : (sin θ, −cos θ) — ⚠ l'axe Y d'un
 *      canvas descend, d'où le signe, alors que 0° pointe vers le HAUT ;
 *    · sa longueur est |W·sin θ| + |H·cos θ| : c'est ce qui fait que les deux
 *      coins d'une diagonale sont atteints par les DEUX couleurs, exactement
 *      comme dans le navigateur.
 *  PURE : c'est la fonction que la sonde pixel rejoue sur une vraie toile. */
export const gradientLineFor = (angle, width, height) => {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const rad = (normalizeBgAngle(angle, BG_GRADIENT_DEFAULT_ANGLE) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const x0 = w / 2 - (dx * length) / 2;
  const y0 = h / 2 - (dy * length) / 2;
  return { x0, y0, x1: x0 + dx * length, y1: y0 + dy * length, dx, dy, length };
};

/** PEINDRE LA RAMPE DANS UNE TOILE 2D — la fabrique de la toile de film
 *  l'appelle APRÈS la couleur de fond (comme le CSS empile `backgroundImage`
 *  sur `backgroundColor`) et la still du ✨ Ray sous son PNG transparent.
 *  Rend `true` quand quelque chose a été peint ; `false` (jamais une
 *  exception) quand le fond est uni, la toile absente ou la boîte nulle. */
export const paintViewerBackground = (ctx, width, height, spec) => {
  const g = gradientSpecOf(spec);
  if (!g) return false;
  if (!ctx || typeof ctx.createLinearGradient !== 'function' || typeof ctx.fillRect !== 'function') return false;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0) || !(h > 0)) return false;
  try {
    const { x0, y0, x1, y1 } = gradientLineFor(g.angle, w, h);
    const ramp = ctx.createLinearGradient(x0, y0, x1, y1);
    ramp.addColorStop(0, g.from);
    ramp.addColorStop(1, g.to);
    ctx.fillStyle = ramp;
    ctx.fillRect(0, 0, w, h);
    return true;
  } catch { return false; }
};

/* ---- LE PNG DU ✨ RAY, SOUS LEQUEL LA RAMPE EST POSÉE ---------------------
   NGL rend le still d'un seul tenant — `makeImage` fait `setClearAlpha(s?0:1)`,
   donc un fond OPAQUE de LA couleur du paramètre — et ne connaît qu'une
   couleur. Une still de fond dégradé est donc rendue TRANSPARENTE (le viewer
   passe `transparent: true` à `previewRayImage`) et la rampe est ensuite peinte
   SOUS elle (`destination-over` : elle ne remplit que les pixels vides). Le
   résultat est exactement ce que l'écran montre, coin par coin. */
const decodeImage = async (source) => {
  try {
    if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined' && source instanceof Blob) {
      return await createImageBitmap(source);
    }
  } catch { /* on essaie l'<img> */ }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(source);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 4000);
  }
};

/** Le PNG d'une still, la RAMPE SOUS son fond transparent → un nouveau PNG.
 *  Rend `null` quand il n'y a rien à faire (fond uni) ou quand le navigateur
 *  n'offre pas ce qu'il faut : l'appelant garde alors la still telle quelle. */
export const underlayBackdrop = async (png, spec) => {
  if (!gradientSpecOf(spec)) return null;
  if (!png || typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const bitmap = await decodeImage(png);
  if (!bitmap) return null;
  const w = Math.max(1, Math.round(Number(bitmap.width) || 0));
  const h = Math.max(1, Math.round(Number(bitmap.height) || 0));
  if (!w || !h) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-over';
    paintViewerBackground(ctx, w, h, spec);
    ctx.globalCompositeOperation = 'source-over';
    return await new Promise((resolve) => {
      try { canvas.toBlob((blob) => resolve(blob || null), 'image/png'); } catch { resolve(null); }
    });
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
};


