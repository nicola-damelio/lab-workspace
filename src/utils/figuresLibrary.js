/* =========================================================================
   src/utils/figuresLibrary.js
   Shared persistence for the Publications → "Figures & Slides" builder:
   • image library (app-wide, localStorage): formulas, logos, viewer captures…
   • slide decks (per project, localStorage): a PowerPoint-like set of slides
     with image + text blocks.
   ========================================================================= */

const LIBRARY_KEY = 'labFiguresLibrary';
const deckKey = (projectId) => `labFiguresDeck_${projectId || 'global'}`;

export const readLibrary = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(LIBRARY_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
export const writeLibrary = (items) => {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items)); } catch { /* quota */ }
};
export const addLibraryItem = (url, label = 'Figure') => {
  const items = readLibrary();
  const item = { id: 'lib_' + Date.now() + Math.random().toString(16).slice(2), label: label || 'Figure', url, addedAt: new Date().toISOString() };
  writeLibrary([item, ...items]);
  return item;
};
export const removeLibraryItem = (id) => writeLibrary(readLibrary().filter((i) => i.id !== id));
export const renameLibraryItem = (id, label) =>
  writeLibrary(readLibrary().map((i) => (i.id === id ? { ...i, label } : i)));

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

// Downscale an image dataURL so library entries stay small (max side ~1600 px).
export const downscaleImage = (dataUrl, maxSide = 1600, type = 'image/png', quality = 0.92) =>
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

// File/Blob → dataURL (uploaded images, clipboard blobs).
export const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.readAsDataURL(blob);
  });
