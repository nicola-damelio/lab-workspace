// components/FlowCytometrySections.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { DriveUploadButton } from './DriveUpload';
import { suggestDriveFileName } from '../utils/driveNaming';
import { uploadLocalFile, withExtension, getDriveToken } from '../utils/driveUpload';
import {BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, ComposedChart, Area, ReferenceArea} from 'recharts';
import { ChartControlBar, SharedChartStylePanel } from './SharedAnalysisTools';
import { CollapsibleSection } from './ui';
import { FS_CLASSES, OVERLAY_CLASSES, VIS_PALETTES, seriesColorFor } from '../utils/chartStyle';
export { VIS_PALETTES };

const COLORS = VIS_PALETTES.default;
const DEFAULT_CHART_STYLE = { height: 380, aspect: 1.8, fontSize: 12, tickStep: '', tickAngle: 0, ptStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2, legend: 'top', colors: {}, barRadius: 3, xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: '' };
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

// =========================================================================
// CANVAS 2D OVERLAY
// =========================================================================
const Canvas2DPlotOverlay = ({ series, xParam, yParam, xLabel, yLabel, logX, logY, cfg, fs, gates, onAddGate, interactionMode, xDomain, yDomain, onZoom }) => {
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

      ctx.fillStyle = '#334155'; ctx.font = `bold ${cfg.fontSize || 12}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(`${xLabel}${logX ? ' (Log)' : ''}`, pad.left + plotW / 2, H - 10);
      
      ctx.save(); ctx.translate(20, pad.top + plotH / 2); ctx.rotate(-Math.PI / 2); // Shifted Y-label rightward
      ctx.fillText(`${yLabel}${logY ? ' (Log)' : ''}`, 0, 0); ctx.restore();
      
      ctx.fillStyle = '#64748b'; ctx.font = `${Math.max(9, (cfg.fontSize || 12) - 2)}px sans-serif`;
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
  }, [series, xParam, yParam, xLabel, yLabel, logX, logY, cfg, fs, drawPath, gates, interactionMode, xDomain, yDomain]);

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
      style={fs ? { width: '100%', height: '100%' } : { width: '100%', aspectRatio: String(cfg.aspect || 1.8), height: cfg.height || 380 }} 
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

  const [fs, setFs] = useState(false);
  const [showCfg, setShowCfg] = useState(false);

  const hiddenSeries = activeTest.hiddenSeries || {}; 
  const paramRenames = activeTest.paramRenames || {};
  const panelArray = activeTest.fcPanel || [];

  const [localColors, setLocalColors] = useState(activeTest.fcColors || {});
  const [customPaletteInput, setCustomPaletteInput] = useState('#ef4444, #3b82f6, #22c55e');

  const instances = useMemo(() => {
    let list = null;
    if (ctx) {
      if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch {} }
      if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
    }
    if (!list || !list.length) list = [activeTest];
    const norm = list.filter(Boolean).map(t => ({ id: t.id, name: t.instanceName || t.name, test: t }));
    if (!norm.some(i => i.id === activeTest.id)) norm.unshift({ id: activeTest.id, name: activeTest.name, test: activeTest });
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

    return { bins, domain: [globalMin, globalMax] };
  }, [overlayParam, visibleInstances, logScale, smoothHist, fillHist, smoothSigma]);

  const chartRef = useRef(null);
  const zoom = useXZoom(chartRef, chartData.domain);
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

  return (
    <>
      {fs && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99990]" onClick={() => setFs(false)} />}
      <div className={fs ? "fixed inset-4 z-[99999] bg-white p-6 rounded-2xl shadow-2xl flex flex-col gap-3 overflow-hidden" : "flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full"}>
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200 mb-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
          
          <div className="flex flex-wrap items-center gap-2">
            <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50 outline-none cursor-pointer">
              <option value="">🎨 Apply Palette...</option>
              {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <span className="text-slate-300 hidden md:inline">|</span>
            <input 
              type="text" 
              placeholder="#f00, #0f0..." 
              value={customPaletteInput} 
              onChange={e => setCustomPaletteInput(e.target.value)} 
              className="text-[10px] border border-slate-300 px-2 py-1 rounded w-32 outline-none focus:border-blue-500" 
            />
            <button onClick={() => applyPalette('custom')} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">Apply Custom</button>
          </div>
        </div>

        <div className="flex justify-between items-center z-10 shrink-0 border-b border-slate-100 pb-2">
          <h5 className="text-sm font-bold text-slate-700">1D Histogram (Data Analysis)</h5>
          <div className="flex items-center gap-2">
            <select value={overlayParam} onChange={e => setOverlayParam(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[120px]">
              {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2">
              <input type="checkbox" checked={logScale} onChange={e => setLogScale(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
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
            <button type="button" onClick={() => setFs(!fs)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs ? '↙️ Exit' : '↗️ Fullscreen'}</button>
          </div>
        </div>
        
        {showCfg && <SharedChartStylePanel cfg={cfgAna} setCfg={setVizCfgAna} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}
        
        <div className={`${fs ? 'flex-1 min-h-0' : ''} ${splitStack ? 'flex flex-col lg:flex-row gap-3' : ''}`}>
          <div ref={chartRef} onMouseDown={zoom.onMouseDown} className={`bg-slate-50 rounded border border-slate-200 p-2 select-none relative overflow-hidden cursor-crosshair min-w-0 ${fs ? 'flex-1 min-h-0' : splitStack ? 'lg:w-[54%] h-[300px]' : 'w-full h-[300px]'}`}>
            {zoom.isZoomed && <button type="button" onClick={zoom.reset} className="absolute top-2 right-2 z-10 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData.bins} margin={{ top: 10, right: 20, left: 75, bottom: 45 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="x" type="number" domain={zoom.domain} allowDataOverflow tickFormatter={(v) => v.toFixed(logScale ? 1 : 0)} tick={{ fontSize: Math.max(9, cfgAna.fontSize - 2) }} label={{ value: `${label1D}${logScale ? ' (Log)' : ''}`, position: 'insideBottom', offset: -10, fontSize: cfgAna.fontSize }} />
                <YAxis tick={{ fontSize: Math.max(9, cfgAna.fontSize - 2) }} label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: -5, fontSize: cfgAna.fontSize }} />
                <Tooltip labelFormatter={(label) => `Value: ${Number(label).toFixed(logScale ? 2 : 0)}`} formatter={(value) => [value, 'Events']} />
                {visibleInstances.map(s => (
                  <React.Fragment key={s.id}>
                    {fillHist && <Area type="monotone" dataKey={smoothHist ? s.id + '_sm' : s.id} name={s.name} stroke="none" fill={s.color} fillOpacity={0.3} isAnimationActive={false} />}
                    <Line type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={smoothHist ? Math.max(1, (cfgAna.lineThickness || 2) - 1) : (cfgAna.lineThickness || 2)} strokeOpacity={smoothHist ? 0.45 : 1} dot={false} isAnimationActive={false} />
                    {smoothHist && <Line type="monotone" dataKey={s.id + '_sm'} name={`${s.name} (smooth)`} stroke={s.color} strokeWidth={cfgAna.lineThickness || 2} dot={false} isAnimationActive={false} />}
                  </React.Fragment>
                ))}
                {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {splitStack && (
            <div className={`bg-white rounded border border-slate-200 flex flex-col overflow-hidden ${fs ? 'w-[46%] min-h-0' : 'w-full lg:w-[46%] max-h-[560px]'}`}>
              <div className="shrink-0 px-2.5 py-1.5 bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center justify-between gap-2">
                <span>📚 Split view — single curves</span>
                <span className="text-slate-400">{visibleInstances.length} {visibleInstances.length === 1 ? 'curve' : 'curves'}</span>
              </div>
              <div className="overflow-y-auto custom-scrollbar flex-1">
                {visibleInstances.map((s, i) => (
                  <div key={s.id} className="border-b border-slate-100 last:border-b-0">
                    <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold truncate flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="text-slate-700 truncate">{s.name}</span>
                    </div>
                    <ResponsiveContainer width="100%" height={86}>
                      <ComposedChart data={chartData.bins} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="x" type="number" domain={zoom.domain} allowDataOverflow hide={i < visibleInstances.length - 1} tick={{ fontSize: 8, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} width={34} />
                        {fillHist && <Area type="monotone" dataKey={smoothHist ? s.id + '_sm' : s.id} name={s.name} stroke="none" fill={s.color} fillOpacity={0.3} isAnimationActive={false} />}
                        <Line type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={smoothHist ? 1 : (cfgAna.lineThickness || 2)} strokeOpacity={smoothHist ? 0.5 : 1} dot={false} isAnimationActive={false} />
                        {smoothHist && <Line type="monotone" dataKey={s.id + '_sm'} name={`${s.name} (smooth)`} stroke={s.color} strokeWidth={cfgAna.lineThickness || 2} dot={false} isAnimationActive={false} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
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
    if (ctx) {
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

  useEffect(() => {
    setXDomain2D(null);
    setYDomain2D(null);
  }, [xParam2D, yParam2D, logX2D, logY2D]);

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
  }, [overlayParam1D, visibleInstances, log1D, gates]);

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
        const x = tX(s.fcs.events[i * s.fcs.numParams + pX]);
        const y = tY(s.fcs.events[i * s.fcs.numParams + pY]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    });
    if (minX === Infinity) return { x: [0, 1000], y: [0, 1000] };
    return { x: [minX, maxX], y: [minY, maxY] };
  }, [xParam2D, yParam2D, logX2D, logY2D, visibleInstances, gates]);

  // When the histogram parameter is the SAME as the 2D chart's X parameter (and
  // the log settings match), the histogram mirrors the 2D chart's X axis exactly.
  // NOTE: computed AFTER zoom1D is declared — referencing zoom1D before its
  // `const` initialization would throw a "Cannot access ... before initialization"
  // (temporal dead zone) error on FCS load.
  const chartRef1D = useRef(null);
  const zoom1D = useXZoom(chartRef1D, chartData1D.domain);
  useEffect(() => { zoom1D.reset(); }, [overlayParam1D, log1D]);

  const histXMirrors2D = overlayParam1D === xParam2D && log1D === logX2D;
  const histDomain = histXMirrors2D ? (xDomain2D || chartData1D.domain) : zoom1D.domain;

  if (!loadedInstances.length) return null;

  const label1D = getParamLabel({name: overlayParam1D}, panelArray, paramRenames);
  const labelX2D = getParamLabel({name: xParam2D}, panelArray, paramRenames);
  const labelY2D = getParamLabel({name: yParam2D}, panelArray, paramRenames);

  return (
    <div className="flex flex-col gap-4 mt-2 w-full">
      <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-2 border-b border-slate-200 pb-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2 shrink-0">Colors:</span>
          
          <div className="flex flex-wrap items-center gap-2">
            <select onChange={(e) => { if(e.target.value && e.target.value !== 'custom') applyPalette(e.target.value); e.target.value=''; }} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50 outline-none cursor-pointer">
              <option value="">🎨 Apply Palette...</option>
              {Object.keys(VIS_PALETTES).map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
            </select>
            <span className="text-slate-300 hidden md:inline">|</span>
            <input 
              type="text" 
              placeholder="#f00, #0f0..." 
              value={customPaletteInput} 
              onChange={e => setCustomPaletteInput(e.target.value)} 
              className="text-[10px] border border-slate-300 px-2 py-1 rounded w-32 outline-none focus:border-blue-500" 
            />
            <button onClick={() => applyPalette('custom')} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">Apply Custom</button>
            <span className="text-slate-300 hidden md:inline">|</span>
            <button onClick={() => setShowRenamer(!showRenamer)} className="text-[10px] font-bold bg-white border border-slate-300 px-2 py-1 rounded shadow-sm hover:bg-slate-50">✏️ Rename Parameters</button>
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
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 z-10 w-full mt-2">
        
        {/* 1D HISTOGRAM */}
        <>
          {fs1D && <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99990]" onClick={() => setFs1D(false)} />}
          <div className={fs1D ? "fixed inset-4 z-[99999] bg-white p-6 rounded-2xl shadow-2xl flex flex-col gap-3 overflow-hidden" : "flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm w-full"}>
            <div className="flex justify-between items-center z-10 shrink-0 border-b border-slate-100 pb-2">
              <h5 className="text-sm font-bold text-slate-700">1D Histogram</h5>
              <div className="flex items-center gap-2">
                <select value={overlayParam1D} onChange={e => setOverlayParam1D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[120px]">
                  {rawSharedParams.map(p => <option key={p.name} value={(p.name||'').toUpperCase()}>{getParamLabel(p, panelArray, paramRenames)}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer mr-2">
                  <input type="checkbox" checked={log1D} onChange={e => setLog1D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
                </label>
                <ChartControlBar showCfg={showCfg1D} onToggleCfg={() => setShowCfg1D(!showCfg1D)} />
                <button type="button" onClick={() => setFs1D(!fs1D)} className="font-bold py-1 px-2 rounded-lg text-[10px] border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs1D ? '↙️ Exit' : '↗️ Fullscreen'}</button>
              </div>
            </div>
            
            {showCfg1D && <SharedChartStylePanel cfg={cfg1D} setCfg={setVizCfg1D} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}
            
            <div ref={chartRef1D} onMouseDown={zoom1D.onMouseDown} className={`bg-slate-50 rounded border border-slate-200 p-2 select-none relative overflow-hidden cursor-crosshair w-full ${fs1D ? 'flex-1 min-h-0' : 'h-[300px]'}`}>
              {zoom1D.isZoomed && <button type="button" onClick={zoom1D.reset} className="absolute top-2 right-2 z-10 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData1D.bins} margin={{ top: 10, right: 20, left: 75, bottom: 45 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="x" type="number" domain={histDomain} allowDataOverflow tickFormatter={(v) => v.toFixed(log1D ? 1 : 0)} tick={{ fontSize: Math.max(9, cfg1D.fontSize - 2) }} label={{ value: `${label1D}${log1D ? ' (Log)' : ''}`, position: 'insideBottom', offset: -10, fontSize: cfg1D.fontSize }} />
                  <YAxis tick={{ fontSize: Math.max(9, cfg1D.fontSize - 2) }} label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: -5, fontSize: cfg1D.fontSize }} />
                  <Tooltip labelFormatter={(label) => `Value: ${Number(label).toFixed(log1D ? 2 : 0)}`} formatter={(value) => [value, 'Events']} />
                  {visibleInstances.map(s => <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={cfg1D.lineThickness || 2} dot={false} isAnimationActive={false} />)}
                  {zoom1D.refLo !== null && zoom1D.refHi !== null && <ReferenceArea x1={zoom1D.refLo} x2={zoom1D.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                </LineChart>
              </ResponsiveContainer>
            </div>
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
                  <button onClick={() => { setXDomain2D(null); setYDomain2D(null); }} className="text-[10px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded shadow-sm">Reset Zoom</button>
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
               onAddGate={(g) => setGates(prev => [...prev, g])} 
               interactionMode={interactionMode}
               xDomain={xDomain2D || (autoDomain2D && autoDomain2D.x) || undefined}
               yDomain={yDomain2D || (autoDomain2D && autoDomain2D.y) || undefined}
               onZoom={({ xDomain, yDomain }) => { setXDomain2D(xDomain); setYDomain2D(yDomain); }}
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
// GLOBAL CACHE (Ties loaded files to their specific condition tab)
// =========================================================================
export const globalFcsCache = {};

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

      // Handle SUBSEQUENT files by dynamically creating new tabs/instances
      if (results.length > 1 && ctx.setTests) {
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
                  Object.assign(cloned, meta); 
                  
                  newTests.push(cloned);
              }
              return [...prevTests, ...newTests];
          });
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
            : `⚠️ Successfully loaded ${results.length} file(s) — ${driveSaved} saved to Google Drive. Drive access expired or unavailable: reconnect Google Drive, then use “Archive FCS to Drive”.`)
        : `✅ Successfully loaded ${results.length} file(s). (Drive not connected — raw files not archived.)`);
      setUpdater(u => u + 1);
    } catch (err) {
      setFcsMsg(`⚠️ Error: ${err.message}`);
      console.error('FCS Parse Error:', err);
    }
    e.target.value = '';
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
            {fcsMsg && <span className="text-xs font-bold text-indigo-900">{fcsMsg}</span>}
            <DriveUploadButton
              suggestedName={suggestDriveFileName({
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || '',
                instance: activeTest.instanceName || '',
                section: 'Data',
                subsection: 'Flow Cytometry',
                suffix: 'fcs'
              })}
              naming={{
                project: (activeTest.projectNames || [])[0] || '',
                test: activeTest.name || '',
                instance: activeTest.instanceName || '',
                scientist: activeTest.operator || '',
                section: 'Data',
                subsection: 'Flow Cytometry',
                suffix: 'fcs'
              }}
              accept=".fcs"
              label="⬆ Archive FCS to Drive"
              className="bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100"
            />
          </div>
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
            <div className={`relative ${fsFreq ? 'flex-1 min-h-0' : 'h-[300px]'}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: Math.max(9, cfgFreq.fontSize - 2) }} angle={-15} textAnchor="end" />
                  <YAxis tick={{ fontSize: Math.max(9, cfgFreq.fontSize - 2) }} label={{ value: '% of Parent', angle: -90, position: 'insideLeft', fontSize: cfgFreq.fontSize }} />
                  <Tooltip formatter={(value) => `${value}%`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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