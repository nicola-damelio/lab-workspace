// components/FlowCytometrySections.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend, ReferenceArea
} from 'recharts';
import { ChartControlBar, SharedChartStylePanel } from './SharedAnalysisTools';

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';
const DEFAULT_CHART_STYLE = { height: 380, aspect: 1.8, fontSize: 12, tickStep: '', tickAngle: 0, ptStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2, legend: 'top', colors: {}, barRadius: 3, xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: '' };


const CollapsibleSection = ({ title, icon, defaultOpen = true, children, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)} className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}>
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// =========================================================================
// FCS BINARY PARSER (Supports Offset Safety & Endianness Detection)
// =========================================================================
const parseFCSFile = (buffer) => {
  const decoder = new TextDecoder();
  const readStr = (start, length) => {
    if (start + length > buffer.byteLength) return '';
    return decoder.decode(new Uint8Array(buffer, start, length)).trim();
  };

  // 1. Parse Header
  const version = readStr(0, 6);
  if (!version.startsWith('FCS')) throw new Error('Not a valid FCS file format.');

  let textStart = parseInt(readStr(10, 8), 10);
  let textEnd = parseInt(readStr(18, 8), 10);
  let dataStart = parseInt(readStr(26, 8), 10);
  let dataEnd = parseInt(readStr(34, 8), 10);

  // FCS 3.0 64-bit offset fallback
  if (!textStart || !textEnd) {
    textStart = parseInt(readStr(58, 8), 10);
    textEnd = parseInt(readStr(66, 8), 10);
    dataStart = parseInt(readStr(74, 8), 10);
    dataEnd = parseInt(readStr(82, 8), 10);
  }

  if (!textStart || !textEnd || textEnd < textStart || textEnd >= buffer.byteLength) {
    throw new Error('Could not locate TEXT segment in FCS header.');
  }

  // 2. Parse TEXT Segment (using the stable delimiter logic)
  const textStr = decoder.decode(new Uint8Array(buffer, textStart, textEnd - textStart + 1));
  const textDict = {};
  
  let delimiter = textStr[0];
  if (delimiter === ' ' || !delimiter) delimiter = '/';
  
  const parts = textStr.split(delimiter).map(p => p.trim()).filter(p => p);
  
  for (let i = 0; i < parts.length - 1; i += 2) {
    const key = parts[i].toUpperCase();
    const val = parts[i + 1];
    if (key) textDict[key] = val;
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

  // 3. Parse DATA Segment
  if (!dataStart || !dataEnd || dataEnd < dataStart || dataEnd >= buffer.byteLength) {
    throw new Error('Could not locate DATA segment in FCS header.');
  }

  const dataLength = dataEnd - dataStart + 1;
  let events = null;

  // Use DataView directly on the buffer at the EXACT dataStart offset (fixes the offset bug)
  const dataView = new DataView(buffer, dataStart, dataLength);

  // Check file Endianness to prevent float scrambling (fixes the barcode dispersion bug)
  const byteOrd = textDict['$BYTEORD'] || '1,2,3,4';
  const isLittleEndian = byteOrd.trim() === '1,2,3,4';
  
  const numTotalValues = numParams * numEvents;

  try {
    if (dataType === 'F') {
      events = new Float32Array(numTotalValues);
      for (let i = 0; i < numTotalValues; i++) {
        events[i] = dataView.getFloat32(i * 4, isLittleEndian);
      }
    } else if (dataType === 'I') {
      const bits = params[0]?.bits || 16;
      if (bits <= 16) {
        events = new Uint16Array(numTotalValues);
        for (let i = 0; i < numTotalValues; i++) {
          events[i] = dataView.getUint16(i * 2, isLittleEndian);
        }
      } else {
        events = new Uint32Array(numTotalValues);
        for (let i = 0; i < numTotalValues; i++) {
          events[i] = dataView.getUint32(i * 4, isLittleEndian);
        }
      }
    } else if (dataType === 'D') {
      events = new Float64Array(numTotalValues);
      for (let i = 0; i < numTotalValues; i++) {
        events[i] = dataView.getFloat64(i * 8, isLittleEndian);
      }
    } else {
      throw new Error(`Unsupported FCS data type: ${dataType}`);
    }
  } catch (e) {
    throw new Error(`Failed to parse DATA segment: ${e.message}`);
  }

  return { version, numParams, numEvents, params, events, textDict };
};

// =========================================================================
// METADATA MAPPER (Auto-fills Experimental & Instrumental fields)
// =========================================================================
const mapFCSMetadata = (textDict) => {
  const updates = {};
  
  // 1. Experimental Conditions
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
  
  if (textDict['$TOT']) {
    updates.cellNumber = parseInt(textDict['$TOT'], 10).toLocaleString();
  }
  
  if (textDict['$CYT'] || textDict['CYTNUM']) {
    updates.fcMachine = `${textDict['$CYT'] || ''} ${textDict['CYTNUM'] || ''}`.trim();
  }
  
  if (textDict['CREATOR']) {
    updates.acquisitionSoftware = textDict['CREATOR'];
  }

  // 2. Instrumental Setup
  if (textDict['$CYT']) updates.cytometerModel = textDict['$CYT'];
  if (textDict['CYTNUM']) updates.cytometerSerial = textDict['CYTNUM'];
  
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

// Helper to format axis ticks cleanly (removes excessive decimals, adds 'k' for thousands)
const formatTickVal = (val) => {
  if (isNaN(val) || !isFinite(val)) return '';
  if (val === 0) return '0';
  const absVal = Math.abs(val);
  if (absVal >= 10000) return (val / 1000).toFixed(1) + 'k';
  if (absVal >= 100) return Math.round(val).toString();
  if (absVal >= 1) return Number(val.toFixed(1)).toString();
  return Number(val.toFixed(2)).toString();
};

// =========================================================================
// HIGH-PERFORMANCE 2D CANVAS SCATTER PLOT (Multi-File Overlay)
// =========================================================================
// =========================================================================
// CUSTOM DOM-BASED X-ZOOM HOOK (Highly reliable for continuous axes)
// =========================================================================
// =========================================================================
// CUSTOM DOM-BASED X-ZOOM & POLYGON MATH
// =========================================================================
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
    return () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
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

// Ray-casting algorithm to check if a point is inside a polygon
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
// HIGH-PERFORMANCE 2D CANVAS SCATTER PLOT (Multi-File Overlay + Polygon Gating)
// =========================================================================
const Canvas2DPlotOverlay = ({ series, xParam, yParam, logX, logY, cfg, fs, gates, onAddGate }) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const mappingRef = useRef(null);
  const [drawPath, setDrawPath] = useState(null); // Tracks the freehand drawn polygon

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

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      // Only calculate bounds based on events that pass ALL gates
      validSeries.forEach(s => {
        for (let i = 0; i < s.fcs.numEvents; i++) {
          let pass = true;
          for (let g of gates) {
            const gXIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.xParam || (p.label||'').toUpperCase() === g.xParam);
            const gYIdx = s.fcs.params.findIndex(p => (p.name||'').toUpperCase() === g.yParam || (p.label||'').toUpperCase() === g.yParam);
            if (gXIdx >= 0 && gYIdx >= 0) {
              const xR = s.fcs.events[i * s.fcs.numParams + gXIdx];
              const yR = s.fcs.events[i * s.fcs.numParams + gYIdx];
              const gx = g.logX ? Math.log10(Math.max(0, xR) + 1) : xR;
              const gy = g.logY ? Math.log10(Math.max(0, yR) + 1) : yR;
              if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
            }
          }
          if (!pass) continue;

          const x = transformValue(s.fcs.events[i * s.fcs.numParams + s.pX], logX);
          const y = transformValue(s.fcs.events[i * s.fcs.numParams + s.pY], logY);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      });

      if (minX === Infinity) { minX = 0; maxX = 1000; minY = 0; maxY = 1000; }

      const pad = { top: 20, right: 20, bottom: 45, left: 60 };
      const plotW = W - pad.left - pad.right;
      const plotH = H - pad.top - pad.bottom;
      if (plotW <= 0 || plotH <= 0) return;

      // Save mapping metrics for mouse event coordinate conversion
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
              const xR = s.fcs.events[i * s.fcs.numParams + gXIdx];
              const yR = s.fcs.events[i * s.fcs.numParams + gYIdx];
              const gx = g.logX ? Math.log10(Math.max(0, xR) + 1) : xR;
              const gy = g.logY ? Math.log10(Math.max(0, yR) + 1) : yR;
              if (!isPointInPoly(gx, gy, g.vertices)) { pass = false; break; }
            }
          }
          if (!pass) continue;

          const x = transformValue(s.fcs.events[i * s.fcs.numParams + s.pX], logX);
          const y = transformValue(s.fcs.events[i * s.fcs.numParams + s.pY], logY);
          const px = pad.left + ((x - minX) / (maxX - minX || 1)) * plotW;
          const py = pad.top + plotH - ((y - minY) / (maxY - minY || 1)) * plotH;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      });

      // Draw all established gates that apply to the current axis
      const toPxX = (dx) => pad.left + ((dx - minX) / (maxX - minX || 1)) * plotW;
      const toPxY = (dy) => pad.top + plotH - ((dy - minY) / (maxY - minY || 1)) * plotH;

      gates.forEach((g, idx) => {
        if (g.xParam === xParam && g.yParam === yParam) {
          ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
          ctx.beginPath();
          g.vertices.forEach((v, i) => {
            const px = toPxX(v.x);
            const py = toPxY(v.y);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          
          // Draw Gate Name
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`Gate ${idx + 1}`, toPxX(g.vertices[0].x), toPxY(g.vertices[0].y) - 5);
        }
      });

      // Draw the active freehand line being drawn
      if (drawPath && drawPath.length > 0) {
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(drawPath[0].x, drawPath[0].y);
        for (let i = 1; i < drawPath.length; i++) {
          ctx.lineTo(drawPath[i].x, drawPath[i].y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }

      ctx.fillStyle = '#334155'; ctx.font = `bold ${cfg.fontSize || 12}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(`${xParam}${logX ? ' (Log)' : ''}`, pad.left + plotW / 2, H - 10);
      
      ctx.save(); ctx.translate(15, pad.top + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${yParam}${logY ? ' (Log)' : ''}`, 0, 0); ctx.restore();
      
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
  }, [series, xParam, yParam, logX, logY, cfg, fs, drawPath, gates]);

  const handleMouseDown = (e) => {
    if (!mappingRef.current || !onAddGate) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const m = mappingRef.current;
    if (x >= m.pad.left && x <= m.pad.left + m.plotW && y >= m.pad.top && y <= m.pad.top + m.plotH) {
      setDrawPath([{x, y}]);
    }
  };

  const handleMouseMove = (e) => {
    if (!drawPath) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setDrawPath(prev => [...prev, {x: e.clientX - rect.left, y: e.clientY - rect.top}]);
  };

  const handleMouseUp = () => {
    if (!drawPath || !mappingRef.current) return;
    if (drawPath.length > 5) {
      const m = mappingRef.current;
      const toDataX = (px) => m.minX + ((px - m.pad.left) / m.plotW) * (m.maxX - m.minX);
      const toDataY = (py) => m.minY + ((m.pad.top + m.plotH - py) / m.plotH) * (m.maxY - m.minY);
      
      const polyData = drawPath.map(p => ({ x: toDataX(p.x), y: toDataY(p.y) }));
      
      // Calculate bounding box area to ensure it's not an accidental click
      const xs = polyData.map(p => p.x); const ys = polyData.map(p => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      
      if (w > (m.maxX - m.minX) * 0.01 && h > (m.maxY - m.minY) * 0.01) {
        onAddGate({
          id: `gate_${Date.now()}`,
          xParam: m.xParam, yParam: m.yParam,
          logX: m.logX, logY: m.logY,
          vertices: polyData
        });
      }
    }
    setDrawPath(null);
  };

  return (
    <div 
      ref={wrapRef} 
      onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
      style={{ width: '100%', aspectRatio: fs ? undefined : String(cfg.aspect || 1.8), height: fs ? 500 : (cfg.height || 380) }} 
      className="relative rounded-lg border border-slate-200 bg-white overflow-hidden min-h-[300px] cursor-crosshair"
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {drawPath && (
        <div style={{
          position: 'absolute',
          left: Math.min(...drawPath.map(p=>p.x)),
          top: Math.min(...drawPath.map(p=>p.y)),
          width: Math.max(...drawPath.map(p=>p.x)) - Math.min(...drawPath.map(p=>p.x)),
          height: Math.max(...drawPath.map(p=>p.y)) - Math.min(...drawPath.map(p=>p.y)),
          border: '2px dashed rgba(239, 68, 68, 0.4)',
          backgroundColor: 'transparent',
          pointerEvents: 'none'
        }} />
      )}
    </div>
  );
};

// =========================================================================
// UNIFIED DATA SECTION OVERLAYS (1D + 2D with Nested Gating)
// =========================================================================
const FCSDataVisualizations = ({ ctx, updater }) => {
  const { activeTest, updateActiveTest } = ctx;
  const vizCfg = activeTest.vizCfg || {};
  const setVizCfg = (patch) => updateActiveTest({ vizCfg: { ...vizCfg, ...patch } });
  const cfg = { ...DEFAULT_CHART_STYLE, ...vizCfg };

  const [showCfg, setShowCfg] = useState(false);
  const [fs, setFs] = useState(false);
  const [localColors, setLocalColors] = useState(vizCfg.colors || {});
  const [hiddenSeries, setHiddenSeries] = useState({});
  const [gates, setGates] = useState([]); // Array of nested gates

  const updateColor = (id, color) => {
    const next = { ...localColors, [id]: color };
    setLocalColors(next);
    setVizCfg({ colors: next });
  };

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
  }, [ctx, activeTest, updater]);

  const loadedInstances = instances.filter(inst => globalFcsCache[inst.id]);
  const visibleInstances = loadedInstances.filter(inst => !hiddenSeries[inst.id]).map((inst, idx) => {
    const fcs = globalFcsCache[inst.id];
    return {
      ...inst, 
      fcs, 
      name: fcs.filename || inst.name, 
      color: localColors[inst.id] || COLORS[idx % COLORS.length]
    };
  });

  const sharedParams = useMemo(() => {
    if (!loadedInstances.length) return [];
    const union = new Set();
    loadedInstances.forEach(inst => {
      globalFcsCache[inst.id].params.forEach(p => union.add((p.name || p.label || '').toUpperCase()));
    });
    return Array.from(union).filter(Boolean).sort();
  }, [loadedInstances]);

  const [overlayParam1D, setOverlayParam1D] = useState('');
  const [xParam2D, setXParam2D] = useState('');
  const [yParam2D, setYParam2D] = useState('');
  
  const [log1D, setLog1D] = useState(false);
  const [logX2D, setLogX2D] = useState(false);
  const [logY2D, setLogY2D] = useState(false);

  useEffect(() => {
    if (sharedParams.length > 0) {
      if (!sharedParams.includes(overlayParam1D)) setOverlayParam1D(sharedParams[0]);
      if (!sharedParams.includes(xParam2D)) setXParam2D(sharedParams.find(p => p.includes('FSC')) || sharedParams[0]);
      if (!sharedParams.includes(yParam2D)) setYParam2D(sharedParams.find(p => p.includes('SSC')) || sharedParams[1] || sharedParams[0]);
    }
  }, [sharedParams, overlayParam1D, xParam2D, yParam2D]);

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

  const chartRef1D = useRef(null);
  const zoom1D = useXZoom(chartRef1D, chartData1D.domain);
  useEffect(() => { zoom1D.reset(); }, [overlayParam1D, log1D]); 

  if (!loadedInstances.length) return null;

  return (
    <div className={`flex flex-col gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm ${fs ? FS_CLASSES + ' overflow-y-auto z-[999999]' : ''}`}>
      {fs && <div className={OVERLAY_CLASSES} onClick={() => setFs(false)} />}
      
      <div className="flex justify-between items-center z-10 sticky top-0 bg-slate-50 py-2 border-b border-slate-200 mb-2">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-slate-700">📈 Overlaid Flow Cytometry Visualizations</h4>
          {gates.length > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-1 rounded-lg text-xs font-bold w-fit ml-4 shadow-sm">
              <span>🎯 {gates.length} Active Gate{gates.length > 1 ? 's' : ''}</span>
              <button onClick={() => setGates([])} className="ml-2 bg-white text-red-600 px-2 py-0.5 rounded border border-red-200 hover:bg-red-100">Clear</button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <ChartControlBar showCfg={showCfg} onToggleCfg={() => setShowCfg(!showCfg)} />
          <button type="button" onClick={() => setFs(!fs)} className="font-bold py-1.5 px-3 rounded-lg text-xs border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 shadow-sm">{fs ? '↙️ Exit Fullscreen' : '↗️ Fullscreen'}</button>
        </div>
      </div>

      <div className="flex flex-col gap-3 z-10 flex-shrink-0">
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase self-center mr-2">Files:</span>
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
        
        {gates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-red-50 border border-red-200 p-2 rounded-lg">
            <span className="text-[10px] font-bold text-red-600 uppercase">Active Gates:</span>
            {gates.map((g, idx) => (
              <div key={g.id} className="flex items-center gap-1.5 bg-white border border-red-200 text-red-700 px-2 py-1 rounded shadow-sm text-xs font-bold">
                <span>🎯 Gate {idx + 1}: {g.xParam} vs {g.yParam}</span>
                <button onClick={() => setGates(gates.filter(x => x.id !== g.id))} className="text-red-400 hover:text-red-600 font-black ml-1">×</button>
              </div>
            ))}
            <button onClick={() => setGates([])} className="text-[10px] text-slate-500 hover:text-red-600 ml-auto font-bold underline">Clear All</button>
          </div>
        )}
      </div>

      {showCfg && <SharedChartStylePanel cfg={cfg} setCfg={setVizCfg} series={visibleInstances.map(s => ({ key: s.id, label: s.name, color: s.color }))} unit="a.u." />}

      {/* Grid Layout restored! */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 z-10 mt-2">
        
        {/* 1D HISTOGRAM */}
        <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center shrink-0">
            <h5 className="text-xs font-bold text-slate-700">1D Histogram</h5>
            <div className="flex items-center gap-3">
              <select value={overlayParam1D} onChange={e => setOverlayParam1D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700">
                {sharedParams.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={log1D} onChange={e => setLog1D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
              </label>
            </div>
          </div>
          
          <div ref={chartRef1D} onMouseDown={zoom1D.onMouseDown} style={{ width: '100%', aspectRatio: fs ? undefined : String(cfg.aspect || 1.8), height: fs ? 500 : (cfg.height || 300) }} className="bg-slate-50 rounded border border-slate-200 p-2 select-none relative overflow-hidden cursor-crosshair min-h-[300px]">
            {zoom1D.isZoomed && <button type="button" onClick={zoom1D.reset} className="absolute top-2 right-2 z-10 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData1D.bins} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="x" type="number" domain={zoom1D.domain} allowDataOverflow tickFormatter={(v) => v.toFixed(log1D ? 1 : 0)} tick={{ fontSize: Math.max(9, cfg.fontSize - 2) }} label={{ value: `${overlayParam1D}${log1D ? ' (Log)' : ''}`, position: 'insideBottom', offset: -10, fontSize: cfg.fontSize }} />
                <YAxis tick={{ fontSize: Math.max(9, cfg.fontSize - 2) }} label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: -5, fontSize: cfg.fontSize }} />
                <Tooltip labelFormatter={(label) => `Value: ${Number(label).toFixed(log1D ? 2 : 0)}`} formatter={(value) => [value, 'Events']} />
                {visibleInstances.map(s => <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={cfg.lineThickness || 2} dot={false} isAnimationActive={false} />)}
                {zoom1D.refLo !== null && zoom1D.refHi !== null && <ReferenceArea x1={zoom1D.refLo} x2={zoom1D.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2D SCATTER */}
        <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-center shrink-0">
            <h5 className="text-xs font-bold text-slate-700">2D Scatter (Drag to Gate)</h5>
            <div className="flex items-center gap-3">
              <select value={xParam2D} onChange={e => setXParam2D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[90px]">
                {sharedParams.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={logX2D} onChange={e => setLogX2D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
              </label>
              <span className="text-slate-300">|</span>
              <select value={yParam2D} onChange={e => setYParam2D(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-bold text-blue-700 max-w-[90px]">
                {sharedParams.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={logY2D} onChange={e => setLogY2D(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" /> Log
              </label>
            </div>
          </div>
          <Canvas2DPlotOverlay series={visibleInstances} xParam={xParam2D} yParam={yParam2D} logX={logX2D} logY={logY2D} cfg={cfg} fs={fs} gates={gates} onAddGate={(g) => setGates(prev => [...prev, g])} />
        </div>

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

  // --- FCS GLOBAL CACHE STATE ---
  const [updater, setUpdater] = useState(0);
  const [fcsMsg, setFcsMsg] = useState('');

  const handleFCSUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFcsMsg('Parsing FCS file...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseFCSFile(ev.target.result);
        if (!parsed || typeof parsed.numEvents !== 'number') {
          throw new Error('Parser returned invalid data structure.');
        }
        
        parsed.filename = file.name; // Use file.name for graph labels!
        
        // Save to global session cache keyed by condition ID
        globalFcsCache[activeTest.id] = parsed;
        
        // Auto-fill experimental conditions and instrumental setup
        const metadataUpdates = mapFCSMetadata(parsed.textDict);
        updateActiveTest(metadataUpdates);
        
        setFcsMsg(`✅ Loaded ${parsed.numEvents.toLocaleString()} events. Fields auto-filled!`);
        // Force UI update
        setUpdater(u => u + 1);
      } catch (err) {
        setFcsMsg(`⚠️ Error: ${err.message}`);
        console.error('FCS Parse Error:', err);
      }
    };
    reader.onerror = () => setFcsMsg('⚠️ Error reading file from disk.');
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // --- CSV IMPORT STATE ---
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
    <CollapsibleSection title="Flow Cytometry Data" icon="🩸" defaultOpen={true}>
      <div className="flex flex-col gap-6">
        {/* Staining Panel */}
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
                {panel.length === 0 ? (<tr><td colSpan="6" className="px-3 py-4 text-center text-slate-400 italic">No channels defined.</td></tr>) : panel.map((ch) => (
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

        {/* FCS RAW DATA IMPORTER */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-indigo-900">🧬 Import Raw FCS File (.fcs)</h4>
            <span className="text-[9px] bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded font-bold">Parses binary event data & auto-fills fields</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors">
              📄 Choose .fcs file…
              <input type="file" accept=".fcs" onChange={handleFCSUpload} className="hidden" />
            </label>
            {fcsMsg && <span className="text-xs font-bold text-indigo-900">{fcsMsg}</span>}
          </div>
        </div>

        {/* NEW UNIFIED DATA VISUALIZATIONS */}
        <FCSDataVisualizations ctx={ctx} updater={updater} />

        {/* CSV TEXT IMPORTER */}
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

        {/* Populations & Gating Table */}
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


// =========================================================================
// FCS MULTI-FILE OVERLAY VISUALIZATION
// =========================================================================
const FCSOverlayVisualization = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const vizCfg = activeTest.vizCfg || {};
  const setVizCfg = (patch) => updateActiveTest({ vizCfg: { ...vizCfg, ...patch } });

  // Gather all available condition instances
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

  // Only show instances that have uploaded FCS data in the current session
  const loadedInstances = instances.filter(inst => globalFcsCache[inst.id]);

  // Find common parameters across loaded files
  const sharedParams = useMemo(() => {
    if (!loadedInstances.length) return [];
    const union = new Set();
    loadedInstances.forEach(inst => {
      globalFcsCache[inst.id].params.forEach(p => union.add(p.name.toUpperCase()));
    });
    return Array.from(union).sort();
  }, [loadedInstances]);

  const [overlayParam, setOverlayParam] = useState('');
  useEffect(() => {
    if (sharedParams.length > 0 && !sharedParams.includes(overlayParam)) setOverlayParam(sharedParams[0]);
  }, [sharedParams, overlayParam]);

  const [hiddenSeries, setHiddenSeries] = useState({});
  const visibleInstances = loadedInstances.filter(inst => !hiddenSeries[inst.id]);

  // Generate binned histogram data
  const chartData = useMemo(() => {
    if (!overlayParam || !visibleInstances.length) return [];
    let globalMin = Infinity; let globalMax = -Infinity;

    const rawSeries = visibleInstances.map(inst => {
      const fcs = globalFcsCache[inst.id];
      const paramIdx = fcs.params.findIndex(p => (p.name || '').toUpperCase() === overlayParam);
      if (paramIdx < 0) return { id: inst.id, data: null };

      const channelData = new Float32Array(fcs.numEvents);
      for (let i = 0; i < fcs.numEvents; i++) {
        const val = fcs.events[i * fcs.numParams + paramIdx];
        channelData[i] = val;
        if (val < globalMin) globalMin = val;
        if (val > globalMax) globalMax = val;
      }
      return { id: inst.id, data: channelData };
    });

    if (globalMin === Infinity || globalMax === -Infinity) return [];

    const BINS = 200;
    const binWidth = (globalMax - globalMin) / BINS || 1;
    const bins = Array.from({ length: BINS }, (_, i) => ({
      x: globalMin + (i + 0.5) * binWidth
    }));

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

    return bins;
  }, [overlayParam, visibleInstances]);

  const [refAreaLeft, setRefAreaLeft] = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const [xDomain, setXDomain] = useState(null);

  const zoom = () => {
    if (refAreaLeft === refAreaRight || refAreaLeft === '' || refAreaRight === '') {
      setRefAreaLeft(''); setRefAreaRight(''); return;
    }
    let [left, right] = [refAreaLeft, refAreaRight];
    if (left > right) [left, right] = [right, left];
    setXDomain([left, right]);
    setRefAreaLeft(''); setRefAreaRight('');
  };

  if (!loadedInstances.length) return null;

  const colors = vizCfg.colors || {};

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-sm font-bold text-slate-700">📈 Overlay 1D Histograms (Cross-Condition)</h4>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter:</label>
          <select value={overlayParam} onChange={e => { setOverlayParam(e.target.value); setXDomain(null); }} className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500 font-bold text-indigo-700">
            {sharedParams.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {xDomain && <button onClick={() => setXDomain(null)} className="text-[10px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {loadedInstances.map((inst, idx) => {
          const c = colors[inst.id] || COLORS[idx % COLORS.length];
          return (
            <label key={inst.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold border cursor-pointer ${hiddenSeries[inst.id] ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-200 text-slate-700'}`}>
              <input type="checkbox" checked={!hiddenSeries[inst.id]} onChange={() => setHiddenSeries(p => ({ ...p, [inst.id]: !p[inst.id] }))} className="hidden" />
              <input type="color" value={c} onChange={(e) => setVizCfg({ colors: { ...colors, [inst.id]: e.target.value } })} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded cursor-pointer border border-slate-300 p-0" />
              <span className="truncate max-w-[200px]">{inst.name}</span>
            </label>
          );
        })}
      </div>

      <div className="w-full h-80 bg-slate-50 rounded border border-slate-200 p-2 select-none relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
            onMouseDown={(e) => e && setRefAreaLeft(e.activeLabel)}
            onMouseMove={(e) => e && refAreaLeft && setRefAreaRight(e.activeLabel)}
            onMouseUp={zoom}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x" type="number" domain={xDomain || ['dataMin', 'dataMax']} allowDataOverflow tickFormatter={(v) => formatTickVal(v)} tick={{ fontSize: 10 }} label={{ value: overlayParam, position: 'insideBottom', offset: -10, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip labelFormatter={(label) => `Value: ${formatTickVal(label)}`} formatter={(value) => [value, 'Events']} />
            {visibleInstances.map((inst, idx) => (
              <Line key={inst.id} type="monotone" dataKey={inst.id} name={inst.name} stroke={colors[inst.id] || COLORS[idx % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
            {refAreaLeft && refAreaRight && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-500 mt-1">💡 Drag horizontally across the graph to zoom into a region. Click color pickers to customize each trace.</p>
    </div>
  );
};

export const DataAnalysis = ({ ctx }) => {
  const { activeTest } = ctx;
  const populations = Array.isArray(activeTest.fcPopulations) ? activeTest.fcPopulations : [];
  
  const chartData = populations.filter(p => p.percentParent !== '' && p.percentParent !== undefined).map(p => ({
    name: p.name, value: parseFloat(p.percentParent) || 0, fill: p.color || '#3b82f6'
  }));

  return (
    <CollapsibleSection title="Data Analysis & Visualization" icon="📊" defaultOpen={true}>
      <div className="flex flex-col gap-6">
        
        {/* Dynamic Multi-File Overlay added here! */}
        <FCSOverlayVisualization ctx={ctx} />

        {chartData.length > 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h4 className="text-sm font-bold text-slate-700 mb-4">Population Frequencies (% of Parent)</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-15} textAnchor="end" />
                <YAxis label={{ value: '% of Parent', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Flow Cytometry Conditions:</b> Date: ${t.experimentDate || 'N/A'} | Cells: ${t.cellNumber || 'N/A'} | Machine: ${t.fcMachine || 'N/A'} | Software: ${t.acquisitionSoftware || 'N/A'}</p>`;
  }
  if (checkId === 'instrument') {
    const instr = [];
    if (t.cytometerModel) instr.push(`Model: ${t.cytometerModel}`);
    if (t.cytometerSerial) instr.push(`Serial: ${t.cytometerSerial}`);
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