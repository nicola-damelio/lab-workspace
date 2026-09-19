// ============================================================================
// CDSections.jsx
// Circular Dichroism page: Data · Data Analysis (spectra, fitter, condition
// plots) · Simulations.
// ============================================================================

import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, BarChart, Bar, LineChart, Line, Legend, ErrorBar, Cell, PieChart, Pie, ComposedChart
} from 'recharts';
import { SharedErrorTreatment, ChartControlBar, SharedChartStylePanel, ChartInspector, brokenAxisProps, AngledTick, useXYZoom, cfgSeriesEl, cfgLogScale, cfgAxisTicks, cfgAxisDomain, cfgTickFormatter, cfgAxisLabel, cfgChartMargin, errorBarRange, instancesLinked, InstanceLinkToggle, deferredClick } from './SharedAnalysisTools';
import { CollapsibleSection } from './ui';
import { FS_CLASSES, OVERLAY_CLASSES, CHART_MARGIN, VIS_PALETTES, seriesColorFor, chartBoxStyle, chartRatioBoxStyle, seriesPointStyle, seriesPtSize, seriesLineThickness, seriesDash, seriesLabelOf, tickTextProps, tickSize, fontFamilyOf, legendTextStyle, axisTitleSize, tickColorOf
} from '../utils/chartStyle';
import { SplitChartStack, SplitLayoutControls, SplitToggle, splitRowBoxStyle, splitChartClass, splitChartMargin, splitLayoutOf, splitXAxisHidden, splitYAxisProps, withSplitLayout, hiddenSeriesOf, withoutSeries } from './SplitChartStack';
import { parseJascoJwsBinary, isJascoJwsBinary } from '../utils/jascoJws';
import { DriveUploadButton } from './DriveUpload';
import { suggestDriveFileName } from '../utils/driveNaming';
import { uploadLocalFile, withExtension, getDriveToken } from '../utils/driveUpload';
export { CollapsibleSection };
export { VIS_PALETTES };

const HAS_EB = typeof ErrorBar !== 'undefined';

/* ========================================================================
LAYOUT / STYLE CONSTANTS
======================================================================== */
/* Chart/style constants (FS_CLASSES, OVERLAY_CLASSES, CHART_MARGIN, VIS_PALETTES)
   now live in ../utils/chartStyle. */

const SPECTRA_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#06b6d4',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#10b981'
];

/* CollapsibleSection now lives in ./ui (single shared definition). */
// Chart/style constants (FS_CLASSES, OVERLAY_CLASSES, CHART_MARGIN, VIS_PALETTES)
// now live in ../utils/chartStyle.

/* ========================================================================
GENERIC PARSING HELPERS
======================================================================== */
const parseManual = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const parseXValue = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim();
  if (s === '') return NaN;
  const ratio = s.match(/^(-?\d+(?:[.,]\d+)?)\s*:\s*(-?\d+(?:[.,]\d+)?)$/);
  if (ratio) {
    const a = parseFloat(ratio[1].replace(',', '.'));
    const b = parseFloat(ratio[2].replace(',', '.'));
    if (!isNaN(a) && !isNaN(b) && b !== 0) return a / b;
  }
  return parseFloat(s.replace(',', '.'));
};

const makeId = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/* ========================================================================
EXPERIMENTAL-CONDITION FIELDS (CD)
======================================================================== */
export const CD_EXPERIMENTAL_FIELDS = [
  // Default unit is units[0] — µM is the default concentration unit, Kelvin the default temperature unit.
  { key: 'concentration', label: 'Concentration', unitKey: 'concentrationUnit', units: ['µM', 'mg/mL', 'mM', 'M', 'nM'] },
  { key: 'temperature', label: 'Temperature', unitKey: 'temperatureUnit', units: ['K', '°C'] },
  { key: 'ph', label: 'pH', unitKey: '' },
  { key: 'saltConcentration', label: 'Salt Concentration', unitKey: 'saltConcentrationUnit', units: ['mM', 'M'] },
  { key: 'pathLength', label: 'Cuvette Path Length', unitKey: 'pathLengthUnit', units: ['mm', 'cm'] },
  { key: 'ratio', label: 'Molar Ratio', unitKey: '' },
  { key: 'solvent', label: 'Solvent', unitKey: '', type: 'solvent-select' },
  // NOTE: buffer/additive are rendered by the shared <BufferAdditiveFields>
  // component (TestShellRenderer.jsx / DefinitionsExtra.jsx), which stores them
  // as bufferName/additiveName (+ Conc/Unit) — NOT buffer/additive. These entries
  // just let CD's condition-plot "variables", warnings, and notebook export read
  // the same values, they don't render their own input.
  { key: 'bufferName', label: 'Buffer', unitKey: '' },
  { key: 'additiveName', label: 'Additive', unitKey: '' },
  { key: 'otherMolecule', label: 'Other Molecule / Ligand', unitKey: '' }
];

// Default unit per field key (units[0]), exposed for consumers (e.g. CDTestRenderer)
// that need to pre-fill a new condition's *Unit fields.
export const CD_DEFAULT_UNITS = CD_EXPERIMENTAL_FIELDS.reduce((acc, f) => {
  if (f.unitKey && Array.isArray(f.units) && f.units.length) acc[f.unitKey] = f.units[0];
  return acc;
}, {});

// CD-spectrometer-specific instrumental setup fields (see InstrumentalSetup section below).
export const CD_INSTRUMENTAL_FIELDS = [
  { key: 'instrumentModel', label: 'Instrument Model', type: 'text', placeholder: 'e.g. Jasco J-1500' },
  { key: 'scanMode', label: 'Scan Mode', type: 'select', options: ['Continuous Scan', 'Step Scan'] },
  { key: 'scanSpeed', label: 'Scan Speed', type: 'text', placeholder: 'e.g. 20', units: ['nm/min'] },
  { key: 'dataPitch', label: 'Data Pitch', type: 'text', placeholder: 'e.g. 0.5', units: ['nm'] },
  { key: 'bandwidth', label: 'Bandwidth', type: 'text', placeholder: 'e.g. 1', units: ['nm'] },
  { key: 'responseTime', label: 'Response Time (D.I.T.)', type: 'text', placeholder: 'e.g. 2', units: ['sec', 'msec'] },
  { key: 'accumulations', label: 'Accumulations', type: 'number', placeholder: 'e.g. 3' },
  { key: 'sensitivity', label: 'Sensitivity (full scale)', type: 'text', placeholder: 'e.g. 200', units: ['mdeg'] },
  { key: 'photometricMode', label: 'Photometric Mode', type: 'text', placeholder: 'e.g. CD, HT, Abs' },
  { key: 'detectorHT', label: 'Detector HT Voltage', type: 'text', placeholder: 'e.g. 400', units: ['V'] },
  { key: 'purgeGas', label: 'N₂ Purge Flow', type: 'text', placeholder: 'e.g. 5', units: ['L/min'] },
  { key: 'cellType', label: 'Cell Type / Material', type: 'select', options: ['Quartz cuvette', 'Demountable cell', 'Strain-free cell', 'Other'] }
];

const getExpValue = (inst, key) => {
  const t = inst?.test || inst || {};
  if (t[key] !== undefined && t[key] !== null && t[key] !== '') return t[key];
  if (t.exp && t.exp[key] !== undefined && t.exp[key] !== '') return t.exp[key];
  if (t.expValues && t.expValues[key] !== undefined && t.expValues[key] !== '') return t.expValues[key];
  return '';
};

const getExpUnit = (inst, field) => {
  if (!field.unitKey) return '';
  const t = inst?.test || inst || {};
  return t[field.unitKey] || '';
};

/* ========================================================================
INSTANCES (top-of-page condition tabs)
======================================================================== */
const normalizeInstance = (t, idx) => ({
  id: t.id || `inst_${idx}`,
  name: t.instanceName || t.name || `Instance ${idx + 1}`,
  test: t
});

const getInstances = (ctx, activeTest) => {
  let list = null;
  // "Single instance" mode (the Instances linked toggle is OFF): show only the
  // active instance everywhere.
  if (instancesLinked(activeTest)) {
    if (ctx) {
      if (typeof ctx.getInstances === 'function') {
        try { list = ctx.getInstances(); } catch { list = null; }
      }
      if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
      if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
      if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
        const all = ctx.tests || ctx.allTests;
        list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
      }
    }
  }
  if (!list || !list.length) list = [activeTest];
  let insts = list.filter(Boolean).map(normalizeInstance);
  insts = insts.map((inst) =>
    inst.id === activeTest.id ? normalizeInstance(activeTest, 0) : inst
  );
  if (!insts.some((i) => i.id === activeTest.id)) insts.unshift(normalizeInstance(activeTest, 0));
  insts.sort((a, b) => String(a.test.date || '').localeCompare(String(b.test.date || '')));
  return insts;
};

const patchInstance = (ctx, activeTest, instId, updates) => {
  if (typeof ctx?.updateInstance === 'function') {
    ctx.updateInstance(instId, updates);
    return;
  }
  if (instId === activeTest.id) ctx.updateActiveTest(updates);
};

/* ========================================================================
SPECTRA STORAGE MODEL
======================================================================== */
const computeParsed = (source) => {
  const src = source || {};
  const wavelengthData = src.wavelengthData || '';
  const spectraColumns = src.spectraColumns || [];
  const parsedWavelengths = wavelengthData
    .split(/[\n,\s]+/)
    .map((s) => parseFloat(String(s).trim()))
    .filter((n) => !isNaN(n));
  const parsedSpectra = spectraColumns.map((col, idx) => {
    const values = (col.data || '')
      .split(/[\n,]+/)
      .map((s) => parseFloat(String(s).trim()))
      .filter((n) => !isNaN(n));
    return {
      ...col,
      values,
      color: col.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length]
    };
  });
  return { parsedWavelengths, parsedSpectra };
};

const valueAtWavelength = (parsed, specIdx, lambda) => {
  const spec = parsed.parsedSpectra[specIdx];
  if (!spec || !parsed.parsedWavelengths.length) return null;
  const pairs = parsed.parsedWavelengths
    .map((x, i) => ({ x, y: spec.values[i] }))
    .filter((p) => Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (!pairs.length) return null;
  if (lambda <= pairs[0].x) return pairs[0].y;
  if (lambda >= pairs[pairs.length - 1].x) return pairs[pairs.length - 1].y;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (lambda >= pairs[i].x && lambda <= pairs[i + 1].x) {
      const span = pairs[i + 1].x - pairs[i].x || 1;
      const t = (lambda - pairs[i].x) / span;
      return pairs[i].y + t * (pairs[i + 1].y - pairs[i].y);
    }
  }
  return null;
};

/* ========================================================================
JASCO FILE PARSER
======================================================================== */
const parseJascoDate = (value) => {
  if (!value) return '';
  const s = String(value).trim().replace(/^["']|["']$/g, '');
  let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{2})$/);
  if (m) {
    const p1 = parseInt(m[1], 10);
    // If the first digit is >12, it must be DD/MM/YY format (e.g. 25/06/06)
    return p1 > 12 ? `20${m[3]}-${m[2]}-${m[1]}` : `20${m[1]}-${m[2]}-${m[3]}`;
  }
  return '';
};

const parseJascoCDText = (text) => {
  if (!text) return { xs: [], ys: [], meta: {} };
  
  const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleanText.split('\n');
  
  const meta = {};
  let xs = [];
  let ys = [];
  let inData = false;

  const storeMeta = (key, value) => {
    const k = String(key).trim().replace(/^"|"$/g, '');
    const v = String(value ?? '').trim().replace(/^"|"$/g, '');
    if (k && !/^[-+]?\d/.test(k)) meta[k] = v;
  };

  // Parses a single XY data row, supporting:
  //   - dot decimals, comma/tab/semicolon/space separated ("260, -1.234")
  //   - European comma decimals with semicolon/space separators ("185,0; -10,5")
  const parseJascoDataLine = (line) => {
    const body = line.replace(/^"|"$/g, '').trim();
    if (!body) return null;
    // European style: comma sits between digits (decimal point) and another
    // non-comma separator (space / tab / semicolon) is present in the same line.
    if (/(?:\d,\d)/.test(body) && /[;\t ]/.test(body)) {
      const toks = body.replace(/,/g, '.').split(/[;\t ]+/).filter(Boolean);
      if (toks.length >= 2) {
        const x = parseFloat(toks[0]);
        const y = parseFloat(toks[1]);
        if (!isNaN(x) && !isNaN(y)) return [x, y];
      }
    }
    const toks = body.split(/[,\t;\s]+/).filter(Boolean);
    if (toks.length >= 2) {
      const x = parseFloat(toks[0]);
      const y = parseFloat(toks[1]);
      if (!isNaN(x) && !isNaN(y)) return [x, y];
    }
    return null;
  };

  const addMeta = (line) => {
    if (!line) return;
    const raw = line.trim();

    // 0. Fully-quoted CSV line: "Key","Value"  (standard JASCO Spectra Manager export)
    const csv = raw.match(/^"([^"]*)"\s*,\s*"([^"]*)"\s*$/);
    if (csv) { storeMeta(csv[1], csv[2]); return; }

    const unquoted = raw.replace(/^"|"$/g, '');

    // 1. Try Tab
    if (unquoted.includes('\t')) {
      const parts = unquoted.split('\t');
      storeMeta(parts[0], parts.slice(1).join('\t'));
      return;
    }
    // 2. Try Comma (split at first comma, then strip any surrounding quotes)
    if (unquoted.includes(',')) {
      const idx = unquoted.indexOf(',');
      storeMeta(unquoted.slice(0, idx), unquoted.slice(idx + 1));
      return;
    }
    // 2b. Try Semicolon (some European JASCO exports use "Key;Value")
    if (unquoted.includes(';')) {
      const idx = unquoted.indexOf(';');
      storeMeta(unquoted.slice(0, idx), unquoted.slice(idx + 1));
      return;
    }
    // 3. Try Equals ("Key = Value", used by some JASCO report exports)
    const eq = unquoted.match(/^([^=]{1,60}?)\s*=\s*(.+)$/);
    if (eq) { storeMeta(eq[1], eq[2]); return; }
    // 4. Try Colon (some European Jasco exports)
    if (unquoted.includes(':')) {
      const idx = unquoted.indexOf(':');
      storeMeta(unquoted.slice(0, idx), unquoted.slice(idx + 1));
      return;
    }
    // 5. Try multiple spaces
    const m = unquoted.match(/^([A-Za-z0-9/.()\- ]{2,60}?)\s{2,}(.*)$/);
    if (m && !/^\d/.test(m[1])) { meta[m[1].trim()] = m[2].trim(); }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    if (line.startsWith('#####')) { inData = false; continue; }
    if (/^\[?\s*(?:XYDATA|DATA)\s*\]?$/i.test(line.replace(/["']/g, ''))) { inData = true; continue; }
    if (line.startsWith('[') && line.endsWith(']')) continue;
    
    const pair = parseJascoDataLine(line);
    if (pair) {
      xs.push(pair[0]);
      ys.push(pair[1]);
      continue;
    }
    
    if (!inData) addMeta(line);
  }
  
  if (xs.length > 1 && xs[0] > xs[xs.length - 1]) { 
    xs.reverse(); 
    ys.reverse(); 
  }

  const tempRaw = (meta['Temperature'] || meta['Temperature (°C)'] || meta['Temperature (C)'] || '').trim();
  const tempNum = tempRaw.match(/(-?\d+(?:[.,]\d+)?)/);
  const pathRaw = (meta['Cell length'] || meta['Pathlength'] || meta['Path length'] || '').trim();
  const pathNum = pathRaw.match(/(-?\d+(?:[.,]\d+)?)/);
  const concRaw = (meta['Concentration'] || meta['Conc.'] || meta['Concn'] || '').trim();

  let concentrationUnit = '';
  if (/mg\/ml/i.test(concRaw)) concentrationUnit = 'mg/mL';
  else if (/nM\b/i.test(concRaw)) concentrationUnit = 'nM';
  else if (/mM\b/i.test(concRaw)) concentrationUnit = 'mM';
  else if (/[µu]M\b/i.test(concRaw)) concentrationUnit = 'µM';
  else if (/^M$/.test(concRaw.trim())) concentrationUnit = 'M';

  return {
    xs, ys, meta,
    title: meta['Sample name'] || meta['TITLE'] || meta['Sample Name'] || meta['Title'] || meta['sample'] || '',
    experimentDate: parseJascoDate(meta['Measurement date'] || meta['DATE'] || meta['Date'] || ''),
    temperature: tempNum ? tempNum[1].replace(',', '.') : '',
    temperatureUnit: /(°?C|℃)\s*$/i.test(tempRaw) ? '°C' : /K\s*$/i.test(tempRaw) ? 'K' : '',
    pathLength: pathNum ? pathNum[1].replace(',', '.') : '',
    pathLengthUnit: /cm\b/i.test(pathRaw) ? 'cm' : /mm\b/i.test(pathRaw) ? 'mm' : '',
    concentration: concRaw,
    concentrationUnit
  };
};

/* ========================================================================
MOLAR ELLIPTICITY
======================================================================== */
const concentrationToMgPerMl = (concStr, unit, mw) => {
  const c = parseManual(concStr);
  if (c === null) return null;
  const u = String(unit || 'mg/mL');
  if (u === 'mg/mL') return c;
  if (!mw) return null;
  if (u === 'µM' || u === 'uM') return c * 1e-6 * mw;
  if (u === 'mM') return c * 1e-3 * mw;
  if (u === 'M') return c * mw;
  return c;
};

const pathLengthToCm = (vStr, unit) => {
  const v = parseManual(vStr);
  if (v === null) return null;
  return String(unit || 'cm') === 'mm' ? v / 10 : v;
};

// Δε = [θ] / 3298.2  (mdeg → molar circular dichroism, M⁻¹·cm⁻¹)
const THETA_TO_DELTA_EPS = 3298.2;

// All supported post-conversion units (stored in test.thetaMode)
const CD_THETA_MODES = ['molar', 'mre', 'deps', 'depsRes'];
const CD_THETA_NEEDS_N = ['mre', 'depsRes'];

// Conversion factor (× mdeg) for the selected unit:
//   molar    [θ]_M   = mdeg × MW/(10·c·l)
//   mre      [θ]_R   = mdeg × MW/(10·c·l·N)
//   deps     Δε      = mdeg × MW/(3298.2·10·c·l)
//   depsRes  Δε/res  = mdeg × MW/(3298.2·10·c·l·N)
const cdConversionFactor = (inst, mw, residues, modeOverride) => {
  const t = inst?.test || inst || {};
  const mode = CD_THETA_MODES.includes(modeOverride)
    ? modeOverride
    : CD_THETA_MODES.includes(t.thetaMode) ? t.thetaMode : 'mre';
  const cMg = concentrationToMgPerMl(t.concentration, t.concentrationUnit, mw);
  const lCm = pathLengthToCm(t.pathLength, t.pathLengthUnit);
  if (!cMg || !lCm || !mw) return null;
  const n = parseInt(residues, 10);
  const hasN = Number.isFinite(n) && n > 0;
  const base = mw / (10 * cMg * lCm); // molar ellipticity factor (deg·cm²·dmol⁻¹ per mdeg)
  switch (mode) {
    case 'mre': return hasN ? base / n : null;
    case 'deps': return base / THETA_TO_DELTA_EPS;
    case 'depsRes': return hasN ? base / (THETA_TO_DELTA_EPS * n) : null;
    case 'molar':
    default: return base;
  }
};

// Scale factor that converts a reference value in MRE [θ]_R (deg·cm²·dmol⁻¹
// per residue) into the experimental unit given by thetaMode. Used by the
// fitters so the reconstruction and scaleK are expressed in the chosen unit.
const cdUnitScale = (mode, residues) => {
  const n = parseInt(residues, 10);
  const hasN = Number.isFinite(n) && n > 0;
  switch (mode) {
    case 'molar': return hasN ? n : 1;
    case 'deps': return hasN ? n / THETA_TO_DELTA_EPS : 1 / THETA_TO_DELTA_EPS;
    case 'depsRes': return 1 / THETA_TO_DELTA_EPS;
    case 'mre':
    default: return 1;
  }
};

// Number of amino-acid residues / nucleotides used by the per-residue units.
// Manual override first, then the compound's sequence length (if defined).
const getResidueCount = (inst, ctx) => {
  const t = inst?.test || inst || {};
  const manual = parseInt(t.manualResidues, 10);
  if (Number.isFinite(manual) && manual > 0) return manual;
  const meta = ctx?.compoundMeta || {};
  const cmps =
    Array.isArray(t.selectedCompounds) && t.selectedCompounds.length
      ? t.selectedCompounds
      : t.compound
        ? [t.compound]
        : [];
  for (const c of cmps) {
    const n = Number(meta[c]?.length);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

// Where the residue count comes from ('manual' | compound name | null)
const residueCountSource = (inst, ctx) => {
  const t = inst?.test || inst || {};
  if (parseInt(t.manualResidues, 10) > 0) return 'manual';
  const meta = ctx?.compoundMeta || {};
  const cmps =
    Array.isArray(t.selectedCompounds) && t.selectedCompounds.length
      ? t.selectedCompounds
      : t.compound
        ? [t.compound]
        : [];
  for (const c of cmps) {
    const n = Number(meta[c]?.length);
    if (Number.isFinite(n) && n > 0) return c;
  }
  return null;
};

// The theta mode actually used to produce the stored spectra. Legacy spectra
// converted before thetaMode existed were computed with the full MW → molar
// ellipticity, so the default for DISPLAY is 'molar'.
const thetaModeOf = (test) => {
  const m = test && test.thetaMode;
  return CD_THETA_MODES.includes(m) ? m : 'molar';
};
const thetaUnitLabel = (mode) => ({
  molar: 'Molar Ellipticity [θ] (deg·cm²·dmol⁻¹)',
  mre: 'Mean Residue Ellipticity [θ] (deg·cm²·dmol⁻¹)',
  deps: 'Molar circular dichroism Δε (M⁻¹·cm⁻¹)',
  depsRes: 'Mean-residue circular dichroism Δε (M⁻¹·cm⁻¹)'
}[mode] || 'Molar Ellipticity [θ] (deg·cm²·dmol⁻¹)');
const thetaUnitShort = (mode) => ({
  molar: 'Molar [θ] (deg·cm²·dmol⁻¹)',
  mre: 'MRE [θ] (deg·cm²·dmol⁻¹)',
  deps: 'Δε (M⁻¹·cm⁻¹)',
  depsRes: 'Δε/res (M⁻¹·cm⁻¹)'
}[mode] || 'Molar [θ] (deg·cm²·dmol⁻¹)');
const thetaUnitTag = (mode) => ({ molar: '[θ]ₘ', mre: '[θ]ᵣ', deps: 'Δε', depsRes: 'Δεᵣ' }[mode] || '[θ]');

const getCompoundMW = (inst, ctx) => {
  const t = inst?.test || inst || {};
  const meta = ctx?.compoundMeta || {};
  const cmps =
    Array.isArray(t.selectedCompounds) && t.selectedCompounds.length
      ? t.selectedCompounds
      : t.compound
        ? [t.compound]
        : [];
  for (const c of cmps) {
    const mw = meta[c]?.molecularWeight;
    if (mw) {
      const n = Number(mw);
      if (Number.isFinite(n) && n > 0) return { value: n, compound: c };
    }
  }
  return null;
};

const getMWForInstance = (inst, ctx) => {
  const t = inst?.test || inst || {};
  const manual = parseManual(t.manualMW);
  if (manual && manual > 0) return manual;
  const fromCompound = getCompoundMW(inst, ctx);
  return fromCompound ? fromCompound.value : null;
};

/* ========================================================================
NATURAL CUBIC SPLINE
======================================================================== */
class NaturalCubicSpline {
  constructor(xs, ys) {
    this.xs = xs; this.ys = ys; this.n = xs.length;
    this.a = ys.slice();
    this.b = new Array(this.n).fill(0);
    this.c = new Array(this.n).fill(0);
    this.d = new Array(this.n).fill(0);
    this.calculateCoefficients();
  }
  calculateCoefficients() {
    const h = [];
    for (let i = 0; i < this.n - 1; i++) h.push(this.xs[i + 1] - this.xs[i]);
    const alpha = new Array(this.n - 1).fill(0);
    for (let i = 1; i < this.n - 1; i++) {
      alpha[i] = (3 / h[i]) * (this.a[i + 1] - this.a[i]) - (3 / h[i - 1]) * (this.a[i] - this.a[i - 1]);
    }
    const l = new Array(this.n).fill(0);
    const mu = new Array(this.n).fill(0);
    const z = new Array(this.n).fill(0);
    l[0] = 1;
    for (let i = 1; i < this.n - 1; i++) {
      l[i] = 2 * (this.xs[i + 1] - this.xs[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    l[this.n - 1] = 1;
    for (let j = this.n - 2; j >= 0; j--) {
      this.c[j] = z[j] - mu[j] * this.c[j + 1];
      this.b[j] = (this.a[j + 1] - this.a[j]) / h[j] - (h[j] * (this.c[j + 1] + 2 * this.c[j])) / 3;
      this.d[j] = (this.c[j + 1] - this.c[j]) / (3 * h[j]);
    }
  }
  at(x) {
    let i = 0;
    if (x >= this.xs[this.n - 1]) i = this.n - 2;
    else if (x <= this.xs[0]) i = 0;
    else {
      let low = 0, high = this.n - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.xs[mid] < x) low = mid + 1; else high = mid - 1;
      }
      i = Math.max(0, high);
    }
    if (i >= this.n - 1) i = this.n - 2;
    const dx = x - this.xs[i];
    return this.a[i] + this.b[i] * dx + this.c[i] * dx * dx + this.d[i] * dx * dx * dx;
  }
}

/* ========================================================================
CD SECONDARY-STRUCTURE REFERENCE SPECTRA (PROTEIN & DNA/GQ)
======================================================================== */
const alphaKnots = [{ x: 176, y: 12000 }, { x: 180, y: 22000 }, { x: 185, y: 48000 }, { x: 190, y: 66000 }, { x: 192, y: 65000 }, { x: 195, y: 55000 }, { x: 200, y: 20000 }, { x: 203, y: 0 }, { x: 205, y: -15000 }, { x: 208, y: -32000 }, { x: 215, y: -29000 }, { x: 222, y: -35000 }, { x: 230, y: -20000 }, { x: 240, y: -2000 }, { x: 250, y: 0 }, { x: 260, y: 0 }];
const betaKnots = [{ x: 176, y: -10000 }, { x: 180, y: -8000 }, { x: 185, y: -4000 }, { x: 190, y: 2000 }, { x: 196, y: 12000 }, { x: 205, y: 4000 }, { x: 210, y: 0 }, { x: 217, y: -5000 }, { x: 225, y: -4000 }, { x: 240, y: -500 }, { x: 260, y: 0 }];
const turnKnots = [{ x: 176, y: 0 }, { x: 185, y: 10000 }, { x: 193, y: 20000 }, { x: 200, y: 8000 }, { x: 203, y: 0 }, { x: 210, y: -10500 }, { x: 220, y: -8000 }, { x: 230, y: -4000 }, { x: 245, y: 0 }, { x: 260, y: 0 }];
const coilKnots = [{ x: 176, y: -5000 }, { x: 185, y: 0 }, { x: 187, y: 2000 }, { x: 190, y: 0 }, { x: 198, y: -16000 }, { x: 212, y: -2000 }, { x: 220, y: 1000 }, { x: 230, y: 1500 }, { x: 245, y: 0 }, { x: 260, y: 0 }];
const bDnaKnots = [{ x: 180, y: -10 }, { x: 184, y: 30 }, { x: 187, y: 65 }, { x: 192, y: 40 }, { x: 195, y: 15 }, { x: 200, y: -5 }, { x: 205, y: -10 }, { x: 210, y: -12 }, { x: 215, y: -8 }, { x: 220, y: -2 }, { x: 230, y: 0 }, { x: 240, y: -2 }, { x: 250, y: -6 }, { x: 260, y: -2 }, { x: 275, y: 5 }, { x: 290, y: 2 }, { x: 300, y: 0 }, { x: 320, y: 0 }];
const aDnaKnots = [{ x: 180, y: -15 }, { x: 185, y: 40 }, { x: 190, y: 81 }, { x: 195, y: 50 }, { x: 200, y: 0 }, { x: 205, y: -25 }, { x: 210, y: -30 }, { x: 215, y: -20 }, { x: 220, y: -10 }, { x: 225, y: -6 }, { x: 230, y: -5 }, { x: 240, y: -5 }, { x: 250, y: 0 }, { x: 265, y: 9 }, { x: 280, y: 5 }, { x: 300, y: 0 }, { x: 320, y: 0 }];
const zDnaKnots = [{ x: 180, y: 30 }, { x: 183, y: 76 }, { x: 186, y: 40 }, { x: 188, y: 20 }, { x: 190, y: -10 }, { x: 195, y: -48 }, { x: 200, y: -40 }, { x: 205, y: -30 }, { x: 210, y: -22 }, { x: 220, y: -5 }, { x: 230, y: 2 }, { x: 240, y: 2 }, { x: 250, y: 4 }, { x: 260, y: 4 }, { x: 280, y: -5 }, { x: 295, y: -6 }, { x: 310, y: 0 }, { x: 320, y: 0 }];
const gqParallelKnots = [{ x: 220, y: 40 }, { x: 225, y: 0 }, { x: 230, y: -50 }, { x: 235, y: -100 }, { x: 240, y: -115 }, { x: 245, y: -80 }, { x: 250, y: 50 }, { x: 255, y: 300 }, { x: 262, y: 475 }, { x: 270, y: 350 }, { x: 280, y: 80 }, { x: 290, y: 30 }, { x: 300, y: 25 }, { x: 310, y: 0 }, { x: 320, y: 0 }];
const gqHybridKnots = [{ x: 220, y: 110 }, { x: 225, y: 50 }, { x: 230, y: 0 }, { x: 236, y: -32 }, { x: 245, y: 0 }, { x: 250, y: 40 }, { x: 260, y: 110 }, { x: 270, y: 142 }, { x: 280, y: 160 }, { x: 288, y: 190 }, { x: 300, y: 140 }, { x: 310, y: 20 }, { x: 320, y: 5 }];
const gqAntiparallelKnots = [{ x: 220, y: 65 }, { x: 225, y: 30 }, { x: 233, y: 4 }, { x: 240, y: 25 }, { x: 248, y: 50 }, { x: 255, y: 0 }, { x: 260, y: -50 }, { x: 265, y: -70 }, { x: 272, y: -30 }, { x: 280, y: 0 }, { x: 290, y: 60 }, { x: 297, y: 78 }, { x: 305, y: 50 }, { x: 315, y: 0 }, { x: 320, y: -4 }];

// Protein components (α/β/turn/coil) are expressed in mean-residue
// ellipticity (deg·cm²·dmol⁻¹ per residue). The DNA/G-quadruplex knots were
// hand-drawn in arbitrary relative units; these scale factors bring them into
// the same order of magnitude as literature molar ellipticity per nucleotide
// (deg·cm²·dmol⁻¹). Shape is unchanged — only the absolute amplitude.
const DNA_CD_SCALE = 800;   // B-, A-, Z-DNA (per nucleotide)
const GQ_CD_SCALE = 200;    // G-quadruplex (per nucleotide)
export const splineAlpha = new NaturalCubicSpline(alphaKnots.map((p) => p.x), alphaKnots.map((p) => p.y));
export const splineBeta = new NaturalCubicSpline(betaKnots.map((p) => p.x), betaKnots.map((p) => p.y));
export const splineTurn = new NaturalCubicSpline(turnKnots.map((p) => p.x), turnKnots.map((p) => p.y));
export const splineCoil = new NaturalCubicSpline(coilKnots.map((p) => p.x), coilKnots.map((p) => p.y));
export const splineADNA = new NaturalCubicSpline(aDnaKnots.map((p) => p.x), aDnaKnots.map((p) => p.y * DNA_CD_SCALE));
export const splineBDNA = new NaturalCubicSpline(bDnaKnots.map((p) => p.x), bDnaKnots.map((p) => p.y * DNA_CD_SCALE));
export const splineZDNA = new NaturalCubicSpline(zDnaKnots.map((p) => p.x), zDnaKnots.map((p) => p.y * DNA_CD_SCALE));
export const splineGQP = new NaturalCubicSpline(gqParallelKnots.map((p) => p.x), gqParallelKnots.map((p) => p.y * GQ_CD_SCALE));
export const splineGQH = new NaturalCubicSpline(gqHybridKnots.map((p) => p.x), gqHybridKnots.map((p) => p.y * GQ_CD_SCALE));
export const splineGQA = new NaturalCubicSpline(gqAntiparallelKnots.map((p) => p.x), gqAntiparallelKnots.map((p) => p.y * GQ_CD_SCALE));

export const CD_FIT_COMPONENTS = {
  alpha: { label: 'α-Helix', spline: splineAlpha, color: '#3b82f6', min: 176, max: 260 },
  beta: { label: 'β-Sheet', spline: splineBeta, color: '#ef4444', min: 176, max: 260 },
  turn: { label: 'Turn', spline: splineTurn, color: '#f59e0b', min: 176, max: 260 },
  coil: { label: 'Random Coil', spline: splineCoil, color: '#94a3b8', min: 176, max: 260 },
  aDNA: { label: 'A-DNA', spline: splineADNA, color: '#8b5cf6', min: 180, max: 320 },
  bDNA: { label: 'B-DNA', spline: splineBDNA, color: '#10b981', min: 180, max: 320 },
  zDNA: { label: 'Z-DNA', spline: splineZDNA, color: '#f97316', min: 180, max: 320 },
  gqP: { label: 'G-Quad (Parallel)', spline: splineGQP, color: '#ec4899', min: 220, max: 320 },
  gqH: { label: 'G-Quad (Hybrid)', spline: splineGQH, color: '#14b8a6', min: 220, max: 320 },
  gqA: { label: 'G-Quad (Antiparallel)', spline: splineGQA, color: '#6366f1', min: 220, max: 320 }
};

const evalComponent = (k, x) => {
  const comp = CD_FIT_COMPONENTS[k];
  if (!comp) return 0;
  if (x < comp.min || x > comp.max) return 0;
  return comp.spline.at(x);
};

/* ========================================================================
GENERIC NON-LINEAR FITTING ENGINE (weighted Levenberg–Marquardt)
======================================================================== */
const gaussSolve = (A, b) => {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
};

const tokenizeExpr = (s) => {
  const t = []; let i = 0;
  const D = (c) => /[0-9.]/.test(c);
  const A = (c) => /[a-zA-Z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (D(c)) { let j = i; while (j < s.length && D(s[j])) j++; t.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue; }
    if (A(c)) { let j = i; while (j < s.length && (A(s[j]) || /[0-9]/.test(s[j]))) j++; t.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    if ('+-/^(),'.includes(c)) { t.push({ t: c }); i++; continue; }
    throw new Error('bad');
  }
  return t;
};

const parseExpression = (src) => {
  const tk = tokenizeExpr(src); let p = 0;
  const pk = () => tk[p];
  const eat = (t) => { if (!tk[p] || tk[p].t !== t) throw new Error('exp'); return tk[p++]; };
  const mul = () => { let n = un(); while (pk() && (pk().t === '*' || pk().t === '/')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: un() }; } return n; };
  const add = () => { let n = mul(); while (pk() && (pk().t === '+' || pk().t === '-')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: mul() }; } return n; };
  const un = () => { if (pk() && pk().t === '-') { eat('-'); return { type: 'un', a: un() }; } if (pk() && pk().t === '+') { eat('+'); return un(); } return pw(); };
  const pw = () => { let n = pr(); if (pk() && pk().t === '^') { eat('^'); n = { type: 'bin', op: '^', l: n, r: un() }; } return n; };
  const pr = () => {
    const t = pk(); if (!t) throw new Error('exp');
    if (t.t === 'num') { eat('num'); return { type: 'num', v: t.v }; }
    if (t.t === 'id') {
      eat('id');
      if (pk() && pk().t === '(') {
        eat('('); const a = [add()];
        while (pk() && pk().t === ',') { eat(','); a.push(add()); }
        eat(')');
        return { type: 'call', name: t.v, args: a };
      }
      return { type: 'sym', name: t.v };
    }
    if (t.t === '(') { eat('('); const n = add(); eat(')'); return n; }
    throw new Error('exp');
  };
  const ast = add();
  if (p < tk.length) throw new Error('trail');
  return ast;
};

const evalAST = (n, s) => {
  switch (n.type) {
    case 'num': return n.v;
    case 'sym': return n.name === 'x' ? s.x : n.name === 'pi' ? Math.PI : n.name === 'e' ? Math.E : s[n.name];
    case 'un': return -evalAST(n.a, s);
    case 'bin': {
      const a = evalAST(n.l, s), b = evalAST(n.r, s);
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      if (n.op === '/') return a / b;
      return Math.pow(a, b);
    }
    case 'call': {
      const a = n.args.map((x) => evalAST(x, s));
      switch (n.name) {
        case 'exp': return Math.exp(a[0]);
        case 'log': return Math.log10(a[0]);
        case 'ln': return Math.log(a[0]);
        case 'sqrt': return Math.sqrt(a[0]);
        case 'sin': return Math.sin(a[0]);
        case 'cos': return Math.cos(a[0]);
        case 'tan': return Math.tan(a[0]);
        case 'abs': return Math.abs(a[0]);
        case 'pow': return Math.pow(a[0], a[1]);
        case 'min': return Math.min(...a);
        case 'max': return Math.max(...a);
        default: return NaN;
      }
    }
    default: return NaN;
  }
};

const collectParams = (ast) => {
  const s = new Set();
  (function w(n) {
    if (!n) return;
    if (n.type === 'sym') { if (n.name !== 'x' && n.name !== 'pi' && n.name !== 'e') s.add(n.name); }
    if (n.type === 'bin') { w(n.l); w(n.r); }
    if (n.type === 'un') w(n.a);
    if (n.type === 'call') n.args.forEach(w);
  })(ast);
  return [...s];
};

const fitGeneric = (pts, f0, P0) => {
  let P = [...P0];
  const f = (x, Pv) => f0(x, Pv);
  const ssr = (Pv) => {
    let s = 0;
    for (const p of pts) {
      const v = f(p.x, Pv);
      if (!isFinite(v)) return Infinity;
      const w = p.w || 1;
      s += w * (p.y - v) ** 2;
    }
    return s;
  };
  let lam = 1e-3, cur = ssr(P);
  for (let it = 0; it < 120 && isFinite(cur); it++) {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) {
        const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4);
        row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h);
      }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0));
    const g = P.map(() => 0);
    pts.forEach((p, i) => {
      const w = p.w || 1; const r = p.y - f(p.x, P);
      for (let a = 0; a < P.length; a++) {
        g[a] += w * J[i][a] * r;
        for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b];
      }
    });
    for (let a = 0; a < P.length; a++) A[a][a] *= (1 + lam);
    const dvec = gaussSolve(A, g);
    if (!dvec) { lam *= 4; if (lam > 1e7) break; continue; }
    const P2 = P.map((v, k) => v + dvec[k]);
    const s2 = ssr(P2);
    if (isFinite(s2) && s2 < cur) {
      const pv = cur; P = P2; cur = s2; lam = Math.max(1e-8, lam / 2);
      if (Math.abs(pv - cur) < 1e-10) break;
    } else {
      lam *= 3; if (lam > 1e7) break;
    }
  }
  if (!P.every(isFinite)) return null;
  let sst = 0;
  const m = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.forEach((p) => { sst += (p.y - m) ** 2; });
  const df = Math.max(1, pts.length - P.length);
  const r2 = sst > 0 ? 1 - cur / sst : 1;
  const se = Math.sqrt(cur / df);
  const P_err = P.map(() => 0);
  try {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) {
        const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4);
        row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h);
      }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0));
    pts.forEach((p, i) => {
      const w = p.w || 1;
      for (let a = 0; a < P.length; a++) {
        for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b];
      }
    });
    for (let i = 0; i < P.length; i++) {
      const e = P.map((_, j) => (i === j ? 1 : 0));
      const col = gaussSolve(A, e);
      if (col) P_err[i] = Math.sqrt(Math.max(0, col[i] * (cur / df)));
    }
  } catch { /* ignore */ }
  return { params: P, paramsErr: P_err, r2, se, f: (x) => f(x, P) };
};

const fitLinear = (pts) => {
  if (pts.length < 2) return null;
  const r = fitGeneric(pts, (x, P) => P[0] + P[1] * x, [0, 1]);
  return r ? { ...r, intercept: r.params[0], slope: r.params[1], interceptErr: r.paramsErr[0], slopeErr: r.paramsErr[1] } : null;
};

const fit4PL = (pts) => {
  if (pts.length < 4) return null;
  const ys = pts.map((p) => p.y);
  const t = Math.max(...ys), b = Math.min(...ys);
  const r = fitGeneric(
    pts,
    (x, P) => P[1] + (P[0] - P[1]) / (1 + Math.pow(x / P[2], P[3])),
    [t, b, pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length), 1]
  );
  return r ? {
    ...r,
    top: r.params[0], bottom: r.params[1], ic50: r.params[2], hill: r.params[3],
    topErr: r.paramsErr[0], bottomErr: r.paramsErr[1], ic50Err: r.paramsErr[2], hillErr: r.paramsErr[3]
  } : null;
};

const fitCustomEquation = (expr, pts) => {
  let ast, par;
  try { ast = parseExpression(expr); par = collectParams(ast); } catch { return null; }
  if (!par.length || pts.length < par.length + 1) return null;
  const init = par.map((_, i) => (i === 0 ? pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length) : 1));
  const res = fitGeneric(pts, (x, P) => {
    const s = { x };
    par.forEach((n, i) => { s[n] = P[i]; });
    return evalAST(ast, s);
  }, init);
  if (!res) return null;
  res.params = Object.fromEntries(par.map((n, i) => [n, res.params[i]]));
  res.paramsErr = Object.fromEntries(par.map((n, i) => [n, res.paramsErr[i]]));
  return res;
};

const runFitModel = (model, customExpr, wpts) => {
  if (model === 'linear') return fitLinear(wpts);
  if (model === '4pl') return fit4PL(wpts);
  if (model === 'custom' && customExpr) return fitCustomEquation(customExpr, wpts);
  return null;
};

const fitParamOptions = (model, customExpr) => {
  if (model === 'linear') return ['slope', 'intercept'];
  if (model === '4pl') return ['top', 'bottom', 'ic50', 'hill'];
  if (model === 'custom') {
    try { return collectParams(parseExpression(customExpr || '')); } catch { return []; }
  }
  return [];
};

const extractFitParam = (fit, model, param) => {
  if (!fit) return null;
  if (model === 'linear') return param === 'intercept' ? fit.intercept : fit.slope;
  if (model === '4pl') return ({ top: fit.top, bottom: fit.bottom, ic50: fit.ic50, hill: fit.hill })[param] ?? null;
  return fit.params?.[param] ?? null;
};

/* ========================================================================
DYNAMIC PURE-COMPONENT CD SPECTRUM FITTER
Returns { fractions, scaleK, fitCurve, r2, nPoints, activeBases }
======================================================================== */
/* ========================================================================
DYNAMIC PURE-COMPONENT CD SPECTRUM FITTER
Returns { success, fractions, scaleK, fitCurve, r2, nPoints, activeBases, fitMin, fitMax }
======================================================================== */
/* ========================================================================
DYNAMIC PURE-COMPONENT CD SPECTRUM FITTER (Adaptive Regularization)
Returns { success, fractions, scaleK, fitCurve, r2, nPoints, activeBases, fitMin, fitMax }
======================================================================== */
const fitCdSpectrum = (wavelengths, values, selectedKeys = ['alpha', 'beta', 'turn', 'coil'], opts = {}) => {
  if (!selectedKeys.length) return { error: 'No components selected.' };

  // Unit-aware reference scale: the pure-component splines are in MRE [θ]_R.
  // Scale them into the experimental unit (molar, MRE, Δε, Δε/res) so that
  // scaleK ≈ 1 and the simulated curve is in the same unit as the data.
  const uScale = cdUnitScale(opts.thetaMode, opts.residues);
  const compEval = (k, w) => evalComponent(k, w) * uScale;
  
  // Calculate strict overlap domain of ALL selected components
  const fitMin = Math.max(...selectedKeys.map(k => CD_FIT_COMPONENTS[k].min));
  const fitMax = Math.min(...selectedKeys.map(k => CD_FIT_COMPONENTS[k].max));
  
  if (fitMin >= fitMax) {
    return { error: `No overlapping wavelength domain for selected components. (Min: ${fitMin}nm, Max: ${fitMax}nm)` };
  }

  const fitPairs = [];
  for (let i = 0; i < wavelengths.length; i++) {
    const w = wavelengths[i];
    const v = values[i];
    if (w >= fitMin && w <= fitMax && v !== undefined && Number.isFinite(v)) {
      fitPairs.push({ w, v });
    }
  }
  
  if (fitPairs.length < 10) {
    return { error: `Not enough data points between ${fitMin} and ${fitMax} nm (found ${fitPairs.length}, need at least 10).` };
  }
  
  const n = fitPairs.length;
  const kLen = selectedKeys.length;

  // Normalize column vectors to prevent scale imbalances
  const rawA = fitPairs.map(({ w }) => selectedKeys.map(k => compEval(k, w)));
  const colMax = Array.from({ length: kLen }, (_, j) => Math.max(1e-9, ...rawA.map((r) => Math.abs(r[j]))));
  const A = rawA.map((r) => r.map((v, j) => v / colMax[j]));
  const bMax = Math.max(1e-9, ...fitPairs.map(({ v }) => Math.abs(v)));
  const b = fitPairs.map(({ v }) => v / bMax);

  // Construct AtA and Atb
  const AtA = Array.from({ length: kLen }, (_, i) => Array.from({ length: kLen }, (_, j) => A.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const Atb = Array.from({ length: kLen }, (_, i) => A.reduce((sum, row, idx) => sum + row[i] * b[idx], 0));

  let coeffsScaled = null;
  let penalty = 1e-4; // Start with a very mild ridge penalty

  // Adaptive Regularization Loop: If the matrix is singular/collinear, 
  // progressively increase the diagonal penalty until it solves successfully.
  for (let attempt = 0; attempt < 5; attempt++) {
    const AtA_reg = AtA.map((row, i) => 
      row.map((val, j) => i === j ? val + penalty + (val * penalty) : val)
    );
    
    coeffsScaled = gaussSolve(AtA_reg, Atb);
    
    if (coeffsScaled && coeffsScaled.every(Number.isFinite)) {
      break; // Success
    }
    penalty *= 10; // Increase penalty (1e-4 -> 1e-3 -> 1e-2 -> 1e-1 -> 1)
  }

  if (!coeffsScaled || !coeffsScaled.every(Number.isFinite)) {
    return { error: 'Matrix inversion failed completely. Try selecting fewer, more distinct components.' };
  }

  // Convert back to original scale and clamp to >= 0
  const coeffs = coeffsScaled.map((c, j) => c / colMax[j]);
  const clamped = coeffs.map((c) => Math.max(0, c)); 
  const sum = clamped.reduce((a, v) => a + v, 0);
  
  if (!Number.isFinite(sum) || sum <= 1e-12) {
    return { error: 'Fit resulted in 0% for all components. Check if the spectrum is inverted or severely baseline-shifted.' };
  }

  // Normalize fractions to 100%
  const norm = clamped.map((c) => Math.round((c / sum) * 1000) / 10);
  const diff = +(100 - norm.reduce((a, v) => a + v, 0)).toFixed(1);
  if (diff !== 0) {
    const maxIdx = norm.indexOf(Math.max(...norm));
    norm[maxIdx] = +(norm[maxIdx] + diff).toFixed(1);
  }

  // Calculate absolute scale factor (k)
  let scaleK = 1, num = 0, den = 0;
  fitPairs.forEach(({ w, v }) => {
    let t = 0;
    selectedKeys.forEach((k, idx) => {
      t += compEval(k, w) * (clamped[idx] / sum);
    });
    num += v * t;
    den += t * t;
  });
  
  if (den > 0) scaleK = num / den;
  if (!Number.isFinite(scaleK)) return { error: 'Scale factor calculation failed.' };

  // Generate the simulated fit curve
  const fitCurve = fitPairs.map(({ w }) => {
    let y = 0;
    selectedKeys.forEach((k, idx) => {
      y += compEval(k, w) * (clamped[idx] / sum);
    });
    return { x: w, y: scaleK * y };
  });

  // Calculate R-squared
  const meanY = fitPairs.reduce((a, p) => a + p.v, 0) / n;
  let ssRes = 0, ssTot = 0;
  fitPairs.forEach(({ v }, i) => {
    ssRes += (v - fitCurve[i].y) ** 2;
    ssTot += (v - meanY) ** 2;
  });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  if (!norm.every(Number.isFinite) || !Number.isFinite(r2)) {
    return { error: 'Statistical calculations failed (NaN encountered).' };
  }

  const fractions = {};
  selectedKeys.forEach((k, i) => fractions[k] = norm[i]);

  return {
    success: true,
    fractions, scaleK, fitCurve, r2, nPoints: n, activeBases: selectedKeys,
    fitMin, fitMax, thetaMode: opts.thetaMode || 'mre', residues: opts.residues
  };
};

/* ========================================================================
CLASSICAL REFERENCE-SET DECONVOLUTION (CONTIN / CDSSTR / SELCON style)
Classical alternative to the pure-component fitter above. Protocol:

  1. A reference database is built from the same pure-component splines:
     many synthetic spectra with KNOWN compositions (fractions sum to 1),
     including near-pure corner references and random interior compositions.
  2. Variable selection (as in CONTIN/CDSSTR): only the references most
     correlated with the experimental spectrum are kept.
  3. The experimental spectrum is fitted as a NON-NEGATIVE linear
     combination of the selected references (A·x ≈ b, x ≥ 0), solved with
     the Lawson–Hanson active-set NNLS algorithm (plus a small ridge for
     stability, like CONTIN's regularization).
  4. The composition is the weighted average of the reference compositions,
     normalised to 100%.

This is the same general protocol used by the classical programs CONTIN,
SELCON3, CDSSTR and K2D — and the idea BeStSel builds on. It is NOT the
exact BeStSel implementation: BeStSel uses its own proprietary reference
database (37 proteins measured down to 175 nm), a 5-state output (α,
antiparallel β, parallel β, turn, other) and its own band-position
optimisation. Here the references are generated from the built-in
pure-component spectra, so results are approximate but comparable.

Returns the SAME shape as fitCdSpectrum so the donut, overlay, saved-fits
table and buildSimulatedCurve keep working unchanged.
======================================================================= */
const pearsonCorr = (a, b) => {
  const n = a.length;
  if (n < 2) return 0;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
};

// Root-mean-square (unit-shape) normalisation. Used before the NNLS solve so
// that references of very different amplitudes (α-helix ~66 000 vs β-sheet
// ~12 000 mean-residue ellipticity) are compared by SHAPE alone, exactly as
// the classical methods do. The absolute scale is recovered via scaleK.
const rmsNorm = (arr) => {
  const r = Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(1, arr.length));
  return r > 1e-12 ? r : 1;
};

// Build the classical reference database: near-pure corner references (one
// per selected component) plus `count` random interior compositions drawn
// uniformly over the simplex (Dirichlet(1)). Each reference stores its known
// composition `frac` and its spectrum evaluated at the fit wavelengths.
const buildClassicalReferenceSet = (selectedKeys, fitWavelengths, count) => {
  const refs = [];
  const pushRef = (frac) => {
    const spectrum = fitWavelengths.map((w) => {
      let y = 0;
      selectedKeys.forEach((k, j) => { y += evalComponent(k, w) * frac[j]; });
      return y;
    });
    refs.push({ frac: frac.slice(), spectrum });
  };
  selectedKeys.forEach((k, j) => {
    const others = Math.max(1, selectedKeys.length - 1);
    pushRef(selectedKeys.map((_, i) => (i === j ? 0.98 : 0.02 / others)));
  });
  for (let i = 0; i < count; i++) {
    const raw = selectedKeys.map(() => -Math.log(1 - Math.random()));
    const sum = raw.reduce((a, v) => a + v, 0);
    pushRef(raw.map((v) => v / sum));
  }
  return refs;
};

// Lawson–Hanson active-set NNLS: min ||A·x − b||² subject to x ≥ 0.
// A is (m wavelengths × n references), b is (m). A mild ridge is added to
// the normal-equation diagonal for stability (CONTIN-style regularization).
const nnlsSolve = (A, b, { ridge = 1e-5, maxIter = 300 } = {}) => {
  const m = A.length, n = A[0].length;
  if (!m || !n) return null;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < m; k++) s += A[k][i] * A[k][j];
      AtA[i][j] = s;
    }
    let s = 0;
    for (let k = 0; k < m; k++) s += A[k][i] * b[k];
    Atb[i] = s;
  }
  const diagMean = AtA.reduce((a, row, i) => a + row[i], 0) / Math.max(1, n);
  const reg = Math.max(0, ridge) * Math.max(1e-12, diagMean);
  const x = new Array(n).fill(0);
  const passive = new Array(n).fill(false);
  const w = new Array(n).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      let s = Atb[i];
      for (let j = 0; j < n; j++) s -= AtA[i][j] * x[j];
      w[i] = s;
    }
    let t = -1, tMax = 0;
    for (let j = 0; j < n; j++) {
      if (!passive[j] && w[j] > tMax) { tMax = w[j]; t = j; }
    }
    if (t < 0 || tMax <= 1e-13) break;
    passive[t] = true;
    for (;;) {
      const idx = [];
      for (let j = 0; j < n; j++) if (passive[j]) idx.push(j);
      if (!idx.length) break;
      const p = idx.length;
      const subA = Array.from({ length: p }, (_, r) =>
        Array.from({ length: p }, (_, c) => AtA[idx[r]][idx[c]] + (r === c ? reg : 0)));
      const subB = idx.map((j) => Atb[j]);
      const zSub = gaussSolve(subA, subB);
      const z = new Array(n).fill(0);
      if (zSub) idx.forEach((j, r) => { z[j] = zSub[r]; });
      let alpha = Infinity, jStar = -1;
      for (const j of idx) {
        if (z[j] <= 1e-13) {
          const r = x[j] / (x[j] - z[j] + 1e-300);
          if (r >= 0 && r < alpha) { alpha = r; jStar = j; }
        }
      }
      if (jStar < 0) {
        idx.forEach((j) => { x[j] = z[j]; });
        break;
      }
      for (const j of idx) x[j] += alpha * (z[j] - x[j]);
      passive[jStar] = false;
    }
  }
  return x;
};

const fitCdSpectrumClassical = (wavelengths, values, selectedKeys = ['alpha', 'beta', 'turn', 'coil'], opts = {}) => {
  if (!selectedKeys.length) return { error: 'No components selected.' };

  // Unit-aware reference scale (same convention as the pure-component fitter).
  const uScale = cdUnitScale(opts.thetaMode, opts.residues);
  const compEval = (k, w) => evalComponent(k, w) * uScale;

  const fitMin = Math.max(...selectedKeys.map((k) => CD_FIT_COMPONENTS[k].min));
  const fitMax = Math.min(...selectedKeys.map((k) => CD_FIT_COMPONENTS[k].max));
  if (fitMin >= fitMax) {
    return { error: `No overlapping wavelength domain for selected components. (Min: ${fitMin}nm, Max: ${fitMax}nm)` };
  }

  const fitPairs = [];
  for (let i = 0; i < wavelengths.length; i++) {
    const w = wavelengths[i], v = values[i];
    if (w >= fitMin && w <= fitMax && v !== undefined && Number.isFinite(v)) {
      fitPairs.push({ w, v });
    }
  }
  if (fitPairs.length < 10) {
    return { error: `Not enough data points between ${fitMin} and ${fitMax} nm (found ${fitPairs.length}, need at least 10).` };
  }

  const n = fitPairs.length;
  const fitWls = fitPairs.map((p) => p.w);
  const bArr = fitPairs.map((p) => p.v);

  // 1) Build the classical reference database.
  const nRefs = Math.max(20, Math.min(1000, Math.round(opts.nRefs || 400)));
  const refs = buildClassicalReferenceSet(selectedKeys, fitWls, nRefs);

  // 2) Variable selection: keep the references most correlated with the query.
  const topK = Math.max(2, Math.min(refs.length, Math.round(opts.topK || 30)));
  const ranked = refs
    .map((ref, i) => ({ i, r: pearsonCorr(ref.spectrum, bArr) }))
    .sort((a, b2) => b2.r - a.r);
  const selected = ranked.slice(0, topK);

  // 3) NNLS fit of the selected references to the query. Both the query and
  //    every reference are normalised to unit RMS so the fit compares SHAPE
  //    alone (the absolute scale is recovered afterwards via scaleK).
  //    Design matrix A is built rows = wavelengths, columns = references.
  const qRms = rmsNorm(bArr);
  const b = bArr.map((v) => v / qRms);
  const Acols = selected.map(({ i }) => {
    const s = refs[i].spectrum;
    const r = rmsNorm(s);
    return s.map((y) => y / r);
  });
  const A = bArr.map((_, w) => Acols.map((col) => col[w]));
  const x = nnlsSolve(A, b, { ridge: opts.ridge ?? 1e-5, maxIter: 400 });
  if (!x) {
    return { error: 'NNLS did not converge. Try increasing the number of reference spectra or the ridge.' };
  }

  const used = selected.filter((_, idx) => x[idx] > 1e-12);
  if (!used.length) {
    return { error: 'Fit resulted in 0 weight for all references. Check if the spectrum is inverted or severely baseline-shifted.' };
  }

  // 4) Composition = weighted average of the reference compositions.
  const fr = selectedKeys.map((_, k) =>
    selected.reduce((s, sel, idx) => s + x[idx] * refs[sel.i].frac[k], 0));
  const sumFr = fr.reduce((a, v) => a + v, 0);
  if (!Number.isFinite(sumFr) || sumFr <= 1e-12) {
    return { error: 'Fit resulted in 0% for all components. Check if the spectrum is inverted or severely baseline-shifted.' };
  }
  const norm = fr.map((v) => Math.round((v / sumFr) * 1000) / 10);
  const diff = +(100 - norm.reduce((a, v) => a + v, 0)).toFixed(1);
  if (diff !== 0) {
    const maxIdx = norm.indexOf(Math.max(...norm));
    norm[maxIdx] = +(norm[maxIdx] + diff).toFixed(1);
  }

  // 5) Reconstruct the fit curve from the fraction-weighted pure components
  //    (same convention as the pure-component fitter) and compute scaleK.
  const tArr = fitPairs.map(({ w }) => {
    let t = 0;
    selectedKeys.forEach((k, i) => { t += compEval(k, w) * (norm[i] / 100); });
    return t;
  });
  let num = 0, den = 0;
  fitPairs.forEach(({ v }, i) => { num += v * tArr[i]; den += tArr[i] * tArr[i]; });
  const scaleK = den > 0 ? num / den : 1;
  if (!Number.isFinite(scaleK)) return { error: 'Scale factor calculation failed.' };

  const fitCurve = fitPairs.map(({ w }, i) => ({ x: w, y: scaleK * tArr[i] }));

  // 6) R-squared on the scaled reconstruction.
  const meanY = fitPairs.reduce((a, p) => a + p.v, 0) / n;
  let ssRes = 0, ssTot = 0;
  fitPairs.forEach(({ v }, i) => {
    ssRes += (v - fitCurve[i].y) ** 2;
    ssTot += (v - meanY) ** 2;
  });
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  if (!norm.every(Number.isFinite) || !Number.isFinite(r2)) {
    return { error: 'Statistical calculations failed (NaN encountered).' };
  }

  const fractions = {};
  selectedKeys.forEach((k, i) => { fractions[k] = norm[i]; });

  return {
    success: true,
    method: 'classical',
    algorithm: 'nnls',
    fractions, scaleK, fitCurve, r2, nPoints: n, activeBases: selectedKeys,
    fitMin, fitMax, nRefs: refs.length, refsUsed: used.length,
    thetaMode: opts.thetaMode || 'mre', residues: opts.residues
  };
};

const buildSimulatedCurve = (fitRes, wavelengths) => {
  if (!fitRes) return [];
  const bases = fitRes.activeBases || ['alpha', 'beta', 'turn', 'coil'];
  const fractions = fitRes.fractions || {
    alpha: fitRes.alpha, beta: fitRes.beta, turn: fitRes.turn, coil: fitRes.coil
  };
  const scaleK = fitRes.scaleK || 1;
  // Express the reconstruction in the same unit as the stored experimental
  // data (the fit stores thetaMode / residues; legacy fits default to MRE).
  const uScale = cdUnitScale(fitRes.thetaMode, fitRes.residues);
  let tot = bases.reduce((sum, k) => sum + (fractions[k] || 0), 0);
  if (tot === 0) tot = 100;

  return wavelengths
    .filter((w) => w >= 176 && w <= 320)
    .map((w) => {
      let y = 0;
      bases.forEach((k) => {
        y += uScale * evalComponent(k, w) * ((fractions[k] || 0) / tot);
      });
      return { x: w, y: scaleK * y };
    });
};

/* ========================================================================
SHARED CHART STYLE SYSTEM + DRAG-TO-ZOOM
======================================================================== */
const DEFAULT_CHART_STYLE = {
  height: 380, aspect: 1, fontSize: 16, tickStep: '', tickAngle: 0,
  ptStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2,
  legend: 'top', colors: {}, barRadius: 3,
  xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: ''
};

const lineDash = (style) =>
  style === 'dashed' ? '7 5' : style === 'dotted' ? '2 3' : undefined;

const seriesColor = (cfg, key, idx, total) => seriesColorFor(cfg, key, idx, total);

const makeTicks = (domain, stepStr) => {
  const step = parseManual(stepStr);
  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;
  const [a, b] = [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])];
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) {
    out.push(parseFloat(v.toFixed(6)));
  }
  return out.length ? out : undefined;
};

const catInterval = (stepStr) => {
  const n = parseManual(stepStr);
  return n && n >= 1 ? Math.round(n) - 1 : 0;
};

const dom = (v) =>
  v === '' || v == null || parseManual(v) === null ? undefined : parseManual(v);

const ErrorTreatmentPanel = ({ plot, set, showFitToggle = true, customActions }) => {
  const shimTest = {
    useFixedSD: plot.useFixedSD,
    fixedSDStr: plot.fixedSDStr,
    outlierThreshStr: plot.outlierThreshStr,
    fitIC50: plot.fitEnabled,
    showExcl: plot.showExcl
  };
  const shimUpdate = (u) => {
    const patch = { ...u };
    if ('fitIC50' in patch) { patch.fitEnabled = patch.fitIC50; delete patch.fitIC50; }
    set(patch);
  };
  return <SharedErrorTreatment activeTest={shimTest} updateActiveTest={shimUpdate} showFitToggle={showFitToggle} customActions={customActions} />;
};

const useXZoom = (chartRef, dataDomain, margin = CHART_MARGIN) => {
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
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const onMouseDown = (e) => {
    const v = getX(e.clientX);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };

  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

const useYZoom = (chartRef, dataDomain, margin = CHART_MARGIN) => {
  const [domain, setDomain] = useState(null);
  const [lo, setLo] = useState(null);
  const [hi, setHi] = useState(null);
  const dragging = useRef(false);
  const loRef = useRef(null);
  const safe = Array.isArray(dataDomain) && dataDomain[1] > dataDomain[0] ? dataDomain : [0, 1];
  const eff = domain || safe;
  const effRef = useRef(eff);
  effRef.current = eff;
  // Same once-registered-listener caveat as useXZoom — read the live margins.
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
    // Screen Y grows downward, data domain grows upward — invert.
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
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const onMouseDown = (e) => {
    const v = getY(e.clientY);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };

  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

const useElementSize = (ref) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    const t = setTimeout(update, 60);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
      clearTimeout(t);
    };
  }, [ref]);
  return size;
};

const useCdDerived = (activeTest, ctx = {}) => {
  const instances = getInstances(ctx, activeTest);
  const activeInstance =
    instances.find((i) => i.id === activeTest.id) || instances[0] || null;
  const conditionFields = CD_EXPERIMENTAL_FIELDS;
  const activeParsed = useMemo(() => computeParsed(activeInstance ? activeInstance.test : null), [activeInstance]);
  const mw = getMWForInstance(activeInstance, ctx);
  const compoundMW = getCompoundMW(activeInstance, ctx);
  return { instances, activeInstance, conditionFields, activeParsed, mw, compoundMW };
};

// =========================================================================
// CDSections.jsx - REPLACE Data COMPONENT
// =========================================================================
// =========================================================================
// CDSections.jsx - REPLACE Data COMPONENT
// =========================================================================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  const { activeInstance, activeParsed, instances, mw, compoundMW } = d;

  const spectraColumns = activeTest.spectraColumns || [];
  const yUnit = activeTest.yUnit || 'mdeg';

  const updateWavelengthData = (val) => updateActiveTest({ wavelengthData: val });
  const addSpectrumColumn = () => {
    const cols = [...spectraColumns];
    cols.push({
      id: makeId('spec'),
      title: `Spectrum ${cols.length + 1}`,
      data: '',
      color: SPECTRA_PALETTE[cols.length % SPECTRA_PALETTE.length],
      visible: true
    });
    updateActiveTest({ spectraColumns: cols });
  };
  const patchColumn = (id, patch) =>
    updateActiveTest({ spectraColumns: spectraColumns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeSpectrumColumn = (id) =>
    updateActiveTest({ spectraColumns: spectraColumns.filter((c) => c.id !== id) });

  const [jascoText, setJascoText] = useState('');
  const [jascoMsg, setJascoMsg] = useState('');
  const jascoFileRef = useRef(null);
  
  // FIXED: Combines the filename update with the spectra update to avoid race conditions
  const applyJasco = (parsed, filename) => {
    if (!parsed || !parsed.xs.length) { setJascoMsg('⚠️ No XY data found in the Jasco file.'); return; }
    const updates = {
      wavelengthData: parsed.xs.join('\n'),
      spectraColumns: [{ id: makeId('spec'), title: parsed.title || 'Imported Spectrum', data: parsed.ys.join('\n'), color: SPECTRA_PALETTE[0], visible: true }],
      yUnit: 'mdeg',
      // A fresh import replaces whatever conversion state the condition had:
      // drop the backups so a stale one can never be restored by mistake.
      rawSpectraColumns: undefined,
      thetaSpectraColumns: undefined
    };
    
    // Assign instanceName safely in the same state update
    if (filename) updates.instanceName = filename.replace(/\.[^/.]+$/, "");

    const cNum = parseManual(parsed.concentration);
    if (cNum !== null) {
      updates.concentration = String(cNum);
      if (parsed.concentrationUnit) updates.concentrationUnit = parsed.concentrationUnit;
    }
    const pNum = parseManual(parsed.pathLength);
    if (pNum !== null) {
      updates.pathLength = String(pNum);
      if (parsed.pathLengthUnit) updates.pathLengthUnit = parsed.pathLengthUnit;
    }
    if (parsed.temperature) {
      updates.temperature = String(parsed.temperature);
      if (parsed.temperatureUnit) updates.temperatureUnit = parsed.temperatureUnit;
    }
    if (parsed.experimentDate) updates.experimentDate = parsed.experimentDate;

    const normMeta = {};
    Object.entries(parsed.meta || {}).forEach(([k, v]) => {
      normMeta[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v);
    });

    const setIfEmpty = (key, val) => {
      if (!activeTest[key] && val !== undefined && val !== null && !Number.isNaN(val) && String(val).trim() !== '') {
        updates[key] = String(val);
      }
    };

    setIfEmpty('instrumentModel', normMeta['model'] || normMeta['modelname'] || normMeta['spectrometer'] || normMeta['spectrometerdatasystem']);
    const scanModeRaw = normMeta['scanmode'] || normMeta['scanningmode'];
    if (scanModeRaw && !activeTest.scanMode) {
      updates.scanMode = scanModeRaw.toLowerCase().includes('step') ? 'Step Scan' : 'Continuous Scan';
    }

    const spd = parseFloat(normMeta['scanningspeed'] || normMeta['scanspeed']);
    if (!Number.isNaN(spd)) setIfEmpty('scanSpeed', spd);

    const dp = parseFloat(normMeta['datapitch'] || normMeta['deltax']);
    if (!Number.isNaN(dp)) setIfEmpty('dataPitch', Math.abs(dp));
    
    const bw = parseFloat(normMeta['bandwidth'] || normMeta['band'] || normMeta['bandwidth']);
    if (!Number.isNaN(bw)) setIfEmpty('bandwidth', bw);

    const rt = parseFloat(normMeta['dit'] || normMeta['responsetime'] || normMeta['response']);
    if (!Number.isNaN(rt)) setIfEmpty('responseTime', rt);

    setIfEmpty('accumulations', parseInt(normMeta['accumulations'] || normMeta['scans'], 10));
    setIfEmpty('photometricMode', normMeta['photometricmode']);

    const sens = parseFloat(normMeta['sensitivity'] || normMeta['cdscale'] || normMeta['flscale']);
    if (!Number.isNaN(sens)) setIfEmpty('sensitivity', sens);

    updateActiveTest(updates);
    const expFilled = ['concentration', 'pathLength', 'temperature', 'experimentDate'].filter((k) => updates[k]).length;
    const instFilled = ['instrumentModel', 'scanMode', 'scanSpeed', 'dataPitch', 'bandwidth', 'responseTime', 'accumulations', 'photometricMode', 'sensitivity'].filter((k) => updates[k]).length;
    setJascoMsg(`✅ Imported ${parsed.xs.length} points${parsed.title ? ` — "${parsed.title}"` : ''}. Filled ${expFilled} experimental + ${instFilled} instrumental field(s).`);
  };

  const handleJascoFile = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setJascoMsg(`Parsing ${files.length} Jasco file(s)...`);

    const results = [];
    const failed = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        // Native JASCO .jws files are binary (v1.5 flat or OLE2 compound
        // document) — detect by magic bytes and use the binary parser.
        let parsed = null;
        if (isJascoJwsBinary(buf)) {
          parsed = parseJascoJwsBinary(buf);
        } else {
          const text = new TextDecoder('utf-8').decode(buf);
          parsed = parseJascoCDText(text);
        }
        // Name the spectrum after the source FILE: the JASCO metadata "Sample
        // name" is often a constant shared by every file of the same run, which
        // made every imported spectrum show the same title.
        if (f.name) parsed.title = f.name.replace(/\.[^/.]+$/, '') || parsed.title;
        if (parsed.xs.length) {
          parsed.filename = f.name;
          parsed.rawFile = f; // keep the raw file for Drive archiving
          results.push(parsed);
        } else {
          failed.push(f.name);
        }
      } catch (err) { console.error('Parse error:', err); failed.push(f.name); }
    }

    if (results.length === 0) {
      setJascoMsg(failed.length
        ? `⚠️ Could not read XY data from: ${failed.join(', ')}. Unsupported or corrupted .jws variant.`
        : '⚠️ No valid Jasco file(s) found.');
      if (jascoFileRef.current) jascoFileRef.current.value = '';
      return;
    }

    applyJasco(results[0], results[0].filename);

    if (failed.length) setJascoMsg(`⚠️ Skipped ${failed.length} file(s) with no readable XY data (${failed.join(', ')}). ${results.length} imported.`);

    if (results.length > 1 && ctx.setTests) {
      ctx.setTests(prevTests => {
        const newTests = [];
        for (let i = 1; i < results.length; i++) {
          const parsed = results[i];
          const newId = 't' + Date.now() + i + Math.random().toString(36).substring(2,5);
          const cloned = JSON.parse(JSON.stringify(activeTest));
          cloned.id = newId;
          cloned.instanceName = parsed.filename.replace(/\.[^/.]+$/, "");
          cloned.wavelengthData = parsed.xs.join('\n');
          cloned.spectraColumns = [{ id: makeId('spec'), title: parsed.title || 'Imported Spectrum', data: parsed.ys.join('\n'), color: SPECTRA_PALETTE[i % SPECTRA_PALETTE.length], visible: true }];
          cloned.yUnit = 'mdeg';
          
          const cNum = parseManual(parsed.concentration); if (cNum !== null) { cloned.concentration = String(cNum); if (parsed.concentrationUnit) cloned.concentrationUnit = parsed.concentrationUnit; }
          const pNum = parseManual(parsed.pathLength); if (pNum !== null) { cloned.pathLength = String(pNum); if (parsed.pathLengthUnit) cloned.pathLengthUnit = parsed.pathLengthUnit; }
          if (parsed.temperature) { cloned.temperature = String(parsed.temperature); if (parsed.temperatureUnit) cloned.temperatureUnit = parsed.temperatureUnit; }
          if (parsed.experimentDate) cloned.experimentDate = parsed.experimentDate;
          newTests.push(cloned);
        }
        return [...prevTests, ...newTests];
      });
    }
    // Archive the RAW Jasco file(s) to Google Drive automatically (best-effort).
    const driveConnected = getDriveToken();
    let driveSaved = 0;
    if (driveConnected) {
      const driveCtx = {
        project: (activeTest.projectNames || [])[0] || '',
        test: activeTest.name || '',
        scientist: activeTest.operator || '',
        section: 'Data',
        subsection: 'Spectra'
      };
      for (let i = 0; i < results.length; i++) {
        const file = results[i].rawFile;
        if (!file) continue;
        try {
          // The importer renames the instance to the file name (async state
          // update — activeTest.instanceName is still the old value here), so
          // compute the instance from the parsed result.
          const instanceForFile = (results[i].filename || '').replace(/\.[^/.]+$/, '') || activeTest.instanceName || '';
          const base = String(file.name || '').replace(/\.[^/.]+$/, '');
          const suffix = results.length > 1 ? `spectrum${i + 1}` : 'spectrum';
          const name = withExtension(
            suggestDriveFileName({ ...driveCtx, instance: instanceForFile, title: base, suffix }),
            file.name || 'jws'
          );
          await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...driveCtx, instance: instanceForFile, title: base, suffix } });
          driveSaved++;
        } catch (err) { console.warn('Jasco Drive archive failed:', err && err.message); }
      }
    }
    setJascoMsg(driveConnected
      ? (driveSaved === results.length
          ? `✅ Imported ${results.length} file(s) — all saved to Google Drive.`
          : `⚠️ Imported ${results.length} file(s) — ${driveSaved} saved to Google Drive. Drive access expired or unavailable: reconnect Google Drive, then use “Archive spectra to Drive” to save the raw file(s).`)
      : `⚠️ Imported ${results.length} file(s) — Google Drive was not connected at that moment (the access token may have expired), so the raw file(s) were only kept in this browser's cache. Reconnect Google Drive from the sidebar, then use “Archive spectra to Drive” or re-import to save them on Drive too.`);
    if (jascoFileRef.current) jascoFileRef.current.value = '';
  };

  const handlePasteImport = () => {
    if (!jascoText.trim()) {
      setJascoMsg('⚠️ Please paste some text first.');
      return;
    }
    try {
      const parsed = parseJascoCDText(jascoText);
      applyJasco(parsed, null);
      setJascoText('');
    } catch (err) {
      setJascoMsg(`⚠️ Error parsing text: ${err.message}`);
      console.error('Jasco paste parse error:', err);
    }
  };

  const mwSource = (() => {
    const manual = parseManual(activeTest.manualMW);
    if (manual && manual > 0) return 'manual';
    return mw ? 'compound' : null;
  })();
  const thetaMode = CD_THETA_MODES.includes(activeTest.thetaMode) ? activeTest.thetaMode : 'mre';
  const residues = activeInstance ? getResidueCount(activeInstance, ctx) : null;
  const residueSource = activeInstance ? residueCountSource(activeInstance, ctx) : null;
  const needsN = CD_THETA_NEEDS_N.includes(thetaMode);
  const meFactor = activeInstance ? cdConversionFactor(activeInstance, mw, residues) : null;
  // The mdeg → [θ] factor is ALWAYS applied to the raw mdeg values: converting
  // the already converted columns a second time (e.g. after switching the target
  // unit) compounded the factor and — worse — overwrote the raw backup with
  // converted numbers, so "Revert to raw mdeg" could not bring the mdeg data
  // back and the Y axis kept showing the converted magnitudes.
  const thetaBaseline = (test) => {
    const t = test || {};
    return t.yUnit === 'theta' && Array.isArray(t.rawSpectraColumns)
      ? t.rawSpectraColumns
      : (Array.isArray(t.spectraColumns) ? t.spectraColumns : []);
  };
  const scaledColumns = (cols, factor) => cols.map((c) => ({
    ...c, data: String(c.data || '').split(/[\n,]+/).map((s) => { const n = parseFloat(String(s).trim()); return Number.isFinite(n) ? String(n * factor) : s; }).join('\n')
  }));
  const convertToMolarEllipticity = () => {
    if (!mw) { alert('Molecular weight is required. Select a compound with a defined MW or fill the manual MW field.'); return; }
    if (!meFactor) {
      if (needsN && !residues) { alert(`Set the number of residues (N) to convert to ${thetaUnitLabel(thetaMode)}.`); return; }
      alert('Fill the concentration and cuvette path length in the Experimental Conditions section of this tab.'); return;
    }
    const baseline = thetaBaseline(activeTest);
    if (!baseline.length) { alert('This condition has no spectrum to convert — import or paste one first.'); return; }
    if (!window.confirm(`Convert all spectra of the ACTIVE condition to ${thetaUnitLabel(thetaMode)}?\nThe raw spectra are kept as a backup (revert button).`)) return;
    updateActiveTest({ spectraColumns: scaledColumns(baseline, meFactor), rawSpectraColumns: baseline, yUnit: 'theta', thetaMode, thetaResidues: residues || undefined });
  };
  const convertAllInstances = () => {
    if (!window.confirm(`Convert the spectra of ALL conditions to ${thetaUnitLabel(thetaMode)} using each tab's own concentration / path length / MW?`)) return;
    let done = 0, skippedN = 0;
    instances.forEach((inst) => {
      const t = inst.test || {};
      const instMw = getMWForInstance(inst, ctx);
      const instRes = getResidueCount(inst, ctx);
      const instMode = CD_THETA_MODES.includes(t.thetaMode) ? t.thetaMode : thetaMode;
      const factor = cdConversionFactor(inst, instMw, instRes, instMode);
      // Always recompute from the raw mdeg columns (see thetaBaseline) so the
      // unit can be changed for every condition without compounding the factor
      // or clobbering the raw backup.
      const baseline = thetaBaseline(t);
      if (!factor || !baseline.length) {
        if (CD_THETA_NEEDS_N.includes(instMode) && !instRes) skippedN++;
        return;
      }
      patchInstance(ctx, activeTest, inst.id, { spectraColumns: scaledColumns(baseline, factor), rawSpectraColumns: baseline, yUnit: 'theta', thetaMode: instMode, thetaResidues: instRes || undefined });
      done++;
    });
    alert(`Converted ${done} condition(s) to ${thetaUnitLabel(thetaMode)}${skippedN ? ` — ${skippedN} skipped (no residue count for the per-residue unit).` : ''}.`);
  };
  const revertConversion = () => {
    if (!Array.isArray(activeTest.rawSpectraColumns) || !activeTest.rawSpectraColumns.length) {
      alert('No raw mdeg backup is stored for this condition — re-import the original spectrum (or undo) to get the raw values back.');
      return;
    }
    updateActiveTest({ spectraColumns: activeTest.rawSpectraColumns, rawSpectraColumns: undefined, thetaSpectraColumns: activeTest.spectraColumns, yUnit: 'mdeg' });
  };
  const restoreMolarEllipticity = () => {
    if (!Array.isArray(activeTest.thetaSpectraColumns) || !activeTest.thetaSpectraColumns.length) {
      alert('No converted spectra are stored for this condition — convert it to [θ] / Δε first.');
      return;
    }
    updateActiveTest({ spectraColumns: activeTest.thetaSpectraColumns, rawSpectraColumns: activeTest.spectraColumns, thetaSpectraColumns: undefined, yUnit: 'theta' });
  };

  const [blankId, setBlankId] = useState('');
  const [blankScope, setBlankScope] = useState('all'); 
  const canRevertBlank = blankScope === 'current'
    ? !!(activeInstance && Array.isArray(activeInstance.test.preBlankSpectraColumns))
    : instances.some((i) => Array.isArray(i.test.preBlankSpectraColumns));
  const applyBlankSubtraction = () => {
    const blank = instances.find((i) => i.id === blankId);
    if (!blank) { alert('Select the blank condition.'); return; }
    const blankParsed = computeParsed(blank.test);
    if (!blankParsed.parsedWavelengths.length || !blankParsed.parsedSpectra.length) { alert('The blank condition has no spectrum.'); return; }
    const targets = blankScope === 'current'
      ? (activeInstance && activeInstance.id !== blankId ? [activeInstance] : [])
      : instances.filter((i) => i.id !== blankId);
    if (!targets.length) { alert(blankScope === 'current' ? 'The active condition is the blank itself — switch to another condition first.' : 'No other conditions to subtract from.'); return; }
    const scopeLabel = blankScope === 'current' ? `the current condition ("${activeInstance.name}")` : 'ALL spectra of every other condition';
    if (!window.confirm(`Subtract the first spectrum of "${blank.name}" from ${scopeLabel}? A backup is kept so this can be reverted.`)) return;
    let touched = 0;
    targets.forEach((inst) => {
      const parsed = computeParsed(inst.test);
      if (!parsed.parsedWavelengths.length || !parsed.parsedSpectra.length) return;
      const blankYs = parsed.parsedWavelengths.map((x) => valueAtWavelength(blankParsed, 0, x));
      const cols = (inst.test.spectraColumns || []).map((c, ci) => {
        const specVals = parsed.parsedSpectra[ci] ? parsed.parsedSpectra[ci].values : [];
        return {
          ...c,
          data: parsed.parsedWavelengths.map((x, i) => {
            const v = specVals[i]; const b = blankYs[i];
            if (!Number.isFinite(v)) return '';
            if (!Number.isFinite(b)) return String(v);
            return String(v - b);
          }).join('\n')
        };
      });
      const backup = Array.isArray(inst.test.preBlankSpectraColumns) ? inst.test.preBlankSpectraColumns : (inst.test.spectraColumns || []);
      patchInstance(ctx, activeTest, inst.id, { spectraColumns: cols, preBlankSpectraColumns: backup, blankSubtractedFrom: blank.name });
      touched++;
    });
    alert(`Blank subtracted from ${touched} condition(s).`);
  };
  const revertBlankSubtraction = () => {
    const targets = (blankScope === 'current'
      ? (activeInstance ? [activeInstance] : [])
      : instances
    ).filter((i) => Array.isArray(i.test.preBlankSpectraColumns));
    if (!targets.length) { alert('Nothing to revert.'); return; }
    if (!window.confirm(`Revert blank subtraction for ${targets.length} condition(s)?`)) return;
    targets.forEach((inst) => {
      patchInstance(ctx, activeTest, inst.id, { spectraColumns: inst.test.preBlankSpectraColumns, preBlankSpectraColumns: undefined, blankSubtractedFrom: undefined });
    });
  };

  const [mathA, setMathA] = useState('');
  const [mathB, setMathB] = useState('');
  const [mathOp, setMathOp] = useState('subtract');
  const [mathFactor, setMathFactor] = useState('1');
  const [mathConstant, setMathConstant] = useState('0');
  const [mathScope, setMathScope] = useState('single');
  const mathOptions = useMemo(() => {
    const out = [];
    instances.forEach((inst) => {
      const parsed = computeParsed(inst.test);
      parsed.parsedSpectra.forEach((s, idx) => out.push({ key: `${inst.id}|${idx}`, label: `${inst.name} — ${s.title || `Spectrum ${idx + 1}`}` }));
    });
    return out;
  }, [instances]);
  const parseMathSel = (key) => {
    if (!key) return null;
    const [instId, idxStr] = key.split('|');
    const inst = instances.find((i) => i.id === instId);
    if (!inst) return null;
    return { inst, idx: parseInt(idxStr, 10) };
  };
  const canRevertMath = instances.some((i) => Array.isArray(i.test.preMathSpectraColumns));
  const applyMathOperation = () => {
    const A = parseMathSel(mathA);
    if (!A) { alert('Select spectrum A.'); return; }

    let factor = null, constant = null, B = null, parsedB = null;
    if (mathOp === 'multiply') {
      factor = parseManual(mathFactor);
      if (factor === null) { alert('Enter a valid factor.'); return; }
    } else if (mathOp === 'addConstant') {
      constant = parseManual(mathConstant);
      if (constant === null) { alert('Enter a valid constant.'); return; }
    } else {
      B = parseMathSel(mathB);
      if (!B) { alert('Select spectrum B.'); return; }
      parsedB = computeParsed(B.inst.test);
      if (!parsedB.parsedSpectra[B.idx]) { alert('Spectrum B not found.'); return; }
    }

    const targets = mathScope === 'all'
      ? instances.flatMap((inst) => computeParsed(inst.test).parsedSpectra.map((_, idx) => ({ inst, idx })))
      : [A];
    if (!targets.length) { alert('No spectra to apply to.'); return; }

    const opLabel = mathOp === 'multiply' ? `× ${factor}` : mathOp === 'addConstant' ? `+ ${constant}` : mathOp === 'add' ? '+ B' : '− B';
    const scopeLabel = mathScope === 'all' ? `ALL ${targets.length} spectra (every condition)` : 'spectrum A only';
    if (!window.confirm(`Apply "${opLabel}" to ${scopeLabel}? A backup is kept so this can be reverted.`)) return;

    let touched = 0;
    targets.forEach(({ inst, idx }) => {
      const parsed = computeParsed(inst.test);
      const spec = parsed.parsedSpectra[idx];
      if (!spec) return;
      const xs = parsed.parsedWavelengths;
      const bYs = parsedB ? xs.map((x) => valueAtWavelength(parsedB, B.idx, x)) : null;
      const newYs = spec.values.map((v, i) => {
        if (!Number.isFinite(v)) return v;
        if (mathOp === 'multiply') return v * factor;
        if (mathOp === 'addConstant') return v + constant;
        const bv = bYs ? bYs[i] : undefined;
        if (!Number.isFinite(bv)) return v;
        return mathOp === 'add' ? v + bv : v - bv;
      });
      const cols = (inst.test.spectraColumns || []).map((c, ci) => ci === idx ? { ...c, data: newYs.map((v) => (Number.isFinite(v) ? String(v) : '')).join('\n') } : c);
      const backup = Array.isArray(inst.test.preMathSpectraColumns) ? inst.test.preMathSpectraColumns : (inst.test.spectraColumns || []);
      patchInstance(ctx, activeTest, inst.id, { spectraColumns: cols, preMathSpectraColumns: backup });
      touched++;
    });
    alert(`Operation applied to ${touched} spectrum/spectra.`);
  };
  const revertMathOperation = () => {
    const targets = instances.filter((i) => Array.isArray(i.test.preMathSpectraColumns));
    if (!targets.length) { alert('Nothing to revert.'); return; }
    if (!window.confirm(`Revert the last math operation(s) for ${targets.length} condition(s)?`)) return;
    targets.forEach((inst) => {
      patchInstance(ctx, activeTest, inst.id, { spectraColumns: inst.test.preMathSpectraColumns, preMathSpectraColumns: undefined });
    });
  };

  const exportCSV = () => {
    const allWl = new Set();
    const seriesDefs = [];
    instances.forEach((inst) => {
      const parsed = computeParsed(inst.test);
      parsed.parsedWavelengths.forEach((w) => allWl.add(w));
      parsed.parsedSpectra.forEach((s) => seriesDefs.push({ inst, spec: s, parsed }));
    });
    if (!allWl.size) { alert('No data to export.'); return; }
    const wls = [...allWl].sort((a, b) => a - b);
    const header = ['Wavelength (nm)', ...seriesDefs.map(({ inst, spec }) => `${inst.name} — ${spec.title}`)];
    const rows = wls.map((w) => {
      const row = [w];
      seriesDefs.forEach(({ spec, parsed }) => {
        const i = parsed.parsedWavelengths.indexOf(w);
        row.push(i >= 0 && Number.isFinite(spec.values[i]) ? spec.values[i] : '');
      });
      return row;
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CD_${(activeTest.name || 'data').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    document.body.appendChild(a);
    a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const INPUT_CLS = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
  const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';

  return (
    <CollapsibleSection title="Data" icon="📂" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-purple-800 uppercase">Editing condition:</span>
          <span className="text-sm font-black text-purple-900">{activeInstance ? activeInstance.name : '—'}</span>
          {['concentration', 'pathLength', 'temperature', 'ph', 'solvent', 'bufferName', 'additiveName'].map((k) => {
            const v = getExpValue(activeInstance, k);
            if (v === '') return null;
            const f = CD_EXPERIMENTAL_FIELDS.find((x) => x.key === k);
            const u = f ? getExpUnit(activeInstance, f) : '';
            return <span key={k} className="text-[10px] font-bold bg-white border border-purple-200 text-purple-700 px-2 py-0.5 rounded-full">{f ? f.label : k}: {v}{u ? ` ${u}` : ''}</span>;
          })}
          <span className="text-[9px] text-purple-400 ml-auto">Switch condition using the tabs at the top of the page.</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-slate-700">Spectra — condition "{activeInstance ? activeInstance.name : '—'}"</h4>
            <div className="flex gap-2">
              <button type="button" onClick={addSpectrumColumn} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">+ Add Spectrum</button>
              <button type="button" onClick={exportCSV} className="bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm hover:bg-emerald-100">📊 Export CSV (all conditions)</button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL_CLS}>Wavelengths (nm) — comma, space or newline separated</label>
            <textarea
              value={activeTest.wavelengthData || ''} onChange={(e) => updateWavelengthData(e.target.value)} placeholder={'190, 191, 192, ...'}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-blue-500 h-20 custom-scrollbar"
            />
            <span className="text-[10px] text-slate-400">{activeParsed.parsedWavelengths.length} valid wavelengths parsed.</span>
          </div>
          {spectraColumns.map((col, idx) => (
            <div key={col.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input type="color" value={col.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length]} onChange={(e) => patchColumn(col.id, { color: e.target.value })} className="w-7 h-7 rounded cursor-pointer border border-slate-300" title="Series color" />
                <input type="text" value={col.title || ''} onChange={(e) => patchColumn(col.id, { title: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold flex-1 min-w-[140px] outline-none focus:border-blue-500" />
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={col.visible !== false} onChange={(e) => patchColumn(col.id, { visible: e.target.checked })} className="w-3.5 h-3.5 accent-blue-600" /> Visible
                </label>
                <button type="button" onClick={() => removeSpectrumColumn(col.id)} className="text-red-500 hover:text-red-700 font-black text-sm px-1" title="Remove spectrum">×</button>
              </div>
              <textarea
                value={col.data || ''} onChange={(e) => patchColumn(col.id, { data: e.target.value })} placeholder="CD values (comma or newline separated), same order as wavelengths"
                className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-blue-500 h-16 custom-scrollbar bg-white"
              />
            </div>
          ))}
          {spectraColumns.length === 0 && <div className="text-xs text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center">No spectra yet. Add a spectrum manually or import a Jasco file below.</div>}
        </div>

        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-sky-900">📥 Jasco Import (.txt / .csv / .jws)</h4>
            <span className="text-[9px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded font-bold">imports into the ACTIVE condition</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors">
              📄 Choose Jasco file(s)…
              <input ref={jascoFileRef} type="file" accept=".txt,.csv,.jws" multiple onChange={handleJascoFile} className="hidden" />
            </label>
            <DriveUploadButton
              suggestedName={suggestDriveFileName({
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || '',
                instance: activeTest.instanceName || '',
                section: 'Data',
                subsection: 'Spectra',
                suffix: 'spectrum'
              })}
              naming={{
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || '',
                instance: activeTest.instanceName || '',
                scientist: activeTest.operator || '',
                section: 'Data',
                subsection: 'Spectra',
                suffix: 'spectrum'
              }}
              accept=".txt,.csv,.jws"
              label="⬆ Archive spectra to Drive"
              className="bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100"
            />
            <span className="text-[10px] text-sky-700">…or paste the file content below and press Import. Metadata (temperature, cell length, scan settings…) is auto-filled into the Experimental Conditions and Instrumental Setup sections.</span>
          </div>
          <textarea
            value={jascoText} onChange={(e) => setJascoText(e.target.value)} placeholder={'Paste Jasco export here (metadata block + XYDATA)…'}
            className="w-full border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 h-24 custom-scrollbar bg-white"
          />
       <div className="flex items-center gap-3">
         <button type="button" onClick={handlePasteImport} disabled={!jascoText.trim()} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">Import pasted data</button>
         {jascoMsg && <span className="text-xs font-bold text-sky-900">{jascoMsg}</span>}
       </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <h4 className="text-sm font-bold text-slate-700">🧮 Ellipticity conversion — [θ] / Δε</h4>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Convert to:</span>
            <div className="flex flex-wrap rounded-lg overflow-hidden border border-slate-200 bg-white">
              {[
                { id: 'mre', label: 'MRE [θ]ᵣ', title: 'Mean residue ellipticity per residue: MW/(10·c·l·N)' },
                { id: 'molar', label: 'Molar [θ]ₘ', title: 'Molar ellipticity per molecule: MW/(10·c·l)' },
                { id: 'deps', label: 'Δε', title: 'Molar circular dichroism per molecule: MW/(3298.2·10·c·l)' },
                { id: 'depsRes', label: 'Δεᵣ', title: 'Circular dichroism per residue: MW/(3298.2·10·c·l·N)' }
              ].map((opt) => (
                <button key={opt.id} type="button" title={opt.title}
                        onClick={() => updateActiveTest({ thetaMode: opt.id })}
                        className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${thetaMode === opt.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Compound MW (from Library)</label>
              <div className="border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
                {compoundMW ? `${Number(compoundMW.value).toLocaleString()} Da` : 'Not found for selected compound'}
              </div>
              {compoundMW && <span className="text-[9px] text-slate-400">Auto-retrieved from "{compoundMW.compound}"</span>}
              {!compoundMW && <span className="text-[9px] text-amber-600">Select a compound with a defined MW, or set a manual override.</span>}
              {compoundMW && mwSource === 'manual' && (
                <button type="button" onClick={() => updateActiveTest({ manualMW: '' })} className="text-[10px] font-bold text-blue-600 hover:text-blue-800 text-left">↺ Use compound MW instead of override</button>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Manual MW override (Da)</label>
              <input type="number" onWheel={(e) => e.target.blur()} value={activeTest.manualMW || ''} onChange={(e) => updateActiveTest({ manualMW: e.target.value })} placeholder={compoundMW ? `auto: ${compoundMW.value}` : 'optional'} className={INPUT_CLS} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Number of residues (N){needsN ? ' *' : ''}</label>
              <input type="number" min="1" onWheel={(e) => e.target.blur()} value={activeTest.manualResidues || ''} onChange={(e) => updateActiveTest({ manualResidues: e.target.value })}
                     placeholder={residues ? String(residues) : 'required for ' + (thetaMode === 'mre' ? 'MRE' : 'Δεᵣ')} className={INPUT_CLS} />
              {residueSource === 'manual' ? (
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] text-slate-400">Manual override: N = {residues}</span>
                  {compoundMW && <button type="button" onClick={() => updateActiveTest({ manualResidues: '' })} className="text-[9px] font-bold text-blue-600 hover:text-blue-800">↺ Use compound N</button>}
                </div>
              ) : residueSource ? (
                <span className="text-[9px] text-slate-400">Auto from "{residueSource}": N = {residues}</span>
              ) : (
                <span className="text-[9px] text-amber-600">Not available — set N for MRE / Δεᵣ.</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Conversion factor (this tab)</label>
              <div className="border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
                {meFactor ? `${meFactor.toPrecision(4)} / mdeg` : needsN && !residues ? '— need N' : '— need conc + path + MW'}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={convertToMolarEllipticity} className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm">Convert ACTIVE → {thetaUnitTag(thetaMode)}</button>
              <button type="button" onClick={convertAllInstances} className="bg-violet-50 border border-violet-300 text-violet-700 hover:bg-violet-100 font-bold px-3 py-2 rounded-lg text-xs shadow-sm">Convert ALL conditions → {thetaUnitTag(thetaMode)}</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className={`text-xs font-bold px-2 py-1 rounded ${yUnit === 'theta' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'}`}>
              Current Y unit: {yUnit === 'theta' ? thetaUnitLabel(thetaModeOf(activeTest)) : 'Ellipticity (mdeg)'}
            </span>
            {yUnit === 'theta' && !Array.isArray(activeTest.rawSpectraColumns) && (
              <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                ⚠️ No raw mdeg backup stored for this condition — re-import the original spectrum to get the raw values back.
              </span>
            )}
            {yUnit === 'theta' && Array.isArray(activeTest.rawSpectraColumns) && (
              <button type="button" onClick={revertConversion} className="text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg shadow-sm">↩️ Revert to raw mdeg</button>
            )}
            {yUnit === 'mdeg' && Array.isArray(activeTest.thetaSpectraColumns) && (
              <button type="button" onClick={restoreMolarEllipticity} className="text-xs font-bold bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 px-3 py-1.5 rounded-lg shadow-sm">↪️ Restore converted spectra</button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <h4 className="text-sm font-bold text-slate-700">🧹 Blank Subtraction</h4>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Blank condition</label>
              <select value={blankId} onChange={(e) => setBlankId(e.target.value)} className={INPUT_CLS}>
                <option value="">-- select blank --</option>
                {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Apply to</label>
              <select value={blankScope} onChange={(e) => setBlankScope(e.target.value)} className={INPUT_CLS}>
                <option value="all">All conditions</option>
                <option value="current">This condition only ({activeInstance ? activeInstance.name : '—'})</option>
              </select>
            </div>
            <button type="button" onClick={applyBlankSubtraction} className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">Subtract blank</button>
            {canRevertBlank && (
              <button type="button" onClick={revertBlankSubtraction} className="bg-white border border-red-300 text-red-600 hover:bg-red-50 font-bold px-4 py-2 rounded-lg text-xs shadow-sm">↩️ Revert blank subtraction</button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <h4 className="text-sm font-bold text-slate-700">🔧 Math Operations (A + B, A − B, A × factor, A + constant)</h4>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Spectrum A (target)</label>
              <select value={mathA} onChange={(e) => setMathA(e.target.value)} className={`${INPUT_CLS} max-w-[240px]`}>
                <option value="">-- select A --</option>
                {mathOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Operation</label>
              <select value={mathOp} onChange={(e) => setMathOp(e.target.value)} className={INPUT_CLS}>
                <option value="subtract">A − B</option>
                <option value="add">A + B</option>
                <option value="multiply">A × factor</option>
                <option value="addConstant">A + constant</option>
              </select>
            </div>
            {mathOp === 'multiply' ? (
              <div className="flex flex-col gap-1">
                <label className={LABEL_CLS}>Factor</label>
                <input type="number" step="0.1" onWheel={(e) => e.target.blur()} value={mathFactor} onChange={(e) => setMathFactor(e.target.value)} className={`${INPUT_CLS} w-24`} />
              </div>
            ) : mathOp === 'addConstant' ? (
              <div className="flex flex-col gap-1">
                <label className={LABEL_CLS}>Constant</label>
                <input type="number" step="0.1" onWheel={(e) => e.target.blur()} value={mathConstant} onChange={(e) => setMathConstant(e.target.value)} className={`${INPUT_CLS} w-24`} />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className={LABEL_CLS}>Spectrum B</label>
                <select value={mathB} onChange={(e) => setMathB(e.target.value)} className={`${INPUT_CLS} max-w-[240px]`}>
                  <option value="">-- select B --</option>
                  {mathOptions.filter((o) => o.key !== mathA).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className={LABEL_CLS}>Apply to</label>
              <select value={mathScope} onChange={(e) => setMathScope(e.target.value)} className={INPUT_CLS}>
                <option value="single">Spectrum A only</option>
                <option value="all">All spectra (every condition)</option>
              </select>
            </div>
            <button type="button" onClick={applyMathOperation} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">Apply</button>
            {canRevertMath && (
              <button type="button" onClick={revertMathOperation} className="bg-white border border-blue-300 text-blue-600 hover:bg-blue-50 font-bold px-4 py-2 rounded-lg text-xs shadow-sm">↩️ Revert last operation</button>
            )}
          </div>
        </div>

        <SpectraVisualization ctx={ctx} />

      </div>
    </CollapsibleSection>
  );
};

// =========================================================================
// CDSections.jsx - REPLACE SpectraVisualization COMPONENT
// =========================================================================
export const SpectraVisualization = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  const { instances } = d;

  const cfg = { ...DEFAULT_CHART_STYLE, ...(activeTest.vizCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ vizCfg: { ...cfg, ...patch } });

  const [showCfg, setShowCfg] = useState(false);
  const [fs, setFs] = useState(false);
  const [fsSmall, setFsSmall] = useState(null);
  // The conditions taken OUT of the figures: ONE `hiddenSeries` map per
  // experiment (the very key the Flow Cytometry panel has always used), so an
  // exclusion survives a page switch and reaches BOTH the overlaid chart and
  // the split view — the stack then strikes the row through and the 📷 figure
  // leaves it out (see SplitChartStack / ChartStarLayer).
  const hiddenSeries = hiddenSeriesOf(activeTest);
  const toggleHiddenSeries = (key) => updateActiveTest({ hiddenSeries: withoutSeries(activeTest, key) });
  // “Split view” — one graph per condition, stacked in a single card that is
  // captured / starred as ONE image (data-star-group). Persisted on the test so
  // the layout survives page switches (same keys as the FCS split view).
  const [splitStack, setSplitStack] = useState(!!activeTest.splitStack);
  const [splitSharedY, setSplitSharedY] = useState(!!activeTest.splitSharedY);
  // Character size of the stacked sub-charts: it follows the page's shared style
  // cfg, so the global “Figure style” profile (🎨) reaches the split figure too
  // and every character of a captured stack matches the other figures.
  const splitFontSize = Math.max(9, Number(tickSize(cfg)) || 16);
  const toggleSplitStack = () => setSplitStack((v) => {
    const nv = !v;
    updateActiveTest({ splitStack: nv });
    return nv;
  });
  const toggleSplitSharedY = () => setSplitSharedY((v) => {
    const nv = !v;
    updateActiveTest({ splitSharedY: nv });
    return nv;
  });
  // The SHAPE of each sub-chart (width : height, 0 = the default 375 px box)
  // and the SEPARATION between the graphs (px). Read from the experiment on
  // every render and written straight back — the same value pattern as this
  // page's chart style cfg — so the layout survives a page switch.
  const splitLayout = splitLayoutOf(activeTest);
  const changeSplitLayout = (patch) => updateActiveTest({ splitLayout: withSplitLayout(activeTest, patch) });
  // Single click zooms a small spectrum, double click edits it: the single click
  // is delayed so a double click can cancel it (see deferredClick).
  const smallClickTimer = useRef(null);

  const [localColors, setLocalColors] = useState(activeTest.instanceColors || {});
  const [customPaletteInput, setCustomPaletteInput] = useState('#ef4444, #3b82f6, #22c55e');

  const applyPalette = (paletteKey) => {
    let palette;
    if (paletteKey === 'custom') {
      palette = customPaletteInput.split(',').map(s => s.trim()).filter(s => /^#([0-9A-F]{3}){1,2}$/i.test(s));
      if (!palette.length) return alert('Enter valid hex codes (e.g. #ff0000, #00ff00)');
    } else {
      palette = VIS_PALETTES[paletteKey] || VIS_PALETTES.default;
    }
    const nextColors = { ...localColors };
    instances.forEach((inst, idx) => { nextColors[inst.id] = palette[idx % palette.length]; });
    setLocalColors(nextColors);
    updateActiveTest({ instanceColors: nextColors });
  };

  const seriesList = useMemo(() => {
    const out = [];
    instances.forEach((inst, idx) => {
      const parsed = computeParsed(inst.test);
      parsed.parsedSpectra.forEach((s) => {
        if (s.visible === false || !s.values.length) return;
        out.push({
          key: `${inst.id}__${s.id}`,
          label: `${inst.name} — ${s.title || 'Spectrum'}`,
          color: localColors[inst.id] || s.color || SPECTRA_PALETTE[idx % SPECTRA_PALETTE.length],
          active: inst.id === activeTest.id,
          yUnit: inst.test.yUnit || 'mdeg',
          data: parsed.parsedWavelengths.map((w, i) => ({ x: w, y: Number.isFinite(s.values[i]) ? s.values[i] : null })).filter((p) => p.y !== null)
        });
      });
    });
    return out;
  }, [instances, activeTest.id, localColors]);

  const visible = seriesList.filter((s) => !hiddenSeries[s.key]);
  const allXs = visible.flatMap((s) => s.data.map((p) => p.x));
  const padX = allXs.length ? ((Math.max(...allXs) - Math.min(...allXs)) * 0.03 || 1) : 1;
  const dataDomain = allXs.length ? [Math.min(...allXs) - padX, Math.max(...allXs) + padX] : [190, 260];

  const allYs = visible.flatMap((s) => s.data.map((p) => p.y));
  const yDataMin = allYs.length ? Math.min(...allYs) : 0;
  const yDataMax = allYs.length ? Math.max(...allYs) : 1;

  // Converted ([θ]/Δε) and raw mdeg conditions share one numeric axis, so the
  // converted magnitudes squash the mdeg curves flat — surface the mix instead
  // of letting the mdeg data look empty on a "mdeg" Y axis.
  const unitLabelForInst = (instId) => {
    const inst = instances.find((i) => i.id === instId);
    const t = inst ? inst.test : null;
    return t && t.yUnit === 'theta' ? thetaUnitShort(thetaModeOf(t)) : 'Ellipticity (mdeg)';
  };
  const visibleUnitLabels = [...new Set(visible.map((s) => unitLabelForInst(String(s.key).split('__')[0])))];
  const mixedUnits = visibleUnitLabels.length > 1;

  const chartRef = useRef(null);
  // Combined X + Y mouse zoom: drag horizontally to zoom the wavelength axis,
  // vertically to zoom the intensity axis.
  const zoom = useXYZoom(chartRef, dataDomain, [yDataMin, yDataMax], cfgChartMargin(cfg, CHART_MARGIN));
  const yLabel = activeTest.yUnit === 'theta' ? thetaUnitShort(thetaModeOf(activeTest)) : 'Ellipticity (mdeg)';
  const xLabel = cfg.xAxisLabel || 'Wavelength (nm)';
  const yLab = cfg.yAxisLabel || yLabel;

  const xScale = cfgLogScale(cfg, 'x');
  const yScale = cfgLogScale(cfg, 'y');
  const xDomain = cfgAxisDomain(cfg, 'x', zoom.xDomain);
  const yMinV = dom(cfg.yMin), yMaxV = dom(cfg.yMax);
  const hasManualY = yMinV != null || yMaxV != null;
  const yDomain = yScale === 'log'
    ? [(yMinV != null && yMinV > 0 ? yMinV : 1e-3), (yMaxV != null ? yMaxV : 'auto')]
    : hasManualY ? [yMinV ?? yDataMin, yMaxV ?? yDataMax] : zoom.yDomain;

  const chartBody = (
    <ChartInspector
      containerRef={chartRef}
      containerProps={{ onMouseDown: zoom.onMouseDown }}
      style={fs ? { flex: 1, minHeight: 0 } : chartBoxStyle(cfg, { square: false, yTitle: yLab })}
      className={`bg-white border border-slate-200 rounded-xl p-3 select-none relative ${fs ? 'w-full' : ''}`}
      cfg={cfg}
      setCfg={setCfg}
      series={seriesList}
      figureKind="spectra"
    >
      {zoom.isZoomed && <button type="button" onClick={zoom.reset} className="absolute top-2 right-2 z-10 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
      {cfg.title && <h4 className="text-sm font-bold text-slate-700 mb-1">{cfg.title}</h4>}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={cfgChartMargin(cfg, CHART_MARGIN)}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow scale={xScale} ticks={cfgAxisTicks(cfg, 'x', xDomain)} tick={<AngledTick angle={cfg.tickAngle} fontSize={tickSize(cfg)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} formatter={cfgTickFormatter(cfg, 'x') || undefined} />} tickMargin={10} label={cfgAxisLabel(cfg, 'x', xLabel)} />
          <YAxis type="number" domain={yDomain} allowDataOverflow scale={yScale} ticks={yMinV != null && yMaxV != null ? cfgAxisTicks(cfg, 'y', [yMinV, yMaxV]) : undefined} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fill: '#64748b' })} label={cfgAxisLabel(cfg, 'y', yLab)} />
          <Tooltip />
          {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg, { paddingBottom: 8 })} />}
          {visible.map((s) => cfgSeriesEl(cfg, { key: s.key, data: s.data, dataKey: 'y', name: s.label, stroke: cfg.colors?.[s.key] || s.color }))}
          {zoom.ref && (zoom.ref.axis === 'x'
            ? <ReferenceArea x1={zoom.ref.x1} x2={zoom.ref.x2} strokeOpacity={0.3} fill="#cbd5e1" />
            : <ReferenceArea y1={zoom.ref.y1} y2={zoom.ref.y2} strokeOpacity={0.3} fill="#cbd5e1" />)}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartInspector>
  );

  return (
    <div className="flex flex-col gap-4 border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200">
        <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
        <div className="flex flex-wrap items-center gap-2">
          <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 outline-none cursor-pointer min-w-[180px]">
            <option value="">🎨 Apply Palette...</option>
            {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
          </select>
          <span className="text-slate-300 hidden md:inline">|</span>
          <input type="text" placeholder="#f00, #0f0..." value={customPaletteInput} onChange={e => setCustomPaletteInput(e.target.value)} className="text-sm border border-slate-300 px-2.5 py-1.5 rounded-lg w-36 outline-none focus:border-blue-500" />
          <button onClick={() => applyPalette('custom')} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap">Apply Custom</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-700">📈 Spectra Visualization — all conditions overlaid</h4>
        <div className="flex gap-2 flex-wrap items-center">
          <InstanceLinkToggle activeTest={activeTest} updateActiveTest={updateActiveTest} />
          <SplitToggle on={splitStack} onToggle={toggleSplitStack} sharedY={splitSharedY} onToggleSharedY={toggleSplitSharedY} />
          {splitStack && <SplitLayoutControls layout={splitLayout} onChange={changeSplitLayout} />}
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
          <button type="button" onClick={() => setFs(!fs)} className="font-bold py-1.5 px-3 rounded-lg text-xs border border-slate-300 bg-white text-slate-800 hover:bg-slate-50">{fs ? '↙️ Exit' : '↗️ Fullscreen'}</button>
        </div>
      </div>
      {seriesList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {seriesList.map((s) => (
            <label key={s.key} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold border cursor-pointer ${hiddenSeries[s.key] ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-200 text-slate-700'}`}>
              <input type="checkbox" checked={!hiddenSeries[s.key]} onChange={() => toggleHiddenSeries(s.key)} className="w-3.5 h-3.5 accent-blue-600" />
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              <span className="truncate max-w-[220px]">{s.label}</span>
            </label>
          ))}
        </div>
      )}
      {mixedUnits && (
        <div className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ This overlay mixes Y units ({visibleUnitLabels.join(' · ')}). A single numeric axis is scaled to the largest unit, so the conditions shown in mdeg look flat.
          {' '}Use the checkboxes above to hide the converted series, or run “Convert ALL conditions” so every condition shares one unit.
        </div>
      )}
      {fs && <div className={OVERLAY_CLASSES} onClick={() => setFs(false)} />}
      <div className={`${fs ? FS_CLASSES + ' p-6 flex' : 'flex'} flex-col${splitStack ? ' lg:flex-row gap-3' : ''}`}>
        <div className={`flex flex-col${splitStack && !fs ? ' lg:w-[54%] min-w-0' : ''}${fs ? ' flex-1 min-h-0' : ''}`}>
          {fs && (
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h3 className="font-bold text-slate-700">CD Spectra — all conditions</h3>
              <button type="button" onClick={() => setFs(false)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">↙️</button>
            </div>
          )}
          {chartBody}
        </div>
        {splitStack && (
          // The box of ONE sub-chart is sized by its ROW: splitRowBoxStyle adds
          // the strip the X ruler needs to the row that keeps it (the bottom
          // one), so the ruler is the last thing of the pack and every lane —
          // the last included — keeps the height the Height knob asks for.
          <SplitChartStack
            id="cd-split"
            label="Split view — individual spectra"
            series={seriesList}
            excluded={hiddenSeries}
            onToggleExclude={toggleHiddenSeries}
            layout={splitLayout}
            className={fs ? 'lg:w-[46%]' : 'w-full lg:w-[46%]'}
            renderChart={(s, i, count) => (
              <div style={splitRowBoxStyle(splitLayout, i, count)} className={splitChartClass(splitLayout)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={s.data} margin={splitChartMargin(splitLayout, cfgChartMargin(cfg, { top: 5, right: 8, bottom: 18, left: 2 }), i, count)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" dataKey="x" tick={{ fontSize: splitFontSize, fill: tickColorOf(cfg) }} domain={['dataMin', 'dataMax']} hide={splitXAxisHidden(splitLayout, i, count)} />
                    <YAxis {...splitYAxisProps(splitLayout, 44)} domain={splitSharedY ? [yDataMin, yDataMax] : ['dataMin', 'dataMax']} tick={{ fontSize: splitFontSize, fill: tickColorOf(cfg) }} />
                    <Line type="monotone" dataKey="y" stroke={s.color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          />
        )}
      </div>
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={seriesList.map((s) => ({ key: s.key, label: s.label, color: s.color }))} unit="nm" />}
      
      {seriesList.length > 0 && (
        <div className="mt-2 p-4 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
          <h5 className="text-xs font-black text-slate-700 uppercase mb-3 border-b border-slate-200 pb-2">Individual Spectra</h5>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {seriesList.map((s) => (
              <React.Fragment key={s.key}>
                {fsSmall === s.key && <div className={OVERLAY_CLASSES} onClick={() => setFsSmall(null)} />}
                <div className={`flex flex-col bg-white ${fsSmall === s.key ? FS_CLASSES + ' p-6' : 'relative aspect-square p-2 cursor-pointer hover:shadow-lg transition-shadow border border-slate-200 rounded-lg group'}`} onClick={fsSmall !== s.key ? deferredClick(smallClickTimer, () => setFsSmall(s.key)) : undefined}>
                  <div className="flex justify-between items-start mb-1 z-10">
                    <h4 className="text-xs font-bold text-slate-600 uppercase truncate w-[80%]" title={s.label}>{s.label}</h4>
                    <button className={fsSmall === s.key ? 'text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5' : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 bg-slate-50 rounded p-1 text-xs'} onClick={(e) => { e.stopPropagation(); setFsSmall(fsSmall === s.key ? null : s.key); }}>{fsSmall === s.key ? '↙️' : '↗️'}</button>
                  </div>
                  <ChartInspector cfg={cfg} setCfg={setCfg} figureKind="spectra"
                    series={seriesList.map((x) => ({ key: x.key, label: x.label, color: x.color }))}
                    unit="nm" className="flex-1 relative min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.data} margin={fsSmall === s.key ? cfgChartMargin(cfg, CHART_MARGIN) : { top: 5, right: 8, bottom: 18, left: 2 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" dataKey="x" tick={tickTextProps(cfg, { fontSize: fsSmall === s.key ? tickSize(cfg) : 9, fill: '#64748b' })} domain={['dataMin', 'dataMax']} label={fsSmall === s.key ? cfgAxisLabel(cfg, 'x', xLabel) : undefined} />
                        <YAxis domain={[yDataMin, yDataMax]} tick={tickTextProps(cfg, { fontSize: fsSmall === s.key ? tickSize(cfg) : 9, fill: '#64748b' })} width={fsSmall === s.key ? 60 : 38} label={fsSmall === s.key ? cfgAxisLabel(cfg, 'y', yLab) : undefined} />
                        {fsSmall === s.key && <Tooltip />}
                        <Line type="monotone" dataKey="y" stroke={s.color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartInspector>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ========================================================================
DATA ANALYSIS — FITTING (DYNAMIC PURE COMPONENTS)
======================================================================== */
// `components` lets the manual-entry card reuse this ring with its own extra
// bucket ("Other") while the fitter keeps the CD_FIT_COMPONENTS palette.
const DonutSS = ({ res, components = CD_FIT_COMPONENTS }) => {
  const bases = res.activeBases || ['alpha', 'beta', 'turn', 'coil'];
  const data = bases.map((k) => ({
    name: components[k]?.label || k,
    value: res.fractions ? res.fractions[k] : res[k],
    color: components[k]?.color || '#cbd5e1'
  })).filter((x) => x.value > 0);

  if (!data.length) return <p className="text-xs text-slate-400 italic">No composition to display yet.</p>;
  
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="82%" paddingAngle={2} label={(p) => `${p.name} ${p.value}%`} labelLine={false}>
            {data.map((entry, i) => <Cell key={i} fill={entry.color} stroke="#fff" strokeWidth={2} />)}
          </Pie>
          <Tooltip formatter={(v) => `${v} %`} />
          <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export const SpectrumFitting = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  const { instances } = d;
  const [fitInstId, setFitInstId] = useState(activeTest.id);
  const [fitSpecIdx, setFitSpecIdx] = useState(0);
  const [msg, setMsg] = useState('');
  const [fsFit, setFsFit] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [selectedFitBases, setSelectedFitBases] = useState(['alpha', 'beta', 'turn', 'coil']);
  // The condition tabs at the top of the page drive this panel: switching
  // instance must retarget the "Target Condition" dropdown to that instance
  // instead of leaving the previous condition selected (or silently falling
  // back to the first one when the previous id is no longer available).
  // Keyed on activeTest.id only, so a manual selection survives re-renders.
  useEffect(() => {
    setFitInstId((prev) => (prev === activeTest.id ? prev : activeTest.id));
    setFitSpecIdx(0);
  }, [activeTest.id]);
  const [fitMethod, setFitMethod] = useState('pure'); // 'pure' | 'classical'
  const [classicalOpts, setClassicalOpts] = useState({ nRefs: 400, topK: 30, ridge: 1e-5 });
  const patchClassicalOpts = (patch) => setClassicalOpts((prev) => ({ ...prev, ...patch }));
  
  const cfg = { ...DEFAULT_CHART_STYLE, ...(activeTest.vizCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ vizCfg: { ...cfg, ...patch } });

  const fitInst = instances.find((i) => i.id === fitInstId) || instances[0];
  const fitParsed = useMemo(() => computeParsed(fitInst ? fitInst.test : null), [fitInst]);
  const spec = fitParsed.parsedSpectra[fitSpecIdx] || fitParsed.parsedSpectra[0] || null;

  const savedFit = useMemo(() => {
    if (!fitInst || !spec) return null;
    const fits = fitInst.test.ssFits || {};
    return fits[spec.id] || null;
  }, [fitInst, spec]);

  const toggleBase = (k) => {
    setSelectedFitBases((prev) => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]);
  };

  const runFit = () => {
    if (!fitInst || !spec) { setMsg('Select a condition and a spectrum.'); return; }
    if (selectedFitBases.length === 0) { setMsg('Select at least one component to fit.'); return; }
    
    // Unit-aware options: the fit scales the MRE reference components into the
    // unit the experimental spectra were converted to (mdeg → unit scale 1,
    // letting scaleK absorb the raw scale).
    const unitOpts = fitInst.test.yUnit === 'theta'
      ? { thetaMode: thetaModeOf(fitInst.test), residues: fitInst.test.thetaResidues || getResidueCount(fitInst, ctx) }
      : { thetaMode: 'mre', residues: null };
    
    // Catch the detailed response object — dispatch to the selected algorithm
    const res = fitMethod === 'classical'
      ? fitCdSpectrumClassical(fitParsed.parsedWavelengths, spec.values, selectedFitBases, { ...classicalOpts, ...unitOpts })
      : fitCdSpectrum(fitParsed.parsedWavelengths, spec.values, selectedFitBases, unitOpts);
    
    // Display specific errors to the user if the math fails
    if (res.error) { 
       setMsg(`⚠️ ${res.error}`); 
       return; 
    }
    
    const stored = {
      fractions: res.fractions, activeBases: res.activeBases,
      scaleK: res.scaleK, r2: res.r2, nPoints: res.nPoints,
      savedAt: new Date().toLocaleString(),
      method: res.method || 'pure',
      algorithm: res.algorithm,
      nRefs: res.nRefs, refsUsed: res.refsUsed,
      thetaMode: res.thetaMode, residues: res.residues,
      alpha: res.fractions.alpha || 0, beta: res.fractions.beta || 0, turn: res.fractions.turn || 0, coil: res.fractions.coil || 0
    };
    
    const ssFits = { ...(fitInst.test.ssFits || {}), [spec.id]: stored };
    const structureComposition = {};
    res.activeBases.forEach(k => { structureComposition[CD_FIT_COMPONENTS[k]?.label || k] = res.fractions[k]; });
    
    patchInstance(ctx, activeTest, fitInst.id, { ssFits, structureComposition });
    
    // Output exactly which wavelengths were successfully overlapped and fitted
    const methodLabel = res.method === 'classical'
      ? `Classical NNLS (${res.nRefs} refs, ${res.refsUsed} used)`
      : 'Pure-component';
    const unitTag = fitInst.test.yUnit === 'theta' ? ` · unit: ${thetaUnitShort(thetaModeOf(fitInst.test))}` : '';
    setMsg(`✅ ${methodLabel} fit stored — R² = ${res.r2.toFixed(4)} (${res.nPoints} pts, ${res.fitMin}-${res.fitMax}nm)${unitTag}.`);
  };

  const deleteFit = (inst, specId) => {
    const ssFits = { ...(inst.test.ssFits || {}) };
    delete ssFits[specId];
    patchInstance(ctx, activeTest, inst.id, { ssFits });
  };

  const expData = useMemo(() => {
    if (!spec) return [];
    return fitParsed.parsedWavelengths.map((w, i) => ({ x: w, y: Number.isFinite(spec.values[i]) ? spec.values[i] : null })).filter((p) => p.y !== null);
  }, [spec, fitParsed]);
  const simData = useMemo(() => {
    // A manual composition has no fitted scale factor, so there is no curve to
    // reconstruct from it (see the manual-entry card below).
    if (!savedFit || savedFit.manual || !spec) return [];
    return buildSimulatedCurve(savedFit, fitParsed.parsedWavelengths);
  }, [savedFit, fitParsed, spec]);

  const overlayRef = useRef(null);
  const allXs = [...expData.map((p) => p.x), ...simData.map((p) => p.x)];
  const padX = allXs.length ? ((Math.max(...allXs) - Math.min(...allXs)) * 0.03 || 1) : 1;
  const resolvedXDomain = [dom(cfg.xMin) !== undefined ? dom(cfg.xMin) : (allXs.length ? Math.min(...allXs) - padX : 190), dom(cfg.xMax) !== undefined ? dom(cfg.xMax) : (allXs.length ? Math.max(...allXs) + padX : 260)];
  const zoomFit = useXZoom(overlayRef, resolvedXDomain, cfgChartMargin(cfg, CHART_MARGIN));

  const allSaved = useMemo(() => {
    const out = [];
    instances.forEach((inst) => {
      const parsed = computeParsed(inst.test);
      Object.entries(inst.test.ssFits || {}).forEach(([specId, res]) => {
        const s = parsed.parsedSpectra.find((x) => x.id === specId);
        out.push({ inst, specId, title: s ? (s.title || 'Spectrum') : specId, res });
      });
    });
    return out;
  }, [instances]);

  return (
    <div className="flex flex-col gap-4 border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-700">🧬 Fitting — Secondary Structure Decomposition</h4>
        <div className="flex gap-2 items-center">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
          <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${fitMethod === 'classical' ? 'bg-cyan-100 text-cyan-800' : 'bg-purple-100 text-purple-800'}`}>
            {fitMethod === 'classical' ? 'Classical Reference Deconvolution' : 'Customizable Pure Components'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">Method:</span>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 bg-white">
          <button type="button" onClick={() => setFitMethod('pure')}
                  className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${fitMethod === 'pure' ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  title="Fits the spectrum directly to the built-in pure component splines (adaptive ridge least squares)">
            🎯 Pure components
          </button>
          <button type="button" onClick={() => setFitMethod('classical')}
                  className={`px-3 py-1.5 text-[11px] font-bold transition-colors ${fitMethod === 'classical' ? 'bg-cyan-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  title="Classical reference-set deconvolution (CONTIN / CDSSTR / SELCON style): NNLS fit on a database of reference spectra with known composition">
            📚 Classical (reference NNLS)
          </button>
        </div>
        {fitMethod === 'classical' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
              Reference spectra
              <input type="number" min="20" max="1000" step="10" value={classicalOpts.nRefs}
                     onChange={(e) => patchClassicalOpts({ nRefs: parseInt(e.target.value, 10) || 400 })}
                     className="w-20 border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white outline-none focus:border-cyan-500 font-semibold" />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500" title="Variable selection: keep only the references most similar to the spectrum">
              Top similar
              <input type="number" min="2" max="200" step="1" value={classicalOpts.topK}
                     onChange={(e) => patchClassicalOpts({ topK: parseInt(e.target.value, 10) || 30 })}
                     className="w-16 border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white outline-none focus:border-cyan-500 font-semibold" />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500" title="Ridge regularization on the normal-equation diagonal (CONTIN-style)">
              Ridge (×10⁻⁵)
              <input type="number" min="0" max="1000" step="1" value={Math.round((classicalOpts.ridge ?? 1e-5) * 1e5)}
                     onChange={(e) => patchClassicalOpts({ ridge: (parseFloat(e.target.value) || 0) * 1e-5 })}
                     className="w-16 border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white outline-none focus:border-cyan-500 font-semibold" />
            </label>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-slate-500 uppercase">1. Select Reference Components to Fit</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CD_FIT_COMPONENTS).map(([k, def]) => (
              <label key={k} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer ${selectedFitBases.includes(k) ? 'bg-blue-50 border-blue-200 text-blue-800 font-bold shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                <input type="checkbox" checked={selectedFitBases.includes(k)} onChange={() => toggleBase(k)} className="w-3.5 h-3.5 accent-blue-600" />
                <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: def.color}} />
                {def.label}
              </label>
            ))}
          </div>
        </div>
        
        <div className="flex flex-wrap items-end gap-3 mt-2 border-t border-slate-200 pt-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">2. Target Condition</label>
            <select value={fitInst ? fitInst.id : ''} onChange={(e) => { setFitInstId(e.target.value); setFitSpecIdx(0); }} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Spectrum Slot</label>
            <select value={fitSpecIdx} onChange={(e) => setFitSpecIdx(parseInt(e.target.value, 10))} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
              {fitParsed.parsedSpectra.map((s, i) => <option key={s.id} value={i}>{s.title || `Spectrum ${i + 1}`}</option>)}
            </select>
          </div>
          <button type="button" onClick={runFit} className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">✨ Fit Spectrum</button>
          {msg && <span className="text-xs font-bold text-slate-700">{msg}</span>}
        </div>
      </div>

      {savedFit && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {(savedFit.activeBases || ['alpha', 'beta', 'turn', 'coil']).map((k) => {
                const val = savedFit.fractions ? savedFit.fractions[k] : savedFit[k];
                return (
                  <div key={k} className="bg-white border border-slate-200 rounded-lg p-3 text-center shadow-sm">
                    <div className="text-[10px] font-bold uppercase truncate" style={{ color: CD_FIT_COMPONENTS[k]?.color || '#64748b' }} title={CD_FIT_COMPONENTS[k]?.label || k}>{CD_FIT_COMPONENTS[k]?.label || k}</div>
                    <div className="text-xl font-black text-slate-800">{val}%</div>
                  </div>
                );
              })}
            </div>
            {savedFit.manual ? (
              <p className="text-xs text-slate-500">
                <b className="text-amber-700">Manual composition</b> — percentages typed in the manual-entry card, not fitted (no R², no scale factor). Saved {savedFit.savedAt}.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Fit quality: <b>R² = {Number(savedFit.r2 || 0).toFixed(4)}</b> · {savedFit.nPoints} points · scale k = {Number(savedFit.scaleK || 0).toFixed(4)}
                {savedFit.method === 'classical'
                  ? ` · method: classical NNLS (${savedFit.nRefs} refs, ${savedFit.refsUsed} used)` : ''} · saved {savedFit.savedAt}
              </p>
            )}
            <DonutSS res={savedFit} />
          </div>

          <div className="flex flex-col">
            {fsFit && <div className={OVERLAY_CLASSES} onClick={() => setFsFit(false)} />}
            <div className={`flex flex-col ${fsFit ? FS_CLASSES + ' p-6' : ''}`}>
              <div className="flex justify-between items-center mb-2 shrink-0">
                <span className="text-xs font-bold text-slate-600 uppercase">Experimental vs Simulated</span>
                <button type="button" onClick={() => setFsFit(!fsFit)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 text-[10px]">{fsFit ? '↙️' : '↗️'}</button>
              </div>
              <div ref={overlayRef} onMouseDown={zoomFit.onMouseDown} style={fsFit ? { flex: 1, minHeight: 0 } : chartBoxStyle(cfg, { square: false })} className="bg-white border border-slate-200 rounded-xl p-3 select-none relative">
                {zoomFit.isZoomed && <button type="button" onClick={zoomFit.reset} className="absolute top-2 right-2 z-10 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
                {cfg.title && <h4 className="text-sm font-bold text-slate-700 mb-1">{cfg.title}</h4>}
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart margin={cfgChartMargin(cfg, CHART_MARGIN)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" dataKey="x" domain={cfgAxisDomain(cfg, 'x', zoomFit.domain)} allowDataOverflow scale={cfgLogScale(cfg, 'x')} ticks={cfgAxisTicks(cfg, 'x', cfgAxisDomain(cfg, 'x', zoomFit.domain))} tick={<AngledTick angle={cfg.tickAngle} fontSize={tickSize(cfg)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} formatter={cfgTickFormatter(cfg, 'x') || undefined} />} tickMargin={10} label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || 'Wavelength (nm)')} />
                    <YAxis type="number" domain={cfgLogScale(cfg, 'y') === 'log'
                        ? [((dom(cfg.yMin) != null && dom(cfg.yMin) > 0) ? dom(cfg.yMin) : 1e-3), (dom(cfg.yMax) != null ? dom(cfg.yMax) : 'auto')]
                        : [dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']}
                      allowDataOverflow scale={cfgLogScale(cfg, 'y')} ticks={dom(cfg.yMin) != null && dom(cfg.yMax) != null ? cfgAxisTicks(cfg, 'y', [dom(cfg.yMin), dom(cfg.yMax)]) : undefined} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fill: '#64748b' })} label={cfgAxisLabel(cfg, 'y', cfg.yAxisLabel || ((fitInst && fitInst.test.yUnit === 'theta') ? thetaUnitShort(thetaModeOf(fitInst.test)) : 'Ellipticity (mdeg)'))} />
                    {cfgSeriesEl(cfg, { key: 'exp', data: expData, dataKey: 'y', name: 'Experimental', stroke: cfg.colors?.exp || '#3b82f6' })}
                    {!savedFit.manual && cfgSeriesEl(cfg, { key: 'sim', data: simData, dataKey: 'y', name: 'Simulated (fit)', stroke: cfg.colors?.sim || '#ef4444' })}
                    <Tooltip />
                    {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg, { fontSize: cfg.fontSize || 11 })} />}
                    {zoomFit.refLo !== null && zoomFit.refHi !== null && <ReferenceArea x1={zoomFit.refLo} x2={zoomFit.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">{savedFit.manual
                ? '💡 Blue = experimental. A manual composition has no reconstructed curve — run ✨ Fit Spectrum to overlay the spectrum rebuilt from the fit.'
                : `💡 Blue = experimental · Red dashed = reconstructed from the fit (${savedFit.method === 'classical' ? 'reference-set NNLS' : 'pure components'}). Drag to zoom.`}</p>
            </div>
          </div>
        </div>
      )}

      {allSaved.length > 0 && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg mt-4">
          <table className="w-full text-xs text-left bg-white">
            <thead className="bg-slate-100 text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Spectrum</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Composition</th>
                <th className="px-3 py-2">R²</th>
                <th className="px-3 py-2">Saved</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allSaved.map((row) => (
                <tr key={`${row.inst.id}-${row.specId}`}>
                  <td className="px-3 py-1.5 font-bold text-slate-700">{row.inst.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{row.title}</td>
                  <td className="px-3 py-1.5 text-[11px] whitespace-nowrap">
                    {row.res.manual
                      ? <span className="font-bold text-amber-700" title="Typed by hand in the manual composition card">Manual</span>
                      : row.res.method === 'classical'
                        ? <span className="font-bold text-cyan-700" title={`${row.res.nRefs} reference spectra, ${row.res.refsUsed} used`}>Classical NNLS</span>
                        : <span className="font-bold text-purple-700">Pure comp.</span>}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] leading-tight">
                    {(row.res.activeBases || ['alpha', 'beta', 'turn', 'coil']).map(k => {
                      const v = row.res.fractions ? row.res.fractions[k] : row.res[k];
                      if (!v) return null;
                      return <span key={k} style={{color: CD_FIT_COMPONENTS[k]?.color, marginRight: '8px', whiteSpace: 'nowrap'}}>{CD_FIT_COMPONENTS[k]?.label}: <b>{v}%</b></span>;
                    })}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{row.res.manual ? '—' : Number(row.res.r2 || 0).toFixed(4)}</td>
                  <td className="px-3 py-1.5 text-slate-400">{row.res.savedAt}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button type="button" onClick={() => deleteFit(row.inst, row.specId)} className="text-red-500 hover:text-red-700 font-black px-2" title="Delete fit">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[{ key: 'exp', label: 'Experimental', color: '#3b82f6' }, { key: 'sim', label: 'Simulated (fit)', color: '#ef4444' }]} unit="nm" />}
    </div>
  );
};

/* ========================================================================
DATA ANALYSIS — MANUAL SECONDARY-STRUCTURE COMPOSITION (RING CHART)
======================================================================= */
// The fitter derives the SS percentages from the spectrum; this card lets the
// same percentages be typed in directly (literature values, another method, a
// teaching exercise) so they can feed the ring chart without running a fit.
// Saving writes the per-condition `structureComposition` (what the notebook
// doughnut reads) plus a `ssFits` entry flagged `manual`, so the fitter's ring
// chart, composition cards, saved-fits table and the "SS % vs condition" plots
// show the manual values too — always labelled as manual, never as fitted.
const MANUAL_SS_BASES = ['alpha', 'beta', 'turn', 'coil'];
const MANUAL_SS_EXTRA_BASES = ['aDNA', 'bDNA', 'zDNA', 'gqP', 'gqH', 'gqA'];
const MANUAL_SS_COMPONENTS = { ...CD_FIT_COMPONENTS, other: { label: 'Other', color: '#8b5cf6' } };
const MANUAL_SS_KEY_BY_LABEL = Object.entries(MANUAL_SS_COMPONENTS).reduce((acc, [k, def]) => { acc[def.label] = k; return acc; }, {});
const manualSSSeed = (composition) => {
  const out = {};
  Object.entries(composition || {}).forEach(([label, v]) => {
    const key = MANUAL_SS_KEY_BY_LABEL[String(label)] || (String(label).trim().toLowerCase() === 'other' ? 'other' : null);
    const n = parseFloat(String(v).trim());
    if (key && Number.isFinite(n)) out[key] = String(n);
  });
  return out;
};

const ManualSSComposition = ({ ctx }) => {
  const { activeTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  const { instances } = d;
  const [instId, setInstId] = useState(activeTest.id);
  const [specIdx, setSpecIdx] = useState(0);
  // Draft = { sig, vals }: `vals` are the numbers currently in the boxes, `sig`
  // is the condition+composition signature they were seeded from. When the
  // target changes the stale draft is simply ignored and the boxes fall back to
  // the newly stored composition — ordinary re-renders therefore can never wipe
  // what the user is typing (the instances array is rebuilt on every render).
  const [draft, setDraft] = useState({ sig: null, vals: null });
  const [showExtras, setShowExtras] = useState(false);
  const [msg, setMsg] = useState('');

  const inst = instances.find((i) => i.id === instId) || instances[0] || null;
  const instParsed = useMemo(() => computeParsed(inst ? inst.test : null), [inst]);
  const spec = instParsed.parsedSpectra[specIdx] || instParsed.parsedSpectra[0] || null;
  const ssFits = (inst && inst.test && inst.test.ssFits) || {};
  const storedFit = spec ? (ssFits[spec.id] || null) : null;
  const composition = (inst && inst.test && inst.test.structureComposition) || {};

  // The condition tabs drive this card too: switching condition retargets it.
  useEffect(() => {
    setInstId((prev) => (prev === activeTest.id ? prev : activeTest.id));
    setSpecIdx(0);
    setMsg('');
  }, [activeTest.id]);

  const seedSig = `${inst ? inst.id : ''}|${JSON.stringify(composition)}`;
  const vals = draft.sig === seedSig ? draft.vals : manualSSSeed(composition);
  const setVals = (next) => setDraft({ sig: seedSig, vals: next });
  const setVal = (key, v) => setVals({ ...vals, [key]: v });

  const numOf = (k) => {
    const n = parseFloat(String(vals[k] ?? '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // The nucleic-acid / G-quadruplex rows appear as soon as one of them carries a
  // value (e.g. a previously fitted composition), or when the user opens them.
  const extrasInUse = MANUAL_SS_EXTRA_BASES.some((k) => numOf(k) > 0);
  const visibleKeys = [...MANUAL_SS_BASES, ...((showExtras || extrasInUse) ? MANUAL_SS_EXTRA_BASES : []), 'other'];
  const enteredKeys = visibleKeys.filter((k) => numOf(k) > 0);
  const total = enteredKeys.reduce((sum, k) => sum + numOf(k), 0);
  const preview = { activeBases: enteredKeys, fractions: Object.fromEntries(enteredKeys.map((k) => [k, numOf(k)])) };
  // Entries this card cannot edit (older / foreign labels) are kept on save.
  const untouched = Object.fromEntries(Object.entries(composition).filter(([label]) => !MANUAL_SS_KEY_BY_LABEL[String(label)] && String(label).trim().toLowerCase() !== 'other'));

  const normalize = () => {
    if (!enteredKeys.length) { setMsg('⚠️ Enter at least one percentage first.'); return; }
    const factor = 100 / total;
    const rounded = enteredKeys.map((k) => ({ k, v: Math.round(numOf(k) * factor * 10) / 10 }));
    // Per-box rounding can leave 99.9 / 100.1 behind; move the residue onto the
    // largest component so the freshly normalized total is exactly 100.0 %.
    const residue = Math.round((100 - rounded.reduce((sum, x) => sum + x.v, 0)) * 10) / 10;
    const biggest = rounded.reduce((a, b) => (b.v > a.v ? b : a), rounded[0]);
    const next = { ...vals };
    rounded.forEach((x) => { next[x.k] = String(x.k === biggest.k ? Math.round((x.v + residue) * 10) / 10 : x.v); });
    setVals(next);
    setMsg(`✅ Normalized to 100 % (was ${total.toFixed(1)} %).`);
  };

  const clearAll = () => { setVals({}); setMsg(''); };

  const loadStored = () => {
    if (!storedFit) { setMsg('⚠️ Nothing stored for this spectrum yet — type the values or run a fit.'); return; }
    const src = storedFit.fractions || storedFit;
    const next = {};
    (storedFit.activeBases || MANUAL_SS_BASES).forEach((k) => {
      const n = parseFloat(String(src[k]).trim());
      if (Number.isFinite(n)) next[k] = String(n);
    });
    if (Object.keys(next).some((k) => MANUAL_SS_EXTRA_BASES.includes(k))) setShowExtras(true);
    setVals(next);
    setMsg(storedFit.manual ? '↺ Loaded the stored manual composition.' : '↺ Loaded the stored fitted composition.');
  };

  const save = () => {
    if (!inst) return;
    if (!enteredKeys.length) { setMsg('⚠️ Enter at least one component percentage.'); return; }
    const fractions = Object.fromEntries(enteredKeys.map((k) => [k, Math.round(numOf(k) * 10) / 10]));
    const sum = enteredKeys.reduce((acc, k) => acc + fractions[k], 0);
    if (Math.abs(sum - 100) > 0.05 && !window.confirm(`The entered composition totals ${sum.toFixed(1)} % instead of 100 %. Save it anyway?`)) return;
    if (storedFit && !storedFit.manual && !window.confirm('A fitted composition is stored for this spectrum. Replace it with the manual composition?')) return;
    const structureComposition = { ...untouched };
    enteredKeys.forEach((k) => { structureComposition[MANUAL_SS_COMPONENTS[k].label] = fractions[k]; });
    const updates = { structureComposition };
    if (spec) {
      updates.ssFits = {
        ...ssFits,
        [spec.id]: { manual: true, fractions, activeBases: enteredKeys, method: 'manual', algorithm: 'manual', savedAt: new Date().toLocaleString() }
      };
    }
    patchInstance(ctx, activeTest, inst.id, updates);
    setMsg(`✅ Composition saved for ${inst.name}${spec ? ` — ${spec.title || 'Spectrum'}` : ''} (total ${sum.toFixed(1)} %).`);
  };

  const totalBadge = total > 0
    ? (Math.abs(total - 100) < 0.05 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700')
    : 'bg-slate-50 border-slate-200 text-slate-500';

  return (
    <div className="flex flex-col gap-4 border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-700">🥧 Composition — Manual Entry (Ring Chart)</h4>
          <span className="text-xs font-bold text-slate-500 uppercase">Type the secondary-structure % directly · no fitting required</span>
        </div>
        <button type="button" onClick={() => setShowExtras((v) => !v)}
                className="text-[10px] font-bold px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                title="Also expose the nucleic-acid / G-quadruplex components">
          {showExtras ? '− DNA / G-quadruplex components' : '+ DNA / G-quadruplex components'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Target Condition</label>
              <select value={inst ? inst.id : ''} onChange={(e) => { setInstId(e.target.value); setSpecIdx(0); setMsg(''); }}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Spectrum Slot</label>
              <select value={specIdx} onChange={(e) => setSpecIdx(parseInt(e.target.value, 10))}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                {instParsed.parsedSpectra.length
                  ? instParsed.parsedSpectra.map((s, i) => <option key={s.id} value={i}>{s.title || `Spectrum ${i + 1}`}</option>)
                  : <option value={0}>No spectrum</option>}
              </select>
            </div>
            <button type="button" onClick={loadStored}
                    className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold px-3 py-2 rounded-lg text-xs shadow-sm"
                    title="Copy the composition currently stored for the selected spectrum into the boxes">
              ↺ Load stored composition
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {visibleKeys.map((k) => {
              const def = MANUAL_SS_COMPONENTS[k];
              return (
                <label key={k} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: def.color }} />
                  <span className="text-[10px] font-bold uppercase text-slate-500 truncate flex-1" title={def.label}>{def.label}</span>
                  <input type="number" min="0" max="100" step="0.1" value={vals[k] ?? ''} placeholder="0"
                         onChange={(e) => setVal(k, e.target.value)}
                         className="w-16 border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white outline-none focus:border-blue-500 font-semibold text-right" />
                  <span className="text-[10px] font-bold text-slate-400">%</span>
                </label>
              );
            })}
          </div>
          {/* totals + actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
            <span className={`text-xs font-bold px-2 py-1 rounded border ${totalBadge}`}>
              Total: {total.toFixed(1)} %{enteredKeys.length ? '' : ' — nothing entered'}
            </span>
            <button type="button" onClick={normalize}
                    className="bg-slate-100 border border-slate-300 text-slate-700 hover:bg-slate-200 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm"
                    title="Rescale the entered values so they add up to exactly 100 %">
              ⚖️ Normalize to 100 %
            </button>
            <button type="button" onClick={clearAll}
                    className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">
              🧹 Clear
            </button>
            <button type="button" onClick={save}
                    className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs shadow-sm">
              💾 Save composition
            </button>
            {msg && <span className="text-xs font-bold text-slate-700">{msg}</span>}
          </div>
          {Object.keys(untouched).length > 0 && (
            <p className="text-[10px] font-bold text-amber-700">
              ⚠️ {Object.keys(untouched).length} stored entry(ies) this card cannot edit ({Object.keys(untouched).join(', ')}) — they are preserved as they are when you save.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <DonutSS res={preview} components={MANUAL_SS_COMPONENTS} />
          <p className="text-[10px] text-slate-400">
            💡 Saving stores this composition on <b>{inst ? inst.name : 'this condition'}</b>{spec ? ` for “${spec.title || 'Spectrum'}”` : ''}. It drives the secondary-structure ring chart of the notebook preview and the condition plots (Y = SS %), and it shows up in the fitter above as a composition flagged <b>Manual</b> (no fit quality, no reconstructed curve).
          </p>
          {storedFit
            ? <span className="text-[10px] font-bold text-slate-500">Stored for this spectrum: {storedFit.manual ? 'manual entry' : `fitted (R² = ${Number(storedFit.r2 || 0).toFixed(4)})`} · {storedFit.savedAt || 'unknown date'}</span>
            : spec && <span className="text-[10px] font-bold text-slate-400">Nothing stored for this spectrum yet — the ring chart above previews what you type.</span>}
        </div>
      </div>
    </div>
  );
};

/* ========================================================================
CONDITION PLOTS (Dynamic Component Graphing)
======================================================================== */
const defaultCdConditionPlot = (n) => ({
  id: makeId('cdplot'),
  title: `Condition Plot ${n}`,
  yMode: 'ss',
  specIdx: 0,
  lambda: '222',
  xField: 'temperature',
  // Up to 2 experimental-condition fields set as the plot's "variables". A
  // second entry switches the chart to a 3D (variable1 x variable2 x value) plot.
  xFields: ['temperature'],
  chartType: 'line',
  chartType3D: 'scatter',
  fitEnabled: false,
  fitModel: 'linear',
  customExpr: '',
  showPoints: true,
  showErrors: true,
  showFit: true,
  showMaxLines: false,
  hLines: [],
  useFixedSD: false,
  fixedSDStr: '',
  showExcl: false,
  outlierThreshStr: '2.5',
  hiddenSeries: {},
  excluded: {},
  manualSD: {},
  usedInstances: {},
  style: { ...DEFAULT_CHART_STYLE }
});

/* ========================================================================
3D CONDITION SCATTER (isometric projection, pure SVG)
Used when a condition plot has 2 experimental-condition "variables" set —
renders variable1 x variable2 x value as a 3D scatter.
======================================================================== */
// Rotate a normalized (x,y,z) point by azimuth (around the vertical axis) and
// elevation (tilt), then orthographically project to screen space. Returns
// [screenX, screenY, depth] — depth is used for painter's-algorithm sorting so
// nearer elements draw on top of farther ones as the view rotates.
const rotateProject = (x, y, z, azimuth, elevation, cx, cy, scale) => {
  const X = x - 0.5, Y = y - 0.5, Z = z - 0.5;
  const cosA = Math.cos(azimuth), sinA = Math.sin(azimuth);
  const x1 = X * cosA - Y * sinA;
  const y1 = X * sinA + Y * cosA;
  const cosE = Math.cos(elevation), sinE = Math.sin(elevation);
  const y2 = y1 * cosE - Z * sinE;
  const z2 = y1 * sinE + Z * cosE;
  return [cx + x1 * scale, cy - z2 * scale, y2];
};

const shadeColor = (hex, percent) => {
  const h = (hex || '#3b82f6').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex || '#3b82f6';
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const amt = Math.round(2.55 * percent);
  r = Math.min(255, Math.max(0, r + amt));
  g = Math.min(255, Math.max(0, g + amt));
  b = Math.min(255, Math.max(0, b + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

const fmt3D = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) return v.toExponential(2);
  return String(Math.round(v * 1000) / 1000);
};

const Condition3DScatter = ({ series, colorOf, includedPts, xLabel, yLabel, zLabel, cfg, height = 380, chartType = 'scatter', setChartType }) => {
  const W = 640, H = Math.max(280, height || 380);
  const cx = W / 2, cy = H * 0.56;
  const scale = Math.min(W, H) * 0.62;

  const [azimuth, setAzimuth] = useState(-0.7);
  const [elevation, setElevation] = useState(0.55);
  const dragRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    const mv = (e) => {
      if (!dragRef.current) return;
      const { startX, startY, az0, el0 } = dragRef.current;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      setAzimuth(az0 + dx * 0.008);
      setElevation(Math.min(1.45, Math.max(-1.45, el0 - dy * 0.008)));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  const onMouseDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, az0: azimuth, el0: elevation };
  };
  const resetView = () => { setAzimuth(-0.7); setElevation(0.55); };

  const allPts = [];
  (series || []).forEach((s) => {
    const color = colorOf ? colorOf(s) : '#3b82f6';
    includedPts(s).forEach((p) => {
      if (Number.isFinite(p.x) && Number.isFinite(p.x2) && Number.isFinite(p.y)) {
        allPts.push({ x: p.x, y: p.x2, z: p.y, name: `${p.name} — ${s.label}`, color });
      }
    });
  });

  if (allPts.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
        Not enough spectra have numeric values on both variable axes to draw a 3D plot.
      </div>
    );
  }

  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y), zs = allPts.map((p) => p.z);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const zMin = Math.min(0, ...zs), zMax = Math.max(...zs, zMin + 1);
  const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1, zSpan = (zMax - zMin) || 1;

  const nPts = allPts.map((p) => ({
    ...p,
    nx: (p.x - xMin) / xSpan,
    ny: (p.y - yMin) / ySpan,
    nz: (p.z - zMin) / zSpan
  }));

  const proj = (x, y, z) => rotateProject(x, y, z, azimuth, elevation, cx, cy, scale);
  const fontSize = tickSize(cfg, 12);
  const titleFs = axisTitleSize(cfg, 14);
  const fam = fontFamilyOf(cfg);
  const ptSize = (cfg && cfg.ptSize) || 5;

  const AXIS_LEN = 1.12;
  const origin = proj(0, 0, 0);
  const xEnd = proj(AXIS_LEN, 0, 0);
  const yEnd = proj(0, AXIS_LEN, 0);
  const zEnd = proj(0, 0, AXIS_LEN);

  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const a = proj(t, 0, 0), b = proj(t, 1, 0);
    gridLines.push({ d: `M${a[0]},${a[1]} L${b[0]},${b[1]}`, depth: (a[2] + b[2]) / 2 });
    const c = proj(0, t, 0), e = proj(1, t, 0);
    gridLines.push({ d: `M${c[0]},${c[1]} L${e[0]},${e[1]}`, depth: (c[2] + e[2]) / 2 });
  }

  // Bar half-width in normalized data units, scaled loosely with point size.
  const hw = 0.02 + Math.min(0.05, (ptSize / 5) * 0.02);
  const bars = chartType === 'bar' ? nPts.map((p) => {
    const corners = {
      b00: [p.nx - hw, p.ny - hw, 0], b10: [p.nx + hw, p.ny - hw, 0],
      b11: [p.nx + hw, p.ny + hw, 0], b01: [p.nx - hw, p.ny + hw, 0],
      t00: [p.nx - hw, p.ny - hw, p.nz], t10: [p.nx + hw, p.ny - hw, p.nz],
      t11: [p.nx + hw, p.ny + hw, p.nz], t01: [p.nx - hw, p.ny + hw, p.nz]
    };
    const pr = {};
    let depthSum = 0, depthN = 0;
    Object.entries(corners).forEach(([k, [x, y, z]]) => { const r = proj(x, y, z); pr[k] = r; depthSum += r[2]; depthN++; });
    return { p, pr, depth: depthSum / depthN };
  }).sort((a, b) => a.depth - b.depth) : [];

  const pts3D = chartType === 'scatter' ? nPts.map((p) => {
    const top = proj(p.nx, p.ny, p.nz);
    const floor = proj(p.nx, p.ny, 0);
    return { p, top, floor, depth: top[2] };
  }).sort((a, b) => a.depth - b.depth) : [];

  const poly = (pr, keys) => keys.map((k) => pr[k].slice(0, 2).join(',')).join(' ');

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full cursor-grab active:cursor-grabbing" onMouseDown={onMouseDown}>
        {gridLines.sort((a, b) => a.depth - b.depth).map((g, i) => <path key={`gl${i}`} d={g.d} stroke="#e2e8f0" strokeWidth={1} fill="none" />)}

        {chartType === 'bar' && bars.map(({ p, pr }, i) => (
          <g key={i}>
            <polygon points={poly(pr, ['b10', 'b11', 't11', 't10'])} fill={shadeColor(p.color, -30)} stroke="white" strokeWidth={0.75} />
            <polygon points={poly(pr, ['b00', 'b10', 't10', 't00'])} fill={shadeColor(p.color, -15)} stroke="white" strokeWidth={0.75} />
            <polygon points={poly(pr, ['t00', 't10', 't11', 't01'])} fill={p.color} stroke="white" strokeWidth={0.75}>
              <title>{`${p.name}\n${xLabel}: ${fmt3D(p.x)}\n${yLabel}: ${fmt3D(p.y)}\n${zLabel}: ${fmt3D(p.z)}`}</title>
            </polygon>
          </g>
        ))}

        {chartType === 'scatter' && pts3D.map(({ p, top, floor }, i) => (
          <g key={i}>
            <line x1={floor[0]} y1={floor[1]} x2={top[0]} y2={top[1]} stroke={p.color} strokeWidth={1} strokeDasharray="2 2" opacity={0.4} />
            <circle cx={floor[0]} cy={floor[1]} r={2} fill={p.color} opacity={0.25} />
            <circle cx={top[0]} cy={top[1]} r={ptSize} fill={p.color} stroke="white" strokeWidth={1.5}>
              <title>{`${p.name}\n${xLabel}: ${fmt3D(p.x)}\n${yLabel}: ${fmt3D(p.y)}\n${zLabel}: ${fmt3D(p.z)}`}</title>
            </circle>
          </g>
        ))}

        <line x1={origin[0]} y1={origin[1]} x2={xEnd[0]} y2={xEnd[1]} stroke="#334155" strokeWidth={1.5} />
        <line x1={origin[0]} y1={origin[1]} x2={yEnd[0]} y2={yEnd[1]} stroke="#334155" strokeWidth={1.5} />
        <line x1={origin[0]} y1={origin[1]} x2={zEnd[0]} y2={zEnd[1]} stroke="#334155" strokeWidth={1.5} />
        <text x={xEnd[0]} y={xEnd[1] + 16} fontSize={titleFs} fontFamily={fam || undefined} fill="#334155" textAnchor="middle" fontWeight="bold">{xLabel}</text>
        <text x={yEnd[0]} y={yEnd[1] + 4} fontSize={titleFs} fontFamily={fam || undefined} fill="#334155" textAnchor="start" fontWeight="bold">{yLabel}</text>
        <text x={zEnd[0] - 8} y={zEnd[1] - 6} fontSize={titleFs} fontFamily={fam || undefined} fill="#334155" textAnchor="end" fontWeight="bold">{zLabel}</text>
        <text x={origin[0]} y={origin[1] + 16} fontSize={Math.max(8, fontSize - 3)} fill="#94a3b8" textAnchor="middle">{fmt3D(xMin)}</text>
        <text x={xEnd[0]} y={xEnd[1] + 30} fontSize={Math.max(8, fontSize - 3)} fill="#94a3b8" textAnchor="middle">{fmt3D(xMax)}</text>
        <text x={yEnd[0] - 4} y={yEnd[1] - 4} fontSize={Math.max(8, fontSize - 3)} fill="#94a3b8" textAnchor="end">{fmt3D(yMax)}</text>
        <text x={zEnd[0] - 8} y={zEnd[1] + 12} fontSize={Math.max(8, fontSize - 3)} fill="#94a3b8" textAnchor="end">{fmt3D(zMax)}</text>
      </svg>
      <div className="absolute top-1 right-1 flex gap-1">
        {setChartType && (
          <div className="flex rounded-lg overflow-hidden border border-slate-300 shadow-sm">
            <button type="button" onClick={() => setChartType('scatter')} className={`text-[10px] font-bold px-2 py-1 ${chartType === 'scatter' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Scatter</button>
            <button type="button" onClick={() => setChartType('bar')} className={`text-[10px] font-bold px-2 py-1 ${chartType === 'bar' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Bars (3D histogram)</button>
          </div>
        )}
        <button type="button" onClick={resetView} className="text-xs bg-white hover:bg-slate-50 border border-slate-300 text-slate-600 px-2 py-1 rounded-lg font-bold shadow-sm">Reset view</button>
      </div>
    </div>
  );
};

const ConditionPlotPanel = ({ d, plot, updatePlot, removePlot, duplicatePlot }) => {
  const cfg = { ...DEFAULT_CHART_STYLE, ...(plot.style || {}) };
  const set = (patch) => updatePlot(plot.id, patch);
  const setCfg = (patch) => updatePlot(plot.id, { style: { ...cfg, ...patch } });

  const [showErr, setShowErr] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [fs, setFs] = useState(false);
  const chartRef = useRef(null);

  const isHist = plot.chartType === 'hist';
  const validKey = (k) => CD_EXPERIMENTAL_FIELDS.some((f) => f.key === k);
  const rawXFields = Array.isArray(plot.xFields) && plot.xFields.length
    ? plot.xFields
    : (plot.xField ? [plot.xField] : []);
  const effXFields = (rawXFields.filter(validKey).slice(0, 2).length
    ? rawXFields.filter(validKey).slice(0, 2)
    : [CD_EXPERIMENTAL_FIELDS[0].key]);
  const effXField = effXFields[0];
  const is3D = effXFields.length === 2;
  const xFieldDef = CD_EXPERIMENTAL_FIELDS.find((f) => f.key === effXField);
  const xFieldLabel = xFieldDef ? xFieldDef.label : effXField;
  const xField2Def = is3D ? CD_EXPERIMENTAL_FIELDS.find((f) => f.key === effXFields[1]) : null;
  const xField2Label = xField2Def ? xField2Def.label : effXFields[1];
  const setXFields = (fields) => set({ xFields: fields, xField: fields[0] });
  const used = plot.usedInstances || {};

  const usedSSKeys = useMemo(() => {
    const set = new Set();
    d.instances.forEach((inst) => {
      if (used[inst.id] === false) return;
      const parsed = computeParsed(inst.test);
      const spec = parsed.parsedSpectra[plot.specIdx];
      if (!spec) return;
      const fitRes = (inst.test.ssFits || {})[spec.id];
      if (!fitRes) return;
      (fitRes.activeBases || ['alpha', 'beta', 'turn', 'coil']).forEach(k => set.add(k));
    });
    return Array.from(set);
  }, [d.instances, used, plot.specIdx]);

  const series = useMemo(() => {
    const out = [];
    const specTitleOf = (inst) => {
      const p = computeParsed(inst.test);
      const s = p.parsedSpectra[plot.specIdx];
      return s ? (s.title || `Spectrum ${plot.specIdx + 1}`) : `Spectrum ${plot.specIdx + 1}`;
    };
    if (plot.yMode === 'ss') {
      usedSSKeys.forEach((comp) => {
        const pts = [];
        d.instances.forEach((inst) => {
          if (used[inst.id] === false) return;
          const parsed = computeParsed(inst.test);
          const spec = parsed.parsedSpectra[plot.specIdx];
          if (!spec) return;
          const fitRes = (inst.test.ssFits || {})[spec.id];
          if (!fitRes) return;
          const yVal = fitRes.fractions ? fitRes.fractions[comp] : fitRes[comp];
          if (yVal === undefined) return;
          pts.push({ instId: inst.id, name: inst.name, x: parseXValue(getExpValue(inst, effXField)), rawX: getExpValue(inst, effXField), x2: is3D ? parseXValue(getExpValue(inst, effXFields[1])) : undefined, y: yVal });
        });
        out.push({
          key: `ss_${comp}`,
          label: `${CD_FIT_COMPONENTS[comp]?.label || comp} — ${specTitleOf(d.activeInstance || d.instances[0])}`,
          pts: pts.map((p) => ({ ...p, excluded: !!((plot.excluded[`ss_${comp}`] || {})[p.instId]) }))
        });
      });
    } else {
      const lam = parseManual(plot.lambda);
      const pts = [];
      if (lam !== null) {
        d.instances.forEach((inst) => {
          if (used[inst.id] === false) return;
          const parsed = computeParsed(inst.test);
          const v = valueAtWavelength(parsed, plot.specIdx, lam);
          if (v === null) return;
          pts.push({ instId: inst.id, name: inst.name, x: parseXValue(getExpValue(inst, effXField)), rawX: getExpValue(inst, effXField), x2: is3D ? parseXValue(getExpValue(inst, effXFields[1])) : undefined, y: v });
        });
      }
      out.push({
        key: 'intensity', label: `Intensity @ ${plot.lambda || '—'} nm (${specTitleOf(d.activeInstance || d.instances[0])})`,
        pts: pts.map((p) => ({ ...p, excluded: !!((plot.excluded.intensity || {})[p.instId]) }))
      });
    }
    return out;
  }, [plot.yMode, plot.specIdx, plot.lambda, effXField, is3D, effXFields.join('|'), d.instances, plot.excluded, used, usedSSKeys, d.activeInstance]);

  const colorOf = (s) => {
    const idx = series.findIndex((q) => q.key === s.key);
    const total = series.length;
    return plot.yMode === 'ss'
      ? (CD_FIT_COMPONENTS[s.key.replace('ss_', '')]?.color || seriesColor(cfg, s.key, idx, total))
      : seriesColor(cfg, s.key, idx, total);
  };

  const includedPts = (s) => s.pts.filter((p) => !p.excluded);

  const effSD = (sKey, p) => {
    const man = (plot.manualSD[sKey] || {})[p.instId];
    if (typeof man === 'number' && Number.isFinite(man)) return man;
    if (plot.useFixedSD) { const f = parseManual(plot.fixedSDStr); if (f !== null) return f; }
    return null;
  };
  const setManualSD = (sKey, instId, val) => {
    const inner = { ...(plot.manualSD[sKey] || {}) };
    const n = parseManual(val);
    if (n === null) delete inner[instId]; else inner[instId] = n;
    set({ manualSD: { ...plot.manualSD, [sKey]: inner } });
  };
  const toggleExclude = (sKey, instId) => {
    const inner = { ...(plot.excluded[sKey] || {}) };
    if (inner[instId]) delete inner[instId]; else inner[instId] = true;
    set({ excluded: { ...plot.excluded, [sKey]: inner } });
  };

  const fitOf = (s) => {
    if (!plot.fitEnabled || isHist) return null;
    const wpts = includedPts(s).filter((p) => Number.isFinite(p.x)).map((p) => {
      const sd = effSD(s.key, p);
      return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1 };
    });
    return runFitModel(plot.fitModel, plot.customExpr, wpts);
  };
  const fits = useMemo(() => {
    const out = {}; series.forEach((s) => { out[s.key] = fitOf(s); }); return out;
  }, [series]);

  const autoTouch = (s) => {
    const fit = fits[s.key] || fitOf(s);
    if (!fit || !fit.f) return;
    const inner = { ...(plot.manualSD[s.key] || {}) };
    includedPts(s).forEach((p) => {
      if (!Number.isFinite(p.x)) return;
      inner[p.instId] = Math.ceil((Math.abs(p.y - fit.f(p.x)) * 1.02 + 0.01) * 100) / 100;
    });
    set({ manualSD: { ...plot.manualSD, [s.key]: inner } });
  };
  const resetSD = (sKey) => { const next = { ...plot.manualSD }; delete next[sKey]; set({ manualSD: next }); };
  const cleanOutliers = (target) => {
    const thresh = parseManual(plot.outlierThreshStr) || 2.5;
    const excluded = JSON.parse(JSON.stringify(plot.excluded || {}));
    const proc = (s) => {
      for (let it = 0; it < 20; it++) {
        const pts = s.pts.filter((p) => !((excluded[s.key] || {})[p.instId]) && Number.isFinite(p.x));
        if (pts.length < 4) break;
        const wpts = pts.map((p) => {
          const sd = effSD(s.key, p);
          return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1, p };
        });
        const fit = runFitModel(plot.fitModel, plot.customExpr, wpts);
        if (!fit || !fit.f) break;
        let worst = null, maxR = 0;
        wpts.forEach((q) => {
          const sd = effSD(s.key, q.p);
          const err = sd && sd > 0 ? sd : 1;
          const ratio = Math.abs(q.p.y - fit.f(q.p.x)) / err;
          if (ratio > thresh && ratio > maxR) { maxR = ratio; worst = q.p; }
        });
        if (!worst) break;
        excluded[s.key] = { ...(excluded[s.key] || {}), [worst.instId]: true };
      }
    };
    (target ? [target] : series).forEach(proc);
    set({ excluded });
  };
  const restoreExcluded = () => set({ excluded: {} });

  // ===== Experimental-condition compatibility warnings =====
  // When plotting Y as a function of the chosen variable field(s), every OTHER
  // experimental condition should be held constant across the instances being
  // compared. If it isn't (e.g. plotting vs temperature & pH while concentration
  // silently differs between spectra), the fit/plot is scientifically misleading.
  const conditionWarnings = useMemo(() => {
    const includedInstIds = new Set();
    series.forEach((s) => s.pts.forEach((p) => { if (!p.excluded) includedInstIds.add(p.instId); }));
    const relevant = d.instances.filter((inst) => used[inst.id] !== false && includedInstIds.has(inst.id));
    if (relevant.length < 2) return [];
    const issues = [];

    // Variable field(s): flag inconsistent units (e.g. one spectrum's temperature
    // in degC, another in K) — the x-values would not be directly comparable.
    effXFields.forEach((fk) => {
      const f = CD_EXPERIMENTAL_FIELDS.find((x) => x.key === fk);
      if (!f || !f.unitKey) return;
      const withUnit = relevant
        .map((inst) => ({ inst, unit: getExpUnit(inst, f) || f.units[0] }))
        .filter((v) => getExpValue(v.inst, f.key) !== '');
      const unitSet = new Set(withUnit.map((v) => v.unit));
      if (unitSet.size > 1) {
        const majorityUnit = [...unitSet].sort((a, b) =>
          withUnit.filter((v) => v.unit === b).length - withUnit.filter((v) => v.unit === a).length
        )[0];
        issues.push({
          field: f,
          isUnitMismatch: true,
          refValue: majorityUnit,
          offenders: withUnit.filter((v) => v.unit !== majorityUnit).map((v) => ({ instId: v.inst.id, name: v.inst.name, value: v.unit }))
        });
      }
    });

    // Other (non-variable) fields: flag differing values across the compared spectra.
    const others = CD_EXPERIMENTAL_FIELDS.filter((f) => !effXFields.includes(f.key));
    const norm = (raw) => { const n = parseManual(raw); return n !== null ? Math.round(n * 1e6) / 1e6 : String(raw).trim().toLowerCase(); };
    others.forEach((f) => {
      const valued = relevant
        .map((inst) => ({ inst, raw: getExpValue(inst, f.key) }))
        .filter((v) => v.raw !== '' && v.raw !== undefined && v.raw !== null);
      if (valued.length < 2) return;
      const counts = new Map();
      valued.forEach((v) => { const k = norm(v.raw); counts.set(k, (counts.get(k) || 0) + 1); });
      if (counts.size <= 1) return;
      let refKey = null, refCount = -1;
      counts.forEach((cnt, k) => { if (cnt > refCount) { refCount = cnt; refKey = k; } });
      const refValue = valued.find((v) => norm(v.raw) === refKey)?.raw;
      const offenders = valued.filter((v) => norm(v.raw) !== refKey).map((v) => ({ instId: v.inst.id, name: v.inst.name, value: v.raw }));
      if (offenders.length) issues.push({ field: f, refValue, offenders });
    });
    return issues;
  }, [series, effXFields.join('|'), d.instances, used]);

  const autoDropIncompatible = () => {
    const nextUsed = { ...used };
    conditionWarnings.forEach((issue) => issue.offenders.forEach((o) => { nextUsed[o.instId] = false; }));
    set({ usedInstances: nextUsed });
  };

  const visibleSeries = series.filter((s) => !plot.hiddenSeries[s.key]);
  const xs = visibleSeries.flatMap((s) => includedPts(s).filter((p) => Number.isFinite(p.x)).map((p) => p.x));
  const padX = xs.length ? ((Math.max(...xs) - Math.min(...xs)) * 0.06 || 1) : 1;
  const dataDomain = xs.length ? [Math.min(...xs) - padX, Math.max(...xs) + padX] : [0, 1];
  const zoom = useXZoom(chartRef, dataDomain, cfgChartMargin(cfg, { top: 8, right: 16, bottom: 30, left: 12 }));

  const numData = (s) => includedPts(s).filter((p) => Number.isFinite(p.x)).sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y, sd: effSD(s.key, p), name: p.name }));
  const excludedPts = (s) => s.pts.filter((p) => p.excluded && Number.isFinite(p.x)).sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y, name: p.name }));
  const fitData = (s) => {
    const fit = fits[s.key];
    if (!fit || !fit.f) return [];
    const [mn, mx] = zoom.domain;
    if (!(mx > mn)) return [];
    const out = [];
    for (let i = 0; i <= 60; i++) { const x = mn + ((mx - mn) * i) / 60; out.push({ x, y: fit.f(x) }); }
    return out;
  };
  const histData = useMemo(() => {
    return d.instances.filter((inst) => used[inst.id] !== false).map((inst) => {
      const row = { __condition: inst.name };
      series.forEach((s) => {
        const p = s.pts.find((q) => q.instId === inst.id);
        if (p && !p.excluded) { row[s.key] = p.y; row[`${s.key}__sd`] = effSD(s.key, p); } 
        else { row[s.key] = null; row[`${s.key}__sd`] = null; }
      });
      return row;
    });
  }, [d.instances, series, used]);

  // Auto-Y that also covers the error bars: Recharts only measures the plotted
  // dataKeys, so a whisker taller than the tallest bar / point would be clipped
  // by the "auto" domain. `errorBarRange` folds the ± SD in (null when error
  // bars are hidden, in which case the axes keep their previous "auto" range).
  const errRangeY = (HAS_EB && plot.showErrors)
    ? (isHist
        ? errorBarRange(histData, visibleSeries.map((s) => s.key))
        : errorBarRange(visibleSeries.flatMap((s) => numData(s)), ['y'], (row) => row.sd, null))
    : null;
  /* ✂ "Interrupt Y axis" of the 🎨 panel: one condition can dwarf all the others
     of the histogram. A typed Y range keeps the axis exactly as it is. */
  const histBrk = brokenAxisProps(cfg, 'y', visibleSeries.flatMap((s) => histData.map((r) => r[s.key])), { min: cfg.yMin, max: cfg.yMax });
  const histBrkOn = histBrk.on && dom(cfg.yMin) === undefined && dom(cfg.yMax) === undefined;

  const makeDot = (color, s) => (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={`d-${s.key}-${index}`} />;
    // Per-curve symbol / size when the style panel set one for THIS curve.
    const r = seriesPtSize(cfg, s.key, cfg.ptSize || 5);
    const style = seriesPointStyle(cfg, s.key);
    let el;
    if (style === 'square' || style === 'rect') el = <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />;
    else if (style === 'rectRot') el = <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} transform={`rotate(45 ${cx} ${cy})`} />;
    else if (style === 'diamond') el = <polygon points={`${cx},${cy - r * 1.4} ${cx + r * 1.4},${cy} ${cx},${cy + r * 1.4} ${cx - r * 1.4},${cy}`} fill={color} />;
    else if (style === 'triangle') el = <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={color} />;
    else if (style === 'cross') el = <g><line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={color} strokeWidth={2} /><line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke={color} strokeWidth={2} /></g>;
    else if (style === 'crossRot') el = <g><line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={2} /><line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={2} /></g>;
    else if (style === 'star') el = <g><line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke={color} strokeWidth={2} /><line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke={color} strokeWidth={2} /><line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={1.5} /><line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={1.5} /></g>;
    else if (style === 'none') el = null;
    else el = <circle cx={cx} cy={cy} r={r} fill={color} />;
    return <g key={`d-${s.key}-${index}`}>{el}</g>;
  };

  const yLab = cfg.yAxisLabel || (plot.yMode === 'ss' ? 'Component Fraction (%)' : `CD intensity (${(d.activeInstance && d.activeInstance.test.yUnit === 'theta') ? thetaUnitShort(thetaModeOf(d.activeInstance.test)) : 'mdeg'})`);
  const xLab = cfg.xAxisLabel || `${xFieldLabel} (per condition)`;
  const yUnitSuffix = xFieldDef && xFieldDef.unitKey && d.activeInstance ? getExpUnit(d.activeInstance, xFieldDef) : '';

  const paramKeys = useMemo(() => {
    if (!plot.fitEnabled || isHist || !series.length) return [];
    return fitParamOptions(plot.fitModel, plot.customExpr);
  }, [plot.fitEnabled, plot.fitModel, plot.customExpr, series, isHist]);
  const [paramGraphVar, setParamGraphVar] = useState('');
  useEffect(() => { if (!paramKeys.includes(paramGraphVar)) setParamGraphVar(paramKeys[0] || ''); }, [paramKeys, paramGraphVar]);
  const paramData = useMemo(() => {
    if (!paramGraphVar) return [];
    return series.map((s) => {
      const f = fits[s.key]; if (!f) return null;
      const val = extractFitParam(f, plot.fitModel, paramGraphVar);
      const err = plot.fitModel === 'custom' ? f.paramsErr?.[paramGraphVar] : f[`${paramGraphVar}Err`];
      if (val === undefined || val === null) return null;
      return { name: s.label, val, err: err || 0, fill: colorOf(s) };
    }).filter(Boolean);
  }, [series, fits, paramGraphVar, plot.fitModel]);
  const paramYDataDomain = useMemo(() => {
    const vals = paramData.flatMap((p) => [p.val - Math.abs(p.err || 0), p.val + Math.abs(p.err || 0)]);
    if (!vals.length) return [0, 1];
    const min = Math.min(0, ...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 1;
    return [min - pad, max + pad];
  }, [paramData]);
  const fitChartRef = useRef(null);
  const fitZoom = useYZoom(fitChartRef, paramYDataDomain, cfgChartMargin(cfg, { top: 10, right: 10, bottom: 20, left: 10 }));
  /* ✂ "Interrupt Y axis" of the 🎨 panel: the histogram of the FITTED parameters
     can hold one series 100× the others. A typed Y range or a drag-zoom window
     keeps the axis exactly as it is — the manual window wins over the break. */
  const paramBrk = brokenAxisProps(cfg, 'y', paramData.map((p) => p.val), { min: cfg.yMin, max: cfg.yMax });
  const paramBrkOn = paramBrk.on && !fitZoom.isZoomed && dom(cfg.yMin) === undefined && dom(cfg.yMax) === undefined;

  const refLines = (
    <>
      {(plot.hLines || []).map((h) => {
        const v = parseManual(h.value);
        if (v === null) return null;
        return <ReferenceLine key={h.id} y={v} stroke={h.color || '#64748b'} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: h.label || `y=${v}`, fill: h.color || '#64748b', fontSize: Math.max(9, Number(tickSize(cfg)) - 1), position: 'insideTopRight' }} />;
      })}
    </>
  );

  return (
    <CollapsibleSection
      title={plot.title} icon="📈" defaultOpen={false}
      headerExtra={
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span role="button" onClick={(e) => { e.stopPropagation(); const nn = window.prompt('Rename plot:', plot.title); if (nn && nn.trim()) set({ title: nn.trim() }); }} className="text-slate-400 hover:text-blue-600 cursor-pointer text-lg leading-none" title="Rename">✏️</span>
          <span role="button" onClick={(e) => { e.stopPropagation(); duplicatePlot(plot); }} className="text-slate-400 hover:text-blue-600 cursor-pointer text-lg leading-none" title="Duplicate">⧉</span>
          <span role="button" onClick={(e) => { e.stopPropagation(); removePlot(plot.id); }} className="text-slate-400 hover:text-red-500 cursor-pointer text-lg leading-none" title="Remove">×</span>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Y axis</label>
            <select value={plot.yMode} onChange={(e) => set({ yMode: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="ss">Component fractions % (from fits)</option>
              <option value="intensity">Intensity at wavelength</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Spectrum slot</label>
            <select value={plot.specIdx} onChange={(e) => set({ specIdx: parseInt(e.target.value, 10) || 0 })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {Array.from({ length: Math.max(1, ...d.instances.map((i) => computeParsed(i.test).parsedSpectra.length)) }, (_, i) => (
                <option key={i} value={i}>Spectrum {i + 1}</option>
              ))}
            </select>
          </div>
          {plot.yMode === 'intensity' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">λ (nm)</label>
              <input type="number" value={plot.lambda} onChange={(e) => set({ lambda: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-24 outline-none focus:border-blue-500" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Variable 1 (X)</label>
            <select value={effXField} onChange={(e) => setXFields(is3D ? [e.target.value, effXFields[1]] : [e.target.value])} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {CD_EXPERIMENTAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Variable 2 (3D)</label>
            <select
              value={is3D ? effXFields[1] : ''}
              onChange={(e) => setXFields(e.target.value ? [effXField, e.target.value] : [effXField])}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold"
            >
              <option value="">— none (2D) —</option>
              {CD_EXPERIMENTAL_FIELDS.filter((f) => f.key !== effXField).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Type</label>
            <select value={plot.chartType} onChange={(e) => set({ chartType: e.target.value })} disabled={is3D} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              <option value="line">Line / Scatter (zoomable)</option>
              <option value="hist">Histogram (per condition)</option>
            </select>
            {is3D && <span className="text-[9px] text-slate-400">3D scatter (2 variables set)</span>}
          </div>
          {!isHist && !is3D && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 cursor-pointer">
              <input type="checkbox" checked={plot.fitEnabled} onChange={(e) => set({ fitEnabled: e.target.checked })} className="w-4 h-4 accent-blue-600" />
              Fit curve
            </label>
          )}
          {plot.fitEnabled && !isHist && !is3D && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
              <div className="flex gap-2 items-center">
                <select value={plot.fitModel} onChange={(e) => set({ fitModel: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                  <option value="linear">Linear (weighted)</option>
                  <option value="4pl">4PL logistic (weighted)</option>
                  <option value="custom">Custom Equation</option>
                </select>
                {plot.fitModel === 'custom' && (
                  <input type="text" value={plot.customExpr || ''} onChange={(e) => set({ customExpr: e.target.value })} placeholder="e.g. a*exp(-b*x)+c" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 w-44 bg-white" />
                )}
              </div>
            </div>
          )}
          <ChartControlBar
            showErr={showErr} onToggleErr={() => setShowErr(!showErr)}
            showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Conditions used:</span>
          {d.instances.map((inst) => (
            <label key={inst.id} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer ${used[inst.id] === false ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
              <input type="checkbox" checked={used[inst.id] !== false} onChange={() => set({ usedInstances: { ...used, [inst.id]: used[inst.id] === false ? undefined : false } })} className="w-3.5 h-3.5 accent-blue-600" />
              {inst.name}
              <span className="text-[9px] font-mono opacity-70">
                ({xFieldLabel}: {getExpValue(inst, effXField) || '—'}{is3D ? `, ${xField2Label}: ${getExpValue(inst, effXFields[1]) || '—'}` : ''})
              </span>
            </label>
          ))}
        </div>

        {conditionWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none">⚠️</span>
              <div className="flex-1 text-xs text-amber-900">
                <p className="font-bold uppercase mb-1">
                  Conditions not set as variables differ between the spectra used in this plot
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {conditionWarnings.map((issue) => (
                    <li key={issue.field.key + (issue.isUnitMismatch ? '-unit' : '')}>
                      {issue.isUnitMismatch ? (
                        <><b>{issue.field.label}</b> — most spectra use <span className="font-mono">{issue.refValue}</span>, but {issue.offenders.map((o) => `${o.name} (${o.value})`).join(', ')} {issue.offenders.length === 1 ? 'uses' : 'use'} a different unit — values are not directly comparable.</>
                      ) : (
                        <><b>{issue.field.label}</b> — most spectra use <span className="font-mono">{String(issue.refValue)}</span>, but {issue.offenders.map((o) => `${o.name} (${o.value})`).join(', ')} {issue.offenders.length === 1 ? 'differs' : 'differ'}.</>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-amber-700">
                  Mixing spectra with different {conditionWarnings.map((i) => i.field.label).join(', ')} can make this {is3D ? '3D plot' : 'fit'} misleading, since only {is3D ? `${xFieldLabel} and ${xField2Label}` : xFieldLabel} {is3D ? 'are' : 'is'} being treated as the variable(s).
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={autoDropIncompatible} className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg shadow-sm w-fit">
                🧹 Auto-drop incompatible spectra
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-64 flex flex-col gap-2 shrink-0">
            <label className="text-xs font-bold text-slate-600 uppercase">Series</label>
            {series.map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!plot.hiddenSeries[s.key]} onChange={() => set({ hiddenSeries: { ...plot.hiddenSeries, [s.key]: !plot.hiddenSeries[s.key] } })} className="w-3.5 h-3.5 accent-blue-600" />
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: colorOf(s) }} />
                <span className="truncate">{s.label}</span>
              </label>
            ))}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {series.length === 0 || visibleSeries.length === 0 ? (
              <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
                No data — run at least one spectrum fit (ss mode) or check spectra/wavelength (intensity mode).
              </div>
            ) : (
              <>
                {fs && <div className={OVERLAY_CLASSES} onClick={() => setFs(false)} />}
                <div className={`flex flex-col ${fs ? FS_CLASSES + ' p-6' : ''}`}>
                  <div className="flex justify-between items-center mb-2 shrink-0">
                    <span className="text-xs font-bold text-slate-600 uppercase">{plot.title}</span>
                    <div className="flex gap-2">
                      {!isHist && zoom.isZoomed && <button type="button" onClick={zoom.reset} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
                      <button type="button" onClick={() => setFs(!fs)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 text-[10px]">{fs ? '↙️' : '↗️'}</button>
                    </div>
                  </div>
                  <div ref={chartRef} onMouseDown={(isHist || is3D) ? undefined : zoom.onMouseDown} style={fs ? { flex: 1, minHeight: 0 } : chartBoxStyle(cfg)} className="bg-white border border-slate-200 rounded-xl p-3 select-none relative">
                    {is3D ? (
                      <Condition3DScatter
                        series={visibleSeries}
                        colorOf={colorOf}
                        includedPts={includedPts}
                        xLabel={`${xFieldLabel}${(xFieldDef && xFieldDef.unitKey && d.activeInstance && getExpUnit(d.activeInstance, xFieldDef)) ? ` (${getExpUnit(d.activeInstance, xFieldDef)})` : ''}`}
                        yLabel={`${xField2Label}${(xField2Def && xField2Def.unitKey && d.activeInstance && getExpUnit(d.activeInstance, xField2Def)) ? ` (${getExpUnit(d.activeInstance, xField2Def)})` : ''}`}
                        zLabel={yLab}
                        cfg={cfg}
                        height={fs ? undefined : (cfg.height || 380)}
                        chartType={plot.chartType3D || 'scatter'}
                        setChartType={(t) => set({ chartType3D: t })}
                      />
                    ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      {isHist ? (
                        <BarChart data={histData} margin={cfgChartMargin(cfg, { top: 8, right: 16, bottom: 30, left: 12 })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="__condition" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={tickSize(cfg)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} edgeAnchor={false} />} tickMargin={10} label={cfgAxisLabel(cfg, 'x', 'Condition', 22)} />
                          <YAxis {...(histBrkOn ? { type: 'number', ...histBrk.axisProps } : { type: 'number', domain: [dom(cfg.yMin) ?? errRangeY?.[0] ?? 'auto', dom(cfg.yMax) ?? errRangeY?.[1] ?? 'auto'] })} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fill: '#64748b' })} label={cfgAxisLabel(cfg, 'y', yLab, 6)} />
                          <Tooltip />
                          {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg, { paddingBottom: 10 })} />}
                          {refLines}
                          {visibleSeries.map((s) => {
                            const color = colorOf(s);
                            return (
                              <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[cfg.barRadius || 3, cfg.barRadius || 3, 0, 0]} isAnimationActive={false}>
                                {HAS_EB && plot.showErrors && <ErrorBar dataKey={`${s.key}__sd`} width={4} strokeWidth={1} direction="y" color={color} />}
                              </Bar>
                            );
                          })}
                          {histBrkOn && histBrk.marks}
                        </BarChart>
                      ) : (
                        <LineChart margin={cfgChartMargin(cfg, { top: 8, right: 16, bottom: 30, left: 12 })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis type="number" dataKey="x" domain={[dom(cfg.xMin) ?? zoom.domain[0], dom(cfg.xMax) ?? zoom.domain[1]]} ticks={makeTicks(zoom.domain, cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={tickSize(cfg)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} formatter={cfgTickFormatter(cfg, 'x') || undefined} />} tickMargin={10} allowDataOverflow label={cfgAxisLabel(cfg, 'x', `${xLab}${yUnitSuffix ? ` (${yUnitSuffix})` : ''}`, 22)} />
                          <YAxis type="number" domain={[dom(cfg.yMin) ?? errRangeY?.[0] ?? 'auto', dom(cfg.yMax) ?? errRangeY?.[1] ?? 'auto']} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fill: '#64748b' })} allowDataOverflow label={cfgAxisLabel(cfg, 'y', yLab, 6)} />
                          <Tooltip />
                          {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg, { paddingBottom: 10 })} />}
                          {refLines}
                          {visibleSeries.map((s) => {
                            const color = colorOf(s);
                            return (
                              <React.Fragment key={s.key}>
                                <Line data={numData(s)} type="monotone" dataKey="y" name={seriesLabelOf(cfg, s.key, s.label)} stroke={color} strokeWidth={seriesLineThickness(cfg, s.key, cfg.lineThickness || 2)} strokeDasharray={seriesDash(cfg, s.key) || lineDash(cfg.lineStyle)} dot={plot.showPoints ? makeDot(color, s) : false} connectNulls isAnimationActive={false}>
                                  {HAS_EB && plot.showErrors && <ErrorBar dataKey="sd" width={4} strokeWidth={1} direction="y" color={color} />}
                                </Line>
                                {plot.fitEnabled && plot.showFit && fits[s.key] && (
                                  <Line data={fitData(s)} type="monotone" dataKey="y" name={`${s.label} (fit)`} stroke={color} strokeWidth={1.5} strokeDasharray="8 4" dot={false} legendType="none" isAnimationActive={false} />
                                )}
                                {plot.showExcl && (
                                  <Line
                                    data={excludedPts(s)} type="monotone" dataKey="y" name={`${s.label} (excluded)`}
                                    stroke="transparent" legendType="none" isAnimationActive={false} connectNulls
                                    dot={(props) => {
                                      const { cx, cy, index } = props;
                                      if (cx == null || cy == null) return <g key={`ex-${s.key}-${index}`} />;
                                      const r = (cfg.ptSize || 5) + 1;
                                      return <circle key={`ex-${s.key}-${index}`} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 2" opacity={0.6} />;
                                    }}
                                  />
                                )}
                              </React.Fragment>
                            );
                          })}
                          {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                    )}
                  </div>
                  {!isHist && !is3D && <p className="text-[10px] text-slate-400 mt-1">💡 Drag with the mouse across the graph to zoom. Points without a numeric {xFieldLabel} are omitted in line mode.</p>}
                  {is3D && <p className="text-[10px] text-slate-400 mt-1">💡 3D scatter: {xFieldLabel} × {xField2Label} × {yLab}. Hover a point for its exact values.</p>}
                </div>
              </>
            )}

            {plot.fitEnabled && !isHist && !is3D && series.length > 0 && (
              <div className="flex flex-col gap-4">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs text-left bg-white">
                    <thead className="bg-slate-100 text-slate-500 uppercase">
                      <tr><th className="px-3 py-2">Series</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Parameters (weighted)</th><th className="px-3 py-2">SE</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {series.map((s) => {
                        const f = fits[s.key];
                        return (
                          <tr key={s.key}>
                            <td className="px-3 py-1.5 font-bold text-slate-700">{s.label}</td>
                            <td className="px-3 py-1.5">{f ? (plot.fitModel === 'linear' ? 'Linear' : plot.fitModel === '4pl' ? '4PL' : 'Custom') : '—'}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">
                              {f
                                ? plot.fitModel === 'linear'
                                  ? `slope=${Number(f.slope || 0).toFixed(4)}±${Number(f.slopeErr || 0).toFixed(4)}; int=${Number(f.intercept || 0).toFixed(4)}±${Number(f.interceptErr || 0).toFixed(4)}; R²=${Number(f.r2 || 0).toFixed(3)}`
                                  : plot.fitModel === '4pl'
                                    ? `Top=${Number(f.top || 0).toFixed(3)}; Bottom=${Number(f.bottom || 0).toFixed(3)}; EC50=${Number(f.ic50 || 0).toFixed(3)}; Hill=${Number(f.hill || 0).toFixed(3)}; R²=${Number(f.r2 || 0).toFixed(3)}`
                                    : `${Object.entries(f.params || {}).map(([k, v]) => `${k}=${Number(v || 0).toFixed(4)}`).join('; ')}; R²=${Number(f.r2 || 0).toFixed(3)}`
                                : 'not enough points'}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-slate-600">{f ? (f.se ?? 0).toFixed(3) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {paramKeys.length > 0 && paramData.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-700">Fitted Parameter Chart</label>
                      <div className="flex items-center gap-2">
                        {fitZoom.isZoomed && <button type="button" onClick={fitZoom.reset} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
                        <select value={paramGraphVar} onChange={(e) => setParamGraphVar(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
                          {paramKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </div>
                    </div>
                    <div ref={fitChartRef} onMouseDown={fitZoom.onMouseDown} style={chartRatioBoxStyle(cfg, 2, { height: Math.min(280, cfg.height) })} className="select-none">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={paramData} margin={cfgChartMargin(cfg, { top: 10, right: 10, bottom: 20, left: 10 })}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" interval={catInterval(cfg.tickStep)} tickMargin={10} tick={<AngledTick angle={cfg.tickAngle} fontSize={Math.max(9, Number(tickSize(cfg)) - 2)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} edgeAnchor={false} />} />
                          <YAxis {...(paramBrkOn ? paramBrk.axisProps : { domain: [dom(cfg.yMin) ?? fitZoom.domain[0], dom(cfg.yMax) ?? fitZoom.domain[1]], allowDataOverflow: true })} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fontSize: Math.max(9, Number(tickSize(cfg)) - 2) })} label={cfgAxisLabel(cfg, 'y', paramGraphVar, 0)} />
                          <Tooltip />
                          <Bar dataKey="val" isAnimationActive={false}>
                            {paramData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                            {HAS_EB && <ErrorBar dataKey="err" width={4} strokeWidth={1} color="#333" />}
                          </Bar>
                          {paramBrkOn && paramBrk.marks}
                          {fitZoom.refLo !== null && fitZoom.refHi !== null && <ReferenceArea y1={fitZoom.refLo} y2={fitZoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">💡 Drag vertically to zoom into a Y range, or set fixed Y Min/Max in Graphical Parameters.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {showCfg && (
          <SharedChartStylePanel
            cfg={cfg}
            setCfg={setCfg}
            series={series.map((s) => ({ key: s.key, label: s.label, color: colorOf(s) }))}
            unit={xFieldDef && xFieldDef.unitKey && d.activeInstance ? (getExpUnit(d.activeInstance, xFieldDef) || 'a.u.') : 'a.u.'}
          />
        )}

        {showErr && !is3D && (
          <div className="flex flex-col gap-4">
            <ErrorTreatmentPanel
              plot={plot}
              set={set}
              showFitToggle={!isHist}
              customActions={
                <>
                  <button type="button" onClick={() => cleanOutliers()} className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm whitespace-nowrap">🧹 Clean outliers (all series)</button>
                  <button type="button" onClick={restoreExcluded} className="bg-white border border-orange-300 text-orange-700 hover:bg-orange-100 font-bold px-3 py-2 rounded-lg text-xs shadow-sm whitespace-nowrap">↩️ Restore all excluded points</button>
                </>
              }
            />

            {series.length === 0 ? (
              <p className="text-xs text-orange-700 italic">No series to manage yet.</p>
            ) : (
              series.map((s) => (
                <div key={s.key} className="bg-white border border-orange-200 rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-bold" style={{ color: colorOf(s) }}>{s.label}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => cleanOutliers(s)} className="text-[10px] font-bold bg-orange-100 hover:bg-orange-200 text-orange-800 px-2 py-1 rounded">Clean outliers (this series)</button>
                      <button type="button" onClick={() => autoTouch(s)} className="text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded">Auto-set SD from fit residual</button>
                      <button type="button" onClick={() => resetSD(s.key)} className="text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded">Reset manual SD</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] text-left">
                      <thead className="text-slate-400 uppercase">
                        <tr>
                          <th className="px-2 py-1">Drop</th>
                          <th className="px-2 py-1">Condition</th>
                          <th className="px-2 py-1">{xFieldLabel}</th>
                          {is3D && <th className="px-2 py-1">{xField2Label}</th>}
                          <th className="px-2 py-1">Value</th>
                          <th className="px-2 py-1">Manual SD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.pts.map((p) => (
                          <tr key={p.instId} className={p.excluded ? 'opacity-40' : ''}>
                            <td className="px-2 py-1">
                              <input type="checkbox" checked={!!p.excluded} onChange={() => toggleExclude(s.key, p.instId)} className="w-3.5 h-3.5 accent-red-600" title="Drop this point" />
                            </td>
                            <td className="px-2 py-1 font-bold text-slate-700">{p.name}</td>
                            <td className="px-2 py-1 font-mono text-slate-600">{p.rawX || '—'}</td>
                            {is3D && <td className="px-2 py-1 font-mono text-slate-600">{Number.isFinite(p.x2) ? fmt3D(p.x2) : '—'}</td>}
                            <td className="px-2 py-1 font-mono text-slate-600">{Number(p.y).toFixed(3)}</td>
                            <td className="px-2 py-1">
                              <input
                                type="number" step="0.01" placeholder={plot.useFixedSD ? plot.fixedSDStr || 'fixed' : 'auto'}
                                value={(plot.manualSD[s.key] || {})[p.instId] ?? ''}
                                onChange={(e) => setManualSD(s.key, p.instId, e.target.value)}
                                className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px] w-20 outline-none focus:border-orange-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

const ConditionFittingSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  const plots = Array.isArray(activeTest.conditionPlots) && activeTest.conditionPlots.length
    ? activeTest.conditionPlots
    : [defaultCdConditionPlot(1)];
  const updatePlot = (id, patch) => updateActiveTest({ conditionPlots: plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlot = () => updateActiveTest({ conditionPlots: [...plots, defaultCdConditionPlot(plots.length + 1)] });
  const removePlot = (id) => {
    if (plots.length <= 1) { alert('At least one condition plot is required.'); return; }
    updateActiveTest({ conditionPlots: plots.filter((p) => p.id !== id) });
  };
  const duplicatePlot = (p) => updateActiveTest({ conditionPlots: [...plots, { ...JSON.parse(JSON.stringify(p)), id: makeId('cdplot'), title: `${p.title} (copy)` }] });
  return (
    <div className="flex flex-col gap-4 border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-700">📊 Fitting — Condition Plots</h4>
          <span className="text-xs font-bold text-slate-500 uppercase">X = any Experimental-Conditions parameter · Y = SS % or intensity at λ</span>
        </div>
        <button type="button" onClick={addPlot} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">+ Add Condition Plot</button>
      </div>
      {plots.map((p) => <ConditionPlotPanel key={p.id} ctx={ctx} d={d} plot={p} updatePlot={updatePlot} removePlot={removePlot} duplicatePlot={duplicatePlot} />)}
    </div>
  );
};

export const DataAnalysis = ({ ctx }) => (
  <CollapsibleSection title="Data Analysis" icon="📐" defaultOpen={false}>
    <div className="flex flex-col gap-6">
      <SpectrumFitting ctx={ctx} />
      <ManualSSComposition ctx={ctx} />
      <ConditionFittingSection ctx={ctx} />
    </div>
  </CollapsibleSection>
);

/* ========================================================================
SIMULATIONS — 1) PROTEIN CD MIXER
======================================================================== */
const ProteinCDMixer = ({ isExpanded, onToggleExpand, onSnapshot }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const lastSnapshotRef = useRef('');
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  const { width, height } = useElementSize(wrapRef);
  const [compositions, setCompositions] = useState({ helix: 0, sheet: 0, turn: 0, coil: 100 });
  const [autoNormalize, setAutoNormalize] = useState(true);
  
  const updateComp = (key, val) => {
    const newVal = Math.max(0, Math.min(100, val));
    const newComps = { ...compositions, [key]: newVal };
    if (autoNormalize) {
      let currentTotal = 0;
      const others = Object.keys(newComps).filter((k) => k !== key);
      others.forEach((k) => { currentTotal += newComps[k]; });
      if (newVal + currentTotal > 100) {
        const excess = newVal + currentTotal - 100;
        if (currentTotal > 0) others.forEach((k) => { newComps[k] = Math.max(0, newComps[k] - Math.round(excess * (newComps[k] / currentTotal))); });
        else others.forEach((k) => { newComps[k] = 0; });
      }
      const finalTotal = Object.values(newComps).reduce((a, b) => a + b, 0);
      if (finalTotal !== 100 && finalTotal < 100) { const target = key !== 'coil' ? 'coil' : 'turn'; newComps[target] += 100 - finalTotal; }
    }
    setCompositions(newComps);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 80 || height < 80) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx2 = canvas.getContext('2d');
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = width, H = height;
    const wavelengths = [], values = [];
    const pA = compositions.helix / 100, pB = compositions.sheet / 100, pT = compositions.turn / 100, pC = compositions.coil / 100;
    for (let w = 176; w <= 260; w += 1) {
      wavelengths.push(w);
      values.push(splineAlpha.at(w) * pA + splineBeta.at(w) * pB + splineTurn.at(w) * pT + splineCoil.at(w) * pC);
    }
    
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;
    const xMin = 176, xMax = 260;
    const yMin = Math.min(Math.min(...values), -40000), yMax = Math.max(Math.max(...values), 80000);
    
    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = '#f8fafc';
    ctx2.fillRect(0, 0, W, H);
    ctx2.strokeStyle = '#e2e8f0';
    ctx2.lineWidth = 0.5;
    for (let x = Math.ceil(xMin / 10) * 10; x <= xMax; x += 10) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx2.beginPath(); ctx2.moveTo(px, pad.top); ctx2.lineTo(px, pad.top + plotH); ctx2.stroke();
    }
    const yTickStep = (yMax - yMin) > 100000 ? 20000 : 10000;
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx2.beginPath(); ctx2.moveTo(pad.left, py); ctx2.lineTo(pad.left + plotW, py); ctx2.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx2.strokeStyle = '#94a3b8'; ctx2.lineWidth = 1; ctx2.setLineDash([4, 4]);
      ctx2.beginPath(); ctx2.moveTo(pad.left, zeroY); ctx2.lineTo(pad.left + plotW, zeroY); ctx2.stroke();
      ctx2.setLineDash([]);
    }
    ctx2.strokeStyle = '#8e44ad'; ctx2.lineWidth = 2.5; ctx2.beginPath();
    wavelengths.forEach((w, i) => {
      const px = pad.left + ((w - xMin) / (xMax - xMin)) * plotW;
      const py = pad.top + plotH - ((values[i] - yMin) / (yMax - yMin)) * plotH;
      if (i === 0) ctx2.moveTo(px, py); else ctx2.lineTo(px, py);
    });
    ctx2.stroke();
    ctx2.fillStyle = '#64748b'; ctx2.font = '11px sans-serif'; ctx2.textAlign = 'center';
    for (let x = Math.ceil(xMin / 10) * 10; x <= xMax; x += 10) ctx2.fillText(x.toString(), pad.left + ((x - xMin) / (xMax - xMin)) * plotW, pad.top + plotH + 15);
    ctx2.fillText('Wavelength (nm)', pad.left + plotW / 2, H - 5);
    ctx2.textAlign = 'right';
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) ctx2.fillText(`${(y / 1000).toFixed(0)}k`, pad.left - 5, pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH + 4);
    ctx2.save();
    ctx2.translate(12, pad.top + plotH / 2);
    ctx2.rotate(-Math.PI / 2);
    ctx2.textAlign = 'center';
    ctx2.fillText('MRE (deg cm² dmol⁻¹)', 0, 0);
    ctx2.restore();

    // Persist a PNG snapshot so the Lab Notebook can show this simulation.
    if (onSnapshotRef.current) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== lastSnapshotRef.current) {
          lastSnapshotRef.current = dataUrl;
          onSnapshotRef.current(dataUrl);
        }
      } catch { /* ignore snapshot errors */ }
    }
  }, [compositions, width, height]);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? ` ${FS_CLASSES} p-6 ` : 'break-inside-avoid p-4'}`}>
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2"><span>🧬</span> Protein Secondary Structure Simulator</h4>
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">{isExpanded ? '↙️' : '↗️'}</button>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={wrapRef} className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${isExpanded ? 'flex-1 min-h-0' : 'h-[350px]'}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
        <div className="w-full lg:w-64 flex flex-col gap-3 shrink-0">
          <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Composition</div>
          {Object.entries(compositions).map(([key, val]) => {
            const labels = { helix: 'α-Helix', sheet: 'β-Sheet', turn: 'Turn', coil: 'Random Coil' };
            const colors = { helix: '#3b82f6', sheet: '#ef4444', turn: '#f59e0b', coil: '#94a3b8' };
            return (
              <div key={key} className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold" style={{ color: colors[key] }}>{labels[key]}</span>
                  <span className="text-xs font-mono font-bold text-slate-700">{val}%</span>
                </div>
                <input type="range" min="0" max="100" value={val} onChange={(e) => updateComp(key, parseInt(e.target.value, 10))} className="w-full h-2 rounded-lg appearance-none cursor-pointer" style={{ accentColor: colors[key] }} />
              </div>
            );
          })}
          <div className="border-t border-slate-200 pt-2 mt-1">
            <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
              <span>Total:</span>
              <span className={Object.values(compositions).reduce((a, b) => a + b, 0) === 100 ? 'text-emerald-600' : 'text-red-500'}>{Object.values(compositions).reduce((a, b) => a + b, 0)}%</span>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={autoNormalize} onChange={(e) => setAutoNormalize(e.target.checked)} className="w-3 h-3 accent-blue-600" />
              Auto-normalize to 100%
            </label>
            <button onClick={() => setCompositions({ helix: 0, sheet: 0, turn: 0, coil: 100 })} className="mt-2 w-full text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors">Reset to 100% Coil</button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ========================================================================
SIMULATIONS — 2) CD SPECTRA LIBRARY + MIXTURE SIMULATOR
======================================================================== */
const CD_LIBRARY_TABS = [
  { id: 'protein', label: 'Protein Structures' },
  { id: 'dna', label: 'DNA Helices' },
  { id: 'gq', label: 'G-Quadruplexes' },
  { id: 'dnaPepAlpha', label: 'DNA+Pep (Alpha)' },
  { id: 'dnaPepBeta', label: 'DNA+Pep (Beta)' },
  { id: 'dnaPepAlphaZ', label: 'DNA+Pep (Alpha+Z)' },
  { id: 'dnaPepBetaZ', label: 'DNA+Pep (Beta+Z)' },
  { id: 'pepDnaAlpha', label: 'Pep+DNA (Alpha)' },
  { id: 'pepDnaBeta', label: 'Pep+DNA (Beta)' },
  { id: 'pepDnaAlphaZ', label: 'Pep+DNA (Alpha+Z)' },
  { id: 'pepDnaBetaZ', label: 'Pep+DNA (Beta+Z)' }
];
const CD_SIM_INFO = {
  dnaPepAlpha: { ratioLabel: 'Peptide:DNA Ratio', description: 'Simulation (Alpha Binding): DNA remains B-form. Ratio 0-1: peptide binds as α-helix. Ratio >1: excess peptide is Random Coil.' },
  dnaPepBeta: { ratioLabel: 'Peptide:DNA Ratio', description: 'Simulation (Beta Binding): DNA remains B-form. Ratio 0-1: peptide binds as β-sheet. Ratio >1: excess peptide is Random Coil.' },
  dnaPepAlphaZ: { ratioLabel: 'Peptide:DNA Ratio', description: 'Simulation (Alpha + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B→Z transition; peptide binds as α-helix. Ratio >1: DNA is Z-form; excess peptide is Random Coil.' },
  dnaPepBetaZ: { ratioLabel: 'Peptide:DNA Ratio', description: 'Simulation (Beta + Z-Switch): DNA switches from B to Z form. Ratio 0-1: DNA B→Z transition; peptide binds as β-sheet. Ratio >1: DNA is Z-form; excess peptide is Random Coil.' },
  pepDnaAlpha: { ratioLabel: 'DNA:Peptide Ratio', description: 'Simulation (Peptide + DNA [Alpha]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is α-helix. Ratio >1: peptide fully bound as α-helix; excess DNA is B-form.' },
  pepDnaBeta: { ratioLabel: 'DNA:Peptide Ratio', description: 'Simulation (Peptide + DNA [Beta]): Titration of peptide solution with B-DNA. Ratio 0-1: free peptide is Random Coil, bound peptide is β-sheet. Ratio >1: peptide fully bound as β-sheet; excess DNA is B-form.' },
  pepDnaAlphaZ: { ratioLabel: 'DNA:Peptide Ratio', description: 'Simulation (Peptide + DNA [Alpha+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is α-helix. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.' },
  pepDnaBetaZ: { ratioLabel: 'DNA:Peptide Ratio', description: 'Simulation (Peptide + DNA [Beta+Z]): DNA assumes Z-form when bound. Ratio 0-1: peptide excess forces added DNA into Z-form; bound peptide is β-sheet. Ratio >1: excess unbound DNA is B-form; bound DNA is Z-form.' }
};

const CD_LIBRARY_SCALE = 10000;
const niceCdStep = (range, targetTicks = 6) => {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice;
  if (norm >= 7.5) nice = 10;
  else if (norm >= 3.5) nice = 5;
  else if (norm >= 1.5) nice = 2;
  else nice = 1;
  return nice * mag;
};

const getScaledCdSpectrum = (key, xs) => {
  const def = CD_FIT_COMPONENTS[key];
  if (!def) return xs.map(() => 0);
  const raw = xs.map((x) => {
    const xx = Math.min(Math.max(x, def.min), def.max);
    return def.spline.at(xx);
  });
  const maxAbs = Math.max(1e-6, ...raw.map((v) => Math.abs(v)));
  return raw.map((v) => (v / maxAbs) * CD_LIBRARY_SCALE);
};

const normalizeCdSeries = (series) => {
  if (!series.length) return series;
  const allValues = series.flatMap((s) => s.values);
  const maxAbs = Math.max(1e-6, ...allValues.map((v) => Math.abs(v)));
  return series.map((s) => ({ ...s, values: s.values.map((v) => (v / maxAbs) * 100) }));
};

export const buildCdLibraryData = ({ tab, selectedProtein, selectedDna, selectedGq, ratio, normalize }) => {
  let domain = { min: 176, max: 260 };
  if (tab === 'dna' || tab === 'gq' || tab.startsWith('dnaPep') || tab.startsWith('pepDna')) domain = { min: 180, max: 320 };
  const xs = [];
  for (let x = domain.min; x <= domain.max; x += 1) xs.push(x);
  let series = [];
  if (tab === 'protein') {
    series = selectedProtein.map((key) => ({ label: CD_FIT_COMPONENTS[key]?.label || key, color: CD_FIT_COMPONENTS[key]?.color || '#3b82f6', values: getScaledCdSpectrum(key, xs) }));
  } else if (tab === 'dna') {
    series = selectedDna.map((key) => ({ label: CD_FIT_COMPONENTS[key]?.label || key, color: CD_FIT_COMPONENTS[key]?.color || '#8b5cf6', values: getScaledCdSpectrum(key, xs) }));
  } else if (tab === 'gq') {
    series = selectedGq.map((key) => ({ label: CD_FIT_COMPONENTS[key]?.label || key, color: CD_FIT_COMPONENTS[key]?.color || '#ec4899', values: getScaledCdSpectrum(key, xs) }));
  } else {
    const r = Math.max(0, Math.min(10, Number(ratio) || 0));
    const B = getScaledCdSpectrum('bDNA', xs);
    const Z = getScaledCdSpectrum('zDNA', xs);
    const alpha = getScaledCdSpectrum('alpha', xs);
    const beta = getScaledCdSpectrum('beta', xs);
    const coil = getScaledCdSpectrum('coil', xs);
    const mix = (parts) => xs.map((_, i) => parts.reduce((sum, [arr, weight]) => sum + (arr[i] || 0) * (weight || 0), 0));
    const bound01 = Math.min(r, 1), excess = Math.max(r - 1, 0), free = Math.max(1 - r, 0);
    let values = [], label = '';
    switch (tab) {
      case 'dnaPepAlpha': values = mix([[B, 1], [alpha, bound01], [coil, excess]]); label = `DNA + α-peptide (P/D ${r.toFixed(1)})`; break;
      case 'dnaPepBeta': values = mix([[B, 1], [beta, bound01], [coil, excess]]); label = `DNA + β-peptide (P/D ${r.toFixed(1)})`; break;
      case 'dnaPepAlphaZ': values = mix([[B, 1 - bound01], [Z, bound01], [alpha, bound01], [coil, excess]]); label = `DNA B→Z + α-peptide (P/D ${r.toFixed(1)})`; break;
      case 'dnaPepBetaZ': values = mix([[B, 1 - bound01], [Z, bound01], [beta, bound01], [coil, excess]]); label = `DNA B→Z + β-peptide (P/D ${r.toFixed(1)})`; break;
      case 'pepDnaAlpha': values = mix([[alpha, bound01], [coil, free], [B, r]]); label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`; break;
      case 'pepDnaBeta': values = mix([[beta, bound01], [coil, free], [B, r]]); label = `Peptide + B-DNA (D/P ${r.toFixed(1)})`; break;
      case 'pepDnaAlphaZ': values = mix([[alpha, bound01], [coil, free], [Z, bound01], [B, Math.max(r - 1, 0)]]); label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`; break;
      case 'pepDnaBetaZ': values = mix([[beta, bound01], [coil, free], [Z, bound01], [B, Math.max(r - 1, 0)]]); label = `Peptide + Z-DNA/B-DNA (D/P ${r.toFixed(1)})`; break;
      default: values = xs.map(() => 0); label = 'Unknown simulation';
    }
    series = [{ label, color: '#7c3aed', values }];
  }
  if (normalize) series = normalizeCdSeries(series);
  return { xs, series, domain };
};

const CDSpectraLibrary = ({ isExpanded, onToggleExpand, onSnapshot }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const lastSnapshotRef = useRef('');
  const onSnapshotRef = useRef(onSnapshot);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  const { width, height } = useElementSize(wrapRef);
  const [tab, setTab] = useState('protein');
  const [selectedProtein, setSelectedProtein] = useState(['alpha', 'beta', 'coil']);
  const [selectedDna, setSelectedDna] = useState(['bDNA']);
  const [selectedGq, setSelectedGq] = useState(['gqP']);
  const [ratio, setRatio] = useState(0);
  const [normalize, setNormalize] = useState(true);

  const proteinTypes = ['alpha', 'beta', 'turn', 'coil'];
  const dnaTypes = ['aDNA', 'bDNA', 'zDNA'];
  const gqTypes = ['gqP', 'gqH', 'gqA'];

  const isSim = Boolean(CD_SIM_INFO[tab]);
  const plotData = useMemo(
    () => buildCdLibraryData({ tab, selectedProtein, selectedDna, selectedGq, ratio, normalize }),
    [tab, selectedProtein, selectedDna, selectedGq, ratio, normalize]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 80 || height < 80) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx2 = canvas.getContext('2d');
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = width, H = height;
    const pad = { top: 20, right: 20, bottom: 40, left: 60 };
    const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = '#f8fafc';
    ctx2.fillRect(0, 0, W, H);
    
    if (!plotData.series.length || !plotData.xs.length) {
      ctx2.fillStyle = '#64748b'; ctx2.font = '12px sans-serif'; ctx2.textAlign = 'center';
      ctx2.fillText('Select at least one spectrum', W / 2, H / 2);
      return;
    }
    const allValues = plotData.series.flatMap((s) => s.values);
    if (!allValues.length) {
      ctx2.fillStyle = '#64748b'; ctx2.font = '12px sans-serif'; ctx2.textAlign = 'center';
      ctx2.fillText('No data available', W / 2, H / 2);
      return;
    }
    
    let yMin = Math.min(...allValues), yMax = Math.max(...allValues);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -1; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yMargin = (yMax - yMin) * 0.1;
    yMin -= yMargin; yMax += yMargin;
    const xMin = plotData.domain.min, xMax = plotData.domain.max;
    const xTickStep = xMax - xMin > 100 ? 20 : 10;
    const yTickStep = niceCdStep(yMax - yMin);
    
    ctx2.strokeStyle = '#e2e8f0'; ctx2.lineWidth = 0.5;
    for (let x = Math.ceil(xMin / xTickStep) * xTickStep; x <= xMax; x += xTickStep) {
      const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      ctx2.beginPath(); ctx2.moveTo(px, pad.top); ctx2.lineTo(px, pad.top + plotH); ctx2.stroke();
    }
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) {
      const py = pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;
      ctx2.beginPath(); ctx2.moveTo(pad.left, py); ctx2.lineTo(pad.left + plotW, py); ctx2.stroke();
    }
    if (yMin < 0 && yMax > 0) {
      const zeroY = pad.top + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      ctx2.strokeStyle = '#94a3b8'; ctx2.lineWidth = 1; ctx2.setLineDash([4, 4]);
      ctx2.beginPath(); ctx2.moveTo(pad.left, zeroY); ctx2.lineTo(pad.left + plotW, zeroY); ctx2.stroke();
      ctx2.setLineDash([]);
    }
    
    ctx2.save();
    ctx2.beginPath(); ctx2.rect(pad.left, pad.top, plotW, plotH); ctx2.clip();
    plotData.series.forEach((s) => {
      ctx2.strokeStyle = s.color; ctx2.lineWidth = 2; ctx2.beginPath();
      plotData.xs.forEach((x, i) => {
        const px = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
        const py = pad.top + plotH - ((s.values[i] - yMin) / (yMax - yMin)) * plotH;
        if (i === 0) ctx2.moveTo(px, py); else ctx2.lineTo(px, py);
      });
      ctx2.stroke();
    });
    ctx2.restore();
    
    ctx2.font = '10px sans-serif';
    plotData.series.forEach((s, idx) => {
      const lx = pad.left + 10, ly = pad.top + 15 + idx * 14;
      ctx2.fillStyle = s.color; ctx2.fillRect(lx, ly - 6, 12, 3);
      ctx2.fillStyle = '#334155'; ctx2.textAlign = 'left'; ctx2.fillText(s.label, lx + 16, ly - 2);
    });
    ctx2.fillStyle = '#64748b'; ctx2.font = '11px sans-serif'; ctx2.textAlign = 'center';
    for (let x = Math.ceil(xMin / xTickStep) * xTickStep; x <= xMax; x += xTickStep) ctx2.fillText(x.toString(), pad.left + ((x - xMin) / (xMax - xMin)) * plotW, pad.top + plotH + 15);
    ctx2.fillText('Wavelength (nm)', pad.left + plotW / 2, H - 5);
    const fmtY = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(v)}`);
    ctx2.textAlign = 'right';
    for (let y = Math.ceil(yMin / yTickStep) * yTickStep; y <= yMax; y += yTickStep) ctx2.fillText(fmtY(y), pad.left - 5, pad.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH + 4);
    ctx2.save();
    ctx2.translate(12, pad.top + plotH / 2);
    ctx2.rotate(-Math.PI / 2);
    ctx2.textAlign = 'center';
    ctx2.fillText(normalize ? 'Normalized CD (a.u.)' : 'CD (a.u.)', 0, 0);
    ctx2.restore();

    // Persist a PNG snapshot so the Lab Notebook can show this simulation.
    if (onSnapshotRef.current) {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl !== lastSnapshotRef.current) {
          lastSnapshotRef.current = dataUrl;
          onSnapshotRef.current(dataUrl);
        }
      } catch { /* ignore snapshot errors */ }
    }
  }, [plotData, width, height, normalize]);

  const toggleInArray = (setter, value) => {
    setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? ` ${FS_CLASSES} p-6 ` : 'break-inside-avoid p-4'}`}>
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2"><span>📚</span> CD Spectra Reference Library & DNA/Protein Mixture Simulator</h4>
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">{isExpanded ? '↙️' : '↗️'}</button>
      </div>
      <div className="flex flex-col xl:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap gap-1 mb-2">
            {CD_LIBRARY_TABS.map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); if (CD_SIM_INFO[t.id]) setRatio(0); }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${tab === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div ref={wrapRef} className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${isExpanded ? 'flex-1 min-h-0' : 'h-[380px]'}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
        <div className="w-full xl:w-72 flex flex-col gap-3 shrink-0 overflow-y-auto custom-scrollbar">
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
            Normalize spectra for display
          </label>
          {tab === 'protein' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Protein Structures</div>
              {proteinTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedProtein.includes(t)} onChange={() => toggleInArray(setSelectedProtein, t)} className="w-3 h-3 accent-blue-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_FIT_COMPONENTS[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{CD_FIT_COMPONENTS[t]?.label}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'dna' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">DNA Helices</div>
              {dnaTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedDna.includes(t)} onChange={() => toggleInArray(setSelectedDna, t)} className="w-3 h-3 accent-purple-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_FIT_COMPONENTS[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{CD_FIT_COMPONENTS[t]?.label}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'gq' && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">G-Quadruplexes</div>
              {gqTypes.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                  <input type="checkbox" checked={selectedGq.includes(t)} onChange={() => toggleInArray(setSelectedGq, t)} className="w-3 h-3 accent-pink-600" />
                  <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: CD_FIT_COMPONENTS[t]?.color }} />
                  <span className="text-xs font-medium text-slate-700">{CD_FIT_COMPONENTS[t]?.label}</span>
                </label>
              ))}
            </div>
          )}
          {isSim && (
            <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">{CD_SIM_INFO[tab].ratioLabel}</div>
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Ratio</span><span className="font-mono">{ratio.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="10" step="0.1" value={ratio} onChange={(e) => setRatio(parseFloat(e.target.value))} className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-600" />
              <p className="text-[10px] leading-4 text-slate-500">{CD_SIM_INFO[tab].description}</p>
            </div>
          )}
          <button onClick={() => { setSelectedProtein(['alpha', 'beta', 'coil']); setSelectedDna(['bDNA']); setSelectedGq(['gqP']); setRatio(0); setNormalize(true); }}
            className="mt-2 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors">
            Reset Selection
          </button>
        </div>
      </div>
    </div>
  );
};

export const Simulations = ({ ctx }) => {
  const { updateActiveTest } = ctx || {};
  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));

  const saveSnapshot = (field, label) => (image) => {
    if (!updateActiveTest || !image) return;
    updateActiveTest({ [field]: { label, image, savedAt: new Date().toISOString() } });
  };

  return (
    <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        {fsPanel === 'mixer' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('mixer')} />}
        <ProteinCDMixer isExpanded={fsPanel === 'mixer'} onToggleExpand={() => toggleFs('mixer')} onSnapshot={saveSnapshot('cdSimMixer', 'Protein Secondary Structure Simulator')} />
        {fsPanel === 'library' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('library')} />}
        <CDSpectraLibrary isExpanded={fsPanel === 'library'} onToggleExpand={() => toggleFs('library')} onSnapshot={saveSnapshot('cdSimLibrary', 'CD Spectra Reference Library & DNA/Protein Mixture Simulator')} />
      </div>
    </CollapsibleSection>
  );
};

/* ========================================================================
NOTEBOOK EXTRA
======================================================================== */
/* ========================================================================
INSTRUMENTAL SETUP (CD spectrometer)
Wired in via CDTestRenderer's `custom.InstrumentalSetup`, so it renders inside
TestShellRenderer's own "Instrumental Setup" section instead of duplicating one.
======================================================================== */
export const InstrumentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';
  const INPUT_CLS = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CD_INSTRUMENTAL_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={activeTest[f.key] || ''} onChange={(e) => update({ [f.key]: e.target.value })} className={INPUT_CLS}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <div className={f.units ? 'flex gap-1' : ''}>
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={activeTest[f.key] || ''}
                  onChange={(e) => update({ [f.key]: e.target.value })}
                  onWheel={f.type === 'number' ? (e) => e.target.blur() : undefined}
                  placeholder={f.placeholder}
                  className={`${INPUT_CLS} ${f.units ? 'flex-1 min-w-0' : 'w-full'}`}
                />
                {f.units && (
                  f.units.length > 1 ? (
                    <select value={activeTest[`${f.key}Unit`] || f.units[0]} onChange={(e) => update({ [`${f.key}Unit`]: e.target.value })} className={`${INPUT_CLS} w-24 shrink-0`}>
                      {f.units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 self-center px-1 shrink-0">{f.units[0]}</span>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">Spectrometer configuration used to acquire the spectra for this condition — saved per condition, like the other experimental fields.</p>
    </div>
  );
};

export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useCdDerived(activeTest, ctx);
  if (checkId === 'cond') {
    const expStr = CD_EXPERIMENTAL_FIELDS
      .map((f) => {
        const v = getExpValue(d.activeInstance, f.key);
        if (v === '') return '';
        const u = getExpUnit(d.activeInstance, f);
        return `${f.label}: ${v}${u ? ` ${u}` : ''}`;
      })
      .filter(Boolean)
      .join(' | ');
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Condition:</b> ${d.activeInstance ? d.activeInstance.name : 'N/A'} | ${expStr || 'No experimental condition values set'}</p>`;
  }
  if (checkId === 'instrument') {
    const instrStr = CD_INSTRUMENTAL_FIELDS
      .map((f) => {
        const v = activeTest[f.key];
        if (!v) return '';
        const u = f.units ? (activeTest[`${f.key}Unit`] || f.units[0]) : '';
        return `${f.label}: ${v}${u ? ` ${u}` : ''}`;
      })
      .filter(Boolean)
      .join(' | ');
    if (!instrStr) return '';
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Instrumental Setup (${d.activeInstance ? d.activeInstance.name : 'Condition'}):</b> ${instrStr}</p>`;
  }
  if (checkId === 'spectra') {
    if (!d.activeParsed.parsedSpectra.length) return '';
    const titles = d.activeParsed.parsedSpectra.map((s) => s.title || 'Spectrum').join(', ');
    const wl = d.activeParsed.parsedWavelengths;
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Spectra (${d.activeInstance ? d.activeInstance.name : 'Condition'}):</b> ${titles}<br/><span style="font-size: 11px; color: #64748b;">Wavelength range: ${wl.length ? `${Math.min(...wl)}–${Math.max(...wl)} nm (${wl.length} points)` : 'N/A'} · Y unit: ${activeTest.yUnit === 'theta' ? thetaUnitLabel(thetaModeOf(activeTest)) : 'mdeg'}</span></p>`;
  }
  if (checkId === 'struct' || checkId === 'table') {
    const rows = [];
    d.instances.forEach((inst) => {
      const parsed = computeParsed(inst.test);
      Object.entries(inst.test.ssFits || {}).forEach(([specId, res]) => {
        const s = parsed.parsedSpectra.find((x) => x.id === specId);
        rows.push({ inst: inst.name, spec: s ? (s.title || 'Spectrum') : specId, res });
      });
    });
    if (!rows.length) return '';
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Condition</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Spectrum</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Composition</th><th style="padding: 6px; border: 1px solid #cbd5e1;">R²</th></tr>`;
    rows.forEach(({ inst, spec, res }) => {
      const compStr = (res.activeBases || ['alpha', 'beta', 'turn', 'coil']).map(k => {
        const v = res.fractions ? res.fractions[k] : res[k];
        return v > 0 ? `${CD_FIT_COMPONENTS[k]?.label || k}: <b>${v}%</b>` : null;
      }).filter(Boolean).join('<br/>');
      html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${inst}</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${spec}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${compStr}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${res.manual ? '— (manual)' : Number(res.r2 || 0).toFixed(4)}</td></tr>`;
    });
    html += `</table>`;
    return html;
  }
  return '';
};

/* ========================================================================
ALL
======================================================================== */
export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <Data ctx={ctx} />
    <DataAnalysis ctx={ctx} />
    <Simulations ctx={ctx} />
  </div>
);
export default All;
