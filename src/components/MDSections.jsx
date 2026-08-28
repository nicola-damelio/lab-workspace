import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceArea
} from 'recharts';
import { Icon } from './Icons';
import { ChartControlBar, SharedChartStylePanel, useXZoom, ChartPanel, CHART_FS_CLASSES, useChartFsHeight, AngledTick } from './SharedAnalysisTools';
import { parseSimulationParameters } from './MDData';
import {
  CONTACT_DEFAULTS, parseTopology, computeContactRDF, demoFrames,
  resolveFrameSource, AWK_PALETTE, contactSeriesStyle
} from './MDMembraneContacts';
import { computeOrderAndDensity, parseChargeMap } from './MDMembraneProfiles';
import { computeMDTrajectoryAnalysis, parseEnergyFile } from '../utils/mdAnalysis';
import { abortControl, isAbortError } from '../utils/abortControl';
import { mdAnalysisRunAll } from '../utils/mdAnalysisRunAll';
import { blobStore } from '../utils/blobStore';
import html2canvas from 'html2canvas';
import { PER_ATOM_COLORS, seriesColorFor, rainbowColors } from '../utils/chartStyle';
export { parseSimulationParameters };   
import NMRMoleculeViewer from './NMRMoleculeViewer';
import {
  computeSecondaryStructure, SS_CODE_ORDER, SS_COLORS, SS_GROUP_COLORS
} from './MDSecondaryStructure';

import { AMINO_ACID_DB, NUCLEOTIDE_DB, SUGAR_DB, LIPID_DB, SS_META, FORM_META, RESIDUE_COLORS, buildKeys, buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure, elementsToSVG, StructureSVGView, SequencePaintStrip, getSelectedKeys, selectionLabel, getManualKeys, FORCE_FIELDS, WATER_MODELS, MD_ENSEMBLES, MD_INTEGRATORS, MD_THERMOSTATS, MD_BAROSTATS, TRAJECTORY_FORMATS, parseMDValue, getForceFieldInfo, getFFVersions, getWaterModelInfo, getFFBackboneAtoms, normalizeTrajectoryUrl, detectTrajectoryFormat, getTrajectoryFormatInfo, getMDInstances, getMDActiveInstance, getMDLayers, getMDActiveLayerKey, getMDLayerValues, writeMDCellValue, MD_ANALYSIS_LAYERS, DEFAULT_MD_CHART_STYLE, mdLineDash, mdDom} from './MDData';
import { DriveUploadButton } from './DriveUpload';
import { suggestDriveFileName } from '../utils/driveNaming';
import { archiveFileToDrive } from '../utils/driveUpload';

// Cache to retain local File objects when switching tabs within the same session
const localFileCache = new Map();

// IndexedDB key under which the uploaded trajectory File is persisted so it
// survives a page reload (no re-upload needed).
const trajBlobKey = (testId) => `traj_${testId}`;

/* ---- Lab Notebook chart snapshots ----------------------------------------
   The MD analysis charts live inside collapsed CollapsibleSections, so they
   cannot be captured at "Append to Lab Notebook" time. Instead we snapshot
   each chart (as a base64 PNG) right after it renders / is computed and store
   the data-URLs in activeTest.mdNotebookCharts. buildNotebookHtml then embeds
   those images into the notebook entry (selected by the respective tick).
--------------------------------------------------------------------------- */
const captureChartToDataUrl = async (id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    const canvas = await html2canvas(el, {
      scale: 1, useCORS: true, backgroundColor: '#ffffff', logging: false,
      imageTimeout: 15000
    });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
};

// Chart snapshots for the Lab Notebook live in a per-test sessionStorage cache,
// NOT inside activeTest. Storing base64 PNGs in the test object is what pushed
// the Firestore document past its 1 MiB limit ("value of property payload is
// longer than 1048487 bytes") and silently broke every save. sessionStorage
// survives page reloads in the same tab (so notebook figures still appear) but
// never touches the persisted dataset.
const chartCacheKey = (testId) => `lab_md_chart_snapshots_${testId}`;

export const readChartSnapshots = (testId) => {
  if (!testId) return {};
  try {
    return JSON.parse(sessionStorage.getItem(chartCacheKey(testId)) || '{}');
  } catch {
    return {};
  }
};

const storeChartSnapshots = (activeTest, entries) => {
  const testId = activeTest && activeTest.id;
  if (!testId) return;
  (async () => {
    const urls = {};
    await Promise.all(
      (entries || []).map(async ({ id, key }) => {
        const u = await captureChartToDataUrl(id);
        if (u) urls[key] = u;
      })
    );
    if (!Object.keys(urls).length) return;
    try {
      sessionStorage.setItem(
        chartCacheKey(testId),
        JSON.stringify({ ...readChartSnapshots(testId), ...urls })
      );
    } catch { /* quota exceeded / private mode — notebook figures degrade gracefully */ }
  })();
};

// Recharts + html2canvas become extremely slow above ~2k points. Time-series
// analysis results (RMSD / Rg / SASA, one point per used frame) can be far
// larger, so we thin them for DISPLAY only — the full result stays in
// calcData (and in the per-atom table).
const MAX_DISPLAY_POINTS = 1500;
const downsampleSeries = (arr, max = MAX_DISPLAY_POINTS) => {
  if (!Array.isArray(arr) || arr.length <= max) return arr;
  const step = Math.max(1, Math.ceil(arr.length / max));
  return arr.filter((_, i) => i % step === 0);
};

// Tiny self-contained SVG renderer used to embed the MD analysis charts into
// the Lab Notebook HTML. It renders straight from the persisted
// mdAnalysisResult data, so the notebook needs no stored base64 images.
export const mdChartToSvg = ({
  data, series, chartType = 'line', xKey = 'time', yLabel = '', xLabel = '', width = 680, height = 340
}) => {
  if (!Array.isArray(data) || !data.length || !Array.isArray(series) || !series.length) return '';
  const W = width, H = height, mL = 64, mR = 16, mT = 18, mB = 44;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const xs = data.map((d) => Number(d[xKey]) || 0);
  const allY = [];
  series.forEach((s) => data.forEach((d) => { const v = Number(d[s.key]); if (Number.isFinite(v)) allY.push(v); }));
  if (!allY.length) return '';
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let lo = Math.min(...allY, 0), hi = Math.max(...allY);
  if (lo === hi) { lo -= 1; hi += 1; }
  const xSpan = xMax === xMin ? 1 : xMax - xMin;
  const X = (v) => mL + ((Number(v) - xMin) / xSpan) * plotW;
  const Y = (v) => mT + (1 - (Number(v) - lo) / (hi - lo)) * plotH;
  let out = '';
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const yv = lo + ((hi - lo) * i) / yTicks;
    const yy = Y(yv);
    out += `<line x1="${mL}" y1="${yy.toFixed(1)}" x2="${W - mR}" y2="${yy.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
    out += `<text x="${mL - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${yv.toFixed(2)}</text>`;
  }
  const xTicks = 4;
  for (let i = 0; i < xTicks; i++) {
    const xv = xMin + (xMax - xMin) * (i / (xTicks - 1));
    out += `<text x="${X(xv).toFixed(1)}" y="${H - mB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${Number(xv).toFixed(2)}</text>`;
  }
  if (chartType === 'bar') {
    const bw = Math.max(2, (plotW / data.length) * 0.7);
    out += data.map((d) => {
      const x = X(d[xKey]) - bw / 2;
      const y = Y(Number(d[series[0].key]));
      const h = Math.max(0, H - mB - y);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${d.fill || series[0].color}"/>`;
    }).join('');
  } else {
    out += series.map((s) => {
      const pts = data.map((d) => `${X(d[xKey]).toFixed(1)},${Y(Number(d[s.key])).toFixed(1)}`).join(' ');
      return `<polyline fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    }).join('');
  }
  out += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="#94a3b8" stroke-width="1"/>`;
  out += `<line x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}" stroke="#94a3b8" stroke-width="1"/>`;
  out += `<text x="${W / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#475569">${xLabel}</text>`;
  out += `<text x="14" y="${H / 2}" text-anchor="middle" font-size="11" fill="#475569" transform="rotate(-90 14 ${H / 2})">${yLabel}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">${out}</svg>`;
};

// Compact heatmap SVG for the membrane-contact matrices (used by the Lab
// Notebook). Aggressively downsampled (≤ 25×25 cells) so the printed notebook
// stays small while the key pattern remains visible.
export const mdContactToSvg = (result, label) => {
  if (!result || !Array.isArray(result.rows) || !result.rows.length) return '';
  const keys = (Array.isArray(result.series) ? result.series.map((s) => s.key) : []).filter((k) => k && k !== 'atom');
  if (!keys.length) return '';
  const maxR = 25, maxC = 25;
  const rStride = Math.max(1, Math.ceil(result.rows.length / maxR));
  const cStride = Math.max(1, Math.ceil(keys.length / maxC));
  const rIdx = result.rows.map((_, i) => i).filter((_, i) => i % rStride === 0);
  const cIdx = keys.map((_, i) => i).filter((_, i) => i % cStride === 0);
  let maxV = 0;
  rIdx.forEach((ri) => cIdx.forEach((ci) => { const v = Math.abs(Number(result.rows[ri][keys[ci]]) || 0); if (v > maxV) maxV = v; }));
  if (maxV <= 0) maxV = 1;
  const cell = 14, left = 70, top = 22;
  const W = cIdx.length * cell + left + 8;
  const H = rIdx.length * cell + top + 30;
  const color = (v) => {
    const t = Math.min(1, Math.abs(Number(v) || 0) / maxV);
    const r = Math.round(30 + 180 * t);
    const g = Math.round(90 + 90 * (1 - t));
    const b = Math.round(225 - 170 * t);
    return `rgb(${r},${g},${b})`;
  };
  let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
  out += `<text x="8" y="12" font-size="11" fill="#475569">${label}</text>`;
  rIdx.forEach((ri, y) => cIdx.forEach((ci, x) => {
    const v = Number(result.rows[ri][keys[ci]]) || 0;
    out += `<rect x="${left + x * cell}" y="${top + y * cell}" width="${cell - 1}" height="${cell - 1}" fill="${color(v)}"/>`;
  }));
  rIdx.forEach((ri, y) => {
    const lbl = String(result.rows[ri].atom || ri).slice(0, 14);
    out += `<text x="${left - 4}" y="${top + y * cell + cell - 3}" text-anchor="end" font-size="8" fill="#475569">${lbl}</text>`;
  });
  cIdx.forEach((ci, x) => {
    const tx = left + x * cell + cell / 2;
    const ty = rIdx.length * cell + top + 12;
    out += `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="7" fill="#475569" transform="rotate(-60 ${tx} ${ty})">${String(keys[ci]).slice(0, 12)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, Helvetica, sans-serif">${out}</svg>`;
};

// Vector notebook figures for the membrane profiles (SCD / density / potential).
export const mdProfileToSvg = (result) => {
  if (!result) return '';
  const figs = [];
  const scdGroups = result.scdGroups || [];
  if (scdGroups.length) {
    const maxCarbons = Math.max(...scdGroups.map((g) => (g.carbons || []).length));
    const rows = [];
    for (let i = 0; i < maxCarbons; i++) {
      const row = { x: i + 1 };
      scdGroups.forEach((g, gi) => { const c = (g.carbons || [])[i]; row[`s${gi}`] = c ? c.scd : 0; });
      rows.push(row);
    }
    const series = scdGroups.map((g, gi) => ({ key: `s${gi}`, color: rainbowColors(scdGroups.length)[gi % Math.max(1, scdGroups.length)] }));
    figs.push(['Order parameter |SCD|', mdChartToSvg({ data: rows, series, xKey: 'x', yLabel: '|SCD|', xLabel: 'Carbon index', height: 240 })]);
  }
  const dens = result.density;
  if (dens && Array.isArray(dens.z) && dens.z.length) {
    const dRows = dens.z.map((z, i) => ({ x: z, value: dens.rhoE[i] }));
    const pRows = dens.z.map((z, i) => ({ x: z, value: dens.potential[i] }));
    figs.push(['Electron density profile', mdChartToSvg({ data: dRows, series: [{ key: 'value', color: '#0ea5e9' }], yLabel: 'e/nm³', xLabel: 'z (nm)', height: 240 })]);
    figs.push(['Electrostatic potential', mdChartToSvg({ data: pRows, series: [{ key: 'value', color: '#f43f5e' }], yLabel: 'V (mV)', xLabel: 'z (nm)', height: 240 })]);
  }
  return figs.map(([lbl, svg]) => (svg ? `<figure style="margin:8px 0;text-align:center;break-inside:avoid;">${svg}<figcaption style="font-size:11px;color:#64748b;"><b>${lbl}</b></figcaption></figure>` : '')).join('');
};

// Vector notebook figures for DSSP (content over time + per-residue occupancy).
export const mdDsspToSvg = (result) => {
  if (!result) return '';
  let html = '';
  if (Array.isArray(result.series) && result.series.length) {
    html += `<figure style="margin:8px 0;text-align:center;break-inside:avoid;">${mdChartToSvg({
      data: result.series, xKey: 'x',
      series: [{ key: 'alpha', color: '#3b82f6' }, { key: 'beta', color: '#ef4444' }, { key: 'coil', color: '#94a3b8' }],
      yLabel: '%', xLabel: result.xUnit === 'ns' ? 'Time (ns)' : 'Frame', height: 240
    })}<figcaption style="font-size:11px;color:#64748b;"><b>Secondary structure content</b></figcaption></figure>`;
  }
  if (Array.isArray(result.occupancy) && result.occupancy.length) {
    const oRows = result.occupancy.map((o, i) => ({ x: i + 1, value: o.alpha, residue: o.label }));
    html += `<figure style="margin:8px 0;text-align:center;break-inside:avoid;">${mdChartToSvg({
      data: oRows, xKey: 'x', chartType: 'bar',
      series: [{ key: 'value', color: '#3b82f6' }],
      yLabel: '% α-helix', xLabel: 'Residue', height: 220
    })}<figcaption style="font-size:11px;color:#64748b;"><b>Per-residue α-helix occupancy</b></figcaption></figure>`;
  }
  return html;
};

// ---- Global RDKit readiness singleton (shared across all OrganicViewer instances) ----
const _rdkitMDListeners = new Set();
let _rdkitMDStatus = window.__RDKit ? 'ready' : 'loading';
if (_rdkitMDStatus === 'loading') {
  // Load RDKit ourselves (minimal build — the only file published in @rdkit/rdkit)
  // so the 2D formula works even when no other page loaded it first.
  try {
    if (!document.getElementById('rdkit-md-wasm-script')) {
      const s = document.createElement('script');
      s.id = 'rdkit-md-wasm-script';
      s.src = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
      s.async = true;
      s.onload = () => {
        if (typeof window.initRDKitModule === 'function') {
          window.initRDKitModule({ locateFile: () => 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.wasm' })
            .then((M) => { window.__RDKit = M; })
            .catch(() => {});
        }
      };
      document.head.appendChild(s);
    }
  } catch { /* RDKit stays unavailable — fallback image will be shown */ }
  let _att = 0;
  const _iv = setInterval(() => {
    _att++;
    if (window.__RDKit) { _rdkitMDStatus = 'ready'; clearInterval(_iv); _rdkitMDListeners.forEach(f => f('ready')); _rdkitMDListeners.clear(); }
    else if (_att > 66) { _rdkitMDStatus = 'failed'; clearInterval(_iv); _rdkitMDListeners.forEach(f => f('failed')); _rdkitMDListeners.clear(); }
  }, 300);
}
const useMDRdkitReady = () => {
  const [status, setStatus] = useState(_rdkitMDStatus);
  useEffect(() => {
    if (_rdkitMDStatus !== 'loading') { setStatus(_rdkitMDStatus); return; }
    const fn = (s) => setStatus(s);
    _rdkitMDListeners.add(fn);
    return () => _rdkitMDListeners.delete(fn);
  }, []);
  return { rdkitReady: status === 'ready', rdkitFailed: status === 'failed' };
};

/* ============================================================================
   MDSections — MD page content sections.
========================================================================== */

// ================= REMOTE 3D STRUCTURE FETCH =================
const looksLikePdb = (text) => !!text && /^(ATOM|HETATM)/m.test(text) && !/<html/i.test(text);

const fetchCactusPdb = async (smiles) => {
  const res = await fetch(`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/file?format=pdb&get3d=true`);
  if (!res.ok) throw new Error(`Cactus HTTP ${res.status}`);
  const text = await res.text();
  if (!looksLikePdb(text)) throw new Error('Cactus did not return a usable 3D structure');
  return text;
};

const fetchPubchemPdb = async (smiles) => {
  const cidRes = await fetch('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/cids/txt', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(smiles)}`,
  });
  if (!cidRes.ok) throw new Error(`PubChem CID lookup HTTP ${cidRes.status}`);
  const cid = (await cidRes.text()).trim().split('\n')[0].trim();
  const sdfRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/record/SDF?record_type=3d`);
  if (!sdfRes.ok) throw new Error(`PubChem 3D SDF HTTP ${sdfRes.status}`);
  return { sdf: await sdfRes.text(), ext: 'sdf' };
};

const resolveOrganicStructureText = async (smiles) => {
  const errors = [];
  try { return { text: await fetchCactusPdb(smiles), ext: 'pdb' }; } catch (e) { errors.push(`Cactus: ${e.message}`); }
  try { const { sdf } = await fetchPubchemPdb(smiles); return { text: sdf, ext: 'sdf' }; } catch (e) { errors.push(`PubChem: ${e.message}`); }
  throw new Error(`No 3D structure could be resolved for this SMILES.\n${errors.join('\n')}`);
};

// ================= SHARED DERIVED DATA HOOK (MD) =================
const useMDDerived = (activeTest, ctx = {}) => {
  const compName = activeTest.selectedCompounds?.[0] || activeTest.compound;
  const metaSeq = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.sequence) ? ctx.compoundMeta[compName].sequence : '';
  const metaType = (ctx.compoundMeta && compName && ctx.compoundMeta[compName]?.type) ? ctx.compoundMeta[compName].type : null;

  const moleculeType = activeTest.moleculeType || metaType || 'protein';
  const rawSeq = (activeTest.proteinSequence || metaSeq || '').toUpperCase();

  const validChars =
    moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY'
    : moleculeType === 'dna' ? 'ACGT'
    : moleculeType === 'rna' ? 'ACGU' : '';

  const seq =
    moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna'
      ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';

  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';

  const DB =
    moleculeType === 'protein' ? AMINO_ACID_DB
    : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA
    : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA
    : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;

  // ---- MD parameters ----
  const ffKey = activeTest.forceField || 'GROMOS';
  const ffVersion = activeTest.forceFieldVersion || (getFFVersions(ffKey)[0] || '');
  const waterModel = activeTest.waterModel || 'TIP3P';
  const ensemble = activeTest.ensemble || 'NPT';
  const integrator = activeTest.integrator || 'verlet';
  const thermostat = activeTest.thermostat || 'v_rescale';
  const barostat = activeTest.barostat || 'parrinello_rahman';
  const timestep = activeTest.timestep ?? '2';
  const nSteps = activeTest.nSteps ?? '500000';
  const temperature = activeTest.simTemperature ?? '300';
  const pressure = activeTest.simPressure ?? '1.0';

  // ---- trajectory ----
  const trajectoryUrl = activeTest.trajectoryUrl || '';
  const trajectoryFormat = activeTest.trajectoryFormat || detectTrajectoryFormat(trajectoryUrl);

  // ---- conformation state (identical to NMR) ----
  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');

  const formsRaw = activeTest.nucleicForms || '';
  const dnaFormDefault = activeTest.dnaForm || 'B';
  const getFormAt = (i) => (formsRaw[i] && 'ABZ'.includes(formsRaw[i]) ? formsRaw[i] : dnaFormDefault);

  const sugarConf = activeTest.sugarConf || 'chair';
  const sugarAnomer = activeTest.sugarAnomer || 'alpha';
  const lipidDB = activeTest.lipidDB || 'cis';

  const typeLabel =
    moleculeType === 'protein' ? 'Protein'
    : moleculeType === 'dna' ? 'DNA'
    : moleculeType === 'rna' ? 'RNA'
    : moleculeType === 'sugar' ? 'Sugar'
    : moleculeType === 'organic' ? 'Organic Molecule' : 'Phospholipid';

  const ffInfo = getForceFieldInfo(ffKey);
  const ffBackbone = getFFBackboneAtoms(ffKey);

  // ---- parsed sequence with force-field atom data ----
  const parsedSeq = useMemo(() => {
    let chars = [];
    if (moleculeType === 'organic') {
      if (!activeTest.smiles) return [];
      return [{
        id: 'ORG1',
        char: 'O',
        name: 'Organic Molecule',
        color: '#3b82f6',
        ffAtoms: [] // Stays empty until full parameter logic parses it
      }];
    }
    if (isPolymer) { if (!seq) return []; chars = seq.split(''); }
    else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];

    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      const ffAtoms = ffBackbone.map((a) => ({ ...a }));
      return {
        ...entry,
        id: `${entry.code3 || char}${index + 1}`,
        char,
        color: RESIDUE_COLORS[index % RESIDUE_COLORS.length],
        ffAtoms
      };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice, DB, isPolymer, ffBackbone]);

  // ---- secondary-structure / form annotated sequence ----
  const estSeq = useMemo(() => parsedSeq.map((res, idx) => ({
    ...res,
    ssLetter: moleculeType === 'protein' ? getSSAt(idx) : 'C',
    formLetter: getFormAt(idx)
  })), [parsedSeq, moleculeType]);

  // ---- 2D structure ----
  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
    if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
    if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], sugarConf, sugarAnomer);
    if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], lipidDB);
    return null;
  }, [parsedSeq, moleculeType, sugarConf, sugarAnomer, lipidDB]);

  // ---- atom options for selectors / plots ----
  const atomOptions = useMemo(() => {
    const opts = [];
    // For organic molecules, derive atom names from SMILES via RDKit
    if (moleculeType === 'organic' && activeTest.smiles && window.__RDKit) {
      try {
        const mol = getMolWithExplicitHs(activeTest.smiles);
        if (mol) {
          const molblock = mol.get_molblock();
          const { atomNameList } = deriveOrganicAtomNaming(molblock);
          mol.delete();
          atomNameList.forEach(name => opts.push({ key: `0-${name}`, label: `ORG1 ${name}` }));
        }
      } catch { /* RDKit not ready or parse error — opts stays empty */ }
    } else {
      estSeq.forEach((res, idx) => {
        (res.ffAtoms || []).forEach((a) => opts.push({ key: `${idx}-${a.atom}`, label: `${res.id} ${a.atom}` }));
      });
    }
    return opts;
  }, [estSeq, moleculeType, activeTest.smiles]);

  // ---- instances / layers (MD model) ----
  const instances = getMDInstances(activeTest);
  const activeInstance = getMDActiveInstance(activeTest);
  const layers = getMDLayers(activeTest);
  const activeLayerKey = getMDActiveLayerKey(activeTest);
  const activeValues = getMDLayerValues(activeInstance, activeLayerKey);

  // Pseudo-atoms created by the analyses (system-level Rg/SASA/RMSD, SCD
  // carbons, …), so they become selectable in the Per-Atom and Condition plots.
  const analysisAtoms = useMemo(() => {
    const seen = new Map();
    MD_ANALYSIS_LAYERS.forEach((l) => {
      const vals = getMDLayerValues(activeInstance, l.key);
      Object.keys(vals || {}).forEach((k) => {
        if (!/^\d+-/.test(k)) return;
        seen.set(k, k.replace(/^\d+-/, ''));
      });
    });
    return [...seen.entries()].map(([key, label]) => ({ key, label: `0 ${label}` }));
  }, [activeInstance]);

  return {
    moleculeType, seq, validChars, isPolymer, DB, typeLabel,
    ffKey, ffVersion, ffInfo, ffBackbone, waterModel, ensemble, integrator,
    thermostat, barostat, timestep, nSteps, temperature, pressure,
    trajectoryUrl, trajectoryFormat,
    getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, dnaFormDefault,
    parsedSeq, estSeq, structure, atomOptions: [...atomOptions, ...analysisAtoms],
    instances, activeInstance, layers, activeLayerKey, activeValues,
    metaSeq
  };
};

// ================= 1) EXPERIMENT SETUP (MD) =================
// ================= RDKIT MOLBLOCK HELPERS (organic atom naming) =================
const getMolWithExplicitHs = (smiles) => {
  if (!window.__RDKit || !smiles) return null;
  const base = window.__RDKit.get_mol(smiles);
  if (!base) return null;
  const molblockWithHs = base.add_hs();
  base.delete();
  return window.__RDKit.get_mol(molblockWithHs);
};

const deriveOrganicAtomNaming = (molblock) => {
  const lines = molblock.split('\n');
  const counts = lines[3] || '';
  const numAtoms = parseInt(counts.substring(0, 3).trim(), 10) || 0;
  const numBonds = parseInt(counts.substring(3, 6).trim(), 10) || 0;

  const elements = [];
  for (let i = 0; i < numAtoms; i++) elements.push((lines[4 + i].substring(31, 34) || '').trim());

  const bonds = [];
  for (let i = 0; i < numBonds; i++) {
    const bl = lines[4 + numAtoms + i] || '';
    const a1 = parseInt(bl.substring(0, 3).trim(), 10) - 1;
    const a2 = parseInt(bl.substring(3, 6).trim(), 10) - 1;
    if (!isNaN(a1) && !isNaN(a2)) bonds.push([a1, a2]);
  }

  const heavyRank = new Array(numAtoms).fill(-1);
  let hc = 0;
  for (let i = 0; i < numAtoms; i++) if (elements[i] !== 'H') heavyRank[i] = hc++;

  const parent = new Array(numAtoms).fill(-1);
  bonds.forEach(([a, b]) => {
    if (elements[a] === 'H' && elements[b] !== 'H') parent[a] = b;
    if (elements[b] === 'H' && elements[a] !== 'H') parent[b] = a;
  });

  const hGroups = {};
  for (let i = 0; i < numAtoms; i++) {
    if (elements[i] !== 'H') continue;
    const key = parent[i] >= 0 ? parent[i] : 'orphan';
    (hGroups[key] = hGroups[key] || []).push(i);
  }

  const atomNameList = new Array(numAtoms);
  for (let i = 0; i < numAtoms; i++) if (elements[i] !== 'H') atomNameList[i] = `${elements[i]}${heavyRank[i]}`;
  Object.entries(hGroups).forEach(([key, idxs]) => {
    const parentRank = key === 'orphan' ? null : heavyRank[Number(key)];
    idxs.forEach((idx, j) => {
      const suffix = idxs.length > 1 ? ('abcdefgh'[j] || String(j)) : '';
      atomNameList[idx] = parentRank !== null ? `H${parentRank}${suffix}` : `H${idx}`;
    });
  });

  const atomLabels = {};
  atomNameList.forEach((name, i) => { atomLabels[i] = name; });
  return { atomLabels, atomNameList, elements, numAtoms };
};

// ================= ORGANIC VIEWER =================
const OrganicViewer = ({ smiles, selectedKeys, onAtomClick }) => {
    const [svg, setSvg] = useState('');
    const [isZoomed, setIsZoomed] = useState(false);
    const svgRef = useRef(null);
    const zoomedSvgRef = useRef(null);
    const { rdkitReady, rdkitFailed } = useMDRdkitReady(); // global singleton — no per-instance interval

    useEffect(() => {
        if (smiles && rdkitReady) {
            try {
                const mol = getMolWithExplicitHs(smiles);
                if (!mol) throw new Error('RDKit could not parse this SMILES');

                const molblock = mol.get_molblock();
                const { atomLabels, atomNameList } = deriveOrganicAtomNaming(molblock);

                let highlightAtoms = [];
                if (selectedKeys && selectedKeys.length > 0) {
                    highlightAtoms = selectedKeys.map(k => {
                        const parts = k.split('-');
                        if (parts.length < 2) return -1;
                        const atomName = parts.slice(1).join('-');
                        return atomNameList.indexOf(atomName);
                    }).filter(idx => idx >= 0);
                }

                const details = JSON.stringify({ 
                    addAtomIndices: false, 
                    addStereoAnnotation: true,
                    atomLabels: atomLabels, 
                    width: 450, 
                    height: 350,
                    atoms: highlightAtoms,
                    highlightAtomColors: highlightAtoms.reduce((acc, idx) => {
                        acc[idx] = [0.96, 0.62, 0.04]; 
                        return acc;
                    }, {})
                });
                
                setSvg(mol.get_svg_with_highlights(details));
                mol.delete();
            } catch { setSvg(''); }
        } else { setSvg(''); }
    }, [smiles, selectedKeys, rdkitReady]);

    const attachListeners = (containerEl) => {
        if (!containerEl || !onAtomClick || !window.__RDKit) return;
        try {
            const mol = getMolWithExplicitHs(smiles);
            if (!mol) return;
            const molblock = mol.get_molblock();
            const { atomNameList } = deriveOrganicAtomNaming(molblock);
            mol.delete();

            const atoms = containerEl.querySelectorAll('[class*="atom-"]');
            atoms.forEach(node => {
                node.style.cursor = 'pointer';
                node.onclick = (e) => {
                    e.stopPropagation();
                    const cls = Array.from(node.classList).find(c => c.startsWith('atom-'));
                    if (cls) {
                        const idx = parseInt(cls.replace('atom-', ''), 10);
                        if (!isNaN(idx) && atomNameList[idx]) {
                            onAtomClick(0, [`0-${atomNameList[idx]}`]);
                        }
                    }
                };
            });
        } catch {}
    };

    useEffect(() => { attachListeners(svgRef.current); }, [svg, onAtomClick]);
    useEffect(() => { if (isZoomed) attachListeners(zoomedSvgRef.current); }, [isZoomed, svg, onAtomClick]);

    const fallbackUrl = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(smiles)}/image?width=1500&height=1500`;
    
    return (
        <>
            <div ref={svgRef} className="flex flex-col items-center justify-center bg-white p-4 rounded-xl shadow-sm border border-slate-200 group relative h-[350px]">
                {svg ? (
                    <div dangerouslySetInnerHTML={{__html: svg}} className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" />
                ) : smiles && !rdkitReady && !rdkitFailed ? (
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-xs font-semibold">Loading 2D renderer…</span>
                    </div>
                ) : (
                    <div className="relative w-full h-full flex items-center justify-center">
                      <img src={fallbackUrl} alt="2D Structure" className="max-w-full h-full object-contain" />
                      {rdkitFailed && <span className="absolute bottom-1 right-1 text-[9px] text-slate-400 bg-white/80 px-1 rounded">Labels unavailable (RDKit failed)</span>}
                    </div>
                )}
                <div onClick={() => setIsZoomed(true)} className="cursor-pointer absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                    <span className="bg-white/90 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-sm shadow-sm pointer-events-none">🔍 Click to zoom structure</span>
                </div>
            </div>
            {isZoomed && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/85 backdrop-blur-sm p-4 overflow-auto" onClick={() => setIsZoomed(false)}>
                    <div ref={zoomedSvgRef} className="bg-white p-6 rounded-2xl shadow-2xl relative max-w-[95vw] max-h-[95vh] overflow-auto flex items-center justify-center" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setIsZoomed(false)} className="absolute top-2 right-2 bg-slate-200 text-slate-800 rounded-full w-10 h-10 flex items-center justify-center text-2xl font-black shadow-lg hover:bg-slate-300 z-50">×</button>
                        {svg ? (
                            <div dangerouslySetInnerHTML={{__html: svg.replace(/width=['"]450['"]/i, 'width="100%"').replace(/height=['"]350['"]/i, 'height="100%"')} } className="w-full min-w-[800px] [&>svg]:w-full [&>svg]:h-auto" />
                        ) : (
                            <img src={fallbackUrl} alt="Zoomed Structure" className="w-full h-auto min-w-[800px] object-contain" />
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

// ================= 1) EXPERIMENT SETUP (MD) =================
export const MDExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const structureMode = activeTest.structureMode || '2d';
  const atomLabelMode = activeTest.atomLabelMode || 'selected';
  const residueOffset = activeTest.residueOffset || 0;

  const atomNameMap = useMemo(() => {
    try { return activeTest.atomNameMap ? JSON.parse(activeTest.atomNameMap) : {}; } catch { return {}; }
  }, [activeTest.atomNameMap]);

  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  
  const [trajectoryFile, setTrajectoryFile] = useState(() => localFileCache.get(activeTest.id)?.trajectory || null);

  const handleStructureFile = (file) => {
    if (!file) {
      updateActiveTest({ structureFileData: null, structureFileName: null });
      return;
    }
    archiveFileToDrive({ file, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Setup', subsection: 'Structure', suffix: 'structure' } }).catch(() => {});
    const reader = new FileReader();
    reader.onload = (e) => {
      updateActiveTest({ structureFileData: e.target.result, structureFileName: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleTrajectoryFile = (file) => {
    if (!file) {
      updateActiveTest({ trajectoryFileName: null });
      setTrajectoryFile(null);
      blobStore.remove(trajBlobKey(activeTest.id));
      return;
    }
    archiveFileToDrive({ file, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Setup', subsection: 'Trajectory', suffix: 'trajectory' } }).catch(() => {});
    setTrajectoryFile(file);
    updateActiveTest({ trajectoryFileName: file.name });
    const cache = localFileCache.get(activeTest.id) || {};
    localFileCache.set(activeTest.id, { ...cache, trajectory: file });
    // Persist the file in the browser so it survives a page reload.
    blobStore.save(trajBlobKey(activeTest.id), file);
  };

  // Restore a previously-uploaded trajectory from IndexedDB on (re)load, so the
  // user does not have to re-upload the .xtc/.trr/.dcd after refreshing the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (trajectoryFile || !activeTest.trajectoryFileName) return;
      const blob = await blobStore.load(trajBlobKey(activeTest.id));
      if (cancelled || !blob) return;
      if (activeTest.trajectoryFileName && blob.name && blob.name !== activeTest.trajectoryFileName) return;
      const restored = new File([blob], blob.name || activeTest.trajectoryFileName || 'trajectory.xtc', { type: blob.type || 'application/octet-stream' });
      setTrajectoryFile(restored);
      const cache = localFileCache.get(activeTest.id) || {};
      localFileCache.set(activeTest.id, { ...cache, trajectory: restored });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTest.id]);
  
  useEffect(() => { if (structureMode === '3d') setHasOpened3D(true); }, [structureMode]);

  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);

  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });

  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');
  const [formBrush, setFormBrush] = useState(activeTest.dnaForm || 'B');

  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.activeValues), [d.activeValues]);

  const handleAtomClick = (ri, keys) => {
    if (ri === null || !keys) return;
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };

  const paintSSAt = (i, letter) => {
    const arr = d.seq.split('').map((_, j) => d.getSSAt(j));
    arr[i] = letter;
    updateActiveTest({ secondaryStructure: arr.join('') });
  };

  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: d.seq.split('').map(() => letter).join('') });

  const paintFormAt = (i, letter) => {
    const arr = d.seq.split('').map((_, j) => d.getFormAt(j));
    arr[i] = letter;
    updateActiveTest({ nucleicForms: arr.join('') });
  };

  const setAllForms = (letter) => updateActiveTest({ nucleicForms: d.seq.split('').map(() => letter).join(''), dnaForm: letter });

  const exportFormulaToNotebook = () => {
    if (!d.structure) return;
    const html = `<div style="margin-top:10px;"><h5 style="color:#1e40af;font-size:12px;margin-bottom:6px;">🔬 Chemical Formula (${d.typeLabel}):</h5>` + elementsToSVG(d.structure, 300) + `</div>`;
    const currentComments = activeTest.comments || '';
    updateActiveTest({ comments: currentComments + (currentComments ? '<br/>' : '') + html });
    alert('Chemical formula appended to the Lab Notebook notes.');
  };

  const trajNorm = normalizeTrajectoryUrl(d.trajectoryUrl) || { url: null, fallbacks: [] };

  // --- ORGANIC MOLECULE 3D FETCHING ---
  const activeSmiles = activeTest.smiles || '';
  const hasExplicitOverride = !!(activeTest.structureSrc || activeTest.structureFileName || activeTest.structureFileData);
  const [organicFetch, setOrganicFetch] = useState({ smiles: null, text: null, ext: null, loading: false, error: null });
  const needsOrganicFetch = !hasExplicitOverride && !!activeSmiles && d.moleculeType === 'organic';

  useEffect(() => {
    if (!needsOrganicFetch) { 
      setOrganicFetch({ smiles: null, text: null, ext: null, loading: false, error: null }); 
      return; 
    }
    if (organicFetch.smiles === activeSmiles && (organicFetch.text || organicFetch.loading)) return;
    
    let cancelled = false;
    setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: true, error: null });
    
    resolveOrganicStructureText(activeSmiles)
      .then(({ text, ext }) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text, ext, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setOrganicFetch({ smiles: activeSmiles, text: null, ext: null, loading: false, error: err.message }); });
    
    return () => { cancelled = true; };
  }, [needsOrganicFetch, activeSmiles]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 mb-2">
        {[
          { val: 'protein', icon: 'dna', label: 'Protein' },
          { val: 'dna', icon: 'dna', label: 'DNA' },
          { val: 'rna', icon: 'dna', label: 'RNA' },
          { val: 'sugar', icon: 'sugar', label: 'Sugars' },
          { val: 'lipid', icon: 'layers', label: 'Phospholipids' },
          { val: 'organic', icon: 'atom', label: 'Organic Molecule' }
        ].map(({ val, icon, label }) => (
          <button key={val} onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors inline-flex items-center gap-1.5 ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.moleculeType === 'organic' ? (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">SMILES String</label>
              <input type="text" value={activeTest.smiles || ''} onChange={(e) => updateActiveTest({ smiles: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm outline-none focus:border-blue-500 shadow-inner"
                placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" />
            </div>
          ) : d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{d.typeLabel} Sequence (1-letter code)</label>
              <textarea 
                value={activeTest.proteinSequence ?? (d.metaSeq || '')} 
                onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
                placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'} 
              />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'} (valid: {d.validChars.split('').join(' ')})</p>
            </>
          ) : d.moleculeType === 'sugar' ? (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Sugar</label>
              <select value={activeTest.sugarChoice || 'GLC'} onChange={(e) => updateActiveTest({ sugarChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                {Object.entries(SUGAR_DB).map(([k, v]) => <option key={k} value={k}>{v.name} ({v.code3})</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Phospholipid</label>
              <select value={activeTest.lipidChoice || 'POPC'} onChange={(e) => updateActiveTest({ lipidChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                {Object.entries(LIPID_DB).map(([k, v]) => <option key={k} value={k}>{k} — {v.name}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {d.moleculeType === 'protein' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['C', 'H', 'E'].map((l) => (
              <button key={l} onClick={() => setSSBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{ backgroundColor: ssBrush === l ? SS_META[l].color : 'white', borderColor: SS_META[l].color, color: ssBrush === l ? 'white' : SS_META[l].color }}>
                {SS_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllSS('C')} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200">All Coil</button>
            <button onClick={() => setAllSS('H')} className="px-3 py-1 rounded-lg text-xs font-bold bg-violet-100 border border-violet-300 text-violet-700 hover:bg-violet-200">All α-Helix</button>
            <button onClick={() => setAllSS('E')} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-300 text-amber-700 hover:bg-amber-200">All β-Sheet</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">💡 Select a brush, then click or drag across the sequence chips to paint secondary structure.</p>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getSSAt(i)}
            meta={SS_META}
            onApply={(i) => paintSSAt(i, ssBrush)}
            focusIdx={focusIdx}
          />
        </div>
      )}

      {(d.moleculeType === 'dna' || d.moleculeType === 'rna') && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {['A', 'B', 'Z'].map((l) => (
              <button key={l} onClick={() => setFormBrush(l)} className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{ backgroundColor: formBrush === l ? FORM_META[l].color : 'white', borderColor: FORM_META[l].color, color: formBrush === l ? 'white' : FORM_META[l].color }}>
                {FORM_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllForms('A')} className="px-3 py-1 rounded-lg text-xs font-bold bg-sky-100 border border-sky-300 text-sky-700 hover:bg-sky-200">All A</button>
            <button onClick={() => setAllForms('B')} className="px-3 py-1 rounded-lg text-xs font-bold bg-green-100 border border-green-300 text-green-700 hover:bg-green-200">All B</button>
            <button onClick={() => setAllForms('Z')} className="px-3 py-1 rounded-lg text-xs font-bold bg-rose-100 border border-rose-300 text-rose-700 hover:bg-rose-200">All Z</button>
          </div>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getFormAt(i)}
            meta={FORM_META}
            onApply={(i) => paintFormAt(i, formBrush)}
            focusIdx={focusIdx}
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex bg-slate-200 p-1 rounded-lg">
            <button onClick={() => updateActiveTest({ structureMode: '2d' })}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '2d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>2D Formula</button>
            <button onClick={() => updateActiveTest({ structureMode: '3d' })}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '3d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>3D Viewer + Trajectory</button>
          </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              <label className="text-[10px] font-bold text-slate-500 uppercase">🔍 Focus</label>
              <select value={focusIdx} onChange={(e) => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
                <option value="ALL">All residues</option>
                {d.parsedSeq.map((r, i) => <option key={i} value={i}>{r.id} — {r.name}</option>)}
              </select>
              {selectedKeys && (
                <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-400 text-amber-800">✖ Deselect ({selectionLabel(d, selectedKeys)})</button>
              )}
              <button onClick={exportFormulaToNotebook} className="px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 border border-indigo-300 text-indigo-700 hover:bg-indigo-100" title="Append this formula (SVG) to the Lab Notebook notes">📓 Formula → Notebook</button>
            </div>
          </div>

          {structureMode === '3d' && (
            <div className="mb-3 flex flex-col gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase">
                  🧬 System files — loaded with the 3D viewer buttons below
                </span>
                <div className="flex items-center gap-3 flex-wrap text-[10px] font-bold">
                  {activeTest.structureFileName ? (
                    <span className="text-emerald-700">✓ Topology: {activeTest.structureFileName}</span>
                  ) : activeTest.structureSrc ? (
                    <span className="text-emerald-700">✓ Topology (web): {activeTest.structureSrc}</span>
                  ) : (
                    <span className="text-slate-400">No topology yet — use "Choose PDB/CIF" or "PDB ID or URL"</span>
                  )}
                  {trajectoryFile ? (
                    <span className="text-emerald-700">✓ Trajectory: {trajectoryFile.name}</span>
                  ) : (
                    <span className="text-slate-400">No trajectory yet — use "Choose XTC / TRR"</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Topology format</label>
                  <select value={activeTest.structureFormat || 'auto'} onChange={(e) => updateActiveTest({ structureFormat: e.target.value })}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    <option value="auto">Auto-detect</option>
                    <option value="pdb">PDB</option>
                    <option value="gro">GRO</option>
                    <option value="cif">CIF</option>
                    <option value="mmcif">mmCIF</option>
                    <option value="mol2">MOL2</option>
                    <option value="sdf">SDF</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Atom labels</label>
                  <select value={atomLabelMode} onChange={(e) => updateActiveTest({ atomLabelMode: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    <option value="none">No labels</option>
                    <option value="selected">Selected labels</option>
                    <option value="all">All labels</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Trajectory format</label>
                  <select value={d.trajectoryFormat} onChange={(e) => updateActiveTest({ trajectoryFormat: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500">
                    {TRAJECTORY_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-200">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">🎞️ Trajectory online link (web / Drive)</label>
                  <input 
                    type="text" 
                    value={d.trajectoryUrl} 
                    onChange={(e) => updateActiveTest({ trajectoryUrl: e.target.value })}
                    placeholder="https://…/trajectory.xtc (or Google Drive link)"
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-mono" 
                  />
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[10px] text-slate-400">Detected: <b>{getTrajectoryFormatInfo(d.trajectoryFormat).label}</b></span>
                    {d.trajectoryUrl && (
                      <a 
                        href={d.trajectoryUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline bg-blue-50 px-2 py-0.5 rounded border border-blue-200"
                        title="Open this link in a new tab to download the file"
                      >
                        ⬇️ Download File
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Trajectory from PC</label>
                  {trajectoryFile ? (
                    <span className="text-[10px] font-bold text-emerald-700 mt-0.5 flex items-center">
                      ✓ {trajectoryFile.name} (Ready)
                      <button type="button" onClick={() => handleTrajectoryFile(null)} className="ml-2 text-red-500 hover:text-red-700 font-black">✕</button>
                    </span>
                  ) : activeTest.trajectoryFileName ? (
                    <span className="text-[10px] font-bold text-amber-600 mt-0.5 flex flex-col">
                      <span>♻️ Restoring {activeTest.trajectoryFileName}…</span>
                      <span className="font-normal text-slate-500">The file is being brought back from this browser's local storage. If it does not reappear (e.g. you're on a different browser/PC), re-select it with the "Choose XTC / TRR" button in the 3D viewer.</span>
                      <button type="button" onClick={() => updateActiveTest({ trajectoryFileName: null })} className="self-start mt-1 text-red-500 hover:text-red-700 font-bold underline">Clear saved name</button>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 mt-0.5">Use the "Choose XTC / TRR" button in the 3D viewer below.</span>
                  )}

                  <div className="mt-1">
                    <DriveUploadButton
                      suggestedName={suggestDriveFileName({
                        project: (activeTest.projectNames || [])[0] || '',
                        test: activeTest.name || activeTest.instanceName || '',
                        section: 'Setup',
                        subsection: 'Trajectory',
                        suffix: 'trajectory'
                      })}
                      naming={{
                        project: (activeTest.projectNames || [])[0] || '',
                        test: activeTest.name || activeTest.instanceName || '',
                        section: 'Setup',
                        subsection: 'Trajectory',
                        suffix: 'trajectory'
                      }}
                      preloadedFile={trajectoryFile || null}
                      label="⬆ Archive trajectory to Drive"
                      className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400 mb-2">💡 Click an atom in the {structureMode === '2d' ? 'formula' : '3D viewer'} to highlight its cell in the atom table.</p>

          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }} aria-hidden={structureMode !== '3d'}>
            {hasOpened3D && (
              
<NMRMoleculeViewer
  key={`${activeTest.structureSrc || 'no-src'}|${activeTest.structureFileName || 'no-file'}|${trajectoryFile ? trajectoryFile.name : 'no-traj-file'}|${d.trajectoryUrl || 'no-traj'}|${activeTest.smiles || 'no-smiles'}`}
  src={activeTest.structureSrc}
  structureFileData={activeTest.structureFileData}
  structureFileName={activeTest.structureFileName}
  structureFormat={activeTest.structureFormat || 'auto'}
  structureText={typeof organicFetch !== 'undefined' ? organicFetch.text : null}
  structureTextExt={typeof organicFetch !== 'undefined' ? organicFetch.ext : null}
  externalLoading={typeof organicFetch !== 'undefined' ? organicFetch.loading : false}
  externalError={typeof organicFetch !== 'undefined' ? organicFetch.error : null}
  trajectorySrc={trajNorm.url}
  trajectoryFile={trajectoryFile}
  trajectoryFallbacks={trajNorm.fallbacks}
  trajectoryFormat={d.trajectoryFormat}
  moleculeType={d.moleculeType}
  parsedSeq={d.parsedSeq}
  selectedKeys={selectedKeys}
  manualKeys={manualKeys}
  onAtomClick={handleAtomClick}
  onStructureFile={handleStructureFile}
  onStructureSrc={(v) => updateActiveTest({ structureSrc: v })}
  onTrajectoryFile={handleTrajectoryFile}
  residueOffset={residueOffset}
  atomNameMap={atomNameMap}
  atomRenames={activeTest.atomRenames || {}}
  onAtomRenames={(map) => updateActiveTest({ atomRenames: map })}
  resRenumber={activeTest.resRenumber || {}}
  onResRenumber={(map) => updateActiveTest({ resRenumber: map })}
  onStructureSequence={(seq) => {
    if (seq && !activeTest.proteinSequence && ['protein', 'dna', 'rna'].includes(d.moleculeType)) {
      updateActiveTest({ proteinSequence: seq });
    }
  }}
  labelMode={atomLabelMode}
  height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? '620px' : '520px'}
/>
            )}
          </div>

          <div style={{ display: structureMode === '2d' ? 'block' : 'none' }} aria-hidden={structureMode !== '2d'}>
            {d.moleculeType === 'organic' && activeTest.smiles ? (
               <OrganicViewer smiles={activeTest.smiles} selectedKeys={selectedKeys} onAtomClick={handleAtomClick} />
            ) : d.structure ? (
              <StructureSVGView
                structure={d.structure}
                minWidth={d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'}
                isExpanded={expandedPanel === 'formula'}
                onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')}
                selectedKeys={selectedKeys}
                manualKeys={manualKeys}
                onAtomClick={handleAtomClick}
                height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'}
              />
            ) : null}
          </div>
        </div>
    </div>
  );
};

// ================= 2) DATA (MD atom table) =================
const MDImportPanel = ({ ctx, d }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [pasteText, setPasteText] = useState('');
  const [report, setReport] = useState(null);
  const layerKey = d.activeLayerKey;

  const applyValues = (vals) => {
    const nv = { ...(activeTest.mdValues || {}) };
    nv[layerKey] = { ...(nv[layerKey] || {}), ...vals };
    const insts = Array.isArray(activeTest.instances) && activeTest.instances.length ? activeTest.instances : null;
    if (insts && d.activeInstance) {
      const instances = insts.map((inst) =>
        inst.id === d.activeInstance.id
          ? { ...inst, values: { ...(inst.values || {}), [layerKey]: { ...((inst.values || {})[layerKey] || {}), ...vals } } }
          : inst
      );
      updateActiveTest({ instances, mdValues: nv });
    } else {
      updateActiveTest({ mdValues: nv });
    }
  };

  const handleText = (text) => {
    const vals = {};
    let missed = 0;
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) Object.assign(vals, j);
    } catch {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      lines.forEach((l) => {
        const parts = l.split(/[\t,;]/).map((c) => c.trim());
        if (parts.length >= 3) vals[`${parts[0]}-${parts[1]}`] = parts[2];
        else missed++;
      });
    }
    applyValues(vals);
    setReport({ ok: Object.keys(vals).length, missed });
  };

  return (
    <div className="mt-3 p-4 bg-sky-50 border border-sky-200 rounded-xl flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold text-sky-800 uppercase">Import into "{d.activeInstance ? d.activeInstance.name : 'active instance'}" · layer "{(d.layers.find((l) => l.key === layerKey) || {}).label}"</span>
      </div>
      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
        placeholder={'Paste CSV/TSV or JSON, e.g.\n0-CA,0.07\n{ "0-CA": "0.07" }'}
        className="w-full h-24 border border-sky-300 rounded-lg p-2 text-xs font-mono bg-white outline-none focus:border-sky-500" />
      <button type="button" onClick={() => handleText(pasteText)} disabled={!pasteText.trim()}
        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs w-fit">Import pasted data</button>
      {report && (
        <p className="text-xs font-bold text-emerald-700">✅ Imported {report.ok} values{report.missed > 0 ? ` · ⚠️ ${report.missed} rows skipped` : ''}</p>
      )}
    </div>
  );
};

export const MDDataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [showImport, setShowImport] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerUnit, setNewLayerUnit] = useState('');
  const [hiddenLayerKeys, setHiddenLayerKeys] = useState(activeTest.hiddenLayerKeys || []);

  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const selectedKeys = getSelectedKeys(activeTest);

  const effTableMode = d.moleculeType === 'sugar' || d.moleculeType === 'lipid' || d.moleculeType === 'organic' ? 'all' : tableMode;
  const activeLayer = d.layers.find((l) => l.key === d.activeLayerKey) || { label: 'MD Parameters', unit: '' };

  // Every layer's values, keyed by layer — needed so the "Unified" view can show
  // several parameter columns side by side instead of just the active layer.
  const layerValuesByKey = useMemo(() => {
    const map = {};
    d.layers.forEach((l) => { map[l.key] = getMDLayerValues(d.activeInstance, l.key); });
    return map;
  }, [d.layers, d.activeInstance]);

  const toggleLayerVisibility = (key) => {
    const next = hiddenLayerKeys.includes(key)
      ? hiddenLayerKeys.filter((k) => k !== key)
      : [...hiddenLayerKeys, key];
    setHiddenLayerKeys(next);
    updateActiveTest({ hiddenLayerKeys: next });
  };

  // Never let column selection hide every column — fall back to showing them all.
  const visibleLayers = (() => {
    const shown = d.layers.filter((l) => !hiddenLayerKeys.includes(l.key));
    return shown.length > 0 ? shown : d.layers;
  })();

  const handleCellChange = (resIdx, atom, val) => writeMDCellValue(activeTest, updateActiveTest, d.activeLayerKey, `${resIdx}-${atom}`, val);
  const handleCellChangeForLayer = (resIdx, atom, layerKey, val) => writeMDCellValue(activeTest, updateActiveTest, layerKey, `${resIdx}-${atom}`, val);

  const handleCellClick = (e, idx, atom) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const keys = buildKeys(idx, [atom], d.moleculeType, d.parsedSeq[idx]?.char);
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };

  const cellIsSelected = (idx, atom) => Boolean(selectedKeys && selectedKeys.includes(`${idx}-${atom}`));

  const addLayer = () => {
    const label = newLayerName.trim();
    if (!label) return;
    const layer = { key: `layer_${Date.now()}`, label, unit: newLayerUnit.trim() || '' };
    updateActiveTest({ parameterLayers: [...(activeTest.parameterLayers || []), layer], activeLayerKey: layer.key });
    setNewLayerName(''); setNewLayerUnit('');
  };

  const removeLayer = (key) => {
    if (key === 'md') return;
    const upd = (activeTest.parameterLayers || []).filter((l) => l.key !== key);
    updateActiveTest({ parameterLayers: upd, activeLayerKey: d.activeLayerKey === key ? 'md' : d.activeLayerKey });
  };

  const exportCSV = () => {
    // Export every parameter layer as its own column, not just the active one,
    // so the CSV is a complete record regardless of which table view is open.
    const rows = [[
      'Residue', 'Atom', 'Atom Type', 'Charge', 'Mass',
      ...d.layers.map((l) => `${l.label}${l.unit ? ` (${l.unit})` : ''}`)
    ]];
    d.estSeq.forEach((res, idx) => {
      (res.ffAtoms || []).forEach((a) => {
        const cellKey = `${idx}-${a.atom}`;
        rows.push([
          res.id, a.atom, a.type, a.charge, a.mass,
          ...d.layers.map((l) => (layerValuesByKey[l.key] || {})[cellKey] || '')
        ]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MD_${(d.activeInstance ? d.activeInstance.name : 'data').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selTdCls = (isSel) => `px-3 py-1 cursor-pointer transition-colors ${isSel ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : 'hover:bg-slate-50'}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">Active instance (from the top of the page):</span>
        <span className="text-sm font-black text-indigo-900">{d.activeInstance ? d.activeInstance.name : '—'}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Force field: {d.ffInfo.name} {d.ffVersion}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Water: {getWaterModelInfo(d.waterModel).name}</span>
        <span className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">Ensemble: {d.ensemble}</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500">
            Editing: <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span>
            {effTableMode === 'unified'
              ? <> · <span className="text-blue-700">all parameters ({visibleLayers.length}/{d.layers.length} columns shown)</span></>
              : <> · <span className="text-blue-700">{activeLayer.label}</span></>}
          </span>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setShowImport(!showImport)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${showImport ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'}`}>📥 Import data…</button>
            {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && (
              <div className="flex bg-slate-200 p-1 rounded-lg mr-2">
                {['backbone', 'all', 'unified'].map((m) => (
                  <button key={m} onClick={() => { setTableMode(m); updateActiveTest({ tableMode: m }); }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === m ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {m === 'backbone' ? 'Backbone' : m === 'all' ? 'All Atoms' : 'Unified (all params)'}
                  </button>
                ))}
              </div>
            )}
            <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1 shadow-sm">📊 Export XLS (CSV)</button>
          </div>
        </div>
        {showImport && <MDImportPanel ctx={ctx} d={d} />}
      </div>

      {selectedKeys && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-800 w-fit">
          🎯 Selected: {selectionLabel(d, selectedKeys)}
          <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="ml-1 text-amber-600 hover:text-red-600 font-black" title="Clear selection">✕</button>
        </div>
      )}

      {d.parsedSeq.length === 0 ? (
        d.moleculeType === 'organic' && d.atomOptions.length > 0 ? (
          /* Organic (SMILES) molecules have no sequence, but RDKit gives us the
             atom names — render a compact atom-value table instead of the
             "enter a sequence" placeholder. */
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-black border-b border-slate-200 text-center">Atom</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Value {activeLayer.unit ? `(${activeLayer.unit})` : ''}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.atomOptions.map((o) => {
                  const key = o.key;
                  const atomName = key.split('-').slice(1).join('-');
                  const isSel = cellIsSelected(0, atomName);
                  const hasVal = parseMDValue(d.activeValues[key]) !== null;
                  return (
                    <tr key={key} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{o.label}</td>
                      <td className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, 0, atomName)}>
                        <input type="text" value={d.activeValues[key] || ''} onChange={(e) => handleCellChange(0, atomName, e.target.value)}
                          className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[140px] ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
            Enter a sequence / select a molecule (in Experiment Setup) to generate the atom table.
          </div>
        )
      ) : effTableMode === 'backbone' ? (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-20 text-center">Res</th>
                {d.moleculeType === 'protein' && <th className="px-2 py-2 font-bold border-b border-slate-200 text-center">SS</th>}
                {d.ffBackbone.map((a) => (
                  <th key={a.atom} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">
                    {a.atom} {activeLayer.unit ? `(${activeLayer.unit})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                return (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{res.id}</td>
                    {d.moleculeType === 'protein' && (
                      <td className="px-2 py-1 text-center">
                        <span className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white" style={{ backgroundColor: SS_META[res.ssLetter].color }}>{res.ssLetter}</span>
                      </td>
                    )}
                    {d.ffBackbone.map((a) => {
                      const key = `${idx}-${a.atom}`;
                      const isSel = cellIsSelected(idx, a.atom);
                      const hasVal = parseMDValue(d.activeValues[key]) !== null;
                      return (
                        <td key={a.atom} className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)} title={`${a.desc} · type ${a.type} · charge ${a.charge}`}>
                          <input type="text" value={d.activeValues[key] || ''} onChange={(e) => handleCellChange(idx, a.atom, e.target.value)}
                            className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                          <div className="text-[11px] font-bold text-purple-600 text-center mt-0.5">{a.type}</div>
                          <div className="text-[10px] text-slate-500 text-center">q={a.charge} · m={a.mass}</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : effTableMode === 'unified' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">Columns to show:</span>
            {d.layers.map((l) => {
              const isVisible = !hiddenLayerKeys.includes(l.key);
              return (
                <label key={l.key}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border cursor-pointer transition-colors select-none ${isVisible ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-400'}`}>
                  <input type="checkbox" checked={isVisible} onChange={() => toggleLayerVisibility(l.key)} className="accent-blue-600" />
                  {l.label}{l.unit ? ` (${l.unit})` : ''}
                </label>
              );
            })}
          </div>

          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Type</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Charge</th>
                  <th className="px-3 py-2 font-bold border-b border-slate-200">Mass</th>
                  {visibleLayers.map((l) => (
                    <th key={l.key} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">
                      {l.label}{l.unit ? ` (${l.unit})` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.estSeq.map((res, idx) => {
                  if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                  return (res.ffAtoms || []).map((a, aIdx) => {
                    const cellKey = `${idx}-${a.atom}`;
                    const isSel = cellIsSelected(idx, a.atom);
                    return (
                      <tr key={cellKey} className="hover:bg-slate-50 transition-colors">
                        {aIdx === 0 && <td rowSpan={(res.ffAtoms || []).length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">{res.id}</td>}
                        <td className="px-3 py-1.5 font-bold text-slate-600">{a.atom}</td>
                        <td className="px-3 py-1.5 text-purple-700 font-bold">{a.type}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{a.charge}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-600">{a.mass}</td>
                        {visibleLayers.map((l) => {
                          const val = (layerValuesByKey[l.key] || {})[cellKey] || '';
                          const hasVal = parseMDValue(val) !== null;
                          return (
                            <td key={l.key} className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)}>
                              <input type="text" value={val} onChange={(e) => handleCellChangeForLayer(idx, a.atom, l.key, e.target.value)}
                                className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[140px] ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Type</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Charge</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Mass</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Value {activeLayer.unit ? `(${activeLayer.unit})` : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                return (res.ffAtoms || []).map((a, aIdx) => {
                  const key = `${idx}-${a.atom}`;
                  const isSel = cellIsSelected(idx, a.atom);
                  const hasVal = parseMDValue(d.activeValues[key]) !== null;
                  return (
                    <tr key={key} className="hover:bg-slate-50 transition-colors">
                      {aIdx === 0 && <td rowSpan={(res.ffAtoms || []).length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">{res.id}</td>}
                      <td className="px-3 py-1.5 font-bold text-slate-600">{a.atom}</td>
                      <td className="px-3 py-1.5 text-purple-700 font-bold">{a.type}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{a.charge}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-600">{a.mass}</td>
                      <td className={selTdCls(isSel)} onClick={(e) => handleCellClick(e, idx, a.atom)}>
                        <input type="text" value={d.activeValues[key] || ''} onChange={(e) => handleCellChange(idx, a.atom, e.target.value)}
                          className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[140px] ${hasVal ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mt-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase">🗂️ Parameter Layer (atom-table data type)</label>
          <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Switch between MD Parameters & user-defined per-atom layers</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {d.layers.map((l) => (
            <div key={l.key} className="inline-flex items-center">
              <button type="button" onClick={() => updateActiveTest({ activeLayerKey: l.key })}
                className={`px-3 py-1.5 rounded-l-lg text-xs font-bold border transition-colors ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                {l.label}{l.unit ? ` (${l.unit})` : ''}
              </button>
              {!l.builtin ? (
                <button type="button" onClick={() => removeLayer(l.key)}
                  className={`px-2 py-1.5 rounded-r-lg border border-l-0 text-xs font-black ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-blue-200 hover:text-white' : 'bg-white border-slate-300 text-slate-400 hover:text-red-500'}`} title="Delete parameter">×</button>
              ) : (
                <span className="px-2 py-1.5 rounded-r-lg border border-l-0 bg-slate-100 border-slate-300 text-slate-400 text-xs">🔒</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">New parameter name</label>
            <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="e.g. Order Param, B-factor" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-56 bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
            <input type="text" value={newLayerUnit} onChange={(e) => setNewLayerUnit(e.target.value)} placeholder="e.g. Å²" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-24 bg-white" />
          </div>
          <button type="button" onClick={addLayer} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">+ Add Parameter Layer</button>
        </div>
      </div>
    </div>
  );
};

// ================= 3) ANALYSIS (RMSD / RMSF / Rg / SASA / Energy) =================
const MD_CHART_M_ZOOM = { top: 10, right: 15, bottom: 45, left: 55 };

const MDAnalysisChart = ({ title, data, dataKey = 'value', xKey = 'time', color, cfg, yLabel, xLabel, chartType = 'line', id }) => {
  const fSize = cfg.fontSize || 12;
  const aspect = cfg.aspect || 1.8;
  const lineColor = color || '#3b82f6';
  const chartRef = useRef(null);

  // derive x data domain for zoom
  const xs = data.map(d => typeof d[xKey] === 'number' ? d[xKey] : 0);
  const dataDomain = xs.length > 1 ? [Math.min(...xs), Math.max(...xs)] : [0, 1];
  const zoom = useXZoom(chartRef, dataDomain, MD_CHART_M_ZOOM);

  return (
    <div id={id} className="bg-white rounded-lg border border-slate-200 p-2 flex flex-col relative">
      <div className="flex justify-between items-center mb-1">
        <h5 className="text-[12px] font-bold text-slate-700">{title}</h5>
        {zoom.isZoomed && (
          <button type="button" onClick={zoom.reset} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>
        )}
      </div>
      <div ref={chartRef} onMouseDown={chartType !== 'bar' ? zoom.onMouseDown : undefined} className="flex-1 w-full select-none" style={{ aspectRatio: String(aspect), minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={data} margin={MD_CHART_M_ZOOM}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey={xKey} interval={0} tick={<AngledTick angle={cfg.tickAngle} fontSize={fSize} />} tickMargin={10} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fSize + 1 }} />
              <YAxis width={70} tick={{ fontSize: fSize }} label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fSize + 1 }} />
              <Tooltip />
              <Bar dataKey={dataKey} isAnimationActive={false}>
                {data.map((entry, index) => <Cell key={index} fill={entry.fill || lineColor} />)}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={MD_CHART_M_ZOOM}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow tick={<AngledTick angle={cfg.tickAngle} fontSize={fSize} />} tickMargin={10}
                label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fSize + 1 }} />
              <YAxis type="number" width={70} domain={[mdDom(cfg.yMin) ?? 'auto', mdDom(cfg.yMax) ?? 'auto']} tick={{ fontSize: fSize }}
                label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fSize + 1 }} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke={lineColor} strokeWidth={cfg.lineThickness || 2} strokeDasharray={mdLineDash(cfg.lineStyle)} dot={false} isAnimationActive={false} />
              {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};



// ================= MD PER ATOM PLOT SECTION =================
const MD_PAP_COLORS = PER_ATOM_COLORS;

const MDPerAtomChartPanel = ({ d, chart, updateChart, removeChart }) => {
  const [atomSearch, setAtomSearch] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const layerKey = chart.layerKey || 'md';
  const atoms = chart.atoms || [];
  const cfg = { aspect: 2.5, fontSize: 11, ...(chart.style || {}) };
  const setC = (p) => updateChart(chart.id, p);
  const setCfg = (p) => updateChart(chart.id, { style: { ...cfg, ...p } });

  const layer = d.layers.find(l => l.key === layerKey) || d.layers[0];
  // Collect values from all instances (average across instances, or active instance only)
  const valMap = getMDLayerValues(d.activeInstance, layerKey);

  const atomMeta = atoms.map((k, i) => ({
    key: k,
    label: d.atomOptions.find(o => o.key === k)?.label.split(' ').slice(1).join(' ') || k.split('-').slice(1).join('-'),
    color: MD_PAP_COLORS[i % MD_PAP_COLORS.length],
  }));

  const residueMap = {};
  atoms.forEach(atomKey => {
    const raw = valMap[atomKey];
    const val = raw !== undefined && raw !== '' ? parseFloat(raw) : NaN;
    if (isNaN(val)) return;
    const resIdx = atomKey.split('-')[0];
    const res = d.estSeq[Number(resIdx)];
    if (!res) return;
    if (!residueMap[res.id]) residueMap[res.id] = { label: res.id };
    residueMap[res.id][atomKey] = val;
  });
  const chartData = Object.values(residueMap).filter(r => Object.keys(r).length > 1);
  const filtered = d.atomOptions.filter(o => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (k) => setC({ atoms: atoms.includes(k) ? atoms.filter(a => a !== k) : [...atoms, k] });

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 ${isFs ? CHART_FS_CLASSES : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="text" value={chart.title || ''} onChange={e => setC({ title: e.target.value })}
          placeholder="Chart title…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 bg-transparent flex-1 min-w-[140px]" />
        <div className="flex gap-2 items-center">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)}
                           showFs={isFs} onToggleFs={() => setIsFs(v => !v)} className="flex gap-2" />
          <button onClick={() => removeChart(chart.id)} className="text-xs bg-red-50 border border-red-200 px-2 py-1 rounded font-bold text-red-600 hover:bg-red-100">🗑</button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-slate-500 uppercase">Parameter:</span>
        {d.layers.map(l => (
          <button key={l.key} onClick={() => setC({ layerKey: l.key })}
            className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-colors ${l.key === layerKey ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {l.label}{l.unit ? ` (${l.unit})` : ''}
          </button>
        ))}
      </div>
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} showHeightSlider={false} />}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Atoms ({atoms.length} selected):</span>
          <input type="text" value={atomSearch} onChange={e => setAtomSearch(e.target.value)} placeholder="Filter…" className="border border-slate-200 rounded px-2 py-1 text-xs flex-1 outline-none focus:border-blue-400" />
          {atoms.length > 0 && <button onClick={() => setC({ atoms: [] })} className="text-xs text-red-500 hover:underline font-bold">Clear</button>}
        </div>
        <div className="max-h-28 overflow-y-auto flex flex-wrap gap-1 bg-slate-50 rounded p-2">
          {filtered.map(o => (
            <button key={o.key} onClick={() => toggleAtom(o.key)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${atoms.includes(o.key) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
              {o.label}
            </button>
          ))}
        </div>
        {atoms.length > 0 && (
          <div className="flex flex-wrap gap-1">{atomMeta.map(m => (
            <span key={m.key} style={{ background: m.color }} className="text-[10px] text-white font-bold px-2 py-0.5 rounded-full">{m.label}</span>
          ))}</div>
        )}
      </div>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: layer?.unit || '', angle: -90, position: 'insideLeft', style: { fontSize: cfg.fontSize } }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
            {atomMeta.map(m => <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          {atoms.length === 0 ? 'Select atoms above to plot.' : 'No data for selected atoms in this layer.'}
        </div>
      )}
    </div>
  );
};

const MDPerAtomPlotSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);
  const charts = Array.isArray(activeTest.mdPerAtomCharts) ? activeTest.mdPerAtomCharts : [];
  const addChart = () => {
    const n = charts.length + 1;
    const id = `mdpap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    updateActiveTest({ mdPerAtomCharts: [...charts, { id, title: `Chart ${n}`, layerKey: 'md', atoms: [], style: {} }] });
  };
  const updateChart = (id, patch) => updateActiveTest({ mdPerAtomCharts: charts.map(c => c.id === id ? { ...c, ...patch } : c) });
  const removeChart = (id) => updateActiveTest({ mdPerAtomCharts: charts.filter(c => c.id !== id) });

  if (d.parsedSeq.length === 0) return <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">Enter a sequence in Experiment Setup to enable per-atom charts.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Per-Atom Parameter Charts</span>
        <button onClick={addChart} className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors">+ Add Chart</button>
      </div>
      {charts.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          Click "+ Add Chart" to plot any MD parameter (RMSD, charge, mass…) per atom/residue.
        </div>
      )}
      {charts.map(chart => (
        <MDPerAtomChartPanel key={chart.id} d={d} chart={chart} updateChart={updateChart} removeChart={removeChart} activeTest={activeTest} />
      ))}
    </div>
  );
};

// ================= MD CONDITION PLOT SECTION =================
// Plot MD parameter values vs. simulation conditions (across instances)
const MD_COND_FIELDS = [
  { key: 'simTemperature', label: 'Temperature (K)' },
  { key: 'simPressure', label: 'Pressure (bar)' },
  { key: 'timestep', label: 'Timestep (fs)' },
  { key: 'nSteps', label: 'Steps' },
];

const MDConditionPlotPanel = ({ d, chart, updateChart, removeChart, activeTest }) => {
  const [atomSearch, setAtomSearch] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const atoms = chart.atoms || [];
  const layerKey = chart.layerKey || 'md';
  const xField = chart.xField || 'simTemperature';
  const cfg = { aspect: 2.5, fontSize: 11, ...(chart.style || {}) };
  const setC = (p) => updateChart(chart.id, p);
  const setCfg = (p) => updateChart(chart.id, { style: { ...cfg, ...p } });
  const layer = d.layers.find(l => l.key === layerKey) || d.layers[0];
  const filtered = d.atomOptions.filter(o => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (k) => setC({ atoms: atoms.includes(k) ? atoms.filter(a => a !== k) : [...atoms, k] });

  // Build line chart data: for each instance, get x = condition value, y = atom value
  const series = atoms.map((ak, i) => {
    const pts = d.instances
      .map(inst => {
        const vals = getMDLayerValues(inst, layerKey);
        const y = vals[ak] !== undefined && vals[ak] !== '' ? parseFloat(vals[ak]) : NaN;
        const xRaw = inst.values?.[xField] ?? activeTest[xField];
        const x = xRaw !== undefined && xRaw !== '' ? parseFloat(xRaw) : NaN;
        return { x, y, name: inst.name };
      })
      .filter(p => !isNaN(p.x) && !isNaN(p.y))
      .sort((a, b) => a.x - b.x);
    return {
      key: ak,
      label: d.atomOptions.find(o => o.key === ak)?.label.split(' ').slice(1).join(' ') || ak,
      color: MD_PAP_COLORS[i % MD_PAP_COLORS.length],
      pts,
    };
  }).filter(s => s.pts.length > 0);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 ${isFs ? CHART_FS_CLASSES : ''}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <input type="text" value={chart.title || ''} onChange={e => setC({ title: e.target.value })}
          placeholder="Plot title…" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-500 bg-transparent flex-1 min-w-[140px]" />
        <div className="flex gap-2 items-center">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)}
                           showFs={isFs} onToggleFs={() => setIsFs(v => !v)} className="flex gap-2" />
          <button onClick={() => removeChart(chart.id)} className="text-xs bg-red-50 border border-red-200 px-2 py-1 rounded font-bold text-red-600 hover:bg-red-100">🗑</button>
        </div>
      </div>
      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} showHeightSlider={false} />}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter (Y)</label>
          <select value={layerKey} onChange={e => setC({ layerKey: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            {d.layers.map(l => <option key={l.key} value={l.key}>{l.label}{l.unit ? ` (${l.unit})` : ''}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">X axis (Condition)</label>
          <select value={xField} onChange={e => setC({ xField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
            {MD_COND_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Atoms ({atoms.length} selected):</span>
          <input type="text" value={atomSearch} onChange={e => setAtomSearch(e.target.value)} placeholder="Filter…" className="border border-slate-200 rounded px-2 py-1 text-xs flex-1 outline-none focus:border-blue-400" />
          {atoms.length > 0 && <button onClick={() => setC({ atoms: [] })} className="text-xs text-red-500 hover:underline font-bold">Clear</button>}
        </div>
        <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1 bg-slate-50 rounded p-2">
          {filtered.map(o => (
            <button key={o.key} onClick={() => toggleAtom(o.key)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${atoms.includes(o.key) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {series.length > 0 ? (
        <ResponsiveContainer width="100%" aspect={cfg.aspect}>
          <LineChart margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" allowDuplicatedCategory={false} tick={{ fontSize: cfg.fontSize }}
              label={{ value: MD_COND_FIELDS.find(f => f.key === xField)?.label || xField, position: 'insideBottom', offset: -16, fill: '#64748b', fontSize: cfg.fontSize }} />
            <YAxis tick={{ fontSize: cfg.fontSize }} label={{ value: layer?.unit || '', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: cfg.fontSize }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: cfg.fontSize }} />
            {series.map(s => (
              <Line key={s.key} data={s.pts} dataKey="y" name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          {atoms.length === 0 ? 'Select atoms above.' : d.instances.length < 2 ? 'Add multiple simulation instances with different conditions to compare.' : 'No numeric data for selected atoms across instances.'}
        </div>
      )}
    </div>
  );
};

const MDConditionPlotSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);
  const charts = Array.isArray(activeTest.mdConditionCharts) ? activeTest.mdConditionCharts : [];
  const addChart = () => {
    const n = charts.length + 1;
    const id = `mdcp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    updateActiveTest({ mdConditionCharts: [...charts, { id, title: `Condition Plot ${n}`, layerKey: 'md', xField: 'simTemperature', atoms: [], style: {} }] });
  };
  const updateChart = (id, patch) => updateActiveTest({ mdConditionCharts: charts.map(c => c.id === id ? { ...c, ...patch } : c) });
  const removeChart = (id) => updateActiveTest({ mdConditionCharts: charts.filter(c => c.id !== id) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Condition Plots</span>
          <p className="text-[10px] text-slate-400 mt-0.5">Plot MD parameter values vs. simulation conditions across instances.</p>
        </div>
        <button onClick={addChart} className="text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-colors">+ Add Plot</button>
      </div>
      {charts.length === 0 && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center text-xs text-slate-400">
          Click "+ Add Plot" to compare parameter values across simulation instances (different temperatures, pressures…).
        </div>
      )}
      {charts.map(chart => (
        <MDConditionPlotPanel key={chart.id} d={d} chart={chart} updateChart={updateChart} removeChart={removeChart} activeTest={activeTest} />
      ))}
    </div>
  );
};


export const MDAnalysisSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const cfg = { ...DEFAULT_MD_CHART_STYLE, ...(activeTest.mdAnalysisCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ mdAnalysisCfg: { ...cfg, ...patch } });
  const [showCfg, setShowCfg] = useState(false);
  const [isFs, setIsFs] = useState(false);
  
  // State for data CALCULATED from the loaded trajectory (real data only —
  // simulated fallbacks have been removed). Restored from the persisted
  // mdAnalysisResult so the graphs survive leaving the page / closing the section.
  const [calcData, setCalcData] = useState(() => (activeTest && activeTest.mdAnalysisResult) || null);
  const [calc, setCalc] = useState({ state: 'idle', msg: '', done: 0, total: 0, error: '' });
  const [calcOpts, setCalcOpts] = useState({ sasa: true });
  const calcAbortRef = useRef(false); // set by the global ⏹ Stop button
  const [energyData, setEnergyData] = useState(() => (activeTest && activeTest.mdAnalysisResult && activeTest.mdAnalysisResult.energy) || null);
  const [energyFileName, setEnergyFileName] = useState(() => (activeTest && activeTest.mdAnalysisResult && activeTest.mdAnalysisResult.energyFileName) || '');

  // If the section stays mounted while the user switches to a different MD test,
  // reload the persisted result for the new test (state is otherwise stable for
  // the lifetime of this mount).
  const mdTestIdRef = useRef(activeTest && activeTest.id);
  useEffect(() => {
    if ((activeTest && activeTest.id) === mdTestIdRef.current) return;
    mdTestIdRef.current = activeTest && activeTest.id;
    const res = (activeTest && activeTest.mdAnalysisResult) || null;
    setCalcData(res);
    setEnergyData((res && res.energy) || null);
    setEnergyFileName((res && res.energyFileName) || '');
    setCalc({ state: 'idle', msg: '', done: 0, total: 0, error: '' });
  }, [activeTest]);

  const handleCalculateFromTrajectory = async () => {
    calcAbortRef.current = false;
    const unregister = abortControl.register('MD analysis', () => { calcAbortRef.current = true; });
    try {
      setCalc({ state: 'running', msg: 'Resolving topology…', done: 0, total: 0, error: '' });
      mdAnalysisRunAll.setStatus('general', 'MD general parameters — resolving topology…');
      const tl = await resolveMDTopology(activeTest);
      if (!tl) throw new Error('Upload the simulation topology (.gro/.pdb — same atom order as the trajectory). Use "Choose PDB/CIF" in the 3D viewer, or a PDB ID / URL.');
      const { topo } = tl;
      const jobs = await buildMDTrajectoryJobs(activeTest, []);
      if (jobs.length === 0) throw new Error('Load a trajectory (.xtc/.trr/.dcd) in the 3D viewer first.');
      const runCfg = mdAnalysisRunAll.getCfg(); // shared stride / max frames from the Data Analysis toolbar
      const src = await resolveFrameSource(jobs[0].file, {
        topoAtoms: topo.atoms, topologyBox: topo.box,
        maxFrames: runCfg.maxFrames || 0,
        onStatus: (m) => { setCalc((s) => ({ ...s, msg: m })); mdAnalysisRunAll.setStatus('general', `MD general parameters — ${m}`); },
      });
      if (!src) throw new Error(`"${jobs[0].file.name}": unsupported format, or the topology could not anchor it (XTC/DCD need the exact matching topology; TRR works standalone).`);
      const res = await computeMDTrajectoryAnalysis(
        topo, src.frames,
        { stride: runCfg.stride, maxFrames: runCfg.maxFrames, doSasa: calcOpts.sasa, doRg: true, renumber: activeTest.resRenumber || {}, isAborted: () => calcAbortRef.current },
        (p) => { setCalc((s) => ({ ...s, done: p.done, total: p.total, msg: p.msg })); mdAnalysisRunAll.setStatus('general', `MD general parameters — ${p.msg}`); }
      );
      if (calcAbortRef.current) { unregister(); setCalc({ state: 'idle', msg: 'Calculation cancelled.', done: 0, total: 0, error: '' }); return; }
      setCalcData(res);
      // Persist a bounded copy of the result so the charts survive leaving the
      // page (and so the Lab Notebook can render them as vector SVG). Stored in
      // activeTest — small, and compresses well in the Firestore payload.
      const prevRes = (activeTest && activeTest.mdAnalysisResult) || {};
      updateActiveTest({
        mdAnalysisResult: {
          rmsd: downsampleSeries(res.rmsd || []),
          rmsf: res.rmsf || [],
          rg: downsampleSeries(res.rg || []),
          sasa: downsampleSeries(res.sasa || []),
          energy: prevRes.energy || [],
          energyFileName: prevRes.energyFileName || '',
          nFrames: res.nFrames,
          source: src.source,
        }
      });
      // Populate the per-atom table so Per-Atom and Condition plots can use the
      // calculated parameters (RMSF per residue + system-level Rg/SASA/RMSD).
      const layerCells = buildGeneralParamsLayerCells(res);
      storeAnalysisToAtomTable(activeTest, updateActiveTest, layerCells);
      setCalc({ state: 'done', msg: `Calculated from ${res.nFrames} frames (${src.source}) — values added to the per-atom table.`, done: 0, total: 0, error: '' });
    } catch (err) {
      if (isAbortError(err)) {
        setCalc((s) => ({ ...s, state: 'idle', msg: 'Calculation cancelled.', done: 0, total: 0, error: '' }));
      } else {
        setCalc((s) => ({ ...s, state: 'error', error: err?.message || String(err) }));
      }
    } finally {
      unregister();
      calcAbortRef.current = false;
      mdAnalysisRunAll.clearStatus('general');
    }
  };

  const handleEnergyFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    archiveFileToDrive({ file, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Analysis', subsection: 'Energy', suffix: 'energy' } }).catch(() => {});
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseEnergyFile(ev.target.result);
        setEnergyData(parsed);
        setEnergyFileName(file.name);
        // Persist the (bounded) energy series so it survives page navigation too.
        const prevRes = (activeTest && activeTest.mdAnalysisResult) || {};
        updateActiveTest({
          mdAnalysisResult: {
            ...prevRes,
            energy: downsampleSeries(parsed || []),
            energyFileName: file.name,
          }
        });
      } catch (err) {
        setCalc((s) => ({ ...s, state: 'error', error: 'Energy file: ' + err.message }));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // The ⚡ "Calculate all analyses" button (Data Analysis toolbar) runs every
  // analysis subsection. A ref keeps the subscription current without re-binding.
  const runAllFnRef = useRef(() => handleCalculateFromTrajectory());
  runAllFnRef.current = () => handleCalculateFromTrajectory();
  useEffect(() => mdAnalysisRunAll.subscribeRun(() => runAllFnRef.current()), []);

  // Real data calculated from the loaded trajectory only — no simulated fallbacks.
  const rmsd = useMemo(() => downsampleSeries(calcData?.rmsd || []), [calcData]);
  const rmsf = useMemo(() => (calcData?.rmsf || []).map((r) => ({ ...r, fill: r.value > 0.25 ? '#ef4444' : '#3b82f6' })), [calcData]);
  const rg = useMemo(() => downsampleSeries(calcData?.rg || []), [calcData]);
  const sasa = useMemo(() => downsampleSeries(calcData?.sasa || []), [calcData]);
  const energy = useMemo(() => downsampleSeries(energyData || []), [energyData]);

  return (
    <div className={`flex flex-col gap-4 ${isFs ? CHART_FS_CLASSES : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)}
                           showFs={isFs} onToggleFs={() => setIsFs((v) => !v)} className="flex gap-2" />
        </div>
      </div>

      {/* ── Calculate the general parameters from the loaded trajectory ── */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCalculateFromTrajectory}
            disabled={calc.state === 'running'}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2"
          >
            ⚙️ {calc.state === 'running' ? 'Calculating…' : 'Calculate from trajectory'}
          </button>
          <span className="text-[10px] text-indigo-600 font-bold">
            Uses the shared stride / max frames from the “⚡ Calculate all analyses” toolbar above.
          </span>
          {calcData && (
            <button
              type="button"
              onClick={() => storeAnalysisToAtomTable(activeTest, updateActiveTest, buildGeneralParamsLayerCells(calcData))}
              className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2"
              title="Writes the calculated RMSF / Rg / SASA / RMSD into the per-atom table as new columns (analysis_* layers), so Per-Atom and Condition plots can graph them."
            >
              📥 Import per-atom values into data table
            </button>
          )}
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-700 uppercase cursor-pointer">
            <input type="checkbox" checked={calcOpts.sasa}
              onChange={(e) => setCalcOpts((o) => ({ ...o, sasa: e.target.checked }))}
              className="w-4 h-4 accent-indigo-600" />
            SASA (slower)
          </label>
          <label className="bg-white hover:bg-slate-50 border border-indigo-300 text-indigo-700 font-bold py-1.5 px-3 rounded-lg text-xs cursor-pointer shadow-sm transition-colors flex items-center gap-1.5"
            title="XTC/TRR contain no energies — load gmx energy -o output (.xvg) or a time/value file">
            ⚡ Energy file (.xvg/.dat)
            <input type="file" accept=".xvg,.dat,.txt,.log" className="hidden" onChange={handleEnergyFile} />
          </label>
          <div className="mt-1">
            <DriveUploadButton
              suggestedName={suggestDriveFileName({
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || activeTest.instanceName || '',
                section: 'Analysis',
                subsection: 'Energy',
                suffix: 'energy'
              })}
              naming={{
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || activeTest.instanceName || '',
                section: 'Analysis',
                subsection: 'Energy',
                suffix: 'energy'
              }}
              accept=".xvg,.dat,.txt,.log"
              preloadedFile={null}
              label="⬆ Archive energy file to Drive"
              className="bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
            />
          </div>
          {energyFileName && (
            <span className="text-[10px] text-indigo-600 font-bold max-w-[160px] truncate">⚡ {energyFileName}</span>
          )}
        </div>
        {calc.state === 'running' && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-white rounded-full overflow-hidden border border-indigo-200">
              <div className="h-full bg-indigo-500 transition-all" style={{ width: calc.total > 0 ? `${Math.min(100, (calc.done / calc.total) * 100)}%` : '10%' }} />
            </div>
            <span className="text-[10px] font-bold text-indigo-700 whitespace-nowrap">{calc.msg}</span>
          </div>
        )}
        {calc.state === 'error' && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold p-2 rounded-lg">⚠️ {calc.error}</div>
        )}
        {calc.state === 'done' && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-2 rounded-lg">✅ {calc.msg}</div>
        )}
      </div>

      {calcData ? (
         <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold p-2 rounded-lg flex items-center gap-2">
           ✅ Plotting data calculated from the trajectory (RMSD/RMSF/Rg/SASA).
         </div>
      ) : (
         <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 w-fit">
           No analysis yet — click “Calculate from trajectory” below (or ⚡ Calculate all analyses above) to compute the real curves from the loaded XTC.
         </span>
      )}

      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setCfg} series={[]} />}

      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">Enter a sequence in Experiment Setup to enable trajectory charts.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MDAnalysisChart id="md-rmsd" title="RMSD (backbone)" data={rmsd} cfg={cfg} color="#3b82f6" yLabel="nm" xLabel="Time (ns)" />
          <MDAnalysisChart id="md-rmsf" title="RMSF per residue" data={rmsf} xKey="residue" cfg={cfg} color="#3b82f6" yLabel="nm" xLabel="Residue" chartType="bar" />
          <MDAnalysisChart id="md-rg" title="Radius of Gyration (Rg)" data={rg} cfg={cfg} color="#22c55e" yLabel="nm" xLabel="Time (ns)" />
          <MDAnalysisChart id="md-sasa" title="SASA" data={sasa} cfg={cfg} color="#f59e0b" yLabel="nm²" xLabel="Time (ns)" />
        </div>
      )}
      
      {d.parsedSeq.length > 0 && (
        <div id="md-energy" className="bg-white rounded-lg border border-slate-200 p-3">
          <h5 className="text-xs font-bold text-slate-700 mb-1">Energy</h5>
          {energy.length === 0 && (
            <div className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
              XTC/TRR trajectories carry no energies — load a <code>gmx energy -o</code> output (.xvg/.dat) above to plot them.
            </div>
          )}
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={energy} margin={{ top: 5, right: 10, bottom: 25, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={<AngledTick angle={cfg.tickAngle} fontSize={10} />} tickMargin={10} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="potential" stroke="#ef4444" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="kinetic" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

    </div>
  );
};
// ================= 4) SIMULATION PARAMETERS =================
export const MDSimulationParamsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  const ffVersions = getFFVersions(d.ffKey);

  return (
    <div className="space-y-6 p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
      <h2 className="text-lg font-bold text-slate-800 border-b pb-2">⚙️ Simulation Parameters</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Force Field */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Force Field</label>
          <select 
            value={d.ffKey} 
            onChange={(e) => updateActiveTest({ forceField: e.target.value, forceFieldVersion: getFFVersions(e.target.value)[0] || '' })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {Object.keys(FORCE_FIELDS).map(k => <option key={k} value={k}>{FORCE_FIELDS[k].name}</option>)}
          </select>
          {ffVersions.length > 1 && (
            <select
              value={d.ffVersion}
              onChange={(e) => updateActiveTest({ forceFieldVersion: e.target.value })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 mt-2"
            >
              {ffVersions.map(v => <option key={v} value={v}>Version: {v}</option>)}
            </select>
          )}
        </div>

        {/* Water Model */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Water Model</label>
          <select 
            value={d.waterModel} 
            onChange={(e) => updateActiveTest({ waterModel: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {Object.keys(WATER_MODELS).map(k => <option key={k} value={k}>{WATER_MODELS[k].name}</option>)}
          </select>
        </div>

        {/* Ensemble */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Ensemble</label>
          <select 
            value={d.ensemble} 
            onChange={(e) => updateActiveTest({ ensemble: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_ENSEMBLES.map(e => <option key={e.key} value={e.key} title={e.description}>{e.label}</option>)}
          </select>
        </div>

        {/* Integrator */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Integrator</label>
          <select 
            value={d.integrator} 
            onChange={(e) => updateActiveTest({ integrator: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_INTEGRATORS.map(i => <option key={i.key} value={i.key} title={i.label}>{i.label}</option>)}
          </select>
        </div>

        {/* Thermostat */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Thermostat</label>
          <select 
            value={d.thermostat} 
            onChange={(e) => updateActiveTest({ thermostat: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_THERMOSTATS.map(t => <option key={t.key} value={t.key} title={t.label}>{t.label}</option>)}
          </select>
        </div>

        {/* Barostat */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Barostat</label>
          <select 
            value={d.barostat} 
            onChange={(e) => updateActiveTest({ barostat: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {MD_BAROSTATS.map(b => <option key={b.key} value={b.key} title={b.label}>{b.label}</option>)}
          </select>
        </div>
      </div>

      <h3 className="text-md font-bold text-slate-700 mt-6 border-b pb-2">🌡️ Physical Conditions & Duration</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Temperature (K)</label>
          <input 
            type="number" 
            value={activeTest.simTemperature ?? 300} 
            onChange={(e) => updateActiveTest({ simTemperature: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Pressure (bar)</label>
          <input 
            type="number" 
            step="0.1"
            value={activeTest.simPressure ?? 1.0} 
            onChange={(e) => updateActiveTest({ simPressure: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Timestep (fs)</label>
          <input 
            type="number" 
            step="0.5"
            value={activeTest.timestep ?? 2} 
            onChange={(e) => updateActiveTest({ timestep: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">Total Steps</label>
          <input 
            type="number" 
            value={activeTest.nSteps ?? 500000} 
            onChange={(e) => updateActiveTest({ nSteps: e.target.value })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
      </div>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 mt-4">
        <strong>Estimated Simulation Time:</strong> {((parseMDValue(activeTest.nSteps) || 500000) * (parseMDValue(activeTest.timestep) || 2) / 1000000).toFixed(2)} ns
      </div>
    </div>
  );
};
// ================= 5) MEMBRANE CONTACTS (port of from_gro_to_rdf awk) =================
/* ---------- shared MD analysis sources (local file + web + Drive) ---------- */

// Turn a PDB ID / http(s) URL / Google Drive / Dropbox link into fetchable
// topology candidates (text formats only: .pdb / .gro / .cif).
const getTopologyCandidates = (raw) => {
  const u = String(raw || '').trim();
  if (!u) return [];
  if (/^[0-9a-z]{4}$/i.test(u)) {
    const id = u.toUpperCase();
    return [
      `https://files.rcsb.org/download/${id}.pdb`,
      `https://files.rcsb.org/download/${id}.cif`,
    ];
  }
  if (/^https?:\/\//i.test(u)) {
    const norm = normalizeTrajectoryUrl(u) || {};
    return [norm.url, ...(norm.fallbacks || [])].filter(Boolean);
  }
  return [];
};

// Resolve the MD system topology from a local upload (data URL, set by the
// viewer's "Choose PDB/CIF" button) OR from the web (PDB ID / URL / Drive
// link, set by the viewer's "PDB ID or URL" box). Returns null when nothing
// is available.
const resolveMDTopology = async (activeTest) => {
  let text = null;
  let source = 'local';

  if (activeTest.structureFileData) {
    const b64 = String(activeTest.structureFileData).split(',')[1] || '';
    text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } else {
    for (const url of getTopologyCandidates(activeTest.structureSrc)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        text = await res.text();
        source = 'web';
        break;
      } catch { /* try next candidate */ }
    }
  }

  if (!text) return null;
  const topo = parseTopology(text);
  if (!topo || !Array.isArray(topo.atoms) || topo.atoms.length === 0) return null;
  return { topo, source };
};

// Build the list of trajectory jobs to analyse: local cached File(s) first,
// then a trajectory fetched from the web / Drive URL (set in the setup panel).
const buildMDTrajectoryJobs = async (activeTest, extraRuns) => {
  const jobs = [];
  const runs = Array.isArray(extraRuns) ? extraRuns : [];
  const mainFile = localFileCache.get(activeTest.id)?.trajectory || null;
  if (mainFile) jobs.push({ name: mainFile.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: mainFile });
  runs.forEach((f) => jobs.push({ name: f.name.replace(/\.(xtc|trr|dcd)$/i, ''), file: f }));
  if (jobs.length === 0) {
    const norm = normalizeTrajectoryUrl(activeTest.trajectoryUrl) || {};
    const cands = [norm.url, ...(norm.fallbacks || [])].filter(Boolean);
    for (const url of cands) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const name = (String(url).split(/[?#]/)[0].split('/').pop() || 'trajectory.xtc').toLowerCase();
        jobs.push({
          name: name.replace(/\.(xtc|trr|dcd)$/i, ''),
          file: new File([buf], name, { type: 'application/octet-stream' }),
        });
        break;
      } catch { /* try next candidate */ }
    }
  }
  return jobs;
};

// Store analysis-derived parameters into the per-atom table of the active MD
// instance (as "analysis_*" layers), so the Per-Atom and Condition plots can
// graph them. layerCells = { layerKey: { cellKey: value } }.
const storeAnalysisToAtomTable = (activeTest, updateActiveTest, layerCells) => {
  if (!updateActiveTest || !layerCells) return;
  const activeInst = getMDActiveInstance(activeTest);
  if (!activeInst) return;
  const layers = {};
  Object.entries(layerCells).forEach(([lk, cells]) => {
    if (cells && Object.keys(cells).length) layers[lk] = cells;
  });
  if (Object.keys(layers).length === 0) return;

  const mdValues = { ...(activeTest.mdValues || {}) };
  Object.keys(layers).forEach((lk) => { mdValues[lk] = { ...(mdValues[lk] || {}), ...layers[lk] }; });

  const insts = Array.isArray(activeTest.instances) && activeTest.instances.length ? activeTest.instances : null;
  if (insts) {
    const instances = insts.map((inst) => {
      if (inst.id !== activeInst.id) return inst;
      const vals = { ...(inst.values || {}) };
      Object.keys(layers).forEach((lk) => { vals[lk] = { ...(vals[lk] || {}), ...layers[lk] }; });
      return { ...inst, values: vals };
    });
    updateActiveTest({ instances, mdValues });
  } else {
    updateActiveTest({ mdValues });
  }
};

// Build the per-atom table layers for the MD general parameters: RMSF per
// backbone atom + system-level pseudo-atoms for Rg / SASA / RMSD. Used by
// "Calculate from trajectory" and by the explicit "Import per-atom values into
// data table" button (so the values become selectable columns in Per-Atom and
// Condition plots).
const buildGeneralParamsLayerCells = (res) => {
  const layerCells = {};
  if (res && Array.isArray(res.rmsf)) {
    const cells = {};
    res.rmsf.forEach((row, r) => {
      ['N', 'CA', 'C', 'O'].forEach((atom) => {
        cells[`${r}-${atom}`] = row.value != null ? +row.value.toFixed(4) : '';
      });
    });
    layerCells.analysis_rmsf = cells;
  }
  const avgOf = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    let s = 0, n = 0;
    arr.forEach((p) => { const v = parseFloat(p.value); if (Number.isFinite(v)) { s += v; n++; } });
    return n ? s / n : null;
  };
  const rgAvg = avgOf(res && res.rg);
  const sasaAvg = avgOf(res && res.sasa);
  const rmsdLast = res && res.rmsd && res.rmsd.length ? parseFloat(res.rmsd[res.rmsd.length - 1].value) : null;
  if (Number.isFinite(rgAvg)) layerCells.analysis_rg = { '0-Rg': +rgAvg.toFixed(4) };
  if (Number.isFinite(sasaAvg)) layerCells.analysis_sasa = { '0-SASA': +sasaAvg.toFixed(4) };
  if (Number.isFinite(rmsdLast)) layerCells.analysis_rmsd = { '0-RMSD': +rmsdLast.toFixed(4) };
  return layerCells;
};

// custom recharts dot: draws a coloured symbol per series (awk pt_group style)
const contactDot = (symbol, color) => (props) => {
  const { cx, cy } = props;
  if (cx == null || cy == null) return <g />;
  const fill = color || '#3b82f6';
  const s = 4;
  const shapes = {
    circle: <circle cx={cx} cy={cy} r={s} fill={fill} stroke="none" />,
    square: <rect x={cx - s} y={cy - s} width={2 * s} height={2 * s} fill={fill} />,
    diamond: <rect x={cx - s} y={cy - s} width={2 * s} height={2 * s} fill={fill} transform={`rotate(45 ${cx} ${cy})`} />,
    triangle: <polygon points={`${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`} fill={fill} />,
    'triangle-down': <polygon points={`${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`} fill={fill} />,
    cross: (
      <g stroke={fill} strokeWidth={1.6}>
        <line x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s} />
        <line x1={cx + s} y1={cy - s} x2={cx - s} y2={cy + s} />
      </g>
    ),
    star: (
      <g fill={fill}>
        {[0, 72, 144, 216, 288].map((a) => {
          const x = cx + s * 1.25 * Math.cos((a * Math.PI) / 180);
          const y = cy + s * 1.25 * Math.sin((a * Math.PI) / 180);
          return <circle key={a} cx={x} cy={y} r={s * 0.75} />;
        })}
      </g>
    ),
    hexagon: (
      <polygon fill={fill}
        points={[
          [cx, cy - s], [cx + s * 0.87, cy - s * 0.5], [cx + s * 0.87, cy + s * 0.5],
          [cx, cy + s], [cx - s * 0.87, cy + s * 0.5], [cx - s * 0.87, cy - s * 0.5],
        ].map((p) => p.join(',')).join(' ')} />
    ),
  };
  return <g>{shapes[symbol] || shapes.circle}</g>;
};

const MDContactChart = ({ rows, series, yLabel, cfg }) => {
  const effHeight = useChartFsHeight(cfg.height || 480);
  const ref = useRef(null);
  const fontSize = cfg.fontSize || 9;
  let yMax = 0;
  rows.forEach((r) => series.forEach((s) => { const v = r[s.key]; if (typeof v === 'number' && v > yMax) yMax = v; }));
  const chartData = useMemo(() => rows.map((r, i) => ({ ...r, __xi: i })), [rows]);
  // X-axis drag-to-zoom on the atom axis (horizontal drag selects a range), like the other charts
  const zoom = useXZoom(ref, [0, Math.max(1, rows.length - 1)], { top: 8, right: 8, bottom: 96, left: 8 });
  const ticks = [];
  for (let i = Math.max(0, Math.ceil(zoom.domain[0])); i <= Math.min(rows.length - 1, Math.floor(zoom.domain[1])); i++) ticks.push(i);
  const colorOf = (s, i) => s.color || seriesColorFor(cfg, s.key, i, series.length);
  return (
    <div className="flex flex-col gap-1">
      {zoom.isZoomed && (
        <div className="flex justify-end">
          <button type="button" onClick={zoom.reset} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">↩ Reset Zoom</button>
        </div>
      )}
      <div className="flex gap-3">
        <div ref={ref} onMouseDown={zoom.onMouseDown} style={{ flex: 1, minWidth: 0 }} className="select-none">
          <ResponsiveContainer width="100%" height={effHeight}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 96, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="__xi" type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow
                     ticks={ticks} tickFormatter={(v) => { const r = chartData[Math.round(v)]; return r ? r.atom : ''; }}
                     interval={0} height={100} tick={{ fontSize, angle: -90, textAnchor: 'end' }}
                     label={{ value: cfg.xAxisLabel || 'Atom group', position: 'insideBottom', offset: -76, style: { fontSize: fontSize + 1 } }} />
              <YAxis tick={{ fontSize: fontSize + 1 }} width={70}
                     domain={[mdDom(cfg.yMin) ?? 0, mdDom(cfg.yMax) ?? (yMax || 1)]} allowDataOverflow
                     label={{ value: cfg.yAxisLabel || yLabel, angle: -90, position: 'insideLeft', style: { fontSize: fontSize + 2 } }} />
              <Tooltip />
              {series.map((s, i) => {
                const color = colorOf(s, i);
                return (
                  <Line key={s.key} dataKey={s.key} stroke={color}
                        strokeWidth={cfg.lineThickness || 2} strokeDasharray={mdLineDash(cfg.lineStyle)}
                        dot={cfg.pointStyle === 'none' ? false : contactDot(s.symbol || cfg.pointStyle || 'circle', color)}
                        isAnimationActive={false} />
                );
              })}
              {zoom.refLo !== null && zoom.refHi !== null && (
                <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {cfg.legend !== 'none' && (
          <div className="w-52 shrink-0 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 text-[11px] font-mono bg-white"
               style={{ maxHeight: effHeight }}>
            {series.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5 py-0.5">
                <span className="inline-block w-3 h-3 shrink-0" style={{ background: colorOf(s, i) }} />
                <span className="truncate" title={s.key}>{s.key}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MDMembraneContactSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [cfg, setCfg] = useState({ ...CONTACT_DEFAULTS, mode: 'all' });
  const [extraRuns, setExtraRuns] = useState([]);
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [outputs, setOutputs] = useState(() => {
    // Restore previously-computed contact maps (persisted as mdContactResult) so
    // the 4 graphs are still visible after leaving and re-opening the MD page.
    const p = activeTest.mdContactResult;
    if (!p || typeof p !== 'object' || Object.keys(p).length === 0) return null;
    const out = { polar: {}, vdW: {} };
    Object.entries(p).forEach(([k, v]) => {
      const mode = k.split('_')[0];
      const xa = k.split('_').slice(1).join('_'); // 'peptide' | 'membrane'
      if (out[mode] && v) out[mode][xa] = v;
    });
    return out;
  }); // { polar, apolar }
  const [chartCfg, setChartCfg] = useState({ ...DEFAULT_MD_CHART_STYLE, height: 480, fontSize: 9 });
  // SharedChartStylePanel calls setCfg(patch) — merge into the current object
  // instead of replacing it (a plain useState setter would wipe every other field).
  const setChartCfgMerged = (patch) => setChartCfg((c) => ({ ...(c || {}), ...patch }));

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  // The ⚡ "Calculate all analyses" toolbar button runs this section too.
  const contactRunAllRef = useRef(() => runAll(false));
  contactRunAllRef.current = () => runAll(false);
  useEffect(() => mdAnalysisRunAll.subscribeRun(() => contactRunAllRef.current()), []);

  const metricOf = (p) => (cfg.metric === 'contactFreq' ? p.contactFreq : p.peakRDF);

  const aggregatePairs = (pairs, keySel = (p) => p.mem) => {
    const map = new Map();
    pairs.forEach((p) => {
      const v = metricOf(p);
      const k = keySel(p);
      const e = map.get(k) || { sum: 0, max: -Infinity, n: 0 };
      e.sum += v; e.max = Math.max(e.max, v); e.n++;
      map.set(k, e);
    });
    const out = new Map();
    map.forEach((e, k) => {
      out.set(k, cfg.aggregate === 'max' ? e.max : cfg.aggregate === 'sum' ? e.sum : e.sum / e.n);
    });
    return out;
  };

  const buildOutputFor = (mode, res, xAxis = cfg.xAxis) => {
    const byKey = new Map(res.pairs.map((p) => [`${p.mem}|${p.mol}`, p]));
    const xIsPeptide = xAxis === 'peptide';
    // awk option="inter": X axis = peptide atoms, one curve per membrane atom
    const rowsLabels = xIsPeptide ? res.molLabels : res.memLabels;
    const seriesLabels = xIsPeptide ? res.memLabels : res.molLabels;
    const rows = rowsLabels.map((m) => {
      const row = { atom: m };
      seriesLabels.forEach((s) => {
        const p = xIsPeptide ? byKey.get(`${s}|${m}`) : byKey.get(`${m}|${s}`);
        row[s] = p ? +metricOf(p).toFixed(4) : 0;
      });
      return row;
    });
    return {
      mode: 'atoms', rows, pairs: res.pairs, memLabels: res.memLabels,
      series: seriesLabels.map((k) => xIsPeptide
        ? { key: k, ...contactSeriesStyle(k, mode) }
        : { key: k }),
      nFrames: res.nFramesUsed, molResidues: res.molResidues, xIsPeptide,
      contactMode: mode,
    };
  };

  const buildRunsOutputFor = (mode, labels, seriesVals, xAxis = cfg.xAxis) => {
    const names = Object.keys(seriesVals);
    const rows = labels.map((m) => {
      const row = { atom: m };
      names.forEach((n) => { row[n] = +(seriesVals[n].get(m) || 0).toFixed(4); });
      return row;
    });
    return {
      mode: 'runs', rows, memLabels: labels,
      series: names.map((k) => ({ key: k })),
      nFrames: null, molResidues: [], xIsPeptide: xAxis === 'peptide',
      contactMode: mode,
    };
  };

  // Run the whole pipeline once for a given interaction mode and X-axis choice.
  const runMode = async (mode, useDemo, xAxis = cfg.xAxis) => {
    const tl = await resolveMDTopology(activeTest);
    if (!tl) throw new Error('Upload the simulation topology (.gro/.pdb — same atom order as the trajectory). Use the "Choose PDB/CIF" button in the 3D viewer, or paste a PDB ID / URL / Drive link.');
    const { topo } = tl;
    if (!topo.box) throw new Error('The topology has no box vectors — a .gro file with its final box line (or a PDB CRYST1 line) is required.');

    const shared = mdAnalysisRunAll.getCfg(); // stride / max frames from the Data Analysis toolbar
    const runCfg = { ...cfg, mode, xAxis, stride: shared.stride, maxFrames: shared.maxFrames };
    const openTrajectory = async (file) => {
      const src = await resolveFrameSource(file, {
        topoAtoms: topo.atoms, topologyBox: topo.box,
        onStatus: (m) => { setStatus((s) => ({ ...s, msg: m })); mdAnalysisRunAll.setStatus('contacts', `Membrane contacts — ${m}`); },
      });
      if (!src) throw new Error(`"${file.name}": unsupported format, or no topology available to decode it (.xtc / .dcd need the system topology uploaded; .trr works standalone).`);
      return src; // { frames, numframes, source }
    };

    const jobs = useDemo ? [] : await buildMDTrajectoryJobs(activeTest, extraRuns);

    if (jobs.length === 0) {
      const res = await computeContactRDF(topo, demoFrames(topo, 40), runCfg,
        (p) => setStatus((s) => ({ ...s, msg: `Demo: frame ${p.done}`, done: p.done })));
      return buildOutputFor(mode, res, xAxis);
    }

    if (jobs.length === 1) {
      const { frames, numframes, source } = await openTrajectory(jobs[0].file);
      const total = numframes ? ` / ${numframes}` : '';
      const res = await computeContactRDF(topo, frames, runCfg,
        (p) => setStatus({ state: 'busy', msg: `${jobs[0].name} (${source}): frame ${p.done}${total}`, done: p.done }));
      return buildOutputFor(mode, res, xAxis);
    }

    const seriesVals = {};
    let xLabels = null;
    const keySel = xAxis === 'peptide' ? (p) => p.mol : (p) => p.mem;
    for (const job of jobs) {
      const { frames, numframes, source } = await openTrajectory(job.file);
      const total = numframes ? ` / ${numframes}` : '';
      const res = await computeContactRDF(topo, frames, runCfg,
        (p) => setStatus({ state: 'busy', msg: `${job.name} (${source}): frame ${p.done}${total}`, done: p.done }));
      if (!xLabels) xLabels = xAxis === 'peptide' ? res.molLabels : res.memLabels;
      seriesVals[job.name] = aggregatePairs(res.pairs, keySel);
    }
    return buildRunsOutputFor(mode, xLabels, seriesVals, xAxis);
  };

  const runAll = async (useDemo = false) => {
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    setOutputs(null);
    try {
      const modes = cfg.mode === 'polar' ? ['polar'] : cfg.mode === 'vdW' ? ['vdW'] : ['polar', 'vdW'];
      // Always compute BOTH X-axis orientations (peptide on X and lipid on X),
      // so the subsection shows the 4 requested graphs (polar/apolar × peptide/lipid).
      const xAxes = ['peptide', 'membrane'];
      const out = { polar: {}, vdW: {} };
      for (const mode of modes) {
        for (const xa of xAxes) {
          setStatus((s) => ({ ...s, msg: `Computing ${mode === 'polar' ? 'polar' : 'apolar'} contacts — X axis: ${xa === 'peptide' ? 'peptide' : 'lipid'} atoms…`, done: 0 }));
          mdAnalysisRunAll.setStatus('contacts', `Membrane contacts — computing ${mode === 'polar' ? 'polar' : 'apolar'} contacts, X axis: ${xa === 'peptide' ? 'peptide' : 'lipid'} atoms…`);
          out[mode][xa] = await runMode(mode, useDemo, xa);
        }
      }
      setOutputs(out);
      setStatus({ state: 'done', msg: '', done: 0 });
      mdAnalysisRunAll.clearStatus('contacts');
      // Persist compact copies so the Lab Notebook can render the contact maps
      // as SVG after a reload too (sessionStorage raster images do not survive
      // closing the tab). The heavy `pairs` arrays are dropped — the matrix
      // (rows/series) is all the notebook figure needs.
      const persist = {};
      Object.entries(out).forEach(([mode, byX]) => {
        Object.entries(byX || {}).forEach(([xa, o]) => {
          if (!o) return;
          persist[`${mode}_${xa}`] = {
            rows: o.rows,
            memLabels: o.memLabels,
            series: (o.series || []).map((s) => (typeof s === 'string' ? { key: s } : { key: s.key })),
            nFrames: o.nFrames,
            xIsPeptide: !!o.xIsPeptide,
            contactMode: o.contactMode,
          };
        });
      });
      updateActiveTest({ mdContactResult: persist });
    } catch (e) {
      setStatus({ state: 'error', msg: e.message, done: 0 });
      mdAnalysisRunAll.clearStatus('contacts');
    }
  };

  // Snapshot the contact charts for the Lab Notebook ("Data Analysis" tick).
  useEffect(() => {
    if (!outputs) return;
    const t = setTimeout(() => {
      storeChartSnapshots(activeTest, [
        { id: 'md-contact-polar-peptide', key: 'contactPolar' },
        { id: 'md-contact-apolar-peptide', key: 'contactApolar' }
      ]);
    }, 600);
    return () => clearTimeout(t);
  }, [outputs]);

  const exportCSV = () => {
    if (!outputs) return;
    Object.entries(outputs).forEach(([mode, byX]) => {
      Object.entries(byX || {}).forEach(([xa, out]) => {
        if (!out) return;
        const head = [out.xIsPeptide ? 'Peptide atom' : 'Membrane atom', ...out.series.map((s) => s.key)];
        const body = out.rows.map((r) => [r.atom, ...out.series.map((s) => r[s.key] ?? '')]);
        const csv = [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url; a.download = `membrane_contacts_${mode}_${xa}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    });
  };

  const yLabelFor = (mode) => (cfg.metric === 'contactFreq'
    ? `Contact frequency (fraction of frames, r < ${cfg.rMax} nm)`
    : mode === 'vdW' ? 'Apolar contact recurrence' : 'Polar contact recurrence');

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
        In-browser port of <span className="font-mono">from_gro_to_rdf-new-colors-r6.awk</span> (option=inter):
        for every membrane atom, the maximum of g(r) inside the {cfg.rMin}–{cfg.rMax} nm shell
        (gmx rdf, bin {cfg.bin} nm) against the molecule — the "contact recurrence" plot of Figures_CHD.pdf (p. 8).
        Upload the system topology (.gro) in the 3D panel plus a trajectory: <b>.xtc / .dcd</b> are decoded in-browser
        via the NGL library (the same one the 3D viewer uses), <b>.trr</b> is parsed natively.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Charts
          <select value={cfg.mode} onChange={(e) => setOpt('mode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="all">Both — Polar + Apolar (2 charts)</option>
            <option value="polar">Polar only (O/N/S, awk vdW=no)</option>
            <option value="vdW">Apolar only (vdW carbons, awk vdW=yes)</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">X axis
          <select value={cfg.xAxis} onChange={(e) => setOpt('xAxis', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="lipid">Membrane (lipid) atoms</option>
            <option value="peptide">Peptide atoms (awk inter)</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Metric
          <select value={cfg.metric} onChange={(e) => setOpt('metric', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="peakRDF">Peak RDF in window (awk)</option>
            <option value="contactFreq">Contact frequency (frames)</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">r min (nm)
          <input type="number" step="0.01" value={cfg.rMin} onChange={(e) => setOpt('rMin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">r max (nm)
          <input type="number" step="0.01" value={cfg.rMax} onChange={(e) => setOpt('rMax', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Bin (nm)
          <input type="number" step="0.001" value={cfg.bin} onChange={(e) => setOpt('bin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <span className="text-[10px] text-slate-400 font-bold w-full">Stride &amp; max frames are set in the “⚡ Calculate all analyses” toolbar at the top of Data Analysis.</span>
        <label className="text-xs font-bold text-slate-600">Molecule residue(s)
          <input value={cfg.molResidues} onChange={(e) => setOpt('molResidues', e.target.value)} placeholder="auto" className={`${inp} block mt-1 w-32 font-mono`} />
        </label>
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 pb-2">
          <input type="checkbox" checked={cfg.includeIons} onChange={(e) => setOpt('includeIons', e.target.checked)} className="accent-blue-600" />
          include ions
        </label>
        <label className="text-xs font-bold text-slate-600">Run aggregation
          <select value={cfg.aggregate} onChange={(e) => setOpt('aggregate', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="max">max over molecule atoms</option>
            <option value="mean">mean</option>
            <option value="sum">sum</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute contacts
        </button>
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay (like POPC+CHD(1)…(3))
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => { const _files = Array.from(e.target.files || []); setExtraRuns(_files); _files.forEach((_f) => archiveFileToDrive({ file: _f, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Analysis', subsection: 'Trajectory', suffix: 'trajectory' } }).catch(() => {})); }} />
        </label>
        <div className="mt-1">
          <DriveUploadButton
            suggestedName={suggestDriveFileName({
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            })}
            naming={{
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            }}
            accept=".xtc,.trr,.dcd"
            label="⬆ Archive to Drive"
            className="bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
          />
        </div>
        {extraRuns.length > 0 && (
          <span className="text-xs text-slate-500 font-mono">{extraRuns.map((f) => f.name).join(', ')}</span>
        )}
        {outputs && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-blue-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {outputs && (
        <div className="flex flex-col gap-6">
          {(['polar', 'vdW'])
            .filter((m) => outputs[m] && Object.keys(outputs[m]).length)
            .map((m) => (
              ['peptide', 'membrane']
                .filter((xa) => outputs[m][xa])
                .map((xa) => {
                  const o = outputs[m][xa];
                  return (
                    <ChartPanel
                      key={`${m}-${xa}`}
                      title={`${m === 'polar' ? 'Polar contacts' : 'Apolar (van der Waals) contacts'} — X axis: ${xa === 'peptide' ? 'peptide' : 'lipid'} atoms`}
                      icon="🫧"
                      cfgPanel={(
                        <div className="flex flex-col gap-3">
                          <SharedChartStylePanel cfg={chartCfg} setCfg={setChartCfgMerged}
                                                 series={(o.series || []).map((s, i) => ({ key: s.key, label: s.key, color: s.color || AWK_PALETTE[i % AWK_PALETTE.length] }))}
                                                 showHeightSlider={false} />
                          <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                            Chart height — {chartCfg.height}px
                            <input type="range" min="260" max="900" step="10" value={chartCfg.height}
                                   onChange={(e) => setChartCfg((c) => ({ ...c, height: parseInt(e.target.value) }))} className="accent-blue-600" />
                          </label>
                        </div>
                      )}>
                      <div className="text-xs text-slate-500 font-semibold mb-2">
                        {o.nFrames ? `${o.nFrames} frames analysed · ` : ''}
                        {o.series.length} series · {o.rows.length} {o.xIsPeptide ? 'peptide' : 'membrane'} atom groups
                        {o.molResidues?.length ? ` · molecule residue(s): ${o.molResidues.join(', ')}` : ''}
                      </div>
                      <div id={`md-contact-${m === 'polar' ? 'polar' : 'apolar'}-${xa}`}>
                        <MDContactChart rows={o.rows} series={o.series} yLabel={yLabelFor(m)} cfg={chartCfg} />
                      </div>
                    </ChartPanel>
                  );
                })
            ))}
        </div>
      )}
    </div>
  );
};

// ================= 6) ORDER PARAMETERS & MEMBRANE PROFILES =================

const MDProfileChart = ({ rows, series, xKey, yLabel, xLabel, height = 380, rotateX = false, numericX = false, fontSize = 10, cfg = {} }) => {
  const effHeight = useChartFsHeight(height || cfg.height || 380);
  const ref = useRef(null);
  const fSize = cfg.fontSize || fontSize || 10;
  const colorOf = (s, i) => s.color || seriesColorFor(cfg, s.key, i, series.length);
  const xVals = rows.map((r) => (typeof r[xKey] === 'number' ? r[xKey] : NaN)).filter(Number.isFinite);
  const xDomain = xVals.length > 1 ? [Math.min(...xVals), Math.max(...xVals)] : [0, 1];
  // X-axis drag-to-zoom in every case (horizontal drag selects an X range).
  // For a categorical X axis we zoom over the row index, so the axis is rendered numeric.
  const chartData = useMemo(() => (numericX ? rows : rows.map((r, i) => ({ ...r, __xi: i }))), [rows, numericX]);
  const zoom = useXZoom(ref, numericX ? xDomain : [0, Math.max(1, rows.length - 1)], { top: 8, right: 8, bottom: rotateX ? 90 : 36, left: 8 });
  const onMouseDown = zoom.onMouseDown;
  const isZoomed = zoom.isZoomed;
  const reset = zoom.reset;
  const catTicks = [];
  if (!numericX) {
    for (let i = Math.max(0, Math.ceil(zoom.domain[0])); i <= Math.min(rows.length - 1, Math.floor(zoom.domain[1])); i++) catTicks.push(i);
  }
  return (
    <div className="flex flex-col gap-1">
      {isZoomed && reset && (
        <div className="flex justify-end">
          <button type="button" onClick={reset} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">↩ Reset Zoom</button>
        </div>
      )}
      <div className="flex gap-3">
        <div ref={ref} onMouseDown={onMouseDown} style={{ flex: 1, minWidth: 0 }} className="select-none">
          <ResponsiveContainer width="100%" height={effHeight}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: rotateX ? 90 : 36, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              {numericX ? (
                <XAxis dataKey={xKey} type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow tick={{ fontSize: fSize }}
                       label={{ value: cfg.xAxisLabel || xLabel, position: 'insideBottom', offset: -18, style: { fontSize: fSize + 1 } }} />
              ) : (
                <XAxis dataKey="__xi" type="number" domain={[zoom.domain[0], zoom.domain[1]]} allowDataOverflow
                       ticks={catTicks} tickFormatter={(v) => { const r = chartData[Math.round(v)]; return r ? r[xKey] : ''; }}
                       interval={0} height={rotateX ? 100 : 40}
                       tick={{ fontSize: rotateX ? fSize - 1 : fSize, angle: rotateX ? -90 : 0, textAnchor: rotateX ? 'end' : 'middle' }} />
              )}
              <YAxis tick={{ fontSize: fSize + 1 }} width={70}
                     domain={[mdDom(cfg.yMin) ?? 'auto', mdDom(cfg.yMax) ?? 'auto']}
                     label={{ value: cfg.yAxisLabel || yLabel, angle: -90, position: 'insideLeft', style: { fontSize: fSize + 2 } }} />
              <Tooltip />
              {series.map((s, i) => (
                <Line key={s.key} dataKey={s.key} stroke={colorOf(s, i)}
                      strokeWidth={cfg.lineThickness || 2} strokeDasharray={mdLineDash(cfg.lineStyle)}
                      dot={rotateX ? { r: cfg.ptSize || 2.5, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
              ))}
              {zoom.refLo !== null && zoom.refHi !== null && (
                <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {cfg.legend !== 'none' && (
          <div className="w-48 shrink-0 overflow-y-auto custom-scrollbar border border-slate-200 rounded-lg p-2 text-[11px] font-mono bg-white"
               style={{ maxHeight: effHeight }}>
            {series.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5 py-0.5">
                <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ background: colorOf(s, i) }} />
                <span className="truncate" title={s.key}>{s.key}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MDMembraneProfilesSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [cfg, setCfg] = useState({ bin: 0.02, centerMode: 'auto', signedSCD: false, scdResidues: '', stride: 1, startFrame: 0, maxFrames: 0 });
  const [extraRuns, setExtraRuns] = useState([]);
  const [chargeInfo, setChargeInfo] = useState({ map: null, count: 0, files: [] });
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [outputs, setOutputs] = useState(() => {
    // Restore previously-computed membrane profiles (persisted as mdProfileResult).
    const p = activeTest.mdProfileResult;
    return Array.isArray(p) && p.length ? p.map((o) => ({ name: o.name, result: o })) : [];
  }); // [{ name, result }]
  const [chartStyle, setChartStyle] = useState({ scdH: 420, densH: 360, potH: 360, fontSize: 10 });
  const [profCfg, setProfCfg] = useState({ ...DEFAULT_MD_CHART_STYLE, fontSize: 10 });
  // Merge semantics for SharedChartStylePanel (see setChartCfgMerged above).
  const setProfCfgMerged = (patch) => setProfCfg((c) => ({ ...(c || {}), ...patch }));

  // Snapshot the profile charts for the Lab Notebook ("Data Analysis" tick).
  useEffect(() => {
    if (!outputs.length) return;
    const t = setTimeout(() => {
      storeChartSnapshots(activeTest, [
        { id: 'md-scd', key: 'scd' },
        { id: 'md-density', key: 'density' },
        { id: 'md-potential', key: 'potential' }
      ]);
    }, 600);
    return () => clearTimeout(t);
  }, [outputs]);

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  // The ⚡ "Calculate all analyses" toolbar button runs this section too.
  const profileRunAllRef = useRef(() => runAll(false));
  profileRunAllRef.current = () => runAll(false);
  useEffect(() => mdAnalysisRunAll.subscribeRun(() => profileRunAllRef.current()), []);

  const handleChargeFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) { setChargeInfo({ map: null, count: 0, files: [] }); return; }
    for (const f of files) archiveFileToDrive({ file: f, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Analysis', subsection: 'Charges', suffix: 'charges' } }).catch(() => {});
    const texts = [];
    for (const f of files) texts.push(await f.text());
    const map = parseChargeMap(texts);
    setChargeInfo({ map, count: map.size, files: files.map((f) => f.name) });
  };

  const runAll = async (useDemo = false) => {
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    mdAnalysisRunAll.setStatus('profiles', 'Membrane profiles — reading topology…');
    setOutputs([]);
    try {
      const tl = await resolveMDTopology(activeTest);
      if (!tl) throw new Error('Upload the simulation topology (.gro/.pdb — same atom order as the trajectory). Use the "Choose PDB/CIF" button in the 3D viewer, or paste a PDB ID / URL / Drive link.');
      const { topo } = tl;
      if (!topo.box) throw new Error('The topology has no box vectors — a .gro with its final box line is required.');

      const jobs = useDemo ? [] : await buildMDTrajectoryJobs(activeTest, extraRuns);

      const shared = mdAnalysisRunAll.getCfg(); // stride / max frames from the Data Analysis toolbar
      const runCfg = { ...cfg, stride: shared.stride, maxFrames: shared.maxFrames };

      const outs = [];
      if (jobs.length === 0) {
        const result = await computeOrderAndDensity(topo, demoFrames(topo, 40), runCfg, chargeInfo.map,
          (p) => { setStatus({ state: 'busy', msg: `Demo: frame ${p.done}`, done: p.done }); mdAnalysisRunAll.setStatus('profiles', `Membrane profiles — demo frame ${p.done}`); });
        outs.push({ name: 'demo', result });
      } else {
        for (const job of jobs) {
          const src = await resolveFrameSource(job.file, {
            topoAtoms: topo.atoms, topologyBox: topo.box,
            onStatus: (m) => { setStatus((s) => ({ ...s, msg: m })); mdAnalysisRunAll.setStatus('profiles', `Membrane profiles — ${m}`); },
          });
          if (!src) throw new Error(`"${job.file.name}": could not be opened (.xtc / .dcd need the topology uploaded; .trr works standalone).`);
          const frames = src.frames || src;
          const result = await computeOrderAndDensity(topo, frames, runCfg, chargeInfo.map,
            (p) => { setStatus({ state: 'busy', msg: `${job.name}: frame ${p.done}`, done: p.done }); mdAnalysisRunAll.setStatus('profiles', `Membrane profiles — ${job.name}: frame ${p.done}`); });
          outs.push({ name: job.name, result });
        }
      }
      setOutputs(outs);
      // Persist compact profile data so the notebook renders vector SVG figures
      // even after a reload.
      updateActiveTest({
        mdProfileResult: (outs || []).map((o) => ({
          name: o.name,
          nFramesUsed: o.result && o.result.nFramesUsed,
          scdGroups: o.result && o.result.scdGroups,
          density: o.result && o.result.density,
        }))
      });
      // Populate the per-atom table with the computed order parameters |SCD|
      // (one pseudo-atom per lipid group + carbon, e.g. "0-POPC sn-1 C14").
      const scdCells = {};
      outs.forEach((o) => {
        (o.result.scdGroups || []).forEach((g) => {
          (g.carbons || []).forEach((c) => {
            scdCells[`0-${g.label} ${c.x}`] = c.scd;
          });
        });
      });
      storeAnalysisToAtomTable(activeTest, updateActiveTest, { analysis_scd: scdCells });
      setStatus({ state: 'done', msg: '', done: 0 });
      mdAnalysisRunAll.clearStatus('profiles');
    } catch (e) {
      setStatus({ state: 'error', msg: e.message, done: 0 });
      mdAnalysisRunAll.clearStatus('profiles');
    }
  };

  /* ---- chart data (merged across runs) ---- */
  const scdData = useMemo(() => {
    if (outputs.length === 0) return null;
    const rowMap = new Map();
    const series = [];
    outputs.forEach((o) => {
      o.result.scdGroups.forEach((g) => {
        const sKey = outputs.length > 1 ? `${o.name} · ${g.label}` : g.label;
        series.push({ key: sKey });
        g.carbons.forEach((c) => {
          const rk = `${g.label}|${c.x}`;
          if (!rowMap.has(rk)) rowMap.set(rk, { group: g.label, x: c.x, xNum: c.xNum });
          rowMap.get(rk)[sKey] = c.scd;
        });
      });
    });
    const rows = [...rowMap.values()]
      .sort((a, b) =>
        a.group.localeCompare(b.group) ||
        ((a.xNum ?? 1e9) - (b.xNum ?? 1e9)) ||
        String(a.x).localeCompare(String(b.x), undefined, { numeric: true }))
      .map((r) => ({ x: r.x, group: r.group, ...Object.fromEntries(series.map((s) => [s.key, r[s.key] ?? null])) }));
    return { rows, series };
  }, [outputs]);

  const densityRows = useMemo(() => {
    if (outputs.length === 0) return null;
    const base = outputs[0].result.density;
    return base.z.map((zz, i) => {
      const row = { z: zz };
      outputs.forEach((o) => { row[o.name] = o.result.density.rhoE[i]; });
      return row;
    });
  }, [outputs]);

  const potentialRows = useMemo(() => {
    const withPot = outputs.filter((o) => o.result.density.potential);
    if (withPot.length === 0) return null;
    const base = withPot[0].result.density;
    return base.z.map((zz, i) => {
      const row = { z: zz };
      withPot.forEach((o) => { row[o.name] = o.result.density.potential[i]; });
      return row;
    });
  }, [outputs]);

  const exportCSV = () => {
    if (!scdData) return;
    const lines = ['# Order parameters |SCD|'];
    lines.push(['Lipid group', 'Carbon', ...scdData.series.map((s) => s.key)].join(','));
    scdData.rows.forEach((r) => lines.push([r.group, r.x, ...scdData.series.map((s) => r[s.key] ?? '')].join(',')));
    if (densityRows) {
      lines.push('', '# Electron density (e/nm3)');
      lines.push(['z (nm)', ...outputs.map((o) => o.name)].join(','));
      densityRows.forEach((r) => lines.push([r.z, ...outputs.map((o) => r[o.name] ?? '')].join(',')));
    }
    if (potentialRows) {
      lines.push('', '# Electrostatic potential (V)');
      lines.push(['z (nm)', ...outputs.filter((o) => o.result.density.potential).map((o) => o.name)].join(','));
      potentialRows.forEach((r) => lines.push([r.z, ...outputs.filter((o) => o.result.density.potential).map((o) => r[o.name] ?? '')].join(',')));
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'membrane_profiles.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';
  const anyMissing = outputs.length > 0 && outputs.some((o) => o.result.density.missingChargeResidues.length > 0);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800">
        Two more Figures_CHD.pdf analysis types, in-browser:
        <b> (1)</b> deuterium order parameter |SCD| per C–H bond (≙ <span className="font-mono">gmx order</span>;
        default = lipid acyl chains, sn-1 = C2x, sn-2 = C3x — any residue list works, e.g. CHL1) and
        <b> (2)</b> electron density + electrostatic potential across the membrane
        (≙ <span className="font-mono">gmx density</span> + <span className="font-mono">gmx potential</span>; bilayer centre per
        frame = median phosphate z, potential from double integration of the charge density, water baseline set to 0).
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Bin width (nm)
          <input type="number" step="0.005" value={cfg.bin} onChange={(e) => setOpt('bin', Number(e.target.value))} className={`${inp} block mt-1 w-20`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Bilayer centre
          <select value={cfg.centerMode} onChange={(e) => setOpt('centerMode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="auto">Auto (median phosphate z)</option>
            <option value="box">Box centre</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">SCD residues
          <input value={cfg.scdResidues} onChange={(e) => setOpt('scdResidues', e.target.value)} placeholder="lipids only" className={`${inp} block mt-1 w-36 font-mono`} />
        </label>
        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 pb-2">
          <input type="checkbox" checked={cfg.signedSCD} onChange={(e) => setOpt('signedSCD', e.target.checked)} className="accent-indigo-600" />
          signed SCD (default |SCD|)
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <span className="text-[10px] text-slate-400 font-bold w-full">Stride &amp; max frames are set in the “⚡ Calculate all analyses” toolbar at the top of Data Analysis.</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute profiles
        </button>
        {outputs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const scdCells = {};
              outputs.forEach((o) => (o.result.scdGroups || []).forEach((g) => (g.carbons || []).forEach((c) => { scdCells[`0-${g.label} ${c.x}`] = c.scd; })));
              storeAnalysisToAtomTable(activeTest, updateActiveTest, { analysis_scd: scdCells });
              alert('Order parameters |SCD| imported into the per-atom table as column "analysis_scd" — usable in Per-Atom / Condition plots.');
            }}
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-lg text-xs"
          >
            📥 Import per-atom values into data table
          </button>
        )}
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => { const _files = Array.from(e.target.files || []); setExtraRuns(_files); _files.forEach((_f) => archiveFileToDrive({ file: _f, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Analysis', subsection: 'Trajectory', suffix: 'trajectory' } }).catch(() => {})); }} />
        </label>
        <div className="mt-1">
          <DriveUploadButton
            suggestedName={suggestDriveFileName({
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            })}
            naming={{
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            }}
            accept=".xtc,.trr,.dcd"
            label="⬆ Archive to Drive"
            className="bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
          />
        </div>
        <label className="text-xs font-bold text-slate-600">Charges (.itp / .top, for the potential)
          <input type="file" multiple accept=".itp,.top,.txt" className={`${inp} block mt-1`}
                 onChange={(e) => handleChargeFiles(e.target.files)} />
        </label>
        <div className="mt-1">
          <DriveUploadButton
            suggestedName={suggestDriveFileName({
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Charges',
              suffix: 'charges'
            })}
            naming={{
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Charges',
              suffix: 'charges'
            }}
            accept=".itp,.top,.txt"
            label="⬆ Archive to Drive"
            className="bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
          />
        </div>
        {chargeInfo.count > 0 && (
          <span className="text-xs text-emerald-700 font-semibold">✓ {chargeInfo.count} atom charges from {chargeInfo.files.join(', ')}</span>
        )}
        {outputs.length > 0 && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {!chargeInfo.map && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-[11px] font-semibold">
          ⚠️ No charge file loaded: the electron density will be computed, but the electrostatic potential needs partial
          charges — upload your lipid / solvent / ion / ligand .itp (or a processed .top) files.
        </div>
      )}
      {anyMissing && chargeInfo.map && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-[11px] font-semibold">
          ⚠️ Some residues have no charges in the uploaded files ({[...new Set(outputs.flatMap((o) => o.result.density.missingChargeResidues))].slice(0, 12).join(', ')}…) — the potential will be approximate until they are covered.
        </div>
      )}

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-indigo-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {outputs.length > 0 && scdData && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-4">
          <div className="text-xs text-slate-500 font-semibold">
            {outputs.map((o) => o.name).join(' · ')} · {outputs[0].result.nFramesUsed} frames · bin {outputs[0].result.density.binNm} nm
          </div>
          <ChartPanel title="Order parameter |SCD|" icon="📐"
                      cfgPanel={(
                        <div className="flex flex-col gap-3">
                          <SharedChartStylePanel cfg={profCfg} setCfg={setProfCfgMerged}
                                                 series={scdData.series.map((s, i) => ({ key: s.key, label: s.key, color: AWK_PALETTE[i % AWK_PALETTE.length] }))}
                                                 showHeightSlider={false} />
                          <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                            Chart height — {chartStyle.scdH}px
                            <input type="range" min="260" max="900" step="10" value={chartStyle.scdH}
                                   onChange={(e) => setChartStyle((c) => ({ ...c, scdH: parseInt(e.target.value) }))} className="accent-indigo-600" />
                          </label>
                        </div>
                      )}>
            <div id="md-scd">
              <MDProfileChart rows={scdData.rows} series={scdData.series} xKey="x" rotateX
                              yLabel={cfg.signedSCD ? 'SCD' : '|SCD|'}
                              height={chartStyle.scdH} cfg={profCfg} />
            </div>
          </ChartPanel>
          {densityRows && (
            <ChartPanel title="Electron density profile" icon="📈"
                        cfgPanel={(
                          <div className="flex flex-col gap-3">
                            <SharedChartStylePanel cfg={profCfg} setCfg={setProfCfgMerged}
                                                   series={outputs.map((o, i) => ({ key: o.name, label: o.name, color: AWK_PALETTE[i % AWK_PALETTE.length] }))}
                                                   showHeightSlider={false} />
                            <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                              Chart height — {chartStyle.densH}px
                              <input type="range" min="260" max="900" step="10" value={chartStyle.densH}
                                     onChange={(e) => setChartStyle((c) => ({ ...c, densH: parseInt(e.target.value) }))} className="accent-indigo-600" />
                            </label>
                          </div>
                        )}>
              <div id="md-density">
                <MDProfileChart rows={densityRows} series={outputs.map((o) => ({ key: o.name }))}
                                xKey="z" numericX xLabel="Distance to bilayer center (nm)"
                                yLabel="Electron density (e/nm³)"
                                height={chartStyle.densH} cfg={profCfg} />
              </div>
            </ChartPanel>
          )}
          {potentialRows ? (
            <ChartPanel title="Electrostatic potential" icon="⚡"
                        cfgPanel={(
                          <div className="flex flex-col gap-3">
                            <SharedChartStylePanel cfg={profCfg} setCfg={setProfCfgMerged}
                                                   series={outputs.filter((o) => o.result.density.potential).map((o, i) => ({ key: o.name, label: o.name, color: AWK_PALETTE[i % AWK_PALETTE.length] }))}
                                                   showHeightSlider={false} />
                            <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                              Chart height — {chartStyle.potH}px
                              <input type="range" min="260" max="900" step="10" value={chartStyle.potH}
                                     onChange={(e) => setChartStyle((c) => ({ ...c, potH: parseInt(e.target.value) }))} className="accent-indigo-600" />
                            </label>
                          </div>
                        )}>
              <div id="md-potential">
                <MDProfileChart rows={potentialRows}
                                series={outputs.filter((o) => o.result.density.potential).map((o) => ({ key: o.name }))}
                                xKey="z" numericX xLabel="Distance to bilayer center (nm)"
                                yLabel="Potential (V)"
                                height={chartStyle.potH} cfg={profCfg} />
              </div>
            </ChartPanel>
          ) : (
            <div className="text-xs text-slate-400 font-semibold">Electrostatic potential: requires a charges file (.itp / .top).</div>
          )}
        </div>
      )}
    </div>
  );
};

// ================= 7) SECONDARY STRUCTURE (DSSP along the trajectory) =================

const SS_LETTER_META = [
  { k: 'H', label: 'α-helix (H)' }, { k: 'E', label: 'β-strand (E)' },
  { k: 'G', label: '3-10 helix (G)' }, { k: 'I', label: 'π-helix (I)' },
  { k: 'B', label: 'bridge (B)' }, { k: 'T', label: 'turn (T)' },
  { k: 'S', label: 'bend (S)' }, { k: 'C', label: 'coil (C)' },
];

// Interactive DSSP timeline map as a real SVG chart (same zoom behaviour as the
// other plots): X axis = time/frame, Y axis = residue. Drag horizontally to zoom
// the X range, hover for details, double-click or button to reset.
const DSSPHeatmap = ({ heat, height = 520, width = 0, fontSize = 9 }) => {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(null);   // { x0, x1 } sample (frame) indices
  const [hover, setHover] = useState(null); // { px, py, sx, sy, letter }
  const [sel, setSel] = useState(null);     // { x, w } display px selection
  const [w, setW] = useState(0);            // measured container width
  const dragRef = useRef(null);             // { fx0, lastFx }

  // Fill the panel width (like the other charts), re-measuring on resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const samples = heat?.samples || [];
  const nSamples = samples.length;
  const nRes = Math.max(1, heat?.nRes || 0);
  const resIds = Array.isArray(heat?.resIds) ? heat.resIds : [];
  const frameStride = Math.max(1, heat?.frameStride || 1);
  const dtPs = Number(heat?.dtPs) || 0;

  const margin = { top: 12, right: 14, bottom: 42, left: 52 };
  const svgW = Math.max(240, width > 0 ? width : w || 800);
  const svgH = Math.max(160, height || 520);
  const plotW = svgW - margin.left - margin.right;
  const plotH = svgH - margin.top - margin.bottom;

  const vis0 = zoom ? zoom.x0 : 0;
  const vis1 = zoom ? zoom.x1 : Math.max(0, nSamples - 1);
  const visW = Math.max(1, vis1 - vis0 + 1);

  // Downsample to a bounded grid so the SVG stays fast like a real chart
  const cells = useMemo(() => {
    const MAX_COLS = 260;
    const MAX_ROWS = 140;
    const binX = Math.max(1, Math.ceil(visW / MAX_COLS));
    const binY = Math.max(1, Math.ceil(nRes / MAX_ROWS));
    const nCols = Math.ceil(visW / binX);
    const nRows = Math.ceil(nRes / binY);
    const cw = plotW / nCols;
    const ch = plotH / nRows;
    const out = [];
    for (let cx = 0; cx < nCols; cx++) {
      const s0 = vis0 + cx * binX;
      const s1 = Math.min(nSamples - 1, s0 + binX - 1);
      for (let cy = 0; cy < nRows; cy++) {
        const r0 = cy * binY;
        const r1 = Math.min(nRes - 1, r0 + binY - 1);
        const counts = {};
        let best = 'C';
        let bestN = -1;
        for (let s = s0; s <= s1; s++) {
          const codes = samples[s];
          if (!codes) continue;
          for (let r = r0; r <= r1; r++) {
            const letter = codes[r] !== undefined ? SS_CODE_ORDER[codes[r]] : 'C';
            counts[letter] = (counts[letter] || 0) + 1;
            if (counts[letter] > bestN) { bestN = counts[letter]; best = letter; }
          }
        }
        out.push({ x: margin.left + cx * cw, y: margin.top + cy * ch, w: cw + 0.5, h: ch + 0.5, letter: best });
      }
    }
    return out;
  }, [samples, nSamples, nRes, vis0, visW, plotW, plotH, margin]);

  const niceTicks = (count, maxTicks) => {
    const step = Math.max(1, Math.ceil(count / Math.max(1, maxTicks)));
    const arr = [];
    for (let i = 0; i < count; i += step) arr.push(i);
    if (arr.length === 0) arr.push(0);
    if (arr[arr.length - 1] !== count - 1) arr.push(count - 1);
    return arr;
  };
  const yTicks = niceTicks(nRes, Math.max(3, Math.floor(plotH / 15)));
  const xTicks = niceTicks(visW, Math.max(3, Math.floor(plotW / 36)));

  const toX = (colIdx) => {
    const s = Math.min(nSamples - 1, vis0 + colIdx);
    const u = s * frameStride;
    return dtPs > 0 ? (u * dtPs) / 1000 : u;
  };
  const fmtX = (v) => (dtPs > 0 ? (v >= 100 ? v.toFixed(0) : v.toFixed(1)) : String(v));
  const resAt = (rowIdx) => {
    const r = Math.min(nRes - 1, rowIdx);
    return resIds[r] != null ? resIds[r] : r + 1;
  };

  const evtToCell = (e) => {
    const svg = svgRef.current;
    if (!svg || plotW <= 0 || plotH <= 0) return null;
    const rect = svg.getBoundingClientRect();
    const fx = (e.clientX - rect.left - margin.left) / plotW;
    const fy = (e.clientY - rect.top - margin.top) / plotH;
    if (fx < -0.02 || fx > 1.02 || fy < -0.02 || fy > 1.02) return null;
    const sx = Math.max(0, Math.min(nSamples - 1, Math.round(vis0 + fx * (visW - 1))));
    const sy = Math.max(0, Math.min(nRes - 1, Math.round(fy * (nRes - 1))));
    return { fx, sx, sy, px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const onMouseDown = (e) => {
    const c = evtToCell(e);
    if (!c) return;
    dragRef.current = { fx0: c.fx, lastFx: c.fx };
    setSel({ x: margin.left + c.fx * plotW, w: 0 });
    setHover(null);
  };

  const onMouseMove = (e) => {
    const c = evtToCell(e);
    if (!c) return;
    if (!dragRef.current) {
      const codes = samples[c.sx];
      const letter = codes ? SS_CODE_ORDER[codes[c.sy]] : null;
      if (letter) setHover({ px: c.px, py: c.py, sx: c.sx, sy: c.sy, letter });
      else setHover(null);
      return;
    }
    const d = dragRef.current;
    d.lastFx = c.fx;
    const x = margin.left + Math.min(d.fx0, c.fx) * plotW;
    setSel({ x, w: Math.abs(c.fx - d.fx0) * plotW });
  };

  const onMouseUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setSel(null);
    if (!d) return;
    const a = Math.max(0, Math.round(vis0 + Math.min(d.fx0, d.lastFx) * (visW - 1)));
    const b = Math.min(nSamples - 1, Math.round(vis0 + Math.max(d.fx0, d.lastFx) * (visW - 1)));
    if (b - a >= 2) setZoom({ x0: a, x1: b });
  };

  const onMouseLeave = () => { setHover(null); setSel(null); dragRef.current = null; };

  const hoverRes = hover && resIds[hover.sy] != null ? resIds[hover.sy] : (hover ? hover.sy + 1 : null);
  const hoverU = hover ? hover.sx * frameStride : 0;
  const hoverTime = dtPs > 0 ? `${(hoverU * dtPs / 1000).toFixed(2)} ns` : `frame ${hoverU}`;
  const hoverMeta = hover ? SS_LETTER_META.find((m) => m.k === hover.letter) : null;

  return (
    <div className="flex flex-col gap-1">
      {zoom && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setZoom(null)} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">↩ Reset Zoom (double-click also resets)</button>
        </div>
      )}
      <div ref={wrapRef} style={{ position: 'relative', maxWidth: '100%' }}>
        <svg ref={svgRef} width={svgW} height={svgH} style={{ display: 'block', maxWidth: '100%', cursor: 'crosshair', background: '#fff', borderRadius: 8 }}
             onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
             onDoubleClick={() => setZoom(null)}>
          <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1} />
          {cells.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={SS_COLORS[c.letter]} />
          ))}
          {xTicks.map((tx) => {
            const x = margin.left + ((tx + 0.5) / visW) * plotW;
            return (
              <g key={`xt${tx}`}>
                <line x1={x} y1={margin.top + plotH} x2={x} y2={margin.top + plotH + 4} stroke="#64748b" />
                <text x={x} y={margin.top + plotH + 14} textAnchor="middle" fontSize={Math.max(9, fontSize)} fill="#475569">{fmtX(toX(tx))}</text>
              </g>
            );
          })}
          {yTicks.map((ty) => {
            const y = margin.top + ((ty + 0.5) / nRes) * plotH;
            return (
              <g key={`yt${ty}`}>
                <line x1={margin.left - 4} y1={y} x2={margin.left} y2={y} stroke="#64748b" />
                <text x={margin.left - 6} y={y + 3} textAnchor="end" fontSize={Math.max(9, fontSize)} fill="#475569">{resAt(ty)}</text>
              </g>
            );
          })}
          <text x={margin.left + plotW / 2} y={svgH - 8} textAnchor="middle" fontSize={Math.max(10, fontSize + 1)} fontWeight="bold" fill="#334155">
            {dtPs > 0 ? 'Time (ns)' : 'Frame'}
          </text>
          <text transform={`translate(14, ${margin.top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={Math.max(10, fontSize + 1)} fontWeight="bold" fill="#334155">
            Residue
          </text>
          {sel && sel.w > 2 && (
            <rect x={sel.x} y={margin.top} width={sel.w} height={plotH} fill="rgba(100,116,139,0.25)" stroke="#334155" strokeDasharray="4 3" />
          )}
        </svg>
        {hover && hoverMeta && (
          <div style={{ position: 'absolute', left: Math.min(hover.px + 12, (wrapRef.current?.clientWidth || 300) - 170), top: hover.py + 14, pointerEvents: 'none', zIndex: 6 }}
               className="bg-slate-900/90 text-white text-[10px] font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap">
            <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: SS_COLORS[hover.letter] }} />
            Res {hoverRes} · {hoverTime} · {hoverMeta.label}
          </div>
        )}
      </div>
      <div className="text-[10px] text-slate-400">💡 Drag horizontally to zoom the time/frame axis · hover for details · double-click to reset</div>
    </div>
  );
};

export const MDSecondaryStructureSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [cfg, setCfg] = useState({ stride: 1, startFrame: 0, maxFrames: 0, dtPs: 0, chartMode: 'grouped' });
  const [extraRuns, setExtraRuns] = useState([]);
  const [status, setStatus] = useState({ state: 'idle', msg: '', done: 0 });
  const [outputs, setOutputs] = useState(() => {
    // Restore previously-computed DSSP data (persisted as mdDsspResult) so the
    // content / occupancy / heatmap charts survive leaving and re-opening the MD page.
    const p = activeTest.mdDsspResult;
    return Array.isArray(p) && p.length ? p.map((o) => ({ name: o.name, result: o })) : [];
  }); // [{ name, result }]
  const dsspAbortRef = useRef(false); // set by the global ⏹ Stop button

  // The ⚡ "Calculate all analyses" toolbar button runs this section too.
  const dsspRunAllRef = useRef(() => runAll(false));
  dsspRunAllRef.current = () => runAll(false);
  useEffect(() => mdAnalysisRunAll.subscribeRun(() => dsspRunAllRef.current()), []);

  // Snapshot the DSSP charts for the Lab Notebook ("Data Analysis" tick).
  useEffect(() => {
    if (!outputs.length) return;
    const t = setTimeout(() => {
      storeChartSnapshots(activeTest, [
        { id: 'md-dssp-content', key: 'dsspContent' },
        { id: 'md-dssp-heat', key: 'dsspHeat' },
        { id: 'md-dssp-occ', key: 'dsspOcc' }
      ]);
    }, 600);
    return () => clearTimeout(t);
  }, [outputs]);
  const [heatHeight, setHeatHeight] = useState(520);
  const [heatWidth, setHeatWidth] = useState(0); // 0 = auto (fill panel width)
  const [dsspChartCfg, setDsspChartCfg] = useState({ contentH: 380, occH: 320, fontSize: 10 });
  const [dsspCfg, setDsspCfg] = useState({ ...DEFAULT_MD_CHART_STYLE, fontSize: 10 });
  // Merge semantics for SharedChartStylePanel (see setChartCfgMerged above).
  const setDsspCfgMerged = (patch) => setDsspCfg((c) => ({ ...(c || {}), ...patch }));

  const setOpt = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const runAll = async (useDemo = false) => {
    dsspAbortRef.current = false;
    const unregister = abortControl.register('secondary structure', () => { dsspAbortRef.current = true; });
    const shared = mdAnalysisRunAll.getCfg(); // stride / max frames from the Data Analysis toolbar
    setStatus({ state: 'busy', msg: 'Reading topology…', done: 0 });
    mdAnalysisRunAll.setStatus('dssp', 'Secondary structure (DSSP) — reading topology…');
    setOutputs([]);
    try {
      const tl = await resolveMDTopology(activeTest);
      if (!tl) throw new Error('Upload the simulation topology (.gro/.pdb — same atom order as the trajectory). Use the "Choose PDB/CIF" button in the 3D viewer, or paste a PDB ID / URL / Drive link.');
      const { topo } = tl;
      if (!topo.box) throw new Error('The topology has no box vectors — a .gro with its final box line is required.');

      const jobs = useDemo ? [] : await buildMDTrajectoryJobs(activeTest, extraRuns);

      const outs = [];
      if (jobs.length === 0) {
        const result = await computeSecondaryStructure(topo, demoFrames(topo, 40), { ...cfg, stride: shared.stride, maxFrames: shared.maxFrames, isAborted: () => dsspAbortRef.current },
          (p) => { setStatus({ state: 'busy', msg: `Demo: frame ${p.done}`, done: p.done }); mdAnalysisRunAll.setStatus('dssp', `Secondary structure (DSSP) — demo frame ${p.done}`); });
        outs.push({ name: 'demo', result });
      } else {
        for (const job of jobs) {
          const src = await resolveFrameSource(job.file, {
            topoAtoms: topo.atoms, topologyBox: topo.box,
            onStatus: (m) => { setStatus((s) => ({ ...s, msg: m })); mdAnalysisRunAll.setStatus('dssp', `Secondary structure (DSSP) — ${m}`); },
          });
          if (!src) throw new Error(`"${job.file.name}": could not be opened (.xtc / .dcd need the topology uploaded; .trr works standalone).`);
          const frames = src.frames || src;
          const result = await computeSecondaryStructure(topo, frames, { ...cfg, stride: shared.stride, maxFrames: shared.maxFrames, isAborted: () => dsspAbortRef.current },
            (p) => { setStatus({ state: 'busy', msg: `${job.name}: frame ${p.done}`, done: p.done }); mdAnalysisRunAll.setStatus('dssp', `Secondary structure (DSSP) — ${job.name}: frame ${p.done}`); });
          outs.push({ name: job.name, result });
        }
      }
      if (dsspAbortRef.current) { setStatus({ state: 'idle', msg: 'Calculation cancelled.', done: 0 }); mdAnalysisRunAll.clearStatus('dssp'); return; }
      setOutputs(outs);
      // Persist compact DSSP data (content + occupancy + a capped heatmap) so the
      // notebook renders vector SVG figures even after a reload.
      updateActiveTest({
        mdDsspResult: (outs || []).map((o) => {
          const r = o.result || {};
          const heat = r.heat && r.heat.samples ? r.heat : null;
          let heatSamples = null;
          if (heat) {
            const cap = 200;
            const stride = Math.max(1, Math.ceil(heat.samples.length / cap));
            heatSamples = heat.samples.filter((_, i) => i % stride === 0).map((codes) => Array.from(codes));
          }
          return {
            name: o.name,
            nRes: r.nRes,
            labels: r.labels,
            series: downsampleSeries(r.series || [], 400),
            occupancy: r.occupancy,
            nFramesUsed: r.nFramesUsed,
            xUnit: r.xUnit,
            heat: heat ? { nRes: heat.nRes, samples: heatSamples, frameStride: heat.frameStride, totalFrames: heat.totalFrames, dtPs: heat.dtPs, resIds: heat.resIds } : null,
          };
        })
      });
      setStatus({ state: 'done', msg: '', done: 0 });
      mdAnalysisRunAll.clearStatus('dssp');
    } catch (e) {
      if (isAbortError(e)) {
        setStatus({ state: 'idle', msg: 'Calculation cancelled.', done: 0 });
      } else {
        setStatus({ state: 'error', msg: e.message, done: 0 });
      }
      mdAnalysisRunAll.clearStatus('dssp');
    } finally {
      unregister();
      dsspAbortRef.current = false;
    }
  };

  /* ---- content-vs-time chart data ---- */
  const contentData = useMemo(() => {
    if (outputs.length === 0) return null;
    const keys = cfg.chartMode === 'letters'
      ? SS_LETTER_META.map((m) => m.k)
      : ['alpha', 'beta', 'coil'];
    const keyLabel = (k) => (k === 'alpha' ? 'α-helix' : k === 'beta' ? 'β-sheet' : k === 'coil' ? 'coil/other' : k);
    const series = [];
    outputs.forEach((o) => {
      keys.forEach((k) => series.push({ key: outputs.length > 1 ? `${o.name} · ${keyLabel(k)}` : keyLabel(k), k }));
    });
    const rows = outputs[0].result.series.map((s, si) => {
      const row = { x: s.x };
      outputs.forEach((o) => {
        const fr = o.result.series[si];
        keys.forEach((k) => {
          const sKey = outputs.length > 1 ? `${o.name} · ${keyLabel(k)}` : keyLabel(k);
          row[sKey] = fr ? (k === 'alpha' ? fr.alpha : k === 'beta' ? fr.beta : k === 'coil' ? fr.coil : +((100 * fr.counts[k] / o.result.nRes).toFixed(2))) : null;
        });
      });
      return row;
    });
    return { rows, series };
  }, [outputs, cfg.chartMode]);

  const contentColor = (sKey, i) => {
    if (outputs.length > 1) return AWK_PALETTE[i % AWK_PALETTE.length];
    if (sKey === 'α-helix') return SS_GROUP_COLORS.alpha;
    if (sKey === 'β-sheet') return SS_GROUP_COLORS.beta;
    if (sKey === 'coil/other') return SS_GROUP_COLORS.coil;
    const letter = sKey.charAt(0);
    return SS_COLORS[letter] || '#64748b';
  };

  // ---- drag-to-zoom for the content and occupancy charts ----
  const contentRef = useRef(null);
  const occRef = useRef(null);
  const contentXs = (contentData?.rows || []).map((r) => r.x).filter((x) => typeof x === 'number');
  const contentDomain = contentXs.length > 1 ? [Math.min(...contentXs), Math.max(...contentXs)] : [0, 1];
  const contentZoom = useXZoom(contentRef, contentDomain, { top: 8, right: 8, bottom: 30, left: 8 });
  const occRows = useMemo(() => outputs[0]?.result.occupancy || [], [outputs]);
  // X-axis drag-to-zoom on the residue axis (horizontal drag selects a range), like the other charts
  const occRowsWithXi = useMemo(() => occRows.map((r, i) => ({ ...r, __xi: i })), [occRows]);
  const occZoom = useXZoom(occRef, [0, Math.max(1, occRows.length - 1)], { top: 8, right: 8, bottom: 70, left: 8 });
  const contentH = useChartFsHeight(dsspChartCfg.contentH || 380);
  const occH = useChartFsHeight(dsspChartCfg.occH || 320);

  /* ---- DSSP heatmap ---- */
  const heat = outputs[0]?.result.heat || null;

  const exportCSV = () => {
    if (!contentData) return;
    const head = [`time (${outputs[0].result.xUnit})`, ...contentData.series.map((s) => `${s.key} (%)`)];
    const body = contentData.rows.map((r) => [r.x, ...contentData.series.map((s) => r[s.key] ?? '')]);
    const csv = [head, ...body].map((row) => row.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'secondary_structure_dssp.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const inp = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500';
  const occTickStep = Math.max(1, Math.floor(occRows.length / 40));
  const occTicks = [];
  for (let i = Math.max(0, Math.ceil(occZoom.domain[0])); i <= Math.min(occRows.length - 1, Math.floor(occZoom.domain[1])); i += occTickStep) occTicks.push(i);
  const occTicksLast = Math.min(occRows.length - 1, Math.floor(occZoom.domain[1]));
  if (occTicks[occTicks.length - 1] !== occTicksLast) occTicks.push(occTicksLast);

  return (
    <div className="space-y-4">
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800">
        Secondary structure along the trajectory — in-browser port of <span className="font-mono">gmx do_dssp</span> (Kabsch–Sander):
        backbone H-bond energies (E ≤ −0.5 kcal/mol), helix/turn/bend/β-bridge assignment with DSSP priority
        H &gt; B &gt; E &gt; G &gt; I &gt; T &gt; S &gt; C. Requires a protein topology (N/CA/C/O); H positions are reconstructed,
        so it also works with trajectories saved without hydrogens.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-bold text-slate-600">Content chart
          <select value={cfg.chartMode} onChange={(e) => setOpt('chartMode', e.target.value)} className={`${inp} block mt-1 font-semibold`}>
            <option value="grouped">α / β / coil</option>
            <option value="letters">All DSSP letters</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Δt between frames (ps, 0 = frame axis)
          <input type="number" min="0" step="10" value={cfg.dtPs} onChange={(e) => setOpt('dtPs', Number(e.target.value) || 0)} className={`${inp} block mt-1 w-28`} />
        </label>
        <label className="text-xs font-bold text-slate-600">Start frame
          <input type="number" min="0" value={cfg.startFrame} onChange={(e) => setOpt('startFrame', Math.max(0, Number(e.target.value) || 0))} className={`${inp} block mt-1 w-20`} />
        </label>
        <span className="text-[10px] text-slate-400 font-bold w-full">Stride &amp; max frames are set in the “⚡ Calculate all analyses” toolbar at the top of Data Analysis.</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => runAll(false)} disabled={status.state === 'busy'}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-lg text-sm">
          ▶ Compute DSSP
        </button>
        {outputs.length > 0 && (
          <button
            type="button"
            onClick={() => {
              const cells = {};
              outputs.forEach((o) => (o.result.occupancy || []).forEach((oc, r) => { cells[`${r}-CA`] = +Number(oc.alpha).toFixed(2); }));
              const n = Object.keys(cells).length;
              if (n === 0) {
                alert('No α-helix occupancy values to import — run "▶ Compute DSSP" first (needs a protein topology).');
                return;
              }
              storeAnalysisToAtomTable(activeTest, updateActiveTest, { analysis_dssp: cells });
              alert(`Per-residue α-helix occupancy (%) imported (${n} residues) into the per-atom table as column "analysis_dssp" — usable in Per-Atom / Condition plots.`);
            }}
            className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2 rounded-lg text-xs"
          >
            📥 Import per-atom values into data table
          </button>
        )}
        <label className="text-xs font-bold text-slate-600">Additional runs to overlay
          <input type="file" multiple accept=".xtc,.trr,.dcd" className={`${inp} block mt-1`}
                 onChange={(e) => { const _files = Array.from(e.target.files || []); setExtraRuns(_files); _files.forEach((_f) => archiveFileToDrive({ file: _f, ctx: { project: (activeTest.projectNames || [])[0] || '', test: activeTest.name || activeTest.instanceName || '', section: 'Analysis', subsection: 'Trajectory', suffix: 'trajectory' } }).catch(() => {})); }} />
        </label>
        <div className="mt-1">
          <DriveUploadButton
            suggestedName={suggestDriveFileName({
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            })}
            naming={{
              project: (activeTest.projectNames || [])[0] || '',
              test: activeTest.name || activeTest.instanceName || '',
              section: 'Analysis',
              subsection: 'Trajectory',
              suffix: 'trajectory'
            }}
            accept=".xtc,.trr,.dcd"
            label="⬆ Archive to Drive"
            className="bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
          />
        </div>
        {extraRuns.length > 0 && (
          <span className="text-xs text-slate-500 font-mono">{extraRuns.map((f) => f.name).join(', ')}</span>
        )}
        {outputs.length > 0 && (
          <button onClick={exportCSV} className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold px-4 py-2 rounded-lg text-xs">
            📊 Export CSV
          </button>
        )}
      </div>

      {status.state === 'busy' && (
        <div className="text-xs font-bold text-rose-700 animate-pulse">⏳ {status.msg}</div>
      )}
      {status.state === 'error' && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-lg p-3 text-xs font-semibold">⚠️ {status.msg}</div>
      )}

      {outputs.length > 0 && contentData && (
        <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm space-y-5">
          <div className="text-xs text-slate-500 font-semibold">
            {outputs.map((o) => o.name).join(' · ')} · {outputs[0].result.nFramesUsed} frames · {outputs[0].result.nRes} protein residues
          </div>

          <ChartPanel title="Secondary structure content vs time" icon="📈"
                      headerExtra={contentZoom.isZoomed ? (
                        <button type="button" onClick={contentZoom.reset} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">↩ Reset Zoom</button>
                      ) : null}
                      cfgPanel={(
                        <div className="flex flex-col gap-3">
                          <SharedChartStylePanel cfg={dsspCfg} setCfg={setDsspCfgMerged}
                                                 series={contentData.series.map((s, i) => ({ key: s.key, label: s.label, color: contentColor(s.key, i) }))}
                                                 showHeightSlider={false} />
                          <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                            Chart height — {dsspChartCfg.contentH || 380}px
                            <input type="range" min="180" max="900" step="10" value={dsspChartCfg.contentH || 380}
                                   onChange={(e) => setDsspChartCfg((c) => ({ ...c, contentH: parseInt(e.target.value) }))} className="accent-blue-600" />
                          </label>
                        </div>
                      )}>
            <div id="md-dssp-content">
              <div ref={contentRef} onMouseDown={contentZoom.onMouseDown} className="select-none">
                <ResponsiveContainer width="100%" height={contentH}>
                  <LineChart data={contentData.rows} margin={{ top: 8, right: 8, bottom: 30, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="x" type="number" domain={[contentZoom.domain[0], contentZoom.domain[1]]} allowDataOverflow tick={{ fontSize: dsspCfg.fontSize || 10 }}
                         label={{ value: dsspCfg.xAxisLabel || (outputs[0].result.xUnit === 'ns' ? 'Time (ns)' : 'Frame'), position: 'insideBottom', offset: -18, style: { fontSize: (dsspCfg.fontSize || 10) + 1 } }} />
                  <YAxis tick={{ fontSize: (dsspCfg.fontSize || 10) + 1 }} width={70} unit="%"
                         domain={[mdDom(dsspCfg.yMin) ?? 'auto', mdDom(dsspCfg.yMax) ?? 'auto']}
                         label={{ value: dsspCfg.yAxisLabel || 'Residues (%)', angle: -90, position: 'insideLeft', style: { fontSize: (dsspCfg.fontSize || 10) + 2 } }} />
                  <Tooltip />
                  {dsspCfg.legend !== 'none' && <Legend verticalAlign={dsspCfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: (dsspCfg.fontSize || 10) }} />}
                  {contentData.series.map((s, i) => (
                    <Line key={s.key} dataKey={s.key}
                          stroke={(dsspCfg.colors && dsspCfg.colors[s.key]) || contentColor(s.key, i)}
                          strokeWidth={dsspCfg.lineThickness || 2} strokeDasharray={mdLineDash(dsspCfg.lineStyle)}
                          dot={false} connectNulls isAnimationActive={false} />
                  ))}
                  {contentZoom.refLo !== null && contentZoom.refHi !== null && (
                    <ReferenceArea x1={contentZoom.refLo} x2={contentZoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />
                  )}
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>
          </ChartPanel>

          {heat && (
            <ChartPanel title="DSSP timeline map (residue × frame)" icon="🧬"
                        cfgPanel={(
                          <div className="flex flex-col gap-3">
                            <SharedChartStylePanel cfg={dsspCfg} setCfg={setDsspCfgMerged}
                                                   series={[
                                                     { key: 'alpha', label: 'α-helix', color: SS_GROUP_COLORS.alpha },
                                                     { key: 'beta', label: 'β-sheet', color: SS_GROUP_COLORS.beta },
                                                     { key: 'other', label: 'coil/other', color: '#e5e7eb' }
                                                   ]}
                                                   showHeightSlider={false} />
                            <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                              Map width — {heatWidth > 0 ? `${heatWidth}px` : 'Auto (fill panel)'}
                              <input type="range" min="0" max="1400" step="20" value={heatWidth}
                                     onChange={(e) => setHeatWidth(parseInt(e.target.value))} className="accent-blue-600" />
                            </label>
                            <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                              Map height — {heatHeight}px
                              <input type="range" min="220" max="900" step="10" value={heatHeight}
                                     onChange={(e) => setHeatHeight(parseInt(e.target.value))} className="accent-blue-600" />
                            </label>
                          </div>
                        )}
                        footer={(
                          <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-600">
                            {SS_LETTER_META.map((m) => (
                              <span key={m.k} className="flex items-center gap-1">
                                <span className="inline-block w-3 h-3 rounded-sm border border-slate-300" style={{ background: SS_COLORS[m.k] }} />
                                {m.label}
                              </span>
                            ))}
                            <span className="text-slate-400">
                              · x: every {heat.frameStride} frame(s) of {heat.totalFrames} · y: residue 1 → {heat.nRes}
                            </span>
                          </div>
                        )}>
              <div id="md-dssp-heat">
                <DSSPHeatmap heat={heat} height={heatHeight} width={heatWidth} fontSize={dsspCfg.fontSize || 9} />
              </div>
            </ChartPanel>
          )}

          {occRows.length > 0 && (
            <ChartPanel title={`Per-residue occupancy (${outputs[0].name})`} icon="📊"
                        headerExtra={occZoom.isZoomed ? (
                          <button type="button" onClick={occZoom.reset} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">↩ Reset Zoom</button>
                        ) : null}
                        cfgPanel={(
                          <div className="flex flex-col gap-3">
                            <SharedChartStylePanel cfg={dsspCfg} setCfg={setDsspCfgMerged}
                                                   series={[
                                                     { key: 'alpha', label: 'α-helix', color: SS_GROUP_COLORS.alpha },
                                                     { key: 'beta', label: 'β-sheet', color: SS_GROUP_COLORS.beta },
                                                     { key: 'other', label: 'coil/other', color: '#e5e7eb' }
                                                   ]}
                                                   showHeightSlider={false} />
                            <label className="flex items-center justify-between gap-4 text-xs font-bold text-slate-600">
                              Chart height — {dsspChartCfg.occH || 320}px
                              <input type="range" min="180" max="900" step="10" value={dsspChartCfg.occH || 320}
                                     onChange={(e) => setDsspChartCfg((c) => ({ ...c, occH: parseInt(e.target.value) }))} className="accent-blue-600" />
                            </label>
                          </div>
                        )}>
              <div id="md-dssp-occ">
                <div ref={occRef} onMouseDown={occZoom.onMouseDown} className="select-none">
                  <ResponsiveContainer width="100%" height={occH}>
                  <BarChart data={occRowsWithXi} margin={{ top: 8, right: 8, bottom: 70, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="__xi" type="number" domain={[occZoom.domain[0], occZoom.domain[1]]} allowDataOverflow
                           ticks={occTicks} tickFormatter={(v) => { const r = occRowsWithXi[Math.round(v)]; return r ? r.label : ''; }}
                           interval={0} height={80} tick={{ fontSize: dsspCfg.fontSize || 8, angle: -90, textAnchor: 'end' }} />
                    <YAxis tick={{ fontSize: (dsspCfg.fontSize || 10) + 1 }} width={70} unit="%" domain={[0, 100]} />
                    <Tooltip />
                    {dsspCfg.legend !== 'none' && <Legend verticalAlign={dsspCfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: (dsspCfg.fontSize || 10) }} />}
                    <Bar dataKey="alpha" stackId="ss" fill={(dsspCfg.colors && dsspCfg.colors.alpha) || SS_GROUP_COLORS.alpha} name="α-helix" isAnimationActive={false} />
                    <Bar dataKey="beta" stackId="ss" fill={(dsspCfg.colors && dsspCfg.colors.beta) || SS_GROUP_COLORS.beta} name="β-sheet" isAnimationActive={false} />
                    <Bar dataKey="other" stackId="ss" fill={(dsspCfg.colors && dsspCfg.colors.other) || '#e5e7eb'} name="coil/other" isAnimationActive={false} />
                    {occZoom.refLo !== null && occZoom.refHi !== null && (
                      <ReferenceArea x1={occZoom.refLo} x2={occZoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              </div>
            </ChartPanel>
          )}
        </div>
      )}
    </div>
  );
};
// ================= ALL =================

// ================= ALL =================

export const Setup = MDExperimentSetupSection;
export const Data = MDDataSection;
export const Simulations = MDSimulationParamsSection;
export const Analysis = MDAnalysisSection;
export const Contacts = MDMembraneContactSection;
export const SecondaryStructure = MDSecondaryStructureSection;
export const Profiles = MDMembraneProfilesSection;

// ================= EXTRA ANALYSIS SECTIONS =================
// Rendered directly under "Data Analysis" (after "MD general parameters")
// in the MD Simulations tab. Per Atom Plot and Condition Plot are last.
export const MD_ANALYSIS_SECTIONS = [
  { title: 'Secondary Structure (DSSP)', icon: '🧬', defaultOpen: false, Component: MDSecondaryStructureSection },
  { title: 'Membrane Contacts', icon: '🫧', defaultOpen: false, Component: MDMembraneContactSection },
  { title: 'Membrane Profiles', icon: '📉', defaultOpen: false, Component: MDMembraneProfilesSection },
  { title: 'Per Atom Plot', icon: '📊', defaultOpen: false, Component: MDPerAtomPlotSection },
  { title: 'Condition Plot', icon: '📈', defaultOpen: false, Component: MDConditionPlotSection }
]; 

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useMDDerived(activeTest, ctx);

  if (checkId === 'cond') {
    return `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>MD Setup:</b> Force field ${d.ffInfo.name} ${d.ffVersion} | Water ${getWaterModelInfo(d.waterModel).name} | Ensemble ${d.ensemble} | Integrator ${d.integrator} | Δt ${d.timestep} fs | ${d.nSteps} steps | T ${d.temperature} K</p>`;
  }

  if (checkId === 'seq') {
    return `<p style="font-size:12px;color:#475569;margin-bottom:12px;"><b>${d.typeLabel}:</b> <span style="font-family:monospace;background:#e2e8f0;padding:2px 4px;border-radius:4px;">${d.isPolymer ? activeTest.proteinSequence || 'N/A' : d.parsedSeq[0]?.name || 'N/A'}</span></p>`;
  }

  if (checkId === 'formula' && d.structure) {
    return `<div style="margin-bottom:12px;">${elementsToSVG(d.structure, 300)}</div>`;
  }

  if (checkId === 'table' && d.parsedSeq.length > 0) {
    let html = `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;text-align:left;background:white;"><tr style="background-color:#f1f5f9;"><th style="padding:6px;border:1px solid #cbd5e1;">Residue</th><th style="padding:6px;border:1px solid #cbd5e1;">Atom</th><th style="padding:6px;border:1px solid #cbd5e1;">Type</th><th style="padding:6px;border:1px solid #cbd5e1;">Charge</th></tr>`;
    d.estSeq.forEach((res) => {
      (res.ffAtoms || []).forEach((a) => {
        html += `<tr><td style="padding:6px;border:1px solid #e2e8f0;"><b>${res.id}</b></td><td style="padding:6px;border:1px solid #e2e8f0;">${a.atom}</td><td style="padding:6px;border:1px solid #e2e8f0;">${a.type}</td><td style="padding:6px;border:1px solid #e2e8f0;">${a.charge}</td></tr>`;
      });
    });
    html += `</table>`;
    return html;
  }

  if (checkId === 'trajectory' && d.trajectoryUrl) {
    return `<p style="font-size:12px;color:#475569;"><b>Trajectory:</b> <a href="${d.trajectoryUrl}" style="color:#2563eb;">${d.trajectoryUrl}</a> (${getTrajectoryFormatInfo(d.trajectoryFormat).label})</p>`;
  }

  return '';
};
// ================= NOTEBOOK HTML BUILDER =================
export const buildNotebookHtml = (ctx, checked) => {
  let html = '';
  ['cond', 'seq', 'formula', 'table', 'trajectory'].forEach((id) => {
    if (checked && checked[id]) {
      html += NotebookExtra({ ctx, checkId: id });
    }
  });
  return html;
};
