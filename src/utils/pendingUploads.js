/* =========================================================================
   src/utils/pendingUploads.js
   Persistent browser-side queue of uploads that could NOT be sent to Google
   Drive (workspace token server unreachable, token expired, network error…).
   The file bytes are kept in IndexedDB (Blob/File records and data URLs are
   stored natively there), so even large raw files survive a page reload and
   are replayed automatically as soon as Drive answers again.

   Design rules:
     • Google Drive provider only — Nextcloud failures are handled elsewhere.
     • Deterministic ids (derived from name + naming context + payload tag):
       enqueuing the same file twice simply REPLACES the queued copy instead of
       duplicating it.
     • DriveUpload.jsx / driveUpload.js call enqueuePendingUpload(); the
       flush loop lives in driveUpload.js (it needs the Drive upload functions).
     • Every mutation dispatches a "lab:pending-uploads-changed" window event
       (detail { count }); every successful re-upload dispatches
       "lab:pending-uploaded" (detail { id, name, mimeType, drive, dataUrl }).
   ========================================================================= */

const IDB_NAME = 'lab-pending-upload-store';
const IDB_STORE = 'pending';
const LS_PREFIX = 'labPendingUploads_';

export const MAX_QUEUE_ITEMS = 60;
export const MAX_SINGLE_BYTES = 250 * 1024 * 1024; // 250 MB per file
export const MAX_PENDING_AGE_MS = 30 * 24 * 60 * 60 * 1000; // drop after 30 days

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
          db.createObjectStore(IDB_STORE); // keyed by record id
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

const idbGetAll = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
};

const idbCount = async () => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
};

const lsKeyOf = (id) => `${LS_PREFIX}${id}`;

const lsCount = () => {
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(LS_PREFIX) === 0) n++;
    }
  } catch { /* ignore */ }
  return n;
};

/** Fire a "lab:pending-uploads-changed" window event with the current size. */
export const notifyPendingChanged = async () => {
  if (typeof window === 'undefined') return;
  try {
    const count = await countPendingUploads();
    window.dispatchEvent(new CustomEvent('lab:pending-uploads-changed', { detail: { count } }));
  } catch { /* ignore */ }
};

/** Store one queued upload. Returns 'indexeddb' | 'localStorage' | ''. */
const storeRecord = async (record) => {
  if (!record || !record.id) return '';
  try {
    await idbPut(record.id, record);
    return 'indexeddb';
  } catch { /* localStorage fallback below (data-URL records only) */ }
  if (record.kind !== 'dataUrl' || typeof record.payload !== 'string') return '';
  try {
    if (String(record.payload).length > 1500 * 1024) return '';
    localStorage.setItem(lsKeyOf(record.id), JSON.stringify(record));
    return 'localStorage';
  } catch { return ''; }
};

/**
 * Add (or replace) a queued upload. `record`: { id, name, mimeType, payload,
 * ctx?, path?, source?, datasetId?, rootFolderId?, createdAt? } where payload
 * is a Blob/File OR a data-URL string.
 * @returns {{ queued:boolean, id?:string, where?:string, reason?:string }}
 */
export const enqueuePendingUpload = async (record) => {
  try {
    if (!record || !record.id || !record.name) return { queued: false, reason: 'invalid' };
    let approxBytes = 0;
    if (record.kind === 'file') {
      approxBytes = record.payload && typeof record.payload.size === 'number' ? record.payload.size : 0;
    } else {
      approxBytes = Math.ceil((typeof record.payload === 'string' ? record.payload.length : 0) * 0.75);
    }
    if (approxBytes > MAX_SINGLE_BYTES) return { queued: false, reason: 'too_large' };
    const existing = await idbGet(record.id).catch(() => null);
    const have = (await idbCount().catch(() => -1)) + lsCount();
    if (have >= MAX_QUEUE_ITEMS && !existing) return { queued: false, reason: 'queue_full' };
    const full = {
      kind: record.payload && typeof record.payload === 'string' ? 'dataUrl' : 'file',
      createdAt: Date.now(),
      attempts: 0,
      lastAttemptAt: 0,
      ...record
    };
    await idbDelete(record.id).catch(() => {}); // replacement semantics
    const where = await storeRecord(full);
    if (!where) return { queued: false, reason: 'storage' };
    notifyPendingChanged();
    return { queued: true, id: record.id, where };
  } catch (err) {
    console.warn('Could not queue upload:', err && err.message);
    return { queued: false, reason: 'storage' };
  }
};

/** Remove one queued upload (IndexedDB + localStorage fallback). */
export const removePendingUpload = async (id) => {
  try {
    await idbDelete(id).catch(() => {});
    try { localStorage.removeItem(lsKeyOf(id)); } catch { /* ignore */ }
    notifyPendingChanged();
  } catch { /* ignore */ }
};

/** Update the retry bookkeeping of a queued item (payload untouched). */
export const touchPendingUpload = async (id, patch) => {
  try {
    let rec = null;
    try { rec = await idbGet(id); } catch { /* ignore */ }
    if (!rec) {
      try {
        const raw = localStorage.getItem(lsKeyOf(id));
        if (raw) rec = JSON.parse(raw);
      } catch { /* ignore */ }
    }
    if (!rec) return;
    await storeRecord({ ...rec, ...(patch || {}) });
  } catch { /* ignore */ }
};

/** All queued records (payload included) — used by the flush loop. */
export const listPendingUploads = async () => {
  const out = [];
  try {
    const records = await idbGetAll();
    for (const r of records) if (r && r.id) out.push(r);
  } catch { /* IndexedDB unavailable → localStorage fallback only */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(LS_PREFIX) !== 0) continue;
      try {
        const rec = JSON.parse(localStorage.getItem(k) || 'null');
        if (rec && rec.id && !out.some((r) => r.id === rec.id)) out.push(rec);
      } catch { /* skip unreadable */ }
    }
  } catch { /* ignore */ }
  return out;
};

/** Number of uploads currently waiting for Drive. */
export const countPendingUploads = async () => {
  try {
    const n = await idbCount();
    if (n >= 0) return n + lsCount();
  } catch { /* fall through */ }
  return lsCount();
};
