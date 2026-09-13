import React, { useEffect, useRef, useState } from 'react';
import { isStarred, toggleStarredItem } from '../utils/starredItems';
import Chart from 'chart.js/auto';
import {
  getActiveProjectId, publishLibraryFigure
} from '../utils/figuresLibrary';
import { clearPendingFigureScroll, peekPendingFigureScroll } from '../utils/pendingFigureScroll';
import { FigureStyleApplyButton } from './FigureStyleTools';
import { figureStyleTag, readFigureStyle, applyFigureStyleEverywhere } from '../utils/figureStyle';
import {
  figureRecapturesForTest, markFigureRecaptureResult, figureRecaptureProgress,
  nextRecaptureTarget, readFigureRecapture, stopFigureRecaptures,
  RECAPTURE_RETURN_EVENT, RECAPTURE_NEXT_TEST_EVENT
} from '../utils/figureRecapture';
import { sanitizeColorsForHtml2Canvas } from '../utils/captureColors';
import { loadProjects } from './AppModules/projectsModule';


/* =========================================================================
   ChartStarLayer — universal ⭐ "import into the project document" layer.

   Mounted once on the test page (TestShellRenderer). It scans the page DOM
   for every chart (`canvas`), spectrum / chromatogram / image (`img`), plot
   (`svg` — recharts etc.) and data table (`table`), and shows a small ⭐
   button on the top-right corner of each one. Clicking ⭐ stores the item on
   `test.starredItems` (as an image snapshot, a figure URL, or structured
   table data) so the project's 📄 Export document can import it.

   Elements inside `[data-star-key]` are skipped — those already have a
   hand-placed, captioned ⭐ (figures grid, DOSY plot/tables).

   A block that stacks SEVERAL sub-graphs inside one card can additionally be
   offered as a single item by tagging it `data-star-group` (an optional
   `data-star-label` names it): the layer then shows one extra ⭐/📷 pair for
   the whole panel, while the sub-graphs keep their own buttons.
   ========================================================================= */

const KIND_LABEL = { canvas: 'Chart', img: 'Image', table: 'Table', svg: 'Chart', group: 'Panel' };

// Nearest ancestor container that has a heading → used as the item's label.
const headingText = (el, root) => {
  let n = el;
  while (n && n !== root && n !== document.body && n.parentElement) {
    let heads = [];
    try {
      if (n.querySelectorAll) heads = Array.from(n.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,figcaption'));
    } catch { /* ignore */ }
    for (const h of heads) {
      const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length < 140) return txt;
    }
    n = n.parentElement;
  }
  return '';
};

const isHiddenEl = (el) => {
  const r = el.getBoundingClientRect();
  return r.width < 24 || r.height < 24;
};

const hasStarKeyAncestor = (el, root) => {
  let n = el;
  while (n && n !== root && n !== document.body) {
    if (n.nodeType === 1 && (n.hasAttribute('data-star-key') || n.hasAttribute('data-star-layer'))) return true;
    n = n.parentElement;
  }
  return false;
};

const inFormControl = (el) => {
  const c = el.closest ? el.closest('button, a, input, select, textarea, label, [contenteditable]') : null;
  return !!c;
};

const svgToDataUrl = (svg, scale = 1) => {
  const r = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.max(1, Math.round(r.width * scale))));
  clone.setAttribute('height', String(Math.max(1, Math.round(r.height * scale))));
  // A serialised SVG loses every INHERITED style, so the text of a recharts
  // chart would fall back to the browser default (serif) font and to the UA
  // 16px size. Carry the element's own font over. Explicit sizes/attributes on
  // the inner <text> nodes still win (an inherited value never beats a
  // declaration), so each chart keeps its own fontSize setting.
  try {
    const cs = window.getComputedStyle(svg);
    if (cs) {
      if (cs.fontFamily) clone.style.fontFamily = cs.fontFamily;
      if (cs.fontSize) clone.style.fontSize = cs.fontSize;
      clone.style.background = '#ffffff';
    }
  } catch { /* ignore — the snapshot stays plain */ }
  const xml = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
};
const nextFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// One-line, printable reason of a failed snapshot (shown by the 📷 button).
const shortError = (err) =>
  String((err && err.message) || err || 'unknown error').replace(/\s+/g, ' ').slice(0, 120);

// Why the last composite snapshot failed ('' when it did not).
let captureReason = '';
export const captureFailureReason = () => captureReason;

// Snapshot engines for a `data-star-group` panel, in order of preference:
//  1. `html2canvas-pro` — same API, and it parses the oklch()/oklab()/color()
//     values Tailwind v4 emits (that is exactly what made the legacy build
//     throw “Attempting to parse an unsupported color function "oklch"”).
//  2. the legacy `html2canvas` with the subtree's computed colours normalised
//     to rgb() beforehand (utils/captureColors) — for locked/offline setups.
//  3. our own sub-chart compositor (`composeChartsToCanvas`).
// Returns the rendered canvas, or null when every engine failed.
const snapshotPanel = async (el) => {
  const rect = el.getBoundingClientRect();
  // Cap the long edge at ~1400 px so a tall panel cannot produce an image too
  // heavy for the project document / figures library.
  const scale = Math.max(1, Math.min(2, 1400 / Math.max(1, Math.max(rect.width, rect.height))));
  const opts = { scale, useCORS: true, backgroundColor: '#ffffff', logging: false, imageTimeout: 15000 };
  try {
    const { default: html2canvasPro } = await import('html2canvas-pro');
    if (typeof html2canvasPro === 'function') return await html2canvasPro(el, opts);
  } catch (err) {
    captureReason = `html2canvas-pro: ${shortError(err)}`;
  }
  let html2canvas = null;
  try { ({ default: html2canvas } = await import('html2canvas')); } catch (err) { captureReason = `html2canvas: ${shortError(err)}`; }
  if (typeof html2canvas === 'function') {
    const restore = sanitizeColorsForHtml2Canvas(el);
    try {
      return await html2canvas(el, opts);
    } catch (err) {
      captureReason = `html2canvas: ${shortError(err)}`;
    } finally {
      restore();
    }
  }
  return null;
};

// Last-resort compositor: draws the panel's OWN sub-charts (the graphs of a
// “Split view” stack) on a single canvas, in DOM order, each with its row label
// above it. Vector sub-charts are re-rendered at 2×, so the fallback figure
// stays crisp even though the DOM snapshot engine failed.
const CAPTURE_MIN_W = 120;
const CAPTURE_MIN_H = 40;

const visibleCharts = (el) => {
  const found = [];
  let nodes = [];
  try { nodes = Array.from(el.querySelectorAll('svg, canvas')); } catch { nodes = []; }
  nodes.forEach((n) => {
    try {
      const r = n.getBoundingClientRect();
      if (r.width < CAPTURE_MIN_W || r.height < CAPTURE_MIN_H) return;
      if (n.tagName.toLowerCase() === 'svg' && n.parentElement && n.parentElement.closest('svg')) return;
      if (found.some((f) => f.node.contains(n))) return; // nested duplicate
      found.push({ node: n, rect: r });
    } catch { /* ignore this node */ }
  });
  return found;
};

// Nearest short text above a sub-chart — the series name of a split row.
const rowLabelOf = (node) => {
  let n = node;
  for (let depth = 0; depth < 3 && n; depth += 1) {
    let sib = n.previousElementSibling;
    while (sib) {
      const txt = (sib.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length <= 90 && !sib.querySelector('svg, canvas, img')) return txt;
      sib = sib.previousElementSibling;
    }
    n = n.parentElement;
  }
  return '';
};

const loadImage = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

const composeChartsToCanvas = async (el) => {
  const items = visibleCharts(el);
  if (!items.length) return null;
  const shots = [];
  for (const it of items) {
    const isSvg = it.node.tagName.toLowerCase() === 'svg';
    let url = '';
    if (isSvg) url = svgToDataUrl(it.node, 2);
    else { try { url = it.node.toDataURL('image/png'); } catch { url = ''; } }
    if (!url) continue;
    const img = await loadImage(url);
    if (img && img.width) shots.push({ img, label: rowLabelOf(it.node) });
  }
  if (!shots.length) return null;
  const pad = 24;
  const gap = 20;
  const labelH = 30;
  const rawW = Math.max(...shots.map((s) => s.img.width)) + pad * 2;
  const rawH = pad * 2 + shots.reduce((acc, s) => acc + s.img.height + (s.label ? labelH : 0) + gap, 0) - gap;
  const fit = Math.min(1, 4000 / Math.max(1, rawW), 6000 / Math.max(1, rawH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rawW * fit));
  canvas.height = Math.max(1, Math.round(rawH * fit));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(fit, fit);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, rawW, rawH);
  ctx.textBaseline = 'top';
  ctx.font = 'bold 26px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let y = pad;
  shots.forEach((s) => {
    if (s.label) {
      ctx.fillStyle = '#334155';
      ctx.fillText(s.label.slice(0, 60), pad, y + 2);
      y += labelH;
    }
    ctx.drawImage(s.img, Math.round((rawW - s.img.width) / 2), y, s.img.width, s.img.height);
    y += s.img.height + gap;
  });
  return canvas;
};

// Composite snapshot of a `data-star-group` block — several sub-graphs living
// in ONE card (e.g. the Flow Cytometry “📚 Split view — single curves” panel and
// the NMR / ssNMR / CD split stacks). Its sub-graphs are live DOM + SVG, so the
// snapshot engine renders exactly what is on screen. Inner scrollers
// (`max-h-[…]` + `overflow-y-auto`) are expanded for the capture so the figure
// holds EVERY sub-graph, not only the ones currently scrolled into view.
// The engine itself is imported on demand (see `snapshotPanel`): it is only
// needed for these panels and stays out of the test-page bundle.
const htmlToDataUrl = async (el) => {
  if (!el) return '';
  const restore = [];
  const expand = (n) => {
    if (!n || !n.style || typeof window === 'undefined') return;
    let cs = null;
    try { cs = window.getComputedStyle(n); } catch { cs = null; }
    if (!cs) return;
    const scrolls = /auto|scroll/.test(`${cs.overflowY} ${cs.overflow}`);
    if (!scrolls && cs.maxHeight === 'none') return;
    restore.push({ n, maxHeight: n.style.maxHeight, overflow: n.style.overflow, overflowY: n.style.overflowY });
    n.style.maxHeight = 'none';
    n.style.overflow = 'visible';
    n.style.overflowY = 'visible';
  };
  expand(el);
  try { el.querySelectorAll('*').forEach(expand); } catch { /* ignore */ }
  try {
    await nextFrames();
    captureReason = '';
    let canvas = await snapshotPanel(el);
    if (!canvas) canvas = await composeChartsToCanvas(el);
    return canvas ? canvas.toDataURL('image/png') : '';
  } catch (err) {
    captureReason = shortError(err);
    return '';
  } finally {
    restore.forEach(({ n, maxHeight, overflow, overflowY }) => {
      n.style.maxHeight = maxHeight;
      n.style.overflow = overflow;
      n.style.overflowY = overflowY;
    });
    await nextFrames();
  }
};

// High-resolution snapshot of the CURRENT rendered state of an element:
// • svg    → serialized as-is (vector — keeps axis labels, zoom/pan transforms)
// • img    → the current source URL (resolved to a self-contained data URL by
//            makeLibraryImage, so Drive-hosted images can be exported too)
// • canvas → Chart.js charts are temporarily re-rendered at an enhanced
//            devicePixelRatio (the zoomed region / axis state is preserved),
//            any other canvas is captured at its native pixel resolution.
const captureFigure = async (el, kind) => {
  if (!el) return '';
  if (kind === 'group') return htmlToDataUrl(el);
  if (kind === 'svg') return svgToDataUrl(el);
  if (kind === 'img') return el.currentSrc || el.src || '';
  if (kind === 'canvas') {
    let chart = null;
    try { chart = Chart.getChart(el); } catch { chart = null; }
    if (chart && chart.options) {
      const orig = Number(chart.options.devicePixelRatio) || 1;
      const target = Math.max(orig, window.devicePixelRatio || 1, 3);
      if (target > orig) {
        try {
          chart.options.devicePixelRatio = target;
          chart.resize();
          await nextFrames();
          return el.toDataURL('image/png');
        } catch { /* fall back to the native canvas below */ }
        finally {
          try { chart.options.devicePixelRatio = orig; chart.resize(); } catch { /* ignore */ }
          await nextFrames();
        }
      }
    }
    return el.toDataURL('image/png');
  }
  return '';
};

// Name of the project the exported figure belongs to (used for the Drive
// folder path): the active project first, then the test's own project link.
const projectNameFor = (test) => {
  try {
    const pid = getActiveProjectId();
    if (pid) {
      const prj = loadProjects().find((p) => p.id === pid);
      if (prj && prj.name) return prj.name;
    }
  } catch { /* ignore */ }
  if (Array.isArray(test && test.projectNames)) {
    const n = test.projectNames.find((x) => x && String(x).trim());
    if (n) return n;
  }
  return '';
};

// The project whose image library the figure belongs to: the experiment's OWN
// project first (it is authoritative and may differ from the currently-active
// project context, e.g. when the test is opened from the tests list), then the
// active project.
const projectIdForTest = (test) => {
  try {
    if (Array.isArray(test && test.projectNames)) {
      const name = test.projectNames.find((x) => x && String(x).trim());
      if (name) {
        const prj = loadProjects().find((p) => p.name === name);
        if (prj && prj.id) return prj.id;
      }
    }
  } catch { /* ignore */ }
  const pid = getActiveProjectId();
  return pid || null;
};



const cellText = (cell) => {
  const inp = cell.querySelector('input, select, textarea');
  if (inp) return (inp.value || '').replace(/\s+/g, ' ').trim();
  return (cell.textContent || '').replace(/\s+/g, ' ').trim();
};

// Serialize a <table> into { columns, rows } (reads input values too, so the
// DOSY gradient/intensity grids and other editable tables are captured).
const tableToData = (table) => {
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  let columns = [];
  let rows = [];
  if (thead) {
    const tr = thead.querySelector('tr');
    if (tr) columns = Array.from(tr.querySelectorAll('th, td')).map(cellText);
    const body = tbody || table;
    rows = Array.from(body.querySelectorAll('tr')).map((r) => Array.from(r.querySelectorAll('th, td')).map(cellText));
  } else {
    const trs = Array.from(table.querySelectorAll('tr'));
    if (!trs.length) return null;
    columns = Array.from(trs[0].querySelectorAll('th, td')).map(cellText);
    rows = trs.slice(1).map((r) => Array.from(r.querySelectorAll('th, td')).map(cellText));
  }
  rows = rows.filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return null;
  return { columns, rows };
};

const OVERLAY_STYLE = { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 };

/* =========================================================================
   revealPendingFigure — arriving from the Image Builder's
   "↗ Open original graph": bring the EXACT chart / spectrum / image the figure
   was captured from into view, on the correct condition.

   The old version scrolled once (5 retries over ~2.5 s) and gave up silently:
   • the lazy test renderer, its charts and any Drive-hosted data take longer
     than that, so the element often did not exist yet;
   • a chart inside a CLOSED section is not in the DOM at all — the section has
     to be opened first (the page's own "▸ Expand all" button does that);
   • the page's scroll memory (useExperimentScrollMemory) kept restoring the
     position the user had left, which overrode the scroll (it is told to stand
     down while this request is pending — see utils/pendingFigureScroll.js).

   The request is kept while we look for the target, then re-asserted for a few
   seconds (the layout keeps moving while charts and images finish loading) and
   dropped as soon as the user takes over.
   ========================================================================= */
const revealPendingFigure = (rootEl, test) => {
  const pending = peekPendingFigureScroll();
  if (!pending || !pending.key || !rootEl) return () => {};
  // Another attempt may still be parked from an earlier navigation (the request
  // lives for a minute): only a request for THIS page is honoured, so opening a
  // different experiment never scrolls to / expands anything by surprise.
  if (test && pending.testName && pending.testId !== test.id && pending.testName !== test.name) {
    return () => {};
  }

  const TICK_MS = 350;            // how often we look for the element
  const EXPAND_MS = 900;          // not there yet → open the closed sections
  const SETTLE_MS = 4200;         // keep it centred while the page settles
  const DEADLINE_MS = 20000;      // lazy renderers + Drive-hosted data
  const hosts = [rootEl, document];
  const opts = { capture: true, passive: true };

  let stopped = false;
  let expanded = false;
  let hitEl = null;
  let hitAt = 0;
  let flashed = null;
  const startedAt = Date.now();
  const timers = [];

  const stop = (clear = true) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    timers.forEach((t) => clearTimeout(t));
    if (flashed) {
      flashed.el.style.outline = flashed.prev;
      flashed = null;
    }
    hosts.forEach((host) => {
      host.removeEventListener('wheel', onUser, opts);
      host.removeEventListener('touchstart', onUser, opts);
      host.removeEventListener('pointerdown', onUser, opts);
      host.removeEventListener('keydown', onUser, true);
    });
    if (clear) clearPendingFigureScroll();
  };

  function onUser() { stop(true); }

  // Keys are human labels ("CD Spectra · Chart · 2"), so compare the attribute
  // instead of building a CSS selector out of it.
  const find = () => Array.from(rootEl.querySelectorAll('[data-figure-origin]'))
    .find((el) => el.getAttribute('data-figure-origin') === pending.key) || null;

  const flash = (el) => {
    try {
      const card = el.closest('div,section,td') || el;
      flashed = { el: card, prev: card.style.outline };
      card.style.outline = '3px solid #3b82f6';
      timers.push(setTimeout(() => {
        if (flashed && flashed.el === card) card.style.outline = flashed.prev;
        flashed = null;
      }, 2600));
    } catch { /* ignore */ }
  };

  const scrollTo = (el) => {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
  };

  const expandAll = () => {
    try {
      const btn = document.querySelector('[data-expand-all]');
      if (btn) { btn.click(); return true; }
    } catch { /* ignore */ }
    return false;
  };

  const timer = setInterval(() => {
    if (stopped) return;
    const elapsed = Date.now() - startedAt;
    if (!hitEl || !hitEl.isConnected) hitEl = find();
    if (hitEl) {
      if (!hitAt) { hitAt = Date.now(); flash(hitEl); }
      scrollTo(hitEl);
      // The layout settles for a moment (charts mount, images decode): keep
      // re-centring the element, then hand the page back to the user.
      if (Date.now() - hitAt > SETTLE_MS) stop(true);
      return;
    }
    if (!expanded && elapsed > EXPAND_MS) {
      // The chart is hidden inside a closed section (or a closed group): open
      // the page the same way the "▸ Expand all" button does.
      expanded = expandAll();
    }
    if (elapsed > DEADLINE_MS) stop(true);
  }, TICK_MS);

  hosts.forEach((host) => {
    host.addEventListener('wheel', onUser, opts);
    host.addEventListener('touchstart', onUser, opts);
    host.addEventListener('pointerdown', onUser, opts);
    host.addEventListener('keydown', onUser, true);
  });

  return () => stop(false);
};


export const ChartStarLayer = ({ rootRef, test, update }) => {
  const [targets, setTargets] = useState([]); // { key, kind, label, left, top, right, bottom }
  const elMap = useRef(new Map()); // key -> DOM element (for capture on click)
  const sigRef = useRef('');
  const rafRef = useRef(0);
  const [figBusyKey, setFigBusyKey] = useState(null);   // element key being captured
  const [figStatus, setFigStatus] = useState(null);     // { key, ok, msg } transient feedback
  const figTimer = useRef(null);

  // 📷 "Figure" button — like the molecule viewer's: snapshots the CURRENT
  // state of the chart / spectrum / image (axis characters, zoomed region,
  // styling) at high resolution, stores it in the project's image library and
  // uploads a copy to Google Drive under <project>/images.
  const saveFigure = async (t) => {
    if (figBusyKey) return;
    const el = elMap.current.get(t.key);
    if (!el) return;
    setFigBusyKey(t.key);
    try {
      const url = await captureFigure(el, t.kind);
      if (!url) {
        const why = captureFailureReason();
        setFigStatus({
          key: t.key,
          ok: false,
          msg: `⚠️ Could not capture this element as an image${why ? ` — ${why}` : ''}`
        });
        return;
      }
      const label = `${t.label} · ${(test && test.name) || 'experiment'}`.slice(0, 120);
      const pid = projectIdForTest(test);
      const where = pid ? 'project library' : 'common library';
      // The stamp that makes the figure findable again: the INSTANCE it was
      // captured on (id + experiment name + condition + date, so a rebuilt
      // experiment can still be resolved to the same condition) and the exact
      // chart element on that page.
      const src = {
        testId: test && test.id,
        testName: test && test.name,
        instanceName: (test && test.instanceName) || '',
        date: (test && test.date) || '',
        elementLabel: t.label,
        elementKey: t.key
      };
      // The global figure style this figure was RENDERED with + its pixel size:
      // the Image Builder audits them (⚖️ Character sizes) to warn when figures
      // captured with different character sizes end up in the same slide.
      src.styleTag = figureStyleTag();
      try {
        const r = el.getBoundingClientRect();
        src.pxW = Math.round(el.naturalWidth || el.width || r.width || 0);
        src.pxH = Math.round(el.naturalHeight || el.height || r.height || 0);
      } catch { /* ignore */ }
      const projectName = projectNameFor(test);
      // The real image is stored on Google Drive (projects/<project>/images), only a
      // small local preview + metadata remain in the browser.
      const { entry, drive } = await publishLibraryFigure({
        scope: pid ? 'project' : 'common',
        projectId: pid,
        projectName,
        dataUrl: url,
        label,
        src
      });
      void entry;
      const driveMsg = pid && projectName
        ? (drive && drive.id ? ` · Drive: projects/${projectName}/images` : ' · Drive upload failed — browser copy only')
        : (drive && drive.id ? ' · Drive: projects/_unassigned/images' : ' · Drive not connected — library copy only');
      setFigStatus({ key: t.key, ok: true, msg: `📷 Figure saved to ${where}${driveMsg}` });
    } catch {
      setFigStatus({ key: t.key, ok: false, msg: '⚠️ Figure capture failed' });
    } finally {
      setFigBusyKey(null);
      clearTimeout(figTimer.current);
      figTimer.current = setTimeout(() => setFigStatus(null), 5000);
    }
  };



  const refreshRects = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setTargets((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          const el = elMap.current.get(t.key);
          if (!el) return t;
          const r = el.getBoundingClientRect();
          if (
            Math.abs(r.left - t.left) > 1 || Math.abs(r.top - t.top) > 1 ||
            Math.abs(r.right - t.right) > 1 || Math.abs(r.bottom - t.bottom) > 1
          ) changed = true;
          return { ...t, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        });
        return changed ? next : prev;
      });
    });
  };

  const collect = () => {
    const rootEl = rootRef && rootRef.current;
    if (!rootEl) return;
    const found = [];
    const counts = {};
    // Composite panels (`data-star-group`) are exposed as ONE additional item,
    // so a stack of sub-graphs (FCS "Split view"…) can be starred / saved as a
    // single figure. The sub-graphs keep their own ⭐/📷 buttons below — this
    // only ADDS the panel item. Optional `data-star-label` names it.
    rootEl.querySelectorAll('[data-star-group]').forEach((el) => {
      if (el.nodeType !== 1) return;
      if (isHiddenEl(el)) return;
      if (hasStarKeyAncestor(el, rootEl)) return;
      if (inFormControl(el)) return;
      if (el.parentElement && el.parentElement.closest('[data-star-group]')) return;
      const explicit = (el.getAttribute('data-star-label') || '').replace(/\s+/g, ' ').trim();
      const label = explicit || headingText(el, rootEl) || KIND_LABEL.group;
      counts.group = (counts.group || 0) + 1;
      const key = `${label} · ${KIND_LABEL.group} · ${counts.group}`;
      try { el.setAttribute('data-figure-origin', key); } catch { /* ignore */ }
      found.push({ key, kind: 'group', label, el });
    });
    rootEl.querySelectorAll('canvas, table, img, svg').forEach((el) => {
      if (el.nodeType !== 1) return;
      if (isHiddenEl(el)) return;
      if (hasStarKeyAncestor(el, rootEl)) return;
      if (inFormControl(el)) return;
      const kind = el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      if (kind === 'svg' && (r.width < 120 || r.height < 50)) return;
      if (kind === 'img' && (r.width < 48 || r.height < 32)) return;
      const label = headingText(el, rootEl) || KIND_LABEL[kind];
      counts[kind] = (counts[kind] || 0) + 1;
      const key = `${label} · ${KIND_LABEL[kind]} · ${counts[kind]}`;
      // Make the chart locatable after navigating back from the Image Builder
      // ("↗ Open original graph" scrolls to the exact element on arrival).
      try { el.setAttribute('data-figure-origin', key); } catch { /* ignore */ }
      found.push({ key, kind, label, el });
    });
    const sig = found.map((f) => f.key).join('|');
    elMap.current = new Map(found.map((f) => [f.key, f.el]));
    if (sig === sigRef.current) { refreshRects(); return; }
    sigRef.current = sig;
    setTargets(found.map((f) => {
      const rr = f.el.getBoundingClientRect();
      return { key: f.key, kind: f.kind, label: f.label, left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom };
    }));
  };

  useEffect(() => {
    const rootEl = rootRef && rootRef.current;
    if (!rootEl) return;
    collect();
    // If the user arrived here from the Image Builder's "↗ Open original graph",
    // bring the exact chart/spectrum the figure was captured from into view.
    const stopReveal = revealPendingFigure(rootEl, test);
    const debounced = () => { clearTimeout(debounced.t); debounced.t = setTimeout(collect, 400); };
    const mo = new MutationObserver(debounced);
    mo.observe(rootEl, { subtree: true, childList: true, attributes: true, characterData: true });
    const onScroll = () => refreshRects();
    rootEl.addEventListener('scroll', onScroll, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      stopReveal();
      mo.disconnect();
      clearTimeout(debounced.t);
      rootEl.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef]);
  /* ── AUTOMATIC RE-CAPTURE (Image Builder → “🔄 Recapture”) ────────────────
     The Image Builder queues the figures whose style stamp does not match the
     current profile and opens the experiment. Here the profile is pushed into
     every chart of the page (closed sections included), each queued element is
     found by its `data-figure-origin` stamp, captured and written back OVER its
     own library entry (same id) — so the canvas that pointed at it shows the
     new figure without the user touching 🎨 or 📷.

     When nothing is left the page either jumps to the next experiment of the
     run or reopens the Image Builder (utils/figureRecapture owns the queue). */
  const [recap, setRecap] = useState(null); // { total, done, failed, msg, stopped }
  // The user pressed ⏹: the run must not hand over to the next experiment.
  const userStopRef = useRef(false);
  const stopRun = () => {
    userStopRef.current = true;
    stopFigureRecaptures('stopped by the user');
    setRecap((r) => ({
      ...(r || { total: 0, done: 0, failed: 0 }),
      stopped: true,
      msg: 'stopped by you — nothing else was captured'
    }));
  };
  useEffect(() => {
    const rootEl = rootRef && rootRef.current;
    if (!rootEl || !test) return undefined;
    if (!figureRecapturesForTest(test).length) return undefined;
    userStopRef.current = false;

    let stopped = false;
    let busy = false;
    let applied = false;
    let cancelApply = null;
    const startedAt = Date.now();
    const DEADLINE_MS = 30000;   // lazy renderers + Drive-hosted data
    const TICK_MS = 600;
    const timers = [];
    const results = { done: 0, failed: 0 };

    const findEl = (key) => {
      if (!key) return null;
      try {
        return Array.from(rootEl.querySelectorAll('[data-figure-origin]'))
          .find((el) => el.getAttribute('data-figure-origin') === key) || null;
      } catch { return null; }
    };

    // A captured element is a composite panel, a Chart.js canvas, a recharts
    // SVG chart or an image — the same kinds the 📷 button knows.
    const kindOf = (el) => {
      if (el.hasAttribute && el.hasAttribute('data-star-group')) return 'group';
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      return (tag === 'canvas' || tag === 'svg' || tag === 'img') ? tag : 'group';
    };

    const redo = async (item, el) => {
      const url = await captureFigure(el, kindOf(el));
      if (!url) return { ok: false, message: captureFailureReason() || 'the element could not be captured' };
      let pxW = 0;
      let pxH = 0;
      try {
        const r = el.getBoundingClientRect();
        pxW = Math.round(el.naturalWidth || el.width || r.width || 0);
        pxH = Math.round(el.naturalHeight || el.height || r.height || 0);
      } catch { /* ignore */ }
      const src = {
        testId: test.id,
        testName: test.name,
        instanceName: test.instanceName || '',
        date: test.date || '',
        elementLabel: item.label,
        elementKey: item.elementKey,
        styleTag: figureStyleTag(),
        pxW,
        pxH,
        recapturedAt: new Date().toISOString()
      };
      const res = await publishLibraryFigure({
        scope: item.scope,
        projectId: item.projectId,
        projectName: projectNameFor(test),
        dataUrl: url,
        label: item.label,
        src,
        updateId: item.figId,
        // STRICT: the entry is only ever REPLACED, never added to. Inserting a
        // copy when the entry is gone is exactly how one click could fill the
        // image library with hundreds of duplicates (one per retry).
        insertIfMissing: false
      });
      // `updated: false` = the entry vanished from the library: the canvas would
      // keep the OLD pixels, re-trying cannot help, and a copy must NOT be
      // created — so this is a FINAL failure (no further attempt).
      if (!res || !res.updated) return { ok: false, hard: true, message: 'the saved figure is no longer in the image library' };
      return { ok: true, message: res.drive && res.drive.id ? 're-captured + uploaded to Drive' : 're-captured' };
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      timers.forEach((t) => clearTimeout(t));
      const progress = figureRecaptureProgress();
      const run = readFigureRecapture() || {};
      const ret = run.returnTo || null;
      setRecap({
        total: progress.total,
        done: progress.done,
        failed: progress.failed,
        msg: progress.failed ? 'some figures could not be re-captured automatically' : 'all figures are up to date'
      });
      // ⏹ The user stopped the run: no hand-over, nothing else is captured.
      if (userStopRef.current) {
        setRecap({
          total: progress.total,
          done: progress.done,
          failed: progress.failed,
          stopped: true,
          msg: 'stopped by you — nothing else was captured'
        });
        return;
      }
      // Hand over: the next experiment of the run, else back to the Image Builder.
      const next = nextRecaptureTarget();
      const wait = progress.failed ? 2600 : 1600;
      timers.push(setTimeout(() => {
        try {
          if (next && next.origin && next.origin.testId) {
            window.dispatchEvent(new CustomEvent(RECAPTURE_NEXT_TEST_EVENT, { detail: { testId: next.origin.testId, origin: next.origin } }));
          } else if (ret && ret.module === 'image-builder') {
            window.dispatchEvent(new CustomEvent(RECAPTURE_RETURN_EVENT, { detail: { projectId: ret.projectId || null } }));
          }
        } catch { /* the navigation is a convenience — never break the page */ }
      }, wait));
    };

    const step = async () => {
      if (stopped) return;
      const list = figureRecapturesForTest(test);
      if (!list.length) { finish(); return; }
      if (!applied) {
        // ONE pass over every chart (the closed sections are opened first), then
        // let the charts re-render before the first snapshot.
        const res = applyFigureStyleEverywhere(readFigureStyle());
        cancelApply = res.cancel;
        applied = true;
        if (update) update({ figureStyleTag: res.tag, figureStyleAppliedAt: new Date().toISOString() });
        setRecap({ total: list.length, done: 0, failed: 0, msg: 'applying the figure style…' });
        return;
      }
      if (busy) return;
      busy = true;
      try {
        for (const item of list) {
          if (stopped || userStopRef.current) return;   // ⏹ pressed mid-tick: stop NOW
          const el = findEl(item.elementKey);
          if (!el) continue;               // not mounted yet (lazy / Drive data)
          const out = await redo(item, el);
          // A capture failure may be transient (the chart was still painting) →
          // one more try, capped by FIGURE_RECAPTURE_MAX_ATTEMPTS. A HARD failure
          // (the library entry is gone) is final: retrying could only duplicate.
          markFigureRecaptureResult(item.figId, out.ok ? 'done' : 'failed', out.message, { retry: !out.hard });
          if (out.ok) results.done += 1; else results.failed += 1;
          setRecap({
            total: results.done + results.failed + Math.max(0, list.length - results.done - results.failed),
            done: results.done,
            failed: results.failed,
            msg: out.ok ? `${item.label} ✓` : `${item.label} — ${out.message}`
          });
        }
      } catch (err) {
        setRecap((r) => ({ ...(r || { total: 0, done: 0, failed: 0 }), msg: shortError(err) }));
      } finally {
        busy = false;
      }
      const left = figureRecapturesForTest(test);
      if (!left.length) { finish(); return; }
      if (Date.now() - startedAt > DEADLINE_MS) {
        left.forEach((it) => markFigureRecaptureResult(it.figId, 'failed', 'the chart was not found on the page — capture it with 📷', { hard: true }));
        finish();
      }
    };

    const timer = setInterval(step, TICK_MS);
    timers.push(setTimeout(step, 300));
    return () => {
      stopped = true;
      clearInterval(timer);
      timers.forEach((t) => clearTimeout(t));
      if (cancelApply) cancelApply();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, test && test.id]);





  const toggleFor = async (t) => {
    if (!update) return;
    const el = elMap.current.get(t.key);
    let item = null;
    if (t.kind === 'group' && el) {
      // Composite panel (data-star-group): one image of the WHOLE stack.
      const url = await htmlToDataUrl(el);
      if (url) item = { id: t.key, kind: 'graph', label: t.label, caption: t.label, url };
    } else if (t.kind === 'canvas' && el) {
      // Capture raster canvases at 2× so zooming into a figure panel stays
      // sharper. SVG charts keep their vector form (crisp at any zoom).
      let url = '';
      try {
        const scale = 2;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((el.width || el.offsetWidth || 300) * scale));
        c.height = Math.max(1, Math.round((el.height || el.offsetHeight || 200) * scale));
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        url = c.toDataURL('image/png');
      } catch { /* fall through to the original canvas */ }
      if (!url) url = el.toDataURL('image/png');
      item = { id: t.key, kind: 'graph', label: t.label, caption: t.label, url };
    } else if (t.kind === 'svg' && el) {
      item = { id: t.key, kind: 'graph', label: t.label, caption: t.label, url: svgToDataUrl(el) };
    } else if (t.kind === 'img' && el) {
      item = { id: t.key, kind: 'figure', label: t.label, caption: t.label, url: el.currentSrc || el.src || '' };
    } else if (t.kind === 'table' && el) {
      const data = tableToData(el);
      if (data) item = { id: t.key, kind: 'table', label: t.label, caption: t.label, columns: data.columns, rows: data.rows };
    }
    if (!item) return;
    update({ starredItems: toggleStarredItem(test, item) });
  };

  return (
    <div data-star-layer="1" className="no-print" style={OVERLAY_STYLE}>
      {targets.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFor(t); }}
          style={{ position: 'fixed', left: t.right - 30, top: t.top + 6, zIndex: 60, pointerEvents: 'auto' }}
          title={isStarred(test, t.key)
            ? `${t.label} — remove from project document`
            : `${t.label} — ⭐ import into project document`}
          className={`rounded-full w-6 h-6 text-sm font-bold flex items-center justify-center shadow-md border transition-colors ${
            isStarred(test, t.key)
              ? 'bg-amber-400 text-white border-amber-500'
              : 'bg-white text-amber-500 border-amber-300 hover:bg-amber-50'
          }`}
        >
          {isStarred(test, t.key) ? '★' : '☆'}
        </button>
      ))}
      {/* 📷 "Figure" buttons — one per chart / spectrum / image (not tables):
          saves the CURRENT state of the element as a high-resolution image
          into the project's image library and uploads a copy to Google Drive
          under <project>/images. */}
      {targets.filter((t) => t.kind !== 'table').map((t) => (
        <button
          key={`fig-${t.key}`}
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); saveFigure(t); }}
          style={{ position: 'fixed', left: t.right - 58, top: t.top + 6, zIndex: 61, pointerEvents: 'auto' }}
          title={figBusyKey === t.key
            ? `${t.label} — capturing…`
            : `${t.label} — 📷 save as high-resolution figure (project library + Drive)`}
          className={`rounded-full w-6 h-6 text-[11px] flex items-center justify-center shadow-md border transition-colors ${
            figBusyKey === t.key
              ? 'bg-indigo-200 text-indigo-700 border-indigo-400'
              : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'
          }`}
        >
          {figBusyKey === t.key ? '⏳' : '📷'}
        </button>
      ))}
      {figStatus && (
        <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 99999, pointerEvents: 'none' }}>
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full shadow-md border whitespace-nowrap ${figStatus.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-red-50 text-red-600 border-red-300'}`}>
            {figStatus.msg}
          </span>
        </div>
      )}

      {/* 🔄 AUTOMATIC RE-CAPTURE PROGRESS — driven by the Image Builder's
          "Recapture" button (see utils/figureRecapture): the figures of this
          page are re-rendered with the current style and written back over
          their library entries, then the app returns to the Image Builder. */}
      {recap && (
        <div style={{ position: 'fixed', right: 12, bottom: 16, zIndex: 63, pointerEvents: 'auto' }}
          className="no-print" data-figure-recapture="1">
          <div className="bg-white border border-indigo-300 rounded-xl shadow-lg px-3 py-2 text-[11px] text-slate-700 w-64">
            <div className="font-bold text-slate-800 mb-0.5">
              {recap.stopped ? '⏹' : recap.failed ? '⚠️' : '🔄'} Re-capture with the figure style
            </div>
            <div>
              <b>{recap.done}</b>/{recap.total} figure{recap.total === 1 ? '' : 's'} updated
              {recap.failed ? <span className="text-amber-700"> · {recap.failed} failed</span> : null}
            </div>
            {recap.msg ? <div className="text-[10px] text-slate-500 mt-0.5 break-words">{recap.msg}</div> : null}
            <div className="text-[10px] text-slate-400 mt-1">
              The figures were replaced in the image library — the Image Builder reopens by itself.
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button" onClick={stopRun} disabled={!!recap.stopped}
                title="Stop the re-capture now: no other figure is captured and nothing else is written to the image library."
                className="flex-1 rounded-md bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 font-bold py-1 disabled:opacity-40">
                ⏹ Stop
              </button>
              <button
                type="button" onClick={() => setRecap(null)} title="Hide this notice"
                className="rounded-md bg-white border border-slate-300 text-slate-500 hover:bg-slate-50 font-bold py-1 px-2">
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🎨 GLOBAL FIGURE STYLE — pushes the character sizes defined in
          Settings → "Figure style" into every chart / spectrum of this page
          (incl. the ones of the closed sections) BEFORE the 📷 figures are
          captured, so figures of different experiments share one character
          size in the Image Builder. See utils/figureStyle.js. */}
      <FigureStyleApplyButton test={test} update={update} />

    </div>
  );
};

export default ChartStarLayer;

