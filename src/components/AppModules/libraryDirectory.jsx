/* =========================================================================
   src/components/AppModules/libraryDirectory.jsx
   Library directory listing component (extracted from App.jsx).
   ========================================================================= */

import React from 'react';
import { LibraryTable } from './librarySections';

export const LibraryDirectory = ({ 
  compoundMeta, cellLineMeta, plasmidMeta, customCmpds, customCellLines, customPlasmids,
  solvents, buffers, additives, nmrProbes, nmrInstruments, nmrExperiments, 
  onSelectResource 
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
  const handleExportCSV = () => {
    let csv = [];
    
    // Helper to escape commas and quotes for CSV format
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    // Strip HTML from rich text sequences before exporting
    const stripHtml = (str) => String(str || '').replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ');

    csv.push("--- COMPOUNDS ---");
    csv.push("Name,Type,Sequence/Formula,MW,Notes");
    compounds.forEach(name => {
      const m = compoundMeta[name] || {};
      const seq = stripHtml(m.sequence || m.formula || m.smiles || '');
      csv.push(`${escapeCsv(name)},${escapeCsv(m.type)},${escapeCsv(seq)},${escapeCsv(m.molecularWeight)},${escapeCsv(m.notes)}`);
    });

    csv.push("");
    csv.push("--- CELL LINES ---");
    csv.push("Name,Organism,Tissue,Medium,Notes");
    cellLines.forEach(name => {
      const m = cellLineMeta[name] || {};
      csv.push(`${escapeCsv(name)},${escapeCsv(m.organism)},${escapeCsv(m.tissue)},${escapeCsv(m.cultureMedium)},${escapeCsv(m.notes)}`);
    });

    csv.push("");
    csv.push("--- PLASMIDS ---");
    csv.push("Name,Backbone,Promoter,Marker,MW,Notes");
    plasmids.forEach(name => {
      const m = plasmidMeta[name] || {};
      csv.push(`${escapeCsv(name)},${escapeCsv(m.backbone)},${escapeCsv(m.promoter)},${escapeCsv(m.marker)},${escapeCsv(m.molecularWeight)},${escapeCsv(m.notes)}`);
    });

    csv.push("");
    csv.push("--- SOLVENTS ---");
    csv.push("Name,Density,MW,Comments");
    (solvents || []).forEach(s => {
      const name = typeof s === 'string' ? s : s.name;
      const den = typeof s === 'string' ? '' : s.density;
      const mw = typeof s === 'string' ? '' : s.molecularWeight;
      const comments = typeof s === 'string' ? '' : s.comments;
      csv.push(`${escapeCsv(name)},${escapeCsv(den)},${escapeCsv(mw)},${escapeCsv(comments)}`);
    });

    csv.push("");
    csv.push("--- BUFFERS ---");
    csv.push("Name,Description,MW,Comments");
    (buffers || []).forEach(b => {
      const name = typeof b === 'string' ? b : b.name;
      const desc = typeof b === 'string' ? '' : b.description;
      const mw = typeof b === 'string' ? '' : b.molecularWeight;
      const comments = typeof b === 'string' ? '' : b.comments;
      csv.push(`${escapeCsv(name)},${escapeCsv(desc)},${escapeCsv(mw)},${escapeCsv(comments)}`);
    });

    csv.push("");
    csv.push("--- ADDITIVES ---");
    csv.push("Name,Description,MW,Comments");
    (additives || []).forEach(a => {
      const name = typeof a === 'string' ? a : a.name;
      const desc = typeof a === 'string' ? '' : a.description;
      const mw = typeof a === 'string' ? '' : a.molecularWeight;
      const comments = typeof a === 'string' ? '' : a.comments;
      csv.push(`${escapeCsv(name)},${escapeCsv(desc)},${escapeCsv(mw)},${escapeCsv(comments)}`);
    });

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
        <h3 className="text-sm font-bold text-slate-700 uppercase">
          Defined Resources Library
        </h3>
        <button 
          onClick={handleExportCSV}
          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-2"
        >
          📥 Export Full Library (CSV)
        </button>
      </div>

      {/* COMPOUND / CELL LINE / PLASMID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
          />
        </div>
      </div>

      {/* SOLVENTS / BUFFERS / ADDITIVES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
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
          />
        </div>
      </div>

      {/* NMR INSTRUMENTS / NMR PROBES / NMR EXPERIMENTS (PULSE PROGRAMS) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
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
          />
        </div>
      </div>
    </div>
  );
};
