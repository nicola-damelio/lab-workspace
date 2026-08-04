import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, BarChart, Bar
} from 'recharts';

/* ============================================================================
   NMRSections — NMR-specific sections rendered by TestShellRenderer:
   Toolbar, Compounds, Data, Fitting, Simulations, NotebookExtra.
   Cross-highlighting: selection is stored in activeTest.selectedAtomKeys and
   shared by the formula (Compounds), the assignment table (Data) and all
   simulated spectra (Simulations).
========================================================================== */

const FS_CLASSES =
  'fixed top-4 left-4 z-[999999] bg-white shadow-2xl rounded-2xl !w-[calc(100vw-2rem)] !h-[calc(100vh-2rem)] !max-w-none !max-h-none !m-0 overflow-hidden flex flex-col';
const OVERLAY_CLASSES = 'fixed top-0 left-0 w-screen h-screen bg-slate-900/50 backdrop-blur-sm z-[999990]';
const SELECT_COLOR = '#f59e0b';
const MANUAL_COLOR = '#16a34a';

// ================= DATABASES =================
const AMINO_ACID_DB = {
  A: {
    name: 'Alanine', code3: 'Ala', atoms: ['HN', 'Hα', 'Hβ'],
    ranges: { HN: { min: 7.8, max: 8.6 }, Hα: { min: 4.0, max: 4.5 }, Hβ: { min: 1.2, max: 1.5 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ']], spinSystems: [['HN', 'Hα', 'Hβ']]
  },
  C: {
    name: 'Cysteine', code3: 'Cys', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'],
    ranges: { HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.8 }, Hβ1: { min: 2.8, max: 3.3 }, Hβ2: { min: 2.8, max: 3.3 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']]
  },
  D: {
    name: 'Aspartic Acid', code3: 'Asp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'],
    ranges: { HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.5, max: 2.9 }, Hβ2: { min: 2.5, max: 2.9 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']]
  },
  E: {
    name: 'Glutamic Acid', code3: 'Glu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ'],
    ranges: { HN: { min: 8.0, max: 8.7 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 }, Hγ: { min: 2.1, max: 2.5 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']], spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ']]
  },
  F: {
    name: 'Phenylalanine', code3: 'Phe', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε', 'Hζ'],
    ranges: {
      HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.9, max: 3.3 }, Hβ2: { min: 2.9, max: 3.3 },
      Hδ: { min: 7.1, max: 7.4 }, Hε: { min: 7.2, max: 7.5 }, Hζ: { min: 7.1, max: 7.4 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε'], ['Hε', 'Hζ']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε', 'Hζ']]
  },
  G: {
    name: 'Glycine', code3: 'Gly', atoms: ['HN', 'Hα1', 'Hα2'],
    ranges: { HN: { min: 8.0, max: 8.8 }, Hα1: { min: 3.8, max: 4.1 }, Hα2: { min: 3.8, max: 4.1 } },
    cosy: [['HN', 'Hα1'], ['HN', 'Hα2'], ['Hα1', 'Hα2']], spinSystems: [['HN', 'Hα1', 'Hα2']]
  },
  H: {
    name: 'Histidine', code3: 'His', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ2', 'Hε1'],
    ranges: {
      HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.0, max: 3.4 }, Hβ2: { min: 3.0, max: 3.4 },
      Hδ2: { min: 6.9, max: 7.3 }, Hε1: { min: 7.6, max: 8.1 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ2', 'Hε1']]
  },
  I: {
    name: 'Isoleucine', code3: 'Ile', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1'],
    ranges: {
      HN: { min: 7.7, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.7, max: 2.0 },
      Hγ1: { min: 1.1, max: 1.6 }, Hγ2: { min: 0.8, max: 1.1 }, Hδ1: { min: 0.7, max: 1.0 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2'], ['Hγ1', 'Hδ1']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2', 'Hδ1']]
  },
  K: {
    name: 'Lysine', code3: 'Lys', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε', 'Hζ(NH3)'],
    ranges: {
      HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 1.9 }, Hγ: { min: 1.3, max: 1.6 },
      Hδ: { min: 1.5, max: 1.8 }, Hε: { min: 2.8, max: 3.2 }, 'Hζ(NH3)': { min: 7.2, max: 7.6 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε'], ['Hε', 'Hζ(NH3)']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'], ['Hζ(NH3)']]
  },
  L: {
    name: 'Leucine', code3: 'Leu', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2'],
    ranges: {
      HN: { min: 7.9, max: 8.5 }, Hα: { min: 4.2, max: 4.7 }, Hβ: { min: 1.5, max: 1.9 }, Hγ: { min: 1.4, max: 1.8 },
      Hδ1: { min: 0.8, max: 1.0 }, Hδ2: { min: 0.8, max: 1.0 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ1'], ['Hγ', 'Hδ2']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ1', 'Hδ2']]
  },
  M: {
    name: 'Methionine', code3: 'Met', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε(CH3)'],
    ranges: {
      HN: { min: 7.9, max: 8.6 }, Hα: { min: 4.3, max: 4.7 }, Hβ: { min: 1.9, max: 2.3 },
      Hγ: { min: 2.4, max: 2.7 }, 'Hε(CH3)': { min: 2.0, max: 2.2 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε(CH3)']]
  },
  N: {
    name: 'Asparagine', code3: 'Asn', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ21', 'Hδ22'],
    ranges: {
      HN: { min: 8.0, max: 8.8 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.6, max: 3.0 }, Hβ2: { min: 2.6, max: 3.0 },
      Hδ21: { min: 6.8, max: 7.2 }, Hδ22: { min: 7.4, max: 7.8 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ21', 'Hδ22']]
  },
  P: {
    name: 'Proline', code3: 'Pro', atoms: ['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2'],
    ranges: {
      Hα: { min: 4.2, max: 4.6 }, Hβ1: { min: 1.8, max: 2.4 }, Hβ2: { min: 1.8, max: 2.4 },
      Hγ1: { min: 1.8, max: 2.1 }, Hγ2: { min: 1.8, max: 2.1 }, Hδ1: { min: 3.4, max: 3.8 }, Hδ2: { min: 3.4, max: 3.8 }
    },
    cosy: [
      ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hβ1', 'Hγ1'], ['Hβ2', 'Hγ2'],
      ['Hγ1', 'Hγ2'], ['Hγ1', 'Hδ1'], ['Hγ2', 'Hδ2'], ['Hδ1', 'Hδ2']
    ],
    spinSystems: [['Hα', 'Hβ1', 'Hβ2', 'Hγ1', 'Hγ2', 'Hδ1', 'Hδ2']]
  },
  Q: {
    name: 'Glutamine', code3: 'Gln', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hε21', 'Hε22'],
    ranges: {
      HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.9, max: 2.3 },
      Hγ: { min: 2.2, max: 2.6 }, Hε21: { min: 6.7, max: 7.1 }, Hε22: { min: 7.3, max: 7.7 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hε21', 'Hε22']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ'], ['Hε21', 'Hε22']]
  },
  R: {
    name: 'Arginine', code3: 'Arg', atoms: ['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ', 'Hε'],
    ranges: {
      HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.1, max: 4.5 }, Hβ: { min: 1.6, max: 2.0 },
      Hγ: { min: 1.4, max: 1.8 }, Hδ: { min: 3.0, max: 3.3 }, Hε: { min: 7.0, max: 7.4 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ'], ['Hγ', 'Hδ'], ['Hδ', 'Hε']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ', 'Hδ'], ['Hε']]
  },
  S: {
    name: 'Serine', code3: 'Ser', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2'],
    ranges: { HN: { min: 8.0, max: 8.6 }, Hα: { min: 4.3, max: 4.8 }, Hβ1: { min: 3.7, max: 4.0 }, Hβ2: { min: 3.7, max: 4.0 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2']]
  },
  T: {
    name: 'Threonine', code3: 'Thr', atoms: ['HN', 'Hα', 'Hβ', 'Hγ2'],
    ranges: { HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.2, max: 4.6 }, Hβ: { min: 4.0, max: 4.4 }, Hγ2: { min: 1.0, max: 1.3 } },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ2']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ2']]
  },
  V: {
    name: 'Valine', code3: 'Val', atoms: ['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2'],
    ranges: {
      HN: { min: 7.8, max: 8.5 }, Hα: { min: 4.0, max: 4.4 }, Hβ: { min: 1.9, max: 2.3 },
      Hγ1: { min: 0.8, max: 1.1 }, Hγ2: { min: 0.8, max: 1.1 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ'], ['Hβ', 'Hγ1'], ['Hβ', 'Hγ2']],
    spinSystems: [['HN', 'Hα', 'Hβ', 'Hγ1', 'Hγ2']]
  },
  W: {
    name: 'Tryptophan', code3: 'Trp', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ1', 'Hε3', 'Hζ2', 'Hη2', 'Hζ3'],
    ranges: {
      HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.5, max: 5.0 }, Hβ1: { min: 3.1, max: 3.5 }, Hβ2: { min: 3.1, max: 3.5 },
      Hδ1: { min: 10.0, max: 10.5 }, Hε3: { min: 7.4, max: 7.7 }, Hζ2: { min: 7.3, max: 7.6 },
      Hη2: { min: 7.0, max: 7.3 }, Hζ3: { min: 6.9, max: 7.2 }
    },
    cosy: [
      ['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'],
      ['Hδ1', 'Hε3'], ['Hε3', 'Hζ3'], ['Hζ3', 'Hη2'], ['Hη2', 'Hζ2']
    ],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ1'], ['Hε3', 'Hζ3', 'Hη2', 'Hζ2']]
  },
  Y: {
    name: 'Tyrosine', code3: 'Tyr', atoms: ['HN', 'Hα', 'Hβ1', 'Hβ2', 'Hδ', 'Hε'],
    ranges: {
      HN: { min: 7.9, max: 8.7 }, Hα: { min: 4.4, max: 4.9 }, Hβ1: { min: 2.8, max: 3.2 }, Hβ2: { min: 2.8, max: 3.2 },
      Hδ: { min: 6.9, max: 7.2 }, Hε: { min: 6.6, max: 6.9 }
    },
    cosy: [['HN', 'Hα'], ['Hα', 'Hβ1'], ['Hα', 'Hβ2'], ['Hβ1', 'Hβ2'], ['Hδ', 'Hε']],
    spinSystems: [['HN', 'Hα', 'Hβ1', 'Hβ2'], ['Hδ', 'Hε']]
  }
};

const NUCLEOTIDE_DB = {
  DNA: {
    A: {
      name: 'Deoxyadenosine', code3: 'dA', base: 'purine',
      atoms: ['H8', 'H2', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H8: { min: 7.9, max: 8.4 }, H2: { min: 7.7, max: 8.3 }, "H1'": { min: 5.9, max: 6.4 },
        "H2'": { min: 2.2, max: 2.8 }, "H2''": { min: 2.5, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 },
        "H4'": { min: 4.1, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 }
      },
      cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]]
    },
    G: {
      name: 'Deoxyguanosine', code3: 'dG', base: 'purine',
      atoms: ['H8', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H8: { min: 7.6, max: 8.2 }, "H1'": { min: 5.6, max: 6.2 }, "H2'": { min: 2.2, max: 2.8 },
        "H2''": { min: 2.5, max: 3.0 }, "H3'": { min: 4.7, max: 5.1 }, "H4'": { min: 4.0, max: 4.5 },
        "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.7, max: 4.2 }
      },
      cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"]]
    },
    C: {
      name: 'Deoxycytidine', code3: 'dC', base: 'pyrimidine',
      atoms: ['H6', 'H5', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H6: { min: 7.3, max: 8.0 }, H5: { min: 5.2, max: 5.9 }, "H1'": { min: 5.8, max: 6.4 },
        "H2'": { min: 2.0, max: 2.7 }, "H2''": { min: 2.2, max: 2.9 }, "H3'": { min: 4.7, max: 5.1 },
        "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 }
      },
      cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']]
    },
    T: {
      name: 'Thymidine', code3: 'T', base: 'pyrimidine',
      atoms: ['H6', 'H7(CH3)', "H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H6: { min: 7.2, max: 7.9 }, 'H7(CH3)': { min: 1.6, max: 2.0 }, "H1'": { min: 5.9, max: 6.4 },
        "H2'": { min: 1.9, max: 2.5 }, "H2''": { min: 2.1, max: 2.7 }, "H3'": { min: 4.7, max: 5.1 },
        "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.3 }, "H5''": { min: 3.6, max: 4.2 }
      },
      cosy: [["H1'", "H2'"], ["H1'", "H2''"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H2''", "H3'", "H4'", "H5'", "H5''"], ['H7(CH3)']]
    }
  },
  RNA: {
    A: {
      name: 'Adenosine', code3: 'A', base: 'purine',
      atoms: ['H8', 'H2', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H8: { min: 7.9, max: 8.5 }, H2: { min: 7.8, max: 8.4 }, "H1'": { min: 5.7, max: 6.2 },
        "H2'": { min: 4.4, max: 4.9 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 },
        "H4'": { min: 4.1, max: 4.6 }, "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 }
      },
      cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]]
    },
    G: {
      name: 'Guanosine', code3: 'G', base: 'purine',
      atoms: ['H8', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H8: { min: 7.6, max: 8.3 }, "H1'": { min: 5.5, max: 6.1 }, "H2'": { min: 4.3, max: 4.9 },
        "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 }, "H4'": { min: 4.0, max: 4.6 },
        "H5'": { min: 3.9, max: 4.4 }, "H5''": { min: 3.8, max: 4.3 }
      },
      cosy: [["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"]]
    },
    C: {
      name: 'Cytidine', code3: 'C', base: 'pyrimidine',
      atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.6, max: 6.2 },
        "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.2, max: 4.7 },
        "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 }
      },
      cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']]
    },
    U: {
      name: 'Uridine', code3: 'U', base: 'pyrimidine',
      atoms: ['H6', 'H5', "H1'", "H2'", "OH2'", "H3'", "H4'", "H5'", "H5''"],
      ranges: {
        H6: { min: 7.4, max: 8.1 }, H5: { min: 5.3, max: 6.0 }, "H1'": { min: 5.4, max: 6.0 },
        "H2'": { min: 4.1, max: 4.7 }, "OH2'": { min: 5.0, max: 5.6 }, "H3'": { min: 4.1, max: 4.7 },
        "H4'": { min: 4.0, max: 4.5 }, "H5'": { min: 3.8, max: 4.4 }, "H5''": { min: 3.7, max: 4.3 }
      },
      cosy: [['H5', 'H6'], ["H1'", "H2'"], ["H2'", "H3'"], ["H3'", "H4'"], ["H4'", "H5'"], ["H4'", "H5''"], ["H5'", "H5''"]],
      spinSystems: [["H1'", "H2'", "H3'", "H4'", "H5'", "H5''"], ['H5', 'H6']]
    }
  }
};

const SUGAR_DB = {
  GLC: {
    name: 'D-Glucose', code3: 'Glc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'],
    ranges: {
      H1: { min: 4.55, max: 5.25 }, H2: { min: 3.4, max: 3.7 }, H3: { min: 3.6, max: 3.9 },
      H4: { min: 3.35, max: 3.65 }, H5: { min: 3.55, max: 3.85 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 }
    },
    cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']],
    spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']]
  },
  GAL: {
    name: 'D-Galactose', code3: 'Gal', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'],
    ranges: {
      H1: { min: 4.55, max: 5.25 }, H2: { min: 3.5, max: 3.85 }, H3: { min: 3.6, max: 3.95 },
      H4: { min: 3.85, max: 4.15 }, H5: { min: 3.7, max: 4.0 }, H6a: { min: 3.6, max: 3.9 }, H6b: { min: 3.65, max: 3.95 }
    },
    cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']],
    spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']]
  },
  MAN: {
    name: 'D-Mannose', code3: 'Man', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'],
    ranges: {
      H1: { min: 4.7, max: 5.2 }, H2: { min: 3.7, max: 4.0 }, H3: { min: 3.6, max: 3.9 },
      H4: { min: 3.55, max: 3.85 }, H5: { min: 3.6, max: 3.95 }, H6a: { min: 3.6, max: 3.95 }, H6b: { min: 3.65, max: 4.0 }
    },
    cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']],
    spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b']]
  },
  FUC: {
    name: 'L-Fucose', code3: 'Fuc', atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
    ranges: {
      H1: { min: 4.7, max: 5.2 }, H2: { min: 3.6, max: 3.95 }, H3: { min: 3.65, max: 4.0 },
      H4: { min: 3.7, max: 4.05 }, H5: { min: 3.6, max: 3.95 }, H6: { min: 1.1, max: 1.3 }
    },
    cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6']],
    spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6']]
  },
  NAG: {
    name: 'N-Acetylglucosamine', code3: 'GlcNAc',
    atoms: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b', 'NHAc', 'AcCH3'],
    ranges: {
      H1: { min: 4.6, max: 5.2 }, H2: { min: 3.7, max: 4.05 }, H3: { min: 3.6, max: 3.9 },
      H4: { min: 3.4, max: 3.7 }, H5: { min: 3.6, max: 3.9 }, H6a: { min: 3.65, max: 3.95 }, H6b: { min: 3.7, max: 4.0 },
      NHAc: { min: 7.5, max: 8.2 }, AcCH3: { min: 1.9, max: 2.1 }
    },
    cosy: [['H1', 'H2'], ['H2', 'H3'], ['H3', 'H4'], ['H4', 'H5'], ['H5', 'H6a'], ['H5', 'H6b'], ['H6a', 'H6b']],
    spinSystems: [['H1', 'H2', 'H3', 'H4', 'H5', 'H6a', 'H6b'], ['NHAc'], ['AcCH3']]
  }
};

const LIPID_DB = {
  POPC: {
    name: 'POPC', head: 'PC', headLabel: 'N(CH₃)₃⁺',
    atoms: [
      'Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1',
      'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2',
      'HCH2N', 'HNMe3'
    ],
    ranges: {
      Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 },
      Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 },
      'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 },
      'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 },
      'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 },
      'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 },
      HCH2N: { min: 3.6, max: 3.8 }, HNMe3: { min: 3.18, max: 3.28 }
    },
    cosy: [
      ['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'],
      ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2N', 'HNMe3']
    ],
    spinSystems: [
      ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'],
      ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'],
      ['HCH2N', 'HNMe3']
    ]
  },
  POPE: {
    name: 'POPE', head: 'PE', headLabel: 'NH₃⁺',
    atoms: [
      'Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1',
      'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2',
      'HCH2N', 'HNH3'
    ],
    ranges: {
      Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 },
      Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 },
      'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 },
      'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 },
      'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 },
      'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 },
      HCH2N: { min: 3.1, max: 3.3 }, HNH3: { min: 7.5, max: 8.5 }
    },
    cosy: [
      ['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'],
      ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2']
    ],
    spinSystems: [
      ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'],
      ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'],
      ['HCH2N', 'HNH3']
    ]
  },
  POPS: {
    name: 'POPS', head: 'PS', headLabel: 'Ser',
    atoms: [
      'Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1',
      'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2',
      'HαS', 'HβS1', 'HβS2', 'HNH3'
    ],
    ranges: {
      Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 },
      Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 },
      'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 },
      'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 },
      'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 },
      'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 },
      HαS: { min: 4.0, max: 4.3 }, HβS1: { min: 3.75, max: 4.05 }, HβS2: { min: 3.75, max: 4.05 }, HNH3: { min: 7.5, max: 8.5 }
    },
    cosy: [
      ['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'],
      ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'],
      ['HαS', 'HβS1'], ['HαS', 'HβS2']
    ],
    spinSystems: [
      ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'],
      ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'],
      ['HαS', 'HβS1', 'HβS2', 'HNH3']
    ]
  },
  POPG: {
    name: 'POPG', head: 'PG', headLabel: 'Gly',
    atoms: [
      'Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b', 'H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1',
      'H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2',
      'HCH2OH', 'HCHOH'
    ],
    ranges: {
      Hsn1a: { min: 4.15, max: 4.45 }, Hsn1b: { min: 4.15, max: 4.45 }, Hsn2: { min: 5.15, max: 5.35 },
      Hsn3a: { min: 3.95, max: 4.35 }, Hsn3b: { min: 3.95, max: 4.35 }, 'H2-sn1': { min: 2.25, max: 2.4 },
      'H3-sn1': { min: 1.55, max: 1.7 }, 'H4-sn1': { min: 1.2, max: 1.35 }, 'H16-sn1': { min: 0.82, max: 0.92 },
      'H2-sn2': { min: 2.25, max: 2.4 }, 'H3-sn2': { min: 1.55, max: 1.7 }, 'H4-sn2': { min: 1.2, max: 1.35 },
      'Hall-sn2': { min: 1.95, max: 2.1 }, 'H9-sn2': { min: 5.3, max: 5.4 }, 'H10-sn2': { min: 5.3, max: 5.4 },
      'H11-sn2': { min: 1.95, max: 2.1 }, 'H18-sn2': { min: 0.82, max: 0.92 },
      HCH2OH: { min: 3.45, max: 3.75 }, HCHOH: { min: 3.65, max: 3.9 }
    },
    cosy: [
      ['Hsn1a', 'Hsn2'], ['Hsn1b', 'Hsn2'], ['Hsn2', 'Hsn3a'], ['Hsn2', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1'], ['H3-sn1', 'H4-sn1'], ['H2-sn2', 'H3-sn2'], ['H3-sn2', 'H4-sn2'],
      ['Hall-sn2', 'H9-sn2'], ['H9-sn2', 'H10-sn2'], ['H10-sn2', 'H11-sn2'], ['HCH2OH', 'HCHOH']
    ],
    spinSystems: [
      ['Hsn1a', 'Hsn1b', 'Hsn2', 'Hsn3a', 'Hsn3b'],
      ['H2-sn1', 'H3-sn1', 'H4-sn1', 'H16-sn1'],
      ['H2-sn2', 'H3-sn2', 'H4-sn2', 'Hall-sn2', 'H9-sn2', 'H10-sn2', 'H11-sn2', 'H18-sn2'],
      ['HCH2OH', 'HCHOH']
    ]
  }
};

const CARBON_RANGE_DB = {
  A: { Cα: [49.5, 53.5], Cβ: [15.5, 20.5] },
  C: { Cα: [54.5, 60], Cβ: [26, 32] },
  D: { Cα: [50, 55], Cβ: [37, 42], Cγ: [173, 178] },
  E: { Cα: [53, 58], Cβ: [26, 31], Cγ: [32, 37], Cδ: [176, 181] },
  F: { Cα: [53, 58.5], Cβ: [35, 41], Cγ: [133, 139], Cδ: [126.5, 132], Cε: [126, 131.5], Cζ: [124, 129.5] },
  G: { Cα: [41, 46] },
  H: { Cα: [51.5, 57], Cβ: [27, 33], Cδ2: [114, 120], Cε1: [131, 138] },
  I: { Cα: [57, 62.5], Cβ: [34, 39.5], Cγ1: [23, 29], Cγ2: [13.5, 19], Cδ1: [9, 14.5] },
  K: { Cα: [53, 58.5], Cβ: [29, 34.5], Cγ: [21, 26.5], Cδ: [26, 31.5], Cε: [38.5, 43.5] },
  L: { Cα: [51, 56.5], Cβ: [38, 44], Cγ: [22.5, 28], Cδ1: [20, 25.5], Cδ2: [20, 25.5] },
  M: { Cα: [51.5, 57], Cβ: [28, 33.5], Cγ: [13, 18.5], Cε: [12.5, 18] },
  N: { Cα: [49.5, 54.5], Cβ: [35, 40], Cγ: [171, 176] },
  P: { Cα: [58, 64], Cβ: [27.5, 33.5], Cγ: [22.5, 28.5], Cδ: [45, 51.5] },
  Q: { Cα: [52.5, 57.5], Cβ: [26, 31], Cγ: [30, 35], Cδ: [173, 178] },
  R: { Cα: [53, 58], Cβ: [27, 32], Cγ: [23, 28], Cδ: [39, 44], Cζ: [155, 160] },
  S: { Cα: [53.5, 60], Cβ: [59.5, 66.5] },
  T: { Cα: [56.5, 64], Cβ: [64.5, 72.5], Cγ2: [17.5, 23.5] },
  V: { Cα: [57.5, 64], Cβ: [28.5, 34.5], Cγ1: [16.5, 22.5], Cγ2: [16.5, 22.5] },
  W: { Cα: [53.5, 59], Cβ: [25.5, 32], Cδ1: [119, 126], Cε3: [115, 121], Cζ2: [115, 122], Cη2: [117, 124], Cζ3: [115, 122] },
  Y: { Cα: [53, 58.5], Cβ: [34.5, 41], Cγ: [125.5, 131.5], Cδ: [128, 134], Cε: [112.5, 118.5], Cζ: [151, 158] }
};

const SS_CORRECTIONS = {
  coil: { h: {}, c: {} },
  helix: {
    h: { HN: -0.45, Hα: -0.35, Hα1: -0.35, Hα2: -0.35, other: -0.05 },
    c: { Cα: 2.8, Cβ: -1.5, "C'": -1.3, N: -2.5 }
  },
  sheet: {
    h: { HN: 0.4, Hα: 0.3, Hα1: 0.3, Hα2: 0.3, other: 0.05 },
    c: { Cα: -1.6, Cβ: 1.4, "C'": 1.5, N: 2.0 }
  }
};

const SS_META = {
  C: { label: 'Random coil', color: '#64748b' },
  H: { label: 'α-Helix', color: '#8b5cf6' },
  E: { label: 'β-Sheet', color: '#f59e0b' }
};
const FORM_META = {
  A: { label: 'A-form', color: '#0ea5e9' },
  B: { label: 'B-form', color: '#22c55e' },
  Z: { label: 'Z-form', color: '#f43f5e' }
};
const DNA_FORM_OFFSETS = {
  B: { "H1'": 0, "H2'": 0, "H3'": 0, "H2''": 0 },
  A: { "H1'": 0.2, "H2'": -0.3, "H3'": 0.15, "H2''": -0.25 },
  Z: { "H1'": -0.15, "H2'": 0.25, "H3'": -0.1, "H2''": 0.2 }
};
const SUGAR_ANOMER_OFFSETS = { alpha: { H1: 0.25 }, beta: { H1: -0.15 } };
const RESIDUE_COLORS = ['#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#6366f1'];
const TICKS_1H = Array.from({ length: 111 }, (_, i) => parseFloat((i / 10).toFixed(1)));
const TICKS_13C = Array.from({ length: 281 }, (_, i) => parseFloat((10 + i * 0.5).toFixed(1)));
const TICKS_15N = Array.from({ length: 81 }, (_, i) => parseFloat((95 + i * 0.5).toFixed(1)));
const CHART_MARGIN = { top: 20, right: 20, bottom: 45, left: 50 };
const CHART_MARGIN_1D = { top: 10, right: 15, bottom: 45, left: 15 };

// ================= HELPERS =================
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
  if (
    atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') ||
    atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')
  ) return null;
  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) {
      return atom.replace('H', 'C');
    }
    return cName;
  }
  if (molType === 'dna' || molType === 'rna') {
    if (atom.includes('CH3')) return atom.replace('H', 'C');
    return atom.replace('H', 'C');
  }
  if (molType === 'sugar') return atom.replace('H', 'C').replace(/[ab]$/, '');
  if (molType === 'lipid') {
    const map = {
      Hsn1a: 'Csn1', Hsn1b: 'Csn1', Hsn2: 'Csn2', Hsn3a: 'Csn3', Hsn3b: 'Csn3',
      'H2-sn1': 'C2-sn1', 'H3-sn1': 'C3-sn1', 'H4-sn1': 'C4-sn1', 'H16-sn1': 'C16-sn1',
      'H2-sn2': 'C2-sn2', 'H3-sn2': 'C3-sn2', 'H4-sn2': 'C4-sn2', 'Hall-sn2': 'Call-sn2',
      'H9-sn2': 'C9-sn2', 'H10-sn2': 'C10-sn2', 'H11-sn2': 'C11-sn2', 'H18-sn2': 'C18-sn2',
      HCH2N: 'CCH2N', HNMe3: 'CNMe3', HNH3: null, HαS: 'CαS', HβS1: 'CβS', HβS2: 'CβS',
      HCH2OH: 'CCH2OH', HCHOH: 'CCHOH'
    };
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
      if (v.startsWith('H')) {
        const c = getCarbonName(molType, char, v);
        if (c) set.add(`${ri}-${c}`);
      }
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

// ---------- shared selection helpers (cross-highlight state lives in activeTest) ----------
const getSelectedKeys = (activeTest) =>
  Array.isArray(activeTest.selectedAtomKeys) && activeTest.selectedAtomKeys.length
    ? activeTest.selectedAtomKeys
    : null;

const selectionLabel = (d, selectedKeys) => {
  if (!selectedKeys || !selectedKeys.length) return '';
  const ri = parseInt(selectedKeys[0].split('-')[0], 10);
  const res = d.parsedSeq[ri];
  const atoms = [...new Set(selectedKeys.map((k) => k.split('-').slice(1).join('-')))];
  return `${res ? res.id : `#${ri + 1}`}: ${atoms.join(', ')}`;
};

const getManualKeys = (shifts) => {
  const out = new Set();
  Object.entries(shifts || {}).forEach(([k, v]) => {
    if (parseManual(v) === null) return;
    out.add(k);
    const idx = k.split('-')[0];
    const atom = k.slice(idx.length + 1);
    out.add(`${idx}-${atom.trim()}`);
    out.add(`${idx}-${atom.replace(/\s+/g, '')}`);
  });
  return [...out];
};

// ================= GEOMETRY =================
const getHexagon = (cx, cy, r, dir) => {
  const pts = [];
  const baseAngle = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
  for (let i = 0; i < 6; i++) {
    const a = baseAngle + i * (Math.PI / 3) * dir;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
};
const getPentagon = (cx, cy, r, dir) => {
  const pts = [];
  const baseAngle = dir === 1 ? -Math.PI / 2 : Math.PI / 2;
  for (let i = 0; i < 5; i++) {
    const a = baseAngle + i * ((2 * Math.PI) / 5) * dir;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
};
const hexAt = (cx, cy, r, deg0) => {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((deg0 + i * 60) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
};
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

// ================= STRUCTURE ELEMENT BUILDER FACTORY =================
const makeBuilder = () => {
  const elements = [];
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  let first = true;
  const ub = (x, y) => {
    if (first) { minX = maxX = x; minY = maxY = y; first = false; }
    else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  };
  const addLine = (x1, y1, x2, y2, color, isDouble = false, width = 1.8) => {
    ub(x1, y1); ub(x2, y2);
    if (isDouble) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 2.6, ny = (dx / len) * 2.6;
      elements.push({ type: 'line', x1: x1 + nx, y1: y1 + ny, x2: x2 + nx, y2: y2 + ny, color, width });
      elements.push({ type: 'line', x1: x1 - nx, y1: y1 - ny, x2: x2 - nx, y2: y2 - ny, color, width });
    } else elements.push({ type: 'line', x1, y1, x2, y2, color, width });
  };
  const addPolygon = (pts, color) => {
    pts.forEach((p) => ub(p.x, p.y));
    elements.push({ type: 'polygon', points: pts.map((p) => `${p.x},${p.y}`).join(' '), color });
  };
  const addCircle = (x, y, r, color, fill = 'white', strokeWidth, meta = null) => {
    ub(x, y);
    elements.push({ type: 'circle', x, y, r, color, fill, strokeWidth, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null });
  };
  const addDot = (x, y, color, meta = null) => {
    ub(x, y);
    elements.push({ type: 'circle', x, y, r: 2.4, color, fill: color, strokeWidth: 0, ri: meta?.ri ?? null, atoms: meta?.atoms ?? null, keys: meta?.keys ?? null });
  };
  const finish = (pad = 15) => ({
    elements,
    viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`
  });
  return { elements, ub, addLine, addPolygon, addCircle, addDot, finish };
};

// ---------- PROTEIN STRUCTURE ----------
const buildProteinStructure = (sequence) => {
  const b = makeBuilder();
  let curRi = null;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x, y - 15); b.ub(x, y + 15); b.ub(x - 30, y); b.ub(x + 30, y);
    b.elements.push({
      type: 'text', x, y, text, color, fontSize, align,
      ri: curRi, atoms,
      keys: atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null
    });
  };
  const addAtomCircle = (x, y, r, color, atoms = null) => {
    const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null;
    b.addCircle(x, y, r, color, 'white', 1.5, { ri: curRi, atoms, keys });
  };
  const addRingHeteroatom = (x, y, text, color, atoms = null) => {
    const keys = atoms ? buildKeys(curRi, atoms, 'protein', sequence[curRi]?.char) : null;
    b.addCircle(x, y, 12, color, 'white', 1.6, { ri: curRi, atoms, keys });
    addText(x, y, text, color, 11, 'middle', atoms);
  };
  const placeRadialLabel = (cx, cy, pt, text, color, atoms = null) => {
    const angle = Math.atan2(pt.y - cy, pt.x - cx);
    const dist = 18;
    const lx = pt.x + dist * Math.cos(angle);
    const ly = pt.y + dist * Math.sin(angle);
    let anchor = 'middle';
    if (Math.abs(angle) < Math.PI / 3) anchor = 'start';
    else if (Math.abs(angle) > (2 * Math.PI) / 3) anchor = 'end';
    addText(lx, ly, text, color, 11, anchor, atoms);
  };
  const dx = 45, dy = 30, S = 25;
  const coords = [];
  let cx = 100, cy = 200, slope = -1;
  for (let i = 0; i < sequence.length; i++) {
    const nX = cx, nY = cy;
    cx += dx; cy += slope * dy;
    const caX = cx, caY = cy, scDir = slope;
    slope *= -1;
    cx += dx; cy += slope * dy;
    const cX = cx, cY = cy, oDir = slope;
    slope *= -1;
    cx += dx; cy += slope * dy;
    const nextNX = cx, nextNY = cy;
    slope *= -1;
    coords.push({ nX, nY, caX, caY, cX, cY, nextNX, nextNY, scDir, oDir, res: sequence[i] });
  }
  coords.forEach((c, i) => {
    curRi = i;
    const color = c.res.color;
    const isFirst = i === 0;
    const isLast = i === sequence.length - 1;
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
      b.addLine(c.caX, c.caY, c.caX, c.caY - 15, color);
      addText(c.caX, c.caY - 25, 'Hα1', color, 11, 'middle', ['Hα1']);
      b.addLine(c.caX, c.caY, c.caX, c.caY + 15, color);
      addText(c.caX, c.caY + 25, 'Hα2', color, 11, 'middle', ['Hα2']);
    }
    if (char === 'P') {
      b.elements.push({
        type: 'path',
        d: `M ${c.nX} ${c.nY} Q ${c.caX} ${c.caY + c.scDir * 40} ${c.caX} ${c.caY + c.scDir * 25}`,
        color
      });
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
    if (isLast) {
      addAtomCircle(c.nextNX, c.nextNY, 13, color, null);
      addText(c.nextNX, c.nextNY, 'O⁻', '#ef4444', 13, 'middle', null);
    }
    const vNode = (lvl, text, atoms) => {
      if (lvl > 0) b.addLine(c.caX, c.caY + c.scDir * (lvl - 1) * S, c.caX, c.caY + c.scDir * lvl * S, color);
      addText(c.caX, c.caY + c.scDir * (lvl * S + (c.scDir === 1 ? 10 : -10)), text, color, 11, 'middle', atoms);
    };
    if (char !== 'G' && char !== 'P') {
      b.addLine(c.caX, c.caY, c.caX, c.caY + c.scDir * S, color);
      if (!['A', 'I', 'V', 'T', 'F', 'Y', 'W', 'H'].includes(char)) {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
      }
    }
    switch (char) {
      case 'A':
        addText(c.caX, c.caY + c.scDir * S, 'CH₃ (Hβ)', color, 11, 'middle', ['Hβ']);
        break;
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
      case 'S':
        vNode(2, 'OH (Hβ)', ['Hβ1', 'Hβ2']);
        break;
      case 'T':
        addText(c.caX, c.caY + c.scDir * S, 'CH (Hβ)', color, 11, 'middle', ['Hβ']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX - 20, c.caY + c.scDir * 1.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (1.8 * S + 10), 'CH₃ (Hγ2)', color, 11, 'middle', ['Hγ2']);
        b.addLine(c.caX, c.caY + c.scDir * S, c.caX + 20, c.caY + c.scDir * 1.5 * S, color);
        addText(c.caX + 20, c.caY + c.scDir * (1.5 * S + 10), 'OH (Hγ1)', color, 11, 'middle', ['Hγ1']);
        break;
      case 'C':
        vNode(2, 'SH (Hβ)', ['Hβ1', 'Hβ2']);
        break;
      case 'M':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']);
        vNode(3, 'S', null);
        vNode(4, 'CH₃ (Hε)', ['Hε(CH3)']);
        break;
      case 'D':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'N':
        vNode(2, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX - 20, c.caY + c.scDir * 2.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (2.8 * S + 10), 'NH₂ (Hδ2)', color, 11, 'middle', ['Hδ21', 'Hδ22']);
        b.addLine(c.caX, c.caY + c.scDir * 2 * S, c.caX + 20, c.caY + c.scDir * 2.8 * S, color, true);
        addText(c.caX + 20, c.caY + c.scDir * (2.8 * S + 10), 'O', color);
        break;
      case 'E':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']);
        vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'O⁻', color);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true);
        addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'Q':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']);
        vNode(3, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX - 20, c.caY + c.scDir * 3.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (3.8 * S + 10), 'NH₂ (Hε2)', color, 11, 'middle', ['Hε21', 'Hε22']);
        b.addLine(c.caX, c.caY + c.scDir * 3 * S, c.caX + 20, c.caY + c.scDir * 3.8 * S, color, true);
        addText(c.caX + 20, c.caY + c.scDir * (3.8 * S + 10), 'O', color);
        break;
      case 'K':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']);
        vNode(3, 'CH₂ (Hδ)', ['Hδ']);
        vNode(4, 'CH₂ (Hε)', ['Hε']);
        vNode(5, 'NH₃⁺ (Hζ)', ['Hζ(NH3)']);
        break;
      case 'R':
        vNode(2, 'CH₂ (Hγ)', ['Hγ']);
        vNode(3, 'CH₂ (Hδ)', ['Hδ']);
        vNode(4, 'NH (Hε)', ['Hε']);
        vNode(5, 'C', null);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX - 20, c.caY + c.scDir * 5.8 * S, color);
        addText(c.caX - 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂', color);
        b.addLine(c.caX, c.caY + c.scDir * 5 * S, c.caX + 20, c.caY + c.scDir * 5.8 * S, color, true);
        addText(c.caX + 20, c.caY + c.scDir * (5.8 * S + 10), 'NH₂⁺', color);
        break;
      case 'F':
      case 'Y': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const hcx = c.caX;
        const hcy = c.caY + c.scDir * 3 * S;
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
          const ohX = hPts[3].x + S * Math.cos(angleZ);
          const ohY = hPts[3].y + S * Math.sin(angleZ);
          b.addLine(hPts[3].x, hPts[3].y, ohX, ohY, color);
          addText(ohX + 12 * Math.cos(angleZ), ohY + 12 * Math.sin(angleZ), 'OH', color, 11, 'middle', null);
        } else {
          placeRadialLabel(hcx, hcy, hPts[3], 'CH (Hζ)', color, ['Hζ']);
        }
        break;
      }
      case 'H': {
        addText(c.caX, c.caY + c.scDir * S, 'CH₂ (Hβ)', color, 11, 'middle', ['Hβ', 'Hβ1', 'Hβ2']);
        const R5 = S * 0.85065;
        const pcx = c.caX;
        const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
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
        const R5 = S * 0.85065;
        const pcx = c.caX;
        const pcy = c.caY + c.scDir * 2 * S + c.scDir * R5;
        const pPts = getPentagon(pcx, pcy, R5, c.scDir);
        b.addLine(c.caX, c.caY + c.scDir * S, pPts[0].x, pPts[0].y, color);
        b.addPolygon(pPts, color);
        b.addCircle(pcx, pcy, R5 * 0.5, color, 'none');
        const ce2 = pPts[3];
        const cd2 = pPts[4];
        const mx = (ce2.x + cd2.x) / 2;
        const my = (ce2.y + cd2.y) / 2;
        const midA = Math.atan2(my - pcy, mx - pcx);
        const hcx = mx + (Math.cos(midA) * S * Math.sqrt(3)) / 2;
        const hcy = my + (Math.sin(midA) * S * Math.sqrt(3)) / 2;
        const startA = Math.atan2(ce2.y - hcy, ce2.x - hcx);
        const testA = startA + Math.PI / 3;
        const sign = Math.hypot(hcx + S * Math.cos(testA) - cd2.x, hcy + S * Math.sin(testA) - cd2.y) < 0.1 ? 1 : -1;
        const hPts = [];
        for (let j = 0; j < 6; j++) {
          const a = startA + j * sign * (Math.PI / 3);
          hPts.push({ x: hcx + S * Math.cos(a), y: hcy + S * Math.sin(a) });
        }
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
      default:
        break;
    }
    const labelY = c.caY + (c.scDir > 0 ? 170 : -170);
    addText(c.caX, labelY, `${c.res.name} (${c.res.id})`, color, 14, 'middle', null);
  });
  return b.finish();
};

// ---------- NUCLEIC STRUCTURE ----------
const buildNucleicStructure = (sequence, molType) => {
  const b = makeBuilder();
  const isDNA = molType === 'dna';
  let curRi = null, curChar = null;
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({
      type: 'text', x, y, text, color, fontSize, align,
      ri: curRi, atoms,
      keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null
    });
  };
  const ringAtom = (x, y, text, color, atoms = null) => {
    b.addCircle(x, y, 9, color, 'white', 1.2, { ri: curRi, atoms, keys: atoms ? buildKeys(curRi, atoms, molType, curChar) : null });
    addText(x, y, text, color, 8, 'middle', atoms);
  };
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

// ---------- SUGAR STRUCTURE ----------
const buildSugarStructure = (res, conformation, anomer) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  const addText = (x, y, text, color, fontSize = 11, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({
      type: 'text', x, y, text, color, fontSize, align,
      ri: curRi, atoms,
      keys: atoms ? buildKeys(curRi, atoms, 'sugar', curChar) : null
    });
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

// ---------- LIPID STRUCTURE ----------
const buildLipidStructure = (res, db) => {
  const b = makeBuilder();
  const curRi = 0, curChar = res.char, c = res.color;
  const addText = (x, y, text, color, fontSize = 10, align = 'middle', atoms = null) => {
    b.ub(x - 30, y); b.ub(x + 30, y); b.ub(x, y - 12); b.ub(x, y + 12);
    b.elements.push({
      type: 'text', x, y, text, color, fontSize, align,
      ri: curRi, atoms,
      keys: atoms ? buildKeys(curRi, atoms, 'lipid', curChar) : null
    });
  };
  const zig = (x0, y0, n, L, amp, dir0) => {
    const pts = [{ x: x0, y: y0 }];
    let dir = dir0;
    for (let k = 0; k < n; k++) {
      const p = pts[pts.length - 1];
      pts.push({ x: p.x - L, y: p.y + dir * amp });
      dir *= -1;
    }
    return pts;
  };
  const chain = (pts, dblIdx) => {
    for (let k = 0; k < pts.length - 1; k++) b.addLine(pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y, c, k === dblIdx, 1.6);
  };
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

// ================= SVG EXPORT =================
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

// ================= IMAGE URL NORMALIZATION =================
const normalizeImageCandidates = (url) => {
  const u = (url || '').trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }
  m = u.match(/drive\.google\.com\/(?:open|uc)[^#]*[?&]id=([^&#]+)/);
  if (m) {
    const id = m[1];
    return [
      `https://lh3.googleusercontent.com/d/${id}`,
      `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
      `https://drive.google.com/uc?export=view&id=${id}`
    ];
  }
  if (u.includes('dropbox.com')) {
    return [u.replace(/[?&]dl=0/g, '') + (u.includes('?') ? '&raw=1' : '?raw=1'), u];
  }
  return [u];
};

// ---------- STRUCTURE VIEW ----------
const StructureSVGView = ({
  structure, minWidth, isExpanded, onToggleExpand, selectedKeys, manualKeys = [], onAtomClick, height = '300px'
}) => {
  const clickables = structure.elements.filter(
    (e) => (e.type === 'circle' || e.type === 'text') && e.ri != null && e.keys && e.keys.length && onAtomClick
  );
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={onToggleExpand} />}
      <div
        className={
          isExpanded
            ? FS_CLASSES + ' p-4 md:p-6 items-center justify-center'
            : 'flex flex-col bg-white p-4 rounded-xl shadow-sm w-full h-full items-center justify-center relative border border-slate-200 break-inside-avoid'
        }
      >
        <button
          onClick={onToggleExpand}
          className="absolute top-3 right-3 z-[110] flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 w-8 h-8 justify-center rounded-lg text-lg font-bold transition-all shadow-sm"
        >
          {isExpanded ? '↙️' : '↗️'}
        </button>
        <div className="w-full flex-grow flex items-center justify-start overflow-x-auto overflow-y-hidden custom-scrollbar min-h-0 relative">
          <svg viewBox={structure.viewBox} className="font-sans" style={{ height: isExpanded ? '80vh' : height, minWidth }}>
            {structure.elements.filter((e) => e.type === 'line').map((el, idx) => (
              <line key={`l${idx}`} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
            ))}
            {structure.elements.filter((e) => e.type === 'path').map((el, idx) => (
              <path key={`pa${idx}`} d={el.d} fill="none" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
            ))}
            {structure.elements.filter((e) => e.type === 'polygon').map((el, idx) => (
              <polygon key={`po${idx}`} points={el.points} fill="white" stroke={el.color} strokeWidth={el.width || 1.8} pointerEvents="none" />
            ))}
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
                  <text x={el.x} y={el.y} fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">
                    {el.text}
                  </text>
                  <text x={el.x} y={el.y} fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : el.color} fontSize={el.fontSize} textAnchor={el.align} dominantBaseline="middle" fontWeight="bold">
                    {el.text}
                  </text>
                </g>
              );
            })}
            {clickables.map((el, idx) => {
              const r = el.type === 'circle' ? Math.max(el.r + 4, 10) : el.text.length * (el.fontSize || 11) * 0.34 + 7;
              return (
                <circle
                  key={`hit${idx}`}
                  cx={el.x}
                  cy={el.y}
                  r={r}
                  fill="transparent"
                  style={{ cursor: 'pointer', pointerEvents: 'all' }}
                  onClick={(e) => { e.stopPropagation(); onAtomClick(el.ri, el.keys); }}
                >
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

// ================= SEQUENCE PAINT STRIP =================
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
          <button
            key={i}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onMouseDown={(e) => { e.preventDefault(); setPainting(true); onApply(i); }}
            onMouseEnter={() => { if (painting) onApply(i); }}
            title={`${r.id}: ${m.label}`}
            className="w-11 py-1 rounded-md border text-center leading-tight transition-all"
            style={{ backgroundColor: m.color + '22', borderColor: m.color, opacity: dim ? 0.35 : 1 }}
          >
            <div className="text-[8px] text-slate-500 font-bold">{i + 1}</div>
            <div className="text-sm font-black text-slate-800">{charLabel ? charLabel(r) : r.char}</div>
            <div className="text-[10px] font-black" style={{ color: m.color }}>{l}</div>
          </button>
        );
      })}
    </div>
  );
};

// ================= CUSTOM TICKS / TOOLTIP =================
const CustomXTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomYTick1H = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value);
  const isInt = Number.isInteger(numVal);
  const isHalf = numVal % 0.5 === 0;
  const tickLength = isZoomed ? 5 : isInt ? 8 : isHalf ? 5 : 3;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isInt) && (
        <text x={-(tickLength + 4)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isInt && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(2) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomXTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 8 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={0} y2={tickLength} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={0} y={tickLength + 12} textAnchor="middle" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
          {isZoomed ? numVal.toFixed(1) : numVal}
        </text>
      )}
    </g>
  );
};
const CustomYTick13C = ({ x, y, payload, isZoomed }) => {
  const numVal = Number(payload.value);
  const isTen = numVal % 10 === 0;
  const tickLength = isZoomed ? 5 : isTen ? 10 : 4;
  return (
    <g transform={`translate(${x || 0},${y || 0})`}>
      <line x1={0} y1={0} x2={-tickLength} y2={0} stroke="#94a3b8" strokeWidth={1} />
      {(isZoomed || isTen) && (
        <text x={-(tickLength + 5)} y={0} dy={4} textAnchor="end" fill="#64748b" fontSize={isZoomed ? 10 : 11} fontWeight={isTen && !isZoomed ? 'bold' : 'normal'}>
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
          <p className="font-bold text-slate-800">
            {data.label}
            {isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}
          </p>
          <p className="text-slate-500">{data.x.toFixed(3)} ppm</p>
          {data.multiplet && <p className="text-slate-400 text-[10px]">Multiplicity: {data.multiplet}</p>}
        </div>
      );
    }
    return (
      <div className="bg-white p-3 border border-slate-200 shadow-xl rounded text-sm z-50">
        <p className="font-bold text-slate-800">
          {data.label}
          {isSel && <span style={{ color: SELECT_COLOR }}> ● selected</span>}
        </p>
        <p className="font-semibold" style={{ color: data.type === 'Diagonal' ? diagonalColor : getNMRFillColor(data) }}>
          {data.type}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          F2: {Number(data.x).toFixed(2)} ppm
          <br />
          F1: {Number(data.y).toFixed(2)} ppm
        </p>
      </div>
    );
  }
  return null;
};

// ================= RANGE CHART =================
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
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
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
            {row % 2 === 0 && (
              <rect x={margin.left} y={margin.top + row * rowH} width={plotW} height={rowH} fill="#f1f5f9" opacity={0.6} />
            )}
            <text x={margin.left - 8} y={yCenter(row)} textAnchor="end" dominantBaseline="middle" fontSize={11} fontWeight="bold" fill="#64748b">
              {label}
            </text>
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
            <rect
              key={`range-${i}`}
              x={x1}
              y={cy - 5}
              width={Math.max(2, x2 - x1)}
              height={10}
              rx={3}
              fill={r.color}
              fillOpacity={isHov ? 1 : 0.75}
              stroke={r.color}
              strokeWidth={1}
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
        <div
          className="absolute bg-white p-2 border border-slate-200 shadow-md rounded text-xs z-50 pointer-events-none whitespace-nowrap"
          style={{ left: hover.x + 12, top: Math.max(0, hover.y - 44) }}
        >
          <p className="font-bold text-slate-800">{ranges[hover.idx].res} - {ranges[hover.idx].atom}</p>
          <p className="text-slate-500">Theoretical Range: {ranges[hover.idx].min.toFixed(2)} - {ranges[hover.idx].max.toFixed(2)} ppm</p>
        </div>
      )}
    </div>
  );
};

// ================= ZOOMABLE PLOTS =================
const OneDSpectrumPlot = ({
  title, data, fullDomain, ticks, TickComponent, xLabel, panelId, expandedPanel, setExpandedPanel,
  selectedKeys, manualKeys = [], heightPx = 400
}) => {
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
  }, [refAreaLeft, refAreaRight]);
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
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div
        className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`}
        style={!isExpanded ? { height: `${heightPx}px` } : undefined}
      >
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && (
              <button onClick={() => setXDomain(fullDomain)} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded">
                Reset Zoom
              </button>
            )}
          </div>
          <button
            onClick={() => setExpandedPanel(isExpanded ? null : panelId)}
            className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5"
          >
            {isExpanded ? '↙️' : '↗️'}
          </button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={CHART_MARGIN_1D}>
              <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={false} stroke="#f1f5f9" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                allowDataOverflow
                reversed={true}
                ticks={isZoomed ? undefined : ticks}
                interval={0}
                tickLine={false}
                tick={<TickComponent isZoomed={isZoomed} />}
                label={{ value: xLabel, position: 'insideBottom', offset: -25, fill: '#64748b' }}
                axisLine={{ stroke: '#cbd5e1' }}
              />
              <YAxis type="number" dataKey="y" domain={[0, 'auto']} hide={true} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content={<NMRTooltip selectedKeys={selectedKeys} />} />
              <Bar
                dataKey="y"
                barSize={2}
                shape={(props) => {
                  const { x, y, width, height, payload } = props;
                  const centerX = x + width / 2;
                  const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                  const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                  const dimmed = selectedKeys && !isSel && !isMan;
                  return (
                    <line
                      x1={centerX}
                      y1={y + height}
                      x2={centerX}
                      y2={y}
                      stroke={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.color}
                      strokeWidth={isSel ? 3 : isMan ? 2.5 : 1.5}
                      opacity={dimmed ? 0.2 : 1}
                    />
                  );
                }}
                isAnimationActive={false}
              />
              {refAreaLeft !== null && refAreaRight !== null && (
                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill="#cbd5e1" />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

const SpectrumPlot = ({
  title, diagonalData, crossPeakData, expandedPanel, setExpandedPanel, panelId, diagonalColor,
  selectedKeys, manualKeys = [], heightPx = 400
}) => {
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
      y: yDomain[0] + fy * (yDomain[1] - yDomain[0])
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
      setRefAreaLeft(null);
      setRefAreaRight(null);
      setRefAreaTop(null);
      setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) {
      isDragging.current = true;
      setRefAreaLeft(coords.x);
      setRefAreaTop(coords.y);
      setRefAreaRight(coords.x);
      setRefAreaBottom(coords.y);
    }
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
        <circle
          cx={cx}
          cy={cy}
          r={isSel ? (payload.size || 5) + 2 : isMan ? (payload.size || 5) + 1.5 : payload.size || 5}
          fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : payload.type === 'Diagonal' ? fill : getNMRFillColor(payload)}
          stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'}
          strokeWidth={isSel ? 2 : isMan ? 1.5 : 0}
          opacity={0.85}
        />
      </g>
    );
  };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div
        className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid'}`}
        style={!isExpanded ? { height: `${heightPx}px` } : undefined}
      >
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && (
              <button
                onClick={() => { setXDomain([0, 11]); setYDomain([0, 11]); }}
                className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded"
              >
                Reset Zoom
              </button>
            )}
          </div>
          <button
            onClick={() => setExpandedPanel(isExpanded ? null : panelId)}
            className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5"
          >
            {isExpanded ? '↙️' : '↗️'}
          </button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                allowDataOverflow
                reversed={true}
                ticks={isZoomed ? undefined : TICKS_1H}
                interval={0}
                tickLine={false}
                tick={<CustomXTick1H isZoomed={isZoomed} />}
                label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                allowDataOverflow
                reversed={true}
                ticks={isZoomed ? undefined : TICKS_1H}
                interval={0}
                tickLine={false}
                tick={<CustomYTick1H isZoomed={isZoomed} />}
                label={{ value: '¹H F1 (ppm)', angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }}
              />
              <Tooltip content={<NMRTooltip diagonalColor={diagonalColor} selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter
                name="Diagonal"
                data={[{ x: 0, y: 0 }, { x: 11, y: 11 }]}
                line={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                shape={<circle r={0} />}
                legendType="none"
                isAnimationActive={false}
              />
              <Scatter data={diagonalData} fill={diagonalColor} shape={shape} isAnimationActive={false} />
              <Scatter data={crossPeakData} shape={shape} isAnimationActive={false} />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && (
                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

const HSQCPlot = ({
  title, crossPeakData, expandedPanel, setExpandedPanel, panelId, selectedKeys, manualKeys = [],
  yAxisLabel = '¹³C F1 (ppm)', yDomainInit = [10, 150], yTicks = TICKS_13C, heightPx = 400
}) => {
  const isExpanded = expandedPanel === panelId;
  const [xDomain, setXDomain] = useState([0, 11]);
  const [yDomain, setYDomain] = useState(yDomainInit);
  const [refAreaLeft, setRefAreaLeft] = useState(null);
  const [refAreaRight, setRefAreaRight] = useState(null);
  const [refAreaTop, setRefAreaTop] = useState(null);
  const [refAreaBottom, setRefAreaBottom] = useState(null);
  const chartRef = useRef(null);
  const isDragging = useRef(false);
  const isZoomed =
    xDomain[0] !== 0 || xDomain[1] !== 11 || yDomain[0] !== yDomainInit[0] || yDomain[1] !== yDomainInit[1];
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
      y: yDomain[0] + fy * (yDomain[1] - yDomain[0])
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
      setRefAreaLeft(null);
      setRefAreaRight(null);
      setRefAreaTop(null);
      setRefAreaBottom(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [refAreaLeft, refAreaRight, refAreaTop, refAreaBottom]);
  const handleMouseDown = (e) => {
    const coords = getPlotCoords(e.clientX, e.clientY);
    if (coords) {
      isDragging.current = true;
      setRefAreaLeft(coords.x);
      setRefAreaTop(coords.y);
      setRefAreaRight(coords.x);
      setRefAreaBottom(coords.y);
    }
  };
  return (
    <>
      {isExpanded && <div className={OVERLAY_CLASSES} onClick={() => setExpandedPanel(null)} />}
      <div
        className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col ${isExpanded ? FS_CLASSES + ' p-6' : 'break-inside-avoid lg:col-span-2'}`}
        style={!isExpanded ? { height: `${heightPx}px` } : undefined}
      >
        <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-slate-700">{title}</h4>
            {isZoomed && (
              <button
                onClick={() => { setXDomain([0, 11]); setYDomain(yDomainInit); }}
                className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded"
              >
                Reset Zoom
              </button>
            )}
          </div>
          <button
            onClick={() => setExpandedPanel(isExpanded ? null : panelId)}
            className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded p-1.5"
          >
            {isExpanded ? '↙️' : '↗️'}
          </button>
        </div>
        <div className="flex-1 min-h-0 select-none relative" ref={chartRef} onMouseDown={handleMouseDown}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                allowDataOverflow
                reversed={true}
                ticks={isZoomed ? undefined : TICKS_1H}
                interval={0}
                tickLine={false}
                tick={<CustomXTick1H isZoomed={isZoomed} />}
                label={{ value: '¹H F2 (ppm)', position: 'insideBottom', offset: -25, fill: '#64748b' }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                allowDataOverflow
                reversed={true}
                ticks={isZoomed ? undefined : yTicks}
                interval={0}
                tickLine={false}
                tick={<CustomYTick13C isZoomed={isZoomed} />}
                label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', offset: -20, fill: '#64748b' }}
              />
              <Tooltip content={<NMRTooltip diagonalColor="#8b5cf6" selectedKeys={selectedKeys} />} cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }} />
              <Scatter
                data={crossPeakData}
                shape={(props) => {
                  const { cx, cy, payload } = props;
                  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                  const isSel = selectedKeys && payload.keys && payload.keys.some((k) => selectedKeys.includes(k));
                  const isMan = manualKeys && payload.keys && payload.keys.some((k) => manualKeys.includes(k));
                  const dimmed = selectedKeys && !isSel && !isMan;
                  return (
                    <g opacity={dimmed ? 0.18 : 1}>
                      {isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={SELECT_COLOR} opacity={0.3} />}
                      {isMan && !isSel && <circle cx={cx} cy={cy} r={(payload.size || 5) + 5} fill={MANUAL_COLOR} opacity={0.22} />}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isSel ? (payload.size || 5) + 2 : isMan ? (payload.size || 5) + 1.5 : payload.size || 5}
                        fill={isSel ? SELECT_COLOR : isMan ? MANUAL_COLOR : getNMRFillColor(payload)}
                        stroke={isSel ? '#b45309' : isMan ? '#166534' : 'none'}
                        strokeWidth={isSel ? 2 : isMan ? 1.5 : 0}
                        opacity={0.85}
                      />
                    </g>
                  );
                }}
                isAnimationActive={false}
              />
              {refAreaLeft !== null && refAreaRight !== null && refAreaTop !== null && refAreaBottom !== null && (
                <ReferenceArea x1={refAreaLeft} x2={refAreaRight} y1={refAreaTop} y2={refAreaBottom} strokeOpacity={0.3} fill="#cbd5e1" />
              )}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

// ============================================================================
// SHARED DERIVED DATA HOOK
// ============================================================================
const useNmrDerived = (activeTest) => {
  const moleculeType = activeTest.moleculeType || 'protein';
  const rawSeq = (activeTest.proteinSequence || '').toUpperCase();
  const validChars =
    moleculeType === 'protein'
      ? 'ACDEFGHIKLMNPQRSTVWY'
      : moleculeType === 'dna'
        ? 'ACGT'
        : moleculeType === 'rna'
          ? 'ACGU'
          : '';
  const seq =
    moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna'
      ? rawSeq.replace(new RegExp(`[^${validChars}]`, 'g'), '')
      : '';
  const selNuc = activeTest.selectedNuclei || ['H', 'N', 'C'];
  const shifts = activeTest.chemicalShifts || {};
  const images = activeTest.nmrSpectraImages || [];
  const isPolymer = moleculeType === 'protein' || moleculeType === 'dna' || moleculeType === 'rna';
  const hasPhosphorus = moleculeType === 'dna' || moleculeType === 'rna' || moleculeType === 'lipid';
  const DB =
    moleculeType === 'protein'
      ? AMINO_ACID_DB
      : moleculeType === 'dna'
        ? NUCLEOTIDE_DB.DNA
        : moleculeType === 'rna'
          ? NUCLEOTIDE_DB.RNA
          : moleculeType === 'sugar'
            ? SUGAR_DB
            : LIPID_DB;
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
            : 'Phospholipid';
  const nucDefs =
    moleculeType === 'protein'
      ? { H: ['HN', 'Hα', 'Hβ'], N: ['N'], C: ['Cα', 'Cβ', "C'"] }
      : moleculeType === 'dna' || moleculeType === 'rna'
        ? { H: ["H1'", "H2'", "H3'"], N: [], C: ["C1'", "C2'", "C3'"] }
        : { H: [], N: [], C: [] };

  const parsedSeq = useMemo(() => {
    let chars = [];
    if (isPolymer) {
      if (!seq) return [];
      chars = seq.split('');
    } else if (moleculeType === 'sugar') {
      chars = [activeTest.sugarChoice || 'GLC'];
    } else if (moleculeType === 'lipid') {
      chars = [activeTest.lipidChoice || 'POPC'];
    }
    const assignedShifts = [];
    return chars
      .map((char, index) => {
        const entry = DB[char];
        if (!entry) return null;
        const generatedShifts = {};
        Object.keys(entry.ranges).forEach((atom) => {
          const r = entry.ranges[atom];
          let val = r.min;
          let success = false;
          let minDistance = 0.3;
          while (minDistance >= 0.05 && !success) {
            for (let i = 0; i < 50; i++) {
              const candidate = r.min + Math.random() * (r.max - r.min);
              if (!assignedShifts.some((a) => Math.abs(a - candidate) < minDistance)) {
                val = candidate;
                success = true;
                break;
              }
            }
            minDistance -= 0.05;
          }
          assignedShifts.push(val);
          generatedShifts[atom] = parseFloat(val.toFixed(2));
        });
        const cShifts = {};
        const generatedShifts13C = {};
        Object.keys(generatedShifts).forEach((atom) => {
          const cName = getCarbonName(moleculeType, char, atom);
          if (!cName) return;
          if (!cShifts[cName]) {
            const range = getCarbonRangeFor(moleculeType, char, cName);
            cShifts[cName] = parseFloat((range.min + Math.random() * (range.max - range.min)).toFixed(1));
          }
          generatedShifts13C[atom] = cShifts[cName];
        });
        const backboneRand =
          moleculeType === 'protein'
            ? {
                N: parseFloat((117 + Math.random() * 8).toFixed(1)),
                CP: parseFloat((172 + Math.random() * 5).toFixed(1))
              }
            : null;
        const p31 = hasPhosphorus ? parseFloat((-2 + Math.random() * 3).toFixed(2)) : null;
        return {
          ...entry,
          id: `${entry.code3 || char}${index + 1}`,
          char,
          color: RESIDUE_COLORS[index % RESIDUE_COLORS.length],
          shifts: generatedShifts,
          shifts13C: generatedShifts13C,
          uniqueCShifts: { ...cShifts },
          backboneRand,
          p31
        };
      })
      .filter(Boolean);
  }, [seq, moleculeType, activeTest.sugarChoice, activeTest.lipidChoice]);

  const estSeq = useMemo(
    () =>
      parsedSeq.map((res, idx) => {
        const ssLetter = moleculeType === 'protein' ? getSSAt(idx) : 'C';
        const ssKey = { C: 'coil', H: 'helix', E: 'sheet' }[ssLetter];
        const corr = SS_CORRECTIONS[ssKey];
        const estShifts = {};
        Object.keys(res.shifts || {}).forEach((a) => {
          let v = res.shifts[a];
          if (moleculeType === 'protein' && ssKey !== 'coil') {
            const h = corr.h;
            v += h[a] !== undefined ? h[a] : h.other || 0;
          }
          if (moleculeType === 'dna' || moleculeType === 'rna') {
            const f = getFormAt(idx);
            if (DNA_FORM_OFFSETS[f] && DNA_FORM_OFFSETS[f][a] !== undefined) v += DNA_FORM_OFFSETS[f][a];
          }
          if (moleculeType === 'sugar') {
            const off = SUGAR_ANOMER_OFFSETS[sugarAnomer];
            if (off && off[a] !== undefined) v += off[a];
          }
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
        let estN = null;
        let estCP = null;
        if (moleculeType === 'protein' && res.backboneRand) {
          estN = +(res.backboneRand.N + (ssKey !== 'coil' ? corr.c['N'] || 0 : 0)).toFixed(2);
          estCP = +(res.backboneRand.CP + (ssKey !== 'coil' ? corr.c["C'"] || 0 : 0)).toFixed(2);
        }
        return { ...res, estShifts, estUniqueC, estShifts13C, estN, estCP, ssLetter, formLetter: getFormAt(idx) };
      }),
    [parsedSeq, moleculeType, ssRaw, formsRaw, dnaFormDefault, sugarAnomer]
  );

  const simSeq = useMemo(() => {
    const getMan = (idx, name) => {
      const candidates = [
        `${idx}-${name}`,
        `${idx}-${String(name).trim()}`,
        `${idx}-${String(name).replace(/\s+/g, '')}`
      ];
      for (const k of candidates) {
        const m = parseManual(shifts[k]);
        if (m !== null) return m;
      }
      return null;
    };
    return estSeq.map((res, idx) => {
      const simShifts = {};
      Object.keys(res.estShifts || {}).forEach((a) => {
        const m = getMan(idx, a);
        simShifts[a] = m !== null ? m : res.estShifts[a];
      });
      const simUniqueC = {};
      Object.keys(res.estUniqueC || {}).forEach((cn) => {
        const m = getMan(idx, cn);
        simUniqueC[cn] = m !== null ? m : res.estUniqueC[cn];
      });
      const simShifts13C = {};
      Object.keys(res.estShifts13C || {}).forEach((a) => {
        const cn = getCarbonName(moleculeType, res.char, a);
        if (cn) simShifts13C[a] = simUniqueC[cn];
      });
      // simulated backbone 15N (protein), manual override via `${idx}-N`
      let simN = null;
      if (moleculeType === 'protein' && res.estN !== null && res.estN !== undefined) {
        const mN = getMan(idx, 'N');
        simN = mN !== null ? mN : res.estN;
      }
      let simCP = null;
      if (moleculeType === 'protein' && res.estCP !== null && res.estCP !== undefined) {
        const mCP = getMan(idx, "C'");
        simCP = mCP !== null ? mCP : res.estCP;
      }
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
    let diag = [];
    let cosy = [];
    let tocsy = [];
    let noesy = [];
    let hsqc = [];
    let hsqc15n = [];
    let d1H = [];
    let d13C = [];
    let p31 = [];
    const addPair = (arr, x, y, label, type, colorClass, size, keys) => {
      arr.push({ x, y, label, type, colorClass, size, keys });
      arr.push({ x: y, y: x, label, type, colorClass, size, keys });
    };
    simSeq.forEach((res, index) => {
      if (!res.simShifts) return;
      Object.entries(res.simShifts).forEach(([atom, ppm]) => {
        let pks = [{ shift: ppm, intensity: 1 }];
        let totalNeighbors = 0;
        if (res.cosy) {
          res.cosy.forEach((pair) => {
            const neighborAtom = pair[0] === atom ? pair[1] : pair[1] === atom ? pair[0] : null;
            if (neighborAtom) {
              const count = getProtonCountEx(moleculeType, res, neighborAtom);
              totalNeighbors += count;
              const jC = 0.01 + Math.random() * 0.008;
              const pascalRow = getPascalRow(count);
              let newPeaks = [];
              pks.forEach((p) => {
                for (let k = 0; k <= count; k++) {
                  newPeaks.push({ shift: p.shift + (k - count / 2) * jC, intensity: p.intensity * pascalRow[k] });
                }
              });
              pks = newPeaks;
            }
          });
        }
        let merged = [];
        pks.sort((a, b) => a.shift - b.shift);
        pks.forEach((p) => {
          if (merged.length > 0) {
            const last = merged[merged.length - 1];
            if (Math.abs(last.shift - p.shift) < 0.002) {
              last.shift = (last.shift * last.intensity + p.shift * p.intensity) / (last.intensity + p.intensity);
              last.intensity += p.intensity;
            } else {
              merged.push({ ...p });
            }
          } else {
            merged.push({ ...p });
          }
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
        merged.forEach((p) =>
          d1H.push({
            x: p.shift,
            y: (p.intensity / maxIntensity) * baseIntensity,
            label: `${res.id} ${atom}`,
            color: res.color,
            type: '1D',
            multiplet: multStr,
            keys
          })
        );
      });
      Object.entries(res.simUniqueC || {}).forEach(([cName, ppm]) => {
        d13C.push({
          x: ppm,
          y: 0.8 + Math.random() * 0.4,
          label: `${res.id} ${cName}`,
          color: res.color,
          type: '1D',
          keys: [`${index}-${cName}`]
        });
      });
      if (moleculeType === 'protein' && res.simCP !== null && res.simCP !== undefined) {
        d13C.push({
          x: res.simCP,
          y: 0.8 + Math.random() * 0.4,
          label: `${res.id} C'`,
          color: res.color,
          type: '1D',
          keys: [`${index}-C'`]
        });
      }
      Object.keys(res.simShifts).forEach((atom) => {
        diag.push({
          x: res.simShifts[atom],
          y: res.simShifts[atom],
          label: `${res.id} ${atom}`,
          type: 'Diagonal',
          size: 4,
          keys: buildKeys(index, [atom], moleculeType, res.char)
        });
      });
      if (res.cosy) {
        res.cosy.forEach(([a1, a2]) => {
          if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) {
            addPair(cosy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (COSY)`, 'cosy', 4, buildKeys(index, [a1, a2], moleculeType, res.char));
          }
        });
      }
      if (res.spinSystems) {
        res.spinSystems.forEach((sys) => {
          for (let i = 0; i < sys.length; i++) {
            for (let j = i + 1; j < sys.length; j++) {
              if (res.simShifts[sys[i]] !== undefined && res.simShifts[sys[j]] !== undefined) {
                const isDirect =
                  res.cosy &&
                  res.cosy.some((c) => (c[0] === sys[i] && c[1] === sys[j]) || (c[0] === sys[j] && c[1] === sys[i]));
                addPair(
                  tocsy,
                  res.simShifts[sys[i]],
                  res.simShifts[sys[j]],
                  res.id,
                  `${sys[i]}-${sys[j]} (${isDirect ? 'Direct' : 'Relay'})`,
                  isDirect ? 'tocsyDirect' : 'tocsyRelay',
                  4,
                  buildKeys(index, [sys[i], sys[j]], moleculeType, res.char)
                );
              }
            }
          }
        });
      }
      const adj = {};
      if (res.cosy) {
        res.cosy.forEach(([u, v]) => {
          if (!adj[u]) adj[u] = [];
          if (!adj[v]) adj[v] = [];
          adj[u].push(v);
          adj[v].push(u);
        });
      }
      const seenPairs = new Set();
      if (res.cosy) {
        res.cosy.forEach(([a1, a2]) => {
          seenPairs.add([a1, a2].sort().join('-'));
          if (res.simShifts[a1] !== undefined && res.simShifts[a2] !== undefined) {
            addPair(noesy, res.simShifts[a1], res.simShifts[a2], res.id, `${a1}-${a2} (NOE Intra)`, 'noesyIntra', 4, buildKeys(index, [a1, a2], moleculeType, res.char));
          }
        });
      }
      Object.keys(adj).forEach((u) => {
        adj[u].forEach((v) => {
          adj[v].forEach((w) => {
            if (u !== w) {
              const pk = [u, w].sort().join('-');
              if (!seenPairs.has(pk)) {
                seenPairs.add(pk);
                if (res.simShifts[u] !== undefined && res.simShifts[w] !== undefined) {
                  addPair(noesy, res.simShifts[u], res.simShifts[w], res.id, `${u}-${w} (NOE 4-bond)`, 'noesyIntra4', 3, buildKeys(index, [u, w], moleculeType, res.char));
                }
              }
            }
          });
        });
      });
      if (index < simSeq.length - 1 && moleculeType === 'protein') {
        const nextRes = simSeq[index + 1];
        if (res.simShifts['HN'] !== undefined && nextRes.simShifts['HN'] !== undefined) {
          addPair(
            noesy,
            res.simShifts['HN'],
            nextRes.simShifts['HN'],
            'Seq. NOE',
            `${res.id} HN ↔ ${nextRes.id} HN`,
            'noesySeq',
            3,
            [...buildKeys(index, ['HN'], 'protein', res.char), ...buildKeys(index + 1, ['HN'], 'protein', nextRes.char)]
          );
        }
      }
      Object.keys(res.simShifts13C || {}).forEach((atom) => {
        if (res.simShifts[atom] !== undefined) {
          const cn = getCarbonName(moleculeType, res.char, atom);
          hsqc.push({
            x: res.simShifts[atom],
            y: res.simShifts13C[atom],
            label: `${res.id} ${atom}-${cn}`,
            type: 'HSQC',
            colorClass: 'hsqc',
            size: 4,
            keys: [...buildKeys(index, [atom], moleculeType, res.char), `${index}-${cn}`]
          });
        }
      });
      // ---------- 1H-15N HSQC (protein backbone amides) ----------
      if (
        moleculeType === 'protein' &&
        res.simN !== null && res.simN !== undefined &&
        res.simShifts['HN'] !== undefined
      ) {
        hsqc15n.push({
          x: res.simShifts['HN'],
          y: res.simN,
          label: `${res.id} HN-N`,
          type: 'HSQC',
          colorClass: 'hsqc15n',
          size: 4,
          keys: [...buildKeys(index, ['HN'], moleculeType, res.char), `${index}-N`]
        });
      }
      if (hasPhosphorus && res.p31 !== null) {
        p31.push({
          x: res.p31,
          y: 0.8 + Math.random() * 0.4,
          label: `${res.id} P`,
          color: res.color,
          type: '1D',
          colorClass: 'p31',
          keys: [`${index}-P`]
        });
      }
    });
    return {
      diagonalData: diag,
      cosyPeaks: cosy,
      tocsyPeaks: tocsy,
      noesyPeaks: noesy,
      hsqcPeaks: hsqc,
      hsqc15NPeaks: hsqc15n,
      data1H: d1H,
      data13C: d13C,
      p31Data: p31
    };
  }, [simSeq, moleculeType, hasPhosphorus]);

  const uniqueTypes = useMemo(() => [...new Set(parsedSeq.map((r) => r.char))], [parsedSeq]);
  const ranges = useMemo(() => {
    const r1 = [];
    const r13 = [];
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
      Object.keys(db.ranges).forEach((atom) => {
        const cn = getCarbonName(moleculeType, char, atom);
        if (cn) cNames.add(cn);
      });
      if (moleculeType === 'protein') cNames.add("C'");
      let cIdx = 0;
      cNames.forEach((cn) => {
        const rg = getCarbonRangeFor(moleculeType, char, cn);
        r13.push({ x: (rg.min + rg.max) / 2, res: label, atom: cn, min: rg.min, max: rg.max, y, color, level: cIdx++ });
      });
    });
    return { ranges1H: r1, ranges13C: r13 };
  }, [uniqueTypes, moleculeType]);

  return {
    moleculeType, seq, validChars, isPolymer, hasPhosphorus, DB, selNuc, shifts, images,
    getSSAt, getFormAt, sugarConf, sugarAnomer, lipidDB, dnaFormDefault, typeLabel, nucDefs,
    parsedSeq, estSeq, simSeq, structure, peaks, uniqueTypes, ranges
  };
};

// ============================================================================
// SECTION COMPONENTS (rendered by TestShellRenderer)
// ============================================================================

// ================= TOOLBAR (CSV export) =================
export const Toolbar = ({ ctx }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest);
  const exportCSV = () => {
    const rows = [['Residue', 'Nucleus', 'Atom', 'Manual Shift (ppm)', 'Estimated (ppm)']];
    d.estSeq.forEach((res, idx) => {
      if (d.selNuc.includes('H')) {
        Object.keys(res.estShifts || {}).forEach((a) => {
          rows.push([res.id, '1H', a, d.shifts[`${idx}-${a}`] || '', res.estShifts[a]]);
        });
      }
      if (d.moleculeType === 'protein') {
        if (d.selNuc.includes('N') && res.estN !== null) rows.push([res.id, '15N', 'N', d.shifts[`${idx}-N`] || '', res.estN]);
        if (d.selNuc.includes('C')) {
          Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([res.id, '13C', cn, d.shifts[`${idx}-${cn}`] || '', res.estUniqueC[cn]]));
          if (res.estCP !== null) rows.push([res.id, '13C', "C'", d.shifts[`${idx}-C'`] || '', res.estCP]);
        }
      } else if (d.selNuc.includes('C')) {
        Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push([res.id, '13C', cn, d.shifts[`${idx}-${cn}`] || '', res.estUniqueC[cn]]));
      }
      if (d.hasPhosphorus && d.selNuc.includes('P') && res.p31 !== null) rows.push([res.id, '31P', 'P', d.shifts[`${idx}-P`] || '', res.p31]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nmr_assignment.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-2 flex items-center justify-end gap-3 shrink-0 z-10 shadow-sm no-print">
      <button
        onClick={exportCSV}
        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded text-xs flex items-center gap-1 shadow-sm transition-colors"
      >
        ⬇ Export CSV (Excel/Sheets)
      </button>
    </div>
  );
};

// ================= COMPOUNDS (molecule definition + sequence + painting + 2D formula) =================
// Rendered by TestShellRenderer inside "Compounds & Biological Models" via custom.Compounds.
export const Compounds = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [focusIdx, setFocusIdx] = useState('ALL');
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
    const html =
      `<div style="margin-top:10px;"><h5 style="color:#1e40af;font-size:12px;margin-bottom:6px;">🔬 Chemical Formula (${d.typeLabel}):</h5>` +
      elementsToSVG(d.structure, 300) +
      `</div>`;
    const currentComments = activeTest.comments || '';
    updateActiveTest({ comments: currentComments + (currentComments ? '<br/>' : '') + html });
    alert('Chemical formula appended to the Lab Notebook notes.');
  };

  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
        🧬 Molecule Definition & Chemical Formula
      </h4>
      <div className="flex flex-wrap gap-2 mb-2">
        {[
          ['protein', '🧬 Protein'],
          ['dna', '🧬 DNA'],
          ['rna', '🧬 RNA'],
          ['sugar', '🍬 Sugars'],
          ['lipid', '🫧 Phospholipids']
        ].map(([val, lab]) => (
          <button
            key={val}
            onClick={() => updateActiveTest({ moleculeType: val })}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${d.moleculeType === val ? 'bg-blue-600 border-blue-700 text-white shadow' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            {lab}
          </button>
        ))}
      </div>
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 w-full">
          {d.isPolymer ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                {d.typeLabel} Sequence (1-letter code)
              </label>
              <textarea
                value={activeTest.proteinSequence || ''}
                onChange={(e) => updateActiveTest({ proteinSequence: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-3 font-mono text-sm tracking-widest outline-none focus:border-blue-500 uppercase h-24 custom-scrollbar shadow-inner"
                placeholder={
                  d.moleculeType === 'protein' ? 'e.g. MKWVTFISLL...' : d.moleculeType === 'dna' ? 'e.g. ATGCGTAC...' : 'e.g. AUGCGUAC...'
                }
              />
              <p className="text-[10px] text-slate-400 mt-1 font-bold">
                Length: {d.seq.length} {d.moleculeType === 'protein' ? 'residues' : 'nucleotides'} (valid: {d.validChars.split('').join(' ')})
              </p>
            </>
          ) : d.moleculeType === 'sugar' ? (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Sugar</label>
              <select
                value={activeTest.sugarChoice || 'GLC'}
                onChange={(e) => updateActiveTest({ sugarChoice: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                {Object.entries(SUGAR_DB).map(([k, v]) => (
                  <option key={k} value={k}>{v.name} ({v.code3})</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Select Phospholipid</label>
              <select
                value={activeTest.lipidChoice || 'POPC'}
                onChange={(e) => updateActiveTest({ lipidChoice: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold"
              >
                {Object.entries(LIPID_DB).map(([k, v]) => (
                  <option key={k} value={k}>{k} — {v.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="w-full md:w-64 flex flex-col gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Target Nuclei</label>
            <div className="flex flex-col gap-2">
              {['H', 'N', 'C', ...(d.hasPhosphorus ? ['P'] : [])].map((n) => (
                <label
                  key={n}
                  className="flex items-center gap-3 cursor-pointer bg-white border border-slate-200 p-2 rounded shadow-sm hover:border-blue-300 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={d.selNuc.includes(n)}
                    onChange={() =>
                      updateActiveTest({
                        selectedNuclei: d.selNuc.includes(n) ? d.selNuc.filter((x) => x !== n) : [...d.selNuc, n]
                      })
                    }
                    className="w-4 h-4 cursor-pointer accent-blue-600"
                  />
                  <span className="font-bold text-slate-700">
                    {n === 'H' ? '¹H' : n === 'N' ? '¹⁵N' : n === 'C' ? '¹³C' : '³¹P'}
                  </span>
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
              <button
                key={l}
                onClick={() => setSSBrush(l)}
                className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{
                  backgroundColor: ssBrush === l ? SS_META[l].color : 'white',
                  borderColor: SS_META[l].color,
                  color: ssBrush === l ? 'white' : SS_META[l].color
                }}
              >
                {SS_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllSS('C')} className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 border border-slate-300 text-slate-600 hover:bg-slate-200">All Coil</button>
            <button onClick={() => setAllSS('H')} className="px-3 py-1 rounded-lg text-xs font-bold bg-violet-100 border border-violet-300 text-violet-700 hover:bg-violet-200">All α-Helix</button>
            <button onClick={() => setAllSS('E')} className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-300 text-amber-700 hover:bg-amber-200">All β-Sheet</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            💡 Select a brush, then click or drag across the sequence chips to paint secondary structure.
          </p>
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
              <button
                key={l}
                onClick={() => setFormBrush(l)}
                className="px-3 py-1 rounded-lg text-xs font-black border transition-all"
                style={{
                  backgroundColor: formBrush === l ? FORM_META[l].color : 'white',
                  borderColor: FORM_META[l].color,
                  color: formBrush === l ? 'white' : FORM_META[l].color
                }}
              >
                {FORM_META[l].label}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <button onClick={() => setAllForms('A')} className="px-3 py-1 rounded-lg text-xs font-bold bg-sky-100 border border-sky-300 text-sky-700 hover:bg-sky-200">All A</button>
            <button onClick={() => setAllForms('B')} className="px-3 py-1 rounded-lg text-xs font-bold bg-green-100 border border-green-300 text-green-700 hover:bg-green-200">All B</button>
            <button onClick={() => setAllForms('Z')} className="px-3 py-1 rounded-lg text-xs font-bold bg-rose-100 border border-rose-300 text-rose-700 hover:bg-rose-200">All Z</button>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            💡 Select a brush, then click or drag across the sequence chips to paint the nucleic acid form per residue.
          </p>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={(i) => d.getFormAt(i)}
            meta={FORM_META}
            onApply={(i) => paintFormAt(i, formBrush)}
            focusIdx={focusIdx}
          />
        </div>
      )}
      {d.moleculeType === 'sugar' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Anomer brush:</span>
            {[['alpha', 'α-anomer', '#0ea5e9'], ['beta', 'β-anomer', '#f97316']].map(([val, lab, col]) => (
              <button
                key={val}
                onClick={() => setSugarBrushAnomer(val)}
                className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: sugarBrushAnomer === val ? col : 'white', borderColor: col, color: sugarBrushAnomer === val ? 'white' : col }}
              >
                {lab}
              </button>
            ))}
            <span className="mx-2 text-slate-300">|</span>
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">Chair brush:</span>
            {[['chair', 'Chair (⁴C₁)', '#22c55e'], ['invChair', 'Inverted chair (¹C₄)', '#a855f7']].map(([val, lab, col]) => (
              <button
                key={val}
                onClick={() => setSugarBrushConf(val)}
                className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: sugarBrushConf === val ? col : 'white', borderColor: col, color: sugarBrushConf === val ? 'white' : col }}
              >
                {lab}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-3">
            💡 Select the anomer brush (α/β) and the ring-conformation brush, then click the sugar chip to apply.
          </p>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={() => (d.sugarAnomer === 'beta' ? 'β' : 'α')}
            meta={{ β: { label: 'β-anomer', color: '#f97316' }, α: { label: 'α-anomer', color: '#0ea5e9' } }}
            onApply={() => updateActiveTest({ sugarAnomer: sugarBrushAnomer, sugarConf: sugarBrushConf })}
            focusIdx={focusIdx}
            charLabel={(r) => r.code3 || r.char}
          />
        </div>
      )}
      {d.moleculeType === 'lipid' && d.parsedSeq.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1">🖌️ Brush:</span>
            {[['cis', 'cis Δ9', '#0ea5e9'], ['trans', 'trans Δ9', '#f43f5e']].map(([val, lab, col]) => (
              <button
                key={val}
                onClick={() => setLipidBrush(val)}
                className="px-3 py-1 rounded-lg text-xs font-black border"
                style={{ backgroundColor: lipidBrush === val ? col : 'white', borderColor: col, color: lipidBrush === val ? 'white' : col }}
              >
                {lab}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-3">
            💡 Select the cis/trans brush, then click the lipid chip to set the geometry of the Δ9 double bond.
          </p>
          <SequencePaintStrip
            residues={d.parsedSeq}
            getLetter={() => d.lipidDB}
            meta={{ cis: { label: 'cis Δ9', color: '#0ea5e9' }, trans: { label: 'trans Δ9', color: '#f43f5e' } }}
            onApply={() => updateActiveTest({ lipidDB: lipidBrush })}
            focusIdx={focusIdx}
            charLabel={(r) => r.char}
          />
        </div>
      )}

      {d.structure && (
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2 justify-end">
            <label className="text-[10px] font-bold text-slate-500 uppercase">🔍 Focus</label>
            <select
              value={focusIdx}
              onChange={(e) => setFocusIdx(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 max-w-[180px]"
            >
              <option value="ALL">All residues</option>
              {d.parsedSeq.map((r, i) => (
                <option key={i} value={i}>{r.id} — {r.name}</option>
              ))}
            </select>
            {selectedKeys && (
              <button
                onClick={() => updateActiveTest({ selectedAtomKeys: [] })}
                className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-100 border border-amber-400 text-amber-800"
              >
                ✖ Deselect ({selectionLabel(d, selectedKeys)})
              </button>
            )}
            <button
              onClick={exportFormulaToNotebook}
              className="px-2 py-1 rounded-lg text-xs font-bold bg-indigo-50 border border-indigo-300 text-indigo-700 hover:bg-indigo-100"
              title="Append this formula (SVG) to the Lab Notebook notes"
            >
              📓 Formula → Notebook
            </button>
          </div>
          <p className="text-xs text-slate-400 mb-2">
            💡 Click an atom in the formula to highlight its cell in the assignment table and its peaks in the spectra.
          </p>
          <StructureSVGView
            structure={d.structure}
            minWidth={
              d.moleculeType === 'protein' && d.parsedSeq.length > 3 ? `${d.parsedSeq.length * 120}px` : '100%'
            }
            isExpanded={expandedPanel === 'formula'}
            onToggleExpand={() => setExpandedPanel(expandedPanel === 'formula' ? null : 'formula')}
            selectedKeys={selectedKeys}
            manualKeys={manualKeys}
            onAtomClick={handleAtomClick}
            height={d.moleculeType === 'dna' || d.moleculeType === 'rna' ? `${Math.max(360, d.parsedSeq.length * 250 + 120)}px` : '300px'}
          />
        </div>
      )}
    </div>
  );
};

// ================= DATA (theoretical ranges + assignment table) =================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [tableMode, setTableMode] = useState(activeTest.tableMode || 'backbone');
  const [focusIdx, setFocusIdx] = useState('ALL');
  const effTableMode = d.moleculeType === 'sugar' || d.moleculeType === 'lipid' ? 'all' : tableMode;

  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);

  const handleShiftChange = (resIdx, atom, val) => {
    updateActiveTest({ chemicalShifts: { ...d.shifts, [`${resIdx}-${atom}`]: val } });
  };
  const handleCellClick = (e, idx, atom) => {
    if (e && e.target && e.target.tagName === 'INPUT') return;
    const keys = buildKeys(idx, [atom], d.moleculeType, d.parsedSeq[idx]?.char);
    const cur = getSelectedKeys(activeTest);
    if (cur && cur.join('|') === keys.join('|')) updateActiveTest({ selectedAtomKeys: [] });
    else updateActiveTest({ selectedAtomKeys: keys });
  };
  const cellIsSelected = (idx, atom) => Boolean(selectedKeys && selectedKeys.includes(`${idx}-${atom}`));

  const fillEstimated = () => {
    const newShifts = { ...d.shifts };
    d.estSeq.forEach((res, idx) => {
      Object.entries(res.estShifts || {}).forEach(([a, v]) => { newShifts[`${idx}-${a}`] = String(v); });
      Object.entries(res.estUniqueC || {}).forEach(([cn, v]) => { newShifts[`${idx}-${cn}`] = String(v); });
      if (res.estN !== null) newShifts[`${idx}-N`] = String(res.estN);
      if (res.estCP !== null) newShifts[`${idx}-C'`] = String(res.estCP);
    });
    updateActiveTest({ chemicalShifts: newShifts });
  };

  const selTdCls = (isMan, isSel) =>
    `px-3 py-1 cursor-pointer transition-colors ${isSel ? 'bg-amber-100 ring-2 ring-inset ring-amber-400' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-widest">📊 NMR Data — Ranges & Assignment</h4>
        {selectedKeys && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 text-xs font-bold text-amber-800">
            🎯 Selected: {selectionLabel(d, selectedKeys)}
            <button
              onClick={() => updateActiveTest({ selectedAtomKeys: [] })}
              className="ml-1 text-amber-600 hover:text-red-600 font-black"
              title="Clear selection"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {d.uniqueTypes.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          <RangeBarChart
            title="Theoretical ¹H Ranges"
            ranges={d.ranges.ranges1H}
            domain={[0, 11]}
            ticks={Array.from({ length: 12 }, (_, i) => i)}
            xAxisLabel="¹H (ppm)"
            rowCount={d.uniqueTypes.length}
            rowLabels={d.uniqueTypes.map((c) => d.DB[c]?.code3 || c)}
          />
          <RangeBarChart
            title="Theoretical ¹³C Ranges"
            ranges={d.ranges.ranges13C}
            domain={[0, 190]}
            ticks={Array.from({ length: 20 }, (_, i) => i * 10)}
            xAxisLabel="¹³C (ppm)"
            rowCount={d.uniqueTypes.length}
            rowLabels={d.uniqueTypes.map((c) => d.DB[c]?.code3 || c)}
          />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {d.parsedSeq.length > 0 && d.moleculeType !== 'sugar' && d.moleculeType !== 'lipid' && (
          <div className="flex bg-slate-200 p-1 rounded-lg">
            <button
              onClick={() => { setTableMode('backbone'); updateActiveTest({ tableMode: 'backbone' }); }}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${effTableMode === 'backbone' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Backbone
            </button>
            <button
              onClick={() => { setTableMode('all'); updateActiveTest({ tableMode: 'all' }); }}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${effTableMode === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All Atoms
            </button>
            <button
              onClick={() => { setTableMode('unified'); updateActiveTest({ tableMode: 'unified' }); }}
              className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${effTableMode === 'unified' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Unified
            </button>
          </div>
        )}
        <button
          onClick={fillEstimated}
          className="px-2 py-1 rounded-lg text-xs font-bold bg-blue-50 border border-blue-300 text-blue-700 hover:bg-blue-100"
        >
          🪄 Fill with estimated
        </button>
        <button
          onClick={() => updateActiveTest({ chemicalShifts: {} })}
          className="px-2 py-1 rounded-lg text-xs font-bold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
        >
          🧹 Clear manual
        </button>
        {manualKeys.length > 0 && (
          <span className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-300 rounded-lg px-2 py-1">
            🟩 {manualKeys.length} manual
          </span>
        )}
      </div>

      {d.parsedSeq.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
          Enter a sequence / select a molecule (in Compounds & Biological Models) to generate the table.
        </div>
      ) : effTableMode === 'backbone' ? (
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[500px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-20 text-center">Res</th>
                {d.moleculeType === 'protein' && (
                  <th className="px-2 py-2 font-bold border-b border-slate-200 text-center">SS</th>
                )}
                {d.selNuc.includes('H') &&
                  d.nucDefs.H.map((a) => (
                    <th key={a} className="px-3 py-2 font-bold text-blue-700 border-b border-slate-200 bg-blue-50/50">{a} (ppm)</th>
                  ))}
                {d.selNuc.includes('N') &&
                  d.nucDefs.N.map((a) => (
                    <th key={a} className="px-3 py-2 font-bold text-emerald-700 border-b border-slate-200 bg-emerald-50/50">{a} (ppm)</th>
                  ))}
                {d.selNuc.includes('C') &&
                  d.nucDefs.C.map((a) => (
                    <th key={a} className="px-3 py-2 font-bold text-purple-700 border-b border-slate-200 bg-purple-50/50">{a} (ppm)</th>
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
                        <span
                          className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white"
                          style={{ backgroundColor: SS_META[res.ssLetter].color }}
                        >
                          {res.ssLetter}
                        </span>
                      </td>
                    )}
                    {d.selNuc.includes('H') &&
                      d.nucDefs.H.map((a) => {
                        const isMan = parseManual(d.shifts[`${idx}-${a}`]) !== null;
                        const isSel = cellIsSelected(idx, a);
                        const est = res.estShifts?.[a];
                        return (
                          <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                            <input
                              type="text"
                              value={d.shifts[`${idx}-${a}`] || ''}
                              onChange={(e) => handleShiftChange(idx, a, e.target.value)}
                              className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`}
                              placeholder="—"
                            />
                            {est !== undefined && (
                              <div className="text-[13px] font-bold text-blue-600 text-center mt-0.5">≈ {est.toFixed(2)}</div>
                            )}
                          </td>
                        );
                      })}
                    {d.selNuc.includes('N') &&
                      d.nucDefs.N.map((a) => {
                        const isMan = parseManual(d.shifts[`${idx}-${a}`]) !== null;
                        const isSel = cellIsSelected(idx, a);
                        return (
                          <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                            <input
                              type="text"
                              value={d.shifts[`${idx}-${a}`] || ''}
                              onChange={(e) => handleShiftChange(idx, a, e.target.value)}
                              className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-emerald-500'}`}
                              placeholder="—"
                            />
                            {res.estN !== null && (
                              <div className="text-[13px] font-bold text-emerald-600 text-center mt-0.5">≈ {res.estN.toFixed(2)}</div>
                            )}
                          </td>
                        );
                      })}
                    {d.selNuc.includes('C') &&
                      d.nucDefs.C.map((a) => {
                        const isMan = parseManual(d.shifts[`${idx}-${a}`]) !== null;
                        const isSel = cellIsSelected(idx, a);
                        const est = a === "C'" ? res.estCP : res.estUniqueC?.[a];
                        return (
                          <td key={a} className={selTdCls(isMan, isSel)} onClick={(e) => handleCellClick(e, idx, a)} title="Click to highlight this atom everywhere">
                            <input
                              type="text"
                              value={d.shifts[`${idx}-${a}`] || ''}
                              onChange={(e) => handleShiftChange(idx, a, e.target.value)}
                              className={`w-full border rounded px-2 py-1 outline-none text-center text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-purple-500'}`}
                              placeholder="—"
                            />
                            {est !== undefined && est !== null && (
                              <div className="text-[13px] font-bold text-purple-600 text-center mt-0.5">≈ {est.toFixed(2)}</div>
                            )}
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
        <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg max-h-[560px]">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-4 py-3 font-black border-b border-slate-200 w-24 text-center">Res</th>
                {d.moleculeType === 'protein' && <th className="px-2 py-2 font-bold border-b border-slate-200 text-center">SS</th>}
                <th className="px-3 py-2 font-bold border-b border-slate-200">Nucleus</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Atom</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200 text-blue-700 bg-blue-50/50">Shift (ppm)</th>
                <th className="px-3 py-2 font-bold border-b border-slate-200">Estimated (ppm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.estSeq.map((res, idx) => {
                if (focusIdx !== 'ALL' && focusIdx !== idx) return null;
                const rows = [];
                if (d.selNuc.includes('H')) {
                  Object.keys(res.estShifts || {}).forEach((a) => rows.push({ nuc: '¹H', atom: a, est: res.estShifts[a].toFixed(2) }));
                }
                if (d.moleculeType === 'protein' && d.selNuc.includes('N') && res.estN !== null) {
                  rows.push({ nuc: '¹⁵N', atom: 'N', est: res.estN.toFixed(2) });
                }
                if (d.selNuc.includes('C')) {
                  Object.keys(res.estUniqueC || {}).forEach((cn) => rows.push({ nuc: '¹³C', atom: cn, est: res.estUniqueC[cn].toFixed(2) }));
                  if (d.moleculeType === 'protein' && res.estCP !== null) rows.push({ nuc: '¹³C', atom: "C'", est: res.estCP.toFixed(2) });
                }
                if (d.hasPhosphorus && d.selNuc.includes('P') && res.p31 !== null) {
                  rows.push({ nuc: '³¹P', atom: 'P', est: res.p31.toFixed(2) });
                }
                if (rows.length === 0) return null;
                return rows.map((row, ri) => {
                  const key = `${idx}-${row.atom}`;
                  const isMan = parseManual(d.shifts[key]) !== null;
                  const isSel = cellIsSelected(idx, row.atom);
                  return (
                    <tr
                      key={`${idx}-${ri}`}
                      onClick={(e) => handleCellClick(e, idx, row.atom)}
                      className={`cursor-pointer transition-colors ${isSel ? 'bg-amber-100' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                      title="Click to highlight this atom everywhere"
                    >
                      {ri === 0 && (
                        <td rowSpan={rows.length} className="px-4 py-2 font-black text-slate-700 text-center bg-slate-50 border-r border-slate-100 align-top">
                          {res.id}
                        </td>
                      )}
                      {ri === 0 && d.moleculeType === 'protein' && (
                        <td rowSpan={rows.length} className="px-2 py-2 text-center align-top">
                          <span
                            className="inline-block w-6 h-6 leading-6 rounded-full text-xs font-black text-white"
                            style={{ backgroundColor: SS_META[res.ssLetter].color }}
                          >
                            {res.ssLetter}
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-1 font-bold text-slate-600 whitespace-nowrap">{row.nuc}</td>
                      <td className={`px-3 py-1 font-medium whitespace-nowrap ${isMan ? 'text-green-700 font-bold' : 'text-slate-700'}`}>{row.atom}</td>
                      <td className="px-3 py-1 text-center">
                        <input
                          type="text"
                          value={d.shifts[key] || ''}
                          onChange={(e) => handleShiftChange(idx, row.atom, e.target.value)}
                          className={`w-24 text-center border rounded px-2 py-1 outline-none text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-200 focus:border-blue-500'}`}
                          placeholder="—"
                        />
                      </td>
                      <td className="px-3 py-1 text-center text-[13px] font-bold text-blue-600">≈ {row.est}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
          <h4 className="text-md font-bold text-blue-700 border-b-2 border-blue-100 inline-block pr-4 pb-1">¹H Assignment</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {d.estSeq.map((res, resIdx) => {
              if (focusIdx !== 'ALL' && focusIdx !== resIdx) return null;
              return (
                <div key={`1h-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                  <div
                    className="py-2 text-center font-bold text-sm"
                    style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}
                  >
                    {res.name} ({res.id})
                  </div>
                  <table className="w-full text-sm text-left bg-white">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Atom</th>
                        <th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 divide-y divide-slate-100">
                      {res.atoms.map((atom) => {
                        const isMan = parseManual(d.shifts[`${resIdx}-${atom}`]) !== null;
                        const isSel = cellIsSelected(resIdx, atom);
                        return (
                          <tr
                            key={atom}
                            onClick={(e) => handleCellClick(e, resIdx, atom)}
                            className={`cursor-pointer transition-colors ${isSel ? 'bg-amber-100' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                            title="Click to highlight this atom everywhere"
                          >
                            <td className={`px-3 py-1 font-medium ${isMan ? 'text-green-700 font-bold' : ''}`}>{atom}</td>
                            <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                              <div className="flex items-center justify-center gap-2 flex-wrap">
                                <input
                                  type="text"
                                  value={d.shifts[`${resIdx}-${atom}`] || ''}
                                  onChange={(e) => handleShiftChange(resIdx, atom, e.target.value)}
                                  className={`w-16 text-center border rounded py-0.5 outline-none text-xs ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-300 focus:border-blue-500'}`}
                                  placeholder="—"
                                />
                                {res.estShifts[atom] !== undefined && (
                                  <span className="text-[13px] font-bold text-blue-600">≈ {res.estShifts[atom].toFixed(2)}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <h4 className="text-md font-bold text-purple-700 border-b-2 border-purple-100 inline-block pr-4 pb-1 mt-4">¹³C Assignment</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
            {d.estSeq.map((res, resIdx) => {
              if (focusIdx !== 'ALL' && focusIdx !== resIdx) return null;
              return (
                <div key={`13c-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                  <div
                    className="py-2 text-center font-bold text-sm"
                    style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}
                  >
                    {res.name} ({res.id})
                  </div>
                  <table className="w-full text-sm text-left bg-white">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Atom</th>
                        <th className="px-3 py-2 font-semibold text-center">Shift (ppm)</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 divide-y divide-slate-100">
                      {Object.keys(res.estUniqueC || {}).map((cName) => {
                        const isMan = parseManual(d.shifts[`${resIdx}-${cName}`]) !== null;
                        const isSel = cellIsSelected(resIdx, cName);
                        return (
                          <tr
                            key={cName}
                            onClick={(e) => handleCellClick(e, resIdx, cName)}
                            className={`cursor-pointer transition-colors ${isSel ? 'bg-amber-100' : isMan ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                            title="Click to highlight this atom everywhere"
                          >
                            <td className={`px-3 py-1 font-medium ${isMan ? 'text-green-700 font-bold' : 'text-purple-800'}`}>{cName}</td>
                            <td className="px-3 py-1 text-center border-l border-slate-100 font-mono">
                              <div className="flex items-center justify-center gap-2 flex-wrap">
                                <input
                                  type="text"
                                  value={d.shifts[`${resIdx}-${cName}`] || ''}
                                  onChange={(e) => handleShiftChange(resIdx, cName, e.target.value)}
                                  className={`w-16 text-center border rounded py-0.5 outline-none text-xs ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-300 focus:border-purple-500'}`}
                                  placeholder="—"
                                />
                                <span className="text-[13px] font-bold text-purple-600">≈ {res.estUniqueC[cName].toFixed(1)}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          {d.hasPhosphorus && d.selNuc.includes('P') && (
            <>
              <h4 className="text-md font-bold text-teal-700 border-b-2 border-teal-100 inline-block pr-4 pb-1 mt-4">³¹P Assignment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-4">
                {d.estSeq.map((res, resIdx) => {
                  if (focusIdx !== 'ALL' && focusIdx !== resIdx) return null;
                  if (res.p31 === null) return null;
                  const isMan = parseManual(d.shifts[`${resIdx}-P`]) !== null;
                  const isSel = cellIsSelected(resIdx, 'P');
                  return (
                    <div key={`p-${resIdx}`} className="border border-slate-200 rounded-lg overflow-hidden shadow-sm h-fit">
                      <div
                        className="py-2 text-center font-bold text-sm"
                        style={{ backgroundColor: `${res.color}15`, color: res.color, borderBottom: `1px solid ${res.color}30` }}
                      >
                        {res.name} ({res.id})
                      </div>
                      <div
                        className={`p-3 flex items-center justify-center gap-3 cursor-pointer ${isSel ? 'bg-amber-100' : isMan ? 'bg-green-50' : ''}`}
                        onClick={(e) => handleCellClick(e, resIdx, 'P')}
                        title="Click to highlight this atom everywhere"
                      >
                        <span className="font-bold text-teal-700">P</span>
                        <input
                          type="text"
                          value={d.shifts[`${resIdx}-P`] || ''}
                          onChange={(e) => handleShiftChange(resIdx, 'P', e.target.value)}
                          className={`w-16 text-center border rounded py-0.5 outline-none text-xs font-mono ${isMan ? 'border-green-400 bg-green-50 text-green-700 font-bold' : 'border-slate-300 focus:border-teal-500'}`}
                          placeholder="—"
                        />
                        <span className="text-[13px] font-bold text-teal-600">≈ {res.p31.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ================= FITTING — VARIABLE PARAMETERS (CD-inspired) + GRAPHICAL PARAMETERS =================
export const Fitting = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const [newVariable, setNewVariable] = useState('');

  const variables = Array.isArray(activeTest.variableParameters)
    ? activeTest.variableParameters
    : ['Temperature', 'pH', 'Concentration', 'Ratio'];
  const rows = activeTest.variableRows || [];
  const heightPx = activeTest.nmrChartHeight || 400;

  const makeId = () => `nvr_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const addVariable = () => {
    const name = newVariable.trim();
    if (!name || variables.includes(name)) return;
    updateActiveTest({ variableParameters: [...variables, name] });
    setNewVariable('');
  };
  const removeVariable = (name) => {
    updateActiveTest({
      variableParameters: variables.filter((v) => v !== name),
      variableRows: rows.map((row) => {
        const values = { ...(row.values || {}) };
        delete values[name];
        return { ...row, values };
      })
    });
  };
  const addRow = () => {
    const values = {};
    variables.forEach((v) => { values[v] = ''; });
    updateActiveTest({
      variableParameters: variables,
      variableRows: [...rows, { id: makeId(), values, notes: '' }]
    });
  };
  const addRowFromCurrent = () => {
    const values = {};
    variables.forEach((v) => {
      const key = v.toLowerCase();
      if (key.includes('temp')) values[v] = activeTest.temperature || '';
      else if (key.includes('ph')) values[v] = activeTest.ph || '';
      else if (key.includes('conc')) values[v] = activeTest.concentration || '';
      else if (key.includes('ratio')) values[v] = activeTest.ratio || '';
      else if (key.includes('salt')) values[v] = activeTest.saltConcentration || '';
      else if (key.includes('solve') || key.includes('buffer')) values[v] = activeTest.solvent || '';
      else if (key.includes('other') || key.includes('ligand') || key.includes('molecule')) values[v] = activeTest.otherMolecule || '';
      else values[v] = '';
    });
    updateActiveTest({
      variableParameters: variables,
      variableRows: [...rows, { id: makeId(), values, notes: '' }]
    });
  };
  const updateRowValue = (id, variable, value) => {
    updateActiveTest({
      variableRows: rows.map((row) =>
        row.id === id ? { ...row, values: { ...(row.values || {}), [variable]: value } } : row
      )
    });
  };
  const updateRowNotes = (id, notes) => {
    updateActiveTest({ variableRows: rows.map((row) => (row.id === id ? { ...row, notes } : row)) });
  };
  const duplicateRow = (row) => {
    updateActiveTest({ variableRows: [...rows, { ...row, id: makeId() }] });
  };
  const removeRow = (id) => {
    updateActiveTest({ variableRows: rows.filter((row) => row.id !== id) });
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid p-6">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">🎛️ Variable Parameters</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-end justify-between bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="flex flex-col md:flex-row gap-2 w-full lg:w-auto">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">New Experimental Variable</label>
                <input
                  type="text"
                  value={newVariable}
                  onChange={(e) => setNewVariable(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addVariable();
                    }
                  }}
                  placeholder="e.g. Temperature, pH, Ligand ratio"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full md:w-72 bg-white"
                />
              </div>
              <button
                type="button"
                onClick={addVariable}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm h-fit"
              >
                + Add Variable
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addRowFromCurrent}
                className="bg-white border border-blue-300 hover:bg-blue-50 text-blue-700 font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + Add Point from Current Conditions
              </button>
              <button
                type="button"
                onClick={addRow}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm"
              >
                + Empty Point
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {variables.length === 0 && (
              <span className="text-sm text-slate-400 italic">
                No variables defined. Add variables such as Temperature, pH, Concentration, Ratio, etc.
              </span>
            )}
            {variables.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-2 bg-white border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 shadow-sm"
              >
                {v}
                <button
                  type="button"
                  onClick={() => removeVariable(v)}
                  className="text-slate-400 hover:text-red-500 font-black"
                  title={`Remove variable ${v}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead className="text-xs text-slate-500 uppercase bg-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-12 border-b border-slate-200">#</th>
                  {variables.map((v) => (
                    <th key={v} className="px-3 py-2 font-bold text-blue-700 whitespace-nowrap border-b border-slate-200">{v}</th>
                  ))}
                  <th className="px-3 py-2 min-w-[180px] border-b border-slate-200">Notes</th>
                  <th className="px-3 py-2 w-32 border-b border-slate-200">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={variables.length + 3} className="px-3 py-10 text-center text-slate-400 italic">
                      No condition points defined yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-500">{idx + 1}</td>
                      {variables.map((v) => (
                        <td key={v} className="px-3 py-2">
                          <input
                            type="text"
                            value={(row.values || {})[v] || ''}
                            onChange={(e) => updateRowValue(row.id, v, e.target.value)}
                            className="w-full min-w-[90px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                            placeholder={v}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.notes || ''}
                          onChange={(e) => updateRowNotes(row.id, e.target.value)}
                          className="w-full min-w-[180px] border border-slate-300 rounded-md px-2 py-1.5 text-sm outline-none focus:border-blue-500"
                          placeholder="Notes..."
                        />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => duplicateRow(row)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
                            Duplicate
                          </button>
                          <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-bold text-red-500 hover:text-red-700">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid p-6">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">🎨 Graphical Parameters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-600">Simulated spectrum panel height (px): {heightPx}</label>
            <input
              type="range"
              min="250"
              max="700"
              step="25"
              value={heightPx}
              onChange={(e) => updateActiveTest({ nmrChartHeight: parseInt(e.target.value, 10) })}
              className="accent-blue-600 mt-2"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Controls the height of every simulated-spectrum panel in the Simulations section.
            </p>
          </div>
          <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            All simulated spectra support <b>drag-to-zoom</b> with a “Reset Zoom” button. Manually-assigned peaks are
            highlighted in <span style={{ color: MANUAL_COLOR }}>green</span> and the selected atom in{' '}
            <span style={{ color: SELECT_COLOR }}>amber</span> (click an atom in the formula or a table cell).
          </div>
        </div>
      </div>
    </>
  );
};

// ================= SIMULATIONS =================
export const Simulations = ({ ctx }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest);
  const [expandedPanel, setExpandedPanel] = useState(null);
  const selectedKeys = getSelectedKeys(activeTest);
  const manualKeys = useMemo(() => getManualKeys(d.shifts), [d.shifts]);
  const heightPx = activeTest.nmrChartHeight || 400;

  if (d.parsedSeq.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
        Enter a sequence / select a molecule (in Compounds & Biological Models) to generate simulated spectra.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-widest">🧪 Simulated Spectra</h4>
        {selectedKeys && (
          <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5">
            🎯 Highlighting: {selectionLabel(d, selectedKeys)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OneDSpectrumPlot
          title="Simulated ¹H 1D Spectrum"
          data={d.peaks.data1H}
          fullDomain={[0, 11]}
          ticks={TICKS_1H}
          TickComponent={CustomXTick1H}
          xLabel="¹H (ppm)"
          panelId="1D_1H"
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          heightPx={heightPx}
        />
        <OneDSpectrumPlot
          title="Simulated ¹³C 1D Spectrum"
          data={d.peaks.data13C}
          fullDomain={[0, 190]}
          ticks={TICKS_13C}
          TickComponent={CustomXTick13C}
          xLabel="¹³C (ppm)"
          panelId="1D_13C"
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          heightPx={heightPx}
        />
        {d.hasPhosphorus && d.selNuc.includes('P') && d.peaks.p31Data.length > 0 && (
          <OneDSpectrumPlot
            title="Simulated ³¹P 1D Spectrum"
            data={d.peaks.p31Data}
            fullDomain={[-5, 5]}
            ticks={Array.from({ length: 11 }, (_, i) => i - 5)}
            TickComponent={CustomXTick1H}
            xLabel="³¹P (ppm)"
            panelId="1D_31P"
            expandedPanel={expandedPanel}
            setExpandedPanel={setExpandedPanel}
            selectedKeys={selectedKeys}
            manualKeys={manualKeys}
            heightPx={heightPx}
          />
        )}
        <SpectrumPlot
          title="Simulated COSY Spectrum"
          diagonalData={d.peaks.diagonalData}
          crossPeakData={d.peaks.cosyPeaks}
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          panelId="cosy"
          diagonalColor="#22c55e"
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          heightPx={heightPx}
        />
        <SpectrumPlot
          title="Simulated NOESY Spectrum"
          diagonalData={d.peaks.diagonalData}
          crossPeakData={d.peaks.noesyPeaks}
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          panelId="noesy"
          diagonalColor="#ef4444"
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          heightPx={heightPx}
        />
        <SpectrumPlot
          title="Simulated TOCSY Spectrum"
          diagonalData={d.peaks.diagonalData}
          crossPeakData={d.peaks.tocsyPeaks}
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          panelId="tocsy"
          diagonalColor="#1e3a8a"
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          heightPx={heightPx}
        />
        <HSQCPlot
          title="Simulated ¹H-¹³C HSQC Spectrum"
          crossPeakData={d.peaks.hsqcPeaks}
          expandedPanel={expandedPanel}
          setExpandedPanel={setExpandedPanel}
          panelId="hsqc"
          selectedKeys={selectedKeys}
          manualKeys={manualKeys}
          yAxisLabel="¹³C F1 (ppm)"
          yDomainInit={[10, 150]}
          yTicks={TICKS_13C}
          heightPx={heightPx}
        />
        {d.moleculeType === 'protein' && d.selNuc.includes('N') && d.peaks.hsqc15NPeaks.length > 0 && (
          <HSQCPlot
            title="Simulated ¹H-¹⁵N HSQC Spectrum"
            crossPeakData={d.peaks.hsqc15NPeaks}
            expandedPanel={expandedPanel}
            setExpandedPanel={setExpandedPanel}
            panelId="hsqc15n"
            selectedKeys={selectedKeys}
            manualKeys={manualKeys}
            yAxisLabel="¹⁵N F1 (ppm)"
            yDomainInit={[95, 135]}
            yTicks={TICKS_15N}
            heightPx={heightPx}
          />
        )}
      </div>
    </div>
  );
};

// ================= NOTEBOOK EXTRA =================
export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const d = useNmrDerived(activeTest);
  if (checkId === 'cond') {
    return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Solvent:</b> ${activeTest.solvent || 'N/A'} | <b>Temp:</b> ${activeTest.temperature || 'N/A'} | <b>Conc:</b> ${activeTest.concentration || 'N/A'} | <b>Salt:</b> ${activeTest.saltConcentration || 'N/A'}</p>`;
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
