import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/* ============================================================================
   CDSections — all CD-specific logic extracted from CDTestRenderer.jsx
   Every original function is preserved 1:1. Components are rendered by
   TestShellRenderer via the `custom` prop:
   Toolbar, Setup, Data, FittingErrors, FittingGraphics, Simulations,
   NotebookExtra.
   ========================================================================== */

const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

const SPECTRA_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981'
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

// ================= COLLAPSIBLE SECTION (local copy, self-contained) =================
const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button
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

// --- JASCO IMPORT PARSER ---
const parseJascoDate = (value) => {
  if (!value) return '';
  const s = String(value);
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) {
    return `20${m[1]}-${m[2]}-${m[3]}`;
  }
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
    const m = line.match(/^([A-Za-z0-9/.()\- ]{2,60}?)\s+(.*)$/);
    if (m && !/^\d/.test(m[1])) {
      meta[m[1].trim()] = m[2].trim();
    }
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#####')) {
      inData = false;
      continue;
    }
    if (line.startsWith('[')) {
      continue;
    }
    if (/^XYDATA/i.test(line)) {
      inData = true;
      continue;
    }
    if (inData) {
      const cols = line.split(/[,\s]+/).filter(Boolean);
      if (cols.length >= 2) {
        const x = parseFloat(cols[0]);
        const y = parseFloat(cols[1]);
        if (!isNaN(x) && !isNaN(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      continue;
    }
    addMeta(line);
  }
  if (xs.length > 1 && xs[0] > xs[xs.length - 1]) {
    xs.reverse();
    ys.reverse();
  }
  const title = meta['Sample name'] || meta['TITLE'] || '';
  const experimentDate = parseJascoDate(
    meta['Measurement date'] || meta['DATE'] || meta['Creation date'] || ''
  );
  const temperatureRaw = meta['Temperature'] || '';
  const temperature = temperatureRaw ? temperatureRaw.replace(/\sC\s$/, ' °C') : '';
  const pathRaw = meta['Cell length'] || '';
  const pathMatch = pathRaw.match(/(-?\d+(?:\.\d+)?)/);
  const pathLength = pathMatch ? pathMatch[1] : pathRaw;
  const concentration = meta['Concentration'] || '';
  return {
    xs,
    ys,
    meta,
    title,
    experimentDate,
    temperature,
    pathLength,
    concentration
  };
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
const computeParsed = (activeTest) => {
  const wavelengthData = activeTest.wavelengthData || '';
  const spectraColumns = activeTest.spectraColumns || [];
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

// ================= PROTEIN CD MIXER (unchanged) =================
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
      ctx.beginPath();
      ctx.moveTo(px, pad.top);
      ctx.lineTo(px, pad.top + plotH);
      ctx.stroke();
    }
    const yRange = yMax - yMin;
    const yTickStep = yRange > 100000 ? 20000 : 10000;
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(pad.left + plotW, py);
      ctx.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(pad.left + plotW, zeroY);
      ctx.stroke();
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
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? `${FS_CLASSES} p-6` : 'break-inside-avoid p-4'}`}>
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

// ================= CD LIBRARY (unchanged) =================
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
  const plotData = useMemo(() => {
    return buildCdLibraryData({ tab, selectedProtein, selectedDna, selectedGq, ratio, normalize });
  }, [tab, selectedProtein, selectedDna, selectedGq, ratio, normalize]);
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
      ctx.beginPath();
      ctx.moveTo(px, pad.top);
      ctx.lineTo(px, pad.top + plotH);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(pad.left + plotW, py);
      ctx.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroY);
      ctx.lineTo(pad.left + plotW, zeroY);
      ctx.stroke();
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
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? `${FS_CLASSES} p-6` : 'break-inside-avoid p-4'}`}>
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
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                  tab === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
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
   SECTION COMPONENTS (rendered by TestShellRenderer)
   ========================================================================== */

// ================= TOOLBAR (Export XLS / Export PDF) =================
export const Toolbar = ({ ctx }) => {
  const { activeTest } = ctx;
  const barRef = useRef(null);

  const exportXLS = () => {
    try {
      const compound = activeTest.compound || '';
      const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;
      const titrationVariables = Array.isArray(activeTest.titrationVariables)
        ? activeTest.titrationVariables
        : ['Ratio', 'Concentration', 'Temperature'];
      const titrationRows = activeTest.titrationRows || [];
      const { parsedWavelengths, parsedSpectra } = computeParsed(activeTest);
      const wb = XLSX.utils.book_new();
      const wlAoa = [['Wavelength (nm)', ...parsedSpectra.map((s) => s.title)]];
      parsedWavelengths.forEach((w, i) => {
        const row = [w];
        parsedSpectra.forEach((s) => {
          row.push(s.values[i] !== undefined ? s.values[i] : '');
        });
        wlAoa.push(row);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wlAoa), 'CD Data');
      const structAoa = [['Structure', 'Percentage (%)']];
      Object.entries(structureComposition).forEach(([k, v]) => structAoa.push([k, v]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(structAoa), 'Structure');
      if (titrationRows.length > 0) {
        const titrationAoa = [['Point', ...titrationVariables, 'Notes']];
        titrationRows.forEach((row, idx) => {
          titrationAoa.push([
            idx + 1,
            ...titrationVariables.map((v) => (row.values || {})[v] || ''),
            row.notes || ''
          ]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(titrationAoa), 'Titration Conditions');
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

// ================= SETUP (Titration Conditions + CD Data Input) =================
export const Setup = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const updatePlate = (updates) => updateActiveTest(updates);
  const {
    ratio = '',
    concentration = '',
    temperature = '',
    buffer = '',
    solvent = '',
    pathLength = '1',
    saltConcentration = '',
    otherMolecule = '',
    wavelengthData = '',
    spectraColumns = [],
    chartCfg = DEFAULT_CHART_CFG
  } = activeTest;

  const [newTitrationVariable, setNewTitrationVariable] = useState('');
  const fileInputRef = useRef(null);
  const importModeRef = useRef('replace');

  const titrationVariables = Array.isArray(activeTest.titrationVariables)
    ? activeTest.titrationVariables
    : ['Ratio', 'Concentration', 'Temperature'];
  const titrationRows = activeTest.titrationRows || [];
  const makeTitrationId = () => `tit_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const addTitrationVariable = () => {
    const name = newTitrationVariable.trim();
    if (!name || titrationVariables.includes(name)) return;
    updatePlate({ titrationVariables: [...titrationVariables, name] });
    setNewTitrationVariable('');
  };

  const removeTitrationVariable = (name) => {
    updatePlate({
      titrationVariables: titrationVariables.filter((v) => v !== name),
      titrationRows: titrationRows.map((row) => {
        const values = { ...(row.values || {}) };
        delete values[name];
        return { ...row, values };
      })
    });
  };

  const addTitrationRow = () => {
    const values = {};
    titrationVariables.forEach((v) => { values[v] = ''; });
    updatePlate({
      titrationVariables,
      titrationRows: [...titrationRows, { id: makeTitrationId(), values, notes: '' }]
    });
  };

  const addTitrationRowFromCurrent = () => {
    const values = {};
    titrationVariables.forEach((v) => {
      const key = v.toLowerCase();
      if (key.includes('ratio')) values[v] = ratio || '';
      else if (key.includes('conc')) values[v] = concentration || '';
      else if (key.includes('temp')) values[v] = temperature || '';
      else if (key.includes('buffer') || key.includes('solvent')) values[v] = buffer || solvent || '';
      else if (key.includes('path')) values[v] = pathLength || '';
      else if (key.includes('salt')) values[v] = saltConcentration || '';
      else if (key.includes('other') || key.includes('ligand') || key.includes('molecule')) values[v] = otherMolecule || '';
      else values[v] = '';
    });
    updatePlate({
      titrationVariables,
      titrationRows: [...titrationRows, { id: makeTitrationId(), values, notes: '' }]
    });
  };

  const updateTitrationRow = (id, updates) => {
    updatePlate({ titrationRows: titrationRows.map((row) => (row.id === id ? { ...row, ...updates } : row)) });
  };

  const updateTitrationRowValue = (id, variable, value) => {
    updatePlate({
      titrationRows: titrationRows.map((row) =>
        row.id === id ? { ...row, values: { ...(row.values || {}), [variable]: value } } : row
      )
    });
  };

  const duplicateTitrationRow = (row) => {
    updatePlate({ titrationRows: [...titrationRows, { ...row, id: makeTitrationId() }] });
  };

  const removeTitrationRow = (id) => {
    updatePlate({ titrationRows: titrationRows.filter((row) => row.id !== id) });
  };

  const { parsedWavelengths, parsedSpectra } = useMemo(
    () => computeParsed(activeTest),
    [wavelengthData, spectraColumns]
  );

  const addSpectrumColumn = () => {
    const newCol = {
      id: Date.now().toString(),
      title: `Spectrum ${spectraColumns.length + 1}`,
      data: '',
      color: SPECTRA_PALETTE[spectraColumns.length % SPECTRA_PALETTE.length],
      visible: true
    };
    updatePlate({ spectraColumns: [...spectraColumns, newCol] });
  };

  const updateSpectrumColumn = (id, updates) => {
    updatePlate({ spectraColumns: spectraColumns.map((c) => (c.id === id ? { ...c, ...updates } : c)) });
  };

  const removeSpectrumColumn = (id) => {
    updatePlate({ spectraColumns: spectraColumns.filter((c) => c.id !== id) });
  };

  const triggerJascoImport = (mode) => {
    importModeRef.current = mode;
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const importJascoFiles = async (event) => {
    const input = event.target;
    const mode = importModeRef.current || 'replace';
    const files = Array.from(input.files || []);
    if (!files.length) return;
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
    const startIndex = mode === 'append' ? spectraColumns.length : 0;
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
    const updates = {};
    const minX = Math.min(...baseX);
    const maxX = Math.max(...baseX);
    if (mode === 'replace' || parsedWavelengths.length === 0) {
      updates.wavelengthData = baseX.join('\n');
      updates.spectraColumns = newCols;
      updates.chartCfg = { ...chartCfg, xMin: String(minX), xMax: String(maxX) };
    } else {
      const sameAsCurrent =
        baseX.length === parsedWavelengths.length && baseX.every((x, i) => Math.abs(x - parsedWavelengths[i]) < 0.01);
      if (!sameAsCurrent) {
        alert('Cannot append: imported wavelength axis does not match the current wavelength axis.\nUse Replace import or clear the current data.');
        input.value = '';
        return;
      }
      const currentMin = parsedWavelengths.length ? Math.min(...parsedWavelengths) : minX;
      const currentMax = parsedWavelengths.length ? Math.max(...parsedWavelengths) : maxX;
      updates.spectraColumns = [...spectraColumns, ...newCols];
      updates.chartCfg = {
        ...chartCfg,
        xMin: String(Math.min(currentMin, minX)),
        xMax: String(Math.max(currentMax, maxX))
      };
    }
    if (firstMeta) {
      if (firstMeta.title && !activeTest.compound) updates.compound = firstMeta.title;
      if (firstMeta.experimentDate && !activeTest.experimentDate) updates.experimentDate = firstMeta.experimentDate;
      if (firstMeta.temperature && !activeTest.temperature) updates.temperature = firstMeta.temperature;
      if (firstMeta.pathLength && !activeTest.pathLength) updates.pathLength = firstMeta.pathLength;
      if (firstMeta.concentration && !activeTest.concentration) updates.concentration = firstMeta.concentration;
    }
    updatePlate(updates);
    input.value = '';
  };

  return (
    <>
      <CollapsibleSection title="Titration Conditions" icon="🧪" defaultOpen={false}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex flex-col md:flex-row gap-2 w-full lg:w-auto">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">New Experimental Variable</label>
                <input
                  type="text"
                  value={newTitrationVariable}
                  onChange={(e) => setNewTitrationVariable(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTitrationVariable();
                    }
                  }}
                  placeholder="e.g. Ratio, Concentration, pH, Temperature"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full md:w-72 bg-white"
                />
              </div>
              <button
                type="button"
                onClick={addTitrationVariable}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit"
              >
                + Add Variable
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addTitrationRowFromCurrent}
                className="bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + Add Point from Current Conditions
              </button>
              <button
                type="button"
                onClick={addTitrationRow}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + Add Empty Titration Point
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {titrationVariables.length === 0 && (
              <span className="text-sm text-slate-400 italic">
                No variables defined. Add variables such as Ratio, Concentration, pH, Temperature, etc.
              </span>
            )}
            {titrationVariables.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-2 bg-white border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 shadow-sm"
              >
                {v}
                <button
                  type="button"
                  onClick={() => removeTitrationVariable(v)}
                  className="text-slate-400 hover:text-red-500 font-black"
                  title={`Remove variable ${v}`}
                >
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
                  {titrationVariables.map((v) => (
                    <th key={v} className="px-3 py-2 font-bold text-blue-700 whitespace-nowrap border-b border-slate-200">{v}</th>
                  ))}
                  <th className="px-3 py-2 min-w-[180px] border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 w-32 border-b border-slate-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {titrationRows.length === 0 ? (
                  <tr>
                    <td colSpan={titrationVariables.length + 3} className="px-3 py-10 text-center text-slate-400 italic">
                      No titration points defined yet.
                    </td>
                  </tr>
                ) : (
                  titrationRows.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-500">{idx + 1}</td>
                      {titrationVariables.map((v) => (
                        <td key={v} className="px-3 py-2">
                          <input
                            type="text"
                            value={(row.values || {})[v] || ''}
                            onChange={(e) => updateTitrationRowValue(row.id, v, e.target.value)}
                            className="w-full min-w-[90px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            placeholder={v}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.notes || ''}
                          onChange={(e) => updateTitrationRow(row.id, { notes: e.target.value })}
                          className="w-full min-w-[180px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => duplicateTitrationRow(row)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                            Duplicate
                          </button>
                          <button type="button" onClick={() => removeTitrationRow(row.id)} className="text-xs font-bold text-red-500 hover:text-red-700">
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

      <CollapsibleSection title="CD Data Input" icon="📥">
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
                <div className="text-xs font-bold text-blue-800 uppercase">JASCO / TXT Import</div>
                <p className="text-[10px] text-blue-700 mt-1">
                  Imports the CD [mdeg] channel from JASCO .txt files, converts the wavelength axis to ascending
                  order, and fills sample metadata when available.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => triggerJascoImport('replace')}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
                >
                  📂 Import JASCO (Replace)
                </button>
                <button
                  onClick={() => triggerJascoImport('append')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
                >
                  ➕ Import JASCO (Append)
                </button>
              </div>
            </div>
          </div>
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-slate-600 uppercase">📏 Wavelength Data (X axis - nm)</label>
              <span className="text-[10px] text-slate-400">{parsedWavelengths.length} values loaded</span>
            </div>
            <textarea
              value={wavelengthData}
              onChange={(e) => updatePlate({ wavelengthData: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 h-24 resize-y shadow-inner"
              placeholder={'Paste wavelength values (one per line or comma-separated)\ne.g.: 190, 191, 192, 193, ... 260'}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Range:{' '}
              {parsedWavelengths.length > 0
                ? `${Math.min(...parsedWavelengths).toFixed(1)} - ${Math.max(...parsedWavelengths).toFixed(1)} nm`
                : 'No data'}
            </p>
          </div>
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-bold text-slate-600 uppercase">📊 CD Spectra (Y axis - multiple spectra)</label>
              <button
                onClick={addSpectrumColumn}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1"
              >
                + Add Spectrum
              </button>
            </div>
            {parsedSpectra.length === 0 ? (
              <div className="text-center py-8 text-slate-400 italic bg-white rounded-lg border border-dashed border-slate-300">
                No spectra added yet. Click "Add Spectrum" to start.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {parsedSpectra.map((spectrum) => (
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
                      <button
                        onClick={() => removeSpectrumColumn(spectrum.id)}
                        className="text-slate-400 hover:text-red-500 font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      >
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
                      {spectrum.values.length !== parsedWavelengths.length && parsedWavelengths.length > 0 && (
                        <span className="text-amber-600 font-bold">⚠️ Mismatch with {parsedWavelengths.length} wavelengths</span>
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

// ================= DATA (CD Spectra & Secondary Structure Analysis) =================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const updatePlate = (updates) => updateActiveTest(updates);
  const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;
  const chartCfg = activeTest.chartCfg || DEFAULT_CHART_CFG;
  const { parsedWavelengths, parsedSpectra } = useMemo(
    () => computeParsed(activeTest),
    [activeTest.wavelengthData, activeTest.spectraColumns]
  );

  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

  const cdChartRef = useRef(null);
  const structChartRef = useRef(null);
  const cdChart = useRef(null);
  const structChart = useRef(null);

  useEffect(() => {
    if (!cdChartRef.current) return;
    if (cdChart.current) cdChart.current.destroy();
    const datasets = parsedSpectra
      .filter((s) => s.visible && s.values.length > 0)
      .map((s) => {
        const data = parsedWavelengths
          .map((w, i) => ({ x: w, y: s.values[i] !== undefined ? s.values[i] : null }))
          .filter((d) => d.y !== null);
        return {
          label: s.title,
          data,
          borderColor: s.color,
          backgroundColor: `${s.color}20`,
          borderWidth: chartCfg.lineWidth || 2,
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
  }, [parsedWavelengths, parsedSpectra, chartCfg]);

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
    <CollapsibleSection title="CD Spectra & Secondary Structure Analysis" icon="📈">
      <div className="flex flex-col lg:flex-row gap-6">
        {fsPanel === 'cd' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('cd')}></div>}
        <div className={`flex flex-col ${fsPanel === 'cd' ? `${FS_CLASSES} p-6` : 'flex-[3] min-w-0'}`}>
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">CD Spectra Plot</h2>
            <button
              onClick={() => toggleFs('cd')}
              className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
            >
              {fsPanel === 'cd' ? '↙️' : '↗️'}
            </button>
          </div>
          <div className="flex-1 relative min-h-0" style={{ minHeight: fsPanel === 'cd' ? '0' : '400px' }}>
            <canvas ref={cdChartRef}></canvas>
          </div>
        </div>
        {fsPanel === 'struct' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('struct')}></div>}
        <div className={`flex flex-col ${fsPanel === 'struct' ? `${FS_CLASSES} p-6` : 'flex-[2] min-w-0'}`}>
          <div className="flex justify-between items-start mb-3">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Secondary Structure</h2>
            <button
              onClick={() => toggleFs('struct')}
              className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
            >
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
                      updatePlate({ structureComposition: newComp });
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

// ================= FITTING — ERROR MANAGEMENT (CD: not applicable) =================
export const FittingErrors = () => (
  <p className="text-sm text-slate-400 italic">
    Error management (SD / outliers / weighted fits) applies to replicate-based plate assays. CD spectra are
    single measurements per spectrum, so no error model is applied here.
  </p>
);

// ================= FITTING — GRAPHICAL PARAMETERS (Chart Configuration) =================
export const FittingGraphics = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const updatePlate = (updates) => updateActiveTest(updates);
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
            onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, [k]: e.target.value } })}
            className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-slate-600">Font Size</label>
        <input
          type="number"
          value={chartCfg.fontSize}
          onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, fontSize: parseFloat(e.target.value) || 12 } })}
          className="border border-slate-300 rounded-md p-2 text-sm outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-slate-600">Line Thickness</label>
        <input
          type="number"
          value={chartCfg.lineWidth}
          onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, lineWidth: parseFloat(e.target.value) || 2 } })}
          className="border border-slate-300 rounded-md p-2 text-sm outline-none"
        />
      </div>
    </div>
  );
};

// ================= SIMULATIONS (Mixer + Reference Library) =================
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

// ================= NOTEBOOK EXTRA (Structure + Spectra summary) =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const structureComposition = activeTest.structureComposition || DEFAULT_STRUCTURE;
  const { parsedWavelengths, parsedSpectra } = computeParsed(activeTest);
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
    if (parsedSpectra.length === 0) return '';
    let html = `<p style="font-size: 12px; color: #475569; margin-top: 10px;"><b>Spectra recorded:</b> ${parsedSpectra
      .map((s) => s.title)
      .join(', ')}</p>`;
    html += `<p style="font-size: 11px; color: #64748b;">Wavelength range: ${
      parsedWavelengths.length > 0
        ? `${Math.min(...parsedWavelengths)} - ${Math.max(...parsedWavelengths)} nm`
        : 'N/A'
    } (${parsedWavelengths.length} points)</p>`;
    return html;
  }
  return '';
};

