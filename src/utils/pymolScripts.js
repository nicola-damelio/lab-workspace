/* =========================================================================
   src/utils/pymolScripts.js
   Tiny persisted store for reusable PyMOL scripts.

   Scripts are named snippets saved by the user in the Library ("PyMOL
   Scripts" section). The 3D molecule viewers read them here to offer them in
   a drop-down inside the "Selections & PyMOL" panel. They are stored in
   localStorage because they are app-level rendering tools (not dataset data).
   ========================================================================= */

const KEY = 'labPymolScripts';

/** @returns {Object<string,string>} name -> script text */
export const getPymolScripts = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
};

/** Save (or overwrite) a named script. @returns {Object<string,string>} */
export const setPymolScript = (name, script) => {
  const all = getPymolScripts();
  const key = String(name || '').trim();
  if (!key) return all;
  all[key] = String(script || '');
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all;
};

/** Remove a named script. @returns {Object<string,string>} */
export const removePymolScript = (name) => {
  const all = getPymolScripts();
  delete all[String(name || '').trim()];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return all;
};
