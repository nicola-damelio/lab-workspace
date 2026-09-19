/* ============================================================================
   FIGURE ADJUSTMENTS — contrast, brightness and recolouring, for the Image
   Builder canvas.

   « Modify image » : la rotation, le recadrage et la gomme agissent sur la
   GÉOMÉTRIE d'une figure ; ce dont une planche a aussi besoin est un réglage
   d'IMAGE — éclaircir une capture un peu sombre, remonter le contraste d'un
   graphe délavé, désaturer une couleur trop vive, teinter un schéma pour le
   raccorder à la légende.

   Le réglage est un petit enregistrement sur la FIGURE (comme son recadrage,
   ses traits de gomme et son ombre) :

       { brightness, contrast, saturation, hue, opacity, tint, tintAmount }

   …rendu, comme les ombres, par un VRAI `<filter>` SVG de la composition : les
   primitives sont donc dans le fichier exporté, et Export PNG / Save canvas /
   Insert into project (qui rastérisent ce SVG-là) gardent le réglage.

   `opacity` (0–100 %) est la TRANSPARENCE DE L'IMAGE ELLE-MÊME — ni le fond
   (c'est le détourage, utils/figureBackground.js), ni l'ombre : elle s'écrit
   par une pente sur le canal ALPHA (`<feFuncA>`), donc la figure s'efface en
   laissant le panneau et sa lettre intacts. Sa valeur NEUTRE est 100 (et non 0
   comme les autres champs) : une fiche neuve, ou une fiche d'avant l'opacité,
   ne demande rien.

   Tout ici est PUR (ni React ni DOM) : la même description est vérifiée par le
   test _builder_adjust_test.mjs et dessinée par ImageBuilder.jsx.
   ========================================================================= */

/** Ranges of the controls — anything stored is clamped to them. */
export const ADJUST_LIMITS = { brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], hue: [-180, 180], opacity: [0, 100], tintAmount: [0, 1] };

/** The neutral record: nothing asked, no filter drawn at all. */
export const ADJUST_NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, hue: 0, opacity: 100, tint: '', tintAmount: 0 };

/** The controls the object window shows, in order (one row: “Adjust”). */
export const ADJUST_FIELDS = [
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'hue', label: 'Hue (°)', min: -180, max: 180, step: 1 }
];

/**
 * Le SEUL contrôle du réglage qui ne soit pas une couleur : l'OPACITÉ de
 * l'image (100 % = l'image telle quelle). Il a sa propre description parce que
 * sa valeur NEUTRE est 100 et non 0, et il vit sur la ligne de l'image (à côté
 * de « 🎨 Transparent background » et de « 🌓 Figure shadow »), pas dans la
 * ligne des couleurs. « ↺ Reset » le remet à 100 comme le reste.
 */
export const ADJUST_OPACITY = { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1 };

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v, [lo, hi], fallback) => Math.max(lo, Math.min(hi, num(v, fallback)));
const color = (v) => ((typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim())) ? v.trim() : '');

/** Le réglage rangé sur une figure (ou `null`). PUR. */
export const adjustRecordOf = (im) => {
  const rec = im && im.adjust;
  if (!rec || typeof rec !== 'object') return null;
  const spec = adjustSpec(rec);
  return spec ? rec : null;
};

/**
 * La VALEUR d'un contrôle pour une figure : celle qu'elle porte, bornée, sinon
 * la valeur NEUTRE du champ — 0 pour les couleurs, 100 pour l'opacité. C'est
 * ce que les curseurs de la fenêtre affichent (une figure que l'opacité n'a
 * jamais touchée montre donc 100 %, pas 0). PUR.
 */
export const adjustValue = (rec, key) =>
  clamp(rec && rec[key], ADJUST_LIMITS[key] || [0, 0], ADJUST_NEUTRAL[key] || 0);

/**
 * `null` quand rien n'est demandé (aucun filtre n'est alors dessiné : le SVG
 * reste exactement celui d'avant), sinon la description EXACTE des primitives :
 *   • slope / intercept → <feComponentTransfer> (contraste, pivot au gris moyen,
 *     + luminosité en décalage) ;
 *   • saturate → <feColorMatrix type="saturate"> ;
 *   • hueRotate → <feColorMatrix type="hueRotate"> ;
 *   • tint / tintAmount → <feFlood> détouré sur les pixels de la figure ;
 *   • alpha (opacité) → une <feFuncA> linéaire, posée sur le MÊME
 *     <feComponentTransfer> : 1 quand rien n'est demandé.
 */
export const adjustSpec = (rec) => {
  if (!rec || typeof rec !== 'object') return null;
  const brightness = clamp(rec.brightness, ADJUST_LIMITS.brightness, 0);
  const contrast = clamp(rec.contrast, ADJUST_LIMITS.contrast, 0);
  const saturation = clamp(rec.saturation, ADJUST_LIMITS.saturation, 0);
  const hue = clamp(rec.hue, ADJUST_LIMITS.hue, 0);
  const opacity = clamp(rec.opacity, ADJUST_LIMITS.opacity, 100);
  const tint = color(rec.tint);
  const tintAmount = Math.round(clamp(rec.tintAmount, ADJUST_LIMITS.tintAmount, 0) * 1000) / 1000;
  if (!brightness && !contrast && !saturation && !hue && opacity >= 100 && !(tint && tintAmount > 0)) return null;
  const slope = Math.max(0, 1 + contrast / 100);
  const intercept = Math.max(-1, Math.min(1, 0.5 * (1 - slope) + brightness / 200));
  return {
    brightness, contrast, saturation, hue, opacity,
    alpha: Math.round(opacity) / 100,
    tint, tintAmount,
    slope: Math.round(slope * 1000) / 1000,
    intercept: Math.round(intercept * 1000) / 1000,
    saturate: Math.max(0, 1 + saturation / 100),
    hueRotate: hue
  };
};

/** Id of the `<filter>` of one FIGURE's adjustment — its own, per figure. */
export const adjustFilterId = (objId, figIdx) =>
  `fadjust-${String(objId == null ? '' : objId).replace(/[^\w-]/g, '_')}-fig${Math.max(0, Math.round(Number(figIdx) || 0))}`;

/** Ce réglage ne fait-il RIEN ? (le bouton le dit d'un coup d'œil) */
export const isNeutralAdjust = (rec) => adjustSpec(rec) === null;

/** Le réglage “+1 cran” d'un curseur : la valeur suivante, dans ses bornes. */
export const stepAdjust = (rec, key, dir) => {
  const field = ADJUST_FIELDS.find((f) => f.key === key) || (key === ADJUST_OPACITY.key ? ADJUST_OPACITY : null);
  const limits = ADJUST_LIMITS[key] || [0, 0];
  const current = adjustValue(rec, key);
  const step = (field && field.step) || 1;
  return Math.max(limits[0], Math.min(limits[1], current + step * (dir < 0 ? -1 : 1)));
};
