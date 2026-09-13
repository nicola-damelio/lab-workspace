// Validates the COMPOSITE PANEL support of the ⭐/📷 layer: on the Flow
// Cytometry page the split view ("📚 Split view — single curves") stacks one
// mini chart per curve, and each mini chart had its own ⭐/📷 buttons — but the
// split graph AS A WHOLE (the panel) could not be starred nor saved as a
// figure. It is now offered as one extra item by tagging the panel with
// `data-star-group` (+ `data-star-label`) in FlowCytometrySections.jsx.
//
// The component (src/components/ChartStarLayer.jsx) cannot be imported here
// (JSX module), so the rules under test are mirrored verbatim. Keep them in
// sync with the component:
//   * KIND_LABEL    – item noun shown in the ⭐ key ("Panel" for a group)
//   * keyOf()       – the item key: `<label> · <noun> · <n>`
//   * groupLabel()  – `data-star-label` → inner/closest heading → "Panel"
//   * targetsFor()  – numbering order: groups FIRST, then the plain elements
//                     (a group uses its own counter, so the keys of the charts
//                     already on the page never change)
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const CSL = read('src/components/ChartStarLayer.jsx');
const FCS = read('src/components/FlowCytometrySections.jsx');

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push({ name, got: String(got), want: String(want), ok });
  return ok;
};
const frag = (name, hay, needle) => check(`${name}: ${needle.slice(0, 46)}…`, hay.includes(needle), true);

/* ── 1. mirror: the item keys / labels of the layer ───────────────────────── */
const KIND_LABEL = { canvas: 'Chart', img: 'Image', table: 'Table', svg: 'Chart', group: 'Panel' };
const keyOf = (label, kind, n) => `${label} · ${KIND_LABEL[kind]} · ${n}`;
const groupLabel = (explicit, heading) =>
  String(explicit || '').replace(/\s+/g, ' ').trim() || heading || KIND_LABEL.group;

const targetsFor = (groups, els) => {
  const counts = {};
  const out = [];
  groups.forEach((g) => {
    const label = groupLabel(g.explicit, g.heading);
    counts.group = (counts.group || 0) + 1;
    out.push({ key: keyOf(label, 'group', counts.group), kind: 'group', label });
  });
  els.forEach((e) => {
    const label = e.heading || KIND_LABEL[e.kind];
    counts[e.kind] = (counts[e.kind] || 0) + 1;
    out.push({ key: keyOf(label, e.kind, counts[e.kind]), kind: e.kind, label });
  });
  return out;
};

// The page: the overlaid histogram (count 1) + 3 split mini charts.
const HEADING = '1D Histogram (Data Analysis)';
const miniCharts = [
  { kind: 'svg', heading: HEADING }, { kind: 'svg', heading: HEADING }, { kind: 'svg', heading: HEADING }
];
const splitPanel = { explicit: 'Split view — single curves', heading: HEADING };

// With the split ON (group tagged) …
const withGroup = targetsFor([splitPanel], [{ kind: 'svg', heading: HEADING }, ...miniCharts]);
check('the panel is a "Panel" item', withGroup[0].kind, 'group');
check('the panel item is labelled from data-star-label', withGroup[0].key, 'Split view — single curves · Panel · 1');
// … and WITHOUT it (split OFF / pages that never tag a panel): unchanged list.
const withoutGroup = targetsFor([], [{ kind: 'svg', heading: HEADING }, ...miniCharts]);
check('the overlaid chart keeps its key', withGroup[1].key, withoutGroup[0].key);
check('the mini charts keep their keys', withGroup.slice(2).map((t) => t.key), withoutGroup.slice(1).map((t) => t.key));
check('the sub-graphs still get their own buttons (no skip)', withGroup.filter((t) => t.kind === 'svg').length, 4);
check('a group with no label falls back to "Panel"', groupLabel('', ''), 'Panel');
check('a group falls back to the closest heading', groupLabel('', HEADING), HEADING);
check('the label is flattened (one line)', groupLabel('  a\n\tb  ', ''), 'a b');
check('two panels are numbered', targetsFor([splitPanel, splitPanel], []).map((t) => t.key), [
  'Split view — single curves · Panel · 1',
  'Split view — single curves · Panel · 2'
]);
check('the group noun is not a tag name', KIND_LABEL.group, 'Panel');

/* ── 2. the layer implements what the mirror describes ────────────────────── */
frag('[STAR] the composite kind is labelled', CSL, "group: 'Panel'");
frag('[STAR] the group scan', CSL, "rootEl.querySelectorAll('[data-star-group]').forEach((el) => {");
frag('[STAR] an explicit label names the panel', CSL, "el.getAttribute('data-star-label')");
frag('[STAR] it falls back to the closest heading', CSL, "const label = explicit || headingText(el, rootEl) || KIND_LABEL.group;");
frag('[STAR] groups are numbered separately', CSL, "counts.group = (counts.group || 0) + 1;");
frag('[STAR] the panel is locatable from the Image Builder', CSL, "el.setAttribute('data-figure-origin', key);");
frag('[STAR] nested groups are ignored', CSL, "el.parentElement.closest('[data-star-group]')");
frag('[STAR] hand-placed blocks are still skipped', CSL, "if (hasStarKeyAncestor(el, rootEl)) return;");
frag('[STAR] the ⭐ item of a panel is an image', CSL, "if (t.kind === 'group' && el) {");
frag('[STAR] captured with html2canvas', CSL, "({ default: html2canvas } = await import('html2canvas'));");
frag('[STAR] the 📷 button uses the same capture', CSL, "if (kind === 'group') return htmlToDataUrl(el);");
frag('[STAR] the capture expands inner scrollers', CSL, "if (!scrolls && cs.maxHeight === 'none') return;");
frag('[STAR] …and restores them afterwards', CSL, 'n.style.maxHeight = maxHeight;');
frag('[STAR] …capped so the image stays light', CSL, '1400 / Math.max(1, Math.max(rect.width, rect.height))');
frag('[STAR] html2canvas stays out of the bundle until used', CSL, "await import('html2canvas')");
frag('[STAR] tables still have no 📷 button', CSL, "{targets.filter((t) => t.kind !== 'table').map((t) => (");

/* ── 3. the Flow Cytometry split panel is tagged ──────────────────────────── */
frag('[FCS] the split panel is a star group', FCS, 'data-star-group="fcs-split"');
frag('[FCS] …named like its header', FCS, 'data-star-label="Split view — single curves"');
frag('[FCS] …and the header text is the label', FCS, '📚 Split view — single curves');

/* ── 4. the tag sits on the panel, not on a sub-graph ─────────────────────── */
const tagAt = FCS.indexOf('data-star-group="fcs-split"');
const tagBlock = FCS.slice(tagAt, tagAt + 260);
check('the tag opens the panel wrapper', /data-star-group="fcs-split"\s*\r?\n\s*data-star-label=/.test(tagBlock), true);
check('the tag precedes the panel card', tagBlock.includes('flex flex-col gap-2 min-w-0'), true);
check('the tag is inside the splitStack block', FCS.slice(0, tagAt).lastIndexOf('{splitStack && (') > FCS.slice(0, tagAt).lastIndexOf('</ChartInspector>'), true);
check('one split panel only', FCS.split('data-star-group=').length - 1, 1);

console.table(results);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `❌ ${failed.length} check(s) failed` : `✅ ${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

