// components/FlowCytometrySections.jsx
import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const CollapsibleSection = ({ title, icon, defaultOpen = true, children, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid ${className}`}>
      <button type="button" onClick={() => setIsOpen(!isOpen)} className={`w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 transition-colors text-left ${isOpen ? 'rounded-t-xl border-b border-slate-200' : 'rounded-xl'}`}>
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-xl shrink-0">{icon}</span>}
          <h3 className="text-lg font-bold text-slate-800 truncate">{title}</h3>
        </div>
        <svg className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && <div className="p-6">{children}</div>}
    </div>
  );
};

// =========================================================================
// FCS BINARY PARSER (Supports FCS 2.0/3.0, Float32/Int16/Int32 data)
// =========================================================================
const parseFCSFile = (buffer) => {
  const decoder = new TextDecoder();
  const readStr = (start, length) => {
    if (start + length > buffer.byteLength) return '';
    return decoder.decode(new Uint8Array(buffer, start, length)).trim();
  };

  // 1. Parse Header (58 bytes)
  const version = readStr(0, 6);
  if (!version.startsWith('FCS')) throw new Error('Not a valid FCS file format.');

  let textStart = parseInt(readStr(10, 8), 10);
  let textEnd = parseInt(readStr(18, 8), 10);
  let dataStart = parseInt(readStr(26, 8), 10);
  let dataEnd = parseInt(readStr(34, 8), 10);

  // FCS 3.0 64-bit offset fallback
  if (!textStart || !textEnd) {
    textStart = parseInt(readStr(58, 8), 10);
    textEnd = parseInt(readStr(66, 8), 10);
    dataStart = parseInt(readStr(74, 8), 10);
    dataEnd = parseInt(readStr(82, 8), 10);
  }

  if (!textStart || !textEnd || textEnd < textStart || textEnd >= buffer.byteLength) {
    throw new Error('Could not locate TEXT segment in FCS header.');
  }

  // 2. Parse TEXT Segment
  const textStr = decoder.decode(new Uint8Array(buffer, textStart, textEnd - textStart + 1));
  const textDict = {};
  
  let delimiter = textStr[0];
  if (delimiter === ' ' || !delimiter) delimiter = '/';
  
  const parts = textStr.split(delimiter).map(p => p.trim()).filter(p => p);
  
  for (let i = 0; i < parts.length - 1; i += 2) {
    const key = parts[i].toUpperCase();
    const val = parts[i + 1];
    if (key) textDict[key] = val;
  }

  const numParams = parseInt(textDict['$PAR'] || '0', 10);
  const numEvents = parseInt(textDict['$TOT'] || '0', 10);
  const dataType = (textDict['$DATATYPE'] || 'F').toUpperCase();

  if (numParams === 0 || numEvents === 0 || isNaN(numParams) || isNaN(numEvents)) {
    console.warn('FCS Parsed Keys:', Object.keys(textDict));
    throw new Error(`Could not find valid $PAR or $TOT in FCS header. (Found $PAR=${numParams}, $TOT=${numEvents}).`);
  }

  // Build params array BEFORE parsing data (Crucial for Int16/Int32 bit-depth detection)
  const params = [];
  for (let i = 1; i <= numParams; i++) {
    params.push({
      name: textDict[`$P${i}N`] || `P${i}`,
      label: textDict[`$P${i}S`] || textDict[`$P${i}N`] || `Parameter ${i}`,
      range: parseInt(textDict[`$P${i}R`] || '262144', 10),
      bits: parseInt(textDict[`$P${i}B`] || '16', 10)
    });
  }

  // 3. Parse DATA Segment
  if (!dataStart || !dataEnd || dataEnd < dataStart || dataEnd >= buffer.byteLength) {
    throw new Error('Could not locate DATA segment in FCS header.');
  }

  const dataLength = dataEnd - dataStart + 1;
  let events = null;

  const getAlignedBuffer = (byteOffset, byteLength) => {
    if (byteOffset % 4 === 0) return buffer;
    return buffer.slice(byteOffset, byteOffset + byteLength);
  };

  const alignedBuf = getAlignedBuffer(dataStart, dataLength);

  try {
    if (dataType === 'F') {
      events = new Float32Array(alignedBuf, 0, numParams * numEvents);
    } else if (dataType === 'I') {
      const bits = params[0]?.bits || 16;
      if (bits <= 16) events = new Uint16Array(alignedBuf, 0, numParams * numEvents);
      else events = new Uint32Array(alignedBuf, 0, numParams * numEvents);
    } else if (dataType === 'D') {
      events = new Float64Array(alignedBuf, 0, numParams * numEvents);
    } else {
      throw new Error(`Unsupported FCS data type: ${dataType}`);
    }
  } catch (e) {
    throw new Error(`Failed to parse DATA segment: ${e.message}`);
  }

  return { version, numParams, numEvents, params, events, textDict };
};
// Helper to extract a single channel and bin it for a histogram
const processChannelData = (fcsData, paramIndex, bins = 256) => {
  // Strict validation to prevent "Cannot read properties of undefined"
  if (!fcsData || !fcsData.events || !fcsData.numEvents || !fcsData.numParams) {
    console.error('Invalid fcsData passed to processChannelData:', fcsData);
    return null;
  }

  const { events, numParams, numEvents } = fcsData;
  if (paramIndex < 0 || paramIndex >= numParams) return null;

  const channelData = new Float32Array(numEvents);
  
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < numEvents; i++) {
    const val = events[i * numParams + paramIndex];
    channelData[i] = val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  // Calculate Median (MFI)
  const sorted = Array.from(channelData).sort((a, b) => a - b);
  const median = sorted.length % 2 === 0 
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 
    : sorted[Math.floor(sorted.length / 2)];
  
  const mean = channelData.reduce((a, b) => a + b, 0) / numEvents;

  // Bin data for histogram
  const binWidth = (max - min) / bins || 1;
  const histogram = Array(bins).fill(0);
  for (let i = 0; i < numEvents; i++) {
    let binIdx = Math.floor((channelData[i] - min) / binWidth);
    if (binIdx >= bins) binIdx = bins - 1;
    if (binIdx < 0) binIdx = 0;
    histogram[binIdx]++;
  }

  return {
    histogram: histogram.map((count, i) => ({
      x: (min + i * binWidth).toFixed(1),
      y: count
    })),
    stats: { total: numEvents, median: median.toFixed(2), mean: mean.toFixed(2), min: min.toFixed(2), max: max.toFixed(2) }
  };
};

// =========================================================================
// MAIN DATA SECTION
// =========================================================================
export const Data = ({ ctx }) => {
  const { activeTest, updateActiveTest } = ctx;
  const t = activeTest || {};

  const panel = Array.isArray(t.fcPanel) ? t.fcPanel : [];
  const updatePanel = (newPanel) => updateActiveTest({ fcPanel: newPanel });

  const populations = Array.isArray(t.fcPopulations) ? t.fcPopulations : [];
  const updatePopulations = (newPops) => updateActiveTest({ fcPopulations: newPops });

  const addChannel = () => {
    const newCh = { id: `ch_${Date.now()}`, channel: `FL${panel.length + 1}`, fluorochrome: '', antibody: '', clone: '', vendor: '' };
    updatePanel([...panel, newCh]);
  };
  const updateChannel = (id, field, value) => updatePanel(panel.map(ch => ch.id === id ? { ...ch, [field]: value } : ch));
  const removeChannel = (id) => updatePanel(panel.filter(ch => ch.id !== id));

  const addPopulation = () => {
    const newPop = { id: `pop_${Date.now()}`, name: `Population ${populations.length + 1}`, parentGate: 'None', percentParent: '', mfi: '', count: '', color: COLORS[populations.length % COLORS.length] };
    updatePopulations([...populations, newPop]);
  };
  const updatePopulation = (id, field, value) => updatePopulations(populations.map(p => p.id === id ? { ...p, [field]: value } : p));
  const removePopulation = (id) => updatePopulations(populations.filter(p => p.id !== id));

  // --- FCS IMPORT STATE ---
  const [fcsData, setFcsData] = useState(null);
  const [selectedParam, setSelectedParam] = useState(0);
  const [fcsMsg, setFcsMsg] = useState('');

  const handleFCSUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFcsMsg('Parsing FCS file...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseFCSFile(ev.target.result);
        
        // Final safety check before updating state
        if (!parsed || typeof parsed.numEvents !== 'number') {
          throw new Error('Parser returned invalid data structure.');
        }

        setFcsData(parsed);
        setSelectedParam(0);
        setFcsMsg(`✅ Loaded ${parsed.numEvents.toLocaleString()} events, ${parsed.numParams} parameters.`);
      } catch (err) {
        setFcsMsg(`⚠️ Error: ${err.message}`);
        console.error('FCS Parse Error:', err);
      }
    };
    reader.onerror = () => setFcsMsg('⚠️ Error reading file from disk.');
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // Reset input
  };

  const processedData = useMemo(() => {
    if (!fcsData) return null;
    return processChannelData(fcsData, selectedParam);
  }, [fcsData, selectedParam]);

  const addFCSAsPopulation = () => {
    if (!processedData || !fcsData) return;
    const param = fcsData.params[selectedParam];
    const newPop = {
      id: `pop_${Date.now()}`,
      name: param.label || param.name,
      parentGate: 'None',
      percentParent: '100', // Assuming whole file is this population
      mfi: processedData.stats.median,
      count: processedData.stats.total,
      color: COLORS[populations.length % COLORS.length]
    };
    updatePopulations([...populations, newPop]);
    setFcsMsg(`✅ Added "${param.name}" to populations table.`);
  };

  // --- CSV IMPORT STATE (Kept for summary tables) ---
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const handleImportPopulations = () => {
    if (!importText.trim()) { setImportMsg('⚠️ Please paste some data first.'); return; }
    try {
      const lines = importText.trim().split(/\r?\n/);
      if (lines.length < 2) throw new Error('Need at least a header row and one data row.');
      const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
      const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const findCol = (keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));
      const idxName = findCol(['population', 'name', 'gate', 'node']);
      const idxParent = findCol(['parent', 'hierarchy']);
      const idxPerc = findCol(['%', 'frequency', 'parent']);
      const idxMFI = findCol(['mfi', 'median', 'mean']);
      const idxCount = findCol(['count', 'events']);
      if (idxName === -1 && idxPerc === -1 && idxMFI === -1) throw new Error('Could not recognize headers.');

      const newPops = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map(c => c.trim().replace(/['"]/g, ''));
        if (cols.length < 2) continue;
        const name = idxName >= 0 ? cols[idxName] : `Population ${i}`;
        if (!name) continue;
        newPops.push({
          id: `pop_${Date.now()}_${i}`, name, parentGate: idxParent >= 0 ? cols[idxParent] : 'None',
          percentParent: idxPerc >= 0 ? cols[idxPerc] : '', mfi: idxMFI >= 0 ? cols[idxMFI] : '',
          count: idxCount >= 0 ? cols[idxCount] : '', color: COLORS[(populations.length + newPops.length) % COLORS.length]
        });
      }
      if (newPops.length === 0) throw new Error('No valid data rows found.');
      updatePopulations([...populations, ...newPops]);
      setImportMsg(`✅ Successfully imported ${newPops.length} populations.`);
      setImportText('');
    } catch (err) { setImportMsg(`⚠️ Error: ${err.message}`); }
  };

  return (
    <CollapsibleSection title="Flow Cytometry Data" icon="🩸" defaultOpen={true}>
      <div className="flex flex-col gap-6">
        {/* Staining Panel */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-blue-900">🧪 Staining Panel</h4>
            <button onClick={addChannel} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">+ Add Channel</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left bg-white rounded-lg overflow-hidden">
              <thead className="bg-blue-100 text-blue-800 uppercase">
                <tr><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Fluorochrome</th><th className="px-3 py-2">Antibody / Target</th><th className="px-3 py-2">Clone</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {panel.length === 0 ? (<tr><td colSpan="6" className="px-3 py-4 text-center text-slate-400 italic">No channels defined.</td></tr>) : panel.map((ch) => (
                  <tr key={ch.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5"><input type="text" value={ch.channel} onChange={e => updateChannel(ch.id, 'channel', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.fluorochrome} onChange={e => updateChannel(ch.id, 'fluorochrome', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" placeholder="e.g. FITC" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.antibody} onChange={e => updateChannel(ch.id, 'antibody', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-32" placeholder="e.g. anti-CD4" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.clone} onChange={e => updateChannel(ch.id, 'clone', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" /></td>
                    <td className="px-3 py-1.5"><input type="text" value={ch.vendor} onChange={e => updateChannel(ch.id, 'vendor', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-24" /></td>
                    <td className="px-3 py-1.5"><button onClick={() => removeChannel(ch.id)} className="text-red-500 hover:text-red-700 font-bold">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FCS RAW DATA IMPORTER */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-indigo-900">🧬 Import Raw FCS File (.fcs)</h4>
            <span className="text-[9px] bg-indigo-200 text-indigo-900 px-2 py-0.5 rounded font-bold">Parses binary event data</span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-800 font-bold px-3 py-2 rounded-lg text-xs cursor-pointer shadow-sm transition-colors">
              📄 Choose .fcs file…
              <input type="file" accept=".fcs" onChange={handleFCSUpload} className="hidden" />
            </label>
            {fcsMsg && <span className="text-xs font-bold text-indigo-900">{fcsMsg}</span>}
          </div>

          {fcsData && processedData && (
            <div className="bg-white border border-indigo-200 rounded-lg p-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-bold text-slate-600">View Parameter:</label>
                <select value={selectedParam} onChange={e => setSelectedParam(parseInt(e.target.value))} className="border border-slate-300 rounded px-2 py-1 text-xs bg-white outline-none focus:border-indigo-500">
                  {fcsData.params.map((p, i) => <option key={i} value={i}>{p.label} ({p.name})</option>)}
                </select>
                <button onClick={addFCSAsPopulation} className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">
                  ➕ Add as Population (MFI: {processedData.stats.median})
                </button>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 p-2 rounded border border-slate-200"><div className="text-[10px] text-slate-500 font-bold">Total Events</div><div className="text-sm font-black text-slate-800">{processedData.stats.total.toLocaleString()}</div></div>
                <div className="bg-slate-50 p-2 rounded border border-slate-200"><div className="text-[10px] text-slate-500 font-bold">Median (MFI)</div><div className="text-sm font-black text-indigo-700">{processedData.stats.median}</div></div>
                <div className="bg-slate-50 p-2 rounded border border-slate-200"><div className="text-[10px] text-slate-500 font-bold">Mean</div><div className="text-sm font-black text-slate-800">{processedData.stats.mean}</div></div>
                <div className="bg-slate-50 p-2 rounded border border-slate-200"><div className="text-[10px] text-slate-500 font-bold">Range</div><div className="text-sm font-black text-slate-800">{processedData.stats.min} - {processedData.stats.max}</div></div>
              </div>

              <div className="w-full h-48 bg-slate-50 rounded border border-slate-200 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={processedData.histogram} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="x" tick={{ fontSize: 10 }} interval={31} label={{ value: fcsData.params[selectedParam].label, position: 'insideBottom', offset: -5, fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                    <Tooltip formatter={(value) => [value, 'Events']} />
                    <Bar dataKey="y" fill="#6366f1" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* CSV TEXT IMPORTER (For summary tables) */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h4 className="text-sm font-bold text-sky-900">📥 Import Summary Table (CSV / Text)</h4>
            <span className="text-[9px] bg-sky-200 text-sky-900 px-2 py-0.5 rounded font-bold">Paste from FlowJo Table Editor</span>
          </div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={`Population\tCount\t%Parent\tMFI\nLymphocytes\t50000\t100\t450`} className="w-full border border-sky-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-sky-500 h-24 custom-scrollbar bg-white" />
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleImportPopulations} disabled={!importText.trim()} className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm">Import & Append to Table</button>
            {importMsg && <span className="text-xs font-bold text-sky-900">{importMsg}</span>}
          </div>
        </div>

        {/* Populations & Gating Table */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm font-bold text-emerald-900">🎯 Populations & Gating Results</h4>
            <button onClick={addPopulation} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs shadow-sm">+ Add Population</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left bg-white rounded-lg overflow-hidden">
              <thead className="bg-emerald-100 text-emerald-800 uppercase">
                <tr><th className="px-3 py-2">Population Name</th><th className="px-3 py-2">Parent Gate</th><th className="px-3 py-2">% of Parent</th><th className="px-3 py-2">MFI</th><th className="px-3 py-2">Count</th><th className="px-3 py-2">Color</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {populations.length === 0 ? (<tr><td colSpan="7" className="px-3 py-4 text-center text-slate-400 italic">No populations defined.</td></tr>) : populations.map((pop) => (
                  <tr key={pop.id} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5"><input type="text" value={pop.name} onChange={e => updatePopulation(pop.id, 'name', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-32 font-bold" /></td>
                    <td className="px-3 py-1.5"><select value={pop.parentGate} onChange={e => updatePopulation(pop.id, 'parentGate', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-28"><option value="None">None</option>{populations.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}</select></td>
                    <td className="px-3 py-1.5"><input type="number" step="0.01" value={pop.percentParent} onChange={e => updatePopulation(pop.id, 'percentParent', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="number" step="0.1" value={pop.mfi} onChange={e => updatePopulation(pop.id, 'mfi', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="number" value={pop.count} onChange={e => updatePopulation(pop.id, 'count', e.target.value)} className="border border-slate-300 rounded px-2 py-1 w-20" /></td>
                    <td className="px-3 py-1.5"><input type="color" value={pop.color} onChange={e => updatePopulation(pop.id, 'color', e.target.value)} className="w-8 h-8 rounded cursor-pointer border border-slate-300" /></td>
                    <td className="px-3 py-1.5"><button onClick={() => removePopulation(pop.id)} className="text-red-500 hover:text-red-700 font-bold">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};

export const DataAnalysis = ({ ctx }) => {
  const { activeTest } = ctx;
  const populations = Array.isArray(activeTest.fcPopulations) ? activeTest.fcPopulations : [];
  
  const chartData = populations.filter(p => p.percentParent !== '' && p.percentParent !== undefined).map(p => ({
    name: p.name, value: parseFloat(p.percentParent) || 0, fill: p.color || '#3b82f6'
  }));

  return (
    <CollapsibleSection title="Data Analysis & Visualization" icon="📊" defaultOpen={true}>
      <div className="flex flex-col gap-6">
        {chartData.length > 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <h4 className="text-sm font-bold text-slate-700 mb-4">Population Frequencies (% of Parent)</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-15} textAnchor="end" />
                <YAxis label={{ value: '% of Parent', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.fill} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-400 italic bg-slate-50 rounded-lg border border-dashed border-slate-300">
            Import an FCS file or add populations to see charts.
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const NotebookExtra = ({ ctx, checkId }) => {
  const { activeTest } = ctx;
  const t = activeTest || {};
  if (checkId === 'cond') return `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Flow Cytometry Conditions:</b> Cells: ${t.cellNumber || 'N/A'} | Live/Dead: ${t.liveDeadStain || 'N/A'} | Machine: ${t.fcMachine || 'N/A'}</p>`;
  if (checkId === 'panel') {
    const panel = Array.isArray(t.fcPanel) ? t.fcPanel : [];
    if (panel.length === 0) return '';
    let html = `<p style="font-size: 12px; color: #475569; margin-bottom: 8px;"><b>Staining Panel:</b></p><ul style="font-size: 11px; color: #64748b; margin-left: 20px;">`;
    panel.forEach(ch => { html += `<li>${ch.channel}: ${ch.fluorochrome} - ${ch.antibody} (${ch.clone})</li>`; });
    return html + `</ul>`;
  }
  if (checkId === 'gating') {
    const pops = Array.isArray(t.fcPopulations) ? t.fcPopulations : [];
    if (pops.length === 0) return '';
    let html = `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; text-align: left; background: white;"><tr style="background-color: #f1f5f9;"><th style="padding: 6px; border: 1px solid #cbd5e1;">Population</th><th style="padding: 6px; border: 1px solid #cbd5e1;">% Parent</th><th style="padding: 6px; border: 1px solid #cbd5e1;">MFI</th></tr>`;
    pops.forEach(p => { html += `<tr><td style="padding: 6px; border: 1px solid #e2e8f0; font-weight: bold; color: ${p.color};">${p.name}</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${p.percentParent || '-'}%</td><td style="padding: 6px; border: 1px solid #e2e8f0;">${p.mfi || '-'}</td></tr>`; });
    return html + `</table>`;
  }
  return '';
};

export const All = ({ ctx }) => (
  <div className="flex flex-col gap-6">
    <Data ctx={ctx} />
    <DataAnalysis ctx={ctx} />
  </div>
);

export default All;