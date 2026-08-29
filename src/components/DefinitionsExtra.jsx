import React, { useState, useEffect, useRef } from 'react';
import { SearchableSelect } from './SearchableSelect';
import { uploadLocalFile, withExtension } from '../utils/driveUpload';
import { sanitizeSlug } from '../utils/driveNaming';

/* ============================================================
   DefinitionsExtra — Solvents, Buffers, Additives,
   NMR Instruments, NMR Probes, NMR Experiments
   ============================================================ */

const UNIT_OPTIONS = ['mM', 'µM', 'nM', 'M', 'mg/mL', 'µg/mL', 'ng/mL', 'g/L', '%', 'v/v%', 'w/v%'];
const NUCLEUS_OPTIONS = ['1H', '13C', '15N', '31P', '19F', '2H', '17O'];
const PROBE_SUBTYPES = ['TCI', 'TXI', 'HCN', 'BBO', 'BBF', 'QNP', 'HSQC', 'CPTCI', 'CPTXO', 'MAS', 'HX', 'HXY'];

export const getMolecularWeightFromFormula = (formulaStr) => {
  const ATOMIC_WEIGHTS = {
    H: 1.008, D: 2.014, T: 3.016, He: 4.003, Li: 6.94, Be: 9.012, B: 10.81, C: 12.011, N: 14.007, 
    O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305, Al: 26.982, 
    Si: 28.085, P: 30.974, S: 32.065, Cl: 35.45, K: 39.098, Ca: 40.078, 
    Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, 
    Br: 79.904, Ag: 107.87, I: 126.90, Ba: 137.33, Pt: 195.08, Au: 196.97, 
    Hg: 200.59, Pb: 207.2
  };

  if (!formulaStr) return '';
  
  try {
    const cleanStr = formulaStr.replace(/\s+/g, '');
    const parts = cleanStr.split(/[.·*]/);
    let totalMW = 0;
    
    for (let part of parts) {
      if (!part) continue;
      let multiplier = 1;
      const leadingNumMatch = part.match(/^(\d+)(.*)/);
      if (leadingNumMatch) {
        multiplier = parseFloat(leadingNumMatch[1]);
        part = leadingNumMatch[2];
      }
      
      let stack = [{ weight: 0 }];
      let i = 0;
      while (i < part.length) {
        let char = part[i];
        if (char === '(' || char === '[') {
          stack.push({ weight: 0 });
          i++;
        } else if (char === ')' || char === ']') {
          if (stack.length < 2) return ''; 
          let top = stack.pop();
          i++;
          let numStr = '';
          while (i < part.length && /[0-9.]/.test(part[i])) {
            numStr += part[i];
            i++;
          }
          let count = numStr === '' ? 1 : parseFloat(numStr);
          stack[stack.length - 1].weight += top.weight * count;
        } else if (/[A-Z]/.test(char)) {
          let elem = char;
          i++;
          if (i < part.length && /[a-z]/.test(part[i])) {
            elem += part[i];
            i++;
          }
          let numStr = '';
          while (i < part.length && /[0-9.]/.test(part[i])) {
            numStr += part[i];
            i++;
          }
          let count = numStr === '' ? 1 : parseFloat(numStr);
          if (ATOMIC_WEIGHTS[elem] !== undefined) {
            stack[stack.length - 1].weight += ATOMIC_WEIGHTS[elem] * count;
          } else {
            return ''; 
          }
        } else {
          return ''; 
        }
      }
      if (stack.length !== 1) return ''; 
      totalMW += stack[0].weight * multiplier;
    }
    return totalMW > 0 ? totalMW.toFixed(2) : '';
  } catch {
    return '';
  }
};


/* ---- Small helpers ---- */
const Input = ({ label, value, onChange, type = 'text', placeholder = '', disabled = false, className = '' }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className={`border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white'}`} />
  </div>
);

const Select = ({ label, value, onChange, options, className = '' }) => {
  const opts = options || [];
  const newEntry = opts.find(
    (o) => o && typeof o === 'object' && o.value === '' && o.label
  );
  const placeholder = newEntry
    ? newEntry.label
    : `Select ${(label || '').toLowerCase()}…`;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{label}</label>}
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={opts}
        placeholder={placeholder}
        onClear={newEntry ? () => onChange('') : undefined}
      />
    </div>
  );
};

export const LinksManager = ({ links = [], setLinks, tableName = '', elementName = '' }) => {
  const addLink = () => setLinks([...links, { url: '', description: '' }]);
  const updateLink = (idx, field, val) => {
    const newLinks = [...links];
    newLinks[idx][field] = val;
    setLinks(newLinks);
  };
  const removeLink = (idx) => setLinks(links.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-2 mt-2 border-t border-slate-100 pt-3 w-full">
      <label className="block text-[10px] font-bold text-slate-400 uppercase">Links & Resources (Drive, Web)</label>
      {links.map((link, i) => (
        <div key={i} className="flex flex-col md:flex-row gap-2 items-center w-full">
          <input type="text" placeholder="Description (e.g. MSDS)" value={link.description} onChange={e => updateLink(i, 'description', e.target.value)} className="w-full md:w-1/3 border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
          <input type="text" placeholder="URL" value={link.url} onChange={e => updateLink(i, 'url', e.target.value)} className="w-full md:w-2/3 border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500" />
          <button type="button" onClick={() => removeLink(i)} className="text-red-500 hover:text-red-700 font-bold px-2 py-1 text-lg leading-none">×</button>
        </div>
      ))}
      {tableName && elementName && (
        <LibraryDocUpload tableName={tableName} elementName={elementName}
                          onAdded={(l) => setLinks([...links, l])} />
      )}
      <button type="button" onClick={addLink} className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition-colors self-start shadow-sm">+ Add Link</button>
    </div>
  );
};

/* Upload a documentation file of a library element into
   <Lab Workspace>/<dataset>/library/<tableName>/<elementName>_<originalName>.
   The Drive link is added to the element's links via onAdded. */
export const LibraryDocUpload = ({ tableName = '', elementName = '', onAdded }) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!tableName || !elementName) return null;
  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target.value) e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const base = String(file.name || '').replace(/\.[^/.]+$/, '');
      const drive = await uploadLocalFile({
        name: withExtension(`${sanitizeSlug(elementName)}_${base}`, file.name || 'file'),
        mimeType: file.type || 'application/octet-stream',
        file,
        path: ['library', tableName]
      });
      if (drive && drive.driveUrl && onAdded) {
        onAdded({ description: `${base} (documentation)`, url: drive.driveUrl });
      }
    } catch { alert('Could not upload the documentation to Google Drive.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
      <button type="button" disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}
              className="text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1.5 shadow-sm transition-colors disabled:opacity-50">
        {busy ? '⏳ Uploading…' : '⬆ Upload documentation to Drive'}
      </button>
      <span className="text-[10px] text-slate-400">library/{tableName}/{elementName}_file</span>
    </div>
  );
};

/* ============================================================
   SOLVENTS & MEDIA MANAGER
   ============================================================ */
export const SolventsManager = ({ solvents = [], setSolvents, selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [formula, setFormula] = useState('');
  const [density, setDensity] = useState('');
  const [molecularWeight, setMolecularWeight] = useState('');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const normalized = solvents.map(s => typeof s === 'string' ? { id: s, name: s } : s);
  const existingNames = normalized.map(s => s.name).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = normalized.find(s => s.name === selectedId || s.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setFormula(item.formula || '');
        setDensity(item.density || '');
        setMolecularWeight(item.molecularWeight || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, solvents]);

  const handleFormulaChange = (val) => {
    setFormula(val);
    const calcMW = getMolecularWeightFromFormula(val);
    if (calcMW) setMolecularWeight(calcMW);
  };

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a solvent name.');
    const existing = normalized.find(s => s.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, formula, density, molecularWeight, comments, links };
    
    if (existing) {
      setSolvents(normalized.map(s => s.name === name ? newItem : s));
    } else {
      setSolvents([...normalized, newItem]);
    }
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setSolvents(normalized.filter(s => s.name !== selectedName));
      setSelectedName('');
      setNewName('');
      setFormula('');
      setDensity('');
      setMolecularWeight('');
      setComments('');
      setLinks([]);
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">Define solvents, formula, density, MW, and resources.</p>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Solvent" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New solvent...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Solvent Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} placeholder="e.g. D2O, DMSO-d6" />
        </div>
        <div className="md:col-span-4">
          <Input label="Formula" value={formula} onChange={handleFormulaChange} placeholder="e.g. H2O" />
        </div>
        <div className="md:col-span-4">
          <Input label="Density at RT (g/mL)" value={density} onChange={setDensity} placeholder="e.g. 1.11" />
        </div>
        <div className="md:col-span-4">
          <Input label="Molecular Weight (Da)" value={molecularWeight} onChange={setMolecularWeight} type="number" placeholder="e.g. 18.02" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments / Notes</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="solvents" elementName={selectedName || newName.trim()} />
        </div>
        <div className="md:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Delete</button>
          )}
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Solvent</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   BUFFERS MANAGER
   ============================================================ */
export const BuffersManager = ({ buffers = [], setBuffers, selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [desc, setDesc] = useState('');
  const [formula, setFormula] = useState('');
  const [molecularWeight, setMolecularWeight] = useState('');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const existingNames = buffers.map(b => b.name).filter(Boolean).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = buffers.find(b => b.name === selectedId || b.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setDesc(item.description || '');
        setFormula(item.formula || '');
        setMolecularWeight(item.molecularWeight || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, buffers]);

  const handleFormulaChange = (val) => {
    setFormula(val);
    const calcMW = getMolecularWeightFromFormula(val);
    if (calcMW) setMolecularWeight(calcMW);
  };

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a buffer name.');
    const existing = buffers.find(b => b.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, description: desc, formula, molecularWeight, comments, links };
    
    if (existing) setBuffers(buffers.map(b => b.name === name ? newItem : b));
    else setBuffers([...buffers, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setBuffers(buffers.filter(b => b.name !== selectedName));
      setSelectedName('');
      setNewName('');
      setDesc('');
      setFormula('');
      setMolecularWeight('');
      setComments('');
      setLinks([]);
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Buffer" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New buffer...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Buffer Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} placeholder="e.g. PBS" />
        </div>
        <div className="md:col-span-4">
          <Input label="Description (e.g. pH)" value={desc} onChange={setDesc} placeholder="e.g. pH 7.4" />
        </div>
        <div className="md:col-span-4">
          <Input label="Formula" value={formula} onChange={handleFormulaChange} placeholder="e.g. NaH2PO4" />
        </div>
        <div className="md:col-span-4">
          <Input label="Molecular Weight (Da)" value={molecularWeight} onChange={setMolecularWeight} type="number" placeholder="e.g. 119.12" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="buffers" elementName={selectedName || newName.trim()} />
        </div>
        <div className="md:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Delete</button>
          )}
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Buffer</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   ADDITIVES MANAGER
   ============================================================ */
export const AdditivesManager = ({ additives = [], setAdditives, selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [desc, setDesc] = useState('');
  const [formula, setFormula] = useState('');
  const [molecularWeight, setMolecularWeight] = useState('');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const existingNames = additives.map(a => a.name).filter(Boolean).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = additives.find(a => a.name === selectedId || a.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setDesc(item.description || '');
        setFormula(item.formula || '');
        setMolecularWeight(item.molecularWeight || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, additives]);

  const handleFormulaChange = (val) => {
    setFormula(val);
    const calcMW = getMolecularWeightFromFormula(val);
    if (calcMW) setMolecularWeight(calcMW);
  };

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter an additive name.');
    const existing = additives.find(a => a.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, description: desc, formula, molecularWeight, comments, links };
    
    if (existing) setAdditives(additives.map(a => a.name === name ? newItem : a));
    else setAdditives([...additives, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setAdditives(additives.filter(a => a.name !== selectedName));
      setSelectedName('');
      setNewName('');
      setDesc('');
      setFormula('');
      setMolecularWeight('');
      setComments('');
      setLinks([]);
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Additive" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New additive...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Additive Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} placeholder="e.g. NaN3" />
        </div>
        <div className="md:col-span-4">
          <Input label="Description" value={desc} onChange={setDesc} placeholder="e.g. preservative" />
        </div>
        <div className="md:col-span-4">
          <Input label="Formula" value={formula} onChange={handleFormulaChange} placeholder="e.g. NaN3" />
        </div>
        <div className="md:col-span-4">
          <Input label="Molecular Weight (Da)" value={molecularWeight} onChange={setMolecularWeight} type="number" placeholder="e.g. 65.01" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="additives" elementName={selectedName || newName.trim()} />
        </div>
        <div className="md:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Delete</button>
          )}
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Additive</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   NMR PROBES MANAGER
   ============================================================ */
export const NMRProbesManager = ({ nmrProbes = [], setNmrProbes, selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [field, setField] = useState('');
  const [type, setType] = useState('inverse');
  const [subtype, setSubtype] = useState('TCI');
  const [diameter, setDiameter] = useState('5');
  const [cryo, setCryo] = useState(false);
  const [state, setState] = useState('liquid');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const existingNames = nmrProbes.map(p => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = nmrProbes.find(p => p.name === selectedId || p.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setField(item.field || '');
        setType(item.type || 'inverse');
        setSubtype(item.subtype || 'TCI');
        setDiameter(item.diameter || '5');
        setCryo(item.cryo || false);
        setState(item.state || 'liquid');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, nmrProbes]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a probe name.');
    const existing = nmrProbes.find(p => p.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, field, type, subtype, diameter, cryo, state, comments, links };
    
    if (existing) setNmrProbes(nmrProbes.map(p => p.name === name ? newItem : p));
    else setNmrProbes([...nmrProbes, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setNmrProbes(nmrProbes.filter(p => p.name !== selectedName));
      setSelectedName('');
      setNewName('');
      setField('');
      setType('inverse');
      setSubtype('TCI');
      setDiameter('5');
      setCryo(false);
      setState('liquid');
      setComments('');
      setLinks([]);
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Probe" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New probe...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Probe Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} />
        </div>
        <div className="md:col-span-4">
          <Input label="Field (MHz)" value={field} onChange={setField} type="number" placeholder="e.g. 600" />
        </div>
        <div className="md:col-span-4">
          <Select label="Type" value={type} onChange={setType} options={['direct', 'inverse']} />
        </div>
        <div className="md:col-span-4">
          <Select label="Subtype" value={subtype} onChange={setSubtype} options={PROBE_SUBTYPES} />
        </div>
        <div className="md:col-span-4">
          <Input label="Diameter (mm)" value={diameter} onChange={setDiameter} type="number" placeholder="5" />
        </div>
        <div className="md:col-span-4">
          <Select label="Sample State" value={state} onChange={setState} options={['liquid', 'solid']} />
        </div>
        <div className="md:col-span-4 flex items-center mt-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cryo} onChange={e => setCryo(e.target.checked)} className="w-4 h-4 accent-blue-600" />
            <span className="text-sm font-bold text-slate-700 uppercase">Cryo probe</span>
          </label>
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="nmrProbes" elementName={selectedName || newName.trim()} />
        </div>
        <div className="md:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Delete</button>
          )}
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Probe</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   NMR INSTRUMENTS MANAGER
   ============================================================ */
export const NMRInstrumentsManager = ({ nmrInstruments = [], setNmrInstruments, nmrProbes = [], selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [frequency, setFrequency] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [availableProbes, setAvailableProbes] = useState([]);
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const existingNames = nmrInstruments.map(i => i.name).filter(Boolean).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = nmrInstruments.find(i => i.name === selectedId || i.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setFrequency(item.frequency || '');
        setManufacturer(item.manufacturer || '');
        setAvailableProbes(item.availableProbes || []);
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, nmrInstruments]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter an instrument name.');
    const existing = nmrInstruments.find(i => i.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, frequency, manufacturer, availableProbes, comments, links };
    
    if (existing) setNmrInstruments(nmrInstruments.map(i => i.name === name ? newItem : i));
    else setNmrInstruments([...nmrInstruments, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  const handleDelete = () => {
    if (!selectedName) return;
    if (window.confirm(`Are you sure you want to delete ${selectedName}?`)) {
      setNmrInstruments(nmrInstruments.filter(i => i.name !== selectedName));
      setSelectedName('');
      setNewName('');
      setFrequency('');
      setManufacturer('');
      setAvailableProbes([]);
      setComments('');
      setLinks([]);
      if (onSelect) onSelect('');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Instrument" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New instrument...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Instrument Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} />
        </div>
        <div className="md:col-span-6">
          <Input label="Frequency (MHz)" value={frequency} onChange={setFrequency} type="number" placeholder="600" />
        </div>
        <div className="md:col-span-6">
          <Input label="Manufacturer" value={manufacturer} onChange={setManufacturer} placeholder="Bruker, Varian, JEOL..." />
        </div>
        <div className="md:col-span-12 flex flex-col gap-1 mt-2">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Available Probes</label>
          <div className="flex flex-wrap gap-3">
            {nmrProbes.length === 0 && <span className="text-xs text-slate-400 italic">No probes defined in library yet.</span>}
            {nmrProbes.map(p => (
              <label key={p.id} className="flex items-center gap-1.5 cursor-pointer text-sm bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm">
                <input type="checkbox" checked={availableProbes.includes(p.name)}
                  onChange={e => setAvailableProbes(e.target.checked ? [...availableProbes, p.name] : availableProbes.filter(x => x !== p.name))} 
                  className="w-4 h-4 accent-blue-600" />
                <span className="font-bold text-slate-700">{p.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-12 mt-2">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="nmrInstruments" elementName={selectedName || newName.trim()} />
        </div>
        <div className="md:col-span-12 flex justify-end gap-2 mt-2">
          {selectedName && (
            <button type="button" onClick={handleDelete} className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Delete</button>
          )}
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Instrument</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
NMR EXPERIMENTS MANAGER
============================================================ */
const EXPERIMENT_TYPES = [
  'NOESY',
  'TOCSY',
  'COSY',
  'HSQC',
  'HMBC',
  'DEPT',
  'T1',
  'T2',
  'DOSY',
  'NOE',
  'ROESY',
  'TROSY',
  'CRINEPT',
  'Other'
];

const normalizePulseLinkUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '#';
  if (/^(https?:|mailto:|file:)/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return `https://${raw}`;
};

const extractPulseDriveId = (url) => {
  try {
    const u = String(url || '');
    const fileMatch = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];

    const idMatch = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];

    const openMatch = u.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (openMatch) return openMatch[1];
  } catch {}

  return '';
};

const looksLikePulseProgramText = (text) => {
  const sample = String(text || '').slice(0, 80000);

  const hasPulseTokens = /(^|\n)\s*(p\d+|d\d+|go|ze|aq|acquire|adc|fid|ph\d+|gp\d*|gradient)/i.test(sample);

  const looksHtmlOnly =
    /<html|<!doctype|<body|<head/i.test(sample) && !hasPulseTokens;

  return hasPulseTokens && !looksHtmlOnly;
};

const fetchPulseSequenceFromLink = async (url) => {
  const candidates = [];
  const driveId = extractPulseDriveId(url);

  if (driveId) {
    candidates.push(`https://drive.google.com/uc?export=download&id=${driveId}`);
    candidates.push(`https://drive.usercontent.google.com/download?id=${driveId}&export=download`);
  }

  candidates.push(normalizePulseLinkUrl(url));

  let lastError = null;

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { redirect: 'follow' });
      if (!res.ok) {
        lastError = new Error(`Request failed with status ${res.status}`);
        continue;
      }

      const text = await res.text();

      if (looksLikePulseProgramText(text)) {
        return text;
      }

      lastError = new Error('The file does not look like a pulse program.');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Could not fetch the pulse sequence file.');
};

const parseBrukerPulseProgram = (text) => {
  const lines = String(text || '').split(/\r?\n/);
  const events = [];
  const laneSet = new Set();
  const laneOrder = [];

  const addLane = (lane) => {
    if (!laneSet.has(lane)) {
      laneSet.add(lane);
      laneOrder.push(lane);
    }
  };

  const channelFromText = (txt) => {
    const s = String(txt || '').toLowerCase();

    if (/(^|\b)(1h|proton|f1|pl1|ch1)(\b|$)/.test(s)) return '1H / F1';
    if (/(^|\b)(13c|carbon|f2|pl2|ch2)(\b|$)/.test(s)) return '13C / F2';
    if (/(^|\b)(15n|nitrogen|f3|pl3|ch3)(\b|$)/.test(s)) return '15N / F3';
    if (/(^|\b)(31p|phosphorus|f4|pl4|ch4)(\b|$)/.test(s)) return '31P / F4';
    if (/(^|\b)(2h|deuterium|f5|pl5|ch5)(\b|$)/.test(s)) return '2H / F5';
    if (/(^|\b)(19f|fluorine|f6|pl6|ch6)(\b|$)/.test(s)) return '19F / F6';

    return '';
  };

  const parseInlineDuration = (token) => {
    const m = String(token).match(/=([\d.]+)(s|ms|us|µs)?/i);
    if (!m) return null;

    const val = parseFloat(m[1]);
    if (!Number.isFinite(val)) return null;

    const unit = String(m[2] || '').toLowerCase();

    if (unit === 's') return val;
    if (unit === 'ms') return val / 1000;
    if (unit === 'us' || unit === 'µs') return val / 1000000;

    return val;
  };

  lines.forEach((rawLine, lineIdx) => {
    const line = String(rawLine || '')
      .split(';')[0]
      .trim();

    if (!line) return;

    const channel = channelFromText(line);
    const tokens = line.split(/\s+/);
    let lineHadEvent = false;

    tokens.forEach((token, tokenIdx) => {
      const t = String(token || '').replace(/[;,]+$/g, '');
      const lower = t.toLowerCase();

      if (!lower) return;

      const duration = parseInlineDuration(t);

      if (/^(go|aq|acquire|adc|fid|detect)$/.test(lower)) {
        addLane('Acquisition');
        events.push({
          type: 'acquisition',
          label: t,
          lane: 'Acquisition',
          duration,
          line: lineIdx + 1,
          raw: line
        });
        lineHadEvent = true;
        return;
      }

      if (/^d\d+(?:=|$)/.test(lower)) {
        addLane('Delays');
        events.push({
          type: 'delay',
          label: t,
          lane: 'Delays',
          duration,
          line: lineIdx + 1,
          raw: line
        });
        lineHadEvent = true;
        return;
      }

      if (/^p\d+(?::[\w.-]+)?(?:=|$)/.test(lower)) {
        const lane = channel || 'RF';
        addLane(lane);

        const next = tokens[tokenIdx + 1] || '';
        const phase = /^ph/i.test(next) ? next : '';

        events.push({
          type: 'pulse',
          label: t,
          phase,
          lane,
          duration,
          line: lineIdx + 1,
          raw: line
        });

        lineHadEvent = true;
        return;
      }

      if (/^(gp|grad|gradient|z\d+)/.test(lower)) {
        addLane('Gradients');
        events.push({
          type: 'gradient',
          label: t,
          lane: 'Gradients',
          duration,
          line: lineIdx + 1,
          raw: line
        });
        lineHadEvent = true;
        return;
      }

      if (/^ph\d+$/.test(lower)) {
        const prev = events[events.length - 1];

        if (prev && prev.type === 'pulse' && !prev.phase) {
          prev.phase = t;
        } else {
          addLane('Phase');
          events.push({
            type: 'phase',
            label: t,
            lane: 'Phase',
            duration,
            line: lineIdx + 1,
            raw: line
          });
        }

        lineHadEvent = true;
        return;
      }

      if (
        /^(ze|lo|loop|if|endif|goto|label|wr|exit|return|cp|cpd|dec|on|off|mc|qsin)$/.test(
          lower
        )
      ) {
        addLane('Control');
        events.push({
          type: 'control',
          label: t,
          lane: 'Control',
          duration,
          line: lineIdx + 1,
          raw: line
        });
        lineHadEvent = true;
        return;
      }
    });

    if (!lineHadEvent && line.length < 140 && events.length < 700) {
      addLane('Control');
      events.push({
        type: 'control',
        label: line.slice(0, 28),
        lane: 'Control',
        duration: null,
        line: lineIdx + 1,
        raw: line
      });
    }
  });

  const channelLanes = laneOrder.filter((lane) => /\/F\d+/.test(lane));
  const fixedLanes = [
    'RF',
    'Delays',
    'Gradients',
    'Acquisition',
    'Phase',
    'Control'
  ].filter((lane) => laneSet.has(lane));

  const lanes = [...new Set([...channelLanes, ...fixedLanes, ...laneOrder])];

  return { events, lanes };
};

export const BrukerPulseSequenceViewer = ({
  open,
  onClose,
  name,
  pulseSequence = '',
  pulseSequenceLink = ''
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

  const scrollRef = useRef(null);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const clampZoom = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.min(10, Math.max(0.25, n));
  };

  useEffect(() => {
    if (open) {
      setShowRaw(false);
      setZoom(1);
      setIsPanning(false);

      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: 0, left: 0 });
      }
    }
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;

    if (!open || !el) return undefined;

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;

      setZoom((prev) => {
        const next = prev * factor;
        return Math.min(10, Math.max(0.25, next));
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [open]);

  if (!open) return null;

  const parsed = parseBrukerPulseProgram(pulseSequence);
  const events = parsed.events.slice(0, 800);
  const lanes = parsed.lanes.length ? parsed.lanes : ['RF'];

  const laneHeight = 104;
  const labelWidth = 190;
  const topPadding = 56;
  const eventGap = 36;

  const truncate = (text, max = 16) => {
    const s = String(text || '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };

  const eventWidth = (e) => {
    if (e.type === 'acquisition') return 116;
    if (e.type === 'delay') return 82;
    if (e.type === 'pulse') return 36;
    if (e.type === 'gradient') return 58;
    if (e.type === 'phase') return 34;
    return 56;
  };

  let x = labelWidth + 36;

  const placed = events.map((e, i) => {
    const w = eventWidth(e);
    const laneIndex = Math.max(0, lanes.indexOf(e.lane));
    const y = topPadding + laneIndex * laneHeight;
    const centerY = y + laneHeight / 2;

    const item = {
      ...e,
      key: `evt_${i}_${e.line}`,
      x,
      y,
      w,
      centerY
    };

    x += w + eventGap;
    return item;
  });

  const svgWidth = Math.max(1100, x + 120);
  const svgHeight = topPadding + lanes.length * laneHeight + 80;

  const zoomIn = () => {
    setZoom((prev) => clampZoom(prev * 1.25));
  };

  const zoomOut = () => {
    setZoom((prev) => clampZoom(prev / 1.25));
  };

  const resetView = () => {
    setZoom(1);
    setIsPanning(false);

    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, left: 0 });
    }
  };

  const fitWidth = () => {
    const el = scrollRef.current;
    if (!el) return;

    const available = el.clientWidth - 32;
    const nextZoom = clampZoom(available / svgWidth);

    setZoom(nextZoom);
    setIsPanning(false);

    el.scrollTo({ top: 0, left: 0 });
  };

  const handleDiagramMouseDown = (e) => {
    const el = scrollRef.current;
    if (!el) return;

    setIsPanning(true);
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop
    };
  };

  const handleDiagramMouseMove = (e) => {
    const el = scrollRef.current;
    if (!el || !isPanning) return;

    el.scrollLeft = panStart.current.scrollLeft - (e.clientX - panStart.current.x);
    el.scrollTop = panStart.current.scrollTop - (e.clientY - panStart.current.y);
  };

  const stopPanning = () => {
    setIsPanning(false);
  };

  return (
    <div className="fixed inset-0 z-[1000000] bg-slate-900/75 backdrop-blur-sm p-3 md:p-8 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-[98vw] h-full max-h-[96vh] flex flex-col overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-lg font-black text-slate-800">
              Pulse Sequence Viewer
            </h3>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {name || 'Unnamed pulse program'} · {events.length} parsed events ·{' '}
              {lanes.length} lanes
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!showRaw && (
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm">
                <button
                  type="button"
                  onClick={zoomOut}
                  className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-black transition-colors"
                  title="Zoom out"
                >
                  −
                </button>

                <input
                  type="range"
                  min={25}
                  max={1000}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(clampZoom(Number(e.target.value) / 100))}
                  className="w-28 accent-blue-600"
                  title="Zoom level"
                />

                <span className="text-[11px] font-bold text-slate-600 w-10 text-center">
                  {Math.round(zoom * 100)}%
                </span>

                <button
                  type="button"
                  onClick={zoomIn}
                  className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-black transition-colors"
                  title="Zoom in"
                >
                  +
                </button>

                <button
                  type="button"
                  onClick={fitWidth}
                  className="h-7 px-2 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-colors"
                  title="Fit diagram width"
                >
                  Fit
                </button>

                <button
                  type="button"
                  onClick={resetView}
                  className="h-7 px-2 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                  title="Reset zoom and scroll"
                >
                  1:1
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
            >
              {showRaw ? 'Show Diagram' : 'Show Raw Text'}
            </button>

            {String(pulseSequenceLink || '').trim() && (
              <a
                href={normalizePulseLinkUrl(pulseSequenceLink)}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold py-2 px-3 rounded-lg text-xs shadow-sm transition-colors"
              >
                Open Drive File
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-900 text-white font-bold py-2 px-4 rounded-lg text-xs shadow-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {showRaw ? (
          <pre className="flex-1 overflow-auto custom-scrollbar bg-slate-950 text-slate-100 text-xs p-5 font-mono whitespace-pre-wrap">
            {String(pulseSequence || '')}
          </pre>
        ) : (
          <>
            <div className="px-5 py-2 border-b border-slate-100 bg-white text-[11px] font-semibold text-slate-500">
              Zoom with Ctrl/Cmd + mouse wheel, use the zoom slider, or drag the diagram to pan.
            </div>

            {events.length === 0 ? (
              <div className="flex-1 overflow-auto custom-scrollbar p-6">
                <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6">
                  No recognizable Bruker pulse-program tokens were found. Try pasting
                  the actual pulse program text, for example lines containing{' '}
                  <code>d1</code>, <code>p1 ph1</code>, <code>d11</code>,{' '}
                  <code>go</code>, etc.
                </div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="flex-1 overflow-auto custom-scrollbar bg-slate-100 relative select-none"
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
                onMouseDown={handleDiagramMouseDown}
                onMouseMove={handleDiagramMouseMove}
                onMouseUp={stopPanning}
                onMouseLeave={stopPanning}
              >
                <div
                  style={{
                    width: Math.ceil(svgWidth * zoom),
                    height: Math.ceil(svgHeight * zoom),
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                      width: svgWidth,
                      height: svgHeight
                    }}
                  >
                    <svg
                      width={svgWidth}
                      height={svgHeight}
                      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    >
                      {lanes.map((lane, i) => {
                        const y = topPadding + i * laneHeight;
                        const centerY = y + laneHeight / 2;

                        return (
                          <g key={`lane_${lane}_${i}`}>
                            <rect
                              x={0}
                              y={y}
                              width={svgWidth}
                              height={laneHeight}
                              fill={i % 2 === 1 ? '#f8fafc' : '#ffffff'}
                            />
                            <text
                              x={14}
                              y={centerY}
                              dominantBaseline="middle"
                              fontSize={12}
                              fontWeight={800}
                              fill="#475569"
                            >
                              {truncate(lane, 22)}
                            </text>
                            <line
                              x1={labelWidth}
                              y1={centerY}
                              x2={svgWidth}
                              y2={centerY}
                              stroke="#e2e8f0"
                              strokeWidth={2}
                            />
                          </g>
                        );
                      })}

                      {placed.map((e) => {
                        const centerX = e.x + e.w / 2;

                        const title = `${e.label || e.type}${
                          e.phase ? ` ${e.phase}` : ''
                        } | line ${e.line}\n${e.raw}`;

                        if (e.type === 'pulse') {
                          const rectX = e.x + (e.w - 18) / 2;

                          return (
                            <g key={e.key}>
                              <title>{title}</title>
                              <rect
                                x={rectX}
                                y={e.y + 24}
                                width={18}
                                height={laneHeight - 48}
                                rx={5}
                                fill="#3b82f6"
                              />
                              {e.phase && (
                                <text
                                  x={centerX}
                                  y={e.y + 18}
                                  textAnchor="middle"
                                  fontSize={10}
                                  fontWeight={800}
                                  fill="#1d4ed8"
                                >
                                  {truncate(e.phase, 12)}
                                </text>
                              )}
                              <text
                                x={centerX}
                                y={e.y + laneHeight - 12}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={800}
                                fill="#1e293b"
                              >
                                {truncate(e.label, 12)}
                              </text>
                            </g>
                          );
                        }

                        if (e.type === 'delay') {
                          return (
                            <g key={e.key}>
                              <title>{title}</title>
                              <line
                                x1={e.x}
                                y1={e.centerY}
                                x2={e.x + e.w}
                                y2={e.centerY}
                                stroke="#94a3b8"
                                strokeWidth={8}
                                strokeLinecap="round"
                                strokeDasharray="8 7"
                              />
                              <text
                                x={centerX}
                                y={e.centerY - 16}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={800}
                                fill="#475569"
                              >
                                {truncate(e.label, 14)}
                              </text>
                            </g>
                          );
                        }

                        if (e.type === 'acquisition') {
                          return (
                            <g key={e.key}>
                              <title>{title}</title>
                              <rect
                                x={e.x}
                                y={e.y + 28}
                                width={e.w}
                                height={laneHeight - 56}
                                rx={12}
                                fill="rgba(16,185,129,0.18)"
                                stroke="#10b981"
                                strokeWidth={2}
                              />
                              <text
                                x={centerX}
                                y={e.centerY + 4}
                                textAnchor="middle"
                                fontSize={12}
                                fontWeight={900}
                                fill="#047857"
                              >
                                {truncate(e.label, 18)}
                              </text>
                            </g>
                          );
                        }

                        if (e.type === 'gradient') {
                          const points = [
                            `${e.x},${e.centerY + 20}`,
                            `${e.x + e.w * 0.25},${e.centerY - 20}`,
                            `${e.x + e.w * 0.75},${e.centerY - 20}`,
                            `${e.x + e.w},${e.centerY + 20}`
                          ].join(' ');

                          return (
                            <g key={e.key}>
                              <title>{title}</title>
                              <polygon
                                points={points}
                                fill="rgba(139,92,246,0.22)"
                                stroke="#8b5cf6"
                                strokeWidth={2}
                              />
                              <text
                                x={centerX}
                                y={e.y + laneHeight - 12}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight={800}
                                fill="#6d28d9"
                              >
                                {truncate(e.label, 14)}
                              </text>
                            </g>
                          );
                        }

                        return (
                          <g key={e.key}>
                            <title>{title}</title>
                            <rect
                              x={e.x}
                              y={e.centerY - 18}
                              width={e.w}
                              height={36}
                              rx={10}
                              fill="#f8fafc"
                              stroke="#cbd5e1"
                              strokeWidth={2}
                            />
                            <text
                              x={centerX}
                              y={e.centerY + 4}
                              textAnchor="middle"
                              fontSize={10}
                              fontWeight={800}
                              fill="#475569"
                            >
                              {truncate(e.label, 10)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const NMRExperimentsManager = ({
  nmrExperiments = [],
  setNmrExperiments,
  selectedId,
  onSelect
}) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [dimensions, setDimensions] = useState('2D');
  const [expType, setExpType] = useState('Other');
  const [nuclei, setNuclei] = useState(['1H', '13C', '']);
  const [param1Name, setParam1Name] = useState('');
  const [param2Name, setParam2Name] = useState('');
  const [param3Name, setParam3Name] = useState('');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  const [pulseSequence, setPulseSequence] = useState('');
  const [pulseSequenceLink, setPulseSequenceLink] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loadingFromLink, setLoadingFromLink] = useState(false);
  const [savingPulse, setSavingPulse] = useState(false);
  const [pulseStatus, setPulseStatus] = useState('');

  const normalized = (Array.isArray(nmrExperiments) ? nmrExperiments : []).map(
    (exp) => (typeof exp === 'string' ? { id: exp, name: exp } : exp)
  );

  const existingNames = normalized
    .map((e) => e.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const nucleiCount = dimensions === '1D' ? 1 : dimensions === '2D' ? 2 : 3;

  useEffect(() => {
    if (selectedId) {
      const item = normalized.find(
        (e) => e.name === selectedId || e.id === selectedId
      );

      if (item) {
        setSelectedName(item.name || '');
        setNewName('');
        setDimensions(item.dimensions || '2D');
        setExpType(item.expType || 'Other');
        setNuclei(item.nuclei || ['1H', '13C', '']);
        setParam1Name(item.param1Name || '');
        setParam2Name(item.param2Name || '');
        setParam3Name(item.param3Name || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
        setPulseSequence(item.pulseSequence || '');
        setPulseSequenceLink(item.pulseSequenceLink || '');
        setViewerOpen(false);
        setPulseStatus('');
      }
    }
  }, [selectedId, nmrExperiments]);

  const loadPulseFromLink = async () => {
    const url = pulseSequenceLink.trim();

    if (!url) {
      setPulseStatus('Enter a Drive/file link first.');
      return;
    }

    setLoadingFromLink(true);
    setPulseStatus('Trying to load pulse sequence from link...');

    try {
      const text = await fetchPulseSequenceFromLink(url);
      setPulseSequence(text);
      setPulseStatus('Pulse sequence loaded from link.');
    } catch {
      setPulseStatus(
        'Could not automatically load the file. This can happen because of Google Drive permissions/CORS. Paste the pulse-sequence text manually if needed.'
      );
    } finally {
      setLoadingFromLink(false);
    }
  };

  // Save the pasted pulse sequence as a real file on Drive:
  // <Lab Workspace>/<dataset>/library/nmrExperiments/<name>_pulseSequence.txt
  const savePulseToDrive = async () => {
    const expName = (selectedName || newName.trim()).trim();
    if (!expName || !pulseSequence.trim()) return;
    setSavingPulse(true);
    setPulseStatus('');
    try {
      const drive = await uploadLocalFile({
        name: `${sanitizeSlug(expName)}_pulseSequence.txt`,
        mimeType: 'text/plain',
        file: new Blob([pulseSequence], { type: 'text/plain' }),
        path: ['library', 'nmrExperiments']
      });
      if (drive && drive.driveUrl) {
        setPulseSequenceLink(drive.driveUrl);
        setPulseStatus(`✓ Pulse sequence saved to Drive: library/nmrExperiments/${expName}_pulseSequence.txt`);
      } else {
        setPulseStatus('Drive upload failed — connect Google Drive and try again.');
      }
    } catch {
      setPulseStatus('Could not save the pulse sequence to Google Drive.');
    } finally {
      setSavingPulse(false);
    }
  };

  const handleSave = () => {
    const name = selectedName || newName.trim();

    if (!name) return alert('Please enter an experiment name.');

    const existing = normalized.find((e) => e.name === name);

    const newItem = {
      id: existing ? existing.id : Date.now().toString(),
      name,
      dimensions,
      expType,
      nuclei: nuclei.slice(0, nucleiCount).filter(Boolean),
      param1Name,
      param2Name,
      param3Name,
      comments,
      links,
      pulseSequence,
      pulseSequenceLink
    };

    if (existing) {
      setNmrExperiments(normalized.map((e) => (e.name === name ? newItem : e)));
    } else {
      setNmrExperiments([...normalized, newItem]);
    }

    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select
            label="Existing Pulse Program"
            value={selectedName}
            onChange={(n) => {
              setSelectedName(n);
              if (onSelect) onSelect(n);
            }}
            options={[{ value: '', label: 'New experiment...' }, ...existingNames]}
          />
        </div>

        <div className="md:col-span-6">
          <Input
            label="New Program Name"
            value={selectedName ? '' : newName}
            onChange={setNewName}
            disabled={!!selectedName}
            placeholder="e.g. noesygpph"
          />
        </div>

        <div className="md:col-span-4">
          <Select
            label="Dimensions"
            value={dimensions}
            onChange={setDimensions}
            options={['1D', '2D', '3D']}
          />
        </div>

        <div className="md:col-span-8">
          <Select
            label="Experiment Type"
            value={expType}
            onChange={setExpType}
            options={EXPERIMENT_TYPES}
          />
        </div>

        {Array.from({ length: nucleiCount }).map((_, i) => (
          <div key={i} className="md:col-span-4">
            <Select
              label={i === 0 ? 'Nucleus (direct)' : `Nucleus ${i + 1} (indirect)`}
              value={nuclei[i] || '1H'}
              onChange={(v) => {
                const n = [...nuclei];
                n[i] = v;
                setNuclei(n);
              }}
              options={NUCLEUS_OPTIONS}
            />
          </div>
        ))}

        <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-slate-100 pt-3 mt-1">
          <Input
            label="Custom param 1 name"
            value={param1Name}
            onChange={setParam1Name}
            placeholder="e.g. mixing time (ms)"
          />
          <Input
            label="Custom param 2 name"
            value={param2Name}
            onChange={setParam2Name}
            placeholder="optional"
          />
          <Input
            label="Custom param 3 name"
            value={param3Name}
            onChange={setParam3Name}
            placeholder="optional"
          />
        </div>

        <div className="md:col-span-12 border-t border-slate-100 pt-3 mt-1">
          <label className="text-[10px] font-bold text-slate-600 uppercase">
            Bruker Pulse Sequence Text
          </label>
          <textarea
            value={pulseSequence}
            onChange={(e) => setPulseSequence(e.target.value)}
            placeholder={`Paste the Bruker pulse program here...\n\nExamples:\n;d1\np1 ph1\nd11\np2 ph2\ngo`}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 mt-1 font-mono bg-slate-50/50 h-44"
          />
        </div>

        <div className="md:col-span-7">
          <Input
            label="Pulse Sequence File Link (Google Drive / raw text)"
            value={pulseSequenceLink}
            onChange={setPulseSequenceLink}
            placeholder="https://drive.google.com/file/d/..."
          />
        </div>

        <div className="md:col-span-5 flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={loadPulseFromLink}
            disabled={loadingFromLink || !pulseSequenceLink.trim()}
            className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-300 text-slate-700 font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors"
          >
            {loadingFromLink ? 'Loading...' : 'Load from Link'}
          </button>

          <button
            type="button"
            onClick={savePulseToDrive}
            disabled={savingPulse || !pulseSequence.trim() || !(selectedName || newName.trim())}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors"
            title="Save the pulse-sequence text as a file in library/nmrExperiments/<name>_pulseSequence.txt"
          >
            {savingPulse ? 'Saving…' : '⬆ Save Pulse Sequence to Drive'}
          </button>

          {pulseSequenceLink.trim() && (
            <a
              href={normalizePulseLinkUrl(pulseSequenceLink)}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors"
            >
              Open Drive File
            </a>
          )}

          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            disabled={!pulseSequence.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors"
          >
            Show Graphical
          </button>
        </div>

        {pulseStatus && (
          <div className="md:col-span-12 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {pulseStatus}
          </div>
        )}

        <div className="md:col-span-12 mt-2">
          <label className="text-[10px] font-bold text-slate-600 uppercase">
            Comments
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1"
            rows={2}
          />
        </div>

        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} tableName="nmrExperiments" elementName={selectedName || newName.trim()} />
        </div>

        <div className="md:col-span-12 flex justify-end mt-2">
          <button
            type="button"
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm"
          >
            Save Experiment
          </button>
        </div>
      </div>

      {viewerOpen && (
        <BrukerPulseSequenceViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          name={selectedName || newName}
          pulseSequence={pulseSequence}
          pulseSequenceLink={pulseSequenceLink}
        />
      )}
    </div>
  );
};

/* ============================================================
   BUFFER + ADDITIVE FIELDS (for Experimental Conditions)
   ============================================================ */
export const BufferAdditiveFields = ({ t, update, buffers = [], additives = [] }) => {
  const bufferName = t.bufferName || '';
  const bufferConc = t.bufferConc || '';
  const bufferUnit = t.bufferUnit || 'mM';
  const additiveName = t.additiveName || '';
  const additiveConc = t.additiveConc || '';
  const additiveUnit = t.additiveUnit || 'mM';

  const bufferNames = (buffers || [])
    .map((b) => (b && typeof b === 'object' ? b.name : b))
    .filter((n) => n && String(n).trim());
  const additiveNames = (additives || [])
    .map((a) => (a && typeof a === 'object' ? a.name : a))
    .filter((n) => n && String(n).trim());

  return (
    <div className="flex flex-wrap gap-3 mt-2">
      <div className="flex flex-col gap-1 min-w-[140px] flex-1">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Buffer</label>
        <div className="flex items-center gap-1.5">
          <SearchableSelect
            value={bufferName}
            onChange={(v) => update({ bufferName: v })}
            options={bufferNames}
            placeholder="— None —"
            allowCustom
            className="flex-1"
          />
          {bufferName && (
            <button
              type="button"
              title="Clear buffer"
              onClick={() => update({ bufferName: '' })}
              className="text-red-400 hover:text-red-600 font-bold px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 w-24">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Conc.</label>
        <input type="number" value={bufferConc} onChange={e => update({ bufferConc: e.target.value })} placeholder="50"
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
      </div>
      <div className="flex flex-col gap-1 w-24">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Unit</label>
        <select value={bufferUnit} onChange={e => update({ bufferUnit: e.target.value })}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500">
          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1 min-w-[140px] flex-1">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Additive</label>
        <div className="flex items-center gap-1.5">
          <SearchableSelect
            value={additiveName}
            onChange={(v) => update({ additiveName: v })}
            options={additiveNames}
            placeholder="— None —"
            allowCustom
            className="flex-1"
          />
          {additiveName && (
            <button
              type="button"
              title="Clear additive"
              onClick={() => update({ additiveName: '' })}
              className="text-red-400 hover:text-red-600 font-bold px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1 w-24">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Conc.</label>
        <input type="number" value={additiveConc} onChange={e => update({ additiveConc: e.target.value })} placeholder=""
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500" />
      </div>
      <div className="flex flex-col gap-1 w-24">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Unit</label>
        <select value={additiveUnit} onChange={e => update({ additiveUnit: e.target.value })}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500">
          {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    </div>
  );
};
