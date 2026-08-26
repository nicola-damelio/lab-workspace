import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { CollapsibleSection } from './TestShellRenderer';
import { SharedGraphConfig, SharedErrorTreatment, ChartControlBar } from './SharedAnalysisTools';
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
import { FS_CLASSES, OVERLAY_CLASSES } from '../utils/chartStyle';

// Chart/style constants now live in ../utils/chartStyle.

// ================= ERROR INPUT =================
export const ErrInput = ({ label, value, isOverridden, onSave, onReset }) => {
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

// ================= INDIVIDUAL DOSE RESPONSE CHART =================
function IndividualDoseResponseChart({ cd, chartCfg, isFs, onToggleFs, unit, eScale }) {
    const ref = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (!ref.current) return;

        const ds = [];

        if (cd.fit && isFinite(cd.fit.ic50)) {
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
                label: `${cd.name} fit`,
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
        }

        if (chartRef.current) chartRef.current.destroy();

        chartRef.current = new Chart(ref.current, {
            type: 'scatter',
            data: { datasets: ds },
            plugins: [errBarPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: chartCfg.xPos || 'bottom',
                        min: chartCfg.xMin !== '' ? parseFloat(chartCfg.xMin) : undefined,
                        max: chartCfg.xMax !== '' ? parseFloat(chartCfg.xMax) : undefined,
                        title: {
                            display: isFs,
                            text: chartCfg.xAxisLabel || `Log₁₀ [Conc. (${unit})]`,
                            font: { size: chartCfg.fontSize + 2, weight: 'bold' },
                            color: '#334155'
                        },
                        ticks: {
                            display: isFs,
                            font: { size: chartCfg.fontSize },
                            color: '#64748b'
                        }
                    },
                    y: {
                        position: chartCfg.yPos || 'left',
                        min: chartCfg.yMin !== '' ? parseFloat(chartCfg.yMin) : undefined,
                        max: chartCfg.yMax !== '' ? parseFloat(chartCfg.yMax) : undefined,
                        title: {
                            display: isFs,
                            text: 'Viability (%)',
                            font: { size: chartCfg.fontSize + 2, weight: 'bold' },
                            color: '#334155'
                        },
                        ticks: {
                            display: isFs,
                            font: { size: chartCfg.fontSize },
                            color: '#64748b'
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                }
            }
        });

        return () => {
            if (chartRef.current) chartRef.current.destroy();
        };
    }, [cd, chartCfg, isFs, eScale, unit]);

    return (
        <div
            className={`flex flex-col bg-white ${
                isFs
                    ? FS_CLASSES + ' p-6'
                    : 'relative aspect-square p-2 cursor-pointer hover:shadow-lg transition-shadow border border-slate-200 rounded-lg group'
            }`}
            onClick={!isFs ? onToggleFs : undefined}
        >
            <div className="flex justify-between items-start mb-1 z-10">
                <h4 className="text-xs font-bold text-slate-600 uppercase truncate w-[80%]">
                    {cd.name}
                </h4>
                {!isFs && (
                    <button className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1 transition-all text-[10px]">
                        ↗️
                    </button>
                )}
                {isFs && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFs();
                        }}
                        className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors no-print"
                    >
                        ↙️
                    </button>
                )}
            </div>
            <div className={`flex-1 relative min-h-0 ${!isFs ? 'pointer-events-none' : ''}`}>
                <canvas ref={ref} />
            </div>
        </div>
    );
}

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
        chartType
    } = config;

    const drRef = useRef(null);
    const ic50Ref = useRef(null);
    const drChart = useRef(null);
    const ic50Chart = useRef(null);

    const isDrFs = fsPanel === `dr_${regionName}`;
    const isIc50Fs = fsPanel === `ic50_${regionName}`;

    const isHistogram = chartType === 'histogram';

    // Dose-Response / Histogram Chart
    useEffect(() => {
        if (!drRef.current) return;

        const ds = [];
        const map = [];

        regionData.forEach((cd) => {
            if (hiddenCmpds[cd.name]) return;

            if (isHistogram) {
                // Histogram mode: show IC50 values as bars
                if (cd.fit && isFinite(cd.fit.ic50)) {
                    ds.push({
                        label: cd.name,
                        data: [{ x: cd.name, y: cd.fit.ic50 }],
                        backgroundColor: cd.color + '99',
                        borderColor: cd.color,
                        borderWidth: 1,
                        type: 'bar'
                    });
                }
            } else {
                // Standard dose-response mode
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
            }
        });

        if (drChart.current) drChart.current.destroy();

        const chartConfig = isHistogram
            ? {
                  type: 'bar',
                  data: {
                      labels: regionData.filter((cd) => !hiddenCmpds[cd.name] && cd.fit).map((cd) => cd.name),
                      datasets: [
                          {
                              label: `IC50 (${unit})`,
                              data: regionData
                                  .filter((cd) => !hiddenCmpds[cd.name] && cd.fit)
                                  .map((cd) => cd.fit.ic50),
                              backgroundColor: regionData
                                  .filter((cd) => !hiddenCmpds[cd.name] && cd.fit)
                                  .map((cd) => cd.color + '99'),
                              borderColor: regionData
                                  .filter((cd) => !hiddenCmpds[cd.name] && cd.fit)
                                  .map((cd) => cd.color),
                              borderWidth: 1
                          }
                      ]
                  },
                  options: {
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                          y: {
                              beginAtZero: true,
                              title: {
                                  display: true,
                                  text: `IC50 (${unit})`,
                                  font: { size: chartCfg.fontSize + 2, weight: 'bold' },
                                  color: '#334155'
                              },
                              ticks: { font: { size: chartCfg.fontSize }, color: '#64748b' }
                          },
                          x: {
                              title: {
                                  display: true,
                                  text: 'Compound',
                                  font: { size: chartCfg.fontSize + 2, weight: 'bold' },
                                  color: '#334155'
                              },
                              ticks: { font: { size: chartCfg.fontSize, weight: 'bold' }, color: '#334155' }
                          }
                      },
                      plugins: {
                          legend: { display: false },
                          tooltip: {
                              callbacks: {
                                  label: (ctx) => `IC50: ${ctx.raw.toFixed(2)} ${unit}`
                              }
                          }
                      }
                  }
              }
            : {
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
                                          if (
                                              xc > 0 &&
                                              Math.abs(Math.log10(xc) - tx) < 0.05 &&
                                              cfg.excluded
                                          ) {
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
                                  text: 'Viability (%)',
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
                                          ctx[0].raw && ctx[0].raw.realX
                                              ? ctx[0].raw.realX
                                              : Math.pow(10, logX);
                                      return `Conc: ${formatConc(realX)} ${unit} (log: ${logX.toFixed(2)})`;
                                  },
                                  label: (ctx) => {
                                      const lbl = ctx.dataset.label.replace(' [pts]', '');
                                      const y = ctx.parsed.y.toFixed(2);
                                      if (ctx.dataset.type === 'scatter') {
                                          const sd = ctx.raw.sd ? ctx.raw.sd.toFixed(2) : '0.00';
                                          return `${lbl}: ${y}% ± ${(sd * eScale).toFixed(2)}`;
                                      }
                                      return `${lbl}: ${y}%`;
                                  }
                              }
                          }
                      }
                  }
              };

        drChart.current = new Chart(drRef.current, chartConfig);

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
        isHistogram,
        chartType
    ]);

    // IC50 Comparison Chart
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
        <CollapsibleSection title={`Region: ${regionName}`} icon="📍" defaultOpen={false}>
            <div className="flex flex-col lg:flex-row gap-6 relative">
                {isDrFs && (
                    <div
                        className={OVERLAY_CLASSES}
                        onClick={() => toggleFs(`dr_${regionName}`)}
                    ></div>
                )}

                <div
                    className={`flex flex-col ${isDrFs ? FS_CLASSES + ' p-6' : 'min-w-0'}`}
                    style={!isDrFs ? { width: fitIC50 ? `${drWidth}%` : '100%', flexShrink: 0 } : {}}
                >
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">
                            {isHistogram ? 'IC50 Histogram' : 'Dose-Response Plot'}
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

                {fitIC50 && !isHistogram && (
                    <>
                        {isIc50Fs && (
                            <div
                                className={OVERLAY_CLASSES}
                                onClick={() => toggleFs(`ic50_${regionName}`)}
                            ></div>
                        )}

                        <div
                            className={`flex flex-col ${isIc50Fs ? FS_CLASSES + ' p-6' : 'flex-1 min-w-0'}`}
                        >
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

            {/* INDIVIDUAL SQUARES */}
            {fitIC50 &&
                !isHistogram &&
                regionData.filter((cd) => !hiddenCmpds[cd.name]).length > 0 && (
                    <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                        <h4 className="text-xs font-black text-slate-700 uppercase mb-3 border-b border-slate-200 pb-2">
                            Individual Dose-Response Curves
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                            {regionData
                                .filter((cd) => !hiddenCmpds[cd.name])
                                .map((cd, idx) => (
                                    <React.Fragment key={idx}>
                                        {fsPanel === `indiv_${regionName}_${idx}` && (
                                            <div
                                                className={OVERLAY_CLASSES}
                                                onClick={() => toggleFs(`indiv_${regionName}_${idx}`)}
                                            ></div>
                                        )}
                                        <IndividualDoseResponseChart
                                            cd={cd}
                                            chartCfg={chartCfg}
                                            isFs={fsPanel === `indiv_${regionName}_${idx}`}
                                            onToggleFs={() => toggleFs(`indiv_${regionName}_${idx}`)}
                                            unit={unit}
                                            eScale={eScale}
                                        />
                                    </React.Fragment>
                                ))}
                        </div>
                    </div>
                )}
        </CollapsibleSection>
    );
}

// ================= TOOLBAR =================
export const Toolbar = ({ ctx }) => {
    const exportPDF = async () => {
        const activeTest = ctx.activeTest || {};
        const el = document.getElementById(`plate-report-${activeTest.id}`);
        if (!el) return;

        const scrollParent = el.closest('.overflow-y-auto');
        const originalOverflow = scrollParent ? scrollParent.style.overflow : '';
        const originalHeight = scrollParent ? scrollParent.style.height : '';

        const loader = document.getElementById('loader');
        const loaderText = document.getElementById('loader-text');

        if (loader) loader.style.display = 'flex';
        if (loaderText) loaderText.innerText = 'Generating PDF...';

        const fixedEls = document.querySelectorAll('.fixed, [style*="position: fixed"]');
        fixedEls.forEach((x) => (x.style.display = 'none'));

        const noPrintEls = el.querySelectorAll('.no-print');
        noPrintEls.forEach((e) => (e.style.display = 'none'));

        if (scrollParent) {
            scrollParent.style.overflow = 'visible';
            scrollParent.style.height = 'auto';
        }

        el.classList.add('pdf-mode');
        window.scrollTo(0, 0);

        await new Promise((r) => setTimeout(r, 800));

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
                windowHeight: el.scrollHeight
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

            pdf.save(`Plate_Report_${(activeTest.name || 'test').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
        } catch (e) {
            console.error(e);
            alert('Export Failed: ' + e.message);
        } finally {
            el.classList.remove('pdf-mode');
            fixedEls.forEach((x) => (x.style.display = ''));
            noPrintEls.forEach((e) => (e.style.display = ''));

            if (scrollParent) {
                scrollParent.style.overflow = originalOverflow;
                scrollParent.style.height = originalHeight;
            }

            if (loader) loader.style.display = 'none';
        }
    };

    return (
        <div className="w-full bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-end no-print shrink-0">
            <button
                onClick={exportPDF}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-1 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
            >
                📄 Export PDF
            </button>
        </div>
    );
};

// ================= NOTEBOOK BUILDER =================
export const buildNotebookHtml = (checked, ctx) => {
    const model = ctx.plateModelRef?.current || {};
    const t = ctx.activeTest || {};

    if (!model.processedByRegion) return '';

    let html = '';

    if (checked.cond) {
        const sample =
            (ctx.selectedCompounds && ctx.selectedCompounds.length
                ? ctx.selectedCompounds.join(', ')
                : t.compound) || 'N/A';

        html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"> <b>Sample:</b> ${sample} | <b>Format:</b> ${model.activePlateDim?.rows || ''}x${model.activePlateDim?.cols || ''} | <b>Max Conc:</b> ${t.topConcStr || 'N/A'} ${t.unit || 'µM'} | <b>Dil. Factor:</b> ${t.dilFactorStr || 'N/A'} | <b>Ctrl OD:</b> ${t.ctrlODStr || 'N/A'} | <b>Blank OD:</b> ${typeof model.bgOD === 'number' ? model.bgOD.toFixed(4) : 'N/A'} | <b>Cells/Well:</b> ${t.cellsSeeded || 'N/A'} | <b>Time:</b> ${t.timeBeforeRevelation || 'N/A'}h </p>`;
    }

    if (checked.map && model.plotCmps && model.plotCmps.length > 0) {
        html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"> <b>Compounds Tested:</b> ${model.plotCmps.join(', ')} </p>`;
    }

    if (checked.ic50 && Object.keys(model.processedByRegion).length > 0) {
        html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"> <tr style="background-color: #f1f5f9;"> <th style="padding: 6px; border: 1px solid #cbd5e1;">Region</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">Compound</th> <th style="padding: 6px; border: 1px solid #cbd5e1;">IC50 (${t.unit || 'µM'})</th> </tr>`;

        Object.entries(model.processedByRegion).forEach(([reg, comps]) => {
            comps.forEach((c) => {
                if (c.fit) {
                    html += `<tr> <td style="padding: 6px; border: 1px solid #e2e8f0;">${reg}</td> <td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${c.name}</b></td> <td style="padding: 6px; border: 1px solid #e2e8f0;"> ${c.fit.ic50.toFixed(3)} ± ${(c.fit.se * (model.eScale || 1)).toFixed(3)} </td> </tr>`;
                }
            });
        });

        html += `</table>`;
    }

    return html;
};

// ================= PLATE-SPECIFIC ALL-IN-ONE SECTION =================
export const All = ({ ctx }) => {
    const {
        activeTest,
        updateActiveTest,
        allCmpds = [],
        setCustomCmpds,
        customConc = {},
        setCustomConc,
        cmpColors = {},
        setCmpColors,
        appClipboard,
        setAppClipboard,
        plateModelRef
    } = ctx;

    const updatePlate = (updates) => updateActiveTest(updates);

    const {
        plateType = '96',
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
        chartType: 'dose-response',
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
    const [showErrMgmt, setShowErrMgmt] = useState(false);
    const [showGraphParams, setShowGraphParams] = useState(false);
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

    const activePlateDim = PLATES_DEF[plateType] || PLATES_DEF['96'];
    const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].slice(
        0,
        activePlateDim.rows
    );
    const COLS = Array.from({ length: activePlateDim.cols }, (_, i) => i + 1);

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
        if (cfg && cfg.conc !== null && cfg.conc !== undefined) {
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
        if (stored && /^#[0-9a-f]{6}$/i.test(stored)) {
            return stored.toLowerCase();
        }
        return toHex(PALETTE[autoIdx % PALETTE.length]);
    };

    const plotCmps = useMemo(() => {
        const s = new Set();

        compounds.forEach((c, i) => {
            if (
                i < activePlateDim.cols &&
                c &&
                !['cells', 'medium', 'pbs'].includes(String(c).toLowerCase())
            ) {
                s.add(c);
            }
        });

        rowCompounds.forEach((c, i) => {
            if (
                i < activePlateDim.rows &&
                c &&
                !['cells', 'medium', 'pbs'].includes(String(c).toLowerCase())
            ) {
                s.add(c);
            }
        });

        (grid || []).forEach((row, r) =>
            (row || []).forEach((_, c) => {
                if (r >= activePlateDim.rows || c >= activePlateDim.cols) return;
                const role = getRole(r, c);
                if (role && !['cells', 'medium', 'pbs'].includes(String(role).toLowerCase())) {
                    s.add(role);
                }
            })
        );

        return Array.from(s);
    }, [activePlateDim, grid, compounds, rowCompounds]);

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
    }, [activePlateDim, grid]);

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

    const viability = (raw) => {
        const net = raw - bgOD;
        const ctrl = cOD - bgOD;
        return Math.abs(ctrl) < 1e-6 ? 0 : (net / ctrl) * 100;
    };

    const wellColor = (r, c) => {
        const role = getRole(r, c);
        if (!role) return { bg: '#ffffff', dark: true };

        const rl = String(role).toLowerCase();
        if (rl === 'medium') return { bg: '#ff4d6d', dark: false };
        if (rl === 'pbs') return { bg: '#e5e7eb', dark: true };
        if (rl === 'cells') return { bg: '#fef08a', dark: true };

        const idx = allCmpds.indexOf(role);
        const base = cmpColor(role, idx !== -1 ? idx : 0);
        const conc = concOf(r, c, role);
        if (conc <= 0) return { bg: base, dark: needsDarkText(base) };

        const st = cmpStats[role];
        if (!st || st.min === st.max) return { bg: base, dark: needsDarkText(base) };

        const lc = Math.log10(conc);
        const lx = Math.log10(st.max);
        const ln = Math.log10(st.min);
        const frac = lx > ln ? (lc - ln) / (lx - ln) : 0;
        const bg =
            frac > 0.5 ? darken(base, (frac - 0.5) * 1.0) : lighten(base, (0.5 - frac) * 0.9);

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

        const idx = allCmpds.indexOf(role);
        const base = cmpColor(role, idx !== -1 ? idx : 0);
        const vb = Math.max(0, Math.min(100, viability(v)));
        return lighten(base, 0.25 + (vb / 100) * 0.55);
    };

    const displayVal = (r, c) => {
        const n = rawOD(r, c);
        if (isNaN(n)) return grid?.[r]?.[c] === '' ? '' : grid?.[r]?.[c];
        return showViab ? viability(n).toFixed(1) + '%' : n.toFixed(3);
    };

    const getManual = (name, realX) =>
        manualErrors[name] ? manualErrors[name][concKey(realX)] : undefined;

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

        allCmpds.forEach((cmp) => {
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

        if (plateType === '9x9box') return {};

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
                                val: viability(n),
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

                    const color = cmpColor(name, allCmpds.indexOf(name));
                    let fit = null;

                    if (fitIC50 && vPts.length >= 3) {
                        let sumW = 0;
                        const fitData = vPts.map((p) => {
                            const w = p.sd > 0 ? 1 / (p.sd * p.sd) : 1;
                            sumW += w;
                            return {
                                x: p.realX,
                                y: p.y,
                                w,
                                sd: p.sd
                            };
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
        fitIC50,
        useFixedSD,
        fSD,
        plotCmps,
        allCmpds,
        plateType
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

        Object.entries(processedByRegion).forEach(([, comps]) => {
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
        if (t && !allCmpds.includes(t) && setCustomCmpds) {
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
        if (t && !allCmpds.includes(t) && setCustomCmpds) {
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
                                const val = viability(n);
                                const k = concKey(xc);
                                if (!byC[k]) byC[k] = [];
                                byC[k].push({
                                    r,
                                    c,
                                    x: xc,
                                    y: val,
                                    realX: xc,
                                    val
                                });
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
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawAoa), 'Raw OD');

            const viabAoa = [['', ...COLS]];
            ROWS.forEach((rl, r) => {
                viabAoa.push([
                    rl,
                    ...COLS.map((_, c) => {
                        const n = rawOD(r, c);
                        if (isNaN(n) || cellConfig[r]?.[c]?.excluded) return '';
                        return Number(viability(n).toFixed(2));
                    })
                ]);
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(viabAoa), 'Viability %');

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
                    'Compound',
                    `Concentration (${unit})`,
                    'Log10(Conc)',
                    'Mean Viability (%)',
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
                            Number(pt.y.toFixed(2)),
                            Number(pt.sd.toFixed(4)),
                            pt.pts ? pt.pts.length : 1
                        ]);
                    });
                });
            });

            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drAoa), 'Dose-Response Data');

            const summaryAoa = [['Region', 'Compound', `IC50 (${unit})`, 'Hill Slope', `SE (${unit})`]];

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

            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'IC50 Summary');

const fname = `${(activeTest.name || 'test').replace(/[^a-z0-9]+/gi, '_')}.xlsx`;
            XLSX.writeFile(wb, fname);
        } catch (e) {
            console.error(e);
            alert('Export Failed: ' + e.message);
        }
    };

    useEffect(() => {
        const h = () => setCtxMenu(null);
        document.addEventListener('click', h);
        return () => document.removeEventListener('click', h);
    }, []);

    useEffect(() => {
        const handleMouseUpGlobal = () => {
            if (dragState.active) {
                const { startR, startC, currentR, currentC } = dragState;

                setDragState({
                    active: false,
                    startR: -1,
                    startC: -1,
                    currentR: -1,
                    currentC: -1
                });

                const minR = Math.min(startR, currentR);
                const maxR = Math.max(startR, currentR);
                const minC = Math.min(startC, currentC);
                const maxC = Math.max(startC, currentC);

                if (minR !== maxR || minC !== maxC) {
                    setRegionModal({
                        minR,
                        maxR,
                        minC,
                        maxC,
                        defaultName: 'Region ' + (Object.keys(processedByRegion).length + 1)
                    });
                } else {
                    setSelStart({ r: minR, c: minC });
                    setSelEnd({ r: maxR, c: maxC });
                }
            }

            if (
                dragMode === 'resizingRegion' &&
                activeSel &&
                fillEnd &&
                selectedRegionComplete &&
                selectedRegionName
            ) {
                const rect = {
                    minR: activeSel.minR,
                    minC: activeSel.minC,
                    maxR: Math.max(activeSel.minR, fillEnd.r),
                    maxC: Math.max(activeSel.minC, fillEnd.c)
                };

                const nc = cellConfig.map((row) =>
                    row.map((cell) =>
                        cell.region === selectedRegionName ? { ...cell, region: 'Primary' } : cell
                    )
                );

                for (let r = rect.minR; r <= rect.maxR; r++) {
                    for (let c = rect.minC; c <= rect.maxC; c++) {
                        if (
                            r >= 0 &&
                            r < activePlateDim.rows &&
                            c >= 0 &&
                            c < activePlateDim.cols
                        ) {
                            nc[r][c] = {
                                ...nc[r][c],
                                region: selectedRegionName
                            };
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
                    minR: activeSel.minR,
                    maxR: activeSel.maxR,
                    minC: activeSel.minC,
                    maxC: activeSel.maxC,
                    defaultName: 'Region ' + (Object.keys(processedByRegion).length + 1)
                });
            } else if (dragMode === 'filling' && activeFill && activeSel) {
                const nGrid = grid.map((row) => [...row]);
                const nCell = cellConfig.map((row) => row.map((cell) => ({ ...cell })));

                for (let r = activeFill.minR; r <= activeFill.maxR; r++) {
                    for (let c = activeFill.minC; c <= activeFill.maxC; c++) {
                        const srcR =
                            activeSel.minR + ((r - activeSel.minR) % (activeSel.maxR - activeSel.minR + 1));
                        const srcC =
                            activeSel.minC + ((c - activeSel.minC) % (activeSel.maxC - activeSel.minC + 1));

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
    }, [
        dragState,
        dragMode,
        activeFill,
        activeSel,
        fillEnd,
        grid,
        cellConfig,
        tableView,
        selectedRegionComplete,
        selectedRegionName,
        activePlateDim,
        processedByRegion
    ]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && activeSel) {
                if (
                    document.activeElement.tagName === 'INPUT' &&
                    document.activeElement.type === 'text'
                ) {
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

        if (
            e.target.classList.contains('fill-handle') ||
            e.target.classList.contains('drag-handle')
        ) {
            return;
        }

        if (tableView === 'region') {
            e.preventDefault();
            setDragState({
                active: true,
                startR: r,
                startC: c,
                currentR: r,
                currentC: c
            });
        } else {
            setSelStart({ r, c });
            setSelEnd({ r, c });
            setDragMode('selecting');
        }
    };

    const onMouseEnterCell = (r, c) => {
        if (dragState.active && tableView === 'region') {
            setDragState((prev) => ({ ...prev, currentR: r, currentC: c }));
        } else if (dragMode === 'selecting') {
            setSelEnd({ r, c });
        } else if (dragMode === 'filling') {
            setFillEnd({ r, c });
        } else if (dragMode === 'resizingRegion') {
            setFillEnd({ r, c });
        }
    };

    const onDoubleClickCell = (r, c) => {
        if (tableView !== 'region') return;

        const reg = cellConfig[r]?.[c]?.region;
        if (!reg || reg === 'Primary') return;

        let minR = r;
        let maxR = r;
        let minC = c;
        let maxC = c;

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

        if (tableView === 'region') {
            setDragMode('resizingRegion');
        } else {
            setDragMode('filling');
        }

        setFillEnd(selEnd);
    };

    const handleDrop = (e, r, c) => {
        e.preventDefault();

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.action !== 'copy' || !data.sel) return;

            const src = data.sel;
            const rOffset = r - src.minR;
            const cOffset = c - src.minC;

            const isMove =
                !e.ctrlKey && !e.metaKey && !e.shiftKey && data.sourcePlate === activeTest.id;

            if (data.regionMode && Array.isArray(data.regions)) {
                const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
                const mappings = [];

                data.regions.forEach((rowArr, i) => {
                    rowArr.forEach((reg, j) => {
                        const sr = src.minR + i;
                        const sc = src.minC + j;
                        const dr = sr + rOffset;
                        const dc = sc + cOffset;

                        if (
                            reg &&
                            reg !== 'Primary' &&
                            dr >= 0 &&
                            dr < activePlateDim.rows &&
                            dc >= 0 &&
                            dc < activePlateDim.cols
                        ) {
                            mappings.push({ sr, sc, dr, dc, reg });
                        }
                    });
                });

                if (isMove) {
                    mappings.forEach((m) => {
                        if (
                            m.sr >= 0 &&
                            m.sr < activePlateDim.rows &&
                            m.sc >= 0 &&
                            m.sc < activePlateDim.cols
                        ) {
                            nc[m.sr][m.sc].region = 'Primary';
                        }
                    });
                }

                mappings.forEach((m) => {
                    nc[m.dr][m.dc].region = m.reg;
                });

                updatePlate({ cellConfig: nc });

                setSelStart({
                    r: Math.max(0, src.minR + rOffset),
                    c: Math.max(0, src.minC + cOffset)
                });
                setSelEnd({
                    r: Math.min(activePlateDim.rows - 1, src.maxR + rOffset),
                    c: Math.min(activePlateDim.cols - 1, src.maxC + cOffset)
                });

                return;
            }

            if (!data.grid || !data.cellConfig) return;

            const nGrid = grid.map((row) => [...row]);
            const nCell = cellConfig.map((row) => row.map((cell) => ({ ...cell })));

            if (isMove) {
                for (let sr = src.minR; sr <= src.maxR; sr++) {
                    for (let sc = src.minC; sc <= src.maxC; sc++) {
                        if (
                            sr >= 0 &&
                            sr < activePlateDim.rows &&
                            sc >= 0 &&
                            sc < activePlateDim.cols
                        ) {
                            nGrid[sr][sc] = '';
                            nCell[sr][sc] = {
                                excluded: false,
                                role: null,
                                conc: null,
                                region: 'Primary',
                                manualOverride: false
                            };
                        }
                    }
                }
            }

            for (let sr = src.minR; sr <= src.maxR; sr++) {
                for (let sc = src.minC; sc <= src.maxC; sc++) {
                    const dr = sr + rOffset;
                    const dc = sc + cOffset;

                    if (
                        dr >= 0 &&
                        dr < activePlateDim.rows &&
                        dc >= 0 &&
                        dc < activePlateDim.cols
                    ) {
                        nGrid[dr][dc] = data.grid[sr][sc];
                        nCell[dr][dc] = { ...data.cellConfig[sr][sc] };
                    }
                }
            }

            updatePlate({ grid: nGrid, cellConfig: nCell });

            setSelStart({
                r: Math.max(0, src.minR + rOffset),
                c: Math.max(0, src.minC + cOffset)
            });
            setSelEnd({
                r: Math.min(activePlateDim.rows - 1, src.maxR + rOffset),
                c: Math.min(activePlateDim.cols - 1, src.maxC + cOffset)
            });
        } catch (err) {
            console.error(err);
        }
    };

    const handlePasteSpecial = (mode) => {
        if (!appClipboard) return;

        const src = appClipboard.sel;
        const srcGrid = appClipboard.grid;
        const srcCell = appClipboard.cellConfig;

        const nGrid = grid.map((row) => [...row]);
        const nCell = cellConfig.map((row) => row.map((cell) => ({ ...cell })));

        const startR = activeSel ? activeSel.minR : ctxMenu.r;
        const startC = activeSel ? activeSel.minC : ctxMenu.c;

        let changed = false;

        for (let r = src.minR; r <= src.maxR; r++) {
            for (let c = src.minC; c <= src.maxC; c++) {
                const dr = startR + (r - src.minR);
                const dc = startC + (c - src.minC);

                if (
                    dr >= 0 &&
                    dr < activePlateDim.rows &&
                    dc >= 0 &&
                    dc < activePlateDim.cols
                ) {
                    if (mode === 'all' || mode === 'od') nGrid[dr][dc] = srcGrid[r][c];
                    if (mode === 'all' || mode === 'compound') nCell[dr][dc].role = srcCell[r][c].role;
                    if (mode === 'all' || mode === 'conc') nCell[dr][dc].conc = srcCell[r][c].conc;
                    if (mode === 'all' || mode === 'region') nCell[dr][dc].region = srcCell[r][c].region;
                    changed = true;
                }
            }
        }

        if (changed) updatePlate({ grid: nGrid, cellConfig: nCell });

        setCtxMenu(null);

        setSelStart({ r: startR, c: startC });
        setSelEnd({
            r: Math.min(activePlateDim.rows - 1, startR + (src.maxR - src.minR)),
            c: Math.min(activePlateDim.cols - 1, startC + (src.maxC - src.minC))
        });
    };

    const handleContextMenu = (e, r, c) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, r, c });
    };

    const handlePaste = (ev, r, c) => {
        ev.preventDefault();

        const text = (ev.clipboardData || window.clipboardData).getData('text');
        if (!text) return;

        const lines = text.replace(/\r/g, '').split('\n');
        while (lines.length && lines[lines.length - 1] === '') lines.pop();

        const ng = grid.map((row) => [...row]);
        let changed = false;

        lines.forEach((line, i) => {
            const cells = line.split('\t');

            cells.forEach((val, j) => {
                const tr = r + i;
                const tc = c + j;

                if (
                    tr >= 0 &&
                    tr < activePlateDim.rows &&
                    tc >= 0 &&
                    tc < activePlateDim.cols
                ) {
                    ng[tr][tc] = val.trim();
                    changed = true;
                }
            });
        });

        if (changed) updatePlate({ grid: ng });
    };

    const runCtxAction = (fn) => {
        const nc = cellConfig.map((row) => row.map((cell) => ({ ...cell })));
        const nGrid = grid.map((row) => [...row]);

        const inSelection =
            activeSel &&
            ctxMenu.r >= activeSel.minR &&
            ctxMenu.r <= activeSel.maxR &&
            ctxMenu.c >= activeSel.minC &&
            ctxMenu.c <= activeSel.maxC;

        const minR = inSelection ? activeSel.minR : ctxMenu.r;
        const maxR = inSelection ? activeSel.maxR : ctxMenu.r;
        const minC = inSelection ? activeSel.minC : ctxMenu.c;
        const maxC = inSelection ? activeSel.maxC : ctxMenu.c;

        for (let i = minR; i <= maxR; i++) {
            for (let j = minC; j <= maxC; j++) {
                fn(nc, nGrid, i, j);
            }
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
            runCtxAction((nc, ng, r, c) => {
                nc[r][c].region = finalName;
            });
        }
    };

    const openRenameRegion = (oldName) => {
        if (!oldName || oldName === 'Primary') return;
        setRenameRegionModal({ oldName });
    };

    const confirmRenameRegion = (rawName) => {
        if (!renameRegionModal) return;

        const newName = (rawName || '').trim();
        const oldName = renameRegionModal.oldName;

        if (!newName) return;

        if (newName.toLowerCase() === 'primary') {
            alert('"Primary" is reserved and cannot be used as a custom region name.');
            return;
        }

        if (newName === oldName) {
            setRenameRegionModal(null);
            return;
        }

        const alreadyExists = cellConfig.some((row) => row.some((cell) => cell.region === newName));

        if (alreadyExists) {
            alert(`Region "${newName}" already exists. Please choose a unique name.`);
            return;
        }

        const nc = cellConfig.map((row) =>
            row.map((cell) => (cell.region === oldName ? { ...cell, region: newName } : cell))
        );

        updatePlate({ cellConfig: nc });
        setRenameRegionModal(null);
    };

    const selectRegionByName = (name) => {
        if (!name || name === 'Primary') return;

        let minR = activePlateDim.rows;
        let maxR = -1;
        let minC = activePlateDim.cols;
        let maxC = -1;

        for (let r = 0; r < activePlateDim.rows; r++) {
            for (let c = 0; c < activePlateDim.cols; c++) {
                const reg = cellConfig[r]?.[c]?.region;

                if (reg === name) {
                    minR = Math.min(minR, r);
                    maxR = Math.max(maxR, r);
                    minC = Math.min(minC, c);
                    maxC = Math.max(maxC, c);
                }
            }
        }

        if (maxR >= 0) {
            setSelStart({ r: minR, c: minC });
            setSelEnd({ r: maxR, c: maxC });
            setDragMode('none');
        }
    };

return (
        <div id={`plate-report-${activeTest.id}`} className="flex flex-col gap-6">
            {/* ================= EXPERIMENT SETUP ================= */}
            <CollapsibleSection title="Experiment Setup" icon="⚙️" defaultOpen={false}>
                <div className="flex flex-col gap-6">
                    {/* Format / Dose / Units / Custom concentrations */}
                    <div className="flex flex-wrap gap-4 items-stretch">
                        <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                                Format, Dose & Units
                            </div>

                            <div className="flex flex-wrap gap-3 items-end">
                                <div>
                                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                                        Plate Format
                                    </label>
                                    <select
                                        value={plateType}
                                        onChange={(e) => {
                                            const dim = PLATES_DEF[e.target.value] || PLATES_DEF['96'];

                                            const nGrid = Array(dim.rows)
                                                .fill(null)
                                                .map((_, r) =>
                                                    Array(dim.cols)
                                                        .fill(null)
                                                        .map((_, c) => grid?.[r]?.[c] || '')
                                                );

                                            const nCell = Array(dim.rows)
                                                .fill(null)
                                                .map((_, r) =>
                                                    Array(dim.cols)
                                                        .fill(null)
                                                        .map(
                                                            (_, c) =>
                                                                cellConfig?.[r]?.[c] || {
                                                                    excluded: false,
                                                                    role: null,
                                                                    conc: null,
                                                                    region: 'Primary',
                                                                    manualOverride: false
                                                                }
                                                        )
                                                );

                                            updatePlate({
                                                plateType: e.target.value,
                                                grid: nGrid,
                                                cellConfig: nCell
                                            });
                                        }}
                                        className="border border-blue-300 text-blue-700 font-bold rounded-lg p-1.5 w-32 text-xs bg-blue-50 cursor-pointer outline-none"
                                    >
                                        <option value="96">96-well Plate</option>
                                        <option value="48">48-well Plate</option>
                                        <option value="24">24-well Plate</option>
                                        <option value="12">12-well Plate</option>
                                        <option value="6">6-well Plate</option>
                                        <option value="1">1 Petri Dish</option>
                                    </select>
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
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Max Conc</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={topConcStr}
                                        onChange={(e) => updatePlate({ topConcStr: e.target.value })}
                                        className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Dil. Factor</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={dilFactorStr}
                                        onChange={(e) => updatePlate({ dilFactorStr: e.target.value })}
                                        className="border border-slate-300 rounded-lg p-1.5 w-16 text-xs outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2 flex-1 w-full md:min-w-[350px]">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">
                                Custom Concentrations
                            </div>

                            <div className="flex flex-wrap gap-2 items-center">
                                <select
                                    id={`cc-sel-${activeTest.id}`}
                                    className="border border-slate-300 rounded-lg p-1.5 text-xs w-28 bg-white outline-none"
                                >
                                    <option value="">Compound…</option>
                                    {allCmpds.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>

                                <input
                                    type="number"
                                    id={`cc-top-${activeTest.id}`}
                                    className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none"
                                    placeholder="Top µM"
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
                                        const d =
                                            parseFloat(document.getElementById(`cc-dil-${activeTest.id}`).value) || dFact;

                                        if (c && !isNaN(t) && t > 0 && d > 0) {
                                            setCustomConc({
                                                ...customConc,
                                                [c]: { top: t, dil: d }
                                            });

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
                                        <span
                                            key={c}
                                            className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 font-bold shadow-sm"
                                        >
                                            {c}: {s.top}µM ÷ {s.dil}
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
                    <div className="relative mt-6">
                        {fsPanel === 'map' && (
                            <div className={OVERLAY_CLASSES} onClick={() => toggleFs('map')}></div>
                        )}

                        <div
                            className={`bg-slate-50 border border-slate-200 p-4 min-w-0 flex flex-col ${
                                fsPanel === 'map' ? FS_CLASSES : 'rounded-xl w-full'
                            }`}
                        >
<div className="flex justify-between items-start mb-2 gap-2">
                            <div className="min-w-0">
                                <h2 className="text-sm lg:text-base font-bold text-slate-800 truncate">
                                    {`Data Grid (${activePlateDim.rows}x${activePlateDim.cols})`}
                                </h2>
                            </div>

                            <div className="flex items-center shrink-0">
                                <button
                                    onClick={exportXLS}
                                    className="mr-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors no-print"
                                >
                                    📊 Export XLS
                                </button>

                                <div className="flex bg-slate-200 p-1 rounded-lg shadow-inner mr-4">
                                        <span className="text-[10px] text-slate-500 font-bold">A</span>
                                        <input
                                            type="range"
                                            min="4"
                                            max="24"
                                            value={mapFontSize}
                                            onChange={(e) => setMapFontSize(Number(e.target.value))}
                                            className="w-16 accent-blue-600"
                                        />
                                        <span className="text-[12px] text-slate-500 font-bold">A</span>
                                    </div>

                                    <button
                                        onClick={() => toggleFs('map')}
                                        className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors"
                                    >
                                        {fsPanel === 'map' ? '↙️' : '↗️'}
                                    </button>
                                </div>
                            </div>

                            <div
                                className={`bg-white p-4 rounded-xl border border-slate-200 flex flex-col justify-evenly gap-1 shadow-sm overflow-auto ${
                                    fsPanel === 'map' ? 'flex-1' : ''
                                }`}
                                style={{ minHeight: fsPanel === 'map' ? 0 : '320px' }}
                            >
                                <div className="flex w-full mb-1">
                                    <div className="w-4 lg:w-6" />
                                    {COLS.map((c) => (
                                        <div
                                            key={c}
                                            className="flex-1 text-center text-[10px] lg:text-xs font-black text-slate-400"
                                        >
                                            {c}
                                        </div>
                                    ))}
                                </div>

                                {ROWS.map((rl, r) => (
                                    <div
                                        key={rl}
                                        className={`flex items-center w-full ${fsPanel === 'map' ? 'flex-1 min-h-[30px]' : ''}`}
                                    >
                                        <div className="w-4 lg:w-6 text-[10px] lg:text-xs font-black text-slate-400 text-center">
                                            {rl}
                                        </div>

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

                                            let bTop =
                                                r === 0 ||
                                                (cellConfig[r - 1] && (cellConfig[r - 1][c].region || 'Primary') !== reg);
                                            let bBottom =
                                                r === activePlateDim.rows - 1 ||
                                                (cellConfig[r + 1] &&
                                                    (cellConfig[r + 1][c].region || 'Primary') !== reg);
                                            let bLeft =
                                                c === 0 ||
                                                (cellConfig[r] && (cellConfig[r][c - 1].region || 'Primary') !== reg);
                                            let bRight =
                                                c === activePlateDim.cols - 1 ||
                                                (cellConfig[r] && (cellConfig[r][c + 1].region || 'Primary') !== reg);

                                            const shadows = [];

                                            if (hasCustomReg) {
                                                if (bTop) shadows.push(`inset 0 3px 0 0 ${regColor}`);
                                                if (bBottom) shadows.push(`inset 0 -3px 0 0 ${regColor}`);
                                                if (bLeft) shadows.push(`inset 3px 0 0 0 ${regColor}`);
                                                if (bRight) shadows.push(`inset -3px 0 0 0 ${regColor}`);
                                            }

                                            const boxSh = shadows.length > 0 ? shadows.join(', ') : 'none';

                                            return (
                                                <div
                                                    key={col}
                                                    className="flex-1 flex justify-center items-center relative py-1 h-full"
                                                    style={{
                                                        backgroundColor: hasCustomReg ? regColor + '1a' : 'transparent',
                                                        boxShadow: boxSh
                                                    }}
                                                >
                                                    <div
                                                        className="z-10 rounded-full border border-black/10 flex flex-col items-center justify-center shadow-sm overflow-hidden"
                                                        style={{
                                                            backgroundColor: bg,
                                                            width: mapBadgePx,
                                                            height: mapBadgePx
                                                        }}
                                                    >
                                                        <span
                                                            style={{ fontSize: fSize1 + 'px' }}
                                                            className={`font-bold leading-tight truncate max-w-full text-center px-0.5 ${tc}`}
                                                        >
                                                            {role || '–'}
                                                        </span>

                                                        {role && !['cells', 'pbs', 'medium'].includes(String(role).toLowerCase()) && (
                                                            <span
                                                                style={{ fontSize: fSize2 + 'px' }}
                                                                className={`font-bold truncate max-w-full px-0.5 opacity-90 ${tc}`}
                                                            >
                                                                {formatConc(conc)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {hasCustomReg && bTop && bLeft && (
                                                        <span
                                                            className="absolute top-[2px] left-[3px] text-[9px] font-black z-20 px-1 rounded shadow-sm whitespace-nowrap"
                                                            style={{
                                                                color: '#fff',
                                                                backgroundColor: regColor
                                                            }}
                                                        >
                                                            {reg}
                                                        </span>
                                                    )}
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
            <CollapsibleSection title="Data" icon="🔢" defaultOpen={false}>
                <div className="relative">
                    {fsPanel === 'data' && (
                        <div className={OVERLAY_CLASSES} onClick={() => toggleFs('data')}></div>
                    )}

                    <div
                        className={`bg-slate-50 border border-slate-200 p-4 min-w-0 flex flex-col ${
                            fsPanel === 'data' ? FS_CLASSES : 'rounded-xl w-full'
                        }`}
                    >
                        <div className="flex justify-between items-start mb-2 gap-2">
                            <div className="min-w-0">
                                <h2 className="text-sm lg:text-base font-bold text-slate-800 truncate">
                                    {`Data Grid (${activePlateDim.rows}x${activePlateDim.cols})`}
                                </h2>
                            </div>

                            <div className="flex items-center shrink-0">
                                <div className="flex bg-slate-200 p-1 rounded-lg shadow-inner mr-4">
                                    <button
                                        onClick={() => setTableView('od')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                                            tableView === 'od'
                                                ? 'bg-white text-blue-700 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        Raw OD
                                    </button>
                                    <button
                                        onClick={() => setTableView('conc')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                                            tableView === 'conc'
                                                ? 'bg-white text-blue-700 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        Concentrations
                                    </button>
                                    <button
                                        onClick={() => setTableView('region')}
                                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                                            tableView === 'region'
                                                ? 'bg-white text-blue-700 shadow-sm'
                                                : 'text-slate-500 hover:text-slate-700'
                                        }`}
                                    >
                                        Regions
                                    </button>
                                </div>

                                <button
                                    onClick={() => toggleFs('data')}
                                    className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors"
                                >
                                    {fsPanel === 'data' ? '↙️' : '↗️'}
                                </button>
                            </div>
                        </div>

                        <div className="text-[10px] text-slate-500 mb-3 italic px-1 flex justify-between items-center gap-2">
                            <span>
                                {tableView === 'od' && 'Input raw ODs. Right-click to exclude points or override.'}
                                {tableView === 'conc' && 'Manually override concentrations per well.'}
                                {tableView === 'region' &&
                                    'Assign regions for independent IC50 plots. Double-click a region to select it.'}
                            </span>

                            <div className="flex items-center gap-2 no-print">
                                {tableView === 'region' && selectedRegionName && (
                                    <>
                                        <span className="text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                            Selected: {selectedRegionName}
                                        </span>
                                        <button
                                            onClick={() => openRenameRegion(selectedRegionName)}
                                            className="text-blue-700 bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded font-bold transition-colors"
                                        >
                                            Rename
                                        </button>
                                        <button
                                            onClick={() => selectRegionByName(selectedRegionName)}
                                            className="text-slate-700 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded font-bold transition-colors"
                                        >
                                            Reselect
                                        </button>
                                    </>
                                )}

                                {activeSel && (
                                    <span className="text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                        Del/Backspace to Clear
                                    </span>
                                )}
                            </div>
                        </div>

                        <div
                            className={`border border-slate-300 rounded-lg bg-white select-none relative w-full overflow-auto shadow-sm ${
                                fsPanel === 'data' ? 'flex-1' : ''
                            }`}
                        >
                            <table className="w-full border-collapse table-fixed min-w-[700px] relative z-10">
                                <thead>
                                    <tr>
                                        <th className="bg-slate-200 border border-slate-300 p-1 text-xs text-slate-600 w-8">
                                            R\C
                                        </th>
                                        <th className="bg-slate-100 border border-slate-300 p-1 text-[10px] text-slate-600 w-28">
                                            Row Cmpd →
                                        </th>
                                        {COLS.map((col, c) => (
                                            <th key={col} className="bg-slate-50 border border-slate-300 p-1">
                                                <div className="text-[11px] text-slate-500 font-black">{col}</div>
                                                <select
                                                    value={compounds[c]}
                                                    onChange={(e) => updateCmp(c, e.target.value)}
                                                    className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none focus:ring-1 focus:ring-blue-500"
                                                >
                                                    <option value="">Col Cmpd ↓</option>
                                                    {allCmpds.map((o) => (
                                                        <option key={o} value={o}>
                                                            {o}
                                                        </option>
                                                    ))}
                                                </select>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody>
                                    {ROWS.map((rl, r) => (
                                        <tr key={rl}>
                                            <td className="bg-slate-100 border border-slate-300 font-black text-center text-xs text-slate-700">
                                                {rl}
                                            </td>

                                            <td className="bg-slate-50 border border-slate-300 p-1 align-middle">
                                                <select
                                                    value={rowCompounds[r]}
                                                    onChange={(e) => updateRowCmp(r, e.target.value)}
                                                    className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none focus:ring-1 focus:ring-blue-500"
                                                >
                                                    <option value="">Row Cmpd →</option>
                                                    {allCmpds.map((o) => (
                                                        <option key={o} value={o}>
                                                            {o}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>

                                            {COLS.map((col, c) => {
                                                const cfg = cellConfig[r]?.[c] || {};

                                                let val = '';

                                                if (tableView === 'od') {
                                                    val =
                                                        grid?.[r]?.[c] === ''
                                                            ? ''
                                                            : focusedCell && focusedCell.r === r && focusedCell.c === c
                                                            ? grid[r][c]
                                                            : displayVal(r, c);
                                                } else if (tableView === 'conc') {
                                                    val = cfg.conc !== null && cfg.conc !== undefined ? cfg.conc : '';
                                                } else if (tableView === 'region') {
                                                    val = cfg.region || 'Primary';
                                                }

                                                const isSelBox =
                                                    currentSelectionBox &&
                                                    r >= currentSelectionBox.minR &&
                                                    r <= currentSelectionBox.maxR &&
                                                    c >= currentSelectionBox.minC &&
                                                    c <= currentSelectionBox.maxC;

                                                const isFillBox =
                                                    activeFill &&
                                                    r >= activeFill.minR &&
                                                    r <= activeFill.maxR &&
                                                    c >= activeFill.minC &&
                                                    c <= activeFill.maxC &&
                                                    !isSelBox;

                                                const isResizeBox =
                                                    activeResize &&
                                                    r >= activeResize.minR &&
                                                    r <= activeResize.maxR &&
                                                    c >= activeResize.minC &&
                                                    c <= activeResize.maxC;

                                                let cellStyle = {};

                                                if (tableView === 'region') {
                                                    const rColor = getRegionColor(cfg.region);

                                                    if (isResizeBox) {
                                                        cellStyle.backgroundColor = '#fde68a';
                                                    } else if (isSelBox) {
                                                        cellStyle.backgroundColor = '#bfdbfe';
                                                    } else if (isFillBox) {
                                                        cellStyle.backgroundColor = '#bbf7d0';
                                                    } else if (rColor !== 'transparent') {
                                                        cellStyle.backgroundColor = rColor + '33';
                                                    }
                                                } else {
                                                    if (isSelBox) cellStyle.backgroundColor = '#eff6ff';
                                                    if (isFillBox) cellStyle.backgroundColor = '#f0fdf4';
                                                }

                                                const shadows = [];

                                                if (isSelBox) {
                                                    if (r === currentSelectionBox.minR)
                                                        shadows.push('inset 0 2px 0 0 #2563eb');
                                                    if (r === currentSelectionBox.maxR)
                                                        shadows.push('inset 0 -2px 0 0 #2563eb');
                                                    if (c === currentSelectionBox.minC)
                                                        shadows.push('inset 2px 0 0 0 #2563eb');
                                                    if (c === currentSelectionBox.maxC)
                                                        shadows.push('inset -2px 0 0 0 #2563eb');
                                                }

                                                if (isFillBox) {
                                                    if (r === activeFill.minR && r < currentSelectionBox.minR)
                                                        shadows.push('inset 0 2px 0 0 #16a34a');
                                                    if (r === activeFill.maxR && r > currentSelectionBox.maxR)
                                                        shadows.push('inset 0 -2px 0 0 #16a34a');
                                                    if (c === activeFill.minC && c < currentSelectionBox.minC)
                                                        shadows.push('inset 2px 0 0 0 #16a34a');
                                                    if (c === activeFill.maxC && c > currentSelectionBox.maxC)
                                                        shadows.push('inset -2px 0 0 0 #16a34a');
                                                }

                                                if (isResizeBox) {
                                                    if (r === activeResize.minR) shadows.push('inset 0 2px 0 0 #d97706');
                                                    if (r === activeResize.maxR) shadows.push('inset 0 -2px 0 0 #d97706');
                                                    if (c === activeResize.minC) shadows.push('inset 2px 0 0 0 #d97706');
                                                    if (c === activeResize.maxC) shadows.push('inset -2px 0 0 0 #d97706');
                                                }

                                                if (shadows.length > 0) cellStyle.boxShadow = shadows.join(', ');

                                                return (
                                                    <td
                                                        key={col}
                                                        className={`border p-0 relative align-middle ${
                                                            cfg.excluded ? 'border-slate-300' : 'border-slate-200'
                                                        } ${tableView === 'region' ? 'cursor-crosshair' : ''} ${
                                                            fsPanel === 'data' ? 'h-12' : 'h-9'
                                                        }`}
                                                        onContextMenu={(e) => handleContextMenu(e, r, c)}
                                                        onMouseDown={(e) => onMouseDownCell(e, r, c)}
                                                        onMouseEnter={() => onMouseEnterCell(r, c)}
                                                        onDoubleClick={() => onDoubleClickCell(r, c)}
                                                        onDragOver={(e) => e.preventDefault()}
                                                        onDrop={(e) => handleDrop(e, r, c)}
                                                        style={cellStyle}
                                                    >
                                                        {!cfg.excluded && tableView === 'od' && !isSelBox && !isFillBox && (
                                                            <div
                                                                className="absolute inset-0 pointer-events-none z-0"
                                                                style={{ backgroundColor: heatColor(r, c) }}
                                                            />
                                                        )}

                                                        {isSelBox &&
                                                            r === currentSelectionBox.maxR &&
                                                            c === currentSelectionBox.maxC &&
                                                            (tableView !== 'region' || selectedRegionComplete) && (
                                                                <div
                                                                    className="fill-handle absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-blue-600 border border-white cursor-crosshair z-40 rounded-sm no-print"
                                                                    onMouseDown={onMouseDownFillHandle}
                                                                    title={
                                                                        tableView === 'region'
                                                                            ? 'Drag to resize region'
                                                                            : 'Drag to fill'
                                                                    }
                                                                />
                                                            )}

                                                        {isSelBox &&
                                                            r === currentSelectionBox.minR &&
                                                            c === currentSelectionBox.minC && (
                                                                <div
                                                                    draggable={true}
                                                                    onDragStart={(e) => {
                                                                        const payload = {
                                                                            action: 'copy',
                                                                            sel: currentSelectionBox,
                                                                            sourcePlate: activeTest.id,
                                                                            tableView
                                                                        };

                                                                        if (tableView === 'region') {
                                                                            payload.regionMode = true;
                                                                            payload.regions = [];

                                                                            for (
                                                                                let rr = currentSelectionBox.minR;
                                                                                rr <= currentSelectionBox.maxR;
                                                                                rr++
                                                                            ) {
                                                                                const row = [];

                                                                                for (
                                                                                    let cc = currentSelectionBox.minC;
                                                                                    cc <= currentSelectionBox.maxC;
                                                                                    cc++
                                                                                ) {
                                                                                    row.push(cellConfig[rr]?.[cc]?.region || 'Primary');
                                                                                }

                                                                                payload.regions.push(row);
                                                                            }
                                                                        } else {
                                                                            payload.grid = grid;
                                                                            payload.cellConfig = cellConfig;
                                                                        }

                                                                        e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                                                                    }}
                                                                    className="drag-handle absolute -top-2 -left-2 w-4 h-4 bg-blue-600 text-white rounded shadow cursor-grab z-40 flex items-center justify-center text-[10px] no-print"
                                                                    title={
                                                                        tableView === 'region'
                                                                            ? 'Drag to move region'
                                                                            : 'Drag to move/copy cells'
                                                                    }
                                                                >
                                                                    ✥
                                                                </div>
                                                            )}

                                                        {tableView === 'region' ? (
                                                            <div
                                                                className={`w-full h-full flex items-center justify-center select-none text-[10px] font-bold ${
                                                                    cfg.region && cfg.region !== 'Primary'
                                                                        ? 'text-slate-800'
                                                                        : 'text-slate-400'
                                                                }`}
                                                            >
                                                                {cfg.region || 'Primary'}
                                                            </div>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={val}
                                                                onFocus={() => {
                                                                    if (!cfg.excluded && tableView === 'od') {
                                                                        setFocusedCell({ r, c });
                                                                    }
                                                                }}
                                                                onBlur={() => setFocusedCell(null)}
                                                                onChange={(ev) => {
                                                                    if (cfg.excluded) return;

                                                                    if (tableView === 'od') {
                                                                        updateCell(r, c, ev.target.value);
                                                                    } else if (tableView === 'conc') {
                                                                        updateCellCfg(r, c, {
                                                                            conc: ev.target.value
                                                                        });
                                                                    }
                                                                }}
                                                                onPaste={(ev) => {
                                                                    if (!cfg.excluded && tableView === 'od') {
                                                                        handlePaste(ev, r, c);
                                                                    }
                                                                }}
                                                                readOnly={cfg.excluded}
                                                                className={`grid-input relative z-10 pt-3 pb-0.5 font-medium ${
                                                                    cfg.excluded ? 'line-through text-slate-400' : 'text-slate-900'
                                                                } ${fsPanel === 'data' ? 'text-sm pt-4' : 'text-[0.75rem]'}`}
                                                            />
                                                        )}

                                                        {cfg.role && !cfg.excluded && tableView === 'od' && (
                                                            <div className="absolute top-0 left-0 max-w-[85%] truncate text-[6.5px] sm:text-[7.5px] leading-tight font-bold bg-blue-500 text-white px-1 py-0.5 rounded-br pointer-events-none z-20 shadow-sm">
                                                                {cfg.role}
                                                            </div>
                                                        )}

                                                        {cfg.role && tableView === 'conc' && (
                                                            <div className="absolute top-0 left-0 max-w-[85%] truncate text-[6.5px] sm:text-[7.5px] leading-tight font-bold bg-slate-300 text-slate-800 px-1 py-0.5 rounded-br pointer-events-none z-20">
                                                                {cfg.role}
                                                            </div>
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

            {/* ================= DATA ANALYSIS ================= */}
            <CollapsibleSection title="Data Analysis" icon="📐" defaultOpen={false}>
                <div className="flex flex-col gap-6">
{/* ===== TOGGLE BUTTONS FOR ERROR MGMT & GRAPHICAL PARAMS ===== */}
                    <ChartControlBar
                        showErr={showErrMgmt}
                        onToggleErr={() => setShowErrMgmt(!showErrMgmt)}
                        showCfg={showGraphParams}
                        onToggleCfg={() => setShowGraphParams(!showGraphParams)}
                        className="flex flex-wrap gap-3"
                    />

                    {/* ===== ERROR MANAGEMENT ===== */}
                    {showErrMgmt && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest border-b border-slate-200 pb-2">
                                ⚠️ Error Management
                            </h3>
                            <div className="flex flex-wrap gap-4 items-stretch">
                                {/* Data Normalization */}
                                <div className="border border-slate-200 bg-white rounded-lg p-4 flex flex-col gap-3 flex-1 min-w-[300px]">
                                    <div className="text-[10px] uppercase font-bold text-slate-500">
                                        Data Normalization
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 items-center">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-600">100% Control:</label>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={ctrlType}
                                                    onChange={(e) => updatePlate({ ctrlType: e.target.value })}
                                                    className="border border-slate-300 rounded-md p-1.5 text-xs bg-slate-50 w-full outline-none"
                                                >
                                                    <option value="none">Manual</option>
                                                    {allCmpds.map((c) => (
                                                        <option key={c} value={c}>
                                                            {c}
                                                        </option>
                                                    ))}
                                                </select>

                                                <button
                                                    onClick={autoCalcControl}
                                                    className="text-[10px] font-bold bg-indigo-100 hover:bg-indigo-200 text-indigo-800 px-2 py-1.5 rounded-md shadow-sm transition whitespace-nowrap"
                                                >
                                                    🎯 Auto
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-600">Control OD:</label>
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={ctrlODStr}
                                                    onChange={(e) => updatePlate({ ctrlODStr: e.target.value })}
                                                    className={`border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold outline-none ${
                                                        ctrlType !== 'none'
                                                            ? 'bg-slate-200 text-slate-500'
                                                            : 'text-emerald-700'
                                                    }`}
                                                    readOnly={ctrlType !== 'none'}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-600">Subtract Blank:</label>
                                            <select
                                                value={bgType}
                                                onChange={(e) => updatePlate({ bgType: e.target.value })}
                                                className="border border-slate-300 rounded-md p-1.5 text-xs bg-slate-50 w-full outline-none"
                                            >
                                                <option value="none">None</option>
                                                <option value="manual">Manual</option>
                                                {allCmpds.map((c) => (
                                                    <option key={c} value={c}>
                                                        {c}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="text-[11px] font-bold text-slate-600">Calc/Man Blank OD:</label>
                                            {bgType === 'manual' ? (
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={bgManualStr}
                                                    onChange={(e) => updatePlate({ bgManualStr: e.target.value })}
                                                    className="border border-slate-300 rounded-md p-1.5 w-full text-xs font-bold text-red-600 outline-none"
                                                />
                                            ) : bgType !== 'none' ? (
                                                <span className="text-xs font-bold text-red-600 bg-white border border-slate-200 px-3 py-1.5 rounded-md w-full">
                                                    {bgOD.toFixed(4)}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-slate-400 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-md w-full">
                                                    —
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Replaced with SharedErrorTreatment */}
                                <SharedErrorTreatment 
                                    activeTest={activeTest} 
                                    updateActiveTest={updatePlate}
                                    showFitToggle={true}
                                    customActions={
                                        <>
                                            <div className="flex flex-col gap-1">
                                                <button
                                                    onClick={autoTouchAll}
                                                    className="text-[10px] uppercase tracking-wider bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold py-1.5 px-3 rounded-md shadow-sm flex items-center justify-center gap-1 transition-colors"
                                                >
                                                    🎯 Auto-Touch All SD
                                                </button>

                                                <button
                                                    onClick={revertNormalSD}
                                                    className="text-[9px] uppercase tracking-wider bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-1 px-3 rounded-md shadow-sm flex items-center justify-center gap-1 transition-colors"
                                                >
                                                    🔄 Revert Normal SD
                                                </button>
                                            </div>

                                            <div className="w-px h-8 bg-slate-200 hidden md:block"></div>

                                            <button
                                                onClick={() => cleanOutliers()}
                                                className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-black py-2 px-4 rounded-lg text-xs shadow-sm ml-auto"
                                            >
                                                🧹 Clean Outliers
                                            </button>

                                            <button
                                                onClick={() => setShowErrPanel(!showErrPanel)}
                                                className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ml-2 ${
                                                    showErrPanel
                                                        ? 'bg-orange-100 border border-orange-400 text-orange-800'
                                                        : 'bg-white hover:bg-orange-50 text-orange-700 border border-orange-300'
                                                }`}
                                            >
                                                ⚠️ Manual SD
                                            </button>
                                        </>
                                    }
                                />
                            </div>

                            {/* Manual SD panel */}
                            {showErrPanel && (
                                <div className="p-5 bg-orange-50 border border-orange-200 rounded-xl shadow-sm mt-4">
                                    <h3 className="text-sm font-black text-orange-800 mb-4">
                                        Manual SD Overrides (Weighted Fit)
                                    </h3>

                                    <div className="flex flex-col gap-4">
                                        {Object.entries(processedByRegion).map(([reg, comps]) => (
                                            <div key={reg} className="bg-white rounded-lg border border-orange-200 p-4 shadow-sm">
                                                <h4 className="text-xs font-black text-slate-500 uppercase mb-3 border-b border-slate-100 pb-2">
                                                    Region: {reg}
                                                </h4>

                                                <div className="flex flex-col gap-4">
                                                    {comps
                                                        .filter((d) => !hiddenCmpds[d.name] && d.vPts.length > 0)
                                                        .map((comp) => (
                                                            <div key={comp.name} className="flex flex-col gap-2">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center gap-2">
                                                                        <div
                                                                            className="w-3 h-3 rounded-full"
                                                                            style={{ backgroundColor: comp.color }}
                                                                        />
                                                                        <span className="text-sm font-bold text-slate-800">{comp.name}</span>
                                                                    </div>

                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            onClick={() => {
                                                                                autoTouchSD(reg, comp.name);
                                                                                updatePlate({ useFixedSD: true });
                                                                            }}
                                                                            className="text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold shadow-sm"
                                                                        >
                                                                            🎯 Auto-Touch
                                                                        </button>

                                                                        <button
                                                                            onClick={() => cleanOutliers(reg, comp.name)}
                                                                            className="text-xs text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-2 py-1 rounded font-bold shadow-sm"
                                                                        >
                                                                            🧹 Clean Outliers
                                                                        </button>

                                                                        <button
                                                                            onClick={() => clearAllManual(comp.name)}
                                                                            className="text-xs text-orange-600 hover:underline font-bold"
                                                                        >
                                                                            🔄 Reset
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                <div className="flex flex-wrap gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                                                    {comp.vPts.map((pt) => {
                                                                        const isOverridden = hasManual(comp.name, pt.realX);

                                                                        return (
                                                                            <ErrInput
                                                                                key={`${comp.name}-${concKey(pt.realX)}`}
                                                                                label={`${formatConc(pt.realX)} µM`}
                                                                                value={
                                                                                    isOverridden ? getManual(comp.name, pt.realX) : pt.sdRaw
                                                                                }
                                                                                sdRaw={pt.sdRaw}
                                                                                isOverridden={isOverridden}
                                                                                onSave={(v) => storeManual(comp.name, pt.realX, v)}
                                                                                onReset={() => clearManual(comp.name, pt.realX)}
                                                                            />
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== GRAPHICAL PARAMETERS ===== */}
                    {showGraphParams && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest border-b border-slate-200 pb-2">
                                🎨 Graphical Parameters
                            </h3>
                            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                                {plotCmps.length > 0 && (
                                    <div className="flex-1">
                                        <span className="text-xs font-black text-slate-500 uppercase tracking-wide block mb-2">
                                            Filter & Color Series
                                        </span>

                                        <div className="flex flex-wrap gap-3">
                                            {plotCmps.map((cmp) => {
                                                const hex = cmpColor(cmp, allCmpds.indexOf(cmp));

                                                return (
                                                    <div
                                                        key={cmp}
                                                        className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={!hiddenCmpds[cmp]}
                                                            onChange={(e) =>
                                                                setHiddenCmpds((p) => ({ ...p, [cmp]: !e.target.checked }))
                                                            }
                                                            className="w-4 h-4 cursor-pointer accent-blue-600"
                                                        />

                                                        <label
                                                            style={{
                                                                cursor: 'pointer',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                position: 'relative'
                                                            }}
                                                        >
                                                            <span
                                                                style={{
                                                                    width: 14,
                                                                    height: 14,
                                                                    borderRadius: 9999,
                                                                    backgroundColor: hex,
                                                                    display: 'inline-block',
                                                                    border: '1px solid rgba(15,23,42,0.15)'
                                                                }}
                                                            />

                                                            <input
                                                                type="color"
                                                                value={hex}
                                                                style={{
                                                                    position: 'absolute',
                                                                    opacity: 0,
                                                                    cursor: 'pointer',
                                                                    width: 0,
                                                                    height: 0
                                                                }}
                                                                onChange={(e) =>
                                                                    setCmpColors({ ...cmpColors, [cmp]: e.target.value })
                                                                }
                                                            />
                                                        </label>

                                                        <span
                                                            className="text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"
                                                            onClick={() => setHiddenCmpds((p) => ({ ...p, [cmp]: !p[cmp] }))}
                                                        >
                                                            {cmp}
                                                        </span>

                                                        <button
                                                            onClick={() => {
                                                                const newHidden = {};
                                                                plotCmps.forEach((c) => {
                                                                    if (c !== cmp) newHidden[c] = true;
                                                                });
                                                                setHiddenCmpds(newHidden);
                                                            }}
                                                            className="text-[10px] bg-blue-100 text-blue-800 hover:bg-blue-200 px-2 py-0.5 rounded-md transition-colors ml-1 font-bold"
                                                        >
                                                            Solo
                                                        </button>
                                                    </div>
                                                );
                                            })}

                                            <button
                                                onClick={() => setHiddenCmpds({})}
                                                className="text-xs font-bold text-slate-500 underline hover:text-slate-800 ml-2"
                                            >
                                                Show All
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowChartCfg(!showChartCfg)}
                                        className={`font-bold py-2 px-4 rounded-lg text-xs transition-colors shadow-sm ${
                                            showChartCfg
                                                ? 'bg-slate-200 border border-slate-400 text-slate-900'
                                                : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'
                                        }`}
                                    >
                                        ⚙️ Chart Config
                                    </button>
                                </div>
                            </div>

                            {/* Replaced with SharedGraphConfig */}
                            {showChartCfg && (
                                <div className="flex flex-col gap-4">
                                    <SharedGraphConfig 
                                        activeTest={activeTest}
                                        updateActiveTest={updatePlate}
                                        unit={unit}
                                        showLayoutOptions={true}
                                        drWidth={drWidth} setDrWidth={setDrWidth}
                                        chartH={chartH} setChartH={setChartH}
                                    />
                                    
                                    <div className="p-5 bg-white border border-slate-300 rounded-xl shadow-sm w-fit">
                                        <div className="flex flex-col gap-1 w-64">
                                            <label className="text-xs font-bold text-slate-600">Chart Type (Plate Only)</label>
                                            <select
                                                value={chartCfg.chartType || 'dose-response'}
                                                onChange={(e) => updatePlate({ chartCfg: { ...chartCfg, chartType: e.target.value } })}
                                                className="border border-slate-300 rounded-md p-2 text-sm bg-slate-50 outline-none focus:border-blue-500"
                                            >
                                                <option value="dose-response">Dose-Response</option>
                                                <option value="histogram">Histogram (IC50)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* REGION CHARTS */}
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
                                renameRegion: openRenameRegion,
                                chartType: chartCfg.chartType || 'dose-response'
                            }}
                        />
                    ))}
                </div>
            </CollapsibleSection>

            {/* CONTEXT MENU */}
            {ctxMenu && (
                <div
                    className="fixed bg-white border border-slate-200 shadow-2xl rounded-lg py-2 z-50 text-sm w-56 flex flex-col"
                    style={{
                        top: ctxMenu.y,
                        left: ctxMenu.x,
                        maxHeight: '80vh',
                        transform: ctxMenu.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'none'
                    }}
                >
                    <div className="overflow-y-auto custom-scrollbar flex-1">
                        <button
                            className="w-full text-left px-4 py-1.5 hover:bg-slate-100 font-bold text-red-600"
                            onClick={() => {
                                runCtxAction((nc, ng, r, c) => {
                                    nc[r][c].excluded = !nc[r][c].excluded;
                                    nc[r][c].manualOverride = true;
                                });
                            }}
                        >
                            Toggle Exclude Point
                        </button>

                        <div className="border-t border-slate-100 my-1" />

                        <div className="px-4 py-1 text-[10px] text-slate-400 uppercase font-black tracking-wider">
                            Assign Compound
                        </div>

                        <div className="max-h-40 overflow-y-auto custom-scrollbar">
                            {allCmpds.map((o) => (
                                <button
                                    key={o}
                                    className="w-full text-left px-4 py-1.5 hover:bg-slate-50 font-medium text-slate-700"
                                    onClick={() => {
                                        runCtxAction((nc, ng, r, c) => {
                                            nc[r][c].role = o;
                                        });
                                    }}
                                >
                                    Set as {o}
                                </button>
                            ))}
                        </div>

                        <div className="border-t border-slate-100 my-1" />

                        <button
                            className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-500 italic"
                            onClick={() => {
                                runCtxAction((nc, ng, r, c) => {
                                    nc[r][c].role = null;
                                    nc[r][c].conc = null;
                                });
                            }}
                        >
                            Clear Compound
                        </button>

                        <div className="border-t border-slate-100 my-1" />

                        <div className="px-4 py-1 text-[10px] text-slate-400 uppercase font-black tracking-wider">
                            Set Region
                        </div>

                        <div className="px-3 pb-2">
                            <input
                                type="text"
                                placeholder="Region Name"
                                className="w-full text-xs border border-slate-300 rounded p-1.5 outline-none focus:border-blue-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        confirmRegion(e.target.value);
                                    }
                                }}
                            />
                        </div>

                        <button
                            className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-500 italic"
                            onClick={() => confirmRegion('Primary')}
                        >
                            Clear Region
                        </button>

                        {(() => {
                            const reg = cellConfig[ctxMenu.r]?.[ctxMenu.c]?.region;
                            if (!reg || reg === 'Primary') return null;

                            return (
                                <>
                                    <div className="border-t border-slate-100 my-1" />

                                    <button
                                        className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-700 font-medium"
                                        onClick={() => {
                                            selectRegionByName(reg);
                                            setCtxMenu(null);
                                        }}
                                    >
                                        Select Region "{reg}"
                                    </button>

                                    <button
                                        className="w-full text-left px-4 py-1.5 hover:bg-slate-50 text-slate-700 font-medium"
                                        onClick={() => {
                                            openRenameRegion(reg);
                                            setCtxMenu(null);
                                        }}
                                    >
                                        Rename Region "{reg}"
                                    </button>
                                </>
                            );
                        })()}

                        <div className="border-t border-slate-100 my-1" />

                        <div className="px-4 py-1 text-[10px] text-blue-500 uppercase font-black tracking-wider">
                            Copy / Paste
                        </div>

                        <button
                            className="w-full text-left px-4 py-1.5 hover:bg-blue-50 text-blue-700 font-bold flex items-center justify-between"
                            onClick={() => {
                                if (setAppClipboard) {
                                    setAppClipboard({
                                        sel:
                                            activeSel || {
                                                minR: ctxMenu.r,
                                                maxR: ctxMenu.r,
                                                minC: ctxMenu.c,
                                                maxC: ctxMenu.c
                                            },
                                        sourcePlate: activeTest.id,
                                        grid,
                                        cellConfig
                                    });
                                }

                                setCtxMenu(null);
                            }}
                        >
                            Copy Selection{' '}
                            <span className="text-[10px] bg-white border border-blue-200 px-1 rounded text-blue-500">
                                Ctrl+C
                            </span>
                        </button>

                        {appClipboard && (
                            <>
                                <button
                                    className="w-full text-left px-4 py-1.5 hover:bg-emerald-50 text-emerald-700 font-medium"
                                    onClick={() => handlePasteSpecial('all')}
                                >
                                    Paste All
                                </button>

                                <button
                                    className="w-full text-left px-4 py-1.5 hover:bg-emerald-50 text-emerald-700 font-medium"
                                    onClick={() => handlePasteSpecial('od')}
                                >
                                    Paste OD Only
                                </button>

                                <button
                                    className="w-full text-left px-4 py-1.5 hover:bg-emerald-50 text-emerald-700 font-medium"
                                    onClick={() => handlePasteSpecial('compound')}
                                >
                                    Paste Compound Only
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* REGION MODAL */}
            {regionModal && (
                <div
                    className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm"
                    onClick={() => setRegionModal(null)}
                >
                    <div
                        className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-black text-slate-800 mb-2">Define Region</h3>
                        <p className="text-xs text-slate-500 mb-4">
                            Name this block of wells to analyze it independently.
                        </p>

                        <input
                            type="text"
                            id="region-name-input"
                            autoFocus
                            defaultValue={regionModal.defaultName}
                            className="border border-slate-300 rounded-lg p-2.5 w-full text-sm mb-6 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRegion(e.target.value);
                                if (e.key === 'Escape') setRegionModal(null);
                            }}
                        />

                        <div className="flex justify-between items-center">
                            <button
                                onClick={() => confirmRegion('Primary')}
                                className="px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                                Clear
                            </button>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setRegionModal(null)}
                                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>

                                <button
                                    onClick={() => confirmRegion(document.getElementById('region-name-input').value)}
                                    className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* RENAME REGION MODAL */}
            {renameRegionModal && (
                <div
                    className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm no-print"
                    onClick={() => setRenameRegionModal(null)}
                >
                    <div
                        className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-black text-slate-800 mb-2">Rename Region</h3>
                        <p className="text-xs text-slate-500 mb-4">Rename "{renameRegionModal.oldName}".</p>

                        <input
                            type="text"
                            id="rename-region-input"
                            autoFocus
                            defaultValue={renameRegionModal.oldName}
                            className="border border-slate-300 rounded-lg p-2.5 w-full text-sm mb-6 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRenameRegion(e.target.value);
                                if (e.key === 'Escape') setRenameRegionModal(null);
                            }}
                        />

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setRenameRegionModal(null)}
                                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>

                            <button
                                onClick={() => confirmRenameRegion(document.getElementById('rename-region-input')?.value)}
                                className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition-colors"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default All;
