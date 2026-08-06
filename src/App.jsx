import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import LZString from 'lz-string';
import {
  DEFAULT_FIREBASE_CONFIG,
  LOCAL_STORAGE_KEY,
  PLATES_DEF,
  DEF_COMPOUNDS,
  DEF_CELL_LINES,
  getDirectImageUrl,
  parsePayload,
  BOX_ROW_LABELS
} from './data/constants';
import { NMRTestRenderer } from './components/NMRTestRenderer';
import { PlateTestRenderer } from './components/PlateTestRenderer';
import { CDTestRenderer } from './components/CDTestRenderer';
import { LabNotebook } from './components/LabNotebook';
import { RichTextEditor } from './components/RichTextEditor';
import { StorageModals, StorageList, StorageDetail, BoxDetail } from './components/Storage';
import { DefinitionsPanel } from './components/DefinitionsPanel';
import { NMRFittingsTestRenderer } from './components/NMRFittingsTestRenderer';
import { CloningTestRenderer } from './components/CloningTestRenderer';
import { ProteinExpressionTestRenderer } from './components/ProteinExpressionTestRenderer';
// App.jsx

import {
CD_TAB_CONFIG,
PLATE_TAB_CONFIG,
NMR_TAB_CONFIG,
CLONING_TAB_CONFIG // <-- Add this import
} from './components/tabConfigs.jsx';

const CUSTOM_FIELD_TAB_OPTIONS = [
  { value: 'all', label: 'All tabs' },
  { value: 'plate', label: 'Plate' },
  { value: 'nmr', label: 'NMR' },
  { value: 'cd', label: 'CD' }
];

const normalizeCustomFields = (fields) => {
  if (!Array.isArray(fields)) return [];

  return fields.map((field, idx) => {
    const base =
      typeof field === 'string'
        ? { name: field }
        : field && typeof field === 'object'
        ? field
        : {};

    const firstArrayType =
      Array.isArray(base.types) && base.types.length ? base.types[0] : undefined;

    let appliesTo =
      base.appliesTo ||
      base.applyTo ||
      base.scope ||
      base.tab ||
      base.testType ||
      firstArrayType ||
      'all';

    if (Array.isArray(appliesTo) && appliesTo.length === 0) {
      appliesTo = 'all';
    }

    return {
      ...base,
      id: base.id || `custom_field_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      name: base.name || `Field ${idx + 1}`,
      type: base.type || 'text',
      options: Array.isArray(base.options) ? base.options : [],
      appliesTo
    };
  });
};

/* =========================================================
   MOLECULE / CALCULATION UTILITIES
========================================================= */

const WATER_MASS = 18.01528;

const AA_MASS = {
  A: 71.0779,
  R: 156.1857,
  N: 114.1026,
  D: 115.0874,
  C: 103.1429,
  E: 129.114,
  Q: 128.1292,
  G: 57.0513,
  H: 137.1393,
  I: 113.1576,
  L: 113.1576,
  K: 128.1723,
  M: 131.1961,
  F: 147.1739,
  P: 97.1152,
  S: 87.0773,
  T: 101.1039,
  W: 186.2099,
  Y: 163.1733,
  V: 99.1311
};

const DNA_RESIDUE_MASS = {
  A: 313.209,
  T: 304.196,
  C: 289.183,
  G: 329.212
};

const RNA_RESIDUE_MASS = {
  A: 329.209,
  U: 306.169,
  C: 305.183,
  G: 345.212
};

const POLY_ONE_LETTER = {
  G: { label: 'Glucose', mass: 162.1404 },
  M: { label: 'Mannose', mass: 162.1404 },
  A: { label: 'Galactose', mass: 162.1404 },
  F: { label: 'Fucose', mass: 146.1404 },
  X: { label: 'Xylose', mass: 132.1242 },
  N: { label: 'HexNAc', mass: 203.19 },
  S: { label: 'Sialic acid', mass: 291.26 }
};

const POLY_TOKENS = {
  GLC: 162.1404,
  GLUCOSE: 162.1404,
  MAN: 162.1404,
  MANNOSE: 162.1404,
  GAL: 162.1404,
  GALACTOSE: 162.1404,
  FUC: 146.1404,
  FUCOSE: 146.1404,
  XYL: 132.1242,
  XYLOSE: 132.1242,
  HEX: 162.1404,
  HEXNAC: 203.19,
  GLCNAC: 203.19,
  GALNAC: 203.19,
  NEUAC: 291.26,
  SIA: 291.26,
  SIALICACID: 291.26
};

const MODIFICATIONS = [
  { id: 'acetylation', label: 'Acetylation', delta: 42.0106, aliases: ['ac', 'acetyl'] },
  { id: 'acylation', label: 'Acylation', delta: 42.0106, aliases: ['acyl'] },
  { id: 'phosphorylation', label: 'Phosphorylation', delta: 79.9664, aliases: ['phos', 'p'] },
  { id: 'amidation', label: 'Amidation', delta: -0.984, aliases: ['amide', 'nh2'] },
  { id: 'methylation', label: 'Methylation', delta: 14.0157, aliases: ['me'] },
  { id: 'dimethylation', label: 'Dimethylation', delta: 28.0313, aliases: ['me2'] },
  { id: 'trimethylation', label: 'Trimethylation', delta: 42.047, aliases: ['me3'] },
  { id: 'formylation', label: 'Formylation', delta: 27.9949, aliases: ['formyl'] },
  { id: 'succinylation', label: 'Succinylation', delta: 100.016, aliases: ['succinyl'] },
  { id: 'palmitoylation', label: 'Palmitoylation', delta: 238.2297, aliases: ['palmitoyl'] },
  { id: 'biotinylation', label: 'Biotinylation', delta: 226.0779, aliases: ['biotin'] }
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normalizeKey = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

const parseModifications = (input = '') => {
  if (!input) return [];

  return String(input)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((token) => {
      const match = token.match(/^(.*?)(?:[:*x](\d+))?$/i);
      const rawName = (match?.[1] || token).trim();
      const parsedCount = parseInt(match?.[2] || '1', 10);
      const count = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 1;

      const norm = normalizeKey(rawName);

      const found = MODIFICATIONS.find((m) => {
        const idNorm = normalizeKey(m.id);
        const labelNorm = normalizeKey(m.label);
        const aliasNorms = (m.aliases || []).map(normalizeKey);
        return idNorm === norm || labelNorm === norm || aliasNorms.includes(norm);
      });

      return Array.from({ length: count }, () => {
        if (found) {
          return {
            label: found.label,
            delta: found.delta,
            known: true
          };
        }

        return {
          label: rawName,
          delta: 0,
          known: false
        };
      });
    });
};

const modificationMass = (mods = []) => {
  return mods.reduce((sum, m) => sum + (Number(m.delta) || 0), 0);
};

const calculateSequenceInfo = ({ type = 'protein', sequence = '', modifications = '' }) => {
  const mods = parseModifications(modifications);
  const modMass = modificationMass(mods);

  if (type === 'protein') {
    const clean = String(sequence || '')
      .toUpperCase()
      .replace(/\s/g, '');

    const letters = clean.split('').filter(Boolean);
    const unknown = [];

    let mass = WATER_MASS + modMass;

    letters.forEach((ch) => {
      if (ch === '*') return;
      if (AA_MASS[ch]) {
        mass += AA_MASS[ch];
      } else {
        unknown.push(ch);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: letters.filter((ch) => ch !== '*').length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  if (type === 'dna' || type === 'rna') {
    let clean = String(sequence || '')
      .toUpperCase()
      .replace(/[^AGCTU]/g, '');

    if (type === 'dna') {
      clean = clean.replace(/U/g, 'T');
    }

    if (type === 'rna') {
      clean = clean.replace(/T/g, 'U');
    }

    const table = type === 'dna' ? DNA_RESIDUE_MASS : RNA_RESIDUE_MASS;
    const unknown = [];

    let mass = WATER_MASS + modMass;

    clean.split('').forEach((ch) => {
      if (table[ch]) {
        mass += table[ch];
      } else {
        unknown.push(ch);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: clean.length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  if (type === 'polysaccharide') {
    const raw = String(sequence || '').trim();

    if (!raw) {
      return {
        ok: true,
        type,
        length: 0,
        molecularWeight: round2(WATER_MASS + modMass),
        unknown: [],
        mods
      };
    }

    let tokens = [];

    if (/[-,\s]/.test(raw)) {
      tokens = raw
        .split(/[-,\s]+/)
        .filter(Boolean)
        .map((t) => t.toUpperCase());
    } else {
      tokens = raw.toUpperCase().split('');
    }

    const unknown = [];
    let mass = WATER_MASS + modMass;

    tokens.forEach((token) => {
      const tokenMass =
        POLY_TOKENS[token] ||
        (POLY_ONE_LETTER[token] ? POLY_ONE_LETTER[token].mass : null);

      if (tokenMass) {
        mass += tokenMass;
      } else {
        unknown.push(token);
      }
    });

    return {
      ok: unknown.length === 0,
      type,
      length: tokens.length,
      molecularWeight: round2(mass),
      unknown,
      mods
    };
  }

  return {
    ok: false,
    type,
    length: 0,
    molecularWeight: 0,
    unknown: [],
    mods
  };
};

const CODON_TABLES = {
  bacterial: {
    A: 'GCG',
    R: 'CGT',
    N: 'AAC',
    D: 'GAT',
    C: 'TGC',
    E: 'GAA',
    Q: 'CAA',
    G: 'GGC',
    H: 'CAT',
    I: 'ATT',
    L: 'CTG',
    K: 'AAA',
    M: 'ATG',
    F: 'TTT',
    P: 'CCG',
    S: 'AGC',
    T: 'ACC',
    W: 'TGG',
    Y: 'TAT',
    V: 'GTG',
    '*': 'TAA'
  },
  mammalian: {
    A: 'GCC',
    R: 'CGG',
    N: 'AAC',
    D: 'GAT',
    C: 'TGC',
    E: 'GAA',
    Q: 'CAA',
    G: 'GGC',
    H: 'CAT',
    I: 'ATT',
    L: 'CTG',
    K: 'AAA',
    M: 'ATG',
    F: 'TTT',
    P: 'CCC',
    S: 'TCC',
    T: 'ACC',
    W: 'TGG',
    Y: 'TAT',
    V: 'GTG',
    '*': 'TAA'
  }
};

const generateDnaFromProtein = (sequence, host = 'bacterial', { addStop = false } = {}) => {
  const clean = String(sequence || '')
    .toUpperCase()
    .replace(/[^A-Z*]/g, '');

  const table = CODON_TABLES[host] || CODON_TABLES.bacterial;

  let dna = clean
    .split('')
    .map((aa) => table[aa] || 'NNN')
    .join('');

  if (addStop && !dna.endsWith('TAA')) {
    dna += 'TAA';
  }

  return dna;
};

let rdkitPromise = null;

async function loadRDKit() {
  if (typeof window === 'undefined') return null;

  if (window.__RDKit) return window.__RDKit;

  if (!window.initRDKitModule) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  window.__RDKit = await window.initRDKitModule();
  return window.__RDKit;
}

async function calculateSmilesInfoAsync(smiles) {
  if (!smiles) return null;

  try {
    const RDKit = await loadRDKit();
    if (!RDKit) return null;

    const mol = RDKit.get_mol(smiles);
    if (!mol) return null;

    let mw = null;

    try {
      const desc = JSON.parse(mol.get_descriptors());
      mw = desc.MolWt || desc.AMW || desc.exactmolwt || null;
    } catch (err) {
      console.warn('RDKit descriptor parsing failed:', err);
    }

    if (mol && typeof mol.delete === 'function') {
      mol.delete();
    }

    return {
      type: 'smiles',
      molecularWeight: mw ? Number(mw) : null,
      length: null
    };
  } catch (err) {
    console.warn('RDKit unavailable. Falling back to manual MW entry.', err);
    return null;
  }
}

/* =========================================================
   CALCULATION UI COMPONENTS
========================================================= */

const CALC_INPUT_CLS =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';

const CALC_LABEL_CLS = 'block text-[10px] font-bold text-slate-400 uppercase mb-1';

const CONC_UNITS = [
  { value: 'nM', factor: 1e-9 },
  { value: 'µM', factor: 1e-6 },
  { value: 'mM', factor: 1e-3 },
  { value: 'M', factor: 1 }
];

const VOLUME_UNITS = [
  { value: 'nL', factor: 1e-9 },
  { value: 'µL', factor: 1e-6 },
  { value: 'mL', factor: 1e-3 },
  { value: 'L', factor: 1 }
];

const MASS_UNITS = [
  { value: 'µg', factor: 1e-6 },
  { value: 'mg', factor: 1e-3 },
  { value: 'g', factor: 1 }
];

const calcNum = (value) => {
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const calcFmt = (value, digits = 4) => {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toLocaleString();
};

const findUnitFactor = (units, value, defaultUnit) => {
  const found = units.find((u) => u.value === value);
  return found ? found.factor : units.find((u) => u.value === defaultUnit)?.factor || 1;
};

const CalcField = ({ label, children }) => {
  return (
    <div>
      <label className={CALC_LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
};

const CalcUnitSelect = ({ value, onChange, units }) => {
  return (
    <select value={value} onChange={onChange} className={CALC_INPUT_CLS}>
      {units.map((u) => (
        <option key={u.value} value={u.value}>
          {u.value}
        </option>
      ))}
    </select>
  );
};

const CalcResultBox = ({ ok, children }) => {
  return (
    <div
      className={`rounded-xl border p-4 text-sm font-bold ${
        ok
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      {children}
    </div>
  );
};

const DEFAULT_MG_CALC = {
  conc: '10',
  concUnit: 'µM',
  volume: '1000',
  volumeUnit: 'µL'
};

const DEFAULT_UL_CALC = {
  mass: '1',
  massUnit: 'mg',
  conc: '10',
  concUnit: 'µM'
};

const DEFAULT_UL_ALL_CALC = {
  volumePerExperiment: '20',
  volumeUnit: 'µL',
  repetitions: '3',
  experiments: '1',
  conc: '10',
  concUnit: 'µM'
};

const HowManyMg = ({ mw, data, onChange }) => {
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');
  const volumeL = calcNum(data.volume) * findUnitFactor(VOLUME_UNITS, data.volumeUnit, 'µL');

  const moles = concM * volumeL;
  const mg = mw ? moles * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-3">
        <CalcField label="Required concentration">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-3">
        <CalcField label="Final volume">
          <input
            type="number"
            value={data.volume}
            onChange={(e) => onChange({ volume: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Volume unit">
          <CalcUnitSelect
            value={data.volumeUnit}
            onChange={(e) => onChange({ volumeUnit: e.target.value })}
            units={VOLUME_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw ? `${calcFmt(mg)} mg` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={!!mw}>
          {mw
            ? `Amount = ${calcFmt(mg)} mg. Formula: C × V × MW.`
            : 'Select a compound with known MW or enter a manual MW override.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

const HowManyUl = ({ mw, data, onChange }) => {
  const massG = calcNum(data.mass) * findUnitFactor(MASS_UNITS, data.massUnit, 'mg');
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');

  const moles = mw ? massG / mw : 0;
  const volumeL = mw && concM > 0 ? moles / concM : 0;
  const ul = volumeL * 1e6;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-3">
        <CalcField label="Amount of compound">
          <input
            type="number"
            value={data.mass}
            onChange={(e) => onChange({ mass: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Mass unit">
          <CalcUnitSelect
            value={data.massUnit}
            onChange={(e) => onChange({ massUnit: e.target.value })}
            units={MASS_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-3">
        <CalcField label="Desired concentration">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2 flex items-end">
        <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
          {mw && concM > 0 ? `${calcFmt(ul)} µL` : 'MW required'}
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={!!mw && concM > 0}>
          {mw && concM > 0
            ? `Solvent/sample volume needed = ${calcFmt(ul)} µL.`
            : 'Enter MW and a non-zero concentration.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

const HowManyUlForAllExperiments = ({ mw, data, onChange }) => {
  const volFactor = findUnitFactor(VOLUME_UNITS, data.volumeUnit, 'µL');
  const concM = calcNum(data.conc) * findUnitFactor(CONC_UNITS, data.concUnit, 'µM');

  const totalSelectedUnits =
    calcNum(data.volumePerExperiment) * calcNum(data.repetitions) * calcNum(data.experiments);

  const totalL = totalSelectedUnits * volFactor;
  const totalUl = totalL * 1e6;

  const totalMg = mw ? totalL * concM * mw * 1000 : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
      <div className="md:col-span-2">
        <CalcField label="Volume per experiment">
          <input
            type="number"
            value={data.volumePerExperiment}
            onChange={(e) => onChange({ volumePerExperiment: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Volume unit">
          <CalcUnitSelect
            value={data.volumeUnit}
            onChange={(e) => onChange({ volumeUnit: e.target.value })}
            units={VOLUME_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Repetitions">
          <input
            type="number"
            value={data.repetitions}
            onChange={(e) => onChange({ repetitions: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Experiments">
          <input
            type="number"
            value={data.experiments}
            onChange={(e) => onChange({ experiments: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Concentration, optional">
          <input
            type="number"
            value={data.conc}
            onChange={(e) => onChange({ conc: e.target.value })}
            className={CALC_INPUT_CLS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-2">
        <CalcField label="Conc. unit">
          <CalcUnitSelect
            value={data.concUnit}
            onChange={(e) => onChange({ concUnit: e.target.value })}
            units={CONC_UNITS}
          />
        </CalcField>
      </div>

      <div className="md:col-span-6 flex items-end mt-2">
        <div className="w-full">
          <CalcField label="Total Volume Needed">
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {calcFmt(totalUl)} µL
            </div>
          </CalcField>
        </div>
      </div>

      <div className="md:col-span-6 flex items-end mt-2">
        <div className="w-full">
          <CalcField label="Total Compound Needed">
            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {totalMg ? `${calcFmt(totalMg)} mg` : 'MW required'}
            </div>
          </CalcField>
        </div>
      </div>

      <div className="md:col-span-12">
        <CalcResultBox ok={true}>
          Total sample volume = {calcFmt(totalUl)} µL
          {totalMg
            ? `. At the selected concentration, compound needed = ${calcFmt(totalMg)} mg.`
            : '. Provide MW and concentration to calculate milligrams.'}
        </CalcResultBox>
      </div>
    </div>
  );
};

const Calculations = ({
  compoundOptions = [],
  compoundMeta = {},
  calculationEntries = {},
  setCalculationEntries
}) => {
  const options = useMemo(() => {
    return [...new Set(compoundOptions.filter(Boolean))];
  }, [compoundOptions]);

  const [selectedCompound, setSelectedCompound] = useState(options[0] || '');
  const [manualMw, setManualMw] = useState('');
  const [tab, setTab] = useState('mg');
  const [saveLabel, setSaveLabel] = useState('');

  const [mgData, setMgData] = useState(DEFAULT_MG_CALC);
  const [ulData, setUlData] = useState(DEFAULT_UL_CALC);
  const [ulAllData, setUlAllData] = useState(DEFAULT_UL_ALL_CALC);

  useEffect(() => {
    if (!selectedCompound && options.length > 0) {
      setSelectedCompound(options[0]);
    }
  }, [options, selectedCompound]);

  const selectedMw = compoundMeta[selectedCompound]?.molecularWeight;

  const effectiveMw = useMemo(() => {
    const manual = parseFloat(manualMw);

    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }

    if (selectedMw) {
      return Number(selectedMw);
    }

    return null;
  }, [manualMw, selectedMw]);

  const tabs = [
    { id: 'mg', label: 'How many mg?' },
    { id: 'ul-from-mg', label: 'How many µL?' },
    {
      id: 'ul-all',
      label: 'How many µL do I need for all my experiments?'
    }
  ];

  const getTabLabel = (id) => {
    const found = tabs.find((t) => t.id === id);
    return found ? found.label : id;
  };

  const updateMg = (patch) => {
    setMgData((prev) => ({ ...prev, ...patch }));
  };

  const updateUl = (patch) => {
    setUlData((prev) => ({ ...prev, ...patch }));
  };

  const updateUlAll = (patch) => {
    setUlAllData((prev) => ({ ...prev, ...patch }));
  };

  const getCurrentData = () => {
    if (tab === 'mg') return mgData;
    if (tab === 'ul-from-mg') return ulData;
    return ulAllData;
  };

  const saveCurrentCalculation = () => {
    if (!setCalculationEntries) return;

    if (!selectedCompound) {
      alert('Select a compound before saving calculation data.');
      return;
    }

    const now = new Date();

    const entry = {
      id: `calc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tab,
      label: saveLabel.trim() || `${getTabLabel(tab)} — ${now.toLocaleString()}`,
      data: getCurrentData(),
      mw: effectiveMw ?? null,
      createdAt: Date.now()
    };

    setCalculationEntries((prev) => {
      const existing = prev[selectedCompound] || [];

      return {
        ...prev,
        [selectedCompound]: [...existing, entry]
      };
    });

    setSaveLabel('');
  };

  const removeEntry = (id) => {
    if (!setCalculationEntries || !selectedCompound) return;

    setCalculationEntries((prev) => {
      const existing = prev[selectedCompound] || [];
      const nextEntries = existing.filter((entry) => entry.id !== id);

      const next = { ...prev };

      if (nextEntries.length === 0) {
        delete next[selectedCompound];
      } else {
        next[selectedCompound] = nextEntries;
      }

      return next;
    });
  };

  const clearAllEntries = () => {
    if (!setCalculationEntries || !selectedCompound) return;

    const ok = window.confirm(
      `Remove all saved calculation data for ${selectedCompound}?`
    );

    if (!ok) return;

    setCalculationEntries((prev) => {
      const next = { ...prev };
      delete next[selectedCompound];
      return next;
    });
  };

  const loadEntry = (entry) => {
    const tabToLoad = entry.tab === 'ul-needed' ? 'ul-all' : entry.tab;

    setTab(tabToLoad);

    if (tabToLoad === 'mg') {
      setMgData({ ...DEFAULT_MG_CALC, ...entry.data });
    } else if (tabToLoad === 'ul-from-mg') {
      setUlData({ ...DEFAULT_UL_CALC, ...entry.data });
    } else if (tabToLoad === 'ul-all') {
      setUlAllData({ ...DEFAULT_UL_ALL_CALC, ...entry.data });
    }
  };

  const entries = selectedCompound ? calculationEntries[selectedCompound] || [] : [];

  const formatEntryData = (data) => {
    return Object.entries(data || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-lg font-black text-slate-800 mb-1">Calculations</h2>

        <p className="text-sm text-slate-500 mb-4">
          Mass and volume calculators using molecular weight from compound definitions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className={CALC_LABEL_CLS}>Compound</label>

            <select
              value={selectedCompound}
              onChange={(e) => setSelectedCompound(e.target.value)}
              className={CALC_INPUT_CLS}
            >
              <option value="">Manual only</option>

              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className={CALC_LABEL_CLS}>Manual MW override, Da</label>

            <input
              type="number"
              value={manualMw}
              onChange={(e) => setManualMw(e.target.value)}
              placeholder="Optional"
              className={CALC_INPUT_CLS}
            />
          </div>

          <div className="md:col-span-3">
            <label className={CALC_LABEL_CLS}>Active MW</label>

            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}
            </div>
          </div>

          <div className="md:col-span-2">
            <label className={CALC_LABEL_CLS}>Source</label>

            <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
              {manualMw ? 'Manual' : selectedMw ? 'Definition' : 'None'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-4">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${
                tab === t.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'mg' && <HowManyMg mw={effectiveMw} data={mgData} onChange={updateMg} />}

        {tab === 'ul-from-mg' && (
          <HowManyUl mw={effectiveMw} data={ulData} onChange={updateUl} />
        )}

        {tab === 'ul-all' && (
          <HowManyUlForAllExperiments
            mw={effectiveMw}
            data={ulAllData}
            onChange={updateUlAll}
          />
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-3 mb-4">
          <div className="flex-1">
            <label className={CALC_LABEL_CLS}>Saved calculation label</label>

            <input
              type="text"
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              placeholder="Optional label for this calculation"
              className={CALC_INPUT_CLS}
            />
          </div>

          <button
            type="button"
            onClick={saveCurrentCalculation}
            disabled={!selectedCompound || !setCalculationEntries}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            + Add calculation data
          </button>

          <button
            type="button"
            onClick={clearAllEntries}
            disabled={!selectedCompound || entries.length === 0 || !setCalculationEntries}
            className="bg-red-50 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            Clear all for compound
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {!selectedCompound ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              Select a compound to save calculation data.
            </div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No saved calculation data for {selectedCompound}.
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">
                    {entry.label}
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    {getTabLabel(entry.tab)} · MW:{' '}
                    {entry.mw ? `${Number(entry.mw).toLocaleString()} Da` : 'Not set'}
                  </div>

                  <div className="text-xs text-slate-600 mt-1 font-mono break-words">
                    {formatEntryData(entry.data)}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => loadEntry(entry)}
                    className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
                  >
                    Load
                  </button>

                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/* =========================================================
   COMPOUND DEFINITION SECTION
========================================================= */

const CompoundDefinitionSection = ({
  compoundOptions = [],
  customCmpds = [],
  setCustomCmpds,
  compoundMeta = {},
  setCompoundMeta
}) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [type, setType] = useState('protein');
  const [sequence, setSequence] = useState('');
  const [modText, setModText] = useState('');
  const [smiles, setSmiles] = useState('');
  const [host, setHost] = useState('bacterial');
  const [manualMw, setManualMw] = useState('');
  const [smilesStatus, setSmilesStatus] = useState('');

  const existingNames = useMemo(() => {
    const names = new Set([
      ...compoundOptions.filter(Boolean),
      ...Object.keys(compoundMeta || {})
    ]);

    return [...names].sort((a, b) => a.localeCompare(b));
  }, [compoundOptions, compoundMeta]);

  const selectedMeta = selectedName ? compoundMeta[selectedName] || {} : {};
  const selectedMw = selectedMeta.molecularWeight;

  const chooseCompound = (name) => {
    if (!name) {
      setSelectedName('');
      setNewName('');
      return;
    }

    const meta = compoundMeta[name] || {};

    setSelectedName(name);
    setNewName('');
    setType(meta.type || 'protein');
    setSequence(meta.sequence || '');
    setModText(meta.modifications || '');
    setSmiles(meta.smiles || '');
    setHost(meta.host || 'bacterial');
    setManualMw('');
  };

  const computed = useMemo(() => {
    if (type === 'smiles') return null;
    if (!sequence.trim()) return null;

    return calculateSequenceInfo({
      type,
      sequence,
      modifications: modText
    });
  }, [type, sequence, modText]);

  const dnaPreview = useMemo(() => {
    if (type !== 'protein' || !sequence.trim()) return '';
    return generateDnaFromProtein(sequence, host);
  }, [type, sequence, host]);

  const effectiveMw = useMemo(() => {
    const manual = parseFloat(manualMw);

    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }

    if (computed?.molecularWeight) {
      return Number(computed.molecularWeight);
    }

    if (selectedMw) {
      return Number(selectedMw);
    }

    return null;
  }, [manualMw, computed, selectedMw]);

  const addQuickModification = (mod) => {
    setModText((prev) => {
      if (!prev.trim()) return mod;
      return `${prev}, ${mod}`;
    });
  };

  const computeSmilesMw = async () => {
    if (!smiles.trim()) {
      setSmilesStatus('Enter a SMILES string first.');
      return;
    }

    setSmilesStatus('Calculating SMILES molecular weight...');

    const result = await calculateSmilesInfoAsync(smiles.trim());

    if (result?.molecularWeight) {
      setManualMw(String(result.molecularWeight));
      setSmilesStatus('SMILES MW calculated using RDKit.');
    } else {
      setSmilesStatus('RDKit is unavailable. Enter MW manually or load RDKit.');
    }
  };

  const saveCompound = () => {
    const name = selectedName || newName.trim();

    if (!name) {
      alert('Please choose an existing compound or enter a new compound name.');
      return;
    }

    const meta = {
      name,
      type,
      host: type === 'protein' ? host : undefined,
      sequence: type === 'smiles' ? '' : sequence,
      modifications: type === 'smiles' ? '' : modText,
      smiles: type === 'smiles' ? smiles : '',
      molecularWeight: effectiveMw ?? null,
      length: computed?.length ?? compoundMeta[name]?.length ?? null,
      dnaSequence: type === 'protein' ? dnaPreview : compoundMeta[name]?.dnaSequence || '',
      updatedAt: Date.now()
    };

    setCompoundMeta((prev) => ({
      ...prev,
      [name]: {
        ...(prev[name] || {}),
        ...meta
      }
    }));

    const alreadyInCustomCompounds = customCmpds.some((c) => {
      if (typeof c === 'string') return c === name;
      return c?.name === name;
    });

    if (!alreadyInCustomCompounds) {
      setCustomCmpds((prev) => [...prev, name]);
    }
  };

  const quickMods = [
    'Acetylation',
    'Phosphorylation',
    'Amidation',
    'Methylation',
    'Formylation',
    'Succinylation',
    'Palmitoylation'
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase mb-2">
        Compound Sequence / Structure
      </h3>

      <p className="text-xs text-slate-500 mb-4">
        Define a compound by one-letter sequence, modifications, or SMILES. Molecular weight and
        length are calculated automatically. For proteins, an optimized DNA sequence can be
        generated.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        <div className="lg:col-span-3">
          <label className={CALC_LABEL_CLS}>Existing compound</label>

          <select
            value={selectedName}
            onChange={(e) => chooseCompound(e.target.value)}
            className={CALC_INPUT_CLS}
          >
            <option value="">New compound...</option>

            {existingNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className={CALC_LABEL_CLS}>New compound name</label>

          <input
            type="text"
            value={selectedName ? '' : newName}
            disabled={!!selectedName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Peptide-01"
            className={`${CALC_INPUT_CLS} disabled:bg-slate-50 disabled:text-slate-400`}
          />
        </div>

        <div className="lg:col-span-3">
          <label className={CALC_LABEL_CLS}>Molecule type</label>

          <select value={type} onChange={(e) => setType(e.target.value)} className={CALC_INPUT_CLS}>
            <option value="protein">Protein / Peptide</option>
            <option value="dna">DNA</option>
            <option value="rna">RNA</option>
            <option value="polysaccharide">Polysaccharide</option>
            <option value="smiles">SMILES small molecule</option>
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className={CALC_LABEL_CLS}>Codon host</label>

          <select
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={type !== 'protein'}
            className={`${CALC_INPUT_CLS} disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <option value="bacterial">Bacterial</option>
            <option value="mammalian">Mammalian</option>
          </select>
        </div>
      </div>

      {type === 'smiles' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
          <div className="lg:col-span-9">
            <label className={CALC_LABEL_CLS}>SMILES</label>

            <input
              type="text"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
              className={CALC_INPUT_CLS}
            />
          </div>

          <div className="lg:col-span-3 flex items-end">
            <button
              type="button"
              onClick={computeSmilesMw}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
            >
              Calculate SMILES MW
            </button>
          </div>

          <div className="lg:col-span-12 text-xs text-slate-500">{smilesStatus}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
          <div className="lg:col-span-7">
            <label className={CALC_LABEL_CLS}>
              One-letter sequence
              {type === 'polysaccharide' ? ' or tokens' : ''}
            </label>

            <textarea
              value={sequence}
              onChange={(e) => setSequence(e.target.value)}
              placeholder={
                type === 'protein'
                  ? 'e.g. MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHQYREQIKRVKDSDDVPMVLVGNKCDLPSRTVDTKQAQDLARSYGIPFIETSAKTRQGVEDAFYTLVREIRQHKLRKLNPPDESGPGCMSCKCVLS'
                  : type === 'dna'
                  ? 'e.g. ATGGCTGAC...'
                  : type === 'rna'
                  ? 'e.g. AUGGCUGAC...'
                  : 'e.g. G-M-N-F-S or GMNFS'
              }
              className={`${CALC_INPUT_CLS} h-32 font-mono`}
            />
          </div>

          <div className="lg:col-span-5">
            <label className={CALC_LABEL_CLS}>Modifications</label>

            <textarea
              value={modText}
              onChange={(e) => setModText(e.target.value)}
              placeholder="e.g. Phosphorylation, Acetylation, Amidation:2"
              className={`${CALC_INPUT_CLS} h-32`}
            />

            <div className="flex flex-wrap gap-2 mt-2">
              {quickMods.map((mod) => (
                <button
                  key={mod}
                  type="button"
                  onClick={() => addQuickModification(mod)}
                  className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-2 py-1 rounded transition-colors"
                >
                  + {mod}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className={CALC_LABEL_CLS}>Manual MW override, Da</label>

          <input
            type="number"
            value={manualMw}
            onChange={(e) => setManualMw(e.target.value)}
            placeholder="Optional"
            className={CALC_INPUT_CLS}
          />
        </div>

        <div className="md:col-span-3">
          <label className={CALC_LABEL_CLS}>Calculated MW</label>

          <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
            {effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}
          </div>
        </div>

        <div className="md:col-span-2">
          <label className={CALC_LABEL_CLS}>Length</label>

          <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
            {computed?.length ?? selectedMeta?.length ?? '—'}
          </div>
        </div>

        <div className="md:col-span-4 flex items-end justify-end">
          <button
            type="button"
            onClick={saveCompound}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            Save Compound Definition
          </button>
        </div>
      </div>

      {computed && !computed.ok && computed.unknown?.length > 0 && (
        <div className="mb-4 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          Unknown tokens/letters: {computed.unknown.join(', ')}
        </div>
      )}

      {type === 'protein' && dnaPreview && (
        <div>
          <label className={CALC_LABEL_CLS}>
            Generated DNA sequence, {host} preferred codons
          </label>

          <textarea
            readOnly
            value={dnaPreview}
            className={`${CALC_INPUT_CLS} h-28 font-mono bg-slate-50`}
          />
        </div>
      )}
    </div>
  );
};

/* =========================================================
   CUSTOM METADATA FIELDS MANAGER
========================================================= */

const CustomMetadataFieldsManager = ({ customFields = [], setCustomFields }) => {
  const [draft, setDraft] = useState({
    name: '',
    type: 'text',
    options: '',
    appliesTo: 'all'
  });

  const addField = () => {
    const name = draft.name.trim();

    if (!name) {
      alert('Please enter a field name.');
      return;
    }

    const options =
      draft.type === 'select'
        ? draft.options
            .split(',')
            .map((opt) => opt.trim())
            .filter(Boolean)
        : [];

    const newField = {
      id: `custom_field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: draft.type,
      options,
      appliesTo: draft.appliesTo || 'all'
    };

    setCustomFields((prev) => [...(Array.isArray(prev) ? prev : []), newField]);

    setDraft({
      name: '',
      type: 'text',
      options: '',
      appliesTo: 'all'
    });
  };

  const updateField = (id, patch) => {
    setCustomFields((prev) =>
      (Array.isArray(prev) ? prev : []).map((field) =>
        field.id === id ? { ...field, ...patch } : field
      )
    );
  };

  const removeField = (id) => {
    setCustomFields((prev) =>
      (Array.isArray(prev) ? prev : []).filter((field) => field.id !== id)
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase mb-3">
        Custom Metadata Fields
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Field Name
          </label>

          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Instrument"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Type
          </label>

          <select
            value={draft.type}
            onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="textarea">Textarea</option>
            <option value="select">Select</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Options, comma separated
          </label>

          <input
            type="text"
            value={draft.options}
            onChange={(e) => setDraft((prev) => ({ ...prev, options: e.target.value }))}
            disabled={draft.type !== 'select'}
            placeholder={draft.type === 'select' ? 'e.g. Low, Medium, High' : 'N/A'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Tab Type
          </label>

          <select
            value={draft.appliesTo}
            onChange={(e) => setDraft((prev) => ({ ...prev, appliesTo: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={addField}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            Add Field
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {(Array.isArray(customFields) ? customFields : []).length === 0 ? (
          <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
            No custom metadata fields defined.
          </div>
        ) : (
          (Array.isArray(customFields) ? customFields : []).map((field) => {
            const scopeValue = Array.isArray(field.appliesTo)
              ? field.appliesTo[0] || 'all'
              : field.appliesTo || 'all';

            return (
              <div
                key={field.id || field.name}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Field Name
                    </label>

                    <input
                      type="text"
                      value={field.name || ''}
                      onChange={(e) => updateField(field.id, { name: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Type
                    </label>

                    <select
                      value={field.type || 'text'}
                      onChange={(e) => updateField(field.id, { type: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="textarea">Textarea</option>
                      <option value="select">Select</option>
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Options
                    </label>

                    <input
                      type="text"
                      value={(field.options || []).join(', ')}
                      onChange={(e) =>
                        updateField(field.id, {
                          options: e.target.value
                            .split(',')
                            .map((opt) => opt.trim())
                            .filter(Boolean)
                        })
                      }
                      disabled={field.type !== 'select'}
                      placeholder={field.type === 'select' ? 'Comma separated options' : 'N/A'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Tab Type
                    </label>

                    <select
                      value={scopeValue}
                      onChange={(e) => updateField(field.id, { appliesTo: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                    >
                      {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/* =========================================================
   SCIENTISTS / OPERATORS MANAGER
========================================================= */

const ScientistsOperatorsManager = ({
  operators = [],
  setOperators
}) => {
  const [operatorDraft, setOperatorDraft] = useState({
    name: '',
    surname: ''
  });

  const getOperatorLabel = (op) => {
    if (typeof op === 'string') return op;
    return `${op?.name || ''} ${op?.surname || ''}`.trim();
  };

  const addOperator = () => {
    const fullName = `${operatorDraft.name.trim()} ${operatorDraft.surname.trim()}`.trim();

    if (!fullName) {
      alert('Please enter scientist name and/or surname.');
      return;
    }

    if (operators.some((op) => getOperatorLabel(op).toLowerCase() === fullName.toLowerCase())) {
      alert('Operator already exists.');
      return;
    }

    setOperators((prev) => [...prev, fullName].sort());

    setOperatorDraft({
      name: '',
      surname: ''
    });
  };

  const removeOperator = (label) => {
    setOperators((prev) => prev.filter((op) => getOperatorLabel(op) !== label));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-bold text-slate-700 uppercase mb-3">
          Scientists / Operators
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Name
            </label>

            <input
              type="text"
              value={operatorDraft.name}
              onChange={(e) =>
                setOperatorDraft((prev) => ({
                  ...prev,
                  name: e.target.value
                }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') addOperator();
              }}
              placeholder="e.g. Marie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Surname
            </label>

            <input
              type="text"
              value={operatorDraft.surname}
              onChange={(e) =>
                setOperatorDraft((prev) => ({
                  ...prev,
                  surname: e.target.value
                }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') addOperator();
              }}
              placeholder="e.g. Curie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-4 flex items-end">
            <button
              type="button"
              onClick={addOperator}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
            >
              Add Scientist / Operator
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {operators.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No scientists/operators defined.
            </div>
          ) : (
            operators.map((op) => {
              const label = getOperatorLabel(op);

              return (
                <span
                  key={label}
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-2"
                >
                  {label}

                  <button
                    onClick={() => removeOperator(label)}
                    className="text-red-500 hover:text-red-700 font-black"
                    title="Remove operator"
                  >
                    ×
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

/* =========================================================
   COLLAPSIBLE SECTION
========================================================= */

const CollapsibleSection = ({ title, subtitle, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-bold text-slate-700 uppercase">{title}</h3>

          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>

        <span className="text-slate-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && <div className="px-4 pb-4 overflow-visible">{children}</div>}
    </div>
  );
};

/* =========================================================
   MIGRATION UTILITIES
========================================================= */

const migrateLoadedDataset = (s) => {
  const rawTests = (s && (s.tests || s.plates)) || [];

  let tests = rawTests.map((p) => {
    let safeComments = typeof p.comments === 'string' ? p.comments : '';

    safeComments = safeComments.replace(
      /<img[^>]+src="data:image\/[^;]+;base64,([^">]{500000,})"[^>]*>/gi,
      '<br/><span style="color:red; font-size:10px; font-weight:bold;">[Massive image removed]</span><br/>'
    );

    let safeImages = Array.isArray(p.images)
      ? p.images.filter(
          (img) =>
            typeof img === 'string' &&
            !(img.startsWith('data:image/') && img.length > 500000)
        )
      : [];

    let migratedType = p.type;

    if (!migratedType && p.plateType) {
      migratedType = p.plateType === '9x9box' ? 'plate-9x9box' : 'plate-' + p.plateType;
    }

    let migratedCategory =
      p.testCategory || (p.expTypes && p.expTypes.length > 0 ? p.expTypes[0] : 'Activity');

    if (migratedType === 'nmr') {
      return {
        moleculeName: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        otherMolecule: '',
        ratio: '',
        tableMode: 'backbone',
        compound: '',
        ...p,
        type: 'nmr',
        testCategory: migratedCategory,
        comments: safeComments,
        images: safeImages
      };
    }

    if (migratedType === 'cd') {
      return {
        compound: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        buffer: '',
        pathLength: '1',
        otherMolecule: '',
        ratio: '',
        wavelengthData: '',
        spectraColumns: [],
        structureComposition: {
          'α-Helix': 30,
          'β-Sheet': 20,
          Turn: 10,
          'Random Coil': 40
        },
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '190',
          xMax: '260',
          fontSize: 12,
          lineWidth: 2
        },
        ...p,
        type: 'cd',
        testCategory: migratedCategory,
        comments: safeComments,
        images: safeImages
      };
    }

    return {
      ...p,
      type: migratedType || 'plate-96',
      testCategory: migratedCategory,
      comments: safeComments,
      images: safeImages
    };
  });

  const existingStorages = s && s.storages ? s.storages.slice() : [];
  const legacyGroups = {};

  tests.forEach((t) => {
    if (t.type !== 'plate-9x9box' || t.storageId) return;

    const label = typeof t.storageLabel === 'string' ? t.storageLabel.trim() : '';
    const typeText = typeof t.storageType === 'string' ? t.storageType.trim() : '';

    if (!label && !typeText) return;

    const key = typeText + '||' + label;

    if (!legacyGroups[key]) {
      legacyGroups[key] = { typeText, label, items: [] };
    }

    legacyGroups[key].items.push(t);
  });

  const newStorages = [];

  Object.values(legacyGroups).forEach((group, gi) => {
    const normType = /frigo|refriger/i.test(group.typeText)
      ? 'Refrigerator'
      : /clos|armad|closet/i.test(group.typeText)
      ? 'Closet'
      : 'Freezer';

    const stId = 'st_legacy_' + Date.now().toString(36) + '_' + gi;
    const cols = 4;
    const rows = Math.max(5, Math.ceil(group.items.length / cols));

    newStorages.push({
      id: stId,
      name: group.label || group.typeText || 'Imported Storage ' + (gi + 1),
      type: normType,
      rows,
      cols,
      imageUrl: ''
    });

    group.items.forEach((t, idx) => {
      t.storageId = stId;
      t.storageIndex = idx;
    });
  });

  return {
    tests,
    storages: newStorages.length > 0 ? [...existingStorages, ...newStorages] : existingStorages
  };
};

/* =========================================================
   FIREBASE SETUP
========================================================= */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCVemPUayc_Q-IsbcQxnFRHg8bBLZFSHfA',
  authDomain: 'cell-experiment-tracker.firebaseapp.com',
  projectId: 'cell-experiment-tracker',
  storageBucket: 'cell-experiment-tracker.firebasestorage.app',
  messagingSenderId: '855790481107',
  appId: '1:855790481107:web:a566455d3f13a48a20ae26'
};

let app,
  auth,
  db,
  appId = 'lab-workspace-app';

try {
  if (window.firebase) {
    if (!window.firebase.apps.length) {
      app = window.firebase.initializeApp(FIREBASE_CONFIG);
    } else {
      app = window.firebase.app();
    }

    auth = window.firebase.auth();
    db = window.firebase.firestore();
  }
} catch (e) {
  console.error('Firebase init error. Falling back to local storage.', e);
}

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const createEmptyTest = (id, num, customType = 'plate-96') => {
    const baseTest = {
      id,
      name: `Test ${num}`,
      date: new Date().toISOString().split('T')[0],
      instanceName: '',
      testCategory: 'Activity',
      type: customType,
      storageType: '',
      storageLabel: '',
      storageIndex: null,
      comments: '',
      images: [],
      documents: [],
      plan: [],
      linkedProtocolId: '',
      cellLines: [],
      customFieldValues: {},
      selectedCompounds: [],
      compound: ''
    };

    if (customType.startsWith('plate')) {
      const dimKey = customType.split('-')[1];
      const dim = PLATES_DEF[dimKey] || PLATES_DEF['96'];

      const defGrid = Array(26)
        .fill(null)
        .map(() => Array(26).fill(''));

      const defCell = Array(26)
        .fill(null)
        .map(() =>
          Array(26)
            .fill(null)
            .map(() => ({
              excluded: false,
              role: null,
              conc: null,
              region: 'Primary',
              manualOverride: false
            }))
        );

      return {
        ...baseTest,
        plateType: dimKey,
        grid: defGrid,
        boxRows: 9,
        boxCols: 9,
        compounds: Array(dim?.cols || 12).fill(''),
        rowCompounds: Array(dim?.rows || 8).fill(''),
        cellConfig: defCell,
        ctrlType: 'cells',
        ctrlODStr: '1.0',
        bgType: 'none',
        bgManualStr: '0',
        unit: 'µM',
        cellsSeeded: '',
        test: '',
        manualErrors: {},
        topConcStr: '100',
        dilFactorStr: '3',
        glbOffsetStr: '0',
        errScaleStr: '1',
        useFixedSD: false,
        fixedSDStr: '0',
        showViab: true,
        fitIC50: true,
        showExcl: false,
        outlierThreshStr: '2.0',
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '',
          xMax: '',
          ptStyle: 'circle',
          ptSize: 5,
          fontSize: 16,
          xPos: 'bottom',
          yPos: 'left',
          xAxisLabel: '',
          lineStyle: 'solid',
          lineThickness: 2
        }
      };
    }

    if (customType === 'nmr') {
      return {
        ...baseTest,
        proteinSequence: '',
        selectedNuclei: ['H', 'C', 'N'],
        chemicalShifts: {},
        nmrSpectraImages: [],
        moleculeName: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        otherMolecule: '',
        ratio: '',
        tableMode: 'backbone',
        compound: ''
      };
    }

    if (customType === 'cd') {
      return {
        ...baseTest,
        compound: '',
        experimentDate: '',
        concentration: '',
        solvent: '',
        saltConcentration: '',
        temperature: '',
        buffer: '',
        pathLength: '1',
        otherMolecule: '',
        ratio: '',
        wavelengthData: '',
        spectraColumns: [],
        structureComposition: {
          'α-Helix': 30,
          'β-Sheet': 20,
          Turn: 10,
          'Random Coil': 40
        },
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '190',
          xMax: '260',
          fontSize: 12,
          lineWidth: 2
        }
      };
    }

if (customType === 'protein_expression') {
      return {
        ...baseTest,
        type: 'protein_expression',
        testCategory: 'Expression Optimization', // Default category
        yieldData: [],
        gelImages: [],
        chromatogramRaw: '',
        inductionMethod: '',
        inductionTemp: '',
        lysisBuffer: '',
        columnType: ''
      };
    }

    if (customType === 'nmr-fittings') {
      const rows = 8;
      const cols = 12;

      const defGrid = Array.from({ length: rows }, () => Array(cols).fill(''));

      const defCell = Array.from({ length: rows }, () =>
        Array(cols)
          .fill(null)
          .map(() => ({
            excluded: false,
            role: null,
            conc: null,
            region: 'Primary',
            manualOverride: false
          }))
      );

      return {
        ...baseTest,
        name: `NMR Fitting ${num}`,
        type: 'nmr-fittings',
        testCategory: 'NMR Fittings',
        gridPreset: '96',
        plateType: '96',
        rows,
        cols,
        rowsStr: String(rows),
        colsStr: String(cols),
        grid: defGrid,
        cellConfig: defCell,
        compounds: Array(cols).fill(''),
        rowCompounds: Array(rows).fill(''),
        operator: '',
        moleculeId: '',
        moleculeName: '',
        unit: 'µM',
        valueUnit: 'a.u.',
        topConcStr: '',
        dilFactorStr: '',
        ctrlType: 'none',
        ctrlODStr: '',
        bgType: 'none',
        bgManualStr: '',
        manualErrors: {},
        useFixedSD: false,
        fixedSDStr: '0',
        showViab: false,
        fitIC50: false,
        showExcl: false,
        outlierThreshStr: '2.0',
        chartCfg: {
          yMin: '',
          yMax: '',
          xMin: '',
          xMax: '',
          ptStyle: 'circle',
          ptSize: 5,
          fontSize: 16,
          xPos: 'bottom',
          yPos: 'left',
          xAxisLabel: '',
          lineStyle: 'solid',
          lineThickness: 2
        }
      };
    }

    return baseTest;
  };

  const [user, setUser] = useState(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isCloudReady, setIsCloudReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
  const [appView, setAppView] = useState('explorer');
  const [currentModule, setCurrentModule] = useState('dashboard');
  const [datasetsList, setDatasetsList] = useState([]);
  const [currentDatasetId, setCurrentDatasetId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [pendingLoad, setPendingLoad] = useState(null);
  const [appClipboard, setAppClipboard] = useState(null);
  const [datasetTitle, setDatasetTitle] = useState('');
  const [datasetSubtitle, setDatasetSubtitle] = useState('');
  const [customCmpds, setCustomCmpds] = useState([]);
  const [customCellLines, setCustomCellLines] = useState([]);
  const [customConc, setCustomConc] = useState({});
  const [cmpColors, setCmpColors] = useState({});
  const [operators, setOperators] = useState([]);
  const [molecules, setMolecules] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [compoundMeta, setCompoundMeta] = useState({});
  const [calculationEntries, setCalculationEntries] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [storages, setStorages] = useState([]);
  const [activeStorageId, setActiveStorageId] = useState(null);
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [testCategories, setTestCategories] = useState([
    'Activity',
    'Toxicity',
    'Microscopy',
    'Flow Cytometry',
    'Viability'
  ]);
  const [protocolCategories, setProtocolCategories] = useState([
    'Preparation',
    'Measurement',
    'Analysis'
  ]);
  const [datasetProtocols, setDatasetProtocols] = useState([]);

  const historyRef = useRef([[createEmptyTest('t1', 1, 'plate-96')]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reactTests, setReactTests] = useState(historyRef.current[0]);

  const tests = reactTests;

  const allCmpds = useMemo(() => {
    return [...new Set([...DEF_COMPOUNDS, ...customCmpds])];
  }, [customCmpds]);

  const allCellLines = useMemo(() => {
    return [...new Set([...DEF_CELL_LINES, ...customCellLines])];
  }, [customCellLines]);

  const [activeTestId, setActiveTestId] = useState('t1');

  const setTests = useCallback(
    (updater) => {
      setReactTests((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        const nextStr = JSON.stringify(next);
        const prevStr = JSON.stringify(prev);

        if (nextStr !== prevStr) {
          const currentHistory = historyRef.current.slice(0, historyIndex + 1);
          currentHistory.push(next);

          if (currentHistory.length > 50) currentHistory.shift();

          historyRef.current = currentHistory;
          setHistoryIndex(currentHistory.length - 1);
        }

        return next;
      });
    },
    [historyIndex]
  );

  const handleSetCustomFields = useCallback((updater) => {
    setCustomFields((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeCustomFields(next);
    });
  }, []);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setReactTests(historyRef.current[newIdx]);
    }
  };

  const handleRedo = () => {
    if (historyIndex < historyRef.current.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setReactTests(historyRef.current[newIdx]);
    }
  };

  useEffect(() => {
    if (!auth) {
      setIsCloudReady(true);
      return;
    }

    const initAuth = async () => {
      auth.onAuthStateChanged((currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setNeedsLogin(false);
          setIsCloudReady(true);
        } else {
          setNeedsLogin(true);
          setIsCloudReady(true);
        }
      });
    };

    initAuth();
  }, []);

  const handleManualLogin = async () => {
    const provider = new window.firebase.auth.GoogleAuthProvider();

    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      console.error('Errore login:', e);
    }
  };

  useEffect(() => {
    if (needsLogin) return;

    const urlParams = new URLSearchParams(window.location.search);
    const sharedDatasetId = urlParams.get('dataset');

    if (sharedDatasetId && isCloudReady && db && !currentDatasetId) {
      db.collection(`artifacts/${appId}/public/data/datasets`)
        .doc(sharedDatasetId)
        .get()
        .then((doc) => {
          if (doc.exists) {
            const dset = { id: doc.id, ...doc.data() };
            openDataset(dset);
          }
        })
        .catch((err) => console.error('Errore dataset condiviso:', err));
    }
  }, [isCloudReady, db, currentDatasetId, needsLogin]);

  useEffect(() => {
    if (db && user) {
      const collRef = db.collection(`artifacts/${appId}/public/data/datasets`);

      const unsubscribe = collRef.onSnapshot(
        (snap) => {
          const dsets = [];

          snap.forEach((doc) => {
            dsets.push({ id: doc.id, ...doc.data() });
          });

          dsets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

          setDatasetsList(dsets);
          setIsCloudReady(true);
        },
        (err) => {
          console.error('Firestore sync error:', err);

          try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

            if (stored) {
              setDatasetsList(
                JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              );
            }
          } catch (e) {}

          setIsCloudReady(true);
        }
      );

      return () => unsubscribe();
    }

    if (!user) {
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);

        if (stored) {
          setDatasetsList(
            JSON.parse(stored).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          );
        }
      } catch (e) {}

      setIsCloudReady(true);
    }
  }, [user, db]);

  const latestDataRef = useRef(null);

  latestDataRef.current = {
    tests,
    datasetTitle,
    datasetSubtitle,
    customCmpds,
    customCellLines,
    customConc,
    cmpColors,
    testCategories,
    protocolCategories,
    datasetProtocols,
    storages,
    customFields,
    operators,
    molecules,
    compoundMeta,
    calculationEntries
  };

  const getCompressedPayload = () =>
    LZString.compressToUTF16(JSON.stringify(latestDataRef.current));

  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;

    setSaveStatus('saving');

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const updatedPayload = {
          title: datasetTitle || 'Untitled Dataset',
          subtitle: datasetSubtitle || '',
          date: tests[0]?.date || new Date().toISOString().split('T')[0],
          testCount: tests.length,
          updatedAt: window.firebase
            ? window.firebase.firestore.FieldValue.serverTimestamp()
            : Date.now(),
          payload: JSON.stringify(latestDataRef.current),
          isCompressed: false
        };

        if (db && user) {
          const docRef = db
            .collection(`artifacts/${appId}/public/data/datasets`)
            .doc(currentDatasetId);

          await docRef
            .set(updatedPayload, { merge: true })
            .then(() => {
              setSaveStatus('saved');
              setSaveErrorMsg('');
            })
            .catch((err) => {
              setSaveStatus('error');
              setSaveErrorMsg(err.message);
            });
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          const existingIdx = stored.findIndex((e) => e.id === currentDatasetId);
          const newDset = { id: currentDatasetId, ...updatedPayload };

          if (existingIdx >= 0) {
            stored[existingIdx] = { ...stored[existingIdx], ...newDset };
          } else {
            stored.push(newDset);
          }

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));

          setDatasetsList(
            [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          );

          setSaveStatus('saved');
        }
      } catch (e) {
        setSaveStatus('error');
        setSaveErrorMsg(e.message);
      }
    }, 1500);
  }, [
    tests,
    datasetTitle,
    datasetSubtitle,
    customCmpds,
    customCellLines,
    customConc,
    cmpColors,
    testCategories,
    protocolCategories,
    datasetProtocols,
    customFields,
    operators,
    molecules,
    compoundMeta,
    calculationEntries,
    storages,
    isCloudReady,
    appView,
    currentDatasetId,
    user
  ]);

  const exportHTML = () => {
    try {
      const payload = getCompressedPayload();

      const dataBlob = {
        payload,
        isCompressed: true,
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        savedAt: Date.now()
      };

      const clone = document.documentElement.cloneNode(true);
      const oldTag = clone.querySelector('#saved-data-blob');

      if (oldTag) oldTag.remove();

      const oldLoader = clone.querySelector('#loader');

      if (oldLoader) oldLoader.style.display = 'none';

      const tag = document.createElement('script');
      tag.id = 'saved-data-blob';
      tag.type = 'application/json';
      tag.textContent = JSON.stringify(dataBlob);

      clone.querySelector('body').appendChild(tag);

      const htmlStr = '<!DOCTYPE html>\n' + clone.outerHTML;
      const blob = new Blob([htmlStr], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${(datasetTitle || 'dataset').replace(/[^a-z0-9]+/gi, '_')}.html`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDialog({
        type: 'alert',
        title: 'Save Failed',
        message: 'Could not save HTML file: ' + e.message
      });
    }
  };

  const loadHTML = (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) return;

    if (file.size > 900000) {
      setDialog({
        type: 'alert',
        title: 'Large File Warning',
        message:
          'This file is very large. After loading, saving to cloud might fail due to the 1MB limit. Consider removing embedded images.'
      });
    }

    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        let s = null;
        let loadedTests = [];

        const newMatch = text.match(
          /<script[^>]*id=["']saved-data-blob["'][^>]*>([\s\S]*?)<\/script>/
        );

        if (newMatch) {
          const dataBlob = JSON.parse(newMatch[1]);
          let pStr = dataBlob.payload;

          if (dataBlob.isCompressed) {
            const dec = LZString.decompressFromUTF16(pStr);
            if (dec) pStr = dec;
          }

          s = JSON.parse(pStr);
          loadedTests = s.tests || s.plates || [];

          if (loadedTests.length === 0) {
            setDialog({
              type: 'alert',
              title: 'Load Failed',
              message: 'No tests found in this file.'
            });
            return;
          }
        } else {
          setDialog({
            type: 'alert',
            title: 'Load Failed',
            message: 'No dataset data found in this HTML file.'
          });
          return;
        }

        const migrated = migrateLoadedDataset(s);

        loadedTests = migrated.tests;
        s.storages = migrated.storages;

        setPendingLoad({ tests: loadedTests, fullState: s });
      } catch (err) {
        setDialog({
          type: 'alert',
          title: 'Load Failed',
          message: 'Could not read this file: ' + err.message
        });
      }
    };

    reader.readAsText(file);

    e.target.value = '';
  };

  const confirmLoad = (mode) => {
    const { tests: loadedTests, fullState: s } = pendingLoad;
    let targetId = currentDatasetId;

    if (!targetId || mode === 'replace') {
      targetId = s.id || 'ds_' + Date.now();
      setCurrentDatasetId(targetId);
      setAppView('dataset');
      window.history.pushState({}, '', '?dataset=' + targetId);
    }

    if (mode === 'replace') {
      setReactTests(loadedTests);
      historyRef.current = [loadedTests];
      setHistoryIndex(0);

      if (loadedTests.length > 0) {
        setActiveTestId(loadedTests[0].id);
      }

      if (s.datasetTitle !== undefined) setDatasetTitle(s.datasetTitle);
      else if (s.reportTitle !== undefined) setDatasetTitle(s.reportTitle);

      if (s.datasetSubtitle !== undefined) setDatasetSubtitle(s.datasetSubtitle);
      else if (s.reportSubtitle !== undefined) setDatasetSubtitle(s.reportSubtitle);

      if (s.customCmpds !== undefined) setCustomCmpds(s.customCmpds);
      if (s.customCellLines !== undefined) setCustomCellLines(s.customCellLines);
      if (s.customConc !== undefined) setCustomConc(s.customConc);
      if (s.cmpColors !== undefined) setCmpColors(s.cmpColors);
      if (s.testCategories !== undefined) setTestCategories(s.testCategories);
      if (s.protocolCategories !== undefined) setProtocolCategories(s.protocolCategories);
      if (s.datasetProtocols !== undefined) setDatasetProtocols(s.datasetProtocols);
      if (s.storages !== undefined) setStorages(s.storages);
      if (s.operators !== undefined) setOperators(s.operators);
      if (s.molecules !== undefined) setMolecules(s.molecules);
      if (s.compoundMeta !== undefined) setCompoundMeta(s.compoundMeta);
      if (s.calculationEntries !== undefined) setCalculationEntries(s.calculationEntries);

      if (s.customFields !== undefined) {
        setCustomFields(normalizeCustomFields(s.customFields));
      }
    } else if (mode === 'append') {
      const newTests = loadedTests.map((p) => ({
        ...p,
        id: 't' + Math.random().toString(36).substr(2, 9) + Date.now()
      }));

      setTests((prev) => [...prev, ...newTests]);

      if (newTests.length > 0) {
        setActiveTestId(newTests[0].id);
      }

      if (s.customCmpds !== undefined) {
        setCustomCmpds((prev) => [...new Set([...prev, ...s.customCmpds])]);
      }

      if (s.customCellLines !== undefined) {
        setCustomCellLines((prev) => [...new Set([...prev, ...s.customCellLines])]);
      }

      if (s.customConc !== undefined) {
        setCustomConc((prev) => ({ ...prev, ...s.customConc }));
      }

      if (s.cmpColors !== undefined) {
        setCmpColors((prev) => ({ ...prev, ...s.cmpColors }));
      }

      if (s.customFields !== undefined) {
        setCustomFields((prev) => {
          const incoming = normalizeCustomFields(s.customFields);
          const existingIds = new Set(prev.map((f) => f.id));
          const additions = incoming.filter((f) => !existingIds.has(f.id));
          return [...prev, ...additions];
        });
      }

      if (s.compoundMeta !== undefined) {
        setCompoundMeta((prev) => ({
          ...prev,
          ...s.compoundMeta
        }));
      }

      if (s.calculationEntries !== undefined) {
        setCalculationEntries((prev) => {
          const next = { ...prev };

          Object.entries(s.calculationEntries || {}).forEach(
            ([compoundName, incomingEntries]) => {
              const existing = next[compoundName] || [];

              const existingIds = new Set(existing.map((entry) => entry.id));

              const additions = (
                Array.isArray(incomingEntries) ? incomingEntries : []
              ).filter((entry) => !existingIds.has(entry.id));

              next[compoundName] = [...existing, ...additions];
            }
          );

          return next;
        });
      }

      if (s.storages !== undefined) {
        setStorages((prev) => {
          const merged = [...prev];

          s.storages.forEach((newSt) => {
            if (!merged.find((st) => st.id === newSt.id)) {
              merged.push(newSt);
            }
          });

          return merged;
        });
      }

      if (s.operators !== undefined) {
        setOperators((prev) => [...new Set([...prev, ...s.operators])]);
      }

      if (s.molecules !== undefined) {
        setMolecules((prev) => {
          const incoming = Array.isArray(s.molecules) ? s.molecules : [];
          const existingIds = new Set(prev.map((m) => m.id || m.name));
          const additions = incoming.filter((m) => !existingIds.has(m.id || m.name));
          return [...prev, ...additions];
        });
      }
    }

    setPendingLoad(null);
    setCurrentModule('tests');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const createNewDataset = async () => {
    const newId = 'ds_' + Date.now();
    const freshTests = [createEmptyTest('t1', 1, 'plate-96')];

    setReactTests(freshTests);

    historyRef.current = [freshTests];
    setHistoryIndex(0);
    setActiveTestId('t1');

    setDatasetTitle('New Dataset');
    setDatasetSubtitle('');
    setCustomCmpds([]);
    setCustomCellLines([]);
    setCustomConc({});
    setCmpColors({});
    setCustomFields([]);
    setCompoundMeta({});
    setCalculationEntries({});
    setOperators([]);
    setMolecules([]);

    setTestCategories([
      'Activity',
      'Toxicity',
      'Microscopy',
      'Flow Cytometry',
      'Viability'
    ]);

    setProtocolCategories(['Preparation', 'Measurement', 'Analysis']);
    setDatasetProtocols([]);
    setStorages([]);

    setCurrentDatasetId(newId);
    setAppView('dataset');
    setCurrentModule('dashboard');

    window.history.pushState({}, '', '?dataset=' + newId);

    const updatedPayload = {
      title: 'New Dataset',
      date: new Date().toISOString().split('T')[0],
      createdAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      updatedAt: window.firebase
        ? window.firebase.firestore.FieldValue.serverTimestamp()
        : Date.now(),
      payload: JSON.stringify({ tests: freshTests }),
      isCompressed: false
    };

    if (db && user) {
      await db
        .collection(`artifacts/${appId}/public/data/datasets`)
        .doc(newId)
        .set(updatedPayload);
    } else {
      let stored = [];

      try {
        stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
      } catch (e) {}

      stored.push({ id: newId, ...updatedPayload });

      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));

      setDatasetsList(
        [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      );
    }
  };

  const handleBackToExplorer = async () => {
    if (currentDatasetId) {
      setSaveStatus('saving');

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      try {
        const updatedPayload = {
          title: datasetTitle || 'Untitled Dataset',
          subtitle: datasetSubtitle || '',
          date: tests[0]?.date || new Date().toISOString().split('T')[0],
          testCount: tests.length,
          updatedAt: window.firebase
            ? window.firebase.firestore.FieldValue.serverTimestamp()
            : Date.now(),
          payload: JSON.stringify(latestDataRef.current),
          isCompressed: false
        };

        if (db && user) {
          await db
            .collection(`artifacts/${appId}/public/data/datasets`)
            .doc(currentDatasetId)
            .set(updatedPayload, { merge: true });
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          const existingIdx = stored.findIndex((e) => e.id === currentDatasetId);

          if (existingIdx >= 0) {
            stored[existingIdx] = { ...stored[existingIdx], ...updatedPayload };
          } else {
            stored.push({ id: currentDatasetId, ...updatedPayload });
          }

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));

          setDatasetsList(
            [...stored].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          );
        }
      } catch (e) {}
    }

    window.history.pushState({}, '', window.location.pathname);
    setAppView('explorer');
  };

  const openDataset = (dset) => {
    const s = parsePayload(dset);

    if (!s) return;

    try {
      const migrated = migrateLoadedDataset(s);
      const loadedTests = migrated.tests;

      if (loadedTests.length > 0) {
        setReactTests(loadedTests);
        historyRef.current = [loadedTests];
        setHistoryIndex(0);
        setActiveTestId(loadedTests[0].id);
      } else {
        const fresh = [createEmptyTest('t1', 1)];
        setReactTests(fresh);
        historyRef.current = [fresh];
        setHistoryIndex(0);
        setActiveTestId('t1');
      }

      setDatasetTitle(
        s.datasetTitle !== undefined
          ? s.datasetTitle
          : s.reportTitle !== undefined
          ? s.reportTitle
          : dset.title || 'Untitled'
      );

      setDatasetSubtitle(
        s.datasetSubtitle !== undefined ? s.datasetSubtitle : s.reportSubtitle || ''
      );

      setCustomCmpds(s.customCmpds || []);
      setCustomCellLines(s.customCellLines || []);
      setCustomConc(s.customConc || {});
      setCmpColors(s.cmpColors || {});
      setCustomFields(normalizeCustomFields(s.customFields || []));
      setCompoundMeta(s.compoundMeta || {});
      setCalculationEntries(s.calculationEntries || {});
      setOperators(Array.isArray(s.operators) ? s.operators : []);
      setMolecules(Array.isArray(s.molecules) ? s.molecules : []);

      setTestCategories(
        s.testCategories || [
          'Activity',
          'Toxicity',
          'Microscopy',
          'Flow Cytometry',
          'Viability'
        ]
      );

      setProtocolCategories(
        s.protocolCategories || ['Preparation', 'Measurement', 'Analysis']
      );

      setDatasetProtocols(s.datasetProtocols || []);
      setStorages(migrated.storages);

      setCurrentDatasetId(dset.id);
      setAppView('dataset');
      setCurrentModule('dashboard');

      window.history.pushState({}, '', '?dataset=' + dset.id);
    } catch (e) {
      setDialog({
        type: 'alert',
        title: 'Error',
        message: 'Error reading dataset structure.'
      });
    }
  };

  const deleteDataset = (e, id) => {
    e.stopPropagation();

    setDialog({
      type: 'confirm',
      title: 'Delete Dataset',
      message: 'Are you sure you want to delete this entire Dataset?',
      onConfirm: async () => {
        if (db && user) {
          await db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).delete();
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          stored = stored.filter((d) => d.id !== id);

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  const renameDataset = (e, id, currentTitle) => {
    e.stopPropagation();

    setDialog({
      type: 'prompt',
      title: 'Rename Dataset',
      message: 'Enter a new title for this Dataset:',
      defaultValue: currentTitle,
      onConfirm: async (newTitle) => {
        if (newTitle && newTitle.trim() !== currentTitle) {
          if (db && user) {
            await db
              .collection(`artifacts/${appId}/public/data/datasets`)
              .doc(id)
              .update({ title: newTitle.trim() });
          } else {
            let stored = [];

            try {
              stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
            } catch (e) {}

            const idx = stored.findIndex((d) => d.id === id);

            if (idx >= 0) {
              stored[idx].title = newTitle.trim();
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
              setDatasetsList(stored);
            }
          }
        }
      }
    });
  };

  const deleteEmptyDatasets = async () => {
    const emptyDatasets = datasetsList.filter((dset) => {
      if (!dset.testCount || dset.testCount === 0) return true;

      if (dset.testCount === 1) {
        try {
          if (dset.title === 'New Dataset' || dset.title === 'Untitled Dataset') {
            const s = parsePayload(dset);

            if (s && s.tests && s.tests.length === 1) {
              const t = s.tests[0];

              if (
                t.name === 'Test 1' &&
                !t.instanceName &&
                !t.comments &&
                (!t.images || t.images.length === 0)
              ) {
                return true;
              }
            }
          }
        } catch (e) {
          return false;
        }
      }

      return false;
    });

    if (emptyDatasets.length === 0) {
      setDialog({
        type: 'alert',
        title: 'Clean Up',
        message: 'No empty datasets found.'
      });

      return;
    }

    setDialog({
      type: 'confirm',
      title: 'Delete Empty Datasets',
      message: `Are you sure you want to delete ${emptyDatasets.length} empty dataset(s)?`,
      onConfirm: async () => {
        if (db && user) {
          try {
            const batch = db.batch();

            emptyDatasets.forEach((dset) => {
              const docRef = db
                .collection(`artifacts/${appId}/public/data/datasets`)
                .doc(dset.id);

              batch.delete(docRef);
            });

            await batch.commit();
          } catch (e) {
            console.error('Batch delete failed', e);

            setDialog({
              type: 'alert',
              title: 'Error',
              message: 'Cloud deletion failed.'
            });
          }
        } else {
          let stored = [];

          try {
            stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
          } catch (e) {}

          const emptyIds = emptyDatasets.map((d) => d.id);

          stored = stored.filter((d) => !emptyIds.includes(d.id));

          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stored));
          setDatasetsList(stored);
        }
      }
    });
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const groupedDatasets = useMemo(() => {
    const groups = {};

    datasetsList.forEach((dset) => {
      let catSet = new Set();
      let cellSet = new Set();

      try {
        const s = parsePayload(dset);

        if (s && s.tests) {
          s.tests.forEach((t) => {
            if (t.testCategory) catSet.add(t.testCategory);

            if (Array.isArray(t.cellLines)) {
              t.cellLines.forEach((e) => cellSet.add(e));
            }
          });
        }
      } catch (e) {}

      const catStr = Array.from(catSet).sort().join(', ');
      const cellStr = Array.from(cellSet).sort().join(', ');
      const hasMeta = catStr || cellStr;
      const key = hasMeta ? `${catStr}|${cellStr}` : `unclassified_${dset.id}`;

      if (!groups[key]) {
        groups[key] = {
          key,
          categories: catStr,
          cellLines: cellStr,
          isUnclassified: !hasMeta,
          items: []
        };
      }

      groups[key].items.push(dset);
    });

    Object.values(groups).forEach((g) => {
      g.items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    });

    return groups;
  }, [datasetsList]);

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const [calFilterDate, setCalFilterDate] = useState(null);

  const mergedPlan = useMemo(() => {
    const all = [];

    tests.forEach((t) => {
      (t.plan || []).forEach((task) => {
        all.push({ ...task, testName: t.name, testId: t.id });
      });
    });

    const sorted = all.sort((a, b) => a.date.localeCompare(b.date));

    if (calFilterDate) return sorted.filter((t) => t.date === calFilterDate);

    return sorted;
  }, [tests, calFilterDate]);

  const agendaGrouped = useMemo(() => {
    const sorted = [...mergedPlan].sort((a, b) => a.date.localeCompare(b.date));

    return sorted.reduce((acc, t) => {
      acc[t.date] = acc[t.date] || [];
      acc[t.date].push(t);
      return acc;
    }, {});
  }, [mergedPlan]);

  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  ).getDay();

  const startDayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const totalDays = daysInMonth(currentMonth.getFullYear(), currentMonth.getMonth());
  const monthName = currentMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const handlePrevMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));

  const handleNextMonth = () =>
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const jumpToTest = (testId) => {
    setActiveTestId(testId);
    setCurrentModule('active-test');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const jumpToProtocol = (protocolId) => {
    setExpandedGroups((p) => ({ ...p, activeProtoId: protocolId }));
    setCurrentModule('protocols');

    if (window.innerWidth < 768) setIsSidebarOpen(false);
  };

  const handlePrint = () => {
    window.print();
  };

  if (needsLogin) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl flex flex-col items-center max-w-sm border border-slate-200 text-center">
          <div className="text-5xl mb-4">🔐</div>

          <h1 className="text-2xl font-black text-slate-800 mb-2">Accesso Richiesto</h1>

          <p className="text-slate-500 mb-8 text-sm leading-relaxed">
            Per ragioni di sicurezza e per sincronizzare i tuoi dati di laboratorio sul Cloud,
            il browser richiede un'azione manuale per il login.
          </p>

          <button
            onClick={handleManualLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition-transform hover:scale-105 w-full flex items-center justify-center gap-2"
          >
            <span>Accedi con Google</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full relative flex flex-col h-screen overflow-hidden bg-slate-50">
      <style>{`
        @media print {
          @page {
            margin: 1.5cm 1.2cm;
            size: A4 portrait;
          }

          .no-print,
          nav,
          button,
          input[type="file"] {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          body,
          html,
          #root {
            background: white !important;
            height: auto !important;
            min-height: 100% !important;
            overflow: visible !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .h-screen,
          .max-h-screen,
          .flex-1,
          .overflow-y-auto,
          .overflow-hidden,
          .custom-scrollbar,
          .h-full,
          .min-h-0 {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            position: static !important;
          }

          .fixed,
          .absolute {
            position: static !important;
          }

          .shadow-sm,
          .shadow-md,
          .shadow-lg,
          .shadow-xl,
          .shadow-2xl {
            box-shadow: none !important;
            border: 1px solid #e2e8f0 !important;
          }

          .avoid-break,
          table,
          tr,
          thead,
          tbody,
          img,
          svg,
          canvas,
          figure {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            break-after: avoid !important;
            page-break-after: avoid !important;
            break-inside: avoid !important;
          }

          p,
          li,
          td,
          th {
            orphans: 3;
            widows: 3;
          }

          #notebook-report-container > * {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-top: 0.4cm;
            margin-bottom: 0.4cm;
          }
        }
      `}</style>

      {dialog && (
        <div className="fixed inset-0 bg-slate-900/50 z-[999999] flex items-center justify-center p-4 backdrop-blur-sm">
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex flex-col">
              {dialog.title && (
                <h3 className="text-lg font-bold text-slate-800 mb-2">{dialog.title}</h3>
              )}

              <p className="text-sm text-slate-600 mb-4">{dialog.message}</p>

              {dialog.type === 'prompt' && (
                <input
                  type="text"
                  id="prompt-input"
                  defaultValue={dialog.defaultValue}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      dialog.onConfirm(e.target.value);
                      setDialog(null);
                    }

                    if (e.key === 'Escape') {
                      setDialog(null);
                    }
                  }}
                  className="border border-slate-300 rounded p-2 text-sm focus:border-blue-500 focus:outline-none mb-2"
                />
              )}

              <div className="flex justify-end gap-2 mt-2">
                {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                  <button
                    onClick={() => setDialog(null)}
                    className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded"
                  >
                    Cancel
                  </button>
                )}

                <button
                  onClick={() => {
                    if (dialog.onConfirm) {
                      if (dialog.type === 'prompt') {
                        dialog.onConfirm(document.getElementById('prompt-input').value);
                      } else {
                        dialog.onConfirm();
                      }
                    }

                    setDialog(null);
                  }}
                  className="px-4 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm"
                >
                  {dialog.type === 'alert' ? 'OK' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingLoad && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-full max-w-sm mx-4">
            <h3 className="text-lg font-black text-slate-800 mb-2">Load Workspace Data</h3>

            <p className="text-sm text-slate-500 mb-6">
              How would you like to load the data from this file?
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => confirmLoad('append')}
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
              >
                ➕ Add to Current File
              </button>

              <button
                onClick={() => confirmLoad('replace')}
                className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold py-2 px-4 rounded-lg text-left transition-colors"
              >
                🔄 Substitute Data
              </button>

              <button
                onClick={() => setPendingLoad(null)}
                className="mt-2 text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <StorageModals
        storageModal={storageModal}
        setStorageModal={setStorageModal}
        storages={storages}
        setStorages={setStorages}
        moveModal={moveModal}
        setMoveModal={setMoveModal}
        tests={tests}
        setTests={setTests}
      />

      {/* ===== EXPLORER VIEW ===== */}
      {appView === 'explorer' && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center p-4 md:p-10 bg-slate-100 overflow-y-auto">
          <div className="w-full max-w-6xl">
            <div className="flex flex-col items-center justify-center py-12 md:py-16 px-6 md:px-8 border border-blue-100 mb-6 md:mb-10 bg-gradient-to-b from-white to-blue-50/50 rounded-2xl shadow-lg mt-4 md:mt-0">
              <h1 className="text-3xl md:text-5xl font-black text-slate-800 tracking-tight mb-4 text-center">
                Lab Workspace
              </h1>

              <p className="text-slate-500 text-base md:text-xl mb-8 text-center max-w-2xl font-medium">
                Create, manage, and analyze your experiments, assays, and inventory in one unified
                environment.
              </p>

              <button
                onClick={createNewDataset}
                disabled={!isCloudReady}
                className={`font-black py-3 md:py-4 px-6 md:px-10 rounded-full shadow-lg transition-all transform hover:scale-105 flex items-center gap-3 text-base md:text-lg w-full md:w-auto justify-center ${
                  isCloudReady
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span className="text-2xl">+</span> Create New Dataset
              </button>

              {!isCloudReady && (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <p className="text-sm font-bold text-slate-500">Connecting to Cloud...</p>
                </div>
              )}
            </div>

            <div className="bg-white p-4 md:p-8 rounded-2xl shadow-xl border border-slate-200">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-100 pb-4 gap-4">
                <h2 className="text-xl md:text-2xl font-bold text-slate-800">
                  Your Recent Datasets
                </h2>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  <button
                    onClick={deleteEmptyDatasets}
                    className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none items-center justify-center gap-2 cursor-pointer text-sm"
                  >
                    🗑️ Delete Empty
                  </button>

                  <label className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2 cursor-pointer text-sm">
                    📂 Load HTML File
                    <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                  </label>
                </div>
              </div>

              {isCloudReady && Object.keys(groupedDatasets).length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-md flex flex-col items-center gap-3">
                  <span className="text-4xl opacity-30">📂</span>
                  <span>No datasets found in cloud or local storage.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {Object.values(groupedDatasets).map((group) => {
                    const titleParts = [];

                    if (group.categories) titleParts.push(group.categories);
                    if (group.cellLines) titleParts.push(group.cellLines);

                    const groupTitle = group.isUnclassified
                      ? group.items[0].title || 'Untitled'
                      : titleParts.join(' - ');

                    const isExpanded = expandedGroups[group.key];

                    return (
                      <div
                        key={group.key}
                        className="border border-slate-200 rounded-xl p-4 md:p-5 hover:shadow-lg hover:border-blue-300 transition-all bg-white flex flex-col h-full"
                      >
                        <h3
                          className="font-bold text-lg text-slate-800 mb-2 leading-tight truncate"
                          title={groupTitle}
                        >
                          {groupTitle}
                        </h3>

                        <p className="text-xs text-slate-500 mb-4 font-medium bg-slate-100 inline-block px-2 py-1 rounded-md self-start">
                          {group.items.length} Dataset{group.items.length === 1 ? '' : 's'}
                        </p>

                        <div className="flex flex-col gap-2 flex-1">
                          {group.items
                            .slice(0, isExpanded ? undefined : 3)
                            .map((dset) => (
                              <div
                                key={dset.id}
                                onClick={() => openDataset(dset)}
                                className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md p-3 rounded-lg cursor-pointer flex justify-between items-center transition-all group/item"
                              >
                                <div className="flex flex-col overflow-hidden">
                                  <span className="font-bold text-sm text-blue-700 truncate">
                                    {dset.title || groupTitle}
                                  </span>

                                  <span className="text-[11px] text-slate-500 mt-1 flex gap-2">
                                    <span>📅 {dset.date || 'No Date'}</span>
                                    <span>🧪 {dset.testCount || 1} Tests</span>
                                  </span>
                                </div>

                                <div className="flex flex-col gap-1 opacity-100 md:opacity-0 group-hover/item:opacity-100 transition-all shrink-0 ml-2">
                                  <button
                                    onClick={(e) =>
                                      renameDataset(e, dset.id, dset.title || groupTitle)
                                    }
                                    className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                                  >
                                    Rename
                                  </button>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteDataset(e, dset.id);
                                    }}
                                    className="text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold transition-colors text-right"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ))}

                          {group.items.length > 3 && (
                            <button
                              onClick={() => toggleGroup(group.key)}
                              className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold py-2 rounded-lg mt-2 text-center transition-colors w-full"
                            >
                              {isExpanded
                                ? 'Hide Datasets'
                                : `Show ${group.items.length - 3} more...`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== DATASET VIEW ===== */}
      {appView === 'dataset' && (
        <div className="flex flex-col md:flex-row h-screen w-full overflow-hidden">
          {/* MOBILE TOP BAR */}
          <div className="md:hidden bg-white border-b border-slate-200 p-3 flex justify-between items-center z-10 shrink-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="text-2xl text-slate-600 px-2 py-1"
            >
              ☰
            </button>

            <span className="font-bold text-slate-800 truncate px-4">
              {datasetTitle || 'Lab Workspace'}
            </span>

            <div className="w-8"></div>
          </div>

          {isSidebarOpen && (
            <div
              className="md:hidden fixed inset-0 bg-slate-900/50 z-40"
              onClick={() => setIsSidebarOpen(false)}
            ></div>
          )}

          {/* COLLAPSIBLE SIDEBAR */}
          <div
            className={`bg-white border-r border-slate-200 flex flex-col shadow-sm z-50 shrink-0 no-print transition-all duration-300 absolute md:relative h-full ${
              isSidebarOpen
                ? 'translate-x-0 w-64'
                : '-translate-x-full md:translate-x-0 md:w-16 items-center'
            }`}
          >
            <div
              className={`p-4 border-b border-slate-200 flex items-center gap-2 ${
                isSidebarOpen ? 'justify-between' : 'flex-col justify-center'
              }`}
            >
              <button
                onClick={handleBackToExplorer}
                className="text-slate-400 hover:text-blue-600 transition-colors"
                title="Back to Workspace"
              >
                ◀
              </button>

              {isSidebarOpen && (
                <div className="min-w-0 flex-1">
                  <input
                    value={datasetTitle}
                    onChange={(e) => setDatasetTitle(e.target.value)}
                    className="w-full text-sm font-black text-slate-800 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1"
                    placeholder="Dataset Title"
                  />

                  <input
                    value={datasetSubtitle}
                    onChange={(e) => setDatasetSubtitle(e.target.value)}
                    className="w-full text-[10px] font-medium text-slate-500 bg-transparent border-none outline-none truncate focus:ring-1 focus:ring-blue-500 rounded px-1 mt-0.5"
                    placeholder="Subtitle / Project info"
                  />
                </div>
              )}

              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg"
                title="Toggle Sidebar"
              >
                {isSidebarOpen ? '⮜' : '☰'}
              </button>
            </div>

            {isSidebarOpen && (
              <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center text-[10px] font-bold text-slate-500">
                <span>Status:</span>

                {saveStatus === 'saving' ? (
                  <span className="text-blue-500 animate-pulse">💾 Saving...</span>
                ) : saveStatus === 'saved' ? (
                  <span className="text-emerald-600">☁️ Cloud Sync</span>
                ) : saveStatus === 'error' ? (
                  <span className="text-red-600" title={saveErrorMsg}>❌ Error</span>
                ) : (
                  <span className="text-slate-600">...</span>
                )}
              </div>
            )}

            <nav
              className={`flex-1 overflow-y-auto py-4 flex flex-col gap-1 ${
                isSidebarOpen ? 'px-2' : 'px-1 items-center'
              }`}
            >
              {[
                { id: 'dashboard', icon: '📊', label: 'Dataset Overview' },
                { id: 'notebook', icon: '📓', label: 'Lab Notebook' },
                { id: 'definitions', icon: '🏷️', label: 'Definitions & Labels' },
                { id: 'tests', icon: '🧪', label: 'Tests & Fittings' },
                { id: 'agenda', icon: '🗓️', label: 'Agenda (Timeline)' },
                { id: 'protocols', icon: '📝', label: 'Protocols' },
                { id: 'storage', icon: '📦', label: 'Storage & Boxes' },
                { id: 'calculations', icon: '🧮', label: 'Calculations' }
              ].map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => {
                    setCurrentModule(nav.id);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  title={!isSidebarOpen ? nav.label : ''}
                  className={`flex items-center gap-3 py-2 rounded-lg text-sm transition-all text-left ${
                    isSidebarOpen ? 'px-3 w-full' : 'px-0 w-10 justify-center'
                  } ${
                    currentModule === nav.id
                      ? 'bg-blue-50 text-blue-700 font-bold shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg text-center w-6">{nav.icon}</span>
                  {isSidebarOpen && <span>{nav.label}</span>}
                </button>
              ))}
            </nav>

            <div
              className={`p-4 border-t border-slate-200 flex flex-col gap-2 ${
                !isSidebarOpen ? 'items-center px-1' : ''
              }`}
            >
              <div className={`flex ${isSidebarOpen ? 'gap-2' : 'flex-col gap-2 w-full'}`}>
                <label
                  className={`flex-1 text-center bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 font-bold py-1.5 rounded text-xs cursor-pointer shadow-sm transition-colors ${
                    !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                  }`}
                  title="Load HTML"
                >
                  {isSidebarOpen ? '📂 Load HTML' : '📂'}
                  <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                </label>

                <button
                  onClick={exportHTML}
                  className={`flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors ${
                    !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                  }`}
                  title="Save HTML"
                >
                  {isSidebarOpen ? '💾 Save HTML' : '💾'}
                </button>
              </div>

              <div className="flex gap-2 justify-center mt-2">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex === 0}
                  className={`p-2 rounded border shadow-sm transition-colors ${
                    historyIndex > 0
                      ? 'bg-white hover:bg-slate-50 text-slate-700'
                      : 'bg-slate-50 text-slate-300'
                  }`}
                  title="Undo"
                >
                  ↩
                </button>

                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= historyRef.current.length - 1}
                  className={`p-2 rounded border shadow-sm transition-colors ${
                    historyIndex < historyRef.current.length - 1
                      ? 'bg-white hover:bg-slate-50 text-slate-700'
                      : 'bg-slate-50 text-slate-300'
                  }`}
                  title="Redo"
                >
                  ↪
                </button>
              </div>
            </div>
          </div>

          {/* MAIN CONTENT */}
          <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden relative">
            {currentModule === 'dashboard' && (
              <div className="p-4 md:p-8 h-full overflow-y-auto custom-scrollbar bg-slate-50">
                <div className="max-w-6xl mx-auto">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 md:mb-8 border-b border-slate-200 pb-4 gap-4">
                    <div>
                      <h1 className="text-2xl md:text-3xl font-bold text-slate-800">
                        {datasetTitle || 'Dataset Overview'}
                      </h1>

                      <p className="text-sm md:text-base text-slate-500 mt-1">
                        {datasetSubtitle ||
                          'Manage your experiments, inventory, and protocols.'}
                      </p>
                    </div>

                    <button
                      onClick={handlePrint}
                      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print w-full md:w-auto justify-center"
                    >
                      🖨️ Print / Save PDF
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Total Tests
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {tests.filter((t) => t.type !== 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Stored Boxes
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {tests.filter((t) => t.type === 'plate-9x9box').length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Storage Units
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {storages.length}
                      </div>
                    </div>

                    <div className="bg-white p-4 md:p-5 rounded-lg border border-slate-200 shadow-sm">
                      <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wide">
                        Upcoming Tasks
                      </div>

                      <div className="text-2xl md:text-3xl font-bold text-slate-800 mt-1">
                        {
                          mergedPlan.filter(
                            (t) => t.date >= new Date().toISOString().split('T')[0]
                          ).length
                        }
                      </div>
                    </div>
                  </div>

                  <h2 className="text-lg font-bold text-slate-700 mb-4">Quick Navigation</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[
                      {
                        id: 'notebook',
                        icon: '📓',
                        title: 'Lab Notebook',
                        desc: 'Consolidated view of all experiment notes and results.'
                      },
                      {
                        id: 'definitions',
                        icon: '🏷️',
                        title: 'Definitions & Labels',
                        desc: 'Manage compounds, cell lines, and metadata fields.'
                      },
                      {
                        id: 'tests',
                        icon: '🧪',
                        title: 'Tests & Assays',
                        desc: 'Manage experimental plates and spectroscopic data.'
                      },
                      {
                        id: 'agenda',
                        icon: '🗓️',
                        title: 'Project Agenda',
                        desc: 'Timeline of all scheduled experimental tasks.'
                      },
                      {
                        id: 'protocols',
                        icon: '📝',
                        title: 'Protocols Library',
                        desc: 'Draft, store, and link experimental procedures.'
                      },
                      {
                        id: 'storage',
                        icon: '📦',
                        title: 'Storage & Inventory',
                        desc: 'Track physical boxes and storage locations.'
                      },
                      {
                        id: 'calculations',
                        icon: '🧮',
                        title: 'Calculations',
                        desc: 'Mass, volume, and preparation calculators.'
                      }
                    ].map((mod) => (
                      <button
                        key={mod.id}
                        onClick={() => setCurrentModule(mod.id)}
                        className="bg-white p-5 md:p-6 rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group no-print"
                      >
                        <div className="text-2xl mb-3 group-hover:scale-110 transition-transform duration-200">
                          {mod.icon}
                        </div>

                        <h3 className="font-bold text-slate-800 text-lg mb-1">{mod.title}</h3>

                        <p className="text-sm text-slate-500">{mod.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentModule === 'definitions' && (
              <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
                  <CollapsibleSection
                    title="Scientists / Operators"
                    subtitle="Add scientist name and surname."
                    defaultOpen={true}
                  >
                    <ScientistsOperatorsManager
                      operators={operators}
                      setOperators={setOperators}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Compound Sequence / Structure"
                    subtitle="Define sequence, SMILES, modifications, MW, and DNA generation."
                    defaultOpen={true}
                  >
                    <CompoundDefinitionSection
                      compoundOptions={allCmpds}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      compoundMeta={compoundMeta}
                      setCompoundMeta={setCompoundMeta}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Definitions & Labels"
                    subtitle="Cell lines, categories, colors, and labels."
                    defaultOpen={false}
                  >
                    <DefinitionsPanel
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      customCellLines={customCellLines}
                      setCustomCellLines={setCustomCellLines}
                      testCategories={testCategories}
                      setTestCategories={setTestCategories}
                      protocolCategories={protocolCategories}
                      setProtocolCategories={setProtocolCategories}
                      customFields={customFields}
                      setCustomFields={handleSetCustomFields}
                      customFieldTabOptions={CUSTOM_FIELD_TAB_OPTIONS}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      handlePrint={handlePrint}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Custom Metadata Fields"
                    subtitle="Collapsed by default. Add custom fields for plate, NMR, CD, or all tabs."
                    defaultOpen={false}
                  >
                    <CustomMetadataFieldsManager
                      customFields={customFields}
                      setCustomFields={handleSetCustomFields}
                    />
                  </CollapsibleSection>
                </div>
              </div>
            )}

            {currentModule === 'agenda' && (
              <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar flex flex-col">
                <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-4 gap-4">
                  <div>
                    <h2 className="text-xl md:text-2xl font-black text-slate-800">
                      Project Timeline
                    </h2>

                    <p className="text-sm text-slate-500">
                      Aggregated view of all tasks scheduled across tests.
                    </p>
                  </div>

                  <button
                    onClick={handlePrint}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print w-full md:w-auto justify-center"
                  >
                    🖨️ Print / Save PDF
                  </button>
                </div>

                <div className="flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-80 bg-white border border-slate-200 rounded-xl p-4 shadow-sm shrink-0 h-fit no-print">
                    <div className="flex justify-between items-center mb-4">
                      <button
                        onClick={handlePrevMonth}
                        className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors"
                      >
                        ◀
                      </button>

                      <h3 className="text-sm font-bold text-slate-700">{monthName}</h3>

                      <button
                        onClick={handleNextMonth}
                        className="text-slate-400 hover:text-blue-600 font-bold p-1 rounded hover:bg-slate-50 transition-colors"
                      >
                        ▶
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center mb-2">
                      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                        <div key={i} className="text-[11px] font-bold text-slate-400">
                          {d}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: startDayOffset }).map((_, i) => (
                        <div key={`empty-${i}`}></div>
                      ))}

                      {Array.from({ length: totalDays }, (_, i) => {
                        const day = String(i + 1).padStart(2, '0');
                        const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
                        const dateStr = `${currentMonth.getFullYear()}-${month}-${day}`;
                        const hasTask = mergedPlan.some((p) => p.date === dateStr);
                        const isSel = calFilterDate === dateStr;

                        return (
                          <button
                            key={i}
                            onClick={() => setCalFilterDate(isSel ? null : dateStr)}
                            className={`text-[11px] py-1.5 rounded-md transition-all font-medium ${
                              isSel
                                ? 'bg-blue-600 text-white shadow-md scale-105'
                                : hasTask
                                ? 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>

                    {calFilterDate && (
                      <button
                        onClick={() => setCalFilterDate(null)}
                        className="mt-4 w-full text-xs text-red-500 font-bold hover:bg-red-50 py-2 rounded transition-colors"
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>

                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 md:p-6 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-700 mb-4 border-b border-slate-100 pb-2">
                      {calFilterDate ? `Tasks for ${calFilterDate}` : 'All Scheduled Tasks'}
                    </h3>

                    <div className="flex flex-col gap-4">
                      {Object.keys(agendaGrouped).length === 0 ? (
                        <div className="text-center text-slate-400 py-10 italic">
                          No tasks planned across any test.
                        </div>
                      ) : (
                        (calFilterDate
                          ? agendaGrouped[calFilterDate]
                            ? [[calFilterDate, agendaGrouped[calFilterDate]]]
                            : []
                          : Object.entries(agendaGrouped)
                        ).map(([date, tasks]) => (
                          <div key={date} className="flex flex-col">
                            <h4 className="font-bold text-sm text-slate-500 mb-2">{date}</h4>

                            <div className="flex flex-col gap-2">
                              {tasks.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 bg-slate-50 p-3 border border-slate-200 rounded-lg group hover:border-blue-300 transition-colors"
                                >
                                  <button
                                    onClick={() => jumpToTest(t.testId)}
                                    className="text-xs font-bold bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shadow-sm self-start md:self-auto"
                                  >
                                    {t.testName}
                                  </button>

                                  <span className="text-sm text-slate-700 flex-1">{t.task}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentModule === 'storage' && (
              <StorageList
                storages={storages}
                tests={tests}
                setStorageModal={setStorageModal}
                setActiveStorageId={setActiveStorageId}
                setCurrentModule={setCurrentModule}
                handlePrint={handlePrint}
              />
            )}

            {currentModule === 'storage-detail' && (
              <StorageDetail
                storages={storages}
                activeStorageId={activeStorageId}
                tests={tests}
                setTests={setTests}
                setCurrentModule={setCurrentModule}
                handlePrint={handlePrint}
                jumpToTest={jumpToTest}
                setMoveModal={setMoveModal}
                createEmptyTest={createEmptyTest}
                setActiveTestId={setActiveTestId}
              />
            )}

            {currentModule === 'tests' &&
              (() => {
                const testSearch = expandedGroups['testSearch'] || '';
                const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
                const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                const newCatInput = expandedGroups['newTestCatInput'] || '';

                const filteredTestsRaw = tests.filter((t) => {
                  if (t.type === 'plate-9x9box') return false;

                  const matchesSearch =
                    t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
                    (t.instanceName || '').toLowerCase().includes(testSearch.toLowerCase());

                  const matchesCat =
                    testCatFilter === 'ALL' || t.testCategory === testCatFilter;

                  return matchesSearch && matchesCat;
                });

                const filteredTests = [];
                const seenTestNames = new Set();

                filteredTestsRaw.forEach((t) => {
                  if (!seenTestNames.has(t.name)) {
                    seenTestNames.add(t.name);
                    filteredTests.push(t);
                  }
                });

                return (
                  <div className="p-4 md:p-6 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <h2 className="text-xl md:text-2xl font-black text-slate-800">
                          Tests & Assays
                        </h2>

                        <p className="text-sm text-slate-500">
                          Manage experimental plates, spectroscopic data, and NMR fittings.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 no-print w-full md:w-auto">
                        <button
                          onClick={handlePrint}
                          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none"
                        >
                          🖨️ PDF
                        </button>

                        <button
                          onClick={() => {
                            const id = 't' + Date.now();

                            setTests((prev) => [
                              ...prev,
                              createEmptyTest(id, prev.length + 1, 'plate-96')
                            ]);

                            setActiveTestId(id);
                            setCurrentModule('active-test');
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
                        >
                          + Plate
                        </button>

                        <button
                          onClick={() => {
                            const id = 't' + Date.now();

                            setTests((prev) => [
                              ...prev,
                              createEmptyTest(id, prev.length + 1, 'nmr')
                            ]);

                            setActiveTestId(id);
                            setCurrentModule('active-test');
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
                        >
                          + NMR
                        </button>

                        <button
                          onClick={() => {
                            const id = 't' + Date.now();

                            setTests((prev) => [
                              ...prev,
                              createEmptyTest(id, prev.length + 1, 'cd')
                            ]);

                            setActiveTestId(id);
                            setCurrentModule('active-test');
                          }}
                          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
                        >
                          + CD
                        </button>

                        <button
                          onClick={() => {
                            const id = 't' + Date.now();

                            setTests((prev) => [
                              ...prev,
                              createEmptyTest(id, prev.length + 1, 'nmr-fittings')
                            ]);

                            setActiveTestId(id);
                            setCurrentModule('active-test');
                          }}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
                        >
                          + NMR Fittings
                        </button>
<button
  onClick={() => {
    const id = 't' + Date.now();
    setTests((prev) => [
      ...prev,
      createEmptyTest(id, prev.length + 1, 'cloning')
    ]);
    setActiveTestId(id);
    setCurrentModule('active-test');
  }}
  className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
  + Cloning
</button>

<button
  onClick={() => {
    const id = 't' + Date.now();
    setTests((prev) => [
      ...prev,
      createEmptyTest(id, prev.length + 1, 'protein_expression')
    ]);
    setActiveTestId(id);
    setCurrentModule('active-test');
  }}
  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
  + Protein Exp.
</button>

                      </div>
                    </div>

                    <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
                        <div className="flex-1 w-full relative">
                          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                          <input
                            type="text"
                            placeholder="Search tests by name..."
                            value={testSearch}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, testSearch: e.target.value }))
                            }
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="w-full md:w-64 flex gap-2">
                          <select
                            value={testCatFilter}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, testCatFilter: e.target.value }))
                            }
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer"
                          >
                            <option value="ALL">All Categories</option>

                            {testCategories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() =>
                              setExpandedGroups((p) => ({
                                ...p,
                                showTestCatMgr: !showCatMgr
                              }))
                            }
                            className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${
                              showCatMgr
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Manage Categories"
                          >
                            ⚙️
                          </button>
                        </div>
                      </div>

                      {showCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">
                            Manage Test Categories
                          </h4>

                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newCatInput}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  newTestCatInput: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                            />

                            <button
                              onClick={() => {
                                const v = newCatInput.trim();

                                if (v && !testCategories.includes(v)) {
                                  setTestCategories([...testCategories, v]);

                                  setExpandedGroups((p) => ({
                                    ...p,
                                    newTestCatInput: ''
                                  }));
                                }
                              }}
                              className="bg-blue-600 text-white font-bold px-4 py-2 rounded text-sm shadow-sm hover:bg-blue-700 transition-colors"
                            >
                              Add Category
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredTests.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No tests match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {filteredTests.map((test) => (
                            <div
                              key={test.id}
                              className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-400 cursor-pointer transition-all flex flex-col group relative"
                              onClick={() => {
                                setActiveTestId(test.id);
                                setCurrentModule('active-test');
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (
                                    window.confirm(
                                      `Eliminare definitivamente il test "${test.name}"?`
                                    )
                                  ) {
                                    setTests((prev) => prev.filter((t) => t.id !== test.id));
                                  }
                                }}
                                className="absolute top-3 right-10 text-slate-300 hover:text-red-500 text-xl opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity no-print z-10"
                                title="Elimina Test"
                              >
                                &times;
                              </button>

                              <div className="absolute top-3 right-3 text-2xl opacity-80 group-hover:scale-110 transition-transform">
                                {test.type === 'nmr'
  ? '📉'
  : test.type === 'cd'
  ? '🌀'
  : test.type === 'cloning'
  ? '🧬'  // <-- Aggiunto questo!
  : test.type === 'plate-9x9box'
  ? '📦'
  : test.type === 'nmr-fittings'
  ? '🧭'
  : '🧫'}
                              </div>

                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded self-start mb-2 border border-blue-100">
                                {test.testCategory || 'Uncategorized'}
                              </span>

                              <h3 className="font-bold text-slate-800 text-lg truncate pr-8">
                                {test.name}
                              </h3>

                              <p className="text-xs text-slate-500 mt-1">
                                Instance: {test.instanceName || 'Primary'}
                              </p>

                              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>📅 {test.date}</span>

                                <span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-600">
                                  {test.type === 'nmr-fittings'
                                    ? 'NMR FITTINGS'
                                    : test.type.replace('plate-', '').toUpperCase()}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            {currentModule === 'protocols' &&
              (() => {
                const protoSearch = expandedGroups['protoSearch'] || '';
                const protoCatFilter = expandedGroups['protoCatFilter'] || 'ALL';
                const showProtoCatMgr = expandedGroups['showProtoCatMgr'] || false;
                const newProtoCatInput = expandedGroups['newProtoCatInput'] || '';
                const activeProtoId = expandedGroups['activeProtoId'] || null;

                const filteredProtocols = datasetProtocols.filter((p) => {
                  const matchesSearch = p.title
                    .toLowerCase()
                    .includes(protoSearch.toLowerCase());

                  const matchesCat =
                    protoCatFilter === 'ALL' || p.category === protoCatFilter;

                  return matchesSearch && matchesCat;
                });

                const activeProtocol = activeProtoId
                  ? datasetProtocols.find((p) => p.id === activeProtoId)
                  : null;

                if (activeProtocol) {
                  return (
                    <div className="p-4 md:p-6 h-full flex flex-col bg-white">
                      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mb-6 border-b border-slate-100 pb-4 shrink-0">
                        <button
                          onClick={() =>
                            setExpandedGroups((p) => ({ ...p, activeProtoId: null }))
                          }
                          className="text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 p-2 rounded-lg transition-colors shadow-sm no-print self-start"
                        >
                          ◀ Back
                        </button>

                        <div className="flex-1 w-full">
                          <input
                            type="text"
                            value={activeProtocol.title}
                            onChange={(e) =>
                              setDatasetProtocols(
                                datasetProtocols.map((p) =>
                                  p.id === activeProtocol.id
                                    ? { ...p, title: e.target.value }
                                    : p
                                )
                              )
                            }
                            className="text-xl md:text-2xl font-black text-slate-800 bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-blue-500 rounded px-1"
                            placeholder="Protocol Title"
                          />
                        </div>

                        <select
                          value={activeProtocol.category}
                          onChange={(e) =>
                            setDatasetProtocols(
                              datasetProtocols.map((p) =>
                                p.id === activeProtocol.id
                                  ? { ...p, category: e.target.value }
                                  : p
                              )
                            )
                          }
                          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-slate-50 font-semibold text-slate-700 outline-none cursor-pointer w-full md:w-auto no-print"
                        >
                          {protocolCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex-1 flex flex-col lg:flex-row gap-6 overflow-y-auto lg:overflow-hidden">
                        <div className="flex-1 flex flex-col h-auto lg:h-full min-h-[300px]">
                          <label className="text-xs font-bold text-slate-500 uppercase mb-2">
                            Protocol Description & Steps
                          </label>

                          <RichTextEditor
                            value={activeProtocol.content || ''}
                            onChange={(val) =>
                              setDatasetProtocols(
                                datasetProtocols.map((p) =>
                                  p.id === activeProtocol.id ? { ...p, content: val } : p
                                )
                              )
                            }
                            placeholder="Write the detailed protocol steps here. You can paste images directly..."
                          />

                          <div className="mt-6 border-t border-slate-100 pt-4 no-print shrink-0">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
                              🧪 Tests Using This Protocol
                            </h4>

                            <div className="flex flex-wrap gap-2">
                              {
                                tests.filter(
                                  (t) =>
                                    t.linkedProtocolId === activeProtocol.id ||
                                    (Array.isArray(t.linkedProtocolIds) &&
                                      t.linkedProtocolIds.includes(activeProtocol.id))
                                ).length === 0 && (
                                  <span className="text-sm text-slate-400 italic">
                                    No tests are currently linked to this protocol.
                                  </span>
                                )
                              }

                              {tests
                                .filter(
                                  (t) =>
                                    t.linkedProtocolId === activeProtocol.id ||
                                    (Array.isArray(t.linkedProtocolIds) &&
                                      t.linkedProtocolIds.includes(activeProtocol.id))
                                )
                                .map((t) => (
                                  <button
                                    key={t.id}
                                    onClick={() => {
                                      setActiveTestId(t.id);
                                      setCurrentModule('active-test');
                                    }}
                                    className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1"
                                  >
                                    {t.type === 'nmr' ? '📉' : t.type === 'cd' ? '🌀' : '🧫'}{' '}
                                    {t.name} {t.instanceName ? `(${t.instanceName})` : ''}
                                  </button>
                                ))}
                            </div>
                          </div>
                        </div>

                        <div className="w-full lg:w-80 flex flex-col gap-4 lg:overflow-y-auto custom-scrollbar shrink-0 lg:border-l border-t lg:border-t-0 border-slate-100 pt-4 lg:pt-0 lg:pl-4 no-print">
                          <label className="text-xs font-bold text-slate-500 uppercase">
                            Attached Resources
                          </label>

                          <div className="flex flex-col gap-2">
                            {(activeProtocol.links || []).length === 0 && (
                              <span className="text-sm text-slate-400 italic">
                                No external links or documents attached.
                              </span>
                            )}

                            {(activeProtocol.links || []).map((link) => (
                              <div
                                key={link.id}
                                className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg flex items-center justify-between group shadow-sm"
                              >
                                <div
                                  className="flex items-center gap-2 overflow-hidden cursor-pointer flex-1"
                                  onClick={() => {
                                    const newName = prompt('Rename link:', link.name);

                                    if (newName) {
                                      setDatasetProtocols(
                                        datasetProtocols.map((p) =>
                                          p.id === activeProtocol.id
                                            ? {
                                                ...p,
                                                links: p.links.map((l) =>
                                                  l.id === link.id
                                                    ? { ...l, name: newName }
                                                    : l
                                                )
                                              }
                                            : p
                                        )
                                      );
                                    }
                                  }}
                                >
                                  <span className="text-lg">
                                    {link.url.match(/\.(jpeg|jpg|gif|png|svg)$/i)
                                      ? '🖼️'
                                      : '🔗'}
                                  </span>

                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm font-bold text-slate-700 truncate group-hover:text-blue-600"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {link.name}
                                  </a>
                                </div>

                                <button
                                  onClick={() =>
                                    setDatasetProtocols(
                                      datasetProtocols.map((p) =>
                                        p.id === activeProtocol.id
                                          ? {
                                              ...p,
                                              links: p.links.filter((l) => l.id !== link.id)
                                            }
                                          : p
                                      )
                                    )
                                  }
                                  className="text-slate-400 hover:text-red-500 font-bold px-2 py-1 transition-opacity"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => {
                                const urlsText = prompt(
                                  'Paste external link(s) separated by commas (Drive, PDF, Image URL):'
                                );

                                if (urlsText && urlsText.trim()) {
                                  const urls = urlsText
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);

                                  const newLinks = urls.map((url, idx) => ({
                                    id: Date.now().toString() + idx + Math.random(),
                                    name: 'Linked Resource',
                                    url
                                  }));

                                  setDatasetProtocols(
                                    datasetProtocols.map((p) =>
                                      p.id === activeProtocol.id
                                        ? { ...p, links: [...(p.links || []), ...newLinks] }
                                        : p
                                    )
                                  );
                                }
                              }}
                              className="border-2 border-dashed border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm"
                            >
                              + Add External Link(s)
                            </button>

                            <label className="border-2 border-dashed border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 font-bold rounded-lg p-3 text-center transition-colors shadow-sm text-sm cursor-pointer block">
                              + Attach Multiple Files

                              <input
                                type="file"
                                multiple
                                onChange={(e) => {
                                  const files = Array.from(e.target.files);

                                  if (!files.length) return;

                                  const newLinksPromises = files.map(
                                    (file) =>
                                      new Promise((resolve) => {
                                        const reader = new FileReader();

                                        reader.onload = (ev) =>
                                          resolve({
                                            id: Date.now().toString() + Math.random(),
                                            name: file.name,
                                            url: ev.target.result
                                          });

                                        reader.readAsDataURL(file);
                                      })
                                  );

                                  Promise.all(newLinksPromises).then((newLinks) => {
                                    setDatasetProtocols(
                                      datasetProtocols.map((p) =>
                                        p.id === activeProtocol.id
                                          ? { ...p, links: [...(p.links || []), ...newLinks] }
                                          : p
                                      )
                                    );
                                  });

                                  e.target.value = '';
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="p-4 md:p-6 h-full flex flex-col">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 border-b border-slate-200 pb-4">
                      <div>
                        <h2 className="text-xl md:text-2xl font-black text-slate-800">
                          Protocols Library
                        </h2>

                        <p className="text-sm text-slate-500">
                          Draft, store, and link your experimental procedures.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 no-print w-full md:w-auto">
                        <button
                          onClick={handlePrint}
                          className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm flex-1 md:flex-none"
                        >
                          🖨️ PDF
                        </button>

                        <button
                          onClick={() => {
                            const newProto = {
                              id: 'pr' + Date.now(),
                              title: 'Untitled Protocol',
                              category: protocolCategories[0] || 'Uncategorized',
                              content: '',
                              links: []
                            };

                            setDatasetProtocols([newProto, ...datasetProtocols]);

                            setExpandedGroups((p) => ({
                              ...p,
                              activeProtoId: newProto.id
                            }));
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg shadow-sm text-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2"
                        >
                          ➕ New Protocol
                        </button>
                      </div>
                    </div>

                    <div className="bg-white p-3 md:p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col gap-4 shrink-0 no-print">
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-center">
                        <div className="flex-1 w-full relative">
                          <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                          <input
                            type="text"
                            placeholder="Search protocols..."
                            value={protoSearch}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({ ...p, protoSearch: e.target.value }))
                            }
                            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="w-full md:w-64 flex gap-2">
                          <select
                            value={protoCatFilter}
                            onChange={(e) =>
                              setExpandedGroups((p) => ({
                                ...p,
                                protoCatFilter: e.target.value
                              }))
                            }
                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-500 font-semibold text-slate-700 cursor-pointer"
                          >
                            <option value="ALL">All Categories</option>

                            {protocolCategories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() =>
                              setExpandedGroups((p) => ({
                                ...p,
                                showProtoCatMgr: !showProtoCatMgr
                              }))
                            }
                            className={`px-3 py-2 border rounded-lg text-sm font-bold transition-colors shadow-sm ${
                              showProtoCatMgr
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                            title="Manage Categories"
                          >
                            ⚙️
                          </button>
                        </div>
                      </div>

                      {showProtoCatMgr && (
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col gap-3">
                          <h4 className="text-xs font-bold text-slate-500 uppercase">
                            Manage Protocol Categories
                          </h4>

                          <div className="flex flex-col md:flex-row gap-2">
                            <input
                              type="text"
                              placeholder="New category name..."
                              value={newProtoCatInput}
                              onChange={(e) =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  newProtoCatInput: e.target.value
                                }))
                              }
                              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500"
                            />

                            <button
                              onClick={() => {
                                const v = newProtoCatInput.trim();

                                if (v && !protocolCategories.includes(v)) {
                                  setProtocolCategories([...protocolCategories, v]);

                                  setExpandedGroups((p) => ({
                                    ...p,
                                    newProtoCatInput: ''
                                  }));
                                }
                              }}
                              className="bg-emerald-600 text-white font-bold px-4 py-2 rounded text-sm shadow-sm hover:bg-emerald-700 transition-colors"
                            >
                              Add
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2 mt-2">
                            {protocolCategories.map((c) => (
                              <div
                                key={c}
                                className="flex items-center gap-1 bg-white border border-slate-300 px-2 py-1 rounded text-xs shadow-sm font-semibold text-slate-700"
                              >
                                {c}

                                <button
                                  onClick={() =>
                                    setProtocolCategories(
                                      protocolCategories.filter((cat) => cat !== c)
                                    )
                                  }
                                  className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold"
                                >
                                  &times;
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredProtocols.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic">
                          No protocols match your filters.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {filteredProtocols.map((proto) => (
                            <div
                              key={proto.id}
                              className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 shadow-sm hover:shadow-md hover:border-emerald-400 cursor-pointer transition-all flex flex-col group relative"
                              onClick={() =>
                                setExpandedGroups((p) => ({
                                  ...p,
                                  activeProtoId: proto.id
                                }))
                              }
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (confirm('Delete this protocol?')) {
                                    setDatasetProtocols(
                                      datasetProtocols.filter((p) => p.id !== proto.id)
                                    );
                                  }
                                }}
                                className="absolute top-3 right-3 text-slate-300 hover:text-red-500 text-lg md:opacity-0 group-hover:opacity-100 transition-opacity no-print"
                                title="Delete Protocol"
                              >
                                &times;
                              </button>

                              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded self-start mb-3 border border-emerald-200">
                                {proto.category}
                              </span>

                              <h3 className="font-bold text-slate-800 text-lg truncate pr-6">
                                {proto.title}
                              </h3>

                              <div className="mt-4 pt-4 border-t border-slate-100 flex gap-4 text-xs font-bold text-slate-500">
                                <span className="flex items-center gap-1">
                                  🔗 {(proto.links || []).length} Links
                                </span>

                                <span className="flex items-center gap-1">
                                  📝 {proto.content ? 'Has Content' : 'Empty'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            {currentModule === 'active-test' &&
              (() => {
                const activeTest = tests.find((t) => t.id === activeTestId);

                if (!activeTest) return <div className="p-6">Test not found.</div>;

                const updateActiveTest = (updates) => {
                  setTests((prev) =>
                    prev.map((t) => (t.id === activeTestId ? { ...t, ...updates } : t))
                  );
                };

                const isBox = activeTest.type === 'plate-9x9box';

                const siblingTests = isBox
                  ? []
                  : tests
                      .filter((t) => t.name === activeTest.name && t.name.trim() !== '')
                      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

                const jumpToProtocolFn = (id) => {
                  setExpandedGroups((p) => ({ ...p, activeProtoId: id }));
                  setCurrentModule('protocols');
                };

                const handleDuplicateInstance = () => {
                  const id = 't' + Date.now();
                  const newTest = JSON.parse(JSON.stringify(activeTest));

                  newTest.id = id;
                  newTest.date = new Date().toISOString().split('T')[0];
                  newTest.instanceName = 'New Instance';
                  newTest.comments = '';
                  newTest.images = [];
                  newTest.documents = [];

                  if (
                    newTest.type.startsWith('plate-') &&
                    newTest.type !== 'plate-9x9box'
                  ) {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  if (newTest.type === 'nmr-fittings') {
                    newTest.grid = newTest.grid.map((row) => row.map(() => ''));
                  }

                  setTests((prev) => [...prev, newTest]);

                  setActiveTestId(id);
                };

                const TestHeader = (
                  <div className="flex flex-col shrink-0 z-20 no-print">
                    <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4 flex flex-col lg:flex-row justify-between items-start lg:items-center shadow-sm gap-4">
                      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full lg:w-auto">
                        <button
                          onClick={() => {
                            if (isBox && activeTest.storageId) {
                              setActiveStorageId(activeTest.storageId);
                              setCurrentModule('storage-detail');
                            } else {
                              setCurrentModule('tests');
                            }
                          }}
                          className="text-slate-400 hover:text-blue-600 transition-colors bg-slate-50 hover:bg-blue-50 p-2 rounded-lg shadow-sm border border-slate-200 self-start md:self-auto"
                        >
                          ◀ Back
                        </button>

                        <div className="flex-1 w-full">
                          <input
                            value={activeTest.name}
                            onChange={(e) => updateActiveTest({ name: e.target.value })}
                            className="text-xl font-black text-slate-800 bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 w-full md:w-64"
                            placeholder="Test Name"
                          />

                          <div className="text-xs text-slate-500 font-medium px-1 mt-1 flex items-center gap-2">
                            <span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                              {activeTest.testCategory}
                            </span>

                            <span className="uppercase text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {activeTest.type === 'nmr-fittings'
                                ? 'NMR FITTINGS'
                                : activeTest.type.replace('plate-', '')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto">
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                'Sei sicuro di voler eliminare definitivamente questo test?'
                              )
                            ) {
                              setTests((prev) => prev.filter((t) => t.id !== activeTest.id));
                              setCurrentModule('tests');
                            }
                          }}
                          className="bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 font-bold py-2 px-3 rounded-lg text-xs transition-colors border border-red-200 shadow-sm"
                        >
                          🗑️ Elimina
                        </button>

                        <div className="flex flex-col flex-1 w-full sm:w-auto">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Instance
                          </label>

                          <input
                            type="text"
                            value={activeTest.instanceName || ''}
                            onChange={(e) => updateActiveTest({ instanceName: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-lg outline-none focus:border-blue-500 w-full sm:w-32"
                            placeholder="e.g. 24h / Rep 1"
                          />
                        </div>

                        <div className="flex flex-col flex-1 w-full sm:w-auto">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Date
                          </label>

                          <input
                            type="date"
                            value={activeTest.date}
                            onChange={(e) => updateActiveTest({ date: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-3 py-2 rounded-lg outline-none focus:border-blue-500 w-full"
                          />
                        </div>
                      </div>
                    </div>

                    {siblingTests.length > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-2 flex items-center overflow-x-auto custom-scrollbar gap-2 shadow-inner">
                        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2 shrink-0">
                          ⏱️ Instances:
                        </span>

                        {siblingTests.map((t, idx) => (
                          <button
                            key={t.id}
                            onClick={() => setActiveTestId(t.id)}
                            className={`shrink-0 px-3 py-1.5 md:py-1 text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 shadow-sm group ${
                              activeTestId === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                            }`}
                          >
                            📅 {t.instanceName || t.date || `Inst ${idx + 1}`}

                            {siblingTests.length > 1 && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (
                                    confirm(
                                      `Delete instance ${t.instanceName || t.date}?`
                                    )
                                  ) {
                                    setTests((prev) => {
                                      const next = prev.filter((test) => test.id !== t.id);

                                      if (activeTestId === t.id) {
                                        setActiveTestId(
                                          next.find((x) => x.name === t.name)?.id ||
                                            next[0]?.id
                                        );
                                      }

                                      return next;
                                    });
                                  }
                                }}
                                className={`ml-1 px-1 opacity-100 md:opacity-0 group-hover:opacity-100 ${
                                  activeTestId === t.id
                                    ? 'text-blue-300 hover:text-white'
                                    : 'text-red-400 hover:text-red-600'
                                }`}
                              >
                                &times;
                              </span>
                            )}
                          </button>
                        ))}

                        <button
                          onClick={handleDuplicateInstance}
                          className="shrink-0 px-3 py-1.5 md:py-1 text-[10px] font-bold text-blue-600 border border-dashed border-blue-400 rounded-full hover:bg-blue-100 transition-colors bg-white shadow-sm ml-2"
                        >
                          + Add Timepoint/Copy
                        </button>
                      </div>
                    )}
                  </div>
                );

            if (activeTest.type === 'nmr') {
              return (
                <NMRTestRenderer
                  activeTest={activeTest}
                  updateActiveTest={updateActiveTest}
                  TestHeader={TestHeader}
                  datasetProtocols={datasetProtocols}
                  jumpToProtocol={jumpToProtocolFn}
                  allCmpds={allCmpds}
                  allCellLines={allCellLines}
                  customFields={customFields}
                  testCategories={testCategories}
                  instances={siblingTests}   // ← ADD THIS
                  operators={operators}      // ← ADD THIS
                />
              );
            }
                if (activeTest.type === 'cd') {
                  return (
                    <CDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                    />
                  );
                }

                if (activeTest.type === 'plate-9x9box') {
                  return (
                    <BoxDetail
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      storages={storages}
                      expandedGroups={expandedGroups}
                      setExpandedGroups={setExpandedGroups}
                      customCmpds={customCmpds}
                      jumpToTest={jumpToTest}
                      setMoveModal={setMoveModal}
                      TestHeader={TestHeader}
                    />
                  );
                }
if (activeTest.type === 'cloning') {
  return (
    <CloningTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      operators={operators}
      instances={siblingTests}
    />
  );
}
if (activeTest.type === 'nmr-fittings') {
  return (
    <NMRFittingsTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      TestHeader={TestHeader}
      operators={operators}
      molecules={molecules}
      compoundMeta={compoundMeta} // <-- AGGIUNGI QUESTA RIGA
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      customConc={customConc}
      setCustomConc={setCustomConc}
      cmpColors={cmpColors}
      setCmpColors={setCmpColors}
      customCmpds={customCmpds}
      setCustomCmpds={setCustomCmpds}
      appClipboard={appClipboard}
      setAppClipboard={setAppClipboard}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
    />
  );
}
if (activeTest.type === 'cloning') {
  return (
    <TestShellRenderer
      config={CLONING_TAB_CONFIG}
      custom={{
        Data: CloningDataSection
      }}
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
    />
  );
}

if (activeTest.type === 'protein_expression') {
  return (
    <ProteinExpressionTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      operators={operators}
      instances={siblingTests}
    />
  );
}

                if (
                  activeTest.type.startsWith('plate-') &&
                  activeTest.type !== 'plate-9x9box'
                ) {
                  return (
                    <PlateTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      customConc={customConc}
                      setCustomConc={setCustomConc}
                      cmpColors={cmpColors}
                      setCmpColors={setCmpColors}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      jumpToTest={(id) => {
                        setActiveTestId(id);
                        setCurrentModule('active-test');
                      }}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                    />
                  );
                }

                return <div className="p-6">Unknown test type.</div>;
              })()}

            {currentModule === 'notebook' &&
              (() => {
                const getVal = (key, def) =>
                  expandedGroups[key] !== undefined ? expandedGroups[key] : def;

                const notebookSearch = getVal('notebookSearch', '');

                const filteredTests = tests.filter((t) => {
                  if (!notebookSearch) return true;

                  const query = notebookSearch.toLowerCase();

                  return JSON.stringify(t).toLowerCase().includes(query);
                });

                return (
                  <div className="flex flex-col h-full w-full">
                    <div className="bg-white p-3 md:p-4 border-b border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between no-print shrink-0 gap-3">
                      <div className="w-full md:flex-1 md:max-w-md relative">
                        <span className="absolute left-3 top-2.5 text-slate-400">🔍</span>

                        <input
                          type="text"
                          placeholder="Generic search in test data..."
                          value={notebookSearch}
                          onChange={(e) =>
                            setExpandedGroups((p) => ({
                              ...p,
                              notebookSearch: e.target.value
                            }))
                          }
                          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden relative">
                      <LabNotebook
                        tests={filteredTests}
                        allCellLines={allCellLines}
                        testCategories={testCategories}
                        jumpToTest={(id) => {
                          setActiveTestId(id);
                          setCurrentModule('active-test');
                        }}
                        customConc={customConc}
                        cmpColors={cmpColors}
                        allCmpds={allCmpds}
                        customFields={customFields}
                      />
                    </div>
                  </div>
                );
              })()}

            {currentModule === 'calculations' && (
              <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                <Calculations
                  compoundOptions={allCmpds}
                  compoundMeta={compoundMeta}
                  calculationEntries={calculationEntries}
                  setCalculationEntries={setCalculationEntries}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
