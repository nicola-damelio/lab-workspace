import React, { useState } from 'react';
import { CompoundDefinitionSection } from './CompoundDefinitionSection';
import { SolventsManager, BuffersManager, AdditivesManager, NMRProbesManager, NMRInstrumentsManager, NMRExperimentsManager } from './DefinitionsExtra';
import { CollapsibleSectionPanel as CollapsibleSection } from './ui';

/* ============================================================
DefinitionsPanel
============================================================ */

/* CollapsibleSectionPanel (library panel style) now lives in ./ui; imported
   above as CollapsibleSection so existing call sites are unchanged. */

const TagManager = ({ items, onAdd, onRemove, onRename, color, placeholder, icon }) => {
  const [input, setInput] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editVal, setEditVal] = useState('');
  const handleAdd = () => {
    const v = input.trim();
    if (v && !items.includes(v)) { onAdd(v); setInput(''); }
  };
  const handleRename = (idx) => {
    const v = editVal.trim();
    if (v && v !== items[idx]) onRename(items[idx], v);
    setEditingIdx(null);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }} placeholder={placeholder} className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        <button onClick={handleAdd} className={`${color} text-white font-bold px-4 py-2 rounded-lg text-sm shadow-sm hover:opacity-90 transition-opacity`}>+ Add</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <span className="text-sm text-slate-400 italic py-2">No items defined yet.</span>}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5 bg-white border border-slate-300 px-3 py-1.5 rounded-lg text-sm shadow-sm font-semibold text-slate-700 group">
            {icon && <span className="text-xs opacity-60">{icon}</span>}
            {editingIdx === idx ? (
              <input type="text" value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRename(idx); if (e.key === 'Escape') setEditingIdx(null); }} onBlur={() => handleRename(idx)} autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-sm outline-none w-28" />
            ) : (
              <span className="cursor-pointer hover:text-blue-600 transition-colors" onDoubleClick={() => { setEditingIdx(idx); setEditVal(item); }} title="Double-click to rename">{item}</span>
            )}
            <button onClick={() => onRemove(item)} className="text-slate-400 hover:text-red-500 ml-1 text-sm leading-none font-bold opacity-0 group-hover:opacity-100 transition-opacity">×</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DefinitionsPanel = ({
  customCmpds, setCustomCmpds,
  customCellLines, setCustomCellLines,
  customPlasmids, setCustomPlasmids,
  testCategories, setTestCategories,
  protocolCategories, setProtocolCategories,
  customFields, setCustomFields,
  operators, setOperators,
  solvents, setSolvents,
  buffers, setBuffers,
  additives, setAdditives,
  nmrInstruments, setNmrInstruments,
  nmrProbes, setNmrProbes,
  nmrExperiments, setNmrExperiments,
  compoundMeta, setCompoundMeta,
  cellLineMeta, setCellLineMeta,
  plasmidMeta, setPlasmidMeta,
  activeLibrarySelection, setActiveLibrarySelection,
  mandatoryFields = [], setMandatoryFields,
  handlePrint
}) => {
  const allCmpds = [...new Set([...customCmpds, ...Object.keys(compoundMeta || {})])].filter(Boolean);

  return (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">

        {/* 1. LIBRARY DIRECTORY */}
        <CollapsibleSection title="Library Directory" subtitle="Click any item to view or edit its full details." defaultOpen={false}>
          <p className="text-sm text-slate-500 mb-3">All defined compounds, cell lines, plasmids, solvents, buffers, and instrument configurations appear here. Click to edit.</p>
          <div className="flex flex-wrap gap-2">
             <span className="text-xs text-slate-500 italic">Library Directory is active globally. Select items from headers below to edit.</span>
          </div>
        </CollapsibleSection>

        {/* 2. COMPOUND SEQUENCE / STRUCTURE */}
        <CollapsibleSection id="section-compound" title="Compound Sequence / Structure" subtitle="Define sequence, SMILES, modifications, MW." defaultOpen={activeLibrarySelection?.type === 'compound'}>
          <CompoundDefinitionSection
            compoundOptions={allCmpds}
            customCmpds={customCmpds}
            setCustomCmpds={setCustomCmpds}
            compoundMeta={compoundMeta}
            setCompoundMeta={setCompoundMeta}
            selectedId={activeLibrarySelection?.type === 'compound' ? activeLibrarySelection.id : null}
            onSelect={(id) => setActiveLibrarySelection({ type: 'compound', id })}
          />
        </CollapsibleSection>

        {/* 3. CELL LINE DEFINITIONS */}
        <CollapsibleSection id="section-cellLine" title="Cell Line Definitions" subtitle="Define organism, tissue, and culture medium." defaultOpen={activeLibrarySelection?.type === 'cellLine'}>
          <TagManager
            items={customCellLines}
            onAdd={(name) => setCustomCellLines((prev) => [...prev, name])}
            onRemove={(name) => setCustomCellLines((prev) => prev.filter((c) => c !== name))}
            onRename={(oldN, newN) => setCustomCellLines((prev) => prev.map((c) => c === oldN ? newN : c))}
            color="bg-emerald-600 hover:bg-emerald-700"
            placeholder="e.g. HEK293T, HeLa, BL21(DE3)..."
            icon="🦠"
          />
        </CollapsibleSection>

        {/* 4. PLASMID DEFINITIONS */}
        <CollapsibleSection id="section-plasmid" title="Plasmid Definitions" subtitle="Define backbone, promoters, resistance, and sequences." defaultOpen={activeLibrarySelection?.type === 'plasmid'}>
          <TagManager
            items={customPlasmids || []}
            onAdd={(name) => setCustomPlasmids((prev) => [...prev, name])}
            onRemove={(name) => setCustomPlasmids((prev) => prev.filter((c) => c !== name))}
            onRename={(oldN, newN) => setCustomPlasmids((prev) => prev.map((c) => c === oldN ? newN : c))}
            color="bg-violet-600 hover:bg-violet-700"
            placeholder="e.g. pET-28a, pGEX-6P-1..."
            icon="🧬"
          />
        </CollapsibleSection>

        {/* 5. SOLVENTS AND MEDIA */}
        <CollapsibleSection id="section-solvent" title="Solvents & Media" subtitle="Define solvents and media that appear as dropdowns in all experiment pages." defaultOpen={activeLibrarySelection?.type === 'solvent'}>
          <SolventsManager solvents={solvents} setSolvents={setSolvents} selectedId={activeLibrarySelection?.type === 'solvent' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'solvent', id })} />
        </CollapsibleSection>

        {/* 6. BUFFERS */}
        <CollapsibleSection id="section-buffer" title="Buffers" subtitle="Define buffers with optional description (e.g. PBS pH 7.4)." defaultOpen={activeLibrarySelection?.type === 'buffer'}>
          <BuffersManager buffers={buffers} setBuffers={setBuffers} selectedId={activeLibrarySelection?.type === 'buffer' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'buffer', id })} />
        </CollapsibleSection>

        {/* 7. ADDITIVES */}
        <CollapsibleSection id="section-additive" title="Additives" subtitle="Define additives (NaN3, DTT, EDTA...) for Experimental Conditions." defaultOpen={activeLibrarySelection?.type === 'additive'}>
          <AdditivesManager additives={additives} setAdditives={setAdditives} selectedId={activeLibrarySelection?.type === 'additive' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'additive', id })} />
        </CollapsibleSection>

        {/* 8. NMR INSTRUMENTS */}
        <CollapsibleSection id="section-nmrInstrument" title="Instruments" subtitle="Define NMR spectrometers: frequency in MHz, available probes." defaultOpen={activeLibrarySelection?.type === 'nmrInstrument'}>
          <NMRInstrumentsManager nmrInstruments={nmrInstruments} setNmrInstruments={setNmrInstruments} nmrProbes={nmrProbes} selectedId={activeLibrarySelection?.type === 'nmrInstrument' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrInstrument', id })} />
        </CollapsibleSection>

        {/* 9. NMR PROBES */}
        <CollapsibleSection id="section-nmrProbe" title="NMR Probes" subtitle="Define probe name, type, subtype, field, diameter, cryo, and sample state." defaultOpen={activeLibrarySelection?.type === 'nmrProbe'}>
          <NMRProbesManager nmrProbes={nmrProbes} setNmrProbes={setNmrProbes} selectedId={activeLibrarySelection?.type === 'nmrProbe' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrProbe', id })} />
        </CollapsibleSection>

        {/* 10. NMR EXPERIMENTS / PULSE PROGRAMS */}
        <CollapsibleSection id="section-nmrExperiment" title="NMR Experiments" subtitle="Define pulse programs: nuclei, dimensions, and custom acquisition parameters." defaultOpen={activeLibrarySelection?.type === 'nmrExperiment'}>
          <NMRExperimentsManager nmrExperiments={nmrExperiments} setNmrExperiments={setNmrExperiments} selectedId={activeLibrarySelection?.type === 'nmrExperiment' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrExperiment', id })} />
        </CollapsibleSection>

        {/* 11. TEST CATEGORIES */}
        <CollapsibleSection title="Test Categories" subtitle="Primary classification categories for all experiments." defaultOpen={false}>
          <TagManager
            items={testCategories}
            onAdd={(name) => setTestCategories((prev) => [...prev, name])}
            onRemove={(name) => setTestCategories((prev) => prev.filter((c) => c !== name))}
            onRename={(oldN, newN) => setTestCategories((prev) => prev.map((c) => c === oldN ? newN : c))}
            color="bg-purple-600 hover:bg-purple-700"
            placeholder="e.g. Activity, Toxicity, Binding..."
            icon="📋"
          />
        </CollapsibleSection>

        {/* 12. SCIENTISTS / OPERATORS */}
        <CollapsibleSection title="Scientists / Operators" subtitle="Add scientist name and surname." defaultOpen={false}>
          <TagManager
            items={operators}
            onAdd={(name) => setOperators((prev) => [...prev, name])}
            onRemove={(name) => setOperators((prev) => prev.filter((c) => c !== name))}
            onRename={(oldN, newN) => setOperators((prev) => prev.map((c) => c === oldN ? newN : c))}
            color="bg-indigo-600 hover:bg-indigo-700"
            placeholder="e.g. Marie Curie..."
            icon="👤"
          />
        </CollapsibleSection>

        {/* 13. CUSTOM METADATA FIELDS */}
        <CollapsibleSection title="Custom Metadata Fields" subtitle="Add custom fields. Choose placement: Experimental Conditions or Instrumental Setup." defaultOpen={false}>
          <CustomMetadataFieldsManager customFields={customFields} setCustomFields={setCustomFields} />
        </CollapsibleSection>

        {/* 14. MANDATORY PARAMETERS */}
        <CollapsibleSection title="Mandatory Parameters" subtitle="Define fields that must be filled out in every test." defaultOpen={true}>
          <TagManager
            items={mandatoryFields}
            onAdd={(name) => setMandatoryFields((prev) => [...prev, name])}
            onRemove={(name) => setMandatoryFields((prev) => prev.filter((c) => c !== name))}
            onRename={(oldN, newN) => setMandatoryFields((prev) => prev.map((c) => c === oldN ? newN : c))}
            color="bg-red-600 hover:bg-red-700"
            placeholder="e.g. Operator, Solvent, Temperature..."
            icon="⚠️"
          />
          <p className="text-xs text-slate-500 mt-2">
            Type the exact name of the field (e.g., "Operator", "Solvent", "Experiment Type", or the name of a Custom Metadata Field). A warning will appear at the top of any test where these fields are left blank.
          </p>
        </CollapsibleSection>

      </div>
    </div>
  );
};

/* ============================================================
CUSTOM METADATA FIELDS MANAGER with Placement option
============================================================ */
const CustomMetadataFieldsManager = ({ customFields = [], setCustomFields }) => {
  const [draft, setDraft] = useState({ name: '', type: 'text', options: '', appliesTo: 'all', placement: 'conditions' });

  const addField = () => {
    const name = draft.name.trim();
    if (!name) { alert('Please enter a field name.'); return; }
    const options = draft.type === 'select' ? draft.options.split(',').map((opt) => opt.trim()).filter(Boolean) : [];
    const newField = {
      id: `custom_field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name, type: draft.type, options,
      appliesTo: draft.appliesTo || 'all',
      placement: draft.placement || 'conditions'
    };
    setCustomFields((prev) => [...(Array.isArray(prev) ? prev : []), newField]);
    setDraft({ name: '', type: 'text', options: '', appliesTo: 'all', placement: 'conditions' });
  };

  const updateField = (id, patch) => {
    setCustomFields((prev) => (Array.isArray(prev) ? prev : []).map((field) => field.id === id ? { ...field, ...patch } : field));
  };

  const removeField = (id) => {
    setCustomFields((prev) => (Array.isArray(prev) ? prev : []).filter((field) => field.id !== id));
  };

  const TAB_OPTIONS = [
    { value: 'all', label: 'All tabs' },
    { value: 'plate', label: 'Plate' },
    { value: 'nmr', label: 'NMR' },
    { value: 'cd', label: 'CD' },
    { value: 'nmrfitting', label: 'NMR Fittings' },
    { value: 'cloning', label: 'Cloning' },
    { value: 'protein_expression', label: 'Protein Expression' },
    { value: 'md_simulation', label: 'MD Simulations' }
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Field Name</label>
          <input type="text" value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Instrument" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
          <select value={draft.type} onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="textarea">Textarea</option>
            <option value="select">Select</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Options</label>
          <input type="text" value={draft.options} onChange={(e) => setDraft((prev) => ({ ...prev, options: e.target.value }))} disabled={draft.type !== 'select'} placeholder={draft.type === 'select' ? 'Comma separated' : 'N/A'} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400" />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tab Type</label>
          <select value={draft.appliesTo} onChange={(e) => setDraft((prev) => ({ ...prev, appliesTo: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            {TAB_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Placement</label>
          <select value={draft.placement} onChange={(e) => setDraft((prev) => ({ ...prev, placement: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
            <option value="conditions">Experimental Conditions</option>
            <option value="instrumental">Instrumental Setup</option>
          </select>
        </div>
        <div className="md:col-span-1 flex items-end">
          <button type="button" onClick={addField} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-2 rounded-lg text-sm shadow-sm transition-colors">+</button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {(Array.isArray(customFields) ? customFields : []).length === 0 ? (
          <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">No custom metadata fields defined.</div>
        ) : (
          (Array.isArray(customFields) ? customFields : []).map((field) => (
            <div key={field.id || field.name} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-3">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Field Name</label>
                  <input type="text" value={field.name || ''} onChange={(e) => updateField(field.id, { name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Type</label>
                  <select value={field.type || 'text'} onChange={(e) => updateField(field.id, { type: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                    <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="textarea">Textarea</option><option value="select">Select</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Options</label>
                  <input type="text" value={(field.options || []).join(', ')} onChange={(e) => updateField(field.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })} disabled={field.type !== 'select'} placeholder={field.type === 'select' ? 'Comma separated' : 'N/A'} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Tab Type</label>
                  <select value={Array.isArray(field.appliesTo) ? field.appliesTo[0] || 'all' : field.appliesTo || 'all'} onChange={(e) => updateField(field.id, { appliesTo: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                    {TAB_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Placement</label>
                  <select value={field.placement || 'conditions'} onChange={(e) => updateField(field.id, { placement: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500">
                    <option value="conditions">Experimental Conditions</option>
                    <option value="instrumental">Instrumental Setup</option>
                  </select>
                </div>
                <div className="md:col-span-1 flex items-end justify-end">
                  <button type="button" onClick={() => removeField(field.id)} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-3 rounded-lg text-sm transition-colors">✕</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DefinitionsPanel;