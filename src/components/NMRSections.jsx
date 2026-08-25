import NMRMoleculeViewer from './NMRMoleculeViewer';
import { ChartControlBar, SharedChartStylePanel } from './SharedAnalysisTools';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, BarChart, Bar, LineChart, Line, Legend, ErrorBar, Cell
} from 'recharts';
import { CollapsibleSection } from './ui';
import { FS_CLASSES, OVERLAY_CLASSES, CHART_MARGIN, CHART_MARGIN_1D, SELECT_COLOR, MANUAL_COLOR, LINE_COLORS, VIS_PALETTES } from '../utils/chartStyle';
export { VIS_PALETTES };

const HAS_EB = typeof ErrorBar !== 'undefined';
// Chart/style constants now live in ../utils/chartStyle (single shared source).
const TICKS_13C = Array.from({ length: 421 }, (_, i) => parseFloat((10 + i * 0.5).toFixed(1)));
const TICKS_15N = Array.from({ length: 81 }, (_, i) => parseFloat((95 + i * 0.5).toFixed(1)));
const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
// Chart/style constants (FS_CLASSES, OVERLAY_CLASSES, SELECT_COLOR, MANUAL_COLOR,
// CHART_MARGIN, CHART_MARGIN_1D, VIS_PALETTES) now live in ../utils/chartStyle.

// ================= RDKit Auto-Loader & Singleton =================
const _rdkitListeners = new Set();
let _rdkitStatus = 'loading'; 

const RDKIT_JS_URL = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
const RDKIT_WASM_URL = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.wasm';

const loadRDKitScript = () => {
  if (window.__RDKit) {
    _rdkitStatus = 'ready';
    _rdkitListeners.forEach(fn => fn('ready'));
    _rdkitListeners.clear();
    return;
  }
  if (document.getElementById('rdkit-wasm-script')) return;
  
  const script = document.createElement('script');
  script.id = 'rdkit-wasm-script';
  // NOTE: "RDKit.js" does NOT exist in the @rdkit/rdkit dist (only RDKit_minimal.js),
  // so the old URL was a 404 and the 2D formula silently fell back to a static image.
  script.src = RDKIT_JS_URL;
  script.async = true;
  
  script.onload = () => {
    if (typeof window.initRDKitModule === 'function') {
      window.initRDKitModule({ locateFile: () => RDKIT_WASM_URL }).then((Module) => {
        window.__RDKit = Module;
        _rdkitStatus = 'ready';
        _rdkitListeners.forEach(fn => fn('ready'));
        _rdkitListeners.clear();
      }).catch(() => {
        _rdkitStatus = 'failed';
        _rdkitListeners.forEach(fn => fn('failed'));
        _rdkitListeners.clear();
      });
    } else if (window.__RDKit) {
      _rdkitStatus = 'ready';
      _rdkitListeners.forEach(fn => fn('ready'));
      _rdkitListeners.clear();
    } else {
      let _attempts = 0;
      const _interval = setInterval(() => {
        _attempts++;
        if (window.__RDKit) {
          _rdkitStatus = 'ready';
          clearInterval(_interval);
          _rdkitListeners.forEach(fn => fn('ready'));
          _rdkitListeners.clear();
        } else if (_attempts > 50) {
          _rdkitStatus = 'failed';
          clearInterval(_interval);
          _rdkitListeners.forEach(fn => fn('failed'));
          _rdkitListeners.clear();
        }
      }, 300);
    }
  };
  script.onerror = () => {
    _rdkitStatus = 'failed';
    _rdkitListeners.forEach(fn => fn('failed'));
    _rdkitListeners.clear();
  };
  document.head.appendChild(script);
};

loadRDKitScript();

const useRdkitReady = () => {
  const [status, setStatus] = useState(_rdkitStatus);
  useEffect(() => {
    if (_rdkitStatus !== 'loading') { setStatus(_rdkitStatus); return; }
    const fn = (s) => setStatus(s);
    _rdkitListeners.add(fn);
    return () => _rdkitListeners.delete(fn);
  }, []);
  // If window.__RDKit was already loaded by another module, treat it as ready even
  // when this module's own status flag is stale (e.g. an earlier failed script tag).
  const effectiveReady = status === 'ready' || !!window.__RDKit;
  const effectiveFailed = status === 'failed' && !window.__RDKit;
  return { rdkitReady: effectiveReady, rdkitFailed: effectiveFailed };
};
// =====================================================================

// CollapsibleSection now lives in ./ui (single shared definition).

export const ExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest, nmrExperiments } = ctx;
  const plannedExperiments = activeTest.plannedExperiments || [];
  const [selectedExp, setSelectedExp] = useState('');
  const [ns, setNs] = useState(16);
  const [d1, setD1] = useState(1.5);
  const [aq, setAq] = useState(0.1);
  const [pd, setPd] = useState(0);
  const [td, setTd] = useState(2048);
  const [td1, setTd1] = useState(256);
  const [td2, setTd2] = useState(64);
  const expDetail = (nmrExperiments || []).find(e => e.name === selectedExp);
  const dims = expDetail ? expDetail.dimensions : '1D';
  const is2D = dims === '2D' || dims === '3D';
  const is3D = dims === '3D';
  
  const addExperiment = () => {
    if (!selectedExp) return;
    const newExp = {
      id: Date.now().toString(),
      name: selectedExp,
      dims, ns, d1, aq, pd, td,
      td1: is2D ? td1 : 1,
      td2: is3D ? td2 : 1,
      details: `${dims} ${expDetail?.expType || ''}`.trim()
    };
    updateActiveTest({ plannedExperiments: [...plannedExperiments, newExp] });
    setSelectedExp('');
  };
  
  const removeExperiment = (id) => {
    updateActiveTest({ plannedExperiments: plannedExperiments.filter(e => e.id !== id) });
  };
  
  const calcTime = (exp) => {
    const e_td1 = (exp.dims === '2D' || exp.dims === '3D') ? (Number(exp.td1) || 1) : 1;
    const e_td2 = (exp.dims === '3D') ? (Number(exp.td2) || 1) : 1;
    return Number(exp.ns || 0) * (Number(exp.d1 || 0) + Number(exp.aq || 0) + Number(exp.pd || 0)) * e_td1 * e_td2;
  };
  
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    
    if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  
  const totalSeconds = plannedExperiments.reduce((acc, exp) => acc + calcTime(exp), 0);
  
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <label className="block text-xs font-bold text-slate-500 uppercase">Plan NMR Experiments</label>
          <div className="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
            Total Time: {formatTime(totalSeconds)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-4 items-end bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div className="flex flex-col flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Pulse Sequence</label>
            <select value={selectedExp} onChange={(e) => setSelectedExp(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 bg-white">
              <option value="">-- Select --</option>
              {(nmrExperiments || []).map((exp) => (
                <option key={exp.id || exp.name} value={exp.name}>{exp.name} ({exp.dimensions})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col w-16">
            <label className="text-[10px] font-bold text-slate-500 uppercase">NS</label>
            <input type="number" value={ns} onChange={e => setNs(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-[10px] font-bold text-slate-500 uppercase">D1 (s)</label>
            <input type="number" step="0.1" value={d1} onChange={e => setD1(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-[10px] font-bold text-slate-500 uppercase">AQ (s)</label>
            <input type="number" step="0.1" value={aq} onChange={e => setAq(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-[10px] font-bold text-slate-500 uppercase">P&D (s)</label>
            <input type="number" step="0.1" value={pd} onChange={e => setPd(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="flex flex-col w-20">
            <label className="text-[10px] font-bold text-slate-500 uppercase">TD</label>
            <input type="number" value={td} onChange={e => setTd(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
          </div>
          {is2D && (
            <div className="flex flex-col w-20">
              <label className="text-[10px] font-bold text-slate-500 uppercase">TD1</label>
              <input type="number" value={td1} onChange={e => setTd1(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
            </div>
          )}
          {is3D && (
            <div className="flex flex-col w-20">
              <label className="text-[10px] font-bold text-slate-500 uppercase">TD2</label>
              <input type="number" value={td2} onChange={e => setTd2(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
            </div>
          )}
          <button onClick={addExperiment} disabled={!selectedExp} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-4 py-1.5 rounded-lg text-sm transition-colors h-[34px]">
            + Add
          </button>
        </div>
        {plannedExperiments.length > 0 ? (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left bg-white">
              <thead className="bg-slate-100 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-2 w-12">#</th>
                  <th className="px-4 py-2">Pulse Sequence</th>
                  <th className="px-4 py-2">Params</th>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plannedExperiments.map((exp, index) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-bold text-slate-600">{index + 1}</td>
                    <td className="px-4 py-2 font-bold text-blue-700">
                      {exp.name} <span className="text-xs font-normal text-slate-500">({exp.details})</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                      NS:{exp.ns} D1:{exp.d1} AQ:{exp.aq} P&D:{exp.pd || 0} TD:{exp.td}
                      {(exp.dims === '2D' || exp.dims === '3D') && ` TD1:${exp.td1}`}
                      {exp.dims === '3D' && ` TD2:${exp.td2}`}
                    </td>
                    <td className="px-4 py-2 font-bold text-emerald-700">{formatTime(calcTime(exp))}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => removeExperiment(exp.id)} className="text-red-500 hover:text-red-700 font-bold px-2 py-1 transition-colors">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
            No experiments planned yet.
          </div>
        )}
      </div>
    </div>
  );
};
// ================= DATABASES =================
const AMINO_ACID_DB = {
  A: { name: 'Alanine', code3: 'Ala', atoms: ['HN', 'Hα', 'Hβ'], ranges: { HN: { min: 7.8, max: 8.6 }, Hα: { min: 4.0, max: 4.5 }, Hβ: { min: 1.2, max: 1.5 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ']], spinSystems: [['HN', 'Hα', 'Hβ']] },
  C: { name: 'Cysteine', code3: 'Cys', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.8 }, Hβ1: { min: 2.8, max: 3.3 }, Hβ2: { min: 2.8, max: 3.3 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  D: { name: 'Aspartic Acid', code3: 'Asp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.5, max: 2.9 }, Hβ2: { min: 2.5, max: 2.9 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  E: { name: 'Glutamic Acid', code3: 'Glu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ'], ranges: { HN: { min: 8.0, max: 8.7 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.1, max: 2.5 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ']] },
  F: { name: 'Phenylalanine', code3: 'Phe', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε', 'Hζ'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.9, max: 3.3 }, Hβ2: { min: 2.9, max: 3.3 }, Hδ: { min: 7.1, max: 7.4 }, Hε: { min: 7.2, max: 7.5 }, Hζ: { min: 7.1, max: 7.4 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε'], ['Hε', 'Hζ']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε', 'Hζ']] },
  G: { name: 'Glycine', code3: 'Gly', atoms: ['HN', 'Hα1', 'Hα2'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα1: { min: 3.8, max: 4.1 }, Hα2: { min: 3.8, max: 4.1 } }, cosy: [['HN', 'Hα1'], ['HN', 'Hα2'], ['Hα1', 'Hα2']], spinSystems: [['HN', 'Hα1', 'Hα2']] },
  H: { name: 'Histidine', code3: 'His', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ2', 'Hε1'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.0, max: 3.4 }, Hβ2: { min: 3.0, max: 3.4 }, Hδ2: { min: 6.9, max: 7.3 }, Hε1: { min: 7.6, max: 8.1 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']] },
  I: { name: 'Isoleucine', code3: 'Ile', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1'], ranges: { HN: { min: 7.7, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.7, max: 2.0 }, Hγ1: { min: 1.1, max: 1.6 }, Hγ2: { min: 0.8, max: 1.1 }, Hδ1: { min: 0.7, max: 1.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2'], ['Hγ1', 'Hδ1']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1']] },
  K: { name: 'Lysine', code3: 'Lys', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε', 'Hζ(NH3)'], ranges: { HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 1.9 }, Hγ: { min: 1.3, max: 1.6 }, Hδ: { min: 1.5, max: 1.8 }, Hε: { min: 2.8, max: 3.2 }, 'Hζ(NH3)': { min: 7.2, max: 7.6 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε'], ['Hε', 'Hζ(NH3)']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ['Hζ(NH3)']] },
  L: { name: 'Leucine', code3: 'Leu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2'], ranges: { HN: { min: 7.9, max: 8.5 }, Hα: { min: 4.2, max: 4.7 }, Hβ: { min: 1.5, max: 1.9 }, Hγ: { min: 1.4, max: 1.8 }, Hδ1: { min: 0.8, max: 1.0 }, Hδ2: { min: 0.8, max: 1.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ1'], ['Hγ', 'Hδ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2']] },
  M: { name: 'Methionine', code3: 'Met', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε(CH3)'], ranges: { HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.3, max: 4.7 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.4, max: 2.7 }, 'Hε(CH3)': { min: 2.0, max: 2.2 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε(CH3)']] },
  N: { name: 'Asparagine', code3: 'Asn', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ21', 'Hδ22'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.6, max: 3.0 }, Hβ2: { min: 2.6, max: 3.0 }, Hδ21: { min: 6.8, max: 7.2 }, Hδ22: { min: 7.4, max: 7.8 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']] },
  P: { name: 'Proline', code3: 'Pro', atoms: ['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2'], ranges: { Hα: { min: 4.2, max: 4.6 }, Hβ1: { min: 1.8, max: 2.4 }, Hβ2: { min: 1.8, max: 2.4 }, Hγ1: { min: 1.8, max: 2.1 }, Hγ2: { min: 1.8, max: 2.1 }, Hδ1: { min: 3.4, max: 3.8 }, Hδ2: { min: 3.4, max: 3.8 } }, cosy: [['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hβ1', 'Hγ1'], ['Hβ2', 'Hγ2'], ['Hγ1', 'Hγ2'], ['Hγ1', 'Hδ1'], ['Hγ2', 'Hδ2'], ['Hδ1', 'Hδ2']], spinSystems: [['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2']] },
  Q: { name: 'Glutamine', code3: 'Gln', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε21', 'Hε22'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.2, max: 2.6 }, Hε21: { min: 6.7, max: 7.1 }, Hε22: { min: 7.3, max: 7.7 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hε21', 'Hε22']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε21', 'Hε22']] },
  R: { name: 'Arginine', code3: 'Arg', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 2.0 }, Hγ: { min: 1.4, max: 1.8 }, Hδ: { min: 3.0, max: 3.3 }, Hε: { min: 7.0, max: 7.4 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ'], ['Hε']] },
  S: { name: 'Serine', code3: 'Ser', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.3, max: 4.8 }, Hβ1: { min: 3.7, max: 4.0 }, Hβ2: { min: 3.7, max: 4.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  T: { name: 'Threonine', code3: 'Thr', atoms: ['HN', 'Hα', 'Hβ', 'Hγ2'], ranges: { HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.2, max: 4.6 }, Hβ: { min: 4.0, max: 4.4 }, Hγ2: { min: 1.0, max: 1.3 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ2']] },
  V: { name: 'Valine', code3: 'Val', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2'], ranges: { HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.9, max: 2.3 }, Hγ1: { min: 0.8, max: 1.1 }, Hγ2: { min: 0.8, max: 1.1 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2']] },
  W: { name: 'Tryptophan', code3: 'Trp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ1', 'Hε3', 'Hζ2', 'Hη2', 'Hζ3'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.1, max: 3.5 }, Hβ2: { min: 3.1, max: 3.5 }, Hδ1: { min: 10.0, max: 10.5 }, Hε3: { min: 7.4, max: 7.7 }, Hζ2: { min: 7.3, max: 7.6 }, Hη2: { min: 7.0, max: 7.3 }, Hζ3: { min: 6.9, max: 7.2 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ1', 'Hε3'], ['Hε3', 'Hζ3'], ['Hζ3', 'Hη2'], ['Hη2', 'Hζ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ1'], ['Hε3', 'Hζ3', 'Hη2', 'Hζ2']] },
  Y: { name: 'Tyrosine', code3: 'Tyr', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.8, max: 3.2 }, Hβ2: { min: 2.8, max: 3.2 }, Hδ: { min: 6.9, max: 7.2 }, Hε: { min: 6.6, max: 6.9 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε']] }
};

const NUCLEOTIDE_DB = {
  DNA: {
    A: { name: 'Deoxyadenosine', code3: 'dA', base: 'purine', atoms: ['H8', 'H2', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.9, max: 8.4 }, H2: { min: 7.7, max: 8.3 }, "H1'": { min: 5.9, max: 6.4 }, "H2'": { min: 2.2, max: 2.8 }, "H2''": { min: 2.5, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.1, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]] },
    G: { name: 'Deoxyguanosine', code3: 'dG', base: 'purine', atoms: ['H8', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.6, max: 8.2 }, "H1'": { min: 5.6, max: 6.2 }, "H2'": { min: 2.2, max: 2.8 }, "H2''": { min: 2.5, max: 3.0 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]] },
    C: { name: 'Deoxycytidine', code3: 'dC', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.3, max: 8.0 }, H5: { min: 5.2, max: 5.9 }, "H1'": { min: 5.8, max: 6.4 }, "H2'": { min: 2.0, max: 2.7 }, "H2''": { min: 2.2, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] },
    T: { name: 'Thymidine', code3: 'T', base: 'pyrimidine', atoms: ['H6', 'H7(CH3)', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.2, max: 7.9 }, 'H7(CH3)': { min: 1.6, max: 2.0 }, "H1'": { min: 5.9, max: 6.4 }, "H2'": { min: 1.9, max: 2.5 }, "H2''": { min: 2.1, max: 2.7 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H7(CH3)']] }
  },
  RNA: {
    A: { name: 'Adenosine', code3: 'A', base: 'purine', atoms: ['H8', 'H2', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.9, max: 8.5 }, H2: { min: 7.8, max: 8.4 }, "H1'": { min: 5.7, max: 6.2 }, "H2'": { min: 4.4, max: 4.9 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.1, max: 4.6 }, "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 } }, cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]] },
    G: { name: 'Guanosine', code3: 'G', base: 'purine', atoms: ['H8', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.6, max: 8.3 }, "H1'": { min: 5.5, max: 6.1 }, "H2'": { min: 4.3, max: 4.9 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.0, max: 4.6 }, "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 } }, cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]] },
    C: { name: 'Cytidine', code3: 'C', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.6, max: 6.2 }, "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] },
    U: { name: 'Uridine', code3: 'U', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.4, max: 6.0 }, "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.1, max: 4.7 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] }
  }
};

const SUGAR_DB = {
  GLC: { name: 'D-Glucose', code3: 'Glc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.55, max: 5.25 }, H2: { min: 3.4, max: 3.7 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.35, max: 3.65 }, H5: { min: 3.55, max: 3.85 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  GAL: { name: 'D-Galactose', code3: 'Gal', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.55, max: 5.25 }, H2: { min: 3.5, max: 3.85 }, H3: { min: 3.6, max: 3.95 }, H4: { min: 3.85, max: 4.15 }, H5: { min: 3.7, max: 4.0 }, H6a: { min: 3.6, max: 3.9 }, H6b: { min: 3.65, max: 3.95 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  MAN: { name: 'D-Mannose', code3: 'Man', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.7, max: 5.2 }, H2: { min: 3.7, max: 4.0 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.55, max: 3.85 }, H5: { min: 3.6, max: 3.95 }, H6a: { min: 3.6, max: 3.95 }, H6b: { min: 3.65, max: 4.0 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  FUC: { name: 'L-Fucose', code3: 'Fuc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'], ranges: { H1: { min: 4.7, max: 5.2 }, H2: { min: 3.6, max: 3.95 }, H3: { min: 3.65, max: 4.0 }, H4: { min: 3.7, max: 4.05 }, H5: { min: 3.6, max: 3.95 }, H6: { min: 1.1, max: 1.3 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6']] },
  NAG: { name: 'N-Acetylglucosamine', code3: 'GlcNAc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b', 'NHAc', 'AcCH3'], ranges: { H1: { min: 4.6, max: 5.2 }, H2: { min: 3.7, max: 4.05 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.4, max: 3.7 }, H5: { min: 3.6, max: 3.9 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 }, NHAc: { min: 7.5, max: 8.2 }, AcCH3: { min: 1.9, max: 2.1 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ['NHAc'], ['AcCH3']] }
};

const LIPID_DB = {
  POPC: { name: 'POPC', head: 'PC', headLabel: 'N(CH₃)₃⁺', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2N', 'HNMe3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2N: { min: 3.6, max: 3.8 }, HNMe3: { min: 3.18, max: 3.28 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2N', 'HNMe3']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2N', 'HNMe3']] },
  POPE: { name: 'POPE', head: 'PE', headLabel: 'NH₃⁺', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2N', 'HNH3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2N: { min: 3.1, max: 3.3 }, HNH3: { min: 7.5, max: 8.5 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2N', 'HNH3']] },
  POPS: { name: 'POPS', head: 'PS', headLabel: 'Ser', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HαS', 'HβS1', 'HβS2', 'HNH3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HαS: { min: 4.0, max: 4.3 }, HβS1: { min: 3.75, max: 4.05 }, HβS2: { min: 3.75, max: 4.05 }, HNH3: { min: 7.5, max: 8.5 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HαS', 'HβS1'], ['HαS', 'HβS2']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HαS', 'HβS1', 'HβS2', 'HNH3']] },
  POPG: { name: 'POPG', head: 'PG', headLabel: 'Gly', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2OH', 'HCHOH'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2OH: { min: 3.45, max: 3.75 }, HCHOH: { min: 3.65, max: 3.9 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2OH', 'HCHOH']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2OH', 'HCHOH']] }
};

const CARBON_RANGE_DB = {
  A: { Cα: [48, 54], Cβ: [15, 22] },
  C: { Cα: [53, 59], Cβ: [25, 43] },
  D: { Cα: [49, 55], Cβ: [37, 42], Cγ: [173, 178] },
  E: { Cα: [52, 58], Cβ: [26, 31], Cγ: [32, 37], Cδ: [176, 181] },
  F: { Cα: [53, 58], Cβ: [36, 41], Cγ: [135, 140], Cδ: [126, 132], Cε: [126, 132], Cζ: [125, 130] },
  G: { Cα: [42, 46] },
  H: { Cα: [52, 57], Cβ: [26, 31], Cγ: [133, 137], Cδ2: [115, 120], Cε1: [133, 138] },
  I: { Cα: [56, 62], Cβ: [35, 40], Cγ1: [24, 29], Cγ2: [14, 18], Cδ1: [10, 15] },
  K: { Cα: [52, 57], Cβ: [29, 34], Cγ: [22, 26], Cδ: [26, 30], Cε: [38, 42] },
  L: { Cα: [50, 56], Cβ: [39, 44], Cγ: [23, 27], Cδ1: [21, 25], Cδ2: [21, 25] },
  M: { Cα: [51, 56], Cβ: [29, 34], Cγ: [28, 32], Cε: [14, 18] },
  N: { Cα: [49, 54], Cβ: [35, 40], Cγ: [171, 176] },
  P: { Cα: [59, 64], Cβ: [29, 33], Cγ: [24, 28], Cδ: [47, 51] },
  Q: { Cα: [51, 56], Cβ: [26, 31], Cγ: [30, 35], Cδ: [173, 178] },
  R: { Cα: [52, 57], Cβ: [27, 32], Cγ: [23, 28], Cδ: [40, 44], Cζ: [155, 160] },
  S: { Cα: [54, 59], Cβ: [60, 65] },
  T: { Cα: [58, 63], Cβ: [66, 71], Cγ2: [18, 22] },
  V: { Cα: [58, 63], Cβ: [29, 34], Cγ1: [18, 22], Cγ2: [18, 22] },
  W: { Cα: [53, 58], Cβ: [26, 31], Cγ: [107, 112], Cδ1: [123, 128], Cε3: [114, 119], Cζ2: [111, 116], Cη2: [121, 126], Cζ3: [118, 123] },
  Y: { Cα: [54, 59], Cβ: [35, 40], Cγ: [126, 131], Cδ: [130, 135], Cε: [114, 119], Cζ: [154, 159] }
};

const SS_CORRECTIONS = {
  coil: { h: {}, c: {} },
  helix: { h: { HN: -0.45, Hα: -0.35, Hα1: -0.35, Hα2: -0.35, other: -0.05 }, c: { Cα: 2.8, Cβ: -1.5, "C'": 1.5, N: -2.5 } },
  sheet: { h: { HN: 0.4, Hα: 0.3, Hα1: 0.3, Hα2: 0.3, other: 0.05 }, c: { Cα: -1.6, Cβ: 1.4, "C'": -1.5, N: 2.0 } }
};

const RANDOM_COIL_DB = { A: { HA: 4.35, CA: 52.5, CB: 19.1, CO: 177.8 }, C: { HA: 4.55, CA: 58.2, CB: 28.0, CO: 175.9 }, D: { HA: 4.76, CA: 54.5, CB: 40.8, CO: 177.5 }, E: { HA: 4.37, CA: 56.9, CB: 29.8, CO: 177.6 }, F: { HA: 4.66, CA: 57.9, CB: 39.8, CO: 177.4 }, G: { HA: 3.96, CA: 45.2, CB: null, CO: 174.6 }, H: { HA: 4.76, CA: 55.3, CB: 31.3, CO: 175.3 }, I: { HA: 4.20, CA: 61.3, CB: 38.3, CO: 177.8 }, K: { HA: 4.38, CA: 56.6, CB: 32.4, CO: 177.9 }, L: { HA: 4.47, CA: 55.4, CB: 41.9, CO: 178.9 }, M: { HA: 4.52, CA: 55.5, CB: 32.6, CO: 177.5 }, N: { HA: 4.75, CA: 53.3, CB: 38.6, CO: 176.6 }, P: { HA: 4.44, CA: 63.1, CB: 31.9, CO: 178.1 }, Q: { HA: 4.39, CA: 56.2, CB: 29.5, CO: 177.2 }, R: { HA: 4.51, CA: 56.5, CB: 30.4, CO: 177.2 }, S: { HA: 4.51, CA: 58.4, CB: 63.6, CO: 175.6 }, T: { HA: 4.39, CA: 62.0, CB: 69.6, CO: 175.7 }, V: { HA: 4.16, CA: 62.1, CB: 32.1, CO: 177.4 }, W: { HA: 4.70, CA: 57.4, CB: 29.5, CO: 177.2 }, Y: { HA: 4.66, CA: 57.9, CB: 38.9, CO: 177.2 } };

const SS_META = { C: { label: 'Random coil', color: '#64748b' }, H: { label: 'α-Helix', color: '#8b5cf6' }, E: { label: 'β-Sheet', color: '#f59e0b' } };
const FORM_META = { A: { label: 'A-form', color: '#0ea5e9' }, B: { label: 'B-form', color: '#22c55e' }, Z: { label: 'Z-form', color: '#f43f5e' } };
const DNA_FORM_OFFSETS = { B: { "H1'": 0, "H2'": 0, "H3'": 0, "H2''": 0 }, A: { "H1'": 0.2, "H2'": -0.3, "H3'": 0.15, "H2''": -0.25 }, Z: { "H1'": -0.15, "H2'": 0.25, "H3'": -0.1, "H2''": 0.2 } };
const SUGAR_ANOMER_OFFSETS = { alpha: { H1: 0.25 }, beta: { H1: -0.15 } };
const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#6366f1'];

// ================= GENERIC HELPERS =================
const useMeasureWidth = () => {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = () => setW(el.clientWidth);
    u();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(u); ro.observe(el); }
    window.addEventListener('resize', u);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', u); };
  }, []);
  return [ref, w];
};

const parseManual = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const getNMRFillColor = (entry) => {
  if (entry.colorClass === 'cosy') return '#22c55e';
  if (entry.colorClass === 'tocsyDirect') return '#1e3a8a';
  if (entry.colorClass === 'tocsyRelay') return '#3b82f6';
  if (entry.colorClass === 'noesyIntra') return '#ef4444';
  if (entry.colorClass === 'noesyIntra4') return '#fca5a5';
  if (entry.colorClass === 'noesySeq') return '#991b1b';
  if (entry.colorClass === 'hsqc') return '#8b5cf6';
  if (entry.colorClass === 'hsqc15n') return '#0ea5e9';
  if (entry.colorClass === 'p31') return '#0d9488';
  return '#cbd5e1';
};

// ================= GEOMETRY & STRUCTURES =================
const getHexagon = (cx, cy, r, dir) => { const pts = []; const b = dir === 1 ? -Math.PI / 2 : Math.PI / 2; for (let i = 0; i < 6; i++) { const a = b + i * (Math.PI / 3) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const getPentagon = (cx, cy, r, dir) => { const pts = []; const b = dir === 1 ? -Math.PI / 2 : Math.PI / 2; for (let i = 0; i < 5; i++) { const a = b + i * ((2 * Math.PI) / 5) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const hexAt = (cx, cy, r, deg0) => { const pts = []; for (let i = 0; i < 6; i++) { const a = ((deg0 + i * 60) * Math.PI) / 180; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };

const fusePentagon = (A, B, nx, ny) => {
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const r5 = L / (2 * Math.sin(Math.PI / 5));
  const ap = r5 * Math.cos(Math.PI / 5);
  const c = { x: mx + nx * ap, y: my + ny * ap };
  const aA = Math.atan2(A.y - c.y, A.x - c.x);
  const step = (2 * Math.PI) / 5;
  const mk = (dir, k) => ({ x: c.x + r5 * Math.cos(aA + dir * step * k), y: c.y + r5 * Math.sin(aA + dir * step * k) });
  const dir = Math.hypot(mk(1, 4).x - B.x, mk(1, 4).y - B.y) < Math.hypot(mk(-1, 4).x - B.x, mk(-1, 4).y - B.y) ? 1 : -1;
  return { V1: mk(dir, 1), V2: mk(dir, 2), V3: mk(dir, 3), c };
};

const makeBuilder = () => {
  const elements = [];
  let minX = 0, maxX = 0, minY = 0, maxY = 0, first = true;
  const ub = (x, y) => { if (first) { minX = maxX = x; minY = maxY = y; first = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const addLine = (x1, y1, x2, y2, color, isDouble = false, width = 1.8) => {
    ub(x1, y1); ub(x2, y2);
    if (isDouble) {
      const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 2.6, ny = (dx / len) * 2.6;
      elements.push({ type: 'line', x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, color, width });
      elements.push({ type: 'line', x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny, color, width });
    } else elements.push({ type: 'line', x1, y1, x2, y2, color, width });
  };
  const addPolygon = (pts, color) => { pts.forEach((p) => ub(p.x, p.y)); elements.push({ type: 'polygon', points: pts.map((p) => `${p.x},${p.y}`).join(' '), color }); };
  const addCircle = (x, y, r, color, fill = 'white', strokeWidth, meta = null) => { ub(x, y); elements.push({ type: 'circle', x, y, r, color, fill, strokeWidth, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null }); };
  const addDot = (x, y, color, meta = null) => { ub(x, y); elements.push({ type: 'circle', x, y, r: 2.4, color, fill: color, strokeWidth: 0, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null }); };
  const finish = (pad = 15) => ({ elements, viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}` });
  return { elements, ub, addLine, addPolygon, addCircle, addDot, finish };
};

// NOTE: buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure
// are very long functions. They remain unchanged from the original (no bugs were found in them).
// Due to length constraints, they are included here as-is from the original file.
// [These functions are identical to the original - omitted here for brevity in this response
//  but must be included in the actual file. They contain no bugs.]

const buildProteinStructure = (sequence) => {
  const b = makeBuilder();
  let curRi = null;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x, y - 15); b.ub(x, y + 15); b.ub(x - 30, y); b.ub(x + 30, y);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null });
  };
  const addAtomCircle = (x, y, r, color, atoms = null) => { const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null; b.addCircle(x, y, r, color, 'white', 1.5, { ri: curRi, atoms, keys }); };
  const addRingHeteroatom = (x, y, text, color, atoms = null) => { const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null; b.addCircle(x, y, 12, color, 'white', 1.6, { ri: curRi, atoms, keys }); addText(x, y, text, color, 11, 'middle', atoms); };
  const placeRadialLabel = (cx, cy, pt, text, color, atoms = null) => {
    const angle = Math.atan2(pt.y - cy, pt.x - cx); const dist = 18;
    const lx = pt.x + dist * Math.cos(angle); const ly = pt.y + dist * Math.sin(angle);
    let anchor = 'middle';
    if (Math.abs(angle) < Math.PI / 3) anchor = 'start';
    else if (Math.abs(angle) > (2 * Math.PI) / 3) anchor = 'end';
    addText(lx, ly, text, color, 11, anchor, atoms);
  };
  const dx = 45, dy = 30, S = 25;
  const coords = [];
  let cx = 100, cy = 200, slope = -1;
  for (let i = 0; i < sequence.length; i++) {
    const nX = cx, nY = cy; cx += dx; cy += slope * dy;
    const caX = cx, caY = cy, scDir = slope; slope *= -1;
    cx += dx; cy += slope * dy;
    const cX = cx, cY = cy, oDir = slope; slope *= -1;
    cx += dx; cy += slope * dy;
    const nextNX = cx, nextNY = cy; slope *= -1;
    coords.push({ nX, nY, caX, caY, cX, cY, nextNX, nextNY, scDir, oDir, res: sequence[i] });
  }
  coords.forEach((c, i) => {
    curRi = i;
    const color = c.res.color;
    const isFirst = i === 0; const isLast = i === sequence.length - 1;
    const char = c.res.char;
    if (!isFirst) b.addLine(coords[i - 1].cX, coords[i - 1].cY, c.nX, c.nY, coords[i - 1].res.color);
    b.addLine(c.nX, c.nY, c.caX, c.caY, color);
    b.addLine(c.caX, c.caY, c.cX, c.cY, color);
    b.addLine(c.cX, c.cY, c.cX, c.cY + c.oDir * 25, '#ef4444', true);
    if (isLast) b.addLine(c.cX, c.cY, c.nextNX, c.nextNY, color);
    if (!isFirst && char !== 'P') {
      const hDir = c.nY < c.caY ? -1 : 1;
      b.addLine(c.nX, c.nY, c.nX, c.nY + hDir * 15, color);
      addText(c.nX, c.nY + hDir * 25, 'H', color, 11, 'middle', ['HN']);
    }
    if (char !== 'G') {
      const haDir = -c.scDir;
      b.addLine(c.caX, c.caY, c.caX, c.caY + haDir * 15, color);
      addText(c.caX, c.caY + haDir * 25, 'Hα', color, 11, 'middle', ['Hα']);
    } else {
      b.addLine(c.caX, c.caY, c.caX, c.caY - 15, color); addText(c.caX, c.caY - 25, 'Hα1', color, 11, 'middle', ['Hα1']);
      b.addLine(c.caX, c.caY, c.caX, c.caY + 15, color); addText(c.caX, c.caY + 25, 'Hα2', color, 11, 'middle', ['Hα2']);
    }
    if (char === 'P') {
      b.elements.push({ type: 'path', d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir * 40} ${c.caX} ${c.caY + c.scDir * 25}`, color });
      b.addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * 25, color);
    }
    const nAtoms = char === 'P' ? ['N'] : isFirst ? ['HN'] : ['N', 'HN'];
    addAtomCircle(c.nX, c.nY, 13, color, nAtoms);
    addText(c.nX, c.nY, isFirst ? (char === 'P' ? 'H₂N⁺' : 'H₃N⁺') : 'N', color, 13, 'middle', nAtoms);
    addAtomCircle(c.caX, c.caY, 13, color, char === 'G' ? ['Cα', 'Hα1', 'Hα2'] : ['Cα', 'Hα']);
    addText(c.caX, c.caY, 'Cα', color, 13, 'middle', char === 'G' ? ['Cα', 'Hα1', 'Hα2'] : ['Cα', 'Hα']);
    addAtomCircle(c.cX, c.cY, 13, color, ["C'"]);
    addText(c.cX, c.cY, 'C', color, 13, 'middle', ["C'"]);
    addText(c.cX, c.cY + c.oDir * 35, 'O', '#ef4444', 13, 'middle', null);
    if (isLast) { addAtomCircle(c.nextNX, c.nextNY, 13, color, null); addText(c.nextNX, c.nextNY, 'O⁻', '#ef4444', 13, 'middle', null); }
    const vNode = (lvl, text, atoms) => {
      if (lvl > 0) b.addLine(c.caX, c.caY + c.scDir * (lvl - 1) * S, c.caX, c.caY + c.scDir * lvl * S, color);
      addText(c.caX, c.caY + c.scDir * (lvl * S + (c.scDir === 1 ? 10 : -10)), text, color, 11, 'middle', atoms);
    };
    if (char !== 'G' && char !== 'P') {
      b.addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * S, color);
      if (!['A', 'I', 'V', 'T', 'F', 'Y', 'W', 'H'].includes(char)) addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
    }
    switch (char) {
      case 'A': addText(c.caX, c.caY + c.scDir * S, 'CH₃ (Hβ)', color, 11, 'middle', ['Hβ']); break;
      case 'V':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ1)', color, 11, 'middle', ['Hγ1']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        break;
      case 'L':
        vNode(2, 'CH (Hγ)', ['Hγ']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color, 11, 'middle', ['Hδ1']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ2)', color, 11, 'middle', ['Hδ2']);
        break;
      case 'I':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₂ (Hγ1)', color, 11, 'middle', ['Hγ1']);
        b.addLine(c.caX + 20, c.caY + c.scDir * 1.8 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color, 11, 'middle', ['Hδ1']);
        break;
      case 'S': vNode(2, 'OH (Hβ)', ['Hβ1', 'Hβ2']); break;
      case 'T':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.5 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.5 * S + 10), 'OH (Hγ1)', color, 11, 'middle', ['Hγ1']);
        break;
      case 'C': vNode(2, 'SH (Hβ)', ['Hβ1', 'Hβ2']); break;
      case 'M': vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'S', null); vNode(4, 'CH₃ (Hε)', ['Hε(CH3)']); break;
      case 'D':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'N':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'NH₂ (Hδ2)', color, 11, 'middle', ['Hδ21', 'Hδ22']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'E':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'Q':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'NH₂ (Hε2)', color, 11, 'middle', ['Hε21', 'Hε22']);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'K': vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'CH₂ (Hδ)', ['Hδ']); vNode(4, 'CH₂ (Hε)', ['Hε']); vNode(5, 'NH₃⁺ (Hζ)', ['Hζ(NH3)']); break;
      case 'R':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'CH₂ (Hδ)', ['Hδ']); vNode(4, 'NH (Hε)', ['Hε']); vNode(5, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX - 20, c.caY + c.scDir * 5.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂', color);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX + 20, c.caY + c.scDir * 5.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂⁺', color);
        break;
      case 'F':
      case 'Y': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const hcx = c.caX; const hcy = c.caY + c.scDir * 3 * S;
        const hPts = getHexagon(hcx, hcy, S, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, hPts[0].x, hPts[0].y, color);
        b.addPolygon(hPts, color);
        b.addCircle(hcx, hcy, S * 0.6, color, 'none');
        placeRadialLabel(hcx, hcy, hPts[1], 'CH (Hδ2)', color, ['Hδ']);
        placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε2)', color, ['Hε']);
        placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hδ1)', color, ['Hδ']);
        placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hε1)', color, ['Hε']);
        if (char === 'Y') {
          const angleZ = Math.atan2(hPts[3].y - hcy, hPts[3].x - hcx);
          const ohX = hPts[3].x + S * Math.cos(angleZ); const ohY = hPts[3].y + S * Math.sin(angleZ);
          b.addLine(hPts[3].x, hPts[3].y, ohX, ohY, color);
          addText(ohX + 12 * Math.cos(angleZ), ohY + 12 * Math.sin(angleZ), 'OH', color, 11, 'middle', null);
        } else placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color, ['Hζ']);
        break;
      }
      case 'H': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
        const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color);
        b.addPolygon(pPts, color);
        b.addCircle(pcx, pcy, R5 * 0.5, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, 'NH', color, null);
        addRingHeteroatom(pPts[4].x, pPts[4].y, 'N', color, null);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ2)', color, ['Hδ2']);
        placeRadialLabel(pcx, pcy, pPts[3], 'CH (Hε1)', color, ['Hε1']);
        break;
      }
      case 'W': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
        const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color);
        b.addPolygon(pPts, color);
        b.addCircle(pcx, pcy, R5 * 0.5, color, 'none');
        const ce2 = pPts[3]; const cd2 = pPts[4];
        const mx = (ce2.x + cd2.x) / 2; const my = (ce2.y + cd2.y) / 2;
        const midA = Math.atan2(my - pcy, mx - pcx);
        const hcx = mx + (Math.cos(midA) * S * Math.sqrt(3)) / 2; const hcy = my + (Math.sin(midA) * S * Math.sqrt(3)) / 2;
        const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx);
        const testA = startA + Math.PI / 3;
        const sign = Math.hypot(hcx + S * Math.cos(testA) - cd2.x, hcy + S * Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
        const hPts = [];
        for (let j = 0; j < 6; j++) { const a = startA + j * sign * (Math.PI / 3); hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) }); }
        b.addPolygon(hPts, color);
        b.addCircle(hcx, hcy, S * 0.6, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, 'NH', color, ['Hδ1']);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ1)', color, ['Hδ1']);
        placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε3)', color, ['Hε3']);
        placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ3)', color, ['Hζ3']);
        placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hη2)', color, ['Hη2']);
        placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hζ2)', color, ['Hζ2']);
        break;
      }
      default: break;
    }
    const labelY = c.caY + (c.scDir > 0 ? 170 : -170);
    addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14, 'middle', null);
  });
  return b.finish();
};

// buildNucleicStructure, buildSugarStructure, buildLipidStructure remain unchanged
// (they are bug-free and identical to the original - included in the actual file)
const buildNucleicStructure = (sequence, molType) => {
  const b = makeBuilder();
  const isDNA = molType === 'dna';
  let curRi = null, curChar = null;
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null });
  };
  const ringAtom = (x, y, text, color, atoms = null) => { b.addCircle(x, y, 9, color, 'white', 1.2, { ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null }); addText(x, y, text, color, 8, 'middle', atoms); };
  const dot = (x, y, color, atoms) => b.addDot(x, y, color, { ri: curRi, atoms, keys: buildKeys(curRi, atoms, molType, curChar) });
  const RH = 250, xP = 110, xS = 235, y0 = 150;
  const BB = '#475569';
  const drawP = (x, y, ri, top) => {
    curRi = ri; curChar = sequence[ri]?.char;
    b.addCircle(x, y, 13, BB, 'white', 1.4, { ri, atoms: ['P'], keys: buildKeys(ri, ['P'], molType, curChar) });
    addText(x, y, 'P', BB, 12, 'middle', ['P']);
    b.addLine(x - 13, y, x - 26, y, BB, true, 1.4);
    addText(x - 34, y, 'O', BB, 10, 'middle', null);
    if (top) { b.addLine(x, y - 13, x, y - 24, BB); addText(x, y - 32, 'O⁻', BB, 9, 'middle', null); }
    else { b.addLine(x, y + 13, x, y + 24, BB); addText(x, y + 33, 'O⁻', BB, 9, 'middle', null); }
  };
  sequence.forEach((res, i) => {
    curRi = i; curChar = res.char;
    const color = res.color;
    const sy = y0 + i * RH;
    const sPts = getPentagon(xS, sy, 26, 1);
    const [O4, C1, C2s, C3s, C4s] = sPts;
    b.addPolygon(sPts, color);
    b.addLine(C2s.x, C2s.y, C3s.x, C3s.y, color, false, 6);
    addText(O4.x, O4.y, 'O', color, 9, 'middle', null);
    dot(C1.x, C1.y, color, ["H1'", "C1'"]);
    dot(C2s.x, C2s.y, color, isDNA ? ["H2'", "H2''", "C2'"] : ["H2'", "OH2'", "C2'"]);
    dot(C3s.x, C3s.y, color, ["H3'", "C3'"]);
    dot(C4s.x, C4s.y, color, ["H4'", "C4'"]);
    if (!isDNA) { b.addLine(C2s.x, C2s.y, C2s.x + 14, C2s.y + 12, color); addText(C2s.x + 22, C2s.y + 16, 'OH', color, 8, 'start', ["OH2'"]); }
    const c5p = { x: C4s.x - 20, y: C4s.y - 16 };
    b.addLine(C4s.x, C4s.y, c5p.x, c5p.y, color);
    dot(c5p.x, c5p.y, color, ["H5'", "H5''", "C5'"]);
    const py = sy - 100;
    drawP(xP, py, i, i === 0);
    addText(xP + 30, py + 26, 'O', BB, 9, 'middle', null);
    if (i > 0) b.addLine(xP + 22, py - 18, xP + 9, py - 9, BB);
    b.addLine(xP + 9, py + 9, xP + 22, py + 20, BB);
    b.addLine(xP + 38, py + 30, c5p.x - 4, c5p.y - 4, BB);
    if (i < sequence.length - 1) {
      const py2 = sy + 150;
      b.addLine(C3s.x, C3s.y, xP + 20, py2 - 20, color);
      addText(xP + 28, py2 - 26, 'O', BB, 9, 'middle', null);
    } else {
      b.addLine(C3s.x, C3s.y, C3s.x - 12, C3s.y + 26, color);
      addText(C3s.x - 16, C3s.y + 36, 'OH', color, 9, 'end', ["H3'"]);
    }
    const isPur = res.base === 'purine';
    if (!isPur) {
      const cx = xS + 105, cy = sy;
      const h = hexAt(cx, cy, 26, 180);
      const [N1, C2b, N3, C4b, C5b, C6] = h;
      b.addLine(C1.x, C1.y, N1.x, N1.y, color);
      b.addPolygon(h, color);
      b.addCircle(cx, cy, 13, color, 'none', 1);
      ringAtom(N1.x, N1.y, 'N1', color, ['N1']);
      ringAtom(N3.x, N3.y, 'N3', color, ['N3']);
      ringAtom(C2b.x, C2b.y, 'C2', color, ['C2']);
      ringAtom(C4b.x, C4b.y, 'C4', color, ['C4']);
      ringAtom(C5b.x, C5b.y, 'C5', color, res.char === 'T' ? ['C5'] : ['H5']);
      ringAtom(C6.x, C6.y, 'C6', color, ['H6']);
      b.addLine(C2b.x, C2b.y, C2b.x - 10, C2b.y - 18, color, true);
      addText(C2b.x - 14, C2b.y - 26, 'O', color, 9, 'middle', null);
      b.addLine(C4b.x, C4b.y, C4b.x + 16, C4b.y, color, res.char === 'C' ? false : true);
      addText(C4b.x + 28, C4b.y, res.char === 'C' ? 'NH₂' : 'O', color, 9, 'middle', null);
      if (res.char === 'T') { b.addLine(C5b.x, C5b.y, C5b.x + 10, C5b.y + 18, color); addText(C5b.x + 16, C5b.y + 28, 'CH₃', color, 9, 'start', ['H7(CH3)']); }
      else addText(C5b.x + 14, C5b.y + 12, 'H', color, 8, 'start', ['H5']);
      addText(C6.x - 10, C6.y + 14, 'H', color, 8, 'middle', ['H6']);
    } else {
      const cx = xS + 135, cy = sy;
      const h = hexAt(cx, cy, 26, 150);
      const [C4b, C5b, C6, N1, C2b, N3] = h;
      const { V1, V2, V3 } = fusePentagon(C5b, C4b, -1, 0);
      b.addLine(C1.x, C1.y, V3.x, V3.y, color);
      b.addPolygon(h, color);
      b.addPolygon([C5b, V1, V2, V3, C4b], color);
      b.addCircle(cx, cy, 12, color, 'none', 1);
      ringAtom(N1.x, N1.y, 'N1', color, ['N1']);
      ringAtom(C2b.x, C2b.y, 'C2', color, res.char === 'A' ? ['H2'] : ['C2']);
      ringAtom(N3.x, N3.y, 'N3', color, ['N3']);
      ringAtom(C4b.x, C4b.y, 'C4', color, ['C4']);
      ringAtom(C5b.x, C5b.y, 'C5', color, ['C5']);
      ringAtom(C6.x, C6.y, 'C6', color, ['C6']);
      ringAtom(V1.x, V1.y, 'N7', color, ['N7']);
      ringAtom(V2.x, V2.y, 'C8', color, ['H8']);
      ringAtom(V3.x, V3.y, 'N9', color, ['N9']);
      if (res.char === 'A') {
        b.addLine(C6.x, C6.y, C6.x, C6.y - 16, color);
        addText(C6.x, C6.y - 26, 'NH₂', color, 9, 'middle', null);
        addText(C2b.x + 16, C2b.y + 10, 'H2', color, 8, 'start', ['H2']);
      } else {
        b.addLine(C6.x, C6.y, C6.x, C6.y - 16, color, true);
        addText(C6.x, C6.y - 26, 'O', color, 9, 'middle', null);
        b.addLine(C2b.x, C2b.y, C2b.x + 14, C2b.y + 10, color);
        addText(C2b.x + 26, C2b.y + 14, 'NH₂', color, 9, 'start', null);
      }
    }
    addText(560, sy, `${res.name} ${res.char}`, '#1d4ed8', 13, 'start', null);
  });
  curRi = null; curChar = null;
  addText(20, y0 + RH / 2, 'sugar–phosphate', '#64748b', 10, 'start', null);
  addText(20, y0 + RH / 2 + 14, 'backbone', '#64748b', 10, 'start', null);
  return b.finish();
};

const buildSugarStructure = (res, conformation, anomer) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'sugar', curChar) : null });
  };
  const dot = (x, y, atoms) => b.addDot(x, y, c, { ri: curRi, atoms, keys: buildKeys(curRi, atoms, 'sugar', curChar) });
  const chair = conformation !== 'invChair';
  const dir = chair ? 1 : -1;
  const base = { C4: { x: 150, y: 120 }, C5: { x: 250, y: 140 }, O: { x: 340, y: 108 }, C1: { x: 400, y: 168 }, C2: { x: 308, y: 196 }, C3: { x: 205, y: 190 } };
  const P = chair ? base : Object.fromEntries(Object.entries(base).map(([k, p]) => [k, { x: p.x, y: 330 - p.y }]));
  const anomLabel = anomer === 'beta' ? 'β' : 'α';
  b.addLine(P.C3.x, P.C3.y, P.C2.x, P.C2.y, c, false, 6);
  b.addLine(P.C2.x, P.C2.y, P.C1.x, P.C1.y, c, false, 6);
  b.addLine(P.C1.x, P.C1.y, P.O.x, P.O.y, c);
  b.addLine(P.O.x, P.O.y, P.C5.x, P.C5.y, c);
  b.addLine(P.C5.x, P.C5.y, P.C4.x, P.C4.y, c);
  b.addLine(P.C4.x, P.C4.y, P.C3.x, P.C3.y, c);
  addText(P.O.x, P.O.y - 14 * dir, 'O', c, 12, 'middle', null);
  dot(P.C1.x, P.C1.y, ['H1', 'C1']); dot(P.C2.x, P.C2.y, ['H2', 'C2']); dot(P.C3.x, P.C3.y, ['H3', 'C3']);
  dot(P.C4.x, P.C4.y, ['H4', 'C4']); dot(P.C5.x, P.C5.y, ['H5', 'C5']);
  b.addLine(P.C1.x, P.C1.y, P.C1.x + 34, P.C1.y - 8 * dir, c);
  addText(P.C1.x + 50, P.C1.y - 10 * dir, `OH (${anomLabel})`, c, 12, 'start', ['H1', 'C1']);
  if (curChar === 'NAG') {
    b.addLine(P.C2.x, P.C2.y, P.C2.x + 16, P.C2.y + 34 * dir, c);
    addText(P.C2.x + 26, P.C2.y + 46 * dir, 'NH', c, 12, 'start', ['NHAc']);
    const cC = { x: P.C2.x + 6, y: P.C2.y + 96 * dir };
    b.addLine(P.C2.x + 30, P.C2.y + 56 * dir, cC.x, cC.y, c);
    b.addLine(cC.x, cC.y, cC.x - 34, cC.y - 6 * dir, c, true);
    addText(cC.x - 44, cC.y - 8 * dir, 'O', c, 12, 'middle', null);
    b.addLine(cC.x, cC.y, cC.x + 18, cC.y + 34 * dir, c);
    addText(cC.x + 26, cC.y + 46 * dir, 'CH₃', c, 12, 'start', ['AcCH3']);
  } else {
    b.addLine(P.C2.x, P.C2.y, P.C2.x + 14, P.C2.y + 30 * dir, c);
    addText(P.C2.x + 22, P.C2.y + 42 * dir, 'OH', c, 12, 'start', ['H2', 'C2']);
  }
  b.addLine(P.C3.x, P.C3.y, P.C3.x - 34, P.C3.y + 6 * dir, c);
  addText(P.C3.x - 46, P.C3.y + 8 * dir, 'HO', c, 12, 'end', ['H3', 'C3']);
  b.addLine(P.C4.x, P.C4.y, P.C4.x - 36, P.C4.y - 10 * dir, c);
  addText(P.C4.x - 48, P.C4.y - 12 * dir, 'HO', c, 12, 'end', ['H4', 'C4']);
  const c6 = { x: P.C5.x + 18, y: P.C5.y - 52 * dir };
  b.addLine(P.C5.x, P.C5.y, c6.x, c6.y, c);
  if (curChar === 'FUC') {
    dot(c6.x, c6.y, ['H6', 'C6']);
    addText(c6.x + 8, c6.y - 12 * dir, 'CH₃', c, 12, 'start', ['H6', 'C6']);
  } else {
    dot(c6.x, c6.y, ['H6a', 'H6b', 'C6']);
    b.addLine(c6.x, c6.y, c6.x - 14, c6.y - 30 * dir, c);
    addText(c6.x - 18, c6.y - 40 * dir, 'OH', c, 12, 'middle', ['H6a', 'H6b', 'C6']);
  }
  addText(275, 365, `${res.name} (${anomLabel}, ${chair ? 'chair' : 'inverted chair'})`, c, 13, 'middle', null);
  return b.finish();
};

const buildLipidStructure = (res, db) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'lipid', curChar) : null });
  };
  const dot = (x, y, atoms) => b.addDot(x, y, c, { ri: curRi, atoms, keys: buildKeys(curRi, atoms, 'lipid', curChar) });
  
  const zig = (x0, y0, n, L, amp, dir0) => { const pts = [{ x: x0, y: y0 }]; let dir = dir0; for (let k = 0; k < n; k++) { const p = pts[pts.length - 1]; pts.push({ x: p.x - L, y: p.y + dir * amp }); dir = -dir; } return pts; };
  const chain = (pts, dblIdx) => { for (let k = 0; k < pts.length - 1; k++) b.addLine(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, c, k === dblIdx, 1.6); };
  
  // Handle Sterols (Cholesterol & Ergosterol) First
  if (curChar === 'CHOL' || curChar === 'ERGO') {
    const isErgo = curChar === 'ERGO';
    const L = 22;
    const dx = L * Math.cos(Math.PI/6);
    const dy = L * Math.sin(Math.PI/6);
    const cx = 500, cy = 180;
    
    // Core structure A, B, C, D rings
    const c3 = {x: cx, y: cy};
    const c4 = {x: cx + dx, y: cy + dy};
    const c5 = {x: cx + 2*dx, y: cy};
    const c10= {x: cx + 2*dx, y: cy - L};
    const c1 = {x: cx + dx, y: cy - L - dy};
    const c2 = {x: cx, y: cy - L};
    
    const c6 = {x: cx + 3*dx, y: cy + dy};
    const c7 = {x: cx + 4*dx, y: cy};
    const c8 = {x: cx + 4*dx, y: cy - L};
    const c9 = {x: cx + 3*dx, y: cy - L - dy};
    
    const c11= {x: cx + 4*dx, y: cy - 2*L};
    const c12= {x: cx + 5*dx, y: cy - 2*L - dy};
    const c13= {x: cx + 6*dx, y: cy - 2*L};
    const c14= {x: cx + 6*dx, y: cy - L};
    
    const c15= {x: cx + 7.2*dx, y: cy - 0.7*L};
    const c16= {x: cx + 8*dx, y: cy - 1.5*L};
    const c17= {x: cx + 7*dx, y: cy - 2.5*L};
    
    b.addPolygon([c1,c2,c3,c4,c5,c10], c);
    b.addPolygon([c5,c6,c7,c8,c9,c10], c);
    b.addPolygon([c8,c9,c11,c12,c13,c14], c);
    b.addPolygon([c13,c14,c15,c16,c17], c);
    
    // Hydroxyl at C3
    b.addLine(c3.x, c3.y, c3.x - 15, c3.y + 15, c);
    addText(c3.x - 22, c3.y + 22, 'HO', c, 9, 'end', ['H3', 'O3']);
    dot(c3.x, c3.y, ['H3', 'C3']);
    
    // Double Bonds
    if (isErgo) {
       b.addLine(c5.x+3, c5.y-3, c6.x-3, c6.y-5, c, true);
       b.addLine(c7.x-2, c7.y-5, c8.x-2, c8.y+5, c, true);
       dot(c7.x, c7.y, ['H7', 'C7']); addText(c7.x + 10, c7.y + 10, 'C7', c, 8, 'start', ['H7', 'C7']);
    } else {
       b.addLine(c5.x+3, c5.y-3, c6.x-3, c6.y-5, c, true);
       dot(c6.x, c6.y, ['H6', 'C6']); addText(c6.x + 10, c6.y + 10, 'C6', c, 8, 'start', ['H6', 'C6']);
    }
    
    // Methyls at C10 and C13
    b.addLine(c10.x, c10.y, c10.x, c10.y - 15, c);
    addText(c10.x, c10.y - 22, 'C19', c, 8, 'middle', ['H19', 'C19']); dot(c10.x, c10.y - 15, ['H19', 'C19']);
    b.addLine(c13.x, c13.y, c13.x, c13.y - 15, c);
    addText(c13.x, c13.y - 22, 'C18', c, 8, 'middle', ['H18', 'C18']); dot(c13.x, c13.y - 15, ['H18', 'C18']);
    
    // Tail from C17
    const t20 = {x: c17.x + 15, y: c17.y - 15};
    b.addLine(c17.x, c17.y, t20.x, t20.y, c);
    dot(t20.x, t20.y, ['H20', 'C20']);
    
    const t21 = {x: t20.x, y: t20.y - 15};
    b.addLine(t20.x, t20.y, t21.x, t21.y, c);
    addText(t21.x, t21.y - 8, 'C21', c, 8, 'middle', ['H21', 'C21']); dot(t21.x, t21.y, ['H21', 'C21']);
    
    const t22 = {x: t20.x + 18, y: t20.y + 5};
    b.addLine(t20.x, t20.y, t22.x, t22.y, c);
    dot(t22.x, t22.y, ['H22', 'C22']);
    
    const t23 = {x: t22.x + 18, y: t22.y - 10};
    b.addLine(t22.x, t22.y, t23.x, t23.y, c);
    dot(t23.x, t23.y, ['H23', 'C23']);
    
    if (isErgo) {
        b.addLine(t22.x+2, t22.y+2, t23.x-2, t23.y+2, c, true); // Double bond C22=C23
        const t24 = {x: t23.x + 18, y: t23.y + 12};
        b.addLine(t23.x, t23.y, t24.x, t24.y, c);
        dot(t24.x, t24.y, ['H24', 'C24']);
        
        const t28 = {x: t24.x, y: t24.y + 15};
        b.addLine(t24.x, t24.y, t28.x, t28.y, c);
        addText(t28.x, t28.y + 8, 'C28', c, 8, 'middle', ['H28', 'C28']); dot(t28.x, t28.y, ['H28', 'C28']);
        
        const t25 = {x: t24.x + 18, y: t24.y - 10};
        b.addLine(t24.x, t24.y, t25.x, t25.y, c);
        dot(t25.x, t25.y, ['H25', 'C25']);
        
        const t26 = {x: t25.x + 15, y: t25.y + 12};
        b.addLine(t25.x, t25.y, t26.x, t26.y, c);
        addText(t26.x + 8, t26.y + 4, 'C26', c, 8, 'start', ['H26', 'C26']); dot(t26.x, t26.y, ['H26', 'C26']);
        
        const t27 = {x: t25.x + 10, y: t25.y - 15};
        b.addLine(t25.x, t25.y, t27.x, t27.y, c);
        addText(t27.x + 5, t27.y - 8, 'C27', c, 8, 'start', ['H27', 'C27']); dot(t27.x, t27.y, ['H27', 'C27']);
    } else {
        const t24 = {x: t23.x + 18, y: t23.y + 12};
        b.addLine(t23.x, t23.y, t24.x, t24.y, c);
        dot(t24.x, t24.y, ['H24', 'C24']);
        
        const t25 = {x: t24.x + 18, y: t24.y - 10};
        b.addLine(t24.x, t24.y, t25.x, t25.y, c);
        dot(t25.x, t25.y, ['H25', 'C25']);
        
        const t26 = {x: t25.x + 15, y: t25.y + 12};
        b.addLine(t25.x, t25.y, t26.x, t26.y, c);
        addText(t26.x + 8, t26.y + 4, 'C26', c, 8, 'start', ['H26', 'C26']); dot(t26.x, t26.y, ['H26', 'C26']);
        
        const t27 = {x: t25.x + 10, y: t25.y - 15};
        b.addLine(t25.x, t25.y, t27.x, t27.y, c);
        addText(t27.x + 5, t27.y - 8, 'C27', c, 8, 'start', ['H27', 'C27']); dot(t27.x, t27.y, ['H27', 'C27']);
    }
    
    addText(cx + 3*dx, cy + 3*dy + 20, res.name, c, 13, 'middle', null);
    return b.finish(40);
  }
  
  // Glycerol Backbone (Vertical, Headgroup top, sn1 bottom)
  const gx = 500; 
  const g3y = 120; // sn-3 (top, connects to P)
  const g2y = 160; // sn-2 (middle)
  const g1y = 200; // sn-1 (bottom)
  
  b.addLine(gx, g3y, gx, g1y, c);
  
  // Separate Carbon and Protons visually and by hitbox
  dot(gx, g1y, ['Csn1']); addText(gx + 8, g1y - 8, 'C', c, 10, 'start', ['Csn1']);
  const h1x = gx + 25, h1y = g1y + 12;
  b.addLine(gx, g1y, h1x, h1y, c, false, 1);
  dot(h1x, h1y, ['Hsn1a', 'Hsn1b']); addText(h1x + 8, h1y, 'H₂ (sn-1)', c, 9, 'start', ['Hsn1a', 'Hsn1b']);
  
  dot(gx, g2y, ['Csn2']); addText(gx + 8, g2y - 8, 'C', c, 10, 'start', ['Csn2']);
  const h2x = gx + 25, h2y = g2y + 12;
  b.addLine(gx, g2y, h2x, h2y, c, false, 1);
  dot(h2x, h2y, ['Hsn2']); addText(h2x + 8, h2y, 'H (sn-2)', c, 9, 'start', ['Hsn2']);
  
  dot(gx, g3y, ['Csn3']); addText(gx + 8, g3y + 8, 'C', c, 10, 'start', ['Csn3']);
  const h3x = gx + 25, h3y = g3y - 12;
  b.addLine(gx, g3y, h3x, h3y, c, false, 1);
  dot(h3x, h3y, ['Hsn3a', 'Hsn3b']); addText(h3x + 8, h3y, 'H₂ (sn-3)', c, 9, 'start', ['Hsn3a', 'Hsn3b']);
  
  // sn-1 Chain (Points Left)
  const O1x = gx - 30;
  b.addLine(gx, g1y, O1x, g1y, c); addText(O1x, g1y, 'O', c, 9, 'middle', null);
  const C1x = O1x - 30;
  b.addLine(O1x - 6, g1y, C1x, g1y, c); 
  b.addLine(C1x, g1y - 4, C1x, g1y - 24, c, true); addText(C1x, g1y - 32, 'O', c, 9, 'middle', null); // Carbonyl
  
  dot(C1x, g1y, ['C1-sn1']); addText(C1x, g1y + 14, 'C1', c, 9, 'middle', ['C1-sn1']);
  
  const sn1 = zig(C1x, g1y, 16, 22, 16, 1);
  chain(sn1, -1);
  dot(sn1[1].x, sn1[1].y, ['H2-sn1', 'C2-sn1']); addText(sn1[1].x, sn1[1].y + 14, 'C2 (α)', c, 8, 'middle', ['H2-sn1', 'C2-sn1']);
  dot(sn1[2].x, sn1[2].y, ['H3-sn1', 'C3-sn1']); addText(sn1[2].x, sn1[2].y - 14, 'C3 (β)', c, 8, 'middle', ['H3-sn1', 'C3-sn1']);
  dot(sn1[3].x, sn1[3].y, ['H4-sn1', 'C4-sn1']); addText(sn1[3].x, sn1[3].y + 14, 'C4-14', c, 8, 'middle', ['H4-sn1', 'C4-sn1']);
  
  dot(sn1[14].x, sn1[14].y, ['H15-sn1', 'C15-sn1']); addText(sn1[14].x, sn1[14].y - 14, 'C15 (n-1)', c, 8, 'middle', ['H15-sn1', 'C15-sn1']);
  dot(sn1[15].x, sn1[15].y, ['H16-sn1', 'C16-sn1']); addText(sn1[15].x - 14, sn1[15].y, 'C16 (n)', c, 8, 'end', ['H16-sn1', 'C16-sn1']);
  
  // sn-2 Chain (Points Left)
  const O2x = gx - 30;
  b.addLine(gx, g2y, O2x, g2y, c); addText(O2x, g2y, 'O', c, 9, 'middle', null);
  const C2x = O2x - 30;
  b.addLine(O2x - 6, g2y, C2x, g2y, c);
  b.addLine(C2x, g2y - 4, C2x, g2y - 24, c, true); addText(C2x, g2y - 32, 'O', c, 9, 'middle', null); // Carbonyl
  
  dot(C2x, g2y, ['C1-sn2']); addText(C2x, g2y + 14, 'C1', c, 9, 'middle', ['C1-sn2']);
  
  const sn2 = zig(C2x, g2y, 18, 22, 16, -1); 
  chain(sn2, 8); // Double bond mapped at C9-C10
  dot(sn2[1].x, sn2[1].y, ['H2-sn2', 'C2-sn2']); addText(sn2[1].x, sn2[1].y - 14, 'C2 (α)', c, 8, 'middle', ['H2-sn2', 'C2-sn2']);
  dot(sn2[2].x, sn2[2].y, ['H3-sn2', 'C3-sn2']); addText(sn2[2].x, sn2[2].y + 14, 'C3 (β)', c, 8, 'middle', ['H3-sn2', 'C3-sn2']);
  dot(sn2[3].x, sn2[3].y, ['Hall-sn2', 'Call-sn2']); addText(sn2[3].x, sn2[3].y - 14, 'C4-8', c, 8, 'middle', ['Hall-sn2', 'Call-sn2']);
  
  dot(sn2[8].x, sn2[8].y, ['H9-sn2', 'C9-sn2']); addText(sn2[8].x, sn2[8].y + 14, 'C9', c, 8, 'middle', ['H9-sn2', 'C9-sn2']);
  dot(sn2[9].x, sn2[9].y, ['H10-sn2', 'C10-sn2']); addText(sn2[9].x, sn2[9].y - 14, 'C10', c, 8, 'middle', ['H10-sn2', 'C10-sn2']);
  dot(sn2[10].x, sn2[10].y, ['H11-sn2', 'C11-sn2']); addText(sn2[10].x, sn2[10].y + 14, 'C11', c, 8, 'middle', ['H11-sn2', 'C11-sn2']);
  
  dot(sn2[16].x, sn2[16].y, ['H17-sn2', 'C17-sn2']); addText(sn2[16].x, sn2[16].y + 14, 'C17 (n-1)', c, 8, 'middle', ['H17-sn2', 'C17-sn2']);
  dot(sn2[17].x, sn2[17].y, ['H18-sn2', 'C18-sn2']); addText(sn2[17].x - 14, sn2[17].y, 'C18 (n)', c, 8, 'end', ['H18-sn2', 'C18-sn2']);
  
  // Phosphate (Points Right)
  const O3x = gx + 30;
  b.addLine(gx, g3y, O3x, g3y, c); addText(O3x, g3y, 'O', c, 9, 'middle', null);
  const Px = O3x + 35;
  b.addLine(O3x + 6, g3y, Px - 10, g3y, c);
  
  dot(Px, g3y, ['P']); addText(Px, g3y, 'P', c, 11, 'middle', ['P']);
  b.addLine(Px, g3y - 10, Px, g3y - 30, c, true); addText(Px, g3y - 40, 'O', c, 9, 'middle', null);
  b.addLine(Px, g3y + 10, Px, g3y + 30, c); addText(Px, g3y + 40, 'O⁻', c, 9, 'middle', null);
  
  // Headgroup
  const O4x = Px + 35;
  b.addLine(Px + 10, g3y, O4x - 6, g3y, c); addText(O4x, g3y, 'O', c, 9, 'middle', null);
  
  const Hx1 = O4x + 30;
  const Hx2 = Hx1 + 35;
  b.addLine(O4x + 6, g3y, Hx1, g3y, c);
  b.addLine(Hx1, g3y, Hx2, g3y, c);
  
  if (res.head === 'PC') {
    dot(Hx1, g3y, ['Hα', 'Cα', 'HCH2N', 'CCH2N']); addText(Hx1, g3y - 16, 'CH₂ (α)', c, 9, 'middle', ['Hα', 'Cα', 'HCH2N', 'CCH2N']);
    dot(Hx2, g3y, ['Hβ', 'Cβ']); addText(Hx2, g3y - 16, 'CH₂ (β)', c, 9, 'middle', ['Hβ', 'Cβ']);
    const Nx = Hx2 + 40;
    b.addLine(Hx2, g3y, Nx - 16, g3y, c);
    dot(Nx, g3y, ['Hγ', 'Cγ', 'HNMe3', 'CNMe3']); addText(Nx, g3y, 'N⁺(CH₃)₃ (γ)', c, 10, 'start', ['Hγ', 'Cγ', 'HNMe3', 'CNMe3']);
  } else if (res.head === 'PE') {
    dot(Hx1, g3y, ['Hα', 'Cα', 'HCH2N', 'CCH2N']); addText(Hx1, g3y - 16, 'CH₂ (α)', c, 9, 'middle', ['Hα', 'Cα', 'HCH2N', 'CCH2N']);
    dot(Hx2, g3y, ['Hβ', 'Cβ']); addText(Hx2, g3y - 16, 'CH₂ (β)', c, 9, 'middle', ['Hβ', 'Cβ']);
    const Nx = Hx2 + 35;
    b.addLine(Hx2, g3y, Nx - 14, g3y, c);
    dot(Nx, g3y, ['HNH3', 'N']); addText(Nx, g3y, 'NH₃⁺', c, 10, 'start', ['HNH3', 'N']);
  } else if (res.head === 'PS') {
    dot(Hx1, g3y, ['HβS1', 'HβS2', 'CβS', 'Hβ', 'Cβ']); addText(Hx1, g3y - 16, 'CH₂ (β)', c, 9, 'middle', ['Hβ', 'Cβ', 'HβS1', 'HβS2', 'CβS']);
    dot(Hx2, g3y, ['HαS', 'CαS', 'Hα', 'Cα']); addText(Hx2, g3y - 16, 'CH (α)', c, 9, 'middle', ['Hα', 'Cα', 'HαS', 'CαS']);
    const Nx = Hx2 + 25;
    b.addLine(Hx2, g3y, Nx, g3y - 30, c); dot(Nx, g3y - 30, ['HNH3', 'N']); addText(Nx + 10, g3y - 36, 'NH₃⁺', c, 10, 'start', ['HNH3', 'N']);
    const Cx = Hx2 + 25;
    b.addLine(Hx2, g3y, Cx, g3y + 30, c); addText(Cx + 10, g3y + 36, 'COO⁻', c, 10, 'start', null);
  } else if (res.head === 'PG') {
    dot(Hx1, g3y, ['Hα', 'Cα', 'HCH2OH', 'CCH2OH']); addText(Hx1, g3y - 16, 'CH₂ (α)', c, 9, 'middle', ['Hα', 'Cα', 'HCH2OH', 'CCH2OH']);
    dot(Hx2, g3y, ['Hβ', 'Cβ', 'HCHOH', 'CCHOH']); addText(Hx2, g3y - 16, 'CHOH (β)', c, 9, 'middle', ['Hβ', 'Cβ', 'HCHOH', 'CCHOH']);
    const Ox = Hx2 + 35;
    b.addLine(Hx2, g3y, Ox, g3y, c); addText(Ox + 10, g3y, 'CH₂OH (γ)', c, 10, 'start', ['Hγ', 'Cγ']);
  } else {
    dot(Hx1, g3y, ['H1']); addText(Hx1, g3y - 14, 'CH₂', c, 9, 'middle', ['H1']);
    dot(Hx2, g3y, ['H2']); addText(Hx2, g3y - 14, 'CH₂', c, 9, 'middle', ['H2']);
  }
  
  addText(500, 260, `${res.name} (${db} Δ9)`, c, 13, 'middle', null);
  return b.finish(40);
};

const elementsToSVG = (structure, height = 320) => {
  let inner = '';
  structure.elements.forEach((el) => {
    const w = el.width || 1.8;
    if (el.type === 'line') inner += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'path') inner += `<path d="${el.d}" fill="none" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'polygon') inner += `<polygon points="${el.points}" fill="white" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'circle') inner += `<circle cx="${el.x}" cy="${el.y}" r="${el.r}" fill="${el.fill || 'white'}" stroke="${el.color}" stroke-width="${el.strokeWidth !== undefined ? el.strokeWidth : 1.5}"/>`;
    else if (el.type === 'text') {
      inner += `<text x="${el.x}" y="${el.y}" fill="white" stroke="white" stroke-width="3" stroke-linejoin="round" font-size="${el.fontSize}" text-anchor="${el.align}" dominant-baseline="middle" font-weight="bold">${el.text}</text>`;
      inner += `<text x="${el.x}" y="${el.y}" fill="${el.color}" font-size="${el.fontSize}" text-anchor="${el.align}" dominant-baseline="middle" font-weight="bold">${el.text}</text>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${structure.viewBox}" style="height:${height}px;max-width:100%;font-family:sans-serif;background:white;">${inner}</svg>`;
};

const normalizeImageCandidates = (url) => {
  const u = (url || '').trim();
  let m = u.match(/drive.google.com\/file\/d\/([^/?]+)/);
  if (m) { const id = m[1]; return [`https://lh3.googleusercontent.com/d/${id}`, `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, `https://drive.google.com/uc?export=view&id=${id}`]; }
  m = u.match(/drive.google.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) { const id = m[1]; return [`https://lh3.googleusercontent.com/d/${id}`, `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, `https://drive.google.com/uc?export=view&id=${id}`]; }
  if (u.includes('dropbox.com')) return [u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1'), u];
  return [u];
};

export const getPeakLabelText = (payload, format, dim) => {
  if (!payload || !payload.resNum) return '';
  let atomStr = '';
  if (dim === 'direct') atomStr = payload.atom1 || '';
  else if (dim === 'indirect') atomStr = payload.atom2 || '';
  else atomStr = [payload.atom1, payload.atom2].filter(Boolean).join('-');
  if (!atomStr && format.includes('atom')) return '';
  let base = '';
  if (format === 'resNum') base = `${payload.resNum}`;
  else if (format === 'resNum_code') base = `${payload.resNum}${payload.resCode || ''}`;
  else if (format === 'resNum_code_atom') base = `${payload.resNum}${payload.resCode || ''} ${atomStr}`;
  return base.trim();
};
// ================= STRUCTURE VIEW / PAINT / TICKS / TOOLTIP / RANGE / ZOOMABLE PLOTS =================
const StructureSVGView = ({ structure, minWidth, isExpanded, onToggleExpand, selectedKeys, manualKeys = [], onAtomClick, height = '300px' }) => {
  const clickables = structure.elements.filter((e) => (e.type === 'circle' || e.type === 'text') && e.ri != null && e.keys && e.keys.length && onAtomClick);
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand} />}
      <div className={isExpanded ? FS_CLASSES + ' p-4 md:p-6 items-center justify-center' : 'flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid'}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? '↙️' : '↗️'}</button>
        <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
          <svg viewBox={structure.viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : height, minWidth }}>
            {structure.elements.filter((e) => e.type === 'line').map((el, idx) => (<line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'path').map((el, idx) => (<path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'polygon').map((el, idx) => (<polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'circle').map((el, idx) => {
              const isSel = selectedKeys && el.keys && el.keys.some((k) => selectedKeys.includes(k));
              const isMan = manualKeys && el.keys && el.keys.some((k) => manualKeys.includes(k));
              return (
                <g key={`c${idx}`} pointerEvents="none">
                  {isSel && <circle cx={el.x} cy={el.y} r={el.r + 5} fill={SELECT_COLOR} opacity={0.25} />}
                  {isMan && !isSel && <circle cx={el.x} cy={el.y} r={el.r + 5} fill={MANUAL_COLOR} opacity={0.2} />}
                  <circle cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : 1.5} />
                </g>
              );
            })}
            {structure.elements.filter((e) => e.type === 'text').map((el, idx) => {
              const isSel = selectedKeys && el.keys && el.keys.some((k) => selectedKeys.includes(k));
              const isMan = manualKeys && el.keys && el.keys.some((k) => manualKeys.includes(k));
              return (
                <g key={`t${idx}`} pointerEvents="none">
                  {isSel && <circle cx={el.x} cy={el.y} r={el.text.length * 4 + 8} fill={SELECT_COLOR} opacity={0.25} />}
                  {isMan && !isSel && <circle cx={el.x} cy={el.y} r={el.text.length * 4 + 8} fill={MANUAL_COLOR} opacity={0.18} />}
                  <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                  <text x={el.x} y={el.y} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                </g>
              );
            })}
            {clickables.map((el, idx) => {
              const r = el.type === 'circle' ? Math.max(el.r + 4, 10) : el.text.length * (el.fontSize || 11) * 0.34 + 7;
              return (
                <circle key={`hit${idx}`} cx={el.x} cy={el.y} r={r} fill="transparent" style={{ cursor: 'pointer', pointerEvents: 'all' }} onClick={(e) => { e.stopPropagation(); onAtomClick(el.ri, el.keys); }}>
                  <title>{el.atoms ? el.atoms.join(', ') : ''}</title>
                </circle>
              );
            })}
          </svg>
        </div>
      </div>
    </>
  );
};

const SequencePaintStrip = ({ residues, getLetter, meta, onApply, focusIdx, charLabel }) => {
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const up = () => setPainting(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  return (
    <div className="flex flex-wrap gap-1.5 select-none">
      {residues.map((r, i) => {
        const l = getLetter(i);
        const m = meta[l] || { label: String(l), color: '#64748b' };
        const dim = focusIdx !== 'ALL' && focusIdx !== i;
        return (
          <button key={i} draggable={false} onDragStart={(e) => e.preventDefault()} onMouseDown={(e) => { e.preventDefault(); setPainting(true); onApply(i); }} onMouseEnter={() => { if (painting) onApply(i); }} title={`${r.id}: ${m.label}`} className="w-11 py-1 rounded-md border text-center leading-tight transition-all" style={{ backgroundColor: m.color + '22', borderColor: m.color, opacity: dim ? 0.35 : 1 }}>
            <div className="text-[8px] text-slate-500 font-bold">{i + 1}</div>
            <div className="text-sm font-black text-slate-800">{charLabel ? charLabel(r) : r.char}</div>
            <div className="text-[10px] font-black" style={{ color: m.color }}>{l}</div>
          </button>
        );
      })}
    </div>
  );
};

const CustomXTick1H = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};

const CustomYTick1H = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};

const CustomXTick13C = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 8 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(1) : numVal}
        </text>
      )}
    </g>
  );
};

const CustomYTick13C = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 10 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(1) : numVal}
        </text>
      )}
    </g>
  );
};

const NMRTooltip = ({ active, payload, diagonalColor, selectedKeys }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.min !== undefined) {
      return (
        <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
          <p className="font-bold text-slate-800">{data.res} - {data.atom}</p>
          <p className="text-slate-500">Theoretical Range: {data.min.toFixed(2)} - {data.max.toFixed(2)} ppm</p>
        </div>
      );
    }
    const isSel = selectedKeys && data.keys && data.keys.some((k) => selectedKeys.includes(k));
    if (data.type === '1D') {
      return (
        <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
          <p className="font-bold text-slate-800">{data.label}{isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}</p>
          <p className="text-slate-500">{data.x.toFixed(3)} ppm</p>
          {data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}
        </div>
      );
    }
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50">
        <p className="font-bold text-slate-800">{data.label}{isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}</p>
        <p className="font-semibold" style={{ color: data.type === 'Diagonal' ? diagonalColor : getNMRFillColor(data) }}>{data.type}</p>
        <p className="text-slate-500 text-xs mt-1">F2: {Number(data.x).toFixed(2)} ppm<br />F1: {Number(data.y).toFixed(2)} ppm</p>
      </div>
    );
  }
  return null;
};

const RangeBarChart = ({ title, ranges, domain, ticks, xAxisLabel, rowCount, rowLabels }) => {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(update); ro.observe(el); }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const margin = { top: 15, right: 24, bottom: 40, left: 56 };
  const rowH = 36;
  const nRows = Math.max(1, rowCount);
  const svgHeight = margin.top + nRows * rowH + margin.bottom;
  const plotW = Math.max(10, (width || 600) - margin.left - margin.right);
  const span = domain[1] - domain[0];
  const xScale = (v) => margin.left + ((domain[1] - v) / span) * plotW;
  const yCenter = (row) => margin.top + row * rowH + rowH / 2 + 6;
  const axisY = margin.top + nRows * rowH;
  const rowOccupancy = Array.from({ length: nRows }, () => []);
  const processedRanges = ranges.map((r, i) => {
    const row = nRows - 1 - r.y;
    const xLeft = xScale(r.max);
    const xRight = xScale(r.min);
    let slot = 0;
    while (rowOccupancy[row].some(occ => occ.slot === slot && !(xRight + 22 < occ.left || xLeft - 22 > occ.right))) {
      slot++;
    }
    rowOccupancy[row].push({ left: xLeft, right: xRight, slot });
    return { ...r, originalIndex: i, row, x1: xLeft, x2: xRight, slot };
  });
  return (
    <div ref={containerRef} className="bg-slate-50 rounded-xl border border-slate-200 p-3 relative mt-2">
      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 ml-1">{title}</h4>
      <svg width="100%" height={svgHeight} className="block select-none">
        {rowLabels.map((label, row) => (
          <g key={`row-${row}`}>
            {row % 2 === 0 && <rect x={margin.left} y={margin.top + row * rowH} width={plotW} height={rowH} fill="#f1f5f9" opacity={0.6} />}
            <text x={margin.left - 8} y={yCenter(row)} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight="bold" fill="#64748b">{label}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={`tick-${t}`}>
            <line x1={xScale(t)} y1={margin.top} x2={xScale(t)} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
            <line x1={xScale(t)} y1={axisY} x2={xScale(t)} y2={axisY + 5} stroke="#94a3b8" strokeWidth={1} />
            <text x={xScale(t)} y={axisY + 16} textAnchor="middle" fontSize={10} fill="#64748b">{t}</text>
          </g>
        ))}
        <line x1={margin.left} y1={axisY} x2={margin.left + plotW} y2={axisY} stroke="#cbd5e1" strokeWidth={1} />
        {processedRanges.map((r) => {
          const cy = yCenter(r.row);
          const isHov = hover && hover.idx === r.originalIndex;
          const textY = cy - 8 - r.slot * 10;
          return (
            <g key={`range-${r.originalIndex}`}>
              <rect x={r.x1} y={cy - 4} width={Math.max(2, r.x2 - r.x1)} height={8} rx={3} fill={r.color} fillOpacity={isHov ? 1 : 0.75} stroke={r.color} strokeWidth={1} style={{ cursor: 'pointer' }}
                onMouseMove={(e) => { const crect = containerRef.current.getBoundingClientRect(); setHover({ idx: r.originalIndex, x: e.clientX - crect.left, y: e.clientY - crect.top }); }}
                onMouseLeave={() => setHover(null)} />
              <text x={(r.x1 + r.x2) / 2} y={textY} textAnchor="middle" fontSize={9} fontWeight="bold" fill={r.color}>{r.atom}</text>
            </g>
          );
        })}
        <text x={margin.left + plotW / 2} y={svgHeight - 6} textAnchor="middle" fontSize={11} fill="#64748b">{xAxisLabel}</text>
      </svg>
      {hover && ranges[hover.idx] && (
        <div className="absolute bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50 pointer-events-none whitespace-nowrap" style={{ left: hover.x + 12, top: Math.max(0, hover.y - 44) }}>
          <p className="font-bold text-slate-800">{ranges[hover.idx].res} - {ranges[hover.idx].atom}</p>
          <p className="text-slate-500">Theoretical Range: {ranges[hover.idx].min.toFixed(2)} - {ranges[hover.idx].max.toFixed(2)} ppm</p>
        </div>
      )}
    </div>
  );
};
/* ============================================================================
   PEAK LABEL OVERLAYS (1D & 2D)
   Renders peak labels searching for free space to avoid collisions.
   ============================================================================ */
const PeakLabelOverlay = ({ markers, dom, marginLeft, marginRight, marginTop, marginBottom, labelAreaH }) => {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { w, h } = size;
  const plotW = w - marginLeft - marginRight;
  const plotH = h - marginTop - marginBottom;
  if (plotW <= 0 || plotH <= 0 || markers.length === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
  }

  const domLo = Math.min(dom[0], dom[1]);
  const domHi = Math.max(dom[0], dom[1]);
  const ppmToX = (ppm) => {
    if (domHi === domLo) return marginLeft + plotW / 2;
    const frac = (ppm - domLo) / (domHi - domLo);
    return marginLeft + plotW * (1 - frac);
  };

  const visible = markers.filter(m => m.ppm >= domLo && m.ppm <= domHi);

  const LABEL_H = 14;
  const LABEL_PAD = 4;
  const FONT_SIZE = 7;
  const ARROW_LEN = 10;
  const TICK_LEN = 6;

  const placed = [];
  const sorted = [...visible].sort((a, b) => ppmToX(a.ppm) - ppmToX(b.ppm));

  sorted.forEach(m => {
    const cx = ppmToX(m.ppm);
    const textW = m.label.length * FONT_SIZE * 0.55 + LABEL_PAD * 2;
    let bestY = null;
    for (let row = 0; row < 5; row++) {
      const candidateY = marginTop - TICK_LEN - ARROW_LEN - LABEL_H - row * (LABEL_H + 2);
      if (candidateY < 2) continue;
      const overlap = placed.some(p => p.row === row && Math.abs(p.cx - cx) < (textW / 2 + p.tw / 2 + 2));
      if (!overlap) {
        bestY = candidateY;
        placed.push({ cx, cy: candidateY, tw: textW, row, label: m.label });
        break;
      }
    }
    if (bestY === null) {
      bestY = marginTop - TICK_LEN - ARROW_LEN - LABEL_H;
      placed.push({ cx, cy: bestY, tw: textW, row: 0, label: m.label });
    }
  });

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {w > 0 && (
        <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
          <defs>
            <marker id="pk-arrow" markerWidth="5" markerHeight="5" refX="2" refY="2.5" orient="auto">
              <path d="M0,0 L0,5 L4,2.5 z" fill="#dc2626" />
            </marker>
          </defs>
          {placed.map((p, i) => {
            const arrowStartY = p.cy + LABEL_H + 1;
            const arrowEndY = marginTop - TICK_LEN - 1;
            return (
              <g key={i}>
                <line x1={p.cx} y1={marginTop} x2={p.cx} y2={marginTop - TICK_LEN} stroke="#ef4444" strokeWidth={1.5} />
                {arrowStartY < arrowEndY && (
                  <line x1={p.cx} y1={arrowStartY} x2={p.cx} y2={arrowEndY} stroke="#dc2626" strokeWidth={1} markerEnd="url(#pk-arrow)" />
                )}
                <rect x={p.cx - p.tw / 2} y={p.cy} width={p.tw} height={LABEL_H} rx={2} fill="white" stroke="#fca5a5" strokeWidth={0.8} opacity={0.95} />
                <text x={p.cx} y={p.cy + LABEL_H / 2 + FONT_SIZE / 2 - 1} textAnchor="middle" fontSize={FONT_SIZE} fontFamily="monospace" fontWeight="bold" fill="#b91c1c">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

const PeakLabelOverlay2D = ({ markers, xDom, yDom, marginLeft, marginRight, marginTop, marginBottom, fontSize = 9 }) => {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { w, h } = size;
  const plotW = w - marginLeft - marginRight;
  const plotH = h - marginTop - marginBottom;
  
  if (plotW <= 0 || plotH <= 0 || markers.length === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
  }

  const xLo = Math.min(xDom[0], xDom[1]);
  const xHi = Math.max(xDom[0], xDom[1]);
  const yLo = Math.min(yDom[0], yDom[1]);
  const yHi = Math.max(yDom[0], yDom[1]);

  const ppmToX = (ppm) => marginLeft + plotW * (1 - (ppm - xLo) / (xHi - xLo));
  const ppmToY = (ppm) => marginTop + plotH * (1 - (ppm - yLo) / (yHi - yLo));

  const visible = markers.filter(m => m.x >= xLo && m.x <= xHi && m.y >= yLo && m.y <= yHi);
  
  const FONT_SIZE = fontSize;
  const LABEL_PAD_X = 4;
  const LABEL_H = fontSize + 5;
  const placed = [];

  visible.forEach(m => {
    const cx = ppmToX(m.x);
    const cy = ppmToY(m.y);
    const tw = m.label.length * FONT_SIZE * 0.55 + LABEL_PAD_X * 2;
    const th = LABEL_H;

    let best = null;
    let rad = 1;
    const angles = [Math.PI/4, 7*Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 0, Math.PI/2, Math.PI, 3*Math.PI/2];

    while(rad < 15 && !best) {
      for(let a of angles) {
         const dist = 8 + rad * 12;
         const px = cx + dist * Math.cos(a);
         const py = cy + dist * Math.sin(a);
         
         const left = px - tw/2;
         const right = px + tw/2;
         const top = py - th/2;
         const bottom = py + th/2;

         if(left < marginLeft || right > w - marginRight || top < marginTop || bottom > h - marginBottom) continue;

         const overlap = placed.some(p => !(right < p.left - 2 || left > p.right + 2 || bottom < p.top - 2 || top > p.bottom + 2));

         if(!overlap) {
           best = { cx: px, cy: py, left, right, top, bottom };
           break;
         }
      }
      rad++;
    }

    if(!best) {
       best = { cx: cx + 15, cy: cy - 15, left: cx+15-tw/2, right: cx+15+tw/2, top: cy-15-th/2, bottom: cy-15+th/2 };
    }

    placed.push({ ...best, originX: cx, originY: cy, label: m.label });
  });

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {w > 0 && (
        <svg width={w} height={h} style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
          <defs>
            <marker id="pk-arrow-2d" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto">
              <path d="M0,0 L0,4 L4,2 z" fill="#94a3b8" />
            </marker>
          </defs>
          {placed.map((p, i) => (
            <g key={i}>
              <line x1={p.cx} y1={p.cy} x2={p.originX} y2={p.originY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 2" markerEnd="url(#pk-arrow-2d)" />
              <rect x={p.left} y={p.top} width={p.right - p.left} height={p.bottom - p.top} rx={2} fill="white" stroke="#cbd5e1" strokeWidth={0.8} opacity={0.85} />
              <text x={p.cx} y={p.cy + FONT_SIZE/2 - 1} textAnchor="middle" fontSize={FONT_SIZE} fontFamily="sans-serif" fontWeight="bold" fill="#475569">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};
// ================= ZOOMABLE PLOTS & SCROLLBARS =================
const AxisScrollbar = ({ domain, fullDomain, onChange, vertical = false, reversed = true }) => {
  const [min, max] = domain;
  const [fMin, fMax] = fullDomain;
  const size = max - min;
  const limit = fMax - size;
  const handleChange = (e) => {
    const v = parseFloat(e.target.value);
    onChange([v, v + size]);
  };
  return (
    <input
      type="range"
      min={fMin}
      max={limit}
      step={(fMax - fMin) / 1000}
      value={min}
      onChange={handleChange}
      orient={vertical ? "vertical" : "horizontal"}
      dir={reversed && !vertical ? "rtl" : "ltr"}
      className="accent-slate-400 hover:accent-blue-500 transition-all cursor-pointer"
      style={{
        WebkitAppearance: vertical ? 'slider-vertical' : undefined,
        width: vertical ? '16px' : '100%',
        height: vertical ? '100%' : '12px',
        transform: vertical && reversed ? 'rotate(180deg)' : 'none',
        margin: 0,
        outline: 'none'
      }}
      title="Pan axis"
    />
  );
};

const OneDSpectrumPlot = ({ title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel, selectedKeys, manualKeys = [], heightPx = 300, fs = 11, aspect = null, simCfg }) => {
  const { simShowLabels = true, simLabelFormat = 'resNum_code_atom', simLabelDim = 'both', simLabelFontSize = 10 } = simCfg || {};
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState(fullDomain);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== fullDomain[0] || xDomain[1] !== fullDomain[1];
  
  const getXVal = (clientX) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN_1D.left - CHART_MARGIN_1D.right;
    if (plotW <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN_1D.left;
    const fx = Math.min(1, Math.max(0, px / plotW));
    return xDomain[1] - fx * (xDomain[1] - xDomain[0]);
  };
  
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const xVal = getXVal(e.clientX); if (xVal !== null) setRefAreaRight(xVal); };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
      setRefAreaLeft(null); setRefAreaRight(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight]);
  
  const handleMouseDown = (e) => {
    const xVal = getXVal(e.clientX);
    if (xVal !== null) { isDragging.current = true; setRefAreaLeft(xVal); setRefAreaRight(xVal); }
  };

  const processedData = useMemo(() => {
    if (!data) return [];
    
    // Group by label to identify multiplets
    const groups = {};
    data.forEach(p => {
        if (!p.label) return;
        if (!groups[p.label]) groups[p.label] = [];
        groups[p.label].push(p);
    });

    const multipletMeta = {};
    const maxPeaks = {};

    Object.keys(groups).forEach(label => {
        const peaks = groups[label];
        const xs = peaks.map(p => p.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const centerX = (minX + maxX) / 2;
        
        let maxPeak = peaks[0];
        peaks.forEach(p => { if (p.y > maxPeak.y) maxPeak = p; });
        
        maxPeaks[label] = maxPeak;
        multipletMeta[label] = { minX, maxX, centerX, peakXs: xs };
    });

    // Mark the tallest peak as the anchor. Staggering logic is removed in favor of the PeakLabelOverlay.
    return data.map(p => ({
        ...p,
        isLabelAnchor: p.label && maxPeaks[p.label] === p,
        multipletBounds: p.label ? multipletMeta[p.label] : null
    }));
  }, [data]);

  const peakMarkers = useMemo(() => {
    if (!simShowLabels) return [];
    const markers = [];
    processedData.forEach(p => {
      if (p.isLabelAnchor) {
        const textStr = getPeakLabelText(p, simLabelFormat, simLabelDim);
        if (textStr) markers.push({ ppm: p.multipletBounds.centerX, label: textStr });
      }
    });
    return markers;
  }, [processedData, simShowLabels, simLabelFormat, simLabelDim]);

  const labelAreaH = (simShowLabels && peakMarkers.length > 0) ? 55 : 0;
  const activeMargin = { ...CHART_MARGIN_1D, top: CHART_MARGIN_1D.top + labelAreaH };
  
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : `${heightPx}px` } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={(n) => { chartRef.current = n; boxRef.current = n; }}>
          <div onMouseDown={handleMouseDown} style={{ width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={processedData} margin={activeMargin}>
                <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : ticks} interval={0} tickLine={false} tick={<TickComponent isZoomed={isZoomed} fs={fs} />} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} axisLine={{ stroke: '#cbd5e1' }} />
                <YAxis type="number" dataKey="y" domain={[0, 'auto']} hide={true} />
                <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip selectedKeys={selectedKeys} />} />
                <Bar dataKey="y" barSize={2} shape={(props) => {
                  const { x, y, width, height, payload } = props;
                  const centerX = x + width / 2;
                  const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                  const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                  const dimmed = selectedKeys && !isSel && !isMan;
                  
                  const barElem = <line x1={centerX} y1={y + height} x2={centerX} y2={y} stroke={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.color} strokeWidth={isSel ? 3 : isMan ? 2.5 : 1.5} />;
                  
                  if (!payload.multipletBounds || !payload.isLabelAnchor) {
                    return <g opacity={dimmed ? 0.2 : 1}>{barElem}</g>;
                  }

                  const m = payload.multipletBounds;
                  const plotW = boxW ? (boxW - activeMargin.left - activeMargin.right) : 0;
                  const scale = (plotW && (xDomain[1] - xDomain[0]) !== 0) ? plotW / (xDomain[1] - xDomain[0]) : 0;

                  let annotationElem = null;

                  if (scale > 0) {
                      const getPixelX = (val) => centerX + (payload.x - val) * scale;
                      const pxMinX = getPixelX(m.minX);
                      const pxMaxX = getPixelX(m.maxX);
                      const isSinglet = Math.abs(pxMinX - pxMaxX) < 2;

                      if (!isSinglet) {
                          const multiY = y - 6;
                          annotationElem = (
                              <g>
                                  {/* Horizontal bar spanning the multiplet */}
                                  <line x1={pxMinX} y1={multiY} x2={pxMaxX} y2={multiY} stroke="#475569" strokeWidth={1.5} />
                                  {/* Vertical ticks for each component dropping down from the horizontal bar */}
                                  {m.peakXs.map((px, i) => (
                                      <line key={i} x1={getPixelX(px)} y1={multiY} x2={getPixelX(px)} y2={multiY + 4} stroke="#475569" strokeWidth={1.5} />
                                  ))}
                              </g>
                          );
                      }
                  }

                  return (
                    <g opacity={dimmed ? 0.2 : 1}>
                      {barElem}
                      {annotationElem}
                    </g>
                  );
                }} isAnimationActive={false} />
                {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {simShowLabels && peakMarkers.length > 0 && (
            <PeakLabelOverlay
              markers={peakMarkers}
              dom={xDomain}
              marginLeft={activeMargin.left}
              marginRight={activeMargin.right}
              marginTop={activeMargin.top}
              marginBottom={activeMargin.bottom}
              labelAreaH={labelAreaH}
            />
          )}
          {isZoomed && (
            <div className="absolute left-0 right-0 z-10 flex items-center" style={{ bottom: '0px', paddingLeft: activeMargin.left, paddingRight: activeMargin.right }}>
              <AxisScrollbar domain={xDomain} fullDomain={fullDomain} onChange={setXDomain} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

const SpectrumPlot = ({ title, diagonalData, crossPeakData, expandedPanel, setExpandedPanel, panelId, diagonalColor, selectedKeys, manualKeys = [], aspect = 1, fs = 11, simCfg = {} }) => {
  const { simShowLabels, simLabelFormat, simLabelDim, simLabelFontSize = 10 } = simCfg;
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState([0, 11]);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 11;
  
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left;
    const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW));
    const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) {
          setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
          setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]);
        }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); }
  };

  const processedCrossPeaks = useMemo(() => {
    if (!crossPeakData) return [];
    const used = [];
    return crossPeakData.map(p => {
      let dx = 0, dy = 0, rad = 1;
      while(used.some(u => Math.abs(u.x - (p.x + dx)) < 0.4 && Math.abs(u.y - (p.y + dy)) < 0.4)) {
         const angle = rad * Math.PI / 4;
         dx = (Math.ceil(rad/8) * 0.4) * Math.cos(angle);
         dy = (Math.ceil(rad/8) * 0.4) * Math.sin(angle);
         rad++;
      }
      used.push({ x: p.x + dx, y: p.y + dy });
      return { ...p, labelDx: dx * 35, labelDy: dy * 35 };
    });
  }, [crossPeakData]);
  
  const shape = (props) => {
    const { cx, cy, fill, payload } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
    const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
    const dimmed = selectedKeys && !isSel && !isMan && payload.type !== 'Diagonal';
    const textStr = simShowLabels && payload.type !== 'Diagonal' ? getPeakLabelText(payload, simLabelFormat, simLabelDim) : '';
    
    const r = payload.size || 5;
    const textX = cx + r + 5 + (payload.labelDx || 0);
    const textY = cy - r - 5 + (payload.labelDy || 0);
    const isMoved = Math.abs(payload.labelDx || 0) > 0 || Math.abs(payload.labelDy || 0) > 0;

    return (
      <g opacity={dimmed ? 0.18 : 1}>
        {textStr && isMoved && (
          <line x1={cx} y1={cy} x2={textX} y2={textY} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 2" />
        )}
        {isSel && <circle cx={cx} cy={cy} r={r + 5} fill={SELECT_COLOR} opacity={0.3} />}
        {isMan && !isSel && <circle cx={cx} cy={cy} r={r + 5} fill={MANUAL_COLOR} opacity={0.22} />}
        <circle cx={cx} cy={cy} r={isSel ? r + 2 : isMan ? r + 1.5 : r} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.type === 'Diagonal' ? fill : getNMRFillColor(payload)} stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'} strokeWidth={isSel ? 2 : isMan ? 1.5 : 0} opacity={0.85} />
        {textStr && (
          <g>
            <text x={textX} y={textY} fontSize={simLabelFontSize} fill="white" stroke="white" strokeWidth={3} strokeLinejoin="round" fontWeight="bold">{textStr}</text>
            <text x={textX} y={textY} fontSize={simLabelFontSize} fill="#475569" fontWeight="bold">{textStr}</text>
          </g>
        )}
      </g>
    );
  };
  
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : '300px' } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div ref={(n) => { chartRef.current = n; boxRef.current = n; }} className="select-none relative flex-1 min-h-0">
          <div onMouseDown={handleMouseDown} style={{ width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} />
                <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomYTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fs + 1 }} />
                <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
                
                {/* Changed shape to function to avoid DOM warning propagation */}
                <Scatter name="Diagonal" data={[{ x: 0, y: 0 }, { x: 11, y: 11 }]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={(props) => <circle cx={props.cx || 0} cy={props.cy || 0} r={0} />} legendType="none" isAnimationActive={false} />
                
                <Scatter data={diagonalData} fill={diagonalColor} shape={shape} isAnimationActive={false} />
                <Scatter data={processedCrossPeaks} shape={shape} isAnimationActive={false} />
                {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {isZoomed && (
            <>
              <div className="absolute left-0 right-0 z-10 flex items-center" style={{ bottom: '0px', paddingLeft: CHART_MARGIN.left, paddingRight: CHART_MARGIN.right }}>
                <AxisScrollbar domain={xDomain} fullDomain={[0, 11]} onChange={setXDomain} />
              </div>
              <div className="absolute top-0 bottom-0 z-10 flex justify-center" style={{ right: '0px', paddingTop: CHART_MARGIN.top, paddingBottom: CHART_MARGIN.bottom }}>
                <AxisScrollbar domain={yDomain} fullDomain={[0, 11]} onChange={setYDomain} vertical={true} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

const HSQCPlot = ({ title, crossPeakData, expandedPanel, setExpandedPanel, panelId, selectedKeys, manualKeys = [], yAxisLabel = '¹³C F1 (ppm)', yDomainInit = [0, 220], yTicks = TICKS_13C, aspect = 1, fs = 11, simCfg = {} }) => {
  const { simShowLabels, simLabelFormat, simLabelDim, simLabelFontSize = 10 } = simCfg;
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState(yDomainInit);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== yDomainInit[0] || yDomain[1] !== yDomainInit[1];
  
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left;
    const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW));
    const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) {
          setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
          setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]);
        }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); }
  };

  const processedCrossPeaks = useMemo(() => {
    if (!crossPeakData) return [];
    const used = [];
    const yRange = yDomainInit[1] - yDomainInit[0];
    return crossPeakData.map(p => {
      let dx = 0, dy = 0, rad = 1;
      while(used.some(u => Math.abs(u.x - (p.x + dx)) < 0.4 && Math.abs(u.y - (p.y + dy)) < (yRange/25))) {
         const angle = rad * Math.PI / 4;
         dx = (Math.ceil(rad/8) * 0.4) * Math.cos(angle);
         dy = (Math.ceil(rad/8) * (yRange/25)) * Math.sin(angle);
         rad++;
      }
      used.push({ x: p.x + dx, y: p.y + dy });
      return { ...p, labelDx: dx * 35, labelDy: dy * 12 };
    });
  }, [crossPeakData, yDomainInit]);
  
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : '300px' } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain(yDomainInit); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div ref={(n) => { chartRef.current = n; boxRef.current = n; }} className="select-none relative flex-1 min-h-0">
          <div onMouseDown={handleMouseDown} style={{ width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} />
                <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : yTicks} interval={0} tickLine={false} tick={<CustomYTick13C isZoomed={isZoomed} fs={fs} />} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fs + 1 }} />
                <Tooltip content={<NMRTooltip diagonalColor="#8b5cf6" selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
                <Scatter data={processedCrossPeaks} shape={(props) => {
                  const { cx, cy, payload } = props;
                  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                  const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                  const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                  const dimmed = selectedKeys && !isSel && !isMan;
                  const textStr = simShowLabels ? getPeakLabelText(payload, simLabelFormat, simLabelDim) : '';
                  
                  const r = payload.size || 5;
                  const textX = cx + r + 5 + (payload.labelDx || 0);
                  const textY = cy - r - 5 + (payload.labelDy || 0);
                  const isMoved = Math.abs(payload.labelDx || 0) > 0 || Math.abs(payload.labelDy || 0) > 0;

                  return (
                    <g opacity={dimmed ? 0.18 : 1}>
                      {textStr && isMoved && (
                        <line x1={cx} y1={cy} x2={textX} y2={textY} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="2 2" />
                      )}
                      {isSel && <circle cx={cx} cy={cy} r={r + 5} fill={SELECT_COLOR} opacity={0.3} />}
                      {isMan && !isSel && <circle cx={cx} cy={cy} r={r + 5} fill={MANUAL_COLOR} opacity={0.22} />}
                      <circle cx={cx} cy={cy} r={isSel ? r + 2 : isMan ? r + 1.5 : r} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : getNMRFillColor(payload)} stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'} strokeWidth={isSel ? 2 : isMan ? 1.5 : 0} opacity={0.85} />
                      {textStr && (
                        <g>
                          <text x={textX} y={textY} fontSize={simLabelFontSize} fill="white" stroke="white" strokeWidth={3} strokeLinejoin="round" fontWeight="bold">{textStr}</text>
                          <text x={textX} y={textY} fontSize={simLabelFontSize} fill="#475569" fontWeight="bold">{textStr}</text>
                        </g>
                      )}
                    </g>
                  );
                }} isAnimationActive={false} />
                {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {isZoomed && (
            <>
              <div className="absolute left-0 right-0 z-10 flex items-center" style={{ bottom: '0px', paddingLeft: CHART_MARGIN.left, paddingRight: CHART_MARGIN.right }}>
                <AxisScrollbar domain={xDomain} fullDomain={[0, 11]} onChange={setXDomain} />
              </div>
              <div className="absolute top-0 bottom-0 z-10 flex justify-center" style={{ right: '0px', paddingTop: CHART_MARGIN.top, paddingBottom: CHART_MARGIN.bottom }}>
                <AxisScrollbar domain={yDomain} fullDomain={yDomainInit} onChange={setYDomain} vertical={true} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

// ================= 3D SCATTER PLOT =================
const ThreeDScatter = ({ seriesList, cfg, xLabel, yLabel, zLabel, chartType = '3d' }) => {
  const [zoom, setZoom] = useState(1);
  const [pitch, setPitch] = useState(0.4); 
  const [yaw, setYaw] = useState(0.6); 
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const fs = cfg.fontSize || 11;
  const isHist = chartType === '3d-hist';
  const all = seriesList.flatMap((s) => s.pts);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      setYaw(y => y - dx * 0.01);
      setPitch(p => Math.max(-Math.PI/2, Math.min(Math.PI/2, p - dy * 0.01)));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, []);

  if (!all.length) return <div className="text-xs text-slate-400 italic p-6 text-center bg-slate-50 rounded-lg border border-dashed">No 3D data available.</div>;
  
  const rng = (vals) => { let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 1e-12) { mn -= 0.5; mx += 0.5; } return [mn, mx]; };
  const [x0, x1] = rng(all.map((p) => p.x));
  const [y0, y1] = rng(all.map((p) => p.y));
  const [z0, z1] = rng(all.map((p) => p.z));
  const norm = (v, a, b) => (v - a) / (b - a);
  
  const proj = (xn, yn, zn) => {
    const cx = xn - 0.5, cy = yn - 0.5, cz = zn - 0.5;
    const rx = cx * Math.cos(yaw) - cy * Math.sin(yaw);
    const ry = cx * Math.sin(yaw) + cy * Math.cos(yaw);
    const rz = ry * Math.sin(pitch) + cz * Math.cos(pitch);
    const rry = ry * Math.cos(pitch) - cz * Math.sin(pitch);
    return { X: rx, Y: rz, depth: rry };
  };

  const W = 680, H = 500, pad = 80;
  const corners = [];
  [0, 1].forEach((a) => [0, 1].forEach((b) => [0, 1].forEach((c) => corners.push(proj(a, b, c)))));
  const minX = Math.min(...corners.map((c) => c.X)), maxX = Math.max(...corners.map((c) => c.X));
  const minY = Math.min(...corners.map((c) => c.Y)), maxY = Math.max(...corners.map((c) => c.Y));
  const s = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY)) * zoom;
  const tx = (X) => pad + (X - minX) * s + Math.max(0, (W - 2 * pad - (maxX - minX) * s) / 2);
  const ty = (Y) => pad + (Y - minY) * s + Math.max(0, (H - 2 * pad - (maxY - minY) * s) / 2);
  const pt = (xn, yn, zn) => { const p = proj(xn, yn, zn); return { x: tx(p.X), y: ty(p.Y), depth: p.depth }; };

  const axes = [
    { p1: pt(0,0,0), p2: pt(1,0,0), color: '#ef4444', label: xLabel },
    { p1: pt(0,0,0), p2: pt(0,1,0), color: '#22c55e', label: yLabel },
    { p1: pt(0,0,0), p2: pt(0,0,1), color: '#3b82f6', label: zLabel }
  ].sort((a,b) => b.p2.depth - a.p2.depth);

  const drawPts = seriesList.flatMap((sr) => sr.pts.map(p => {
      const nx = norm(p.x, x0, x1), ny = norm(p.y, y0, y1), nz = norm(p.z, z0, z1);
      const top = pt(nx, ny, nz);
      
      const wX = 0.015 * (x1 === x0 ? 1 : (x1 - x0));
      const wY = 0.015 * (y1 === y0 ? 1 : (y1 - y0));

      const c1 = pt(Math.max(0, nx - wX), Math.max(0, ny - wY), 0);
      const c2 = pt(Math.min(1, nx + wX), Math.max(0, ny - wY), 0);
      const c3 = pt(Math.min(1, nx + wX), Math.min(1, ny + wY), 0);
      const c4 = pt(Math.max(0, nx - wX), Math.min(1, ny + wY), 0);
      const t1 = pt(Math.max(0, nx - wX), Math.max(0, ny - wY), nz);
      const t2 = pt(Math.min(1, nx + wX), Math.max(0, ny - wY), nz);
      const t3 = pt(Math.min(1, nx + wX), Math.min(1, ny + wY), nz);
      const t4 = pt(Math.max(0, nx - wX), Math.min(1, ny + wY), nz);

      return { ...p, nx, ny, nz, top, c1, c2, c3, c4, t1, t2, t3, t4, color: sr.color, label: sr.label };
  })).sort((a,b) => b.top.depth - a.top.depth);

  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

  return (
    <div className="relative">
      <div className="absolute top-1 right-1 z-10 flex gap-1">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-black text-slate-700">+</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-black text-slate-700">−</button>
        <button type="button" onClick={() => { setZoom(1); setPitch(0.4); setYaw(0.6); }} className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-slate-600">Reset View</button>
      </div>
      <p className="absolute top-1 left-2 text-[10px] text-slate-400 italic pointer-events-none">Drag to rotate</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none cursor-move" style={{ maxHeight: cfg.height || 460 }} onMouseDown={(e) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }}>
        {axes.map((a, i) => (
          <g key={`ax${i}`}>
            <line x1={a.p1.x} y1={a.p1.y} x2={a.p2.x} y2={a.p2.y} stroke={a.color} strokeWidth={2} opacity={0.6} />
            <text x={a.p2.x} y={a.p2.y - 10} fontSize={fs} fontWeight="bold" fill={a.color} textAnchor="middle">{a.label}</text>
          </g>
        ))}
        {drawPts.map((p, i) => (
           <g key={`pt${i}`}>
             <title>{`${p.label} | ${p.name}\n${xLabel}: ${fmt(p.x)}\n${yLabel}: ${fmt(p.y)}\n${zLabel}: ${fmt(p.z)}`}</title>
             {isHist ? (
               <>
                 <polygon points={`${p.c1.x},${p.c1.y} ${p.c2.x},${p.c2.y} ${p.t2.x},${p.t2.y} ${p.t1.x},${p.t1.y}`} fill={p.color} stroke="#000" strokeWidth={0.5} opacity={0.7} />
                 <polygon points={`${p.c2.x},${p.c2.y} ${p.c3.x},${p.c3.y} ${p.t3.x},${p.t3.y} ${p.t2.x},${p.t2.y}`} fill={p.color} stroke="#000" strokeWidth={0.5} opacity={0.8} />
                 <polygon points={`${p.t1.x},${p.t1.y} ${p.t2.x},${p.t2.y} ${p.t3.x},${p.t3.y} ${p.t4.x},${p.t4.y}`} fill={p.color} stroke="#000" strokeWidth={1} opacity={1} />
               </>
             ) : (
               <circle cx={p.top.x} cy={p.top.y} r={cfg.ptSize || 5} fill={p.color} opacity={0.9} stroke="#fff" strokeWidth={1} />
             )}
           </g>
        ))}
      </svg>
    </div>
  );
};

// ================= INSTANCES (top-of-page) & PARAMETER LAYERS =================
const EXPERIMENTAL_CONDITION_FIELDS = [
  { key: 'temperature', label: 'Temperature' },
  { key: 'ph', label: 'pH' },
  { key: 'concentration', label: 'Concentration' },
  { key: 'ratio', label: 'Ratio' },
  { key: 'saltConcentration', label: 'Salt Concentration' },
  { key: 'solvent', label: 'Solvent' },
  { key: 'otherMolecule', label: 'Other Molecule' }
];
const getExperimentalFields = (ctx) => {
  const merged = [...EXPERIMENTAL_CONDITION_FIELDS];
  const extra = Array.isArray(ctx?.experimentalFields) ? ctx.experimentalFields : [];
  extra.forEach((f) => {
    const item = typeof f === 'string' ? { key: f, label: f } : f;
    if (item && item.key && !merged.some((m) => m.key === item.key)) merged.push(item);
  });
  return merged;
};
const getExpValue = (inst, key) => {
  const t = inst?.test || {};
  if (t[key] !== undefined && t[key] !== '') return t[key];
  if (t.exp && t.exp[key] !== undefined && t.exp[key] !== '') return t.exp[key];
  if (t.expValues && t.expValues[key] !== undefined && t.expValues[key] !== '') return t.expValues[key];
  return '';
};
const normalizeInstance = (t, idx) => ({
  id: t.id || `inst_${idx}`,
  name: t.instanceName || t.name || `Instance ${idx + 1}`,
  test: t
});
const getInstances = (ctx, activeTest) => {
  let list = null;
  if (ctx) {
    if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch { list = null; } }
    if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
    if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
    if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
      const all = ctx.tests || ctx.allTests;
      list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
    }
  }
  if (!list || !list.length) list = [activeTest];
  let insts = list.filter(Boolean).map(normalizeInstance);
  insts = insts.map((inst) => (inst.id === activeTest.id ? normalizeInstance(activeTest, 0) : inst));
  if (!insts.some((i) => i.id === activeTest.id)) insts.unshift(normalizeInstance(activeTest, 0));
  insts.sort((a, b) => String(a.test.date || '').localeCompare(String(b.test.date || '')));
  return insts;
};
const CHEMICAL_SHIFT_LAYER = { key: 'cs', label: 'Chemical Shift', unit: 'ppm', builtin: true };
const makeLayerId = () => `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const getLayers = (activeTest) => [CHEMICAL_SHIFT_LAYER, ...(Array.isArray(activeTest.parameterLayers) ? activeTest.parameterLayers : [])];
const getActiveLayerKey = (activeTest) => activeTest.activeLayerKey || 'cs';
const instanceLayerValues = (inst, layerKey) => {
  const t = inst?.test || {};
  const nv = t.nmrValues || t.values;
  if (nv && nv[layerKey]) return nv[layerKey];
  if (layerKey === 'cs') return t.chemicalShifts || {};
  return {};
};
const getInstanceValues = (inst, isActive, activeTest, layerKey) => {
  let base = instanceLayerValues(inst, layerKey);
  if (isActive) {
    const overlay = (activeTest.nmrValues || {})[layerKey];
    if (overlay) base = { ...base, ...overlay };
  }
  return base;
};
const writeCellValue = (activeTest, updateActiveTest, layerKey, atomKey, value) => {
  if (layerKey === 'cs') {
    updateActiveTest({ chemicalShifts: { ...(activeTest.chemicalShifts || {}), [atomKey]: value } });
    return;
  }
  const nv = { ...(activeTest.nmrValues || {}) };
  nv[layerKey] = { ...(nv[layerKey] || {}), [atomKey]: value };
  updateActiveTest({ nmrValues: nv });
};

// ================= SELECTION HELPERS =================
const getSelectedKeys = (activeTest) => (Array.isArray(activeTest.selectedAtomKeys) && activeTest.selectedAtomKeys.length ? activeTest.selectedAtomKeys : null);
const selectionLabel = (d, selectedKeys) => {
  if (!selectedKeys || !selectedKeys.length) return '';
  const ri = parseInt(selectedKeys[0].split('-')[0], 10);
  const res = d.parsedSeq[ri];
  const atoms = [...new Set(selectedKeys.map((k) => k.split('-').slice(1).join('-')))];
  return `${res ? res.id : `#${ri + 1}`}: ${atoms.join(', ')}`;
};
const getManualKeys = (values) => {
  const out = new Set();
  Object.entries(values || {}).forEach(([k, v]) => {
    if (parseManual(v) === null) return;
    out.add(k);
    const idx = k.split('-')[0];
    const atom = k.slice(idx.length + 1);
    out.add(`${idx}-${atom.trim()}`);
    out.add(`${idx}-${atom.replace(/\s+/g, '')}`);
  });
  return [...out];
};
const opLabel = (op) => (typeof op === 'string' ? op : `${op?.name || ''} ${op?.surname || ''}`.trim());
const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') || atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')) return null;
  if (molType === 'organic') {
    return atom.replace('H', 'C').replace(/[a-z]+$/, '');
  }
  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom === 'Hδ21' || atom === 'Hδ22') return null;
    if (atom === 'Hε21' || atom === 'Hε22') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
    return cName;
  }
  if (molType === 'dna' || molType === 'rna') return atom.replace('H', 'C').replace("''", "'");
  if (molType === 'sugar') return atom.replace('H', 'C').replace(/[ab]$/, '');
  if (molType === 'lipid') {
    const map = {
      Hsn1a: 'Csn1', Hsn1b: 'Csn1', Hsn2: 'Csn2', Hsn3a: 'Csn3', Hsn3b: 'Csn3',
      'H2-sn1': 'C2-sn1', 'H3-sn1': 'C3-sn1', 'H4-sn1': 'C4-sn1', 'H16-sn1': 'C16-sn1',
      'H2-sn2': 'C2-sn2', 'H3-sn2': 'C3-sn2', 'H4-sn2': 'C4-sn2', 'Hall-sn2': 'Call-sn2',
      'H9-sn2': 'C9-sn2', 'H10-sn2': 'C10-sn2', 'H11-sn2': 'C11-sn2', 'H18-sn2': 'C18-sn2',
      HCH2N: 'CCH2N', HNMe3: 'CNMe3', HNH3: null, HαS: 'CαS', HβS1: 'CβS', HβS2: 'CβS',
      HCH2OH: 'CCH2OH', HCHOH: 'CCHOH'
    };
    return map[atom] !== undefined ? map[atom] : atom.replace('H', 'C');
  }
  return atom.replace('H', 'C');
};
const buildKeys = (ri, tokens, molType, char) => {
  const set = new Set();
  (tokens || []).forEach((tok) => {
    const variants = new Set([tok]);
    if (/\d$/.test(tok)) {
      [1, 2].forEach((n) => variants.add(tok + n));
      const stripped = tok.replace(/\d+$/, '');
      if (stripped !== tok && stripped.length > 1) variants.add(stripped);
    }
    variants.forEach((v) => {
      set.add(`${ri}-${v}`);
      if (v.startsWith('H')) {
        const c = getCarbonName(molType, char, v);
        if (c) set.add(`${ri}-${c}`);
      }
    });
  });
  return [...set];
};
const getProtonCountEx = (molType, res, atom) => {
  if (molType === 'protein') {
    const char = res.char;
    if (char === 'A' && atom === 'Hβ') return 3;
    if (char === 'V' && (atom === 'Hγ1' || atom === 'Hγ2')) return 3;
    if (char === 'L' && (atom === 'Hδ1' || atom === 'Hδ2')) return 3;
    if (char === 'I' && (atom === 'Hγ2' || atom === 'Hδ1')) return 3;
    if (char === 'T' && atom === 'Hγ2') return 3;
    if (char === 'M' && atom === 'Hε(CH3)') return 3;
    return 1;
  }
  if (molType === 'dna' || molType === 'rna') return atom.includes('CH3') ? 3 : 1;
  if (molType === 'sugar') return atom === 'AcCH3' ? 3 : 1;
  if (molType === 'lipid') {
    const map = { 'H4-sn1': 20, 'H4-sn2': 12, 'Hall-sn2': 4, HNMe3: 9, HCH2N: 2, HCH2OH: 2, 'H16-sn1': 3, 'H18-sn2': 3 };
    return map[atom] ?? 1;
  }
  return 1;
};
const getPascalRow = (n) => {
  if (n === 0) return [1];
  let row = [1];
  for (let i = 0; i < n; i++) {
    const nextRow = [1];
    for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j + 1]);
    nextRow.push(1);
    row = nextRow;
  }
  return row;
};
const getCarbonRangeFor = (molType, char, cName) => {
  if (!cName) return { min: 40, max: 50 };
  if (molType === 'protein') {
    if (cName === "C'") return { min: 171, max: 178 };
    const r = CARBON_RANGE_DB[char]?.[cName];
    if (r) return { min: r[0], max: r[1] };
    return { min: 40, max: 60 };
  }
  if (molType === 'dna' || molType === 'rna') {
    if (cName.includes("C1'")) return { min: 80, max: 90 };
    if (cName.includes("C2'")) return molType === 'dna' ? { min: 35, max: 42 } : { min: 68, max: 77 };
    if (cName.includes("C3'")) return { min: 68, max: 77 };
    if (cName.includes("C4'")) return { min: 78, max: 87 };
    if (cName.includes("C5'")) return { min: 59, max: 67 };
    if (cName === 'C8' || cName === 'C6') return { min: 134, max: 146 };
    if (cName === 'C2') return { min: 147, max: 156 };
    if (cName === 'C5') return { min: 98, max: 108 };
    if (cName === 'C7(CH3)') return { min: 10, max: 16 };
    return { min: 110, max: 160 };
  }
  if (molType === 'sugar') {
    if (cName === 'C1') return { min: 92, max: 105 };
    if (cName === 'C6') return char === 'FUC' ? { min: 14, max: 18 } : { min: 60, max: 64 };
    if (cName === 'C2') return char === 'NAG' ? { min: 54, max: 59 } : { min: 68, max: 76 };
    if (cName === 'CH3') return { min: 21, max: 25 };
    return { min: 66, max: 77 };
  }
  if (molType === 'lipid') {
    if (cName === 'C9-sn2' || cName === 'C10-sn2') return { min: 127, max: 132 };
    if (cName === 'CCH2N' || cName === 'CNMe3') return { min: 52, max: 61 };
    if (cName === 'C16-sn1' || cName === 'C18-sn2') return { min: 13, max: 15 };
    if (cName === 'C2-sn1' || cName === 'C2-sn2') return { min: 33, max: 36 };
    if (cName === 'C4-sn1' || cName === 'C4-sn2') return { min: 28, max: 31 };
    if (cName === 'Call-sn2' || cName === 'C11-sn2') return { min: 26, max: 29 };
    if (cName === 'Csn1' || cName === 'Csn2' || cName === 'Csn3') return { min: 61, max: 68 };
    return { min: 28, max: 32 };
  }
  return { min: 40, max: 60 };
};

// ================= LOCAL 3D STRUCTURE GENERATION (NeRF) =================
// Idealized torsion-angle-to-Cartesian placement (Natural Extension Reference Frame). Given three
// already-placed atoms A,B,C and a target bond length/angle/dihedral for a new atom D bonded to C,
// returns D's coordinates. This is the standard method used by peptide/structure builders (e.g.
// PeptideBuilder) to construct geometrically idealized backbones without a force field.
const _vecSub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const _vecAdd = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const _vecScale = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const _vecDot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const _vecCross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const _vecNorm = (a) => Math.sqrt(_vecDot(a, a));
const _vecNormalize = (a) => { const n = _vecNorm(a); return n < 1e-8 ? [0,0,0] : _vecScale(a, 1/n); };
const _deg2rad = (d) => d * Math.PI / 180;

const nerfPlace = (A, B, C, bondLength, bondAngleRad, torsionRad) => {
  const t = -torsionRad; // sign verified against a standard dihedral calculator
  const bc = _vecNormalize(_vecSub(C, B));
  const ab = _vecSub(B, A);
  const n = _vecNormalize(_vecCross(ab, bc));
  const m = _vecCross(n, bc);
  const d2 = [
    -bondLength * Math.cos(bondAngleRad),
    bondLength * Math.sin(bondAngleRad) * Math.cos(t),
    bondLength * Math.sin(bondAngleRad) * Math.sin(t),
  ];
  return [
    C[0] + bc[0]*d2[0] + m[0]*d2[1] + n[0]*d2[2],
    C[1] + bc[1]*d2[0] + m[1]*d2[1] + n[1]*d2[2],
    C[2] + bc[2]*d2[0] + m[2]*d2[1] + n[2]*d2[2],
  ];
};

// ---- Strict-column PDB ATOM/HETATM writer (validated against the PDB format spec) ----
const _padLeft = (s, n) => { s = String(s); return s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s; };
const _padRight = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const _fmtNum = (v, w, dec) => _padLeft(v.toFixed(dec), w);
const _formatAtomName = (atomName, element) => {
  if (atomName.length >= 4) return _padRight(atomName.slice(0, 4), 4);
  if (element.length === 1) return _padRight(' ' + atomName, 4);
  return _padRight(atomName, 4);
};
const pdbAtomLine = ({ het = false, serial, atomName, element, resName, chain = 'A', resSeq, x, y, z, occ = 1.0, temp = 0.0 }) => {
  const recordName = _padRight(het ? 'HETATM' : 'ATOM', 6);
  const line =
    recordName + _padLeft(serial, 5) + ' ' + _formatAtomName(atomName, element) + ' ' +
    _padRight(resName, 3) + ' ' + _padRight(chain, 1) + _padLeft(resSeq, 4) + ' ' + '   ' +
    _fmtNum(x, 8, 3) + _fmtNum(y, 8, 3) + _fmtNum(z, 8, 3) + _fmtNum(occ, 6, 2) + _fmtNum(temp, 6, 2);
  return _padRight(line, 76) + _padLeft(element, 2);
};

// ---- Protein backbone builder ----
// Idealized bond lengths/angles are the standard values used across structure-building tools
// (Engh & Huber-style). Per-residue phi/psi come from the requested secondary structure; residues
// without usable SS data fall back to a fully-extended (phi=psi=180deg) conformation, per request.
const AA_1_TO_3 = { A:'ALA',R:'ARG',N:'ASN',D:'ASP',C:'CYS',E:'GLU',Q:'GLN',G:'GLY',H:'HIS',I:'ILE',
  L:'LEU',K:'LYS',M:'MET',F:'PHE',P:'PRO',S:'SER',T:'THR',W:'TRP',Y:'TYR',V:'VAL' };

const PROTEIN_BB = {
  N_CA: 1.458, CA_C: 1.525, C_N: 1.329, C_O: 1.231, CA_CB: 1.521,
  ANG_N_CA_C: _deg2rad(111.2), ANG_CA_C_N: _deg2rad(116.2), ANG_C_N_CA: _deg2rad(121.7), ANG_CA_C_O: _deg2rad(120.5),
  OMEGA: _deg2rad(180),
};
const SS_TORSIONS = {
  H: { phi: _deg2rad(-57), psi: _deg2rad(-47) },   // alpha helix
  E: { phi: _deg2rad(-119), psi: _deg2rad(113) },  // beta strand
  C: { phi: _deg2rad(180), psi: _deg2rad(180) },   // fallback: fully extended
};
const ssTorsionAt = (ssChar) => SS_TORSIONS[ssChar] || SS_TORSIONS.C;

// ---- Side-chain geometry helpers ----
// Places a point that must be at distance lenPrev from `prev` and lenAnchor from
// `anchor` (circle–circle intersection), choosing the solution farther from
// `avoid`. Used to close rings exactly (Pro CD–N, ribose C1').
const _ringClose = (prev, anchor, lenPrev, lenAnchor, avoid) => {
  const d = _vecNorm(_vecSub(anchor, prev));
  const u = _vecNormalize(_vecSub(anchor, prev));
  const a = (lenPrev * lenPrev - lenAnchor * lenAnchor + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(1e-6, lenPrev * lenPrev - a * a));
  const mid = _vecAdd(prev, _vecScale(u, a));
  let perp = _vecCross(u, _vecNormalize(_vecSub(avoid, prev)));
  if (_vecNorm(perp) < 1e-6) perp = _vecCross(u, [0, 0, 1]);
  perp = _vecNormalize(perp);
  const c1 = _vecAdd(mid, _vecScale(perp, h));
  const c2 = _vecSub(mid, _vecScale(perp, h));
  return _vecNorm(_vecSub(c1, avoid)) > _vecNorm(_vecSub(c2, avoid)) ? c1 : c2;
};

// Idealized side-chain placement for all 20 amino acids (NeRF). Chi angles use
// standard staggered defaults (χ1 = -60°, subsequent χ = 180°); aromatic rings
// are built as exact planar regular polygons; Pro closes its ring exactly via
// circle–circle intersection. Output = { name, pos }[] of all side-chain atoms.
const placeSidechainAtoms = (char, bb) => {
  const atoms = { N: bb.N, CA: bb.CA, C: bb.C, O: bb.O };
  if (bb.CB) atoms.CB = bb.CB;
  const P = (name, a, b, c, len, ang, tor) => {
    atoms[name] = nerfPlace(atoms[a], atoms[b], atoms[c], len, _deg2rad(ang), _deg2rad(tor));
  };
  const H = (name, a, b, c, len = 1.09, ang = 109.5, tor = 180) => P(name, a, b, c, len, ang, tor);
  const CH2 = (carbon, a, b) => {
    H(carbon.replace(/^C/, 'H') + '2', a, b, carbon, 1.09, 109.5, 120);
    H(carbon.replace(/^C/, 'H') + '3', a, b, carbon, 1.09, 109.5, -120);
  };
  const CH3 = (carbon, a, b) => {
    [60, 180, -60].forEach((tor, i) => H(carbon.replace(/^C/, 'H') + String(i + 1), a, b, carbon, 1.09, 109.5, tor));
  };
  const ringFrame = (bondFrom, bondTo, refA, refB) => {
    const u = _vecNormalize(_vecSub(atoms[bondTo], atoms[bondFrom]));
    const ref = _vecNormalize(_vecSub(atoms[refA], atoms[refB]));
    let n = _vecCross(u, ref);
    if (_vecNorm(n) < 1e-6) { n = _vecCross(u, [1, 0, 0]); if (_vecNorm(n) < 1e-6) n = _vecCross(u, [0, 1, 0]); }
    n = _vecNormalize(n);
    return { u, n, v: _vecNormalize(_vecCross(n, u)) };
  };
  const ringAt = (center, frame, radius, deg) => _vecAdd(center, _vecAdd(
    _vecScale(frame.u, radius * Math.cos(_deg2rad(deg))),
    _vecScale(frame.v, radius * Math.sin(_deg2rad(deg)))
  ));
  const ringH = (name, vertex, center) => {
    atoms[name] = _vecAdd(vertex, _vecScale(_vecNormalize(_vecSub(vertex, center)), 1.08));
  };

  switch (char) {
    case 'A': CH3('CB', 'N', 'CA'); break;
    case 'R':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      P('CD', 'CA', 'CB', 'CG', 1.52, 110.5, 180); CH2('CG', 'CA', 'CB');
      P('NE', 'CB', 'CG', 'CD', 1.46, 111, 180); CH2('CD', 'CB', 'CG');
      P('CZ', 'CG', 'CD', 'NE', 1.33, 120, 180);
      H('HE', 'CG', 'CD', 'NE', 1.01, 115, 0);
      P('NH1', 'CD', 'NE', 'CZ', 1.326, 120, 0);
      P('NH2', 'CD', 'NE', 'CZ', 1.326, 120, 180);
      H('HH11', 'NE', 'CZ', 'NH1', 1.01, 120, 0); H('HH12', 'NE', 'CZ', 'NH1', 1.01, 120, 180);
      H('HH21', 'NE', 'CZ', 'NH2', 1.01, 120, 0); H('HH22', 'NE', 'CZ', 'NH2', 1.01, 120, 180);
      break;
    case 'N':
      P('CG', 'N', 'CA', 'CB', 1.50, 110.5, -60); CH2('CB', 'N', 'CA');
      P('OD1', 'CA', 'CB', 'CG', 1.23, 120, 120);
      P('ND2', 'CA', 'CB', 'CG', 1.33, 120, -120);
      H('HD21', 'CB', 'CG', 'ND2', 1.01, 120, 0); H('HD22', 'CB', 'CG', 'ND2', 1.01, 120, 180);
      break;
    case 'D':
      P('CG', 'N', 'CA', 'CB', 1.50, 110.5, -60); CH2('CB', 'N', 'CA');
      P('OD1', 'CA', 'CB', 'CG', 1.25, 120, 120);
      P('OD2', 'CA', 'CB', 'CG', 1.25, 120, -120);
      break;
    case 'C':
      P('SG', 'N', 'CA', 'CB', 1.81, 109.5, -60); CH2('CB', 'N', 'CA');
      H('HG', 'CA', 'CB', 'SG', 1.34, 100, 180);
      break;
    case 'Q':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      P('CD', 'CA', 'CB', 'CG', 1.50, 110.5, 180); CH2('CG', 'CA', 'CB');
      P('OE1', 'CB', 'CG', 'CD', 1.23, 120, 120);
      P('NE2', 'CB', 'CG', 'CD', 1.33, 120, -120);
      H('HE21', 'CG', 'CD', 'NE2', 1.01, 120, 0); H('HE22', 'CG', 'CD', 'NE2', 1.01, 120, 180);
      break;
    case 'E':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      P('CD', 'CA', 'CB', 'CG', 1.50, 110.5, 180); CH2('CG', 'CA', 'CB');
      P('OE1', 'CB', 'CG', 'CD', 1.25, 120, 120);
      P('OE2', 'CB', 'CG', 'CD', 1.25, 120, -120);
      break;
    case 'G': break;
    case 'H': {
      P('CG', 'N', 'CA', 'CB', 1.50, 110.5, -60); // <-- was missing
      CH2('CB', 'N', 'CA');
      const f = ringFrame('CB', 'CG', 'CA', 'CB');
      const R5 = 1.36 / (2 * Math.sin(Math.PI / 5));
      const c5 = _vecAdd(atoms.CG, _vecScale(f.u, R5));
      atoms.ND1 = ringAt(c5, f, R5, 108);
      atoms.CE1 = ringAt(c5, f, R5, 36);
      atoms.NE2 = ringAt(c5, f, R5, -36);
      atoms.CD2 = ringAt(c5, f, R5, -108);
      ringH('HD2', atoms.CD2, c5);
      ringH('HE1', atoms.CE1, c5);
      break;
    }
    case 'I':
      P('CG1', 'N', 'CA', 'CB', 1.52, 110.5, -60);
      P('CG2', 'N', 'CA', 'CB', 1.52, 110.5, 120);
      H('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      P('CD1', 'CA', 'CB', 'CG1', 1.52, 112, 180);
      CH2('CG1', 'CA', 'CB');
      CH3('CG2', 'CA', 'CB');
      CH3('CD1', 'CB', 'CG1');
      break;
    case 'L':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      H('HG', 'CA', 'CB', 'CG', 1.09, 109.5, 180);
      P('CD1', 'CA', 'CB', 'CG', 1.52, 110.5, 60);
      P('CD2', 'CA', 'CB', 'CG', 1.52, 110.5, -60);
      CH3('CD1', 'CB', 'CG');
      CH3('CD2', 'CB', 'CG');
      break;
    case 'K':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      P('CD', 'CA', 'CB', 'CG', 1.52, 110.5, 180); CH2('CG', 'CA', 'CB');
      P('CE', 'CB', 'CG', 'CD', 1.52, 110.5, 180); CH2('CD', 'CB', 'CG');
      P('NZ', 'CG', 'CD', 'CE', 1.46, 111, 180); CH2('CE', 'CG', 'CD');
      ['HZ1', 'HZ2', 'HZ3'].forEach((nm, i) => H(nm, 'CD', 'CE', 'NZ', 1.01, 109.5, [60, 180, -60][i]));
      break;
    case 'M':
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -60); CH2('CB', 'N', 'CA');
      P('SD', 'CA', 'CB', 'CG', 1.81, 112, 180); CH2('CG', 'CA', 'CB');
      P('CE', 'CB', 'CG', 'SD', 1.78, 100, 180);
      CH3('CE', 'CG', 'SD');
      break;
    case 'F':
    case 'Y': {
      P('CG', 'N', 'CA', 'CB', 1.50, 110.5, -60); // <-- was missing
      CH2('CB', 'N', 'CA');
      const f = ringFrame('CB', 'CG', 'CA', 'CB');
      const c6 = _vecAdd(atoms.CG, _vecScale(f.u, 1.39));
      atoms.CD1 = ringAt(c6, f, 1.39, 120);
      atoms.CE1 = ringAt(c6, f, 1.39, 60);
      atoms.CZ = ringAt(c6, f, 1.39, 0);
      atoms.CE2 = ringAt(c6, f, 1.39, -60);
      atoms.CD2 = ringAt(c6, f, 1.39, -120);
      ringH('HD1', atoms.CD1, c6);
      ringH('HE1', atoms.CE1, c6);
      ringH('HE2', atoms.CE2, c6);
      ringH('HD2', atoms.CD2, c6);
      if (char === 'Y') {
        const dir = _vecNormalize(_vecSub(atoms.CZ, c6));
        atoms.OH = _vecAdd(atoms.CZ, _vecScale(dir, 1.36));
        atoms.HH = _vecAdd(atoms.OH, _vecScale(_vecNormalize(_vecAdd(dir, _vecScale(f.v, 0.9))), 0.97));
      } else {
        ringH('HZ', atoms.CZ, c6);
      }
      break;
    }
    case 'P': {
      CH2('CB', 'N', 'CA');
      P('CG', 'N', 'CA', 'CB', 1.52, 110.5, -30);
      CH2('CG', 'CA', 'CB');
      // Close the ring: CD must be 1.52 Å from CG and 1.46 Å from N.
      atoms.CD = _ringClose(atoms.CG, atoms.N, 1.52, 1.46, atoms.CA);
      CH2('CD', 'CB', 'CG');
      break;
    }
    case 'S':
      P('OG', 'N', 'CA', 'CB', 1.417, 109.5, -60); CH2('CB', 'N', 'CA');
      H('HG', 'CA', 'CB', 'OG', 0.97, 109, 180);
      break;
    case 'T':
      H('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      P('OG1', 'N', 'CA', 'CB', 1.43, 109.5, 60);
      P('CG2', 'N', 'CA', 'CB', 1.52, 109.5, -60);
      H('HG1', 'CA', 'CB', 'OG1', 0.97, 109, 180);
      CH3('CG2', 'N', 'CA');
      break;
    case 'V': // <-- was missing entirely
      H('HB', 'N', 'CA', 'CB', 1.09, 109.5, 180);
      P('CG1', 'N', 'CA', 'CB', 1.521, 110.5, 60);
      P('CG2', 'N', 'CA', 'CB', 1.521, 110.5, -60);
      CH3('CG1', 'N', 'CA');
      CH3('CG2', 'N', 'CA');
      break;
    case 'W': {
      P('CG', 'N', 'CA', 'CB', 1.50, 110.5, -60); // <-- was missing
      CH2('CB', 'N', 'CA');
      const f = ringFrame('CB', 'CG', 'CA', 'CB');
      const R5 = 1.36 / (2 * Math.sin(Math.PI / 5));
      const c5 = _vecAdd(atoms.CG, _vecScale(f.u, R5));
      atoms.CD1 = ringAt(c5, f, R5, 108);
      atoms.NE1 = ringAt(c5, f, R5, 36);
      atoms.CE2 = ringAt(c5, f, R5, -36);
      atoms.CD2 = ringAt(c5, f, R5, -108);
      // Fused benzene ring on edge CE2–CD2
      const mid2 = _vecScale(_vecAdd(atoms.CE2, atoms.CD2), 0.5);
      const w = _vecNormalize(_vecSub(mid2, c5));
      const s6 = 1.39;
      const c6 = _vecAdd(mid2, _vecScale(w, (Math.sqrt(3) / 2) * s6));
      const p2 = _vecNormalize(_vecCross(f.n, w));
      const hexAt = (deg) => _vecAdd(c6, _vecAdd(
        _vecScale(w, s6 * Math.cos(_deg2rad(deg))),
        _vecScale(p2, s6 * Math.sin(_deg2rad(deg)))
      ));
      atoms.CZ2 = hexAt(90);
      atoms.CH2 = hexAt(30);
      atoms.CZ3 = hexAt(-30);
      atoms.CE3 = hexAt(-90);
      ringH('HD1', atoms.CD1, c5);
      ringH('HE1', atoms.NE1, c5);
      ringH('HZ2', atoms.CZ2, c6);
      ringH('HH2', atoms.CH2, c6);
      ringH('HZ3', atoms.CZ3, c6);
      ringH('HE3', atoms.CE3, c6);
      break;
    }
    default: break;
  }
  const backbone = new Set(['N', 'CA', 'C', 'O', 'CB']);
  return Object.entries(atoms)
    .filter(([name]) => !backbone.has(name))
    .map(([name, pos]) => ({ name, pos }));
};

const buildProteinBackbone = (seq, ssString) => {
  const n = seq.length;
  const B = PROTEIN_BB;
  const N0 = [0, 0, 0];
  const CA0 = [B.N_CA, 0, 0];
  const C0 = [B.N_CA - B.CA_C * Math.cos(B.ANG_N_CA_C), B.CA_C * Math.sin(B.ANG_N_CA_C), 0];
  const residues = [{ N: N0, CA: CA0, C: C0 }];
  const ssAt = (i) => (ssString && ssString[i]) || 'C';
  for (let i = 1; i < n; i++) {
    const prev = residues[i - 1];
    const psiPrev = ssTorsionAt(ssAt(i - 1)).psi;
    const Ni = nerfPlace(prev.N, prev.CA, prev.C, B.C_N, B.ANG_CA_C_N, psiPrev);
    const CAi = nerfPlace(prev.CA, prev.C, Ni, B.N_CA, B.ANG_C_N_CA, B.OMEGA);
    const phiI = ssTorsionAt(ssAt(i)).phi;
    const Ci = nerfPlace(prev.C, Ni, CAi, B.CA_C, B.ANG_N_CA_C, phiI);
    residues.push({ N: Ni, CA: CAi, C: Ci });
  }
  for (let i = 0; i < n; i++) {
    const r = residues[i];
    const psiI = ssTorsionAt(ssAt(i)).psi;
    r.O = nerfPlace(r.N, r.CA, r.C, B.C_O, B.ANG_CA_C_O, psiI - Math.PI);
    if (seq[i] !== 'G') r.CB = nerfPlace(r.C, r.N, r.CA, B.CA_CB, _deg2rad(110.5), _deg2rad(-122.5));
  }
  return residues;
};

const proteinSequenceToPdbText = (seq, ssString, title = 'GENERATED') => {
  const residues = buildProteinBackbone(seq, ssString);
  const lines = [
    'HEADER    IDEALIZED ALL-ATOM MODEL (GENERATED)',
    `TITLE     ${title}`,
    'REMARK   1 Idealized geometry built from sequence + secondary structure (or a fully',
    'REMARK   1 extended fallback), including complete side chains and hydrogens.',
    'REMARK   1 Not an experimental or energy-minimized structure.',
  ];
  let serial = 1;
  residues.forEach((r, i) => {
    const char = seq[i];
    const resName = AA_1_TO_3[char] || 'UNK';
    // Backbone hydrogens (HA always; HN for non-Pro; H1/H2/H3 on the N-terminus)
    const bbH = [];
    try {
      r.HA = nerfPlace(r.O, r.C, r.CA, 1.09, _deg2rad(109.5), _deg2rad(180));
      bbH.push({ name: 'HA', pos: r.HA });
      if (i === 0) {
        if (char !== 'P') {
          [60, 180, -60].forEach((tor, k) => {
            bbH.push({ name: `H${k + 1}`, pos: nerfPlace(r.HA, r.CA, r.N, 1.01, _deg2rad(109.5), _deg2rad(tor)) });
          });
        }
      } else if (char !== 'P') {
        bbH.push({ name: 'H', pos: nerfPlace(residues[i - 1].C, r.N, r.CA, 1.01, _deg2rad(120), _deg2rad(180)) });
      }
    } catch (e) {
      console.warn(`Backbone-H placement failed for residue ${i + 1} (${char}), continuing without them:`, e);
    }
    // Side chain -- never let one residue's spec kill the whole structure
    let sidechain = [];
    try {
      sidechain = placeSidechainAtoms(char, r);
    } catch (e) {
      console.warn(`Side-chain generation failed for residue ${i + 1} (${char}), keeping backbone only:`, e);
    }
    const ordered = [];
    ['N', 'CA', 'C', 'O', 'CB'].forEach((nm) => { if (r[nm]) ordered.push({ name: nm, pos: r[nm] }); });
    bbH.forEach((a) => ordered.push(a));
    sidechain.forEach((a) => ordered.push(a));
    ordered.forEach((a) => {
      if (!a || !Array.isArray(a.pos) || a.pos.some((v) => !Number.isFinite(v))) return;
      lines.push(pdbAtomLine({
        serial: serial++, atomName: a.name, element: a.name[0], resName, chain: 'A',
        resSeq: i + 1, x: a.pos[0], y: a.pos[1], z: a.pos[2],
      }));
    });
  });
  lines.push('TER', 'END');
  return lines.join('\n') + '\n';
};

// ---- Nucleic acid full-nucleotide builder (explicit idealized coordinates) ----
// The sugar is an EXACT closed regular pentagon (so the ribose ring always shows),
// the base is an exact planar ring attached to C1' (glycosidic bond, never to the
// phosphate), and every exocyclic substituent is placed with near-tetrahedral
// directions so that all non-bonded distances stay physical and NGL never infers
// erroneous bonds. The O3'(i)-P(i+1) linkage is exactly 1.61 Å by construction.
const DNA_1_TO_3 = { A: 'DA', C: 'DC', G: 'DG', T: 'DT' };
const RNA_1_TO_3 = { A: 'A', C: 'C', G: 'G', U: 'U' };
const buildNucleotideAtoms = (kind, char) => {
  const isRNA = kind === 'rna';
  const at = {};
  const Z = [0, 0, 1];
  const Rr = 1.47 / (2 * Math.sin(Math.PI / 5));
  const rad = {};
  [["O4'", 90], ["C1'", 18], ["C2'", -54], ["C3'", -126], ["C4'", 162]].forEach(([nm, deg]) => {
    const a = _deg2rad(deg);
    rad[nm] = [Math.cos(a), Math.sin(a), 0];
    at[nm] = _vecScale(rad[nm], Rr);
  });
  const exoDirs = (X, A, B) => {
    const a = _vecNormalize(_vecSub(at[A], at[X]));
    const b = _vecNormalize(_vecSub(at[B], at[X]));
    const s = _vecNormalize(_vecAdd(a, b));
    return [
      _vecNormalize(_vecAdd(_vecScale(s, -0.568), _vecScale(Z, 0.823))),
      _vecNormalize(_vecAdd(_vecScale(s, -0.568), _vecScale(Z, -0.823))),
    ];
  };
  // ---- Base on C1' ----
  const [c1Up, c1Down] = exoDirs("C1'", "O4'", "C2'");
  const bu = c1Up;
  const bw = _vecNormalize(_vecSub(Z, _vecScale(bu, _vecDot(Z, bu))));
  const bAt = (c, r, deg) => _vecAdd(c, _vecAdd(_vecScale(bu, r * Math.cos(_deg2rad(deg))), _vecScale(bw, r * Math.sin(_deg2rad(deg)))));
  const bRad = (p, c) => _vecNormalize(_vecSub(p, c));
  const bExt = (p, c, l) => _vecAdd(p, _vecScale(bRad(p, c), l));
  const isPur = char === 'A' || char === 'G';
  if (!isPur) {
    const N1 = _vecAdd(at["C1'"], _vecScale(bu, 1.47));
    const c6 = _vecAdd(N1, _vecScale(bu, 1.39));
    at.N1 = N1; at.C2 = bAt(c6, 1.39, 120); at.N3 = bAt(c6, 1.39, 60);
    at.C4 = bAt(c6, 1.39, 0); at.C5 = bAt(c6, 1.39, -60); at.C6 = bAt(c6, 1.39, -120);
    at.O2 = bExt(at.C2, c6, 1.22);
    if (char === 'C') {
      at.N4 = bExt(at.C4, c6, 1.33);
      const r4 = bRad(at.C4, c6);
      at.H41 = _vecAdd(at.N4, _vecScale(_vecNormalize(_vecAdd(r4, _vecScale(bw, 0.6))), 1.01));
      at.H42 = _vecAdd(at.N4, _vecScale(_vecNormalize(_vecSub(r4, _vecScale(bw, 0.6))), 1.01));
    } else {
      at.O4 = bExt(at.C4, c6, 1.22);
    }
    if (char === 'T') {
      at.C7 = bExt(at.C5, c6, 1.49);
      const r7 = bRad(at.C5, c6);
      at.H71 = _vecAdd(at.C7, _vecScale(_vecNormalize(_vecAdd(r7, bw)), 1.09));
      at.H72 = _vecAdd(at.C7, _vecScale(_vecNormalize(_vecSub(r7, bw)), 1.09));
      at.H73 = _vecAdd(at.C7, _vecScale(r7, 1.09));
    } else {
      at.H5 = bExt(at.C5, c6, 1.08);
    }
    at.H6 = bExt(at.C6, c6, 1.08);
  } else {
    const N9 = _vecAdd(at["C1'"], _vecScale(bu, 1.47));
    const R5 = 1.36 / (2 * Math.sin(Math.PI / 5));
    const c5 = _vecAdd(N9, _vecScale(bu, R5));
    at.N9 = N9; at.C8 = bAt(c5, R5, 108); at.N7 = bAt(c5, R5, 36);
    at.C5 = bAt(c5, R5, -36); at.C4 = bAt(c5, R5, -108);
    const mid2 = _vecScale(_vecAdd(at.C5, at.C4), 0.5);
    const w2 = _vecNormalize(_vecSub(mid2, c5));
    const s6 = 1.39;
    const c6 = _vecAdd(mid2, _vecScale(w2, (Math.sqrt(3) / 2) * s6));
    const p2 = _vecNormalize(_vecCross(_vecCross(bu, bw), w2));
    const hAt = (deg) => _vecAdd(c6, _vecAdd(_vecScale(w2, s6 * Math.cos(_deg2rad(deg))), _vecScale(p2, s6 * Math.sin(_deg2rad(deg)))));
    at.C6 = hAt(90); at.N1 = hAt(30); at.C2 = hAt(-30); at.N3 = hAt(-90);
    at.H8 = bExt(at.C8, c5, 1.08);
    if (char === 'A') {
      at.N6 = bExt(at.C6, c6, 1.33);
      const r6 = bRad(at.C6, c6);
      at.H61 = _vecAdd(at.N6, _vecScale(_vecNormalize(_vecAdd(r6, _vecScale(p2, 0.6))), 1.01));
      at.H62 = _vecAdd(at.N6, _vecScale(_vecNormalize(_vecSub(r6, _vecScale(p2, 0.6))), 1.01));
      at.H2 = bExt(at.C2, c6, 1.08);
    } else {
      at.O6 = bExt(at.C6, c6, 1.22);
      at.H1 = bExt(at.N1, c6, 1.01);
      at.N2 = bExt(at.C2, c6, 1.33);
      const r2 = bRad(at.C2, c6);
      at.H21 = _vecAdd(at.N2, _vecScale(_vecNormalize(_vecAdd(r2, _vecScale(p2, 0.6))), 1.01));
      at.H22 = _vecAdd(at.N2, _vecScale(_vecNormalize(_vecSub(r2, _vecScale(p2, 0.6))), 1.01));
    }
  }
  at["H1'"] = _vecAdd(at["C1'"], _vecScale(c1Down, 1.09));
  const [c2Up, c2Down] = exoDirs("C2'", "C1'", "C3'");
  if (isRNA) {
    at["O2'"] = _vecAdd(at["C2'"], _vecScale(c2Down, 1.43));
    const t2 = _vecNormalize(_vecCross(Z, c2Down));
    at["HO2'"] = _vecAdd(at["O2'"], _vecScale(_vecNormalize(_vecAdd(_vecScale(c2Down, 0.35), _vecScale(t2, 0.94))), 0.97));
    at["H2'"] = _vecAdd(at["C2'"], _vecScale(c2Up, 1.09));
  } else {
    at["H2'"] = _vecAdd(at["C2'"], _vecScale(c2Up, 1.09));
    at["H2''"] = _vecAdd(at["C2'"], _vecScale(c2Down, 1.09));
  }
  const [c3Up, c3Down] = exoDirs("C3'", "C2'", "C4'");
  at["O3'"] = _vecAdd(at["C3'"], _vecScale(c3Down, 1.43));
  at["H3'"] = _vecAdd(at["C3'"], _vecScale(c3Up, 1.09));
  const [c4Up, c4Down] = exoDirs("C4'", "C3'", "O4'");
  at["C5'"] = _vecAdd(at["C4'"], _vecScale(c4Up, 1.52));
  at["H4'"] = _vecAdd(at["C4'"], _vecScale(c4Down, 1.09));
  const out5 = _vecNormalize(_vecSub(at["C5'"], at["C4'"]));
  let p5 = _vecCross(Z, out5);
  if (_vecNorm(p5) < 1e-6) p5 = _vecCross([1, 0, 0], out5);
  p5 = _vecNormalize(p5);
  const cone5 = (phi) => _vecNormalize(_vecAdd(_vecAdd(_vecScale(out5, 0.334), _vecScale(p5, 0.943 * Math.cos(phi))), _vecScale(Z, 0.943 * Math.sin(phi))));
  const o5d = cone5(Math.PI / 2);
  at["O5'"] = _vecAdd(at["C5'"], _vecScale(o5d, 1.44));
  at["H5'"] = _vecAdd(at["C5'"], _vecScale(cone5(Math.PI * 7 / 6), 1.09));
  at["H5''"] = _vecAdd(at["C5'"], _vecScale(cone5(-Math.PI / 6), 1.09));
  const w = o5d;
  at.P = _vecAdd(at["O5'"], _vecScale(w, 1.593));
  let q = _vecCross(w, Z);
  if (_vecNorm(q) < 1e-6) q = _vecCross(w, [1, 0, 0]);
  q = _vecNormalize(q);
  const r = _vecNormalize(_vecCross(w, q));
  const coneP = (phi) => _vecNormalize(_vecAdd(_vecAdd(_vecScale(w, 0.334), _vecScale(q, 0.943 * Math.cos(phi))), _vecScale(r, 0.943 * Math.sin(phi))));
  at.OP1 = _vecAdd(at.P, _vecScale(coneP(_deg2rad(90)), 1.5));
  at.OP2 = _vecAdd(at.P, _vecScale(coneP(_deg2rad(210)), 1.5));
  return at;
};
const buildNucleicAcidBackbone = (seq, kind) => {
  const first = buildNucleotideAtoms(kind, seq[0]);
  const d = _vecNormalize(_vecSub(first["O3'"], first["C3'"]));
  const T = _vecSub(_vecAdd(first["O3'"], _vecScale(d, 1.61)), first.P);
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    const tpl = i === 0 ? first : buildNucleotideAtoms(kind, seq[i]);
    const off = _vecScale(T, i);
    Object.entries(tpl).forEach(([name, pos]) => out.push({ resIdx: i, name, pos: _vecAdd(pos, off) }));
  }
  return out;
};
const nucleicSequenceToPdbText = (seq, kind = 'dna', title = 'GENERATED') => {
  const map = kind === 'rna' ? RNA_1_TO_3 : DNA_1_TO_3;
  const atoms = buildNucleicAcidBackbone(seq, kind);
  const lines = [
    'HEADER    EXTENDED ALL-ATOM NUCLEIC MODEL (GENERATED)',
    `TITLE     ${title}`,
    'REMARK   1 Complete nucleotides (closed ribose ring, base on C1\', phosphates) in',
    'REMARK   1 idealized extended geometry. Not an experimental structure.',
  ];
  let serial = 1;
  atoms.forEach((a) => {
    const resName = map[seq[a.resIdx]] || 'N';
    lines.push(pdbAtomLine({
      het: false, serial: serial++, atomName: a.name, element: a.name[0], resName,
      chain: 'A', resSeq: a.resIdx + 1, x: a.pos[0], y: a.pos[1], z: a.pos[2],
    }));
  });
  lines.push('TER', 'END');
  return lines.join('\n') + '\n';
};
// ================= REMOTE 3D STRUCTURE FETCH (organic SMILES -> validated PDB text) =================
// Fetched ourselves (rather than letting the NGL viewer fetch the URL directly) so we can validate
// the response actually looks like a PDB before handing it to the viewer -- NCI Cactus sometimes
// returns an HTML error page with a 200 status when 3D coordinate generation fails/times out, which
// a lenient PDB parser can silently render as an empty, invisible structure with no error shown.
const looksLikePdb = (text) => !!text && /^(ATOM|HETATM)/m.test(text) && !/<html/i.test(text);

const fetchCactusPdb = async (smiles) => {
  const res = await fetch(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/file?format=pdb&get3d=true`);
  if (!res.ok) throw new Error(`Cactus HTTP ${res.status}`);
  const text = await res.text();
  if (!looksLikePdb(text)) throw new Error('Cactus did not return a usable 3D structure for this SMILES');
  return text;
};

const fetchPubchemPdb = async (smiles) => {
  // POST (not a GET URL) avoids SMILES characters like "/" breaking PUG-REST's path-based routing.
  const cidRes = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/cids/txt', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(smiles)}`,
  });
  if (!cidRes.ok) throw new Error(`PubChem CID lookup HTTP ${cidRes.status}`);
  const cid = (await cidRes.text()).trim().split('\n')[0].trim();
  if (!cid || !/^\d+$/.test(cid)) throw new Error('PubChem did not resolve a CID for this SMILES');

  const sdfRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/record/SDF?record_type=3d`);
  if (!sdfRes.ok) throw new Error(`PubChem 3D SDF HTTP ${sdfRes.status}`);
  const sdf = await sdfRes.text();
  if (!sdf || sdf.trim().length === 0) throw new Error('PubChem returned an empty 3D record');
  return { sdf, ext: 'sdf' };
};

// Tries Cactus first (PDB), then PubChem (SDF) as an independent fallback. Returns
// { text, ext } or throws with a message suitable for surfacing to the user.
const resolveOrganicStructureText = async (smiles) => {
  const errors = [];
  try {
    const text = await fetchCactusPdb(smiles);
    return { text, ext: 'pdb' };
  } catch (e) { errors.push(`Cactus: ${e.message}`); }
  try {
    const { sdf } = await fetchPubchemPdb(smiles);
    return { text: sdf, ext: 'sdf' };
  } catch (e) { errors.push(`PubChem: ${e.message}`); }
  throw new Error(`No 3D structure could be resolved for this SMILES.\n${errors.join('\n')}`);
};

// ================= SHARED DERIVED DATA HOOK =================
const useNmrDerived = (activeTest, ctx = {}) => {
  const moleculeType = activeTest.moleculeType || 'protein';
  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();
  const validChars = moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY' : moleculeType === 'dna' ? 'ACGT' : moleculeType === 'rna' ? 'ACGU' : '';
  const seq = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna' ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const images = activeTest.nmrSpectraImages || [];
  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';
  const hasPhosphorus = moleculeType === 'dna' || moleculeType === 'rna' || moleculeType === 'lipid';
  const DB = moleculeType === 'protein' ? AMINO_ACID_DB : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;
  const fields = getExperimentalFields(ctx);
  const instances = getInstances(ctx, activeTest);
  const activeInstanceId = ctx?.activeInstanceId || activeTest.id;
  const activeInstance = instances.find((i) => i.id === activeInstanceId) || instances[0] || null;
  const layers = getLayers(activeTest);
  const activeLayerKey = getActiveLayerKey(activeTest);
  const allLayerValues = {};
  layers.forEach(l => {
    allLayerValues[l.key] = getInstanceValues(activeInstance, true, activeTest, l.key);
  });
  const shifts = allLayerValues['cs'] || {};
  const activeValues = shifts;
  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');
  const formsRaw = activeTest.nucleicForms || '';
  const dnaFormDefault = activeTest.dnaForm || 'B';
  const getFormAt = (i) => (formsRaw[i] && 'ABZ'.includes(formsRaw[i]) ? formsRaw[i] : dnaFormDefault);
  const sugarConf = activeTest.sugarConf || 'chair';
  const sugarAnomer = activeTest.sugarAnomer || 'alpha';
  const lipidDB = activeTest.lipidDB || 'cis';
  const typeLabel = moleculeType === 'protein' ? 'Protein' : moleculeType === 'dna' ? 'DNA' : moleculeType === 'rna' ? 'RNA' : moleculeType === 'sugar' ? 'Sugar' : moleculeType === 'organic' ? 'Organic' : 'Phospholipid';
  
  const nucDefs = moleculeType === 'protein' ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] }
    : moleculeType === 'dna' || moleculeType === 'rna' ? { H: ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] }
    : { H: [], N: [], C: [] };
    
  const parsedSeq = useMemo(() => {
    let chars = [];
    if (moleculeType === 'organic') {
      if (!activeTest.smiles) return [];
      
      let atoms = [];
      // Dynamically extract elements (including explicit Hs) from SMILES if RDKit is ready
   if (window.__RDKit) {
     try {
       const mol = getMolWithExplicitHs(activeTest.smiles);
       if (!mol) throw new Error('RDKit could not parse this SMILES');
       
       // Safely call get_molblock with a fallback
       if (typeof mol.get_molblock === 'function') {
         const molblock = mol.get_molblock();
         atoms = deriveOrganicAtomNaming(molblock).atomNameList;
       } else {
         throw new Error('mol.get_molblock is not a function in this RDKit version');
       }
       
       if (typeof mol.delete === 'function') mol.delete();
     } catch (e) {
       console.warn("RDKit organic parsing failed, using fallback atoms:", e);
       atoms = Array.from({ length: 40 }, (_, i) => `Atom-${i}`);
     }
   } else {
        atoms = Array.from({ length: 40 }, (_, i) => `Atom-${i}`);
      }

      const ranges = {}; const organicShifts = {}; const uniqueCShifts = {}; const shifts13C = {};
      atoms.forEach(a => {
        ranges[a] = { min: 1, max: 200 };
        if (a.startsWith('H')) organicShifts[a] = parseFloat((1 + Math.random() * 8).toFixed(2));
        else if (a.startsWith('C')) uniqueCShifts[a] = parseFloat((20 + Math.random() * 150).toFixed(1));
        else organicShifts[a] = parseFloat((1 + Math.random() * 10).toFixed(2));
      });
      return [{
        name: 'Organic', code3: 'Org', char: 'O', id: 'ORG1', color: '#3b82f6',
        atoms, ranges, shifts: organicShifts, uniqueCShifts, shifts13C, backboneRand: null, p31: 0,
        cosy: [], spinSystems: []
      }];
    }
    
    if (isPolymer) { if (!seq) return []; chars = seq.split(''); }
    else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];
    
    const assignedShifts = [];
    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      const generatedShifts = {};
      Object.keys(entry.ranges).forEach((atom) => {
        const r = entry.ranges[atom];
        let val = r.min;
        if (moleculeType === 'protein' && RANDOM_COIL_DB[char]) {
          if (atom === 'Hα' && RANDOM_COIL_DB[char].HA != null) {
            val = RANDOM_COIL_DB[char].HA;
            generatedShifts[atom] = parseFloat(val.toFixed(2));
            assignedShifts.push(val);
            return;
          }
        }
        let success = false; let minDistance = 0.3;
        while (minDistance >= 0.05 && !success) {
          for (let i = 0; i < 50; i++) {
            const candidate = r.min + Math.random() * (r.max - r.min);
            if (!assignedShifts.some((a) => Math.abs(a - candidate) < minDistance)) { val = candidate; success = true; break; }
          }
          minDistance -= 0.05;
        }
        assignedShifts.push(val);
        generatedShifts[atom] = parseFloat(val.toFixed(2));
      });
      const cShifts = {}; const generatedShifts13C = {};
      Object.keys(generatedShifts).forEach((atom) => {
        const cName = getCarbonName(moleculeType, char, atom);
        if (!cName) return;
        if (!cShifts[cName]) {
          let baseVal;
          if (moleculeType === 'protein' && RANDOM_COIL_DB[char]) {
            if (cName === 'Cα' && RANDOM_COIL_DB[char].CA != null) baseVal = RANDOM_COIL_DB[char].CA;
            else if (cName === 'Cβ' && RANDOM_COIL_DB[char].CB != null) baseVal = RANDOM_COIL_DB[char].CB;
          }
          if (baseVal === undefined) {
            const range = getCarbonRangeFor(moleculeType, char, cName);
            baseVal = range.min + Math.random() * (range.max - range.min);
          }
          cShifts[cName] = parseFloat(baseVal.toFixed(1));
        }
        generatedShifts13C[atom] = cShifts[cName];
      });
      const backboneRand = moleculeType === 'protein' ? { N: parseFloat((117 + Math.random() * 8).toFixed(1)), CP: RANDOM_COIL_DB[char]?.CO != null ? RANDOM_COIL_DB[char].CO : parseFloat((172 + Math.random() * 5).toFixed(1)) } : null;
      const p31 = hasPhosphorus ? parseFloat((-2 + Math.random() * 3).toFixed(2)) : null;
      return { ...entry, id: `${entry.code3 || char}${index + 1}`, char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts }, backboneRand, p31 };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice, activeTest.smiles]);
  
  const estSeq = useMemo(() => parsedSeq.map((res, idx) => {
    const ssLetter = moleculeType === 'protein' ? getSSAt(idx) : 'C';
    const ssKey = { C: 'coil', H: 'helix', E: 'sheet' }[ssLetter];
    const corr = SS_CORRECTIONS[ssKey];
    const estShifts = {};
    Object.keys(res.shifts || {}).forEach((a) => {
      let v = res.shifts[a];
      if (moleculeType === 'protein' && ssKey !== 'coil') { const h = corr.h; v += h[a] !== undefined ? h[a] : h.other || 0; }
      if (moleculeType === 'dna' || moleculeType === 'rna') { const f = getFormAt(idx); if (DNA_FORM_OFFSETS[f] && DNA_FORM_OFFSETS[f][a] !== undefined) v += DNA_FORM_OFFSETS[f][a]; }
      if (moleculeType === 'sugar') { const off = SUGAR_ANOMER_OFFSETS[sugarAnomer]; if (off && off[a] !== undefined) v += off[a]; }
      estShifts[a] = +v.toFixed(2);
    });
    const estUniqueC = {};
    Object.keys(res.uniqueCShifts || {}).forEach((cn) => {
      let v = res.uniqueCShifts[cn];
      if (moleculeType === 'protein' && ssKey !== 'coil') v += corr.c[cn] || 0;
      estUniqueC[cn] = +v.toFixed(2);
    });
    const estShifts13C = {};
    Object.keys(res.shifts13C || {}).forEach((a) => {
      const cn = getCarbonName(moleculeType, res.char, a);
      if (cn && estUniqueC[cn] !== undefined) estShifts13C[a] = estUniqueC[cn];
    });
    let estN = null; let estCP = null;
    if (moleculeType === 'protein' && res.backboneRand) {
      estN = +(res.backboneRand.N + (ssKey !== 'coil' ? corr.c['N'] || 0 : 0)).toFixed(2);
      estCP = +(res.backboneRand.CP + (ssKey !== 'coil' ? corr.c["C'"] || 0 : 0)).toFixed(2);
    }
    return { ...res, estShifts, estUniqueC, estShifts13C, estN, estCP, ssLetter, formLetter: getFormAt(idx) };
  }), [parsedSeq, moleculeType, ssRaw, formsRaw, dnaFormDefault, sugarAnomer]);
  
  const simSeq = useMemo(() => {
    const getMan = (idx, name) => {
      const candidates = [`${idx}-${name}`, `${idx}-${String(name).trim()}`, `${idx}-${String(name).replace(/\s+/g, '')}`];
      for (const k of candidates) { const m = parseManual(shifts[k]); if (m !== null) return m; }
      return null;
    };
    return estSeq.map((res, idx) => {
      const simShifts = {};
      Object.keys(res.estShifts || {}).forEach((a) => { const m = getMan(idx, a); simShifts[a] = m !== null ? m : res.estShifts[a]; });
      const simUniqueC = {};
      Object.keys(res.estUniqueC || {}).forEach((cn) => { const m = getMan(idx, cn); simUniqueC[cn] = m !== null ? m : res.estUniqueC[cn]; });
      const simShifts13C = {};
      Object.keys(res.estShifts13C || {}).forEach((a) => { const cn = getCarbonName(moleculeType, res.char, a); if (cn) simShifts13C[a] = simUniqueC[cn]; });
      let simN = null;
      if (moleculeType === 'protein' && res.estN !== null && res.estN !== undefined) { const mN = getMan(idx, 'N'); simN = mN !== null ? mN : res.estN; }
      let simCP = null;
      if (moleculeType === 'protein' && res.estCP !== null && res.estCP !== undefined) { const mCP = getMan(idx, "C'"); simCP = mCP !== null ? mCP : res.estCP; }
      return { ...res, simShifts, simUniqueC, simShifts13C, simN, simCP };
    });
  }, [estSeq, shifts, moleculeType]);
  
  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
    if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
    if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], sugarConf, sugarAnomer);
    if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], lipidDB);
    return null;
  }, [parsedSeq, moleculeType, sugarConf, sugarAnomer, lipidDB]);
  
  const peaks = useMemo(() => {
    let diag = [], cosy = [], tocsy = [], noesy = [], hsqc = [], hsqc15n = [], d1H = [], d13C = [], p31 = [];
    const addPair = (arr, x, y, label, type, colorClass, size, keys, atom1, atom2, ri, ch) => {
      arr.push({ x, y, label, type, colorClass, size, keys, resNum: ri + 1, resCode: ch, atom1, atom2 });
      arr.push({ x: y, y: x, label, type, colorClass, size, keys, resNum: ri + 1, resCode: ch, atom1: atom2, atom2: atom1 });
    };
    simSeq.forEach((res, index) => {
      if (!res.simShifts) return;
      const rN = index + 1;
      const rC = res.char;
      Object.entries(res.simShifts).forEach(([atom, ppm]) => {
        let pks = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        if (res.cosy) {
          res.cosy.forEach((pair) => {
            const neighborAtom = pair[0] === atom ? pair[1] : pair[1] === atom ? pair[0] : null;
            if (neighborAtom) {
              const count = getProtonCountEx(moleculeType, res, neighborAtom);
              totalNeighbors += count;
              const jC = 0.01 + Math.random() * 0.008;
              const pascalRow = getPascalRow(count);
              let newPeaks = [];
              pks.forEach((p) => { for (let k = 0; k <= count; k++) newPeaks.push({ shift: p.shift + (k - count / 2) * jC, intensity: p.intensity * pascalRow[k] }); });
              pks = newPeaks;
            }
          });
        }
        let merged = [];
        pks.sort((a, b) => a.shift - b.shift);
        pks.forEach((p) => {
          if (merged.length > 0) {
            const last = merged[merged.length - 1];
            if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; }
            else merged.push({ ...p });
          } else merged.push({ ...p });
        });
        const pCount = getProtonCountEx(moleculeType, res, atom);
        const maxIntensity = Math.max(...merged.map((p) => p.intensity));
        const baseIntensity = (1.5 + Math.random() * 0.5) * pCount;
        let multStr = 'm';
        if (totalNeighbors === 0) multStr = 's';
        else if (totalNeighbors === 1) multStr = 'd';
        else if (totalNeighbors === 2) multStr = merged.length === 3 ? 't' : 'dd';
        else if (totalNeighbors === 3) multStr = merged.length === 4 ? 'q' : 'm';
        const keys = buildKeys(index, [atom], moleculeType, res.char);
        merged.forEach((p) => d1H.push({ x: p.shift, y: (p.intensity / maxIntensity) * baseIntensity, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr, keys, resNum: rN, resCode: rC, atom1: atom, atom2: null }));
      });
      Object.entries(res.simUniqueC || {}).forEach(([cName, ppm]) => {
        d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cName}`, color: res.color, type: '1D', keys: [`${index}-${cName}`], resNum: rN, resCode: rC, atom1: null, atom2: cName });
      });
      if (moleculeType === 'protein' && res.simCP !== null && res.simCP !== undefined) {
        d13C.push({ x: res.simCP, y: 0.8 + Math.random() * 0.4, label: `${res.id} C'`, color: res.color, type: '1D', keys: [`${index}-C'`], resNum: rN, resCode: rC, atom1: null, atom2: "C'" });
      }
      Object.keys(res.simShifts).forEach((atom) => {
        diag.push({ x: res.simShifts[atom], y: res.simShifts[atom], label: `${res.id} ${atom}`, type: 'Diagonal', size: 4, keys: buildKeys(index, [atom], moleculeType, res.char), resNum: rN, resCode: rC, atom1: atom, atom2: atom });
      });
// COSY: 3-bond (from DB) + 2-bond (geminal) couplings
const cosyPairs = new Set();
if (res.cosy) res.cosy.forEach(([a1, a2]) => cosyPairs.add([a1, a2].sort().join('-')));

// Add geminal protons (2-bond separation, e.g., Hβ1 and Hβ2)
const hAtoms = Object.keys(res.simShifts).filter(a => a.startsWith('H'));
const geminalGroups = {};
hAtoms.forEach(a => {
  const baseMatch = a.match(/^(H.+?)(\d+)$/);
  if (baseMatch) {
    const base = baseMatch[1];
    if (!geminalGroups[base]) geminalGroups[base] = [];
    geminalGroups[base].push(a);
  }
});
Object.values(geminalGroups).forEach(group => {
  if (group.length > 1) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        cosyPairs.add([group[i], group[j]].sort().join('-'));
      }
    }
  }
});

cosyPairs.forEach(pairStr => {
  const [a1, a2] = pairStr.split('-');
  if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) {
    addPair(cosy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4, buildKeys(index, [a1, a2], moleculeType, res.char), a1, a2, index, res.char);
  }
});
      if (res.spinSystems) res.spinSystems.forEach((sys) => {
        for (let i = 0; i < sys.length; i++) for (let j = i + 1; j < sys.length; j++) {
          if (res.simShifts[sys[i]] !== undefined && res.simShifts[sys[j]] !== undefined) {
            const isDirect = res.cosy && res.cosy.some((c) => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i]));
            addPair(tocsy, res.simShifts[sys[i]], res.simShifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`, isDirect ? 'tocsyDirect' : 'tocsyRelay', 4, buildKeys(index, [sys[i], sys[j]], moleculeType, res.char), sys[i], sys[j], index, res.char);
          }
        }
      });
      const adj = {};
      if (res.cosy) res.cosy.forEach(([u, v]) => { if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
      const seenPairs = new Set();
      if (res.cosy) res.cosy.forEach(([a1, a2]) => {
        seenPairs.add([a1, a2].sort().join('-'));
        if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) addPair(noesy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (NOE Intra)`, 'noesyIntra', 4, buildKeys(index, [a1, a2], moleculeType, res.char), a1, a2, index, res.char);
      });
      Object.keys(adj).forEach((u) => adj[u].forEach((v) => adj[v].forEach((w) => {
        if (u !== w) {
          const pk = [u, w].sort().join('-');
          if (!seenPairs.has(pk)) {
            seenPairs.add(pk);
            if (res.simShifts[u] !== undefined && res.simShifts[w] !== undefined) addPair(noesy, res.simShifts[u], res.simShifts[w], res.id, `${u}-${w} (NOE 4-bond)`, 'noesyIntra4', 3, buildKeys(index, [u, w], moleculeType, res.char), u, w, index, res.char);
          }
        }
      })));
      if (index < simSeq.length - 1 && moleculeType === 'protein') {
        const nextRes = simSeq[index + 1];
        if (res.simShifts['HN'] !== undefined && nextRes.simShifts['HN'] !== undefined) {
          addPair(noesy, res.simShifts['HN'], nextRes.simShifts['HN'], 'Seq. NOE', `${res.id} HN ↔ ${nextRes.id} HN`, 'noesySeq', 3, [...buildKeys(index, ['HN'], 'protein', res.char), ...buildKeys(index + 1, ['HN'], 'protein', nextRes.char)], 'HN', 'HN', index, res.char);
        }
      }
      Object.keys(res.simShifts13C || {}).forEach((atom) => {
        if (res.simShifts[atom] !== undefined) {
          const cn = getCarbonName(moleculeType, res.char, atom);
          hsqc.push({ x: res.simShifts[atom], y: res.simShifts13C[atom], label: `${res.id} ${atom}-${cn}`, type: 'HSQC', colorClass: 'hsqc', size: 4, keys: [...buildKeys(index, [atom], moleculeType, res.char), `${index}-${cn}`], resNum: rN, resCode: rC, atom1: atom, atom2: cn });
        }
      });
if (moleculeType === 'protein' && res.simN !== null && res.simN !== undefined && res.simShifts['HN'] !== undefined) {
  hsqc15n.push({ x: res.simShifts['HN'], y: res.simN, label: `${res.id} HN-N`, type: 'HSQC', colorClass: 'hsqc15n', size: 4, keys: [...buildKeys(index, ['HN'], moleculeType, res.char), `${index}-N` ], resNum: rN, resCode: rC, atom1: 'HN', atom2: 'N' });
}
      if (hasPhosphorus && res.p31 !== null) {
        p31.push({ x: res.p31, y: 0.8 + Math.random() * 0.4, label: `${res.id} P`, color: res.color, type: '1D', colorClass: 'p31', keys: [`${index}-P`], resNum: rN, resCode: rC, atom1: null, atom2: 'P' });
      }
    });
    return { diagonalData: diag, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, hsqc15NPeaks: hsqc15n, data1H: d1H, data13C: d13C, p31Data: p31 };
  }, [simSeq, moleculeType, hasPhosphorus]);
  
  const uniqueTypes = useMemo(() => [...new Set(parsedSeq.map((r) => r.char))], [parsedSeq]);
  const ranges = useMemo(() => {
    const r1 = []; const r13 = [];
    uniqueTypes.forEach((char, index) => {
      const db = DB[char];
      if (!db) return;
      const color = RESIDUE_COLORS[Object.keys(DB).indexOf(char) % RESIDUE_COLORS.length];
      const label = db.code3 || char;
      const y = uniqueTypes.length - 1 - index;
      let atomIdx = 0;
      Object.keys(db.ranges).forEach((atom) => {
        const r = db.ranges[atom];
        r1.push({ x: (r.min + r.max) / 2, res: label, atom, min: r.min, max: r.max, y, color, level: atomIdx++ });
      });
      const cNames = new Set();
      Object.keys(db.ranges).forEach((atom) => { const cn = getCarbonName(moleculeType, char, atom); if (cn) cNames.add(cn); });
      if (moleculeType === 'protein') cNames.add("C'");
      let cIdx = 0;
      cNames.forEach((cn) => {
        const rg = getCarbonRangeFor(moleculeType, char, cn);
        r13.push({ x: (rg.min + rg.max) / 2, res: label, atom: cn, min: rg.min, max: rg.max, y, color, level: cIdx++ });
      });
    });
    return { ranges1H: r1, ranges13C: r13 };
  }, [uniqueTypes, moleculeType]);
  
  const atomOptions = useMemo(() => {
    const opts = [];
    estSeq.forEach((res, idx) => {
      Object.keys(res.estShifts || {}).forEach((a) => opts.push({ key: `${idx}-${a}`, label: `${res.id} ${a} (¹H)` }));
      if (moleculeType === 'protein' && res.estN !== null) opts.push({ key: `${idx}-N`, label: `${res.id} N (¹⁵N)` });
      Object.keys(res.estUniqueC || {}).forEach((cn) => opts.push({ key: `${idx}-${cn}`, label: `${res.id} ${cn} (¹³C)` }));
      if (moleculeType === 'protein' && res.estCP !== null) opts.push({ key: `${idx}-C'`, label: `${res.id} C' (¹³C)` });
      if (hasPhosphorus && res.p31 !== null) opts.push({ key: `${idx}-P`, label: `${res.id} P (³¹P)` });
    });
    return opts;
  }, [estSeq, moleculeType, hasPhosphorus]);
  
  return {
    moleculeType, seq, validChars, isPolymer, hasPhosphorus, DB, selNuc, shifts, images,
    fields, instances, activeInstanceId, activeInstance, layers, activeLayerKey, activeValues, allLayerValues, atomOptions,
    getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, dnaFormDefault, typeLabel, nucDefs,
    parsedSeq, estSeq, simSeq, structure, peaks, uniqueTypes, ranges
  };
};

// ================= IMPORT HELPERS =================
const GREEK_MAP = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'h' };
const normAtomName = (s) => String(s || '').trim().replace(/\s+/g, '').split('').map((ch) => GREEK_MAP[ch] || ch).join('').toUpperCase();
const ATOM_ALIASES = { HA: 'Hα', HB: 'Hβ', HG: 'Hγ', HD: 'Hδ', HE: 'Hε', HZ: 'Hζ', CA: 'Cα', CB: 'Cβ', CG: 'Cγ', CD: 'Cδ', CE: 'Cε', CZ: 'Cζ', C: "C'", CO: "C'", N: 'N', H: 'HN', HN: 'HN' };
const resolveAtom = (res, atomRaw, nameMap = {}) => {
  if (!res) return null;
  const pool = [...(res.atoms || [])];
  if (res.backboneRand) pool.push('N', "C'");
  Object.keys(res.uniqueCShifts || {}).forEach((c) => pool.push(c));
  const raw = String(atomRaw || '').trim();
  const cands = [raw, nameMap[raw], ATOM_ALIASES[normAtomName(raw)], raw.replace(/\s+/g, '')].filter(Boolean);
  for (const cand of cands) {
    const hit = pool.find((a) => normAtomName(a) === normAtomName(cand));
    if (hit) return hit;
  }
  return null;
};
const buildResLookup = (parsedSeq) => {
  const map = {};
  parsedSeq.forEach((r, i) => {
    map[String(i)] = i;
    map[String(i + 1)] = i;
    map[r.id.toLowerCase()] = i;
    map[(r.char + (i + 1)).toLowerCase()] = i;
    if (r.code3) map[(r.code3 + (i + 1)).toLowerCase()] = i;
  });
  return map;
};
const parseTableText = (text) => {
  const delim = text.includes('\t') ? '\t' : (text.split(';').length > text.split(',').length ? ';' : ',');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const iRes = head.findIndex((h) => /(res|position|seq|#)/.test(h));
  const iAtom = head.findIndex((h) => /(atom|nucleus|group|assignment)/.test(h));
  const iVal = head.findIndex((h) => /(value|shift|ppm|assign|intens|delta)/.test(h));
  const hasHeader = iAtom >= 0 || iVal >= 0;
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return rows.map((r) => ({
    res: r[hasHeader && iRes >= 0 ? iRes : 0],
    atom: r[hasHeader ? (iAtom >= 0 ? iAtom : 1) : 1],
    value: r[hasHeader ? (iVal >= 0 ? iVal : 2) : 2]
  })).filter((r) => r.atom);
};
const importRowsToValues = (rows, parsedSeq, nameMap = {}) => {
  const lookup = buildResLookup(parsedSeq);
  const out = {}; const missed = [];
  rows.forEach((r) => {
    const ri = lookup[String(r.res).toLowerCase().trim()];
    if (ri === undefined) { missed.push(r); return; }
    const atom = resolveAtom(parsedSeq[ri], r.atom, nameMap);
    if (!atom) { missed.push(r); return; }
    out[`${ri}-${atom}`] = String(r.value);
  });
  return { out, missed };
};
const remapAtomKeys = (values, parsedSeq, nameMap = {}) => {
  const out = {};
  Object.entries(values || {}).forEach(([k, v]) => {
    const parts = k.split('-');
    if (parts.length < 2) return;
    const ri = Number(parts[0]);
    const res = parsedSeq[ri];
    if (!res) return;
    const atom = resolveAtom(res, parts.slice(1).join('-'), nameMap);
    if (atom) out[`${ri}-${atom}`] = String(v);
  });
  return out;
};
const detectSparkyFormat = (text) => {
  if (/^\s*VARS/im.test(text) || /^\s*FORMAT/im.test(text) || /^\s*S\s+[\d-]/im.test(text)) return 'peaklist';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let hits = 0;
  lines.forEach((l) => { if (/^[A-Za-z]+\s?\d+[\s,]+[A-Za-z0-9'″"αβγδεζ]+[\s,]+[-+0-9.]+$/.test(l)) hits++; });
  return hits > 0 ? 'assignments' : 'peaklist';
};
const parseSparkyPeakList = (text) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let vars = null;
  const raw = [];
  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.startsWith('VARS')) { vars = line.replace(/^VARS/i, '').trim().split(/[\s,]+/).map((v) => v.toUpperCase()); continue; }
    if (/^(FORMAT|TITL|TITLE|AXES|TYPE|NE|NP|NC|SW|SF|XMIN|XMAX|YMIN|YMAX|XP|YP|FP|HZPPM|DATASET)/.test(up)) continue;
    const cleaned = line.replace(/^S\s+/i, '');
    const parts = cleaned.split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 2) raw.push(parts);
  }
  const idx = (names) => (vars ? vars.findIndex((v) => names.includes(v)) : -1);
  const iXf = idx(['X_PPM', 'X_AXIS', 'W2', 'X', 'PPM2', 'F2_PPM', 'F2']);
  const iX = iXf >= 0 ? iXf : 0;
  const iY = idx(['Y_PPM', 'Y_AXIS', 'W1', 'Y', 'PPM1', 'F1_PPM', 'F1']);
  const iInt = idx(['DATA', 'DATA1', 'INT', 'INTENSITY', 'HEIGHT', 'H']);
  const iVol = idx(['VOL', 'VOLUME', 'INTEGRAL', 'INTG']);
  const iAss = idx(['ASS', 'ASSIGNS', 'ASSIGNMENT', 'ASSIGNMENTS', 'ASSIGN', 'LABEL']);
  const isNum = (s) => s !== undefined && /^[-+0-9.eE]+$/.test(s) && !isNaN(parseFloat(s));
  return raw.map((parts) => {
    if (vars) {
      return {
        x: parseManual(parts[iX]),
        y: iY >= 0 ? parseManual(parts[iY]) : null,
        int: iInt >= 0 ? parseManual(parts[iInt]) : null,
        vol: iVol >= 0 ? parseManual(parts[iVol]) : null,
        ass: iAss >= 0 ? parts[iAss] : ''
      };
    }
    const nums = parts.filter(isNum).map(parseFloat);
    const strs = parts.filter((p) => !isNum(p));
    return { x: nums[0] ?? null, y: nums[1] ?? null, int: nums[2] ?? null, vol: nums[3] ?? null, ass: strs.join(' ') };
  }).filter((p) => p.x !== null || p.y !== null);
};
const parseAssignmentString = (str) => {
  const pieces = String(str || '').split(/[,;|]+/).map((s) => s.trim()).filter(Boolean);
  const out = []; let lastRes = null;
  pieces.forEach((pc) => {
    const toks = pc.replace(/[-–]/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    let res = null, atom = null;
    if (toks.length === 1) {
      const mm = toks[0].match(/^([A-Za-z]+)(\d+)$/);
      if (mm) { lastRes = toks[0]; return; }
      if (lastRes) { res = lastRes; atom = toks[0]; }
    } else {
      if (/^[A-Za-z]+\d+$/.test(toks[0])) { res = toks[0]; atom = toks.slice(1).join(' '); lastRes = res; }
      else if (/^\d+$/.test(toks[0]) && toks.length > 1 && /^[A-Za-z]/.test(toks[1])) { res = toks[0]; atom = toks.slice(1).join(' '); }
      else if (toks.length > 1 && /^\d+$/.test(toks[1])) { res = toks[0] + toks[1]; atom = toks.slice(2).join(' '); lastRes = res; }
      else if (lastRes) { res = lastRes; atom = toks.join(' '); }
    }
    if (res && atom) out.push({ res, atom });
  });
  return out;
};
const parseSparkyAssignments = (text) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    if (line.startsWith('#') || /^(VARS|FORMAT)/i.test(line)) return;
    let m = line.match(/^([A-Za-z]+[\s-]?\d+)[\s,]+([A-Za-z0-9'″"αβγδεζ]+)[\s,]+([-+0-9.]+)/);
    if (m) { out.push({ res: m[1], atom: m[2], value: m[3] }); return; }
    m = line.match(/^([A-Za-z]+\d+[-_][A-Za-z0-9'″"αβγδεζ]+)[\s,]+([-+0-9.]+)/);
    if (m) { const pieces = m[1].split(/[-_]/); out.push({ res: pieces[0], atom: pieces[1], value: m[2] }); }
  });
  return out;
};

// ================= FITTING ENGINE =================
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
  const t = []; let i = 0;
  const D = (c) => /[0-9.]/.test(c), A = (c) => /[a-zA-Z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (D(c)) { let j = i; while (j < s.length && D(s[j])) j++; t.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue; }
    if (A(c)) { let j = i; while (j < s.length && (A(s[j]) || /[0-9]/.test(s[j]))) j++; t.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    if ('+-*/^(),'.includes(c)) { t.push({ t: c }); i++; continue; }
    throw new Error('bad');
  }
  return t;
};
const parseExpression = (src) => {
  const tk = tokenizeExpr(src); let p = 0;
  const pk = () => tk[p];
  const eat = (t) => { if (!tk[p] || tk[p].t !== t) throw new Error('exp'); return tk[p++]; };
  const add = () => { let n = mul(); while (pk() && (pk().t === '+' || pk().t === '-')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: mul() }; } return n; };
  const mul = () => { let n = un(); while (pk() && (pk().t === '*' || pk().t === '/')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: un() }; } return n; };
  const un = () => { if (pk() && pk().t === '-') { eat('-'); return { type: 'un', a: un() }; } if (pk() && pk().t === '+') { eat('+'); return un(); } return pw(); };
  const pw = () => { let n = pr(); if (pk() && pk().t === '^') { eat('^'); n = { type: 'bin', op: '^', l: n, r: un() }; } return n; };
  const pr = () => {
    const t = pk(); if (!t) throw new Error('exp');
    if (t.t === 'num') { eat('num'); return { type: 'num', v: t.v }; }
    if (t.t === 'id') { eat('id'); if (pk() && pk().t === '(') { eat('('); const a = [add()]; while (pk() && pk().t === ',') { eat(','); a.push(add()); } eat(')'); return { type: 'call', name: t.v, args: a }; } return { type: 'sym', name: t.v }; }
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
    case 'sym': return n.name === 'x' ? s.x : n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : s[n.name];
    case 'un': return -evalAST(n.a, s);
    case 'bin': { const a = evalAST(n.l, s), b = evalAST(n.r, s); return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b); }
    case 'call': {
      const a = n.args.map((x) => evalAST(x, s));
      switch (n.name) {
        case 'exp': return Math.exp(a[0]); case 'log': return Math.log10(a[0]); case 'ln': return Math.log(a[0]);
        case 'sqrt': return Math.sqrt(a[0]); case 'sin': return Math.sin(a[0]); case 'cos': return Math.cos(a[0]);
        case 'tan': return Math.tan(a[0]); case 'abs': return Math.abs(a[0]); case 'pow': return Math.pow(a[0], a[1]);
        case 'min': return Math.min(...a); case 'max': return Math.max(...a);
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
    if (n.type === 'sym') { if (n.name !== 'x' && n.name !== 'pi' && n.name !== 'e') s.add(n.name); }
    if (n.type === 'bin') { w(n.l); w(n.r); }
    if (n.type === 'un') w(n.a);
    if (n.type === 'call') n.args.forEach(w);
  })(ast);
  return [...s];
};
export const fitGeneric = (pts, f0, P0) => {
  let P = [...P0];
  const f = (x, Pv) => f0(x, Pv);
  const ssr = (Pv) => { let s = 0; for (const p of pts) { const v = f(p.x, Pv); if (!isFinite(v)) return Infinity; const w = p.w || 1; s += w * (p.y - v) ** 2; } return s; };
  let lam = 1e-3, cur = ssr(P);
  for (let it = 0; it < 120 && isFinite(cur); it++) {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) { const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4); row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h); }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0)), g = P.map(() => 0);
    pts.forEach((p, i) => {
      const w = p.w || 1; const r = p.y - f(p.x, P);
      for (let a = 0; a < P.length; a++) { g[a] += w * J[i][a] * r; for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b]; }
    });
    for (let a = 0; a < P.length; a++) A[a][a] *= (1 + lam);
    const dvec = gaussSolve(A, g);
    if (!dvec) { lam *= 4; if (lam > 1e7) break; continue; }
    const P2 = P.map((v, k) => v + dvec[k]); const s2 = ssr(P2);
    if (isFinite(s2) && s2 < cur) { const pv = cur; P = P2; cur = s2; lam = Math.max(1e-8, lam / 2); if (Math.abs(pv - cur) < 1e-10) break; }
    else { lam *= 3; if (lam > 1e7) break; }
  }
  if (!P.every(isFinite)) return null;
  let sst = 0; const m = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.forEach((p) => sst += (p.y - m) ** 2);
  const df = Math.max(1, pts.length - P.length);
  const r2 = sst > 0 ? 1 - cur / sst : 1;
  const se = Math.sqrt(cur / df);
  const P_err = P.map(() => 0);
  try {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) { const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4); row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h); }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0));
    pts.forEach((p, i) => { const w = p.w || 1; for (let a = 0; a < P.length; a++) { for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b]; } });
    for (let i = 0; i < P.length; i++) {
      const e = P.map((_, j) => (i === j ? 1 : 0));
      const col = gaussSolve(A, e);
      if (col) P_err[i] = Math.sqrt(Math.max(0, col[i] * (cur / df)));
    }
  } catch (err) { /* ignore */ }
  return { params: P, paramsErr: P_err, r2, se, f: (x) => f(x, P) };
};
export const fitLinear = (pts) => {
  if (pts.length < 2) return null;
  const r = fitGeneric(pts, (x, P) => P[0] + P[1] * x, [0, 1]);
  return r ? { ...r, intercept: r.params[0], slope: r.params[1], interceptErr: r.paramsErr[0], slopeErr: r.paramsErr[1] } : null;
};
export const fit4PL = (pts) => {
  if (pts.length < 4) return null;
  const ys = pts.map((p) => p.y);
  const t = Math.max(...ys), b = Math.min(...ys);
  const r = fitGeneric(pts, (x, P) => P[1] + (P[0] - P[1]) / (1 + Math.pow(x / P[2], P[3])), [t, b, pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length), 1]);
  return r ? { ...r, top: r.params[0], bottom: r.params[1], ic50: r.params[2], hill: r.params[3], topErr: r.paramsErr[0], bottomErr: r.paramsErr[1], ic50Err: r.paramsErr[2], hillErr: r.paramsErr[3] } : null;
};
export const fitCustomEquation = (expr, pts) => {
  let ast, par;
  try { ast = parseExpression(expr); par = collectParams(ast); } catch (e) { return null; }
  if (!par.length || pts.length < par.length + 1) return null;
  const init = par.map((_, i) => (i === 0 ? pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length) : 1));
  const res = fitGeneric(pts, (x, P) => { const s = { x }; par.forEach((n, i) => s[n] = P[i]); return evalAST(ast, s); }, init);
  if (!res) return null;
  res.params = Object.fromEntries(par.map((n, i) => [n, res.params[i]]));
  res.paramsErr = Object.fromEntries(par.map((n, i) => [n, res.paramsErr[i]]));
  return res;
};
export const runFit = (model, customExpr, wpts) => {
  if (model === 'linear') return fitLinear(wpts);
  if (model === '4pl') return fit4PL(wpts);
  if (model === 'custom' && customExpr) return fitCustomEquation(customExpr, wpts);
  return null;
};
export const fitParamOptions = (model, customExpr) => {
  if (model === 'linear') return ['slope', 'intercept'];
  if (model === '4pl') return ['top', 'bottom', 'ic50', 'hill'];
  if (model === 'custom') { try { return collectParams(parseExpression(customExpr || '')); } catch { return []; } }
  return [];
};
export const extractFitParam = (fit, model, param) => {
  if (!fit) return null;
  if (model === 'linear') return param === 'intercept' ? fit.intercept : fit.slope;
  if (model === '4pl') return ({ top: fit.top, bottom: fit.bottom, ic50: fit.ic50, hill: fit.hill })[param] ?? null;
  return fit.params?.[param] ?? null;
};
// ================= SHARED CHART STYLE + ZOOM =================
const useXZoom = (chartRef, dataDomain, margin = CHART_MARGIN) => {
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
      const end = getX(e.clientX);
      const start = loRef.current;
      if (start !== null && end !== null && Math.abs(end - start) > (effRef.current[1] - effRef.current[0]) * 0.01) {
        setDomain([Math.min(start, end), Math.max(start, end)]);
      }
      loRef.current = null;
      setLo(null); setHi(null);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);
  const onMouseDown = (e) => {
    const v = getX(e.clientX);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };
  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

const useCatZoom = (names) => {
  const [range, setRange] = useState(null);
  const [d0, setD0] = useState(null);
  const [d1, setD1] = useState(null);
  const idxOf = (label) => names.indexOf(label);
  const onMouseDown = (st) => { if (st && st.activeLabel != null) { setD0(String(st.activeLabel)); setD1(String(st.activeLabel)); } };
  const onMouseMove = (st) => { if (d0 != null && st && st.activeLabel != null) setD1(String(st.activeLabel)); };
  const onMouseUp = (st) => {
    if (d0 == null) return;
    const end = st && st.activeLabel != null ? String(st.activeLabel) : d1;
    const i0 = idxOf(d0), i1 = idxOf(end);
    setD0(null); setD1(null);
    if (i0 >= 0 && i1 >= 0 && i0 !== i1) setRange([Math.min(i0, i1), Math.max(i0, i1)]);
  };
  const visible = range ? names.slice(range[0], range[1] + 1) : names;
  return { visible, drag: [d0, d1], onMouseDown, onMouseMove, onMouseUp, reset: () => setRange(null), isZoomed: !!range };
};

const DEFAULT_CHART_STYLE = {
  height: 380, aspect: 1.8, fontSize: 12, tickStep: '', tickAngle: 0,
  pointStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2,
  legend: 'top', colors: {}, barRadius: 3,
  xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: ''
};

const lineDash = (style) => (style === 'dashed' ? '7 5' : style === 'dotted' ? '2 3' : undefined);
const seriesColor = (cfg, key, idx) => (cfg.colors && cfg.colors[key]) || LINE_COLORS[Math.max(0, idx) % LINE_COLORS.length];
const makeTicks = (domain, stepStr) => {
  const step = parseManual(stepStr);
  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;
  const [a, b] = [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])];
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(parseFloat(v.toFixed(6)));
  return out.length ? out : undefined;
};
const catInterval = (stepStr) => {
  const n = parseManual(stepStr);
  return n && n >= 1 ? Math.round(n) - 1 : 0;
};
const dom = (v) => (v === '' || v == null || parseManual(v) === null ? undefined : parseManual(v));
const chartBoxStyle = (cfg) => ({ width: '100%', aspectRatio: String(cfg.aspect || 1.8), maxHeight: cfg.height || 380, minHeight: 220 });

const AngledTick = ({ x, y, payload, angle = 0, fontSize = 11, anchor = 'middle' }) => {
  const a = Number(angle) || 0;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <text transform={a ? `rotate(${a})` : undefined} textAnchor={a < 0 ? 'end' : a > 0 ? 'start' : anchor}
        dy={a ? 4 : 12} dx={a ? (a > 0 ? 4 : -4) : 0} fill="#64748b" fontSize={fontSize}>
        {String(payload.value)}
      </text>
    </g>
  );
};

const NumField = ({ label, value, onChange, step = 1, w = 'w-full' }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className={`border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 ${w}`} />
  </div>
);

const TxtField = ({ label, value, onChange, placeholder = '', w = 'w-full' }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 ${w}`} />
  </div>
);

const SelField = ({ label, value, onChange, options }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);

const ChartStylePanel = ({ cfg, setCfg, series = [] }) => (
  <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
    <NumField label="Font size (px)" value={cfg.fontSize} onChange={(v) => setCfg({ fontSize: v || 12 })} />
    <NumField label="Chart height (px)" value={cfg.height} onChange={(v) => setCfg({ height: v || 380 })} />
    <NumField label="Aspect ratio X/Y (W÷H) — rectangularity" step={0.1} value={cfg.aspect} onChange={(v) => setCfg({ aspect: v || 1.8 })} />
    <TxtField label="Tick step (num: spacing · cat: every N)" value={cfg.tickStep} onChange={(v) => setCfg({ tickStep: v })} placeholder="auto" />
    <SelField label="Tick label orientation" value={String(cfg.tickAngle || 0)} onChange={(v) => setCfg({ tickAngle: Number(v) })}
      options={[['0', '0° (horizontal)'], ['-30', '-30°'], ['-45', '-45°'], ['-60', '-60°'], ['-90', '-90° (vertical)'], ['30', '30°'], ['45', '45°'], ['90', '90°']]} />
    <SelField label="Point style" value={cfg.pointStyle} onChange={(v) => setCfg({ pointStyle: v })}
      options={[['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['cross', 'Cross']]} />
    <NumField label="Point size" value={cfg.ptSize} onChange={(v) => setCfg({ ptSize: v || 5 })} />
    <SelField label="Line style" value={cfg.lineStyle} onChange={(v) => setCfg({ lineStyle: v })}
      options={[['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]} />
    <NumField label="Line thickness" step={0.5} value={cfg.lineThickness} onChange={(v) => setCfg({ lineThickness: v || 2 })} />
    <SelField label="Legend" value={cfg.legend} onChange={(v) => setCfg({ legend: v })} options={[['top', 'Top'], ['bottom', 'Bottom'], ['none', 'None']]} />
    <div className="flex flex-col gap-1"> <label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.xMin} onChange={(e) => setCfg({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.xMax} onChange={(e) => setCfg({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div> </div>
    <div className="flex flex-col gap-1"> <label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.yMin} onChange={(e) => setCfg({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.yMax} onChange={(e) => setCfg({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div> </div>
    <TxtField label="X axis label" value={cfg.xAxisLabel} onChange={(v) => setCfg({ xAxisLabel: v })} />
    <TxtField label="Y axis label" value={cfg.yAxisLabel} onChange={(v) => setCfg({ yAxisLabel: v })} />
    {series.length > 0 && (
      <div className="col-span-2 lg:col-span-4 pt-2 border-t border-slate-100 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Series colors (points / lines / bars)</label>
        <div className="flex flex-wrap gap-3">
          {series.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <input type="color" value={(cfg.colors && cfg.colors[s.key]) || s.color || '#3b82f6'}
                onChange={(e) => setCfg({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
                className="w-6 h-6 rounded cursor-pointer border border-slate-300" />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    )}
    <p className="col-span-2 lg:col-span-4 text-[9px] text-slate-400">💡 Drag with the mouse over any graph to zoom into a region. Use "Reset Zoom" to restore.</p>
  </div>
);
const getMolWithExplicitHs = (smiles) => {
  if (!window.__RDKit) return null;
  try {
    const mol = window.__RDKit.get_mol(smiles);
    if (!mol) return null;
    
    // 1. Genera coordinate 2D iniziali
    if (typeof mol.compute_2d_coords === 'function') {
      mol.compute_2d_coords();
    } else if (typeof mol.set_new_coords === 'function') {
      mol.set_new_coords();
    }
    
    // 2. Aggiungi idrogeni espliciti
    // In alcune build di RDKit JS, add_hs() restituisce una NUOVA stringa molblock 
    // invece di modificare l'oggetto in place. Dobbiamo gestire entrambi i casi.
    let molWithHs = mol;
    if (typeof mol.add_hs === 'function') {
      const result = mol.add_hs();
      if (typeof result === 'string') {
        molWithHs = window.__RDKit.get_mol(result);
      }
    } else if (typeof mol.addHs === 'function') {
      const result = mol.addHs();
      if (typeof result === 'string') {
        molWithHs = window.__RDKit.get_mol(result);
      }
    }
    
    // 3. Ricalcola le coordinate dopo l'aggiunta degli H per posizionarli correttamente
    if (typeof molWithHs.compute_2d_coords === 'function') {
      molWithHs.compute_2d_coords();
    } else if (typeof molWithHs.set_new_coords === 'function') {
      molWithHs.set_new_coords();
    }
    
    return molWithHs;
  } catch (e) {
    console.error('RDKit parse error:', e);
    return null;
  }
};

const deriveOrganicAtomNaming = (molblock) => {
  const lines = molblock.split('\n');
  const countsLine = lines[3] || '';
  const nA = parseInt(countsLine.substring(0, 3).trim(), 10) || 0;
  const nB = parseInt(countsLine.substring(3, 6).trim(), 10) || 0;
  
  const elements = [];
  const atomNameList = new Array(nA).fill('');
  const heavyAtomCounts = {};
  
  // 1. Analizza gli atomi
  for (let i = 0; i < nA; i++) {
    const line = lines[4 + i] || '';
    const elem = line.substring(31, 34).trim();
    elements.push(elem || 'C');
  }
  
  // 2. Analizza i legami per trovare l'atomo pesante genitore di ogni idrogeno
  const parentHeavyAtom = new Array(nA).fill(-1);
  for (let i = 0; i < nB; i++) {
    const line = lines[4 + nA + i] || '';
    const a1 = parseInt(line.substring(0, 3).trim(), 10) - 1;
    const a2 = parseInt(line.substring(3, 6).trim(), 10) - 1;
    
    if (a1 >= 0 && a1 < nA && a2 >= 0 && a2 < nA) {
      if (elements[a1] === 'H' && elements[a2] !== 'H') {
        parentHeavyAtom[a1] = a2;
      } else if (elements[a2] === 'H' && elements[a1] !== 'H') {
        parentHeavyAtom[a2] = a1;
      }
    }
  }
  
  // 3. Genera i nomi basati sul genitore (es. "H0a", "H0b")
  const hCounts = {};
  for (let i = 0; i < nA; i++) {
    const elem = elements[i];
    if (elem === 'H') {
      const parent = parentHeavyAtom[i];
      if (parent !== -1) {
        if (!hCounts[parent]) hCounts[parent] = 0;
        const suffix = String.fromCharCode(97 + hCounts[parent]); // 'a', 'b', 'c'...
        atomNameList[i] = `H${parent}${suffix}`;
        hCounts[parent]++;
      } else {
        // Fallback per idrogeni orfani (senza legami con atomi pesanti)
        if (!hCounts['orphan']) hCounts['orphan'] = 0;
        atomNameList[i] = `H_orphan${hCounts['orphan']}`;
        hCounts['orphan']++;
      }
    } else {
      if (!heavyAtomCounts[elem]) heavyAtomCounts[elem] = 0;
      heavyAtomCounts[elem]++;
      atomNameList[i] = `${elem}${heavyAtomCounts[elem]}`;
    }
  }
  
  return { atomNameList, elements };
};
// ==========================================================
// ==========================================================
// ================= ORGANIC VIEWER =================
const OrganicViewer = ({ smiles, selectedKeys, manualKeys = [], onAtomClick }) => {
  const [model, setModel] = useState(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const { rdkitReady, rdkitFailed } = useRdkitReady(); // global singleton — no per-instance interval

  useEffect(() => {
    if (!smiles || !rdkitReady) { setModel(null); return; }
    try {
      const mol = getMolWithExplicitHs(smiles);
      if (!mol) throw new Error('RDKit could not parse this SMILES');
      const molblock = mol.get_molblock();
      const { atomNameList, elements } = deriveOrganicAtomNaming(molblock);
      const lines = molblock.split('\n');
      const counts = lines[3] || '';
      const nA = parseInt(counts.substring(0, 3).trim(), 10) || 0;
      const nB = parseInt(counts.substring(3, 6).trim(), 10) || 0;
      const atoms = [];
      for (let i = 0; i < nA; i++) {
        const l = lines[4 + i] || '';
        atoms.push({ x: parseFloat(l.substring(0, 10)) || 0, y: parseFloat(l.substring(10, 20)) || 0, elem: elements[i] || 'C', name: atomNameList[i] || `X${i}` });
      }
const bonds = [];
for (let i = 0; i < nB; i++) {
  const l = lines[4 + nA + i] || '';
  const a1 = parseInt(l.substring(0, 3).trim(), 10) - 1;
  const a2 = parseInt(l.substring(3, 6).trim(), 10) - 1;
  const order = parseInt(l.substring(6, 9).trim(), 10) || 1;
  if (!isNaN(a1) && !isNaN(a2)) bonds.push([a1, a2, order]);
}
// Debug log to verify RDKit is actually providing bond data
console.log('2D Viewer Debug: Atoms=', nA, 'Expected Bonds=', nB, 'Parsed Bonds=', bonds.length);
mol.delete();
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
atoms.forEach((a) => { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x); minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y); });

// Normalize coordinates to a fixed target size so hardcoded font/radii look correct
const spanX = maxX - minX || 1;
const spanY = maxY - minY || 1;
const maxSpan = Math.max(spanX, spanY, 0.1);
const targetSize = 600; // Increased from 250 to make bonds much longer
const scale = targetSize / maxSpan;
atoms.forEach((a) => {
a.x = (a.x - minX) * scale + 60; // Increased padding offset
// Flip Y axis so it displays correctly (SVG Y goes down)
a.y = (maxY - a.y) * scale + 60; // Increased padding offset
a.isH = a.elem === 'H';
});
const finalWidth = spanX * scale + 120; // Increased padding
const finalHeight = spanY * scale + 120; // Increased padding
const pad = 60; // Increased padding

const parentName = {};
bonds.forEach(([a1, a2]) => {
  const A = atoms[a1], B = atoms[a2];
  if (A.isH && !B.isH) parentName[a1] = B.name;
  if (B.isH && !A.isH) parentName[a2] = A.name;
});
// Pass 'scale' to the model so renderSvg can proportionally size everything
setModel({ atoms, bonds, parentName, viewBox: `${-pad} ${-pad} ${finalWidth + 2 * pad} ${finalHeight + 2 * pad}`, scale });

setModel({ atoms, bonds, parentName, viewBox: `${-pad} ${-pad} ${finalWidth + 2 * pad} ${finalHeight + 2 * pad}` });
    } catch (e) { setModel(null); }
  }, [smiles, rdkitReady]);

  const keysFor = (idx) => {
    if (!model) return [];
    const a = model.atoms[idx];
    const keys = [`0-${a.name}`];
    if (a.isH && model.parentName[idx]) keys.push(`0-${model.parentName[idx]}`);
    return keys;
  };
const renderSvg = (heightStyle) => {
  if (!model) return null;
  return (
    <svg viewBox={model.viewBox} className="font-sans" style={heightStyle}>
      {model.bonds.map(([a1, a2, order], i) => {
        const A = model.atoms[a1], B = model.atoms[a2];
        const dx = B.x - A.x, dy = B.y - A.y;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const nx = -uy, ny = ux;
        const off = 2.4;
        const rA = A.isH ? 9 : 14;
        const rB = B.isH ? 9 : 14;
        const startX = A.x + ux * rA;
        const startY = A.y + uy * rA;
        const endX = B.x - ux * rB;
        const endY = B.y - uy * rB;
        const strokes = [];
        if (order === 2 || order === 4) {
          strokes.push([startX + nx * off, startY + ny * off, endX + nx * off, endY + ny * off]);
          strokes.push([startX - nx * off, startY - ny * off, endX - nx * off, endY - ny * off]);
        } else if (order === 3) {
          strokes.push([startX, startY, endX, endY]);
          strokes.push([startX + nx * off, startY + ny * off, endX + nx * off, endY + ny * off]);
          strokes.push([startX - nx * off, startY - ny * off, endX - nx * off, endY - ny * off]);
        } else {
          strokes.push([startX, startY, endX, endY]);
        }
        return (
          <g key={`b${i}`}>
            {strokes.map((s, j) => (
              <line key={j} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="#475569" strokeWidth={1.8} pointerEvents="none" />
            ))}
          </g>
        );
      })}
      {model.atoms.map((a, idx) => {
        const key = `0-${a.name}`;
        const isSel = selectedKeys && selectedKeys.includes(key);
        const isMan = manualKeys && manualKeys.includes(key);
        const r = a.isH ? 9 : 14;
        return (
          <g key={`a${idx}`}>
            {isSel && <circle cx={a.x} cy={a.y} r={r + 6} fill={SELECT_COLOR} opacity={0.28} />}
            {isMan && !isSel && <circle cx={a.x} cy={a.y} r={r + 6} fill={MANUAL_COLOR} opacity={0.22} />}
            <circle cx={a.x} cy={a.y} r={r} fill="white" stroke={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : '#334155'} strokeWidth={isSel || isMan ? 2.2 : 1.4} />
            <text x={a.x} y={a.y} textAnchor="middle" dominantBaseline="central" fontSize={a.isH ? 7 : 9.5} fontWeight="bold" fill={isSel ? '#92400e' : isMan ? '#166534' : '#1e3a8a'} pointerEvents="none">{a.name}</text>
          </g>
        );
      })}
      {model.atoms.map((a, idx) => (
        <circle key={`hit${idx}`} cx={a.x} cy={a.y} r={a.isH ? 12 : 17} fill="transparent"
          style={{ cursor: onAtomClick ? 'pointer' : 'default', pointerEvents: 'all' }}
          onClick={onAtomClick ? (e) => { e.stopPropagation(); onAtomClick(0, keysFor(idx)); } : undefined}>
          <title>{a.name}</title>
        </circle>
      ))}
    </svg>
  );
};
  const fallbackUrl = smiles ? `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/image?width=1500&height=1500` : '';

  const content = () => {
    if (model) return <div className="w-full h-full flex items-center justify-center">{renderSvg({ height: '100%', maxWidth: '100%' })}</div>;
    if (!smiles) return <p className="text-xs text-slate-400 italic">Enter a valid SMILES.</p>;
    if (!rdkitReady && !rdkitFailed) return (
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-xs font-semibold">Loading 2D renderer…</span>
      </div>
    );
    // RDKit definitively failed or parse error — show Cactus image with note
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <img src={fallbackUrl} alt="2D Structure" className="max-w-full h-full object-contain" />
        <span className="absolute bottom-1 right-1 text-[9px] text-slate-400 bg-white/80 px-1 rounded">Labels unavailable (RDKit failed)</span>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 group relative h-[350px]">
        {content()}
        <div onClick={() => setIsZoomed(true)} className="cursor-pointer absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
          <span className="bg-white/90 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm pointer-events-none">🔍 Click to zoom structure</span>
        </div>
      </div>
      {isZoomed && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/85 backdrop-blur-sm p-4 overflow-auto" onClick={() => setIsZoomed(false)}>
          <div className="bg-white p-6 rounded-2xl shadow-2xl relative max-w-[95vw] max-h-[95vh] overflow-auto flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setIsZoomed(false)} className="absolute top-2 right-2 bg-slate-200 text-slate-800 rounded-full w-10 h-10 flex items-center justify-center text-2xl font-black shadow-lg hover:bg-slate-300 z-50">×</button>
            {model ? (<div className="w-full min-w-[800px]">{renderSvg({ height: '80vh', width: '100%' })}</div>) : (<img src={fallbackUrl} alt="Zoomed Structure" className="w-full h-auto min-w-[800px] object-contain" />)}
          </div>
        </div>
      )}
    </>
  );
};

// ================= MOLECULAR STRUCTURE SECTION =================
export const MolecularStructureSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const structureMode = activeTest.structureMode || '2d';
  const atomLabelMode = activeTest.atomLabelMode || 'selected';
  const residueOffset = activeTest.residueOffset || 0;
  const atomNameMap = useMemo(() => { try { return activeTest.atomNameMap ? JSON.parse(activeTest.atomNameMap) : {}; } catch { return {}; } }, [activeTest.atomNameMap]);
  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  
  // Decoupled input state to prevent WebGL crash on keystroke
  const [localPdbInput, setLocalPdbInput] = useState(activeTest.structureSrc || '');

  useEffect(() => {
    setLocalPdbInput(activeTest.structureSrc || '');
  }, [activeTest.structureSrc]);

  const applyPdbInput = () => {
    if (localPdbInput !== activeTest.structureSrc) {
      updateActiveTest({ structureSrc: localPdbInput });
    }
  };

  useEffect(() => { if (structureMode === '3d') setHasOpened3D(true); }, [structureMode]);
  useEffect(() => {
    const t = setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);
  
  const firstSelectedCmp = activeTest.selectedCompounds?.[0];
  useEffect(() => {
    if (firstSelectedCmp && ctx.compoundMeta) {
      const meta = ctx.compoundMeta[firstSelectedCmp];
      if (meta) {
        let needsUpdate = false;
        const updates = {};
        if (meta.smiles && meta.smiles !== activeTest.smiles) {
          updates.smiles = meta.smiles;
          updates.moleculeType = 'organic';
          needsUpdate = true;
        }
        if (meta.sequence && meta.sequence !== activeTest.proteinSequence) {
          updates.proteinSequence = meta.sequence;
          updates.moleculeType = meta.type || 'protein';
          needsUpdate = true;
        }
        if (needsUpdate) {
          updateActiveTest(updates);
        }
      }
    }
  }, [firstSelectedCmp, ctx.compoundMeta, activeTest.smiles, activeTest.proteinSequence, updateActiveTest]);
  
  const activeSmiles = activeTest.smiles || (firstSelectedCmp && ctx.compoundMeta?.[firstSelectedCmp]?.smiles) || '';
  const hasExplicitOverride = !!(activeTest.structureSrc || activeTest.pdbId || '').trim();

  // Locally-generated structures (no network round trip): idealized protein backbone from
  // sequence + secondary structure (or fully-extended fallback), and a simplified extended
  // sugar-phosphate backbone trace for DNA/RNA. Only used when the user hasn't provided an
  // explicit override (structureSrc/pdbId) and there's an actual sequence to build from.
const generatedStructure = useMemo(() => {
  if (hasExplicitOverride) {
    console.log('⚠️ 3D Generation skipped: hasExplicitOverride is true (check PDB ID / Structure Src inputs)');
    return null;
  }
  
  try {
    console.log('🔄 3D Generation attempt. moleculeType:', d.moleculeType, 'seq length:', d.seq?.length);
    
    if (d.moleculeType === 'protein' && d.seq) {
      console.log('✅ Generating protein structure...');
      return { text: proteinSequenceToPdbText(d.seq, activeTest.secondaryStructure || '', activeTest.name || 'PROTEIN'), ext: 'pdb' };
    }
    
    if ((d.moleculeType === 'dna' || d.moleculeType === 'rna') && d.seq) {
      console.log('✅ Generating nucleic acid structure...');
      return { text: nucleicSequenceToPdbText(d.seq, d.moleculeType, activeTest.name || 'NUCLEIC_ACID'), ext: 'pdb' };
    }
    
    console.log('ℹ️ 3D Generation skipped: No valid sequence provided for this molecule type.');
  } catch (e) {
    console.error('❌ 3D structure generation failed with error:', e);
  }
  
  return null;
}, [hasExplicitOverride, d.moleculeType, d.seq, activeTest.secondaryStructure, activeTest.name]);

  // Organic molecules with no override: fetch + validate a real 3D structure ourselves (Cactus,
  // falling back to PubChem) instead of handing NGL a raw URL to fetch on its own -- this is what
  // lets us catch a bad/empty response (e.g. Cactus returning an HTML error page) and surface a
  // clear error instead of the viewer silently showing nothing.
  const [organicFetch, setOrganicFetch] = useState({ smiles: null, text: null, ext: null, loading: false, error: null });
  const needsOrganicFetch = !hasExplicitOverride && !!activeSmiles &&
    d.moleculeType !== 'lipid' && d.moleculeType !== 'sugar' &&
    d.moleculeType !== 'protein' && d.moleculeType !== 'dna' && d.moleculeType !== 'rna';

  useEffect(() => {
    if (!needsOrganicFetch) { setOrganicFetch({ smiles: null, text: null, ext: null, loading: false, error: null }); return; }
    if (organicFetch.smiles === activeSmiles && (organicFetch.text || organicFetch.loading)) return;
    let cancelled = false;
    setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: true, error: null });
    resolveOrganicStructureText(activeSmiles)
      .then(({ text, ext }) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text, ext, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: false, error: err.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOrganicFetch, activeSmiles]);

  const structureText = generatedStructure?.text || organicFetch.text || null;
  const structureTextExt = generatedStructure?.ext || organicFetch.ext || null;

  const structureSrc = useMemo(() => {
    const raw = (activeTest.structureSrc || activeTest.pdbId || '').trim();
    if (!raw) {
      if (generatedStructure) return ''; // served via structureText instead
      if (d.moleculeType === 'protein') return '/structures/template_amino_acid.pdb'; // no sequence yet
      if (d.moleculeType === 'dna') return '/structures/template_nucleotide_dna.pdb';
      if (d.moleculeType === 'rna') return '/structures/template_nucleotide_rna.pdb';
      if (d.moleculeType === 'lipid') return `/structures/${(activeTest.lipidChoice || 'POPC').toUpperCase()}.pdb`;
      if (d.moleculeType === 'sugar') return `/structures/${activeTest.sugarChoice || 'GLC'}_${activeTest.sugarAnomer || 'alpha'}.pdb`;
      return ''; // organic case is served via structureText/organicFetch instead
    }
    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/') || raw.startsWith('./')) return raw;
    if (/^[0-9][A-Za-z0-9]{3}$/.test(raw)) return `https://models.rcsb.org/${raw.toUpperCase()}.mmtf`;
    return raw;
  }, [activeTest.structureSrc, activeTest.pdbId, d.moleculeType, activeTest.lipidChoice, activeTest.sugarChoice, activeTest.sugarAnomer, generatedStructure]);
  
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');
  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);
  
  const handleAtomClick = (ri, keys) => {
    if (ri === null || !keys) return;
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };
  
  const paintSSAt = (i, letter) => { const arr = d.seq.split('').map((_, j) => d.getSSAt(j)); arr[i] = letter; updateActiveTest({ secondaryStructure: arr.join('') }); };
  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: d.seq.split('').map(() => letter).join('') });

  const triggerDownload = (text, filename) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdbFile = async () => {
    // Already-generated/-fetched structure text (protein/DNA/RNA backbone, or a successfully
    // resolved organic structure) can be downloaded directly without another network round trip.
    if (structureText) {
      const ext = structureTextExt === 'sdf' ? 'sdf' : 'pdb';
      triggerDownload(structureText, `${activeTest.name || d.moleculeType || 'structure'}_3D.${ext}`);
      return;
    }

    const targetSmiles = activeSmiles.trim();
    if (targetSmiles) {
      try {
        const { text, ext } = await resolveOrganicStructureText(targetSmiles);
        triggerDownload(text, `${activeTest.name || 'molecule'}_3D.${ext}`);
      } catch (e) {
        alert('Failed to generate a 3D structure for this SMILES: ' + e.message);
      }
    } else if ((d.moleculeType === 'protein' || d.moleculeType === 'dna' || d.moleculeType === 'rna') && d.seq) {
      // Fallback: build it fresh even if organicFetch/generatedStructure hasn't populated yet
      try {
        const text = d.moleculeType === 'protein'
          ? proteinSequenceToPdbText(d.seq, activeTest.secondaryStructure || '', activeTest.name || 'PROTEIN')
          : nucleicSequenceToPdbText(d.seq, d.moleculeType, activeTest.name || 'NUCLEIC_ACID');
        triggerDownload(text, `${activeTest.name || d.moleculeType}_3D.pdb`);
      } catch (e) {
        alert('Failed to generate structure: ' + e.message);
      }
    } else {
      alert(`No sequence or SMILES available for this selection, so there is nothing to generate a 3D structure from.`);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 mb-2">
        {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugars'], ['lipid', '🫧 Phospholipids'], ['organic', '⬡ Organic Molecule']].map(([val, lab]) => (
          <button key={val} onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {lab}
          </button>
        ))}
      </div>
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.moleculeType === 'organic' ? (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">SMILES String</label>
              <input type="text" value={activeTest.smiles || ''} onChange={(e) => updateActiveTest({ smiles: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm outline-none focus:border-blue-500 shadow-inner"
                placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" />
            </div>
          ) : d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{d.typeLabel} Sequence (1-letter code)</label>
              <textarea value={activeTest.proteinSequence || ''} onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
                placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'} />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'} (valid: {d.validChars.split('').join(' ')})</p>
            </>
          ) : d.moleculeType === 'sugar' ? (
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Sugar</label>
                <select value={activeTest.sugarChoice || 'GLC'} onChange={(e) => updateActiveTest({ sugarChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                  {Object.entries(SUGAR_DB).map(([k, v]) => <option key={k} value={k}>{v.name} ({v.code3})</option>)}
                </select>
              </div>
              <div className="w-32">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Anomer</label>
                <select value={activeTest.sugarAnomer || 'alpha'} onChange={(e) => updateActiveTest({ sugarAnomer: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                  <option value="alpha">Alpha (α)</option>
                  <option value="beta">Beta (β)</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Phospholipid</label>
              <select value={activeTest.lipidChoice || 'POPC'} onChange={(e) => updateActiveTest({ lipidChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                {Object.entries(LIPID_DB).map(([k, v]) => <option key={k} value={k}>{k} — {v.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="w-full md:w-64 flex flex-col gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
            <div className="flex flex-col gap-2">
              {['H', 'N', 'C', ...(d.hasPhosphorus ? ['P'] : [])].map((n) => (
                <label key={n} className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors">
                  <input type="checkbox" checked={d.selNuc.includes(n)}
                    onChange={() => updateActiveTest({ selectedNuclei: d.selNuc.includes(n) ? d.selNuc.filter((x) => x !== n) : [...d.selNuc, n] })}
                    className="w-4 h-4 cursor-pointer accent-blue-600" />
                  <span className="font-bold text-slate-700">{n === 'H' ? '¹H' : n === 'N' ? '¹⁵N' : n === 'C' ? '¹³C' : '³¹P'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['C', 'H', 'E'].map((l) => (
              <button key={l} onClick={() => setSSBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{ backgroundColor: ssBrush === l ? SS_META[l].color : 'white', borderColor: SS_META[l].color, color: ssBrush === l ? 'white' : SS_META[l].color }}>
                {SS_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllSS('C')} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200">All Coil</button>
            <button onClick={() => setAllSS('H')} className="px-3 py-1 rounded-lg text-xs font-bold bg-violet-100 border border-violet-300 text-violet-700 hover:bg-violet-200">All α-Helix</button>
            <button onClick={() => setAllSS('E')} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-300 text-amber-700 hover:bg-amber-200">All β-Sheet</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">💡 Select a brush, then click or drag across the sequence chips to paint secondary structure.</p>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getSSAt(i)} meta={SS_META} onApply={(i) => paintSSAt(i, ssBrush)} focusIdx={focusIdx} />
        </div>
      )}
      
      <div className="mt-6 border-t border-slate-200 pt-6">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex bg-slate-200 p-1 rounded-lg">
            <button onClick={() => updateActiveTest({ structureMode: '2d' })} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '2d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>2D Formula</button>
            <button onClick={() => updateActiveTest({ structureMode: '3d' })} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '3d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>3D Viewer</button>
          </div>
          {d.moleculeType !== 'organic' && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <label className="text-[10px] font-bold text-slate-500 uppercase">🔍 Focus</label>
              <select value={focusIdx} onChange={(e) => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
                <option value="ALL">All residues</option>
                {d.parsedSeq.map((r, i) => <option key={i} value={i}>{r.id} — {r.name}</option>)}
              </select>
              {selectedKeys && (
                <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-400 text-amber-800">✖ Deselect</button>
              )}
            </div>
          )}
        </div>
        
        {structureMode === '3d' && (
          <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="flex flex-col gap-1 col-span-3">
              <label className="text-[10px] font-bold text-slate-500 uppercase">PDB ID / URL / local file</label>
              <div className="flex gap-2">
                <input type="text" value={localPdbInput} onChange={(e) => setLocalPdbInput(e.target.value)} onBlur={applyPdbInput} onKeyDown={(e) => { if (e.key === 'Enter') applyPdbInput(); }} placeholder="e.g. 1UBQ or /structures/POPC.pdb" className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500" />
                <button onClick={applyPdbInput} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors">Load</button>
              </div>
            </div>
          </div>
        )}
        
        <p className="text-xs text-slate-400 mb-2">💡 Click an atom in the {structureMode === '2d' ? 'formula' : '3D viewer'} to highlight its cell.</p>
        
        <div style={{ display: structureMode === '3d' ? 'block' : 'none' }} aria-hidden={structureMode !== '3d'}>
          {hasOpened3D && (
            <div className="flex flex-col gap-2">
              <NMRMoleculeViewer key={structureSrc || (generatedStructure ? 'generated' : 'no-structure-src')} src={structureSrc} structureText={structureText} structureTextExt={structureTextExt} externalLoading={organicFetch.loading} externalError={organicFetch.error} moleculeType={d.moleculeType} parsedSeq={d.parsedSeq} smiles={activeTest.smiles} selectedKeys={selectedKeys} manualKeys={manualKeys} onAtomClick={handleAtomClick} residueOffset={residueOffset} atomNameMap={atomNameMap} atomRenames={activeTest.atomRenames || {}} onAtomRenames={(map) => updateActiveTest({ atomRenames: map })} labelMode={atomLabelMode} height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? '620px' : '520px'} />
              <button onClick={downloadPdbFile} className="self-center mt-2 px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs rounded-lg hover:bg-indigo-100 transition-colors shadow-sm">📥 Download 3D PDB File</button>
            </div>
          )}
        </div>
        
     <div style={{ display: structureMode === '2d' ? 'block' : 'none' }} aria-hidden={structureMode !== '2d'}>
       {d.moleculeType === 'organic' && activeTest.smiles ? (
          <OrganicViewer smiles={activeTest.smiles} selectedKeys={selectedKeys} manualKeys={manualKeys} onAtomClick={handleAtomClick} />
       ) : d.structure ? (
         <StructureSVGView structure={d.structure} minWidth={d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} selectedKeys={selectedKeys} manualKeys={manualKeys} onAtomClick={handleAtomClick} height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'} />
       ) : null}
     </div>
      </div>
    </div>
  );
};


/* ============================================================================
   PEAK LABEL OVERLAY
   Renders peak labels above the spectrum using arrows and free-space placement.
   Uses absolute positioning over the Recharts canvas.
   ============================================================================ */


/* ============================================================================
   BRUKER 1R → PPM AXIS  (shared helpers for the NMR page import)
   ============================================================================ */
const _nmrParseBrukerParams = (text) => {
  const p = {}; let key = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^##\$([A-Za-z0-9_]+)=(.*)$/);
    if (m) { key = m[1]; let v = m[2].trim(); if (v.startsWith('<') && v.endsWith('>')) v = v.slice(1,-1).trim(); p[key] = v; }
    else if (key && line && !line.startsWith('##')) p[key] += '\n' + line;
  }
  return p;
};
const _nmrBrukerNum = (p, k, d=0) => { const v = parseFloat(p[k]); return Number.isFinite(v) ? v : d; };
const _nmrDecode1r = (buf, le) => { const n = Math.floor(buf.byteLength/4); const dv = new DataView(buf); const y = new Float64Array(n); for (let i=0;i<n;i++) y[i]=dv.getInt32(i*4,le); return y; };
const _nmrDecode1rAuto = (buf, forceLE=null) => {
  if (forceLE !== null) return {y:_nmrDecode1r(buf,forceLE), littleEndian:forceLE, autoEndian:false};
  const be=_nmrDecode1r(buf,false); const le=_nmrDecode1r(buf,true);
  const p99 = arr => { const a=Array.from(arr,Math.abs).sort((x,y)=>x-y); return a[Math.min(a.length-1,Math.floor(a.length*0.99))]; };
  const littleEndian = p99(le)<p99(be);
  return {y: littleEndian?le:be, littleEndian, autoEndian:true};
};
// Build ppm axis: point 0 = high-ppm edge = (O1 + SW_h/2) / SFO1
const _nmrPpmAxis = (swHz, o1Hz, sfo1MHz, n) => {
  const left = (o1Hz + swHz/2) / (sfo1MHz * 1e6) * 1e6; // ppm = Hz/SFO1[Hz] * 1e6
  const step = swHz / n / (sfo1MHz * 1e6) * 1e6;
  const xs = new Float64Array(n);
  for (let i=0;i<n;i++) xs[i] = left - i*step;
  return xs;
};
const _nmrDownsample = (xs, ys, max=6000) => {
  if (ys.length <= max) return {xs:Array.from(xs), ys:Array.from(ys)};
  const out = {xs:[], ys:[]}; const bucket = ys.length/max;
  for (let b=0;b<max;b++) {
    const s=Math.floor(b*bucket); const e=Math.max(s+1,Math.floor((b+1)*bucket));
    let iMin=s, iMax=s;
    for (let i=s;i<e;i++) { if(ys[i]<ys[iMin]) iMin=i; if(ys[i]>ys[iMax]) iMax=i; }
    const [a,z] = iMin<iMax ? [iMin,iMax] : [iMax,iMin];
    out.xs.push(xs[a],xs[z]); out.ys.push(ys[a],ys[z]);
  }
  return out;
};
const _nmrResolveDrive = (url) => {
  const u = String(url||'').trim(); if (!u) return '';
  let m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  m = u.match(/[?&]id=([\w-]+)/);
  if (m && /drive\.google\.com/.test(u)) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return u;
};
// Main import — returns { xs:ppmArray, ys:intensityArray, meta, nPoints, error? }
const importBruker1rPpm = ({dataBuffer, acqusText='', manualSWppm=null, manualO1ppm=0, title='', forceLE=null}) => {
  if (!dataBuffer || dataBuffer.byteLength < 16) return {error:'Empty or invalid 1r file.'};
  if (new TextDecoder().decode(new Uint8Array(dataBuffer.slice(0,32))).includes('<!DOC'))
    return {error:'Drive returned a web page — set sharing to "Anyone with the link".' };
  const acqus = acqusText && acqusText.trim().startsWith('##') ? _nmrParseBrukerParams(acqusText) : {};
  const {y, littleEndian, autoEndian} = _nmrDecode1rAuto(dataBuffer, forceLE);
  const swHz = _nmrBrukerNum(acqus,'SW_h');
  const sfo1 = _nmrBrukerNum(acqus,'SFO1');      // MHz
  const o1Hz = _nmrBrukerNum(acqus,'O1');          // Hz
  let xs;
  if (swHz > 0 && sfo1 > 0) {
    xs = _nmrPpmAxis(swHz, o1Hz, sfo1, y.length);
  } else if (manualSWppm) {
    // manual: centre at manualO1ppm, width manualSWppm
    const left = manualO1ppm + manualSWppm/2;
    xs = new Float64Array(y.length);
    for (let i=0;i<y.length;i++) xs[i] = left - i*(manualSWppm/y.length);
  } else {
    return {error:'No valid acqus (need SFO1 + SW_h + O1) and no manual spectral width — cannot build the ppm axis.'};
  }
  const ds = _nmrDownsample(xs, y, 6000);
  return {
    xs: ds.xs, ys: ds.ys, littleEndian, autoEndian, nPoints: y.length,
    meta: {
      swPpm: swHz>0&&sfo1>0 ? swHz/(sfo1*1e6)*1e6 : manualSWppm,
      o1Ppm: sfo1>0 ? o1Hz/(sfo1*1e6)*1e6 : manualO1ppm,
      sfo1, nucleus: acqus.NUC1 || '', temperatureK: _nmrBrukerNum(acqus,'TE') || null,
      title: title || acqus.TITLE || ''
    }
  };
};
// =========================================================================
// NMR 1D SPECTRA OVERLAY & PALETTE MANAGER
// =========================================================================
// =========================================================================
// NMR 1D SPECTRA OVERLAY & PALETTE MANAGER
// =========================================================================
const NMRSpectraVisualization = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const instances = useMemo(() => {
    let list = null;
    if (ctx) {
      if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch {} }
      if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
      if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
      if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
        const all = ctx.tests || ctx.allTests;
        list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
      }
    }
    if (!list || !list.length) list = [activeTest];
    return list.filter(Boolean).map((t, idx) => ({
      id: t.id || `inst_${idx}`,
      name: t.instanceName || t.name || `Instance ${idx + 1}`,
      test: t
    }));
  }, [ctx, activeTest]);

  const [showOverlay, setShowOverlay] = useState(true);
  const [hiddenSeries, setHiddenSeries] = useState({});
  const [localColors, setLocalColors] = useState(activeTest.nmrInstanceColors || {});
const [savedPalettes, setSavedPalettes] = useState(activeTest.nmrSavedPalettes || {});
const [newPaletteName, setNewPaletteName] = useState('');
const [zoomDom, setZoomDom] = useState(null);
const [refL, setRefL] = useState(null);
const [refR, setRefR] = useState(null);
const dragRef = useRef(false);
const chartRef = useRef(null);
  
  // Visual Custom Palette State (Replaces the text input)
  const [customPalette, setCustomPalette] = useState(['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899']);

  const updateCustomColor = (index, color) => {
    const next = [...customPalette];
    next[index] = color;
    setCustomPalette(next);
  };

  const applyPalette = (paletteKey) => {
    let palette;
    if (paletteKey === 'custom') {
      palette = customPalette;
    } else {
      palette = VIS_PALETTES[paletteKey] || VIS_PALETTES.default;
    }
    const nextColors = { ...localColors };
    instances.forEach((inst, idx) => {
      nextColors[inst.id] = palette[idx % palette.length];
    });
    setLocalColors(nextColors);
    updateActiveTest({ nmrInstanceColors: nextColors });
  };

  const saveCurrentPalette = () => {
    if (!newPaletteName.trim()) return alert('Enter a name for the palette');
    // Saves the visual custom palette array so it can be reused on any number of instances
    const nextPalettes = { ...savedPalettes, [newPaletteName]: customPalette };
    setSavedPalettes(nextPalettes);
    updateActiveTest({ nmrSavedPalettes: nextPalettes });
    setNewPaletteName('');
  };

  const loadPalette = (name) => {
    if (savedPalettes[name]) {
      const palette = savedPalettes[name];
      if (Array.isArray(palette)) {
        setCustomPalette(palette); // Load it back into the visual pickers
        const nextColors = { ...localColors };
        instances.forEach((inst, idx) => {
          nextColors[inst.id] = palette[idx % palette.length];
        });
        setLocalColors(nextColors);
        updateActiveTest({ nmrInstanceColors: nextColors });
      }
    }
  };

  const deletePalette = (name) => {
    const next = { ...savedPalettes };
    delete next[name];
    setSavedPalettes(next);
    updateActiveTest({ nmrSavedPalettes: next });
  };

  const updateColor = (id, color) => {
    const next = { ...localColors, [id]: color };
    setLocalColors(next);
    updateActiveTest({ nmrInstanceColors: next });
  };

  const seriesList = useMemo(() => {
    const out = [];
    const defaultColors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    instances.forEach((inst, idx) => {
      const spec = inst.test.nmr1dSpectrum;
      if (!spec || !Array.isArray(spec.xs) || spec.xs.length === 0) return;
      
      const step = Math.max(1, Math.floor(spec.xs.length / 2000));
      const data = [];
      for (let i = 0; i < spec.xs.length; i += step) {
        data.push({ x: spec.xs[i], y: spec.ys[i] });
      }
      
      out.push({
        key: inst.id,
        label: spec.title || inst.name,
        color: localColors[inst.id] || defaultColors[idx % defaultColors.length],
        data
      });
    });
    return out;
  }, [instances, localColors]);

const allXs = seriesList.flatMap(s => s.data.map(p => p.x));
const allYs = seriesList.flatMap(s => s.data.map(p => p.y));
const xFull = allXs.length ? [Math.min(...allXs), Math.max(...allXs)] : [0, 10];
const yDomain = allYs.length ? [Math.min(...allYs), Math.max(...allYs)] : [0, 1];
const dom = zoomDom || xFull;
const visibleSeries = seriesList.filter(s => !hiddenSeries[s.key]);
const getX = (clientX) => {
  if (!chartRef.current) return null;
  const w = chartRef.current.querySelector('.recharts-wrapper');
  if (!w) return null;
  const r = w.getBoundingClientRect();
  const plotW = r.width - 40; // left 20 + right 20
  if (plotW <= 0) return null;
  const fx = Math.min(1, Math.max(0, (clientX - r.left - 20) / plotW));
  return dom[1] - fx * (dom[1] - dom[0]);
};
const onDown = (e) => {
  const v = getX(e.clientX); if (v===null) return;
  dragRef.current = true; setRefL(v); setRefR(v);
};
const onMove = (e) => {
  if (!dragRef.current) return;
  const v = getX(e.clientX); if (v!==null) setRefR(v);
};
const onUp = () => {
  if (!dragRef.current) return;
  dragRef.current = false;
  if (refL!==null && refR!==null && Math.abs(refL-refR)>0.01) {
    const lo2=Math.min(refL,refR), hi2=Math.max(refL,refR);
    setZoomDom([lo2, hi2]);
  }
  setRefL(null); setRefR(null);
};

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-bold text-slate-700">📈 1D Spectra Overlay & Palette Manager</h4>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} className="w-4 h-4 accent-blue-600" />
          Show Overlay
        </label>
      </div>

 {showOverlay && seriesList.length > 0 && (
     <div className="h-[300px] w-full border border-slate-200 rounded-lg bg-slate-50 p-2 flex flex-col">
       <div className="flex justify-end mb-1 shrink-0">
         {zoomDom && (
           <button type="button" onClick={() => setZoomDom(null)} className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded font-bold">Reset zoom</button>
         )}
       </div>
       <div ref={chartRef} className="select-none flex-1 w-full" style={{ position: 'relative' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
         <ResponsiveContainer width="100%" height="100%">
           <LineChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
             <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
             <XAxis type="number" dataKey="x" domain={dom} reversed={true} allowDataOverflow
               ticks={(() => {
                 const lo = Math.min(dom[0], dom[1]);
                 const hi = Math.max(dom[0], dom[1]);
                 const raw = (hi - lo) / 8;
                 if (raw <= 0) return [];
                 const mag = Math.pow(10, Math.floor(Math.log10(raw)));
                 const norm = raw / mag;
                 const st = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
                 const out = [];
                 for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(4));
                 return out;
               })()}
               tickFormatter={v => Number(v).toFixed(2)}
               tick={{ fontSize: 10 }} 
               label={{ value: 'Chemical Shift (ppm)', position: 'insideBottom', offset: -5 }} 
             />
             <YAxis domain={yDomain} hide />
             <Tooltip formatter={v => Number(v).toFixed(3)} labelFormatter={v => Number(v).toFixed(2) + ' ppm'} />
             <Legend />
             {visibleSeries.map(s => (
               <Line key={s.key} data={s.data} type="monotone" dataKey="y" name={s.label} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
             ))}
             {refL!==null && refR!==null && <ReferenceArea x1={refL} x2={refR} fill="#cbd5e1" fillOpacity={0.4} />}
           </LineChart>
         </ResponsiveContainer>
       </div>
     </div>
   )}

      <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
        
        {/* 1. PALETTE SELECTOR (Matches other pages, but uses clickable color pickers instead of text input) */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
          <div className="flex flex-wrap items-center gap-2">
            <select 
              onChange={(e) => { 
                if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); 
                e.target.value=''; 
              }} 
              className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50 outline-none cursor-pointer"
            >
              <option value="">🎨 Apply Palette...</option>
              {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <span className="text-slate-300 hidden md:inline">|</span>
            <span className="text-[10px] font-bold text-slate-500">Custom:</span>
            {/* Visual Color Pickers for Custom Palette */}
            {customPalette.map((color, idx) => (
              <input 
                key={idx} 
                type="color" 
                value={color} 
                onChange={(e) => updateCustomColor(idx, e.target.value)} 
                className="w-6 h-6 rounded cursor-pointer border border-slate-300 p-0" 
                title={`Color ${idx + 1}`} 
              />
            ))}
            <button onClick={() => applyPalette('custom')} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">Apply Custom</button>
          </div>
        </div>

        {/* 2. INDIVIDUAL SERIES VISIBILITY & OVERRIDE */}
        <h5 className="text-xs font-bold text-slate-600 uppercase">Visibility & Individual Color Override</h5>
        <div className="flex flex-wrap gap-2">
          {seriesList.map(s => (
            <div key={s.key} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-bold border ${hiddenSeries[s.key] ? 'bg-slate-200 border-slate-300 text-slate-400' : 'bg-white border-slate-300 text-slate-700 shadow-sm'}`}>
              <input type="checkbox" checked={!hiddenSeries[s.key]} onChange={() => setHiddenSeries(p => ({ ...p, [s.key]: !p[s.key] }))} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
              <input type="color" value={s.color} onChange={e => updateColor(s.key, e.target.value)} className="w-6 h-6 rounded cursor-pointer border border-slate-300 p-0" title="Click to pick color" />
              <span className="truncate max-w-[150px]">{s.label}</span>
            </div>
          ))}
        </div>

        {/* 3. SAVE & REUSE PALETTES */}
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <h5 className="text-xs font-bold text-slate-600 uppercase">Save & Reuse Custom Palettes</h5>
          <div className="flex flex-wrap gap-2 items-center">
            <input 
              type="text" 
              value={newPaletteName} 
              onChange={e => setNewPaletteName(e.target.value)} 
              placeholder="Palette name..." 
              className="border border-slate-300 rounded px-2 py-1 text-xs w-32 outline-none focus:border-blue-500" 
            />
            <button onClick={saveCurrentPalette} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded text-xs">Save Current Custom</button>
            
            {Object.keys(savedPalettes).length > 0 && (
              <select onChange={e => { if(e.target.value) loadPalette(e.target.value); e.target.value=''; }} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500">
                <option value="">Load Saved Palette...</option>
                {Object.keys(savedPalettes).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
          </div>
          
          {Object.keys(savedPalettes).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.keys(savedPalettes).map(name => (
                <div key={name} className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded px-2 py-1 text-xs">
                  <span className="font-bold text-slate-700">{name}</span>
                  <button onClick={() => deletePalette(name)} className="text-red-400 hover:text-red-600 font-black ml-1">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// =========================================================================
// NMRSections.jsx - REPLACE DataSection COMPONENT
// =========================================================================
export const DataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerUnit, setNewLayerUnit] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importConfig, setImportConfig] = useState({ testId: '', tableId: '', metric: 'R_s' });

  // ---- Bruker 1r import (ppm axis) ----
  const [nmrBrukerDataUrl, setNmrBrukerDataUrl] = useState('');
  const [nmrBrukerAcqusUrl, setNmrBrukerAcqusUrl] = useState('');
  const [nmrBrukerSwPpm, setNmrBrukerSwPpm] = useState('');
  const [nmrBrukerO1Ppm, setNmrBrukerO1Ppm] = useState('');
  const [nmrBrukerMsg, setNmrBrukerMsg] = useState('');
  const [nmrBrukerBusy, setNmrBrukerBusy] = useState(false);
  const [showPeakLabels, setShowPeakLabels] = useState(true);
  const [expandedBruker, setExpandedBruker] = useState(false);
  const [brukerZoomDom, setBrukerZoomDom] = useState(null);
  const [brukerRefL, setBrukerRefL] = useState(null);
  const [brukerRefR, setBrukerRefR] = useState(null);
  const brukerDragRef = useRef(false);
  const brukerChartRef = useRef(null);
  const nmrBrukerFileRef = useRef(null);
  
  // Publication Table Export States
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState([]);
  const [exportNuclei, setExportNuclei] = useState(['1H', '13C', '15N', '31P']);

  const actualLayerKeys = d.layers.map(l => l.key);
  const [visibleLayers, setVisibleLayers] = useState(actualLayerKeys);

  // ---- Drag-to-select + copy/paste ----
  const [dragSel, setDragSel] = useState(null); 
  const isDragging = useRef(false);
  const [copiedMsg, setCopiedMsg] = useState('');

  const cellInDragSel = (rowIdx, atomName, lk) => {
    if (!dragSel) return false;
    const rows = [dragSel.startRow, dragSel.endRow].sort((a, b) => a - b);
    if (rowIdx < rows[0] || rowIdx > rows[1]) return false;
    return true; 
  };

  const startDrag = (rowIdx, atomName, lk, e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    isDragging.current = true;
    setDragSel({ startRow: rowIdx, startAtom: atomName, startLk: lk, endRow: rowIdx, endAtom: atomName, endLk: lk });
    e.preventDefault();
  };

  const extendDrag = (rowIdx, atomName, lk) => {
    if (!isDragging.current) return;
    setDragSel(prev => prev ? { ...prev, endRow: rowIdx, endAtom: atomName, endLk: lk } : null);
  };

  useEffect(() => {
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const copyCells = () => {
    if (!dragSel) return;
    const rows = [dragSel.startRow, dragSel.endRow].sort((a, b) => a - b);
    const lks = visibleLayers; 
    const header = ['Residue', ...lks.map(lk => { const l = d.layers.find(la => la.key === lk); return l ? l.label : lk; })].join('\t');
    const dataRows = [];
    for (let ri = rows[0]; ri <= rows[1]; ri++) {
      const res = d.estSeq[ri];
      if (!res) continue;
      const displayAtoms = res.atomList || [];
      if (displayAtoms.length === 0) { dataRows.push(`${res.id}\t`); continue; }
      displayAtoms.forEach(atomName => {
        const vals = lks.map(lk => {
          const valMap = lk === 'cs' ? (activeTest.chemicalShifts || {}) : (d.allLayerValues[lk] || {});
          return valMap[`${ri}-${atomName}`] || '';
        });
        dataRows.push(`${res.id} ${atomName}\t${vals.join('\t')}`);
      });
    }
    const tsv = [header, ...dataRows].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopiedMsg('Copied!');
      setTimeout(() => setCopiedMsg(''), 2000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = tsv; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      setCopiedMsg('Copied!');
      setTimeout(() => setCopiedMsg(''), 2000);
    });
  };

  const effTableMode = ['sugar', 'lipid', 'organic'].includes(d.moleculeType) ? 'all' : tableMode;
  const selectedKeys = getSelectedKeys(activeTest);

  const addLayer = () => {
    const label = newLayerName.trim();
    if (!label) return;
    const layer = { key: makeLayerId(), label, unit: newLayerUnit.trim() || '' };
    updateActiveTest({ parameterLayers: [...(activeTest.parameterLayers || []), layer], activeLayerKey: layer.key });
    setVisibleLayers([...visibleLayers, layer.key]);
    setNewLayerName(''); setNewLayerUnit('');
  };

  const removeLayer = (key) => {
    if (key === 'cs') return;
    const upd = (activeTest.parameterLayers || []).filter((l) => l.key !== key);
    updateActiveTest({ parameterLayers: upd, activeLayerKey: d.activeLayerKey === key ? 'cs' : d.activeLayerKey });
    setVisibleLayers(visibleLayers.filter(l => l !== key));
  };

  const toggleLayerVisibility = (key) => {
    if (visibleLayers.includes(key)) setVisibleLayers(visibleLayers.filter(k => k !== key));
    else setVisibleLayers([...visibleLayers, key]);
  };

  const handleShiftChange = (resIdx, atom, layerKey, val) => writeCellValue(activeTest, updateActiveTest, layerKey, `${resIdx}-${atom}`, val);
  
  const handleCellClick = (e, idx, atom) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const keys = buildKeys(idx, [atom], d.moleculeType, d.parsedSeq[idx]?.char);
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };
  
  const cellIsSelected = (idx, atom) => Boolean(selectedKeys && selectedKeys.includes(`${idx}-${atom}`));

  const fillEstimated = () => {
    const cs = { ...(activeTest.chemicalShifts || {}) };
    d.estSeq.forEach((res, idx) => {
      Object.entries(res.estShifts || {}).forEach(([a, v]) => { 
        const key = `${idx}-${a}`;
        if (parseManual(cs[key]) === null) cs[key] = String(v); 
      });
      Object.entries(res.estUniqueC || {}).forEach(([cn, v]) => { 
        const key = `${idx}-${cn}`;
        if (parseManual(cs[key]) === null) cs[key] = String(v); 
      });
      if (res.estN != null) {
        const key = `${idx}-N`;
        if (parseManual(cs[key]) === null) cs[key] = String(res.estN);
      }
      if (res.estCP != null) {
        const key = `${idx}-C'`;
        if (parseManual(cs[key]) === null) cs[key] = String(res.estCP);
      }
    });
    const nv = { ...(activeTest.nmrValues || {}) };
    delete nv.cs;
    updateActiveTest({ chemicalShifts: cs, nmrValues: nv });
  };
  
  const executeImport = () => {
      const selectedTest = (ctx.allTests || []).find(t => t.id === importConfig.testId);
      const table = (selectedTest?.nmrTables || []).find(t => t.id === importConfig.tableId);
      if (!table) return;

      const layerName = `${table.relaxType}_${importConfig.metric}`;
      const newLayers = [...(activeTest.parameterLayers || [])];
      let layer = newLayers.find(l => l.label === layerName);
      if (!layer) {
          layer = {
            key: makeLayerId(),
            label: layerName,
            unit: importConfig.metric === 'T_s' ? 's' : (importConfig.metric === 'R_s' ? (table.relaxType === 'DOSY' ? 'm²/s' : 's⁻¹') : ''),
            source: { testId: selectedTest.id, testName: selectedTest.name, tableId: table.id, metric: importConfig.metric }
          };
          newLayers.push(layer);
      } else {
          layer = { ...layer, source: { testId: selectedTest.id, testName: selectedTest.name, tableId: table.id, metric: importConfig.metric } };
          const idx = newLayers.findIndex(l => l.key === layer.key);
          if (idx >= 0) newLayers[idx] = layer;
      }
      
      const newValues = { ...(activeTest.nmrValues || {}) };
      newValues[layer.key] = { ...(newValues[layer.key] || {}) };
      
      const tableFits = selectedTest.savedFits?.[table.id] || [];
      let count = 0;

      tableFits.forEach(colFit => {
          if (!colFit.fit || !colFit.residue) return;
          const colResRaw = String(colFit.residue).toLowerCase().trim();
          let matchedKey = null;

          const targetAtomRaw = (table.atom || 'HN');
          const targetAtomLower = targetAtomRaw.toLowerCase();
          const targetAtomAlias = (ATOM_ALIASES[normAtomName(targetAtomRaw)] || targetAtomRaw).toLowerCase();

          let colResLower = colResRaw;
          const dashIdx = colResRaw.lastIndexOf('-');
          if (dashIdx > 0) {
              const afterDash = colResRaw.slice(dashIdx + 1);
              if (afterDash === targetAtomLower || afterDash === targetAtomAlias) {
                  colResLower = colResRaw.slice(0, dashIdx);
              }
          }

          for (const opt of d.atomOptions) {
              const parts = opt.key.split('-');
              const rIdx = parseInt(parts[0], 10);
              const aName = parts.slice(1).join('-');
              const aNameLower = aName.toLowerCase();
              const res = d.parsedSeq[rIdx];
              if (!res) continue;
              const rId = res.id?.toLowerCase() || '';
              const rShort = `${res.char?.toLowerCase() || ''}${rIdx + 1}`;
              const rNum = String(rIdx + 1);

              const atomMatches = aNameLower === targetAtomLower || aNameLower === targetAtomAlias;

              if (!atomMatches) continue;

              if (colResLower === rId || colResLower === rShort || colResLower === rNum) {
                  matchedKey = opt.key; break;
              } else if (colResLower === `${rId} ${aNameLower}` || colResLower === `${rShort} ${aNameLower}`) {
                  matchedKey = opt.key; break;
              } else if (aNameLower === colResLower && d.parsedSeq.length === 1) {
                  matchedKey = opt.key; break;
              }
          }

          if (matchedKey) {
              let val = null;
              if (importConfig.metric === 'R_s') val = colFit.fit.R_s ?? colFit.fit.R ?? colFit.fit.rate;
              else if (importConfig.metric === 'T_s') val = colFit.fit.T_s ?? colFit.fit.T ?? colFit.fit.time;
              else if (importConfig.metric === 'error') val = selectedTest.manualErrors?.[table.id]?.[colFit.residue] ?? colFit.fit.seR_s ?? colFit.fit.seR ?? colFit.fit.error;
              if (val !== '' && val !== undefined && val !== null && !Number.isNaN(val)) {
                  let formattedVal = val;
                  if (typeof val === 'number') {
                      formattedVal = (Math.abs(val) < 0.001 && val !== 0) || Math.abs(val) > 10000 ? val.toExponential(4) : val.toFixed(4);
                  }
                  newValues[layer.key][matchedKey] = formattedVal;
                  count++;
              }
          }
      });
      
      updateActiveTest({ parameterLayers: newLayers, nmrValues: newValues });
      if (!visibleLayers.includes(layer.key)) setVisibleLayers([...visibleLayers, layer.key]);
      setShowImport(false);
      alert(`Imported ${count} values from "${selectedTest.name}" successfully.`);
  };

  const openExportModal = () => {
    setExportColumns([...visibleLayers]);
    setShowExportModal(true);
  };

  const toggleExportColumn = (key) => {
    if (exportColumns.includes(key)) setExportColumns(exportColumns.filter(k => k !== key));
    else setExportColumns([...exportColumns, key]);
  };

  const toggleExportNucleus = (nuc) => {
    if (exportNuclei.includes(nuc)) setExportNuclei(exportNuclei.filter(k => k !== nuc));
    else setExportNuclei([...exportNuclei, nuc]);
  };

  const copyPublicationTable = () => {
    const el = document.getElementById('publication-table-container');
    if (!el) return;
    const range = document.createRange();
    range.selectNode(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    try {
      document.execCommand('copy');
      window.getSelection().removeAllRanges();
      alert('Table copied to clipboard!');
    } catch (err) {
      alert('Failed to copy automatically. Please select the table manually and press Ctrl+C.');
    }
  };

  const saveTableAsImage = () => {
    const el = document.getElementById('publication-table-container');
    if (!el) return;
    const html = el.innerHTML;
    const width = el.scrollWidth + 40; 
    const height = el.scrollHeight + 40;
    
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background: white; padding: 20px;">
          ${html}
        </div>
      </foreignObject>
    </svg>`;
    
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const reader = new FileReader();
    reader.onload = (e) => {
       const newImages = [...(activeTest.nmrSpectraImages || []), e.target.result];
       const newCaptions = [...(activeTest.figureCaptions || [])];
       while(newCaptions.length < (activeTest.nmrSpectraImages || []).length) newCaptions.push('');
       newCaptions.push("Publication Table Export");
       
       updateActiveTest({ nmrSpectraImages: newImages, figureCaptions: newCaptions });
       alert("Table saved as an image to the Figures section! It will now be exported to the Lab Notebook.");
    };
    reader.readAsDataURL(blob);
  };

  const isPolymer = ['protein', 'dna', 'rna'].includes(d.moleculeType);
  const COMMON_ATOMS_MAP = {
    protein: ['HN', 'N', 'Cα', 'Hα', 'Cβ', 'Hβ', "C'"],
    dna: ["H1'", "C1'", "H2'", "H2''", "C2'", "H3'", "C3'", "H4'", "C4'", "H5'", "H5''", "C5'"],
    rna: ["H1'", "C1'", "H2'", "OH2'", "C2'", "H3'", "C3'", "H4'", "C4'", "H5'", "H5''", "C5'"]
  };
  const rawCommonAtoms = COMMON_ATOMS_MAP[d.moleculeType] || [];
  
  const getAtomNucleus = (a) => {
    if (a.startsWith('H') || a.includes('OH') || a.includes('NH')) return '1H';
    if (a.startsWith('C')) return '13C';
    if (a === 'N') return '15N';
    if (a === 'P') return '31P';
    return '1H';
  };

  const commonAtoms = rawCommonAtoms.filter(ca => exportNuclei.includes(getAtomNucleus(ca)));

  const applyNmrBruker = (parsed, filename) => {
    if (parsed.error) { setNmrBrukerMsg('\u26a0\ufe0f ' + parsed.error); return; }
    setNmrBrukerMsg('\u2705 Imported ' + parsed.nPoints + ' pts' +
      (parsed.autoEndian ? ' \u00b7 endian auto-detected (' + (parsed.littleEndian ? 'LE' : 'BE') + ')' : '') +
      ' \u00b7 SW = ' + (parsed.meta.swPpm ? parsed.meta.swPpm.toFixed(2) : '?') + ' ppm');
    
    const updates = { nmr1dSpectrum: { xs: parsed.xs, ys: parsed.ys, meta: parsed.meta, title: parsed.meta.title || 'Imported 1r' } };
    if (filename) updates.instanceName = filename;
    
    updateActiveTest(updates);
    setBrukerZoomDom(null);
  };

  // Folder Import logic
  const importFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    setNmrBrukerBusy(true);
    setNmrBrukerMsg(`Scanning ${files.length} files...`);
    
    try {
      const oneRFiles = files.filter(f => f.name === '1r');
      if (!oneRFiles.length) throw new Error("No '1r' files found in the selected folder.");

      const results = [];
      for (let oneR of oneRFiles) {
        const pathParts = oneR.webkitRelativePath.split('/');
        const pdataIndex = pathParts.lastIndexOf('pdata');
        
        let acqusFile = null;
        let title = 'Imported 1r';
        
        if (pdataIndex > 0) {
          const expDir = pathParts.slice(0, pdataIndex).join('/');
          const targetAcqusPath = expDir + '/acqus';
          acqusFile = files.find(f => f.webkitRelativePath === targetAcqusPath);
          
          const expNum = pathParts[pdataIndex - 1];
          const procNum = pathParts[pdataIndex + 1];
          title = `Exp ${expNum}${procNum && procNum !== '1' ? ` (Proc ${procNum})` : ''}`;
        }
        
        const dataBuffer = await oneR.arrayBuffer();
        const acqusText = acqusFile ? await acqusFile.text() : '';
        
        const parsed = importBruker1rPpm({ 
          dataBuffer, 
          acqusText, 
          manualSWppm: parseManual(nmrBrukerSwPpm), 
          manualO1ppm: parseManual(nmrBrukerO1Ppm) || 0, 
          title 
        });
        
        if (!parsed.error) {
          parsed.filename = title;
          results.push(parsed);
        }
      }
      
      if (results.length === 0) throw new Error("Could not parse any valid 1r spectra.");

      applyNmrBruker(results[0], results[0].filename);

      if (results.length > 1 && ctx.setTests) {
         ctx.setTests(prev => {
           const newTests = [];
           for (let i = 1; i < results.length; i++) {
             const p = results[i];
             const cloned = JSON.parse(JSON.stringify(activeTest));
             cloned.id = 't' + Date.now() + i + Math.random().toString(36).substring(2,5);
             cloned.instanceName = p.filename;
             cloned.nmr1dSpectrum = { xs: p.xs, ys: p.ys, meta: p.meta, title: p.meta.title || 'Imported 1r' };
             newTests.push(cloned);
           }
           return [...prev, ...newTests];
         });
      }
      setNmrBrukerMsg(`✅ Successfully imported ${results.length} spectrum/spectra.`);
    } catch (err) {
      setNmrBrukerMsg(`⚠️ ${err.message}`);
    }
    setNmrBrukerBusy(false);
    if (nmrBrukerFileRef.current) nmrBrukerFileRef.current.value = '';
  };

  const importFromUrl = async () => {
    if (!nmrBrukerDataUrl.trim()) { setNmrBrukerMsg('\u26a0\ufe0f Paste the Google Drive link.'); return; }
    setNmrBrukerBusy(true);
    try {
      const res = await fetch(_nmrResolveDrive(nmrBrukerDataUrl));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let acqusText = '';
      if (nmrBrukerAcqusUrl.trim()) {
        try { acqusText = await (await fetch(_nmrResolveDrive(nmrBrukerAcqusUrl))).text(); } catch { acqusText = ''; }
      }
      applyNmrBruker(importBruker1rPpm({ dataBuffer: await res.arrayBuffer(), acqusText, manualSWppm: parseManual(nmrBrukerSwPpm), manualO1ppm: parseManual(nmrBrukerO1Ppm)||0 }), null);
    } catch(e) { setNmrBrukerMsg('\u26a0\ufe0f Fetch failed: ' + e.message); }
    setNmrBrukerBusy(false);
  };

  const renderSpectrum = () => {
    const spec = activeTest.nmr1dSpectrum;
    const hasSpec = spec && Array.isArray(spec.xs) && spec.xs.length > 0;
    if (!hasSpec) return null;
    const xs = spec.xs, ys = spec.ys;
   const xFull = [Math.min(...xs), Math.max(...xs)];
const dom = brukerZoomDom || xFull;
    const isZoomed = !!(brukerZoomDom);

    const csMap = activeTest.chemicalShifts || {};
    const peakMarkers = [];
    const lo = Math.min(dom[0],dom[1]), hi = Math.max(dom[0],dom[1]);
    d.estSeq.forEach((res, ri) => {
      d.atomOptions.filter(o => o.key.startsWith(ri + '-')).forEach(o => {
        const ppm = parseManual(csMap[o.key]);
        if (ppm === null || ppm < lo || ppm > hi) return;
        const atom = o.key.slice(String(ri).length + 1);
        peakMarkers.push({ppm, label: res.id + ' ' + atom});
      });
    });

    const visible = [];
    for (let i=0;i<xs.length;i++) {
      const x = xs[i];
      if (x >= lo && x <= hi) visible.push({x, y: ys[i]});
    }
    const maxY = visible.reduce((m, p) => Math.max(m, Math.abs(p.y)), 1);
    const step = Math.max(1, Math.ceil(visible.length / 4000));
    const chartData = visible.filter((_,i) => i%step===0).map(p => ({x: p.x, y: p.y/maxY}));

    const getX = (clientX) => {
      if (!brukerChartRef.current) return null;
      const w = brukerChartRef.current.querySelector('.recharts-wrapper');
      if (!w) return null;
      const r = w.getBoundingClientRect();
      const plotW = r.width - CHART_MARGIN.left - CHART_MARGIN.right;
      if (plotW <= 0) return null;
  const fx = Math.min(1, Math.max(0, (clientX - r.left - CHART_MARGIN.left) / plotW));
   return dom[1] - fx * (dom[1] - dom[0]);
    };
    const onDown = (e) => {
      const v = getX(e.clientX); if (v===null) return;
      brukerDragRef.current = true; setBrukerRefL(v); setBrukerRefR(v);
    };
    const onMove = (e) => {
      if (!brukerDragRef.current) return;
      const v = getX(e.clientX); if (v!==null) setBrukerRefR(v);
    };
    const onUp = () => {
      if (!brukerDragRef.current) return;
      brukerDragRef.current = false;
   if (brukerRefL!==null && brukerRefR!==null && Math.abs(brukerRefL-brukerRefR)>0.01) {
     const lo2=Math.min(brukerRefL,brukerRefR), hi2=Math.max(brukerRefL,brukerRefR);
     setBrukerZoomDom([lo2, hi2]);
   }
      setBrukerRefL(null); setBrukerRefR(null);
    };

    const PANEL_H = expandedBruker ? '100%' : 260;
    const topMargin = 10;
    const labelAreaH = (showPeakLabels && peakMarkers.length > 0) ? 55 : 0;

    return (
      <div className={'bg-white border border-sky-200 rounded-xl p-3 flex flex-col gap-2' + (expandedBruker ? ' fixed inset-2 z-50 shadow-2xl' : '')}>
        {expandedBruker && <div className="fixed inset-0 bg-black/40 -z-10" onClick={() => setExpandedBruker(false)} />}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h5 className="text-xs font-bold text-slate-700">
            {String.fromCodePoint(0x1F4C8)} {spec.title || 'Imported 1r'}
            {spec.meta?.nucleus ? ' — ' + spec.meta.nucleus : ''}
            {spec.meta?.sfo1 ? ' (' + spec.meta.sfo1.toFixed(0) + ' MHz)' : ''}
          </h5>
          <div className="flex items-center gap-2 flex-wrap">
            {isZoomed && <button type="button" onClick={() => setBrukerZoomDom(null)} className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded font-bold">Reset zoom</button>}
            <label className="flex items-center gap-1 text-xs font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showPeakLabels} onChange={e => setShowPeakLabels(e.target.checked)} className="accent-blue-600" />
              Peak labels
            </label>
            <button type="button" onClick={() => setExpandedBruker(b => !b)} className="text-slate-400 hover:text-blue-600 text-lg px-1" title={expandedBruker ? 'Collapse' : 'Expand'}>{expandedBruker ? '\u2199\ufe0f' : '\u2197\ufe0f'}</button>
            <button type="button" onClick={() => { updateActiveTest({nmr1dSpectrum: null}); setBrukerZoomDom(null); setNmrBrukerMsg(''); }} className="text-[10px] text-red-400 hover:text-red-600 font-bold">× Remove</button>
          </div>
        </div>
        <div ref={brukerChartRef} className="select-none" style={{height: PANEL_H, backgroundColor: 'white', position: 'relative'}}
             onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
       <ResponsiveContainer width="100%" height="100%">
         <LineChart data={chartData} margin={{top: topMargin + labelAreaH, right: CHART_MARGIN.right, bottom: CHART_MARGIN.bottom, left: CHART_MARGIN.left}}>
           <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
           <XAxis type="number" dataKey="x" domain={dom} reversed={true} allowDataOverflow
             ticks={(() => {
               const lo = Math.min(dom[0], dom[1]);
               const hi = Math.max(dom[0], dom[1]);
               const raw = (hi - lo) / 8;
               const mag = Math.pow(10, Math.floor(Math.log10(raw)));
               const norm = raw / mag;
               const st = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
               const out = [];
               for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(4));
               return out;
             })()}
             tickFormatter={v => Number(v).toFixed(2)}
             tick={{fontSize:9, fill:'#64748b'}}
             label={{value:'Chemical Shift (ppm)', position:'insideBottom', offset:-12, fontSize:9, fill:'#64748b'}} />
           <YAxis hide domain={[-0.05,1.05]} />
           <Tooltip formatter={v => Number(v).toFixed(3)} labelFormatter={v => Number(v).toFixed(2) + ' ppm'} />
           <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
           {brukerRefL!==null && brukerRefR!==null && <ReferenceArea x1={brukerRefL} x2={brukerRefR} fill="#cbd5e1" fillOpacity={0.4} />}
         </LineChart>
       </ResponsiveContainer>
          {showPeakLabels && peakMarkers.length > 0 && (
            <PeakLabelOverlay
              markers={peakMarkers}
              dom={dom}
              marginLeft={CHART_MARGIN.left}
              marginRight={CHART_MARGIN.right}
              marginTop={topMargin + labelAreaH}
              marginBottom={CHART_MARGIN.bottom}
              labelAreaH={labelAreaH}
            />
          )}
        </div>
        <p className="text-[9px] text-slate-400">
          {xs.length.toLocaleString()} pts · SW={spec.meta?.swPpm ? spec.meta.swPpm.toFixed(2) : '?'} ppm ·
          {isZoomed ? ' Zoomed — drag to re-zoom' : ' Drag to zoom'}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">Active instance:</span>
        <span className="text-sm font-black text-indigo-900">{d.activeInstance ? d.activeInstance.name : '—'}</span>
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <span className="text-xs font-bold text-slate-500">Editing: <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span></span>
          <div className="flex gap-2 flex-wrap items-center">
            {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && d.moleculeType !== 'organic' && (
              <div className="flex bg-slate-200 p-1 rounded-lg mr-2">
                <button onClick={() => { setTableMode('backbone'); updateActiveTest({ tableMode: 'backbone' }); }} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === 'backbone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Backbone</button>
                <button onClick={() => { setTableMode('all'); updateActiveTest({ tableMode: 'all' }); }} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>All Atoms</button>
              </div>
            )}
            <button onClick={openExportModal} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 border border-indigo-300 text-indigo-700 hover:bg-indigo-100">📄 Publication Table</button>
            <button onClick={fillEstimated} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-50 border border-green-300 text-green-700 hover:bg-green-100">✨ Fill Estimated</button>
            <button onClick={() => setShowImport(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100">📥 Import Fitted Parameters</button>
            {dragSel && (
              <button onClick={copyCells} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 border border-blue-700 text-white hover:bg-blue-700 flex items-center gap-1">
                📋 Copy Selection {copiedMsg && <span className="text-blue-200">{copiedMsg}</span>}
              </button>
            )}
            {dragSel && (
              <button onClick={() => setDragSel(null)} className="px-2 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-600">✕ Clear</button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center border-t border-slate-100 pt-3">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Visible Columns:</span>
            {d.layers.map((l) => (
                <label key={l.key} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded border cursor-pointer ${visibleLayers.includes(l.key) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <input type="checkbox" checked={visibleLayers.includes(l.key)} onChange={() => toggleLayerVisibility(l.key)} className="accent-blue-600" />
                    {l.label}
                    {!l.builtin && (
                        <button type="button" onClick={(e) => { e.preventDefault(); removeLayer(l.key); }} className="ml-1 text-slate-400 hover:text-red-500 font-black">×</button>
                    )}
                </label>
            ))}
        </div>
      </div>

      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
          Enter a sequence / select a molecule to generate the table.
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[600px]">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-[10px] text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 font-black border-b border-slate-200 w-20 text-center sticky left-0 bg-slate-100 z-20 shadow-[1px_0_0_#e2e8f0]">Residue</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Nucleus / Atom</th>
                {visibleLayers.map(lk => {
                    const layer = d.layers.find(l => l.key === lk);
                    if (!layer) return null;
                    return (
                        <th key={lk} className="px-3 py-2 font-bold border-b border-slate-200 text-center min-w-[120px] relative group">
                            <div className="flex flex-col items-center gap-0.5">
                              <span>{layer.label} {layer.unit ? `(${layer.unit})` : ''}</span>
                              {layer.source && (
                                <button
                                  type="button"
                                  title={`Imported from: ${layer.source.testName}`}
                                  onClick={() => ctx.jumpToTest?.(layer.source.testId)}
                                  className="text-[9px] font-bold text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-0.5 leading-none"
                                >
                                  🔗 {layer.source.testName}
                                </button>
                              )}
                            </div>
                            {!layer.builtin && (
                                <button onClick={(e) => { e.preventDefault(); removeLayer(lk); }} className="absolute top-1.5 right-1.5 bg-red-100 text-red-500 hover:text-red-700 hover:bg-red-200 rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Delete column">✕</button>
                            )}
                        </th>
                    );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                const resAtoms = d.atomOptions.filter((opt) => opt.key.startsWith(`${idx}-`));
                
                const displayAtoms = effTableMode === 'backbone' 
                   ? resAtoms.filter(o => o.label.includes(' HN ') || o.label.includes(' N ') || o.label.includes(' Cα ') || o.label.includes(' Cβ ') || o.label.includes(" C' "))
                   : resAtoms;

                return displayAtoms.map((opt, aIdx) => {
                  const atomName = opt.key.slice(String(idx).length + 1);
                  const isSel = cellIsSelected(idx, atomName);
                  let est = undefined;
                  if (opt.label.includes('(¹H)')) est = res.estShifts?.[atomName];
                  else if (opt.label.includes('(¹³C)')) est = atomName === "C'" ? res.estCP : res.estUniqueC?.[atomName];
                  else if (opt.label.includes('(¹⁵N)')) est = res.estN;
                  else if (opt.label.includes('(³¹P)')) est = res.p31;

                  return (
                    <tr key={opt.key} className="hover:bg-slate-50 transition-colors border-b border-slate-50">
                      {aIdx === 0 && (
                        <td rowSpan={displayAtoms.length} className="px-3 py-1 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-200 align-top sticky left-0 z-10 shadow-[1px_0_0_#e2e8f0]">
                          {res.id}
                        </td>
                      )}
                      <td className="px-3 py-1 font-bold text-slate-600 border-r border-slate-100 whitespace-nowrap text-xs">
                        {opt.label.replace(`${res.id} `, '')}
                      </td>
                      {visibleLayers.map(lk => {
                          const layer = d.layers.find(l => l.key === lk);
                          if (!layer) return null;
                          const valMap = lk === 'cs' ? activeTest.chemicalShifts : (d.allLayerValues[lk] || {});
                          const val = valMap?.[opt.key];
                          
                          const hasValue = parseManual(val) !== null;
                          
                          let isManuallyEdited = false;
                          if (hasValue) {
                              if (lk !== 'cs') {
                                  isManuallyEdited = true;
                              } else if (est !== undefined && est !== null) {
                                  const valNum = parseFloat(val);
                                  const estNum = parseFloat(est);
                                  if (Math.abs(valNum - estNum) > 0.001) isManuallyEdited = true;
                              } else {
                                  isManuallyEdited = true;
                              }
                          }
                          
                          const isFillEstimated = hasValue && !isManuallyEdited;

                          const isDragSelected = cellInDragSel(idx, atomName, lk);
                          const tdClass = `px-2 py-1 cursor-pointer transition-colors border-r border-slate-100 select-none ${
                              isDragSelected ? 'bg-blue-100 ring-1 ring-inset ring-blue-400' :
                              isSel ? 'bg-amber-100 ring-1 ring-inset ring-amber-400' : 
                              isManuallyEdited ? 'bg-emerald-100' : 
                              isFillEstimated ? 'bg-green-50' : 'hover:bg-slate-50'
                          }`;

                          const inputClass = `w-full border rounded px-1.5 py-0.5 outline-none text-xs font-mono text-center transition-colors ${
                              isManuallyEdited ? 'border-emerald-600 bg-emerald-100 text-emerald-900 font-black' : 
                              isFillEstimated ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 
                              'border-slate-200 focus:border-blue-500 bg-transparent text-slate-700'
                          }`;

                          return (
                              <td key={lk} className={tdClass}
                                onClick={(e) => handleCellClick(e, idx, atomName)}
                                onMouseDown={(e) => startDrag(idx, atomName, lk, e)}
                                onMouseEnter={() => extendDrag(idx, atomName, lk)}
                              >
                                  <input 
                                    type="text" 
                                    value={val || ''} 
                                    onChange={(e) => handleShiftChange(idx, atomName, lk, e.target.value)} 
                                    className={inputClass} 
                                    placeholder="—" 
                                  />
                                  {lk === 'cs' && est !== undefined && est !== null && <div className="text-[10px] font-bold text-slate-400 text-center mt-0.5" title="Theoretical estimate">≈ {est.toFixed(2)}</div>}
                              </td>
                          );
                      })}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mt-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">New Parameter Column Name</label>
            <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="e.g. T1, T2, S2, RDC" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-56 bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
            <input type="text" value={newLayerUnit} onChange={(e) => setNewLayerUnit(e.target.value)} placeholder="e.g. s, Hz" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-24 bg-white" />
          </div>
          <button type="button" onClick={addLayer} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">+ Add Parameter</button>
        </div>
      </div>

   {renderSpectrum()}
   <NMRSpectraVisualization ctx={ctx} />
   <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-sm font-bold text-sky-900">{String.fromCodePoint(0x1F4E5)} Bruker Import — 1r processed spectrum (ppm axis)</h4>
          {activeTest.nmr1dSpectrum && Array.isArray(activeTest.nmr1dSpectrum.xs) && activeTest.nmr1dSpectrum.xs.length > 0 && <span className="text-[9px] bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">Spectrum loaded</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white border border-sky-200 rounded-lg p-3 flex flex-col gap-2">
            <span className="text-xs font-bold text-sky-800">{String.fromCodePoint(0x1F4BB)} From this PC</span>
            
            <label className="bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors text-left flex items-center gap-2">
              <span className="text-xl">📁</span>
              <div>
                <div>Choose Bruker Folder...</div>
                <div className="text-[9px] font-normal opacity-70">Select the experiment folder (or a parent folder)</div>
              </div>
              <input 
                ref={nmrBrukerFileRef} 
                type="file" 
                webkitdirectory="true" 
                directory="true" 
                multiple 
                onChange={importFolder} 
                className="hidden" 
              />
            </label>
            
            <span className="text-[9px] text-sky-700 mt-1 max-w-sm">
              This will automatically locate the 1r file(s) and their corresponding acqus parameter files, instantly importing the correct ppm axis. If multiple experiments are selected, they will automatically be loaded into separate condition tabs.
            </span>
          </div>

          <div className="bg-white border border-sky-200 rounded-lg p-3 flex flex-col gap-2">
            <span className="text-xs font-bold text-sky-800">{String.fromCodePoint(0x1F517)} From Google Drive link</span>
            <input type="text" value={nmrBrukerDataUrl} onChange={e => setNmrBrukerDataUrl(e.target.value)}
              placeholder="Link to 1r (…/file/d/…/view)" className="border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 bg-white" />
            <input type="text" value={nmrBrukerAcqusUrl} onChange={e => setNmrBrukerAcqusUrl(e.target.value)}
              placeholder="Link to acqus (optional)" className="border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 bg-white" />
            <button type="button" onClick={importFromUrl} disabled={nmrBrukerBusy}
              className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">
              {nmrBrukerBusy ? 'Importing\u2026' : 'Import from links'}
            </button>
            <span className="text-[9px] text-sky-600">Both files must be shared as "Anyone with the link".</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 bg-white border border-sky-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-sky-800">Manual SW (ppm) — only if no acqus</label>
            <input type="number" step="0.1" value={nmrBrukerSwPpm} onChange={e => setNmrBrukerSwPpm(e.target.value)}
              onWheel={e => e.target.blur()} className="border border-sky-300 rounded-lg p-1.5 text-xs outline-none focus:border-sky-500 w-28" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-sky-800">Centre O1 (ppm)</label>
            <input type="number" step="0.01" value={nmrBrukerO1Ppm} onChange={e => setNmrBrukerO1Ppm(e.target.value)}
              onWheel={e => e.target.blur()} className="border border-sky-300 rounded-lg p-1.5 text-xs outline-none focus:border-sky-500 w-28" />
          </div>
          <span className="text-[9px] text-sky-600 max-w-xs">If an acqus file is provided, SFO1 + SW_h + O1 are read automatically and the manual fields are ignored.</span>
        </div>

        {nmrBrukerMsg && <span className="text-xs font-bold text-sky-900">{nmrBrukerMsg}</span>}
      </div>

      {/* Export Publication Table Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-5xl flex flex-col gap-4 max-h-[95vh]">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-800">Export Publication Table</h3>
                <p className="text-xs text-slate-500">Filter what to export. Empty rows are excluded automatically.</p>
              </div>
              <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-red-500 font-bold text-2xl leading-none">&times;</button>
            </div>
            
            <div className="flex flex-wrap gap-x-6 gap-y-3 items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Include Parameters:</span>
                  {d.layers.map((l) => (
                      <label key={l.key} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded border cursor-pointer ${exportColumns.includes(l.key) ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500'}`}>
                          <input type="checkbox" checked={exportColumns.includes(l.key)} onChange={() => toggleExportColumn(l.key)} className="accent-blue-600" />
                          {l.label}
                      </label>
                  ))}
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Include Nuclei:</span>
                  {['1H', '13C', '15N', '31P'].map((nuc) => (
                      <label key={nuc} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded border cursor-pointer ${exportNuclei.includes(nuc) ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-500'}`}>
                          <input type="checkbox" checked={exportNuclei.includes(nuc)} onChange={() => toggleExportNucleus(nuc)} className="accent-indigo-600" />
                          {nuc.replace('1H', '¹H').replace('13C', '¹³C').replace('15N', '¹⁵N').replace('31P', '³¹P')}
                      </label>
                  ))}
              </div>
            </div>

            <div className="overflow-auto flex-1 border border-slate-300 p-8 bg-white shadow-inner" id="publication-table-container">
              <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: '"Times New Roman", Times, serif', fontSize: '11pt', color: 'black', borderBottom: '2px solid black' }}>
                <thead>
                  {isPolymer ? (
                    <tr>
                      <th style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>Residue</th>
                      {exportColumns.map(lk => {
                        const layer = d.layers.find(l => l.key === lk);
                        const prefix = exportColumns.length > 1 ? `${layer?.label || lk} ` : '';
                        return (
                          <React.Fragment key={lk}>
                            {commonAtoms.map(ca => (
                              <th key={`${lk}-${ca}`} style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>{prefix}{ca}</th>
                            ))}
                            <th style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>{prefix}Others</th>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ) : (
                    <tr>
                      <th style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>Residue</th>
                      <th style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'left', fontWeight: 'bold' }}>Atom</th>
                      {exportColumns.map(lk => {
                        const layer = d.layers.find(l => l.key === lk);
                        return <th key={lk} style={{ borderTop: '2px solid black', borderBottom: '1px solid black', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>{layer ? `${layer.label}${layer.unit ? ` (${layer.unit})` : ''}` : lk}</th>;
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {d.estSeq.flatMap((res, idx) => {
                    if (focusIdx !== 'ALL' && focusIdx !== idx) return [];
                    
                    if (isPolymer) {
                      const rowDataByLayer = {};
                      let hasAnyData = false;
                      
                      exportColumns.forEach(lk => {
                        const valMap = lk === 'cs' ? activeTest.chemicalShifts : (d.allLayerValues[lk] || {});
                        const layerData = {};
                        const resAtoms = d.atomOptions.filter(opt => {
                            if (!opt.key.startsWith(`${idx}-`)) return false;
                            const aName = opt.key.slice(String(idx).length + 1);
                            return exportNuclei.includes(getAtomNucleus(aName));
                        });

                        resAtoms.forEach(opt => {
                          const atomName = opt.key.slice(String(idx).length + 1);
                          const val = valMap?.[opt.key];
                          if (val !== undefined && val !== null && val !== '') {
                            layerData[atomName] = val;
                            hasAnyData = true;
                          }
                        });
                        rowDataByLayer[lk] = layerData;
                    });
                     
                    if (!hasAnyData) return [];
                    
                    return (
                      <tr key={idx}>
                        <td style={{ padding: '4px 8px', textAlign: 'left' }}>{res.id}</td>
                        {exportColumns.map(lk => {
                          const layerData = rowDataByLayer[lk];
                          const others = [];
                          
                          const commonCells = commonAtoms.map(ca => {
                            const val = layerData[ca];
                            return <td key={`${lk}-${ca}`} style={{ padding: '4px 8px', textAlign: 'center' }}>{val || '-'}</td>;
                          });
                          
                          Object.keys(layerData).forEach(atomName => {
                            if (!commonAtoms.includes(atomName)) {
                                others.push(`${atomName}: ${layerData[atomName]}`);
                            }
                          });
                          
                          const othersCell = <td key={`${lk}-others`} style={{ padding: '4px 8px', textAlign: 'center' }}>{others.length > 0 ? others.sort().join(', ') : '-'}</td>;
                          
                          return (
                            <React.Fragment key={lk}>
                              {commonCells}
                              {othersCell}
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    );
                  } else {
                    const resAtoms = d.atomOptions.filter((opt) => {
                        if (!opt.key.startsWith(`${idx}-`)) return false;
                        const aName = opt.key.slice(String(idx).length + 1);
                        return exportNuclei.includes(getAtomNucleus(aName));
                    });

                    const displayAtoms = effTableMode === 'backbone' 
                       ? resAtoms.filter(o => o.label.includes(' HN ') || o.label.includes(' N ') || o.label.includes(' Cα ') || o.label.includes(' Cβ ') || o.label.includes(" C' "))
                       : resAtoms;
                       
                    return displayAtoms.map((opt, aIdx) => {
                      const rowHasData = exportColumns.some(lk => {
                        const valMap = lk === 'cs' ? activeTest.chemicalShifts : (d.allLayerValues[lk] || {});
                        const val = valMap?.[opt.key];
                        return val !== undefined && val !== null && val !== '';
                      });
                      
                      if (!rowHasData) return null;

                      return (
                        <tr key={opt.key}>
                          <td style={{ padding: '4px 8px', textAlign: 'left' }}>{res.id}</td>
                          <td style={{ padding: '4px 8px', textAlign: 'left' }}>{opt.label.replace(`${res.id} `, '')}</td>
                          {exportColumns.map(lk => {
                            const valMap = lk === 'cs' ? activeTest.chemicalShifts : (d.allLayerValues[lk] || {});
                            const val = valMap?.[opt.key];
                            return <td key={lk} style={{ padding: '4px 8px', textAlign: 'center' }}>{val || '-'}</td>;
                          })}
                        </tr>
                      );
                    }).filter(Boolean);
                  }
                })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-400">If the copy button fails, manually select the table and press Ctrl+C</span>
              <div className="flex gap-3">
                <button onClick={() => setShowExportModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded font-bold transition-colors">Close</button>
                <button onClick={saveTableAsImage} className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2">
                  <span>📸</span> Save Table as Figure
                </button>
                <button onClick={copyPublicationTable} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-sm transition-colors flex items-center gap-2">
                  <span>📋</span> Copy to Clipboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// ================= SECONDARY SHIFTS SECTION =================
const SCS_INST_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#22c55e','#ef4444','#0ea5e9','#ec4899','#14b8a6'];

const computeSCSRows = (estSeq, cs, focusIdx) =>
  estSeq.map((res, idx) => {
    const rc = RANDOM_COIL_DB[res.char] || {};
    const getVal = (k, estVal) => { const m = parseManual(cs[`${idx}-${k}`]); return m !== null ? m : estVal; };
    const HA = getVal('Hα', res.estShifts?.['Hα']);
    const CA = getVal('Cα', res.estUniqueC?.['Cα']);
    const CB = getVal('Cβ', res.estUniqueC?.['Cβ']);
    // C' (carbonyl): estCP is seeded from RANDOM_COIL_DB.CO, so Δ = estCP - rc.CO
    const CO = getVal("C'", res.estCP);
    return {
      label: res.id, idx,
      HA: HA != null && rc.HA != null ? +(HA - rc.HA).toFixed(3) : null,
      CA: CA != null && rc.CA != null ? +(CA - rc.CA).toFixed(3) : null,
      CB: CB != null && rc.CB != null ? +(CB - rc.CB).toFixed(3) : null,
      CO: CO != null && rc.CO != null ? +(CO - rc.CO).toFixed(3) : null,
    };
  }).filter(r => focusIdx === undefined || focusIdx === 'ALL' || r.idx === focusIdx);

// =========================================================================
// NMRSections.jsx - REPLACE SecondaryShiftsSection COMPONENT
// =========================================================================
export const SecondaryShiftsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const scsCfg = activeTest.scsCfg || {
    fontSize: 11, barColorHA: '#3b82f6', barColorCA: '#8b5cf6', barColorCB: '#f59e0b', barColorCO: '#22c55e', negColor: '#ef4444',
    showHLine: true, hLineVal: 1.5, aspect: 2.5, xAxisTitle: 'Residues', yAxisTitle: 'Δδ (ppm)'
  };
  const setCfg = (patch) => updateActiveTest({ scsCfg: { ...scsCfg, ...patch } });
  const [showConfig, setShowConfig] = useState(false);
  const [diffMode, setDiffMode] = useState(false);
  const [refInstId, setRefInstId] = useState(null);

  const [localColors, setLocalColors] = useState(activeTest.instanceColors || {});
  const [customPaletteInput, setCustomPaletteInput] = useState('#ef4444, #3b82f6, #22c55e');

  const allInsts = d.instances || [];
  const effectiveRefId = refInstId || (allInsts.length > 0 ? allInsts[0].id : null);
  const refInst = allInsts.find(i => i.id === effectiveRefId);

  const applyPalette = (paletteKey) => {
    let palette;
    if (paletteKey === 'custom') {
      palette = customPaletteInput.split(',').map(s => s.trim()).filter(s => /^#([0-9A-F]{3}){1,2}$/i.test(s));
      if (!palette.length) return alert('Enter valid hex codes (e.g. #ff0000, #00ff00)');
    } else {
      palette = VIS_PALETTES[paletteKey] || VIS_PALETTES.default;
    }
    const nextColors = { ...localColors };
    allInsts.forEach((inst, idx) => { nextColors[inst.id] = palette[idx % palette.length]; });
    setLocalColors(nextColors);
    updateActiveTest({ instanceColors: nextColors });
  };

  if (d.moleculeType !== 'protein' || !d.parsedSeq.length) return (<div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">SCS requires a protein sequence.</div>);

  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const cs = d.shifts;
  const rows = computeSCSRows(d.estSeq, cs, focusIdx);
  const mk = (k) => rows.map((r) => ({ label: r.label, v: r[k] })).filter(x => x.v !== null);

  const mkDiff = (k) => {
    if (!refInst) return [];
    const refCs = refInst.values?.cs || {};
    const refRows = computeSCSRows(d.estSeq, refCs, focusIdx);
    const refMap = Object.fromEntries(refRows.map(r => [r.label, r[k]]));
    return allInsts
      .filter(i => i.id !== effectiveRefId)
      .map(inst => ({
        name: inst.name,
        color: localColors[inst.id] || SCS_INST_COLORS[allInsts.findIndex(x => x.id === inst.id) % SCS_INST_COLORS.length],
        data: computeSCSRows(d.estSeq, inst.values?.cs || {}, focusIdx)
          .map(r => ({ label: r.label, v: r[k] != null && refMap[r.label] != null ? +(r[k] - refMap[r.label]).toFixed(3) : null }))
          .filter(x => x.v !== null)
      }))
      .filter(s => s.data.length > 0);
  };

  const SCSPlot = ({ title, data, color, cfg }) => (
    <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
      <h4 className="font-bold text-xs text-slate-700 mb-2 text-center">{title}</h4>
      <ResponsiveContainer width="100%" aspect={cfg.aspect}>
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: cfg.fontSize }} />
          <YAxis tick={{ fontSize: cfg.fontSize }} />
          <Tooltip />
          {cfg.showHLine && <ReferenceLine y={cfg.hLineVal} stroke="red" strokeDasharray="3 3" />}
          {cfg.showHLine && <ReferenceLine y={-cfg.hLineVal} stroke="red" strokeDasharray="3 3" />}
          <ReferenceLine y={0} stroke="#000" />
          <Bar dataKey="v">
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.v < 0 ? cfg.negColor : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  const DiffPlot = ({ title, seriesList, cfg }) => {
    if (!seriesList.length) return <div className="bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center text-xs text-slate-400">No comparison data</div>;
    const allLabels = [...new Set(seriesList.flatMap(s => s.data.map(p => p.label)))];
    const merged = allLabels.map(label => {
      const pt = { label };
      seriesList.forEach(s => { const d2 = s.data.find(p => p.label === label); pt[s.name] = d2?.v ?? null; });
      return pt;
    });
    return (
      <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
        <h4 className="font-bold text-xs text-slate-700 mb-2 text-center">{title}</h4>
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <BarChart data={merged} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} />
            <Tooltip />
            {cfg.showHLine && <ReferenceLine y={cfg.hLineVal} stroke="red" strokeDasharray="3 3" />}
            {cfg.showHLine && <ReferenceLine y={-cfg.hLineVal} stroke="red" strokeDasharray="3 3" />}
            <ReferenceLine y={0} stroke="#000" />
            {seriesList.map((s) => (
              <Bar key={s.name} dataKey={s.name} fill={s.color} />
            ))}
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2">
        <button onClick={() => setShowConfig(!showConfig)} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded shadow-sm font-bold text-slate-700 hover:bg-slate-100">⚙️ Customize</button>
        {allInsts.length > 1 && (
          <>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={diffMode} onChange={e => setDiffMode(e.target.checked)} className="accent-purple-600 w-3.5 h-3.5" />
              Δ Condition comparison
            </label>
            {diffMode && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Reference:</span>
                <select value={effectiveRefId || ''} onChange={e => setRefInstId(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-purple-500">
                  {allInsts.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <span className="text-slate-300 mx-1">|</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Colors:</span>
                <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50 outline-none cursor-pointer">
                  <option value="">🎨 Apply Palette...</option>
                  {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
                </select>
                <input type="text" placeholder="#f00, #0f0..." value={customPaletteInput} onChange={e => setCustomPaletteInput(e.target.value)} className="text-[10px] border border-slate-300 px-2 py-1 rounded w-32 outline-none focus:border-purple-500" />
                <button onClick={() => applyPalette('custom')} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">Apply</button>
              </div>
            )}
          </>
        )}
      </div>

      {showConfig && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-300 shadow-sm">
          <NumField label="Font size" value={scsCfg.fontSize} onChange={(v) => setCfg({ fontSize: v || 11 })} />
          <NumField label="Aspect ratio (W/H)" step={0.1} value={scsCfg.aspect} onChange={(v) => setCfg({ aspect: v || 2.5 })} />
          <TxtField label="X axis title" value={scsCfg.xAxisTitle} onChange={(v) => setCfg({ xAxisTitle: v })} />
          <TxtField label="Y axis title" value={scsCfg.yAxisTitle} onChange={(v) => setCfg({ yAxisTitle: v })} />
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Show Max H-Line</label>
            <input type="checkbox" checked={scsCfg.showHLine} onChange={(e) => setCfg({ showHLine: e.target.checked })} className="accent-blue-600 mt-1 h-4 w-4" />
          </div>
          <NumField label="H-Line value" step={0.1} value={scsCfg.hLineVal} onChange={(v) => setCfg({ hLineVal: v })} />
          {[['barColorHA', 'ΔHα color'], ['barColorCA', 'ΔCα color'], ['barColorCB', 'ΔCβ color'], ['barColorCO', "ΔC′ color"], ['negColor', 'Negative bars color']].map(([k, lab]) => (
            <div key={k} className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500">{lab}</label>
              <input type="color" value={scsCfg[k] || '#3b82f6'} onChange={(e) => setCfg({ [k]: e.target.value })} className="w-10 h-8 rounded cursor-pointer border border-slate-300" />
            </div>
          ))}
        </div>
      )}

      {diffMode && allInsts.length > 1 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-slate-500 italic">Showing Δδ (condition − <b>{refInst?.name || 'reference'}</b>) for each non-reference instance.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DiffPlot title="ΔΔHα" seriesList={mkDiff('HA')} cfg={scsCfg} />
            <DiffPlot title="ΔΔCα" seriesList={mkDiff('CA')} cfg={scsCfg} />
            <DiffPlot title="ΔΔCβ" seriesList={mkDiff('CB')} cfg={scsCfg} />
            <DiffPlot title="ΔΔC′" seriesList={mkDiff('CO')} cfg={scsCfg} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SCSPlot title="ΔHα (HA)" data={mk('HA')} color={scsCfg.barColorHA} cfg={{ ...scsCfg }} />
          <SCSPlot title="ΔCα (CA)" data={mk('CA')} color={scsCfg.barColorCA} cfg={{ ...scsCfg }} />
          <SCSPlot title="ΔCβ (CB)" data={mk('CB')} color={scsCfg.barColorCB} cfg={{ ...scsCfg }} />
          <SCSPlot title="ΔC′ (CO)" data={mk('CO')} color={scsCfg.barColorCO} cfg={{ ...scsCfg }} />
        </div>
      )}
    </div>
  );
};

// ================= CONDITION PLOT PANEL =================
export const ConditionPlotPanel = ({ ctx, d, plot, updatePlot, removePlot, duplicatePlot }) => {
  const { activeTest, updateActiveTest } = ctx;
  const cfg = { ...DEFAULT_CHART_STYLE, ...(plot.style || {}) };
  const [atomSearch, setAtomSearch] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const chartRef = useRef(null);
  const isHist = (plot.chartType || 'line') === 'hist';
  const is3D = plot.chartType === '3d';
  const set = (patch) => updatePlot(plot.id, patch);
  const setCfg = (patch) => updatePlot(plot.id, { style: { ...cfg, ...patch } });
  const plotLayer = d.layers.find((l) => l.key === plot.layerKey) || d.layers[0];
  const experimentalFields = d.fields;
  const effXField = experimentalFields.some((f) => f.key === plot.xField) ? plot.xField : (experimentalFields[0]?.key || 'temperature');
  const xFieldLabel = experimentalFields.find((f) => f.key === effXField)?.label || effXField;
  const filtered = d.atomOptions.filter((o) => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (key) => set({ atoms: plot.atoms.includes(key) ? plot.atoms.filter((k) => k !== key) : [...plot.atoms, key] });
  const selectAllFiltered = () => set({ atoms: Array.from(new Set([...plot.atoms, ...filtered.map((o) => o.key)])) });
  const presets = Array.isArray(activeTest.atomSelectionPresets) ? activeTest.atomSelectionPresets : [];
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || plot.atoms.length === 0) return;
    updateActiveTest({ atomSelectionPresets: [...presets, { id: makePlotId(), name, atoms: [...plot.atoms] }] });
    setPresetName('');
  };
  const applyPreset = (id) => { const p = presets.find((x) => x.id === id); if (p) set({ atoms: [...(p.atoms || [])] }); };
  const deletePreset = (id) => updateActiveTest({ atomSelectionPresets: presets.filter((x) => x.id !== id) });
  const used = plot.usedInstances || {};
  const toggleInstance = (iid) => set({ usedInstances: { ...used, [iid]: used[iid] === false ? undefined : false } });

  const comparableInfo = useMemo(() => {
    const xFieldKey = effXField;
    const groupFields = experimentalFields.filter((f) =>
      f.key !== xFieldKey && (!is3D || f.key !== plot.yField)
    );
    const usedInstances = d.instances.filter((inst) => used[inst.id] !== false);
    const signatures = usedInstances.map((inst) => ({
      inst,
      sig: groupFields.map((f) => String(getExpValue(inst, f.key) ?? '')).join('|')
    }));
    const sigCounts = {};
    signatures.forEach(({ sig }) => { sigCounts[sig] = (sigCounts[sig] || 0) + 1; });
    const mostCommonSig = Object.keys(sigCounts).sort((a, b) => sigCounts[b] - sigCounts[a])[0];
    const comparableInstIds = new Set(signatures.filter((s) => s.sig === mostCommonSig).map((s) => s.inst.id));
    const varyingFields = groupFields.filter((f) => {
      const vals = new Set(usedInstances.map((inst) => String(getExpValue(inst, f.key) ?? '')));
      return vals.size > 1;
    });
    const nonComparableCount = signatures.filter((s) => s.sig !== mostCommonSig).length;
    return { comparableInstIds, varyingFields, nonComparableCount, hasMismatch: nonComparableCount > 0 };
  }, [d.instances, used, effXField, plot.yField, is3D, experimentalFields]);
  const isComparable = (instId) => !plot.excludeNonComparable || comparableInfo.comparableInstIds.has(instId);

  const series = useMemo(() => plot.atoms.map((ak) => {
    const opt = d.atomOptions.find((o) => o.key === ak);
    const pts = [];
    d.instances.forEach((inst) => {
      if (used[inst.id] === false) return;
      if (!isComparable(inst.id)) return; 
      const vals = getInstanceValues(inst, inst.id === d.activeInstanceId, activeTest, plot.layerKey);
      const v = parseManual(vals[ak]);
      if (v === null) return;
      pts.push({
        instId: inst.id, name: inst.name,
        x: parseManual(getExpValue(inst, effXField)),
        y: v,
        y2: plot.yField ? parseManual(getExpValue(inst, plot.yField)) : null,
        excluded: !!((plot.excluded[ak] || {})[inst.id])
      });
    });
    pts.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    return { key: ak, label: opt ? opt.label : ak, pts };
  }), [plot.atoms, plot.layerKey, d.instances, d.atomOptions, plot.excluded, effXField, plot.yField, used, activeTest.nmrValues, plot.excludeNonComparable, comparableInfo]);

  const colorOf = (s) => seriesColor(cfg, s.key, series.findIndex((q) => q.key === s.key));
  const includedPts = (s) => s.pts.filter((p) => !p.excluded);
  const maxOf = (s) => { const v = includedPts(s).map((p) => p.y); return v.length ? Math.max(...v) : null; };
  const effSD = (sKey, p) => {
    const man = (plot.manualSD[sKey] || {})[p.instId];
    if (typeof man === 'number' && Number.isFinite(man)) return man;
    if (plot.useFixedSD) { const f = parseManual(plot.fixedSDStr); if (f !== null) return f; }
    return null;
  };
  const fitOf = (s) => {
    if (!plot.fitEnabled || is3D || isHist) return null;
    const wpts = includedPts(s).filter((p) => p.x !== null).map((p) => {
      const sd = effSD(s.key, p);
      return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1 };
    });
    return runFit(plot.fitModel, plot.customExpr, wpts);
  };
  const fits = useMemo(() => {
    const out = {};
    series.forEach((s) => { out[s.key] = fitOf(s); });
    return out;
  }, [series, plot.fitEnabled, plot.fitModel, plot.customExpr, plot.chartType, plot.manualSD, plot.useFixedSD, plot.fixedSDStr]);
  const setManualSD = (sKey, instId, val) => {
    const inner = { ...(plot.manualSD[sKey] || {}) };
    const n = parseManual(val);
    if (n === null) delete inner[instId]; else inner[instId] = n;
    set({ manualSD: { ...plot.manualSD, [sKey]: inner } });
  };
  const toggleExclude = (sKey, instId) => {
    const inner = { ...(plot.excluded[sKey] || {}) };
    if (inner[instId]) delete inner[instId]; else inner[instId] = true;
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
  const resetSD = (sKey) => { const next = { ...plot.manualSD }; delete next[sKey]; set({ manualSD: next }); };
  const cleanOutliers = (target) => {
    const thresh = parseManual(plot.outlierThreshStr) || 2.5;
    const excluded = JSON.parse(JSON.stringify(plot.excluded || {}));
    const proc = (s) => {
      for (let it = 0; it < 20; it++) {
        const pts = s.pts.filter((p) => !((excluded[s.key] || {})[p.instId]) && p.x !== null);
        if (pts.length < 4) break;
        const wpts = pts.map((p) => { const sd = effSD(s.key, p); return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1, p }; });
        const fit = runFit(plot.fitModel, plot.customExpr, wpts);
        if (!fit || !fit.f) break;
        let worst = null, maxR = 0;
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
    (target ? [target] : series).forEach(proc);
    set({ excluded });
  };
  const restoreExcluded = () => set({ excluded: {} });
  const visibleSeries = series.filter((s) => !plot.hiddenSeries[s.key]);
  const xs = visibleSeries.flatMap((s) => includedPts(s).filter((p) => p.x !== null).map((p) => p.x));
  const padX = xs.length ? ((Math.max(...xs) - Math.min(...xs)) * 0.05 || 1) : 1;
  const dataXDomain = xs.length ? [Math.min(...xs) - padX, Math.max(...xs) + padX] : [0, 1];
  const zoom = useXZoom(chartRef, dataXDomain);
  const xTicks = makeTicks(zoom.domain, cfg.tickStep);
  const catData = useMemo(() => {
    return d.instances.filter((inst) => used[inst.id] !== false).map((inst) => {
      const row = { __condition: inst.name };
      series.forEach((s) => {
        const p = s.pts.find((q) => q.instId === inst.id);
        if (p && !p.excluded) { row[s.key] = p.y; row[`${s.key}__sd`] = effSD(s.key, p); }
        else { row[s.key] = null; row[`${s.key}__sd`] = null; }
      });
      return row;
    });
  }, [d.instances, series, used, plot.manualSD, plot.useFixedSD, plot.fixedSDStr]);
  const numData = (s) => includedPts(s).filter((p) => p.x !== null).sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y, sd: effSD(s.key, p), name: p.name }));
  const fitData = (s) => {
    const fit = fits[s.key];
    if (!fit || !fit.f) return [];
    const [mn, mx] = zoom.domain;
    if (!(mx > mn)) return [];
    const out = [];
    for (let i = 0; i <= 60; i++) { const x = mn + ((mx - mn) * i) / 60; out.push({ x, y: fit.f(x) }); }
    return out;
  };
  const makeDot = (color, s) => (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={`d-${s.key}-${index}`} />;
    const r = cfg.ptSize || 5;
    let el;
    if (cfg.pointStyle === 'square') el = <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />;
    else if (cfg.pointStyle === 'triangle') el = <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={color} />;
    else if (cfg.pointStyle === 'cross') el = <g><line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={2} /><line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={2} /></g>;
    else el = <circle cx={cx} cy={cy} r={r} fill={color} />;
    return <g key={`d-${s.key}-${index}`}>{el}</g>;
  };
  const xLab = cfg.xAxisLabel || xFieldLabel;
  const yLab = cfg.yAxisLabel || `${plotLayer.label}${plotLayer.unit ? ` (${plotLayer.unit})` : ''}`;
  const refLines = (
    <>
      {plot.showMaxLines && visibleSeries.map((s) => {
        const m = maxOf(s);
        if (m === null) return null;
        const c = colorOf(s);
        return <ReferenceLine key={`mx-${s.key}`} y={m} stroke={c} strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: `max ${s.label}=${m.toFixed(2)}`, fill: c, fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }} />;
      })}
      {(plot.hLines || []).map((h) => {
        const v = parseManual(h.value);
        if (v === null) return null;
        return <ReferenceLine key={h.id} y={v} stroke={h.color || '#64748b'} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: h.label || `y=${v}`, fill: h.color || '#64748b', fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }} />;
      })}
    </>
  );
  const paramKeys = useMemo(() => {
    if (!plot.fitEnabled || is3D || isHist || !series.length) return [];
    return fitParamOptions(plot.fitModel, plot.customExpr);
  }, [plot.fitEnabled, plot.fitModel, plot.customExpr, series, is3D, isHist]);
  const [paramGraphVar, setParamGraphVar] = useState('');
  useEffect(() => { if (!paramKeys.includes(paramGraphVar)) setParamGraphVar(paramKeys[0] || ''); }, [paramKeys, paramGraphVar]);
  const paramData = useMemo(() => {
    if (!paramGraphVar) return [];
    return series.map((s) => {
      const f = fits[s.key];
      if (!f) return null;
      const val = extractFitParam(f, plot.fitModel, paramGraphVar);
      const err = plot.fitModel === 'custom' ? f.paramsErr?.[paramGraphVar] : f[`${paramGraphVar}Err`];
      if (val === undefined || val === null) return null;
      return { name: s.label, val, err: err || 0, fill: colorOf(s) };
    }).filter(Boolean);
  }, [series, fits, paramGraphVar, plot.fitModel, cfg.colors]);
  return (
    <CollapsibleSection title={plot.title} icon="📈" defaultOpen={true}
      headerExtra={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const nn = window.prompt('Rename plot:', plot.title); if (nn && nn.trim()) set({ title: nn.trim() }); }} className="text-slate-400 hover:text-blue-600" title="Rename">✏️</button>
          <button type="button" onClick={() => duplicatePlot(plot)} className="text-slate-400 hover:text-blue-600" title="Duplicate">⧉</button>
          <button type="button" onClick={() => removePlot(plot.id)} className="text-slate-400 hover:text-red-500" title="Remove">×</button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter (Y / Z)</label>
            <select value={plot.layerKey} onChange={(e) => set({ layerKey: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {d.layers.map((l) => <option key={l.key} value={l.key}>{l.label}{l.unit ? ` (${l.unit})` : ''}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">X axis (Experimental Condition)</label>
            <select value={effXField} onChange={(e) => set({ xField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {experimentalFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Type</label>
            <select value={plot.chartType || 'line'} onChange={(e) => set({ chartType: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="line">Line / Scatter (zoomable)</option>
              <option value="hist">Histogram (per instance)</option>
              <option value="3d">3D Scatter</option>
              <option value="3d-hist">3D Histogram</option>
            </select>
          </div>
          {is3D && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">2nd Experimental Condition field (Y of 3D)</label>
              <select value={plot.yField || ''} onChange={(e) => set({ yField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                <option value="">-- select --</option>
                {experimentalFields.filter((f) => f.key !== effXField).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
          )}
          {!is3D && !isHist && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 cursor-pointer">
              <input type="checkbox" checked={plot.fitEnabled} onChange={(e) => set({ fitEnabled: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Fit curve
            </label>
          )}
          {plot.fitEnabled && !is3D && !isHist && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
              <div className="flex gap-2 items-center">
                <select value={plot.fitModel} onChange={(e) => set({ fitModel: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                  <option value="linear">Linear (weighted)</option>
                  <option value="4pl">4PL logistic (weighted)</option>
                  <option value="custom">Custom Equation</option>
                </select>
                {plot.fitModel === 'custom' && (
                  <input type="text" value={plot.customExpr || ''} onChange={(e) => set({ customExpr: e.target.value })} placeholder="e.g. a*x^2 + b" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 w-32 bg-white" />
                )}
              </div>
            </div>
          )}
          <ChartControlBar
            showErr={showErr} onToggleErr={() => setShowErr(!showErr)}
            showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)}
          />
        </div>

        {comparableInfo.hasMismatch && !isHist && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-800 flex flex-col gap-2">
            <div>
              ⚠️ These experimental conditions differ between instances: <b>{comparableInfo.varyingFields.map((f) => f.label).join(', ')}</b>.
              {' '}{comparableInfo.nonComparableCount} point(s) come from instances with different conditions and may not be comparable.
            </div>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input type="checkbox" checked={!!plot.excludeNonComparable} onChange={(e) => set({ excludeNonComparable: e.target.checked })} className="accent-amber-600" />
              Exclude non-comparable points
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Conditions used:</span>
          {d.instances.map((inst) => (
            <label key={inst.id} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer ${used[inst.id] === false ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
              <input type="checkbox" checked={used[inst.id] !== false} onChange={() => toggleInstance(inst.id)} className="w-3.5 h-3.5 accent-blue-600" />
              {inst.name}
              <span className="text-[9px] font-mono opacity-70">({xFieldLabel}: {getExpValue(inst, effXField) || '—'})</span>
            </label>
          ))}
        </div>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-80 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-bold text-slate-600 uppercase">Atom(s) to plot</label>
              <button type="button" onClick={selectAllFiltered} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded">☑ Select all (filtered)</button>
              <button type="button" onClick={() => set({ atoms: [] })} className="text-[10px] font-bold text-red-500 hover:text-red-700 underline">Clear</button>
            </div>
            <input type="text" value={atomSearch} onChange={(e) => setAtomSearch(e.target.value)} placeholder="Search atom (e.g. Ala3 HN)…" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
            <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto custom-scrollbar bg-white">
              {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 italic">No atoms (enter a sequence first).</div>}
              {filtered.map((o) => (
                <label key={o.key} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0">
                  <input type="checkbox" checked={plot.atoms.includes(o.key)} onChange={() => toggleAtom(o.key)} className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs text-slate-700">{o.label}</span>
                </label>
              ))}
            </div>
            {plot.atoms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: colorOf(s) }}>
                    {s.label}
                    <button type="button" onClick={() => toggleAtom(s.key)} className="hover:text-red-200 font-black">×</button>
                  </span>
                ))}
              </div>
            )}
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
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({(p.atoms || []).length})</option>)}
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
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {visibleSeries.length > 0 && !is3D && (
              <div className="flex flex-wrap gap-2">
                {series.map((s) => (
                  <label key={s.key} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!plot.hiddenSeries[s.key]} onChange={() => set({ hiddenSeries: { ...plot.hiddenSeries, [s.key]: !plot.hiddenSeries[s.key] } })} className="w-3.5 h-3.5 accent-blue-600" />
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: colorOf(s) }} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
            {series.length === 0 ? (
              <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Select at least one atom to plot.</div>
            ) : is3D ? (
              <div className="bg-white border border-slate-200 rounded-xl p-3" style={{ height: Math.max(340, cfg.height) }}>
                <ThreeDScatter cfg={cfg} xLabel={xFieldLabel} yLabel={experimentalFields.find((f) => f.key === plot.yField)?.label || '—'} zLabel={plotLayer.label}
                  seriesList={visibleSeries.map((s) => ({ key: s.key, label: s.label, color: colorOf(s), pts: includedPts(s).filter((p) => p.x !== null && p.y2 !== null).map((p) => ({ x: p.x, y: p.y2, z: p.y, name: p.name })) }))} />
              </div>
            ) : (
              <div className="select-none relative">
                {!isHist && zoom.isZoomed && (
                  <button type="button" onClick={zoom.reset} className="absolute top-2 right-2 z-10 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>
                )}
                <div ref={chartRef} onMouseDown={isHist ? undefined : zoom.onMouseDown} style={chartBoxStyle(cfg)} className="bg-white border border-slate-200 rounded-xl p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    {isHist ? (
                      <BarChart data={catData} margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="__condition" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} />} tickMargin={10} label={{ value: 'Condition', position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <Tooltip />
                        {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                        {refLines}
                        {visibleSeries.map((s) => {
                          const color = colorOf(s);
                          return (
                            <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[cfg.barRadius || 3, cfg.barRadius || 3, 0, 0]} isAnimationActive={false}>
                              {HAS_EB && plot.showErrors && <ErrorBar dataKey={`${s.key}__sd`} width={4} strokeWidth={1} direction="y" color={color} />}
                            </Bar>
                          );
                        })}
                      </BarChart>
                    ) : (
                      <LineChart margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" dataKey="x" domain={[dom(cfg.xMin) ?? zoom.domain[0], dom(cfg.xMax) ?? zoom.domain[1]]} ticks={xTicks}
                          tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} />} tickMargin={10}
                          label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <Tooltip />
                        {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                        {refLines}
                        {visibleSeries.map((s) => {
                          const color = colorOf(s);
                          return (
                            <React.Fragment key={s.key}>
                              <Line data={numData(s)} type="monotone" dataKey="y" name={s.label} stroke={color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={plot.showPoints ? makeDot(color, s) : false} connectNulls isAnimationActive={false}>
                                {HAS_EB && plot.showErrors && <ErrorBar dataKey="sd" width={4} strokeWidth={1} direction="y" color={color} />}
                              </Line>
                              {plot.fitEnabled && plot.showFit && fits[s.key] && (
                                <Line data={fitData(s)} type="monotone" dataKey="y" name={`${s.label} (fit)`} stroke={color} strokeWidth={1.5} strokeDasharray="8 4" dot={false} legendType="none" isAnimationActive={false} />
                              )}
                            </React.Fragment>
                          );
                        })}
                        {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
                {!isHist && <p className="text-[10px] text-slate-400 mt-1">💡 Drag with the mouse across the graph to zoom into an X region.</p>}
              </div>
            )}
            {plot.fitEnabled && !is3D && !isHist && series.length > 0 && (
              <div className="flex flex-col gap-4">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left bg-white">
                    <thead className="bg-slate-100 text-slate-500 uppercase">
                      <tr><th className="px-3 py-2">Series</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Parameters (weighted)</th><th className="px-3 py-2">SE</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {series.map((s) => {
                        const f = fits[s.key];
                        return (
                          <tr key={s.key}>
                            <td className="px-3 py-1.5 font-bold text-slate-700">{s.label}</td>
                            <td className="px-3 py-1.5">{f ? (plot.fitModel === 'linear' ? 'Linear' : plot.fitModel === '4pl' ? '4PL' : 'Custom') : '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">
                              {f ? (plot.fitModel === 'linear' ? `slope=${f.slope.toFixed(4)}±${(f.slopeErr || 0).toFixed(4)}; int=${f.intercept.toFixed(4)}±${(f.interceptErr || 0).toFixed(4)}; R²=${f.r2.toFixed(3)}` : plot.fitModel === '4pl' ? `Top=${f.top.toFixed(3)}; Bottom=${f.bottom.toFixed(3)}; EC50=${f.ic50.toFixed(3)}; Hill=${f.hill.toFixed(3)}; R²=${f.r2.toFixed(3)}` : Object.entries(f.params || {}).map(([k, v]) => `${k}=${v.toFixed(4)}`).join('; ') + `; R²=${f.r2.toFixed(3)}`) : 'not enough points / missing numeric X'}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{f ? (f.se ?? 0).toFixed(3) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {paramKeys.length > 0 && paramData.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-700">Fitted Parameter Chart</label>
                      <select value={paramGraphVar} onChange={(e) => setParamGraphVar(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
                        {paramKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div style={{ height: Math.min(280, cfg.height), aspectRatio: String(cfg.aspect || 2) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={paramData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={Math.max(9, cfg.fontSize - 2)} />} />
                          <YAxis tick={{ fontSize: Math.max(9, cfg.fontSize - 2) }} label={{ value: paramGraphVar, angle: -90, position: 'insideLeft', fontSize: cfg.fontSize, fill: '#64748b' }} />
                          <Tooltip />
                          <Bar dataKey="val" isAnimationActive={false}>
                            {paramData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                            {HAS_EB && <ErrorBar dataKey="err" width={4} strokeWidth={1} color="#333" />}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {showErr && (
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={plot.useFixedSD} onChange={(e) => set({ useFixedSD: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Fixed SD ±
              </label>
              <input type="number" step="0.1" min="0" value={plot.fixedSDStr} onChange={(e) => set({ fixedSDStr: e.target.value })} disabled={!plot.useFixedSD} className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none ${plot.useFixedSD ? 'bg-white font-bold text-blue-700' : 'bg-slate-100 text-slate-400'}`} />
              <label className="text-xs font-bold text-slate-600">Outlier threshold (×SD):</label>
              <input type="number" step="0.1" min="0.1" value={plot.outlierThreshStr} onChange={(e) => set({ outlierThreshStr: e.target.value })} className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none" />
              <button type="button" onClick={() => cleanOutliers(null)} className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-black py-1.5 px-3 rounded-lg text-xs shadow-sm">🧹 Clean Outliers (all)</button>
              <button type="button" onClick={restoreExcluded} className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold py-1.5 px-3 rounded-md shadow-sm">↩️ Restore excluded</button>
            </div>
            {series.map((s) => (
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
                  {s.pts.length === 0 && <span className="text-xs text-slate-400 italic">No values for this atom.</span>}
                  {s.pts.map((p) => {
                    const sd = effSD(s.key, p);
                    return (
                      <div key={p.instId} className={`flex flex-col gap-1 p-1.5 rounded border ${p.excluded ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                        <span className="text-[9px] font-bold text-slate-500">{p.name}{p.x !== null ? ` (${xFieldLabel}=${p.x})` : ' (no numeric X)'}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-mono ${p.excluded ? 'line-through text-slate-400' : 'text-slate-700'}`}>{p.y}</span>
                          <input type="number" step="0.01" value={(plot.manualSD[s.key] || {})[p.instId] ?? ''} onChange={(e) => setManualSD(s.key, p.instId, e.target.value)} placeholder="±SD" className="w-14 text-[10px] border border-slate-300 rounded p-0.5 text-center outline-none focus:border-orange-500" />
                          <button type="button" onClick={() => toggleExclude(s.key, p.instId)} className={`text-[10px] font-black px-1 ${p.excluded ? 'text-red-600' : 'text-slate-400 hover:text-red-500'}`} title="Exclude / include point">{p.excluded ? 'EXCL' : '×'}</button>
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
        {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={series.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(cfg, s.key, i) }))} />}
      </div>
    </CollapsibleSection>
  );
};

const makePlotId = () => `cp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const defaultPlotCfg = (n) => ({
  id: makePlotId(), title: `Condition Plot ${n}`, layerKey: 'cs', atoms: [],
  xField: 'temperature', yField: '', chartType: 'line',
  fitEnabled: false, fitModel: 'linear', customExpr: '',
  showPoints: true, showErrors: true, showFit: true,
  useFixedSD: false, fixedSDStr: '', outlierThreshStr: '2.5',
  excludeNonComparable: false,
  hiddenSeries: {}, excluded: {}, manualSD: {}, usedInstances: {}, hLines: [], showMaxLines: false,
  style: { ...DEFAULT_CHART_STYLE }
});

// ================= PER ATOM CHART PANEL =================
// Configurable grouped bar chart: user picks a parameter layer + atoms → bars per residue
const PAP_COLORS = ['#3b82f6','#8b5cf6','#f59e0b','#22c55e','#ef4444','#0ea5e9','#ec4899','#14b8a6','#f97316','#6366f1'];
const makePapPresetId = () => `papPreset_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const PerAtomChartPanel = ({ ctx, d, chart, updateChart, removeChart }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [atomSearch, setAtomSearch] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [presetName, setPresetName] = useState('');
  const layerKey = chart.layerKey || 'cs';
  const atoms = chart.atoms || [];
  const cfg = { aspect: 2.5, fontSize: 11, ...(chart.style || {}) };
  const setC = (p) => updateChart(chart.id, p);
  const setCfg = (p) => updateChart(chart.id, { style: { ...cfg, ...p } });

  const layer = d.layers.find(l => l.key === layerKey) || d.layers[0];
  const valMap = layerKey === 'cs' ? (activeTest.chemicalShifts || {}) : (d.allLayerValues?.[layerKey] || {});

  // Presets — shared namespace with ConditionPlot presets
  const presets = Array.isArray(activeTest.atomSelectionPresets) ? activeTest.atomSelectionPresets : [];
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || atoms.length === 0) return;
    updateActiveTest({ atomSelectionPresets: [...presets, { id: makePapPresetId(), name, atoms: [...atoms] }] });
    setPresetName('');
  };
  const applyPreset = (id) => { const p = presets.find(x => x.id === id); if (p) setC({ atoms: [...(p.atoms || [])] }); };
  const deletePreset = (id) => updateActiveTest({ atomSelectionPresets: presets.filter(x => x.id !== id) });

  // Atom list — always in sequence order (index 0, 1, 2… as atoms appear in the sequence)
  const filtered = d.atomOptions.filter(o => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (k) => setC({ atoms: atoms.includes(k) ? atoms.filter(a => a !== k) : [...atoms, k] });
  const selectAllFiltered = () => setC({ atoms: Array.from(new Set([...atoms, ...filtered.map(o => o.key)])) });

  // atomMeta sorted by sequence order (d.atomOptions is already in sequence order)
  const atomMeta = d.atomOptions
    .filter(o => atoms.includes(o.key))
    .map((o, _i) => {
      const origIdx = atoms.indexOf(o.key);
      return {
        key: o.key,
        label: o.label.split(' ').slice(1).join(' ') || o.key.split('-').slice(1).join('-'),
        color: PAP_COLORS[origIdx % PAP_COLORS.length],
      };
    });

  // Build chart data — X axis in sequence order (sorted by residue index)
  const residueEntries = {};
  atoms.forEach(atomKey => {
    const val = parseManual(valMap[atomKey]);
    if (val === null) return;
    const resIdx = Number(atomKey.split('-')[0]);
    const res = d.estSeq[resIdx];
    if (!res) return;
    if (!residueEntries[resIdx]) residueEntries[resIdx] = { _idx: resIdx, label: res.id };
    residueEntries[resIdx][atomKey] = val;
  });
  // Sort by sequence index (always, regardless of selection order)
  const chartData = Object.values(residueEntries)
    .filter(r => Object.keys(r).length > 2) // has _idx + label + at least 1 value
    .sort((a, b) => a._idx - b._idx);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
      {/* Title + controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="text" value={chart.title || ''} onChange={e => setC({ title: e.target.value })}
          placeholder="Chart title…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 bg-transparent flex-1 min-w-[140px]" />
        <div className="flex gap-2 items-center">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
          <button onClick={() => removeChart(chart.id)} className="text-xs bg-red-50 border border-red-200 px-2 py-1 rounded font-bold text-red-600 hover:bg-red-100">🗑</button>
        </div>
      </div>

      {/* Layer picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase">Parameter:</span>
        {d.layers.map(l => (
          <button key={l.key} onClick={() => setC({ layerKey: l.key })}
            className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-colors ${l.key === layerKey ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {l.label}{l.unit ? ` (${l.unit})` : ''}
          </button>
        ))}
      </div>

      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} showHeightSlider={false} />}


      {/* Atom picker */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Atom(s) to plot ({atoms.length} selected)</span>
          <button type="button" onClick={selectAllFiltered} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded">☑ Select all (filtered)</button>
          {atoms.length > 0 && <button type="button" onClick={() => setC({ atoms: [] })} className="text-[10px] font-bold text-red-500 hover:text-red-700 underline">Clear</button>}
        </div>
        <input type="text" value={atomSearch} onChange={e => setAtomSearch(e.target.value)}
          placeholder="Search atom (e.g. Ala3 Hα)…" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
        <div className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto custom-scrollbar bg-white">
          {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 italic">No atoms — enter a sequence first.</div>}
          {filtered.map(o => (
            <label key={o.key} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0">
              <input type="checkbox" checked={atoms.includes(o.key)} onChange={() => toggleAtom(o.key)} className="w-3.5 h-3.5 accent-blue-600" />
              <span className="text-xs text-slate-700">{o.label}</span>
            </label>
          ))}
        </div>

        {/* Selected atoms as coloured pills (sequence order) */}
        {atomMeta.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {atomMeta.map(m => (
              <span key={m.key} style={{ backgroundColor: m.color }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white">
                {m.label}
                <button type="button" onClick={() => toggleAtom(m.key)} className="hover:text-red-200 font-black">×</button>
              </span>
            ))}
          </div>
        )}

        {/* Preset save/load */}
        <div className="flex flex-wrap gap-2 items-end pt-1 border-t border-slate-100">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Save selection as</label>
            <div className="flex gap-1">
              <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Selection name"
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-36 outline-none focus:border-blue-500 bg-white" />
              <button type="button" onClick={savePreset} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1.5 rounded-lg text-xs">💾 Save</button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Load saved selection</label>
            <select value="" onChange={e => { if (e.target.value) applyPreset(e.target.value); }}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
              <option value="">-- Select --</option>
              {presets.map(p => <option key={p.id} value={p.id}>{p.name} ({(p.atoms || []).length} atoms)</option>)}
            </select>
          </div>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <span key={p.id} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {p.name}
                <button type="button" onClick={() => deletePreset(p.id)} className="text-indigo-400 hover:text-red-600 font-black" title="Delete preset">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chart — X axis always in sequence order */}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: layer?.unit || '', angle: -90, position: 'insideLeft', style: { fontSize: cfg.fontSize } }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
            {atomMeta.map(m => <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          {atoms.length === 0 ? 'Select atoms above to plot.' : 'No data for selected atoms in this layer.'}
        </div>
      )}
    </div>
  );
};

// ================= PER ATOM PLOT SECTION =================
// Wraps SCS analysis (always shown) + user-configurable per-atom bar charts
export const PerAtomPlotSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const charts = Array.isArray(activeTest.perAtomCharts) ? activeTest.perAtomCharts : [];

  const addChart = () => {
    const n = charts.length + 1;
    const id = `pap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    updateActiveTest({ perAtomCharts: [...charts, { id, title: `Chart ${n}`, layerKey: 'cs', atoms: [], style: {} }] });
  };
  const updateChart = (id, patch) => updateActiveTest({
    perAtomCharts: charts.map(c => c.id === id ? { ...c, ...patch } : c)
  });
  const removeChart = (id) => updateActiveTest({ perAtomCharts: charts.filter(c => c.id !== id) });

  return (
    <div className="flex flex-col gap-4">
      {/* Secondary Shift Analysis — always at the top */}
      <CollapsibleSection title="Secondary Chemical Shift Analysis" icon="📊" defaultOpen={true}>
        <SecondaryShiftsSection ctx={ctx} />
      </CollapsibleSection>
      {/* Custom charts */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Custom Per-Atom Charts</span>
          <button onClick={addChart} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors">
            + Add Chart
          </button>
        </div>
        {charts.length === 0 && (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
            Click "+ Add Chart" to plot any parameter (Chemical Shift, T1, T2…) per residue with multiple atom bars.
          </div>
        )}
        {charts.map(chart => (
          <PerAtomChartPanel key={chart.id} ctx={ctx} d={d} chart={chart} updateChart={updateChart} removeChart={removeChart} />
        ))}
      </div>
    </div>
  );
};

// ================= FITTING SECTION =================
export const FittingSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const plots = Array.isArray(activeTest.conditionPlots) && activeTest.conditionPlots.length ? activeTest.conditionPlots : [defaultPlotCfg(1)];
  const updatePlot = (id, patch) => updateActiveTest({ conditionPlots: plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlot = () => updateActiveTest({ conditionPlots: [...plots, defaultPlotCfg(plots.length + 1)] });
  const removePlot = (id) => {
    if (plots.length <= 1) { alert('At least one condition plot is required.'); return; }
    updateActiveTest({ conditionPlots: plots.filter((p) => p.id !== id) });
  };
  const duplicatePlot = (p) => updateActiveTest({ conditionPlots: [...plots, { ...JSON.parse(JSON.stringify(p)), id: makePlotId(), title: `${p.title} (copy)` }] });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-bold text-slate-500 uppercase">Condition plots — X = Experimental Condition · zoomable · aspect ratio adjustable</span>
        <button type="button" onClick={addPlot} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">+ Add Condition Plot</button>
      </div>
      {plots.map((p) => (
        <ConditionPlotPanel key={p.id} ctx={ctx} d={d} plot={p} updatePlot={updatePlot} removePlot={removePlot} duplicatePlot={duplicatePlot} />
      ))}
    </div>
  );
};

// ================= CLASSIFICATION SECTION =================
export const ClassificationSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const testCategories = Array.isArray(ctx?.testCategories) ? ctx.testCategories : [];
  const operators = (Array.isArray(ctx?.operators) ? ctx.operators : []).map(opLabel).filter(Boolean);
  const classification = activeTest.classification || {};
  const set = (patch) => updateActiveTest({ classification: { ...classification, ...patch } });
  const selectedOperators = Array.isArray(classification.operators) ? classification.operators : [];
  const toggleOperator = (name) => {
    if (selectedOperators.includes(name)) set({ operators: selectedOperators.filter((o) => o !== name) });
    else set({ operators: [...selectedOperators, name] });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Experiment Type (from Definitions)</label>
          <select value={classification.experimentType || ''} onChange={(e) => set({ experimentType: e.target.value })}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="">-- Select --</option>
            {testCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Operator(s) (from Definitions)</label>
          <div className="flex flex-wrap gap-2">
            {operators.map((name) => (
              <label key={name} className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer ${selectedOperators.includes(name) ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-700'}`}>
                <input type="checkbox" checked={selectedOperators.includes(name)} onChange={() => toggleOperator(name)} className="accent-blue-600" />
                {name}
              </label>
            ))}
            {operators.length === 0 && <span className="text-xs text-amber-600">⚠️ No operators found. Add them in Definitions → Scientists/Operators.</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ================= SIMULATIONS SECTION =================
export const SimulationsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [showCfg, setShowCfg] = useState(false);
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });
  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);
  const simCfg = { fontSize: 11, h1D: 300, aspect2D: 1, simShowLabels: false, simLabelFormat: 'resNum_code_atom', simLabelDim: 'both', simLabelFontSize: 10, ...(activeTest.simChartCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ simChartCfg: { ...simCfg, ...patch } });
  if (d.parsedSeq.length === 0 && d.moleculeType !== 'organic') {
    return <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence / select a molecule (in Experiment Setup) to generate simulated spectra.</div>;
  }
  const fP = (arr) => {
    if (focusIdx === 'ALL' || !arr) return arr || [];
    const targetRes = d.parsedSeq[focusIdx];
    if (!targetRes) return arr;
    const resId = targetRes.id;
    return arr.filter((p) => {
      if (p.label && p.label.includes(resId)) return true;
      if (p.type && typeof p.type === 'string' && p.type.includes(resId)) return true;
      if (p.keys && p.keys.some((k) => String(k).split('-')[0] === String(focusIdx))) return true;
      return false;
    }).sort((a, b) => a.x - b.x);
  };
  const filteredRanges1H = focusIdx === 'ALL'
    ? d.ranges.ranges1H
    : d.ranges.ranges1H.filter(r => r.res === (d.parsedSeq[focusIdx]?.code3 || d.parsedSeq[focusIdx]?.char)).map(r => ({ ...r, y: 0 }));
  const filteredRanges13C = focusIdx === 'ALL'
    ? d.ranges.ranges13C
    : d.ranges.ranges13C.filter(r => r.res === (d.parsedSeq[focusIdx]?.code3 || d.parsedSeq[focusIdx]?.char)).map(r => ({ ...r, y: 0 }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2 w-fit">
        <button type="button" onClick={() => setShowCfg(!showCfg)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>⚙️ Chart Parameters</button>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer ml-1 border-l border-slate-200 pl-3">
          <input type="checkbox" checked={simCfg.simShowLabels} onChange={(e) => setCfg({ simShowLabels: e.target.checked })} className="accent-blue-600 w-4 h-4" />
          Show Peak Labels
        </label>
        <span className="text-[10px] text-slate-400 ml-2">13C axis: 0–220 ppm · 2D spectra: square (aspect {simCfg.aspect2D}) · HSQC side by side</span>
      </div>
      {showCfg && (
        <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">Font size (ticks & axis labels): {simCfg.fontSize}</label>
            <input type="range" min="8" max="18" step="1" value={simCfg.fontSize} onChange={(e) => setCfg({ fontSize: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">1D spectra height (px): {simCfg.h1D}</label>
            <input type="range" min="200" max="600" step="20" value={simCfg.h1D} onChange={(e) => setCfg({ h1D: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">2D aspect ratio (H/W): {simCfg.aspect2D} (1 = square)</label>
            <div className="flex gap-2">
              <input type="range" min="0.5" max="1.5" step="0.05" value={simCfg.aspect2D} onChange={(e) => setCfg({ aspect2D: parseFloat(e.target.value) })} className="accent-blue-600 mt-2 flex-1" />
              <button type="button" onClick={() => setCfg({ aspect2D: 1 })} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded shrink-0">⬛ Square</button>
            </div>
          </div>
          {simCfg.simShowLabels && (
            <div className="flex flex-col gap-3 md:col-span-3 pt-4 border-t border-slate-100 mt-2">
              <h5 className="text-xs font-bold text-slate-600 uppercase">Label Format Options</h5>
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500">Label Format</label>
                  <select value={simCfg.simLabelFormat} onChange={(e) => setCfg({ simLabelFormat: e.target.value })} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs outline-none bg-white font-semibold">
                    <option value="resNum">Residue Number Only (e.g. 1)</option>
                    <option value="resNum_code">Residue Number + Code (e.g. 1A)</option>
                    <option value="resNum_code_atom">Res Num + Code + Atom (e.g. 1A Hα)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500">Label Dimension (2D Spectra)</label>
                  <select value={simCfg.simLabelDim} onChange={(e) => setCfg({ simLabelDim: e.target.value })} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs outline-none bg-white font-semibold">
                    <option value="direct">Direct Dimension Only (F2)</option>
                    <option value="indirect">Indirect Dimension Only (F1)</option>
                    <option value="both">Both Dimensions</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500">Peak Label Font Size: {simCfg.simLabelFontSize}</label>
                  <input type="range" min="6" max="24" step="1" value={simCfg.simLabelFontSize} onChange={(e) => setCfg({ simLabelFontSize: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-1" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {selectedKeys && (
        <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 w-fit">🎯 Highlighting: {selectionLabel(d, selectedKeys)}</span>
      )}
      <div className="text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-fit">
        Spectra are simulated from the <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span> instance's Chemical Shift layer.
      </div>
      {d.moleculeType !== 'organic' && (
        <div className="grid grid-cols-1 gap-4">
          <RangeBarChart title="Theoretical ¹H Ranges" ranges={filteredRanges1H} domain={[0, 11]} ticks={Array.from({ length: 12 }, (_, i) => i)} xAxisLabel="¹H (ppm)" rowCount={focusIdx === 'ALL' ? d.uniqueTypes.length : 1} rowLabels={focusIdx === 'ALL' ? d.uniqueTypes.map((c) => d.DB[c]?.code3 || c) : [d.parsedSeq[focusIdx]?.code3 || d.parsedSeq[focusIdx]?.char]} />
          <RangeBarChart title="Theoretical ¹³C Ranges" ranges={filteredRanges13C} domain={[0, 220]} ticks={Array.from({ length: 23 }, (_, i) => i * 10)} xAxisLabel="¹³C (ppm)" rowCount={focusIdx === 'ALL' ? d.uniqueTypes.length : 1} rowLabels={focusIdx === 'ALL' ? d.uniqueTypes.map((c) => d.DB[c]?.code3 || c) : [d.parsedSeq[focusIdx]?.code3 || d.parsedSeq[focusIdx]?.char]} />
        </div>
      )}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
   <OneDSpectrumPlot key={`1d1h-${focusIdx}`} title="Simulated ¹H 1D Spectrum" data={fP(d.peaks.data1H).filter(p => p.atom1 && p.atom1.startsWith('H'))} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} simCfg={simCfg} />
   <OneDSpectrumPlot key={`1d13c-${focusIdx}`} title="Simulated ¹³C 1D Spectrum" data={fP(d.peaks.data13C).filter(p => p.atom2 && p.atom2.startsWith('C'))} fullDomain={[0, 220]} ticks={TICKS_13C} TickComponent={CustomXTick13C} xLabel="¹³C (ppm)" panelId="1D_13C" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} simCfg={simCfg} />
   {d.hasPhosphorus && d.selNuc.includes('P') && fP(d.peaks.p31Data).length > 0 && (
     <OneDSpectrumPlot key={`1dp31-${focusIdx}`} title="Simulated ³¹P 1D Spectrum" data={fP(d.peaks.p31Data)} fullDomain={[-5, 5]} ticks={Array.from({ length: 11 }, (_, i) => i - 5)} TickComponent={CustomXTick1H} xLabel="³¹P (ppm)" panelId="1D_31P" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} simCfg={simCfg} />
   )}
   <SpectrumPlot key={`cosy-${focusIdx}`} title="Simulated COSY Spectrum" diagonalData={fP(d.peaks.diagonalData).filter(p => p.atom1 && p.atom1.startsWith('H'))} crossPeakData={fP(d.peaks.cosyPeaks).filter(p => p.atom1 && p.atom1.startsWith('H') && p.atom2 && p.atom2.startsWith('H'))} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="cosy" diagonalColor="#22c55e" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} simCfg={simCfg} />
   <SpectrumPlot key={`noesy-${focusIdx}`} title="Simulated NOESY Spectrum" diagonalData={fP(d.peaks.diagonalData).filter(p => p.atom1 && p.atom1.startsWith('H'))} crossPeakData={fP(d.peaks.noesyPeaks).filter(p => p.atom1 && p.atom1.startsWith('H') && p.atom2 && p.atom2.startsWith('H'))} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="noesy" diagonalColor="#ef4444" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} simCfg={simCfg} />
   <SpectrumPlot key={`tocsy-${focusIdx}`} title="Simulated TOCSY Spectrum" diagonalData={fP(d.peaks.diagonalData).filter(p => p.atom1 && p.atom1.startsWith('H'))} crossPeakData={fP(d.peaks.tocsyPeaks).filter(p => p.atom1 && p.atom1.startsWith('H') && p.atom2 && p.atom2.startsWith('H'))} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="tocsy" diagonalColor="#1e3a8a" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} simCfg={simCfg} />
 </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HSQCPlot key={`hsqc-${focusIdx}`} title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={fP(d.peaks.hsqcPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc" selectedKeys={selectedKeys} manualKeys={manualKeys} yAxisLabel="¹³C F1 (ppm)" yDomainInit={[0, 220]} yTicks={TICKS_13C} aspect={simCfg.aspect2D} fs={simCfg.fontSize} simCfg={simCfg} />
        {d.moleculeType === 'protein' && d.selNuc.includes('N') && fP(d.peaks.hsqc15NPeaks).length > 0 && (
          <HSQCPlot key={`hsqc15n-${focusIdx}`} title="Simulated ¹H-¹⁵N HSQC Spectrum" crossPeakData={fP(d.peaks.hsqc15NPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc15n" selectedKeys={selectedKeys} manualKeys={manualKeys} yAxisLabel="¹⁵N F1 (ppm)" yDomainInit={[95, 135]} yTicks={TICKS_15N} aspect={simCfg.aspect2D} fs={simCfg.fontSize} simCfg={simCfg} />
        )}
      </div>
    </div>
  );
};

// ================= ALL =================
// ================= ALL =================
export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <CollapsibleSection title="Molecular structure and visualization" icon="🧬" defaultOpen={false}><MolecularStructureSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Experiment Setup" icon="⚙️" defaultOpen={false}><ExperimentSetupSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Data" icon="🔢" defaultOpen={false}><DataSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Data Analysis" icon="📉" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        <CollapsibleSection title="Per Atom Plot" icon="📊" defaultOpen={false}>
          <PerAtomPlotSection ctx={ctx} />
        </CollapsibleSection>
        <CollapsibleSection title="Fitting" icon="📐" defaultOpen={false}>
          <FittingSection ctx={ctx} />
        </CollapsibleSection>
      </div>
    </CollapsibleSection>
    <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}><SimulationsSection ctx={ctx} /></CollapsibleSection>
  </div>
);

// ================= EXPORTS (single occurrence - no duplicates) =================
export const MolecularStructure = MolecularStructureSection;
export const Setup = ExperimentSetupSection;
export const Data = DataSection;
export const Fitting = FittingSection;
export const Simulations = SimulationsSection;
export const SecondaryShifts = SecondaryShiftsSection;
export const PerAtomPlot = PerAtomPlotSection;

// Building blocks reused by the Lab Notebook to re-render simulated spectra
export { OneDSpectrumPlot, SpectrumPlot, HSQCPlot, useNmrDerived };
export { CustomXTick1H, CustomYTick1H, CustomXTick13C, CustomYTick13C };
export { TICKS_1H, TICKS_13C, TICKS_15N };


// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  if (checkId === 'cond') {
    const expStr = d.fields
      .map((f) => { const v = getExpValue(d.activeInstance, f.key); return v !== '' ? `${f.label}: ${v}` : ''; })
      .filter(Boolean).join(' | ');
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Condition:</b> ${d.activeInstance ? d.activeInstance.name : 'N/A'} | ${expStr || 'No experimental condition values set'}</p>`;
  }
  if (checkId === 'seq') {
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>${d.typeLabel}:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${d.isPolymer ? activeTest.proteinSequence || 'N/A' : d.parsedSeq[0]?.name || 'N/A'}</span></p>`;
  }
  if (checkId === 'formula' && d.structure) {
    return `<div style="margin-bottom: 12px;">${elementsToSVG(d.structure, 300)}</div>`;
  }
  if (checkId === 'table' && Object.keys(d.shifts).length > 0) {
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
    Object.keys(d.shifts).forEach((key) => {
      const parts = key.split('-');
      const resIdx = parts[0];
      const atom = parts.slice(1).join('-');
      const res = d.parsedSeq[resIdx];
      if (res && d.shifts[key]) {
        html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${d.shifts[key]}</td></tr>`;
      }
    });
    html += `</table>`;
    return html;
  }
  if (checkId === 'images' && d.images.length > 0) {
    let html = `<div style="margin-top: 15px;"><h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;
    d.images.forEach((imgSrc, idx) => {
      const cands = normalizeImageCandidates(imgSrc);
      html += `<div style="margin-bottom: 10px;"><img src="${cands[0]}" alt="Spectrum ${idx + 1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;"/><p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx + 1}</p></div>`;
    });
    html += `</div>`;
    return html;
  }
  return '';
};
