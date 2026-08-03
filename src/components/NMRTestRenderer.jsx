import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, BarChart, Bar } from 'recharts';
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

// --- NUCLEOTIDE DATABASES (DNA / RNA) ---
const NUCLEOTIDE_DB = {
  DNA: {
    'A': { name: 'Deoxyadenosine', code3: 'dA', atoms: ["H8","H2","H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ranges: { 'H8':{min:7.9,max:8.4}, 'H2':{min:7.7,max:8.3}, "H1'":{min:5.9,max:6.4}, "H2'":{min:2.2,max:2.8}, "H2''":{min:2.5,max:2.9}, "H3'":{min:4.7,max:5.1}, "H4'":{min:4.1,max:4.5}, "H5'":{min:3.8,max:4.3}, "H5''":{min:3.7,max:4.2} }, cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"],["H8"],["H2"]] },
    'G': { name: 'Deoxyguanosine', code3: 'dG', atoms: ["H8","H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ranges: { 'H8':{min:7.6,max:8.2}, "H1'":{min:5.6,max:6.2}, "H2'":{min:2.2,max:2.8}, "H2''":{min:2.5,max:3.0}, "H3'":{min:4.7,max:5.1}, "H4'":{min:4.0,max:4.5}, "H5'":{min:3.8,max:4.3}, "H5''":{min:3.7,max:4.2} }, cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"],["H8"]] },
    'C': { name: 'Deoxycytidine', code3: 'dC', atoms: ["H6","H5","H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ranges: { 'H6':{min:7.3,max:8.0}, 'H5':{min:5.2,max:5.9}, "H1'":{min:5.8,max:6.4}, "H2'":{min:2.0,max:2.7}, "H2''":{min:2.2,max:2.9}, "H3'":{min:4.7,max:5.1}, "H4'":{min:4.0,max:4.5}, "H5'":{min:3.8,max:4.3}, "H5''":{min:3.6,max:4.2} }, cosy: [["H5","H6"],["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"],["H5","H6"]] },
    'T': { name: 'Deoxythymidine', code3: 'dT', atoms: ["H6","H7(Me)","H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ranges: { 'H6':{min:7.2,max:7.9}, 'H7(Me)':{min:1.5,max:2.0}, "H1'":{min:5.9,max:6.5}, "H2'":{min:1.9,max:2.6}, "H2''":{min:2.1,max:2.8}, "H3'":{min:4.7,max:5.1}, "H4'":{min:4.0,max:4.5}, "H5'":{min:3.8,max:4.3}, "H5''":{min:3.6,max:4.2} }, cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"],["H6"],["H7(Me)"]] }
  },
  RNA: {
    'A': { name: 'Adenosine', code3: 'rA', atoms: ["H8","H2","H1'","H2'","H3'","H4'","H5'","H5''"], ranges: { 'H8':{min:7.8,max:8.5}, 'H2':{min:7.6,max:8.4}, "H1'":{min:5.6,max:6.3}, "H2'":{min:4.4,max:5.0}, "H3'":{min:4.2,max:4.8}, "H4'":{min:4.0,max:4.6}, "H5'":{min:3.9,max:4.5}, "H5''":{min:3.8,max:4.3} }, cosy: [["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"],["H8"],["H2"]] },
    'G': { name: 'Guanosine', code3: 'rG', atoms: ["H8","H1'","H2'","H3'","H4'","H5'","H5''"], ranges: { 'H8':{min:7.5,max:8.3}, "H1'":{min:5.5,max:6.2}, "H2'":{min:4.3,max:4.9}, "H3'":{min:4.2,max:4.8}, "H4'":{min:4.0,max:4.6}, "H5'":{min:3.9,max:4.5}, "H5''":{min:3.8,max:4.3} }, cosy: [["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"],["H8"]] },
    'C': { name: 'Cytidine', code3: 'rC', atoms: ["H6","H5","H1'","H2'","H3'","H4'","H5'","H5''"], ranges: { 'H6':{min:7.3,max:8.0}, 'H5':{min:5.2,max:6.0}, "H1'":{min:5.4,max:6.1}, "H2'":{min:4.1,max:4.7}, "H3'":{min:4.1,max:4.7}, "H4'":{min:3.9,max:4.5}, "H5'":{min:3.8,max:4.4}, "H5''":{min:3.7,max:4.3} }, cosy: [["H5","H6"],["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"],["H5","H6"]] },
    'U': { name: 'Uridine', code3: 'rU', atoms: ["H6","H5","H1'","H2'","H3'","H4'","H5'","H5''"], ranges: { 'H6':{min:7.3,max:8.1}, 'H5':{min:5.2,max:6.0}, "H1'":{min:5.3,max:6.0}, "H2'":{min:4.1,max:4.8}, "H3'":{min:4.1,max:4.7}, "H4'":{min:3.9,max:4.5}, "H5'":{min:3.8,max:4.4}, "H5''":{min:3.7,max:4.3} }, cosy: [["H5","H6"],["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]], spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"],["H5","H6"]] }
  }
};

// --- SUGAR DATABASE ---
const SUGAR_DB = {
  'GLC': { name: 'D-Glucose', code3: 'Glc', atoms: ['H1','H2','H3','H4','H5','H6a','H6b'], ranges: { 'H1':{min:4.55,max:5.30}, 'H2':{min:3.40,max:3.70}, 'H3':{min:3.60,max:3.90}, 'H4':{min:3.30,max:3.60}, 'H5':{min:3.60,max:4.00}, 'H6a':{min:3.60,max:3.95}, 'H6b':{min:3.65,max:4.00} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4'],['H4','H5'],['H5','H6a'],['H5','H6b'],['H6a','H6b']], spinSystems: [['H1','H2','H3','H4','H5','H6a','H6b']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4':'C4','H5':'C5','H6a':'C6','H6b':'C6'}, carbonRanges: {'C1':[92,105],'C2':[70,76],'C3':[72,77],'C4':[69,75],'C5':[70,76],'C6':[60,64]}, struct: { ring: 'pyranose' } },
  'GAL': { name: 'D-Galactose', code3: 'Gal', atoms: ['H1','H2','H3','H4','H5','H6a','H6b'], ranges: { 'H1':{min:4.55,max:5.25}, 'H2':{min:3.45,max:3.80}, 'H3':{min:3.55,max:3.90}, 'H4':{min:3.75,max:4.10}, 'H5':{min:3.75,max:4.10}, 'H6a':{min:3.55,max:3.95}, 'H6b':{min:3.55,max:3.95} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4'],['H4','H5'],['H5','H6a'],['H5','H6b'],['H6a','H6b']], spinSystems: [['H1','H2','H3','H4','H5','H6a','H6b']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4':'C4','H5':'C5','H6a':'C6','H6b':'C6'}, carbonRanges: {'C1':[92,105],'C2':[68,73],'C3':[70,76],'C4':[68,74],'C5':[70,76],'C6':[60,64]}, struct: { ring: 'pyranose' } },
  'MAN': { name: 'D-Mannose', code3: 'Man', atoms: ['H1','H2','H3','H4','H5','H6a','H6b'], ranges: { 'H1':{min:4.70,max:5.25}, 'H2':{min:3.70,max:4.05}, 'H3':{min:3.60,max:3.95}, 'H4':{min:3.50,max:3.80}, 'H5':{min:3.65,max:4.00}, 'H6a':{min:3.60,max:3.95}, 'H6b':{min:3.60,max:3.95} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4'],['H4','H5'],['H5','H6a'],['H5','H6b'],['H6a','H6b']], spinSystems: [['H1','H2','H3','H4','H5','H6a','H6b']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4':'C4','H5':'C5','H6a':'C6','H6b':'C6'}, carbonRanges: {'C1':[93,105],'C2':[69,74],'C3':[70,75],'C4':[66,72],'C5':[71,77],'C6':[60,64]}, struct: { ring: 'pyranose' } },
  'FRU': { name: 'D-Fructose', code3: 'Fru', atoms: ['H1a','H1b','H3a','H3b','H4','H5','H6a','H6b'], ranges: { 'H1a':{min:3.45,max:3.75}, 'H1b':{min:3.45,max:3.75}, 'H3a':{min:3.55,max:3.85}, 'H3b':{min:3.55,max:3.85}, 'H4':{min:3.85,max:4.15}, 'H5':{min:3.75,max:4.10}, 'H6a':{min:3.50,max:3.80}, 'H6b':{min:3.50,max:3.80} }, cosy: [['H1a','H1b'],['H3a','H3b'],['H4','H5'],['H5','H6a'],['H5','H6b'],['H6a','H6b']], spinSystems: [['H1a','H1b'],['H3a','H3b'],['H4','H5','H6a','H6b']], carbonMap: {'H1a':'C1','H1b':'C1','H3a':'C3','H3b':'C3','H4':'C4','H5':'C5','H6a':'C6','H6b':'C6'}, carbonRanges: {'C1':[62,66],'C2':[102,107],'C3':[76,80],'C4':[73,77],'C5':[79,84],'C6':[62,66]}, extraCarbons: {'C2 (ketose)':[102,107]}, struct: { ring: 'furanose' } },
  'FUC': { name: 'L-Fucose', code3: 'Fuc', atoms: ['H1','H2','H3','H4','H5','H6'], ranges: { 'H1':{min:4.70,max:5.25}, 'H2':{min:3.60,max:3.95}, 'H3':{min:3.65,max:3.95}, 'H4':{min:3.70,max:4.00}, 'H5':{min:3.60,max:3.95}, 'H6':{min:1.10,max:1.35} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4'],['H4','H5'],['H5','H6']], spinSystems: [['H1','H2','H3','H4','H5','H6']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4':'C4','H5':'C5','H6':'C6'}, carbonRanges: {'C1':[93,103],'C2':[67,72],'C3':[69,74],'C4':[70,75],'C5':[66,72],'C6':[14,18]}, struct: { ring: 'pyranose', c6: 'CH3' } },
  'XYL': { name: 'D-Xylose', code3: 'Xyl', atoms: ['H1','H2','H3','H4a','H4b'], ranges: { 'H1':{min:4.50,max:5.10}, 'H2':{min:3.35,max:3.65}, 'H3':{min:3.45,max:3.75}, 'H4a':{min:3.15,max:3.45}, 'H4b':{min:3.80,max:4.10} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4a'],['H3','H4b'],['H4a','H4b']], spinSystems: [['H1','H2','H3','H4a','H4b']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4a':'C4','H4b':'C4'}, carbonRanges: {'C1':[93,104],'C2':[72,77],'C3':[73,78],'C4':[67,72]}, struct: { ring: 'pyranose', noC6: true } },
  'NAG': { name: 'N-Acetyl-D-glucosamine', code3: 'GlcNAc', atoms: ['H1','H2','H3','H4','H5','H6a','H6b','NHAc','AcCH3'], ranges: { 'H1':{min:4.60,max:5.20}, 'H2':{min:3.70,max:4.05}, 'H3':{min:3.60,max:3.90}, 'H4':{min:3.40,max:3.70}, 'H5':{min:3.60,max:3.95}, 'H6a':{min:3.60,max:4.00}, 'H6b':{min:3.60,max:4.00}, 'NHAc':{min:7.60,max:8.30}, 'AcCH3':{min:1.90,max:2.15} }, cosy: [['H1','H2'],['H2','H3'],['H3','H4'],['H4','H5'],['H5','H6a'],['H5','H6b'],['H6a','H6b'],['NHAc','H2']], spinSystems: [['H1','H2','H3','H4','H5','H6a','H6b','NHAc'],['AcCH3']], carbonMap: {'H1':'C1','H2':'C2','H3':'C3','H4':'C4','H5':'C5','H6a':'C6','H6b':'C6','NHAc':null,'AcCH3':'CH3(Ac)'}, carbonRanges: {'C1':[92,104],'C2':[54,59],'C3':[72,77],'C4':[69,75],'C5':[71,77],'C6':[60,64],'CH3(Ac)':[21,25]}, extraCarbons: {'C=O(Ac)':[173,177]}, struct: { ring: 'pyranose', c2: 'NHAc' } },
  'SIA': { name: 'Sialic acid (Neu5Ac)', code3: 'Neu5Ac', atoms: ['H3eq','H3ax','H4','H5','NHAc','H6','H7','H8','H9a','H9b','AcCH3'], ranges: { 'H3eq':{min:2.65,max:2.95}, 'H3ax':{min:1.65,max:1.90}, 'H4':{min:3.55,max:3.90}, 'H5':{min:3.60,max:3.95}, 'NHAc':{min:7.40,max:8.10}, 'H6':{min:3.60,max:3.95}, 'H7':{min:3.45,max:3.80}, 'H8':{min:3.55,max:3.90}, 'H9a':{min:3.45,max:3.85}, 'H9b':{min:3.45,max:3.85}, 'AcCH3':{min:1.85,max:2.10} }, cosy: [['H3ax','H3eq'],['H3eq','H4'],['H4','H5'],['H5','NHAc'],['H5','H6'],['H6','H7'],['H7','H8'],['H8','H9a'],['H8','H9b'],['H9a','H9b']], spinSystems: [['H3ax','H3eq','H4','H5','NHAc','H6','H7','H8','H9a','H9b'],['AcCH3']], carbonMap: {'H3eq':'C3','H3ax':'C3','H4':'C4','H5':'C5','H6':'C6','H7':'C7','H8':'C8','H9a':'C9','H9b':'C9','NHAc':null,'AcCH3':'CH3(Ac)'}, carbonRanges: {'C3':[35,42],'C4':[66,72],'C5':[49,55],'C6':[68,74],'C7':[68,74],'C8':[65,71],'C9':[61,66],'CH3(Ac)':[21,25]}, extraCarbons: {'C1(COO⁻)':[173,177],'C2':[98,105],'C=O(Ac)':[172,177]}, struct: { ring: 'pyranose', special: 'sia' } }
};

// --- PHOSPHOLIPID DATABASE (POPC / POPE / POPS / POPG) ---
const LIPID_GLY_RANGES = { 'Hsn1a':{min:4.15,max:4.45}, 'Hsn1b':{min:4.15,max:4.45}, 'Hsn2g':{min:5.15,max:5.35}, 'Hsn3a':{min:3.95,max:4.35}, 'Hsn3b':{min:3.95,max:4.35} };
const LIPID_CHAIN_RANGES = { 'H2-sn1':{min:2.25,max:2.40}, 'H3-sn1':{min:1.55,max:1.70}, 'H4-sn1':{min:1.20,max:1.35}, 'H16-sn1':{min:0.82,max:0.92}, 'H2-sn2':{min:2.25,max:2.40}, 'H3-sn2':{min:1.55,max:1.70}, 'H4-sn2':{min:1.20,max:1.35}, 'Hall-sn2':{min:1.95,max:2.10}, 'H8-sn2':{min:5.28,max:5.42}, 'H9-sn2':{min:5.28,max:5.42}, 'H18-sn2':{min:0.82,max:0.92} };
const LIPID_GLY_COSY = [['Hsn1a','Hsn2g'],['Hsn1b','Hsn2g'],['Hsn1a','Hsn1b'],['Hsn2g','Hsn3a'],['Hsn2g','Hsn3b'],['Hsn3a','Hsn3b']];
const LIPID_CHAIN_COSY = [['H2-sn1','H3-sn1'],['H3-sn1','H4-sn1'],['H2-sn2','H3-sn2'],['H3-sn2','H4-sn2'],['H4-sn2','Hall-sn2'],['Hall-sn2','H8-sn2'],['Hall-sn2','H9-sn2'],['H8-sn2','H9-sn2']];
const LIPID_HEADS = {
  PC: { atoms: ['HCH2OP','HCH2N','HNMe3'], ranges: {'HCH2OP':{min:4.15,max:4.45},'HCH2N':{min:3.60,max:3.80},'HNMe3':{min:3.20,max:3.30}}, cosy: [['HCH2OP','HCH2N']], spin: [['HCH2OP','HCH2N','HNMe3']], carbonMap: {'HCH2OP':'CH2OP','HCH2N':'CH2N','HNMe3':'N(CH3)3'}, carbonRanges: {'CH2OP':[64,68],'CH2N':[57,61],'N(CH3)3':[52,56]}, extra: {} },
  PE: { atoms: ['HCH2OP','HCH2N','HNH3'], ranges: {'HCH2OP':{min:4.00,max:4.30},'HCH2N':{min:3.10,max:3.35},'HNH3':{min:7.50,max:8.50}}, cosy: [['HCH2OP','HCH2N']], spin: [['HCH2OP','HCH2N'],['HNH3']], carbonMap: {'HCH2OP':'CH2OP','HCH2N':'CH2N','HNH3':null}, carbonRanges: {'CH2OP':[63,68],'CH2N':[40,44]}, extra: {} },
  PS: { atoms: ['HCH2OP','HαS','HβS1','HβS2','HNH3'], ranges: {'HCH2OP':{min:3.95,max:4.30},'HαS':{min:4.00,max:4.30},'HβS1':{min:3.75,max:4.05},'HβS2':{min:3.75,max:4.05},'HNH3':{min:7.50,max:8.50}}, cosy: [['HCH2OP','HαS'],['HαS','HβS1'],['HαS','HβS2'],['HβS1','HβS2']], spin: [['HCH2OP','HαS','HβS1','HβS2'],['HNH3']], carbonMap: {'HCH2OP':'CH2OP','HαS':'CαS','HβS1':'CβS','HβS2':'CβS','HNH3':null}, carbonRanges: {'CH2OP':[62,67],'CαS':[53,58],'CβS':[59,64]}, extra: {'COO⁻':[170,175]} },
  PG: { atoms: ['HCH2OP','HCHOH','HCH2OHa','HCH2OHb'], ranges: {'HCH2OP':{min:3.90,max:4.20},'HCHOH':{min:3.65,max:3.90},'HCH2OHa':{min:3.45,max:3.75},'HCH2OHb':{min:3.45,max:3.75}}, cosy: [['HCH2OP','HCHOH'],['HCHOH','HCH2OHa'],['HCHOH','HCH2OHb'],['HCH2OHa','HCH2OHb']], spin: [['HCH2OP','HCHOH','HCH2OHa','HCH2OHb']], carbonMap: {'HCH2OP':'CH2OP','HCHOH':'CHOH','HCH2OHa':'CH2OH','HCH2OHb':'CH2OH'}, carbonRanges: {'CH2OP':[63,68],'CHOH':[67,72],'CH2OH':[61,65]}, extra: {} }
};
const LIPID_COMMON_CARBON = { 'Csn1':[61,67],'Csn2':[67,72],'Csn3':[62,68],'C2-sn1':[33,36],'C3-sn1':[24,27],'C4-sn1':[28,31],'C16-sn1':[13,15],'C2-sn2':[33,36],'C3-sn2':[24,27],'C4-sn2':[28,31],'Call-sn2':[26,29],'C8-sn2':[127,132],'C9-sn2':[127,132],'C18-sn2':[13,15] };
const buildLipid = (key, fullName, head) => {
  const h = LIPID_HEADS[head];
  const glyAtoms = Object.keys(LIPID_GLY_RANGES), chainAtoms = Object.keys(LIPID_CHAIN_RANGES);
  return {
    name: fullName, code3: key, head,
    atoms: [...glyAtoms, ...chainAtoms, ...h.atoms],
    ranges: { ...LIPID_GLY_RANGES, ...LIPID_CHAIN_RANGES, ...h.ranges },
    cosy: [...LIPID_GLY_COSY, ...LIPID_CHAIN_COSY, ...h.cosy],
    spinSystems: [['Hsn1a','Hsn1b','Hsn2g','Hsn3a','Hsn3b'], ['H2-sn1','H3-sn1','H4-sn1','H16-sn1'], ['H2-sn2','H3-sn2','H4-sn2','Hall-sn2','H8-sn2','H9-sn2','H18-sn2'], ...h.spin],
    carbonMap: {'Hsn1a':'Csn1','Hsn1b':'Csn1','Hsn2g':'Csn2','Hsn3a':'Csn3','Hsn3b':'Csn3','H2-sn1':'C2-sn1','H3-sn1':'C3-sn1','H4-sn1':'C4-sn1','H16-sn1':'C16-sn1','H2-sn2':'C2-sn2','H3-sn2':'C3-sn2','H4-sn2':'C4-sn2','Hall-sn2':'Call-sn2','H8-sn2':'C8-sn2','H9-sn2':'C9-sn2','H18-sn2':'C18-sn2', ...h.carbonMap},
    carbonRanges: { ...LIPID_COMMON_CARBON, ...h.carbonRanges },
    extraCarbons: { 'C=O (sn-1)':[172,176], 'C=O (sn-2)':[172,176], ...h.extra }
  };
};
const LIPID_DB = {
  'POPC': buildLipid('POPC', 'POPC (1-palmitoyl-2-oleoyl-sn-glycero-3-phosphocholine)', 'PC'),
  'POPE': buildLipid('POPE', 'POPE (1-palmitoyl-2-oleoyl-sn-glycero-3-phosphoethanolamine)', 'PE'),
  'POPS': buildLipid('POPS', 'POPS (1-palmitoyl-2-oleoyl-sn-glycero-3-phosphoserine)', 'PS'),
  'POPG': buildLipid('POPG', 'POPG (1-palmitoyl-2-oleoyl-sn-glycero-3-phosphoglycerol)', 'PG')
};

// --- REALISTIC ¹³C RANDOM-COIL RANGES (BMRB statistics) ---
const CARBON_RANGE_DB = {
  'A': { 'Cα': [49.5, 53.5], 'Cβ': [15.5, 20.5] },
  'R': { 'Cα': [53.0, 58.0], 'Cβ': [27.0, 32.0], 'Cγ': [23.0, 28.0], 'Cδ': [39.0, 44.0], 'Cζ': [155.0, 160.0] },
  'N': { 'Cα': [49.5, 54.5], 'Cβ': [35.0, 40.0], 'Cγ(CONH₂)': [171.0, 176.0] },
  'D': { 'Cα': [50.0, 55.0], 'Cβ': [37.0, 42.0], 'Cγ(COO⁻)': [173.0, 178.0] },
  'C': { 'Cα': [54.5, 60.0], 'Cβ': [26.0, 32.0] },
  'E': { 'Cα': [53.0, 58.0], 'Cβ': [26.0, 31.0], 'Cγ': [32.0, 37.0], 'Cδ(COO⁻)': [176.0, 181.0] },
  'Q': { 'Cα': [52.5, 57.5], 'Cβ': [26.0, 31.0], 'Cγ': [30.0, 35.0], 'Cδ(CONH₂)': [173.0, 178.0] },
  'G': { 'Cα': [41.0, 46.0] },
  'H': { 'Cα': [51.5, 57.0], 'Cβ': [27.0, 33.0], 'Cγ': [126.0, 133.0], 'Cδ2': [114.0, 120.0], 'Cε1': [131.0, 138.0] },
  'I': { 'Cα': [57.0, 62.5], 'Cβ': [34.0, 39.5], 'Cγ1': [23.0, 29.0], 'Cγ2': [13.5, 19.0], 'Cδ1': [9.0, 14.5] },
  'L': { 'Cα': [51.0, 56.5], 'Cβ': [38.0, 44.0], 'Cγ': [22.5, 28.0], 'Cδ1': [20.0, 25.5], 'Cδ2': [20.0, 25.5] },
  'K': { 'Cα': [53.0, 58.5], 'Cβ': [29.0, 34.5], 'Cγ': [21.0, 26.5], 'Cδ': [26.0, 31.5], 'Cε': [38.5, 43.5] },
  'M': { 'Cα': [51.5, 57.0], 'Cβ': [28.0, 33.5], 'Cγ': [13.0, 18.5], 'Cε(CH3)': [12.5, 18.0] },
  'F': { 'Cα': [53.0, 58.5], 'Cβ': [35.0, 41.0], 'Cγ': [133.0, 139.0], 'Cδ': [126.5, 132.0], 'Cε': [126.0, 131.5], 'Cζ': [124.0, 129.5] },
  'P': { 'Cα': [58.0, 64.0], 'Cβ': [27.5, 33.5], 'Cγ': [22.5, 28.5], 'Cδ': [45.0, 51.5] },
  'S': { 'Cα': [53.5, 60.0], 'Cβ': [59.5, 66.5] },
  'T': { 'Cα': [56.5, 64.0], 'Cβ': [64.5, 72.5], 'Cγ2': [17.5, 23.5] },
  'V': { 'Cα': [57.5, 64.0], 'Cβ': [28.5, 34.5], 'Cγ1': [16.5, 22.5], 'Cγ2': [16.5, 22.5] },
  'W': { 'Cα': [53.5, 59.0], 'Cβ': [25.5, 32.0], 'Cγ': [107.0, 114.0], 'Cδ1': [119.0, 126.0], 'Cε1': [108.0, 115.0], 'Cζ2': [115.0, 122.0], 'Cη2': [117.0, 124.0], 'Cζ3': [115.0, 122.0], 'Cε3': [115.0, 121.0] },
  'Y': { 'Cα': [53.0, 58.5], 'Cβ': [34.5, 41.0], 'Cγ': [125.5, 131.5], 'Cδ': [128.0, 134.0], 'Cε': [112.5, 118.5], 'Cζ': [151.0, 158.0] }
};
const PROTEIN_EXTRA_CARBONS = { 'D': ['Cγ(COO⁻)'], 'E': ['Cδ(COO⁻)'], 'N': ['Cγ(CONH₂)'], 'Q': ['Cδ(CONH₂)'], 'R': ['Cζ'] };
const NUCLEOTIDE_CARBON_DB = {
  DNA: {
    'A': { "C8":[136,142], "C2":[148,156], "C1'":[81,87], "C2'":[36,42], "C3'":[75,84], "C4'":[79,86], "C5'":[60,67] },
    'G': { "C8":[134,141], "C1'":[80,87], "C2'":[35,42], "C3'":[75,84], "C4'":[78,86], "C5'":[60,67] },
    'C': { "C6":[138,146], "C5":[98,106], "C1'":[81,88], "C2'":[35,42], "C3'":[75,84], "C4'":[78,86], "C5'":[60,67] },
    'T': { "C6":[134,142], "C1'":[81,88], "C2'":[34,41], "C3'":[75,84], "C4'":[78,86], "C5'":[60,67], "C7(Me)":[10,16] }
  },
  RNA: {
    'A': { "C8":[136,143], "C2":[147,155], "C1'":[85,92], "C2'":[70,77], "C3'":[68,77], "C4'":[80,87], "C5'":[59,66] },
    'G': { "C8":[134,142], "C1'":[85,92], "C2'":[69,77], "C3'":[68,77], "C4'":[79,87], "C5'":[59,66] },
    'C': { "C6":[137,146], "C5":[99,107], "C1'":[86,93], "C2'":[68,76], "C3'":[68,77], "C4'":[79,86], "C5'":[58,66] },
    'U': { "C6":[137,146], "C5":[99,108], "C1'":[85,93], "C2'":[68,76], "C3'":[68,77], "C4'":[79,86], "C5'":[58,66] }
  }
};
const NUC_EXTRA_CARBONS = { DNA: { 'A': { 'C4':[147,153], 'C5':[117,123], 'C6':[152,157] }, 'G': { 'C2':[145,152], 'C4':[149,155], 'C5':[114,120], 'C6':[153,159] }, 'C': { 'C2':[154,160], 'C4':[163,169] }, 'T': { 'C2':[149,155], 'C4':[163,169], 'C5':[108,114] } }, RNA: { 'A': { 'C4':[147,153], 'C5':[117,123], 'C6':[152,157] }, 'G': { 'C2':[145,152], 'C4':[149,155], 'C5':[114,120], 'C6':[153,159] }, 'C': { 'C2':[154,160], 'C4':[163,169] }, 'U': { 'C2':[149,156], 'C4':[163,170] } } };

// --- SECONDARY STRUCTURE CORRECTIONS (Δδ vs random coil, ppm) ---
const SS_CORRECTIONS = {
  coil: { h: {}, c: {} },
  helix: { h: { 'HN': -0.45, 'Hα': -0.35, 'Hα1': -0.35, 'Hα2': -0.35, other: -0.05 }, c: { 'Cα': 2.8, 'Cβ': -1.5, "C'": -1.3, 'N': -2.5 } },
  sheet: { h: { 'HN': 0.40, 'Hα': 0.30, 'Hα1': 0.30, 'Hα2': 0.30, other: 0.05 }, c: { 'Cα': -1.6, 'Cβ': 1.4, "C'": 1.5, 'N': 2.0 } }
};
const SS_META = { 'C': { label: 'Random coil', color: '#64748b' }, 'H': { label: 'α-Helix', color: '#8b5cf6' }, 'E': { label: 'β-Sheet', color: '#f59e0b' } };

const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#f43f5e'];
const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
const TICKS_13C = Array.from({ length: 34 }, (_, i) => i * 5);
const CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
const CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

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
  if (char === 'W' && atom === 'Hδ1') return null;
  let cName = atom.replace('H', 'C').replace(/\d+$/, '');
  if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
  if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
  if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
  if (atom.includes('CH3') || atom.includes('(Me)')) return atom.replace('H', 'C');
  return cName;
};
const getCarbonNameNuc = (atom) => {
  if (!atom || !atom.startsWith('H')) return null;
  if (atom === "H2''") return "C2'";
  if (atom === "H5''") return "C5'";
  if (atom.includes('(Me)')) return atom.replace('H', 'C');
  return atom.replace('H', 'C');
};
const carbonNameFor = (molType, res, atom) => {
  if (molType === 'protein') return getCarbonName(res.char, atom);
  if (molType === 'dna' || molType === 'rna') return getCarbonNameNuc(atom);
  return res.carbonMap ? (res.carbonMap[atom] ?? null) : null;
};
const getCarbonRangeFor = (molType, char, cName) => {
  if (!cName) return { min: 40, max: 50 };
  if (molType === 'protein') { const r = CARBON_RANGE_DB[char]?.[cName]; if (r) return { min: r[0], max: r[1] }; return { min: 40, max: 60 }; }
  if (molType === 'dna' || molType === 'rna') { const r = NUCLEOTIDE_CARBON_DB[molType === 'dna' ? 'DNA' : 'RNA'][char]?.[cName]; if (r) return { min: r[0], max: r[1] }; return { min: 60, max: 90 }; }
  if (molType === 'sugar') { const r = SUGAR_DB[char]?.carbonRanges?.[cName]; if (r) return { min: r[0], max: r[1] }; return { min: 60, max: 80 }; }
  if (molType === 'lipid') { const r = LIPID_DB[char]?.carbonRanges?.[cName]; if (r) return { min: r[0], max: r[1] }; return { min: 25, max: 40 }; }
  return { min: 40, max: 60 };
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
  if (molType === 'dna' || molType === 'rna') return atom.includes('(Me)') ? 3 : 1;
  if (molType === 'sugar') { if (atom === 'AcCH3') return 3; if (res.char === 'FUC' && atom === 'H6') return 3; return 1; }
  if (molType === 'lipid') {
    const map = { 'H2-sn1':2, 'H3-sn1':2, 'H4-sn1':20, 'H16-sn1':3, 'H2-sn2':2, 'H3-sn2':2, 'H4-sn2':12, 'Hall-sn2':4, 'H8-sn2':1, 'H9-sn2':1, 'H18-sn2':3, 'HNMe3':9, 'HCH2OP':2, 'HCH2N':2, 'HNH3':3, 'HαS':1, 'HβS1':1, 'HβS2':1, 'HCHOH':1, 'HCH2OHa':1, 'HCH2OHb':1, 'Hsn1a':1, 'Hsn1b':1, 'Hsn2g':1, 'Hsn3a':1, 'Hsn3b':1 };
    return map[atom] ?? 1;
  }
  return 1;
};
const getPascalRow = (n) => { if (n === 0) return [1]; let row = [1]; for (let i = 0; i < n; i++) { let nextRow = [1]; for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j+1]); nextRow.push(1); row = nextRow; } return row; };
const getHexagon = (cx, cy, r, dir) => { const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2; for(let i=0; i<6; i++) { const a = baseAngle + i * (Math.PI/3) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const getPentagon = (cx, cy, r, dir) => { const pts = []; const baseAngle = dir === 1 ? -Math.PI/2 : Math.PI/2; for(let i=0; i<5; i++) { const a = baseAngle + i * (2*Math.PI/5) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } return pts; };
const parseManual = (v) => { if (v === undefined || v === null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

// --- 2. REUSABLE COLLAPSIBLE SECTION ---
export const CollapsibleSection = ({ title, icon, defaultOpen = true, children, headerExtra, className = "" }) => {
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

// --- 3. RECHARTS CUSTOM TICKS ---
const CustomXTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (
    <g transform={`translate(${x||0},${y||0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}
    </g>
  );
};
const CustomYTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (
    <g transform={`translate(${x||0},${y||0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}
    </g>
  );
};
const CustomXTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 8 : (isFive ? 6 : 4));
  return (
    <g transform={`translate(${x||0},${y||0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}
    </g>
  );
};
const CustomYTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 10 : (isFive ? 6 : 4));
  return (
    <g transform={`translate(${x||0},${y||0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}
    </g>
  );
};
const NMRTooltip = ({ active, payload, diagonalColor }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    if (data.min !== undefined) return (
      <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
        <p className="font-bold text-slate-800">{data.res} - {data.atom}</p>
        <p className="text-slate-500">Theoretical Range: {data.min.toFixed(2)} - {data.max.toFixed(2)} ppm</p>
      </div>
    );
    if (data.type === '1D') return (
      <div className="bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50">
        <p className="font-bold text-slate-800">{data.label}</p>
        <p className="text-slate-500">{data.x.toFixed(3)} ppm</p>
        {data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}
      </div>
    );
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50">
        <p className="font-bold text-slate-800">{data.label}</p>
        <p className="font-semibold" style={{ color: data.type === 'Diagonal' ? diagonalColor : getNMRFillColor(data) }}>{data.type}</p>
        <p className="text-slate-500 text-xs mt-1">F2: {Number(data.x).toFixed(2)} ppm <br/> F1: {Number(data.y).toFixed(2)} ppm</p>
      </div>
    );
  }
  return null;
};

// --- 4A. CUSTOM SVG RANGE CHART ---
const RangeBarChart = ({ title, ranges, domain, ticks, xAxisLabel, rowCount, rowLabels }) => {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const update = () => setWidth(el.clientWidth); update();
    let ro = null; if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(update); ro.observe(el); }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const margin = { top: 10, right: 24, bottom: 40, left: 64 };
  const rowH = 26; const nRows = Math.max(1, rowCount);
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
          const row = nRows - 1 - r.y; const x1 = xScale(r.max); const x2 = xScale(r.min); const cy = yCenter(row);
          const isHov = hover && hover.idx === i;
          return <rect key={`range-${i}`} x={x1} y={cy - 5} width={Math.max(2, x2 - x1)} height={10} rx={3} fill={r.color} fillOpacity={isHov ? 1 : 0.75} stroke={r.color} strokeWidth={1} style={{ cursor: 'pointer' }}
            onMouseMove={(e) => { const crect = containerRef.current.getBoundingClientRect(); setHover({ idx: i, x: e.clientX - crect.left, y: e.clientY - crect.top }); }}
            onMouseLeave={() => setHover(null)} />;
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

// --- 4B. ZOOMABLE PLOTS ---
const OneDSpectrumPlot = ({ title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel }) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState(fullDomain);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const chartRef = useRef(null); const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== fullDomain[0] || xDomain[1] !== fullDomain[1];
  const getXVal = (clientX) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper'); if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN_1D.left - CHART_MARGIN_1D.right; if (plotW <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN_1D.left;
    const fx = Math.min(1, Math.max(0, px / plotW));
    return xDomain[1] - fx * (xDomain[1] - xDomain[0]);
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const xVal = getXVal(e.clientX); if (xVal !== null) setRefAreaRight(xVal); };
    const handleMouseUp = () => {
      if (!isDragging.current) return; isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
      setRefAreaLeft(null); setRefAreaRight(null);
    };
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight]);
  const handleMouseDown = (e) => { const xVal = getXVal(e.clientX); if (xVal !== null) { isDragging.current = true; setRefAreaLeft(xVal); setRefAreaRight(xVal); } };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={CHART_MARGIN_1D}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : ticks} interval={0} tickLine={false} tick={<TickComponent isZoomed={isZoomed} />} label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis type="number" dataKey="y" domain={[0, 'auto']} hide={true} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip />} />
              <Bar dataKey="y" barSize={2} shape={(props) => { const { x, y, width, height, payload } = props; const centerX = x + width / 2; return <line x1={centerX} y1={y + height} x2={centerX} y2={y} stroke={payload.color} strokeWidth={1.5} />; }} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />}
            </BarChart>
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
  const chartRef = useRef(null); const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 11;
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper'); if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right; const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left; const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW)); const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return; isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) { setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => { const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }} />
              <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomYTick1H isZoomed={isZoomed} />} label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }} />
              <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter name="Diagonal" data={[{x:0, y:0}, {x:11, y:11}]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={<circle r={0} />} legendType="none" isAnimationActive={false} />
              <Scatter data={diagonalData} fill={diagonalColor} shape={(props) => { const { cx, cy, fill, payload } = props; if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null; return <circle cx={cx} cy={cy} r={payload.size || 5} fill={payload.type === 'Diagonal' ? fill : getNMRFillColor(payload)} opacity={0.8} />; }} isAnimationActive={false} />
              <Scatter data={crossPeakData} shape={(props) => { const { cx, cy, payload } = props; if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null; return <circle cx={cx} cy={cy} r={payload.size || 5} fill={getNMRFillColor(payload)} opacity={0.8} />; }} isAnimationActive={false} />
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
  const [xDomain, setXDomain] = useState([0, 11]); const [yDomain, setYDomain] = useState([0, 165]);
  const [refAreaLeft, setRefAreaLeft] = useState(null); const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null); const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null); const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 165;
  const getPlotCoords = (clientX, clientY) => {
    if (!chartRef.current) return null;
    const wrapper = chartRef.current.querySelector('.recharts-wrapper'); if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const plotW = rect.width - CHART_MARGIN.left - CHART_MARGIN.right; const plotH = rect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
    if (plotW <= 0 || plotH <= 0) return null;
    const px = clientX - rect.left - CHART_MARGIN.left; const py = clientY - rect.top - CHART_MARGIN.top;
    const fx = Math.min(1, Math.max(0, px / plotW)); const fy = Math.min(1, Math.max(0, py / plotH));
    return { x: xDomain[1] - fx * (xDomain[1] - xDomain[0]), y: yDomain[0] + fy * (yDomain[1] - yDomain[0]) };
  };
  useEffect(() => {
    const handleMouseMove = (e) => { if (!isDragging.current) return; const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
    const handleMouseUp = () => {
      if (!isDragging.current) return; isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null) {
        if (refAreaLeft !== refAreaRight && refAreaTop !== refAreaBottom) { setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]); setYDomain([Math.min(refAreaTop, refAreaBottom), Math.max(refAreaTop, refAreaBottom)]); }
      }
      setRefAreaLeft(null); setRefAreaRight(null); setRefAreaTop(null); setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => { const coords = getPlotCoords(e.clientX, e.clientY); if (coords) { isDragging.current = true; setRefAreaLeft(coords.x); setRefAreaTop(coords.y); setRefAreaRight(coords.x); setRefAreaBottom(coords.y); } };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)}></div>}
      <div className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'h-[400px] lg:col-span-2 break-inside-avoid'}`}>
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && <button onClick={() => { setXDomain([0, 11]); setYDomain([0, 165]); }} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">Reset Zoom</button>}
          </div>
          <button onClick={() => setExpandedPanel(isExpanded ? null : panelId)} className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5">{isExpanded ? '↙️' : '↗️'}</button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="x" domain={xDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_1H} interval={0} tickLine={false} tick={<CustomXTick1H isZoomed={isZoomed} />} label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }} />
              <YAxis type="number" dataKey="y" domain={yDomain} allowDataOverflow reversed={true} ticks={isZoomed ? undefined : TICKS_13C} interval={0} tickLine={false} tick={<CustomYTick13C isZoomed={isZoomed} />} label={{ value: '¹³C F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }} />
              <Tooltip content={<NMRTooltip diagonalColor="#8b5cf6" />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter data={crossPeakData} shape={(props) => { const { cx, cy, payload } = props; if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null; return <circle cx={cx} cy={cy} r={payload.size || 5} fill={getNMRFillColor(payload)} opacity={0.8} />; }} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

// --- 5. SHARED STRUCTURE ELEMENT RENDERER ---
const StructureSVG = ({ elements, viewBox, minWidthPx, isExpanded }) => (
  <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
    <svg viewBox={viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : '340px', minWidth: minWidthPx }}>
      {elements.filter(e => e.type === 'line').map((el, idx) => <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth="1.8" opacity={el.opacity ?? 1} />)}
      {elements.filter(e => e.type === 'path').map((el, idx) => <path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth="1.8" opacity={el.opacity ?? 1} />)}
      {elements.filter(e => e.type === 'polygon').map((el, idx) => <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth="1.8" opacity={el.opacity ?? 1} />)}
      {elements.filter(e => e.type === 'circle').map((el, idx) => <circle key={`c${idx}`} cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : "1.5"} opacity={el.opacity ?? 1} />)}
      {elements.filter(e => e.type === 'text').map((el, idx) => (
        <g key={`t${idx}`} opacity={el.opacity ?? 1}>
          <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
          <text x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
        </g>
      ))}
    </svg>
  </div>
);
const useStructureElements = () => {
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  return { elements, updateBounds, getViewBox: (pad = 20) => `${minX - pad} ${minY - pad} ${maxX - minX + 2*pad} ${maxY - minY + 2*pad}` };
};

// --- 5A. PROTEIN 2D STRUCTURE ---
const ChemicalStructure2D = ({ sequence, isExpanded, onToggleExpand, focusIdx }) => {
  if (!sequence || sequence.length === 0) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  let currentRi = null;
  const op = () => (focusIdx !== 'ALL' && currentRi !== null && currentRi !== focusIdx) ? 0.15 : 1;
  const addLine = (x1, y1, x2, y2, color, isDouble = false) => {
    updateBounds(x1, y1); updateBounds(x2, y2);
    if (isDouble) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.sqrt(dx * dx + dy * dy); const nx = -dy / len * 2.5; const ny = dx / len * 2.5; elements.push({ type: 'line', x1: x1+nx, y1: y1+ny, x2: x2+nx, y2: y2+ny, color, ri: currentRi, opacity: op() }); elements.push({ type: 'line', x1: x1-nx, y1: y1-ny, x2: x2-nx, y2: y2-ny, color, ri: currentRi, opacity: op() }); }
    else elements.push({ type: 'line', x1, y1, x2, y2, color, ri: currentRi, opacity: op() });
  };
  const addText = (x, y, text, color, fontSize = 11, align = 'middle') => { updateBounds(x, y - 15); updateBounds(x, y + 15); updateBounds(x - 30, y); updateBounds(x + 30, y); elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: currentRi, opacity: op() }); };
  const addCircleEl = (x, y, r, color, fill = 'white', strokeWidth) => { updateBounds(x - r, y - r); updateBounds(x + r, y + r); elements.push({ type: 'circle', x, y, r, color, fill, strokeWidth, ri: currentRi, opacity: op() }); };
  const addRingHeteroatom = (x, y, text, color) => { addCircleEl(x, y, 12, color, 'white', 0); addText(x, y, text, color, 12); };
  const placeRadialLabel = (cx, cy, pt, text, color) => { const angle = Math.atan2(pt.y - cy, pt.x - cx); const dist = 18; const lx = pt.x + dist * Math.cos(angle); const ly = pt.y + dist * Math.sin(angle); let anchor = 'middle'; if (Math.abs(angle) < Math.PI/3) anchor = 'start'; else if (Math.abs(angle) > 2*Math.PI/3) anchor = 'end'; addText(lx, ly, text, color, 11, anchor); };
  const addPolygon = (pointsStr, color) => { const pts = pointsStr.split(' ').map(p => p.split(',').map(Number)); pts.forEach(([x, y]) => updateBounds(x, y)); elements.push({ type: 'polygon', points: pointsStr, color, ri: currentRi, opacity: op() }); };
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
    currentRi = i;
    const color = c.res.color; const isFirst = i === 0; const isLast = i === sequence.length - 1; const char = c.res.char;
    if (!isFirst) addLine(coords[i-1].cX, coords[i-1].cY, c.nX, c.nY, coords[i-1].res.color);
    addLine(c.nX, c.nY, c.caX, c.caY, color); addLine(c.caX, c.caY, c.cX, c.cY, color); addLine(c.cX, c.cY, c.cX, c.cY + c.oDir * 25, "red", true);
    if (isLast) addLine(c.cX, c.cY, c.nextNX, c.nextNY, color);
    if (!isFirst && char !== 'P') { const hDir = c.nY < c.caY ? -1 : 1; addLine(c.nX, c.nY, c.nX, c.nY + hDir * 15, color); addText(c.nX, c.nY + hDir * 25, "H", color, 11); }
    if (char !== 'G') { const haDir = -c.scDir; addLine(c.caX, c.caY, c.caX, c.caY + haDir * 15, color); addText(c.caX, c.caY + haDir * 25, "Hα", color, 11); }
    else { addLine(c.caX, c.caY, c.caX, c.caY - 15, color); addText(c.caX, c.caY - 25, "Hα1", color, 11); addLine(c.caX, c.caY, c.caX, c.caY + 15, color); addText(c.caX, c.caY + 25, "Hα2", color, 11); }
    if (char === 'P') { elements.push({ type: 'path', d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir*40} ${c.caX} ${c.caY + c.scDir*25}`, color, ri: currentRi, opacity: op() }); addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * 25, color); }
    addCircleEl(c.nX, c.nY, 13, color);
    if (isFirst) addText(c.nX, c.nY, char === 'P' ? "H₂N⁺" : "H₃N⁺", color, 13); else addText(c.nX, c.nY, "N", color, 13);
    addCircleEl(c.caX, c.caY, 13, color); addText(c.caX, c.caY, "Cα", color, 13);
    addCircleEl(c.cX, c.cY, 13, color); addText(c.cX, c.cY, "C", color, 13);
    addText(c.cX, c.cY + c.oDir * 35, "O", "red", 13);
    if (isLast) { addCircleEl(c.nextNX, c.nextNY, 13, color); addText(c.nextNX, c.nextNY, "O⁻", "red", 13); }
    const vNode = (lvl, text) => { if(lvl > 0) addLine(c.caX, c.caY + c.scDir * (lvl - 1) * S, c.caX, c.caY + c.scDir * lvl * S, color); addText(c.caX, c.caY + c.scDir * (lvl * S + (c.scDir === 1 ? 10 : -10)), text, color); };
    if (char !== 'G' && char !== 'P') { addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * S, color); if (!['A','I','V','T','F','Y','W','H'].includes(char)) addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color); }
    switch(char) {
      case 'A': addText(c.caX, c.caY + c.scDir * S, "CH₃ (Hβ)", color); break;
      case 'V': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ1)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.8*S, color); addText(c.caX+20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); break;
      case 'L': vNode(2, 'CH (Hγ)'); addLine(c.caX, c.caY+c.scDir*2*S, c.caX-20, c.caY+c.scDir*2.8*S, color); addText(c.caX-20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ1)', color); addLine(c.caX, c.caY+c.scDir*2*S, c.caX+20, c.caY+c.scDir*2.8*S, color); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ2)', color); break;
      case 'I': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.8*S, color); addText(c.caX+20, c.caY+c.scDir*(1.8*S+10), 'CH₂ (Hγ1)', color); addLine(c.caX+20, c.caY+c.scDir*1.8*S, c.caX+20, c.caY+c.scDir*2.8*S, color); addText(c.caX+20, c.caY+c.scDir*(2.8*S+10), 'CH₃ (Hδ1)', color); break;
      case 'S': vNode(2, 'OH (Hγ)'); break;
      case 'T': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY+c.scDir*S, c.caX-20, c.caY+c.scDir*1.8*S, color); addText(c.caX-20, c.caY+c.scDir*(1.8*S+10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY+c.scDir*S, c.caX+20, c.caY+c.scDir*1.5*S, color); addText(c.caX+20, c.caY+c.scDir*(1.5*S+10), 'OH (Hγ1)', color); break;
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
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const hcx = c.caX; const hcy = c.caY + c.scDir * 3 * S; const hPts = getHexagon(hcx, hcy, S, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, hPts[0].x, hPts[0].y, color); addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); addCircleEl(hcx, hcy, S * 0.6, color, 'none');
        placeRadialLabel(hcx, hcy, hPts[1], 'CH (Hδ2)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hδ1)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hε1)', color);
        if (char === 'Y') { const angleZ = Math.atan2(hPts[3].y - hcy, hPts[3].x - hcx); const ohX = hPts[3].x + S * Math.cos(angleZ); const ohY = hPts[3].y + S * Math.sin(angleZ); addLine(hPts[3].x, hPts[3].y, ohX, ohY, color); placeRadialLabel(hPts[3].x, hPts[3].y, {x: ohX, y: ohY}, 'OH (Hη)', color); }
        else placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color);
        break;
      }
      case 'H': {
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); addCircleEl(pcx, pcy, R5 * 0.5, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color); addRingHeteroatom(pPts[4].x, pPts[4].y, "N", color);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ2)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε2)', color); placeRadialLabel(pcx, pcy, pPts[3], 'CH (Hε1)', color);
        break;
      }
      case 'W': {
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); addCircleEl(pcx, pcy, R5 * 0.5, color, 'none');
        const ce2 = pPts[3]; const cd2 = pPts[4]; const mx = (ce2.x + cd2.x) / 2; const my = (ce2.y + cd2.y) / 2;
        const midA = Math.atan2(my - pcy, mx - pcx); const hcx = mx + Math.cos(midA) * S * Math.sqrt(3)/2; const hcy = my + Math.sin(midA) * S * Math.sqrt(3)/2;
        const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx); const testA = startA + Math.PI/3; const sign = Math.hypot(hcx + S * Math.cos(testA) - cd2.x, hcy + S * Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
        const hPts = []; for(let j=0; j<6; j++) { const a = startA + j * sign * Math.PI/3; hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) }); }
        addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); addCircleEl(hcx, hcy, S * 0.6, color, 'none');
        addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ1)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε1)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε3)', color); placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ3)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hη2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hζ2)', color);
        break;
      }
    }
    const labelY = c.caY + (c.scDir > 0 ? 170 : -170); addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14);
  });
  const viewBox = `${minX - 15} ${minY - 15} ${maxX - minX + 30} ${maxY - minY + 30}`;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <StructureSVG elements={elements} viewBox={viewBox} minWidthPx={sequence.length > 3 ? `${sequence.length * 120}px` : '100%'} isExpanded={isExpanded} />
      </div>
    </>
  );
};

// --- 5B. REALISTIC NUCLEIC ACID 2D STRUCTURE (all atoms labeled) ---
const NucleicStructure2D = ({ sequence, molType, isExpanded, onToggleExpand, focusIdx }) => {
  if (!sequence || sequence.length === 0) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  let currentRi = null;
  const op = () => (focusIdx !== 'ALL' && currentRi !== null && currentRi !== focusIdx) ? 0.15 : 1;
  const addLine = (x1, y1, x2, y2, color, isDouble = false) => {
    updateBounds(x1, y1); updateBounds(x2, y2);
    if (isDouble) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.sqrt(dx*dx + dy*dy) || 1; const nx = -dy/len*2.5; const ny = dx/len*2.5; elements.push({ type:'line', x1:x1+nx, y1:y1+ny, x2:x2+nx, y2:y2+ny, color, ri:currentRi, opacity:op() }); elements.push({ type:'line', x1:x1-nx, y1:y1-ny, x2:x2-nx, y2:y2-ny, color, ri:currentRi, opacity:op() }); }
    else elements.push({ type: 'line', x1, y1, x2, y2, color, ri: currentRi, opacity: op() });
  };
  const addText = (x, y, text, color, fontSize = 11, align = 'middle') => { updateBounds(x, y - 15); updateBounds(x, y + 15); updateBounds(x - 30, y); updateBounds(x + 30, y); elements.push({ type: 'text', x, y, text, color, fontSize, align, ri: currentRi, opacity: op() }); };
  const addNode = (x, y, label, color, r = 13, fs = 9) => { updateBounds(x - r, y - r); updateBounds(x + r, y + r); elements.push({ type: 'circle', x, y, r, color, fill: 'white', ri: currentRi, opacity: op() }); addText(x, y, label, color, fs); };
  const addPolygon = (pointsStr, color) => { const pts = pointsStr.split(' ').map(p => p.split(',').map(Number)); pts.forEach(([x, y]) => updateBounds(x, y)); elements.push({ type: 'polygon', points: pointsStr, color, ri: currentRi, opacity: op() }); };
  const extLabel = (from, cx, cy, text, color, dist = 24) => { const a = Math.atan2(from.y - cy, from.x - cx); addText(from.x + dist*Math.cos(a), from.y + dist*Math.sin(a), text, color, 10); };
  const isDNA = molType === 'dna';
  const SP = 175, r = 30, sy = -70;
  sequence.forEach((res, i) => {
    currentRi = i;
    const color = res.color; const sx = 120 + i * SP;
    // Sugar ring: O4', C1', C2', C3', C4'
    const O4 = { x: sx, y: sy - r };
    const C1 = { x: sx + r*0.95, y: sy - r*0.31 };
    const C2 = { x: sx + r*0.59, y: sy + r*0.81 };
    const C3 = { x: sx - r*0.59, y: sy + r*0.81 };
    const C4 = { x: sx - r*0.95, y: sy - r*0.31 };
    addPolygon([O4, C1, C2, C3, C4].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), color);
    // C5' / O5' arm
    const C5p = { x: sx - r - 22, y: sy - r - 14 };
    const O5p = { x: sx - r - 40, y: sy - r + 3 };
    addLine(C4.x, C4.y, C5p.x, C5p.y, color); addLine(C5p.x, C5p.y, O5p.x, O5p.y, color);
    if (i === 0) { addText(O5p.x - 22, O5p.y - 6, "HO-5′", color, 11, 'end'); }
    else {
      const P = { x: sx - 85, y: -30 };
      addLine(O5p.x, O5p.y, P.x, P.y, color);
      addNode(P.x, P.y, 'P', '#f97316', 13, 12);
      addLine(P.x, P.y, P.x - 19, P.y - 13, color, true); addText(P.x - 30, P.y - 18, 'O', 'red', 11);
      addLine(P.x, P.y, P.x - 19, P.y + 13, color); addText(P.x - 30, P.y + 20, 'O⁻', 'red', 11);
      const prevO3 = { x: sx - SP - 34, y: -24 };
      addLine(P.x, P.y, prevO3.x, prevO3.y, color);
    }
    // O3'
    const O3 = { x: sx - 34, y: -24 };
    addLine(C3.x, C3.y, O3.x, O3.y, color);
    if (i === sequence.length - 1) addText(O3.x - 12, O3.y + 14, "3′-OH", color, 11, 'end');
    // Sugar atom labels
    addNode(O4.x, O4.y, "O4′", color); addNode(C1.x, C1.y, "C1′", color); addNode(C2.x, C2.y, "C2′", color); addNode(C3.x, C3.y, "C3′", color); addNode(C4.x, C4.y, "C4′", color);
    addNode(C5p.x, C5p.y, "C5′", color); addText(O5p.x - 4, O5p.y - 14, "O5′", color, 10);
    // Sugar protons
    addText(C1.x + 18, C1.y - 14, "H1′", color, 10, 'start');
    if (isDNA) { addText(C2.x + 16, C2.y + 16, "H2′", color, 10, 'start'); addText(C2.x - 2, C2.y + 22, "H2″", color, 10); }
    else { addText(C2.x + 20, C2.y + 14, "O2′H", '#ef4444', 10, 'start'); addText(C2.x - 2, C2.y + 22, "H2′", color, 10); }
    addText(C3.x + 8, C3.y + 20, "H3′", color, 10);
    addText(C4.x - 20, C4.y + 14, "H4′", color, 10, 'end');
    addText(C5p.x - 6, C5p.y - 16, "H5′", color, 10); addText(C5p.x + 14, C5p.y - 14, "H5″", color, 10);
    // Base
    const gx = sx + 60, gy = sy - 40; // glycosidic N position
    addLine(C1.x, C1.y, gx, gy, color);
    const base = res.char;
    const hexPt = (cx, cy, rad, deg) => ({ x: cx + rad * Math.cos(deg * Math.PI / 180), y: cy + rad * Math.sin(deg * Math.PI / 180) });
    if (base === 'C' || base === 'T' || base === 'U') {
      const bc = { x: gx, y: gy - 30 };
      const N1 = { x: gx, y: gy }, C2v = hexPt(bc.x, bc.y, 30, 150), N3 = hexPt(bc.x, bc.y, 30, 210), C4 = hexPt(bc.x, bc.y, 30, 270), C5 = hexPt(bc.x, bc.y, 30, 330), C6 = hexPt(bc.x, bc.y, 30, 30);
      addPolygon([N1, C2v, N3, C4, C5, C6].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), color);
      addNode(N1.x, N1.y, 'N1', color); addNode(N3.x, N3.y, 'N3', color);
      addNode(C2v.x, C2v.y, 'C2', color); addNode(C4.x, C4.y, 'C4', color); addNode(C5.x, C5.y, 'C5', color); addNode(C6.x, C6.y, 'C6', color);
      if (base === 'C') { addLine(C2v.x, C2v.y, C2v.x - 18, C2v.y + 12, color); addText(C2v.x - 30, C2v.y + 20, 'NH₂', '#0ea5e9', 10); addLine(C4.x, C4.y, C4.x - 16, C4.y - 14, color, true); addText(C4.x - 26, C4.y - 22, 'O', 'red', 11); extLabel(C5, bc.x, bc.y, 'H5', color); extLabel(C6, bc.x, bc.y, 'H6', color); }
      else { addLine(C2v.x, C2v.y, C2v.x - 18, C2v.y + 12, color, true); addText(C2v.x - 28, C2v.y + 20, 'O', 'red', 11); addLine(C4.x, C4.y, C4.x - 16, C4.y - 14, color, true); addText(C4.x - 26, C4.y - 22, 'O', 'red', 11); extLabel(C6, bc.x, bc.y, 'H6', color);
        if (base === 'T') { addLine(C5.x, C5.y, C5.x + 20, C5.y - 14, color); addText(C5.x + 34, C5.y - 20, 'CH₃ (H7)', color, 10); } else extLabel(C5, bc.x, bc.y, 'H5', color);
        if (base === 'U' || base === 'T') { addText(N3.x - 20, N3.y + 4, 'N3-H', color, 9, 'end'); }
      }
    } else {
      // Purine: 5-ring (N9-C8-N7-C5-C4) + 6-ring (C4-C5-C6-N1-C2-N3)
      const N9 = { x: gx, y: gy };
      const C8 = { x: gx + 26, y: gy - 22 };
      const N7 = { x: gx + 14, y: gy - 48 };
      const C5 = { x: gx - 8, y: gy - 44 };
      const C4 = { x: gx - 16, y: gy - 18 };
      const C6 = { x: gx - 34, y: gy - 60 };
      const N1 = { x: gx - 58, y: gy - 48 };
      const C2 = { x: gx - 58, y: gy - 22 };
      const N3 = { x: gx - 40, y: gy - 8 };
      addPolygon([N9, C8, N7, C5, C4].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), color);
      addPolygon([C4, C5, C6, N1, C2, N3].map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), color);
      addNode(N9.x, N9.y, 'N9', color); addNode(N7.x, N7.y, 'N7', color); addNode(N1.x, N1.y, 'N1', color); addNode(N3.x, N3.y, 'N3', color);
      addNode(C8.x, C8.y, 'C8', color); addNode(C5.x, C5.y, 'C5', color); addNode(C4.x, C4.y, 'C4', color); addNode(C6.x, C6.y, 'C6', color); addNode(C2.x, C2.y, 'C2', color);
      addText(C8.x + 22, C8.y - 4, 'H8', color, 10, 'start');
      if (base === 'A') { addLine(C6.x, C6.y, C6.x - 14, C6.y - 16, color); addText(C6.x - 24, C6.y - 24, 'NH₂', '#0ea5e9', 10); addText(C2.x - 20, C2.y + 8, 'H2', color, 10, 'end'); }
      else { addLine(C6.x, C6.y, C6.x - 14, C6.y - 16, color, true); addText(C6.x - 24, C6.y - 24, 'O6', 'red', 10); addLine(C2.x, C2.y, C2.x - 16, C2.y + 12, color); addText(C2.x - 28, C2.y + 20, 'NH₂', '#0ea5e9', 10); addText(N1.x - 16, N1.y - 10, 'H', color, 10, 'end'); }
    }
    addText(sx, 75, `${res.name} (${res.id})`, color, 14);
  });
  addText(120 - 95, sy - r - 30, "5′", '#334155', 13);
  addText(120 + (sequence.length - 1) * SP + 55, sy + r + 30, "3′", '#334155', 13);
  const pad = 25;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2*pad} ${maxY - minY + 2*pad}`;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <StructureSVG elements={elements} viewBox={viewBox} minWidthPx={`${sequence.length * 190}px`} isExpanded={isExpanded} />
      </div>
    </>
  );
};

// --- 5C. SUGAR 2D STRUCTURE ---
const SugarStructure2D = ({ residue, isExpanded, onToggleExpand }) => {
  if (!residue) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const color = residue.color;
  const addLine = (x1, y1, x2, y2, isDouble = false) => {
    updateBounds(x1, y1); updateBounds(x2, y2);
    if (isDouble) { const dx = x2-x1, dy = y2-y1; const len = Math.sqrt(dx*dx+dy*dy)||1; const nx = -dy/len*3, ny = dx/len*3; elements.push({ type:'line', x1:x1+nx, y1:y1+ny, x2:x2+nx, y2:y2+ny, color, ri:0, opacity:1 }); elements.push({ type:'line', x1:x1-nx, y1:y1-ny, x2:x2-nx, y2:y2-ny, color, ri:0, opacity:1 }); }
    else elements.push({ type: 'line', x1, y1, x2, y2, color, ri: 0, opacity: 1 });
  };
  const addText = (x, y, text, fontSize = 11, align = 'middle', col = color) => { updateBounds(x, y - 15); updateBounds(x, y + 15); updateBounds(x - 34, y); updateBounds(x + 34, y); elements.push({ type: 'text', x, y, text, color: col, fontSize, align, ri: 0, opacity: 1 }); };
  const addNode = (x, y, label, r = 15, fs = 10) => { updateBounds(x - r, y - r); updateBounds(x + r, y + r); elements.push({ type: 'circle', x, y, r, color, fill: 'white', ri: 0, opacity: 1 }); addText(x, y, label, fs); };
  const addPolygon = (pts) => { pts.forEach(p => updateBounds(p.x, p.y)); elements.push({ type: 'polygon', points: pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), color, ri: 0, opacity: 1 }); };
  const st = residue.struct || { ring: 'pyranose' };
  const R = 70;
  const pt = (deg) => ({ x: R * Math.cos(deg * Math.PI / 180), y: R * Math.sin(deg * Math.PI / 180) });
  const rad = (p, d) => { const a = Math.atan2(p.y, p.x); return { x: p.x + d * Math.cos(a), y: p.y + d * Math.sin(a) }; };
  if (st.ring === 'furanose') {
    // Fructose: O4 at top, C2, C3, C4, C5
    const O4 = pt(-90), C2 = pt(-18), C3 = pt(54), C4 = pt(126), C5 = pt(198);
    addPolygon([O4, C2, C3, C4, C5]);
    addNode(O4.x, O4.y, 'O4'); addNode(C2.x, C2.y, 'C2'); addNode(C3.x, C3.y, 'C3'); addNode(C4.x, C4.y, 'C4'); addNode(C5.x, C5.y, 'C5');
    const e2 = rad(C2, 40), e3 = rad(C3, 40), e4 = rad(C4, 40);
    addLine(C2.x, C2.y, e2.x, e2.y); addText(e2.x + 14, e2.y, 'OH (anomeric)', 10, 'start');
    addLine(C3.x, C3.y, e3.x, e3.y); addText(e3.x, e3.y + 16, 'OH', 10);
    addLine(C4.x, C4.y, e4.x, e4.y); addText(e4.x - 12, e4.y + 14, 'OH', 10);
    const c1 = rad(C2, 55); addLine(C2.x, C2.y, c1.x * 0.9, c1.y * 0.9); addNode(c1.x * 1.15, c1.y * 1.15, 'C1', 15); addText(c1.x * 1.15 + 24, c1.y * 1.15, 'CH₂OH (H1a,H1b)', 10, 'start');
    const c6 = rad(C5, 55); addLine(C5.x, C5.y, c6.x * 0.9, c6.y * 0.9); addNode(c6.x * 1.15, c6.y * 1.15, 'C6', 15); addText(c6.x * 1.15 - 24, c6.y * 1.15, 'CH₂OH (H6a,H6b)', 10, 'end');
    addText(C5.x - 4, C5.y + 4, '', 1); addText(0, R + 60, `${residue.name} (${residue.id}) — furanose`, 14);
  } else if (st.special === 'sia') {
    const O = pt(-90), C2 = pt(-30), C3 = pt(30), C4 = pt(90), C5 = pt(150), C6 = pt(210);
    addPolygon([O, C2, C3, C4, C5, C6]);
    addNode(O.x, O.y, 'O'); addNode(C2.x, C2.y, 'C2'); addNode(C3.x, C3.y, 'C3'); addNode(C4.x, C4.y, 'C4'); addNode(C5.x, C5.y, 'C5'); addNode(C6.x, C6.y, 'C6');
    const e2 = rad(C2, 42); addLine(C2.x, C2.y, e2.x, e2.y); addText(e2.x + 16, e2.y, 'OH / C1(COO⁻) →', 10, 'start', '#ef4444');
    const e3 = rad(C3, 42); addText(e3.x + 18, e3.y + 10, 'H3eq / H3ax (CH₂)', 10, 'start');
    const e4 = rad(C4, 42); addLine(C4.x, C4.y, e4.x, e4.y); addText(e4.x, e4.y + 16, 'OH (H4)', 10);
    const e5 = rad(C5, 42); addLine(C5.x, C5.y, e5.x, e5.y); addText(e5.x - 14, e5.y + 16, 'NHAc (H5, NH, CH₃)', 10, 'end');
    const e6 = rad(C6, 42); addLine(C6.x, C6.y, e6.x, e6.y); addText(e6.x - 20, e6.y, 'C7–C9 chain (H6,H7,H8,H9a,H9b)', 10, 'end');
    addText(0, R + 70, `${residue.name} (${residue.id})`, 14);
  } else {
    const O5 = pt(-90), C1 = pt(-30), C2 = pt(30), C3 = pt(90), C4 = pt(150), C5 = pt(210);
    addPolygon([O5, C1, C2, C3, C4, C5]);
    addNode(O5.x, O5.y, 'O5'); addNode(C1.x, C1.y, 'C1'); addNode(C2.x, C2.y, 'C2'); addNode(C3.x, C3.y, 'C3'); addNode(C4.x, C4.y, 'C4'); addNode(C5.x, C5.y, 'C5');
    const e1 = rad(C1, 42); addLine(C1.x, C1.y, e1.x, e1.y); addText(e1.x + 18, e1.y, 'OH (H1 anomeric)', 10, 'start');
    const e2 = rad(C2, 42); addLine(C2.x, C2.y, e2.x, e2.y);
    if (st.c2 === 'NHAc') addText(e2.x + 18, e2.y + 8, 'NHCOCH₃ (H2, NHAc, AcCH₃)', 10, 'start');
    else addText(e2.x + 16, e2.y + 8, 'OH (H2)', 10, 'start');
    const e3 = rad(C3, 42); addLine(C3.x, C3.y, e3.x, e3.y); addText(e3.x, e3.y + 16, 'OH (H3)', 10);
    const e4 = rad(C4, 42); addLine(C4.x, C4.y, e4.x, e4.y); addText(e4.x - 12, e4.y + 14, 'OH (H4)', 10, 'end');
    const c6p = rad(C5, 52); addLine(C5.x, C5.y, c6p.x, c6p.y);
    if (st.noC6) addText(c6p.x - 16, c6p.y, 'H4a / H4b (CH₂)', 10, 'end');
    else if (st.c6 === 'CH3') { addNode(c6p.x * 1.12, c6p.y * 1.12, 'C6'); addText(c6p.x * 1.12 - 24, c6p.y * 1.12, 'CH₃ (H6)', 10, 'end'); }
    else { addNode(c6p.x * 1.12, c6p.y * 1.12, 'C6'); addText(c6p.x * 1.12 - 26, c6p.y * 1.12, 'CH₂OH (H6a,H6b)', 10, 'end'); }
    addText(0, R + 64, `${residue.name} (${residue.id}) — pyranose`, 14);
  }
  const pad = 30;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2*pad} ${maxY - minY + 2*pad}`;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <StructureSVG elements={elements} viewBox={viewBox} minWidthPx="560px" isExpanded={isExpanded} />
      </div>
    </>
  );
};

// --- 5D. PHOSPHOLIPID 2D STRUCTURE ---
const LipidStructure2D = ({ residue, isExpanded, onToggleExpand }) => {
  if (!residue) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const color = residue.color;
  const addLine = (x1, y1, x2, y2, isDouble = false, col = color) => {
    updateBounds(x1, y1); updateBounds(x2, y2);
    if (isDouble) { const dx = x2-x1, dy = y2-y1; const len = Math.sqrt(dx*dx+dy*dy)||1; const nx = -dy/len*3, ny = dx/len*3; elements.push({ type:'line', x1:x1+nx, y1:y1+ny, x2:x2+nx, y2:y2+ny, color: col, ri:0, opacity:1 }); elements.push({ type:'line', x1:x1-nx, y1:y1-ny, x2:x2-nx, y2:y2-ny, color: col, ri:0, opacity:1 }); }
    else elements.push({ type: 'line', x1, y1, x2, y2, color: col, ri: 0, opacity: 1 });
  };
  const addText = (x, y, text, fontSize = 11, align = 'middle', col = color) => { updateBounds(x, y - 16); updateBounds(x, y + 16); updateBounds(x - 40, y); updateBounds(x + 40, y); elements.push({ type: 'text', x, y, text, color: col, fontSize, align, ri: 0, opacity: 1 }); };
  const addNode = (x, y, label, r = 15, fs = 10, col = color) => { updateBounds(x - r, y - r); updateBounds(x + r, y + r); elements.push({ type: 'circle', x, y, r, color: col, fill: 'white', ri: 0, opacity: 1 }); addText(x, y, label, fs, 'middle', col); };
  const head = residue.head;
  // --- Head group (left of P) ---
  const P = { x: 300, y: 130 };
  addNode(P.x, P.y, 'P', 16, 13, '#f97316');
  addLine(P.x, P.y, P.x - 8, P.y - 32, true, color); addText(P.x - 10, P.y - 44, 'O', 12, 'middle', 'red');
  addLine(P.x, P.y, P.x - 10, P.y + 32, false, color); addText(P.x - 12, P.y + 46, 'O⁻', 12, 'middle', 'red');
  const Oh = { x: P.x - 34, y: P.y + 8 };
  addLine(P.x, P.y, Oh.x, Oh.y); addText(Oh.x - 10, Oh.y + 14, 'O', 11, 'middle', 'red');
  const hg1 = { x: Oh.x - 42, y: Oh.y - 10 };
  addLine(Oh.x, Oh.y, hg1.x, hg1.y); addNode(hg1.x, hg1.y, 'CH₂'); addText(hg1.x, hg1.y - 24, '(HCH2OP)', 9);
  if (head === 'PC' || head === 'PE') {
    const hg2 = { x: hg1.x - 48, y: hg1.y + 14 };
    addLine(hg1.x, hg1.y, hg2.x, hg2.y); addNode(hg2.x, hg2.y, 'CH₂'); addText(hg2.x, hg2.y - 24, '(HCH2N)', 9);
    const hg3 = { x: hg2.x - 50, y: hg2.y - 10 };
    addLine(hg2.x, hg2.y, hg3.x, hg3.y);
    if (head === 'PC') { addNode(hg3.x, hg3.y, 'N⁺', 15, 11); addText(hg3.x - 30, hg3.y - 24, 'CH₃', 10); addText(hg3.x - 34, hg3.y + 4, 'CH₃', 10); addText(hg3.x - 30, hg3.y + 30, 'CH₃', 10); addText(hg3.x, hg3.y + 52, '(HNMe3, 9H)', 9); }
    else { addNode(hg3.x, hg3.y, 'NH₃⁺', 18, 10); addText(hg3.x, hg3.y + 34, '(HNH3)', 9); }
  } else if (head === 'PS') {
    const hga = { x: hg1.x - 50, y: hg1.y + 12 };
    addLine(hg1.x, hg1.y, hga.x, hga.y); addNode(hga.x, hga.y, 'CH'); addText(hga.x, hga.y - 24, '(HαS)', 9);
    addLine(hga.x, hga.y, hga.x - 34, hga.y + 24); addNode(hga.x - 44, hga.y + 32, 'NH₃⁺', 17, 9); addText(hga.x - 44, hga.y + 56, '(HNH3)', 8);
    addLine(hga.x, hga.y, hga.x + 10, hga.y + 34); addText(hga.x + 18, hga.y + 46, 'COO⁻ (HβS1/HβS2 on CH₂)', 9, 'start', '#ef4444');
    addNode(hga.x + 44, hga.y + 10, 'CH₂', 14, 9); addLine(hga.x, hga.y, hga.x + 30, hga.y + 8);
  } else if (head === 'PG') {
    const hga = { x: hg1.x - 46, y: hg1.y + 12 };
    addLine(hg1.x, hg1.y, hga.x, hga.y); addNode(hga.x, hga.y, 'CHOH'); addText(hga.x, hga.y - 24, '(HCHOH)', 9);
    const hgb = { x: hga.x - 48, y: hga.y - 8 };
    addLine(hga.x, hga.y, hgb.x, hgb.y); addNode(hgb.x, hgb.y, 'CH₂OH', 20, 8); addText(hgb.x, hgb.y + 26, '(HCH2OHa/HCH2OHb)', 8);
  }
  // --- Glycerol (right of P) ---
  const O3s = { x: P.x + 34, y: P.y - 8 };
  addLine(P.x, P.y, O3s.x, O3s.y); addText(O3s.x + 4, O3s.y + 16, 'O', 11, 'middle', 'red');
  const sn3 = { x: O3s.x + 44, y: O3s.y - 12 };
  addLine(O3s.x, O3s.y, sn3.x, sn3.y); addNode(sn3.x, sn3.y, 'CH₂'); addText(sn3.x, sn3.y + 24, 'sn-3 (Hsn3a/Hsn3b)', 9);
  const sn2 = { x: sn3.x + 44, y: sn3.y - 26 };
  addLine(sn3.x, sn3.y, sn2.x, sn2.y); addNode(sn2.x, sn2.y, 'CH'); addText(sn2.x + 6, sn2.y + 24, 'sn-2 (Hsn2g)', 9);
  const sn1 = { x: sn2.x + 44, y: sn2.y + 26 };
  addLine(sn2.x, sn2.y, sn1.x, sn1.y); addNode(sn1.x, sn1.y, 'CH₂'); addText(sn1.x, sn1.y + 24, 'sn-1 (Hsn1a/Hsn1b)', 9);
  // --- sn-1 chain (palmitoyl 16:0) upward ---
  const o1 = { x: sn1.x + 34, y: sn1.y - 12 };
  addLine(sn1.x, sn1.y, o1.x, o1.y); addText(o1.x + 8, o1.y + 14, 'O', 11, 'middle', 'red');
  const c1 = { x: o1.x + 30, y: o1.y - 22 };
  addLine(o1.x, o1.y, c1.x, c1.y); addLine(c1.x, c1.y, c1.x + 6, c1.y - 28, true); addText(c1.x + 14, c1.y - 34, 'O', 11, 'middle', 'red');
  addText(c1.x - 6, c1.y + 20, 'C=O (sn-1)', 9);
  const zig = (x0, y0, n, dirY, x0Label) => { let x = x0, y = y0; for (let k = 0; k < n; k++) { const nx2 = x + 24, ny2 = y + (k % 2 === 0 ? -dirY : dirY) * 14; addLine(x, y, nx2, ny2); x = nx2; y = ny2; } return { x, y }; };
  const a1 = { x: c1.x + 26, y: c1.y + 10 };
  addLine(c1.x, c1.y, a1.x, a1.y); addText(a1.x, a1.y + 18, 'CH₂ (H2-sn1)', 9);
  const b1 = { x: a1.x + 26, y: a1.y - 12 };
  addLine(a1.x, a1.y, b1.x, b1.y); addText(b1.x, b1.y - 14, 'CH₂ (H3-sn1)', 9);
  const end1 = zig(b1.x, b1.y, 5, 1);
  addText((b1.x + end1.x) / 2, (b1.y + end1.y) / 2 - 22, '(CH₂)ₙ (H4-sn1)', 9);
  addLine(end1.x, end1.y, end1.x + 24, end1.y - 12); addText(end1.x + 40, end1.y - 16, 'CH₃ (H16-sn1)', 9, 'start');
  // --- sn-2 chain (oleoyl 18:1 Δ9) downward ---
  const o2 = { x: sn2.x + 10, y: sn2.y + 30 };
  addLine(sn2.x, sn2.y, o2.x, o2.y); addText(o2.x - 14, o2.y + 6, 'O', 11, 'middle', 'red');
  const c2 = { x: o2.x + 22, y: o2.y + 22 };
  addLine(o2.x, o2.y, c2.x, c2.y); addLine(c2.x, c2.y, c2.x - 4, c2.y + 28, true); addText(c2.x - 8, c2.y + 42, 'O', 11, 'middle', 'red');
  addText(c2.x + 34, c2.y + 14, 'C=O (sn-2)', 9, 'start');
  const a2 = { x: c2.x + 26, y: c2.y + 8 };
  addLine(c2.x, c2.y, a2.x, a2.y); addText(a2.x, a2.y + 20, 'CH₂ (H2-sn2)', 9);
  const b2 = { x: a2.x + 26, y: a2.y + 14 };
  addLine(a2.x, a2.y, b2.x, b2.y); addText(b2.x, b2.y + 22, 'CH₂ (H3-sn2)', 9);
  let x = b2.x, y = b2.y;
  for (let k = 0; k < 3; k++) { const nx2 = x + 24, ny2 = y + (k % 2 === 0 ? 14 : -14); addLine(x, y, nx2, ny2); x = nx2; y = ny2; }
  addText(x - 10, y + 26, '(CH₂)ₙ (H4-sn2)', 9);
  const al = { x: x + 24, y: y + 12 };
  addLine(x, y, al.x, al.y); addText(al.x, al.y + 22, 'CH₂ allylic (Hall-sn2)', 9);
  const d1 = { x: al.x + 26, y: al.y - 10 };
  addLine(al.x, al.y, d1.x, d1.y, true); addText(d1.x, d1.y - 16, '=CH (H8-sn2)', 9);
  const d2 = { x: d1.x + 26, y: d1.y + 14 };
  addLine(d1.x, d1.y, d2.x, d2.y, true); addText(d2.x, d2.y + 22, '=CH (H9-sn2)', 9);
  const al2 = { x: d2.x + 26, y: d2.y - 10 };
  addLine(d2.x, d2.y, al2.x, al2.y);
  const end2 = zig(al2.x, al2.y, 3, -1);
  addLine(end2.x, end2.y, end2.x + 24, end2.y + 10); addText(end2.x + 42, end2.y + 14, 'CH₃ (H18-sn2)', 9, 'start');
  addText(P.x + 60, 330, `${residue.name}`, 13, 'middle');
  const pad = 30;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2*pad} ${maxY - minY + 2*pad}`;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <StructureSVG elements={elements} viewBox={viewBox} minWidthPx="900px" isExpanded={isExpanded} />
      </div>
    </>
  );
};

// --- 7. MAIN COMPONENT ---
export const NMRTestRenderer = ({ activeTest, updateActiveTest, TestHeader, datasetProtocols, jumpToProtocol }) => {
  const moleculeType = activeTest.moleculeType || 'protein';
  const isProtein = moleculeType === 'protein';
  const isNuc = moleculeType === 'dna' || moleculeType === 'rna';
  const isPolymer = isProtein || isNuc;
  const DB = isProtein ? AMINO_ACID_DB : moleculeType === 'dna' ? NUCLEOTIDE_DB.DNA : moleculeType === 'rna' ? NUCLEOTIDE_DB.RNA : moleculeType === 'sugar' ? SUGAR_DB : LIPID_DB;
  const DB_KEYS = Object.keys(DB);
  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();
  const seq = isProtein ? rawSeq.replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, '') : moleculeType === 'dna' ? rawSeq.replace(/[^ACGT]/g, '') : moleculeType === 'rna' ? rawSeq.replace(/[^ACGU]/g, '') : '';
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const shifts = activeTest.chemicalShifts || {};
  const images = activeTest.nmrSpectraImages || [];
  const showSim = activeTest.showSpectraSimulation || false;
  const linkedProtocolId = activeTest.linkedProtocolId || '';
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [focusIdx, setFocusIdx] = useState('ALL');
  const [reveal, setReveal] = useState(false);
  const [ssPreview, setSsPreview] = useState('current');
  const ssStr = activeTest.secondaryStructure || '';
  const getSSAt = (i) => (ssStr[i] && 'HES'.includes(ssStr[i]) ? ssStr[i] : 'C');
  const nucDefs = isProtein ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] } : isNuc ? { H: moleculeType === 'dna' ? ["H1'", "H2'", "H2''", "H3'"] : ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] } : null;
  const handleShiftChange = (resIdx, atom, val) => updateActiveTest({ chemicalShifts: { ...shifts, [`${resIdx}-${atom}`]: val } });
  useEffect(() => { if (focusIdx !== 'ALL' && focusIdx >= (isPolymer ? seq.length : 1)) setFocusIdx('ALL'); }, [seq.length, moleculeType]);
  useEffect(() => { setFocusIdx('ALL'); }, [moleculeType]);

  const parsedSeq = useMemo(() => {
    if (!isPolymer) {
      const char = moleculeType === 'sugar' ? (activeTest.sugarChoice || 'GLC') : (activeTest.lipidChoice || 'POPC');
      const db = DB[char]; if (!db) return [];
      const generatedShifts = {};
      Object.keys(db.ranges).forEach(atom => { const r = db.ranges[atom]; generatedShifts[atom] = parseFloat((r.min + Math.random() * (r.max - r.min)).toFixed(2)); });
      const cShifts = {}; const generatedShifts13C = {};
      Object.keys(generatedShifts).forEach(atom => {
        const cName = db.carbonMap ? (db.carbonMap[atom] ?? null) : null; if (!cName) return;
        if (!cShifts[cName]) { const range = getCarbonRangeFor(moleculeType, char, cName); cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1)); }
        generatedShifts13C[atom] = cShifts[cName];
      });
      return [{ ...db, id: db.code3, char, color: RESIDUE_COLORS[DB_KEYS.indexOf(char) % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts } }];
    }
    if (seq.length === 0) return [];
    const assignedShifts = [];
    return seq.split('').map((char, index) => {
      const aa = DB[char]; const generatedShifts = {};
      if (aa) {
        Object.keys(aa.ranges).forEach(atom => {
          const r = aa.ranges[atom]; let val = r.min; let success = false; let minDistance = 0.3;
          while (minDistance >= 0.05 && !success) {
            for (let i = 0; i < 50; i++) { const candidate = r.min + Math.random() * (r.max - r.min); if (!assignedShifts.some(a => Math.abs(a - candidate) < minDistance)) { val = candidate; success = true; break; } }
            if (!success) minDistance -= 0.05;
          }
          assignedShifts.push(val); generatedShifts[atom] = parseFloat(val.toFixed(2));
        });
      }
      const cShifts = {}; const generatedShifts13C = {};
      if (aa) {
        Object.keys(generatedShifts).forEach(atom => {
          const cName = isProtein ? getCarbonName(char, atom) : getCarbonNameNuc(atom); if (!cName) return;
          if (!cShifts[cName]) { const range = getCarbonRangeFor(moleculeType, char, cName); cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1)); }
          generatedShifts13C[atom] = cShifts[cName];
        });
      }
      const backboneRand = isProtein ? { N: 117 + Math.random() * 8, CP: 172 + Math.random() * 5 } : null;
      return { ...aa, id: `${aa?.code3 || char}${index + 1}`, char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts }, backboneRand };
    });
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice]);

  const ssPreviewLetter = ssPreview === 'current' ? null : { coil: 'C', helix: 'H', sheet: 'E' }[ssPreview];
  // Manual values take priority; secondary structure corrections applied to simulated (random-coil) values
  const effectiveSeq = useMemo(() => parsedSeq.map((res, idx) => {
    if (!res.shifts) return res;
    const letter = isProtein ? (ssPreviewLetter || getSSAt(idx)) : 'C';
    const ssKey = { C: 'coil', H: 'helix', E: 'sheet' }[letter];
    const corr = SS_CORRECTIONS[ssKey] || SS_CORRECTIONS.coil;
    const effShifts = {};
    Object.keys(res.shifts).forEach(atom => {
      const manual = parseManual(shifts[`${idx}-${atom}`]);
      let v = res.shifts[atom];
      if (isProtein && ssKey !== 'coil') { const d = corr.h[atom] !== undefined ? corr.h[atom] : (corr.h.other || 0); v = v + d; }
      effShifts[atom] = manual !== null ? manual : parseFloat(v.toFixed(2));
    });
    const effUniqueC = {};
    Object.entries(res.uniqueCShifts || {}).forEach(([cName, base]) => {
      const manual = parseManual(shifts[`${idx}-${cName}`]);
      let v = base; if (isProtein && ssKey !== 'coil') v += (corr.c[cName] || 0);
      effUniqueC[cName] = manual !== null ? manual : parseFloat(v.toFixed(2));
    });
    const effShifts13C = {};
    Object.keys(res.shifts13C || {}).forEach(atom => { const cn = carbonNameFor(moleculeType, res, atom); if (cn && effUniqueC[cn] !== undefined) effShifts13C[atom] = effUniqueC[cn]; });
    let nEff = null, cPrimeEff = null;
    if (isProtein && res.backboneRand) {
      const mn = parseManual(shifts[`${idx}-N`]); const mc = parseManual(shifts[`${idx}-C'`]);
      let nv = res.backboneRand.N + (ssKey !== 'coil' ? (corr.c['N'] || 0) : 0);
      let cv = res.backboneRand.CP + (ssKey !== 'coil' ? (corr.c["C'"] || 0) : 0);
      nEff = mn !== null ? mn : parseFloat(nv.toFixed(2)); cPrimeEff = mc !== null ? mc : parseFloat(cv.toFixed(2));
    }
    return { ...res, effShifts, effShifts13C, effUniqueC, nEff, cPrimeEff, ssLetter: letter };
  }), [parsedSeq, shifts, ssStr, ssPreview, moleculeType]);

  const uniqueTypes = useMemo(() => [...new Set(parsedSeq.map(r => r.char))], [parsedSeq]);
  const visibleTypes = useMemo(() => focusIdx === 'ALL' ? uniqueTypes : uniqueTypes.filter(t => t === effectiveSeq[focusIdx]?.char), [uniqueTypes, focusIdx, effectiveSeq]);

  const peaks = useMemo(() => {
    let diag = [], cosy = [], tocsy = [], noesy = [], hsqc = [], d1H = [], d13C = [];
    const addPair = (arr, x, y, label, type, cc, size, ri, ri2) => { arr.push({ x, y, label, type, colorClass: cc, size, ri, ri2 }); arr.push({ x: y, y: x, label, type, colorClass: cc, size, ri, ri2 }); };
    effectiveSeq.forEach((res, index) => {
      if (!res.effShifts) return;
      Object.entries(res.effShifts).forEach(([atom, ppm]) => {
        let pk = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        if (res.cosy) {
          res.cosy.forEach(pair => {
            let neighborAtom = pair[0] === atom ? pair[1] : (pair[1] === atom ? pair[0] : null);
            if (neighborAtom && res.effShifts[neighborAtom] !== undefined) {
              const count = getProtonCountEx(moleculeType, res, neighborAtom); totalNeighbors += count;
              const jC = 0.010 + Math.random() * 0.008; const pascalRow = getPascalRow(count);
              let newPeaks = []; pk.forEach(p => { for (let k = 0; k <= count; k++) newPeaks.push({ shift: p.shift + (k - count/2) * jC, intensity: p.intensity * pascalRow[k] }); });
              pk = newPeaks;
            }
          });
        }
        let merged = []; pk.sort((a, b) => a.shift - b.shift);
        pk.forEach(p => {
          if (merged.length > 0) { let last = merged[merged.length - 1]; if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; } else merged.push({ ...p }); }
          else merged.push({ ...p });
        });
        const pCount = getProtonCountEx(moleculeType, res, atom); const maxIntensity = Math.max(...merged.map(p => p.intensity)); const baseIntensity = (1.5 + Math.random() * 0.5) * pCount;
        let multStr = "m"; if (totalNeighbors === 0) multStr = "s"; else if (totalNeighbors === 1) multStr = "d"; else if (totalNeighbors === 2) multStr = merged.length === 3 ? "t" : "dd"; else if (totalNeighbors === 3) multStr = merged.length === 4 ? "q" : "m";
        merged.forEach(p => d1H.push({ x: p.shift, y: (p.intensity / maxIntensity) * baseIntensity, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr, ri: index }));
      });
      Object.entries(res.effUniqueC || {}).forEach(([cName, ppm]) => d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cName}`, color: res.color, type: '1D', ri: index }));
      Object.keys(res.effShifts).forEach(atom => diag.push({ x: res.effShifts[atom], y: res.effShifts[atom], label: `${res.id} ${atom}`, type: 'Diagonal', size: 4, ri: index }));
      if (res.cosy) res.cosy.forEach(([a1, a2]) => { if (res.effShifts[a1] !== undefined && res.effShifts[a2] !== undefined) addPair(cosy, res.effShifts[a1], res.effShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4, index); });
      if (res.spinSystems) res.spinSystems.forEach(sys => { for (let i = 0; i < sys.length; i++) for (let j = i + 1; j < sys.length; j++) if (res.effShifts[sys[i]] !== undefined && res.effShifts[sys[j]] !== undefined) { const isDirect = res.cosy && res.cosy.some(c => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i])); addPair(tocsy, res.effShifts[sys[i]], res.effShifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`, isDirect ? 'tocsyDirect' : 'tocsyRelay', 4, index); } });
      // NOESY intra
      const adj = {};
      if (res.cosy) res.cosy.forEach(([u, v]) => { if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
      const seenPairs = new Set();
      if (res.cosy) res.cosy.forEach(([a1, a2]) => { seenPairs.add([a1, a2].sort().join('-')); if (res.effShifts[a1] !== undefined && res.effShifts[a2] !== undefined) addPair(noesy, res.effShifts[a1], res.effShifts[a2], res.id, `${a1}-${a2} (NOE Intra 3-bond)`, 'noesyIntra', 4, index); });
      Object.keys(adj).forEach(u => { adj[u].forEach(v => { adj[v].forEach(w => { if (u !== w) { const pairKey = [u, w].sort().join('-'); if (!seenPairs.has(pairKey)) { seenPairs.add(pairKey); if (res.effShifts[u] !== undefined && res.effShifts[w] !== undefined) addPair(noesy, res.effShifts[u], res.effShifts[w], res.id, `${u}-${w} (NOE Intra 4-bond)`, 'noesyIntra4', 3, index); } } }); }); });
      if (isProtein) {
        if (res.char === 'H' && res.effShifts['Hβ1'] && res.effShifts['Hδ2']) { addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ2'], res.id, 'Hβ-Hδ2 (Arom.)', 'noesyIntra', 4, index); if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ2'], res.id, 'Hβ-Hδ2 (Arom.)', 'noesyIntra', 4, index); }
        if ((res.char === 'F' || res.char === 'Y') && res.effShifts['Hβ1'] && res.effShifts['Hδ']) { addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ'], res.id, 'Hβ-Hδ (Arom.)', 'noesyIntra', 4, index); if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ'], res.id, 'Hβ-Hδ (Arom.)', 'noesyIntra', 4, index); }
        if (res.char === 'W' && res.effShifts['Hβ1'] && res.effShifts['Hδ1']) { addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ1'], res.id, 'Hβ-Hδ1 (Arom.)', 'noesyIntra', 4, index); if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ1'], res.id, 'Hβ-Hδ1 (Arom.)', 'noesyIntra', 4, index); }
      }
      if (isNuc) {
        const baseAtom = (res.atoms || []).find(a => a === 'H8' || a === 'H6');
        if (baseAtom && res.effShifts[baseAtom] !== undefined) ["H1'", "H2'", "H2''"].forEach(sa => { if (res.effShifts[sa] !== undefined) addPair(noesy, res.effShifts[baseAtom], res.effShifts[sa], res.id, `${baseAtom}-${sa} (NOE Intra base-sugar)`, 'noesyIntra', 4, index); });
      }
      if (index < effectiveSeq.length - 1) {
        const nextRes = effectiveSeq[index + 1];
        if (isProtein) {
          if (res.effShifts['HN'] !== undefined && nextRes.effShifts['HN'] !== undefined) addPair(noesy, res.effShifts['HN'], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} HN ↔ ${nextRes.id} HN (dNN)`, 'noesySeq', 3, index, index + 1);
          (res.atoms || []).filter(a => a.includes('Hα')).forEach(alphaAtom => { if (res.effShifts[alphaAtom] !== undefined && nextRes.effShifts['HN'] !== undefined) addPair(noesy, res.effShifts[alphaAtom], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} ${alphaAtom} ↔ ${nextRes.id} HN (dαN)`, 'noesySeq', 3, index, index + 1); });
          (res.atoms || []).filter(a => a.includes('Hβ')).forEach(betaAtom => { if (res.effShifts[betaAtom] !== undefined && nextRes.effShifts['HN'] !== undefined) addPair(noesy, res.effShifts[betaAtom], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} ${betaAtom} ↔ ${nextRes.id} HN (dβN)`, 'noesySeq', 3, index, index + 1); });
        } else if (isNuc) {
          const baseAtom = (res.atoms || []).find(a => a === 'H8' || a === 'H6');
          if (baseAtom && res.effShifts[baseAtom] !== undefined) {
            if (nextRes.effShifts["H1'"] !== undefined) addPair(noesy, res.effShifts[baseAtom], nextRes.effShifts["H1'"], 'Seq. NOE', `${res.id} ${baseAtom} ↔ ${nextRes.id} H1'`, 'noesySeq', 3, index, index + 1);
            if (nextRes.effShifts["H2'"] !== undefined) addPair(noesy, res.effShifts[baseAtom], nextRes.effShifts["H2'"], 'Seq. NOE', `${res.id} ${baseAtom} ↔ ${nextRes.id} H2'`, 'noesySeq', 3, index, index + 1);
          }
          if (res.effShifts["H3'"] !== undefined && nextRes.effShifts["H1'"] !== undefined) addPair(noesy, res.effShifts["H3'"], nextRes.effShifts["H1'"], 'Seq. NOE', `${res.id} H3' ↔ ${nextRes.id} H1'`, 'noesySeq', 3, index, index + 1);
        }
      }
      Object.keys(res.effShifts13C || {}).forEach(atom => { if (res.effShifts[atom] !== undefined) hsqc.push({ x: res.effShifts[atom], y: res.effShifts13C[atom], label: `${res.id} ${atom}-${carbonNameFor(moleculeType, res, atom)}`, type: 'HSQC', colorClass: 'hsqc', size: 4, ri: index }); });
    });
    return { diagonalData: diag, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, data1H: d1H, data13C: d13C };
  }, [effectiveSeq, moleculeType]);

  const vis = (arr) => focusIdx === 'ALL' ? arr : arr.filter(p => p.ri === focusIdx || p.ri2 === focusIdx);
  const vCosy = useMemo(() => vis(peaks.cosyPeaks), [peaks.cosyPeaks, focusIdx]);
  const vTocsy = useMemo(() => vis(peaks.tocsyPeaks), [peaks.tocsyPeaks, focusIdx]);
  const vNoesy = useMemo(() => vis(peaks.noesyPeaks), [peaks.noesyPeaks, focusIdx]);
  const vHsqc = useMemo(() => vis(peaks.hsqcPeaks), [peaks.hsqcPeaks, focusIdx]);
  const v1H = useMemo(() => vis(peaks.data1H), [peaks.data1H, focusIdx]);
  const v13C = useMemo(() => vis(peaks.data13C), [peaks.data13C, focusIdx]);
  const vDiag = useMemo(() => vis(peaks.diagonalData), [peaks.diagonalData, focusIdx]);

  const { ranges1H, ranges13C } = useMemo(() => {
    let r1 = [], r13 = [];
    visibleTypes.forEach((char, index) => {
      const db = DB[char]; if (!db) return;
      const color = RESIDUE_COLORS[DB_KEYS.indexOf(char) % RESIDUE_COLORS.length];
      const label = db.code3 || char;
      let atomIdx = 0;
      Object.keys(db.ranges).forEach(atom => { const r = db.ranges[atom]; r1.push({ x: (r.min + r.max) / 2, res: label, atom, min: r.min, max: r.max, y: visibleTypes.length - 1 - index, color, level: atomIdx++ }); });
      const cNames = new Set();
      Object.keys(db.ranges).forEach(atom => { const cn = isProtein ? getCarbonName(char, atom) : isNuc ? getCarbonNameNuc(atom) : (db.carbonMap ? db.carbonMap[atom] : null); if (cn) cNames.add(cn); });
      if (isProtein) { (PROTEIN_EXTRA_CARBONS[char] || []).forEach(cn => cNames.add(cn)); cNames.add("C'"); }
      if (isNuc) Object.keys(NUC_EXTRA_CARBONS[moleculeType === 'dna' ? 'DNA' : 'RNA'][char] || {}).forEach(cn => cNames.add(cn));
      if (db.extraCarbons) Object.keys(db.extraCarbons).forEach(cn => cNames.add(cn));
      let cIdx = 0;
      cNames.forEach(cn => { const rng = getCarbonRangeFor(moleculeType, char, cn); r13.push({ x: (rng.min + rng.max) / 2, res: label, atom: cn, min: rng.min, max: rng.max, y: visibleTypes.length - 1 - index, color, level: cIdx++ }); });
    });
    return { ranges1H: r1, ranges13C: r13 };
  }, [visibleTypes, moleculeType]);

  const cycleSS = (i) => { const cur = getSSAt(i); const next = cur === 'C' ? 'H' : cur === 'H' ? 'E' : 'C'; const arr = seq.split('').map((_, j) => getSSAt(j)); arr[i] = next; updateActiveTest({ secondaryStructure: arr.join('') }); };
  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: seq.split('').map(() => letter).join('') });
  const fillEstimated = () => {
    const newShifts = { ...shifts };
    effectiveSeq.forEach((res, idx) => {
      Object.entries(res.effShifts || {}).forEach(([atom, v]) => { newShifts[`${idx}-${atom}`] = String(v); });
      Object.entries(res.effUniqueC || {}).forEach(([cName, v]) => { newShifts[`${idx}-${cName}`] = String(v); });
      if (res.nEff !== null) newShifts[`${idx}-N`] = String(res.nEff);
      if (res.cPrimeEff !== null) newShifts[`${idx}-C'`] = String(res.cPrimeEff);
    });
    updateActiveTest({ chemicalShifts: newShifts });
  };
  const typeLabel = { protein: 'Protein', dna: 'DNA', rna: 'RNA', sugar: 'Sugar', lipid: 'Phospholipid' }[moleculeType];
  const EstBadge = ({ value, colorClass = 'text-blue-600' }) => value === null || value === undefined ? null : <div className={`text-[13px] font-bold ${colorClass} leading-tight`}>≈ {Number(value).toFixed(2)}</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 relative">
      {TestHeader}
      {/* --- VIEW CONTROLS TOOLBAR (Focus residue / Reveal / SS preview) --- */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-3 flex flex-wrap items-center gap-3 no-print">
        <label className="text-xs font-bold text-slate-500 uppercase">Focus residue:</label>
        <select value={String(focusIdx)} onChange={e => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer">
          <option value="ALL">All residues / nuclei</option>
          {parsedSeq.map((r, i) => <option key={i} value={String(i)}>{r.id} — {r.name}</option>)}
        </select>
        {isProtein && parsedSeq.length > 0 && (
          <>
            <label className="text-xs font-bold text-slate-500 uppercase ml-2">SS preview:</label>
            <select value={ssPreview} onChange={e => setSsPreview(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-violet-500 font-semibold text-slate-700 cursor-pointer">
              <option value="current">As painted (per residue)</option>
              <option value="coil">Force all Random Coil</option>
              <option value="helix">Force all α-Helix</option>
              <option value="sheet">Force all β-Sheet</option>
            </select>
          </>
        )}
        <button onClick={() => setReveal(!reveal)} className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${reveal ? 'bg-blue-600 text-white border-blue-700' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>👁 {reveal ? 'Hide' : 'Reveal'} estimated values</button>
        <button onClick={fillEstimated} disabled={parsedSeq.length === 0} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-40">🪄 Fill with estimated</button>
        <button onClick={() => updateActiveTest({ chemicalShifts: {} })} className="px-3 py-1.5 rounded-lg text-sm font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors">🧹 Clear manual shifts</button>
        <p className="text-[11px] text-slate-400 font-semibold ml-auto">Manual values (if present) always take priority in the simulation.</p>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* 1. EXPERIMENTAL CONDITIONS */}
        <CollapsibleSection title="Experimental Conditions" icon="🧪" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="flex flex-col gap-1 col-span-1 md:col-span-2 lg:col-span-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="text-xs font-bold text-blue-800 uppercase flex items-center justify-between"><span>Compound / Molecule Label</span><span className="text-[9px] bg-blue-200 text-blue-800 px-2 py-0.5 rounded">Used for Lab Notebook filtering</span></label>
              <input type="text" value={activeTest.compound || ''} onChange={e => updateActiveTest({ compound: e.target.value, compounds: [e.target.value] })} className="w-full border border-blue-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 font-bold text-blue-900" placeholder="e.g. Compound A" />
            </div>
            <div className="flex flex-col gap-1 col-span-1 md:col-span-2 lg:col-span-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <label className="text-xs font-bold text-indigo-800 uppercase flex items-center justify-between mb-2"><span>📋 Linked Protocol</span></label>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <select value={linkedProtocolId} onChange={(e) => updateActiveTest({ linkedProtocolId: e.target.value })} className="border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 flex-1 w-full cursor-pointer font-semibold text-indigo-900">
                  <option value="">-- No Protocol Linked --</option>
                  {(datasetProtocols || []).map(p => (<option key={p.id} value={p.id}>{p.title} ({p.category})</option>))}
                </select>
                {linkedProtocolId && (<button onClick={() => jumpToProtocol && jumpToProtocol(linkedProtocolId)} className="text-sm text-white font-bold bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 w-full sm:w-auto">📖 Open Protocol</button>)}
              </div>
            </div>
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
        {/* 2. SEQUENCE / MOLECULE & CONFIGURATION */}
        <CollapsibleSection title="Molecule & Configuration" icon="🧬" defaultOpen={true}>
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Molecule Type</label>
              <div className="flex flex-wrap gap-2 mb-4">
                {[['protein', '🧬 Protein'], ['dna', '🧬 DNA'], ['rna', '🧬 RNA'], ['sugar', '🍬 Sugar'], ['lipid', '🫧 Phospholipid']].map(([key, label]) => (
                  <button key={key} onClick={() => updateActiveTest({ moleculeType: key })} className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${moleculeType === key ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{label}</button>
                ))}
              </div>
              {isPolymer ? (
                <>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{typeLabel} Sequence (1-letter code)</label>
                  <textarea value={activeTest.proteinSequence || ''} onChange={e => updateActiveTest({ proteinSequence: e.target.value })} className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner" placeholder={isProtein ? 'e.g. MKWVTFISLL...' : moleculeType === 'dna' ? 'e.g. ACGTACGT...' : 'e.g. ACGUACGU...'} />
                  <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {seq.length} {isProtein ? 'residues' : 'nucleotides'} {isNuc && `(valid: ${moleculeType === 'dna' ? 'A, C, G, T' : 'A, C, G, U'})`}</p>
                </>
              ) : moleculeType === 'sugar' ? (
                <>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Sugar</label>
                  <select value={activeTest.sugarChoice || 'GLC'} onChange={e => updateActiveTest({ sugarChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer">
                    {Object.keys(SUGAR_DB).map(k => <option key={k} value={k}>{SUGAR_DB[k].name} ({SUGAR_DB[k].code3})</option>)}
                  </select>
                </>
              ) : (
                <>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Phospholipid</label>
                  <select value={activeTest.lipidChoice || 'POPC'} onChange={e => updateActiveTest({ lipidChoice: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer">
                    {Object.keys(LIPID_DB).map(k => <option key={k} value={k}>{LIPID_DB[k].name}</option>)}
                  </select>
                </>
              )}
            </div>
            <div className="w-full md:w-64 flex flex-col gap-4">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
                <div className="flex flex-col gap-2">
                  {['H', 'N', 'C'].filter(n => isProtein || n !== 'N').map(n => (
                    <label key={n} className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors">
                      <input type="checkbox" checked={selNuc.includes(n)} onChange={() => updateActiveTest({ selectedNuclei: selNuc.includes(n) ? selNuc.filter(x => x !== n) : [...selNuc, n] })} className="w-4 h-4 cursor-pointer accent-blue-600" />
                      <span className="font-bold text-slate-700">Nucleus {n === 'H' ? '¹H' : n === 'N' ? '¹⁵N' : '¹³C'}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer bg-purple-50 border border-purple-200 p-3 rounded-lg shadow-sm hover:bg-purple-100 transition-colors">
                <input type="checkbox" checked={showSim} onChange={(e) => updateActiveTest({ showSpectraSimulation: e.target.checked })} className="w-5 h-5 cursor-pointer accent-purple-600" />
                <span className="font-bold text-purple-700 text-sm">Simulate Spectra (NMR)</span>
              </label>
            </div>
          </div>
        </CollapsibleSection>
        {/* 2B. SECONDARY STRUCTURE (protein only) */}
        {isProtein && parsedSeq.length > 0 && (
          <CollapsibleSection title="Secondary Structure — Random Coil / α-Helix / β-Sheet" icon="🧠" defaultOpen={true}>
            <p className="text-xs text-slate-500 mb-3 font-semibold">Click a residue to cycle: <b>C (coil)</b> → <b>H (α-helix)</b> → <b>E (β-sheet)</b>. Estimated shifts and simulated spectra are corrected accordingly (use "SS preview" in the toolbar to compare all-coil / all-helix / all-sheet).</p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {parsedSeq.map((r, i) => {
                const letter = getSSAt(i); const meta = SS_META[letter];
                return (
                  <button key={i} onClick={() => cycleSS(i)} title={`${r.id}: ${meta.label} (click to change)`} className="flex flex-col items-center justify-center w-11 h-12 rounded-lg border-2 transition-all hover:scale-105" style={{ borderColor: meta.color, backgroundColor: meta.color + '22' }}>
                    <span className="text-[8px] font-bold text-slate-400 leading-none">{i + 1}</span>
                    <span className="text-sm font-black leading-tight" style={{ color: meta.color }}>{letter}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setAllSS('C')} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-300">All Random Coil</button>
              <button onClick={() => setAllSS('H')} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-100 text-violet-700 hover:bg-violet-200 border border-violet-300">All α-Helix</button>
              <button onClick={() => setAllSS('E')} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300">All β-Sheet</button>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs text-left border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-50 text-slate-500 uppercase">
                  <tr><th className="px-3 py-2 font-bold">Δδ (ppm vs coil)</th><th className="px-3 py-2 font-bold text-violet-700">α-Helix</th><th className="px-3 py-2 font-bold text-amber-700">β-Sheet</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {['HN', 'Hα', 'Cα', 'Cβ', "C'", 'N'].map(a => (
                    <tr key={a}><td className="px-3 py-1 font-bold text-slate-700">{a}</td><td className="px-3 py-1">{(SS_CORRECTIONS.helix.h[a] ?? SS_CORRECTIONS.helix.c[a] ?? SS_CORRECTIONS.helix.h.other ?? 0).toFixed(2)}</td><td className="px-3 py-1">{(SS_CORRECTIONS.sheet.h[a] ?? SS_CORRECTIONS.sheet.c[a] ?? SS_CORRECTIONS.sheet.h.other ?? 0).toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        )}
        {/* 3. 2D CHEMICAL STRUCTURE */}
        {parsedSeq.length > 0 && (
          <CollapsibleSection title={`2D Chemical Structure (${typeLabel})`} icon="🔬" defaultOpen={true}>
            {isProtein && <ChemicalStructure2D sequence={parsedSeq} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} focusIdx={focusIdx} />}
            {isNuc && <NucleicStructure2D sequence={parsedSeq} molType={moleculeType} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} focusIdx={focusIdx} />}
            {moleculeType === 'sugar' && <SugarStructure2D residue={parsedSeq[0]} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} />}
            {moleculeType === 'lipid' && <LipidStructure2D residue={parsedSeq[0]} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} />}
          </CollapsibleSection>
        )}
        {/* 4. THEORETICAL RANGES */}
        {visibleTypes.length > 0 && (
          <CollapsibleSection title="Theoretical Chemical Shift Ranges" icon="📊" defaultOpen={true}>
            <div className="grid grid-cols-1 gap-4">
              <RangeBarChart title="Theoretical ¹H Ranges" ranges={ranges1H} domain={[0, 11]} ticks={Array.from({ length: 12 }, (_, i) => i)} xAxisLabel="¹H (ppm)" rowCount={visibleTypes.length} rowLabels={visibleTypes.map(c => DB[c]?.code3 || c)} />
              <RangeBarChart title="Theoretical ¹³C Ranges (realistic)" ranges={ranges13C} domain={[0, 190]} ticks={Array.from({ length: 20 }, (_, i) => i * 10)} xAxisLabel="¹³C (ppm)" rowCount={visibleTypes.length} rowLabels={visibleTypes.map(c => DB[c]?.code3 || c)} />
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h4 className="text-md font-bold text-slate-700 mb-4 border-b pb-2">Numerical Reference Values</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr><th className="px-4 py-2 font-bold">Residue</th><th className="px-4 py-2 font-bold text-blue-700">¹H Atoms</th><th className="px-4 py-2 font-bold text-blue-700">¹H Range (ppm)</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Atoms</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Range (ppm)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleTypes.map(char => {
                        const db = DB[char]; if (!db) return null;
                        const hAtoms = Object.keys(db.ranges);
                        const cAtoms = [...new Set(hAtoms.map(k => isProtein ? getCarbonName(char, k) : isNuc ? getCarbonNameNuc(k) : (db.carbonMap ? db.carbonMap[k] : null)).filter(Boolean))];
                        const extras = db.extraCarbons ? Object.keys(db.extraCarbons) : (isProtein ? (PROTEIN_EXTRA_CARBONS[char] || []).concat(["C'"]) : []);
                        const allC = [...new Set([...cAtoms, ...extras])];
                        return (
                          <tr key={char} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-bold text-slate-700">{db.name} ({db.code3})</td>
                            <td className="px-4 py-2 text-blue-800 text-xs">{hAtoms.join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{hAtoms.map(k => `${k}: ${db.ranges[k].min}-${db.ranges[k].max}`).join('; ')}</td>
                            <td className="px-4 py-2 text-purple-800 text-xs">{allC.join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{allC.map(cName => { const cRange = getCarbonRangeFor(moleculeType, char, cName); return `${cName}: ${cRange.min}-${cRange.max}`; }).join('; ')}</td>
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
          parsedSeq.length > 0 && nucDefs ? (
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button onClick={() => { setTableMode('backbone'); updateActiveTest({ tableMode: 'backbone' }); }} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode === 'backbone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Backbone</button>
              <button onClick={() => { setTableMode('all'); updateActiveTest({ tableMode: 'all' }); }} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>All Atoms</button>
            </div>
          ) : null
        }>
          {parsedSeq.length === 0 ? (
            <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence or select a molecule to generate the table.</div>
          ) : nucDefs && tableMode === 'backbone' ? (
            <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-black border-b border-slate-200 w-16 text-center">Res</th>
                    {isProtein && <th className="px-2 py-2 font-bold text-slate-600 border-b border-slate-200">SS</th>}
                    {selNuc.includes('H') && nucDefs.H.map(a => <th key={a} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('N') && nucDefs.N.map(a => <th key={a} className="px-3 py-2 font-bold text-emerald-700 border-b border-slate-200 bg-emerald-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('C') && nucDefs.C.map(a => <th key={a} className="px-3 py-2 font-bold text-purple-700 border-b border-slate-200 bg-purple-50/50">{a} (ppm)</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {effectiveSeq.map((res, idx) => {
                    if (focusIdx !== 'ALL' && idx !== focusIdx) return null;
                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{res.id}</td>
                        {isProtein && <td className="px-2 py-1 text-center"><span className="inline-flex items-center justify-center w-6 h-6 rounded font-black text-xs" style={{ backgroundColor: SS_META[res.ssLetter].color + '22', color: SS_META[res.ssLetter].color }}>{res.ssLetter}</span></td>}
                        {selNuc.includes('H') && nucDefs.H.map(a => (
                          <td key={a} className="px-3 py-1 align-top">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500 text-center text-xs font-mono" placeholder="—" />
                            {reveal && <EstBadge value={res.effShifts?.[a]} />}
                          </td>
                        ))}
                        {selNuc.includes('N') && nucDefs.N.map(a => (
                          <td key={a} className="px-3 py-1 align-top">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-emerald-500 text-center text-xs font-mono" placeholder="—" />
                            {reveal && <EstBadge value={res.nEff} colorClass="text-emerald-600" />}
                          </td>
                        ))}
                        {selNuc.includes('C') && nucDefs.C.map(a => (
                          <td key={a} className="px-3 py-1 align-top">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-purple-500 text-center text-xs font-mono" placeholder="—" />
                            {reveal && <EstBadge value={a === "C'" ? res.cPrimeEff : res.effUniqueC?.[a]} colorClass="text-purple-600" />}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col gap-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
              <h4 className="text-md font-bold text-blue-700 border-b-2 border-blue-100 inline-block pr-4 pb-1">¹H Assignment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {effectiveSeq.map((res, resIdx) => {
                  if (focusIdx !== 'ALL' && resIdx !== focusIdx) return null;
                  return (
                    <div key={`1h-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                      <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id}){res.ssLetter && isProtein ? ` — ${SS_META[res.ssLetter].label}` : ''}</div>
                      <table className="w-full text-sm text-left bg-white">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm) / estimated</th></tr></thead>
                        <tbody className="text-slate-700 divide-y divide-slate-100">
                          {(res.atoms || []).map(atom => (
                            <tr key={atom} className="hover:bg-slate-50">
                              <td className="px-3 py-1 font-medium">{atom}</td>
                              <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                                <div className="flex items-center justify-center gap-2">
                                  <input type="text" value={shifts[`${resIdx}-${atom}`] || ''} onChange={e => handleShiftChange(resIdx, atom, e.target.value)} className="w-16 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-blue-500 text-xs" placeholder="—" />
                                  {reveal && res.effShifts?.[atom] !== undefined && <span className="text-[13px] font-bold text-blue-600">{res.effShifts[atom].toFixed(2)}</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
              <h4 className="text-md font-bold text-purple-700 border-b-2 border-purple-100 inline-block pr-4 pb-1 mt-4">¹³C Assignment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
                {effectiveSeq.map((res, resIdx) => {
                  if (focusIdx !== 'ALL' && resIdx !== focusIdx) return null;
                  return (
                    <div key={`13c-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                      <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id})</div>
                      <table className="w-full text-sm text-left bg-white">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm) / estimated</th></tr></thead>
                        <tbody className="text-slate-700 divide-y divide-slate-100">
                          {Object.keys(res.effUniqueC || {}).map(cName => (
                            <tr key={cName} className="hover:bg-slate-50">
                              <td className="px-3 py-1 font-medium text-purple-800">{cName}</td>
                              <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                                <div className="flex items-center justify-center gap-2">
                                  <input type="text" value={shifts[`${resIdx}-${cName}`] || ''} onChange={e => handleShiftChange(resIdx, cName, e.target.value)} className="w-16 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-purple-500 text-xs" placeholder="—" />
                                  {reveal && res.effUniqueC?.[cName] !== undefined && <span className="text-[13px] font-bold text-purple-600">{res.effUniqueC[cName].toFixed(1)}</span>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CollapsibleSection>
        {/* 6. SPECTRA IMAGES */}
        <CollapsibleSection title="Spectra Images" icon="🖼️" defaultOpen={true}>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-slate-500">Attach direct image links for your experimental spectra.</p>
            <button onClick={() => { const url = prompt("Paste direct image link (e.g. HSQC, NOESY):"); if (url && url.trim()) updateActiveTest({ nmrSpectraImages: [...images, url.trim()] }); }} className="bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 font-bold px-3 py-1.5 rounded transition-colors shadow-sm text-xs">+ Add Link</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {images.length === 0 ? (
              <div className="col-span-full text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">No spectra images attached.</div>
            ) : (
              images.map((imgSrc, idx) => (
                <div key={idx} className="relative group bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">Spectrum {idx + 1}</span>
                    <button onClick={() => updateActiveTest({ nmrSpectraImages: images.filter((_, i) => i !== idx) })} className="bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold transition-colors border border-red-200">&times;</button>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                    <img src={imgSrc} alt={`Spectrum ${idx+1}`} className="w-full h-auto object-contain rounded bg-white" style={{ minHeight: '150px', maxHeight: '400px' }}
                      onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="%23f8fafc"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="%2394a3b8">⚠️ Image could not be loaded</text></svg>'; }} />
                  </div>
                  <a href={imgSrc} target="_blank" rel="noopener noreferrer" className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">🔗 Open full size</a>
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>
        {/* 7. SIMULATED SPECTRA */}
        {showSim && parsedSeq.length > 0 && (
          <CollapsibleSection title={`Simulated Spectra (Drag to Zoom)${focusIdx !== 'ALL' ? ` — focus: ${effectiveSeq[focusIdx]?.id}` : ''}`} icon="📈" defaultOpen={false}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OneDSpectrumPlot title="Simulated ¹H 1D Spectrum" data={v1H} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
              <OneDSpectrumPlot title="Simulated ¹³C 1D Spectrum" data={v13C} fullDomain={[0, 170]} ticks={TICKS_13C} TickComponent={CustomXTick13C} xLabel="¹³C (ppm)" panelId="1D_13C" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
              <SpectrumPlot title="Simulated COSY Spectrum" diagonalData={vDiag} crossPeakData={vCosy} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="cosy" diagonalColor="#22c55e" />
              <SpectrumPlot title="Simulated NOESY Spectrum" diagonalData={vDiag} crossPeakData={vNoesy} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="noesy" diagonalColor="#ef4444" />
              <SpectrumPlot title="Simulated TOCSY Spectrum" diagonalData={vDiag} crossPeakData={vTocsy} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="tocsy" diagonalColor="#1e3a8a" />
              <HSQCPlot title="Simulated ¹H-¹³C HSQC Spectrum" crossPeakData={vHsqc} expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} panelId="hsqc" />
            </div>
          </CollapsibleSection>
        )}
        {/* 8. LAB NOTEBOOK EXPORT */}
        <CollapsibleSection title="Lab Notebook Export" icon="📓" defaultOpen={false} className="no-print">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">Select the NMR data to format and append to the General Comments (which acts as the Lab Notebook entry).</p>
            <div className="flex flex-wrap gap-4 border border-slate-200 p-4 rounded-lg bg-white shadow-sm">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"><input type="checkbox" id="nb-cond" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" /> Experimental Conditions</label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"><input type="checkbox" id="nb-seq" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" /> Sequence / Molecule</label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"><input type="checkbox" id="nb-table" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" /> Shifts Table</label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"><input type="checkbox" id="nb-images" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" /> Spectra Images</label>
            </div>
            <button
              onClick={() => {
                let html = '<div style="background-color: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 15px; font-family: sans-serif;">';
                html += '<h4 style="color: #1e40af; margin-top: 0; margin-bottom: 12px; font-size: 14px; border-bottom: 2px solid #bfdbfe; padding-bottom: 4px;">📊 NMR Data Summary</h4>';
                const cbCond = document.getElementById('nb-cond')?.checked;
                const cbSeq = document.getElementById('nb-seq')?.checked;
                const cbTable = document.getElementById('nb-table')?.checked;
                const cbImages = document.getElementById('nb-images')?.checked;
                if (cbCond) html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Compound:</b> ${activeTest.compound || 'N/A'} | <b>Solvent:</b> ${activeTest.solvent || 'N/A'} | <b>Temp:</b> ${activeTest.temperature || 'N/A'} | <b>Conc:</b> ${activeTest.concentration || 'N/A'}</p>`;
                if (cbSeq) {
                  const seqInfo = isPolymer ? `<span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${seq || 'N/A'}</span>` : `${parsedSeq[0]?.name || 'N/A'}`;
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>Molecule type:</b> ${typeLabel} | <b>Sequence/Molecule:</b> ${seqInfo}${isProtein && ssStr ? ` | <b>Secondary structure:</b> <span style="font-family: monospace;">${ssStr}</span>` : ''}</p>`;
                }
                if (cbTable && Object.keys(shifts).length > 0) {
                  html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
                  Object.keys(shifts).forEach(key => {
                    const parts = key.split('-'); const resIdx = parts[0]; const atom = parts.slice(1).join('-'); const res = effectiveSeq[resIdx];
                    if (res && shifts[key]) html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${shifts[key]}</td></tr>`;
                  });
                  html += `</table>`;
                }
                if (cbImages && images.length > 0) {
                  html += `<div style="margin-top: 15px;"><h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;
                  images.forEach((imgSrc, idx) => { html += `<div style="margin-bottom: 10px;"><img src="${imgSrc}" alt="Spectrum ${idx+1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;" /><p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx+1}</p></div>`; });
                  html += `</div>`;
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
