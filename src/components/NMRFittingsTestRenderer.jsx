import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { CollapsibleSection } from './TestShellRenderer';
import { PALETTE, toHex } from '../data/constants';

/* ============================================================================
   NMR FITTINGS / RELAXATION RENDERER
   - Repeatable relaxation tables (one per measured atom/experiment)
   - Each COLUMN is assigned to a residue of the sequence (dropdown)
   - ROWS are delay points and can be added/removed interactively
   - Atom names chosen from a consistent dropdown (not free text only)
   - Import data from Excel / text file, or paste from clipboard
   - Simulation section implements the dipolar + CSA model-free calculator
     (revised port of dipolar_CSA_S2.xls VBA), accounting for T1 and/or T2
============================================================================ */

/* ---------------------------------------------------------------------------
   PHYSICS CONSTANTS
--------------------------------------------------------------------------- */
const HBAR = 1.054571817e-34;          // J·s
const MU0_4PI = 1e-7;                  // T·m/A  (mu0/4pi)
const RGAS = 8.314462618;              // J/(mol·K)
const GAMMA_H = 2.6752218744e8;        // rad/(s·T)  1H
const GAMMA = {                        // rad/(s·T)
  '15N': -2.7126e7,
  '13C': 6.7283e7,
  '1H': 2.6752218744e8,
  '31P': 1.083e8,
};
const DEFAULT_DIST = { '15N': 1.02, '13C': 1.09, '1H': 1.09 }; // Å to coupled 1H
const DEFAULT_CSA = { '15N': -160, '13C': -20, '1H': 0 };       // ppm

const STANDARD_ATOMS = [
  'HN', 'N', 'HA', 'CA', 'CB', 'CG', 'CD', 'CE', 'CZ', 'CO', "C'",
  'Cα', 'Cβ', 'Cγ', 'Cδ', 'CH3', 'NH', 'NH2', 'OG', 'OD', 'OE',
];

const nucleusFromAtom = (atom) => {
  const a = (atom || '').toUpperCase().replace(/[′']/g, '').trim();
  if (!a) return '15N';
  if (a === 'HN') return '15N';                       // amide observed via 15N
  if (a.startsWith('N') || a === 'NH' || a === 'NH2') return '15N';
  if (a.startsWith('C') || a === "C'") return '13C';
  if (a.startsWith('O')) return '15N';
  if (a.startsWith('H')) return '1H';
  return '15N';
};

const residuesFromSequence = (seq) => {
  const s = (seq || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
  return Array.from(s).map((aa, i) => `${aa}${i + 1}`);
};

/* ---------------------------------------------------------------------------
   MODEL-FREE SPECTRAL DENSITY  (Lipari–Szabo) and relaxation rates
   J(w) = (2/5) * [ S²·τc/(1+(w·τc)²) + (1-S²)·τ/(1+(w·τ)²) ]
   with 1/τ = 1/τc + 1/τe  (fast internal motion, optional)
--------------------------------------------------------------------------- */
function spectralDensity(w, tau_c, S2, useInternal, tau_e) {
  let val = (S2 * tau_c) / (1 + (w * tau_c) ** 2);
  if (useInternal && tau_e > 0) {
    const te = 1 / (1 / tau_c + 1 / tau_e);
    val += ((1 - S2) * te) / (1 + (w * te) ** 2);
  }
  return (2 / 5) * val;
}

/**
 * Compute R1, R2, NOE for a heteronucleus relaxed by protons (dipolar + CSA).
 * Mirrors the VBA workbook columns: R1dip, R2dip, R1CSA, R2CSA, R1tot, R2tot, NOE.
 */
function modelFreeRates({ nucleus = '15N', fieldMHz = 600, tau_c_ns = 5, S2 = 0.85,
                          useInternal = false, tau_e_ps = 50, r_A = 1.02, csa_ppm = -160 }) {
  const gx = GAMMA[nucleus] ?? GAMMA['15N'];
  const gxAbs = Math.abs(gx);
  const B0 = (2 * Math.PI * fieldMHz * 1e6) / GAMMA_H;   // T, from 1H frequency
  const wH = GAMMA_H * B0;
  const wX = gxAbs * B0;
  const tau_c = tau_c_ns * 1e-9;
  const tau_e = tau_e_ps * 1e-12;
  const r_m = r_A * 1e-10;

  const J = (w) => spectralDensity(w, tau_c, S2, useInternal, tau_e);

  // dipolar prefactor  d = (mu0/4pi)·gH·gX·hbar / r³
  const D = MU0_4PI * GAMMA_H * gxAbs * HBAR / (r_m ** 3);
  const D2 = D * D;
  // CSA prefactor      c = wX·Δσ / sqrt(3)
  const C = (wX * csa_ppm * 1e-6) / Math.sqrt(3);
  const C2 = C * C;

  const wDiff = Math.abs(wH - wX);
  const wSum = wH + wX;

  const R1dip = (D2 / 4) * (J(wDiff) + 3 * J(wX) + 6 * J(wSum));
  const R2dip = (D2 / 8) * (4 * J(0) + J(wDiff) + 3 * J(wX) + 18 * J(wH) + 6 * J(wSum));
  const sigmaX = (D2 / 4) * (6 * J(wSum) - J(wDiff));

  const R1csa = C2 * J(wX);
  const R2csa = (C2 / 6) * (4 * J(0) + 3 * J(wX));

  const R1 = R1dip + R1csa;
  const R2 = R2dip + R2csa;
  const NOE = R1 > 0 ? 1 + (GAMMA_H / gx) * (sigmaX / R1) : 1;

  return {
    R1dip, R2dip, R1csa, R2csa, R1, R2, NOE,
    T1: R1 > 0 ? 1 / R1 : Infinity,
    T2: R2 > 0 ? 1 / R2 : Infinity,
    ratio: R2 > 0 ? R1 / R2 : 0,
    wH, wX, B0, tau_c,
  };
}

/* ---------------------------------------------------------------------------
   HYDRODYNAMICS  (Stokes–Einstein–Debye)  <->  Molecular Weight
   τc = η · Vmol / (R·T),  Vmol = MW·(v̄ + hydration·v̄w)
--------------------------------------------------------------------------- */
function tauFromMW(MW_Da, eta_PaS, T_K, vbar_cm3g = 0.73, hydration = 0.3) {
  const vbar = vbar_cm3g * 1e-3;                 // m³/kg
  const vw = 1e-3;                               // m³/kg water
  const MWkg = MW_Da * 1e-3;                     // kg/mol
  const Vmol = MWkg * (vbar + hydration * vw);   // m³/mol
  return (eta_PaS * Vmol) / (RGAS * T_K);        // s
}
function mwFromTau(tau_s, eta_PaS, T_K, vbar_cm3g = 0.73, hydration = 0.3) {
  const vbar = vbar_cm3g * 1e-3;
  const vw = 1e-3;
  const Vmol = (tau_s * RGAS * T_K) / eta_PaS;
  const MWkg = Vmol / (vbar + hydration * vw);
  return MWkg * 1e3;                              // Da
}

/* ---------------------------------------------------------------------------
   MONO-EXPONENTIAL FIT   I(t) = A · exp(-R·t)   (Levenberg–Marquardt)
--------------------------------------------------------------------------- */
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-14) continue;
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r) => r[n]);
}

function fitMonoExp(xs, ys) {
  const pts = xs.map((x, i) => ({ x, y: ys[i] }))
    .filter((p) => isFinite(p.x) && isFinite(p.y));
  const n = pts.length;
  if (n < 3) return null;

  // initial guess via log-linear regression on positive intensities
  const pos = pts.filter((p) => p.y > 0);
  let R0 = 1, A0 = Math.max(...pts.map((p) => Math.abs(p.y)));
  if (pos.length >= 2) {
    const lx = pos.map((p) => p.x), ly = pos.map((p) => Math.log(p.y));
    const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
    const my = ly.reduce((a, b) => a + b, 0) / ly.length;
    let num = 0, den = 0;
    for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
    const slope = den > 0 ? num / den : -1;
    R0 = Math.max(1e-6, -slope);
    A0 = Math.max(1e-9, Math.exp(my + R0 * mx));
  }

  // LM in transformed space [lnA, lnR] to enforce positivity
  let p = [Math.log(A0), Math.log(R0)];
  const model = (x, pp) => Math.exp(pp[0] - Math.exp(pp[1]) * x);
  const rss = (pp) => pts.reduce((s, q) => { const r = q.y - model(q.x, pp); return s + r * r; }, 0);
  let cur = rss(p);
  let lambda = 1e-3;

  for (let it = 0; it < 200; it++) {
    const JtJ = [[0, 0], [0, 0]]; const Jtr = [0, 0];
    for (let i = 0; i < n; i++) {
      const x = pts[i].x; const f0 = model(x, p);
      const g = [];
      for (let j = 0; j < 2; j++) {
        const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6);
        const pp = p.slice(); pp[j] += h;
        g.push((model(x, pp) - f0) / h);
      }
      const r = pts[i].y - f0;
      for (let a = 0; a < 2; a++) { Jtr[a] += g[a] * r; for (let b = 0; b < 2; b++) JtJ[a][b] += g[a] * g[b]; }
    }
    const A = [
      [JtJ[0][0] * (1 + lambda), JtJ[0][1]],
      [JtJ[1][0], JtJ[1][1] * (1 + lambda)],
    ];
    const dp = solveLinear(A, Jtr);
    if (!dp) { lambda *= 10; if (lambda > 1e12) break; continue; }
    const pn = [p[0] + dp[0], p[1] + dp[1]];
    const nr = rss(pn);
    if (nr < cur) { p = pn; cur = nr; lambda = Math.max(lambda * 0.5, 1e-12); }
    else { lambda *= 10; if (lambda > 1e12) break; }
  }

  const A = Math.exp(p[0]); const R = Math.exp(p[1]);
  const meanY = pts.reduce((s, q) => s + q.y, 0) / n;
  let ssTot = 0, ssRes = 0;
  pts.forEach((q) => { ssTot += (q.y - meanY) ** 2; ssRes += (q.y - model(q.x, p)) ** 2; });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  // standard error of R from covariance (numerical Hessian at solution)
  let seR = null;
  const H = [[0, 0], [0, 0]];
  for (let i = 0; i < n; i++) {
    const x = pts[i].x; const f0 = model(x, p); const g = [];
    for (let j = 0; j < 2; j++) {
      const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6);
      const pp = p.slice(); pp[j] += h;
      g.push((model(x, pp) - f0) / h);
    }
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) H[a][b] += g[a] * g[b];
  }
  const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
  if (Math.abs(det) > 1e-30) {
    const s2 = ssRes / Math.max(1, n - 2);
    const varLnR = (H[0][0] / det) * s2;       // inverse[1][1]
    if (varLnR > 0) seR = R * Math.sqrt(varLnR);
  }

  return { A, R, T: 1 / R, r2, n, seR, seT: seR != null ? seR / (R * R) : null };
}

/* ---------------------------------------------------------------------------
   IMPORT / PASTE PARSING
--------------------------------------------------------------------------- */
const isNumeric = (s) => /^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(String(s).trim());

function parseDelimited(text) {
  return String(text).replace(/\r/g, '').split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => {
      let parts = line.split('\t');
      if (parts.length === 1) parts = line.split(/[;,]/);
      if (parts.length === 1) parts = line.split(/\s+/);
      return parts.map((s) => s.trim());
    });
}

// Build {grid, delays, colResidues} from an array-of-arrays
function buildFromAoa(aoa, firstRowRes, firstColDelay) {
  if (!aoa || aoa.length === 0) return null;
  let dataRows = aoa;
  let colResidues = null;
  if (firstRowRes && aoa.length > 1) {
    colResidues = aoa[0].slice(firstColDelay ? 1 : 0).map(String);
    dataRows = aoa.slice(1);
  }
  let delays = null; let gridRows = dataRows;
  if (firstColDelay && dataRows.length > 0) {
    delays = dataRows.map((r) => parseFloat(r[0]));
    gridRows = dataRows.map((r) => r.slice(1));
  }
  const nCols = gridRows[0] ? gridRows[0].length : 0;
  if (!colResidues) colResidues = new Array(nCols).fill('');
  if (!delays) delays = gridRows.map((_, i) => i);
  const grid = gridRows.map((r) => Array.from({ length: nCols }, (_, c) => r[c] ?? ''));
  return { grid, delays, colResidues, nRows: grid.length, nCols };
}

/* ---------------------------------------------------------------------------
   TABLE IMPORT PANEL (file + paste)
--------------------------------------------------------------------------- */
function TableImport({ residueOptions, onApply }) {
  const [text, setText] = useState('');
  const [firstRowRes, setFirstRowRes] = useState(true);
  const [firstColDelay, setFirstColDelay] = useState(true);
  const fileRef = useRef(null);

  const applyText = () => { if (text.trim()) onApply(buildFromAoa(parseDelimited(text), firstRowRes, firstColDelay)); };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXl = /\.xlsx?$/i.test(file.name);
    const finish = (aoa) => { const b = buildFromAoa(aoa, firstRowRes, firstColDelay); if (b) onApply(b); };
    if (isXl) {
      const rd = new FileReader();
      rd.onload = (ev) => {
        try {
          const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          finish(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));
        } catch { alert('Could not read the Excel file.'); }
      };
      rd.readAsArrayBuffer(file);
    } else {
      const rd = new FileReader();
      rd.onload = (ev) => finish(parseDelimited(ev.target.result));
      rd.readAsText(file);
    }
    e.target.value = '';
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={firstRowRes} onChange={(e) => setFirstRowRes(e.target.checked)} className="accent-blue-600" />
          First row = residue labels
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={firstColDelay} onChange={(e) => setFirstColDelay(e.target.checked)} className="accent-blue-600" />
          First column = delay values
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-md shadow-sm"
        >
          📂 Load Excel / Text file
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.tsv" className="hidden" onChange={handleFile} />
        <span className="text-[10px] text-slate-400">.xlsx .xls .csv .txt .tsv</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'…or paste from Excel / clipboard here.\nTab, comma, semicolon or space separated.\nExample:\n0\t0.98\t1.02\n50\t0.61\t0.66'}
        className="w-full h-24 text-xs font-mono border border-slate-300 rounded-md p-2 outline-none focus:border-blue-500 resize-y"
      />
      <div>
        <button onClick={applyText} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-md shadow-sm">
          📋 Import pasted data
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DECAY CURVE CHART (per table)
--------------------------------------------------------------------------- */
function DecayChart({ table, colFits }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const ds = [];
    for (let c = 0; c < table.nCols; c++) {
      const color = toHex(PALETTE[c % PALETTE.length]);
      const pts = [];
      for (let r = 0; r < table.nRows; r++) {
        const x = table.delays[r];
        const y = parseFloat(table.grid[r]?.[c]);
        if (isFinite(x) && isFinite(y)) pts.push({ x, y });
      }
      if (pts.length === 0) continue;
      ds.push({
        label: table.colResidues[c] || `Col ${c + 1}`,
        data: pts, showLine: false, pointRadius: 4,
        backgroundColor: color, borderColor: color, type: 'scatter',
      });
      const fit = colFits[c]?.fit;
      if (fit && pts.length >= 2) {
        const xmin = Math.min(...pts.map((p) => p.x));
        const xmax = Math.max(...pts.map((p) => p.x));
        const curve = [];
        for (let i = 0; i <= 40; i++) {
          const x = xmin + ((xmax - xmin) * i) / 40;
          curve.push({ x, y: fit.A * Math.exp(-fit.R * x) });
        }
        ds.push({
          label: `${table.colResidues[c] || `Col ${c + 1}`} fit`,
          data: curve, showLine: true, pointRadius: 0,
          borderColor: color, backgroundColor: 'transparent', borderWidth: 2, type: 'line', tension: 0.25,
        });
      }
    }
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, {
      type: 'scatter',
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: `Delay (${table.delayUnit})` } },
          y: { title: { display: true, text: 'Intensity / Volume' } },
        },
        plugins: { legend: { display: true, labels: { boxWidth: 12 } } },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [table, colFits]);

  return <div style={{ height: 300 }}><canvas ref={ref} /></div>;
}

/* ---------------------------------------------------------------------------
   SIMULATION SWEEP CHART  (R1 & R2 vs τc)
--------------------------------------------------------------------------- */
function SimSweepChart({ params, nucleus }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const tcs = []; const r1 = []; const r2 = [];
    for (let t = 0.1; t <= 50; t += 0.2) {
      const res = modelFreeRates({ ...params, nucleus, tau_c_ns: t });
      tcs.push(t); r1.push(res.R1); r2.push(res.R2);
    }
    const data = tcs.map((t, i) => ({ x: t, y1: r1[i], y2: r2[i] }));
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, {
      type: 'line',
      data: {
        datasets: [
          { label: 'R1 (s⁻¹)', data: data.map((d) => ({ x: d.x, y: d.y1 })), borderColor: '#2563eb', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 },
          { label: 'R2 (s⁻¹)', data: data.map((d) => ({ x: d.x, y: d.y2 })), borderColor: '#dc2626', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: 'τc (ns)' } },
          y: { title: { display: true, text: 'Rate (s⁻¹)' } },
        },
        plugins: { legend: { display: true } },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [params, nucleus]);

  return <div style={{ height: 260 }}><canvas ref={ref} /></div>;
}

/* ---------------------------------------------------------------------------
   TABLE FACTORY
--------------------------------------------------------------------------- */
const makeTable = (overrides = {}) => ({
  id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
  atom: 'HN',
  relaxType: 'T1',          // 'T1' | 'T2'
  delayUnit: 'ms',          // 'ms' | 's'
  nRows: 6, nCols: 4,
  delays: [0, 50, 100, 200, 400, 800],
  colResidues: ['', '', '', ''],
  grid: Array.from({ length: 6 }, () => new Array(4).fill('')),
  ...overrides,
});

/* ========================================================================== */
export const NMRFittingsTestRenderer = ({
  activeTest = {},
  updateActiveTest,
  TestHeader,
  compoundMeta = {},
  allCmpds = [],
  operators = [],
  customConc = {}, setCustomConc,
  cmpColors = {}, setCmpColors,
  setCustomCmpds, testCategories = [],
  appClipboard, setAppClipboard, plateModelRef,
}) => {
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };

  const tables = Array.isArray(activeTest.nmrTables) ? activeTest.nmrTables : [];

  /* -------- ensure at least one table -------- */
  useEffect(() => {
    if (!Array.isArray(activeTest.nmrTables) || activeTest.nmrTables.length === 0) {
      update({ nmrTables: [makeTable()] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------- simulation params -------- */
  const sim = {
    nucleus: '15N', fieldMHz: 600, tau_c_ns: 5, S2: 0.85,
    useInternal: false, tau_e_ps: 50, r_A: 1.02, csa_ppm: -160,
    temperature: 298, viscosity: 0.89e-3, vbar: 0.73, hydration: 0.3, MW: 12000,
    ...(activeTest.sim || {}),
  };
  const setSim = (patch) => update({ sim: { ...sim, ...patch } });

  /* -------- molecule / residues / atoms -------- */
  const moleculeOptions = useMemo(
    () => [...new Set([...allCmpds, ...Object.keys(compoundMeta || {})])].sort(),
    [allCmpds, compoundMeta]
  );
  const moleculeId = activeTest.moleculeId || '';
  const sequence = (compoundMeta || {})[moleculeId]?.sequence || '';
  const customResidues = Array.isArray(activeTest.customResidues) ? activeTest.customResidues : [];
  const residueOptions = useMemo(
    () => [...new Set([...residuesFromSequence(sequence), ...customResidues])],
    [sequence, customResidues.join('|')]
  );
  const customAtoms = Array.isArray(activeTest.customAtoms) ? activeTest.customAtoms : [];
  const atomOptions = useMemo(
    () => [...new Set([...STANDARD_ATOMS, ...customAtoms])],
    [customAtoms.join('|')]
  );

  /* -------- table mutators -------- */
  const updateTable = (id, patch) => update({ nmrTables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const setCell = (t, r, c, v) => {
    const g = t.grid.map((row) => row.slice());
    while (g.length < t.nRows) g.push(new Array(t.nCols).fill(''));
    while (g[r].length < t.nCols) g[r].push('');
    g[r][c] = v;
    updateTable(t.id, { grid: g });
  };
  const setDelay = (t, r, v) => { const d = t.delays.slice(); d[r] = v; updateTable(t.id, { delays: d }); };
  const setColResidue = (t, c, v) => { const cr = t.colResidues.slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };

  const addRow = (t) => {
    const last = t.delays.length ? Number(t.delays[t.delays.length - 1]) || 0 : 0;
    updateTable(t.id, {
      nRows: t.nRows + 1,
      delays: [...t.delays, last],
      grid: [...t.grid.map((r) => r.slice()), new Array(t.nCols).fill('')],
    });
  };
  const removeRow = (t, r) => {
    if (t.nRows <= 1) return;
    updateTable(t.id, {
      nRows: t.nRows - 1,
      delays: t.delays.filter((_, i) => i !== r),
      grid: t.grid.filter((_, i) => i !== r),
    });
  };
  const addCol = (t) => {
    updateTable(t.id, {
      nCols: t.nCols + 1,
      colResidues: [...t.colResidues, ''],
      grid: t.grid.map((r) => [...r, '']),
    });
  };
  const removeCol = (t, c) => {
    if (t.nCols <= 1) return;
    updateTable(t.id, {
      nCols: t.nCols - 1,
      colResidues: t.colResidues.filter((_, i) => i !== c),
      grid: t.grid.map((r) => r.filter((_, i) => i !== c)),
    });
  };

  const addTable = () => update({ nmrTables: [...tables, makeTable()] });
  const duplicateTable = (t) => update({
    nmrTables: [...tables, { ...t, id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), grid: t.grid.map((r) => r.slice()), delays: t.delays.slice(), colResidues: t.colResidues.slice() }],
  });
  const removeTable = (id) => {
    if (tables.length <= 1) { alert('Keep at least one table.'); return; }
    update({ nmrTables: tables.filter((t) => t.id !== id) });
  };

  const applyImport = (t, data) => {
    if (!data) { alert('Nothing to import.'); return; }
    updateTable(t.id, {
      nRows: data.nRows, nCols: data.nCols, grid: data.grid,
      delays: data.delays, colResidues: data.colResidues,
    });
  };

  /* -------- per-table fits (rate in s⁻¹) -------- */
  const fittedByTable = useMemo(() => {
    const out = {};
    tables.forEach((t) => {
      const unit = t.delayUnit === 'ms' ? 1e-3 : 1; // seconds per display unit
      const cols = [];
      for (let c = 0; c < t.nCols; c++) {
        const xs = []; const ys = [];
        for (let r = 0; r < t.nRows; r++) {
          const x = Number(t.delays[r]);
          const y = parseFloat(t.grid[r]?.[c]);
          if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
        }
        const fit = fitMonoExp(xs, ys);
        let fitS = null;
        if (fit) {
          const R_s = fit.R / unit;                 // per second
          fitS = {
            ...fit,
            R_s,
            T_s: R_s > 0 ? 1 / R_s : Infinity,
            seR_s: fit.seR != null ? fit.seR / unit : null,
          };
        }
        cols.push({ residue: t.colResidues[c] || `Col ${c + 1}`, fit: fitS });
      }
      out[t.id] = cols;
    });
    return out;
  }, [tables]);

  /* -------- simulate rates per table nucleus -------- */
  const simByNucleus = (nucleus) => modelFreeRates({
    nucleus, fieldMHz: sim.fieldMHz, tau_c_ns: sim.tau_c_ns, S2: sim.S2,
    useInternal: sim.useInternal, tau_e_ps: sim.tau_e_ps,
    r_A: sim.r_A || DEFAULT_DIST[nucleus] || 1.02,
    csa_ppm: sim.csa_ppm ?? DEFAULT_CSA[nucleus] ?? -160,
  });

  /* -------- hydrodynamics -------- */
  const tau_c_fromMW = tauFromMW(sim.MW, sim.viscosity, sim.temperature, sim.vbar, sim.hydration) * 1e9; // ns
  const MW_fromTau = mwFromTau(sim.tau_c_ns * 1e-9, sim.viscosity, sim.temperature, sim.vbar, sim.hydration);

  /* -------- estimate τc from mean R1/R2 ratio -------- */
  const estimateTauFromRatio = () => {
    const ratios = [];
    tables.forEach((t) => (fittedByTable[t.id] || []).forEach((c) => {
      if (c.fit && c.fit.R_s > 0 && t.relaxType === 'T2') {
        // need paired R1; approximate by scanning single table sets separately
      }
    }));
    // Simpler: use simulated ratio matching average of R2-type vs R1-type rates
    let r1 = null, r2 = null;
    tables.forEach((t) => (fittedByTable[t.id] || []).forEach((c) => {
      if (!c.fit) return;
      if (t.relaxType === 'T1') r1 = c.fit.R_s;
      if (t.relaxType === 'T2') r2 = c.fit.R_s;
    }));
    if (r1 == null || r2 == null) { alert('Need both a T1 and a T2 table with valid fits to estimate τc.'); return; }
    const target = r1 / r2;
    let best = { t: sim.tau_c_ns, err: Infinity };
    for (let t = 0.1; t <= 60; t += 0.05) {
      const res = simByNucleus(sim.nucleus);
      const rr = modelFreeRates({ ...sim, nucleus: sim.nucleus, tau_c_ns: t });
      const err = Math.abs((rr.R1 / rr.R2) - target);
      if (err < best.err) best = { t, err };
    }
    setSim({ tau_c_ns: Number(best.t.toFixed(2)) });
  };

  /* -------- Excel export -------- */
  const exportXLS = () => {
    try {
      const wb = XLSX.utils.book_new();
      tables.forEach((t, idx) => {
        const aoa = [[`Table ${idx + 1} — atom ${t.atom} — ${t.relaxType} (${t.delayUnit})`]];
        aoa.push([`Delay (${t.delayUnit})`, ...t.colResidues.map((r) => r || '')]);
        for (let r = 0; r < t.nRows; r++) aoa.push([t.delays[r], ...t.grid[r]]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Table${idx + 1}`);
        const fAoa = [['Residue', 'Rate (s⁻¹)', 'T (s)', 'R²', 'N']];
        (fittedByTable[t.id] || []).forEach((cf) => {
          if (cf.fit) fAoa.push([cf.residue, cf.fit.R_s, cf.fit.T_s, cf.fit.r2, cf.fit.n]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fAoa), `Fit${idx + 1}`);
      });
      const sAoa = [['Nucleus', 'Field (MHz)', 'τc (ns)', 'S²', 'R1 (s⁻¹)', 'R2 (s⁻¹)', 'NOE', 'T1 (s)', 'T2 (s)']];
      const sr = simByNucleus(sim.nucleus);
      sAoa.push([sim.nucleus, sim.fieldMHz, sim.tau_c_ns, sim.S2, sr.R1, sr.R2, sr.NOE, sr.T1, sr.T2]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sAoa), 'Simulation');
      XLSX.writeFile(wb, `NMR_Relaxation_${(activeTest.name || 'export').replace(/[^a-z0-9]+/gi, '_')}.xlsx`);
    } catch (e) { alert('Export failed: ' + e.message); }
  };

  /* -------- notebook summary -------- */
  const appendSummary = () => {
    let html = '<div style="font-family:sans-serif;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px;">';
    html += '<h4 style="margin:0 0 8px;color:#1e40af;">🧲 NMR Relaxation Summary</h4>';
    tables.forEach((t, i) => {
      html += `<p style="margin:4px 0;"><b>Table ${i + 1}</b> — ${t.atom} (${t.relaxType}, delays in ${t.delayUnit})</p><ul>`;
      (fittedByTable[t.id] || []).forEach((c) => {
        if (c.fit) html += `<li>${c.residue}: R=${c.fit.R_s.toFixed(3)} s⁻¹ → ${t.relaxType}=${c.fit.T_s.toFixed(3)} s (R²=${c.fit.r2.toFixed(3)})</li>`;
      });
      html += '</ul>';
    });
    const sr = simByNucleus(sim.nucleus);
    html += `<p style="margin:6px 0;"><b>Sim</b> (${sim.nucleus}, ${sim.fieldMHz} MHz, τc=${sim.tau_c_ns} ns, S²=${sim.S2}): R1=${sr.R1.toFixed(3)} s⁻¹, R2=${sr.R2.toFixed(3)} s⁻¹, NOE=${sr.NOE.toFixed(3)}</p>`;
    html += '</div>';
    update({ comments: (activeTest.comments || '') + (activeTest.comments ? '<br/>' : '') + html });
    alert('Summary appended to Lab Notebook.');
  };

  /* ========================================================================= */
  const renderTable = (t, tIndex) => {
    const nucleus = nucleusFromAtom(t.atom);
    const colFits = fittedByTable[t.id] || [];
    return (
      <CollapsibleSection key={t.id} title={`Table ${tIndex + 1} — ${t.atom || '…'} (${t.relaxType})`} icon="📈" defaultOpen={tIndex === 0}>
        <div className="flex flex-col gap-4">
          {/* ---- table meta ---- */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Observed atom</label>
              <select
                value={t.atom}
                onChange={(e) => updateTable(t.id, { atom: e.target.value })}
                className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500"
              >
                {atomOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-0.5">nucleus: <b>{nucleus}</b></p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Relaxation type</label>
              <select
                value={t.relaxType}
                onChange={(e) => updateTable(t.id, { relaxType: e.target.value })}
                className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500"
              >
                <option value="T1">T1 (R1)</option>
                <option value="T2">T2 (R2)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Delay unit</label>
              <select
                value={t.delayUnit}
                onChange={(e) => updateTable(t.id, { delayUnit: e.target.value })}
                className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500"
              >
                <option value="ms">ms</option>
                <option value="s">s</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={() => duplicateTable(t)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold px-3 py-2 rounded-md">♻️ Duplicate</button>
              <button onClick={() => removeTable(t.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold px-3 py-2 rounded-md">🗑️ Remove</button>
            </div>
            <div className="flex items-end">
              <button onClick={addTable} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-md w-full">+ New table</button>
            </div>
          </div>

          {/* ---- data grid ---- */}
          <div className="overflow-auto border border-slate-300 rounded-lg bg-white shadow-inner">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="bg-slate-200 border border-slate-300 p-1 sticky top-0 left-0 z-20 text-slate-600">Delay ({t.delayUnit})</th>
                  {Array.from({ length: t.nCols }, (_, c) => (
                    <th key={c} className="bg-slate-100 border border-slate-300 p-1 min-w-[110px] sticky top-0 z-10">
                      <div className="flex flex-col gap-1">
                        {residueOptions.length > 0 ? (
                          <select
                            value={t.colResidues[c] || ''}
                            onChange={(e) => setColResidue(t, c, e.target.value)}
                            className="w-full text-center border border-slate-300 rounded p-0.5 text-[11px] font-bold text-blue-800 bg-white"
                          >
                            <option value="">— residue —</option>
                            {residueOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : (
                          <input
                            value={t.colResidues[c] || ''}
                            onChange={(e) => setColResidue(t, c, e.target.value)}
                            placeholder="residue"
                            className="w-full text-center border border-slate-300 rounded p-0.5 text-[11px] font-bold text-blue-800"
                          />
                        )}
                        <span className="text-[9px] text-slate-400 font-normal">{(t.colResidues[c] ? `${t.colResidues[c]}-${t.atom}` : '')}</span>
                        <button onClick={() => removeCol(t, c)} className="self-end text-red-400 hover:text-red-600 text-[10px] leading-none">✕ col</button>
                      </div>
                    </th>
                  ))}
                  <th className="bg-slate-50 border border-slate-200 p-1 sticky top-0 z-10">
                    <button onClick={() => addCol(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px]">+ col</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: t.nRows }, (_, r) => (
                  <tr key={r}>
                    <td className="bg-slate-100 border border-slate-300 p-0.5 sticky left-0 z-10">
                      <div className="flex items-center gap-1">
                        <input
                          type="number" step="any"
                          value={t.delays[r]}
                          onChange={(e) => setDelay(t, r, e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-16 text-center border border-slate-300 rounded p-0.5 text-[11px] font-mono"
                        />
                        <button onClick={() => removeRow(t, r)} className="text-red-400 hover:text-red-600 text-[11px]">✕</button>
                      </div>
                    </td>
                    {Array.from({ length: t.nCols }, (_, c) => (
                      <td key={c} className="border border-slate-200 p-0">
                        <input
                          value={t.grid[r]?.[c] ?? ''}
                          onChange={(e) => setCell(t, r, c, e.target.value)}
                          className="w-full h-7 text-center outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 font-mono text-[11px]"
                        />
                      </td>
                    ))}
                    <td className="border border-slate-100 p-0.5 text-center text-slate-300">·</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={t.nCols + 2} className="bg-slate-50 border border-slate-200 p-1">
                    <button onClick={() => addRow(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px]">+ add row</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ---- import ---- */}
          <TableImport residueOptions={residueOptions} onApply={(data) => applyImport(t, data)} />

          {/* ---- fits ---- */}
          <div>
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Fitted {t.relaxType} per residue</h4>
            <div className="overflow-x-auto">
              <table className="text-xs border border-slate-200 rounded">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="p-1.5 border border-slate-200">Residue</th>
                    <th className="p-1.5 border border-slate-200">R ({t.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹</th>
                    <th className="p-1.5 border border-slate-200">{t.relaxType} (s)</th>
                    <th className="p-1.5 border border-slate-200">R²</th>
                    <th className="p-1.5 border border-slate-200">N</th>
                  </tr>
                </thead>
                <tbody>
                  {colFits.map((cf, i) => (
                    <tr key={i} className="text-center">
                      <td className="p-1.5 border border-slate-200 font-bold text-blue-800">{cf.residue}</td>
                      <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.R_s.toFixed(3) + (cf.fit.seR_s ? ` ± ${cf.fit.seR_s.toFixed(3)}` : '') : '—'}</td>
                      <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? (cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s.toFixed(3)) : '—'}</td>
                      <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.r2.toFixed(3) : '—'}</td>
                      <td className="p-1.5 border border-slate-200">{cf.fit ? cf.fit.n : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- decay chart ---- */}
          <div className="border border-slate-200 rounded-lg p-3 bg-white">
            <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Decay curves</h4>
            <DecayChart table={t} colFits={colFits} />
          </div>
        </div>
      </CollapsibleSection>
    );
  };

  /* ========================================================================= */
  const sr = simByNucleus(sim.nucleus);
  const numInput = (label, key, step = 'any', extra = {}) => (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{label}</label>
      <input
        type="number" step={step} value={sim[key]}
        onChange={(e) => setSim({ [key]: e.target.value === '' ? '' : Number(e.target.value) })}
        className="w-full border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500"
        {...extra}
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {TestHeader}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        <div className="flex flex-col gap-6">

          {/* ================= SETUP ================= */}
          <CollapsibleSection title="Setup — Molecule, Sequence & Atoms" icon="🧭" defaultOpen={true}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Target molecule</label>
                <select
                  value={moleculeId}
                  onChange={(e) => update({ moleculeId: e.target.value })}
                  className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500"
                >
                  <option value="">— select molecule —</option>
                  {moleculeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {sequence && <p className="text-[10px] text-slate-400 mt-1 break-all">Seq: {sequence}</p>}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Add custom residue</label>
                <div className="flex gap-2">
                  <input id={`add-res-${activeTest.id}`} placeholder="e.g. V14" className="flex-1 border border-slate-300 rounded-md p-2 text-xs outline-none focus:border-blue-500" />
                  <button
                    onClick={() => {
                      const el = document.getElementById(`add-res-${activeTest.id}`);
                      const v = (el.value || '').trim();
                      if (v && !customResidues.includes(v)) update({ customResidues: [...customResidues, v] });
                      el.value = '';
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-md text-xs"
                  >Add</button>
                </div>
                {residueOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 max-h-16 overflow-y-auto custom-scrollbar">
                    {residueOptions.map((r) => (
                      <span key={r} className="bg-white border border-slate-300 text-slate-600 text-[10px] px-2 py-0.5 rounded font-bold">{r}</span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Add custom atom</label>
                <div className="flex gap-2">
                  <input id={`add-atom-${activeTest.id}`} placeholder="e.g. Cζ" className="flex-1 border border-slate-300 rounded-md p-2 text-xs outline-none focus:border-blue-500" />
                  <button
                    onClick={() => {
                      const el = document.getElementById(`add-atom-${activeTest.id}`);
                      const v = (el.value || '').trim();
                      if (v && !customAtoms.includes(v)) update({ customAtoms: [...customAtoms, v] });
                      el.value = '';
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-md text-xs"
                  >Add</button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2 max-h-16 overflow-y-auto custom-scrollbar">
                  {atomOptions.map((a) => (
                    <span key={a} className="bg-white border border-slate-300 text-slate-600 text-[10px] px-2 py-0.5 rounded font-bold">{a}</span>
                  ))}
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ================= DATA TABLES ================= */}
          <CollapsibleSection title="Relaxation Data Tables" icon="📊" defaultOpen={true}>
            <div className="flex flex-col gap-6">
              {tables.map((t, i) => renderTable(t, i))}
              {tables.length === 0 && <p className="text-sm text-slate-400">No tables yet.</p>}
              <button onClick={addTable} className="self-start text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">
                + Add relaxation table
              </button>
            </div>
          </CollapsibleSection>

          {/* ================= SIMULATION ================= */}
          <CollapsibleSection title="Simulation — Dipolar + CSA (model-free)" icon="⚛️" defaultOpen={true}>
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nucleus</label>
                  <select value={sim.nucleus} onChange={(e) => {
                    const n = e.target.value;
                    setSim({ nucleus: n, r_A: DEFAULT_DIST[n] || 1.02, csa_ppm: DEFAULT_CSA[n] ?? -160 });
                  }} className="w-full border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    {Object.keys(GAMMA).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {numInput('Field (MHz)', 'fieldMHz')}
                {numInput('τc (ns)', 'tau_c_ns')}
                {numInput('S² (0–1)', 'S2', '0.01', { min: 0, max: 1 })}
                {numInput('r (Å)', 'r_A', '0.01')}
                {numInput('CSA (ppm)', 'csa_ppm')}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={sim.useInternal} onChange={(e) => setSim({ useInternal: e.target.checked })} className="accent-blue-600" />
                  Internal motion (τe)
                </label>
                {numInput('τe (ps)', 'tau_e_ps')}
                <button onClick={estimateTauFromRatio} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-md">
                  🎯 Estimate τc from R1/R2
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-blue-600 uppercase font-bold">R1 (s⁻¹)</div>
                  <div className="font-mono font-bold text-blue-800">{sr.R1.toFixed(3)}</div>
                  <div className="text-[10px] text-blue-500">T1 = {sr.T1 === Infinity ? '∞' : sr.T1.toFixed(3)} s</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-red-600 uppercase font-bold">R2 (s⁻¹)</div>
                  <div className="font-mono font-bold text-red-800">{sr.R2.toFixed(3)}</div>
                  <div className="text-[10px] text-red-500">T2 = {sr.T2 === Infinity ? '∞' : sr.T2.toFixed(3)} s</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-emerald-600 uppercase font-bold">NOE</div>
                  <div className="font-mono font-bold text-emerald-800">{sr.NOE.toFixed(3)}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-amber-600 uppercase font-bold">R1/R2</div>
                  <div className="font-mono font-bold text-amber-800">{sr.ratio.toFixed(3)}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-slate-600 uppercase font-bold">R1dip / R1csa</div>
                  <div className="font-mono text-slate-700 text-xs">{sr.R1dip.toFixed(3)} / {sr.R1csa.toFixed(3)}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-slate-600 uppercase font-bold">R2dip / R2csa</div>
                  <div className="font-mono text-slate-700 text-xs">{sr.R2dip.toFixed(3)} / {sr.R2csa.toFixed(3)}</div>
                </div>
              </div>

              {/* hydrodynamics */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Hydrodynamics (τc ↔ MW)</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-2">
                  {numInput('Temperature (K)', 'temperature')}
                  {numInput('Viscosity (Pa·s)', 'viscosity', '0.0001')}
                  {numInput('v̄ (cm³/g)', 'vbar', '0.01')}
                  {numInput('Hydration (g/g)', 'hydration', '0.05')}
                  {numInput('MW (Da)', 'MW')}
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="bg-white border border-slate-300 rounded px-3 py-1.5">MW → τc: <b>{tau_c_fromMW.toFixed(2)} ns</b></span>
                  <span className="bg-white border border-slate-300 rounded px-3 py-1.5">τc ({sim.tau_c_ns} ns) → MW: <b>{(MW_fromTau / 1000).toFixed(1)} kDa</b></span>
                  <button onClick={() => setSim({ tau_c_ns: Number(tau_c_fromMW.toFixed(2)) })} className="text-blue-600 hover:underline font-bold">Use MW→τc</button>
                  <button onClick={() => setSim({ MW: Math.round(MW_fromTau) })} className="text-blue-600 hover:underline font-bold">Use τc→MW</button>
                </div>
              </div>

              {/* sweep chart */}
              <div className="border border-slate-200 rounded-lg p-3 bg-white">
                <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">R1 & R2 vs τc (current {sim.nucleus} params)</h4>
                <SimSweepChart params={sim} nucleus={sim.nucleus} />
              </div>

              {/* comparison fitted vs simulated */}
              <div>
                <h4 className="text-xs font-bold text-slate-600 uppercase mb-2">Fitted vs simulated rates</h4>
                <div className="overflow-x-auto">
                  <table className="text-xs border border-slate-200 w-full">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600">
                        <th className="p-1.5 border border-slate-200 text-left">Table</th>
                        <th className="p-1.5 border border-slate-200 text-left">Residue</th>
                        <th className="p-1.5 border border-slate-200">Type</th>
                        <th className="p-1.5 border border-slate-200">Fitted (s⁻¹)</th>
                        <th className="p-1.5 border border-slate-200">Simulated (s⁻¹)</th>
                        <th className="p-1.5 border border-slate-200">Δ (fit − sim)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.map((t, ti) => (fittedByTable[t.id] || []).map((cf, ci) => {
                        const simRates = simByNucleus(nucleusFromAtom(t.atom));
                        const simVal = t.relaxType === 'T1' ? simRates.R1 : simRates.R2;
                        const fitVal = cf.fit ? cf.fit.R_s : null;
                        return (
                          <tr key={`${ti}-${ci}`} className="text-center">
                            <td className="p-1.5 border border-slate-200 text-left">{t.atom} ({t.relaxType})</td>
                            <td className="p-1.5 border border-slate-200 text-left font-bold text-blue-800">{cf.residue}</td>
                            <td className="p-1.5 border border-slate-200">{t.relaxType === 'T1' ? 'R1' : 'R2'}</td>
                            <td className="p-1.5 border border-slate-200 font-mono">{fitVal != null ? fitVal.toFixed(3) : '—'}</td>
                            <td className="p-1.5 border border-slate-200 font-mono">{simVal.toFixed(3)}</td>
                            <td className="p-1.5 border border-slate-200 font-mono">{fitVal != null ? (fitVal - simVal).toFixed(3) : '—'}</td>
                          </tr>
                        );
                      }))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* ================= EXPORT ================= */}
          <CollapsibleSection title="Export & Lab Notebook" icon="📓" defaultOpen={false}>
            <div className="flex flex-wrap gap-3">
              <button onClick={exportXLS} className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">
                ⬇️ Export to Excel (.xlsx)
              </button>
              <button onClick={appendSummary} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">
                + Append summary to Lab Notebook
              </button>
            </div>
          </CollapsibleSection>

        </div>
      </div>
    </div>
  );
};

export default NMRFittingsTestRenderer;
