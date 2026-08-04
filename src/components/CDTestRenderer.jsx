import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { RichTextEditor } from './RichTextEditor';

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

// ================= REUSABLE MULTI-SELECT DROPDOWN =================
const MultiSelectDropdown = ({ options, selected, onToggle, onClear, placeholder, accent = 'blue' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const accentBg = accent === 'emerald' ? 'bg-emerald-100 border-emerald-300 text-emerald-900' : 'bg-blue-100 border-blue-300 text-blue-900';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500 flex items-center justify-between gap-3 shadow-sm"
      >
        <span className={`truncate ${selected.length ? 'font-bold text-slate-800' : 'text-slate-400'}`}>
          {selected.length ? selected.join(', ') : placeholder}
        </span>
        <span className="text-slate-500 font-bold">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-56 overflow-y-auto custom-scrollbar">
          {(options || []).length === 0 ? (
            <div className="p-3 text-sm text-slate-400 italic">No options defined. Add them in Definitions & Labels.</div>
          ) : (
            (options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => onToggle(opt)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className={`text-sm ${selected.includes(opt) ? 'font-bold text-slate-800' : 'text-slate-700'}`}>{opt}</span>
              </label>
            ))
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selected.map((opt) => (
            <span key={opt} className={`inline-flex items-center gap-1 border px-2 py-1 rounded-lg text-xs font-bold ${accentBg}`}>
              {opt}
              <button type="button" onClick={() => onToggle(opt)} className="hover:text-red-600 font-black" title={`Remove ${opt}`}>×</button>
            </span>
          ))}
          {onClear && (
            <button type="button" onClick={onClear} className="text-xs font-bold text-red-500 hover:text-red-700 underline">
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ================= COLLAPSIBLE SECTION =================
export const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = '' }) => {
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

// ================= IMAGE URL NORMALIZATION =================
const normalizeImageCandidates = (url) => {
  const u = (url || '').trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }
  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }
  if (u.includes('dropbox.com')) {
    return [u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1'), u];
  }
  return [u];
};
const SmartImage = ({ src, alt, style }) => {
  const cands = useMemo(() => normalizeImageCandidates(src), [src]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setIdx(0); setFailed(false); }, [src]);
  if (failed) {
    return (
      <div className="w-full flex flex-col items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded text-slate-400 text-xs text-center px-4 py-6" style={style || { minHeight: '150px', maxHeight: '400px' }}>
        ⚠️ Preview not available. If the file is private, set it to "Anyone with the link can view".
      </div>
    );
  }
  return (
    <img
      src={cands[Math.min(idx, cands.length - 1)]}
      alt={alt}
      className="w-full h-auto object-contain rounded bg-white"
      style={style || { minHeight: '150px', maxHeight: '400px' }}
      onError={() => { if (idx < cands.length - 1) setIdx(idx + 1); else setFailed(true); }}
    />
  );
};

// ================= SPLINE + CD REFERENCE (for simulators) =================
class NaturalCubicSpline {
  constructor(xs, ys) {
    this.xs = xs; this.ys = ys; this.n = xs.length;
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
      alpha[i] = (3 / h[i]) * (this.a[i + 1] - this.a[i]) - (3 / h[i - 1]) * (this.a[i] - this.a[i - 1]);
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
      this.b[j] = (this.a[j + 1] - this.a[j]) / h[j] - (h[j] * (this.c[j + 1] + 2 * this.c[j])) / 3;
      this.d[j] = (this.c[j + 1] - this.c[j]) / (3 * h[j]);
    }
  }
  at(x) {
    let i = 0;
    if (x >= this.xs[this.n - 1]) i = this.n - 2;
    else if (x <= this.xs[0]) i = 0;
    else {
      let low = 0, high = this.n - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.xs[mid] < x) low = mid + 1; else high = mid - 1;
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
    const m = line.match(/^([A-Za-z0-9/.\-() ]{2,60}?)\s+(.*)$/);
    if (m && !/^\d/.test(m[1])) meta[m[1].trim()] = m[2].trim();
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#####')) { inData = false; continue; }
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

// ================= PROTEIN CD MIXER (SIMULATION) =================
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
    const W = width, H = height;
    const wavelengths = [];
    const values = [];
    const pA = compositions.helix / 100;
    const pB = compositions.sheet / 100;
    const pT = compositions.turn / 100;
    const pC = compositions.coil / 100;
    for (let w = 176; w <= 260; w += 1) {
      wavelengths.push(w);
      const cd = splineAlpha.at(w) * pA + splineBeta.at(w) * pB + splineTurn.at(w) * pT + splineCoil.at(w) * pC;
      values.push(cd);
    }
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;
    const xMin = 176, xMax = 260;
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
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(pad.left + plotW, zeroY); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#8e44ad'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    wavelengths.forEach((w, i) => {
      const px = pad.left + ((w - xMin) / (xMax - xMin)) * plotW;
      const py = pad.top + plotH - ((values[i] - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
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
        <h4 className="font-bold text-slate-700 flex items-center gap-2"><span>🧬</span> Protein Secondary Structure Simulator</h4>
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
                <input type="range" min="0" max="100" value={val} onChange={(e) => updateComp(key, parseInt(e.target.value, 10))} className="w-full h-2 rounded-lg appearance-none cursor-pointer" style={{ accentColor: colors[key] }} />
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
              <input type="checkbox" checked={autoNormalize} onChange={(e) => setAutoNormalize(e.target.checked)} className="w-3 h-3 accent-blue-600" />
              Auto-normalize to 100%
            </label>
            <button onClick={() => setCompositions({ helix: 0, sheet: 0, turn: 0, coil: 100 })} className="mt-2 w-full text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors">
              Reset to 100% Coil
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ================= MAIN CD TEST RENDERER =================
export const CDTestRenderer = ({
  activeTest,
  updateActiveTest,
  appClipboard,
  setAppClipboard,
  TestHeader,
  datasetProtocols,
  jumpToProtocol,
  allCmpds,
  allCellLines,
  customFields,
  testCategories
}) => {
  const updatePlate = (updates) => updateActiveTest(updates);
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
    linkedProtocolId = '',
    comments = '',
    images = [],
    documents = [],
    dataImages = [],
    wavelengthData = '',
    spectraColumns = [],
    structureComposition = { 'α-Helix': 30, 'β-Sheet': 20, Turn: 10, 'Random Coil': 40 },
    chartCfg = { yMin: '', yMax: '', xMin: '190', xMax: '260', fontSize: 12, lineWidth: 2 },
    glbOffsetStr = ''
  } = activeTest;

  const cellLines = activeTest.cellLines || [];
  const testCategory = activeTest.testCategory || 'Activity';
  const customFieldValues = activeTest.customFieldValues || {};

  const [fsPanel, setFsPanel] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const [newTitrationVariable, setNewTitrationVariable] = useState('');
  const fileInputRef = useRef(null);
  const dataImageInputRef = useRef(null);
  const importModeRef = useRef('replace');

  const gOff = parseFloat(String(glbOffsetStr).replace(',', '.')) || 0;

  // ===== MULTI-PROTOCOL =====
  const linkedProtocolIds = activeTest.linkedProtocolIds || (linkedProtocolId ? [linkedProtocolId] : []);
  const addLinkedProtocol = (id) => {
    if (!id || linkedProtocolIds.includes(id)) return;
    const upd = [...linkedProtocolIds, id];
    updatePlate({ linkedProtocolIds: upd, linkedProtocolId: upd[0] });
  };
  const removeLinkedProtocol = (id) => {
    const upd = linkedProtocolIds.filter((p) => p !== id);
    updatePlate({ linkedProtocolIds: upd, linkedProtocolId: upd[0] || '' });
  };

  // ===== TITRATION / VARIABLE PARAMETERS (EXPERIMENT SETUP) =====
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
    updatePlate({ titrationVariables, titrationRows: [...titrationRows, { id: makeTitrationId(), values, notes: '' }] });
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
      else if (key.includes('other') || key.includes('ligand') || key.includes('molecule')) values[v] = otherMolecule || '';
      else values[v] = '';
    });
    updatePlate({ titrationVariables, titrationRows: [...titrationRows, { id: makeTitrationId(), values, notes: '' }] });
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

  // ===== COMPOUND + CELL LINE SELECTION =====
  const selectedCompounds = Array.isArray(activeTest.selectedCompounds)
    ? activeTest.selectedCompounds
    : Array.isArray(activeTest.compounds)
    ? activeTest.compounds.filter(Boolean)
    : compound
    ? [compound]
    : [];
  const toggleCompound = (cmp) => {
    const updated = selectedCompounds.includes(cmp)
      ? selectedCompounds.filter((c) => c !== cmp)
      : [...selectedCompounds, cmp];
    updatePlate({ selectedCompounds: updated, compounds: updated, compound: updated.length > 0 ? updated[0] : '' });
  };
  const toggleCellLine = (cl) => {
    const updated = cellLines.includes(cl) ? cellLines.filter((c) => c !== cl) : [...cellLines, cl];
    updatePlate({ cellLines: updated });
  };

  const handleCustomFieldChange = (fieldName, value) => {
    updatePlate({ customFieldValues: { ...customFieldValues, [fieldName]: value } });
  };

  // ===== DATA (SPECTRA) =====
  const parsedWavelengths = useMemo(() => {
    if (!wavelengthData) return [];
    return wavelengthData.split(/[\n,]+/).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
  }, [wavelengthData]);
  const parsedSpectra = useMemo(() => {
    return spectraColumns.map((col, idx) => {
      const values = (col.data || '').split(/[\n,]+/).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
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
        if (!baseX) { baseX = parsed.xs; firstMeta = parsed; }
        else {
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
    if (!imported.length || !baseX) { input.value = ''; return; }
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
      const sameAsCurrent = baseX.length === parsedWavelengths.length && baseX.every((x, i) => Math.abs(x - parsedWavelengths[i]) < 0.01);
      if (!sameAsCurrent) {
        alert('Cannot append: imported wavelength axis does not match the current wavelength axis.\nUse Replace import or clear the current data.');
        input.value = '';
        return;
      }
      const currentMin = parsedWavelengths.length ? Math.min(...parsedWavelengths) : minX;
      const currentMax = parsedWavelengths.length ? Math.max(...parsedWavelengths) : maxX;
      updates.spectraColumns = [...spectraColumns, ...newCols];
      updates.chartCfg = { ...chartCfg, xMin: String(Math.min(currentMin, minX)), xMax: String(Math.max(currentMax, maxX)) };
    }
    if (firstMeta) {
      if (firstMeta.title && !compound) updates.compound = firstMeta.title;
      if (firstMeta.experimentDate && !experimentDate) updates.experimentDate = firstMeta.experimentDate;
      if (firstMeta.temperature && !temperature) updates.temperature = firstMeta.temperature;
      if (firstMeta.pathLength && !pathLength) updates.pathLength = firstMeta.pathLength;
      if (firstMeta.concentration && !concentration) updates.concentration = firstMeta.concentration;
    }
    updatePlate(updates);
    input.value = '';
  };

  // ===== DATA IMAGES (small attachments) =====
  const addDataImageLinks = () => {
    const urlsText = prompt('Paste external link(s) separated by commas to small images:');
    if (urlsText && urlsText.trim()) {
      const urls = urlsText.split(/[\s,]+/).filter((u) => u.trim() !== '');
      updatePlate({ dataImages: [...dataImages, ...urls] });
    }
  };
  const importDataImageFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/'));
    if (!files.length) return;
    try {
      const imported = await Promise.all(
        files.map((file) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }))
      );
      updatePlate({ dataImages: [...dataImages, ...imported] });
    } catch (e) {
      console.error(e);
      alert('Image import failed.');
    }
  };

  // ===== CHART =====
  const cdChartRef = useRef(null);
  const structChartRef = useRef(null);
  const cdChart = useRef(null);
  const structChart = useRef(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

  useEffect(() => {
    if (!cdChartRef.current) return;
    if (cdChart.current) cdChart.current.destroy();
    const datasets = parsedSpectra
      .filter((s) => s.visible && s.values.length > 0)
      .map((s) => {
        const data = parsedWavelengths
          .map((w, i) => ({ x: w, y: s.values[i] !== undefined ? s.values[i] - gOff : null }))
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
            title: { display: true, text: 'Wavelength (nm)', font: { size: (chartCfg.fontSize || 12) + 2, weight: 'bold' }, color: '#334155' },
            ticks: { font: { size: chartCfg.fontSize || 12 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          },
          y: {
            min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined,
            max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined,
            title: { display: true, text: 'CD Signal (mdeg)', font: { size: (chartCfg.fontSize || 12) + 2, weight: 'bold' }, color: '#334155' },
            ticks: { font: { size: chartCfg.fontSize || 12 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          }
        },
        plugins: {
          legend: { position: 'top', labels: { font: { size: chartCfg.fontSize || 12, weight: 'bold' }, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (ctx) => `${ctx[0].parsed.x.toFixed(1)} nm`,
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)} mdeg`
            }
          }
        }
      }
    });
    return () => { if (cdChart.current) cdChart.current.destroy(); };
  }, [parsedWavelengths, parsedSpectra, chartCfg, gOff]);

  useEffect(() => {
    if (!structChartRef.current) return;
    if (structChart.current) structChart.current.destroy();
    const labels = Object.keys(structureComposition);
    const values = Object.values(structureComposition);
    const colors = labels.map((l) => STRUCTURE_COLORS[l] || '#94a3b8');
    structChart.current = new Chart(structChartRef.current, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11, weight: 'bold' }, padding: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)}%` } }
        }
      }
    });
    return () => { if (structChart.current) structChart.current.destroy(); };
  }, [structureComposition]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (cdChart.current) cdChart.current.resize();
      if (structChart.current) structChart.current.resize();
    }, 80);
    return () => clearTimeout(timer);
  }, [fsPanel]);

  // ===== EXPORTS =====
  const exportXLS = () => {
    try {
      const wb = XLSX.utils.book_new();
      const wlAoa = [['Wavelength (nm)', ...parsedSpectra.map((s) => s.title)]];
      parsedWavelengths.forEach((w, i) => {
        const row = [w];
        parsedSpectra.forEach((s) => { row.push(s.values[i] !== undefined ? s.values[i] : ''); });
        wlAoa.push(row);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wlAoa), 'CD Data');
      const structAoa = [['Structure', 'Percentage (%)']];
      Object.entries(structureComposition).forEach(([k, v]) => structAoa.push([k, v]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(structAoa), 'Structure');
      if (titrationRows.length > 0) {
        const titrationAoa = [['Point', ...titrationVariables, 'Notes']];
        titrationRows.forEach((row, idx) => {
          titrationAoa.push([idx + 1, ...titrationVariables.map((v) => (row.values || {})[v] || ''), row.notes || '']);
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
    const el = document.getElementById(`cd-report-${activeTest.id || 'default'}`);
    if (!el) return;
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#f8fafc', logging: false });
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
      pdf.save(`CD_Report_${(compound || 'experiment').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    } catch (e) {
      console.error(e);
      alert(`Export Failed: ${e.message}`);
    }
  };

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') setZoomImage(null); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const experimentPlan = activeTest.plan || [];

  return (
    <div id={`cd-report-${activeTest.id || 'default'}`} className="flex flex-col h-full overflow-hidden relative">
      {TestHeader}
      <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-end gap-3 shrink-0 z-10 shadow-sm no-print">
        <button onClick={exportXLS} className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors">📊 Export XLS</button>
        <button onClick={exportPDF} className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors">📄 Export PDF</button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* ===== 1. CLASSIFICATION ===== */}
        <CollapsibleSection title="Classification" icon="🏷️" defaultOpen={true}>
          <div className="flex flex-col gap-4 max-w-xl">
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase mb-2 block">Experiment Type / Test Category</label>
              <select
                value={testCategory}
                onChange={(e) => updatePlate({ testCategory: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                {(testCategories || []).map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-xs font-bold text-slate-600 uppercase">Custom Metadata</label>
              {(customFields || []).length === 0 ? (
                <p className="text-sm text-slate-400 italic bg-slate-50 p-3 rounded-lg border border-dashed border-slate-300">
                  No custom fields defined. Configure them in Definitions & Labels.
                </p>
              ) : (
                (customFields || []).map((field) => (
                  <div key={field.id} className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-500">{field.name}</label>
                    {field.type === 'select' ? (
                      <select value={customFieldValues[field.name] || ''} onChange={(e) => handleCustomFieldChange(field.name, e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                        <option value="">-- Select --</option>
                        {field.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                      </select>
                    ) : field.type === 'number' ? (
                      <input type="number" value={customFieldValues[field.name] || ''} onChange={(e) => handleCustomFieldChange(field.name, e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Enter value..." />
                    ) : field.type === 'date' ? (
                      <input type="date" value={customFieldValues[field.name] || ''} onChange={(e) => handleCustomFieldChange(field.name, e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
                    ) : (
                      <input type="text" value={customFieldValues[field.name] || ''} onChange={(e) => handleCustomFieldChange(field.name, e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Enter value..." />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 2. COMPOUNDS (molecules + cell lines, both dropdowns) ===== */}
        <CollapsibleSection title="Compounds & Biological Models" icon="🧪" defaultOpen={true}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="text-xs font-bold text-blue-800 uppercase flex items-center justify-between mb-2">
                <span>Compound / Sample Label(s)</span>
                <span className="text-[9px] bg-blue-200 text-blue-800 px-2 py-0.5 rounded">Dropdown • Multiple selection</span>
              </label>
              <MultiSelectDropdown
                options={allCmpds}
                selected={selectedCompounds}
                onToggle={toggleCompound}
                onClear={() => updatePlate({ selectedCompounds: [], compounds: [], compound: '' })}
                placeholder="Select compound(s)..."
                accent="blue"
              />
            </div>
            <div className="flex flex-col gap-1 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <label className="text-xs font-bold text-emerald-800 uppercase flex items-center justify-between mb-2">
                <span>Cell Lines / Biological Models</span>
                <span className="text-[9px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded">Dropdown • Multiple selection</span>
              </label>
              <MultiSelectDropdown
                options={allCellLines}
                selected={cellLines}
                onToggle={toggleCellLine}
                onClear={() => updatePlate({ cellLines: [] })}
                placeholder="Select cell line(s)..."
                accent="emerald"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 3. EXPERIMENTAL CONDITIONS ===== */}
        <CollapsibleSection title="Experimental Conditions" icon="🌡️" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Experiment Date</label>
              <input type="date" value={experimentDate} onChange={(e) => updatePlate({ experimentDate: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Concentration</label>
              <input type="text" value={concentration} onChange={(e) => updatePlate({ concentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 0.1 mg/mL" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Solvent / Buffer</label>
              <input type="text" value={solvent} onChange={(e) => updatePlate({ solvent: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 10 mM Phosphate Buffer" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Salt Concentration</label>
              <input type="text" value={saltConcentration} onChange={(e) => updatePlate({ saltConcentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 50 mM NaCl" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">pH</label>
              <input type="text" value={ph} onChange={(e) => updatePlate({ ph: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 7.4" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Temperature</label>
              <input type="text" value={temperature} onChange={(e) => updatePlate({ temperature: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 25°C" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cuvette Path Length</label>
              <input type="text" value={pathLength} onChange={(e) => updatePlate({ pathLength: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 1 mm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buffer</label>
              <input type="text" value={buffer} onChange={(e) => updatePlate({ buffer: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 10 mM PBS pH 7.4" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Other Molecule / Ligand</label>
              <input type="text" value={otherMolecule} onChange={(e) => updatePlate({ otherMolecule: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. Ligand X" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Molar Ratio</label>
              <input type="text" value={ratio} onChange={(e) => updatePlate({ ratio: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 1:5" />
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 4. PROTOCOLS ===== */}
        <CollapsibleSection title="Linked Protocols" icon="📋" defaultOpen={true}>
          <div className="flex flex-col gap-1 p-3 bg-indigo-50 border border-indigo-200 rounded-lg max-w-2xl">
            <label className="text-xs font-bold text-indigo-800 uppercase flex items-center justify-between mb-2">
              <span>📋 Linked Protocols</span>
              <span className="text-[9px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded">Multiple protocols allowed</span>
            </label>
            {linkedProtocolIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {linkedProtocolIds.map((pid) => {
                  const prot = (datasetProtocols || []).find((p) => p.id === pid);
                  return (
                    <div key={pid} className="flex items-center gap-1 bg-white border border-indigo-300 rounded-lg px-2 py-1 shadow-sm">
                      <span className="text-xs font-bold text-indigo-900 max-w-[220px] truncate">{prot ? `${prot.title} (${prot.category})` : pid}</span>
                      <button onClick={() => jumpToProtocol && jumpToProtocol(pid)} className="text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 px-2 py-0.5 rounded transition-colors" title="Open this protocol">📖 Open</button>
                      <button onClick={() => removeLinkedProtocol(pid)} className="text-slate-400 hover:text-red-500 font-bold px-1" title="Unlink">×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <select value="" onChange={(e) => addLinkedProtocol(e.target.value)} className="border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 w-full cursor-pointer font-semibold text-indigo-900">
              <option value="">-- Add a protocol to link --</option>
              {(datasetProtocols || []).filter((p) => !linkedProtocolIds.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.title} ({p.category})</option>
              ))}
            </select>
          </div>
        </CollapsibleSection>

        {/* ===== 5. AGENDA ===== */}
        <CollapsibleSection title="Agenda / Planning" icon="📅" defaultOpen={true}>
          <div className="max-w-2xl">
            <h3 className="text-[11px] font-bold text-slate-600 mb-2 flex justify-between items-center">
              <span>Schedule / Planning (This Item)</span>
              <div className="flex gap-2">
                <input type="date" id={`plan-date-${activeTest.id}`} className="border border-slate-300 px-2 py-1 text-xs rounded bg-white text-slate-800 outline-none focus:border-blue-500" />
                <button
                  onClick={() => {
                    const d = document.getElementById(`plan-date-${activeTest.id}`).value;
                    if (d) {
                      updatePlate({ plan: [...experimentPlan, { id: Date.now(), date: d, task: '' }].sort((a, b) => a.date.localeCompare(b.date)) });
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-bold transition shadow-sm"
                >
                  Add Task
                </button>
              </div>
            </h3>
            <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
              {experimentPlan.length === 0 && <span className="text-xs text-slate-400 italic">No tasks planned yet.</span>}
              {experimentPlan.map((item) => (
                <div key={item.id} className="flex gap-2 items-center bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-sm">
                  <span className="text-[10px] font-bold w-20 text-slate-600 pl-2">{item.date}</span>
                  <input
                    type="text"
                    value={item.task}
                    onChange={(e) => updatePlate({ plan: experimentPlan.map((p) => (p.id === item.id ? { ...p, task: e.target.value } : p)) })}
                    className="bg-transparent border-none focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-500 p-1 text-xs flex-1 text-slate-700 rounded transition-all"
                    placeholder="Task description..."
                  />
                  <button onClick={() => updatePlate({ plan: experimentPlan.filter((p) => p.id !== item.id) })} className="text-slate-400 hover:text-red-500 text-[10px] font-bold px-2 transition">×</button>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 6. COMMENTS & ATTACHMENTS ===== */}
        <CollapsibleSection title="Comments & Attachments" icon="📝" defaultOpen={true}>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 flex flex-col h-full min-h-[160px]">
              <label className="text-xs font-bold text-slate-600 mb-2">Comments & Notes (what you did)</label>
              <RichTextEditor value={comments} onChange={(val) => updatePlate({ comments: val })} placeholder="Enter your experiment notes, observations, etc..." />
            </div>
            <div className="flex-shrink-0 flex flex-col justify-start gap-4" style={{ maxWidth: '300px', minWidth: '180px' }}>
              <div className="w-full flex flex-col items-end border-t border-slate-200 pt-3">
                <label className="text-xs font-bold text-slate-600 mb-2 w-full text-right">🔗 Document Links</label>
                <div className="flex flex-col gap-1 w-full mb-3 max-h-[140px] overflow-y-auto custom-scrollbar">
                  {documents.length === 0 && <span className="text-[10px] text-slate-400 italic text-right w-full">No documents attached.</span>}
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-sm group">
                      <div
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer"
                        onClick={() => {
                          const nn = prompt('Rename document:', doc.name);
                          if (nn) updatePlate({ documents: documents.map((d) => (d.id === doc.id ? { ...d, name: nn.trim() } : d)) });
                        }}
                      >
                        <span className="text-sm">🔗</span>
                        <span className="text-[10px] font-bold text-slate-700 truncate group-hover:text-blue-600">{doc.name}</span>
                      </div>
                      <button onClick={() => updatePlate({ documents: documents.filter((d) => d.id !== doc.id) })} className="text-slate-400 hover:text-red-500 font-bold px-1 opacity-0 group-hover:opacity-100">×</button>
                    </div>
                  ))}
                </div>
                <label
                  className="cursor-pointer text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors w-full text-center"
                  onClick={() => {
                    const url = prompt('Paste external link (Drive, PDF, Image URL):');
                    if (url && url.trim()) {
                      let name = url;
                      try { const p = new URL(url); name = p.hostname; } catch (e) {}
                      updatePlate({ documents: [...documents, { id: Date.now().toString(), name, type: 'link', data: url.trim() }] });
                    }
                  }}
                >
                  + Add Document Link
                </label>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 7. IMAGES ===== */}
        <CollapsibleSection title="Images" icon="🖼️" defaultOpen={true}>
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <p className="text-sm text-slate-500">Attach image links (Google Drive/Dropbox supported) for your experimental CD spectra.</p>
            <button
              onClick={() => {
                const url = prompt('Paste image link (Google Drive, Dropbox, or direct URL):');
                if (url && url.trim()) updatePlate({ images: [...images, url.trim()] });
              }}
              className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-bold px-3 py-1.5 rounded transition-colors shadow-sm text-xs"
            >
              + Add Link
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {images.length === 0 ? (
              <div className="col-span-full text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">No images attached.</div>
            ) : (
              images.map((imgSrc, idx) => (
                <div key={idx} className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">Image {idx + 1}</span>
                    <button onClick={() => updatePlate({ images: images.filter((_, i) => i !== idx) })} className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors border border-red-200">×</button>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-100 cursor-pointer" onClick={() => setZoomImage(normalizeImageCandidates(imgSrc)[0])} title="Click to zoom">
                    <SmartImage src={imgSrc} alt={`CD spectrum ${idx + 1}`} />
                  </div>
                  <a href={imgSrc} target="_blank" rel="noopener noreferrer" className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">🔗 Open original link</a>
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* ===== 8. EXPERIMENT SETUP (titration / variable parameters) ===== */}
        <CollapsibleSection title="Experiment Setup" icon="⚙️" defaultOpen={true}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-end justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="flex flex-col md:flex-row gap-2 w-full lg:w-auto">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">New Experimental Variable</label>
                  <input
                    type="text"
                    value={newTitrationVariable}
                    onChange={(e) => setNewTitrationVariable(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTitrationVariable(); } }}
                    placeholder="e.g. Ratio, Concentration, pH, Temperature"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full md:w-72 bg-white"
                  />
                </div>
                <button type="button" onClick={addTitrationVariable} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">+ Add Variable</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={addTitrationRowFromCurrent} className="bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 font-bold px-4 py-2 rounded-lg text-sm shadow-sm">+ Add Point from Current Conditions</button>
                <button type="button" onClick={addTitrationRow} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">+ Add Empty Titration Point</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {titrationVariables.length === 0 && (
                <span className="text-sm text-slate-400 italic">No variables defined. Add variables such as Ratio, Concentration, pH, Temperature, etc.</span>
              )}
              {titrationVariables.map((v) => (
                <span key={v} className="inline-flex items-center gap-2 bg-white border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 shadow-sm">
                  {v}
                  <button type="button" onClick={() => removeTitrationVariable(v)} className="text-slate-400 hover:text-red-500 font-black" title={`Remove variable ${v}`}>×</button>
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
                      <td colSpan={titrationVariables.length + 3} className="px-3 py-10 text-center text-slate-400 italic">No titration points defined yet.</td>
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
                            <button type="button" onClick={() => duplicateTitrationRow(row)} className="text-xs font-bold text-blue-600 hover:text-blue-800">Duplicate</button>
                            <button type="button" onClick={() => removeTitrationRow(row.id)} className="text-xs font-bold text-red-500 hover:text-red-700">Delete</button>
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

        {/* ===== 9. DATA (numeric values + small images) ===== */}
        <CollapsibleSection title="Data" icon="🔢" defaultOpen={true}>
          <input ref={fileInputRef} type="file" accept=".txt,.csv,.asc,.dcm" multiple className="hidden" onChange={importJascoFiles} />
          <input
            ref={dataImageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { importDataImageFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="flex flex-col gap-4">
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-blue-800 uppercase">JASCO / TXT Import</div>
                  <p className="text-[10px] text-blue-700 mt-1">Imports the CD [mdeg] channel from JASCO .txt files, converts the wavelength axis to ascending order, and fills sample metadata when available.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => triggerJascoImport('replace')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">📂 Import JASCO (Replace)</button>
                  <button onClick={() => triggerJascoImport('append')} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">➕ Import JASCO (Append)</button>
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
                <button onClick={addSpectrumColumn} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1">+ Add Spectrum</button>
              </div>
              {parsedSpectra.length === 0 ? (
                <div className="text-center py-8 text-slate-400 italic bg-white rounded-lg border border-dashed border-slate-300">No spectra added yet. Click "Add Spectrum" to start.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {parsedSpectra.map((spectrum) => (
                    <div key={spectrum.id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm relative group">
                      <div className="flex items-center gap-2 mb-2">
                        <input type="color" value={spectrum.color} onChange={(e) => updateSpectrumColumn(spectrum.id, { color: e.target.value })} className="w-6 h-6 rounded border border-slate-300 cursor-pointer" />
                        <input type="text" value={spectrum.title} onChange={(e) => updateSpectrumColumn(spectrum.id, { title: e.target.value })} className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs font-bold outline-none focus:border-blue-500" placeholder="Spectrum title..." />
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={spectrum.visible} onChange={(e) => updateSpectrumColumn(spectrum.id, { visible: e.target.checked })} className="w-3 h-3 accent-blue-600" />
                          <span className="text-[9px] text-slate-500">Show</span>
                        </label>
                        <button onClick={() => removeSpectrumColumn(spectrum.id)} className="text-slate-400 hover:text-red-500 font-bold text-sm opacity-0 group-hover:opacity-100 transition-opacity">×</button>
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
            {/* Small image attachments */}
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                <label className="text-xs font-bold text-slate-600 uppercase">🖼️ Small Image Attachments (Data)</label>
                <div className="flex gap-2">
                  <button onClick={() => dataImageInputRef.current?.click()} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded text-xs shadow-sm">📁 Import Images</button>
                  <button onClick={addDataImageLinks} className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 font-bold px-3 py-1.5 rounded text-xs shadow-sm">🔗 Add Image Links</button>
                </div>
              </div>
              {dataImages.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No small images attached to the data.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {dataImages.map((imgSrc, idx) => (
                    <div key={idx} className="relative group">
                      <div className="cursor-pointer border border-slate-200 rounded-lg p-1 bg-white shadow-sm" onClick={() => setZoomImage(normalizeImageCandidates(imgSrc)[0])}>
                        <SmartImage src={imgSrc} alt={`Data img ${idx + 1}`} style={{ maxHeight: '110px', maxWidth: '160px' }} />
                      </div>
                      <button onClick={() => updatePlate({ dataImages: dataImages.filter((_, i) => i !== idx) })} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow opacity-0 group-hover:opacity-100 transition-opacity no-print">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== 10. FITTING (Error Management + Graphical Parameters) ===== */}
        <CollapsibleSection title="Fitting" icon="📐" defaultOpen={true}>
          <div className="flex flex-col gap-6">
            {/* Error Management */}
            <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
              <div className="flex flex-col gap-4 max-w-2xl">
                <p className="text-sm text-slate-500">
                  CD spectra are single measurements per spectrum, so there is no replicate-based SD. Use the controls
                  below for baseline correction and to include/exclude individual spectra from the plot and analysis.
                </p>
                <div className="flex flex-col gap-1 max-w-xs">
                  <label className="text-xs font-bold text-slate-600">Global Baseline Offset (subtract from all spectra, mdeg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={glbOffsetStr}
                    onChange={(e) => updatePlate({ glbOffsetStr: e.target.value })}
                    className="border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. 0 or -12.5"
                  />
                </div>
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <label className="text-xs font-bold text-slate-600 uppercase block mb-2">Include / Exclude Spectra</label>
                  {parsedSpectra.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No spectra to manage. Add spectra in the Data section.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {parsedSpectra.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm">
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
            {/* Graphical Parameters */}
            <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
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
                  <input type="number" value={chartCfg.fontSize} onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, fontSize: parseFloat(e.target.value) || 12 } })} className="border border-slate-300 rounded-md p-2 text-sm outline-none" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-600">Line Thickness</label>
                  <input type="number" value={chartCfg.lineWidth} onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, lineWidth: parseFloat(e.target.value) || 2 } })} className="border border-slate-300 rounded-md p-2 text-sm outline-none" />
                </div>
              </div>
              <div className="mt-6 flex flex-col lg:flex-row gap-6">
                {fsPanel === 'cd' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('cd')}></div>}
                <div className={`flex flex-col ${fsPanel === 'cd' ? `${FS_CLASSES} p-6` : 'flex-[3] min-w-0'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">CD Spectra Plot</h2>
                    <button onClick={() => toggleFs('cd')} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">{fsPanel === 'cd' ? '↙️' : '↗️'}</button>
                  </div>
                  <div className="flex-1 relative min-h-0" style={{ minHeight: fsPanel === 'cd' ? '0' : '400px' }}>
                    <canvas ref={cdChartRef}></canvas>
                  </div>
                </div>
                {fsPanel === 'struct' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('struct')}></div>}
                <div className={`flex flex-col ${fsPanel === 'struct' ? `${FS_CLASSES} p-6` : 'flex-[2] min-w-0'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">Secondary Structure</h2>
                    <button onClick={() => toggleFs('struct')} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">{fsPanel === 'struct' ? '↙️' : '↗️'}</button>
                  </div>
                  <div className="flex-1 relative min-h-0 flex flex-col items-center justify-center" style={{ minHeight: fsPanel === 'struct' ? '0' : '300px' }}>
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
          </div>
        </CollapsibleSection>

        {/* ===== 11. SIMULATIONS ===== */}
        <CollapsibleSection title="Simulations" icon="🧬" defaultOpen={false}>
          <div className="flex flex-col gap-6">
            {fsPanel === 'mixer' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('mixer')}></div>}
            <ProteinCDMixer isExpanded={fsPanel === 'mixer'} onToggleExpand={() => toggleFs('mixer')} />
          </div>
        </CollapsibleSection>

        {/* ===== 12. LAB NOTEBOOK EXPORT ===== */}
        <CollapsibleSection title="Lab Notebook Export" icon="📓" defaultOpen={false} className="no-print">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">Select the CD data to format and append to the General Comments (which acts as the Lab Notebook entry).</p>
            <div className="flex flex-wrap gap-4 border border-slate-200 p-4 rounded-lg bg-white shadow-sm">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                <input type="checkbox" id="cd-nb-cond" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" />
                Experimental Conditions
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                <input type="checkbox" id="cd-nb-struct" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" />
                Structure Composition
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                <input type="checkbox" id="cd-nb-spectra" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" />
                Spectra Summary
              </label>
            </div>
            <button
              onClick={() => {
                let html = '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';
                html += '<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 CD Experiment Summary</h4>';
                const cbCond = document.getElementById('cd-nb-cond')?.checked;
                const cbStruct = document.getElementById('cd-nb-struct')?.checked;
                const cbSpectra = document.getElementById('cd-nb-spectra')?.checked;
                if (cbCond) {
                  const protTitles = linkedProtocolIds.map((id) => (datasetProtocols || []).find((p) => p.id === id)?.title).filter(Boolean).join(', ') || 'N/A';
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
                      <b>Sample:</b> ${(selectedCompounds.length ? selectedCompounds.join(', ') : compound) || 'N/A'} |
                      <b>Cell lines:</b> ${cellLines.join(', ') || 'N/A'} |
                      <b>Conc:</b> ${concentration || 'N/A'} |
                      <b>Buffer:</b> ${buffer || solvent || 'N/A'} |
                      <b>pH:</b> ${ph || 'N/A'} |
                      <b>Temp:</b> ${temperature || 'N/A'} |
                      <b>Path:</b> ${pathLength || 'N/A'} mm |
                      <b>Protocols:</b> ${protTitles}
                  </p>`;
                }
                if (cbStruct) {
                  html += '<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">';
                  html += '<tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Structure</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Percentage</th></tr>';
                  Object.entries(structureComposition).forEach(([k, v]) => {
                    html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${k}</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${v}%</td></tr>`;
                  });
                  html += '</table>';
                }
                if (cbSpectra && parsedSpectra.length > 0) {
                  html += `<p style="font-size: 12px; color: #475569; margin-top: 10px;"><b>Spectra recorded:</b> ${parsedSpectra.map((s) => s.title).join(', ')}</p>`;
                  html += `<p style="font-size: 11px; color: #64748b;">Wavelength range: ${
                    parsedWavelengths.length > 0
                      ? `${Math.min(...parsedWavelengths)} - ${Math.max(...parsedWavelengths)} nm`
                      : 'N/A'
                  } (${parsedWavelengths.length} points)</p>`;
                }
                html += '</div>';
                const currentComments = comments || '';
                updateActiveTest({ comments: currentComments + (currentComments ? '<br/>' : '') + html });
                alert('CD data appended successfully to the notes!');
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-sm w-fit border border-indigo-700 flex items-center gap-2"
            >
              <span>+</span> Append Data to Lab Notebook
            </button>
          </div>
        </CollapsibleSection>
      </div>
      {zoomImage && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm" onClick={() => setZoomImage(null)}>
          <div className="relative" style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={zoomImage} alt="Zoomed" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
            <button
              onClick={(e) => { e.stopPropagation(); setZoomImage(null); }}
              className="absolute -top-4 -right-4 bg-white text-slate-800 rounded-full w-8 h-8 flex items-center justify-center text-xl font-black shadow-lg hover:bg-slate-100"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CDTestRenderer;
