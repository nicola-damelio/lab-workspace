import React from 'react';

// --- SHARED GRAPH CONFIGURATION ---
export const SharedGraphConfig = ({ 
    activeTest, 
    updateActiveTest, 
    showLayoutOptions = false, // specific to pages that need width/height sliders
    showWidthSlider = false,
    showHeightSlider = false,
    drWidth, setDrWidth, 
    chartH, setChartH,
    unit = 'a.u.' // fallback unit
}) => {
    // Ensure chartCfg exists with defaults to avoid crashes
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
                    placeholder={`e.g. Log₁₀ [Conc. (${unit})]`}
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
                        type="range"
                        min="20"
                        max="80"
                        step="5"
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
                        type="range"
                        min="200"
                        max="1000"
                        step="25"
                        value={chartH || 530}
                        onChange={(e) => setChartH && setChartH(parseInt(e.target.value))}
                        className="accent-blue-600 mt-2"
                    />
                </div>
            )}
        </div>
    );
};

// --- SHARED ERROR TREATMENT ---
export const SharedErrorTreatment = ({ activeTest, updateActiveTest, showFitToggle = true, customActions }) => {
    const { useFixedSD, fixedSDStr, outlierThreshStr, fitIC50, showExcl } = activeTest;

    return (
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col gap-3 flex-[2] min-w-[350px]">
            <div className="text-[10px] uppercase font-bold text-slate-500">
                Errors, Outliers & Fitting
            </div>

            <div className="flex flex-wrap items-center gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                {/* Global Fixed SD */}
                <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-2 cursor-pointer hover:text-blue-600">
                        <input
                            type="checkbox"
                            checked={useFixedSD || false}
                            onChange={(e) => updateActiveTest({ useFixedSD: e.target.checked })}
                            className="cursor-pointer w-4 h-4 accent-blue-600"
                        />
                        Fixed SD ±:
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={fixedSDStr !== undefined ? fixedSDStr : ''}
                        onChange={(e) => updateActiveTest({ fixedSDStr: e.target.value })}
                        disabled={!useFixedSD}
                        className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none focus:border-blue-500 ${
                            !useFixedSD ? 'bg-slate-100 text-slate-400' : 'bg-white font-bold text-blue-700'
                        }`}
                    />
                </div>

                {/* Inject Custom Actions (like Auto-Touch or Clean Outliers) */}
                {customActions && (
                    <>
                        <div className="w-px h-8 bg-slate-200 hidden sm:block"></div>
                        {customActions}
                    </>
                )}

                <div className="w-px h-8 bg-slate-200 hidden md:block"></div>

                {/* Outlier Threshold */}
                <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-600">
                        Outlier Threshold (×Err):
                    </label>
                    <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={outlierThreshStr !== undefined ? outlierThreshStr : '2.0'}
                        onChange={(e) => updateActiveTest({ outlierThreshStr: e.target.value })}
                        className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none focus:border-blue-500"
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-1">
                {/* Optional Fit Toggle */}
                {showFitToggle && (
                    <label className="flex items-center gap-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                        <span className="text-xs font-bold text-blue-800">Fit Curve</span>
                        <input
                            type="checkbox"
                            checked={fitIC50 || false}
                            onChange={(e) => updateActiveTest({ fitIC50: e.target.checked })}
                            className="w-4 h-4 cursor-pointer accent-blue-600"
                        />
                    </label>
                )}

                {/* Show Excluded Points Toggle */}
                <label className="flex items-center gap-2 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-md px-3 py-1.5 cursor-pointer transition-colors shadow-sm">
                    <span className="text-xs font-bold text-slate-700">Show Excl. Points</span>
                    <input
                        type="checkbox"
                        checked={showExcl || false}
                        onChange={(e) => updateActiveTest({ showExcl: e.target.checked })}
                        className="w-4 h-4 cursor-pointer accent-slate-600"
                    />
                </label>
            </div>
        </div>
    );
};