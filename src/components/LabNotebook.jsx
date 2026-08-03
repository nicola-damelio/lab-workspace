import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Chart from 'chart.js/auto';
import {
  PLATES_DEF,
  formatConc,
  concKey,
  getRegionColor,
  toHex,
  lighten,
  darken,
  needsDarkText,
  PALETTE,
  fit4PL,
  getDirectImageUrl
} from '../data/constants';
import { RegionCharts } from './PlateTestRenderer';

// --- CD SPECTRA CHART (for Lab Notebook) ---
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
          legend: { position: 'top', labels: { font: { size: 10, weight: 'bold' }, usePointStyle: true } }
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

// --- CD STRUCTURE DOUGHNUT CHART (for Lab Notebook) ---
const CDStructureChart = ({ structureComposition }) => {
  const canvasRef = useRef(null);
  const chartInstance = useRef(null);

  const STRUCTURE_COLORS = {
    'α-Helix': '#3b82f6',
    'β-Sheet': '#ef4444',
    'Turn': '#f59e0b',
    'Random Coil': '#94a3b8',
    'Other': '#8b5cf6'
  };

  useEffect(() => {
    if (!canvasRef.current || !structureComposition) return;
    if (chartInstance.current) chartInstance.current.destroy();

    const labels = Object.keys(structureComposition);
    const values = Object.values(structureComposition);
    if (values.every(v => v === 0)) return;

    const colors = labels.map(l => STRUCTURE_COLORS[l] || '#94a3b8');

    chartInstance.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: '#ffffff', borderWidth: 3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10, weight: 'bold' }, padding: 8, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed.toFixed(1)}%` } }
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

export const LabNotebook = ({ tests, allCellLines, testCategories, jumpToTest, customConc, cmpColors, allCmpds }) => {
  const [sortBy, setSortBy] = useState('date_desc');
  const [filterType, setFilterType] = useState('ALL');
  const [filterCell, setFilterCell] = useState('ALL');
  const [filterCmpd, setFilterCmpd] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showImages, setShowImages] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showGraphs, setShowGraphs] = useState(false);
  const [hiddenTests, setHiddenTests] = useState(new Set());

  const exportPDF = async () => {
    const el = document.getElementById('notebook-report-container');
    if (!el) return;
    const scrollParent = el.closest('.overflow-y-auto') || el;
    const originalOverflow = scrollParent.style.overflow;
    const originalHeight = scrollParent.style.height;
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (loader) loader.style.display = 'flex';
    if (loaderText) loaderText.innerText = 'Generating PDF...';
    const fixedEls = document.querySelectorAll('.fixed, [style*="position: fixed"]');
    fixedEls.forEach(e => e.style.display = 'none');
    const noPrintEls = el.querySelectorAll('.no-print');
    noPrintEls.forEach(e => e.style.display = 'none');
    scrollParent.style.overflow = 'visible';
    scrollParent.style.height = 'auto';
    el.classList.add('pdf-mode');
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 800));
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#f8fafc',
        logging: false,
        imageTimeout: 15000,
        removeContainer: true,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        onclone: (doc) => {
          const elements = doc.querySelectorAll('*');
          elements.forEach(element => {
            try {
              const style = window.getComputedStyle(element);
              if (style.color && style.color.includes('oklch')) {
                element.style.setProperty('color', '#333333', 'important');
              }
              if (style.backgroundColor && style.backgroundColor.includes('oklch')) {
                element.style.setProperty('background-color', '#ffffff', 'important');
              }
              if (style.borderColor && style.borderColor.includes('oklch')) {
                element.style.setProperty('border-color', '#e2e8f0', 'important');
              }
            } catch (err) { }
          });
        }
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight; let position = 0;
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
      console.error(e); alert('Export Failed: ' + e.message);
    } finally {
      el.classList.remove('pdf-mode');
      fixedEls.forEach(e => e.style.display = '');
      noPrintEls.forEach(e => e.style.display = '');
      scrollParent.style.overflow = originalOverflow;
      scrollParent.style.height = originalHeight;
      if (loader) loader.style.display = 'none';
    }
  };

  const filtered = tests.filter(t => {
    if (filterType !== 'ALL' && t.testCategory !== filterType) return false;
    if (filterCell !== 'ALL' && (!t.cellLines || !t.cellLines.includes(filterCell))) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (filterCmpd !== 'ALL') {
      let found = false;
      if (t.type && t.type.startsWith('plate-') && t.type !== 'plate-9x9box') {
        if ((t.compounds || []).includes(filterCmpd)) found = true;
        else if ((t.rowCompounds || []).includes(filterCmpd)) found = true;
        else if (t.cellConfig) {
          t.cellConfig.forEach(row => row.forEach(cell => {
            if (cell.role === filterCmpd) found = true;
          }));
        }
      } else if (t.type === 'plate-9x9box' && t.grid) {
        t.grid.forEach(row => row.forEach(cellStr => {
          try {
            if (typeof cellStr === 'string' && cellStr.startsWith('{')) {
              if (JSON.parse(cellStr).compound === filterCmpd) found = true;
            }
          } catch (e) { }
        }));
      } else if (t.type === 'nmr' || t.type === 'cd') {
        if (t.compound === filterCmpd) found = true;
      }
      if (!found) return false;
    }
    return true;
  });

  const sorted = filtered.sort((a, b) => {
    if (sortBy === 'date_desc') return b.date.localeCompare(a.date);
    if (sortBy === 'date_asc') return a.date.localeCompare(b.date);
    if (sortBy === 'type') return (a.testCategory || '').localeCompare(b.testCategory || '');
    return 0;
  });

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar flex flex-col bg-slate-50">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Lab Notebook</h2>
          <p className="text-sm text-slate-500">Aggregated and filterable view of all your experiments and results.</p>
        </div>
      </div>
      {/* Advanced Filters */}
      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1 w-full md:w-auto flex-1 md:flex-none">
            <label className="text-xs font-bold text-slate-500 uppercase">Sort By</label>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none bg-slate-50 font-semibold text-slate-700">
              <option value="date_desc">Date (Newest First)</option>
              <option value="date_asc">Date (Oldest First)</option>
              <option value="type">Test Type</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto flex-1 md:flex-none">
            <label className="text-xs font-bold text-slate-500 uppercase">Test Category</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none bg-white">
              <option value="ALL">All Categories</option>
              {testCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto flex-1 md:flex-none">
            <label className="text-xs font-bold text-slate-500 uppercase">Cell Line / Detail</label>
            <select value={filterCell} onChange={e => setFilterCell(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none bg-white">
              <option value="ALL">All Associated</option>
              {allCellLines.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto flex-1 md:flex-none">
            <label className="text-xs font-bold text-slate-500 uppercase">Compound / Sample</label>
            <select value={filterCmpd} onChange={e => setFilterCmpd(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none bg-white">
              <option value="ALL">All Compounds</option>
              {allCmpds.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 w-full md:w-auto">
            <label className="text-xs font-bold text-slate-500 uppercase">Date Range</label>
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:border-purple-500 outline-none" />
              <span className="text-slate-400 font-bold">-</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:border-purple-500 outline-none" />
            </div>
          </div>
          <div className="ml-auto w-full md:w-auto flex justify-end items-center gap-4">
            {hiddenTests.size > 0 && (
              <button onClick={() => setHiddenTests(new Set())} className="text-sm font-bold text-blue-500 hover:text-blue-700 underline transition-colors">Restore {hiddenTests.size} Hidden</button>
            )}
            <button onClick={() => { setFilterType('ALL'); setFilterCell('ALL'); setFilterCmpd('ALL'); setDateFrom(''); setDateTo(''); }} className="text-sm font-bold text-slate-500 hover:text-red-500 underline transition-colors">Clear Filters</button>
            <button onClick={exportPDF} className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-2 px-4 rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors ml-2">
              📄 Export PDF
            </button>
          </div>
        </div>
        {/* Report Contents Toggles */}
        <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-6">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center">Include in Report:</span>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
            <input type="checkbox" checked={showImages} onChange={e => setShowImages(e.target.checked)} className="accent-blue-600 w-4 h-4" /> Images & Attachments
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
            <input type="checkbox" checked={showMap} onChange={e => setShowMap(e.target.checked)} className="accent-blue-600 w-4 h-4" /> Metadata & Plate Maps
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
            <input type="checkbox" checked={showData} onChange={e => setShowData(e.target.checked)} className="accent-blue-600 w-4 h-4" /> Raw Data & Tables
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
            <input type="checkbox" checked={showGraphs} onChange={e => setShowGraphs(e.target.checked)} className="accent-blue-600 w-4 h-4" /> Fittings & Graphs
          </label>
        </div>
      </div>
      {/* Report Output */}
      <div id="notebook-report-container" className="flex-1 flex flex-col gap-6 pb-10">
        {sorted.filter(t => !hiddenTests.has(t.id)).length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center text-slate-400 font-bold text-lg shadow-sm">No results match the current filters or all items are hidden.</div>
        ) : (
          sorted.filter(t => !hiddenTests.has(t.id)).map(test => (
            <NotebookTestItem
              key={test.id}
              test={test}
              jumpToTest={jumpToTest}
              onHide={() => { const s = new Set(hiddenTests); s.add(test.id); setHiddenTests(s); }}
              showImages={showImages}
              showMap={showMap}
              showData={showData}
              showGraphs={showGraphs}
              customConc={customConc}
              cmpColors={cmpColors}
              allCmpds={allCmpds}
            />
          ))
        )}
      </div>
    </div>
  );
};

export const NotebookTestItem = ({ test, jumpToTest, onHide, showImages, showMap, showData, showGraphs, customConc, cmpColors, allCmpds }) => {
  const isPlate = test.type && test.type.startsWith('plate-') && test.type !== 'plate-9x9box';
  const isNMR = test.type === 'nmr';
  const isCD = test.type === 'cd';
  const activePlateDim = PLATES_DEF[test.plateType] || PLATES_DEF['96'];
  const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].slice(0, activePlateDim?.rows || 8);
  const COLS = Array.from({ length: activePlateDim?.cols || 12 }, (_, i) => i + 1);

  const getRole = (r, c) => {
    if (!test.cellConfig || !test.cellConfig[r] || !test.cellConfig[r][c]) return null;
    const cfg = test.cellConfig[r][c]; if (cfg.role !== null) return cfg.role;
    const rCmp = test.rowCompounds[r]; const cCmp = test.compounds[c];
    if (rCmp && !cCmp) return rCmp;
    if (cCmp && !rCmp) return cCmp;
    if (!rCmp && !cCmp) return null;
    const isCtrl = x => ['cells', 'medium', 'pbs'].includes(x.toLowerCase());
    if (isCtrl(rCmp) && !isCtrl(cCmp)) return rCmp;
    if (isCtrl(cCmp) && !isCtrl(rCmp)) return cCmp;
    return rCmp;
  };

  const tConc = parseFloat(String(test.topConcStr).replace(',', '.')) || 0;
  const dFact = parseFloat(String(test.dilFactorStr).replace(',', '.')) || 1;
  const cOD = parseFloat(String(test.ctrlODStr).replace(',', '.')) || 0;
  const bgMan = parseFloat(String(test.bgManualStr).replace(',', '.')) || 0;
  const gOff = parseFloat(String(test.glbOffsetStr).replace(',', '.')) || 0;
  const fSD = parseFloat(String(test.fixedSDStr).replace(',', '.')) || 0;
  const eScale = parseFloat(String(test.errScaleStr).replace(',', '.')) || 1;
  const toNum = v => { const n = parseFloat(typeof v === 'string' ? v.trim().replace(',', '.') : v); return isNaN(n) ? NaN : n; };
  const rawOD = (r, c) => { const n = toNum(test.grid[r][c]); return isNaN(n) ? NaN : n - gOff; };

  const concOf = (r, c, role) => {
    const rl = role !== undefined ? role : getRole(r, c);
    if (!rl || ['cells', 'medium', 'pbs'].includes(rl.toLowerCase())) return 0;
    if (test.cellConfig[r][c].conc !== null && test.cellConfig[r][c].conc !== undefined) return Number(test.cellConfig[r][c].conc);
    const s = (customConc[rl]) ? { top: parseFloat(customConc[rl].top) || 0, dil: parseFloat(customConc[rl].dil) || 1 } : { top: tConc, dil: dFact };
    let isHoriz = false; let step = 0;
    if (test.rowCompounds[r] === rl) isHoriz = true; else if (test.compounds[c] === rl) isHoriz = false; else if (test.rowCompounds.includes(rl)) isHoriz = true;
    if (isHoriz) { for (let i = 0; i < c; i++) { if (getRole(r, i) === rl) step++; } }
    else { for (let i = 0; i < r; i++) { if (getRole(i, c) === rl) step++; } }
    return s.top / Math.pow(s.dil, step);
  };

  let bgOD = 0;
  if (test.bgType === 'manual') bgOD = bgMan;
  else if (test.bgType && test.bgType !== 'none' && test.grid) {
    let s = 0, n = 0;
    test.grid.forEach((row, r) => row.forEach((_, c) => {
      if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
      const cfg = test.cellConfig[r][c]; if (cfg.excluded) return;
      if (getRole(r, c) === test.bgType) { const v = rawOD(r, c); if (!isNaN(v)) { s += v; n++; } }
    }));
    bgOD = n > 0 ? s / n : 0;
  }

  const viability = raw => { const net = raw - bgOD, ctrl = cOD - bgOD; return Math.abs(ctrl) < 1e-6 ? 0 : (net / ctrl) * 100; };
  const getManual = (name, realX) => (test.manualErrors && test.manualErrors[name] ? test.manualErrors[name][concKey(realX)] : undefined);
  const effectiveSD = (name, realX, computedSD) => { const m = getManual(name, realX); return typeof m === 'number' ? m : computedSD; };

  const cmpColor = (name, autoIdx) => {
    const stored = cmpColors[name];
    if (stored && /^#[0-9a-f]{6}$/i.test(stored)) return stored.toLowerCase();
    return toHex(PALETTE[autoIdx % PALETTE.length]);
  };

  const cmpStats = useMemo(() => {
    const stats = {};
    if (!isPlate) return stats;
    test.grid.forEach((row, r) => row.forEach((_, c) => {
      if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
      const role = getRole(r, c); const conc = concOf(r, c, role);
      if (role && conc > 0) {
        if (!stats[role]) stats[role] = { min: conc, max: conc };
        else { stats[role].min = Math.min(stats[role].min, conc); stats[role].max = Math.max(stats[role].max, conc); }
      }
    }));
    return stats;
  }, [isPlate, test.grid, test.compounds, test.rowCompounds, test.cellConfig, customConc, tConc, dFact, activePlateDim]);

  const wellColor = (r, c) => {
    const role = getRole(r, c);
    if (!role) return { bg: '#ffffff', dark: true };
    const rl = role.toLowerCase();
    if (rl === 'medium') return { bg: '#ff4d6d', dark: false };
    if (rl === 'pbs') return { bg: '#e5e7eb', dark: true };
    if (rl === 'cells') return { bg: '#fef08a', dark: true };
    const idx = allCmpds.indexOf(role);
    const base = cmpColor(role, idx !== -1 ? idx : 0);
    const conc = concOf(r, c, role);
    if (conc <= 0) return { bg: base, dark: needsDarkText(base) };
    const st = cmpStats[role];
    if (!st || st.min === st.max) return { bg: base, dark: needsDarkText(base) };
    const lc = Math.log10(conc), lx = Math.log10(st.max), ln = Math.log10(st.min);
    const frac = lx > ln ? (lc - ln) / (lx - ln) : 0;
    const bg = frac > 0.5 ? darken(base, (frac - 0.5) * 1.0) : lighten(base, (0.5 - frac) * 0.9);
    return { bg, dark: needsDarkText(bg) };
  };

  const processedByRegion = useMemo(() => {
    if (!showGraphs || !isPlate) return {};
    const byReg = {};
    test.grid.forEach((row, r) => row.forEach((_, c) => {
      if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
      const reg = test.cellConfig[r][c].region || 'Primary';
      if (!byReg[reg]) byReg[reg] = [];
    }));
    const plotCmps = (() => {
      const s = new Set();
      test.compounds.forEach((c, i) => { if (i < activePlateDim.cols && c && !['cells', 'medium', 'pbs'].includes(c.toLowerCase())) s.add(c); });
      test.rowCompounds.forEach((c, i) => { if (i < activePlateDim.rows && c && !['cells', 'medium', 'pbs'].includes(c.toLowerCase())) s.add(c); });
      test.grid.forEach((row, r) => row.forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const role = getRole(r, c); if (role && !['cells', 'medium', 'pbs'].includes(role.toLowerCase())) s.add(role);
      }));
      return Array.from(s);
    })();
    const result = {};
    Object.keys(byReg).forEach(reg => {
      const comps = plotCmps.map((name) => {
        const pts = [];
        test.grid.forEach((row, r) => row.forEach((_, c) => {
          if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
          const cfg = test.cellConfig[r][c];
          if ((cfg.region || 'Primary') !== reg || getRole(r, c) !== name) return;
          const n = rawOD(r, c); if (isNaN(n)) return;
          const xc = concOf(r, c, name); if (!(xc > 0)) return;
          pts.push({ realX: xc, logX: Math.log10(xc), val: viability(n), excl: cfg.excluded, r, c });
        }));
        const byX = {};
        pts.forEach(p => {
          const k = concKey(p.realX); if (!byX[k]) byX[k] = { inc: [], excl: [] };
          (p.excl ? byX[k].excl : byX[k].inc).push(p);
        });
        const vPts = [], ePts = [];
        Object.keys(byX).forEach(ks => {
          const g = byX[ks]; if (g.inc.length === 0 && g.excl.length === 0) return;
          const rep = g.inc[0] || g.excl[0]; const xr = rep.realX, xl = rep.logX;
          if (g.inc.length > 0) {
            const mean = g.inc.reduce((s, p) => s + p.val, 0) / g.inc.length;
            let sd = 0;
            if (test.useFixedSD) sd = fSD; else if (g.inc.length > 1) sd = Math.sqrt(g.inc.reduce((s, p) => s + Math.pow(p.val - mean, 2), 0) / (g.inc.length - 1));
            vPts.push({ x: xl, realX: xr, y: mean, sd: effectiveSD(name, xr, sd), sdRaw: sd, pts: g.inc });
          }
          if (g.excl.length > 0) ePts.push({ x: xl, realX: xr, y: g.excl.reduce((s, p) => s + p.val, 0) / g.excl.length, pts: g.excl });
        });
        vPts.sort((a, b) => a.x - b.x); ePts.sort((a, b) => a.x - b.x);
        if (vPts.length === 0 && ePts.length === 0) return null;
        const color = cmpColor(name, allCmpds.indexOf(name)); let fit = null;
        if (test.fitIC50 && vPts.length >= 3) {
          let sumW = 0;
          const fitData = vPts.map(p => { const w = p.sd > 0 ? 1 / (p.sd * p.sd) : 1; sumW += w; return { x: p.realX, y: p.y, w, sd: p.sd }; });
          if (sumW > 0) fitData.forEach(p => p.w = (p.w / sumW) * fitData.length);
          fit = fit4PL(fitData);
        }
        return { name, color, vPts, ePts, fit };
      }).filter(Boolean);
      if (comps.length > 0) result[reg] = comps;
    });
    return result;
  }, [showGraphs, isPlate, test, activePlateDim, cOD, bgOD, fSD, gOff, allCmpds, cmpColors, customConc, tConc, dFact]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col group avoid-break">
      {/* Header */}
      <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-xl">{isNMR ? '📉' : isCD ? '🌀' : test.type === 'plate-9x9box' ? '📦' : '🧫'}</span>
          <div>
            <h3 className="font-black text-slate-800 text-lg">{test.name}</h3>
            <p className="text-xs text-slate-500 font-medium">Instance: {test.instanceName || 'Primary'} • {test.date}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-wider text-purple-700 bg-purple-100 px-2 py-1 rounded shadow-sm">{test.testCategory}</span>
          <button onClick={() => jumpToTest(test.id)} className="bg-white border border-slate-300 hover:border-blue-400 hover:text-blue-600 text-slate-700 font-bold px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm opacity-0 group-hover:opacity-100 no-print">Open Test</button>
          <button onClick={onHide} className="text-slate-400 hover:text-red-500 font-bold px-2 py-1 text-lg transition-colors no-print" title="Exclude from Report">&times;</button>
        </div>
      </div>
      {/* Body */}
      <div className="p-5 flex flex-col gap-6">
        {/* General Comments */}
        {test.comments ? (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Notebook Entry / Comments</h4>
            <div className="text-sm text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-100 prose max-w-none" dangerouslySetInnerHTML={{ __html: test.comments }}></div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">No notes recorded for this test.</p>
        )}

        {/* Cell Lines */}
        {(test.cellLines && test.cellLines.length > 0) && (
          <div className="flex gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase">Cell Lines:</span>
            <div className="flex flex-wrap gap-1">{test.cellLines.map(c => <span key={c} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-bold">{c}</span>)}</div>
          </div>
        )}

        {/* ===== GENERAL IMAGES (all test types) ===== */}
        {showImages && test.images && test.images.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Attached Images</h4>
            <div className="flex flex-wrap gap-2">
              {test.images.map((imgSrc, idx) => (
                <a key={idx} href={imgSrc} target="_blank" rel="noopener noreferrer">
                  <img src={getDirectImageUrl(imgSrc)} alt={`Attachment ${idx + 1}`} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', pageBreakInside: 'avoid' }} className="rounded border border-slate-200 shadow-sm hover:opacity-80 transition-opacity bg-white" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ===== NMR SPECIFIC ===== */}
        {isNMR && showMap && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Experimental Setup & Metadata</h4>
            <div className="text-sm text-slate-700 grid grid-cols-2 gap-2">
              <div><b>Compound:</b> {test.compound || 'N/A'}</div>
              <div><b>Target Nuclei:</b> {(test.selectedNuclei || []).join(', ')}</div>
              <div><b>Concentration:</b> {test.concentration || 'N/A'}</div>
              <div><b>Solvent:</b> {test.solvent || 'N/A'}</div>
              <div><b>Temperature:</b> {test.temperature || 'N/A'}</div>
              <div><b>Salt:</b> {test.saltConcentration || 'N/A'}</div>
              <div><b>Other Molecule:</b> {test.otherMolecule || 'N/A'}</div>
              <div><b>Ratio:</b> {test.ratio || 'N/A'}</div>
              <div className="col-span-2"><b>Sequence:</b> <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200">{test.proteinSequence || 'None'}</span></div>
            </div>
          </div>
        )}

        {/* NMR Chemical Shifts Table */}
        {isNMR && showData && test.chemicalShifts && Object.keys(test.chemicalShifts).length > 0 && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Chemical Shifts Table</h4>
            <div className="max-h-60 overflow-y-auto custom-scrollbar bg-white border border-slate-200 rounded-lg">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 sticky top-0">
                  <tr><th className="p-2 border-b">Position/Residue</th><th className="p-2 border-b">Atom</th><th className="p-2 border-b">Shift (ppm)</th></tr>
                </thead>
                <tbody>
                  {Object.keys(test.chemicalShifts).map(key => {
                    const [idx, ...atomParts] = key.split('-');
                    const atom = atomParts.join('-');
                    const shift = test.chemicalShifts[key];
                    if (!shift) return null;
                    return (
                      <tr key={key} className="border-b border-slate-50">
                        <td className="p-2 font-bold">{parseInt(idx) + 1}</td>
                        <td className="p-2">{atom}</td>
                        <td className="p-2 font-mono text-blue-700">{shift}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== NMR SPECTRA IMAGES (NEW) ===== */}
        {isNMR && showImages && test.nmrSpectraImages && test.nmrSpectraImages.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">NMR Spectra Images</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {test.nmrSpectraImages.map((imgSrc, idx) => (
                <div key={idx} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">Spectrum {idx + 1}</span>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                    <img
                      src={getDirectImageUrl(imgSrc)}
                      alt={`NMR Spectrum ${idx + 1}`}
                      className="w-full h-auto object-contain rounded bg-white"
                      style={{ minHeight: '100px', maxHeight: '350px' }}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="%23f8fafc"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="%2394a3b8">⚠️ Image could not be loaded</text></svg>';
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== CD SPECIFIC ===== */}
        {isCD && showMap && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Experimental Conditions</h4>
            <div className="text-sm text-slate-700 grid grid-cols-2 md:grid-cols-3 gap-2">
              <div><b>Sample:</b> {test.compound || 'N/A'}</div>
              <div><b>Concentration:</b> {test.concentration || 'N/A'}</div>
              <div><b>Buffer:</b> {test.buffer || test.solvent || 'N/A'}</div>
              <div><b>Temperature:</b> {test.temperature || 'N/A'}</div>
              <div><b>Path Length:</b> {test.pathLength || 'N/A'} mm</div>
              <div><b>Salt:</b> {test.saltConcentration || 'N/A'}</div>
              <div><b>Other Molecule:</b> {test.otherMolecule || 'N/A'}</div>
              <div><b>Ratio:</b> {test.ratio || 'N/A'}</div>
            </div>
          </div>
        )}

        {/* CD Structure Composition (text) */}
        {isCD && showMap && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Structure Composition</h4>
            <div className="text-sm text-slate-700">
              {test.structureComposition ? Object.entries(test.structureComposition).map(([k, v]) => (
                <span key={k} className="inline-block bg-white border border-slate-200 px-2 py-1 rounded mr-2 mb-2 font-mono"><b>{k}:</b> {v}%</span>
              )) : 'No composition data.'}
            </div>
          </div>
        )}

        {/* CD Spectra List */}
        {isCD && showData && test.spectraColumns && test.spectraColumns.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Recorded Spectra</h4>
            <ul className="text-sm list-disc list-inside ml-4 text-slate-700">
              {test.spectraColumns.map((s, idx) => (
                <li key={idx}><span style={{ color: s.color, fontWeight: 'bold' }}>{s.title}</span> - {(s.data || '').split(/[\n,]+/).filter(v => !isNaN(parseFloat(v.trim()))).length} data points</li>
              ))}
            </ul>
          </div>
        )}

        {/* ===== CD SPECTRA GRAPH (NEW) ===== */}
        {isCD && showGraphs && test.spectraColumns && test.spectraColumns.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">CD Spectra Plot</h4>
            <CDSpectraChart
              wavelengthData={test.wavelengthData}
              spectraColumns={test.spectraColumns}
              chartCfg={test.chartCfg}
            />
          </div>
        )}

        {/* ===== CD STRUCTURE DOUGHNUT CHART (NEW) ===== */}
        {isCD && showGraphs && test.structureComposition && (
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Secondary Structure Distribution</h4>
            <CDStructureChart structureComposition={test.structureComposition} />
          </div>
        )}

        {/* ===== CD IMAGES (NEW - explicit) ===== */}
        {isCD && showImages && test.images && test.images.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">CD Experiment Images</h4>
            <div className="flex flex-wrap gap-2">
              {test.images.map((imgSrc, idx) => (
                <a key={idx} href={imgSrc} target="_blank" rel="noopener noreferrer">
                  <img src={getDirectImageUrl(imgSrc)} alt={`CD Image ${idx + 1}`} style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} className="rounded border border-slate-200 shadow-sm hover:opacity-80 transition-opacity bg-white" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Plate Map & Data Grid */}
        {isPlate && (showMap || showData) && (
          <div className="flex flex-col gap-6">
            {showMap && (
              <div className="flex-1 overflow-x-auto bg-slate-50 p-4 rounded-lg border border-slate-200 avoid-break">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Plate Map</h4>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm inline-block min-w-full">
                  <div className="grid gap-1.5 items-center justify-center" style={{ gridTemplateColumns: `30px repeat(${activePlateDim.cols}, minmax(42px, 1fr))` }}>
                    <div />
                    {COLS.map(c => (
                      <div key={c} className="text-center text-xs font-black text-slate-400">{c}</div>
                    ))}
                    {ROWS.map((rl, r) => (
                      <React.Fragment key={rl}>
                        <div className="text-xs font-black text-slate-400 text-center">{rl}</div>
                        {COLS.map((col, c) => {
                          const cfg = test.cellConfig[r][c];
                          const role = getRole(r, c);
                          const { bg, dark } = wellColor(r, c);
                          const conc = concOf(r, c, role);
                          const tc = dark ? 'text-slate-900' : 'text-white';
                          const reg = cfg.region || 'Primary';
                          const regColor = getRegionColor(reg);
                          const hasCustomReg = reg !== 'Primary';
                          return (
                            <div key={col} className="flex justify-center items-center p-0.5 relative rounded" style={{ backgroundColor: hasCustomReg ? regColor + '1a' : 'transparent' }}>
                              <div className="w-10 h-10 rounded-full border border-black/10 flex flex-col items-center justify-center shadow-sm overflow-hidden" style={{ backgroundColor: bg }}>
                                <span className={`font-bold text-[9px] leading-tight truncate max-w-full text-center px-0.5 ${tc}`}>{role || '–'}</span>
                                {role && !['cells', 'pbs', 'medium'].includes(role.toLowerCase()) && (
                                  <span className={`font-bold text-[8px] truncate max-w-full px-0.5 opacity-90 ${tc}`}>{formatConc(conc)}</span>
                                )}
                              </div>
                              {hasCustomReg && (
                                <span className="absolute -top-1 -right-1 text-[7px] font-black z-20 px-0.5 rounded shadow-sm" style={{ color: '#fff', backgroundColor: regColor }}>{reg}</span>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {showData && (
              <div className="flex-1 overflow-x-auto bg-slate-50 p-3 rounded-lg border border-slate-200 avoid-break">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Data ({test.showViab ? 'Viability %' : 'Raw OD'})</h4>
                <table className="w-full text-xs text-center border-collapse bg-white min-w-[400px]">
                  <thead>
                    <tr>
                      <th className="border p-1 bg-slate-100 text-slate-400"></th>
                      {COLS.map(c => <th key={c} className="border p-1 bg-slate-100 text-slate-500">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((rLabel, r) => (
                      <tr key={rLabel}>
                        <td className="border p-1 bg-slate-100 text-slate-500 font-bold">{rLabel}</td>
                        {COLS.map((_, c) => {
                          const n = rawOD(r, c);
                          const val = isNaN(n) ? '' : (test.showViab ? viability(n).toFixed(1) : n.toFixed(3));
                          const isExcl = test.cellConfig[r] && test.cellConfig[r][c] && test.cellConfig[r][c].excluded;
                          return (
                            <td key={c} className={`border p-1 ${isExcl ? 'line-through text-slate-300' : 'text-slate-700 font-medium'}`}>
                              {val || '-'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Fitting Graphs (Plate only) */}
        {isPlate && showGraphs && test.fitIC50 && Object.keys(processedByRegion).length > 0 && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 avoid-break">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Fittings & Graphs</h4>
            {Object.entries(processedByRegion).map(([reg, comps]) => (
              <RegionCharts
                key={reg}
                regionName={reg}
                regionData={comps}
                config={{
                  chartCfg: test.chartCfg,
                  fitIC50: test.fitIC50,
                  showExcl: test.showExcl,
                  eScale: eScale,
                  fsPanel: null,
                  chartH: 500,
                  drWidth: 50,
                  hiddenCmpds: {},
                  unit: test.unit,
                  cellConfig: test.cellConfig,
                  setCellConfig: () => { },
                  activePlateDim,
                  toggleFs: () => { }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
};
