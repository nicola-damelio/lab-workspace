import { fit4PL, concKey } from '../data/constants';

const parseNumber = (value) => {
    const n = Number(typeof value === 'string' ? value.replace(',', '.') : value);
    return Number.isFinite(n) ? n : 0;
};

const mean = (values = []) => {
    if (!values.length) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const sampleSD = (values = []) => {
    if (values.length < 2) return 0;

    const m = mean(values);

    const sumSq = values.reduce((sum, v) => {
        return sum + Math.pow(v - m, 2);
    }, 0);

    return Math.sqrt(sumSq / (values.length - 1));
};

export const getManualSD = (manualErrors, compound, realX) => {
    if (!manualErrors || !compound) return undefined;

    const compoundErrors = manualErrors[compound];
    if (!compoundErrors) return undefined;

    return compoundErrors[concKey(realX)];
};

export const hasManualSD = (manualErrors, compound, realX) => {
    return typeof getManualSD(manualErrors, compound, realX) === 'number';
};

export const getEffectiveSD = (manualErrors, compound, realX, computedSD) => {
    const manual = getManualSD(manualErrors, compound, realX);
    return typeof manual === 'number' ? manual : computedSD;
};

export const setManualSD = (manualErrors, compound, realX, value) => {
    const current = manualErrors?.[compound] || {};

    return {
        ...(manualErrors || {}),
        [compound]: {
            ...current,
            [concKey(realX)]: value
        }
    };
};

export const clearManualSD = (manualErrors, compound, realX) => {
    const current = {
        ...(manualErrors?.[compound] || {})
    };

    delete current[concKey(realX)];

    const next = {
        ...(manualErrors || {})
    };

    if (Object.keys(current).length === 0) {
        delete next[compound];
    } else {
        next[compound] = current;
    }

    return next;
};

export const clearAllManualSD = (manualErrors, compound) => {
    const next = {
        ...(manualErrors || {})
    };

    delete next[compound];

    return next;
};

export const computeWeightedFit = (vPts = []) => {
    if (!vPts || vPts.length < 3) return null;

    let sumW = 0;

    const fitData = vPts.map((p) => {
        const sd = Number(p.sd) || 0;
        const w = sd > 0 ? 1 / (sd * sd) : 1;

        sumW += w;

        return {
            x: p.realX,
            y: p.y,
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

export const predictedY = (fit, realX) => {
    if (!fit || !Number.isFinite(fit.ic50) || !Number.isFinite(fit.hill)) {
        return 0;
    }

    return 100 / (1 + Math.pow(realX / fit.ic50, fit.hill));
};

export const computeAutoTouchSD = (vPts = [], fit) => {
    if (!fit || !vPts.length) return 0;

    let maxResidual = 0;

    vPts.forEach((pt) => {
        const yFit = predictedY(fit, pt.realX);
        const residual = Math.abs(pt.y - yFit);

        if (residual > maxResidual) {
            maxResidual = residual;
        }
    });

    return Math.ceil((maxResidual * 1.02 + 0.01) * 100) / 100;
};

export const applyAutoTouchForRegionCompound = (
    processedByRegion,
    region,
    compound,
    manualErrors
) => {
    const comps = processedByRegion?.[region] || [];
    const comp = comps.find((c) => c.name === compound);

    if (!comp || !comp.fit || !comp.vPts?.length) {
        return manualErrors;
    }

    const newSD = computeAutoTouchSD(comp.vPts, comp.fit);

    const inner = {
        ...(manualErrors?.[compound] || {})
    };

    comp.vPts.forEach((pt) => {
        inner[concKey(pt.realX)] = newSD;
    });

    return {
        ...(manualErrors || {}),
        [compound]: inner
    };
};

export const applyAutoTouchAll = (processedByRegion, manualErrors) => {
    const next = {
        ...(manualErrors || {})
    };

    Object.entries(processedByRegion || {}).forEach(([region, comps]) => {
        comps.forEach((comp) => {
            if (!comp.fit || !comp.vPts?.length) return;

            const newSD = computeAutoTouchSD(comp.vPts, comp.fit);

            const inner = {
                ...(next[comp.name] || {})
            };

            comp.vPts.forEach((pt) => {
                inner[concKey(pt.realX)] = newSD;
            });

            next[comp.name] = inner;
        });
    });

    return next;
};

export const findOutliers = (
    processedByRegion,
    {
        outlierThreshold = 2.0,
        fixedSD = 0
    } = {}
) => {
    const outliers = [];

    Object.entries(processedByRegion || {}).forEach(([region, comps]) => {
        comps.forEach((comp) => {
            if (!comp.fit || !comp.vPts || comp.vPts.length < 4) return;

            let pts = [...comp.vPts];
            let fit = comp.fit;

            for (let i = 0; i < 20; i++) {
                let worst = null;
                let maxRatio = 0;

                pts.forEach((point) => {
                    const pred = predictedY(fit, point.realX);
                    const residual = Math.abs(point.y - pred);

                    const err = point.sd > 0
                        ? point.sd
                        : fixedSD > 0
                            ? fixedSD
                            : 1;

                    const ratio = residual / err;

                    if (ratio > outlierThreshold && ratio > maxRatio) {
                        maxRatio = ratio;
                        worst = point;
                    }
                });

                if (!worst) break;

                outliers.push({
                    region,
                    compound: comp.name,
                    point: worst
                });

                pts = pts.filter((p) => p !== worst);
                fit = computeWeightedFit(pts);

                if (!fit) break;
            }
        });
    });

    return outliers;
};

/**
 * wells deve essere un array di oggetti tipo:
 *
 * {
 *   region: 'Primary',
 *   compound: 'Compound A',
 *   color: '#2563eb',
 *   realX: 10,
 *   y: 87.5,
 *   excluded: false,
 *   r: 3,
 *   c: 5
 * }
 *
 * r e c sono opzionali, ma utili se poi vuoi collegare i punti
 * ai wells della piastra.
 */
export const computePlateFitting = ({
    wells = [],
    manualErrors = {},
    useFixedSD = false,
    fixedSD = 0,
    fitIC50 = false
}) => {
    const fixed = parseNumber(fixedSD);

    const grouped = {};

    wells.forEach((w) => {
        if (!w) return;

        const region = w.region || 'Primary';
        const compound = w.compound;

        const realX = Number(w.realX);
        const y = Number(w.y);

        if (!compound) return;
        if (!Number.isFinite(realX) || realX <= 0) return;
        if (!Number.isFinite(y)) return;

        const key = `${region}||${compound}`;

        if (!grouped[key]) {
            grouped[key] = {
                region,
                compound,
                color: w.color || '#2563eb',
                points: []
            };
        }

        grouped[key].points.push({
            realX,
            y,
            excluded: !!w.excluded,
            r: w.r,
            c: w.c
        });
    });

    const result = {};

    Object.values(grouped).forEach((group) => {
        const byX = {};

        group.points.forEach((p) => {
            const k = concKey(p.realX);

            if (!byX[k]) {
                byX[k] = {
                    inc: [],
                    excl: []
                };
            }

            if (p.excluded) {
                byX[k].excl.push(p);
            } else {
                byX[k].inc.push(p);
            }
        });

        const vPts = [];
        const ePts = [];

        Object.values(byX).forEach((g) => {
            if (!g.inc.length && !g.excl.length) return;

            const rep = g.inc[0] || g.excl[0];
            const realX = rep.realX;
            const x = Math.log10(realX);

            if (g.inc.length > 0) {
                const values = g.inc.map((p) => p.y);

                const y = mean(values);

                const sdRaw = useFixedSD
                    ? fixed
                    : sampleSD(values);

                const sd = getEffectiveSD(
                    manualErrors,
                    group.compound,
                    realX,
                    sdRaw
                );

                vPts.push({
                    x,
                    realX,
                    y,
                    sd,
                    sdRaw,
                    pts: g.inc
                });
            }

            if (g.excl.length > 0) {
                const values = g.excl.map((p) => p.y);

                ePts.push({
                    x,
                    realX,
                    y: mean(values),
                    pts: g.excl
                });
            }
        });

        vPts.sort((a, b) => a.x - b.x);
        ePts.sort((a, b) => a.x - b.x);

        if (vPts.length === 0 && ePts.length === 0) return;

        const fit = fitIC50
            ? computeWeightedFit(vPts)
            : null;

        if (!result[group.region]) {
            result[group.region] = [];
        }

        result[group.region].push({
            name: group.compound,
            color: group.color,
            vPts,
            ePts,
            fit
        });
    });

    return result;
};
