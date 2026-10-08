/* =========================================================================
   src/utils/driveFolderAnchor.js
   UN DOSSIER DE DATASET N'APPARTIENT QU'À SON DATASET.

   LE DÉFAUT (constaté sur le Drive réel, dataset « GEC-UPJV-projects ») : le
   dossier où l'application écrivait s'appelait `GEC-UPJV-pp` — le dossier d'un
   dataset SUPPRIMÉ — pendant que le dossier portant le bon nom, lui, restait
   presque vide. La cause est une SEULE mémoire pour TOUS les datasets
   (`labDriveFolderId` + « à qui appartient cet identifiant ») : quand deux
   datasets se succédaient plus vite que cette mémoire n'était réécrite — le
   contexte Drive était posé par un `useEffect`, donc APRÈS le rendu, alors que
   l'envoi, lui, part du geste — l'identifiant du dataset précédent servait
   encore, et les fichiers d'un dataset partaient dans le dossier d'un autre.

   CE QUI EST DÉCIDÉ ICI. Tout est PUR : aucun réseau, aucun navigateur, et le
   `storage` est un paramètre (un simple Map fait l'affaire en test).

     • le cache des dossiers est TENU PAR DATASET (`labDriveFolders`) :
       l'identifiant retenu pour A ne peut pas servir à B ;
     • l'ancienne mémoire UNIQUE est reprise une fois, sous le dataset qu'elle
       nommait (`labDriveFolderDatasetId`) : personne ne perd son dossier ;
     • un dossier n'est UTILISÉ que s'il est VIVANT et qu'il porte le nom du
       dataset : sinon on RENOMME celui qu'on connaît (le titre du dataset a
       changé — tout ce qui est déjà dedans suit), ou on l'ABANDONNE (c'est le
       dossier d'un autre) — jamais on n'écrit dedans ;
     • renommer ne fabrique jamais un JUMEAU : si un dossier porte déjà le nom
       voulu, c'est LUI qu'on utilise (`twinExists`).

   Vérifié par _drive_folder_anchor_test.mjs.
   ========================================================================= */

/** La mémoire des dossiers, PAR DATASET : { <datasetId>: { id, name } }. */
export const DATASET_FOLDERS_KEY = 'labDriveFolders';

/* L'ancienne mémoire UNIQUE (un seul dossier pour tous les datasets) : elle est
   reprise une fois, sous le dataset qu'elle nommait, puis n'est plus tenue à
   jour que comme reflet du dataset courant — une version antérieure de
   l'application, ou un poste resté en arrière, continue de lire un dossier
   cohérent au lieu d'un identifiant vide. */
export const LEGACY_FOLDER_ID_KEY = 'labDriveFolderId';
export const LEGACY_FOLDER_DATASET_KEY = 'labDriveFolderDatasetId';
export const LEGACY_FOLDER_NAME_KEY = 'labDriveFolderName';

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Le `storage` demandé, sinon celui du navigateur — jamais d'exception : une
 *  mémoire absente ou verrouillée (navigation privée) n'empêche pas d'envoyer. */
const storageOf = (storage) => {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null;
  } catch { return null; }
};

const readKey = (storage, key) => {
  const s = storageOf(storage);
  if (!s) return '';
  try { return s.getItem(key) || ''; } catch { return ''; }
};

const writeKey = (storage, key, value) => {
  const s = storageOf(storage);
  if (!s) return;
  try {
    const v = value === undefined || value === null ? '' : String(value);
    if (v === '') { if (typeof s.removeItem === 'function') s.removeItem(key); else s.setItem(key, ''); }
    else s.setItem(key, v);
  } catch { /* mémoire pleine / privée : la mémoire du dossier est un confort */ }
};

/** Le cache tel qu'il est rangé. Un JSON abîmé rend un cache VIDE (comme s'il
 *  n'y en avait jamais eu) : une mémoire douteuse ne fait pas écrire à côté. */
export const readDatasetFolderCache = (storage) => {
  const raw = readKey(storage, DATASET_FOLDERS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    Object.entries(parsed).forEach(([datasetId, entry]) => {
      const id = text(entry && entry.id);
      const name = text(entry && entry.name);
      if (!datasetId || !id) return;
      out[String(datasetId)] = { id, name };
    });
    return out;
  } catch { return {}; }
};

/** L'entrée d'UN dataset — jamais celle d'un autre. À la première lecture,
 *  l'ancienne mémoire unique est reprise si elle désignait CE dataset. */
export const datasetFolderEntry = (storage, datasetId) => {
  const id = text(datasetId);
  if (!id) return { id: '', name: '' };
  const cache = readDatasetFolderCache(storage);
  if (cache[id]) return cache[id];
  const legacyOwner = text(readKey(storage, LEGACY_FOLDER_DATASET_KEY));
  const legacyId = text(readKey(storage, LEGACY_FOLDER_ID_KEY));
  if (legacyId && legacyOwner === id) {
    const entry = { id: legacyId, name: text(readKey(storage, LEGACY_FOLDER_NAME_KEY)) };
    rememberDatasetFolderEntry(storage, id, entry);
    return entry;
  }
  return { id: '', name: '' };
};

/** Retenir le dossier d'un dataset — et tenir l'ancienne mémoire unique au nom
 *  de CE dataset (c'est le seul cas où elle est écrite). */
export const rememberDatasetFolderEntry = (storage, datasetId, { id = '', name = '' } = {}) => {
  const dsId = text(datasetId);
  if (!dsId) return { id: '', name: '' };
  const entry = { id: text(id), name: text(name) };
  const cache = readDatasetFolderCache(storage);
  cache[dsId] = entry;
  writeKey(storage, DATASET_FOLDERS_KEY, JSON.stringify(cache));
  writeKey(storage, LEGACY_FOLDER_ID_KEY, entry.id);
  writeKey(storage, LEGACY_FOLDER_DATASET_KEY, entry.id ? dsId : '');
  writeKey(storage, LEGACY_FOLDER_NAME_KEY, entry.id ? entry.name : '');
  return entry;
};

/** Oublier le dossier d'UN dataset (dossier à la corbeille, dossier d'un autre,
 *  création à refaire) : les autres datasets gardent le leur. */
export const forgetDatasetFolderEntry = (storage, datasetId) => {
  const dsId = text(datasetId);
  if (!dsId) return;
  const cache = readDatasetFolderCache(storage);
  if (!Object.prototype.hasOwnProperty.call(cache, dsId)) return;
  delete cache[dsId];
  writeKey(storage, DATASET_FOLDERS_KEY, JSON.stringify(cache));
  if (text(readKey(storage, LEGACY_FOLDER_DATASET_KEY)) === dsId) {
    writeKey(storage, LEGACY_FOLDER_ID_KEY, '');
    writeKey(storage, LEGACY_FOLDER_DATASET_KEY, '');
    writeKey(storage, LEGACY_FOLDER_NAME_KEY, '');
  }
};

/** CE QU'IL FAUT FAIRE DU DOSSIER RETENU POUR UN DATASET.
 *
 *  `meta` = le dossier tel que le DRIVE le décrit ({ name, trashed }), ou null
 *  quand le Drive n'a PAS répondu (hors ligne, jeton expiré, dossier
 *  inaccessible). Un Drive muet ne fait jamais perdre le dossier retenu :
 *  l'application continue comme avant, au lieu de se croire sans dossier.
 *
 *  Rendus (purs, énumérés) :
 *    { action:'use',    reason:'name-matches' | 'unverified' | … } on écrit dedans
 *    { action:'rename', reason:'title-changed' }  c'est le bon dossier, mais sous
 *                                                l'ancien titre : le renommer fait
 *                                                suivre tout ce qui est dedans
 *    { action:'forget' }                          on n'écrit pas dedans : on
 *                                                repart du nom et du registre
 */
export const folderUseDecision = ({ entry = {}, wanted = '', meta = null, twinExists = false } = {}) => {
  const id = text(entry && entry.id);
  if (!id) return { action: 'forget', reason: 'no-cache' };
  const name = text(wanted);
  /* Aucun dossier de dataset à nommer (rien d'ouvert) : le dossier retenu est la
     racine de l'espace de travail — même comportement qu'avant. */
  if (!name) return { action: 'use', reason: 'no-dataset-name' };
  if (!meta || typeof meta !== 'object') return { action: 'use', reason: 'unverified' };
  if (meta.trashed) return { action: 'forget', reason: 'trashed' };
  const real = text(meta.name);
  if (!real) return { action: 'use', reason: 'unnamed' };
  if (real === name) return { action: 'use', reason: 'name-matches' };
  const remembered = text(entry && entry.name);
  if (remembered && real === remembered) {
    /* C'est bien le dossier que l'application a créé pour ce dataset, sous son
       ancien titre : le renommer fait suivre tout ce qui est déjà dedans. SAUF
       si un dossier porte DÉJÀ le nom voulu — renommer fabriquerait un jumeau. */
    return twinExists
      ? { action: 'forget', reason: 'twin' }
      : { action: 'rename', reason: 'title-changed' };
  }
  /* Le dossier porte un nom que l'application ne lui a jamais donné pour ce
     dataset : c'est le dossier d'un AUTRE (c'est exactement `GEC-UPJV-pp`). On
     n'écrit pas dedans, on ne l'écrase pas, on l'oublie — et lui seul. */
  return { action: 'forget', reason: 'other-name' };
};
