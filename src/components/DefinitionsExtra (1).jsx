import React, { useState, useEffect } from 'react';

/* ============================================================
   DefinitionsExtra — Solvents, Buffers, Additives,
   NMR Instruments, NMR Probes, NMR Experiments
   ============================================================ */

const UNIT_OPTIONS = ['mM', 'µM', 'nM', 'M', 'mg/mL', 'µg/mL', 'ng/mL', 'g/L', '%', 'v/v%', 'w/v%'];
const NUCLEUS_OPTIONS = ['1H', '13C', '15N', '31P', '19F', '2H', '17O'];
const PROBE_SUBTYPES = ['TCI', 'TXI', 'HCN', 'BBO', 'BBF', 'QNP', 'HSQC', 'CPTCI', 'CPTXO', 'MAS', 'HX', 'HXY'];

/* ---- Small helpers ---- */
const Input = ({ label, value, onChange, type = 'text', placeholder = '', disabled = false, className = '' }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{label}</label>}
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className={`border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 ${disabled ? 'bg-slate-50 text-slate-400' : 'bg-white'}`} />
  </div>
);

const Select = ({ label, value, onChange, options, className = '' }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">{label}</label>}
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500">
      {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  </div>
);

export const LinksManager = ({ links = [], setLinks }) => {
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
      <button type="button" onClick={addLink} className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition-colors self-start shadow-sm">+ Add Link</button>
    </div>
  );
};

/* ============================================================
   SOLVENTS & MEDIA MANAGER
   ============================================================ */
export const SolventsManager = ({ solvents = [], setSolvents, selectedId, onSelect }) => {
  const [selectedName, setSelectedName] = useState('');
  const [newName, setNewName] = useState('');
  const [density, setDensity] = useState('');
  const [comments, setComments] = useState('');
  const [links, setLinks] = useState([]);

  // Migrate legacy string array to objects
  const normalized = solvents.map(s => typeof s === 'string' ? { id: s, name: s } : s);
  const existingNames = normalized.map(s => s.name).sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (selectedId) {
      const item = normalized.find(s => s.name === selectedId || s.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setDensity(item.density || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, solvents]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a solvent name.');
    const existing = normalized.find(s => s.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, density, comments, links };
    
    if (existing) {
      setSolvents(normalized.map(s => s.name === name ? newItem : s));
    } else {
      setSolvents([...normalized, newItem]);
    }
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-slate-500">Define solvents, density, and resources.</p>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Solvent" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New solvent...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Solvent Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} placeholder="e.g. D2O, DMSO-d6" />
        </div>
        <div className="md:col-span-6">
          <Input label="Density at RT (g/mL)" value={density} onChange={setDensity} placeholder="e.g. 1.11" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments / Notes</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
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
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, buffers]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter a buffer name.');
    const existing = buffers.find(b => b.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, description: desc, comments, links };
    
    if (existing) setBuffers(buffers.map(b => b.name === name ? newItem : b));
    else setBuffers([...buffers, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
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
        <div className="md:col-span-12">
          <Input label="Description (e.g. pH)" value={desc} onChange={setDesc} placeholder="e.g. pH 7.4" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
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
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, additives]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter an additive name.');
    const existing = additives.find(a => a.name === name);
    const newItem = { id: existing ? existing.id : Date.now().toString(), name, description: desc, comments, links };
    
    if (existing) setAdditives(additives.map(a => a.name === name ? newItem : a));
    else setAdditives([...additives, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
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
        <div className="md:col-span-12">
          <Input label="Description" value={desc} onChange={setDesc} placeholder="e.g. preservative" />
        </div>
        <div className="md:col-span-12">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
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
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
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
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Instrument</button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================
   NMR EXPERIMENTS MANAGER
   ============================================================ */
const EXPERIMENT_TYPES = ['NOESY', 'TOCSY', 'COSY', 'HSQC', 'HMBC', 'DEPT', 'T1', 'T2', 'DOSY', 'NOE', 'ROESY', 'TROSY', 'CRINEPT', 'Other'];

export const NMRExperimentsManager = ({ nmrExperiments = [], setNmrExperiments, selectedId, onSelect }) => {
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

  const existingNames = nmrExperiments.map(e => e.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const nucleiCount = dimensions === '1D' ? 1 : dimensions === '2D' ? 2 : 3;

  useEffect(() => {
    if (selectedId) {
      const item = nmrExperiments.find(e => e.name === selectedId || e.id === selectedId);
      if (item) {
        setSelectedName(item.name);
        setNewName('');
        setDimensions(item.dimensions || '2D');
        setExpType(item.expType || 'Other');
        setNuclei(item.nuclei || ['1H', '13C', '']);
        setParam1Name(item.param1Name || '');
        setParam2Name(item.param2Name || '');
        setParam3Name(item.param3Name || '');
        setComments(item.comments || '');
        setLinks(item.links || []);
      }
    }
  }, [selectedId, nmrExperiments]);

  const handleSave = () => {
    const name = selectedName || newName.trim();
    if (!name) return alert('Please enter an experiment name.');
    const existing = nmrExperiments.find(e => e.name === name);
    const newItem = { 
      id: existing ? existing.id : Date.now().toString(), 
      name, dimensions, expType, 
      nuclei: nuclei.slice(0, nucleiCount).filter(Boolean), 
      param1Name, param2Name, param3Name, comments, links 
    };
    
    if (existing) setNmrExperiments(nmrExperiments.map(e => e.name === name ? newItem : e));
    else setNmrExperiments([...nmrExperiments, newItem]);
    
    setSelectedName(name);
    if (onSelect) onSelect(name);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-6">
          <Select label="Existing Pulse Program" value={selectedName} onChange={n => { setSelectedName(n); if (onSelect) onSelect(n); }} options={[{ value: '', label: 'New experiment...' }, ...existingNames]} />
        </div>
        <div className="md:col-span-6">
          <Input label="New Program Name" value={selectedName ? '' : newName} onChange={setNewName} disabled={!!selectedName} placeholder="e.g. noesygpph" />
        </div>
        <div className="md:col-span-4">
          <Select label="Dimensions" value={dimensions} onChange={setDimensions} options={['1D','2D','3D']} />
        </div>
        <div className="md:col-span-8">
          <Select label="Experiment Type" value={expType} onChange={setExpType} options={EXPERIMENT_TYPES} />
        </div>
        
        {Array.from({ length: nucleiCount }).map((_, i) => (
          <div key={i} className="md:col-span-4">
            <Select label={i === 0 ? 'Nucleus (direct)' : `Nucleus ${i+1} (indirect)`}
              value={nuclei[i] || '1H'} onChange={v => { const n = [...nuclei]; n[i] = v; setNuclei(n); }} options={NUCLEUS_OPTIONS} />
          </div>
        ))}
        
        <div className="md:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-slate-100 pt-3 mt-1">
           <Input label="Custom param 1 name" value={param1Name} onChange={setParam1Name} placeholder="e.g. mixing time (ms)" />
           <Input label="Custom param 2 name" value={param2Name} onChange={setParam2Name} placeholder="optional" />
           <Input label="Custom param 3 name" value={param3Name} onChange={setParam3Name} placeholder="optional" />
        </div>
        
        <div className="md:col-span-12 mt-2">
          <label className="text-[10px] font-bold text-slate-600 uppercase">Comments</label>
          <textarea value={comments} onChange={e => setComments(e.target.value)} className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-500 mt-1" rows={2} />
        </div>
        <div className="md:col-span-12">
          <LinksManager links={links} setLinks={setLinks} />
        </div>
        <div className="md:col-span-12 flex justify-end mt-2">
          <button type="button" onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm">Save Experiment</button>
        </div>
      </div>
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

  const sortedBuffers = [...buffers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const sortedAdditives = [...additives].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="flex flex-wrap gap-3 mt-2">
      <div className="flex flex-col gap-1 min-w-[140px] flex-1">
        <label className="text-[10px] font-bold text-slate-600 uppercase">Buffer</label>
        <select value={bufferName} onChange={e => update({ bufferName: e.target.value })}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500">
          <option value="">— None —</option>
          {sortedBuffers.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
        </select>
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
        <select value={additiveName} onChange={e => update({ additiveName: e.target.value })}
          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-500">
          <option value="">— None —</option>
          {sortedAdditives.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
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