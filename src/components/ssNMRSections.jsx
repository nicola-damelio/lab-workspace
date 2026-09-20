// ============================================================================
// ssNMRSections.jsx
// Circular Dichroism page: Data · Data Analysis (spectra, fitter, condition
// plots) · Simulations.
// ============================================================================

import React, {useState, useEffect, useRef, useMemo} from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, BarChart, Bar, LineChart, Line, Legend, ErrorBar, Cell, ComposedChart} from 'recharts';
import { SharedErrorTreatment, ChartControlBar, SharedChartStylePanel, ChartInspector, brokenAxisProps, AngledTick, useXYZoom, cfgSeriesEl, cfgLogScale, cfgAxisTicks, cfgAxisDomain, cfgTickFormatter, cfgAxisLabel, cfgChartMargin, errorBarRange, instancesLinked, InstanceLinkToggle, deferredClick } from './SharedAnalysisTools';
import { CollapsibleSection } from './ui';
import { FS_CLASSES, OVERLAY_CLASSES, CHART_MARGIN, VIS_PALETTES, seriesColorFor, chartBoxStyle, chartRatioBoxStyle, seriesPointStyle, seriesPtSize, seriesLineThickness, seriesDash, seriesLabelOf, tickTextProps, tickSize, fontFamilyOf, legendTextStyle, axisTitleSize, tickColorOf
} from '../utils/chartStyle';
import { SplitChartStack, SplitLayoutControls, SplitToggle, splitRowBoxStyle, splitChartClass, splitChartMargin, splitLayoutOf, splitXAxisHidden, splitYAxisProps, withSplitLayout, hiddenSeriesOf, withoutSeries } from './SplitChartStack';
export { CollapsibleSection };
export { VIS_PALETTES };
import { DriveUploadButton } from './DriveUpload';
import { suggestDriveFileName, canonicalExperimentPath, sanitizeSlug } from '../utils/driveNaming';
import { uploadLocalFile, getDriveToken } from '../utils/driveUpload';
import { archiveRestoreJson, isMissingColumns, isMissingValue, placeRestorePointer, restoreJsonFor, restoreStems, takePendingRestorePointer } from '../utils/driveRestore';
import { useDriveAutoRestore } from './useDriveAutoRestore';

/* ── RESTAURATION AUTOMATIQUE DU SPECTRE ssNMR DEPUIS LE DRIVE ──────────────
   (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
   Les colonnes d'un spectre vivent dans le document du dataset, qui ne peut PAS
   les porter en entier : compressDatasetForSave finit par remplacer chaque
   colonne par un marqueur (« [data omitted — kept in browser cache / Drive or
   re-uploadable] »). La version plein format est donc archivée sur le Drive en
   JSON gzip, dans le dossier canonique de l'instance (le MÊME que les fichiers
   bruts de l'import Bruker), et l'instance n'en garde qu'un pointeur de ~80
   octets (`ssnmrDrive`) qui voyage avec le dataset — donc d'un poste à l'autre.
   Sur un poste vierge, la restauration retrouve le fichier par son NOM
   (`<instance>_ssnmr1d_restore.json.gz`) : ni la cache IndexedDB ni le registre
   local du navigateur ne sont nécessaires. */
const SSNMR_RESTORE_KIND = 'ssnmr1d';
const ssnmrDriveCtx = (test = {}, instance = '') => ({
  project: (test.projectNames || [])[0] || '',
  test: test.name || '',
  scientist: test.operator || '',
  section: 'Data',
  subsection: 'Bruker 1r',
  instance: instance || test.instanceName || ''
});

/** Archive la copie de référence des colonnes d'un spectre ssNMR et rend son
 *  pointeur (`{ id, name, url, driveUrl, at }`), ou null quand le Drive n'est
 *  pas joignable — un import ne doit JAMAIS échouer pour cette raison. */
const archiveSsnMRColumns = async ({
  test, instance, columns, rawColumns = null, wavelengthData = '',
  yUnit = 'raw', brukerMeta = null, source = {}
}) => (
  archiveRestoreJson({
    kind: SSNMR_RESTORE_KIND,
    suffix: SSNMR_RESTORE_KIND,
    stem: instance,
    data: {
      columns: Array.isArray(columns) ? columns : [],
      rawColumns: Array.isArray(rawColumns) && rawColumns.length ? rawColumns : null,
      wavelengthData: wavelengthData || '',
      yUnit: yUnit || 'raw',
      brukerMeta: brukerMeta || null,
      instanceName: instance || '',
      source
    },
    ctx: ssnmrDriveCtx(test, instance)
  })
);

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
EXPERIMENTAL-CONDITION FIELDS
======================================================================== */
export const SSNMR_EXPERIMENTAL_FIELDS = [
  { key: 'temperature', label: 'Temperature', unitKey: 'temperatureUnit', units: ['K', '°C'] },
  { key: 'lipid', label: 'Lipid', unitKey: '' },
  { key: 'deuteration', label: 'Deuteration Pattern', unitKey: '' },
  { key: 'hydration', label: 'Hydration', unitKey: '' },
  { key: 'ph', label: 'pH', unitKey: '' },
  { key: 'cholesterolRatio', label: 'Cholesterol (mol %)', unitKey: '' },
  { key: 'ratio', label: 'Peptide:Lipid Ratio', unitKey: '' },
  { key: 'solvent', label: 'Solvent', unitKey: '', type: 'solvent-select' },
  // bufferName/additiveName are rendered by the shared <BufferAdditiveFields>
  { key: 'bufferName', label: 'Buffer', unitKey: '' },
  { key: 'additiveName', label: 'Additive', unitKey: '' },
  { key: 'otherMolecule', label: 'Other Molecule / Ligand', unitKey: '' }
];

export const SSNMR_DEFAULT_UNITS = SSNMR_EXPERIMENTAL_FIELDS.reduce((acc, f) => {
  if (f.unitKey && Array.isArray(f.units) && f.units.length) acc[f.unitKey] = f.units[0];
  return acc;
}, {});

export const SSNMR_INSTRUMENTAL_FIELDS = [
  { key: 'experimentNumber', label: 'Experiment Number', type: 'text', placeholder: 'e.g. 1' },
  { key: 'instrumentModel', label: 'Spectrometer', type: 'text', placeholder: 'e.g. Bruker Avance III 500' },
  { key: 'deutFreq', label: '²H Frequency', type: 'text', placeholder: 'e.g. 76.8', units: ['MHz'] },
  { key: 'probe', label: 'Probe', type: 'text', placeholder: 'e.g. 5 mm static broadband' },
  { key: 'pulseProgram', label: 'Pulse Program', type: 'select', options: ['Quadrupolar Echo', 'Solid Echo', 'Single Pulse'] },
  { key: 'pulseLength', label: '90° Pulse Length', type: 'text', placeholder: 'e.g. 3.2', units: ['µs'] },
  { key: 'echoDelay', label: 'Echo Delay', type: 'text', placeholder: 'e.g. 40', units: ['µs'] },
  { key: 'recycleDelay', label: 'Recycle Delay', type: 'text', placeholder: 'e.g. 1', units: ['s'] },
  { key: 'accumulations', label: 'Number of Scans', type: 'number', placeholder: 'e.g. 512' },
  { key: 'spectralWidthKHz', label: 'Spectral Width', type: 'text', placeholder: 'e.g. 250', units: ['kHz'] },
  { key: 'lineBroadening', label: 'Line Broadening', type: 'text', placeholder: 'e.g. 100', units: ['Hz'] }
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

  // Fallback for shells that only expose updateActiveTest.
  // This prevents updates from being silently dropped when per-instance
  // updating is not available.
  if (typeof ctx?.updateActiveTest === 'function') {
    ctx.updateActiveTest(updates);
  }
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
   BRUKER 1R IMPORT (local files or Google Drive links)
   ======================================================================== */
const parseBrukerParams = (text) => {
  const params = {};
  let key = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^##\$([A-Za-z0-9_]+)=(.*)$/);
    if (m) {
      key = m[1];
      let v = m[2].trim();
      if (v.startsWith('<') && v.endsWith('>')) v = v.slice(1, -1).trim();
      params[key] = v;
    } else if (key && line && !line.startsWith('##')) {
      params[key] += '\n' + line;
    }
  }
  return params;
};

const brukerNum = (p, k, d = 0) => {
  const v = parseFloat(p[k]);
  return Number.isFinite(v) ? v : d;
};

// Bruker array parameters are stored as:
//   ##$D= (0..63)
//   0 1 0 0 …       ← values on the following line(s), index 0 = D0, 1 = D1, …
// Returns the element at `index`, falling back to a scalar "##$D1=" entry when
// the array form is not present (older TopSpin writes the delays individually).
const brukerArrayElem = (p, key, index, d = 0) => {
  const raw = p[key];
  if (raw == null) return d;
  // Drop the "(0..63)" header (wherever it appears) and any "##$D=" prefix,
  // then parse every remaining number in order: D0, D1, D2, …
  const str = String(raw)
    .replace(/\(\s*[\d.]+\s*\.\.\s*[\d.]+\s*\)/g, ' ')
    .replace(/^##\$[A-Za-z0-9_]+\s*=\s*/, ' ');
  const nums = str.split(/\s+/).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
  return nums.length > index && Number.isFinite(nums[index]) ? nums[index] : d;
};

// Acquisition date from the acqus text (##$DATE= or an embedded date string).
const extractAcqusDate = (text) => {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const mKey = raw.match(/^##\$DATE=\s*([^\s\r\n]+)/m);
  const rawDate = mKey ? mKey[1] : null;
  const cand = rawDate || raw;
  if (rawDate) {
    const mCompact = rawDate.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (mCompact) return `${mCompact[1]}-${mCompact[2]}-${mCompact[3]}`;
  }
  const mIso = cand.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (mIso) return `${mIso[1]}-${String(mIso[2]).padStart(2, '0')}-${String(mIso[3]).padStart(2, '0')}`;
  const mUs = cand.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (mUs) return `${mUs[3]}-${String(mUs[1]).padStart(2, '0')}-${String(mUs[2]).padStart(2, '0')}`;
  const mMon = cand.match(/(\d{1,2})[-\/.\s]+([A-Za-z]{3,9})[-\/.\s]+(\d{4})/);
  if (mMon) {
    const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const mo = months[String(mMon[2]).slice(0, 3).toLowerCase()];
    if (mo) return `${mMon[3]}-${String(mo).padStart(2, '0')}-${String(mMon[1]).padStart(2, '0')}`;
  }
  return null;
};
const fileDate = (ms) => {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
};

const decode1rBuffer = (buffer, littleEndian) => {
  const n = Math.floor(buffer.byteLength / 4); // 1r = 32-bit integers
  const dv = new DataView(buffer);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = dv.getInt32(i * 4, littleEndian);
  return y;
};

// Wrong endianness scatters values across the full ±2^31 range; the correct
// decoding keeps them well below that. Pick the "quieter" decoding.
const decode1rAuto = (buffer, forceLE = null) => {
  if (forceLE !== null) return { y: decode1rBuffer(buffer, forceLE), littleEndian: forceLE, autoEndian: false };
  const be = decode1rBuffer(buffer, false);
  const le = decode1rBuffer(buffer, true);
  const p99 = (arr) => {
    const a = Array.from(arr, Math.abs).sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * 0.99))];
  };
  const littleEndian = p99(le) < p99(be);
  return { y: littleEndian ? le : be, littleEndian, autoEndian: true };
};

// Frequency axis in kHz relative to the carrier (O1). Point 0 sits at the
// high-frequency edge (O1 + SW_h/2), exactly like TopSpin displays it.
const brukerFreqAxis = (swHz, o1Hz, n) => {
  const left = o1Hz + swHz / 2;
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = (left - (i * swHz) / n) / 1000;
  return xs;
};

// Min/max downsampling keeps the sharp ²H horns while staying plot-friendly
const downsampleXY = (xs, ys, maxPoints = 8000) => {
  const n = ys.length;
  if (n <= maxPoints) return { xs: Array.from(xs), ys: Array.from(ys) };
  const outX = [], outY = [], bucket = n / maxPoints;
  for (let b = 0; b < maxPoints; b++) {
    const s = Math.floor(b * bucket);
    const e = Math.max(s + 1, Math.floor((b + 1) * bucket));
    let iMin = s, iMax = s;
    for (let i = s; i < e; i++) {
      if (ys[i] < ys[iMin]) iMin = i;
      if (ys[i] > ys[iMax]) iMax = i;
    }
    const [a, z] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
    outX.push(xs[a], xs[z]); outY.push(ys[a], ys[z]);
  }
  return { xs: outX, ys: outY };
};

// Google Drive share link → direct download URL (file must be "anyone with link")
const resolveDriveUrl = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  let m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  m = u.match(/[?&]id=([\w-]+)/);
  if (m && /drive\.google\.com/.test(u)) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return u;
};

// Main entry — returns the same { xs, ys, meta } shape parseJascossNMRText did,
// so the rest of the Data section works unchanged.
const importBruker1r = ({ dataBuffer, acqusText = '', manualSWkHz = null, manualOffsetKHz = 0, title = '', forceLE = null }) => {
  if (!dataBuffer || dataBuffer.byteLength < 16) return { error: 'Empty or invalid 1r file (if it came from Drive, check the share permissions).' };
  const looksHtml = new TextDecoder().decode(new Uint8Array(dataBuffer.slice(0, 32))).includes('<!DOC');
  if (looksHtml) return { error: 'Drive returned a web page instead of the binary file — set sharing to "Anyone with the link".' };

  const acqus = acqusText && acqusText.trim().startsWith('##') ? parseBrukerParams(acqusText) : {};
  const { y, littleEndian, autoEndian } = decode1rAuto(dataBuffer, forceLE);

  let xs;
  const swHz = brukerNum(acqus, 'SW_h');
  if (swHz > 0) {
    xs = brukerFreqAxis(swHz, brukerNum(acqus, 'O1'), y.length);
  } else if (manualSWkHz) {
    xs = brukerFreqAxis(manualSWkHz * 1000, manualOffsetKHz * 1000, y.length);
  } else {
    return { error: 'No valid acqus and no manual spectral width — cannot build the kHz axis.' };
  }

  const ds = downsampleXY(xs, y, 8000);
  // Acquisition parameters read from the acqus file — shown in the Instrumental
  // Setup "Datasets" rows. D1/D6/D8 and P1 are read from the "##$D= (0..63)" /
  // "##$P= (0..63)" arrays (index 0 = D0 / P0, 1 = D1 / P1, …), SW is expressed
  // in ppm using SFO2 as the observe frequency, O1 in Hz.
  const sfo1 = brukerNum(acqus, 'SFO1');
  const sfo2 = brukerNum(acqus, 'SFO2');
  const o1Hz = brukerNum(acqus, 'O1');
  const acqusParams = {
    ns: brukerNum(acqus, 'NS') || '',
    ds: brukerNum(acqus, 'DS') || '',
    rg: brukerNum(acqus, 'RG') || '',
    p1: brukerNum(acqus, 'P1') || brukerArrayElem(acqus, 'P', 1) || '',
    d1: brukerNum(acqus, 'D1') || brukerArrayElem(acqus, 'D', 1) || '',
    d8: brukerNum(acqus, 'D8') || brukerArrayElem(acqus, 'D', 8) || '',
    d6: brukerNum(acqus, 'D6') || brukerArrayElem(acqus, 'D', 6) || '',
    sw: (swHz > 0 && sfo2 > 0 ? swHz / sfo2 : swHz > 0 && sfo1 > 0 ? swHz / sfo1 : brukerNum(acqus, 'SW')) || '',
    o1: o1Hz || '',
    td: brukerNum(acqus, 'TD') || ''
  };
  return {
    xs: ds.xs, ys: ds.ys, littleEndian, autoEndian, nPoints: y.length,
    acqusParams,
    date: extractAcqusDate(acqusText) || null,
    meta: {
      swKHz: swHz / 1000 || manualSWkHz || null,
      o1KHz: o1Hz / 1000,
      sfo1,
      temperatureK: brukerNum(acqus, 'TE') || null,
      nucleus: acqus.NUC1 || '',
      title: title || acqus.TITLE || ''
    }
  };
};

/* ========================================================================
MOLAR ELLIPTICITY
======================================================================== */

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

/* ========================================================================
   DEUTERIUM QUADRUPOULAR MODEL
   Each labelled carbon of the acyl chain contributes one Pake doublet:
   Δν_q(i) = (3/2) · χ · S_CD(i),  χ ≈ 167 kHz for a C–²H bond.
   Deviations of Δν_q from the rigid limit encode the order parameter.
   ======================================================================== */
export const SSNMR_FIT_COMPONENTS = {
  C2:  { label: 'C2',  color: '#3b82f6' }, C3:  { label: 'C3',  color: '#6366f1' },
  C4:  { label: 'C4',  color: '#8b5cf6' }, C5:  { label: 'C5',  color: '#a855f7' },
  C6:  { label: 'C6',  color: '#ec4899' }, C7:  { label: 'C7',  color: '#f43f5e' },
  C8:  { label: 'C8',  color: '#ef4444' }, C9:  { label: 'C9',  color: '#f97316' },
  C10: { label: 'C10', color: '#f59e0b' }, C11: { label: 'C11', color: '#eab308' },
  C12: { label: 'C12', color: '#84cc16' }, C13: { label: 'C13', color: '#22c55e' },
  C14: { label: 'C14', color: '#10b981' }, C15: { label: 'C15', color: '#14b8a6' },
  C16: { label: 'C16 (CD₃)', color: '#06b6d4' }
};

// One doublet ≈ two Gaussian horns at ±Δν/2 around the carrier
const doubletAt = (x, dNu, amp, sigma) => {
  const h = dNu / 2;
  const s2 = 2 * sigma * sigma;
  return amp * (Math.exp(-((x - h) * (x - h)) / s2) + Math.exp(-((x + h) * (x + h)) / s2));
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

/* Weighted Levenberg–Marquardt fit of a sum of n doublets.
   Params: [Δν_1..n, amp_1..n, sigma, baseline].
   Returns the same envelope fitssNMRSpectrum used:
   { success, fractions, activeBases, r2, nPoints, ... } or { error }       */
const fitQuadrupolarSpectrum = (xs, ys, nDoublets, chiKHz = 167, opts = {}) => {
  if (!nDoublets || nDoublets < 1) return { error: 'Set the number of deuterated carbons (doublets).' };
  if (nDoublets > Object.keys(SSNMR_FIT_COMPONENTS).length) return { error: 'Maximum 15 doublets (C2–C16).' };
  const pts = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push({ x: xs[i], y: ys[i] });
  }
  if (pts.length < 3 * (2 * nDoublets + 2)) {
    return { error: `Not enough points (${pts.length}) to fit ${nDoublets} doublets.` };
  }

  const span = 2 * Math.max(...pts.map((p) => Math.abs(p.x)), 1);
  const yMax = Math.max(...pts.map((p) => p.y));
  const sigma0 = opts.sigma0 ?? Math.max(0.5, span / 80);
  const dNuMax0 = opts.dNuMax0 ?? Math.min(span * 0.85, 60);

  const P0 = [];
  for (let k = 0; k < nDoublets; k++) P0.push(dNuMax0 * (1 - (0.7 * k) / Math.max(1, nDoublets - 1)));
  for (let k = 0; k < nDoublets; k++) P0.push(yMax / nDoublets);
  P0.push(sigma0, 0); // linewidth, baseline

  const n = nDoublets;
  const model = (x, P) => {
    const sigma = Math.max(1e-3, Math.abs(P[2 * n]));
    let v = P[2 * n + 1] || 0;
    for (let k = 0; k < n; k++) v += doubletAt(x, Math.abs(P[k]), Math.abs(P[n + k]), sigma);
    return v;
  };

  const res = fitGeneric(pts, model, P0);
  if (!res) return { error: 'Fit did not converge. Try fewer doublets or set an initial max splitting.' };

  // Sort splittings descending (plateau → chain end) and assign carbon labels
  const labels = Object.keys(SSNMR_FIT_COMPONENTS).slice(0, n);
  const doublets = [];
  for (let k = 0; k < n; k++) doublets.push({ dNu: Math.abs(res.params[k]), amp: Math.abs(res.params[n + k]) });
  doublets.sort((a, b) => b.dNu - a.dNu);
  const ampSum = doublets.reduce((s, dd) => s + dd.amp, 0) || 1;
  const sigmaFit = Math.abs(res.params[2 * n]);

  const fractions = {}, splittings = {}, amps = {}, ampsAbs = {};
  labels.forEach((lab, k) => {
    splittings[lab] = +doublets[k].dNu.toFixed(2);                          // kHz
    fractions[lab] = +(doublets[k].dNu / (1.5 * chiKHz)).toFixed(3);        // S_CD
    amps[lab] = +((doublets[k].amp / ampSum) * 100).toFixed(1);
    ampsAbs[lab] = doublets[k].amp;
  });

  return {
    success: true, fractions, splittings, amps, ampsAbs,
    chiKHz, sigmaFit, r2: res.r2, nPoints: pts.length,
    activeBases: labels,
    fitMin: Math.min(...pts.map((p) => p.x)), fitMax: Math.max(...pts.map((p) => p.x))
  };
};

const buildSimulatedCurve = (fitRes, xs) => {
  if (!fitRes || !fitRes.splittings) return [];
  const sigma = fitRes.sigmaFit || 1.5;
  return xs
    .filter((x) => Number.isFinite(x))
    .map((x) => {
      let y = 0;
      fitRes.activeBases.forEach((lab) => {
        y += doubletAt(x, fitRes.splittings[lab], fitRes.ampsAbs[lab] || 0, sigma);
      });
      return { x, y };
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

const useSSNMRDerived = (activeTest, ctx = {}) => {
  const instances = getInstances(ctx, activeTest);
  const activeInstance =
    instances.find((i) => i.id === activeTest.id) || instances[0] || null;
  const conditionFields = SSNMR_EXPERIMENTAL_FIELDS;
  const activeParsed = useMemo(() => computeParsed(activeInstance ? activeInstance.test : null), [activeInstance]);
  const mw = getMWForInstance(activeInstance, ctx);
  const compoundMW = getCompoundMW(activeInstance, ctx);
  return { instances, activeInstance, conditionFields, activeParsed, mw, compoundMW };
};
// =========================================================================
// ssNMRSections.jsx - REPLACE Data COMPONENT
// =========================================================================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useSSNMRDerived(activeTest, ctx);
  const { activeInstance, activeParsed, instances } = d;

  const instTest = (activeInstance && activeInstance.test) ? activeInstance.test : activeTest;
  const spectraColumns = instTest.spectraColumns || [];
  const yUnit = instTest.yUnit || 'raw';

  const patchActive = (updates) => {
    if (activeInstance && typeof ctx.updateInstance === 'function') {
      ctx.updateInstance(activeInstance.id, updates);
      return;
    }
    if (typeof updateActiveTest === 'function') {
      updateActiveTest(updates);
      return;
    }
    if (typeof ctx.updateActiveTest === 'function') {
      ctx.updateActiveTest(updates);
    }
  };

  /* Condition réellement affichée : `patchActive` écrit sur ELLE, donc c'est son
     id qui dit si le pointeur d'une archive (asynchrone) peut être posé tout de
     suite ou s'il doit attendre qu'on revienne sur cette condition. */
  const ssnmrActiveKey = (activeInstance && activeInstance.id) || activeTest.id;
  const ssnmrActiveKeyRef = useRef(ssnmrActiveKey);
  ssnmrActiveKeyRef.current = ssnmrActiveKey;
  useEffect(() => {
    const pending = takePendingRestorePointer({ field: 'ssnmrDrive', key: ssnmrActiveKey });
    if (!pending) return;
    patchActive(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssnmrActiveKey]);

  const updateWavelengthData = (val) => patchActive({ wavelengthData: val });
  const addSpectrumColumn = () => {
    const cols = [...spectraColumns];
    cols.push({
      id: makeId('spec'),
      title: `Spectrum ${cols.length + 1}`,
      data: '',
      color: SPECTRA_PALETTE[cols.length % SPECTRA_PALETTE.length],
      visible: true
    });
    patchActive({ spectraColumns: cols });
  };
  const patchColumn = (id, patch) =>
    patchActive({ spectraColumns: spectraColumns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeSpectrumColumn = (id) =>
    patchActive({ spectraColumns: spectraColumns.filter((c) => c.id !== id) });

  // ── RESTAURATION AUTOMATIQUE DES COLONNES DEPUIS LE DRIVE ────────────────
  // (mécanisme général : src/utils/driveRestore.js + useDriveAutoRestore.js)
  // Le document du dataset ne peut pas porter un spectre entier : quand il faut
  // faire de la place, compressDatasetForSave remplace chaque colonne par un
  // marqueur. Le Drive est donc la copie de RÉFÉRENCE — à l'ouverture de la
  // page, des colonnes manquantes sont re-téléchargées TOUT SEUL (autre poste,
  // cache vidée, données retirées par la limite Firestore) puis réinjectées ici,
  // et l'utilisateur n'a rien à faire.
  const ssnmrDefaultStems = () => restoreStems(
    instTest.instanceName,
    instTest.brukerMeta && instTest.brukerMeta.title,
    Array.isArray(instTest.instrumentalDatasets) && instTest.instrumentalDatasets[0]
      ? instTest.instrumentalDatasets[0].name : ''
  );

  const ssnmrDriveMissing = () => {
    if (isMissingColumns(instTest.spectraColumns)) return true; // vidées, ou marqueur « omitted »
    /* Colonnes présentes : l'axe des déplacements (wavelengthData) a-t-il été
       retiré par la limite Firestore ? Un spectre sans axe (colonnes saisies à
       la main) n'est PAS un manque : rien n'a été archivé pour lui. */
    return isMissingValue(instTest.wavelengthData) && !!instTest.ssnmrDrive;
  };

  const restoreSsnMRFromDrive = async () => {
    const pointer = instTest.ssnmrDrive || null;
    const stems = (pointer && Array.isArray(pointer.stems) && pointer.stems.length
      ? pointer.stems
      : ssnmrDefaultStems());
    const found = await restoreJsonFor({
      kind: SSNMR_RESTORE_KIND, suffix: SSNMR_RESTORE_KIND, stems,
      ctx: ssnmrDriveCtx(activeTest, instTest.instanceName), pointer
    });
    if (!found) {
      return {
        ok: false,
        message: '⚠️ These spectra are not in this browser and no copy was found on Google Drive. Connect Google Drive, then re-import the Bruker folder: the raw files AND the spectra are archived at import.'
      };
    }
    const data = (found.data && typeof found.data === 'object') ? found.data : {};
    const columns = Array.isArray(data.columns) ? data.columns : [];
    if (!columns.length || isMissingColumns(columns)) {
      return { ok: false, message: `⚠️ The copy found on Google Drive (${found.name}) is unreadable — re-import the Bruker folder.` };
    }
    patchActive({
      spectraColumns: columns,
      wavelengthData: data.wavelengthData || instTest.wavelengthData || '',
      yUnit: data.yUnit || instTest.yUnit || 'raw',
      ...(Array.isArray(data.rawColumns) && data.rawColumns.length ? { rawSpectraColumns: data.rawColumns } : {}),
      ...(data.brukerMeta ? { brukerMeta: data.brukerMeta } : {}),
      ssnmrDrive: {
        ...(instTest.ssnmrDrive || {}),
        id: found.id, name: found.name, at: Date.now(), stems, restoredAt: Date.now()
      }
    });
    return { ok: true, message: `✅ Spectra restored from Google Drive (${found.name}).` };
  };

  const ssnmrRestore = useDriveAutoRestore({
    kind: SSNMR_RESTORE_KIND,
    testId: ssnmrActiveKey,
    missing: ssnmrDriveMissing,
    restore: restoreSsnMRFromDrive
  });

  const [brukerDataUrl, setBrukerDataUrl] = useState('');
  const [brukerAcqusUrl, setBrukerAcqusUrl] = useState('');
  const [brukerSw, setBrukerSw] = useState('');
  const [brukerOffset, setBrukerOffset] = useState('0');
  const [brukerStartKHz, setBrukerStartKHz] = useState('');
  const [brukerEndKHz, setBrukerEndKHz] = useState('');
  const [brukerNumPoints, setBrukerNumPoints] = useState('');
  const [brukerMsg, setBrukerMsg] = useState('');
  const [brukerBusy, setBrukerBusy] = useState(false);
  const brukerFileRef = useRef(null);
  // Discovered-but-not-yet-imported Bruker spectra (folder import shows a
  // selection dialog so the user can pick which experiments to import).
  const [pendingSpectra, setPendingSpectra] = useState([]);
  const [selectedSpectraIds, setSelectedSpectraIds] = useState([]);

  const interpolateY = (xs, ys, targetX) => {
    const n = xs.length;
    if (n === 0) return null;
    if (xs[0] < xs[n - 1]) {
      if (targetX <= xs[0]) return ys[0];
      if (targetX >= xs[n - 1]) return ys[n - 1];
    } else {
      if (targetX >= xs[0]) return ys[0];
      if (targetX <= xs[n - 1]) return ys[n - 1];
    }
    for (let i = 0; i < n - 1; i++) {
      const minX = Math.min(xs[i], xs[i + 1]);
      const maxX = Math.max(xs[i], xs[i + 1]);
      if (targetX >= minX && targetX <= maxX) {
        const span = xs[i + 1] - xs[i];
        if (span === 0) return ys[i];
        return ys[i] + ((targetX - xs[i]) * (ys[i + 1] - ys[i])) / span;
      }
    }
    return null;
  };

  const applyBruker = (parsed, filename) => {
    if (parsed.error) { setBrukerMsg(`⚠️ ${parsed.error}`); return; }
    
    let finalXs = parsed.xs;
    let finalYs = parsed.ys;
    const hasCustomRange = (brukerStartKHz !== '' && brukerEndKHz !== '') || (brukerNumPoints !== '' && Number(brukerNumPoints) > 0);
    
    if (hasCustomRange) {
        const xMin = Math.min(...parsed.xs);
        const xMax = Math.max(...parsed.xs);
        const isDesc = parsed.xs[0] > parsed.xs[parsed.xs.length - 1];
        
        const sK = brukerStartKHz !== '' ? Number(brukerStartKHz) : (isDesc ? xMax : xMin);
        const eK = brukerEndKHz !== '' ? Number(brukerEndKHz) : (isDesc ? xMin : xMax);
        const nPts = brukerNumPoints !== '' && Number(brukerNumPoints) > 1 ? Number(brukerNumPoints) : parsed.xs.length;
        
        const newXs = [];
        const newYs = [];
        for (let i = 0; i < nPts; i++) {
            const x = sK + (eK - sK) * (i / (nPts - 1 || 1));
            newXs.push(x);
            const y = interpolateY(parsed.xs, parsed.ys, x);
            newYs.push(y !== null && Number.isFinite(y) ? y : 0);
        }
        finalXs = newXs;
        finalYs = newYs;
    }

    const updates = {
        wavelengthData: finalXs.map((x) => (+x.toFixed(4))).join('\n'),
        spectraColumns: [{
            id: makeId('spec'),
            title: parsed.meta.title || 'Bruker 1r spectrum',
            data: Array.from(finalYs).map(String).join('\n'),
            color: SPECTRA_PALETTE[0], visible: true
        }],
        yUnit: 'raw',
        brukerMeta: parsed.meta
    };
    
    if (filename) updates.instanceName = filename.replace(/\.[^/.]+$/, "");
    // "T" in Experimental Conditions ← TE from the acqus file (Kelvin).
    if (parsed.meta && parsed.meta.temperatureK > 0) {
        updates.temperature = String(parsed.meta.temperatureK);
        updates.temperatureUnit = 'K';
    }
    // Instrumental Setup "Datasets" row — experiment number + dataset name (the
    // directory that contains the expno dir) + acquisition date + acqus params.
    if (parsed.expNum) {
        const expNum = String(parsed.expNum);
        const existingDatasets = Array.isArray(instTest.instrumentalDatasets) ? instTest.instrumentalDatasets : [];
        const existing = existingDatasets.find((d) => String(d.experimentNumber) === expNum);
        const row = {
            id: existing ? existing.id : makeId('instrumental_dataset'),
            experimentNumber: expNum,
            name: parsed.datasetName || (existing ? existing.name : '') || filename || `Dataset ${expNum}`,
            date: parsed.acqusDate || parsed.date || (existing ? existing.date : new Date().toISOString().split('T')[0]),
            operator: existing ? existing.operator : (activeTest.operator || ''),
            link: existing ? existing.link : '',
            comments: existing ? existing.comments : '',
            acqus: { ...(existing ? existing.acqus : {}), ...(parsed.acqusParams || {}) }
        };
        updates.instrumentalDatasets = existing
            ? existingDatasets.map((d) => (d.id === existing.id ? { ...d, ...row } : d))
            : [...existingDatasets, row];
    }
    
    patchActive(updates);

    /* La copie de RÉFÉRENCE part sur le Drive TOUT DE SUITE (best-effort) : le
       document du dataset ne peut pas porter un spectre entier, donc sans cette
       archive les colonnes n'existeraient que dans le navigateur qui a importé.
       Un Drive injoignable ne casse rien : « ⬇️ Restore from Drive » réessaie, et
       une ré-importation réécrit le même fichier. */
    const instance = String(updates.instanceName || activeTest.instanceName || '').trim();
    const archiveKey = ssnmrActiveKey;
    void (async () => {
      const pointer = await archiveSsnMRColumns({
        test: activeTest,
        instance,
        columns: updates.spectraColumns,
        wavelengthData: updates.wavelengthData,
        yUnit: updates.yUnit,
        brukerMeta: updates.brukerMeta,
        source: { file: filename || '', expno: parsed.expNum || '' }
      });
      placeRestorePointer({
        field: 'ssnmrDrive', pointer, key: archiveKey,
        activeKey: ssnmrActiveKeyRef.current, patch: patchActive
      });
    })();
  };

  // Folder Import logic
  const importFolder = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    
    setBrukerBusy(true);
    setBrukerMsg(`Scanning ${files.length} files...`);
    
    try {
      const oneRFiles = files.filter(f => f.name === '1r');
      if (!oneRFiles.length) throw new Error("No '1r' files found in the selected folder.");

      const results = [];
      for (let oneR of oneRFiles) {
        const pathParts = oneR.webkitRelativePath.split('/');
        const pdataIndex = pathParts.lastIndexOf('pdata');
        
        let acqusFile = null;
        let title = 'Bruker 1r';
        let expType = '';   // from the experiment dir "pulseprogram" file
        let fileTitle = ''; // from the "<dataset>/pdata/1/title" file
        let expDir = '';    // webkitRelativePath of the experiment folder (expno)
        let expNum = '';    // the Bruker experiment number (e.g. "1", "2", …)
        let datasetName = ''; // the dataset = the DIRECTORY that contains the expno dir
        
        if (pdataIndex > 0) {
          expDir = pathParts.slice(0, pdataIndex).join('/');
          const targetAcqusPath = expDir + '/acqus';
          acqusFile = files.find(f => f.webkitRelativePath === targetAcqusPath);
          
          // Experiment type = first (or second) line of the "pulseprogram" file,
          // reduced to the file name after the last slash (e.g. "zgesgp" instead
          // of # 1 "/opt/topspin3.6.2/exp/stan/nmr/lists/pp/zgesgp").
          const pulseFile = files.find(f => f.webkitRelativePath === expDir + '/pulseprogram');
          if (pulseFile) {
            try {
              const pt = await pulseFile.text();
              const lines = pt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
              const raw = lines[0] || lines[1] || '';
              expType = raw.split(/[/\\]/).pop().replace(/["'#;\s]+/g, '').trim();
            } catch { /* ignore unreadable pulseprogram */ }
          }
          // Title = content of "<dataset>/pdata/1/title"
          const titlePath = pathParts.slice(0, -1).join('/') + '/title';
          const titleFile = files.find(f => f.webkitRelativePath === titlePath);
          if (titleFile) {
            try { fileTitle = (await titleFile.text()).trim(); } catch { /* ignore */ }
          }
          
          expNum = pathParts[pdataIndex - 1];
          datasetName = pathParts[pdataIndex - 2];
          const procNum = pathParts[pdataIndex + 1];
          title = datasetName
            ? `${datasetName} (Exp ${expNum}${procNum && procNum !== '1' ? ` / Proc ${procNum}` : ''})`
            : `Exp ${expNum}${procNum && procNum !== '1' ? ` (Proc ${procNum})` : ''}`;
        }
        
        const dataBuffer = await oneR.arrayBuffer();
        const acqusText = acqusFile ? await acqusFile.text() : '';
        
        const parsed = importBruker1r({ 
          dataBuffer, 
          acqusText, 
          manualSWkHz: parseManual(brukerSw), 
          manualOffsetKHz: parseManual(brukerOffset) || 0, 
          title: fileTitle || title 
        });
        
        if (!parsed.error) {
          parsed.filename = title;
          parsed.datasetName = datasetName;
          parsed.acqusDate = extractAcqusDate(acqusText) || fileDate(acqusFile ? acqusFile.lastModified : 0) || fileDate(oneR.lastModified) || '';
          parsed.expType = expType;
          parsed.fileTitle = fileTitle;
          parsed.expDir = expDir;
          parsed.expNum = expNum;
          // All the files of the experiment directory (acqus, … and pdata/1/1r),
          // used later to archive the whole expno folder on Drive.
          parsed.expFiles = expDir
            ? files.filter((f) => f.webkitRelativePath === expDir || f.webkitRelativePath.startsWith(expDir + '/'))
            : [oneR];
          parsed.rawFile = oneR; // keep the raw 1r file for Drive archiving
          results.push(parsed);
        }
      }
      
      if (results.length === 0) throw new Error("Could not parse any valid 1r spectra.");

      // Show a selection dialog so the user can pick which experiments to import.
      const pending = results.map((parsed, i) => ({ id: 'p_' + Date.now() + '_' + i, parsed, filename: parsed.filename }));
      setPendingSpectra(pending);
      setSelectedSpectraIds(pending.map(p => p.id));
      setBrukerMsg(`Found ${results.length} 1D spectrum/spectra — select which experiments to import.`);
    } catch (err) {
      setBrukerMsg(`⚠️ ${err.message}`);
    }
    setBrukerBusy(false);
    if (brukerFileRef.current) brukerFileRef.current.value = '';
  };

  // Import only the experiments the user ticked in the selection dialog.
  const importSelectedSpectra = async () => {
    const selected = pendingSpectra.filter(p => selectedSpectraIds.includes(p.id));
    if (!selected.length) { setBrukerMsg('⚠️ Select at least one spectrum to import.'); return; }

    applyBruker(selected[0].parsed, selected[0].filename);

    /* Les conditions clonées sont construites ICI (hors de l'updater d'état) :
       la copie de RÉFÉRENCE de CHACUNE part sur le Drive juste après, donc les
       clones doivent déjà exister — React peut exécuter l'updater plus tard. */
    const clones = [];
    {
        for (let i = 1; i < selected.length; i++) {
                const parsed = selected[i].parsed;
                const newId = 't' + Date.now() + i + Math.random().toString(36).substring(2,5);
                const cloned = JSON.parse(JSON.stringify(activeTest));
                cloned.id = newId;
                cloned.instanceName = selected[i].filename;
                // "T" in Experimental Conditions ← TE from the acqus file (Kelvin).
                if (parsed.meta && parsed.meta.temperatureK > 0) {
                    cloned.temperature = String(parsed.meta.temperatureK);
                    cloned.temperatureUnit = 'K';
                }
                // Instrumental Setup "Datasets" row for the cloned condition.
                if (parsed.expNum) {
                    cloned.instrumentalDatasets = [{
                        id: makeId('instrumental_dataset'),
                        experimentNumber: String(parsed.expNum),
                        name: parsed.datasetName || selected[i].filename || `Dataset ${parsed.expNum}`,
                        date: parsed.acqusDate || parsed.date || new Date().toISOString().split('T')[0],
                        operator: activeTest.operator || '',
                        link: '',
                        comments: '',
                        acqus: parsed.acqusParams || {}
                    }];
                }
                
                let finalXs = parsed.xs; let finalYs = parsed.ys;
                const hasCustomRange = (brukerStartKHz !== '' && brukerEndKHz !== '') || (brukerNumPoints !== '' && Number(brukerNumPoints) > 0);
                if (hasCustomRange) {
                    const xMin = Math.min(...parsed.xs); const xMax = Math.max(...parsed.xs); const isDesc = parsed.xs[0] > parsed.xs[parsed.xs.length - 1];
                    const sK = brukerStartKHz !== '' ? Number(brukerStartKHz) : (isDesc ? xMax : xMin);
                    const eK = brukerEndKHz !== '' ? Number(brukerEndKHz) : (isDesc ? xMin : xMax);
                    const nPts = brukerNumPoints !== '' && Number(brukerNumPoints) > 1 ? Number(brukerNumPoints) : parsed.xs.length;
                    const newXs = []; const newYs = [];
                    for (let j = 0; j < nPts; j++) {
                        const x = sK + (eK - sK) * (j / (nPts - 1 || 1));
                        newXs.push(x);
                        const y = interpolateY(parsed.xs, parsed.ys, x);
                        newYs.push(y !== null && Number.isFinite(y) ? y : 0);
                    }
                    finalXs = newXs; finalYs = newYs;
                }

                cloned.wavelengthData = finalXs.map((x) => (+x.toFixed(4))).join('\n');
                cloned.spectraColumns = [{ id: makeId('spec'), title: parsed.meta.title || 'Bruker 1r spectrum', data: Array.from(finalYs).map(String).join('\n'), color: SPECTRA_PALETTE[i % SPECTRA_PALETTE.length], visible: true }];
                cloned.yUnit = 'raw';
                cloned.brukerMeta = parsed.meta;
                clones.push(cloned);
            }
    }
    if (clones.length && ctx.setTests) ctx.setTests(prevTests => [...prevTests, ...clones]);

    /* Copie de référence de CHAQUE condition clonée (best-effort, comme la
       première) : le pointeur est posé sur sa propre condition si c'est encore
       elle qui est affichée, sinon il attend son tour (ssnmrPendingRefs). */
    clones.forEach((cloned, idx) => {
        const parsed = selected[idx + 1].parsed;
        void (async () => {
            const pointer = await archiveSsnMRColumns({
                test: cloned,
                instance: String(cloned.instanceName || '').trim(),
                columns: cloned.spectraColumns,
                wavelengthData: cloned.wavelengthData,
                yUnit: cloned.yUnit,
                brukerMeta: cloned.brukerMeta,
                source: { file: cloned.instanceName || '', expno: parsed.expNum || '' }
            });
            placeRestorePointer({
                field: 'ssnmrDrive', pointer, key: cloned.id,
                activeKey: ssnmrActiveKeyRef.current, patch: patchActive
            });
        })();
    });
    setPendingSpectra([]);
    setSelectedSpectraIds([]);

    // Archive the RAW Bruker experiment folder(s) to Google Drive (best-effort).
    // For every experiment the WHOLE expno directory is saved, preserving its
    // structure: <…>/<instance>/Data/<expno>/acqus …, <expno>/pdata/1/1r.
    const driveConnected = getDriveToken();
    let driveSaved = 0;
    if (driveConnected) {
      const driveCtx = {
        project: (activeTest.projectNames || [])[0] || '',
        test: activeTest.name || '',
        scientist: activeTest.operator || '',
        section: 'Data',
        subsection: 'Bruker 1r'
      };
      for (let i = 0; i < selected.length; i++) {
        const p = selected[i].parsed;
        if (!p || !p.rawFile) continue;
        try {
          // The importer renames the instance to the file title (async state
          // update — activeTest.instanceName is still the old value here).
          const instanceForFile = String(selected[i].filename || '').trim() || activeTest.instanceName || '';
          const expNum = p.expNum || `exp${i + 1}`;
          const expFiles = (Array.isArray(p.expFiles) && p.expFiles.length > 0) ? p.expFiles : [p.rawFile];
          // Chemin CANONIQUE de l'expérience (projects/<projet>/<expérience>/…).
          // L'ancien driveFolderPath n'avait pas le conteneur « projects » : le
          // dossier de l'expérience était créé au niveau du dataset, à côté de
          // projects/, comme s'il n'appartenait à aucun projet.
          const basePath = canonicalExperimentPath({ ...driveCtx, instance: instanceForFile });
          for (const f of expFiles) {
            const rel = (p.expDir && String(f.webkitRelativePath || '').startsWith(p.expDir))
              ? String(f.webkitRelativePath).slice(p.expDir.length).replace(/^\/+/, '')
              : f.name;
            const relParts = rel.split('/').filter(Boolean);
            const fileName = relParts.pop() || f.name;
            const path = [...basePath, sanitizeSlug(expNum), ...relParts.map((s) => sanitizeSlug(s))];
            await uploadLocalFile({
              name: fileName,
              mimeType: f.type || 'application/octet-stream',
              file: f,
              ctx: { ...driveCtx, instance: instanceForFile, expno: expNum },
              path
            });
          }
          driveSaved++;
        } catch (err) { console.warn('Bruker Drive archive failed:', err && err.message); }
      }
    }
    setBrukerMsg(driveConnected
      ? (driveSaved === selected.length
          ? `✅ Successfully imported ${selected.length} spectrum/spectra — all raw 1r file(s) saved to Google Drive.`
          : `⚠️ Successfully imported ${selected.length} spectrum/spectra — ${driveSaved} raw 1r file(s) saved to Google Drive. Drive access expired or unavailable: reconnect Google Drive and re-import.`)
      : `⚠️ Successfully imported ${selected.length} spectrum/spectra — Google Drive was not connected at that moment (the access token may have expired), so the raw 1r file(s) were only kept in this browser's cache. Reconnect Google Drive from the sidebar, then use “Archive spectra to Drive” or re-import to save them on Drive too.`);
  };

  const importBrukerFromUrl = async () => {
    if (!brukerDataUrl.trim()) { setBrukerMsg('⚠️ Paste the Google Drive link to the 1r file.'); return; }
    setBrukerBusy(true);
    try {
      const res = await fetch(resolveDriveUrl(brukerDataUrl));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dataBuffer = await res.arrayBuffer();
      let acqusText = '';
      if (brukerAcqusUrl.trim()) {
        try { acqusText = await (await fetch(resolveDriveUrl(brukerAcqusUrl))).text(); } catch { acqusText = ''; }
      }
      applyBruker(importBruker1r({
        dataBuffer, acqusText,
        manualSWkHz: parseManual(brukerSw),
        manualOffsetKHz: parseManual(brukerOffset) || 0
      }), null);
    } catch (e) {
      setBrukerMsg(`⚠️ Fetch failed: ${e.message} — the file must be shared as "Anyone with the link".`);
    }
    setBrukerBusy(false);
  };

  const normalizeActiveSpectrum = () => {
    // Normalising an already normalised spectrum compounded the scaling and
    // overwrote the raw-intensity backup (so "Revert to raw intensity" restored
    // normalised numbers): always rescale the raw columns.
    const normalizeFrom = instTest.yUnit === 'norm' && Array.isArray(instTest.rawSpectraColumns)
      ? { ...instTest, spectraColumns: instTest.rawSpectraColumns }
      : instTest;
    const parsed = computeParsed(normalizeFrom);
    if (!parsed.parsedSpectra.length) { alert('No spectrum to normalize.'); return; }
    const maxAbs = Math.max(1e-9, ...parsed.parsedSpectra.flatMap((s) => s.values.map((v) => Math.abs(v))));
    const cols = (normalizeFrom.spectraColumns || []).map((c) => ({
      ...c,
      data: String(c.data || '').split(/[\n,]+/).map((s) => {
        const n = parseFloat(String(s).trim());
        return Number.isFinite(n) ? String(n / maxAbs) : s;
      }).join('\n')
    }));
    patchActive({ spectraColumns: cols, rawSpectraColumns: normalizeFrom.spectraColumns, yUnit: 'norm' });
  };
  const revertNormalization = () => {
    if (!Array.isArray(instTest.rawSpectraColumns)) return;
    patchActive({ spectraColumns: instTest.rawSpectraColumns, rawSpectraColumns: undefined, yUnit: 'raw' });
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
    const header = ['Frequency (kHz)', ...seriesDefs.map(({ inst, spec }) => `${inst.name} — ${spec.title}`)];
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
    a.download = `ssNMR_${(activeTest.name || 'data').replace(/[^a-z0-9]+/gi, '_')}.csv`;
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
{['lipid', 'deuteration', 'temperature', 'hydration', 'cholesterolRatio', 'ratio', 'bufferName'].map((k) => {
            const v = getExpValue(activeInstance, k);
            if (v === '') return null;
            const f = SSNMR_EXPERIMENTAL_FIELDS.find((x) => x.key === k);
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
            <label className={LABEL_CLS}>
              Frequencies (kHz) — comma, space or newline separated
            </label>
            <textarea
              value={instTest.wavelengthData || ''}
              onChange={(e) => updateWavelengthData(e.target.value)}
              placeholder={'-100, -99.5, -99, ...'}
              className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-blue-500 h-20 custom-scrollbar"
            />
            <span className="text-[10px] text-slate-400">
              {activeParsed.parsedWavelengths.length} valid frequency points parsed.
            </span>
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
                value={col.data || ''} onChange={(e) => patchColumn(col.id, { data: e.target.value })} placeholder="ssNMR values (comma or newline separated), same order as wavelengths"
                className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-blue-500 h-16 custom-scrollbar bg-white"
              />
            </div>
          ))}
          {spectraColumns.length === 0 && <div className="text-xs text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center">No spectra yet. Add a spectrum manually or import a Bruker 1r folder below.</div>}
        </div>

        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-sky-900">📥 Bruker Import — 1r processed spectrum</h4>
            <span className="text-[9px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded font-bold">imports into the ACTIVE condition</span>
          </div>

          {/* Restauration automatique des colonnes depuis le Drive (voir
              SSNMR_RESTORE_KIND en tête de ce fichier) : l'archive est déposée
              TOUTE SEULE à l'import, donc ce bouton n'est qu'un secours manuel —
              la restauration part d'elle-même à l'ouverture de la page. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => ssnmrRestore.attempt('manual')}
              disabled={ssnmrRestore.status === 'restoring'}
              title="Download the archived copy of these spectra from Google Drive (it is saved automatically at import) — it also happens by itself when the page opens"
              className="text-[10px] font-bold bg-white border border-sky-300 text-sky-700 hover:bg-sky-100 px-2 py-1 rounded-md shadow-sm disabled:opacity-50"
            >
              {ssnmrRestore.status === 'restoring' ? '⬇️ Downloading…' : '⬇️ Restore from Drive'}
            </button>
            {instTest.ssnmrDrive && !ssnmrRestore.message && (
              <span className="text-[9px] font-bold text-emerald-700">☁ Archived copy of these spectra is on Google Drive</span>
            )}
            {(ssnmrRestore.status === 'restoring' || ssnmrRestore.message) && (
              <span className={`text-[11px] font-semibold rounded-lg px-3 py-1.5 border ${ssnmrRestore.status === 'restored'
                ? 'bg-green-50 border-green-200 text-green-800'
                : ssnmrRestore.status === 'failed'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-sky-50 border-sky-200 text-sky-800'}`}>
                {ssnmrRestore.status === 'restoring'
                  ? '⬇️ These spectra are not in this browser — restoring the archived copy from Google Drive…'
                  : ssnmrRestore.message}
                {ssnmrRestore.status === 'failed' && (
                  <button type="button" onClick={() => ssnmrRestore.attempt('manual')}
                    className="ml-2 underline font-bold">Try again</button>
                )}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white border border-sky-200 rounded-lg p-3 flex flex-col gap-2">
              <span className="text-xs font-bold text-sky-800">💻 From this PC</span>

              <label className="bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors text-left flex items-center gap-2">
                <span className="text-xl">📁</span>
                <div>
                  <div>Choose Bruker Folder...</div>
                  <div className="text-[9px] font-normal opacity-70">Select the experiment folder (or a parent folder)</div>
                </div>
                <input 
                  ref={brukerFileRef} 
                  type="file" 
                  webkitdirectory="true" 
                  directory="true" 
                  multiple 
                  onChange={importFolder} 
                  className="hidden" 
                />
              </label>
              <div className="mt-1">
                <DriveUploadButton
                  suggestedName={suggestDriveFileName({
                    project: (activeTest.projectNames || [])[0] || '',
                    test: activeTest.name || '',
                    instance: activeTest.instanceName || '',
                    section: 'Data',
                    subsection: 'Bruker 1r',
                    suffix: 'bruker1r'
                  })}
                  naming={{
                    project: (activeTest.projectNames || [])[0] || '',
                    test: activeTest.name || '',
                    instance: activeTest.instanceName || '',
                    scientist: activeTest.operator || '',
                    section: 'Data',
                    subsection: 'Bruker 1r',
                    suffix: 'bruker1r'
                  }}
                  accept=".1r,.fid,.ser,.acqus"
                  label="⬆ Archive spectra to Drive"
                  className="bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100"
                />
              </div>
              <span className="text-[9px] text-sky-700 mt-1 max-w-sm">
                This will automatically locate the 1r file(s) and their corresponding acqus parameter files, instantly importing the correct ppm axis. After scanning you can choose exactly which experiments to load — they will be imported into separate condition tabs.
              </span>
            </div>

            <div className="bg-white border border-sky-200 rounded-lg p-3 flex flex-col gap-2">
              <span className="text-xs font-bold text-sky-800">🔗 From Google Drive link</span>
              <input type="text" value={brukerDataUrl} onChange={(e) => setBrukerDataUrl(e.target.value)} placeholder="Link to 1r (…/file/d/…/view)" className="border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 bg-white" />
              <input type="text" value={brukerAcqusUrl} onChange={(e) => setBrukerAcqusUrl(e.target.value)} placeholder="Link to acqus (optional)" className="border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 bg-white" />
              <button type="button" onClick={importBrukerFromUrl} disabled={brukerBusy} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">
                {brukerBusy ? 'Importing…' : 'Import from links'}
              </button>
              <span className="text-[9px] text-sky-600">Both files must be shared as "Anyone with the link". Paste plain share links — they are converted automatically.</span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 bg-white border border-sky-200 rounded-lg p-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-sky-800">Manual SW (kHz) — only if no acqus</label>
              <input type="number" step="0.1" value={brukerSw} onChange={(e) => setBrukerSw(e.target.value)} onWheel={(e) => e.target.blur()} className="border border-sky-300 rounded-lg p-1.5 text-xs outline-none focus:border-sky-500 w-32" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-sky-800">Carrier offset (kHz)</label>
              <input type="number" step="0.1" value={brukerOffset} onChange={(e) => setBrukerOffset(e.target.value)} onWheel={(e) => e.target.blur()} className="border border-sky-300 rounded-lg p-1.5 text-xs outline-none focus:border-sky-500 w-32" />
            </div>
            <span className="text-[9px] text-sky-600 max-w-md">If an acqus file is provided, SW_h / O1 / TE are read from it automatically and the manual fields are ignored.</span>
          </div>
          
          <div className="flex flex-wrap items-end gap-3 bg-violet-50 border border-violet-200 rounded-lg p-3">
            <span className="text-[10px] font-bold text-violet-800 w-full">✂️ Crop & Resample upon import (optional)</span>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-violet-800">From (kHz)</label>
              <input type="number" step="0.1" value={brukerStartKHz} onChange={(e) => setBrukerStartKHz(e.target.value)} onWheel={(e) => e.target.blur()} placeholder="auto" className="border border-violet-300 rounded-lg p-1.5 text-xs outline-none focus:border-violet-500 w-24 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-violet-800">To (kHz)</label>
              <input type="number" step="0.1" value={brukerEndKHz} onChange={(e) => setBrukerEndKHz(e.target.value)} onWheel={(e) => e.target.blur()} placeholder="auto" className="border border-violet-300 rounded-lg p-1.5 text-xs outline-none focus:border-violet-500 w-24 bg-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-violet-800">Number of points</label>
              <input type="number" step="1" value={brukerNumPoints} onChange={(e) => setBrukerNumPoints(e.target.value)} onWheel={(e) => e.target.blur()} placeholder="all" className="border border-violet-300 rounded-lg p-1.5 text-xs outline-none focus:border-violet-500 w-24 bg-white" />
            </div>
            <span className="text-[9px] text-violet-600 max-w-xs">Leave blank to import the full spectrum exactly as acquired. Interpolates to the specified grid.</span>
          </div>
          {brukerMsg && <span className="text-xs font-bold text-sky-900">{brukerMsg}</span>}
        </div>

        {/* Experiment selection dialog for folder import */}
        {pendingSpectra.length > 0 && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
              <div className="bg-gradient-to-r from-sky-600 to-blue-700 px-5 py-4 text-white rounded-t-2xl shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-black text-lg">Select experiments to import</h3>
                    <p className="text-sky-100 text-xs mt-0.5">{pendingSpectra.length} 1D spectrum/spectra found in the selected dataset folder</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPendingSpectra([]); setSelectedSpectraIds([]); setBrukerMsg('Import cancelled.'); }}
                    className="text-white/70 hover:text-white text-2xl leading-none font-bold shrink-0"
                    title="Cancel import"
                  >
                    &times;
                  </button>
                </div>
              </div>

              <div className="p-4 flex flex-col gap-2 overflow-y-auto custom-scrollbar flex-1">
                <div className="flex gap-2 items-center justify-between px-1 mb-1 shrink-0">
                  <span className="text-xs font-bold text-slate-500 uppercase">Tick the experiments to load</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setSelectedSpectraIds(pendingSpectra.map(p => p.id))} className="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-1 rounded hover:bg-sky-100">Select all</button>
                    <button type="button" onClick={() => setSelectedSpectraIds([])} className="text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded hover:bg-slate-100">Select none</button>
                  </div>
                </div>
                {pendingSpectra.map(p => {
                  const checked = selectedSpectraIds.includes(p.id);
                  return (
                    <label key={p.id} className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const id = p.id;
                          setSelectedSpectraIds(prev => (e.target.checked ? [...prev, id] : prev.filter(x => x !== id)));
                        }}
                        className="w-4 h-4 accent-sky-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800 truncate">{p.filename}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {(p.parsed.nPoints != null ? `${p.parsed.nPoints} pts` : `${p.parsed.xs ? p.parsed.xs.length : 0} pts`)}
                          {p.parsed.expType ? ` · ${p.parsed.expType}` : ''}
                          {p.parsed.fileTitle ? ` · ${p.parsed.fileTitle}` : ''}
                          {p.parsed.meta?.nucleus ? ` · ${p.parsed.meta.nucleus}` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="px-4 py-3 border-t border-slate-200 flex justify-between items-center gap-3 bg-slate-50 rounded-b-2xl shrink-0">
                <span className="text-[11px] text-slate-500">{selectedSpectraIds.length} of {pendingSpectra.length} selected</span>
                <button type="button" onClick={importSelectedSpectra} disabled={!selectedSpectraIds.length} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm shadow-sm">
                  📥 Import selected ({selectedSpectraIds.length})
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
          <h4 className="text-sm font-bold text-slate-700">📐 Scaling & Acquisition Metadata</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            {['swKHz', 'o1KHz', 'sfo1', 'temperatureK'].map((k) => {
              const labels = { swKHz: 'Spectral Width (kHz)', o1KHz: 'Carrier O1 (kHz)', sfo1: 'Observe Freq. (MHz)', temperatureK: 'Acq. Temperature (K)' };
              const v = activeTest.brukerMeta ? activeTest.brukerMeta[k] : null;
              return (
                <div key={k} className="flex flex-col gap-1">
                  <label className={LABEL_CLS}>{labels[k]}</label>
                  <div className="border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
                    {v !== null && v !== undefined && v !== '' ? v : '— (import a 1r with acqus)'}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-bold px-2 py-1 rounded ${yUnit === 'norm' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'}`}>
              Current Y unit: {yUnit === 'norm' ? 'Normalized intensity' : 'Intensity (a.u.)'}
            </span>
            <button type="button" onClick={normalizeActiveSpectrum} className="bg-violet-600 hover:bg-violet-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm">Normalize to max (ACTIVE)</button>
            {yUnit === 'norm' && Array.isArray(instTest.rawSpectraColumns) && (
              <button type="button" onClick={revertNormalization} className="text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg shadow-sm">↩️ Revert to raw intensity</button>
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
// ssNMRSections.jsx - REPLACE SpectraVisualization COMPONENT
// =========================================================================
export const SpectraVisualization = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useSSNMRDerived(activeTest, ctx);
  const { instances } = d;

  const cfg = { ...DEFAULT_CHART_STYLE, ...(activeTest.vizCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ vizCfg: { ...cfg, ...patch } });

  const [showCfg, setShowCfg] = useState(false);
  const [fs, setFs] = useState(false);
  const [fsSmall, setFsSmall] = useState(null);
  // Single click zooms a small spectrum, double click edits it (see deferredClick).
  const smallClickTimer = useRef(null);
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
          data: parsed.parsedWavelengths
            .map((w, i) => ({ x: w, y: Number.isFinite(s.values[i]) ? s.values[i] : null }))
            .filter((p) => p.y !== null)
        });
      });
    });
    return out;
  }, [instances, activeTest.id, localColors]);

  const visible = seriesList.filter((s) => !hiddenSeries[s.key]);
  const allXs = visible.flatMap((s) => s.data.map((p) => p.x));
  const padX = allXs.length ? ((Math.max(...allXs) - Math.min(...allXs)) * 0.03 || 1) : 1;
  const dataDomain = allXs.length ? [Math.min(...allXs) - padX, Math.max(...allXs) + padX] : [-100, 100];

  // Default Y domain (no manual yMin/yMax): make the y-axis TWICE as tall as the
  // data range so the spectra occupy about half the plot height — a common NMR /
  // ssNMR presentation that leaves headroom above the peaks.
  const allYs = visible.flatMap((s) => s.data.map((p) => p.y));
  const yDataMin = allYs.length ? Math.min(...allYs) : 0;
  const yDataMax = allYs.length ? Math.max(...allYs) : 1;
  const yDataRange = (yDataMax - yDataMin) || 1;
  const yAutoMin = yDataMin - yDataRange / 2;
  const yAutoMax = yDataMax + yDataRange / 2;

  const chartRef = useRef(null);
  // Combined X + Y mouse zoom: drag horizontally to zoom the frequency axis,
  // vertically to zoom the intensity axis (same as the NMR 1D spectrum).
  const zoom = useXYZoom(chartRef, dataDomain, [yAutoMin, yAutoMax], cfgChartMargin(cfg, CHART_MARGIN));
  const yLabel = activeTest.yUnit === 'norm' ? 'Normalized intensity (a.u.)' : 'Intensity (a.u.)';
  const xLabel = cfg.xAxisLabel || 'Frequency (kHz)';
  const yLab = cfg.yAxisLabel || yLabel;

  const xScale = cfgLogScale(cfg, 'x');
  const yScale = cfgLogScale(cfg, 'y');
  const xDomain = cfgAxisDomain(cfg, 'x', zoom.xDomain);
  const yMinV = dom(cfg.yMin), yMaxV = dom(cfg.yMax);
  const hasManualY = yMinV != null || yMaxV != null;
  const yDomain = yScale === 'log'
    ? [(yMinV != null && yMinV > 0 ? yMinV : 1e-3), (yMaxV != null ? yMaxV : 'auto')]
    : hasManualY ? [yMinV ?? yAutoMin, yMaxV ?? yAutoMax] : zoom.yDomain;

  const chartBody = (
    <ChartInspector
      containerRef={chartRef}
      containerProps={{ onMouseDown: zoom.onMouseDown }}
      style={fs ? { flex: 1, minHeight: 0 } : chartBoxStyle(cfg, { yTitle: yLab })}
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
      {fs && <div className={OVERLAY_CLASSES} onClick={() => setFs(false)} />}
      <div className={`${fs ? FS_CLASSES + ' p-6 flex' : 'flex'} flex-col${splitStack ? ' lg:flex-row gap-3' : ''}`}>
        <div className={`flex flex-col${splitStack && !fs ? ' lg:w-[54%] min-w-0' : ''}${fs ? ' flex-1 min-h-0' : ''}`}>
          {fs && (
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h3 className="font-bold text-slate-700">ssNMR Spectra — all conditions</h3>
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
            id="ssnmr-split"
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
                    <YAxis {...splitYAxisProps(splitLayout, 44)} domain={splitSharedY ? [yAutoMin, yAutoMax] : ['dataMin', 'dataMax']} tick={{ fontSize: splitFontSize, fill: tickColorOf(cfg) }} />
                    <Line type="monotone" dataKey="y" stroke={s.color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          />
        )}
      </div>
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={seriesList.map((s) => ({ key: s.key, label: s.label, color: s.color }))} unit="ppm" />}
      
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
                    unit="ppm" className="flex-1 relative min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.data} margin={fsSmall === s.key ? cfgChartMargin(cfg, CHART_MARGIN) : { top: 5, right: 8, bottom: 18, left: 2 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" dataKey="x" tick={tickTextProps(cfg, { fontSize: fsSmall === s.key ? tickSize(cfg) : 9, fill: '#64748b' })} domain={['dataMin', 'dataMax']} label={fsSmall === s.key ? cfgAxisLabel(cfg, 'x', xLabel) : undefined} />
                        <YAxis domain={[yAutoMin, yAutoMax]} tick={tickTextProps(cfg, { fontSize: fsSmall === s.key ? tickSize(cfg) : 9, fill: '#64748b' })} width={fsSmall === s.key ? 60 : 38} label={fsSmall === s.key ? cfgAxisLabel(cfg, 'y', yLab) : undefined} />
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

/* Order profile of a saved quadrupolar fit. The parent (QuadrupolarFitting)
   renders <SharedChartStylePanel cfg={cfg} />, so the chart margin and the
   `S_CD` axis title follow the panel's margin/font/gap controls. */
const OrderProfileChart = ({ res, cfg = {} }) => {
  const data = (res.activeBases || []).map((k) => ({
    name: SSNMR_FIT_COMPONENTS[k]?.label || k,
    S: res.fractions ? res.fractions[k] : 0,
    dNu: res.splittings ? res.splittings[k] : 0,
    color: SSNMR_FIT_COMPONENTS[k]?.color || '#94a3b8'
  }));
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={cfgChartMargin(cfg, { top: 10, right: 10, bottom: 20, left: 0 })}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: tickColorOf(cfg) }} />
          <YAxis domain={[0, (dataMax) => Math.max(0.3, Math.ceil((dataMax * 1.2) * 10) / 10)]} tick={{ fontSize: 11, fill: tickColorOf(cfg) }} label={cfgAxisLabel(cfg, 'y', 'S_CD', 0)} />
          <Tooltip formatter={(v, name, item) => [`S = ${v}  (Δν = ${item.payload.dNu} kHz)`, 'Order parameter']} />
          <ReferenceLine y={0} stroke="#94a3b8" />
          <Bar dataKey="S" isAnimationActive={false}>
            {data.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const QuadrupolarFitting = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useSSNMRDerived(activeTest, ctx);
  const { instances } = d;
  const [fitInstId, setFitInstId] = useState(activeTest.id);
  const [fitSpecIdx, setFitSpecIdx] = useState(0);
  // Same as the CD fitter: the condition tabs at the top of the page drive this
  // panel, so switching instance must retarget the "Target Condition" dropdown
  // to that instance instead of leaving the previous one selected.
  useEffect(() => {
    setFitInstId((prev) => (prev === activeTest.id ? prev : activeTest.id));
    setFitSpecIdx(0);
  }, [activeTest.id]);
  const [msg, setMsg] = useState('');
  const [fsFit, setFsFit] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [nDoublets, setNDoublets] = useState(5);
  const [chiKHz, setChiKHz] = useState(167);
  const [initSplit, setInitSplit] = useState('');

  const cfg = { ...DEFAULT_CHART_STYLE, ...(activeTest.vizCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ vizCfg: { ...cfg, ...patch } });

  const fitInst = instances.find((i) => i.id === fitInstId) || instances[0];
  const fitParsed = useMemo(() => computeParsed(fitInst ? fitInst.test : null), [fitInst]);
  const spec = fitParsed.parsedSpectra[fitSpecIdx] || fitParsed.parsedSpectra[0] || null;
  const savedFit = useMemo(() => {
    if (!fitInst || !spec) return null;
    return (fitInst.test.ssFits || {})[spec.id] || null;
  }, [fitInst, spec]);

  const runFit = () => {
    if (!fitInst || !spec) { setMsg('Select a condition and a spectrum.'); return; }
    const res = fitQuadrupolarSpectrum(fitParsed.parsedWavelengths, spec.values, nDoublets, chiKHz, {
      dNuMax0: parseManual(initSplit) ?? undefined
    });
    if (res.error) { setMsg(`⚠️ ${res.error}`); return; }
    const stored = { ...res, savedAt: new Date().toLocaleString() };
    delete stored.fitCurve;
    const ssFits = { ...(fitInst.test.ssFits || {}), [spec.id]: stored };
    const structureComposition = {};
    res.activeBases.forEach((k) => { structureComposition[`${k} S_CD`] = res.fractions[k]; });
    patchInstance(ctx, activeTest, fitInst.id, { ssFits, structureComposition });
    setMsg(`✅ Fit stored — R² = ${res.r2.toFixed(4)} (${res.nPoints} pts, χ = ${chiKHz} kHz, ${res.fitMin.toFixed(1)}–${res.fitMax.toFixed(1)} kHz).`);
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
    if (!savedFit || !spec) return [];
    return buildSimulatedCurve(savedFit, fitParsed.parsedWavelengths);
  }, [savedFit, fitParsed, spec]);

  const overlayRef = useRef(null);
  const allXs = [...expData.map((p) => p.x), ...simData.map((p) => p.x)];
  const padX = allXs.length ? ((Math.max(...allXs) - Math.min(...allXs)) * 0.03 || 1) : 1;
  const resolvedXDomain = [
    dom(cfg.xMin) !== undefined ? dom(cfg.xMin) : (allXs.length ? Math.min(...allXs) - padX : -80),
    dom(cfg.xMax) !== undefined ? dom(cfg.xMax) : (allXs.length ? Math.max(...allXs) + padX : 80)
  ];
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
        <h4 className="text-sm font-bold text-slate-700">🧲 Fitting — Deuterium Quadrupolar Doublets</h4>
        <div className="flex gap-2 items-center">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} className="flex gap-2" />
          <span className="text-[9px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold">&#916;&#957;_q = (3/2)&#xB7;&#967;&#xB7;S_CD</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">1. Deuterated carbons (doublets)</label>
            <input type="number" min="1" max="15" value={nDoublets} onWheel={(e) => e.target.blur()} onChange={(e) => setNDoublets(parseInt(e.target.value, 10) || 1)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-24 outline-none focus:border-blue-500 font-semibold" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">χ Quadrupolar Constant (kHz)</label>
            <input type="number" step="0.5" value={chiKHz} onWheel={(e) => e.target.blur()} onChange={(e) => setChiKHz(parseFloat(e.target.value) || 167)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-28 outline-none focus:border-blue-500 font-semibold" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Initial max splitting (kHz, opt.)</label>
            <input type="number" step="1" value={initSplit} placeholder="auto" onWheel={(e) => e.target.blur()} onChange={(e) => setInitSplit(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-32 outline-none focus:border-blue-500" />
          </div>
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
        <p className="text-[10px] text-slate-400">The spectrum is decomposed into {nDoublets} Pake doublets (two Gaussian horns at ±Δν/2). Splittings are sorted descending and assigned to C2… in order; S_CD = Δν_q / (1.5·χ).</p>
      </div>

      {savedFit && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {(savedFit.activeBases || []).map((k) => (
                <div key={k} className="bg-white border border-slate-200 rounded-lg p-3 text-center shadow-sm">
                  <div className="text-[10px] font-bold uppercase truncate" style={{ color: SSNMR_FIT_COMPONENTS[k]?.color || '#64748b' }}>{SSNMR_FIT_COMPONENTS[k]?.label || k}</div>
                  <div className="text-xl font-black text-slate-800">{savedFit.fractions[k]}</div>
                  <div className="text-[9px] text-slate-400">Δν = {savedFit.splittings[k]} kHz</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Fit quality: <b>R² = {Number(savedFit.r2 || 0).toFixed(4)}</b> · {savedFit.nPoints} points · χ = {savedFit.chiKHz} kHz · σ = {Number(savedFit.sigmaFit || 0).toFixed(2)} kHz · saved {savedFit.savedAt}
            </p>
            <OrderProfileChart res={savedFit} cfg={cfg} />
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
                    <XAxis type="number" dataKey="x" domain={cfgAxisDomain(cfg, 'x', zoomFit.domain)} allowDataOverflow scale={cfgLogScale(cfg, 'x')} ticks={cfgAxisTicks(cfg, 'x', cfgAxisDomain(cfg, 'x', zoomFit.domain))} tick={<AngledTick angle={cfg.tickAngle} fontSize={tickSize(cfg)} fontFamily={fontFamilyOf(cfg)} color={tickColorOf(cfg)} formatter={cfgTickFormatter(cfg, 'x') || undefined} />} tickMargin={10} label={cfgAxisLabel(cfg, 'x', cfg.xAxisLabel || 'Frequency offset (kHz)')} />
                    <YAxis type="number" domain={cfgLogScale(cfg, 'y') === 'log'
                        ? [((dom(cfg.yMin) != null && dom(cfg.yMin) > 0) ? dom(cfg.yMin) : 1e-3), (dom(cfg.yMax) != null ? dom(cfg.yMax) : 'auto')]
                        : [dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']}
                      allowDataOverflow scale={cfgLogScale(cfg, 'y')} ticks={dom(cfg.yMin) != null && dom(cfg.yMax) != null ? cfgAxisTicks(cfg, 'y', [dom(cfg.yMin), dom(cfg.yMax)]) : undefined} tickFormatter={cfgTickFormatter(cfg, 'y') || undefined} tick={tickTextProps(cfg, { fill: '#64748b' })} label={cfgAxisLabel(cfg, 'y', cfg.yAxisLabel || 'Intensity (a.u.)')} />
                    {cfgSeriesEl(cfg, { key: 'exp', data: expData, dataKey: 'y', name: 'Experimental', stroke: cfg.colors?.exp || '#3b82f6' })}
                    {cfgSeriesEl(cfg, { key: 'sim', data: simData, dataKey: 'y', name: 'Simulated (fit)', stroke: cfg.colors?.sim || '#ef4444' })}
                    <Tooltip />
                    {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg, { fontSize: cfg.fontSize || 11 })} />}
                    {zoomFit.refLo !== null && zoomFit.refHi !== null && <ReferenceArea x1={zoomFit.refLo} x2={zoomFit.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">💡 Blue = experimental · Red dashed = reconstructed doublet sum. Drag to zoom.</p>
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
                <th className="px-3 py-2">Quadrupolar fit (Δν kHz → S_CD)</th>
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
                  <td className="px-3 py-1.5 text-[11px] leading-tight">
                    {(row.res.activeBases || []).map((k) => {
                      const dNu = row.res.splittings ? row.res.splittings[k] : 0;
                      if (!dNu) return null;
                      return <span key={k} style={{ color: SSNMR_FIT_COMPONENTS[k]?.color, marginRight: '8px', whiteSpace: 'nowrap' }}>{SSNMR_FIT_COMPONENTS[k]?.label}: <b>{dNu} → {row.res.fractions[k]}</b></span>;
                    })}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">{Number(row.res.r2 || 0).toFixed(4)}</td>
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
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[{ key: 'exp', label: 'Experimental', color: '#3b82f6' }, { key: 'sim', label: 'Simulated (fit)', color: '#ef4444' }]} unit="ppm" />}
    </div>
  );
};

/* ========================================================================
CONDITION PLOTS (Dynamic Component Graphing)
======================================================================== */
const defaultssNMRConditionPlot = (n) => ({
  id: makeId('ssNMRplot'),
  title: `Condition Plot ${n}`,
  yMode: 'ss',
  specIdx: 0,
  lambda: '0',
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
  const validKey = (k) => SSNMR_EXPERIMENTAL_FIELDS.some((f) => f.key === k);
  const rawXFields = Array.isArray(plot.xFields) && plot.xFields.length
    ? plot.xFields
    : (plot.xField ? [plot.xField] : []);
  const effXFields = (rawXFields.filter(validKey).slice(0, 2).length
    ? rawXFields.filter(validKey).slice(0, 2)
    : [SSNMR_EXPERIMENTAL_FIELDS[0].key]);
  const effXField = effXFields[0];
  const is3D = effXFields.length === 2;
  const xFieldDef = SSNMR_EXPERIMENTAL_FIELDS.find((f) => f.key === effXField);
  const xFieldLabel = xFieldDef ? xFieldDef.label : effXField;
  const xField2Def = is3D ? SSNMR_EXPERIMENTAL_FIELDS.find((f) => f.key === effXFields[1]) : null;
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
          label: `${SSNMR_FIT_COMPONENTS[comp]?.label || comp} — ${specTitleOf(d.activeInstance || d.instances[0])}`,
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
      ? (SSNMR_FIT_COMPONENTS[s.key.replace('ss_', '')]?.color || seriesColor(cfg, s.key, idx, total))
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
      const f = SSNMR_EXPERIMENTAL_FIELDS.find((x) => x.key === fk);
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
    const others = SSNMR_EXPERIMENTAL_FIELDS.filter((f) => !effXFields.includes(f.key));
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

  // Auto-Y that also covers the error bars (Recharts ignores the ErrorBar
  // dataKeys when it computes the "auto" domain → see `errorBarRange`).
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

  const yLab = cfg.yAxisLabel || (plot.yMode === 'ss' ? 'Order parameter S_CD' : '²H intensity (a.u.)');
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
              <option value="ss">Order parameter S_CD (from fits)</option>
              <option value="intensity">Intensity at frequency</option>
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
              <label className="text-[10px] font-bold text-slate-500 uppercase">ν (kHz)</label>
              <input type="number" value={plot.lambda} onChange={(e) => set({ lambda: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-24 outline-none focus:border-blue-500" />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Variable 1 (X)</label>
            <select value={effXField} onChange={(e) => setXFields(is3D ? [e.target.value, effXFields[1]] : [e.target.value])} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {SSNMR_EXPERIMENTAL_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
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
              {SSNMR_EXPERIMENTAL_FIELDS.filter((f) => f.key !== effXField).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
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
            unit={xFieldDef && xFieldDef.unitKey && d.activeInstance ? (getExpUnit(d.activeInstance, xFieldDef) || 'ppm') : 'ppm'}
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
  const d = useSSNMRDerived(activeTest, ctx);
  const plots = Array.isArray(activeTest.conditionPlots) && activeTest.conditionPlots.length
    ? activeTest.conditionPlots
    : [defaultssNMRConditionPlot(1)];
  const updatePlot = (id, patch) => updateActiveTest({ conditionPlots: plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlot = () => updateActiveTest({ conditionPlots: [...plots, defaultssNMRConditionPlot(plots.length + 1)] });
  const removePlot = (id) => {
    if (plots.length <= 1) { alert('At least one condition plot is required.'); return; }
    updateActiveTest({ conditionPlots: plots.filter((p) => p.id !== id) });
  };
  const duplicatePlot = (p) => updateActiveTest({ conditionPlots: [...plots, { ...JSON.parse(JSON.stringify(p)), id: makeId('ssNMRplot'), title: `${p.title} (copy)` }] });
  return (
    <div className="flex flex-col gap-4 border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-700">📊 Fitting — Condition Plots</h4>
          <span className="text-xs font-bold text-slate-500 uppercase">X = any Experimental-Conditions parameter · Y = S_CD or intensity at ν (kHz)</span>
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
      <QuadrupolarFitting ctx={ctx} />
      <ConditionFittingSection ctx={ctx} />
    </div>
  </CollapsibleSection>
);

/* ========================================================================
   SIMULATIONS — DEUTERIUM SPECTRUM SIMULATOR
   ======================================================================== */
const DEFAULT_SC_PROFILE = {
  C2: 20, C3: 20, C4: 20, C5: 20, C6: 20, C7: 19, C8: 18, C9: 16,
  C10: 13, C11: 10, C12: 7, C13: 5, C14: 3, C15: 2, C16: 6
};

const DeuteriumMixer = ({ isExpanded, onToggleExpand }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height } = useElementSize(wrapRef);
  const [scProfile, setScProfile] = useState({ ...DEFAULT_SC_PROFILE }); // S_CD ×100
  const [chi, setChi] = useState(167);
  const [sigma, setSigma] = useState(2);

  const updateSc = (key, val) => setScProfile((p) => ({ ...p, [key]: Math.max(0, Math.min(100, val)) }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 80 || height < 80) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx2 = canvas.getContext('2d');
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = width, H = height;

    const xMin = -90, xMax = 90;
    const xs = [], values = [];
    for (let x = xMin; x <= xMax; x += 0.25) {
      xs.push(x);
      let v = 0;
      Object.entries(scProfile).forEach(([, scPct]) => {
        const dNu = 1.5 * chi * (scPct / 100);
        if (dNu > 0.01) v += doubletAt(x, dNu, 1, sigma);
      });
      values.push(v);
    }
    const yMax = Math.max(...values, 1e-6) * 1.15;
    const yMin = -yMax * 0.08;

    const pad = { top: 20, right: 20, bottom: 40, left: 50 };
    const plotW = W - pad.left - pad.right, plotH = H - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) return;
    const sx = (x) => pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
    const sy = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = '#f8fafc'; ctx2.fillRect(0, 0, W, H);
    ctx2.strokeStyle = '#e2e8f0'; ctx2.lineWidth = 0.5;
    for (let x = Math.ceil(xMin / 20) * 20; x <= xMax; x += 20) {
      ctx2.beginPath(); ctx2.moveTo(sx(x), pad.top); ctx2.lineTo(sx(x), pad.top + plotH); ctx2.stroke();
    }
    const zeroY = sy(0);
    ctx2.strokeStyle = '#94a3b8'; ctx2.lineWidth = 1; ctx2.setLineDash([4, 4]);
    ctx2.beginPath(); ctx2.moveTo(pad.left, zeroY); ctx2.lineTo(pad.left + plotW, zeroY); ctx2.stroke();
    ctx2.setLineDash([]);

    ctx2.strokeStyle = '#7c3aed'; ctx2.lineWidth = 2; ctx2.beginPath();
    xs.forEach((x, i) => { if (i === 0) ctx2.moveTo(sx(x), sy(values[i])); else ctx2.lineTo(sx(x), sy(values[i])); });
    ctx2.stroke();

    ctx2.fillStyle = '#64748b'; ctx2.font = '11px sans-serif'; ctx2.textAlign = 'center';
    for (let x = Math.ceil(xMin / 20) * 20; x <= xMax; x += 20) ctx2.fillText(String(x), sx(x), pad.top + plotH + 15);
    ctx2.fillText('Frequency offset (kHz)', pad.left + plotW / 2, H - 5);
  }, [scProfile, chi, sigma, width, height]);

  const meanS = Object.values(scProfile).reduce((a, b) => a + b, 0) / Object.keys(scProfile).length / 100;

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col ${isExpanded ? ` ${FS_CLASSES} p-6 ` : 'break-inside-avoid p-4'}`}>
      <div className="flex justify-between items-center mb-3 border-b pb-2 shrink-0">
        <h4 className="font-bold text-slate-700 flex items-center gap-2"><span>🧲</span> Deuterated Acyl-Chain Spectrum Simulator</h4>
        <button onClick={onToggleExpand} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5 transition-colors">{isExpanded ? '↙️' : '↗️'}</button>
      </div>
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div ref={wrapRef} className={`relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden ${isExpanded ? 'flex-1 min-h-0' : 'h-[350px]'}`}>
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          </div>
        </div>
        <div className="w-full lg:w-72 flex flex-col gap-2 shrink-0 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">χ (kHz)</label>
              <input type="number" step="0.5" value={chi} onWheel={(e) => e.target.blur()} onChange={(e) => setChi(parseFloat(e.target.value) || 167)} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Linewidth σ (kHz)</label>
              <input type="number" step="0.5" value={sigma} onWheel={(e) => e.target.blur()} onChange={(e) => setSigma(parseFloat(e.target.value) || 1)} className="border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500" />
            </div>
          </div>
          <div className="text-[10px] uppercase font-bold text-slate-500 mt-1">Order profile S_CD × 100 (C2 → C16)</div>
          {Object.entries(scProfile).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] font-bold w-8" style={{ color: SSNMR_FIT_COMPONENTS[key]?.color }}>{SSNMR_FIT_COMPONENTS[key]?.label.replace(' (CD₃)', '')}</span>
              <input type="range" min="0" max="100" value={val} onChange={(e) => updateSc(key, parseInt(e.target.value, 10))} className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer" style={{ accentColor: SSNMR_FIT_COMPONENTS[key]?.color }} />
              <span className="text-[10px] font-mono font-bold text-slate-700 w-7 text-right">{val}</span>
            </div>
          ))}
          <div className="border-t border-slate-200 pt-2 mt-1 flex justify-between text-xs font-bold text-slate-600">
            <span>Mean S_CD:</span><span className="text-emerald-600">{meanS.toFixed(3)}</span>
          </div>
          <button onClick={() => setScProfile({ ...DEFAULT_SC_PROFILE })} className="mt-1 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-1.5 rounded transition-colors">Reset to typical Lα profile</button>
        </div>
      </div>
    </div>
  );
};

export const Simulations = () => {
  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));
  return (
    <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        {fsPanel === 'mixer' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('mixer')} />}
        <DeuteriumMixer isExpanded={fsPanel === 'mixer'} onToggleExpand={() => toggleFs('mixer')} />
      </div>
    </CollapsibleSection>
  );
};

/* ========================================================================
NOTEBOOK EXTRA
======================================================================== */
/* ========================================================================
INSTRUMENTAL SETUP (ssNMR spectrometer)
Wired in via ssNMRTestRenderer's `custom.InstrumentalSetup`, so it renders inside
TestShellRenderer's own "Instrumental Setup" section instead of duplicating one.
======================================================================== */
export const InstrumentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';
  const INPUT_CLS = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';

  const update = (u) => {
    if (updateActiveTest) updateActiveTest(u);
  };

  const datasets = Array.isArray(activeTest.instrumentalDatasets)
    ? activeTest.instrumentalDatasets
    : [];

  const nextExperimentNumber = () => {
    const nums = datasets
      .map((d) => parseInt(d.experimentNumber, 10))
      .filter((n) => Number.isFinite(n));

    return String(nums.length ? Math.max(...nums) + 1 : datasets.length + 1);
  };

  const addDataset = () => {
    const expNum = nextExperimentNumber();

    const nextDataset = {
      id: makeId('instrumental_dataset'),
      experimentNumber: expNum,
      name: `Dataset ${expNum}`,
      date: new Date().toISOString().split('T')[0],
      operator: '',
      link: '',
      comments: ''
    };

    update({
      instrumentalDatasets: [...datasets, nextDataset]
    });
  };

  const patchDataset = (id, patch) => {
    update({
      instrumentalDatasets: datasets.map((d) =>
        d.id === id ? { ...d, ...patch } : d
      )
    });
  };

  const removeDataset = (id) => {
    update({
      instrumentalDatasets: datasets.filter((d) => d.id !== id)
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {SSNMR_INSTRUMENTAL_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>

            {f.type === 'select' ? (
              <select
                value={activeTest[f.key] || ''}
                onChange={(e) => update({ [f.key]: e.target.value })}
                className={INPUT_CLS}
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
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
                    <select
                      value={activeTest[`${f.key}Unit`] || f.units[0]}
                      onChange={(e) => update({ [`${f.key}Unit`]: e.target.value })}
                      className={`${INPUT_CLS} w-24 shrink-0`}
                    >
                      {f.units.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400 self-center px-1 shrink-0">
                      {f.units[0]}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border border-slate-200 rounded-xl bg-slate-50 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-bold text-slate-700">Datasets</h4>
            <p className="text-[10px] text-slate-400">
              Add instrumental datasets associated with this condition.
            </p>
          </div>

          <button
            type="button"
            onClick={addDataset}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors"
          >
            + Add Dataset
          </button>
        </div>

        {datasets.length === 0 ? (
          <div className="text-xs text-slate-400 italic bg-white border border-dashed border-slate-300 rounded-lg p-4 text-center">
            No datasets added yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {datasets.map((ds) => (
              <div
                key={ds.id}
                className="border border-slate-200 rounded-lg bg-white p-3 flex flex-col gap-2 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 uppercase">
                    Dataset
                  </span>

                  <button
                    type="button"
                    onClick={() => removeDataset(ds.id)}
                    className="text-red-500 hover:text-red-700 font-black text-sm px-1"
                    title="Remove dataset"
                  >
                    ×
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Experiment Number</label>
                    <input
                      type="text"
                      value={ds.experimentNumber || ''}
                      onChange={(e) => patchDataset(ds.id, { experimentNumber: e.target.value })}
                      className={INPUT_CLS}
                      placeholder="e.g. 1"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Dataset Name</label>
                    <input
                      type="text"
                      value={ds.name || ''}
                      onChange={(e) => patchDataset(ds.id, { name: e.target.value })}
                      className={INPUT_CLS}
                      placeholder="e.g. Dataset 1"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Date</label>
                    <input
                      type="date"
                      value={ds.date || ''}
                      onChange={(e) => patchDataset(ds.id, { date: e.target.value })}
                      className={INPUT_CLS}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className={LABEL_CLS}>Operator</label>
                    <input
                      type="text"
                      value={ds.operator || ''}
                      onChange={(e) => patchDataset(ds.id, { operator: e.target.value })}
                      className={INPUT_CLS}
                      placeholder="Operator name"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className={LABEL_CLS}>Link / Path</label>
                  <input
                    type="text"
                    value={ds.link || ''}
                    onChange={(e) => patchDataset(ds.id, { link: e.target.value })}
                    className={INPUT_CLS}
                    placeholder="e.g. Drive link, folder path, or dataset URL"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className={LABEL_CLS}>Comments</label>
                  <textarea
                    value={ds.comments || ''}
                    onChange={(e) => patchDataset(ds.id, { comments: e.target.value })}
                    className={`${INPUT_CLS} h-16 custom-scrollbar`}
                    placeholder="Optional dataset notes"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-400">
        Spectrometer configuration used to acquire the spectra for this condition — saved per condition, like the other experimental fields.
      </p>
    </div>
  );
};

export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useSSNMRDerived(activeTest, ctx);
  if (checkId === 'cond') {
    const expStr = SSNMR_EXPERIMENTAL_FIELDS
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
    const instrStr = SSNMR_INSTRUMENTAL_FIELDS
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
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Spectra (${d.activeInstance ? d.activeInstance.name : 'Condition'}):</b> ${titles}<br/><span style="font-size: 11px; color: #64748b;">Frequency range: ${wl.length ? `${Math.min(...wl)}–${Math.max(...wl)} nm (${Math.max(...wl)} kHz points)` : 'N/A'} · Y unit: ${activeTest.yUnit === 'theta' ? 'Normalized intensity' : 'a.u.'}</span></p>`;
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
  let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Condition</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Spectrum</th><th style="padding: 6px; border: 1px solid #cbd5e1;">²H Quadrupolar Fit (Δν kHz → S_CD)</th><th style="padding: 6px; border: 1px solid #cbd5e1;">R²</th></tr>`;
  rows.forEach(({ inst, spec, res }) => {
    const compStr = (res.activeBases || []).map((k) => {
      const dNu = res.splittings ? res.splittings[k] : 0;
      const S = res.fractions ? res.fractions[k] : 0;
      return dNu > 0 ? `${SSNMR_FIT_COMPONENTS[k]?.label || k}: <b>${dNu} kHz → ${S}</b>` : null;
    }).filter(Boolean).join('<br/>');
    html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0;"><b>${inst}</b></td><td style="padding: 6px; border: 1px solid #e2e8f0;">${spec}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${compStr}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${Number(res.r2 || 0).toFixed(4)}</td></tr>`;
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
    <Simulations />
  </div>
);
export default All;
