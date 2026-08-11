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
/* ============================================================================
NOTEBOOK TEST ITEM
========================================================================== */
const NotebookTestItem = ({ 
  test, jumpToTest, 
  showConditions, showInstrumental, showReport, showImages, 
  showData, showDataAnalysisGraphs, showDataTables, 
  showSimImages, showNMRSpectra, selectedSpectrumType 
}) => {
  const isPlate = test.type && test.type.startsWith('plate-') && test.type !== 'plate-9x9box';
  const isNMR = test.type === 'nmr';
  const isCD = test.type === 'cd';
  const isNMRFitting = test.type === 'nmr-fittings';
  const isCloning = test.type === 'cloning';
  const isProteinExp = test.type === 'protein_expression';
  const isMD = test.type === 'md_simulation';

  const typeLabel = isPlate ? 'Plate Assay' : isNMR ? 'NMR' : isCD ? 'Circular Dichroism' : isNMRFitting ? 'NMR Fitting' : isCloning ? 'Cloning' : isProteinExp ? 'Protein Expression' : isMD ? 'MD Simulation' : 'Experiment';
  const typeIcon = isPlate ? '🧫' : isNMR ? '📉' : isCD ? '🌀' : isNMRFitting ? '🧭' : isCloning ? '🧬' : isProteinExp ? '🧫' : isMD ? '🖥️' : '🧪';

  const compounds = [...new Set([...(test.selectedCompounds || []), ...(test.compoundsSelected || []), ...(test.compound ? test.compound.split(',') : [])])].map(s => s.trim()).filter(Boolean);
  const plasmids = [...new Set([...(test.plasmids || []), ...(test.plasmid ? [test.plasmid] : [])])].filter(Boolean);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden break-inside-avoid avoid-break mb-4">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl">{typeIcon}</span>
          <div>
            <h3 className="font-bold text-slate-800 text-sm">{test.name} {test.bestMeasurement && '⭐'}</h3>
            <p className="text-[10px] text-slate-500">
              {test.date} · {test.instanceName || 'Primary'} · {typeLabel}
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
        {/* ALWAYS SHOWN: Compounds Section */}
        <div className="mb-3 pb-3 border-b border-slate-100">
          <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Compounds & Biologicals</h4>
          <div className="flex flex-wrap gap-1.5">
            {compounds.length === 0 && plasmids.length === 0 && (!test.cellLines || test.cellLines.length === 0) && (
              <span className="text-[10px] text-slate-400 italic">None defined</span>
            )}
            {compounds.map(c => <span key={c} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded-full font-bold">{c}</span>)}
            {(test.cellLines || []).map(cl => <span key={cl} className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full font-bold">🦠 {cl}</span>)}
            {plasmids.map(p => <span key={p} className="text-[10px] bg-violet-50 border border-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-bold">🧬 {p}</span>)}
          </div>
        </div>

        {/* Notes (Always shown if present) */}
        {test.comments && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Notes</h4>
            <div className="text-xs text-slate-700 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: test.comments }} />
          </div>
        )}

        {/* OPTIONAL: Experimental Conditions */}
        {showConditions && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Experimental Conditions</h4>
            <div className="flex flex-wrap gap-2">
              {test.concentration && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Conc: {test.concentration}</span>}
              {(test.solvent || test.solventName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Solvent: {test.solvent || test.solventName}</span>}
              {(test.buffer || test.bufferName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Buffer: {test.buffer || test.bufferName}</span>}
              {(test.additive || test.additiveName) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Additive: {test.additive || test.additiveName} {test.additiveConc} {test.additiveUnit}</span>}
              {test.temperature && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">T: {test.temperature}</span>}
              {test.ph && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">pH: {test.ph}</span>}
              {test.otherMolecule && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ligand: {test.otherMolecule}</span>}
              {test.ratio && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Ratio: {test.ratio}</span>}
            </div>
          </div>
        )}

        {/* OPTIONAL: Instrumental Setup */}
        {showInstrumental && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Instrumental Setup</h4>
            <div className="flex flex-wrap gap-2">
              {(test.spectrometer || test.instrument || test.nmrInstrument) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Instrument: {test.spectrometer || test.instrument || test.nmrInstrument}</span>}
              {(test.probe || test.nmrProbe) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Probe: {test.probe || test.nmrProbe}</span>}
              {(test.pulseSequence || test.experiment || test.nmrExperiment) && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Pulse Seq: {test.pulseSequence || test.experiment || test.nmrExperiment}</span>}
              {test.pathLength && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Path Length: {test.pathLength}</span>}
            </div>
          </div>
        )}

        {/* OPTIONAL: Report */}
        {showReport && test.report && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Report</h4>
            <div className="text-xs text-slate-700 bg-slate-50 p-2 rounded" dangerouslySetInnerHTML={{ __html: test.report }} />
          </div>
        )}

        {/* OPTIONAL: Images */}
        {showImages && test.images && test.images.length > 0 && (
          <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Images</h4>
            <div className="flex flex-wrap gap-2">
              {test.images.map((img, idx) => (
                <div key={idx} className="flex flex-col gap-1 w-[200px]">
                  <a href={typeof img === 'string' ? img : img.url} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={getDirectImageUrl(typeof img === 'string' ? img : img.url)}
                      alt={`Image ${idx + 1}`}
                      style={{ maxWidth: '200px', maxHeight: '150px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px' }}
                    />
                  </a>
                  <span className="text-[10px] text-slate-500 italic truncate text-center">
                    {typeof img === 'object' && img.caption ? img.caption : `Image ${idx + 1}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* OPTIONAL: Data */}
        {showData && (
          <>
            {isCD && test.structureComposition && (
              <div className="mb-3">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Data: Secondary Structure</h4>
                <CDStructureChart structureComposition={test.structureComposition} />
              </div>
            )}
            {isNMR && test.chemicalShifts && Object.keys(test.chemicalShifts).length > 0 && (
              <div className="mb-3">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Data: NMR Chemical Shifts</h4>
                <div className="overflow-x-auto text-xs border border-slate-200 rounded max-w-md">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr><th className="px-3 py-1.5">Atom</th><th className="px-3 py-1.5">Shift (ppm)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(test.chemicalShifts).map(([atom, shift]) => (
                        <tr key={atom}>
                          <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold">{atom}</td>
                          <td className="px-3 py-1.5 font-mono text-blue-700">{shift}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {isNMRFitting && test.fittings && Object.keys(test.fittings).length > 0 && (
              <div className="mb-3">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Data: NMR Fittings</h4>
                <div className="overflow-x-auto text-xs border border-slate-200 rounded max-w-md">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                      <tr><th className="px-3 py-1.5">Parameter</th><th className="px-3 py-1.5">Value</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.entries(test.fittings).map(([param, val]) => (
                        <tr key={param}>
                          <td className="px-3 py-1.5 font-mono text-slate-700 font-semibold">{param}</td>
                          <td className="px-3 py-1.5 font-mono text-blue-700">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* OPTIONAL: Data Analysis Graphs */}
        {showDataAnalysisGraphs && (isCD || isNMRFitting) && (
          <div className="mb-3">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Data Analysis Graphs</h4>
             {isCD && <CDSpectraChart wavelengthData={test.wavelengthData} spectraColumns={test.spectraColumns} chartCfg={test.chartCfg} />}
             {!isCD && <span className="text-[10px] text-slate-400 italic">No graph rendered in this preview mode.</span>}
          </div>
        )}

        {/* OPTIONAL: Data Tables (Generic Check) */}
        {showDataTables && test.dataTables && (
          <div className="mb-3">
             <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Data Tables</h4>
             <span className="text-[10px] text-slate-400 italic">Table visualization not fully populated for this test.</span>
          </div>
        )}

        {/* OPTIONAL: Simulation Images */}
        {showSimImages && isMD && test.simImages && test.simImages.length > 0 && (
           <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">Simulation Images</h4>
            <div className="flex flex-wrap gap-2">
              {test.simImages.map((img, idx) => (
                <img key={idx} src={getDirectImageUrl(typeof img === 'string' ? img : img.url)} alt={`Sim ${idx}`} style={{ maxWidth: '200px' }} />
              ))}
            </div>
          </div>
        )}

        {/* OPTIONAL: NMR Spectra */}
        {showNMRSpectra && (isNMR || isNMRFitting) && (
           <div className="mb-3">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">NMR Spectra</h4>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const allImgs = [
                  ...(test.nmrSpectraImages || []), 
                  ...(test.simulatedSpectra || []), 
                  ...(test.simulatedSpectraImages || []),
                  ...(test.simImages || []),
                  ...(test.simulationImages || [])
                ];
                if (allImgs.length === 0) return <span className="text-[10px] text-slate-400 italic">No spectra available.</span>;
                
                const filteredImgs = allImgs.filter(img => {
                   if (selectedSpectrumType === 'ALL') return true;
                   if (typeof img === 'object' && img.type) return img.type === selectedSpectrumType;
                   return false;
                });
                
                if (filteredImgs.length === 0) return <span className="text-[10px] text-slate-400 italic">No spectra match selected type.</span>;

                return filteredImgs.map((img, idx) => {
                  const srcStr = typeof img === 'string' ? img : (img.url || img.image || img.src || img.data);
                  const labelStr = typeof img === 'object' && (img.label || img.title || img.name) ? (img.label || img.title || img.name) : '';
                  return (
                    <div key={idx} className="flex flex-col gap-1">
                      <a href={srcStr} target="_blank" rel="noopener noreferrer" className="block">
                        <img src={getDirectImageUrl(srcStr)} alt={`Spectrum ${idx}`} style={{ maxWidth: '200px', maxHeight: '150px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '6px' }} />
                      </a>
                      <span className="text-[10px] text-slate-500 text-center truncate w-[200px]">{labelStr}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

/* ============================================================================
LAB NOTEBOOK — MAIN COMPONENT
========================================================================== */
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
  const [showInstrumental, setShowInstrumental] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showImages, setShowImages] = useState(true);
  const [showData, setShowData] = useState(false);
  const [showDataAnalysisGraphs, setShowDataAnalysisGraphs] = useState(false);
  const [showDataTables, setShowDataTables] = useState(false);
  const [showSimImages, setShowSimImages] = useState(false);
  const [showNMRSpectra, setShowNMRSpectra] = useState(false);
  const [selectedSpectrumType, setSelectedSpectrumType] = useState('ALL');

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

  const availableSpectrumTypes = useMemo(() => {
    const types = new Set();
    tests.forEach(t => {
      if (t.type === 'nmr' || t.type === 'nmr-fittings') {
         const allImgs = [
           ...(t.nmrSpectraImages || []), 
           ...(t.simulatedSpectra || []), 
           ...(t.simulatedSpectraImages || []),
           ...(t.simImages || []),
           ...(t.simulationImages || [])
         ];
         allImgs.forEach(img => {
           if (img && typeof img === 'object' && img.type) types.add(img.type);
         });
      }
    });
    return [...types].sort();
  }, [tests]);

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

      // Advanced Checks using stringification to catch deeply nested custom fields safely
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
            <input type="checkbox" checked={showDataTables} onChange={(e) => setShowDataTables(e.target.checked)} className="accent-blue-600" /> Data Tables
          </label>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showSimImages} onChange={(e) => setShowSimImages(e.target.checked)} className="accent-blue-600" /> Sim. Images
          </label>
          
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-700 cursor-pointer">
              <input type="checkbox" checked={showNMRSpectra} onChange={(e) => setShowNMRSpectra(e.target.checked)} className="accent-blue-600" /> NMR Spectra
            </label>
            {showNMRSpectra && (
              <select value={selectedSpectrumType} onChange={(e) => setSelectedSpectrumType(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-[9px] bg-white outline-none">
                <option value="ALL">All Types</option>
                <option value="1D">1D</option>
                <option value="2D">2D</option>
                {availableSpectrumTypes.filter(t => t !== '1D' && t !== '2D').map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
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
                  jumpToTest={jumpToTest}
                  showConditions={showConditions}
                  showInstrumental={showInstrumental}
                  showReport={showReport}
                  showImages={showImages}
                  showData={showData}
                  showDataAnalysisGraphs={showDataAnalysisGraphs}
                  showDataTables={showDataTables}
                  showSimImages={showSimImages}
                  showNMRSpectra={showNMRSpectra}
                  selectedSpectrumType={selectedSpectrumType}
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
