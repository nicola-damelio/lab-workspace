import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, BarChart, Bar } from 'recharts';
import { RichTextEditor } from './RichTextEditor';

// --- UTILITY CLASSES FOR FULLSCREEN ---
const FS_CLASSES = "fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col";
const OVERLAY_CLASSES = "fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]";

// --- 1. AMINO ACID DATABASE (¹H ranges) ---
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

// --- NUCLEOTIDE DATABASES (¹H ranges) ---
const NUCLEOTIDE_DB = {
  DNA: {
    'A': { name: 'Deoxyadenosine', code3: 'dA', atoms: ["H8","H2","H1'","H2'","H2''","H3'","H4'","H5'","H5''"],
      ranges: { 'H8': {min:7.7,max:8.5}, 'H2': {min:7.5,max:8.3}, "H1'": {min:5.8,max:6.5}, "H2'": {min:2.3,max:2.9}, "H2''": {min:2.5,max:3.1}, "H3'": {min:4.6,max:5.2}, "H4'": {min:4.0,max:4.6}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.6,max:4.2} },
      cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ["H8"], ["H2"]] },
    'G': { name: 'Deoxyguanosine', code3: 'dG', atoms: ["H8","H1'","H2'","H2''","H3'","H4'","H5'","H5''"],
      ranges: { 'H8': {min:7.6,max:8.3}, "H1'": {min:5.5,max:6.2}, "H2'": {min:2.2,max:2.8}, "H2''": {min:2.4,max:3.0}, "H3'": {min:4.6,max:5.2}, "H4'": {min:3.9,max:4.5}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.6,max:4.2} },
      cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ["H8"]] },
    'C': { name: 'Deoxycytidine', code3: 'dC', atoms: ["H6","H5","H1'","H2'","H2''","H3'","H4'","H5'","H5''"],
      ranges: { 'H6': {min:7.3,max:8.0}, 'H5': {min:5.2,max:5.9}, "H1'": {min:5.7,max:6.4}, "H2'": {min:2.0,max:2.7}, "H2''": {min:2.2,max:2.9}, "H3'": {min:4.6,max:5.2}, "H4'": {min:3.9,max:4.5}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.6,max:4.2} },
      cosy: [["H5","H6"],["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ["H6","H5"]] },
    'T': { name: 'Thymidine', code3: 'dT', atoms: ["H6","H1'","H2'","H2''","H3'","H4'","H5'","H5''","H7(Me)"],
      ranges: { 'H6': {min:7.2,max:7.9}, "H1'": {min:5.8,max:6.5}, "H2'": {min:1.9,max:2.6}, "H2''": {min:2.1,max:2.8}, "H3'": {min:4.6,max:5.2}, "H4'": {min:3.9,max:4.5}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.6,max:4.2}, "H7(Me)": {min:1.5,max:2.0} },
      cosy: [["H1'","H2'"],["H1'","H2''"],["H2'","H2''"],["H2'","H3'"],["H2''","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H2''","H3'","H4'","H5'","H5''"], ["H6"], ["H7(Me)"]] }
  },
  RNA: {
    'A': { name: 'Adenosine', code3: 'A', atoms: ["H8","H2","H1'","H2'","H3'","H4'","H5'","H5''"],
      ranges: { 'H8': {min:7.8,max:8.5}, 'H2': {min:7.6,max:8.4}, "H1'": {min:5.6,max:6.3}, "H2'": {min:4.4,max:5.0}, "H3'": {min:4.2,max:4.8}, "H4'": {min:4.0,max:4.6}, "H5'": {min:3.9,max:4.5}, "H5''": {min:3.8,max:4.3} },
      cosy: [["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"], ["H8"], ["H2"]] },
    'G': { name: 'Guanosine', code3: 'G', atoms: ["H8","H1'","H2'","H3'","H4'","H5'","H5''"],
      ranges: { 'H8': {min:7.5,max:8.3}, "H1'": {min:5.5,max:6.2}, "H2'": {min:4.3,max:4.9}, "H3'": {min:4.2,max:4.8}, "H4'": {min:4.0,max:4.6}, "H5'": {min:3.9,max:4.5}, "H5''": {min:3.8,max:4.3} },
      cosy: [["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"], ["H8"]] },
    'C': { name: 'Cytidine', code3: 'C', atoms: ["H6","H5","H1'","H2'","H3'","H4'","H5'","H5''"],
      ranges: { 'H6': {min:7.3,max:8.0}, 'H5': {min:5.2,max:6.0}, "H1'": {min:5.4,max:6.1}, "H2'": {min:4.1,max:4.7}, "H3'": {min:4.1,max:4.7}, "H4'": {min:3.9,max:4.5}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.7,max:4.3} },
      cosy: [["H5","H6"],["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"], ["H6","H5"]] },
    'U': { name: 'Uridine', code3: 'U', atoms: ["H6","H5","H1'","H2'","H3'","H4'","H5'","H5''"],
      ranges: { 'H6': {min:7.3,max:8.1}, 'H5': {min:5.2,max:6.0}, "H1'": {min:5.3,max:6.0}, "H2'": {min:4.1,max:4.8}, "H3'": {min:4.1,max:4.7}, "H4'": {min:3.9,max:4.5}, "H5'": {min:3.8,max:4.4}, "H5''": {min:3.7,max:4.3} },
      cosy: [["H5","H6"],["H1'","H2'"],["H2'","H3'"],["H3'","H4'"],["H4'","H5'"],["H4'","H5''"],["H5'","H5''"]],
      spinSystems: [["H1'","H2'","H3'","H4'","H5'","H5''"], ["H6","H5"]] }
  }
};

// --- REALISTIC ¹³C RANDOM COIL RANGES (BMRB statistics) ---
const CARBON_RANGE_DB = {
  'A': { 'Cα': [49.5, 53.5], 'Cβ': [15.5, 20.5] },
  'R': { 'Cα': [53.0, 58.0], 'Cβ': [27.0, 32.0], 'Cγ': [23.0, 28.0], 'Cδ': [39.0, 44.0], 'Cζ': [155.0, 160.0] },
  'N': { 'Cα': [49.5, 54.5], 'Cβ': [35.0, 40.0], 'Cγ': [171.0, 176.0] },
  'D': { 'Cα': [50.0, 55.0], 'Cβ': [37.0, 42.0], 'Cγ': [173.0, 178.0] },
  'C': { 'Cα': [54.5, 60.0], 'Cβ': [26.0, 32.0] },
  'E': { 'Cα': [53.0, 58.0], 'Cβ': [26.0, 31.0], 'Cγ': [32.0, 37.0], 'Cδ': [176.0, 181.0] },
  'Q': { 'Cα': [52.5, 57.5], 'Cβ': [26.0, 31.0], 'Cγ': [30.0, 35.0], 'Cδ': [173.0, 178.0] },
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
  'W': { 'Cα': [53.5, 59.0], 'Cβ': [25.5, 32.0], 'Cγ': [107.0, 114.0], 'Cδ1': [119.0, 126.0], 'Cε1': [108.0, 115.0], 'Cε3': [115.0, 121.0], 'Cζ2': [115.0, 122.0], 'Cη2': [117.0, 124.0], 'Cζ3': [115.0, 122.0] },
  'Y': { 'Cα': [53.0, 58.5], 'Cβ': [34.5, 41.0], 'Cγ': [125.5, 131.5], 'Cδ': [128.0, 134.0], 'Cε': [112.5, 118.5], 'Cζ': [151.0, 158.0] }
};

const NUCLEOTIDE_CARBON_DB = {
  DNA: {
    'A': { "C8": [136, 142], "C2": [148, 156], "C1'": [81, 87], "C2'": [36, 42], "C3'": [75, 84], "C4'": [79, 86], "C5'": [60, 67] },
    'G': { "C8": [134, 141], "C1'": [80, 87], "C2'": [35, 42], "C3'": [75, 84], "C4'": [78, 86], "C5'": [60, 67] },
    'C': { "C6": [138, 146], "C5": [98, 106], "C1'": [81, 88], "C2'": [35, 42], "C3'": [75, 84], "C4'": [78, 86], "C5'": [60, 67] },
    'T': { "C6": [134, 142], "C1'": [81, 88], "C2'": [34, 41], "C3'": [75, 84], "C4'": [78, 86], "C5'": [60, 67], "C7(Me)": [10, 16] }
  },
  RNA: {
    'A': { "C8": [136, 143], "C2": [147, 155], "C1'": [85, 92], "C2'": [70, 77], "C3'": [68, 77], "C4'": [80, 87], "C5'": [59, 66] },
    'G': { "C8": [134, 142], "C1'": [85, 92], "C2'": [69, 77], "C3'": [68, 77], "C4'": [79, 87], "C5'": [59, 66] },
    'C': { "C6": [137, 146], "C5": [99, 107], "C1'": [86, 93], "C2'": [68, 76], "C3'": [68, 77], "C4'": [79, 86], "C5'": [58, 66] },
    'U': { "C6": [137, 146], "C5": [99, 108], "C1'": [85, 93], "C2'": [68, 76], "C3'": [68, 77], "C4'": [79, 86], "C5'": [58, 66] }
  }
};

// --- SECONDARY STRUCTURE CHEMICAL SHIFT CORRECTIONS (Δδ = SS − RC, ppm) ---
const SS_CORRECTIONS = {
  coil:  { h: {}, c: {} },
  helix: { h: { 'HN': -0.45, 'Hα': -0.35, 'Hα1': -0.35, 'Hα2': -0.35, other: -0.05 }, c: { 'Cα': 2.8, 'Cβ': -1.5, "C'": -1.3, 'N': -2.5 } },
  sheet: { h: { 'HN': 0.40, 'Hα': 0.30, 'Hα1': 0.30, 'Hα2': 0.30, other: 0.05 }, c: { 'Cα': -1.6, 'Cβ': 1.4, "C'": 1.5, 'N': 2.0 } }
};
const SS_STYLES = {
  C: { label: 'Coil', color: '#64748b', bg: '#f1f5f9' },
  H: { label: 'α-Helix', color: '#e11d48', bg: '#ffe4e6' },
  E: { label: 'β-Sheet', color: '#d97706', bg: '#fef3c7' }
};

const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#f43f5e'];
const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
const TICKS_13C = Array.from({ length: 34 }, (_, i) => i * 5); // 0..165
const CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
const CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

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
  return '#cbd5e1';
};

// Protein: proton -> directly attached carbon
const getCarbonName = (char, atom) => {
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.includes('NH3') || (atom === 'Hε' && char === 'R')) return null;
  if (char === 'W' && atom === 'Hδ1') return null; // indole NH
  let cName = atom.replace('H', 'C').replace(/\d+$/, '');
  if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
  if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
  if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
  if (atom.includes('CH3')) return atom.replace('H', 'C');
  return cName;
};

// Nucleic acids: proton -> directly attached carbon
const getCarbonNameNuc = (atom) => {
  if (!atom || !atom.startsWith('H')) return null;
  if (atom === "H2''") return "C2'";
  if (atom === "H5''") return "C5'";
  return atom.replace('H', 'C');
};

const getProtonCount = (seqType, char, atom) => {
  if (seqType !== 'protein') return atom.includes('(Me)') ? 3 : 1;
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
    for (let j = 0; j < row.length - 1; j++) nextRow.push(row[j] + row[j + 1]);
    nextRow.push(1); row = nextRow;
  }
  return row;
};

// Realistic ¹³C range lookup (with fallback)
const getCarbonRangeFor = (seqType, char, cName) => {
  if (!cName) return { min: 40, max: 50 };
  if (seqType === 'protein') {
    const db = CARBON_RANGE_DB[char];
    if (db && db[cName]) return { min: db[cName][0], max: db[cName][1] };
    if (cName.includes('Cα')) return { min: 50, max: 65 };
    if (cName.includes('Cβ')) return (char === 'S' || char === 'T') ? { min: 60, max: 70 } : { min: 25, max: 45 };
    return { min: 40, max: 50 };
  }
  const db = NUCLEOTIDE_CARBON_DB[seqType === 'dna' ? 'DNA' : 'RNA'][char];
  if (db && db[cName]) return { min: db[cName][0], max: db[cName][1] };
  return { min: 60, max: 90 };
};

const getHexagon = (cx, cy, r, dir) => {
  const pts = []; const baseAngle = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
  for (let i = 0; i < 6; i++) { const a = baseAngle + i * (Math.PI / 3) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return pts;
};
const getPentagon = (cx, cy, r, dir) => {
  const pts = []; const baseAngle = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
  for (let i = 0; i < 5; i++) { const a = baseAngle + i * (2 * Math.PI / 5) * dir; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return pts;
};

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
          <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// --- 3. RECHARTS CUSTOM TICKS & TOOLTIP ---
const CustomXTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}
    </g>
  );
};
const CustomYTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isInt = Number.isInteger(numVal); const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : (isInt ? 8 : (isHalf ? 5 : 3));
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(2) : numVal}</text>}
    </g>
  );
};
const CustomXTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 8 : (isFive ? 6 : 4));
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isTen && !isZoomed ? "bold" : "normal"}>{isZoomed ? numVal.toFixed(1) : numVal}</text>}
    </g>
  );
};
const CustomYTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value); const isTen = numVal % 10 === 0; const isFive = numVal % 5 === 0;
  const tickLength = isZoomed ? 5 : (isTen ? 10 : (isFive ? 6 : 4));
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
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
        <p className="text-slate-500 text-xs mt-1">
          F2: {Number(data.x).toFixed(2)} ppm<br />
          F1: {Number(data.y).toFixed(2)} ppm
        </p>
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
  const xScale = (v) => margin.left + ((domain[1] - v) / span) * plotW; // NMR: high ppm on the LEFT
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
          const x1 = xScale(r.max);
          const x2 = xScale(r.min);
          const cy = yCenter(row);
          const isHov = hover && hover.idx === i;
          return (
            <rect key={`range-${i}`} x={x1} y={cy - 5} width={Math.max(2, x2 - x1)} height={10} rx={3}
              fill={r.color} fillOpacity={isHov ? 1 : 0.75} stroke={r.color} strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onMouseMove={(e) => {
                const crect = containerRef.current.getBoundingClientRect();
                setHover({ idx: i, x: e.clientX - crect.left, y: e.clientY - crect.top });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <text x={margin.left + plotW / 2} y={svgHeight - 6} textAnchor="middle" fontSize={11} fill="#64748b">{xAxisLabel}</text>
      </svg>
      {hover && ranges[hover.idx] && (
        <div className="absolute bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50 pointer-events-none whitespace-nowrap"
          style={{ left: hover.x + 12, top: Math.max(0, hover.y - 44) }}>
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
  const chartRef = useRef(null);
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
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const xVal = getXVal(e.clientX);
      if (xVal !== null) setRefAreaRight(xVal);
    };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (refAreaLeft !== null && refAreaRight !== null && refAreaLeft !== refAreaRight) {
        setXDomain([Math.min(refAreaLeft, refAreaRight), Math.max(refAreaLeft, refAreaRight)]);
      }
      setRefAreaLeft(null);
      setRefAreaRight(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line
  }, [refAreaLeft, refAreaRight, fullDomain]);
  const handleMouseDown = (e) => {
    const xVal = getXVal(e.clientX);
    if (xVal !== null) {
      isDragging.current = true;
      setRefAreaLeft(xVal);
      setRefAreaRight(xVal);
    }
  };
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
              <Bar dataKey="y" barSize={2} shape={(props) => {
                const { x, y, width, height, payload } = props;
                const centerX = x + width / 2;
                return <line x1={centerX} y1={y + height} x2={centerX} y2={y} stroke={payload.color} strokeWidth={1.5} />;
              }} isAnimationActive={false} />
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
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState([0, 11]);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
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
    return {
      x: xDomain[1] - fx * (xDomain[1] - xDomain[0]),
      y: yDomain[0] + fy * (yDomain[1] - yDomain[0]),
    };
  };
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const coords = getPlotCoords(e.clientX, e.clientY);
      if (coords) {
        setRefAreaRight(coords.x);
        setRefAreaBottom(coords.y);
      }
    };
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
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) {
      isDragging.current = true;
      setRefAreaLeft(coords.x); setRefAreaTop(coords.y);
      setRefAreaRight(coords.x); setRefAreaBottom(coords.y);
    }
  };
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
              <Scatter name="Diagonal" data={[{ x: 0, y: 0 }, { x: 11, y: 11 }]} line={{ stroke: '#cbd5e1', strokeWidth: 1 }} shape={<circle r={0} />} legendType="none" isAnimationActive={false} />
              <Scatter data={diagonalData} fill={diagonalColor} shape={(props) => {
                const { cx, cy, fill, payload } = props;
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                return <circle cx={cx} cy={cy} r={payload.size || 5} fill={payload.type === 'Diagonal' ? fill : getNMRFillColor(payload)} opacity={0.8} />;
              }} isAnimationActive={false} />
              <Scatter data={crossPeakData} shape={(props) => {
                const { cx, cy, payload } = props;
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                return <circle cx={cx} cy={cy} r={payload.size || 5} fill={payload.type === 'Diagonal' ? diagonalColor : getNMRFillColor(payload)} opacity={0.8} />;
              }} isAnimationActive={false} />
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
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState([0, 165]);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const isDragging = useRef(false);
  const isZoomed = xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== 0 || yDomain[1] !== 165;
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
    return {
      x: xDomain[1] - fx * (xDomain[1] - xDomain[0]),
      y: yDomain[0] + fy * (yDomain[1] - yDomain[0]),
    };
  };
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current) return;
      const coords = getPlotCoords(e.clientX, e.clientY);
      if (coords) { setRefAreaRight(coords.x); setRefAreaBottom(coords.y); }
    };
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
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) {
      isDragging.current = true;
      setRefAreaLeft(coords.x); setRefAreaTop(coords.y);
      setRefAreaRight(coords.x); setRefAreaBottom(coords.y);
    }
  };
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
              <Scatter data={crossPeakData} shape={(props) => {
                const { cx, cy, payload } = props;
                if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                return <circle cx={cx} cy={cy} r={payload.size || 5} fill={getNMRFillColor(payload)} opacity={0.8} />;
              }} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

// --- 5. 2D CHEMICAL STRUCTURE (PROTEIN) ---
const ChemicalStructure2D = ({ sequence, isExpanded, onToggleExpand, focusChar }) => {
  if (!sequence || sequence.length === 0) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  let currentChar = null;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const addLine = (x1, y1, x2, y2, color, isDouble = false) => {
    updateBounds(x1, y1); updateBounds(x2, y2);
    if (isDouble) { const dx = x2 - x1; const dy = y2 - y1; const len = Math.sqrt(dx * dx + dy * dy) || 1; const nx = -dy / len * 2.5; const ny = dx / len * 2.5; elements.push({ type: 'line', x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, color, resChar: currentChar }); elements.push({ type: 'line', x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny, color, resChar: currentChar }); }
    else elements.push({ type: 'line', x1, y1, x2, y2, color, resChar: currentChar });
  };
  const addText = (x, y, text, color, fontSize = 11, align = 'middle') => { updateBounds(x, y - 15); updateBounds(x, y + 15); updateBounds(x - 30, y); updateBounds(x + 30, y); elements.push({ type: 'text', x, y, text, color, fontSize, align, resChar: currentChar }); };
  const addRingHeteroatom = (x, y, text, color) => { elements.push({ type: 'circle', x, y, r: 12, color: 'white', fill: 'white', strokeWidth: 0, resChar: currentChar }); elements.push({ type: 'text', x, y, text, color, fontSize: 12, align: 'middle', resChar: currentChar }); };
  const placeRadialLabel = (cx, cy, pt, text, color) => { const angle = Math.atan2(pt.y - cy, pt.x - cx); const dist = 18; const lx = pt.x + dist * Math.cos(angle); const ly = pt.y + dist * Math.sin(angle); let anchor = 'middle'; if (Math.abs(angle) < Math.PI / 3) anchor = 'start'; else if (Math.abs(angle) > 2 * Math.PI / 3) anchor = 'end'; addText(lx, ly, text, color, 11, anchor); };
  const addPolygon = (pointsStr, color) => { const pts = pointsStr.split(' ').map(p => p.split(',').map(Number)); pts.forEach(([x, y]) => updateBounds(x, y)); elements.push({ type: 'polygon', points: pointsStr, color, resChar: currentChar }); };

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
    currentChar = c.res.char;
    const color = c.res.color; const isFirst = i === 0; const isLast = i === sequence.length - 1; const char = c.res.char;
    if (!isFirst) addLine(coords[i - 1].cX, coords[i - 1].cY, c.nX, c.nY, coords[i - 1].res.color);
    addLine(c.nX, c.nY, c.caX, c.caY, color); addLine(c.caX, c.caY, c.cX, c.cY, color); addLine(c.cX, c.cY, c.cX, c.cY + c.oDir * 25, "red", true);
    if (isLast) addLine(c.cX, c.cY, c.nextNX, c.nextNY, color);
    if (!isFirst && char !== 'P') { const hDir = c.nY < c.caY ? -1 : 1; addLine(c.nX, c.nY, c.nX, c.nY + hDir * 15, color); addText(c.nX, c.nY + hDir * 25, "H", color, 11); }
    if (char !== 'G') { const haDir = -c.scDir; addLine(c.caX, c.caY, c.caX, c.caY + haDir * 15, color); addText(c.caX, c.caY + haDir * 25, "Hα", color, 11); } else { addLine(c.caX, c.caY, c.caX, c.caY - 15, color); addText(c.caX, c.caY - 25, "Hα1", color, 11); addLine(c.caX, c.caY, c.caX, c.caY + 15, color); addText(c.caX, c.caY + 25, "Hα2", color, 11); }
    if (char === 'P') { elements.push({ type: 'path', d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir * 40} ${c.caX} ${c.caY + c.scDir * 25}`, color, resChar: currentChar }); addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * 25, color); }
    elements.push({ type: 'circle', x: c.nX, y: c.nY, r: 13, color: color, fill: 'white', resChar: currentChar });
    if (isFirst) addText(c.nX, c.nY, char === 'P' ? "H₂N⁺" : "H₃N⁺", color, 13); else addText(c.nX, c.nY, "N", color, 13);
    elements.push({ type: 'circle', x: c.caX, y: c.caY, r: 13, color: color, fill: 'white', resChar: currentChar }); addText(c.caX, c.caY, "Cα", color, 13);
    elements.push({ type: 'circle', x: c.cX, y: c.cY, r: 13, color: color, fill: 'white', resChar: currentChar }); addText(c.cX, c.cY, "C", color, 13);
    addText(c.cX, c.cY + c.oDir * 35, "O", "red", 13);
    if (isLast) { elements.push({ type: 'circle', x: c.nextNX, y: c.nextNY, r: 13, color: color, fill: 'white', resChar: currentChar }); addText(c.nextNX, c.nextNY, "O⁻", "red", 13, 'middle'); }
    const vNode = (lvl, text) => { if (lvl > 0) addLine(c.caX, c.caY + c.scDir * (lvl - 1) * S, c.caX, c.caY + c.scDir * lvl * S, color); addText(c.caX, c.caY + c.scDir * (lvl * S + (c.scDir === 1 ? 10 : -10)), text, color); };
    if (char !== 'G' && char !== 'P') { addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * S, color); if (!['A', 'I', 'V', 'T', 'F', 'Y', 'W', 'H'].includes(char)) addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color); }
    switch (char) {
      case 'A': addText(c.caX, c.caY + c.scDir * S, "CH₃ (Hβ)", color); break;
      case 'V': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ1)', color); addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color); addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color); break;
      case 'L': vNode(2, 'CH (Hγ)'); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ2)', color); break;
      case 'I': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.8 * S, color); addText(c.caX + 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₂ (Hγ1)', color); addLine(c.caX + 20, c.caY + c.scDir * 1.8 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'CH₃ (Hδ1)', color); break;
      case 'S': vNode(2, 'OH (Hγ)'); break;
      case 'T': addText(c.caX, c.caY + c.scDir * S, "CH (Hβ)", color); addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color); addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.5 * S, color); addText(c.caX + 20, c.caY + c.scDir * (1.5 * S + 10), 'OH (Hγ1)', color); break;
      case 'C': vNode(2, 'SH (Hγ)'); break;
      case 'M': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'S (Hδ)'); vNode(4, 'CH₃ (Hε)'); break;
      case 'D': vNode(2, 'C (Hγ)'); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'O⁻', color); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color); break;
      case 'N': vNode(2, 'C (Hγ)'); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'NH₂ (Hδ2)', color); addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color); break;
      case 'E': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'C (Hδ)'); addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'O⁻', color); addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color); break;
      case 'Q': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'C (Hδ)'); addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'NH₂ (Hε2)', color); addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color); break;
      case 'K': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'CH₂ (Hδ)'); vNode(4, 'CH₂ (Hε)'); vNode(5, 'NH₃⁺ (Hζ)'); break;
      case 'R': vNode(2, 'CH₂ (Hγ)'); vNode(3, 'CH₂ (Hδ)'); vNode(4, 'NH (Hε)'); vNode(5, 'C (Hζ)'); addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX - 20, c.caY + c.scDir * 5.8 * S, color); addText(c.caX - 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂ (Hη1)', color); addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX + 20, c.caY + c.scDir * 5.8 * S, color, true); addText(c.caX + 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂⁺ (Hη2)', color); break;
      case 'F':
      case 'Y': {
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const hcx = c.caX; const hcy = c.caY + c.scDir * 3 * S; const hPts = getHexagon(hcx, hcy, S, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, hPts[0].x, hPts[0].y, color); addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: hcx, y: hcy, r: S * 0.6, color: color, fill: 'none', resChar: currentChar });
        placeRadialLabel(hcx, hcy, hPts[1], 'CH (Hδ2)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hδ1)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hε1)', color);
        if (char === 'Y') { const angleZ = Math.atan2(hPts[3].y - hcy, hPts[3].x - hcx); const ohX = hPts[3].x + S * Math.cos(angleZ); const ohY = hPts[3].y + S * Math.sin(angleZ); addLine(hPts[3].x, hPts[3].y, ohX, ohY, color); placeRadialLabel(hPts[3].x, hPts[3].y, { x: ohX, y: ohY }, 'OH (Hη)', color); } else placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color);
        break;
      }
      case 'H': {
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: pcx, y: pcy, r: R5 * 0.5, color: color, fill: 'none', resChar: currentChar });
        addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color); addRingHeteroatom(pPts[4].x, pPts[4].y, "N", color);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ2)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε2)', color); placeRadialLabel(pcx, pcy, pPts[3], 'CH (Hε1)', color);
        break;
      }
      case 'W': {
        addText(c.caX, c.caY + c.scDir * S, "CH₂ (Hβ)", color);
        const R5 = S * 0.85065; const pcx = c.caX; const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5; const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color); addPolygon(pPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: pcx, y: pcy, r: R5 * 0.5, color: color, fill: 'none', resChar: currentChar });
        const ce2 = pPts[3]; const cd2 = pPts[4]; const mx = (ce2.x + cd2.x) / 2; const my = (ce2.y + cd2.y) / 2;
        const midA = Math.atan2(my - pcy, mx - pcx); const hcx = mx + Math.cos(midA) * S * Math.sqrt(3) / 2; const hcy = my + Math.sin(midA) * S * Math.sqrt(3) / 2;
        const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx); const testA = startA + Math.PI / 3; const sign = Math.hypot(hcx + S * Math.cos(testA) - cd2.x, hcy + S * Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
        const hPts = []; for (let j = 0; j < 6; j++) { const a = startA + j * sign * Math.PI / 3; hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) }); }
        addPolygon(hPts.map(p => `${p.x},${p.y}`).join(' '), color); elements.push({ type: 'circle', x: hcx, y: hcy, r: S * 0.6, color: color, fill: 'none', resChar: currentChar });
        addRingHeteroatom(pPts[2].x, pPts[2].y, "NH", color);
        placeRadialLabel(pcx, pcy, pPts[1], 'CH (Hδ1)', color); placeRadialLabel(pcx, pcy, pPts[2], '(Hε1)', color); placeRadialLabel(hcx, hcy, hPts[2], 'CH (Hε3)', color); placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ3)', color); placeRadialLabel(hcx, hcy, hPts[4], 'CH (Hη2)', color); placeRadialLabel(hcx, hcy, hPts[5], 'CH (Hζ2)', color);
        break;
      }
      default: break;
    }
    const labelY = c.caY + (c.scDir > 0 ? 170 : -170); addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14, 'middle');
  });
  const pad = 15; const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const dimOpacity = (el) => (focusChar && focusChar !== 'ALL' && el.resChar && el.resChar !== focusChar) ? 0.15 : 1;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
          <svg viewBox={viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : '300px', minWidth: sequence.length > 3 ? `${sequence.length * 120}px` : '100%' }}>
            {elements.filter(e => e.type === 'line').map((el, idx) => <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'path').map((el, idx) => <path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'polygon').map((el, idx) => <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'circle').map((el, idx) => <circle key={`c${idx}`} cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth={el.strokeWidth !== undefined ? el.strokeWidth : "1.5"} opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'text').map((el, idx) => (
              <g key={`t${idx}`} opacity={dimOpacity(el)}>
                <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                <text x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </>
  );
};

// --- 5B. 2D STRUCTURE (DNA / RNA) ---
const NucleicStructure2D = ({ sequence, isExpanded, onToggleExpand, focusChar, isRNA }) => {
  if (!sequence || sequence.length === 0) return null;
  const elements = []; let minX = 0, maxX = 0, minY = 0, maxY = 0; let firstElement = true;
  const updateBounds = (x, y) => { if (firstElement) { minX = maxX = x; minY = maxY = y; firstElement = false; } else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } };
  const SP = 130; const SY = 100;
  sequence.forEach((res, i) => {
    const color = res.color; const x0 = i * SP; const sx = x0 + 65;
    updateBounds(sx - 30, SY - 30); updateBounds(sx + 30, SY + 90);
    // sugar pentagon
    const sPts = getPentagon(sx, SY, 22, 1);
    elements.push({ type: 'polygon', points: sPts.map(p => `${p.x},${p.y}`).join(' '), color, resChar: res.char });
    elements.push({ type: 'text', x: sx, y: SY, text: isRNA ? "Rib" : "dRib", color, fontSize: 9, align: 'middle', resChar: res.char });
    // base box below
    const by = SY + 62;
    elements.push({ type: 'line', x1: sx, y1: SY + 22, x2: sx, y2: by - 16, color, resChar: res.char });
    elements.push({ type: 'rect', x: sx - 24, y: by - 16, w: 48, h: 32, color, resChar: res.char });
    elements.push({ type: 'text', x: sx, y: by, text: res.char, color, fontSize: 16, align: 'middle', resChar: res.char });
    elements.push({ type: 'text', x: sx, y: by + 32, text: res.id, color, fontSize: 11, align: 'middle', resChar: res.char });
    updateBounds(sx, by + 40);
    // phosphate linkage to the right (except after last)
    if (i < sequence.length - 1) {
      const px = x0 + SP;
      elements.push({ type: 'line', x1: sx + 22, y1: SY, x2: px - 10, y2: SY, color: '#64748b', resChar: res.char });
      elements.push({ type: 'circle', x: px, y: SY, r: 10, color: '#64748b', fill: '#fef9c3', resChar: res.char });
      elements.push({ type: 'text', x: px, y: SY, text: 'P', color: '#a16207', fontSize: 11, align: 'middle', resChar: res.char });
      elements.push({ type: 'line', x1: px + 10, y1: SY, x2: x0 + SP + 65 - 22, y2: SY, color: '#64748b', resChar: sequence[i + 1].char });
      updateBounds(px + 12, SY + 12);
    }
  });
  // termini labels
  elements.push({ type: 'text', x: 45, y: SY - 40, text: "5′", color: '#334155', fontSize: 14, align: 'middle', resChar: null });
  elements.push({ type: 'text', x: (sequence.length - 1) * SP + 85, y: SY - 40, text: "3′", color: '#334155', fontSize: 14, align: 'middle', resChar: null });
  updateBounds(45, SY - 55); updateBounds((sequence.length - 1) * SP + 85, SY - 55);
  const pad = 20; const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const dimOpacity = (el) => (focusChar && focusChar !== 'ALL' && el.resChar && el.resChar !== focusChar) ? 0.15 : 1;
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand}></div>}
      <div className={isExpanded ? FS_CLASSES + " p-4 md:p-6 items-center justify-center" : "flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid"}>
        <button onClick={onToggleExpand} className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm">{isExpanded ? "↙️" : "↗️"}</button>
        <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
          <svg viewBox={viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : '260px', minWidth: sequence.length > 3 ? `${sequence.length * 130}px` : '100%' }}>
            {elements.filter(e => e.type === 'line').map((el, idx) => <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'polygon').map((el, idx) => <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'rect').map((el, idx) => <rect key={`r${idx}`} x={el.x} y={el.y} width={el.w} height={el.h} rx="6" fill="white" stroke={el.color} strokeWidth="1.8" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'circle').map((el, idx) => <circle key={`c${idx}`} cx={el.x} cy={el.y} r={el.r} fill={el.fill || 'white'} stroke={el.color} strokeWidth="1.5" opacity={dimOpacity(el)} />)}
            {elements.filter(e => e.type === 'text').map((el, idx) => (
              <g key={`t${idx}`} opacity={dimOpacity(el)}>
                <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
                <text x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">{el.text}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </>
  );
};

// --- 7. MAIN COMPONENT ---
export const NMRTestRenderer = ({ activeTest, updateActiveTest, TestHeader, datasetProtocols, jumpToProtocol }) => {
  const seqType = activeTest.sequenceType || 'protein'; // 'protein' | 'dna' | 'rna'
  const VALID_LETTERS = seqType === 'protein' ? 'ACDEFGHIKLMNPQRSTVWY' : (seqType === 'dna' ? 'ACGT' : 'ACGU');
  const seq = (activeTest.proteinSequence || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cleanSeq = seq.split('').filter(c => VALID_LETTERS.includes(c)).join('');
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const shifts = activeTest.chemicalShifts || {};
  const images = activeTest.nmrSpectraImages || [];
  const showSim = activeTest.showSpectraSimulation || false;
  const linkedProtocolId = activeTest.linkedProtocolId || '';
  const ssRaw = activeTest.secondaryStructure || '';

  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [expandedPanel, setExpandedPanel] = useState(null);
  const [filterResidue, setFilterResidue] = useState('ALL');       // single residue/nucleotide focus
  const [revealShifts, setRevealShifts] = useState(false);          // reveal estimated values
  const [ssPreview, setSsPreview] = useState('current');            // current | coil | helix | sheet

  const DB = seqType === 'protein' ? AMINO_ACID_DB : NUCLEOTIDE_DB[seqType === 'dna' ? 'DNA' : 'RNA'];
  const nucDefs = seqType === 'protein'
    ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] }
    : { H: ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] };
  const unitLabel = seqType === 'protein' ? 'residues' : 'nucleotides';
  const isNucleic = seqType !== 'protein';
  const carbonNameFor = (char, atom) => isNucleic ? getCarbonNameNuc(atom) : getCarbonName(char, atom);

  const handleShiftChange = (resIdx, atom, val) => updateActiveTest({ chemicalShifts: { ...shifts, [`${resIdx}-${atom}`]: val } });

  // --- Secondary structure helpers (protein only) ---
  const getSSAt = (i) => (ssRaw[i] && 'HES'.includes(ssRaw[i]) ? ssRaw[i] : 'C');
  const setAllSS = (letter) => updateActiveTest({ secondaryStructure: cleanSeq.split('').map(() => letter).join('') });
  const cycleSS = (i) => {
    const arr = cleanSeq.split('').map((_, j) => getSSAt(j));
    arr[i] = arr[i] === 'C' ? 'H' : (arr[i] === 'H' ? 'E' : 'C');
    updateActiveTest({ secondaryStructure: arr.join('') });
  };
  const ssPreviewLetter = ssPreview === 'current' ? null : { coil: 'C', helix: 'H', sheet: 'E' }[ssPreview];

  // --- Parse sequence: random base shifts within realistic ranges ---
  const parsedSeq = useMemo(() => {
    if (cleanSeq.length === 0) return [];
    const assignedShifts = [];
    return cleanSeq.split('').map((char, index) => {
      const aa = DB[char];
      const generatedShifts = {};
      if (aa) {
        Object.keys(aa.ranges).forEach(atom => {
          const r = aa.ranges[atom]; let val = r.min; let success = false; let minDistance = 0.3;
          while (minDistance >= 0.05 && !success) {
            for (let i = 0; i < 50; i++) {
              const candidate = r.min + Math.random() * (r.max - r.min);
              if (!assignedShifts.some(a => Math.abs(a - candidate) < minDistance)) { val = candidate; success = true; break; }
            }
            if (!success) minDistance -= 0.05;
          }
          assignedShifts.push(val); generatedShifts[atom] = parseFloat(val.toFixed(2));
        });
      }
      const cShifts = {}; const generatedShifts13C = {};
      if (aa) {
        Object.keys(generatedShifts).forEach(atom => {
          const cName = isNucleic ? getCarbonNameNuc(atom) : getCarbonName(char, atom);
          if (!cName) return;
          if (!cShifts[cName]) {
            const range = getCarbonRangeFor(seqType, char, cName);
            cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1));
          }
          generatedShifts13C[atom] = cShifts[cName];
        });
      }
      const backboneRand = seqType === 'protein'
        ? { N: parseFloat((117 + Math.random() * 8).toFixed(1)), CPrime: parseFloat((172.5 + Math.random() * 4).toFixed(1)) }
        : null;
      return { ...aa, id: `${aa?.code3 || char}${index + 1}`, char, color: RESIDUE_COLORS[index % RESIDUE_COLORS.length], shifts: generatedShifts, shifts13C: generatedShifts13C, uniqueCShifts: { ...cShifts }, backboneRand };
    });
    // eslint-disable-next-line
  }, [cleanSeq, seqType]);

  const uniqueResidueTypes = useMemo(() => [...new Set(parsedSeq.map(r => r.char))], [parsedSeq]);
  const visibleTypes = filterResidue === 'ALL' ? uniqueResidueTypes : uniqueResidueTypes.filter(t => t === filterResidue);

  // --- EFFECTIVE SHIFTS: manual values (table) ALWAYS take priority over simulation;
  //     secondary-structure corrections applied to the simulated component ---
  const simSeq = useMemo(() => {
    return parsedSeq.map((res, idx) => {
      const letter = (!isNucleic && ssPreviewLetter) ? ssPreviewLetter : (isNucleic ? 'C' : getSSAt(idx));
      const ssState = { C: 'coil', H: 'helix', E: 'sheet' }[letter] || 'coil';
      const corr = SS_CORRECTIONS[ssState];
      const effShifts = {};
      Object.keys(res.shifts || {}).forEach(atom => {
        const manual = parseManual(shifts[`${idx}-${atom}`]);
        let delta = 0;
        if (ssState !== 'coil') {
          const hTable = corr.h;
          delta = hTable[atom] !== undefined ? hTable[atom] : (hTable.other || 0);
        }
        let v = parseFloat((res.shifts[atom] + delta).toFixed(2));
        if (manual !== null) v = manual; // manual wins
        effShifts[atom] = v;
      });
      const effUniqueC = {};
      Object.entries(res.uniqueCShifts || {}).forEach(([cName, base]) => {
        const manual = parseManual(shifts[`${idx}-${cName}`]);
        let delta = ssState !== 'coil' ? (corr.c[cName] || 0) : 0;
        let v = parseFloat((base + delta).toFixed(2));
        if (manual !== null) v = manual; // manual wins
        effUniqueC[cName] = v;
      });
      const effShifts13C = {};
      Object.keys(res.shifts13C || {}).forEach(atom => {
        const cn = isNucleic ? getCarbonNameNuc(atom) : getCarbonName(res.char, atom);
        if (cn && effUniqueC[cn] !== undefined) effShifts13C[atom] = effUniqueC[cn];
      });
      let nEff = null, cPrimeEff = null;
      if (res.backboneRand) {
        const nMan = parseManual(shifts[`${idx}-N`]);
        const cpMan = parseManual(shifts[`${idx}-C'`]);
        nEff = nMan !== null ? nMan : parseFloat((res.backboneRand.N + (ssState !== 'coil' ? (corr.c['N'] || 0) : 0)).toFixed(2));
        cPrimeEff = cpMan !== null ? cpMan : parseFloat((res.backboneRand.CPrime + (ssState !== 'coil' ? (corr.c["C'"] || 0) : 0)).toFixed(2));
      }
      return { ...res, effShifts, effShifts13C, effUniqueC, nEff, cPrimeEff, ssLetter: letter };
    });
    // eslint-disable-next-line
  }, [parsedSeq, shifts, ssRaw, ssPreview, seqType]);

  // --- Generate all peak lists from EFFECTIVE shifts ---
  const { diagonalData, referenceRangesData, referenceRangesData13C, cosyPeaks, tocsyPeaks, noesyPeaks, hsqcPeaks, data1H, data13C } = useMemo(() => {
    let diag = [], ranges = [], ranges13C = [], cosy = [], tocsy = [], noesy = [], hsqc = [], d1H = [], d13C = [];
    const addPair = (arr, x, y, label, type, colorClass, char, char2, size = 5) => {
      arr.push({ x, y, label, type, colorClass, size, char, char2 });
      arr.push({ x: y, y: x, label, type, colorClass, size, char: char2 || char, char2: char });
    };

    // Theoretical reference ranges (visible types only)
    visibleTypes.forEach((char, index) => {
      const aa = DB[char];
      if (!aa) return;
      const typeIndex = Object.keys(DB).indexOf(char);
      const color = RESIDUE_COLORS[typeIndex % RESIDUE_COLORS.length];
      let atomIdx = 0;
      Object.keys(aa.ranges).forEach(atom => {
        const r = aa.ranges[atom];
        ranges.push({ x: (r.min + r.max) / 2, res: aa.code3, atom, min: r.min, max: r.max, y: visibleTypes.length - 1 - index, color, level: atomIdx, char });
        atomIdx++;
      });
      const cNames = new Set();
      Object.keys(aa.ranges).forEach(atom => {
        const cName = isNucleic ? getCarbonNameNuc(atom) : getCarbonName(char, atom);
        if (cName) cNames.add(cName);
      });
      let cIdx = 0;
      cNames.forEach(cName => {
        const range = getCarbonRangeFor(seqType, char, cName);
        ranges13C.push({ x: (range.min + range.max) / 2, res: aa.code3, atom: cName, min: range.min, max: range.max, y: visibleTypes.length - 1 - index, color, level: cIdx, char });
        cIdx++;
      });
    });

    simSeq.forEach((res, index) => {
      if (!res.effShifts) return;
      // 1D ¹H with multiplets
      Object.entries(res.effShifts).forEach(([atom, ppm]) => {
        let peaks = [{ shift: ppm, intensity: 1 }]; let totalNeighbors = 0;
        if (res.cosy) {
          res.cosy.forEach(pair => {
            let neighborAtom = pair[0] === atom ? pair[1] : (pair[1] === atom ? pair[0] : null);
            if (neighborAtom) {
              const count = getProtonCount(seqType, res.char, neighborAtom); totalNeighbors += count;
              const jC = 0.010 + Math.random() * 0.008; const pascalRow = getPascalRow(count);
              let newPeaks = []; peaks.forEach(p => { for (let k = 0; k <= count; k++) newPeaks.push({ shift: p.shift + (k - count / 2) * jC, intensity: p.intensity * pascalRow[k] }); });
              peaks = newPeaks;
            }
          });
        }
        let mergedPeaks = []; peaks.sort((a, b) => a.shift - b.shift);
        peaks.forEach(p => {
          if (mergedPeaks.length > 0) {
            let last = mergedPeaks[mergedPeaks.length - 1];
            if (Math.abs(last.shift - p.shift) < 0.002) { last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity); last.intensity += p.intensity; }
            else mergedPeaks.push({ ...p });
          } else mergedPeaks.push({ ...p });
        });
        const pCount = getProtonCount(seqType, res.char, atom);
        const maxIntensity = Math.max(...mergedPeaks.map(p => p.intensity)) || 1;
        const baseIntensity = (1.5 + Math.random() * 0.5) * pCount;
        let multStr = "m";
        if (totalNeighbors === 0) multStr = "s"; else if (totalNeighbors === 1) multStr = "d"; else if (totalNeighbors === 2) multStr = mergedPeaks.length === 3 ? "t" : "dd"; else if (totalNeighbors === 3) multStr = mergedPeaks.length === 4 ? "q" : "m";
        mergedPeaks.forEach(p => d1H.push({ x: p.shift, y: (p.intensity / maxIntensity) * baseIntensity, label: `${res.id} ${atom}`, color: res.color, type: '1D', multiplet: multStr, char: res.char }));
      });
      // 1D ¹³C (CH groups only)
      const uniqueC = new Map();
      Object.entries(res.effShifts13C || {}).forEach(([atom, ppm]) => {
        const cName = isNucleic ? getCarbonNameNuc(atom) : getCarbonName(res.char, atom);
        if (cName) uniqueC.set(cName, ppm);
      });
      uniqueC.forEach((ppm, cName) => d13C.push({ x: ppm, y: 0.8 + Math.random() * 0.4, label: `${res.id} ${cName}`, color: res.color, type: '1D', char: res.char }));
      // Diagonal
      Object.keys(res.effShifts).forEach(atom => diag.push({ x: res.effShifts[atom], y: res.effShifts[atom], label: `${res.id} ${atom}`, type: 'Diagonal', size: 4, char: res.char }));
      // COSY & TOCSY
      if (res.cosy) res.cosy.forEach(([a1, a2]) => { if (res.effShifts[a1] && res.effShifts[a2]) addPair(cosy, res.effShifts[a1], res.effShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', res.char, res.char, 4); });
      if (res.spinSystems) res.spinSystems.forEach(sys => {
        for (let i = 0; i < sys.length; i++) for (let j = i + 1; j < sys.length; j++) if (res.effShifts[sys[i]] && res.effShifts[sys[j]]) {
          const isDirect = res.cosy && res.cosy.some(c => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i]));
          addPair(tocsy, res.effShifts[sys[i]], res.effShifts[sys[j]], res.id, `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`, isDirect ? 'tocsyDirect' : 'tocsyRelay', res.char, res.char, 4);
        }
      });
      // NOESY: intra (3-bond = COSY pairs, 4-bond = two hops)
      const adj = {};
      if (res.cosy) res.cosy.forEach(([u, v]) => { if (!adj[u]) adj[u] = []; if (!adj[v]) adj[v] = []; adj[u].push(v); adj[v].push(u); });
      const seenPairs = new Set();
      if (res.cosy) res.cosy.forEach(([a1, a2]) => {
        seenPairs.add([a1, a2].sort().join('-'));
        if (res.effShifts[a1] && res.effShifts[a2]) addPair(noesy, res.effShifts[a1], res.effShifts[a2], res.id, `${a1}-${a2} (NOE Intra 3-bond)`, 'noesyIntra', res.char, res.char, 4);
      });
      Object.keys(adj).forEach(u => {
        adj[u].forEach(v => {
          adj[v].forEach(w => {
            if (u !== w) {
              const pairKey = [u, w].sort().join('-');
              if (!seenPairs.has(pairKey)) {
                seenPairs.add(pairKey);
                if (res.effShifts[u] && res.effShifts[w]) addPair(noesy, res.effShifts[u], res.effShifts[w], res.id, `${u}-${w} (NOE Intra 4-bond)`, 'noesyIntra4', res.char, res.char, 3);
              }
            }
          });
        });
      });
      // Protein aromatic intra-ring NOEs
      if (!isNucleic) {
        if (res.char === 'H' && res.effShifts['Hβ1'] && res.effShifts['Hδ2']) {
          addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ2'], res.id, 'Hβ-Hδ2 (Arom.)', 'noesyIntra', res.char, res.char, 4);
          if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ2'], res.id, 'Hβ-Hδ2 (Arom.)', 'noesyIntra', res.char, res.char, 4);
        }
        if ((res.char === 'F' || res.char === 'Y') && res.effShifts['Hβ1'] && res.effShifts['Hδ']) {
          addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ'], res.id, 'Hβ-Hδ (Arom.)', 'noesyIntra', res.char, res.char, 4);
          if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ'], res.id, 'Hβ-Hδ (Arom.)', 'noesyIntra', res.char, res.char, 4);
        }
        if (res.char === 'W' && res.effShifts['Hβ1'] && res.effShifts['Hδ1']) {
          addPair(noesy, res.effShifts['Hβ1'], res.effShifts['Hδ1'], res.id, 'Hβ-Hδ1 (Arom.)', 'noesyIntra', res.char, res.char, 4);
          if (res.effShifts['Hβ2']) addPair(noesy, res.effShifts['Hβ2'], res.effShifts['Hδ1'], res.id, 'Hβ-Hδ1 (Arom.)', 'noesyIntra', res.char, res.char, 4);
        }
      }
      // Sequential NOEs
      if (index < simSeq.length - 1) {
        const nextRes = simSeq[index + 1];
        if (!isNucleic) {
          if (res.effShifts['HN'] && nextRes.effShifts['HN']) addPair(noesy, res.effShifts['HN'], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} HN ↔ ${nextRes.id} HN (dNN)`, 'noesySeq', res.char, nextRes.char, 3);
          const alphaAtoms = (res.atoms || []).filter(a => a.includes('Hα'));
          alphaAtoms.forEach(alphaAtom => { if (res.effShifts[alphaAtom] && nextRes.effShifts['HN']) addPair(noesy, res.effShifts[alphaAtom], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} ${alphaAtom} ↔ ${nextRes.id} HN (dαN)`, 'noesySeq', res.char, nextRes.char, 3); });
          const betaAtoms = (res.atoms || []).filter(a => a.includes('Hβ'));
          betaAtoms.forEach(betaAtom => { if (res.effShifts[betaAtom] && nextRes.effShifts['HN']) addPair(noesy, res.effShifts[betaAtom], nextRes.effShifts['HN'], 'Seq. NOE', `${res.id} ${betaAtom} ↔ ${nextRes.id} HN (dβN)`, 'noesySeq', res.char, nextRes.char, 3); });
        } else {
          const baseAtom = ['H8', 'H6'].find(a => res.effShifts[a]);
          if (baseAtom) {
            ["H1'", "H2'", "H3'"].forEach(t => {
              if (nextRes.effShifts[t]) addPair(noesy, res.effShifts[baseAtom], nextRes.effShifts[t], 'Seq. NOE', `${res.id} ${baseAtom} ↔ ${nextRes.id} ${t}`, 'noesySeq', res.char, nextRes.char, 3);
            });
          }
        }
      }
      // HSQC (¹H-¹³C direct)
      Object.keys(res.effShifts13C || {}).forEach(atom => {
        if (res.effShifts[atom] && res.effShifts13C[atom]) {
          const cn = isNucleic ? getCarbonNameNuc(atom) : getCarbonName(res.char, atom);
          hsqc.push({ x: res.effShifts[atom], y: res.effShifts13C[atom], label: `${res.id} ${atom}-${cn}`, type: 'HSQC', colorClass: 'hsqc', size: 4, char: res.char });
        }
      });
    });
    return { diagonalData: diag, referenceRangesData: ranges, referenceRangesData13C: ranges13C, cosyPeaks: cosy, tocsyPeaks: tocsy, noesyPeaks: noesy, hsqcPeaks: hsqc, data1H: d1H, data13C: d13C };
    // eslint-disable-next-line
  }, [simSeq, visibleTypes, seqType]);

  // --- Focus filter for spectra ---
  const matchFilter = (p) => filterResidue === 'ALL' || p.char === filterResidue || (p.char2 && p.char2 === filterResidue);
  const vDiag = useMemo(() => diagonalData.filter(matchFilter), [diagonalData, filterResidue]);
  const vCosy = useMemo(() => cosyPeaks.filter(matchFilter), [cosyPeaks, filterResidue]);
  const vTocsy = useMemo(() => tocsyPeaks.filter(matchFilter), [tocsyPeaks, filterResidue]);
  const vNoesy = useMemo(() => noesyPeaks.filter(matchFilter), [noesyPeaks, filterResidue]);
  const vHsqc = useMemo(() => hsqcPeaks.filter(matchFilter), [hsqcPeaks, filterResidue]);
  const v1H = useMemo(() => data1H.filter(matchFilter), [data1H, filterResidue]);
  const v13C = useMemo(() => data13C.filter(matchFilter), [data13C, filterResidue]);

  // --- Fill table with estimated values ---
  const fillEstimated = () => {
    const newShifts = { ...shifts };
    simSeq.forEach((res, idx) => {
      Object.entries(res.effShifts || {}).forEach(([atom, v]) => { newShifts[`${idx}-${atom}`] = String(v); });
      Object.entries(res.effUniqueC || {}).forEach(([cName, v]) => { newShifts[`${idx}-${cName}`] = String(v); });
      if (res.nEff !== null) newShifts[`${idx}-N`] = String(res.nEff);
      if (res.cPrimeEff !== null) newShifts[`${idx}-C'`] = String(res.cPrimeEff);
    });
    updateActiveTest({ chemicalShifts: newShifts });
  };
  const clearShifts = () => updateActiveTest({ chemicalShifts: {} });

  const c13Domain = [0, 190];
  const c13Ticks = Array.from({ length: 20 }, (_, i) => i * 10);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50 relative">
      {TestHeader}

      {/* --- VIEW CONTROLS TOOLBAR --- */}
      <div className="px-6 pt-4 shrink-0">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase">{isNucleic ? 'Focus nucleotide' : 'Focus residue'}</span>
            <select value={filterResidue} onChange={(e) => setFilterResidue(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
              <option value="ALL">🔍 All</option>
              {uniqueResidueTypes.map(c => <option key={c} value={c}>{DB[c]?.name || c} ({DB[c]?.code3 || c})</option>)}
            </select>
          </div>
          <button onClick={() => setRevealShifts(!revealShifts)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${revealShifts ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            👁 {revealShifts ? 'Hide' : 'Reveal'} estimated
          </button>
          <button onClick={fillEstimated} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">🪄 Fill table with estimated</button>
          <button onClick={clearShifts} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors">🧹 Clear manual</button>
          {!isNucleic && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs font-bold text-slate-500 uppercase">SS preview</span>
              <select value={ssPreview} onChange={(e) => setSsPreview(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold">
                <option value="current">As painted</option>
                <option value="coil">Force: Random coil</option>
                <option value="helix">Force: α-Helix</option>
                <option value="sheet">Force: β-Sheet</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {/* 1. EXPERIMENTAL CONDITIONS */}
        <CollapsibleSection title="Experimental Conditions" icon="🧪" defaultOpen={true}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="flex flex-col gap-1 col-span-1 md:col-span-2 lg:col-span-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="text-xs font-bold text-blue-800 uppercase flex items-center justify-between">
                <span>Compound / Molecule Label</span>
                <span className="text-[9px] bg-blue-200 text-blue-800 px-2 py-0.5 rounded">Used for Lab Notebook filtering</span>
              </label>
              <input type="text" value={activeTest.compound || ''} onChange={e => updateActiveTest({ compound: e.target.value, compounds: [e.target.value] })} className="w-full border border-blue-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 font-bold text-blue-900" placeholder="e.g. Compound A" />
            </div>
            <div className="flex flex-col gap-1 col-span-1 md:col-span-2 lg:col-span-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
              <label className="text-xs font-bold text-indigo-800 uppercase flex items-center justify-between mb-2"><span>📋 Linked Protocol</span></label>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <select value={linkedProtocolId} onChange={(e) => updateActiveTest({ linkedProtocolId: e.target.value })} className="border border-indigo-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-500 flex-1 w-full cursor-pointer font-semibold text-indigo-900">
                  <option value="">-- No Protocol Linked --</option>
                  {(datasetProtocols || []).map(p => <option key={p.id} value={p.id}>{p.title} ({p.category})</option>)}
                </select>
                {linkedProtocolId && (
                  <button onClick={() => jumpToProtocol && jumpToProtocol(linkedProtocolId)} className="text-sm text-white font-bold bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 w-full sm:w-auto">📖 Open Protocol</button>
                )}
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

        {/* 2. SEQUENCE & CONFIGURATION */}
        <CollapsibleSection title="Sequence & Configuration" icon="🧬" defaultOpen={true}>
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <div className="flex-1 w-full">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-bold text-slate-500 uppercase">Sequence (1-letter code)</label>
                <div className="flex bg-slate-200 p-1 rounded-lg">
                  {[['protein', '🧬 Protein'], ['dna', '🧪 DNA'], ['rna', '🦠 RNA']].map(([val, lab]) => (
                    <button key={val} onClick={() => { updateActiveTest({ sequenceType: val }); setFilterResidue('ALL'); }} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${seqType === val ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{lab}</button>
                  ))}
                </div>
              </div>
              <textarea value={activeTest.proteinSequence || ''} onChange={e => updateActiveTest({ proteinSequence: e.target.value })} className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner" placeholder={seqType === 'protein' ? 'e.g. MKWVTFISLL...' : (seqType === 'dna' ? 'e.g. ACGTACGT...' : 'e.g. ACGUACGU...')} />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">Length: {cleanSeq.length} {unitLabel} {cleanSeq.length !== seq.length && seq.length > 0 ? `(ignored ${seq.length - cleanSeq.length} invalid letters for ${seqType})` : ''}</p>
            </div>
            <div className="w-full md:w-64 flex flex-col gap-4">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
                <div className="flex flex-col gap-2">
                  {['H', 'N', 'C'].map(n => (
                    <label key={n} className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors">
                      <input type="checkbox" checked={selNuc.includes(n)} onChange={() => updateActiveTest({ selectedNuclei: selNuc.includes(n) ? selNuc.filter(x => x !== n) : [...selNuc, n] })} className="w-4 h-4 cursor-pointer accent-blue-600" />
                      <span className="font-bold text-slate-700">Nucleus {n}</span>
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
        {!isNucleic && cleanSeq.length > 0 && (
          <CollapsibleSection title="Secondary Structure (shift corrections)" icon="🌀" defaultOpen={true}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {Object.entries(SS_STYLES).map(([k, v]) => (
                <span key={k} className="text-xs font-bold px-2 py-1 rounded-full border" style={{ color: v.color, backgroundColor: v.bg, borderColor: v.color + '40' }}>{k} = {v.label}</span>
              ))}
              <span className="text-[11px] text-slate-400 italic ml-2">Click a residue to cycle Coil → Helix → Sheet</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => setAllSS('C')} className="text-[11px] font-bold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600">All coil</button>
                <button onClick={() => setAllSS('H')} className="text-[11px] font-bold px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700">All helix</button>
                <button onClick={() => setAllSS('E')} className="text-[11px] font-bold px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-700">All sheet</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-4 max-h-40 overflow-y-auto custom-scrollbar p-2 bg-slate-50 rounded-lg border border-slate-200">
              {cleanSeq.split('').map((ch, i) => {
                const ss = getSSAt(i);
                const st = SS_STYLES[ss];
                const dim = filterResidue !== 'ALL' && ch !== filterResidue;
                return (
                  <button key={i} onClick={() => cycleSS(i)} title={`${ch}${i + 1} — ${st.label}`}
                    className="w-8 h-10 rounded border text-center flex flex-col items-center justify-center transition-all hover:scale-105"
                    style={{ backgroundColor: st.bg, borderColor: st.color + '60', opacity: dim ? 0.3 : 1 }}>
                    <span className="text-xs font-black" style={{ color: st.color }}>{ch}</span>
                    <span className="text-[8px] text-slate-400 leading-none">{i + 1}</span>
                    <span className="text-[8px] font-bold leading-none" style={{ color: st.color }}>{ss}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
              <b>Applied secondary chemical shift corrections (Δδ = SS − random coil):</b><br />
              α-helix: Hα −0.35, HN −0.45, Cα +2.8, Cβ −1.5, C′ −1.3, N −2.5 ppm<br />
              β-sheet: Hα +0.30, HN +0.40, Cα −1.6, Cβ +1.4, C′ +1.5, N +2.0 ppm<br />
              <span className="italic">Use the “SS preview” selector (top toolbar) to compare the full sequence as random coil / α-helix / β-sheet. Manual values in the table always override the simulation.</span>
            </div>
          </CollapsibleSection>
        )}

        {/* 3. 2D CHEMICAL STRUCTURE */}
        {parsedSeq.length > 0 && (
          <CollapsibleSection title="2D Chemical Structure" icon="🔬" defaultOpen={true}>
            {isNucleic
              ? <NucleicStructure2D sequence={parsedSeq} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} focusChar={filterResidue} isRNA={seqType === 'rna'} />
              : <ChemicalStructure2D sequence={parsedSeq} isExpanded={expandedPanel === 'formula'} onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')} focusChar={filterResidue} />}
          </CollapsibleSection>
        )}

        {/* 4. THEORETICAL RANGES */}
        {visibleTypes.length > 0 && (
          <CollapsibleSection title="Theoretical Chemical Shift Ranges" icon="📊" defaultOpen={true}>
            <div className="grid grid-cols-1 gap-4">
              <RangeBarChart title="Theoretical ¹H Ranges" ranges={referenceRangesData} domain={[0, 11]} ticks={Array.from({ length: 12 }, (_, i) => i)} xAxisLabel="¹H (ppm)" rowCount={visibleTypes.length} rowLabels={visibleTypes.map((c) => DB[c]?.code3 || c)} />
              <RangeBarChart title="Theoretical ¹³C Ranges (BMRB random coil statistics)" ranges={referenceRangesData13C} domain={c13Domain} ticks={c13Ticks} xAxisLabel="¹³C (ppm)" rowCount={visibleTypes.length} rowLabels={visibleTypes.map((c) => DB[c]?.code3 || c)} />
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h4 className="text-md font-bold text-slate-700 mb-4 border-b pb-2">Numerical Reference Values</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr><th className="px-4 py-2 font-bold">Residue</th><th className="px-4 py-2 font-bold text-blue-700">¹H Atoms</th><th className="px-4 py-2 font-bold text-blue-700">¹H Range (ppm)</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Atoms</th><th className="px-4 py-2 font-bold text-purple-700">¹³C Range (ppm)</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleTypes.map(char => {
                        const aa = DB[char]; if (!aa) return null;
                        const hAtoms = Object.keys(aa.ranges);
                        const cAtoms = [...new Set(hAtoms.map(k => carbonNameFor(char, k)).filter(Boolean))];
                        return (
                          <tr key={char} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-bold text-slate-700">{aa.name} ({aa.code3})</td>
                            <td className="px-4 py-2 text-blue-800 text-xs">{hAtoms.join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{hAtoms.map(k => `${k}: ${aa.ranges[k].min}-${aa.ranges[k].max}`).join('; ')}</td>
                            <td className="px-4 py-2 text-purple-800 text-xs">{cAtoms.join(', ')}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{cAtoms.map(cName => { const cRange = getCarbonRangeFor(seqType, char, cName); return `${cName}: ${cRange.min}-${cRange.max}`; }).join('; ')}</td>
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
          cleanSeq.length > 0 ? (
            <div className="flex bg-slate-200 p-1 rounded-lg">
              <button onClick={() => { setTableMode('backbone'); updateActiveTest({ tableMode: 'backbone' }); }} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode === 'backbone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{isNucleic ? 'Backbone' : 'Backbone'}</button>
              <button onClick={() => { setTableMode('all'); updateActiveTest({ tableMode: 'all' }); }} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${tableMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>All Atoms</button>
            </div>
          ) : null
        }>
          {cleanSeq.length === 0 ? (
            <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">Enter a sequence to generate the table.</div>
          ) : tableMode === 'backbone' ? (
            <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-black border-b border-slate-200 w-16 text-center">Res</th>
                    {!isNucleic && <th className="px-3 py-2 font-bold text-slate-600 border-b border-slate-200 w-12 text-center">SS</th>}
                    {selNuc.includes('H') && nucDefs.H.map(a => <th key={a} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('N') && nucDefs.N.map(a => <th key={a} className="px-3 py-2 font-bold text-emerald-700 border-b border-slate-200 bg-emerald-50/50">{a} (ppm)</th>)}
                    {selNuc.includes('C') && nucDefs.C.map(a => <th key={a} className="px-3 py-2 font-bold text-purple-700 border-b border-slate-200 bg-purple-50/50">{a} (ppm)</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {simSeq.map((res, idx) => {
                    if (filterResidue !== 'ALL' && res.char !== filterResidue) return null;
                    const ch = cleanSeq[idx];
                    const ssSt = SS_STYLES[getSSAt(idx)];
                    const estFor = (atom) => {
                      if (atom === 'N') return res.nEff;
                      if (atom === "C'") return res.cPrimeEff;
                      if (nucDefs.H.includes(atom)) return res.effShifts[atom];
                      if (nucDefs.C.includes(atom)) return res.effUniqueC[atom];
                      return undefined;
                    };
                    return (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100">{ch}{idx + 1}</td>
                        {!isNucleic && (
                          <td className="px-2 py-2 text-center border-r border-slate-100">
                            <button onClick={() => cycleSS(idx)} className="w-7 h-7 rounded font-black text-xs border" style={{ color: ssSt.color, backgroundColor: ssSt.bg, borderColor: ssSt.color + '50' }} title="Click to change SS">{getSSAt(idx)}</button>
                          </td>
                        )}
                        {selNuc.includes('H') && nucDefs.H.map(a => (
                          <td key={a} className="px-3 py-1">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-blue-500 text-center text-xs font-mono" placeholder="—" />
                            {revealShifts && estFor(a) !== undefined && <div className="text-[9px] text-blue-500 font-bold text-center mt-0.5">≈ {Number(estFor(a)).toFixed(2)}</div>}
                          </td>
                        ))}
                        {selNuc.includes('N') && nucDefs.N.map(a => (
                          <td key={a} className="px-3 py-1">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-emerald-500 text-center text-xs font-mono" placeholder="—" />
                            {revealShifts && estFor(a) !== undefined && <div className="text-[9px] text-emerald-500 font-bold text-center mt-0.5">≈ {Number(estFor(a)).toFixed(1)}</div>}
                          </td>
                        ))}
                        {selNuc.includes('C') && nucDefs.C.map(a => (
                          <td key={a} className="px-3 py-1">
                            <input type="text" value={shifts[`${idx}-${a}`] || ''} onChange={e => handleShiftChange(idx, a, e.target.value)} className="w-full border border-slate-200 rounded px-2 py-1 outline-none focus:border-purple-500 text-center text-xs font-mono" placeholder="—" />
                            {revealShifts && estFor(a) !== undefined && <div className="text-[9px] text-purple-500 font-bold text-center mt-0.5">≈ {Number(estFor(a)).toFixed(2)}</div>}
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
                {simSeq.map((res, resIdx) => {
                  if (filterResidue !== 'ALL' && res.char !== filterResidue) return null;
                  return (
                    <div key={`1h-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                      <div className="py-2 text-center font-bold text-sm flex items-center justify-center gap-2" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>
                        {res.name} ({res.id})
                        {!isNucleic && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-black border" style={{ color: SS_STYLES[res.ssLetter].color, backgroundColor: SS_STYLES[res.ssLetter].bg, borderColor: SS_STYLES[res.ssLetter].color + '50' }}>{res.ssLetter}</span>}
                      </div>
                      <table className="w-full text-sm text-left bg-white">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th></tr></thead>
                        <tbody className="text-slate-700 divide-y divide-slate-100">
                          {res.atoms.map(atom => (
                            <tr key={atom} className="hover:bg-slate-50">
                              <td className="px-3 py-1 font-medium">{atom}</td>
                              <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                                <div className="flex items-center justify-center gap-1">
                                  <input type="text" value={shifts[`${resIdx}-${atom}`] || ''} onChange={e => handleShiftChange(resIdx, atom, e.target.value)} className="w-14 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-blue-500 text-xs" placeholder="—" />
                                </div>
                                {(revealShifts || showSim) && res.effShifts[atom] !== undefined && <div className="text-[9px] font-bold text-blue-600 mt-0.5">est. ≈ {res.effShifts[atom].toFixed(2)}{parseManual(shifts[`${resIdx}-${atom}`]) !== null ? ' (manual ✓)' : ''}</div>}
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
                {simSeq.map((res, resIdx) => {
                  if (filterResidue !== 'ALL' && res.char !== filterResidue) return null;
                  return (
                    <div key={`13c-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                      <div className="py-2 text-center font-bold text-sm" style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}>{res.name} ({res.id})</div>
                      <table className="w-full text-sm text-left bg-white">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200"><tr><th className="px-3 py-2 font-semibold">Atom</th><th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th></tr></thead>
                        <tbody className="text-slate-700 divide-y divide-slate-100">
                          {Object.keys(res.effUniqueC || {}).map(cName => (
                            <tr key={cName} className="hover:bg-slate-50">
                              <td className="px-3 py-1 font-medium text-purple-800">{cName}</td>
                              <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                                <div className="flex items-center justify-center gap-1">
                                  <input type="text" value={shifts[`${resIdx}-${cName}`] || ''} onChange={e => handleShiftChange(resIdx, cName, e.target.value)} className="w-14 text-center border border-slate-300 rounded py-0.5 outline-none focus:border-purple-500 text-xs" placeholder="—" />
                                </div>
                                {(revealShifts || showSim) && res.effUniqueC[cName] !== undefined && <div className="text-[9px] font-bold text-purple-600 mt-0.5">est. ≈ {res.effUniqueC[cName].toFixed(1)}{parseManual(shifts[`${resIdx}-${cName}`]) !== null ? ' (manual ✓)' : ''}</div>}
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
                    <img src={imgSrc} alt={`Spectrum ${idx + 1}`} className="w-full h-auto object-contain rounded bg-white" style={{ minHeight: '150px', maxHeight: '400px' }}
                      onError={(e) => { e.target.onerror = null; e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="%23f8fafc"/><text x="50%25" y="45%25" dominant-baseline="middle" text-anchor="middle" font-size="14" fill="%2394a3b8">⚠️ Image could not be loaded</text><text x="50%25" y="55%25" dominant-baseline="middle" text-anchor="middle" font-size="11" fill="%23cbd5e1">Check the URL is a direct image link</text></svg>'; }} />
                  </div>
                  <a href={imgSrc} target="_blank" rel="noopener noreferrer" className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium flex items-center gap-1">🔗 Open full size</a>
                </div>
              ))
            )}
          </div>
        </CollapsibleSection>

        {/* 7. SIMULATED SPECTRA */}
        {showSim && parsedSeq.length > 0 && (
          <CollapsibleSection title={`Simulated Spectra (Drag to Zoom)${filterResidue !== 'ALL' ? ` — focus: ${DB[filterResidue]?.code3 || filterResidue}` : ''}`} icon="📈" defaultOpen={false}>
            <p className="text-[11px] text-slate-500 mb-4 italic">Manual values entered in the Assignment Table always take priority over the simulated random-coil values. Secondary-structure corrections are applied to the simulated component.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OneDSpectrumPlot title="Simulated ¹H 1D Spectrum" data={v1H} fullDomain={[0, 11]} ticks={TICKS_1H} TickComponent={CustomXTick1H} xLabel="¹H (ppm)" panelId="1D_1H" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
              <OneDSpectrumPlot title="Simulated ¹³C 1D Spectrum" data={v13C} fullDomain={[0, 165]} ticks={TICKS_13C} TickComponent={CustomXTick13C} xLabel="¹³C (ppm)" panelId="1D_13C" expandedPanel={expandedPanel} setExpandedPanel={setExpandedPanel} />
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
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer hover:text-blue-600"><input type="checkbox" id="nb-seq" defaultChecked className="w-4 h-4 accent-blue-600 cursor-pointer" /> Sequence</label>
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
                if (cbCond) html += `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Compound:</b> ${activeTest.compound || 'N/A'} | <b>Type:</b> ${seqType.toUpperCase()} | <b>Solvent:</b> ${activeTest.solvent || 'N/A'} | <b>Temp:</b> ${activeTest.temperature || 'N/A'} | <b>Conc:</b> ${activeTest.concentration || 'N/A'}</p>`;
                if (cbSeq) {
                  html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>Sequence:</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${activeTest.proteinSequence || 'N/A'}</span></p>`;
                  if (seqType === 'protein' && ssRaw) html += `<p style="font-size: 12px; color: #475569; margin-bottom: 12px;"><b>Secondary structure (C/H/E):</b> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 4px; border-radius: 4px;">${cleanSeq.split('').map((_, i) => getSSAt(i)).join('')}</span></p>`;
                }
                if (cbTable && Object.keys(shifts).length > 0) {
                  html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Residue</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Atom</th><th style="padding: 6px; border: 1px solid #cbd5e1;">Shift (ppm)</th></tr>`;
                  Object.keys(shifts).forEach(key => {
                    const parts = key.split('-'); const resIdx = parts[0]; const atom = parts.slice(1).join('-'); const res = parsedSeq[resIdx];
                    if (res && shifts[key]) html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;"><b>${res.name} (${res.id})</b></td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155;">${atom}</td><td style="padding: 6px; border: 1px solid #e2e8f0; color: #334155; font-family: monospace;">${shifts[key]}</td></tr>`;
                  });
                  html += `</table>`;
                }
                if (cbImages && images.length > 0) {
                  html += `<div style="margin-top: 15px;"><h5 style="color: #1e40af; font-size: 12px; margin-bottom: 8px;">📷 Spectra Images:</h5>`;
                  images.forEach((imgSrc, idx) => {
                    html += `<div style="margin-bottom: 10px;"><img src="${imgSrc}" alt="Spectrum ${idx + 1}" style="max-width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 4px;" /><p style="font-size: 10px; color: #64748b; margin-top: 4px;">Image ${idx + 1}</p></div>`;
                  });
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
