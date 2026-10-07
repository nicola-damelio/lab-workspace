/* =========================================================================
   src/components/AppModules/libraryImportModal.jsx

   « When I load a library I must be able to choose which subcategory or even
   elements I decide to upload. »

   LE FICHIER DE LA LIBRAIRIE EST LU PAR SOUS-CATÉGORIE (utils/libraryCsv.js,
   `parseLibrarySections`) ; ce panneau-ci le MONTRE et laisse choisir : une
   sous-catégorie entière (sa case), ou les éléments un par un (▸ choose …).
   Ce qui n'est pas coché n'est pas importé — et comme l'import est ADDITIF
   (voir `libraryPlanPatch`), ce qui n'est pas coché garde aussi sa valeur
   actuelle : rien n'est écrasé « en passant ».

   Un fichier sans section (une simple liste de composants, le cas d'avant) se
   présente sous « Compounds » : c'est ainsi que `parseLibrarySections` le lit.
   ========================================================================= */

import React, { useState } from 'react';

/** LA SECONDE LIGNE D'UNE ENTRÉE — les deux ou trois champs qui la distinguent
 *  de sa voisine, dans le vocabulaire de sa fiche. */
const rowDetail = (key, row) => {
  const parts = {
    compounds: [row.type, row.molecularWeight ? `${row.molecularWeight} g/mol` : ''],
    cellLines: [row.organism, row.tissue],
    plasmids: [row.backbone, row.marker],
    solvents: [row.density ? `${row.density} g/mL` : '', row.molecularWeight ? `${row.molecularWeight} Da` : ''],
    buffers: [row.description],
    additives: [row.description],
    nmrInstruments: [row.frequency ? `${row.frequency} MHz` : '', row.manufacturer],
    nmrProbes: [[row.type, row.subtype].filter(Boolean).join(' / '), row.field ? `${row.field} MHz` : ''],
    nmrExperiments: [row.dimensions, Array.isArray(row.nuclei) ? row.nuclei.join(', ') : row.nuclei],
  }[key] || [];
  return parts.filter(Boolean).join(' · ');
};

export const LibraryImportModal = ({ parsed, onCancel, onImport }) => {
  const sections = (parsed && parsed.sections) || [];
  const [offSections, setOffSections] = useState(() => new Set());
  const [offRows, setOffRows] = useState(() => ({}));
  const [expanded, setExpanded] = useState(() => new Set());

  const sectionOn = (s) => !offSections.has(s.key);
  const rowOff = (s, name) => !!(offRows[s.key] && offRows[s.key].has(name));
  const chosenRows = (s) => s.rows.filter((r) => sectionOn(s) && !rowOff(s, r.name));
  const pickedCount = sections.reduce((n, s) => n + chosenRows(s).length, 0);

  const toggleSection = (s) => setOffSections((prev) => {
    const next = new Set(prev);
    if (next.has(s.key)) next.delete(s.key); else next.add(s.key);
    return next;
  });

  const toggleRow = (s, name) => setOffRows((prev) => {
    const set = new Set(prev[s.key] || []);
    if (set.has(name)) set.delete(name); else set.add(name);
    return { ...prev, [s.key]: set };
  });

  const markSection = (s, on) => setOffRows((prev) => {
    const set = new Set(prev[s.key] || []);
    s.rows.forEach((r) => { if (on) set.delete(r.name); else set.add(r.name); });
    return { ...prev, [s.key]: set };
  });

  const toggleOpen = (s) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(s.key)) next.delete(s.key); else next.add(s.key);
    return next;
  });

  /** LE PLAN — les lignes cochées, par sous-catégorie : c'est LUI que la page
   *  applique (voir `libraryPlanPatch`). */
  const plan = () => {
    const out = {};
    sections.forEach((s) => {
      const rows = chosenRows(s);
      if (rows.length) out[s.key] = rows;
    });
    return out;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex items-center justify-center backdrop-blur-sm p-4">
      <div className="bg-white p-6 rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[92vh] overflow-y-auto custom-scrollbar">
        <h3 className="text-lg font-black text-slate-800 mb-1">Import library</h3>
        <p className="text-sm text-slate-500 mb-4">
          This file carries <b>{sections.length}</b> subcategor{sections.length > 1 ? 'ies' : 'y'}{' '}
          ({parsed && parsed.sectioned ? 'exported by the Library page' : 'a plain list, read as compounds'}). Tick what you
          want to bring in — a whole subcategory, or single entries inside it.
        </p>

        <div className="flex flex-col gap-3">
          {sections.map((s) => {
            const open = expanded.has(s.key);
            const on = sectionOn(s);
            const chosen = chosenRows(s).length;
            return (
              <div key={s.key} className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={on}
                    onChange={() => toggleSection(s)}
                    title={`Import every « ${s.label} » entry`}
                  />
                  <span className="text-xs font-black text-slate-700">{s.label}</span>
                  <span className="text-[11px] text-slate-400">
                    {s.rows.length} {s.unit}{s.rows.length > 1 ? 's' : ''}
                    {on && chosen !== s.rows.length ? ` · ${chosen} ticked` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleOpen(s)}
                    className="ml-auto text-[10px] font-bold text-blue-700 hover:underline"
                  >
                    {open ? '▾ hide entries' : '▸ choose entries'}
                  </button>
                </div>
                {open && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 bg-white">
                      <button
                        type="button"
                        onClick={() => markSection(s, true)}
                        className="text-[10px] font-bold text-blue-700 hover:underline"
                      >
                        all
                      </button>
                      <button
                        type="button"
                        onClick={() => markSection(s, false)}
                        className="text-[10px] font-bold text-slate-400 hover:underline"
                      >
                        none
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                      {s.rows.map((row) => (
                        <label key={row.name} className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50/50">
                          <input
                            type="checkbox"
                            className="accent-blue-600 mt-0.5"
                            checked={on && !rowOff(s, row.name)}
                            disabled={!on}
                            onChange={() => toggleRow(s, row.name)}
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-slate-700 truncate">{row.name}</span>
                            {rowDetail(s.key, row) ? (
                              <span className="block text-[10px] text-slate-400 truncate">{rowDetail(s.key, row)}</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          The import only ADDS and COMPLETES, by name: an entry of this file refreshes the one bearing the same name, an
          unknown one is created, and a field the file does not carry keeps its current value. Nothing is ever deleted or
          emptied by an import.
        </p>

        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            onClick={() => onImport(plan())}
            disabled={pickedCount === 0}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg text-left transition-colors"
          >
            📤 Import the selected elements ({pickedCount})
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-500 hover:text-slate-700 text-sm font-bold py-2 w-full transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default LibraryImportModal;
