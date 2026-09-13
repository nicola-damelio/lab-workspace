import { getDriveToken, uploadLocalFile, dataUrlToBlob, cloudBackendAvailable, getDriveRootName } from './driveUpload';
import { sanitizeSlug, projectImagesFolderPath } from './driveNaming';
import { getCloudProvider, isNextcloudUrl, ncFetchBlob, ncUploadFile } from './nextcloud';

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

// ---- in-memory mirrors of the figure libraries -------------------------------
// The lists always live in memory FIRST. localStorage is only a best-effort
// offline cache: when it is full (~5 MB, shared with the dataset payload) a
// write throws silently, which used to make "the image is not in the library"
// and blocks further imports. With the in-memory copy the library keeps working
// for the session and the real images are stored on Google Drive anyway.
let memCommon = null;
const memProjects = new Map(); // storage key -> items

const loadLS = (k) => {
  try {
    const arr = JSON.parse(localStorage.getItem(k));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
const saveLS = (k, items) => {
  try { localStorage.setItem(k, JSON.stringify(items)); } catch { /* quota full — memory keeps the copy */ }
};
const memCommonList = () => {
  if (memCommon === null) memCommon = loadLS(LIBRARY_KEY);
  return memCommon;
};
const memProjectList = (projectId) => {
  const k = projectLibraryKey(projectId);
  if (!memProjects.has(k)) memProjects.set(k, loadLS(k));
  return memProjects.get(k);
};

// ---- active project context (kept in sync by App.jsx) -----------------------
// Lets the molecule viewer / experiment pages know which project's library an
// exported image should go to without threading a prop through every section.
let activeProjectId = null;
export const setActiveProjectId = (id) => { activeProjectId = id || null; };
export const getActiveProjectId = () => activeProjectId;

// ---- common (app-wide) library ----------------------------------------------
export const readLibrary = () => memCommonList();
export const writeLibrary = (items) => {
  memCommon = Array.isArray(items) ? items : [];
  saveLS(LIBRARY_KEY, memCommon);
};

// ---- project-scoped library ---------------------------------------------------
export const readProjectLibrary = (projectId) => memProjectList(projectId);
export const writeProjectLibrary = (projectId, items) => {
  const k = projectLibraryKey(projectId);
  memProjects.set(k, Array.isArray(items) ? items : []);
  saveLS(k, memProjects.get(k));
};

// True when localStorage is currently writable (quota NOT full). Used by the
// upload flows to tell the user whether the in-session library list will also
// survive a reload (it always works in memory, images are on Drive either way).
export const localStorageHealthy = () => {
  try {
    const k = `labProbe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch { return false; }
};

const toEntry = (urlOrItem, label) => {
  const item = typeof urlOrItem === 'string' ? { url: urlOrItem, full: urlOrItem, label } : urlOrItem;
  return {
    id: uid('lib'),
    label: item.label || 'Figure',
    url: item.url,                    // display thumbnail (kept small)
    full: item.full || item.url,      // high-resolution copy — Google Drive URL when uploaded
    src: item.src || null,            // { testId, testName, elementLabel } -> link back to the original graph
    canvasData: item.canvasData || null, // Image Builder canvas snapshot (editable) — saved/recalled canvases
    drive: !!item.drive,              // true when a Drive copy exists
    driveUrl: item.driveUrl || null,  // Drive web link to the stored image
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
// Collects every project-scoped library as { projectId: [...] } (memory first,
// localStorage as the fallback for scopes that were never touched in-session).
export const readAllProjectLibraries = () => {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('labFiguresLib_')) {
        const pid = k.slice('labFiguresLib_'.length);
        out[pid] = memProjects.has(k) ? memProjects.get(k) : loadLS(k);
      }
    }
  } catch { /* ignore */ }
  for (const [k, items] of memProjects) {
    const pid = k.startsWith('labFiguresLib_') ? k.slice('labFiguresLib_'.length) : k;
    out[pid] = items;
  }
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
  // Nextcloud files need the configured Basic auth — plain <img>/fetch would 401.
  if (isNextcloudUrl(s)) {
    try {
      const blob = await ncFetchBlob(s);
      if (blob && blob.size > 0) return await blobToDataUrl(blob);
    } catch { /* keep the original URL */ }
    return s;
  }
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
// SVG dataURLs are pure vectors: downscaling them into a raster canvas would
// destroy sharpness, so they are returned untouched. When `forceReencode` is
// true the image is always drawn to a canvas and re-encoded with the requested
// type/quality (used to convert fully-opaque images to compact JPEG even when
// they are already smaller than maxSide).
export const downscaleImage = (dataUrl, maxSide = 3000, type = 'image/png', quality = 0.92, forceReencode = false) => {
  if (typeof dataUrl === 'string' && (dataUrl.startsWith('data:image/svg+xml') || dataUrl.includes('<svg'))) {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (!forceReencode && scale >= 1) { resolve(dataUrl); return; }
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(type, quality));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// Two copies for a library entry: a small thumbnail for the UI and a
// high-resolution version used by the PDF/publication export.
// SVGs stay vector (not converted to PNG raster), while external (Drive)
// sources are first resolved into self-contained dataURLs.
export const makeLibraryImage = async (dataUrl) => {
  const src = await resolveImageToDataUrl(dataUrl);
  const isSvg = typeof src === 'string' && (src.startsWith('data:image/svg+xml') || src.includes('<svg'));
  if (isSvg) {
    return { url: src, full: src, isSvg: true };
  }
  return {
    url: await downscaleImage(src, 700, 'image/png', 0.92),
    full: await downscaleImage(src, 3000, 'image/png', 0.92)
  };
};

// Detect whether a raster dataURL has any (semi-)transparent pixel, by sampling
// a tiny downscaled copy. Transparent images must stay PNG; fully opaque ones
// (photos, most screenshots) can be safely re-encoded as JPEG — dramatically
// smaller in localStorage.
const hasTransparency = (dataUrl) =>
  new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = Math.max(1, Math.min(72, img.naturalWidth || img.width || 1));
          const h = Math.max(1, Math.min(72, img.naturalHeight || img.height || 1));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) { resolve(false); return; }
          ctx.drawImage(img, 0, 0, w, h);
          const px = ctx.getImageData(0, 0, w, h).data;
          for (let i = 3; i < px.length; i += 4) {
            if (px[i] < 250) { resolve(true); return; }
          }
          resolve(false);
        } catch { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = dataUrl;
    } catch { resolve(false); }
  });

// Compact library entry for PC-uploaded image files. The generic
// makeLibraryImage stores a PNG "full" copy up to 3000px, which for a normal
// photo is several MB of base64 — it silently blows the localStorage quota and
// the item never appears. Here photos are re-encoded as JPEG and the copies are
// capped, so ordinary uploads always fit while logos/plots keep transparency.
export const makeUploadImage = async (dataUrl) => {
  const src = await resolveImageToDataUrl(dataUrl);
  const isSvg = typeof src === 'string' && (src.startsWith('data:image/svg+xml') || src.includes('<svg'));
  if (isSvg) {
    return { url: src, full: src, isSvg: true };
  }
  const keepAlpha = await hasTransparency(src);
  const fullType = keepAlpha ? 'image/png' : 'image/jpeg';
  const thumbType = keepAlpha ? 'image/png' : 'image/jpeg';
  // Opaque images are re-encoded as JPEG even when they are smaller than the
  // cap (forceReencode) — a medium PNG screenshot can still be >1 MB.
  return {
    url: await downscaleImage(src, 600, thumbType, keepAlpha ? 0.9 : 0.82, !keepAlpha),
    full: await downscaleImage(src, 2000, fullType, keepAlpha ? 0.92 : 0.85, !keepAlpha)
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

// Tiny display thumbnail (≤ 240 px) kept locally so the library grid works
// offline and the browser storage / dataset payload stay small — the real
// high-resolution pixels live on Google Drive.
const figureThumb = async (dataUrl) => {
  const keepAlpha = await hasTransparency(dataUrl);
  const type = keepAlpha ? 'image/png' : 'image/jpeg';
  return downscaleImage(dataUrl, 240, type, keepAlpha ? 0.9 : 0.8, !keepAlpha);
};

// Persist one figure into the image library with the REAL image on Google Drive:
//   • dataUrl          – self-contained high-resolution source (PNG/JPEG/SVG)
//   • scope/projectId  – 'project' → that project's library, 'common' → general
//   • projectName      – Drive folder name used for <dataset>/projects/<project>/images
//   • updateId         – replace THAT entry in place (no new entry)
//   • insertIfMissing  – false = an unknown updateId is a FAILURE, not a new
//     entry. The automatic figure re-capture passes false: when the entry it
//     came from is gone, inserting a copy per attempt is what filled the image
//     library with hundreds of duplicates of the same figure.
// Only a small local thumbnail + metadata are kept in the browser (the library
// list is memory-first and localStorage is a best-effort cache, so even a full
// 5 MB quota cannot block an import). Returns { entry, drive, updated, missing }.
export const publishLibraryFigure = async ({ scope = 'common', projectId = null, projectName = '', dataUrl, label = 'Figure', src = null, canvasData = null, updateId = null, insertIfMissing = true }) => {
  const srcData = await resolveImageToDataUrl(dataUrl);
  const isSvg = typeof srcData === 'string' && (srcData.startsWith('data:image/svg+xml') || srcData.includes('<svg'));
  // High-resolution copy (uploaded to Drive / kept as fallback): capped raster,
  // vector SVGs stay untouched.
  let hi = srcData;
  if (!isSvg) {
    const keepAlpha = await hasTransparency(srcData);
    hi = await downscaleImage(srcData, 2400, keepAlpha ? 'image/png' : 'image/jpeg', keepAlpha ? 0.92 : 0.88, !keepAlpha);
  }
  let drive = null;
  if (cloudBackendAvailable() && hi && String(hi).startsWith('data:')) {
    drive = await uploadFigureToDrive({ full: hi, label, projectName }).catch(() => null);
  }
  // The app must be able to fetch the real pixels back:
  //  • Google Drive → the driveUrl (file id is resolved with the OAuth token)
  //  • Nextcloud   → the WebDAV URL (resolved with Basic auth); driveUrl keeps
  //    the human "share/web" link.
  const ncMode = getCloudProvider() === 'nextcloud';
  const srcFull = drive && drive.id
    ? (ncMode ? (drive.url || drive.driveUrl || hi) : (drive.driveUrl || hi))
    : hi;
  const humanUrl = drive && drive.id ? (drive.driveUrl || (ncMode ? srcFull : null)) : null;
  const url = isSvg ? srcData : await figureThumb(srcData);
  const full = isSvg ? srcData : srcFull;
  const item = { url, full, label, src, canvasData, drive: !!drive, driveUrl: humanUrl };
  // `updateId` patches an EXISTING entry in place instead of adding a copy.
  // Used by the Image Builder when it re-saves a canvas that was opened from the
  // library: the project page links to that entry id, so the id must not change
  // (and the "Saved canvases" list must not fill up with duplicates of the same
  // figure). Unknown id → normal insert.
  // `updateId` patches an EXISTING entry in place instead of adding a copy.
  // Used by the Image Builder when it re-saves a canvas that was opened from the
  // library: the project page links to that entry id, so the id must not change
  // (and the "Saved canvases" list must not fill up with duplicates of the same
  // figure). Unknown id → normal insert, unless the caller asked for the strict
  // behaviour (`insertIfMissing: false`), which is what the automatic
  // re-capture of a figure uses.
  if (updateId) {
    const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
    const prev = list.find((i) => i.id === updateId);
    if (prev) {
      const updated = { ...prev, ...item, id: prev.id, addedAt: prev.addedAt, updatedAt: new Date().toISOString() };
      const next = list.map((i) => (i.id === updateId ? updated : i));
      if (scope === 'project') writeProjectLibrary(projectId, next);
      else writeLibrary(next);
      return { entry: updated, drive, driveUrl: humanUrl, updated: true, missing: false };
    }
    if (insertIfMissing === false) {
      // The entry the caller asked to update is GONE. Do not add a copy: the
      // caller reports it, the figure already in the library is left alone.
      return { entry: null, drive: null, driveUrl: null, updated: false, missing: true };
    }
  }
  const entry = scope === 'project'
    ? addProjectLibraryItem(projectId, item)
    : addLibraryItem(item);
  return { entry, drive, driveUrl: humanUrl, updated: false, missing: !!updateId };
};

/* ─────────────────────────────────────────────────────────────────────────────
   DUPLICATES LEFT BY A RUNAWAY RE-CAPTURE

   The automatic re-capture ("🔄 Recapture automatically" of the Image Builder)
   REPLACES the library entry a figure came from. A version of that flow retried
   a figure every 600 ms and inserted a NEW entry on every attempt whose update
   failed, so one click could leave hundreds of copies of the same figure in the
   library. publishLibraryFigure refuses those inserts now (insertIfMissing:
   false); these three helpers clean up what a previous run left behind, and are
   only ever called from an explicit click in the Image Builder.
   ──────────────────────────────────────────────────────────────────────────── */
// Two copies are considered the SAME figure when they carry the same label and
// the same origin stamp (experiment + condition + element), and they were added
// within this window: a runaway loop writes its copies seconds apart, while a
// user working on one figure over days/weeks does not.
const RECAPTURE_DUP_WINDOW_MS = 10 * 60 * 1000;
// …and they must be at least this many. Two copies are a normal re-do.
const RECAPTURE_DUP_MIN = 3;

const duplicateKeyOf = (i) => [
  (i && i.label) || '',
  (i && i.src && i.src.testId) || '',
  (i && i.src && i.src.elementKey) || '',
  (i && i.src && i.src.instanceName) || ''
].join('|');

const addedMsOf = (i) => {
  const t = Date.parse((i && (i.addedAt || i.updatedAt)) || '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * Groups of copies that a runaway re-capture left in the libraries of this
 * workspace: `[{ scope, projectId, label, keepId, removeIds, count }]`.
 * Nothing is removed here — the Image Builder shows the count and only the
 * user's click calls removeRecaptureDuplicates().
 */
export const findRecaptureDuplicates = () => {
  const out = [];
  const scan = (scope, projectId, items) => {
    const byKey = new Map();
    (items || []).forEach((i) => {
      if (!i || !i.id) return;
      const k = duplicateKeyOf(i);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(i);
    });
    byKey.forEach((list, key) => {
      if (list.length < RECAPTURE_DUP_MIN) return;
      const sorted = list.slice().sort((a, b) => addedMsOf(b) - addedMsOf(a)); // newest first
      const newest = sorted[0];
      const inside = sorted.slice(1).filter((i) => addedMsOf(newest) - addedMsOf(i) <= RECAPTURE_DUP_WINDOW_MS);
      if (inside.length < RECAPTURE_DUP_MIN - 1) return;
      out.push({
        scope,
        projectId: projectId || null,
        key,
        label: newest.label || 'figure',
        keepId: newest.id,
        removeIds: inside.map((i) => i.id),
        count: inside.length
      });
    });
  };
  try { scan('common', null, readLibrary()); } catch { /* ignore */ }
  try {
    Object.entries(readAllProjectLibraries()).forEach(([pid, items]) => scan('project', pid, items));
  } catch { /* ignore */ }
  return out;
};

/** Total number of duplicate copies findRecaptureDuplicates() would remove. */
export const countRecaptureDuplicates = () => findRecaptureDuplicates().reduce((n, g) => n + g.count, 0);

/** Remove them (keeps the NEWEST copy of each figure). Returns { removed, groups }. */
export const removeRecaptureDuplicates = () => {
  const groups = findRecaptureDuplicates();
  let removed = 0;
  groups.forEach((g) => {
    const ids = new Set(g.removeIds);
    const list = g.scope === 'project' ? readProjectLibrary(g.projectId) : readLibrary();
    const next = list.filter((i) => !ids.has(i.id));
    removed += list.length - next.length;
    if (g.scope === 'project') writeProjectLibrary(g.projectId, next);
    else writeLibrary(next);
  });
  return { removed, groups: groups.length };
};

// Upload a high-resolution figure copy to the active cloud provider under the
// canonical project image directory:
//   <Lab Workspace>/<dataset>/projects/<project>/images/<file>
// (projects/_unassigned/images when the figure has no project). The folder is
// decided by the explicit PATH below — for Google Drive AND Nextcloud — so a
// figure never lands in a stray <dataset>/<project> folder beside the canonical
// projects container. SVG figures keep their vector form; raster figures keep
// their actual type (PNG/JPEG/WebP…). Returns the upload result (Drive-like
// { id, name, driveUrl }) or null when the provider is not available / the
// source is not a self-contained data URL.
export const uploadFigureToDrive = async ({ full, label = 'figure', projectName = '' }) => {
  if (!cloudBackendAvailable() || !full) return null;
  const src = String(full);
  if (src.indexOf('data:') !== 0) return null;
  const mime = String((/^data:([^;,]+)/.exec(src) || [])[1] || '').toLowerCase();
  const isSvg = mime === 'image/svg+xml' || src.includes('<svg');
  const extByMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
  const ext = isSvg ? 'svg' : (extByMime[mime] || 'png');
  const base = sanitizeSlug(label) || 'figure';

  // ── Nextcloud ──────────────────────────────────────────────────────────────
  if (getCloudProvider() === 'nextcloud') {
    const parts = ['Lab Workspace'];
    const ds = getDriveRootName();
    if (ds) parts.push(sanitizeSlug(ds));
    // Canonical location, INSIDE the projects container:
    //   <dataset>/projects/<project>/images (/_unassigned when no project).
    parts.push(...projectImagesFolderPath(projectName));
    try {
      return await ncUploadFile({
        parts,
        name: `${base}.${ext}`,
        mimeType: isSvg ? 'image/svg+xml' : (mime || 'image/png'),
        file: src
      });
    } catch (err) {
      console.warn('Figure → Nextcloud upload failed:', err && err.message);
      return null;
    }
  }

  // ── Google Drive ──────────────────────────────────────────────────────────
  try {
    // The EXPLICIT path picks the folder for both providers, so the figure
    // always goes to <dataset>/projects/<project>/images (only the Drive file
    // registry still needs the naming context: future project renames move the
    // file and its folder with the project).
    const ctx = { section: 'images' };
    if (projectName) ctx.project = projectName;
    return await uploadLocalFile({
      name: `${base}.${ext}`,
      mimeType: isSvg ? 'image/svg+xml' : (mime || 'image/png'),
      file: dataUrlToBlob(src),
      path: projectImagesFolderPath(projectName),
      ctx
    });
  } catch (err) {
    console.warn('Figure → Drive upload failed:', err && err.message);
    return null;
  }
};
