import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea,
  ReferenceLine, ResponsiveContainer, ErrorBar
} from 'recharts';
import {
  BASE_COLOR_SWATCHES, shadesFromColor, rainbowColors, DEFAULT_CHART_FONT_SIZE,
  normalizeChartType, seriesOverride, seriesChartType,
  seriesPointStyle, seriesPtSize, seriesLineThickness,
  seriesDash, seriesVisible, seriesLabelOf, seriesColorOf, hasSeriesOverrides,
  axisBreakOf, axisBreakFor, breakSegments, breakTicks, brokenScale,
  AXIS_BREAK_GAP_DEFAULT,
  // One character size per ELEMENT + the font family (see utils/chartStyle):
  // the axis NUMBERS are `cfg.fontSize`, the axis TITLES `cfg.axisTitleFontSize`,
  // the legend `cfg.legendFontSize`, all drawn with `cfg.fontFamily`.
  FIGURE_FONT_CHOICES, MIN_CHART_FONT, MAX_CHART_FONT,
  fontFamilyOf, axisTitleSize
} from '../utils/chartStyle';
import { Icon } from './Icons';
import { useFigureStyleSlot } from './FigureStyleTools';


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
// TICK-LABEL OFFSET  -- keeps the distance between the axis tick NUMBERS and
// the axis CONSTANT when the character size changes.
//
// Both tick renderers used to place the numbers with a hard-coded offset tuned
// for ~11 px labels (AngledTick: dy = 12 px below the tick origin; NMRSections:
// baseline = tickLength + 12 px from the axis). The baseline follows the font
// size but the TOP of the digits does not: a 24 px label is ~17 px tall, so its
// top climbed into the tick marks and, a bit further, ABOVE the axis line.
// Returning `gap + 0.72 em` (≈ the digit height of the font) makes the numbers
// grow downwards from a fixed clearance instead; `minOffset` keeps the
// historical offset for the usual sizes, so nothing moves until the label is
// big enough to need the extra room.
//
//   tickEnd   -- px from the tick origin (the `y` recharts passes to the tick)
//                down to the END of the tick mark. Negative when the origin is
//                already below the mark (tickMargin > tickSize, e.g. 10 > 6).
//   fontSize  -- font size (px) of the numbers
//   gap       -- clearance kept between the end of the tick mark and the number
//   minOffset -- historical offset (baseline, from the same origin) used as a
//                floor so small labels keep their current position
// ─────────────────────────────────────────────────────────────────────────────
export const tickLabelOffset = (tickEnd = 0, fontSize = 11, gap = 3, minOffset = 0) => {
    const fs = Number(fontSize) || 11;
    const end = Number(tickEnd) || 0;
    const floor = Number(minOffset) || 0;
    return Math.max(floor, Math.round(end + gap + fs * 0.72));
};

// ─────────────────────────────────────────────────────────────────────────────
// AXIS ROOM  -- how much space the tick NUMBERS and the axis TITLE need around
// the plot, derived from the character size (cfg.fontSize) and the tick angle.
//
// A chart is an <svg>: everything that falls outside its viewport is CLIPPED
// (this is the "the numbers / the label went out of the chart" report). The
// chart margin (cfgChartMargin) and the title offset (cfgAxisLabel) are both
// derived from the helpers below, so a bigger character size can only make the
// PLOT smaller — never push a number or a title out of the chart.
//
//   * xTickNumberExtent -- px from the x axis LINE down to the bottom of the
//     numbers, mirroring the geometry AngledTick renders with (tickSize 6 +
//     tickMargin 10, the same dy formula, plus the descender of the digits).
//   * yTickNumberBand   -- px the y numbers reach LEFT of the axis gutter.
//     recharts does not widen an axis that was given an explicit width (the
//     default is 60 px), so with a big font the numbers grow into the chart
//     margin and are cut off at the left edge of the chart.
//   * extremeTickAnchor -- the first / last number of a horizontal axis is
//     anchored INSIDE the plot area: the old centred anchor pushed the first
//     number over the y number of the origin (bottom-left corner) and the last
//     one off the right edge of the chart.
// ─────────────────────────────────────────────────────────────────────────────
export const TICK_CHARS = 6;            // a typical number: "0.0009", "-250.5"
const AVG_GLYPH_EM = 0.55;              // average digit / sign / dot width (em)
const CAP_EM = 0.72;                    // digit height (cap height) in em
const DESCENT_EM = 0.22;                // descender of the digits in em
const Y_AXIS_GUTTER = 60;               // recharts' default y-axis width

/** Width (px) reserved for a tick number of `chars` characters at `fontSize`. */
export const tickNumberWidth = (fontSize, chars = TICK_CHARS) =>
    Math.round((Number(chars) || 0) * (Number(fontSize) || 11) * AVG_GLYPH_EM);

/** Room the y-axis NUMBERS need beyond the axis gutter, in px (0 = they fit). */
export const yTickNumberBand = (fontSize, gutter = Y_AXIS_GUTTER) =>
    Math.max(0, Math.round(6 + 10 + tickNumberWidth(fontSize) - (Number(gutter) || Y_AXIS_GUTTER)));

/**
 * Offset the y-axis TITLE needs (measured from the axis gutter, which is the
 * reference recharts positions the y label against) so that it stays clear of
 * numbers that have outgrown the 60 px gutter.
 */
export const yAxisTitleOffset = (fontSize) =>
    yTickNumberBand(fontSize) + Math.round(axisTitleFontSize(fontSize) * DESCENT_EM) + 4;

/** Font size of an axis TITLE (one px above the tick numbers) and its cap height. */
export const axisTitleFontSize = (fontSize) => (Number(fontSize) || 11) + 1;
export const axisTitleCap = (fontSize) => Math.round(axisTitleFontSize(fontSize) * CAP_EM);

/** Vertical offset (dy) of a tick label; rotated labels need their own room. */
export const angledTickDy = (fontSize, angle = 0) => {
    const fs = Number(fontSize) || 11;
    if (Number(angle) || 0) return Math.max(4, Math.round(4 + Math.max(0, fs - 11) * 0.5));
    return tickLabelOffset(-4, fs, 3, 12);
};

/** px from the x axis LINE down to the bottom of the tick numbers. */
export const xTickNumberExtent = (fontSize, tickAngle = 0) => {
    const fs = Number(fontSize) || 11;
    const a = Math.abs(Number(tickAngle) || 0);
    const origin = 6 + 10;                       // tickSize + tickMargin
    if (a > 0) {
        // A rotated label reaches down by its width × sin(angle) + its digits.
        const w = tickNumberWidth(fs, 4);
        const drop = w * Math.sin((Math.min(a, 90) * Math.PI) / 180);
        return Math.round(origin + angledTickDy(fs, a) + fs * CAP_EM + drop);
    }
    return Math.round(origin + angledTickDy(fs, 0) + fs * DESCENT_EM);
};

/**
 * Offset (px, counted from the plot's bottom edge) the x-axis TITLE needs: the
 * tick numbers' band PLUS the title's own cap height, so the title sits under
 * the numbers instead of on top of them (the historical `base + 1.6/px` value
 * is kept as a floor, so small character sizes do not move).
 */
export const xAxisTitleOffset = (fontSize, tickAngle = 0, base = 25, extra = 0, gap = 0) =>
    Math.max(
        (Number(base) || 0) + (Number(extra) || 0) * 1.6,
        xTickNumberExtent(fontSize, tickAngle) + axisTitleCap(fontSize) + 4
    ) + (Number(gap) || 0);

/**
 * Text anchor of a horizontal-axis tick number. The extreme ticks are anchored
 * inside the plot area so they never spill into the neighbouring axis (the
 * x/y ORIGIN numbers used to overlap at the bottom-left corner) or off the
 * chart (the last number used to be clipped on the right).
 */
export const extremeTickAnchor = (index, visibleTicksCount, fallback = 'middle') => {
    const i = Number(index);
    const n = Number(visibleTicksCount);
    if (!Number.isFinite(i) || !Number.isFinite(n) || n < 2) return { textAnchor: fallback, dx: 0 };
    if (i <= 0) return { textAnchor: 'start', dx: 2 };
    if (i >= n - 1) return { textAnchor: 'end', dx: -2 };
    return { textAnchor: fallback, dx: 0 };
};

// ─────────────────────────────────────────────────────────────────────────────
// ANGLED TICK  -- rotated axis tick label, honours the "Tick label angle"
// setting of SharedChartStylePanel (cfg.tickAngle). Previously copy-pasted in
// CDSections / ssNMRSections / NMRSections.
//
// The x-axes that use it pass tickMargin={10} with recharts' default tickSize=6,
// so the tick marks end 6 px below the axis and the tick origin (the `y` we get)
// already sits 10 px below it — the marks therefore end 4 px ABOVE the origin:
// tickEnd = tickSize - tickMargin = -4. The old fixed dy = 12 (kept as the
// floor) starts to be too small once the digits are ~26 px tall; from there the
// offset grows with the font so the numbers never touch the axis or its marks.
//
// The first / last number of the axis is anchored inside the plot (see
// extremeTickAnchor): recharts hands every tick its `index` and the number of
// visible ticks, so the extreme ones are re-aligned instead of being centred on
// the ends of the axis — that is what used to make the x number of the origin
// collide with the y number of the origin, and the last number of the axis fall
// off the right edge of the chart once the characters grew.
//
// Pass `edgeAnchor={false}` on a BAND axis (bar charts: the categories sit in
// the middle of their band, so the extreme ticks are NOT on the plot edges)
// so those labels keep their centred position over their bar.
// ─────────────────────────────────────────────────────────────────────────────
export const AngledTick = ({ x, y, payload, angle = 0, fontSize = 11, fontFamily = '', anchor = 'middle', formatter, index, visibleTicksCount, edgeAnchor = true }) => {
    const a = Number(angle) || 0;
    // Rotated labels need a little more side room as they grow; upright ones are
    // pushed down by their own cap height (≈0.72 em) + a fixed clearance.
    const dy = angledTickDy(fontSize, a);
    // Upright numbers: the extreme ticks are pulled back INSIDE the plot so they
    // never collide with the neighbouring axis (the x/y ORIGIN numbers overlap)
    // nor run off the chart when the characters grow.
    const edge = a === 0 && edgeAnchor !== false ? extremeTickAnchor(index, visibleTicksCount, anchor) : null;
    const dx = a ? (a > 0 ? dy : -dy) : (edge ? edge.dx : 0);
    return (
        <g transform={`translate(${x || 0},${y || 0})`}>
            <text
                transform={a ? `rotate(${a})` : undefined}
                textAnchor={a < 0 ? 'end' : a > 0 ? 'start' : (edge ? edge.textAnchor : anchor)}
                dy={dy}
                dx={dx}
                fill="#64748b"
                fontSize={fontSize}
                fontFamily={fontFamily || undefined}
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

/**
 * The same delay for a LIST of cards (a hook cannot be called inside a map):
 *   onClick={deferredClick(timerRef, () => setFsSmall(s.key))}
 * where `timerRef` is one shared useRef in the component.
 */
export const deferredClick = (timerRef, fn, delay = 260) => (e) => {
    if (e && e.detail > 1) {
        // Second click of a double click: cancel the pending single click.
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        return;
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; return; }
    timerRef.current = setTimeout(() => { timerRef.current = null; fn(); }, delay);
};

/**
 * A chart card that zooms to fullscreen on a SINGLE click AND is edited by a
 * DOUBLE click cannot use a plain onClick: both clicks of the double click would
 * run it (the second one landing on the fullscreen copy the first one opened).
 * This delays the single click just long enough for a double click to cancel it,
 * so both gestures work on the small charts too.
 */
export const useDeferredClick = (onClick, delay = 260) => {
    const timer = useRef(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    return deferredClick(timer, onClick, delay);
};

/**
 * The style object / setter behind a `🎨` panel element. A page writes
 *   cfgPanel={<SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={s} />}
 * (or a fragment holding it, sometimes with extra controls) and ChartPanel reads
 * the props straight out of that element, so the double-click editor ALWAYS
 * edits the same object as the panel — even when the chart sits deep inside a
 * sub-section and nobody remembered to pass cfg / setCfg again.
 */
const stylePanelCfg = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === SharedChartStylePanel) return node.props || null;
    const kids = node.props ? node.props.children : null;
    if (!kids) return null;
    const list = Array.isArray(kids) ? kids : [kids];
    for (let i = 0; i < list.length; i++) {
        const found = stylePanelCfg(list[i]);
        if (found) return found;
    }
    return null;
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
    // Double-click editing: pass the SAME style object / setter as the
    // "🎨 Graphical Parameters" panel and every element of the chart body
    // becomes editable in place (axis, labels, curves…).
    cfg = null,
    setCfg = null,
    series = [],
    unit
}) => {
    const [showErr, setShowErr] = useState(defaultOpenErr);
    const [showCfg, setShowCfg] = useState(defaultOpenCfg);
    const [isFs, setIsFs] = useState(defaultFs);
    const toggleFs = () => setIsFs((v) => !v);

    // The chart body is edited with the VERY object the 🎨 panel writes, read
    // straight from the panel element — so any chart that HAS a style panel is
    // double-click-editable without repeating cfg / setCfg at the call site
    // (this is what makes the gesture work in the nested sub-sections too).
    const panelStyle = stylePanelCfg(cfgPanel);
    cfg = cfg ?? (panelStyle && panelStyle.cfg) ?? null;
    setCfg = setCfg ?? (panelStyle && panelStyle.setCfg) ?? null;
    series = series && series.length ? series : (panelStyle && panelStyle.series) || [];
    unit = unit ?? (panelStyle ? panelStyle.unit : undefined);

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
                <ChartInspector cfg={cfg} setCfg={setCfg} series={series} unit={unit} className={`flex-1 min-h-0 ${bodyClassName}`}>
                    {children}
                </ChartInspector>
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
// A character size typed in the style panel: '' clears it (→ “auto”, i.e. it
// follows the axis numbers), a number is clamped to the readable range of the
// shared figure style (up to 96 px — 36 / 40 for a poster figure).
const chartFontValue = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    return Math.max(MIN_CHART_FONT, Math.min(MAX_CHART_FONT, Math.round(n)));
};

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

// ─────────────────────────────────────────────────────────────────────────────
// INTENSITY SCALE — quick vertical-amplification buttons shared by the NMR /
// ssNMR / CD spectra plots. The stored `intensity` (default 1) divides the
// Y-axis domain, so ×2 makes the peaks twice as tall (zooming into the
// intensity axis), exactly like a spectrometer "absolute intensity" knob.
// ─────────────────────────────────────────────────────────────────────────────
export const IntensityControl = ({ value = 1, onChange, className = '' }) => {
  const v = Number(value) > 0 ? Number(value) : 1;
  const set = (next) => onChange(Math.max(0.25, Math.min(16, next)));
  return (
    <span
      className={`inline-flex items-center gap-0.5 border border-slate-300 rounded-lg bg-white shadow-sm ${className}`}
      title="Scale the spectra intensity up/down (vertical zoom of the intensity axis)"
    >
      <button
        type="button"
        onClick={() => set(v / 2)}
        className="px-1.5 py-1 text-sm font-black text-slate-600 hover:text-blue-600 rounded-l-md"
        title="Scale intensity down (÷2)"
      >−</button>
      <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap px-0.5">
        📈 ×{v}
      </span>
      <button
        type="button"
        onClick={() => set(v * 2)}
        className="px-1.5 py-1 text-sm font-black text-slate-600 hover:text-blue-600"
        title="Scale intensity up (×2)"
      >+</button>
      <button
        type="button"
        onClick={() => onChange(1)}
        className="px-1 py-1 text-[10px] text-slate-400 hover:text-red-500 rounded-r-md"
        title="Reset intensity (×1)"
      >⟲</button>
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTIONS OF THE STYLE PANEL — the same controls, addressable one at a time.
//
// The double-click editor (ChartInspector) opens the section that matches what
// the user double-clicked ("x" / "y" / "label" / "series"), while the
// "🎨 Graphical Parameters" button keeps opening the full panel. Every helper
// below returns the very markup the full panel used, so the focused views and
// the full panel can never drift apart.
// ─────────────────────────────────────────────────────────────────────────────
const chartStyleCharacterBlock = (cfg, set, showHeightSlider) => (
    <div>
        <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Character sizes (one per element), font &amp; chart box</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <NF label="Axis numbers (px)" value={cfg.fontSize ?? 12} onChange={(v) => set({ fontSize: v || 12 })} />
            <NF label="Axis titles (px)" value={cfg.axisTitleFontSize ?? ''} placeholder="auto (+1)"
                onChange={(v) => set({ axisTitleFontSize: chartFontValue(v) })} />
            <NF label="Legend (px)" value={cfg.legendFontSize ?? ''} placeholder="auto"
                onChange={(v) => set({ legendFontSize: chartFontValue(v) })} />
            <SF label="Font family" value={fontFamilyOf(cfg)} onChange={(v) => set({ fontFamily: v })}
                options={[['', 'App default (Inter)'], ...FIGURE_FONT_CHOICES.filter((f) => f.value).map((f) => [f.value, f.label])]} />
            <NF label="Aspect ratio W/H" step={0.1} value={cfg.aspect ?? 1.8} onChange={(v) => set({ aspect: v || 1.8 })} />
            {showHeightSlider && (
                <div className="flex flex-col gap-1 lg:col-span-2">
                    <label className="text-[10px] font-bold text-slate-600">Chart height (px) -- {cfg.height || 380}</label>
                    <input type="range" min="150" max="1000" step="10" value={cfg.height || 380}
                        onChange={(e) => set({ height: parseInt(e.target.value) })}
                        className="accent-blue-600 mt-2" />
                </div>
            )}
        </div>
        <p className="text-[9px] text-slate-400 mt-1">
            Each element keeps its OWN character size: the axis <b>numbers</b>, the axis <b>titles</b> and the
            <b> legend</b>. “auto” follows the axis numbers (titles one px bigger). The <b>font family</b> is applied to
            all of them — and to the Chart.js figures too. Up to {MAX_CHART_FONT} px for a poster.
        </p>
    </div>
);
/** Axis ranges + titles. `section` ('all' | 'x' | 'y') picks the columns shown. */
const chartStyleRangeBlock = (cfg, set, unit, section) => {
    const cells = {
        xRange: (
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
                <div className="flex gap-1">
                    <input type="number" placeholder="auto" value={cfg.xMin ?? ''} onChange={(e) => set({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" placeholder="auto" value={cfg.xMax ?? ''} onChange={(e) => set({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                </div>
            </div>
        ),
        yRange: (
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
                <div className="flex gap-1">
                    <input type="number" placeholder="auto" value={cfg.yMin ?? ''} onChange={(e) => set({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" placeholder="auto" value={cfg.yMax ?? ''} onChange={(e) => set({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                </div>
            </div>
        ),
        xLabel: <TF label="X axis label" value={cfg.xAxisLabel} onChange={(v) => set({ xAxisLabel: v })} placeholder={`e.g. ${unit}`} />,
        yLabel: <TF label="Y axis label" value={cfg.yAxisLabel} onChange={(v) => set({ yAxisLabel: v })} placeholder="e.g. Intensity (a.u.)" />,
        xGap: <NF label="X label gap (px)" value={cfg.xAxisLabelGap ?? ''} onChange={(v) => set({ xAxisLabelGap: v })} placeholder="0" />,
        yGap: <NF label="Y label gap (px)" value={cfg.yAxisLabelGap ?? ''} onChange={(v) => set({ yAxisLabelGap: v })} placeholder="0" />,
        /* Slide the title ALONG its own axis (the gap only pushes it AWAY from
           the plot): the manual way to park a long, rotated y title back inside
           the graph when the characters are big. */
        xMove: <NF label="X label move (px) — + right / − left" value={cfg.xAxisLabelMove ?? ''} onChange={(v) => set({ xAxisLabelMove: v })} placeholder="0" />,
        yMove: <NF label="Y label move (px) — + down / − up" value={cfg.yAxisLabelMove ?? ''} onChange={(v) => set({ yAxisLabelMove: v })} placeholder="0" />,
        xStyle: (
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-600">X label style</label>
                <div className="flex items-center gap-3 h-[30px]">
                    <CB label="Bold" checked={cfg.xAxisLabelBold} onChange={(v) => set({ xAxisLabelBold: v })} />
                    <CB label="Italic" checked={cfg.xAxisLabelItalic} onChange={(v) => set({ xAxisLabelItalic: v })} />
                </div>
            </div>
        ),
        yStyle: (
            <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-600">Y label style</label>
                <div className="flex items-center gap-3 h-[30px]">
                    <CB label="Bold" checked={cfg.yAxisLabelBold} onChange={(v) => set({ yAxisLabelBold: v })} />
                    <CB label="Italic" checked={cfg.yAxisLabelItalic} onChange={(v) => set({ yAxisLabelItalic: v })} />
                </div>
            </div>
        )
    };
    const keys = section === 'x' ? ['xRange', 'xLabel', 'xGap', 'xMove', 'xStyle']
        : section === 'y' ? ['yRange', 'yLabel', 'yGap', 'yMove', 'yStyle']
            : section === 'label' ? ['xLabel', 'yLabel', 'xGap', 'xMove', 'yGap', 'yMove', 'xStyle', 'yStyle']
                : ['xRange', 'yRange', 'xLabel', 'yLabel', 'xGap', 'xMove', 'yGap', 'yMove', 'xStyle', 'yStyle'];
    const heading = section === 'x' ? 'X axis — range, label, title'
        : section === 'y' ? 'Y axis — range, label, title'
            : section === 'label' ? 'Axis titles'
                : 'Axis Ranges & Labels';
    return (
        <div>
            <p className="text-[10px] font-black text-slate-400 uppercase mb-2">{heading}</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {keys.map((k) => <React.Fragment key={k}>{cells[k]}</React.Fragment>)}
            </div>
            {/* The rotated y title is anchored on the MIDDLE of the plot and the
                characters run upwards: a long title at a big character size
                leaves the chart at the TOP, where no margin can follow it (the
                room it needs is vertical, i.e. its own length). The "move"
                command slides it along the axis and brings it back inside. */}
            {section !== 'x' && (
                <p className="text-[9px] text-slate-400 mt-2">
                    The Y title is rotated and grows upwards from the middle of the plot: a long title at a big character size leaves the graph at the top. Set a positive “Y label move” to slide it back down — the “gap” only pushes it away from the plot. (The canvas plots — Plate IC50 / dose-response, DOSY, NMR fittings — grow their canvas to fit the title instead.)
                </p>
            )}
        </div>
    );
};



/** Tick settings. `section` ('all' | 'x' | 'y') picks the columns shown. */
const chartStyleTickBlock = (cfg, set, section) => {
    const cells = {
        xStep: <TF label="X tick interval (num spacing / cat every N)" value={cfg.xTickStep ?? cfg.tickStep ?? ''} onChange={(v) => set({ xTickStep: v, tickStep: v })} placeholder="auto" />,
        yStep: <TF label="Y tick interval" value={cfg.yTickStep ?? ''} onChange={(v) => set({ yTickStep: v })} placeholder="auto" />,
        angle: <SF label="Tick label angle" value={String(cfg.tickAngle ?? 0)} onChange={(v) => set({ tickAngle: Number(v) })}
            options={[['0', '0 deg (horizontal)'], ['-30', '-30 deg'], ['-45', '-45 deg'], ['-60', '-60 deg'], ['-90', '-90 deg (vertical)'], ['30', '30 deg'], ['45', '45 deg'], ['90', '90 deg']]} />,
        logs: (
            <div className="flex flex-col gap-2 mt-1">
                <CB label="Log X axis" checked={cfg.xLog} onChange={(v) => set({ xLog: v })} />
                <CB label="Log Y axis" checked={cfg.yLog} onChange={(v) => set({ yLog: v })} />
            </div>
        ),
        xDec: <SF label="X decimals" value={cfg.xDecimals ?? ''} onChange={(v) => set({ xDecimals: v })}
            options={[['', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} />,
        yDec: <SF label="Y decimals" value={cfg.yDecimals ?? ''} onChange={(v) => set({ yDecimals: v })}
            options={[['', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} />,
        scis: (
            <div className="flex flex-col gap-2 mt-1">
                <CB label="Sci. notation X" checked={cfg.xSci} onChange={(v) => set({ xSci: v })} />
                <CB label="Sci. notation Y" checked={cfg.ySci} onChange={(v) => set({ ySci: v })} />
            </div>
        ),
        /* The interrupted axis: one tick is enough — when the two numbers are
           left empty the break is placed automatically on the biggest gap. */
        yBreak: (
            <div className="flex flex-col gap-1 lg:col-span-2">
                <CB label="✂ Interrupt Y axis — huge bar vs small bars" checked={!!cfg.yBreak} onChange={(v) => set({ yBreak: v })} />
                <div className="flex items-center gap-1">
                    <input type="number" placeholder="from (auto)" value={cfg.yBreakFrom ?? ''} onChange={(e) => set({ yBreakFrom: e.target.value })}
                        title="Y value where the interruption starts = the top of the SMALL bars. Empty = detected automatically."
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" placeholder="to (auto)" value={cfg.yBreakTo ?? ''} onChange={(e) => set({ yBreakTo: e.target.value })}
                        title="Y value where the interruption stops = the bottom of the HUGE bars. Empty = detected automatically."
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" min="1" max="40" placeholder={`${AXIS_BREAK_GAP_DEFAULT}`} value={cfg.yBreakGap ?? ''} onChange={(e) => set({ yBreakGap: e.target.value })}
                        title="Height of the interrupted band, in % of the axis"
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-16 outline-none bg-white" />
                </div>
                <p className="text-[9px] text-slate-400">
                    e.g. from 50 to 950: the 50→950 emptiness is squeezed into a small band (marked ✂ on the axis) so the small
                    bars and the huge one are both readable. Leave both numbers empty to let the graph find the gap itself.
                </p>
            </div>
        ),
        xBreak: (
            <div className="flex flex-col gap-1 lg:col-span-2">
                <CB label="✂ Interrupt X axis" checked={!!cfg.xBreak} onChange={(v) => set({ xBreak: v })} />
                <div className="flex items-center gap-1">
                    <input type="number" placeholder="from (auto)" value={cfg.xBreakFrom ?? ''} onChange={(e) => set({ xBreakFrom: e.target.value })}
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" placeholder="to (auto)" value={cfg.xBreakTo ?? ''} onChange={(e) => set({ xBreakTo: e.target.value })}
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none bg-white" />
                    <input type="number" min="1" max="40" placeholder={`${AXIS_BREAK_GAP_DEFAULT}`} value={cfg.xBreakGap ?? ''} onChange={(e) => set({ xBreakGap: e.target.value })}
                        className="border border-slate-300 rounded-md p-1.5 text-xs w-16 outline-none bg-white" />
                </div>
            </div>
        )
    };
    const keys = section === 'x' ? ['xStep', 'angle', 'xDec', 'scis', 'logs', 'xBreak']
        : section === 'y' ? ['yStep', 'angle', 'yDec', 'scis', 'logs', 'yBreak']
            : section === 'label' ? ['xDec', 'yDec', 'scis', 'logs', 'angle', 'xStep', 'yStep', 'xBreak', 'yBreak']
                : ['xStep', 'yStep', 'angle', 'logs', 'xDec', 'yDec', 'scis', 'xBreak', 'yBreak'];
    return (
        <div>
            <p className="text-[10px] font-black text-slate-400 uppercase mb-2">
                {section === 'x' ? 'X ticks' : section === 'y' ? 'Y ticks' : section === 'label' ? 'Ticks, numbers & scales' : 'Tick Settings'}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {keys.map((k) => <React.Fragment key={k}>{cells[k]}</React.Fragment>)}
            </div>
        </div>
    );
};

/**
 * PER-CURVE SETTINGS — the answer to "the style is applied to every curve and I
 * cannot tell them apart". One row per series, writing `cfg.seriesStyles[key]`:
 * colour, chart type, symbol, symbol size, line style, line width and a
 * show / hide switch. An empty field means "auto", i.e. the chart-wide value of
 * "Chart Appearance" above is used, so a chart that never touches this block
 * behaves exactly as before.
 */
export const chartStyleSeriesBlock = (cfg, set, series = [], highlightKey = null) => {
    if (!series.length) return null;
    const all = cfg.seriesStyles || {};
    const write = (key, patch) => {
        const next = { ...(all[key] || {}), ...patch };
        Object.keys(next).forEach((k) => {
            const v = next[k];
            if (v === '' || v === null || v === undefined || v === false) delete next[k];
        });
        const map = { ...all };
        if (Object.keys(next).length) map[key] = next; else delete map[key];
        set({ seriesStyles: map });
    };
    const clear = (key) => {
        const map = { ...all };
        delete map[key];
        set({ seriesStyles: map });
    };
    const sel = 'border border-slate-300 rounded-md px-1 py-0.5 text-[10px] bg-white outline-none focus:border-blue-500';
    return (
        <div className="pt-2 border-t border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Per-curve settings — one style for each curve</p>
            <div className="flex flex-col gap-1.5">
                {series.map((s, i) => {
                    const st = all[s.key] || {};
                    const hit = highlightKey === s.key;
                    return (
                        <div key={s.key}
                            className={`flex flex-wrap items-center gap-1.5 border rounded-lg px-2 py-1.5 ${hit ? 'border-amber-400 ring-2 ring-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                            <span className="text-[10px] font-black text-slate-700 w-20 truncate" title={String(s.label || s.key)}>{s.label || s.key}</span>
                            <input type="color" title="Colour of this curve"
                                value={seriesColorOf(cfg, s.key, i, series.length, s.color || '#3b82f6')}
                                onChange={(e) => set({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
                                className="w-6 h-6 rounded cursor-pointer border border-slate-300" />
                            <select className={sel} title="Type of THIS curve" value={st.chartType || ''}
                                onChange={(e) => write(s.key, { chartType: e.target.value })}>
                                <option value="">Type: auto</option>
                                <option value="line">Line</option>
                                <option value="bar">Bar / Histogram</option>
                                <option value="scatter">Scatter (points)</option>
                                <option value="area">Area</option>
                            </select>
                            <select className={sel} title="Symbol of THIS curve" value={st.pointStyle || ''}
                                onChange={(e) => write(s.key, { pointStyle: e.target.value })}>
                                <option value="">Symbol: auto</option>
                                <option value="circle">Circle</option>
                                <option value="square">Square</option>
                                <option value="triangle">Triangle</option>
                                <option value="cross">Cross</option>
                                <option value="diamond">Diamond</option>
                                <option value="star">Star</option>
                                <option value="none">None</option>
                            </select>
                            <input type="number" min="0" max="40" step="1" placeholder="size" title="Symbol size of this curve (blank = chart-wide)"
                                value={st.ptSize ?? ''} onChange={(e) => write(s.key, { ptSize: e.target.value })}
                                className="w-14 border border-slate-300 rounded-md px-1 py-0.5 text-[10px] bg-white outline-none" />
                            <select className={sel} title="Line style of THIS curve" value={st.lineStyle || ''}
                                onChange={(e) => write(s.key, { lineStyle: e.target.value })}>
                                <option value="">Line: auto</option>
                                <option value="solid">Solid</option>
                                <option value="dashed">Dashed</option>
                                <option value="dotted">Dotted</option>
                            </select>
                            <input type="number" min="0" max="20" step="0.5" placeholder="width" title="Line thickness of this curve (blank = chart-wide)"
                                value={st.lineThickness ?? ''} onChange={(e) => write(s.key, { lineThickness: e.target.value })}
                                className="w-14 border border-slate-300 rounded-md px-1 py-0.5 text-[10px] bg-white outline-none" />
                            <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600" title="Show / hide this curve">
                                <input type="checkbox" checked={!st.hidden} onChange={(e) => write(s.key, { hidden: !e.target.checked })}
                                    className="w-3.5 h-3.5 accent-blue-600" />show
                            </label>
                            <button type="button" onClick={() => clear(s.key)}
                                className="text-[10px] font-bold text-slate-400 hover:text-red-600 px-1" title="Back to automatic (chart-wide) style for this curve">⟲</button>
                        </div>
                    );
                })}
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
                “auto” = the chart-wide setting of “Chart Appearance” above. Set a value here to give ONE curve its own
                symbol / line / colour / type, so several curves in the same graph never look alike.
            </p>
        </div>
    );
};

export const SharedChartStylePanel = ({ cfg = {}, setCfg, series = [], unit = 'a.u.', showHeightSlider = true, section = 'all', highlightKey = null }) => {
    const set = (patch) => setCfg({ ...patch });
    const show = (name) => section === 'all' || section === name;
    // Which columns the range block shows: 'x' | 'y' | 'label' | 'all'.
    // The series section does not show axis ranges at all.
    const rangeSection = section === 'series' ? null : section;
    return (
        <div className="p-4 bg-white border border-slate-300 rounded-xl flex flex-col gap-4 shadow-sm">

            {/* Chart Appearance */}
            {show('series') && (
            <div>
                <p className="text-[10px] font-black text-slate-400 uppercase mb-2">Chart Appearance</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <TF label="Chart title" value={cfg.title} onChange={(v) => set({ title: v })} placeholder="Optional title" />
                    <SF label="Chart type" value={normalizeChartType(cfg.chartType)} onChange={(v) => set({ chartType: v })}
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
                    <NF label="Axis numbers (px)" value={cfg.fontSize ?? 12} onChange={(v) => set({ fontSize: v || 12 })} />
                </div>
            </div>
            )}

            {/* Character size — the same command as "Font size (px)", first, in
                the focused views (a double-click on a label is usually about
                making the characters fit). */}
            {section !== 'all' && section !== 'series' && chartStyleCharacterBlock(cfg, set, showHeightSlider)}

            {/* Axis Ranges & Labels — X / Y / both, depending on the section */}
            {rangeSection && chartStyleRangeBlock(cfg, set, unit, rangeSection)}

            {/* Tick Settings */}
            {(show('x') || show('y')) && chartStyleTickBlock(cfg, set, section)}

            {/* …and the same commands are reachable from an axis TITLE: double-
                clicking "Intensity (a.u.)" usually also means "and show me the
                numbers / decimals / scientific notation / log scale". */}
            {section === 'label' && chartStyleTickBlock(cfg, set, 'label')}

            {/* Layout (chart-level commands: the full panel and the curves) */}
            {show('series') && (
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
            )}

            {/* Series colours */}
            {series.length > 0 && show('series') && (
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
                            <label key={s.key} className={`flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 border rounded-lg px-2 py-1 ${highlightKey === s.key ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'}`}>
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

            {/* Per-curve overrides — each curve its own type / symbol / line /
                colour, so several curves in one graph can be told apart. */}
            {show('series') && chartStyleSeriesBlock(cfg, set, series, highlightKey)}

            {section === 'all' && (
                <p className="text-[9px] text-slate-400">Drag with the mouse over any graph to zoom. Use Reset Zoom to restore. Tip: double-click an axis, a label or a curve to edit exactly that element.</p>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLE-CLICK EDITING OF A CHART ELEMENT
//
// The users' gesture: double-click WHAT they want to change — the axis (min /
// max, tick interval, numbers size), the axis title (text, character size,
// style), a curve / the bars / the points (line ↔ histogram, thickness,
// symbols, colour). The classification below looks at the recharts node under
// the pointer (it is the SVG element the browser hit-tests, so it always
// matches what was really clicked), and the dialog then shows only the block of
// SharedChartStylePanel that applies — the very same commands as the full
// "🎨 Graphical Parameters" panel.
// ─────────────────────────────────────────────────────────────────────────────

/** Which style-panel section matches a double-clicked chart element. */
export const classifyChartElement = (el) => {
    if (!el || typeof el.closest !== 'function') return null;
    const legend = el.closest('.recharts-legend-wrapper, .recharts-legend-item');
    if (legend) {
        return { kind: 'legend', section: 'series', axis: null, label: String(legend.textContent || '').trim() };
    }
    const axisY = el.closest('.recharts-yAxis');
    const axisX = el.closest('.recharts-xAxis');
    const label = el.closest('.recharts-label, .recharts-label-list');
    if (label) {
        // A rotated (-90°) title is the Y one; anything else is the X title.
        const t = String(label.getAttribute && label.getAttribute('transform') || '');
        const axis = (axisY || t.includes('-90')) ? 'y' : 'x';
        return { kind: `${axis}Label`, section: 'label', axis, label: String(label.textContent || '').trim() };
    }
    if (axisY) return { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
    if (axisX) return { kind: 'xAxis', section: 'x', axis: 'x', label: '' };
    const seriesEl = el.closest('.recharts-line, .recharts-bar, .recharts-area, .recharts-scatter, .recharts-radar, .recharts-pie');
    if (seriesEl) {
        const name = seriesEl.getAttribute('name') || '';
        return { kind: 'series', section: 'series', axis: null, label: name };
    }
    return null;
};

/**
 * The FALLBACK of the classifier: recharts elements only cover the curves, the
 * bars, the axes and the legend, so a double-click on the plot background, on a
 * grid line or on the surface itself used to do nothing at all — which is what
 * made the gesture feel unreliable ("I cannot find the right position").
 *
 * This looks at WHERE the double-click landed inside the chart box:
 *   left of the plot  → the Y axis (or its title, further left)
 *   below the plot    → the X axis (or its title, lower down)
 *   inside the plot   → the whole style panel (curves + everything)
 * Returns null when the root is not a recharts chart.
 */
export const chartElementAtPoint = (root, evt) => {
    if (!root || !evt || typeof root.querySelector !== 'function') return null;
    const wrapper = root.closest && root.closest('.recharts-wrapper')
        ? root.closest('.recharts-wrapper')
        : root.querySelector('.recharts-wrapper');
    if (!wrapper || typeof wrapper.getBoundingClientRect !== 'function') return null;
    const box = wrapper.getBoundingClientRect();
    const cx = Number(evt.clientX);
    const cy = Number(evt.clientY);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const rectOf = (sel) => {
        const n = wrapper.querySelector(sel);
        return n && typeof n.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null;
    };
    const grid = rectOf('.recharts-cartesian-grid');
    const yAxis = rectOf('.recharts-yAxis');
    const xAxis = rectOf('.recharts-xAxis');
    const left = yAxis ? yAxis.right - box.left : grid ? grid.left - box.left : 0;
    const bottom = xAxis ? xAxis.top - box.top : grid ? grid.bottom - box.top : box.height;
    const px = cx - box.left;
    const py = cy - box.top;
    // Far enough from the numbers to be the title itself (the panel then opens
    // on the label commands, ticks included).
    if (py > bottom) {
        return py > bottom + 26
            ? { kind: 'xLabel', section: 'label', axis: 'x', label: '' }
            : { kind: 'xAxis', section: 'x', axis: 'x', label: '' };
    }
    if (px < left) {
        return px < left - 26
            ? { kind: 'yLabel', section: 'label', axis: 'y', label: '' }
            : { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
    }
    // Somewhere over the plot: the user wants "everything", not nothing.
    return { kind: 'plot', section: 'all', axis: null, label: '' };
};

export const CHART_ELEMENT_TITLES = {
    xAxis: 'X axis — min / max, ticks, number of decimals, log scale',
    yAxis: 'Y axis — min / max, ticks, number of decimals, log scale',
    xLabel: 'X axis title — text, size, ticks, decimals, log scale',
    yLabel: 'Y axis title — text, size, ticks, decimals, log scale',
    label: 'Axis title — text, size, ticks, decimals, log scale',
    plot: 'Chart — every setting (axes, ticks, log, interrupt, curves)',
    series: 'Curves / bars / points — type, thickness, symbols, colour',
    legend: 'Series colours'
};

/**
 * The floating editor opened by a double-click on a chart element. It renders
 * the matching section of the standard style panel, so every command behaves
 * exactly as in "🎨 Graphical Parameters".
 */
export const ChartElementDialog = ({ target, cfg, setCfg, series = [], unit, onClose }) => {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    if (!target) return null;
    const matched = target.label
        ? series.find((s) => String(s.label) === target.label || String(s.key) === target.label)
        : null;
    return createPortal(
        <div
            className="fixed inset-0 z-[9999999] bg-slate-900/10 flex items-start justify-center overflow-auto p-4 pointer-events-none"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl my-8 pointer-events-auto" onDoubleClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">
                    <span className="text-lg">🖱️</span>
                    <h4 className="font-black text-slate-800">
                        {CHART_ELEMENT_TITLES[target.kind] || 'Chart element'}
                    </h4>
                    {target.label ? <span className="text-xs text-slate-500 truncate">“{target.label}”</span> : null}
                    <span className="ml-auto hidden sm:block text-[10px] text-slate-400">Double-click another element to switch · Esc closes</span>
                    <button type="button" onClick={onClose} className="ml-2 text-slate-400 hover:text-red-600 font-black" title="Close">✕</button>
                </div>
                <div className="max-h-[72vh] overflow-y-auto custom-scrollbar">
                    <SharedChartStylePanel
                        cfg={cfg}
                        setCfg={setCfg}
                        series={series}
                        unit={unit}
                        section={target.section}
                        highlightKey={matched ? matched.key : null}
                    />
                </div>
            </div>
        </div>,
        document.body
    );
};


/**
 * Wrap ANY chart body with this to get double-click editing.
 *
 *   <ChartInspector cfg={cfg} setCfg={setCfg} series={series} unit="nm">
 *     <ResponsiveContainer>…</ResponsiveContainer>
 *   </ChartInspector>
 *
 * It adds ONE handler and renders the dialog; when `cfg` / `setCfg` are not
 * available (a chart without style settings) the children are rendered as they
 * are, so it can be dropped in anywhere without changing the layout.
 */
export const ChartInspector = ({
    cfg, setCfg, series = [], unit,
    children, className = '', style, containerRef = null, containerProps = null,
    title = 'Double-click a curve, an axis or a label to edit it'
}) => {
    const [target, setTarget] = useState(null);
    const editable = !!cfg && typeof setCfg === 'function';
    // Registers this chart in the global "Figure style" registry: the 🎨 button
    // of the experiment page can then push the shared character sizes into it
    // (through the very same setter the panel uses).
    useFigureStyleSlot(cfg, setCfg);
    const handle = (e) => {
        // 1) the recharts element under the pointer (it is what the browser
        //    hit-tests, so it always matches what was really double-clicked),
        // 2) otherwise WHERE the pointer is (plot background, grid line, the
        //    margin around the plot) — a double-click is never lost.
        const t = classifyChartElement(e.target) || chartElementAtPoint(e.currentTarget, e);
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        setTarget(t);
    };
    return (
        <div
            ref={containerRef}
            className={className}
            style={style}
            onDoubleClick={editable ? handle : undefined}
            title={title}
            {...(containerProps || {})}
        >
            {children}
            {editable && target && (
                <ChartElementDialog
                    target={target}
                    cfg={cfg}
                    setCfg={setCfg}
                    series={series}
                    unit={unit}
                    onClose={() => setTarget(null)}
                />
            )}
        </div>
    );
};

/**
 * Chart.js canvases (Plate dose-response / IC50, DOSY, NMR fittings…) are not
 * made of DOM elements, so the element under the pointer is found from the
 * chart geometry: outside the plot area = the axis that side belongs to
 * (below = X, left = Y), inside = the nearest dataset (curves / bars / points).
 */
export const chartJsTargetAt = (chart, evt) => {
    if (!chart || !evt) return null;
    const area = chart.chartArea || {};
    const x = Number(evt.offsetX) || 0;
    const y = Number(evt.offsetY) || 0;
    const left = Number(area.left) || 0;
    const right = Number(area.right) || 0;
    const top = Number(area.top) || 0;
    const bottom = Number(area.bottom) || 0;
    if (!(x >= left && x <= right && y >= top && y <= bottom)) {
        return y > bottom
            ? { kind: 'xAxis', section: 'x', axis: 'x', label: '' }
            : { kind: 'yAxis', section: 'y', axis: 'y', label: '' };
    }
    let hit = null;
    try {
        hit = (chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true) || [])[0] || null;
    } catch { hit = null; }
    const datasets = (chart.data && chart.data.datasets) || [];
    const ds = hit ? datasets[hit.datasetIndex] : null;
    return { kind: 'series', section: 'series', axis: null, label: ds ? String(ds.label || '') : '' };
};

/**
 * ChartInspector for a Chart.js canvas (pass the ref holding the instance).
 * It renders the canvas' sizing box, so it can replace that div without
 * changing the box Chart.js measures (responsive sizing stays identical).
 */
export const ChartJsInspector = ({ chartRef, cfg, setCfg, series = [], unit, children, className = '', style = null }) => {
    const [target, setTarget] = useState(null);
    const editable = !!cfg && typeof setCfg === 'function';
    // Same registry as ChartInspector: Chart.js canvases (Plate, DOSY, fittings…)
    // are styled by the page-level 🎨 button too.
    useFigureStyleSlot(cfg, setCfg);
    const handle = (e) => {
        const t = chartJsTargetAt(chartRef && chartRef.current, e.nativeEvent || e);
        if (!t) return;
        setTarget(t);
    };
    return (
        <div className={className} style={style} onDoubleClick={editable ? handle : undefined}
            title="Double-click the plot, an axis or a legend entry to edit it">
            {children}
            {editable && target && (
                <ChartElementDialog
                    target={target}
                    cfg={cfg}
                    setCfg={setCfg}
                    series={series}
                    unit={unit}
                    onClose={() => setTarget(null)}
                />
            )}
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
  // The window listeners below are registered only once, so they would capture
  // the margins of the first render; reading them from a ref keeps the drag math
  // pixel-accurate when the panel changes the font size / axis-title gap.
  const marginRef = useRef(margin);
  marginRef.current = margin;

  const getX = (clientX) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const m = marginRef.current;
    const plotW = rect.width - m.left - m.right;
    if (plotW <= 0) return null;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - m.left) / plotW));
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
  // Live margins for the once-registered window listeners (see useXZoom).
  const marginRef = useRef(margin);
  marginRef.current = margin;

  const getY = (clientY) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const m = marginRef.current;
    const plotH = rect.height - m.top - m.bottom;
    if (plotH <= 0) return null;
    const fy = Math.min(1, Math.max(0, (clientY - rect.top - m.top) / plotH));
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
// useXYZoom — combined X + Y drag-to-zoom with automatic axis detection.
// The first few pixels of the drag decide the axis: horizontal movement zooms
// the X axis, vertical movement zooms the Y axis (so spectra can be zoomed in
// on BOTH ppm/kHz AND intensity with the mouse, like the old X-only zoom).
// Returns:
//   xDomain / yDomain — the current effective domains (fall back to the given
//                       data domains when nothing has been zoomed yet)
//   ref             — the live { axis, x1, x2 | y1, y2 } rect while dragging
//   onMouseDown     — attach to the chart container
//   isZoomed, reset — "Reset Zoom" button support (clears both axes)
// ─────────────────────────────────────────────────────────────────────────────
export const useXYZoom = (chartRef, xDataDomain, yDataDomain, margin = { top: 20, right: 20, bottom: 45, left: 50 }) => {
  const [xDomain, setXDomain] = useState(null);
  const [yDomain, setYDomain] = useState(null);
  const [ref, setRef] = useState(null);
  const dragging = useRef(false);
  const axisRef = useRef(null);     // null | 'x' | 'y'
  const startPixel = useRef(null);  // { x, y } in client px
  const startVal = useRef(null);    // { x, y } in data coords
  const xSafe = Array.isArray(xDataDomain) && xDataDomain[1] > xDataDomain[0] ? xDataDomain : [0, 1];
  const ySafe = Array.isArray(yDataDomain) && yDataDomain[1] > yDataDomain[0] ? yDataDomain : [0, 1];
  const effX = xDomain || xSafe;
  const effY = yDomain || ySafe;
  const effXRef = useRef(effX); effXRef.current = effX;
  const effYRef = useRef(effY); effYRef.current = effY;
  // Live margins for the once-registered window listeners (see useXZoom).
  const marginRef = useRef(margin);
  marginRef.current = margin;

  const getX = (clientX) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const m = marginRef.current;
    const plotW = rect.width - m.left - m.right;
    if (plotW <= 0) return null;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - m.left) / plotW));
    const d0 = effXRef.current;
    return d0[0] + fx * (d0[1] - d0[0]);
  };
  const getY = (clientY) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const m = marginRef.current;
    const plotH = rect.height - m.top - m.bottom;
    if (plotH <= 0) return null;
    const fy = Math.min(1, Math.max(0, (clientY - rect.top - m.top) / plotH));
    const d0 = effYRef.current;
    return d0[1] - fy * (d0[1] - d0[0]);
  };

  useEffect(() => {
    const mv = (e) => {
      if (!dragging.current) return;
      let ax = axisRef.current;
      if (!ax) {
        const dx = Math.abs(e.clientX - startPixel.current.x);
        const dy = Math.abs(e.clientY - startPixel.current.y);
        if (Math.max(dx, dy) < 4) return;
        ax = axisRef.current = dx >= dy ? 'x' : 'y';
      }
      if (ax === 'x') {
        const v = getX(e.clientX);
        if (v !== null) setRef({ axis: 'x', x1: startVal.current.x, x2: v });
      } else {
        const v = getY(e.clientY);
        if (v !== null) setRef({ axis: 'y', y1: startVal.current.y, y2: v });
      }
    };
    const up = (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      const ax = axisRef.current;
      if (ax === 'x') {
        const end = getX(e.clientX);
        const start = startVal.current.x;
        if (start !== null && end !== null && Math.abs(end - start) > (effXRef.current[1] - effXRef.current[0]) * 0.01) {
          setXDomain([Math.min(start, end), Math.max(start, end)]);
        }
      } else if (ax === 'y') {
        const end = getY(e.clientY);
        const start = startVal.current.y;
        if (start !== null && end !== null && Math.abs(end - start) > (effYRef.current[1] - effYRef.current[0]) * 0.01) {
          setYDomain([Math.min(start, end), Math.max(start, end)]);
        }
      }
      axisRef.current = null;
      startPixel.current = null;
      startVal.current = null;
      setRef(null);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, []);

  const onMouseDown = (e) => {
    const xv = getX(e.clientX);
    const yv = getY(e.clientY);
    if (xv === null || yv === null) return;
    dragging.current = true;
    axisRef.current = null;
    startPixel.current = { x: e.clientX, y: e.clientY };
    startVal.current = { x: xv, y: yv };
  };

  const reset = () => { setXDomain(null); setYDomain(null); };
  return { xDomain: effX, yDomain: effY, ref, onMouseDown, isZoomed: !!(xDomain || yDomain), reset };
};

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE LINKING — a per-test switch that decides whether the overlay shows
// ALL instances/conditions together ("linked") or ONLY the active instance
// ("single instance"). Flow Cytometry auto-defaults to single-instance when
// spectra were uploaded as multiple files into the same instance.
// ─────────────────────────────────────────────────────────────────────────────
export const instancesLinked = (activeTest = {}) =>
  activeTest.linkInstances !== false && !((activeTest.fcExtraFiles || []).length > 0);

export const InstanceLinkToggle = ({ activeTest, updateActiveTest, className = '' }) => {
  const linked = instancesLinked(activeTest);
  return (
    <button
      type="button"
      onClick={() => updateActiveTest({ linkInstances: !linked })}
      title={linked
        ? 'Instances are linked — all conditions are shown together. Click to see only this instance.'
        : 'Only this instance is shown. Click to link all instances again.'}
      className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors whitespace-nowrap ${linked ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200'} ${className}`}
    >
      {linked ? '🔗 Instances linked' : '🔒 Single instance'}
    </button>
  );
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

// Strict numeric reader: '' / null / undefined / NaN → null (Number(null) is 0,
// which would silently pull a chart axis down to the origin).
const numOrNullStrict = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Value-axis range that ALSO takes the ± error into account.
 *
 * Recharts computes its automatic ("auto") Y domain from the plotted dataKeys
 * only: the ErrorBar dataKey (`<key>__sd`, `sd`, `err`…) is invisible to it, so
 * error bars sticking out of the tallest bar / point get clipped by the plot
 * area. Callers that draw error bars use this range for `domain={[lo, hi]}`
 * whenever the user did not pin Y Min / Y Max in the Graphical Parameters.
 *
 *   rows    -- the chart rows (histogram rows or [{ x, y, sd }] points)
 *   keys    -- the plotted series keys
 *   errOf   -- (row, key) => ± error for this row / series. When omitted the
 *              conventional `<key>__sd` column is used.
 *   baseMin -- lower bound kept when everything sits above it (0 = baseline).
 * Returns null when no finite value is found (caller then keeps "auto").
 */
export const errorBarRange = (rows, keys, errOf, baseMin = 0) => {
  const list = Array.isArray(rows) ? rows : [];
  const seriesKeys = Array.isArray(keys) ? keys : [];
  let lo = null;
  let hi = null;
  list.forEach((row) => {
    if (!row) return;
    seriesKeys.forEach((key) => {
      const v = numOrNullStrict(row[key]);
      if (v === null) return;
      const rawErr = errOf ? errOf(row, key) : row[`${key}__sd`];
      const e = Math.abs(numOrNullStrict(rawErr) || 0);
      const dn = v - e;
      const up = v + e;
      lo = lo === null ? dn : Math.min(lo, dn);
      hi = hi === null ? up : Math.max(hi, up);
    });
  });
  if (lo === null || hi === null || !(hi > lo)) return null;
  const base = numOrNullStrict(baseMin);
  if (base !== null && base < lo) lo = base;
  return [lo, hi];
};

/**
 * The classic "axis interruption" glyph: two parallel strokes crossing the axis
 * line. Recharts passes the reference-line geometry through `viewBox`.
 */
const AxisBreakSlash = ({ viewBox, axis = 'y' }) => {
  const x = Number(viewBox && viewBox.x) || 0;
  const y = Number(viewBox && viewBox.y) || 0;
  const h = Number(viewBox && viewBox.height) || 0;
  // A vertical (X) reference line: the axis sits at the BOTTOM of the plot box.
  const yy = axis === 'x' ? y + h : y;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {[-3, 3].map((off) => (
        <line key={off}
          x1={x - 5} y1={yy + off - 5} x2={x + 5} y2={yy + off + 5}
          stroke="#475569" strokeWidth={1.6} strokeLinecap="round" />
      ))}
    </g>
  );
};

/**
 * Draws the interruption of a broken axis: a light shading + two dashed guides
 * at the edges of the compressed band, and the double slash on the axis itself.
 * Use it INSIDE a recharts chart, after the series (so the marks stay visible
 * over the bars). `brk` may be passed when the caller already resolved it (the
 * automatic break), otherwise it is read from `cfg`.
 */
export const AxisBreakMarks = ({ cfg = {}, axis = 'y', values = [], brk = null }) => {
  const b = brk || axisBreakFor(cfg, axis, values);
  if (!b || !b.on) return null;
  const horiz = axis !== 'x';
  const band = horiz
    ? { y1: b.from, y2: b.to }
    : { x1: b.from, x2: b.to };
  const line = (v) => (horiz ? { y: v } : { x: v });
  return (
    <React.Fragment>
      <ReferenceArea key="brkArea" {...band} fill="#94a3b8" fillOpacity={0.12} stroke="none" ifOverflow="visible" />
      <ReferenceLine key="brkFrom" {...line(b.from)} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="visible" />
      <ReferenceLine key="brkTo" {...line(b.to)} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="visible"
        label={<AxisBreakSlash axis={axis} />} />
    </React.Fragment>
  );
};

/**
 * Everything a recharts axis needs to be INTERRUPTED, computed from the plotted
 * values — so a chart that does not use <SharedChart> (flow cytometry, MD, NMR,
 * docking…) gets the feature in three lines:
 *
 *   const brk = brokenAxisProps(cfg, 'y', binValues);
 *   <YAxis {...brk.axisProps} tick={{…}} label={…} />
 *   {brk.marks}
 *
 * `opts.log` skips it (a log axis already compresses small values), `opts.min` /
 * `opts.max` are the user's yMin / yMax, `opts.step` a tick interval.
 */
export const brokenAxisProps = (cfg = {}, axis = 'y', values = [], opts = {}) => {
  const off = { on: false, brk: null, axisProps: {}, marks: null };
  if (opts.log) return off;
  const brk = axisBreakFor(cfg, axis, values);
  if (!brk.on) return off;
  let lo = Infinity;
  let hi = -Infinity;
  values.forEach((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  });
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return off;
  const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const min = numOrNull(opts.min);
  const max = numOrNull(opts.max);
  const low = min !== null ? min : Math.min(0, lo);
  const top = max !== null ? max : Math.max(hi, brk.to) * 1.02;
  const seg = breakSegments(brk, low, top);
  if (!seg) return off;
  return {
    on: true,
    brk,
    domain: [low, top],
    axisProps: {
      scale: brokenScale(brk),
      domain: [low, top],
      ticks: breakTicks(seg, opts.step),
      allowDataOverflow: true
    },
    marks: <AxisBreakMarks brk={brk} axis={axis} />
  };
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
  height = 260,
  setCfg = null
}) => {
  const safeSeries = Array.isArray(series) && series.length
    ? series
    : [{ key: 'y', label: 'Series' }];

  const chartRef = useRef(null);
  const fs = Number(cfg.fontSize) || DEFAULT_CHART_FONT_SIZE;
  const strokeWidth = Number(cfg.lineThickness) || 2;
  const chartType = normalizeChartType(cfg.chartType);
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
  /* Grow the axis areas with the panel font size so bigger ticks never overlap
     the axis titles. The SAME margin object feeds the chart and the drag-to-zoom
     pixel math, so the zoom rectangle stays aligned with the plot. */
  const resolvedMargin = cfgChartMargin(cfg, { top: 8, right: 12, bottom: 34, ...margin, left: margin.left ?? yAxisWidth });
  const zoom = useXZoom(chartRef, cfgDomain, resolvedMargin);
  const xDomain = xLog
    ? [
        Math.max(1e-9, cMin !== null && cMin > 0 ? cMin : (dataDomain[0] > 0 ? dataDomain[0] : zoom.domain[0])),
        cMax !== null ? cMax : zoom.domain[1]
      ]
    : [zoom.domain[0], zoom.domain[1]];

  /* Y domain (0-based unless the user overrides; positive when log).
     The ± errors drawn through `errorKey` are folded into the automatic range,
     so error bars sticking out above the last point are never clipped. */
  const yMin = numOrNull(cfg.yMin);
  const yMax = numOrNull(cfg.yMax);
  const errRange = (errorKey && cfg.errorBarStyle !== 'none')
    ? errorBarRange(plotData, safeSeries.map((s) => s.key), (row) => row[errorKey], 0)
    : null;
  const yDomain = yLog
    ? [
        yMin !== null && yMin > 0 ? yMin : (errRange && errRange[0] > 0 ? errRange[0] : 'auto'),
        yMax !== null ? yMax : (errRange ? errRange[1] : 'auto')
      ]
    : [yMin ?? (errRange ? errRange[0] : 0), yMax ?? (errRange ? errRange[1] : 'auto')];

  /* Tick steps → explicit ticks on numeric axes. */
  const xStep = cfg.xTickStep ?? cfg.tickStep;
  const yStep = cfg.yTickStep;

  /* ── BROKEN ("INTERRUPTED") AXIS ──────────────────────────────────────────
     A histogram with one bar 100× the others: the panel's "✂ Interrupt Y axis"
     squeezes the empty range into a small band so the low bars AND the huge one
     are readable. The VALUES are never touched — only the value→pixel mapping
     (brokenScale) and the ticks change, so the tooltip and the exports keep the
     real numbers. See chartStyle.axisBreakOf / brokenScale / breakTicks. */
  const axisValues = (key) => {
    const out = [];
    plotData.forEach((row) => {
      const v = Number(row?.[key]);
      if (Number.isFinite(v)) out.push(v);
    });
    return out;
  };
  /* A log axis already compresses the small values: no interruption there. */
  const xBrk = xLog ? axisBreakOf(cfg, 'x') : axisBreakFor(cfg, 'x', axisValues(xKey));
  const yBrk = yLog ? axisBreakOf(cfg, 'y') : axisBreakFor(cfg, 'y', safeSeries.flatMap((s) => axisValues(s.key)));
  const xScale = brokenScale(xBrk);
  const yScale = brokenScale(yBrk);
  const spanOf = (vals) => {
    if (!vals.length) return null;
    let lo = vals[0];
    let hi = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] < lo) lo = vals[i];
      if (vals[i] > hi) hi = vals[i];
    }
    return [lo, hi];
  };
  const headroom = (lo, hi) => hi + Math.abs(hi - lo) * 0.02;
  /* The interrupted axis needs a CONCRETE domain (a 'auto' domain computed by
     recharts from the data would make the break edges slide around). */
  const ySpan = yBrk.on ? spanOf(safeSeries.flatMap((s) => axisValues(s.key))) : null;
  const yBrkLo = yMin !== null ? yMin : (ySpan ? Math.min(0, ySpan[0]) : 0);
  const yBrkHi = yMax !== null ? yMax : headroom(yBrkLo, Math.max(ySpan ? ySpan[1] : 1, yBrk.to));
  const xSpan = xBrk.on ? spanOf(axisValues(xKey)) : null;
  const xBrkLo = cMin !== null ? cMin : (xSpan ? xSpan[0] : zoom.domain[0]);
  const xBrkHi = cMax !== null ? cMax : headroom(xBrkLo, Math.max(xSpan ? xSpan[1] : 1, xBrk.to));

  const xTicks = xBrk.on
    ? breakTicks(breakSegments(xBrk, xBrkLo, xBrkHi), xStep)
    : (xStep ? numericTicks(xDomain[0], xDomain[1], xStep) : null);
  const yTicks = yBrk.on
    ? breakTicks(breakSegments(yBrk, yBrkLo, yBrkHi), yStep)
    : (yStep && yMin !== null && yMax !== null ? numericTicks(yMin, yMax, yStep) : null);

  /* The interrupted axis supplies its own concrete domain. */
  const xDomainDraw = xBrk.on ? [xBrkLo, xBrkHi] : xDomain;
  const yDomainDraw = yBrk.on ? [yBrkLo, yBrkHi] : yDomain;

  /* Series colours: per-curve colour → legacy colours[] → base-colour shades →
     rainbow → the colour the page passed in. */
  const colorFor = (s, i) => seriesColorOf(cfg, s.key, i, safeSeries.length, s.color);

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


  /* One element per curve. The type / colour / symbol / line style of each
     curve come from the per-curve block when it has an entry for that key,
     and from the chart-wide "Chart Appearance" commands otherwise — so the
     curves of one graph CAN be told apart. A curve switched off is dropped. */
  const makeSeries = safeSeries.filter((s) => seriesVisible(cfg, s.key)).map((s, i) => {
    const col = colorFor(s, i);
    const t = seriesChartType(cfg, s.key, chartType);
    const dot = cfgDot(cfg, col, s.key);
    const base = {
      dataKey: s.key, name: seriesLabelOf(cfg, s.key, s.label), isAnimationActive: false
    };
    if (t === 'bar') {
      return <Bar key={s.key} {...base} fill={col} stroke={col} strokeWidth={1}>{errorBarsFor()}</Bar>;
    }
    if (t === 'scatter' && chartType === 'scatter') {
      return <Scatter key={s.key} {...base} fill={col} stroke={col} fillOpacity={0.85} shape="circle">{errorBarsFor()}</Scatter>;
    }
    if (t === 'area') {
      return (
        <Area
          key={s.key}
          {...base}
          type="monotone"
          stroke={col}
          strokeWidth={seriesLineThickness(cfg, s.key, strokeWidth)}
          strokeDasharray={seriesDash(cfg, s.key)}
          fill={col}
          fillOpacity={0.15}
          dot={dot}
        >
          {errorBarsFor()}
        </Area>
      );
    }
    // 'scatter' as a PER-CURVE choice: the curve keeps its identity through the
    // symbols, with the connecting line faded out (a Line inside a ComposedChart
    // is the reliable way to keep the X axis numeric).
    const faded = t === 'scatter' && chartType !== 'scatter';
    return (
      <Line
        key={s.key}
        {...base}
        type="monotone"
        stroke={col}
        strokeOpacity={faded ? 0.35 : 1}
        strokeWidth={seriesLineThickness(cfg, s.key, strokeWidth)}
        strokeDasharray={seriesDash(cfg, s.key)}
        dot={dot}
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
      domain={xDomainDraw}
      allowDataOverflow
      scale={xScale || (xLog ? 'log' : 'auto')}
      tick={tickPropsFor('x')}
      tickMargin={10}
      tickFormatter={cfgTickFormatter(cfg, 'x') || undefined}
      {...(xTicks ? { ticks: xTicks } : {})}
      label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || (unit ? `Value (${unit})` : 'Value'), 18)}
    />,
    <YAxis
      key="y"
      domain={yDomainDraw}
      allowDataOverflow
      scale={yScale || (yLog ? 'log' : 'auto')}
      tick={tickPropsFor('y')}
      tickFormatter={cfgTickFormatter(cfg, 'y') || undefined}
      {...(yTicks ? { ticks: yTicks } : {})}
      width={yAxisWidth}
      label={cfg.yAxisLabel ? cfgAxisLabel(cfg, 'y', cfg.yAxisLabel, 0) : undefined}
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
    ...makeSeries,
    /* The interruption marks come LAST so the ✂ double slash stays visible over
       the bars it explains. */
    yBrk.on ? <AxisBreakMarks key="brk-y" brk={yBrk} axis="y" /> : null,
    xBrk.on ? <AxisBreakMarks key="brk-x" brk={xBrk} axis="x" /> : null
  ];

  const h = useChartFsHeight(Number(cfg.height) || height);

  return (
    <div className="flex flex-col gap-1">
      <ChartInspector
        containerRef={chartRef}
        containerProps={{ onMouseDown: zoom.onMouseDown }}
        className="select-none"
        style={{ height: h }}
        cfg={setCfg ? cfg : null}
        setCfg={setCfg}
        series={safeSeries}
        unit={unit}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' && !hasSeriesOverrides(cfg) ? (
            <BarChart data={plotData} margin={resolvedMargin}>{children}</BarChart>
          ) : chartType === 'scatter' && !hasSeriesOverrides(cfg) ? (
            <ScatterChart data={plotData} margin={resolvedMargin}>{children}</ScatterChart>
          ) : chartType === 'area' && !hasSeriesOverrides(cfg) ? (
            <AreaChart data={plotData} margin={resolvedMargin}>{children}</AreaChart>
          ) : chartType === 'line' && !hasSeriesOverrides(cfg) ? (
            <LineChart data={plotData} margin={resolvedMargin}>{children}</LineChart>
          ) : (
            /* Per-curve types: one chart has to host lines, bars, areas and
               point-only curves at once — that is exactly a ComposedChart. */
            <ComposedChart data={plotData} margin={resolvedMargin}>{children}</ComposedChart>
          )}
        </ResponsiveContainer>
      </ChartInspector>
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
void cfgDash; // kept for readers of the older code — seriesDash(cfg, key) is the per-curve one

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

/**
 * The SYMBOL of a curve — a real shape, not always a circle. Recharts' plain
 * `dot={{ r }}` only ever draws a circle, which is why choosing "Square" or
 * "Triangle" in the panel appeared to do nothing. This component draws the
 * shape the user picked (circle / square / triangle / cross / diamond / star)
 * at the requested size and colour.
 */
export const ChartDot = ({ cx, cy, r, fill, stroke, symbol = 'circle', strokeWidth = 0, hidden = false }) => {
    if (hidden || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const rad = Math.max(1, Number(r) || 4);
    const col = fill || stroke || '#3b82f6';
    const k = String(symbol || 'circle').toLowerCase();
    const sw = Number(strokeWidth) || 0;
    if (k === 'none') return null;
    if (k === 'square') {
        const s = rad * 1.7;
        return <rect x={cx - s / 2} y={cy - s / 2} width={s} height={s} fill={col} stroke={stroke || 'none'} strokeWidth={sw} />;
    }
    if (k === 'triangle') {
        const h = rad * 1.75;
        const pts = `${cx},${cy - h * 0.6} ${cx - h * 0.55},${cy + h * 0.42} ${cx + h * 0.55},${cy + h * 0.42}`;
        return <polygon points={pts} fill={col} stroke={stroke || 'none'} strokeWidth={sw} />;
    }
    if (k === 'cross' || k === 'crossrot' || k === 'x') {
        const d = rad * 1.2;
        return (
            <g stroke={col} strokeWidth={Math.max(1.2, sw)} strokeLinecap="round">
                <line x1={cx - d} y1={cy - d} x2={cx + d} y2={cy + d} />
                <line x1={cx - d} y1={cy + d} x2={cx + d} y2={cy - d} />
            </g>
        );
    }
    if (k === 'diamond') {
        const d = rad * 1.4;
        return <polygon points={`${cx},${cy - d} ${cx + d},${cy} ${cx},${cy + d} ${cx - d},${cy}`} fill={col} stroke={stroke || 'none'} strokeWidth={sw} />;
    }
    if (k === 'star') {
        const pts = Array.from({ length: 10 }, (_, i) => {
            const ang = (Math.PI / 5) * i - Math.PI / 2;
            const rr = i % 2 === 0 ? rad * 1.6 : rad * 0.7;
            return `${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`;
        }).join(' ');
        return <polygon points={pts} fill={col} stroke={stroke || 'none'} strokeWidth={sw} />;
    }
    return <circle cx={cx} cy={cy} r={rad} fill={col} stroke={stroke || 'none'} strokeWidth={sw} />;
};

/** Dot config of ONE series (false = no points). */
const cfgDot = (cfg, stroke, key = null) => {
    const style = seriesPointStyle(cfg, key);
    if (!style || style === 'none') return false;
    const r = seriesPtSize(cfg, key, 4);
    if (!(r > 0)) return false;
    // A shape other than the circle needs the custom renderer — a plain
    // `{ r }` object would silently draw a circle again.
    if (style !== 'circle') {
        return (props) => <ChartDot {...props} r={r} symbol={style} fill={stroke} />;
    }
    return { r, fill: stroke, strokeWidth: 0 };
};

/**
 * Recharts series element (Line / Area / Bar / scatter-like Line) that honours
 * every "Chart Appearance" panel command AND the per-curve overrides of
 * `opts.key` (type, colour, symbol, line style / width — or hidden).
 * Use inside a ComposedChart (or any chart that can host the returned element).
 *   opts: { key, data, dataKey, name, stroke }
 */
export const cfgSeriesEl = (cfg = {}, opts = {}) => {
    const key = opts.key;
    // A curve switched OFF in the per-curve block is simply not rendered.
    if (!seriesVisible(cfg, key)) return null;
    const type = seriesChartType(cfg, key, cfg.chartType || 'line');
    const strokeWidth = seriesLineThickness(cfg, key, 2);
    const stroke = seriesOverride(cfg, key, 'color') || opts.stroke;
    const name = seriesLabelOf(cfg, key, opts.name);
    const common = {
        key, data: opts.data, dataKey: opts.dataKey, name,
        stroke, strokeWidth, strokeDasharray: seriesDash(cfg, key),
        isAnimationActive: false,
    };
    if (type === 'bar') {
        const r = Number(cfg.barRadius) || 3;
        return <Bar {...common} fill={stroke} stroke="none" radius={[r, r, 0, 0]} />;
    }
    if (type === 'area') {
        return <Area {...common} type="monotone" fill={stroke} fillOpacity={Number(cfg.areaOpacity ?? 0.15)} connectNulls dot={cfgDot(cfg, stroke, key)} />;
    }
    if (type === 'scatter') {
        return <Line {...common} type="monotone" strokeOpacity={0.35} dot={cfgDot(cfg, stroke, key)} activeDot={false} connectNulls />;
    }
    return <Line {...common} type="monotone" dot={cfgDot(cfg, stroke, key)} activeDot={false} connectNulls />;
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

/**
 * Axis-title label props whose offset grows with the panel font size (and the
 * tick angle), so larger tick labels never overlap the axis title.
 *
 * The offset is the LARGER of the historical value (base + 1.6 px per extra
 * font px) and the room the tick numbers really take (xTickNumberExtent /
 * yTickNumberBand): with a big character size the title used to be pushed into
 * the numbers (or, on the y axis, into them), and the numbers could reach the
 * edge of the chart. cfgChartMargin reserves exactly this room, so the title
 * stays inside the chart at every size.
 *
 * Two panel commands are honoured here:
 *   • `xAxisLabelGap` / `yAxisLabelGap` push the title AWAY from the plot
 *     (the `offset` above);
 *   • `xAxisLabelMove` / `yAxisLabelMove` SLIDE it along its own axis — see
 *     axisLabelMove, which is what keeps a rotated y title inside the canvas.
 *   cfg  -- style object (fontSize, tickAngle)
 *   axis -- 'x' | 'y'
 *   value-- label text
 *   base -- offset used at the 12px base (default 25 for X, 20 for Y)
 */
export const cfgAxisLabel = (cfg = {}, axis = 'x', value = '', base) => {
  const fs = Number(cfg.fontSize) || 16;
  const extra = Math.max(0, fs - 12) + (Math.abs(Number(cfg.tickAngle) || 0) > 0 ? 8 : 0);
  const gap = axisLabelGap(cfg, axis);
  const move = axisLabelMove(cfg, axis);
  const offset = axis === 'x'
    // the x title is placed under the numbers (its cap height included)
    ? xAxisTitleOffset(fs, cfg.tickAngle, base ?? 25, extra, gap)
    // the y title is placed to the LEFT of the numbers, measured from the axis
    // gutter (recharts' reference for the y label): only numbers that outgrow
    // the gutter push it further left.
    : Math.max((base ?? 20) + extra * 1.6, yAxisTitleOffset(fs)) + gap;
  const bold = !!(axis === 'x' ? cfg.xAxisLabelBold : cfg.yAxisLabelBold);
  const italic = !!(axis === 'x' ? cfg.xAxisLabelItalic : cfg.yAxisLabelItalic);
  const titleFs = axisTitleSize(cfg, axisTitleFontSize(fs));
  const family = fontFamilyOf(cfg);
  const style = {
    value,
    fill: '#64748b',
    fontSize: titleFs,
    ...(family ? { fontFamily: family } : {}),
    ...(bold ? { fontWeight: 'bold' } : {}),
    ...(italic ? { fontStyle: 'italic' } : {})
  };
  if (axis === 'x') {
    // `dx` slides the title along the x axis (recharts adds it to the label
    // anchor BEFORE any rotation), `dy` does the same vertically for the
    // rotated y title. Left out entirely at 0, so an untouched chart renders
    // exactly the markup it used to.
    return { ...style, position: 'insideBottom', offset: -offset, ...(move ? { dx: move } : {}) };
  }
  return { ...style, angle: -90, position: 'insideLeft', offset: -offset, ...(move ? { dy: move } : {}) };
};

/**
 * Extra gap (px) requested between the tick numbers and the axis title, from
 * the panel controls `xAxisLabelGap` / `yAxisLabelGap` (positive = further away
 * from the plot, negative = closer). Returns 0 when unset.
 */
const axisLabelGap = (cfg = {}, axis = 'x') => {
  const raw = axis === 'x' ? cfg.xAxisLabelGap : cfg.yAxisLabelGap;
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/**
 * MANUAL MOVE (px) of the axis title ALONG its own axis, from the panel
 * controls `xAxisLabelMove` / `yAxisLabelMove` (positive = right for the x
 * title, DOWN for the y one). Returns 0 when unset — nothing moves by default.
 *
 * Why this exists, next to the gap above: the y title is drawn ROTATED and
 * recharts anchors it on the MIDDLE of the plot, the text running UPWARDS. The
 * room a rotated title needs is therefore VERTICAL and equal to its own length
 * ("Ellipticity (mdeg)" at 24 px is ~250 px), which neither cfgChartMargin
 * (that reserves room ACROSS the axis) nor the gap can give back: as soon as
 * the characters grow the top of the title leaves the chart box and there is no
 * margin left to grow. Sliding the whole label down with `yAxisLabelMove` puts
 * it back inside the graph whatever its length and character size — the panel
 * keeps the title itself unchanged.
 *
 * recharts applies `dx` / `dy` to the label anchor point and only then
 * `rotate(-90, x, y)` around it (Label → Text), so these are TRUE screen px:
 * +Y moves down, −Y moves up, whatever the angle.
 */
const axisLabelMove = (cfg = {}, axis = 'x') => {
  const raw = axis === 'x' ? cfg.xAxisLabelMove : cfg.yAxisLabelMove;
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Chart margin that grows with the panel font size so the axis areas have room
 * for larger tick labels + titles. Pass the chart's base margin as `base`.
 * A positive axis-title gap also widens the corresponding margin.
 *
 * The growth is the LARGER of the historical 2.2 px per extra font px and the
 * room the geometry really needs (tick numbers + the axis title after them, see
 * xTickNumberExtent / yTickNumberBand). The chart is an <svg>: whatever the
 * margin does not reserve is clipped, which is what used to happen to the y
 * numbers (wide) and to the x numbers / title with angled ticks.
 */
export const cfgChartMargin = (cfg = {}, base = { top: 20, right: 20, bottom: 45, left: 50 }) => {
  const fs = Number(cfg.fontSize) || 16;
  const angle = Number(cfg.tickAngle) || 0;
  const extra = Math.max(0, fs - 12);
  const xGap = Math.max(0, axisLabelGap(cfg, 'x'));
  const yGap = Math.max(0, axisLabelGap(cfg, 'y'));
  // Absolute floors, measured from the plot edges: the x title (which sits
  // under the numbers) and the y title (which sits left of the axis gutter,
  // i.e. of the numbers that outgrow it).
  const xNeed = Math.round(
    xAxisTitleOffset(fs, angle, 25, extra, xGap) + axisTitleFontSize(fs) * 0.22 + 2
  );
  const yNeed = Math.round(
    Math.max(20 + extra * 1.6, yAxisTitleOffset(fs)) + axisTitleCap(fs) + 2 + yGap
  );
  return {
    ...base,
    bottom: Math.max((base.bottom ?? 45) + extra * 2.2, xNeed),
    left: Math.max((base.left ?? 50) + extra * 2.2, yNeed)
  };
};



