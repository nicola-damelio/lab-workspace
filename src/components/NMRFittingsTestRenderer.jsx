import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import { NMR_FITTING_TAB_CONFIG } from './tabConfigs';
import { PALETTE, toHex, errBarPlugin } from '../data/constants';
import { NMRInstrumentalSetup } from './NMRInstrumentalSetup';
import { SharedGraphConfig } from './SharedAnalysisTools';

/* ============================================================================
NMR FITTINGS / RELAXATION RENDERER — UPDATED VERSION
Changes:
- Removed target molecule from experiment setup
- Added dataset name, experiment number, and link fields
- Decay/Diffusion curves and Parameter vs Atom are full-width (not side by side)
- Histogram option and error bars added to charts
- Observed atom, Experiment Type, Delay unit and fit button moved under data table
  in "Data Analysis" subsection linked to each table
- Fitted data table is expandable and exportable to XLS
- Simulation section added with diffusion coefficient simulator and nuclear
  relaxation simulator
- NMRInstrumentalSetup integrated
- Integrated SharedGraphConfig for modular chart settings
============================================================================ */

const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

/* ---------------------------------------------------------------------------
PHYSICS CONSTANTS & MODEL-FREE
--------------------------------------------------------------------------- */
const HBAR = 1.054571817e-34;
const MU0_4PI = 1e-7;
const RGAS = 8.314462618;
const GAMMA_H = 2.6752218744e8;
const GAMMA = { '15N': -2.7126e7, '13C': 6.7283e7, '1H': 2.6752218744e8, '31P': 1.083e8 };
const DEFAULT_DIST = { '15N': 1.02, '13C': 1.09, '1H': 1.09 };
const DEFAULT_CSA = { '15N': -160, '13C': -20, '1H': 0 };
const STANDARD_ATOMS = ['HN', 'N', 'HA', 'CA', 'CB', 'CG', 'CD', 'CE', 'CZ', 'CO', "C'", 'Cα', 'Cβ', 'Cγ', 'Cδ', 'CH3', 'NH', 'NH2', 'OG', 'OD', 'OE'];
const BOLTZMANN = 1.380649e-23;

const nucleusFromAtom = (atom) => {
    const a = (atom || '').toUpperCase().replace(/[′']/g, '').trim();
    if (!a) return '15N';
    if (a === 'HN' || a.startsWith('N') || a === 'NH' || a === 'NH2' || a.startsWith('O')) return '15N';
    if (a.startsWith('C') || a === "C'") return '13C';
    if (a.startsWith('H')) return '1H';
    return '15N';
};

const residuesFromSequence = (seq) => Array.from((seq || '').replace(/[^a-zA-Z]/g, '').toUpperCase()).map((aa, i) => `${aa}${i + 1}`);

function spectralDensity(w, tau_c, S2, useInternal, tau_e) {
    let val = (S2 * tau_c) / (1 + (w * tau_c) ** 2);
    if (useInternal && tau_e > 0) {
        const te = 1 / (1 / tau_c + 1 / tau_e);
        val += ((1 - S2) * te) / (1 + (w * te) ** 2);
    }
    return (2 / 5) * val;
}

function modelFreeRates({ nucleus = '15N', fieldMHz = 600, tau_c_ns = 5, S2 = 0.85, useInternal = false, tau_e_ps = 50, r_A = 1.02, csa_ppm = -160 }) {
    const gx = GAMMA[nucleus] ?? GAMMA['15N'];
    const gxAbs = Math.abs(gx);
    const B0 = (2 * Math.PI * fieldMHz * 1e6) / GAMMA_H;
    const wH = GAMMA_H * B0;
    const wX = gxAbs * B0;
    const tau_c = tau_c_ns * 1e-9;
    const tau_e = tau_e_ps * 1e-12;
    const r_m = r_A * 1e-10;
    const J = (w) => spectralDensity(w, tau_c, S2, useInternal, tau_e);
    const D = MU0_4PI * GAMMA_H * gxAbs * HBAR / (r_m ** 3);
    const D2 = D * D;
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
    return { R1dip, R2dip, R1csa, R2csa, R1, R2, NOE: R1 > 0 ? 1 + (GAMMA_H / gx) * (sigmaX / R1) : 1, T1: R1 > 0 ? 1 / R1 : Infinity, T2: R2 > 0 ? 1 / R2 : Infinity, ratio: R2 > 0 ? R1 / R2 : 0 };
}

function tauFromMW(MW_Da, eta_PaS, T_K, vbar_cm3g = 0.73, hydration = 0.3) {
    return (eta_PaS * (MW_Da * 1e-3 * (vbar_cm3g * 1e-3 + hydration * 1e-3))) / (RGAS * T_K);
}

function mwFromTau(tau_s, eta_PaS, T_K, vbar_cm3g = 0.73, hydration = 0.3) {
    return (((tau_s * RGAS * T_K) / eta_PaS) / (vbar_cm3g * 1e-3 + hydration * 1e-3)) * 1e3;
}

// Stokes-Einstein diffusion coefficient
function stokesEinsteinD(T_K, eta_PaS, r_m) {
    return (BOLTZMANN * T_K) / (6 * Math.PI * eta_PaS * r_m);
}

// Approximate radius from MW (assuming sphere with vbar and hydration)
function radiusFromMW(MW_Da, vbar_cm3g = 0.73, hydration = 0.3) {
    const V_m3 = (MW_Da * 1e-3 / 6.022e23) * (vbar_cm3g * 1e-6 + hydration * 1e-6);
    return Math.pow((3 * V_m3) / (4 * Math.PI), 1 / 3);
}

/* ---------------------------------------------------------------------------
LEVENBERG-MARQUARDT SOLVERS
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
    const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
    const n = pts.length;
    if (n < 3) return null;
    const pos = pts.filter((p) => p.y > 0);
    let R0 = 1, A0 = Math.max(...pts.map((p) => Math.abs(p.y)));
    if (pos.length >= 2) {
        const lx = pos.map((p) => p.x), ly = pos.map((p) => Math.log(p.y));
        const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
        const my = ly.reduce((a, b) => a + b, 0) / ly.length;
        let num = 0, den = 0;
        for (let i = 0; i < lx.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
        R0 = Math.max(1e-6, -(den > 0 ? num / den : -1));
        A0 = Math.max(1e-9, Math.exp(my + R0 * mx));
    }
    let p = [Math.log(A0), Math.log(R0)];
    const model = (x, pp) => Math.exp(pp[0] - Math.exp(pp[1]) * x);
    const rss = (pp) => pts.reduce((s, q) => s + Math.pow(q.y - model(q.x, pp), 2), 0);
    let cur = rss(p), lambda = 1e-3;
    for (let it = 0; it < 200; it++) {
        const JtJ = [[0, 0], [0, 0]], Jtr = [0, 0];
        for (let i = 0; i < n; i++) {
            const x = pts[i].x, f0 = model(x, p), g = [];
            for (let j = 0; j < 2; j++) {
                const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
                g.push((model(x, pp) - f0) / h);
            }
            const r = pts[i].y - f0;
            for (let a = 0; a < 2; a++) { Jtr[a] += g[a] * r; for (let b = 0; b < 2; b++) JtJ[a][b] += g[a] * g[b]; }
        }
        const dp = solveLinear([[JtJ[0][0] * (1 + lambda), JtJ[0][1]], [JtJ[1][0], JtJ[1][1] * (1 + lambda)]], Jtr);
        if (!dp) { lambda *= 10; if (lambda > 1e12) break; continue; }
        const pn = [p[0] + dp[0], p[1] + dp[1]], nr = rss(pn);
        if (nr < cur) { p = pn; cur = nr; lambda = Math.max(lambda * 0.5, 1e-12); } else { lambda *= 10; if (lambda > 1e12) break; }
    }
    const A = Math.exp(p[0]), R = Math.exp(p[1]), meanY = pts.reduce((s, q) => s + q.y, 0) / n;
    let ssTot = 0, ssRes = 0;
    pts.forEach((q) => { ssTot += (q.y - meanY) ** 2; ssRes += (q.y - model(q.x, p)) ** 2; });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    let seR = null;
    const H = [[0, 0], [0, 0]];
    for (let i = 0; i < n; i++) {
        const x = pts[i].x, f0 = model(x, p), g = [];
        for (let j = 0; j < 2; j++) {
            const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
            g.push((model(x, pp) - f0) / h);
        }
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) H[a][b] += g[a] * g[b];
    }
    const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    if (Math.abs(det) > 1e-30) {
        const varLnR = (H[0][0] / det) * (ssRes / Math.max(1, n - 2));
        if (varLnR > 0) seR = R * Math.sqrt(varLnR);
    }
    return { A, R, T: 1 / R, r2, n, seR, modelType: 'mono-exp' };
}

function fitInversionRecovery(xs, ys) {
    const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => isFinite(p.x) && isFinite(p.y));
    const n = pts.length;
    if (n < 4) return null;
    const maxY = Math.max(...pts.map(p => p.y)), minY = Math.min(...pts.map(p => p.y));
    let R0 = 1;
    const zeroCross = pts.find(p => p.y >= 0);
    if (zeroCross && zeroCross.x > 0) R0 = Math.log(2) / zeroCross.x;
    let p = [maxY, maxY - minY, Math.log(Math.max(1e-6, R0))];
    const model = (x, pp) => pp[0] - pp[1] * Math.exp(-Math.exp(pp[2]) * x);
    const rss = (pp) => pts.reduce((s, q) => s + Math.pow(q.y - model(q.x, pp), 2), 0);
    let cur = rss(p), lambda = 1e-3;
    for (let it = 0; it < 200; it++) {
        const JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], Jtr = [0, 0, 0];
        for (let i = 0; i < n; i++) {
            const x = pts[i].x, f0 = model(x, p), R_val = Math.exp(p[2]), exp_term = Math.exp(-R_val * x);
            const g = [1, -exp_term, p[1] * x * R_val * exp_term];
            const r = pts[i].y - f0;
            for (let a = 0; a < 3; a++) { Jtr[a] += g[a] * r; for (let b = 0; b < 3; b++) JtJ[a][b] += g[a] * g[b]; }
        }
        const dp = solveLinear([[JtJ[0][0] * (1 + lambda), JtJ[0][1], JtJ[0][2]], [JtJ[1][0], JtJ[1][1] * (1 + lambda), JtJ[1][2]], [JtJ[2][0], JtJ[2][1], JtJ[2][2] * (1 + lambda)]], Jtr);
        if (!dp) { lambda *= 10; if (lambda > 1e12) break; continue; }
        const pn = [p[0] + dp[0], p[1] + dp[1], p[2] + dp[2]], nr = rss(pn);
        if (nr < cur) { p = pn; cur = nr; lambda = Math.max(lambda * 0.5, 1e-12); } else { lambda *= 10; if (lambda > 1e12) break; }
    }
    const A = p[0], B = p[1], R = Math.exp(p[2]), meanY = pts.reduce((s, q) => s + q.y, 0) / n;
    let ssTot = 0, ssRes = 0;
    pts.forEach((q) => { ssTot += (q.y - meanY) ** 2; ssRes += (q.y - model(q.x, p)) ** 2; });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    let seR = null;
    const H = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < n; i++) {
        const x = pts[i].x, f0 = model(x, p), g = [];
        for (let j = 0; j < 3; j++) {
            const h = Math.max(1e-8, Math.abs(p[j]) * 1e-6), pp = p.slice(); pp[j] += h;
            g.push((model(x, pp) - f0) / h);
        }
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) H[a][b] += g[a] * g[b];
    }
    const det = H[0][0]*(H[1][1]*H[2][2] - H[1][2]*H[2][1]) - H[0][1]*(H[1][0]*H[2][2] - H[1][2]*H[2][0]) + H[0][2]*(H[1][0]*H[2][1] - H[1][1]*H[2][0]);
    if (Math.abs(det) > 1e-30) {
        const inv22 = (H[0][0]*H[1][1] - H[0][1]*H[1][0]) / det;
        const varLnR = inv22 * (ssRes / Math.max(1, n - 3));
        if (varLnR > 0) seR = R * Math.sqrt(varLnR);
    }
    return { A, B, R, T: 1 / R, r2, n, seR, modelType: 'inversion-recovery' };
}

/* ---------------------------------------------------------------------------
ERROR INPUT UI
--------------------------------------------------------------------------- */
export const ErrInput = ({ label, value, sdRaw, isOverridden, onSave, onReset }) => {
    const [tempVal, setTempVal] = useState(value !== undefined ? value : '');
    useEffect(() => { setTempVal(value !== undefined ? value : ''); }, [value]);
    return (
        <div className={`flex flex-col gap-1 p-1.5 rounded border ${isOverridden ? 'border-orange-400 bg-white' : 'border-slate-200 bg-white'}`}>
            <span className="text-[9px] font-bold text-slate-500 truncate w-14" title={label}>{label}</span>
            <div className="flex gap-1 items-center">
                <input type="number" step="0.01" value={tempVal} onChange={(e) => setTempVal(e.target.value)} onBlur={() => onSave(parseFloat(tempVal) || 0)} className="w-12 text-xs border border-slate-300 rounded p-0.5 outline-none focus:border-orange-500 text-center" />
                {isOverridden && ( <button onClick={onReset} className="text-red-500 hover:text-red-700 font-bold" title="Reset to calculated error">×</button>)}
            </div>
        </div>
    );
};

/* ---------------------------------------------------------------------------
CHARTS — FULL WIDTH (not side by side)
--------------------------------------------------------------------------- */
function DecayChart({ table, colFits, chartCfg, isFs, onToggleFs, chartType = 'line' }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const ds = [];
        const isHist = chartType === 'hist';

        for (let c = 0; c < table.nCols; c++) {
            const color = toHex(PALETTE[c % PALETTE.length]);
            const pts = [];
            for (let r = 0; r < table.nRows; r++) {
                const x = table.delays[r], y = parseFloat(table.grid[r]?.[c]);
                if (isFinite(x) && isFinite(y)) pts.push({ x, y });
            }
            if (pts.length === 0) continue;

            if (isHist) {
                // Histogram: show fitted parameter values as bars
                const fit = colFits[c]?.fit;
                if (fit) {
                    ds.push({ label: table.colResidues[c] || `Col ${c + 1}`, data: [{ x: c, y: fit.R_s }], type: 'bar', backgroundColor: color + '99', borderColor: color, borderWidth: 1 });
                }
            } else {
                ds.push({ label: table.colResidues[c] || `Col ${c + 1}`, data: pts, showLine: false, pointRadius: chartCfg.ptSize, pointStyle: chartCfg.ptStyle, backgroundColor: color, borderColor: color, type: 'scatter' });
                const fit = colFits[c]?.fit;
                if (fit && pts.length >= 2) {
                    const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
                    for (let i = 0; i <= 60; i++) {
                        const x = xmin + ((xmax - xmin) * i) / 60;
                        let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
                        curve.push({ x, y: yVal });
                    }
                    let borderDash = [];
                    if (chartCfg.lineStyle === 'dashed') borderDash = [5, 5];
                    if (chartCfg.lineStyle === 'dotted') borderDash = [2, 3];
                    ds.push({ label: `${table.colResidues[c] || `Col ${c + 1}`} fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: chartCfg.lineThickness, borderDash, type: 'line', tension: 0.25 });
                }
            }
        }
        if (chartRef.current) chartRef.current.destroy();
        const xLabel = isHist ? 'Residue' : (table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`);
        chartRef.current = new Chart(ref.current, {
            type: isHist ? 'bar' : 'scatter',
            data: isHist ? { labels: ds.map(d => d.label), datasets: [{ label: `Rate (${table.relaxType === 'T1' ? 'R1' : table.relaxType === 'DOSY' ? 'D' : 'R2'})`, data: ds.map(d => d.data[0].y), backgroundColor: ds.map(d => d.backgroundColor), borderColor: ds.map(d => d.borderColor), borderWidth: 1 }] } : { datasets: ds },
            plugins: errBarPlugin ? [errBarPlugin] : [],
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: isHist ? 'category' : 'linear', position: chartCfg.xPos, min: !isHist && chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined, max: !isHist && chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined, title: { display: true, text: xLabel, font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: true, text: isHist ? `Rate (${table.relaxType === 'T1' ? 'R1' : table.relaxType === 'DOSY' ? 'D' : 'R2'})` : 'Intensity / Volume', font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                },
                plugins: { legend: { display: !isHist, labels: { font: { size: chartCfg.fontSize } } } }
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colFits, chartCfg, chartType]);
    return (
        <div className={`flex flex-col ${isFs ? FS_CLASSES + ' p-6' : 'relative h-[350px]'}`}>
            <div className="flex justify-between items-start mb-2 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">Decay / Diffusion curves</h4>
                <button onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">{isFs ? '↙️' : '↗️'}</button>
            </div>
            <div className="flex-1 relative min-h-0"> <canvas ref={ref} /> </div>
        </div>
    );
}

function ParameterChart({ table, colFits, chartCfg, isFs, onToggleFs, chartType = 'bar' }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current || !colFits.some(cf => cf.fit)) return;
        const labels = []; const data = []; const colors = []; const ebars = [];
        colFits.forEach((cf, i) => {
            if (!cf.fit) return;
            labels.push(cf.residue || `Col ${i+1}`);
            data.push(cf.fit.R_s);
            colors.push(toHex(PALETTE[i % PALETTE.length]));
            const err = cf.effectiveError || cf.fit.seR_s || 0;
            ebars.push({ plus: err, minus: err });
        });
        if (chartRef.current) chartRef.current.destroy();
        const yLabel = table.relaxType === 'DOSY' ? 'Diffusion Rate (D)' : `Rate (${table.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹`;
        chartRef.current = new Chart(ref.current, {
            type: chartType === 'hist' ? 'bar' : 'bar',
            data: { labels, datasets: [{ label: yLabel, data, backgroundColor: colors, borderColor: colors, borderWidth: 1, errorBars: ebars }] },
            plugins: errBarPlugin ? [errBarPlugin] : [],
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: true, text: yLabel, font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } },
                    x: { position: chartCfg.xPos, title: { display: true, text: 'Residue / Atom', font: { size: chartCfg.fontSize + 2 } }, ticks: { font: { size: chartCfg.fontSize } } }
                },
                plugins: { legend: { display: false } }
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colFits, chartCfg, chartType]);
    return (
        <div className={`flex flex-col ${isFs ? FS_CLASSES + ' p-6' : 'relative h-[350px]'}`}>
            <div className="flex justify-between items-start mb-2 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">Parameter vs Atom</h4>
                <button onClick={onToggleFs} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">{isFs ? '↙️' : '↗️'}</button>
            </div>
            <div className="flex-1 relative min-h-0"> <canvas ref={ref} /> </div>
        </div>
    );
}

function IndividualDecayChart({ table, colIndex, colFit, chartCfg, isFs, onToggleFs }) {
    const ref = useRef(null); const chartRef = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const color = toHex(PALETTE[colIndex % PALETTE.length]);
        const pts = [];
        for (let r = 0; r < table.nRows; r++) {
            const x = table.delays[r], y = parseFloat(table.grid[r]?.[colIndex]);
            if (isFinite(x) && isFinite(y)) pts.push({ x, y });
        }
        if (pts.length === 0) return;
        const ds = [];
        ds.push({ label: 'Data', data: pts, showLine: false, pointRadius: chartCfg.ptSize, pointStyle: chartCfg.ptStyle, backgroundColor: color, borderColor: color, type: 'scatter' });
        const fit = colFit?.fit;
        if (fit && pts.length >= 2) {
            const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
            for (let i = 0; i <= 60; i++) {
                const x = xmin + ((xmax - xmin) * i) / 60;
                let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
                curve.push({ x, y: yVal });
            }
            let borderDash = [];
            if (chartCfg.lineStyle === 'dashed') borderDash = [5, 5];
            if (chartCfg.lineStyle === 'dotted') borderDash = [2, 3];
            ds.push({ label: `Fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: chartCfg.lineThickness, borderDash, type: 'line', tension: 0.25 });
        }
        if (chartRef.current) chartRef.current.destroy();
        chartRef.current = new Chart(ref.current, {
            type: 'scatter', data: { datasets: ds },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { type: 'linear', position: chartCfg.xPos, min: chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined, max: chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined, title: { display: isFs, text: chartCfg.xAxisLabel || (table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`), font: { size: chartCfg.fontSize + 2 } }, ticks: { display: isFs, font: { size: chartCfg.fontSize } } },
                    y: { position: chartCfg.yPos, min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined, max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined, title: { display: isFs, text: 'Intensity / Volume', font: { size: chartCfg.fontSize + 2 } }, ticks: { display: isFs, font: { size: chartCfg.fontSize } } },
                },
                plugins: { legend: { display: false }, tooltip: { enabled: true } },
                interaction: { mode: 'nearest', intersect: true },
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [table, colIndex, colFit, chartCfg, isFs]);
    const residueName = table.colResidues[colIndex] || `Col ${colIndex + 1}`;
    return (
        <div className={`flex flex-col bg-white ${isFs ? FS_CLASSES + ' p-6' : 'relative aspect-square p-2 cursor-pointer hover:shadow-lg transition-shadow border border-slate-200 rounded-lg group'}`} onClick={!isFs ? onToggleFs : undefined}>
            <div className="flex justify-between items-start mb-1 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase">{residueName}</h4>
                {!isFs && <button className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1 transition-all text-[10px]">↗️</button>}
                {isFs && <button onClick={(e) => { e.stopPropagation(); onToggleFs(); }} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print">↙️</button>}
            </div>
            <div className={`flex-1 relative min-h-0 ${!isFs ? 'pointer-events-none' : ''}`}> <canvas ref={ref} /> </div>
        </div>
    );
}

const makeTable = (overrides = {}) => ({
    id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    atom: 'HN', relaxType: 'T2', delayUnit: 'ms', nRows: 6, nCols: 4,
    delays: [0, 50, 100, 200, 400, 800], colResidues: ['', '', '', ''],
    grid: Array.from({ length: 6 }, () => new Array(4).fill('')), ...overrides,
});

/* ---------------------------------------------------------------------------
SIMULATION SECTION
--------------------------------------------------------------------------- */
function SimulationSection({ sim, setSim, solvents = [], activeTest }) {
    const [simType, setSimType] = useState('diffusion');
    const solventName = activeTest?.solvent || '';
    const temperature = parseFloat(activeTest?.temperature) || 298;

    // Default viscosity for common solvents (Pa·s at ~25°C)
    const SOLVENT_VISCOSITY = {
        'H2O': 0.89e-3, 'D2O': 1.107e-3, 'DMSO': 1.996e-3, 'DMSO-d6': 1.996e-3,
        'methanol': 0.544e-3, 'ethanol': 1.074e-3, 'chloroform': 0.538e-3,
        'acetone': 0.306e-3, 'benzene': 0.604e-3, 'toluene': 0.560e-3,
    };

    const viscosity = sim.viscosity || SOLVENT_VISCOSITY[solventName] || 0.89e-3;
    const T_K = temperature > 100 ? temperature : temperature + 273.15; // assume °C if < 100

    // Diffusion coefficient simulation
    const MW = sim.MW || 12000;
    const shape = sim.shape || 'sphere'; // sphere, rod, disc
    const shapeFactor = shape === 'sphere' ? 1 : shape === 'rod' ? 1.3 : 1.15; // approximate correction
    const r_m = radiusFromMW(MW, sim.vbar || 0.73, sim.hydration || 0.3) * shapeFactor;
    const D_calc = stokesEinsteinD(T_K, viscosity, r_m);
    const tau_c_calc = tauFromMW(MW, viscosity, T_K, sim.vbar || 0.73, sim.hydration || 0.3);

    // Nuclear relaxation simulation
    const nucleus = sim.nucleus || '15N';
    const fieldMHz = sim.fieldMHz || 600;
    const rates = modelFreeRates({
        nucleus, fieldMHz,
        tau_c_ns: (tau_c_calc * 1e9) || (sim.tau_c_ns || 5),
        S2: sim.S2 || 0.85,
        useInternal: sim.useInternal || false,
        tau_e_ps: sim.tau_e_ps || 50,
        r_A: sim.r_A || DEFAULT_DIST[nucleus] || 1.02,
        csa_ppm: sim.csa_ppm ?? DEFAULT_CSA[nucleus] ?? -160,
    });

    return (
        <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}>
            <div className="flex flex-col gap-4">
                <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={() => setSimType('diffusion')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'diffusion' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>💧 Diffusion Coefficient</button>
                    <button type="button" onClick={() => setSimType('relaxation')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${simType === 'relaxation' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>🔄 Nuclear Relaxation</button>
                </div>

                {simType === 'diffusion' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Molecular Weight (Da)</label>
                                <input type="number" value={sim.MW || 12000} onChange={(e) => setSim({ MW: parseFloat(e.target.value) || 12000 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temperature (K)</label>
                                <input type="number" value={T_K.toFixed(1)} onChange={(e) => setSim({ temperature: parseFloat(e.target.value) || 298 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Viscosity (Pa·s)</label>
                                <input type="number" step="0.001e-3" value={viscosity} onChange={(e) => setSim({ viscosity: parseFloat(e.target.value) || 0.89e-3 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Shape</label>
                                <select value={sim.shape || 'sphere'} onChange={(e) => setSim({ shape: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                    <option value="sphere">Sphere</option>
                                    <option value="rod">Rod (elongated)</option>
                                    <option value="disc">Disc (flat)</option>
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
                        <div className="md:col-span-2 flex flex-col gap-3">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <h4 className="text-xs font-black text-blue-800 uppercase mb-3">Stokes-Einstein Diffusion Coefficient</h4>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div><span className="font-bold text-slate-600">Hydrodynamic radius:</span> <span className="font-mono text-blue-700">{(r_m * 1e9).toFixed(2)} nm</span></div>
                                    <div><span className="font-bold text-slate-600">Diffusion coefficient D:</span> <span className="font-mono text-blue-700">{D_calc.toExponential(3)} m²/s</span></div>
                                    <div><span className="font-bold text-slate-600">D (×10⁻¹¹ m²/s):</span> <span className="font-mono text-blue-700">{(D_calc * 1e11).toFixed(2)}</span></div>
                                    <div><span className="font-bold text-slate-600">Rotational τc:</span> <span className="font-mono text-blue-700">{(tau_c_calc * 1e9).toFixed(2)} ns</span></div>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-3 italic">D = k_B·T / (6π·η·r_h) — Stokes-Einstein equation. Shape correction factor: {shapeFactor.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                )}

                {simType === 'relaxation' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nucleus</label>
                                <select value={sim.nucleus || '15N'} onChange={(e) => setSim({ nucleus: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                    <option value="15N">¹⁵N</option>
                                    <option value="13C">¹³C</option>
                                    <option value="1H">¹H</option>
                                    <option value="31P">³¹P</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Field (MHz)</label>
                                <input type="number" value={sim.fieldMHz || 600} onChange={(e) => setSim({ fieldMHz: parseFloat(e.target.value) || 600 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">τc (ns)</label>
                                <input type="number" step="0.1" value={sim.tau_c_ns || (tau_c_calc * 1e9).toFixed(1)} onChange={(e) => setSim({ tau_c_ns: parseFloat(e.target.value) || 5 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">S² (order parameter)</label>
                                <input type="number" step="0.01" min="0" max="1" value={sim.S2 || 0.85} onChange={(e) => setSim({ S2: parseFloat(e.target.value) || 0.85 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bond length r (Å)</label>
                                <input type="number" step="0.01" value={sim.r_A || DEFAULT_DIST[sim.nucleus || '15N'] || 1.02} onChange={(e) => setSim({ r_A: parseFloat(e.target.value) || 1.02 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">CSA (ppm)</label>
                                <input type="number" step="1" value={sim.csa_ppm ?? DEFAULT_CSA[sim.nucleus || '15N'] ?? -160} onChange={(e) => setSim({ csa_ppm: parseFloat(e.target.value) || -160 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                            </div>
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                <input type="checkbox" checked={sim.useInternal || false} onChange={(e) => setSim({ useInternal: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Use internal motion (τe)
                            </label>
                            {sim.useInternal && (
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">τe (ps)</label>
                                    <input type="number" step="1" value={sim.tau_e_ps || 50} onChange={(e) => setSim({ tau_e_ps: parseFloat(e.target.value) || 50 })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                                </div>
                            )}
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-3">
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                                <h4 className="text-xs font-black text-emerald-800 uppercase mb-3">Model-Free Relaxation Rates</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                    <div><span className="font-bold text-slate-600">R1 (s⁻¹):</span> <span className="font-mono text-emerald-700">{rates.R1.toFixed(3)}</span></div>
                                    <div><span className="font-bold text-slate-600">R2 (s⁻¹):</span> <span className="font-mono text-emerald-700">{rates.R2.toFixed(3)}</span></div>
                                    <div><span className="font-bold text-slate-600">NOE:</span> <span className="font-mono text-emerald-700">{rates.NOE.toFixed(3)}</span></div>
                                    <div><span className="font-bold text-slate-600">T1 (s):</span> <span className="font-mono text-emerald-700">{rates.T1 === Infinity ? '∞' : rates.T1.toFixed(3)}</span></div>
                                    <div><span className="font-bold text-slate-600">T2 (s):</span> <span className="font-mono text-emerald-700">{rates.T2 === Infinity ? '∞' : rates.T2.toFixed(3)}</span></div>
                                    <div><span className="font-bold text-slate-600">R1/R2:</span> <span className="font-mono text-emerald-700">{rates.ratio.toFixed(3)}</span></div>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-3 italic">Model-free formalism: R1, R2, and heteronuclear NOE from dipolar + CSA relaxation mechanisms.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </CollapsibleSection>
    );
}

/* ========================================================================== */
export const NMRFittingsTestRenderer = ({ activeTest = {}, updateActiveTest, TestHeader, compoundMeta = {}, allCmpds = [], ...rest }) => {
    const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
    const tables = Array.isArray(activeTest.nmrTables) ? activeTest.nmrTables : [];
    const [fits, setFits] = useState(activeTest.savedFits || {});
    const [fsPanel, setFsPanel] = useState(null);
    const [showChartCfg, setShowChartCfg] = useState(false);
    const [chartType, setChartType] = useState('line'); // 'line' or 'hist'
    const manualErrors = activeTest.manualErrors || {};
    const chartCfg = { yMin: '', yMax: '', xMin: '', xMax: '', ptStyle: 'circle', ptSize: 5, fontSize: 12, xPos: 'bottom', yPos: 'left', xAxisLabel: '', lineStyle: 'solid', lineThickness: 2, ...(activeTest.chartCfg || {}) };

    useEffect(() => { if (!Array.isArray(activeTest.nmrTables) || activeTest.nmrTables.length === 0) update({ nmrTables: [makeTable()] }); }, []);

    const sim = { nucleus: '15N', fieldMHz: 600, tau_c_ns: 5, S2: 0.85, useInternal: false, tau_e_ps: 50, r_A: 1.02, csa_ppm: -160, temperature: 298, viscosity: 0.89e-3, vbar: 0.73, hydration: 0.3, MW: 12000, shape: 'sphere', ...(activeTest.sim || {}) };
    const setSim = (patch) => update({ sim: { ...sim, ...patch } });

    const updateTable = (id, patch) => update({ nmrTables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    const setCell = (t, r, c, v) => { const g = t.grid.map((row) => row.slice()); while (g.length < t.nRows) g.push(new Array(t.nCols).fill('')); while (g[r].length < t.nCols) g[r].push(''); g[r][c] = v; updateTable(t.id, { grid: g }); };
    const setDelay = (t, r, v) => { const d = t.delays.slice(); d[r] = v; updateTable(t.id, { delays: d }); };
    const setColResidue = (t, c, v) => { const cr = t.colResidues.slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };
    const addRow = (t) => { const last = t.delays.length ? Number(t.delays[t.delays.length - 1]) || 0 : 0; updateTable(t.id, { nRows: t.nRows + 1, delays: [...t.delays, last], grid: [...t.grid.map((r) => r.slice()), new Array(t.nCols).fill('')] }); };
    const removeRow = (t, r) => { if (t.nRows <= 1) return; updateTable(t.id, { nRows: t.nRows - 1, delays: t.delays.filter((_, i) => i !== r), grid: t.grid.filter((_, i) => i !== r) }); };
    const addCol = (t) => { updateTable(t.id, { nCols: t.nCols + 1, colResidues: [...t.colResidues, ''], grid: t.grid.map((r) => [...r, '']) }); };
    const removeCol = (t, c) => { if (t.nCols <= 1) return; updateTable(t.id, { nCols: t.nCols - 1, colResidues: t.colResidues.filter((_, i) => i !== c), grid: t.grid.map((r) => r.filter((_, i) => i !== c)) }); };
    const addTable = () => update({ nmrTables: [...tables, makeTable()] });
    const duplicateTable = (t) => update({ nmrTables: [...tables, { ...t, id: 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), grid: t.grid.map((r) => r.slice()), delays: t.delays.slice(), colResidues: t.colResidues.slice() }] });
    const removeTable = (id) => {
        if (tables.length <= 1) { alert('Keep at least one table.'); return; }
        update({ nmrTables: tables.filter((t) => t.id !== id) });
        setFits((prev) => { const next = { ...prev }; delete next[id]; return next; });
    };

    const storeManualErr = (tId, res, val) => { const inner = { ...(manualErrors[tId] || {}) }; inner[res] = val; update({ manualErrors: { ...manualErrors, [tId]: inner } }); };
    const clearManualErr = (tId, res) => { const inner = { ...(manualErrors[tId] || {}) }; delete inner[res]; const next = { ...manualErrors }; if (Object.keys(inner).length === 0) delete next[tId]; else next[tId] = inner; update({ manualErrors: next }); };

    const runFitForTable = (t) => {
        const unit = t.delayUnit === 'ms' ? 1e-3 : 1; const cols = [];
        for (let c = 0; c < t.nCols; c++) {
            const xs = [], ys = [];
            for (let r = 0; r < t.nRows; r++) {
                const x = Number(t.delays[r]), y = parseFloat(t.grid[r]?.[c]);
                if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
            }
            let fit = null, fitS = null;
            if (t.relaxType === 'T1') fit = fitInversionRecovery(xs, ys); else fit = fitMonoExp(xs, ys);
            if (fit) {
                const R_s = fit.R / unit;
                fitS = { ...fit, R_s, T_s: R_s > 0 ? 1 / R_s : Infinity, seR_s: fit.seR != null ? fit.seR / unit : null };
            }
            cols.push({ residue: t.colResidues[c] || `Col ${c + 1}`, fit: fitS });
        }

        const nextFits = { ...fits, [t.id]: cols };
        setFits(nextFits);
        update({ savedFits: nextFits });
    };

    const exportFittedTable = (t, colFits) => {
        try {
            const wb = XLSX.utils.book_new();
            const aoa = [['Residue', `Rate (${t.relaxType === 'T1' ? 'R1' : t.relaxType === 'DOSY' ? 'D' : 'R2'}) s⁻¹`, t.relaxType !== 'DOSY' ? `${t.relaxType} (s)` : null, 'R²', 'N', 'Error'].filter(Boolean)];
            colFits.forEach(cf => {
                if (!cf.fit) return;
                const row = [cf.residue, cf.fit.R_s];
                if (t.relaxType !== 'DOSY') row.push(cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s);
                row.push(cf.fit.r2, cf.fit.n, cf.effectiveError || cf.fit.seR_s || 0);
                aoa.push(row.filter(Boolean));
            });
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            XLSX.utils.book_append_sheet(wb, ws, 'Fitted Parameters');
            XLSX.writeFile(wb, `NMR_Fitting_${t.relaxType}_${Date.now()}.xlsx`);
        } catch (e) { console.error(e); alert('Export failed: ' + e.message); }
    };

    const renderTable = (t, tIndex) => {
        const colFits = (fits[t.id] || []).map(cf => ({ ...cf, effectiveError: manualErrors[t.id]?.[cf.residue] ?? (cf.fit?.seR_s || 0) }));
        return (
            <CollapsibleSection key={t.id} title={`Table ${tIndex + 1} — ${t.atom || '…'} (${t.relaxType})`} icon="📈" defaultOpen={tIndex === 0}>
                <div className="flex flex-col gap-4">
                    {/* Dataset info row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Dataset Name</label>
                            <input type="text" value={t.datasetName || ''} onChange={(e) => updateTable(t.id, { datasetName: e.target.value })} placeholder="e.g. 15N_T2_relax" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Number</label>
                            <input type="text" value={t.expNumber || ''} onChange={(e) => updateTable(t.id, { expNumber: e.target.value })} placeholder="e.g. 42" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Link (URL)</label>
                            <input type="text" value={t.link || ''} onChange={(e) => updateTable(t.id, { link: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                        </div>
                    </div>

                    {/* Data table */}
                    <div className="overflow-auto border border-slate-300 rounded-lg bg-white shadow-inner">
                        <table className="border-collapse text-xs w-full">
                            <thead>
                                <tr>
                                    <th className="bg-slate-200 border border-slate-300 p-1 sticky top-0 left-0 z-20 text-slate-600">{t.relaxType === 'DOSY' ? 'b-value / G²' : 'Delay'} ({t.delayUnit})</th>
                                    {Array.from({ length: t.nCols }, (_, c) => (
                                        <th key={c} className="bg-slate-100 border border-slate-300 p-1 min-w-[110px] sticky top-0 z-10 group relative">
                                            <div className="flex flex-col gap-1 w-full relative">
                                                <input value={t.colResidues[c] || ''} onChange={(e) => setColResidue(t, c, e.target.value)} placeholder="residue" className="w-full text-center border border-slate-300 rounded p-1 text-[11px] font-bold text-blue-800" />
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
                                                <input type="number" step="any" value={t.delays[r]} onChange={(e) => setDelay(t, r, e.target.value === '' ? '' : Number(e.target.value))} className="w-16 text-center border border-slate-300 rounded p-1 text-[11px] font-mono" />
                                                <button onClick={() => removeRow(t, r)} className="text-red-400 hover:text-red-600 text-[11px] font-bold ml-1 px-1" title="Delete Row">✕</button>
                                            </div>
                                        </td>
                                        {Array.from({ length: t.nCols }, (_, c) => (
                                            <td key={c} className="border border-slate-200 p-0"><input value={t.grid[r]?.[c] ?? ''} onChange={(e) => setCell(t, r, c, e.target.value)} className="w-full h-8 text-center outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 font-mono text-[11px]" /></td>
                                        ))}
                                        <td className="border border-slate-100 p-0.5 text-center text-slate-300 bg-slate-50">·</td>
                                    </tr>
                                ))}
                                <tr><td colSpan={t.nCols + 2} className="bg-slate-50 border border-slate-200 p-2"><button onClick={() => addRow(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] w-full text-left pl-2">+ Add Delay Row</button></td></tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Data Analysis subsection — Observed atom, Experiment Type, Delay unit, Fit button under the table */}
                    <CollapsibleSection title="Data Analysis" icon="📐" defaultOpen={false}>
                        <div className="flex flex-col gap-4">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Observed atom</label>
                                    <input type="text" value={t.atom || 'HN'} onChange={(e) => updateTable(t.id, { atom: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" placeholder="HN" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Type</label>
                                    <select value={t.relaxType} onChange={(e) => updateTable(t.id, { relaxType: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                        <option value="T1">T1 (Inversion Recovery)</option>
                                        <option value="T2">T2 / T1rho (Exponential)</option>
                                        <option value="DOSY">DOSY (Diffusion)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{t.relaxType === 'DOSY' ? 'X Unit' : 'Delay unit'}</label>
                                    <select value={t.delayUnit} onChange={(e) => updateTable(t.id, { delayUnit: e.target.value })} className="w-full border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500">
                                        <option value="ms">ms</option> <option value="s">s</option>{t.relaxType === 'DOSY' && <option value="s/mm2">s/mm²</option>}
                                    </select>
                                </div>
                                <div className="flex items-end gap-2">
                                    <button onClick={() => runFitForTable(t)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 w-full rounded-md shadow-sm transition-colors">▶️ Compute Fit</button>
                                </div>
                                <div className="flex items-end gap-2">
                                    <button onClick={() => duplicateTable(t)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold px-3 py-2 w-full rounded-md transition-colors">♻️ Duplicate</button>
                                </div>
                            </div>
                            
                            <div className="flex justify-end pt-2 border-t border-slate-100">
                               <button onClick={() => removeTable(t.id)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-md shadow-sm flex items-center gap-2 transition-colors">🗑️ Delete Entire Table</button>
                            </div>

                            {/* Chart type selector */}
                            <div className="flex items-center gap-3">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Chart Type:</label>
                                <select value={chartType} onChange={(e) => setChartType(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white outline-none focus:border-blue-500">
                                    <option value="line">Line / Scatter</option>
                                    <option value="hist">Histogram</option>
                                </select>
                            </div>

                            {/* Fitted results table — expandable and exportable */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-bold text-slate-600 uppercase">Fitted {t.relaxType} per residue</h4>
                                    <button onClick={() => exportFittedTable(t, colFits)} className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded shadow-sm">📊 Export XLS</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="text-xs border border-slate-200 rounded w-full">
                                        <thead>
                                            <tr className="bg-slate-100 text-slate-600">
                                                <th className="p-1.5 border border-slate-200">Residue</th>
                                                <th className="p-1.5 border border-slate-200">{t.relaxType === 'DOSY' ? 'D (Diff. Rate)' : `R (${t.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹`}</th>
                                                {t.relaxType !== 'DOSY' && <th className="p-1.5 border border-slate-200">{t.relaxType} (s)</th>}
                                                <th className="p-1.5 border border-slate-200">R²</th><th className="p-1.5 border border-slate-200">N</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {colFits.length === 0 ? (<tr><td colSpan={5} className="p-3 text-center text-slate-400">Click "Compute Fit" to calculate parameters.</td></tr>) : (
                                                colFits.map((cf, i) => (
                                                    <tr key={i} className="text-center">
                                                        <td className="p-1.5 border border-slate-200 font-bold text-blue-800">{cf.residue}</td>
                                                        <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? (t.relaxType === 'DOSY' ? cf.fit.R_s.toExponential(3) : cf.fit.R_s.toFixed(3)) + (cf.effectiveError ? ` ± ${cf.effectiveError.toExponential(2)}` : '') : '—'}</td>
                                                        {t.relaxType !== 'DOSY' && (<td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? (cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s.toFixed(3)) : '—'}</td>)}
                                                        <td className="p-1.5 border border-slate-200 font-mono">{cf.fit ? cf.fit.r2.toFixed(3) : '—'}</td>
                                                        <td className="p-1.5 border border-slate-200">{cf.fit ? cf.fit.n : 0}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Error Management Panel per Table */}
                            {colFits.some(cf => cf.fit) && (
                                <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm">
                                    <h4 className="text-xs font-black text-orange-800 uppercase mb-3 border-b border-orange-100 pb-2">Manual SD Overrides (Parameter Err)</h4>
                                    <div className="flex flex-wrap gap-3">
                                        {colFits.filter(cf => cf.fit).map(cf => {
                                            const isOverridden = typeof manualErrors[t.id]?.[cf.residue] === 'number';
                                            return (
                                                <ErrInput
                                                    key={cf.residue}
                                                    label={cf.residue}
                                                    value={isOverridden ? manualErrors[t.id][cf.residue] : cf.fit.seR_s}
                                                    sdRaw={cf.fit.seR_s}
                                                    isOverridden={isOverridden}
                                                    onSave={(v) => storeManualErr(t.id, cf.residue, v)}
                                                    onReset={() => clearManualErr(t.id, cf.residue)}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Charts — FULL WIDTH, one per line */}
                            <div className="flex flex-col gap-4 relative">
                                {fsPanel === `decay_${t.id}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                                <div className={`border border-slate-200 rounded-lg bg-white ${fsPanel === `decay_${t.id}` ? 'z-[999999]' : 'p-3'}`}>
                                    <DecayChart table={t} colFits={colFits} chartCfg={chartCfg} isFs={fsPanel === `decay_${t.id}`} onToggleFs={() => setFsPanel(fsPanel === `decay_${t.id}` ? null : `decay_${t.id}`)} chartType={chartType} />
                                </div>

                                {fsPanel === `param_${t.id}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                                <div className={`border border-slate-200 rounded-lg bg-white ${fsPanel === `param_${t.id}` ? 'z-[999999]' : 'p-3'}`}>
                                    <ParameterChart table={t} colFits={colFits} chartCfg={chartCfg} isFs={fsPanel === `param_${t.id}`} onToggleFs={() => setFsPanel(fsPanel === `param_${t.id}` ? null : `param_${t.id}`)} chartType={chartType} />
                                </div>
                            </div>

                            {/* Individual Fittings Panel */}
                            {colFits.length > 0 && (
                                <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                                    <h4 className="text-xs font-black text-slate-700 uppercase mb-3 border-b border-slate-200 pb-2">Individual Fittings</h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                                        {colFits.map((cf, c) => (
                                            <React.Fragment key={c}>
                                                {fsPanel === `indiv_${t.id}_${c}` && <div className={OVERLAY_CLASSES} onClick={() => setFsPanel(null)}></div>}
                                                <IndividualDecayChart
                                                    table={t}
                                                    colIndex={c}
                                                    colFit={cf}
                                                    chartCfg={chartCfg}
                                                    isFs={fsPanel === `indiv_${t.id}_${c}`}
                                                    onToggleFs={() => setFsPanel(fsPanel === `indiv_${t.id}_${c}` ? null : `indiv_${t.id}_${c}`)}
                                                />
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </CollapsibleSection>
                </div>
            </CollapsibleSection>
        );
    };

    /* ---------------------------------------------------------------------------
    EXPERIMENT SETUP — Dataset name, experiment number, link (no target molecule)
    --------------------------------------------------------------------------- */
    const SetupSection = () => (
        <CollapsibleSection title="Experiment Setup" icon="🧭" defaultOpen={true}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">NMR Dataset Name</label>
                    <input type="text" value={activeTest.nmrDatasetName || ''} onChange={(e) => update({ nmrDatasetName: e.target.value })} placeholder="e.g. 15N_T2_relax_series" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Experiment Number</label>
                    <input type="text" value={activeTest.nmrExpNumber || ''} onChange={(e) => update({ nmrExpNumber: e.target.value })} placeholder="e.g. 42" className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Link (URL)</label>
                    <input type="text" value={activeTest.nmrLink || ''} onChange={(e) => update({ nmrLink: e.target.value })} placeholder="https://..." className="w-full border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                </div>
            </div>
        </CollapsibleSection>
    );

    /* ---------------------------------------------------------------------------
    CHART CONFIG SECTION (Refactored to use modular SharedGraphConfig)
    --------------------------------------------------------------------------- */
    const FittingSection = () => (
        <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
            <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                    <button onClick={() => setShowChartCfg(!showChartCfg)} className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ${showChartCfg ? 'bg-slate-200 border border-slate-400 text-slate-900' : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'}`}>
                        ⚙️ Chart Config
                    </button>
                </div>
                {showChartCfg && (
                    <SharedGraphConfig 
                        activeTest={activeTest}
                        updateActiveTest={update}
                        showLayoutOptions={false}
                    />
                )}
            </div>
        </CollapsibleSection>
    );

    const DataSection = () => (
        <CollapsibleSection title="Data" icon="📊" defaultOpen={true}>
            <div className="flex flex-col gap-6">
                {tables.map((t, i) => renderTable(t, i))}
                <button onClick={addTable} className="self-start text-sm bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-sm">+ Add relaxation table</button>
            </div>
        </CollapsibleSection>
    );

    return (
        <TestShellRenderer
            config={NMR_FITTING_TAB_CONFIG}
            custom={{
                Setup: SetupSection,
                Data: DataSection,
                Fitting: FittingSection,
                InstrumentalSetup: NMRInstrumentalSetup,
                Simulations: () => <SimulationSection sim={sim} setSim={setSim} solvents={rest.solvents || []} activeTest={activeTest} />,
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

export default NMRFittingsTestRenderer;
