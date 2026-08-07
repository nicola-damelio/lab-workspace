import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import TestShellRenderer, { CollapsibleSection, SmartImage } from './TestShellRenderer';
import { CD_TAB_CONFIG } from './tabConfigs';

/* ============================================================================
CD renderer using the shared shell.

This version:
• Classification reads testCategories from App.jsx (Definitions & Labels).
• Experimental Setup defines "Report Metrics" (e.g. CD Intensity at 222 nm).
• AUTO metrics are READ from the uploaded spectra: each titration point links
  to a spectrum and the value is interpolated at the metric wavelength
  (baseline-offset corrected). No manual entry for AUTO metrics.
• The Report Graph is fully customizable (axes, fonts, line, points, color,
  grid) and shows a live data preview so you see exactly what gets plotted.
========================================================================== */

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

// ================= REPORT METRICS HELPERS =================
const REPORT_METRIC_UNITS = ['mdeg', 'MRE', 'Δε', 'a.u.'];

const makeMetricId = () => `met_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const makeMetric = (name, { wavelength = '', unit = 'mdeg', mode } = {}) => {
  const wl = String(wavelength || '').trim();
  return {
    id: makeMetricId(),
    name,
    wavelength: wl,
    unit,
    // a metric with a wavelength is read automatically from the linked spectrum
    mode: mode || (wl !== '' ? 'auto' : 'manual')
  };
};

const parseNum = (v) => parseFloat(String(v ?? '').replace(',', '.'));

// Accepts plain numbers AND ratio strings like "1:2" -> 0.5, "3:1" -> 3
const parseXValue = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === '') return NaN;
  const ratio = s.match(/^(-?\d+(?:[.,]\d+)?)\s*:\s*(-?\d+(?:[.,]\d+)?)$/);
  if (ratio) {
    const a = parseFloat(ratio[1].replace(',', '.'));
    const b = parseFloat(ratio[2].replace(',', '.'));
    if (!isNaN(a) && !isNaN(b) && b !== 0) return a / b;
  }
  return parseFloat(s.replace(',', '.'));
};

// ================= SPLINE + CD REFERENCE =================
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

const splineAlpha = new NaturalCubicSpline(alphaKnots.map((p) => p.x), alphaKnots.map((p) => p.y));
const splineBeta = new NaturalCubicSpline(betaKnots.map((p) => p.x), betaKnots.map((p) => p.y));
const splineTurn = new NaturalCubicSpline(turnKnots.map((p) => p.x), turnKnots.map((p) => p.y));
const splineCoil = new NaturalCubicSpline(coilKnots.map((p) => p.x), coilKnots.map((p) => p.y));

// ================= JASCO PARSER =================
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
    const m = line.match(/^([A-Za-z0-9/.()\- ]{2,60}?)\s+(.*)$/);
    if (m && !/^\d/.test(m[1])) meta[m[1].trim()] = m[2].trim();
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#####')) {
      inData = false;
      continue;
    }
    if (line.startsWith('[')) continue;
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

// ================= PROTEIN CD MIXER =================
const ProteinCDMixer = () => {
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
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col p-4">
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2">
          <span>🧬</span> Protein Secondary Structure Simulator
        </h4>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={wrapRef} className="relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden h-[350px]">
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

// ================= DNA / GQ CD REFERENCE + LIBRARY SIMULATOR =================
const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

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

const splineADNA = new NaturalCubicSpline(aDnaKnots.map((p) => p.x), aDnaKnots.map((p) => p.y));
const splineBDNA = new NaturalCubicSpline(bDnaKnots.map((p) => p.x), bDnaKnots.map((p) => p.y));
const splineZDNA = new NaturalCubicSpline(zDnaKnots.map((p) => p.x), zDnaKnots.map((p) => p.y));
const splineGQP = new NaturalCubicSpline(gqParallelKnots.map((p) => p.x), gqParallelKnots.map((p) => p.y));
const splineGQH = new NaturalCubicSpline(gqHybridKnots.map((p) => p.x), gqHybridKnots.map((p) => p.y));
const splineGQA = new NaturalCubicSpline(gqAntiparallelKnots.map((p) => p.x), gqAntiparallelKnots.map((p) => p.y));

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
    const mix = (parts) =>
      xs.map((_, i) => parts.reduce((sum, [arr, weight]) => sum + (arr[i] || 0) * (weight || 0), 0));
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

const CDSpectraLibrary = () => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height } = useElementSize(wrapRef);
  const [isExpanded, setIsExpanded] = useState(false);
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

    if (!plotData.series.length || !plotData.xs.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select at least one spectrum', W / 2, H / 2);
      return;
    }
    const allValues = plotData.series.flatMap((s) => s.values);
    if (!allValues.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', W / 2, H / 2);
      return;
    }
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
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setIsExpanded(false)} />}
      <div
        className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${
          isExpanded ? `${FS_CLASSES} p-6` : 'break-inside-avoid p-4'
        }`}
      >
        <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
          <h4 className="font-bold text-slate-700 flex items-center gap-2">
            <span>📚</span> CD Spectra Reference Library & Simulator
          </h4>
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
          >
            {isExpanded ? '↙️' : '↗️'}
          </button>
        </div>
        <div className="flex flex-col xl:flex-row gap-4 flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex flex-wrap gap-1 mb-2">
              {CD_LIBRARY_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    if (CD_SIM_INFO[t.id]) setRatio(0);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                    tab === t.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              ref={wrapRef}
              className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${
                isExpanded ? 'flex-1 min-h-0' : 'h-[380px]'
              }`}
            >
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            </div>
          </div>
          <div className="w-full xl:w-72 flex flex-col gap-3 shrink-0 overflow-y-auto custom-scrollbar">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-600"
              />
              Normalize spectra for display
            </label>
            {tab === 'protein' && (
              <div className="flex flex-col gap-1">
                <div className="text-[10px] uppercase font-bold text-slate-500">Protein Structures</div>
                {proteinTypes.map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={selectedProtein.includes(t)}
                      onChange={() => toggleInArray(setSelectedProtein, t)}
                      className="w-3 h-3 accent-blue-600"
                    />
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
                    <input
                      type="checkbox"
                      checked={selectedDna.includes(t)}
                      onChange={() => toggleInArray(setSelectedDna, t)}
                      className="w-3 h-3 accent-purple-600"
                    />
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
                    <input
                      type="checkbox"
                      checked={selectedGq.includes(t)}
                      onChange={() => toggleInArray(setSelectedGq, t)}
                      className="w-3 h-3 accent-pink-600"
                    />
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
              type="button"
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
    </>
  );
};

// ================= CD SPECIFIC CONTENT =================
const CDAll = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const update = updateActiveTest;

  const {
    compound = '',
    experimentDate = '',
    concentration = '',
    solvent = '',
    saltConcentration = '',
    temperature = '',
    buffer = '',
    ph = '',
    pathLength = '1',
    otherMolecule = '',
    ratio = '',
    wavelengthData = '',
    spectraColumns = [],
    glbOffsetStr = ''
  } = activeTest;

  const dataImages = activeTest.dataImages || [];
  const structureComposition = activeTest.structureComposition || {
    'α-Helix': 30,
    'β-Sheet': 20,
    Turn: 10,
    'Random Coil': 40
  };
  const chartCfg = {
    yMin: '',
    yMax: '',
    xMin: '190',
    xMax: '260',
    fontSize: 12,
    lineWidth: 2,
    ...(activeTest.chartCfg || {})
  };

  const [newTitrationVariable, setNewTitrationVariable] = useState('');
  const fileInputRef = useRef(null);
  const dataImageInputRef = useRef(null);
  const importModeRef = useRef('replace');
  const gOff = parseNum(glbOffsetStr) || 0;

  // ===== TITRATION / VARIABLE PARAMETERS =====
  const titrationVariables = Array.isArray(activeTest.titrationVariables)
    ? activeTest.titrationVariables
    : ['Ratio', 'Concentration', 'Temperature'];
  const titrationRows = activeTest.titrationRows || [];
  const makeTitrationId = () => `tit_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const addTitrationVariable = () => {
    const name = newTitrationVariable.trim();
    if (!name || titrationVariables.includes(name)) return;
    update({ titrationVariables: [...titrationVariables, name] });
    setNewTitrationVariable('');
  };

  const removeTitrationVariable = (name) => {
    update({
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
    update({
      titrationVariables,
      titrationRows: [
        ...titrationRows,
        { id: makeTitrationId(), values, notes: '', metricValues: {}, spectrumId: '' }
      ]
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
      else if (key.includes('ph')) values[v] = ph || '';
      else if (key.includes('other') || key.includes('ligand') || key.includes('molecule'))
        values[v] = otherMolecule || '';
      else values[v] = '';
    });
    update({
      titrationVariables,
      titrationRows: [
        ...titrationRows,
        { id: makeTitrationId(), values, notes: '', metricValues: {}, spectrumId: '' }
      ]
    });
  };

  const updateTitrationRow = (id, updates) => {
    update({ titrationRows: titrationRows.map((row) => (row.id === id ? { ...row, ...updates } : row)) });
  };

  const updateTitrationRowValue = (id, variable, value) => {
    update({
      titrationRows: titrationRows.map((row) =>
        row.id === id ? { ...row, values: { ...(row.values || {}), [variable]: value } } : row
      )
    });
  };

  const duplicateTitrationRow = (row) => {
    update({ titrationRows: [...titrationRows, { ...row, id: makeTitrationId() }] });
  };

  const removeTitrationRow = (id) => {
    update({ titrationRows: titrationRows.filter((row) => row.id !== id) });
  };

  // ===== DATA / SPECTRA =====
  const parsedWavelengths = useMemo(() => {
    if (!wavelengthData) return [];
    return wavelengthData
      .split(/[\n,]+/)
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));
  }, [wavelengthData]);

  const parsedSpectra = useMemo(() => {
    return spectraColumns.map((col, idx) => {
      const values = (col.data || '')
        .split(/[\n,]+/)
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
      return { ...col, values, color: col.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length] };
    });
  }, [spectraColumns]);

  const addSpectrumColumn = () => {
    const newCol = {
      id: Date.now().toString(),
      title: `Spectrum ${spectraColumns.length + 1}`,
      data: '',
      color: SPECTRA_PALETTE[spectraColumns.length % SPECTRA_PALETTE.length],
      visible: true
    };
    update({ spectraColumns: [...spectraColumns, newCol] });
  };

  const updateSpectrumColumn = (id, updates) => {
    update({ spectraColumns: spectraColumns.map((c) => (c.id === id ? { ...c, ...updates } : c)) });
  };

  const removeSpectrumColumn = (id) => {
    update({
      spectraColumns: spectraColumns.filter((c) => c.id !== id),
      titrationRows: titrationRows.map((row) =>
        row.spectrumId === id ? { ...row, spectrumId: '' } : row
      )
    });
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
          const sameX =
            parsed.xs.length === baseX.length &&
            parsed.xs.every((x, i) => Math.abs(x - baseX[i]) < 0.01);
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
        baseX.length === parsedWavelengths.length &&
        baseX.every((x, i) => Math.abs(x - parsedWavelengths[i]) < 0.01);
      if (!sameAsCurrent) {
        alert(
          'Cannot append: imported wavelength axis does not match the current wavelength axis.\nUse Replace import or clear the current data.'
        );
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
      if (firstMeta.title && !compound) updates.compound = firstMeta.title;
      if (firstMeta.experimentDate && !experimentDate) updates.experimentDate = firstMeta.experimentDate;
      if (firstMeta.temperature && !temperature) updates.temperature = firstMeta.temperature;
      if (firstMeta.pathLength && !pathLength) updates.pathLength = firstMeta.pathLength;
      if (firstMeta.concentration && !concentration) updates.concentration = firstMeta.concentration;
    }
    update(updates);
    input.value = '';
  };

  // ===== DATA IMAGES =====
  const addDataImageLinks = () => {
    const urlsText = prompt('Paste external link(s) separated by commas to small images:');
    if (urlsText && urlsText.trim()) {
      const urls = urlsText.split(/[\s,]+/).filter((u) => u.trim() !== '');
      update({ dataImages: [...dataImages, ...urls] });
    }
  };

  const importDataImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    try {
      const imported = await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      update({ dataImages: [...dataImages, ...imported] });
    } catch (e) {
      console.error(e);
      alert('Image import failed.');
    }
  };

  // =====================================================================
  // ===== REPORT METRICS — values are READ from the uploaded spectra =====
  // =====================================================================
  const reportMetrics = Array.isArray(activeTest.reportMetrics) ? activeTest.reportMetrics : [];
  const [metricWavelength, setMetricWavelength] = useState('222');
  const [customMetricName, setCustomMetricName] = useState('');
  const [customMetricWavelength, setCustomMetricWavelength] = useState('');
  const [customMetricUnit, setCustomMetricUnit] = useState('mdeg');

  const addMetricAtWavelength = () => {
    const wl = metricWavelength.trim();
    if (!wl) return;
    const name = `CD Intensity at ${wl} nm`;
    if (reportMetrics.some((m) => m.name === name)) return;
    update({ reportMetrics: [...reportMetrics, makeMetric(name, { wavelength: wl, unit: 'mdeg' })] });
  };

  const addCustomMetric = () => {
    const name = customMetricName.trim();
    if (!name || reportMetrics.some((m) => m.name === name)) return;
    update({
      reportMetrics: [
        ...reportMetrics,
        makeMetric(name, { wavelength: customMetricWavelength, unit: customMetricUnit })
      ]
    });
    setCustomMetricName('');
    setCustomMetricWavelength('');
  };

  const removeMetric = (id) => {
    update({
      reportMetrics: reportMetrics.filter((m) => m.id !== id),
      titrationRows: titrationRows.map((row) => {
        const metricValues = { ...(row.metricValues || {}) };
        delete metricValues[id];
        return { ...row, metricValues };
      })
    });
  };

  const updateMetricRowValue = (rowId, metricId, value) => {
    update({
      titrationRows: titrationRows.map((row) =>
        row.id === rowId
          ? { ...row, metricValues: { ...(row.metricValues || {}), [metricId]: value } }
          : row
      )
    });
  };

  /**
   * Reads the CD value of a spectrum at a given wavelength.
   * - exact match if the wavelength exists in the data
   * - otherwise linear interpolation between the two nearest points
   * - out-of-range wavelengths clamp to the nearest endpoint
   * - the global baseline offset (same as the CD plot) is subtracted
   */
  const getCdValueAtWavelength = (spectrum, wl) => {
    if (!spectrum || wl === '' || wl === null || wl === undefined) return null;
    const target = parseNum(wl);
    if (isNaN(target)) return null;
    const xs = parsedWavelengths;
    const ys = spectrum.values || [];
    if (xs.length === 0 || ys.length === 0) return null;

    // normalize to ascending order (JASCO import already sorts, but be safe)
    let ax = xs;
    let ay = ys;
    if (xs.length > 1 && xs[0] > xs[xs.length - 1]) {
      ax = [...xs].reverse();
      ay = [...ys].reverse();
    }

    const exactIdx = ax.findIndex((x) => Math.abs(x - target) < 1e-9);
    if (exactIdx >= 0 && ay[exactIdx] !== undefined) return ay[exactIdx] - gOff;

    if (target <= ax[0]) return ay[0] !== undefined ? ay[0] - gOff : null;
    if (target >= ax[ax.length - 1]) {
      const last = ay[ax.length - 1];
      return last !== undefined ? last - gOff : null;
    }

    for (let i = 0; i < ax.length - 1; i++) {
      if (target >= ax[i] && target <= ax[i + 1]) {
        const x0 = ax[i];
        const x1 = ax[i + 1];
        const y0 = ay[i];
        const y1 = ay[i + 1];
        if (y0 === undefined || y1 === undefined) return null;
        const y = x1 === x0 ? y0 : y0 + ((target - x0) * (y1 - y0)) / (x1 - x0);
        return y - gOff;
      }
    }
    return null;
  };

  /** Returns the value shown/used for a metric on a given titration row. */
  const getRowMetricValue = (row, metric) => {
    if (!metric) return '';
    if (metric.mode === 'auto' && metric.wavelength) {
      const spectrum = parsedSpectra.find((s) => s.id === row.spectrumId);
      const v = getCdValueAtWavelength(spectrum, metric.wavelength);
      if (v === null || v === undefined || isNaN(v)) return '';
      return Math.round(v * 1000) / 1000;
    }
    const manual = (row.metricValues || {})[metric.id];
    return manual === undefined || manual === null ? '' : manual;
  };

  /** Link a spectrum to a titration point. */
  const updateRowSpectrum = (rowId, spectrumId) => {
    update({
      titrationRows: titrationRows.map((row) =>
        row.id === rowId ? { ...row, spectrumId } : row
      )
    });
  };

  /** Assign spectra to points in order (spectrum #1 → point #1, etc.). */
  const autoLinkSpectraToRows = () => {
    update({
      titrationRows: titrationRows.map((row, idx) => ({
        ...row,
        spectrumId: spectraColumns[idx] ? spectraColumns[idx].id : row.spectrumId || ''
      }))
    });
  };

  // ===== REPORT GRAPH CONFIG (persistent, mirrors the CD chart config) =====
  const reportChartCfg = {
    xMin: '',
    xMax: '',
    yMin: '',
    yMax: '',
    fontSize: 12,
    lineWidth: 2,
    pointSize: 4,
    pointStyle: 'circle',
    showLine: true,
    showGrid: true,
    lineColor: '#7c3aed',
    ...(activeTest.reportChartCfg || {})
  };
  const updateReportCfg = (updates) =>
    update({ reportChartCfg: { ...reportChartCfg, ...updates } });

  // ===== REPORT GRAPH DATA (single source of truth) =====
  const [reportXVar, setReportXVar] = useState('');
  const [reportYMetricId, setReportYMetricId] = useState('');
  const reportChartRef = useRef(null);
  const reportChart = useRef(null);

  const reportXVarEff = reportXVar || titrationVariables[0] || '';
  const reportYMetric =
    reportMetrics.find((m) => m.id === reportYMetricId) || reportMetrics[0] || null;

  const reportRowStatus = useMemo(() => {
    if (!reportYMetric) return [];
    return titrationRows.map((row, idx) => {
      const x = parseXValue((row.values || {})[reportXVarEff]);
      const y = parseNum(getRowMetricValue(row, reportYMetric));
      const spectrum = parsedSpectra.find((s) => s.id === row.spectrumId);
      let status = 'ok';
      let reason = '';
      if (!reportXVarEff || isNaN(x)) {
        status = 'skip';
        reason = reportXVarEff ? `Invalid ${reportXVarEff}` : 'No X variable';
      } else if (isNaN(y)) {
        status = 'skip';
        reason = reportYMetric.mode === 'auto'
          ? (spectrum ? `No data at ${reportYMetric.wavelength} nm` : 'No spectrum linked')
          : 'No value entered';
      }
      return { idx: idx + 1, x, y, spectrumTitle: spectrum ? spectrum.title : '—', status, reason };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titrationRows, reportXVarEff, reportYMetric, parsedSpectra, parsedWavelengths, gOff]);

  const reportPoints = useMemo(() => {
    return reportRowStatus
      .filter((r) => r.status === 'ok')
      .map((r) => ({ x: r.x, y: r.y, rowIdx: r.idx }))
      .sort((a, b) => a.x - b.x);
  }, [reportRowStatus]);

  // ===== CHARTS =====
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
          .map((w, i) => ({
            x: w,
            y: s.values[i] !== undefined ? s.values[i] - gOff : null
          }))
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
  }, [parsedWavelengths, parsedSpectra, chartCfg, gOff]);

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

  // ===== REPORT GRAPH CHART (fully customizable) =====
  useEffect(() => {
    if (!reportChartRef.current) return;
    if (reportChart.current) reportChart.current.destroy();
    reportChart.current = null;
    if (!reportYMetric) return;

    const fontSize = parseFloat(reportChartCfg.fontSize) || 12;
    const lineWidth = parseFloat(reportChartCfg.lineWidth) || 2;
    const pointSize = parseFloat(reportChartCfg.pointSize) || 4;
    const pointStyle = reportChartCfg.pointStyle || 'circle';
    const showLine = reportChartCfg.showLine !== false;
    const showGrid = reportChartCfg.showGrid !== false;
    const color = reportChartCfg.lineColor || '#7c3aed';
    const num = (v) => (v !== '' && v !== undefined && !isNaN(parseFloat(v)) ? parseFloat(v) : undefined);

    reportChart.current = new Chart(reportChartRef.current, {
      type: 'line',
      data: {
        datasets: [{
          label: reportYMetric.name,
          data: reportPoints,
          borderColor: color,
          backgroundColor: color + '33',
          pointBackgroundColor: color,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 1,
          pointStyle,
          pointRadius: pointSize,
          pointHoverRadius: pointSize + 2,
          showLine: showLine && reportPoints.length > 1,
          borderWidth: lineWidth,
          tension: 0.15,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: num(reportChartCfg.xMin),
            max: num(reportChartCfg.xMax),
            title: { display: true, text: reportXVarEff, font: { size: fontSize + 2, weight: 'bold' }, color: '#334155' },
            ticks: { font: { size: fontSize }, color: '#64748b' },
            grid: { color: showGrid ? '#f1f5f9' : 'rgba(0,0,0,0)' }
          },
          y: {
            min: num(reportChartCfg.yMin),
            max: num(reportChartCfg.yMax),
            title: {
              display: true,
              text: `${reportYMetric.name}${reportYMetric.unit ? ` (${reportYMetric.unit})` : ''}`,
              font: { size: fontSize + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: { font: { size: fontSize }, color: '#64748b' },
            grid: { color: showGrid ? '#f1f5f9' : 'rgba(0,0,0,0)' }
          }
        },
        plugins: {
          legend: { position: 'top', labels: { font: { size: fontSize, weight: 'bold' }, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (c) => `Point ${c[0].raw.rowIdx}`,
              label: (c) =>
                `${reportXVarEff} = ${c.parsed.x} → ${reportYMetric.name} = ${c.parsed.y} ${reportYMetric.unit || ''}`.trim()
            }
          }
        }
      }
    });

    return () => {
      if (reportChart.current) reportChart.current.destroy();
    };
  }, [reportPoints, reportXVarEff, reportYMetric, reportChartCfg]);

  // ===== EXPORT =====
  const exportXLS = () => {
    try {
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
        const metricHeaders = reportMetrics.map(
          (m) => `${m.name}${m.unit ? ` (${m.unit})` : ''}${m.mode === 'auto' ? ' [auto]' : ''}`
        );
        const titrationAoa = [
          ['Point', 'Linked Spectrum', ...titrationVariables, ...metricHeaders, 'Notes']
        ];
        titrationRows.forEach((row, idx) => {
          const linked = spectraColumns.find((s) => s.id === row.spectrumId);
          titrationAoa.push([
            idx + 1,
            linked ? linked.title : '',
            ...titrationVariables.map((v) => (row.values || {})[v] || ''),
            ...reportMetrics.map((m) => getRowMetricValue(row, m)),
            row.notes || ''
          ]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(titrationAoa), 'Titration Conditions');
      }

      if (reportYMetric && reportPoints.length > 0) {
        const repAoa = [[reportXVarEff, reportYMetric.name]];
        reportPoints.forEach((p) => repAoa.push([p.x, p.y]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(repAoa), 'Report Graph Data');
      }

      const fname = `CD_${(compound || 'experiment').replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.error(e);
      alert(`Export Failed: ${e.message}`);
    }
  };

  // ===== SECONDARY STRUCTURE FITTING =====
  const autoFitSecondaryStructure = () => {
    // 1. Grab the first visible spectrum that contains data
    const targetSpec = parsedSpectra.find((s) => s.visible && s.values.length > 0);
    if (!targetSpec) {
      alert('Please ensure at least one CD spectrum is uploaded and visible.');
      return;
    }

    // 2. Build the matrices for the least-squares fit (A*c = b)
    const A = [];
    const b = [];
    
    parsedWavelengths.forEach((x, i) => {
      // Fit exclusively within the standard secondary structure range
      if (x >= 190 && x <= 260) {
        A.push([
          splineAlpha.at(x), 
          splineBeta.at(x), 
          splineTurn.at(x), 
          splineCoil.at(x)
        ]);
        // Apply the global baseline offset if one is set
        b.push(targetSpec.values[i] !== undefined ? targetSpec.values[i] - gOff : 0);
      }
    });

    if (A.length < 4) {
      alert('Not enough data points in the 190-260 nm range for a reliable fit.');
      return;
    }

    // 3. Compute AtA and Atb
    const AtA = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => A.reduce((sum, row) => sum + row[i] * row[j], 0)));
    const Atb = [0, 1, 2, 3].map((i) => A.reduce((sum, row, idx) => sum + row[i] * b[idx], 0));

    // 4. Gaussian elimination solver
    const gaussSolve = (mat, vec) => {
      const n = vec.length;
      const M = mat.map((row, i) => [...row, vec[i]]);
      for (let i = 0; i < n; i++) {
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
        }
        [M[i], M[maxRow]] = [M[maxRow], M[i]];
        if (Math.abs(M[i][i]) < 1e-12) return null; // Singular matrix
        
        for (let k = i + 1; k < n; k++) {
          const factor = M[k][i] / M[i][i];
          for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
        }
      }
      const x = new Array(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let sum = M[i][n];
        for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
        x[i] = sum / M[i][i];
      }
      return x;
    };

    const coeffs = gaussSolve(AtA, Atb);
    if (!coeffs) {
      alert('Fitting failed (singular matrix).');
      return;
    }

    // 5. Force non-negativity and normalize to 100%
    const clamped = coeffs.map((c) => Math.max(0, c));
    const sum = clamped.reduce((a, val) => a + val, 0);
    
    if (sum === 0) {
      alert('Fitting resulted in zero for all components. Check your data scale or baseline.');
      return;
    }

    const norm = clamped.map((c) => Math.round((c / sum) * 100));
    
    // 6. Absorb rounding errors so the total is exactly 100%
    const diff = 100 - norm.reduce((a, b) => a + b, 0);
    if (diff !== 0) {
      const maxIdx = norm.indexOf(Math.max(...norm));
      norm[maxIdx] += diff;
    }

    // 7. Push the new structure directly to the doughnut chart
    update({
      structureComposition: {
        'α-Helix': norm[0],
        'β-Sheet': norm[1],
        Turn: norm[2],
        'Random Coil': norm[3]
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center justify-end gap-3 no-print">
        <button
          onClick={exportXLS}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
        >
          📊 Export XLS
        </button>
      </div>

      {/* Experiment Setup */}
      <CollapsibleSection title="Experiment Setup" icon="⚙️">
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
              <button
                type="button"
                onClick={autoLinkSpectraToRows}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
                title="Assigns spectrum #1 to point #1, spectrum #2 to point #2, and so on"
              >
                🔗 Auto-Link Spectra to Points
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

          {/* ===== REPORT METRICS — what the Graph section will plot ===== */}
          <div className="border border-purple-200 bg-purple-50 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-purple-800 uppercase">
                📌 Report Metrics — what to plot in the Graph section
              </label>
              <span className="text-[9px] bg-purple-200 text-purple-800 px-2 py-0.5 rounded">
                e.g. CD intensity at 222 nm
              </span>
            </div>
            <p className="text-[10px] text-purple-700 leading-4">
              Metrics with a wavelength (<b>AUTO</b>) are read automatically from the spectrum linked to each
              titration point (interpolated at the chosen wavelength, baseline-offset corrected). Only metrics
              without a wavelength (<b>MANUAL</b>) require hand-entered values.
            </p>

            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Wavelength (nm)</label>
                <input
                  type="number"
                  value={metricWavelength}
                  onChange={(e) => setMetricWavelength(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 w-32 bg-white"
                  placeholder="222"
                />
              </div>
              <button
                type="button"
                onClick={addMetricAtWavelength}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + CD Intensity at λ
              </button>

              <div className="flex flex-col gap-1 ml-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Custom metric name</label>
                <input
                  type="text"
                  value={customMetricName}
                  onChange={(e) => setCustomMetricName(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 w-56 bg-white"
                  placeholder="e.g. Tm, ellipticity..."
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">λ (opt. → auto)</label>
                <input
                  type="number"
                  value={customMetricWavelength}
                  onChange={(e) => setCustomMetricWavelength(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 w-28 bg-white"
                  placeholder="nm"
                />
              </div>
              <select
                value={customMetricUnit}
                onChange={(e) => setCustomMetricUnit(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white outline-none focus:border-purple-500"
              >
                {REPORT_METRIC_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={addCustomMetric}
                className="bg-slate-600 hover:bg-slate-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + Custom Metric
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {reportMetrics.length === 0 && (
                <span className="text-xs text-slate-400 italic">
                  No report metrics defined. Add one to enable the Report Graph.
                </span>
              )}
              {reportMetrics.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-2 bg-white border border-purple-300 px-2.5 py-1 rounded-lg text-xs font-bold text-purple-800 shadow-sm"
                >
                  {m.name}{m.unit ? ` (${m.unit})` : ''}
                  <span
                    className={`text-[8px] font-black px-1 rounded ${
                      m.mode === 'auto' ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {m.mode === 'auto' ? 'AUTO' : 'MANUAL'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMetric(m.id)}
                    className="text-purple-400 hover:text-red-500 font-black"
                    title={`Remove metric ${m.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-12 border-b border-slate-200">#</th>
                  {titrationVariables.map((v) => (
                    <th key={v} className="px-3 py-2 font-bold text-blue-700 whitespace-nowrap border-b border-slate-200">
                      {v}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap border-b border-slate-200 bg-slate-50">
                    🔗 Linked Spectrum
                  </th>
                  {reportMetrics.map((m) => (
                    <th
                      key={m.id}
                      className="px-3 py-2 font-bold text-purple-700 whitespace-nowrap border-b border-slate-200 bg-purple-50"
                    >
                      📌 {m.name}{m.unit ? ` (${m.unit})` : ''}
                      {m.mode === 'auto' && <span className="ml-1 text-[8px] bg-purple-600 text-white px-1 rounded">AUTO</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2 min-w-[180px] border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 w-32 border-b border-slate-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {titrationRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={titrationVariables.length + reportMetrics.length + 4}
                      className="px-3 py-10 text-center text-slate-400 italic"
                    >
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
                      <td className="px-3 py-2 bg-slate-50/50">
                        <select
                          value={row.spectrumId || ''}
                          onChange={(e) => updateRowSpectrum(row.id, e.target.value)}
                          className="w-full min-w-[140px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white"
                        >
                          <option value="">— no spectrum —</option>
                          {spectraColumns.map((s) => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                          ))}
                        </select>
                      </td>
                      {reportMetrics.map((m) => {
                        if (m.mode === 'auto') {
                          const val = getRowMetricValue(row, m);
                          return (
                            <td key={m.id} className="px-3 py-2 bg-purple-50/40">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-mono text-sm font-bold ${
                                    val === '' ? 'text-slate-400 italic' : 'text-purple-800'
                                  }`}
                                  title={val === '' ? 'Link a spectrum containing this wavelength' : `Read at ${m.wavelength} nm`}
                                >
                                  {val === '' ? 'no data' : val}
                                </span>
                                <span className="text-[8px] font-black bg-purple-600 text-white px-1 rounded">AUTO</span>
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={m.id} className="px-3 py-2 bg-purple-50/40">
                            <input
                              type="text"
                              value={(row.metricValues || {})[m.id] || ''}
                              onChange={(e) => updateMetricRowValue(row.id, m.id, e.target.value)}
                              className="w-full min-w-[90px] border border-purple-200 rounded-md px-2 py-1.5 text-sm outline-none focus:border-purple-500"
                              placeholder={m.unit || 'value'}
                            />
                          </td>
                        );
                      })}
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
                          <button
                            type="button"
                            onClick={() => duplicateTitrationRow(row)}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800"
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTitrationRow(row.id)}
                            className="text-xs font-bold text-red-500 hover:text-red-700"
                          >
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

      {/* Data */}
      <CollapsibleSection title="Data" icon="🔢">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.csv,.asc,.dcm"
          multiple
          className="hidden"
          onChange={importJascoFiles}
        />
        <input
          ref={dataImageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            importDataImageFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col gap-4">
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-blue-800 uppercase">JASCO / TXT Import</div>
                <p className="text-[10px] text-blue-700 mt-1">
                  Imports the CD [mdeg] channel from JASCO .txt files, converts the wavelength axis to ascending
                  order, and fills sample metadata when available. Imported spectra can then be linked to
                  titration points so report metrics are read automatically.
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
              onChange={(e) => update({ wavelengthData: e.target.value })}
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
                No spectra added yet. Click “Add Spectrum” or import JASCO files.
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
                        <span className="text-amber-600 font-bold">
                          ⚠️ Mismatch with {parsedWavelengths.length} wavelengths
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-600 uppercase">🖼️ Small Image Attachments (Data)</label>
              <div className="flex gap-2">
                <button
                  onClick={() => dataImageInputRef.current?.click()}
                  className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
                >
                  📁 Import Images
                </button>
                <button
                  onClick={addDataImageLinks}
                  className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-bold px-3 py-1.5 rounded text-xs shadow-sm"
                >
                  🔗 Add Image Links
                </button>
              </div>
            </div>
            {dataImages.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No small images attached to the data.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {dataImages.map((imgSrc, idx) => (
                  <div key={idx} className="relative group">
                    <div className="cursor-pointer border border-slate-200 rounded-lg p-1 bg-white shadow-sm">
                      <SmartImage
                        src={imgSrc}
                        alt={`Data img ${idx + 1}`}
                        style={{ maxHeight: '110px', maxWidth: '160px' }}
                      />
                    </div>
                    <button
                      onClick={() => update({ dataImages: dataImages.filter((_, i) => i !== idx) })}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow opacity-0 group-hover:opacity-100 transition-opacity no-print"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* Fitting */}
      <CollapsibleSection title="Fitting" icon="📐">
        <div className="flex flex-col gap-6">
          <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
            <div className="flex flex-col gap-4 max-w-2xl">
              <p className="text-sm text-slate-500">
                CD spectra are single measurements per spectrum, so there is no replicate-based SD. Use the controls
                below for baseline correction and to include/exclude individual spectra from the plot and analysis.
                The baseline offset is also applied to AUTO report metric values.
              </p>
              <div className="flex flex-col gap-1 max-w-xs">
                <label className="text-xs font-bold text-slate-600">
                  Global Baseline Offset (subtract from all spectra, mdeg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={glbOffsetStr}
                  onChange={(e) => update({ glbOffsetStr: e.target.value })}
                  className="border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. 0 or -12.5"
                />
              </div>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <label className="text-xs font-bold text-slate-600 uppercase block mb-2">Include / Exclude Spectra</label>
                {parsedSpectra.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No spectra to manage. Add spectra in the Data section.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {parsedSpectra.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm"
                      >
                        <input
                          type="checkbox"
                          checked={s.visible}
                          onChange={(e) => updateSpectrumColumn(s.id, { visible: e.target.checked })}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-sm font-bold text-slate-700">{s.title}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">{s.values.length} pts</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
            {/* ===== REPORT GRAPH — Titration / Melting Curve ===== */}
            <div className="border border-purple-200 bg-white rounded-xl p-5 flex flex-col mb-6 shadow-sm">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-purple-100 pb-3">
                <div className="flex items-start gap-2">
                  <span className="text-xl">📌</span>
                  <div>
                    <h2 className="text-sm font-bold text-purple-700 uppercase tracking-widest">
                      Report Graph — Titration / Melting Curve
                    </h2>
                    <p className="text-[11px] text-slate-500 max-w-xl mt-0.5">
                      Plots a Setup-defined readout (e.g. CD intensity at 222 nm) against an experimental
                      variable (e.g. Temperature). Y values are read automatically from the linked spectra.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => updateReportCfg({ xMin: '', xMax: '', yMin: '', yMax: '' })}
                  className="text-[10px] font-bold text-slate-500 hover:text-purple-700 bg-slate-50 hover:bg-purple-50 border border-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  ⟳ Reset axes
                </button>
              </div>

              {/* Axis selectors + color */}
              <div className="flex flex-wrap items-end gap-4 mb-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">X axis — Experimental variable</label>
                  <select
                    value={reportXVarEff}
                    onChange={(e) => setReportXVar(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-purple-500 font-semibold min-w-[160px]"
                  >
                    {titrationVariables.length === 0 && <option value="">No variables</option>}
                    {titrationVariables.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Y axis — Reported metric</label>
                  <select
                    value={reportYMetric ? reportYMetric.id : ''}
                    onChange={(e) => setReportYMetricId(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-purple-500 font-semibold min-w-[200px]"
                  >
                    {reportMetrics.length === 0 && <option value="">No metrics — add one in Setup</option>}
                    {reportMetrics.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}{m.unit ? ` (${m.unit})` : ''}{m.mode === 'auto' ? ' • auto' : ' • manual'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Line / point color</label>
                  <input
                    type="color"
                    value={reportChartCfg.lineColor || '#7c3aed'}
                    onChange={(e) => updateReportCfg({ lineColor: e.target.value })}
                    className="w-12 h-9 rounded border border-slate-300 cursor-pointer bg-white"
                  />
                </div>
              </div>

              {/* Customization panel */}
              <div className="border border-purple-100 bg-purple-50/40 rounded-lg p-3 mb-4">
                <div className="text-[10px] font-bold text-purple-700 uppercase mb-2">Chart customization</div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                  {[
                    ['X min', 'xMin'], ['X max', 'xMax'], ['Y min', 'yMin'], ['Y max', 'yMax'],
                    ['Font size', 'fontSize'], ['Line width', 'lineWidth'], ['Point size', 'pointSize']
                  ].map(([lbl, k]) => (
                    <div key={k} className="flex flex-col gap-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">{lbl}</label>
                      <input
                        type="number"
                        placeholder={k === 'fontSize' ? '12' : k === 'lineWidth' ? '2' : k === 'pointSize' ? '4' : 'Auto'}
                        value={reportChartCfg[k]}
                        onChange={(e) => updateReportCfg({ [k]: e.target.value })}
                        className="border border-slate-300 rounded-md px-2 py-1.5 text-xs outline-none focus:border-purple-500 bg-white w-full"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase">Point style</label>
                    <select
                      value={reportChartCfg.pointStyle}
                      onChange={(e) => updateReportCfg({ pointStyle: e.target.value })}
                      className="border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white outline-none focus:border-purple-500"
                    >
                      {['circle', 'rect', 'rectRot', 'triangle', 'star', 'cross'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 mt-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportChartCfg.showLine !== false}
                      onChange={(e) => updateReportCfg({ showLine: e.target.checked })}
                      className="w-3.5 h-3.5 accent-purple-600"
                    />
                    Connect with line
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reportChartCfg.showGrid !== false}
                      onChange={(e) => updateReportCfg({ showGrid: e.target.checked })}
                      className="w-3.5 h-3.5 accent-purple-600"
                    />
                    Show grid
                  </label>
                </div>
              </div>

              {/* Data preview */}
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-600 uppercase">
                    Data preview — {reportPoints.length} point{reportPoints.length === 1 ? '' : 's'} plotted
                  </span>
                  {reportRowStatus.some((r) => r.status === 'skip') && (
                    <span className="text-[10px] font-bold text-amber-600">
                      ⚠️ {reportRowStatus.filter((r) => r.status === 'skip').length} skipped
                    </span>
                  )}
                </div>
                <div className="max-h-40 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-xs text-left">
                    <thead className="text-[9px] text-slate-400 uppercase bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5">#</th>
                        <th className="px-3 py-1.5">{reportXVarEff || 'X'}</th>
                        <th className="px-3 py-1.5">{reportYMetric ? reportYMetric.name : 'Y'}</th>
                        <th className="px-3 py-1.5">Linked spectrum</th>
                        <th className="px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportRowStatus.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-slate-400 italic">
                            Add a metric and titration points to see data here.
                          </td>
                        </tr>
                      ) : (
                        reportRowStatus.map((r) => (
                          <tr key={r.idx} className={r.status === 'skip' ? 'bg-amber-50/50' : 'bg-white'}>
                            <td className="px-3 py-1.5 font-bold text-slate-400">{r.idx}</td>
                            <td className="px-3 py-1.5 font-mono">
                              {isNaN(r.x) ? <span className="text-slate-300">—</span> : r.x}
                            </td>
                            <td className="px-3 py-1.5 font-mono">
                              {isNaN(r.y) ? <span className="text-slate-300">—</span> : r.y}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{r.spectrumTitle}</td>
                            <td className="px-3 py-1.5">
                              {r.status === 'ok'
                                ? <span className="text-emerald-600 font-bold">✓ plotted</span>
                                : <span className="text-amber-600 font-bold" title={r.reason}>⚠ {r.reason}</span>}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Chart */}
              <div className="relative flex-1" style={{ minHeight: '360px' }}>
                <canvas ref={reportChartRef}></canvas>
              </div>
              {(reportPoints.length === 0 || !reportYMetric) && (
                <p className="text-xs text-slate-400 italic mt-2 text-center">
                  No points to plot yet. Define a metric in Experiment Setup, link each titration point to a
                  spectrum, and enter numeric X values (ratios like “1:2” are converted automatically).
                </p>
              )}
            </div>

            {/* CD spectra chart config */}
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
                    onChange={(e) => update({ chartCfg: { ...chartCfg, [k]: e.target.value } })}
                    className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Font Size</label>
                <input
                  type="number"
                  value={chartCfg.fontSize}
                  onChange={(e) => update({ chartCfg: { ...chartCfg, fontSize: parseFloat(e.target.value) || 12 } })}
                  className="border border-slate-300 rounded-md p-2 text-sm outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Line Thickness</label>
                <input
                  type="number"
                  value={chartCfg.lineWidth}
                  onChange={(e) => update({ chartCfg: { ...chartCfg, lineWidth: parseFloat(e.target.value) || 2 } })}
                  className="border border-slate-300 rounded-md p-2 text-sm outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col lg:flex-row gap-6">
              <div className="flex-[3] min-w-0 flex flex-col">
                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest mb-3">CD Spectra Plot</h2>
                <div className="flex-1 relative min-h-0" style={{ minHeight: '400px' }}>
                  <canvas ref={cdChartRef}></canvas>
                </div>
              </div>
              <div className="flex-[2] min-w-0 flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Secondary Structure</h2>
                  <button
                    onClick={autoFitSecondaryStructure}
                    className="bg-purple-100 hover:bg-purple-200 text-purple-700 font-bold px-3 py-1 rounded text-[10px] shadow-sm transition-colors flex items-center gap-1"
                    title="Fit the first visible spectrum using reference splines"
                  >
                    <span>✨</span> Auto-Fit Spectrum
                  </button>
                </div>
                <div
                  className="flex-1 relative min-h-0 flex flex-col items-center justify-center"
                  style={{ minHeight: '300px' }}
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
                            update({ structureComposition: newComp });
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
        </div>
      </CollapsibleSection>

      {/* Simulations */}
      <CollapsibleSection title="Simulations" icon="🧬" defaultOpen={false}>
        <div className="flex flex-col gap-6">
          <ProteinCDMixer />
          <CDSpectraLibrary />
        </div>
      </CollapsibleSection>
    </div>
  );
};

// ================= NOTEBOOK EXPORT =================
const parseNumericList = (str) => {
  if (!str) return [];
  return str
    .split(/[\n,]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
};

const buildCdNotebookHtml = (checked, ctx) => {
  const t = ctx.activeTest || {};
  const selectedCompounds = ctx.selectedCompounds || [];
  const cellLines = ctx.cellLines || [];
  let html = '';

  if (checked.cond) {
    const protTitles =
      (t.linkedProtocolIds || [])
        .map((id) => (ctx.datasetProtocols || []).find((p) => p.id === id)?.title)
        .filter(Boolean)
        .join(', ') || 'N/A';
    html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
      <b>Sample:</b> ${(selectedCompounds.length ? selectedCompounds.join(', ') : t.compound) || 'N/A'} |
      <b>Cell lines:</b> ${cellLines.join(', ') || 'N/A'} |
      <b>Conc:</b> ${t.concentration || 'N/A'} |
      <b>Buffer:</b> ${t.buffer || t.solvent || 'N/A'} |
      <b>pH:</b> ${t.ph || 'N/A'} |
      <b>Temp:</b> ${t.temperature || 'N/A'} |
      <b>Path:</b> ${t.pathLength || 'N/A'} mm |
      <b>Protocols:</b> ${protTitles}
    </p>`;
  }

  if (checked.struct) {
    const structureComposition = t.structureComposition || {};
    html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">
      <tr style="background-color: #f1f5f9;">
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Structure</th>
        <th style="padding: 6px; border: 1px solid #cbd5e1;">Percentage</th>
      </tr>`;
    Object.entries(structureComposition).forEach(([k, v]) => {
      html += `<tr>
        <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${k}</b></td>
        <td style="padding: 6px; border: 1px solid #e2e8f0;">${v}%</td>
      </tr>`;
    });
    html += `</table>`;
  }

  if (checked.spectra) {
    const xs = parseNumericList(t.wavelengthData);
    const spectraColumns = t.spectraColumns || [];
    if (spectraColumns.length > 0) {
      html += `<p style="font-size: 12px; color: #475569; margin-top: 10px;">
        <b>Spectra recorded:</b> ${spectraColumns.map((s) => s.title).join(', ')}
      </p>`;
      html += `<p style="font-size: 11px; color: #64748b;">
        Wavelength range: ${xs.length > 0 ? `${Math.min(...xs)} - ${Math.max(...xs)} nm` : 'N/A'}
        (${xs.length} points)
      </p>`;
    }
  }

  return html;
};

// ================= MAIN CD RENDERER =================
export const CDTestRenderer = (props) => {
  // Categories defined in App → Definitions & Labels take priority
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : CD_TAB_CONFIG.categories || [
          'Activity', 'Toxicity', 'Structure', 'Binding', 'Characterization'
        ];

  const config = { ...CD_TAB_CONFIG, categories: appCategories };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={{
        All: CDAll,
        buildNotebookHtml: buildCdNotebookHtml
      }}
      testCategories={appCategories}
    />
  );
};

export default CDTestRenderer;
