import React, { useState, useEffect } from 'react';
import { formatConc } from '../data/constants';

const SDInput = ({
    label,
    value,
    sdRaw,
    isOverridden,
    onSave,
    onReset
}) => {
    const [tempVal, setTempVal] = useState(value !== undefined ? value : '');

    useEffect(() => {
        setTempVal(value !== undefined ? value : '');
    }, [value]);

    return (
        <div
            className={`flex flex-col gap-1 p-1.5 rounded border ${
                isOverridden
                    ? 'border-orange-400 bg-white'
                    : 'border-slate-200 bg-white'
            }`}
        >
            <span className="text-[9px] font-bold text-slate-500">
                {label}
            </span>

            <div className="flex gap-1 items-center">
                <input
                    type="number"
                    step="0.01"
                    value={tempVal}
                    onChange={(e) => setTempVal(e.target.value)}
                    onBlur={() => onSave(parseFloat(tempVal) || 0)}
                    className="w-16 text-xs border border-slate-300 rounded p-0.5 outline-none focus:border-orange-500 text-center"
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

export default function ManualSDPanel({ fitting }) {
    const {
        processedSeries,
        getManualError,
        hasManualError,
        setManualError,
        clearManualError,
        clearAllManualErrors,
        autoTouchSeries,
        autoTouchAll
    } = fitting;

    if (!processedSeries || processedSeries.length === 0) {
        return (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500">
                No series available for fitting.
            </div>
        );
    }

    return (
        <div className="p-5 bg-orange-50 border border-orange-200 rounded-xl shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-black text-orange-800">
                    Manual SD Overrides
                </h3>

                <button
                    onClick={() => autoTouchAll()}
                    className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-3 py-1.5 rounded-md"
                >
                    🎯 Auto-Touch All
                </button>
            </div>

            <div className="flex flex-col gap-4">
                {processedSeries.map((series) => {
                    if (!series.visiblePoints?.length) return null;

                    return (
                        <div
                            key={series.name}
                            className="bg-white rounded-lg border border-orange-200 p-4 shadow-sm"
                        >
                            <div className="flex items-center justify-between gap-3 mb-3 border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{
                                            backgroundColor: series.color || '#2563eb'
                                        }}
                                    />

                                    <span className="text-sm font-bold text-slate-800">
                                        {series.name}
                                    </span>

                                    {series.fit && (
                                        <span className="text-xs text-slate-500">
                                            IC50: {series.fit.ic50.toFixed(3)}
                                        </span>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => autoTouchSeries(series.name)}
                                        className="text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold"
                                    >
                                        🎯 Auto-Touch
                                    </button>

                                    <button
                                        onClick={() => clearAllManualErrors(series.name)}
                                        className="text-xs text-orange-600 hover:underline font-bold"
                                    >
                                        🔄 Reset
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                                {series.visiblePoints.map((point) => {
                                    const overridden = hasManualError(series.name, point.realX);

                                    return (
                                        <SDInput
                                            key={`${series.name}-${point.realX}`}
                                            label={`${formatConc(point.realX)}`}
                                            value={
                                                overridden
                                                    ? getManualError(series.name, point.realX)
                                                    : point.sdRaw
                                            }
                                            sdRaw={point.sdRaw}
                                            isOverridden={overridden}
                                            onSave={(value) => {
                                                setManualError(series.name, point.realX, value);
                                            }}
                                            onReset={() => {
                                                clearManualError(series.name, point.realX);
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
