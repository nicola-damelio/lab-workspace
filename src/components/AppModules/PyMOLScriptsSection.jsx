/* =========================================================================
   src/components/AppModules/PyMOLScriptsSection.jsx
   Library section for reusable PyMOL scripts. Scripts are stored in
   localStorage (utils/pymolScripts.js) and offered as a drop-down in the
   3D viewers' "Selections & PyMOL" panel.
   ========================================================================= */

import React, { useState } from 'react';
import { getPymolScripts, setPymolScript, removePymolScript } from '../../utils/pymolScripts';

const TEXTAREA_CLS = 'w-full border border-violet-300 rounded-lg p-2 text-xs font-mono outline-none focus:border-violet-500 bg-white';

export const PyMOLScriptsSection = () => {
  const [scripts, setScripts] = useState(getPymolScripts());
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [editing, setEditing] = useState(null); // name of the script being edited

  const refresh = () => setScripts(getPymolScripts());

  const saveNew = () => {
    if (!String(name || '').trim()) { alert('Give the script a name first (e.g. "Membrane setup").'); return; }
    if (!String(script || '').trim()) { alert('The script is empty — write some PyMOL commands first.'); return; }
    setPymolScript(name, script);
    refresh();
    setName('');
    setScript('');
    setEditing(null);
  };

  const startEdit = (n) => {
    setEditing(n);
    setName(n);
    setScript(scripts[n] || '');
  };

  const updateEdited = () => {
    if (!editing) return;
    if (!String(script || '').trim()) { alert('The script is empty.'); return; }
    const newName = String(name || '').trim();
    if (!newName) { alert('Give the script a name.'); return; }
    setPymolScript(newName, script);
    if (newName !== editing) removePymolScript(editing);
    refresh();
    setEditing(null);
    setName('');
    setScript('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setName('');
    setScript('');
  };

  const del = (n) => {
    if (!window.confirm(`Delete the PyMOL script "${n}"?`)) return;
    removePymolScript(n);
    if (editing === n) { setEditing(null); setName(''); setScript(''); }
    refresh();
  };

  const copy = (n) => {
    try { navigator.clipboard.writeText(scripts[n] || ''); } catch { /* ignore */ }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        <label className="block text-[10px] font-bold text-slate-500 uppercase">Saved scripts</label>
        {Object.keys(scripts).length === 0 ? (
          <p className="text-xs text-slate-400 italic">No scripts yet — write one on the right and click "Save as new script".</p>
        ) : (
          Object.entries(scripts).map(([n]) => (
            <div key={n} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
              <button type="button" onClick={() => startEdit(n)}
                className="text-left text-xs font-bold text-violet-800 hover:text-violet-950 hover:underline truncate"
                title={`Load "${n}" into the editor`}>
                🧪 {n}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => copy(n)} title="Copy to clipboard"
                  className="px-1.5 py-0.5 text-[11px] font-bold rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50">⧉</button>
                <button type="button" onClick={() => del(n)} title="Delete script"
                  className="px-1.5 py-0.5 text-[11px] font-bold rounded border border-red-300 bg-white text-red-600 hover:bg-red-50">🗑</button>
              </div>
            </div>
          ))
        )}
        <p className="text-[10px] text-slate-400 leading-snug">
          Saved scripts appear in the 3D viewers under <b>🧪 Selections &amp; PyMOL → "Load script"</b>,
          so you can apply your favourite renderings to any loaded structure.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="block text-[10px] font-bold text-slate-500 uppercase">
          {editing ? `Editing "${editing}"` : 'New script'}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Script name (e.g. Membrane setup)"
          className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:border-violet-500 bg-white"
        />
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={10}
          placeholder={'select membrane, resn POPC or resn DPPC\nshow cartoon, protein\ncolor slate, membrane\nshow sticks, membrane and name C1..C4\nset sphere_scale, 0.6, ions\nbg_color white'}
          className={TEXTAREA_CLS}
        />
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button type="button" onClick={updateEdited}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 shadow-sm">💾 Save changes</button>
              <button type="button" onClick={cancelEdit}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-slate-300 text-slate-600 hover:bg-slate-50">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={saveNew}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 shadow-sm">➕ Save as new script</button>
          )}
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">
          Supported commands: <b>select</b>, <b>show/hide</b> (cartoon · ribbon · tube · stick · sphere · surface · line),
          <b> color</b> (name/element/chain/… or a solid colour), <b>set</b> (sphere_scale, sphere_transparency,
          sphere_scale_amplitude, cartoon_loop, transparency, bg_color, …), <b>spectrum</b>, <b>bg_color</b>,
          <b> util.ray_shadows</b>. One command per line, PyMOL-style.
        </p>
      </div>
    </div>
  );
};

export default PyMOLScriptsSection;

