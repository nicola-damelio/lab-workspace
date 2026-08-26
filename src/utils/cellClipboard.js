/* =========================================================================
   cellClipboard.js — multi-cell mouse selection + Excel-style copy/paste.

   Spreadsheet behaviour for editable tables (NMR Fittings / DOSY):
     • drag or Shift+click to select a rectangle of cells
     • Ctrl/Cmd+C copies the selection as tab-separated values
     • Ctrl/Cmd+V pastes tab-separated values (from Excel) into the selection

   Implementation is DOM-based and framework-light: any editable cell gets
   `data-cell data-r data-c` attributes and is picked up by one global set of
   delegated listeners. Paste writes the DOM value and fires an `input` event
   so React's onChange keeps the state in sync.
   ========================================================================= */

const SELECTED_STYLE = 'input[data-cell].cell-selected, textarea[data-cell].cell-selected{background:#fde68a !important;box-shadow:inset 0 0 0 2px #f59e0b !important;}';

let attached = false;
let anchor = null;   // { r, c }
let current = null;  // { r, c }
let dragging = false;

const cellsOf = (root) => Array.from((root || document).querySelectorAll('input[data-cell]'));
const isCellEl = (el) => el && el.tagName === 'INPUT' && el.hasAttribute('data-cell');

const cellRC = (el) => ({ r: Number(el.dataset.r), c: Number(el.dataset.c) });

const clearSelection = () => {
  cellsOf(document).forEach((el) => el.classList.remove('cell-selected'));
  anchor = null; current = null; dragging = false;
};

const applySelection = () => {
  if (!anchor) return;
  const r0 = Math.min(anchor.r, current.r), r1 = Math.max(anchor.r, current.r);
  const c0 = Math.min(anchor.c, current.c), c1 = Math.max(anchor.c, current.c);
  cellsOf(document).forEach((el) => {
    const { r, c } = cellRC(el);
    const inside = r >= r0 && r <= r1 && c >= c0 && c <= c1;
    el.classList.toggle('cell-selected', inside);
  });
};

const selectedCells = () => {
  if (!anchor) return [];
  const r0 = Math.min(anchor.r, current.r), r1 = Math.max(anchor.r, current.r);
  const c0 = Math.min(anchor.c, current.c), c1 = Math.max(anchor.c, current.c);
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const row = [];
    for (let c = c0; c <= c1; c++) {
      const el = document.querySelector(`input[data-cell][data-r="${r}"][data-c="${c}"]`);
      row.push(el ? el.value : '');
    }
    out.push(row);
  }
  return out;
};

const onMouseDown = (e) => {
  const el = e.target;
  if (!isCellEl(el)) { if (!e.target.closest('table')) clearSelection(); return; }
  if (e.button !== 0) return;
  const rc = cellRC(el);
  if (e.shiftKey && document.querySelectorAll('.cell-selected').length) {
    // Shift+click extends the existing selection to this cell.
    const first = cellsOf(document).find((x) => x.classList.contains('cell-selected'));
    if (first) { anchor = cellRC(first); current = { ...rc }; applySelection(); return; }
  }
  anchor = rc;
  current = { ...rc };
  dragging = true;
  applySelection();
};

const onMouseOver = (e) => {
  const el = e.target;
  if (!dragging || !isCellEl(el)) return;
  current = cellRC(el);
  applySelection();
};

const onMouseUp = () => { dragging = false; };

const onKeyDown = (e) => {
  const target = e.target;
  if (!isCellEl(target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = (e.key || '').toLowerCase();
  if (!mod) { if (key === 'escape') clearSelection(); return; }

  if (key === 'c') {
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const text = selectedCells().map((row) => row.join('\t')).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
  } else if (key === 'v') {
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    if (!(navigator.clipboard && navigator.clipboard.readText)) return;
    navigator.clipboard.readText().then((text) => {
      const rows = String(text || '').split(/\r?\n/).map((line) => line.split('\t'));
      const r0 = Math.min(anchor.r, current.r), r1 = Math.max(anchor.r, current.r);
      const c0 = Math.min(anchor.c, current.c), c1 = Math.max(anchor.c, current.c);
      rows.forEach((row, i) => row.forEach((val, j) => {
        const r = r0 + i, c = c0 + j;
        if (r > r1 || c > c1) return;
        const el = document.querySelector(`input[data-cell][data-r="${r}"][data-c="${c}"]`);
        if (!el) return;
        if (el.value === val) return;
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }));
    }).catch(() => {});
  } else if (key === 'a') {
    const table = target.closest('table');
    if (!table) return;
    e.preventDefault();
    e.stopPropagation();
    const all = cellsOf(table);
    if (!all.length) return;
    const rcList = all.map(cellRC);
    anchor = { r: Math.min(...rcList.map((x) => x.r)), c: Math.min(...rcList.map((x) => x.c)) };
    current = { r: Math.max(...rcList.map((x) => x.r)), c: Math.max(...rcList.map((x) => x.c)) };
    applySelection();
  }
};

/** Enable the global multi-cell clipboard behaviour (idempotent, called once). */
export const enableCellClipboard = () => {
  if (attached || typeof document === 'undefined') return;
  attached = true;
  const style = document.createElement('style');
  style.textContent = SELECTED_STYLE;
  document.head.appendChild(style);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
};

/** Convenience helpers for tables that render `data-cell` inputs. */
export const cellAttrs = (r, c) => ({ 'data-cell': '', 'data-r': r, 'data-c': c });
