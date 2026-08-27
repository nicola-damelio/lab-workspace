/* =========================================================================
   src/utils/starredItems.js

   "Import into the project document" starring + Materials & Methods builder.

   A user opens a test page and ⭐-marks the figures, plots and tables that
   should be imported into the project's 📄 Export document. The project
   document imports ONLY those starred items (plus the auto-generated
   Materials & Methods text) — not the full Lab Notebook content.

   Starred items live on the test itself:
     test.starredItems = [{ id, kind, label, caption, url?, columns?, rows? }]
   and are persisted with the test (tests are already saved to localStorage).
   ========================================================================= */
import {
  PLATE_TAB_CONFIG, NMR_TAB_CONFIG, NMR_FITTING_TAB_CONFIG, DOSY_TAB_CONFIG,
  MD_SIMULATION_TAB_CONFIG, CD_TAB_CONFIG, SSNMR_TAB_CONFIG, CLONING_TAB_CONFIG,
  PROTEIN_EXPRESSION_TAB_CONFIG, FLOW_CYTOMETRY_TAB_CONFIG
} from '../components/tabConfigs';

// Map a test's `type` to its tab config (used for the Experimental Conditions
// field labels in the Materials & Methods generator).
export const tabConfigForType = (type = '') => {
  const t = String(type || '');
  if (t.startsWith('plate-')) return PLATE_TAB_CONFIG;
  switch (t) {
    case 'nmr': return NMR_TAB_CONFIG;
    case 'nmr-fittings': return NMR_FITTING_TAB_CONFIG;
    case 'dosy': return DOSY_TAB_CONFIG;
    case 'md':
    case 'md_simulation': return MD_SIMULATION_TAB_CONFIG;
    case 'cd': return CD_TAB_CONFIG;
    case 'ssnmr': return SSNMR_TAB_CONFIG;
    case 'cloning': return CLONING_TAB_CONFIG;
    case 'protein_expression': return PROTEIN_EXPRESSION_TAB_CONFIG;
    case 'flow_cytometry': return FLOW_CYTOMETRY_TAB_CONFIG;
    default: return null;
  }
};

export const getStarredItems = (test) => (
  Array.isArray(test && test.starredItems) ? test.starredItems : []
);

export const isStarred = (test, id) =>
  getStarredItems(test).some((s) => s && s.id === id);

// Pure: returns the next `starredItems` array for a test (caller persists it
// via updateActiveTest / update).
export const toggleStarredItem = (test, item) => {
  const stars = getStarredItems(test);
  return stars.some((s) => s && s.id === item.id)
    ? stars.filter((s) => s && s.id !== item.id)
    : [...stars, item];
};

/* =========================================================================
   MATERIALS & METHODS — automatic narrative
   Merges "Experimental Conditions", "Instrumental Setup" and "Experiment
   Setup" information of a test into one descriptive text paragraph.
   ========================================================================= */
const clean = (v) => (
  v === undefined || v === null ||
  (typeof v === 'string' && v.trim() === '') ? ''
    : typeof v === 'string' ? v.trim() : String(v)
);

export const buildMaterialsAndMethods = (test = {}, cfg = null) => {
  const t = test;
  const sentences = [];

  // 1) Sample / system studied (Experiment Setup).
  const compounds = [...new Set([
    ...(t.selectedCompounds || []),
    ...(t.compoundsSelected || []),
    ...(t.compound ? String(t.compound).split(',') : [])
  ])].map((s) => String(s || '').trim()).filter(Boolean);
  const sample = compounds.length
    ? compounds.join(', ')
    : (t.moleculeName || t.sampleName || 'The sample');
  const typeLabel = (cfg && cfg.typeLabel) || '';

  let opening = sample;
  if (t.name && t.name.trim()) opening += ` ("${t.name.trim()}")`;
  opening += ' was studied';
  if (typeLabel) opening += ` by ${typeLabel}`;
  if (t.testCategory && t.secondaryCategory) opening += ` (${t.testCategory} / ${t.secondaryCategory})`;
  else if (t.testCategory) opening += ` (${t.testCategory})`;
  if (t.experimentDate) opening += ` on ${t.experimentDate}`;
  if (t.operator) opening += ` by ${t.operator}`;
  opening += '.';
  sentences.push(opening);

  // 2) Experimental conditions.
  const condParts = [];
  const seen = new Set();
  const pushCond = (label, value, unit) => {
    const v = clean(value);
    if (!v) return;
    const key = String(label).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    condParts.push(`${label} = ${v}${unit ? ' ' + unit : ''}`);
  };
  (cfg && Array.isArray(cfg.conditionFields) ? cfg.conditionFields : []).forEach((f) => {
    if (!f || !f.key) return;
    const val = t[f.key];
    if (val === undefined || val === null) return;
    const unit = clean(t[`${f.key}Unit`]) ||
      (Array.isArray(f.units) && f.units.length ? f.units[0] : '');
    pushCond(f.label, val, unit);
  });
  if (Array.isArray(t.cellLines) && t.cellLines.length) pushCond('cell lines', t.cellLines.join(', '));
  if (t.buffer) pushCond('buffer', t.buffer);
  if (t.otherMolecule) pushCond('other molecule', t.otherMolecule);
  if (t.otherConditions) pushCond('other conditions', t.otherConditions);
  if (condParts.length) sentences.push(`Experimental conditions: ${condParts.join('; ')}.`);

  // 3) Instrumental setup.
  const inst = [];
  if (t.instrument) inst.push(`a ${clean(t.instrument)} instrument`);
  if (t.spectrometerFrequency) inst.push(`${clean(t.spectrometerFrequency)} MHz`);
  else if (t.spectrometer) inst.push(`${clean(t.spectrometer)} MHz`);
  if (t.probe) inst.push(`a ${clean(t.probe)} probe`);
  if (t.pulseProgram) inst.push(`the ${clean(t.pulseProgram)} pulse program`);
  if (t.temperature && !seen.has('temperature')) {
    const tu = clean(t.temperatureUnit) || 'K';
    inst.push(`at ${clean(t.temperature)} ${tu}`);
  }
  if (inst.length) sentences.push(`Data were recorded on ${inst.join(', ')}.`);

  // 4) DOSY gradient parameters (Instrumental Setup → Experiment setup).
  if (t.type === 'dosy' || t.dosyMaxG || t.dosyDelta) {
    const gammaVal = Number(t.dosyGamma) > 0 ? Number(t.dosyGamma) : 2.6752218744e8;
    sentences.push(
      `DOSY experiments were performed with a maximum gradient of ${t.dosyMaxG || 60} G/cm, ` +
      `a diffusion time Δ of ${t.dosyDelta || 50} ms, a gradient duration δ of ${t.dosySmallDelta || 2} ms ` +
      `and a gyromagnetic ratio γ of ${gammaVal.toExponential(4)} rad/(s·T).`
    );
  }

  return sentences.join(' ');
};

