/* =========================================================================
   src/components/AppModules/libraryDirectory.jsx
   Library directory listing component (extracted from App.jsx).

   TROIS GESTES SUR LA MÊME LISTE :
     • CLIQUER une ligne ouvre la fiche de l'élément (comportement d'origine) ;
     • COCHER des lignes — dans une sous-catégorie ou dans plusieurs — puis
       « 🗑 Delete selected » les supprime EN UNE SEULE FOIS (la demande :
       « selezionare più voci nella libreria per cancellarle in un colpo
       solo »). Rien ne part sans confirmation, et chaque suppression passe par
       `onDeleteResources`, qui seul connaît les setters de la page ;
     • « 📥 Export Full Library (CSV) » écrit TOUTES les sous-catégories (le
       texte vient de utils/libraryCsv.js — un seul contrat d'écriture), et
       « 📤 Import Library (CSV) » relit un fichier exporté en laissant choisir
       la sous-catégorie ou les éléments (LibraryImportModal).
   ========================================================================= */

import React, { useState } from 'react';
import { LibraryTable } from './librarySections';
import { LibraryImportModal } from './libraryImportModal';
import { libraryCsvText, parseLibrarySections } from '../../utils/libraryCsv';

/* LE VOCABULAIRE DES SOUS-CATÉGORIES — les mêmes titres que la page, pour les
   messages de suppression : une seule liste, donc un seul endroit à corriger. */
const TABLE_LABELS = {
  compound: 'Compounds',
  cellLine: 'Cell Lines',
  plasmid: 'Plasmids',
  solvent: 'Solvents & Media',
  buffer: 'Buffers',
  additive: 'Additives',
  nmrInstrument: 'NMR Instruments',
  nmrProbe: 'NMR Probes',
  nmrExperiment: 'NMR Experiments / Pulse Programs',
};

export const LibraryDirectory = ({ 
  compoundMeta, cellLineMeta, plasmidMeta, customCmpds, customCellLines, customPlasmids,
  solvents, buffers, additives, nmrProbes, nmrInstruments, nmrExperiments, 
  onSelectResource, onDeleteResources, onImportLibrary
}) => {
  const compounds = [...new Set([...(customCmpds || []), ...Object.keys(compoundMeta || {})])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const cellLines = [...new Set([...(customCellLines || []), ...Object.keys(cellLineMeta || {})])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const plasmids = [...new Set([...(customPlasmids || []), ...Object.keys(plasmidMeta || {})])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const asRows = (items) =>
    (Array.isArray(items) ? items : [])
      .map((item) => (typeof item === 'string' ? { id: item, name: item } : item))
      .filter((item) => item && item.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const compoundCategoryLabel = (meta) => {
    if (meta?.type === 'protein') return 'Peptide / Protein';
    if (['dna', 'rna'].includes(meta?.type)) return 'Nucleic Acid';
    if (meta?.type === 'smiles') return 'Small Molecule (SMILES)';
    if (meta?.type === 'formula') return 'Chemical Formula';
    return meta?.type ? meta.type : 'Unclassified';
  };

  // --- FULL CSV EXPORT LOGIC ---
  /* 📤 LE FICHIER DE LA LIBRAIRIE — le texte vient de utils/libraryCsv.js, la
     MOITIÉ ÉCRITURE d'un contrat unique : l'« Import CSV » de la fiche du
     composé est l'autre moitié, et elle relit exactement ces colonnes-là (son
     en-tête de module dit tout : sections, en-têtes, valeurs citées). Le format
     n'a donc plus qu'UNE définition — avant, chaque moitié portait la sienne et
     elles avaient divergé (l'export écrivait « Name,Type,Sequence/Formula,MW,
     Notes », l'import lisait nom, séquence, type : à l'aller-retour, tous les
     champs glissaient d'une colonne). */
  const handleExportCSV = () => {
    const text = libraryCsvText({
      compounds, compoundMeta, cellLines, cellLineMeta, plasmids, plasmidMeta,
      solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments,
    });
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lab_Library_Export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ------------------------------

  const compoundRows = compounds.map((name) => {
    const meta = compoundMeta[name] || {};
    return {
      id: name,
      name,
      category: compoundCategoryLabel(meta),
      mw: meta.molecularWeight ? `${Number(meta.molecularWeight).toFixed(1)} g/mol` : '—',
      linkCount: Array.isArray(meta.links) ? meta.links.length : 0,
      links: Array.isArray(meta.links) ? meta.links : []
    };
  });

  const cellLineRows = cellLines.map((name) => {
    const meta = cellLineMeta[name] || {};
    return {
      id: name,
      name,
      organism: meta.organism || '—',
      tissue: meta.tissue || '—',
      linkCount: Array.isArray(meta.links) ? meta.links.length : 0,
      links: Array.isArray(meta.links) ? meta.links : []
    };
  });

  const plasmidRows = plasmids.map((name) => {
    const meta = plasmidMeta[name] || {};
    return {
      id: name,
      name,
      backbone: meta.backbone || '—',
      marker: meta.marker || '—',
      mw: meta.molecularWeight ? `${Number(meta.molecularWeight).toFixed(1)} Da` : '—',
      linkCount: Array.isArray(meta.links) ? meta.links.length : 0,
      links: Array.isArray(meta.links) ? meta.links : []
    };
  });

  const solventRows = asRows(solvents).map((s) => ({
    id: s.id || s.name,
    name: s.name,
    density: s.density || '—',
    mw: s.molecularWeight ? `${Number(s.molecularWeight).toFixed(1)} Da` : '—',
    comments: s.comments || '',
    linkCount: Array.isArray(s.links) ? s.links.length : 0,
    links: Array.isArray(s.links) ? s.links : []
  }));

  const bufferRows = asRows(buffers).map((b) => ({
    id: b.id || b.name,
    name: b.name,
    description: b.description || '—',
    mw: b.molecularWeight ? `${Number(b.molecularWeight).toFixed(1)} Da` : '—',
    comments: b.comments || '',
    linkCount: Array.isArray(b.links) ? b.links.length : 0,
    links: Array.isArray(b.links) ? b.links : []
  }));

  const additiveRows = asRows(additives).map((a) => ({
    id: a.id || a.name,
    name: a.name,
    description: a.description || '—',
    mw: a.molecularWeight ? `${Number(a.molecularWeight).toFixed(1)} Da` : '—',
    comments: a.comments || '',
    linkCount: Array.isArray(a.links) ? a.links.length : 0,
    links: Array.isArray(a.links) ? a.links : []
  }));

  const nmrInstrumentRows = asRows(nmrInstruments).map((i) => ({
    id: i.id || i.name,
    name: i.name,
    frequency: i.frequency || '—',
    manufacturer: i.manufacturer || '—',
    comments: i.comments || '',
    linkCount: Array.isArray(i.links) ? i.links.length : 0,
    links: Array.isArray(i.links) ? i.links : []
  }));

  const nmrProbeRows = asRows(nmrProbes).map((p) => ({
    id: p.id || p.name,
    name: p.name,
    type: [p.type, p.subtype].filter(Boolean).join(' / ') || '—',
    field: p.field || '—',
    comments: p.comments || '',
    linkCount: Array.isArray(p.links) ? p.links.length : 0,
    links: Array.isArray(p.links) ? p.links : []
  }));

  const nmrExperimentRows = asRows(nmrExperiments).map((e) => ({
    id: e.id || e.name,
    name: e.name,
    dimensions: e.dimensions || '—',
    nuclei: Array.isArray(e.nuclei) ? e.nuclei.filter(Boolean).join(', ') || '—' : '—',
    comments: e.comments || '',
    linkCount: Array.isArray(e.links) ? e.links.length : 0,
    links: Array.isArray(e.links) ? e.links : []
  }));

  /* ── LA SÉLECTION — cochée sur les tables, tenue ICI ──────────────────────
     `picked` : la liste des NOMS cochés, par sous-catégorie (les noms, parce
     que c'est par le nom que les fiches et les gestionnaires suppriment — voir
     Delete des CompoundDefinitionSection / SolventsManager / …). Elle vit dans
     la page, pas dans une table : c'est ce qui permet de cocher dans PLUSIEURS
     sous-catégories et de tout supprimer d'un coup depuis l'en-tête. */
  const [picked, setPicked] = useState({});
  const [pendingImport, setPendingImport] = useState(null);   // fichier relu, à confirmer

  const pickedOf = (type) => (Array.isArray(picked[type]) ? picked[type] : []);
  const totalPicked = Object.values(picked).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);

  const togglePick = (type, name) => setPicked((prev) => {
    const list = Array.isArray(prev[type]) ? prev[type] : [];
    return { ...prev, [type]: list.includes(name) ? list.filter((x) => x !== name) : [...list, name] };
  });

  /** « All » / « None » d'une table : RIEN ne déborde sur les autres. */
  const togglePickAll = (type, names, on) => setPicked((prev) => ({
    ...prev,
    [type]: on ? [...new Set([...(Array.isArray(prev[type]) ? prev[type] : []), ...names])] : [],
  }));

  const dropPicks = (type) => setPicked((prev) => ({ ...prev, [type]: [] }));

  /** UN COUP D'ŒIL SUR CE QUI VA PARTIR — les huit premiers noms, puis le
   *  reste en nombre : une sélection de cent lignes ne fait pas une fenêtre de
   *  confirmation de cent lignes. */
  const namesPreview = (names) => names.slice(0, 8).join(' · ')
    + (names.length > 8 ? ` … (+${names.length - 8})` : '');

  /** 🗑 SUPPRIMER LES LIGNES COCHÉES D'UNE SOUS-CATÉGORIE — une confirmation,
   *  un seul appel : la page retire les noms d'un coup (une écriture, donc pas
   *  de suppression « une fois sur deux »). */
  const deletePicked = (type) => {
    const names = pickedOf(type);
    if (!names.length || !onDeleteResources) return;
    const label = TABLE_LABELS[type] || type;
    const ok = window.confirm(
      `Delete ${names.length} entr${names.length > 1 ? 'ies' : 'y'} from ${label}?\n\n${namesPreview(names)}`
    );
    if (!ok) return;
    onDeleteResources(type, names);
    dropPicks(type);
  };

  /** 🗑 …ET TOUTES LES SOUS-CATÉGORIES D'UN SEUL COUP (bouton de l'en-tête,
   *  affiché dès qu'une case est cochée, où qu'elle soit). */
  const deleteEveryPick = () => {
    const groups = Object.entries(picked).filter(([, list]) => Array.isArray(list) && list.length);
    if (!groups.length || !onDeleteResources) return;
    const total = groups.reduce((n, [, list]) => n + list.length, 0);
    const detail = groups.map(([type, list]) => `• ${TABLE_LABELS[type] || type} : ${list.length}`).join('\n');
    const ok = window.confirm(
      `Delete ${total} selected entr${total > 1 ? 'ies' : 'y'}?\n\n${detail}`
    );
    if (!ok) return;
    groups.forEach(([type, list]) => onDeleteResources(type, list));
    setPicked({});
  };

  /** 📤 IMPORTER UN FICHIER DE LIBRAIRIE — le fichier est RELU par
   *  sous-catégorie (`parseLibrarySections`) puis montré : c'est la fenêtre qui
   *  décide de ce qui entre, rien n'est importé avant le clic. Un fichier dont
   *  aucune ligne n'est lisible le dit et ne change RIEN. */
  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const parsed = parseLibrarySections(event.target.result);
      if (!parsed.sections.length) {
        alert('No entry could be read in this file — nothing was changed.');
        return;
      }
      setPendingImport(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';   // le même fichier peut être réimporté aussitôt
  };

  /** LES PROPS DE SÉLECTION D'UNE TABLE — une seule définition, neuf usages. */
  const tableSelection = (type, rows) => ({
    selectable: true,
    selectedNames: pickedOf(type),
    onToggleSelect: (name) => togglePick(type, name),
    onToggleAll: (on) => togglePickAll(type, rows.map((r) => r.name), on),
    onDeleteSelected: () => deletePicked(type),
  });

  const linksCell = (row) =>
    row.linkCount > 0 ? (
      <div className="flex flex-col gap-1">
        {row.links.map((link, i) => (
          <a 
            key={i} 
            href={link.url} 
            target="_blank" 
            rel="noopener noreferrer" 
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold text-xs transition-colors"
            title={link.url}
          >
            🔗 {link.description || 'Link'}
          </a>
        ))}
      </div>
    ) : (
      <span className="text-slate-300">—</span>
    );

  const commentsCell = (row) =>
    row.comments && row.comments.trim() ? (
      <span className="text-slate-600" title={row.comments}>
        {row.comments.length > 40 ? `${row.comments.slice(0, 40)}…` : row.comments}
      </span>
    ) : (
      <span className="text-slate-300">—</span>
    );

  const nameCell = (row) => <span className="font-semibold text-slate-800">{row.name}</span>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b pb-3 gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-700 uppercase">
            Defined Resources Library
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Click a row to open its card · tick rows to delete several at once · the export keeps every
            subcategory, the import lets you choose what comes in.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {totalPicked > 0 && (
            <button
              onClick={deleteEveryPick}
              title="Delete every ticked entry, in every subcategory"
              className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2"
            >
              🗑 Delete selected ({totalPicked})
            </button>
          )}
          <label
            title="Read a library file (CSV / TSV) and choose the subcategories — or the single entries — to bring in"
            className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
          >
            📤 Import Library (CSV)
            <input type="file" accept=".csv,.tsv,.txt" onChange={handleImportFile} className="hidden" />
          </label>
          <button
            onClick={handleExportCSV}
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2"
          >
            📥 Export Full Library (CSV)
          </button>
        </div>
      </div>

      {/* COMPOUND / CELL LINE / PLASMID — always stacked, never side by side */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Compounds ({compoundRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'category', label: 'Category' },
              { key: 'mw', label: 'MW' },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={compoundRows}
            onRowClick={(row) => onSelectResource(row.name, 'compound')}
            emptyLabel="No compounds defined yet."
            {...tableSelection('compound', compoundRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Cell Lines ({cellLineRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'organism', label: 'Organism' },
              { key: 'tissue', label: 'Tissue' },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={cellLineRows}
            onRowClick={(row) => onSelectResource(row.name, 'cellLine')}
            emptyLabel="No cell lines defined yet."
            {...tableSelection('cellLine', cellLineRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Plasmids ({plasmidRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'backbone', label: 'Backbone' },
              { key: 'marker', label: 'Marker' },
              { key: 'mw', label: 'MW' },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={plasmidRows}
            onRowClick={(row) => onSelectResource(row.name, 'plasmid')}
            emptyLabel="No plasmids defined yet."
            {...tableSelection('plasmid', plasmidRows)}
          />
        </div>
      </div>

      {/* SOLVENTS / BUFFERS / ADDITIVES — always stacked, never side by side */}
      <div className="grid grid-cols-1 gap-4 mt-4">
        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Solvents & Media ({solventRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'density', label: 'Density' },
              { key: 'mw', label: 'MW' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={solventRows}
            onRowClick={(row) => onSelectResource(row.name, 'solvent')}
            emptyLabel="No solvents defined yet."
            {...tableSelection('solvent', solventRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Buffers ({bufferRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'description', label: 'Description' },
              { key: 'mw', label: 'MW' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={bufferRows}
            onRowClick={(row) => onSelectResource(row.name, 'buffer')}
            emptyLabel="No buffers defined yet."
            {...tableSelection('buffer', bufferRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">Additives ({additiveRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'description', label: 'Description' },
              { key: 'mw', label: 'MW' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={additiveRows}
            onRowClick={(row) => onSelectResource(row.name, 'additive')}
            emptyLabel="No additives defined yet."
            {...tableSelection('additive', additiveRows)}
          />
        </div>
      </div>

      {/* NMR INSTRUMENTS / NMR PROBES / NMR EXPERIMENTS (PULSE PROGRAMS) — always stacked, never side by side */}
      <div className="grid grid-cols-1 gap-4 mt-4">
        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">NMR Instruments ({nmrInstrumentRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'frequency', label: 'Frequency' },
              { key: 'manufacturer', label: 'Manufacturer' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={nmrInstrumentRows}
            onRowClick={(row) => onSelectResource(row.name, 'nmrInstrument')}
            emptyLabel="No NMR instruments defined yet."
            {...tableSelection('nmrInstrument', nmrInstrumentRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">NMR Probes ({nmrProbeRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'type', label: 'Type' },
              { key: 'field', label: 'Field' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={nmrProbeRows}
            onRowClick={(row) => onSelectResource(row.name, 'nmrProbe')}
            emptyLabel="No NMR probes defined yet."
            {...tableSelection('nmrProbe', nmrProbeRows)}
          />
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-500 mb-2">NMR Experiments / Pulse Programs ({nmrExperimentRows.length})</h4>
          <LibraryTable
            columns={[
              { key: 'name', label: 'Name', render: nameCell },
              { key: 'dimensions', label: 'Dim.' },
              { key: 'nuclei', label: 'Nuclei' },
              { key: 'comments', label: 'Comments', render: commentsCell },
              { key: 'linkCount', label: 'Links', render: linksCell }
            ]}
            rows={nmrExperimentRows}
            onRowClick={(row) => onSelectResource(row.name, 'nmrExperiment')}
            emptyLabel="No NMR experiments defined yet."
            {...tableSelection('nmrExperiment', nmrExperimentRows)}
          />
        </div>
      </div>

      {/* 📤 LA FENÊTRE D'IMPORT — montée seulement quand un fichier a été relu :
          elle montre les sous-catégories du fichier et laisse cocher ce qui
          entre (sous-catégorie entière, ou éléments un par un). */}
      {pendingImport && (
        <LibraryImportModal
          parsed={pendingImport}
          onCancel={() => setPendingImport(null)}
          onImport={(plan) => {
            setPendingImport(null);
            if (onImportLibrary) onImportLibrary(plan);
          }}
        />
      )}
    </div>
  );
};
