import { fit4PL, concKey } from '../data/constants';

export const parseNumber = (value) => {
    if (typeof value === 'number') return value;

    if (typeof value === 'string') {
        const n = parseFloat(value.trim().replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }

    return NaN;
};

export const isValidPoint = (point) => {
    return (
        point &&
        typeof point.realX === 'number' &&
        point.realX > 0 &&
        Number.isFinite(point.realX) &&
        typeof point.y === 'number' &&
        Number.isFinite(point.y)
    );
};

export const getManualError = (manualErrors, seriesName, realX) => {
    if (!manualErrors || !seriesName) return undefined;

    const seriesErrors = manualErrors[seriesName];

    if (!seriesErrors) return undefined;

    return seriesErrors[concKey(realX)];
};

export const hasManualError = (manualErrors, seriesName, realX) => {
    return typeof getManualError(manualErrors, seriesName, realX) === 'number';
};

export const getEffectiveSD = (manualErrors, seriesName, realX, computedSD) => {
    const manual = getManualError(manualErrors, seriesName, realX);

    return typeof manual === 'number' ? manual : computedSD;
};

export const setManualError = (manualErrors, seriesName, realX, value) => {
    const currentSeries = manualErrors?.[seriesName] || {};

    return {
        ...(manualErrors || {}),
        [seriesName]: {
            ...currentSeries,
            [concKey(realX)]: value
        }
    };
};

export const clearManualError = (manualErrors, seriesName, realX) => {
    const currentSeries = {
        ...(manualErrors?.[seriesName] || {})
    };

    delete currentSeries[concKey(realX)];

    const next = {
        ...(manualErrors || {})
    };

    if (Object.keys(currentSeries).length === 0) {
        delete next[seriesName];
    } else {
        next[seriesName] = currentSeries;
    }

    return next;
};

export const clearAllManualErrors = (manualErrors, seriesName) => {
    const next = {
        ...(manualErrors || {})
    };

    delete next[seriesName];

    return next;
};

export const mean = (values = []) => {
    if (!values.length) return 0;

    return values.reduce((sum, v) => sum + v, 0) / values.length;
};

export const sampleSD = (values = []) => {
    if (values.length < 2) return 0;

    const m = mean(values);

    const sumSq = values.reduce((sum, v) => {
        return sum + Math.pow(v - m, 2);
    }, 0);

    return Math.sqrt(sumSq / (values.length - 1));
};

export const groupPointsByConcentration = (points = []) => {
    const groups = {};

    points.forEach((point) => {
        if (!isValidPoint(point)) return;

        const key = concKey(point.realX);

        if (!groups[key]) {
            groups[key] = {
                realX: point.realX,
                points: []
            };
        }

        groups[key].points.push(point);
    });

    return groups;
};

export const fitDoseResponse = (visiblePoints = []) => {
    if (!visiblePoints || visiblePoints.length < 3) return null;

    let sumW = 0;

    const fitData = visiblePoints.map((point) => {
        const sd = Number(point.sd) || 0;

        const w = sd > 0 ? 1 / (sd * sd) : 1;

        sumW += w;

        return {
            x: point.realX,
            y: point.y,
            w,
            sd
        };
    });

    if (sumW > 0) {
        fitData.forEach((p) => {
            p.w = (p.w / sumW) * fitData.length;
        });
    }

    return fit4PL(fitData);
};

export const calculatePredictedY = (fit, realX) => {
    if (!fit || !Number.isFinite(fit.ic50) || !Number.isFinite(fit.hill)) return 0;

    return 100 / (1 + Math.pow(realX / fit.ic50, fit.hill));
};

export const calculateAutoTouchSD = (visiblePoints = [], fit) => {
    if (!fit || !visiblePoints.length) return 0;

    let maxResidual = 0;

    visiblePoints.forEach((point) => {
        const predicted = calculatePredictedY(fit, point.realX);
        const residual = Math.abs(point.y - predicted);

        if (residual > maxResidual) {
            maxResidual = residual;
        }
    });

    return Math.ceil((maxResidual * 1.02 + 0.01) * 100) / 100;
};

export const applyAutoTouchToSeries = (manualErrors, processedSeries, seriesName) => {
    const target = processedSeries.find((s) => s.name === seriesName);

    if (!target || !target.fit || !target.visiblePoints?.length) {
        return manualErrors;
    }

    const newSD = calculateAutoTouchSD(target.visiblePoints, target.fit);

    const currentSeries = {
        ...(manualErrors?.[seriesName] || {})
    };

    target.visiblePoints.forEach((point) => {
        currentSeries[concKey(point.realX)] = newSD;
    });

    return {
        ...(manualErrors || {}),
        [seriesName]: currentSeries
    };
};

export const applyAutoTouchAll = (manualErrors, processedSeries) => {
    let next = {
        ...(manualErrors || {})
    };

    processedSeries.forEach((series) => {
        if (!series.fit || !series.visiblePoints?.length) return;

        const newSD = calculateAutoTouchSD(series.visiblePoints, series.fit);

        const currentSeries = {
            ...(next[series.name] || {})
        };

        series.visiblePoints.forEach((point) => {
            currentSeries[concKey(point.realX)] = newSD;
        });

        next[series.name] = currentSeries;
    });

    return next;
};

export const findWorstOutlier = (visiblePoints = [], fit, threshold = 2, fallbackSD = 1) => {
    if (!fit || !visiblePoints || visiblePoints.length < 4) return null;

    let worst = null;
    let maxRatio = 0;

    visiblePoints.forEach((point) => {
        const predicted = calculatePredictedY(fit, point.realX);
        const residual = Math.abs(point.y - predicted);

        const error = point.sd > 0
            ? point.sd
            : fallbackSD > 0
                ? fallbackSD
                : 1;

        const ratio = residual / error;

        if (ratio > threshold && ratio > maxRatio) {
            maxRatio = ratio;
            worst = point;
        }
    });

    return worst;
};

export const detectOutliersForSeries = (processedSeries = [], settings = {}) => {
    const threshold = Number(settings.outlierThreshold) || 2;
    const fallbackSD = Number(settings.fixedSD) || 1;

    const outliers = [];

    processedSeries.forEach((series) => {
        if (!series.fit) return;

        let points = [...series.visiblePoints];
        let fit = series.fit;

        for (let i = 0; i < 20; i++) {
            const worst = findWorstOutlier(points, fit, threshold, fallbackSD);

            if (!worst) break;

            outliers.push({
                seriesName: series.name,
                ...worst
            });

            points = points.filter((p) => p !== worst);

            fit = fitDoseResponse(points);

            if (!fit) break;
        }
    });

    return outliers;
};

export const processSeries = (series = [], options = {}) => {
    const {
        manualErrors = {},
        useFixedSD = false,
        fixedSD = 0,
        fitIC50 = false
    } = options;

    const fixed = Number.isFinite(Number(fixedSD)) ? Number(fixedSD) : 0;

    return (series || []).map((s) => {
        const allPoints = (s.points || []).filter(isValidPoint);

        const includedPoints = allPoints.filter((p) => !p.excluded);
        const excludedPoints = allPoints.filter((p) => p.excluded);

        const includedGroups = groupPointsByConcentration(includedPoints);
        const excludedGroups = groupPointsByConcentration(excludedPoints);

        const visiblePoints = [];

        Object.values(includedGroups).forEach((group) => {
            if (!group.points.length) return;

            const realX = group.points[0].realX;
            const values = group.points.map((p) => p.y);

            const y = mean(values);

            const sdRaw = useFixedSD
                ? fixed
                : sampleSD(values);

            const sd = getEffectiveSD(manualErrors, s.name, realX, sdRaw);

            visiblePoints.push({
                x: Math.log10(realX),
                realX,
                y,
                sdRaw,
                sd,
                pts: group.points
            });
        });

        const excludedVisiblePoints = [];

        Object.values(excludedGroups).forEach((group) => {
            if (!group.points.length) return;

            const realX = group.points[0].realX;
            const values = group.points.map((p) => p.y);

            excludedVisiblePoints.push({
                x: Math.log10(realX),
                realX,
                y: mean(values),
                pts: group.points
            });
        });

        visiblePoints.sort((a, b) => a.x - b.x);
        excludedVisiblePoints.sort((a, b) => a.x - b.x);

        const fit = fitIC50
            ? fitDoseResponse(visiblePoints)
            : null;

        return {
            ...s,
            visiblePoints,
            excludedPoints: excludedVisiblePoints,
            fit
        };
    });
};
