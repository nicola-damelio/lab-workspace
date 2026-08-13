import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Chart from 'chart.js/auto';
import { PLATES_DEF, formatConc, concKey, getRegionColor, toHex, lighten, darken, needsDarkText, PALETTE, fit4PL, getDirectImageUrl } from '../data/constants';
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
  Fitting
} from './NMRSections';
import { CD_FIT_COMPONENTS } from './CDSections';

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

/* ============================================================================
CD STRUCTURE DOUGHNUT CHART (for Lab Notebook)
========================================================================== */
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
          <table className="text-[10px] text-center w-full min-w-[max-content] bg-white">
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
          <table className="text-[10px] text-center w-full min-w-[max-content] bg-white">
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
NOTEBOOK TEST ITEM
========================================================================== */
const NotebookTestItem = ({
  test, tests, jumpToTest,
  showConditions, showMolecularFormula, showInstrumental, showReport, showImages,
  showData, showDataAnalysisGraphs,
  showSimImages, showNMRSpectra, selectedSpectrumTypes = []
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
  const [showNmrSpecLocal, setShowNmrSpecLocal] = useState(showNMRSpectra);

  useEffect(() => setShowCondLocal(showConditions), [showConditions]);
  useEffect(() => setShowMolFormLocal(showMolecularFormula), [showMolecularFormula]);
  useEffect(() => setShowInstLocal(showInstrumental), [showInstrumental]);
  useEffect(() => setShowRepLocal(showReport), [showReport]);
  useEffect(() => setShowImgLocal(showImages), [showImages]);
  useEffect(() => setShowDataLocal(showData), [showData]);
  useEffect(() => setShowAnaLocal(showDataAnalysisGraphs), [showDataAnalysisGraphs]);
  useEffect(() => setShowSimImgLocal(showSimImages), [showSimImages]);
  useEffect(() => setShowNmrSpecLocal(showNMRSpectra), [showNMRSpectra]);

  const mockCtx = useMemo(() => ({
    activeTest: localTest,
    updateActiveTest: (patch) => setLocalTest(prev => ({ ...prev, ...patch })),
    allTests: tests || [],
    instances: (tests || []).filter(t => t.name === localTest.name)
  }), [localTest, tests]);

  const isPlate = localTest.type && localTest.type.startsWith('plate-') && localTest.type !== 'plate-9x9box';
  const isNMR = localTest.type === 'nmr';
  const isCD = localTest.type === 'cd';
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
    if (localTest.sugarChoice) return `${localTest.sugarChoice} (${localTest.sugarAnomer || ''})`;
    if (localTest.lipidChoice) return localTest.lipidChoice;
    return null;
  };
  const molFormula = getMolecularFormula();

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
            <div className="font-mono text-xs break-all bg-slate-50 p-2 rounded border border-slate-200 text-slate-700">
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
        
        {allImages.length > 0 && (
          <RemovablePanel title="Images" visible={showImgLocal} setVisible={setShowImgLocal}>
            <div className="flex flex-col items-center gap-6 mt-2 w-full">
              {allImages.map((img, idx) => (
                <div key={idx} className="flex flex-col items-center gap-1 w-full max-w-[600px]">
                  <a href={typeof img === 'string' ? img : img.url} target="_blank" rel="noopener noreferrer" className="block w-full flex justify-center">
                    <img
                      src={getDirectImageUrl(typeof img === 'string' ? img : img.url)}
                      alt={`Image ${idx + 1}`}
                      style={{ maxWidth: '600px', maxHeight: '450px', width: '100%', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white' }}
                    />
                  </a>
                  <span className="text-[10px] text-slate-500 italic text-center w-full">
                    {(Array.isArray(localTest.figureCaptions) && localTest.figureCaptions[idx]) || (typeof img === 'object' && img.caption) || `Figure ${idx + 1}`}
                  </span>
                </div>
              ))}
            </div>
          </RemovablePanel>
        )}

        <RemovablePanel title="Data" visible={showDataLocal} setVisible={setShowDataLocal}>
          {isPlate && <PlateGridPreview test={localTest} />}
          {isCD && <CDSpectraChart wavelengthData={localTest.wavelengthData} spectraColumns={localTest.spectraColumns} chartCfg={localTest.chartCfg} />}
          
          {isNMR && localTest.chemicalShifts && Object.keys(localTest.chemicalShifts).length > 0 && (
            <div className="overflow-x-auto text-xs border border-slate-200 rounded max-w-md mt-2">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr><th className="px-3 py-1.5">Atom</th><th className="px-3 py-1.5">Shift (ppm)</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(localTest.chemicalShifts).map(([atom, shift]) => (
                    <tr key={atom}>
                      <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold">{atom}</td>
                      <td className="px-3 py-1.5 font-mono text-blue-700">{shift}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isNMRFitting && localTest.fittings && Object.keys(localTest.fittings).length > 0 && (
            <div className="overflow-x-auto text-xs border border-slate-200 rounded max-w-md mt-2">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr><th className="px-3 py-1.5">Parameter</th><th className="px-3 py-1.5">Value</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(localTest.fittings).map(([param, val]) => (
                    <tr key={param}>
                      <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold">{param}</td>
                      <td className="px-3 py-1.5 font-mono text-blue-700">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </RemovablePanel>

        {(isCD || isNMR || isNMRFitting) && (
          <RemovablePanel title="Data Analysis Graphs" visible={showAnaLocal} setVisible={setShowAnaLocal}>
            {isCD && <CDAnalysisGraphsPreview test={localTest} instances={mockCtx.instances} />}
            {isNMR && (
              <div className="flex flex-col gap-4 mt-2">
                <SecondaryShifts ctx={mockCtx} />
                <Fitting ctx={mockCtx} />
              </div>
            )}
            {isNMRFitting && <span className="text-[10px] text-slate-400 italic">No graph rendered in this preview mode.</span>}
          </RemovablePanel>
        )}

        {!isNMR && localTest.simImages && localTest.simImages.length > 0 && (
          <RemovablePanel title="Simulation Images" visible={showSimImgLocal} setVisible={setShowSimImgLocal}>
            <div className="flex flex-col items-center gap-6 mt-2 w-full">
              {localTest.simImages.map((img, idx) => (
                <img key={idx} src={getDirectImageUrl(typeof img === 'string' ? img : img.url)} alt={`Sim ${idx}`} style={{ maxWidth: '600px', maxHeight: '450px', width: '100%', objectFit: 'contain' }} className="rounded-lg shadow-sm border border-slate-200 bg-white" />
              ))}
            </div>
          </RemovablePanel>
        )}

        {(isNMR || isNMRFitting) && selectedSpectrumTypes.length > 0 && (
          <RemovablePanel title="NMR Spectra (Simulated)" visible={showNmrSpecLocal} setVisible={setShowNmrSpecLocal}>
            <div className="mt-2">
              <NMRSpectraPreview test={localTest} selectedTypes={selectedSpectrumTypes} />
            </div>
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
  plasmidMeta, solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments 
}) => {
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

  // Display Toggles
  const [showConditions, setShowConditions] = useState(true);
  const [showMolecularFormula, setShowMolecularFormula] = useState(false);
  const [showInstrumental, setShowInstrumental] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showImages, setShowImages] = useState(true);
  const [showData, setShowData] = useState(false);
  const [showDataAnalysisGraphs, setShowDataAnalysisGraphs] = useState(false);
  const [showSimImages, setShowSimImages] = useState(false);
  const [showNMRSpectra, setShowNMRSpectra] = useState(false);
  
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
  const [selectedSpectrumTypes, setSelectedSpectrumTypes] = useState(NMR_SPECTRUM_TYPES.map((t) => t.id));

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
    let result = tests.filter(t => {
      if (t.type === 'plate-9x9box') return false; 
      
      const flatCompounds = [...new Set([...(t.selectedCompounds || []), ...(t.compoundsSelected || []), ...(t.compound ? t.compound.split(',') : [])])].map(s => s.trim());
      const flatPlasmids = [...new Set([...(t.plasmids || []), ...(t.plasmid ? [t.plasmid] : [])])];

      if (filterPrimary !== 'ALL' && t.testCategory !== filterPrimary) return false;
      if (filterSecondary !== 'ALL' && t.secondaryCategory !== filterSecondary) return false;
      if (filterScientist !== 'ALL' && t.operator !== filterScientist) return false;
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
  }, [tests, filterPrimary, filterSecondary, filterScientist, filterType, filterCompound, filterPlasmid, filterCellLine, showAdvanced, filterSolvent, filterBuffer, filterAdditive, filterInstrument, filterProbe, filterPulseSeq, dateFrom, dateTo, bestOnly, searchQuery, sortBy]);

  const exportPDF = async () => {
    const el = document.getElementById('notebook-report-container');
    if (!el) return;
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (loader) loader.style.display = 'flex';
    if (loaderText) loaderText.innerText = 'Generating PDF...';

    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false });
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
      pdf.save(`Lab_Notebook_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (e) {
      console.error(e);
      alert('Export Failed: ' + e.message);
    } finally {
      if (loader) loader.style.display = 'none';
    }
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

        {/* MAIN FILTERS */}
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
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Scientist</label>
            <select value={filterScientist} onChange={(e) => setFilterScientist(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allScientists.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
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

        {/* ADVANCED FILTERS TOGGLE */}
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
            <input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} className="accent-blue-600" /> Images
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} className="accent-blue-600" /> Data
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showDataAnalysisGraphs} onChange={(e) => setShowDataAnalysisGraphs(e.target.checked)} className="accent-blue-600" /> Data Analysis Graphs
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showSimImages} onChange={(e) => setShowSimImages(e.target.checked)} className="accent-blue-600" /> Sim. Images
          </label>
          
          <div className="flex items-start gap-1 flex-wrap">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showNMRSpectra} onChange={(e) => setShowNMRSpectra(e.target.checked)} className="accent-blue-600" /> NMR Spectra
            </label>
            {showNMRSpectra && (
              <div className="flex flex-wrap items-center gap-1.5 ml-1 bg-white border border-blue-200 rounded-lg px-2 py-1.5">
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.map((t) => t.id))} className="text-[9px] font-bold bg-blue-50 border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100">All</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '1D').map((t) => t.id))} className="text-[9px] font-bold bg-blue-50 border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100">1D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes(NMR_SPECTRUM_TYPES.filter((t) => t.dim === '2D').map((t) => t.id))} className="text-[9px] font-bold bg-blue-50 border border-blue-300 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-100">2D</button>
                <button type="button" onClick={() => setSelectedSpectrumTypes([])} className="text-[9px] font-bold bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-100">None</button>
                <span className="text-slate-200">|</span>
                {NMR_SPECTRUM_TYPES.map((st) => (
                  <label key={st.id} className="flex items-center gap-1 text-[9px] font-bold text-slate-700 cursor-pointer bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
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
                  showNMRSpectra={showNMRSpectra}
                  selectedSpectrumTypes={selectedSpectrumTypes}
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