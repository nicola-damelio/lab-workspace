/* =========================================================================
   src/utils/pointTreatment.js
   Shared "curve treatment" helpers mirroring the plate / CD / ssNMR logic:
   manual point exclusion + error-bar SD modes (none / fixed / standard
   deviation of replicates / "touch the curve"). Used by the DOSY and
   NMR-fittings pages so they behave exactly like the plate test page.
   ========================================================================= */

// Sample standard deviation of an array of values (0 if fewer than 2).
export const sampleSD = (values = []) => {
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (nums.length < 2) return 0;
  const m = nums.reduce((s, v) => s + v, 0) / nums.length;
  const sse = nums.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sse / (nums.length - 1));
};

/* ---- Manual point exclusion (per test, stored as { [tableId]: [pointKey] }) ---- */
export const getExcludedMap = (test, field) => (test && test[field]) || {};

export const isPointExcluded = (excluded, tableId, key) =>
  Array.isArray(excluded && excluded[tableId]) && excluded[tableId].includes(key);

export const togglePointExcluded = (excluded, tableId, key) => {
  const list = ((excluded && excluded[tableId]) || []).slice();
  const i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.push(key);
  return { ...(excluded || {}), [tableId]: list };
};

export const clearExcludedForTable = (excluded, tableId) => {
  const next = { ...(excluded || {}) };
  delete next[tableId];
  return next;
};

/* ---- Per-point error-bar SD for the chosen mode ----
   modes: 'none' | 'fixed' | 'sd' | 'touch'
   - fixed : the user-entered value applied to every point
   - sd    : sample SD of the replicate values at this x (e.g. across columns)
   - touch : SD chosen so the error bar just touches the fitted curve
   A per-point manual SD always wins. */
export const computePointSD = ({
  mode = 'none', fixedSD = 0, rowValues = [], manualSD, y = 0, predicted = 0
}) => {
  if (manualSD !== undefined && manualSD !== null && manualSD !== '' &&
      Number.isFinite(Number(manualSD))) {
    return Math.max(0, Number(manualSD));
  }
  if (mode === 'fixed') return Math.max(0, Number(fixedSD) || 0);
  if (mode === 'sd') return sampleSD(rowValues);
  if (mode === 'touch') return Math.max(0, Math.ceil((Math.abs(y - predicted) * 1.02 + 0.01) * 100) / 100);
  return 0;
};
