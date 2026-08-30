import React, { useEffect, useRef, useState } from 'react';
import { isStarred, toggleStarredItem } from '../utils/starredItems';

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
    </div>
  );
};

export default ChartStarLayer;

