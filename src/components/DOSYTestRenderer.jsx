/* =========================================================================
   DOSYTestRenderer.jsx — test page "DOSY".

   Structure (same skeleton as NMR Fittings):
     • General (TestShellRenderer) — primary classification "Molecular
       Structure and Dynamics", secondary "Diffusion by DOSY".
     • Experiment Setup  — dataset name / experiment number / link.
     • Instrumental Setup — NMR instrument + DOSY gradient parameters
       (max gradient G, diffusion time Δ, small delta δ). No operator here.
     • Data              — gradient % (0–100) vs intensity grids, paste from Excel.
     • Data Analysis     — Stejskal-Tanner fit (read-only Δ/δ/maxG + per-column D).
     • Simulations       — diffusion coefficient (Stokes–Einstein).
   ========================================================================= */
import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import { DOSY_TAB_CONFIG } from './tabConfigs';
import { NMRInstrumentalSetup } from './NMRInstrumentalSetup';
import { makeTable, stokesEinsteinD, radiusFromMW, GAMMA_H } from './NMRFittingsTestRenderer';
import { enableCellClipboard, cellAttrs } from '../utils/cellClipboard';

enableCellClipboard(); // global multi-cell select / copy / paste for data tables

// Stejskal-Tanner: I = I0·exp(−b·D) with b = (γ·δ·G)²·(Δ−δ/3).
// The data table stores the gradient as a percentage (0–100) of the maximum
// gradient G_max (G/cm) entered in Instrumental Setup (1 G/cm = 0.01 T/m).
const computeB = (gPct, maxG_Gcm, deltaS, bigDeltaS) => {
  const g = Number(gPct);
  if (!Number.isFinite(g) || g <= 0) return 0;
  const G_Tm = (Number(maxG_Gcm) || 60) * 0.01 * (g / 100);
  const d = Number(deltaS) || 0.002;      // small delta (gradient duration), s
  const D = Number(bigDeltaS) || 0.05;    // diffusion time Δ, s
  const b = Math.pow(GAMMA_H * d * G_Tm, 2) * (D - d / 3);
  return b > 0 ? b : 0;
};

// Linear regression of ln(I) vs b → D = −slope (m²/s).
const fitStejskalTanner = (bvals, ys) => {
  const pts = bvals
    .map((x, i) => ({ x: Number(x), y: Math.log(Math.max(Number(ys[i]), 1e-12)) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && isFinite(p.x) && isFinite(p.y));
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const D = -slope;
  const mean = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p.y - mean) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  return { D, I0: Math.exp(intercept), r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n };
};

/* ---- STABLE SECTION WRAPPERS (module-level, like NMR Fittings) ---- */
const dosySections = {
  renderData: null,       // (t, tIndex) => ReactNode
  renderAnalysis: null,   // (t, tIndex) => ReactNode
  addTable: null,         // () => void
  sim: {},
  setSim: null,
  solvents: [],
  params: { maxG: 60, deltaMs: 2, bigDeltaMs: 50 }, // read-only values shown in Data Analysis
};


// Experiment Setup — plain content (TestShellRenderer wraps it once).
const DOSYSetupSection = ({ ctx }) => {
  const activeTest = ctx.activeTest || {};
  const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">DOSY Dataset Name</label>
        <input type="text" value={activeTest.dosyDatasetName || ''} onChange={(e) => update({ dosyDatasetName: e.target.value })} placeholder="e.g. PEG400_DOSY" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Number</label>
        <input type="text" value={activeTest.dosyExpNumber || ''} onChange={(e) => update({ dosyExpNumber: e.target.value })} placeholder="e.g. 12" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
      </div>
      <div>
        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Link (URL)</label>
        <input type="text" value={activeTest.dosyLink || ''} onChange={(e) => update({ dosyLink: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
      </div>
    </div>
  );
};

const DOSYDataSection = ({ ctx }) => {
  const tables = Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : [];
  return (
    <div className="flex flex-col gap-6">
      {tables.map((t, i) => (dosySections.renderData ? dosySections.renderData(t, i) : null))}
      {dosySections.addTable && (
        <button onClick={dosySections.addTable} className="self-start text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">+ Add gradient set</button>
      )}
    </div>
  );
};


// Data Analysis — Stejskal-Tanner decay plot built directly from the DATA TABLE
// (gradient % vs intensity) and the read-only gradient parameters taken from
// Instrumental Setup (max G, Δ, δ). Nothing here is editable: the source of
// truth is the Data tab + Instrumental Setup, so the graph always stays in sync
// with the values the scientist entered there.
const DOSYFitChart = ({ tables, params }) => {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const { maxG, deltaMs, bigDeltaMs } = params || {};

  // Does any table column have at least one valid (b, intensity) pair?
  const anyPoint = (Array.isArray(tables) ? tables : []).some((t) => {
    for (let c = 0; c < (t.nCols || 0); c++) {
      for (let r = 0; r < t.nRows; r++) {
        const b = computeB(t.delays[r], maxG, deltaMs / 1000, bigDeltaMs / 1000);
        const y = parseFloat(t.grid?.[r]?.[c]);
        if (b > 0 && Number.isFinite(y) && y > 0) return true;
      }
    }
    return false;
  });

  useEffect(() => {
    if (!ref.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const datasets = [];
    (Array.isArray(tables) ? tables : []).forEach((t) => {
      const nCols = t.nCols || 0;
      for (let c = 0; c < nCols; c++) {
        const label = (t.colResidues && t.colResidues[c]) || `Col ${c + 1}`;
        const bvals = [], ys = [];
        for (let r = 0; r < t.nRows; r++) {
          const b = computeB(t.delays[r], maxG, deltaMs / 1000, bigDeltaMs / 1000);
          const y = parseFloat(t.grid?.[r]?.[c]);
          if (b > 0 && Number.isFinite(y) && y > 0) { bvals.push(b); ys.push(y); }
        }
        if (bvals.length < 2) continue;
        const color = `hsl(${(c * 57) % 360}, 80%, 50%)`;
        const pts = bvals.map((x, i) => ({ x, y: Math.log(Math.max(ys[i], 1e-12)) }));
        datasets.push({ label, data: pts, showLine: false, pointRadius: 3, backgroundColor: color, borderColor: color });
        const fit = fitStejskalTanner(bvals, ys);
        if (fit) {
          const xmin = Math.min(...bvals), xmax = Math.max(...bvals);
          const curve = [];
          for (let i = 0; i <= 60; i++) {
            const x = xmin + ((xmax - xmin) * i) / 60;
            curve.push({ x, y: Math.log(fit.I0) - fit.D * x });
          }
          datasets.push({ label: `${label} fit (D=${fit.D.toExponential(2)} m²/s)`, data: curve, showLine: true, pointRadius: 0, borderColor: color, borderWidth: 2, type: 'line' });
        }
      }
    });

    chartRef.current = new Chart(ref.current, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: `b (s/mm²) — from gradient % · Gmax = ${maxG} G/cm · Δ = ${bigDeltaMs} ms · δ = ${deltaMs} ms`, font: { size: 11 } }, ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: 'ln(I)', font: { size: 11 } }, ticks: { font: { size: 10 } } }
        },
        plugins: { legend: { display: datasets.length > 0, labels: { font: { size: 10 } } } }
      }
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [tables, maxG, deltaMs, bigDeltaMs]);

  return (
    <div className="w-full">
      <div style={{ height: '420px' }}><canvas ref={ref} /></div>
      {!anyPoint && (
        <p className="text-[10px] text-slate-400 italic mt-1">
          No gradient data yet — enter gradient % and intensities in the Data tab (the chart reads directly from it).
        </p>
      )}
    </div>
  );
};


// Data Analysis — direct content (analysisPlain), no nested "Per Atom Plot".
const DOSYFittingSection = ({ ctx }) => {
  const tables = Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : [];
  const { maxG, deltaMs, bigDeltaMs } = dosySections.params;
  return (
    <div className="flex flex-col gap-6">
      {/* Read-only gradient parameters, taken from Instrumental Setup */}
      <div className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">Max gradient G</div>
          <div className="text-base font-bold text-slate-800 font-mono">{maxG} G/cm</div>
        </div>
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">Diffusion time Δ</div>
          <div className="text-base font-bold text-slate-800 font-mono">{bigDeltaMs} ms</div>
        </div>
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">Small delta δ (gradient duration)</div>
          <div className="text-base font-bold text-slate-800 font-mono">{deltaMs} ms</div>
        </div>
      </div>
      {tables.map((t, i) => (dosySections.renderAnalysis ? dosySections.renderAnalysis(t, i) : null))}
      <div className="w-full border border-slate-300 rounded-xl bg-slate-50 p-4 flex flex-col gap-2">
        <h4 className="text-sm font-bold text-slate-700">📈 Stejskal-Tanner plot — read directly from the data table</h4>
        <p className="text-[10px] text-slate-400">ln(I) vs b computed from the gradient % columns of the Data tab and the gradient parameters of Instrumental Setup (shown read-only above). No data is entered here.</p>
        <DOSYFitChart tables={tables} params={{ maxG, deltaMs, bigDeltaMs }} />
      </div>
    </div>
  );
};

// Instrumental Setup — shared NMR setup without Operator, plus the DOSY
// gradient parameters (max gradient G, diffusion time Δ, small delta δ).
const DOSYInstrumentalSetup = ({ ctx }) => {
  const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
  const activeTest = ctx.activeTest || {};
  return (
    <NMRInstrumentalSetup
      ctx={ctx}
      hideOperator
      extraFields={(
        <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 flex flex-col gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-700">DOSY Gradient Parameters</h4>
            <p className="text-[10px] text-slate-400">Used by the Stejskal-Tanner fit in Data Analysis (gradient % of the maximum).</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Max gradient G (G/cm)</label>
              <input type="number" step="1" min="0" value={activeTest.dosyMaxG || 60}
                onChange={(e) => update({ dosyMaxG: e.target.value === '' ? '' : Number(e.target.value) })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Diffusion time Δ (ms)</label>
              <input type="number" step="1" min="0" value={activeTest.dosyDelta || 50}
                onChange={(e) => update({ dosyDelta: e.target.value === '' ? '' : Number(e.target.value) })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Small delta δ — gradient duration (ms)</label>
              <input type="number" step="0.1" min="0" value={activeTest.dosySmallDelta || 2}
                onChange={(e) => update({ dosySmallDelta: e.target.value === '' ? '' : Number(e.target.value) })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
            </div>
          </div>
        </div>
      )}
    />
  );
};


// Simulations — plain content (TestShellRenderer wraps it once as "Simulations").
const DOSYSimulationsSection = ({ ctx }) => {
  const sim = dosySections.sim;
  const setSim = dosySections.setSim;
  const activeTest = ctx.activeTest || {};
  const solventName = dosySections.solvents?.[0] || activeTest.solvent || '';
  const SOLVENT_VISCOSITY = {
    'H2O': 0.89e-3, 'D2O': 1.107e-3, 'DMSO': 1.996e-3, 'DMSO-d6': 1.996e-3,
    'methanol': 0.544e-3, 'ethanol': 1.074e-3, 'chloroform': 0.538e-3,
    'acetone': 0.306e-3, 'benzene': 0.604e-3, 'toluene': 0.560e-3,
  };
  const temperature = parseFloat(activeTest.temperature) || 298;
  const T_K = temperature > 100 ? temperature : temperature + 273.15;
  const viscosity = sim.viscosity || SOLVENT_VISCOSITY[solventName] || 0.89e-3;
  const MW = sim.MW || 12000;
  const shape = sim.shape || 'sphere';
  const shapeFactor = shape === 'sphere' ? 1 : shape === 'rod' ? 1.3 : 1.15;
  const r_m = radiusFromMW(MW, sim.vbar || 0.73, sim.hydration || 0.3) * shapeFactor;
  const D_calc = stokesEinsteinD(T_K, viscosity, r_m);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Molecular Weight (Da)</label>
          <input type="number" step="100" value={MW} onChange={(e) => setSim({ MW: parseFloat(e.target.value) || 12000 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Shape</label>
          <select value={shape} onChange={(e) => setSim({ shape: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="sphere">Sphere</option><option value="rod">Rod</option><option value="disc">Disc</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Partial specific volume (cm³/g)</label>
          <input type="number" step="0.01" value={sim.vbar || 0.73} onChange={(e) => setSim({ vbar: parseFloat(e.target.value) || 0.73 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Hydration (g/g)</label>
          <input type="number" step="0.05" value={sim.hydration || 0.3} onChange={(e) => setSim({ hydration: parseFloat(e.target.value) || 0.3 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Solvent (viscosity preset)</label>
          <select value={solventName} onChange={(e) => setSim({ viscosity: SOLVENT_VISCOSITY[e.target.value] || sim.viscosity })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
            {Object.keys(SOLVENT_VISCOSITY).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temperature (°C)</label>
          <input type="number" value={temperature} onChange={(e) => ctx.updateActiveTest && ctx.updateActiveTest({ temperature: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Viscosity η (Pa·s)</label>
          <input type="number" step="0.01e-3" value={viscosity} onChange={(e) => setSim({ viscosity: parseFloat(e.target.value) || 0.89e-3 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
        </div>
      </div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
        <h4 className="text-xs font-black text-emerald-800 uppercase mb-3">💧 Diffusion Coefficient (Stokes–Einstein)</h4>
        <div className="text-sm">
          <div><span className="font-bold text-slate-600">D:</span> <span className="font-mono text-emerald-700 text-lg">{D_calc.toExponential(3)} m²/s</span></div>
          <div className="mt-1"><span className="font-bold text-slate-600">Effective radius:</span> <span className="font-mono">{r_m.toExponential(2)} m</span></div>
          <div><span className="font-bold text-slate-600">Temp:</span> <span className="font-mono">{T_K.toFixed(1)} K</span></div>
        </div>
        <p className="text-[10px] text-slate-500 mt-3 italic">D = k<sub>B</sub>T / (6·π·η·r)</p>
      </div>
    </div>
  );
};


/* ========================================================================== */
export const DOSYTestRenderer = ({ activeTest = {}, updateActiveTest, TestHeader, compoundMeta = {}, allCmpds = [], ...rest }) => {
    const update = (u) => { if (updateActiveTest) updateActiveTest(u); };

    // LOCAL STATE for the data tables — every edit runs against the latest
    // array, so editing one cell can never drop the other values.
    const makeDefaultTable = () => makeTable({
        relaxType: 'DOSY', delayUnit: '%',
        nRows: 8, nCols: 4,
        delays: [0, 5, 10, 20, 40, 60, 80, 100],
        grid: Array.from({ length: 8 }, () => Array(4).fill('')),
    });
    const [tablesState, setTablesState] = useState(() => (
        Array.isArray(activeTest.dosyTables) && activeTest.dosyTables.length
            ? activeTest.dosyTables
            : [makeDefaultTable()]
    ));
    const lastSyncRef = useRef(tablesState);
    // Sync local state when activeTest changes from elsewhere (reload / undo).
    useEffect(() => {
        const t = activeTest.dosyTables;
        if (Array.isArray(t) && t.length && t !== lastSyncRef.current) {
            lastSyncRef.current = t;
            setTablesState(t);
        }
    }, [activeTest.dosyTables]);
    const commit = (next) => { lastSyncRef.current = next; setTablesState(next); update({ dosyTables: next }); };

    const [fits, setFits] = useState(activeTest.dosyFits || {});
    const tables = tablesState;

    const gradientParams = {
        maxG: Number(activeTest.dosyMaxG) || 60,
        deltaMs: Number(activeTest.dosySmallDelta) || 2,
        bigDeltaMs: Number(activeTest.dosyDelta) || 50,
    };
    dosySections.params = gradientParams;

    const sim = { MW: 12000, shape: 'sphere', vbar: 0.73, hydration: 0.3, viscosity: 0.89e-3, ...(activeTest.dosySim || {}) };
    const setSim = (patch) => update({ dosySim: { ...sim, ...patch } });

    const updateTable = (id, patch) => commit(tables.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const setCell = (t, r, c, v) => {
        const g = (t.grid || []).map((row) => (row || []).slice());
        while (g.length < t.nRows) g.push(new Array(t.nCols).fill(''));
        if (!g[r]) g[r] = [];
        while (g[r].length < t.nCols) g[r].push('');
        g[r][c] = v;
        updateTable(t.id, { grid: g });
    };
    const setDelay = (t, r, v) => { const d = (t.delays || []).slice(); d[r] = v; updateTable(t.id, { delays: d }); };
    const setColResidue = (t, c, v) => { const cr = (t.colResidues || []).slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };
    const addRow = (t) => { const last = t.delays.length ? Number(t.delays[t.delays.length - 1]) || 0 : 0; updateTable(t.id, { nRows: t.nRows + 1, delays: [...(t.delays || []), last], grid: [...(t.grid || []).map((r) => r.slice()), new Array(t.nCols).fill('')] }); };
    const removeRow = (t, r) => { if (t.nRows <= 1) return; updateTable(t.id, { nRows: t.nRows - 1, delays: (t.delays || []).filter((_, i) => i !== r), grid: (t.grid || []).filter((_, i) => i !== r) }); };
    const addCol = (t) => { updateTable(t.id, { nCols: t.nCols + 1, colResidues: [...(t.colResidues || []), ''], grid: (t.grid || []).map((r) => [...(r || []), '']) }); };
    const removeCol = (t, c) => { if (t.nCols <= 1) return; updateTable(t.id, { nCols: t.nCols - 1, colResidues: (t.colResidues || []).filter((_, i) => i !== c), grid: (t.grid || []).map((r) => (r || []).filter((_, i) => i !== c)) }); };
    const addTable = () => commit([...tables, makeDefaultTable()]);
    const removeTable = (id) => { if (tables.length <= 1) { alert('Keep at least one gradient set.'); return; } commit(tables.filter((t) => t.id !== id)); };

    const runFitForTable = (t) => {
        const cols = [];
        for (let c = 0; c < t.nCols; c++) {
            const bvals = [], ys = [];
            for (let r = 0; r < t.nRows; r++) {
                const b = computeB(t.delays[r], gradientParams.maxG, gradientParams.deltaMs / 1000, gradientParams.bigDeltaMs / 1000);
                const y = parseFloat(t.grid[r]?.[c]);
                if (b > 0 && isFinite(y) && y > 0) { bvals.push(b); ys.push(y); }
            }
            cols.push({ residue: t.colResidues[c] || `Col ${c + 1}`, fit: fitStejskalTanner(bvals, ys) });
        }
        const next = { ...(fits || {}), [t.id]: cols };
        setFits(next);
        update({ dosyFits: next });
    };


    const renderTableData = (t, tIndex) => (
        <CollapsibleSection key={t.id} title={`Gradient set ${tIndex + 1} — ${t.colResidues.filter(Boolean).join(', ') || 'DOSY data'}`} icon="📈" defaultOpen={false}>
            <div className="flex flex-col gap-4">
                <div className="overflow-auto border border-slate-300 rounded-lg bg-white shadow-inner">
                    <table className="border-collapse text-xs w-full">
                        <thead>
                            <tr>
                                <th className="bg-slate-200 border border-slate-300 p-1 sticky top-0 left-0 z-20 text-slate-600">Gradient % (0–100)</th>
                                {Array.from({ length: t.nCols }, (_, c) => (
                                    <th key={c} className="bg-slate-100 border border-slate-300 p-1 min-w-[110px] sticky top-0 z-10 group relative">
                                        <div className="flex flex-col gap-1 w-full relative">
                                            <input value={t.colResidues[c] || ''} onChange={(e) => setColResidue(t, c, e.target.value)} placeholder="intensity" className="w-full text-center border border-slate-300 rounded p-1 text-[11px] font-bold text-blue-800" />
                                            <button onClick={() => removeCol(t, c)} className="absolute -top-1 -right-1 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-full w-5 h-5 flex items-center justify-center font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" title="Delete Column">✕</button>
                                        </div>
                                    </th>
                                ))}
                                <th className="bg-slate-50 border border-slate-200 p-1 sticky top-0 z-10"><button onClick={() => addCol(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] bg-blue-50 px-2 py-1 rounded w-full h-full transition-colors">+ Add Col</button></th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: t.nRows }, (_, r) => (
                                <tr key={r}>
                                    <td className="bg-slate-100 border border-slate-300 p-0.5 sticky left-0 z-10">
                                        <div className="flex items-center justify-between px-1">
                                            <input type="number" step="1" min="0" max="100" value={t.delays[r]} {...cellAttrs(r, -1)} onChange={(e) => setDelay(t, r, e.target.value === '' ? '' : Number(e.target.value))} className="w-16 text-center border border-slate-300 rounded p-1 text-[11px] font-mono" />
                                            <button onClick={() => removeRow(t, r)} className="text-red-400 hover:text-red-600 text-[11px] font-bold ml-1 px-1" title="Delete Row">✕</button>
                                        </div>
                                    </td>
                                    {Array.from({ length: t.nCols }, (_, c) => (
                                        <td key={c} className="border border-slate-200 p-0"><input value={t.grid[r]?.[c] ?? ''} {...cellAttrs(r, c)} onChange={(e) => setCell(t, r, c, e.target.value)} className="w-full h-8 text-center outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 font-mono text-[11px]" /></td>
                                    ))}
                                    <td className="border border-slate-100 p-0.5 text-center text-slate-300 bg-slate-50">·</td>
                                </tr>
                            ))}
                            <tr><td colSpan={t.nCols + 2} className="bg-slate-50 border border-slate-200 p-2"><button onClick={() => addRow(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] w-full text-left pl-2">+ Add Gradient Row</button></td></tr>
                        </tbody>
                    </table>
                </div>
                <p className="text-[10px] text-slate-400 italic -mt-2">🖱️ Drag or Shift+click to select multiple cells · Ctrl/Cmd+C copy · Ctrl/Cmd+V paste (Excel-compatible, tab-separated) · gradient values are % of the maximum G from Instrumental Setup</p>
                <div className="flex justify-between items-center border-t border-slate-100 pt-2">
                    <button onClick={() => runFitForTable(t)} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm transition-colors">▶️ Fit Stejskal-Tanner (D)</button>
                    <button onClick={() => removeTable(t.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-md shadow-sm flex items-center gap-2 transition-colors">🗑️ Delete</button>
                </div>
            </div>
        </CollapsibleSection>
    );


    const renderTableAnalysis = (t, tIndex) => {
        const colFits = (fits[t.id] || []).map((cf) => ({ ...cf }));
        return (
            <CollapsibleSection key={t.id} title={`Gradient set ${tIndex + 1} — Stejskal-Tanner results`} icon="📐" defaultOpen={false}>
                <div className="flex flex-col gap-4">
                    <div className="overflow-auto border border-slate-200 rounded-lg">
                        <table className="border-collapse text-xs w-full">
                            <thead>
                                <tr className="bg-slate-50">
                                    <th className="px-3 py-1.5 border border-slate-200 text-left">Column</th>
                                    <th className="px-3 py-1.5 border border-slate-200">Diffusion D (m²/s)</th>
                                    <th className="px-3 py-1.5 border border-slate-200">I₀</th>
                                    <th className="px-3 py-1.5 border border-slate-200">R²</th>
                                    <th className="px-3 py-1.5 border border-slate-200">n points</th>
                                </tr>
                            </thead>
                            <tbody>
                                {colFits.map((cf, i) => (
                                    <tr key={i}>
                                        <td className="p-1.5 border border-slate-200 font-bold text-blue-800">{cf.residue}</td>
                                        <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.D.toExponential(3) : '—'}</td>
                                        <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.I0.toExponential(2) : '—'}</td>
                                        <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.r2.toFixed(3) : '—'}</td>
                                        <td className="p-1.5 border border-slate-200">{cf.fit ? cf.fit.n : 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={() => runFitForTable(t)} className="self-start text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">▶️ Recompute fit</button>
                </div>
            </CollapsibleSection>
        );
    };

    // Bridge render closures into the stable module-level section components.
    dosySections.renderData = (t, i) => renderTableData(t, i);
    dosySections.renderAnalysis = (t, i) => renderTableAnalysis(t, i);
    dosySections.addTable = addTable;
    dosySections.sim = sim;
    dosySections.setSim = setSim;
    dosySections.solvents = rest.solvents || [];

    return (
        <TestShellRenderer
            config={DOSY_TAB_CONFIG}
            custom={{
                Setup: DOSYSetupSection,
                Data: DOSYDataSection,
                Analysis: DOSYFittingSection,
                InstrumentalSetup: DOSYInstrumentalSetup,
                Simulations: DOSYSimulationsSection,
                analysisPlain: true, // fitting is rendered directly inside Data Analysis (no "Per Atom Plot")
            }}
            activeTest={activeTest}
            updateActiveTest={updateActiveTest}
            TestHeader={TestHeader}
            compoundMeta={compoundMeta}
            allCmpds={allCmpds}
            {...rest}
        />
    );
};

export default DOSYTestRenderer;
