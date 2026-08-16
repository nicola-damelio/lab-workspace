import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Chart from 'chart.js/auto';
import { PLATES_DEF, formatConc, concKey, getRegionColor, toHex, lighten, darken, needsDarkText, PALETTE, fit4PL, getDirectImageUrl, errBarPlugin } from '../data/constants';
import {
useNmrDerived,
OneDSpectrumPlot,
SpectrumPlot,
HSQCPlot,
CustomXTick1H,
CustomXTick13C,
TICKS_1H,
TICKS_13C,
TICKS_15N,
SecondaryShifts,
PerAtomPlot,
Fitting
} from './NMRSections';
import { CD_FIT_COMPONENTS } from './CDSections';
import {
generateRMSDData, generateRMSFData, generateRgData, generateSASAData, generateEnergyData,
parseMDValue, getForceFieldInfo, getWaterModelInfo, getTrajectoryFormatInfo
} from './MDData';

/* ============================================================================
   CHUNKED TABLE HELPER
   Automatically wraps long datasets into side-by-side table columns.
========================================================================== */
const ChunkedTable = ({ data, renderHeader, renderRow, maxRows = 12 }) => {
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
const CDSpectraChart = ({ wavelengthData, spectraColumns, chartCfg }) => {
  const canvasRef = useRef(null);
  const chartInstance = useRef(null);

  const parsedWavelengths = useMemo(() => {
    if (!wavelengthData) return [];
    return wavelengthData.split(/[\n,]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  }, [wavelengthData]);

  const parsedSpectra = useMemo(() => {
    return (spectraColumns || []).map((col, idx) => {
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
const CloningUvSpectraChart = ({ uvSpectra }) => {
  const canvasRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartInstance.current) chartInstance.current.destroy();

    const datasets = (uvSpectra || []).map((spec, idx) => {
      const color = PALETTE ? toHex(PALETTE[idx % PALETTE.length]) : '#3b82f6';
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
const CloningSimChartPreview = ({ sim }) => {
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

const ProteinChromatogramChart = ({ chromatograms }) => {
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
const NMR_SPECTRUM_TYPES = [
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

const NMRSpectraPreview = ({ test, selectedTypes = [] }) => {
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
const PlateGridPreview = ({ test }) => {
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

const Formula2DPreview = ({ test }) => {
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

const RemovablePanel = ({ title, visible, setVisible, children }) => {
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
      const color = PALETTE ? toHex(PALETTE[c % PALETTE.length]) : '#3b82f6';
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
        colors.push(PALETTE ? toHex(PALETTE[i % PALETTE.length]) : '#3b82f6');
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

    const color = PALETTE ? toHex(PALETTE[colIndex % PALETTE.length]) : '#3b82f6';
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
     result[reg].push({ name, vPts, fit, color: toHex(PALETTE[result[reg].length % PALETTE.length]) });
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
const NMRFittingSimPreview = ({ test }) => {
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
ticks: { font: { size: 9 }, color: '#64748b', callback: (v) => { const log = Math.log10(v); if ([0.1,1,10,50].includes(v)) return v; return null; } },
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
const MDParamsPreview = ({ test }) => {
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
const canvasRefs = { rmsd: useRef(null), rmsf: useRef(null), rg: useRef(null), sasa: useRef(null), energy: useRef(null) };
const chartInstances = useRef({});
const nFrames = parseMDValue(test.mdNumFrames) || 500;
const seqLen = (test.proteinSequence || '').replace(/[^ACDEFGHIKLMNPQRSTVWY]/gi, '').length;
const nResidues = Math.max(1, seqLen || 20);
useEffect(() => {
const datasets = {
rmsd: generateRMSDData(Math.min(nFrames, 500)),
rmsf: generateRMSFData(nResidues),
rg: generateRgData(Math.min(nFrames, 500)),
sasa: generateSASAData(Math.min(nFrames, 500)),
energy: generateEnergyData(Math.min(nFrames, 500))
};
Object.entries(canvasRefs).forEach(([key, ref]) => {
if (!ref.current) return;
if (chartInstances.current[key]) chartInstances.current[key].destroy();
let chartData, xLabel, yLabel;
if (key === 'rmsf') {
  chartData = {
    labels: datasets.rmsf.map(d => d.residue),
    datasets: [{
      label: 'RMSF',
      data: datasets.rmsf.map(d => d.value),
      backgroundColor: datasets.rmsf.map(d => d.value > 0.25 ? '#ef444499' : '#3b82f699'),
      borderColor: datasets.rmsf.map(d => d.value > 0.25 ? '#ef4444' : '#3b82f6'),
      borderWidth: 1,
      type: 'bar'
    }]
  };
  xLabel = 'Residue';
  yLabel = 'RMSF (nm)';
} else if (key === 'energy') {
  chartData = {
    datasets: [
      { label: 'Potential', data: datasets.energy.map(d => ({ x: d.time, y: d.potential })), borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, fill: false },
      { label: 'Total', data: datasets.energy.map(d => ({ x: d.time, y: d.total })), borderColor: '#ef4444', borderWidth: 1.5, pointRadius: 0, fill: false }
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
  type: key === 'rmsf' ? 'bar' : key === 'energy' ? 'line' : 'line',
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
}, [nFrames, nResidues]);
if (!(test.proteinSequence || test.smiles || test.moleculeType)) {
return <p className="text-[10px] text-slate-400 italic">No sequence defined — MD analysis unavailable.</p>;
}
return (
<div className="flex flex-col gap-4 mt-2">
<h5 className="text-[10px] font-bold text-slate-500 uppercase text-center w-full">MD Analysis ({nFrames} frames)</h5>
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">RMSD</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rmsd}></canvas></div>
</div>
<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">RMSF per Residue</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rmsf}></canvas></div>
</div>
<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">Radius of Gyration</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.rg}></canvas></div>
</div>
<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
  <h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">SASA</h6>
  <div style={{ height: '200px' }}><canvas ref={canvasRefs.sasa}></canvas></div>
</div>
</div>
<div className="bg-white p-2 border border-slate-200 rounded shadow-sm">
<h6 className="text-[10px] font-bold text-slate-500 mb-1 text-center uppercase">Energy</h6>
<div style={{ height: '220px' }}><canvas ref={canvasRefs.energy}></canvas></div>
</div>
<p className="text-[9px] text-slate-400 italic text-center">Curves are simulated until a real trajectory analysis is attached.</p>
</div>
);
};
const MDAtomTablePreview = ({ test }) => {
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
   NOTEBOOK TEST ITEM
========================================================================== */
const NotebookTestItem = ({
  test, tests, jumpToTest,
  showConditions, showMolecularFormula, showInstrumental, showReport, showImages,
  showData, showDataAnalysisGraphs,
  showSimImages, selectedSpectrumTypes = [],
  imageScale = 100
}) => {
  const [localTest, setLocalTest] = useState(test);
  useEffect(() => setLocalTest(test), [test]);

  const [showCondLocal, setShowCondLocal] = useState(showConditions);
  const [showMolFormLocal, setShowMolFormLocal] = useState(showMolecularFormula);
  const [showCmpdLocal, setShowCmpdLocal] = useState(true);
  const [showInstLocal, setShowInstLocal] = useState(showInstrumental);
  const [showRepLocal, setShowRepLocal] = useState(showReport);
  const [showImgLocal, setShowImgLocal] = useState(showImages);
  const [showDataLocal, setShowDataLocal] = useState(showData);
  const [showAnaLocal, setShowAnaLocal] = useState(showDataAnalysisGraphs);
  const [showSimImgLocal, setShowSimImgLocal] = useState(showSimImages);
  
  const [showRawNmrData, setShowRawNmrData] = useState(true);

  useEffect(() => setShowCondLocal(showConditions), [showConditions]);
  useEffect(() => setShowMolFormLocal(showMolecularFormula), [showMolecularFormula]);
  useEffect(() => setShowInstLocal(showInstrumental), [showInstrumental]);
  useEffect(() => setShowRepLocal(showReport), [showReport]);
  useEffect(() => setShowImgLocal(showImages), [showImages]);
  useEffect(() => setShowDataLocal(showData), [showData]);
  useEffect(() => setShowAnaLocal(showDataAnalysisGraphs), [showDataAnalysisGraphs]);
  useEffect(() => setShowSimImgLocal(showSimImages), [showSimImages]);

  const mockCtx = useMemo(() => ({
    activeTest: localTest,
    updateActiveTest: (patch) => setLocalTest(prev => ({ ...prev, ...patch })),
    allTests: tests || [],
    instances: (tests || []).filter(t => t.name === localTest.name)
  }), [localTest, tests]);

  const isPlate = localTest.type && localTest.type.startsWith('plate-') && localTest.type !== 'plate-9x9box';
  const isNMR = localTest.type === 'nmr';
  const isCD = localTest.type === 'cd';
  const isDocking = localTest.type === 'docking';
  const isNMRFitting = localTest.type === 'nmr-fittings';
  const isCloning = localTest.type === 'cloning';
  const isProteinExp = localTest.type === 'protein_expression';
  const isMD = localTest.type === 'md_simulation';
  const typeLabel = isPlate ? 'Plate Assay' : isNMR ? 'NMR' : isCD ? 'Circular Dichroism' : isNMRFitting ? 'NMR Fitting' : isCloning ? 'Cloning' : isProteinExp ? 'Protein Expression' : isMD ? 'MD Simulation' : 'Experiment';
  const typeIcon = isPlate ? '🧫' : isNMR ? '📉' : isCD ? '🌀' : isNMRFitting ? '🧭' : isCloning ? '🧬' : isProteinExp ? '🧫' : isMD ? '🖥️' : '🧪';
  
  const compounds = [...new Set([...(localTest.selectedCompounds || []), ...(localTest.compoundsSelected || []), ...(localTest.compound ? localTest.compound.split(',') : [])])].map(s => s.trim()).filter(Boolean);
  const plasmids = [...new Set([...(localTest.plasmids || []), ...(localTest.plasmid ? [localTest.plasmid] : [])])].filter(Boolean);
  
  const allImages = [...(localTest.images || []), ...(localTest.nmrSpectraImages || [])];

  const getMolecularFormula = () => {
    if (localTest.smiles) return localTest.smiles;
    if (localTest.proteinSequence) return localTest.proteinSequence;
    if (localTest.sequence) return localTest.sequence;
    if (localTest.dnaSequence) return localTest.dnaSequence;
    if (localTest.sugarChoice) return `${localTest.sugarChoice} (${localTest.sugarAnomer || ''})`;
    if (localTest.lipidChoice) return localTest.lipidChoice;
    return null;
  };
  const molFormula = getMolecularFormula();

  const simImgList = useMemo(() => {
    const looksLikeImage = (it) => {
      if (typeof it === 'string') return /^(data:image|https?:\/\/|blob:)/i.test(it) || it.startsWith('/') || it.length > 200;
      if (it && typeof it === 'object') return Boolean(it.url || it.dataUrl || it.src || it.image || (typeof it.data === 'string' && it.data.startsWith('data:image')));
      return false;
    };
    const imgSrc = (it) => (typeof it === 'string' ? it : (it.url || it.dataUrl || it.src || it.image || it.data));
    const normalize = (v) => (Array.isArray(v) ? v : [v]).filter(looksLikeImage);

    const collected = [];
    Object.entries(localTest || {}).forEach(([key, val]) => {
      if (/cfg|config|setting|type|html|css/i.test(key)) return;
      if (looksLikeImage(val) || Array.isArray(val)) {
        collected.push(...normalize(val));
      } else if (val && typeof val === 'object') {
        if (/sim|fit/i.test(key)) {
          Object.values(val).forEach(v2 => {
            if (looksLikeImage(v2) || Array.isArray(v2)) {
              collected.push(...normalize(v2));
            } else if (v2 && typeof v2 === 'object') {
              Object.values(v2).forEach(v3 => {
                if (looksLikeImage(v3)) collected.push(...normalize(v3));
              });
            }
          });
        }
        Object.entries(val).forEach(([k2, v2]) => {
          if (/img|image|snapshot|figure|picture|photo/i.test(k2) && (Array.isArray(v2) || looksLikeImage(v2))) {
            collected.push(...normalize(v2));
          }
        });
      }
    });

    const seen = new Set();
    return collected.filter((it) => {
      const s = imgSrc(it);
      if (!s || seen.has(s)) return false;
      seen.add(s);
      return true;
    }).map(imgSrc);
  }, [localTest]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden break-inside-avoid avoid-break mb-4">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">{typeIcon}</span>
          <div>
            <h3 className="font-bold text-slate-800 text-sm">{localTest.name} {localTest.bestMeasurement && '⭐'}</h3>
            <p className="text-[10px] text-slate-500">
              {localTest.date} · {localTest.instanceName || 'Primary'} · {typeLabel}
            </p>
          </div>
        </div>
        <button
          onClick={() => jumpToTest(localTest.id)}
          className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Open Test →
        </button>
      </div>
      <div className="px-5 py-4">
        
        {molFormula && (
          <RemovablePanel title="Molecular Formula / System" visible={showMolFormLocal} setVisible={setShowMolFormLocal}>
            <div className="font-mono text-xs break-all bg-slate-50 p-2 rounded border border-slate-200 text-slate-700 whitespace-pre-wrap">
              {molFormula}
            </div>
            <Formula2DPreview test={localTest} />
          </RemovablePanel>
        )}

        <RemovablePanel title="Experimental Conditions" visible={showCondLocal} setVisible={setShowCondLocal}>
          <div className="flex flex-wrap gap-2">
            {localTest.concentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Conc: {localTest.concentration}</span>}
            {(localTest.solvent || localTest.solventName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Solvent: {localTest.solvent || localTest.solventName}</span>}
            {(localTest.buffer || localTest.bufferName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Buffer: {localTest.buffer || localTest.bufferName}</span>}
            {(localTest.additive || localTest.additiveName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Additive: {localTest.additive || localTest.additiveName} {localTest.additiveConc} {localTest.additiveUnit}</span>}
            {localTest.temperature && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">T: {localTest.temperature}</span>}
            {localTest.ph && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">pH: {localTest.ph}</span>}
            {localTest.saltConcentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Salt: {localTest.saltConcentration}</span>}
            {localTest.otherMolecule && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ligand: {localTest.otherMolecule}</span>}
            {localTest.ratio && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ratio: {localTest.ratio}</span>}
            
            {/* Protein Expression specific fields */}
            {isProteinExp && (
              <>
                {localTest.cultureVolume && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Culture: {localTest.cultureVolume}</span>}
                {localTest.medium && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Medium: {localTest.medium}</span>}
                {localTest.antibiotic && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Antibiotic: {localTest.antibiotic}</span>}
                {localTest.inductionMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Induction: {localTest.inductionMethod}</span>}
                {localTest.iptgConcentration && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">IPTG: {localTest.iptgConcentration}</span>}
                {localTest.inductionOD && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. OD: {localTest.inductionOD}</span>}
                {localTest.inductionTemp && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. Temp: {localTest.inductionTemp}</span>}
                {localTest.inductionDuration && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Ind. Duration: {localTest.inductionDuration}</span>}
                {localTest.harvestOD && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Harvest OD: {localTest.harvestOD}</span>}
                {localTest.lysisMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lysis: {localTest.lysisMethod}</span>}
                {localTest.lysisBuffer && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Lysis Buf: {localTest.lysisBuffer}</span>}
                {localTest.proteaseInhibitors && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Inhibitors: {localTest.proteaseInhibitors}</span>}
                {localTest.proteinTag && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Tag: {localTest.proteinTag}</span>}
                {localTest.cleavageProtease && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Protease: {localTest.cleavageProtease}</span>}
                {localTest.columnType && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Column: {localTest.columnType}</span>}
                {localTest.elutionConditions && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Elution: {localTest.elutionConditions}</span>}
                {localTest.storageBuffer && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Storage Buf: {localTest.storageBuffer}</span>}
              </>
            )}

            {/* Cloning specific fields */}
            {isCloning && (
              <>
                {localTest.vectorBackbone && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Vector: {localTest.vectorBackbone}</span>}
                {localTest.cloningMethod && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Method: {localTest.cloningMethod}</span>}
                {localTest.selectionMarker && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Selection: {localTest.selectionMarker}</span>}
                {localTest.sequencingStatus && <span className="text-[10px] bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono">Seq: {localTest.sequencingStatus}</span>}
              </>
            )}
          </div>
        </RemovablePanel>

        <RemovablePanel title="Compounds & Biologicals" visible={showCmpdLocal} setVisible={setShowCmpdLocal}>
          <div className="flex flex-wrap gap-1.5">
            {compounds.length === 0 && plasmids.length === 0 && (!localTest.cellLines || localTest.cellLines.length === 0) && (
              <span className="text-[10px] text-slate-400 italic">None defined</span>
            )}
            {compounds.map(c => <span key={c} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-bold">{c}</span>)}
            {(localTest.cellLines || []).map(cl => <span key={cl} className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full font-bold">🦠 {cl}</span>)}
            {plasmids.map(p => <span key={p} className="text-[10px] bg-violet-50 border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-bold">🧬 {p}</span>)}
          </div>
        </RemovablePanel>

        <RemovablePanel title="Instrumental Setup" visible={showInstLocal} setVisible={setShowInstLocal}>
          <div className="flex flex-wrap gap-2">
            {(localTest.spectrometer || localTest.instrument || localTest.nmrInstrument) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Instrument: {localTest.spectrometer || localTest.instrument || localTest.nmrInstrument}</span>}
            {(localTest.probe || localTest.nmrProbe) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Probe: {localTest.probe || localTest.nmrProbe}</span>}
            {(localTest.pulseSequence || localTest.experiment || localTest.nmrExperiment) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Pulse Seq: {localTest.pulseSequence || localTest.experiment || localTest.nmrExperiment}</span>}
            {localTest.pathLength && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Path Length: {localTest.pathLength}</span>}
          </div>
        </RemovablePanel>

        {isCloning && (localTest.pcrProgram?.length > 0 || localTest.reactionMix?.length > 0 || localTest.cloningStrategy) && (
          <RemovablePanel title="Cloning Strategy & Setup" visible={showInstLocal} setVisible={setShowInstLocal}>
            {localTest.cloningStrategy && (
              <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded text-xs flex flex-wrap gap-2">
                <span className="font-bold text-slate-600 mt-1">Strategy:</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">{localTest.cloningStrategy.method || 'restriction'}</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Insert: {localTest.cloningStrategy.insertCompound || '—'}</span>
                <span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Vector: {localTest.cloningStrategy.vectorName || '—'}</span>
                {localTest.cloningStrategy.method === 'gibson' ? (
                  <><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Overlap: {localTest.cloningStrategy.overlap || 20} bp</span><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">Pos: {localTest.cloningStrategy.insertionIndex ?? '—'}</span></>
                ) : (
                  <><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">5′ {localTest.cloningStrategy.enzyme5 || '—'}</span><span className="bg-white border border-slate-300 px-2 py-1 rounded shadow-sm">3′ {localTest.cloningStrategy.enzyme3 || '—'}</span></>
                )}
              </div>
            )}

            <div className="flex flex-col lg:flex-row gap-4 w-full">
              {localTest.pcrProgram && localTest.pcrProgram.length > 0 && (
                <div className="flex flex-col items-center flex-1">
                  <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase w-full text-center">Thermal Cycler</h5>
                  <ChunkedTable
                    data={localTest.pcrProgram}
                    renderHeader={() => (
                      <tr><th className="px-3 py-1.5 border-r">Step</th><th className="px-3 py-1.5 border-r">Temp (°C)</th><th className="px-3 py-1.5 border-r">Time</th><th className="px-3 py-1.5">Cycles</th></tr>
                    )}
                    renderRow={(s, i) => (
                      <tr key={s.id || i} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-bold border-r">{s.name}</td><td className="px-3 py-1.5 border-r">{s.temp}</td><td className="px-3 py-1.5 border-r">{s.timeValue} {s.timeUnit}</td><td className="px-3 py-1.5">{s.cycles}</td></tr>
                    )}
                  />
                </div>
              )}
              {localTest.reactionMix && localTest.reactionMix.length > 0 && (
                <div className="flex flex-col items-center flex-1">
                  <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase w-full text-center">Reaction Mix</h5>
                  <ChunkedTable
                    data={localTest.reactionMix}
                    renderHeader={() => (
                      <tr><th className="px-3 py-1.5 border-r">Component</th><th className="px-3 py-1.5 border-r">Stock</th><th className="px-3 py-1.5 border-r">Vol (µL)</th><th className="px-3 py-1.5">Notes</th></tr>
                    )}
                    renderRow={(r, i) => (
                      <tr key={r.id || i} className="hover:bg-slate-50"><td className="px-3 py-1.5 font-bold border-r">{r.name}</td><td className="px-3 py-1.5 border-r">{r.stock}</td><td className="px-3 py-1.5 border-r">{r.volume}</td><td className="px-3 py-1.5 text-slate-500">{r.note}</td></tr>
                    )}
                  />
                </div>
              )}
            </div>
          </RemovablePanel>
        )}

        {(localTest.comments || localTest.report) && (
          <RemovablePanel title="Report" visible={showRepLocal} setVisible={setShowRepLocal}>
            {localTest.comments && (
              <div className="text-xs text-slate-700 prose prose-sm max-w-none mb-2" dangerouslySetInnerHTML={{ __html: localTest.comments }} />
            )}
            {localTest.report && (
              <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded mb-2" dangerouslySetInnerHTML={{ __html: localTest.report }} />
            )}
          </RemovablePanel>
        )}
        
        {(allImages.length > 0 || (localTest.gelImages && localTest.gelImages.length > 0)) && (
          <RemovablePanel title="Images" visible={showImgLocal} setVisible={setShowImgLocal}>
            {allImages.length > 0 && (
              <div className="flex flex-col items-center gap-6 mt-2 w-full">
                {allImages.map((img, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-2 w-full">
                    <a href={typeof img === 'string' ? img : img.url} target="_blank" rel="noopener noreferrer" className="flex justify-center w-full">
                      <img
                        src={getDirectImageUrl(typeof img === 'string' ? img : img.url)}
                        alt={`Image ${idx + 1}`}
                        style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white' }}
                      />
                    </a>
                    <span className="text-[10px] text-slate-500 italic text-center w-full">
                      {(Array.isArray(localTest.figureCaptions) && localTest.figureCaptions[idx]) || (typeof img === 'object' && img.caption) || `Figure ${idx + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {localTest.gelImages && localTest.gelImages.length > 0 && (
              <div className={`flex flex-col items-center w-full ${allImages.length > 0 ? 'mt-6 border-t border-slate-100 pt-4' : 'mt-2'}`}>
                <h5 className="text-[10px] font-bold text-slate-500 mb-2 uppercase text-center w-full">Gel Images</h5>
                <div className="flex flex-col items-center gap-6 w-full">
                  {localTest.gelImages.map((imgSrc, idx) => (
                    <div key={idx} className="flex flex-col items-center gap-2 bg-white p-3 border border-slate-200 rounded shadow-sm w-full">
                      <a href={typeof imgSrc === 'string' ? imgSrc : imgSrc.url} target="_blank" rel="noopener noreferrer" className="flex justify-center w-full">
                        <img
                          src={getDirectImageUrl(typeof imgSrc === 'string' ? imgSrc : imgSrc.url)}
                          alt={`Gel ${idx + 1}`}
                          style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain' }}
                        />
                      </a>
                      <span className="text-[10px] text-slate-500 italic text-center w-full">Gel {idx + 1}</span>
                    </div>
                  ))}
                </div>
                {localTest.gelComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.gelComment}</p>}
              </div>
            )}
          </RemovablePanel>
        )}

        <RemovablePanel title="Data" visible={showDataLocal} setVisible={setShowDataLocal}>
       {isPlate && <PlateGridPreview test={localTest} />}
       {isCD && <CDSpectraChart wavelengthData={localTest.wavelengthData} spectraColumns={localTest.spectraColumns} chartCfg={localTest.chartCfg} />}
       {isCloning && localTest.uvSpectra && localTest.uvSpectra.length > 0 && (
         <CloningUvSpectraChart uvSpectra={localTest.uvSpectra} />
       )}
       {isCloning && localTest.dnaQuantification && localTest.dnaQuantification.length > 0 && (
         <div className="flex flex-col items-center w-full mt-2">
           <ChunkedTable
             data={localTest.dnaQuantification}
             renderHeader={() => (
               <tr><th className="px-3 py-1.5">Sample</th><th className="px-3 py-1.5">Conc. ng/µL</th><th className="px-3 py-1.5">260/280</th><th className="px-3 py-1.5">Notes</th></tr>
             )}
             renderRow={(row, i) => (
               <tr key={row.id || i}>
                 <td className="px-3 py-1.5 font-bold">{row.sample}</td>
                 <td className="px-3 py-1.5 text-blue-700 font-bold">{row.concentration}</td>
                 <td className="px-3 py-1.5">{row.a260_280}</td>
                 <td className="px-3 py-1.5">{row.notes}</td>
               </tr>
             )}
           />
           {localTest.dnaQuantComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.dnaQuantComment}</p>}
         </div>
       )}
       {isProteinExp && (() => {
         const chrs = Array.isArray(localTest.chromatograms) ? localTest.chromatograms : localTest.chromatogramRaw ? [{ id: 'chr_legacy', name: 'Chromatogram 1', method: 'Affinity', rawData: localTest.chromatogramRaw }] : [];
         if (chrs.length > 0) return (
            <div className="mb-4 flex flex-col items-center w-full">
              <div className="overflow-x-auto text-xs border border-slate-200 rounded mt-2 mb-4 flex justify-center w-full bg-slate-50 shadow-sm">
                <table className="w-full text-left select-text bg-white" draggable="true">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-1.5 border-r">Run Name</th>
                      <th className="px-3 py-1.5 border-r">Method Type</th>
                      <th className="px-3 py-1.5">Running Buffer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {chrs.map((chr, idx) => (
                      <tr key={chr.id || idx}>
                        <td className="px-3 py-1.5 font-bold border-r">{chr.name || `Chromatogram ${idx + 1}`}</td>
                        <td className="px-3 py-1.5 text-blue-700 font-bold border-r">{chr.method || '—'}</td>
                        <td className="px-3 py-1.5">{chr.buffer || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="w-full"><ProteinChromatogramChart chromatograms={chrs} /></div>
              {localTest.chromatogramComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.chromatogramComment}</p>}
            </div>
         );
         return null;
       })()}
       {isProteinExp && localTest.yieldData && localTest.yieldData.length > 0 && (
         <div className="mb-4 flex flex-col items-center w-full">
           <ChunkedTable
             data={localTest.yieldData}
             renderHeader={() => (
               <tr><th className="px-3 py-1.5 border-r">Fraction</th><th className="px-3 py-1.5 border-r">Conc (mg/mL)</th><th className="px-3 py-1.5 border-r">Vol (mL)</th><th className="px-3 py-1.5 border-r">Total (mg)</th><th className="px-3 py-1.5">Purity %</th></tr>
             )}
             renderRow={(row, i) => (
               <tr key={row.id || i}>
                 <td className="px-3 py-1.5 font-bold border-r">{row.fraction}</td>
                 <td className="px-3 py-1.5 border-r">{row.concentration}</td>
                 <td className="px-3 py-1.5 border-r">{row.volume}</td>
                 <td className="px-3 py-1.5 text-blue-700 font-bold border-r">{row.totalMass}</td>
                 <td className="px-3 py-1.5">{row.purity}</td>
               </tr>
             )}
           />
           {localTest.yieldComment && <p className="text-[10px] text-slate-500 italic mt-2 text-center w-full">📝 {localTest.yieldComment}</p>}
         </div>
       )}
       {isNMR && localTest.chemicalShifts && Object.keys(localTest.chemicalShifts).length > 0 && (
         <div className="flex flex-col items-center w-full mt-2">
           <ChunkedTable
             data={Object.entries(localTest.chemicalShifts)}
             renderHeader={() => (
               <tr><th className="px-4 py-2 border-r">Atom</th><th className="px-4 py-2">Shift (ppm)</th></tr>
             )}
             renderRow={([atom, shift], i) => (
               <tr key={atom || i}>
                 <td className="px-4 py-2 font-mono text-slate-700 font-semibold border-r">{atom}</td>
                 <td className="px-4 py-2 font-mono text-blue-700">{shift}</td>
               </tr>
             )}
           />
         </div>
        )}
        {/* 1D imported Bruker spectrum in LabNotebook (Data tick) */}
        {isNMR && localTest.nmr1dSpectrum && localTest.nmr1dSpectrum.xs && localTest.nmr1dSpectrum.xs.length > 0 && (() => {
          const spec = localTest.nmr1dSpectrum;
          const xs = spec.xs;
          const ys = spec.ys;
          const maxY = Math.max(...ys.map(Math.abs), 1);
          const svgW = 480, svgH = 120;
          const xMin = Math.min(...xs), xMax = Math.max(...xs);
          const step = Math.max(1, Math.floor(xs.length / 1200));
          const pts = [];
          for (let i = 0; i < xs.length; i += step) {
            const px = svgW - ((xs[i] - xMin) / (xMax - xMin)) * svgW; // reversed (high ppm left)
            const py = svgH - ((ys[i] / maxY) * 0.9 + 0.05) * svgH;
            pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
          }
          return (
            <div className="flex flex-col items-center w-full mt-2 gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Imported 1r Spectrum — {spec.meta?.nucleus || 'NMR'}{spec.meta?.sfo1 ? ` (${spec.meta.sfo1.toFixed(0)} MHz)` : ''}</span>
              <svg width="100%" viewBox={`0 0 ${svgW} ${svgH + 20}`} className="border border-slate-200 rounded bg-white">
                <polyline points={pts.join(' ')} fill="none" stroke="#3b82f6" strokeWidth="1" />
                <text x={svgW} y={svgH + 15} textAnchor="end" fontSize="8" fill="#94a3b8">{xMin.toFixed(1)} ppm</text>
                <text x="0" y={svgH + 15} textAnchor="start" fontSize="8" fill="#94a3b8">{xMax.toFixed(1)} ppm</text>
              </svg>
            </div>
          );
        })()}
        {isNMRFitting && localTest.nmrTables && localTest.nmrTables.length > 0 && (
         <div className="flex flex-col gap-4 mt-2">
           <div className="flex justify-between items-center border-b border-slate-100 pb-2">
             <span className="text-[10px] font-bold text-slate-500 uppercase">NMR Fitting Data</span>
             <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer bg-white px-2 py-1 rounded border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors">
               <input type="checkbox" checked={showRawNmrData} onChange={(e) => setShowRawNmrData(e.target.checked)} className="accent-blue-600" /> Show Raw Data
             </label>
           </div>
           <div className="flex flex-col gap-6 items-center">
             {localTest.nmrTables.map((t, idx) => {
               const cols = localTest.savedFits?.[t.id] || [];
               return (
                 <div key={t.id} className="flex flex-col gap-3 w-full items-center">
                   {showRawNmrData && (
                     <div className="overflow-x-auto text-xs border border-slate-200 rounded flex flex-col items-center bg-slate-50 shadow-sm w-full">
                       <h5 className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 border-b border-slate-200 w-full text-center">
                         Table {idx + 1} Raw Data — {t.atom} ({t.relaxType})
                       </h5>
                       <table className="w-full text-center select-text bg-white" draggable="true">
                         <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                           <tr>
                             <th className="px-3 py-1.5 border-r border-slate-200">{t.relaxType === 'DOSY' ? 'b-value' : 'Delay'} ({t.delayUnit})</th>
                             {Array.from({ length: t.nCols }, (_, c) => <th key={c} className="px-3 py-1.5">{t.colResidues[c] || `Col ${c + 1}`}</th>)}
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-100">
                           {Array.from({ length: t.nRows }, (_, r) => (
                             <tr key={r}>
                               <td className="px-3 py-1.5 font-mono text-slate-700 border-r border-slate-200">{t.delays[r] !== '' && t.delays[r] !== undefined ? t.delays[r] : '-'}</td>
                               {Array.from({ length: t.nCols }, (_, c) => <td key={c} className="px-3 py-1.5 font-mono text-slate-600">{t.grid[r]?.[c] || '-'}</td>)}
                             </tr>
                           ))}
                         </tbody>
                       </table>
                     </div>
                   )}
                   {cols.length > 0 && (
                     <div className="flex flex-col items-center bg-slate-50 w-full rounded border border-slate-200 pb-2 shadow-sm">
                       <h5 className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 border-b border-slate-200 w-full text-center mb-2">
                         Table {idx + 1} Fitted Parameters
                       </h5>
                       <ChunkedTable
                         data={cols.filter(cf => cf.fit)}
                         renderHeader={() => (
                           <tr>
                             <th className="px-3 py-1.5 border-r">Residue</th>
                             <th className="px-3 py-1.5 border-r">Rate (s⁻¹)</th>
                             <th className="px-3 py-1.5 border-r">Time (s)</th>
                             <th className="px-3 py-1.5">R²</th>
                           </tr>
                         )}
                         renderRow={(cf, i) => (
                           <tr key={i}>
                             <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold border-r">{cf.residue}</td>
                             <td className="px-3 py-1.5 font-mono text-blue-700 border-r">
                               {cf.fit.R_s ? cf.fit.R_s.toPrecision(4) : '-'}
                               {cf.effectiveError ? ` ± ${cf.effectiveError.toPrecision(2)}` : ''}
                             </td>
                             <td className="px-3 py-1.5 font-mono text-blue-700 border-r">
                               {cf.fit.T_s === Infinity ? '∞' : cf.fit.T_s ? cf.fit.T_s.toPrecision(4) : '-'}
                             </td>
                             <td className="px-3 py-1.5 font-mono text-slate-600">{cf.fit.r2 ? cf.fit.r2.toFixed(3) : '-'}</td>
                           </tr>
                         )}
                       />
                     </div>
                   )}
                 </div>
               );
             })}
           </div>
         </div>
       )}
       {isMD && (
         <div className="flex flex-col gap-4 mt-2">
           <MDParamsPreview test={localTest} />
           <MDAtomTablePreview test={localTest} />
         </div>
       )}
        </RemovablePanel>

 

     {(isCD || isNMR || isNMRFitting || isPlate || isMD) && (
       <RemovablePanel title="Data Analysis Graphs" visible={showAnaLocal} setVisible={setShowAnaLocal}>
         {isPlate && <PlateAnalysisPreview test={localTest} />}
         {isCD && <CDAnalysisGraphsPreview test={localTest} instances={mockCtx.instances} />}
         {isNMR && (
           <div className="flex flex-col gap-4 mt-2">
             <PerAtomPlot ctx={mockCtx} />
             <Fitting ctx={mockCtx} />
           </div>
         )}
         {isNMRFitting && (
           <div className="mt-2">
             <NMRFittingGraphsPreview test={localTest} />
           </div>
         )}
         {isMD && <MDAnalysisPreview test={localTest} />}
       </RemovablePanel>
     )}

     {showSimImgLocal && (
       <RemovablePanel title="Simulations & Generated Data" visible={showSimImgLocal} setVisible={setShowSimImgLocal}>
         {isCloning && localTest.sim && localTest.sim.sequence && (
           <CloningSimChartPreview sim={localTest.sim} />
         )}
         {isNMRFitting && (
           <NMRFittingSimPreview test={localTest} />
         )}
         {isNMR && selectedSpectrumTypes.length > 0 && (
           <div className="mt-4">
             <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">NMR Spectra (Simulated)</h5>
             <NMRSpectraPreview test={localTest} selectedTypes={selectedSpectrumTypes} />
           </div>
         )}
         {simImgList.length > 0 && (
           <div className="flex flex-col items-center gap-6 mt-4 pt-4 border-t border-slate-100 w-full">
             <h5 className="text-[10px] font-bold text-slate-500 mb-1 uppercase text-center w-full">Generic Simulation Images</h5>
             {simImgList.map((src, idx) => (
               <div key={idx} className="flex flex-col items-center gap-2 w-full">
                 <img src={getDirectImageUrl(src)} alt={`Sim ${idx}`} style={{ maxWidth: '100%', width: `${imageScale}%`, height: 'auto', maxHeight: '1125px', objectFit: 'contain' }} className="rounded-lg shadow-sm border border-slate-200 bg-white" />
               </div>
             ))}
           </div>
         )}
         {!isNMRFitting && !(isCloning && localTest.sim?.sequence) && !(isNMR && selectedSpectrumTypes.length > 0) && simImgList.length === 0 && (
            <p className="text-[10px] text-slate-400 italic">No simulation data available for this experiment.</p>
         )}
       </RemovablePanel>
     )}

      </div>
    </div>
  );
};

/* ============================================================================
   LAB NOTEBOOK — MAIN COMPONENT
========================================================================== */
export const LabNotebook = ({ 
  tests, allCellLines, testCategories, jumpToTest, customConc, cmpColors, allCmpds, customFields, operators,
  plasmidMeta, solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments, currentUser
}) => {
  const isSuperuser = currentUser?.role === 'superuser';
  const [filterPrimary, setFilterPrimary] = useState('ALL');
  const [filterSecondary, setFilterSecondary] = useState('ALL');
  const [filterScientist, setFilterScientist] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [filterCompound, setFilterCompound] = useState('ALL');
  const [filterPlasmid, setFilterPlasmid] = useState('ALL');
  const [filterCellLine, setFilterCellLine] = useState('ALL');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterSolvent, setFilterSolvent] = useState('ALL');
  const [filterBuffer, setFilterBuffer] = useState('ALL');
  const [filterAdditive, setFilterAdditive] = useState('ALL');
  const [filterInstrument, setFilterInstrument] = useState('ALL');
  const [filterProbe, setFilterProbe] = useState('ALL');
  const [filterPulseSeq, setFilterPulseSeq] = useState('ALL');

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bestOnly, setBestOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  
  const [imageScale, setImageScale] = useState(100);

  // Display Toggles
  const [showConditions, setShowConditions] = useState(true);
  const [showMolecularFormula, setShowMolecularFormula] = useState(false);
  const [showInstrumental, setShowInstrumental] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showImages, setShowImages] = useState(true);
  const [showData, setShowData] = useState(false);
  const [showDataAnalysisGraphs, setShowDataAnalysisGraphs] = useState(false);
  const [showSimImages, setShowSimImages] = useState(false);
  
  // Option Lists
  const allPrimaryCategories = useMemo(() => [...new Set(tests.map(t => t.testCategory).filter(Boolean))].sort(), [tests]);
  const allSecondaryCategories = useMemo(() => [...new Set(tests.map(t => t.secondaryCategory).filter(Boolean))].sort(), [tests]);
  const allScientists = useMemo(() => [...new Set([...operators, ...tests.map(t => t.operator)].filter(Boolean))].sort(), [tests, operators]);
  const allTypes = useMemo(() => [...new Set(tests.map(t => t.type).filter(Boolean))].sort(), [tests]);
  const allPlasmids = useMemo(() => Object.keys(plasmidMeta || {}).sort(), [plasmidMeta]);
  const allSolvents = useMemo(() => (solvents || []).map(s => s.name || s).filter(Boolean).sort(), [solvents]);
  const allBuffers = useMemo(() => (buffers || []).map(b => b.name || b).filter(Boolean).sort(), [buffers]);
  const allAdditives = useMemo(() => (additives || []).map(a => a.name || a).filter(Boolean).sort(), [additives]);
  const allInstruments = useMemo(() => (nmrInstruments || []).map(i => i.name || i).filter(Boolean).sort(), [nmrInstruments]);
  const allProbes = useMemo(() => (nmrProbes || []).map(p => p.name || p).filter(Boolean).sort(), [nmrProbes]);
  const allPulseSeqs = useMemo(() => (nmrExperiments || []).map(e => e.name || e).filter(Boolean).sort(), [nmrExperiments]);
  const [selectedSpectrumTypes, setSelectedSpectrumTypes] = useState(['hsqc', 'hsqc15n']);

  const toggleSpectrumType = (id) =>
    setSelectedSpectrumTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const typeLabels = {
    'plate-96': 'Plate 96', 'plate-48': 'Plate 48', 'plate-24': 'Plate 24', 'plate-12': 'Plate 12', 'plate-6': 'Plate 6', 'plate-1': 'Petri Dish',
    'plate-9x9box': 'Storage Box',
    'nmr': 'NMR', 'cd': 'Circular Dichroism', 'nmr-fittings': 'NMR Fitting',
    'cloning': 'Cloning', 'protein_expression': 'Protein Expression', 'md_simulation': 'MD Simulation'
  };

  const filteredTests = useMemo(() => {
    // Helper: get all scientists assigned to a test (primary + co-scientists)
    const getTestScientists = (t) => {
      const all = [];
      if (t.operator) all.push(t.operator);
      if (Array.isArray(t.coScientists)) all.push(...t.coScientists);
      return all;
    };

    let result = tests.filter(t => {
      if (t.type === 'plate-9x9box') return false;

      // Normal users only see their own experiments (primary or co-scientist).
      // Unassigned tests (no scientists) are superuser-only.
      if (!isSuperuser && currentUser) {
        const scientists = getTestScientists(t);
        if (!scientists.includes(currentUser.name)) return false;
      }

      const flatCompounds = [...new Set([...(t.selectedCompounds || []), ...(t.compoundsSelected || []), ...(t.compound ? t.compound.split(',') : [])])].map(s => s.trim());
      const flatPlasmids = [...new Set([...(t.plasmids || []), ...(t.plasmid ? [t.plasmid] : [])])];

      if (filterPrimary !== 'ALL' && t.testCategory !== filterPrimary) return false;
      if (filterSecondary !== 'ALL' && t.secondaryCategory !== filterSecondary) return false;
      // Scientist filter: only active for superusers (normal users already pre-filtered above)
      if (isSuperuser && filterScientist !== 'ALL') {
        const scientists = getTestScientists(t);
        if (!scientists.includes(filterScientist)) return false;
      }
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (filterCompound !== 'ALL' && !flatCompounds.includes(filterCompound)) return false;
      if (filterPlasmid !== 'ALL' && !flatPlasmids.includes(filterPlasmid)) return false;
      if (filterCellLine !== 'ALL' && (!t.cellLines || !t.cellLines.includes(filterCellLine))) return false;

      if (showAdvanced) {
        const testStr = JSON.stringify(t).toLowerCase();
        
        if (filterSolvent !== 'ALL' && !testStr.includes(filterSolvent.toLowerCase())) return false;
        if (filterBuffer !== 'ALL' && !testStr.includes(filterBuffer.toLowerCase())) return false;
        if (filterAdditive !== 'ALL' && !testStr.includes(filterAdditive.toLowerCase())) return false;
        if (filterInstrument !== 'ALL' && !testStr.includes(filterInstrument.toLowerCase())) return false;
        if (filterProbe !== 'ALL' && !testStr.includes(filterProbe.toLowerCase())) return false;
        if (filterPulseSeq !== 'ALL' && !testStr.includes(filterPulseSeq.toLowerCase())) return false;
      }

      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (bestOnly && !t.bestMeasurement) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchable = JSON.stringify(t).toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    if (sortBy === 'date_desc') result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    else if (sortBy === 'date_asc') result.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    else if (sortBy === 'name') result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'type') result.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

    return result;
  }, [tests, isSuperuser, currentUser, filterPrimary, filterSecondary, filterScientist, filterType, filterCompound, filterPlasmid, filterCellLine, showAdvanced, filterSolvent, filterBuffer, filterAdditive, filterInstrument, filterProbe, filterPulseSeq, dateFrom, dateTo, bestOnly, searchQuery, sortBy]);

  const exportPDF = () => {
    // Use window.print() with a notebook-specific body class.
    // This avoids the oklch color parsing issue in html2canvas
    // and gives proper multi-page PDF output.
    document.body.classList.add('notebook-print-mode');
    window.print();
    // Clean up after print dialog closes
    const cleanup = () => {
      document.body.classList.remove('notebook-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Fallback cleanup after 3s in case afterprint doesn't fire
    setTimeout(cleanup, 3000);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="bg-white p-3 md:p-4 border-b border-slate-200 shadow-sm flex flex-col gap-3 no-print shrink-0">
        
        {/* TOP CONTROLS */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Search</label>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search all fields..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sort</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
              <option value="date_desc">Date (newest)</option>
              <option value="date_asc">Date (oldest)</option>
              <option value="name">Name</option>
              <option value="type">Type</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pb-2">
            <input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} className="accent-amber-600 w-4 h-4" />
            ⭐ Best Only
          </label>
          <button onClick={exportPDF} className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-2 px-4 rounded-lg text-xs flex items-center gap-2 shadow-sm transition-colors">
            📄 Export PDF
          </button>
        </div>

        {/* MAIN FILTERS — all users see all filters except Scientist which is superuser-only */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Main classification</label>
            <select value={filterPrimary} onChange={(e) => setFilterPrimary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allPrimaryCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sub-classification</label>
            <select value={filterSecondary} onChange={(e) => setFilterSecondary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allSecondaryCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Scientist filter — superuser only */}
          {isSuperuser && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Scientist</label>
              <select value={filterScientist} onChange={(e) => setFilterScientist(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                <option value="ALL">All</option>
                {allScientists.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Experiment type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allTypes.map(t => <option key={t} value={t}>{typeLabels[t] || t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Compound</label>
            <select value={filterCompound} onChange={(e) => setFilterCompound(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allCmpds.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Plasmid</label>
            <select value={filterPlasmid} onChange={(e) => setFilterPlasmid(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allPlasmids.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Cell Line</label>
            <select value={filterCellLine} onChange={(e) => setFilterCellLine(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {(allCellLines || []).map(cl => <option key={cl} value={cl}>{cl}</option>)}
            </select>
          </div>
        </div>

        {/* Normal user info badge */}
        {!isSuperuser && currentUser && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            🧪 Showing your experiments — <strong>{currentUser.name}</strong>
          </div>
        )}

        {/* ADVANCED FILTERS toggle — all users */}
        <div>
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs font-bold text-blue-600 underline">
            {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-slate-50 p-2 rounded border border-slate-200">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Solvent</label>
              <select value={filterSolvent} onChange={(e) => setFilterSolvent(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allSolvents.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Buffer</label>
              <select value={filterBuffer} onChange={(e) => setFilterBuffer(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allBuffers.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Additive</label>
              <select value={filterAdditive} onChange={(e) => setFilterAdditive(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allAdditives.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Instrument</label>
              <select value={filterInstrument} onChange={(e) => setFilterInstrument(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allInstruments.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Probe</label>
              <select value={filterProbe} onChange={(e) => setFilterProbe(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allProbes.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">NMR Pulse Sequence</label>
              <select value={filterPulseSeq} onChange={(e) => setFilterPulseSeq(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none">
                <option value="ALL">All</option>{allPulseSeqs.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* DISPLAY OPTIONS */}
        <div className="flex flex-wrap gap-2 items-center bg-blue-50 p-2 rounded border border-blue-100">
          <span className="text-[10px] font-bold text-blue-800 uppercase mr-2">Display Options:</span>
          
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showConditions} onChange={(e) => setShowConditions(e.target.checked)} className="accent-blue-600" /> Exp. Conditions
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showMolecularFormula} onChange={(e) => setShowMolecularFormula(e.target.checked)} className="accent-blue-600" /> Mol. Formula
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showInstrumental} onChange={(e) => setShowInstrumental(e.target.checked)} className="accent-blue-600" /> Instrumental Setup
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showReport} onChange={(e) => setShowReport(e.target.checked)} className="accent-blue-600" /> Report
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} className="accent-blue-600" /> Data
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showDataAnalysisGraphs} onChange={(e) => setShowDataAnalysisGraphs(e.target.checked)} className="accent-blue-600" /> Data Analysis Graphs
          </label>
          
          <div className="flex items-center gap-3 border-l border-blue-200 pl-3 ml-1 bg-white px-2 py-1 rounded shadow-sm">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} className="accent-blue-600" /> Images
            </label>
            <div className="h-3 w-px bg-slate-200 mx-1"></div>
            <label className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
              🖼️ Size: {imageScale}%
            </label>
            <input type="range" min="20" max="200" step="10" value={imageScale} onChange={(e) => setImageScale(Number(e.target.value))} className="w-20 accent-blue-600" />
          </div>

          <div className="flex items-center gap-2 border-l border-blue-200 pl-2 ml-1">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showSimImages} onChange={(e) => setShowSimImages(e.target.checked)} className="accent-blue-600" /> Sim. Images
            </label>
            {showSimImages && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-slate-500 uppercase ml-1">NMR Spectra:</span>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">All</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '1D').map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">1D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '2D').map((t) => t.id))} className="text-[9px] font-bold bg-white border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-50 shadow-sm">2D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes([])} className="text-[9px] font-bold bg-white border border-red-300 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 shadow-sm">None</button>
                <div className="h-3 w-px bg-blue-200 mx-1"></div>
                {NMR_SPECTRUM_TYPES.map((st) => (
                  <label key={st.id} className="flex items-center gap-1 text-[9px] font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                    <input type="checkbox" checked={selectedSpectrumTypes.includes(st.id)} onChange={() => toggleSpectrumType(st.id)} className="accent-blue-600" />
                    {st.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

 <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
        {/* Global image visibility CSS — covers ALL img tags including those in HTML content */}
        <style>{`
          #notebook-report-container img { display: ${showImages ? 'block' : 'none'} !important; }
          #notebook-report-container figure { display: ${showImages ? 'block' : 'none'} !important; }
        `}</style>
        <div id="notebook-report-container" className="flex flex-col gap-4 max-w-5xl mx-auto">
          {filteredTests.length === 0 ? (
            <div className="text-center py-16 text-slate-400 italic bg-white rounded-xl border border-dashed border-slate-300">
              No experiments match the current filters.
            </div>
          ) : (
            <>
              <p className="text-[10px] text-slate-400 font-bold uppercase">{filteredTests.length} experiment(s) found</p>
              {filteredTests.map((test) => (
                <NotebookTestItem
                  key={test.id}
                  test={test}
                  tests={tests}
                  jumpToTest={jumpToTest}
                  showConditions={showConditions}
                  showMolecularFormula={showMolecularFormula}
                  showInstrumental={showInstrumental}
                  showReport={showReport}
                  showImages={showImages}
                  showData={showData}
                  showDataAnalysisGraphs={showDataAnalysisGraphs}
                  showSimImages={showSimImages}
                  selectedSpectrumTypes={selectedSpectrumTypes}
                  imageScale={imageScale}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabNotebook;