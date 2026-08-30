import { getDriveToken } from './driveUpload';

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

// ---- full snapshot helpers (for HTML save / weekly Drive backups) -------------
// Collects every project-scoped library found in localStorage as { projectId: [...] }.
export const readAllProjectLibraries = () => {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('labFiguresLib_')) {
        const pid = k.slice('labFiguresLib_'.length);
        try { out[pid] = JSON.parse(localStorage.getItem(k) || '[]'); } catch { out[pid] = []; }
      }
    }
  } catch { /* ignore */ }
  return out;
};
// Writes a snapshot ({ common, projects }) back to localStorage (used by "Load HTML").
export const restoreLibraryFromSnapshot = (snap) => {
  if (!snap) return;
  try {
    if (Array.isArray(snap.common)) writeLibrary(snap.common);
    if (snap.projects && typeof snap.projects === 'object') {
      Object.entries(snap.projects).forEach(([pid, items]) => {
        writeProjectLibrary(pid, Array.isArray(items) ? items : []);
      });
    }
  } catch { /* ignore */ }
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

// Extract the Google Drive file id from any Drive/thumbnail URL.
const driveFileIdFromUrl = (url) => {
  const u = String(url || '');
  const m = u.match(/\/file\/d\/([^/?]+)/) || u.match(/[?&]id=([^&#]+)/) || u.match(/\/d\/([^/?]+)/) || u.match(/thumbnail\?id=([^&]+)/);
  return m && m[1] ? m[1] : null;
};

// Turn an external image URL (typically a Google Drive link, which often needs
// the token and cannot be drawn onto a canvas) into a self-contained dataURL.
// Drive private files are fetched through the Drive API with the auth token;
// anything else is fetched as a plain blob. On failure the original URL is
// returned so the <img> still gets a chance to render.
export const resolveImageToDataUrl = async (src) => {
  const s = String(src || '');
  if (s.startsWith('data:image/')) return s;
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const fid = driveFileIdFromUrl(s);
    const token = getDriveToken();
    if (fid && token) {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
      if (res && res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) return await blobToDataUrl(blob);
      }
    }
    const res2 = await fetch(s, { mode: 'cors' });
    if (res2 && res2.ok) {
      const blob = await res2.blob();
      if (blob && blob.size > 0) return await blobToDataUrl(blob);
    }
  } catch { /* keep the original URL */ }
  return s;
};

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
// External (Drive) sources are first resolved into self-contained dataURLs so
// the images never end up as "empty" files that require a token to display.
export const makeLibraryImage = async (dataUrl) => {
  const src = await resolveImageToDataUrl(dataUrl);
  return {
    url: await downscaleImage(src, 700, 'image/png', 0.92),
    full: await downscaleImage(src, 3000, 'image/png', 0.92)
  };
};

// File/Blob → dataURL (uploaded images, clipboard blobs).
export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.readAsDataURL(blob);
  });
