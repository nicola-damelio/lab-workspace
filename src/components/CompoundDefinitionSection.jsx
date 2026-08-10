import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
calculateSequenceInfo,
generateDnaFromProtein,
calculateSmilesInfoAsync
} from '../utils/labMolecules';

const inputCls =
'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white';
const labelCls = 'block text-xs font-bold text-slate-500 uppercase mb-1';

/* =========================================================
RDKit  & 3Dmol.js LOADING
========================================================= */
let rdkitPromise = null;
async function loadRDKit() {
if (typeof window === 'undefined') return null;
if (window.__RDKit) return window.__RDKit;
if (!window.initRDKitModule) {
await new Promise((resolve, reject) => {
const script = document.createElement('script');
script.src = 'https://unpkg.com/@rdkit/rdkit/dist/RDKit_minimal.js';
script.async = true;
script.onload = resolve;
script.onerror = reject;
document.head.appendChild(script);
});
}
window.__RDKit = await window.initRDKitModule();
return window.__RDKit;
}

let mol3dPromise = null;
async function load3Dmol() {
if (typeof window === 'undefined') return null;
if (window.$3Dmol) return window.$3Dmol;
if (!window.$3Dmol) {
await new Promise((resolve, reject) => {
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/3dmol@2.0.6/build/3Dmol-min.min.js';
script.async = true;
script.onload = resolve;
script.onerror = reject;
document.head.appendChild(script);
});
}
return window.$3Dmol;
}

/* =========================================================
SMILES 2D SVG COMPONENT
========================================================= */
const Smiles2DViewer = ({ smiles, width = 350, height = 280 }) => {
const [svg, setSvg] = useState(null);
const [error, setError] = useState(null);
const [loading, setLoading] = useState(false);

useEffect(() => {
if (!smiles || !smiles.trim()) { setSvg(null); return; }
let cancelled = false;
(async () => {
setLoading(true);
setError(null);
try {
const RDKit = await loadRDKit();
if (!RDKit || cancelled) return;
const mol = RDKit.get_mol(smiles);
if (!mol) { setError('Invalid SMILES'); setLoading(false); return; }
const svgStr = mol.get_svg(width, height);
if (!cancelled) setSvg(svgStr);
mol.delete();
} catch (e) {
if (!cancelled) setError('SVG generation failed: ' + e.message);
}
if (!cancelled) setLoading(false);
})();
return () => { cancelled = true; };
}, [smiles, width, height]);

if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Rendering 2D structure…</div>;
if (error) return <div className="flex items-center justify-center h-40 text-red-500 text-sm">{error}</div>;
if (!svg) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm italic">Enter a SMILES string to render.</div>;

return (
<div
className="bg-white border border-slate-200 rounded-lg overflow-hidden"
style={{ width, height }}
dangerouslySetInnerHTML={{ __html: svg }}
/>
);
};

/* =========================================================
SMILES 3D VIEWER (3Dmol.js)
========================================================= */
const Smiles3DViewer = ({ smiles, width = 350, height = 280, style = 'stick' }) => {
const containerRef = useRef(null);
const viewerRef = useRef(null);
const [status, setStatus] = useState('idle');
const [error, setError] = useState(null);

useEffect(() => {
if (!smiles || !smiles.trim()) { setStatus('idle'); return; }
let cancelled = false;
(async () => {
setStatus('loading');
setError(null);
try {
const [RDKit, $3Dmol] = await Promise.all([loadRDKit(), load3Dmol()]);
if (!RDKit || !$3Dmol || cancelled) return;

const mol = RDKit.get_mol(smiles);
if (!mol) { setError('Invalid SMILES'); setStatus('error'); return; }

const molBlock = mol.get_molblock();
mol.delete();

if (cancelled) return;

if (!containerRef.current) return;

if (viewerRef.current) { viewerRef.current.clear(); }

viewerRef.current = $3Dmol.createViewer(containerRef.current, {
backgroundColor: '#f8fafc',
width,
height,
});

viewerRef.current.addModel(molBlock, 'mol');

if (style === 'ballstick') {
viewerRef.current.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.25 } });
} else if (style === 'sphere') {
viewerRef.current.setStyle({}, { sphere: { scale: 0.3 } });
} else {
viewerRef.current.setStyle({}, { stick: { radius: 0.2 } });
}

viewerRef.current.setBackgroundColor('#f8fafc');
viewerRef.current.zoomTo();
viewerRef.current.render();

setStatus('ready');
} catch (e) {
if (!cancelled) { setError('3D render failed: ' + e.message); setStatus('error'); }
}
})();
return () => { cancelled = true; };
}, [smiles, width, height, style]);

if (status === 'idle') return <div className="flex items-center justify-center h-40 text-slate-400 text-sm italic">Enter a SMILES string to render 3D.</div>;
if (status === 'loading') return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading 3D viewer…</div>;
if (status === 'error') return <div className="flex items-center justify-center h-40 text-red-500 text-sm">{error}</div>;

return <div ref={containerRef} style={{ width, height }} className="rounded-lg border border-slate-200 overflow-hidden" />;
};

/* =========================================================
MAIN COMPONENT
========================================================= */
export function CompoundDefinitionSection({
compoundOptions = [],
customCmpds = [],
setCustomCmpds,
compoundMeta = {},
setCompoundMeta,
selectedId,
onSelect
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
const [smiles2DVisible, setSmiles2DVisible] = useState(true);
const [smiles3DVisible, setSmiles3DVisible] = useState(true);
const [render3DStyle, setRender3DStyle] = useState('stick');
const [notes, setNotes] = useState('');
const [links, setLinks] = useState([]);

useEffect(() => { if (selectedId) chooseCompound(selectedId); }, [selectedId]);

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
if (Number.isFinite(manual) && manual > 0) return manual;
if (computed?.molecularWeight) return Number(computed.molecularWeight);
if (selectedMw) return Number(selectedMw);
return null;
}, [manualMw, computed, selectedMw]);

const addQuickModification = (mod) => {
setModText((prev) => {
if (!prev.trim()) return mod;
return `${prev}, ${mod}`;
});
};

const computeSmilesMw = async () => {
if (!smiles.trim()) { setSmilesStatus('Enter a SMILES string first.'); return; }
setSmilesStatus('Calculating SMILES molecular weight...');
const result = await calculateSmilesInfoAsync(smiles.trim());
if (result?.molecularWeight) {
setManualMw(String(result.molecularWeight));
setSmilesStatus('SMILES MW calculated using RDKit.');
} else {
setSmilesStatus('RDKit unavailable. Enter MW manually or load RDKit.');
}
};

const saveCompound = () => {
const name = selectedName || newName.trim();
if (!name) { alert('Please choose an existing compound or enter a new compound name.'); return; }
const meta = {
name,
type,
host: type === 'protein' ? host : undefined,
sequence: type === 'smiles' ? '' : sequence,
modifications: type === 'smiles' ? '' : modText,
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
[name]: { ...(prev[name] || {}), ...meta }
}));
const alreadyInCustomCompounds = customCmpds.some((c) => {
if (typeof c === 'string') return c === name;
return c?.name === name;
});
if (!alreadyInCustomCompounds) setCustomCmpds((prev) => [...prev, name]);
};

const quickMods = ['Acetylation', 'Phosphorylation', 'Amidation', 'Methylation', 'Formylation', 'Succinylation', 'Palmitoylation'];

return (
 <div className= "bg-white border border-slate-200 rounded-xl p-4 shadow-sm " >
 <h3 className= "text-sm font-bold text-slate-700 uppercase mb-2 " >Compound Sequence / Structure </h3 >
 <p className= "text-xs text-slate-500 mb-4 " >
Define a compound by one-letter sequence, modifications, or SMILES. Molecular weight and length are calculated automatically. For SMILES, 2D and 3D structures are rendered.
 </p >
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
       <div className="lg:col-span-3">
         <label className={labelCls}>Existing compound</label>
         <select value={selectedName} onChange={(e) => chooseCompound(e.target.value)} className={inputCls}>
           <option value="">New compound...</option>
           {existingNames.map((name) => <option key={name} value={name}>{name}</option>)}
         </select>
       </div>
       <div className="lg:col-span-3">
         <label className={labelCls}>New compound name</label>
         <input type="text" value={selectedName ? '' : newName} disabled={!!selectedName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Peptide-01" className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} />
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
         <select value={host} onChange={(e) => setHost(e.target.value)} disabled={type !== 'protein'} className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`}>
           <option value="bacterial">Bacterial</option>
           <option value="mammalian">Mammalian</option>
         </select>
       </div>
     </div>
     {type === 'smiles' ? (
       <div className="grid grid-cols-1 gap-3 mb-4">
         <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
           <div className="lg:col-span-6">
             <label className={labelCls}>SMILES</label>
             <input type="text" value={smiles} onChange={(e) => setSmiles(e.target.value)} placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" className={inputCls} />
           </div>
           <div className="lg:col-span-3 flex items-end">
             <button type="button" onClick={computeSmilesMw} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">Calculate MW</button>
           </div>
           <div className="lg:col-span-3 flex items-end">
             <div className="text-xs text-slate-500">{smilesStatus}</div>
           </div>
         </div>
         {/* 2D & 3D Renderers */}
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
           <div>
             <div className="flex items-center justify-between mb-2">
               <label className={labelCls}>2D Structure (SVG)</label>
               <button type="button" onClick={() => setSmiles2DVisible(!smiles2DVisible)} className="text-xs text-blue-600 hover:underline">{smiles2DVisible ? 'Hide' : 'Show'}</button>
             </div>
             {smiles2DVisible && <Smiles2DViewer smiles={smiles} width={350} height={260} />}
           </div>
           <div>
             <div className="flex items-center justify-between mb-2">
               <label className={labelCls}>3D Structure (3Dmol.js)</label>
               <div className="flex items-center gap-2">
                 <select value={render3DStyle} onChange={(e) => setRender3DStyle(e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs">
                   <option value="stick">Stick</option>
                   <option value="ballstick">Ball & Stick</option>
                   <option value="sphere">Sphere</option>
                 </select>
                 <button type="button" onClick={() => setSmiles3DVisible(!smiles3DVisible)} className="text-xs text-blue-600 hover:underline">{smiles3DVisible ? 'Hide' : 'Show'}</button>
               </div>
             </div>
             {smiles3DVisible && <Smiles3DViewer smiles={smiles} width={350} height={260} style={render3DStyle} />}
           </div>
         </div>
       </div>
     ) : (
       <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
         <div className="lg:col-span-7">
           <label className={labelCls}>One-letter sequence{type === 'polysaccharide' ? ' or tokens' : ''}</label>
           <textarea value={sequence} onChange={(e) => setSequence(e.target.value)} placeholder={type === 'protein' ? 'e.g. MKWVTFISLL...' : type === 'dna' ? 'e.g. ATGCGTAC...' : type === 'rna' ? 'e.g. AUGCGUAC...' : 'e.g. G-M-N-F-S or GMNFS'} className={`${inputCls} h-32 font-mono uppercase`} />
         </div>
         <div className="lg:col-span-5">
           <label className={labelCls}>Modifications</label>
           <textarea value={modText} onChange={(e) => setModText(e.target.value)} placeholder="e.g. Phosphorylation, Acetylation, Amidation:2" className={`${inputCls} h-32`} />
           <div className="flex flex-wrap gap-2 mt-2">
             {quickMods.map((mod) => (
               <button key={mod} type="button" onClick={() => addQuickModification(mod)} className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-2 py-1 rounded transition-colors">+ {mod}</button>
             ))}
           </div>
         </div>
       </div>
     )}
     <div className="grid grid-cols-1 mb-4">
       <label className={labelCls}>Additional Notes</label>
       <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Solubility, handling, properties, etc." className={`${inputCls} h-20`} />
     </div>
     {/* Links Manager */}
     <div className="mb-4">
       <label className={labelCls}>Links & References</label>
       {links.map((link, i) => (
         <div key={i} className="flex gap-2 items-center mb-1">
           <input type="text" value={link.url} onChange={(e) => { const l = [...links]; l[i].url = e.target.value; setLinks(l); }} className={`${inputCls} flex-1`} placeholder="URL" />
           <button onClick={() => setLinks(links.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 font-bold">✕</button>
         </div>
       ))}
       <button onClick={() => setLinks([...links, { url: '' }])} className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold px-3 py-1.5 rounded transition-colors mt-1">+ Add Link</button>
     </div>
     <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-4">
       <div className="md:col-span-3">
         <label className={labelCls}>Manual MW override, Da</label>
         <input type="number" value={manualMw} onChange={(e) => setManualMw(e.target.value)} placeholder="Optional" className={inputCls} />
       </div>
       <div className="md:col-span-3">
         <label className={labelCls}>Calculated MW</label>
         <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">{effectiveMw ? `${Number(effectiveMw).toLocaleString()} Da` : 'Not set'}</div>
       </div>
       <div className="md:col-span-2">
         <label className={labelCls}>Length</label>
         <div className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm font-bold text-slate-700">{computed?.length ?? selectedMeta?.length ?? '—'}</div>
       </div>
       <div className="md:col-span-4 flex items-end justify-end">
         <button type="button" onClick={saveCompound} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm shadow-sm transition-colors">Save Compound Definition</button>
       </div>
     </div>
     {computed && !computed.ok && computed.unknown?.length > 0 && (
       <div className="mb-4 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">Unknown tokens/letters: {computed.unknown.join(', ')}</div>
     )}
     {type === 'protein' && dnaPreview && (
       <div>
         <label className={labelCls}>Generated DNA sequence, {host} preferred codons</label>
         <textarea readOnly value={dnaPreview} className={`${inputCls} h-28 font-mono bg-slate-50`} />
       </div>
     )}
   </div>
);
}
export default CompoundDefinitionSection;
