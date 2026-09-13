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
//     sub-chart (0 = the historical fixed 150 px box) and the vertical
//     separation between two graphs (see SplitLayoutControls).
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
  SplitChartStack, SplitToggle, SplitLayoutControls, SPLIT_CHART_H,
  SPLIT_ASPECT_STEPS, SPLIT_GAP_MAX,
  splitChartBoxStyle, splitRowGapStyle, splitLayoutOf, withSplitLayout, normalizeSplitLayout
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
checkTrue('[stack] the compact sub-chart height is exported', Number(SPLIT_CHART_H) > 80);

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
   (0 = the historical fixed 150 px box) and the space inserted between two
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
  spaced.includes('Shape') || spaced.includes('>Gap<'), false);
check('splitChartBoxStyle keeps the historical box by default',
  splitChartBoxStyle(null), { width: '100%', height: 150 });
check('splitChartBoxStyle sizes the box by the ratio when asked',
  splitChartBoxStyle({ aspect: 2 }), { width: '100%', aspectRatio: '2', minHeight: 72 });
check('[layout] a definite height and a ratio are never mixed',
  'height' in splitChartBoxStyle({ aspect: 2 }), false);
check('[layout] the ratio is clamped', normalizeSplitLayout({ aspect: 99, gap: 999 }), { aspect: 8, gap: 48 });
check('[layout] …and a nonsense value falls back to “own”',
  normalizeSplitLayout({ aspect: 'abc', gap: -5 }), { aspect: 0, gap: 0 });
check('[layout] an unusable ratio is raised to the minimum', normalizeSplitLayout({ aspect: 0.1 }).aspect, 0.5);
check('[layout] 0 means “keep the historical box”', normalizeSplitLayout({ aspect: 0, gap: 0 }), { aspect: 0, gap: 0 });
check('[layout] the gap is undefined at 0 (nothing changes)', splitRowGapStyle({ gap: 0 }), undefined);
check('[layout] …and a plain margin when asked', splitRowGapStyle({ gap: 6 }), { marginBottom: 6 });
check('[layout] a missing layout is safe', splitLayoutOf(null), { aspect: 0, gap: 0 });
check('[layout] the layout stored on the experiment is read back',
  splitLayoutOf({ splitLayout: { aspect: 3, gap: 4 } }), { aspect: 3, gap: 4 });
check('[layout] a change merges with what was already stored',
  withSplitLayout({ splitLayout: { aspect: 3, gap: 4 } }, { gap: 20 }), { aspect: 3, gap: 20 });
check('[layout] …and is clamped on the way in',
  withSplitLayout({ splitLayout: { aspect: 3 } }, { aspect: 100 }), { aspect: 8, gap: 0 });

/* ── 3c. the two knobs of the page toolbar ──────────────────────────────── */
const controls = (layout) => renderToStaticMarkup(React.createElement(SplitLayoutControls, {
  layout, onChange: () => {}
}));
const plain = controls(null);
checkTrue('[controls] offers “own”, the compact box', plain.includes('own (150 px)'));
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

/* ── 5. each spectra page mounts its own stack ──────────────────────────── */
const PAGES = [
  {
    tag: 'NMR',
    file: 'src/components/NMRSections.jsx',
    id: 'nmr-split',
    label: 'Split view — 1D spectra',
    seriesVar: 'visibleSeries',
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
    seriesVar: 'visible',
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
    seriesVar: 'visible',
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
  checkTrue(`[${p.tag}] imports the shared stack`, src.includes("import { SplitChartStack, SplitLayoutControls, SplitToggle, splitChartBoxStyle, splitLayoutOf, withSplitLayout } from './SplitChartStack';"));
  checkTrue(`[${p.tag}] mounts the stack`, count('<SplitChartStack') === 1);
  checkTrue(`[${p.tag}] …with its own id`, src.includes(`id="${p.id}"`));
  checkTrue(`[${p.tag}] …named for the user`, src.includes(`label="${p.label}"`));
  checkTrue(`[${p.tag}] …fed with the VISIBLE series only`, src.includes(`series={${p.seriesVar}}`));
  checkTrue(`[${p.tag}] …one chart per series`, src.includes('renderChart={(s) => ('));
  checkTrue(`[${p.tag}] …sized by the shared layout helper`, src.includes('splitChartBoxStyle(splitLayout)'));
  checkTrue(`[${p.tag}] …handed to the box of every sub-chart`, src.includes('style={splitBoxStyle}'));
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
});

/* ── 6. the four split panels stay distinct figure items ────────────────── */
const FCS = fs.readFileSync('src/components/FlowCytometrySections.jsx', 'utf8');
checkTrue('[FCS] keeps its own split panel', FCS.includes('data-star-group="fcs-split"'));
const ids = ['fcs-split', ...PAGES.map((p) => p.id)];
check('the four panels have distinct ids', new Set(ids).size, 4);
check('[FCS] is not double-tagged by this change', FCS.split('data-star-group=').length - 1, 1);

/* ── report ─────────────────────────────────────────────────────────────── */
try { fs.unlinkSync(bundleFile); } catch { /* ignore */ }
const body = results.length ? results.join('\n') : 'all checks passed';
fs.writeFileSync('_spectra_split_out.txt', `passed ${passed}/${passed + results.length}\n${body}\n`, 'utf8');
console.log(`passed ${passed}/${passed + results.length}`);
if (results.length) console.log(body);
