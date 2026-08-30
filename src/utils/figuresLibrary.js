/* =========================================================================
   src/utils/figuresLibrary.js
   Shared persistence for the Publications → "Figures & Slides" builder:
   • image library (app-wide, localStorage): formulas, logos, viewer captures…
   • slide decks (per project, localStorage): a PowerPoint-like set of slides
     with image + text blocks.
   ========================================================================= */

const LIBRARY_KEY = 'labFiguresLibrary';
const deckKey = (projectId) => `labFiguresDeck_${projectId || 'global'}`;
const projectLibraryKey = (projectId) => `labFiguresLib_${projectId || 'global'}`;

// ---- active project context (kept in sync by App.jsx) -----------------------
// Lets the molecule viewer / experiment pages know which project's library an
// exported image should go to without threading a prop through every section.
let activeProjectId = null;
export const setActiveProjectId = (id) => { activeProjectId = id || null; };
export const getActiveProjectId = () => activeProjectId;

// ---- common (app-wide) library ----------------------------------------------
export const readLibrary = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
export const writeLibrary = (items) => {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items)); } catch { /* quota */ }
};

// ---- project-scoped library ---------------------------------------------------
export const readProjectLibrary = (projectId) => {
  try {
    const arr = JSON.parse(localStorage.getItem(projectLibraryKey(projectId)));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
export const writeProjectLibrary = (projectId, items) => {
  try { localStorage.setItem(projectLibraryKey(projectId), JSON.stringify(items)); } catch { /* quota */ }
};

const toEntry = (urlOrItem, label) => {
  const item = typeof urlOrItem === 'string' ? { url: urlOrItem, full: urlOrItem, label } : urlOrItem;
  return {
    id: uid('lib'),
    label: item.label || 'Figure',
    url: item.url,                    // display thumbnail
    full: item.full || item.url,      // high-resolution copy used at export
    addedAt: new Date().toISOString()
  };
};
// Accepts either (url, label) or an item object { url, full, label }.
export const addLibraryItem = (urlOrItem, label) => {
  const entry = toEntry(urlOrItem, label);
  writeLibrary([entry, ...readLibrary()]);
  return entry;
};
export const addProjectLibraryItem = (projectId, urlOrItem, label) => {
  const entry = toEntry(urlOrItem, label);
  writeProjectLibrary(projectId, [entry, ...readProjectLibrary(projectId)]);
  return entry;
};
export const removeLibraryItem = (id) => writeLibrary(readLibrary().filter((i) => i.id !== id));
export const renameLibraryItem = (id, label) =>
  writeLibrary(readLibrary().map((i) => (i.id === id ? { ...i, label } : i)));
export const removeProjectLibraryItem = (projectId, id) =>
  writeProjectLibrary(projectId, readProjectLibrary(projectId).filter((i) => i.id !== id));
export const renameProjectLibraryItem = (projectId, id, label) =>
  writeProjectLibrary(projectId, readProjectLibrary(projectId).map((i) => (i.id === id ? { ...i, label } : i)));
// Move an item between scopes (e.g. save a common figure into a project).
export const moveLibraryItem = (fromScope, toScope, projectId, id) => {
  const src = fromScope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const it = src.find((i) => i.id === id);
  if (!it) return;
  if (toScope === 'project') writeProjectLibrary(projectId, [it, ...readProjectLibrary(projectId)]);
  else writeLibrary([it, ...readLibrary()]);
  if (fromScope === 'project') writeProjectLibrary(projectId, src.filter((i) => i.id !== id));
  else writeLibrary(src.filter((i) => i.id !== id));
};

export const readDeck = (projectId) => {
  try {
    const d = JSON.parse(localStorage.getItem(deckKey(projectId)));
    return d && Array.isArray(d.slides) ? d : { slides: [] };
  } catch { return { slides: [] }; }
};
export const writeDeck = (projectId, deck) => {
  try { localStorage.setItem(deckKey(projectId), JSON.stringify(deck)); } catch { /* quota */ }
};

export const uid = (p) => `${p || 'x'}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

// Downscale an image dataURL (maxSide in px, type/quality for the target copy).
export const downscaleImage = (dataUrl, maxSide = 3000, type = 'image/png', quality = 0.92) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(dataUrl); return; }
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(type, quality));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

// Two copies for a library entry: a small PNG thumbnail for the UI (PNG keeps
// transparency for formulas/structures) and a high-resolution PNG (max 3000 px,
// enough for ~300 DPI A4 pages) used by the PDF/publication export.
export const makeLibraryImage = async (dataUrl) => ({
  url: await downscaleImage(dataUrl, 700, 'image/png', 0.92),
  full: await downscaleImage(dataUrl, 3000, 'image/png', 0.92)
});

// File/Blob → dataURL (uploaded images, clipboard blobs).
export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.readAsDataURL(blob);
  });
