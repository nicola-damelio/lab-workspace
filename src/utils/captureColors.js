/* =========================================================================
   captureColors — colour normalisation for the html2canvas screenshot path.

   WHY: Tailwind v4 compiles its palette to `oklch()` (e.g. slate-50 is
   `oklch(98.4% .003 247.858)`), and html2canvas@1.x only parses rgb()/rgba()/
   hsl()/hsla()/hex/named colours. Every computed style carrying a palette
   colour therefore made the COMPOSITE panel snapshot (ChartStarLayer ▸
   `data-star-group` panels, e.g. the “📚 Split view” stacks) reject with
   `Attempting to parse an unsupported color function "oklch"` — which the UI
   showed as “⚠️ Could not capture this element as an image”.

   The capture layer prefers `html2canvas-pro` (oklch / oklab / lab / lch /
   color() / color-mix aware). These helpers are its FALLBACK: they rewrite the
   colour-bearing computed styles of a subtree into plain rgb()/rgba() just
   before the snapshot, then restore them. `modernColorToRgb` /
   `normalizeColorString` are pure (no DOM) so the colour maths stays
   unit-testable — see _capture_fix_test.mjs.
   ========================================================================= */

// Colour functions html2canvas@1.x cannot parse. `color-mix()` and `lab()`/
// `lch()` land here too: Tailwind v4 resolves `bg-white/70` to a colour-mix and
// Chromium serialises it as `oklab(...)`/`color(...)`, so they reach us as
// computed values in every case.
const MODERN_FN_RE = /(?:oklch|oklab|lab|lch|color-mix|light-dark|color)\s*\(/i;
const FN_NAMES = ['color-mix', 'light-dark', 'oklch', 'oklab', 'lab', 'lch', 'color'];

/** Does the string contain a colour function the legacy html2canvas rejects? */
export const hasUnsupportedColorFn = (value) =>
  typeof value === 'string' && MODERN_FN_RE.test(value);

// ---- numeric tokens -------------------------------------------------------
// A component is a number, optionally a percentage (`50%` → percentScale / 2).
const parseNum = (token, percentScale = 1) => {
  if (token == null) return null;
  const t = String(token).trim();
  if (!t || t === 'none') return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return m[2] === '%' ? (v / 100) * percentScale : v;
};

const parseAlpha = (token) => {
  if (token == null || token === '') return 1;
  const v = parseNum(token, 1); // 50% → 0.5
  if (v == null) return null;
  return Math.min(1, Math.max(0, v));
};

const parseAngle = (token) => {
  const t = String(token == null ? '' : token).trim();
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = (m[2] || 'deg').toLowerCase();
  if (unit === 'grad') return (v * 360) / 400;
  if (unit === 'rad') return (v * 180) / Math.PI;
  if (unit === 'turn') return v * 360;
  return v;
};

// ---- colour maths (CSS Color 4) ------------------------------------------
// OKLab → linear sRGB → γ-encoded sRGB (coefficients from the CSS Color 4
// specification — Björn Ottosson's OKLab).
const oklabToRgb = (L, a, b) => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
};

const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toByte = (v) => Math.round(clamp01(v) * 255);

/** `{ r, g, b, a }` (byte channels + 0..1 alpha) → an html2canvas-safe string. */
export const toRgbCss = ({ r, g, b, a = 1 }) =>
  (a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`);

/** Body of `name(...)`, with `/` spaced out so the alpha splits cleanly. */
const innerOf = (token) => {
  const open = token.indexOf('(');
  const close = token.lastIndexOf(')');
  if (open < 0 || close < open) return '';
  return token.slice(open + 1, close).replace(/\//g, ' / ').trim();
};

/** `L C H / A` → `{ comps: [L, C, H], alpha: 'A' }`. */
const splitParts = (inner) => {
  const [head, ...rest] = inner.split('/');
  return { comps: head.trim().split(/\s+/).filter(Boolean), alpha: rest.join('/').trim() };
};


/**
 * Convert ONE modern colour function (`oklch(...)`, `oklab(...)`,
 * `color(srgb …)`, `color(srgb-linear …)`) to `{ r, g, b, a }`.
 * Returns null for anything it cannot resolve (`lab()`, `lch()`,
 * `color-mix()`, relative colours, `color(display-p3 …)`) — the caller then
 * falls back to the canvas resolver / html2canvas-pro.
 */
export const modernColorToRgb = (token) => {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  const nameMatch = /^([a-z-]+)\s*\(/i.exec(t);
  if (!nameMatch) return null;
  const name = nameMatch[1].toLowerCase();
  const inner = innerOf(t);
  if (!inner) return null;
  const { comps, alpha: alphaRaw } = splitParts(inner);
  const a = parseAlpha(alphaRaw);
  if (a == null) return null;

  if (name === 'oklch' || name === 'oklab') {
    // oklch(L C H) · oklab(L a b) — L 0..1 (or %), C/a/b ±0.4 (or %), H in deg.
    if (comps.length < 3) return null;
    const L = parseNum(comps[0], 1);
    if (L == null) return null;
    if (name === 'oklch') {
      const C = parseNum(comps[1], 0.4);
      const H = parseAngle(comps[2]);
      if (C == null || H == null) return null;
      const rad = (H * Math.PI) / 180;
      const [lr, lg, lb] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
      return { r: toByte(linearToSrgb(lr)), g: toByte(linearToSrgb(lg)), b: toByte(linearToSrgb(lb)), a };
    }
    const A = parseNum(comps[1], 0.4);
    const B = parseNum(comps[2], 0.4);
    if (A == null || B == null) return null;
    const [lr, lg, lb] = oklabToRgb(L, A, B);
    return { r: toByte(linearToSrgb(lr)), g: toByte(linearToSrgb(lg)), b: toByte(linearToSrgb(lb)), a };
  }

  if (name === 'color') {
    // color(srgb r g b) · color(srgb-linear r g b) — components 0..1 (or %).
    const space = (comps[0] || '').toLowerCase();
    if (comps.length < 4 || (space !== 'srgb' && space !== 'srgb-linear')) return null;
    const raw = [1, 2, 3].map((i) => parseNum(comps[i], 1));
    if (raw.some((v) => v == null)) return null;
    const lin = space === 'srgb-linear';
    return {
      r: toByte(lin ? linearToSrgb(raw[0]) : raw[0]),
      g: toByte(lin ? linearToSrgb(raw[1]) : raw[1]),
      b: toByte(lin ? linearToSrgb(raw[2]) : raw[2]),
      a
    };
  }
  return null;
};

// Index of the `)` matching the `(` at `openIdx`, or -1.
const matchBalanced = (str, openIdx) => {
  let depth = 0;
  for (let i = openIdx; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/**
 * Replace every resolvable modern colour function inside a longer CSS value
 * (`background-image: linear-gradient(90deg, oklch(…) 0%, rgb(0,0,0) 100%)`,
 * `box-shadow: 0 0 0 2px oklch(…)`, …). Unresolvable tokens stay untouched.
 */
export const normalizeColorString = (value) => {
  if (typeof value !== 'string' || !value.includes('(')) return value;
  let out = '';
  let i = 0;
  let changed = false;
  while (i < value.length) {
    const name = FN_NAMES.find((n) => value.startsWith(n, i) && value[i + n.length] === '(');
    if (!name) {
      out += value[i];
      i += 1;
      continue;
    }
    const open = i + name.length;
    const close = matchBalanced(value, open);
    if (close < 0) {
      out += value.slice(i);
      break;
    }
    const token = value.slice(i, close + 1);
    const rgba = modernColorToRgb(token);
    if (rgba) {
      out += toRgbCss(rgba);
      changed = true;
    } else {
      out += token;
    }
    i = close + 1;
  }
  return changed ? out : value;
};

// ---- DOM sanitizer (fallback path only) -----------------------------------
// Every computed style html2canvas parses for a colour.
const COLOR_PROPS = [
  'color', 'background-color', 'background-image',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-image-source', 'outline-color', 'text-decoration-color',
  'column-rule-color', 'caret-color',
  '-webkit-text-fill-color', '-webkit-text-stroke-color',
  'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
  'box-shadow', 'text-shadow', 'filter'
];

let scratch = null;
const scratchCtx = () => {
  if (scratch !== null) return scratch;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    scratch = c.getContext('2d', { willReadFrequently: true }) || null;
  } catch {
    scratch = null;
  }
  return scratch;
};

// Let the BROWSER resolve whatever the maths above cannot (lab(), lch(),
// color-mix(), color(display-p3 …), relative colours…): paint one pixel and
// read it back. A sentinel tells us whether the browser understood the value.
const SENTINEL = 'rgb(1, 2, 3)';
const resolveViaCanvas = (raw) => {
  const ctx = scratchCtx();
  if (!ctx) return null;
  try {
    ctx.fillStyle = SENTINEL;
    ctx.fillStyle = raw;
    if (ctx.fillStyle === SENTINEL) return null; // browser refused the colour
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return toRgbCss({ r, g, b, a: a / 255 });
  } catch {
    return null;
  }
};

/**
 * Rewrite the modern colour functions of a subtree into rgb()/rgba() so the
 * legacy html2canvas can parse the panel. Returns a `restore()` function that
 * puts every inline style back exactly as it was (call it from a `finally`).
 */
export const sanitizeColorsForHtml2Canvas = (root) => {
  if (!root || typeof root.querySelectorAll !== 'function' || typeof window === 'undefined') {
    return () => {};
  }
  const patched = [];
  const visit = (el) => {
    let cs = null;
    try { cs = window.getComputedStyle(el); } catch { return; }
    if (!cs) return;
    const writes = [];
    for (const prop of COLOR_PROPS) {
      let val = '';
      try { val = cs.getPropertyValue(prop) || ''; } catch { val = ''; }
      if (!val || val === 'none' || !hasUnsupportedColorFn(val)) continue;
      const fixed = normalizeColorString(val);
      if (fixed !== val && !hasUnsupportedColorFn(fixed)) {
        writes.push([prop, fixed]);
        continue;
      }
      const viaCanvas = resolveViaCanvas(val);
      if (viaCanvas) writes.push([prop, viaCanvas]);
    }
    if (!writes.length) return;
    patched.push({ el, css: el.getAttribute('style') || '' });
    writes.forEach(([prop, value]) => {
      try { el.style.setProperty(prop, value); } catch { /* ignore */ }
    });
  };
  visit(root);
  try { root.querySelectorAll('*').forEach(visit); } catch { /* ignore */ }
  return () => {
    patched.forEach(({ el, css }) => {
      try {
        if (css) el.setAttribute('style', css);
        else el.removeAttribute('style');
      } catch { /* ignore */ }
    });
  };
};
