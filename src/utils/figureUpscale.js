/* =========================================================================
   src/utils/figureUpscale.js
   « CETTE FIGURE EST FLOUE — RENDS-LA PLUS NETTE » : l'outil ✨ de la fenêtre
   de l'objet de l'Image Builder.

   WHAT IT IS — AND WHAT IT IS NOT. The workspace contains NO cloud AI service:
   no API key, no upload — and sending an unpublished figure to a third party
   is a privacy decision nobody has taken here (see public/privacy.html). What
   the ✨ tool does is the deterministic, on-device half of what an “AI
   upscaler” gives on a plot or a photograph:
     1. the pixels are re-sampled UP in ≤2× steps by the browser's high-quality
        resampling (canvas `imageSmoothingQuality: 'high'`, see ImageBuilder):
        a blurry 400 px capture becomes 800 / 1200 / 1600 px WITHOUT the
        staircase of a single big jump;
     2. `enhanceRgbaInPlace()` then works the pixels themselves — a noise-floor
        pass flattens the JPEG mosquito noise of the flat areas, and a
        THRESHOLDED UNSHARP MASK puts the contrast back on the lines and on the
        characters. Because it is thresholded, plain noise is left alone
        instead of being amplified: that is the difference between “sharper”
        and “granier”.
   If a real model is ever wired in (a cloud API, or a WASM/ONNX model dropped
   in public/vendor), THIS module is what changes: the tool in the object window
   only calls `enhanceRgbaInPlace` + `upscaleTargetSize`.

   Everything here is PURE (no DOM, no canvas, no Image): _builder_upscale_test.mjs
   runs it on tiny hand-made images.
   ========================================================================= */

/** The enlargements offered by the tool. Beyond 4× there is nothing left to
 *  recover from the pixels — a bigger matrix would only be interpolation. */
export const UPSCALE_FACTORS = [2, 3, 4];
export const UPSCALE_DEFAULT_FACTOR = 2;

/** “Strength” of the sharpening (the slider of the tool). 0 = the enlargement
 *  alone (no pixel touched), 100 = the strongest mask the tool allows. */
export const UPSCALE_DEFAULT_STRENGTH = 60;
export const UPSCALE_MIN_STRENGTH = 0;
export const UPSCALE_MAX_STRENGTH = 100;

/** Bounds of the matrix the tool works on — the SOURCE it reads and the OUTPUT
 *  it writes. A figure ends up in a panel a few cm wide, so 12 Mpx of canvas
 *  (about 290 MB of temporary buffers) would freeze the browser for nothing;
 *  a figure already that big has no lack of resolution to make up. */
export const UPSCALE_MAX_SIDE = 6000;
export const UPSCALE_MAX_PIXELS = 12000000;

/** Below this local difference a pixel is “flat” — the noise floor. */
export const FLAT_DELTA = 6;

/** A factor of the list, else the default (never NaN, never 0). */
export const clampUpscaleFactor = (v) => {
  const n = Math.round(Number(v));
  return UPSCALE_FACTORS.includes(n) ? n : UPSCALE_DEFAULT_FACTOR;
};

/** A strength between the bounds (never NaN). */
export const clampUpscaleStrength = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return UPSCALE_DEFAULT_STRENGTH;
  return Math.max(UPSCALE_MIN_STRENGTH, Math.min(UPSCALE_MAX_STRENGTH, Math.round(n)));
};

/** “2×” — the label of a factor. */
export const upscaleFactorLabel = (factor) => `${clampUpscaleFactor(factor)}×`;

/**
 * The OUTPUT size of an upscale: `factor` times the source, bounded so a huge
 * capture cannot freeze the tab (`maxSide` / `maxPixels`). The RATIO of the
 * source is always kept: the factor steps down (4 → 3 → 2 → 1) until the matrix
 * fits, and `factor` says what was really applied. 1 means “the pixels are only
 * sharpened” — a source already too big to be enlarged.
 * @returns {{ w:number, h:number, factor:number, wanted:number, bounded:boolean }}
 */
export const upscaleTargetSize = (
  width, height, factor, maxPixels = UPSCALE_MAX_PIXELS, maxSide = UPSCALE_MAX_SIDE
) => {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const wanted = clampUpscaleFactor(factor);
  for (let f = wanted; f >= 1; f -= 1) {
    const tw = Math.max(1, Math.round(w * f));
    const th = Math.max(1, Math.round(h * f));
    if (tw <= maxSide && th <= maxSide && tw * th <= maxPixels) {
      return { w: tw, h: th, factor: f, wanted, bounded: f < wanted };
    }
  }
  return { w, h, factor: 1, wanted, bounded: wanted > 1 };
};

/** The trace kept on a figure that was enhanced — `im[UPSCALE_KEY]` (the same
 *  idea as `im.bg` of the background removal). The NAME of that property lives
 *  HERE, and nowhere else: ImageBuilder writes it, the window reads it, and one
 *  rename cannot leave the two out of step. */
export const UPSCALE_KEY = 'upscale';

/** The trace kept on a figure that was enhanced — `im.upscale` (the same idea
 *  as `im.bg` of the background removal). */
export const normalizeUpscaleRecord = (record) => {
  const u = record && typeof record === 'object' ? record : null;
  if (!u) return null;
  return {
    factor: clampUpscaleFactor(u.factor),
    strength: clampUpscaleStrength(u.strength),
    w: Math.max(0, Math.round(Number(u.w) || 0)),
    h: Math.max(0, Math.round(Number(u.h) || 0))
  };
};

/** Le réglage d'amélioration d'une figure, ou `null` si elle n'en a pas. */
export const upscaleRecordOf = (im) => normalizeUpscaleRecord(im && im[UPSCALE_KEY]);

/** “3× (1800 × 1200 px) · sharpened 60%” — ce que la fenêtre affiche. */
export const upscaleSummary = (record) => {
  const r = normalizeUpscaleRecord(record);
  if (!r) return '';
  const size = r.w && r.h ? ` (${r.w} × ${r.h} px)` : '';
  return `${r.factor}×${size}${r.strength ? ` · sharpened ${r.strength}%` : ''}`;
};

/** How much of the mask is added back (`0 … 0.8`). 0.8 is the classic “unsharp
 *  amount” of a printed figure: enough to bring the lines back, small enough
 *  that a black line on white does not grow a grey halo. */
export const sharpenAmountOf = (strength) => (clampUpscaleStrength(strength) / 100) * 0.8;

/** Radius of the blur the mask is built from: 1 px, 2 px once the strength is
 *  above half — a wider radius brings out the bigger shapes, not the grain. */
export const blurRadiusOf = (strength) => (clampUpscaleStrength(strength) >= 50 ? 2 : 1);

/** Above this local difference the mask acts. It falls as the strength rises:
 *  a low strength must never amplify the grain of a JPEG. */
export const unsharpThresholdOf = (strength) =>
  4 + Math.round(8 * (1 - clampUpscaleStrength(strength) / 100));


/* ── LE FLOU (séparable, à sommes glissantes) ────────────────────────────────
   Un vrai flou gaussien coûterait (2r+1) taps par pixel et par direction. Deux
   passes d'un flou “boîte” donnent à l'œil le même noyau pour un coût CONSTANT
   par pixel : c'est ce qui permet de traiter une matrice de plusieurs millions
   de pixels sans figer l'onglet. Les bords sont PROLONGÉS (l'indice est borné),
   jamais assombris — un bord noir serait une auréole autour de la figure. */
const boxPass = (src, dst, width, height, radius, horizontal) => {
  const lineLen = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const step = horizontal ? 4 : width * 4;
  const win = 2 * radius + 1;
  const at = (base, i) => base + Math.max(0, Math.min(lineLen - 1, i)) * step;
  for (let line = 0; line < lines; line += 1) {
    const base = horizontal ? line * width * 4 : line * 4;
    let s0 = 0; let s1 = 0; let s2 = 0; let s3 = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const o = at(base, k);
      s0 += src[o]; s1 += src[o + 1]; s2 += src[o + 2]; s3 += src[o + 3];
    }
    for (let i = 0; i < lineLen; i += 1) {
      const o = base + i * step;
      dst[o] = (s0 / win + 0.5) | 0;
      dst[o + 1] = (s1 / win + 0.5) | 0;
      dst[o + 2] = (s2 / win + 0.5) | 0;
      dst[o + 3] = (s3 / win + 0.5) | 0;
      const add = at(base, i + radius + 1);
      const sub = at(base, i - radius);
      s0 += src[add] - src[sub];
      s1 += src[add + 1] - src[sub + 1];
      s2 += src[add + 2] - src[sub + 2];
      s3 += src[add + 3] - src[sub + 3];
    }
  }
};

/**
 * A blurred copy of an RGBA buffer. The blur is computed on PREMULTIPLIED
 * pixels, so a transparent background cannot bleed a dark halo into the pixels
 * of a cut-out figure.
 * @returns {Uint8ClampedArray} a NEW buffer, `width * height * 4` values long
 */
export const blurRgba = (data, width, height, radius, passes = 2) => {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const r = Math.max(0, Math.round(Number(radius) || 0));
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  if (!data || data.length < n * 4) return out;
  for (let i = 0; i < n * 4; i += 1) out[i] = data[i];
  if (!r || passes < 1) return out;
  const a = new Uint8Array(n * 4);
  const b = new Uint8Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const alpha = out[o + 3];
    a[o] = (out[o] * alpha / 255 + 0.5) | 0;
    a[o + 1] = (out[o + 1] * alpha / 255 + 0.5) | 0;
    a[o + 2] = (out[o + 2] * alpha / 255 + 0.5) | 0;
    a[o + 3] = alpha;
  }
  for (let p = 0; p < passes; p += 1) {
    boxPass(a, b, w, h, r, true);
    boxPass(b, a, w, h, r, false);
  }
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const alpha = a[o + 3];
    const k = alpha > 0 ? 255 / alpha : 0;
    out[o] = a[o] * k;
    out[o + 1] = a[o + 1] * k;
    out[o + 2] = a[o + 2] * k;
    out[o + 3] = alpha;
  }
  return out;
};

/**
 * LE CŒUR DE L'OUTIL : améliore une matrice RGBA EN PLACE.
 *   1. les zones PLATES (différence locale ≤ FLAT_DELTA) sont ramenées vers leur
 *      propre flou : le bruit de compression d'un JPEG s'en va sans effacer le
 *      dessin ;
 *   2. au-delà du seuil (`unsharpThresholdOf`), le masque ajoute le contraste
 *      perdu — traits, axes et caractères redeviennent nets.
 * L'alpha n'est JAMAIS touché : une figure détourée reste détourée.
 * @returns {{strength:number, amount:number, threshold:number, denoised:number, sharpened:number}}
 */
export const enhanceRgbaInPlace = (data, width, height, { strength } = {}) => {
  const s = clampUpscaleStrength(strength);
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const n = w * h;
  const stats = { strength: s, amount: 0, threshold: unsharpThresholdOf(s), denoised: 0, sharpened: 0 };
  if (!data || data.length < n * 4 || !s) return stats;
  const amount = sharpenAmountOf(s);
  const threshold = stats.threshold;
  const weight = 0.45 * (s / 100);
  const blur = blurRgba(data, w, h, blurRadiusOf(s), 2);
  stats.amount = amount;
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    for (let c = 0; c < 3; c += 1) {
      const cur = data[o + c];
      const soft = blur[o + c];
      const d = cur - soft;
      const ad = d < 0 ? -d : d;
      if (ad <= FLAT_DELTA) {
        const v = cur + (soft - cur) * weight;
        if (((v + 0.5) | 0) !== cur) { stats.denoised += 1; data[o + c] = v; }
      } else if (ad > threshold) {
        const v = cur + d * amount;
        if (((v + 0.5) | 0) !== cur) { stats.sharpened += 1; data[o + c] = v; }
      }
    }
  }
  return stats;
};
