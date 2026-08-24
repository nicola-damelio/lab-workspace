import React, { useState, useRef, useEffect } from 'react';
import { ReferenceArea } from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED GRAPH CONFIGURATION  (legacy — used by Plate page)
// ─────────────────────────────────────────────────────────────────────────────
export const SharedGraphConfig = ({
    activeTest,
    updateActiveTest,
    showLayoutOptions = false,
    showWidthSlider = false,
    showHeightSlider = false,
    drWidth, setDrWidth,
    chartH, setChartH,
    unit = 'a.u.'
}) => {
    const chartCfg = activeTest.chartCfg || {
        yMin: '', yMax: '', xMin: '', xMax: '',
        ptStyle: 'circle', ptSize: 5, fontSize: 16,
        xPos: 'bottom', yPos: 'left', xAxisLabel: '',
        lineStyle: 'solid', lineThickness: 2
    };

    const updateCfg = (patch) => {
        updateActiveTest({ chartCfg: { ...chartCfg, ...patch } });
    };

    return (
        <div className="p-5 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-4 shadow-sm">
            {[
                ['X Min', 'xMin'],
                ['X Max', 'xMax'],
                ['Y Min', 'yMin'],
                ['Y Max', 'yMax']
            ].map(([lbl, k]) => (
                <div key={k} className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600">{lbl}</label>
                    <input
                        type="number"
                        placeholder="Auto"
                        value={chartCfg[k] !== undefined ? chartCfg[k] : ''}
                        onChange={(e) => updateCfg({ [k]: e.target.value })}
                        className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                    />
                </div>
            ))}

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">X Axis Label</label>
                <input
                    type="text"
                    placeholder={`e.g. Log10 [Conc. (${unit})]`}
                    value={chartCfg.xAxisLabel || ''}
                    onChange={(e) => updateCfg({ xAxisLabel: e.target.value })}
                    className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                />
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Y Axis Label</label>
                <input
                    type="text"
                    placeholder="e.g. Ellipticity (mdeg)"
                    value={chartCfg.yAxisLabel || ''}
                    onChange={(e) => updateCfg({ yAxisLabel: e.target.value })}
                    className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                />
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Font Size</label>
                <input
                    type="number"
                    value={chartCfg.fontSize || 12}
                    onChange={(e) => updateCfg({ fontSize: parseFloat(e.target.value) || 12 })}
                    className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                />
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Point Style</label>
                <select
                    value={chartCfg.ptStyle || 'circle'}
                    onChange={(e) => updateCfg({ ptStyle: e.target.value })}
                    className="border border-slate-300 rounded-md p-2 text-sm bg-white outline-none focus:border-blue-500"
                >
                    {['circle', 'triangle', 'rect', 'rectRot', 'cross', 'crossRot', 'star'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Point Size</label>
                <input
                    type="number"
                    value={chartCfg.ptSize !== undefined ? chartCfg.ptSize : 5}
                    onChange={(e) => updateCfg({ ptSize: parseFloat(e.target.value) || 1 })}
                    className="border border-slate-300 rounded-md p-2 text-sm outline-none focus:border-blue-500"
                />
            </div>

            <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">Line Style / Thick.</label>
                <div className="flex gap-2">
                    <select
                        value={chartCfg.lineStyle || 'solid'}
                        onChange={(e) => updateCfg({ lineStyle: e.target.value })}
                        className="border border-slate-300 rounded-md p-2 text-sm bg-white flex-1 outline-none focus:border-blue-500"
                    >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                    </select>
                    <input
                        type="number"
                        value={chartCfg.lineThickness !== undefined ? chartCfg.lineThickness : 2}
                        onChange={(e) => updateCfg({ lineThickness: parseFloat(e.target.value) || 2 })}
                        className="border border-slate-300 rounded-md p-2 text-sm w-16 outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            {(showLayoutOptions || showWidthSlider) && (
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600">Chart Split (Width %)</label>
                    <input
                        type="range" min="20" max="80" step="5"
                        value={drWidth || 55}
                        onChange={(e) => setDrWidth && setDrWidth(parseInt(e.target.value))}
                        className="accent-blue-600 mt-2"
                    />
                </div>
            )}

            {(showLayoutOptions || showHeightSlider) && (
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-bold text-slate-600">Chart Height (px)</label>
                    <input
                        type="range" min="200" max="1000" step="25"
                        value={chartH || 530}
                        onChange={(e) => setChartH && setChartH(parseInt(e.target.value))}
                        className="accent-blue-600 mt-2"
                    />
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED ERROR TREATMENT
// ─────────────────────────────────────────────────────────────────────────────
export const SharedErrorTreatment = ({ activeTest, updateActiveTest, showFitToggle = true, customActions }) => {
    const { useFixedSD, fixedSDStr, outlierThreshStr, fitIC50, showExcl } = activeTest;

    return (
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-[2] min-w-[350px]">
            <div className="text-[10px] uppercase font-bold text-slate-500">Errors, Outliers &amp; Fitting</div>
            <div className="flex flex-wrap items-center gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer hover:text-blue-600">
                        <input type="checkbox" checked={useFixedSD || false}
                            onChange={(e) => updateActiveTest({ useFixedSD: e.target.checked })}
                            className="cursor-pointer w-4 h-4 accent-blue-600" />
                        Fixed SD +:
                    </label>
                    <input type="number" step="0.1" min="0"
                        value={fixedSDStr !== undefined ? fixedSDStr : ''}
                        onChange={(e) => updateActiveTest({ fixedSDStr: e.target.value })}
                        disabled={!useFixedSD}
                        className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none focus:border-blue-500 ${!useFixedSD ? 'bg-slate-100 text-slate-400' : 'bg-white font-bold text-blue-700'}`}
                    />
                </div>
                {customActions && (<><div className="w-px h-8 bg-slate-200 hidden sm:block"></div>{customActions}</>)}
                <div className="w-px h-8 bg-slate-200 hidden md:block"></div>
                <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">Outlier Threshold (xErr):</label>
                    <input type="number" step="0.1" min="0.1"
                        value={outlierThreshStr !== undefined ? outlierThreshStr : '2.0'}
                        onChange={(e) => updateActiveTest({ outlierThreshStr: e.target.value })}
                        className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none focus:border-blue-500"
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-1">
                {showFitToggle && (
                    <label className="flex items-center gap-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                        <span className="text-xs font-bold text-blue-800">Fit Curve</span>
                        <input type="checkbox" checked={fitIC50 || false}
                            onChange={(e) => updateActiveTest({ fitIC50: e.target.checked })}
                            className="w-4 h-4 cursor-pointer accent-blue-600" />
                    </label>
                )}
                <label className="flex items-center gap-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                    <span className="text-xs font-bold text-slate-700">Show Excl. Points</span>
                    <input type="checkbox" checked={showExcl || false}
                        onChange={(e) => updateActiveTest({ showExcl: e.target.checked })}
                        className="w-4 h-4 cursor-pointer accent-slate-600" />
                </label>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// CHART CONTROL BAR  -- standardised Error Management / Graphical Parameters
// toggle button pair, used in all chart panels.
// ─────────────────────────────────────────────────────────────────────────────
export const ChartControlBar = ({
    showErr, onToggleErr,
    showCfg, onToggleCfg,
    showFs, onToggleFs,
    extraButtons,
    className
}) => (
    <div className={className || 'ml-auto flex gap-2'}>
        {extraButtons}
        {onToggleErr && (
            <button type="button" onClick={onToggleErr}
                className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showErr ? 'bg-orange-100 border-orange-400 text-orange-800' : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-50'}`}>
                ⚠️ Error Management
            </button>
        )}
        {onToggleCfg && (
            <button type="button" onClick={onToggleCfg}
                className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>
                🎨 Graphical Parameters
            </button>
        )}
        {onToggleFs && (
            <button type="button" onClick={onToggleFs}
                className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showFs ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'bg-white border-indigo-300 text-indigo-700 hover:bg-indigo-50'}`}>
                {showFs ? '↙️ Exit' : '↗️ Fullzoom'}
            </button>
        )}
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN / FULLZOOM  -- shared classes used by ChartPanel and any chart
// panel that opts into the "Fullzoom" button.
// ─────────────────────────────────────────────────────────────────────────────
export const CHART_FS_CLASSES =
    'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-auto flex flex-col';

// Fullscreen context: any chart inside a ChartPanel can read whether the panel
// is in Fullzoom mode and enlarge itself accordingly (recharts needs an
// explicit pixel height, so in fullscreen we grow the charts to fill the viewport).
export const ChartFsContext = React.createContext(false);
export const useChartFs = () => React.useContext(ChartFsContext);

// helper: sensible chart height for the current fullscreen state
export const useChartFsHeight = (normalHeight) => {
    const isFs = useChartFs();
    if (!isFs) return normalHeight;
    if (typeof window === 'undefined') return normalHeight;
    return Math.max(480, window.innerHeight - 210);
};

// ─────────────────────────────────────────────────────────────────────────────
// CHART PANEL  -- fully generalised wrapper for every chart / graph / spectrum.
// Renders the standard header (title + Error Management / Graphical Parameters /
// Fullzoom buttons) plus the optional panels, and supports fullscreen mode.
//
// Props:
//   title, icon      -- header title
//   children         -- the chart / spectrum / table body
//   errPanel         -- JSX rendered when "Error Management" is open (optional)
//   cfgPanel         -- JSX rendered when "Graphical Parameters" is open (optional)
//   footer           -- legend / metadata below the body (optional)
//   headerExtra      -- extra buttons rendered before the standard ones
//   bodyClassName, className
//   defaultOpenErr, defaultOpenCfg, defaultFs
// ─────────────────────────────────────────────────────────────────────────────
export const ChartPanel = ({
    title = '',
    icon = '📊',
    children,
    errPanel = null,
    cfgPanel = null,
    footer = null,
    headerExtra = null,
    bodyClassName = '',
    className = '',
    defaultOpenErr = false,
    defaultOpenCfg = false,
    defaultFs = false,
}) => {
    const [showErr, setShowErr] = useState(defaultOpenErr);
    const [showCfg, setShowCfg] = useState(defaultOpenCfg);
    const [isFs, setIsFs] = useState(defaultFs);
    const toggleFs = () => setIsFs((v) => !v);

    return (
        <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-col min-h-0 ${isFs ? CHART_FS_CLASSES : ''} ${className}`}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    {icon && <span className="text-base shrink-0">{icon}</span>}
                    <h4 className="text-sm font-bold text-slate-700 truncate">{title}</h4>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {headerExtra}
                    <ChartControlBar
                        showErr={showErr}
                        onToggleErr={errPanel ? () => setShowErr((v) => !v) : null}
                        showCfg={showCfg}
                        onToggleCfg={cfgPanel ? () => setShowCfg((v) => !v) : null}
                        showFs={isFs}
                        onToggleFs={toggleFs}
                        className="flex items-center gap-2"
                    />
                </div>
            </div>

            {showErr && errPanel && (
                <div className="mb-3 p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm shrink-0">{errPanel}</div>
            )}
            {showCfg && cfgPanel && (
                <div className="mb-3 p-4 bg-slate-50 border border-slate-200 rounded-lg shadow-sm shrink-0">{cfgPanel}</div>
            )}

            <ChartFsContext.Provider value={isFs}>
                <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
            </ChartFsContext.Provider>
            {footer && <div className="mt-2 shrink-0">{footer}</div>}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CHART STYLE PANEL  -- full graphical-parameters panel
// Replaces local GraphConfigPanel / ChartStylePanel in NMR, CD, ssNMR.
// Props:
//   cfg        -- style object (see field list below)
//   setCfg     -- (patch) => void  (merges into cfg)
//   series     -- [{ key, label, color }]  for per-series colour pickers
//   unit       -- string for axis label placeholder
//   showHeightSlider -- show height range slider (default true)
// ─────────────────────────────────────────────────────────────────────────────
const NF = ({ label, value, onChange, step = 1, placeholder = '' }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-slate-600">{label}</label>
        <input type="number" step={step} placeholder={placeholder} value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            onWheel={(e) => e.target.blur()}
            className="border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
    </div>
);
const TF = ({ label, value, onChange, placeholder = '' }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-slate-600">{label}</label>
        <input type="text" placeholder={placeholder} value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 bg-white" />
    </div>
);
const SF = ({ label, value, onChange, options }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold text-slate-600">{label}</label>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}
            className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
    </div>
);
const CB = ({ label, checked, onChange }) => (
    <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
        <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-blue-600" />
        {label}
    </label>
);

export const SharedChartStylePanel = ({ cfg = {}, setCfg, series = [], unit = 'a.u.', showHeightSlider = true }) => {
    const set = (patch) => setCfg({ ...patch });
    return (
        <div className="p-4 bg-white border border-slate-300 rounded-xl flex flex-col gap-4 shadow-sm">

            {/* Chart Appearance */}
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Chart Appearance</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <SF label="Chart type" value={cfg.chartType || 'line'} onChange={(v) => set({ chartType: v })}
                        options={[['line','Line'],['bar','Bar / Histogram'],['scatter','Scatter (no line)'],['area','Area']]} />
                    <SF label="Error bar style" value={cfg.errorBarStyle || 'caps'} onChange={(v) => set({ errorBarStyle: v })}
                        options={[['caps','Caps (standard)'],['no-caps','No caps'],['band','Shaded band'],['none','None']]} />
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-600">Error bar colour</label>
                        <input type="color" value={cfg.errorBarColor || '#94a3b8'}
                            onChange={(e) => set({ errorBarColor: e.target.value })}
                            className="w-10 h-8 rounded cursor-pointer border border-slate-300 bg-white" />
                    </div>
                    <NF label="Line thickness" step={0.5} value={cfg.lineThickness ?? 2} onChange={(v) => set({ lineThickness: v || 2 })} />
                    <SF label="Line style" value={cfg.lineStyle || 'solid'} onChange={(v) => set({ lineStyle: v })}
                        options={[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]} />
                    <SF label="Point style" value={cfg.pointStyle || cfg.ptStyle || 'circle'} onChange={(v) => set({ pointStyle: v, ptStyle: v })}
                        options={[['circle','Circle'],['square','Square'],['triangle','Triangle'],['cross','Cross'],['none','None']]} />
                    <NF label="Point size" value={cfg.ptSize ?? 5} onChange={(v) => set({ ptSize: v || 5 })} />
                    <NF label="Font size (px)" value={cfg.fontSize ?? 12} onChange={(v) => set({ fontSize: v || 12 })} />
                </div>
            </div>

            {/* Axis Ranges */}
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Axis Ranges &amp; Labels</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
                        <div className="flex gap-1">
                            <input type="number" placeholder="auto" value={cfg.xMin ?? ''} onChange={(e) => set({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                            <input type="number" placeholder="auto" value={cfg.xMax ?? ''} onChange={(e) => set({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
                        <div className="flex gap-1">
                            <input type="number" placeholder="auto" value={cfg.yMin ?? ''} onChange={(e) => set({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                            <input type="number" placeholder="auto" value={cfg.yMax ?? ''} onChange={(e) => set({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                        </div>
                    </div>
                    <TF label="X axis label" value={cfg.xAxisLabel} onChange={(v) => set({ xAxisLabel: v })} placeholder={`e.g. ${unit}`} />
                    <TF label="Y axis label" value={cfg.yAxisLabel} onChange={(v) => set({ yAxisLabel: v })} placeholder="e.g. Intensity (a.u.)" />
                </div>
            </div>

            {/* Tick Settings */}
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Tick Settings</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <TF label="X tick interval (num spacing / cat every N)" value={cfg.xTickStep ?? cfg.tickStep ?? ''} onChange={(v) => set({ xTickStep: v, tickStep: v })} placeholder="auto" />
                    <TF label="Y tick interval" value={cfg.yTickStep ?? ''} onChange={(v) => set({ yTickStep: v })} placeholder="auto" />
                    <SF label="Tick label angle" value={String(cfg.tickAngle ?? 0)} onChange={(v) => set({ tickAngle: Number(v) })}
                        options={[['0','0 deg (horizontal)'],['-30','-30 deg'],['-45','-45 deg'],['-60','-60 deg'],['-90','-90 deg (vertical)'],['30','30 deg'],['45','45 deg'],['90','90 deg']]} />
                    <div className="flex flex-col gap-2 mt-1">
                        <CB label="Log X axis" checked={cfg.xLog} onChange={(v) => set({ xLog: v })} />
                        <CB label="Log Y axis" checked={cfg.yLog} onChange={(v) => set({ yLog: v })} />
                    </div>
                </div>
            </div>

            {/* Layout */}
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Layout</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                    <NF label="Aspect ratio W/H" step={0.1} value={cfg.aspect ?? 1.8} onChange={(v) => set({ aspect: v || 1.8 })} />
                    {showHeightSlider && (
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-600">Chart height (px) -- {cfg.height || 380}</label>
                            <input type="range" min="150" max="1000" step="10" value={cfg.height || 380}
                                onChange={(e) => set({ height: parseInt(e.target.value) })}
                                className="accent-blue-600 mt-2" />
                        </div>
                    )}
                    <SF label="Legend position" value={cfg.legend || 'top'} onChange={(v) => set({ legend: v })}
                        options={[['top','Top'],['bottom','Bottom'],['none','None']]} />
                </div>
            </div>

            {/* Series colours */}
            {series.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Series colours</p>
                    <div className="flex flex-wrap gap-3">
                        {series.map((s) => (
                            <label key={s.key} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                                <input type="color"
                                    value={(cfg.colors && cfg.colors[s.key]) || s.color || '#3b82f6'}
                                    onChange={(e) => set({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
                                    className="w-6 h-6 rounded cursor-pointer border border-slate-300" />
                                {s.label}
                            </label>
                        ))}
                    </div>
                </div>
            )}

            <p className="text-[9px] text-slate-400">Drag with the mouse over any graph to zoom. Use Reset Zoom to restore.</p>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// useXZoom — drag-to-zoom on a Recharts X axis
// Usage:
//   const chartRef = useRef(null);
//   const zoom = useXZoom(chartRef, [xMin, xMax]);
//   <div ref={chartRef} onMouseDown={zoom.onMouseDown}>
//     <ResponsiveContainer>...
//       <XAxis domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow />
//       {zoom.refLo!=null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} ... />}
//     ...
//   {zoom.isZoomed && <button onClick={zoom.reset}>Reset Zoom</button>}
// ─────────────────────────────────────────────────────────────────────────────
export const useXZoom = (chartRef, dataDomain, margin = { top: 20, right: 20, bottom: 45, left: 50 }) => {
  const [domain, setDomain] = useState(null);
  const [lo, setLo] = useState(null);
  const [hi, setHi] = useState(null);
  const dragging = useRef(false);
  const loRef = useRef(null);
  const safe = Array.isArray(dataDomain) && dataDomain[1] > dataDomain[0] ? dataDomain : [0, 1];
  const eff = domain || safe;
  const effRef = useRef(eff);
  effRef.current = eff;

  const getX = (clientX) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - margin.left - margin.right;
    if (plotW <= 0) return null;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - margin.left) / plotW));
    const d0 = effRef.current;
    return d0[0] + fx * (d0[1] - d0[0]);
  };

  useEffect(() => {
    const mv = (e) => { if (dragging.current) setHi(getX(e.clientX)); };
    const up = (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      const end = getX(e.clientX);
      const start = loRef.current;
      if (start !== null && end !== null && Math.abs(end - start) > (effRef.current[1] - effRef.current[0]) * 0.01) {
        setDomain([Math.min(start, end), Math.max(start, end)]);
      }
      loRef.current = null; setLo(null); setHi(null);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);

  const onMouseDown = (e) => {
    const v = getX(e.clientX);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };

  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

// Y-axis drag-to-zoom (used for bar/vertical charts)
export const useYZoom = (chartRef, dataDomain, margin = { top: 10, right: 20, bottom: 30, left: 50 }) => {
  const [domain, setDomain] = useState(null);
  const [lo, setLo] = useState(null);
  const [hi, setHi] = useState(null);
  const dragging = useRef(false);
  const loRef = useRef(null);
  const safe = Array.isArray(dataDomain) && dataDomain[1] > dataDomain[0] ? dataDomain : [0, 1];
  const eff = domain || safe;
  const effRef = useRef(eff);
  effRef.current = eff;

  const getY = (clientY) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotH = rect.height - margin.top - margin.bottom;
    if (plotH <= 0) return null;
    const fy = Math.min(1, Math.max(0, (clientY - rect.top - margin.top) / plotH));
    const d0 = effRef.current;
    return d0[1] - fy * (d0[1] - d0[0]);
  };

  useEffect(() => {
    const mv = (e) => { if (dragging.current) setHi(getY(e.clientY)); };
    const up = (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      const end = getY(e.clientY);
      const start = loRef.current;
      if (start !== null && end !== null && Math.abs(end - start) > (effRef.current[1] - effRef.current[0]) * 0.01) {
        setDomain([Math.min(start, end), Math.max(start, end)]);
      }
      loRef.current = null; setLo(null); setHi(null);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);

  const onMouseDown = (e) => {
    const v = getY(e.clientY);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };

  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};
