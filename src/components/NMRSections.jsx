import NMRMoleculeViewer from './NMRMoleculeViewer';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceLine, BarChart, Bar, LineChart, Line, Legend, ErrorBar, Cell
} from 'recharts';

const HAS_EB = typeof ErrorBar !== 'undefined';
const LINE_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16'];
const TICKS_13C = Array.from({ length: 421 }, (_, i) => parseFloat((10 + i * 0.5).toFixed(1)));
const TICKS_15N = Array.from({ length: 81 }, (_, i) => parseFloat((95 + i * 0.5).toFixed(1)));
const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
const FS_CLASSES = 'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';
const SELECT_COLOR = '#f59e0b';
const MANUAL_COLOR = '#16a34a';
const CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
const CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}>
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {headerExtra && <div onClick={(e) => e.stopPropagation()}>{headerExtra}</div>}
          <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// ================= DATABASES =================
const AMINO_ACID_DB = {
  A: { name: 'Alanine', code3: 'Ala', atoms: ['HN', 'Hα', 'Hβ'], ranges: { HN: { min: 7.8, max: 8.6 }, Hα: { min: 4.0, max: 4.5 }, Hβ: { min: 1.2, max: 1.5 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ']], spinSystems: [['HN', 'Hα', 'Hβ']] },
  C: { name: 'Cysteine', code3: 'Cys', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.8 }, Hβ1: { min: 2.8, max: 3.3 }, Hβ2: { min: 2.8, max: 3.3 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  D: { name: 'Aspartic Acid', code3: 'Asp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.5, max: 2.9 }, Hβ2: { min: 2.5, max: 2.9 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  E: { name: 'Glutamic Acid', code3: 'Glu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ'], ranges: { HN: { min: 8.0, max: 8.7 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.1, max: 2.5 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ']] },
  F: { name: 'Phenylalanine', code3: 'Phe', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε', 'Hζ'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.9, max: 3.3 }, Hβ2: { min: 2.9, max: 3.3 }, Hδ: { min: 7.1, max: 7.4 }, Hε: { min: 7.2, max: 7.5 }, Hζ: { min: 7.1, max: 7.4 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε'], ['Hε', 'Hζ']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε', 'Hζ']] },
  G: { name: 'Glycine', code3: 'Gly', atoms: ['HN', 'Hα1', 'Hα2'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα1: { min: 3.8, max: 4.1 }, Hα2: { min: 3.8, max: 4.1 } }, cosy: [['HN', 'Hα1'], ['HN', 'Hα2'], ['Hα1', 'Hα2']], spinSystems: [['HN', 'Hα1', 'Hα2']] },
  H: { name: 'Histidine', code3: 'His', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ2', 'Hε1'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.0, max: 3.4 }, Hβ2: { min: 3.0, max: 3.4 }, Hδ2: { min: 6.9, max: 7.3 }, Hε1: { min: 7.6, max: 8.1 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']] },
  I: { name: 'Isoleucine', code3: 'Ile', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1'], ranges: { HN: { min: 7.7, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.7, max: 2.0 }, Hγ1: { min: 1.1, max: 1.6 }, Hγ2: { min: 0.8, max: 1.1 }, Hδ1: { min: 0.7, max: 1.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2'], ['Hγ1', 'Hδ1']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1']] },
  K: { name: 'Lysine', code3: 'Lys', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε', 'Hζ(NH3)'], ranges: { HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 1.9 }, Hγ: { min: 1.3, max: 1.6 }, Hδ: { min: 1.5, max: 1.8 }, Hε: { min: 2.8, max: 3.2 }, 'Hζ(NH3)': { min: 7.2, max: 7.6 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε'], ['Hε', 'Hζ(NH3)']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ['Hζ(NH3)']] },
  L: { name: 'Leucine', code3: 'Leu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2'], ranges: { HN: { min: 7.9, max: 8.5 }, Hα: { min: 4.2, max: 4.7 }, Hβ: { min: 1.5, max: 1.9 }, Hγ: { min: 1.4, max: 1.8 }, Hδ1: { min: 0.8, max: 1.0 }, Hδ2: { min: 0.8, max: 1.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ1'], ['Hγ', 'Hδ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2']] },
  M: { name: 'Methionine', code3: 'Met', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε(CH3)'], ranges: { HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.3, max: 4.7 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.4, max: 2.7 }, 'Hε(CH3)': { min: 2.0, max: 2.2 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε(CH3)']] },
  N: { name: 'Asparagine', code3: 'Asn', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ21', 'Hδ22'], ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.6, max: 3.0 }, Hβ2: { min: 2.6, max: 3.0 }, Hδ21: { min: 6.8, max: 7.2 }, Hδ22: { min: 7.4, max: 7.8 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']] },
  P: { name: 'Proline', code3: 'Pro', atoms: ['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2'], ranges: { Hα: { min: 4.2, max: 4.6 }, Hβ1: { min: 1.8, max: 2.4 }, Hβ2: { min: 1.8, max: 2.4 }, Hγ1: { min: 1.8, max: 2.1 }, Hγ2: { min: 1.8, max: 2.1 }, Hδ1: { min: 3.4, max: 3.8 }, Hδ2: { min: 3.4, max: 3.8 } }, cosy: [['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hβ1', 'Hγ1'], ['Hβ2', 'Hγ2'], ['Hγ1', 'Hγ2'], ['Hγ1', 'Hδ1'], ['Hγ2', 'Hδ2'], ['Hδ1', 'Hδ2']], spinSystems: [['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2']] },
  Q: { name: 'Glutamine', code3: 'Gln', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε21', 'Hε22'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.2, max: 2.6 }, Hε21: { min: 6.7, max: 7.1 }, Hε22: { min: 7.3, max: 7.7 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hε21', 'Hε22']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε21', 'Hε22']] },
  R: { name: 'Arginine', code3: 'Arg', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 2.0 }, Hγ: { min: 1.4, max: 1.8 }, Hδ: { min: 3.0, max: 3.3 }, Hε: { min: 7.0, max: 7.4 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ'], ['Hε']] },
  S: { name: 'Serine', code3: 'Ser', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'], ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.3, max: 4.8 }, Hβ1: { min: 3.7, max: 4.0 }, Hβ2: { min: 3.7, max: 4.0 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']] },
  T: { name: 'Threonine', code3: 'Thr', atoms: ['HN', 'Hα', 'Hβ', 'Hγ2'], ranges: { HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.2, max: 4.6 }, Hβ: { min: 4.0, max: 4.4 }, Hγ2: { min: 1.0, max: 1.3 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ2']] },
  V: { name: 'Valine', code3: 'Val', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2'], ranges: { HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.9, max: 2.3 }, Hγ1: { min: 0.8, max: 1.1 }, Hγ2: { min: 0.8, max: 1.1 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2']] },
  W: { name: 'Tryptophan', code3: 'Trp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ1', 'Hε3', 'Hζ2', 'Hη2', 'Hζ3'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.1, max: 3.5 }, Hβ2: { min: 3.1, max: 3.5 }, Hδ1: { min: 10.0, max: 10.5 }, Hε3: { min: 7.4, max: 7.7 }, Hζ2: { min: 7.3, max: 7.6 }, Hη2: { min: 7.0, max: 7.3 }, Hζ3: { min: 6.9, max: 7.2 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ1', 'Hε3'], ['Hε3', 'Hζ3'], ['Hζ3', 'Hη2'], ['Hη2', 'Hζ2']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ1'], ['Hε3', 'Hζ3', 'Hη2', 'Hζ2']] },
  Y: { name: 'Tyrosine', code3: 'Tyr', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε'], ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.8, max: 3.2 }, Hβ2: { min: 2.8, max: 3.2 }, Hδ: { min: 6.9, max: 7.2 }, Hε: { min: 6.6, max: 6.9 } }, cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε']], spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε']] }
};
const NUCLEOTIDE_DB = {
  DNA: {
    A: { name: 'Deoxyadenosine', code3: 'dA', base: 'purine', atoms: ['H8', 'H2', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.9, max: 8.4 }, H2: { min: 7.7, max: 8.3 }, "H1'": { min: 5.9, max: 6.4 }, "H2'": { min: 2.2, max: 2.8 }, "H2''": { min: 2.5, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.1, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]] },
    G: { name: 'Deoxyguanosine', code3: 'dG', base: 'purine', atoms: ['H8', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.6, max: 8.2 }, "H1'": { min: 5.6, max: 6.2 }, "H2'": { min: 2.2, max: 2.8 }, "H2''": { min: 2.5, max: 3.0 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]] },
    C: { name: 'Deoxycytidine', code3: 'dC', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.3, max: 8.0 }, H5: { min: 5.2, max: 5.9 }, "H1'": { min: 5.8, max: 6.4 }, "H2'": { min: 2.0, max: 2.7 }, "H2''": { min: 2.2, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] },
    T: { name: 'Thymidine', code3: 'T', base: 'pyrimidine', atoms: ['H6', 'H7(CH3)', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.2, max: 7.9 }, 'H7(CH3)': { min: 1.6, max: 2.0 }, "H1'": { min: 5.9, max: 6.4 }, "H2'": { min: 1.9, max: 2.5 }, "H2''": { min: 2.1, max: 2.7 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 } }, cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H7(CH3)']] }
  },
  RNA: {
    A: { name: 'Adenosine', code3: 'A', base: 'purine', atoms: ['H8', 'H2', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.9, max: 8.5 }, H2: { min: 7.8, max: 8.4 }, "H1'": { min: 5.7, max: 6.2 }, "H2'": { min: 4.4, max: 4.9 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.1, max: 4.6 }, "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 } }, cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]] },
    G: { name: 'Guanosine', code3: 'G', base: 'purine', atoms: ['H8', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H8: { min: 7.6, max: 8.3 }, "H1'": { min: 5.5, max: 6.1 }, "H2'": { min: 4.3, max: 4.9 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.0, max: 4.6 }, "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 } }, cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]] },
    C: { name: 'Cytidine', code3: 'C', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.6, max: 6.2 }, "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] },
    U: { name: 'Uridine', code3: 'U', base: 'pyrimidine', atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"], ranges: { H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.4, max: 6.0 }, "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.1, max: 4.7 }, "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 } }, cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]], spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']] }
  }
};
const SUGAR_DB = {
  GLC: { name: 'D-Glucose', code3: 'Glc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.55, max: 5.25 }, H2: { min: 3.4, max: 3.7 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.35, max: 3.65 }, H5: { min: 3.55, max: 3.85 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  GAL: { name: 'D-Galactose', code3: 'Gal', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.55, max: 5.25 }, H2: { min: 3.5, max: 3.85 }, H3: { min: 3.6, max: 3.95 }, H4: { min: 3.85, max: 4.15 }, H5: { min: 3.7, max: 4.0 }, H6a: { min: 3.6, max: 3.9 }, H6b: { min: 3.65, max: 3.95 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  MAN: { name: 'D-Mannose', code3: 'Man', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ranges: { H1: { min: 4.7, max: 5.2 }, H2: { min: 3.7, max: 4.0 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.55, max: 3.85 }, H5: { min: 3.6, max: 3.95 }, H6a: { min: 3.6, max: 3.95 }, H6b: { min: 3.65, max: 4.0 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']] },
  FUC: { name: 'L-Fucose', code3: 'Fuc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'], ranges: { H1: { min: 4.7, max: 5.2 }, H2: { min: 3.6, max: 3.95 }, H3: { min: 3.65, max: 4.0 }, H4: { min: 3.7, max: 4.05 }, H5: { min: 3.6, max: 3.95 }, H6: { min: 1.1, max: 1.3 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6']] },
  NAG: { name: 'N-Acetylglucosamine', code3: 'GlcNAc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b', 'NHAc', 'AcCH3'], ranges: { H1: { min: 4.6, max: 5.2 }, H2: { min: 3.7, max: 4.05 }, H3: { min: 3.6, max: 3.9 }, H4: { min: 3.4, max: 3.7 }, H5: { min: 3.6, max: 3.9 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 }, NHAc: { min: 7.5, max: 8.2 }, AcCH3: { min: 1.9, max: 2.1 } }, cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']], spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ['NHAc'], ['AcCH3']] }
};
const LIPID_DB = {
  POPC: { name: 'POPC', head: 'PC', headLabel: 'N(CH₃)₃⁺', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2N', 'HNMe3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2N: { min: 3.6, max: 3.8 }, HNMe3: { min: 3.18, max: 3.28 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2N', 'HNMe3']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2N', 'HNMe3']] },
  POPE: { name: 'POPE', head: 'PE', headLabel: 'NH₃⁺', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2N', 'HNH3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2N: { min: 3.1, max: 3.3 }, HNH3: { min: 7.5, max: 8.5 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2N', 'HNH3']] },
  POPS: { name: 'POPS', head: 'PS', headLabel: 'Ser', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HαS', 'HβS1', 'HβS2', 'HNH3'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HαS: { min: 4.0, max: 4.3 }, HβS1: { min: 3.75, max: 4.05 }, HβS2: { min: 3.75, max: 4.05 }, HNH3: { min: 7.5, max: 8.5 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HαS', 'HβS1'], ['HαS', 'HβS2']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HαS', 'HβS1', 'HβS2', 'HNH3']] },
  POPG: { name: 'POPG', head: 'PG', headLabel: 'Gly', atoms: ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1', 'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2', 'HCH2OH', 'HCHOH'], ranges: { Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 }, Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 }, 'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 }, 'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 }, 'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 }, 'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 }, HCH2OH: { min: 3.45, max: 3.75 }, HCHOH: { min: 3.65, max: 3.9 } }, cosy: [['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'], ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'], ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2OH', 'HCHOH']], spinSystems: [['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'], ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'], ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'], ['HCH2OH', 'HCHOH']] }
};
const CARBON_RANGE_DB = {
  A: { Cα: [49.5, 53.5], Cβ: [15.5, 20.5] }, C: { Cα: [54.5, 60], Cβ: [26, 32] }, D: { Cα: [50, 55], Cβ: [37, 42], Cγ: [173, 178] }, E: { Cα: [53, 58], Cβ: [26, 31], Cγ: [32, 37], Cδ: [176, 181] },
  F: { Cα: [53, 58.5], Cβ: [35, 41], Cγ: [133, 139], Cδ: [126.5, 132], Cε: [126, 131.5], Cζ: [124, 129.5] }, G: { Cα: [41, 46] }, H: { Cα: [51.5, 57], Cβ: [27, 33], Cδ2: [114, 120], Cε1: [131, 138] },
  I: { Cα: [57, 62.5], Cβ: [34, 39.5], Cγ1: [23, 29], Cγ2: [13.5, 19], Cδ1: [9, 14.5] }, K: { Cα: [53, 58.5], Cβ: [29, 34.5], Cγ: [21, 26.5], Cδ: [26, 31.5], Cε: [38.5, 43.5] },
  L: { Cα: [51, 56.5], Cβ: [38, 44], Cγ: [22.5, 28], Cδ1: [20, 25.5], Cδ2: [20, 25.5] }, M: { Cα: [51.5, 57], Cβ: [28, 33.5], Cγ: [13, 18.5], Cε: [12.5, 18] },
  N: { Cα: [49.5, 54.5], Cβ: [35, 40], Cγ: [171, 176] }, P: { Cα: [58, 64], Cβ: [27.5, 33.5], Cγ: [22.5, 28.5], Cδ: [45, 51.5] }, Q: { Cα: [52.5, 57.5], Cβ: [26, 31], Cγ: [30, 35], Cδ: [173, 178] },
  R: { Cα: [53, 58], Cβ: [27, 32], Cγ: [23, 28], Cδ: [39, 44], Cζ: [155, 160] }, S: { Cα: [53.5, 60], Cβ: [59.5, 66.5] }, T: { Cα: [56.5, 64], Cβ: [64.5, 72.5], Cγ2: [17.5, 23.5] },
  V: { Cα: [57.5, 64], Cβ: [28.5, 34.5], Cγ1: [16.5, 22.5], Cγ2: [16.5, 22.5] }, W: { Cα: [53.5, 59], Cβ: [25.5, 32], Cδ1: [119, 126], Cε3: [115, 121], Cζ2: [115, 122], Cη2: [117, 124], Cζ3: [115, 122] },
  Y: { Cα: [53, 58.5], Cβ: [34.5, 41], Cγ: [125.5, 131.5], Cδ: [128, 134], Cε: [112.5, 118.5], Cζ: [151, 158] }
};
const SS_CORRECTIONS = {
  coil: { h: {}, c: {} },
  helix: { h: { HN: -0.45, Hα: -0.35, Hα1: -0.35, Hα2: -0.35, other: -0.05 }, c: { Cα: 2.8, Cβ: -1.5, "C'": -1.3, N: -2.5 } },
  sheet: { h: { HN: 0.4, Hα: 0.3, Hα1: 0.3, Hα2: 0.3, other: 0.05 }, c: { Cα: -1.6, Cβ: 1.4, "C'": 1.5, N: 2.0 } }
};
const RANDOM_COIL_DB = { A: { HA: 4.35, CA: 52.5, CB: 19.1, CO: 177.8 }, C: { HA: 4.55, CA: 58.2, CB: 28.0, CO: 175.9 }, D: { HA: 4.76, CA: 54.5, CB: 40.8, CO: 177.5 }, E: { HA: 4.37, CA: 56.9, CB: 29.8, CO: 177.6 }, F: { HA: 4.66, CA: 57.9, CB: 39.8, CO: 177.4 }, G: { HA: 3.96, CA: 45.2, CB: null, CO: 174.6 }, H: { HA: 4.76, CA: 55.3, CB: 31.3, CO: 175.3 }, I: { HA: 4.20, CA: 61.3, CB: 38.3, CO: 177.8 }, K: { HA: 4.38, CA: 56.6, CB: 32.4, CO: 177.9 }, L: { HA: 4.47, CA: 55.4, CB: 41.9, CO: 178.9 }, M: { HA: 4.52, CA: 55.5, CB: 32.6, CO: 177.5 }, N: { HA: 4.75, CA: 53.3, CB: 38.6, CO: 176.6 }, P: { HA: 4.44, CA: 63.1, CB: 31.9, CO: 178.1 }, Q: { HA: 4.39, CA: 56.2, CB: 29.5, CO: 177.2 }, R: { HA: 4.51, CA: 56.5, CB: 30.4, CO: 177.2 }, S: { HA: 4.51, CA: 58.4, CB: 63.6, CO: 175.6 }, T: { HA: 4.39, CA: 62.0, CB: 69.6, CO: 175.7 }, V: { HA: 4.16, CA: 62.1, CB: 32.1, CO: 177.4 }, W: { HA: 4.70, CA: 57.4, CB: 29.5, CO: 177.2 }, Y: { HA: 4.66, CA: 57.9, CB: 38.9, CO: 177.2 } };
const SS_META = { C: { label: 'Random coil', color: '#64748b' }, H: { label: 'α-Helix', color: '#8b5cf6' }, E: { label: 'β-Sheet', color: '#f59e0b' } };
const FORM_META = { A: { label: 'A-form', color: '#0ea5e9' }, B: { label: 'B-form', color: '#22c55e' }, Z: { label: 'Z-form', color: '#f43f5e' } };
const DNA_FORM_OFFSETS = { B: { "H1'": 0, "H2'": 0, "H3'": 0, "H2''": 0 }, A: { "H1'": 0.2, "H2'": -0.3, "H3'": 0.15, "H2''": -0.25 }, Z: { "H1'": -0.15, "H2'": 0.25, "H3'": -0.1, "H2''": 0.2 } };
const SUGAR_ANOMER_OFFSETS = { alpha: { H1: 0.25 }, beta: { H1: -0.15 } };
const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#6366f1'];

// ================= GENERIC HELPERS =================
const useMeasureWidth = () => {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const u = () => setW(el.clientWidth);
    u();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(u); ro.observe(el); }
    window.addEventListener('resize', u);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', u); };
  }, []);
  return [ref, w];
};
const parseManual = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const getNMRFillColor = (entry) => {
  if (entry.colorClass === 'cosy') return '#22c55e';
  if (entry.colorClass === 'tocsyDirect') return '#1e3a8a';
  if (entry.colorClass === 'tocsyRelay') return '#3b82f6';
  if (entry.colorClass === 'noesyIntra') return '#ef4444';
  if (entry.colorClass === 'noesyIntra4') return '#fca5a5';
  if (entry.colorClass === 'noesySeq') return '#991b1b';
  if (entry.colorClass === 'hsqc') return '#8b5cf6';
  if (entry.colorClass === 'hsqc15n') return '#0ea5e9';
  if (entry.colorClass === 'p31') return '#0d9488';
  return '#cbd5e1';
};
const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') || atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')) return null;
  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
    return cName;
  }
  if (molType === 'dna' || molType === 'rna') return atom.replace('H', 'C');
  if (molType === 'sugar') return atom.replace('H', 'C').replace(/[ab]$/, '');
  if (molType === 'lipid') {
    const map = { Hsn1a: 'Csn1', Hsn1b: 'Csn1', Hsn2: 'Csn2', Hsn3a: 'Csn3', Hsn3b: 'Csn3', 'H2-sn1': 'C2-sn1', 'H3-sn1': 'C3-sn1', 'H4-sn1': 'C4-sn1', 'H16-sn1': 'C16-sn1', 'H2-sn2': 'C2-sn2', 'H3-sn2': 'C3-sn2', 'H4-sn2': 'C4-sn2', 'Hall-sn2': 'Call-sn2', 'H9-sn2': 'C9-sn2', 'H10-sn2': 'C10-sn2', 'H11-sn2': 'C11-sn2', 'H18-sn2': 'C18-sn2', HCH2N: 'CCH2N', HNMe3: 'CNMe3', HNH3: null, HαS: 'CαS', HβS1: 'CβS', HβS2: 'CβS', HCH2OH: 'CCH2OH', HCHOH: 'CCHOH' };
    return map[atom] !== undefined ? map[atom] : atom.replace('H', 'C');
  }
  return atom.replace('H', 'C');
};
const buildKeys = (ri, tokens, molType, char) => {
  const set = new Set();
  (tokens || []).forEach((tok) => {
    const variants = new Set([tok]);
    if (/\d$/.test(tok)) {
      [1, 2].forEach((n) => variants.add(tok + n));
      const stripped = tok.replace(/\d+$/, '');
      if (stripped !== tok && stripped.length > 1) variants.add(stripped);
    }
    variants.forEach((v) => {
      set.add(`${ri}-${v}`);
      if (v.startsWith('H')) { const c = getCarbonName(molType, char, v); if (c) set.add(`${ri}-${c}`); }
    });
  });
  return [...set];
};
const getProtonCountEx = (molType, res, atom) => {
  if (molType === 'protein') {
    const char = res.char;
    if (char === 'A' && atom === 'Hβ') return 3;
    if (char === 'V' && (atom === 'Hγ1' || atom === 'Hγ2')) return 3;
    if (char === 'L' && (atom === 'Hδ1' || atom === 'Hδ2')) return 3;
    if (char === 'I' && (atom === 'Hγ2' || atom === 'Hδ1')) return 3;
    if (char === 'T' && atom === 'Hγ2') return 3;
    if (char === 'M' && atom === 'Hε(CH3)') return 3;
    return 1;
  }
  if (molType === 'dna' || molType === 'rna') return atom.includes('CH3') ? 3 : 1;
  if (molType === 'sugar') return atom === 'AcCH3' ? 3 : 1;
  if (molType === 'lipid') {
    const map = { 'H4-sn1': 20, 'H4-sn2': 12, 'Hall-sn2': 4, HNMe3: 9, HCH2N: 2, HCH2OH: 2, 'H16-sn1': 3, 'H18-sn2': 3 };
    return map[atom] ?? 1;
  }
  return 1;
};
const getPascalRow = (n) => {
  if (n === 0) return [1];
  let row = [1];
  for (let i = 0; i < n; i++) {
    const nextRow = [1];
    for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j + 1]);
    nextRow.push(1);
    row = nextRow;
  }
  return row;
};
const getCarbonRangeFor = (molType, char, cName) => {
  if (!cName) return { min: 40, max: 50 };
  if (molType === 'protein') {
    if (cName === "C'") return { min: 171, max: 178 };
    const r = CARBON_RANGE_DB[char]?.[cName];
    if (r) return { min: r[0], max: r[1] };
    return { min: 40, max: 60 };
  }
  if (molType === 'dna' || molType === 'rna') {
    if (cName.includes("C1'")) return { min: 80, max: 90 };
    if (cName.includes("C2'")) return molType === 'dna' ? { min: 35, max: 42 } : { min: 68, max: 77 };
    if (cName.includes("C3'")) return { min: 68, max: 77 };
    if (cName.includes("C4'")) return { min: 78, max: 87 };
    if (cName.includes("C5'")) return { min: 59, max: 67 };
    if (cName === 'C8' || cName === 'C6') return { min: 134, max: 146 };
    if (cName === 'C2') return { min: 147, max: 156 };
    if (cName === 'C5') return { min: 98, max: 108 };
    if (cName === 'C7(CH3)') return { min: 10, max: 16 };
    return { min: 110, max: 160 };
  }
  if (molType === 'sugar') {
    if (cName === 'C1') return { min: 92, max: 105 };
    if (cName === 'C6') return char === 'FUC' ? { min: 14, max: 18 } : { min: 60, max: 64 };
    if (cName === 'C2') return char === 'NAG' ? { min: 54, max: 59 } : { min: 68, max: 76 };
    if (cName === 'CH3') return { min: 21, max: 25 };
    return { min: 66, max: 77 };
  }
  if (molType === 'lipid') {
    if (cName === 'C9-sn2' || cName === 'C10-sn2') return { min: 127, max: 132 };
    if (cName === 'CCH2N' || cName === 'CNMe3') return { min: 52, max: 61 };
    if (cName === 'C16-sn1' || cName === 'C18-sn2') return { min: 13, max: 15 };
    if (cName === 'C2-sn1' || cName === 'C2-sn2') return { min: 33, max: 36 };
    if (cName === 'C4-sn1' || cName === 'C4-sn2') return { min: 28, max: 31 };
    if (cName === 'Call-sn2' || cName === 'C11-sn2') return { min: 26, max: 29 };
    if (cName === 'Csn1' || cName === 'Csn2' || cName === 'Csn3') return { min: 61, max: 68 };
    return { min: 28, max: 32 };
  }
  return { min: 40, max: 60 };
};

// ================= INSTANCES (top-of-page) & PARAMETER LAYERS =================
const EXPERIMENTAL_CONDITION_FIELDS = [
  { key: 'temperature', label: 'Temperature' },
  { key: 'ph', label: 'pH' },
  { key: 'concentration', label: 'Concentration' },
  { key: 'ratio', label: 'Ratio' },
  { key: 'saltConcentration', label: 'Salt Concentration' },
  { key: 'solvent', label: 'Solvent' },
  { key: 'otherMolecule', label: 'Other Molecule' }
];
const getExperimentalFields = (ctx) => {
  const merged = [...EXPERIMENTAL_CONDITION_FIELDS];
  const extra = Array.isArray(ctx?.experimentalFields) ? ctx.experimentalFields : [];
  extra.forEach((f) => {
    const item = typeof f === 'string' ? { key: f, label: f } : f;
    if (item && item.key && !merged.some((m) => m.key === item.key)) merged.push(item);
  });
  return merged;
};
const getExpValue = (inst, key) => {
  const t = inst?.test || {};
  if (t[key] !== undefined && t[key] !== '') return t[key];
  if (t.exp && t.exp[key] !== undefined && t.exp[key] !== '') return t.exp[key];
  if (t.expValues && t.expValues[key] !== undefined && t.expValues[key] !== '') return t.expValues[key];
  return '';
};
const normalizeInstance = (t, idx) => ({
  id: t.id || `inst_${idx}`,
  name: t.instanceName || t.name || `Instance ${idx + 1}`,
  test: t
});
const getInstances = (ctx, activeTest) => {
  let list = null;
  if (ctx) {
    if (typeof ctx.getInstances === 'function') { try { list = ctx.getInstances(); } catch { list = null; } }
    if (!list && Array.isArray(ctx.instances) && ctx.instances.length) list = ctx.instances;
    if (!list && Array.isArray(ctx.siblings) && ctx.siblings.length) list = ctx.siblings;
    if (!list && (Array.isArray(ctx.tests) || Array.isArray(ctx.allTests))) {
      const all = ctx.tests || ctx.allTests;
      list = activeTest.name ? all.filter((t) => t && t.name === activeTest.name) : all;
    }
  }
  if (!list || !list.length) list = [activeTest];
  let insts = list.filter(Boolean).map(normalizeInstance);
  insts = insts.map((inst) => (inst.id === activeTest.id ? normalizeInstance(activeTest, 0) : inst));
  if (!insts.some((i) => i.id === activeTest.id)) insts.unshift(normalizeInstance(activeTest, 0));
  insts.sort((a, b) => String(a.test.date || '').localeCompare(String(b.test.date || '')));
  return insts;
};
const CHEMICAL_SHIFT_LAYER = { key: 'cs', label: 'Chemical Shift', unit: 'ppm', builtin: true };
const makeLayerId = () => `layer_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const getLayers = (activeTest) => [CHEMICAL_SHIFT_LAYER, ...(Array.isArray(activeTest.parameterLayers) ? activeTest.parameterLayers : [])];
const getActiveLayerKey = (activeTest) => activeTest.activeLayerKey || 'cs';
const instanceLayerValues = (inst, layerKey) => {
  const t = inst?.test || {};
  const nv = t.nmrValues || t.values;
  if (nv && nv[layerKey]) return nv[layerKey];
  if (layerKey === 'cs') return t.chemicalShifts || {};
  return {};
};
const getInstanceValues = (inst, isActive, activeTest, layerKey) => {
  let base = instanceLayerValues(inst, layerKey);
  if (isActive) {
    const overlay = (activeTest.nmrValues || {})[layerKey];
    if (overlay) base = { ...base, ...overlay };
  }
  return base;
};
const writeCellValue = (activeTest, updateActiveTest, layerKey, atomKey, value) => {
  const nv = { ...(activeTest.nmrValues || {}) };
  nv[layerKey] = { ...(nv[layerKey] || {}), [atomKey]: value };
  updateActiveTest({ nmrValues: nv });
};
const ensureLayers = (activeTest, updateActiveTest, wanted) => {
  const layers = [...(activeTest.parameterLayers || [])];
  const map = {};
  wanted.forEach((w) => {
    const ex = layers.find((l) => l.label.toLowerCase() === w.label.toLowerCase());
    if (ex) map[w.key] = ex.key;
    else { const nl = { key: makeLayerId(), label: w.label, unit: w.unit || '' }; layers.push(nl); map[w.key] = nl.key; }
  });
  updateActiveTest({ parameterLayers: layers });
  return map;
};

// ================= SELECTION HELPERS =================
const getSelectedKeys = (activeTest) => (Array.isArray(activeTest.selectedAtomKeys) && activeTest.selectedAtomKeys.length ? activeTest.selectedAtomKeys : null);
const selectionLabel = (d, selectedKeys) => {
  if (!selectedKeys || !selectedKeys.length) return '';
  const ri = parseInt(selectedKeys[0].split('-')[0], 10);
  const res = d.parsedSeq[ri];
  const atoms = [...new Set(selectedKeys.map((k) => k.split('-').slice(1).join('-')))];
  return `${res ? res.id : `#${ri + 1}`}: ${atoms.join(', ')}`;
};
const getManualKeys = (values) => {
  const out = new Set();
  Object.entries(values || {}).forEach(([k, v]) => {
    if (parseManual(v) === null) return;
    out.add(k);
    const idx = k.split('-')[0];
    const atom = k.slice(idx.length + 1);
    out.add(`${idx}-${atom.trim()}`);
    out.add(`${idx}-${atom.replace(/\s+/g, '')}`);
  });
  return [...out];
};
const opLabel = (op) => (typeof op === 'string' ? op : `${op?.name || ''} ${op?.surname || ''}`.trim());

// ================= FITTING ENGINE =================
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
  return M.map((r, i) => r[n] / r[i][i]);
};
const tokenizeExpr = (s) => {
  const t = []; let i = 0;
  const D = (c) => /[0-9.]/.test(c), A = (c) => /[a-zA-Z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (D(c)) { let j = i; while (j < s.length && D(s[j])) j++; t.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue; }
    if (A(c)) { let j = i; while (j < s.length && (A(s[j]) || /[0-9]/.test(s[j]))) j++; t.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    if ('+-/^(),*'.includes(c)) { t.push({ t: c }); i++; continue; }
    throw new Error('bad');
  }
  return t;
};
const parseExpression = (src) => {
  const tk = tokenizeExpr(src); let p = 0;
  const pk = () => tk[p];
  const eat = (t) => { if (!tk[p] || tk[p].t !== t) throw new Error('exp'); return tk[p++]; };
  const add = () => { let n = mul(); while (pk() && (pk().t === '+' || pk().t === '-')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: mul() }; } return n; };
  const mul = () => { let n = un(); while (pk() && (pk().t === '*' || pk().t === '/')) { const o = eat(pk().t).t; n = { type: 'bin', op: o, l: n, r: un() }; } return n; };
  const un = () => { if (pk() && pk().t === '-') { eat('-'); return { type: 'un', a: un() }; } if (pk() && pk().t === '+') { eat('+'); return un(); } return pw(); };
  const pw = () => { let n = pr(); if (pk() && pk().t === '^') { eat('^'); n = { type: 'bin', op: '^', l: n, r: un() }; } return n; };
  const pr = () => {
    const t = pk(); if (!t) throw new Error('exp');
    if (t.t === 'num') { eat('num'); return { type: 'num', v: t.v }; }
    if (t.t === 'id') { eat('id'); if (pk() && pk().t === '(') { eat('('); const a = [add()]; while (pk() && pk().t === ',') { eat(','); a.push(add()); } eat(')'); return { type: 'call', name: t.v, args: a }; } return { type: 'sym', name: t.v }; }
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
    case 'bin': { const a = evalAST(n.l, s), b = evalAST(n.r, s); return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b); }
    case 'call': {
      const a = n.args.map((x) => evalAST(x, s));
      switch (n.name) {
        case 'exp': return Math.exp(a[0]); case 'log': return Math.log10(a[0]); case 'ln': return Math.log(a[0]);
        case 'sqrt': return Math.sqrt(a[0]); case 'sin': return Math.sin(a[0]); case 'cos': return Math.cos(a[0]);
        case 'tan': return Math.tan(a[0]); case 'abs': return Math.abs(a[0]); case 'pow': return Math.pow(a[0], a[1]);
        case 'min': return Math.min(...a); case 'max': return Math.max(...a);
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
export const fitGeneric = (pts, f0, P0) => {
  let P = [...P0];
  const f = (x, Pv) => f0(x, Pv);
  const ssr = (Pv) => { let s = 0; for (const p of pts) { const v = f(p.x, Pv); if (!isFinite(v)) return Infinity; const w = p.w || 1; s += w * (p.y - v) ** 2; } return s; };
  let lam = 1e-3, cur = ssr(P);
  for (let it = 0; it < 120 && isFinite(cur); it++) {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) { const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4); row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h); }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0)), g = P.map(() => 0);
    pts.forEach((p, i) => {
      const w = p.w || 1; const r = p.y - f(p.x, P);
      for (let a = 0; a < P.length; a++) { g[a] += w * J[i][a] * r; for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b]; }
    });
    for (let a = 0; a < P.length; a++) A[a][a] *= (1 + lam);
    const dvec = gaussSolve(A, g);
    if (!dvec) { lam *= 4; if (lam > 1e7) break; continue; }
    const P2 = P.map((v, k) => v + dvec[k]); const s2 = ssr(P2);
    if (isFinite(s2) && s2 < cur) { const pv = cur; P = P2; cur = s2; lam = Math.max(1e-8, lam / 2); if (Math.abs(pv - cur) < 1e-10) break; }
    else { lam *= 3; if (lam > 1e7) break; }
  }
  if (!P.every(isFinite)) return null;
  let sst = 0; const m = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  pts.forEach((p) => sst += (p.y - m) ** 2);
  const df = Math.max(1, pts.length - P.length);
  const r2 = sst > 0 ? 1 - cur / sst : 1;
  const se = Math.sqrt(cur / df);
  const P_err = P.map(() => 0);
  try {
    const J = pts.map((p) => {
      const y0 = f(p.x, P); const row = [];
      for (let k = 0; k < P.length; k++) { const h = Math.max(1e-6, Math.abs(P[k]) * 1e-4); row.push((f(p.x, P.map((v, i) => (i === k ? v + h : v))) - y0) / h); }
      return row;
    });
    const A = P.map(() => new Array(P.length).fill(0));
    pts.forEach((p, i) => { const w = p.w || 1; for (let a = 0; a < P.length; a++) { for (let b = 0; b < P.length; b++) A[a][b] += w * J[i][a] * J[i][b]; } });
    for (let i = 0; i < P.length; i++) {
      const e = P.map((_, j) => (i === j ? 1 : 0));
      const col = gaussSolve(A, e);
      if (col) P_err[i] = Math.sqrt(Math.max(0, col[i] * (cur / df)));
    }
  } catch (err) { /* ignore */ }
  return { params: P, paramsErr: P_err, r2, se, f: (x) => f(x, P) };
};
export const fitLinear = (pts) => {
  if (pts.length < 2) return null;
  const r = fitGeneric(pts, (x, P) => P[0] + P[1] * x, [0, 1]);
  return r ? { ...r, intercept: r.params[0], slope: r.params[1], interceptErr: r.paramsErr[0], slopeErr: r.paramsErr[1] } : null;
};
export const fit4PL = (pts) => {
  if (pts.length < 4) return null;
  const ys = pts.map((p) => p.y);
  const t = Math.max(...ys), b = Math.min(...ys);
  const r = fitGeneric(pts, (x, P) => P[1] + (P[0] - P[1]) / (1 + Math.pow(x / P[2], P[3])), [t, b, pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length), 1]);
  return r ? { ...r, top: r.params[0], bottom: r.params[1], ic50: r.params[2], hill: r.params[3], topErr: r.paramsErr[0], bottomErr: r.paramsErr[1], ic50Err: r.paramsErr[2], hillErr: r.paramsErr[3] } : null;
};
export const fitCustomEquation = (expr, pts) => {
  let ast, par;
  try { ast = parseExpression(expr); par = collectParams(ast); } catch (e) { return null; }
  if (!par.length || pts.length < par.length + 1) return null;
  const init = par.map((_, i) => (i === 0 ? pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length) : 1));
  const res = fitGeneric(pts, (x, P) => { const s = { x }; par.forEach((n, i) => s[n] = P[i]); return evalAST(ast, s); }, init);
  if (!res) return null;
  res.params = Object.fromEntries(par.map((n, i) => [n, res.params[i]]));
  res.paramsErr = Object.fromEntries(par.map((n, i) => [n, res.paramsErr[i]]));
  return res;
};
export const runFit = (model, customExpr, wpts) => {
  if (model === 'linear') return fitLinear(wpts);
  if (model === '4pl') return fit4PL(wpts);
  if (model === 'custom' && customExpr) return fitCustomEquation(customExpr, wpts);
  return null;
};
export const fitParamOptions = (model, customExpr) => {
  if (model === 'linear') return ['slope', 'intercept'];
  if (model === '4pl') return ['top', 'bottom', 'ic50', 'hill'];
  if (model === 'custom') { try { return collectParams(parseExpression(customExpr || '')); } catch { return []; } }
  return [];
};
export const extractFitParam = (fit, model, param) => {
  if (!fit) return null;
  if (model === 'linear') return param === 'intercept' ? fit.intercept : fit.slope;
  if (model === '4pl') return ({ top: fit.top, bottom: fit.bottom, ic50: fit.ic50, hill: fit.hill })[param] ?? null;
  return fit.params?.[param] ?? null;
};

// ================= SHARED CHART STYLE + ZOOM =================
const DEFAULT_CHART_STYLE = {
  height: 380, aspect: 1.8, fontSize: 12, tickStep: '', tickAngle: 0,
  pointStyle: 'circle', ptSize: 5, lineStyle: 'solid', lineThickness: 2,
  legend: 'top', colors: {}, barRadius: 3,
  xMin: '', xMax: '', yMin: '', yMax: '', xAxisLabel: '', yAxisLabel: ''
};
const lineDash = (style) => (style === 'dashed' ? '7 5' : style === 'dotted' ? '2 3' : undefined);
const seriesColor = (cfg, key, idx) => (cfg.colors && cfg.colors[key]) || LINE_COLORS[Math.max(0, idx) % LINE_COLORS.length];
const makeTicks = (domain, stepStr) => {
  const step = parseManual(stepStr);
  if (!step || step <= 0 || !Array.isArray(domain)) return undefined;
  const [a, b] = [Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1])];
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(parseFloat(v.toFixed(6)));
  return out.length ? out : undefined;
};
const catInterval = (stepStr) => {
  const n = parseManual(stepStr);
  return n && n >= 1 ? Math.round(n) - 1 : 0;
};
const dom = (v) => (v === '' || v == null || parseManual(v) === null ? undefined : parseManual(v));
const chartBoxStyle = (cfg) => ({ width: '100%', aspectRatio: String(cfg.aspect || 1.8), maxHeight: cfg.height || 380, minHeight: 220 });
const AngledTick = ({ x, y, payload, angle = 0, fontSize = 11, anchor = 'middle' }) => {
  const a = Number(angle) || 0;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <text transform={a ? `rotate(${a})` : undefined} textAnchor={a < 0 ? 'end' : a > 0 ? 'start' : anchor}
        dy={a ? 4 : 12} dx={a ? (a > 0 ? 4 : -4) : 0} fill="#64748b" fontSize={fontSize}>
        {String(payload.value)}
      </text>
    </g>
  );
};
const NumField = ({ label, value, onChange, step = 1, w = 'w-full' }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      className={`border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 ${w}`} />
  </div>
);
const TxtField = ({ label, value, onChange, placeholder = '', w = 'w-full' }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={`border border-slate-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 ${w}`} />
  </div>
);
const SelField = ({ label, value, onChange, options }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] font-bold text-slate-600">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-300 rounded-md p-1.5 text-xs bg-white outline-none focus:border-blue-500">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </div>
);
const ChartStylePanel = ({ cfg, setCfg, series = [] }) => (
  <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-2 lg:grid-cols-4 gap-3 shadow-sm">
    <NumField label="Font size (px)" value={cfg.fontSize} onChange={(v) => setCfg({ fontSize: v || 12 })} />
    <NumField label="Chart height (px)" value={cfg.height} onChange={(v) => setCfg({ height: v || 380 })} />
    <NumField label="Aspect ratio X/Y (W÷H) — rectangularity" step={0.1} value={cfg.aspect} onChange={(v) => setCfg({ aspect: v || 1.8 })} />
    <TxtField label="Tick step (num: spacing · cat: every N)" value={cfg.tickStep} onChange={(v) => setCfg({ tickStep: v })} placeholder="auto" />
    <SelField label="Tick label orientation" value={String(cfg.tickAngle || 0)} onChange={(v) => setCfg({ tickAngle: Number(v) })}
      options={[['0', '0° (horizontal)'], ['-30', '-30°'], ['-45', '-45°'], ['-60', '-60°'], ['-90', '-90° (vertical)'], ['30', '30°'], ['45', '45°'], ['90', '90°']]} />
    <SelField label="Point style" value={cfg.pointStyle} onChange={(v) => setCfg({ pointStyle: v })}
      options={[['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['cross', 'Cross']]} />
    <NumField label="Point size" value={cfg.ptSize} onChange={(v) => setCfg({ ptSize: v || 5 })} />
    <SelField label="Line style" value={cfg.lineStyle} onChange={(v) => setCfg({ lineStyle: v })}
      options={[['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]} />
    <NumField label="Line thickness" step={0.5} value={cfg.lineThickness} onChange={(v) => setCfg({ lineThickness: v || 2 })} />
    <SelField label="Legend" value={cfg.legend} onChange={(v) => setCfg({ legend: v })} options={[['top', 'Top'], ['bottom', 'Bottom'], ['none', 'None']]} />
    <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">X Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.xMin} onChange={(e) => setCfg({ xMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.xMax} onChange={(e) => setCfg({ xMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div></div>
    <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-slate-600">Y Min / Max</label>
      <div className="flex gap-1">
        <input type="number" placeholder="auto" value={cfg.yMin} onChange={(e) => setCfg({ yMin: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
        <input type="number" placeholder="auto" value={cfg.yMax} onChange={(e) => setCfg({ yMax: e.target.value })} className="border border-slate-300 rounded-md p-1.5 text-xs w-full outline-none" />
      </div></div>
    <TxtField label="X axis label" value={cfg.xAxisLabel} onChange={(v) => setCfg({ xAxisLabel: v })} />
    <TxtField label="Y axis label" value={cfg.yAxisLabel} onChange={(v) => setCfg({ yAxisLabel: v })} />
    {series.length > 0 && (
      <div className="col-span-2 lg:col-span-4 pt-2 border-t border-slate-100 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Series colors (points / lines / bars)</label>
        <div className="flex flex-wrap gap-3">
          {series.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
              <input type="color" value={(cfg.colors && cfg.colors[s.key]) || s.color || '#3b82f6'}
                onChange={(e) => setCfg({ colors: { ...(cfg.colors || {}), [s.key]: e.target.value } })}
                className="w-6 h-6 rounded cursor-pointer border border-slate-300" />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    )}
    <p className="col-span-2 lg:col-span-4 text-[9px] text-slate-400">💡 Drag with the mouse over any graph to zoom into a region. Use “Reset Zoom” to restore.</p>
  </div>
);
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
      loRef.current = null;
      setLo(null); setHi(null);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onMouseDown = (e) => {
    const v = getX(e.clientX);
    if (v !== null) { dragging.current = true; loRef.current = v; setLo(v); setHi(v); }
  };
  return { domain: eff, refLo: lo, refHi: hi, onMouseDown, isZoomed: !!domain, reset: () => setDomain(null) };
};
const useCatZoom = (names) => {
  const [range, setRange] = useState(null);
  const [d0, setD0] = useState(null);
  const [d1, setD1] = useState(null);
  const idxOf = (label) => names.indexOf(label);
  const onMouseDown = (st) => { if (st && st.activeLabel != null) { setD0(String(st.activeLabel)); setD1(String(st.activeLabel)); } };
  const onMouseMove = (st) => { if (d0 != null && st && st.activeLabel != null) setD1(String(st.activeLabel)); };
  const onMouseUp = (st) => {
    if (d0 == null) return;
    const end = st && st.activeLabel != null ? String(st.activeLabel) : d1;
    const i0 = idxOf(d0), i1 = idxOf(end);
    setD0(null); setD1(null);
    if (i0 >= 0 && i1 >= 0 && i0 !== i1) setRange([Math.min(i0, i1), Math.max(i0, i1)]);
  };
  const visible = range ? names.slice(range[0], range[1] + 1) : names;
  return { visible, drag: [d0, d1], onMouseDown, onMouseMove, onMouseUp, reset: () => setRange(null), isZoomed: !!range };
};

// ================= GEOMETRY & STRUCTURES =================
const getHexagon = (cx, cy, r, dir) => { const pts = []; const b = dir === 1 ? -Math.PI / 2 : Math.PI / 2; for (let i = 0; i < 6; i++) { const a = b + i * (Math.PI / 3) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const getPentagon = (cx, cy, r, dir) => { const pts = []; const b = dir === 1 ? -Math.PI / 2 : Math.PI / 2; for (let i = 0; i < 5; i++) { const a = b + i * ((2 * Math.PI) / 5) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const hexAt = (cx, cy, r, deg0) => { const pts = []; for (let i = 0; i < 6; i++) { const a = ((deg0 + i * 60) * Math.PI) / 180; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const fusePentagon = (A, B, nx, ny) => {
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const r5 = L / (2 * Math.sin(Math.PI / 5));
  const ap = r5 * Math.cos(Math.PI / 5);
  const c = { x: mx + nx * ap, y: my + ny * ap };
  const aA = Math.atan2(A.y - c.y, A.x - c.x);
  const step = (2 * Math.PI) / 5;
  const mk = (dir, k) => ({ x: c.x + r5 * Math.cos(aA + dir * step * k), y: c.y + r5 * Math.sin(aA + dir * step * k) });
  const dir = Math.hypot(mk(1, 4).x - B.x, mk(1, 4).y - B.y) < Math.hypot(mk(-1, 4).x - B.x, mk(-1, 4).y - B.y) ? 1 : -1;
  return { V1: mk(dir, 1), V2: mk(dir, 2), V3: mk(dir, 3), c };
};
const makeBuilder = () => {
  const elements = [];
  let minX = 0, maxX = 0, minY = 0, maxY = 0, first = true;
  const ub = (x, y) => { if (first) { minX = maxX = x; minY = maxY = y; first = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const addLine = (x1, y1, x2, y2, color, isDouble = false, width = 1.8) => {
    ub(x1, y1); ub(x2, y2);
    if (isDouble) {
      const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 2.6, ny = (dx / len) * 2.6;
      elements.push({ type: 'line', x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, color, width });
      elements.push({ type: 'line', x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny, color, width });
    } else elements.push({ type: 'line', x1, y1, x2, y2, color, width });
  };
  const addPolygon = (pts, color) => { pts.forEach((p) => ub(p.x, p.y)); elements.push({ type: 'polygon', points: pts.map((p) => `${p.x},${p.y}`).join(' '), color }); };
  const addCircle = (x, y, r, color, fill = 'white', strokeWidth, meta = null) => { ub(x, y); elements.push({ type: 'circle', x, y, r, color, fill, strokeWidth, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null }); };
  const addDot = (x, y, color, meta = null) => { ub(x, y); elements.push({ type: 'circle', x, y, r: 2.4, color, fill: color, strokeWidth: 0, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null }); };
  const finish = (pad = 15) => ({ elements, viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}` });
  return { elements, ub, addLine, addPolygon, addCircle, addDot, finish };
};
// (buildProteinStructure, buildNucleicStructure, buildSugarStructure, buildLipidStructure,
//  elementsToSVG, normalizeImageCandidates — IDENTICI alla versione precedente; omessi qui per spazio
//  ma vanno mantenuti uguali. Li includo completi qui sotto.)
const buildProteinStructure = (sequence) => {
  const b = makeBuilder();
  let curRi = null;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x, y - 15); b.ub(x, y + 15); b.ub(x - 30, y); b.ub(x + 30, y);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null });
  };
  const addAtomCircle = (x, y, r, color, atoms = null) => { const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null; b.addCircle(x, y, r, color, 'white', 1.5, { ri: curRi, atoms, keys }); };
  const addRingHeteroatom = (x, y, text, color, atoms = null) => { const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null; b.addCircle(x, y, 12, color, 'white', 1.6, { ri: curRi, atoms, keys }); addText(x, y, text, color, 11, 'middle', atoms); };
  const placeRadialLabel = (cx, cy, pt, text, color, atoms = null) => {
    const angle = Math.atan2(pt.y - cy, pt.x - cx); const dist = 18;
    const lx = pt.x + dist * Math.cos(angle); const ly = pt.y + dist * Math.sin(angle);
    let anchor = 'middle';
    if (Math.abs(angle) < Math.PI / 3) anchor = 'start';
    else if (Math.abs(angle) > (2 * Math.PI) / 3) anchor = 'end';
    addText(lx, ly, text, color, 11, anchor, atoms);
  };
  const dx = 45, dy = 30, S = 25;
  const coords = [];
  let cx = 100, cy = 200, slope = -1;
  for (let i = 0; i < sequence.length; i++) {
    const nX = cx, nY = cy; cx += dx; cy += slope * dy;
    const caX = cx, caY = cy, scDir = slope; slope *= -1;
    cx += dx; cy += slope * dy;
    const cX = cx, cY = cy, oDir = slope; slope *= -1;
    cx += dx; cy += slope * dy;
    const nextNX = cx, nextNY = cy; slope *= -1;
    coords.push({ nX, nY, caX, caY, cX, cY, nextNX, nextNY, scDir, oDir, res: sequence[i] });
  }
  coords.forEach((c, i) => {
    curRi = i;
    const color = c.res.color;
    const isFirst = i === 0; const isLast = i === sequence.length - 1;
    const char = c.res.char;
    if (!isFirst) b.addLine(coords[i - 1].cX, coords[i - 1].cY, c.nX, c.nY, coords[i - 1].res.color);
    b.addLine(c.nX, c.nY, c.caX, c.caY, color);
    b.addLine(c.caX, c.caY, c.cX, c.cY, color);
    b.addLine(c.cX, c.cY, c.cX, c.cY + c.oDir * 25, '#ef4444', true);
    if (isLast) b.addLine(c.cX, c.cY, c.nextNX, c.nextNY, color);
    if (!isFirst && char !== 'P') {
      const hDir = c.nY < c.caY ? -1 : 1;
      b.addLine(c.nX, c.nY, c.nX, c.nY + hDir * 15, color);
      addText(c.nX, c.nY + hDir * 25, 'H', color, 11, 'middle', ['HN']);
    }
    if (char !== 'G') {
      const haDir = -c.scDir;
      b.addLine(c.caX, c.caY, c.caX, c.caY + haDir * 15, color);
      addText(c.caX, c.caY + haDir * 25, 'Hα', color, 11, 'middle', ['Hα']);
    } else {
      b.addLine(c.caX, c.caY, c.caX, c.caY - 15, color); addText(c.caX, c.caY - 25, 'Hα1', color, 11, 'middle', ['Hα1']);
      b.addLine(c.caX, c.caY, c.caX, c.caY + 15, color); addText(c.caX, c.caY + 25, 'Hα2', color, 11, 'middle', ['Hα2']);
    }
    if (char === 'P') {
      b.elements.push({ type: 'path', d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir * 40} ${c.caX} ${c.caY + c.scDir * 25}`, color });
      b.addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * 25, color);
    }
    const nAtoms = char === 'P' ? ['N'] : isFirst ? ['HN'] : ['N', 'HN'];
    addAtomCircle(c.nX, c.nY, 13, color, nAtoms);
    addText(c.nX, c.nY, isFirst ? (char === 'P' ? 'H₂N⁺' : 'H₃N⁺') : 'N', color, 13, 'middle', nAtoms);
    addAtomCircle(c.caX, c.caY, 13, color, char === 'G' ? ['Cα', 'Hα1', 'Hα2'] : ['Cα', 'Hα']);
    addText(c.caX, c.caY, 'Cα', color, 13, 'middle', char === 'G' ? ['Cα', 'Hα1', 'Hα2'] : ['Cα', 'Hα']);
    addAtomCircle(c.cX, c.cY, 13, color, ["C'"]);
    addText(c.cX, c.cY, 'C', color, 13, 'middle', ["C'"]);
    addText(c.cX, c.cY + c.oDir * 35, 'O', '#ef4444', 13, 'middle', null);
    if (isLast) { addAtomCircle(c.nextNX, c.nextNY, 13, color, null); addText(c.nextNX, c.nextNY, 'O⁻', '#ef4444', 13, 'middle', null); }
    const vNode = (lvl, text, atoms) => {
      if (lvl > 0) b.addLine(c.caX, c.caY + c.scDir * (lvl - 1) * S, c.caX, c.caY + c.scDir * lvl * S, color);
      addText(c.caX, c.caY + c.scDir * (lvl * S + (c.scDir === 1 ? 10 : -10)), text, color, 11, 'middle', atoms);
    };
    if (char !== 'G' && char !== 'P') {
      b.addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * S, color);
      if (!['A', 'I', 'V', 'T', 'F', 'Y', 'W', 'H'].includes(char)) addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
    }
    switch (char) {
      case 'A': addText(c.caX, c.caY + c.scDir * S, 'CH₃ (Hβ)', color, 11, 'middle', ['Hβ']); break;
      case 'V':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ1)', color, 11, 'middle', ['Hγ1']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        break;
      case 'L':
        vNode(2, 'CH (Hγ)', ['Hγ']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color, 11, 'middle', ['Hδ1']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ2)', color, 11, 'middle', ['Hδ2']);
        break;
      case 'I':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₂ (Hγ1)', color, 11, 'middle', ['Hγ1']);
        b.addLine(c.caX + 20, c.caY + c.scDir * 1.8 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color, 11, 'middle', ['Hδ1']);
        break;
      case 'S': vNode(2, 'OH (Hβ)', ['Hβ1', 'Hβ2']); break;
      case 'T':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.5 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.5 * S + 10), 'OH (Hγ1)', color, 11, 'middle', ['Hγ1']);
        break;
      case 'C': vNode(2, 'SH (Hβ)', ['Hβ1', 'Hβ2']); break;
      case 'M': vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'S', null); vNode(4, 'CH₃ (Hε)', ['Hε(CH3)']); break;
      case 'D':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'N':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'NH₂ (Hδ2)', color, 11, 'middle', ['Hδ21', 'Hδ22']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'E':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'Q':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'NH₂ (Hε2)', color, 11, 'middle', ['Hε21', 'Hε22']);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'K': vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'CH₂ (Hδ)', ['Hδ']); vNode(4, 'CH₂ (Hε)', ['Hε']); vNode(5, 'NH₃⁺ (Hζ)', ['Hζ(NH3)']); break;
      case 'R':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']); vNode(3, 'CH₂ (Hδ)', ['Hδ']); vNode(4, 'NH (Hε)', ['Hε']); vNode(5, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX - 20, c.caY + c.scDir * 5.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂', color);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX + 20, c.caY + c.scDir * 5.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂⁺', color);
        break;
      case 'F':
      case 'Y': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const hcx = c.caX; const hcy = c.caY + c.scDir * 3 * S;
        const hPts = getHexagon(hcx, hcy, S, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, hPts[0].x, hPts[0].y, color);
        b.addPolygon(hPts, color);
        b.addCircle(hcx, hcy, S * 0.6, color, 'none');
        placeRadialLabel(hcx, hcy, hPts[1], 'CH (Hδ2)', color, ['Hδ']);
        placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε2)', color, ['Hε']);
        placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hδ1)', color, ['Hδ']);
        placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hε1)', color, ['Hε']);
        if (char === 'Y') {
          const angleZ = Math.atan2(hPts[3].y - hcy, hPts[3].x - hcx);
          const ohX = hPts[3].x + S * Math.cos(angleZ); const ohY = hPts[3].y + S * Math.sin(angleZ);
          b.addLine(hPts[3].x, hPts[3].y, ohX, ohY, color);
          addText(ohX + 12 * Math.cos(angleZ), ohY + 12 * Math.sin(angleZ), 'OH', color, 11, 'middle', null);
        } else placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color, ['Hζ']);
        break;
      }
      case 'H': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
        const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color);
        b.addPolygon(pPts, color);
        b.addCircle(pcx, pcy, R5 * 0.5, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, 'NH', color, null);
        addRingHeteroatom(pPts[4].x, pPts[4].y, 'N', color, null);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ2)', color, ['Hδ2']);
        placeRadialLabel(pcx, pcy, pPts[3], 'CH (Hε1)', color, ['Hε1']);
        break;
      }
      case 'W': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
        const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color);
        b.addPolygon(pPts, color);
        b.addCircle(pcx, pcy, R5 * 0.5, color, 'none');
        const ce2 = pPts[3]; const cd2 = pPts[4];
        const mx = (ce2.x + cd2.x) / 2; const my = (ce2.y + cd2.y) / 2;
        const midA = Math.atan2(my - pcy, mx - pcx);
        const hcx = mx + (Math.cos(midA) * S * Math.sqrt(3)) / 2; const hcy = my + (Math.sin(midA) * S * Math.sqrt(3)) / 2;
        const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx);
        const testA = startA + Math.PI / 3;
        const sign = Math.hypot(hcx + S * Math.cos(testA) - cd2.x, hcy + S * Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
        const hPts = [];
        for (let j = 0; j < 6; j++) { const a = startA + j * sign * (Math.PI / 3); hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) }); }
        b.addPolygon(hPts, color);
        b.addCircle(hcx, hcy, S * 0.6, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, 'NH', color, ['Hδ1']);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ1)', color, ['Hδ1']);
        placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε3)', color, ['Hε3']);
        placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ3)', color, ['Hζ3']);
        placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hη2)', color, ['Hη2']);
        placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hζ2)', color, ['Hζ2']);
        break;
      }
      default: break;
    }
    const labelY = c.caY + (c.scDir > 0 ? 170 : -170);
    addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14, 'middle', null);
  });
  return b.finish();
};
const buildNucleicStructure = (sequence, molType) => {
  const b = makeBuilder();
  const isDNA = molType === 'dna';
  let curRi = null, curChar = null;
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null });
  };
  const ringAtom = (x, y, text, color, atoms = null) => { b.addCircle(x, y, 9, color, 'white', 1.2, { ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null }); addText(x, y, text, color, 8, 'middle', atoms); };
  const dot = (x, y, color, atoms) => b.addDot(x, y, color, { ri: curRi, atoms, keys: buildKeys(curRi, atoms, molType, curChar) });
  const RH = 250, xP = 110, xS = 235, y0 = 150;
  const BB = '#475569';
  const drawP = (x, y, ri, top) => {
    curRi = ri; curChar = sequence[ri]?.char;
    b.addCircle(x, y, 13, BB, 'white', 1.4, { ri, atoms: ['P'], keys: buildKeys(ri, ['P'], molType, curChar) });
    addText(x, y, 'P', BB, 12, 'middle', ['P']);
    b.addLine(x - 13, y, x - 26, y, BB, true, 1.4);
    addText(x - 34, y, 'O', BB, 10, 'middle', null);
    if (top) { b.addLine(x, y - 13, x, y - 24, BB); addText(x, y - 32, 'O⁻', BB, 9, 'middle', null); }
    else { b.addLine(x, y + 13, x, y + 24, BB); addText(x, y + 33, 'O⁻', BB, 9, 'middle', null); }
  };
  sequence.forEach((res, i) => {
    curRi = i; curChar = res.char;
    const color = res.color;
    const sy = y0 + i * RH;
    const sPts = getPentagon(xS, sy, 26, 1);
    const [O4, C1, C2s, C3s, C4s] = sPts;
    b.addPolygon(sPts, color);
    b.addLine(C2s.x, C2s.y, C3s.x, C3s.y, color, false, 6);
    addText(O4.x, O4.y, 'O', color, 9, 'middle', null);
    dot(C1.x, C1.y, color, ["H1'", "C1'"]);
    dot(C2s.x, C2s.y, color, isDNA ? ["H2'", "H2''", "C2'"] : ["H2'", "OH2'", "C2'"]);
    dot(C3s.x, C3s.y, color, ["H3'", "C3'"]);
    dot(C4s.x, C4s.y, color, ["H4'", "C4'"]);
    if (!isDNA) { b.addLine(C2s.x, C2s.y, C2s.x + 14, C2s.y + 12, color); addText(C2s.x + 22, C2s.y + 16, 'OH', color, 8, 'start', ["OH2'"]); }
    const c5p = { x: C4s.x - 20, y: C4s.y - 16 };
    b.addLine(C4s.x, C4s.y, c5p.x, c5p.y, color);
    dot(c5p.x, c5p.y, color, ["H5'", "H5''", "C5'"]);
    const py = sy - 100;
    drawP(xP, py, i, i === 0);
    addText(xP + 30, py + 26, 'O', BB, 9, 'middle', null);
    if (i > 0) b.addLine(xP + 22, py - 18, xP + 9, py - 9, BB);
    b.addLine(xP + 9, py + 9, xP + 22, py + 20, BB);
    b.addLine(xP + 38, py + 30, c5p.x - 4, c5p.y - 4, BB);
    if (i < sequence.length - 1) {
      const py2 = sy + 150;
      b.addLine(C3s.x, C3s.y, xP + 20, py2 - 20, color);
      addText(xP + 28, py2 - 26, 'O', BB, 9, 'middle', null);
    } else {
      b.addLine(C3s.x, C3s.y, C3s.x - 12, C3s.y + 26, color);
      addText(C3s.x - 16, C3s.y + 36, 'OH', color, 9, 'end', ["H3'"]);
    }
    const isPur = res.base === 'purine';
    if (!isPur) {
      const cx = xS + 105, cy = sy;
      const h = hexAt(cx, cy, 26, 180);
      const [N1, C2b, N3, C4b, C5b, C6] = h;
      b.addLine(C1.x, C1.y, N1.x, N1.y, color);
      b.addPolygon(h, color);
      b.addCircle(cx, cy, 13, color, 'none', 1);
      ringAtom(N1.x, N1.y, 'N1', color); ringAtom(N3.x, N3.y, 'N3', color);
      ringAtom(C2b.x, C2b.y, 'C2', color); ringAtom(C4b.x, C4b.y, 'C4', color);
      ringAtom(C5b.x, C5b.y, 'C5', color); ringAtom(C6.x, C6.y, 'C6', color);
      b.addLine(C2b.x, C2b.y, C2b.x - 10, C2b.y - 18, color, true);
      addText(C2b.x - 14, C2b.y - 26, 'O', color, 9, 'middle', null);
      b.addLine(C4b.x, C4b.y, C4b.x + 16, C4b.y, color, res.char === 'C' ? false : true);
      addText(C4b.x + 28, C4b.y, res.char === 'C' ? 'NH₂' : 'O', color, 9, 'middle', null);
      if (res.char === 'T') { b.addLine(C5b.x, C5b.y, C5b.x + 10, C5b.y + 18, color); addText(C5b.x + 16, C5b.y + 28, 'CH₃', color, 9, 'start', ['H7(CH3)']); }
      else addText(C5b.x + 14, C5b.y + 12, 'H', color, 8, 'start', ['H5']);
      addText(C6.x - 10, C6.y + 14, 'H', color, 8, 'middle', ['H6']);
    } else {
      const cx = xS + 135, cy = sy;
      const h = hexAt(cx, cy, 26, 150);
      const [C4b, C5b, C6, N1, C2b, N3] = h;
      const { V1, V2, V3 } = fusePentagon(C5b, C4b, -1, 0);
      b.addLine(C1.x, C1.y, V3.x, V3.y, color);
      b.addPolygon(h, color);
      b.addPolygon([C5b, V1, V2, V3, C4b], color);
      b.addCircle(cx, cy, 12, color, 'none', 1);
      ringAtom(N1.x, N1.y, 'N1', color); ringAtom(C2b.x, C2b.y, 'C2', color); ringAtom(N3.x, N3.y, 'N3', color);
      ringAtom(C4b.x, C4b.y, 'C4', color); ringAtom(C5b.x, C5b.y, 'C5', color); ringAtom(C6.x, C6.y, 'C6', color);
      ringAtom(V1.x, V1.y, 'N7', color); ringAtom(V2.x, V2.y, 'C8', color, ['H8']); ringAtom(V3.x, V3.y, 'N9', color);
      if (res.char === 'A') {
        b.addLine(C6.x, C6.y, C6.x, C6.y - 16, color);
        addText(C6.x, C6.y - 26, 'NH₂', color, 9, 'middle', null);
        addText(C2b.x + 16, C2b.y + 10, 'H2', color, 8, 'start', ['H2']);
      } else {
        b.addLine(C6.x, C6.y, C6.x, C6.y - 16, color, true);
        addText(C6.x, C6.y - 26, 'O', color, 9, 'middle', null);
        b.addLine(C2b.x, C2b.y, C2b.x + 14, C2b.y + 10, color);
        addText(C2b.x + 26, C2b.y + 14, 'NH₂', color, 9, 'start', null);
      }
    }
    addText(560, sy, `${res.name} ${res.char}`, '#1d4ed8', 13, 'start', null);
  });
  curRi = null; curChar = null;
  addText(20, y0 + RH / 2, 'sugar–phosphate', '#64748b', 10, 'start', null);
  addText(20, y0 + RH / 2 + 14, 'backbone', '#64748b', 10, 'start', null);
  return b.finish();
};
const buildSugarStructure = (res, conformation, anomer) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'sugar', curChar) : null });
  };
  const dot = (x, y, atoms) => b.addDot(x, y, c, { ri: curRi, atoms, keys: buildKeys(curRi, atoms, 'sugar', curChar) });
  const chair = conformation !== 'invChair';
  const dir = chair ? 1 : -1;
  const base = { C4: { x: 150, y: 120 }, C5: { x: 250, y: 140 }, O: { x: 340, y: 108 }, C1: { x: 400, y: 168 }, C2: { x: 308, y: 196 }, C3: { x: 205, y: 190 } };
  const P = chair ? base : Object.fromEntries(Object.entries(base).map(([k, p]) => [k, { x: p.x, y: 330 - p.y }]));
  const anomLabel = anomer === 'beta' ? 'β' : 'α';
  b.addLine(P.C3.x, P.C3.y, P.C2.x, P.C2.y, c, false, 6);
  b.addLine(P.C2.x, P.C2.y, P.C1.x, P.C1.y, c, false, 6);
  b.addLine(P.C1.x, P.C1.y, P.O.x, P.O.y, c);
  b.addLine(P.O.x, P.O.y, P.C5.x, P.C5.y, c);
  b.addLine(P.C5.x, P.C5.y, P.C4.x, P.C4.y, c);
  b.addLine(P.C4.x, P.C4.y, P.C3.x, P.C3.y, c);
  addText(P.O.x, P.O.y - 14 * dir, 'O', c, 12, 'middle', null);
  dot(P.C1.x, P.C1.y, ['H1', 'C1']); dot(P.C2.x, P.C2.y, ['H2', 'C2']); dot(P.C3.x, P.C3.y, ['H3', 'C3']);
  dot(P.C4.x, P.C4.y, ['H4', 'C4']); dot(P.C5.x, P.C5.y, ['H5', 'C5']);
  b.addLine(P.C1.x, P.C1.y, P.C1.x + 34, P.C1.y - 8 * dir, c);
  addText(P.C1.x + 50, P.C1.y - 10 * dir, `OH (${anomLabel})`, c, 12, 'start', ['H1', 'C1']);
  if (curChar === 'NAG') {
    b.addLine(P.C2.x, P.C2.y, P.C2.x + 16, P.C2.y + 34 * dir, c);
    addText(P.C2.x + 26, P.C2.y + 46 * dir, 'NH', c, 12, 'start', ['NHAc']);
    const cC = { x: P.C2.x + 6, y: P.C2.y + 96 * dir };
    b.addLine(P.C2.x + 30, P.C2.y + 56 * dir, cC.x, cC.y, c);
    b.addLine(cC.x, cC.y, cC.x - 34, cC.y - 6 * dir, c, true);
    addText(cC.x - 44, cC.y - 8 * dir, 'O', c, 12, 'middle', null);
    b.addLine(cC.x, cC.y, cC.x + 18, cC.y + 34 * dir, c);
    addText(cC.x + 26, cC.y + 46 * dir, 'CH₃', c, 12, 'start', ['AcCH3']);
  } else {
    b.addLine(P.C2.x, P.C2.y, P.C2.x + 14, P.C2.y + 30 * dir, c);
    addText(P.C2.x + 22, P.C2.y + 42 * dir, 'OH', c, 12, 'start', ['H2', 'C2']);
  }
  b.addLine(P.C3.x, P.C3.y, P.C3.x - 34, P.C3.y + 6 * dir, c);
  addText(P.C3.x - 46, P.C3.y + 8 * dir, 'HO', c, 12, 'end', ['H3', 'C3']);
  b.addLine(P.C4.x, P.C4.y, P.C4.x - 36, P.C4.y - 10 * dir, c);
  addText(P.C4.x - 48, P.C4.y - 12 * dir, 'HO', c, 12, 'end', ['H4', 'C4']);
  const c6 = { x: P.C5.x + 18, y: P.C5.y - 52 * dir };
  b.addLine(P.C5.x, P.C5.y, c6.x, c6.y, c);
  if (curChar === 'FUC') {
    dot(c6.x, c6.y, ['H6', 'C6']);
    addText(c6.x + 8, c6.y - 12 * dir, 'CH₃', c, 12, 'start', ['H6', 'C6']);
  } else {
    dot(c6.x, c6.y, ['H6a', 'H6b', 'C6']);
    b.addLine(c6.x, c6.y, c6.x - 14, c6.y - 30 * dir, c);
    addText(c6.x - 18, c6.y - 40 * dir, 'OH', c, 12, 'middle', ['H6a', 'H6b', 'C6']);
  }
  addText(275, 365, `${res.name} (${anomLabel}, ${chair ? 'chair' : 'inverted chair'})`, c, 13, 'middle', null);
  return b.finish();
};
const buildLipidStructure = (res, db) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, 'lipid', curChar) : null });
  };
  const zig = (x0, y0, n, L, amp, dir0) => { const pts = [{ x: x0, y: y0 }]; let dir = dir0; for (let k = 0; k < n; k++) { const p = pts[pts.length - 1]; pts.push({ x: p.x - L, y: p.y + dir * amp }); dir = -dir; } return pts; };
  const chain = (pts, dblIdx) => { for (let k = 0; k < pts.length - 1; k++) b.addLine(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, c, k === dblIdx, 1.6); };
  const g1 = { x: 640, y: 96 }, g2 = { x: 640, y: 140 }, g3 = { x: 640, y: 184 };
  b.addLine(g1.x, g1.y, g2.x, g2.y, c); b.addLine(g2.x, g2.y, g3.x, g3.y, c);
  addText(g1.x, g1.y, 'CH₂', c, 9, 'middle', ['Hsn1a', 'Hsn1b']);
  addText(g2.x, g2.y, 'CH', c, 9, 'middle', ['Hsn2']);
  b.addLine(g2.x + 10, g2.y + 2, g2.x + 24, g2.y + 6, c, false, 1.2);
  addText(g2.x + 30, g2.y + 8, 'H', c, 8, 'start', null);
  addText(g3.x, g3.y, 'CH₂', c, 9, 'middle', ['Hsn3a', 'Hsn3b']);
  addText(600, 76, 'O', c, 9, 'middle', null);
  b.addLine(g1.x - 8, g1.y - 6, 608, 78, c); b.addLine(592, 76, 568, 76, c);
  b.addLine(560, 70, 560, 50, c, true); addText(560, 42, 'O', c, 9, 'middle', null);
  const sn1 = zig(520, 96, 9, 44, 13, -1);
  b.addLine(560, 76, sn1[0].x, sn1[0].y, c);
  chain(sn1, -1);
  addText(sn1[1].x, sn1[1].y - 16, 'C2', c, 8, 'middle', ['H2-sn1']);
  addText(sn1[2].x, sn1[2].y + 18, 'C3', c, 8, 'middle', ['H3-sn1']);
  addText(sn1[4].x, sn1[4].y - 16, '(CH₂)ₙ', c, 8, 'middle', ['H4-sn1']);
  addText(sn1[9].x - 14, sn1[9].y, 'CH₃', c, 9, 'end', ['H16-sn1']);
  addText(600, 150, 'O', c, 9, 'middle', null);
  b.addLine(g2.x - 10, g2.y, 608, 150, c); b.addLine(592, 152, 568, 166, c);
  b.addLine(560, 172, 560, 192, c, true); addText(560, 202, 'O', c, 9, 'middle', null);
  const sn2 = zig(520, 190, 9, 44, 13, 1);
  if (db === 'trans') {
    const a = sn2[4], d = sn2[7];
    sn2[5] = { x: a.x + (d.x - a.x) / 3, y: a.y + (d.y - a.y) / 3 };
    sn2[6] = { x: a.x + (2 * (d.x - a.x)) / 3, y: a.y + (2 * (d.y - a.y)) / 3 };
  }
  b.addLine(560, 170, sn2[0].x, sn2[0].y, c);
  chain(sn2, 5);
  addText(sn2[1].x, sn2[1].y + 18, 'C2', c, 8, 'middle', ['H2-sn2']);
  addText(sn2[3].x, sn2[3].y - 16, 'CH₂', c, 8, 'middle', ['Hall-sn2']);
  addText(sn2[5].x, sn2[5].y + 18, 'C9', c, 8, 'middle', ['H9-sn2']);
  addText(sn2[6].x, sn2[6].y - 16, 'C10', c, 8, 'middle', ['H10-sn2']);
  addText(sn2[7].x, sn2[7].y + 18, 'CH₂', c, 8, 'middle', ['H11-sn2']);
  addText(sn2[9].x - 14, sn2[9].y, 'CH₃', c, 9, 'end', ['H18-sn2']);
  b.addLine(g3.x + 10, g3.y, 674, 184, c);
  addText(680, 184, 'O', c, 9, 'middle', null);
  b.addLine(688, 184, 703, 184, c);
  b.addCircle(716, 184, 13, c, 'white', 1.4, { ri: 0, atoms: ['P'], keys: buildKeys(0, ['P'], 'lipid', curChar) });
  addText(716, 184, 'P', c, 12, 'middle', ['P']);
  b.addLine(716, 171, 716, 158, c, true); addText(716, 150, 'O', c, 9, 'middle', null);
  b.addLine(716, 197, 716, 210, c); addText(716, 220, 'O⁻', c, 9, 'middle', null);
  b.addLine(729, 184, 744, 184, c); addText(752, 184, 'O', c, 9, 'middle', null);
  const h1 = { x: 796, y: 172 }, h2 = { x: 832, y: 188 };
  b.addLine(760, 184, h1.x, h1.y, c); b.addLine(h1.x, h1.y, h2.x, h2.y, c);
  if (res.head === 'PC') {
    addText(h1.x, h1.y - 14, 'CH₂', c, 8, 'middle', ['HCH2N']);
    b.addLine(h2.x, h2.y, 862, 176, c);
    addText(868, 172, 'N⁺', c, 11, 'middle', ['HNMe3']);
    b.addLine(876, 164, 890, 150, c); b.addLine(878, 172, 896, 172, c); b.addLine(876, 180, 890, 194, c);
  } else if (res.head === 'PE') {
    addText(h1.x, h1.y - 14, 'CH₂', c, 8, 'middle', ['HCH2N']);
    b.addLine(h2.x, h2.y, 862, 176, c);
    addText(884, 172, 'NH₃⁺', c, 11, 'start', ['HNH3']);
  } else if (res.head === 'PS') {
    addText(h1.x, h1.y - 14, 'CH₂', c, 8, 'middle', ['HβS1', 'HβS2']);
    addText(h2.x, h2.y + 16, 'CH', c, 8, 'middle', ['HαS']);
    b.addLine(h2.x, h2.y - 8, h2.x + 20, h2.y - 26, c);
    addText(h2.x + 34, h2.y - 30, 'COO⁻', c, 9, 'start', null);
    b.addLine(h2.x, h2.y + 6, h2.x + 16, h2.y + 22, c);
    addText(h2.x + 26, h2.y + 28, 'NH₃', c, 9, 'start', ['HNH3']);
  } else {
    addText(h1.x, h1.y - 14, 'CH₂OH', c, 8, 'middle', ['HCH2OH']);
    addText(h2.x, h2.y + 16, 'CHOH', c, 8, 'middle', ['HCHOH']);
  }
  addText(450, 268, `${res.name} (${db} Δ9)`, c, 13, 'middle', null);
  return b.finish();
};
const elementsToSVG = (structure, height = 320) => {
  let inner = '';
  structure.elements.forEach((el) => {
    const w = el.width || 1.8;
    if (el.type === 'line') inner += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'path') inner += `<path d="${el.d}" fill="none" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'polygon') inner += `<polygon points="${el.points}" fill="white" stroke="${el.color}" stroke-width="${w}"/>`;
    else if (el.type === 'circle') inner += `<circle cx="${el.x}" cy="${el.y}" r="${el.r}" fill="${el.fill || 'white'}" stroke="${el.color}" stroke-width="${el.strokeWidth !== undefined ? el.strokeWidth : 1.5}"/>`;
    else if (el.type === 'text') {
      inner += `<text x="${el.x}" y="${el.y}" fill="white" stroke="white" stroke-width="3" stroke-linejoin="round" font-size="${el.fontSize}" text-anchor="${el.align}" dominant-baseline="middle" font-weight="bold">${el.text}</text>`;
      inner += `<text x="${el.x}" y="${el.y}" fill="${el.color}" font-size="${el.fontSize}" text-anchor="${el.align}" dominant-baseline="middle" font-weight="bold">${el.text}</text>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${structure.viewBox}" style="height:${height}px;max-width:100%;font-family:sans-serif;background:white;">${inner}</svg>`;
};
const normalizeImageCandidates = (url) => {
  const u = (url || '').trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (m) { const id = m[1]; return [`https://lh3.googleusercontent.com/d/${id}`, `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, `https://drive.google.com/uc?export=view&id=${id}`]; }
  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) { const id = m[1]; return [`https://lh3.googleusercontent.com/d/${id}`, `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, `https://drive.google.com/uc?export=view&id=${id}`]; }
  if (u.includes('dropbox.com')) return [u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1'), u];
  return [u];
};

// ================= STRUCTURE VIEW / PAINT / TICKS / TOOLTIP / RANGE / ZOOMABLE PLOTS =================
// (StructureSVGView, SequencePaintStrip, CustomXTick1H, CustomYTick1H, CustomXTick13C, CustomYTick13C,
//  NMRTooltip, RangeBarChart, OneDSpectrumPlot, SpectrumPlot, HSQCPlot, ThreeDScatter)
//  --> IDENTICI alla versione precedente. Riporto solo la firma; mantienili uguali.
const StructureSVGView = ({ structure, minWidth, isExpanded, onToggleExpand, selectedKeys, manualKeys = [], onAtomClick, height = '300px' }) => {
  const clickables = structure.elements.filter((e) => (e.type === 'circle' || e.type === 'text') && e.ri != null && e.keys && e.keys.length && onAtomClick);
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand} />}
      <div className={isExpanded ? FS_CLASSES + ' p-4 md:p-6 items-center justify-center' : 'flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid'}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? '↙️' : '↗️'}</button>
        <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
          <svg viewBox={structure.viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : height, minWidth }}>
            {structure.elements.filter((e) => e.type === 'line').map((el, idx) => (<line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'path').map((el, idx) => (<path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'polygon').map((el, idx) => (<polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />))}
            {structure.elements.filter((e) => e.type === 'circle').map((el, idx) => {
              const isSel = selectedKeys && el.keys && el.keys.some((k) => selectedKeys.includes(k));
              const isMan = manualKeys && el.keys && el.keys.some((k) => manualKeys.includes(k));
              return (
                <g key={`c${idx}`} pointerEvents="none">
                  {isSel && <circle cx={el.x} cy={el.y} r={el.r + 5} fill={SELECT_COLOR} opacity={0.25} />}
                  {isMan && !isSel && <circle cx={el.x} cy={el.y} r={el.r + 5} fill={MANUAL_COLOR} opacity={0.2} />}
                  <circle cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : 1.5} />
                </g>
              );
            })}
            {structure.elements.filter((e) => e.type === 'text').map((el, idx) => {
              const isSel = selectedKeys && el.keys && el.keys.some((k) => selectedKeys.includes(k));
              const isMan = manualKeys && el.keys && el.keys.some((k) => manualKeys.includes(k));
              return (
                <g key={`t${idx}`} pointerEvents="none">
                  {isSel && <circle cx={el.x} cy={el.y} r={el.text.length * 4 + 8} fill={SELECT_COLOR} opacity={0.25} />}
                  {isMan && !isSel && <circle cx={el.x} cy={el.y} r={el.text.length * 4 + 8} fill={MANUAL_COLOR} opacity={0.18} />}
                  <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                  <text x={el.x} y={el.y} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                </g>
              );
            })}
            {clickables.map((el, idx) => {
              const r = el.type === 'circle' ? Math.max(el.r + 4, 10) : el.text.length * (el.fontSize || 11) * 0.34 + 7;
              return (
                <circle key={`hit${idx}`} cx={el.x} cy={el.y} r={r} fill="transparent" style={{ cursor: 'pointer', pointerEvents: 'all' }} onClick={(e) => { e.stopPropagation(); onAtomClick(el.ri, el.keys); }}>
                  <title>{el.atoms ? el.atoms.join(', ') : ''}</title>
                </circle>
              );
            })}
          </svg>
        </div>
      </div>
    </>
  );
};
const SequencePaintStrip = ({ residues, getLetter, meta, onApply, focusIdx, charLabel }) => {
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const up = () => setPainting(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  return (
    <div className="flex flex-wrap gap-1.5 select-none">
      {residues.map((r, i) => {
        const l = getLetter(i);
        const m = meta[l] || { label: String(l), color: '#64748b' };
        const dim = focusIdx !== 'ALL' && focusIdx !== i;
        return (
          <button key={i} draggable={false} onDragStart={(e) => e.preventDefault()} onMouseDown={(e) => { e.preventDefault(); setPainting(true); onApply(i); }} onMouseEnter={() => { if (painting) onApply(i); }} title={`${r.id}: ${m.label}`} className="w-11 py-1 rounded-md border text-center leading-tight transition-all" style={{ backgroundColor: m.color + '22', borderColor: m.color, opacity: dim ? 0.35 : 1 }}>
            <div className="text-[8px] text-slate-500 font-bold">{i + 1}</div>
            <div className="text-sm font-black text-slate-800">{charLabel ? charLabel(r) : r.char}</div>
            <div className="text-[10px] font-black" style={{ color: m.color }}>{l}</div>
          </button>
        );
      })}
    </div>
  );
};
const CustomXTick1H = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomYTick1H = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomXTick13C = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 8 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(1) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomYTick13C = ({ x, y, payload, isZoomed, fs = 11 }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 10 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? fs - 1 : fs} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(1) : numVal}
        </text>
      )}
    </g>
  );
};
const NMRTooltip = ({ active, payload, diagonalColor, selectedKeys }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.min !== undefined) {
      return (
        <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
          <p className="font-bold text-slate-800">{data.res} - {data.atom}</p>
          <p className="text-slate-500">Theoretical Range: {data.min.toFixed(2)} - {data.max.toFixed(2)} ppm</p>
        </div>
      );
    }
    const isSel = selectedKeys && data.keys && data.keys.some((k) => selectedKeys.includes(k));
    if (data.type === '1D') {
      return (
        <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
          <p className="font-bold text-slate-800">{data.label}{isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}</p>
          <p className="text-slate-500">{data.x.toFixed(3)} ppm</p>
          {data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}
        </div>
      );
    }
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50">
        <p className="font-bold text-slate-800">{data.label}{isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}</p>
        <p className="font-semibold" style={{ color: data.type === 'Diagonal' ? diagonalColor : getNMRFillColor(data) }}>{data.type}</p>
        <p className="text-slate-500 text-xs mt-1">F2: {Number(data.x).toFixed(2)} ppm<br />F1: {Number(data.y).toFixed(2)} ppm</p>
      </div>
    );
  }
  return null;
};
const RangeBarChart = ({ title, ranges, domain, ticks, xAxisLabel, rowCount, rowLabels }) => {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(update); ro.observe(el); }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const margin = { top: 10, right: 24, bottom: 40, left: 56 };
  const rowH = 26;
  const nRows = Math.max(1, rowCount);
  const svgHeight = margin.top + nRows * rowH + margin.bottom;
  const plotW = Math.max(10, (width || 600) - margin.left - margin.right);
  const span = domain[1] - domain[0];
  const xScale = (v) => margin.left + ((domain[1] - v) / span) * plotW;
  const yCenter = (row) => margin.top + row * rowH + rowH / 2;
  const axisY = margin.top + nRows * rowH;
  return (
    <div ref={containerRef} className="bg-slate-50 rounded-xl border border-slate-200 p-3 relative">
      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 ml-1">{title}</h4>
      <svg width="100%" height={svgHeight} className="block select-none">
        {rowLabels.map((label, row) => (
          <g key={`row-${row}`}>
            {row % 2 === 0 && <rect x={margin.left} y={margin.top + row * rowH} width={plotW} height={rowH} fill="#f1f5f9" opacity={0.6} />}
            <text x={margin.left - 8} y={yCenter(row)} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight="bold" fill="#64748b">{label}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={`tick-${t}`}>
            <line x1={xScale(t)} y1={margin.top} x2={xScale(t)} y2={axisY} stroke="#e2e8f0" strokeWidth={1} />
            <line x1={xScale(t)} y1={axisY} x2={xScale(t)} y2={axisY + 5} stroke="#94a3b8" strokeWidth={1} />
            <text x={xScale(t)} y={axisY + 16} textAnchor="middle" fontSize={10} fill="#64748b">{t}</text>
          </g>
        ))}
        <line x1={margin.left} y1={axisY} x2={margin.left + plotW} y2={axisY} stroke="#cbd5e1" strokeWidth={1} />
        {ranges.map((r, i) => {
          const row = nRows - 1 - r.y;
          const x1 = xScale(r.max); const x2 = xScale(r.min);
          const cy = yCenter(row);
          const isHov = hover && hover.idx === i;
          return (
            <rect key={`range-${i}`} x={x1} y={cy - 5} width={Math.max(2, x2 - x1)} height={10} rx={3} fill={r.color} fillOpacity={isHov ? 1 : 0.75} stroke={r.color} strokeWidth={1} style={{ cursor: 'pointer' }}
              onMouseMove={(e) => { const crect = containerRef.current.getBoundingClientRect(); setHover({ idx: i, x: e.clientX - crect.left, y: e.clientY - crect.top }); }}
              onMouseLeave={() => setHover(null)} />
          );
        })}
        <text x={margin.left + plotW / 2} y={svgHeight - 6} textAnchor="middle" fontSize={11} fill="#64748b">{xAxisLabel}</text>
      </svg>
      {hover && ranges[hover.idx] && (
        <div className="absolute bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50 pointer-events-none whitespace-nowrap" style={{ left: hover.x + 12, top: Math.max(0, hover.y - 44) }}>
          <p className="font-bold text-slate-800">{ranges[hover.idx].res} - {ranges[hover.idx].atom}</p>
          <p className="text-slate-500">Theoretical Range: {ranges[hover.idx].min.toFixed(2)} - {ranges[hover.idx].max.toFixed(2)} ppm</p>
        </div>
      )}
    </div>
  );
};
// OneDSpectrumPlot, SpectrumPlot, HSQCPlot, ThreeDScatter: IDENTICI alla versione precedente.
// (Mantienili uguali; qui omessi per spazio ma vanno inclusi.)
const OneDSpectrumPlot = ({ title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel, selectedKeys, manualKeys = [], heightPx = 300, fs = 11, aspect = null }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState(fullDomain);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== fullDomain[0] || xDomain[1] !== fullDomain[1];
  const getXVal = (clientX) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN_1D.left - CHART_MARGIN_1D.right;
    if (plotW <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN_1D.left;
    const fx = Math.min(1, Math.max(0, px / plotW));
    return xDomain[1] - fx * (xDomain[1] - xDomain[0]);
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const xVal = getXVal(e.clientX); if (xVal !== null) setRefAreaRight(xVal); };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
      setRefAreaLeft(null); setRefAreaRight(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight]);
  const handleMouseDown = (e) => {
    const xVal = getXVal(e.clientX);
    if (xVal !== null) { isDragging.current = true; setRefAreaLeft(xVal); setRefAreaRight(xVal); }
  };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : `${heightPx}px` } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={(n) => { chartRef.current = n; boxRef.current = n; }} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={CHART_MARGIN_1D}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : ticks} interval={0} tickLine={false} tick={<TickComponent isZoomed={isZoomed} fs={fs} />} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis type="number" dataKey="y" domain={[0, 'auto']} hide={true} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip selectedKeys={selectedKeys} />} />
              <Bar dataKey="y" barSize={2} shape={(props) => {
                const { x, y, width, height, payload } = props;
                const centerX = x + width / 2;
                const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                const dimmed = selectedKeys && !isSel && !isMan;
                return <line x1={centerX} y1={y + height} x2={centerX} y2={y} stroke={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.color} strokeWidth={isSel ? 3 : isMan ? 2.5 : 1.5} opacity={dimmed ? 0.2 : 1} />;
              }} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};
const SpectrumPlot = ({ title, diagonalData, crossPeakData, expandedPanel, setExpandedPanel, panelId, diagonalColor, selectedKeys, manualKeys = [], aspect = 1, fs = 11 }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState([0, 11]);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 11;
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left;
    const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW));
    const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) {
          setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
          setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]);
        }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); }
  };
  const shape = (props) => {
    const { cx, cy, fill, payload } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
    const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
    const dimmed = selectedKeys && !isSel && !isMan && payload.type !== 'Diagonal';
    return (
      <g opacity={dimmed ? 0.18 : 1}>
        {isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={SELECT_COLOR} opacity={0.3} />}
        {isMan && !isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={MANUAL_COLOR} opacity={0.22} />}
        <circle cx={cx} cy={cy} r={isSel ? (payload.size || 5) + 2 : isMan ? (payload.size || 5) + 1.5 : payload.size || 5} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.type === 'Diagonal' ? fill : getNMRFillColor(payload)} stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'} strokeWidth={isSel ? 2 : isMan ? 1.5 : 0} opacity={0.85} />
      </g>
    );
  };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : '300px' } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div ref={(n) => { chartRef.current = n; boxRef.current = n; }} className="select-none relative flex-1 min-h-0" onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} />
              <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomYTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fs + 1 }} />
              <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter name="Diagonal" data={[{ x: 0, y: 0 }, { x: 11, y: 11 }]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={<circle r={0} />} legendType="none" isAnimationActive={false} />
              <Scatter data={diagonalData} fill={diagonalColor} shape={shape} isAnimationActive={false} />
              <Scatter data={crossPeakData} shape={shape} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};
const HSQCPlot = ({ title, crossPeakData, expandedPanel, setExpandedPanel, panelId, selectedKeys, manualKeys = [], yAxisLabel = '¹³C F1 (ppm)', yDomainInit = [0, 220], yTicks = TICKS_13C, aspect = 1, fs = 11 }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState(yDomainInit);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const [boxRef, boxW] = useMeasureWidth();
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== yDomainInit[0] || yDomain[1] !== yDomainInit[1];
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left;
    const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW));
    const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) {
          setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
          setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]);
        }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); }
  };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`} style={!isExpanded ? { height: aspect ? Math.max(260, Math.round((boxW || 400) * aspect)) : '300px' } : undefined}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain(yDomainInit); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div ref={(n) => { chartRef.current = n; boxRef.current = n; }} className="select-none relative flex-1 min-h-0" onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} fs={fs} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b', fontSize: fs + 1 }} />
              <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : yTicks} interval={0} tickLine={false} tick={<CustomYTick13C isZoomed={isZoomed} fs={fs} />} label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b', fontSize: fs + 1 }} />
              <Tooltip content={<NMRTooltip diagonalColor="#8b5cf6" selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter data={crossPeakData} shape={(props) => {
                const { cx, cy, payload } = props;
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                const dimmed = selectedKeys && !isSel && !isMan;
                return (
                  <g opacity={dimmed ? 0.18 : 1}>
                    {isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={SELECT_COLOR} opacity={0.3} />}
                    {isMan && !isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={MANUAL_COLOR} opacity={0.22} />}
                    <circle cx={cx} cy={cy} r={isSel ? (payload.size || 5) + 2 : isMan ? (payload.size || 5) + 1.5 : payload.size || 5} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : getNMRFillColor(payload)} stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'} strokeWidth={isSel ? 2 : isMan ? 1.5 : 0} opacity={0.85} />
                  </g>
                );
              }} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};
const ThreeDScatter = ({ seriesList, cfg, xLabel, yLabel, zLabel }) => {
  const [zoom, setZoom] = useState(1);
  const fs = cfg.fontSize || 11;
  const all = seriesList.flatMap((s) => s.pts);
  if (!all.length) return <div className="text-xs text-slate-400 italic p-6 text-center bg-slate-50 rounded-lg border border-dashed">No 3D data — both selected experimental-condition fields must be numeric.</div>;
  const rng = (vals) => { let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 1e-12) { mn -= 0.5; mx += 0.5; } return [mn, mx]; };
  const [x0, x1] = rng(all.map((p) => p.x));
  const [y0, y1] = rng(all.map((p) => p.y));
  const [z0, z1] = rng(all.map((p) => p.z));
  const norm = (v, a, b) => (v - a) / (b - a);
  const proj = (xn, yn, zn) => ({ X: (xn - yn) * Math.cos(Math.PI / 6), Y: (xn + yn) * Math.sin(Math.PI / 6) - zn * 1.15 });
  const corners = [];
  [0, 1].forEach((a) => [0, 1].forEach((b) => [0, 1].forEach((c) => corners.push(proj(a, b, c)))));
  const minX = Math.min(...corners.map((c) => c.X)), maxX = Math.max(...corners.map((c) => c.X));
  const minY = Math.min(...corners.map((c) => c.Y)), maxY = Math.max(...corners.map((c) => c.Y));
  const W = 680, H = 500, pad = 80;
  const s = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxY - minY)) * zoom;
  const tx = (X) => pad + (X - minX) * s + Math.max(0, (W - 2 * pad - (maxX - minX) * s) / 2);
  const ty = (Y) => pad + (Y - minY) * s + Math.max(0, (H - 2 * pad - (maxY - minY) * s) / 2);
  const pt = (xn, yn, zn) => { const p = proj(xn, yn, zn); return { x: tx(p.X), y: ty(p.Y) }; };
  const O = pt(0, 0, 0), Xe = pt(1, 0, 0), Ye = pt(0, 1, 0), Ze = pt(0, 0, 1);
  const grid = [];
  for (let i = 0; i <= 4; i++) { const t = i / 4; grid.push([pt(t, 0, 0), pt(t, 1, 0)]); grid.push([pt(0, t, 0), pt(1, t, 0)]); }
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  const tickVals = (a, b) => [a, (a + b) / 2, b];
  return (
    <div className="relative">
      <div className="absolute top-1 right-1 z-10 flex gap-1">
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-black text-slate-700">+</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))} className="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-sm font-black text-slate-700">−</button>
        <button type="button" onClick={() => setZoom(1)} className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-slate-600">Reset</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ maxHeight: cfg.height || 460 }}>
        {grid.map((g, i) => <line key={i} x1={g[0].x} y1={g[0].y} x2={g[1].x} y2={g[1].y} stroke="#e2e8f0" strokeWidth={1} />)}
        <line x1={O.x} y1={O.y} x2={Xe.x} y2={Xe.y} stroke="#64748b" strokeWidth={1.5} />
        <line x1={O.x} y1={O.y} x2={Ye.x} y2={Ye.y} stroke="#64748b" strokeWidth={1.5} />
        <line x1={O.x} y1={O.y} x2={Ze.x} y2={Ze.y} stroke="#64748b" strokeWidth={1.5} />
        {tickVals(x0, x1).map((v, i) => { const p = pt(norm(v, x0, x1), 0, 0); return <text key={`xt${i}`} x={p.x} y={p.y + 16} fontSize={fs - 1} fill="#64748b" textAnchor="middle">{fmt(v)}</text>; })}
        {tickVals(y0, y1).map((v, i) => { const p = pt(0, norm(v, y0, y1), 0); return <text key={`yt${i}`} x={p.x} y={p.y + 16} fontSize={fs - 1} fill="#64748b" textAnchor="middle">{fmt(v)}</text>; })}
        {tickVals(z0, z1).map((v, i) => { const p = pt(0, 0, norm(v, z0, z1)); return <text key={`zt${i}`} x={p.x - 10} y={p.y + 3} fontSize={fs - 1} fill="#64748b" textAnchor="end">{fmt(v)}</text>; })}
        <text x={Xe.x + 12} y={Xe.y + 14} fontSize={fs} fontWeight="bold" fill="#334155">{xLabel}</text>
        <text x={Ye.x - 12} y={Ye.y + 14} fontSize={fs} fontWeight="bold" fill="#334155" textAnchor="end">{yLabel}</text>
        <text x={Ze.x + 10} y={Ze.y - 8} fontSize={fs} fontWeight="bold" fill="#334155">{zLabel}</text>
        {seriesList.map((sr) => sr.pts.map((p, i) => {
          const q = pt(norm(p.x, x0, x1), norm(p.y, y0, y1), norm(p.z, z0, z1));
          const r = cfg.ptSize || 5;
          return (
            <circle key={`${sr.key}-${i}`} cx={q.x} cy={q.y} r={r} fill={sr.color} opacity={0.85} stroke="#fff" strokeWidth={0.8}>
              <title>{`${sr.label} | ${p.name}\n${xLabel}: ${fmt(p.x)}\n${yLabel}: ${fmt(p.y)}\n${zLabel}: ${fmt(p.z)}`}</title>
            </circle>
          );
        }))}
      </svg>
    </div>
  );
};

// ================= SHARED DERIVED DATA HOOK =================
const useNmrDerived = (activeTest, ctx = {}) => {
  const moleculeType = activeTest.moleculeType || 'protein';
  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();
  const validChars = moleculeType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY' : moleculeType === 'dna' ? 'ACGT' : moleculeType === 'rna' ? 'ACGU' : '';
  const seq = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna' ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '') : '';
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const images = activeTest.nmrSpectraImages || [];
  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';
  const hasPhosphorus = moleculeType === 'dna' || moleculeType === 'rna' || moleculeType === 'lipid';
  const DB = moleculeType === 'protein' ? AMINO_ACID_DB : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;
  const fields = getExperimentalFields(ctx);
  const instances = getInstances(ctx, activeTest);
  const activeInstanceId = ctx?.activeInstanceId || activeTest.id;
  const activeInstance = instances.find((i) => i.id === activeInstanceId) || instances[0] || null;
  const layers = getLayers(activeTest);
  const activeLayerKey = getActiveLayerKey(activeTest);
  const shifts = getInstanceValues(activeInstance, true, activeTest, 'cs');
  const activeValues = getInstanceValues(activeInstance, true, activeTest, activeLayerKey);
  const ssRaw = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');
  const formsRaw = activeTest.nucleicForms || '';
  const dnaFormDefault = activeTest.dnaForm || 'B';
  const getFormAt = (i) => (formsRaw[i] && 'ABZ'.includes(formsRaw[i]) ? formsRaw[i] : dnaFormDefault);
  const sugarConf = activeTest.sugarConf || 'chair';
  const sugarAnomer = activeTest.sugarAnomer || 'alpha';
  const lipidDB = activeTest.lipidDB || 'cis';
  const typeLabel = moleculeType === 'protein' ? 'Protein' : moleculeType === 'dna' ? 'DNA' : moleculeType === 'rna' ? 'RNA' : moleculeType === 'sugar' ? 'Sugar' : 'Phospholipid';
  const nucDefs = moleculeType === 'protein' ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] } : moleculeType === 'dna' || moleculeType === 'rna' ? { H: ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] } : { H: [], N: [], C: [] };
  const parsedSeq = useMemo(() => {
    let chars = [];
    if (isPolymer) { if (!seq) return []; chars = seq.split(''); }
    else if (moleculeType === 'sugar') chars = [activeTest.sugarChoice || 'GLC'];
    else if (moleculeType === 'lipid') chars = [activeTest.lipidChoice || 'POPC'];
    const assignedShifts = [];
    return chars.map((char, index) => {
      const entry = DB[char];
      if (!entry) return null;
      const generatedShifts = {};
      Object.keys(entry.ranges).forEach((atom) => {
        const r = entry.ranges[atom];
        let val = r.min;
        if (moleculeType === 'protein' && RANDOM_COIL_DB[char]) {
          if (atom === 'Hα' && RANDOM_COIL_DB[char].HA != null) {
            val = RANDOM_COIL_DB[char].HA;
            generatedShifts[atom] = parseFloat(val.toFixed(2));
            assignedShifts.push(val);
            return;
          }
        }
        let success = false; let minDistance = 0.3;
        while (minDistance >= 0.05 && !success) {
          for (let i = 0; i < 50; i++) {
            const candidate = r.min + Math.random() * (r.max - r.min);
            if (!assignedShifts.some((a) => Math.abs(a - candidate) < minDistance)) { val = candidate; success = true; break; }
          }
          minDistance -= 0.05;
        }
        assignedShifts.push(val);
        generatedShifts[atom] = parseFloat(val.toFixed(2));
      });
      const cShifts = {}; const generatedShifts13C = {};
      Object.keys(generatedShifts).forEach((atom) => {
        const cName = getCarbonName(moleculeType, char, atom);
        if (!cName) return;
        if (!cShifts[cName]) {
          let baseVal;
          if (moleculeType === 'protein' && RANDOM_COIL_DB[char]) {
            if (cName === 'Cα' && RANDOM_COIL_DB[char].CA != null) baseVal = RANDOM_COIL_DB[char].CA;
            else if (cName === 'Cβ' && RANDOM_COIL_DB[char].CB != null) baseVal = RANDOM_COIL_DB[char].CB;
          }
          if (baseVal === undefined) {
            const range = getCarbonRangeFor(moleculeType, char, cName);
            baseVal = range.min + Math.random() * (range.max - range.min);
          }
          cShifts[cName] = parseFloat(baseVal.toFixed(1));
        }
        generatedShifts13C[atom] = cShifts[cName];
      });
      const backboneRand = moleculeType === 'protein' ? { N: parseFloat((117 + Math.random() * 8).toFixed(1)), CP: RANDOM_COIL_DB[char]?.CO != null ? RANDOM_COIL_DB[char].CO : parseFloat((172 + Math.random() * 5).toFixed(1)) } : null;
      const p31 = hasPhosphorus ? parseFloat((-2 + Math.random() * 3).toFixed(2)) : null;
      return { ...entry, id: `${entry.code3 || char}${index + 1}`, char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts }, backboneRand, p31 };
    }).filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice]);
  const estSeq = useMemo(() => parsedSeq.map((res, idx) => {
    const ssLetter = moleculeType === 'protein' ? getSSAt(idx) : 'C';
    const ssKey = { C: 'coil', H: 'helix', E: 'sheet' }[ssLetter];
    const corr = SS_CORRECTIONS[ssKey];
    const estShifts = {};
    Object.keys(res.shifts || {}).forEach((a) => {
      let v = res.shifts[a];
      if (moleculeType === 'protein' && ssKey !== 'coil') { const h = corr.h; v += h[a] !== undefined ? h[a] : h.other || 0; }
      if (moleculeType === 'dna' || moleculeType === 'rna') { const f = getFormAt(idx); if (DNA_FORM_OFFSETS[f] && DNA_FORM_OFFSETS[f][a] !== undefined) v += DNA_FORM_OFFSETS[f][a]; }
      if (moleculeType === 'sugar') { const off = SUGAR_ANOMER_OFFSETS[sugarAnomer]; if (off && off[a] !== undefined) v += off[a]; }
      estShifts[a] = +v.toFixed(2);
    });
    const estUniqueC = {};
    Object.keys(res.uniqueCShifts || {}).forEach((cn) => {
      let v = res.uniqueCShifts[cn];
      if (moleculeType === 'protein' && ssKey !== 'coil') v += corr.c[cn] || 0;
      estUniqueC[cn] = +v.toFixed(2);
    });
    const estShifts13C = {};
    Object.keys(res.shifts13C || {}).forEach((a) => {
      const cn = getCarbonName(moleculeType, res.char, a);
      if (cn && estUniqueC[cn] !== undefined) estShifts13C[a] = estUniqueC[cn];
    });
    let estN = null; let estCP = null;
    if (moleculeType === 'protein' && res.backboneRand) {
      estN = +(res.backboneRand.N + (ssKey !== 'coil' ? corr.c['N'] || 0 : 0)).toFixed(2);
      estCP = +(res.backboneRand.CP + (ssKey !== 'coil' ? corr.c["C'"] || 0 : 0)).toFixed(2);
    }
    return { ...res, estShifts, estUniqueC, estShifts13C, estN, estCP, ssLetter, formLetter: getFormAt(idx) };
  }), [parsedSeq, moleculeType, ssRaw, formsRaw, dnaFormDefault, sugarAnomer]);
  const simSeq = useMemo(() => {
    const getMan = (idx, name) => {
      const candidates = [`${idx}-${name}`, `${idx}-${String(name).trim()}`, `${idx}-${String(name).replace(/\s+/g, '')}`];
      for (const k of candidates) { const m = parseManual(shifts[k]); if (m !== null) return m; }
      return null;
    };
    return estSeq.map((res, idx) => {
      const simShifts = {};
      Object.keys(res.estShifts || {}).forEach((a) => { const m = getMan(idx, a); simShifts[a] = m !== null ? m : res.estShifts[a]; });
      const simUniqueC = {};
      Object.keys(res.estUniqueC || {}).forEach((cn) => { const m = getMan(idx, cn); simUniqueC[cn] = m !== null ? m : res.estUniqueC[cn]; });
      const simShifts13C = {};
      Object.keys(res.estShifts13C || {}).forEach((a) => { const cn = getCarbonName(moleculeType, res.char, a); if (cn) simShifts13C[a] = simUniqueC[cn]; });
      let simN = null;
      if (moleculeType === 'protein' && res.estN !== null && res.estN !== undefined) { const mN = getMan(idx, 'N'); simN = mN !== null ? mN : res.estN; }
      let simCP = null;
      if (moleculeType === 'protein' && res.estCP !== null && res.estCP !== undefined) { const mCP = getMan(idx, "C'"); simCP = mCP !== null ? mCP : res.estCP; }
      return { ...res, simShifts, simUniqueC, simShifts13C, simN, simCP };
    });
  }, [estSeq, shifts, moleculeType]);
  const structure = useMemo(() => {
    if (parsedSeq.length === 0) return null;
    if (moleculeType === 'protein') return buildProteinStructure(parsedSeq);
    if (moleculeType === 'dna' || moleculeType === 'rna') return buildNucleicStructure(parsedSeq, moleculeType);
    if (moleculeType === 'sugar') return buildSugarStructure(parsedSeq[0], sugarConf, sugarAnomer);
    if (moleculeType === 'lipid') return buildLipidStructure(parsedSeq[0], lipidDB);
    return null;
  }, [parsedSeq, moleculeType, sugarConf, sugarAnomer, lipidDB]);
  const peaks = useMemo(() => {
    let diag = [], cosy = [], tocsy = [], noesy = [], hsqc = [], hsqc15n = [], d1H = [], d13C = [], p31 = [];
    const addPair = (arr, x, y, label, type, colorClass, size, keys) => {
      arr.push({ x, y, label, type, colorClass, size, keys });
      arr.push({ x: y, y: x, label, type, colorClass, size, keys });
    };
    simSeq.forEach((res, index) => {
      if (!res.simShifts) return;
      Object.entries(res.simShifts).forEach(([atom, ppm]) => {
        let pks = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        if (res.cosy) {
          res.cosy.forEach((pair) => {
            const neighborAtom = pair[0] === atom ? pair[1] : pair[1] === atom ? pair[0] : null;
            if (neighborAtom) {
              const count = getProtonCountEx(moleculeType, res, neighborAtom);
              totalNeighbors += count;
              const jC = 0.01 + Math.random() * 0.008;
              const pascalRow = getPascalRow(count);
              let newPeaks = [];
              pks.forEach((p) => { for (let k = 0; k <= count; k++) newPeaks.push({ shift: p.shift + (k - count / 2) * jC, intensity: p.intensity * pascalRow[k] }); });
              pks = newPeaks;
            }
          });
        }
        let merged = [];
        pks.sort((a, b) => a.shift - b.shift);
        pks.forEach((p) => {
          if (merged.length > 0) {
            const last = merged[merged.length - 1];
            if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; }
            else merged.push({ ...p });
          } else merged.push({ ...p });
        });
        const pCount = getProtonCountEx(moleculeType, res, atom);
        const maxIntensity = Math.max(...merged.map((p) => p.intensity));
        const baseIntensity = (1.5 + Math.random() * 0.5) * pCount;
        let multStr = 'm';
        if (totalNeighbors === 0) multStr = 's';
        else if (totalNeighbors === 1) multStr = 'd';
        else if (totalNeighbors === 2) multStr = merged.length === 3 ? 't' : 'dd';
        else if (totalNeighbors === 3) multStr = merged.length === 4 ? 'q' : 'm';
        const keys = buildKeys(index, [atom], moleculeType, res.char);
        merged.forEach((p) => d1H.push({ x: p.shift, y: (p.intensity / maxIntensity) * baseIntensity, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr, keys }));
      });
      Object.entries(res.simUniqueC || {}).forEach(([cName, ppm]) => {
        d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cName}`, color: res.color, type: '1D', keys: [`${index}-${cName}`] });
      });
      if (moleculeType === 'protein' && res.simCP !== null && res.simCP !== undefined) {
        d13C.push({ x: res.simCP, y: 0.8 + Math.random() * 0.4, label: `${res.id} C'`, color: res.color, type: '1D', keys: [`${index}-C'`] });
      }
      Object.keys(res.simShifts).forEach((atom) => {
        diag.push({ x: res.simShifts[atom], y: res.simShifts[atom], label: `${res.id} ${atom}`, type: 'Diagonal', size: 4, keys: buildKeys(index, [atom], moleculeType, res.char) });
      });
      if (res.cosy) res.cosy.forEach(([a1, a2]) => {
        if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) addPair(cosy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4, buildKeys(index, [a1, a2], moleculeType, res.char));
      });
      if (res.spinSystems) res.spinSystems.forEach((sys) => {
        for (let i = 0; i < sys.length; i++) for (let j = i + 1; j < sys.length; j++) {
          if (res.simShifts[sys[i]] !== undefined && res.simShifts[sys[j]] !== undefined) {
            const isDirect = res.cosy && res.cosy.some((c) => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i]));
            addPair(tocsy, res.simShifts[sys[i]], res.simShifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`, isDirect ? 'tocsyDirect' : 'tocsyRelay', 4, buildKeys(index, [sys[i], sys[j]], moleculeType, res.char));
          }
        }
      });
      const adj = {};
      if (res.cosy) res.cosy.forEach(([u, v]) => { if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
      const seenPairs = new Set();
      if (res.cosy) res.cosy.forEach(([a1, a2]) => {
        seenPairs.add([a1, a2].sort().join('-'));
        if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) addPair(noesy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (NOE Intra)`, 'noesyIntra', 4, buildKeys(index, [a1, a2], moleculeType, res.char));
      });
      Object.keys(adj).forEach((u) => adj[u].forEach((v) => adj[v].forEach((w) => {
        if (u !== w) {
          const pk = [u, w].sort().join('-');
          if (!seenPairs.has(pk)) {
            seenPairs.add(pk);
            if (res.simShifts[u] !== undefined && res.simShifts[w] !== undefined) addPair(noesy, res.simShifts[u], res.simShifts[w], res.id, `${u}-${w} (NOE 4-bond)`, 'noesyIntra4', 3, buildKeys(index, [u, w], moleculeType, res.char));
          }
        }
      })));
      if (index < simSeq.length - 1 && moleculeType === 'protein') {
        const nextRes = simSeq[index + 1];
        if (res.simShifts['HN'] !== undefined && nextRes.simShifts['HN'] !== undefined) {
          addPair(noesy, res.simShifts['HN'], nextRes.simShifts['HN'], 'Seq. NOE', `${res.id} HN ↔ ${nextRes.id} HN`, 'noesySeq', 3, [...buildKeys(index, ['HN'], 'protein', res.char), ...buildKeys(index + 1, ['HN'], 'protein', nextRes.char)]);
        }
      }
      Object.keys(res.simShifts13C || {}).forEach((atom) => {
        if (res.simShifts[atom] !== undefined) {
          const cn = getCarbonName(moleculeType, res.char, atom);
          hsqc.push({ x: res.simShifts[atom], y: res.simShifts13C[atom], label: `${res.id} ${atom}-${cn}`, type: 'HSQC', colorClass: 'hsqc', size: 4, keys: [...buildKeys(index, [atom], moleculeType, res.char), `${index}-${cn}`] });
        }
      });
      if (moleculeType === 'protein' && res.simN !== null && res.simN !== undefined && res.simShifts['HN'] !== undefined) {
        hsqc15n.push({ x: res.simShifts['HN'], y: res.simN, label: `${res.id} HN-N`, type: 'HSQC', colorClass: 'hsqc15n', size: 4, keys: [...buildKeys(index, ['HN'], moleculeType, res.char), `${index}-N`] });
      }
      if (hasPhosphorus && res.p31 !== null) {
        p31.push({ x: res.p31, y: 0.8 + Math.random() * 0.4, label: `${res.id} P`, color: res.color, type: '1D', colorClass: 'p31', keys: [`${index}-P`] });
      }
    });
    return { diagonalData: diag, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, hsqc15NPeaks: hsqc15n, data1H: d1H, data13C: d13C, p31Data: p31 };
  }, [simSeq, moleculeType, hasPhosphorus]);
  const uniqueTypes = useMemo(() => [...new Set(parsedSeq.map((r) => r.char))], [parsedSeq]);
  const ranges = useMemo(() => {
    const r1 = []; const r13 = [];
    uniqueTypes.forEach((char, index) => {
      const db = DB[char];
      if (!db) return;
      const color = RESIDUE_COLORS[Object.keys(DB).indexOf(char) % RESIDUE_COLORS.length];
      const label = db.code3 || char;
      const y = uniqueTypes.length - 1 - index;
      let atomIdx = 0;
      Object.keys(db.ranges).forEach((atom) => {
        const r = db.ranges[atom];
        r1.push({ x: (r.min + r.max) / 2, res: label, atom, min: r.min, max: r.max, y, color, level: atomIdx++ });
      });
      const cNames = new Set();
      Object.keys(db.ranges).forEach((atom) => { const cn = getCarbonName(moleculeType, char, atom); if (cn) cNames.add(cn); });
      if (moleculeType === 'protein') cNames.add("C'");
      let cIdx = 0;
      cNames.forEach((cn) => {
        const rg = getCarbonRangeFor(moleculeType, char, cn);
        r13.push({ x: (rg.min + rg.max) / 2, res: label, atom: cn, min: rg.min, max: rg.max, y, color, level: cIdx++ });
      });
    });
    return { ranges1H: r1, ranges13C: r13 };
  }, [uniqueTypes, moleculeType]);
  const atomOptions = useMemo(() => {
    const opts = [];
    estSeq.forEach((res, idx) => {
      Object.keys(res.estShifts || {}).forEach((a) => opts.push({ key: `${idx}-${a}`, label: `${res.id} ${a} (¹H)` }));
      if (moleculeType === 'protein' && res.estN !== null) opts.push({ key: `${idx}-N`, label: `${res.id} N (¹⁵N)` });
      Object.keys(res.estUniqueC || {}).forEach((cn) => opts.push({ key: `${idx}-${cn}`, label: `${res.id} ${cn} (¹³C)` }));
      if (moleculeType === 'protein' && res.estCP !== null) opts.push({ key: `${idx}-C'`, label: `${res.id} C' (¹³C)` });
      if (hasPhosphorus && res.p31 !== null) opts.push({ key: `${idx}-P`, label: `${res.id} P (³¹P)` });
    });
    return opts;
  }, [estSeq, moleculeType, hasPhosphorus]);
  return {
    moleculeType, seq, validChars, isPolymer, hasPhosphorus, DB, selNuc, shifts, images,
    fields, instances, activeInstanceId, activeInstance, layers, activeLayerKey, activeValues, atomOptions,
    getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, dnaFormDefault, typeLabel, nucDefs,
    parsedSeq, estSeq, simSeq, structure, peaks, uniqueTypes, ranges
  };
};

// ================= IMPORT HELPERS (generic + SPARKY) — IDENTICI alla versione precedente =================
const GREEK_MAP = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'h' };
const normAtomName = (s) => String(s || '').trim().replace(/\s+/g, '').split('').map((ch) => GREEK_MAP[ch] || ch).join('').toUpperCase();
const ATOM_ALIASES = { HA: 'Hα', HB: 'Hβ', HG: 'Hγ', HD: 'Hδ', HE: 'Hε', HZ: 'Hζ', CA: 'Cα', CB: 'Cβ', CG: 'Cγ', CD: 'Cδ', CE: 'Cε', CZ: 'Cζ', C: "C'", CO: "C'", N: 'N', H: 'HN', HN: 'HN' };
const resolveAtom = (res, atomRaw, nameMap = {}) => {
  if (!res) return null;
  const pool = [...(res.atoms || [])];
  if (res.backboneRand) pool.push('N', "C'");
  Object.keys(res.uniqueCShifts || {}).forEach((c) => pool.push(c));
  const raw = String(atomRaw || '').trim();
  const cands = [raw, nameMap[raw], ATOM_ALIASES[normAtomName(raw)], raw.replace(/\s+/g, '')].filter(Boolean);
  for (const cand of cands) {
    const hit = pool.find((a) => normAtomName(a) === normAtomName(cand));
    if (hit) return hit;
  }
  return null;
};
const buildResLookup = (parsedSeq) => {
  const map = {};
  parsedSeq.forEach((r, i) => {
    map[String(i)] = i;
    map[String(i + 1)] = i;
    map[r.id.toLowerCase()] = i;
    map[(r.char + (i + 1)).toLowerCase()] = i;
    if (r.code3) map[(r.code3 + (i + 1)).toLowerCase()] = i;
  });
  return map;
};
const parseTableText = (text) => {
  const delim = text.includes('\t') ? '\t' : (text.split(';').length > text.split(',').length ? ';' : ',');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l) => l.split(delim).map((c) => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const iRes = head.findIndex((h) => /(res|position|seq|#)/.test(h));
  const iAtom = head.findIndex((h) => /(atom|nucleus|group|assignment)/.test(h));
  const iVal = head.findIndex((h) => /(value|shift|ppm|assign|intens|delta)/.test(h));
  const hasHeader = iAtom >= 0 || iVal >= 0;
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return rows.map((r) => ({
    res: r[hasHeader && iRes >= 0 ? iRes : 0],
    atom: r[hasHeader ? (iAtom >= 0 ? iAtom : 1) : 1],
    value: r[hasHeader ? (iVal >= 0 ? iVal : 2) : 2]
  })).filter((r) => r.atom);
};
const importRowsToValues = (rows, parsedSeq, nameMap = {}) => {
  const lookup = buildResLookup(parsedSeq);
  const out = {}; const missed = [];
  rows.forEach((r) => {
    const ri = lookup[String(r.res).toLowerCase().trim()];
    if (ri === undefined) { missed.push(r); return; }
    const atom = resolveAtom(parsedSeq[ri], r.atom, nameMap);
    if (!atom) { missed.push(r); return; }
    out[`${ri}-${atom}`] = String(r.value);
  });
  return { out, missed };
};
const remapAtomKeys = (values, parsedSeq, nameMap = {}) => {
  const out = {};
  Object.entries(values || {}).forEach(([k, v]) => {
    const parts = k.split('-');
    if (parts.length < 2) return;
    const ri = Number(parts[0]);
    const res = parsedSeq[ri];
    if (!res) return;
    const atom = resolveAtom(res, parts.slice(1).join('-'), nameMap);
    if (atom) out[`${ri}-${atom}`] = String(v);
  });
  return out;
};
const detectSparkyFormat = (text) => {
  if (/^\s*VARS/im.test(text) || /^\s*FORMAT/im.test(text) || /^\s*S\s+[\d-]/im.test(text)) return 'peaklist';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let hits = 0;
  lines.forEach((l) => { if (/^[A-Za-z]+\s?\d+[\s,]+[A-Za-z0-9'″"αβγδεζ]+[\s,]+[-+0-9.]+$/.test(l)) hits++; });
  return hits > 0 ? 'assignments' : 'peaklist';
};
const parseSparkyPeakList = (text) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let vars = null;
  const raw = [];
  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.startsWith('VARS')) { vars = line.replace(/^VARS/i, '').trim().split(/[\s,]+/).map((v) => v.toUpperCase()); continue; }
    if (/^(FORMAT|TITL|TITLE|AXES|TYPE|NE|NP|NC|SW|SF|XMIN|XMAX|YMIN|YMAX|XP|YP|FP|HZPPM|DATASET)/.test(up)) continue;
    const cleaned = line.replace(/^S\s+/i, '');
    const parts = cleaned.split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 2) raw.push(parts);
  }
  const idx = (names) => (vars ? vars.findIndex((v) => names.includes(v)) : -1);
  const iXf = idx(['X_PPM', 'X_AXIS', 'W2', 'X', 'PPM2', 'F2_PPM', 'F2']);
  const iX = iXf >= 0 ? iXf : 0;
  const iY = idx(['Y_PPM', 'Y_AXIS', 'W1', 'Y', 'PPM1', 'F1_PPM', 'F1']);
  const iInt = idx(['DATA', 'DATA1', 'INT', 'INTENSITY', 'HEIGHT', 'H']);
  const iVol = idx(['VOL', 'VOLUME', 'INTEGRAL', 'INTG']);
  const iAss = idx(['ASS', 'ASSIGNS', 'ASSIGNMENT', 'ASSIGNMENTS', 'ASSIGN', 'LABEL']);
  const isNum = (s) => s !== undefined && /^[-+0-9.eE]+$/.test(s) && !isNaN(parseFloat(s));
  return raw.map((parts) => {
    if (vars) {
      return {
        x: parseManual(parts[iX]),
        y: iY >= 0 ? parseManual(parts[iY]) : null,
        int: iInt >= 0 ? parseManual(parts[iInt]) : null,
        vol: iVol >= 0 ? parseManual(parts[iVol]) : null,
        ass: iAss >= 0 ? parts[iAss] : ''
      };
    }
    const nums = parts.filter(isNum).map(parseFloat);
    const strs = parts.filter((p) => !isNum(p));
    return { x: nums[0] ?? null, y: nums[1] ?? null, int: nums[2] ?? null, vol: nums[3] ?? null, ass: strs.join(' ') };
  }).filter((p) => p.x !== null || p.y !== null);
};
const parseAssignmentString = (str) => {
  const pieces = String(str || '').split(/[,;|]+/).map((s) => s.trim()).filter(Boolean);
  const out = []; let lastRes = null;
  pieces.forEach((pc) => {
    const toks = pc.replace(/[-–]/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    let res = null, atom = null;
    if (toks.length === 1) {
      const mm = toks[0].match(/^([A-Za-z]+)(\d+)$/);
      if (mm) { lastRes = toks[0]; return; }
      if (lastRes) { res = lastRes; atom = toks[0]; }
    } else {
      if (/^[A-Za-z]+\d+$/.test(toks[0])) { res = toks[0]; atom = toks.slice(1).join(' '); lastRes = res; }
      else if (/^\d+$/.test(toks[0]) && toks.length > 1 && /^[A-Za-z]/.test(toks[1])) { res = toks[0]; atom = toks.slice(1).join(' '); }
      else if (toks.length > 1 && /^\d+$/.test(toks[1])) { res = toks[0] + toks[1]; atom = toks.slice(2).join(' '); lastRes = res; }
      else if (lastRes) { res = lastRes; atom = toks.join(' '); }
    }
    if (res && atom) out.push({ res, atom });
  });
  return out;
};
const parseSparkyAssignments = (text) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line) => {
    if (line.startsWith('#') || /^(VARS|FORMAT)/i.test(line)) return;
    let m = line.match(/^([A-Za-z]+[\s-]?\d+)[\s,]+([A-Za-z0-9'″"αβγδεζ]+)[\s,]+([-+0-9.]+)/);
    if (m) { out.push({ res: m[1], atom: m[2], value: m[3] }); return; }
    m = line.match(/^([A-Za-z]+\d+[-_][A-Za-z0-9'″"αβγδεζ]+)[\s,]+([-+0-9.]+)/);
    if (m) { const pieces = m[1].split(/[-_]/); out.push({ res: pieces[0], atom: pieces[1], value: m[2] }); }
  });
  return out;
};

// ================= 1) EXPERIMENT SETUP =================
// (ExperimentSetupSection — IDENTICO alla versione precedente, senza la sezione "Experimental Parameters")
const ExperimentSetupSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const structureMode = activeTest.structureMode || '2d';
  const atomLabelMode = activeTest.atomLabelMode || 'selected';
  const residueOffset = activeTest.residueOffset || 0;
  const atomNameMap = useMemo(() => { try { return activeTest.atomNameMap ? JSON.parse(activeTest.atomNameMap) : {}; } catch { return {}; } }, [activeTest.atomNameMap]);
  const [hasOpened3D, setHasOpened3D] = useState(structureMode === '3d');
  useEffect(() => { if (structureMode === '3d') setHasOpened3D(true); }, [structureMode]);
  useEffect(() => {
    const t = setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 100);
    return () => clearTimeout(t);
  }, [structureMode, hasOpened3D]);
  const structureSrc = useMemo(() => {
    const raw = (activeTest.structureSrc || activeTest.pdbId || '').trim();
    if (!raw) {
      if (d.moleculeType === 'protein') return 'https://models.rcsb.org/1UBQ.mmtf';
      if (d.moleculeType === 'dna') return 'https://models.rcsb.org/1BNA.mmtf';
      if (d.moleculeType === 'rna') return 'https://models.rcsb.org/1EHZ.mmtf';
      if (d.moleculeType === 'lipid') return `/structures/${(activeTest.lipidChoice || 'POPC').toUpperCase()}.pdb`;
      if (d.moleculeType === 'sugar') return `/structures/${activeTest.sugarChoice || 'GLC'}.sdf`;
      return '';
    }
    if (/^(https?:|blob:|data:)/i.test(raw) || raw.startsWith('/') || raw.startsWith('./')) return raw;
    if (/^[0-9][A-Za-z0-9]{3}$/.test(raw)) return `https://models.rcsb.org/${raw.toUpperCase()}.mmtf`;
    return raw;
  }, [activeTest.structureSrc, activeTest.pdbId, d.moleculeType, activeTest.lipidChoice, activeTest.sugarChoice]);
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [ssBrush, setSSBrush] = useState('H');
  const [formBrush, setFormBrush] = useState(activeTest.dnaForm || 'B');
  const [sugarBrushAnomer, setSugarBrushAnomer] = useState(activeTest.sugarAnomer || 'alpha');
  const [sugarBrushConf, setSugarBrushConf] = useState(activeTest.sugarConf || 'chair');
  const [lipidBrush, setLipidBrush] = useState(activeTest.lipidDB || 'cis');
  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);
  const handleAtomClick = (ri, keys) => {
    if (ri === null || !keys) return;
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };
  const paintSSAt = (i, letter) => { const arr = d.seq.split('').map((_, j) => d.getSSAt(j)); arr[i] = letter; updateActiveTest({ secondaryStructure: arr.join('') }); };
  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: d.seq.split('').map(() => letter).join('') });
  const paintFormAt = (i, letter) => { const arr = d.seq.split('').map((_, j) => d.getFormAt(j)); arr[i] = letter; updateActiveTest({ nucleicForms: arr.join('') }); };
  const setAllForms = (letter) => updateActiveTest({ nucleicForms: d.seq.split('').map(() => letter).join(''), dnaForm: letter });
  const exportFormulaToNotebook = () => {
    if (!d.structure) return;
    const html = `<div style="margin-top:10px;"><h5 style="color:#1e40af;font-size:12px;margin-bottom:6px;">🔬 Chemical Formula (${d.typeLabel}):</h5>` + elementsToSVG(d.structure, 300) + `</div>`;
    const currentComments = activeTest.comments || '';
    updateActiveTest({ comments: currentComments + (currentComments ? ' <br/>' : '') + html });
    alert('Chemical formula appended to the Lab Notebook notes.');
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2 mb-2">
        {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugars'], ['lipid', '🫧 Phospholipids']].map(([val, lab]) => (
          <button key={val} onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            {lab}
          </button>
        ))}
      </div>
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{d.typeLabel} Sequence (1-letter code)</label>
              <textarea value={activeTest.proteinSequence || ''} onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
                placeholder={d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'} />
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
        <div className="w-full md:w-64 flex flex-col gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
            <div className="flex flex-col gap-2">
              {['H', 'N', 'C', ...(d.hasPhosphorus ? ['P'] : [])].map((n) => (
                <label key={n} className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors">
                  <input type="checkbox" checked={d.selNuc.includes(n)}
                    onChange={() => updateActiveTest({ selectedNuclei: d.selNuc.includes(n) ? d.selNuc.filter((x) => x !== n) : [...d.selNuc, n] })}
                    className="w-4 h-4 cursor-pointer accent-blue-600" />
                  <span className="font-bold text-slate-700">{n === 'H' ? '¹H' : n === 'N' ? '¹⁵N' : n === 'C' ? '¹³C' : '³¹P'}</span>
                </label>
              ))}
            </div>
          </div>
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
          <SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getSSAt(i)} meta={SS_META} onApply={(i) => paintSSAt(i, ssBrush)} focusIdx={focusIdx} />
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
          <p className="text-xs text-slate-400 mb-3">💡 Select a brush, then click or drag across the sequence chips to paint the nucleic acid form per residue.</p>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={(i) => d.getFormAt(i)} meta={FORM_META} onApply={(i) => paintFormAt(i, formBrush)} focusIdx={focusIdx} />
        </div>
      )}
      {d.moleculeType === 'sugar' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Anomer brush:</span>
            {[['alpha', 'α-anomer', '#0ea5e9'], ['beta', 'β-anomer', '#f97316']].map(([val, lab, col]) => (
              <button key={val} onClick={() => setSugarBrushAnomer(val)} className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: sugarBrushAnomer === val ? col : 'white', borderColor: col, color: sugarBrushAnomer === val ? 'white' : col }}>{lab}</button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">Chair brush:</span>
            {[['chair', 'Chair (⁴C₁)', '#22c55e'], ['invChair', 'Inverted chair (¹C₄)', '#a855f7']].map(([val, lab, col]) => (
              <button key={val} onClick={() => setSugarBrushConf(val)} className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: sugarBrushConf === val ? col : 'white', borderColor: col, color: sugarBrushConf === val ? 'white' : col }}>{lab}</button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-3">💡 Select the anomer brush (α/β) and the ring-conformation brush, then click the sugar chip to apply.</p>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={() => (d.sugarAnomer === 'beta' ? 'β' : 'α')}
            meta={{ β: { label: 'β-anomer', color: '#f97316' }, α: { label: 'α-anomer', color: '#0ea5e9' } }}
            onApply={() => updateActiveTest({ sugarAnomer: sugarBrushAnomer, sugarConf: sugarBrushConf })}
            focusIdx={focusIdx} charLabel={(r) => r.code3 || r.char} />
        </div>
      )}
      {d.moleculeType === 'lipid' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {[['cis', 'cis Δ9', '#0ea5e9'], ['trans', 'trans Δ9', '#f43f5e']].map(([val, lab, col]) => (
              <button key={val} onClick={() => setLipidBrush(val)} className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: lipidBrush === val ? col : 'white', borderColor: col, color: lipidBrush === val ? 'white' : col }}>{lab}</button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-3">💡 Select the cis/trans brush, then click the lipid chip to set the geometry of the Δ9 double bond.</p>
          <SequencePaintStrip residues={d.parsedSeq} getLetter={() => d.lipidDB}
            meta={{ cis: { label: 'cis Δ9', color: '#0ea5e9' }, trans: { label: 'trans Δ9', color: '#f43f5e' } }}
            onApply={() => updateActiveTest({ lipidDB: lipidBrush })} focusIdx={focusIdx} charLabel={(r) => r.char} />
        </div>
      )}
      {d.structure && (
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button onClick={() => updateActiveTest({ structureMode: '2d' })} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '2d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>2D Formula</button>
              <button onClick={() => updateActiveTest({ structureMode: '3d' })} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${structureMode === '3d' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>3D Viewer</button>
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
            <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">PDB ID / URL / local file</label>
                <input type="text" value={activeTest.structureSrc || ''} onChange={(e) => updateActiveTest({ structureSrc: e.target.value })} placeholder="e.g. 1UBQ or /structures/POPC.pdb" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500" />
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
                <label className="text-[10px] font-bold text-slate-500 uppercase">Residue offset</label>
                <input type="number" value={residueOffset} onChange={(e) => updateActiveTest({ residueOffset: Number(e.target.value) || 0 })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Atom-name map JSON</label>
                <input type="text" value={activeTest.atomNameMap || ''} onChange={(e) => updateActiveTest({ atomNameMap: e.target.value })} placeholder='{"HA":"Hα","HB1":"Hβ1"}' className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-mono" />
              </div>
            </div>
          )}
          <p className="text-xs text-slate-400 mb-2">💡 Click an atom in the {structureMode === '2d' ? 'formula' : '3D viewer'} to highlight its cell in the assignment table and its peaks in the spectra.</p>
          <div style={{ display: structureMode === '3d' ? 'block' : 'none' }} aria-hidden={structureMode !== '3d'}>
            {hasOpened3D && (
              <NMRMoleculeViewer key={structureSrc || 'no-structure-src'} src={structureSrc} moleculeType={d.moleculeType} parsedSeq={d.parsedSeq}
                selectedKeys={selectedKeys} manualKeys={manualKeys} onAtomClick={handleAtomClick} residueOffset={residueOffset}
                atomNameMap={atomNameMap} labelMode={atomLabelMode} height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? '620px' : '520px'} />
            )}
          </div>
          <div style={{ display: structureMode === '2d' ? 'block' : 'none' }} aria-hidden={structureMode !== '2d'}>
            <StructureSVGView structure={d.structure}
              minWidth={d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'}
              isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')}
              selectedKeys={selectedKeys} manualKeys={manualKeys} onAtomClick={handleAtomClick}
              height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'} />
          </div>
        </div>
      )}
    </div>
  );
};

// ================= 2) DATA (DataSection + ImportPanel — IDENTICI alla versione precedente) =================
// (DataSection e ImportPanel identici alla versione precedente: import Sparky, tabella, layer, export)
const ImportPanel = ({ ctx, d }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [mode, setMode] = useState('file');
  const [layerKey, setLayerKey] = useState(d.activeLayerKey);
  const [pasteText, setPasteText] = useState('');
  const [report, setReport] = useState(null);
  const [srcId, setSrcId] = useState('');
  const [copyFromId, setCopyFromId] = useState('');
  const [sparkyFmt, setSparkyFmt] = useState('auto');
  const [sparkyText, setSparkyText] = useState('');
  const [importCS, setImportCS] = useState(true);
  const [importInt, setImportInt] = useState(true);
  const [importVol, setImportVol] = useState(true);
  const fileRef = useRef(null);
  const sparkyFileRef = useRef(null);
  const nameMap = useMemo(() => { try { return activeTest.atomNameMap ? JSON.parse(activeTest.atomNameMap) : {}; } catch { return {}; } }, [activeTest.atomNameMap]);
  const sources = Array.isArray(ctx?.importSources) ? ctx.importSources : [];
  const applyValues = (vals) => {
    const nv = { ...(activeTest.nmrValues || {}) };
    nv[layerKey] = { ...(nv[layerKey] || {}), ...vals };
    updateActiveTest({ nmrValues: nv });
  };
  const handleText = (text) => {
    let vals = {}; let missed = 0;
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        vals = remapAtomKeys(j, d.parsedSeq, nameMap);
        missed = Object.keys(j).length - Object.keys(vals).length;
      }
    } catch {
      const r = importRowsToValues(parseTableText(text), d.parsedSeq, nameMap);
      vals = r.out; missed = r.missed.length;
    }
    applyValues(vals);
    setReport({ ok: Object.keys(vals).length, missed });
  };
  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    handleText(text);
    if (fileRef.current) fileRef.current.value = '';
  };
  const importFromSource = async () => {
    const s = sources.find((x) => x.id === srcId);
    if (!s) return;
    try {
      let data = typeof s.getData === 'function' ? s.getData() : s.data;
      if (data && typeof data.then === 'function') data = await data;
      let vals = data?.values?.[layerKey] || data?.values?.cs || data?.nmrValues?.[layerKey] || data?.chemicalShifts || data || {};
      vals = remapAtomKeys(vals, d.parsedSeq, nameMap);
      applyValues(vals);
      setReport({ ok: Object.keys(vals).length, missed: 0 });
    } catch (err) {
      setReport({ ok: 0, missed: -1, error: String(err) });
    }
  };
  const importFromInstance = () => {
    const src = d.instances.find((c) => c.id === copyFromId);
    if (!src) return;
    const vals = getInstanceValues(src, src.id === d.activeInstanceId, activeTest, layerKey);
    applyValues(vals);
    setReport({ ok: Object.keys(vals).length, missed: 0 });
  };
  const handleSparkyText = (text) => {
    if (!text || !text.trim()) return;
    const fmt = sparkyFmt === 'auto' ? detectSparkyFormat(text) : sparkyFmt;
    const lookup = buildResLookup(d.parsedSeq);
    const resolve = (resStr, atomStr) => {
      const ri = lookup[String(resStr).toLowerCase().trim()];
      if (ri === undefined) return null;
      const atom = resolveAtom(d.parsedSeq[ri], atomStr, nameMap);
      if (!atom) return null;
      return `${ri}-${atom}`;
    };
    if (fmt === 'assignments') {
      const rows = parseSparkyAssignments(text);
      const vals = {}; let missed = 0;
      rows.forEach((r) => {
        const key = resolve(r.res, r.atom);
        if (!key) { missed++; return; }
        vals[key] = String(r.value);
      });
      applyValues(vals);
      setReport({ ok: Object.keys(vals).length, missed, note: 'Sparky assignments → Chemical Shift layer' });
      return;
    }
    const peaks = parseSparkyPeakList(text);
    const wanted = [];
    if (importInt) wanted.push({ key: 'int', label: 'Peak Intensity', unit: 'a.u.' });
    if (importVol) wanted.push({ key: 'vol', label: 'Peak Integral', unit: 'a.u.' });
    const layerMap = wanted.length ? ensureLayers(activeTest, updateActiveTest, wanted) : {};
    const csVals = {}; const intVals = {}; const volVals = {};
    let matched = 0; let missed = 0;
    peaks.forEach((p) => {
      const assigns = parseAssignmentString(p.ass || '');
      const aX = assigns.length >= 2 ? assigns[1] : assigns[0] || null;
      const aY = assigns.length >= 2 ? assigns[0] : null;
      const kX = aX ? resolve(aX.res, aX.atom) : null;
      const kY = aY ? resolve(aY.res, aY.atom) : null;
      if (kX || kY) matched++; else missed++;
      if (importCS) {
        if (kX && p.x !== null) csVals[kX] = String(p.x);
        if (kY && p.y !== null) csVals[kY] = String(p.y);
      }
      const storeKey = kX || kY;
      if (storeKey) {
        if (importInt && p.int !== null) intVals[storeKey] = String(p.int);
        if (importVol && p.vol !== null) volVals[storeKey] = String(p.vol);
      }
    });
    const nv = { ...(activeTest.nmrValues || {}) };
    if (importCS) nv['cs'] = { ...(nv['cs'] || {}), ...csVals };
    if (importInt && layerMap.int) nv[layerMap.int] = { ...(nv[layerMap.int] || {}), ...intVals };
    if (importVol && layerMap.vol) nv[layerMap.vol] = { ...(nv[layerMap.vol] || {}), ...volVals };
    updateActiveTest({ nmrValues: nv });
    setReport({
      ok: matched, missed,
      note: `Sparky peak list → CS:${Object.keys(csVals).length}${importInt ? ` · Intensity:${Object.keys(intVals).length}` : ''}${importVol ? ` · Integral:${Object.keys(volVals).length}` : ''} (layers auto-created)`
    });
  };
  const handleSparkyFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    handleSparkyText(text);
    if (sparkyFileRef.current) sparkyFileRef.current.value = '';
  };
  return (
    <div className="mt-3 p-4 bg-sky-50 border border-sky-200 rounded-xl flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold text-sky-800 uppercase">Import into “{d.activeInstance ? d.activeInstance.name : 'active instance'}”</span>
        <select value={layerKey} onChange={(e) => setLayerKey(e.target.value)} className="border border-sky-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-sky-500 font-semibold">
          {d.layers.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        <div className="flex bg-white border border-sky-300 p-1 rounded-lg flex-wrap">
          {[['file', '📄 File'], ['paste', '📋 Paste'], ['sparky', '✨ Sparky'], ['cond', '⧉ Condition']].map(([m, lab]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`px-2.5 py-1 text-xs font-bold rounded-md ${mode === m ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-sky-100'}`}>{lab}</button>
          ))}
        </div>
      </div>
      {mode === 'file' && (
        <div className="text-xs text-slate-600">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.json" onChange={handleFile} className="text-xs" />
          <p className="text-[10px] text-slate-400 mt-1">CSV/TSV columns: <b>Residue, Atom, Value</b> (header auto-detected; residue as “Ala3”, “A3” or index). JSON: {'{"0-HN": 8.2, ...}'}.</p>
        </div>
      )}
      {mode === 'paste' && (
        <div className="flex flex-col gap-2">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'Residue,Atom,Value\nAla3,HN,8.21\n...'} className="w-full h-28 border border-sky-300 rounded-lg p-2 text-xs font-mono bg-white outline-none focus:border-sky-500" />
          <button type="button" onClick={() => handleText(pasteText)} disabled={!pasteText.trim()} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs w-fit">Import pasted data</button>
        </div>
      )}
      {mode === 'sparky' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-3">
            <SelField label="Format" value={sparkyFmt} onChange={setSparkyFmt}
              options={[['auto', 'Auto-detect'], ['peaklist', 'Sparky peak list (.list)'], ['assignments', 'Sparky assignment file (.assign)']]} />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500">Import (peak list)</label>
              <div className="flex gap-3 text-[10px] font-bold text-slate-700">
                <label className="flex items-center gap-1"><input type="checkbox" checked={importCS} onChange={(e) => setImportCS(e.target.checked)} className="accent-sky-600" /> Chemical shifts</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={importInt} onChange={(e) => setImportInt(e.target.checked)} className="accent-sky-600" /> Peak intensities</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={importVol} onChange={(e) => setImportVol(e.target.checked)} className="accent-sky-600" /> Peak integrals (volumes)</label>
              </div>
            </div>
            <input ref={sparkyFileRef} type="file" accept=".list,.peaks,.txt,.assign,.csv" onChange={handleSparkyFile} className="text-xs" />
          </div>
          <textarea value={sparkyText} onChange={(e) => setSparkyText(e.target.value)}
            placeholder={'…or paste Sparky content here, e.g.\nVARS INDEX,X_PPM,Y_PPM,DATA,VOL,ASS\nS 1,8.32,120.4,1.2e6,4.5e7,GLY1 HN,GLY1 N\n…or assignment lines:\nGLY1 HN 8.32\nGLY1 N 120.4'}
            className="w-full h-28 border border-sky-300 rounded-lg p-2 text-xs font-mono bg-white outline-none focus:border-sky-500" />
          <button type="button" onClick={() => handleSparkyText(sparkyText)} disabled={!sparkyText.trim()} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs w-fit">Import Sparky data</button>
        </div>
      )}
      {mode === 'tab' && (
        <div className="flex flex-col gap-2 text-xs">
          {sources.length === 0 ? (
            <p className="text-slate-400 italic">No tabs exposed by the host app. The main program can provide <code className="bg-white px-1 rounded">ctx.importSources = [{'{ id, label, getData() }'}…]</code> to enable cross-tab import.</p>
          ) : (
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500">Source tab</label>
                <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className="border border-sky-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
                  <option value="">-- select --</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.label || s.id}</option>)}
                </select>
              </div>
              <button type="button" onClick={importFromSource} disabled={!srcId} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs">Import from tab</button>
            </div>
          )}
        </div>
      )}
      {mode === 'cond' && (
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500">Copy layer values from (top-of-page instance)</label>
            <select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)} className="border border-sky-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none">
              <option value="">-- select instance --</option>
              {d.instances.filter((c) => c.id !== d.activeInstanceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={importFromInstance} disabled={!copyFromId} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-1.5 rounded-lg text-xs">Copy</button>
        </div>
      )}
      {report && (
        <p className={`text-xs font-bold ${report.error ? 'text-red-600' : 'text-emerald-700'}`}>
          {report.error ? `Import error: ${report.error}` : `✅ ${report.note || `Imported ${report.ok} values`}${report.missed > 0 ? ` · ⚠️ ${report.missed} rows not matched (residue/atom names)` : ''}`}
        </p>
      )}
    </div>
  );
};
const DataSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerUnit, setNewLayerUnit] = useState('');
  const [showImport, setShowImport] = useState(false);
  const effTableMode = d.moleculeType === 'sugar' || d.moleculeType === 'lipid' ? 'all' : tableMode;
  const selectedKeys = getSelectedKeys(activeTest);
  const isCS = d.activeLayerKey === 'cs';
  const activeLayer = d.layers.find((l) => l.key === d.activeLayerKey) || CHEMICAL_SHIFT_LAYER;
  const addLayer = () => {
    const label = newLayerName.trim();
    if (!label) return;
    const layer = { key: makeLayerId(), label, unit: newLayerUnit.trim() || '' };
    updateActiveTest({ parameterLayers: [...(activeTest.parameterLayers || []), layer], activeLayerKey: layer.key });
    setNewLayerName(''); setNewLayerUnit('');
  };
  const removeLayer = (key) => {
    if (key === 'cs') return;
    const upd = (activeTest.parameterLayers || []).filter((l) => l.key !== key);
    updateActiveTest({ parameterLayers: upd, activeLayerKey: d.activeLayerKey === key ? 'cs' : d.activeLayerKey });
  };
  const handleShiftChange = (resIdx, atom, val) => writeCellValue(activeTest, updateActiveTest, d.activeLayerKey, `${resIdx}-${atom}`, val);
  const handleCellClick = (e, idx, atom) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const keys = buildKeys(idx, [atom], d.moleculeType, d.parsedSeq[idx]?.char);
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };
  const cellIsSelected = (idx, atom) => Boolean(selectedKeys && selectedKeys.includes(`${idx}-${atom}`));
  const fillEstimated = () => {
    if (!isCS) return;
    const cs = {};
    d.estSeq.forEach((res, idx) => {
      Object.entries(res.estShifts || {}).forEach(([a, v]) => { cs[`${idx}-${a}`] = String(v); });
      Object.entries(res.estUniqueC || {}).forEach(([cn, v]) => { cs[`${idx}-${cn}`] = String(v); });
      if (res.estN !== null) cs[`${idx}-N`] = String(res.estN);
      if (res.estCP !== null) cs[`${idx}-C'`] = String(res.estCP);
    });
    updateActiveTest({ nmrValues: { ...(activeTest.nmrValues || {}), cs } });
  };
  const clearLayer = () => updateActiveTest({ nmrValues: { ...(activeTest.nmrValues || {}), [d.activeLayerKey]: {} } });
  const exportCSV = () => {
    const rows = [['Instance', ...d.fields.map((f) => f.label), 'Parameter', 'Residue', 'Nucleus', 'Atom', 'Value', 'Estimated (ppm)']];
    const expVals = d.fields.map((f) => getExpValue(d.activeInstance, f.key));
    d.estSeq.forEach((res, idx) => {
      const base = [d.activeInstance ? d.activeInstance.name : '', ...expVals, activeLayer.label, res.id];
      if (d.selNuc.includes('H')) Object.keys(res.estShifts || {}).forEach((a) => rows.push([...base, '1H', a, d.activeValues[`${idx}-${a}`] || '', isCS ? res.estShifts[a] : '']));
      if (d.moleculeType === 'protein') {
        if (d.selNuc.includes('N') && res.estN !== null) rows.push([...base, '15N', 'N', d.activeValues[`${idx}-N`] || '', isCS ? res.estN : '']);
        if (d.selNuc.includes('C')) {
          Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([...base, '13C', cn, d.activeValues[`${idx}-${cn}`] || '', isCS ? res.estUniqueC[cn] : '']));
          if (res.estCP !== null) rows.push([...base, '13C', "C'", d.activeValues[`${idx}-C'`] || '', isCS ? res.estCP : '']);
        }
      } else if (d.selNuc.includes('C')) {
        Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([...base, '13C', cn, d.activeValues[`${idx}-${cn}`] || '', isCS ? res.estUniqueC[cn] : '']));
      }
      if (d.hasPhosphorus && d.selNuc.includes('P') && res.p31 !== null) rows.push([...base, '31P', 'P', d.activeValues[`${idx}-P`] || '', isCS ? res.p31 : '']);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NMR_${(d.activeInstance ? d.activeInstance.name : 'data').replace(/[^a-z0-9]+/gi, '_')}_${activeLayer.label.replace(/[^a-z0-9]+/gi, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const selTdCls = (isMan, isSel) => `px-3 py-1 cursor-pointer transition-colors ${isSel ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`;
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-indigo-800 uppercase">Active instance (from the top of the page):</span>
        <span className="text-sm font-black text-indigo-900">{d.activeInstance ? d.activeInstance.name : '—'}</span>
        {d.fields.map((f) => {
          const v = getExpValue(d.activeInstance, f.key);
          if (v === '') return null;
          return <span key={f.key} className="text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full">{f.label}: {v}</span>;
        })}
        <span className="text-[9px] text-indigo-400 ml-auto">Add / switch instances at the top of the page (main program).</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-slate-500">Editing: <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span> · <span className="text-blue-700">{activeLayer.label}</span></span>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setShowImport(!showImport)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${showImport ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'}`}>📥 Import data…</button>
            {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && (
              <div className="flex bg-slate-200 p-1 rounded-lg mr-2">
                <button onClick={() => { setTableMode('backbone'); updateActiveTest({ tableMode: 'backbone' }); }} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === 'backbone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Backbone</button>
                <button onClick={() => { setTableMode('all'); updateActiveTest({ tableMode: 'all' }); }} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>All Atoms</button>
                <button onClick={() => { setTableMode('unified'); updateActiveTest({ tableMode: 'unified' }); }} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${effTableMode === 'unified' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Unified</button>
              </div>
            )}
            {isCS && <button onClick={fillEstimated} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100">🪄 Fill with estimated</button>}
            <button onClick={clearLayer} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100">🧹 Clear {activeLayer.label}</button>
            <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1 shadow-sm">📊 Export XLS (CSV)</button>
          </div>
        </div>
        {showImport && <ImportPanel ctx={ctx} d={d} />}
      </div>
      {selectedKeys && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-800 w-fit">
          🎯 Selected: {selectionLabel(d, selectedKeys)}
          <button onClick={() => updateActiveTest({ selectedAtomKeys: [] })} className="ml-1 text-amber-600 hover:text-red-600 font-black" title="Clear selection">✕</button>
        </div>
      )}

{d.parsedSeq.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
          Enter a sequence / select a molecule (in Experiment Setup) to generate the table.
        </div>
      ) : effTableMode === 'backbone' ? (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-20 text-center">Res</th>
                {d.moleculeType === 'protein' && <th className="px-2 py-2 font-bold border-b border-slate-200 text-center">SS</th>}
                {d.selNuc.includes('H') && d.nucDefs.H.map((a) => <th key={a} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">{a} {activeLayer.unit ? `(${activeLayer.unit})` : '(ppm)'}</th>)}
                {d.selNuc.includes('N') && d.nucDefs.N.map((a) => <th key={a} className="px-3 py-2 font-bold text-emerald-700 border-b border-slate-200 bg-emerald-50/50">{a} {activeLayer.unit ? `(${activeLayer.unit})` : '(ppm)'}</th>)}
                {d.selNuc.includes('C') && d.nucDefs.C.map((a) => <th key={a} className="px-3 py-2 font-bold text-purple-700 border-b border-slate-200 bg-purple-50/50">{a} {activeLayer.unit ? `(${activeLayer.unit})` : '(ppm)'}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                return (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{res.id}</td>
                    {d.moleculeType === 'protein' && (
                      <td className="px-2 py-1 text-center"><span className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white" style={{ backgroundColor: SS_META[res.ssLetter].color }}>{res.ssLetter}</span></td>
                    )}
                    {d.selNuc.includes('H') && d.nucDefs.H.map((a) => {
                      const isMan = parseManual(d.activeValues[`${idx}-${a}`]) !== null;
                      const isSel = cellIsSelected(idx, a);
                      const est = res.estShifts?.[a];
                      return (
                        <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                          <input type="text" value={d.activeValues[`${idx}-${a}`] || ''} onChange={(e) => handleShiftChange(idx, a, e.target.value)} className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`} placeholder="—" />
                          {isCS && est !== undefined && <div className="text-[13px] font-bold text-blue-600 text-center mt-0.5">≈ {est.toFixed(2)}</div>}
                        </td>
                      );
                    })}
                    {d.selNuc.includes('N') && d.nucDefs.N.map((a) => {
                      const isMan = parseManual(d.activeValues[`${idx}-${a}`]) !== null;
                      const isSel = cellIsSelected(idx, a);
                      return (
                        <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                          <input type="text" value={d.activeValues[`${idx}-${a}`] || ''} onChange={(e) => handleShiftChange(idx, a, e.target.value)} className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-emerald-500'}`} placeholder="—" />
                          {isCS && res.estN !== null && <div className="text-[13px] font-bold text-emerald-600 text-center mt-0.5">≈ {res.estN.toFixed(2)}</div>}
                        </td>
                      );
                    })}
                    {d.selNuc.includes('C') && d.nucDefs.C.map((a) => {
                      const isMan = parseManual(d.activeValues[`${idx}-${a}`]) !== null;
                      const isSel = cellIsSelected(idx, a);
                      const est = a === "C'" ? res.estCP : res.estUniqueC?.[a];
                      return (
                        <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                          <input type="text" value={d.activeValues[`${idx}-${a}`] || ''} onChange={(e) => handleShiftChange(idx, a, e.target.value)} className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-purple-500'}`} placeholder="—" />
                          {isCS && est !== undefined && est !== null && <div className="text-[13px] font-bold text-purple-600 text-center mt-0.5">≈ {est.toFixed(2)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Nucleus / Atom</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Value {activeLayer.unit ? `(${activeLayer.unit})` : '(ppm)'}</th>
                {isCS && <th className="px-3 py-2 font-bold border-b border-slate-200">Estimated (ppm)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;

                // Extract all atoms for this specific residue from the existing atomOptions map
                const resAtoms = d.atomOptions.filter((opt) => opt.key.startsWith(`${idx}-`));

                return resAtoms.map((opt, aIdx) => {
                  const atomName = opt.key.slice(String(idx).length + 1);
                  const isMan = parseManual(d.activeValues[opt.key]) !== null;
                  const isSel = cellIsSelected(idx, atomName);

                  // Determine estimated value for display based on nucleus type
                  let est = undefined;
                  if (opt.label.includes('(¹H)')) est = res.estShifts?.[atomName];
                  else if (opt.label.includes('(¹³C)')) est = atomName === "C'" ? res.estCP : res.estUniqueC?.[atomName];
                  else if (opt.label.includes('(¹⁵N)')) est = res.estN;
                  else if (opt.label.includes('(³¹P)')) est = res.p31;

                  return (
                    <tr key={opt.key} className="hover:bg-slate-50 transition-colors">
                      {aIdx === 0 && (
                        <td rowSpan={resAtoms.length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">
                          {res.id}
                        </td>
                      )}
                      <td className="px-3 py-1.5 font-bold text-slate-600">
                        {opt.label.replace(`${res.id} `, '')}
                      </td>
                      <td className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, atomName)}>
                        <input
                          type="text"
                          value={d.activeValues[opt.key] || ''}
                          onChange={(e) => handleShiftChange(idx, atomName, e.target.value)}
                          className={`w-full border rounded px-2 py-1 outline-none text-xs font-mono max-w-[150px] ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`}
                          placeholder="—"
                        />
                      </td>
                      {isCS && (
                        <td className="px-3 py-1.5 text-xs font-mono text-slate-500">
                          {est !== undefined && est !== null ? `≈ ${est.toFixed(2)}` : '—'}
                        </td>
                      )}
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
          <label className="text-xs font-bold text-slate-600 uppercase">🗂️ Parameter Layer (assignment table data type)</label>
          <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">Switch between Chemical Shift & user-defined parameters</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-3">
          {d.layers.map((l) => (
            <div key={l.key} className="inline-flex items-center">
              <button type="button" onClick={() => updateActiveTest({ activeLayerKey: l.key })} className={`px-3 py-1.5 rounded-l-lg text-xs font-bold border transition-colors ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{l.label}{l.unit ? ` (${l.unit})` : ''}</button>
              {!l.builtin ? (
                <button type="button" onClick={() => removeLayer(l.key)} className={`px-2 py-1.5 rounded-r-lg border border-l-0 text-xs font-black ${d.activeLayerKey === l.key ? 'bg-blue-600 border-blue-700 text-blue-200 hover:text-white' : 'bg-white border-slate-300 text-slate-400 hover:text-red-500'}`} title="Delete parameter">×</button>
              ) : (
                <span className="px-2 py-1.5 rounded-r-lg border border-l-0 bg-slate-100 border-slate-300 text-slate-400 text-xs">🔒</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">New parameter name</label>
            <input type="text" value={newLayerName} onChange={(e) => setNewLayerName(e.target.value)} placeholder="e.g. T1 Relaxation, Peak Intensity" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-56 bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
            <input type="text" value={newLayerUnit} onChange={(e) => setNewLayerUnit(e.target.value)} placeholder="e.g. s, a.u." className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-24 bg-white" />
          </div>
          <button type="button" onClick={addLayer} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit">+ Add Parameter Layer</button>
        </div>
      </div>
    </div>
  );
};

// ================= SECONDARY CHEMICAL SHIFTS (SCSPlot + SecondaryShiftsSection — IDENTICI alla versione precedente) =================
const SCSPlot = ({ title, data, color, cfg }) => {
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const isDragging = useRef(false);
  const fSize = cfg.fontSize || 11;
  const barC = cfg.barColor || color;
  const negC = cfg.negColor || '#ef4444';
  const showHLine = !!cfg.showHLine;
  const hLineVal = parseFloat(cfg.hLineVal) || 0;
  const aspect = parseFloat(cfg.aspect) || 2;
  const xLab = cfg.xAxisTitle || 'Residues';
  const yLab = cfg.yAxisTitle || 'Δδ (ppm)';
  const initialDomain = [0, Math.max(10, data.length)];
  const [xDomain, setXDomain] = useState(initialDomain);
  const isZoomed = xDomain[0] !== initialDomain[0] || xDomain[1] !== initialDomain[1];
  const chartRef = useRef(null);
  const getXVal = (clientX) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - 50 - 20;
    if (plotW <= 0) return null;
    const px = clientX - rect.left - 50;
    const fx = Math.min(1, Math.max(0, px / plotW));
    return xDomain[0] + fx * (xDomain[1] - xDomain[0]);
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const xVal = getXVal(e.clientX); if (xVal !== null) setRefAreaRight(xVal); };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
      setRefAreaLeft(null); setRefAreaRight(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight]);
  const handleMouseDown = (e) => {
    const xVal = getXVal(e.clientX);
    if (xVal !== null) { isDragging.current = true; setRefAreaLeft(xVal); setRefAreaRight(xVal); }
  };
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-2 flex flex-col relative" onMouseDown={handleMouseDown} ref={chartRef}>
      <div className="flex justify-between items-center mb-1">
        <h5 className="text-[12px] font-bold text-slate-700">{title}</h5>
        {isZoomed && <button onClick={() => setXDomain(initialDomain)} className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-0.5 rounded z-10">Reset Zoom</button>}
      </div>
      <div className="flex-1 w-full" style={{ aspectRatio: String(aspect) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 15, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis type="number" dataKey="idx" domain={xDomain} allowDataOverflow tickFormatter={(val) => data[val]?.label || ''} tick={{ fontSize: fSize }} label={{ value: xLab, position: 'insideBottom', offset: -10, fontSize: fSize + 1 }} />
            <YAxis tick={{ fontSize: fSize }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 10, fontSize: fSize + 1 }} />
            <Tooltip content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const dd = payload[0].payload;
                return (
                  <div className="bg-white p-2 shadow rounded border border-slate-200 text-xs">
                    <p className="font-bold">{dd.label}</p>
                    <p>{yLab}: <span style={{ color: dd.v >= 0 ? barC : negC }}>{dd.v.toFixed(3)}</span></p>
                  </div>
                );
              }
              return null;
            }} />
            <ReferenceLine y={0} stroke="#94a3b8" />
            {showHLine && <ReferenceLine y={hLineVal} stroke="#eab308" strokeDasharray="4 4" label={{ value: `Max: ${hLineVal}`, fill: '#eab308', fontSize: fSize, position: 'insideTopRight' }} />}
            {showHLine && <ReferenceLine y={-hLineVal} stroke="#eab308" strokeDasharray="4 4" />}
            <Bar dataKey="v" isAnimationActive={false}>
              {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.v >= 0 ? barC : negC} />)}
            </Bar>
            {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
const SecondaryShiftsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const scsCfg = activeTest.scsCfg || {
    fontSize: 11, barColorHA: '#3b82f6', barColorCA: '#8b5cf6', barColorCB: '#f59e0b', barColorCO: '#22c55e', negColor: '#ef4444',
    showHLine: true, hLineVal: 1.5, aspect: 2.5, xAxisTitle: 'Residues', yAxisTitle: 'Δδ (ppm)'
  };
  const setCfg = (patch) => updateActiveTest({ scsCfg: { ...scsCfg, ...patch } });
  const [showConfig, setShowConfig] = useState(false);
  if (d.moleculeType !== 'protein' || !d.parsedSeq.length) return (<div className="text-center py-8 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed">SCS requires a protein sequence.</div>);
  const cs = d.shifts;
  const rows = d.estSeq.map((res, idx) => {
    const rc = RANDOM_COIL_DB[res.char] || {};
    const getVal = (k, estVal) => {
      const manual = parseManual(cs[`${idx}-${k}`]);
      return manual !== null ? manual : estVal;
    };
    const HA = getVal('Hα', res.estShifts?.['Hα']);
    const CA = getVal('Cα', res.estUniqueC?.['Cα']);
    const CB = getVal('Cβ', res.estUniqueC?.['Cβ']);
    const CO = getVal("C'", res.estCP);
    return {
      label: res.id, idx,
      HA: HA != null && rc.HA != null ? HA - rc.HA : null,
      CA: CA != null && rc.CA != null ? CA - rc.CA : null,
      CB: CB != null && rc.CB != null ? CB - rc.CB : null,
      CO: CO != null && rc.CO != null ? CO - rc.CO : null
    };
  }).filter((r) => activeTest.focusIdx === undefined || activeTest.focusIdx === 'ALL' || r.idx === activeTest.focusIdx);
  const mk = (k) => rows.map((r, i) => ({ label: r.label, v: r[k], idx: i })).filter((x) => x.v !== null);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-2 w-fit">
        <button onClick={() => setShowConfig(!showConfig)} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded shadow-sm font-bold text-slate-700 hover:bg-slate-100">⚙️ Customize SCS Graphs</button>
      </div>
      {showConfig && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-300 shadow-sm">
          <NumField label="Font size" value={scsCfg.fontSize} onChange={(v) => setCfg({ fontSize: v || 11 })} />
          <NumField label="Aspect ratio (W/H)" step={0.1} value={scsCfg.aspect} onChange={(v) => setCfg({ aspect: v || 2.5 })} />
          <TxtField label="X axis title" value={scsCfg.xAxisTitle} onChange={(v) => setCfg({ xAxisTitle: v })} />
          <TxtField label="Y axis title" value={scsCfg.yAxisTitle} onChange={(v) => setCfg({ yAxisTitle: v })} />
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Show Max H-Line</label>
            <input type="checkbox" checked={scsCfg.showHLine} onChange={(e) => setCfg({ showHLine: e.target.checked })} className="accent-blue-600 mt-1 h-4 w-4" />
          </div>
          <NumField label="H-Line value" step={0.1} value={scsCfg.hLineVal} onChange={(v) => setCfg({ hLineVal: v })} />
          {[['barColorHA', 'ΔHα color'], ['barColorCA', 'ΔCα color'], ['barColorCB', 'ΔCβ color'], ['barColorCO', "ΔC′ color"], ['negColor', 'Negative bars color']].map(([k, lab]) => (
            <div key={k} className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500">{lab}</label>
              <input type="color" value={scsCfg[k] || '#3b82f6'} onChange={(e) => setCfg({ [k]: e.target.value })} className="w-10 h-8 rounded cursor-pointer border border-slate-300" />
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SCSPlot title="ΔHα (HA)" data={mk('HA')} color={scsCfg.barColorHA} cfg={{ ...scsCfg, barColor: scsCfg.barColorHA }} />
        <SCSPlot title="ΔCα (CA)" data={mk('CA')} color={scsCfg.barColorCA} cfg={{ ...scsCfg, barColor: scsCfg.barColorCA }} />
        <SCSPlot title="ΔCβ (CB)" data={mk('CB')} color={scsCfg.barColorCB} cfg={{ ...scsCfg, barColor: scsCfg.barColorCB }} />
        <SCSPlot title="ΔC′ (CO)" data={mk('CO')} color={scsCfg.barColorCO} cfg={{ ...scsCfg, barColor: scsCfg.barColorCO }} />
      </div>
    </div>
  );
};

// ================= 3) FITTING — CONDITION PLOTS (MODIFICATO) =================
// MODIFICHE CHIAVE:
//  - linea ordinata per X (non torna più indietro)
//  - warning quando le ALTRE condizioni sperimentali differiscono tra le istanze
//  - opzione "Exclude non-comparable points"
const makePlotId = () => `cp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const defaultPlotCfg = (n) => ({
  id: makePlotId(), title: `Condition Plot ${n}`, layerKey: 'cs', atoms: [],
  xField: 'temperature', yField: '', chartType: 'line',
  fitEnabled: false, fitModel: 'linear', customExpr: '',
  showPoints: true, showErrors: true, showFit: true,
  useFixedSD: false, fixedSDStr: '', outlierThreshStr: '2.5',
  excludeNonComparable: false,
  hiddenSeries: {}, excluded: {}, manualSD: {}, usedInstances: {}, hLines: [], showMaxLines: false,
  style: { ...DEFAULT_CHART_STYLE }
});
const ConditionPlotPanel = ({ ctx, d, plot, updatePlot, removePlot, duplicatePlot }) => {
  const { activeTest, updateActiveTest } = ctx;
  const cfg = { ...DEFAULT_CHART_STYLE, ...(plot.style || {}) };
  const [atomSearch, setAtomSearch] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [hVal, setHVal] = useState('');
  const [hLab, setHLab] = useState('');
  const chartRef = useRef(null);
  const isHist = (plot.chartType || 'line') === 'hist';
  const is3D = plot.chartType === '3d';
  const set = (patch) => updatePlot(plot.id, patch);
  const setCfg = (patch) => updatePlot(plot.id, { style: { ...cfg, ...patch } });
  const plotLayer = d.layers.find((l) => l.key === plot.layerKey) || d.layers[0];
  const experimentalFields = d.fields;
  const effXField = experimentalFields.some((f) => f.key === plot.xField) ? plot.xField : (experimentalFields[0]?.key || 'temperature');
  const xFieldLabel = experimentalFields.find((f) => f.key === effXField)?.label || effXField;
  const filtered = d.atomOptions.filter((o) => !atomSearch.trim() || o.label.toLowerCase().includes(atomSearch.toLowerCase()));
  const toggleAtom = (key) => set({ atoms: plot.atoms.includes(key) ? plot.atoms.filter((k) => k !== key) : [...plot.atoms, key] });
  const selectAllFiltered = () => set({ atoms: Array.from(new Set([...plot.atoms, ...filtered.map((o) => o.key)])) });
  const presets = Array.isArray(activeTest.atomSelectionPresets) ? activeTest.atomSelectionPresets : [];
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || plot.atoms.length === 0) return;
    updateActiveTest({ atomSelectionPresets: [...presets, { id: makePlotId(), name, atoms: [...plot.atoms] }] });
    setPresetName('');
  };
  const applyPreset = (id) => { const p = presets.find((x) => x.id === id); if (p) set({ atoms: [...(p.atoms || [])] }); };
  const deletePreset = (id) => updateActiveTest({ atomSelectionPresets: presets.filter((x) => x.id !== id) });
  const used = plot.usedInstances || {};
  const toggleInstance = (iid) => set({ usedInstances: { ...used, [iid]: used[iid] === false ? undefined : false } });

  // ---- Comparabilità: individua le istanze con condizioni diverse da quelle più comuni ----
  const comparableInfo = useMemo(() => {
    const xFieldKey = effXField;
    const groupFields = experimentalFields.filter((f) =>
      f.key !== xFieldKey && (!is3D || f.key !== plot.yField)
    );
    const usedInstances = d.instances.filter((inst) => used[inst.id] !== false);
    const signatures = usedInstances.map((inst) => ({
      inst,
      sig: groupFields.map((f) => String(getExpValue(inst, f.key) ?? '')).join('|')
    }));
    const sigCounts = {};
    signatures.forEach(({ sig }) => { sigCounts[sig] = (sigCounts[sig] || 0) + 1; });
    const mostCommonSig = Object.keys(sigCounts).sort((a, b) => sigCounts[b] - sigCounts[a])[0];
    const comparableInstIds = new Set(signatures.filter((s) => s.sig === mostCommonSig).map((s) => s.inst.id));
    const varyingFields = groupFields.filter((f) => {
      const vals = new Set(usedInstances.map((inst) => String(getExpValue(inst, f.key) ?? '')));
      return vals.size > 1;
    });
    const nonComparableCount = signatures.filter((s) => s.sig !== mostCommonSig).length;
    return { comparableInstIds, varyingFields, nonComparableCount, hasMismatch: nonComparableCount > 0 };
  }, [d.instances, used, effXField, plot.yField, is3D, experimentalFields]);
  const isComparable = (instId) => !plot.excludeNonComparable || comparableInfo.comparableInstIds.has(instId);

  // ---- Series: un punto per istanza top-of-page, ordinati per X ----
  const series = useMemo(() => plot.atoms.map((ak) => {
    const opt = d.atomOptions.find((o) => o.key === ak);
    const pts = [];
    d.instances.forEach((inst) => {
      if (used[inst.id] === false) return;
      if (!isComparable(inst.id)) return; // esclude punti non comparabili
      const vals = getInstanceValues(inst, inst.id === d.activeInstanceId, activeTest, plot.layerKey);
      const v = parseManual(vals[ak]);
      if (v === null) return;
      pts.push({
        instId: inst.id, name: inst.name,
        x: parseManual(getExpValue(inst, effXField)),
        y: v,
        y2: plot.yField ? parseManual(getExpValue(inst, plot.yField)) : null,
        excluded: !!((plot.excluded[ak] || {})[inst.id])
      });
    });
    // ORDINAMENTO per X: evita che la linea torni indietro
    pts.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    return { key: ak, label: opt ? opt.label : ak, pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
}), [plot.atoms, plot.layerKey, d.instances, d.atomOptions, plot.excluded, effXField, plot.yField, used, activeTest.nmrValues, plot.excludeNonComparable, comparableInfo]);

  const colorOf = (s) => seriesColor(cfg, s.key, series.findIndex((q) => q.key === s.key));
  const includedPts = (s) => s.pts.filter((p) => !p.excluded);
  const maxOf = (s) => { const v = includedPts(s).map((p) => p.y); return v.length ? Math.max(...v) : null; };
  const effSD = (sKey, p) => {
    const man = (plot.manualSD[sKey] || {})[p.instId];
    if (typeof man === 'number' && Number.isFinite(man)) return man;
    if (plot.useFixedSD) { const f = parseManual(plot.fixedSDStr); if (f !== null) return f; }
    return null;
  };
  const fitOf = (s) => {
    if (!plot.fitEnabled || is3D || isHist) return null;
    const wpts = includedPts(s).filter((p) => p.x !== null).map((p) => {
      const sd = effSD(s.key, p);
      return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1 };
    });
    return runFit(plot.fitModel, plot.customExpr, wpts);
  };
  const fits = useMemo(() => {
    const out = {};
    series.forEach((s) => { out[s.key] = fitOf(s); });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, plot.fitEnabled, plot.fitModel, plot.customExpr, plot.chartType, plot.manualSD, plot.useFixedSD, plot.fixedSDStr]);
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
  const autoTouch = (s) => {
    const fit = fits[s.key] || fitOf(s);
    if (!fit || !fit.f) return;
    const inner = { ...(plot.manualSD[s.key] || {}) };
    includedPts(s).forEach((p) => {
      if (p.x === null) return;
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
        const pts = s.pts.filter((p) => !((excluded[s.key] || {})[p.instId]) && p.x !== null);
        if (pts.length < 4) break;
        const wpts = pts.map((p) => { const sd = effSD(s.key, p); return { x: p.x, y: p.y, w: sd && sd > 0 ? 1 / (sd * sd) : 1, p }; });
        const fit = runFit(plot.fitModel, plot.customExpr, wpts);
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
  const visibleSeries = series.filter((s) => !plot.hiddenSeries[s.key]);
  const xs = visibleSeries.flatMap((s) => includedPts(s).filter((p) => p.x !== null).map((p) => p.x));
  const padX = xs.length ? ((Math.max(...xs) - Math.min(...xs)) * 0.05 || 1) : 1;
  const dataXDomain = xs.length ? [Math.min(...xs) - padX, Math.max(...xs) + padX] : [0, 1];
  const zoom = useXZoom(chartRef, dataXDomain);
  const xTicks = makeTicks(zoom.domain, cfg.tickStep);
  const catData = useMemo(() => {
    return d.instances.filter((inst) => used[inst.id] !== false).map((inst) => {
      const row = { __condition: inst.name };
      series.forEach((s) => {
        const p = s.pts.find((q) => q.instId === inst.id);
        if (p && !p.excluded) { row[s.key] = p.y; row[`${s.key}__sd`] = effSD(s.key, p); }
        else { row[s.key] = null; row[`${s.key}__sd`] = null; }
      });
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.instances, series, used, plot.manualSD, plot.useFixedSD, plot.fixedSDStr]);
  const numData = (s) => includedPts(s).filter((p) => p.x !== null).sort((a, b) => a.x - b.x).map((p) => ({ x: p.x, y: p.y, sd: effSD(s.key, p), name: p.name }));
  const fitData = (s) => {
    const fit = fits[s.key];
    if (!fit || !fit.f) return [];
    const [mn, mx] = zoom.domain;
    if (!(mx > mn)) return [];
    const out = [];
    for (let i = 0; i <= 60; i++) { const x = mn + ((mx - mn) * i) / 60; out.push({ x, y: fit.f(x) }); }
    return out;
  };
  const makeDot = (color, s) => (props) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={`d-${s.key}-${index}`} />;
    const r = cfg.ptSize || 5;
    let el;
    if (cfg.pointStyle === 'square') el = <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />;
    else if (cfg.pointStyle === 'triangle') el = <polygon points={`${cx},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`} fill={color} />;
    else if (cfg.pointStyle === 'cross') el = <g><line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={2} /><line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={2} /></g>;
    else el = <circle cx={cx} cy={cy} r={r} fill={color} />;
    return <g key={`d-${s.key}-${index}`}>{el}</g>;
  };
  const xLab = cfg.xAxisLabel || xFieldLabel;
  const yLab = cfg.yAxisLabel || `${plotLayer.label}${plotLayer.unit ? ` (${plotLayer.unit})` : ''}`;
  const refLines = (
    <>
      {plot.showMaxLines && visibleSeries.map((s) => {
        const m = maxOf(s);
        if (m === null) return null;
        const c = colorOf(s);
        return <ReferenceLine key={`mx-${s.key}`} y={m} stroke={c} strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: `max ${s.label}=${m.toFixed(2)}`, fill: c, fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }} />;
      })}
      {(plot.hLines || []).map((h) => {
        const v = parseManual(h.value);
        if (v === null) return null;
        return <ReferenceLine key={h.id} y={v} stroke={h.color || '#64748b'} strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: h.label || `y=${v}`, fill: h.color || '#64748b', fontSize: Math.max(9, cfg.fontSize - 1), position: 'insideTopRight' }} />;
      })}
    </>
  );
  const paramKeys = useMemo(() => {
    if (!plot.fitEnabled || is3D || isHist || !series.length) return [];
    return fitParamOptions(plot.fitModel, plot.customExpr);
  }, [plot.fitEnabled, plot.fitModel, plot.customExpr, series, is3D, isHist]);
  const [paramGraphVar, setParamGraphVar] = useState('');
  useEffect(() => { if (!paramKeys.includes(paramGraphVar)) setParamGraphVar(paramKeys[0] || ''); }, [paramKeys, paramGraphVar]);
  const paramData = useMemo(() => {
    if (!paramGraphVar) return [];
    return series.map((s) => {
      const f = fits[s.key];
      if (!f) return null;
      const val = extractFitParam(f, plot.fitModel, paramGraphVar);
      const err = plot.fitModel === 'custom' ? f.paramsErr?.[paramGraphVar] : f[`${paramGraphVar}Err`];
      if (val === undefined || val === null) return null;
      return { name: s.label, val, err: err || 0, fill: colorOf(s) };
    }).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, fits, paramGraphVar, plot.fitModel, cfg.colors]);
  return (
    <CollapsibleSection title={plot.title} icon="📈" defaultOpen={true}
      headerExtra={
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const nn = window.prompt('Rename plot:', plot.title); if (nn && nn.trim()) set({ title: nn.trim() }); }} className="text-slate-400 hover:text-blue-600" title="Rename">✏️</button>
          <button type="button" onClick={() => duplicatePlot(plot)} className="text-slate-400 hover:text-blue-600" title="Duplicate">⧉</button>
          <button type="button" onClick={() => removePlot(plot.id)} className="text-slate-400 hover:text-red-500" title="Remove">×</button>
        </div>
      }>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-3 items-end bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Parameter (Y / Z)</label>
            <select value={plot.layerKey} onChange={(e) => set({ layerKey: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {d.layers.map((l) => <option key={l.key} value={l.key}>{l.label}{l.unit ? ` (${l.unit})` : ''}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">X axis (Experimental Condition)</label>
            <select value={effXField} onChange={(e) => set({ xField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              {experimentalFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Type</label>
            <select value={plot.chartType || 'line'} onChange={(e) => set({ chartType: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="line">Line / Scatter (zoomable)</option>
              <option value="hist">Histogram (per instance)</option>
              <option value="3d">3D (two condition fields)</option>
            </select>
          </div>
          {is3D && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">2nd Experimental Condition field (Y of 3D)</label>
              <select value={plot.yField || ''} onChange={(e) => set({ yField: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                <option value="">-- select --</option>
                {experimentalFields.filter((f) => f.key !== effXField).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
          )}
          {!is3D && !isHist && (
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 pb-1.5 cursor-pointer">
              <input type="checkbox" checked={plot.fitEnabled} onChange={(e) => set({ fitEnabled: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Fit curve
            </label>
          )}
          {plot.fitEnabled && !is3D && !isHist && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Model</label>
              <div className="flex gap-2 items-center">
                <select value={plot.fitModel} onChange={(e) => set({ fitModel: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 font-semibold">
                  <option value="linear">Linear (weighted)</option>
                  <option value="4pl">4PL logistic (weighted)</option>
                  <option value="custom">Custom Equation</option>
                </select>
                {plot.fitModel === 'custom' && (
                  <input type="text" value={plot.customExpr || ''} onChange={(e) => set({ customExpr: e.target.value })} placeholder="e.g. a*x^2 + b" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-500 w-32 bg-white" />
                )}
              </div>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setShowErr(!showErr)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showErr ? 'bg-orange-100 border-orange-400 text-orange-800' : 'bg-white border-orange-300 text-orange-700 hover:bg-orange-50'}`}>⚠️ Error Management</button>
            <button type="button" onClick={() => setShowCfg(!showCfg)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>🎨 Graphical Parameters</button>
          </div>
        </div>

        {/* WARNING: altre condizioni sperimentali diverse + opzione escludi non comparabili */}
        {comparableInfo.hasMismatch && !isHist && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-800 flex flex-col gap-2">
            <div>
              ⚠️ These experimental conditions differ between instances: <b>{comparableInfo.varyingFields.map((f) => f.label).join(', ')}</b>.
              {' '}{comparableInfo.nonComparableCount} point(s) come from instances with different conditions and may not be comparable.
            </div>
            <label className="flex items-center gap-2 font-bold cursor-pointer">
              <input type="checkbox" checked={!!plot.excludeNonComparable} onChange={(e) => set({ excludeNonComparable: e.target.checked })} className="accent-amber-600" />
              Exclude non-comparable points
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Conditions used:</span>
          {d.instances.map((inst) => (
            <label key={inst.id} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer ${used[inst.id] === false ? 'bg-slate-100 border-slate-200 text-slate-400' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
              <input type="checkbox" checked={used[inst.id] !== false} onChange={() => toggleInstance(inst.id)} className="w-3.5 h-3.5 accent-blue-600" />
              {inst.name}
              <span className="text-[9px] font-mono opacity-70">({xFieldLabel}: {getExpValue(inst, effXField) || '—'})</span>
            </label>
          ))}
        </div>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-80 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-bold text-slate-600 uppercase">Atom(s) to plot</label>
              <button type="button" onClick={selectAllFiltered} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded">☑ Select all (filtered)</button>
              <button type="button" onClick={() => set({ atoms: [] })} className="text-[10px] font-bold text-red-500 hover:text-red-700 underline">Clear</button>
            </div>
            <input type="text" value={atomSearch} onChange={(e) => setAtomSearch(e.target.value)} placeholder="Search atom (e.g. Ala3 HN)…" className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
            <div className="border border-slate-200 rounded-lg max-h-52 overflow-y-auto custom-scrollbar bg-white">
              {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 italic">No atoms (enter a sequence first).</div>}
              {filtered.map((o) => (
                <label key={o.key} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0">
                  <input type="checkbox" checked={plot.atoms.includes(o.key)} onChange={() => toggleAtom(o.key)} className="w-3.5 h-3.5 accent-blue-600" />
                  <span className="text-xs text-slate-700">{o.label}</span>
                </label>
              ))}
            </div>
            {plot.atoms.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: colorOf(s) }}>
                    {s.label}
                    <button type="button" onClick={() => toggleAtom(s.key)} className="hover:text-red-200 font-black">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 items-end pt-1 border-t border-slate-100">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Save current selection as</label>
                <div className="flex gap-1">
                  <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Selection name" className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs w-36 outline-none focus:border-blue-500 bg-white" />
                  <button type="button" onClick={savePreset} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1.5 rounded-lg text-xs">💾 Save</button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Load saved selection</label>
                <select value="" onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]">
                  <option value="">-- Select --</option>
                  {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({(p.atoms || []).length})</option>)}
                </select>
              </div>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {p.name}
                    <button type="button" onClick={() => deletePreset(p.id)} className="text-indigo-400 hover:text-red-600 font-black" title="Delete preset">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {visibleSeries.length > 0 && !is3D && (
              <div className="flex flex-wrap gap-2">
                {series.map((s) => (
                  <label key={s.key} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-xs font-bold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={!plot.hiddenSeries[s.key]} onChange={() => set({ hiddenSeries: { ...plot.hiddenSeries, [s.key]: !plot.hiddenSeries[s.key] } })} className="w-3.5 h-3.5 accent-blue-600" />
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: colorOf(s) }} />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
            {series.length === 0 ? (
              <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Select at least one atom to plot.</div>
            ) : is3D ? (
              <div className="bg-white border border-slate-200 rounded-xl p-3" style={{ height: Math.max(340, cfg.height) }}>
                <ThreeDScatter cfg={cfg} xLabel={xFieldLabel} yLabel={experimentalFields.find((f) => f.key === plot.yField)?.label || '—'} zLabel={plotLayer.label}
                  seriesList={visibleSeries.map((s) => ({ key: s.key, label: s.label, color: colorOf(s), pts: includedPts(s).filter((p) => p.x !== null && p.y2 !== null).map((p) => ({ x: p.x, y: p.y2, z: p.y, name: p.name })) }))} />
              </div>
            ) : (
              <div className="select-none relative">
                {!isHist && zoom.isZoomed && (
                  <button type="button" onClick={zoom.reset} className="absolute top-2 right-2 z-10 text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded font-bold">Reset Zoom</button>
                )}
                <div ref={chartRef} onMouseDown={isHist ? undefined : zoom.onMouseDown} style={chartBoxStyle(cfg)} className="bg-white border border-slate-200 rounded-xl p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    {isHist ? (
                      <BarChart data={catData} margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="__condition" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} />} tickMargin={10} label={{ value: 'Condition', position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <Tooltip />
                        {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                        {refLines}
                        {visibleSeries.map((s) => {
                          const color = colorOf(s);
                          return (
                            <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[cfg.barRadius || 3, cfg.barRadius || 3, 0, 0]} isAnimationActive={false}>
                              {HAS_EB && plot.showErrors && <ErrorBar dataKey={`${s.key}__sd`} width={4} strokeWidth={1} direction="y" color={color} />}
                            </Bar>
                          );
                        })}
                      </BarChart>
                    ) : (
                      <LineChart margin={{ top: 8, right: 16, bottom: 30, left: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" dataKey="x" domain={[dom(cfg.xMin) ?? zoom.domain[0], dom(cfg.xMax) ?? zoom.domain[1]]} ticks={xTicks}
                          tick={<AngledTick angle={cfg.tickAngle} fontSize={cfg.fontSize} />} tickMargin={10}
                          label={{ value: xLab, position: 'insideBottom', offset: -22, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <YAxis type="number" domain={[dom(cfg.yMin) ?? 'auto', dom(cfg.yMax) ?? 'auto']} tick={{ fontSize: cfg.fontSize, fill: '#64748b' }} label={{ value: yLab, angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: cfg.fontSize + 1 }} />
                        <Tooltip />
                        {cfg.legend !== 'none' && <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={{ fontSize: cfg.fontSize, paddingBottom: 10 }} />}
                        {refLines}
                        {visibleSeries.map((s) => {
                          const color = colorOf(s);
                          return (
                            <React.Fragment key={s.key}>
                              <Line data={numData(s)} type="monotone" dataKey="y" name={s.label} stroke={color} strokeWidth={cfg.lineThickness || 2} strokeDasharray={lineDash(cfg.lineStyle)} dot={plot.showPoints ? makeDot(color, s) : false} connectNulls isAnimationActive={false}>
                                {HAS_EB && plot.showErrors && <ErrorBar dataKey="sd" width={4} strokeWidth={1} direction="y" color={color} />}
                              </Line>
                              {plot.fitEnabled && plot.showFit && fits[s.key] && (
                                <Line data={fitData(s)} type="monotone" dataKey="y" name={`${s.label} (fit)`} stroke={color} strokeWidth={1.5} strokeDasharray="8 4" dot={false} legendType="none" isAnimationActive={false} />
                              )}
                            </React.Fragment>
                          );
                        })}
                        {zoom.refLo !== null && zoom.refHi !== null && <ReferenceArea x1={zoom.refLo} x2={zoom.refHi} strokeOpacity={0.3} fill="#cbd5e1" />}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
                {!isHist && <p className="text-[10px] text-slate-400 mt-1">💡 Drag with the mouse across the graph to zoom into an X region.</p>}
              </div>
            )}
            {plot.fitEnabled && !is3D && !isHist && series.length > 0 && (
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
                              {f ? (plot.fitModel === 'linear' ? `slope=${f.slope.toFixed(4)}±${(f.slopeErr || 0).toFixed(4)}; int=${f.intercept.toFixed(4)}±${(f.interceptErr || 0).toFixed(4)}; R²=${f.r2.toFixed(3)}` : plot.fitModel === '4pl' ? `Top=${f.top.toFixed(3)}; Bottom=${f.bottom.toFixed(3)}; EC50=${f.ic50.toFixed(3)}; Hill=${f.hill.toFixed(3)}; R²=${f.r2.toFixed(3)}` : Object.entries(f.params || {}).map(([k, v]) => `${k}=${v.toFixed(4)}`).join('; ') + `; R²=${f.r2.toFixed(3)}`) : 'not enough points / missing numeric X'}
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
                      <select value={paramGraphVar} onChange={(e) => setParamGraphVar(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
                        {paramKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div style={{ height: Math.min(280, cfg.height), aspectRatio: String(cfg.aspect || 2) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={paramData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" interval={catInterval(cfg.tickStep)} tick={<AngledTick angle={cfg.tickAngle} fontSize={Math.max(9, cfg.fontSize - 2)} />} />
                          <YAxis tick={{ fontSize: Math.max(9, cfg.fontSize - 2) }} label={{ value: paramGraphVar, angle: -90, position: 'insideLeft', fontSize: cfg.fontSize, fill: '#64748b' }} />
                          <Tooltip />
                          <Bar dataKey="val" isAnimationActive={false}>
                            {paramData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                            {HAS_EB && <ErrorBar dataKey="err" width={4} strokeWidth={1} color="#333" />}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {showErr && (
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={plot.useFixedSD} onChange={(e) => set({ useFixedSD: e.target.checked })} className="w-4 h-4 accent-blue-600" /> Fixed SD ±
              </label>
              <input type="number" step="0.1" min="0" value={plot.fixedSDStr} onChange={(e) => set({ fixedSDStr: e.target.value })} disabled={!plot.useFixedSD} className={`border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none ${plot.useFixedSD ? 'bg-white font-bold text-blue-700' : 'bg-slate-100 text-slate-400'}`} />
              <label className="text-xs font-bold text-slate-600">Outlier threshold (×SD):</label>
              <input type="number" step="0.1" min="0.1" value={plot.outlierThreshStr} onChange={(e) => set({ outlierThreshStr: e.target.value })} className="border border-slate-300 rounded-md p-1.5 w-16 text-xs outline-none" />
              <button type="button" onClick={() => cleanOutliers(null)} className="bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-black py-1.5 px-3 rounded-lg text-xs shadow-sm">🧹 Clean Outliers (all)</button>
              <button type="button" onClick={restoreExcluded} className="text-xs bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold py-1.5 px-3 rounded-md shadow-sm">↩️ Restore excluded</button>
            </div>
            {series.map((s) => (
              <div key={s.key} className="bg-white rounded-lg border border-orange-200 p-3">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <span className="text-sm font-bold text-slate-800">{s.label}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => autoTouch(s)} className="text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-2 py-1 rounded font-bold shadow-sm">🎯 Auto-Touch SD</button>
                    <button type="button" onClick={() => cleanOutliers(s)} className="text-xs text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-2 py-1 rounded font-bold shadow-sm">🧹 Clean</button>
                    <button type="button" onClick={() => resetSD(s.key)} className="text-xs text-orange-600 hover:underline font-bold">🔄 Reset SD</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.pts.length === 0 && <span className="text-xs text-slate-400 italic">No values for this atom.</span>}
                  {s.pts.map((p) => {
                    const sd = effSD(s.key, p);
                    return (
                      <div key={p.instId} className={`flex flex-col gap-1 p-1.5 rounded border ${p.excluded ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                        <span className="text-[9px] font-bold text-slate-500">{p.name}{p.x !== null ? ` (${xFieldLabel}=${p.x})` : ' (no numeric X)'}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-mono ${p.excluded ? 'line-through text-slate-400' : 'text-slate-700'}`}>{p.y}</span>
                          <input type="number" step="0.01" value={(plot.manualSD[s.key] || {})[p.instId] ?? ''} onChange={(e) => setManualSD(s.key, p.instId, e.target.value)} placeholder="±SD" className="w-14 text-[10px] border border-slate-300 rounded p-0.5 text-center outline-none focus:border-orange-500" />
                          <button type="button" onClick={() => toggleExclude(s.key, p.instId)} className={`text-[10px] font-black px-1 ${p.excluded ? 'text-red-600' : 'text-slate-400 hover:text-red-500'}`} title="Exclude / include point">{p.excluded ? 'EXCL' : '×'}</button>
                        </div>
                        {sd != null && <span className="text-[9px] text-orange-700 font-bold">± {sd}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {showCfg && <ChartStylePanel cfg={cfg} setCfg={setCfg} series={series.map((s, i) => ({ key: s.key, label: s.label, color: seriesColor(cfg, s.key, i) }))} />}
      </div>
    </CollapsibleSection>
  );
};
const FittingSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const plots = Array.isArray(activeTest.conditionPlots) && activeTest.conditionPlots.length ? activeTest.conditionPlots : [defaultPlotCfg(1)];
  const updatePlot = (id, patch) => updateActiveTest({ conditionPlots: plots.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const addPlot = () => updateActiveTest({ conditionPlots: [...plots, defaultPlotCfg(plots.length + 1)] });
  const removePlot = (id) => {
    if (plots.length <= 1) { alert('At least one condition plot is required.'); return; }
    updateActiveTest({ conditionPlots: plots.filter((p) => p.id !== id) });
  };
  const duplicatePlot = (p) => updateActiveTest({ conditionPlots: [...plots, { ...JSON.parse(JSON.stringify(p)), id: makePlotId(), title: `${p.title} (copy)` }] });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-bold text-slate-500 uppercase">Condition plots — X = Experimental Condition · zoomable · aspect ratio adjustable</span>
        <button type="button" onClick={addPlot} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm">+ Add Condition Plot</button>
      </div>
      {plots.map((p) => (
        <ConditionPlotPanel key={p.id} ctx={ctx} d={d} plot={p} updatePlot={updatePlot} removePlot={removePlot} duplicatePlot={duplicatePlot} />
      ))}
    </div>
  );
};

// ================= CLASSIFICATION (per la sezione esistente — NON aggiunta come sezione extra) =================
// Usa ctx.testCategories (tipo esperimento) e ctx.operators (operatori) definiti in Definitions in App.jsx.
// Integra questo componente nella tua sezione Classification esistente dentro TestShellRenderer.jsx.
export const ClassificationSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const testCategories = Array.isArray(ctx?.testCategories) ? ctx.testCategories : [];
  const operators = (Array.isArray(ctx?.operators) ? ctx.operators : [])
    .map(opLabel).filter(Boolean);
  const classification = activeTest.classification || {};
  const set = (patch) => updateActiveTest({ classification: { ...classification, ...patch } });
  const selectedOperators = Array.isArray(classification.operators) ? classification.operators : [];
  const toggleOperator = (name) => {
    if (selectedOperators.includes(name)) set({ operators: selectedOperators.filter((o) => o !== name) });
    else set({ operators: [...selectedOperators, name] });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Experiment Type (from Definitions)</label>
          <select value={classification.experimentType || ''} onChange={(e) => set({ experimentType: e.target.value })}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="">-- Select --</option>
            {testCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Operator(s) (from Definitions)</label>
          <div className="flex flex-wrap gap-2">
            {operators.map((name) => (
              <label key={name} className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer ${selectedOperators.includes(name) ? 'bg-blue-600 border-blue-700 text-white' : 'bg-white border-slate-300 text-slate-700'}`}>
                <input type="checkbox" checked={selectedOperators.includes(name)} onChange={() => toggleOperator(name)} className="accent-blue-600" />
                {name}
              </label>
            ))}
            {operators.length === 0 && <span className="text-xs text-amber-600">⚠️ No operators found. Add them in Definitions → Scientists/Operators.</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ================= 5) SIMULATIONS (IDENTICO alla versione precedente) =================
const SimulationsSection = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [showCfg, setShowCfg] = useState(false);
  const focusIdx = activeTest.focusIdx !== undefined ? activeTest.focusIdx : 'ALL';
  const setFocusIdx = (val) => updateActiveTest({ focusIdx: val });
  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);
  const simCfg = { fontSize: 11, h1D: 300, aspect2D: 1, ...(activeTest.simChartCfg || {}) };
  const setCfg = (patch) => updateActiveTest({ simChartCfg: { ...simCfg, ...patch } });
  if (d.parsedSeq.length === 0) {
    return <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence / select a molecule (in Experiment Setup) to generate simulated spectra.</div>;
  }
  const fP = (arr) => {
    if (focusIdx === 'ALL' || !arr) return arr || [];
    const targetRes = d.parsedSeq[focusIdx];
    if (!targetRes) return arr;
    const resId = targetRes.id;
    return arr.filter((p) => {
      if (p.label && p.label.includes(resId)) return true;
      if (p.type && typeof p.type === 'string' && p.type.includes(resId)) return true;
      if (p.keys && p.keys.some((k) => String(k).split('-')[0] === String(focusIdx))) return true;
      return false;
    }).sort((a, b) => a.x - b.x);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap bg-white border border-slate-200 rounded-lg px-3 py-2 w-fit">
        <button type="button" onClick={() => setShowCfg(!showCfg)} className={`font-bold py-1.5 px-3 rounded-lg text-xs border transition-colors ${showCfg ? 'bg-slate-200 border-slate-400 text-slate-900' : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'}`}>⚙️ Chart Parameters</button>
        <span className="text-[10px] text-slate-400">13C axis: 0–220 ppm · 2D spectra: square (aspect {simCfg.aspect2D}) · HSQC side by side</span>
        <div className="border-l border-slate-300 pl-3 ml-1 flex items-center gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase">🔍 Filter Peaks:</label>
          <select value={focusIdx} onChange={(e) => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-slate-50 outline-none focus:border-blue-500">
            <option value="ALL">Show All Residues</option>
            {d.parsedSeq.map((r, i) => <option key={i} value={i}>{r.id} — {r.name}</option>)}
          </select>
        </div>
      </div>
      {showCfg && (
        <div className="p-4 bg-white border border-slate-300 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">Font size (ticks & labels): {simCfg.fontSize}</label>
            <input type="range" min="8" max="18" step="1" value={simCfg.fontSize} onChange={(e) => setCfg({ fontSize: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">1D spectra height (px): {simCfg.h1D}</label>
            <input type="range" min="200" max="600" step="20" value={simCfg.h1D} onChange={(e) => setCfg({ h1D: parseInt(e.target.value, 10) })} className="accent-blue-600 mt-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">2D aspect ratio (H/W): {simCfg.aspect2D} (1 = square)</label>
            <input type="range" min="0.5" max="1.5" step="0.05" value={simCfg.aspect2D} onChange={(e) => setCfg({ aspect2D: parseFloat(e.target.value) })} className="accent-blue-600 mt-2" />
            <button type="button" onClick={() => setCfg({ aspect2D: 1 })} className="text-[10px] font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100 px-2 py-1 rounded w-fit">⬛ Make 2D square</button>
          </div>
        </div>
      )}
      {selectedKeys && (
        <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 w-fit">🎯 Highlighting: {selectionLabel(d, selectedKeys)}</span>
      )}
      <div className="text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 w-fit">
        Spectra are simulated from the <span className="text-indigo-700">{d.activeInstance ? d.activeInstance.name : '—'}</span> instance's Chemical Shift layer.
      </div>
      <div className="grid grid-cols-1 gap-4">
        <RangeBarChart title="Theoretical ¹H Ranges" ranges={d.ranges.ranges1H} domain={[0, 11]} ticks={Array.from({ length: 12 }, (_, i) => i)} xAxisLabel="¹H (ppm)" rowCount={d.uniqueTypes.length} rowLabels={d.uniqueTypes.map((c) => d.DB[c]?.code3 || c)} />
        <RangeBarChart title="Theoretical ¹³C Ranges" ranges={d.ranges.ranges13C} domain={[0, 220]} ticks={Array.from({ length: 23 }, (_, i) => i * 10)} xAxisLabel="¹³C (ppm)" rowCount={d.uniqueTypes.length} rowLabels={d.uniqueTypes.map((c) => d.DB[c]?.code3 || c)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OneDSpectrumPlot key={`1d1h-${focusIdx}`} title="Simulated ¹H 1D Spectrum" data={fP(d.peaks.data1H)} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} />
        <OneDSpectrumPlot key={`1d13c-${focusIdx}`} title="Simulated ¹³C 1D Spectrum" data={fP(d.peaks.data13C)} fullDomain={[0, 220]} ticks={TICKS_13C} TickComponent={CustomXTick13C} xLabel="¹³C (ppm)" panelId="1D_13C" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} />
        {d.hasPhosphorus && d.selNuc.includes('P') && fP(d.peaks.p31Data).length > 0 && (
          <OneDSpectrumPlot key={`1dp31-${focusIdx}`} title="Simulated ³¹P 1D Spectrum" data={fP(d.peaks.p31Data)} fullDomain={[-5, 5]} ticks={Array.from({ length: 11 }, (_, i) => i - 5)} TickComponent={CustomXTick1H} xLabel="³¹P (ppm)" panelId="1D_31P" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} selectedKeys={selectedKeys} manualKeys={manualKeys} heightPx={simCfg.h1D} fs={simCfg.fontSize} />
        )}
        <SpectrumPlot key={`cosy-${focusIdx}`} title="Simulated COSY Spectrum" diagonalData={fP(d.peaks.diagonalData)} crossPeakData={fP(d.peaks.cosyPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="cosy" diagonalColor="#22c55e" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} />
        <SpectrumPlot key={`noesy-${focusIdx}`} title="Simulated NOESY Spectrum" diagonalData={fP(d.peaks.diagonalData)} crossPeakData={fP(d.peaks.noesyPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="noesy" diagonalColor="#ef4444" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} />
        <SpectrumPlot key={`tocsy-${focusIdx}`} title="Simulated TOCSY Spectrum" diagonalData={fP(d.peaks.diagonalData)} crossPeakData={fP(d.peaks.tocsyPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="tocsy" diagonalColor="#1e3a8a" selectedKeys={selectedKeys} manualKeys={manualKeys} aspect={simCfg.aspect2D} fs={simCfg.fontSize} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HSQCPlot key={`hsqc-${focusIdx}`} title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={fP(d.peaks.hsqcPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc" selectedKeys={selectedKeys} manualKeys={manualKeys} yAxisLabel="¹³C F1 (ppm)" yDomainInit={[0, 220]} yTicks={TICKS_13C} aspect={simCfg.aspect2D} fs={simCfg.fontSize} />
        {d.moleculeType === 'protein' && d.selNuc.includes('N') && fP(d.peaks.hsqc15NPeaks).length > 0 && (
          <HSQCPlot key={`hsqc15n-${focusIdx}`} title="Simulated ¹H-¹⁵N HSQC Spectrum" crossPeakData={fP(d.peaks.hsqc15NPeaks)} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc15n" selectedKeys={selectedKeys} manualKeys={manualKeys} yAxisLabel="¹⁵N F1 (ppm)" yDomainInit={[95, 135]} yTicks={TICKS_15N} aspect={simCfg.aspect2D} fs={simCfg.fontSize} />
        )}
      </div>
    </div>
  );
};

// ================= ALL (senza sezione Classification extra) =================
export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <CollapsibleSection title="Experiment Setup" icon="⚙️"><ExperimentSetupSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Data" icon="🔢"><DataSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Secondary Chemical Shifts (SCS)" icon="📉" defaultOpen={false}><SecondaryShiftsSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Fitting" icon="📐"><FittingSection ctx={ctx} /></CollapsibleSection>
    <CollapsibleSection title="Simulations" icon="🧪" defaultOpen={false}><SimulationsSection ctx={ctx} /></CollapsibleSection>
  </div>
);
export const Setup = ExperimentSetupSection;
export const Data = DataSection;
export const Fitting = FittingSection;
export const Simulations = SimulationsSection;

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest, ctx);
  if (checkId === 'cond') {
    const expStr = d.fields
      .map((f) => { const v = getExpValue(d.activeInstance, f.key); return v !== '' ? `${f.label}: ${v}` : ''; })
      .filter(Boolean).join(' | ');
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Condition:</b> ${d.activeInstance ? d.activeInstance.name : 'N/A'} | ${expStr || 'No experimental condition values set'}</p>`;
  }
  if (checkId === 'seq') {
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>${d.typeLabel}:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${d.isPolymer ? activeTest.proteinSequence || 'N/A' : d.parsedSeq[0]?.name || 'N/A'}</span></p>`;
  }
  if (checkId === 'formula' && d.structure) {
    return `<div style="margin-bottom: 12px;">${elementsToSVG(d.structure, 300)}</div>`;
  }
  if (checkId === 'table' && Object.keys(d.shifts).length > 0) {
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
    Object.keys(d.shifts).forEach((key) => {
      const parts = key.split('-');
      const resIdx = parts[0];
      const atom = parts.slice(1).join('-');
      const res = d.parsedSeq[resIdx];
      if (res && d.shifts[key]) {
        html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${d.shifts[key]}</td></tr>`;
      }
    });
    html += `</table>`;
    return html;
  }
  if (checkId === 'images' && d.images.length > 0) {
    let html = `<div style="margin-top: 15px;"><h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;
    d.images.forEach((imgSrc, idx) => {
      const cands = normalizeImageCandidates(imgSrc);
      html += `<div style="margin-bottom: 10px;"><img src="${cands[0]}" alt="Spectrum ${idx + 1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;"/><p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx + 1}</p></div>`;
    });
    html += `</div>`;
    return html;
  }
  return '';
};

