import React, { useState } from 'react';
import { useDoseResponseFitting } from '../hooks/useDoseResponseFitting';
import ManualSDPanel from '../components/ManualSDPanel';

const sampleSeries = [
    {
        name: 'Compound A',
        color: '#2563eb',
        points: [
            { realX: 100, y: 98 },
            { realX: 100, y: 95 },
            { realX: 10, y: 82 },
            { realX: 10, y: 79 },
            { realX: 1, y: 46 },
            { realX: 1, y: 49 },
            { realX: 0.1, y: 18 },
            { realX: 0.1, y: 21 },
            { realX: 0.01, y: 8 }
        ]
    },
    {
        name: 'Compound B',
        color: '#dc2626',
        points: [
            { realX: 100, y: 99 },
            { realX: 10, y: 88 },
            { realX: 1, y: 61 },
            { realX: 0.1, y: 31 },
            { realX: 0.01, y: 12 }
        ]
    }
];

export default function GenericFittingPage() {
    const [manualErrors, setManualErrors] = useState({});

    const [settings, setSettings] = useState({
        fitIC50: true,
        useFixedSD: false,
        fixedSD: 0,
        outlierThreshold: 2.0
    });

    const fitting = useDoseResponseFitting({
        series: sampleSeries,
        manualErrors,
        onManualErrorsChange: setManualErrors,
        settings
    });

    return (
        <div className="p-6 flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-bold text-slate-800 mb-1">
                    Generic Fitting Page
                </h1>

                <p className="text-sm text-slate-500">
                    This page uses the separated fitting engine.
                </p>
            </div>

            <div className="flex flex-wrap gap-4 p-4 bg-white border border-slate-200 rounded-xl">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    Fit IC50
                    <input
                        type="checkbox"
                        checked={settings.fitIC50}
                        onChange={(e) => {
                            setSettings((prev) => ({
                                ...prev,
                                fitIC50: e.target.checked
                            }));
                        }}
                    />
                </label>

                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    Fixed SD
                    <input
                        type="checkbox"
                        checked={settings.useFixedSD}
                        onChange={(e) => {
                            setSettings((prev) => ({
                                ...prev,
                                useFixedSD: e.target.checked
                            }));
                        }}
                    />
                </label>

                <input
                    type="number"
                    step="0.1"
                    value={settings.fixedSD}
                    disabled={!settings.useFixedSD}
                    onChange={(e) => {
                        setSettings((prev) => ({
                            ...prev,
                            fixedSD: parseFloat(e.target.value) || 0
                        }));
                    }}
                    className="border border-slate-300 rounded-md px-2 py-1 text-sm w-24"
                />

                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                    Outlier threshold
                    <input
                        type="number"
                        step="0.1"
                        value={settings.outlierThreshold}
                        onChange={(e) => {
                            setSettings((prev) => ({
                                ...prev,
                                outlierThreshold: parseFloat(e.target.value) || 2
                            }));
                        }}
                        className="border border-slate-300 rounded-md px-2 py-1 text-sm w-20"
                    />
                </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {fitting.processedSeries.map((series) => (
                    <div
                        key={series.name}
                        className="p-4 bg-white border border-slate-200 rounded-xl"
                    >
                        <div className="flex items-center gap-2 mb-3">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: series.color }}
                            />

                            <h2 className="font-bold text-slate-800">
                                {series.name}
                            </h2>
                        </div>

                        {series.fit ? (
                            <div className="text-sm text-slate-700">
                                <p>
                                    IC50:{' '}
                                    <b>
                                        {series.fit.ic50.toFixed(3)}
                                    </b>
                                </p>

                                <p>
                                    Hill: {series.fit.hill.toFixed(3)}
                                </p>

                                <p>
                                    SE: {series.fit.se.toFixed(3)}
                                </p>
                            </div>
                        ) : (
                            <div className="text-sm text-slate-400">
                                No fit available.
                            </div>
                        )}

                        <div className="mt-4">
                            <table className="w-full text-xs border-collapse">
                                <thead>
                                    <tr>
                                        <th className="border border-slate-200 p-1 text-left">
                                            Conc
                                        </th>
                                        <th className="border border-slate-200 p-1 text-left">
                                            Response
                                        </th>
                                        <th className="border border-slate-200 p-1 text-left">
                                            SD
                                        </th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {series.visiblePoints.map((point) => (
                                        <tr key={point.realX}>
                                            <td className="border border-slate-200 p-1">
                                                {point.realX}
                                            </td>

                                            <td className="border border-slate-200 p-1">
                                                {point.y.toFixed(2)}
                                            </td>

                                            <td className="border border-slate-200 p-1">
                                                {point.sd.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>

            <ManualSDPanel fitting={fitting} />

            {fitting.outliers.length > 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                    <h3 className="text-sm font-bold text-yellow-800 mb-2">
                        Possible outliers
                    </h3>

                    <ul className="text-sm text-yellow-800 list-disc pl-5">
                        {fitting.outliers.map((outlier, idx) => (
                            <li key={idx}>
                                {outlier.seriesName} — conc:{' '}
                                {outlier.realX.toFixed(3)} — response:{' '}
                                {outlier.y.toFixed(2)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
