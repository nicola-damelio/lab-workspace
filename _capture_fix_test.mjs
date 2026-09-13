// ============================================================================
// _capture_fix_test.mjs
//
// Regression test for the “📷 could not capture this element as an image”
// failure of the COMPOSITE (data-star-group) panels — e.g. the Flow Cytometry
// “📚 Split view” stack.
//
// Root cause: Tailwind v4 compiles its palette to oklch() (slate-50 is
// `oklch(98.4% .003 247.858)`), and html2canvas@1.x cannot parse oklch(), so
// the whole snapshot promise rejected before any pixel was drawn.
//
// Verified here:
//   • src/utils/captureColors.js — the rgb() fallback maths (pure, no DOM)
//   • src/components/ChartStarLayer.jsx — engine order (html2canvas-pro →
//     sanitised legacy html2canvas → own sub-chart compositor), the failure
//     reason surfaced by the 📷 button, and the panels it must cover.
// ============================================================================
import fs from 'fs';
import {
  hasUnsupportedColorFn, modernColorToRgb, normalizeColorString, toRgbCss,
  sanitizeColorsForHtml2Canvas
} from './src/utils/captureColors.js';

const results = [];
let passed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) results.push(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  else passed += 1;
};
const checkTrue = (name, cond) => check(name, !!cond, true);
const rgbOf = (css, tol = 3, want) => {
  const m = modernColorToRgb(css);
  if (!m) return `unresolved: ${css}`;
  const got = [m.r, m.g, m.b];
  return want.every((v, i) => Math.abs(v - got[i]) <= tol) ? 'ok' : `got ${got.join(',')} want ~${want.join(',')}`;
};
const checkColor = (name, css, want, tol = 3) => check(name, rgbOf(css, tol, want), 'ok');

/* ── 1. the exact Tailwind v4 palette values that broke the capture ───────── */
checkColor('slate-50 oklch → #f8fafc', 'oklch(98.4% .003 247.858)', [248, 250, 252]);
checkColor('slate-500 oklch → #62748e', 'oklch(55.4% .046 257.417)', [98, 116, 142]);
checkColor('slate-900 oklch → #0f172a', 'oklch(20.8% .042 265.755)', [15, 23, 42]);
checkColor('oklch gray 50%', 'oklch(50% 0 0)', [99, 99, 99], 8);
checkTrue('oklch gray has r == g == b', (() => {
  const m = modernColorToRgb('oklch(50% 0 0)');
  return m && m.r === m.g && m.g === m.b;
})());

/* ── 2. oklab / color() / alpha / angles ─────────────────────────────────── */
checkColor('oklab white', 'oklab(1 0 0)', [255, 255, 255]);
checkColor('oklab black', 'oklab(0 0 0)', [0, 0, 0]);
checkColor('oklab 50% gray', 'oklab(50% 0 0)', [99, 99, 99], 8);
checkColor('oklch hue in radians equals the same in degrees', 'oklch(60% .12 0.6rad)', (() => {
  const deg = modernColorToRgb('oklch(60% .12 34.377deg)');
  return [deg.r, deg.g, deg.b];
})(), 1);
checkColor('color(srgb)', 'color(srgb 1 0 0)', [255, 0, 0]);
checkColor('color(srgb-linear)', 'color(srgb-linear 1 1 1)', [255, 255, 255]);
check('oklch alpha 50%', modernColorToRgb('oklch(98.4% .003 247.858 / 50%)').a, 0.5);
checkTrue('alpha → rgba() string', /^rgba\(/.test(toRgbCss(modernColorToRgb('oklch(98.4% .003 247.858 / 50%)'))));
checkTrue('opaque → rgb() string', /^rgb\(/.test(toRgbCss(modernColorToRgb('oklch(0% 0 0)'))));

/* ── 3. what the maths must NOT guess ────────────────────────────────────── */
check('lab() left to the canvas resolver', modernColorToRgb('lab(50% 40 59.5)'), null);
check('color-mix() left to the canvas resolver', modernColorToRgb('color-mix(in oklab, white 50%, transparent)'), null);
check('color(display-p3 …) left to the canvas resolver', modernColorToRgb('color(display-p3 1 0 0)'), null);
check('relative colour left untouched', modernColorToRgb('oklch(from red l c h)'), null);
check('plain rgb is not “modern”', hasUnsupportedColorFn('rgb(1, 2, 3)'), false);
check('hex is not “modern”', hasUnsupportedColorFn('#f8fafc'), false);
check('none is not “modern”', hasUnsupportedColorFn('none'), false);
check('oklch is detected', hasUnsupportedColorFn('oklch(98.4% .003 247.858)'), true);
check('oklab is detected', hasUnsupportedColorFn('oklab(0.5 0 0)'), true);
check('bare “color” word is not detected', hasUnsupportedColorFn('background-color: red'), false);

/* ── 4. whole-value rewrite (gradients, shadows, borders) ────────────────── */
const gradient = normalizeColorString('linear-gradient(90deg, oklch(60% .12 200) 0%, rgb(0, 0, 0) 100%)');
check('gradient: no oklch left', /oklch\(/.test(gradient), false);
checkTrue('gradient: rgb() injected', /rgb\(/.test(gradient));
check('gradient: second stop preserved', /rgb\(0, 0, 0\) 100%/.test(gradient), true);
const shadow = normalizeColorString('0 0 0 2px oklch(55.4% .046 257.417)');
check('box-shadow: no oklch left', /oklch\(/.test(shadow), false);
checkTrue('box-shadow: geometry preserved', shadow.startsWith('0 0 0 2px rgb('));
check('unresolvable value returned unchanged', normalizeColorString('lab(50% 40 59.5)'), 'lab(50% 40 59.5)');
check('plain value returned unchanged', normalizeColorString('rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
check('nested parens do not confuse the scanner', normalizeColorString('inset 0 1px 2px rgba(0, 0, 0, 0.05)'), 'inset 0 1px 2px rgba(0, 0, 0, 0.05)');

/* ── 5. the DOM sanitizer is safe outside a browser ──────────────────────── */
check('sanitizer returns a no-op restore() without a DOM', typeof sanitizeColorsForHtml2Canvas(null), 'function');
check('sanitizer accepts a bare object without a DOM', typeof sanitizeColorsForHtml2Canvas({}), 'function');

/* ── 6. the capture layer wires the three engines in order ───────────────── */
const CSL = fs.readFileSync('src/components/ChartStarLayer.jsx', 'utf8');
const at = (needle) => CSL.indexOf(needle);
const PRO = "await import('html2canvas-pro')";
const LEGACY = "({ default: html2canvas } = await import('html2canvas'));";
checkTrue('[CSL] imports the colour sanitizer', at("import { sanitizeColorsForHtml2Canvas } from '../utils/captureColors';") >= 0);
checkTrue('[CSL] prefers html2canvas-pro', at(PRO) >= 0);
checkTrue('[CSL] keeps the legacy html2canvas fallback', at(LEGACY) >= 0);
checkTrue('[CSL] pro is tried BEFORE the legacy build', at(PRO) < at(LEGACY));
checkTrue('[CSL] normalises palette colours before the legacy snapshot',
  at('const restore = sanitizeColorsForHtml2Canvas(el);') > at(LEGACY));
checkTrue('[CSL] always restores the inline styles', /finally\s*\{\s*restore\(\);/.test(CSL));
checkTrue('[CSL] last-resort compositor defined', at('const composeChartsToCanvas = async (el) => {') > 0);
checkTrue('[CSL] compositor used when both engines fail', at('if (!canvas) canvas = await composeChartsToCanvas(el);') > 0);
checkTrue('[CSL] failure reason is exposed', at('export const captureFailureReason = () => captureReason;') > 0);
checkTrue('[CSL] the 📷 button explains the failure', at('⚠️ Could not capture this element as an image${why') > 0);
checkTrue('[CSL] a serialised chart keeps the app font', at('clone.style.fontFamily = cs.fontFamily;') > 0);
checkTrue('[CSL] the compositor re-renders vectors at 2×', at('svgToDataUrl(it.node, 2)') > 0);
checkTrue('[CSL] the old scroller expansion is untouched (older test)', at('if (!scrolls && cs.maxHeight === \'none\') return;') > 0);
checkTrue('[CSL] …and still restores it', at('n.style.maxHeight = maxHeight;') > 0);

/* ── 7. the dependency is really installed ───────────────────────────────── */
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
checkTrue('package.json declares html2canvas-pro', /^\^?2\./.test(String(pkg.dependencies['html2canvas-pro'] || '')));
checkTrue('the package is installed', fs.existsSync('node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js'));

/* ── 8. the composite panels that must be capturable are tagged ──────────── */
const STACK = fs.readFileSync('src/components/SplitChartStack.jsx', 'utf8');
checkTrue('[stack] renders the star-group attribute', STACK.includes('data-star-group={id}'));
checkTrue('[stack] renders its label', STACK.includes('data-star-label={label}'));
checkTrue('[stack] one row per series', STACK.includes('series.map((s, i) => ('));
checkTrue('[stack] rows are labelled (series name + colour dot)', STACK.includes('{s.label}'));
// The FCS panel is tagged inline; the three spectra pages delegate to the shared
// component, each with its own id so the Image Builder lists them separately.
checkTrue('[FCS] split panel is a star group',
  fs.readFileSync('src/components/FlowCytometrySections.jsx', 'utf8').includes('data-star-group="fcs-split"'));
const PAGES = [
  ['NMR', 'src/components/NMRSections.jsx', 'nmr-split', 'splitRowBoxStyle(splitLayout, i, '],
  ['ssNMR', 'src/components/ssNMRSections.jsx', 'ssnmr-split', 'splitRowBoxStyle(splitLayout, i, '],
  ['CD', 'src/components/CDSections.jsx', 'cd-split', 'splitRowBoxStyle(splitLayout, i, ']
];
PAGES.forEach(([tag, file, id, box]) => {
  const src = fs.readFileSync(file, 'utf8');
  checkTrue(`[${tag}] split stack mounted with its own id`, src.includes(`<SplitChartStack`) && src.includes(`id="${id}"`));
  checkTrue(`[${tag}] has a human label`, /id="[a-z]+-split"\s*\n\s*label="[^"]+"/.test(src));
  checkTrue(`[${tag}] imports the shared stack`, src.includes("from './SplitChartStack'"));
  checkTrue(`[${tag}] sub-charts are stacked rows`, src.includes(box));
  checkTrue(`[${tag}] the layout becomes a split row`, src.includes('lg:flex-row gap-3'));
});

/* ── report ──────────────────────────────────────────────────────────────── */
const body = results.length ? results.join('\n') : 'all checks passed';
fs.writeFileSync('_capture_fix_out.txt', `passed ${passed}/${passed + results.length}\n${body}\n`, 'utf8');
console.log(`passed ${passed}/${passed + results.length}`);
if (results.length) console.log(body);
