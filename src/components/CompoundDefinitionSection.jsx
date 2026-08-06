// src/components/CompoundDefinitionSection.jsx

import React, { useMemo, useState } from 'react';
import {
  calculateSequenceInfo,
  generateDnaFromProtein,
  calculateSmilesInfoAsync
} from '../utils/labMolecules';

const inputCls =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';

const labelCls = 'block text-xs font-bold text-slate-500 uppercase mb-1';

export function CompoundDefinitionSection({
  compoundOptions = [],
  customCmpds = [],
  setCustomCmpds,
  compoundMeta = {},
  setCompoundMeta
}) {
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

    if (selectedMeta?.molecularWeight) {
      return Number(selectedMeta.molecularWeight);
    }

    return null;
  }, [manualMw, computed, selectedMeta]);

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
          <label className={labelCls}>Existing compound</label>
          <select
            value={selectedName}
            onChange={(e) => chooseCompound(e.target.value)}
            className={inputCls}
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
          <label className={labelCls}>New compound name</label>
          <input
            type="text"
            value={selectedName ? '' : newName}
            disabled={!!selectedName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Peptide-01"
            className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}
          />
        </div>

        <div className="lg:col-span-3">
          <label className={labelCls}>Molecule type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="protein">Protein / Peptide</option>
            <option value="dna">DNA</option>
            <option value="rna">RNA</option>
            <option value="polysaccharide">Polysaccharide</option>
            <option value="smiles">SMILES small molecule</option>
          </select>
        </div>

        <div className="lg:col-span-3">
          <label className={labelCls}>Codon host</label>
          <select
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={type !== 'protein'}
            className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <option value="bacterial">Bacterial</option>
            <option value="mammalian">Mammalian</option>
          </select>
        </div>
      </div>

      {type === 'smiles' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
          <div className="lg:col-span-9">
            <label className={labelCls}>SMILES</label>
            <input
              type="text"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
              className={inputCls}
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
            <label className={labelCls}>
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
              className={`${inputCls} h-32 font-mono`}
            />
          </div>

          <div className="lg:col-span-5">
            <label className={labelCls}>Modifications</label>
            <textarea
              value={modText}
              onChange={(e) => setModText(e.target.value)}
              placeholder="e.g. Phosphorylation, Acetylation, Amidation:2"
              className={`${inputCls} h-32`}
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
          <label className={labelCls}>Manual MW override, Da</label>
          <input
            type="number"
            value={manualMw}
            onChange={(e) => setManualMw(e.target.value)}
            placeholder="Optional"
            className={inputCls}
          />
        </div>

        <div className="md:col-span-3">
          <label className={labelCls}>Calculated MW</label>
          <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">
            {effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}
          </div>
        </div>

        <div className="md:col-span-2">
          <label className={labelCls}>Length</label>
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
          <label className={labelCls}>
            Generated DNA sequence, {host} preferred codons
          </label>
          <textarea
            readOnly
            value={dnaPreview}
            className={`${inputCls} h-28 font-mono bg-slate-50`}
          />
        </div>
      )}
    </div>
  );
}
