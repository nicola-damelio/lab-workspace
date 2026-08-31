/* =========================================================================
   src/utils/pdbStore.js
   Browser storage for large structure (PDB) texts that must NOT bloat the
   persisted dataset object (HADDOCK cluster PDBs can be several hundred KB
   each and quickly exceed the ~5 MB localStorage quota).

   Two namespaces (key prefixes match the previous localStorage keys so
   already-imported data keeps working):
     labDockingStructures_<testId>  → 8_seletopclusts cluster structures,
                                      shown in the 3D viewer.
     labDockingMolecules_<testId>   → "molecules to be docked" (from
                                      raw_input.toml), shown in Experimental
                                      Conditions — deliberately never fed to
                                      the 3D viewer.

   IndexedDB is tried first (it handles multi-MB values easily); if it is
   unavailable or full we fall back to localStorage; if that fails too the
   caller is told (''), so the UI can report honestly instead of claiming a
   structure was saved when it was not.
   ========================================================================= */

const IDB_NAME = 'lab-pdb-store';
const IDB_STORE = 'blobs';

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('indexedDB is not available'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    // Let a later call retry after a transient failure.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
};

const idbGet = async (key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
};

const idbPut = async (key, value) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('indexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('indexedDB write aborted'));
    } catch (err) {
      reject(err);
    }
  });
};

const idbDelete = async (key) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('indexedDB delete failed'));
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Store a JSON-serializable value under `key`.
 * @returns {'indexeddb'|'localStorage'|''} where '' means it could not be
 *          stored anywhere (the caller should surface a warning).
 */
export const storeJson = async (key, value) => {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return '';
  }
  try {
    await idbPut(key, json);
    return 'indexeddb';
  } catch { /* fall through to localStorage */ }
  try {
    localStorage.setItem(key, json);
    return 'localStorage';
  } catch { /* fall through */ }
  return '';
};

/** Load a value previously stored with storeJson (or plain localStorage). */
export const loadJson = async (key) => {
  let raw = null;
  try {
    raw = await idbGet(key);
  } catch {
    raw = null;
  }
  if (raw == null) {
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Remove a stored value (both backends). */
export const deleteJson = async (key) => {
  try {
    await idbDelete(key);
  } catch { /* ignore */ }
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
};
