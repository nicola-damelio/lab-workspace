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
import TestShellRenderer from './components/TestShellRenderer';
import { NMRTestRenderer } from './components/NMRTestRenderer';
import { PlateTestRenderer } from './components/PlateTestRenderer';
import { CDTestRenderer } from './components/CDTestRenderer';
import { ssNMRTestRenderer as SSNMRTestRenderer } from './components/ssNMRTestRenderer';
import { LabNotebook } from './components/LabNotebook';
import { RichTextEditor } from './components/RichTextEditor';
import { StorageModals, StorageList, StorageDetail, BoxDetail } from './components/Storage';
import { DefinitionsPanel } from './components/DefinitionsPanel';
import { NMRFittingsTestRenderer } from './components/NMRFittingsTestRenderer';
import { CloningTestRenderer } from './components/CloningTestRenderer';
import { ProteinExpressionTestRenderer } from './components/ProteinExpressionTestRenderer';
import DockingTestRenderer, { DOCKING_TAB_CONFIG } from './components/DockingTestRenderer';
import { Setup, Data, Simulations, Analysis } from '/src/components/MDSections.jsx';
import { SolventsManager, BuffersManager, AdditivesManager, NMRProbesManager, NMRInstrumentsManager, NMRExperimentsManager, BufferAdditiveFields, getMolecularWeightFromFormula, BrukerPulseSequenceViewer} from './components/DefinitionsExtra';
import {
  CD_TAB_CONFIG,
  PLATE_TAB_CONFIG,
  NMR_TAB_CONFIG,
  CLONING_TAB_CONFIG,
  NMR_FITTING_TAB_CONFIG,
  PROTEIN_EXPRESSION_TAB_CONFIG,
  SSNMR_TAB_CONFIG,
  FLOW_CYTOMETRY_TAB_CONFIG
} from './components/tabConfigs.jsx';
import { FlowCytometryTestRenderer } from './components/FlowCytometryTestRenderer';


/* =========================================================
   AUTH UTILITIES
========================================================= */

/** Hash a plain-text password with SHA-256, returning a hex string. */
const hashPassword = async (password) => {
  if (!password) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Ensure every entry in an operators array is the new object format:
 * { id, name, role, passwordHash }
 * Legacy string entries become { role: 'user', passwordHash: '' }.
 */
const normalizeOperators = (ops) => {
  if (!Array.isArray(ops)) return [];
  return ops.map((op) => {
    if (typeof op === 'string') {
      return { id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2), name: op, role: 'user', passwordHash: '' };
    }
    return { id: op.id || 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2), name: op.name || '', role: op.role || 'user', passwordHash: op.passwordHash || '' };
  });
};

/** Get the display label of an operator (object or legacy string). */
const getOpLabel = (op) => (typeof op === 'string' ? op : op?.name || '');

/* =========================================================
   COLLAPSIBLE SECTION
========================================================= */

const CollapsibleSection = ({ id, title, subtitle, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <div id={id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-visible scroll-mt-6">
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
   MD SIMULATIONS CONFIG & RENDERER
========================================================= */
const MD_SIMULATION_TAB_CONFIG = {
  typeKey: 'md_simulation',
  typeLabel: 'MD Simulations',
  icon: '🖥️',
  fallbackCategories: [
    'Equilibration',
    'Production',
    'Free Energy',
    'Binding',
    'Characterization'
  ],
  samples: {
    compounds: true,
    cellLines: false,
    compoundLabel: 'System / Molecule',
    cellLineLabel: ''
  },
  imagesKey: 'images',
  conditionFields: [
    { key: 'experimentDate', label: 'Simulation Date', type: 'date' },
    {
      key: 'forceField',
      label: 'Force Field',
      type: 'select',
      options: [
        'AMBER ff19SB',
        'CHARMM36m',
        'OPLS-AA/M',
        'GROMOS 54a7',
        'Other'
      ]
    },
    {
      key: 'waterModel',
      label: 'Water Model',
      type: 'select',
      options: ['TIP3P', 'TIP4P', 'SPC/E', 'OPC', 'Other']
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'text',
      placeholder: 'e.g. 300',
      units: ['K']
    },
    {
      key: 'pressure',
      label: 'Pressure',
      type: 'text',
      placeholder: 'e.g. 1',
      units: ['bar', 'atm']
    },
    {
      key: 'simulationTime',
      label: 'Simulation Time',
      type: 'text',
      placeholder: 'e.g. 100',
      units: ['ns', 'µs', 'ps']
    },
    {
      key: 'timestep',
      label: 'Timestep',
      type: 'text',
      placeholder: 'e.g. 2',
      units: ['fs', 'ps']
    },
    {
      key: 'boxType',
      label: 'Box Type',
      type: 'select',
      options: [
        'Cubic',
        'Dodecahedral',
        'Truncated Octahedral',
        'Rectangular'
      ]
    },
    {
      key: 'ionConcentration',
      label: 'Ion Concentration',
      type: 'text',
      placeholder: 'e.g. 0.15',
      units: ['M', 'mM']
    },
    {
      key: 'software',
      label: 'MD Software',
      type: 'select',
      options: ['GROMACS', 'AMBER', 'NAMD', 'OpenMM', 'CHARMM', 'Other']
    },
    {
      key: 'otherMolecule',
      label: 'Other Molecule',
      type: 'text',
      placeholder: 'e.g. Ligand X'
    },
    {
      key: 'otherConditions',
      label: 'Other Conditions',
      type: 'text',
      placeholder: 'e.g. Replica exchange'
    }
  ],
  notebookChecks: [
    { id: 'cond', label: 'Simulation Parameters' },
    { id: 'setup', label: 'System Setup' },
    { id: 'results', label: 'Results Summary' }
  ]
};

/* =========================================================
   SPECIAL PAGES REGISTRY
   Single source of truth for the 7 "special page" test types and the
   named subsections each one exposes (sourced from each page's own
   notebookChecks, i.e. the same section list already used for the
   Lab Notebook Export checklist). Used by:
     - Custom Metadata Fields (page + subsection targeting)
     - Mandatory Parameters (page + subsection rules, per-page behavior)
   NOTE: the NMR Fittings page type is 'nmr-fittings' (hyphenated) at
   runtime (see activeTest.type routing below) even though the
   tabConfigs.jsx export for it is named differently — the value here
   is kept in sync with the real routing key.
========================================================= */
const SPECIAL_PAGES = [
  { value: 'nmr', label: 'NMR', subsections: NMR_TAB_CONFIG.notebookChecks || [] },
  { value: 'nmr-fittings', label: 'NMR Fittings', subsections: NMR_FITTING_TAB_CONFIG.notebookChecks || [] },
  { value: 'plate', label: 'Plate', subsections: PLATE_TAB_CONFIG.notebookChecks || [] },
  { value: 'cd', label: 'CD', subsections: CD_TAB_CONFIG.notebookChecks || [] },
  { value: 'cloning', label: 'Cloning', subsections: CLONING_TAB_CONFIG.notebookChecks || [] },
  { value: 'protein_expression', label: 'Protein Purification', subsections: PROTEIN_EXPRESSION_TAB_CONFIG.notebookChecks || [] },
  { value: 'ssnmr', label: 'ssNMR', subsections: SSNMR_TAB_CONFIG.notebookChecks || [] },
  { value: 'md_simulation', label: 'MD Simulations', subsections: MD_SIMULATION_TAB_CONFIG.notebookChecks || [] },
  { value: 'docking', label: 'Docking', subsections: DOCKING_TAB_CONFIG.notebookChecks || [] },
  { value: 'flow_cytometry', label: 'Flow Cytometry', subsections: FLOW_CYTOMETRY_TAB_CONFIG.notebookChecks || [] }
];

const CUSTOM_FIELD_TAB_OPTIONS = [
  { value: 'all', label: 'All tabs' },
  ...SPECIAL_PAGES.map((p) => ({ value: p.value, label: p.label }))
];

const getSubsectionsForPage = (pageValue) =>
  SPECIAL_PAGES.find((p) => p.value === pageValue)?.subsections || [];

class MDSectionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('MD sections crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            margin: 20,
            padding: 16,
            border: '3px solid #ef4444',
            background: '#fef2f2',
            borderRadius: 12
          }}
        >
          <div
            style={{
              fontWeight: 900,
              color: '#b91c1c',
              marginBottom: 8
            }}
          >
            ❌ MD sections crashed
          </div>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              color: '#b91c1c'
            }}
          >
            {String(this.state.error?.message || this.state.error)}
            {'\n\n'}
            {String(this.state.error?.stack || '')}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

const SafeMDSectionsAll = (props) => {
  if (!MDSectionsAll) {
    return (
      <div
        style={{
          margin: 20,
          padding: 16,
          border: '3px solid #f59e0b',
          background: '#fffbeb',
          borderRadius: 12,
          fontWeight: 900,
          color: '#92400e'
        }}
      >
        ⚠️ MDSections.All was not found. Check the import path in App.jsx.
      </div>
    );
  }

  return (
    <MDSectionErrorBoundary>
      <MDSectionsAll {...props} />
    </MDSectionErrorBoundary>
  );
};

const buildMDNotebookHtml = (checked, ctx) => {
  const t = ctx?.activeTest || {};

  let html = '';

  if (checked.cond) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>MD Setup:</b> Force field ${
      t.forceField || 'N/A'
    } | Water ${t.waterModel || 'N/A'} | Temperature ${
      t.temperature || 'N/A'
    } | Pressure ${t.pressure || 'N/A'} | Simulation time ${
      t.simulationTime || 'N/A'
    } | Timestep ${t.timestep || 'N/A'} | Software ${t.software || 'N/A'}</p>`;
  }

  if (checked.setup) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>System Setup:</b> Box type ${
      t.boxType || 'N/A'
    } | Ion concentration ${t.ionConcentration || 'N/A'} | Other molecule ${
      t.otherMolecule || 'N/A'
    } | Other conditions ${t.otherConditions || 'N/A'}</p>`;
  }

  if (checked.results) {
    html += `<p style="font-size:12px;color:#475569;margin-bottom:8px;"><b>Results Summary:</b> See the MD Analysis section for RMSD, RMSF, Rg, SASA, and energy plots.</p>`;
  }

  return html;
};

const MD_CUSTOM = {
  MolecularStructure: Setup,
  Simulations: Simulations,
  Data: Data,
  Analysis: Analysis,
  buildNotebookHtml: buildMDNotebookHtml
};

const MDTestRenderer = (props) => {
  const appCategories =
    Array.isArray(props.testCategories) && props.testCategories.length
      ? props.testCategories
      : MD_SIMULATION_TAB_CONFIG.fallbackCategories;

  const config = {
    ...MD_SIMULATION_TAB_CONFIG,
    categories: appCategories
  };

  return (
    <TestShellRenderer
      {...props}
      config={config}
      custom={MD_CUSTOM}
      testCategories={appCategories}
      operators={Array.isArray(props.operators) ? props.operators : []}
      solvents={Array.isArray(props.solvents) ? props.solvents : []}
      buffers={Array.isArray(props.buffers) ? props.buffers : []}
      additives={Array.isArray(props.additives) ? props.additives : []}
    />
  );
};


/* =========================================================
   LINKS MANAGER UTILITY
========================================================= */
const LinksManager = ({ links = [], setLinks }) => {
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

/* =========================================================
   CELL LINE DEFINITION SECTION
========================================================= */
const CellLineDefinitionSection = ({
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
          <select value={selectedName} onChange={(e) => chooseCellLine(e.target.value)} className={CALC_INPUT_CLS}>
            <option value="">New cell line...</option>
            {existingNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
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
        
        <LinksManager links={links} setLinks={setLinks} />

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



/* =========================================================
   PLASMID DEFINITION SECTION
========================================================= */
const PlasmidDefinitionSection = ({
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
          <select value={selectedName} onChange={(e) => choosePlasmid(e.target.value)} className={CALC_INPUT_CLS}>
            <option value="">New plasmid...</option>
            {existingNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
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

        <LinksManager links={links} setLinks={setLinks} />

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


/* =========================================================
   LIBRARY DIRECTORY
========================================================= */
/* Scrollable, clickable table used for the Compound / Cell Line / Plasmid
   library listings — replaces the old tag/badge cloud for these three
   resource types with something that reads more like a proper catalog. */
const LibraryTable = ({ columns, rows, onRowClick, emptyLabel }) => (
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

const LibraryDirectory = ({ 
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
      const seq = stripHtml(m.insertSequence || '');
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
      appliesTo,
      // Which named subsection of the target page this field belongs to
      // (a notebookChecks id, e.g. 'cond', 'seq', 'instrument'). Empty
      // string = general / applies anywhere on the page.
      subsection: typeof base.subsection === 'string' ? base.subsection : ''
    };
  });
};

/* =========================================================
   MANDATORY PARAMETER RULES
   { id, page: 'all' | typeKey, subsection: '' | notebookCheck id, fieldName }
   Migrates the legacy flat `mandatoryFields` string array (global,
   no page/subsection scoping) into the new rule shape when needed.
========================================================= */
const normalizeMandatoryRules = (rules, legacyFlatFields) => {
  if (Array.isArray(rules) && rules.length) {
    return rules
      .map((r, idx) => ({
        id: r?.id || `mandatory_rule_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        page: r?.page || 'all',
        subsection: r?.subsection || '',
        fieldName: (r?.fieldName || r?.name || '').toString()
      }))
      .filter((r) => r.fieldName.trim());
  }

  if (Array.isArray(legacyFlatFields) && legacyFlatFields.length) {
    return legacyFlatFields
      .filter(Boolean)
      .map((name, idx) => ({
        id: `mandatory_rule_legacy_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        page: 'all',
        subsection: '',
        fieldName: String(name)
      }));
  }

  return [];
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

const stripHtml = (str) => String(str || '').replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ');

const parseModifications = (input = '') => {
  if (!input) return [];

  return String(input)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((token) => {
      // Improved regex to catch multipliers even with spaces, e.g. "Amidation: 2" or "Phos x 3"
      const match = token.match(/^(.*?)(?:[:*x]\s*(\d+))?$/i);
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

      let delta = 0;
      let known = false;
      let label = rawName;

      if (found) {
        delta = found.delta;
        known = true;
        label = found.label;
      } else {
        // Fallback: If it's a custom chemical formula (e.g. C2H3O), calculate its MW!
        const formulaMw = getMolecularWeightFromFormula(rawName);
        if (formulaMw && !isNaN(parseFloat(formulaMw))) {
          delta = parseFloat(formulaMw);
          known = true;
        }
      }

      return Array.from({ length: count }, () => ({
        label,
        delta,
        known
      }));
    });
};

const modificationMass = (mods = []) => {
  return mods.reduce((sum, m) => sum + (Number(m.delta) || 0), 0);
};

const calculateSequenceInfo = ({ type = 'protein', sequence = '', modifications = '' }) => {
  const mods = parseModifications(modifications);
  const modMass = modificationMass(mods);

  const plainSeq = stripHtml(sequence);

  if (type === 'protein') {
    const clean = String(plainSeq || '')
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
    let clean = String(plainSeq || '')
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
    const raw = String(plainSeq || '').trim();

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
  const plainSeq = stripHtml(sequence);
  const clean = String(plainSeq || '')
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

function loadRDKit() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.__RDKit) return Promise.resolve(window.__RDKit);

  if (!rdkitPromise) {
    rdkitPromise = new Promise((resolve, reject) => {
      if (window.initRDKitModule) {
        resolve();
      } else {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load RDKit script from unpkg'));
        document.head.appendChild(script);
      }
    }).then(() => {
      if (!window.initRDKitModule) throw new Error('initRDKitModule not found');
      return window.initRDKitModule({
        locateFile: () => 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.wasm'
      });
    }).then((instance) => {
      window.__RDKit = instance;
      return instance;
    }).catch((err) => {
      rdkitPromise = null;
      throw err;
    });
  }
  return rdkitPromise;
}

async function calculateSmilesInfoAsync(smiles) {
  if (!smiles) return { error: 'Empty SMILES string' };

  try {
    const RDKit = await loadRDKit();
    if (!RDKit) return { error: 'RDKit failed to initialize' };

    const mol = RDKit.get_mol(smiles);
    if (!mol) return { error: 'Invalid SMILES structure (could not be parsed)' };

    let mw = null;

    try {
      const descStr = mol.get_descriptors();
      const desc = JSON.parse(descStr);
      // RDKit Minimal outputs lowercase keys like "amw" and "exactmw"
      mw = desc.amw || desc.AMW || desc.MolWt || desc.exactmw || desc.exactmolwt || null;
    } catch (err) {
      console.warn('RDKit descriptor parsing failed:', err);
      return { error: 'Failed to extract MW from descriptors' };
    } finally {
      if (mol && typeof mol.delete === 'function') {
        mol.delete();
      }
    }

    return {
      type: 'smiles',
      molecularWeight: mw ? Number(mw) : null,
      length: null
    };
  } catch (err) {
    console.error('RDKit exception:', err);
    return { error: err.message || 'Exception during calculation' };
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
  setCalculationEntries,
  currentUser
}) => {
  const isSuperuserCalc = currentUser?.role === 'superuser';
  const myName = currentUser?.name || null;
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
      createdAt: Date.now(),
      operator: myName || 'unknown', // associate with the scientist who saved it
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

  // All entries for the selected compound
  const allEntries = selectedCompound ? calculationEntries[selectedCompound] || [] : [];
  // Normal users see only their own entries; superusers see all
  const entries = isSuperuserCalc
    ? allEntries
    : allEntries.filter((e) => !e.operator || e.operator === myName);

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

      <LinksManager links={links} setLinks={setLinks} />

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

/* =========================================================
   CUSTOM METADATA FIELDS MANAGER
========================================================= */

const CustomMetadataFieldsManager = ({ customFields = [], setCustomFields }) => {
  const [draft, setDraft] = useState({
    name: '',
    type: 'text',
    options: '',
    appliesTo: 'all',
    subsection: ''
  });

  const draftSubsections = draft.appliesTo === 'all' ? [] : getSubsectionsForPage(draft.appliesTo);

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
      appliesTo: draft.appliesTo || 'all',
      subsection: draft.appliesTo === 'all' ? '' : draft.subsection || ''
    };

    setCustomFields((prev) => [...(Array.isArray(prev) ? prev : []), newField]);

    setDraft({
      name: '',
      type: 'text',
      options: '',
      appliesTo: 'all',
      subsection: ''
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

        <div className="md:col-span-2">
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
            Special Page
          </label>

          <select
            value={draft.appliesTo}
            onChange={(e) => setDraft((prev) => ({ ...prev, appliesTo: e.target.value, subsection: '' }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
            Subsection
          </label>

          <select
            value={draft.subsection}
            onChange={(e) => setDraft((prev) => ({ ...prev, subsection: e.target.value }))}
            disabled={draft.appliesTo === 'all'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">General (anywhere on the page)</option>
            {draftSubsections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1 flex items-end">
          <button
            type="button"
            onClick={addField}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-2 rounded-lg text-sm shadow-sm transition-colors"
          >
            Add
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
            const fieldSubsections = scopeValue === 'all' ? [] : getSubsectionsForPage(scopeValue);

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

                  <div className="md:col-span-2">
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
                      Special Page
                    </label>

                    <select
                      value={scopeValue}
                      onChange={(e) => updateField(field.id, { appliesTo: e.target.value, subsection: '' })}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
                    >
                      {CUSTOM_FIELD_TAB_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Subsection
                    </label>

                    <select
                      value={field.subsection || ''}
                      onChange={(e) => updateField(field.id, { subsection: e.target.value })}
                      disabled={scopeValue === 'all'}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">General</option>
                      {fieldSubsections.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-3 rounded-lg text-sm transition-colors"
                    >
                      ✕
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
   MANDATORY PARAMETERS MANAGER
   Rules are scoped to a special page (or "all") + an optional named
   subsection of that page. Each special page also gets its own
   behavior setting for what happens when one of its mandatory fields
   is left blank: show a warning, block the page, or don't check at all.
========================================================= */
const MANDATORY_BEHAVIOR_OPTIONS = [
  { value: 'warning', label: 'Warning banner only' },
  { value: 'block', label: 'Block the page until filled in' },
  { value: 'deactivate', label: 'Deactivate (do not check)' }
];

const MandatoryParametersManager = ({
  mandatoryRules = [],
  setMandatoryRules,
  mandatoryBehavior = {},
  setMandatoryBehavior
}) => {
  const [draft, setDraft] = useState({ page: 'all', subsection: '', fieldName: '' });

  const draftSubsections = draft.page === 'all' ? [] : getSubsectionsForPage(draft.page);

  const addRule = () => {
    const fieldName = draft.fieldName.trim();

    if (!fieldName) {
      alert('Please enter the exact field name to require.');
      return;
    }

    const newRule = {
      id: `mandatory_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      page: draft.page,
      subsection: draft.page === 'all' ? '' : draft.subsection,
      fieldName
    };

    setMandatoryRules((prev) => [...(Array.isArray(prev) ? prev : []), newRule]);
    setDraft((prev) => ({ ...prev, fieldName: '' }));
  };

  const removeRule = (id) => {
    setMandatoryRules((prev) => (Array.isArray(prev) ? prev : []).filter((r) => r.id !== id));
  };

  const setBehaviorForPage = (page, value) => {
    setMandatoryBehavior((prev) => ({ ...(prev || {}), [page]: value }));
  };

  const pageLabel = (page) =>
    page === 'all' ? 'All special pages' : (SPECIAL_PAGES.find((p) => p.value === page)?.label || page);

  const subsectionLabel = (page, subId) => {
    if (!subId) return 'General (any part of the page)';
    return getSubsectionsForPage(page).find((s) => s.id === subId)?.label || subId;
  };

  return (
    <div>
      <h3 className="text-sm font-bold text-slate-700 uppercase mb-1">Mandatory Parameters</h3>
      <p className="text-xs text-slate-500 mb-4">
        Define fields that must be filled in before a special page is considered complete — optionally
        scoped to one exact subsection of that page. Then choose, per page, what happens if one is left blank.
      </p>

      {/* Per-page behavior */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {SPECIAL_PAGES.map((p) => (
          <div
            key={p.value}
            className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50"
          >
            <span className="text-sm font-bold text-slate-700">{p.label}</span>

            <select
              value={mandatoryBehavior[p.value] || 'warning'}
              onChange={(e) => setBehaviorForPage(p.value, e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-500"
            >
              {MANDATORY_BEHAVIOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Add rule form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Special Page</label>

          <select
            value={draft.page}
            onChange={(e) => setDraft({ page: e.target.value, subsection: '', fieldName: draft.fieldName })}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500"
          >
            <option value="all">All special pages</option>
            {SPECIAL_PAGES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subsection</label>

          <select
            value={draft.subsection}
            onChange={(e) => setDraft((prev) => ({ ...prev, subsection: e.target.value }))}
            disabled={draft.page === 'all'}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">General (any part of the page)</option>
            {draftSubsections.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Field Name</label>

          <input
            type="text"
            value={draft.fieldName}
            onChange={(e) => setDraft((prev) => ({ ...prev, fieldName: e.target.value }))}
            placeholder='e.g. "Operator", "Solvent", or a Custom Metadata Field name'
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={addRule}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Rules list */}
      <div className="flex flex-col gap-2">
        {(!mandatoryRules || mandatoryRules.length === 0) ? (
          <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
            No mandatory parameters defined yet.
          </div>
        ) : (
          mandatoryRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-white shadow-sm"
            >
              <div className="text-sm">
                <span className="font-bold text-slate-800">{rule.fieldName}</span>
                <span className="text-slate-400"> — </span>
                <span className="text-slate-600">{pageLabel(rule.page)}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-slate-600">{subsectionLabel(rule.page, rule.subsection)}</span>
              </div>

              <button
                type="button"
                onClick={() => removeRule(rule.id)}
                className="text-red-500 hover:text-red-700 font-bold text-sm px-2"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const ScientistsOperatorsManager = ({
  operators = [],
  setOperators,
  authSettings,
  setAuthSettings,
  currentUser,
}) => {
  const [draft, setDraft] = useState({ name: '', surname: '', role: 'user', password: '' });
  const [editingId, setEditingId] = useState(null);
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('user');
  const [saving, setSaving] = useState(false);

  const isSuperuser = currentUser?.role === 'superuser';
  // Bootstrap: if no superuser exists yet, allow anyone to define roles
  const hasSuperuserDefined = normalizeOperators(operators).some((op) => op.role === 'superuser');
  const canManage = isSuperuser || !hasSuperuserDefined;

  const addOperator = async () => {
    const fullName = `${draft.name.trim()} ${draft.surname.trim()}`.trim();
    if (!fullName) { alert('Please enter scientist name and/or surname.'); return; }
    if (operators.some((op) => op.name.toLowerCase() === fullName.toLowerCase())) {
      alert('Scientist already exists.'); return;
    }
    if (!draft.password) { alert('Please set a password for this scientist.'); return; }
    setSaving(true);
    const hash = await hashPassword(draft.password);
    setSaving(false);
    const newOp = {
      id: 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      name: fullName,
      role: draft.role,
      passwordHash: hash,
    };
    setOperators((prev) => [...normalizeOperators(prev), newOp].sort((a, b) => a.name.localeCompare(b.name)));
    setDraft({ name: '', surname: '', role: 'user', password: '' });
  };

  const removeOperator = (id) => {
    setOperators((prev) => normalizeOperators(prev).filter((op) => op.id !== id));
  };

  const startEdit = (op) => {
    setEditingId(op.id);
    setEditRole(op.role);
    setEditPassword('');
  };

  const saveEdit = async (id) => {
    setSaving(true);
    const hash = editPassword ? await hashPassword(editPassword) : null;
    setSaving(false);
    setOperators((prev) =>
      normalizeOperators(prev).map((op) => {
        if (op.id !== id) return op;
        return {
          ...op,
          role: canManage ? editRole : op.role,
          ...(hash ? { passwordHash: hash } : {}),
        };
      })
    );
    setEditingId(null);
  };

  const normalizedOps = normalizeOperators(operators);
  // For normal users: only their own entry
  const selfServiceOp = !canManage && currentUser
    ? normalizedOps.find((op) => op.id === currentUser.id) || null
    : null;
  const [selfPw, setSelfPw] = useState('');
  const [selfPwConfirm, setSelfPwConfirm] = useState('');
  const [selfSaving, setSelfSaving] = useState(false);
  const [selfMsg, setSelfMsg] = useState('');

  const saveSelfPassword = async () => {
    if (!selfPw) { setSelfMsg('⚠️ Enter a new password.'); return; }
    if (selfPw !== selfPwConfirm) { setSelfMsg('⚠️ Passwords do not match.'); return; }
    setSelfSaving(true); setSelfMsg('');
    const hash = await hashPassword(selfPw);
    setOperators((prev) => normalizeOperators(prev).map((op) =>
      op.id === currentUser.id ? { ...op, passwordHash: hash } : op
    ));
    setSelfPw(''); setSelfPwConfirm('');
    setSelfSaving(false);
    setSelfMsg('✅ Password updated successfully.');
    setTimeout(() => setSelfMsg(''), 3000);
  };

  // Self-service view for normal users
  if (selfServiceOp) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase">My Account</h3>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
          selfServiceOp.role === 'superuser' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'
        }`}>
          <span className="text-lg">{selfServiceOp.role === 'superuser' ? '👑' : '🧪'}</span>
          <div>
            <p className="font-bold text-slate-800">{selfServiceOp.name}</p>
            <p className="text-xs text-slate-500 capitalize">{selfServiceOp.role}</p>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Change My Password</h4>
          <div className="flex flex-col gap-2">
            <input type="password" value={selfPw} onChange={(e) => setSelfPw(e.target.value)}
              placeholder="New password"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full" />
            <input type="password" value={selfPwConfirm} onChange={(e) => setSelfPwConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 w-full" />
            <button onClick={saveSelfPassword} disabled={selfSaving}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50 w-full">
              {selfSaving ? 'Saving…' : 'Update Password'}
            </button>
            {selfMsg && <p className="text-xs text-center mt-1">{selfMsg}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-6">

      {/* ── ADD SCIENTIST (superuser / bootstrap only) ── */}
      {canManage && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
            <input type="text" value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="e.g. Marie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Surname</label>
            <input type="text" value={draft.surname}
              onChange={(e) => setDraft((p) => ({ ...p, surname: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="e.g. Curie"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <input type="password" value={draft.password}
              onChange={(e) => setDraft((p) => ({ ...p, password: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') addOperator(); }}
              placeholder="Required"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Role</label>
            <select value={draft.role} onChange={(e) => setDraft((p) => ({ ...p, role: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white">
              <option value="user">User</option>
              <option value="superuser">Superuser</option>
            </select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <button type="button" onClick={addOperator} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Scientist'}
            </button>
          </div>
        </div>
      )}

        {/* ── SCIENTIST LIST ── */}
        <div className="flex flex-col gap-2">
          {!canManage && (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 italic">
              👁️ Read-only — log in as a superuser to manage scientists and passwords.
            </div>
          )}
          {normalizedOps.length === 0 ? (
            <div className="text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No scientists/operators defined.
            </div>
          ) : (
            normalizedOps.map((op) => (
              <div key={op.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
                  op.role === 'superuser'
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                <span className="text-lg">{op.role === 'superuser' ? '👑' : '🧪'}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-slate-800">{op.name}</span>
                  <span className={`ml-2 text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                    op.role === 'superuser' ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {op.role === 'superuser' ? 'Superuser' : 'User'}
                  </span>
                  {canManage && (op.passwordHash ? (
                    <span className="ml-2 text-[10px] text-emerald-600">🔐 Password set</span>
                  ) : (
                    <span className="ml-2 text-[10px] text-red-500">⚠️ No password</span>
                  ))}
                </div>

                {/* Edit controls — only for canManage users */}
                {canManage && (
                  editingId === op.id ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {canManage && (
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-blue-500">
                          <option value="user">User</option>
                          <option value="superuser">Superuser</option>
                        </select>
                      )}
                      <input type="password" value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        placeholder="New password (optional)"
                        className="border border-slate-300 rounded px-2 py-1 text-xs outline-none focus:border-blue-500 w-40" />
                      <button onClick={() => saveEdit(op.id)} disabled={saving}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1 rounded transition-colors disabled:opacity-50">
                        {saving ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-3 py-1 rounded transition-colors">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(op)}
                        className="text-blue-500 hover:text-blue-700 text-xs font-bold px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        title="Edit role / change password">
                        ✏️
                      </button>
                      <button onClick={() => removeOperator(op.id)}
                        className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        title="Remove scientist">
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
            ))
          )}
        </div>


      {/* ── AUTH SETTINGS (superuser only) ── */}
      {(isSuperuser || (!hasSuperuserDefined)) && authSettings && setAuthSettings && (
        <div className="border-t border-slate-200 pt-5">
          <h3 className="text-sm font-bold text-amber-700 uppercase mb-3 flex items-center gap-2">
            👑 Access Control Settings
            {!hasSuperuserDefined && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-normal">
                ⚠️ Define a superuser first to lock these settings
              </span>
            )}
          </h3>
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox"
                checked={!!authSettings.requireLoginOnEntry}
                onChange={(e) => setAuthSettings((p) => ({ ...p, requireLoginOnEntry: e.target.checked }))}
                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
              <div>
                <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">
                  Require login before accessing the app
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  When enabled, users must select a scientist and enter their password before seeing anything.
                  When disabled, everyone can browse the Dashboard, Definitions, Agenda, etc. — but protected tests still require login.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox"
                checked={!!authSettings.hideOtherScientistTests}
                onChange={(e) => setAuthSettings((p) => ({ ...p, hideOtherScientistTests: e.target.checked }))}
                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
              <div>
                <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">
                  Hide other scientists' tests completely
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  When enabled, users only see their own tests in the list.
                  When disabled, all tests are visible — others' tests show a 🔒 icon and require authentication to open.
                </p>
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

/* =========================================================
   SCIENTIST LOGIN GATE  (full-screen, mandatory)
========================================================= */

const ScientistLoginGate = ({ operators, onLogin, onRecovery }) => {
  const normalizedOps = normalizeOperators(operators || []);
  // Recovery mode: if nobody has a password set, allow emergency bypass
  const noneHavePassword = normalizedOps.every((op) => !op.passwordHash);
  const [selectedId, setSelectedId] = useState(normalizedOps.length === 1 ? normalizedOps[0].id : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = React.useRef(null);

  React.useEffect(() => {
    if (selectedId) setTimeout(() => passwordRef.current?.focus(), 80);
  }, [selectedId]);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedId) { setError('Please select your name.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      const op = normalizedOps.find((o) => o.id === selectedId);
      if (!op) { setError('Scientist not found.'); setLoading(false); return; }
      if (!op.passwordHash) { setError('No password set for this account. Contact a superuser.'); setLoading(false); return; }
      const hash = await hashPassword(password);
      if (hash !== op.passwordHash) {
        setError('Incorrect password. Try again.');
        setPassword('');
        setLoading(false);
        return;
      }
      onLogin({ id: op.id, name: op.name, role: op.role });
    } catch (err) {
      setError('Login failed: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 shadow-2xl">

          {/* Logo / branding */}
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🔬</div>
            <h1 className="text-2xl font-black text-white tracking-tight">Lab Workspace</h1>
            <p className="text-blue-200 text-sm mt-1 font-medium">Secure access — please identify yourself</p>
          </div>

          {/* Special panel when no scientists are configured */}
          {normalizedOps.length === 0 && (
            <div className="mb-6 bg-amber-500/20 border border-amber-400/40 rounded-xl px-5 py-4 text-center">
              <div className="text-2xl mb-2">⚠️</div>
              <p className="text-amber-200 font-bold text-sm mb-1">No scientists configured</p>
              <p className="text-amber-300/70 text-xs">
                Scientist accounts were lost (e.g. from an HTML file load). Use recovery to re-configure.
              </p>
              {onRecovery && (
                <button
                  type="button"
                  onClick={onRecovery}
                  className="mt-3 bg-amber-500 hover:bg-amber-400 text-white font-black px-4 py-2 rounded-lg text-sm transition-colors w-full"
                >
                  🔓 Enter Recovery Mode
                </button>
              )}
            </div>
          )}

          {/* Scientist selector */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-blue-200 uppercase mb-1.5 tracking-wider">
              Scientist
            </label>
            <select
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
              className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" style={{ background: '#1e293b' }}>— Select your name —</option>
              {normalizedOps.map((op) => (
                <option key={op.id} value={op.id} style={{ background: '#1e293b' }}>
                  {op.role === 'superuser' ? '👑 ' : '🧪 '}{op.name}
                </option>
              ))}
            </select>
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-xs font-bold text-blue-200 uppercase mb-1.5 tracking-wider">
              Password
            </label>
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Enter your password"
              className="w-full bg-white/10 border border-white/20 text-white placeholder-blue-300/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white/15 transition-all"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 bg-red-500/20 border border-red-400/30 text-red-200 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
              <span>⚠️</span>{error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-blue-800 text-white font-black py-3 px-6 rounded-xl text-sm shadow-lg hover:shadow-blue-500/40 transition-all transform hover:scale-[1.02] disabled:scale-100 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifying…
              </>
            ) : (
              <>🔑 Enter Lab</>
            )}
          </button>

          {/* Recovery bypass — shown only if no passwords are set at all */}
          {noneHavePassword && onRecovery && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onRecovery}
                className="text-xs text-blue-300/70 hover:text-blue-200 underline transition-colors"
              >
                🔓 Emergency recovery (no passwords configured)
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

/* =========================================================
   SCIENTIST LOGIN MODAL
========================================================= */

const ScientistLoginModal = ({ operators, onLogin, onClose, title, subtitle }) => {
  const normalizedOps = normalizeOperators(operators || []);
  const [selectedId, setSelectedId] = useState(normalizedOps.length === 1 ? normalizedOps[0].id : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = React.useRef(null);

  // Focus the password field when modal opens
  React.useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!selectedId) { setError('Please select a scientist.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      const op = normalizedOps.find((o) => o.id === selectedId);
      if (!op) { setError('Scientist not found.'); setLoading(false); return; }
      if (!op.passwordHash) { setError('This scientist has no password set. Ask a superuser to set one.'); setLoading(false); return; }
      const hash = await hashPassword(password);
      if (hash !== op.passwordHash) {
        setError('Incorrect password. Try again.');
        setPassword('');
        setLoading(false);
        return;
      }
      onLogin({ id: op.id, name: op.name, role: op.role });
    } catch (err) {
      setError('Login failed: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[fadeIn_0.15s_ease]">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 px-6 py-5 text-white">
          <div className="text-2xl mb-2">🔐</div>
          <h2 className="text-xl font-black">{title || 'Scientist Login'}</h2>
          {subtitle && <p className="text-blue-100 text-sm mt-1">{subtitle}</p>}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Scientist</label>
            <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setError(''); }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500 bg-white font-medium">
              <option value="">— Select scientist —</option>
              {normalizedOps.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.role === 'superuser' ? '👑 ' : '🧪 '}{op.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
            <input ref={inputRef} type="password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter your password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
              ⚠️ {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-sm transition-colors disabled:opacity-50">
              {loading ? 'Verifying…' : 'Log In'}
            </button>
            {onClose && (
              <button type="button" onClick={onClose}
                className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
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
STORAGE FINDER
========================================================= */
const StorageFinder = ({
  tests = [],
  storages = [],
  operators = [],
  onOpenTest,
  onOpenStorage
}) => {
  const [searchMode, setSearchMode] = useState('owner');
  const [entityFilter, setEntityFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [textQuery, setTextQuery] = useState('');

  const findStorage = useCallback(
    (id) => storages.find((s) => s.id === id),
    [storages]
  );

  const positionLabel = useCallback((index, cols = 12) => {
    if (index === null || index === undefined || index === '') return '';

    const i = Number(index);
    const c = Number(cols) > 0 ? Number(cols) : 12;

    if (!Number.isFinite(i) || i < 0) return '';

    const row = Math.floor(i / c);
    const col = (i % c) + 1;

    const rowLabel =
      (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[row]) || String(row + 1);

    return `${rowLabel}${col}`;
  }, []);

  const parseWell = useCallback((value) => {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) return null;

      if (trimmed.startsWith('{')) {
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          return null;
        }
      }

      return { compound: trimmed };
    }

    if (typeof value === 'object') return value;

    return { compound: String(value) };
  }, []);

  const hasValue = useCallback((value) => {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }, []);

  const getBoxOwner = useCallback((box) => {
    return String(box?.boxOwner || box?.operator || '').trim();
  }, []);

  const getWellOwner = useCallback((well) => {
    return String(well?.sampleOwner || well?.operator || '').trim();
  }, []);

  const getWellDetails = useCallback(
    (well) => {
      if (!well || typeof well !== 'object') return [];

      const owner = getWellOwner(well);

      const concentration = hasValue(well.concentration)
        ? [well.concentration, well.concUnit].filter(hasValue).join(' ')
        : '';

      const volume = hasValue(well.volume)
        ? [well.volume, well.volUnit].filter(hasValue).join(' ')
        : '';

      const weight = hasValue(well.weight)
        ? [well.weight, well.weightUnit].filter(hasValue).join(' ')
        : '';

      const details = [];

      if (hasValue(well.compound)) {
        details.push({ label: 'Compound', value: well.compound });
      }

      if (hasValue(owner)) {
        details.push({ label: 'Sample Owner', value: owner });
      }

      if (hasValue(well.operator) && String(well.operator).trim() !== owner) {
        details.push({ label: 'Operator', value: well.operator });
      }

      if (hasValue(well.solvent)) {
        details.push({ label: 'Solvent', value: well.solvent });
      }

      if (hasValue(concentration)) {
        details.push({ label: 'Concentration', value: concentration });
      }

      if (hasValue(volume)) {
        details.push({ label: 'Volume', value: volume });
      }

      if (hasValue(well.date)) {
        details.push({ label: 'Date', value: well.date });
      }

      if (hasValue(weight)) {
        details.push({ label: 'Weight', value: weight });
      }

      if (hasValue(well.description)) {
        details.push({ label: 'Notes', value: well.description });
      }

      return details;
    },
    [getWellOwner, hasValue]
  );

  const isStoredBox = useCallback(
    (box) => {
      if (!box) return false;

      const storage = findStorage(box.storageId);

      return Boolean(
        storage ||
          box.storageLabel ||
          box.storageType ||
          (box.storageIndex !== null &&
            box.storageIndex !== undefined &&
            box.storageIndex !== '')
      );
    },
    [findStorage]
  );

  const getBoxLocation = useCallback(
    (box) => {
      const storage = findStorage(box?.storageId);

      if (storage) {
        const pos = positionLabel(box?.storageIndex, storage.cols);
        return pos ? `${storage.name} · Slot ${pos}` : storage.name;
      }

      const legacy = [box?.storageType, box?.storageLabel]
        .filter(Boolean)
        .join(' / ');

      return legacy || 'No storage assigned';
    },
    [findStorage, positionLabel]
  );

  const getWellLocation = useCallback(
    (box, r, c) => {
      const storage = findStorage(box?.storageId);

      const rowLabel =
        (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
        String.fromCharCode(65 + r);

      const cell = `${rowLabel}${c + 1}`;

      const boxSlot = storage
        ? positionLabel(box?.storageIndex, storage.cols)
        : '';

      const storageName = storage
        ? storage.name
        : [box?.storageType, box?.storageLabel].filter(Boolean).join(' / ') ||
          'Unassigned storage';

      return [
        storageName,
        box?.name || 'Unnamed box',
        boxSlot ? `Slot ${boxSlot}` : '',
        `Cell ${cell}`
      ]
        .filter(Boolean)
        .join(' → ');
    },
    [findStorage, positionLabel]
  );

  const ownerOptions = useMemo(() => {
    const fromOperators = (Array.isArray(operators) ? operators : [])
      .map((op) =>
        typeof op === 'string'
          ? op
          : `${op?.name || ''} ${op?.surname || ''}`.trim()
      )
      .filter(Boolean);

    const fromTests = [];
    const fromWells = [];

    tests.forEach((t) => {
      fromTests.push(t.boxOwner || '', t.operator || '', t.sampleOwner || '');

      if (t.type === 'plate-9x9box') {
        (t.grid || []).forEach((row) => {
          (row || []).forEach((cell) => {
            const well = parseWell(cell);

            if (well) {
              fromWells.push(well.sampleOwner || well.operator || '');
            }
          });
        });
      }
    });

    return [
      ...new Set(
        [...fromOperators, ...fromTests, ...fromWells].map(String).filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b));
  }, [operators, tests, parseWell]);

  const results = useMemo(() => {
    const sortResults = (arr) =>
      [...arr].sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
      );

    const res = [];

    if (searchMode === 'owner') {
      if (!ownerFilter) return [];

      tests.forEach((box) => {
        if (box.type !== 'plate-9x9box') return;
        if (!isStoredBox(box)) return;

        if (entityFilter !== 'sample' && getBoxOwner(box) === ownerFilter) {
          res.push({
            key: box.id,
            testId: box.id,
            boxId: box.id,
            storageId: box.storageId || '',
            name: box.name || 'Unnamed box',
            owner: getBoxOwner(box),
            kind: 'Box',
            location: getBoxLocation(box),
            isWellSample: false,
            details: []
          });
        }

        if (entityFilter !== 'box') {
          (box.grid || []).forEach((row, r) => {
            (row || []).forEach((cell, c) => {
              const well = parseWell(cell);

              if (!well) return;

              const owner = getWellOwner(well);

              if (owner !== ownerFilter) return;

              const rowLabel =
                (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
                String.fromCharCode(65 + r);

              const cellLabel = `${rowLabel}${c + 1}`;

              res.push({
                key: `${box.id}-${r}-${c}`,
                testId: box.id,
                boxId: box.id,
                storageId: box.storageId || '',
                name: well.compound || `Sample ${cellLabel}`,
                owner,
                kind: 'Sample',
                location: getWellLocation(box, r, c),
                isWellSample: true,
                details: getWellDetails(well)
              });
            });
          });
        }
      });

      return sortResults(res);
    }

    const q = textQuery.trim().toLowerCase();

    if (!q) return [];

    if (searchMode === 'box') {
      tests.forEach((box) => {
        if (box.type !== 'plate-9x9box') return;
        if (!isStoredBox(box)) return;

        const haystack = `${box.name || ''} ${box.instanceName || ''}`.toLowerCase();

        if (!haystack.includes(q)) return;

        res.push({
          key: box.id,
          testId: box.id,
          boxId: box.id,
          storageId: box.storageId || '',
          name: box.name || 'Unnamed box',
          owner: getBoxOwner(box),
          kind: 'Box',
          location: getBoxLocation(box),
          isWellSample: false,
          details: []
        });
      });

      return sortResults(res);
    }

    tests.forEach((box) => {
      if (box.type !== 'plate-9x9box') return;
      if (!isStoredBox(box)) return;

      (box.grid || []).forEach((row, r) => {
        (row || []).forEach((cell, c) => {
          const well = parseWell(cell);

          if (!well) return;

          const haystack = `${well.compound || ''} ${well.description || ''}`.toLowerCase();

          if (!haystack.includes(q)) return;

          const rowLabel =
            (Array.isArray(BOX_ROW_LABELS) && BOX_ROW_LABELS[r]) ||
            String.fromCharCode(65 + r);

          const cellLabel = `${rowLabel}${c + 1}`;

          res.push({
            key: `${box.id}-${r}-${c}`,
            testId: box.id,
            boxId: box.id,
            storageId: box.storageId || '',
            name: well.compound || `Sample ${cellLabel}`,
            owner: getWellOwner(well),
            kind: 'Sample',
            location: getWellLocation(box, r, c),
            isWellSample: true,
            details: getWellDetails(well)
          });
        });
      });
    });

    return sortResults(res);
  }, [
    searchMode,
    entityFilter,
    ownerFilter,
    textQuery,
    tests,
    isStoredBox,
    getBoxOwner,
    getWellOwner,
    getBoxLocation,
    getWellLocation,
    getWellDetails,
    parseWell
  ]);

  const hasSearch =
    searchMode === 'owner' ? !!ownerFilter : !!textQuery.trim();

  return (
    <div className="p-4 md:p-6 pb-0 shrink-0 no-print">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-5">
        <div className="flex flex-col xl:flex-row gap-3 xl:items-end">
          <div className="w-full xl:w-56">
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Search Type
            </label>
            <select
              value={searchMode}
              onChange={(e) => {
                setSearchMode(e.target.value);
                setOwnerFilter('');
                setTextQuery('');
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
            >
              <option value="owner">Owner</option>
              <option value="box">Box name</option>
              <option value="sample">Sample name</option>
            </select>
          </div>

          {searchMode === 'owner' && (
            <>
              <div className="w-full xl:w-56">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Search Scope
                </label>
                <select
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
                >
                  <option value="all">Boxes & Samples</option>
                  <option value="box">Boxes only</option>
                  <option value="sample">Samples only</option>
                </select>
              </div>

              <div className="flex-1 w-full">
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Owner
                </label>
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
                >
                  <option value="">Select owner...</option>
                  {ownerOptions.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {searchMode === 'box' && (
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Box Name
              </label>
              <input
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="Search stored boxes by name..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

          {searchMode === 'sample' && (
            <div className="flex-1 w-full">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                Sample Name
              </label>
              <input
                type="text"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                placeholder="Search samples inside stored boxes..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {hasSearch ? (
          results.length === 0 ? (
            <div className="mt-4 text-sm text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4">
              No stored results found for this search.
            </div>
          ) : (
            <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
              <div className="max-h-72 overflow-auto custom-scrollbar">
                <table className="w-full text-sm border-collapse min-w-max">
                  <thead className="sticky top-0 bg-slate-100 z-10">
                    <tr>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Type
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Name
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Owner
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Location
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Sample Fields
                      </th>
                      <th className="text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide px-3 py-2 border-b border-slate-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors"
                      >
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.kind}
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-800 align-top">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.owner || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.location}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">
                          {row.details && row.details.length > 0 ? (
                            <div className="text-xs flex flex-col gap-0.5 min-w-[220px] max-w-[340px]">
                              {row.details.map((d, i) => (
                                <div key={i}>
                                  <span className="font-bold text-slate-700">
                                    {d.label}:
                                  </span>{' '}
                                  {d.value}
                                </div>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-2">
                            {row.isWellSample ? (
                              <button
                                type="button"
                                onClick={() => onOpenTest && onOpenTest(row.boxId)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Open box
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenTest && onOpenTest(row.testId)}
                                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Open {row.kind.toLowerCase()}
                              </button>
                            )}

                            {row.storageId && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenStorage && onOpenStorage(row.storageId)
                                }
                                className="bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold py-1 px-2 rounded text-xs transition-colors"
                              >
                                Show storage
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <div className="mt-4 text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
            Search by <b>owner</b> to find stored boxes and samples inside boxes.
            Search by <b>box name</b> to find where a stored box is located.
            Search by <b>sample name</b> to find samples stored inside boxes.
          </div>
        )}
      </div>
    </div>
  );
};
/* =========================================================
   DATABASE CLEANUP & MERGING
========================================================= */
const DatabaseCleanupManager = ({
  tests, setTests,
  allCmpds, allCellLines,
  setCustomCmpds, setCompoundMeta, compoundMeta,
  setCustomCellLines, setCellLineMeta, cellLineMeta
}) => {
  // Merge state
  const [oldName, setOldName] = useState('');
  const [newName, setNewName] = useState('');

  // Rename state
  const [renameTarget, setRenameTarget] = useState('');
  const [renameValue, setRenameValue] = useState('');

  // Combine compounds and cell lines
  const allResources = [...new Set([...allCmpds, ...allCellLines])].sort((a, b) => a.localeCompare(b));

  const replaceInTests = (oldVal, newVal) => {
    setTests(prevTests => prevTests.map(t => {
      let updated = { ...t };
      
      // Standard string fields
      if (updated.compound === oldVal) updated.compound = newVal;
      if (updated.otherMolecule === oldVal) updated.otherMolecule = newVal;
      if (updated.lipid === oldVal) updated.lipid = newVal;
      if (updated.moleculeName === oldVal) updated.moleculeName = newVal;

      // Arrays of strings
      if (Array.isArray(updated.selectedCompounds)) {
        updated.selectedCompounds = updated.selectedCompounds.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.cellLines)) {
        updated.cellLines = updated.cellLines.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.compounds)) {
        updated.compounds = updated.compounds.map(c => c === oldVal ? newVal : c);
      }
      if (Array.isArray(updated.rowCompounds)) {
        updated.rowCompounds = updated.rowCompounds.map(c => c === oldVal ? newVal : c);
      }

      // 2D Grid (Plate Boxes and Multiwell assays)
      if (Array.isArray(updated.grid)) {
        updated.grid = updated.grid.map(row => 
          row.map(cell => {
            if (!cell) return cell;
            
            if (typeof cell === 'string') {
              if (cell === oldVal) return newVal;
              // Handle JSON stringified wells
              if (cell.startsWith('{')) {
                try {
                  let parsed = JSON.parse(cell);
                  if (parsed.compound === oldVal) {
                    parsed.compound = newVal;
                    return JSON.stringify(parsed);
                  }
                } catch(e) {}
              }
              return cell;
            }
            
            // Handle Object wells
            if (typeof cell === 'object' && cell.compound === oldVal) {
              return { ...cell, compound: newVal };
            }
            return cell;
          })
        );
      }

      return updated;
    }));
  };

  const handleMergeReplace = () => {
    if (!oldName || !newName) return alert("Please select both the item to delete and the item to replace it with.");
    if (oldName === newName) return alert("The old name and new name must be different.");
    
    if (!window.confirm(`WARNING: Every instance of "${oldName}" will be permanently rewritten to "${newName}".\n\n"${oldName}" will then be DELETED from the library.\n\nAre you sure you want to proceed?`)) return;

    replaceInTests(oldName, newName);

    // Delete the old item
    setCustomCmpds(prev => prev.filter(c => c !== oldName));
    setCompoundMeta(prev => { const next = {...prev}; delete next[oldName]; return next; });
    
    setCustomCellLines(prev => prev.filter(c => c !== oldName));
    setCellLineMeta(prev => { const next = {...prev}; delete next[oldName]; return next; });

    setOldName('');
    setNewName('');
    alert(`Success! "${oldName}" merged into "${newName}".`);
  };

  const handleGlobalRename = () => {
    const val = renameValue.trim();
    if (!renameTarget || !val) return alert("Please select an item and enter a new name.");
    if (renameTarget === val) return alert("The new name is the same as the old name.");
    if (allResources.includes(val)) return alert(`"${val}" already exists in the library! If you want to combine them, use the 'Merge & Delete Duplicate' tool below.`);

    if (!window.confirm(`This will rename "${renameTarget}" to "${val}" in the library AND update it across all your existing tests/plates.\n\nMetadata (MW, sequence, etc.) will be preserved.\n\nProceed?`)) return;

    replaceInTests(renameTarget, val);

    // Rename in Compound Library
    if (allCmpds.includes(renameTarget)) {
      setCustomCmpds(prev => {
        const arr = prev.filter(c => c !== renameTarget);
        arr.push(val);
        return arr;
      });
      setCompoundMeta(prev => {
        const next = {...prev};
        const oldMeta = next[renameTarget] || {};
        next[val] = { ...oldMeta, name: val, updatedAt: Date.now() };
        delete next[renameTarget];
        return next;
      });
    }

    // Rename in Cell Line Library
    if (allCellLines.includes(renameTarget)) {
      setCustomCellLines(prev => {
        const arr = prev.filter(c => c !== renameTarget);
        arr.push(val);
        return arr;
      });
      setCellLineMeta(prev => {
        const next = {...prev};
        const oldMeta = next[renameTarget] || {};
        next[val] = { ...oldMeta, name: val, updatedAt: Date.now() };
        delete next[renameTarget];
        return next;
      });
    }

    setRenameTarget('');
    setRenameValue('');
    alert(`Success! "${renameTarget}" renamed to "${val}".`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* --- RENAME TOOL --- */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-bold text-blue-800 mb-3 text-sm">Global Rename</h4>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-blue-700 uppercase mb-1">Item to Rename</label>
            <select value={renameTarget} onChange={e => setRenameTarget(e.target.value)} className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 text-slate-800 font-semibold">
              <option value="">-- Select item --</option>
              {allResources.map(r => <option key={`ren-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-1 flex justify-center pb-2 text-blue-400 font-black text-xl">
            ➔
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-blue-700 uppercase mb-1">New Name</label>
            <input 
              type="text" 
              value={renameValue} 
              onChange={e => setRenameValue(e.target.value)} 
              placeholder="Type new name..." 
              className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 text-slate-800 font-semibold"
            />
          </div>

          <div className="md:col-span-3">
            <button 
              onClick={handleGlobalRename}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm"
            >
              Rename Everywhere
            </button>
          </div>
        </div>
        <p className="text-xs text-blue-600 mt-3 font-medium">
          Use this to fix typos. The item will keep all its properties (MW, sequence, etc.) and its name will be updated instantly in all tests.
        </p>
      </div>

      {/* --- MERGE TOOL --- */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm">
        <h4 className="font-bold text-red-800 mb-3 text-sm">Merge & Delete Duplicate</h4>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-red-700 uppercase mb-1">Bad Item (To Delete)</label>
            <select value={oldName} onChange={e => setOldName(e.target.value)} className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-red-500 text-red-900 font-semibold">
              <option value="">-- Select duplicate --</option>
              {allResources.map(r => <option key={`old-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-1 flex justify-center pb-2 text-red-400 font-black text-xl">
            ➔
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-emerald-700 uppercase mb-1">Good Item (To Keep)</label>
            <select value={newName} onChange={e => setNewName(e.target.value)} className="w-full border border-emerald-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-emerald-500 text-emerald-900 font-semibold">
              <option value="">-- Select correct item --</option>
              {allResources.map(r => <option key={`new-${r}`} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="md:col-span-3">
            <button 
              onClick={handleMergeReplace}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors text-sm"
            >
              Merge & Replace
            </button>
          </div>
        </div>
        <p className="text-xs text-red-500 mt-3 font-medium">
          Use this if you have two identical items (e.g., "BadH" and "Bad_H") or accidentally saved a Cell Line as a Chemical. Create the correct one, then merge the bad one into it.
        </p>
      </div>
    </div>
  );
};
/* =========================================================
CLASSIFICATION CONSTANTS
========================================================= */
export const CLASSIFICATION_MAP = {
  "Protein production": ["Cloning", "Protein Expression and Purification", "Organic Purifications"],
  "Molecular Structure and Dynamics": ["Structure by NMR, CD, IR", "MD & Modeling", "Dynamics by NMR Relaxation, ssNMR", "Diffusion by DLS, NMR"],
  "Interactions": ["Association Constant", "Molecular Docking", "MD interactions", "Chromatography"],
  "Activity": ["Antibacterial activity", "Anticancer activity", "Antifungal activity", "Antiviral activity", "Toxicity"]
};
export const PRIMARY_CATEGORIES = Object.keys(CLASSIFICATION_MAP);

export const EXPERIMENT_TYPES = [
 "Cloning ",
 "Protein expression  & Purification ",
 "Multiwell plate essay ",
 "Flow Cytometry ",
 "Circular Dichroism ",
 "NMR ",
 "NMR Fitting ",
 "Solid State NMR ",
 "MD Simulation ",
 "Molecular Docking "
];
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
  secondaryCategory: '',
  bestMeasurement: false,
  operator: '',
  boxOwner: '',
  sampleOwner: '',
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
    
    if (customType === 'md_simulation') {
      return {
        ...baseTest,
        type: 'md_simulation',
        testCategory: 'Production',
        forceField: '',
        waterModel: '',
        temperature: '',
        pressure: '',
        simulationTime: '',
        timestep: '',
        boxType: '',
        ionConcentration: '',
        software: '',
        trajectoryLink: '',
        topologyLink: '',
        setupFileLink: '',
        images: []
      };
    }

    if (customType === 'cloning') {
      return {
        ...baseTest,
        type: 'cloning',
        testCategory: 'Vector Construction',
        pcrProgram: [],
        reactionMix: [],
        dnaQuantification: [],
        gelImages: [],
        uvSpectra: [],
        sim: null
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
if (customType === 'ssnmr') {
return {
...baseTest,
type: 'ssnmr',
testCategory: 'Solid-state NMR',
lipid: '',
deuteration: '',
hydration: '',
cholesterolRatio: '',
ratio: '',
wavelengthData: '',
spectraColumns: [],
ssFits: {},
brukerMeta: null,
chartCfg: {
yMin: '',
yMax: '',
xMin: '-250',
xMax: '250',
fontSize: 12,
lineWidth: 2
}
};
}
    if (customType === 'protein_expression') {
      return {
        ...baseTest,
        type: 'protein_expression',
        testCategory: 'Expression Optimization', 
        yieldData: [],
        gelImages: [],
        chromatogramRaw: '',
        inductionMethod: '',
        inductionTemp: '',
        lysisBuffer: '',
        columnType: ''
      };
    }

    
if (customType === 'docking') {
   return {
     ...baseTest,
     type: 'docking',
     testCategory: 'Blind Docking',
     dockingProgram: '',
     scoringFunction: '',
     searchAlgorithm: '',
     exhaustiveness: '',
     numModes: '',
     boxCenter: '',
     boxSize: '',
     bestAffinity: '',
     dockingImages: [],
     dockingResults: []
   };
 }
 if (customType === 'flow_cytometry') {
   return {
     ...baseTest,
     type: 'flow_cytometry',
     testCategory: 'Immunophenotyping',
     cellNumber: '',
     liveDeadStain: '',
     fixation: 'None',
     permeabilization: 'None',
     fcMachine: '',
     acquisitionSoftware: '',
     fcPanel: [],
     fcPopulations: []
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
  const [mandatoryFields, setMandatoryFields] = useState([]);
  const [mandatoryRules, setMandatoryRules] = useState([]);
  const [mandatoryBehavior, setMandatoryBehavior] = useState({});
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
  const [operators, setOperators] = useState(() => {
    try {
      const saved = localStorage.getItem('labWorkspace_operators');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  // ── AUTH STATE ──────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('labCurrentUser');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [loginModal, setLoginModal] = useState(null); // null | { targetScientistName?: string, onSuccess?: fn, isEntryGate?: bool }
  const [authSettings, setAuthSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('labWorkspace_authSettings');
      return saved ? JSON.parse(saved) : { requireLoginOnEntry: true, hideOtherScientistTests: false };
    } catch { return { requireLoginOnEntry: true, hideOtherScientistTests: false }; }
  });
  const [unlockedTestIds, setUnlockedTestIds] = useState(new Set());
  const [recoveryBypass, setRecoveryBypass] = useState(false); // transient — not persisted
  // ────────────────────────────────────────────────────────

  const [customFields, setCustomFields] = useState([]);
  const [molecules, setMolecules] = useState([]);
  const [solvents, setSolvents] = useState([]);

  const [buffers, setBuffers] = useState([]);
  const [additives, setAdditives] = useState([]);
  const [nmrInstruments, setNmrInstruments] = useState([]);
  const [nmrProbes, setNmrProbes] = useState([]);
  const [nmrExperiments, setNmrExperiments] = useState([]);
  const [compoundMeta, setCompoundMeta] = useState({});
  const [calculationEntries, setCalculationEntries] = useState({});
  const [cellLineMeta, setCellLineMeta] = useState({});
  const [plasmidMeta, setPlasmidMeta] = useState({});
  const [activeLibrarySelection, setActiveLibrarySelection] = useState({ type: null, id: null });
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [storages, setStorages] = useState([]);
  const [activeStorageId, setActiveStorageId] = useState(null);
  const [storageModal, setStorageModal] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
 const [testCategories, setTestCategories] = useState(PRIMARY_CATEGORIES);
  const [protocolCategories, setProtocolCategories] = useState([
    'Preparation',
    'Measurement',
    'Analysis'
  ]);
  const [datasetProtocols, setDatasetProtocols] = useState([]);
  const [protoImgInput, setProtoImgInput] = useState(''); // for inline image URL entry

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

  // ── PERSIST OPERATORS & AUTH SETTINGS ─────────────────────────────────
  // Always keep localStorage in sync (works offline / as cache)
  useEffect(() => {
    try { localStorage.setItem('labWorkspace_operators', JSON.stringify(operators)); } catch {}
  }, [operators]);

  useEffect(() => {
    try { localStorage.setItem('labWorkspace_authSettings', JSON.stringify(authSettings)); } catch {}
  }, [authSettings]);

  // Sync operators + authSettings TO Firestore whenever they change (cloud persistence)
  const appConfigSaveRef = useRef(null);
  useEffect(() => {
    if (!db || !user) return; // only sync when logged into Firebase
    if (appConfigSaveRef.current) clearTimeout(appConfigSaveRef.current);
    appConfigSaveRef.current = setTimeout(async () => {
      try {
        await db.collection(`artifacts/${appId}/public/data/appConfig`).doc('global').set({
          operators: JSON.stringify(operators),
          authSettings: JSON.stringify(authSettings),
          updatedAt: window.firebase ? window.firebase.firestore.FieldValue.serverTimestamp() : Date.now()
        }, { merge: true });
      } catch (e) { console.warn('Could not sync app config to Firestore:', e.message); }
    }, 1500);
    return () => { if (appConfigSaveRef.current) clearTimeout(appConfigSaveRef.current); };
  }, [operators, authSettings, user, db]);
  // ─────────────────────────────────────────────────────────────────────

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

// ── LOAD operators + authSettings FROM Firestore on login ─────────────
  useEffect(() => {
    if (!db || !user) return;
    const unsubscribe = db
      .collection(`artifacts/${appId}/public/data/appConfig`)
      .doc('global')
      .onSnapshot(
        (doc) => {
          if (!doc.exists) return;
          const data = doc.data();
          
          // Fix infinite loop: only update state if cloud data differs from current local string
          try {
            if (data.operators) {
              const currentLocal = localStorage.getItem('labWorkspace_operators');
              if (currentLocal !== data.operators) {
                const parsed = JSON.parse(data.operators);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  setOperators(parsed);
                  localStorage.setItem('labWorkspace_operators', data.operators);
                }
              }
            }
          } catch {}

          try {
            if (data.authSettings) {
              const currentLocal = localStorage.getItem('labWorkspace_authSettings');
              if (currentLocal !== data.authSettings) {
                const parsed = JSON.parse(data.authSettings);
                if (parsed && typeof parsed === 'object') {
                  setAuthSettings(parsed);
                  localStorage.setItem('labWorkspace_authSettings', data.authSettings);
                }
              }
            }
          } catch {}
        },
        (err) => console.warn('AppConfig Firestore listener error:', err.message)
      );
    return () => unsubscribe();
  }, [user, db]);
  // ──────────────────────────────────────────────────────────────────────


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

  // ── Derived string array for backward-compatible child components ──
  // All child components (test renderers, LabNotebook, Storage, etc.) still
  // expect operators as plain strings. This is the safe list to pass them.
  const operatorNames = normalizeOperators(operators).map((op) => op.name);

  // Bootstrap mode: if no superuser exists yet, allow anyone to define roles
  const hasSuperuserDefined = normalizeOperators(operators).some((op) => op.role === 'superuser');

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
    calculationEntries,
    cellLineMeta,
    plasmidMeta,
    solvents,
    buffers,
    additives,
    nmrInstruments,
    nmrProbes,
    nmrExperiments,
    mandatoryFields,
    mandatoryRules,
    mandatoryBehavior,
    authSettings
  };

  const getCompressedPayload = () =>
    LZString.compressToUTF16(JSON.stringify(latestDataRef.current));

  // ── Sync currentUser to sessionStorage ──────────────────
  useEffect(() => {
    try {
      if (currentUser) {
        sessionStorage.setItem('labCurrentUser', JSON.stringify(currentUser));
      } else {
        sessionStorage.removeItem('labCurrentUser');
      }
    } catch {}
  }, [currentUser]);

  // ── Validate currentUser still exists in operators list ─
  useEffect(() => {
    if (!currentUser) return;
    const normalized = normalizeOperators(operators);
    const stillExists = normalized.some((op) => op.id === currentUser.id);
    if (!stillExists) {
      setCurrentUser(null);
    }
  }, [operators, currentUser]);

const saveTimeoutRef = useRef(null);
useEffect(() => {
  if (!isCloudReady || appView !== 'dataset' || !currentDatasetId) return;
  setSaveStatus('saving');
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(async () => {
    try {
      const rawData = latestDataRef.current;
      // Compress payload to prevent Firestore 1MB limit and write stream exhaustion
      const compressedPayload = LZString.compressToUTF16(JSON.stringify(rawData));

      const updatedPayload = {
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        date: rawData.tests?.[0]?.date || new Date().toISOString().split('T')[0],
        testCount: rawData.tests?.length || 0,
        updatedAt: window.firebase
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : Date.now(),
        payload: compressedPayload,
        isCompressed: true
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
            console.error('Firestore save error:', err);
          });
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
        setSaveStatus('saved');
      }
    } catch (e) {
      setSaveStatus('error');
      setSaveErrorMsg(e.message);
      console.error('Save error:', e);
    }
  }, 1500);
  return () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
  };
}, [
  tests, datasetTitle, datasetSubtitle, customCmpds, customCellLines,
  customConc, cmpColors, testCategories, protocolCategories, datasetProtocols,
  customFields, operators, molecules, compoundMeta, calculationEntries,
  cellLineMeta, plasmidMeta, storages, solvents, buffers, additives,
  nmrInstruments, nmrProbes, nmrExperiments, isCloudReady, appView,
  currentDatasetId, user, authSettings
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
      // NOTE: operators and authSettings are NEVER imported from HTML
      // They are global app-level identity/security state — not dataset state.
      // if (s.operators !== undefined) setOperators(...);
      if (s.molecules !== undefined) setMolecules(s.molecules);
      if (s.compoundMeta !== undefined) setCompoundMeta(s.compoundMeta);
      if (s.calculationEntries !== undefined) setCalculationEntries(s.calculationEntries);
      if (s.cellLineMeta !== undefined) setCellLineMeta(s.cellLineMeta);
      if (s.plasmidMeta !== undefined) setPlasmidMeta(s.plasmidMeta);
      if (s.mandatoryFields !== undefined) setMandatoryFields(s.mandatoryFields);
      if (s.mandatoryRules !== undefined || s.mandatoryFields !== undefined) {
        setMandatoryRules(normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields));
      }
      if (s.mandatoryBehavior !== undefined) setMandatoryBehavior(s.mandatoryBehavior);
      // NOTE: authSettings not imported from HTML either — kept as global security config
      // if (s.authSettings !== undefined) setAuthSettings(...);
      if (s.solvents !== undefined) setSolvents(s.solvents);
      if (s.buffers !== undefined) setBuffers(s.buffers);
      if (s.additives !== undefined) setAdditives(s.additives);
      if (s.nmrInstruments !== undefined) setNmrInstruments(s.nmrInstruments);
      if (s.nmrProbes !== undefined) setNmrProbes(s.nmrProbes);
      if (s.nmrExperiments !== undefined) setNmrExperiments(s.nmrExperiments);

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

      if (s.compoundMeta !== undefined) setCompoundMeta((prev) => ({ ...prev, ...s.compoundMeta }));
      if (s.cellLineMeta !== undefined) setCellLineMeta((prev) => ({ ...prev, ...s.cellLineMeta }));
      if (s.plasmidMeta !== undefined) setPlasmidMeta((prev) => ({ ...prev, ...s.plasmidMeta }));
if (s.mandatoryFields !== undefined) setMandatoryFields((prev) => [...new Set([...prev, ...s.mandatoryFields])]);
      if (s.mandatoryRules !== undefined || s.mandatoryFields !== undefined) {
        setMandatoryRules((prev) => {
          const incoming = normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields);
          const existingKeys = new Set(
            prev.map((r) => `${r.page}|${r.subsection}|${r.fieldName.toLowerCase()}`)
          );
          const additions = incoming.filter(
            (r) => !existingKeys.has(`${r.page}|${r.subsection}|${r.fieldName.toLowerCase()}`)
          );
          return [...prev, ...additions];
        });
      }
      if (s.mandatoryBehavior !== undefined) {
        setMandatoryBehavior((prev) => ({ ...prev, ...s.mandatoryBehavior }));
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

      // NOTE: operators NOT imported in append mode — they are global, not per-dataset

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
    setMolecules([]);

    setCellLineMeta({});
    setPlasmidMeta({});
    setMandatoryFields([]);
    setSolvents([]);
    setBuffers([]);
    setAdditives([]);
    setNmrInstruments([]);
    setNmrProbes([]);
    setNmrExperiments([]);

     setTestCategories(PRIMARY_CATEGORIES);

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
      const rawData = latestDataRef.current;
      const compressedPayload = LZString.compressToUTF16(JSON.stringify(rawData));
      
      const updatedPayload = {
        title: datasetTitle || 'Untitled Dataset',
        subtitle: datasetSubtitle || '',
        date: rawData.tests?.[0]?.date || new Date().toISOString().split('T')[0],
        testCount: rawData.tests?.length || 0,
        updatedAt: window.firebase
          ? window.firebase.firestore.FieldValue.serverTimestamp()
          : Date.now(),
        payload: compressedPayload,
        isCompressed: true
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
    } catch (e) {
      console.error('Back to explorer save error:', e);
    }
  }
  window.history.pushState({}, '', window.location.pathname);
  setAppView('explorer');
};

const openDataset = (dset) => {
  let s = null;
  try {
    // Defensively handle compressed payloads in case parsePayload doesn't already
    if (dset.isCompressed && typeof dset.payload === 'string') {
      const decompressed = LZString.decompressFromUTF16(dset.payload);
      s = decompressed ? JSON.parse(decompressed) : null;
    } else {
      s = parsePayload(dset);
    }
  } catch (e) {
    console.error('Dataset parse error:', e);
    s = null;
  }

  if (!s) {
    setDialog({
      type: 'alert',
      title: 'Error',
      message: 'Error reading dataset structure. The payload may be corrupted or too large.'
    });
    return;
  }

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
      // NOTE: operators NOT loaded from cloud dataset — they are global identity state
      setMolecules(Array.isArray(s.molecules) ? s.molecules : []);
      setCellLineMeta(s.cellLineMeta || {});
      setPlasmidMeta(s.plasmidMeta || {});
      setMandatoryFields(s.mandatoryFields || []);
      setMandatoryRules(normalizeMandatoryRules(s.mandatoryRules, s.mandatoryFields));
      setMandatoryBehavior(s.mandatoryBehavior || {});
      setSolvents(s.solvents || []);
      setBuffers(s.buffers || []);
      setAdditives(s.additives || []);
      setNmrInstruments(s.nmrInstruments || []);
      setNmrProbes(s.nmrProbes || []);
      setNmrExperiments(s.nmrExperiments || []);
      
   setTestCategories(s.testCategories || PRIMARY_CATEGORIES);

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
  const [agendaOpFilter, setAgendaOpFilter] = useState('ALL');

  const mergedPlan = useMemo(() => {
    const all = [];

    tests.forEach((t) => {
      (t.plan || []).forEach((task) => {
        all.push({
          ...task,
          testName: t.name,
          testId: t.id,
          testOperator: t.operator || '',
          testCoScientists: Array.isArray(t.coScientists) ? t.coScientists : [],
        });
      });
    });

    let sorted = all.sort((a, b) => a.date.localeCompare(b.date));

    if (calFilterDate) sorted = sorted.filter((t) => t.date === calFilterDate);

    // Normal users are locked to their own agenda; superusers use the dropdown
    const effectiveFilter = currentUser?.role !== 'superuser' && currentUser
      ? currentUser.name
      : agendaOpFilter;

    if (effectiveFilter !== 'ALL') sorted = sorted.filter((t) => {
      // Check direct assignment, test primary operator AND co-scientists
      const assignedTo = t.assignedTo || t.testOperator || '';
      const coScis = Array.isArray(t.testCoScientists) ? t.testCoScientists : [];
      return assignedTo === effectiveFilter || coScis.includes(effectiveFilter);
    });

    return sorted;
  }, [tests, calFilterDate, agendaOpFilter, currentUser]);

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

  const handlePrint = async () => {
    // Wait for all visible images to finish loading before printing
    // This is the correct approach for public Drive/external images already in the browser
    const imgs = Array.from(document.querySelectorAll('img'));
    await Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000); // max 5s timeout per image
      });
    }));
    await new Promise((r) => setTimeout(r, 150));
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
    <React.Fragment>

    {/* ══════════════════════════════════════════════════════
         FULL-SCREEN LOGIN GATE
         Blocks everything when requireLoginOnEntry is on.
    ══════════════════════════════════════════════════════ */}
    {authSettings.requireLoginOnEntry && !currentUser && !recoveryBypass && (
      <ScientistLoginGate
        operators={normalizeOperators(operators)}
        onLogin={(user) => {
          setCurrentUser(user);
          try { sessionStorage.setItem('labCurrentUser', JSON.stringify(user)); } catch {}
        }}
        onRecovery={() => {
          // Transient bypass — does NOT touch requireLoginOnEntry in localStorage
          // On next page load, the gate will show again normally
          setRecoveryBypass(true);
        }}
      />
    )}

    {/* Main app — hidden (but preserved) while gate is shown */}
    <div className={`w-full relative flex flex-col h-screen overflow-hidden bg-slate-50${
      authSettings.requireLoginOnEntry && !currentUser && !recoveryBypass ? ' hidden' : ''
    }`}>
<style>{`
        @media print {
          @page {
            margin: 1.5cm 1.2cm;
            size: A4 portrait;
          }

          .no-print,
          nav,
          button,
          input[type="file"],
          aside,
          [class*="sidebar"] {
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

          /* Charts and canvases: prevent cutting in half */
          .recharts-wrapper,
          .recharts-surface,
          canvas,
          svg {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            max-width: 100% !important;
          }

          /* NMR sidebar controls hidden when printing */
          .no-print {
            display: none !important;
          }
        }

        /* ── Notebook-only print mode ─────────────────────────────────
           Applied by exportPDF() in LabNotebook to print only the
           notebook report, hiding all sidebar and navigation chrome.
           Uses display:none (not visibility:hidden) so Recharts SVGs render correctly. */
        @media print {
          body.notebook-print-mode > * > * {
            display: none !important;
          }
          body.notebook-print-mode #notebook-report-container {
            display: block !important;
            position: static !important;
            width: 100% !important;
            padding: 0 !important;
            background: white !important;
          }
          body.notebook-print-mode #notebook-report-container * {
            display: revert !important;
          }
        }
        /* Screen preview: isolate just the container */
        body.notebook-print-mode > * > *:not(:has(#notebook-report-container)) {
          visibility: hidden;
        }
        body.notebook-print-mode #notebook-report-container {
          position: fixed;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          padding: 1cm;
          background: white;
          z-index: 99999;
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
        operators={operatorNames}
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

              {currentUser?.role === 'superuser' ? (
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
              ) : (
                <div className="flex items-center gap-2 text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-5 py-3 text-sm font-semibold">
                  ?? Creating datasets requires superuser access
                </div>
              )}

              {!isCloudReady && (
                <div className="mt-6 flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                  <p className="text-sm font-bold text-slate-500">Connecting to Cloud...</p>
                </div>
              )}

              {/* ── USER IDENTITY BAR on landing page ── */}
              {operatorNames.length > 0 && (
                <div className="mt-6 flex items-center gap-3">
                  {currentUser ? (
                    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-full px-4 py-2 shadow-sm">
                      <span className="text-base">
                        {currentUser.role === 'superuser' ? '👑' : '🧪'}
                      </span>
                      <div className="flex flex-col leading-tight">
                        <span className="text-sm font-bold text-slate-800">{currentUser.name}</span>
                        <span className={`text-[10px] font-black uppercase ${
                          currentUser.role === 'superuser' ? 'text-amber-600' : 'text-slate-500'
                        }`}>
                          {currentUser.role === 'superuser' ? 'Superuser' : 'Scientist'}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setCurrentUser(null);
                          try { sessionStorage.removeItem('labCurrentUser'); } catch {}
                        }}
                        className="ml-2 text-xs text-slate-400 hover:text-red-500 font-bold transition-colors px-2 py-1 rounded hover:bg-red-50"
                        title="Log out"
                      >
                        Sign out
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setLoginModal({})}
                      className="flex items-center gap-2 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-bold px-5 py-2.5 rounded-full shadow-sm transition-all hover:shadow-md text-sm"
                    >
                      🔑 Sign In as Scientist
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Recent Datasets — hidden from unauthenticated users when scientists are configured */}
            {operatorNames.length > 0 && !currentUser ? (
              <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 flex flex-col items-center justify-center gap-4 py-16">
                <div className="text-5xl">🔒</div>
                <h2 className="text-xl font-bold text-slate-700">Login required to view datasets</h2>
                <p className="text-slate-400 text-sm text-center max-w-sm">
                  Please log in using the button above to access your lab data.
                </p>
              </div>
            ) : (
            <div className="bg-white p-4 md:p-8 rounded-2xl shadow-xl border border-slate-200">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-100 pb-4 gap-4">
                <h2 className="text-xl md:text-2xl font-bold text-slate-800">
                  Your Recent Datasets
                </h2>

                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  {/* Delete Empty — superuser only */}
                  {currentUser?.role === 'superuser' && (
                    <button
                      onClick={deleteEmptyDatasets}
                      className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none items-center justify-center gap-2 cursor-pointer text-sm"
                    >
                      🗑️ Delete Empty
                    </button>
                  )}

                  {/* Load HTML — superuser only */}
                  {currentUser?.role === 'superuser' && (
                    <label className="bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold py-2 px-4 rounded-lg shadow-sm transition-colors flex-1 md:flex-none flex items-center justify-center gap-2 cursor-pointer text-sm">
                      📂 Load HTML File
                      <input type="file" accept=".html" onChange={loadHTML} className="hidden" />
                    </label>
                  )}
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

                                {/* Rename / Delete — superuser only */}
                                {currentUser?.role === 'superuser' && (
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
                                )}
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
            )} {/* end: login-required ternary */}
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
              {/* ── User identity bar ── */}
              {isSidebarOpen ? (
                <div className={`mb-3 rounded-xl border px-3 py-2.5 flex items-center gap-2 text-sm ${
                  currentUser?.role === 'superuser'
                    ? 'bg-amber-50 border-amber-200'
                    : currentUser
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <span className="text-base shrink-0">
                    {currentUser?.role === 'superuser' ? '👑' : currentUser ? '🧪' : '👤'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black uppercase text-slate-400">Logged in as</div>
                    <div className="font-bold text-slate-700 truncate text-xs">
                      {currentUser ? currentUser.name : <span className="text-slate-400 italic">Guest</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (currentUser) {
                        setCurrentUser(null);
                        setUnlockedTestIds(new Set());
                      } else {
                        setLoginModal({ isEntryGate: false });
                      }
                    }}
                    className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                      currentUser
                        ? 'bg-slate-200 hover:bg-red-100 text-slate-600 hover:text-red-700'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {currentUser ? 'Logout' : 'Login'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (currentUser) { setCurrentUser(null); setUnlockedTestIds(new Set()); }
                    else setLoginModal({ isEntryGate: false });
                  }}
                  title={currentUser ? `Logged in as ${currentUser.name} — click to logout` : 'Login'}
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center text-base mb-2 transition-colors ${
                    currentUser?.role === 'superuser' ? 'bg-amber-50 border-amber-200' :
                    currentUser ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200 hover:bg-blue-50'
                  }`}
                >
                  {currentUser?.role === 'superuser' ? '👑' : currentUser ? '🧪' : '🔐'}
                </button>
              )}

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
              <div className={`flex flex-col gap-2 w-full`}>
                <button
                  onClick={handlePrint}
                  className={`w-full text-center bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold py-1.5 rounded text-xs shadow-sm transition-colors flex items-center justify-center gap-1 ${
                    !isSidebarOpen ? 'py-2 px-0 text-[10px]' : ''
                  }`}
                  title="Print / Export PDF"
                >
                  <span>🖨️</span> {isSidebarOpen ? 'Print / Export PDF' : ''}
                </button>

                {/* Load HTML + Save HTML — superuser only */}
                {currentUser?.role === 'superuser' && (
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
                )}
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
                        desc: 'Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.'
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
                  
                  <CollapsibleSection title="Library Directory" subtitle="Click any item to view or edit its full details." defaultOpen={true}>
                    <LibraryDirectory 
                      compoundMeta={compoundMeta}
                      cellLineMeta={cellLineMeta}
                      plasmidMeta={plasmidMeta}
                      customCmpds={customCmpds}
                      customCellLines={customCellLines}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrProbes={nmrProbes}
                      nmrInstruments={nmrInstruments}
                      nmrExperiments={nmrExperiments}
                      onSelectResource={(id, type) => {
                        setActiveLibrarySelection({ id, type });
                        setTimeout(() => {
                          const el = document.getElementById(`section-${type}`);
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 150);
                      }}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-compound" title="Compound Sequence / Structure" subtitle="Define sequence, SMILES, modifications, MW." defaultOpen={activeLibrarySelection.type === 'compound'}>
                    <CompoundDefinitionSection
                      compoundOptions={allCmpds}
                      customCmpds={customCmpds}
                      setCustomCmpds={setCustomCmpds}
                      compoundMeta={compoundMeta}
                      setCompoundMeta={setCompoundMeta}
                      selectedId={activeLibrarySelection.type === 'compound' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'compound' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-cellLine" title="Cell Line Definitions" subtitle="Define organism, tissue, and culture medium." defaultOpen={activeLibrarySelection.type === 'cellLine'}>
                    <CellLineDefinitionSection
                      cellLineOptions={allCellLines}
                      customCellLines={customCellLines}
                      setCustomCellLines={setCustomCellLines}
                      cellLineMeta={cellLineMeta}
                      setCellLineMeta={setCellLineMeta}
                      selectedId={activeLibrarySelection.type === 'cellLine' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'cellLine' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-plasmid" title="Plasmid Definitions" subtitle="Define backbone, promoters, resistance, and sequences." defaultOpen={activeLibrarySelection.type === 'plasmid'}>
                    <PlasmidDefinitionSection
                      plasmidMeta={plasmidMeta}
                      setPlasmidMeta={setPlasmidMeta}
                      selectedId={activeLibrarySelection.type === 'plasmid' ? activeLibrarySelection.id : null}
                      onSelect={(id) => setActiveLibrarySelection({ id, type: 'plasmid' })}
                    />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-solvent" title="Solvents & Media" subtitle="Define solvents that appear in dropdowns across all pages." defaultOpen={activeLibrarySelection.type === 'solvent'}>
                    <SolventsManager solvents={solvents} setSolvents={setSolvents} selectedId={activeLibrarySelection.type === 'solvent' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'solvent', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-buffer" title="Buffers" subtitle="Define buffers with optional description (e.g. PBS pH 7.4)." defaultOpen={activeLibrarySelection.type === 'buffer'}>
                    <BuffersManager buffers={buffers} setBuffers={setBuffers} selectedId={activeLibrarySelection.type === 'buffer' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'buffer', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-additive" title="Additives" subtitle="Define additives (NaN3, DTT, EDTA...) for Experimental Conditions." defaultOpen={activeLibrarySelection.type === 'additive'}>
                    <AdditivesManager additives={additives} setAdditives={setAdditives} selectedId={activeLibrarySelection.type === 'additive' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'additive', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrProbe" title="NMR Probes" subtitle="Define probe name, type, subtype, field, diameter, cryo, and sample state." defaultOpen={activeLibrarySelection.type === 'nmrProbe'}>
                    <NMRProbesManager nmrProbes={nmrProbes} setNmrProbes={setNmrProbes} selectedId={activeLibrarySelection.type === 'nmrProbe' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrProbe', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrInstrument" title="NMR Instruments" subtitle="Define spectrometers with frequency and available probes." defaultOpen={activeLibrarySelection.type === 'nmrInstrument'}>
                    <NMRInstrumentsManager nmrInstruments={nmrInstruments} setNmrInstruments={setNmrInstruments} nmrProbes={nmrProbes} selectedId={activeLibrarySelection.type === 'nmrInstrument' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrInstrument', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection id="section-nmrExperiment" title="NMR Experiments / Pulse Programs" subtitle="Define pulse programs: nuclei, dimensions, and custom acquisition parameters." defaultOpen={activeLibrarySelection.type === 'nmrExperiment'}>
                    <NMRExperimentsManager nmrExperiments={nmrExperiments} setNmrExperiments={setNmrExperiments} selectedId={activeLibrarySelection.type === 'nmrExperiment' ? activeLibrarySelection.id : null} onSelect={(id) => setActiveLibrarySelection({ type: 'nmrExperiment', id })} />
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Scientists / Operators"
                    subtitle={currentUser?.role === 'superuser'
                      ? "Manage scientists, roles, passwords, and access control settings."
                      : "Scientists defined in this dataset. Log in or contact a superuser to manage."}
                    defaultOpen={false}
                  >
                    <ScientistsOperatorsManager
                      operators={normalizeOperators(operators)}
                      setOperators={setOperators}
                      authSettings={authSettings}
                      setAuthSettings={setAuthSettings}
                      currentUser={currentUser}
                    />
                  </CollapsibleSection>


  <CollapsibleSection title="Custom Metadata Fields" subtitle="Add custom fields for plate, NMR, CD, Cloning, or all tabs — and target the exact subsection of each page they appear in." defaultOpen={false}>
                    <CustomMetadataFieldsManager customFields={customFields} setCustomFields={handleSetCustomFields} />

                    <div className="mt-6 pt-6 border-t border-slate-200">
                      <MandatoryParametersManager
                        mandatoryRules={mandatoryRules}
                        setMandatoryRules={setMandatoryRules}
                        mandatoryBehavior={mandatoryBehavior}
                        setMandatoryBehavior={setMandatoryBehavior}
                      />
                    </div>
                  </CollapsibleSection>

<CollapsibleSection title="Database Cleanup & Merging" subtitle="Fix misclassifications, rename items globally, and merge duplicates across all tests and multiwell plates." defaultOpen={false}>
                     <DatabaseCleanupManager 
                        tests={tests}
                        setTests={setTests}
                        allCmpds={allCmpds}
                        allCellLines={allCellLines}
                        setCustomCmpds={setCustomCmpds}
                        setCompoundMeta={setCompoundMeta}
                        compoundMeta={compoundMeta}
                        setCustomCellLines={setCustomCellLines}
                        setCellLineMeta={setCellLineMeta}
                        cellLineMeta={cellLineMeta}
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

                  <div className="flex flex-wrap gap-2 items-center">
<div className="flex flex-col gap-1">
  <label className="text-[10px] font-bold text-slate-500 uppercase">Filter by Scientist</label>
  {currentUser?.role === 'superuser' ? (
    <select value={agendaOpFilter} onChange={(e) => setAgendaOpFilter(e.target.value)}
      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-blue-500 font-semibold shadow-sm">
      <option value="ALL">All Users</option>
      {(operatorNames || []).map((op) => (<option key={`agenda-${op}`} value={op}>{op}</option>))}
    </select>
  ) : (
    <div className="text-sm font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
      🧪 {currentUser?.name || 'You'}
    </div>
  )}
</div>
                    <button
                      onClick={handlePrint}
                      className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2 shadow-sm no-print self-end"
                    >
                      🖨️ Print / Save PDF
                    </button>
                  </div>
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
                                  {t.assignedTo && (
                                    <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">{t.assignedTo}</span>
                                  )}
                                  {!t.assignedTo && t.testOperator && (
                                    <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full whitespace-nowrap">{t.testOperator}</span>
                                  )}
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
  <div className="h-full min-h-0 flex flex-col overflow-hidden bg-slate-50">
    <StorageFinder
      tests={tests}
      storages={storages}
      operators={operatorNames}
      onOpenTest={(testId) => {
        setActiveTestId(testId);
        setCurrentModule('active-test');
      }}
      onOpenStorage={(storageId) => {
        if (!storageId) return;
        setActiveStorageId(storageId);
        setCurrentModule('storage-detail');
      }}
    />

    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      <StorageList
        storages={storages}
        tests={tests}
        setStorageModal={setStorageModal}
        setActiveStorageId={setActiveStorageId}
        setCurrentModule={setCurrentModule}
        handlePrint={handlePrint}
        operators={operatorNames}
      />
    </div>
  </div>
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
                operators={operatorNames}
              />
            )}

            {currentModule === 'tests' &&
              (() => {
                const testSearch = expandedGroups['testSearch'] || '';
                const testCatFilter = expandedGroups['testCatFilter'] || 'ALL';
                const showCatMgr = expandedGroups['showTestCatMgr'] || false;
                const newCatInput = expandedGroups['newTestCatInput'] || '';


                // ── Auth helpers ──────────────────────────────
                const isSuperuserSession = currentUser?.role === 'superuser';
                // Get all scientists assigned to a test
                const getTestScientists = (test) => {
                  const all = [];
                  if (test.operator) all.push(test.operator);
                  if (Array.isArray(test.coScientists)) all.push(...test.coScientists);
                  return all;
                };
                const isTestOwner = (test) => {
                  const scientists = getTestScientists(test);
                  if (isSuperuserSession) return true;
                  if (scientists.length === 0) return false; // unassigned → only superuser
                  return currentUser && scientists.includes(currentUser.name);
                };
                const isTestLocked = (test) => !isTestOwner(test) && !unlockedTestIds.has(test.id);
                // ─────────────────────────────────────────────

                const filteredTestsRaw = tests.filter((t) => {
                  if (t.type === 'plate-9x9box') return false;

                  // Normal users always see only their own tests.
                  // Superusers see all tests unless hideOtherScientistTests is enabled.
                  if (!isSuperuserSession) {
                    if (!isTestOwner(t)) return false;
                  } else if (authSettings.hideOtherScientistTests && !isTestOwner(t)) {
                    return false;
                  }

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
                          Manage experimental plates, spectroscopic data, cloning, protein purification, and MD simulations.
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
    + Expression & Purification
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
    + Multiwell Plate tests
  </button>
  <button
onClick={() => {
const id = 't' + Date.now();
setTests((prev) => [
...prev,
createEmptyTest(id, prev.length + 1, 'flow_cytometry')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-pink-600 hover:bg-pink-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ Flow Cytometry
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
createEmptyTest(id, prev.length + 1, 'ssnmr')
]);
setActiveTestId(id);
setCurrentModule('active-test');
}}
className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
>
+ ssNMR
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
        createEmptyTest(id, prev.length + 1, 'md_simulation')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + MD Simulations
  </button>
  <button
    onClick={() => {
      const id = 't' + Date.now();
      setTests((prev) => [
        ...prev,
        createEmptyTest(id, prev.length + 1, 'docking')
      ]);
      setActiveTestId(id);
      setCurrentModule('active-test');
    }}
    className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 px-4 rounded shadow-sm text-sm transition-colors flex-1 md:flex-none"
  >
    + Docking
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
                          {filteredTests.map((test) => {
                            const locked = isTestLocked(test);
                            return (
                            <div
                              key={test.id}
                              className={`bg-white border rounded-xl p-4 shadow-sm transition-all flex flex-col group relative overflow-hidden ${
                                locked
                                  ? 'border-slate-300 cursor-pointer hover:border-amber-400 hover:shadow-md'
                                  : 'border-slate-200 cursor-pointer hover:shadow-md hover:border-blue-400'
                              }`}
                              onClick={() => {
                                if (locked) {
                                  // prompt authentication for this scientist
                                  setLoginModal({
                                    isEntryGate: false,
                                    targetScientistName: test.operator,
                                    onSuccess: (user) => {
                                      setCurrentUser(user);
                                      setLoginModal(null);
                                      // Navigate into the test after login
                                      setActiveTestId(test.id);
                                      setCurrentModule('active-test');
                                    }
                                  });
                                } else {
                                  setActiveTestId(test.id);
                                  setCurrentModule('active-test');
                                }
                              }}
                            >
                              {/* Delete button (only if owner/superuser) */}
                              {!locked && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Eliminare definitivamente il test "${test.name}"?`)) {
                                      setTests((prev) => prev.filter((t) => t.id !== test.id));
                                    }
                                  }}
                                  className="absolute top-3 right-10 text-slate-300 hover:text-red-500 text-xl opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity no-print z-10"
                                  title="Elimina Test"
                                >
                                  &times;
                                </button>
                              )}

<div className="absolute top-3 right-3 text-2xl opacity-80 group-hover:scale-110 transition-transform">
{test.type === 'nmr' ? '📉'
: test.type === 'cd' ? '🌀'
: test.type === 'ssnmr' ? '🧲'
: test.type === 'cloning' ? '🧬'
: test.type === 'plate-9x9box' ? '📦'
: test.type === 'nmr-fittings' ? '🧭'
: test.type === 'md_simulation' ? '🖥️'
: test.type === 'docking' ? '🎯'
: test.type === 'flow_cytometry' ? '🩸'
: '🧫'}
</div>

                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded self-start mb-2 border border-blue-100">
                                {test.testCategory || 'Uncategorized'}
                              </span>

                              <h3 className="font-bold text-slate-800 text-lg truncate pr-8">
                                {test.name} {test.bestMeasurement && '⭐'}
                              </h3>

                              <p className="text-xs text-slate-500 mt-1">
                                Instance: {test.instanceName || 'Primary'}
                              </p>

                              {test.operator && (
                                <p className="text-xs text-slate-400 mt-0.5">
                                  🧪 {[test.operator, ...(test.coScientists || [])].join(', ')}
                                </p>
                              )}

                              <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 font-medium">
                                <span>📅 {test.date}</span>
<span className="bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-600">
{test.type === 'nmr-fittings' ? 'NMR FITTINGS'
: test.type === 'md_simulation' ? 'MD'
: test.type === 'protein_expression' ? 'PROTEIN'
: test.type === 'ssnmr' ? 'SSNMR'
: test.type === 'docking' ? 'DOCKING'
: test.type === 'flow_cytometry' ? 'FLOW'
: String(test.type || '').replace('plate-', '').toUpperCase()}
</span>
                              </div>

                              {/* 🔒 Lock overlay */}
                              {locked && (
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 rounded-xl">
                                  <div className="text-3xl">🔒</div>
                                  <div className="text-xs font-bold text-slate-600 text-center px-4">
                                    {[test.operator, ...(test.coScientists || [])].filter(Boolean).join(' / ')}'s test
                                  </div>
                                  <div className="text-[10px] text-slate-400 text-center px-4">
                                    Log in as one of the assigned scientists to access
                                  </div>
                                </div>
                              )}
                            </div>
                            );
                          })}

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

const extractGoogleDriveId = (url) => {
  try {
    const u = String(url || '');

    const fileMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];

    const idMatch = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];

    const openMatch = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (openMatch) return openMatch[1];
  } catch (e) {}

  return '';
};

const getProtocolImagePreview = (url) => {
  if (!url) return '';

  const u = String(url);

  if (u.includes('drive.google.com')) {
    const id = extractGoogleDriveId(u);

    if (id) {
      return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
    }
  }

  return getDirectImageUrl(u);
};

const getProtocolImageFallback = (url) => {
  const direct = getProtocolImagePreview(url);

  if (!direct) return '';

  if (String(direct).includes('drive.google.com')) {
    return `https://wsrv.nl/?url=${encodeURIComponent(direct)}`;
  }

  return direct;
};

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

  <div className="mt-6 border border-slate-200 rounded-xl bg-slate-50 p-4 shadow-sm">
    <div className="flex flex-col gap-3 mb-3">
      <div>
        <h4 className="text-xs font-bold text-slate-500 uppercase">
          Protocol Images
        </h4>
        <p className="text-xs text-slate-400">
          Paste Google Drive image links. Previews appear immediately.
        </p>
      </div>

      {/* Inline URL input — no prompt() required */}
      <div className="flex gap-2 items-center no-print">
        <input
          type="text"
          value={protoImgInput}
          onChange={(e) => setProtoImgInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
              if (!urls.length) return;
              const existingCount = (activeProtocol.images || []).length;
              const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
              setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
              setProtoImgInput('');
            }
          }}
          placeholder="Paste Google Drive URL(s), comma-separated… then press Enter or Add"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 bg-white"
        />
        <button
          type="button"
          onClick={() => {
            const urls = protoImgInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
            if (!urls.length) return;
            const existingCount = (activeProtocol.images || []).length;
            const newImgs = urls.map((url, idx) => ({ id: `proto_img_${Date.now()}_${idx}`, name: `Image ${existingCount + idx + 1}`, url }));
            setDatasetProtocols(datasetProtocols.map(p => p.id === activeProtocol.id ? { ...p, images: [...(p.images || []), ...newImgs] } : p));
            setProtoImgInput('');
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-xs shadow-sm transition-colors whitespace-nowrap"
        >
          + Add
        </button>
      </div>
    </div>

    {(activeProtocol.images || []).length === 0 ? (
      <div className="text-sm text-slate-400 italic bg-white border border-dashed border-slate-300 rounded-lg p-4">
        No images added yet. Use “+ Add Image Link(s)” and paste Google Drive
        image URLs.
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(activeProtocol.images || []).map((img) => (
          <div
            key={img.id}
            className="bg-white border border-slate-200 rounded-lg p-2 shadow-sm flex flex-col gap-2"
          >
            <div className="h-28 rounded-md overflow-hidden border border-slate-100 bg-slate-100">
              <img
                src={getProtocolImagePreview(img.url)}
                alt={img.name || 'Protocol image'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  if (!e.currentTarget.dataset.fallback) {
                    e.currentTarget.dataset.fallback = '1';
                    e.currentTarget.src = getProtocolImageFallback(img.url);
                  }
                }}
              />
            </div>

            <input
              type="text"
              value={img.name || ''}
              onChange={(e) =>
                setDatasetProtocols(
                  datasetProtocols.map((p) =>
                    p.id === activeProtocol.id
                      ? {
                          ...p,
                          images: (p.images || []).map((im) =>
                            im.id === img.id
                              ? { ...im, name: e.target.value }
                              : im
                          )
                        }
                      : p
                  )
                )
              }
              className="border border-slate-200 rounded-md px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
              placeholder="Image name"
            />

            <div className="flex gap-2">
              <a
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Open
              </a>

              <button
                type="button"
                onClick={() =>
                  setDatasetProtocols(
                    datasetProtocols.map((p) =>
                      p.id === activeProtocol.id
                        ? {
                            ...p,
                            images: (p.images || []).filter(
                              (im) => im.id !== img.id
                            )
                          }
                        : p
                    )
                  )
                }
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-1 px-2 rounded text-xs transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

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
{(() => {
  const pulsePrograms = (Array.isArray(nmrExperiments) ? nmrExperiments : [])
    .map((exp) => (typeof exp === 'string' ? { name: exp } : exp))
    .filter((exp) => exp && exp.name)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const linkedPulseName = activeProtocol.linkedPulseProgramName || '';
  const linkedPulse = pulsePrograms.find((exp) => exp.name === linkedPulseName) || null;

  const normalizeProtocolPulseLinkUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return '#';
    if (/^(https?:|mailto:|file:)/i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    return `https://${raw}`;
  };

  const openLinkedPulseInDefinitions = () => {
    if (!linkedPulseName) return;

    setActiveLibrarySelection({ type: 'nmrExperiment', id: linkedPulseName });
    setCurrentModule('definitions');

    setTimeout(() => {
      const el = document.getElementById('section-nmrExperiment');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 180);
  };

  return (
    <div className="w-full lg:w-80 flex flex-col gap-4 lg:overflow-y-auto custom-scrollbar shrink-0 lg:border-l border-t lg:border-t-0 border-slate-100 pt-4 lg:pt-0 lg:pl-4 no-print">
      <label className="text-xs font-bold text-slate-500 uppercase">
        Attached Resources
      </label>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-col gap-2">
        <label className="text-[10px] font-bold text-blue-700 uppercase">
          Pulse Sequence Link (Definitions & Labels)
        </label>

        <select
          value={linkedPulseName}
          onChange={(e) => {
            const value = e.target.value;

            setDatasetProtocols(
              datasetProtocols.map((p) =>
                p.id === activeProtocol.id
                  ? { ...p, linkedPulseProgramName: value }
                  : p
              )
            );

            setExpandedGroups((prev) => ({
              ...prev,
              protoPulseViewerOpen: false
            }));
          }}
          className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-500 font-semibold text-slate-700"
        >
          <option value="">— No pulse program linked —</option>
          {pulsePrograms.map((exp) => (
            <option key={exp.name} value={exp.name}>
              {exp.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openLinkedPulseInDefinitions}
            disabled={!linkedPulseName}
            className="bg-white border border-blue-300 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Open in Definitions
          </button>

          <button
            type="button"
            onClick={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: true
              }))
            }
            disabled={!linkedPulse || !String(linkedPulse.pulseSequence || '').trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
          >
            Preview Graphical
          </button>

          {linkedPulse && String(linkedPulse.pulseSequenceLink || '').trim() && (
            <a
              href={normalizeProtocolPulseLinkUrl(linkedPulse.pulseSequenceLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white border border-blue-300 hover:bg-blue-100 text-blue-700 font-bold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-colors"
            >
              Open Drive
            </a>
          )}
        </div>

        {!linkedPulse && (
          <p className="text-[11px] text-blue-700/80">
            Choose a pulse program defined under Definitions & Labels → NMR
            Experiments / Pulse Programs.
          </p>
        )}

        {linkedPulse && !String(linkedPulse.pulseSequence || '').trim() && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            This pulse program is linked, but it does not contain pulse-sequence
            text yet. Open it in Definitions & Labels and paste the Bruker
            pulse-program text.
          </p>
        )}
      </div>

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
                              l.id === link.id ? { ...l, name: newName } : l
                            )
                          }
                        : p
                    )
                  );
                }
              }}
            >
              <span className="text-lg">
                {link.url.match(/\.(jpeg|jpg|gif|png|svg)$/i) ? '🖼️' : '🔗'}
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

      {expandedGroups['protoPulseViewerOpen'] &&
        linkedPulse &&
        String(linkedPulse.pulseSequence || '').trim() && (
          <BrukerPulseSequenceViewer
            open={true}
            onClose={() =>
              setExpandedGroups((prev) => ({
                ...prev,
                protoPulseViewerOpen: false
              }))
            }
            name={linkedPulse.name}
            pulseSequence={linkedPulse.pulseSequence || ''}
            pulseSequenceLink={linkedPulse.pulseSequenceLink || ''}
          />
        )}
    </div>
  );
})()}
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
  links: [],
  images: []
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

    {proto.linkedPulseProgramName && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();

          setActiveLibrarySelection({
            type: 'nmrExperiment',
            id: proto.linkedPulseProgramName
          });

          setCurrentModule('definitions');

          setTimeout(() => {
            const el = document.getElementById('section-nmrExperiment');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 180);
        }}
        className="mt-3 self-start bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm transition-colors flex items-center gap-1"
      >
        🎛️ {proto.linkedPulseProgramName}
      </button>
    )}

    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
      <span className="flex items-center gap-1">
        🔗 {(proto.links || []).length} Links
      </span>
      <span className="flex items-center gap-1">
        📝 {proto.content ? 'Has Content' : 'Empty'}
      </span>
      {proto.linkedPulseProgramName && (
        <span className="flex items-center gap-1 text-blue-600">
          📡 Pulse Linked
        </span>
      )}
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

                // ── Auth gate ─────────────────────────────────────
                const isSuperuserSession = currentUser?.role === 'superuser';
                const activeTestOwned = !activeTest.operator || isSuperuserSession || (currentUser && currentUser.name === activeTest.operator) || unlockedTestIds.has(activeTest.id);
                if (!activeTestOwned) {
                  // Redirect to test list — user should use the login modal from there
                  setCurrentModule('tests');
                  return null;
                }
                // ─────────────────────────────────────────────────

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

                          <div className="text-xs text-slate-500 font-medium px-1 mt-1 flex flex-wrap items-center gap-2">
                            {activeTest.testCategory && (
                              <span className="uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                {activeTest.testCategory}
                              </span>
                            )}
                            {activeTest.secondaryCategory && (
                              <span className="uppercase text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                {activeTest.secondaryCategory}
                              </span>
                            )}
                            {activeTest.bestMeasurement && (
                              <span className="uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-bold">
                                ⭐ Best
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full lg:w-auto flex-wrap">
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
                        
<React.Fragment>
  {activeTest.type === 'plate-9x9box' ? (
    <div className="flex flex-col flex-1 min-w-[160px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Box Owner
      </label>
      <select
        value={activeTest.boxOwner || ''}
        onChange={(e) => updateActiveTest({ boxOwner: e.target.value })}
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
      >
        <option value="">Select Box Owner...</option>
        {operatorNames.map((op) => (<option key={`owner-${op}`} value={op}>{op}</option>))}
      </select>
    </div>
  ) : (
    <>
    <div className="flex flex-col flex-1 min-w-[160px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Primary Scientist
      </label>
      <select
        value={activeTest.operator || ''}
        onChange={(e) => updateActiveTest({ operator: e.target.value })}
        className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
      >
        <option value="">Select Scientist...</option>
        {operatorNames.map((op) => (<option key={`sci-${op}`} value={op}>{op}</option>))}
      </select>
    </div>
    <div className="flex flex-col flex-1 min-w-[180px]">
      <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
        Co-Scientists
      </label>
      <div className="flex flex-wrap gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 min-h-[32px]">
        {(activeTest.coScientists || []).map((cs) => (
          <span key={cs} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {cs}
            <button type="button" onClick={() => updateActiveTest({ coScientists: (activeTest.coScientists || []).filter(x => x !== cs) })} className="hover:text-red-500 font-black leading-none">×</button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const existing = activeTest.coScientists || [];
            if (!existing.includes(v) && v !== activeTest.operator) {
              updateActiveTest({ coScientists: [...existing, v] });
            }
          }}
          className="text-[10px] bg-transparent outline-none text-slate-400 flex-1 min-w-[80px]"
        >
          <option value="">+ Add co-scientist…</option>
          {operatorNames.filter(op => op !== activeTest.operator && !(activeTest.coScientists || []).includes(op)).map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      </div>
    </div>
    </>
  )}
</React.Fragment>

                    <div className="flex flex-col flex-1 min-w-[140px]">
                       <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                         Primary Class.
                       </label>
                       <select
                         value={activeTest.testCategory || ''}
                         onChange={(e) => {
                           updateActiveTest({ 
                             testCategory: e.target.value,
                             secondaryCategory: '' 
                           });
                         }}
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                       >
                         <option value="">Select...</option>
                         {PRIMARY_CATEGORIES.map((cat) => (
                           <option key={cat} value={cat}>{cat}</option>
                         ))}
                       </select>
                     </div>
                     <div className="flex flex-col flex-1 min-w-[140px]">
                       <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                         Sec. Class.
                       </label>
                       <select
                         value={activeTest.secondaryCategory || ''}
                         onChange={(e) => updateActiveTest({ secondaryCategory: e.target.value })}
                         className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                         disabled={!activeTest.testCategory || !CLASSIFICATION_MAP[activeTest.testCategory]}
                       >
                         <option value="">Select...</option>
                         {activeTest.testCategory && CLASSIFICATION_MAP[activeTest.testCategory] ? 
                           CLASSIFICATION_MAP[activeTest.testCategory].map((cat, idx) => (
                             <option key={idx} value={cat}>{cat}</option>
                           )) 
                           : null
                         }
                       </select>
                     </div>

                        <div className="flex flex-col flex-1 min-w-[140px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Experiment Type
                          </label>
                          <select
                            value={
                           activeTest.type === 'plate-96' || activeTest.type === 'plate-384' || activeTest.type === 'plate-24' ? 'Multiwell plate essay' : 
                           activeTest.type === 'nmr-fittings' ? 'NMR Fitting' :
                           activeTest.type === 'md_simulation' ? 'MD Simulation' :
                           activeTest.type === 'protein_expression' ? 'Protein expression & Purification' :
                           activeTest.type === 'ssnmr' ? 'Solid State NMR' :
                           activeTest.type === 'cd' ? 'Circular Dichroism' :
                           activeTest.type === 'nmr' ? 'NMR' :
                           activeTest.type === 'cloning' ? 'Cloning' :
                           activeTest.type === 'docking' ? 'Molecular Docking' :
                           activeTest.type === 'flow_cytometry' ? 'Flow Cytometry' : 'Multiwell plate essay'
                         }
                            disabled
                            className="bg-slate-100 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none text-slate-500 cursor-not-allowed"
                          >
                            {EXPERIMENT_TYPES.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-col flex-1 min-w-[110px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Instance
                          </label>
                          <input
                            type="text"
                            value={activeTest.instanceName || ''}
                            onChange={(e) => updateActiveTest({ instanceName: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                            placeholder="e.g. 24h / Rep 1"
                          />
                        </div>

                        <div className="flex flex-col flex-1 min-w-[120px]">
                          <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">
                            Date
                          </label>
                          <input
                            type="date"
                            value={activeTest.date}
                            onChange={(e) => updateActiveTest({ date: e.target.value })}
                            className="bg-slate-50 border border-slate-200 text-xs px-2 py-2 rounded-lg outline-none focus:border-blue-500"
                          />
                        </div>
                        
                        <div className="flex flex-col items-center justify-center self-end mb-1">
                          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer hover:text-blue-600 transition-colors">
                            <input
                              type="checkbox"
                              checked={!!activeTest.bestMeasurement}
                              onChange={(e) => updateActiveTest({ bestMeasurement: e.target.checked })}
                              className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                            ⭐ Best
                          </label>
                        </div>
                      </div>
                    </div>

                    {siblingTests.length > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 md:px-6 py-2 flex items-center overflow-x-auto custom-scrollbar gap-2 shadow-inner">
                        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide mr-2 shrink-0">
                          📅 Date / Conditions:
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
                            📅 {t.instanceName || t.date || `Cond ${idx + 1}`}

                            {siblingTests.length > 1 && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();

                                  if (
                                    window.confirm(
                                      `Delete condition ${t.instanceName || t.date}?`
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
                          + Add Date/Condition copy
                        </button>
                      </div>
                    )}
                  </div>
                );

                if (activeTest.type === 'md_simulation') {
                  return (
                    <MDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr') {
                  return (
                    <NMRTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      jumpToTest={jumpToTest}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      instances={siblingTests}
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'cd') {
                  const updateInstance = (instId, updates) => {
                    setTests((prev) => prev.map((t) => t.id === instId ? { ...t, ...updates } : t));
                  };
                  return (
                    <CDTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      appClipboard={appClipboard}
                      setAppClipboard={setAppClipboard}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      updateInstance={updateInstance}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      compoundMeta={compoundMeta}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }
if (activeTest.type === 'ssnmr') {
  const ssNmrInstances = (() => {
    const base = Array.isArray(siblingTests) && siblingTests.length
      ? siblingTests
      : [activeTest];

    const filtered = base.filter(
      (t) => t && (t.id === activeTest.id || t.type === 'ssnmr')
    );

    return filtered.length ? filtered : [activeTest];
  })();

  const updateInstance = (instId, updates) => {
    setTests((prev) =>
      prev.map((t) => (t.id === instId ? { ...t, ...updates } : t))
    );
  };

  return (
    <SSNMRTestRenderer
      activeTest={activeTest}
      updateActiveTest={updateActiveTest}
      allTests={tests}
      appClipboard={appClipboard}
      setAppClipboard={setAppClipboard}
      TestHeader={TestHeader}
      datasetProtocols={datasetProtocols}
      jumpToProtocol={jumpToProtocolFn}
      allCmpds={allCmpds}
      allCellLines={allCellLines}
      customFields={customFields}
      testCategories={testCategories}
      operators={operatorNames}
      instances={ssNmrInstances}
      updateInstance={updateInstance}
      solvents={solvents}
      buffers={buffers}
      additives={additives}
      compoundMeta={compoundMeta}
      mandatoryRules={mandatoryRules}
      mandatoryBehavior={mandatoryBehavior}
    />
  );
}
                if (activeTest.type === 'plate-9x9box') {
                  return (
                    <BoxDetail
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      storages={storages}
                      expandedGroups={expandedGroups}
                      setExpandedGroups={setExpandedGroups}
                      customCmpds={customCmpds}
                      jumpToTest={jumpToTest}
                      setMoveModal={setMoveModal}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                    />
                  );
                }
if (activeTest.type === 'flow_cytometry') {
               return (
                 <FlowCytometryTestRenderer
                   activeTest={activeTest}
                   updateActiveTest={updateActiveTest}
                   allTests={tests}
                   TestHeader={TestHeader}
                   datasetProtocols={datasetProtocols}
                   jumpToProtocol={jumpToProtocolFn}
                   allCmpds={allCmpds}
                   allCellLines={allCellLines}
                   customFields={customFields}
                   testCategories={testCategories}
                   operators={operatorNames}
                   instances={siblingTests}
                   solvents={solvents}
                   buffers={buffers}
                   additives={additives}
                   compoundMeta={compoundMeta}
                   mandatoryRules={mandatoryRules}
                   mandatoryBehavior={mandatoryBehavior}
                 />
               );
             }
                if (activeTest.type === 'cloning') {
                  return (
                    <CloningTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      compoundMeta={compoundMeta}
                      plasmidMeta={plasmidMeta}
                      molecules={molecules}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'nmr-fittings') {
                  return (
                    <NMRFittingsTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      operators={operatorNames}
                      molecules={molecules}
                      compoundMeta={compoundMeta}
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
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      nmrInstruments={nmrInstruments}
                      nmrProbes={nmrProbes}
                      nmrExperiments={nmrExperiments}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'protein_expression') {
                  return (
                    <ProteinExpressionTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
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
                      allTests={tests}
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
                      operators={operatorNames}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                if (activeTest.type === 'docking') {
                  return (
                    <DockingTestRenderer
                      activeTest={activeTest}
                      updateActiveTest={updateActiveTest}
                      allTests={tests}
                      TestHeader={TestHeader}
                      datasetProtocols={datasetProtocols}
                      jumpToProtocol={jumpToProtocolFn}
                      allCmpds={allCmpds}
                      allCellLines={allCellLines}
                      customFields={customFields}
                      testCategories={testCategories}
                      operators={operatorNames}
                      instances={siblingTests}
                      solvents={solvents}
                      buffers={buffers}
                      additives={additives}
                      mandatoryRules={mandatoryRules}
                      mandatoryBehavior={mandatoryBehavior}
                    />
                  );
                }

                return <div className="p-6">Unknown test type.</div>;
              })()}
{currentModule === 'notebook' && (
              <div className="flex-1 overflow-hidden relative flex flex-col h-full w-full">
                <LabNotebook
                  tests={tests}
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
                  operators={operatorNames}
                  plasmidMeta={plasmidMeta}
                  solvents={solvents}
                  buffers={buffers}
                  additives={additives}
                  nmrInstruments={nmrInstruments}
                  nmrProbes={nmrProbes}
                  nmrExperiments={nmrExperiments}
                  currentUser={currentUser}
                />
              </div>
            )}

{currentModule === 'calculations' && (() => {
                // Merge everything into a unified dataset for the Calculations page
                const combinedMeta = { ...compoundMeta };
                Object.keys(plasmidMeta || {}).forEach(k => { if(!combinedMeta[k]) combinedMeta[k] = plasmidMeta[k]; });
                (solvents || []).forEach(s => { if(s.name && !combinedMeta[s.name]) combinedMeta[s.name] = s; });
                (buffers || []).forEach(b => { if(b.name && !combinedMeta[b.name]) combinedMeta[b.name] = b; });
                (additives || []).forEach(a => { if(a.name && !combinedMeta[a.name]) combinedMeta[a.name] = a; });
                
                const combinedOptions = [...new Set([
                    ...allCmpds,
                    ...Object.keys(plasmidMeta || {}),
                    ...(solvents || []).map(s => s.name),
                    ...(buffers || []).map(b => b.name),
                    ...(additives || []).map(a => a.name)
                ].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

                return (
                  <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 bg-slate-50">
                    <Calculations
                      compoundOptions={combinedOptions}
                      compoundMeta={combinedMeta}
                      calculationEntries={calculationEntries}
                      setCalculationEntries={setCalculationEntries}
                      currentUser={currentUser}
                    />
                  </div>
                );
            })()}
          </div>
        </div>
      )}
    </div>

    {/* The new ScientistLoginGate above (fixed full-screen) handles requireLoginOnEntry for ALL views */}

{/* ── Generic Login Modal (triggered by sidebar or locked tests) ── */}
    {loginModal && !(authSettings.requireLoginOnEntry && !currentUser) && (
      <ScientistLoginModal
        operators={
          loginModal.targetScientistName
            ? normalizeOperators(operators).filter((op) => op.name === loginModal.targetScientistName)
            : normalizeOperators(operators)
        }
        title={loginModal.targetScientistName ? `Log in as ${loginModal.targetScientistName}` : 'Scientist Login'}
        subtitle={loginModal.targetScientistName
          ? `This test belongs to ${loginModal.targetScientistName}. Enter their password to continue.`
          : 'Select your name and enter your password to access protected data.'}
        onLogin={(user) => {
          if (loginModal.onSuccess) {
            loginModal.onSuccess(user);
          } else {
            setCurrentUser(user);
            setLoginModal(null);
          }
        }}
        onClose={() => setLoginModal(null)}
      />
    )}
    </React.Fragment>
  );
}
export const All = null;