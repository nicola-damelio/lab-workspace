/* =========================================================================
   src/utils/pymolScripts.js
   Tiny persisted store for reusable PyMOL scripts.

   Scripts are named snippets saved by the user in the Library ("PyMOL
   Scripts" section). The 3D molecule viewers read them here to offer them in
   a drop-down inside the "Selections & PyMOL" panel. They are stored in
   localStorage because they are app-level rendering tools (not dataset data).
   ========================================================================= */

const KEY = 'labPymolScripts';

/**
 * @returns {Object<string,{script:string,comment:string}>} name -> { script, comment }
 * Legacy entries stored as a plain string are normalised to { script, comment:'' }.
 */
export const getPymolScripts = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    Object.entries(raw).forEach(([n, v]) => {
      if (typeof v === 'string') out[n] = { script: v, comment: '' };
      else if (v && typeof v === 'object' && typeof v.script === 'string') out[n] = { script: v.script, comment: String(v.comment || '') };
    });
    return out;
  } catch { return {}; }
};

/** Save (or overwrite) a named script with an optional comment. @returns {Object<string,{script:string,comment:string}>} */
export const setPymolScript = (name, script, comment = '') => {
  const all = getPymolScripts();
  const key = String(name || '').trim();
  if (!key) return all;
  all[key] = { script: String(script || ''), comment: String(comment || '') };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all;
};

/** Remove a named script. @returns {Object<string,{script:string,comment:string}>} */
export const removePymolScript = (name) => {
  const all = getPymolScripts();
  delete all[String(name || '').trim()];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all;
};
