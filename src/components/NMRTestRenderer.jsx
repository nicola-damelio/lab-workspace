import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { RichTextEditor } from './RichTextEditor';

// --- UTILITY CLASSES FOR FULLSCREEN ---
const FS_CLASSES = "fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col";
const OVERLAY_CLASSES = "fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]";

// --- 1. NMR INTEGRATED CONSTANTS & DATA ---
const AMINO_ACID_DB = {
    'A': { name: 'Alanine', code3: 'Ala', atoms: ['HN', 'Hα', 'Hβ'], ranges: { 'HN': {min: 7.8, max: 8.6}, 'Hα': {min: 4.0, max: 4.5}, 'Hβ': {min: 1.2, max: 1.5} }, cosy: [['HN','Hα'], ['Hα','Hβ']], spinSystems: [['HN', 'Hα', 'Hβ']] },
    'C': { name: 'Cysteine', code3: 'Cys', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.4, max: 4.8}, 'Hβ1': {min: 2.8, max: 3.3}, 'Hβ2': {min: 2.8, max: 3.3} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'D': { name: 'Aspartic Acid', code3: 'Asp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.5, max: 2.9}, 'Hβ2': {min: 2.5, max: 2.9} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'E': { name: 'Glutamic Acid', code3: 'Glu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ'], ranges: { 'HN': {min: 8.0, max: 8.7}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.1, max: 2.5} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ']] },
    'F': { name: 'Phenylalanine', code3: 'Phe', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε', 'Hζ'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.9, max: 3.3}, 'Hβ2': {min: 2.9, max: 3.3}, 'Hδ': {min: 7.1, max: 7.4}, 'Hε': {min: 7.2, max: 7.5}, 'Hζ': {min: 7.1, max: 7.4} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ','Hε'], ['Hε','Hζ']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε', 'Hζ']] },
    'G': { name: 'Glycine', code3: 'Gly', atoms: ['HN', 'Hα1', 'Hα2'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα1': {min: 3.8, max: 4.1}, 'Hα2': {min: 3.8, max: 4.1} }, cosy: [['HN','Hα1'], ['HN','Hα2'], ['Hα1','Hα2']], spinSystems: [['HN', 'Hα1', 'Hα2']] },
    'H': { name: 'Histidine', code3: 'His', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ2', 'Hε1'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.5, max: 5.0}, 'Hβ1': {min: 3.0, max: 3.4}, 'Hβ2': {min: 3.0, max: 3.4}, 'Hδ2': {min: 6.9, max: 7.3}, 'Hε1': {min: 7.6, max: 8.1} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ2','Hε1']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']] },
    'I': { name: 'Isoleucine', code3: 'Ile', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1'], ranges: { 'HN': {min: 7.7, max: 8.5}, 'Hα': {min: 4.0, max: 4.4}, 'Hβ': {min: 1.7, max: 2.0}, 'Hγ1': {min: 1.1, max: 1.6}, 'Hγ2': {min: 0.8, max: 1.1}, 'Hδ1': {min: 0.7, max: 1.0} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ1'], ['Hβ','Hγ2'], ['Hγ1','Hδ1']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1']] },
    'K': { name: 'Lysine', code3: 'Lys', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε', 'Hζ(NH3)'], ranges: { 'HN': {min: 7.9, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.6, max: 1.9}, 'Hγ': {min: 1.3, max: 1.6}, 'Hδ': {min: 1.5, max: 1.8}, 'Hε': {min: 2.8, max: 3.2}, 'Hζ(NH3)': {min: 7.2, max: 7.6} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ'], ['Hδ','Hε'], ['Hε','Hζ(NH3)']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ['Hζ(NH3)']] },
    'L': { name: 'Leucine', code3: 'Leu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2'], ranges: { 'HN': {min: 7.9, max: 8.5}, 'Hα': {min: 4.2, max: 4.7}, 'Hβ': {min: 1.5, max: 1.9}, 'Hγ': {min: 1.4, max: 1.8}, 'Hδ1': {min: 0.8, max: 1.0}, 'Hδ2': {min: 0.8, max: 1.0} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ1'], ['Hγ','Hδ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2']] },
    'M': { name: 'Methionine', code3: 'Met', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε(CH3)'], ranges: { 'HN': {min: 7.9, max: 8.6}, 'Hα': {min: 4.3, max: 4.7}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.4, max: 2.7}, 'Hε(CH3)': {min: 2.0, max: 2.2} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε(CH3)']] },
    'N': { name: 'Asparagine', code3: 'Asn', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ21', 'Hδ22'], ranges: { 'HN': {min: 8.0, max: 8.8}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.6, max: 3.0}, 'Hβ2': {min: 2.6, max: 3.0}, 'Hδ21': {min: 6.8, max: 7.2}, 'Hδ22': {min: 7.4, max: 7.8} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ21','Hδ22']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']] },
    'P': { name: 'Proline', code3: 'Pro', atoms: ['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2'], ranges: { 'Hα': {min: 4.2, max: 4.6}, 'Hβ1': {min: 1.8, max: 2.4}, 'Hβ2': {min: 1.8, max: 2.4}, 'Hγ1': {min: 1.8, max: 2.1}, 'Hγ2': {min: 1.8, max: 2.1}, 'Hδ1': {min: 3.4, max: 3.8}, 'Hδ2': {min: 3.4, max: 3.8} }, cosy: [['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hβ1','Hγ1'], ['Hβ2','Hγ2'], ['Hγ1','Hγ2'], ['Hγ1','Hδ1'], ['Hγ2','Hδ2'], ['Hδ1','Hδ2']], spinSystems: [['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2']] }, 
    'Q': { name: 'Glutamine', code3: 'Gln', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε21', 'Hε22'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ': {min: 2.2, max: 2.6}, 'Hε21': {min: 6.7, max: 7.1}, 'Hε22': {min: 7.3, max: 7.7} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hε21','Hε22']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε21', 'Hε22']] },
    'R': { name: 'Arginine', code3: 'Arg', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.1, max: 4.5}, 'Hβ': {min: 1.6, max: 2.0}, 'Hγ': {min: 1.4, max: 1.8}, 'Hδ': {min: 3.0, max: 3.3}, 'Hε': {min: 7.0, max: 7.4} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ'], ['Hγ','Hδ'], ['Hδ','Hε']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ'], ['Hε']] },
    'S': { name: 'Serine', code3: 'Ser', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { 'HN': {min: 8.0, max: 8.6}, 'Hα': {min: 4.3, max: 4.8}, 'Hβ1': {min: 3.7, max: 4.0}, 'Hβ2': {min: 3.7, max: 4.0} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
    'T': { name: 'Threonine', code3: 'Thr', atoms: ['HN', 'Hα', 'Hβ', 'Hγ2'], ranges: { 'HN': {min: 7.8, max: 8.5}, 'Hα': {min: 4.2, max: 4.6}, 'Hβ': {min: 4.0, max: 4.4}, 'Hγ2': {min: 1.0, max: 1.3} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ2']] },
    'V': { name: 'Valine', code3: 'Val', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2'], ranges: { 'HN': {min: 7.8, max: 8.5}, 'Hα': {min: 4.0, max: 4.4}, 'Hβ': {min: 1.9, max: 2.3}, 'Hγ1': {min: 0.8, max: 1.1}, 'Hγ2': {min: 0.8, max: 1.1} }, cosy: [['HN','Hα'], ['Hα','Hβ'], ['Hβ','Hγ1'], ['Hβ','Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2']] },
    'W': { name: 'Tryptophan', code3: 'Trp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ1', 'Hε3', 'Hζ2', 'Hη2', 'Hζ3'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.5, max: 5.0}, 'Hβ1': {min: 3.1, max: 3.5}, 'Hβ2': {min: 3.1, max: 3.5}, 'Hδ1': {min: 10.0, max: 10.5}, 'Hε3': {min: 7.4, max: 7.7}, 'Hζ2': {min: 7.3, max: 7.6}, 'Hη2': {min: 7.0, max: 7.3}, 'Hζ3': {min: 6.9, max: 7.2} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ1','Hε3'], ['Hε3','Hζ3'], ['Hζ3','Hη2'], ['Hη2','Hζ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ1'], ['Hε3', 'Hζ3', 'Hη2', 'Hζ2']] },
    'Y': { name: 'Tyrosine', code3: 'Tyr', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε'], ranges: { 'HN': {min: 7.9, max: 8.7}, 'Hα': {min: 4.4, max: 4.9}, 'Hβ1': {min: 2.8, max: 3.2}, 'Hβ2': {min: 2.8, max: 3.2}, 'Hδ': {min: 6.9, max: 7.2}, 'Hε': {min: 6.6, max: 6.9} }, cosy: [['HN','Hα'], ['Hα','Hβ1'], ['Hα','Hβ2'], ['Hβ1','Hβ2'], ['Hδ','Hε']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε']] }
};
const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#f43f5e'];
const TICKS_1H = Array.from({length: 111}, (_, i) => parseFloat((i / 10).toFixed(1))); 
const TICKS_13C = Array.from({length: 281}, (_, i) => parseFloat((10 + i * 0.5).toFixed(1))); 

const getNMRFillColor = (entry) => { 
    if (entry.colorClass === 'cosy') return '#22c55e'; 
    if (entry.colorClass === 'tocsyDirect') return '#1e3a8a'; 
    if (entry.colorClass === 'tocsyRelay') return '#3b82f6'; 
    if (entry.colorClass === 'noesyIntra') return '#ef4444'; 
    if (entry.colorClass === 'noesyIntra4') return '#fca5a5'; 
    if (entry.colorClass === 'noesySeq') return '#991b1b'; 
    if (entry.colorClass === 'hsqc') return '#8b5cf6'; 
    return '#cbd5e1'; 
};

const getCarbonName = (char, atom) => {
    if (atom.startsWith('HN') || atom.startsWith('NH') || atom.includes('NH3') || (atom === 'Hε' && char === 'R')) return null;
    let cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C'); 
    if (atom.includes('CH3')) return atom.replace('H', 'C');
    return cName;
};

const getProtonCount = (char, atom) => {
    if (char === 'A' && atom === 'Hβ') return 3;
    if (char === 'V' && (atom === 'Hγ1' || atom === 'Hγ2')) return 3;
    if (char === 'L' && (atom === 'Hδ1' || atom === 'Hδ2')) return 3;
    if (char === 'I' && (atom === 'Hγ2' || atom === 'Hδ1')) return 3;
    if (char === 'T' && atom === 'Hγ2') return 3;
    if (char === 'M' && atom === 'Hε(CH3)') return 3;
    return 1;
};

const getPascalRow = (n) => {
    if (n === 0) return [1];
    let row = [1];
    for (let i = 0; i < n; i++) {
        let nextRow = [1];
        for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j+1]);
        nextRow.push(1); row = nextRow;
    }
    return row;
};

const getCarbonRange = (char, cName) => {
    if (!cName) return {min: 40, max: 50};
    if (cName.includes('Cα')) return {min: 50, max: 65};
    if (cName.includes('Cβ')) return (char === 'S' || char === 'T') ? {min: 60, max: 70} : {min: 25, max: 45};
    if (cName.includes('Cγ')) return (['V','I','T'].includes(char)) ? {min: 15, max: 25} : {min: 25, max: 35};
    if (cName.includes('Cδ')) return (['F','Y','W','H'].includes(char)) ? {min: 110, max: 135} : {min: 20, max: 50};
    if (cName.includes('Cε')) return (['F','Y','W','H'].includes(char)) ? {min: 110, max: 135} : {min: 25, max: 45};
    if (cName.includes('Cζ') || cName.includes('Cη')) return {min: 110, max: 135};
    return {min: 40, max: 50}; 
};

const getHexagon = (cx, cy, r, dir) => {
    const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2;
    for(let i=0; i<6; i++) { const a = baseAngle + i * (Math.PI/3) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
};

const getPentagon = (cx, cy, r, dir) => {
    const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2;
    for(let i=0; i<5; i++) { const a = baseAngle + i * (2*Math.PI/5) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
};

// --- 2. REUSABLE COLLAPSIBLE SECTION ---
export const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className="" }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
            <button onClick={() => setIsOpen(!isOpen)} className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}>
                <div className="flex items-center gap-2 overflow-hidden">
                    {icon && <span className="text-xl shrink-0">{icon}</span>}
                    <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
                    <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
            </button>
            {isOpen && <div className="p-6">{children}</div>}
        </div>
    );
};

// --- 3. CUSTOM TICKS E SHAPES PER RECHARTS (RISOLUZIONE DEI BUG 1D E RANGES) ---
const CustomXTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0; const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (<g transform={`translate(${x||0},${y||0})`}><line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isInt) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}</g>);
};
const CustomYTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0; const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (<g transform={`translate(${x||0},${y||0})`}><line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isInt) && <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}</g>);
};
const CustomXTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0; const tickLength = isZoomed ? 5 : (isTen ? 8 : (isFive ? 6 : 4));
  return (<g transform={`translate(${x||0},${y||0})`}><line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isTen) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}</g>);
};
const CustomYTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0; const tickLength = isZoomed ? 5 : (isTen ? 10 : (isFive ? 6 : 4));
  return (<g transform={`translate(${x||0},${y||0})`}><line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />{(isZoomed || isTen) && <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 12} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}</g>);
};

// FIX IMPORTANTE 1: I GRAFICI DEGLI INTERVALLI
const CustomRangeShape = (props) => { 
  const { cy, payload, xAxis } = props; 
  if (!xAxis || typeof xAxis.scale !== 'function' || payload.min === undefined || payload.max === undefined) return null;
  // xAxis.scale(max) dà la coordinata x più a sinistra perché l'asse è rovesciato (reversed)
  const xMin = xAxis.scale(payload.max); 
  const xMax = xAxis.scale(payload.min); 
  if (isNaN(xMin) || isNaN(xMax) || isNaN(cy)) return null;
  
  // Math.abs garantisce che la larghezza sia sempre positiva
  const width = Math.max(Math.abs(xMax - xMin), 4); 
  const height = 14; 
  const level = payload.level || 0;
  let textY = cy;
  if (level % 4 === 0) textY = cy + 18; else if (level % 4 === 1) textY = cy - 10; else if (level % 4 === 2) textY = cy + 32; else textY = cy - 24;
  
  // L'attributo x del rettangolo deve essere il valore più piccolo tra i due calcolati!
  const rectX = Math.min(xMin, xMax);

  return (
    <g>
      <rect x={rectX} y={cy - height / 2} width={width} height={height} fill={payload.color} rx={4} opacity={0.5} stroke={payload.color} strokeWidth={1} />
      <text x={(xMin + xMax) / 2} y={textY} textAnchor="middle" fill="#334155" fontSize="13px" fontWeight="bold" pointerEvents="none"> {payload.atom} </text>
    </g>
  ); 
};

// FIX IMPORTANTE 2: LO SPETTRO 1D
const OneDShape = (props) => { 
    const { cx, cy, yAxis, payload } = props; 
    if (!yAxis || typeof yAxis.scale !== 'function') return null;
    const y0 = yAxis.scale(0); 
    if (isNaN(cx) || isNaN(cy) || isNaN(y0)) return null;
    return <line x1={cx} y1={y0} x2={cx} y2={cy} stroke={payload.color} strokeWidth={1.5} />; 
};

const NMRPointShape = ({ cx, cy, fill, payload }) => {
    if (isNaN(cx) || isNaN(cy)) return null;
    return <circle cx={cx} cy={cy} r={payload.size || 5} fill={payload.type === 'Diagonale' ? fill : getNMRFillColor(payload)} opacity={0.8} />;
};

const NMRTooltip = ({ active, payload, diagonalColor }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.min !== undefined) return (<div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50"><p className="font-bold text-slate-800">{data.res} - {data.atom}</p><p className="text-slate-500">Theoretical Range: {data.min.toFixed(2)} - {data.max.toFixed(2)} ppm</p></div>);
    if (data.type === '1D') return (<div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50"><p className="font-bold text-slate-800">{data.label}</p><p className="text-slate-500">{data.x.toFixed(3)} ppm</p>{data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}</div>);
    return (<div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50"><p className="font-bold text-slate-800">{data.label}</p><p className="font-semibold" style={{ color: data.type === 'Diagonale' ? diagonalColor : getNMRFillColor(data) }}>{data.type}</p><p className="text-slate-500 text-xs mt-1"> F2: {Number(data.x).toFixed(2)} ppm <br/> F1: {Number(data.y).toFixed(2)} ppm </p></div>);
  }
  return null;
};

// --- 4. ROBUST ZOOMABLE PLOTS (FIX 3: EVENT MAPPING CORRETTO) ---
const OneDSpectrumPlot = ({ title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState(fullDomain);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const isZoomed = xDomain[0] !== fullDomain[0] || xDomain[1] !== fullDomain[1];
  
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null) { setRefAreaLeft(null); setRefAreaRight(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setRefAreaLeft(null); setRefAreaRight(null); };
  
  // Utilizziamo e.xValue che viene esposto da Recharts quando si clicca sull'area del grafico
  const handleMouseDown = (e) => { 
      if (!e) return;
      let xVal = e.xValue;
      if (xVal === undefined && e.activePayload && e.activePayload.length > 0) xVal = e.activePayload[0].payload.x;
      if (xVal !== undefined) setRefAreaLeft(xVal); 
  };
  const handleMouseMove = (e) => { 
      if (refAreaLeft !== null && e) { 
          let xVal = e.xValue;
          if (xVal === undefined && e.activePayload && e.activePayload.length > 0) xVal = e.activePayload[0].payload.x;
          if (xVal !== undefined) setRefAreaRight(xVal); 
      } 
  };

  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 10 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={zoom}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : ticks} interval={0} tickLine={false} tick={<TickComponent isZoomed={isZoomed} />} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis type="number" dataKey="y" domain={[0, 4.5]} hide={true} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip />} />
              <Scatter data={data} shape={<OneDShape />} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

const SpectrumPlot = ({ title, diagonalData, crossPeakData, expandedPanel, setExpandedPanel, panelId, diagonalColor }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]); const [yDomain, setYDomain] = useState([0, 11]);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null); const [refAreaBottom, setRefAreaBottom] = useState(null);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 11;
  
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null || refAreaTop === refAreaBottom || refAreaTop === null) { setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); };

  const handleMouseDown = (e) => { 
      if (!e) return;
      let xVal = e.xValue, yVal = e.yValue;
      if (xVal === undefined && e.activePayload && e.activePayload.length > 0) { xVal = e.activePayload[0].payload.x; yVal = e.activePayload[0].payload.y; }
      if (xVal !== undefined && yVal !== undefined) { setRefAreaLeft(xVal); setRefAreaTop(yVal); } 
  };
  const handleMouseMove = (e) => { 
      if (refAreaLeft !== null && e) { 
          let xVal = e.xValue, yVal = e.yValue;
          if (xVal === undefined && e.activePayload && e.activePayload.length > 0) { xVal = e.activePayload[0].payload.x; yVal = e.activePayload[0].payload.y; }
          if (xVal !== undefined && yVal !== undefined) { setRefAreaRight(xVal); setRefAreaBottom(yVal); }
      } 
  };

  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 40 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={zoom}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }} />
              <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomYTick1H isZoomed={isZoomed} />} label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }} />
              <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter name="Diagonale" data={[{x:0, y:0}, {x:11, y:11}]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={<circle r={0} />} legendType="none" isAnimationActive={false} />
              <Scatter data={diagonalData} fill={diagonalColor} shape={<NMRPointShape />} isAnimationActive={false} />
              <Scatter data={crossPeakData} shape={<NMRPointShape />} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

const HSQCPlot = ({ title, crossPeakData, expandedPanel, setExpandedPanel, panelId }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]); const [yDomain, setYDomain] = useState([10, 150]);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null); const [refAreaBottom, setRefAreaBottom] = useState(null);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 10 || yDomain[1] !== 150;
  
  const zoom = () => { if (refAreaLeft === refAreaRight || refAreaLeft === null || refAreaTop === refAreaBottom || refAreaTop === null) { setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); return; } setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null); };

  const handleMouseDown = (e) => { 
      if (!e) return;
      let xVal = e.xValue, yVal = e.yValue;
      if (xVal === undefined && e.activePayload && e.activePayload.length > 0) { xVal = e.activePayload[0].payload.x; yVal = e.activePayload[0].payload.y; }
      if (xVal !== undefined && yVal !== undefined) { setRefAreaLeft(xVal); setRefAreaTop(yVal); } 
  };
  const handleMouseMove = (e) => { 
      if (refAreaLeft !== null && e) { 
          let xVal = e.xValue, yVal = e.yValue;
          if (xVal === undefined && e.activePayload && e.activePayload.length > 0) { xVal = e.activePayload[0].payload.x; yVal = e.activePayload[0].payload.y; }
          if (xVal !== undefined && yVal !== undefined) { setRefAreaRight(xVal); setRefAreaBottom(yVal); }
      } 
  };

  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] lg:col-span-2 break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4"><h4 className="font-bold text-slate-700">{title}</h4>{isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([10, 150]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}</div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 40 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={zoom}>
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
    </>
  );
};

// --- 5. 2D CHEMICAL STRUCTURE CON SCORRIMENTO (FIX 4) ---
const ChemicalStructure2D = ({ sequence, isExpanded, onToggleExpand }) => {
  if (!sequence || sequence.length === 0) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const addLine = (x1, y1, x2, y2, color, isDouble = false) => {
      updateBounds(x1, y1); updateBounds(x2, y2);
      if (isDouble) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.sqrt(dx*dx + dy*dy); const nx = -dy / len * 2.5; const ny = dx / len * 2.5; elements.push({ type: 'line', x1: x1+nx, y1: y1+ny, x2: x2+nx, y2: y2+ny, color }); elements.push({ type: 'line', x1: x1-nx, y1: y1-ny, x2: x2-nx, y2: y2-ny, color }); } else elements.push({ type: 'line', x1, y1, x2, y2, color });
  };
  const addText = (x, y, text, color, fontSize = 11, align = 'middle') => { updateBounds(x, y - 15); updateBounds(x, y + 15); updateBounds(x - 30, y); updateBounds(x + 30, y); elements.push({ type: 'text', x, y, text, color, fontSize, align }); };
  const addRingHeteroatom = (x, y, text, color) => { elements.push({ type: 'circle', x, y, r: 12, color: 'white', fill: 'white', strokeWidth: 0 }); elements.push({ type: 'text', x, y, text, color, fontSize: 12, align: 'middle' }); };
  const placeRadialLabel = (cx, cy, pt, text, color) => { const angle = Math.atan2(pt.y - cy, pt.x - cx); const dist = 18; const lx = pt.x + dist * Math.cos(angle); const ly = pt.y + dist * Math.sin(angle); let anchor = 'middle'; if (Math.abs(angle) < Math.PI/3) anchor = 'start'; else if (Math.abs(angle) > 2*Math.PI/3) anchor = 'end'; addText(lx, ly, text, color, 11, anchor); };
  const addPolygon = (pointsStr, color) => { const pts = pointsStr.split(' ').map(p => p.split(',').map(Number)); pts.forEach(([x, y]) => updateBounds(x, y)); elements.push({ type: 'polygon', points: pointsStr, color }); };

  const dx = 45; const dy = 30; const S = 25;  
  const coords = []; let cx = 100; let cy = 200; let slope = -1; 
  
  for (let i = 0; i < sequence.length; i++) {
      const nX = cx; const nY = cy; cx += dx; cy += slope * dy;
      const caX = cx; const caY = cy; const scDir = slope; slope *= -1; 
      cx += dx; cy += slope * dy; const cX = cx; const cY = cy; const oDir = slope; slope *= -1; 
      cx += dx; cy += slope * dy; const nextNX = cx; const nextNY = cy; slope *= -1; 
      coords.push({ nX, nY, caX, caY, cX, cY, nextNX, nextNY, scDir, oDir, res: sequence[i] });
  }

  coords.forEach((c, i) => {
      const color = c.res.color; const isFirst = i === 0; const isLast = i === sequence.length - 1; const char = c.res.char;
      if (!isFirst) addLine(coords[i-1].cX, coords[i-1].cY, c.nX, c.nY, coords[i-1].res.color); 
      addLine(c.nX, c.nY, c.caX, c.caY, color); addLine(c.caX, c.caY, c.cX, c.cY, color); addLine(c.cX, c.cY, c.cX, c.cY + c.oDir*25, "red", true); 
      if (isLast) addLine(c.cX, c.cY, c.nextNX, c.nextNY, color);
      if (!isFirst && char !== 'P') { const hDir = c.nY < c.caY ? -1 : 1; addLine(c.nX, c.nY, c.nX, c.nY + hDir*15, color); addText(c.nX, c.nY + hDir*25, "H", color, 11); }
      if (char !== 'G') { const haDir = -c.scDir; addLine(c.caX, c.caY, c.caX, c.caY + haDir*15, color); addText(c.caX, c.caY + haDir*25, "Hα", color, 11); } else { addLine(c.caX, c.caY, c.caX, c.caY - 15, color); addText(c.caX, c.caY - 25, "Hα1", color, 11); addLine(c.caX, c.caY, c.caX, c.caY + 15, color); addText(c.caX, c.caY + 25, "Hα2", color, 11); }
      if (char === 'P') { elements.push({ type: 'path', d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir*40} ${c.caX} ${c.caY + c.scDir*25}`, color }); addLine(c.caX, c.caY, c.caX, c.caY + c.scDir*25, color); }
      elements.push({ type: 'circle', x: c.nX, y: c.nY, r: 13, color: color, fill: 'white' });
      if (isFirst) addText(c.nX, c.nY, char === 'P' ? "H₂N⁺" : "H₃N⁺", color, 13); else addText(c.nX, c.nY, "N", color, 13);
      elements.push({ type: 'circle', x: c.caX, y: c.caY, r: 13, color: color, fill: 'white' }); addText(c.caX, c.caY, "Cα", color, 13);
      elements.push({ type: 'circle', x: c.cX, y: c.cY, r: 13, color: color, fill: 'white' }); addText(c.cX, c.cY, "C", color, 13);
      addText(c.cX, c.cY + c.oDir*35, "O", "red", 13);
      if (isLast) { elements.push({ type: 'circle', x: c.nextNX, y: c.nextNY, r: 13, color: color, fill: 'white' }); addText(c.nextNX, c.nextNY, "O⁻", "red", 13, 'middle'); }
      const vNode = (lvl, text) => { if(lvl > 0) addLine(c.caX, c.caY + c.scDir*(lvl-1)*S, c.caX, c.caY + c.scDir*lvl*S, color); addText(c.caX, c.caY + c.scDir*(lvl*S + (c.scDir===1?10:-10)), text, color); };
      if (char !== 'G' && char !== 'P') { addLine(c.caX, c.caY, c.caX, c.caY + c.scDir*S, color); if (!['A','I','V','T','F','Y','W','H'].includes(char)) addText(c.caX, c.caY + c.scDir*S, "CH₂ (Hβ)", color); }
      switch(char) {
          case 'A': addText(c.caX, c.caY + c.scDir*S, "CH₃ (Hβ)", color); break;
          case 'V': addText(c.caX, c.caY + c.scDir*S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ1)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.8*S, color); addText(c.caX+20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); break;
          case 'L': vNode(2, 'CH (Hγ)'); addLine(c.caX, c.caY+c.scDir*2*S, c.caX-20, c.caY+c.scDir*2.8*S, color); addText(c.caX-20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ1)', color); addLine(c.caX, c.caY+c.scDir*2*S, c.caX+20, c.caY+c.scDir*2.8*S, color); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ2)', color); break;
          case 'I': addText(c.caX, c.caY + c.scDir*S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.8*S, color); addText(c.caX+20, c.caY+c.scDir*(1.8*S+10), 'CH₂ (Hγ1)', color); addLine(c.caX+20, c.caY+c.scDir*1.8*S, c.caX+20, c.caY+c.scDir*2.8*S, color); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ1)', color); break;
          case 'S': vNode(2, 'OH (Hγ)'); break;
          case 'T': addText(c.caX, c.caY + c.scDir*S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.5*S, color); addText(c.caX+20, c.caY+c.scDir*(1.5*S+10), 'OH (Hγ1)', color); break;
          case 'C': vNode(2, 'SH (Hγ)'); break;
          case 'M': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'S (Hδ)'); vNode(4, 'CH₃ (Hε)'); break;
          case 'D': vNode(2, 'C (Hγ)'); addLine(c.caX, c.caY+c.scDir*2*S, c.caX-20, c.caY+c.scDir*2.8*S, color); addText(c.caX-20, c.caY+c.scDir*(2.8*S+10), 'O⁻', color); addLine(c.caX, c.caY+c.scDir*2*S, c.caX+20, c.caY+c.scDir*2.8*S, color, true); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'O', color); break;
          case 'N': vNode(2, 'C (Hγ)'); addLine(c.caX, c.caY+c.scDir*2*S, c.caX-20, c.caY+c.scDir*2.8*S, color); addText(c.caX-20, c.caY+c.scDir*(2.8*S+10), 'NH₂ (Hδ2)', color); addLine(c.caX, c.caY+c.scDir*2*S, c.caX+20, c.caY+c.scDir*2.8*S, color, true); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'O', color); break;
          case 'E': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'C (Hδ)'); addLine(c.caX, c.caY+c.scDir*3*S, c.caX-20, c.caY+c.scDir*3.8*S, color); addText(c.caX-20, c.caY+c.scDir*(3.8*S+10), 'O⁻', color); addLine(c.caX, c.caY+c.scDir*3*S, c.caX+20, c.caY+c.scDir*3.8*S, color, true); addText(c.caX+20, c.caY+c.scDir*(3.8*S+10), 'O', color); break;
          case 'Q': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'C (Hδ)'); addLine(c.caX, c.caY+c.scDir*3*S, c.caX-20, c.caY+c.scDir*3.8*S, color); addText(c.caX-20, c.caY+c.scDir*(3.8*S+10), 'NH₂ (Hε2)', color); addLine(c.caX, c.caY+c.scDir*3*S, c.caX+20, c.caY+c.scDir*3.8*S, color, true); addText(c.caX+20, c.caY+c.scDir*(3.8*S+10), 'O', color); break;
          case 'K': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'CH₂ (Hδ)'); vNode(4, 'CH₂ (Hε)'); vNode(5, 'NH₃⁺ (Hζ)'); break;
          case 'R': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'CH₂ (Hδ)'); vNode(4, 'NH (Hε)'); vNode(5, 'C (Hζ)'); addLine(c.caX, c.caY+c.scDir*5*S, c.caX-20, c.caY+c.scDir*5.8*S, color); addText(c.caX-20, c.caY+c.scDir*(5.8*S+10), 'NH₂ (Hη1)', color); addLine(c.caX, c.caY+c.scDir*5*S, c.caX+20, c.caY+c.scDir*5.8*S, color, true); addText(c.caX+20, c.caY+c.scDir*(5.8*S+10), 'NH₂⁺ (Hη2)', color); break;
          case 'F':
          case 'Y': {
              addText(c.caX, c.caY + c.scDir*S, "CH₂ (Hβ)", color);
              const hcx = c.caX; const hcy = c.caY + c.scDir * 3 * S; const hPts = getHexagon(hcx, hcy, S, c.scDir);
              addLine(c.caX, c.caY + c.scDir*S, hPts[0].x, hPts[0].y, color); addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: hcx, y: hcy, r: S * 0.6, color: color, fill: 'none' });
              placeRadialLabel(hcx, hcy, hPts[1], 'CH (Hδ2)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hδ1)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hε1)', color);
              if (char === 'Y') { const angleZ = Math.atan2(hPts[3].y - hcy, hPts[3].x - hcx); const ohX = hPts[3].x + S * Math.cos(angleZ); const ohY = hPts[3].y + S * Math.sin(angleZ); addLine(hPts[3].x, hPts[3].y, ohX, ohY, color); placeRadialLabel(hPts[3].x, hPts[3].y, {x: ohX, y: ohY}, 'OH (Hη)', color); } else placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color);
              break;
          }
          case 'H': {
              addText(c.caX, c.caY + c.scDir*S, "CH₂ (Hβ)", color);
              const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
              addLine(c.caX, c.caY + c.scDir*S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: pcx, y: pcy, r: R5 * 0.5, color: color, fill: 'none' });
              addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color); addRingHeteroatom(pPts[4].x, pPts[4].y, "N", color);
              placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ2)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε2)', color); placeRadialLabel(pcx, pcy, pPts[3], 'CH (Hε1)', color);
              break;
          }
          case 'W': {
              addText(c.caX, c.caY + c.scDir*S, "CH₂ (Hβ)", color);
              const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
              addLine(c.caX, c.caY + c.scDir*S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: pcx, y: pcy, r: R5 * 0.5, color: color, fill: 'none' });
              const ce2 = pPts[3]; const cd2 = pPts[4]; const mx = (ce2.x + cd2.x) / 2; const my = (ce2.y + cd2.y) / 2;
              const midA = Math.atan2(my - pcy, mx - pcx); const hcx = mx + Math.cos(midA) * S * Math.sqrt(3)/2; const hcy = my + Math.sin(midA) * S * Math.sqrt(3)/2;
              const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx); const testA = startA + Math.PI/3; const sign = Math.hypot(hcx + S*Math.cos(testA) - cd2.x, hcy + S*Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
              const hPts = []; for(let j=0; j<6; j++) { const a = startA + j * sign * Math.PI/3; hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) }); }
              addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: hcx, y: hcy, r: S * 0.6, color: color, fill: 'none' });
              addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color);
              placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ1)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε1)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε3)', color); placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ3)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hη2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hζ2)', color);
              break;
          }
      }
      const labelY = c.caY + (c.scDir > 0 ? 170 : -170); addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14, 'middle');
  });

  const pad = 15; const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2*pad} ${maxY - minY + 2*pad}`;
  const svgWidth = Math.max(100, sequence.length * 15);

  return (
      <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
          <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
          <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0">
              <svg viewBox={viewBox} className={`h-auto font-sans ${isExpanded ? 'max-h-full' : 'max-h-[300px]'}`} style={{ minWidth: `${svgWidth}%` }}>
                  {elements.filter(e => e.type === 'line').map((el, idx) => <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth="1.8" />)}
                  {elements.filter(e => e.type === 'path').map((el, idx) => <path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth="1.8" />)}
                  {elements.filter(e => e.type === 'polygon').map((el, idx) => <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth="1.8" />)}
                  {elements.filter(e => e.type === 'circle').map((el, idx) => <circle key={`c${idx}`} cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : "1.5"} />)}
                  {elements.filter(e => e.type === 'text').map((el, idx) => (<g key={`t${idx}`}><text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text><text x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text></g>))}
              </svg>
          </div>
      </div>
      </>
  );
};


// --- 7. MAIN COMPONENT ---
export const NMRTestRenderer = ({ activeTest, updateActiveTest, TestHeader, datasetProtocols, jumpToProtocol }) => {
  const seq = (activeTest.proteinSequence || '').toUpperCase().replace(/[^A-Z]/g, '');
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const shifts = activeTest.chemicalShifts || {};
  const images = activeTest.nmrSpectraImages || [];
  const showSim = activeTest.showSpectraSimulation || false;
  const linkedProtocolId = activeTest.linkedProtocolId || '';
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const nucDefs = { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] };
  
  const handleShiftChange = (resIdx, atom, val) => updateActiveTest({ chemicalShifts: { ...shifts, [`${resIdx}-${atom}`]: val } });
  
  const parsedSeq = useMemo(() => {
    const upperSeq = seq.replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '');
    if (upperSeq.length === 0) return [];
    const assignedShifts = []; 
    return upperSeq.split('').map((char, index) => {
      const aa = AMINO_ACID_DB[char]; const generatedShifts = {};
      if(aa) {
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
      }
      const cShifts = {}; const generatedShifts13C = {};
      if(aa) {
        Object.keys(generatedShifts).forEach(atom => {
          const cName = getCarbonName(char, atom); if (!cName) return;
          if (!cShifts[cName]) { const range = getCarbonRange(char, cName); cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1)); }
          generatedShifts13C[atom] = cShifts[cName];
        });
      }
      return { ...aa, id: `${aa?.code3 || char}${index + 1}`, char: char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts } };
    });
  }, [seq]);

  const uniqueAminoAcidTypes = useMemo(() => [...new Set(parsedSeq.map(r => r.char))], [parsedSeq]);

  const { diagonalData, referenceRangesData, referenceRangesData13C, cosyPeaks, tocsyPeaks, noesyPeaks, hsqcPeaks, data1H, data13C } = useMemo(() => {
    let diag = [], ranges = [], ranges13C = [], cosy = [], tocsy = [], noesy = [], hsqc = [], d1H = [], d13C = [];
    const addPair = (arr, x, y, label, type, colorClass, size = 5) => { arr.push({ x, y, label, type, colorClass, size }); arr.push({ x: y, y: x, label, type, colorClass, size }); };
    
    uniqueAminoAcidTypes.forEach((char, index) => {
      const aa = AMINO_ACID_DB[char];
      if(!aa) return;
      const typeIndex = Object.keys(AMINO_ACID_DB).indexOf(char);
      const color = RESIDUE_COLORS[typeIndex % RESIDUE_COLORS.length];
      let atomIdx = 0;
      
      Object.keys(aa.ranges).forEach(atom => {
        const r = aa.ranges[atom];
        ranges.push({ x: (r.min + r.max) / 2, res: aa.code3, atom, min: r.min, max: r.max, y: uniqueAminoAcidTypes.length - 1 - index, color, level: atomIdx });
        atomIdx++;
      });
      
      const cNames = new Set();
      Object.keys(aa.ranges).forEach(atom => { const cName = getCarbonName(char, atom); if (cName) cNames.add(cName); });
      let cIdx = 0;
      
      cNames.forEach(cName => {
        const range = getCarbonRange(char, cName);
        ranges13C.push({ x: (range.min + range.max) / 2, res: aa.code3, atom: cName, min: range.min, max: range.max, y: uniqueAminoAcidTypes.length - 1 - index, color, level: cIdx });
        cIdx++;
      });
    });

    parsedSeq.forEach((res, index) => {
      if(!res.shifts) return;
      Object.entries(res.shifts).forEach(([atom, ppm]) => {
        let peaks = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        if(res.cosy) {
          res.cosy.forEach(pair => {
            let neighborAtom = pair[0] === atom ? pair[1] : (pair[1] === atom ? pair[0] : null);
            if (neighborAtom) {
              const count = getProtonCount(res.char, neighborAtom); totalNeighbors += count;
              const jC = 0.010 + Math.random() * 0.008; const pascalRow = getPascalRow(count);
              let newPeaks = []; peaks.forEach(p => { for(let k=0; k<=count; k++) newPeaks.push({ shift: p.shift + (k - count/2) * jC, intensity: p.intensity * pascalRow[k] }); });
              peaks = newPeaks;
            }
          });
        }
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
      if(res.cosy) res.cosy.forEach(([a1, a2]) => { if(res.shifts[a1] && res.shifts[a2]) addPair(cosy, res.shifts[a1], res.shifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4); });
      if(res.spinSystems) res.spinSystems.forEach(sys => { for(let i=0; i<sys.length; i++) for(let j=i+1; j<sys.length; j++) if(res.shifts[sys[i]] && res.shifts[sys[j]]) addPair(tocsy, res.shifts[sys[i]], res.shifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (TOCSY)`, 'tocsyDirect', 4); });
      
      const seenPairs = new Set();
      if(res.cosy) res.cosy.forEach(([a1, a2]) => { seenPairs.add([a1, a2].sort().join('-')); if(res.shifts[a1] && res.shifts[a2]) addPair(noesy, res.shifts[a1], res.shifts[a2], res.id, `${a1}-${a2} (NOE Intra 3)`, 'noesyIntra', 4); });
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
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 relative">
      {TestHeader}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        
        {/* 1. EXPERIMENTAL CONDITIONS E COMPOUND */}
        <CollapsibleSection title="Experimental Conditions" icon="🧪" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Compound</label><input type="text" value={activeTest.compound || ''} onChange={e => updateActiveTest({ compound: e.target.value })} className="w-full border border-blue-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500 bg-blue-50/30 font-bold text-blue-800" placeholder="e.g. Cmpd A" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Molecule Name</label><input type="text" value={activeTest.moleculeName || ''} onChange={e => updateActiveTest({ moleculeName: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. Ubiquitin" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Experiment Date</label><input type="date" value={activeTest.experimentDate || ''} onChange={e => updateActiveTest({ experimentDate: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Concentration</label><input type="text" value={activeTest.concentration || ''} onChange={e => updateActiveTest({ concentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 1 mM" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Solvent</label><input type="text" value={activeTest.solvent || ''} onChange={e => updateActiveTest({ solvent: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 90% H2O / 10% D2O" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Salt Concentration</label><input type="text" value={activeTest.saltConcentration || ''} onChange={e => updateActiveTest({ saltConcentration: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 50 mM NaCl" /></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Temperature</label><input type="text" value={activeTest.temperature || ''} onChange={e => updateActiveTest({ temperature: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-blue-500" placeholder="e.g. 298 K" /></div>
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

        {/* 8. LAB NOTEBOOK EXPORT */}
        <CollapsibleSection title="Lab Notebook Export" icon="📓" defaultOpen={false} className="no-print">
            {/* PROTOCOL LINKING */}
            <div className="mb-6 pb-4 border-b border-slate-100 flex items-center gap-4">
                <span className="text-[11px] font-bold text-slate-600 w-32">📋 Link Protocol:</span>
                <select 
                    value={linkedProtocolId} 
                    onChange={(e) => updateActiveTest({linkedProtocolId: e.target.value})}
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-slate-50 outline-none focus:border-blue-500 flex-1 cursor-pointer"
                >
                    <option value="">-- No Protocol Linked --</option>
                    {(datasetProtocols || []).map(p => (
                        <option key={p.id} value={p.id}>{p.title} ({p.category})</option>
                    ))}
                </select>
                {linkedProtocolId && (
                    <button 
                        onClick={() => jumpToProtocol(linkedProtocolId)}
                        className="text-xs text-white font-bold bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
                    >
                        📖 Open Protocol
                    </button>
                )}
            </div>

          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">Select the NMR data to format and append to the General Comments (which acts as the Lab Notebook entry).</p>
            <div className="flex flex-wrap gap-4 border border-slate-200 p-4 rounded-lg bg-white shadow-sm">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                  <input type="checkbox" id="nb-cond" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer"/> Experimental Conditions
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                  <input type="checkbox" id="nb-seq" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer"/> Sequence
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600">
                  <input type="checkbox" id="nb-table" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer"/> Shifts Table
              </label>
            </div>
            <button
              onClick={() => {
                let html = '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';
                html += '<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 NMR Data Summary</h4>';
                
                const cbCond = document.getElementById('nb-cond')?.checked;
                const cbSeq = document.getElementById('nb-seq')?.checked;
                const cbTable = document.getElementById('nb-table')?.checked;

                if (cbCond) {
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Compound:</b> ${activeTest.compound || 'N/A'} | <b>Molecule:</b> ${activeTest.moleculeName || 'N/A'} | <b>Solvent:</b> ${activeTest.solvent || 'N/A'} | <b>Temp:</b> ${activeTest.temperature || 'N/A'} | <b>Conc:</b> ${activeTest.concentration || 'N/A'}</p>`;
                }
                if (cbSeq) {
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>Sequence:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${activeTest.proteinSequence || 'N/A'}</span></p>`;
                }
                if (cbTable && Object.keys(shifts).length > 0) {
                  html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;">
                             <tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
                  Object.keys(shifts).forEach(key => {
                    const parts = key.split('-');
                    const resIdx = parts[0];
                    const atom = parts.slice(1).join('-');
                    const res = parsedSeq[resIdx];
                    if(res && shifts[key]) {
                       html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${shifts[key]}</td></tr>`;
                    }
                  });
                  html += `</table>`;
                }
                html += '</div>';
                
                const currentComments = activeTest.comments || '';
                updateActiveTest({ comments: currentComments + (currentComments ? '<br/>' : '') + html });
                alert("Data appended successfully to the notes! They will now be visible in the Lab Notebook.");
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-lg transition-all shadow-sm w-fit border border-indigo-700 flex items-center gap-2"
            >
              <span>+</span> Append Data to Lab Notebook
            </button>
          </div>
        </CollapsibleSection>

      </div>
    </div>
  );
};

export default NMRTestRenderer;
