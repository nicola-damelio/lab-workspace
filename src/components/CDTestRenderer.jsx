import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { RichTextEditor } from './RichTextEditor';

// --- UTILITY CLASSES FOR FULLSCREEN ---
const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

// --- PALETTE COLORS ---
const SPECTRA_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981'
];

const STRUCTURE_COLORS = {
  'α-Helix': '#3b82f6',
  'β-Sheet': '#ef4444',
  'Turn': '#f59e0b',
  'Random Coil': '#94a3b8',
  'Other': '#8b5cf6'
};

// --- SPLINE INTERPOLATION LOGIC ---
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
      alpha[i] = (3 / h[i] * (this.a[i + 1] - this.a[i])) - (3 / h[i - 1] * (this.a[i] - this.a[i - 1]));
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
      this.b[j] = (this.a[j + 1] - this.a[j]) / h[j] - h[j] * (this.c[j + 1] + 2 * this.c[j]) / 3;
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

// --- CD KNOT DATA ---
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

// --- RESPONSIVE CANVAS HELPER ---
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

// --- COLLAPSIBLE SECTION COMPONENT ---
export const CollapsibleSection = ({
  title,
  icon,
  defaultOpen = true,
  children,
  headerExtra,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${
          isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg
            className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// --- PROTEIN CD MIXER SIMULATOR ---
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
      others.forEach((k) => {
        currentTotal += newComps[k];
      });

      if (newVal + currentTotal > 100) {
        const excess = newVal + currentTotal - 100;

        if (currentTotal > 0) {
          others.forEach((k) => {
            const reduction = Math.round(excess * (newComps[k] / currentTotal));
            newComps[k] = Math.max(0, newComps[k] - reduction);
          });
        } else {
          others.forEach((k) => {
            newComps[k] = 0;
          });
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
    <div
      className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${
        isExpanded ? `${FS_CLASSES} p-6` : 'break-inside-avoid p-4'
      }`}
    >
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2">
          <span>🧬</span> Protein Secondary Structure Simulator
        </h4>
        <button
          onClick={onToggleExpand}
          className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
        >
          {isExpanded ? '↙️' : '↗️'}
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={wrapRef}
            className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${
              isExpanded ? 'flex-1 min-h-0' : 'h-[350px]'
            }`}
          >
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
                  <span className="text-xs font-bold" style={{ color: colors[key] }}>
                    {labels[key]}
                  </span>
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
              <span
                className={
                  Object.values(compositions).reduce((a, b) => a + b, 0) === 100
                    ? 'text-emerald-600'
                    : 'text-red-500'
                }
              >
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

// --- ENHANCED CD LIBRARY / SIMULATOR ---
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
    description:
      'Simulation (Alpha Binding): DNA remains B-form. Ratio 0-1: peptide binds as α-helix. Ratio >1: excess peptide is Random Coil.'
  },
  dnaPepBeta: {
    ratioLabel: 'Peptide:DNA Ratio',
    description:
      'Simulation (Beta Binding): DNA remains B-form. Ratio 0-1: peptide binds as β-sheet. Ratio >1: excess peptide is Random Coil.'
  },
  dnaPepAlphaZ: {
    ratioLabel: 'Peptide:DNA Ratio',
    description:
      'Simulation (Alpha + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B → Z transition; peptide binds as α-helix. Ratio >1: DNA is Z-form; excess peptide is Random Coil.'
  },
  dnaPepBetaZ: {
    ratioLabel: 'Peptide:DNA Ratio',
    description:
      'Simulation (Beta + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B → Z transition; peptide binds as β-sheet. Ratio >1: DNA is Z-form; excess peptide is Random Coil.'
  },
  pepDnaAlpha: {
    ratioLabel: 'DNA:Peptide Ratio',
    description:
      'Simulation (Peptide + DNA [Alpha]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is α-helix. Ratio >1: peptide fully bound as α-helix; excess DNA is B-form.'
  },
  pepDnaBeta: {
    ratioLabel: 'DNA:Peptide Ratio',
    description:
      'Simulation (Peptide + DNA [Beta]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is β-sheet. Ratio >1: peptide fully bound as β-sheet; excess DNA is B-form.'
  },
  pepDnaAlphaZ: {
    ratioLabel: 'DNA:Peptide Ratio',
    description:
      'Simulation (Peptide + DNA [Alpha+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is α-helix. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.'
  },
  pepDnaBetaZ: {
    ratioLabel: 'DNA:Peptide Ratio',
    description:
      'Simulation (Peptide + DNA [Beta+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is β-sheet. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.'
  }
};

const CD_REF_TYPES = {
  'Alpha-helix': {
    spline: splineAlpha,
    start: 176,
    end: 260,
    color: '#3b82f6',
    group: 'protein'
  },
  'Beta-sheet': {
    spline: splineBeta,
    start: 176,
    end: 260,
    color: '#ef4444',
    group: 'protein'
  },
  Turn: {
    spline: splineTurn,
    start: 176,
    end: 260,
    color: '#f59e0b',
    group: 'protein'
  },
  'Random Coil': {
    spline: splineCoil,
    start: 176,
    end: 260,
    color: '#94a3b8',
    group: 'protein'
  },
  'A-DNA': {
    spline: splineADNA,
    start: 180,
    end: 320,
    color: '#8b5cf6',
    group: 'dna'
  },
  'B-DNA': {
    spline: splineBDNA,
    start: 180,
    end: 320,
    color: '#10b981',
    group: 'dna'
  },
  'Z-DNA': {
    spline: splineZDNA,
    start: 180,
    end: 320,
    color: '#f97316',
    group: 'dna'
  },
  'G-Quad (Parallel)': {
    spline: splineGQP,
    start: 220,
    end: 320,
    color: '#ec4899',
    group: 'gq'
  },
  'G-Quad (Hybrid)': {
    spline: splineGQH,
    start: 220,
    end: 320,
    color: '#14b8a6',
    group: 'gq'
  },
  'G-Quad (Antiparallel)': {
    spline: splineGQA,
    start: 220,
    end: 320,
    color: '#6366f1',
    group: 'gq'
  }
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

  return series.map((s) => ({
    ...s,
    values: s.values.map((v) => (v / maxAbs) * 100)
  }));
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
        values = mix([
          [B, 1],
          [alpha, bound01],
          [coil, excess]
        ]);
        label = `DNA + α-peptide (P/D ${r.toFixed(1)})`;
        break;

      case 'dnaPepBeta':
        values = mix([
          [B, 1],
          [beta, bound01],
          [coil, excess]
        ]);
        label = `DNA + β-peptide (P/D ${r.toFixed(1)})`;
        break;

      case 'dnaPepAlphaZ':
        values = mix([
          [B, 1 - bound01],
          [Z, bound01],
          [alpha, bound01],
          [coil, excess]
        ]);
        label = `DNA B→Z + α-peptide (P/D ${r.toFixed(1)})`;
        break;

      case 'dnaPepBetaZ':
        values = mix([
          [B, 1 - bound01],
          [Z, bound01],
          [beta, bound01],
          [coil, excess]
        ]);
        label = `DNA B→Z + β-peptide (P/D ${r.toFixed(1)})`;
        break;

      case 'pepDnaAlpha':
        values = mix([
          [alpha, bound01],
          [coil, free],
          [B, r]
        ]);
        label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`;
        break;

      case 'pepDnaBeta':
        values = mix([
          [beta, bound01],
          [coil, free],
          [B, r]
        ]);
        label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`;
        break;

      case 'pepDnaAlphaZ':
        values = mix([
          [alpha, bound01],
          [coil, free],
          [Z, bound01],
          [B, Math.max(r - 1, 0)]
        ]);
        label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`;
        break;

      case 'pepDnaBetaZ':
        values = mix([
          [beta, bound01],
          [coil, free],
          [Z, bound01],
          [B, Math.max(r - 1, 0)]
        ]);
        label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`;
        break;

      default:
        values = xs.map(() => 0);
        label = 'Unknown simulation';
    }

    series = [
      {
        label,
        color: '#7c3aed',
        values
      }
    ];
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
    return buildCdLibraryData({
      tab,
      selectedProtein,
      selectedDna,
      selectedGq,
      ratio,
      normalize
    });
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

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = -1;
      yMax = 1;
    }

    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }

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
      if (Math.abs(v) >= 1000) {
        return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      }
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
          onClick={onToggleExpand}
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

// --- MAIN CD TEST RENDERER ---
export const CDTestRenderer = ({
  activeTest,
  updateActiveTest,
  appClipboard,
  setAppClipboard,
  TestHeader,
  datasetProtocols,
  jumpToProtocol
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
    pathLength = '1',
    otherMolecule = '',
    ratio = '',
    linkedProtocolId = '',
    comments = '',
    images = [],
    documents = [],
    wavelengthData = '',
    spectraColumns = [],
    showStructureAnalysis = true,
    structureComposition = { 'α-Helix': 30, 'β-Sheet': 20, Turn: 10, 'Random Coil': 40 },
    chartCfg = { yMin: '', yMax: '', xMin: '190', xMax: '260', fontSize: 12, lineWidth: 2 }
  } = activeTest;

  const [fsPanel, setFsPanel] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);

  const cdChartRef = useRef(null);
  const structChartRef = useRef(null);
  const cdChart = useRef(null);
  const structChart = useRef(null);

  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

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

      return {
        ...col,
        values,
        color: col.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length]
      };
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
    updatePlate({
      spectraColumns: spectraColumns.map((c) => (c.id === id ? { ...c, ...updates } : c))
    });
  };

  const removeSpectrumColumn = (id) => {
    updatePlate({ spectraColumns: spectraColumns.filter((c) => c.id !== id) });
  };

  useEffect(() => {
    if (!cdChartRef.current) return;

    if (cdChart.current) cdChart.current.destroy();

    const datasets = parsedSpectra
      .filter((s) => s.visible && s.values.length > 0)
      .map((s) => {
        const data = parsedWavelengths
          .map((w, i) => ({
            x: w,
            y: s.values[i] !== undefined ? s.values[i] : null
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
              title: (ctx) => `${ctx[0].parsed.x.toFixed(1)} nm`,
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)} mdeg`
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
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 3
          }
        ]
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
              label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)}%`
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

      pdf.save(`CD_Report_${(compound || 'experiment').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    } catch (e) {
      console.error(e);
      alert(`Export Failed: ${e.message}`);
    }
  };

  useEffect(() => {
    const h = () => setZoomImage(null);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  return (
    <div id={`cd-report-${activeTest.id || 'default'}`} className="flex flex-col h-full overflow-hidden relative">
      {TestHeader}

      <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-end gap-3 shrink-0 z-10 shadow-sm no-print">
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

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <CollapsibleSection title="Comments & Attachments" icon="📝">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 flex flex-col h-full min-h-[160px]">
              <label className="text-xs font-bold text-slate-600 mb-2">Comments & Notes</label>

              <RichTextEditor
                value={comments}
                onChange={(val) => updatePlate({ comments: val })}
                placeholder="Enter your experiment notes, observations, etc..."
              />

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-4">
                <span className="text-[11px] font-bold text-slate-600 w-32">📋 Link Protocol:</span>

                <select
                  value={linkedProtocolId}
                  onChange={(e) => updatePlate({ linkedProtocolId: e.target.value })}
                  className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-slate-50 outline-none focus:border-blue-50 flex-1 cursor-pointer"
                >
                  <option value="">-- No Protocol Linked --</option>
                  {(datasetProtocols || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.category})
                    </option>
                  ))}
                </select>

                {linkedProtocolId && (
                  <button
                    onClick={() => jumpToProtocol && jumpToProtocol(linkedProtocolId)}
                    className="text-xs text-white font-bold bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
                  >
                    📖 Open Protocol
                  </button>
                )}
              </div>
            </div>

            <div className="flex-shrink-0 flex flex-col justify-start gap-4" style={{ maxWidth: '300px', minWidth: '180px' }}>
              <div className="w-full flex flex-col items-end">
                <label className="text-xs font-bold text-slate-600 mb-2 w-full text-right">🔗 External Image Links</label>

                {images.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-2 max-w-[280px]">
                    {images.map((imgSrc, idx) => (
                      <div key={idx} className="relative inline-block group">
                        <a
                          href={imgSrc}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (e.target.tagName === 'IMG') {
                              e.preventDefault();
                              setZoomImage(imgSrc);
                            }
                          }}
                        >
                          <img
                            src={imgSrc}
                            alt={`Ref ${idx + 1}`}
                            style={{ maxHeight: '150px', maxWidth: '250px' }}
                            className="object-contain rounded-lg border border-slate-200 shadow-sm bg-white hover:opacity-90"
                          />
                        </a>

                        <button
                          onClick={() => updatePlate({ images: images.filter((_, i) => i !== idx) })}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    <button
                      onClick={() => {
                        const url = prompt('Paste direct link(s) to images:');
                        if (url && url.trim()) {
                          const urls = url.split(/[\s,]+/).filter((u) => u.trim() !== '');
                          updatePlate({ images: [...images, ...urls] });
                        }
                      }}
                      className="flex items-center justify-center bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-blue-600 font-bold h-[50px] w-[35px] text-xl shadow-sm"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const url = prompt('Paste direct link(s) to images:');
                      if (url && url.trim()) {
                        const urls = url.split(/[\s,]+/).filter((u) => u.trim() !== '');
                        updatePlate({ images: [...images, ...urls] });
                      }
                    }}
                    className="text-xs font-bold text-blue-600 bg-blue-50 p-4 rounded-lg border-2 border-dashed border-blue-300 shadow-sm hover:bg-blue-100 transition-colors w-full text-center"
                  >
                    + Add Image Link(s)
                  </button>
                )}
              </div>

              <div className="w-full flex flex-col items-end border-t border-slate-200 pt-3">
                <label className="text-xs font-bold text-slate-600 mb-2 w-full text-right">🔗 Document Links</label>

                <div className="flex flex-col gap-1 w-full mb-3 max-h-[140px] overflow-y-auto custom-scrollbar">
                  {documents.length === 0 && (
                    <span className="text-[10px] text-slate-400 italic text-right w-full">No documents attached.</span>
                  )}

                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 p-1.5 rounded-lg shadow-sm group"
                    >
                      <div
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer"
                        onClick={() => {
                          const nn = prompt('Rename document:', doc.name);
                          if (nn) {
                            updatePlate({
                              documents: documents.map((d) => (d.id === doc.id ? { ...d, name: nn.trim() } : d))
                            });
                          }
                        }}
                      >
                        <span className="text-sm">🔗</span>
                        <span className="text-[10px] font-bold text-slate-700 truncate group-hover:text-blue-600">{doc.name}</span>
                      </div>

                      <button
                        onClick={() => updatePlate({ documents: documents.filter((d) => d.id !== doc.id) })}
                        className="text-slate-400 hover:text-red-500 font-bold px-1 opacity-0 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <label
                  className="cursor-pointer text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors w-full text-center"
                  onClick={() => {
                    const url = prompt('Paste external link (Drive, PDF, Image URL):');
                    if (url && url.trim()) {
                      let name = url;

                      try {
                        const p = new URL(url);
                        name = p.hostname;
                      } catch (e) {
                        // keep raw URL as name
                      }

                      updatePlate({
                        documents: [
                          ...documents,
                          { id: Date.now().toString(), name, type: 'link', data: url.trim() }
                        ]
                      });
                    }
                  }}
                >
                  + Add Document Link
                </label>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Experimental Conditions" icon="🧪">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="flex flex-col gap-1 col-span-1 md:col-span-2 lg:col-span-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="text-xs font-bold text-blue-800 uppercase">Compound / Sample Label</label>
              <input
                type="text"
                value={compound}
                onChange={(e) => updatePlate({ compound: e.target.value })}
                className="w-full border border-blue-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 font-bold text-blue-900"
                placeholder="e.g. BSA Protein, Compound A"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Experiment Date</label>
              <input
                type="date"
                value={experimentDate}
                onChange={(e) => updatePlate({ experimentDate: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Concentration</label>
              <input
                type="text"
                value={concentration}
                onChange={(e) => updatePlate({ concentration: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 0.1 mg/mL"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Solvent / Buffer</label>
              <input
                type="text"
                value={solvent}
                onChange={(e) => updatePlate({ solvent: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 10 mM Phosphate Buffer"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Salt Concentration</label>
              <input
                type="text"
                value={saltConcentration}
                onChange={(e) => updatePlate({ saltConcentration: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 50 mM NaCl"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Temperature</label>
              <input
                type="text"
                value={temperature}
                onChange={(e) => updatePlate({ temperature: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 25°C"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cuvette Path Length</label>
              <input
                type="text"
                value={pathLength}
                onChange={(e) => updatePlate({ pathLength: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 1 mm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Buffer</label>
              <input
                type="text"
                value={buffer}
                onChange={(e) => updatePlate({ buffer: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 10 mM PBS pH 7.4"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Other Molecule / Ligand</label>
              <input
                type="text"
                value={otherMolecule}
                onChange={(e) => updatePlate({ otherMolecule: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. Ligand X"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Molar Ratio</label>
              <input
                type="text"
                value={ratio}
                onChange={(e) => updatePlate({ ratio: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500"
                placeholder="e.g. 1:5"
              />
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="CD Data Input" icon="📥">
          <div className="flex flex-col gap-4">
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
          </div>
        </CollapsibleSection>

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
                        <span className="text-[10px] font-bold" style={{ color: STRUCTURE_COLORS[key] }}>
                          {key}
                        </span>
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

        <CollapsibleSection title="Chart Configuration" icon="⚙️" defaultOpen={false}>
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
        </CollapsibleSection>

        <CollapsibleSection title="CD Spectra Simulators & Reference Library" icon="🧬" defaultOpen={false}>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {fsPanel === 'mixer' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('mixer')}></div>}

            <ProteinCDMixer isExpanded={fsPanel === 'mixer'} onToggleExpand={() => toggleFs('mixer')} />

            {fsPanel === 'library' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('library')}></div>}

            <CDSpectraLibrary isExpanded={fsPanel === 'library'} onToggleExpand={() => toggleFs('library')} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Lab Notebook Export" icon="📓" defaultOpen={false} className="no-print">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">
              Select the CD data to format and append to the General Comments (which acts as the Lab Notebook entry).
            </p>

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
                let html =
                  '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';

                html +=
                  '<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 CD Experiment Summary</h4>';

                const cbCond = document.getElementById('cd-nb-cond')?.checked;
                const cbStruct = document.getElementById('cd-nb-struct')?.checked;
                const cbSpectra = document.getElementById('cd-nb-spectra')?.checked;

                if (cbCond) {
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;">
                    <b>Sample:</b> ${compound || 'N/A'} |
                    <b>Conc:</b> ${concentration || 'N/A'} |
                    <b>Buffer:</b> ${buffer || solvent || 'N/A'} |
                    <b>Temp:</b> ${temperature || 'N/A'} |
                    <b>Path:</b> ${pathLength || 'N/A'} mm
                  </p>`;
                }

                if (cbStruct) {
                  html +=
                    '<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">';

                  html +=
                    '<tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Structure</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Percentage</th></tr>';

                  Object.entries(structureComposition).forEach(([k, v]) => {
                    html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${k}</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${v}%</td></tr>`;
                  });

                  html += '</table>';
                }

                if (cbSpectra && parsedSpectra.length > 0) {
                  html += `<p style="font-size: 12px; color: #475569; margin-top: 10px;"><b>Spectra recorded:</b> ${parsedSpectra
                    .map((s) => s.title)
                    .join(', ')}</p>`;

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
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative" style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={zoomImage} alt="Zoomed" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />

            <button
              onClick={(e) => {
                e.stopPropagation();
                setZoomImage(null);
              }}
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
