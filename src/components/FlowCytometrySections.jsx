// components/FlowCytometrySections.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  suggestDriveFileName, sanitizeSlug } from '../utils/driveNaming';
import { uploadLocalFile, withExtension, getDriveToken, getDriveFileRegistry, driveFetch, untrashDriveFile } from '../utils/driveUpload';
import { saveFcsFile, loadFcsFile, removeFcsFile } from '../utils/fcsBlobStore';
import { PLATE_PRESET_LABELS, PLATE_PRESET_COLORS, isPlatePreset, platePresetColor } from '../utils/platePresets';
import {BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Line, ComposedChart, Area, ReferenceArea} from 'recharts';
import { ChartControlBar, SharedChartStylePanel, ChartInspector, brokenAxisProps, cfgSeriesEl, cfgLogScale, cfgAxisTicks, cfgTickFormatter, cfgAxisLabel, cfgChartMargin, instancesLinked, InstanceLinkToggle } from './SharedAnalysisTools';
import { CollapsibleSection } from './ui';
import { FS_CLASSES, OVERLAY_CLASSES, VIS_PALETTES, seriesColorFor, tickSize, fontFamilyOf, chartRatioBoxStyle, tickColorOf, axisTitleColorOf
} from '../utils/chartStyle';
import { PLATES_DEF, formatConc, getRegionColor } from '../data/constants';
export { VIS_PALETTES };

const COLORS = VIS_PALETTES.default;
const DEFAULT_CHART_STYLE = { height: 380, aspect: 1, fontSize: 16, tickStep: '', tickAngle: 0, ptStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2, legend: 'top', colors: {}, barRadius: 3, xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: '' };
// Compact defaults for the "Split view — single curves" mini charts (own
// Graphical Parameters panel, saved in vizCfgSplit).
const DEFAULT_SPLIT_STYLE = { height: 80, aspect: 1, fontSize: 11, tickStep: '', tickAngle: 0, ptStyle: 'circle', ptSize: 4, lineStyle: 'solid', lineThickness: 2, legend: 'none', colors: {}, barRadius: 2, xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: '' };
// FS_CLASSES, OVERLAY_CLASSES, VIS_PALETTES now live in ../utils/chartStyle.
// CollapsibleSection now lives in ./ui (single shared definition).

// Gaussian smoothing of a histogram/curve. `sigma` is in bins; returns a new
// array of the same length (boundaries are handled by re-normalising the
// truncated kernel).
const gaussSmooth = (arr, sigma = 2) => {
  const s = Math.max(0.3, Number(sigma) || 2);
  const radius = Math.ceil(s * 3);
  let kernel = [];
  let ksum = 0;
  for (let d = -radius; d <= radius; d++) {
    const k = Math.exp(-(d * d) / (2 * s * s));
    kernel.push(k);
    ksum += k;
  }
  kernel = kernel.map((k) => k / ksum);
  const n = arr.length;
  return arr.map((_, i) => {
    let acc = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j >= 0 && j < n) acc += arr[j] * kernel[d + radius];
    }
    return acc;
  });
};

// Resolve the colour of an FCS overlay series through the shared palette system:
//   per-series overrides (style-panel colors + the page's own palette presets)
//   → base colour (dark→light shades) → rich rainbow by default.
// This is what makes the rainbow / "Base colour" picker actually visible here.
const resolveFcsColor = (cfg, localColors, inst, idx, total) => {
  const overrides = { ...((cfg && cfg.colors) || {}) };
  Object.entries(localColors || {}).forEach(([id, c]) => { if (c) overrides[id] = c; });
  return seriesColorFor({ ...(cfg || {}), colors: overrides }, inst.id, idx, total);
};

// =========================================================================
// FCS BINARY PARSER 
// =========================================================================
const parseFCSFile = (buffer) => {
  const decoder = new TextDecoder();
  const readStr = (start, length) => {
    if (start + length > buffer.byteLength) return '';
    return decoder.decode(new Uint8Array(buffer, start, length)).trim();
  };

  const version = readStr(0, 6);
  if (!version.startsWith('FCS')) throw new Error('Not a valid FCS file format.');

  let textStart = parseInt(readStr(10, 8), 10);
  let textEnd = parseInt(readStr(18, 8), 10);
  let dataStart = parseInt(readStr(26, 8), 10);
  let dataEnd = parseInt(readStr(34, 8), 10);

  if (!textStart || !textEnd) {
    textStart = parseInt(readStr(58, 8), 10);
    textEnd = parseInt(readStr(66, 8), 10);
    dataStart = parseInt(readStr(74, 8), 10);
    dataEnd = parseInt(readStr(82, 8), 10);
  }

  if (!textStart || !textEnd || textEnd < textStart || textEnd >= buffer.byteLength) {
    throw new Error('Could not locate TEXT segment in FCS header.');
  }

  const textStr = decoder.decode(new Uint8Array(buffer, textStart, textEnd - textStart + 1));
  
  // 1. Bulletproof Delimiter Detection
  // The FCS standard guarantees the delimiter is the character immediately preceding the first keyword (which starts with $)
  const firstDollar = textStr.indexOf('$');
  let delimiter = '/';
  if (firstDollar >= 1) {
    delimiter = textStr[firstDollar - 1];
  } else {
    delimiter = textStr[0] || '/';
  }

  // 2. Safe Parsing (Preserves empty values to prevent key/value misalignment)
  const rawParts = textStr.split(delimiter);
  const textDict = {};
  let currentKey = null;

  // Start at index 1 to skip the empty split before the first delimiter
  for (let i = 1; i < rawParts.length; i++) {
    const part = rawParts[i].trim();
    if (currentKey === null) {
      currentKey = part.toUpperCase();
    } else {
      if (currentKey) textDict[currentKey] = part;
      currentKey = null;
    }
  }

  const numParams = parseInt(textDict['$PAR'] || '0', 10);
  const numEvents = parseInt(textDict['$TOT'] || '0', 10);
  const dataType = (textDict['$DATATYPE'] || 'F').toUpperCase();

  if (numParams === 0 || numEvents === 0 || isNaN(numParams) || isNaN(numEvents)) {
    throw new Error(`Could not find valid $PAR or $TOT in FCS header. (Found $PAR=${numParams}, $TOT=${numEvents}).`);
  }

  const params = [];
  for (let i = 1; i <= numParams; i++) {
    params.push({
      name: textDict[`$P${i}N`] || `P${i}`,
      label: textDict[`$P${i}S`] || textDict[`$P${i}N`] || `Parameter ${i}`,
      range: parseInt(textDict[`$P${i}R`] || '262144', 10),
      bits: parseInt(textDict[`$P${i}B`] || '16', 10)
    });
  }

  if (!dataStart || !dataEnd || dataEnd < dataStart || dataEnd >= buffer.byteLength) {
    throw new Error('Could not locate DATA segment in FCS header.');
  }

  const dataLength = dataEnd - dataStart + 1;
  let events = null;

  const dataView = new DataView(buffer, dataStart, dataLength);
  const byteOrd = textDict['$BYTEORD'] || '1,2,3,4';
  const isLittleEndian = byteOrd.trim() === '1,2,3,4';
  const numTotalValues = numParams * numEvents;

  try {
    if (dataType === 'F') {
      events = new Float32Array(numTotalValues);
      for (let i = 0; i < numTotalValues; i++) events[i] = dataView.getFloat32(i * 4, isLittleEndian);
    } else if (dataType === 'I') {
      const bits = params[0]?.bits || 16;
      if (bits <= 16) {
        events = new Uint16Array(numTotalValues);
        for (let i = 0; i < numTotalValues; i++) events[i] = dataView.getUint16(i * 2, isLittleEndian);
      } else {
        events = new Uint32Array(numTotalValues);
        for (let i = 0; i < numTotalValues; i++) events[i] = dataView.getUint32(i * 4, isLittleEndian);
      }
    } else if (dataType === 'D') {
      events = new Float64Array(numTotalValues);
      for (let i = 0; i < numTotalValues; i++) events[i] = dataView.getFloat64(i * 8, isLittleEndian);
    } else {
      throw new Error(`Unsupported FCS data type: ${dataType}`);
    }
  } catch (e) {
    throw new Error(`Failed to parse DATA segment: ${e.message}`);
  }

  return { version, numParams, numEvents, params, events, textDict };
};

// =========================================================================
// METADATA MAPPER (Separates Experimental & Instrumental Cleanly)
// =========================================================================
const mapFCSMetadata = (textDict) => {
  const updates = {};
  
  if (textDict['$DATE']) {
    const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const parts = textDict['$DATE'].split('-');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = months[parts[1].toUpperCase()] || '01';
      const year = parts[2];
      updates.experimentDate = `${year}-${month}-${day}`;
    }
  }
  if (textDict['$TOT']) updates.cellNumber = parseInt(textDict['$TOT'], 10).toLocaleString();
  
  if (textDict['$CYT']) updates.cytometerModel = textDict['$CYT'];
  if (textDict['CYTNUM']) updates.cytometerSerial = textDict['CYTNUM'];
  if (textDict['CREATOR']) updates.acquisitionSoftware = textDict['CREATOR'];
  
  const lasers = [];
  if (textDict['LASER1NAME']) lasers.push(`${textDict['LASER1NAME']} Laser`);
  if (textDict['LASER2NAME']) lasers.push(`${textDict['LASER2NAME']} Laser`);
  if (textDict['LASER3NAME']) lasers.push(`${textDict['LASER3NAME']} Laser`);
  if (textDict['LASER4NAME']) lasers.push(`${textDict['LASER4NAME']} Laser`);
  if (lasers.length > 0) updates.lasers = lasers.join(', ');
  
  if (textDict['THRESHOLD']) updates.threshold = textDict['THRESHOLD'];
  if (textDict['APPLY COMPENSATION']) updates.compensationApplied = textDict['APPLY COMPENSATION'] === 'TRUE' ? 'Yes' : 'No';
  if (textDict['PLATE NAME']) updates.plateName = textDict['PLATE NAME'];
  if (textDict['WELL ID']) updates.wellId = textDict['WELL ID'];

  return updates;
};

// =========================================================================
// HELPERS
// =========================================================================
const formatTickVal = (val) => {
  if (isNaN(val) || !isFinite(val)) return '';
  if (val === 0) return '0';
  const absVal = Math.abs(val);
  if (absVal >= 10000) return (val / 1000).toFixed(1) + 'k';
  if (absVal >= 100) return Math.round(val).toString();
  if (absVal >= 1) return Number(val.toFixed(1)).toString();
  return Number(val.toFixed(2)).toString();
};

const getParamLabel = (p, panel = [], renames = {}) => {
  const key = (p.name || '').toUpperCase();
  if (renames[key]) return renames[key]; 
  
  // Link automatically to the Staining Panel if defined
  const panelMatch = panel.find(ch => (ch.channel || '').toUpperCase() === key);
  if (panelMatch && (panelMatch.antibody || panelMatch.fluorochrome)) {
    const parts = [];
    if (panelMatch.antibody) parts.push(panelMatch.antibody);
    if (panelMatch.fluorochrome) parts.push(panelMatch.fluorochrome);
    return `${parts.join(' ')} (${p.name})`;
  }

  const name = p.name || '';
  let label = p.label || '';
  label = label.replace(/[/\\]+$/, '').trim(); 

  if (/^P\d+$/.test(name) && label) return label; 
  if (name && label && name !== label && !label.includes(name) && !name.includes(label)) {
    return `${label} (${name})`;
  }
  return label || name || key || 'Unknown';
};

const useXZoom = (chartRef, dataDomain, margin = { top: 10, right: 10, bottom: 20, left: 20 }) => {
  const [domain, setDomain] = useState(null);
  const [lo, setLo] = useState(null);
  const [hi, setHi] = useState(null);
  const dragging = useRef(false);
  const loRef = useRef(null);
  
  const safe = Array.isArray(dataDomain) && dataDomain[1] > dataDomain[0] ? dataDomain : [0, 1];
  const eff = domain || safe;
  const effRef = useRef(eff);
  effRef.current = eff;

  const getX = (clientX) => {
    const el = chartRef.current;
    if (!el) return null;
    const wrapper = el.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - margin.left - margin.right;
    if (plotW <= 0) return null;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left - margin.left) / plotW));
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
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
  }, [margin.left, margin.right]);

  const onMouseDown = (e) => {
    const v = getX(e.clientX);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };

  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};

const hexToRgba = (hex, alpha) => {
  const h = (hex || '#3b82f6').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${Number.isNaN(r) ? 59 : r}, ${Number.isNaN(g) ? 130 : g}, ${Number.isNaN(b) ? 246 : b}, ${alpha})`;
};

const isPointInPoly = (px, py, poly) => {
  let isInside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIC TREATMENT ("🤖 Auto treatment")
//  1. Singlets  — keep events whose FSC-H differs from FSC-A by ≤ tolerance.
//  2. Debris    — keep events with FSC-A ≥ minA AND SSC-A ≥ minSSC (inside #1).
//  3. Manual    — (not automatic) keep events with X ≥ xMin AND Y ≥ yMin on the
//                 user-chosen channels.
// All thresholds are user-configurable; comparisons are on raw channel values.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_AUTO_GATES = {
  singlets: { enabled: true, aParam: 'FSC-A', hParam: 'FSC-H', tolerance: 20000 },
  debris: { enabled: true, aParam: 'FSC-A', sscParam: 'SSC-A', minA: 50000, minSSC: 50000 },
  manual: { enabled: false, xParam: 'FSC-A', yParam: 'SSC-A', xMin: 0, yMin: 0 }
};

// When a channel selector of an automatic filter is touched, the 2D chart is
// pointed at exactly those two channels (singlets: A vs H · debris: A vs SSC ·
// manual: X vs Y).
const AUTO_FILTER_CHANNELS = {
  singlets: { x: 'aParam', y: 'hParam' },
  debris: { x: 'aParam', y: 'sscParam' },
  manual: { x: 'xParam', y: 'yParam' }
};

// Does event `eventIdx` of `fcs` pass all enabled automatic filters?
const passesAutoGates = (fcs, eventIdx, auto) => {
  if (!auto) return true;
  const base = eventIdx * fcs.numParams;
  const val = (paramName) => {
    if (!paramName) return null;
    const idx = fcs.params.findIndex((p) =>
      (p.name || '').toUpperCase() === paramName || (p.label || '').toUpperCase() === paramName);
    return idx >= 0 ? fcs.events[base + idx] : null;
  };
  const g = auto.singlets;
  if (g && g.enabled) {
    const a = val(g.aParam), h = val(g.hParam);
    if (a === null || h === null) return false;
    if (Math.abs(h - a) > Number(g.tolerance)) return false;
  }
  const d = auto.debris;
  if (d && d.enabled) {
    const a = val(d.aParam), ssc = val(d.sscParam);
    if (a === null || ssc === null) return false;
    if (a < Number(d.minA) || ssc < Number(d.minSSC)) return false;
  }
  const m = auto.manual;
  if (m && m.enabled) {
    const x = val(m.xParam), y = val(m.yParam);
    if (x === null || y === null) return false;
    if (x < Number(m.xMin) || y < Number(m.yMin)) return false;
  }
  return true;
};

// =========================================================================
// CANVAS 2D OVERLAY
// =========================================================================
const Canvas2DPlotOverlay = ({ series, xParam, yParam, xLabel, yLabel, logX, logY, cfg, fs, gates, autoGates, onAddGate, interactionMode, xDomain, yDomain, onZoom }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const mappingRef = useRef(null);
  const [drawPath, setDrawPath] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      
      const W = rect.width;
      const H = rect.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      const transformValue = (val, useLog) => useLog ? Math.log10(Math.max(0, val) + 1) : val;

      const validSeries = series.map(s => {
        const pX = s.fcs.params.findIndex(p => (p.name || '').toUpperCase() === xParam || (p.label || '').toUpperCase() === xParam);
        const pY = s.fcs.params.findIndex(p => (p.name || '').toUpperCase() === yParam || (p.label || '').toUpperCase() === yParam);
        if (pX < 0 || pY < 0) return null;
        return { ...s, pX, pY };
      }).filter(Boolean);

      if (!validSeries.length) return;

      let dataMinX = Infinity, dataMaxX = -Infinity;
      let dataMinY = Infinity, dataMaxY = -Infinity;

      validSeries.forEach(s => {
        for (let i = 0; i < s.fcs.numEvents; i++) {
          let pass = true;
          for (let g of gates) {
            const gXIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.xParam || (p.label||'').toUpperCase() === g.xParam);
            const gYIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.yParam || (p.label||'').toUpperCase() === g.yParam);
            if (gXIdx >= 0 && gYIdx >= 0) {
              const xRaw = s.fcs.events[i * s.fcs.numParams + gXIdx];
              const yRaw = s.fcs.events[i * s.fcs.numParams + gYIdx];
              const gx = g.logX ? Math.log10(Math.max(0, xRaw) + 1) : xRaw;
              const gy = g.logY ? Math.log10(Math.max(0, yRaw) + 1) : yRaw;
              if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
            }
          }
          if (!pass) continue;
          if (!passesAutoGates(s.fcs, i, autoGates)) continue;

          const x = transformValue(s.fcs.events[i * s.fcs.numParams + s.pX], logX);
          const y = transformValue(s.fcs.events[i * s.fcs.numParams + s.pY], logY);
          if (x < dataMinX) dataMinX = x; if (x > dataMaxX) dataMaxX = x;
          if (y < dataMinY) dataMinY = y; if (y > dataMaxY) dataMaxY = y;
        }
      });

      if (dataMinX === Infinity) { dataMinX = 0; dataMaxX = 1000; dataMinY = 0; dataMaxY = 1000; }

      const minX = xDomain ? xDomain[0] : dataMinX;
      const maxX = xDomain ? xDomain[1] : dataMaxX;
      const minY = yDomain ? yDomain[0] : dataMinY;
      const maxY = yDomain ? yDomain[1] : dataMaxY;

      const pad = { top: 20, right: 20, bottom: 45, left: 75 }; // Extended left padding to prevent Y-Axis cutoff
      const plotW = W - pad.left - pad.right;
      const plotH = H - pad.top - pad.bottom;
      if (plotW <= 0 || plotH <= 0) return;

      mappingRef.current = { minX, maxX, minY, maxY, pad, plotW, plotH, logX, logY, xParam, yParam };

      ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const gx = pad.left + (plotW * i) / 5;
        const gy = pad.top + (plotH * i) / 5;
        ctx.beginPath(); ctx.moveTo(gx, pad.top); ctx.lineTo(gx, pad.top + plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
      }

      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + plotH); ctx.lineTo(pad.left + plotW, pad.top + plotH); ctx.stroke();

      validSeries.forEach(s => {
        ctx.fillStyle = hexToRgba(s.color, 0.35); 
        for (let i = 0; i < s.fcs.numEvents; i++) {
          let pass = true;
          for (let g of gates) {
            const gXIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.xParam || (p.label||'').toUpperCase() === g.xParam);
            const gYIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.yParam || (p.label||'').toUpperCase() === g.yParam);
            if (gXIdx >= 0 && gYIdx >= 0) {
              const xRaw = s.fcs.events[i * s.fcs.numParams + gXIdx];
              const yRaw = s.fcs.events[i * s.fcs.numParams + gYIdx];
              const gx = g.logX ? Math.log10(Math.max(0, xRaw) + 1) : xRaw;
              const gy = g.logY ? Math.log10(Math.max(0, yRaw) + 1) : yRaw;
              if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
            }
          }
          if (!pass) continue;
          if (!passesAutoGates(s.fcs, i, autoGates)) continue;

          const x = transformValue(s.fcs.events[i * s.fcs.numParams + s.pX], logX);
          const y = transformValue(s.fcs.events[i * s.fcs.numParams + s.pY], logY);
          
          if (x < minX || x > maxX || y < minY || y > maxY) continue;

          const px = pad.left + ((x - minX) / (maxX - minX || 1)) * plotW;
          const py = pad.top + plotH - ((y - minY) / (maxY - minY || 1)) * plotH;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      });

      const toPxX = (dx) => pad.left + ((dx - minX) / (maxX - minX || 1)) * plotW;
      const toPxY = (dy) => pad.top + plotH - ((dy - minY) / (maxY - minY || 1)) * plotH;

      gates.forEach((g, idx) => {
        if (g.xParam === xParam && g.yParam === yParam) {
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
          ctx.beginPath();
          g.vertices.forEach((v, i) => {
            const px = toPxX(v.x); const py = toPxY(v.y);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath(); ctx.fill(); ctx.stroke();
          
          ctx.fillStyle = '#ef4444'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left';
          ctx.fillText(`Gate ${idx + 1}`, toPxX(g.vertices[0].x), toPxY(g.vertices[0].y) - 5);
        }
      });

      if (drawPath && drawPath.length > 0) {
        if (interactionMode === 'zoom' && drawPath.length === 2) {
            const x = Math.min(drawPath[0].x, drawPath[1].x);
            const y = Math.min(drawPath[0].y, drawPath[1].y);
            const w = Math.abs(drawPath[0].x - drawPath[1].x);
            const h = Math.abs(drawPath[0].y - drawPath[1].y);
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            ctx.fillRect(x, y, w, h);
            ctx.setLineDash([]);
        } else if (interactionMode === 'gate') {
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.moveTo(drawPath[0].x, drawPath[0].y);
            for (let i = 1; i < drawPath.length; i++) ctx.lineTo(drawPath[i].x, drawPath[i].y);
            ctx.stroke(); ctx.setLineDash([]);
        }
      }

      ctx.fillStyle = axisTitleColorOf(cfg, '#334155'); ctx.font = `bold ${Number(tickSize(cfg)) || 12}px ${fontFamilyOf(cfg) || 'sans-serif'}`; ctx.textAlign = 'center';
      ctx.fillText(`${xLabel}${logX ? ' (Log)' : ''}`, pad.left + plotW / 2, H - 10);
      
      ctx.save(); ctx.translate(20, pad.top + plotH / 2); ctx.rotate(-Math.PI / 2); // Shifted Y-label rightward
      ctx.fillText(`${yLabel}${logY ? ' (Log)' : ''}`, 0, 0); ctx.restore();
      
      ctx.fillStyle = tickColorOf(cfg); ctx.font = `${Math.max(9, (Number(tickSize(cfg)) || 12) - 2)}px ${fontFamilyOf(cfg) || 'sans-serif'}`;
      for (let i = 0; i <= 5; i++) {
        const valX = minX + (maxX - minX) * (i / 5);
        const valY = minY + (maxY - minY) * (i / 5);
        ctx.textAlign = 'center'; ctx.fillText(formatTickVal(valX), pad.left + (plotW * i) / 5, pad.top + plotH + 15);
        ctx.textAlign = 'right'; ctx.fillText(formatTickVal(valY), pad.left - 5, pad.top + plotH - (plotH * i) / 5 + 3);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [series, xParam, yParam, xLabel, yLabel, logX, logY, cfg, fs, drawPath, gates, autoGates, interactionMode, xDomain, yDomain]);

  const handleMouseDown = (e) => {
    if (!mappingRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const m = mappingRef.current;
    if (x >= m.pad.left && x <= m.pad.left + m.plotW && y >= m.pad.top && y <= m.pad.top + m.plotH) {
      if (interactionMode === 'zoom') {
          setDrawPath([{x, y}, {x, y}]); 
      } else {
          setDrawPath([{x, y}]); 
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!drawPath) return;
    const rect = wrapRef.current.getBoundingClientRect();
    if (interactionMode === 'zoom') {
        setDrawPath(prev => [prev[0], {x: e.clientX - rect.left, y: e.clientY - rect.top}]);
    } else {
        setDrawPath(prev => [...prev, {x: e.clientX - rect.left, y: e.clientY - rect.top}]);
    }
  };

  const handleMouseUp = () => {
    if (!drawPath || !mappingRef.current) return;
    const m = mappingRef.current;
    const toDataX = (px) => m.minX + ((px - m.pad.left) / m.plotW) * (m.maxX - m.minX);
    const toDataY = (py) => m.minY + ((m.pad.top + m.plotH - py) / m.plotH) * (m.maxY - m.minY);
    
    if (interactionMode === 'zoom') {
        if (drawPath.length === 2 && onZoom) {
            const startX = toDataX(drawPath[0].x);
            const curX = toDataX(drawPath[1].x);
            const startY = toDataY(drawPath[0].y);
            const curY = toDataY(drawPath[1].y);
            const minX = Math.min(startX, curX);
            const maxX = Math.max(startX, curX);
            const minY = Math.min(startY, curY);
            const maxY = Math.max(startY, curY);
            if (maxX - minX > (m.maxX - m.minX) * 0.01 && maxY - minY > (m.maxY - m.minY) * 0.01) {
                onZoom({ xDomain: [minX, maxX], yDomain: [minY, maxY] });
            }
        }
    } else if (interactionMode === 'gate' && onAddGate) {
        if (drawPath.length > 5) {
          const polyData = drawPath.map(p => ({ x: toDataX(p.x), y: toDataY(p.y) }));
          const xs = polyData.map(p => p.x); const ys = polyData.map(p => p.y);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          if (w > (m.maxX - m.minX) * 0.01 && h > (m.maxY - m.minY) * 0.01) {
            onAddGate({ id: `gate_${Date.now()}`, xParam: m.xParam, yParam: m.yParam, logX: m.logX, logY: m.logY, vertices: polyData });
          }
        }
    }
    setDrawPath(null);
  };

  return (
    <div 
      ref={wrapRef} 
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
      style={fs ? { width: '100%', height: '100%' } : chartRatioBoxStyle(cfg, 1.8, { width: '100%', height: cfg.height || 380 })} 
      className={`relative rounded-lg border border-slate-200 bg-white overflow-hidden cursor-crosshair ${fs ? 'flex-1 min-h-0' : 'min-h-[300px]'}`}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};

// =========================================================================
// COLOR PALETTES
// =========================================================================

// =========================================================================
// EXPORTED: DATA ANALYSIS: FCS OVERLAY (1D Histogram specific for Analysis Tab)
// =========================================================================
// =========================================================================
// EXPORTED: DATA ANALYSIS: FCS OVERLAY (1D Histogram specific for Analysis Tab)
// =========================================================================
export const FCSOverlayVisualization = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const vizCfgAna = activeTest.vizCfgAnalysis || {};
  const setVizCfgAna = (patch) => updateActiveTest({ vizCfgAnalysis: { ...vizCfgAna, ...patch } });
  const cfgAna = { ...DEFAULT_CHART_STYLE, ...vizCfgAna };

  // Split view ("stacked spectra") has its OWN Graphical Parameters panel so the
  // user can enlarge its characters / adjust its charts independently.
  const vizCfgSplit = activeTest.vizCfgSplit || {};
  const setVizCfgSplit = (patch) => updateActiveTest({ vizCfgSplit: { ...vizCfgSplit, ...patch } });
  const cfgSplit = { ...DEFAULT_SPLIT_STYLE, ...vizCfgSplit };
  const [showCfgSplit, setShowCfgSplit] = useState(false);

  const [fs, setFs] = useState(false);
  const [showCfg, setShowCfg] = useState(false);

  const hiddenSeries = activeTest.hiddenSeries || {}; 
  const paramRenames = activeTest.paramRenames || {};
  const panelArray = activeTest.fcPanel || [];

  const [localColors, setLocalColors] = useState(activeTest.fcColors || {});
  const [customPaletteInput, setCustomPaletteInput] = useState('#ef4444, #3b82f6, #22c55e');

  const instances = useMemo(() => {
    let list = null;
    // "Single instance" mode (the Instances linked toggle is OFF, or spectra
    // were uploaded as multiple files into this instance) → never overlay the
    // other instances: only this instance's spectra (main file + extras).
    if (instancesLinked(activeTest) && ctx) {
      if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch {} }
      if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
      if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
      if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
        const all = ctx.tests || ctx.allTests;
        list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
      }
    }
    if (!list || !list.length) list = [activeTest];
    const norm = list.filter(Boolean).map(t => ({ id: t.id, name: t.instanceName || t.name, test: t }));
    if (!norm.some(i => i.id === activeTest.id)) norm.unshift({ id: activeTest.id, name: activeTest.name, test: activeTest });
    // Extra spectra loaded into the same instance ("Multiple files → same instance")
    (activeTest.fcExtraFiles || []).forEach(f => {
      if (!norm.some(i => i.id === f.id)) {
        norm.push({ id: f.id, name: String(f.filename || '').replace(/\.[^/.]+$/, '') || f.filename || 'Spectrum', test: activeTest, extra: true });
      }
    });
    return norm;
  }, [ctx, activeTest]);

  const loadedInstances = instances.filter(inst => globalFcsCache[inst.id]);
  const visibleList = loadedInstances.filter(inst => !hiddenSeries[inst.id]);
  const visibleInstances = visibleList.map((inst, idx) => {
    const fcs = globalFcsCache[inst.id];
    return { ...inst, fcs, name: fcs.filename || inst.name, color: resolveFcsColor(cfgAna, localColors, inst, idx, visibleList.length) };
  });

  const rawSharedParams = useMemo(() => {
    if (!loadedInstances.length) return [];
    const map = new Map();
    loadedInstances.forEach(inst => {
      globalFcsCache[inst.id].params.forEach(p => {
        const key = (p.name || '').toUpperCase();
        if (key && !map.has(key)) map.set(key, p);
      });
    });
    return Array.from(map.values()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  }, [loadedInstances]);

  const [overlayParam, setOverlayParam] = useState('');
  const [logScale, setLogScale] = useState(false);
  // When ON, each curve is drawn in its OWN small chart, stacked vertically in
  // a tall panel on the right of the superposed overlay.
  const [splitStack, setSplitStack] = useState(!!vizCfgAna.splitStack);
  const toggleSplitStack = () => {
    setSplitStack((v) => {
      const nv = !v;
      setVizCfgAna({ splitStack: nv });
      return nv;
    });
  };
  // When ON, every stacked mini-chart shares the SAME Y scale (global max).
  const [splitSharedY, setSplitSharedY] = useState(!!vizCfgAna.splitSharedY);
  const toggleSplitSharedY = () => {
    setSplitSharedY((v) => {
      const nv = !v;
      setVizCfgAna({ splitSharedY: nv });
      return nv;
    });
  };
  // Histogram cosmetics: superimpose a smoothed line and/or fill the area
  // under the curve (per peak) with the series colour.
  const [smoothHist, setSmoothHist] = useState(!!vizCfgAna.smoothHist);
  const [fillHist, setFillHist] = useState(!!vizCfgAna.fillHist);
  const [smoothSigma, setSmoothSigma] = useState(Number(vizCfgAna.smoothSigma) || 2);
  const toggleSmooth = () => {
    setSmoothHist((v) => {
      const nv = !v;
      setVizCfgAna({ smoothHist: nv });
      return nv;
    });
  };
  const toggleFill = () => {
    setFillHist((v) => {
      const nv = !v;
      setVizCfgAna({ fillHist: nv });
      return nv;
    });
  };

  // Graphical Parameters' "Log X" is the SAME control as the native "Log"
  // checkbox here: the panel writes cfgAna.xLog and the histogram pre-transforms
  // the channel values with log10, so we keep them in sync.
  useEffect(() => {
    setLogScale(!!cfgAna.xLog);
  }, [cfgAna.xLog]);

  useEffect(() => {
    if (rawSharedParams.length > 0 && !rawSharedParams.find(p => p.name.toUpperCase() === overlayParam)) {
      setOverlayParam(rawSharedParams[0].name.toUpperCase());
    }
  }, [rawSharedParams, overlayParam]);

  const chartData = useMemo(() => {
    if (!overlayParam || !visibleInstances.length) return { bins: [], domain: [0, 1] };
    let globalMin = Infinity; let globalMax = -Infinity;
    const transformValue = (val) => logScale ? Math.log10(Math.max(0, val) + 1) : val;

    const rawSeries = visibleInstances.map(s => {
      const pIdx = s.fcs.params.findIndex(p => (p.name || '').toUpperCase() === overlayParam || (p.label || '').toUpperCase() === overlayParam);
      if (pIdx < 0) return { id: s.id, data: null };

      const channelData = new Float32Array(s.fcs.numEvents);
      for (let i = 0; i < s.fcs.numEvents; i++) {
        let val = transformValue(s.fcs.events[i * s.fcs.numParams + pIdx]);
        channelData[i] = val;
        if (val < globalMin) globalMin = val;
        if (val > globalMax) globalMax = val;
      }
      return { id: s.id, data: channelData };
    });

    if (globalMin === Infinity) { globalMin = 0; globalMax = 1000; }
    const BINS = 200;
    const binWidth = (globalMax - globalMin) / BINS || 1;
    const bins = Array.from({ length: BINS }, (_, i) => ({ x: globalMin + (i + 0.5) * binWidth }));

    rawSeries.forEach(series => {
      if (!series.data) return;
      bins.forEach(b => b[series.id] = 0);
      for (let i = 0; i < series.data.length; i++) {
        let bIdx = Math.floor((series.data[i] - globalMin) / binWidth);
        if (bIdx >= BINS) bIdx = BINS - 1;
        if (bIdx < 0) bIdx = 0;
        bins[bIdx][series.id]++;
      }
      // Smoothed version of the histogram (superimposed line / filled area).
      if (smoothHist || fillHist) {
        const counts = bins.map(b => b[series.id]);
        const sm = gaussSmooth(counts, smoothSigma);
        bins.forEach((b, i) => { b[series.id + '_sm'] = sm[i]; });
      }
    });

    // Global maximum count across all visible curves — used to share the Y
    // scale between the stacked split-view charts.
    let maxCount = 0;
    visibleInstances.forEach(s => {
      bins.forEach(b => { const c = b[s.id] || 0; if (c > maxCount) maxCount = c; });
    });
    if (maxCount <= 0) maxCount = 1;

    return { bins, domain: [globalMin, globalMax], maxCount };
  }, [overlayParam, visibleInstances, logScale, smoothHist, fillHist, smoothSigma]);

  const chartRef = useRef(null);
  const zoom = useXZoom(chartRef, chartData.domain, cfgChartMargin(cfgAna, { top: 10, right: 20, left: 75, bottom: 45 }));
  useEffect(() => { zoom.reset(); }, [overlayParam, logScale]); 

  const applyPalette = (paletteKey) => {
    let palette;
    if (paletteKey === 'custom') {
      palette = customPaletteInput.split(',').map(s => s.trim()).filter(s => /^#([0-9A-F]{3}){1,2}$/i.test(s));
      if (!palette.length) return alert('Enter valid hex codes (e.g. #ff0000, #00ff00)');
    } else {
      palette = VIS_PALETTES[paletteKey] || VIS_PALETTES.default;
    }
    const nextColors = { ...localColors };
    loadedInstances.forEach((inst, idx) => {
      nextColors[inst.id] = palette[idx % palette.length];
    });
    setLocalColors(nextColors);
    updateActiveTest({ fcColors: nextColors });
  };

  if (!loadedInstances.length) return null;

  const label1D = getParamLabel({name: overlayParam}, panelArray, paramRenames);

  // Interrupted Y axis (✂ in the 🎨 panel): one bin of the histogram can hold
  // 100× the events of the others — this keeps both readable.
  const brkAna = brokenAxisProps(cfgAna, 'y', loadedInstances.flatMap(s => chartData.bins.map(b => b[s.id])), { log: !!cfgAna.yLog, min: cfgAna.yMin, max: cfgAna.yMax });

  return (
    <>
      {fs && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99990]" onClick={() => setFs(false)} />}
      <div className={fs ? "fixed inset-4 z-[99999] bg-white p-6 rounded-2xl shadow-2xl flex flex-col gap-3 overflow-hidden" : "flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full"}>
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200 mb-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
          
          <div className="flex flex-wrap items-center gap-2">
            <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 outline-none cursor-pointer min-w-[180px]">
              <option value="">🎨 Apply Palette...</option>
              {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <span className="text-slate-300 hidden md:inline">|</span>
            <input 
              type="text" 
              placeholder="#f00, #0f0..." 
              value={customPaletteInput} 
              onChange={e => setCustomPaletteInput(e.target.value)} 
              className="text-sm border border-slate-300 px-2.5 py-1.5 rounded-lg w-36 outline-none focus:border-blue-500" 
            />
            <button onClick={() => applyPalette('custom')} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap">Apply Custom</button>
          </div>
        </div>

        <div className="flex justify-between items-center z-10 shrink-0 border-b border-slate-100 pb-2">
          <h5 className="text-sm font-bold text-slate-700">1D Histogram (Data Analysis)</h5>
          <div className="flex items-center gap-2">
            <select value={overlayParam} onChange={e => setOverlayParam(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 min-w-[130px] max-w-[240px]">
              {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2">
              <input type="checkbox" checked={logScale} onChange={e => { setLogScale(e.target.checked); setVizCfgAna({ xLog: e.target.checked }); }} className="w-3.5 h-3.5 accent-blue-600" /> Log
            </label>
            <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2"
                   title="Split the superposed curves into separate graphs, stacked vertically on the right">
              <input type="checkbox" checked={splitStack} onChange={toggleSplitStack} className="w-3.5 h-3.5 accent-blue-600" /> Split
            </label>
            <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-1"
                   title="Superimpose a Gaussian-smoothed line over each histogram">
              <input type="checkbox" checked={smoothHist} onChange={toggleSmooth} className="w-3.5 h-3.5 accent-blue-600" /> Smooth
            </label>
            {smoothHist && (
              <input type="number" min="0.5" max="6" step="0.5" value={smoothSigma}
                     onChange={(e) => { const v = parseFloat(e.target.value); setSmoothSigma(v || 2); setVizCfgAna({ smoothSigma: v || 2 }); }}
                     title="Smoothing strength (σ, in bins)" className="w-14 border border-slate-300 rounded px-1 py-0.5 text-[11px] bg-white outline-none focus:border-blue-500" />
            )}
            <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2"
                   title="Colour the area under each curve / peak with the series colour">
              <input type="checkbox" checked={fillHist} onChange={toggleFill} className="w-3.5 h-3.5 accent-blue-600" /> Fill
            </label>
            <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} />
            <InstanceLinkToggle activeTest={activeTest} updateActiveTest={updateActiveTest} />
            <button type="button" onClick={() => setFs(!fs)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs ? '↙️ Exit' : '↗️ Fullscreen'}</button>
          </div>
        </div>
        
        {showCfg && <SharedChartStylePanel cfg={cfgAna} setCfg={setVizCfgAna} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}
        
        <div className={`${fs ? 'flex-1 min-h-0' : ''} ${splitStack ? 'flex flex-col lg:flex-row gap-3' : ''}`}>
          <ChartInspector
            containerRef={chartRef}
            containerProps={{ onMouseDown: zoom.onMouseDown }}
            cfg={cfgAna}
            setCfg={setVizCfgAna}
            series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))}
            unit="a.u."
            title="Double-click the plot, an axis, a label or a curve to edit it"
            className={`bg-slate-50 rounded border border-slate-200 p-2 select-none relative overflow-hidden cursor-crosshair min-w-0 ${fs ? 'flex-1 min-h-0' : splitStack ? 'lg:w-[54%]' : 'w-full'}`}
            style={!fs ? chartRatioBoxStyle(cfgAna, 1, { maxHeight: `min(${Number(cfgAna.height) || 380}px, 55vh)` }) : undefined}>
            {zoom.isZoomed && <button type="button" onClick={zoom.reset} className="absolute top-2 right-2 z-10 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
            {cfgAna.title && <div className="text-sm font-bold text-slate-700 mb-1">{cfgAna.title}</div>}
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData.bins} margin={cfgChartMargin(cfgAna, { top: 10, right: 20, left: 75, bottom: 45 })}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="x" type="number" domain={zoom.domain} allowDataOverflow ticks={cfgAxisTicks(cfgAna, 'x', zoom.domain)} tickFormatter={cfgTickFormatter(cfgAna, 'x') || ((v) => v.toFixed(logScale ? 1 : 0))} tick={{ fontSize: Math.max(9, cfgAna.fontSize - 2) }} label={cfgAxisLabel(cfgAna, 'x', `${label1D}${logScale ? ' (Log)' : ''}`, 10)} />
                <YAxis {...brkAna.axisProps} tick={{ fontSize: Math.max(9, cfgAna.fontSize - 2) }} scale={brkAna.on ? brkAna.axisProps.scale : cfgLogScale(cfgAna, 'y')} tickFormatter={cfgTickFormatter(cfgAna, 'y') || undefined} ticks={brkAna.on ? brkAna.axisProps.ticks : (cfgAna.yMin !== '' && cfgAna.yMin != null && cfgAna.yMax !== '' && cfgAna.yMax != null ? cfgAxisTicks(cfgAna, 'y', [Number(cfgAna.yMin), Number(cfgAna.yMax)]) : undefined)} label={cfgAxisLabel(cfgAna, 'y', cfgAna.yAxisLabel || 'Count', 5)} />
                <Tooltip labelFormatter={(label) => `Value: ${Number(label).toFixed(logScale ? 2 : 0)}`} formatter={(value) => [value, 'Events']} />
                {visibleInstances.map(s => {
                  const color = cfgAna.colors?.[s.id] || s.color;
                  const dash = cfgAna.lineStyle === 'dashed' ? '7 5' : cfgAna.lineStyle === 'dotted' ? '2 3' : undefined;
                  return (
                    <React.Fragment key={s.id}>
                      {fillHist && <Area type="monotone" dataKey={smoothHist ? s.id + '_sm' : s.id} name={s.name} stroke="none" fill={color} fillOpacity={Number(cfgAna.areaOpacity ?? 0.3)} isAnimationActive={false} />}
                      {cfgSeriesEl(cfgAna, { key: s.id, data: chartData.bins, dataKey: s.id, name: s.name, stroke: color })}
                      {smoothHist && <Line type="monotone" dataKey={s.id + '_sm'} name={`${s.name} (smooth)`} stroke={color} strokeWidth={cfgAna.lineThickness || 2} strokeDasharray={dash} dot={false} isAnimationActive={false} />}
                    </React.Fragment>
                  );
                })}
                {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                {brkAna.marks}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartInspector>

          {/* Split view — the whole stack is offered to the ChartStarLayer as
              ONE ⭐/📷 item (`data-star-group`), so the split figure can be
              starred / saved as a single image; each sub-graph keeps its own. */}
          {splitStack && (
            <div
              data-star-group="fcs-split"
              data-star-label="Split view — single curves"
              className={`flex flex-col gap-2 min-w-0 ${fs ? 'w-[46%]' : 'w-full lg:w-[46%]'}`}>
              <div className={`bg-white rounded border border-slate-200 flex flex-col overflow-hidden ${fs ? 'min-h-0 flex-1' : 'max-h-[560px]'}`}>
              <div className="shrink-0 px-2.5 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  📚 Split view — single curves
                  <label className="flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer normal-case"
                         title="Use the same Y scale on every stacked graph">
                    <input type="checkbox" checked={splitSharedY} onChange={toggleSplitSharedY} className="w-3 h-3 accent-blue-600" /> Same Y
                  </label>
                  <ChartControlBar showCfg={showCfgSplit} onToggleCfg={() => setShowCfgSplit(!showCfgSplit)} />
                </span>
                <span className="text-slate-400">{visibleInstances.length} {visibleInstances.length === 1 ? 'curve' : 'curves'}</span>
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1">
                {visibleInstances.map((s, i) => (
                  <div key={s.id} className="border-b border-slate-100 last:border-b-0">
                    <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold truncate flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-slate-700 truncate">{s.name}</span>
                    </div>
                    <ChartInspector cfg={cfgSplit} setCfg={setVizCfgSplit}
                      series={visibleInstances.map(x => ({ key: x.id, label: x.name, color: x.color }))} unit="a.u."
                      className="w-1/2 mx-auto pb-1">
                      <ResponsiveContainer width="100%" height={Number(cfgSplit.height) || 80}>
                        <ComposedChart data={chartData.bins} margin={cfgChartMargin(cfgSplit, { top: 2, right: 4, left: 0, bottom: 0 })}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="x" type="number" domain={zoom.domain} allowDataOverflow hide={i < visibleInstances.length - 1} tickFormatter={cfgTickFormatter(cfgSplit, 'x') || undefined} tick={{ fontSize: Math.max(9, Number(cfgSplit.fontSize) || 11), fill: tickColorOf(cfgSplit) }} />
                          <YAxis tickFormatter={cfgTickFormatter(cfgSplit, 'y') || undefined} tick={{ fontSize: Math.max(9, Number(cfgSplit.fontSize) || 11), fill: tickColorOf(cfgSplit) }} width={Math.max(30, (Number(cfgSplit.fontSize) || 11) + 22)} domain={splitSharedY ? [0, chartData.maxCount] : [0, 'auto']} />
                          {fillHist && <Area type="monotone" dataKey={smoothHist ? s.id + '_sm' : s.id} name={s.name} stroke="none" fill={cfgSplit.colors?.[s.id] || s.color} fillOpacity={Number(cfgSplit.areaOpacity ?? 0.3)} isAnimationActive={false} />}
                          {cfgSeriesEl(cfgSplit, { key: s.id, data: chartData.bins, dataKey: s.id, name: s.name, stroke: cfgSplit.colors?.[s.id] || s.color })}
                          {smoothHist && <Line type="monotone" dataKey={s.id + '_sm'} name={`${s.name} (smooth)`} stroke={cfgSplit.colors?.[s.id] || s.color} strokeWidth={cfgSplit.lineThickness || 2} strokeDasharray={cfgSplit.lineStyle === 'dashed' ? '7 5' : cfgSplit.lineStyle === 'dotted' ? '2 3' : undefined} dot={false} isAnimationActive={false} />}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ChartInspector>
                  </div>
                ))}
              </div>
              </div>
              {showCfgSplit && (
                <SharedChartStylePanel cfg={cfgSplit} setCfg={setVizCfgSplit} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// =========================================================================
// EXPORTED: DATA TAB VISUALIZATIONS (1D + 2D)
// =========================================================================
// =========================================================================
// EXPORTED: DATA TAB VISUALIZATIONS (1D + 2D)
// =========================================================================
export const FCSDataVisualizations = ({ ctx, updater }) => {
  const { activeTest, updateActiveTest } = ctx;
  
  const vizCfg1D = activeTest.vizCfg1D || {};
  const setVizCfg1D = (patch) => updateActiveTest({ vizCfg1D: { ...vizCfg1D, ...patch } });
  const cfg1D = { ...DEFAULT_CHART_STYLE, ...vizCfg1D };

  const vizCfg2D = activeTest.vizCfg2D || {};
  const setVizCfg2D = (patch) => updateActiveTest({ vizCfg2D: { ...vizCfg2D, ...patch } });
  const cfg2D = { ...DEFAULT_CHART_STYLE, ...vizCfg2D };

  const [fs1D, setFs1D] = useState(false);
  const [showCfg1D, setShowCfg1D] = useState(false);
  const [fs2D, setFs2D] = useState(false);
  const [showCfg2D, setShowCfg2D] = useState(false);
  
  const [showRenamer, setShowRenamer] = useState(false);
  const [hiddenSeries, setHiddenSeries] = useState({});
  const [gates, setGates] = useState([]);

  // Automatic treatment ("🤖 Auto treatment"): singlets, debris, manual filter.
  const [autoGates, setAutoGates] = useState(() => ({
    singlets: { ...DEFAULT_AUTO_GATES.singlets, ...((activeTest.fcAutoGates || {}).singlets || {}) },
    debris: { ...DEFAULT_AUTO_GATES.debris, ...((activeTest.fcAutoGates || {}).debris || {}) },
    manual: { ...DEFAULT_AUTO_GATES.manual, ...((activeTest.fcAutoGates || {}).manual || {}) }
  }));
  const [showAutoGates, setShowAutoGates] = useState(false);
  const resetAutoGates = () => {
    const next = {
      singlets: { ...DEFAULT_AUTO_GATES.singlets },
      debris: { ...DEFAULT_AUTO_GATES.debris },
      manual: { ...DEFAULT_AUTO_GATES.manual }
    };
    setAutoGates(next);
    updateActiveTest({ fcAutoGates: next });
  };
  // Remove an extra spectrum that was loaded into the same instance.
  const removeExtraFile = (extraId) => {
    delete globalFcsCache[extraId];
    removeFcsFile(extraId);
    updateActiveTest({ fcExtraFiles: (activeTest.fcExtraFiles || []).filter((f) => f.id !== extraId) });
  };

  const [interactionMode, setInteractionMode] = useState('gate'); 
  const [xDomain2D, setXDomain2D] = useState(null);
  const [yDomain2D, setYDomain2D] = useState(null);

  const [localColors, setLocalColors] = useState(activeTest.fcColors || {});
  const [customPaletteInput, setCustomPaletteInput] = useState('#ef4444, #3b82f6, #22c55e');

  const updateColor = (id, color) => {
    const next = { ...localColors, [id]: color };
    setLocalColors(next);
    updateActiveTest({ fcColors: next });
  };
  
  const paramRenames = activeTest.paramRenames || {};
  const setParamRenames = (patch) => updateActiveTest({ paramRenames: { ...paramRenames, ...patch } });
  const panelArray = activeTest.fcPanel || [];

  const instances = useMemo(() => {
    let list = null;
    // "Single instance" mode (the Instances linked toggle is OFF, or spectra
    // were uploaded as multiple files into this instance) → never overlay the
    // other instances: only this instance's spectra (main file + extras).
    if (instancesLinked(activeTest) && ctx) {
      if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch {} }
      if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
      if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
      if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
        const all = ctx.tests || ctx.allTests;
        list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
      }
    }
    if (!list || !list.length) list = [activeTest];
    const norm = list.filter(Boolean).map(t => ({ id: t.id, name: t.instanceName || t.name, test: t }));
    if (!norm.some(i => i.id === activeTest.id)) norm.unshift({ id: activeTest.id, name: activeTest.name, test: activeTest });
    // Extra spectra loaded into the same instance ("Multiple files → same instance")
    (activeTest.fcExtraFiles || []).forEach(f => {
      if (!norm.some(i => i.id === f.id)) {
        norm.push({ id: f.id, name: String(f.filename || '').replace(/\.[^/.]+$/, '') || f.filename || 'Spectrum', test: activeTest, extra: true });
      }
    });
    return norm;
  }, [ctx, activeTest]);

  const loadedInstances = instances.filter(inst => globalFcsCache[inst.id]);
  const visibleList = loadedInstances.filter(inst => !hiddenSeries[inst.id]);
  const visibleInstances = visibleList.map((inst, idx) => {
    const fcs = globalFcsCache[inst.id];
    return { ...inst, fcs, name: fcs.filename || inst.name, color: resolveFcsColor({ ...cfg1D, ...cfg2D }, localColors, inst, idx, visibleList.length) };
  });

  const rawSharedParams = useMemo(() => {
    if (!loadedInstances.length) return [];
    const map = new Map();
    loadedInstances.forEach(inst => {
      globalFcsCache[inst.id].params.forEach(p => {
        const key = (p.name || '').toUpperCase();
        if (key && !map.has(key)) map.set(key, p);
      });
    });
    return Array.from(map.values()).sort((a,b) => (a.name||'').localeCompare(b.name||''));
  }, [loadedInstances]);

  const applyPalette = (paletteKey) => {
    let palette;
    if (paletteKey === 'custom') {
      palette = customPaletteInput.split(',').map(s => s.trim()).filter(s => /^#([0-9A-F]{3}){1,2}$/i.test(s));
      if (!palette.length) return alert('Enter valid hex codes (e.g. #ff0000, #00ff00)');
    } else {
      palette = VIS_PALETTES[paletteKey] || VIS_PALETTES.default;
    }
    const nextColors = { ...localColors };
    loadedInstances.forEach((inst, idx) => {
      nextColors[inst.id] = palette[idx % palette.length];
    });
    setLocalColors(nextColors);
    updateActiveTest({ fcColors: nextColors });
  };

  const [overlayParam1D, setOverlayParam1D] = useState('');
  const [xParam2D, setXParam2D] = useState('');
  const [yParam2D, setYParam2D] = useState('');

  // Edit an automatic filter. When one of its channel selectors is touched the
  // 2D chart automatically switches to those exact axes (singlets: A vs H ·
  // debris: A vs SSC · manual: X vs Y).
  const patchAutoGate = (key, patch) => {
    setAutoGates((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } };
      updateActiveTest({ fcAutoGates: next });
      return next;
    });
    const def = AUTO_FILTER_CHANNELS[key];
    if (def && patch && typeof patch === 'object') {
      const cur = { ...autoGates[key], ...patch };
      const x = def.x in patch ? patch[def.x] : cur[def.x];
      const y = def.y in patch ? patch[def.y] : cur[def.y];
      if (x && y) { setXParam2D(x); setYParam2D(y); }
    }
  };

  // Apply the ACTIVE instance's exact settings to every other instance of the
  // experiment: chart styles (characters, ranges, log…), the automatic
  // treatment (singlets / debris / manual filters), the 2D zoom, parameter
  // renames, the staining panel, the hidden-series map and the experimental
  // setup plate (fcPlate).
  //
  // IMPORTANT: the targets are the SIBLING instances of the same experiment
  // group (same `name`), resolved independently of the linked/single-instance
  // display mode — in "single instance" mode (toggle OFF, or files uploaded
  // into the current instance) the overlay `instances` list only contains the
  // current test, but the siblings still exist and must be updated.
  const copySettingsToAllInstances = () => {
    if (typeof ctx.setTests !== 'function') return;
    const sources = [];
    if (typeof ctx.getInstances === 'function') { try { sources.push(...(ctx.getInstances() || [])); } catch {} }
    if (Array.isArray(ctx.instances)) sources.push(...ctx.instances);
    if (Array.isArray(ctx.siblings)) sources.push(...ctx.siblings);
    if (Array.isArray(ctx.tests)) sources.push(...ctx.tests);
    if (Array.isArray(ctx.allTests)) sources.push(...ctx.allTests);
    // The overlay `instances` entries are normalized { id, name, test } objects.
    if (Array.isArray(instances)) sources.push(...instances.map((i) => i.test).filter(Boolean));
    const seen = new Set();
    const others = [];
    sources.forEach((t) => {
      if (!t || !t.id || seen.has(t.id)) return;
      seen.add(t.id);
      if (t.id === activeTest.id) return;
      if (t.extra) return;
      if (activeTest.name && String(t.name || '') !== String(activeTest.name || '')) return;
      others.push(t);
    });
    if (others.length === 0) { alert('There are no other instances to copy the settings to.'); return; }
    if (!window.confirm(`Apply the current settings to ${others.length} other instance(s)?`)) return;
    const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const patch = {
      vizCfgAnalysis: clone(activeTest.vizCfgAnalysis),
      vizCfg1D: clone(activeTest.vizCfg1D),
      vizCfg2D: clone(activeTest.vizCfg2D),
      vizCfgFreq: clone(activeTest.vizCfgFreq),
      vizCfgSplit: clone(activeTest.vizCfgSplit),
      fcAutoGates: clone(activeTest.fcAutoGates),
      paramRenames: clone(activeTest.paramRenames),
      fcPanel: clone(activeTest.fcPanel),
      hiddenSeries: clone(activeTest.hiddenSeries),
      fcZoom2D: clone(activeTest.fcZoom2D),
      fcPlate: clone(activeTest.fcPlate)
    };
    ctx.setTests(prev => prev.map(t =>
      (others.some(o => o.id === t.id))
        ? { ...t, ...patch }
        : t
    ));
  };

  // Graphical Parameters' "Log X" is the SAME control as the native "Log"
  // checkbox of the 1D histogram (the histogram pre-transforms channel values
  // with log10), so the panel command is mirrored onto the local toggle.
  useEffect(() => {
    setLog1D(!!cfg1D.xLog);
  }, [cfg1D.xLog]);
  
  const [log1D, setLog1D] = useState(false);
  const [logX2D, setLogX2D] = useState(false);
  const [logY2D, setLogY2D] = useState(false);

  useEffect(() => {
    if (rawSharedParams.length > 0) {
      const keys = rawSharedParams.map(p => p.name.toUpperCase());
      if (!keys.includes(overlayParam1D)) setOverlayParam1D(keys[0]);
      if (!keys.includes(xParam2D)) setXParam2D(keys.find(k => k.includes('FSC')) || keys[0]);
      if (!keys.includes(yParam2D)) setYParam2D(keys.find(k => k.includes('SSC')) || keys[1] || keys[0]);
    }
  }, [rawSharedParams, overlayParam1D, xParam2D, yParam2D]);

  // The saved 2D zoom (stable object reference) that matches the current
  // axes/log settings — restored on open/param change and copied to instances.
  const savedZoom2D =
    activeTest.fcZoom2D &&
    activeTest.fcZoom2D.xParam === xParam2D &&
    activeTest.fcZoom2D.yParam === yParam2D &&
    !!activeTest.fcZoom2D.logX === logX2D &&
    !!activeTest.fcZoom2D.logY === logY2D
      ? activeTest.fcZoom2D
      : null;

  useEffect(() => {
    setXDomain2D(savedZoom2D ? savedZoom2D.x : null);
    setYDomain2D(savedZoom2D ? savedZoom2D.y : null);
  }, [xParam2D, yParam2D, logX2D, logY2D, savedZoom2D]);

  const chartData1D = useMemo(() => {
    if (!overlayParam1D || !visibleInstances.length) return { bins: [], domain: [0, 1] };
    let globalMin = Infinity; let globalMax = -Infinity;
    const transformValue = (val) => log1D ? Math.log10(Math.max(0, val) + 1) : val;

    const rawSeries = visibleInstances.map(s => {
      const pIdx = s.fcs.params.findIndex(p => (p.name || '').toUpperCase() === overlayParam1D || (p.label || '').toUpperCase() === overlayParam1D);
      if (pIdx < 0) return { id: s.id, data: null };

      const channelData = [];
      for (let i = 0; i < s.fcs.numEvents; i++) {
        let pass = true;
        for (let g of gates) {
          const gXIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.xParam || (p.label||'').toUpperCase() === g.xParam);
          const gYIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.yParam || (p.label||'').toUpperCase() === g.yParam);
          if (gXIdx >= 0 && gYIdx >= 0) {
             const xRaw = s.fcs.events[i * s.fcs.numParams + gXIdx];
             const yRaw = s.fcs.events[i * s.fcs.numParams + gYIdx];
             const gx = g.logX ? Math.log10(Math.max(0, xRaw) + 1) : xRaw;
             const gy = g.logY ? Math.log10(Math.max(0, yRaw) + 1) : yRaw;
             if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
          }
        }
        if (!pass) continue;
        if (!passesAutoGates(s.fcs, i, autoGates)) continue;
        
        let val = transformValue(s.fcs.events[i * s.fcs.numParams + pIdx]);
        channelData.push(val);
        if (val < globalMin) globalMin = val;
        if (val > globalMax) globalMax = val;
      }
      return { id: s.id, data: new Float32Array(channelData) };
    });

    if (globalMin === Infinity) { globalMin = 0; globalMax = 1000; }
    const BINS = 200;
    const binWidth = (globalMax - globalMin) / BINS || 1;
    const bins = Array.from({ length: BINS }, (_, i) => ({ x: globalMin + (i + 0.5) * binWidth }));

    rawSeries.forEach(series => {
      if (!series.data) return;
      bins.forEach(b => b[series.id] = 0);
      for (let i = 0; i < series.data.length; i++) {
        let bIdx = Math.floor((series.data[i] - globalMin) / binWidth);
        if (bIdx >= BINS) bIdx = BINS - 1;
        if (bIdx < 0) bIdx = 0;
        bins[bIdx][series.id]++;
      }
    });

    return { bins, domain: [globalMin, globalMax] };
  }, [overlayParam1D, visibleInstances, log1D, gates, autoGates]);

  // Shared auto X/Y domain for the 2D plot — computed at the parent level so the
  // 1D histogram and the 2D chart ALWAYS use the exact same value range (and
  // zooming one moves the other). Mirrors the canvas's own min/max scan.
  const autoDomain2D = useMemo(() => {
    if (!xParam2D || !yParam2D || !visibleInstances.length) return null;
    const tX = (val) => logX2D ? Math.log10(Math.max(0, val) + 1) : val;
    const tY = (val) => logY2D ? Math.log10(Math.max(0, val) + 1) : val;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visibleInstances.forEach((s) => {
      const pX = s.fcs.params.findIndex((p) => (p.name || '').toUpperCase() === xParam2D || (p.label || '').toUpperCase() === xParam2D);
      const pY = s.fcs.params.findIndex((p) => (p.name || '').toUpperCase() === yParam2D || (p.label || '').toUpperCase() === yParam2D);
      if (pX < 0 || pY < 0) return;
      for (let i = 0; i < s.fcs.numEvents; i++) {
        let pass = true;
        for (const g of gates) {
          const gX = s.fcs.params.findIndex((p) => (p.name || '').toUpperCase() === g.xParam || (p.label || '').toUpperCase() === g.xParam);
          const gY = s.fcs.params.findIndex((p) => (p.name || '').toUpperCase() === g.yParam || (p.label || '').toUpperCase() === g.yParam);
          if (gX >= 0 && gY >= 0) {
            const gx = g.logX ? Math.log10(Math.max(0, s.fcs.events[i * s.fcs.numParams + gX]) + 1) : s.fcs.events[i * s.fcs.numParams + gX];
            const gy = g.logY ? Math.log10(Math.max(0, s.fcs.events[i * s.fcs.numParams + gY]) + 1) : s.fcs.events[i * s.fcs.numParams + gY];
            if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
          }
        }
        if (!pass) continue;
        if (!passesAutoGates(s.fcs, i, autoGates)) continue;
        const x = tX(s.fcs.events[i * s.fcs.numParams + pX]);
        const y = tY(s.fcs.events[i * s.fcs.numParams + pY]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    });
    if (minX === Infinity) return { x: [0, 1000], y: [0, 1000] };
    return { x: [minX, maxX], y: [minY, maxY] };
  }, [xParam2D, yParam2D, logX2D, logY2D, visibleInstances, gates, autoGates]);

  // When the histogram parameter is the SAME as the 2D chart's X parameter (and
  // the log settings match), the histogram mirrors the 2D chart's X axis exactly.
  // NOTE: computed AFTER zoom1D is declared — referencing zoom1D before its
  // `const` initialization would throw a "Cannot access ... before initialization"
  // (temporal dead zone) error on FCS load.
  const chartRef1D = useRef(null);
  const zoom1D = useXZoom(chartRef1D, chartData1D.domain, cfgChartMargin(cfg1D, { top: 10, right: 20, left: 75, bottom: 45 }));
  useEffect(() => { zoom1D.reset(); }, [overlayParam1D, log1D]);

  const histXMirrors2D = overlayParam1D === xParam2D && log1D === logX2D;
  const histDomain = histXMirrors2D ? (xDomain2D || chartData1D.domain) : zoom1D.domain;

  if (!loadedInstances.length) return null;

  const label1D = getParamLabel({name: overlayParam1D}, panelArray, paramRenames);
  const labelX2D = getParamLabel({name: xParam2D}, panelArray, paramRenames);
  const labelY2D = getParamLabel({name: yParam2D}, panelArray, paramRenames);

  // Interrupted Y axis (✂ in the 🎨 panel) of the 1D histogram.
  const brk1D = brokenAxisProps(cfg1D, 'y', loadedInstances.flatMap(s => chartData1D.bins.map(b => b[s.id])), { log: !!cfg1D.yLog, min: cfg1D.yMin, max: cfg1D.yMax });

  return (
    <div className="flex flex-col gap-4 mt-2 w-full">
      <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-2 border-b border-slate-200 pb-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
          
          <div className="flex flex-wrap items-center gap-2">
            <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 outline-none cursor-pointer min-w-[180px]">
              <option value="">🎨 Apply Palette...</option>
              {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <span className="text-slate-300 hidden md:inline">|</span>
            <input 
              type="text" 
              placeholder="#f00, #0f0..." 
              value={customPaletteInput} 
              onChange={e => setCustomPaletteInput(e.target.value)} 
              className="text-sm border border-slate-300 px-2.5 py-1.5 rounded-lg w-36 outline-none focus:border-blue-500" 
            />
            <button onClick={() => applyPalette('custom')} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap">Apply Custom</button>
            <span className="text-slate-300 hidden md:inline">|</span>
            <InstanceLinkToggle activeTest={activeTest} updateActiveTest={updateActiveTest} />
            <button onClick={() => setShowRenamer(!showRenamer)} className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap">✏️ Rename Parameters</button>
            <button onClick={() => setShowAutoGates(!showAutoGates)}
                    className={`text-sm font-bold px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 border whitespace-nowrap ${showAutoGates ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-300 text-slate-700'}`}
                    title="Automatic treatment: singlets, debris exclusion and a manual channel filter">
              🤖 Auto treatment
            </button>
            <button
              type="button"
              onClick={copySettingsToAllInstances}
              title="Apply this instance's exact settings to every other instance: chart styles (characters, ranges, log), automatic filters, 2D zoom, parameter renames, panel, colors and the Experimental Setup plate"
              className="text-sm font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap"
            >
              📋 Copy settings to all
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {loadedInstances.map((inst, idx) => {
            const c = localColors[inst.id] || COLORS[idx % COLORS.length];
            const isHidden = hiddenSeries[inst.id];
            const displayName = globalFcsCache[inst.id]?.filename || inst.name;
            return (
              <div key={inst.id} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-bold border ${isHidden ? 'bg-slate-200 border-slate-300 text-slate-400' : 'bg-white border-slate-300 text-slate-700 shadow-sm'}`}>
                <input type="checkbox" checked={!isHidden} onChange={() => setHiddenSeries(p => ({ ...p, [inst.id]: !p[inst.id] }))} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer" />
                <input type="color" value={c} onChange={(e) => updateColor(inst.id, e.target.value)} className="w-5 h-5 rounded cursor-pointer border border-slate-300 p-0" />
                <span className="truncate max-w-[200px] cursor-pointer select-none" onClick={() => setHiddenSeries(p => ({ ...p, [inst.id]: !p[inst.id] }))}>{displayName}</span>
                {inst.extra && (
                  <button onClick={() => removeExtraFile(inst.id)} className="text-red-400 hover:text-red-600 font-black px-1" title="Remove this spectrum from the instance">×</button>
                )}
              </div>
            );
          })}
        </div>
        
        {showRenamer && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-indigo-50 p-3 rounded-lg border border-indigo-200 mt-2">
            {rawSharedParams.map(p => {
              const key = p.name.toUpperCase();
              const defaultLabel = getParamLabel(p, panelArray, {});
              return (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-indigo-800">{key} (Default: {defaultLabel})</label>
                  <input type="text" value={paramRenames[key] || ''} onChange={e => setParamRenames({ [key]: e.target.value })} placeholder={defaultLabel} className="border border-indigo-200 rounded px-2 py-1 text-xs" />
                </div>
              );
            })}
          </div>
        )}

        {gates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-red-50 border border-red-200 p-2 rounded-lg mt-2">
            <span className="text-[10px] font-bold text-red-600 uppercase">Active Gates:</span>
            {gates.map((g, idx) => (
              <div key={g.id} className="flex items-center gap-1.5 bg-white border border-red-200 text-red-700 px-2 py-1 rounded shadow-sm text-xs font-bold">
                <span>🎯 Gate {idx + 1}: {getParamLabel({name: g.xParam}, panelArray, paramRenames)} vs {getParamLabel({name: g.yParam}, panelArray, paramRenames)}</span>
                <button onClick={() => setGates(gates.filter(x => x.id !== g.id))} className="text-red-400 hover:text-red-600 font-black ml-1">×</button>
              </div>
            ))}
            <button onClick={() => setGates([])} className="text-[10px] text-slate-500 hover:text-red-600 ml-auto font-bold underline">Clear All</button>
          </div>
        )}
        {showAutoGates && (
          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg mt-2 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wide text-emerald-700">🤖 Automatic treatment</span>
              <button onClick={resetAutoGates} className="text-xs font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">↺ Reset defaults</button>
            </div>
            <p className="text-[10px] text-slate-500">
              Applied to every histogram, 2D scatter and gate. Filters run in order: singlets → debris → manual.
            </p>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!!autoGates.singlets.enabled}
                       onChange={(e) => patchAutoGate('singlets', { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" />
                1. Singlets — keep |H − A| ≤ tolerance
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <select value={autoGates.singlets.aParam} onChange={(e) => patchAutoGate('singlets', { aParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">vs</span>
                <select value={autoGates.singlets.hParam} onChange={(e) => patchAutoGate('singlets', { hParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">tolerance</span>
                <input type="number" min="0" value={autoGates.singlets.tolerance}
                       onChange={(e) => patchAutoGate('singlets', { tolerance: e.target.value })}
                       className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
                <span className="text-[10px] text-slate-400">(e.g. FSC-A 50000 &amp; FSC-H 30000 → keep; FSC-H 29999 → exclude)</span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!!autoGates.debris.enabled}
                       onChange={(e) => patchAutoGate('debris', { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" />
                2. Debris exclusion (inside singlets) — keep A ≥ min AND SSC ≥ min
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <select value={autoGates.debris.aParam} onChange={(e) => patchAutoGate('debris', { aParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">≥</span>
                <input type="number" min="0" value={autoGates.debris.minA}
                       onChange={(e) => patchAutoGate('debris', { minA: e.target.value })}
                       className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
                <span className="text-[10px] text-slate-400">and</span>
                <select value={autoGates.debris.sscParam} onChange={(e) => patchAutoGate('debris', { sscParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">≥</span>
                <input type="number" min="0" value={autoGates.debris.minSSC}
                       onChange={(e) => patchAutoGate('debris', { minSSC: e.target.value })}
                       className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!!autoGates.manual.enabled}
                       onChange={(e) => patchAutoGate('manual', { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-emerald-600" />
                3. Manual filter (both dimensions) — keep X ≥ min AND Y ≥ min
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <select value={autoGates.manual.xParam} onChange={(e) => patchAutoGate('manual', { xParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">≥</span>
                <input type="number" min="0" value={autoGates.manual.xMin}
                       onChange={(e) => patchAutoGate('manual', { xMin: e.target.value })}
                       className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
                <span className="text-[10px] text-slate-400">and</span>
                <select value={autoGates.manual.yParam} onChange={(e) => patchAutoGate('manual', { yParam: e.target.value })}
                        className="border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <span className="text-[10px] text-slate-400">≥</span>
                <input type="number" min="0" value={autoGates.manual.yMin}
                       onChange={(e) => patchAutoGate('manual', { yMin: e.target.value })}
                       className="w-24 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] bg-white outline-none" />
              </div>
            </div>
          </div>
        )}

      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 z-10 w-full mt-2">
        
        {/* 1D HISTOGRAM */}
        <>
          {fs1D && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99990]" onClick={() => setFs1D(false)} />}
          <div className={fs1D ? "fixed inset-4 z-[99999] bg-white p-6 rounded-2xl shadow-2xl flex flex-col gap-3 overflow-hidden" : "flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full"}>
            <div className="flex justify-between items-center z-10 shrink-0 border-b border-slate-100 pb-2">
              <h5 className="text-sm font-bold text-slate-700">1D Histogram</h5>
              <div className="flex items-center gap-2">
                <select value={overlayParam1D} onChange={e => setOverlayParam1D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 min-w-[130px] max-w-[240px]">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2">
                  <input type="checkbox" checked={log1D} onChange={e => { setLog1D(e.target.checked); setVizCfg1D({ xLog: e.target.checked }); }} className="w-3.5 h-3.5 accent-blue-600" /> Log
                </label>
                <ChartControlBar showCfg={showCfg1D} onToggleCfg={() => setShowCfg1D(!showCfg1D)} />
                <button type="button" onClick={() => setFs1D(!fs1D)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs1D ? '↙️ Exit' : '↗️ Fullscreen'}</button>
              </div>
            </div>
            
            {showCfg1D && <SharedChartStylePanel cfg={cfg1D} setCfg={setVizCfg1D} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}
            
            <ChartInspector
              containerRef={chartRef1D}
              containerProps={{ onMouseDown: zoom1D.onMouseDown }}
              cfg={cfg1D}
              setCfg={setVizCfg1D}
              series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))}
              unit="a.u."
              title="Double-click the plot, an axis, a label or a curve to edit it"
              className={`bg-slate-50 rounded border border-slate-200 p-2 select-none relative overflow-hidden cursor-crosshair w-full ${fs1D ? 'flex-1 min-h-0' : ''}`}
              style={!fs1D ? { height: Math.min(Number(cfg1D.height) || 300, 560) } : undefined}>
              {zoom1D.isZoomed && <button type="button" onClick={zoom1D.reset} className="absolute top-2 right-2 z-10 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
              {cfg1D.title && <div className="text-sm font-bold text-slate-700 mb-1">{cfg1D.title}</div>}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData1D.bins} margin={cfgChartMargin(cfg1D, { top: 10, right: 20, left: 75, bottom: 45 })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="x" type="number" domain={histDomain} allowDataOverflow ticks={cfgAxisTicks(cfg1D, 'x', histDomain)} tickFormatter={cfgTickFormatter(cfg1D, 'x') || ((v) => v.toFixed(log1D ? 1 : 0))} tick={{ fontSize: Math.max(9, cfg1D.fontSize - 2) }} label={cfgAxisLabel(cfg1D, 'x', `${label1D}${log1D ? ' (Log)' : ''}`, 10)} />
                  <YAxis {...brk1D.axisProps} tick={{ fontSize: Math.max(9, cfg1D.fontSize - 2) }} scale={brk1D.on ? brk1D.axisProps.scale : cfgLogScale(cfg1D, 'y')} tickFormatter={cfgTickFormatter(cfg1D, 'y') || undefined} ticks={brk1D.on ? brk1D.axisProps.ticks : (cfg1D.yMin !== '' && cfg1D.yMin != null && cfg1D.yMax !== '' && cfg1D.yMax != null ? cfgAxisTicks(cfg1D, 'y', [Number(cfg1D.yMin), Number(cfg1D.yMax)]) : undefined)} label={cfgAxisLabel(cfg1D, 'y', cfg1D.yAxisLabel || 'Count', 5)} />
                  <Tooltip labelFormatter={(label) => `Value: ${Number(label).toFixed(log1D ? 2 : 0)}`} formatter={(value) => [value, 'Events']} />
                  {visibleInstances.map(s => cfgSeriesEl(cfg1D, { key: s.id, data: chartData1D.bins, dataKey: s.id, name: s.name, stroke: cfg1D.colors?.[s.id] || s.color }))}
                  {zoom1D.refLo !== null && zoom1D.refHi !== null && <ReferenceArea x1={zoom1D.refLo} x2={zoom1D.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                  {brk1D.marks}
                </ComposedChart>
              </ResponsiveContainer>
            </ChartInspector>
          </div>
        </>

        {/* 2D SCATTER */}
        <>
          {fs2D && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99990]" onClick={() => setFs2D(false)} />}
          <div className={fs2D ? "fixed inset-4 z-[99999] bg-white p-6 rounded-2xl shadow-2xl flex flex-col gap-3 overflow-hidden" : "flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full"}>
            <div className="flex justify-between items-center z-10 shrink-0 border-b border-slate-100 pb-2">
              <h5 className="text-sm font-bold text-slate-700">2D Scatter</h5>
              <div className="flex items-center gap-2">
                <select value={xParam2D} onChange={e => setXParam2D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[90px]">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={logX2D} onChange={e => setLogX2D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
                </label>
                <span className="text-slate-300 px-1">|</span>
                <select value={yParam2D} onChange={e => setYParam2D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[90px]">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2">
                  <input type="checkbox" checked={logY2D} onChange={e => setLogY2D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
                </label>
                <ChartControlBar showCfg={showCfg2D} onToggleCfg={() => setShowCfg2D(!showCfg2D)} />
                <button type="button" onClick={() => setFs2D(!fs2D)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs2D ? '↙️ Exit' : '↗️ Fullscreen'}</button>
              </div>
            </div>
            
            {showCfg2D && <SharedChartStylePanel cfg={cfg2D} setCfg={setVizCfg2D} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}
            
            <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
              <div className="flex gap-2">
                  <button onClick={() => setInteractionMode('gate')} className={`text-xs font-bold px-3 py-1 rounded shadow-sm transition-colors ${interactionMode === 'gate' ? 'bg-red-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>🎯 Draw Gate</button>
                  <button onClick={() => setInteractionMode('zoom')} className={`text-xs font-bold px-3 py-1 rounded shadow-sm transition-colors ${interactionMode === 'zoom' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'}`}>🔍 Zoom</button>
              </div>
              {xDomain2D && yDomain2D && (
                  <button onClick={() => { setXDomain2D(null); setYDomain2D(null); updateActiveTest({ fcZoom2D: undefined }); }} className="text-[10px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded shadow-sm">Reset Zoom</button>
              )}
            </div>

            <Canvas2DPlotOverlay 
               series={visibleInstances} 
               xParam={xParam2D} 
               yParam={yParam2D} 
               xLabel={labelX2D} 
               yLabel={labelY2D} 
               logX={logX2D} 
               logY={logY2D} 
               cfg={cfg2D} 
               fs={fs2D} 
               gates={gates} 
               autoGates={autoGates}
               onAddGate={(g) => setGates(prev => [...prev, g])} 
               interactionMode={interactionMode}
               xDomain={xDomain2D || (autoDomain2D && autoDomain2D.x) || undefined}
               yDomain={yDomain2D || (autoDomain2D && autoDomain2D.y) || undefined}
               onZoom={({ xDomain, yDomain }) => {
                 setXDomain2D(xDomain);
                 setYDomain2D(yDomain);
                 updateActiveTest({ fcZoom2D: { x: xDomain, y: yDomain, xParam: xParam2D, yParam: yParam2D, logX: logX2D, logY: logY2D } });
               }}
            />
          </div>
        </>

      </div>
    </div>
  );
};


// =========================================================================
// INSTRUMENTAL SETUP COMPONENT
// =========================================================================
export const InstrumentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const LABEL_CLS = 'text-[10px] font-bold text-slate-500 uppercase';
  const INPUT_CLS = 'border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 bg-white';
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };

  const instrumentalFields = [
    { key: 'cytometerModel', label: 'Cytometer Model', type: 'text', placeholder: 'e.g. FACSCanto II' },
    { key: 'cytometerSerial', label: 'Cytometer Serial Number', type: 'text', placeholder: 'e.g. V96300734' },
    { key: 'acquisitionSoftware', label: 'Acquisition Software', type: 'text', placeholder: 'e.g. FACSDiva' },
    { key: 'lasers', label: 'Lasers Config', type: 'textarea', placeholder: 'e.g. Blue (488nm), Red (633nm), Violet (405nm)' },
    { key: 'threshold', label: 'Threshold', type: 'text', placeholder: 'e.g. FSC, 5000' },
    { key: 'compensationApplied', label: 'Compensation Applied', type: 'select', options: ['Yes', 'No', 'Unknown'] },
    { key: 'plateName', label: 'Plate Name / ID', type: 'text', placeholder: 'e.g. 96 Well - Flat bottom' },
    { key: 'wellId', label: 'Well ID', type: 'text', placeholder: 'e.g. H01' }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {instrumentalFields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={activeTest[f.key] || ''} onChange={(e) => update({ [f.key]: e.target.value })} className={INPUT_CLS}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea value={activeTest[f.key] || ''} onChange={(e) => update({ [f.key]: e.target.value })} placeholder={f.placeholder} className={`${INPUT_CLS} h-20`} />
            ) : (
              <input type="text" value={activeTest[f.key] || ''} onChange={(e) => update({ [f.key]: e.target.value })} placeholder={f.placeholder} className={INPUT_CLS} />
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">
        These fields are automatically populated when you upload an FCS file. You can manually edit them if needed.
      </p>
    </div>
  );
};
// =========================================================================
// EXPERIMENTAL SETUP — plate layout with predefined compounds and degrading
// concentrations (same interactive table as the plate Data section, minus
// intensities and regions). A compound is assigned per row / column / cell;
// the concentration degrades by the dilution factor along the assignment
// direction (top / dil^step). Stored in activeTest.fcPlate.
// =========================================================================
const FLOW_PLATE_OPTIONS = [
  { value: '96', label: '96-well Plate' },
  { value: '48', label: '48-well Plate' },
  { value: '24', label: '24-well Plate' },
  { value: '12', label: '12-well Plate' },
  { value: '6', label: '6-well Plate' },
  { value: '1', label: '1 Petri Dish' }
];
const PLATE_ROWS_LETTERS = 'ABCDEFGHIJKL'.split('');
const hashHex = (name) => {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return '#' + [0, 1, 2].map((i) => ((h >> (i * 8)) & 255).toString(16).padStart(2, '0')).join('');
};
const plateCmpColor = (name, cmpColors = {}) => {
  const stored = cmpColors[name];
  if (stored && /^#[0-9a-f]{6}$/i.test(stored)) return stored.toLowerCase();
  return hashHex(name);
};

export const ExperimentalSetup = ({ ctx }) => {
  const { activeTest = {}, updateActiveTest } = ctx || {};
  const update = (u) => { if (updateActiveTest) updateActiveTest(u); };

  const fcPlate = activeTest.fcPlate || {};
  const plateType = PLATES_DEF[fcPlate.plateType] ? fcPlate.plateType : '96';
  const dim = PLATES_DEF[plateType] || PLATES_DEF['96'];
  const rows = dim.rows, cols = dim.cols;
  const ROWS = PLATE_ROWS_LETTERS.slice(0, rows);
  const COLS = Array.from({ length: cols }, (_, i) => i + 1);

  const rowCompounds = Array.isArray(fcPlate.rowCompounds) ? fcPlate.rowCompounds : [];
  const compounds = Array.isArray(fcPlate.compounds) ? fcPlate.compounds : [];
  const cellConfig = Array.isArray(fcPlate.cellConfig) ? fcPlate.cellConfig : [];
  const tConc = parseFloat(String(fcPlate.topConcStr ?? '100').replace(',', '.')) || 0;
  const dFact = parseFloat(String(fcPlate.dilFactorStr ?? '3').replace(',', '.')) || 1;
  const unit = fcPlate.unit || 'µM';
  const customConc = fcPlate.customConc || {};
  const cmpColors = fcPlate.cmpColors || {};

  // Compound dropdown = only the compounds present in the Library (allCmpds),
  // so elements that were removed from the Library no longer appear.
  const compoundOptions = (() => {
    const set = new Set();
    (Array.isArray(ctx?.allCmpds) ? ctx.allCmpds : []).forEach((c) => c && set.add(c));
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  const usedCompounds = (() => {
    const set = new Set();
    [...(rowCompounds || []), ...(compounds || []), ...Object.keys(customConc)].forEach((c) => c && set.add(c));
    (cellConfig || []).forEach((row) => (row || []).forEach((cfg) => cfg && cfg.role && set.add(cfg.role)));
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  const cellCfg = (r, c) => {
    const row = cellConfig[r];
    const cfg = Array.isArray(row) ? row[c] : null;
    return cfg && typeof cfg === 'object' ? cfg : {};
  };
  const setPlate = (patch) => update({ fcPlate: { ...fcPlate, ...patch } });

  // ---- multi-cell mouse selection (same as the plate Data table) ----
  const [selStart, setSelStart] = useState(null);
  const [selEnd, setSelEnd] = useState(null);
  const [dragMode, setDragMode] = useState('none');
  // Fullscreen toggles for the Interactive Table / Plate Map (same pattern
  // as the Multiwell Plate page: FS_CLASSES + OVERLAY_CLASSES).
  const [fsPanel, setFsPanel] = useState(null);
  const toggleFs = (id) => setFsPanel((prev) => (prev === id ? null : id));
  // Regulable circle size for the plate map (same A–A slider as the Plate page).
  const [mapFontSize, setMapFontSize] = useState(9);
  const mapBadgePx = fsPanel === 'map' ? Math.max(45, Math.round(mapFontSize * 5.5)) : Math.max(22, Math.round(mapFontSize * 3.4));
  const activeSel = selStart && selEnd
    ? { minR: Math.min(selStart.r, selEnd.r), maxR: Math.max(selStart.r, selEnd.r), minC: Math.min(selStart.c, selEnd.c), maxC: Math.max(selStart.c, selEnd.c) }
    : null;

  useEffect(() => {
    const up = () => { if (dragMode === 'selecting') setDragMode('none'); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [dragMode]);

  const onCellMouseDown = (e, r, c) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSelStart({ r, c });
    setSelEnd({ r, c });
    setDragMode('selecting');
  };
  const onCellMouseEnter = (r, c) => { if (dragMode === 'selecting') setSelEnd({ r, c }); };
  const clearSelection = () => { setSelStart(null); setSelEnd(null); setDragMode('none'); };

  // Region definition (same concept as the Multiwell Plate Data section):
  // select a rectangle, type a region name, assign it — each cell stores its
  // region ('Primary' by default) and the map shows coloured region badges.
  const [regionNameDraft, setRegionNameDraft] = useState('');
  const assignRegionToSelection = () => {
    if (!activeSel) return;
    const name = (regionNameDraft || '').trim();
    const nCfg = Array.from({ length: rows }, (_, ri) =>
      Array.from({ length: cols }, (_, ci) => {
        const base = cellCfg(ri, ci);
        if (ri >= activeSel.minR && ri <= activeSel.maxR && ci >= activeSel.minC && ci <= activeSel.maxC) {
          return { ...base, region: name || 'Primary' };
        }
        return base;
      })
    );
    setPlate({ cellConfig: nCfg });
  };

  // Apply a compound / concentration override to every cell of the selection.
  const patchSelection = (patch) => {
    if (!activeSel) return;
    const nCfg = Array.from({ length: rows }, (_, ri) =>
      Array.from({ length: cols }, (_, ci) => {
        const base = cellCfg(ri, ci);
        const inside = ri >= activeSel.minR && ri <= activeSel.maxR && ci >= activeSel.minC && ci <= activeSel.maxC;
        if (!inside) return base;
        const next = { ...base };
        if ('role' in patch) next.role = patch.role === '' || patch.role === null ? null : patch.role;
        if ('conc' in patch) next.conc = patch.conc === '' || patch.conc === null ? null : Number(patch.conc);
        if ('region' in patch) next.region = (patch.region === '' || patch.region === null || patch.region === undefined) ? 'Primary' : String(patch.region);
        return next;
      })
    );
    setPlate({ cellConfig: nCfg });
  };

  const isCtrl = (x) => isPlatePreset(x);
  const getRole = (r, c) => {
    const cfg = cellCfg(r, c);
    if (cfg.role !== null && cfg.role !== undefined && cfg.role !== '') return cfg.role;
    const rCmp = rowCompounds[r] || '';
    const cCmp = compounds[c] || '';
    if (rCmp && !cCmp) return rCmp;
    if (cCmp && !rCmp) return cCmp;
    if (!rCmp && !cCmp) return null;
    if (isCtrl(rCmp) && !isCtrl(cCmp)) return rCmp;
    if (isCtrl(cCmp) && !isCtrl(rCmp)) return cCmp;
    return rCmp;
  };

  const concOf = (r, c, role) => {
    const rl = role !== undefined ? role : getRole(r, c);
    if (!rl) return null;
    // Preset labels (cells / PBS / DMSO / Medium / empty) never carry a
    // concentration.
    if (isPlatePreset(rl)) return null;
    const cfg = cellCfg(r, c);
    if (cfg.conc !== null && cfg.conc !== undefined && cfg.conc !== '') return Number(cfg.conc);
    const s = customConc[rl]
      ? { top: parseFloat(customConc[rl].top) || 0, dil: parseFloat(customConc[rl].dil) || 1 }
      : { top: tConc, dil: dFact };
    let isHoriz = false;
    if (rowCompounds[r] === rl) isHoriz = true;
    else if (compounds[c] === rl) isHoriz = false;
    else if ((rowCompounds || []).includes(rl)) isHoriz = true;
    let step = 0;
    if (isHoriz) { for (let i = 0; i < c; i++) if (getRole(r, i) === rl) step++; }
    else { for (let i = 0; i < r; i++) if (getRole(i, c) === rl) step++; }
    return s.dil > 0 ? s.top / Math.pow(s.dil, step) : 0;
  };

  const changeFormat = (newType) => {
    const nd = PLATES_DEF[newType] || PLATES_DEF['96'];
    setPlate({
      plateType: newType,
      rowCompounds: Array.from({ length: nd.rows }, (_, r) => rowCompounds[r] || ''),
      compounds: Array.from({ length: nd.cols }, (_, c) => compounds[c] || ''),
      cellConfig: Array.from({ length: nd.rows }, (_, r) =>
        Array.from({ length: nd.cols }, (_, c) => ({ role: cellCfg(r, c).role ?? null, conc: cellCfg(r, c).conc ?? null, region: cellCfg(r, c).region || 'Primary' }))
      )
    });
  };

  const updateRowCmp = (r, val) => {
    const n = [...rowCompounds];
    n[r] = val;
    setPlate({ rowCompounds: n });
  };
  const updateCmp = (c, val) => {
    const n = [...compounds];
    n[c] = val;
    setPlate({ compounds: n });
  };
  const clearOverrides = () => setPlate({ cellConfig: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ role: null, conc: null }))) });

  let assignedCount = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (getRole(r, c)) assignedCount++;
  // Shared value among all cells of the selection ('' when mixed / none).
  const selRoleValues = activeSel ? (() => { const v = new Set(); for (let r = activeSel.minR; r <= activeSel.maxR; r++) for (let c = activeSel.minC; c <= activeSel.maxC; c++) v.add(getRole(r, c) || ''); return [...v]; })() : [];
  const selCommonRole = selRoleValues.length === 1 ? selRoleValues[0] : '';
  const selConcValues = activeSel ? (() => { const v = new Set(); for (let r = activeSel.minR; r <= activeSel.maxR; r++) for (let c = activeSel.minC; c <= activeSel.maxC; c++) v.add(cellCfg(r, c).conc ?? ''); return [...v]; })() : [];
  const selCommonConc = selConcValues.length === 1 ? selConcValues[0] : '';
  const selLabel = activeSel
    ? (activeSel.minR === activeSel.maxR && activeSel.minC === activeSel.maxC
        ? `Well ${ROWS[activeSel.minR]}${activeSel.minC + 1}`
        : `Selection ${ROWS[activeSel.minR]}${activeSel.minC + 1}:${ROWS[activeSel.maxR]}${activeSel.maxC + 1}`)
    : '';

  // ---- custom concentrations (per compound) ----
  const [ccSel, setCcSel] = useState('');
  const [ccTop, setCcTop] = useState('');
  const [ccDil, setCcDil] = useState(String(dFact));
  const addCustomConc = () => {
    const t = parseFloat(String(ccTop).replace(',', '.'));
    const d = parseFloat(String(ccDil).replace(',', '.')) || dFact;
    if (ccSel && !isNaN(t) && t > 0 && d > 0) {
      setPlate({ customConc: { ...customConc, [ccSel]: { top: t, dil: d } } });
      setCcTop('');
    }
  };
  const removeCustomConc = (name) => {
    const n = { ...customConc };
    delete n[name];
    setPlate({ customConc: n });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Plate Format</label>
          <select
            value={plateType}
            onChange={(e) => changeFormat(e.target.value)}
            className="border border-blue-300 text-blue-700 font-bold rounded-lg p-1.5 w-36 text-xs bg-blue-50 cursor-pointer outline-none"
          >
            {FLOW_PLATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Max Conc</label>
          <input type="number" step="0.1" value={fcPlate.topConcStr ?? '100'}
            onChange={(e) => setPlate({ topConcStr: e.target.value })}
            className="border border-slate-300 rounded-lg p-1.5 w-20 text-xs outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Dil. Factor</label>
          <input type="number" step="0.1" value={fcPlate.dilFactorStr ?? '3'}
            onChange={(e) => setPlate({ dilFactorStr: e.target.value })}
            className="border border-slate-300 rounded-lg p-1.5 w-16 text-xs outline-none focus:border-blue-500" />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Unit</label>
          <select value={unit} onChange={(e) => setPlate({ unit: e.target.value })}
            className="border border-slate-300 rounded-lg p-1.5 w-24 text-xs bg-white font-bold text-slate-800 outline-none">
            <option value="µM">µM</option>
            <option value="mM">mM</option>
            <option value="nM">nM</option>
            <option value="µg/mL">µg/mL</option>
            <option value="mg/mL">mg/mL</option>
          </select>
        </div>
        <span className="text-xs text-slate-500 font-bold pb-1.5">{rows} x {cols} wells · {assignedCount} assigned</span>
        <button type="button" onClick={clearOverrides}
          className="text-xs font-bold bg-white border border-slate-300 px-3 py-1.5 rounded-lg shadow-sm hover:bg-slate-50 whitespace-nowrap">
          🧹 Clear cell overrides
        </button>
      </div>

      {/* Selection toolbar (drag over wells to select a range) */}
      {activeSel && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-indigo-800">{selLabel}</span>
          <select value={selCommonRole} onChange={(e) => patchSelection({ role: e.target.value })}
            className="border border-indigo-300 rounded px-2 py-1 text-xs bg-white outline-none font-bold text-indigo-800">
            <option value="">inherit (row/col)</option>
            {compoundOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input type="number" step="0.1" value={selCommonConc}
            onChange={(e) => patchSelection({ conc: e.target.value === '' ? null : e.target.value })}
            placeholder="Conc override" title="Optional concentration override for the whole selection"
            className="border border-indigo-300 rounded px-2 py-1 text-xs w-28 bg-white outline-none" />
          <button type="button" onClick={() => patchSelection({ role: null, conc: null })}
            className="text-[10px] font-bold bg-white border border-red-300 text-red-600 px-2 py-1 rounded shadow-sm hover:bg-red-50">Clear cells</button>
          <span className="w-px h-5 bg-indigo-200" />
          <span className="text-[10px] font-bold text-indigo-500 uppercase">Fill:</span>
          {PLATE_PRESET_LABELS.map((lbl) => (
            <button key={lbl} type="button"
              onClick={() => patchSelection({ role: lbl, conc: null })}
              title={`Fill selection with "${lbl}" (no concentration)`}
              className="text-[10px] font-bold rounded px-2 py-1 border shadow-sm hover:opacity-80 transition-opacity"
              style={{ backgroundColor: PLATE_PRESET_COLORS[lbl.toLowerCase()], borderColor: '#cbd5e1', color: '#334155' }}>
              {lbl}
            </button>
          ))}
          <span className="w-px h-5 bg-indigo-200" />
          <span className="text-[10px] font-bold text-indigo-500 uppercase">Region:</span>
          <input
            type="text"
            value={regionNameDraft}
            onChange={(e) => setRegionNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') assignRegionToSelection(); }}
            placeholder="Region name (e.g. Cytoplasm)"
            className="border border-indigo-300 rounded px-2 py-1 text-xs w-36 bg-white outline-none"
          />
          <button type="button" onClick={assignRegionToSelection}
            className="text-[10px] font-bold bg-white border border-indigo-300 text-indigo-700 px-2 py-1 rounded shadow-sm hover:bg-indigo-50">
            Assign region
          </button>
          <button type="button" onClick={clearSelection}
            className="text-slate-400 hover:text-slate-700 font-black px-1">✕</button>
        </div>
      )}

      {/* Custom concentrations per compound + per-compound colors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2">
          <div className="text-[10px] uppercase font-bold text-slate-500">Custom Concentrations</div>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={ccSel} onChange={(e) => setCcSel(e.target.value)}
              className="border border-slate-300 rounded-lg p-1.5 text-xs w-32 bg-white outline-none">
              <option value="">Compound…</option>
              {compoundOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input type="number" step="0.1" value={ccTop} onChange={(e) => setCcTop(e.target.value)}
              placeholder={`Top ${unit}`} className="border border-slate-300 rounded-lg p-1.5 w-24 text-xs outline-none" />
            <input type="number" step="0.1" value={ccDil} onChange={(e) => setCcDil(e.target.value)}
              placeholder="Dil" className="border border-slate-300 rounded-lg p-1.5 w-16 text-xs outline-none" />
            <button type="button" onClick={addCustomConc}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">Set</button>
          </div>
          {Object.keys(customConc).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.entries(customConc).map(([c, s]) => (
                <span key={c} className="bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 font-bold shadow-sm">
                  {c}: {s.top}{unit} ÷ {s.dil}
                  <button type="button" onClick={() => removeCustomConc(c)} className="text-red-500 hover:text-red-700 font-black">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 flex flex-col gap-2">
          <div className="text-[10px] uppercase font-bold text-slate-500">Compound Colors</div>
          {usedCompounds.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {usedCompounds.map((cmp) => {
                const hex = plateCmpColor(cmp, cmpColors);
                return (
                  <span key={cmp} className="bg-white border border-slate-200 text-slate-700 text-[11px] px-2 py-1 rounded-md flex items-center gap-1.5 font-bold shadow-sm" title={`Click the dot to change the color of ${cmp}`}>
                    <label className="relative cursor-pointer inline-flex items-center" style={{ width: 14, height: 14 }}>
                      <span style={{ width: 14, height: 14, borderRadius: 9999, backgroundColor: hex, display: 'inline-block', border: '1px solid rgba(15,23,42,0.15)' }} />
                      <input type="color" value={hex} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                        onChange={(e) => setPlate({ cmpColors: { ...cmpColors, [cmp]: e.target.value } })} />
                    </label>
                    {cmp}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400">Assign compounds to see them here and pick a color.</p>
          )}
        </div>
      </div>



      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Interactive compound / concentration table (no intensities, no regions) */}
        <div className="relative">
          {fsPanel === 'table' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('table')} />}
          <div className={`bg-white border border-slate-200 rounded-xl p-3 shadow-sm min-w-0 flex flex-col ${fsPanel === 'table' ? FS_CLASSES : ''}`}>
            <div className="flex justify-between items-center mb-2 shrink-0 gap-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase">Interactive Table</h4>
              <button
                type="button"
                onClick={() => toggleFs('table')}
                className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors"
                title={fsPanel === 'table' ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {fsPanel === 'table' ? '↙️' : '↗️'}
              </button>
            </div>
            <div className={`overflow-x-auto custom-scrollbar ${fsPanel === 'table' ? 'flex-1' : ''}`} style={fsPanel === 'table' ? { minHeight: 0 } : undefined}>
            <table className="w-full border-collapse table-fixed min-w-[640px] text-[11px] text-center select-none">
              <thead>
                <tr>
                  <th className="bg-slate-200 border border-slate-300 p-1 text-slate-600 w-8">R\C</th>
                  <th className="bg-slate-100 border border-slate-300 p-1 text-slate-600 w-24">Row Cmpd →</th>
                  {COLS.map((col, c) => (
                    <th key={col} className="bg-slate-50 border border-slate-300 p-1">
                      <div className="text-[11px] text-slate-500 font-black">{col}</div>
                      <select value={compounds[c] || ''} onChange={(e) => updateCmp(c, e.target.value)}
                        className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none">
                        <option value="">Col Cmpd ↓</option>
                        {compoundOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((rl, r) => (
                  <tr key={rl}>
                    <td className="bg-slate-100 border border-slate-300 font-black text-xs text-slate-700">{rl}</td>
                    <td className="bg-slate-50 border border-slate-300 p-1 align-middle">
                      <select value={rowCompounds[r] || ''} onChange={(e) => updateRowCmp(r, e.target.value)}
                        className="w-full text-center border border-slate-300 rounded p-0.5 font-bold text-blue-800 text-[10px] h-6 bg-white cursor-pointer outline-none">
                        <option value="">Row Cmpd →</option>
                        {compoundOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    {COLS.map((col, c) => {
                      const role = getRole(r, c);
                      const conc = role ? concOf(r, c, role) : null;
                      const isSel = activeSel && r >= activeSel.minR && r <= activeSel.maxR && c >= activeSel.minC && c <= activeSel.maxC;
                      return (
                        <td key={col}
                          onMouseDown={(e) => onCellMouseDown(e, r, c)}
                          onMouseEnter={() => onCellMouseEnter(r, c)}
                          title={`${rl}${col} — drag to select`}
                          className={`relative border border-slate-200 p-1 align-middle cursor-pointer transition-colors ${isSel ? 'bg-indigo-100 ring-2 ring-inset ring-indigo-400' : role ? 'hover:bg-blue-50' : 'bg-slate-50/50 hover:bg-blue-50'}`}>
                          {role ? (
                            <div className="flex flex-col leading-tight">
                              <span className="font-bold text-[10px] truncate" style={{ color: platePresetColor(role) ? '#334155' : plateCmpColor(role, cmpColors) }}>{role}</span>
                              <span className="text-[9px] text-slate-600">{conc != null ? `${formatConc(conc)} ${unit}` : '—'}</span>
                            </div>
                          ) : (
                            <span className="text-slate-300 text-[10px]">—</span>
                          )}
                          {(() => { const reg = cellCfg(r, c).region; if (!reg || reg === 'Primary') return null; return (
                            <span className="absolute top-0 left-0 text-[7px] font-black text-white px-1 rounded-br pointer-events-none" style={{ backgroundColor: getRegionColor(reg) }}>{reg}</span>
                          ); })()}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 shrink-0">
              Drag over wells to select a range, then assign a compound / concentration to the whole selection. Row/column compounds degrade by the dilution factor.
            </p>
          </div>
        </div>

        {/* Visual plate map */}
        <div className="relative">
          {fsPanel === 'map' && <div className={OVERLAY_CLASSES} onClick={() => toggleFs('map')} />}
          <div className={`bg-white border border-slate-200 rounded-xl p-3 shadow-sm min-w-0 flex flex-col ${fsPanel === 'map' ? FS_CLASSES : ''}`}>
            <div className="flex justify-between items-center mb-2 shrink-0 gap-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase">Plate Map</h4>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1" title="Circle size">
                  <span className="text-[9px] font-bold text-slate-500">A</span>
                  <input type="range" min="6" max="22" value={mapFontSize}
                    onChange={(e) => setMapFontSize(Number(e.target.value))}
                    className="w-16 accent-blue-600" />
                  <span className="text-[12px] font-bold text-slate-500">A</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFs('map')}
                  className="text-slate-400 hover:text-blue-600 bg-slate-100 hover:bg-blue-100 rounded p-1 transition-colors"
                  title={fsPanel === 'map' ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {fsPanel === 'map' ? '↙️' : '↗️'}
                </button>
              </div>
            </div>
            <div className={`bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto ${fsPanel === 'map' ? 'flex-1' : ''}`} style={fsPanel === 'map' ? { minHeight: 0 } : undefined}>
            {/* zoom: enlarges the map (layout + visuals) in fullscreen — unlike
                transform: scale() it also grows the scrollable area, so the
                whole enlarged map stays reachable via the scrollbars. */}
            <div className="flex flex-col gap-1 min-w-max" style={fsPanel === 'map' ? { zoom: 1.75 } : undefined}>
              <div className="flex gap-1 mb-0.5 pl-5">
                {COLS.map((c) => <div key={c} className="text-center text-[9px] font-bold text-slate-500" style={{ width: mapBadgePx }}>{c}</div>)}
              </div>
              {ROWS.map((rl, r) => (
                <div key={rl} className="flex gap-1 items-center">
                  <div className="w-4 text-[9px] font-bold text-slate-500 text-right pr-1">{rl}</div>
                  {COLS.map((col, c) => {
                    const role = getRole(r, c);
                    const conc = role ? concOf(r, c, role) : null;
                    const isSel = activeSel && r >= activeSel.minR && r <= activeSel.maxR && c >= activeSel.minC && c <= activeSel.maxC;
                    const presetCol = role ? platePresetColor(role) : null;
                    const fSize = Math.max(7, Math.round(mapFontSize * 0.95));
                    const reg = cellCfg(r, c).region;
                    const hasReg = !!reg && reg !== 'Primary';
                    return (
                      <div key={col} title={`${rl}${col}: ${role || 'empty'}${conc != null ? ' · ' + formatConc(conc) + ' ' + unit : ''}${hasReg ? ' · ' + reg : ''}`}
                        onMouseDown={(e) => onCellMouseDown(e, r, c)}
                        onMouseEnter={() => onCellMouseEnter(r, c)}
                        className={`relative rounded-full border flex flex-col items-center justify-center text-[8px] font-bold leading-tight px-0.5 text-center transition-colors cursor-pointer select-none ${isSel ? 'ring-2 ring-inset ring-indigo-500' : ''} ${role ? (presetCol ? 'border-slate-300 text-slate-700' : 'text-white border-black/10') : 'bg-white text-slate-400 border-slate-200'}`}
                        style={{ backgroundColor: presetCol || (role ? plateCmpColor(role, cmpColors) : undefined), width: mapBadgePx, height: mapBadgePx }}>
                        {hasReg && (
                          <span className="absolute -top-1.5 -right-1.5 text-[7px] font-black px-1 rounded shadow-sm text-white pointer-events-none"
                            style={{ backgroundColor: getRegionColor(reg) }}>{reg}</span>
                        )}
                        <span className="truncate max-w-full" style={{ fontSize: fSize + 'px' }}>{role || '·'}</span>
                        {conc != null && <span className="opacity-90" style={{ fontSize: Math.max(6, fSize - 1) + 'px' }}>{formatConc(conc)}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


// =========================================================================
// GLOBAL CACHE (Ties loaded files to their specific condition tab)
// =========================================================================
export const globalFcsCache = {};

// Tests for which the automatic Google-Drive fallback restore has already been
// attempted in this page session (so opening the same test again does not
// re-download everything).
const autoDriveRestoreDone = new Set();

// -------------------------------------------------------------------------
// FCS PERSISTENCE — the parsed .fcs data is kept in the module cache above
// (fast) but is ALSO serialized onto the test object (activeTest.fcParsed /
// fcExtraFiles[].data) so it survives closing and reopening the experiment.
// The dataset payload is LZ-compressed for Firestore (1MB/doc limit) and
// float data barely compresses, so only files whose base64 events fit under
// ~600KB are persisted; larger ones keep the in-memory-only behaviour.
// -------------------------------------------------------------------------
const FCS_PERSIST_LIMIT = 600 * 1024;

const fcsTypedArrayToB64 = (arr) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

const fcsB64ToTypedArray = (b64, Ctor) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Ctor(bytes.buffer);
};

const FCS_CTORS = { F: Float32Array, D: Float64Array, U32: Uint32Array, I: Uint16Array };

const fcsDataTypeOf = (arr) => {
  if (arr instanceof Float32Array) return 'F';
  if (arr instanceof Float64Array) return 'D';
  if (arr instanceof Uint32Array) return 'U32';
  return 'I';
};

/** Compact serialization of a parsed FCS structure (events → base64). Returns
 *  null when the file is too large to persist (kept in cache only). */
const serializeFcsForSave = (parsed) => {
  if (!parsed || !parsed.events || typeof parsed.numEvents !== 'number') return null;
  let eventsB64 = '';
  try { eventsB64 = fcsTypedArrayToB64(parsed.events); }
  catch { return null; }
  if (!eventsB64 || eventsB64.length > FCS_PERSIST_LIMIT) return null;
  return {
    version: parsed.version,
    numParams: parsed.numParams,
    numEvents: parsed.numEvents,
    params: parsed.params,
    textDict: parsed.textDict,
    filename: parsed.filename || '',
    dataType: fcsDataTypeOf(parsed.events),
    eventsB64
  };
};

/** Rebuild a parsed FCS structure from the persisted serialization. */
const deserializeFcsFromSave = (saved) => {
  if (!saved || typeof saved.eventsB64 !== 'string' || !saved.eventsB64) return null;
  const Ctor = FCS_CTORS[saved.dataType] || Float32Array;
  try {
    const events = fcsB64ToTypedArray(saved.eventsB64, Ctor);
    if (events.length !== (saved.numEvents || 0) * (saved.numParams || 0)) return null;
    return {
      version: saved.version,
      numParams: saved.numParams,
      numEvents: saved.numEvents,
      params: Array.isArray(saved.params) ? saved.params : [],
      textDict: saved.textDict || {},
      filename: saved.filename || '',
      events
    };
  } catch { return null; }
};

/** Fill the in-memory cache from the persisted data for the active test and
 *  its extra spectra. Idempotent — only missing entries are restored. */
export const restoreFcsCacheFromTest = (activeTest = {}) => {
  if (!activeTest || typeof activeTest !== 'object') return;
  if (activeTest.fcParsed && !globalFcsCache[activeTest.id]) {
    const parsed = deserializeFcsFromSave(activeTest.fcParsed);
    if (parsed) globalFcsCache[activeTest.id] = parsed;
  }
  (activeTest.fcExtraFiles || []).forEach((f) => {
    if (f && f.data && !globalFcsCache[f.id]) {
      const parsed = deserializeFcsFromSave(f.data);
      if (parsed) globalFcsCache[f.id] = parsed;
    }
  });
};

const parseFcsFileFromBlob = (blob) => new Promise((resolve) => {
  if (!blob) return resolve(null);
  try {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try { resolve(parseFCSFile(ev.target.result)); }
      catch { resolve(null); }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(blob);
  } catch { resolve(null); }
});

/**
 * Rebuild the in-memory cache from the IndexedDB copy of the raw .fcs files —
 * the safety net for files too large to persist in the dataset payload (their
 * fcParsed / fcExtraFiles[].data is null). Returns the number of files that
 * were restored. Filenames are validated so a stale blob from another dataset
 * that happens to reuse the same test id is never picked up.
 */
export const restoreFcsCacheFromIndexedDb = async (activeTest = {}) => {
  if (!activeTest || typeof activeTest !== 'object' || !activeTest.id) return 0;
  let restored = 0;

  // Main file — only restore when the test declares a file name to validate.
  if (!globalFcsCache[activeTest.id] && activeTest.fcsFileName) {
    const stored = await loadFcsFile(activeTest.id);
    if (stored && stored.file && stored.filename === activeTest.fcsFileName) {
      const parsed = await parseFcsFileFromBlob(stored.file);
      if (parsed) {
        parsed.filename = stored.filename || parsed.filename || activeTest.fcsFileName;
        globalFcsCache[activeTest.id] = parsed;
        restored++;
      }
    }
  }

  for (const f of (activeTest.fcExtraFiles || [])) {
    if (!f || !f.id || globalFcsCache[f.id] || !f.filename) continue;
    const stored = await loadFcsFile(f.id);
    if (stored && stored.file && stored.filename === f.filename) {
      const parsed = await parseFcsFileFromBlob(stored.file);
      if (parsed) {
        parsed.filename = stored.filename || f.filename;
        globalFcsCache[f.id] = parsed;
        restored++;
      }
    }
  }

  return restored;
};

// =========================================================================
// MAIN DATA SECTION
// =========================================================================
// =========================================================================
// MAIN DATA SECTION
// =========================================================================
// =========================================================================
// MAIN DATA SECTION
// =========================================================================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const t = activeTest || {};
  // True when the test previously received FCS data that was too large to
  // persist and the in-memory cache is empty (e.g. after a page reload).
  const persistedFcsWasTooLarge = !globalFcsCache[t.id] && (
    t.fcParsed === null || (t.fcExtraFiles || []).some((f) => f && f.data === null)
  );
  const panel = Array.isArray(t.fcPanel) ? t.fcPanel : [];
  const updatePanel = (newPanel) => updateActiveTest({ fcPanel: newPanel });

  const populations = Array.isArray(t.fcPopulations) ? t.fcPopulations : [];
  const updatePopulations = (newPops) => updateActiveTest({ fcPopulations: newPops });

  const addChannel = () => {
    const newCh = { id: `ch_${Date.now()}`, channel: `FL${panel.length + 1}`, fluorochrome: '', antibody: '', clone: '', vendor: '' };
    updatePanel([...panel, newCh]);
  };
  const updateChannel = (id, field, value) => updatePanel(panel.map(ch => ch.id === id ? { ...ch, [field]: value } : ch));
  const removeChannel = (id) => updatePanel(panel.filter(ch => ch.id !== id));

  const addPopulation = () => {
    const newPop = { id: `pop_${Date.now()}`, name: `Population ${populations.length + 1}`, parentGate: 'None', percentParent: '', mfi: '', count: '', color: COLORS[populations.length % COLORS.length] };
    updatePopulations([...populations, newPop]);
  };
  const updatePopulation = (id, field, value) => updatePopulations(populations.map(p => p.id === id ? { ...p, [field]: value } : p));
  const removePopulation = (id) => updatePopulations(populations.filter(p => p.id !== id));

  const [updater, setUpdater] = useState(0);
  const [fcsMsg, setFcsMsg] = useState('');
  const [driveTestMsg, setDriveTestMsg] = useState('');
  // When several .fcs files are uploaded: 'same' (default) loads them all into
  // the current instance as extra spectra; 'separate' creates one condition
  // (instance) per file.
  const [fcsMultiMode, setFcsMultiMode] = useState('same');
  const [archivingCached, setArchivingCached] = useState(false);

  // Restore the in-memory FCS cache when the test is (re)opened: first from the
  // persisted payload (small files), then from the IndexedDB copy of the raw
  // files (files too large for the payload, e.g. after a page reload). If files
  // are still missing, fall back to Google Drive automatically — once per
  // session — so data does not silently stay away. The whole experiment group
  // (all sibling instances) is restored at once, so opening any tab brings back
  // every instance's data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const testName = t.name || '';
      const allTests = Array.isArray(ctx.allTests) ? ctx.allTests
        : Array.isArray(ctx.tests) ? ctx.tests
          : [t];
      const group = allTests.filter((x) => x && String(x.name || '') === String(testName) && String(testName).trim() !== '');
      const members = group.length > 0 ? group : [t];
      let restored = 0;
      for (const m of members) {
        if (!m || !m.id) continue;
        restoreFcsCacheFromTest(m);
        restored += await restoreFcsCacheFromIndexedDb(m);
      }
      if (cancelled) return;
      if (restored > 0) setFcsMsg(`✅ Restored ${restored} .fcs file(s) from the browser cache.`);
      setUpdater((u) => u + 1);

      const anyMissing = members.some((m) => m && !globalFcsCache[m.id] &&
        (m.fcParsed === null || (m.fcExtraFiles || []).some((f) => f && f.data === null)));
      if (anyMissing && getDriveToken() && !autoDriveRestoreDone.has(t.id)) {
        autoDriveRestoreDone.add(t.id);
        handleRestoreFromDrive();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  // After the user connects Google Drive (from the warning card), restore the
  // missing files automatically — for any sibling instance that still lacks data.
  useEffect(() => {
    const onDriveConnected = () => {
      const testName = t.name || '';
      const allTests = Array.isArray(ctx.allTests) ? ctx.allTests
        : Array.isArray(ctx.tests) ? ctx.tests
          : [t];
      const group = allTests.filter((x) => x && String(x.name || '') === String(testName) && String(testName).trim() !== '');
      const members = group.length > 0 ? group : [t];
      const needsDrive = members.some((m) => m && !globalFcsCache[m.id] &&
        (m.fcParsed === null || (m.fcExtraFiles || []).some((f) => f && f.data === null)));
      if (needsDrive && getDriveToken() && !autoDriveRestoreDone.has(t.id)) {
        autoDriveRestoreDone.add(t.id);
        handleRestoreFromDrive();
      }
    };
    window.addEventListener('lab:drive-connected', onDriveConnected);
    return () => window.removeEventListener('lab:drive-connected', onDriveConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  const handleFCSUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setFcsMsg(`Parsing ${files.length} FCS file(s)...`);

    const parseFile = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = parseFCSFile(ev.target.result);
          if (!parsed || typeof parsed.numEvents !== 'number') throw new Error('Parser returned invalid data structure.');
          parsed.filename = file.name;
          resolve({ parsed, file });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsArrayBuffer(file);
    });

    try {
      const results = [];
      for (let file of files) {
        const res = await parseFile(file);
        results.push(res);
      }

      // Handle the FIRST file directly onto the active test tab
      const first = results[0].parsed;
      globalFcsCache[activeTest.id] = first;
      const metadataUpdates = mapFCSMetadata(first.textDict);
      metadataUpdates.instanceName = first.filename.replace(/\.[^/.]+$/, "");
      // Persist the parsed data on the test so it survives close/reopen.
      metadataUpdates.fcParsed = serializeFcsForSave(first);
      // Raw file kept in the browser (IndexedDB) so even files too large for
      // fcParsed survive a page reload; fcsFileName validates the cached copy.
      metadataUpdates.fcsFileName = results[0].file.name || first.filename || '';
      saveFcsFile(activeTest.id, results[0].file);
      
      const currentPanel = Array.isArray(t.fcPanel) ? t.fcPanel : [];
      if (currentPanel.length === 0) {
          const newPanel = [];
          first.params.forEach((p, i) => {
              const n = (p.name || '').toUpperCase();
              if (n.includes('FSC') || n.includes('SSC') || n.includes('TIME')) return;
              newPanel.push({ id: `ch_${Date.now()}_${i}`, channel: p.name || `FL${i}`, fluorochrome: '', antibody: p.label ? p.label.replace(/[/\\]+$/, '').trim() : '', clone: '', vendor: '' });
          });
          if (newPanel.length > 0) metadataUpdates.fcPanel = newPanel;
      }
      updateActiveTest(metadataUpdates);

      // Handle SUBSEQUENT files — either one instance (tab) per file (default),
      // or all loaded into the SAME instance as extra spectra.
      if (results.length > 1) {
        if (fcsMultiMode === 'same') {
          const extraFiles = [...(t.fcExtraFiles || [])];
          for (let i = 1; i < results.length; i++) {
            const parsed = results[i].parsed;
            const extraId = 'fcx' + Date.now() + i + Math.random().toString(36).substring(2, 5);
            globalFcsCache[extraId] = parsed;
            extraFiles.push({ id: extraId, filename: parsed.filename || `Spectrum ${i + 1}`, data: serializeFcsForSave(parsed) });
            saveFcsFile(extraId, results[i].file);
          }
          updateActiveTest({ fcExtraFiles: extraFiles });
        } else if (ctx.setTests) {
          ctx.setTests(prevTests => {
              const newTests = [];
              for (let i = 1; i < results.length; i++) {
                  const parsed = results[i].parsed;
                  const newId = 't' + Date.now() + i + Math.random().toString(36).substring(2,5);
                  
                  globalFcsCache[newId] = parsed;
                  const meta = mapFCSMetadata(parsed.textDict);
                  
                  const cloned = JSON.parse(JSON.stringify(activeTest));
                  cloned.id = newId;
                  cloned.instanceName = parsed.filename.replace(/\.[^/.]+$/, "");
                  cloned.fcParsed = serializeFcsForSave(parsed);
                  cloned.fcsFileName = results[i].file.name || parsed.filename || '';
                  saveFcsFile(newId, results[i].file);
                  // Do NOT inherit the first instance's extra spectra — each new
                  // instance gets its own files.
                  delete cloned.fcExtraFiles;
                  Object.assign(cloned, meta); 
                  
                  newTests.push(cloned);
              }
              return [...prevTests, ...newTests];
          });
        }
      }

      // Archive the RAW .fcs file(s) to Google Drive automatically (best-effort).
      const driveConnected = getDriveToken();
      let driveSaved = 0;
      if (driveConnected) {
        const driveCtx = {
          project: (activeTest.projectNames || [])[0] || '',
          test: activeTest.name || '',
          scientist: activeTest.operator || '',
          section: 'Data',
          subsection: 'Flow Cytometry'
        };
        for (let i = 0; i < results.length; i++) {
          const file = results[i].file;
          try {
            // The importer renames the instance to the file name (async state
            // update — activeTest.instanceName is still the old value here).
            const instanceForFile = ((results[i].parsed && results[i].parsed.filename) || '').replace(/\.[^/.]+$/, '') || activeTest.instanceName || '';
            const base = String(file.name || '').replace(/\.[^/.]+$/, '');
            const suffix = results.length > 1 ? `fcs${i + 1}` : 'fcs';
            const name = withExtension(
              suggestDriveFileName({ ...driveCtx, instance: instanceForFile, title: base, suffix }),
              file.name || 'fcs'
            );
            await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...driveCtx, instance: instanceForFile, title: base, suffix } });
            driveSaved++;
          } catch (err) {
            console.warn('FCS Drive archive failed:', err && err.message);
          }
        }
      }

      setFcsMsg(driveConnected
        ? (driveSaved === results.length
            ? `✅ Successfully loaded ${results.length} file(s) — all saved to Google Drive.`
            : `⚠️ Successfully loaded ${results.length} file(s) — ${driveSaved} saved to Google Drive. Drive access expired or became unavailable during the upload: reconnect Google Drive from the sidebar and re-upload the remaining file(s) to archive them on Drive too.`)
        : `⚠️ Successfully loaded ${results.length} file(s) — Google Drive was not connected at that moment (the access token may have expired), so the raw .fcs file(s) were only kept in this browser's cache. Reconnect Google Drive from the sidebar, then use “Archive cached .fcs to Drive” below to save them on Drive too.`);
      setUpdater(u => u + 1);
    } catch (err) {
      setFcsMsg(`⚠️ Error: ${err.message}`);
      console.error('FCS Parse Error:', err);
    }
    e.target.value = '';
  };

  // Upload the raw .fcs file(s) that are kept in THIS browser's cache
  // (IndexedDB) to Google Drive. Used when an upload happened while Drive was
  // not connected, so the raw files are recovered onto Drive without creating
  // duplicate instances (they are re-uploaded under each instance's own id and
  // file name). Covers all sibling instances of the experiment.
  const handleArchiveCachedToDrive = async () => {
    if (!getDriveToken()) { setFcsMsg('⚠️ Google Drive is not connected — use “Connect Google Drive” below, then try again.'); return; }
    setArchivingCached(true);
    setFcsMsg('⬆️ Uploading the cached .fcs file(s) to Google Drive…');
    try {
      const testName = t.name || '';
      const allTests = Array.isArray(ctx.allTests) ? ctx.allTests
        : Array.isArray(ctx.tests) ? ctx.tests
          : [t];
      const group = allTests.filter((x) => x && String(x.name || '') === String(testName) && String(testName).trim() !== '');
      const members = group.length > 0 ? group : [t];
      const driveCtx = {
        project: (t.projectNames || [])[0] || '',
        test: testName,
        scientist: t.operator || '',
        section: 'Data',
        subsection: 'Flow Cytometry'
      };
      let uploaded = 0;
      let found = 0;
      const uploadOne = async (file, filename, instanceName, suffix) => {
        if (!file) return;
        found++;
        try {
          const base = String(filename || 'fcs').replace(/\.[^/.]+$/, '');
          const name = withExtension(
            suggestDriveFileName({ ...driveCtx, instance: instanceName || base, title: base, suffix: suffix || 'fcs' }),
            filename || 'fcs'
          );
          await uploadLocalFile({
            name,
            mimeType: file.type || 'application/octet-stream',
            file,
            ctx: { ...driveCtx, instance: instanceName || base, title: base, suffix: suffix || 'fcs' }
          });
          uploaded++;
        } catch (e) {
          console.warn('FCS cache archive failed:', e && e.message);
        }
      };
      for (const m of members) {
        if (!m || !m.id) continue;
        const main = await loadFcsFile(m.id);
        await uploadOne(main && main.file, (main && main.filename) || m.fcsFileName, m.instanceName, 'fcs');
        for (const f of (m.fcExtraFiles || [])) {
          if (!f || !f.id) continue;
          const ex = await loadFcsFile(f.id);
          await uploadOne(ex && ex.file, (ex && ex.filename) || f.filename, m.instanceName, 'fcs');
        }
      }
      setFcsMsg(uploaded > 0
        ? `✅ Archived ${uploaded} of ${found} cached .fcs file(s) to Google Drive.`
        : `⚠️ No cached .fcs file(s) were found in this browser to archive. If the files were loaded on another computer, use “Restore from Drive” (or the weekly HTML backups).`);
    } catch (err) {
      setFcsMsg(`⚠️ Archive error: ${err.message}`);
      console.error('FCS cache archive error:', err);
    } finally {
      setArchivingCached(false);
    }
  };
  // Re-download the raw .fcs files that were archived to Google Drive and
  // re-parse them into the in-memory cache — the fallback for files too large
  // to persist inside the dataset payload.
  const [restoringFromDrive, setRestoringFromDrive] = useState(false);
  // Restore the .fcs files for the WHOLE experiment (all sibling instances),
  // not just the active tab. Each Drive file is matched back to the instance
  // that uploaded it (instanceName / fcsFileName), so separate-instance uploads
  // are rebuilt as separate instances and same-instance uploads keep their
  // extras. Files are located via the local registry first, then — on a machine
  // where the registry is empty (e.g. a different browser/computer) — by a
  // Drive name search, so the files found on Drive are actually loadable.
  const handleRestoreFromDrive = async () => {
    if (!getDriveToken()) { setFcsMsg('⚠️ Google Drive is not connected — use “Connect Google Drive” below, then the files will restore automatically.'); return; }
    setRestoringFromDrive(true);
    setFcsMsg('⬇️ Downloading .fcs files from Google Drive…');
    try {
      const testName = activeTest.name || '';
      const stemOf = (n) => String(n || '').replace(/\.[^/.]+$/, '').trim().toLowerCase();
      const slugOf = (s) => sanitizeSlug(String(s || '')).toLowerCase();
      // Two file names designate the same file when their slugged stems are equal
      // or when one is the DRIVE name of the other ("Sample 2" vs the archived
      // "Sample_2_<scientist>.fcs"). This matters because an earlier version of
      // the restore overwrote the declared name with the Drive name: the exact
      // comparison alone stopped recognising the file afterwards, the file could
      // no longer be matched back to its condition and every restore dumped it on
      // the FIRST condition tab of the experiment (see targetOf below).
      const sameStem = (a, b) => {
        const x = slugOf(stemOf(a));
        const y = slugOf(stemOf(b));
        if (!x || !y) return false;
        return x === y || x.startsWith(y + '_') || y.startsWith(x + '_');
      };

      // Every instance of this experiment (all sibling tabs share the name).
      const allTests = Array.isArray(ctx.allTests) ? ctx.allTests
        : Array.isArray(ctx.tests) ? ctx.tests
          : Array.isArray(ctx.instances) ? ctx.instances.map((i) => i.test || i)
            : [t];
      const siblings = allTests.filter((x) => x && String(x.name || '') === String(testName) && String(testName).trim() !== '');
      const targets = (siblings.length > 0 ? siblings : [t]).filter(Boolean);

      // ── 1. Locate the candidate files ──────────────────────────────────────
      // The registry is keyed by the Drive FILE ID (`reg[fileId] = { name, ctx, … }`),
      // so the id MUST be read from the KEY: with Object.values() alone every
      // candidate carries `id === undefined`, the download URL becomes
      // `/drive/v3/files/undefined?alt=media`, and Drive answers with an error body
      // the browser refuses to hand over (it has no CORS header) — which surfaces
      // as a misleading "Cannot reach Google Drive (Failed to fetch)".
      const reg = getDriveFileRegistry();
      let candidates = Object.entries(reg)
        .map(([id, e]) => ({ ...e, id }))
        .filter((e) =>
          e && !e.deleted &&
          String(e.ctx?.test || '') === String(testName) &&
          String(e.ctx?.subsection || '') === 'Flow Cytometry'
        );
      const seenIds = new Set(candidates.map((c) => c.id).filter(Boolean));

      // The file stems this experiment declares (main file + extra spectra),
      // BOTH as typed and in the slugged form Google Drive stores them in: the
      // Drive name is built with suggestDriveFileName (sanitizeSlug turns
      // spaces into "_" and drops punctuation), so a search for the raw
      // "Sample 1" never matches the stored "Sample_1_<scientist>.fcs".
      const wantedStems = () => {
        const out = new Map(); // slug search term -> the stem the app declared
        const add = (name) => {
          const raw = stemOf(name);
          const slug = slugOf(raw);
          if (!raw || slug.length < 3) return; // too short: would match anything
          if (!out.has(slug)) out.set(slug, raw);
        };
        targets.forEach((x) => {
          add(x.fcsFileName);
          add(x.instanceName);
          (x.fcExtraFiles || []).forEach((f) => add(f && f.filename));
        });
        return [...out.entries()].map(([slug, raw]) => ({ slug, raw }));
      };

      // Locate the .fcs files of this experiment ON DRIVE BY NAME. Used when
      // the registry is empty (another browser / computer) and again when every
      // registry entry failed to download: the stored ids go stale as soon as
      // the Drive account changes, and a file moved to the Drive TRASH by an
      // old folder cleanup is only reachable once it has been put back (see
      // downloadOne). That is why the query does NOT filter `trashed=false` —
      // and why a hit is accepted only when its Drive name really starts with
      // one of the declared stems ("sample1" must not match "sample10_run2").
      const searchDriveByName = async () => {
        const found = [];
        for (const { slug, raw } of wantedStems()) {
          try {
            const q = encodeURIComponent(`name contains '${slug.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
            const res = await driveFetch(`/drive/v3/files?q=${q}&fields=files(id,name,trashed)&pageSize=50`);
            const j = res && res.ok ? await res.json() : { files: [] };
            (j.files || []).forEach((f) => {
              if (!f || !f.id || seenIds.has(f.id)) return;
              if (!/\.fcs$/i.test(String(f.name || ''))) return;
              const slugName = slugOf(stemOf(f.name));
              if (!(slugName === slug || slugName.startsWith(slug + '_'))) return;
              seenIds.add(f.id);
              // `title` keeps the EXACT declared stem (not the slugged Drive
              // name), so the file is matched back to its instance — and to
              // that instance's MAIN file — exactly like a registry entry.
              found.push({
                id: f.id,
                name: f.name,
                trashed: !!f.trashed,
                ctx: { test: testName, subsection: 'Flow Cytometry', instance: stemOf(f.name), title: raw },
                fromSearch: true
              });
            });
          } catch { /* keep going with the other stems */ }
        }
        return found;
      };

      // Registry missing / empty (different browser or machine): find the .fcs
      // files on Drive by name — each uploaded file carries the source file name
      // (and thus the instance it belonged to) in its Drive name.
      if (candidates.length === 0) {
        setFcsMsg('⬇️ Local registry is empty — searching Google Drive for the .fcs files…');
        candidates = await searchDriveByName();
      }

      if (candidates.length === 0) {
        setFcsMsg('⚠️ No .fcs file of this experiment could be found on Google Drive'
          + ' — neither in this browser\'s upload registry nor by file name (the Drive trash is searched too).'
          + ' If the file(s) were loaded on a computer where Google Drive was not connected,'
          + ' re-open that computer, connect Google Drive and use “⬆️ Archive cached .fcs to Drive”,'
          + ' or re-upload the .fcs file(s) here: they are archived automatically.');
        return;
      }
      // ── 2. Match each candidate to the instance it belongs to ──────────────
      const targetOf = (cand) => {
        const candInstance = slugOf(cand.ctx && cand.ctx.instance);
        const candStem = stemOf(cand.ctx && cand.ctx.title) || stemOf(cand.name);
        if (candInstance) {
          const byInstance = targets.findIndex((x) => slugOf(x.instanceName) && slugOf(x.instanceName) === candInstance);
          if (byInstance >= 0) return byInstance;
          // The instance folder may have been created from the SOURCE file name,
          // while instanceName was edited later — match the declared file too.
          const byFile = targets.findIndex((x) => stemOf(x.fcsFileName) && sameStem(x.fcsFileName, candInstance));
          if (byFile >= 0) return byFile;
          const byLabel = targets.findIndex((x) => stemOf(x.instanceName) && sameStem(x.instanceName, candInstance));
          if (byLabel >= 0) return byLabel;
        }
        if (candStem) {
          const byFile = targets.findIndex((x) => stemOf(x.fcsFileName) && sameStem(x.fcsFileName, candStem));
          if (byFile >= 0) return byFile;
          const byExtra = targets.findIndex((x) => (x.fcExtraFiles || []).some((f) => f && sameStem(f.filename, candStem)));
          if (byExtra >= 0) return byExtra;
        }
        // Nothing matched (a 'same-instance' upload whose recorded context
        // predates a condition rename, an upload made on another computer, a file
        // whose declared name an earlier restore overwrote…): NEVER drop it on an
        // arbitrary tab. `targets[0]` is the FIRST condition of the array, which
        // is usually NOT the condition the user has open — that is exactly how a
        // restore could report success while the visible tab stayed empty. The
        // active tab is where the file was uploaded from, and it is the only place
        // the user can see the data right now.
        const activeIdx = targets.findIndex((x) => x && x.id === t.id);
        return activeIdx >= 0 ? activeIdx : 0;
      };

      // ── 3. Download and distribute ─────────────────────────────────────────
      let restored = 0;
      let failReason = '';
      let searchedOnDrive = false;
      let tokenDead = false; // set when Drive access is gone — retrying is pointless
      // targetId -> { main: {parsed, filename, buf}, extras: Map<stem, {parsed, filename, buf}> }
      const byTarget = new Map();
      const downloadOne = async (entry) => {
        try {
          // A reference without an id can only produce /files/undefined?alt=media
          // (an error page the browser reports as a network failure) — skip it and
          // say so, instead of blaming the connection.
          if (!entry || !entry.id) { failReason = failReason || 'a Drive file reference has no id'; return; }
          // A hit reported by the name search as sitting in the Drive trash is
          // put back FIRST, so the download does not have to fail and retry.
          if (entry.trashed) { await untrashDriveFile(entry.id).catch(() => false); entry.trashed = false; }
          let res;
          try {
            res = await driveFetch(`/drive/v3/files/${entry.id}?alt=media`);
          } catch (driveErr) {
            // An expired/revoked token is final (driveFetch already renewed it
            // once): do not untrash anything, just report it.
            if (driveErr && driveErr.code === 'TOKEN_EXPIRED') {
              failReason = failReason || (driveErr.message || 'Drive access expired');
              tokenDead = true;
              return;
            }
            // A .fcs file that an old folder cleanup (or the user) moved to the
            // Drive TRASH answers 404 — the bytes are still there, so put the
            // file back and download it again (the same recovery the file
            // migration applies before moving a trashed file).
            const back = await untrashDriveFile(entry.id).catch(() => false);
            if (!back) { failReason = failReason || (driveErr && driveErr.message) || 'unknown error'; return; }
            try {
              res = await driveFetch(`/drive/v3/files/${entry.id}?alt=media`);
            } catch (e2) {
              failReason = failReason || (e2 && e2.message) || (driveErr && driveErr.message) || 'unknown error';
              return;
            }
          }
          if (!res || !res.ok) { failReason = failReason || `HTTP ${res ? res.status : 'no response'}`; return; }
          const buf = await res.arrayBuffer();
          const parsed = parseFCSFile(buf);
          if (!parsed || typeof parsed.numEvents !== 'number') { failReason = failReason || 'downloaded file is not a valid .fcs'; return; }
          const ti = targetOf(entry);
          const target = targets[ti];
          if (!target || !target.id) return;
          const entryStem = stemOf(entry.ctx && entry.ctx.title) || stemOf(entry.name);
          // Name the file the way the DATASET declares it — the instance's main
          // file name, or the extra spectrum's own file name — instead of the
          // Drive name "<stem>_<scientist>.fcs". The plots then keep the
          // scientist's file names, and above all a LATER restore recognises the
          // file again: overwriting the declared name with the Drive name used to
          // break the match and to send the file to another condition tab.
          const declaredName = () => {
            const ex = (target.fcExtraFiles || []).find((f) => f && sameStem(f.filename, entryStem));
            if (ex && ex.filename) return ex.filename;
            if (target.fcsFileName && sameStem(target.fcsFileName, entryStem)) return target.fcsFileName;
            return entry.ctx && entry.ctx.title
              ? withExtension(entry.ctx.title, entry.name)
              : (entry.name || 'restored.fcs');
          };
          parsed.filename = declaredName();
          let bucket = byTarget.get(target.id);
          if (!bucket) { bucket = { main: null, extras: new Map() }; byTarget.set(target.id, bucket); }
          const mainStem = stemOf(target.fcsFileName);
          // The same upload can be reached twice (a registry entry AND a Drive
          // name-search hit on a re-uploaded copy): never load one file into
          // one instance twice. The comparison tolerates the archived Drive
          // name ("Sample_2_<scientist>") next to the declared one ("Sample 2").
          if (bucket.main && mainStem && sameStem(mainStem, entryStem)) return;
          if (entryStem && bucket.extras.has(entryStem)) return;
          const isMain = !bucket.main && (
            // the main file of this instance: its instance matches, or its file
            // name is the one the instance declared, or this instance has no
            // declared file yet and this is its first candidate
            (slugOf(entry.ctx && entry.ctx.instance) === slugOf(target.instanceName) && slugOf(target.instanceName)) ||
            (mainStem && sameStem(mainStem, entryStem)) ||
            !target.fcsFileName
          );
          if (isMain) {
            bucket.main = { parsed, filename: parsed.filename, buf, stem: entryStem };
          } else {
            bucket.extras.set(entryStem || ('extra' + bucket.extras.size), { parsed, filename: parsed.filename, buf });
          }
          restored++;
        } catch (e) {
          // driveFetch throws on auth/network errors (e.g. TOKEN_EXPIRED clears
          // the token and the sidebar switches back to "Connect Drive"). Keep
          // the real reason so the user knows exactly what happened.
          failReason = failReason || (e && e.message) || 'unknown error';
          if (e && e.code === 'TOKEN_EXPIRED') tokenDead = true;
        }
      };
      const runDownloads = async (list) => {
        for (const entry of list) {
          if (tokenDead) break; // retrying is pointless
          await downloadOne(entry);
        }
      };
      await runDownloads(candidates);

      // Nothing came back from the registry (stale ids after a Drive account
      // change, an experiment renamed since the upload, files moved to the
      // trash…): look the .fcs files up ON DRIVE BY NAME and try those too,
      // instead of leaving the user with an empty page and no explanation.
      if (restored === 0 && !tokenDead) {
        setFcsMsg('🔎 Nothing came back from the upload registry — searching Google Drive for the .fcs files…');
        searchedOnDrive = true;
        await runDownloads(await searchDriveByName());
      }
      // ── 4. Write the restored data onto EVERY affected instance ────────────
      // The charts read the in-memory cache (`globalFcsCache`), so the cache is
      // filled FIRST and unconditionally: even when the dataset metadata cannot be
      // written (data frozen by a superuser, a read-only project, a preview with
      // no setTests) the downloaded files are never silently thrown away — that
      // is what turned a successful download into "no data in the UI".
      // The metadata (fcParsed / fcsFileName / fcExtraFiles) then goes through the
      // normal write funnels, so it survives a reload (IndexedDB + payload) and
      // reaches every other user of the dataset.
      const patches = new Map(); // instance id -> patch merged into that instance
      byTarget.forEach((bucket, id) => {
        const owner = targets.find((x) => x && x.id === id) || null;
        const patch = {};
        if (bucket.main) {
          globalFcsCache[id] = bucket.main.parsed;
          patch.fcParsed = serializeFcsForSave(bucket.main.parsed);
          patch.fcsFileName = bucket.main.filename;
          saveFcsFile(id, new File([bucket.main.buf], bucket.main.filename, { type: 'application/octet-stream' })).catch(() => {});
        }
        if (bucket.extras.size > 0 && owner) {
          const existing = Array.isArray(owner.fcExtraFiles) ? [...owner.fcExtraFiles] : [];
          bucket.extras.forEach((ex, exStem) => {
            // Reuse the declared extra spectrum instead of piling up copies: the
            // match tolerates the Drive name so an entry that an earlier restore
            // overwrote is recognised again.
            let extra = existing.find((x) => x && sameStem(x.filename, exStem));
            if (!extra) {
              const exId = 'fcxR' + Date.now() + Math.random().toString(36).slice(2, 6);
              extra = { id: exId, filename: ex.filename, data: null };
              existing.push(extra);
            }
            const storedName = extra.filename || ex.filename || 'restored.fcs';
            globalFcsCache[extra.id] = ex.parsed;
            extra.data = serializeFcsForSave(ex.parsed) || extra.data;
            saveFcsFile(extra.id, new File([ex.buf], storedName, { type: 'application/octet-stream' })).catch(() => {});
          });
          patch.fcExtraFiles = existing;
        }
        if (Object.keys(patch).length > 0) patches.set(id, patch);
      });
      if (patches.size > 0) {
        if (typeof ctx.setTests === 'function') {
          ctx.setTests((prev) => prev.map((test) => (
            patches.has(test.id) ? { ...test, ...patches.get(test.id) } : test
          )));
        } else if (typeof updateActiveTest === 'function') {
          // No setTests available (Lab-Notebook / preview page): at least update
          // the instance the user is working on — INCLUDING its extra spectra,
          // which the previous fallback silently dropped.
          const own = patches.get(t.id);
          if (own) updateActiveTest(own);
        }
      }

      // Only mark the instances that actually received data as auto-restored —
      // a sibling that failed (e.g. its file was not found) can still be
      // retried automatically on its own tab.
      byTarget.forEach((_, id) => { if (id) autoDriveRestoreDone.add(id); });
      setUpdater(u => u + 1);
      if (restored === 0) autoDriveRestoreDone.delete(t.id); // allow auto-retry after a reconnect
      if (restored === 0) {
        console.error('FCS Drive restore failed:', {
          test: testName,
          entriesFound: candidates.length,
          failReason,
          tokenPresent: !!getDriveToken()
        });
      }
      const networkErr = failReason && /failed to fetch|networkerror|load failed|offline|timed out|cannot reach/i.test(failReason);
      const searchedNote = searchedOnDrive
        ? ' The Drive name search (which also looks at files sitting in the Drive trash) found nothing usable either.'
        : '';
      // Which conditions actually received files? A restore that answers success
      // while the OPEN tab stays empty is the one thing a user cannot diagnose
      // (the files went to a sibling condition) — so name them in the message.
      const labelOf = (x) => (x && (x.instanceName || x.date || x.name)) || 'unnamed condition';
      const gotIds = [...byTarget.keys()].filter(Boolean);
      const gotLabels = gotIds.map((id) => labelOf(targets.find((x) => x && x.id === id)));
      const activeGot = byTarget.has(t.id);
      const elsewhere = restored > 0 && !activeGot && gotLabels.length > 0
        ? ` ⚠️ None of them belongs to the condition you have open (“${labelOf(t)}”): they were matched to ${gotLabels.join(', ')}. This condition's own .fcs file is therefore NOT on Google Drive (it was probably uploaded from a computer where Drive was not connected) — re-upload it here and it will be archived automatically.`
        : '';
      console.info('[FCS restore]', {
        test: testName,
        candidates: candidates.length,
        restored,
        targets: targets.map((x) => ({ id: x.id, instanceName: x.instanceName, fcsFileName: x.fcsFileName })),
        gotIds,
        activeGot
      });
      setFcsMsg(restored > 0
        ? `✅ Restored ${restored} .fcs file(s) from Google Drive across ${byTarget.size} instance(s).${elsewhere}`
        : networkErr
          ? `⚠️ Could not reach Google Drive (${failReason}). This is a network / browser-blocking problem, not an expired token — check your internet connection, VPN / proxy or ad-blocker. Manual recovery: open Google Drive in a new tab, download the .fcs files, and re-upload them with “Choose .fcs file(s)”.`
          : `⚠️ Could not download the .fcs files from Google Drive${failReason ? ` (${failReason})` : ''}.${searchedNote} If the Drive token expired, reconnect Google Drive from the sidebar and try again.`);
    } catch (err) {
      setFcsMsg(`⚠️ Restore error: ${err.message} (reconnect Google Drive from the sidebar if the token expired).`);
      console.error('FCS Drive restore error:', err);
    } finally {
      setRestoringFromDrive(false);
    }
  };

  // Small connectivity probe: tells exactly whether the Drive API is reachable
  // and the stored token works, so a "Failed to fetch" can be pinpointed.
  const testDriveConnection = async () => {
    if (!getDriveToken()) { setDriveTestMsg('❌ No Drive token — connect Google Drive first.'); return; }
    setDriveTestMsg('Testing connection…');
    try {
      await driveFetch('/drive/v3/files?pageSize=1&fields=files(id)');
      setDriveTestMsg('✅ Google Drive API reachable and the token works.');
    } catch (e) {
      setDriveTestMsg(`❌ ${e.message || 'Failed to fetch'}`);
    }
  };

  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const handleImportPopulations = () => {
    if (!importText.trim()) { setImportMsg('⚠️ Please paste some data first.'); return; }
    try {
      const lines = importText.trim().split(/\r?\n/);
      if (lines.length < 2) throw new Error('Need at least a header row and one data row.');
      const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
      const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));
      const idxName = findCol(['population', 'name', 'gate', 'node']);
      const idxParent = findCol(['parent', 'hierarchy']);
      const idxPerc = findCol(['%', 'frequency', 'parent']);
      const idxMFI = findCol(['mfi', 'median', 'mean']);
      const idxCount = findCol(['count', 'events']);
      if (idxName === -1 && idxPerc === -1 && idxMFI === -1) throw new Error('Could not recognize headers.');

      const newPops = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map(c => c.trim().replace(/['"]/g, ''));
        if (cols.length < 2) continue;
        const name = idxName >= 0 ? cols[idxName] : `Population ${i}`;
        if (!name) continue;
        newPops.push({
          id: `pop_${Date.now()}_${i}`, name, parentGate: idxParent >= 0 ? cols[idxParent] : 'None',
          percentParent: idxPerc >= 0 ? cols[idxPerc] : '', mfi: idxMFI >= 0 ? cols[idxMFI] : '',
          count: idxCount >= 0 ? cols[idxCount] : '', color: COLORS[(populations.length + newPops.length) % COLORS.length]
        });
      }
      if (newPops.length === 0) throw new Error('No valid data rows found.');
      updatePopulations([...populations, ...newPops]);
      setImportMsg(`✅ Successfully imported ${newPops.length} populations.`);
      setImportText('');
    } catch (err) { setImportMsg(`⚠️ Error: ${err.message}`); }
  };

  return (
    <CollapsibleSection title="Flow Cytometry Data" icon="🩸" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-indigo-900">🧬 Import Raw FCS File (.fcs)</h4>
            <span className="text-[9px] bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded font-bold">Parses binary event data & auto-fills fields</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors">
              📄 Choose .fcs file(s)…
              <input type="file" accept=".fcs" multiple onChange={handleFCSUpload} className="hidden" />
            </label>
            <select value={fcsMultiMode} onChange={(e) => setFcsMultiMode(e.target.value)}
                    className="text-[10px] font-bold bg-white border border-indigo-300 text-indigo-800 px-2 py-2 rounded-lg shadow-sm outline-none cursor-pointer"
                    title="When uploading several .fcs files: load each into its own instance (condition tab) or load them all into the current instance">
              <option value="separate">Multiple files → separate instances</option>
              <option value="same">Multiple files → same instance</option>
            </select>
            {fcsMsg && <span className="text-xs font-bold text-indigo-900">{fcsMsg}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {getDriveToken() && (
              <button
                type="button"
                onClick={handleArchiveCachedToDrive}
                disabled={archivingCached}
                title="Upload the raw .fcs file(s) that are kept in this browser's cache to Google Drive (no duplicate instances are created)"
                className="bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100 font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors disabled:opacity-50"
              >
                {archivingCached ? '⬆️ Uploading…' : '⬆️ Archive cached .fcs to Drive'}
              </button>
            )}
          </div>
          {persistedFcsWasTooLarge && (
            <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs font-bold text-amber-800">
                ⚠️ Some .fcs files are too large to embed in the saved dataset. They are archived in
                Google Drive and, on this computer, in the browser cache (restored automatically).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {getDriveToken() ? (
                  <>
                    <button
                      type="button"
                      onClick={handleRestoreFromDrive}
                      disabled={restoringFromDrive}
                      title="Download and re-parse the .fcs files archived on Google Drive (saved automatically at upload)"
                      className="bg-indigo-600 text-white hover:bg-indigo-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors disabled:opacity-50"
                    >
                      {restoringFromDrive ? '⬇️ Download…' : '⬇️ Restore from Drive'}
                    </button>
                    <button
                      type="button"
                      onClick={testDriveConnection}
                      className="bg-white text-slate-700 hover:bg-slate-100 font-bold px-3 py-1.5 rounded-lg text-xs border border-slate-300 shadow-sm transition-colors"
                      title="Run a small probe against the Google Drive API to see exactly why requests fail"
                    >
                      🔍 Test Drive connection
                    </button>
                    {driveTestMsg && <span className="text-[11px] font-bold text-amber-800">{driveTestMsg}</span>}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => { try { window.dispatchEvent(new CustomEvent('lab:connect-drive')); } catch { /* ignore */ } }}
                    title="Connect Google Drive, then the missing .fcs files will be downloaded automatically"
                    className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors"
                  >
                    🔗 Connect Google Drive to restore files
                  </button>
                )}
              </div>
              <p className="text-[10px] text-amber-700">
                Needed when the browser cache is unavailable (e.g. on another computer). If the
                app cannot reach Google Drive from this browser/network (e.g. a corporate proxy or
                an ad-blocker blocks it), you can still recover your files: open Google Drive in a
                new tab, find the .fcs files of this experiment, download them, and re-upload them
                with “Choose .fcs file(s)” above.
              </p>
            </div>
          )}
        </div>

        <FCSDataVisualizations ctx={ctx} updater={updater} />

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-blue-900">🧪 Staining Panel</h4>
            <button onClick={addChannel} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">+ Add Channel</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left bg-white rounded-lg overflow-hidden">
              <thead className="bg-blue-100 text-blue-800 uppercase">
                <tr><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Fluorochrome</th><th className="px-3 py-2">Antibody / Target</th><th className="px-3 py-2">Clone</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {panel.length === 0 ? (<tr><td colSpan="6" className="px-3 py-4 text-center text-slate-400 italic">No channels defined. (Load an FCS file to auto-populate)</td></tr>) : panel.map((ch) => (
                  <tr key={ch.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5"><input type="text" value={ch.channel} onChange={e => updateChannel(ch.id, 'channel', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.fluorochrome} onChange={e => updateChannel(ch.id, 'fluorochrome', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" placeholder="e.g. FITC" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.antibody} onChange={e => updateChannel(ch.id, 'antibody', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-32" placeholder="e.g. anti-CD4" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.clone} onChange={e => updateChannel(ch.id, 'clone', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.vendor} onChange={e => updateChannel(ch.id, 'vendor', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" /></td>
                    <td className="px-3 py-1.5"><button onClick={() => removeChannel(ch.id)} className="text-red-500 hover:text-red-700 font-bold">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-sky-900">📥 Import Summary Table (CSV / Text)</h4>
            <span className="text-[9px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded font-bold">Paste from FlowJo Table Editor</span>
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={`Population\tCount\t%Parent\tMFI\nLymphocytes\t50000\t100\t450`} className="w-full border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 h-24 custom-scrollbar bg-white" />
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleImportPopulations} disabled={!importText.trim()} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">Import & Append to Table</button>
            {importMsg && <span className="text-xs font-bold text-sky-900">{importMsg}</span>}
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-emerald-900">🎯 Populations & Gating Results</h4>
            <button onClick={addPopulation} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">+ Add Population</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left bg-white rounded-lg overflow-hidden">
              <thead className="bg-emerald-100 text-emerald-800 uppercase">
                <tr><th className="px-3 py-2">Population Name</th><th className="px-3 py-2">Parent Gate</th><th className="px-3 py-2">% of Parent</th><th className="px-3 py-2">MFI</th><th className="px-3 py-2">Count</th><th className="px-3 py-2">Color</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {populations.length === 0 ? (<tr><td colSpan="7" className="px-3 py-4 text-center text-slate-400 italic">No populations defined.</td></tr>) : populations.map((pop) => (
                  <tr key={pop.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5"><input type="text" value={pop.name} onChange={e => updatePopulation(pop.id, 'name', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-32 font-bold" /></td>
                    <td className="px-3 py-1.5"><select value={pop.parentGate} onChange={e => updatePopulation(pop.id, 'parentGate', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-28"><option value="None">None</option>{populations.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></td>
                    <td className="px-3 py-1.5"><input type="number" step="0.01" value={pop.percentParent} onChange={e => updatePopulation(pop.id, 'percentParent', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="number" step="0.1" value={pop.mfi} onChange={e => updatePopulation(pop.id, 'mfi', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="number" value={pop.count} onChange={e => updatePopulation(pop.id, 'count', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="color" value={pop.color} onChange={e => updatePopulation(pop.id, 'color', e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-slate-300" /></td>
                    <td className="px-3 py-1.5"><button onClick={() => removePopulation(pop.id)} className="text-red-500 hover:text-red-700 font-bold">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};


export const DataAnalysis = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const populations = Array.isArray(activeTest.fcPopulations) ? activeTest.fcPopulations : [];
  
  const chartData = populations.filter(p => p.percentParent !== '' && p.percentParent !== undefined).map(p => ({
    name: p.name, value: parseFloat(p.percentParent) || 0, fill: p.color || '#3b82f6'
  }));

  const vizCfgFreq = activeTest.vizCfgFreq || {};
  const setVizCfgFreq = (patch) => updateActiveTest({ vizCfgFreq: { ...vizCfgFreq, ...patch } });
  const cfgFreq = { ...DEFAULT_CHART_STYLE, ...vizCfgFreq };
  const [fsFreq, setFsFreq] = useState(false);
  const [showCfgFreq, setShowCfgFreq] = useState(false);
  // Interrupted Y axis for the frequency bars (one population can dwarf the rest).
  const brkFreq = brokenAxisProps(cfgFreq, 'y', chartData.map(c => c.value), { log: !!cfgFreq.yLog, min: cfgFreq.yMin, max: cfgFreq.yMax });

  // Restore the in-memory FCS cache when the test is (re)opened — the payload
  // copy first (small files), then the IndexedDB copy for files too large for
  // the payload (e.g. after a page reload).
  const [, forceRender] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      restoreFcsCacheFromTest(activeTest);
      await restoreFcsCacheFromIndexedDb(activeTest);
      if (!cancelled) forceRender((v) => v + 1);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTest && activeTest.id]);

  return (
    <CollapsibleSection title="Data Analysis & Visualization" icon="📊" defaultOpen={false}>
      <div className="flex flex-col gap-6">
        <FCSOverlayVisualization ctx={ctx} />
        {chartData.length > 0 ? (
          <div className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3 ${fsFreq ? FS_CLASSES + ' z-[999999]' : ''}`}>
            {fsFreq && <div className={OVERLAY_CLASSES} onClick={() => setFsFreq(false)} />}
            <div className="flex justify-between items-center shrink-0 z-10 border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-700">Population Frequencies (% of Parent)</h4>
              <div className="flex items-center gap-2">
                <ChartControlBar showCfg={showCfgFreq} onToggleCfg={() => setShowCfgFreq(!showCfgFreq)} />
                <button type="button" onClick={() => setFsFreq(!fsFreq)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fsFreq ? '↙️ Exit' : '↗️ Fullscreen'}</button>
              </div>
            </div>
            {showCfgFreq && <SharedChartStylePanel cfg={cfgFreq} setCfg={setVizCfgFreq} series={chartData.map(c => ({key: c.name, label: c.name, color: c.fill}))} unit="%" />  }
            <ChartInspector cfg={cfgFreq} setCfg={setVizCfgFreq}
              series={chartData.map(c => ({ key: c.name, label: c.name, color: c.fill }))} unit="%"
              className={`relative ${fsFreq ? 'flex-1 min-h-0' : 'h-[300px]'}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={cfgChartMargin(cfgFreq, { top: 20, right: 30, left: 20, bottom: 50 })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: Math.max(9, cfgFreq.fontSize - 2) }} angle={-15} textAnchor="end" />
                  <YAxis {...brkFreq.axisProps} tick={{ fontSize: Math.max(9, cfgFreq.fontSize - 2) }} label={cfgAxisLabel(cfgFreq, 'y', '% of Parent', 10)} />
                  <Tooltip formatter={(value) => `${value}%`} />
                  {brkFreq.marks}
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartInspector>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
            Add gating populations to see frequency charts.
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const t = activeTest || {};
  
  if (checkId === 'cond') {
    const parts = [];
    if (t.experimentDate) parts.push(`Date: ${t.experimentDate}`);
    if (t.cellNumber) parts.push(`Cells: ${t.cellNumber}`);
    if (t.liveDeadStain) parts.push(`Live/Dead: ${t.liveDeadStain}`);
    if (t.fixation && t.fixation !== 'None') parts.push(`Fixation: ${t.fixation}`);
    if (t.permeabilization && t.permeabilization !== 'None') parts.push(`Perm: ${t.permeabilization}`);
    if (t.otherConditions) parts.push(`Other: ${t.otherConditions}`);
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Flow Cytometry Conditions:</b> ${parts.join(' | ') || 'N/A'}</p>`;
  }
  if (checkId === 'instrument') {
    const instr = [];
    if (t.cytometerModel) instr.push(`Model: ${t.cytometerModel}`);
    if (t.cytometerSerial) instr.push(`Serial: ${t.cytometerSerial}`);
    if (t.acquisitionSoftware) instr.push(`Software: ${t.acquisitionSoftware}`);
    if (t.lasers) instr.push(`Lasers: ${t.lasers}`);
    if (t.threshold) instr.push(`Threshold: ${t.threshold}`);
    if (t.compensationApplied) instr.push(`Compensation: ${t.compensationApplied}`);
    if (t.plateName) instr.push(`Plate: ${t.plateName}`);
    if (t.wellId) instr.push(`Well: ${t.wellId}`);
    if (instr.length === 0) return '';
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Instrumental Setup:</b> ${instr.join(' | ')}</p>`;
  }
  if (checkId === 'panel') {
    const panel = Array.isArray(t.fcPanel) ? t.fcPanel : [];
    if (panel.length === 0) return '';
    let html = `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Staining Panel:</b></p><ul style="font-size: 11px; color: #64748b; margin-left: 20px;">`;
    panel.forEach(ch => { html += `<li>${ch.channel}: ${ch.fluorochrome} - ${ch.antibody} (${ch.clone}, ${ch.vendor})</li>`; });
    html += `</ul>`;
    return html;
  }
  if (checkId === 'gating') {
    const pops = Array.isArray(t.fcPopulations) ? t.fcPopulations : [];
    if (pops.length === 0) return '';
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Population</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Parent</th><th style="padding: 6px; border: 1px solid #cbd5e1;">% Parent</th><th style="padding: 6px; border: 1px solid #cbd5e1;">MFI</th></tr>`;
    pops.forEach(p => { html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold; color: ${p.color};">${p.name}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${p.parentGate}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${p.percentParent || '-'}%</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${p.mfi || '-'}</td></tr>`; });
    html += `</table>`;
    return html;
  }
  return '';
};

export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <Data ctx={ctx} />
    <DataAnalysis ctx={ctx} />
  </div>
);

export default All;