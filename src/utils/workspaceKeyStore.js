/* =========================================================================
   src/utils/workspaceKeyStore.js
   TOUT CE QUI VIVAIT DANS LE NAVIGATEUR part aussi sur le Drive.

   L'application rangeait une partie de son état dans le navigateur (localStorage) :
   publications des scientifiques, bibliothèque de figures, éléments étoilés,
   presets de plaques, réglages divers… Résultat : deux postes n'affichaient pas
   la même chose, et vider le navigateur effaçait des données qui n'existaient
   nulle part ailleurs.

   Ce module dépose ces entrées dans UN fichier du Drive, à côté de l'état de
   l'espace de travail (voir workspaceDrive.js) :

       Lab Workspace/_workspace/keys.json
       { kind, at, keys: { "<clé>": { v: <valeur>, at: <date> } } }

   Règles, choisies pour qu'une synchronisation ne puisse jamais DÉTRUIRE un
   travail local :

     • seules les clés de l'application sont concernées (elles commencent par
       « lab ») et les clés SECRÈTES ou propres à un appareil sont exclues
       (jetons Google/Nextcloud, session, file d'attente d'envois…) ;
     • une clé ABSENTE en local est adoptée telle quelle ;
     • une clé présente des deux côtés est adoptée seulement si la copie du
       Drive est PLUS RÉCENTE (horodatage par clé, tenu par l'observateur
       ci-dessous) ;
     • rien n'est jamais supprimé du navigateur, et un envoi en échec n'empêche
       jamais l'application de fonctionner (best-effort).
   ========================================================================= */

import {
  uploadWorkspaceJson, downloadWorkspaceJsonText, workspaceBackendReady
} from './workspaceDrive';

/** Marque du fichier ET clé des horodatages locaux. */
export const KEY_STATE_KIND = 'lab-workspace/browser-keys';
export const KEY_SYNC_META_KEY = 'labKeySyncMeta';
export const KEY_STATE_FILE = 'keys.json';
export const WORKSPACE_KEYS_DIR = '_workspace';
export const MAX_KEY_STATE_BYTES = 8 * 1024 * 1024;

/** Préfixes des clés de l'application. */
export const APP_KEY_PREFIXES = ['lab', 'Lab'];
/** Clés JAMAIS synchronisées : secrets, session, appareil, ou déjà portées par
 *  l'état de l'espace de travail / un payload de dataset. */
export const UNSYNCED_KEYS = [
  'labDriveAccessToken', 'labDriveAccessTokenExpiresAt',       // jeton Google
  'labNcAppPassword', 'labNcServer', 'labNcUser',              // Nextcloud
  'labServerAdminToken', 'labAdminToken', 'labCurrentUser',    // sécurité
  'labFirebaseCustomToken', 'labAuthSession',
  'labDriveMirror', 'labKeySyncMeta',                          // déjà synchronisés
  'labDriveFolderId', 'labDriveFolderDatasetId', 'labDriveFolderName',
  'labPendingUploads', 'labDriveFileRegistry', 'labDeletedProjects',
  'labWorkspace_projects', 'labWorkspace_deletedProjects'
];

/** Cette clé doit-elle voyager ? */
export const isSyncableKey = (key) => {
  const k = String(key || '');
  if (!k) return false;
  if (UNSYNCED_KEYS.indexOf(k) !== -1) return false;
  if (k.indexOf(KEY_SYNC_META_KEY) === 0) return false;
  return APP_KEY_PREFIXES.some((p) => k.indexOf(p) === 0);
};

/** Toutes les clés synchronisables présentes dans ce navigateur. */
export const syncableKeysIn = (storage = null) => {
  const out = [];
  try {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return out;
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (isSyncableKey(k)) out.push(String(k));
    }
  } catch { /* stockage indisponible */ }
  return out;
};

/* ── Horodatage par clé (qui a écrit quoi, et quand) ───────────────────────── */

export const readKeyMeta = (storage = null) => {
  try {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = ls ? ls.getItem(KEY_SYNC_META_KEY) : '';
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

const writeKeyMeta = (meta, storage = null) => {
  try {
    const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (ls) ls.setItem(KEY_SYNC_META_KEY, JSON.stringify(meta || {}));
  } catch { /* quota */ }
};

let observerInstalled = false;

/**
 * Suivre les écritures du navigateur : à chaque `setItem` d'une clé
 * synchronisable, l'horodatage de cette clé est mis à jour. Branché une seule
 * fois (idempotent). Sans cet observateur, deux postes ne pourraient pas savoir
 * laquelle des deux copies est la plus récente.
 */
export const installKeyObserver = () => {
  if (observerInstalled) return false;
  observerInstalled = true;
  try {
    /* Le vrai Storage du navigateur porte ses méthodes sur son prototype ; un
       stockage de test (ou un bouchon) les porte souvent sur l'objet lui-même :
       on patche celui qui les fournit. */
    let target = localStorage;
    try {
      const proto = Object.getPrototypeOf(localStorage);
      if (proto && typeof proto.setItem === 'function') target = proto;
    } catch { /* prototype inaccessible → l'objet lui-même */ }
    const original = target.setItem;
    const originalRemove = target.removeItem;
    if (typeof original !== 'function') return false;
    target.setItem = function patched(key, value) {
      const res = original.call(this, key, value);
      try {
        if (this && this !== localStorage) return res;   // sessionStorage : appareil, pas espace de travail
        if (isSyncableKey(key)) {
          const meta = readKeyMeta();
          meta[String(key)] = Date.now();
          writeKeyMeta(meta);
          notifyKeysChanged();
        }
      } catch { /* la mesure du temps ne doit jamais casser une écriture */ }
      return res;
    };
    target.removeItem = function patchedRemove(key) {
      const res = typeof originalRemove === 'function' ? originalRemove.call(this, key) : undefined;
      try {
        if (this && this !== localStorage) return res;
        if (isSyncableKey(key)) {
          const meta = readKeyMeta();
          delete meta[String(key)];
          writeKeyMeta(meta);
          notifyKeysChanged();
        }
      } catch { /* ignore */ }
      return res;
    };
    return true;
  } catch { return false; }
};

/** Événement émis (au plus une fois par seconde) quand une clé change. Une
 *  rafale d'écritures est donc annoncée UNE fois — mais la DERNIÈRE écriture
 *  est toujours annoncée (un envoi différé suit la rafale), sinon une
 *  modification faite juste après une autre ne partirait jamais. */
export const KEYS_CHANGED_EVENT = 'lab:local-keys-changed';
let lastNotify = 0;
let trailingNotify = null;

const dispatchKeysChanged = () => {
  lastNotify = Date.now();
  try { window.dispatchEvent(new CustomEvent(KEYS_CHANGED_EVENT)); } catch { /* hors navigateur */ }
};

export const notifyKeysChanged = () => {
  const since = Date.now() - lastNotify;
  if (since >= 1000) {
    if (trailingNotify) { clearTimeout(trailingNotify); trailingNotify = null; }
    dispatchKeysChanged();
    return;
  }
  if (trailingNotify) return;
  trailingNotify = setTimeout(() => {
    trailingNotify = null;
    dispatchKeysChanged();
  }, 1000 - since + 5);
};

/* ── Photographie des clés (pure) ─────────────────────────────────────────── */

/**
 * Ce que ce navigateur déposerait sur le Drive : `{ clé: { v, at } }`.
 * PUR (les valeurs sont lues par l'appelant) : c'est ce qui permet de tester
 * toutes les règles de fusion hors navigateur.
 * @param {Object<string,string>} values valeur brute par clé
 * @param {Object<string,number>} meta   horodatage par clé
 */
export const buildKeyState = ({ values = {}, meta = {}, at = new Date().toISOString() } = {}) => {
  const keys = {};
  Object.keys(values || {}).forEach((key) => {
    if (!isSyncableKey(key)) return;
    const v = values[key];
    if (v === undefined || v === null) return;
    keys[key] = { v: String(v), at: Number((meta || {})[key]) || 0 };
  });
  return { kind: KEY_STATE_KIND, v: 1, at, keys };
};

/** Relire le fichier du Drive : toujours un objet, jamais une exception. */
export const parseKeyState = (raw) => {
  let data = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try { data = JSON.parse(s); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  if (data.kind && data.kind !== KEY_STATE_KIND) return null;   // fichier étranger
  const keys = {};
  Object.entries(data.keys && typeof data.keys === 'object' ? data.keys : {}).forEach(([key, entry]) => {
    if (!isSyncableKey(key)) return;                            // jamais de clé secrète importée
    if (!entry || entry.v === undefined || entry.v === null) return;
    keys[key] = { v: String(entry.v), at: Number(entry.at) || 0 };
  });
  return { kind: KEY_STATE_KIND, v: 1, at: String(data.at || ''), keys };
};

/**
 * Ce qu'il faut ADOPTER du Drive, et la photographie à y déposer.
 * L'horodatage par clé arbitre : la copie la plus récente gagne, et une clé
 * absente en local est adoptée. Rien n'est jamais supprimé. PUR.
 */
export const mergeKeyStates = ({ local = null, remote = null } = {}) => {
  const a = local && local.keys ? local : { keys: {} };
  const b = remote && remote.keys ? remote : { keys: {} };
  const adopt = {};
  Object.entries(b.keys).forEach(([key, entry]) => {
    const mine = a.keys[key];
    if (!mine) { adopt[key] = entry.v; return; }
    if ((Number(entry.at) || 0) > (Number(mine.at) || 0)) adopt[key] = entry.v;
  });
  const merged = { ...a.keys };
  Object.entries(adopt).forEach(([key, v]) => {
    merged[key] = { v, at: Number((b.keys[key] || {}).at) || Date.now() };
  });
  return { adopt, state: { kind: KEY_STATE_KIND, v: 1, at: '', keys: merged } };
};

/** Écrire les valeurs adoptées dans ce navigateur (jamais destructif : une clé
 *  existante n'est remplacée que parce qu'elle vient d'être jugée plus
 *  récente). @returns {string[]} les clés réellement écrites */
export const applyAdoptedKeys = (adopt, { meta = null } = {}) => {
  const written = [];
  try {
    const current = readKeyMeta();
    Object.entries(adopt || {}).forEach(([key, value]) => {
      if (!isSyncableKey(key)) return;
      localStorage.setItem(key, value);
      current[key] = Number((meta && meta[key] && meta[key].at) || 0) || Date.now();
      written.push(key);
    });
    if (written.length) writeKeyMeta(current);
  } catch { /* quota / stockage refusé : l'adoption est best-effort */ }
  return written;
};

/** Lire les valeurs + horodatages du navigateur. PUR côté forme. */
export const snapshotLocalKeys = (storage = null) => {
  const values = {};
  const meta = readKeyMeta(storage);
  syncableKeysIn(storage).forEach((key) => {
    try {
      const ls = storage || localStorage;
      const v = ls.getItem(key);
      if (v !== null) values[key] = v;
    } catch { /* ignore */ }
  });
  return { values, meta };
};

export const localKeyState = (storage = null, at = new Date().toISOString()) => {
  const snap = snapshotLocalKeys(storage);
  return buildKeyState({ values: snap.values, meta: snap.meta, at });
};

/** Taille (caractères) de la photographie : garde-fou avant l'envoi. */
export const keyStateBytes = (state) => {
  try { return JSON.stringify(state).length; } catch { return 0; }
};

/* ── Entrées / sorties Drive (best-effort) ───────────────────────────────── */

/** L'état des clés tel qu'il est SUR LE DRIVE (null si Drive éteint / absent). */
export const readKeyState = async () => {
  try {
    const raw = await downloadWorkspaceJsonText({ folder: WORKSPACE_KEYS_DIR, name: KEY_STATE_FILE });
    return parseKeyState(raw);
  } catch { return null; }
};

/** Déposer l'état des clés sur le Drive. null quand rien n'est écrit. */
export const writeKeyState = async (state) => {
  try {
    const parsed = parseKeyState(state);
    if (!parsed || !workspaceBackendReady()) return null;
    if (keyStateBytes(parsed) > MAX_KEY_STATE_BYTES) {
      console.warn('workspace keys: too large for the Drive mirror — kept in this browser only');
      return null;
    }
    return await uploadWorkspaceJson({
      folder: WORKSPACE_KEYS_DIR, name: KEY_STATE_FILE, body: JSON.stringify(parsed, null, 2)
    });
  } catch { return null; }
};

/**
 * Adopter ce que le Drive a de plus récent, puis renvoyer la photographie
 * complète (l'union des deux postes) : appeler `writeKeyState(state)` avec elle
 * garantit qu'aucune clé de ce poste n'est perdue sur le Drive.
 * @returns {Promise<{adopted:string[], state:object|null}>}
 */
export const adoptKeysFromDrive = async () => {
  const local = localKeyState();
  const remote = await readKeyState();
  if (!remote) return { adopted: [], state: local };
  const { adopt, state } = mergeKeyStates({ local, remote });
  const adopted = applyAdoptedKeys(adopt, { meta: remote.keys });
  return { adopted, state };
};

/**
 * Renvoyer les clés vers le Drive en différé, à chaque changement observé.
 * @returns {() => void} désinstallation
 */
export const installKeyAutosave = ({ delay = 3000 } = {}) => {
  let timer = null;
  let lastWritten = '';
  let stopped = false;
  const flush = async () => {
    if (stopped) return null;
    const state = localKeyState();
    const json = JSON.stringify(state);
    if (json === lastWritten) return null;
    const res = await writeKeyState(state);
    if (res) lastWritten = json;
    return res;
  };
  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, Math.max(500, Number(delay) || 3000));
  };
  try { window.addEventListener(KEYS_CHANGED_EVENT, schedule); } catch { /* hors navigateur */ }
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    try { window.removeEventListener(KEYS_CHANGED_EVENT, schedule); } catch { /* ignore */ }
  };
};


