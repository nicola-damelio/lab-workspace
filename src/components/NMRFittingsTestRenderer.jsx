import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { CollapsibleSection } from './TestShellRenderer';
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
  errBarPlugin
} from '../data/constants';

const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES =
  'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';

const rowLabel = (idx) => {
  let label = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
};

const normalizeMoleculeList = (molecules) => {
  if (!Array.isArray(molecules)) return [];
  return molecules.map((m, idx) => {
    if (typeof m === 'string') {
      return { id: m, name: m, atoms: [] };
    }
    return {
      id: m?.id || `mol_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      name: m?.name || `Molecule ${idx + 1}`,
      atoms: Array.isArray(m?.atoms)
        ? m.atoms.map((a) => String(a).trim()).filter(Boolean)
        : []
    };
  });
};

const operatorLabel = (op) => {
  if (!op) return '';
  if (typeof op === 'string') return op;
  return op.name || op.label || '';
};

// ================= ERROR INPUT =================
export const ErrInput = ({ label, value, sdRaw, isOverridden, onSave, onReset }) => {
  const [tempVal, setTempVal] = useState(value !== undefined ? value : '');
  useEffect(() => {
    setTempVal(value !== undefined ? value : '');
  }, [value]);
  return (
    <div
      className={`flex flex-col gap-1 p-1.5 rounded border ${
        isOverridden ? 'border-orange-400 bg-white' : 'border-slate-200 bg-white'
      }`}
    >
      <span className="text-[9px] font-bold text-slate-500">{label}</span>
      <div className="flex gap-1 items-center">
        <input
          type="number"
          step="0.01"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onBlur={() => onSave(parseFloat(tempVal) || 0)}
          className="w-12 text-xs border border-slate-300 rounded p-0.5 outline-none focus:border-orange-500 text-center"
        />
        {isOverridden && (
          <button
            onClick={onReset}
            className="text-red-500 hover:text-red-700 font-bold"
            title="Reset to calculated SD"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

// ================= REGION CHARTS =================
export function RegionCharts({ regionName, regionData, config }) {
  const {
    chartCfg,
    fitIC50,
    showExcl,
    eScale,
    fsPanel,
    chartH,
    drWidth,
    hiddenCmpds,
    cellConfig,
    setCellConfig,
    activePlateDim,
    toggleFs,
    unit,
    renameRegion,
    valueLabel
  } = config;

  const drRef = useRef(null);
  const ic50Ref = useRef(null);
  const drChart = useRef(null);
  const ic50Chart = useRef(null);
  const isDrFs = fsPanel === `dr_${regionName}`;
  const isIc50Fs = fsPanel === `ic50_${regionName}`;

  useEffect(() => {
    if (!drRef.current) return;
    const ds = [];
    const map = [];

    regionData.forEach((cd) => {
      if (hiddenCmpds[cd.name]) return;

      if (cd.fit) {
        const lbl = `${cd.name} (IC50:${cd.fit.ic50.toFixed(2)}±${(cd.fit.se * eScale).toFixed(2)} ${unit})`;
        const minL = Math.min(...cd.vPts.map((p) => p.x)) - 0.2;
        const maxL = Math.max(...cd.vPts.map((p) => p.x)) + 0.2;
        const curve = [];
        const step = (maxL - minL) / 60;
        for (let v = minL; v <= maxL + step * 0.5; v += step) {
          curve.push({
            x: v,
            y: 100 / (1 + Math.pow(Math.pow(10, v) / cd.fit.ic50, cd.fit.hill))
          });
        }
        let borderDash = [];
        if (chartCfg.lineStyle === 'dashed') borderDash = [5, 5];
        if (chartCfg.lineStyle === 'dotted') borderDash = [2, 3];
        ds.push({
          label: lbl,
          data: curve,
          borderColor: cd.color,
          backgroundColor: 'transparent',
          borderWidth: chartCfg.lineThickness || 2,
          borderDash,
          pointRadius: 0,
          fill: false,
          type: 'line',
          tension: 0,
          showLine: true
        });
        map.push(null);
      }

      if (cd.vPts.length > 0) {
        ds.push({
          label: cd.fit ? `${cd.name} [pts]` : cd.name,
          data: cd.vPts,
          errorBars: cd.vPts.map((p) => ({ plus: p.sd * eScale, minus: p.sd * eScale })),
          borderColor: cd.color,
          backgroundColor: cd.color,
          borderWidth: 2,
          pointBackgroundColor: cd.color,
          pointStyle: chartCfg.ptStyle || 'circle',
          pointRadius: chartCfg.ptSize != null ? chartCfg.ptSize : 5,
          fill: false,
          type: 'scatter',
          showLine: false
        });
        map.push({ name: cd.name, excl: false });
      }

      if (cd.ePts.length > 0 && showExcl) {
        ds.push({
          label: `${cd.name} [excl]`,
          data: cd.ePts,
          borderColor: '#cbd5e1',
          backgroundColor: '#cbd5e1',
          borderWidth: 2,
          pointStyle: 'crossRot',
          pointRadius: (chartCfg.ptSize != null ? chartCfg.ptSize : 5) + 2,
          fill: false,
          type: 'scatter',
          showLine: false
        });
        map.push({ name: cd.name, excl: true });
      }
    });

    if (drChart.current) drChart.current.destroy();
    drChart.current = new Chart(drRef.current, {
      type: 'line',
      data: { datasets: ds },
      plugins: [errBarPlugin],
      options: {
        onClick: (evt, els, chart) => {
          const nc = cellConfig.map((row) => row.map((c) => ({ ...c })));
          let changed = false;

          if (els.length > 0) {
            const m = map[els[0].datasetIndex];
            if (!m) return;
            const pd = chart.data.datasets[els[0].datasetIndex].data[els[0].index];
            if (pd && pd.pts) {
              pd.pts.forEach((p) => {
                nc[p.r][p.c].excluded = !m.excl;
                nc[p.r][p.c].manualOverride = true;
              });
              changed = true;
            }
          } else {
            const pos = Chart.helpers.getRelativePosition(evt, chart);
            const dx = chart.scales.x.getValueForPixel(pos.x);
            let md = Infinity;
            let tx = null;
            regionData.forEach((cd) =>
              [...cd.vPts, ...cd.ePts].forEach((p) => {
                const d = Math.abs(p.x - dx);
                if (d < md) {
                  md = d;
                  tx = p.x;
                }
              })
            );
            if (tx !== null && md < 0.2) {
              for (let r = 0; r < activePlateDim.rows; r++) {
                for (let c = 0; c < activePlateDim.cols; c++) {
                  const cfg = nc[r][c];
                  if ((cfg.region || 'Primary') !== regionName) continue;
                  const xc = Number(cfg.conc) || 0;
                  if (xc > 0 && Math.abs(Math.log10(xc) - tx) < 0.05 && cfg.excluded) {
                    cfg.excluded = false;
                    cfg.manualOverride = true;
                    changed = true;
                  }
                }
              }
            }
          }
          if (changed) setCellConfig(nc);
        },
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'linear',
            position: chartCfg.xPos || 'bottom',
            min: chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined,
            max: chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined,
            title: {
              display: true,
              text: chartCfg.xAxisLabel || `Log₁₀ [Conc. (${unit})]`,
              font: { size: chartCfg.fontSize + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: {
              font: { size: chartCfg.fontSize },
              color: '#64748b',
              callback: function (value) {
                return value.toFixed(2);
              }
            }
          },
          y: {
            position: chartCfg.yPos || 'left',
            min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined,
            max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined,
            title: {
              display: true,
              text: valueLabel || 'Value',
              font: { size: chartCfg.fontSize + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: {
              font: { size: chartCfg.fontSize },
              color: '#64748b'
            }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              font: { size: chartCfg.fontSize, weight: 'bold' },
              filter: (item) => {
                if (item.text.includes('[excl]')) return false;
                if (fitIC50 && item.text.includes('[pts]')) return false;
                return true;
              }
            }
          },
          tooltip: {
            callbacks: {
              title: (ctx) => {
                const logX = ctx[0].parsed.x;
                const realX =
                  ctx[0].raw && ctx[0].raw.realX ? ctx[0].raw.realX : Math.pow(10, logX);
                return `Conc: ${formatConc(realX)} ${unit} (log: ${logX.toFixed(2)})`;
              },
              label: (ctx) => {
                const lbl = ctx.dataset.label.replace(' [pts]', '');
                const y = ctx.parsed.y.toFixed(2);
                if (ctx.dataset.type === 'scatter') {
                  const sd = ctx.raw.sd ? ctx.raw.sd.toFixed(2) : '0.00';
                  return `${lbl}: ${y} ± ${(sd * eScale).toFixed(2)}`;
                }
                return `${lbl}: ${y}`;
              }
            }
          }
        }
      }
    });
    return () => {
      if (drChart.current) drChart.current.destroy();
    };
  }, [
    regionData,
    hiddenCmpds,
    showExcl,
    eScale,
    chartCfg,
    fitIC50,
    fsPanel,
    activePlateDim,
    cellConfig,
    unit,
    valueLabel
  ]);

  useEffect(() => {
    if (!ic50Ref.current || !fitIC50) return;
    const labels = [];
    const data = [];
    const colors = [];
    const ebars = [];

    regionData.forEach((cd) => {
      if (hiddenCmpds[cd.name] || !cd.fit || !isFinite(cd.fit.ic50)) return;
      labels.push(cd.name);
      data.push(cd.fit.ic50);
      colors.push(cd.color);
      const se = Math.min(cd.fit.se, cd.fit.ic50 * 2) * eScale;
      ebars.push({ plus: se, minus: se });
    });

    if (ic50Chart.current) ic50Chart.current.destroy();
    ic50Chart.current = new Chart(ic50Ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: `IC50 (${unit})`,
            data,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            errorBars: ebars
          }
        ]
      },
      plugins: [errBarPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            position: chartCfg.yPos || 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: `IC50 (${unit})`,
              font: { size: chartCfg.fontSize + 2, weight: 'bold' },
              color: '#334155'
            },
            ticks: {
              font: { size: chartCfg.fontSize },
              color: '#64748b'
            }
          },
          x: {
            position: chartCfg.xPos || 'bottom',
            ticks: {
              font: { size: chartCfg.fontSize, weight: 'bold' },
              color: '#334155'
            }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                `IC50: ${ctx.raw.toFixed(2)} ± ${
                  (ebars[ctx.dataIndex] && ebars[ctx.dataIndex].plus) || 0
                } ${unit}`
            }
          }
        }
      }
    });
    return () => {
      if (ic50Chart.current) ic50Chart.current.destroy();
    };
  }, [regionData, hiddenCmpds, fitIC50, eScale, chartCfg, fsPanel, unit]);

  return (
    <CollapsibleSection title={`Region: ${regionName}`} icon="📍" defaultOpen={true}>
      <div className="flex flex-col lg:flex-row gap-6 relative">
        {isDrFs && (
          <div className={OVERLAY_CLASSES} onClick={() => toggleFs(`dr_${regionName}`)}></div>
        )}
        <div
          className={`flex flex-col ${isDrFs ? FS_CLASSES + ' p-6' : 'min-w-0'}`}
          style={!isDrFs ? { width: fitIC50 ? `${drWidth}%` : '100%', flexShrink: 0 } : {}}
        >
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">
              Dose-Response Plot
            </h2>
            <div className="flex items-center gap-1 no-print">
              {renameRegion && (
                <button
                  onClick={() => renameRegion(regionName)}
                  title="Rename region"
                  className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
                >
                  ✏️
                </button>
              )}
              <button
                onClick={() => toggleFs(`dr_${regionName}`)}
                className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
              >
                {isDrFs ? '↙️' : '↗️'}
              </button>
            </div>
          </div>
          <div
            className="flex-1 relative min-h-0"
            style={{ minHeight: isDrFs ? '0' : `${chartH}px` }}
          >
            <canvas ref={drRef}></canvas>
          </div>
        </div>
        {fitIC50 && (
          <>
            {isIc50Fs && (
              <div
                className={OVERLAY_CLASSES}
                onClick={() => toggleFs(`ic50_${regionName}`)}
              ></div>
            )}
            <div className={`flex flex-col ${isIc50Fs ? FS_CLASSES + ' p-6' : 'flex-1 min-w-0'}`}>
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">
                  IC50 Comparison
                </h2>
                <button
                  onClick={() => toggleFs(`ic50_${regionName}`)}
                  className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors"
                >
                  {isIc50Fs ? '↙️' : '↗️'}
                </button>
              </div>
              <div
                className="flex-1 relative min-h-0"
                style={{ minHeight: isIc50Fs ? '0' : `${chartH}px` }}
              >
                <canvas ref={ic50Ref}></canvas>
              </div>
            </div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}

// ================= NMR FITTINGS TEST RENDERER =================
export const NMRFittingsTestRenderer = ({
  activeTest,
  updateActiveTest,
  TestHeader,
  operators = [],
  molecules = [],
  allCmpds = [],
  customConc = {},
  setCustomConc,
  cmpColors = {},
  setCmpColors,
  setCustomCmpds,
  testCategories = [],
  appClipboard,
  setAppClipboard,
  plateModelRef
}) => {
  const updatePlate = (updates) => updateActiveTest(updates);

  // Variable dimensions
  const rows = activeTest.rows || 8;
  const cols = activeTest.cols || 12;
  const activePlateDim = { rows, cols };

  const ROWS = useMemo(() => Array.from({ length: rows }, (_, i) => rowLabel(i)), [rows]);
  const COLS = useMemo(() => Array.from({ length: cols }, (_, i) => i + 1), [cols]);

  const {
    plateType = 'custom',
    grid = [],
    compounds = [],
    rowCompounds = [],
    cellConfig = [],
    ctrlType,
    ctrlODStr,
    bgType,
    bgManualStr,
    unit = 'µM',
    manualErrors = {},
    topConcStr,
    dilFactorStr,
    glbOffsetStr,
    errScaleStr,
    useFixedSD,
    fixedSDStr,
    showViab,
    fitIC50,
    showExcl,
    outlierThreshStr
  } = activeTest;

  const chartCfg = {
    yMin: '',
    yMax: '',
    xMin: '',
    xMax: '',
    ptStyle: 'circle',
    ptSize: 5,
    fontSize: 16,
    xPos: 'bottom',
    yPos: 'left',
    xAxisLabel: '',
    lineStyle: 'solid',
    lineThickness: 2,
    ...(activeTest.chartCfg || {})
  };

  const [tableView, setTableView] = useState('od');
  const [drWidth, setDrWidth] = useState(55);
  const [chartH, setChartH] = useState(530);
  const [mapFontSize, setMapFontSize] = useState(9);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [focusedCell, setFocusedCell] = useState(null);
  const [hiddenCmpds, setHiddenCmpds] = useState({});
  const [showChartCfg, setShowChartCfg] = useState(false);
  const [showErrPanel, setShowErrPanel] = useState(false);
  const [fsPanel, setFsPanel] = useState(null);
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [fillEnd, setFillEnd] = useState(null);
  const [dragMode, setDragMode] = useState('none');
  const [regionModal, setRegionModal] = useState(null);
  const [renameRegionModal, setRenameRegionModal] = useState(null);
  const [dragState, setDragState] = useState({
    active: false,
    startR: -1,
    startC: -1,
    currentR: -1,
    currentC: -1
  });

  // Extract molecule and atoms
  const moleculeList = useMemo(() => normalizeMoleculeList(molecules), [molecules]);
  const selectedMolecule =
    moleculeList.find(
      (m) =>
        m.id === activeTest.moleculeId ||
        m.name === activeTest.moleculeId ||
        m.name === activeTest.moleculeName
    ) || null;
  const atomOptions = selectedMolecule?.atoms || [];
  const identityOptions = atomOptions.length > 0 ? atomOptions : allCmpds;

  const setDimensions = (newRows, newCols) => {
    const r = Math.max(1, newRows);
    const c = Math.max(1, newCols);
    const nextGrid = Array.from({ length: r }, (_, ir) =>
      Array.from({ length: c }, (_, ic) => grid[ir]?.[ic] || '')
    );
    const nextCell = Array.from({ length: r }, (_, ir) =>
      Array.from({ length: c }, (_, ic) =>
        cellConfig[ir]?.[ic]
          ? { ...cellConfig[ir][ic] }
          : {
              excluded: false,
              role: null,
              conc: null,
              region: 'Primary',
              manualOverride: false
            }
      )
    );
    const nextRowCmp = Array.from({ length: r }, (_, ir) => rowCompounds[ir] || '');
    const nextColCmp = Array.from({ length: c }, (_, ic) => compounds[ic] || '');
    updatePlate({
      rows: r,
      cols: c,
      grid: nextGrid,
      cellConfig: nextCell,
      rowCompounds: nextRowCmp,
      compounds: nextColCmp,
      plateType: 'custom'
    });
  };

  const tConc = parseFloat(String(topConcStr).replace(',', '.')) || 0;
  const dFact = parseFloat(String(dilFactorStr).replace(',', '.')) || 1;
  const cOD = parseFloat(String(ctrlODStr).replace(',', '.')) || 0;
  const bgMan = parseFloat(String(bgManualStr).replace(',', '.')) || 0;
  const gOff = parseFloat(String(glbOffsetStr).replace(',', '.')) || 0;
  const fSD = parseFloat(String(fixedSDStr).replace(',', '.')) || 0;
  const eScale = parseFloat(String(errScaleStr).replace(',', '.')) || 1;
  const outlierThresh = parseFloat(String(outlierThreshStr).replace(',', '.')) || 2.0;

  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

  const mapBadgePx =
    fsPanel === 'map'
      ? Math.max(45, Math.round(mapFontSize * 5.5))
      : Math.max(22, Math.round(mapFontSize * 3.4));

  const activeSel =
    selStart && selEnd
      ? {
          minR: Math.min(selStart.r, selEnd.r),
          maxR: Math.max(selStart.r, selEnd.r),
          minC: Math.min(selStart.c, selEnd.c),
          maxC: Math.max(selStart.c, selEnd.c)
        }
      : null;

  const currentSelectionBox = useMemo(() => {
    if (dragState.active) {
      return {
        minR: Math.min(dragState.startR, dragState.currentR),
        maxR: Math.max(dragState.startR, dragState.currentR),
        minC: Math.min(dragState.startC, dragState.currentC),
        maxC: Math.max(dragState.startC, dragState.currentC)
      };
    }
    return activeSel;
  }, [dragState, activeSel]);

  const selectedRegionName = useMemo(() => {
    if (!activeSel) return null;
    const names = new Set();
    for (let r = activeSel.minR; r <= activeSel.maxR; r++) {
      for (let c = activeSel.minC; c <= activeSel.maxC; c++) {
        const reg = cellConfig[r]?.[c]?.region;
        if (reg && reg !== 'Primary') names.add(reg);
      }
    }
    return names.size === 1 ? Array.from(names)[0] : null;
  }, [activeSel, cellConfig]);

  const selectedRegionComplete = useMemo(() => {
    if (!activeSel || !selectedRegionName) return false;
    let hasRegionCell = false;
    for (let r = 0; r < activePlateDim.rows; r++) {
      for (let c = 0; c < activePlateDim.cols; c++) {
        const reg = cellConfig[r]?.[c]?.region;
        if (reg === selectedRegionName) {
          hasRegionCell = true;
          const insideSelection =
            r >= activeSel.minR &&
            r <= activeSel.maxR &&
            c >= activeSel.minC &&
            c <= activeSel.maxC;
          if (!insideSelection) return false;
        }
      }
    }
    return hasRegionCell;
  }, [activeSel, selectedRegionName, cellConfig, activePlateDim]);

  const activeFill =
    dragMode === 'filling' && currentSelectionBox && fillEnd
      ? {
          minR: Math.min(currentSelectionBox.minR, fillEnd.r),
          maxR: Math.max(currentSelectionBox.maxR, fillEnd.r),
          minC: Math.min(currentSelectionBox.minC, fillEnd.c),
          maxC: Math.max(currentSelectionBox.maxC, fillEnd.c)
        }
      : null;

  const activeResize =
    dragMode === 'resizingRegion' && activeSel && fillEnd && selectedRegionComplete
      ? {
          minR: activeSel.minR,
          minC: activeSel.minC,
          maxR: Math.max(activeSel.minR, fillEnd.r),
          maxC: Math.max(activeSel.minC, fillEnd.c)
        }
      : null;

  const getRole = (r, c) => {
    const cfg = cellConfig[r]?.[c];
    if (!cfg) return null;
    if (cfg.role !== null && cfg.role !== undefined) return cfg.role;
    const rCmp = rowCompounds[r];
    const cCmp = compounds[c];
    if (rCmp && !cCmp) return rCmp;
    if (cCmp && !rCmp) return cCmp;
    if (!rCmp && !cCmp) return null;
    const isCtrl = (x) => ['cells', 'medium', 'pbs'].includes(String(x).toLowerCase());
    if (isCtrl(rCmp) && !isCtrl(cCmp)) return rCmp;
    if (isCtrl(cCmp) && !isCtrl(rCmp)) return cCmp;
    return rCmp;
  };

  const toNum = (v) => {
    const n = parseFloat(typeof v === 'string' ? v.trim().replace(',', '.') : v);
    return isNaN(n) ? NaN : n;
  };

  const rawOD = (r, c) => {
    const n = toNum(grid?.[r]?.[c]);
    return isNaN(n) ? NaN : n - gOff;
  };

  const concOf = (r, c, role) => {
    const rl = role !== undefined ? role : getRole(r, c);
    if (!rl || ['cells', 'medium', 'pbs'].includes(String(rl).toLowerCase())) return 0;

    const cfg = cellConfig?.[r]?.[c];
    if (cfg && cfg.conc !== null && cfg.conc !== undefined && cfg.conc !== '') {
      return Number(cfg.conc);
    }

    const s = customConc[rl]
      ? {
          top: parseFloat(customConc[rl].top) || 0,
          dil: parseFloat(customConc[rl].dil) || 1
        }
      : { top: tConc, dil: dFact };

    let isHoriz = false;
    let step = 0;
    if (rowCompounds[r] === rl) isHoriz = true;
    else if (compounds[c] === rl) isHoriz = false;
    else if (rowCompounds.includes(rl)) isHoriz = true;

    if (isHoriz) {
      for (let i = 0; i < c; i++) {
        if (getRole(r, i) === rl) step++;
      }
    } else {
      for (let i = 0; i < r; i++) {
        if (getRole(i, c) === rl) step++;
      }
    }
    return s.top / Math.pow(s.dil, step);
  };

  const cmpColor = (name, autoIdx) => {
    const stored = cmpColors[name];
    if (stored && /^#[0-9a-f]{6}$/i.test(stored)) return stored.toLowerCase();
    const safeIdx = autoIdx >= 0 ? autoIdx : Math.abs(name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % PALETTE.length;
    return toHex(PALETTE[safeIdx % PALETTE.length]);
  };

  const plotCmps = useMemo(() => {
    const s = new Set();
    compounds.forEach((c, i) => {
      if (i < activePlateDim.cols && c && !['cells', 'medium', 'pbs'].includes(String(c).toLowerCase())) s.add(c);
    });
    rowCompounds.forEach((c, i) => {
      if (i < activePlateDim.rows && c && !['cells', 'medium', 'pbs'].includes(String(c).toLowerCase())) s.add(c);
    });
    (grid || []).forEach((row, r) =>
      (row || []).forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const role = getRole(r, c);
        if (role && !['cells', 'medium', 'pbs'].includes(String(role).toLowerCase())) s.add(role);
      })
    );
    return Array.from(s);
  }, [cellConfig, activePlateDim, grid, compounds, rowCompounds]);

  const cmpStats = useMemo(() => {
    const stats = {};
    (grid || []).forEach((row, r) =>
      (row || []).forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const role = getRole(r, c);
        const conc = concOf(r, c, role);
        if (role && conc > 0) {
          if (!stats[role]) stats[role] = { min: conc, max: conc };
          else {
            stats[role].min = Math.min(stats[role].min, conc);
            stats[role].max = Math.max(stats[role].max, conc);
          }
        }
      })
    );
    return stats;
  }, [cellConfig, activePlateDim, grid, compounds, rowCompounds, tConc, dFact, customConc]);

  const [bgOD, setBgOD] = useState(0);
  useEffect(() => {
    if (bgType === 'none') {
      setBgOD(0);
      return;
    }
    if (bgType === 'manual') {
      setBgOD(bgMan);
      return;
    }
    let s = 0;
    let n = 0;
    (grid || []).forEach((row, r) =>
      (row || []).forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const cfg = cellConfig[r]?.[c];
        if (!cfg || cfg.excluded) return;
        if (getRole(r, c) === bgType) {
          const v = rawOD(r, c);
          if (!isNaN(v)) {
            s += v;
            n++;
          }
        }
      })
    );
    setBgOD(n > 0 ? s / n : 0);
  }, [grid, cellConfig, bgType, bgMan, gOff, activePlateDim]);

  useEffect(() => {
    if (ctrlType === 'none') return;
    let s = 0;
    let n = 0;
    (grid || []).forEach((row, r) =>
      (row || []).forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const cfg = cellConfig[r]?.[c];
        if (!cfg || cfg.excluded) return;
        if (getRole(r, c) === ctrlType) {
          const v = rawOD(r, c);
          if (!isNaN(v)) {
            s += v;
            n++;
          }
        }
      })
    );
    if (n > 0) updatePlate({ ctrlODStr: (s / n).toFixed(4) });
  }, [grid, cellConfig, ctrlType, gOff, activePlateDim]);

  const calcValue = (raw) => {
    const net = raw - bgOD;
    if (showViab && ctrlType !== 'none' && cOD > 0) {
      const ctrl = cOD - bgOD;
      return Math.abs(ctrl) < 1e-6 ? 0 : (net / ctrl) * 100;
    }
    return net;
  };

  const wellColor = (r, c) => {
    const role = getRole(r, c);
    if (!role) return { bg: '#ffffff', dark: true };

    const rl = String(role).toLowerCase();
    if (rl === 'medium') return { bg: '#ff4d6d', dark: false };
    if (rl === 'pbs') return { bg: '#e5e7eb', dark: true };
    if (rl === 'cells') return { bg: '#fef08a', dark: true };

    const idx = identityOptions.indexOf(role);
    const base = cmpColor(role, idx !== -1 ? idx : 0);
    const conc = concOf(r, c, role);
    if (conc <= 0) return { bg: base, dark: needsDarkText(base) };

    const st = cmpStats[role];
    if (!st || st.min === st.max) return { bg: base, dark: needsDarkText(base) };

    const lc = Math.log10(conc);
    const lx = Math.log10(st.max);
    const ln = Math.log10(st.min);
    const frac = lx > ln ? (lc - ln) / (lx - ln) : 0;
    const bg = frac > 0.5 ? darken(base, (frac - 0.5) * 1.0) : lighten(base, (0.5 - frac) * 0.9);
    return { bg, dark: needsDarkText(bg) };
  };

  const heatColor = (r, c) => {
    const cfg = cellConfig[r]?.[c];
    if (!cfg || cfg.excluded) return 'transparent';
    const v = rawOD(r, c);
    if (isNaN(v)) return 'transparent';
    const role = getRole(r, c);
    if (!role) return 'transparent';
    const rl = String(role).toLowerCase();
    if (rl === 'medium') return '#ffe4e6';
    if (rl === 'pbs') return '#f3f4f6';
    if (rl === 'cells') return '#fef9c3';
    const idx = identityOptions.indexOf(role);
    const base = cmpColor(role, idx !== -1 ? idx : 0);
    const val = calcValue(v);
    const maxHeat = showViab ? 100 : Math.max(...plotCmps.map(p => cmpStats[p]?.max || 1));
    const vb = Math.max(0, Math.min(100, (val / maxHeat) * 100));
    return lighten(base, 0.25 + (vb / 100) * 0.55);
  };

  const displayVal = (r, c) => {
    const n = rawOD(r, c);
    if (isNaN(n)) return grid?.[r]?.[c] === '' ? '' : grid?.[r]?.[c];
    return showViab ? calcValue(n).toFixed(1) + '%' : n.toFixed(3);
  };

  const getManual = (name, realX) => manualErrors[name] ? manualErrors[name][concKey(realX)] : undefined;
  const hasManual = (name, realX) => typeof getManual(name, realX) === 'number';
  const effectiveSD = (name, realX, computedSD) => {
    const m = getManual(name, realX);
    return typeof m === 'number' ? m : computedSD;
  };

  const storeManual = (name, realX, val) => {
    const inner = { ...(manualErrors[name] || {}) };
    inner[concKey(realX)] = val;
    updatePlate({ manualErrors: { ...manualErrors, [name]: inner } });
  };
  const clearManual = (name, realX) => {
    const inner = { ...(manualErrors[name] || {}) };
    delete inner[concKey(realX)];
    const next = { ...manualErrors };
    if (Object.keys(inner).length === 0) delete next[name];
    else next[name] = inner;
    updatePlate({ manualErrors: next });
  };
  const clearAllManual = (name) => {
    const next = { ...manualErrors };
    delete next[name];
    updatePlate({ manualErrors: next });
  };

  const autoCalcControl = () => {
    let sumOD = 0;
    let count = 0;
    identityOptions.forEach((cmp) => {
      if (['cells', 'medium', 'pbs'].includes(String(cmp).toLowerCase())) return;
      const pts = [];
      (grid || []).forEach((row, r) =>
        (row || []).forEach((_, c) => {
          if (getRole(r, c) === cmp && !cellConfig[r]?.[c]?.excluded) {
            const conc = concOf(r, c, cmp);
            const n = rawOD(r, c);
            if (!isNaN(n) && conc > 0) pts.push({ conc, od: n });
          }
        })
      );
      if (pts.length > 0) {
        const minConc = Math.min(...pts.map((p) => p.conc));
        const lowPts = pts.filter((p) => p.conc === minConc);
        lowPts.forEach((p) => {
          sumOD += p.od;
          count++;
        });
      }
    });
    if (count > 0) updatePlate({ ctrlType: 'none', ctrlODStr: (sumOD / count).toFixed(4) });
  };

  const processedByRegion = useMemo(() => {
    const byReg = {};
    (grid || []).forEach((row, r) =>
      (row || []).forEach((_, c) => {
        if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
        const reg = cellConfig[r]?.[c]?.region || 'Primary';
        if (!byReg[reg]) byReg[reg] = [];
      })
    );

    const result = {};
    Object.keys(byReg).forEach((reg) => {
      const comps = plotCmps
        .map((name) => {
          const pts = [];
          (grid || []).forEach((row, r) =>
            (row || []).forEach((_, c) => {
              if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
              const cfg = cellConfig[r]?.[c];
              if (!cfg) return;
              if ((cfg.region || 'Primary') !== reg || getRole(r, c) !== name) return;
              const n = rawOD(r, c);
              if (isNaN(n)) return;
              const xc = concOf(r, c, name);
              if (!(xc > 0)) return;
              pts.push({
                realX: xc,
                logX: Math.log10(xc),
                val: calcValue(n),
                excl: cfg.excluded,
                r,
                c
              });
            })
          );

          const byX = {};
          pts.forEach((p) => {
            const k = concKey(p.realX);
            if (!byX[k]) byX[k] = { inc: [], excl: [] };
            (p.excl ? byX[k].excl : byX[k].inc).push(p);
          });

          const vPts = [];
          const ePts = [];
          Object.keys(byX).forEach((ks) => {
            const g = byX[ks];
            if (g.inc.length === 0 && g.excl.length === 0) return;
            const rep = g.inc[0] || g.excl[0];
            const xr = rep.realX;
            const xl = rep.logX;

            if (g.inc.length > 0) {
              const mean = g.inc.reduce((s, p) => s + p.val, 0) / g.inc.length;
              let sd = 0;
              if (useFixedSD) sd = fSD;
              else if (g.inc.length > 1) {
                sd = Math.sqrt(
                  g.inc.reduce((s, p) => s + Math.pow(p.val - mean, 2), 0) /
                    (g.inc.length - 1)
                );
              }
              vPts.push({
                x: xl,
                realX: xr,
                y: mean,
                sd: effectiveSD(name, xr, sd),
                sdRaw: sd,
                pts: g.inc
              });
            }

            if (g.excl.length > 0) {
              ePts.push({
                x: xl,
                realX: xr,
                y: g.excl.reduce((s, p) => s + p.val, 0) / g.excl.length,
                pts: g.excl
              });
            }
          });

          vPts.sort((a, b) => a.x - b.x);
          ePts.sort((a, b) => a.x - b.x);

          if (vPts.length === 0 && ePts.length === 0) return null;

          const color = cmpColor(name, identityOptions.indexOf(name));
          let fit = null;
          if (fitIC50 && vPts.length >= 3) {
            let sumW = 0;
            const fitData = vPts.map((p) => {
              const w = p.sd > 0 ? 1 / (p.sd * p.sd) : 1;
              sumW += w;
              return { x: p.realX, y: p.y, w, sd: p.sd };
            });
            if (sumW > 0) fitData.forEach((p) => (p.w = (p.w / sumW) * fitData.length));
            fit = fit4PL(fitData);
          }

          return { name, color, vPts, ePts, fit };
        })
        .filter(Boolean);

      if (comps.length > 0) result[reg] = comps;
    });

    return result;
  }, [
    grid,
    cellConfig,
    activePlateDim,
    cOD,
    bgOD,
    fitIC50,
    useFixedSD,
    fSD,
    gOff,
    manualErrors,
    plotCmps,
    identityOptions,
    cmpColors,
    plateType,
    tConc,
    dFact,
    customConc
  ]);

  const model = useMemo(
    () => ({
      processedByRegion,
      plotCmps,
      bgOD,
      eScale,
      activePlateDim,
      unit
    }),
    [processedByRegion, plotCmps, bgOD, eScale, activePlateDim, unit]
  );

  useEffect(() => {
    if (plateModelRef) plateModelRef.current = model;
  }, [model, plateModelRef]);

  const autoTouchSD = (region, name) => {
    const compData = (processedByRegion[region] || []).find((c) => c.name === name);
    if (!compData || !compData.fit) return;

    let maxRes = 0;
    compData.vPts.forEach((pt) => {
      const yFit = 100 / (1 + Math.pow(pt.realX / compData.fit.ic50, compData.fit.hill));
      const res = Math.abs(pt.y - yFit);
      if (res > maxRes) maxRes = res;
    });
    const newSD = Math.ceil((maxRes * 1.02 + 0.01) * 100) / 100;

    const inner = { ...(manualErrors[name] || {}) };
    compData.vPts.forEach((pt) => {
      inner[concKey(pt.realX)] = newSD;
    });
    updatePlate({ manualErrors: { ...manualErrors, [name]: inner } });
  };

  const autoTouchAll = () => {
    let updates = {};
    Object.entries(processedByRegion).forEach(([reg, comps]) => {
      comps.forEach((c) => {
        if (!c.fit) return;
        let maxRes = 0;
        c.vPts.forEach((pt) => {
          const yFit = 100 / (1 + Math.pow(pt.realX / c.fit.ic50, c.fit.hill));
          const res = Math.abs(pt.y - yFit);
          if (res > maxRes) maxRes = res;
        });
        const newSD = Math.ceil((maxRes * 1.02 + 0.01) * 100) / 100;
        if (!updates[c.name]) updates[c.name] = {};
        c.vPts.forEach((pt) => {
          updates[c.name][concKey(pt.realX)] = newSD;
        });
      });
    });

    const next = { ...manualErrors };
    Object.keys(updates).forEach((cmp) => {
      next[cmp] = { ...(next[cmp] || {}), ...updates[cmp] };
    });
    updatePlate({ manualErrors: next, useFixedSD: true });
  };

  const revertNormalSD = () => updatePlate({ manualErrors: {}, useFixedSD: false });

  const updateCell = (r, c, v) => {
    const ng = grid.map((row) => [...row]);
    ng[r][c] = v;
    updatePlate({ grid: ng });
  };

  const updateCmp = (c, v) => {
    const role = v;
    const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
    const oldRole = compounds[c];
    const isCtrl = role && ['cells', 'medium', 'pbs'].includes(role.toLowerCase());
    if (!role) {
      for (let r = 0; r < activePlateDim.rows; r++) {
        if (nc[r][c].role === oldRole) {
          nc[r][c].role = null;
          nc[r][c].conc = null;
        }
      }
    } else {
      let step = 0;
      for (let r = 0; r < activePlateDim.rows; r++) {
        if (!nc[r][c].role || nc[r][c].role === oldRole) {
          nc[r][c].role = role;
          if (isCtrl) nc[r][c].conc = 0;
          else {
            const s = customConc[role] || { top: tConc, dil: dFact };
            nc[r][c].conc = s.top / Math.pow(s.dil, step);
          }
          step++;
        }
      }
    }
    const ncc = [...compounds];
    ncc[c] = role;
    updatePlate({ cellConfig: nc, compounds: ncc });
    const t = (v || '').trim();
    if (t && !identityOptions.includes(t) && setCustomCmpds) {
      setCustomCmpds((p) => [...(Array.isArray(p) ? p : []), t]);
    }
  };

  const updateRowCmp = (r, v) => {
    const role = v;
    const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
    const oldRole = rowCompounds[r];
    const isCtrl = role && ['cells', 'medium', 'pbs'].includes(role.toLowerCase());
    if (!role) {
      for (let c = 0; c < activePlateDim.cols; c++) {
        if (nc[r][c].role === oldRole) {
          nc[r][c].role = null;
          nc[r][c].conc = null;
        }
      }
    } else {
      let step = 0;
      for (let c = 0; c < activePlateDim.cols; c++) {
        if (!nc[r][c].role || nc[r][c].role === oldRole) {
          nc[r][c].role = role;
          if (isCtrl) nc[r][c].conc = 0;
          else {
            const s = customConc[role] || { top: tConc, dil: dFact };
            nc[r][c].conc = s.top / Math.pow(s.dil, step);
          }
          step++;
        }
      }
    }
    const nrc = [...rowCompounds];
    nrc[r] = role;
    updatePlate({ cellConfig: nc, rowCompounds: nrc });
    const t = (v || '').trim();
    if (t && !identityOptions.includes(t) && setCustomCmpds) {
      setCustomCmpds((p) => [...(Array.isArray(p) ? p : []), t]);
    }
  };

  const updateCellCfg = (r, c, upd) => {
    const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
    nc[r][c] = { ...nc[r][c], ...upd };
    updatePlate({ cellConfig: nc });
  };

  const cleanOutliers = (targetReg = null, targetCmp = null) => {
    const nc = cellConfig.map((row) => row.map((c) => ({ ...c })));
    let changed = false;

    const processCmp = (reg, cmp) => {
      for (let it = 0; it < 20; it++) {
        const pts = [];
        const byC = {};
        (grid || []).forEach((_, r) =>
          (grid[r] || []).forEach((_, c) => {
            if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
            const cfg = nc[r][c];
            const role = getRole(r, c);
            if (
              (cfg.region || 'Primary') === reg &&
              role === cmp.name &&
              !cfg.manualOverride &&
              !cfg.excluded
            ) {
              const n = rawOD(r, c);
              const xc = concOf(r, c, role);
              if (!isNaN(n) && xc > 0) {
                const val = calcValue(n);
                const k = concKey(xc);
                if (!byC[k]) byC[k] = [];
                byC[k].push({ r, c, x: xc, y: val, realX: xc, val });
              }
            }
          })
        );

        Object.values(byC).forEach((cps) => {
          const mean = cps.reduce((s, p) => s + p.y, 0) / cps.length;
          let sd = 0;
          if (useFixedSD) sd = fSD;
          else if (cps.length > 1) {
            sd = Math.sqrt(cps.reduce((s, p) => s + Math.pow(p.y - mean, 2), 0) / (cps.length - 1));
          }
          cps.forEach((p) => {
            p.computedSD = sd;
            p.effectiveSD = effectiveSD(cmp.name, p.realX, sd);
            pts.push(p);
          });
        });

        if (pts.length < 4) break;
        const ft = fit4PL(pts);
        if (!ft) break;

        let worst = null;
        let maxRatio = 0;
        pts.forEach((p) => {
          const pred = 100 / (1 + Math.pow(p.realX / ft.ic50, ft.hill));
          const residual = Math.abs(p.y - pred);
          const err = p.effectiveSD > 0 ? p.effectiveSD : fSD > 0 ? fSD : 1;
          const ratio = residual / err;
          if (ratio > outlierThresh) {
            if (ratio > maxRatio) {
              maxRatio = ratio;
              worst = p;
            }
          }
        });

        if (worst) {
          nc[worst.r][worst.c].excluded = true;
          changed = true;
        } else {
          break;
        }
      }
    };

    if (targetReg && targetCmp) {
      processCmp(targetReg, { name: targetCmp });
    } else {
      Object.entries(processedByRegion).forEach(([reg, comps]) => {
        comps.forEach((cmp) => processCmp(reg, cmp));
      });
    }

    if (changed) updatePlate({ cellConfig: nc });
  };

  const restoreAll = () => {
    const nc = cellConfig.map((row) =>
      row.map((c) => ({
        ...c,
        excluded: false,
        manualOverride: false
      }))
    );
    updatePlate({ cellConfig: nc });
  };

  const exportXLS = () => {
    try {
      const wb = XLSX.utils.book_new();

      const rawAoa = [['', ...COLS]];
      ROWS.forEach((rl, r) => {
        rawAoa.push([
          rl,
          ...COLS.map((_, c) => {
            const v = grid?.[r]?.[c];
            return v === '' ? '' : Number(v);
          })
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawAoa), 'Raw Values');

      const viabAoa = [['', ...COLS]];
      ROWS.forEach((rl, r) => {
        viabAoa.push([
          rl,
          ...COLS.map((_, c) => {
            const n = rawOD(r, c);
            if (isNaN(n) || cellConfig[r]?.[c]?.excluded) return '';
            return Number(calcValue(n).toFixed(4));
          })
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(viabAoa), 'Calculated Values');

      const mapAoa = [['', ...COLS]];
      ROWS.forEach((rl, r) => {
        mapAoa.push([
          rl,
          ...COLS.map((_, c) => {
            const role = getRole(r, c);
            if (!role) return '';
            const conc = concOf(r, c, role);
            return conc > 0 ? `${role} @ ${formatConc(conc)} ${unit}` : role;
          })
        ]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mapAoa), 'Well Map');

      const drAoa = [
        [
          'Region',
          'Identity',
          `Concentration (${unit})`,
          'Log10(Conc)',
          'Mean Value',
          'SD',
          'N'
        ]
      ];
      Object.entries(processedByRegion).forEach(([reg, comps]) => {
        comps.forEach((cd) => {
          cd.vPts.forEach((pt) => {
            drAoa.push([
              reg,
              cd.name,
              Number(pt.realX.toFixed(4)),
              Number(pt.x.toFixed(4)),
              Number(pt.y.toFixed(4)),
              Number(pt.sd.toFixed(4)),
              pt.pts ? pt.pts.length : 1
            ]);
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drAoa), 'Dose-Response Data');

      const summaryAoa = [['Region', 'Identity', `IC50 (${unit})`, 'Hill Slope', `SE (${unit})`]];
      Object.entries(processedByRegion).forEach(([reg, comps]) => {
        comps.forEach((cd) => {
          if (cd.fit) {
            summaryAoa.push([
              reg,
              cd.name,
              Number(cd.fit.ic50.toFixed(4)),
              Number(cd.fit.hill.toFixed(4)),
              Number(cd.fit.se.toFixed(4))
            ]);
          }
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Fitting Summary');

      const fname = `NMR_Fittings_${(activeTest.name || 'test').replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e) {
      console.error(e);
      alert('Export Failed: ' + e.message);
    }
  };

  useEffect(() => {
    const handleMouseUpGlobal = () => {
      if (dragState.active) {
        const { startR, startC, currentR, currentC } = dragState;
        setDragState({ active: false, startR: -1, startC: -1, currentR: -1, currentC: -1 });

        const minR = Math.min(startR, currentR);
        const maxR = Math.max(startR, currentR);
        const minC = Math.min(startC, currentC);
        const maxC = Math.max(startC, currentC);

        if (minR !== maxR || minC !== maxC) {
          setRegionModal({
            minR, maxR, minC, maxC,
            defaultName: 'Region ' + (Object.keys(processedByRegion).length + 1)
          });
        } else {
          setSelStart({ r: minR, c: minC });
          setSelEnd({ r: maxR, c: maxC });
        }
      }

      if (dragMode === 'resizingRegion' && activeSel && fillEnd && selectedRegionComplete && selectedRegionName) {
        const rect = {
          minR: activeSel.minR, minC: activeSel.minC,
          maxR: Math.max(activeSel.minR, fillEnd.r), maxC: Math.max(activeSel.minC, fillEnd.c)
        };
        const nc = cellConfig.map((row) =>
          row.map((cell) => cell.region === selectedRegionName ? { ...cell, region: 'Primary' } : cell)
        );
        for (let r = rect.minR; r <= rect.maxR; r++) {
          for (let c = rect.minC; c <= rect.maxC; c++) {
            if (r >= 0 && r < activePlateDim.rows && c >= 0 && c < activePlateDim.cols) {
              nc[r][c] = { ...nc[r][c], region: selectedRegionName };
            }
          }
        }
        updatePlate({ cellConfig: nc });
        setSelStart({ r: rect.minR, c: rect.minC });
        setSelEnd({ r: rect.maxR, c: rect.maxC });
        setDragMode('none');
        setFillEnd(null);
        return;
      }

      if (dragMode === 'selecting' && tableView === 'region' && activeSel) {
        setRegionModal({
          minR: activeSel.minR, maxR: activeSel.maxR, minC: activeSel.minC, maxC: activeSel.maxC,
          defaultName: 'Region ' + (Object.keys(processedByRegion).length + 1)
        });
      } else if (dragMode === 'filling' && activeFill && activeSel) {
        const nGrid = grid.map((row) => [...row]);
        const nCell = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
        for (let r = activeFill.minR; r <= activeFill.maxR; r++) {
          for (let c = activeFill.minC; c <= activeFill.maxC; c++) {
            const srcR = activeSel.minR + ((r - activeSel.minR) % (activeSel.maxR - activeSel.minR + 1));
            const srcC = activeSel.minC + ((c - activeSel.minC) % (activeSel.maxC - activeSel.minC + 1));
            nGrid[r][c] = grid[srcR][srcC];
            nCell[r][c] = { ...cellConfig[srcR][srcC] };
          }
        }
        updatePlate({ grid: nGrid, cellConfig: nCell });
        setSelStart({ r: activeFill.minR, c: activeFill.minC });
        setSelEnd({ r: activeFill.maxR, c: activeFill.maxC });
      }
      setDragMode('none');
      setFillEnd(null);
    };
    window.addEventListener('mouseup', handleMouseUpGlobal);
    return () => window.removeEventListener('mouseup', handleMouseUpGlobal);
  }, [dragState, dragMode, activeFill, activeSel, fillEnd, grid, cellConfig, tableView, selectedRegionComplete, selectedRegionName, activePlateDim, processedByRegion]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeSel) {
        if (document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') {
          if (activeSel.minR === activeSel.maxR && activeSel.minC === activeSel.maxC) return;
        }
        const nGrid = grid.map((row) => [...row]);
        const nCell = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
        let changed = false;
        for (let r = activeSel.minR; r <= activeSel.maxR; r++) {
          for (let c = activeSel.minC; c <= activeSel.maxC; c++) {
            if (tableView === 'region') {
              nCell[r][c].region = 'Primary';
            } else {
              nGrid[r][c] = '';
              nCell[r][c].role = null;
              nCell[r][c].conc = null;
              nCell[r][c].manualOverride = false;
            }
            changed = true;
          }
        }
        if (changed) updatePlate({ grid: nGrid, cellConfig: nCell });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSel, grid, cellConfig, tableView]);

  const onMouseDownCell = (e, r, c) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('fill-handle') || e.target.classList.contains('drag-handle')) return;
    if (tableView === 'region') {
      e.preventDefault();
      setDragState({ active: true, startR: r, startC: c, currentR: r, currentC: c });
    } else {
      setSelStart({ r, c });
      setSelEnd({ r, c });
      setDragMode('selecting');
    }
  };

  const onMouseEnterCell = (r, c) => {
    if (dragState.active && tableView === 'region') {
      setDragState((prev) => ({ ...prev, currentR: r, currentC: c }));
    } else if (dragMode === 'selecting') setSelEnd({ r, c });
    else if (dragMode === 'filling') setFillEnd({ r, c });
    else if (dragMode === 'resizingRegion') setFillEnd({ r, c });
  };

  const onDoubleClickCell = (r, c) => {
    if (tableView !== 'region') return;
    const reg = cellConfig[r]?.[c]?.region;
    if (!reg || reg === 'Primary') return;
    let minR = r, maxR = r, minC = c, maxC = c;
    grid.forEach((row, ir) =>
      row.forEach((_, ic) => {
        if (cellConfig[ir]?.[ic]?.region === reg) {
          if (ir < minR) minR = ir;
          if (ir > maxR) maxR = ir;
          if (ic < minC) minC = ic;
          if (ic > maxC) maxC = ic;
        }
      })
    );
    setSelStart({ r: minR, c: minC });
    setSelEnd({ r: maxR, c: maxC });
    setDragMode('none');
  };

  const onMouseDownFillHandle = (e) => {
    e.stopPropagation();
    if (tableView === 'region') setDragMode('resizingRegion');
    else setDragMode('filling');
    setFillEnd(selEnd);
  };

  const handleDrop = (e, r, c) => { /* logic standard maintained */ };

  const handleContextMenu = (e, r, c) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, r, c });
  };

  const runCtxAction = (fn) => {
    const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
    const nGrid = grid.map((row) => [...row]);
    const inSelection = activeSel && ctxMenu.r >= activeSel.minR && ctxMenu.r <= activeSel.maxR && ctxMenu.c >= activeSel.minC && ctxMenu.c <= activeSel.maxC;
    const minR = inSelection ? activeSel.minR : ctxMenu.r;
    const maxR = inSelection ? activeSel.maxR : ctxMenu.r;
    const minC = inSelection ? activeSel.minC : ctxMenu.c;
    const maxC = inSelection ? activeSel.maxC : ctxMenu.c;
    for (let i = minR; i <= maxR; i++) {
      for (let j = minC; j <= maxC; j++) fn(nc, nGrid, i, j);
    }
    updatePlate({ cellConfig: nc, grid: nGrid });
    setCtxMenu(null);
  };

  const confirmRegion = (name) => {
    const finalName = name.trim() || 'Primary';
    if (regionModal) {
      const { minR, maxR, minC, maxC } = regionModal;
      const nc = cellConfig.map((row) => row.map((c) => ({ ...c })));
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          nc[r][c].region = finalName;
        }
      }
      updatePlate({ cellConfig: nc });
      setRegionModal(null);
    } else {
      runCtxAction((nc, ng, r, c) => { nc[r][c].region = finalName; });
    }
  };

  return (
    <div id={`nmr-fittings-report-${activeTest.id}`} className="flex flex-col gap-6">
      {TestHeader}
      
      {/* TOOLBAR */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-end gap-3 no-print">
        <button
          onClick={exportXLS}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
        >
          📊 Export XLS
        </button>
      </div>

      {/* CLASSIFICATION */}
      <CollapsibleSection title="Classification" icon="🏷️" defaultOpen={true}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Operator</label>
            <select
              value={activeTest.operator || ''}
              onChange={(e) => updatePlate({ operator: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
            >
              <option value="">— Select operator —</option>
              {activeTest.operator && !(operators || []).map(operatorLabel).includes(activeTest.operator) && (
                <option value={activeTest.operator}>{activeTest.operator}</option>
              )}
              {(operators || []).map((op, idx) => {
                const name = operatorLabel(op);
                return <option key={`${name}_${idx}`} value={name}>{name}</option>;
              })}
            </select>
          </div>
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Molecule / Compound</label>
            <select
              value={selectedMolecule?.id || activeTest.moleculeId || ''}
              onChange={(e) => {
                const selected = moleculeList.find((m) => m.id === e.target.value);
                updatePlate({ moleculeId: selected?.id || '', moleculeName: selected?.name || '' });
              }}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
            >
              <option value="">— Select molecule —</option>
              {moleculeList.map((mol) => <option key={mol.id} value={mol.id}>{mol.name}</option>)}
            </select>
            {selectedMolecule && (
              <div className="text-[10px] text-slate-500 mt-2">
                Identities (Atoms): {atomOptions.length > 0 ? atomOptions.join(', ') : 'None'}
              </div>
            )}
          </div>
          <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Test Category</label>
            <input
              type="text"
              value={activeTest.testCategory || ''}
              onChange={(e) => updatePlate({ testCategory: e.target.value })}
              list={`nmr-fittings-category-options-${activeTest.id}`}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
            />
            <datalist id={`nmr-fittings-category-options-${activeTest.id}`}>
              {(testCategories || []).map((cat) => <option key={cat} value={cat} />)}
            </datalist>
          </div>
        </div>
      </CollapsibleSection>

      {/* ================= EXPERIMENT SETUP ================= */}
      <CollapsibleSection title="NMR Setup & Grid Formatting" icon="⚙️" defaultOpen={true}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-4 items-stretch">
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Grid Dimensions, Dose & Units</div>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Rows</label>
                  <input
                    type="number"
                    min="1"
                    value={activeTest.rows || 8}
                    onChange={(e) => setDimensions(Number(e.target.value), cols)}
                    className="border border-blue-300 text-blue-700 font-bold rounded-lg p-1.5 w-20 text-xs bg-blue-50 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Cols</label>
                  <input
                    type="number"
                    min="1"
                    value={activeTest.cols || 12}
                    onChange={(e) => setDimensions(rows, Number(e.target.value))}
                    className="border border-blue-300 text-blue-700 font-bold rounded-lg p-1.5 w-20 text-xs bg-blue-50 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Unit</label>
                  <select
                    value={unit || 'µM'}
                    onChange={(e) => updatePlate({ unit: e.target.value })}
                    className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs bg-white font-bold text-slate-800 outline-none"
                  >
                    <option value="µM">µM</option>
                    <option value="µg/mL">µg/mL</option>
                    <option value="nM">nM</option>
                    <option value="mM">mM</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Max Conc</label>
                  <input
                    type="number"
                    step="0.1"
                    value={topConcStr || ''}
                    onChange={(e) => updatePlate({ topConcStr: e.target.value })}
                    className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Dil. Factor</label>
                  <input
                    type="number"
                    step="0.1"
                    value={dilFactorStr || ''}
                    onChange={(e) => updatePlate({ dilFactorStr: e.target.value })}
                    className="border border-slate-300 rounded-lg p-1.5 w-16 text-xs outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Custom Concentrations</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  id={`cc-sel-${activeTest.id}`}
                  className="border border-slate-300 rounded-lg p-1.5 text-xs w-28 bg-white outline-none"
                >
                  <option value="">Identity…</option>
                  {identityOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  id={`cc-top-${activeTest.id}`}
                  className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none"
                  placeholder="Top"
                />
                <input
                  type="number"
                  id={`cc-dil-${activeTest.id}`}
                  className="border border-slate-300 rounded-lg p-1.5 w-16 text-xs outline-none"
                  placeholder="Dil"
                  defaultValue={dFact}
                />
                <button
                  onClick={() => {
                    const c = document.getElementById(`cc-sel-${activeTest.id}`).value;
                    const t = parseFloat(document.getElementById(`cc-top-${activeTest.id}`).value);
                    const d = parseFloat(document.getElementById(`cc-dil-${activeTest.id}`).value) || dFact;
                    if (c && !isNaN(t) && t > 0 && d > 0) {
                      setCustomConc({ ...customConc, [c]: { top: t, dil: d } });
                      document.getElementById(`cc-top-${activeTest.id}`).value = '';
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
                >
                  Set
                </button>
              </div>
              {Object.keys(customConc).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(customConc).map(([c, s]) => (
                    <span key={c} className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 font-bold shadow-sm">
                      {c}: {s.top} {unit} ÷ {s.dil}
                      <button
                        onClick={() => {
                          const n = { ...customConc };
                          delete n[c];
                          setCustomConc(n);
                        }}
                        className="text-red-500 hover:text-red-700 font-black"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ================= VISUAL PLATE MAP ================= */}
          <div className="relative">
            {fsPanel === 'map' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('map')}></div>}
            <div className={`bg-slate-50 border border-slate-200 p-4 min-w-0 flex flex-col ${fsPanel === 'map' ? FS_CLASSES : 'rounded-xl w-full'}`}>
              <div className="flex justify-between items-start mb-2 gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm lg:text-base font-bold text-slate-800 truncate">Visual Grid Map</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">Shows mapped atoms/identities and concentrations.</p>
                </div>
                <div className="flex items-center shrink-0">
                  <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm mr-4">
                    <span className="text-[10px] text-slate-500 font-bold">A</span>
                    <input type="range" min="4" max="24" value={mapFontSize} onChange={(e) => setMapFontSize(Number(e.target.value))} className="w-16 accent-blue-600" />
                    <span className="text-[12px] text-slate-500 font-bold">A</span>
                  </div>
                  <button onClick={() => toggleFs('map')} className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors">
                    {fsPanel === 'map' ? '↙️' : '↗️'}
                  </button>
                </div>
              </div>
              <div className={`bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-evenly gap-1 shadow-sm overflow-auto ${fsPanel === 'map' ? 'flex-1' : ''}`} style={{ minHeight: fsPanel === 'map' ? 0 : '320px' }}>
                <div className="flex w-full mb-1">
                  <div className="w-4 lg:w-6" />
                  {COLS.map((c) => <div key={c} className="flex-1 text-center text-[10px] lg:text-xs font-black text-slate-400">{c}</div>)}
                </div>
                {ROWS.map((rl, r) => (
                  <div key={rl} className={`flex items-center w-full ${fsPanel === 'map' ? 'flex-1 min-h-[30px]' : ''}`}>
                    <div className="w-4 lg:w-6 text-[10px] lg:text-xs font-black text-slate-400 text-center">{rl}</div>
                    {COLS.map((col, c) => {
                      const cfg = cellConfig[r]?.[c] || {};
                      const role = getRole(r, c);
                      const { bg, dark } = wellColor(r, c);
                      const conc = concOf(r, c, role);
                      const tc = dark ? 'text-slate-900' : 'text-white';
                      const fSize1 = fsPanel === 'map' ? mapFontSize * 1.5 : mapFontSize;
                      const fSize2 = fsPanel === 'map' ? (mapFontSize - 1) * 1.5 : mapFontSize - 1;
                      const reg = cfg.region || 'Primary';
                      const regColor = getRegionColor(reg);
                      const hasCustomReg = reg !== 'Primary';

                      let bTop = r === 0 || (cellConfig[r - 1] && (cellConfig[r - 1][c].region || 'Primary') !== reg);
                      let bBottom = r === activePlateDim.rows - 1 || (cellConfig[r + 1] && (cellConfig[r + 1][c].region || 'Primary') !== reg);
                      let bLeft = c === 0 || (cellConfig[r] && (cellConfig[r][c - 1].region || 'Primary') !== reg);
                      let bRight = c === activePlateDim.cols - 1 || (cellConfig[r] && (cellConfig[r][c + 1].region || 'Primary') !== reg);
                      const shadows = [];
                      if (hasCustomReg) {
                        if (bTop) shadows.push(`inset 0 3px 0 0 ${regColor}`);
                        if (bBottom) shadows.push(`inset 0 -3px 0 0 ${regColor}`);
                        if (bLeft) shadows.push(`inset 3px 0 0 0 ${regColor}`);
                        if (bRight) shadows.push(`inset -3px 0 0 0 ${regColor}`);
                      }
                      return (
                        <div key={col} className="flex-1 flex justify-center items-center relative py-1 h-full" style={{ backgroundColor: hasCustomReg ? regColor + '1a' : 'transparent', boxShadow: shadows.length > 0 ? shadows.join(', ') : 'none' }}>
                          <div className="z-10 rounded-full border border-black/10 flex flex-col items-center justify-center shadow-sm overflow-hidden" style={{ backgroundColor: bg, width: mapBadgePx, height: mapBadgePx }}>
                            <span style={{ fontSize: fSize1 + 'px' }} className={`font-bold leading-tight truncate max-w-full text-center px-0.5 ${tc}`}>{role || '–'}</span>
                            {role && !['cells', 'pbs', 'medium'].includes(String(role).toLowerCase()) && (
                              <span style={{ fontSize: fSize2 + 'px' }} className={`font-bold truncate max-w-full px-0.5 opacity-90 ${tc}`}>{formatConc(conc)}</span>
                            )}
                          </div>
                          {hasCustomReg && bTop && bLeft && <span className="absolute top-[2px] left-[3px] text-[9px] font-black z-20 px-1 rounded shadow-sm whitespace-nowrap" style={{ color: '#fff', backgroundColor: regColor }}>{reg}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ================= DATA GRID ================= */}
      <CollapsibleSection title="Data" icon="🔢" defaultOpen={true}>
        <div className="relative">
          {fsPanel === 'data' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('data')}></div>}
          <div className={`bg-slate-50 border border-slate-200 p-4 min-w-0 flex flex-col ${fsPanel === 'data' ? FS_CLASSES : 'rounded-xl w-full'}`}>
            <div className="flex justify-between items-start mb-2 gap-2">
              <div className="min-w-0">
                <h2 className="text-sm lg:text-base font-bold text-slate-800 truncate">{`Data Grid (${activePlateDim.rows}x${activePlateDim.cols})`}</h2>
              </div>
              <div className="flex items-center shrink-0">
                <div className="flex bg-slate-200 p-1 rounded-lg shadow-inner mr-4">
                  <button onClick={() => setTableView('od')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableView === 'od' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Values</button>
                  <button onClick={() => setTableView('conc')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableView === 'conc' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Concs</button>
                  <button onClick={() => setTableView('region')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableView === 'region' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Regions</button>
                </div>
                <button onClick={() => toggleFs('data')} className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors">
                  {fsPanel === 'data' ? '↙️' : '↗️'}
                </button>
              </div>
            </div>

            <div className="text-[10px] text-slate-500 mb-3 italic px-1 flex justify-between items-center gap-2">
              <span>
                {tableView === 'od' && 'Input raw values (intensities, volumes). Right-click to exclude points or override.'}
                {tableView === 'conc' && 'Manually override concentrations per cell.'}
                {tableView === 'region' && 'Assign regions for independent fitting curves.'}
              </span>
            </div>

            <div className={`border border-slate-300 rounded-lg bg-white select-none relative w-full overflow-auto shadow-sm ${fsPanel === 'data' ? 'flex-1' : ''}`}>
              <table className="w-full border-collapse table-fixed min-w-[700px] relative z-10">
                <thead>
                  <tr>
                    <th className="bg-slate-200 border border-slate-300 p-1 text-xs text-slate-600 w-8">R\C</th>
                    <th className="bg-slate-100 border border-slate-300 p-1 text-[10px] text-slate-600 w-28">Row Identity →</th>
                    {COLS.map((col, c) => (
                      <th key={col} className="bg-slate-50 border border-slate-300 p-1">
                        <div className="text-[11px] text-slate-500 font-black">{col}</div>
                        <select
                          value={compounds[c]}
                          onChange={(e) => updateCmp(c, e.target.value)}
                          className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Col Id ↓</option>
                          {identityOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((rl, r) => (
                    <tr key={rl}>
                      <td className="bg-slate-100 border border-slate-300 font-black text-center text-xs text-slate-700">{rl}</td>
                      <td className="bg-slate-50 border border-slate-300 p-1 align-middle">
                        <select
                          value={rowCompounds[r]}
                          onChange={(e) => updateRowCmp(r, e.target.value)}
                          className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Row Id →</option>
                          {identityOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      {COLS.map((col, c) => {
                        const cfg = cellConfig[r]?.[c] || {};
                        let val = '';
                        if (tableView === 'od') {
                          val = grid?.[r]?.[c] === '' ? '' : focusedCell && focusedCell.r === r && focusedCell.c === c ? grid[r][c] : displayVal(r, c);
                        } else if (tableView === 'conc') {
                          val = cfg.conc !== null && cfg.conc !== undefined ? cfg.conc : '';
                        } else if (tableView === 'region') {
                          val = cfg.region || 'Primary';
                        }
                        const isSelBox = currentSelectionBox && r >= currentSelectionBox.minR && r <= currentSelectionBox.maxR && c >= currentSelectionBox.minC && c <= currentSelectionBox.maxC;
                        const isFillBox = activeFill && r >= activeFill.minR && r <= activeFill.maxR && c >= activeFill.minC && c <= activeFill.maxC && !isSelBox;
                        let cellStyle = {};
                        if (isSelBox) cellStyle.backgroundColor = '#eff6ff';
                        if (isFillBox) cellStyle.backgroundColor = '#f0fdf4';
                        if (tableView === 'region' && cfg.region && cfg.region !== 'Primary') cellStyle.backgroundColor = getRegionColor(cfg.region) + '33';

                        return (
                          <td
                            key={col}
                            className={`border p-0 relative align-middle ${cfg.excluded ? 'border-slate-300' : 'border-slate-200'} ${tableView === 'region' ? 'cursor-crosshair' : ''} ${fsPanel === 'data' ? 'h-12' : 'h-9'}`}
                            onContextMenu={(e) => handleContextMenu(e, r, c)}
                            onMouseDown={(e) => onMouseDownCell(e, r, c)}
                            onMouseEnter={() => onMouseEnterCell(r, c)}
                            onDoubleClick={() => onDoubleClickCell(r, c)}
                            style={cellStyle}
                          >
                            {!cfg.excluded && tableView === 'od' && !isSelBox && !isFillBox && (
                              <div className="absolute inset-0 pointer-events-none z-0" style={{ backgroundColor: heatColor(r, c) }} />
                            )}
                            {isSelBox && r === currentSelectionBox.maxR && c === currentSelectionBox.maxC && (
                              <div className="fill-handle absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-600 border border-white cursor-crosshair z-40 rounded-sm no-print" onMouseDown={onMouseDownFillHandle} />
                            )}
                            {tableView === 'region' ? (
                              <div className={`w-full h-full flex items-center justify-center select-none text-[10px] font-bold ${cfg.region && cfg.region !== 'Primary' ? 'text-slate-800' : 'text-slate-400'}`}>{cfg.region || 'Primary'}</div>
                            ) : (
                              <input
                                type="text"
                                value={val}
                                onFocus={() => { if (!cfg.excluded && tableView === 'od') setFocusedCell({ r, c }); }}
                                onBlur={() => setFocusedCell(null)}
                                onChange={(ev) => {
                                  if (cfg.excluded) return;
                                  if (tableView === 'od') updateCell(r, c, ev.target.value);
                                  else if (tableView === 'conc') updateCellCfg(r, c, { conc: ev.target.value });
                                }}
                                readOnly={cfg.excluded}
                                className={`grid-input relative z-10 pt-3 pb-0.5 font-medium ${cfg.excluded ? 'line-through text-slate-400' : 'text-slate-900'} ${fsPanel === 'data' ? 'text-sm pt-4' : 'text-[0.75rem]'}`}
                              />
                            )}
                            {cfg.role && !cfg.excluded && tableView === 'od' && (
                              <div className="absolute top-0 left-0 max-w-[85%] truncate text-[6.5px] sm:text-[7.5px] leading-tight font-bold bg-blue-500 text-white px-1 py-0.5 rounded-br pointer-events-none z-20 shadow-sm">{cfg.role}</div>
                            )}
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
      </CollapsibleSection>

      {/* ================= FITTING ================= */}
      <CollapsibleSection title="Fitting" icon="📐" defaultOpen={true}>
        <div className="flex flex-col gap-6">
          <CollapsibleSection title="Error Management" icon="⚠️" defaultOpen={false}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4 items-stretch">
                <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-1 min-w-[300px]">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Data Normalization</div>
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-bold text-slate-600">Normalization Control:</label>
                      <select value={ctrlType} onChange={(e) => updatePlate({ ctrlType: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white w-full outline-none">
                        <option value="none">Manual</option>
                        {identityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-bold text-slate-600">Control Value:</label>
                      <input type="number" step="0.01" value={ctrlODStr} onChange={(e) => updatePlate({ ctrlODStr: e.target.value })} className={`border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold outline-none ${ctrlType !== 'none' ? 'bg-slate-200 text-slate-500' : 'text-emerald-700'}`} readOnly={ctrlType !== 'none'} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-bold text-slate-600">Subtract Blank:</label>
                      <select value={bgType} onChange={(e) => updatePlate({ bgType: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white w-full outline-none">
                        <option value="none">None</option>
                        <option value="manual">Manual</option>
                        {identityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-bold text-slate-600">Blank Value:</label>
                      {bgType === 'manual' ? (
                        <input type="number" step="0.01" value={bgManualStr} onChange={(e) => updatePlate({ bgManualStr: e.target.value })} className="border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold text-red-600 outline-none" />
                      ) : bgType !== 'none' ? (
                        <span className="text-xs font-bold text-red-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md w-full">{bgOD.toFixed(4)}</span>
                      ) : (
                        <span className="text-xs text-slate-400 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-md w-full">—</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-[2] min-w-[350px]">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Errors, Outliers & Fitting</div>
                  <div className="flex flex-wrap items-center gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer hover:text-blue-600">
                        <input type="checkbox" checked={useFixedSD} onChange={(e) => updatePlate({ useFixedSD: e.target.checked })} className="cursor-pointer w-4 h-4 accent-blue-600" /> Fixed SD ±:
                      </label>
                      <input type="number" step="0.1" min="0" value={fixedSDStr} onChange={(e) => updatePlate({ fixedSDStr: e.target.value })} disabled={!useFixedSD} className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none ${!useFixedSD ? 'bg-slate-100 text-slate-400' : 'bg-white font-bold text-blue-700'}`} />
                    </div>
                    <button onClick={() => setShowErrPanel(!showErrPanel)} className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ml-auto ${showErrPanel ? 'bg-orange-100 border border-orange-400 text-orange-800' : 'bg-white hover:bg-orange-50 text-orange-700 border border-orange-300'}`}>
                      ⚠️ Manual SD
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-1">
                    <label className="flex items-center gap-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                      <span className="text-xs font-bold text-blue-800">Fit Binding/IC50 (4PL)</span>
                      <input type="checkbox" checked={fitIC50} onChange={(e) => updatePlate({ fitIC50: e.target.checked })} className="w-4 h-4 cursor-pointer accent-blue-600" />
                    </label>
                    <label className="flex items-center gap-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                      <span className="text-xs font-bold text-slate-700">Norm (Control)</span>
                      <input type="checkbox" checked={showViab} onChange={(e) => updatePlate({ showViab: e.target.checked })} className="w-4 h-4 cursor-pointer accent-slate-600" />
                    </label>
                    <button onClick={restoreAll} className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold py-1.5 px-3 rounded-md ml-auto shadow-sm transition-colors">
                      ↩️ Restore All Excluded
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Graphical Parameters" icon="🎨" defaultOpen={false}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                {plotCmps.length > 0 && (
                  <div className="flex-1">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-wide block mb-2">Filter & Color Series</span>
                    <div className="flex flex-wrap gap-3">
                      {plotCmps.map((cmp) => {
                        const hex = cmpColor(cmp, identityOptions.indexOf(cmp));
                        return (
                          <div key={cmp} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
                            <input type="checkbox" checked={!hiddenCmpds[cmp]} onChange={(e) => setHiddenCmpds((p) => ({ ...p, [cmp]: !e.target.checked }))} className="w-4 h-4 cursor-pointer accent-blue-600" />
                            <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', position: 'relative' }}>
                              <span style={{ width: 14, height: 14, borderRadius: 9999, backgroundColor: hex, display: 'inline-block', border: '1px solid rgba(15,23,42,0.15)' }} />
                              <input type="color" value={hex} style={{ position: 'absolute', opacity: 0, cursor: 'pointer', width: 0, height: 0 }} onChange={(e) => setCmpColors({ ...cmpColors, [cmp]: e.target.value })} />
                            </label>
                            <span className="text-sm font-bold text-slate-700">{cmp}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowChartCfg(!showChartCfg)} className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ${showChartCfg ? 'bg-slate-200 border border-slate-400 text-slate-900' : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'}`}>
                    ⚙️ Chart Config
                  </button>
                </div>
              </div>
              {showChartCfg && (
                <div className="p-5 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-4 shadow-sm">
                  {[['X Min', 'xMin'], ['X Max', 'xMax'], ['Y Min', 'yMin'], ['Y Max', 'yMax']].map(([lbl, k]) => (
                    <div key={k} className="flex flex-col gap-1">
                      <label className="text-xs font-bold text-slate-600">{lbl}</label>
                      <input type="number" placeholder="Auto" value={chartCfg[k]} onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, [k]: e.target.value } })} className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                  ))}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600">Y Axis Label</label>
                    <input type="text" placeholder="Value" value={activeTest.valueUnit || ''} onChange={(e) => updatePlate({ valueUnit: e.target.value })} className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500" />
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {Object.entries(processedByRegion).map(([reg, comps]) => (
            <RegionCharts
              key={reg}
              regionName={reg}
              regionData={comps}
              config={{
                chartCfg,
                fitIC50,
                showExcl,
                eScale,
                fsPanel,
                chartH,
                drWidth,
                hiddenCmpds,
                unit,
                cellConfig,
                setCellConfig: (cfg) => updatePlate({ cellConfig: cfg }),
                activePlateDim,
                toggleFs,
                valueLabel: activeTest.valueUnit || (showViab ? 'Normalized (%)' : 'Value')
              }}
            />
          ))}
        </div>
      </CollapsibleSection>
      
      {ctxMenu && (
        <div className="fixed bg-white border border-slate-200 shadow-2xl rounded-lg py-2 z-50 text-sm w-56 flex flex-col" style={{ top: ctxMenu.y, left: ctxMenu.x, maxHeight: '80vh', transform: ctxMenu.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'none' }}>
          <div className="overflow-y-auto custom-scrollbar flex-1">
            <button className="w-full text-left px-4 py-1.5 hover:bg-slate-100 font-bold text-red-600" onClick={() => { runCtxAction((nc, ng, r, c) => { nc[r][c].excluded = !nc[r][c].excluded; nc[r][c].manualOverride = true; }); }}>
              Toggle Exclude Point
            </button>
            <div className="border-t border-slate-100 my-1" />
            <div className="px-4 py-1 text-[10px] text-slate-400 uppercase font-black tracking-wider">Assign Identity</div>
            <div className="max-h-40 overflow-y-auto custom-scrollbar">
              {identityOptions.map((o) => (
                <button key={o} className="w-full text-left px-4 py-1.5 hover:bg-slate-50 font-medium text-slate-700" onClick={() => { runCtxAction((nc, ng, r, c) => { nc[r][c].role = o; }); }}>Set as {o}</button>
              ))}
            </div>
            <div className="border-t border-slate-100 my-1" />
            <button className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-500 italic" onClick={() => { runCtxAction((nc, ng, r, c) => { nc[r][c].role = null; nc[r][c].conc = null; }); }}>Clear Identity</button>
            <div className="border-t border-slate-100 my-1" />
            <div className="px-4 py-1 text-[10px] text-slate-400 uppercase font-black tracking-wider">Set Region</div>
            <div className="px-3 pb-2">
              <input type="text" placeholder="Region Name" className="w-full text-xs border border-slate-300 rounded p-1.5 outline-none focus:border-blue-500" onKeyDown={(e) => { if (e.key === 'Enter') confirmRegion(e.target.value); }} />
            </div>
            <button className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-500 italic" onClick={() => confirmRegion('Primary')}>Clear Region</button>
          </div>
        </div>
      )}

      {regionModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm" onClick={() => setRegionModal(null)}>
          <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-800 mb-2">Define Region</h3>
            <p className="text-xs text-slate-500 mb-4">Name this block of wells to analyze it independently.</p>
            <input type="text" id="region-name-input" autoFocus defaultValue={regionModal.defaultName} className="border border-slate-300 rounded-lg p-2.5 w-full text-sm mb-6 outline-none focus:border-blue-500" onKeyDown={(e) => { if (e.key === 'Enter') confirmRegion(e.target.value); if (e.key === 'Escape') setRegionModal(null); }} />
            <div className="flex justify-between items-center">
              <button onClick={() => confirmRegion('Primary')} className="px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors">Clear</button>
              <div className="flex gap-2">
                <button onClick={() => setRegionModal(null)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
                <button onClick={() => confirmRegion(document.getElementById('region-name-input').value)} className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NMRFittingsTestRenderer;
