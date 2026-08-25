import { useMemo } from 'react';
import {
    processSeries,
    detectOutliersForSeries,
    getManualError,
    hasManualError,
    setManualError,
    clearManualError,
    clearAllManualErrors,
    applyAutoTouchToSeries,
    applyAutoTouchAll
} from '../utils/fittingEngine';

export function useDoseResponseFitting({
    series = [],
    manualErrors = {},
    onManualErrorsChange,
    settings = {}
}) {
    const processedSeries = useMemo(() => {
        return processSeries(series, {
            manualErrors,
            useFixedSD: settings.useFixedSD,
            fixedSD: settings.fixedSD,
            fitIC50: settings.fitIC50
        });
    }, [
        series,
        manualErrors,
        settings.useFixedSD,
        settings.fixedSD,
        settings.fitIC50
    ]);

    const outliers = useMemo(() => {
        return detectOutliersForSeries(processedSeries, settings);
    }, [
        processedSeries
    ]);

    const actions = {
        getManualError: (seriesName, realX) => {
            return getManualError(manualErrors, seriesName, realX);
        },

        hasManualError: (seriesName, realX) => {
            return hasManualError(manualErrors, seriesName, realX);
        },

        setManualError: (seriesName, realX, value) => {
            const next = setManualError(manualErrors, seriesName, realX, value);
            onManualErrorsChange?.(next);
        },

        clearManualError: (seriesName, realX) => {
            const next = clearManualError(manualErrors, seriesName, realX);
            onManualErrorsChange?.(next);
        },

        clearAllManualErrors: (seriesName) => {
            const next = clearAllManualErrors(manualErrors, seriesName);
            onManualErrorsChange?.(next);
        },

        autoTouchSeries: (seriesName) => {
            const next = applyAutoTouchToSeries(manualErrors, processedSeries, seriesName);
            onManualErrorsChange?.(next);
        },

        autoTouchAll: () => {
            const next = applyAutoTouchAll(manualErrors, processedSeries);
            onManualErrorsChange?.(next);
        }
    };

    return {
        processedSeries,
        outliers,
        ...actions
    };
}
