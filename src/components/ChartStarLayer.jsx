import React, { useEffect, useRef, useState } from 'react';
import { isStarred, toggleStarredItem } from '../utils/starredItems';
import Chart from 'chart.js/auto';
import {
  getActiveProjectId, addLibraryItem, addProjectLibraryItem, makeLibraryImage, uploadFigureToDrive
} from '../utils/figuresLibrary';
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
   ========================================================================= */

const KIND_LABEL = { canvas: 'Chart', img: 'Image', table: 'Table', svg: 'Chart' };

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

const svgToDataUrl = (svg) => {
  const r = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.max(1, Math.round(r.width))));
  clone.setAttribute('height', String(Math.max(1, Math.round(r.height))));
  const xml = new XMLSerializer().serializeToString(clone);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
};
const nextFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// High-resolution snapshot of the CURRENT rendered state of an element:
// • svg    → serialized as-is (vector — keeps axis labels, zoom/pan transforms)
// • img    → the current source URL (resolved to a self-contained data URL by
//            makeLibraryImage, so Drive-hosted images can be exported too)
// • canvas → Chart.js charts are temporarily re-rendered at an enhanced
//            devicePixelRatio (the zoomed region / axis state is preserved),
//            any other canvas is captured at its native pixel resolution.
const captureFigure = async (el, kind) => {
  if (!el) return '';
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
      if (!url) { setFigStatus({ key: t.key, ok: false, msg: '⚠️ Could not capture this element as an image' }); return; }
      const img = await makeLibraryImage(url);
      const label = `${t.label} · ${(test && test.name) || 'experiment'}`.slice(0, 120);
      const pid = projectIdForTest(test);
      const where = pid ? 'project library' : 'common library';
      const src = { testId: test && test.id, testName: test && test.name, elementLabel: t.label, elementKey: t.key };
      if (pid) addProjectLibraryItem(pid, { ...img, label, src });
      else addLibraryItem({ ...img, label, src });
      const projectName = projectNameFor(test);
      let driveMsg = '';
      if (projectName) {
        const res = await uploadFigureToDrive({ full: img.full, label, projectName });
        driveMsg = res
          ? ` · Drive: ${projectName}/images`
          : ' · Drive not connected — library copy only';
      }
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
    // scroll to the exact chart/spectrum the figure was captured from.
    try {
      const pend = localStorage.getItem('labPendingFigureScroll');
      if (pend) {
        localStorage.removeItem('labPendingFigureScroll');
        const target = JSON.parse(pend);
        if (target && target.key) {
          const el = rootEl.querySelector(`[data-figure-origin="${target.key}"]`);
          if (el) {
            setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
            const flash = el.closest('div,section,td') || el;
            const prevOutline = flash.style.outline;
            flash.style.outline = '3px solid #3b82f6';
            setTimeout(() => { flash.style.outline = prevOutline; }, 2600);
          }
        }
      }
    } catch { /* ignore */ }
    const debounced = () => { clearTimeout(debounced.t); debounced.t = setTimeout(collect, 400); };
    const mo = new MutationObserver(debounced);
    mo.observe(rootEl, { subtree: true, childList: true, attributes: true, characterData: true });
    const onScroll = () => refreshRects();
    rootEl.addEventListener('scroll', onScroll, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      mo.disconnect();
      clearTimeout(debounced.t);
      rootEl.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef]);

  const toggleFor = (t) => {
    if (!update) return;
    const el = elMap.current.get(t.key);
    let item = null;
    if (t.kind === 'canvas' && el) {
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

    </div>
  );
};

export default ChartStarLayer;

