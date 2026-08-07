import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceArea, Legend, ErrorBar
} from 'recharts';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

/* ============================================================================
   CDSections — CD Spectroscopy Analysis
   ========================================================================== */
const LINE_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

/* ============================= HELPERS ============================= */
const parseManual = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

const parseNums = (str) => {
  if (!str || typeof str !== 'string') return [];
  return str.split(/[\s,;\t\n]+/).map((s) => parseFloat(s.trim())).filter((n) => isFinite(n));
};

const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}>
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

/* ============================= GAUSS SOLVE ============================= */
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

/* ============================= PURE COMPONENT SPECTRA ============================= */
const ALPHA_HELIX_REF = [
  { w: 190, v: -5.0 }, { w: 192, v: -10.0 }, { w: 194, v: -15.0 }, { w: 196, v: -5.0 },
  { w: 198, v: 10.0 }, { w: 200, v: 20.0 }, { w: 202, v: 20.0 }, { w: 204, v: 15.0 },
  { w: 206, v: 8.0 },  { w: 208, v: -15.0 }, { w: 210, v: -28.0 }, { w: 212, v: -32.0 },
  { w: 214, v: -31.0 }, { w: 216, v: -28.0 }, { w: 218, v: -25.0 }, { w: 220, v: -26.0 },
  { w: 222, v: -30.0 }, { w: 224, v: -32.0 }, { w: 226, v: -30.0 }, { w: 228, v: -25.0 },
  { w: 230, v: -18.0 }, { w: 232, v: -12.0 }, { w: 234, v: -7.0 }, { w: 236, v: -4.0 },
  { w: 238, v: -2.0 },  { w: 240, v: -1.0 },  { w: 250, v: 0.0 },  { w: 260, v: 0.0 }
];
const BETA_SHEET_REF = [
  { w: 190, v: 30.0 }, { w: 192, v: 35.0 }, { w: 194, v: 25.0 }, { w: 196, v: 10.0 },
  { w: 198, v: 2.0 },  { w: 200, v: -3.0 }, { w: 202, v: -5.0 }, { w: 204, v: -6.0 },
  { w: 206, v: -7.0 }, { w: 208, v: -7.5 }, { w: 210, v: -6.0 }, { w: 212, v: -4.0 },
  { w: 214, v: -2.0 }, { w: 216, v: 5.0 },  { w: 218, v: 10.0 }, { w: 220, v: 12.0 },
  { w: 222, v: 9.0 },  { w: 224, v: 5.0 },  { w: 226, v: 2.0 },  { w: 228, v: 0.5 },
  { w: 230, v: 0.0 },  { w: 250, v: 0.0 },  { w: 260, v: 0.0 }
];
const TURN_REF = [
  { w: 190, v: 5.0 },  { w: 192, v: 3.0 },  { w: 194, v: -5.0 }, { w: 196, v: -8.0 },
  { w: 198, v: -6.0 }, { w: 200, v: 2.0 },  { w: 202, v: 8.0 },  { w: 204, v: 10.0 },
  { w: 206, v: 8.0 },  { w: 208, v: 4.0 },  { w: 210, v: 0.0 },  { w: 212, v: -2.0 },
  { w: 214, v: -3.0 }, { w: 216, v: -3.0 }, { w: 218, v: -2.0 }, { w: 220, v: -1.0 },
  { w: 222, v: 0.0 },  { w: 250, v: 0.0 },  { w: 260, v: 0.0 }
];
const COIL_REF = [
  { w: 190, v: -18.0 }, { w: 192, v: -25.0 }, { w: 194, v: -20.0 }, { w: 196, v: -10.0 },
  { w: 198, v: -3.0 },  { w: 200, v: 2.0 },   { w: 202, v: 3.0 },   { w: 204, v: 2.0 },
  { w: 206, v: 1.0 },   { w: 208, v: 0.0 },   { w: 220, v: 0.0 },   { w: 260, v: 0.0 }
];

const interpRef = (refPts, w) => {
  for (let i = 0; i < refPts.length - 1; i++) {
    if (w >= refPts[i].w && w <= refPts[i + 1].w) {
      const t = (w - refPts[i].w) / (refPts[i + 1].w - refPts[i].w);
      return refPts[i].v + t * (refPts[i + 1].v - refPts[i].v);
    }
  }
  return 0;
};

const fitCdSpectrum = (wavelengths, values) => {
  const pts = [];
  for (let i = 0; i < wavelengths.length; i++) {
    const w = wavelengths[i], v = values[i];
    if (w >= 190 && w <= 250 && Number.isFinite(v)) pts.push({ w, v });
  }
  if (pts.length < 10) return null;
  const refs = [ALPHA_HELIX_REF, BETA_SHEET_REF, TURN_REF, COIL_REF];
  const A = pts.map(({ w }) => refs.map((r) => interpRef(r, w)));
  const bv = pts.map(({ v }) => v);
  const AtA = [0,1,2,3].map((i) => [0,1,2,3].map((j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
  const Atb = [0,1,2,3].map((i) => A.reduce((s, row, idx) => s + row[i] * bv[idx], 0));
  const raw = gaussSolve(AtA, Atb);
  if (!raw) return null;
  const clamped = raw.map((c) => Math.max(0, c));
  const total = clamped.reduce((a, v) => a + v, 0);
  if (total <= 0) return null;
  const fracs = clamped.map((c) => c / total);
  const norm = fracs.map((f) => Math.round(f * 1000) / 10);
  const diff = +(100 - norm.reduce((a, v) => a + v, 0)).toFixed(1);
  if (diff !== 0) { const mi = norm.indexOf(Math.max(...norm)); norm[mi] = +(norm[mi] + diff).toFixed(1); }
  let num = 0, den = 0;
  pts.forEach(({ w, v }) => {
    const t = fracs.reduce((s, f, i) => s + f * interpRef(refs[i], w), 0);
    num += v * t; den += t * t;
  });
  const scale = den > 0 ? num / den : 1;
  const fitCurve = pts.map(({ w }) => ({ x: w, y: scale * fracs.reduce((s, f, i) => s + f * interpRef(refs[i], w), 0) }));
  let ssRes = 0, ssTot = 0;
  const meanY = bv.reduce((a, v) => a + v, 0) / pts.length;
  pts.forEach(({ v }, i) => { ssRes += (v - fitCurve[i].y) ** 2; ssTot += (v - meanY) ** 2; });
  return { alpha: norm[0], beta: norm[1], turn: norm[2], coil: norm[3], fitCurve, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, nPoints: pts.length };
};

/* ============================= CONDITION FIELDS ============================= */
const CD_COND_FIELDS = [
  { key: 'concentration', label: 'Concentration' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'ph', label: 'pH' },
  { key: 'saltConcentration', label: 'Salt Concentration' },
  { key: 'otherMolecule', label: 'Other Molecule' },
  { key: 'ratio', label: 'Molar Ratio' },
  { key: 'pathLength', label: 'Path Length' },
  { key: 'solvent', label: 'Solvent' },
  { key: 'buffer', label: 'Buffer' },
];

const getInstCond = (inst, key) => { const v = inst?.[key]; return (v === undefined || v === null || v === '') ? null : v; };

const parseInstSpectra = (inst) => {
  const wavelengths = parseNums(inst?.wavelengthData || '');
  const cols = Array.isArray(inst?.spectraColumns) ? inst.spectraColumns : [];
  const spectra = cols.map((col) => ({ ...col, values: parseNums(col.data || '') }));
  return { wavelengths, spectra };
};

/* ============================= ZOOM HOOK ============================= */
const useXZoom = (chartRef, dataDomain) => {
  const [domain, setDomain] = useState(null);
  const [lo, setLo] = useState(null);
  const [hi, setHi] = useState(null);
  const dragging = useRef(false);
  const loRef = useRef(null);
  const safe = Array.isArray(dataDomain) && dataDomain[1] > dataDomain[0] ? dataDomain : [0, 1];
  const eff = domain || safe;
  const effRef = useRef(eff);
  effRef.current = eff;
  const getX = (clientX) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const margin = { left: 20, right: 30 };
    const plotW = rect.width - margin.left - margin.right;
    if (plotW <= 0) return null;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - margin.left) / plotW));
    const d0 = effRef.current;
    return d0[0] + fx * (d0[1] - d0[0]);
  };
  useEffect(() => {
    const mv = (e) => { if (dragging.current) setHi(getX(e.clientX)); };
    const up = (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      const end = getX(e.clientX); const start = loRef.current;
      if (start !== null && end !== null && Math.abs(end - start) > (effRef.current[1] - effRef.current[0]) * 0.01) {
        setDomain([Math.min(start, end), Math.max(start, end)]);
      }
      loRef.current = null; setLo(null); setHi(null);
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);
  const onMouseDown = (e) => { const v = getX(e.clientX); if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); } };
  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

/* ============================= DEFAULT CHART CFG ============================= */
const DEFAULT_CHART_CFG = {
  height: 380, aspect: 1.8, fontSize: 12, ptSize: 4, lineStyle: 'solid', lineThickness: 2,
  legend: 'top', colors: {}, xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: ''
};
const lineDash = (s) => (s === 'dashed' ? '7 5' : s === 'dotted' ? '2 3' : undefined);
const domV = (v) => (v === '' || v == null ? undefined : parseManual(v));

/* ============================= CHART STYLE PANEL ============================= */
const ChartStylePanel = ({ cfg, setCfg, series = [] }) => (
  <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
    {[
      ['Font size', 'fontSize', 'number', 1], ['Height (px)', 'height', 'number', 10],
      ['Point size', 'ptSize', 'number', 1], ['Line thickness', 'lineThickness', 'number', 0.5]
    ].map(([label, key, type, step]) => (
      <div key={key} className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-slate-600">{label}</label>
        <input type={type} step={step} value={cfg[key] ?? ''} onChange={(e) => setCfg({ [key]: e.target.value === '' ? cfg[key] : Number(e.target.value) })}
          className="border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500" />
      </div>
    ))}
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">Line style</label>
      <select value={cfg.lineStyle} onChange={(e) => setCfg({ lineStyle: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
        <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
      </select>
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">Legend</label>
      <select value={cfg.legend} onChange={(e) => setCfg({ legend: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
        <option value="top">Top</option><option value="bottom">Bottom</option><option value="none">None</option>
      </select>
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.xMin || ''} onChange={(e) => setCfg({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.xMax || ''} onChange={(e) => setCfg({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div>
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.yMin || ''} onChange={(e) => setCfg({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.yMax || ''} onChange={(e) => setCfg({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div>
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">X label</label>
      <input type="text" value={cfg.xAxisLabel || ''} onChange={(e) => setCfg({ xAxisLabel: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-slate-600">Y label</label>
      <input type="text" value={cfg.yAxisLabel || ''} onChange={(e) => setCfg({ yAxisLabel: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none" />
    </div>
    {series.length > 0 && (
      <div className="col-span-2 lg:col-span-4 pt-2 border-t border-slate-100 flex flex-wrap gap-3">
        {series.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <input type="color" value={(cfg.colors && cfg.colors[s.key]) || s.color || '#3b82f6'}
              onChange={(e) => setCfg({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
              className="w-5 h-5 rounded cursor-pointer border border-slate-300" />
            {s.label}
          </label>
        ))}
      </div>
    )}
    <p className="col-span-2 lg:col-span-4 text-[9px] text-slate-400">Drag over any graph to zoom · Reset Zoom to restore</p>
  </div>
);

/* ============================= INSTANCE CONSISTENCY ============================= */
const useConsistency = (instances, xField) => useMemo(() => {
  if (!instances || instances.length < 2) return { varyingFields: [], mismatchedIds: new Set(), hasMismatch: false };
  const varyingFields = CD_COND_FIELDS.filter((f) => new Set(instances.map((i) => String(getInstCond(i, f.key) ?? ''))).size > 1);
  const fixedNonX = CD_COND_FIELDS.filter((f) => f.key !== xField && !varyingFields.find((v) => v.key === f.key));
  if (varyingFields.length <= 1) return { varyingFields, mismatchedIds: new Set(), hasMismatch: false };
  const sigs = instances.map((i) => ({ id: i.id, sig: fixedNonX.map((f) => String(getInstCond(i, f.key) ?? '')).join('|') }));
  const counts = {}; sigs.forEach(({ sig }) => { counts[sig] = (counts[sig] || 0) + 1; });
  const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const mismatchedIds = new Set(sigs.filter((s) => s.sig !== dom).map((s) => s.id));
  return { varyingFields, mismatchedIds, hasMismatch: mismatchedIds.size > 0 };
}, [instances, xField]);

/* ============================= MINI SPECTRA CHART ============================= */
const MiniSpecChart = ({ wavelengths, values, cfg, color, isFs, onToggleFs, title, fitCurve }) => {
  const chartRef = useRef(null);
  const allX = wavelengths.length ? wavelengths : [190, 260];
  const zoom = useXZoom(chartRef, [Math.min(...allX), Math.max(...allX)]);
  const data = wavelengths.map((w, i) => ({ x: w, y: values[i] ?? null }));
  const fs = Math.max(9, (cfg.fontSize || 12) - 2);
  return (
    <div className={`flex flex-col bg-white ${isFs ? FS_CLASSES + ' p-6' : 'relative border border-slate-200 rounded-lg p-2 shadow-sm'}`}>
      {isFs && <div className={OVERLAY_CLASSES} onClick={onToggleFs} />}
      <div className="flex items-center justify-between mb-1 gap-1 z-10">
        <span className="text-[10px] font-bold truncate" style={{ color }}>{title}</span>
        <div className="flex gap-1">
          {zoom.isZoomed && <button type="button" onClick={zoom.reset} className="text-[9px] bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 rounded font-bold">Reset</button>}
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggleFs(); }} className="text-slate-400 hover:text-blue-600 bg-slate-50 rounded p-1 text-[10px] shrink-0 no-print">{isFs ? 'X' : 'Z'}</button>
        </div>
      </div>
      <div ref={chartRef} onMouseDown={zoom.onMouseDown} className="select-none flex-1 relative min-h-0 w-full" style={!isFs ? { aspectRatio: '1', minHeight: '130px' } : {}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 5, right: 8, bottom: 24, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={[domV(cfg.xMin) ?? zoom.domain[0], domV(cfg.xMax) ?? zoom.domain[1]]} tick={{ fontSize: fs, fill: '#64748b' }} tickMargin={4} label={{ value: 'nm', position: 'insideBottom', offset: -14, fill: '#64748b', fontSize: fs }} />
            <YAxis type="number" domain={[domV(cfg.yMin) ?? 'auto', domV(cfg.yMax) ?? 'auto']} tick={{ fontSize: fs, fill: '#64748b' }} width={38} />
            <Tooltip formatter={(v) => v != null ? v.toFixed(3) : 'N/A'} />
            <Line data={data} type="monotone" dataKey="y" stroke={color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={cfg.ptSize > 0 ? { r: Math.max(1, cfg.ptSize - 2), fill: color, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            {fitCurve && fitCurve.length > 0 && (
              <Line data={fitCurve} type="monotone" dataKey="y" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 4" dot={false} legendType="none" isAnimationActive={false} />
            )}
            {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/* ============================= CD OVERLAY CHART (Chart.js) ============================= */
const CDOverlayChart = ({ instances, chartCfg, isFs, onToggleFs, xField }) => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const chartInst = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
    const datasets = [];
    let ci = 0;
    instances.forEach((inst) => {
      const { wavelengths, spectra } = parseInstSpectra(inst);
      if (!wavelengths.length) return;
      const xLabel = xField && getInstCond(inst, xField) != null ? `${inst.name || inst.id} (${getInstCond(inst, xField)})` : (inst.name || inst.instanceName || inst.id);
      spectra.forEach((spec) => {
        if (spec.visible === false || !spec.values || !spec.values.length) return;
        const color = spec.color || LINE_COLORS[ci % LINE_COLORS.length]; ci++;
        const bd = chartCfg.lineStyle === 'dashed' ? [5, 5] : chartCfg.lineStyle === 'dotted' ? [2, 3] : [];
        datasets.push({
          label: `${spec.title} [${xLabel}]`,
          data: wavelengths.map((w, i) => ({ x: w, y: spec.values[i] ?? null })).filter((p) => p.y !== null),
          borderColor: color, backgroundColor: color + '22',
          borderWidth: chartCfg.lineThickness || 2, borderDash: bd,
          pointRadius: chartCfg.ptSize || 0, fill: false, tension: 0.1, type: 'line'
        });
      });
    });
    if (!datasets.length) return;
    chartInst.current = new Chart(canvasRef.current, {
      type: 'line', data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', min: chartCfg.xMin !== '' ? +chartCfg.xMin : undefined, max: chartCfg.xMax !== '' ? +chartCfg.xMax : undefined, title: { display: true, text: chartCfg.xAxisLabel || 'Wavelength (nm)', font: { size: +(chartCfg.fontSize || 12) + 2, weight: 'bold' }, color: '#334155' }, ticks: { font: { size: +(chartCfg.fontSize || 12) }, color: '#64748b' }, grid: { color: '#f1f5f9' } },
          y: { min: chartCfg.yMin !== '' ? +chartCfg.yMin : undefined, max: chartCfg.yMax !== '' ? +chartCfg.yMax : undefined, title: { display: true, text: chartCfg.yAxisLabel || 'CD Signal', font: { size: +(chartCfg.fontSize || 12) + 2, weight: 'bold' }, color: '#334155' }, ticks: { font: { size: +(chartCfg.fontSize || 12) }, color: '#64748b' }, grid: { color: '#f1f5f9' } }
        },
        plugins: { legend: { display: chartCfg.legend !== 'none', position: chartCfg.legend || 'top', labels: { font: { size: +(chartCfg.fontSize || 12) }, usePointStyle: true } }, tooltip: { callbacks: { title: (c) => `${c[0].parsed.x.toFixed(1)} nm`, label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(4)}` } } }
      }
    });
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; } };
  }, [instances, chartCfg, isFs, xField]);

  return (
    <div className={`flex flex-col bg-white relative ${isFs ? FS_CLASSES + ' p-6' : ''}`}>
      {isFs && <div className={OVERLAY_CLASSES} onClick={onToggleFs} />}
      <div className="flex justify-between items-center mb-2 z-10">
        {isFs && <h2 className="text-sm font-bold text-slate-600 uppercase">CD Spectra Overlay</h2>}
        <button onClick={onToggleFs} className={`${isFs ? '' : 'absolute top-0 right-0 m-2'} ml-auto text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print z-10`}>
          {isFs ? 'Close' : 'Zoom'}
        </button>
      </div>
      <div ref={wrapRef} className="flex-1 relative min-h-0 w-full" style={{ height: isFs ? '100%' : `${chartCfg.height || 380}px` }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

/* ============================= SS BAR CHART ============================= */
const SSBarChart = ({ ssData, isFs, onToggleFs, cfg }) => {
  const barData = ['Alpha Helix', 'Beta Sheet', 'Turn', 'Coil'].map((name, si) => {
    const keys = ['alpha', 'beta', 'turn', 'coil'];
    const row = { name };
    ssData.forEach((d) => { row[d.label] = d[keys[si]]; });
    return row;
  });
  const fs = Math.max(9, (cfg.fontSize || 12) - 1);
  return (
    <div className={`flex flex-col bg-white ${isFs ? FS_CLASSES + ' p-6' : 'relative border border-slate-200 rounded-lg p-3 shadow-sm'}`}>
      {isFs && <div className={OVERLAY_CLASSES} onClick={onToggleFs} />}
      <div className="flex items-center justify-between mb-2 z-10">
        <span className="text-xs font-bold text-slate-700">Secondary Structure Distribution</span>
        <button type="button" onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 text-[10px] no-print z-10">{isFs ? 'Close' : 'Zoom'}</button>
      </div>
      <div className="select-none" style={{ height: isFs ? '100%' : `${cfg.height || 300}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData} margin={{ top: 5, right: 16, bottom: 30, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: fs, fill: '#64748b' }} />
            <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fontSize: fs, fill: '#64748b' }} />
            <Tooltip formatter={(v) => `${v}%`} />
            {cfg.legend !== 'none' && <Legend wrapperStyle={{ fontSize: fs }} />}
            {ssData.map((d, i) => <Bar key={d.label} dataKey={d.label} fill={LINE_COLORS[i % LINE_COLORS.length]} radius={[3,3,0,0]} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/* ============================= SS CONDITION PLOT ============================= */
const SSConditionPlot = ({ ssData, xField, cfg, isFs, onToggleFs }) => {
  const chartRef = useRef(null);
  const pts = ssData.filter((d) => d.xVal !== null && d.xVal !== undefined);
  if (!pts.length) return null;
  const allX = pts.map((d) => d.xVal);
  const zoom = useXZoom(chartRef, [Math.min(...allX), Math.max(...allX)]);
  const KEYS = [{ k: 'alpha', l: 'alpha-Helix', c: '#3b82f6' }, { k: 'beta', l: 'beta-Sheet', c: '#ef4444' }, { k: 'turn', l: 'Turn', c: '#22c55e' }, { k: 'coil', l: 'Coil', c: '#f59e0b' }];
  const fs = Math.max(9, (cfg.fontSize || 12) - 1);
  const xLabel = CD_COND_FIELDS.find((f) => f.key === xField)?.label || xField;
  return (
    <div className={`flex flex-col bg-white ${isFs ? FS_CLASSES + ' p-6' : 'relative border border-slate-200 rounded-lg p-3 shadow-sm'}`}>
      {isFs && <div className={OVERLAY_CLASSES} onClick={onToggleFs} />}
      <div className="flex items-center justify-between mb-2 z-10">
        <span className="text-xs font-bold text-slate-700">Structure vs {xLabel}</span>
        <div className="flex gap-1">
          {zoom.isZoomed && <button type="button" onClick={zoom.reset} className="text-[9px] bg-slate-200 px-1.5 py-0.5 rounded font-bold">Reset</button>}
          <button type="button" onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 text-[10px] no-print z-10">{isFs ? 'Close' : 'Zoom'}</button>
        </div>
      </div>
      <div ref={chartRef} onMouseDown={zoom.onMouseDown} className="select-none" style={{ height: isFs ? '100%' : `${cfg.height || 300}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 5, right: 16, bottom: 30, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={[domV(cfg.xMin) ?? zoom.domain[0], domV(cfg.xMax) ?? zoom.domain[1]]} tick={{ fontSize: fs, fill: '#64748b' }} label={{ value: xLabel, position: 'insideBottom', offset: -16, fill: '#64748b', fontSize: fs }} />
            <YAxis tickFormatter={(v) => `${v}%`} domain={[0, domV(cfg.yMax) ?? 100]} tick={{ fontSize: fs, fill: '#64748b' }} width={48} />
            <Tooltip formatter={(v) => `${v?.toFixed(1)}%`} />
            {cfg.legend !== 'none' && <Legend wrapperStyle={{ fontSize: fs }} />}
            {KEYS.map(({ k, l, c }) => (
              <Line key={k} data={pts.map((d) => ({ x: d.xVal, y: d[k] }))} type="monotone" dataKey="y" name={l}
                stroke={(cfg.colors && cfg.colors[k]) || c} strokeWidth={cfg.lineThickness || 2}
                strokeDasharray={lineDash(cfg.lineStyle)} dot={cfg.ptSize > 0 ? { r: cfg.ptSize, fill: c, strokeWidth: 0 } : false}
                connectNulls isAnimationActive={false} />
            ))}
            {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/* ============================= COMPUTE SS RESULTS ============================= */
const useSsResults = (instances, xField) => useMemo(() => {
  return instances.map((inst) => {
    const { wavelengths, spectra } = parseInstSpectra(inst);
    if (!wavelengths.length || !spectra.length) return null;
    const spec = spectra.find((s) => s.visible !== false && s.values?.length > 0);
    if (!spec) return null;
    const result = fitCdSpectrum(wavelengths, spec.values);
    if (!result) return null;
    const xRaw = getInstCond(inst, xField);
    return { instId: inst.id, label: inst.name || inst.instanceName || inst.id, xVal: parseManual(xRaw), xRaw, ...result, specColor: spec.color, wavelengths, values: spec.values };
  }).filter(Boolean);
}, [instances, xField]);

/* ============================= DATA SECTION ============================= */
export const CDDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const instances = ctx.instances || [];
  const activeInstId = activeTest?.cdActiveInstId || instances[0]?.id || null;
  const activeInst = instances.find((i) => i.id === activeInstId) || instances[0] || null;
  const [fsPanel, setFsPanel] = useState(null);
  const [showStyle, setShowStyle] = useState(false);
  const chartCfg = useMemo(() => ({ ...DEFAULT_CHART_CFG, ...(activeTest?.cdChartCfg || {}) }), [activeTest?.cdChartCfg]);
  const setCfg = (patch) => updateActiveTest({ cdChartCfg: { ...chartCfg, ...patch } });
  const xField = activeTest?.cdXField || 'temperature';

  const updateInst = (updates) => {
    if (!activeInst) return;
    if (ctx.updateInstance) ctx.updateInstance(activeInst.id, updates);
    else if (activeInst.id === activeTest.id) updateActiveTest(updates);
  };

  const { wavelengths, spectra } = useMemo(() => parseInstSpectra(activeInst), [activeInst]);

  const addSpectrum = () => {
    const cols = activeInst?.spectraColumns || [];
    updateInst({ spectraColumns: [...cols, { id: Date.now().toString(), title: `Spectrum ${cols.length + 1}`, data: '', visible: true, color: LINE_COLORS[cols.length % LINE_COLORS.length] }] });
  };
  const updateSpec = (id, upd) => updateInst({ spectraColumns: (activeInst?.spectraColumns || []).map((c) => c.id === id ? { ...c, ...upd } : c) });
  const removeSpec = (id) => updateInst({ spectraColumns: (activeInst?.spectraColumns || []).filter((c) => c.id !== id) });

  // Trigger chart resize on mount
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 100); return () => clearTimeout(t); }, []);

  return (
    <div className="flex flex-col gap-6">
      {instances.length > 0 && (
        <div className="flex gap-2 flex-wrap border-b border-slate-200 pb-3">
          <span className="text-xs font-bold text-slate-500 self-center mr-2">Active instance:</span>
          {instances.map((inst) => (
            <button key={inst.id} onClick={() => updateActiveTest({ cdActiveInstId: inst.id })}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${inst.id === activeInstId ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}>
              {inst.name || inst.instanceName || inst.id}
              {getInstCond(inst, xField) != null && <span className="ml-1 opacity-70">({getInstCond(inst, xField)})</span>}
            </button>
          ))}
        </div>
      )}

      <CollapsibleSection title="Data Import" icon="📥" defaultOpen>
        {!activeInst ? (
          <div className="text-sm text-slate-500 italic p-4 bg-slate-50 rounded border border-slate-200">No instances available.</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold text-slate-600 uppercase">Wavelength Data (nm)</label>
                <span className="text-[10px] text-slate-400">{wavelengths.length} points</span>
              </div>
              <textarea value={activeInst.wavelengthData || ''} onChange={(e) => updateInst({ wavelengthData: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-xs outline-none focus:border-blue-500 h-20 resize-y shadow-inner"
                placeholder="190, 191, 192, ... 260 (comma or newline separated)" />
              <p className="text-[10px] text-slate-400 mt-1">
                {wavelengths.length > 0 ? `Range: ${Math.min(...wavelengths).toFixed(1)} - ${Math.max(...wavelengths).toFixed(1)} nm` : 'No wavelengths loaded'}
              </p>
            </div>
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <label className="text-xs font-bold text-slate-600 uppercase">CD Spectra (intensity columns)</label>
                <button onClick={addSpectrum} disabled={!activeInst} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors">+ Add Spectrum</button>
              </div>
              {spectra.length === 0 ? (
                <div className="text-center py-6 text-slate-400 italic bg-white rounded-lg border border-dashed border-slate-300">Click "Add Spectrum" to import CD signal data.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {spectra.map((spec) => (
                    <div key={spec.id} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm relative group">
                      <div className="flex items-center gap-2 mb-2">
                        <input type="color" value={spec.color || '#3b82f6'} onChange={(e) => updateSpec(spec.id, { color: e.target.value })} className="w-6 h-6 rounded border border-slate-300 cursor-pointer" />
                        <input type="text" value={spec.title} onChange={(e) => updateSpec(spec.id, { title: e.target.value })} className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs font-bold outline-none" placeholder="Spectrum name..." />
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={spec.visible !== false} onChange={(e) => updateSpec(spec.id, { visible: e.target.checked })} className="w-3 h-3 accent-blue-600" />
                          <span className="text-[9px] text-slate-500">Show</span>
                        </label>
                        <button onClick={() => removeSpec(spec.id)} className="text-slate-400 hover:text-red-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                      <textarea value={spec.data || ''} onChange={(e) => updateSpec(spec.id, { data: e.target.value })}
                        className="w-full border border-slate-200 rounded p-2 font-mono text-[10px] outline-none focus:border-blue-500 h-16 resize-y shadow-inner"
                        placeholder={`CD intensities for ${spec.title}...`} />
                      <p className="text-[9px] text-slate-400 mt-1">
                        {spec.values?.length ?? 0} values
                        {spec.values?.length !== wavelengths.length && wavelengths.length > 0 && (
                          <span className="text-amber-600 font-bold ml-1">⚠ {wavelengths.length} expected</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="CD Spectra Overlay — All Conditions" icon="📈" headerExtra={
        <button onClick={() => setShowStyle((p) => !p)} className="text-[10px] bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded font-bold">⚙ Style</button>
      }>
        {showStyle && <div className="mb-4"><ChartStylePanel cfg={chartCfg} setCfg={setCfg} /></div>}
        {fsPanel === 'overlay' && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
        <CDOverlayChart instances={instances} chartCfg={chartCfg} isFs={fsPanel === 'overlay'} onToggleFs={() => setFsPanel((p) => p === 'overlay' ? null : 'overlay')} xField={xField} />
      </CollapsibleSection>

      {activeInst && spectra.filter((s) => s.visible !== false && s.values?.length > 0).length > 0 && (
        <CollapsibleSection title={`Individual Spectra — ${activeInst.name || activeInst.instanceName || 'Active'}`} icon="🔬" defaultOpen={false}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {spectra.filter((s) => s.visible !== false && s.values?.length > 0).map((spec, idx) => (
              <React.Fragment key={spec.id}>
                {fsPanel === `m-${spec.id}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
                <MiniSpecChart wavelengths={wavelengths} values={spec.values} cfg={chartCfg} color={spec.color || LINE_COLORS[idx % LINE_COLORS.length]}
                  isFs={fsPanel === `m-${spec.id}`} onToggleFs={() => setFsPanel((p) => p === `m-${spec.id}` ? null : `m-${spec.id}`)}
                  title={spec.title} fitCurve={null} />
              </React.Fragment>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
};

/* ============================= MATH & FITTING SECTION ============================= */
export const MathAndFittingSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const instances = ctx.instances || [];
  const xField = activeTest?.cdXField || 'temperature';
  const setXField = (f) => updateActiveTest({ cdXField: f });
  const activeInstId = activeTest?.cdActiveInstId || instances[0]?.id || null;
  const activeInst = instances.find((i) => i.id === activeInstId) || instances[0] || null;
  const [fsPanel, setFsPanel] = useState(null);
  const [showStyle, setShowStyle] = useState(false);
  const [excludeMismatch, setExcludeMismatch] = useState(false);
  const chartCfg = useMemo(() => ({ ...DEFAULT_CHART_CFG, height: 300, ...(activeTest?.cdFitChartCfg || {}) }), [activeTest?.cdFitChartCfg]);
  const setCfg = (patch) => updateActiveTest({ cdFitChartCfg: { ...chartCfg, ...patch } });

  const mathOp = activeTest?.cdMathOp || { op: 'subtract', factor: 1, blankInstId: '' };
  const setMathOp = (patch) => updateActiveTest({ cdMathOp: { ...mathOp, ...patch } });

  const consistency = useConsistency(instances, xField);
  const usedInsts = excludeMismatch ? instances.filter((i) => !consistency.mismatchedIds.has(i.id)) : instances;
  const ssResults = useSsResults(usedInsts, xField);

  const applyMathOp = () => {
    if (!activeInst) return;
    const blankInst = instances.find((i) => i.id === mathOp.blankInstId);
    const blankVals = blankInst ? (parseInstSpectra(blankInst).spectra[0]?.values || []) : [];
    const { spectra } = parseInstSpectra(activeInst);
    const newCols = spectra.map((spec) => {
      if (!spec.values || !spec.values.length) return spec;
      const newData = spec.values.map((v, i) => {
        if (mathOp.op === 'subtract') return v - (blankVals[i] ?? 0);
        if (mathOp.op === 'add') return v + (blankVals[i] ?? 0);
        if (mathOp.op === 'multiply') return v * (mathOp.factor || 1);
        return v;
      }).join('\n');
      return { ...spec, data: newData };
    });
    if (ctx.updateInstance) ctx.updateInstance(activeInst.id, { spectraColumns: newCols });
    else if (activeInst.id === activeTest.id) updateActiveTest({ spectraColumns: newCols });
  };

  return (
    <div className="flex flex-col gap-6">
      <CollapsibleSection title="X-Axis & Consistency Check" icon="📊" defaultOpen>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 items-start">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600 uppercase">X-Axis Condition</label>
              <select value={xField} onChange={(e) => setXField(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                {CD_COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            {consistency.varyingFields.length > 0 && (
              <div className="flex-1 bg-blue-50 border border-blue-200 rounded-lg p-3 min-w-[200px]">
                <p className="text-xs font-bold text-blue-700 mb-2">Auto-detected varying conditions:</p>
                <div className="flex flex-wrap gap-2">
                  {consistency.varyingFields.map((f) => (
                    <button key={f.key} onClick={() => setXField(f.key)}
                      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${xField === f.key ? 'bg-blue-600 text-white' : 'bg-white border border-blue-300 text-blue-600 hover:bg-blue-100'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {consistency.hasMismatch && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
              <p className="text-sm font-bold text-amber-800 mb-2">⚠️ Consistency Warning</p>
              <p className="text-xs text-amber-700 mb-3">{consistency.mismatchedIds.size} instance(s) have different fixed experimental conditions.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...consistency.mismatchedIds].map((id) => {
                  const inst = instances.find((i) => i.id === id);
                  return <span key={id} className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs rounded font-bold">{inst?.name || id}</span>;
                })}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={excludeMismatch} onChange={(e) => setExcludeMismatch(e.target.checked)} className="w-4 h-4 accent-amber-600" />
                <span className="text-xs font-bold text-amber-800">Exclude mismatched instances from analysis</span>
              </label>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead><tr className="bg-slate-100">
                <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">Instance</th>
                <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">{CD_COND_FIELDS.find((f) => f.key === xField)?.label} (X)</th>
                <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">Spectra loaded</th>
                {consistency.hasMismatch && <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">Status</th>}
              </tr></thead>
              <tbody>{instances.map((inst) => {
                const { spectra } = parseInstSpectra(inst); const xRaw = getInstCond(inst, xField); const isM = consistency.mismatchedIds.has(inst.id);
                return (<tr key={inst.id} className={`${isM ? 'bg-amber-50' : 'bg-white'} hover:bg-blue-50`}>
                  <td className="p-2 border border-slate-200 font-bold">{inst.name || inst.instanceName || inst.id}</td>
                  <td className="p-2 border border-slate-200 font-mono">{xRaw != null ? String(xRaw) : <span className="text-slate-400 italic">not set</span>}</td>
                  <td className="p-2 border border-slate-200">{spectra.filter((s) => s.visible !== false && s.values?.length > 0).length}</td>
                  {consistency.hasMismatch && <td className="p-2 border border-slate-200">{isM ? <span className="text-amber-600 font-bold">⚠ Mismatch</span> : <span className="text-green-600 font-bold">✓ OK</span>}</td>}
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Secondary Structure Fitting" icon="🧬" defaultOpen>
        {ssResults.length === 0 ? (
          <div className="text-sm text-slate-500 italic bg-slate-50 p-4 rounded border border-slate-200">
            No CD spectra loaded. Import wavelength + intensity data in the Data section.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead><tr className="bg-slate-100">
                  <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">Instance</th>
                  <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">{CD_COND_FIELDS.find((f) => f.key === xField)?.label}</th>
                  <th className="text-center p-2 font-bold text-blue-700 border border-slate-200">alpha-Helix %</th>
                  <th className="text-center p-2 font-bold text-red-700 border border-slate-200">beta-Sheet %</th>
                  <th className="text-center p-2 font-bold text-green-700 border border-slate-200">Turn %</th>
                  <th className="text-center p-2 font-bold text-amber-700 border border-slate-200">Coil %</th>
                  <th className="text-center p-2 font-bold text-slate-600 border border-slate-200">R2</th>
                </tr></thead>
                <tbody>{ssResults.map((r) => (
                  <tr key={r.instId} className="bg-white hover:bg-blue-50 transition-colors">
                    <td className="p-2 border border-slate-200 font-bold">{r.label}</td>
                    <td className="p-2 border border-slate-200 font-mono">{r.xRaw != null ? String(r.xRaw) : '—'}</td>
                    <td className="p-2 border border-slate-200 text-center font-bold text-blue-700">{r.alpha}%</td>
                    <td className="p-2 border border-slate-200 text-center font-bold text-red-700">{r.beta}%</td>
                    <td className="p-2 border border-slate-200 text-center font-bold text-green-700">{r.turn}%</td>
                    <td className="p-2 border border-slate-200 text-center font-bold text-amber-700">{r.coil}%</td>
                    <td className="p-2 border border-slate-200 text-center font-mono">{r.r2.toFixed(3)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {ssResults.map((r, idx) => (
                <React.Fragment key={r.instId}>
                  {fsPanel === `sf-${r.instId}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
                  <MiniSpecChart wavelengths={r.wavelengths} values={r.values} cfg={chartCfg}
                    color={r.specColor || LINE_COLORS[idx % LINE_COLORS.length]}
                    isFs={fsPanel === `sf-${r.instId}`} onToggleFs={() => setFsPanel((p) => p === `sf-${r.instId}` ? null : `sf-${r.instId}`)}
                    title={`${r.label}${r.xRaw != null ? ' (' + r.xRaw + ')' : ''}`}
                    fitCurve={r.fitCurve} />
                </React.Fragment>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {fsPanel === 'ssBar' && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
              <SSBarChart ssData={ssResults} isFs={fsPanel === 'ssBar'} onToggleFs={() => setFsPanel((p) => p === 'ssBar' ? null : 'ssBar')} cfg={chartCfg} />
              {ssResults.filter((r) => r.xVal !== null).length >= 2 && (
                <>
                  {fsPanel === 'ssCond' && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
                  <SSConditionPlot ssData={ssResults} xField={xField} cfg={chartCfg} isFs={fsPanel === 'ssCond'} onToggleFs={() => setFsPanel((p) => p === 'ssCond' ? null : 'ssCond')} />
                </>
              )}
            </div>
            <button onClick={() => setShowStyle((p) => !p)} className="self-start text-[10px] bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded font-bold">⚙ Chart Style</button>
            {showStyle && <ChartStylePanel cfg={chartCfg} setCfg={setCfg} series={[{ key:'alpha',label:'alpha-Helix',color:'#3b82f6' },{ key:'beta',label:'beta-Sheet',color:'#ef4444' },{ key:'turn',label:'Turn',color:'#22c55e' },{ key:'coil',label:'Coil',color:'#f59e0b' }]} />}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Math Operations" icon="±" defaultOpen={false}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600 uppercase">Operation</label>
              <select value={mathOp.op} onChange={(e) => setMathOp({ op: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                <option value="subtract">Subtract blank spectrum</option>
                <option value="add">Add spectrum</option>
                <option value="multiply">Multiply by factor</option>
              </select>
            </div>
            {mathOp.op === 'multiply' ? (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600 uppercase">Factor</label>
                <input type="number" step="any" value={mathOp.factor || 1} onChange={(e) => setMathOp({ factor: parseFloat(e.target.value) || 1 })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600 uppercase">Blank instance</label>
                <select value={mathOp.blankInstId || ''} onChange={(e) => setMathOp({ blankInstId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                  <option value="">-- Select blank --</option>
                  {instances.map((inst) => <option key={inst.id} value={inst.id}>{inst.name || inst.instanceName || inst.id}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-600 uppercase">Apply to instance</label>
              <select value={activeInstId || ''} onChange={(e) => updateActiveTest({ cdActiveInstId: e.target.value })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                {instances.map((inst) => <option key={inst.id} value={inst.id}>{inst.name || inst.instanceName || inst.id}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            ⚠️ This permanently modifies the first visible spectrum of the selected instance.
          </div>
          <button onClick={applyMathOp} className="self-start bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm transition-colors">Apply</button>
        </div>
      </CollapsibleSection>
    </div>
  );
};

/* ============================= FITTING ERRORS ============================= */
export const FittingErrors = ({ ctx }) => {
  const instances = ctx.instances || [];
  const xField = ctx.activeTest?.cdXField || 'temperature';
  const ssResults = useSsResults(instances, xField);
  if (!ssResults.length) return <div className="text-sm text-slate-500 italic p-4">No fitting results. Import CD spectra data first.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead><tr className="bg-slate-100">
          <th className="text-left p-2 font-bold text-slate-600 border border-slate-200">Instance</th>
          <th className="text-center p-2 font-bold text-slate-600 border border-slate-200">R2 (goodness of fit)</th>
          <th className="text-center p-2 font-bold text-slate-600 border border-slate-200">Points used</th>
          <th className="text-center p-2 font-bold text-slate-600 border border-slate-200">Quality</th>
        </tr></thead>
        <tbody>{ssResults.map((r) => (
          <tr key={r.instId} className="bg-white hover:bg-slate-50">
            <td className="p-2 border border-slate-200 font-bold">{r.label}</td>
            <td className="p-2 border border-slate-200 text-center font-mono">{r.r2.toFixed(4)}</td>
            <td className="p-2 border border-slate-200 text-center">{r.nPoints}</td>
            <td className="p-2 border border-slate-200 text-center">
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${r.r2 >= 0.95 ? 'bg-green-100 text-green-700' : r.r2 >= 0.85 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                {r.r2 >= 0.95 ? 'Excellent' : r.r2 >= 0.85 ? 'Good' : 'Poor'}
              </span>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

/* ============================= FITTING GRAPHICS ============================= */
export const FittingGraphics = ({ ctx }) => {
  const { activeTest } = ctx;
  const instances = ctx.instances || [];
  const xField = activeTest?.cdXField || 'temperature';
  const [fsPanel, setFsPanel] = useState(null);
  const chartCfg = useMemo(() => ({ ...DEFAULT_CHART_CFG, height: 300, ...(activeTest?.cdFitChartCfg || {}) }), [activeTest?.cdFitChartCfg]);
  const ssResults = useSsResults(instances, xField);
  if (!ssResults.length) return <div className="text-sm text-slate-500 italic p-4">No fitting results. Import CD spectra data first.</div>;
  return (
    <div className="flex flex-col gap-6">
      {fsPanel === 'fgBar' && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
      <SSBarChart ssData={ssResults} isFs={fsPanel === 'fgBar'} onToggleFs={() => setFsPanel((p) => p === 'fgBar' ? null : 'fgBar')} cfg={chartCfg} />
      {ssResults.filter((r) => r.xVal !== null).length >= 2 && (
        <>
          {fsPanel === 'fgCond' && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)} />}
          <SSConditionPlot ssData={ssResults} xField={xField} cfg={chartCfg} isFs={fsPanel === 'fgCond'} onToggleFs={() => setFsPanel((p) => p === 'fgCond' ? null : 'fgCond')} />
        </>
      )}
    </div>
  );
};

/* ============================= NOTEBOOK EXTRA ============================= */
export const NotebookExtra = ({ ctx, checkId }) => {
  const instances = ctx.instances || [];
  const xField = ctx.activeTest?.cdXField || 'temperature';
  if (checkId === 'cond') {
    return `<h3 style="font-size:14px;font-weight:bold;margin-bottom:8px">Experimental Conditions</h3><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">Instance</th>${CD_COND_FIELDS.map((f) => `<th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">${f.label}</th>`).join('')}</tr></thead><tbody>${instances.map((inst) => `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;font-weight:bold">${inst.name || inst.id}</td>${CD_COND_FIELDS.map((f) => `<td style="padding:4px 8px;border:1px solid #e2e8f0">${getInstCond(inst, f.key) ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (checkId === 'struct') {
    const rows = instances.map((inst) => {
      const { wavelengths, spectra } = parseInstSpectra(inst);
      const spec = spectra.find((s) => s.visible !== false && s.values?.length > 0);
      if (!spec || !wavelengths.length) return '';
      const r = fitCdSpectrum(wavelengths, spec.values);
      if (!r) return '';
      return `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;font-weight:bold">${inst.name || inst.id}</td><td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:center">${r.alpha}%</td><td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:center">${r.beta}%</td><td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:center">${r.turn}%</td><td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:center">${r.coil}%</td><td style="padding:4px 8px;border:1px solid #e2e8f0;text-align:center">${r.r2.toFixed(3)}</td></tr>`;
    }).filter(Boolean);
    return `<h3 style="font-size:14px;font-weight:bold;margin-bottom:8px">Secondary Structure</h3><table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">Instance</th><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">alpha-Helix</th><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">beta-Sheet</th><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">Turn</th><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">Coil</th><th style="padding:4px 8px;border:1px solid #e2e8f0;background:#f8fafc">R2</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  return '';
};
