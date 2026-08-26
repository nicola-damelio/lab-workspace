/* =========================================================================
   blobStore.js — tiny IndexedDB blob cache.

   Used to persist large binary artifacts locally in the browser — most
   importantly the uploaded MD trajectory (.xtc/.trr/.dcd) files — so they
   survive a page reload without forcing the user onto any cloud service.

   IndexedDB stores are per-origin and per-browser: the file comes back on the
   same machine/browser. (Optional cloud sync — e.g. Firebase Storage — can be
   layered on top later for cross-device access.)
   ========================================================================= */

const DB_NAME = 'lab-app-blobs';
const STORE = 'blobs';

let dbPromise = null;

const open = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      } catch (e) { reject(e); }
    });
    // Don't keep a rejected promise forever — allow retries.
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
};

export const blobStore = {
  /** @returns {Promise<boolean>} true when the blob was stored. */
  async save(key, blob) {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch {
      return false;
    }
  },

  /** @returns {Promise<Blob|null>} */
  async load(key) {
    try {
      const db = await open();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  /** @returns {Promise<void>} */
  async remove(key) {
    try {
      const db = await open();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch { /* ignore */ }
  },
};
