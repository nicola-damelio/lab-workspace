import React, { useState, useMemo, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import Chart from 'chart.js/auto';
import { PLATES_DEF, formatConc, concKey, getRegionColor, toHex, lighten, darken, needsDarkText, PALETTE, fit4PL, getDirectImageUrl } from '../data/constants';

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
NOTEBOOK TEST ITEM
========================================================================== */
const NotebookTestItem = ({ test, jumpToTest, showImages, showMap, showData, showGraphs }) => {
  const isPlate = test.type && test.type.startsWith('plate-') && test.type !== 'plate-9x9box';
  const isNMR = test.type === 'nmr';
  const isCD = test.type === 'cd';
  const isNMRFitting = test.type === 'nmr-fittings';
  const isCloning = test.type === 'cloning';
  const isProteinExp = test.type === 'protein_expression';
  const isMD = test.type === 'md_simulation';

  const typeLabel = isPlate ? 'Plate Assay' : isNMR ? 'NMR' : isCD ? 'Circular Dichroism' : isNMRFitting ? 'NMR Fitting' : isCloning ? 'Cloning' : isProteinExp ? 'Protein Expression' : isMD ? 'MD Simulation' : 'Experiment';
  const typeIcon = isPlate ? '🧫' : isNMR ? '📉' : isCD ? '🌀' : isNMRFitting ? '🧭' : isCloning ? '🧬' : isProteinExp ? '🧫' : isMD ? '🖥️' : '🧪';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden break-inside-avoid avoid-break mb-4">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">{typeIcon}</span>
          <div>
            <h3 className="font-bold text-slate-800 text-sm">{test.name}</h3>
            <p className="text-[10px] text-slate-500">
              {test.date} · {test.instanceName || 'Primary'} · {test.testCategory}
              {test.secondaryCategory && ` · ${test.secondaryCategory}`}
              {test.operator && ` · ${test.operator}`}
              {test.plasmid && ` · 🧬 ${test.plasmid}`}
            </p>
          </div>
        </div>
        <button
          onClick={() => jumpToTest(test.id)}
          className="text-[10px] font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Open Test →
        </button>
      </div>

      <div className="px-5 py-4">
        {/* Comments / Notes */}
        {test.comments && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Notes</h4>
            <div className="text-xs text-slate-700 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: test.comments }} />
          </div>
        )}

        {/* Experimental Conditions */}
        <div className="mb-3">
          <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Experimental Conditions</h4>
          <div className="flex flex-wrap gap-2">
            {test.concentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Conc: {test.concentration}</span>}
            {test.solvent && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Solvent: {test.solvent}</span>}
            {test.buffer && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Buffer: {test.buffer}</span>}
            {test.temperature && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">T: {test.temperature}</span>}
            {test.ph && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">pH: {test.ph}</span>}
            {test.pathLength && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Path: {test.pathLength} mm</span>}
            {test.otherMolecule && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ligand: {test.otherMolecule}</span>}
            {test.ratio && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ratio: {test.ratio}</span>}
          </div>
        </div>

        {/* Cell Lines */}
        {test.cellLines && test.cellLines.length > 0 && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Cell Lines / Biological Models</h4>
            <div className="flex flex-wrap gap-1.5">
              {test.cellLines.map((cl) => (
                <span key={cl} className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full font-bold">{cl}</span>
              ))}
            </div>
          </div>
        )}

        {/* CD Structure Composition */}
        {isCD && test.structureComposition && showData && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Secondary Structure</h4>
            <CDStructureChart structureComposition={test.structureComposition} />
          </div>
        )}

        {/* Images */}
        {showImages && test.images && test.images.length > 0 && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Images</h4>
            <div className="flex flex-wrap gap-2">
              {test.images.map((imgSrc, idx) => (
                <a key={idx} href={imgSrc} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={getDirectImageUrl(imgSrc)}
                    alt={`Image ${idx + 1}`}
                    style={{ maxWidth: '200px', maxHeight: '150px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px' }}
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Best Measurement Badge */}
        {test.bestMeasurement && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 border border-amber-300 text-amber-700 px-2 py-0.5 rounded-full">
            ⭐ Best Measurement
          </span>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
LAB NOTEBOOK — MAIN COMPONENT
Merged filters: classification, operator, plasmid, cell line, date range
Removed: redundant test category filter (covered by classification)
Added: plasmid filter
========================================================================== */
export const LabNotebook = ({ tests, allCellLines, testCategories, jumpToTest, customConc, cmpColors, allCmpds, customFields, operators }) => {
  const [filterPrimary, setFilterPrimary] = useState('ALL');
  const [filterSecondary, setFilterSecondary] = useState('ALL');
  const [filterOperator, setFilterOperator] = useState('ALL');
  const [filterPlasmid, setFilterPlasmid] = useState('ALL');
  const [filterCellLine, setFilterCellLine] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bestOnly, setBestOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showImages, setShowImages] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showGraphs, setShowGraphs] = useState(false);
  const [sortBy, setSortBy] = useState('date_desc');

  // Collect all available options from tests
  const allPrimaryCategories = useMemo(() => {
    const cats = new Set();
    tests.forEach(t => { if (t.testCategory) cats.add(t.testCategory); });
    return [...cats].sort();
  }, [tests]);

  const allSecondaryCategories = useMemo(() => {
    const cats = new Set();
    tests.forEach(t => { if (t.secondaryCategory) cats.add(t.secondaryCategory); });
    return [...cats].sort();
  }, [tests]);

  const allOperators = useMemo(() => {
    const ops = new Set();
    tests.forEach(t => { if (t.operator) ops.add(t.operator); });
    // Also merge from operators prop if available
    if (operators && operators.length) {
      operators.forEach(op => {
        const label = typeof op === 'string' ? op : `${op?.name || ''} ${op?.surname || ''}`.trim();
        if (label) ops.add(label);
      });
    }
    return [...ops].sort();
  }, [tests, operators]);

  const allPlasmids = useMemo(() => {
    const pls = new Set();
    tests.forEach(t => {
      if (t.plasmid) pls.add(t.plasmid);
      if (t.plasmids && Array.isArray(t.plasmids)) {
        t.plasmids.forEach(p => pls.add(p));
      }
    });
    return [...pls].sort();
  }, [tests]);

  const allTypes = useMemo(() => {
    const types = new Set();
    tests.forEach(t => { if (t.type) types.add(t.type); });
    return [...types].sort();
  }, [tests]);

  const typeLabels = {
    'plate-96': 'Plate 96', 'plate-48': 'Plate 48', 'plate-24': 'Plate 24', 'plate-12': 'Plate 12', 'plate-6': 'Plate 6', 'plate-1': 'Petri Dish',
    'plate-9x9box': 'Storage Box',
    'nmr': 'NMR', 'cd': 'Circular Dichroism', 'nmr-fittings': 'NMR Fitting',
    'cloning': 'Cloning', 'protein_expression': 'Protein Expression', 'md_simulation': 'MD Simulation'
  };

  // Filtered and sorted tests
  const filteredTests = useMemo(() => {
    let result = tests.filter(t => {
      if (t.type === 'plate-9x9box') return false; // Exclude storage boxes from notebook

      if (filterPrimary !== 'ALL' && t.testCategory !== filterPrimary) return false;
      if (filterSecondary !== 'ALL' && t.secondaryCategory !== filterSecondary) return false;
      if (filterOperator !== 'ALL' && t.operator !== filterOperator) return false;
      if (filterPlasmid !== 'ALL') {
        const hasPlasmid = t.plasmid === filterPlasmid || (t.plasmids && t.plasmids.includes(filterPlasmid));
        if (!hasPlasmid) return false;
      }
      if (filterCellLine !== 'ALL') {
        const hasCellLine = t.cellLines && t.cellLines.includes(filterCellLine);
        if (!hasCellLine) return false;
      }
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      if (bestOnly && !t.bestMeasurement) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchable = [
          t.name, t.comments, t.instanceName, t.testCategory, t.secondaryCategory,
          t.operator, t.plasmid, t.solvent, t.buffer, t.otherMolecule,
          ...(t.cellLines || []),
          ...(t.selectedCompounds || []),
          JSON.stringify(t.customFieldValues || {})
        ].join(' ').toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    // Sort
    if (sortBy === 'date_desc') result.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    else if (sortBy === 'date_asc') result.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    else if (sortBy === 'name') result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'type') result.sort((a, b) => (a.type || '').localeCompare(b.type || ''));

    return result;
  }, [tests, filterPrimary, filterSecondary, filterOperator, filterPlasmid, filterCellLine, filterType, dateFrom, dateTo, bestOnly, searchQuery, sortBy]);

  // Export PDF
  const exportPDF = async () => {
    const el = document.getElementById('notebook-report-container');
    if (!el) return;

    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (loader) loader.style.display = 'flex';
    if (loaderText) loaderText.innerText = 'Generating PDF...';

    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

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
      {/* FILTER BAR — merged classification, operator, plasmid, cell line, type, date, best */}
      <div className="bg-white p-3 md:p-4 border-b border-slate-200 shadow-sm flex flex-col gap-3 no-print shrink-0">
        {/* Search + Sort + Display toggles */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all fields..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
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

        {/* Filter row: Primary, Secondary, Operator, Plasmid, Cell Line, Type */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Primary Class</label>
            <select value={filterPrimary} onChange={(e) => setFilterPrimary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allPrimaryCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Secondary Class</label>
            <select value={filterSecondary} onChange={(e) => setFilterSecondary(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allSecondaryCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Operator</label>
            <select value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allOperators.map(o => <option key={o} value={o}>{o}</option>)}
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
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Test Type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              <option value="ALL">All</option>
              {allTypes.map(t => <option key={t} value={t}>{typeLabels[t] || t}</option>)}
            </select>
          </div>
        </div>

        {/* Date range + Display toggles */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none" />
          </div>
          <div className="flex gap-3 ml-auto">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showImages} onChange={(e) => setShowImages(e.target.checked)} className="accent-blue-600 w-3.5 h-3.5" /> Images
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} className="accent-blue-600 w-3.5 h-3.5" /> Plate Map
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} className="accent-blue-600 w-3.5 h-3.5" /> Data
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer">
              <input type="checkbox" checked={showGraphs} onChange={(e) => setShowGraphs(e.target.checked)} className="accent-blue-600 w-3.5 h-3.5" /> Graphs
            </label>
          </div>
        </div>
      </div>

      {/* RESULTS */}
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
                  jumpToTest={jumpToTest}
                  showImages={showImages}
                  showMap={showMap}
                  showData={showData}
                  showGraphs={showGraphs}
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