import React, { useState, useRef, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea, ReferenceLine,
  ResponsiveContainer, ErrorBar
} from 'recharts';
import { BASE_COLOR_SWATCHES, shadesFromColor, rainbowColors, DEFAULT_CHART_FONT_SIZE } from '../utils/chartStyle';
import { Icon } from './Icons';


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
// ANGLED TICK  -- rotated axis tick label, honours the "Tick label angle"
// setting of SharedChartStylePanel (cfg.tickAngle). Previously copy-pasted in
// CDSections / ssNMRSections / NMRSections.
// ─────────────────────────────────────────────────────────────────────────────
export const AngledTick = ({ x, y, payload, angle = 0, fontSize = 11, anchor = 'middle', formatter }) => {
    const a = Number(angle) || 0;
    return (
        <g transform={`translate(${x || 0},${y || 0})`}>
            <text
                transform={a ? `rotate(${a})` : undefined}
                textAnchor={a < 0 ? 'end' : a > 0 ? 'start' : anchor}
                dy={a ? 4 : 12}
                dx={a ? (a > 0 ? 4 : -4) : 0}
                fill="#64748b"
                fontSize={fontSize}
            >
                {formatter ? formatter(payload.value) : String(payload.value)}
            </text>
        </g>
    );
};

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
                    {icon && <Icon name={icon} size={18} className="shrink-0 text-slate-500" />}
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
                    <TF label="Chart title" value={cfg.title} onChange={(v) => set({ title: v })} placeholder="Optional title" />
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
                    <SF label="X decimals" value={cfg.xDecimals ?? ''} onChange={(v) => set({ xDecimals: v })}
                        options={[['','Auto'],['0','0'],['1','1'],['2','2'],['3','3'],['4','4']]} />
                    <SF label="Y decimals" value={cfg.yDecimals ?? ''} onChange={(v) => set({ yDecimals: v })}
                        options={[['','Auto'],['0','0'],['1','1'],['2','2'],['3','3'],['4','4']]} />
                    <div className="flex flex-col gap-2 mt-1">
                        <CB label="Sci. notation X" checked={cfg.xSci} onChange={(v) => set({ xSci: v })} />
                        <CB label="Sci. notation Y" checked={cfg.ySci} onChange={(v) => set({ ySci: v })} />
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
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Series palette</p>

                    {/* Base colour picker: Rainbow auto vs a single colour degraded dark→light */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-slate-600">Base colour:</span>
                        {BASE_COLOR_SWATCHES.map((sw) => (
                            <button
                                key={sw.label}
                                type="button"
                                title={sw.label}
                                onClick={() => set({ baseColor: sw.hex })}
                                className={`w-6 h-6 rounded-full border transition-transform hover:scale-110 ${cfg.baseColor === sw.hex ? 'ring-2 ring-offset-1 ring-slate-700' : 'border-slate-300'}`}
                                style={sw.hex ? { background: sw.hex } : { background: 'linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#8b5cf6)' }}
                            >{sw.hex ? '' : ''}</button>
                        ))}
                        <input
                            type="color"
                            value={cfg.baseColor || '#3b82f6'}
                            onChange={(e) => set({ baseColor: e.target.value })}
                            className="w-8 h-6 rounded cursor-pointer border border-slate-300 bg-white"
                            title="Pick any base colour"
                        />
                        {cfg.baseColor && (
                            <button type="button" onClick={() => set({ baseColor: null })}
                                className="text-[10px] font-bold text-slate-500 hover:text-slate-800 underline">reset</button>
                        )}
                    </div>

                    {/* Live preview of the generated colours (dark → light across the curves) */}
                    <div className="flex items-center gap-1 mb-2">
                        {(cfg.baseColor ? shadesFromColor(cfg.baseColor, series.length) : rainbowColors(series.length)).map((c, i) => (
                            <span key={i} title={`curve ${i + 1}: ${c}`}
                                className="h-4 flex-1 rounded-sm border border-slate-200"
                                style={{ background: c }} />
                        ))}
                        <span className="text-[9px] text-slate-400 ml-1 whitespace-nowrap">
                            {series.length} curve{series.length > 1 ? 's' : ''} · {cfg.baseColor ? 'dark → light' : 'rainbow'}
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {series.map((s, i) => (
                            <label key={s.key} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                                <input type="color"
                                    value={(cfg.colors && cfg.colors[s.key]) || (cfg.baseColor ? shadesFromColor(cfg.baseColor, series.length)[i] : rainbowColors(series.length)[i]) || '#3b82f6'}
                                    onChange={(e) => set({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
                                    className="w-6 h-6 rounded cursor-pointer border border-slate-300" />
                                {s.label}
                            </label>
                        ))}
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1">Pick a base colour and the curves are degraded from dark to light; the rainbow range is used when no colour is selected.</p>
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

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CHART — fully-wired recharts body that honours every field of
// SharedChartStylePanel, so the "Graphical Parameters" commands really modify
// the spectrum / chromatogram / plot they are attached to (chart type, series
// colours, error bars, axis ranges, tick steps/angle, log axes, legend,
// line/point/font styles, height, axis labels).
//
//   data           -- array of row objects
//   xKey           -- key of the x-axis column
//   series         -- [{ key, label, color? }]
//   cfg            -- style object produced by SharedChartStylePanel
//   unit           -- x-axis unit (tooltip / label placeholder)
//   margin         -- recharts chart margin (left is auto-set from yAxisWidth)
//   errorKey       -- optional key holding a per-point ± value (y error bars)
//   yFormatter / xFormatter -- (value) => string
//   referenceLines -- [{ x, color, label? }] vertical reference lines
//   yAxisWidth, height
// ─────────────────────────────────────────────────────────────────────────────
const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Evenly spaced ticks for a numeric axis when a step is requested.
const numericTicks = (min, max, step) => {
  if (!(Number.isFinite(min) && Number.isFinite(max) && min < max)) return null;
  const s = Number(step);
  if (!(Number.isFinite(s) && s > 0)) return null;
  const out = [];
  for (let v = Math.ceil(min / s) * s; v <= max + s * 0.001; v += s) {
    out.push(Math.round(v * 10000) / 10000);
  }
  return out.length > 1 ? out : null;
};

export const SharedChart = ({
  data = [],
  xKey = 'x',
  series = [],
  cfg = {},
  unit = 'a.u.',
  margin = {},
  errorKey,
  yFormatter,
  xFormatter,
  referenceLines = [],
  yAxisWidth = 54,
  height = 260
}) => {
  const safeSeries = Array.isArray(series) && series.length
    ? series
    : [{ key: 'y', label: 'Series' }];

  const chartRef = useRef(null);
  const fs = Number(cfg.fontSize) || DEFAULT_CHART_FONT_SIZE;
  const dash = cfg.lineStyle === 'dashed' ? '4 4' : cfg.lineStyle === 'dotted' ? '1 3' : undefined;
  const strokeWidth = Number(cfg.lineThickness) || 2;
  const ptSize = Number(cfg.ptSize) || 4;
  const showPoints = cfg.pointStyle && cfg.pointStyle !== 'none';
  const chartType = cfg.chartType || 'line';
  const xLog = !!cfg.xLog;
  const yLog = !!cfg.yLog;
  const tickAngle = Number(cfg.tickAngle) || 0;

  /* Log axes need strictly positive data. */
  const plotData = (xLog || yLog)
    ? data.filter((d) => {
        const x = Number(d?.[xKey]);
        if (!Number.isFinite(x) || x <= 0) return false;
        return safeSeries.every((s) => {
          const v = Number(d?.[s.key]);
          return !Number.isFinite(v) || v > 0;
        });
      })
    : data;

  /* X domain: cfg.xMin/xMax override the data range; drag-zoom applies on top. */
  const xs = plotData.map((d) => Number(d?.[xKey])).filter((v) => Number.isFinite(v));
  const dataDomain = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const cMin = numOrNull(cfg.xMin);
  const cMax = numOrNull(cfg.xMax);
  const cfgDomain = cMin !== null && cMax !== null && cMax > cMin ? [cMin, cMax] : dataDomain;
  const zoom = useXZoom(chartRef, cfgDomain, { ...margin, left: yAxisWidth });
  const xDomain = xLog
    ? [
        Math.max(1e-9, cMin !== null && cMin > 0 ? cMin : (dataDomain[0] > 0 ? dataDomain[0] : zoom.domain[0])),
        cMax !== null ? cMax : zoom.domain[1]
      ]
    : [zoom.domain[0], zoom.domain[1]];

  /* Y domain (0-based unless the user overrides; positive when log). */
  const yMin = numOrNull(cfg.yMin);
  const yMax = numOrNull(cfg.yMax);
  const yDomain = yLog
    ? [yMin !== null && yMin > 0 ? yMin : 'auto', yMax !== null ? yMax : 'auto']
    : [yMin ?? 0, yMax ?? 'auto'];

  /* Tick steps → explicit ticks on numeric axes. */
  const xStep = cfg.xTickStep ?? cfg.tickStep;
  const yStep = cfg.yTickStep;
  const xTicks = xStep ? numericTicks(xDomain[0], xDomain[1], xStep) : null;
  const yTicks = yStep && yMin !== null && yMax !== null ? numericTicks(yMin, yMax, yStep) : null;

  /* Series colours: per-series override → base-colour shades → rainbow → default. */
  const colorFor = (s, i) =>
    (cfg.colors && cfg.colors[s.key]) ||
    (cfg.baseColor ? shadesFromColor(cfg.baseColor, safeSeries.length)[i] : rainbowColors(safeSeries.length)[i]) ||
    s.color ||
    '#3b82f6';

  const errColor = cfg.errorBarColor || '#94a3b8';
  const noCaps = cfg.errorBarStyle === 'no-caps';
  const showErr = errorKey && cfg.errorBarStyle !== 'none';
  const errorBarsFor = () => (
    showErr
      ? <ErrorBar dataKey={errorKey} direction="y" stroke={errColor} strokeWidth={1.2} width={noCaps ? 0 : 4} />
      : null
  );

  const tickPropsFor = (axis) => {
    const fmt = cfgTickFormatter(cfg, axis) || undefined;
    return tickAngle
      ? <AngledTick angle={tickAngle} fontSize={fs} formatter={fmt} />
      : { fontSize: fs, fill: '#64748b' };
  };


  const makeSeries = safeSeries.map((s, i) => {
    const col = colorFor(s, i);
    const base = { dataKey: s.key, name: s.label, isAnimationActive: false };
    if (chartType === 'bar') {
      return <Bar key={s.key} {...base} fill={col} stroke={col} strokeWidth={1}>{errorBarsFor()}</Bar>;
    }
    if (chartType === 'scatter') {
      return <Scatter key={s.key} {...base} fill={col} stroke={col} fillOpacity={0.85} shape="circle">{errorBarsFor()}</Scatter>;
    }
    if (chartType === 'area') {
      return (
        <Area
          key={s.key}
          {...base}
          type="monotone"
          stroke={col}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          fill={col}
          fillOpacity={0.15}
          dot={showPoints ? { r: ptSize, fill: col, strokeWidth: 0 } : false}
        >
          {errorBarsFor()}
        </Area>
      );
    }
    return (
      <Line
        key={s.key}
        {...base}
        type="monotone"
        stroke={col}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        dot={showPoints ? { r: ptSize, fill: col, strokeWidth: 0 } : false}
      >
        {errorBarsFor()}
      </Line>
    );
  });

  const children = [
    <CartesianGrid key="grid" strokeDasharray="3 3" stroke="#e2e8f0" />,
    <XAxis
      key="x"
      type="number"
      dataKey={xKey}
      domain={xDomain}
      allowDataOverflow
      scale={xLog ? 'log' : 'auto'}
      tick={tickPropsFor('x')}
      tickFormatter={cfgTickFormatter(cfg, 'x') || undefined}
      {...(xTicks ? { ticks: xTicks } : {})}
      label={{ value: cfg.xAxisLabel || (unit ? `Value (${unit})` : 'Value'), position: 'insideBottom', offset: -18, fontSize: fs, fill: '#64748b' }}
    />,
    <YAxis
      key="y"
      domain={yDomain}
      allowDataOverflow
      scale={yLog ? 'log' : 'auto'}
      tick={tickPropsFor('y')}
      tickFormatter={cfgTickFormatter(cfg, 'y') || undefined}
      {...(yTicks ? { ticks: yTicks } : {})}
      width={yAxisWidth}
      label={cfg.yAxisLabel ? { value: cfg.yAxisLabel, angle: -90, position: 'insideLeft', offset: 0, fontSize: fs, fill: '#64748b' } : undefined}
    />,
    <Tooltip
      key="tip"
      formatter={(v, name) => [
        yFormatter ? yFormatter(v) : (Number.isFinite(Number(v)) ? Number(v).toPrecision(4) : v),
        name
      ]}
      labelFormatter={(l) => (xFormatter ? xFormatter(l) : `${l}${unit ? ' ' + unit : ''}`)}
    />,
    ...(cfg.legend && cfg.legend !== 'none'
      ? [<Legend key="legend" verticalAlign={cfg.legend} align="center" wrapperStyle={{ fontSize: fs }} />]
      : []),
    ...(zoom.refLo !== null && zoom.refHi !== null
      ? [<ReferenceArea key="za" x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />]
      : []),
    ...referenceLines.map((rl, i) => (
      <ReferenceLine
        key={`rl-${i}`}
        x={rl.x}
        stroke={rl.color || '#94a3b8'}
        strokeDasharray="4 4"
        label={rl.label
          ? { value: rl.label, position: 'insideTopRight', fontSize: 9, fill: rl.color || '#94a3b8' }
          : undefined}
      />
    )),
    ...makeSeries
  ];

  const h = useChartFsHeight(Number(cfg.height) || height);
  const resolvedMargin = { top: 8, right: 12, bottom: 34, ...margin, left: margin.left ?? yAxisWidth };

  return (
    <div className="flex flex-col gap-1">
      <div ref={chartRef} onMouseDown={zoom.onMouseDown} className="select-none" style={{ height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={plotData} margin={resolvedMargin}>{children}</BarChart>
          ) : chartType === 'scatter' ? (
            <ScatterChart data={plotData} margin={resolvedMargin}>{children}</ScatterChart>
          ) : chartType === 'area' ? (
            <AreaChart data={plotData} margin={resolvedMargin}>{children}</AreaChart>
          ) : (
            <LineChart data={plotData} margin={resolvedMargin}>{children}</LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {zoom.isZoomed && (
        <button type="button" onClick={zoom.reset} className="self-end text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>
      )}
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────
// CFG-DRIVEN CHART PIECES — translate a SharedChartStylePanel `cfg` into
// recharts props, so the "Graphical Parameters" commands REALLY act on the
// spectrum / histogram they are attached to (chart type, colours, line/point
// styles, log axes, tick steps, ranges).
// ─────────────────────────────────────────────────────────────────────────────
const cfgDash = (cfg) =>
  cfg.lineStyle === 'dashed' ? '7 5' : cfg.lineStyle === 'dotted' ? '2 3' : undefined;

/** 'log' | 'auto' axis scale from the panel's xLog / yLog checkboxes. */
export const cfgLogScale = (cfg = {}, axis = 'x') =>
  ((axis === 'x' ? !!cfg.xLog : !!cfg.yLog) ? 'log' : 'auto');

/** Explicit tick array when the panel sets a step (xTickStep/tickStep or yTickStep). */
export const cfgAxisTicks = (cfg = {}, axis = 'x', domain) =>
  numericTicks(
    Number(domain?.[0]), Number(domain?.[1]),
    axis === 'x' ? (cfg.xTickStep ?? cfg.tickStep) : cfg.yTickStep
  );

/**
 * Log-safe domain for an axis: [cfg.xMin/xMax ?? fallback]. When the matching
 * log flag is ON the low end is clamped to a small positive value (recharts
 * needs strictly positive domains for a log scale).
 */
export const cfgAxisDomain = (cfg = {}, axis = 'x', fallback = [0, 1]) => {
  const vMin = numOrNull(axis === 'x' ? cfg.xMin : cfg.yMin);
  const vMax = numOrNull(axis === 'x' ? cfg.xMax : cfg.yMax);
  let lo = vMin !== null ? vMin : fallback[0];
  let hi = vMax !== null ? vMax : fallback[1];
  const log = axis === 'x' ? !!cfg.xLog : !!cfg.yLog;
  if (log && !(Number.isFinite(hi) && hi > 0)) hi = 1;
  if (log && !(Number.isFinite(lo) && lo > 0)) lo = Math.max(1e-9, hi * 1e-3);
  return [lo, hi];
};

/** Dot config from pointStyle + ptSize (false = no points). */
const cfgDot = (cfg, stroke) => {
  if (!cfg.pointStyle || cfg.pointStyle === 'none') return false;
  const r = Number(cfg.ptSize) || 4;
  return r > 0 ? { r, fill: stroke, strokeWidth: 0 } : false;
};

/**
 * Recharts series element (Line / Area / Bar / scatter-like Line) that honours
 * every "Chart Appearance" panel command. Use inside a ComposedChart (or any
 * chart that can host the returned element).
 *   opts: { key, data, dataKey, name, stroke }
 */
export const cfgSeriesEl = (cfg = {}, opts = {}) => {
  const type = cfg.chartType || 'line';
  const strokeWidth = Number(cfg.lineThickness) || 2;
  const common = {
    key: opts.key, data: opts.data, dataKey: opts.dataKey, name: opts.name,
    stroke: opts.stroke, strokeWidth, strokeDasharray: cfgDash(cfg),
    isAnimationActive: false,
  };
  if (type === 'bar') {
    const r = Number(cfg.barRadius) || 3;
    return <Bar {...common} fill={opts.stroke} stroke="none" radius={[r, r, 0, 0]} />;
  }
  if (type === 'area') {
    return <Area {...common} type="monotone" fill={opts.stroke} fillOpacity={Number(cfg.areaOpacity ?? 0.15)} connectNulls />;
  }
  if (type === 'scatter') {
    return <Line {...common} type="monotone" strokeOpacity={0.35} dot={cfgDot(cfg, opts.stroke)} activeDot={false} connectNulls />;
  }
  return <Line {...common} type="monotone" dot={cfgDot(cfg, opts.stroke)} activeDot={false} connectNulls />;
};

/**
 * Tick label formatter for an axis from the panel's decimal / scientific
 * controls: `xDecimals` / `yDecimals` ('' = auto) and `xSci` / `ySci`.
 * Returns `null` when the user did not ask for any custom formatting, so
 * callers can fall back to their own default (or recharts' default).
 */
export const cfgTickFormatter = (cfg = {}, axis = 'x') => {
  const sci = axis === 'x' ? !!cfg.xSci : !!cfg.ySci;
  const decRaw = axis === 'x' ? cfg.xDecimals : cfg.yDecimals;
  const hasDec = decRaw !== '' && decRaw !== null && decRaw !== undefined;
  if (!sci && !hasDec) return null;
  const nDec = hasDec ? Number(decRaw) : 2;
  return (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (sci) return n.toExponential(nDec);
    return n.toFixed(nDec);
  };
};



