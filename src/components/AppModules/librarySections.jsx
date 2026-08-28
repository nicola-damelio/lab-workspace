/* =========================================================================
   src/components/AppModules/librarySections.jsx
   Library definition sections (Links, Cell Lines, Plasmids, LibraryTable),
   extracted from App.jsx. Each component is self-contained and only receives
   props, so App.jsx simply imports them back.
   ========================================================================= */

import React, { useState, useEffect, useMemo } from 'react';
import { SearchableSelect } from '../SearchableSelect';
import { RichTextEditor } from '../RichTextEditor';
import { CALC_INPUT_CLS, CALC_LABEL_CLS } from '../../utils/styles';
import { LibraryDocUpload } from '../DefinitionsExtra';

export const LinksManager = ({ links = [], setLinks, tableName = '', elementName = '' }) => {
  const addLink = () => setLinks([...links, { url: '', description: '' }]);
  const updateLink = (idx, field, val) => {
    const newLinks = [...links];
    newLinks[idx][field] = val;
    setLinks(newLinks);
  };
  const removeLink = (idx) => setLinks(links.filter((_, i) => i !== idx));

  return (
    <div className="lg:col-span-12 mt-2 border-t border-slate-100 pt-3">
      <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Links & Resources</label>
      {links.map((link, i) => (
        <div key={i} className="flex flex-col md:flex-row gap-2 mb-2 items-center">
          <input
            type="text"
            placeholder="Description (e.g. Vector Map)"
            value={link.description}
            onChange={e => updateLink(i, 'description', e.target.value)}
            className="w-full md:w-1/3 border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="URL (https://...)"
            value={link.url}
            onChange={e => updateLink(i, 'url', e.target.value)}
            className="w-full md:w-2/3 border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => removeLink(i)}
            className="text-red-500 hover:text-red-700 font-bold px-2 py-1"
            title="Remove Link"
          >
            ×
          </button>
        </div>
      ))}
      {tableName && elementName && (
        <div className="mb-2">
          <LibraryDocUpload tableName={tableName} elementName={elementName}
                            onAdded={(l) => setLinks([...links, l])} />
        </div>
      )}
      <button
        type="button"
        onClick={addLink}
        className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-3 py-1 rounded transition-colors"
      >
        + Add Link
      </button>
    </div>
  );
};

export const LibraryTable = ({ columns, rows, onRowClick, emptyLabel }) => (
  <div className="border border-slate-200 rounded-lg overflow-hidden">
    <div className="max-h-64 overflow-y-auto custom-scrollbar">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-slate-100 z-10">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-xs text-slate-400 italic px-3 py-3">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row)}
                title="Click to view / edit"
                className={`cursor-pointer hover:bg-blue-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 border-b border-slate-100 text-slate-700 align-top">
                    {col.render ? col.render(row) : (row[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export const CellLineDefinitionSection = ({
  cellLineOptions = [],
  customCellLines = [],
  setCustomCellLines,
  cellLineMeta = {},
  setCellLineMeta,
  selectedId,
  onSelect
}) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [organism, setOrganism] = useState('');
  const [tissue, setTissue] = useState('');
  const [cultureMedium, setCultureMedium] = useState('');
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState([]);

  useEffect(() => {
    if (selectedId) chooseCellLine(selectedId);
  }, [selectedId]);

  const existingNames = useMemo(() => {
    const names = new Set([
      ...cellLineOptions.filter(Boolean),
      ...Object.keys(cellLineMeta || {})
    ]);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [cellLineOptions, cellLineMeta]);

  const chooseCellLine = (name) => {
    if (!name) {
      setSelectedName('');
      setNewName('');
      setOrganism('');
      setTissue('');
      setCultureMedium('');
      setNotes('');
      setLinks([]);
      return;
    }
    const meta = cellLineMeta[name] || {};
    setSelectedName(name);
    setNewName('');
    setOrganism(meta.organism || '');
    setTissue(meta.tissue || '');
    setCultureMedium(meta.cultureMedium || '');
    setNotes(meta.notes || '');
    setLinks(meta.links || []);
    if (onSelect) onSelect(name);
  };

  const saveCellLine = () => {
    const name = selectedName || newName.trim();
    if (!name) {
      alert('Please choose an existing cell line or enter a new name.');
      return;
    }

    const meta = {
      name,
      organism,
      tissue,
      cultureMedium,
      notes,
      links,
      updatedAt: Date.now()
    };

    setCellLineMeta((prev) => ({
      ...prev,
      [name]: { ...(prev[name] || {}), ...meta }
    }));

    if (!customCellLines.includes(name)) {
      setCustomCellLines((prev) => [...prev, name]);
    }
    setSelectedName(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete cell line ${selectedName}?`)) {
      setCellLineMeta((prev) => {
        const next = { ...prev };
        delete next[selectedName];
        return next;
      });
      setCustomCellLines((prev) => prev.filter(c => c !== selectedName));
      chooseCellLine('');
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        <div className="lg:col-span-6">
          <label className={CALC_LABEL_CLS}>Existing Cell Line</label>
          <SearchableSelect
            value={selectedName}
            onChange={(v) => chooseCellLine(v)}
            options={existingNames}
            placeholder="New cell line..."
            onClear={() => chooseCellLine('')}
          />
        </div>
        <div className="lg:col-span-6">
          <label className={CALC_LABEL_CLS}>New Cell Line Name</label>
          <input type="text" value={selectedName ? '' : newName} disabled={!!selectedName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. HEK293T" className={`${CALC_INPUT_CLS} disabled:bg-slate-50`} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Organism</label>
          <input type="text" value={organism} onChange={(e) => setOrganism(e.target.value)} placeholder="e.g. Homo sapiens" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Tissue / Disease</label>
          <input type="text" value={tissue} onChange={(e) => setTissue(e.target.value)} placeholder="e.g. Kidney / Embryonic" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Culture Medium</label>
          <input type="text" value={cultureMedium} onChange={(e) => setCultureMedium(e.target.value)} placeholder="e.g. DMEM + 10% FBS" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-12">
          <label className={CALC_LABEL_CLS}>Additional Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Growth conditions, morphology, etc." className={`${CALC_INPUT_CLS} h-20`} />
        </div>

        <LinksManager links={links} setLinks={setLinks} tableName="cellLines" elementName={selectedName || newName.trim()} />

        <div className="lg:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">
              Delete
            </button>
          )}
          <button type="button" onClick={saveCellLine} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">
            Save Cell Line
          </button>
        </div>
      </div>
    </div>
  );
};

export const PlasmidDefinitionSection = ({
  plasmidMeta = {},
  setPlasmidMeta,
  selectedId,
  onSelect
}) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [backbone, setBackbone] = useState('');
  const [promoter, setPromoter] = useState('');
  const [marker, setMarker] = useState('');
  const [molecularWeight, setMolecularWeight] = useState('');
  const [insertSequence, setInsertSequence] = useState('');
  const [notes, setNotes] = useState('');
  const [links, setLinks] = useState([]);

  useEffect(() => {
    if (selectedId) choosePlasmid(selectedId);
  }, [selectedId]);

  const existingNames = useMemo(() => Object.keys(plasmidMeta).sort(), [plasmidMeta]);

  const choosePlasmid = (name) => {
    if (!name) {
      setSelectedName('');
      setNewName('');
      setBackbone('');
      setPromoter('');
      setMarker('');
      setMolecularWeight('');
      setInsertSequence('');
      setNotes('');
      setLinks([]);
      return;
    }
    const meta = plasmidMeta[name] || {};
    setSelectedName(name);
    setNewName('');
    setBackbone(meta.backbone || '');
    setPromoter(meta.promoter || '');
    setMarker(meta.marker || '');
    setMolecularWeight(meta.molecularWeight || '');
    setInsertSequence(meta.insertSequence || '');
    setNotes(meta.notes || '');
    setLinks(meta.links || []);
    if (onSelect) onSelect(name);
  };

  const savePlasmid = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a plasmid name.');

    setPlasmidMeta((prev) => ({
      ...prev,
      [name]: { name, backbone, promoter, marker, molecularWeight, insertSequence, notes, links, updatedAt: Date.now() }
    }));
    setSelectedName(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete plasmid ${selectedName}?`)) {
      setPlasmidMeta((prev) => {
        const next = { ...prev };
        delete next[selectedName];
        return next;
      });
      choosePlasmid('');
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
        <div className="lg:col-span-6">
          <label className={CALC_LABEL_CLS}>Existing Plasmid</label>
          <SearchableSelect
            value={selectedName}
            onChange={(v) => choosePlasmid(v)}
            options={existingNames}
            placeholder="New plasmid..."
            onClear={() => choosePlasmid('')}
          />
        </div>
        <div className="lg:col-span-6">
          <label className={CALC_LABEL_CLS}>New Plasmid Name</label>
          <input type="text" value={selectedName ? '' : newName} disabled={!!selectedName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. pEGFP-C1" className={`${CALC_INPUT_CLS} disabled:bg-slate-50`} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Backbone</label>
          <input type="text" value={backbone} onChange={(e) => setBackbone(e.target.value)} placeholder="e.g. pUC19" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Promoter</label>
          <input type="text" value={promoter} onChange={(e) => setPromoter(e.target.value)} placeholder="e.g. CMV, T7" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-4">
          <label className={CALC_LABEL_CLS}>Resistance Marker</label>
          <input type="text" value={marker} onChange={(e) => setMarker(e.target.value)} placeholder="e.g. Ampicillin" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-12">
          <label className={CALC_LABEL_CLS}>Molecular Weight (Da)</label>
          <input type="number" value={molecularWeight} onChange={(e) => setMolecularWeight(e.target.value)} placeholder="e.g. 3000000" className={CALC_INPUT_CLS} />
        </div>
        <div className="lg:col-span-12">
          <label className={CALC_LABEL_CLS}>Insert Sequence (DNA)</label>
          <div className="border border-slate-300 rounded-lg overflow-hidden bg-white font-mono">
            <RichTextEditor
              value={insertSequence}
              onChange={(val) => setInsertSequence(val)}
              placeholder="ATGC..."
            />
          </div>
        </div>
        <div className="lg:col-span-12">
          <label className={CALC_LABEL_CLS}>Additional Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cloning strategy, usage, etc." className={`${CALC_INPUT_CLS} h-20`} />
        </div>

        <LinksManager links={links} setLinks={setLinks} tableName="plasmids" elementName={selectedName || newName.trim()} />

        <div className="lg:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">
              Delete
            </button>
          )}
          <button type="button" onClick={savePlasmid} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">
            Save Plasmid
          </button>
        </div>
      </div>
    </div>
  );
};


