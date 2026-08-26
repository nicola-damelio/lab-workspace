/* =========================================================================
   DOSYTestRenderer.jsx
   New test page "DOSY" — same structure as NMR Fittings:
     • Experiment Setup   (dataset name / experiment number / link)
     • Data               (per-table data grids, paste from Excel)
     • Data Analysis      (Stejskal-Tanner DOSY fitter + fitted results)
     • Simulations        (diffusion coefficient, Stokes–Einstein)
   ========================================================================= */
import React, { useState, useEffect } from 'react';
import TestShellRenderer, { CollapsibleSection } from './TestShellRenderer';
import { DOSY_TAB_CONFIG } from './tabConfigs';
import { NMRInstrumentalSetup } from './NMRInstrumentalSetup';
import { makeTable, stokesEinsteinD, radiusFromMW } from './NMRFittingsTestRenderer';
import { enableCellClipboard, cellAttrs } from '../utils/cellClipboard';
import ST_DOSY_HTML from './stejskalTanner.html?raw';

enableCellClipboard(); // global multi-cell select / copy / paste for data tables

// Stejskal-Tanner fit: I = I0 · exp(−b·D). Linear regression on ln(I) vs b → D = −slope.
const fitStejskalTanner = (xs, ys) => {
    const pts = xs
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
};

const DOSYSetupSection = ({ ctx }) => {
    const activeTest = ctx.activeTest || {};
    const update = (u) => { if (ctx.updateActiveTest) ctx.updateActiveTest(u); };
    return (
        <CollapsibleSection title="Experiment Setup" icon="🧭" defaultOpen={false}>
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
        </CollapsibleSection>
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

const DOSYFittingSection = ({ ctx }) => {
    const tables = Array.isArray(ctx.activeTest?.dosyTables) ? ctx.activeTest.dosyTables : [];
    return (
        <div className="flex flex-col gap-6">
            <div className="w-full bg-blue-50 border-2 border-dashed border-blue-300 rounded-xl px-4 py-3 text-center">
                <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Stejskal-Tanner Equation</span>
                <div className="text-lg font-semibold text-slate-800 mt-1 whitespace-nowrap overflow-x-auto">
                    I<sub>G</sub> = I<sub>G=0</sub>·exp[ −(γ·δ·G)<sup>2</sup>·D·(Δ − δ/3) ] + C
                </div>
            </div>
            {tables.map((t, i) => (dosySections.renderAnalysis ? dosySections.renderAnalysis(t, i) : null))}
            <div className="w-full border border-slate-300 rounded-lg overflow-hidden bg-slate-50" style={{ height: '960px' }}>
                <iframe srcDoc={ST_DOSY_HTML} className="w-full h-full border-0" title="Stejskal-Tanner DOSY Fitter" />
            </div>
        </div>
    );
};

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
        <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}>
            <div className="flex flex-col gap-4">
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
            </div>
        </CollapsibleSection>
    );
};


/* ========================================================================== */
export const DOSYTestRenderer = ({ activeTest = {}, updateActiveTest, TestHeader, compoundMeta = {}, allCmpds = [], ...rest }) => {
    const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
    const tables = Array.isArray(activeTest.dosyTables) ? activeTest.dosyTables : [];
    const [fits, setFits] = useState(activeTest.dosyFits || {});

    useEffect(() => { if (!Array.isArray(activeTest.dosyTables) || activeTest.dosyTables.length === 0) update({ dosyTables: [makeTable({ relaxType: 'DOSY', delayUnit: 's/mm2' })] }); }, []);

    const sim = { MW: 12000, shape: 'sphere', vbar: 0.73, hydration: 0.3, viscosity: 0.89e-3, ...(activeTest.dosySim || {}) };
    const setSim = (patch) => update({ dosySim: { ...sim, ...patch } });

    const updateTable = (id, patch) => update({ dosyTables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    const setCell = (t, r, c, v) => { const g = t.grid.map((row) => row.slice()); while (g.length < t.nRows) g.push(new Array(t.nCols).fill('')); while (g[r].length < t.nCols) g[r].push(''); g[r][c] = v; updateTable(t.id, { grid: g }); };
    const setDelay = (t, r, v) => { const d = t.delays.slice(); d[r] = v; updateTable(t.id, { delays: d }); };
    const setColResidue = (t, c, v) => { const cr = t.colResidues.slice(); cr[c] = v; updateTable(t.id, { colResidues: cr }); };
    const addRow = (t) => { const last = t.delays.length ? Number(t.delays[t.delays.length - 1]) || 0 : 0; updateTable(t.id, { nRows: t.nRows + 1, delays: [...t.delays, last], grid: [...t.grid.map((r) => r.slice()), new Array(t.nCols).fill('')] }); };
    const removeRow = (t, r) => { if (t.nRows <= 1) return; updateTable(t.id, { nRows: t.nRows - 1, delays: t.delays.filter((_, i) => i !== r), grid: t.grid.filter((_, i) => i !== r) }); };
    const addCol = (t) => { updateTable(t.id, { nCols: t.nCols + 1, colResidues: [...t.colResidues, ''], grid: t.grid.map((r) => [...r, '']) }); };
    const removeCol = (t, c) => { if (t.nCols <= 1) return; updateTable(t.id, { nCols: t.nCols - 1, colResidues: t.colResidues.filter((_, i) => i !== c), grid: t.grid.map((r) => r.filter((_, i) => i !== c)) }); };
    const addTable = () => update({ dosyTables: [...tables, makeTable({ relaxType: 'DOSY', delayUnit: 's/mm2' })] });
    const removeTable = (id) => { if (tables.length <= 1) { alert('Keep at least one gradient set.'); return; } update({ dosyTables: tables.filter((t) => t.id !== id) }); };

    const runFitForTable = (t) => {
        const cols = [];
        for (let c = 0; c < t.nCols; c++) {
            const xs = [], ys = [];
            for (let r = 0; r < t.nRows; r++) {
                const x = Number(t.delays[r]), y = parseFloat(t.grid[r]?.[c]);
                if (isFinite(x) && isFinite(y) && x > 0 && y > 0) { xs.push(x); ys.push(y); }
            }
            cols.push({ residue: t.colResidues[c] || `Col ${c + 1}`, fit: fitStejskalTanner(xs, ys) });
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
                                <th className="bg-slate-200 border border-slate-300 p-1 sticky top-0 left-0 z-20 text-slate-600">b-value / G² ({t.delayUnit})</th>
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
                                            <input type="number" step="any" value={t.delays[r]} {...cellAttrs(r, -1)} onChange={(e) => setDelay(t, r, e.target.value === '' ? '' : Number(e.target.value))} className="w-16 text-center border border-slate-300 rounded p-1 text-[11px] font-mono" />
                                            <button onClick={() => removeRow(t, r)} className="text-red-400 hover:text-red-600 text-[11px] font-bold ml-1 px-1" title="Delete Row">✕</button>
                                        </div>
                                    </td>
                                    {Array.from({ length: t.nCols }, (_, c) => (
                                        <td key={c} className="border border-slate-200 p-0"><input value={t.grid[r]?.[c] ?? ''} {...cellAttrs(r, c)} onChange={(e) => setCell(t, r, c, e.target.value)} className="w-full h-8 text-center outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-400 font-mono text-[11px]" /></td>
                                    ))}
                                    <td className="border border-slate-100 p-0.5 text-center text-slate-300 bg-slate-50">·</td>
                                </tr>
                            ))}
                            <tr><td colSpan={t.nCols + 2} className="bg-slate-50 border border-slate-200 p-2"><button onClick={() => addRow(t)} className="text-blue-600 hover:text-blue-800 font-bold text-[11px] w-full text-left pl-2">+ Add b-value Row</button></td></tr>
                        </tbody>
                    </table>
                </div>
                <p className="text-[10px] text-slate-400 italic -mt-2">🖱️ Drag or Shift+click to select multiple cells · Ctrl/Cmd+C copy · Ctrl/Cmd+V paste (Excel-compatible, tab-separated)</p>
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
                InstrumentalSetup: NMRInstrumentalSetup,
                Simulations: DOSYSimulationsSection,
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

