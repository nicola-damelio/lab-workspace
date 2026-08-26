/* ============================================================================
   src/components/notebookPreviews.jsx
   Notebook data-analysis graph previews + the NOTEBOOK_ANALYSIS_PREVIEWS
   registry, extracted from LabNotebook.jsx.
   ============================================================================ */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Chart from 'chart.js/auto';
import { formatConc, concKey, toHex, fit4PL, errBarPlugin } from '../data/constants';
import { rainbowColors } from '../utils/chartStyle';
import { useNmrDerived, OneDSpectrumPlot, SpectrumPlot, HSQCPlot, CustomXTick1H, CustomXTick13C, TICKS_1H, TICKS_13C, TICKS_15N, PerAtomPlot, Fitting } from './NMRSections';
import { FCSOverlayVisualization } from './FlowCytometrySections';
import { CD_FIT_COMPONENTS } from './CDSections';
import { parseMDValue, getForceFieldInfo, getWaterModelInfo, getTrajectoryFormatInfo } from './MDData';

/* ============================================================================
   CHUNKED TABLE HELPER
   Automatically wraps long datasets into side-by-side table columns.
========================================================================== */
export const ChunkedTable = ({ data, renderHeader, renderRow, maxRows = 12 }) => {
  if (!data || data.length === 0) return null;
const chunks = [];
  for (let i = 0; i < data.length; i += maxRows) {
    chunks.push(data.slice(i, i + maxRows));
  }
  return (
    <div className="flex flex-wrap items-start justify-center gap-4 w-full">
      {chunks.map((chunk, idx) => (
        <div key={idx} className="overflow-x-auto border border-slate-200 rounded flex-1 min-w-[max-content] max-w-fit bg-slate-50 shadow-sm">
          <table className="w-full text-xs text-left select-text bg-white" draggable="true">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
              {renderHeader()}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {chunk.map((row, rowIdx) => {
const actualIdx = idx * maxRows + rowIdx;
                return renderRow(row, actualIdx);
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

/* ============================================================================
   CD SPECTRA CHART (for Lab Notebook)
========================================================================== */
export const CDSpectraChart = ({ wavelengthData, spectraColumns, chartCfg }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

const parsedWavelengths = useMemo(() => {
    if (!wavelengthData) return [];
    return wavelengthData.split(/[\n,]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  }, [wavelengthData]);

const parsedSpectra = useMemo(() => {
    return (spectraColumns || []).map((col) => {
const values = (col.data || '').split(/[\n,]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      return { ...col, values, color: col.color || '#3b82f6' };
    });
  }, [spectraColumns]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const datasets = parsedSpectra.filter(s => s.visible !== false && s.values.length > 0).map((s) => {
const data = parsedWavelengths.map((w, i) => ({
        x: w,
        y: s.values[i] !== undefined ? s.values[i] : null
      })).filter(d => d.y !== null);

      return {
        label: s.title,
        data,
        borderColor: s.color,
        backgroundColor: s.color + '20',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        fill: false,
        tension: 0.1,
      };
    });

    if (datasets.length === 0) return;

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'linear',
            min: chartCfg?.xMin !== '' && chartCfg?.xMin !== undefined ? parseFloat(chartCfg.xMin) : undefined,
            max: chartCfg?.xMax !== '' && chartCfg?.xMax !== undefined ? parseFloat(chartCfg.xMax) : undefined,
            title: { display: true, text: 'Wavelength (nm)', font: { size: 11, weight: 'bold' }, color: '#334155' },
            ticks: { font: { size: 10 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          },
          y: {
            min: chartCfg?.yMin !== '' && chartCfg?.yMin !== undefined ? parseFloat(chartCfg.yMin) : undefined,
            max: chartCfg?.yMax !== '' && chartCfg?.yMax !== undefined ? parseFloat(chartCfg.yMax) : undefined,
            title: { display: true, text: 'CD Signal (mdeg)', font: { size: 11, weight: 'bold' }, color: '#334155' },
            ticks: { font: { size: 10 }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          }
        },
        plugins: {
          legend: { position: 'top', labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (ctx) => `${ctx[0].parsed.x.toFixed(1)} nm`,
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)} mdeg`
            }
          }
        }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [parsedWavelengths, parsedSpectra, chartCfg]);

  if (parsedWavelengths.length === 0 || parsedSpectra.filter(s => s.visible !== false && s.values.length > 0).length === 0) {
    return <p className="text-sm text-slate-400 italic">No CD spectra data available.</p>;
  }

  return (
    <div style={{ height: '300px', position: 'relative' }}>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

const CDStructureChart = ({ structureComposition }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

const STRUCTURE_COLORS = {
    'α-Helix': '#3b82f6',
    'β-Sheet': '#ef4444',
    Turn: '#f59e0b',
    'Random Coil': '#94a3b8',
    Other: '#8b5cf6'
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const labels = Object.keys(structureComposition);
const values = Object.values(structureComposition);
const colors = labels.map(l => STRUCTURE_COLORS[l] || '#94a3b8');

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' }, padding: 8, usePointStyle: true } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)}%` } }
        }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [structureComposition]);

  if (!structureComposition || Object.values(structureComposition).every(v => v === 0)) {
    return <p className="text-sm text-slate-400 italic">No structure composition data.</p>;
  }

  return (
    <div style={{ height: '220px', maxWidth: '280px', margin: '0 auto' }}>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

/* ============================================================================
   CLONING UV SPECTRA CHART (for Lab Notebook)
========================================================================== */
export const CloningUvSpectraChart = ({ uvSpectra }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const datasets = (uvSpectra || []).map((spec, idx) => {
const color = toHex(rainbowColors(uvSpectra.length)[idx % Math.max(1, uvSpectra.length)]);
      return {
        label: spec.name || `Spectrum ${idx + 1}`,
        data: (spec.points || []).map(p => ({ x: p.wavelength, y: p.absorbance })),
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
      };
    }).filter(d => d.data.length > 0);

    if (datasets.length === 0) return;

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Wavelength (nm)', font: { size: 10 } }, ticks: { font: { size: 9 } } },
          y: { title: { display: true, text: 'Absorbance', font: { size: 10 } }, ticks: { font: { size: 9 } } }
        },
        plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [uvSpectra]);

  if (!uvSpectra || uvSpectra.length === 0) return null;

  return (
    <div className="mt-4">
      <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase">UV Spectra</h5>
      <div style={{ height: '250px', position: 'relative' }} className="bg-white border border-slate-200 rounded p-2">
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
};

/* ============================================================================
   CLONING SIMULATION CHART PREVIEW (for Lab Notebook)
========================================================================== */
export const CloningSimChartPreview = ({ sim }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !sim || !sim.sequence) return;
    if (chartInstance.current) chartInstance.current.destroy();

const molType = sim.molType || 'dsDNA';
const sequence = sim.sequence.toUpperCase().replace(/[^A-Z]/g, '');
const concStr = sim.conc ?? '50';
const concUnit = sim.concUnit || 'ng/µL';
const pathMm = sim.pathLengthMm ?? '10';

const isProt = molType === 'Protein';
    let mw = 0;
const counts = {};
    for (let char of sequence) {
      counts[char] = (counts[char] || 0) + 1;
    }

    if (isProt) {
      mw = sequence.length > 0 ? sequence.length * 110 : 0;
    } else {
const naMw = molType === 'ssDNA' ? 330 : 660;
      mw = sequence.length * naMw;
    }

    let concM = null;
const v = parseFloat(concStr);
    if (!isNaN(v) && mw > 0) {
      if (concUnit === 'µM') concM = v * 1e-6;
      else concM = (v * 1e-3) / mw;
    }

    if (concM == null) return;

const GAUSS = (x, mu, sigma) => Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2));
const DNA_BASE_EPS = {
      A: { eps: 15400, peak: 259, sigma: 14 },
      C: { eps: 7400, peak: 271, sigma: 14 },
      G: { eps: 11500, peak: 253, sigma: 14 },
      T: { eps: 8700, peak: 260, sigma: 14 },
      U: { eps: 10000, peak: 260, sigma: 14 }
    };

const l = (parseFloat(pathMm) || 10) / 10;
const start = isProt ? 190 : 220;
const end = isProt ? 350 : 320;
const data = [];

    for (let wl = start; wl <= end; wl += 1) {
      let eps = 0;
      if (isProt) {
const nBonds = Math.max(0, sequence.length - 1);
        eps += nBonds * 3000 * GAUSS(wl, 205, 13);
        eps += (counts['W'] || 0) * 5500 * GAUSS(wl, 280, 7);
        eps += (counts['Y'] || 0) * 1490 * GAUSS(wl, 274, 6);
        eps += (counts['F'] || 0) * 200 * GAUSS(wl, 257, 6);
        eps += Math.floor((counts['C'] || 0) / 2) * 125 * GAUSS(wl, 250, 8);
      } else {
        Object.entries(DNA_BASE_EPS).forEach(([base, cfg]) => {
          eps += (counts[base] || 0) * cfg.eps * GAUSS(wl, cfg.peak, cfg.sigma);
        });
        if (molType === 'dsDNA') eps *= 0.6;
      }
      data.push({ x: wl, y: eps * concM * l });
    }

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        datasets: [{
          label: `Simulated ${molType}`,
          data,
          borderColor: '#7c3aed',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Wavelength (nm)', font: { size: 10 } }, ticks: { font: { size: 9 } } },
          y: { title: { display: true, text: 'Absorbance', font: { size: 10 } }, ticks: { font: { size: 9 } } }
        },
        plugins: { legend: { display: false } }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [sim]);

  if (!sim || !sim.sequence) return null;

  return (
    <div className="mt-4">
      <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">Simulated UV Spectrum ({sim.molType || 'dsDNA'})</h5>
      <div style={{ height: '250px', position: 'relative' }} className="bg-white border border-slate-200 rounded p-2">
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
};


/* ============================================================================
   PROTEIN CHROMATOGRAM CHART (for Lab Notebook)
========================================================================== */
const METHOD_STROKE = {
  'Affinity': '#1e40af',
  'His-Trap': '#0d9488',
  'GST': '#7c3aed',
  'Ion Exchange': '#d97706',
  'Gel Filtration': '#059669'
};

const parseChromatogram = (raw) => {
  if (!raw) return [];
  return String(raw).split('\n').map((line) => {
const parts = line.split(/[,\t; ]+/).filter(Boolean);
    if (parts.length >= 2) {
const x = parseFloat(parts[0]);
const y = parseFloat(parts[1]);
      if (!isNaN(x) && !isNaN(y)) return { x, y };
    }
    return null;
  }).filter(Boolean).sort((a, b) => a.x - b.x);
};

export const ProteinChromatogramChart = ({ chromatograms }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const datasets = (chromatograms || []).map((chr, idx) => {
const data = parseChromatogram(chr.rawData);
const color = METHOD_STROKE[chr.method] || '#1e40af';
      return {
        label: chr.name || `Chromatogram ${idx + 1}`,
        data,
        borderColor: color,
        backgroundColor: color + '20',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
      };
    }).filter(d => d.data.length > 0);

    if (datasets.length === 0) return;

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Elution Volume (mL)', font: { size: 10 } }, ticks: { font: { size: 9 } } },
          y: { title: { display: true, text: 'Absorbance', font: { size: 10 } }, ticks: { font: { size: 9 } } }
        },
        plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [chromatograms]);

  if (!chromatograms || chromatograms.length === 0) return null;

  return (
    <div className="mt-4">
      <div style={{ height: '250px', position: 'relative' }} className="bg-white border border-slate-200 rounded p-2">
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
};

/* ============================================================================
   NMR SIMULATED SPECTRA (for Lab Notebook)
========================================================================== */
export const NMR_SPECTRUM_TYPES = [
  { id: '1D_1H',   label: '¹H 1D',       dim: '1D' },
  { id: '1D_13C',  label: '¹³C 1D',      dim: '1D' },
  { id: '1D_31P',  label: '³¹P 1D',      dim: '1D' },
  { id: 'cosy',    label: 'COSY',        dim: '2D' },
  { id: 'tocsy',   label: 'TOCSY',       dim: '2D' },
  { id: 'noesy',   label: 'NOESY',       dim: '2D' },
  { id: 'hsqc',    label: '¹H-¹³C HSQC', dim: '2D' },
  { id: 'hsqc15n', label: '¹H-¹⁵N HSQC', dim: '2D' }
];

const noopPanel = () => {};

export const NMRSpectraPreview = ({ test, selectedTypes = [] }) => {
const d = useNmrDerived(test, {});
const simCfg = {
    fontSize: 11,
    simShowLabels: false,
    simLabelFormat: 'resNum_code_atom',
    simLabelDim: 'both',
    simLabelFontSize: 10,
    ...(test.simChartCfg || {})
  };
const has = (id) => selectedTypes.includes(id);
const hasMolecule = d.parsedSeq.length > 0 || d.moleculeType === 'organic';

  if (!hasMolecule) {
    return <p className="text-xs text-slate-400 italic">No sequence / molecule defined — simulated spectra unavailable.</p>;
  }

const showP31 = has('1D_31P') && d.hasPhosphorus && d.selNuc.includes('P') && d.peaks.p31Data.length > 0;
const showHsqc15N = has('hsqc15n') && d.moleculeType === 'protein' && d.selNuc.includes('N') && d.peaks.hsqc15NPeaks.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4 w-full">
      {has('1D_1H') && (
        <OneDSpectrumPlot title="Simulated ¹H 1D Spectrum" data={d.peaks.data1H} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="nb-1D_1H" expandedPanel={null} setExpandedPanel={noopPanel} selectedKeys={null} heightPx={260} fs={11} simCfg={simCfg} />
      )}
      {has('1D_13C') && (
        <OneDSpectrumPlot title="Simulated ¹³C 1D Spectrum" data={d.peaks.data13C} fullDomain={[0, 220]} ticks={TICKS_13C} TickComponent={CustomXTick13C} xLabel="¹³C (ppm)" panelId="nb-1D_13C" expandedPanel={null} setExpandedPanel={noopPanel} selectedKeys={null} heightPx={260} fs={11} simCfg={simCfg} />
      )}
      {showP31 && (
        <OneDSpectrumPlot title="Simulated ³¹P 1D Spectrum" data={d.peaks.p31Data} fullDomain={[-5, 5]} ticks={Array.from({ length: 11 }, (_, i) => i - 5)} TickComponent={CustomXTick1H} xLabel="³¹P (ppm)" panelId="nb-1D_31P" expandedPanel={null} setExpandedPanel={noopPanel} selectedKeys={null} heightPx={260} fs={11} simCfg={simCfg} />
      )}
      {has('cosy') && (
        <SpectrumPlot title="Simulated COSY Spectrum" diagonalData={d.peaks.diagonalData} crossPeakData={d.peaks.cosyPeaks} expandedPanel={null} setExpandedPanel={noopPanel} panelId="nb-cosy" diagonalColor="#22c55e" selectedKeys={null} aspect={1} fs={11} simCfg={simCfg} />
      )}
      {has('tocsy') && (
        <SpectrumPlot title="Simulated TOCSY Spectrum" diagonalData={d.peaks.diagonalData} crossPeakData={d.peaks.tocsyPeaks} expandedPanel={null} setExpandedPanel={noopPanel} panelId="nb-tocsy" diagonalColor="#1e3a8a" selectedKeys={null} aspect={1} fs={11} simCfg={simCfg} />
      )}
      {has('noesy') && (
        <SpectrumPlot title="Simulated NOESY Spectrum" diagonalData={d.peaks.diagonalData} crossPeakData={d.peaks.noesyPeaks} expandedPanel={null} setExpandedPanel={noopPanel} panelId="nb-noesy" diagonalColor="#ef4444" selectedKeys={null} aspect={1} fs={11} simCfg={simCfg} />
      )}
      {has('hsqc') && (
        <HSQCPlot title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={d.peaks.hsqcPeaks} expandedPanel={null} setExpandedPanel={noopPanel} panelId="nb-hsqc" selectedKeys={null} yAxisLabel="¹³C F1 (ppm)" yDomainInit={[0, 220]} yTicks={TICKS_13C} aspect={1} fs={11} simCfg={simCfg} />
      )}
      {showHsqc15N && (
        <HSQCPlot title="Simulated ¹H-¹⁵N HSQC Spectrum" crossPeakData={d.peaks.hsqc15NPeaks} expandedPanel={null} setExpandedPanel={noopPanel} panelId="nb-hsqc15n" selectedKeys={null} yAxisLabel="¹⁵N F1 (ppm)" yDomainInit={[95, 135]} yTicks={TICKS_15N} aspect={1} fs={11} simCfg={simCfg} />
      )}
    </div>
  );
};

/* ============================================================================
   PREVIEW HELPERS
========================================================================== */
export const PlateGridPreview = ({ test }) => {
  const { grid, cellConfig } = test;
  if (!grid || !grid.length) return null;
  
const cols = grid[0].length;
const rows = grid.length;
const COL_LABELS = Array.from({ length: cols }, (_, i) => i + 1);
const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].slice(0, rows);

  return (
    <div className="flex flex-col gap-4 mt-2">
      {/* Plate Map */}
      <div>
        <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase">Plate Map</h5>
        <div className="overflow-x-auto border border-slate-200 rounded max-w-full">
          <table className="text-[10px] text-center w-full min-w-[max-content] bg-white select-text" draggable="true">
            <thead>
              <tr>
                <th className="bg-slate-100 border border-slate-200 p-1 w-8"></th>
                {COL_LABELS.map(c => <th key={c} className="bg-slate-100 border border-slate-200 p-1 font-bold text-slate-600">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  <td className="bg-slate-100 border border-slate-200 p-1 font-bold text-slate-600">{ROW_LABELS[r]}</td>
                  {row.map((_, c) => {
const cfg = cellConfig?.[r]?.[c] || {};
const role = cfg.role || '';
                    let concStr = '';
                    if (cfg.conc !== null && cfg.conc !== undefined && role && !['cells', 'medium', 'pbs'].includes(role.toLowerCase())) {
const n = Number(cfg.conc);
                       concStr = (n < 0.001 && n > 0) ? n.toExponential(2) : n.toPrecision(3);
                    }
                    return (
                      <td key={c} className="border border-slate-200 p-1 min-w-[45px] h-[30px] truncate max-w-[80px] bg-slate-50 align-middle">
                        {role ? (
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <span className="font-bold text-blue-700 truncate w-full" title={role}>{role}</span>
                            {concStr && <span className="text-[8.5px] text-slate-500 truncate w-full" title={concStr}>{concStr}</span>}
                          </div>
                        ) : <span className="text-slate-300">-</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Data Grid */}
      <div>
        <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase">Raw Data (OD)</h5>
        <div className="overflow-x-auto border border-slate-200 rounded max-w-full">
          <table className="text-[10px] text-center w-full min-w-[max-content] bg-white select-text" draggable="true">
            <thead>
              <tr>
                <th className="bg-slate-100 border border-slate-200 p-1 w-8"></th>
                {COL_LABELS.map(c => <th key={c} className="bg-slate-100 border border-slate-200 p-1 font-bold text-slate-600">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  <td className="bg-slate-100 border border-slate-200 p-1 font-bold text-slate-600">{ROW_LABELS[r]}</td>
                  {row.map((val, c) => {
const isExcluded = cellConfig?.[r]?.[c]?.excluded;
                    return (
                      <td key={c} className={`border border-slate-200 p-1 min-w-[35px] h-[24px] truncate max-w-[60px] ${isExcluded ? 'text-slate-400 line-through opacity-50 bg-slate-50' : 'text-slate-700'}`} title={isExcluded ? 'Excluded' : ''}>
                        {val !== '' && val !== null && val !== undefined ? val : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const Formula2DPreview = ({ test }) => {
const FS_CLASSES = 'fixed top-4 left-4 z-[99999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[99990]';
const d = useNmrDerived(test, { activeTest: test, instances: [test] });
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
    setZoom(1);
  };

  if (d.moleculeType === 'organic' && test.smiles) {
const imageUrl = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(test.smiles)}/image?width=800&height=800`;
    return (
      <>
        {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setIsExpanded(false)} />}
        <div className={isExpanded ? FS_CLASSES + ' p-6 flex flex-col' : 'flex flex-col mt-2 bg-white border border-slate-200 rounded p-4 shadow-sm relative group'}>
          <div className="flex justify-between items-center mb-2 z-[110] shrink-0">
            {isExpanded && <span className="font-bold text-slate-700 text-sm">2D Structure</span>}
            <div className="flex items-center gap-2 ml-auto">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                <button type="button" onClick={() => setZoom(z => Math.min(10, z * 1.4))} className="w-7 h-7 rounded bg-white hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-700 flex items-center justify-center">+</button>
                <button type="button" onClick={() => setZoom(z => Math.max(0.5, z / 1.4))} className="w-7 h-7 rounded bg-white hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-700 flex items-center justify-center">−</button>
                <button type="button" onClick={() => setZoom(1)} className="h-7 px-2 rounded bg-white hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-slate-600">Reset</button>
              </div>
              <button onClick={handleToggleExpand} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all shadow-sm">
                {isExpanded ? '↙️' : '↗️'}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar flex items-center justify-center relative min-h-0 p-4">
            <img 
              src={imageUrl} 
              alt="2D Structure" 
              style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto', objectFit: 'contain' }} 
            />
          </div>
        </div>
      </>
    );
  }
  
  if (d.structure && d.structure.elements) {
    return (
      <>
        {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setIsExpanded(false)} />}
        <div className={isExpanded ? FS_CLASSES + ' p-6 flex flex-col' : 'flex flex-col mt-2 bg-white border border-slate-200 rounded p-4 shadow-sm relative group'}>
          <div className="flex justify-between items-center mb-2 z-[110] shrink-0">
            {isExpanded && <span className="font-bold text-slate-700 text-sm">2D Structure</span>}
            <div className="flex items-center gap-2 ml-auto">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                <button type="button" onClick={() => setZoom(z => Math.min(10, z * 1.4))} className="w-7 h-7 rounded bg-white hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-700 flex items-center justify-center">+</button>
                <button type="button" onClick={() => setZoom(z => Math.max(0.5, z / 1.4))} className="w-7 h-7 rounded bg-white hover:bg-slate-200 border border-slate-300 text-xs font-black text-slate-700 flex items-center justify-center">−</button>
                <button type="button" onClick={() => setZoom(1)} className="h-7 px-2 rounded bg-white hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-slate-600">Reset</button>
              </div>
              <button onClick={handleToggleExpand} className="bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all shadow-sm">
                {isExpanded ? '↙️' : '↗️'}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar flex items-center justify-center relative min-h-0 p-4">
            <svg 
              viewBox={d.structure.viewBox} 
              className="font-sans" 
              style={{ width: `${zoom * 100}%`, minWidth: zoom > 1 ? `${zoom * 800}px` : '100%', height: 'auto', maxHeight: 'none' }}
            >
              {d.structure.elements.filter((e) => e.type === 'line').map((el, idx) => (
                <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
              ))}
              {d.structure.elements.filter((e) => e.type === 'path').map((el, idx) => (
                <path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
              ))}
              {d.structure.elements.filter((e) => e.type === 'polygon').map((el, idx) => (
                <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
              ))}
              {d.structure.elements.filter((e) => e.type === 'circle').map((el, idx) => (
                <circle key={`c${idx}`} cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : 1.5} pointerEvents="none" />
              ))}
              {d.structure.elements.filter((e) => e.type === 'text').map((el, idx) => (
                <g key={`t${idx}`} pointerEvents="none">
                  <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                  <text x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      </>
    );
  }
  return null;
};

const CDAnalysisGraphsPreview = ({ test, instances }) => {
const canvasFitRef = useRef(null);
const canvasCondRef = useRef(null);
const fitChart = useRef(null);
const condChart = useRef(null);

  useEffect(() => {
    if (canvasFitRef.current && test.wavelengthData && test.spectraColumns?.[0] && test.ssFits?.[test.spectraColumns[0].id]) {
const wls = test.wavelengthData.split(/[\n,]+/).map(Number).filter(n => !isNaN(n));
const spec = test.spectraColumns[0];
const expYs = spec.data.split(/[\n,]+/).map(Number);
const fit = test.ssFits[spec.id];
      
const fitYs = wls.map(w => {
        let yFit = 0;
        if (fit.fractions && CD_FIT_COMPONENTS) {
          Object.keys(fit.fractions).forEach(k => {
const comp = CD_FIT_COMPONENTS[k];
            if (comp && w >= comp.min && w <= comp.max) {
              yFit += comp.spline.at(w) * (fit.fractions[k] / 100);
            }
          });
          yFit *= (fit.scaleK || 1);
        }
        return yFit;
      });

      if (fitChart.current) fitChart.current.destroy();
      fitChart.current = new Chart(canvasFitRef.current, {
        type: 'line',
        data: {
          labels: wls,
          datasets: [
            { label: 'Experimental', data: expYs, borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 },
            { label: 'Fitted', data: fitYs, borderColor: '#ef4444', borderDash: [5, 5], tension: 0.1, pointRadius: 0 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    if (canvasCondRef.current && instances && instances.length > 1) {
const datasets = [];
      instances.forEach(inst => {
const t = inst.test || inst;
const wls = t.wavelengthData ? t.wavelengthData.split(/[\n,]+/).map(Number).filter(n => !isNaN(n)) : [];
        (t.spectraColumns || []).forEach(col => {
          if (col.visible === false) return;
const ys = col.data.split(/[\n,]+/).map(Number);
          datasets.push({
            label: `${inst.name || t.instanceName || t.name} - ${col.title}`,
            data: wls.map((w, i) => ({x: w, y: ys[i]})).filter(d => !isNaN(d.y)),
            borderColor: col.color || '#3b82f6',
            tension: 0.1,
            pointRadius: 0
          });
        });
      });

      if (condChart.current) condChart.current.destroy();
      if (datasets.length > 0) {
        condChart.current = new Chart(canvasCondRef.current, {
          type: 'line',
          data: { datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { type: 'linear' } }
          }
        });
      }
    }

    return () => {
      if (fitChart.current) fitChart.current.destroy();
      if (condChart.current) condChart.current.destroy();
    };
  }, [test, instances]);

  return (
    <div className="flex flex-col gap-4 mt-2">
      {test.structureComposition && (
         <div className="flex flex-col items-center">
           <h5 className="text-[10px] font-bold text-slate-500 mb-1">Secondary Structure</h5>
           <CDStructureChart structureComposition={test.structureComposition} />
         </div>
      )}
      {test.ssFits && test.spectraColumns?.[0] && test.ssFits[test.spectraColumns[0].id] && (
        <div style={{ height: '250px' }}>
          <h5 className="text-[10px] font-bold text-slate-500 text-center mb-1">Fitted Spectrum Overlay</h5>
          <canvas ref={canvasFitRef}></canvas>
        </div>
      )}
      {instances && instances.length > 1 && (
        <div style={{ height: '250px' }}>
          <h5 className="text-[10px] font-bold text-slate-500 text-center mb-1">Condition Spectra Overlay</h5>
          <canvas ref={canvasCondRef}></canvas>
        </div>
      )}
    </div>
  );
};

export const RemovablePanel = ({ title, visible, setVisible, children }) => {
  if (!visible) return null;
  return (
    <div className="mb-3 pb-3 border-b border-slate-100 relative group">
      <div className="flex justify-between items-center mb-1">
        <h4 className="text-[10px] font-bold text-slate-500 uppercase">{title}</h4>
        <button onClick={() => setVisible(false)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 font-bold px-1.5 py-0.5 text-[10px] bg-slate-100 rounded transition-opacity" title="Remove from notebook">✕ Remove</button>
      </div>
      {children}
    </div>
  );
};

/* ============================================================================
   NMR FITTING GRAPHS PREVIEW (for Lab Notebook)
========================================================================== */
const NMRDecayChartPreview = ({ table, colFits }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const ds = [];
    for (let c = 0; c < table.nCols; c++) {
const color = toHex(rainbowColors(table.nCols)[c % Math.max(1, table.nCols)]);
const pts = [];
      for (let r = 0; r < table.nRows; r++) {
const x = table.delays[r], y = parseFloat(table.grid[r]?.[c]);
        if (isFinite(x) && isFinite(y)) pts.push({ x, y });
      }
      if (pts.length === 0) continue;

      ds.push({ label: table.colResidues[c] || `Col ${c + 1}`, data: pts, showLine: false, pointRadius: 3, backgroundColor: color, borderColor: color, type: 'scatter' });
      
const fit = colFits[c]?.fit;
      if (fit && pts.length >= 2) {
const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
        for (let i = 0; i <= 60; i++) {
const x = xmin + ((xmax - xmin) * i) / 60;
          let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
          curve.push({ x, y: yVal });
        }
        ds.push({ label: `${table.colResidues[c] || `Col ${c + 1}`} fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: 2, type: 'line', tension: 0.25 });
      }
    }

const xLabel = table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`;
    
    chartInstance.current = new Chart(canvasRef.current, {
      type: 'scatter',
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: xLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } },
          y: { title: { display: true, text: 'Intensity / Volume', font: { size: 10 } }, ticks: { font: { size: 9 } } },
        },
        plugins: { legend: { display: false } }
      }
    });
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [table, colFits]);

  return <div style={{ height: '220px' }}><canvas ref={canvasRef}></canvas></div>;
};

const NMRParameterChartPreview = ({ table, colFits }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const labels = [];
const data = [];
const colors = [];
    
    colFits.forEach((cf, i) => {
      if (cf.fit) {
        labels.push(cf.residue || `Col ${i+1}`);
        data.push(cf.fit.R_s);
        colors.push(toHex(rainbowColors(colFits.length)[i % Math.max(1, colFits.length)]));
      }
    });

    if (data.length === 0) return;

const yLabel = table.relaxType === 'DOSY' ? 'Diffusion Rate (D)' : `Rate (${table.relaxType === 'T1' ? 'R1' : 'R2'}) s⁻¹`;

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels, datasets: [{ label: yLabel, data, backgroundColor: colors }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } },
          x: { ticks: { font: { size: 9 } } }
        },
        plugins: { legend: { display: false } }
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [table, colFits]);

  return <div style={{ height: '220px' }}><canvas ref={canvasRef}></canvas></div>;
};

const NMRIndividualDecayChartPreview = ({ table, colIndex, colFit }) => {
const canvasRef = useRef(null);
const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

const color = toHex(rainbowColors(Math.max(1, table.nCols))[colIndex % Math.max(1, table.nCols)]);
const pts = [];
    for (let r = 0; r < table.nRows; r++) {
const x = table.delays[r], y = parseFloat(table.grid[r]?.[colIndex]);
      if (isFinite(x) && isFinite(y)) pts.push({ x, y });
    }
    if (pts.length === 0) return;

const ds = [];
    ds.push({ label: 'Data', data: pts, showLine: false, pointRadius: 3, backgroundColor: color, borderColor: color, type: 'scatter' });
    
const fit = colFit?.fit;
    if (fit && pts.length >= 2) {
const xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x)), curve = [];
      for (let i = 0; i <= 60; i++) {
const x = xmin + ((xmax - xmin) * i) / 60;
        let yVal = fit.modelType === 'inversion-recovery' ? fit.A - fit.B * Math.exp(-fit.R * x) : fit.A * Math.exp(-fit.R * x);
        curve.push({ x, y: yVal });
      }
      ds.push({ label: `Fit`, data: curve, showLine: true, pointRadius: 0, borderColor: color, backgroundColor: 'transparent', borderWidth: 2, type: 'line', tension: 0.25 });
    }

const xLabel = table.relaxType === 'DOSY' ? `b-value / G² (${table.delayUnit})` : `Delay (${table.delayUnit})`;

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'scatter',
      data: { datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: 'linear', title: { display: true, text: xLabel, font: { size: 9 } }, ticks: { font: { size: 8 } } },
          y: { title: { display: true, text: 'Intensity', font: { size: 9 } }, ticks: { font: { size: 8 } } },
        },
        plugins: { legend: { display: false } },
        interaction: { mode: 'nearest', intersect: true },
      }
    });

    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [table, colIndex, colFit]);

  return (
    <div className="bg-white p-2 border border-slate-200 rounded-lg shadow-sm flex flex-col">
      <h6 className="text-[10px] font-bold text-slate-600 uppercase text-center mb-1">{table.colResidues[colIndex] || `Col ${colIndex + 1}`}</h6>
      <div style={{ height: '150px' }}><canvas ref={canvasRef}></canvas></div>
    </div>
  );
};

const NMRFittingGraphsPreview = ({ test }) => {
  const [showIndividual, setShowIndividual] = useState(true);

  if (!test.nmrTables || test.nmrTables.length === 0 || !test.savedFits) {
    return <p className="text-[10px] text-slate-400 italic">No fitting data available.</p>;
  }

  return (
    <div className="flex flex-col gap-6 mt-2">
      {test.nmrTables.map((t, idx) => {
const colFits = test.savedFits[t.id] || [];
        if (colFits.length === 0) return null;
        
        return (
          <div key={t.id} className="flex flex-col gap-4 border border-slate-200 p-3 rounded-lg bg-slate-50">
            <div className="flex justify-between items-center border-b border-slate-200 pb-1">
              <h5 className="text-[11px] font-bold text-slate-600 uppercase flex-1">Table {idx + 1} Graphs — {t.atom}</h5>
              <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer bg-white px-2 py-1 rounded border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
                <input type="checkbox" checked={showIndividual} onChange={(e) => setShowIndividual(e.target.checked)} className="accent-blue-600" /> Show Individual Fits
              </label>
            </div>
            
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-white p-2 rounded border border-slate-200 shadow-sm">
                <h6 className="text-[10px] font-bold text-slate-500 mb-2 text-center uppercase">Decay / Diffusion Curves</h6>
                <NMRDecayChartPreview table={t} colFits={colFits} />
              </div>
              <div className="bg-white p-2 rounded border border-slate-200 shadow-sm">
                <h6 className="text-[10px] font-bold text-slate-500 mb-2 text-center uppercase">Fitted Rates</h6>
                <NMRParameterChartPreview table={t} colFits={colFits} />
              </div>
            </div>

            {showIndividual && (
              <div className="mt-2 pt-3 border-t border-slate-200">
                <h6 className="text-[10px] font-bold text-slate-500 mb-3 uppercase text-center">Individual Residue Fits</h6>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {colFits.map((cf, c) => (
                    <NMRIndividualDecayChartPreview key={c} table={t} colIndex={c} colFit={cf} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ============================================================================
PLATE ANALYSIS GRAPHS PREVIEW (for Lab Notebook)
========================================================================== */
const PlateAnalysisPreview = ({ test }) => {
const drCanvasRef = useRef(null);
const ic50CanvasRef = useRef(null);
const drChartRef = useRef(null);
const ic50ChartRef = useRef(null);
const processed = useMemo(() => {
const { grid, cellConfig } = test;
if (!grid || !grid.length) return null;
const rows = grid.length;
const cols = grid[0].length;
const cOD = parseFloat(String(test.ctrlODStr).replace(',', '.')) || 0;
const gOff = parseFloat(String(test.glbOffsetStr || '0').replace(',', '.')) || 0;
const bgMan = parseFloat(String(test.bgManualStr || '0').replace(',', '.')) || 0;
const bgType = test.bgType || 'none';
let bgOD = 0;
if (bgType === 'manual') {
   bgOD = bgMan;
 } else if (bgType !== 'none') {
   let s = 0, n = 0;
   for (let r = 0; r < rows; r++) {
     for (let c = 0; c < cols; c++) {
const cfg = cellConfig?.[r]?.[c];
       if (!cfg || cfg.excluded) continue;
       if ((cfg.role || '') === bgType) {
const v = parseFloat(grid[r]?.[c]);
         if (!isNaN(v)) { s += v - gOff; n++; }
       }
     }
   }
   bgOD = n > 0 ? s / n : 0;
 }
const tConc = parseFloat(String(test.topConcStr).replace(',', '.')) || 0;
const dFact = parseFloat(String(test.dilFactorStr).replace(',', '.')) || 1;
const customConc = test.customConc || {};
const rowCompounds = test.rowCompounds || [];
const compounds = test.compounds || [];
const getRole = (r, c) => {
const cfg = cellConfig?.[r]?.[c];
   if (!cfg) return null;
   if (cfg.role !== null && cfg.role !== undefined) return cfg.role;
const rCmp = rowCompounds[r];
const cCmp = compounds[c];
   if (rCmp && !cCmp) return rCmp;
   if (cCmp && !rCmp) return cCmp;
   return rCmp || null;
 };
const concOf = (r, c, role) => {
   if (!role || ['cells', 'medium', 'pbs'].includes(String(role).toLowerCase())) return 0;
const cfg = cellConfig?.[r]?.[c];
   if (cfg && cfg.conc !== null && cfg.conc !== undefined) return Number(cfg.conc);
const s = customConc[role]
     ? { top: parseFloat(customConc[role].top) || 0, dil: parseFloat(customConc[role].dil) || 1 }
     : { top: tConc, dil: dFact };
   let isHoriz = rowCompounds[r] === role;
   if (!isHoriz && compounds[c] !== role && rowCompounds.includes(role)) isHoriz = true;
   let step = 0;
   if (isHoriz) {
     for (let i = 0; i < c; i++) { if (getRole(r, i) === role) step++; }
   } else {
     for (let i = 0; i < r; i++) { if (getRole(i, c) === role) step++; }
   }
   return s.top / Math.pow(s.dil, step);
 };
const viability = (raw) => {
const net = raw - bgOD;
const ctrl = cOD - bgOD;
   return Math.abs(ctrl) < 1e-6 ? 0 : (net / ctrl) * 100;
 };
const byRegion = {};
 for (let r = 0; r < rows; r++) {
   for (let c = 0; c < cols; c++) {
const cfg = cellConfig?.[r]?.[c];
     if (!cfg || cfg.excluded) continue;
const role = getRole(r, c);
     if (!role || ['cells', 'medium', 'pbs'].includes(String(role).toLowerCase())) continue;
const reg = cfg.region || 'Primary';
const rawVal = parseFloat(grid[r]?.[c]);
     if (isNaN(rawVal)) continue;
const conc = concOf(r, c, role);
     if (!(conc > 0)) continue;
     if (!byRegion[reg]) byRegion[reg] = {};
     if (!byRegion[reg][role]) byRegion[reg][role] = {};
const ck = concKey(conc);
     if (!byRegion[reg][role][ck]) byRegion[reg][role][ck] = [];
     byRegion[reg][role][ck].push(viability(rawVal - gOff));
   }
 }
const result = {};
 Object.entries(byRegion).forEach(([reg, comps]) => {
   result[reg] = [];
   Object.entries(comps).forEach(([name, concMap]) => {
const vPts = [];
     Object.entries(concMap).forEach(([ck, vals]) => {
const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
       let sd = 0;
       if (vals.length > 1) {
         sd = Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (vals.length - 1));
       }
const realX = parseFloat(ck);
       vPts.push({ x: Math.log10(realX), realX, y: mean, sd, n: vals.length });
     });
     vPts.sort((a, b) => a.x - b.x);
     let fit = null;
     if (test.fitIC50 && vPts.length >= 3) {
const fitData = vPts.map(p => ({ x: p.realX, y: p.y, w: p.sd > 0 ? 1 / (p.sd * p.sd) : 1, sd: p.sd }));
const sumW = fitData.reduce((s, p) => s + p.w, 0);
       if (sumW > 0) fitData.forEach(p => p.w = (p.w / sumW) * fitData.length);
       fit = fit4PL(fitData);
     }
     result[reg].push({ name, vPts, fit, color: toHex(rainbowColors(Math.max(1, result[reg].length + 1))[result[reg].length]) });
   });
 });
 return result;
}, [test]);
useEffect(() => {
if (!processed) return;
// --- Dose-Response Chart ---
if (drCanvasRef.current) {
if (drChartRef.current) drChartRef.current.destroy();
const ds = [];
Object.entries(processed).forEach(([reg, comps]) => {
comps.forEach(cd => {
if (cd.fit) {
const minL = Math.min(...cd.vPts.map(p => p.x)) - 0.2;
const maxL = Math.max(...cd.vPts.map(p => p.x)) + 0.2;
const curve = [];
   for (let v = minL; v <= maxL; v += (maxL - minL) / 60) {
     curve.push({ x: v, y: 100 / (1 + Math.pow(Math.pow(10, v) / cd.fit.ic50, cd.fit.hill)) });
   }
   ds.push({
     label: `${cd.name} (${reg}) fit`,
     data: curve,
     borderColor: cd.color,
     backgroundColor: 'transparent',
     borderWidth: 2,
     pointRadius: 0,
     fill: false,
     type: 'line',
     tension: 0
   });
 }
 if (cd.vPts.length > 0) {
   ds.push({
     label: `${cd.name} (${reg})`,
     data: cd.vPts,
     errorBars: cd.vPts.map(p => ({ plus: p.sd, minus: p.sd })),
     borderColor: cd.color,
     backgroundColor: cd.color,
     borderWidth: 2,
     pointRadius: 4,
     fill: false,
     type: 'scatter',
     showLine: false
   });
 }
});
});
if (ds.length > 0) {
drChartRef.current = new Chart(drCanvasRef.current, {
type: 'scatter',
data: { datasets: ds },
plugins: [errBarPlugin],
options: {
responsive: true, maintainAspectRatio: false, animation: false,
scales: {
  x: {
    type: 'linear',
    title: { display: true, text: `Log₁₀ [Conc. (${test.unit || 'µM'})]`, font: { size: 11, weight: 'bold' }, color: '#334155' },
    ticks: { font: { size: 10 }, color: '#64748b' },
    grid: { color: '#f1f5f9' }
  },
  y: {
    title: { display: true, text: 'Viability (%)', font: { size: 11, weight: 'bold' }, color: '#334155' },
    ticks: { font: { size: 10 }, color: '#64748b' },
    grid: { color: '#f1f5f9' }
  }
},
plugins: {
  legend: { position: 'top', labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } },
  tooltip: {
    callbacks: {
      title: (ctx) => `Conc: ${formatConc(Math.pow(10, ctx[0].parsed.x))} ${test.unit || 'µM'}`,
      label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`
    }
  }
}
}
});
}
}
// --- IC50 Comparison Bar Chart ---
if (ic50CanvasRef.current) {
if (ic50ChartRef.current) ic50ChartRef.current.destroy();
const labels = [];
const data = [];
const colors = [];
const ebars = [];
Object.entries(processed).forEach(([reg, comps]) => {
comps.forEach(cd => {
if (cd.fit && isFinite(cd.fit.ic50)) {
  labels.push(`${cd.name} (${reg})`);
  data.push(cd.fit.ic50);
  colors.push(cd.color);
const se = Math.min(cd.fit.se, cd.fit.ic50 * 2);
  ebars.push({ plus: se, minus: se });
}
});
});
if (labels.length > 0) {
ic50ChartRef.current = new Chart(ic50CanvasRef.current, {
type: 'bar',
data: {
labels,
datasets: [{
  label: `IC50 (${test.unit || 'µM'})`,
  data,
  backgroundColor: colors,
  borderColor: colors,
  borderWidth: 1,
  errorBars: ebars
}]
},
plugins: [errBarPlugin],
options: {
responsive: true, maintainAspectRatio: false, animation: false,
scales: {
  y: {
    beginAtZero: true,
    title: { display: true, text: `IC50 (${test.unit || 'µM'})`, font: { size: 11, weight: 'bold' }, color: '#334155' },
    ticks: { font: { size: 10 }, color: '#64748b' },
    grid: { color: '#f1f5f9' }
  },
  x: {
    ticks: { font: { size: 10, weight: 'bold' }, color: '#334155' },
    grid: { display: false }
  }
},
plugins: {
  legend: { display: false },
  tooltip: {
    callbacks: {
      label: (ctx) => `IC50: ${ctx.raw.toFixed(3)} ± ${(ebars[ctx.dataIndex]?.plus || 0).toFixed(3)} ${test.unit || 'µM'}`
    }
  }
}
}
});
}
}
return () => {
if (drChartRef.current) drChartRef.current.destroy();
if (ic50ChartRef.current) ic50ChartRef.current.destroy();
};
}, [processed, test.unit]);
if (!processed || Object.keys(processed).length === 0) {
return <p className="text-[10px] text-slate-400 italic">No plate analysis data available.</p>;
}
const ic50Rows = [];
Object.entries(processed).forEach(([reg, comps]) => {
comps.forEach(cd => {
if (cd.fit) ic50Rows.push({ region: reg, name: cd.name, ic50: cd.fit.ic50, hill: cd.fit.hill, se: cd.fit.se });
});
});
return (
<div className="flex flex-col gap-4 mt-2">
<div style={{ height: '300px', position: 'relative' }}>
<canvas ref={drCanvasRef}></canvas>
</div>
{ic50Rows.length > 0 && (
<>
<h5 className="text-[10px] font-bold text-slate-500 uppercase text-center w-full">IC50 Comparison</h5>
<div style={{ height: '250px', position: 'relative' }}>
<canvas ref={ic50CanvasRef}></canvas>
</div>
</>
)}
{ic50Rows.length > 0 && (
<div className="overflow-x-auto border border-slate-200 rounded">
<table className="w-full text-xs text-left select-text bg-white">
<thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
<tr>
  <th className="px-3 py-1.5 border-r">Region</th>
  <th className="px-3 py-1.5 border-r">Compound</th>
  <th className="px-3 py-1.5 border-r">IC50 ({test.unit || 'µM'})</th>
  <th className="px-3 py-1.5">Hill Slope</th>
</tr>
</thead>
<tbody className="divide-y divide-slate-100">
{ic50Rows.map((row, i) => (
  <tr key={i}>
    <td className="px-3 py-1.5 border-r">{row.region}</td>
    <td className="px-3 py-1.5 font-bold border-r">{row.name}</td>
    <td className="px-3 py-1.5 border-r">{row.ic50.toFixed(3)} ± {row.se.toFixed(3)}</td>
    <td className="px-3 py-1.5">{row.hill.toFixed(3)}</td>
  </tr>
))}
</tbody>
</table>
</div>
)}
</div>
);
};
/* ============================================================================
NMR FITTING SIMULATION PREVIEW (for Lab Notebook) — WITH GRAPHS
========================================================================== */
const NMR_SIM_CONSTANTS = {
HBAR: 1.054571817e-34,
MU0_4PI: 1e-7,
RGAS: 8.314462618,
GAMMA_H: 2.6752218744e8,
GAMMA: { '15N': -2.7126e7, '13C': 6.7283e7, '1H': 2.6752218744e8, '31P': 1.083e8 },
BOLTZMANN: 1.380649e-23
};
const nmrSimSpectralDensity = (w, tau_c, S2, useInternal, tau_e) => {
let val = (S2 * tau_c) / (1 + (w * tau_c) ** 2);
if (useInternal && tau_e > 0) {
const te = 1 / (1 / tau_c + 1 / tau_e);
val += ((1 - S2) * te) / (1 + (w * te) ** 2);
}
return (2 / 5) * val;
};
const nmrSimModelFreeRates = ({ nucleus, fieldMHz, tau_c_ns, S2, useInternal, tau_e_ps, r_A, csa_ppm }) => {
const { GAMMA, GAMMA_H, HBAR, MU0_4PI } = NMR_SIM_CONSTANTS;
const gx = GAMMA[nucleus] || GAMMA['15N'];
const gxAbs = Math.abs(gx);
const B0 = (2 * Math.PI * fieldMHz * 1e6) / GAMMA_H;
const wH = GAMMA_H * B0;
const wX = gxAbs * B0;
const tau_c = tau_c_ns * 1e-9;
const tau_e = tau_e_ps * 1e-12;
const r_m = r_A * 1e-10;
const J = (w) => nmrSimSpectralDensity(w, tau_c, S2, useInternal, tau_e);
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
};
const nmrSimStokesEinsteinD = (T_K, eta_PaS, r_m) => (NMR_SIM_CONSTANTS.BOLTZMANN * T_K) / (6 * Math.PI * eta_PaS * r_m);
const nmrSimRadiusFromMW = (MW_Da, vbar_cm3g, hydration) => {
const V_m3 = (MW_Da * 1e-3 / 6.022e23) * (vbar_cm3g * 1e-6 + hydration * 1e-6);
return Math.pow((3 * V_m3) / (4 * Math.PI), 1 / 3);
};
const nmrSimTauFromMW = (MW_Da, eta_PaS, T_K, vbar_cm3g, hydration) => (eta_PaS * (MW_Da * 1e-3 * (vbar_cm3g * 1e-3 + hydration * 1e-3))) / (NMR_SIM_CONSTANTS.RGAS * T_K);
export const NMRFittingSimPreview = ({ test }) => {
const relaxCanvasRef = useRef(null);
const diffCanvasRef = useRef(null);
const relaxChartRef = useRef(null);
const diffChartRef = useRef(null);
const sim = {
nucleus: '15N', fieldMHz: 600, tau_c_ns: 5, S2: 0.85,
useInternal: false, tau_e_ps: 50, r_A: 1.02, csa_ppm: -160,
temperature: 298, viscosity: 0.89e-3, vbar: 0.73, hydration: 0.3,
MW: 12000, shape: 'sphere',
...(test.sim || {})
};
const nucleus = sim.nucleus || '15N';
const fieldMHz = sim.fieldMHz || 600;
const MW = sim.MW || 12000;
const T_K = sim.temperature || 298;
const viscosity = sim.viscosity || 0.89e-3;
const vbar = sim.vbar || 0.73;
const hydration = sim.hydration || 0.3;
const S2 = sim.S2 || 0.85;
const tau_e = sim.tau_e_ps || 50;
const rXH = sim.r_A || 1.02;
const csa = sim.csa_ppm !== undefined ? sim.csa_ppm : -160;
const shapeFactor = (sim.shape || 'sphere') === 'sphere' ? 1 : sim.shape === 'rod' ? 1.3 : 1.15;
const r_m = nmrSimRadiusFromMW(MW, vbar, hydration) * shapeFactor;
const D_calc = nmrSimStokesEinsteinD(T_K, viscosity, r_m);
const tau_c_calc = nmrSimTauFromMW(MW, viscosity, T_K, vbar, hydration);
const tau_c_ns = sim.tau_c_ns || (tau_c_calc * 1e9) || 5;
const rates = nmrSimModelFreeRates({
nucleus, fieldMHz, tau_c_ns, S2,
useInternal: sim.useInternal || false,
tau_e_ps: tau_e, r_A: rXH, csa_ppm: csa
});
const pB = sim.pB || 0.05;
const deltaW_ex = sim.deltaW_ex || 2;
const tau_ex = sim.tau_ex || 10;
const Rex_extra = sim.Rex_extra || 0;
const Rex_calc = pB > 0 && tau_ex > 0 ? pB * (1 - pB) * Math.pow(deltaW_ex * 2 * Math.PI * fieldMHz, 2) * (tau_ex * 1e-6) : 0;
const R2_with_ex = rates.R2 + Rex_calc + Rex_extra;
// --- Generate R1/R2/NOE vs tau_c sweep data ---
const sweepData = useMemo(() => {
const pts = { R1: [], R2: [], NOE: [] };
const tauRange = [];
for (let t = 0.05; t <= 50; t *= 1.08) tauRange.push(t);
tauRange.forEach(tc => {
const r = nmrSimModelFreeRates({ nucleus, fieldMHz, tau_c_ns: tc, S2, useInternal: sim.useInternal || false, tau_e_ps: tau_e, r_A: rXH, csa_ppm: csa });
pts.R1.push({ x: tc, y: r.R1 });
pts.R2.push({ x: tc, y: r.R2 });
pts.NOE.push({ x: tc, y: r.NOE });
});
return pts;
}, [nucleus, fieldMHz, S2, sim.useInternal, tau_e, rXH, csa]);
// --- Generate D vs MW sweep data ---
const diffSweepData = useMemo(() => {
const pts = [];
for (let mw = 2000; mw <= 100000; mw += 2000) {
const r = nmrSimRadiusFromMW(mw, vbar, hydration) * shapeFactor;
const D = nmrSimStokesEinsteinD(T_K, viscosity, r);
pts.push({ x: mw / 1000, y: D * 1e11 });
}
return pts;
}, [vbar, hydration, shapeFactor, T_K, viscosity]);
// --- Render Relaxation Chart ---
useEffect(() => {
if (!relaxCanvasRef.current) return;
if (relaxChartRef.current) relaxChartRef.current.destroy();
relaxChartRef.current = new Chart(relaxCanvasRef.current, {
type: 'line',
data: {
datasets: [
{
label: 'R1 (s⁻¹)',
data: sweepData.R1,
borderColor: '#3b82f6',
backgroundColor: 'transparent',
borderWidth: 2,
pointRadius: 0,
fill: false,
yAxisID: 'y'
},
{
label: 'R2 (s⁻¹)',
data: sweepData.R2,
borderColor: '#ef4444',
backgroundColor: 'transparent',
borderWidth: 2,
pointRadius: 0,
fill: false,
yAxisID: 'y'
},
{
label: 'NOE',
data: sweepData.NOE,
borderColor: '#22c55e',
backgroundColor: 'transparent',
borderWidth: 2,
borderDash: [5, 3],
pointRadius: 0,
fill: false,
yAxisID: 'y1'
}
]
},
options: {
responsive: true, maintainAspectRatio: false, animation: false,
scales: {
x: {
type: 'logarithmic',
title: { display: true, text: 'τc (ns)', font: { size: 11, weight: 'bold' }, color: '#334155' },
ticks: { font: { size: 9 }, color: '#64748b', callback: (v) => { if ([0.1,1,10,50].includes(v)) return v; return null; } },
grid: { color: '#f1f5f9' }
},
y: {
position: 'left',
title: { display: true, text: 'R1, R2 (s⁻¹)', font: { size: 11, weight: 'bold' }, color: '#334155' },
ticks: { font: { size: 9 }, color: '#64748b' },
grid: { color: '#f1f5f9' }
},
y1: {
position: 'right',
title: { display: true, text: 'NOE', font: { size: 11, weight: 'bold' }, color: '#22c55e' },
ticks: { font: { size: 9 }, color: '#22c55e' },
grid: { drawOnChartArea: false }
}
},
plugins: {
legend: { position: 'top', labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } },
tooltip: { callbacks: { title: (ctx) => `τc = ${ctx[0].parsed.x.toFixed(2)} ns` } }
}
}
});
// Draw vertical marker line at actual tau_c
const chart = relaxChartRef.current;
const xScale = chart.scales.x;
const yArea = chart.chartArea;
if (xScale && yArea) {
const px = xScale.getPixelForValue(tau_c_ns);
chart.ctx.save();
chart.ctx.strokeStyle = '#6366f1';
chart.ctx.lineWidth = 2;
chart.ctx.setLineDash([6, 3]);
chart.ctx.beginPath();
chart.ctx.moveTo(px, yArea.top);
chart.ctx.lineTo(px, yArea.bottom);
chart.ctx.stroke();
chart.ctx.fillStyle = '#6366f1';
chart.ctx.font = 'bold 9px sans-serif';
chart.ctx.fillText(`τc = ${tau_c_ns.toFixed(1)} ns`, px + 4, yArea.top + 12);
chart.ctx.restore();
}
return () => { if (relaxChartRef.current) relaxChartRef.current.destroy(); };
}, [sweepData, tau_c_ns]);
// --- Render Diffusion Chart ---
useEffect(() => {
if (!diffCanvasRef.current) return;
if (diffChartRef.current) diffChartRef.current.destroy();
diffChartRef.current = new Chart(diffCanvasRef.current, {
type: 'line',
data: {
datasets: [
{
label: 'D vs MW (Stokes-Einstein)',
data: diffSweepData,
borderColor: '#0d9488',
backgroundColor: 'rgba(13,148,136,0.08)',
borderWidth: 2,
pointRadius: 0,
fill: true
},
{
label: `This protein (${MW.toLocaleString()} Da)`,
data: [{ x: MW / 1000, y: D_calc * 1e11 }],
borderColor: '#dc2626',
backgroundColor: '#dc2626',
pointRadius: 7,
pointStyle: 'rectRot',
type: 'scatter',
showLine: false
}
]
},
options: {
responsive: true, maintainAspectRatio: false, animation: false,
scales: {
x: {
type: 'linear',
title: { display: true, text: 'Molecular Weight (kDa)', font: { size: 11, weight: 'bold' }, color: '#334155' },
ticks: { font: { size: 9 }, color: '#64748b' },
grid: { color: '#f1f5f9' }
},
y: {
title: { display: true, text: 'D (×10⁻¹¹ m²/s)', font: { size: 11, weight: 'bold' }, color: '#334155' },
ticks: { font: { size: 9 }, color: '#64748b' },
grid: { color: '#f1f5f9' }
}
},
plugins: {
legend: { position: 'top', labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } },
tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: D = ${ctx.parsed.y.toFixed(3)} ×10⁻¹¹ m²/s` } }
}
}
});
return () => { if (diffChartRef.current) diffChartRef.current.destroy(); };
}, [diffSweepData, MW, D_calc]);
return (
<div className="flex flex-col gap-4 mt-2">
<h5 className="text-[10px] font-bold text-slate-500 uppercase text-center w-full">NMR Simulation Results</h5>
{/* ===== SECTION 1: DIFFUSION ===== */}
<div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
<h6 className="text-[10px] font-bold text-slate-600 uppercase mb-2">💧 Diffusion Coefficient (Stokes-Einstein)</h6>
<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
<span className="text-slate-500">MW:</span><span className="font-mono font-bold">{MW.toLocaleString()} Da</span>
<span className="text-slate-500">Shape:</span><span className="font-mono font-bold">{sim.shape || 'sphere'} (×{shapeFactor})</span>
<span className="text-slate-500">Hydrodynamic r:</span><span className="font-mono font-bold">{(r_m * 1e9).toFixed(2)} nm</span>
<span className="text-slate-500">D:</span><span className="font-mono font-bold">{D_calc.toExponential(3)} m²/s</span>
<span className="text-slate-500">D (×10⁻¹¹):</span><span className="font-mono font-bold">{(D_calc * 1e11).toFixed(2)}</span>
<span className="text-slate-500">τc (calc):</span><span className="font-mono font-bold">{(tau_c_calc * 1e9).toFixed(2)} ns</span>
<span className="text-slate-500">T / η:</span><span className="font-mono font-bold">{T_K} K / {(viscosity * 1e3).toFixed(2)} mPa·s</span>
<span className="text-slate-500">v̄ / hydration:</span><span className="font-mono font-bold">{vbar} / {hydration}</span>
</div>
<div style={{ height: '220px', position: 'relative' }}>
<canvas ref={diffCanvasRef}></canvas>
</div>
<p className="text-[9px] text-slate-400 italic mt-1">D = k_B·T / (6π·η·r_h) — Stokes-Einstein equation</p>
</div>
{/* ===== SECTION 2: RELAXATION ===== */}
<div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
<h6 className="text-[10px] font-bold text-slate-600 uppercase mb-2">🔄 Model-Free Relaxation ({nucleus} @ {fieldMHz} MHz)</h6>
<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
<span className="text-slate-500">R1 (s⁻¹):</span><span className="font-mono font-bold">{rates.R1.toFixed(3)}</span>
<span className="text-slate-500">R2 (s⁻¹):</span><span className="font-mono font-bold">{rates.R2.toFixed(3)}</span>
<span className="text-slate-500">NOE:</span><span className="font-mono font-bold">{rates.NOE.toFixed(3)}</span>
<span className="text-slate-500">R1/R2:</span><span className="font-mono font-bold">{rates.ratio.toFixed(3)}</span>
<span className="text-slate-500">T1 (s):</span><span className="font-mono font-bold">{rates.T1 === Infinity ? '∞' : rates.T1.toFixed(3)}</span>
<span className="text-slate-500">T2 (s):</span><span className="font-mono font-bold">{rates.T2 === Infinity ? '∞' : rates.T2.toFixed(3)}</span>
<span className="text-slate-500">τc:</span><span className="font-mono font-bold">{tau_c_ns.toFixed(2)} ns</span>
<span className="text-slate-500">S²:</span><span className="font-mono font-bold">{S2}</span>
</div>
<div style={{ height: '260px', position: 'relative' }}>
<canvas ref={relaxCanvasRef}></canvas>
</div>
<p className="text-[9px] text-slate-400 italic mt-1">Model-free spectral density: R1 peaks near τc ≈ 1/ω_X. Vertical dashed line marks the actual τc.</p>
</div>
{/* ===== SECTION 3: DIPOLAR + CSA ===== */}
<div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
<h6 className="text-[10px] font-bold text-slate-600 uppercase mb-2">🧲 Dipolar + CSA with Chemical Exchange</h6>
<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
<span className="text-slate-500">Nucleus:</span><span className="font-mono font-bold">{nucleus}</span>
<span className="text-slate-500">Field:</span><span className="font-mono font-bold">{fieldMHz} MHz</span>
<span className="text-slate-500">r(X-H):</span><span className="font-mono font-bold">{rXH} Å</span>
<span className="text-slate-500">CSA Δσ:</span><span className="font-mono font-bold">{csa} ppm</span>
<span className="text-slate-500">S²:</span><span className="font-mono font-bold">{S2}</span>
<span className="text-slate-500">τm:</span><span className="font-mono font-bold">{tau_c_ns.toFixed(2)} ns</span>
<span className="text-slate-500">τe:</span><span className="font-mono font-bold">{sim.useInternal ? `${tau_e} ps` : 'off'}</span>
</div>
<div className="border-t border-slate-200 pt-2 mb-3">
<h6 className="text-[9px] font-bold text-amber-600 uppercase mb-1">Chemical Exchange Contribution</h6>
<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
<span className="text-slate-500">p_B (minor pop.):</span><span className="font-mono font-bold">{pB}</span>
<span className="text-slate-500">Δω (ppm):</span><span className="font-mono font-bold">{deltaW_ex}</span>
<span className="text-slate-500">τ_ex (µs):</span><span className="font-mono font-bold">{tau_ex}</span>
<span className="text-slate-500">R_ex calc (s⁻¹):</span><span className="font-mono font-bold text-amber-700">{Rex_calc.toFixed(3)}</span>
<span className="text-slate-500">R_ex extra (s⁻¹):</span><span className="font-mono font-bold">{Rex_extra}</span>
</div>
</div>
<div className="border-t border-slate-200 pt-2">
<h6 className="text-[9px] font-bold text-blue-600 uppercase mb-1">Relaxation with Exchange</h6>
<div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
<span className="text-slate-500">R1 (s⁻¹):</span><span className="font-mono font-bold">{rates.R1.toFixed(3)}</span>
<span className="text-slate-500">R2 (no exch.) (s⁻¹):</span><span className="font-mono font-bold">{rates.R2.toFixed(3)}</span>
<span className="text-slate-500">R2 + R_ex (s⁻¹):</span><span className="font-mono font-bold text-red-700">{R2_with_ex.toFixed(3)}</span>
<span className="text-slate-500">R1/R2 (with exch.):</span><span className="font-mono font-bold">{R2_with_ex > 0 ? (rates.R1 / R2_with_ex).toFixed(3) : '—'}</span>
</div>
</div>
<p className="text-[9px] text-slate-400 italic mt-2">R_ex = p_A·p_B·Δω²·τ_ex (fast exchange limit)</p>
</div>
</div>
);
};
/* ============================================================================
MD PREVIEW COMPONENTS (for Lab Notebook)
========================================================================== */
export const MDParamsPreview = ({ test }) => {
const ffInfo = getForceFieldInfo(test.forceField || 'GROMOS');
const wmInfo = getWaterModelInfo(test.waterModel || 'TIP3P');
const trajInfo = getTrajectoryFormatInfo(test.trajectoryFormat || 'xtc');
const tsNum = parseMDValue(test.timestep) || 2;
const stepsNum = parseMDValue(test.nSteps) || 500000;
const simTimeNs = (tsNum * stepsNum) / 1e6;
return (
<div className="flex flex-col gap-3 mt-2">
<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
{[
  ['Force Field', `${ffInfo.name} ${test.forceFieldVersion || ''}`],
  ['Water Model', wmInfo.name],
  ['Ensemble', test.ensemble || 'NPT'],
  ['Integrator', test.integrator || 'verlet'],
  ['Timestep', `${tsNum} fs`],
  ['Steps', stepsNum.toLocaleString()],
  ['Sim. Time', `≈ ${simTimeNs.toFixed(3)} ns`],
  ['Temperature', `${test.simTemperature || test.temperature || '300'} K`],
  ['Pressure', `${test.simPressure || test.pressure || '1.0'} bar`],
  ['Thermostat', test.thermostat || 'v_rescale'],
  ['Barostat', test.barostat || 'parrinello_rahman'],
  ['Phase', test.simPhase || 'production'],
].map(([label, value]) => (
  <div key={label} className="bg-slate-50 border border-slate-200 rounded p-2 text-center">
    <span className="text-[9px] text-slate-400 uppercase block">{label}</span>
    <span className="text-[11px] font-mono font-bold text-slate-700">{value}</span>
  </div>
))}
</div>
{test.trajectoryUrl && (
<div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded p-2 text-xs">
  <span className="font-bold text-blue-700">📁 Trajectory:</span>
  <span className="font-mono text-blue-600 truncate flex-1">{test.trajectoryUrl}</span>
  <span className="text-blue-500 font-bold">({trajInfo.label})</span>
  {test.mdNumFrames && <span className="text-blue-500">· {test.mdNumFrames} frames</span>}
</div>
)}
</div>
);
};
const MDAnalysisPreview = ({ test }) => {
const res = (test && test.mdAnalysisResult) || null;
const canvasRefs = { rmsd: useRef(null), rmsf: useRef(null), rg: useRef(null), sasa: useRef(null), energy: useRef(null) };
const chartInstances = useRef({});
useEffect(() => {
  if (!res) return;
  const datasets = {
    rmsd: res.rmsd || [],
    rmsf: (res.rmsf || []).map((d) => ({ ...d, fill: d.value > 0.25 ? '#ef4444' : '#3b82f6' })),
    rg: res.rg || [],
    sasa: res.sasa || [],
    energy: res.energy || [],
  };
  Object.entries(canvasRefs).forEach(([key, ref]) => {
    if (!ref.current || !datasets[key] || !datasets[key].length) return;
    if (chartInstances.current[key]) chartInstances.current[key].destroy();
    let chartData, xLabel, yLabel;
    if (key === 'rmsf') {
      chartData = {
        labels: datasets.rmsf.map(d => d.residue),
        datasets: [{
          label: 'RMSF',
          data: datasets.rmsf.map(d => d.value),
          backgroundColor: datasets.rmsf.map(d => d.fill + '99'),
          borderColor: datasets.rmsf.map(d => d.fill),
          borderWidth: 1,
          type: 'bar'
        }]
      };
      xLabel = 'Residue';
      yLabel = 'RMSF (nm)';
    } else if (key === 'energy') {
      chartData = {
        datasets: [
          { label: 'Potential', data: datasets.energy.map(d => ({ x: d.time, y: d.potential })), borderColor: '#ef4444', borderWidth: 1.5, pointRadius: 0, fill: false },
          { label: 'Kinetic', data: datasets.energy.map(d => ({ x: d.time, y: d.kinetic })), borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, fill: false },
          { label: 'Total', data: datasets.energy.map(d => ({ x: d.time, y: d.total })), borderColor: '#22c55e', borderWidth: 1.5, pointRadius: 0, fill: false }
        ]
      };
      xLabel = 'Time (ps)';
      yLabel = 'Energy (kJ/mol)';
    } else {
      const unit = key === 'sasa' ? 'nm²' : 'nm';
      chartData = {
        datasets: [{
          label: key.toUpperCase(),
          data: datasets[key].map(d => ({ x: d.time, y: d.value })),
          borderColor: key === 'rmsd' ? '#3b82f6' : key === 'rg' ? '#22c55e' : '#f59e0b',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false
        }]
      };
      xLabel = 'Time (ps)';
      yLabel = `${key.toUpperCase()} (${unit})`;
    }
    chartInstances.current[key] = new Chart(ref.current, {
      type: key === 'rmsf' ? 'bar' : 'line',
      data: chartData,
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: key === 'rmsf' ? 'category' : 'linear', title: { display: true, text: xLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } },
          y: { title: { display: true, text: yLabel, font: { size: 10 } }, ticks: { font: { size: 9 } } }
        },
        plugins: { legend: { display: key === 'energy', labels: { font: { size: 9 } } } }
      }
    });
  });
  return () => {
    Object.values(chartInstances.current).forEach(c => { if (c) c.destroy(); });
    chartInstances.current = {};
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [res]);
if (!res) {
  return <p className="text-[10px] text-slate-400 italic">No trajectory analysis saved yet — open the MD test and run “Calculate from trajectory”.</p>;
}
const has = (k) => Array.isArray(res[k]) && res[k].length;
return (
<div className="flex flex-col gap-4 mt-2">
<h5 className="text-[10px] font-bold text-slate-500 uppercase text-center w-full">MD Analysis ({res.nFrames || 0} frames)</h5>
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
{has('rmsd') && (<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">RMSD</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rmsd}></canvas></div>
</div>)}
{has('rmsf') && (<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">RMSF per Residue</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rmsf}></canvas></div>
</div>)}
{has('rg') && (<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">Radius of Gyration</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rg}></canvas></div>
</div>)}
{has('sasa') && (<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">SASA</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.sasa}></canvas></div>
</div>)}
{has('energy') && (<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
<h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">Energy</h6>
<div style={{ height: '220px' }}><canvas ref={canvasRefs.energy}></canvas></div>
</div>)}
</div>
</div>
);
};
export const MDAtomTablePreview = ({ test }) => {
const instances = (Array.isArray(test.instances) && test.instances.length)
? test.instances
: [{ id: 'mdinst_default', name: 'Simulation 1', values: test.mdValues || {} }];
const activeInstance = instances.find(i => i.id === test.activeInstanceId) || instances[0];
const layers = [{ key: 'md', label: 'MD Parameters', unit: '', builtin: true }, ...(Array.isArray(test.parameterLayers) ? test.parameterLayers : [])];
const activeLayerKey = test.activeLayerKey || 'md';
const activeLayer = layers.find(l => l.key === activeLayerKey) || layers[0];
const values = (activeInstance?.values?.[activeLayerKey]) || {};
const entries = Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== '');
if (entries.length === 0) return null;
return (
<div className="mt-4">
<h5 className="text-[10px] font-bold text-slate-500 mb-2 uppercase text-center w-full">Atom Table — {activeLayer.label}</h5>
<ChunkedTable
data={entries}
renderHeader={() => (
  <tr><th className="px-3 py-1.5 border-r">Cell Key</th><th className="px-3 py-1.5">Value {activeLayer.unit ? `(${activeLayer.unit})` : ''}</th></tr>
)}
renderRow={([key, val], i) => (
  <tr key={i}>
    <td className="px-3 py-1.5 font-mono text-slate-700 border-r">{key}</td>
    <td className="px-3 py-1.5 font-mono text-blue-700 font-bold">{val}</td>
  </tr>
)}
/>
</div>
);
};
/* ============================================================================
   IMAGE NORMALIZATION HELPER (For Google Drive links in Notebook)
========================================================================== */
export const normalizeImagePreview = (url) => {
  let u = (url || '').trim();
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  let m = u.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) || u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600`;
  if (u.includes('dropbox.com')) return u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1');
  return u;
};

/* ============================================================================
   NOTEBOOK ANALYSIS PREVIEW REGISTRY
   Maps each test type to the graph(s) shown in the notebook's
   "Data Analysis Graphs" panel. Adding a new test page = add one entry here
   (plus its preview component) instead of editing an if/else chain.
   ========================================================================== */
const DOSYFitPreview = ({ test }) => {
  const tables = Array.isArray(test?.dosyTables) ? test.dosyTables : [];
  const fits = test?.dosyFits || {};
  if (!tables.length) return <p className="text-xs text-slate-400 italic">No DOSY data yet.</p>;
  return (
    <div className="flex flex-col gap-4 mt-2">
      {tables.map((t, i) => {
        const colFits = fits[t.id] || [];
        return (
          <div key={t.id} className="bg-white p-2 rounded border border-slate-200 shadow-sm">
            <h6 className="text-[10px] font-bold text-slate-500 mb-2 uppercase">Gradient set {i + 1} — Stejskal-Tanner fit</h6>
            <table className="border-collapse text-xs w-full">
              <thead><tr className="bg-slate-50"><th className="px-3 py-1.5 border border-slate-200 text-left">Column</th><th className="px-3 py-1.5 border border-slate-200">D (m²/s)</th><th className="px-3 py-1.5 border border-slate-200">I₀</th><th className="px-3 py-1.5 border border-slate-200">R²</th><th className="px-3 py-1.5 border border-slate-200">n</th></tr></thead>
              <tbody>
                {colFits.map((cf, j) => (
                  <tr key={j}>
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
        );
      })}
    </div>
  );
};
export const NOTEBOOK_ANALYSIS_PREVIEWS = {
  plate: [(test) => <PlateAnalysisPreview test={test} />],
  flow_cytometry: [(test, ctx) => <FCSOverlayVisualization ctx={ctx} />],
  cd: [(test, ctx) => <CDAnalysisGraphsPreview test={test} instances={ctx.instances} />],
  nmr: [(test, ctx) => (
    <div className="flex flex-col gap-4 mt-2">
      <PerAtomPlot ctx={ctx} />
      <Fitting ctx={ctx} />
    </div>
  )],
  'nmr-fittings': [(test) => (
    <div className="mt-2">
      <NMRFittingGraphsPreview test={test} />
    </div>
  )],
  dosy: [(test) => (
    <div className="mt-2">
      <DOSYFitPreview test={test} />
    </div>
  )],
  md_simulation: [(test) => <MDAnalysisPreview test={test} />],
};
