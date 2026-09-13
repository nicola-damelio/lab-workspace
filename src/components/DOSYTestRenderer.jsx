/* =========================================================================
   DOSYTestRenderer.jsx — test page "DOSY".

   Structure:
     • General (TestShellRenderer) — primary classification "Molecular
       Structure and Dynamics", secondary "Diffusion by DOSY".
     • Instrumental Setup — NMR instrument + DOSY gradient parameters
       (max gradient G, diffusion time Δ, small delta δ) + DOSY dataset fields.
     • Data              — gradient % (0–100) vs intensity grids, paste from
       Excel. The table is rendered DIRECTLY inside the Data subsection.
     • Data Analysis     — Stejskal-Tanner plot (with Error Management and
       Graphical Parameters buttons) + the per-gradient-set results tables,
       rendered DIRECTLY inside the Data Analysis subsection.
     • Simulations       — diffusion coefficient (Stokes–Einstein).
   ========================================================================= */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import TestShellRenderer from './TestShellRenderer';
import {
  DOSY_TAB_CONFIG } from './tabConfigs';
import { NMRInstrumentalSetup } from './NMRInstrumentalSetup';
import { makeTable, stokesEinsteinD, radiusFromMW, GAMMA_H } from './NMRFittingsTestRenderer';
import { enableCellClipboard, cellAttrs } from '../utils/cellClipboard';
import { ChartPanel, SharedErrorTreatment, SharedChartStylePanel, ChartJsInspector, cfgTickFormatter } from './SharedAnalysisTools';
import { shadesFromColor, chartJsPadding, chartJsHeightFit, chartJsTitlePad, chartJsSeriesStyle, tickSize, chartJsFont, chartJsTitleFont, axisTitleSize, chartAspect, chartAspectImposed, DEFAULT_CHART_ASPECT_WIDE, tickColorProps, axisTitleColorProps
} from '../utils/chartStyle';
import { brokenAxisScaleOptions, chartJsYValues } from '../utils/chartJsBrokenAxis';
import { StarToggle } from './StarToggle';
import { isStarred, toggleStarredItem } from '../utils/starredItems';
import { isPointExcluded, togglePointExcluded, clearExcludedForTable, computePointSD } from '../utils/pointTreatment';
import { errBarPlugin } from '../data/constants';

enableCellClipboard(); // global multi-cell select / copy / paste for data tables

// Stejskal-Tanner: I = I0·exp(−b·D) with b = (γ·δ·G)²·(Δ−δ/3).
// The data table stores the gradient as a percentage (0–100) of the maximum
// gradient G_max (G/cm) entered in Instrumental Setup (1 G/cm = 0.01 T/m).
const computeB = (gPct, maxG_Gcm, deltaS, bigDeltaS, gamma = GAMMA_H) => {
  // Empty / non-numeric gradient → NaN (row is skipped by the fit filters).
  if (gPct === '' || gPct === undefined || gPct === null || String(gPct).trim() === '') return NaN;
  const g = Number(gPct);
  if (!Number.isFinite(g) || g < 0) return NaN;
  if (g === 0) return 0; // 0% gradient → b = 0, a valid I₀ point for the fit
  const G_Tm = (Number(maxG_Gcm) || 60) * 0.01 * (g / 100);
  const d = Number(deltaS) || 0.002;      // small delta (gradient duration), s
  const D = Number(bigDeltaS) || 0.05;    // diffusion time Δ, s
  const gyro = Number(gamma) > 0 ? Number(gamma) : GAMMA_H;
  const b = Math.pow(gyro * d * G_Tm, 2) * (D - d / 3);
  return b > 0 ? b : 0;
};

// Linear regression of ln(I) vs b → D = −slope (m²/s).
const linearFitOn = (xs, lns) => {
  const n = xs.length;
  const sx = xs.reduce((s, v) => s + v, 0);
  const sl = lns.reduce((s, v) => s + v, 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const sxl = xs.reduce((s, v, i) => s + v * lns[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxl - sx * sl) / denom;
  const intercept = (sl - slope * sx) / n;
  return { D: -slope, I0: Math.exp(intercept), slope, intercept };
};

// Stejskal-Tanner fit WITH an optimized vertical baseline offset C (as in the
// standalone fitter): I = I0·exp(−b·D) + C. C is found by coarse + fine grid
// search so that ln(I − C) vs b is as linear as possible; R² is reported in
// linear (intensity) space.
const fitStejskalTannerWithC = (bvals, ys) => {
  const pts = bvals
    .map((x, i) => ({ x: Number(x), y: Number(ys[i]) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y > 0);
  if (pts.length < 2) return null;

  const sseFor = (C) => {
    const lns = pts.map((p) => Math.log(Math.max(p.y - C, 1e-12)));
    const f = linearFitOn(pts.map((p) => p.x), lns);
    if (!f) return Infinity;
    let sse = 0;
    for (let i = 0; i < pts.length; i++) {
      const Icalc = f.I0 * Math.exp(-f.D * pts[i].x) + C;
      sse += (pts[i].y - Icalc) ** 2;
    }
    return sse;
  };

  const minI = Math.min(...pts.map((p) => p.y));
  const maxI = Math.max(...pts.map((p) => p.y));
  const startC = -maxI;
  const endC = minI - 1e-4;
  if (endC <= startC) {
    // Degenerate: fall back to a C = 0 fit.
    const f0 = linearFitOn(pts.map((p) => p.x), pts.map((p) => Math.log(Math.max(p.y, 1e-12))));
    return f0 ? { ...f0, C: 0, r2: 1, n: pts.length, total: pts.length } : null;
  }

  let bestC = 0, bestSSE = Infinity;
  const coarseSteps = 1000;
  const coarseStep = (endC - startC) / coarseSteps;
  for (let i = 0; i <= coarseSteps; i++) {
    const C = startC + i * coarseStep;
    const sse = sseFor(C);
    if (sse < bestSSE) { bestSSE = sse; bestC = C; }
  }
  const fineStart = Math.max(startC, bestC - coarseStep * 2);
  const fineEnd = Math.min(endC, bestC + coarseStep * 2);
  const fineStep = (fineEnd - fineStart) / 1000;
  if (fineStep > 0) {
    for (let i = 0; i <= 1000; i++) {
      const C = fineStart + i * fineStep;
      const sse = sseFor(C);
      if (sse < bestSSE) { bestSSE = sse; bestC = C; }
    }
  }

  const lns = pts.map((p) => Math.log(Math.max(p.y - bestC, 1e-12)));
  const f = linearFitOn(pts.map((p) => p.x), lns);
  if (!f) return null;
  const meanI = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sst = pts.reduce((s, p) => s + (p.y - meanI) ** 2, 0);
  const r2 = sst > 0 ? 1 - bestSSE / sst : 1;
  return { D: f.D, I0: f.I0, C: bestC, r2, n: pts.length, total: pts.length };
};

// Outlier-aware fit — honours the "Outlier Threshold" of the Error Management
// panel: points whose residual is > threshold × SD are dropped and the fit is
// recomputed (up to 6 passes). Residuals are evaluated in INTENSITY space
// against the C-optimized model I = I0·exp(−b·D) + C. The dropped indices are
// returned in `excluded`.
const fitStejskalTannerRobust = (bvals, ys, outlierThresh) => {
  const thresh = Number(outlierThresh) > 0 ? Number(outlierThresh) : 2;
  const pts = bvals
    .map((x, i) => ({ x: Number(x), y: Number(ys[i]), idx: i }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y > 0);
  if (pts.length < 2) return null;
  let excluded = [];
  let fit = null;
  for (let iter = 0; iter < 6; iter++) {
    const kept = pts.filter((p) => !excluded.includes(p.idx));
    if (kept.length < 2) break;
    fit = fitStejskalTannerWithC(kept.map((p) => p.x), kept.map((p) => p.y));
    if (!fit) break;
    const residuals = kept.map((p) => {
      const Icalc = fit.I0 * Math.exp(-fit.D * p.x) + fit.C;
      return Math.abs(p.y - Icalc);
    });
    const sd = residuals.length > 1
      ? Math.sqrt(residuals.reduce((s, v) => s + v * v, 0) / (residuals.length - 1))
      : 0;
    const worst = residuals.reduce((best, v, i) => (v > residuals[best] ? i : best), 0);
    if (sd > 0 && residuals[worst] / sd > thresh && kept.length > 2) {
      excluded.push(kept[worst].idx);
    } else break;
  }
  return fit ? { ...fit, excluded, total: pts.length } : null;
};

/* ---- STABLE SECTION WRAPPERS (module-level, like NMR Fittings) ---- */
const dosySections = {
  renderData: null,       // (t, tIndex) => ReactNode
  renderAnalysis: null,   // (t, tIndex) => ReactNode
  addTable: null,         // () => void
  recomputeAll: null,     // () => void
  tables: [],             // live tables (bridged from the component so Data Analysis reads the same data as Data)
  sim: {},
  setSim: null,
  solvents: [],
  params: { maxG: 60, deltaMs: 2, bigDeltaMs: 50 }, // read-only values shown in Data Analysis
};

const DEFAULT_CFG = {
  title: '',
  xAxisLabel: 'b (s/mm²)',
  yAxisLabel: 'ln(I)',
  fontSize: 12,
  ptStyle: 'circle',
  ptSize: 4,
  lineStyle: 'solid',
  lineThickness: 2,
  yMin: '', yMax: '', xMin: '', xMax: '',
  baseColor: null,
  colors: {}
};

// Parse pasted text into DOSY rows: first column = gradient % (0–100),
// following columns = intensities. Accepts tab, space, semicolon or comma
// separators, skips empty lines and a non-numeric header line.
const parseDosyText = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  // Detect the separator from the first data-like line.
  let sep = null;
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;
    if (l.includes('\t')) sep = '\t';
    else if (l.includes(';')) sep = ';';
    else if (l.includes(',')) sep = ',';
    break;
  }
  const rows = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('//')) continue;
    const parts = sep ? l.split(sep) : l.split(/\s+/);
    const tokens = parts.map((p) => p.trim()).filter((p) => p !== '');
    if (!tokens.length) continue;
    const parsed = tokens.map((tok) => {
      const norm = sep !== ',' ? tok.replace(/,/g, '.') : tok; // European decimals
      const v = parseFloat(norm);
      return Number.isFinite(v) ? v : NaN;
    });
    if (parsed.every((v) => Number.isNaN(v))) continue; // header line
    if (parsed.length < 2) continue; // need at least gradient % + 1 intensity
    rows.push(parsed.map((v) => (Number.isNaN(v) ? '' : v)));
  }
  if (!rows.length) {
    return { rows: [], error: 'No numeric data found — paste rows with a gradient % and at least one intensity value.' };
  }
  return { rows, error: null };
};

// Modal for the DOSY Data section: paste text, preview it, then import it into
// a new gradient set or overwrite an existing one.
const DOSYImportModal = ({ open, onClose, onImport, tables }) => {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('new');
  if (!open) return null;
  const preview = parseDosyText(text);
  const nIntensity = preview.rows.length
    ? Math.max(1, Math.max(...preview.rows.map((r) => r.length - 1)))
    : 0;
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black text-slate-800 mb-1">📋 Import DOSY data from text</h3>
        <p className="text-[10px] text-slate-500 mb-3">
          First column = <b>gradient %</b> (0–100), second (and following) columns = <b>intensities</b>.
          Tab / space / semicolon / comma separated — paste straight from Excel.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          spellCheck={false}
          placeholder={'0\t100\n5\t98.5\n10\t95\n20\t88\n40\t72\n60\t55\n80\t40\n100\t30'}
          className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-blue-500 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Import into:</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
            <option value="new">New gradient set</option>
            {(Array.isArray(tables) ? tables : []).map((t, i) => (
              <option key={t.id} value={t.id}>Overwrite gradient set {i + 1}</option>
            ))}
          </select>
        </div>
        <div className="text-[10px] mt-2">
          {preview.error ? (
            <span className="text-red-500 font-bold">{preview.error}</span>
          ) : preview.rows.length ? (
            <span className="text-emerald-600 font-bold">
              ✓ {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} · {nIntensity} intensity column{nIntensity === 1 ? '' : 's'} ready to import
            </span>
          ) : (
            <span className="text-slate-400">Paste the data above to see a preview.</span>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
          <button
            disabled={!!preview.error || !preview.rows.length}
            onClick={() => onImport(preview.rows, target)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

// Data — the gradient %/intensity tables rendered DIRECTLY in the subsection
// (no extra collapsible around each gradient set).
const DOSYDataSection = ({ ctx }) => {
  const tables = Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : [];
  return (
    <div className="flex flex-col gap-5">
      {tables.length === 0 && (
        <p className="text-xs italic text-slate-400 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">
          No gradient sets yet — click “+ Add gradient set”.
        </p>
      )}
      {tables.map((t, i) => (
        <div key={t.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Gradient set {i + 1}</h4>
          </div>
          {dosySections.renderData ? dosySections.renderData(t, i) : null}
        </div>
      ))}
      {dosySections.addTable && (
        <div className="flex flex-wrap gap-2">
          <button onClick={dosySections.addTable} className="self-start text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">+ Add gradient set</button>
          {dosySections.openImport && (
            <button onClick={dosySections.openImport}
                    className="self-start text-sm bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-md shadow-sm"
                    title="Paste text with gradient % in the first column and intensities in the following columns">
              📋 Import from text
            </button>
          )}
        </div>
      )}
    </div>
  );
};


// Stejskal-Tanner decay plot built DIRECTLY from the data table (gradient % vs
// intensity) and the read-only gradient parameters of Instrumental Setup.
// Applied style comes from the Graphical Parameters panel (dosyChartCfg) and
// excluded/outlier points (Error Management) are drawn hollow.
const DOSYFitChart = ({ tables, params, cfg = {}, showExcl = true, outlierThresh = '2.0', showFit = true, mode = 'b', gamma = GAMMA_H, useAll = true, errMode = 'none', fixedSD = '', manualSD = {}, excluded = {}, update = null, setCfg = null, series = [], unit = null }) => {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const { maxG, deltaMs, bigDeltaMs } = params || {};
  const thresh = Number(outlierThresh) > 0 ? Number(outlierThresh) : 2;
  const xMode = mode === 'percent' ? 'percent' : mode === 'g' ? 'g' : 'b';
  // Y-axis title for the applied mode. Kept at component scope because the
  // canvas sizing box (chartJsHeightFit) is rendered outside the effect.
  const yTitle = xMode === 'percent'
    ? (cfg.yAxisLabel || 'Intensity (I)')
    : (cfg.yAxisLabel || 'ln(I)');

  const anyPoint = (Array.isArray(tables) ? tables : []).some((t) => {
    for (let c = 0; c < (t.nCols || 0); c++) {
      for (let r = 0; r < t.nRows; r++) {
        const b = computeB(t.delays[r], maxG, deltaMs / 1000, bigDeltaMs / 1000, gamma);
        const y = parseFloat(t.grid?.[r]?.[c]);
        if (b >= 0 && Number.isFinite(y) && y > 0) return true;
      }
    }
    return false;
  });

  useEffect(() => {
    if (!ref.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const datasets = [];
    const fs = Number(tickSize(cfg, 11)) || 11;
    // b-value for a given gradient strength G (G/cm): b = (γ·δ·G_Tm)²·(Δ−δ/3)
    const dS = (Number(deltaMs) || 2) / 1000;      // small delta δ, s
    const DS = (Number(bigDeltaMs) || 50) / 1000;  // diffusion time Δ, s
    const bFromG = (gGcm) => {
      const gTm = gGcm * 0.01;                      // 1 G/cm = 0.01 T/m
      return Math.pow((Number(gamma) > 0 ? Number(gamma) : GAMMA_H) * dS * gTm, 2) * (DS - dS / 3);
    };
    (Array.isArray(tables) ? tables : []).forEach((t, ti) => {
      const nCols = t.nCols || 0;
      const tableId = t.id;
      // Replicate intensity values per row (across columns) for the "SD" error-bar mode.
      const rowVals = [];
      for (let r = 0; r < t.nRows; r++) {
        const vals = [];
        for (let cc = 0; cc < nCols; cc++) {
          const v = parseFloat(t.grid?.[r]?.[cc]);
          if (Number.isFinite(v) && v > 0) vals.push(v);
        }
        rowVals.push(vals);
      }
      for (let c = 0; c < nCols; c++) {
        const label = (t.colResidues && t.colResidues[c]) || `Col ${c + 1}`;
        const rows = [];
        for (let r = 0; r < t.nRows; r++) {
          const b = computeB(t.delays[r], maxG, deltaMs / 1000, bigDeltaMs / 1000, gamma);
          const y = parseFloat(t.grid?.[r]?.[c]);
          if (b >= 0 && Number.isFinite(y) && y > 0) rows.push({ b, y, g: Number(t.delays[r]) || 0, r, key: `${c}:${r}` });
        }
        if (rows.length < 2) continue;
        const key = `col${ti}_${c}`;
        const color = (cfg.colors && cfg.colors[key]) || (cfg.baseColor ? shadesFromColor(cfg.baseColor, 8)[c % 8] : `hsl(${((ti * nCols + c) * 57) % 360}, 80%, 50%)`);

        // Manually excluded points (clicked on the chart or ticked in the table)
        const manualKeys = new Set(rows.filter((p) => isPointExcluded(excluded, tableId, p.key)).map((p) => p.key));
        const fitRows = rows.filter((p) => !manualKeys.has(p.key));
        const bvals = fitRows.map((p) => p.b);
        const ys = fitRows.map((p) => p.y);
        const fit = bvals.length >= 2
          ? (useAll ? fitStejskalTannerWithC(bvals, ys) : fitStejskalTannerRobust(bvals, ys, thresh))
          : null;
        const robustIdx = new Set(fit ? fit.excluded : []);
        const posInFit = new Map(fitRows.map((p, i) => [p.key, i]));

        const xOf = (p) => (xMode === 'percent' ? p.g : xMode === 'g' ? (Number(maxG) || 60) * (p.g / 100) : p.b);
        const yOf = (p) => (xMode === 'percent' ? p.y : Math.log(Math.max(p.y, 1e-12)));

        const errBars = [];
        rows.forEach((p) => {
          p.ex = manualKeys.has(p.key) || robustIdx.has(posInFit.get(p.key));
          let predicted = 0;
          if (fit) {
            if (xMode === 'percent') predicted = fit.I0 * Math.exp(-fit.D * p.b) + (fit.C || 0);
            else predicted = Math.log(Math.max(fit.I0 * Math.exp(-fit.D * p.b) + (fit.C || 0), 1e-12));
          }
          const sd = computePointSD({
            mode: errMode,
            fixedSD,
            rowValues: rowVals[p.r] || [],
            manualSD: manualSD && manualSD[tableId] && manualSD[tableId][p.key],
            y: yOf(p),
            predicted
          });
          errBars.push({ plus: sd, minus: sd });
        });

        datasets.push({
          label,
          data: rows.map((p) => ({ x: xOf(p), y: yOf(p) })),
          errorBars: errBars,
          showLine: false,
          pointStyle: cfg.pointStyle || cfg.ptStyle || 'circle',
          pointRadius: Number(cfg.ptSize) || 4,
          backgroundColor: color,
          borderColor: color,
          pointBackgroundColor: rows.map((p) => (showExcl && p.ex ? '#ffffff' : color)),
          pointBorderColor: rows.map((p) => (showExcl && p.ex ? '#ef4444' : color)),
          pointBorderWidth: rows.map((p) => (showExcl && p.ex ? 2 : 1)),
          _pointKeys: rows.map((p) => p.key),
          _tableId: tableId,
          // Per-curve overrides of the style panel (symbol, size, colour,
          // line style / width, show-hide) for THIS column.
          ...chartJsSeriesStyle(cfg, key, {
            color,
            pointStyle: cfg.pointStyle || cfg.ptStyle || 'circle',
            pointRadius: Number(cfg.ptSize) || 4
          }),
          onClick: (event, elements) => {
            if (!elements || !elements.length || !update) return;
            const el = elements[0];
            const ds = el.dataset;
            const k = ds && ds._pointKeys && ds._pointKeys[el.index];
            if (k && ds._tableId) update({ dosyExcluded: togglePointExcluded(excluded, ds._tableId, k) });
          }
        });

        if (fit && showFit) {
          const xs = fitRows.map((p) => xOf(p));
          const xmin = Math.min(...xs), xmax = Math.max(...xs);
          const steps = xMode === 'percent' || xMode === 'g' ? 80 : 60;
          const curve = [];
          for (let i = 0; i <= steps; i++) {
            const x = xmin + ((xmax - xmin) * i) / steps;
            const b = xMode === 'g'
              ? bFromG(x)
              : xMode === 'percent'
                ? computeB(x, maxG, deltaMs / 1000, bigDeltaMs / 1000, gamma)
                : x;
            if (xMode === 'percent') {
              curve.push({ x, y: fit.I0 * Math.exp(-fit.D * b) + (fit.C || 0) });
            } else {
              const model = fit.I0 * Math.exp(-fit.D * b) + (fit.C || 0);
              curve.push({ x, y: Math.log(Math.max(model, 1e-12)) });
            }
          }
          datasets.push({
            label: `${label} fit (D=${fit.D.toExponential(2)} m²/s)`,
            data: curve, showLine: true, pointRadius: 0,
            borderColor: color,
            borderWidth: Number(cfg.lineThickness) || 2,
            borderDash: cfg.lineStyle === 'dashed' ? [6, 4] : cfg.lineStyle === 'dotted' ? [2, 4] : [],
            type: 'line', fill: false,
            ...chartJsSeriesStyle(cfg, key, {
              color,
              borderWidth: Number(cfg.lineThickness) || 2,
              borderDash: cfg.lineStyle === 'dashed' ? [6, 4] : cfg.lineStyle === 'dotted' ? [2, 4] : []
            })
          });
        }
      }
    });

    const xTitle = xMode === 'percent'
      ? (cfg.xAxisLabel || 'Gradient % (0–100)')
      : xMode === 'g'
        ? (cfg.xAxisLabel || `Gradient strength G (G/cm) — Gmax = ${maxG} G/cm`)
        : (cfg.xAxisLabel || `b (s/mm²) — Gmax = ${maxG} G/cm · Δ = ${bigDeltaMs} ms · δ = ${deltaMs} ms`);

    chartRef.current = new Chart(ref.current, {
      type: 'scatter',
      data: { datasets },
      plugins: [errBarPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        // Canvas padding derived from the character size: the axis titles stay
        // inside the canvas however large the labels are made.
        layout: { padding: chartJsPadding(cfg) },
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: xTitle, font: chartJsTitleFont(cfg, { size: axisTitleSize(cfg, fs) }, 'x'), padding: chartJsTitlePad(cfg).x, ...axisTitleColorProps(cfg) },
            ticks: {
              font: chartJsFont(cfg, { size: (Number(tickSize(cfg, fs)) || fs) - 1 }), ...tickColorProps(cfg),
              callback: (v) => { const f = cfgTickFormatter(cfg, 'x'); return f ? f(v) : undefined; }
            },
            min: cfg.xMin !== '' && cfg.xMin !== undefined && cfg.xMin !== null ? Number(cfg.xMin) : undefined,
            max: cfg.xMax !== '' && cfg.xMax !== undefined && cfg.xMax !== null ? Number(cfg.xMax) : undefined
          },
          y: {
            // ✂ "Interrupt Y axis" of the 🎨 panel: one residue's decay /
            // diffusion can dwarf the others of the same plot.
            ...brokenAxisScaleOptions(cfg, 'y', chartJsYValues(datasets)),
            title: { display: true, text: yTitle, font: chartJsTitleFont(cfg, { size: axisTitleSize(cfg, fs) }, 'y'), padding: chartJsTitlePad(cfg).y, ...axisTitleColorProps(cfg) },
            ticks: {
              font: chartJsFont(cfg, { size: (Number(tickSize(cfg, fs)) || fs) - 1 }), ...tickColorProps(cfg),
              callback: (v) => { const f = cfgTickFormatter(cfg, 'y'); return f ? f(v) : undefined; }
            },
            min: cfg.yMin !== '' && cfg.yMin !== undefined && cfg.yMin !== null ? Number(cfg.yMin) : undefined,
            max: cfg.yMax !== '' && cfg.yMax !== undefined && cfg.yMax !== null ? Number(cfg.yMax) : undefined
          }
        },
        plugins: {
          title: cfg.title ? { display: true, text: cfg.title, font: { size: fs + 2 } } : undefined,
          legend: { display: datasets.length > 0, labels: { font: chartJsFont(cfg, { size: (Number(tickSize(cfg, fs)) || fs) - 1 }) } }
        }
      }
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [tables, maxG, deltaMs, bigDeltaMs, cfg, showExcl, thresh, showFit, xMode, yTitle, gamma, useAll, errMode, fixedSD, manualSD, excluded, update]);

  return (
    <div className="w-full">
      <ChartJsInspector
        chartRef={chartRef}
        cfg={cfg}
        setCfg={setCfg}
        series={series}
        unit={unit}
        style={chartAspectImposed(cfg)
          ? { aspectRatio: String(chartAspect(cfg, DEFAULT_CHART_ASPECT_WIDE)), minHeight: `${chartJsHeightFit(420, cfg, { yTitle })}px` }
          : { height: `${chartJsHeightFit(420, cfg, { yTitle })}px` }}
      >
        <canvas ref={ref} />
      </ChartJsInspector>
      {!anyPoint && (
        <p className="text-[10px] text-slate-400 italic mt-1">
          No gradient data yet — enter gradient % and intensities in the Data tab (the chart reads directly from it).
        </p>
      )}
    </div>
  );
};


// Data Analysis — direct content (analysisPlain), no nested subsections.
// The Stejskal-Tanner plot and the per-gradient-set results tables are
// rendered DIRECTLY here, with Error Management + Graphical Parameters buttons.
const DOSYFittingSection = ({ ctx }) => {
  const tables = (Array.isArray(dosySections.tables) && dosySections.tables.length)
    ? dosySections.tables
    : (Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : []);
  const { maxG, deltaMs, bigDeltaMs, gamma = GAMMA_H } = dosySections.params;
  const chartCfg = useMemo(
    () => ({ ...DEFAULT_CFG, ...(ctx.activeTest?.dosyChartCfg || {}) }),
    [ctx.activeTest?.dosyChartCfg]
  );
  const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
  const plotRef = useRef(null); // container of the Chart.js canvas (for the ⭐ snapshot)
  const xMode = ctx.activeTest?.dosyXAxis === 'percent' ? 'percent' : ctx.activeTest?.dosyXAxis === 'g' ? 'g' : 'b';

  const series = [];
  tables.forEach((t, ti) => {
    for (let c = 0; c < (t.nCols || 0); c++) {
      series.push({ key: `col${ti}_${c}`, label: (t.colResidues && t.colResidues[c]) || `Set ${ti + 1} Col ${c + 1}` });
    }
  });

  // Unit shown by the style panel / the double-click editor for this x axis.
  const xUnit = xMode === 'percent' ? 'Gradient % (0–100)' : xMode === 'g' ? 'G (G/cm)' : 'b (s/mm²)';
  // The double-click editor writes back into dosyChartCfg, like the 🎨 panel.
  const setChartCfg = (patch) => update({ dosyChartCfg: { ...chartCfg, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      {/* Read-only gradient parameters, taken from Instrumental Setup */}
      <div className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
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
        <div>
          <div className="text-[10px] font-black text-slate-400 uppercase">Gyromagnetic ratio γ</div>
          <div className="text-base font-bold text-slate-800 font-mono">{gamma.toExponential(3)} rad/(s·T)</div>
        </div>
      </div>

      {/* Stejskal-Tanner equation (the fitting function) */}
      <div className="w-full bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-center">
        <div className="text-[10px] font-black text-indigo-500 uppercase mb-1">Stejskal-Tanner equation</div>
        <div className="text-sm md:text-lg font-semibold text-slate-800 overflow-x-auto whitespace-nowrap py-1"
             style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
          I<sub>G</sub> = I<sub>0</sub> · exp[ −(γ·δ·G)² · D · (Δ − δ/3) ] + C
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          with&nbsp; b = (γ·δ·G)²·(Δ − δ/3), &nbsp;G = G<sub>max</sub> · (gradient % / 100)
          &nbsp;and&nbsp; γ = {gamma.toExponential(3)} rad/(s·T)
          {ctx.activeTest?.dosyNucleus ? ` (${ctx.activeTest.dosyNucleus})` : ' (¹H)'} ·
          &nbsp;C (baseline offset) is optimized automatically
        </div>
      </div>

      {/* X-axis switch: Gradient % (intensity curve) ↔ b-value ↔ G (G/cm) */}
      <div className="w-full flex flex-wrap items-center justify-center gap-2">
        <span className="text-[10px] font-black text-slate-500 uppercase">X axis:</span>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => update({ dosyXAxis: 'b' })}
            className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${xMode === 'b' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            title="Stejskal-Tanner plot: ln(I) vs b-value (s/mm²) with a linear regression fit">
            b-value (s/mm²)
          </button>
          <button
            type="button"
            onClick={() => update({ dosyXAxis: 'g' })}
            className={`px-3 py-1.5 text-[11px] font-bold transition-colors border-l border-slate-200 ${xMode === 'g' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            title="Stejskal-Tanner plot: ln(I) vs gradient strength G (G/cm) with the model curve">
            G (G/cm)
          </button>
          <button
            type="button"
            onClick={() => update({ dosyXAxis: 'percent' })}
            className={`px-3 py-1.5 text-[11px] font-bold transition-colors border-l border-slate-200 ${xMode === 'percent' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            title="Intensity I vs gradient % (0–100) with the Stejskal-Tanner decay curve">
            Gradient %
          </button>
        </div>
        <span className="text-[10px] text-slate-400">
          {xMode === 'percent'
            ? 'I vs gradient % — exponential Stejskal-Tanner decay'
            : xMode === 'g'
              ? 'ln(I) vs G (G/cm) — model curve (quadratic in G)'
              : 'ln(I) vs b — linearized Stejskal-Tanner fit'}
        </span>
      </div>

      {/* Stejskal-Tanner results tables — directly inside Data Analysis */}
      {tables.map((t, i) => (dosySections.renderAnalysis ? dosySections.renderAnalysis(t, i) : null))}

      {/* Per-gradient-set points editor (exclude points + manual ±SD) */}
      {tables.map((t, i) => (dosySections.renderPoints ? dosySections.renderPoints(t, i) : null))}

      {/* Transparency note: how many rows were actually used in the fit */}
      {(() => {
        let nUsed = 0, nTotal = 0, nExcluded = 0;
        tables.forEach((t) => {
          const cols = (dosySections.fits && dosySections.fits[t.id]) || [];
          cols.forEach((cf) => {
            if (cf && cf.fit) {
              nUsed += cf.fit.n || 0;
              nTotal += cf.fit.total || cf.fit.n || 0;
              nExcluded += Array.isArray(cf.fit.excluded) ? cf.fit.excluded.length : 0;
            }
          });
        });
        if (nTotal === 0) return null;
        return (
          <p className={`text-[10px] ${nExcluded > 0 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
            Fit uses {nUsed} of {nTotal} data point{nTotal === 1 ? '' : 's'}
            {nExcluded > 0
              ? ` — ${nExcluded} excluded as outlier${nExcluded === 1 ? '' : 's'}. Tick “Use all points” (Error Management) to keep every row.`
              : ' (all valid rows).'}
          </p>
        );
      })()}

      {/* Stejskal-Tanner plot — directly inside Data Analysis, with Error
          Management (outliers, fit toggle) and Graphical Parameters buttons */}
      <ChartPanel
        title={xMode === 'percent'
          ? 'Stejskal-Tanner plot — Gradient % vs Intensity'
          : xMode === 'g'
            ? 'Stejskal-Tanner plot — G (G/cm) vs ln(I)'
            : 'Stejskal-Tanner plot — b vs ln(I)'}
        icon="📈"
        errPanel={
          <SharedErrorTreatment
            activeTest={ctx.activeTest || {}}
            updateActiveTest={update}
            showFitToggle
            customActions={
              <>
                <label className="flex items-center gap-2 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm" title="Use every valid row of the Data table (no automatic outlier exclusion)">
                  <span className="text-xs font-bold text-teal-800">Use all points</span>
                  <input type="checkbox" checked={ctx.activeTest?.dosyUseAllPoints !== false}
                    onChange={(e) => update({ dosyUseAllPoints: e.target.checked })}
                    className="w-4 h-4 cursor-pointer accent-teal-600" />
                </label>
                <label className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-md px-2 py-1.5 shadow-sm" title="Error-bar mode (as in the plate tests)">
                  <span className="text-xs font-bold text-slate-600">Error bars:</span>
                  <select value={ctx.activeTest?.dosyErrMode || 'none'}
                    onChange={(e) => update({ dosyErrMode: e.target.value })}
                    className="border border-slate-300 rounded text-[11px] px-1 py-0.5 outline-none bg-white font-semibold text-slate-700">
                    <option value="none">None</option>
                    <option value="fixed">Fixed</option>
                    <option value="sd">Std. deviation</option>
                    <option value="touch">Touch curve</option>
                  </select>
                  {ctx.activeTest?.dosyErrMode === 'fixed' && (
                    <input type="number" step="any" min="0" value={ctx.activeTest?.dosyFixedSDStr ?? ''}
                      onChange={(e) => update({ dosyFixedSDStr: e.target.value })}
                      placeholder="±SD"
                      className="w-16 border border-slate-300 rounded text-[11px] px-1 py-0.5 outline-none font-mono" />
                  )}
                </label>
                <button type="button" onClick={() => {
                  const excluded = ctx.activeTest?.dosyExcluded || {};
                  let next = excluded;
                  (Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : []).forEach((tb) => {
                    next = clearExcludedForTable(next, tb.id);
                  });
                  update({ dosyExcluded: next });
                }}
                        className="bg-white border border-orange-300 text-orange-700 hover:bg-orange-100 font-bold px-3 py-2 rounded-lg text-xs shadow-sm whitespace-nowrap"
                        title="Re-include every manually excluded point">
                  ↩️ Restore all points
                </button>
                <button type="button" onClick={() => dosySections.recomputeAll && dosySections.recomputeAll()}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm whitespace-nowrap">
                  ▶️ Recompute fits
                </button>
              </>
            }
          />
        }
        cfgPanel={
          <SharedChartStylePanel
            cfg={chartCfg}
            setCfg={setChartCfg}
            series={series}
            unit={xUnit}
          />
        }
        headerExtra={
          <StarToggle
            active={isStarred(ctx.activeTest, 'dosy-plot')}
            title={isStarred(ctx.activeTest, 'dosy-plot')
              ? 'Remove this plot from the project document'
              : '⭐ Import this plot into the project document'}
            onToggle={() => {
              const cv = plotRef.current ? plotRef.current.querySelector('canvas') : null;
              const url = cv ? cv.toDataURL('image/png') : '';
              if (!url) return;
              update({
                starredItems: toggleStarredItem(ctx.activeTest, {
                  id: 'dosy-plot',
                  kind: 'graph',
                  label: xMode === 'percent'
                    ? 'Stejskal-Tanner plot (Gradient % vs Intensity)'
                    : xMode === 'g'
                      ? 'Stejskal-Tanner plot (G/cm vs ln I)'
                      : 'Stejskal-Tanner plot (b vs ln I)',
                  caption: xMode === 'percent'
                    ? 'Stejskal-Tanner curve — intensity I vs gradient %'
                    : xMode === 'g'
                      ? 'Stejskal-Tanner plot — ln(I) vs gradient strength G (G/cm)'
                      : 'Stejskal-Tanner plot — ln(I) vs b-value',
                  url
                })
              });
            }}
          />
        }
      >
        <div ref={plotRef} data-star-key="dosy-plot">
          <DOSYFitChart
            tables={tables}
            params={{ maxG, deltaMs, bigDeltaMs }}
            cfg={chartCfg}
            showExcl={ctx.activeTest?.showExcl !== false}
            outlierThresh={ctx.activeTest?.outlierThreshStr || '2.0'}
            showFit={ctx.activeTest?.fitIC50 !== false}
            mode={xMode}
            gamma={gamma}
            useAll={ctx.activeTest?.dosyUseAllPoints !== false}
            errMode={ctx.activeTest?.dosyErrMode || 'none'}
            fixedSD={ctx.activeTest?.dosyFixedSDStr || ''}
            manualSD={ctx.activeTest?.dosyManualSD || {}}
            excluded={ctx.activeTest?.dosyExcluded || {}}
            update={update}
            setCfg={setChartCfg}
            series={series}
            unit={xUnit}
          />
        </div>
      </ChartPanel>
      <p className="text-[10px] text-slate-400 -mt-2">
        The plot reads the gradient % / intensity values directly from the Data tab and the gradient parameters of
        Instrumental Setup. Switch the x axis between “Gradient %” (intensity curve), “b-value” (linearized ln(I) fit)
        and “G (G/cm)” (gradient strength). Use “Error Management” to drop outliers from the fit and “Graphical Parameters”
        to style the chart.
      </p>
    </div>
  );
};


// Common nuclei gyromagnetic ratios (rad/(s·T)) for the Stejskal-Tanner fit.
const DOSY_NUCLEI = [
  { label: '¹H', value: 2.6752218744e8 },
  { label: '¹⁹F', value: 2.51815e8 },
  { label: '³¹P', value: 1.08409e8 },
  { label: '¹³C', value: 6.728284e7 },
  { label: '¹⁵N', value: -2.71261804e7 }, // magnitude used (γ² in the b-value)
];

const DOSYInstrumentalSetup = ({ ctx }) => {
  const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
  const activeTest = ctx.activeTest || {};
  return (
    <NMRInstrumentalSetup
      ctx={ctx}
      hideOperator
      hideDatasets // the DOSY dataset fields below replace the generic "Datasets" editor
      extraFields={(
        <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 flex flex-col gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-700">DOSY Dataset</h4>
            <p className="text-[10px] text-slate-400">Dataset identification for this DOSY experiment.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Dataset Name</label>
                <input type="text" value={activeTest.dosyDatasetName || ''} onChange={(e) => update({ dosyDatasetName: e.target.value })} placeholder="e.g. PEG400_DOSY" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Experiment Number</label>
                <input type="text" value={activeTest.dosyExpNumber || ''} onChange={(e) => update({ dosyExpNumber: e.target.value })} placeholder="e.g. 12" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Link (URL)</label>
                <input type="text" value={activeTest.dosyLink || ''} onChange={(e) => update({ dosyLink: e.target.value })} placeholder="https://..." className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
              </div>
            </div>
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Gyromagnetic ratio γ (rad/(s·T))</label>
              <input type="number" step="any"
                value={activeTest.dosyGamma || GAMMA_H}
                onChange={(e) => update({ dosyGamma: e.target.value === '' ? '' : Number(e.target.value), dosyNucleus: 'Custom' })}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white font-mono" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Nucleus preset</label>
              <select
                value={DOSY_NUCLEI.find((n) => n.label === activeTest.dosyNucleus && Number(activeTest.dosyGamma) === n.value) ? activeTest.dosyNucleus : 'custom'}
                onChange={(e) => {
                  const n = DOSY_NUCLEI.find((x) => x.label === e.target.value);
                  if (n) update({ dosyGamma: n.value, dosyNucleus: n.label });
                }}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white font-semibold text-slate-700">
                {DOSY_NUCLEI.map((n) => <option key={n.label} value={n.label}>{n.label}</option>)}
                <option value="custom">Custom…</option>
              </select>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Used in b = (γ·δ·G)²·(Δ − δ/3). Default ¹H = 2.6752×10⁸ rad/(s·T).
            </p>
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
  const [dosyImportOpen, setDosyImportOpen] = useState(false);

  // The DATA TABLES live directly on the test (activeTest.dosyTables). No local
  // shadow state: every mutator composes against the LATEST array via tablesRef,
  // so an Excel paste (many cell updates in one batch) and later single-cell
  // edits can never drop the other values.
  const makeDefaultTable = () => makeTable({
    relaxType: 'DOSY', delayUnit: '%',
    nRows: 8, nCols: 4,
    delays: [0, 5, 10, 20, 40, 60, 80, 100],
    grid: Array.from({ length: 8 }, () => Array(4).fill('')),
  });
  const fallbackTable = useMemo(() => makeDefaultTable(), []);
  const tables = (Array.isArray(activeTest.dosyTables) && activeTest.dosyTables.length)
    ? activeTest.dosyTables
    : [fallbackTable];
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const commit = (next) => { tablesRef.current = next; update({ dosyTables: next }); };
  const liveTable = (t) => tablesRef.current.find((tb) => tb.id === t.id) || t;
  const updateTable = (id, patch) => {
    const live = tablesRef.current;
    commit(live.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const setCell = (t, r, c, v) => {
    const lt = liveTable(t);
    const g = (lt.grid || []).map((row) => (row || []).slice());
    while (g.length < lt.nRows) g.push(new Array(lt.nCols).fill(''));
    if (!g[r]) g[r] = [];
    while (g[r].length < lt.nCols) g[r].push('');
    g[r][c] = v;
    updateTable(t.id, { grid: g });
  };
  const setDelay = (t, r, v) => { const lt = liveTable(t); const d = (lt.delays || []).slice(); d[r] = v; updateTable(t.id, { delays: d }); };
  const setColResidue = (t, c, v) => { const lt = liveTable(t); const cr = (lt.colResidues || []).slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };
  const addRow = (t) => { const lt = liveTable(t); const last = lt.delays.length ? Number(lt.delays[lt.delays.length - 1]) || 0 : 0; updateTable(t.id, { nRows: lt.nRows + 1, delays: [...(lt.delays || []), last], grid: [...(lt.grid || []).map((r) => r.slice()), new Array(lt.nCols).fill('')] }); };
  const removeRow = (t, r) => { const lt = liveTable(t); if (lt.nRows <= 1) return; updateTable(t.id, { nRows: lt.nRows - 1, delays: (lt.delays || []).filter((_, i) => i !== r), grid: (lt.grid || []).filter((_, i) => i !== r) }); };
  const addCol = (t) => { const lt = liveTable(t); updateTable(t.id, { nCols: lt.nCols + 1, colResidues: [...(lt.colResidues || []), ''], grid: (lt.grid || []).map((r) => [...(r || []), '']) }); };
  const removeCol = (t, c) => { const lt = liveTable(t); if (lt.nCols <= 1) return; updateTable(t.id, { nCols: lt.nCols - 1, colResidues: (lt.colResidues || []).filter((_, i) => i !== c), grid: (lt.grid || []).map((r) => (r || []).filter((_, i) => i !== c)) }); };
  const addTable = () => commit([...tablesRef.current, makeDefaultTable()]);
  const removeTable = (id) => { if (tablesRef.current.length <= 1) { alert('Keep at least one gradient set.'); return; } commit(tablesRef.current.filter((t) => t.id !== id)); };

  // Import pasted text into a gradient set: first column = gradient % (0–100),
  // following columns = intensities. Creates a new set or overwrites one.
  const handleDosyImport = (rows, targetTableId) => {
    if (!Array.isArray(rows) || !rows.length) return;
    const nInt = Math.max(1, Math.max(...rows.map((r) => r.length - 1)));
    const clampG = (v) => (typeof v === 'number' ? Math.min(100, Math.max(0, v)) : v);
    const delays = rows.map((r) => clampG(r[0]));
    const colResidues = Array.from({ length: nInt }, (_, c) => (c === 0 ? 'Intensity 1' : `Intensity ${c + 1}`));
    const grid = rows.map((r) =>
      Array.from({ length: nInt }, (_, c) => (r[c + 1] === undefined || r[c + 1] === null ? '' : r[c + 1]))
    );
    if (targetTableId === 'new') {
      commit([...tablesRef.current, {
        id: 'd' + Date.now() + Math.floor(Math.random() * 1e4),
        nRows: rows.length, nCols: nInt, delayUnit: '%',
        delays, colResidues, grid
      }]);
    } else {
      commit(tablesRef.current.map((t) => (t.id === targetTableId
        ? { ...t, nRows: rows.length, nCols: nInt, delayUnit: t.delayUnit || '%', delays, colResidues, grid }
        : t)));
    }
    setDosyImportOpen(false);
  };

  const gamma = Number(activeTest.dosyGamma) > 0 ? Number(activeTest.dosyGamma) : GAMMA_H; // gyromagnetic ratio γ (rad/(s·T))

  const gradientParams = {
    maxG: Number(activeTest.dosyMaxG) || 60,
    deltaMs: Number(activeTest.dosySmallDelta) || 2,
    bigDeltaMs: Number(activeTest.dosyDelta) || 50,
    gamma,
  };
  dosySections.params = gradientParams;
  dosySections.gamma = gamma;
  dosySections.tables = tables;

  const [fits, setFits] = useState(activeTest.dosyFits || {});
  const fitsSigRef = useRef('');

  const computeFits = (tablesList) => {
    const thresh = Number(activeTest.outlierThreshStr) > 0 ? Number(activeTest.outlierThreshStr) : 2;
    const useAll = activeTest.dosyUseAllPoints !== false; // default: use every valid row
    const excludedMap = activeTest.dosyExcluded || {};
    const next = {};
    const sigs = [];
    tablesList.forEach((t) => {
      const cols = [];
      for (let c = 0; c < (t.nCols || 0); c++) {
        const bvals = [], ys = [];
        for (let r = 0; r < t.nRows; r++) {
          const key = `${c}:${r}`;
          if (isPointExcluded(excludedMap, t.id, key)) continue; // manually removed point
          const b = computeB(t.delays[r], gradientParams.maxG, gradientParams.deltaMs / 1000, gradientParams.bigDeltaMs / 1000, gradientParams.gamma);
          const y = parseFloat(t.grid?.[r]?.[c]);
          if (b >= 0 && isFinite(y) && y > 0) { bvals.push(b); ys.push(y); }
        }
        const fit = useAll
          ? fitStejskalTannerWithC(bvals, ys)
          : fitStejskalTannerRobust(bvals, ys, thresh);
        cols.push({ residue: t.colResidues?.[c] || `Col ${c + 1}`, fit });
        sigs.push(fit ? [fit.D, fit.I0, fit.C, fit.r2, fit.n, fit.total, fit.excluded].join('|') : 'null');
      }
      next[t.id] = cols;
    });
    const sig = sigs.join(';');
    return { next, sig };
  };

  // Auto-fit whenever the data changes so the results tables always mirror
  // the values entered in the Data tab.
  useEffect(() => {
    const { next, sig } = computeFits(tables);
    if (sig === fitsSigRef.current) return;
    fitsSigRef.current = sig;
    setFits(next);
    update({ dosyFits: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, activeTest.outlierThreshStr, activeTest.dosyMaxG, activeTest.dosySmallDelta, activeTest.dosyDelta, activeTest.dosyGamma, activeTest.dosyUseAllPoints, activeTest.dosyExcluded]);

  const runFitForTable = () => {
    const { next } = computeFits(tablesRef.current);
    setFits(next);
    update({ dosyFits: next });
  };
  dosySections.recomputeAll = () => runFitForTable();


  const sim = { MW: 12000, shape: 'sphere', vbar: 0.73, hydration: 0.3, viscosity: 0.89e-3, ...(activeTest.dosySim || {}) };
  const setSim = (patch) => update({ dosySim: { ...sim, ...patch } });

  // A gradient set table rendered DIRECTLY (no collapsible around it).
  const renderTableData = (t, tIndex) => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Gradient % vs Intensity</h4>
        <StarToggle
          active={isStarred(activeTest, `dosy-data-${t.id}`)}
          title={isStarred(activeTest, `dosy-data-${t.id}`)
            ? 'Remove this data table from the project document'
            : '⭐ Import this data table into the project document'}
          onToggle={() => update({
            starredItems: toggleStarredItem(activeTest, {
              id: `dosy-data-${t.id}`,
              kind: 'table',
              label: `Gradient set ${tIndex + 1} — Gradient % vs Intensity`,
              caption: `Raw gradient % / intensity data of gradient set ${tIndex + 1}.`,
              columns: [
                'Gradient % (0–100)',
                ...Array.from({ length: t.nCols || 0 }, (_, c) => t.colResidues?.[c] || `Col ${c + 1}`)
              ],
              rows: Array.from({ length: t.nRows || 0 }, (_, r) => [
                t.delays?.[r] ?? '-',
                ...Array.from({ length: t.nCols || 0 }, (_, c) => t.grid?.[r]?.[c] ?? '-')
              ])
            })
          })}
        />
      </div>
      <div className="overflow-auto border border-slate-300 rounded-lg bg-white shadow-inner" data-star-key={`dosy-data-${t.id}`}>
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
        <button onClick={() => runFitForTable()} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm transition-colors">▶️ Fit Stejskal-Tanner (D)</button>
        <button onClick={() => removeTable(t.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-md shadow-sm flex items-center gap-2 transition-colors">🗑️ Delete</button>
      </div>
    </div>
  );


  // Stejskal-Tanner results table rendered DIRECTLY (no collapsible around it).
  const renderTableAnalysis = (t, tIndex) => {
    const colFits = (fits[t.id] || []).map((cf) => ({ ...cf }));
    return (
      <div key={t.id} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Gradient set {tIndex + 1} — Stejskal-Tanner results</h4>
          <StarToggle
            active={isStarred(activeTest, `dosy-results-${t.id}`)}
            title={isStarred(activeTest, `dosy-results-${t.id}`)
              ? 'Remove this results table from the project document'
              : '⭐ Import this results table into the project document'}
            onToggle={() => update({
              starredItems: toggleStarredItem(activeTest, {
                id: `dosy-results-${t.id}`,
                kind: 'table',
                label: `Gradient set ${tIndex + 1} — Stejskal-Tanner results`,
                caption: `Stejskal-Tanner fit results for gradient set ${tIndex + 1}.`,
                columns: ['Column', 'Diffusion D (m²/s)', 'I₀', 'C (baseline)', 'R²', 'n points'],
                rows: colFits.map((cf) => [
                  cf.residue,
                  cf.fit ? cf.fit.D.toExponential(3) : '—',
                  cf.fit ? cf.fit.I0.toExponential(2) : '—',
                  cf.fit ? cf.fit.C.toExponential(2) : '—',
                  cf.fit ? cf.fit.r2.toFixed(3) : '—',
                  cf.fit ? (cf.fit.total && cf.fit.total !== cf.fit.n ? `${cf.fit.n}/${cf.fit.total}` : String(cf.fit.n)) : '0'
                ])
              })
            })}
          />
        </div>
        <div className="overflow-auto border border-slate-200 rounded-lg" data-star-key={`dosy-results-${t.id}`}>
          <table className="border-collapse text-xs w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-3 py-1.5 border border-slate-200 text-left">Column</th>
                <th className="px-3 py-1.5 border border-slate-200">Diffusion D (m²/s)</th>
                <th className="px-3 py-1.5 border border-slate-200">I₀</th>
                <th className="px-3 py-1.5 border border-slate-200">C (baseline)</th>
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
                  <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.C.toExponential(2) : '—'}</td>
                  <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.r2.toFixed(3) : '—'}</td>
                  <td className="p-1.5 border border-slate-200">{cf.fit ? (cf.fit.total && cf.fit.total !== cf.fit.n ? `${cf.fit.n}/${cf.fit.total}` : cf.fit.n) : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => runFitForTable()} className="self-start text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">▶️ Recompute fit</button>
      </div>
    );
  };

  // Per-gradient-set "points" editor — exclude / re-include points and set a
  // manual per-point SD, exactly like the plate / CD / ssNMR point tables.
  const renderPointsTable = (t, tIndex) => {
    const tableId = t.id;
    const excludedMap = activeTest.dosyExcluded || {};
    const manualSDMap = activeTest.dosyManualSD || {};
    const nCols = t.nCols || 0;
    return (
      <div key={`pts-${t.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Points — gradient set {tIndex + 1}</h4>
          <button type="button"
            onClick={() => update({ dosyExcluded: clearExcludedForTable(excludedMap, tableId) })}
            className="text-[10px] font-bold text-orange-600 hover:text-orange-800 border border-orange-200 rounded px-2 py-0.5 hover:bg-orange-50 transition-colors">
            ↩️ Restore
          </button>
        </div>
        <div className="overflow-auto border border-slate-200 rounded-lg" data-star-key={`dosy-points-${t.id}`}>
          <table className="border-collapse text-xs w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-2 py-1 border border-slate-200 text-left">Gradient %</th>
                {Array.from({ length: nCols }, (_, c) => (
                  <th key={c} className="px-2 py-1 border border-slate-200">{t.colResidues?.[c] || `Col ${c + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: t.nRows || 0 }, (_, r) => (
                <tr key={r}>
                  <td className="px-2 py-1 border border-slate-200 font-mono font-bold text-slate-700">{t.delays?.[r] ?? '-'}</td>
                  {Array.from({ length: nCols }, (_, c) => {
                    const key = `${c}:${r}`;
                    const isExcl = isPointExcluded(excludedMap, tableId, key);
                    return (
                      <td key={c} className={`px-2 py-1 border border-slate-200 ${isExcl ? 'bg-red-50 opacity-50' : ''}`}>
                        <div className="flex flex-col gap-1 min-w-[120px]">
                          <span className="font-mono">{t.grid?.[r]?.[c] ?? '-'}</span>
                          <div className="flex items-center gap-1">
                            <input type="number" step="any" min="0" placeholder="±SD"
                              value={manualSDMap[tableId]?.[key] ?? ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                const series = { ...(manualSDMap[tableId] || {}) };
                                if (val === '') delete series[key];
                                else series[key] = Number(val);
                                update({ dosyManualSD: { ...manualSDMap, [tableId]: series } });
                              }}
                              className="w-14 border border-slate-300 rounded px-1 py-0.5 text-center text-[10px] outline-none font-mono" />
                            <button type="button"
                              onClick={() => update({ dosyExcluded: togglePointExcluded(excludedMap, tableId, key) })}
                              className={`text-[10px] font-black px-1.5 py-0.5 rounded border transition-colors ${isExcl ? 'bg-red-100 text-red-600 border-red-300' : 'text-slate-400 border-slate-200 hover:text-red-500 hover:border-red-200'}`}
                              title="Exclude / re-include this point">
                              {isExcl ? 'EXCL' : '×'}
                            </button>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 italic">
          Excluded rows are drawn hollow and left out of the fit. Manual ±SD overrides the error-bar mode for that row.
          Tip: click any point directly on the plot to exclude / re-include it.
        </p>
      </div>
    );
  };

  // Bridge render closures into the stable module-level section components.
  dosySections.renderData = (t, i) => renderTableData(t, i);
  dosySections.renderAnalysis = (t, i) => renderTableAnalysis(t, i);
  dosySections.renderPoints = (t, i) => renderPointsTable(t, i);
  dosySections.addTable = addTable;
  dosySections.openImport = () => setDosyImportOpen(true);
  dosySections.sim = sim;
  dosySections.setSim = setSim;
  dosySections.fits = fits;
  dosySections.solvents = rest.solvents || [];

  return (
    <>
      <TestShellRenderer
        config={DOSY_TAB_CONFIG}
        custom={{
          Setup: null, // "Experiment Setup" was merged into Instrumental Setup (DOSY Dataset fields)
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
      <DOSYImportModal
        open={dosyImportOpen}
        onClose={() => setDosyImportOpen(false)}
        onImport={handleDosyImport}
        tables={tables}
      />
    </>
  );
};

export default DOSYTestRenderer;

