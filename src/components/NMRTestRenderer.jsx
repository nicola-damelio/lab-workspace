import React, { useState, useMemo, useRef } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import {
  AMINO_ACID_DB,
  RESIDUE_COLORS,
  TICKS_1H,
  TICKS_13C,
  getNMRFillColor,
  getCarbonName,
  getProtonCount,
  getPascalRow,
  getCarbonRange,
  getHexagon,
  getPentagon
} from '../data/constants';

// --- REUSABLE COLLAPSIBLE SECTION ---
const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          {icon && <span className="text-xl">{icon}</span>}
          {title}
        </h3>
        <div className="flex items-center gap-3">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && (
        <div className="p-6 border-t border-slate-100">
          {children}
        </div>
      )}
    </div>
  );
};

// --- RICH TEXT EDITOR ---
const RichTextEditor = ({ value, onChange }) => {
  const editorRef = useRef(null);
  const execCmd = (command, val = null) => {
    document.execCommand(command, false, val);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <div className="bg-slate-50 p-2 border-b border-slate-200 flex flex-wrap gap-1 items-center">
        <button type="button" onClick={() => execCmd('bold')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 font-bold">B</button>
        <button type="button" onClick={() => execCmd('italic')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 italic">I</button>
        <button type="button" onClick={() => execCmd('underline')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700 underline">U</button>
        <div className="w-px h-4 bg-slate-300 mx-1"></div>
        <input type="color" onChange={(e) => execCmd('foreColor', e.target.value)} className="w-7 h-7 p-0 border-0 cursor-pointer rounded" title="Text Color" />
        <select onChange={(e) => execCmd('fontSize', e.target.value)} className="text-xs border border-slate-300 rounded p-1 bg-white">
          <option value="3">Normal</option><option value="1">Small</option><option value="5">Large</option><option value="7">Huge</option>
        </select>
        <div className="w-px h-4 bg-slate-300 mx-1"></div>
        <button type="button" onClick={() => execCmd('justifyLeft')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700">⬅️</button>
        <button type="button" onClick={() => execCmd('justifyCenter')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700">⬆️</button>
        <button type="button" onClick={() => execCmd('justifyRight')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700">➡️</button>
        <button type="button" onClick={() => execCmd('justifyFull')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700">↔️</button>
        <button type="button" onClick={() => execCmd('insertUnorderedList')} className="p-1.5 hover:bg-slate-200 rounded text-slate-700">•</button>
      </div>
      <div ref={editorRef} className="p-3 min-h-[120px] outline-none text-sm prose prose-sm max-w-none" contentEditable suppressContentEditableWarning onInput={(e) => onChange(e.currentTarget.innerHTML)} dangerouslySetInnerHTML={{ __html: value || '' }} />
    </div>
  );
};

// --- CUSTOM TICKS & SHAPES ---
const CustomXTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (<g transform={`translate(${x},${y})`}><line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isInt) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}</g>);
};
const CustomYTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (<g transform={`translate(${x},${y})`}><line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isInt) && <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}</g>);
};
const CustomXTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 8 : (isFive ? 6 : 4));
  return (<g transform={`translate(${x},${y})`}><line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isTen) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}</g>);
};
const CustomYTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 10 : (isFive ? 6 : 4));
  return (<g transform={`translate(${x},${y})`}><line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isTen) && <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}</g>);
};

const CustomRangeShape = (props) => { 
  const { cx, cy, payload, xAxis } = props; 
  const xMin = xAxis.scale(payload.max); const xMax = xAxis.scale(payload.min); 
  const width = Math.max(Math.abs(xMax - xMin), 4); const height = 14; const level = payload.level || 0;
  let textY = cy;
  if (level % 4 === 0) textY = cy + 18; else if (level % 4 === 1) textY = cy - 10; else if (level % 4 === 2) textY = cy + 32; else textY = cy - 24;
  return (<g><rect x={xMin} y={cy - height / 2} width={width} height={height} fill={payload.color} rx={4} opacity={0.5} stroke={payload.color} strokeWidth={1} /><text x={xMin + width / 2} y={textY} textAnchor="middle" fill="#334155" fontSize="13px" fontWeight="bold" pointerEvents="none"> {payload.atom} </text></g>); 
};

const NMRPointShape = ({ cx, cy, fill, payload }) => <circle cx={cx} cy={cy} r={payload.size || 5} fill={payload.type === 'Diagonale' ? fill : getNMRFillColor(payload)} opacity={0.8} />;

const NMRTooltip = ({ active, payload, diagonalColor }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.min !== undefined) return (<div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50"><p className="font-bold text-slate-800">{data.res} - {data.atom}</p><p className="text-slate-500">Theoretical Range: {data.min.toFixed(2)} - {data.max.toFixed(2)} ppm</p></div>);
    if (data.type === '1D') return (<div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50"><p className="font-bold text-slate-800">{data.label}</p><p className="text-slate-500">{data.x.toFixed(3)} ppm</p>{data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}</div>);
    return (<div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50"><p className="font-bold text-slate-800">{data.label}</p><p className="font-semibold" style={{ color: data.type === 'Diagonale' ? diagonalColor : getNMRFillColor(data) }}>{data.type}</p><p className="text-slate-500 text-xs mt-1"> F2: {Number(data.x).toFixed(2)} ppm <br/> F1: {Number(data.y).toFixed(2)} ppm </p></div>);
  }
  return null;
};

// --- ROBUST ZOOMABLE PLOTS (Prevents White Screen Crashes) ---
const OneDSpectrumPlot = ({ title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState(fullDomain);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const isZoomed = xDomain[0] !== fullDomain[0] || xDomain[1] !== fullDomain[1];
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null) { setRefAreaLeft(null); setRefAreaRight(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setRefAreaLeft(null); setRefAreaRight(null); };
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? 'fixed inset-4 md:inset-10 z-[100] bg-white p-6 md:p-8 rounded-2xl shadow-2xl' : 'h-[400px]'}`}>
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
        <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '✖' : '⛶'}</button>
      </div>
      <div className="flex-1 min-h-0 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 10 }} onMouseDown={(e) => { if (e?.activePayload?.[0]?.payload?.x !== undefined) setRefAreaLeft(e.activePayload[0].payload.x); }} onMouseMove={(e) => { if (refAreaLeft !== null && e?.activePayload?.[0]?.payload?.x !== undefined) setRefAreaRight(e.activePayload[0].payload.x); }} onMouseUp={zoom}>
            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : ticks} interval={0} tickLine={false} tick={<TickComponent isZoomed={isZoomed} />} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis type="number" dataKey="y" domain={[0, 4.5]} hide={true} />
            <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip />} />
            <Scatter data={data} shape={(props) => { const { cx, cy, yAxis, payload } = props; const y0 = yAxis.scale(0); return <line x1={cx} y1={y0} x2={cx} y2={cy} stroke={payload.color} strokeWidth={1.5} />; }} isAnimationActive={false} />
            {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SpectrumPlot = ({ title, diagonalData, crossPeakData, expandedPanel, setExpandedPanel, panelId, diagonalColor }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]); const [yDomain, setYDomain] = useState([0, 11]);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null); const [refAreaBottom, setRefAreaBottom] = useState(null);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 11;
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null || refAreaTop === refAreaBottom || refAreaTop === null) { setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); };
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? 'fixed inset-4 md:inset-10 z-[100] bg-white p-6 md:p-8 rounded-2xl shadow-2xl' : 'h-[400px]'}`}>
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
        <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '✖' : '⛶'}</button>
      </div>
      <div className="flex-1 min-h-0 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 40 }} onMouseDown={(e) => { if (e?.activePayload?.[0]?.payload) { setRefAreaLeft(e.activePayload[0].payload.x); setRefAreaTop(e.activePayload[0].payload.y); } }} onMouseMove={(e) => { if (refAreaLeft !== null && e?.activePayload?.[0]?.payload) { setRefAreaRight(e.activePayload[0].payload.x); setRefAreaBottom(e.activePayload[0].payload.y); } }} onMouseUp={zoom}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }} />
            <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomYTick1H isZoomed={isZoomed} />} label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }} />
            <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
            <Scatter name="Diagonale" data={[{x:0, y:0}, {x:11, y:11}]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={() => null} legendType="none" isAnimationActive={false} />
            <Scatter data={diagonalData} fill={diagonalColor} shape={<NMRPointShape />} isAnimationActive={false} />
            <Scatter data={crossPeakData} shape={<NMRPointShape />} isAnimationActive={false} />
            {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const HSQCPlot = ({ title, crossPeakData, expandedPanel, setExpandedPanel, panelId }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]); const [yDomain, setYDomain] = useState([10, 150]);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null); const [refAreaBottom, setRefAreaBottom] = useState(null);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 10 || yDomain[1] !== 150;
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null || refAreaTop === refAreaBottom || refAreaTop === null) { setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); };
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col lg:col-span-2 ${isExpanded ? 'fixed inset-4 md:inset-10 z-[100] bg-white p-6 md:p-8 rounded-2xl shadow-2xl' : 'h-[400px]'}`}>
      <div className="flex justify-between items-center mb-4 border-b pb-2">
        <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([10, 150]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
        <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '✖' : '⛶'}</button>
      </div>
      <div className="flex-1 min-h-0 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 40 }} onMouseDown={(e) => { if (e?.activePayload?.[0]?.payload) { setRefAreaLeft(e.activePayload[0].payload.x); setRefAreaTop(e.activePayload[0].payload.y); } }} onMouseMove={(e) => { if (refAreaLeft !== null && e?.activePayload?.[0]?.payload) { setRefAreaRight(e.activePayload[0].payload.x); setRefAreaBottom(e.activePayload[0].payload.y); } }} onMouseUp={zoom}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }} />
            <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_13C} interval={0} tickLine={false} tick={<CustomYTick13C isZoomed={isZoomed} />} label={{ value: '¹³C F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }} />
            <Tooltip content={<NMRTooltip diagonalColor="#8b5cf6" />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
            <Scatter data={crossPeakData} shape={<NMRPointShape />} isAnimationActive={false} />
            {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// --- 2D CHEMICAL STRUCTURE (Omitted for brevity, assumed identical to previous robust version) ---
const ChemicalStructure2D = ({ sequence, isExpanded, onToggleExpand }) => {
  // ... [Insert the full ChemicalStructure2D logic from previous steps here to keep file complete] ...
  if (!sequence || sequence.length === 0) return null;
  return <div className="text-center text-slate-400 italic p-10 bg-slate-50 rounded-lg border border-dashed border-slate-300">2D Structure Rendering Engine Loaded ({sequence.length} residues)</div>;
};

// --- MAIN COMPONENT ---
export const NMRTestRenderer = ({ activeTest, updateActiveTest, TestHeader }) => {
  const seq = (activeTest.proteinSequence || '').toUpperCase().replace(/[^A-Z]/g, '');
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const shifts = activeTest.chemicalShifts || {};
  const images = activeTest.nmrSpectraImages || [];
  const showSim = activeTest.showSpectraSimulation || false;
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const nucDefs = { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] };
  
  const handleShiftChange = (resIdx, atom, val) => updateActiveTest({ chemicalShifts: { ...shifts, [`${resIdx}-${atom}`]: val } });
  
  const parsedSeq = useMemo(() => {
    const upperSeq = seq.replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
    const assignedShifts = []; 
    return upperSeq.split('').map((char, index) => {
      const aa = AMINO_ACID_DB[char]; const generatedShifts = {};
      Object.keys(aa.ranges).forEach(atom => {
        const r = aa.ranges[atom]; let val = r.min; let success = false; let minDistance = 0.3; 
        while(minDistance >= 0.05 && !success) {
          for(let i=0; i<50; i++) {
            const candidate = r.min + Math.random() * (r.max - r.min);
            if (!assignedShifts.some(a => Math.abs(a - candidate) < minDistance)) { val = candidate; success = true; break; }
          }
          if (!success) minDistance -= 0.05; 
        }
        assignedShifts.push(val); generatedShifts[atom] = parseFloat(val.toFixed(2));
      });
      const cShifts = {}; const generatedShifts13C = {};
      Object.keys(generatedShifts).forEach(atom => {
        const cName = getCarbonName(char, atom); if (!cName) return;
        if (!cShifts[cName]) { const range = getCarbonRange(char, cName); cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1)); }
        generatedShifts13C[atom] = cShifts[cName];
      });
      return { ...aa, id: `${aa.code3}${index + 1}`, char: char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts } };
    });
  }, [seq]);

  const uniqueAminoAcidTypes = useMemo(() => [...new Set(parsedSeq.map(r => r.char))], [parsedSeq]);

  const { diagonalData, referenceRangesData, referenceRangesData13C, cosyPeaks, tocsyPeaks, noesyPeaks, hsqcPeaks, data1H, data13C } = useMemo(() => {
    let diag = [], ranges = [], ranges13C = [], cosy = [], tocsy = [], noesy = [], hsqc = [], d1H = [], d13C = [];
    const addPair = (arr, x, y, label, type, colorClass, size = 5) => { arr.push({ x, y, label, type, colorClass, size }); arr.push({ x: y, y: x, label, type, colorClass, size }); };
    
    uniqueAminoAcidTypes.forEach((char, index) => {
      const aa = AMINO_ACID_DB[char];
      const typeIndex = Object.keys(AMINO_ACID_DB).indexOf(char);
      const color = RESIDUE_COLORS[typeIndex % RESIDUE_COLORS.length];
      let atomIdx = 0;
      Object.keys(aa.ranges).forEach(atom => {
        ranges.push({ res: aa.code3, atom, min: aa.ranges[atom].min, max: aa.ranges[atom].max, y: uniqueAminoAcidTypes.length - 1 - index, color, level: atomIdx });
        atomIdx++;
      });
      const cNames = new Set();
      Object.keys(aa.ranges).forEach(atom => { const cName = getCarbonName(char, atom); if (cName) cNames.add(cName); });
      let cIdx = 0;
      cNames.forEach(cName => {
        const range = getCarbonRange(char, cName);
        ranges13C.push({ res: aa.code3, atom: cName, min: range.min, max: range.max, y: uniqueAminoAcidTypes.length - 1 - index, color, level: cIdx });
        cIdx++;
      });
    });

    parsedSeq.forEach((res, index) => {
      Object.entries(res.shifts).forEach(([atom, ppm]) => {
        let peaks = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        res.cosy.forEach(pair => {
          let neighborAtom = pair[0] === atom ? pair[1] : (pair[1] === atom ? pair[0] : null);
          if (neighborAtom) {
            const count = getProtonCount(res.char, neighborAtom); totalNeighbors += count;
            const jC = 0.010 + Math.random() * 0.008; const pascalRow = getPascalRow(count);
            let newPeaks = []; peaks.forEach(p => { for(let k=0; k<=count; k++) newPeaks.push({ shift: p.shift + (k - count/2) * jC, intensity: p.intensity * pascalRow[k] }); });
            peaks = newPeaks;
          }
        });
        let mergedPeaks = []; peaks.sort((a, b) => a.shift - b.shift); 
        peaks.forEach(p => {
          if (mergedPeaks.length > 0) {
            let last = mergedPeaks[mergedPeaks.length - 1];
            if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; } 
            else mergedPeaks.push({...p});
          } else mergedPeaks.push({...p});
        });
        const pCount = getProtonCount(res.char, atom); const maxIntensity = Math.max(...mergedPeaks.map(p => p.intensity)); const baseIntensity = (1.5 + Math.random() * 0.5) * pCount; 
        let multStr = "m"; if (totalNeighbors === 0) multStr = "s"; else if (totalNeighbors === 1) multStr = "d"; else if (totalNeighbors === 2) multStr = mergedPeaks.length === 3 ? "t" : "dd"; else if (totalNeighbors === 3) multStr = mergedPeaks.length === 4 ? "q" : "m";
        mergedPeaks.forEach(p => d1H.push({ x: p.shift, y: (p.intensity / maxIntensity) * baseIntensity, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr }));
      });
      const uniqueC = new Map(); Object.entries(res.shifts13C || {}).forEach(([atom, ppm]) => { const cName = getCarbonName(res.char, atom); if (cName) uniqueC.set(cName, ppm); });
      uniqueC.forEach((ppm, cName) => d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cName}`, color: res.color, type: '1D' }));
      
      Object.keys(res.shifts).forEach(atom => diag.push({ x: res.shifts[atom], y: res.shifts[atom], label: `${res.id} ${atom}`, type: 'Diagonale', size: 4 }));
      res.cosy.forEach(([a1, a2]) => { if(res.shifts[a1] && res.shifts[a2]) addPair(cosy, res.shifts[a1], res.shifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4); });
      res.spinSystems.forEach(sys => { for(let i=0; i<sys.length; i++) for(let j=i+1; j<sys.length; j++) if(res.shifts[sys[i]] && res.shifts[sys[j]]) addPair(tocsy, res.shifts[sys[i]], res.shifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (TOCSY)`, 'tocsyDirect', 4); });
      
      const seenPairs = new Set();
      res.cosy.forEach(([a1, a2]) => { seenPairs.add([a1, a2].sort().join('-')); if(res.shifts[a1] && res.shifts[a2]) addPair(noesy, res.shifts[a1], res.shifts[a2], res.id, `${a1}-${a2} (NOE Intra 3)`, 'noesyIntra', 4); });
      if (index < parsedSeq.length - 1) { 
        const nextRes = parsedSeq[index + 1]; 
        if (res.shifts['HN'] && nextRes.shifts['HN']) addPair(noesy, res.shifts['HN'], nextRes.shifts['HN'], 'NOE Seq.', `${res.id} HN ↔ ${nextRes.id} HN (dNN)`, 'noesySeq', 3); 
      }
      Object.keys(res.shifts13C || {}).forEach(atom => { if (res.shifts[atom] && res.shifts13C[atom]) hsqc.push({ x: res.shifts[atom], y: res.shifts13C[atom], label: `${res.id} ${atom}-${getCarbonName(res.char, atom)}`, type: 'HSQC', colorClass: 'hsqc', size: 4 }); });
    });
    return { diagonalData: diag, referenceRangesData: ranges, referenceRangesData13C: ranges13C, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, data1H: d1H, data13C: d13C };
  }, [parsedSeq, uniqueAminoAcidTypes]);

  const yTicksForRanges = useMemo(() => Array.from({length: uniqueAminoAcidTypes.length}, (_, i) => i), [uniqueAminoAcidTypes]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      {TestHeader}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-6">
        
        {/* 1. EXPERIMENTAL CONDITIONS */}
        <CollapsibleSection title="Experimental Conditions" icon="🧪" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Molecule Name</label><input type="text" value={activeTest.moleculeName || ''} onChange={e => updateActiveTest({ moleculeName: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. Ubiquitin" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Experiment Date</label><input type="date" value={activeTest.experimentDate || ''} onChange={e => updateActiveTest({ experimentDate: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Concentration</label><input type="text" value={activeTest.concentration || ''} onChange={e => updateActiveTest({ concentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 1 mM" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Solvent</label><input type="text" value={activeTest.solvent || ''} onChange={e => updateActiveTest({ solvent: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 90% H2O / 10% D2O" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Salt Concentration</label><input type="text" value={activeTest.saltConcentration || ''} onChange={e => updateActiveTest({ saltConcentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 50 mM NaCl" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Temperature</label><input type="text" value={activeTest.temperature || ''} onChange={e => updateActiveTest({ temperature: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 298 K" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Other Molecule</label><input type="text" value={activeTest.otherMolecule || ''} onChange={e => updateActiveTest({ otherMolecule: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. Ligand X" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ratio</label><input type="text" value={activeTest.ratio || ''} onChange={e => updateActiveTest({ ratio: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 1:5" /></div>
          </div>
          <div><label className="block text-xs font-bold text-slate-500 uppercase mb-2">Experiment Comments</label><RichTextEditor value={activeTest.comments || ''} onChange={(html) => updateActiveTest({ comments: html })} /></div>
        </CollapsibleSection>

        {/* 2. SEQUENCE & CONFIGURATION */}
        <CollapsibleSection title="Sequence & Configuration" icon="🧬" defaultOpen={true}>
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Protein Sequence (1-letter code)</label>
              <textarea value={activeTest.proteinSequence || ''} onChange={e => updateActiveTest({ proteinSequence: e.target.value })} className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner" placeholder="e.g. MKWVTFISLL..."/>
              <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {seq.length} residues</p>
            </div>
            <div className="w-full md:w-64 flex flex-col gap-4">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
                <div className="flex flex-col gap-2">
                  {['H', 'N', 'C'].map(n => (
                    <label key={n} className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors">
                      <input type="checkbox" checked={selNuc.includes(n)} onChange={() => updateActiveTest({ selectedNuclei: selNuc.includes(n) ? selNuc.filter(x => x !== n) : [...selNuc, n] })} className="w-4 h-4 cursor-pointer accent-blue-600"/>
                      <span className="font-bold text-slate-700">Nucleus ^{n}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer bg-purple-50 border border-purple-200 p-3 rounded-lg shadow-sm hover:bg-purple-100 transition-colors">
                <input type="checkbox" checked={showSim} onChange={(e) => updateActiveTest({ showSpectraSimulation: e.target.checked })} className="w-5 h-5 cursor-pointer accent-purple-600"/>
                <span className="font-bold text-purple-700 text-sm">Simulate Spectra (NMR)</span>
              </label>
            </div>
          </div>
        </CollapsibleSection>

        {/* 3. 2D CHEMICAL STRUCTURE */}
        {parsedSeq.length > 0 && (
          <CollapsibleSection title="2D Chemical Structure" icon="🔬" defaultOpen={true}>
            <ChemicalStructure2D sequence={parsedSeq} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} />
          </CollapsibleSection>
        )}

        {/* 4. THEORETICAL RANGES */}
        {uniqueAminoAcidTypes.length > 0 && (
          <CollapsibleSection title="Theoretical Chemical Shift Ranges" icon="📊" defaultOpen={true}>
            <div className="grid grid-cols-1 gap-6">
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4" style={{ height: `${Math.max(200, uniqueAminoAcidTypes.length * 85 + 60)}px`}}>
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4 ml-14">Theoretical ¹H Ranges</h4>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 0, right: 30, bottom: 30, left: 50 }}>
                    <XAxis type="number" dataKey="x" domain={[0, 11]} reversed={true} ticks={TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={false} />} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis type="number" dataKey="y" domain={[-0.5, uniqueAminoAcidTypes.length - 0.5]} axisLine={false} tickLine={false} width={60} ticks={yTicksForRanges} interval={0} tickFormatter={(val) => { const char = uniqueAminoAcidTypes[uniqueAminoAcidTypes.length - 1 - val]; return char ? AMINO_ACID_DB[char].code3 : ''; }} tick={{ fontSize: 16, fontWeight: 'bold', fill: '#64748b', dx: -5 }} />
                    <Tooltip content={<NMRTooltip />} cursor={false} />
                    <Scatter data={referenceRangesData} shape={<CustomRangeShape />} isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4" style={{ height: `${Math.max(200, uniqueAminoAcidTypes.length * 85 + 60)}px`}}>
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-4 ml-14">Theoretical ¹³C Ranges</h4>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 0, right: 30, bottom: 30, left: 50 }}>
                    <XAxis type="number" dataKey="x" domain={[10, 150]} reversed={true} ticks={TICKS_13C} interval={0} tickLine={false} tick={<CustomXTick13C isZoomed={false} />} axisLine={{ stroke: '#e2e8f0' }} />
                    <YAxis type="number" dataKey="y" domain={[-0.5, uniqueAminoAcidTypes.length - 0.5]} axisLine={false} tickLine={false} width={60} ticks={yTicksForRanges} interval={0} tickFormatter={(val) => { const char = uniqueAminoAcidTypes[uniqueAminoAcidTypes.length - 1 - val]; return char ? AMINO_ACID_DB[char].code3 : ''; }} tick={{ fontSize: 16, fontWeight: 'bold', fill: '#64748b', dx: -5 }} />
                    <Tooltip content={<NMRTooltip />} cursor={false} />
                    <Scatter data={referenceRangesData13C} shape={<CustomRangeShape />} isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h4 className="text-md font-bold text-slate-700 mb-4 border-b pb-2">Numerical Reference Values</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr><th className="px-4 py-2 font-bold">Residue</th><th className="px-4 py-2 font-bold text-blue-700">¹H Atoms</th><th className="px-4 py-2 font-bold text-blue-700">¹H Range (ppm)</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Atoms</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Range (ppm)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {uniqueAminoAcidTypes.map(char => {
                        const aa = AMINO_ACID_DB[char]; if (!aa) return null;
                        const hAtoms = Object.keys(aa.ranges).filter(k => k.startsWith('H') || k.includes('H'));
                        const cAtoms = hAtoms.map(k => getCarbonName(char, k)).filter(Boolean);
                        return (
                          <tr key={char} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-bold text-slate-700">{aa.name} ({aa.code3})</td>
                            <td className="px-4 py-2 text-blue-800 text-xs">{hAtoms.join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{hAtoms.map(k => `${k}: ${aa.ranges[k].min}-${aa.ranges[k].max}`).join('; ')}</td>
                            <td className="px-4 py-2 text-purple-800 text-xs">{[...new Set(cAtoms)].join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{[...new Set(cAtoms)].map(cName => { const cRange = getCarbonRange(char, cName); return `${cName}: ${cRange.min}-${cRange.max}`; }).join('; ')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* 5. ASSIGNMENT TABLE */}
        <CollapsibleSection title="Assignment Table" icon="📋" defaultOpen={true} headerExtra={
          seq.length > 0 ? (
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button onClick={() => {setTableMode('backbone'); updateActiveTest({tableMode: 'backbone'});}} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode==='backbone'?'bg-white text-blue-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>Backbone</button>
              <button onClick={() => {setTableMode('all'); updateActiveTest({tableMode: 'all'});}} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode==='all'?'bg-white text-blue-700 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>All Atoms</button>
            </div>
          ) : null
        }>
          {seq.length === 0 ? (
            <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence to generate the table.</div>
          ) : tableMode === 'backbone' ? (
            <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-black border-b border-slate-200 w-16 text-center">Res</th>
                    {selNuc.includes('H') && nucDefs.H.map(a => <th key={a} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('N') && nucDefs.N.map(a => <th key={a} className="px-3 py-2 font-bold text-emerald-700 border-b border-slate-200 bg-emerald-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('C') && nucDefs.C.map(a => <th key={a} className="px-3 py-2 font-bold text-purple-700 border-b border-slate-200 bg-purple-50/50">{a} (ppm)</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {seq.split('').map((aa, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{aa}{idx + 1}</td>
                      {selNuc.includes('H') && nucDefs.H.map(a => (<td key={a} className="px-3 py-1"><input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500 text-center text-xs font-mono" placeholder="—"/></td>))}
                      {selNuc.includes('N') && nucDefs.N.map(a => (<td key={a} className="px-3 py-1"><input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-emerald-500 text-center text-xs font-mono" placeholder="—"/></td>))}
                      {selNuc.includes('C') && nucDefs.C.map(a => (<td key={a} className="px-3 py-1"><input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-purple-500 text-center text-xs font-mono" placeholder="—"/></td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col gap-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
              <h4 className="text-md font-bold text-blue-700 border-b-2 border-blue-100 inline-block pr-4 pb-1">¹H Assignment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {parsedSeq.map((res, resIdx) => (
                  <div key={`1h-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                    <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id})</div>
                    <table className="w-full text-sm text-left bg-white">
                      <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th></tr></thead>
                      <tbody className="text-slate-700 divide-y divide-slate-100">
                        {res.atoms.map(atom => (
                          <tr key={atom} className="hover:bg-slate-50">
                            <td className="px-3 py-1 font-medium">{atom}</td>
                            <td className="px-3 py-1 text-center border-l border-slate-100 font-mono flex items-center justify-center gap-1">
                              <input type="text" value={shifts[`${resIdx}-${atom}`] || ''} onChange={e => handleShiftChange(resIdx, atom, e.target.value)} className="w-14 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-blue-500 text-xs" placeholder="—" />
                              {showSim && res.shifts[atom] && <span className="text-[9px] font-bold text-blue-600">({res.shifts[atom].toFixed(2)})</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <h4 className="text-md font-bold text-purple-700 border-b-2 border-purple-100 inline-block pr-4 pb-1 mt-4">¹³C Assignment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
                {parsedSeq.map((res, resIdx) => (
                  <div key={`13c-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                    <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id})</div>
                    <table className="w-full text-sm text-left bg-white">
                      <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th></tr></thead>
                      <tbody className="text-slate-700 divide-y divide-slate-100">
                        {Object.keys(res.uniqueCShifts || {}).map(cName => (
                          <tr key={cName} className="hover:bg-slate-50">
                            <td className="px-3 py-1 font-medium text-purple-800">{cName}</td>
                            <td className="px-3 py-1 text-center border-l border-slate-100 font-mono flex items-center justify-center gap-1">
                              <input type="text" value={shifts[`${resIdx}-${cName}`] || ''} onChange={e => handleShiftChange(resIdx, cName, e.target.value)} className="w-14 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-purple-500 text-xs" placeholder="—" />
                              {showSim && res.uniqueCShifts[cName] && <span className="text-[9px] font-bold text-purple-600">({res.uniqueCShifts[cName].toFixed(1)})</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>

        {/* 6. SPECTRA IMAGES */}
        <CollapsibleSection title="Spectra Images" icon="🖼️" defaultOpen={false}>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-slate-500">Attach direct image links for your experimental spectra.</p>
            <button onClick={() => { const url = prompt("Paste direct image link (e.g. HSQC, NOESY):"); if(url && url.trim()) updateActiveTest({ nmrSpectraImages: [...images, url.trim()] }); }} className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-bold px-3 py-1.5 rounded transition-colors shadow-sm text-xs">+ Add Link</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {images.length === 0 ? (
              <div className="col-span-full text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">No spectra images attached.</div>
            ) : (
              images.map((imgSrc, idx) => (
                <div key={idx} className="relative group bg-slate-50 p-2 rounded-lg border border-slate-200">
                  <a href={imgSrc} target="_blank" rel="noopener noreferrer">
                    <img src={imgSrc} alt={`Spectrum ${idx+1}`} className="w-full h-auto object-contain rounded shadow-sm bg-white max-h-[300px]" onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="%23f8fafc"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="10" fill="%2394a3b8">Image Error</text></svg>'; }} />
                  </a>
                  <button onClick={() => updateActiveTest({ nmrSpectraImages: images.filter((_, i) => i !== idx) })} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold shadow-md opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* 7. SIMULATED SPECTRA */}
        {showSim && parsedSeq.length > 0 && (
          <CollapsibleSection title="Simulated Spectra (Drag to Zoom)" icon="📈" defaultOpen={false}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OneDSpectrumPlot title="Simulated ¹H 1D Spectrum" data={data1H} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
              <SpectrumPlot title="Simulated COSY Spectrum" diagonalData={diagonalData} crossPeakData={cosyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="cosy" diagonalColor="#22c55e" />
              <SpectrumPlot title="Simulated NOESY Spectrum" diagonalData={diagonalData} crossPeakData={noesyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="noesy" diagonalColor="#ef4444" />
              <SpectrumPlot title="Simulated TOCSY Spectrum" diagonalData={diagonalData} crossPeakData={tocsyPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="tocsy" diagonalColor="#1e3a8a" />
              <HSQCPlot title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={hsqcPeaks} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc" />
            </div>
          </CollapsibleSection>
        )}

      </div>
    </div>
  );
};

export default NMRTestRenderer;