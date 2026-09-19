// ============================================================================
// _spectra_split_test.mjs
//
// “Split view” for the SPECTRA pages (NMR 1D overlay · ssNMR · CD), mirroring
// the Flow Cytometry “📚 Split view — single curves” panel:
//   • the overlaid curves can be split into ONE graph per condition,
//   • stacked vertically in a single card,
//   • tagged `data-star-group`, so the ChartStarLayer offers the WHOLE stack as
//     ONE ⭐ / 📷 item → the split figure is captured / starred / saved as a
//     SINGLE image (the Image Builder then places it as one block),
//   • and the stack follows the page's LAYOUT — the width : height ratio of one
//     sub-chart (0 = the default 375 px box, 2.5 × the 150 px it started at),
//     the HEIGHT of one graph (the distance between two curves, i.e. the knob
//     that brings them together until they almost touch), the vertical
//     separation between two graphs, and the “No Y axis” switch that drops the
//     axes of a row (see SplitLayoutControls, sections 3d / 3e below).
//
// The shared component is imported for REAL (transformed with the project's own
// bundler, rolldown) and rendered with react-dom/server, so its structure is
// checked behaviourally — not only by grepping the source.
// ============================================================================
import fs from 'fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';

const results = [];
let passed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) results.push(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  else passed += 1;
};
const checkTrue = (name, cond) => check(name, !!cond, true);

/* ── 1. load the component for real ─────────────────────────────────────── */
const bundle = await rolldown({
  input: 'src/components/SplitChartStack.jsx',
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  transform: { jsx: { runtime: 'automatic' } }
});
const { output } = await bundle.generate({ format: 'esm' });
const bundleFile = 'tmp_splitstack_bundle.mjs';
fs.writeFileSync(bundleFile, output.map((o) => o.code).join('\n'), 'utf8');
const {
  SplitChartStack, SplitToggle, SplitLayoutControls, SPLIT_CHART_H, SPLIT_CHART_MIN_H,
  SPLIT_ASPECT_STEPS, SPLIT_GAP_MAX, SPLIT_ROW_H_MIN, SPLIT_ROW_H_MAX, SPLIT_PACK_H,
  SPLIT_RULER_H, splitChartBoxStyle, splitRowBoxStyle, splitRowGapStyle, splitLayoutOf,
  withSplitLayout, normalizeSplitLayout, splitYAxisHidden, splitYAxisProps, splitXAxisHidden,
  splitXAxisKept, splitChartMargin, splitChartClass, splitOwnHeight,
  hiddenSeriesOf, withoutSeries
} = await import(`./${bundleFile}`);

const SERIES = [
  { key: 'c1', label: 'Condition A — Spectrum', color: '#ff0000' },
  { key: 'c2', label: 'Condition B — Spectrum', color: '#0000ff' }
];
const html = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'cd-split',
  label: 'Split view — individual spectra',
  series: SERIES,
  renderChart: (s) => React.createElement('svg', { 'data-chart': s.key, key: s.key })
}));
const empty = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'nmr-split', label: 'Empty', series: [], renderChart: () => null
}));

/* ── 2. the stack really is ONE figure item ────────────────────────────── */
const countOf = (needle) => html.split(needle).length - 1;
check('[stack] exposes exactly ONE star-group item', countOf('data-star-group'), 1);
checkTrue('[stack] …with the page id', html.includes('data-star-group="cd-split"'));
checkTrue('[stack] …and its label', html.includes('data-star-label="Split view — individual spectra"'));
checkTrue('[stack] header names the view', html.includes('📚 Split view — individual spectra'));
check('[stack] the count of curves is shown', countOf('curves'), 1);
checkTrue('[stack] …correctly counted', html.includes('>2 curves<'));
check('[stack] one row per series', countOf('border-b border-slate-100 last:border-b-0'), 2);
check('[stack] one chart per series', countOf('data-chart='), 2);
checkTrue('[stack] charts are rendered in ROW order',
  html.indexOf('data-chart="c1"') < html.indexOf('data-chart="c2"'));
checkTrue('[stack] each row is captioned with the series name', html.includes('Condition A — Spectrum'));
checkTrue('[stack] each row carries the series colour', html.includes('background-color:#ff0000'));
checkTrue('[stack] the inner scroller is expandable by the capture', html.includes('overflow-y-auto'));
checkTrue('[stack] …and bounded on screen', html.includes('max-h-[70vh]'));
check('[stack] an empty stack does not throw', empty.includes('data-star-group="nmr-split"'), true);
/* Each graph is 2.5 × taller than the 150 px box the stack started with, and
   the ratio floor scaled with it (see SPLIT_CHART_H / SPLIT_CHART_MIN_H). */
check('[stack] a sub-chart is 2.5 × the 150 px box it started with', SPLIT_CHART_H, 375);
check('[stack] …and its ratio floor scaled with it', SPLIT_CHART_MIN_H, 180);

/* ── 3. the Split / Same Y controls ─────────────────────────────────────── */
const toggles = (sharedY) => renderToStaticMarkup(React.createElement(SplitToggle, {
  on: true, onToggle: () => {}, sharedY, onToggleSharedY: () => {}
}));
const withShared = toggles(false);
const withoutShared = toggles(null);
checkTrue('[toggle] offers “Split”', withShared.includes('Split'));
check('[toggle] checked = split is on', (withShared.match(/type="checkbox"/g) || []).length, 2);
check('[toggle] “Same Y” appears only when splitting', withoutShared.includes('Same Y'), false);
checkTrue('[toggle] “Same Y” is offered when splitting', withShared.includes('Same Y'));
checkTrue('[toggle] explains what split does', withShared.includes('stacked vertically on the right'));

/* ── 3b. the SHAPE of a sub-chart + the SEPARATION between the graphs ─────
   `layout = { aspect, gap }`: the ratio each sub-chart box is drawn with
   (0 = the default 375 px box) and the space inserted between two
   stacked graphs. Both are clamped, and the two knobs live OUTSIDE the tagged
   card — a control must never end up in the captured figure. */
const spaced = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'cd-split', label: 'Spaced', series: SERIES,
  layout: { aspect: 2.5, gap: 12 },
  renderChart: (s) => React.createElement('svg', { 'data-chart': s.key, key: s.key })
}));
check('[layout] the graphs are separated by the layout', (spaced.match(/margin-bottom:12px/g) || []).length, 2);
check('[layout] the default stack carries no separator at all', html.includes('margin-bottom'), false);
check('[layout] a control is never part of the captured figure',
  spaced.includes('Shape') || spaced.includes('>Gap<') || spaced.includes('>Height<')
  || spaced.includes('>Pack<'), false);
check('splitChartBoxStyle keeps the default box when no shape was asked for',
  splitChartBoxStyle(null), { width: '100%', height: 375 });
check('splitChartBoxStyle sizes the box by the ratio when asked',
  splitChartBoxStyle({ aspect: 2 }), { width: '100%', aspectRatio: '2', minHeight: 180 });
check('[layout] a definite height and a ratio are never mixed',
  'height' in splitChartBoxStyle({ aspect: 2 }), false);
// A HOST page may size its own “own” box: the Flow Cytometry split panel draws
// its mini charts with the height of its own Graphical Parameters, so the knob
// there has to keep meaning “the height I set in that panel”. The ratio still
// beats it, and an unusable value falls back to the default box.
check('[layout] the “own” box can be the height the host page uses',
  splitChartBoxStyle(null, 200), { width: '100%', height: 200 });
check('[layout] …and the ratio still beats it',
  splitChartBoxStyle({ aspect: 4 }, 200), { width: '100%', aspectRatio: '4', minHeight: 180 });
check('[layout] an unusable host height falls back to the default box',
  [splitChartBoxStyle(null, ''), splitChartBoxStyle(null, 0), splitChartBoxStyle(null, 'abc')],
  [{ width: '100%', height: 375 }, { width: '100%', height: 375 }, { width: '100%', height: 375 }]);
check('[layout] the host height is a plain number',
  [splitOwnHeight(200), splitOwnHeight(), splitOwnHeight('240')], [200, 375, 240]);
check('[layout] the ratio is clamped', normalizeSplitLayout({ aspect: 99, gap: 999 }), { aspect: 8, rowH: 0, gap: 48, yAxis: true });
check('[layout] …and a nonsense value falls back to “own”',
  normalizeSplitLayout({ aspect: 'abc', gap: -5 }), { aspect: 0, rowH: 0, gap: 0, yAxis: true });
check('[layout] an unusable ratio is raised to the minimum', normalizeSplitLayout({ aspect: 0.1 }).aspect, 0.5);
check('[layout] 0 means “keep the historical box”', normalizeSplitLayout({ aspect: 0, gap: 0 }), { aspect: 0, rowH: 0, gap: 0, yAxis: true });
check('[layout] the gap is undefined at 0 (nothing changes)', splitRowGapStyle({ gap: 0 }), undefined);
check('[layout] …and a plain margin when asked', splitRowGapStyle({ gap: 6 }), { marginBottom: 6 });
check('[layout] a missing layout is safe', splitLayoutOf(null), { aspect: 0, rowH: 0, gap: 0, yAxis: true });
check('[layout] the layout stored on the experiment is read back',
  splitLayoutOf({ splitLayout: { aspect: 3, gap: 4 } }), { aspect: 3, rowH: 0, gap: 4, yAxis: true });
check('[layout] a change merges with what was already stored',
  withSplitLayout({ splitLayout: { aspect: 3, gap: 4 } }, { gap: 20 }), { aspect: 3, rowH: 0, gap: 20, yAxis: true });
check('[layout] …and is clamped on the way in',
  withSplitLayout({ splitLayout: { aspect: 3 } }, { aspect: 100 }), { aspect: 8, rowH: 0, gap: 0, yAxis: true });

/* ── 3c. the two knobs of the page toolbar ──────────────────────────────── */
const controls = (layout) => renderToStaticMarkup(React.createElement(SplitLayoutControls, {
  layout, onChange: () => {}
}));
const plain = controls(null);
checkTrue('[controls] offers “own”, the default box', plain.includes('own (375 px)'));
// …and says what “own” really is on a page that sizes its own box.
const hosted = renderToStaticMarkup(React.createElement(SplitLayoutControls, {
  layout: null, onChange: () => {}, baseHeight: 200
}));
checkTrue('[controls] names the “own” box of the host page',
  hosted.includes('own (200 px)') && hosted.includes('200 px box'));
checkTrue('[controls] offers the one-click shapes', />2 : 1</.test(plain));
checkTrue('[controls] offers the separation', plain.includes('Gap') && /\d+ px/.test(plain));
checkTrue('[controls] shows the stored gap', controls({ gap: 20 }).includes('20 px'));
const shaped = controls({ aspect: 2.5 });
checkTrue('[controls] shows the stored shape', shaped.includes('>2.5 : 1</'));
checkTrue('[controls] …in the select', /value="2\.5"[^>]*selected/.test(shaped));
checkTrue('[controls] …and in the free field', shaped.includes('value="2.5"'));
const custom = controls({ aspect: 3.3 });
checkTrue('[controls] a ratio outside the presets stays listed', />3\.3 : 1</.test(custom));
checkTrue('[controls] …and stays selected', /value="3\.3"[^>]*selected/.test(custom));
check('[controls] …so it is never silently snapped', normalizeSplitLayout({ aspect: 3.3 }).aspect, 3.3);
checkTrue('[controls] the presets really are the shared list', SPLIT_ASPECT_STEPS.includes(3));
check('[controls] the gap knob is bounded', SPLIT_GAP_MAX, 48);

/* ── 3d. “No Y axis” — the switch that really packs the curves ────────────
   The Gap knob sets the space BETWEEN two rows, but a row also carries its own
   furniture: the caption line, the box padding, the x-tick row and — with a Y
   axis — the round-tick headroom above each peak. `layout.yAxis === false` (the
   “No Y axis” checkbox) drops all of it, so two curves really come close. The
   readers below are what the four split views use to do exactly that. */
const PACKED = { yAxis: false };
check('[packed] the Y axis is shown unless the layout hid it',
  [splitYAxisHidden(null), splitYAxisHidden({}), splitYAxisHidden({ yAxis: true }), splitYAxisHidden(PACKED)],
  [false, false, false, true]);
check('[packed] …and nothing but an explicit false hides it', splitYAxisHidden({ yAxis: 'no' }), false);
check('[packed] the switch survives a round trip',
  withSplitLayout({ splitLayout: { gap: 6, yAxis: false } }, { gap: 8 }), { aspect: 0, rowH: 0, gap: 8, yAxis: false });
check('[packed] the YAxis of a sub-chart loses its gutter',
  [splitYAxisProps(null, 44), splitYAxisProps(PACKED, 44)], [{ width: 44 }, { hide: true, width: 0 }]);
check('[packed] only the bottom row keeps the X ruler',
  [splitXAxisHidden(null, 0, 3), splitXAxisHidden(PACKED, 0, 3), splitXAxisHidden(PACKED, 2, 3), splitXAxisHidden(PACKED, 0, 1)],
  [false, true, false, false]);
check('[packed] …and it is the ONE row that really draws it',
  [splitXAxisKept(null, 0, 3), splitXAxisKept(PACKED, 0, 3), splitXAxisKept(PACKED, 2, 3), splitXAxisKept(PACKED, 0, 1)],
  [false, false, true, true]);
check('[packed] a packed row loses the room its axes took',
  [splitChartMargin(null, { top: 5, bottom: 18 }, 0, 3),
   splitChartMargin(PACKED, { top: 5, bottom: 18 }, 0, 3),
   splitChartMargin(PACKED, { top: 5, bottom: 18 }, 2, 3)],
  [{ top: 5, bottom: 18 }, { top: 0, bottom: 0 }, { top: 0, bottom: SPLIT_RULER_H }]);
check('[packed] …and the ruler row keeps its numbers’ room, not the page’s margin',
  // A page margin sized for a full-size chart (numbers + title) would push the
  // ruler up into the middle of a short lane — see splitChartMargin.
  [splitChartMargin(PACKED, { top: 5, bottom: 54 }, 1, 2).bottom,
   splitChartMargin(PACKED, { top: 5, bottom: 18 }, 1, 2).bottom,
   splitChartMargin(PACKED, {}, 1, 2).bottom],
  [SPLIT_RULER_H, SPLIT_RULER_H, SPLIT_RULER_H]);
check('[packed] …and its box loses the padding of the caption',
  [splitChartClass(null), splitChartClass(PACKED), splitChartClass(PACKED, 'w-1/2 mx-auto pb-1')],
  ['px-2 pb-1', 'px-1', 'px-1']);
const packedHtml = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'cd-split', label: 'Packed', series: SERIES, layout: PACKED,
  renderChart: (s) => React.createElement('svg', { 'data-chart': s.key, key: s.key })
}));
checkTrue('[packed] a packed row still says which curve it is', packedHtml.includes('Condition A — Spectrum'));
checkTrue('[packed] …as a caption OVER the box, taking no line of its own',
  packedHtml.includes('absolute top-0 left-1'));
check('[packed] …while the rows keep their hairlines',
  packedHtml.split('border-b border-slate-100 last:border-b-0').length - 1, 2);
check('[packed] …and the stack is still ONE figure item',
  packedHtml.split('data-star-group').length - 1, 1);
check('[packed] nothing but the curves is left between two rows (and one ruler)',
  [packedHtml.includes('px-2.5 pt-1.5 pb-0.5'), (packedHtml.match(/data-chart=/g) || []).length], [false, 2]);
const noY = controls(PACKED);
checkTrue('[controls] offers the packed switch', plain.includes('No Y axis') && noY.includes('No Y axis'));
check('[controls] …off while the axis is shown', plain.includes('checked=""'), false);
check('[controls] …on as soon as the axis is hidden', noY.includes('checked=""'), true);

/* ── 3e. the HEIGHT of a stacked graph — how far two curves sit apart ──────
   The Gap knob only ADDS space between two rows and the Shape knob only sizes
   the box against the width it was given (with a SPLIT_CHART_MIN_H floor). The
   distance between the PEAKS of two curves IS the height of one lane, because
   a lane draws its curve from its own baseline to its own peak. `layout.rowH`
   turns that into a plain number of px, so the curves can be brought together
   until they almost touch — and “Pack” writes the tightest value of all three
   knobs in one click. */
const LANE = { rowH: 60, gap: 0, yAxis: false };
check('[height] a lane height only counts when it was given',
  [normalizeSplitLayout({}).rowH, normalizeSplitLayout({ rowH: 0 }).rowH,
   normalizeSplitLayout({ rowH: '' }).rowH, normalizeSplitLayout({ rowH: 'abc' }).rowH],
  [0, 0, 0, 0]);
check('[height] …a negative one too', normalizeSplitLayout({ rowH: -80 }).rowH, 0);
check('[height] …while a real one is clamped to a readable lane',
  [normalizeSplitLayout({ rowH: 5 }).rowH, normalizeSplitLayout({ rowH: 9999 }).rowH],
  [SPLIT_ROW_H_MIN, SPLIT_ROW_H_MAX]);
check('[height] a lane height sizes the box in px', splitChartBoxStyle({ rowH: 60 }), { width: '100%', height: 60 });
check('[height] …beats the Shape knob', splitChartBoxStyle({ rowH: 60, aspect: 4 }), { width: '100%', height: 60 });
check('[height] …and the “own” box of the host page', splitChartBoxStyle({ rowH: 60 }, 200), { width: '100%', height: 60 });
check('[height] a definite height is NEVER mixed with a ratio or a floor',
  ['height' in splitChartBoxStyle({ aspect: 4 }), 'aspectRatio' in splitChartBoxStyle({ rowH: 60 }),
   'minHeight' in splitChartBoxStyle({ rowH: 60 })], [false, false, false]);
check('[height] clearing the field gives the Shape back',
  splitChartBoxStyle({ rowH: 0, aspect: 2 }), { width: '100%', aspectRatio: '2', minHeight: 180 });
check('[height] the lane survives a round trip',
  withSplitLayout({ splitLayout: { rowH: 60, gap: 6 } }, { gap: 8 }), { aspect: 0, rowH: 60, gap: 8, yAxis: true });
const tight = controls(LANE);
checkTrue('[controls] offers the Height field and shows the stored lane',
  plain.includes('>Height</span>') && tight.includes('value="60"'));
checkTrue('[controls] …saying that it is what brings the curves together',
  tight.includes('peaks of two curves sit exactly that far apart') && tight.includes('almost touch'));
checkTrue('[controls] …bounded like the shared reader', tight.includes('min="30"') && tight.includes('max="480"'));
checkTrue('[controls] offers the one-click “Pack”', tight.includes('>Pack</button>') && tight.includes('almost touch'));
checkTrue('[pack] …the tightest stack the component can draw',
  SPLIT_PACK_H === 60 && SPLIT_PACK_H >= SPLIT_ROW_H_MIN && SPLIT_PACK_H <= SPLIT_ROW_H_MAX);
const STACK_SRC = fs.readFileSync('src/components/SplitChartStack.jsx', 'utf8');
checkTrue('[pack] …writing all three knobs at once',
  STACK_SRC.includes('onClick={() => set({ yAxis: false, gap: 0, rowH: SPLIT_PACK_H })}'));
const tightHtml = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'cd-split', label: 'Tight', series: SERIES, layout: LANE,
  renderChart: (s) => React.createElement('svg', { 'data-chart': s.key, key: s.key })
}));
check('[height] a tight stack separates nothing at all',
  [tightHtml.includes('margin-bottom'), (tightHtml.match(/data-chart=/g) || []).length], [false, 2]);
checkTrue('[height] …and its rows still say which curve they are',
  tightHtml.includes('Condition A — Spectrum') && tightHtml.includes('absolute top-0 left-1'));

/* ── 3f. the X RULER gets a strip of its own, at the BOTTOM of the pack ────
   The bottom row used to reserve the page's own bottom margin for its ruler —
   the room a FULL-SIZE chart needs for its x numbers AND their title (~54 px on
   the CD / ssNMR pages). In a 60 px lane that left a 6 px curve, pushed the
   ruler up into the middle of the pack (and recharts even dropped the numbers
   when the plot area collapsed). The ruler row therefore reserves exactly
   SPLIT_RULER_H (splitChartMargin) and GROWS by the same number
   (splitRowBoxStyle), so the ruler is drawn under the last lane — the last
   thing of the pack — while every lane keeps the height the Height knob asks
   for. Both helpers read the same predicate (splitXAxisKept), so they cannot
   drift apart. */
check('[ruler] the room the numbers need is a small part of a lane', SPLIT_RULER_H, 30);
check('[ruler] a packed lane keeps its height, only the ruler row grows',
  [splitRowBoxStyle(LANE, 0, 2), splitRowBoxStyle(LANE, 1, 2)],
  [{ width: '100%', height: 60 }, { width: '100%', height: 60 + SPLIT_RULER_H }]);
check('[ruler] …and the strip IS the margin that row reserves',
  [splitRowBoxStyle(LANE, 1, 2).height - splitRowBoxStyle(LANE, 0, 2).height,
   splitChartMargin(LANE, { top: 5, bottom: 54 }, 1, 2).bottom],
  [SPLIT_RULER_H, SPLIT_RULER_H]);
check('[ruler] a stack that is NOT packed is left exactly as it was',
  [splitRowBoxStyle({}, 0, 2), splitRowBoxStyle({ rowH: 60 }, 1, 2), splitRowBoxStyle({ aspect: 3 }, 0, 1)],
  [{ width: '100%', height: SPLIT_CHART_H }, { width: '100%', height: 60 },
   { width: '100%', aspectRatio: '3', minHeight: SPLIT_CHART_MIN_H }]);
check('[ruler] a lone row of a packed stack keeps the ruler AND the strip',
  splitRowBoxStyle(LANE, 0, 1), { width: '100%', height: 60 + SPLIT_RULER_H });
check('[ruler] the “own” box of a page grows by the strip for the ruler too',
  [splitRowBoxStyle({ yAxis: false }, 1, 2), splitRowBoxStyle({ yAxis: false }, 1, 2, 200)],
  [{ width: '100%', height: SPLIT_CHART_H + SPLIT_RULER_H },
   { width: '100%', height: 200 + SPLIT_RULER_H }]);
check('[ruler] a ratio-sized box keeps its ratio (it is tall enough already)',
  splitRowBoxStyle({ yAxis: false, aspect: 3 }, 1, 2),
  { width: '100%', aspectRatio: '3', minHeight: SPLIT_CHART_MIN_H });

/* ── 4b. taking a condition OUT of the split view ─────────────────────────
   Every row carries a small 🚫 switch; a curve that is out keeps its row
   (struck through, ↩️ to put it back) but takes NO lane, so the rank + count
   handed to `renderChart` are those of the curves really drawn and the X ruler
   stays on the last lane the user sees. The switch and the struck-through row
   are marked `data-star-skip`, which ChartStarLayer hides while it snapshots
   the panel — and the TITLE BAR sits outside the tagged element — so neither
   the “📚 Split view …” strip nor a switch can end up in a 📷 figure. */
const HIDDEN = { c2: true };
const drawn = [];
const withSwitches = renderToStaticMarkup(React.createElement(SplitChartStack, {
  id: 'cd-split', label: 'Split', series: SERIES, excluded: HIDDEN, onToggleExclude: () => {},
  renderChart: (s, i, count) => {
    drawn.push([s.key, i, count]);
    return React.createElement('svg', { 'data-chart': s.key, key: s.key });
  }
}));
checkTrue('[exclude] the title bar is OUTSIDE the captured element',
  html.indexOf('📚 Split view — individual spectra') < html.indexOf('data-star-group'));
check('[exclude] a stack nobody excludes carries no switch', html.includes('data-star-skip'), false);
check('[exclude] a page that offers the switch gets one on EVERY row',
  [withSwitches.split('title="Take').length - 1, withSwitches.split('title="Put').length - 1], [1, 1]);
checkTrue('[exclude] …and each one is marked for the capture (row + switch)',
  withSwitches.split('data-star-skip="1"').length - 1 >= 3);
check('[exclude] the curve that is out takes no lane', withSwitches.includes('data-chart="c2"'), false);
checkTrue('[exclude] …while the kept one is drawn', withSwitches.includes('data-chart="c1"'));
check('[exclude] …and the rank + count follow the curves really drawn', drawn, [['c1', 0, 1]]);
check('[exclude] the row of a curve that is out stays, struck through',
  [withSwitches.includes('line-through'), withSwitches.includes('Condition B — Spectrum')], [true, true]);
checkTrue('[exclude] …asking to be put back', withSwitches.includes('↩️'));
checkTrue('[exclude] the header counts the curves really drawn', withSwitches.includes('>1 curve<'));
check('[exclude] the series list itself is never touched', SERIES.length, 2);
check('[exclude] the stored map is read safely',
  [hiddenSeriesOf(null), hiddenSeriesOf({}), hiddenSeriesOf({ hiddenSeries: HIDDEN })], [{}, {}, HIDDEN]);
check('[exclude] flipping a key adds it', withoutSeries({}, 'b'), { b: true });
check('[exclude] …and removes it again', withoutSeries({ hiddenSeries: HIDDEN }, 'c2'), {});
const storedMap = { c2: true };
withoutSeries({ hiddenSeries: storedMap }, 'c1');
check('[exclude] …without ever touching the map handed in', storedMap, { c2: true });

/* ── 5. each spectra page mounts its own stack ──────────────────────────── */
const PAGES = [
  {
    tag: 'NMR',
    file: 'src/components/NMRSections.jsx',
    id: 'nmr-split',
    label: 'Split view — 1D spectra',
    feed: ['series={seriesList}', 'excluded={hiddenSeries}', 'onToggleExclude={toggleHiddenSeries}'],
    font: 'const splitFontSize = Math.max(9, Number((activeTest.nmr1dChartCfg || {}).fontSize) || 9);',
    yShared: "splitSharedY ? yDomain : ['dataMin', 'dataMax']",
    extras: [
      ['keeps the ppm axis (reversed)', 'reversed={true}'],
      ['reuses the overlay x domain', 'domain={dom}'],
      ['keeps the thin curve style', 'strokeWidth={1.5}'],
      ['the stack is not hidden with the overlay', '(showOverlay || splitStack)']
    ]
  },
  {
    tag: 'ssNMR',
    file: 'src/components/ssNMRSections.jsx',
    id: 'ssnmr-split',
    label: 'Split view — individual spectra',
    feed: ['series={seriesList}', 'excluded={hiddenSeries}', 'onToggleExclude={toggleHiddenSeries}'],
    font: 'const splitFontSize = Math.max(9, Number(tickSize(cfg)) || 16);',
    yShared: 'splitSharedY ? [yAutoMin, yAutoMax]',
    extras: [
      ['reuses the overlay Y auto-domain', 'yAutoMin'],
      ['keeps the series colours', 'stroke={s.color}']
    ]
  },
  {
    tag: 'CD',
    file: 'src/components/CDSections.jsx',
    id: 'cd-split',
    label: 'Split view — individual spectra',
    feed: ['series={seriesList}', 'excluded={hiddenSeries}', 'onToggleExclude={toggleHiddenSeries}'],
    font: 'const splitFontSize = Math.max(9, Number(tickSize(cfg)) || 16);',
    yShared: 'splitSharedY ? [yDataMin, yDataMax]',
    extras: [
      ['reuses the overlay Y domain', 'yDataMin'],
      ['keeps the series colours', 'stroke={s.color}']
    ]
  }
];

PAGES.forEach((p) => {
  const src = fs.readFileSync(p.file, 'utf8');
  const count = (needle) => src.split(needle).length - 1;
  checkTrue(`[${p.tag}] imports the shared stack`, src.includes("import { SplitChartStack, SplitLayoutControls, SplitToggle, splitRowBoxStyle, splitChartClass, splitChartMargin, splitLayoutOf, splitXAxisHidden, splitYAxisProps, withSplitLayout, hiddenSeriesOf, withoutSeries } from './SplitChartStack';"));
  checkTrue(`[${p.tag}] mounts the stack`, count('<SplitChartStack') === 1);
  checkTrue(`[${p.tag}] …with its own id`, src.includes(`id="${p.id}"`));
  checkTrue(`[${p.tag}] …named for the user`, src.includes(`label="${p.label}"`));
  // The stack is fed EVERY condition plus the map of those taken out, so a row
  // can be excluded — and put back — right from the split view, and that
  // exclusion lives on the experiment (the same `hiddenSeries` key the Flow
  // Cytometry panel has always used).
  p.feed.forEach((needle) => checkTrue(`[${p.tag}] …${needle}`, src.includes(needle)));
  checkTrue(`[${p.tag}] the exclusions are read from the experiment`,
    src.includes('const hiddenSeries = hiddenSeriesOf(activeTest);'));
  checkTrue(`[${p.tag}] …and written straight back`,
    src.includes('const toggleHiddenSeries = (key) => updateActiveTest({ hiddenSeries: withoutSeries(activeTest, key) });'));
  checkTrue(`[${p.tag}] the condition chips share that ONE map`,
    src.includes('onChange={() => toggleHiddenSeries(s.key)}'));
  checkTrue(`[${p.tag}] …one chart per series`, src.includes('renderChart={(s, i, count) => ('));
  checkTrue(`[${p.tag}] …sized by the shared layout helper`, src.includes('splitRowBoxStyle(splitLayout, i, '));
  checkTrue(`[${p.tag}] …with the count the stack hands it (the curves really drawn)`,
    src.includes('splitRowBoxStyle(splitLayout, i, count)'));
  checkTrue(`[${p.tag}] …handed to the box of EVERY row (the ruler row included)`,
    src.includes('style={splitRowBoxStyle(splitLayout, i, ') && !src.includes('style={splitBoxStyle}'));
  checkTrue(`[${p.tag}] the stack is handed that layout`, src.includes('layout={splitLayout}'));
  checkTrue(`[${p.tag}] the layout is read from the experiment`,
    src.includes('const splitLayout = splitLayoutOf(activeTest);'));
  checkTrue(`[${p.tag}] …and written straight back`,
    src.includes('const changeSplitLayout = (patch) => updateActiveTest({ splitLayout: withSplitLayout(activeTest, patch) });'));
  checkTrue(`[${p.tag}] the toolbar offers the shape + separation knobs`,
    src.includes('{splitStack && <SplitLayoutControls layout={splitLayout} onChange={changeSplitLayout} />}'));
  checkTrue(`[${p.tag}] the split is persisted on the experiment`,
    src.includes('useState(!!activeTest.splitStack)') && src.includes('updateActiveTest({ splitStack: nv })'));
  checkTrue(`[${p.tag}] …and so is “Same Y”`,
    src.includes('useState(!!activeTest.splitSharedY)') && src.includes('updateActiveTest({ splitSharedY: nv })'));
  checkTrue(`[${p.tag}] the toolbar offers the Split + Same Y controls`,
    src.includes('<SplitToggle on={splitStack} onToggle={toggleSplitStack} sharedY={splitSharedY} onToggleSharedY={toggleSplitSharedY} />'));
  checkTrue(`[${p.tag}] the chart + stack share a row`, src.includes('lg:flex-row gap-3'));
  checkTrue(`[${p.tag}] the overlay chart keeps 54% of the width`, src.includes('lg:w-[54%]'));
  checkTrue(`[${p.tag}] the stack gets the other 46%`, src.includes('lg:w-[46%]'));
  checkTrue(`[${p.tag}] the stack can honour a shared Y scale`, src.includes(p.yShared));
  checkTrue(`[${p.tag}] the sub-chart character size follows the page's own chart font`, src.includes(p.font));
  checkTrue(`[${p.tag}] …and every tick of the stack uses it`,
    src.split('fontSize: splitFontSize').length - 1 === 2);
  p.extras.forEach(([what, needle]) => checkTrue(`[${p.tag}] ${what}`, src.includes(needle)));
  checkTrue(`[${p.tag}] the rows can really pack (no Y axis)`,
    src.includes('splitChartClass(splitLayout)') && src.includes('splitChartMargin(splitLayout, '));
  checkTrue(`[${p.tag}] …the YAxis is handed the packing props`, src.includes('splitYAxisProps(splitLayout, '));
  checkTrue(`[${p.tag}] …and only the bottom row keeps the X ruler`,
    src.includes('splitXAxisHidden(splitLayout, i, '));
});

/* ── 6. the four split panels stay distinct figure items ────────────────── */
const FCS = fs.readFileSync('src/components/FlowCytometrySections.jsx', 'utf8');
checkTrue('[FCS] keeps its own split panel', FCS.includes('data-star-group="fcs-split"'));
const ids = ['fcs-split', ...PAGES.map((p) => p.id)];
check('the four panels have distinct ids', new Set(ids).size, 4);
check('[FCS] is not double-tagged by this change', FCS.split('data-star-group=').length - 1, 1);

/* ── 7. that panel gets the SAME shape + separation knobs ───────────────── */
// The mini charts of the Flow Cytometry split view follow the very same
// { aspect, gap } layout as the spectra stacks (one `splitLayout` key on the
// experiment, so the four split views of a test share one shape), with the
// panel's own “Height” as the size of its “own” box.
checkTrue('[FCS] imports the shared knobs', FCS.includes(
  "import { SplitLayoutControls, splitRowBoxStyle, splitChartClass, splitChartMargin, splitRowGapStyle, splitLayoutOf, splitYAxisHidden, splitYAxisProps, withSplitLayout, splitOwnHeight, hiddenSeriesOf, withoutSeries } from './SplitChartStack';"));
checkTrue('[FCS] the layout is read from the experiment',
  FCS.includes('const splitLayout = splitLayoutOf(activeTest);'));
checkTrue('[FCS] …and written straight back',
  FCS.includes('const changeSplitLayout = (patch) => updateActiveTest({ splitLayout: withSplitLayout(activeTest, patch) });'));
checkTrue('[FCS] “own” is the height of its own Graphical Parameters',
  FCS.includes('const splitOwnBoxH = splitOwnHeight(cfgSplit.height);'));
checkTrue('[FCS] the panel offers the shape + separation knobs',
  FCS.includes('<SplitLayoutControls layout={splitLayout} onChange={changeSplitLayout} baseHeight={splitOwnBoxH} />'));
checkTrue('[FCS] every mini chart is sized by the shared layout helper',
  FCS.includes('splitRowBoxStyle(splitLayout, i, visibleInstances.length, splitOwnBoxH)'));
checkTrue('[FCS] …handed to the box of every sub-chart', FCS.includes('style={splitRowBoxStyle('));
checkTrue('[FCS] the chart then fills that box', FCS.includes('<ResponsiveContainer width="100%" height="100%">'));
check('[FCS] no fixed height is left on a mini chart',
  FCS.includes('height={Number(cfgSplit.height) || 80}'), false);
checkTrue('[FCS] the graphs are separated by the layout', FCS.includes('style={splitRowGap}'));
checkTrue('[FCS] …a 0 gap leaving the hairlines alone',
  FCS.includes('const splitRowGap = splitRowGapStyle(splitLayout);'));
checkTrue('[FCS] the knobs are OUTSIDE the captured panel',
  FCS.indexOf('<SplitLayoutControls') < FCS.indexOf('data-star-group="fcs-split"'));
checkTrue('[FCS] …and so is its parameter panel',
  FCS.indexOf('{showCfgSplit && (') > FCS.indexOf('data-star-group="fcs-split"'));
checkTrue('[FCS] the stacked curves start 2.5 × taller than they were',
  FCS.includes('height: 200, aspect: 1, fontSize: 11'));
checkTrue('[FCS] every mini chart can lose its Y axis',
  FCS.includes('{...splitYAxisProps(splitLayout, Math.max(30, (Number(cfgSplit.fontSize) || 11) + 22))}'));
checkTrue('[FCS] …and then drops the round-tick headroom',
  FCS.includes("[0, splitYAxisHidden(splitLayout) ? 'dataMax' : 'auto']"));
checkTrue('[FCS] the caption moves over the box when packing', FCS.includes('absolute top-0 left-1'));
checkTrue('[FCS] …and the box loses its padding',
  FCS.includes("splitChartClass(splitLayout, 'w-1/2 mx-auto pb-1')"));
checkTrue('[FCS] …with the margins of the hidden axes gone',
  FCS.includes('splitChartMargin(splitLayout, cfgChartMargin(cfgSplit,'));

/* ── 8. the FCS panel excludes a condition the very same way ────────────── */
checkTrue('[FCS] the title bar sits OUTSIDE the captured panel',
  FCS.indexOf('📚 Split view — single curves') < FCS.indexOf('data-star-group="fcs-split"'));
checkTrue('[FCS] every curve of the stack can be taken out of the figures',
  FCS.includes('onClick={() => toggleHiddenSeries(s.id)}'));
checkTrue('[FCS] …keeping a struck-through row to put it back',
  FCS.includes('{outInstances.map((inst) => (') && FCS.includes('line-through'));
checkTrue('[FCS] …with its own ↩️ switch', FCS.includes('onClick={() => toggleHiddenSeries(inst.id)}'));
checkTrue('[FCS] …and the row of an exclusion never reaches the panel',
  FCS.includes('const outInstances = loadedInstances.filter(inst => hiddenSeries[inst.id]);'));
checkTrue('[FCS] the exclusions live on the experiment',
  FCS.includes('const toggleHiddenSeries = (id) => updateActiveTest({ hiddenSeries: withoutSeries(activeTest, id) });'));
check('[FCS] …and BOTH panels read that ONE map',
  FCS.split('const hiddenSeries = hiddenSeriesOf(activeTest);').length - 1, 2);
checkTrue('[FCS] the switches and the struck-through rows are marked for the capture',
  FCS.split('data-star-skip="1"').length - 1 >= 2);

/* ── report ─────────────────────────────────────────────────────────────── */
try { fs.unlinkSync(bundleFile); } catch { /* ignore */ }
const body = results.length ? results.join('\n') : 'all checks passed';
fs.writeFileSync('_spectra_split_out.txt', `passed ${passed}/${passed + results.length}\n${body}\n`, 'utf8');
console.log(`passed ${passed}/${passed + results.length}`);
if (results.length) console.log(body);
