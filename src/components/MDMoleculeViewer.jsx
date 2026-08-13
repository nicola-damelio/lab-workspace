import React, { useState, useEffect, useRef, useCallback } from 'react';

const SELECT_COLOR_HEX = 0xf59e0b;
const MANUAL_COLOR_HEX = 0x16a34a;

// ---- PDB atom name → NMR Greek-letter name mapping (Hydrogens) ----
const PDB_TO_NMR = {
  H: 'HN', HN: 'HN', H1: 'HN', H2: 'HN', H3: 'HN',
  HA: 'Hα', HA1: 'Hα1', HA2: 'Hα2', HA3: 'Hα2',
  HB: 'Hβ', HB1: 'Hβ1', HB2: 'Hβ2', HB3: 'Hβ',
  HG: 'Hγ', HG1: 'Hγ1', HG2: 'Hγ2', HG3: 'Hγ', HG11: 'Hγ1', HG12: 'Hγ1', HG13: 'Hγ1', HG21: 'Hγ2', HG22: 'Hγ2', HG23: 'Hγ2',
  HD: 'Hδ', HD1: 'Hδ1', HD2: 'Hδ2', HD3: 'Hδ', HD11: 'Hδ1', HD12: 'Hδ1', HD13: 'Hδ1', HD21: 'Hδ21', HD22: 'Hδ22',
  HE: 'Hε', HE1: 'Hε1', HE2: 'Hε2', HE3: 'Hε3', HE21: 'Hε21', HE22: 'Hε22',
  HZ: 'Hζ', HZ1: 'Hζ(NH3)', HZ2: 'Hζ(NH3)', HZ3: 'Hζ(NH3)',
  HH: 'Hη2', HH11: 'Hη2', HH12: 'Hη2', HH2: 'Hη2', HH21: 'Hη2', HH22: 'Hη2',
};

const GREEK_MAP = { A: 'α', B: 'β', G: 'γ', D: 'δ', E: 'ε', Z: 'ζ', H: 'η' };
const REVERSE_GREEK = { α: 'A', β: 'B', γ: 'G', δ: 'D', ε: 'E', ζ: 'Z', η: 'H' };

const normalizeStructureSource = (raw) => {
  const value = (raw || '').trim();
  if (!value) return null;

  if (/^(https?:|blob:|data:)/i.test(value)) {
    try {
      const urlObj = new URL(value, window.location.origin);
      let ext = urlObj.pathname.includes('.') ? urlObj.pathname.split('.').pop().toLowerCase() : '';
      if (!ext && urlObj.searchParams.has('format')) {
        ext = urlObj.searchParams.get('format').toLowerCase();
      }
      if (ext === 'pdb' || ext === 'ent') return { url: value, params: { ext: 'pdb' } };
      if (ext === 'cif' || ext === 'mmcif') return { url: value, params: { ext: 'cif' } };
      if (ext === 'sdf') return { url: value, params: { ext: 'sdf' } };
      if (ext === 'mol2') return { url: value, params: { ext: 'mol2' } };
      
      const guessed = /cif/i.test(value) ? 'cif' : /sdf/i.test(value) ? 'sdf' : 'pdb';
      return { url: value, params: { ext: guessed } };
    } catch(e) {
      return { url: value, params: { ext: 'pdb' } };
    }
  }
  if (/^rcsb:/i.test(value)) return { url: value };
  if (/^[0-9a-z]{4}$/i.test(value)) return { url: `https://files.rcsb.org/download/${value.toUpperCase()}.cif`, params: { ext: 'cif' } };
  return { url: value };
};

const getCarbonName = (molType, char, atom) => {
  if (!atom) return null;
  if (atom.startsWith('HN') || atom.startsWith('NH') || atom.startsWith('OH') || atom.startsWith('NHAc') || atom.startsWith('Ac') || atom.includes('NH3')) return null;

  if (molType === 'protein') {
    if (atom === 'Hε' && char === 'R') return null;
    if (char === 'W' && atom === 'Hδ1') return null;
    if (atom.includes('CH3')) return atom.replace('H', 'C').replace('(CH3)', '');
    const cName = atom.replace('H', 'C').replace(/\d+$/, '');
    if (['V', 'I', 'T'].includes(char) && atom.includes('γ')) return atom.replace('H', 'C');
    if (['L', 'I'].includes(char) && atom.includes('δ')) return atom.replace('H', 'C');
    if (['F', 'Y', 'W', 'H'].includes(char) && (atom.includes('δ') || atom.includes('ε') || atom.includes('ζ') || atom.includes('η'))) return atom.replace('H', 'C');
    return cName;
  }
  return atom.replace('H', 'C');
};

const buildKeys = (ri, tokens, molType, char) => {
  const set = new Set();
  (tokens || []).forEach((tok) => {
    const variants = new Set([tok]);
    if (/\d$/.test(tok)) {
      [1, 2].forEach((n) => variants.add(tok + n));
      const stripped = tok.replace(/\d+$/, '');
      if (stripped !== tok && stripped.length > 1) variants.add(stripped);
    }
    variants.forEach((v) => {
      set.add(`${ri}-${v}`);
      if (v.startsWith('H')) {
        const c = getCarbonName(molType, char, v);
        if (c) set.add(`${ri}-${c}`);
      }
    });
  });
  return [...set];
};

// Names an organic atom using the SAME scheme the 2D SMILES viewer uses (see
// deriveOrganicAtomNaming in NMRSections.jsx): heavy atoms as "{Element}{heavyRank}" where
// heavyRank is that atom's position counting heavy atoms only, and hydrogens as
// "H{parentHeavyRank}[a/b/c]" named after the heavy atom they're bonded to. Deriving names from
// bond connectivity (rather than the raw file order) is what keeps 2D<->3D atom selection in sync
// even though the 2D structure (RDKit) and the 3D structure (an independently fetched/generated
// PDB or SDF) can order their atoms -- especially hydrogens -- differently.
const getOrganicAtomName = (atom) => {
  const structure = atom.structure;
  const elem = atom.element || 'C';

  const heavyRankOf = (targetIndex) => {
    let rank = -1, count = 0;
    structure.eachAtom((a) => {
      if (a.element !== 'H') {
        if (a.index === targetIndex) rank = count;
        count++;
      }
    });
    return rank;
  };

  if (elem !== 'H') {
    const rank = heavyRankOf(atom.index);
    return `${elem}${rank >= 0 ? rank : atom.index}`;
  }

  let parentIndex = -1;
  atom.eachBondedAtom((bonded) => { if (parentIndex < 0 && bonded.element !== 'H') parentIndex = bonded.index; });
  if (parentIndex < 0) return `H${atom.index}`; // no bond info available; degrade gracefully

  const parentRank = heavyRankOf(parentIndex);
  const siblingIndices = [];
  structure.eachAtom((a) => {
    if (a.element !== 'H') return;
    let bondedToSameParent = false;
    a.eachBondedAtom((b) => { if (b.index === parentIndex) bondedToSameParent = true; });
    if (bondedToSameParent) siblingIndices.push(a.index);
  });
  siblingIndices.sort((x, y) => x - y);
  const pos = siblingIndices.indexOf(atom.index);
  const suffix = siblingIndices.length > 1 ? ('abcdefgh'[pos] || String(pos)) : '';
  return `H${parentRank >= 0 ? parentRank : parentIndex}${suffix}`;
};

// NGL isn't installed as an npm module in this app (there's no bundler-resolvable 'ngl' package,
// hence "Module not found: 'ngl'" from a dynamic import), and no <script> tag for it exists either
// (window.NGL is unavailable). So it's loaded here on demand, directly from a CDN, the same way
// NGL's own docs recommend for plain script-tag embedding: the SELF-CONTAINED dist/ngl.js build
// (NOT dist/ngl.umd.js, which expects three.js/chroma-js/signals/sprintf-js as separate externals
// and would silently break without them). Module-level + a shared promise so multiple viewer
// instances mounting at once only ever trigger one script load.
let _nglLoadPromise = null;
const NGL_CDN_URLS = [
  'https://unpkg.com/ngl@2.4.0/dist/ngl.js',
  'https://cdn.jsdelivr.net/npm/ngl@2.4.0/dist/ngl.js',
];

const loadNGLFromUrl = (url) => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = url;
  script.async = true;
  script.onload = () => {
    if (window.NGL) resolve(window.NGL);
    else reject(new Error(`Script loaded from ${url} but did not set window.NGL`));
  };
  script.onerror = () => reject(new Error(`Failed to fetch NGL script from ${url}`));
  document.head.appendChild(script);
});

const ensureNGL = () => {
  if (window.NGL) return Promise.resolve(window.NGL);
  if (_nglLoadPromise) return _nglLoadPromise;

  _nglLoadPromise = (async () => {
    let lastErr = null;
    for (const url of NGL_CDN_URLS) {
      try {
        return await loadNGLFromUrl(url);
      } catch (e) {
        lastErr = e;
      }
    }
    _nglLoadPromise = null; // allow a future retry rather than caching a permanent failure
    throw new Error(`Could not load the NGL viewer library from any CDN. ${lastErr ? lastErr.message : ''}`);
  })();

  return _nglLoadPromise;
};

const mapNGLAtomToNmrKeys = (atom, parsedSeq, moleculeType) => {
  if (moleculeType === 'organic') {
    const nmrAtom = getOrganicAtomName(atom);
    const keys = buildKeys(0, [nmrAtom], 'organic', 'O');
    return { ri: 0, keys, label: `Org ${nmrAtom}`, nmrAtom };
  }

  const ri = atom.resno - 1;
  if (!parsedSeq || ri < 0 || ri >= parsedSeq.length) return null;

  const res = parsedSeq[ri];
  if (!res) return null;

  const upper = (atom.atomname || '').trim().toUpperCase();
  let nmrAtom = PDB_TO_NMR[upper];

  if (!nmrAtom) {
    if (upper === 'N') nmrAtom = 'N';
    else if (upper === 'CA') nmrAtom = 'Cα';
    else if (upper === 'C') nmrAtom = "C'";
    else if (upper === 'CB') nmrAtom = 'Cβ';
    else if (upper === 'O') nmrAtom = 'O';
    else {
      const match = upper.match(/^([CNO])([αβγδεζη])(\d*)$/);
      if (match) nmrAtom = `${match[1]}${GREEK_MAP[match[2]]}${match[3]}`;
      else nmrAtom = upper;
    }
  }

  const keys = buildKeys(ri, [nmrAtom], moleculeType, res.char);
  return { ri, keys, label: `${res.id || res.char}${atom.resno} ${nmrAtom}`, nmrAtom };
};

const NMRMoleculeViewer = ({
  src,
  structureText,
  structureTextExt,
  externalLoading = false,
  externalError = null,
  onAtomClick,
  selectedKeys,
  manualKeys = [],
  moleculeType = 'protein',
  parsedSeq = [],
  height = '520px',
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const componentRef = useRef(null);

  const highlightCompRef = useRef(null);
  const manualHighlightCompRef = useRef(null);
  const labelCompRef = useRef(null);
  const sidechainCompRef = useRef(null);

  const [file, setFile] = useState(null);
  const [loadRequest, setLoadRequest] = useState(null);

  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [sidechainStyle, setSidechainStyle] = useState('licorice');

  const parsedSeqRef = useRef(parsedSeq);
  const moleculeTypeRef = useRef(moleculeType);
  const onAtomClickRef = useRef(onAtomClick);

  useEffect(() => {
    parsedSeqRef.current = parsedSeq;
    moleculeTypeRef.current = moleculeType;
    onAtomClickRef.current = onAtomClick;
  }, [parsedSeq, moleculeType, onAtomClick]);

  // Sync externally-provided structure TEXT (locally generated protein/DNA/RNA backbone, or a
  // pre-fetched/validated organic PDB/SDF) into loadRequest. Takes priority over a plain src URL
  // when both are present, and is handed to NGL as an in-memory Blob -- no extra network fetch.
  const lastLoadedTextRef = useRef(null);
  useEffect(() => {
    if (!structureText) { lastLoadedTextRef.current = null; return; }
    if (!file && structureText !== lastLoadedTextRef.current) {
      lastLoadedTextRef.current = structureText;
      setLoadRequest({ file: null, url: null, text: structureText, ext: structureTextExt || 'pdb', ts: Date.now() });
    }
  }, [structureText, structureTextExt, file]);

  // Sync external src into loadRequest seamlessly (only when there's no structureText to prefer)
  useEffect(() => {
    if (src && !file && !structureText) {
      setLoadRequest({ file: null, url: src, ts: Date.now() });
    }
  }, [src, file, structureText]);

  // Reflect the PARENT's own async fetch/generation progress (e.g. resolving an organic SMILES
  // to a 3D structure) in the same loading/error UI used for direct loads, before any loadRequest
  // exists yet.
  useEffect(() => {
    if (structureText || loadRequest) return;
    if (externalLoading) { setStatus('loading'); setErrorMsg(''); }
    else if (externalError) { setStatus('error'); setErrorMsg(externalError); }
  }, [externalLoading, externalError, structureText, loadRequest]);

  // Safely Mount NGL Stage ONCE
  useEffect(() => {
    let isMounted = true;

    const nglWithTimeout = Promise.race([
      ensureNGL(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out loading the NGL viewer library (20s). Check your network connection / that unpkg.com and cdn.jsdelivr.net are reachable.')), 20000)),
    ]);

    nglWithTimeout.then((NGL) => {
      if (!isMounted || !containerRef.current) return;
      if (!stageRef.current) {
        stageRef.current = new NGL.Stage(containerRef.current, { backgroundColor: '#f8fafc' });
        
        let lastHover = null;
        stageRef.current.signals.clicked.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) return;
          const mapped = mapNGLAtomToNmrKeys(pickingProxy.atom, parsedSeqRef.current, moleculeTypeRef.current);
          if (mapped && onAtomClickRef.current) onAtomClickRef.current(mapped.ri, mapped.keys);
        });

        stageRef.current.signals.hovered.add((pickingProxy) => {
          if (!pickingProxy || !pickingProxy.atom) {
            if (lastHover !== null) { lastHover = null; setHoverInfo(null); }
            return;
          }
          const mapped = mapNGLAtomToNmrKeys(pickingProxy.atom, parsedSeqRef.current, moleculeTypeRef.current);
          const label = mapped ? mapped.label : `${pickingProxy.atom.resname || ''} ${pickingProxy.atom.resno || ''} ${pickingProxy.atom.atomname || ''}`.trim();
          if (label !== lastHover) { lastHover = label; setHoverInfo(label); }
        });
      }
    }).catch((err) => {
      if (!isMounted) return;
      setStatus('error');
      setErrorMsg(err.message || 'Failed to load the NGL viewer library.');
    });

    return () => {
      isMounted = false;
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
    };
  }, []);

  // Handle Loading without destroying the WebGL Context
  useEffect(() => {
    if (!loadRequest || (!loadRequest.file && !loadRequest.url && !loadRequest.text)) return;
    if (!stageRef.current) return;

    const stage = stageRef.current;
    stage.removeAllComponents();
    
    componentRef.current = null;
    highlightCompRef.current = null;
    manualHighlightCompRef.current = null;
    labelCompRef.current = null;
    sidechainCompRef.current = null;

    setStatus('loading');
    setErrorMsg('');

    const loadStructure = async () => {
      try {
        let component;
        if (loadRequest.file) {
          component = await stage.loadFile(loadRequest.file, { ext: loadRequest.file.name.split('.').pop() });
        } else if (loadRequest.text) {
          // In-memory structure text (locally generated, or fetched+validated by the parent) --
          // loaded as a Blob so no network request happens here at all.
          const blob = new Blob([loadRequest.text], { type: 'text/plain' });
          component = await stage.loadFile(blob, { ext: loadRequest.ext || 'pdb' });
        } else {
          const target = normalizeStructureSource(loadRequest.url);
          if (!target) throw new Error('No structure URL provided');
          component = target.params ? await stage.loadFile(target.url, target.params) : await stage.loadFile(target.url);
        }

        componentRef.current = component;

        if (moleculeTypeRef.current === 'organic') {
          // Explicitly color organic SDF by element
          component.addRepresentation('ball+stick', { colorScheme: 'element', multipleBond: true });
        } else {
          try { component.addRepresentation('cartoon', { color: 'residueindex', quality: 'high' }); } catch (e) {}
          try { component.addRepresentation('ball+stick', { sele: 'hetero and not water', aspectRatio: 1.1 }); } catch (e) {}
        }

        component.autoView();
        setStatus('ready');
      } catch (err) {
        setErrorMsg(err?.message || 'Failed to load structure.');
        setStatus('error');
      }
    };

    loadStructure();
  }, [loadRequest]);

  // Handle Labels
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    if (labelCompRef.current) {
      try { component.removeRepresentation(labelCompRef.current); } catch (e) {}
      labelCompRef.current = null;
    }

    if (showLabels) {
      const isOrganic = moleculeTypeRef.current === 'organic';
      const sele = isOrganic ? 'not hydrogen' : 'protein and sidechain and not hydrogen';
      try {
        labelCompRef.current = component.addRepresentation('label', {
          sele: sele,
          labelType: isOrganic ? 'format' : 'atomname',
          labelFormat: isOrganic ? '%(element)s%(index)s' : undefined,
          labelGrouping: 'atom',
          color: 0x111827,
          radius: 1.0,
          opacity: 1,
          depthTest: false,
        });
      } catch (e) {}
    }
  }, [showLabels, status]);

  // Handle Side Chains
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready' || moleculeTypeRef.current === 'organic') return;

    if (sidechainCompRef.current) {
      try { component.removeRepresentation(sidechainCompRef.current); } catch (e) {}
      sidechainCompRef.current = null;
    }

    if (sidechainStyle !== 'none') {
      try {
        sidechainCompRef.current = component.addRepresentation(sidechainStyle, {
          sele: '(protein and sidechain) or (protein and .CA)',
          color: 'element',
          multipleBond: true,
          radiusSize: sidechainStyle === 'licorice' ? 0.25 : undefined,
        });
      } catch (e) {}
    }
  }, [sidechainStyle, status]);

  // Handle Highlighting
  useEffect(() => {
    const component = componentRef.current;
    if (!component || status !== 'ready') return;

    if (highlightCompRef.current) { try { component.removeRepresentation(highlightCompRef.current); } catch (e) {} highlightCompRef.current = null; }
    if (manualHighlightCompRef.current) { try { component.removeRepresentation(manualHighlightCompRef.current); } catch (e) {} manualHighlightCompRef.current = null; }

    const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
    const man = Array.isArray(manualKeys) ? manualKeys.filter((k) => !sel.includes(k)) : [];

    if (sel.length === 0 && man.length === 0) return;

    // For organics, build a name -> raw NGL atom index lookup ONCE (using the same
    // bond-connectivity-based naming as getOrganicAtomName / the 2D SMILES viewer), so
    // selection keys like "0-C5" or "0-H5a" resolve to the correct physical atom regardless of
    // how the 3D structure's own file order happens to differ from the 2D depiction's.
    let organicNameToIndex = null;
    const getOrganicNameToIndexMap = () => {
      if (organicNameToIndex) return organicNameToIndex;
      organicNameToIndex = {};
      component.structure.eachAtom((a) => { organicNameToIndex[getOrganicAtomName(a)] = a.index; });
      return organicNameToIndex;
    };

    const buildSele = (keys) => {
      const parts = [];
      keys.forEach((k) => {
        const dashIdx = k.indexOf('-');
        if (dashIdx < 0) return;

        const ri = parseInt(k.substring(0, dashIdx), 10);
        const atomName = k.substring(dashIdx + 1);
        const resno = ri + 1;

        if (moleculeTypeRef.current === 'organic') {
          const map = getOrganicNameToIndexMap();
          if (Object.prototype.hasOwnProperty.call(map, atomName)) parts.push(`@${map[atomName]}`);
          return;
        }

        const pdbNames = [];
        Object.entries(PDB_TO_NMR).forEach(([pdb, nmr]) => { if (nmr === atomName) pdbNames.push(pdb); });

        if (atomName === 'N') pdbNames.push('N');
        else if (atomName === 'Cα') pdbNames.push('CA');
        else if (atomName === 'Cβ') pdbNames.push('CB');
        else if (atomName === "C'") pdbNames.push('C');
        else if (atomName === 'O') pdbNames.push('O');
        else {
          const match = atomName.match(/^([CNO])([αβγδεζη])(\d*)$/);
          if (match) pdbNames.push(`${match[1]}${REVERSE_GREEK[match[2]]}${match[3]}`);
        }

        if (pdbNames.length === 0) pdbNames.push(atomName);
        pdbNames.forEach((pn) => { parts.push(`${resno} and .${pn}`); });
      });

      return parts.length > 0 ? parts.join(' or ') : null;
    };

    try {
      const selSele = buildSele(sel);
      if (selSele) {
        highlightCompRef.current = component.addRepresentation('ball+stick', {
          sele: selSele, color: SELECT_COLOR_HEX, aspectRatio: 1.5, radius: 0.4,
        });
      }

      const manSele = buildSele(man);
      if (manSele) {
        manualHighlightCompRef.current = component.addRepresentation('ball+stick', {
          sele: manSele, color: MANUAL_COLOR_HEX, aspectRatio: 1.5, radius: 0.4,
        });
      }
    } catch (e) { console.warn('Highlight error:', e); }

  }, [selectedKeys, manualKeys, status]);

  const handleFileChange = useCallback((e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    setLoadRequest({ file: f, url: null, ts: Date.now() });
    e.target.value = '';
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Load local file Override</label>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors inline-flex items-center gap-2">
            📂 Local PDB/SDF
            <input type="file" accept=".pdb,.cif,.bcif,.ent,.mol2,.sdf" onChange={handleFileChange} className="hidden" />
          </label>
          {file && <span className="text-[10px] text-slate-500 max-w-[150px] truncate">{file.name}</span>}
        </div>

        <div className="flex flex-col gap-1 ml-4">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Labels</label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer h-8">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="w-4 h-4 accent-blue-600" /> Show atom names
          </label>
        </div>

        {moleculeType !== 'organic' && (
          <div className="flex flex-col gap-1 ml-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Side Chains</label>
            <select value={sidechainStyle} onChange={(e) => setSidechainStyle(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 h-8">
              <option value="none">Hidden</option>
              <option value="line">Lines (Thin)</option>
              <option value="licorice">Licorice (Thick)</option>
              <option value="ball+stick">Ball &amp; Stick</option>
              <option value="spacefill">Spacefill</option>
            </select>
          </div>
        )}
      </div>

      <div className="relative border border-slate-200 rounded-xl overflow-hidden bg-white" style={{ height }}>
        <div ref={containerRef} className="w-full h-full" />
        {hoverInfo && status === 'ready' && (
          <div className="absolute top-2 left-2 bg-white/90 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm pointer-events-none z-10">{hoverInfo}</div>
        )}
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-20">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-slate-500 font-bold">Loading structure…</p>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-20 p-4">
            <div className="text-center max-w-md">
              <p className="text-red-600 text-sm font-bold mb-1">⚠️ Failed to load structure</p>
              <p className="text-slate-500 text-xs">{errorMsg}</p>
            </div>
          </div>
        )}
        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center text-slate-400">
              <p className="text-4xl mb-2">🧬</p>
              <p className="text-sm font-bold">Waiting for structure source...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NMRMoleculeViewer;