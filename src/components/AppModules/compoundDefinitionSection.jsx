/* =========================================================================
   src/components/AppModules/compoundDefinitionSection.jsx
   Compound definition section (sequence / SMILES / formula / MW) extracted
   from App.jsx. NOTE: src/components/CompoundDefinitionSection.jsx is a
   DIFFERENT (older) version with a 3D preview, used by DefinitionsPanel.
   ========================================================================= */

import React, { useState, useEffect, useMemo } from 'react';
import { SearchableSelect } from '../SearchableSelect';
import { RichTextEditor } from '../RichTextEditor';
import { LinksManager } from './librarySections';
import { CALC_INPUT_CLS, CALC_LABEL_CLS } from '../../utils/styles';
import { stripHtml, calculateSequenceInfo, generateDnaFromProtein, calculateSmilesInfoAsync } from '../../utils/sequenceInfo';
import { getMolecularWeightFromFormula } from '../DefinitionsExtra';

export const CompoundDefinitionSection = ({
  compoundOptions = [],
  customCmpds = [],
  setCustomCmpds,
  compoundMeta = {},
  setCompoundMeta,
  selectedId,
  onSelect    
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
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState([]);

  useEffect(() => {
    if (selectedId) chooseCompound(selectedId);
  }, [selectedId]);

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
      setType('protein');
      setSequence('');
      setModText('');
      setSmiles('');
      setHost('bacterial');
      setManualMw('');
      setNotes('');
      setLinks([]);
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
    setNotes(meta.notes || '');
    setLinks(meta.links || []);
    setManualMw('');
  };

  const computed = useMemo(() => {
    if (type === 'smiles' || type === 'formula') return null;
    if (!stripHtml(sequence).trim()) return null;

    return calculateSequenceInfo({
      type,
      sequence,
      modifications: modText
    });
  }, [type, sequence, modText]);

  const dnaPreview = useMemo(() => {
    if (type !== 'protein' || !stripHtml(sequence).trim()) return '';
    return generateDnaFromProtein(sequence, host);
  }, [type, sequence, host]);

  const effectiveMw = useMemo(() => {
    const manual = parseFloat(manualMw);

    if (Number.isFinite(manual) && manual > 0) {
      return manual;
    }

    if (type === 'formula' && stripHtml(sequence).trim()) {
      const calc = getMolecularWeightFromFormula(stripHtml(sequence).trim());
      if (calc) return Number(calc);
    }

    if (computed?.molecularWeight) {
      return Number(computed.molecularWeight);
    }

    if (selectedMw) {
      return Number(selectedMw);
    }

    return null;
  }, [manualMw, type, sequence, computed, selectedMw]);

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
      modifications: (type === 'smiles' || type === 'formula') ? '' : modText,
      smiles: type === 'smiles' ? smiles : '',
      notes,
      links,
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

  const deleteCompound = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setCompoundMeta((prev) => {
        const next = { ...prev };
        delete next[selectedName];
        return next;
      });
      setCustomCmpds((prev) => prev.filter((c) => (typeof c === 'string' ? c : c?.name) !== selectedName));
      chooseCompound('');
      if (onSelect) onSelect('');
    }
  };

  // ---- CSV BULK IMPORT HANDLER ----
  const handleCsvImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const lines = text.split(/\r?\n/);
      
      let addedCount = 0;
      
      setCompoundMeta((prevMeta) => {
        const nextMeta = { ...prevMeta };
        const newNames = [];
        
        lines.forEach((line, i) => {
          if (i === 0 && line.toLowerCase().includes('name')) return; // Skip header
          if (!line.trim()) return;
          
          // Split by comma, tab, or semicolon
          const cols = line.split(/[,;\t]/).map(s => s.trim());
          const name = cols[0];
          const seq = cols[1] || '';
          const importedType = cols[2] ? cols[2].toLowerCase() : 'protein';
          
          if (name) {
            nextMeta[name] = {
              ...(nextMeta[name] || {}),
              name,
              type: importedType,
              sequence: importedType !== 'smiles' && importedType !== 'formula' ? seq : '',
              smiles: importedType === 'smiles' ? seq : '',
              formula: importedType === 'formula' ? seq : '',
              notes: 'Imported from CSV',
              updatedAt: Date.now()
            };
            newNames.push(name);
            addedCount++;
          }
        });
        
        // Update the global custom compounds list
        setCustomCmpds((prevCustom) => {
          const nextCustom = [...prevCustom];
          newNames.forEach(n => {
            if (!nextCustom.includes(n) && !nextCustom.some(c => typeof c === 'object' && c.name === n)) {
              nextCustom.push(n);
            }
          });
          return nextCustom;
        });
        
        return nextMeta;
      });

      setTimeout(() => alert(`Successfully imported ${addedCount} compounds!`), 100);
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
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
        Define a compound by one-letter sequence, modifications, SMILES, or Chemical Formula. Molecular weight and
        length are calculated automatically. For proteins, an optimized DNA sequence can be
        generated.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        <div className="lg:col-span-3">
          <label className={CALC_LABEL_CLS}>Existing compound</label>

          <SearchableSelect
            value={selectedName}
            onChange={(v) => chooseCompound(v)}
            options={existingNames}
            placeholder="New compound..."
            onClear={() => chooseCompound('')}
          />
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
            <option value="formula">Chemical Formula</option>
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
      ) : type === 'formula' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
          <div className="lg:col-span-12">
            <label className={CALC_LABEL_CLS}>Chemical Formula</label>
            <input
              type="text"
              value={sequence}
              onChange={(e) => setSequence(e.target.value)}
              placeholder="e.g. C6H12O6 or CuSO4.5H2O"
              className={CALC_INPUT_CLS}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
          <div className="lg:col-span-7">
            <label className={CALC_LABEL_CLS}>
              One-letter sequence
              {type === 'polysaccharide' ? ' or tokens' : ''}
            </label>

            <div className="border border-slate-300 rounded-lg overflow-hidden bg-white font-mono">
              <RichTextEditor
                value={sequence}
                onChange={(val) => setSequence(val)}
                placeholder={
                  type === 'protein'
                    ? 'e.g. MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEGFLCVFAINNTKSFEDIHQYREQIKRVKDSDDVPMVLVGNKCDLPSRTVDTKQAQDLARSYGIPFIETSAKTRQGVEDAFYTLVREIRQHKLRKLNPPDESGPGCMSCKCVLS'
                    : type === 'dna'
                    ? 'e.g. ATGGCTGAC...'
                    : type === 'rna'
                    ? 'e.g. AUGGCUGAC...'
                    : 'e.g. G-M-N-F-S or GMNFS'
                }
              />
            </div>
          </div>

          <div className="lg:col-span-5">
            <label className={CALC_LABEL_CLS}>Modifications</label>

            <textarea
              value={modText}
              onChange={(e) => setModText(e.target.value)}
              placeholder="e.g. Phosphorylation, Acetylation, Amidation:2"
              className={`${CALC_INPUT_CLS} h-[138px]`}
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
      
      <div className="grid grid-cols-1 mb-4">
        <label className={CALC_LABEL_CLS}>Additional Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Solubility, handling, properties, etc."
          className={`${CALC_INPUT_CLS} h-20`}
        />
      </div>

      <LinksManager links={links} setLinks={setLinks} tableName="compounds" elementName={selectedName || newName.trim()} />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mt-4 mb-4">
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

        <div className="md:col-span-4 flex items-end justify-end gap-2">
          {/* BULK IMPORT BUTTON */}
          <label className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors cursor-pointer text-center">
            Import CSV
            <input type="file" accept=".csv,.txt" onChange={handleCsvImport} className="hidden" />
          </label>

          {selectedName && (
            <button
              type="button"
              onClick={deleteCompound}
              className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={saveCompound}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            Save Compound
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

