/* =========================================================================
   src/utils/datasetListIndex.js
   LA LISTE DES DATASETS A SA PROPRE COPIE — ET ELLE VOYAGE PAR LE DRIVE.

   Firestore est la source partagée, mais une écriture Firestore peut être
   acquittée LOCALEMENT (le SDK « compat » garde ses écritures en attente jusqu'à
   la synchronisation) ou refusée (session expirée, règles) : un dataset créé sur
   ce poste existait alors POUR CE POSTE SEUL — et une fenêtre neuve (navigation
   privée, autre poste, navigateur vidé) ne le voyait pas du tout, puisque
   `lab_datasets_local_v2` n'était écrit QUE par le mode « sans Firestore » alors
   que le code le RELIT toujours (App.jsx) : une fenêtre neuve n'avait donc rien
   à lire.

   Ce module donne à la liste deux garanties :

     • elle est écrite dans le magasin du navigateur à CHAQUE changement, quel
       que soit le mode (App.jsx l'appelle) ;
     • quand `_workspace/keys.json` la rapporte d'un autre poste, elle est
       fusionnée PAR CONTENU — union par identifiant, la fiche la plus récente
       gagne — au lieu d'être écrasée par la copie la plus récente : le « [] »
       d'un navigateur neuf ne peut plus effacer la liste partagée (même règle
       que les bibliothèques de figures, voir figuresLibrary.js).

   Ce qui est gardé ici est un INDEX : jamais `payload` (le contenu d'un dataset
   vit dans son document Firestore et dans son fichier
   `_workspace/datasets/ds_<id>.json`) — `keys.json` doit rester petit, sinon son
   écriture est refusée en bloc (MAX_KEY_STATE_BYTES) et plus rien ne voyage.
   Exception : le mode « sans Firestore », où cette liste EST le contenu ; App.jsx
   passe alors `{ keepContent: true }`.

   Vérifié hors navigateur par _dataset_index_test.mjs.
   ========================================================================= */

import { LOCAL_STORAGE_KEY } from '../data/constants';
import { registerKeyValueMerger } from './workspaceKeyStore';

/** La clé du navigateur qui porte la liste (App.jsx la relit au démarrage). */
export const DATASET_LIST_CACHE_KEY = LOCAL_STORAGE_KEY;

/** Cette clé est-elle la liste des datasets ? (matcher du fusionneur) */
export const isDatasetListKey = (key) => String(key || '') === DATASET_LIST_CACHE_KEY;

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const storeOf = (storage) => {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/**
 * Une entrée d'INDEX : tout ce qui DÉCRIT un dataset, jamais son contenu.
 * `keepContent` conserve `payload` / `isCompressed` (mode sans Firestore, où
 * cette liste est la seule copie du contenu).
 * @returns {object|null} null quand l'entrée n'a pas d'identifiant
 */
export const datasetListEntry = (dataset, { keepContent = false } = {}) => {
  const d = dataset && typeof dataset === 'object' ? dataset : null;
  const id = text(d && d.id);
  if (!id) return null;
  const entry = {
    id,
    title: text(d.title) || 'Untitled Dataset',
    subtitle: text(d.subtitle),
    kind: text(d.kind) === 'administration' ? 'administration' : 'scientific',
    date: text(d.date),
    testCount: Number(d.testCount) || 0,
    updatedAt: Number(d.updatedAt) || 0
  };
  if (d.access && typeof d.access === 'object') entry.access = d.access;
  const folder = text(d.driveFolder);
  if (folder) entry.driveFolder = folder;
  if (text(d.createdBy)) entry.createdBy = text(d.createdBy);
  if (text(d.createdByRole)) entry.createdByRole = text(d.createdByRole);
  if (d.fromDrive === true) entry.fromDrive = true;
  if (keepContent && typeof d.payload === 'string' && d.payload) {
    entry.payload = d.payload;
    if (d.isCompressed) entry.isCompressed = true;
  }
  return entry;
};

/** Les entrées d'index d'une liste (les entrées sans identifiant sont écartées). */
export const datasetListEntries = (list, options) =>
  (Array.isArray(list) ? list : []).map((d) => datasetListEntry(d, options)).filter(Boolean);

/** La plus récente des deux fiches d'un même dataset … sans jamais perdre son
 *  contenu : une fiche plus récente mais sans `payload` reprend celui de l'autre
 *  (le contenu d'un dataset n'est pas une information qui vieillit). */
const newestEntry = (a, b) => {
  const newer = (Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0) ? b : a;
  const older = newer === a ? b : a;
  if (typeof newer.payload === 'string' && newer.payload) return newer;
  if (typeof older.payload === 'string' && older.payload) {
    return { ...newer, payload: older.payload, ...(older.isCompressed ? { isCompressed: true } : {}) };
  }
  return newer;
};

/**
 * L'UNION de deux listes de datasets, par identifiant. PURE.
 * L'ordre suit `a` puis les identifiants que seul `b` connaît (l'appelant trie).
 */
export const mergeDatasetLists = (a = [], b = []) => {
  const out = [];
  const at = new Map();
  (Array.isArray(a) ? a : []).forEach((d) => {
    const e = datasetListEntry(d, { keepContent: true });
    if (!e || at.has(e.id)) return;
    at.set(e.id, out.length);
    out.push(e);
  });
  (Array.isArray(b) ? b : []).forEach((d) => {
    const e = datasetListEntry(d, { keepContent: true });
    if (!e) return;
    const i = at.get(e.id);
    if (i === undefined) { at.set(e.id, out.length); out.push(e); return; }
    out[i] = newestEntry(out[i], e);
  });
  return out;
};

/** Lecture tolérante d'une copie JSON : toujours un tableau, jamais d'exception. */
export const parseDatasetList = (raw) => {
  let data = raw;
  if (typeof data === 'string') {
    const s = data.trim();
    if (!s) return [];
    try { data = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(data)) return [];
  return data.map((d) => datasetListEntry(d, { keepContent: true })).filter(Boolean);
};

/** La liste telle qu'elle est SUR CE POSTE (index seul si le store est vide). */
export const readDatasetListCache = (storage = null) => {
  const ls = storeOf(storage);
  if (!ls) return [];
  try { return parseDatasetList(ls.getItem(DATASET_LIST_CACHE_KEY)); } catch { return []; }
};

/**
 * Publier la liste dans le magasin du navigateur (UNION avec ce qui y est déjà :
 * un poste qui ne connaît pas encore un dataset ne l'efface pas).
 * Best-effort : un magasin plein ne casse jamais l'application.
 * @returns {object[]} la liste écrite
 */
export const writeDatasetListCache = (list, { keepContent = false, storage = null } = {}) => {
  const merged = mergeDatasetLists(readDatasetListCache(storage), datasetListEntries(list, { keepContent }));
  const ls = storeOf(storage);
  if (!ls) return merged;
  try { ls.setItem(DATASET_LIST_CACHE_KEY, JSON.stringify(merged)); } catch { /* quota */ }
  return merged;
};

/**
 * Le fusionneur des clés du miroir (`workspaceKeyStore` l'appelle pour
 * `lab_datasets_local_v2`) : l'union par identifiant devient la valeur publiée,
 * donc déposée sur `_workspace/keys.json` ET adoptée par les autres postes.
 * Renvoie la chaîne d'origine quand rien ne change (aucune réécriture inutile),
 * et `null` pour une autre clé (règle d'horodatage conservée).
 */
export const mergeDatasetListValues = (key, localRaw, remoteRaw) => {
  if (!isDatasetListKey(key)) return null;
  const local = parseDatasetList(localRaw);
  const remote = parseDatasetList(remoteRaw);
  if (!local.length) return remote.length ? String(remoteRaw) : null;
  if (!remote.length) return String(localRaw);
  const union = mergeDatasetLists(local, remote);
  const json = JSON.stringify(union);
  if (json === JSON.stringify(local)) return String(localRaw);
  if (json === JSON.stringify(remote)) return String(remoteRaw);
  return json;
};

/* Enregistré ICI (ce module connaît la forme des entrées) : le miroir des clés
   fusionne au lieu d'écraser, dès que ce module est importé (App.jsx le fait). */
registerKeyValueMerger(isDatasetListKey, mergeDatasetListValues);
