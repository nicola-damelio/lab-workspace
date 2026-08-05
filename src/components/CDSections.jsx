import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, ErrorBar
} from 'recharts';

const HAS_EB = typeof ErrorBar !== 'undefined';

/* ============================================================================
CDSections — REWRITTEN
Now includes (ported from NMRSections.jsx):
  • Multiple experimental conditions / instances (each with own spectra + values)
  • Parameter layers (built-in CD Signal + user layers)
  • Condition plots with weighted fitting: Linear / 4PL / Custom Equation
  • Error management: fixed SD, manual SD, outlier exclusion, auto-touch SD
  • Per-plot graphical parameters + horizontal reference lines
  • Selection presets for plotted spectra
========================================================================== */

const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

const SPECTRA_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981'
];
const LINE_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
];
const STRUCTURE_COLORS = {
  'α-Helix': '#3b82f6',
  'β-Sheet': '#ef4444',
  Turn: '#f59e0b',
  'Random Coil': '#94a3b8',
  Other: '#8b5cf6'
};
const DEFAULT_CHART_CFG = { yMin: '', yMax: '', xMin: '190', xMax: '260', fontSize: 12, lineWidth: 2 };
const DEFAULT_STRUCTURE = { 'α-Helix': 30, 'β-Sheet': 20, Turn: 10, 'Random Coil': 40 };

// ================= COLLAPSIBLE SECTION =================
const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// ================= SPLINE INTERPOLATION =================
class NaturalCubicSpline {
  constructor(xs, ys) {
    this.xs = xs;
    this.ys = ys;
    this.n = xs.length;
    this.a = ys.slice();
    this.b = new Array(this.n).fill(0);
    this.c = new Array(this.n).fill(0);
    this.d = new Array(this.n).fill(0);
    this.calculateCoefficients();
  }
  calculateCoefficients() {
    const h = [];
    for (let i = 0; i < this.n - 1; i++) h.push(this.xs[i + 1] - this.xs[i]);
    const alpha = new Array(this.n - 1).fill(0);
    for (let i = 1; i < this.n - 1; i++) {
      alpha[i] =
        (3 / h[i]) * (this.a[i + 1] - this.a[i]) -
        (3 / h[i - 1]) * (this.a[i] - this.a[i - 1]);
    }
    const l = new Array(this.n).fill(0);
    const mu = new Array(this.n).fill(0);
    const z = new Array(this.n).fill(0);
    l[0] = 1;
    for (let i = 1; i < this.n - 1; i++) {
      l[i] = 2 * (this.xs[i + 1] - this.xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[this.n - 1] = 1;
    for (let j = this.n - 2; j >= 0; j--) {
      this.c[j] = z[j] - mu[j] * this.c[j + 1];
      this.b[j] =
        (this.a[j + 1] - this.a[j]) / h[j] -
        (h[j] * (this.c[j + 1] + 2 * this.c[j])) / 3;
      this.d[j] = (this.c[j + 1] - this.c[j]) / (3 * h[j]);
    }
  }
  at(x) {
    let i = 0;
    if (x >= this.xs[this.n - 1]) i = this.n - 2;
    else if (x <= this.xs[0]) i = 0;
    else {
      let low = 0;
      let high = this.n - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.xs[mid] < x) low = mid + 1;
        else high = mid - 1;
      }
      i = Math.max(0, high);
    }
    if (i >= this.n - 1) i = this.n - 2;
    const dx = x - this.xs[i];
    return this.a[i] + this.b[i] * dx + this.c[i] * dx * dx + this.d[i] * dx * dx * dx;
  }
}

// ================= CD REFERENCE KNOTS =================
const alphaKnots = [
  { x: 176, y: 12000 }, { x: 180, y: 22000 }, { x: 185, y: 48000 }, { x: 190, y: 66000 },
  { x: 192, y: 65000 }, { x: 195, y: 55000 }, { x: 200, y: 20000 }, { x: 203, y: 0 },
  { x: 205, y: -15000 }, { x: 208, y: -32000 }, { x: 215, y: -29000 }, { x: 222, y: -35000 },
  { x: 230, y: -20000 }, { x: 240, y: -2000 }, { x: 250, y: 0 }, { x: 260, y: 0 }
];
const betaKnots = [
  { x: 176, y: -10000 }, { x: 180, y: -8000 }, { x: 185, y: -4000 }, { x: 190, y: 2000 },
  { x: 196, y: 12000 }, { x: 205, y: 4000 }, { x: 210, y: 0 }, { x: 217, y: -5000 },
  { x: 225, y: -4000 }, { x: 240, y: -500 }, { x: 260, y: 0 }
];
const turnKnots = [
  { x: 176, y: 0 }, { x: 185, y: 10000 }, { x: 193, y: 20000 }, { x: 200, y: 8000 },
  { x: 203, y: 0 }, { x: 210, y: -10500 }, { x: 220, y: -8000 }, { x: 230, y: -4000 },
  { x: 245, y: 0 }, { x: 260, y: 0 }
];
const coilKnots = [
  { x: 176, y: -5000 }, { x: 185, y: 0 }, { x: 187, y: 2000 }, { x: 190, y: 0 },
  { x: 198, y: -16000 }, { x: 212, y: -2000 }, { x: 220, y: 1000 }, { x: 230, y: 1500 },
  { x: 245, y: 0 }, { x: 260, y: 0 }
];
const bDnaKnots = [
  { x: 180, y: -10 }, { x: 184, y: 30 }, { x: 187, y: 65 }, { x: 192, y: 40 },
  { x: 195, y: 15 }, { x: 200, y: -5 }, { x: 205, y: -10 }, { x: 210, y: -12 },
  { x: 215, y: -8 }, { x: 220, y: -2 }, { x: 230, y: 0 }, { x: 240, y: -2 },
  { x: 250, y: -6 }, { x: 260, y: -2 }, { x: 275, y: 5 }, { x: 290, y: 2 },
  { x: 300, y: 0 }, { x: 320, y: 0 }
];
const aDnaKnots = [
  { x: 180, y: -15 }, { x: 185, y: 40 }, { x: 190, y: 81 }, { x: 195, y: 50 },
  { x: 200, y: 0 }, { x: 205, y: -25 }, { x: 210, y: -30 }, { x: 215, y: -20 },
  { x: 220, y: -10 }, { x: 225, y: -6 }, { x: 230, y: -5 }, { x: 240, y: -5 },
  { x: 250, y: 0 }, { x: 265, y: 9 }, { x: 280, y: 5 }, { x: 300, y: 0 },
  { x: 320, y: 0 }
];
const zDnaKnots = [
  { x: 180, y: 30 }, { x: 183, y: 76 }, { x: 186, y: 40 }, { x: 188, y: 20 },
  { x: 190, y: -10 }, { x: 195, y: -48 }, { x: 200, y: -40 }, { x: 205, y: -30 },
  { x: 210, y: -22 }, { x: 220, y: -5 }, { x: 230, y: 2 }, { x: 240, y: 2 },
  { x: 250, y: 4 }, { x: 260, y: 4 }, { x: 280, y: -5 }, { x: 295, y: -6 },
  { x: 310, y: 0 }, { x: 320, y: 0 }
];
const gqParallelKnots = [
  { x: 220, y: 40 }, { x: 225, y: 0 }, { x: 230, y: -50 }, { x: 235, y: -100 },
  { x: 240, y: -115 }, { x: 245, y: -80 }, { x: 250, y: 50 }, { x: 255, y: 300 },
  { x: 262, y: 475 }, { x: 270, y: 350 }, { x: 280, y: 80 }, { x: 290, y: 30 },
  { x: 300, y: 25 }, { x: 310, y: 0 }, { x: 320, y: 0 }
];
const gqHybridKnots = [
  { x: 220, y: 110 }, { x: 225, y: 50 }, { x: 230, y: 0 }, { x: 236, y: -32 },
  { x: 245, y: 0 }, { x: 250, y: 40 }, { x: 260, y: 110 }, { x: 270, y: 142 },
  { x: 280, y: 160 }, { x: 288, y: 190 }, { x: 300, y: 140 }, { x: 310, y: 20 },
  { x: 320, y: 5 }
];
const gqAntiparallelKnots = [
  { x: 220, y: 65 }, { x: 225, y: 30 }, { x: 233, y: 4 }, { x: 240, y: 25 },
  { x: 248, y: 50 }, { x: 255, y: 0 }, { x: 260, y: -50 }, { x: 265, y: -70 },
  { x: 272, y: -30 }, { x: 280, y: 0 }, { x: 290, y: 60 }, { x: 297, y: 78 },
  { x: 305, y: 50 }, { x: 315, y: 0 }, { x: 320, y: -4 }
];

const splineAlpha = new NaturalCubicSpline(alphaKnots.map((p) => p.x), alphaKnots.map((p) => p.y));
const splineBeta = new NaturalCubicSpline(betaKnots.map((p) => p.x), betaKnots.map((p) => p.y));
const splineTurn = new NaturalCubicSpline(turnKnots.map((p) => p.x), turnKnots.map((p) => p.y));
const splineCoil = new NaturalCubicSpline(coilKnots.map((p) => p.x), coilKnots.map((p) => p.y));
const splineADNA = new NaturalCubicSpline(aDnaKnots.map((p) => p.x), aDnaKnots.map((p) => p.y));
const splineBDNA = new NaturalCubicSpline(bDnaKnots.map((p) => p.x), bDnaKnots.map((p) => p.y));
const splineZDNA = new NaturalCubicSpline(zDnaKnots.map((p) => p.x), zDnaKnots.map((p) => p.y));
const splineGQP = new NaturalCubicSpline(gqParallelKnots.map((p) => p.x), gqParallelKnots.map((p) => p.y));
const splineGQH = new NaturalCubicSpline(gqHybridKnots.map((p) => p.x), gqHybridKnots.map((p) => p.y));
const splineGQA = new NaturalCubicSpline(gqAntiparallelKnots.map((p) => p.x), gqAntiparallelKnots.map((p) => p.y));

// ================= JASCO IMPORT PARSER =================
const parseJascoDate = (value) => {
  if (!value) return '';
  const s = String(value);
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return '';
};

const parseJascoCDText = (text) => {
  const meta = {};
  let xs = [];
  let ys = [];
  let inData = false;
  const addMeta = (line) => {
    if (!line) return;
    if (line.includes('\t')) {
      const parts = line.split('\t');
      const key = parts[0].trim();
      const value = parts.slice(1).join('\t').trim();
      if (key) meta[key] = value;
      return;
    }
    if (line.includes(',') && !/^[-+]?\d/.test(line)) {
      const idx = line.indexOf(',');
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) meta[key] = value;
      return;
    }
    const m = line.match(/^([A-Za-z0-9/.\-() ]{2,60}?)\s+(.*)$/);
    if (m && !/^\d/.test(m[1])) meta[m[1].trim()] = m[2].trim();
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('### ##')) { inData = false; continue; }
    if (line.startsWith('[')) continue;
    if (/^XYDATA/i.test(line)) { inData = true; continue; }
    if (inData) {
      const cols = line.split(/[,\s]+/).filter(Boolean);
      if (cols.length >= 2) {
        const x = parseFloat(cols[0]);
        const y = parseFloat(cols[1]);
        if (!isNaN(x) && !isNaN(y)) { xs.push(x); ys.push(y); }
      }
      continue;
    }
    addMeta(line);
  }
  if (xs.length > 1 && xs[0] > xs[xs.length - 1]) { xs.reverse(); ys.reverse(); }
  const title = meta['Sample name'] || meta['TITLE'] || '';
  const experimentDate = parseJascoDate(meta['Measurement date'] || meta['DATE'] || meta['Creation date'] || '');
  const temperatureRaw = meta['Temperature'] || '';
  const temperature = temperatureRaw ? temperatureRaw.replace(/\sC\s$/, ' °C') : '';
  const pathRaw = meta['Cell length'] || '';
  const pathMatch = pathRaw.match(/(-?\d+(?:\.\d+)?)/);
  const pathLength = pathMatch ? pathMatch[1] : pathRaw;
  const concentration = meta['Concentration'] || '';
  return { xs, ys, meta, title, experimentDate, temperature, pathLength, concentration };
};

// ================= RESPONSIVE CANVAS HELPER =================
const useElementSize = (ref) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
};

// ================= SHARED DATA HELPERS =================
const computeParsed = (source) => {
  const src = source || {};
  const wavelengthData = src.wavelengthData || '';
  const spectraColumns = src.spectraColumns || [];
  const parsedWavelengths = wavelengthData
    .split(/[\n,]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  const parsedSpectra = spectraColumns.map((col, idx) => {
    const values = (col.data || '')
      .split(/[\n,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));
    return { ...col, values, color: col.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length] };
  });
  return { parsedWavelengths, parsedSpectra };
};

const parseManual = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ================= FITTING ENGINE (ported from NMRSections) =================
const gaussSolve = (A, b) => {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i][i]);
};

const tokenizeExpr = (s) => {
  const t = [];
  let i = 0;
  const D = (c) => /[0-9.]/.test(c);
  const A = (c) => /[a-zA-Z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (D(c)) {
      let j = i;
      while (j < s.length && D(s[j])) j++;
      t.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (A(c)) {
      let j = i;
      while (j < s.length && (A(s[j]) || /[0-9]/.test(s[j]))) j++;
      t.push({ t: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^(),'.includes(c)) { t.push({ t: c }); i++; continue; }
    throw new Error('bad');
  }
  return t;
};

const parseExpression = (src) => {
  const tk = tokenizeExpr(src);
  let p = 0;
  const pk = () => tk[p];
  const eat = (t) => {
    if (!tk[p] || tk[p].t !== t) throw new Error('exp');
    return tk[p++];
  };
  const mul = () => {
    let n = un();
    while (pk() && (pk().t === '*' || pk().t === '/')) {
      const o = eat(pk().t).t;
      n = { type: 'bin', op: o, l: n, r: un() };
    }
    return n;
  };
  const add = () => {
    let n = mul();
    while (pk() && (pk().t === '+' || pk().t === '-')) {
      const o = eat(pk().t).t;
      n = { type: 'bin', op: o, l: n, r: mul() };
    }
    return n;
  };
  const un = () => {
    if (pk() && pk().t === '-') { eat('-'); return { type: 'un', a: un() }; }
    if (pk() && pk().t === '+') { eat('+'); return un(); }
    return pw();
  };
  const pw = () => {
    let n = pr();
    if (pk() && pk().t === '^') { eat('^'); n = { type: 'bin', op: '^', l: n, r: un() }; }
    return n;
  };
  const pr = () => {
    const t = pk();
    if (!t) throw new Error('exp');
    if (t.t === 'num') { eat('num'); return { type: 'num', v: t.v }; }
    if (t.t === 'id') {
      eat('id');
      if (pk() && pk().t === '(') {
        eat('(');
        const a = [add()];
        while (pk() && pk().t === ',') { eat(','); a.push(add()); }
        eat(')');
        return { type: 'call', name: t.v, args: a };
      }
      return { type: 'sym', name: t.v };
    }
    if (t.t === '(') { eat('('); const n = add(); eat(')'); return n; }
    throw new Error('exp');
  };
  const ast = add();
  if (p < tk.length) throw new Error('trail');
  return ast;
};

const evalAST = (n, s) => {
  switch (n.type) {
    case 'num': return n.v;
    case 'sym':
      return n.name === 'x' ? s.x : n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : s[n.name];
    case 'un': return -evalAST(n.a, s);
    case 'bin': {
      const a = evalAST(n.l, s);
      const b = evalAST(n.r, s);
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      if (n.op === '/') return a / b;
      return Math.pow(a, b);
    }
    case 'call': {
      const a = n.args.map((x) => evalAST(x, s));
      switch (n.name) {
        case 'exp': return Math.exp(a[0]);
        case 'log': return Math.log10(a[0]);
        case 'ln': return Math.log(a[0]);
        case 'sqrt': return Math.sqrt(a[0]);
        case 'sin': return Math.sin(a[0]);
        case 'cos': return Math.cos(a[0]);
        case 'tan': return Math.tan(a[0]);
        case 'abs': return Math.abs(a[0]);
        case 'pow': return Math.pow(a[0], a[1]);
        case 'min': return Math.min(...a);
        case 'max': return Math.max(...a);
        default: return NaN;
      }
    }
    default: return NaN;
  }
};

const collectParams = (ast) => {
  const s = new Set();
  (function w(n) {
    if (!n) return;
    if (n.type === 'sym') {
      if (n.name !== 'x' && n.name !== 'pi' && n.name !== 'e') s.add(n.name);
    }
    if (n.type === 'bin') { w(n.l); w(n.r); }
    if (n.type === 'un') w(n.a);
    if (n.type === 'call') n.args.forEach(w);
  })(ast);
  return [...s];
};

const fitGeneric = (pts, f0, P0) => {
  let P = [...P0];
  const f = (x, Pv) => f0(x, Pv);
  const ssr = (Pv) => {
    let s = 0;
    for (const p of pts) {
      const v = f(p.x, Pv);
      if (!isFinite(v)) return Infinity;
      const w = p.w || 1;
      s += w * (p.y - v) * (p.y - v);
    }
    return s;
  };
  let lam = 1e-3;
  let cur = ssr(P);
  for (let it = 0; it < 120 && isFinite(cur); it++) {
    const J = pts.map((p) => {
      const y0 = f(p.x, P);
      const row = [];
      for (let k = 0; k < P.length; k++) {
        const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4);
        row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h);
      }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0));
    const g = P.map(() => 0);
    pts.forEach((p, i) => {
      const w = p.w || 1;
      const r = p.y - f(p.x, P);
      for (let a = 0; a < P.length; a++) {
        g[a] += w * J[i][a] * r;
        for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b];
      }
    });
    for (let a = 0; a < P.length; a++) A[a][a] *= (1 + lam);
    const delta = gaussSolve(A, g);
    if (!delta) { lam *= 4; if (lam > 1e7) break; continue; }
    const P2 = P.map((v, k) => v + delta[k]);
    const s2 = ssr(P2);
    if (isFinite(s2) && s2 < cur) {
      const prev = cur;
      P = P2;
      cur = s2;
      lam = Math.max(1e-8, lam / 2);
      if (Math.abs(prev - cur) < 1e-10) break;
    } else {
      lam *= 3;
      if (lam > 1e7) break;
    }
  }
  if (!P.every(isFinite)) return null;
  let sst = 0;
  const mean = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  pts.forEach((p) => { sst += (p.y - mean) * (p.y - mean); });
  const r2 = sst > 0 ? 1 - cur / sst : 1;
  const se = pts.length > P.length ? Math.sqrt(cur / (pts.length - P.length)) : Math.sqrt(cur || 0);
  return { params: P, r2, se, f: (x) => f(x, P) };
};

const fitLinear = (pts) => {
  const r = fitGeneric(pts, (x, P) => P[0] + P[1] * x, [0, 1]);
  return r ? { ...r, intercept: r.params[0], slope: r.params[1] } : null;
};

const fit4PL = (pts) => {
  const ys = pts.map((p) => p.y);
  const t = Math.max(...ys);
  const b = Math.min(...ys);
  const xMean = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
  const r = fitGeneric(pts, (x, P) => P[1] + (P[0] - P[1]) / (1 + Math.pow(x / P[2], P[3])), [t, b, xMean, 1]);
  return r ? { ...r, top: r.params[0], bottom: r.params[1], ic50: r.params[2], hill: r.params[3] } : null;
};

const fitCustomEquation = (expr, pts) => {
  let ast;
  let par;
  try {
    ast = parseExpression(expr);
    par = collectParams(ast);
  } catch (e) {
    return null;
  }
  if (!par.length || pts.length < par.length + 1) return null;
  const init = par.map((_, i) => (i === 0 ? pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length) : 1));
  const res = fitGeneric(pts, (x, P) => {
    const s = { x };
    par.forEach((n, i) => { s[n] = P[i]; });
    return evalAST(ast, s);
  }, init);
  if (!res) return null;
  res.params = Object.fromEntries(par.map((n, i) => [n, res.params[i]]));
  return res;
};

const lineDash = (style) => (style === 'dashed' ? '7 5' : style === 'dotted' ? '2 3' : undefined);

const FIT_DEFAULT_CHART_CFG = {
  height: 380, ptSize: 5, ptStyle: 'circle', lineStyle: 'solid', lineThickness: 2,
  fontSize: 12, legend: 'top', xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: ''
};

const makePlotId = () => `cp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const makeInstanceId = () => `inst_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const makeLayerId = () => `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const defaultCdPlotCfg = (n) => ({
  id: makePlotId(),
  title: `Condition Plot ${n}`,
  layerKey: 'cd',
  seriesKeys: [],
  xMode: 'category',
  chartType: 'line',
  fitEnabled: false,
  fitModel: 'linear',
  customExpr: '',
  showPoints: true,
  showErrors: true,
  showFit: true,
  showMaxLines: false,
  hLines: [],
  useFixedSD: false,
  fixedSDStr: '',
  outlierThreshStr: '2.5',
  hiddenSeries: {},
  excluded: {},
  manualSD: {},
  chartCfg: { ...FIT_DEFAULT_CHART_CFG }
});

// ================= INSTANCES / LAYERS (ported concept from NMRSections) =================
const CD_SIGNAL_LAYER = { key: 'cd', label: 'CD Signal', unit: 'mdeg', builtin: true };

const getInstances = (activeTest) => {
  if (Array.isArray(activeTest.instances) && activeTest.instances.length) return activeTest.instances;
  return [{
    id: 'inst_default',
    name: 'Condition 1',
    xValue: '',
    notes: '',
    wavelengthData: activeTest.wavelengthData || '',
    spectraColumns: Array.isArray(activeTest.spectraColumns) ? activeTest.spectraColumns : [],
    values: { cd: {} }
  }];
};

const getLayers = (activeTest) => [
  CD_SIGNAL_LAYER,
  ...(Array.isArray(activeTest.parameterLayers) ? activeTest.parameterLayers : [])
];

const getLayerValues = (instance, layerKey) =>
  (instance && instance.values && instance.values[layerKey]) || {};

// Interpolated value of each spectrum of an instance at wavelength lambda
const extractAtWavelength = (instance, lambda) => {
  const { parsedWavelengths, parsedSpectra } = computeParsed(instance);
  const out = {};
  parsedSpectra.forEach((s) => {
    const pairs = parsedWavelengths
      .map((x, i) => ({ x, y: s.values[i] }))
      .filter((p) => Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);
    if (!pairs.length) return;
    let v = null;
    if (lambda <= pairs[0].x) v = pairs[0].y;
    else if (lambda >= pairs[pairs.length - 1].x) v = pairs[pairs.length - 1].y;
    else {
      for (let i = 0; i < pairs.length - 1; i++) {
        if (lambda >= pairs[i].x && lambda <= pairs[i + 1].x) {
          const span = pairs[i + 1].x - pairs[i].x || 1;
          const t = (lambda - pairs[i].x) / span;
          v = pairs[i].y + t * (pairs[i + 1].y - pairs[i].y);
          break;
        }
      }
    }
    if (v !== null && Number.isFinite(v)) out[`spec-${s.id}`] = String(+v.toFixed(4));
  });
  return out;
};

// ================= SHARED DERIVED DATA HOOK =================
const useCdDerived = (activeTest) => {
  const instances = getInstances(activeTest);
  const activeInstance = instances.find((i) => i.id === activeTest.activeInstanceId) || instances[0] || null;
  const layers = getLayers(activeTest);
  const activeLayerKey = activeTest.activeLayerKey || 'cd';
  const activeLayer = layers.find((l) => l.key === activeLayerKey) || CD_SIGNAL_LAYER;
  const activeValues = getLayerValues(activeInstance, activeLayerKey);

  const wl = activeInstance ? activeInstance.wavelengthData || '' : '';
  const cols = activeInstance ? activeInstance.spectraColumns || [] : [];

  const { parsedWavelengths, parsedSpectra } = useMemo(
    () => computeParsed({ wavelengthData: wl, spectraColumns: cols }),
    [wl, cols]
  );

  const seriesOptions = useMemo(
    () => cols.map((c) => ({ key: `spec-${c.id}`, label: c.title || `Spectrum ${c.id}` })),
    [cols]
  );

  const selectedKeys =
    Array.isArray(activeTest.selectedSeriesKeys) && activeTest.selectedSeriesKeys.length
      ? activeTest.selectedSeriesKeys
      : null;

  return {
    instances, activeInstance, layers, activeLayerKey, activeLayer, activeValues,
    parsedWavelengths, parsedSpectra, seriesOptions, selectedKeys
  };
};

// ================= PROTEIN CD MIXER =================
const ProteinCDMixer = ({ isExpanded, onToggleExpand }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height } = useElementSize(wrapRef);
  const [compositions, setCompositions] = useState({ helix: 0, sheet: 0, turn: 0, coil: 100 });
  const [autoNormalize, setAutoNormalize] = useState(true);

  const updateComp = (key, val) => {
    let newVal = Math.max(0, Math.min(100, val));
    const newComps = { ...compositions, [key]: newVal };
    if (autoNormalize) {
      let currentTotal = 0;
      const others = Object.keys(newComps).filter((k) => k !== key);
      others.forEach((k) => { currentTotal += newComps[k]; });
      if (newVal + currentTotal > 100) {
        const excess = newVal + currentTotal - 100;
        if (currentTotal > 0) {
          others.forEach((k) => {
            const reduction = Math.round(excess * (newComps[k] / currentTotal));
            newComps[k] = Math.max(0, newComps[k] - reduction);
          });
        } else {
          others.forEach((k) => { newComps[k] = 0; });
        }
      }
      let finalTotal = Object.values(newComps).reduce((a, b) => a + b, 0);
      if (finalTotal !== 100 && finalTotal < 100) {
        const diff = 100 - finalTotal;
        const target = key !== 'coil' ? 'coil' : 'turn';
        newComps[target] += diff;
      }
    }
    setCompositions(newComps);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 80 || height < 80) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = width;
    const H = height;
    const wavelengths = [];
    const values = [];
    const pA = compositions.helix / 100;
    const pB = compositions.sheet / 100;
    const pT = compositions.turn / 100;
    const pC = compositions.coil / 100;
    for (let w = 176; w <= 260; w += 1) {
      wavelengths.push(w);
      const cd =
        splineAlpha.at(w) * pA +
        splineBeta.at(w) * pB +
        splineTurn.at(w) * pT +
        splineCoil.at(w) * pC;
      values.push(cd);
    }
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;
    const xMin = 176;
    const xMax = 260;
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const yMin = Math.min(dataMin, -40000);
    const yMax = Math.max(dataMax, 80000);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let x = Math.ceil(xMin / 10) * 10; x <= xMax; x += 10) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
    }
    const yRange = yMax - yMin;
    const yTickStep = yRange > 100000 ? 20000 : 10000;
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(pad.left + plotW, zeroY); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#8e44ad';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    wavelengths.forEach((w, i) => {
      const px = pad.left + ((w - xMin) / (xMax - xMin)) * plotW;
      const py = pad.top + plotH - ((values[i] - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (let x = Math.ceil(xMin / 10) * 10; x <= xMax; x += 10) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx.fillText(x.toString(), px, pad.top + plotH + 15);
    }
    ctx.fillText('Wavelength (nm)', pad.left + plotW / 2, H - 5);
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.fillText(`${(y / 1000).toFixed(0)}k`, pad.left - 5, py + 4);
    }
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('MRE (deg cm² dmol⁻¹)', 0, 0);
    ctx.restore();
  }, [compositions, width, height]);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? ` ${FS_CLASSES} p-6` : 'break-inside-avoid p-4'}`}>
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2">
          <span>🧬</span> Protein Secondary Structure Simulator
        </h4>
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">
          {isExpanded ? '↙️' : '↗️'}
        </button>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={wrapRef} className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${isExpanded ? 'flex-1 min-h-0' : 'h-[350px]'}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
        <div className="w-full lg:w-64 flex flex-col gap-3 shrink-0">
          <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Composition</div>
          {Object.entries(compositions).map(([key, val]) => {
            const labels = { helix: 'α-Helix', sheet: 'β-Sheet', turn: 'Turn', coil: 'Random Coil' };
            const colors = { helix: '#3b82f6', sheet: '#ef4444', turn: '#f59e0b', coil: '#94a3b8' };
            return (
              <div key={key} className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold" style={{ color: colors[key] }}>{labels[key]}</span>
                  <span className="text-xs font-mono font-bold text-slate-700">{val}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={val}
                  onChange={(e) => updateComp(key, parseInt(e.target.value, 10))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: colors[key] }}
                />
              </div>
            );
          })}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
              <span>Total:</span>
              <span className={Object.values(compositions).reduce((a, b) => a + b, 0) === 100 ? 'text-emerald-600' : 'text-red-500'}>
                {Object.values(compositions).reduce((a, b) => a + b, 0)}%
              </span>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={autoNormalize}
                onChange={(e) => setAutoNormalize(e.target.checked)}
                className="w-3 h-3 accent-blue-600"
              />
              Auto-normalize to 100%
            </label>
            <button
              onClick={() => setCompositions({ helix: 0, sheet: 0, turn: 0, coil: 100 })}
              className="mt-2 w-full text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors"
            >
              Reset to 100% Coil
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ================= CD LIBRARY =================
const CD_LIBRARY_TABS = [
  { id: 'protein', label: 'Protein Structures' },
  { id: 'dna', label: 'DNA Helices' },
  { id: 'gq', label: 'G-Quadruplexes' },
  { id: 'dnaPepAlpha', label: 'DNA+Pep (Alpha)' },
  { id: 'dnaPepBeta', label: 'DNA+Pep (Beta)' },
  { id: 'dnaPepAlphaZ', label: 'DNA+Pep (Alpha+Z)' },
  { id: 'dnaPepBetaZ', label: 'DNA+Pep (Beta+Z)' },
  { id: 'pepDnaAlpha', label: 'Pep+DNA (Alpha)' },
  { id: 'pepDnaBeta', label: 'Pep+DNA (Beta)' },
  { id: 'pepDnaAlphaZ', label: 'Pep+DNA (Alpha+Z)' },
  { id: 'pepDnaBetaZ', label: 'Pep+DNA (Beta+Z)' }
];

const CD_SIM_INFO = {
  dnaPepAlpha: {
    ratioLabel: 'Peptide:DNA Ratio',
    description: 'Simulation (Alpha Binding): DNA remains B-form. Ratio 0-1: peptide binds as α-helix. Ratio >1: excess peptide is Random Coil.'
  },
  dnaPepBeta: {
    ratioLabel: 'Peptide:DNA Ratio',
    description: 'Simulation (Beta Binding): DNA remains B-form. Ratio 0-1: peptide binds as β-sheet. Ratio >1: excess peptide is Random Coil.'
  },
  dnaPepAlphaZ: {
    ratioLabel: 'Peptide:DNA Ratio',
    description: 'Simulation (Alpha + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B → Z transition; peptide binds as α-helix. Ratio >1: DNA is Z-form; excess peptide is Random Coil.'
  },
  dnaPepBetaZ: {
    ratioLabel: 'Peptide:DNA Ratio',
    description: 'Simulation (Beta + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B → Z transition; peptide binds as β-sheet. Ratio >1: DNA is Z-form; excess peptide is Random Coil.'
  },
  pepDnaAlpha: {
    ratioLabel: 'DNA:Peptide Ratio',
    description: 'Simulation (Peptide + DNA [Alpha]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is α-helix. Ratio >1: peptide fully bound as α-helix; excess DNA is B-form.'
  },
  pepDnaBeta: {
    ratioLabel: 'DNA:Peptide Ratio',
    description: 'Simulation (Peptide + DNA [Beta]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is β-sheet. Ratio >1: peptide fully bound as β-sheet; excess DNA is B-form.'
  },
  pepDnaAlphaZ: {
    ratioLabel: 'DNA:Peptide Ratio',
    description: 'Simulation (Peptide + DNA [Alpha+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is α-helix. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.'
  },
  pepDnaBetaZ: {
    ratioLabel: 'DNA:Peptide Ratio',
    description: 'Simulation (Peptide + DNA [Beta+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is β-sheet. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.'
  }
};

const CD_REF_TYPES = {
  'Alpha-helix': { spline: splineAlpha, start: 176, end: 260, color: '#3b82f6', group: 'protein' },
  'Beta-sheet': { spline: splineBeta, start: 176, end: 260, color: '#ef4444', group: 'protein' },
  Turn: { spline: splineTurn, start: 176, end: 260, color: '#f59e0b', group: 'protein' },
  'Random Coil': { spline: splineCoil, start: 176, end: 260, color: '#94a3b8', group: 'protein' },
  'A-DNA': { spline: splineADNA, start: 180, end: 320, color: '#8b5cf6', group: 'dna' },
  'B-DNA': { spline: splineBDNA, start: 180, end: 320, color: '#10b981', group: 'dna' },
  'Z-DNA': { spline: splineZDNA, start: 180, end: 320, color: '#f97316', group: 'dna' },
  'G-Quad (Parallel)': { spline: splineGQP, start: 220, end: 320, color: '#ec4899', group: 'gq' },
  'G-Quad (Hybrid)': { spline: splineGQH, start: 220, end: 320, color: '#14b8a6', group: 'gq' },
  'G-Quad (Antiparallel)': { spline: splineGQA, start: 220, end: 320, color: '#6366f1', group: 'gq' }
};

const CD_LIBRARY_SCALE = 10000;

const niceCdStep = (range, targetTicks = 6) => {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice;
  if (norm >= 7.5) nice = 10;
  else if (norm >= 3.5) nice = 5;
  else if (norm >= 1.5) nice = 2;
  else nice = 1;
  return nice * mag;
};

const getScaledCdSpectrum = (key, xs) => {
  const def = CD_REF_TYPES[key];
  if (!def) return xs.map(() => 0);
  const raw = xs.map((x) => {
    const xx = Math.min(Math.max(x, def.start), def.end);
    return def.spline.at(xx);
  });
  const maxAbs = Math.max(1e-6, ...raw.map((v) => Math.abs(v)));
  return raw.map((v) => (v / maxAbs) * CD_LIBRARY_SCALE);
};

const normalizeCdSeries = (series) => {
  if (!series.length) return series;
  const allValues = series.flatMap((s) => s.values);
  const maxAbs = Math.max(1e-6, ...allValues.map((v) => Math.abs(v)));
  return series.map((s) => ({ ...s, values: s.values.map((v) => (v / maxAbs) * 100) }));
};

const buildCdLibraryData = ({ tab, selectedProtein, selectedDna, selectedGq, ratio, normalize }) => {
  let domain = { min: 176, max: 260 };
  if (tab === 'dna') domain = { min: 180, max: 320 };
  else if (tab === 'gq') domain = { min: 220, max: 320 };
  else if (tab.startsWith('dnaPep') || tab.startsWith('pepDna')) domain = { min: 180, max: 320 };
  const xs = [];
  for (let x = domain.min; x <= domain.max; x += 1) xs.push(x);
  let series = [];
  if (tab === 'protein') {
    series = selectedProtein.map((key) => ({
      label: key,
      color: CD_REF_TYPES[key]?.color || '#3b82f6',
      values: getScaledCdSpectrum(key, xs)
    }));
  } else if (tab === 'dna') {
    series = selectedDna.map((key) => ({
      label: key,
      color: CD_REF_TYPES[key]?.color || '#8b5cf6',
      values: getScaledCdSpectrum(key, xs)
    }));
  } else if (tab === 'gq') {
    series = selectedGq.map((key) => ({
      label: key,
      color: CD_REF_TYPES[key]?.color || '#ec4899',
      values: getScaledCdSpectrum(key, xs)
    }));
  } else {
    const r = Math.max(0, Math.min(10, Number(ratio) || 0));
    const B = getScaledCdSpectrum('B-DNA', xs);
    const Z = getScaledCdSpectrum('Z-DNA', xs);
    const alpha = getScaledCdSpectrum('Alpha-helix', xs);
    const beta = getScaledCdSpectrum('Beta-sheet', xs);
    const coil = getScaledCdSpectrum('Random Coil', xs);
    const mix = (parts) => xs.map((_, i) => parts.reduce((sum, [arr, weight]) => sum + (arr[i] || 0) * (weight || 0), 0));
    const bound01 = Math.min(r, 1);
    const excess = Math.max(r - 1, 0);
    const free = Math.max(1 - r, 0);
    let values = [];
    let label = '';
    switch (tab) {
      case 'dnaPepAlpha':
        values = mix([[B, 1], [alpha, bound01], [coil, excess]]);
        label = `DNA + α-peptide (P/D ${r.toFixed(1)})`;
        break;
      case 'dnaPepBeta':
        values = mix([[B, 1], [beta, bound01], [coil, excess]]);
        label = `DNA + β-peptide (P/D ${r.toFixed(1)})`;
        break;
      case 'dnaPepAlphaZ':
        values = mix([[B, 1 - bound01], [Z, bound01], [alpha, bound01], [coil, excess]]);
        label = `DNA B→Z + α-peptide (P/D ${r.toFixed(1)})`;
        break;
      case 'dnaPepBetaZ':
        values = mix([[B, 1 - bound01], [Z, bound01], [beta, bound01], [coil, excess]]);
        label = `DNA B→Z + β-peptide (P/D ${r.toFixed(1)})`;
        break;
      case 'pepDnaAlpha':
        values = mix([[alpha, bound01], [coil, free], [B, r]]);
        label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`;
        break;
      case 'pepDnaBeta':
        values = mix([[beta, bound01], [coil, free], [B, r]]);
        label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`;
        break;
      case 'pepDnaAlphaZ':
        values = mix([[alpha, bound01], [coil, free], [Z, bound01], [B, Math.max(r - 1, 0)]]);
        label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`;
        break;
      case 'pepDnaBetaZ':
        values = mix([[beta, bound01], [coil, free], [Z, bound01], [B, Math.max(r - 1, 0)]]);
        label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`;
        break;
      default:
        values = xs.map(() => 0);
        label = 'Unknown simulation';
    }
    series = [{ label, color: '#7c3aed', values }];
  }
  if (normalize) series = normalizeCdSeries(series);
  return { xs, series, domain };
};

const CDSpectraLibrary = ({ isExpanded, onToggleExpand }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height } = useElementSize(wrapRef);
  const [tab, setTab] = useState('protein');
  const [selectedProtein, setSelectedProtein] = useState(['Alpha-helix', 'Beta-sheet', 'Random Coil']);
  const [selectedDna, setSelectedDna] = useState(['B-DNA']);
  const [selectedGq, setSelectedGq] = useState(['G-Quad (Parallel)']);
  const [ratio, setRatio] = useState(0);
  const [normalize, setNormalize] = useState(true);

  const proteinTypes = ['Alpha-helix', 'Beta-sheet', 'Turn', 'Random Coil'];
  const dnaTypes = ['A-DNA', 'B-DNA', 'Z-DNA'];
  const gqTypes = ['G-Quad (Parallel)', 'G-Quad (Hybrid)', 'G-Quad (Antiparallel)'];
  const isSim = Boolean(CD_SIM_INFO[tab]);

  const plotData = useMemo(
    () => buildCdLibraryData({ tab, selectedProtein, selectedDna, selectedGq, ratio, normalize }),
    [tab, selectedProtein, selectedDna, selectedGq, ratio, normalize]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 80 || height < 80) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = width;
    const H = height;
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);
    if (!plotData.series.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select at least one spectrum', W / 2, H / 2);
      return;
    }
    const allValues = plotData.series.flatMap((s) => s.values);
    let yMin = Math.min(...allValues);
    let yMax = Math.max(...allValues);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -1; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yMargin = (yMax - yMin) * 0.1;
    yMin -= yMargin;
    yMax += yMargin;
    const xMin = plotData.domain.min;
    const xMax = plotData.domain.max;
    const xTickStep = xMax - xMin > 100 ? 20 : 10;
    const yTickStep = niceCdStep(yMax - yMin);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let x = Math.ceil(xMin / xTickStep) * xTickStep; x <= xMax; x += xTickStep) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke();
    }
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(pad.left + plotW, py); ctx.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(pad.left + plotW, zeroY); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();
    plotData.series.forEach((s) => {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      plotData.xs.forEach((x, i) => {
        const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
        const py = pad.top + plotH - ((s.values[i] - yMin) / (yMax - yMin)) * plotH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });
    ctx.restore();
    ctx.font = '10px sans-serif';
    plotData.series.forEach((s, idx) => {
      const lx = pad.left + 10;
      const ly = pad.top + 15 + idx * 14;
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 6, 12, 3);
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, lx + 16, ly - 2);
    });
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (let x = Math.ceil(xMin / xTickStep) * xTickStep; x <= xMax; x += xTickStep) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx.fillText(x.toString(), px, pad.top + plotH + 15);
    }
    ctx.fillText('Wavelength (nm)', pad.left + plotW / 2, H - 5);
    const fmtY = (v) => {
      if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return `${Math.round(v)}`;
    };
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.fillText(fmtY(y), pad.left - 5, py + 4);
    }
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(normalize ? 'Normalized CD (a.u.)' : 'CD (a.u.)', 0, 0);
    ctx.restore();
  }, [plotData, width, height, normalize]);

  const toggleInArray = (setter, value) => {
    setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? ` ${FS_CLASSES} p-6` : 'break-inside-avoid p-4'}`}>
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2">
          <span>📚</span> CD Spectra Reference Library & Simulator
        </h4>
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">
          {isExpanded ? '↙️' : '↗️'}
        </button>
      </div>
      <div className="flex flex-col xl:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap gap-1 mb-2">
            {CD_LIBRARY_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  if (CD_SIM_INFO[t.id]) setRatio(0);
                }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${tab === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div ref={wrapRef} className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${isExpanded ? 'flex-1 min-h-0' : 'h-[380px]'}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
        <div className="w-full xl:w-72 flex flex-col gap-3 shrink-0 overflow-y-auto custom-scrollbar">
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
            Normalize spectra for display
          </label>
          {tab === 'protein' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Protein Structures</div>
              {proteinTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedProtein.includes(t)} onChange={() => toggleInArray(setSelectedProtein, t)} className="w-3 h-3 accent-blue-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_REF_TYPES[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{t}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'dna' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">DNA Helices</div>
              {dnaTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedDna.includes(t)} onChange={() => toggleInArray(setSelectedDna, t)} className="w-3 h-3 accent-purple-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_REF_TYPES[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{t}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'gq' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">G-Quadruplexes</div>
              {gqTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedGq.includes(t)} onChange={() => toggleInArray(setSelectedGq, t)} className="w-3 h-3 accent-pink-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_REF_TYPES[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{t}</span>
                </label>
              ))}
            </div>
          )}
          {isSim && (
            <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">{CD_SIM_INFO[tab].ratioLabel}</div>
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Ratio</span>
                <span className="font-mono">{ratio.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={ratio}
                onChange={(e) => setRatio(parseFloat(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <p className="text-[10px] leading-4 text-slate-500">{CD_SIM_INFO[tab].description}</p>
            </div>
          )}
          <button
            onClick={() => {
              setSelectedProtein(['Alpha-helix', 'Beta-sheet', 'Random Coil']);
              setSelectedDna(['B-DNA']);
              setSelectedGq(['G-Quad (Parallel)']);
              setRatio(0);
              setNormalize(true);
            }}
            className="mt-2 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors"
          >
            Reset Selection
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
CONDITION PLOT PANEL — fitting + errors + graphical parameters (per plot)
========================================================================== */
const ConditionPlotPanel = ({ ctx, d, plot, updatePlot, removePlot, duplicatePlot }) => {
  const { activeTest, updateActiveTest } = ctx;
  const cfg = { ...FIT_DEFAULT_CHART_CFG, ...(plot.chartCfg || {}) };
  const [seriesSearch, setSeriesSearch] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [hVal, setHVal] = useState('');
  const [hLab, setHLab] = useState('');

  const isHist = (plot.chartType || 'line') === 'hist';
  const set = (patch) => updatePlot(plot.id, patch);
  const setCfg = (patch) => updatePlot(plot.id, { chartCfg: { ...cfg, ...patch } });
  const plotLayer = d.layers.find((l) => l.key === plot.layerKey) || d.layers[0];

  const filtered = d.seriesOptions.filter(
    (o) => !seriesSearch.trim() || o.label.toLowerCase().includes(seriesSearch.toLowerCase())
  );
  const toggleSeries = (key) =>
    set({ seriesKeys: plot.seriesKeys.includes(key) ? plot.seriesKeys.filter((k) => k !== key) : [...plot.seriesKeys, key] });
  const selectAllFiltered = () =>
    set({ seriesKeys: Array.from(new Set([...plot.seriesKeys, ...filtered.map((o) => o.key)])) });

  const presets = Array.isArray(activeTest.seriesSelectionPresets) ? activeTest.seriesSelectionPresets : [];
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || plot.seriesKeys.length === 0) return;
    updateActiveTest({
      seriesSelectionPresets: [...presets, { id: makePlotId(), name, keys: [...plot.seriesKeys] }]
    });
    setPresetName('');
  };
  const applyPreset = (id) => {
    const p = presets.find((x) => x.id === id);
    if (p) set({ seriesKeys: [...(p.keys || [])] });
  };
  const deletePreset = (id) =>
    updateActiveTest({ seriesSelectionPresets: presets.filter((x) => x.id !== id) });

  // Build series: for each selected spectrum key, collect values across instances
  const seriesData = useMemo(() => plot.seriesKeys.map((sk) => {
    const opt = d.seriesOptions.find((o) => o.key === sk);
    const pts = [];
    d.instances.forEach((inst) => {
      const v = parseManual(getLayerValues(inst, plot.layerKey)[sk]);
      if (v === null) return;
      pts.push({
        instId: inst.id,
        name: inst.name,
        x: parseManual(inst.xValue),
        y: v,
        excluded: !!(plot.excluded[sk] && plot.excluded[sk][inst.id])
      });
    });
    return { key: sk, label: opt ? opt.label : sk, pts };
  }), [plot.seriesKeys, plot.layerKey, d.instances, d.seriesOptions, plot.excluded]);

  const colorOf = (s) =>
    LINE_COLORS[Math.max(0, seriesData.findIndex((q) => q.key === s.key)) % LINE_COLORS.length];
  const includedPts = (s) => s.pts.filter((p) => !p.excluded);
  const maxOf = (s) => {
    const v = includedPts(s).map((p) => p.y);
    return v.length ? Math.max(...v) : null;
  };

  const effSD = (sKey, p) => {
    const man = (plot.manualSD[sKey] || {})[p.instId];
    if (typeof man === 'number' && Number.isFinite(man)) return man;
    if (plot.useFixedSD) {
      const f = parseManual(plot.fixedSDStr);
      if (f !== null) return f;
    }
    return null;
  };

  const fitOf = (s) => {
    if (!plot.fitEnabled || plot.xMode !== 'numeric') return null;
    const wpts = includedPts(s)
      .filter((p) => p.x !== null)
      .map((p) => {
        const sd = effSD(s.key, p);
        return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1 };
      });
    if (wpts.length < 2) return null;
    if (plot.fitModel === 'linear') return fitLinear(wpts);
    if (plot.fitModel === '4pl') return fit4PL(wpts);
    if (plot.fitModel === 'custom' && plot.customExpr) return fitCustomEquation(plot.customExpr, wpts);
    return null;
  };

  const fits = useMemo(() => {
    const out = {};
    seriesData.forEach((s) => { out[s.key] = fitOf(s); });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesData, plot.fitEnabled, plot.fitModel, plot.customExpr, plot.xMode, plot.manualSD, plot.useFixedSD, plot.fixedSDStr, plot.excluded]);

  const setManualSD = (sKey, instId, val) => {
    const inner = { ...(plot.manualSD[sKey] || {}) };
    const n = parseManual(val);
    if (n === null) delete inner[instId];
    else inner[instId] = n;
    set({ manualSD: { ...plot.manualSD, [sKey]: inner } });
  };

  const toggleExclude = (sKey, instId) => {
    const inner = { ...(plot.excluded[sKey] || {}) };
    if (inner[instId]) delete inner[instId];
    else inner[instId] = true;
    set({ excluded: { ...plot.excluded, [sKey]: inner } });
  };

  const autoTouch = (s) => {
    const fit = fits[s.key] || fitOf(s);
    if (!fit || !fit.f) return;
    const inner = { ...(plot.manualSD[s.key] || {}) };
    includedPts(s).forEach((p) => {
      if (p.x === null) return;
      inner[p.instId] = Math.ceil((Math.abs(p.y - fit.f(p.x)) * 1.02 + 0.01) * 100) / 100;
    });
    set({ manualSD: { ...plot.manualSD, [s.key]: inner } });
  };

  const resetSD = (sKey) => {
    const next = { ...plot.manualSD };
    delete next[sKey];
    set({ manualSD: next });
  };

  const cleanOutliers = (target) => {
    const thresh = parseManual(plot.outlierThreshStr) || 2.5;
    const excluded = JSON.parse(JSON.stringify(plot.excluded || {}));
    const proc = (s) => {
      for (let it = 0; it < 20; it++) {
        const pts = s.pts.filter((p) => !((excluded[s.key] || {})[p.instId]) && p.x !== null);
        if (pts.length < 4) break;
        const wpts = pts.map((p) => {
          const sd = effSD(s.key, p);
          return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1, p };
        });
        const fit =
          plot.fitModel === 'linear' ? fitLinear(wpts)
            : plot.fitModel === '4pl' ? fit4PL(wpts)
              : fitCustomEquation(plot.customExpr, wpts);
        if (!fit || !fit.f) break;
        let worst = null;
        let maxR = 0;
        wpts.forEach((q) => {
          const sd = effSD(s.key, q.p);
          const err = sd && sd > 0 ? sd : 1;
          const ratio = Math.abs(q.p.y - fit.f(q.p.x)) / err;
          if (ratio > thresh && ratio > maxR) { maxR = ratio; worst = q.p; }
        });
        if (!worst) break;
        excluded[s.key] = { ...(excluded[s.key] || {}), [worst.instId]: true };
      }
    };
    (target ? [target] : seriesData).forEach(proc);
    set({ excluded });
  };

  const restoreExcluded = () => set({ excluded: {} });

  const catData = useMemo(() => {
    if (plot.xMode !== 'category') return [];
    return d.instances.map((inst) => {
      const row = { __condition: inst.name };
      seriesData.forEach((s) => {
        const p = s.pts.find((q) => q.instId === inst.id);
        if (p && !p.excluded) {
          row[s.key] = p.y;
          row[`${s.key}__sd`] = effSD(s.key, p);
        } else {
          row[s.key] = null;
          row[`${s.key}__sd`] = null;
        }
      });
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.instances, seriesData, plot.xMode, plot.manualSD, plot.useFixedSD, plot.fixedSDStr, plot.excluded]);

  const numData = (s) =>
    includedPts(s).filter((p) => p.x !== null).map((p) => ({ x: p.x, y: p.y, sd: effSD(s.key, p), name: p.name }));

  const fitData = (s) => {
    const fit = fits[s.key];
    if (!fit || !fit.f) return [];
    const xs = includedPts(s).filter((p) => p.x !== null).map((p) => p.x);
    if (xs.length < 2) return [];
    const mn = Math.min(...xs);
    const mx = Math.max(...xs);
    if (!(mx > mn)) return [];
    const out = [];
    for (let i = 0; i <= 60; i++) {
      const x = mn + ((mx - mn) * i) / 60;
      out.push({ x, y: fit.f(x) });
    }
    return out;
  };

  const makeDot = (color, s) => (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={`d-${s.key}-${index}`} />;
    const r = cfg.ptSize || 5;
    let el;
    if (cfg.ptStyle === 'square') el = <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />;
    else if (cfg.ptStyle === 'triangle') el = <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={color} />;
    else if (cfg.ptStyle === 'cross') {
      el = (
        <g>
          <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={2} />
          <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={2} />
        </g>
      );
    } else el = <circle cx={cx} cy={cy} r={r} fill={color} />;
    return <g key={`d-${s.key}-${index}`}>{el}</g>;
  };

  const visibleSeries = seriesData.filter((s) => !plot.hiddenSeries[s.key]);
  const xLab = cfg.xAxisLabel || (plot.xMode === 'numeric' ? 'Condition value (X)' : 'Condition (instance)');
  const yLab = cfg.yAxisLabel || `${plotLayer.label}${plotLayer.unit ? ` (${plotLayer.unit})` : ''}`;
  const dom = (v) => (v === '' || v == null || parseManual(v) === null ? undefined : parseManual(v));

  const refLines = (
    <>
      {plot.showMaxLines && visibleSeries.map((s) => {
        const m = maxOf(s);
        if (m === null) return null;
        const c = colorOf(s);
        return (
          <ReferenceLine
            key={`mx-${s.key}`}
            y={m}
            stroke={c}
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{ value: `max ${s.label} = ${m.toFixed(2)}`, fill: c, fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }}
          />
        );
      })}
      {(plot.hLines || []).map((h) => {
        const v = parseManual(h.value);
        if (v === null) return null;
        return (
          <ReferenceLine
            key={h.id}
            y={v}
            stroke={h.color || '#64748b'}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{ value: h.label || `y=${v}`, fill: h.color || '#64748b', fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }}
          />
        );
      })}
    </>
  );

  return (
    <CollapsibleSection
      title={plot.title}
      icon="📈"
      defaultOpen={true}
      headerExtra={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const nn = window.prompt('Rename plot:', plot.title); if (nn && nn.trim()) set({ title: nn.trim() }); }} className="text-slate-400 hover:text-blue-600" title="Rename">✏️</button>
          <button type="button" onClick={() => duplicatePlot(plot)} className="text-slate-400 hover:text-blue-600" title="Duplicate">⧉</button>
          <button type="button" onClick={() => removePlot(plot.id)} className="text-slate-400 hover:text-red-500" title="Remove">×</button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Plot configuration bar */}
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter (Y)</label>
            <select value={plot.layerKey} onChange={(e) => set({ layerKey: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {d.layers.map((l) => <option key={l.key} value={l.key}>{l.label}{l.unit ? ` (${l.unit})` : ''}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">X axis</label>
            <select value={plot.xMode} onChange={(e) => set({ xMode: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="category">Instance name (category)</option>
              <option value="numeric">Numeric X (instance X value)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Type</label>
            <select value={plot.chartType || 'line'} onChange={(e) => set({ chartType: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="line">Line / Scatter</option>
              <option value="hist">Histogram</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 cursor-pointer">
            <input type="checkbox" checked={plot.fitEnabled} onChange={(e) => set({ fitEnabled: e.target.checked })} className="w-4 h-4 accent-blue-600" />
            Fit curve
          </label>
          {plot.fitEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
              <div className="flex gap-2 items-center">
                <select value={plot.fitModel} onChange={(e) => set({ fitModel: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                  <option value="linear">Linear (weighted)</option>
                  <option value="4pl">4PL logistic (weighted)</option>
                  <option value="custom">Custom Equation</option>
                </select>
                {plot.fitModel === 'custom' && (
                  <input
                    type="text"
                    value={plot.customExpr || ''}
                    onChange={(e) => set({ customExpr: e.target.value })}
                    placeholder="e.g. a*exp(-b*x) + c"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 w-44 bg-white"
                  />
                )}
              </div>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setShowErr(!showErr)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showErr ? 'bg-orange-100 border-orange-400 text-orange-800' : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-50'}`}>⚠️ Error Management</button>
            <button type="button" onClick={() => setShowCfg(!showCfg)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>🎨 Graphical Parameters</button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Series selector */}
          <div className="w-full lg:w-80 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-bold text-slate-600 uppercase">Spectra to plot</label>
              <button type="button" onClick={selectAllFiltered} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded">☑ Select all (filtered)</button>
              <button type="button" onClick={() => set({ seriesKeys: [] })} className="text-[10px] font-bold text-red-500 hover:text-red-700 underline">Clear</button>
            </div>
            <input
              type="text"
              value={seriesSearch}
              onChange={(e) => setSeriesSearch(e.target.value)}
              placeholder="Search spectrum (e.g. Spectrum 1)…"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white"
            />
            <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto custom-scrollbar bg-white">
              {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 italic">No spectra (add spectra in Setup → CD Data Input).</div>}
              {filtered.map((o) => (
                <label key={o.key} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0">
                  <input type="checkbox" checked={plot.seriesKeys.includes(o.key)} onChange={() => toggleSeries(o.key)} className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs text-slate-700">{o.label}</span>
                </label>
              ))}
            </div>
            {plot.seriesKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {seriesData.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: colorOf(s) }}>
                    {s.label}
                    <button type="button" onClick={() => toggleSeries(s.key)} className="hover:text-red-200 font-black">×</button>
                  </span>
                ))}
              </div>
            )}
            {/* Presets */}
            <div className="flex flex-wrap gap-2 items-end pt-1 border-t border-slate-100">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Save current selection as</label>
                <div className="flex gap-1">
                  <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Selection name" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-36 outline-none focus:border-blue-500 bg-white" />
                  <button type="button" onClick={savePreset} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1.5 rounded-lg text-xs">💾 Save</button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Load saved selection</label>
                <select value="" onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
                  <option value="">-- Select --</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({(p.keys || []).length})</option>)}
                </select>
              </div>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {p.name}
                    <button type="button" onClick={() => deletePreset(p.id)} className="text-indigo-400 hover:text-red-600 font-black" title="Delete preset">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Chart area */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {visibleSeries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {seriesData.map((s) => (
                  <label key={s.key} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!plot.hiddenSeries[s.key]} onChange={() => set({ hiddenSeries: { ...plot.hiddenSeries, [s.key]: !plot.hiddenSeries[s.key] } })} className="w-3.5 h-3.5 accent-blue-600" />
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: colorOf(s) }} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
            {seriesData.length === 0 ? (
              <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
                Select at least one spectrum to plot. Fill its values in Setup → Condition Values.
              </div>
            ) : (
              <div style={{ height: cfg.height }} className="bg-white border border-slate-200 rounded-xl p-3">
                <ResponsiveContainer width="100%" height="100%">
                  {isHist ? (
                    <BarChart data={plot.xMode === 'category' ? catData : numData(seriesData[0])} margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      {plot.xMode === 'category' ? (
                        <XAxis dataKey="__condition" tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} tickMargin={10} label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      ) : (
                        <XAxis type="number" dataKey="x" domain={[dom(cfg.xMin) ?? 'auto', dom(cfg.xMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} tickMargin={10} label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      )}
                      <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      <Tooltip />
                      {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                      {refLines}
                      {visibleSeries.map((s) => {
                        const color = colorOf(s);
                        return (
                          <Bar key={s.key} dataKey={plot.xMode === 'category' ? s.key : 'y'} name={s.label} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                            {HAS_EB && plot.showErrors && <ErrorBar dataKey={plot.xMode === 'category' ? `${s.key}__sd` : 'sd'} width={4} strokeWidth={1} direction="y" color={color} />}
                          </Bar>
                        );
                      })}
                    </BarChart>
                  ) : (
                    <LineChart data={plot.xMode === 'category' ? catData : undefined} margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      {plot.xMode === 'category' ? (
                        <XAxis dataKey="__condition" tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} tickMargin={10} label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      ) : (
                        <XAxis type="number" dataKey="x" domain={[dom(cfg.xMin) ?? 'auto', dom(cfg.xMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} tickMargin={10} label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      )}
                      <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                      <Tooltip />
                      {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                      {refLines}
                      {visibleSeries.map((s) => {
                        const color = colorOf(s);
                        return (
                          <React.Fragment key={s.key}>
                            <Line
                              data={plot.xMode === 'numeric' ? numData(s) : undefined}
                              type="monotone"
                              dataKey={plot.xMode === 'numeric' ? 'y' : s.key}
                              name={s.label}
                              stroke={color}
                              strokeWidth={cfg.lineThickness || 2}
                              strokeDasharray={lineDash(cfg.lineStyle)}
                              dot={plot.showPoints ? makeDot(color, s) : false}
                              connectNulls
                              isAnimationActive={false}
                            >
                              {HAS_EB && plot.showErrors && <ErrorBar dataKey={plot.xMode === 'category' ? `${s.key}__sd` : 'sd'} width={4} strokeWidth={1} direction="y" color={color} />}
                            </Line>
                            {plot.xMode === 'numeric' && plot.fitEnabled && plot.showFit && fits[s.key] && (
                              <Line data={fitData(s)} type="monotone" dataKey="y" name={`${s.label} (fit)`} stroke={color} strokeWidth={1.5} strokeDasharray="8 4" dot={false} legendType="none" isAnimationActive={false} />
                            )}
                          </React.Fragment>
                        );
                      })}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}

            {plot.fitEnabled && plot.xMode !== 'numeric' && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                ⚠️ Fitting requires X axis = “Numeric X”. Set numeric X values for the instances in Setup → Conditions / Instances.
              </p>
            )}

            {/* Fit results table */}
            {plot.fitEnabled && plot.xMode === 'numeric' && seriesData.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left bg-white">
                  <thead className="bg-slate-100 text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Series</th>
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2">Parameters (weighted)</th>
                      <th className="px-3 py-2">SE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {seriesData.map((s) => {
                      const f = fits[s.key];
                      return (
                        <tr key={s.key}>
                          <td className="px-3 py-1.5 font-bold text-slate-700">{s.label}</td>
                          <td className="px-3 py-1.5">{f ? (plot.fitModel === 'linear' ? 'Linear' : plot.fitModel === '4pl' ? '4PL' : 'Custom') : '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-slate-600">
                            {f
                              ? plot.fitModel === 'linear'
                                ? `slope=${f.slope.toFixed(4)}; intercept=${f.intercept.toFixed(4)}; R²=${f.r2.toFixed(3)}`
                                : plot.fitModel === '4pl'
                                  ? `Top=${f.top.toFixed(3)}; Bottom=${f.bottom.toFixed(3)}; EC50=${f.ic50.toFixed(3)}; Hill=${f.hill.toFixed(3)}; R²=${f.r2.toFixed(3)}`
                                  : `${Object.entries(f.params || {}).map(([k, v]) => `${k}=${v.toFixed(4)}`).join('; ')}; R²=${f.r2.toFixed(3)}`
                              : 'not enough points / missing X'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-600">{f ? (f.se ?? 0).toFixed(3) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Error management */}
        {showErr && (
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={plot.useFixedSD} onChange={(e) => set({ useFixedSD: e.target.checked })} className="w-4 h-4 accent-blue-600" />
                Fixed SD ±
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={plot.fixedSDStr}
                onChange={(e) => set({ fixedSDStr: e.target.value })}
                disabled={!plot.useFixedSD}
                className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none ${plot.useFixedSD ? 'bg-white font-bold text-blue-700' : 'bg-slate-100 text-slate-400'}`}
              />
              <label className="text-xs font-bold text-slate-600">Outlier threshold (×SD):</label>
              <input type="number" step="0.1" min="0.1" value={plot.outlierThreshStr} onChange={(e) => set({ outlierThreshStr: e.target.value })} className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none" />
              <button type="button" onClick={() => cleanOutliers(null)} className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-black py-1.5 px-3 rounded-lg text-xs shadow-sm">🧹 Clean Outliers (all)</button>
              <button type="button" onClick={restoreExcluded} className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold py-1.5 px-3 rounded-md shadow-sm">↩️ Restore excluded</button>
            </div>
            {seriesData.map((s) => (
              <div key={s.key} className="bg-white rounded-lg border border-orange-200 p-3">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="text-sm font-bold text-slate-800">{s.label}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => autoTouch(s)} className="text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold shadow-sm">🎯 Auto-Touch SD</button>
                    <button type="button" onClick={() => cleanOutliers(s)} className="text-xs text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-2 py-1 rounded font-bold shadow-sm">🧹 Clean</button>
                    <button type="button" onClick={() => resetSD(s.key)} className="text-xs text-orange-600 hover:underline font-bold">🔄 Reset SD</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.pts.length === 0 && <span className="text-xs text-slate-400 italic">No values for this spectrum.</span>}
                  {s.pts.map((p) => {
                    const sd = effSD(s.key, p);
                    return (
                      <div key={p.instId} className={`flex flex-col gap-1 p-1.5 rounded border ${p.excluded ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                        <span className="text-[9px] font-bold text-slate-500">{p.name}{p.x !== null ? ` (x=${p.x})` : ''}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-mono ${p.excluded ? 'line-through text-slate-400' : 'text-slate-700'}`}>{p.y}</span>
                          <input
                            type="number"
                            step="0.01"
                            value={(plot.manualSD[s.key] || {})[p.instId] ?? ''}
                            onChange={(e) => setManualSD(s.key, p.instId, e.target.value)}
                            placeholder="±SD"
                            className="w-14 text-[10px] border border-slate-300 rounded p-0.5 text-center outline-none focus:border-orange-500"
                          />
                          <button type="button" onClick={() => toggleExclude(s.key, p.instId)} className={`text-[10px] font-black px-1 ${p.excluded ? 'text-red-600' : 'text-slate-400 hover:text-red-500'}`} title="Exclude / include point">
                            {p.excluded ? 'EXCL' : '×'}
                          </button>
                        </div>
                        {sd != null && <span className="text-[9px] text-orange-700 font-bold">± {sd}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Graphical parameters */}
        {showCfg && (
          <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Chart height (px): {cfg.height}</label>
              <input type="range" min="220" max="800" step="20" value={cfg.height} onChange={(e) => setCfg({ height: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-2" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Point size</label>
              <input type="number" value={cfg.ptSize} onChange={(e) => setCfg({ ptSize: parseFloat(e.target.value) || 4 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Point style</label>
              <select value={cfg.ptStyle} onChange={(e) => setCfg({ ptStyle: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none">
                {['circle', 'square', 'triangle', 'cross'].map((s2) => <option key={s2} value={s2}>{s2}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Line style</label>
              <select value={cfg.lineStyle} onChange={(e) => setCfg({ lineStyle: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none">
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Line thickness</label>
              <input type="number" value={cfg.lineThickness} onChange={(e) => setCfg({ lineThickness: parseFloat(e.target.value) || 2 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Font size</label>
              <input type="number" value={cfg.fontSize} onChange={(e) => setCfg({ fontSize: parseFloat(e.target.value) || 12 })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Legend</label>
              <select value={cfg.legend} onChange={(e) => setCfg({ legend: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none">
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="none">None</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Show</label>
              <div className="flex gap-2 text-[10px] font-bold text-slate-700">
                <label className="flex items-center gap-1"><input type="checkbox" checked={plot.showPoints} onChange={(e) => set({ showPoints: e.target.checked })} className="accent-blue-600" />Pts</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={plot.showErrors} onChange={(e) => set({ showErrors: e.target.checked })} className="accent-blue-600" />±SD</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={plot.showFit} onChange={(e) => set({ showFit: e.target.checked })} className="accent-blue-600" />Fit</label>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
              <div className="flex gap-1">
                <input type="number" placeholder="auto" value={cfg.xMin} onChange={(e) => setCfg({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
                <input type="number" placeholder="auto" value={cfg.xMax} onChange={(e) => setCfg({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
              <div className="flex gap-1">
                <input type="number" placeholder="auto" value={cfg.yMin} onChange={(e) => setCfg({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
                <input type="number" placeholder="auto" value={cfg.yMax} onChange={(e) => setCfg({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">X axis label</label>
              <input type="text" value={cfg.xAxisLabel} onChange={(e) => setCfg({ xAxisLabel: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-600">Y axis label</label>
              <input type="text" value={cfg.yAxisLabel} onChange={(e) => setCfg({ yAxisLabel: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
            </div>
            <div className="col-span-2 lg:col-span-4 flex flex-col gap-2 mt-2 pt-3 border-t border-slate-100">
              <label className="text-[10px] font-bold text-slate-600 uppercase">Horizontal Lines</label>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={plot.showMaxLines || false} onChange={(e) => set({ showMaxLines: e.target.checked })} className="accent-blue-600" />
                  Auto-show Max Y
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" step="any" placeholder="Value (Y)" value={hVal} onChange={(e) => setHVal(e.target.value)} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none w-20" />
                  <input type="text" placeholder="Label (optional)" value={hLab} onChange={(e) => setHLab(e.target.value)} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none w-32" />
                  <button
                    type="button"
                    onClick={() => {
                      if (parseManual(hVal) === null) return;
                      set({
                        hLines: [...(plot.hLines || []), {
                          id: makePlotId(),
                          value: parseManual(hVal),
                          label: hLab || `y=${hVal}`,
                          color: LINE_COLORS[(plot.hLines || []).length % 10]
                        }]
                      });
                      setHVal('');
                      setHLab('');
                    }}
                    className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold px-2 py-1.5 rounded-md"
                  >
                    Add Line
                  </button>
                </div>
              </div>
              {(plot.hLines || []).length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {(plot.hLines || []).map((h) => (
                    <span key={h.id} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full text-white" style={{ backgroundColor: h.color }}>
                      {h.label} ({h.value})
                      <button type="button" onClick={() => set({ hLines: plot.hLines.filter((x) => x.id !== h.id) })} className="hover:text-red-200 font-black ml-1">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

/* ============================================================================
SECTION COMPONENTS
========================================================================== */

// ================= TOOLBAR (Export XLS / Export PDF) =================
export const Toolbar = ({ ctx }) => {
  const { activeTest } = ctx;
  const barRef = useRef(null);

  const exportXLS = () => {
    try {
      const compound = activeTest.compound || '';
      const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;
      const instances = getInstances(activeTest);
      const layers = getLayers(activeTest);
      const titrationVariables = Array.isArray(activeTest.titrationVariables)
        ? activeTest.titrationVariables
        : ['Ratio', 'Concentration', 'Temperature'];
      const titrationRows = activeTest.titrationRows || [];

      const wb = XLSX.utils.book_new();
      const usedNames = new Set();
      const sheetSafe = (s) => (s || 'Sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
      const uniqueSheet = (base) => {
        let n = sheetSafe(base);
        let i = 2;
        while (usedNames.has(n)) { n = sheetSafe(`${base}_${i}`); i++; }
        usedNames.add(n);
        return n;
      };

      // One sheet per instance (condition)
      instances.forEach((inst, ii) => {
        const { parsedWavelengths, parsedSpectra } = computeParsed(inst);
        const wlAoa = [['Wavelength (nm)', ...parsedSpectra.map((s) => s.title)]];
        parsedWavelengths.forEach((w, i) => {
          const row = [w];
          parsedSpectra.forEach((s) => row.push(s.values[i] !== undefined ? s.values[i] : ''));
          wlAoa.push(row);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wlAoa), uniqueSheet(`CD ${inst.name || ii + 1}`));
      });

      // Condition values (all layers)
      const valAoa = [['Instance (Condition)', 'X (numeric)', 'Parameter', 'Spectrum', 'Value']];
      instances.forEach((inst) => {
        layers.forEach((l) => {
          const vals = getLayerValues(inst, l.key);
          Object.entries(vals).forEach(([k, v]) => {
            if (v === '' || v == null) return;
            const specId = String(k).replace(/^spec-/, '');
            const col = (inst.spectraColumns || []).find((c) => String(c.id) === specId);
            valAoa.push([inst.name, inst.xValue || '', l.label, col ? col.title : k, v]);
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(valAoa), uniqueSheet('Condition Values'));

      // Structure
      const structAoa = [['Structure', 'Percentage (%)']];
      Object.entries(structureComposition).forEach(([k, v]) => structAoa.push([k, v]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(structAoa), uniqueSheet('Structure'));

      // Experimental variables
      if (titrationRows.length > 0) {
        const titrationAoa = [['Point', ...titrationVariables, 'Notes']];
        titrationRows.forEach((row, idx) => {
          titrationAoa.push([
            idx + 1,
            ...titrationVariables.map((v) => (row.values || {})[v] || ''),
            row.notes || ''
          ]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(titrationAoa), uniqueSheet('Experimental Variables'));
      }

      const fname = `CD_${(compound || 'experiment').replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.error(e);
      alert(`Export Failed: ${e.message}`);
    }
  };

  const exportPDF = async () => {
    const bar = barRef.current;
    const el = bar ? bar.closest('.h-full') : null;
    if (!el) return;
    const scroller = el.querySelector('.overflow-y-auto');
    const origElOverflow = el.style.overflow;
    const origElHeight = el.style.height;
    const origScrollerOverflow = scroller ? scroller.style.overflow : '';
    const origScrollerHeight = scroller ? scroller.style.height : '';
    const fixedEls = document.querySelectorAll('.fixed, [style*="position: fixed"]');
    fixedEls.forEach((x) => (x.style.display = 'none'));
    const noPrintEls = el.querySelectorAll('.no-print');
    noPrintEls.forEach((x) => (x.style.display = 'none'));
    el.style.overflow = 'visible';
    el.style.height = 'auto';
    if (scroller) {
      scroller.style.overflow = 'visible';
      scroller.style.height = 'auto';
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#f8fafc',
        logging: false
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`CD_Report_${(activeTest.compound || 'experiment').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    } catch (e) {
      console.error(e);
      alert(`Export Failed: ${e.message}`);
    } finally {
      fixedEls.forEach((x) => (x.style.display = ''));
      noPrintEls.forEach((x) => (x.style.display = ''));
      el.style.overflow = origElOverflow;
      el.style.height = origElHeight;
      if (scroller) {
        scroller.style.overflow = origScrollerOverflow;
        scroller.style.height = origScrollerHeight;
      }
    }
  };

  return (
    <div ref={barRef} className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-end gap-3 shrink-0 z-10 shadow-sm no-print">
      <button
        onClick={exportXLS}
        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
      >
        📊 Export XLS
      </button>
      <button
        onClick={exportPDF}
        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
      >
        📄 Export PDF
      </button>
    </div>
  );
};

// ================= SETUP (Instances + Layers + Values + CD Data Input) =================
export const Setup = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest);

  const [newInstanceName, setNewInstanceName] = useState('');
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerUnit, setNewLayerUnit] = useState('');

  const fileInputRef = useRef(null);
  const importModeRef = useRef('replace');

  const chartCfg = activeTest.chartCfg || DEFAULT_CHART_CFG;

  const updateActiveInstance = (patch) => {
    if (!d.activeInstance) return;
    updateActiveTest({
      instances: d.instances.map((i) => (i.id === d.activeInstance.id ? { ...i, ...patch } : i))
    });
  };

  // ---------- Instances ----------
  const addInstance = () => {
    const name = newInstanceName.trim() || `Condition ${d.instances.length + 1}`;
    const src = d.activeInstance;
    const cols = (src?.spectraColumns || []).map((c) => ({ ...c, data: '' }));
    const inst = {
      id: makeInstanceId(),
      name,
      xValue: '',
      notes: '',
      wavelengthData: src?.wavelengthData || '',
      spectraColumns: cols,
      values: {}
    };
    updateActiveTest({ instances: [...d.instances, inst], activeInstanceId: inst.id });
    setNewInstanceName('');
  };

  const removeInstance = (id) => {
    if (d.instances.length <= 1) {
      alert('At least one instance (condition) is required.');
      return;
    }
    const upd = d.instances.filter((i) => i.id !== id);
    updateActiveTest({
      instances: upd,
      activeInstanceId: d.activeInstance && d.activeInstance.id === id ? upd[0].id : activeTest.activeInstanceId
    });
  };

  const renameInstance = (id) => {
    const inst = d.instances.find((i) => i.id === id);
    const nn = window.prompt('Rename condition:', inst ? inst.name : '');
    if (nn && nn.trim()) {
      updateActiveTest({
        instances: d.instances.map((i) => (i.id === id ? { ...i, name: nn.trim() } : i))
      });
    }
  };

  const duplicateInstance = (inst) => {
    const copy = {
      ...JSON.parse(JSON.stringify(inst)),
      id: makeInstanceId(),
      name: `${inst.name} (copy)`
    };
    updateActiveTest({ instances: [...d.instances, copy], activeInstanceId: copy.id });
  };

  // ---------- Layers ----------
  const addLayer = () => {
    const label = newLayerName.trim();
    if (!label) return;
    const layer = { key: makeLayerId(), label, unit: newLayerUnit.trim() || '' };
    updateActiveTest({
      parameterLayers: [...(activeTest.parameterLayers || []), layer],
      activeLayerKey: layer.key
    });
    setNewLayerName('');
    setNewLayerUnit('');
  };

  const removeLayer = (key) => {
    if (key === 'cd') return;
    const upd = (activeTest.parameterLayers || []).filter((l) => l.key !== key);
    updateActiveTest({
      parameterLayers: upd,
      activeLayerKey: d.activeLayerKey === key ? 'cd' : d.activeLayerKey
    });
  };

  // ---------- Values ----------
  const handleValueChange = (seriesKey, val) => {
    if (!d.activeInstance) return;
    updateActiveTest({
      instances: d.instances.map((inst) => {
        if (inst.id !== d.activeInstance.id) return inst;
        const values = { ...(inst.values || {}) };
        values[d.activeLayerKey] = { ...(values[d.activeLayerKey] || {}), [seriesKey]: val };
        return { ...inst, values };
      })
    });
  };

  const clearLayer = () => {
    if (!d.activeInstance) return;
    updateActiveTest({
      instances: d.instances.map((inst) =>
        inst.id === d.activeInstance.id
          ? { ...inst, values: { ...(inst.values || {}), [d.activeLayerKey]: {} } }
          : inst
      )
    });
  };

  const extractForInstance = (inst) => {
    const lambda = parseManual(activeTest.analysisWavelength);
    if (lambda === null) {
      alert('Set an analysis wavelength (nm) first.');
      return;
    }
    const vals = extractAtWavelength(inst, lambda);
    updateActiveTest({
      instances: d.instances.map((i) =>
        i.id === inst.id
          ? {
            ...i,
            values: {
              ...(i.values || {}),
              [d.activeLayerKey]: { ...((i.values || {})[d.activeLayerKey] || {}), ...vals }
            }
          }
          : i
      )
    });
  };

  const extractForAll = () => {
    const lambda = parseManual(activeTest.analysisWavelength);
    if (lambda === null) {
      alert('Set an analysis wavelength (nm) first.');
      return;
    }
    updateActiveTest({
      instances: d.instances.map((i) => ({
        ...i,
        values: {
          ...(i.values || {}),
          [d.activeLayerKey]: {
            ...((i.values || {})[d.activeLayerKey] || {}),
            ...extractAtWavelength(i, lambda)
          }
        }
      }))
    });
  };

  const handleRowClick = (e, key) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const cur = Array.isArray(activeTest.selectedSeriesKeys) ? activeTest.selectedSeriesKeys : [];
    updateActiveTest({
      selectedSeriesKeys: cur.length === 1 && cur[0] === key ? [] : [key]
    });
  };

  // ---------- Spectra columns (active instance) ----------
  const addSpectrumColumn = () => {
    if (!d.activeInstance) return;
    const cols = d.activeInstance.spectraColumns || [];
    const newCol = {
      id: `${Date.now()}`,
      title: `Spectrum ${cols.length + 1}`,
      data: '',
      color: SPECTRA_PALETTE[cols.length % SPECTRA_PALETTE.length],
      visible: true
    };
    updateActiveInstance({ spectraColumns: [...cols, newCol] });
  };

  const updateSpectrumColumn = (id, updates) => {
    if (!d.activeInstance) return;
    updateActiveInstance({
      spectraColumns: (d.activeInstance.spectraColumns || []).map((c) => (c.id === id ? { ...c, ...updates } : c))
    });
  };

  const removeSpectrumColumn = (id) => {
    if (!d.activeInstance) return;
    updateActiveInstance({
      spectraColumns: (d.activeInstance.spectraColumns || []).filter((c) => c.id !== id)
    });
  };

  // ---------- JASCO import (into active instance) ----------
  const triggerJascoImport = (mode) => {
    importModeRef.current = mode;
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const importJascoFiles = async (event) => {
    const input = event.target;
    const mode = importModeRef.current || 'replace';
    const files = Array.from(input.files || []);
    if (!files.length || !d.activeInstance) return;
    const imported = [];
    let baseX = null;
    let firstMeta = null;
    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseJascoCDText(text);
        if (!parsed.xs.length || !parsed.ys.length) {
          alert(`No numeric CD data found in ${file.name}.`);
          continue;
        }
        if (!baseX) {
          baseX = parsed.xs;
          firstMeta = parsed;
        } else {
          const sameX = parsed.xs.length === baseX.length && parsed.xs.every((x, i) => Math.abs(x - baseX[i]) < 0.01);
          if (!sameX) {
            alert(`Wavelength axes do not match between imported files.\nStopped before: ${file.name}`);
            break;
          }
        }
        imported.push({ file, parsed });
      } catch (err) {
        alert(`Could not read ${file.name}: ${err.message}`);
      }
    }
    if (!imported.length || !baseX) {
      input.value = '';
      return;
    }
    const inst = d.activeInstance;
    const startIndex = mode === 'append' ? (inst.spectraColumns || []).length : 0;
    const newCols = imported.map(({ file, parsed }, i) => {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const title = baseName || parsed.title || `Spectrum ${startIndex + i + 1}`;
      return {
        id: `${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`,
        title,
        data: parsed.ys.join('\n'),
        color: SPECTRA_PALETTE[(startIndex + i) % SPECTRA_PALETTE.length],
        visible: true
      };
    });

    const topPatch = {};
    const instPatch = {};
    const minX = Math.min(...baseX);
    const maxX = Math.max(...baseX);

    if (mode === 'replace' || d.parsedWavelengths.length === 0) {
      instPatch.wavelengthData = baseX.join('\n');
      instPatch.spectraColumns = newCols;
      topPatch.chartCfg = { ...chartCfg, xMin: String(minX), xMax: String(maxX) };
    } else {
      const sameAsCurrent =
        baseX.length === d.parsedWavelengths.length &&
        baseX.every((x, i) => Math.abs(x - d.parsedWavelengths[i]) < 0.01);
      if (!sameAsCurrent) {
        alert('Cannot append: imported wavelength axis does not match the current wavelength axis of this condition.\nUse Replace import or clear the current data.');
        input.value = '';
        return;
      }
      instPatch.spectraColumns = [...(inst.spectraColumns || []), ...newCols];
      const currentMin = Math.min(...d.parsedWavelengths);
      const currentMax = Math.max(...d.parsedWavelengths);
      topPatch.chartCfg = {
        ...chartCfg,
        xMin: String(Math.min(currentMin, minX)),
        xMax: String(Math.max(currentMax, maxX))
      };
    }

    if (firstMeta) {
      if (firstMeta.title && !activeTest.compound) topPatch.compound = firstMeta.title;
      if (firstMeta.experimentDate && !activeTest.experimentDate) topPatch.experimentDate = firstMeta.experimentDate;
      if (firstMeta.temperature && !activeTest.temperature) topPatch.temperature = firstMeta.temperature;
      if (firstMeta.pathLength && !activeTest.pathLength) topPatch.pathLength = firstMeta.pathLength;
      if (firstMeta.concentration && !activeTest.concentration) topPatch.concentration = firstMeta.concentration;
    }

    topPatch.instances = d.instances.map((i) => (i.id === inst.id ? { ...i, ...instPatch } : i));
    updateActiveTest(topPatch);
    input.value = '';
  };

  const manualCount = Object.values(d.activeValues).filter((v) => parseManual(v) !== null).length;

  return (
    <>
      {/* ============ CONDITIONS / INSTANCES ============ */}
      <CollapsibleSection title="Conditions / Instances" icon="🧩">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <label className="text-xs font-bold text-indigo-800 uppercase">🧩 Experimental conditions</label>
            <span className="text-[9px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded">
              Each instance = one experimental condition (e.g. temperature point, ratio, pH)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.instances.map((inst) => {
              const isActive = d.activeInstance && d.activeInstance.id === inst.id;
              return (
                <div key={inst.id} className={`flex items-center gap-1 rounded-lg px-2 py-1 border shadow-sm transition-colors ${isActive ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-indigo-300 text-indigo-900'}`}>
                  <button type="button" onClick={() => updateActiveTest({ activeInstanceId: inst.id })} className="text-xs font-bold max-w-[180px] truncate" title="Set as active condition">
                    {inst.name}
                  </button>
                  <button type="button" onClick={() => renameInstance(inst.id)} className={`text-[10px] font-bold ${isActive ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-blue-600'}`} title="Rename">✎</button>
                  <button type="button" onClick={() => duplicateInstance(inst)} className={`text-[10px] font-bold ${isActive ? 'text-indigo-200 hover:text-white' : 'text-slate-400 hover:text-blue-600'}`} title="Duplicate">⧉</button>
                  <button type="button" onClick={() => removeInstance(inst.id)} className={`text-[10px] font-bold ${isActive ? 'text-indigo-200 hover:text-red-300' : 'text-slate-400 hover:text-red-500'}`} title="Remove">×</button>
                </div>
              );
            })}
          </div>
          {d.activeInstance && (
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-indigo-700 uppercase">
                  X value of “{d.activeInstance.name}” (numeric — used for fitting):
                </label>
                <input
                  type="text"
                  value={d.activeInstance.xValue || ''}
                  onChange={(e) => updateActiveInstance({ xValue: e.target.value })}
                  className="border border-indigo-300 rounded-lg px-2 py-1 text-xs w-28 bg-white outline-none focus:border-indigo-500 font-mono"
                  placeholder="e.g. 298 / 0.5"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-indigo-700 uppercase">Notes:</label>
                <input
                  type="text"
                  value={d.activeInstance.notes || ''}
                  onChange={(e) => updateActiveInstance({ notes: e.target.value })}
                  className="border border-indigo-300 rounded-lg px-2 py-1 text-xs w-56 bg-white outline-none focus:border-indigo-500"
                  placeholder="Optional notes for this condition"
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newInstanceName}
              onChange={(e) => setNewInstanceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInstance(); } }}
              placeholder="New condition name (e.g. 25°C, Ratio 1:5, pH 7.4)"
              className="flex-1 border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500"
            />
            <button type="button" onClick={addInstance} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">
              + Add Instance
            </button>
          </div>
          <p className="text-[10px] text-indigo-600">
            💡 New instances inherit the wavelength axis and spectrum slots (titles/colors) of the active condition, so values stay aligned across conditions for fitting.
          </p>
        </div>
      </CollapsibleSection>

      {/* ============ PARAMETER LAYERS + VALUES ============ */}
      <CollapsibleSection title="Parameter Layers & Condition Values" icon="🗂️">
        <div className="flex flex-col gap-5">
          {/* Layers */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-600 uppercase">Parameter layer (values table data type)</label>
              <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Switch between CD Signal & user-defined parameters</span>
            </div>
            <div className="flex flex-wrap gap-2 items-center mb-3">
              {d.layers.map((l) => (
                <div key={l.key} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => updateActiveTest({ activeLayerKey: l.key })}
                    className={`px-3 py-1.5 rounded-l-lg text-xs font-bold border transition-colors ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {l.label}{l.unit ? ` (${l.unit})` : ''}
                  </button>
                  {!l.builtin ? (
                    <button
                      type="button"
                      onClick={() => removeLayer(l.key)}
                      className={`px-2 py-1.5 rounded-r-lg border border-l-0 text-xs font-black ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-blue-200 hover:text-white' : 'bg-white border-slate-300 text-slate-400 hover:text-red-500'}`}
                      title="Delete parameter"
                    >
                      ×
                    </button>
                  ) : (
                    <span className="px-2 py-1.5 rounded-r-lg border border-l-0 bg-slate-100 border-slate-300 text-slate-400 text-xs">🔒</span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">New parameter name</label>
                <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="e.g. Fraction Folded, Peak Amplitude" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-56 bg-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
                <input type="text" value={newLayerUnit} onChange={(e) => setNewLayerUnit(e.target.value)} placeholder="e.g. a.u., %" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-24 bg-white" />
              </div>
              <button type="button" onClick={addLayer} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">
                + Add Parameter Layer
              </button>
            </div>
          </div>

          {/* Extraction + table toolbar */}
          <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Analysis wavelength λ (nm)</label>
              <input
                type="number"
                value={activeTest.analysisWavelength ?? '222'}
                onChange={(e) => updateActiveTest({ analysisWavelength: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-28 bg-white font-mono"
              />
            </div>
            <button type="button" onClick={() => d.activeInstance && extractForInstance(d.activeInstance)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm">
              📥 Extract at λ (active condition)
            </button>
            <button type="button" onClick={extractForAll} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold px-3 py-2 rounded-lg text-xs shadow-sm">
              📥 Extract at λ (all conditions)
            </button>
            <button type="button" onClick={clearLayer} className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-bold px-3 py-2 rounded-lg text-xs shadow-sm">
              🧹 Clear {d.activeLayer.label}
            </button>
            {manualCount > 0 && (
              <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-300 rounded-lg px-2 py-1">🟩 {manualCount} filled</span>
            )}
            {d.selectedKeys && (
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1 flex items-center gap-1">
                🎯 Selected: {d.seriesOptions.find((o) => o.key === d.selectedKeys[0])?.label || d.selectedKeys[0]}
                <button onClick={() => updateActiveTest({ selectedSeriesKeys: [] })} className="text-amber-600 hover:text-red-600 font-black">✕</button>
              </span>
            )}
          </div>

          {/* Values table */}
          {d.seriesOptions.length === 0 ? (
            <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
              No spectra in the active condition. Add spectra in “CD Data Input” below.
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 w-12 border-b border-slate-200">#</th>
                    <th className="px-3 py-2 border-b border-slate-200">Spectrum</th>
                    <th className="px-3 py-2 border-b border-slate-200 text-blue-700">
                      Value {d.activeLayer.unit ? `(${d.activeLayer.unit})` : ''} — {d.activeInstance ? d.activeInstance.name : ''}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {d.seriesOptions.map((opt, idx) => {
                    const col = (d.activeInstance?.spectraColumns || [])[idx];
                    const isMan = parseManual(d.activeValues[opt.key]) !== null;
                    const isSel = d.selectedKeys && d.selectedKeys.includes(opt.key);
                    return (
                      <tr
                        key={opt.key}
                        onClick={(e) => handleRowClick(e, opt.key)}
                        className={`cursor-pointer transition-colors ${isSel ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                        title="Click to highlight this spectrum everywhere"
                      >
                        <td className="px-3 py-2 font-bold text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-2 font-bold text-slate-700">
                            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: col?.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length] }} />
                            {opt.label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={d.activeValues[opt.key] || ''}
                            onChange={(e) => handleValueChange(opt.key, e.target.value)}
                            className={`w-40 border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-slate-400">
            💡 Typical workflow: set λ (e.g. 222 nm for α-helix), press “Extract at λ (all conditions)”, then plot the values vs the numeric X of each condition in the Fitting section (thermal melts, titrations, denaturation curves).
          </p>
        </div>
      </CollapsibleSection>

      {/* ============ CD DATA INPUT (active instance) ============ */}
      <CollapsibleSection title="CD Data Input" icon="📥" headerExtra={
        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded">
          Editing: {d.activeInstance ? d.activeInstance.name : '—'}
        </span>
      }>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,.asc,.dcm"
          multiple
          className="hidden"
          onChange={importJascoFiles}
        />
        <div className="flex flex-col gap-4">
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-blue-800 uppercase">JASCO / TXT Import (into active condition)</div>
                <p className="text-[10px] text-blue-700 mt-1">
                  Imports the CD [mdeg] channel from JASCO .txt files, converts the wavelength axis to ascending
                  order, and fills sample metadata when available.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => triggerJascoImport('replace')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">
                  📂 Import JASCO (Replace)
                </button>
                <button onClick={() => triggerJascoImport('append')} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">
                  ➕ Import JASCO (Append)
                </button>
              </div>
            </div>
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-slate-600 uppercase">📏 Wavelength Data (X axis - nm)</label>
              <span className="text-[10px] text-slate-400">{d.parsedWavelengths.length} values loaded</span>
            </div>
            <textarea
              value={d.activeInstance ? d.activeInstance.wavelengthData || '' : ''}
              onChange={(e) => updateActiveInstance({ wavelengthData: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 h-24 resize-y shadow-inner"
              placeholder={'Paste wavelength values (one per line or comma-separated)\ne.g.: 190, 191, 192, 193, ... 260'}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Range:{' '}
              {d.parsedWavelengths.length > 0
                ? `${Math.min(...d.parsedWavelengths).toFixed(1)} - ${Math.max(...d.parsedWavelengths).toFixed(1)} nm`
                : 'No data'}
            </p>
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-bold text-slate-600 uppercase">📊 CD Spectra (Y axis - multiple spectra)</label>
              <button onClick={addSpectrumColumn} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1">
                + Add Spectrum
              </button>
            </div>
            {d.parsedSpectra.length === 0 ? (
              <div className="text-center py-8 text-slate-400 italic bg-white rounded-lg border border-dashed border-slate-300">
                No spectra added yet. Click "Add Spectrum" to start.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {d.parsedSpectra.map((spectrum) => (
                  <div key={spectrum.id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm relative group">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="color"
                        value={spectrum.color}
                        onChange={(e) => updateSpectrumColumn(spectrum.id, { color: e.target.value })}
                        className="w-6 h-6 rounded border border-slate-300 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={spectrum.title}
                        onChange={(e) => updateSpectrumColumn(spectrum.id, { title: e.target.value })}
                        className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs font-bold outline-none focus:border-blue-500"
                        placeholder="Spectrum title..."
                      />
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={spectrum.visible}
                          onChange={(e) => updateSpectrumColumn(spectrum.id, { visible: e.target.checked })}
                          className="w-3 h-3 accent-blue-600"
                        />
                        <span className="text-[9px] text-slate-500">Show</span>
                      </label>
                      <button onClick={() => removeSpectrumColumn(spectrum.id)} className="text-slate-400 hover:text-red-500 font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                        ×
                      </button>
                    </div>
                    <textarea
                      value={spectrum.data}
                      onChange={(e) => updateSpectrumColumn(spectrum.id, { data: e.target.value })}
                      className="w-full border border-slate-200 rounded p-2 font-mono text-[10px] outline-none focus:border-blue-500 h-20 resize-y shadow-inner"
                      placeholder={`Paste CD values for ${spectrum.title}...`}
                    />
                    <p className="text-[9px] text-slate-400 mt-1">
                      {spectrum.values.length} values{' '}
                      {spectrum.values.length !== d.parsedWavelengths.length && d.parsedWavelengths.length > 0 && (
                        <span className="text-amber-600 font-bold">⚠️ Mismatch with {d.parsedWavelengths.length} wavelengths</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
};

// ================= DATA (CD Spectra & Secondary Structure — active instance) =================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest);
  const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;
  const chartCfg = activeTest.chartCfg || DEFAULT_CHART_CFG;

  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

  const cdChartRef = useRef(null);
  const structChartRef = useRef(null);
  const cdChart = useRef(null);
  const structChart = useRef(null);

  useEffect(() => {
    if (!cdChartRef.current) return;
    if (cdChart.current) cdChart.current.destroy();
    const datasets = d.parsedSpectra
      .filter((s) => s.visible && s.values.length > 0)
      .map((s) => {
        const data = d.parsedWavelengths
          .map((w, i) => ({ x: w, y: s.values[i] !== undefined ? s.values[i] : null }))
          .filter((p) => p.y !== null);
        const sk = `spec-${s.id}`;
        const isSel = d.selectedKeys && d.selectedKeys.includes(sk);
        const dimmed = d.selectedKeys && !isSel;
        return {
          label: s.title,
          data,
          borderColor: dimmed ? `${s.color}55` : s.color,
          backgroundColor: `${s.color}20`,
          borderWidth: isSel ? (chartCfg.lineWidth || 2) + 1.5 : chartCfg.lineWidth || 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.1,
          type: 'line'
        };
      });
    cdChart.current = new Chart(cdChartRef.current, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined,
            max: chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined,
            reverse: false,
            title: {
              display: true,
              text: 'Wavelength (nm)',
              font: { size: (chartCfg.fontSize || 12) + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: { font: { size: chartCfg.fontSize || 12 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          },
          y: {
            min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined,
            max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined,
            title: {
              display: true,
              text: 'CD Signal (mdeg)',
              font: { size: (chartCfg.fontSize || 12) + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: { font: { size: chartCfg.fontSize || 12 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { size: chartCfg.fontSize || 12, weight: 'bold' }, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              title: (c) => `${c[0].parsed.x.toFixed(1)} nm`,
              label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(3)} mdeg`
            }
          }
        }
      }
    });
    return () => {
      if (cdChart.current) cdChart.current.destroy();
    };
  }, [d.parsedWavelengths, d.parsedSpectra, chartCfg, d.selectedKeys]);

  useEffect(() => {
    if (!structChartRef.current) return;
    if (structChart.current) structChart.current.destroy();
    const labels = Object.keys(structureComposition);
    const values = Object.values(structureComposition);
    const colors = labels.map((l) => STRUCTURE_COLORS[l] || '#94a3b8');
    structChart.current = new Chart(structChartRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11, weight: 'bold' }, padding: 12, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label}: ${c.parsed.toFixed(1)}%`
            }
          }
        }
      }
    });
    return () => {
      if (structChart.current) structChart.current.destroy();
    };
  }, [structureComposition]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (cdChart.current) cdChart.current.resize();
      if (structChart.current) structChart.current.resize();
    }, 80);
    return () => clearTimeout(timer);
  }, [fsPanel]);

  return (
    <CollapsibleSection
      title="CD Spectra & Secondary Structure Analysis"
      icon="📈"
      headerExtra={
        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded">
          Condition: {d.activeInstance ? d.activeInstance.name : '—'}
        </span>
      }
    >
      <div className="flex flex-col lg:flex-row gap-6">
        {fsPanel === 'cd' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('cd')}></div>}
        <div className={`flex flex-col ${fsPanel === 'cd' ? ` ${FS_CLASSES} p-6` : 'flex-[3] min-w-0'}`}>
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">CD Spectra Plot</h2>
            <button onClick={() => toggleFs('cd')} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">
              {fsPanel === 'cd' ? '↙️' : '↗️'}
            </button>
          </div>
          <div className="flex-1 relative min-h-0" style={{ minHeight: fsPanel === 'cd' ? '0' : '400px' }}>
            <canvas ref={cdChartRef}></canvas>
          </div>
        </div>

        {fsPanel === 'struct' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('struct')}></div>}
        <div className={`flex flex-col ${fsPanel === 'struct' ? ` ${FS_CLASSES} p-6` : 'flex-[2] min-w-0'}`}>
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Secondary Structure</h2>
            <button onClick={() => toggleFs('struct')} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">
              {fsPanel === 'struct' ? '↙️' : '↗️'}
            </button>
          </div>
          <div
            className="flex-1 relative min-h-0 flex flex-col items-center justify-center"
            style={{ minHeight: fsPanel === 'struct' ? '0' : '300px' }}
          >
            <div className="w-full max-w-[280px] aspect-square relative">
              <canvas ref={structChartRef}></canvas>
            </div>
            <div className="w-full mt-4 grid grid-cols-2 gap-2">
              {Object.entries(structureComposition).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold" style={{ color: STRUCTURE_COLORS[key] }}>{key}</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600">{val}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={val}
                    onChange={(e) => {
                      const newVal = parseInt(e.target.value, 10);
                      const newComp = { ...structureComposition, [key]: newVal };
                      updateActiveTest({ structureComposition: newComp });
                    }}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: STRUCTURE_COLORS[key] }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};

// ================= FITTING — CONDITION PLOTS + ERRORS + EXPERIMENTAL VARIABLES =================
export const FittingErrors = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest);
  const [newVariable, setNewVariable] = useState('');

  const plots =
    Array.isArray(activeTest.conditionPlots) && activeTest.conditionPlots.length
      ? activeTest.conditionPlots
      : [defaultCdPlotCfg(1)];

  const updatePlot = (id, patch) =>
    updateActiveTest({ conditionPlots: plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlot = () => updateActiveTest({ conditionPlots: [...plots, defaultCdPlotCfg(plots.length + 1)] });
  const removePlot = (id) => {
    if (plots.length <= 1) {
      alert('At least one condition plot is required.');
      return;
    }
    updateActiveTest({ conditionPlots: plots.filter((p) => p.id !== id) });
  };
  const duplicatePlot = (p) =>
    updateActiveTest({
      conditionPlots: [...plots, { ...JSON.parse(JSON.stringify(p)), id: makePlotId(), title: `${p.title} (copy)` }]
    });

  // ---------- Experimental variables (table) ----------
  const variables = Array.isArray(activeTest.titrationVariables)
    ? activeTest.titrationVariables
    : ['Ratio', 'Concentration', 'Temperature'];
  const rows = activeTest.titrationRows || [];
  const makeId = () => `tit_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const addVariable = () => {
    const name = newVariable.trim();
    if (!name || variables.includes(name)) return;
    updateActiveTest({ titrationVariables: [...variables, name] });
    setNewVariable('');
  };

  const removeVariable = (name) => {
    updateActiveTest({
      titrationVariables: variables.filter((v) => v !== name),
      titrationRows: rows.map((row) => {
        const values = { ...(row.values || {}) };
        delete values[name];
        return { ...row, values };
      })
    });
  };

  const addRow = () => {
    const values = {};
    variables.forEach((v) => { values[v] = ''; });
    updateActiveTest({ titrationVariables: variables, titrationRows: [...rows, { id: makeId(), values, notes: '' }] });
  };

  const addRowFromCurrent = () => {
    const values = {};
    variables.forEach((v) => {
      const key = v.toLowerCase();
      if (key.includes('ratio')) values[v] = activeTest.ratio || '';
      else if (key.includes('conc')) values[v] = activeTest.concentration || '';
      else if (key.includes('temp')) values[v] = activeTest.temperature || '';
      else if (key.includes('buffer') || key.includes('solvent')) values[v] = activeTest.buffer || activeTest.solvent || '';
      else if (key.includes('path')) values[v] = activeTest.pathLength || '';
      else if (key.includes('salt')) values[v] = activeTest.saltConcentration || '';
      else if (key.includes('other') || key.includes('ligand') || key.includes('molecule')) values[v] = activeTest.otherMolecule || '';
      else values[v] = '';
    });
    updateActiveTest({ titrationVariables: variables, titrationRows: [...rows, { id: makeId(), values, notes: '' }] });
  };

  const updateRowValue = (id, variable, value) =>
    updateActiveTest({
      titrationRows: rows.map((row) => (row.id === id ? { ...row, values: { ...(row.values || {}), [variable]: value } } : row))
    });

  const updateRowNotes = (id, notes) =>
    updateActiveTest({ titrationRows: rows.map((row) => (row.id === id ? { ...row, notes } : row)) });

  const duplicateRow = (row) =>
    updateActiveTest({ titrationRows: [...rows, { ...row, id: makeId() }] });

  const removeRow = (id) =>
    updateActiveTest({ titrationRows: rows.filter((row) => row.id !== id) });

  // Create one instance per experimental point
  const createInstancesFromPoints = () => {
    if (!rows.length) {
      alert('No experimental points defined in the table below.');
      return;
    }
    const src = d.activeInstance;
    const cols = (src?.spectraColumns || []).map((c) => ({ ...c, data: '' }));
    const newInsts = rows.map((row, i) => {
      const name =
        variables
          .map((v) => {
            const val = (row.values || {})[v];
            return val ? `${v} ${val}` : '';
          })
          .filter(Boolean)
          .join(' · ') || `Point ${i + 1}`;
      let xVal = '';
      for (const v of variables) {
        const n = parseManual((row.values || {})[v]);
        if (n !== null) { xVal = String(n); break; }
      }
      return {
        id: makeInstanceId(),
        name,
        xValue: xVal,
        notes: row.notes || '',
        wavelengthData: src?.wavelengthData || '',
        spectraColumns: cols.map((c) => ({ ...c })),
        values: {}
      };
    });
    updateActiveTest({ instances: [...d.instances, ...newInsts] });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-bold text-slate-500 uppercase">
          Condition plots — each one has its own parameter, spectra, fit, errors and graphical settings
        </span>
        <button type="button" onClick={addPlot} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">
          + Add Condition Plot
        </button>
      </div>

      {plots.map((p) => (
        <ConditionPlotPanel
          key={p.id}
          ctx={ctx}
          d={d}
          plot={p}
          updatePlot={updatePlot}
          removePlot={removePlot}
          duplicatePlot={duplicatePlot}
        />
      ))}

      <CollapsibleSection title="Experimental Variables" icon="🎛️" defaultOpen={false}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex flex-col md:flex-row gap-2 w-full lg:w-auto">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">New Experimental Variable</label>
                <input
                  type="text"
                  value={newVariable}
                  onChange={(e) => setNewVariable(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addVariable();
                    }
                  }}
                  placeholder="e.g. Ratio, Concentration, pH, Temperature"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full md:w-72 bg-white"
                />
              </div>
              <button type="button" onClick={addVariable} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">
                + Add Variable
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addRowFromCurrent} className="bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 font-bold px-4 py-2 rounded-lg text-sm shadow-sm">
                + Add Point from Current Conditions
              </button>
              <button type="button" onClick={addRow} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">
                + Add Empty Point
              </button>
              <button type="button" onClick={createInstancesFromPoints} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">
                🧩 Create Instance per Point
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {variables.length === 0 && (
              <span className="text-sm text-slate-400 italic">
                No variables defined. Add variables such as Ratio, Concentration, pH, Temperature, etc.
              </span>
            )}
            {variables.map((v) => (
              <span key={v} className="inline-flex items-center gap-2 bg-white border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 shadow-sm">
                {v}
                <button type="button" onClick={() => removeVariable(v)} className="text-slate-400 hover:text-red-500 font-black" title={`Remove variable ${v}`}>
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-12 border-b border-slate-200">#</th>
                  {variables.map((v) => (
                    <th key={v} className="px-3 py-2 font-bold text-blue-700 whitespace-nowrap border-b border-slate-200">{v}</th>
                  ))}
                  <th className="px-3 py-2 min-w-[180px] border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 w-32 border-b border-slate-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={variables.length + 3} className="px-3 py-10 text-center text-slate-400 italic">
                      No experimental points defined yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-500">{idx + 1}</td>
                      {variables.map((v) => (
                        <td key={v} className="px-3 py-2">
                          <input
                            type="text"
                            value={(row.values || {})[v] || ''}
                            onChange={(e) => updateRowValue(row.id, v, e.target.value)}
                            className="w-full min-w-[90px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            placeholder={v}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.notes || ''}
                          onChange={(e) => updateRowNotes(row.id, e.target.value)}
                          className="w-full min-w-[180px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => duplicateRow(row)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                            Duplicate
                          </button>
                          <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-bold text-red-500 hover:text-red-700">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};

// ================= FITTING — GRAPHICAL PARAMETERS (main CD spectra chart) =================
export const FittingGraphics = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const chartCfg = activeTest.chartCfg || DEFAULT_CHART_CFG;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        ['X Min (nm)', 'xMin'],
        ['X Max (nm)', 'xMax'],
        ['Y Min (mdeg)', 'yMin'],
        ['Y Max (mdeg)', 'yMax']
      ].map(([lbl, k]) => (
        <div key={k} className="flex flex-col gap-1">
          <label className="text-xs font-bold text-slate-600">{lbl}</label>
          <input
            type="number"
            placeholder="Auto"
            value={chartCfg[k]}
            onChange={(e) => updateActiveTest({ chartCfg: { ...chartCfg, [k]: e.target.value } })}
            className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-slate-600">Font Size</label>
        <input
          type="number"
          value={chartCfg.fontSize}
          onChange={(e) => updateActiveTest({ chartCfg: { ...chartCfg, fontSize: parseFloat(e.target.value) || 12 } })}
          className="border border-slate-300 rounded-md p-2 text-sm outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-slate-600">Line Thickness</label>
        <input
          type="number"
          value={chartCfg.lineWidth}
          onChange={(e) => updateActiveTest({ chartCfg: { ...chartCfg, lineWidth: parseFloat(e.target.value) || 2 } })}
          className="border border-slate-300 rounded-md p-2 text-sm outline-none"
        />
      </div>
    </div>
  );
};

// ================= SIMULATIONS (Mixer + Reference Library) =================
export const Simulations = () => {
  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));
  return (
    <div className="flex flex-col gap-6">
      {fsPanel === 'mixer' && (
        <div className={OVERLAY_CLASSES} onClick={() => toggleFs('mixer')}></div>
      )}
      <ProteinCDMixer isExpanded={fsPanel === 'mixer'} onToggleExpand={() => toggleFs('mixer')} />
      {fsPanel === 'library' && (
        <div className={OVERLAY_CLASSES} onClick={() => toggleFs('library')}></div>
      )}
      <CDSpectraLibrary isExpanded={fsPanel === 'library'} onToggleExpand={() => toggleFs('library')} />
    </div>
  );
};

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useCdDerived(activeTest);
  const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;

  if (checkId === 'cond') {
    const names = d.instances.map((i) => i.name).join(', ');
    return `<p style="font-size: 12px; color: #475569; margin-top: 10px;"><b>Conditions:</b> ${names || 'N/A'} (${d.instances.length})</p>`;
  }

  if (checkId === 'struct') {
    let html =
      '<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">';
    html +=
      '<tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Structure</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Percentage</th></tr>';
    Object.entries(structureComposition).forEach(([k, v]) => {
      html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${k}</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${v}%</td></tr>`;
    });
    html += '</table>';
    return html;
  }

  if (checkId === 'spectra') {
    if (d.parsedSpectra.length === 0) return '';
    let html = `<p style="font-size: 12px; color: #475569; margin-top: 10px;"><b>Spectra recorded (${d.activeInstance ? d.activeInstance.name : 'Condition'}):</b> ${d.parsedSpectra.map((s) => s.title).join(', ')}</p>`;
    html += `<p style="font-size: 11px; color: #64748b;">Wavelength range: ${d.parsedWavelengths.length > 0 ? `${Math.min(...d.parsedWavelengths)} - ${Math.max(...d.parsedWavelengths)} nm` : 'N/A'} (${d.parsedWavelengths.length} points)</p>`;
    return html;
  }

  return '';
};

// ================= ALL (convenience wrapper) =================
export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <Setup ctx={ctx} />
    <Data ctx={ctx} />
    <FittingErrors ctx={ctx} />
    <CollapsibleSection title="Chart Parameters (Main Spectra Plot)" icon="🎨" defaultOpen={false}>
      <FittingGraphics ctx={ctx} />
    </CollapsibleSection>
    <Simulations />
  </div>
);
