import { getDriveToken, uploadLocalFile, dataUrlToBlob, cloudBackendAvailable, getDriveRootName, resolveDrivePathFromNames, listDriveChildren, downloadDriveFileText, takeLastUploadQueueInfo } from './driveUpload';
import { sanitizeSlug, projectImagesFolderPath } from './driveNaming';
import { getCloudProvider, isNextcloudUrl, ncFetchBlob, ncUploadFile } from './nextcloud';
import { registerKeyValueMerger } from './workspaceKeyStore';

/* =========================================================================
   src/utils/figuresLibrary.js
   Shared persistence for the Publications → "Figures & Slides" builder:
   • image library (app-wide, localStorage): formulas, logos, viewer captures…
   • slide decks (per project, localStorage): a PowerPoint-like set of slides
     with image + text blocks.

   WHERE A FIGURE REALLY LIVES (and why a canvas was "lost"):
     1. the PIXELS go to the cloud — <dataset>/projects/<project>/images/<name>
        (Drive or Nextcloud). Everything with a `drive: true` entry can be shown
        again on any computer.
     2. the LIST of entries (label, link, `canvasData` snapshot) lived ONLY in
        this browser's localStorage — and localStorage fills up (~5 MB shared
        with the dataset payload), at which point an entry existed in MEMORY
        ONLY. Leaving the page (or another computer) then showed the rendered
        image on Drive but no entry to reopen it in the Image Builder: the bug
        this module now closes from three sides —
          • `saveCanvasSnapshot()` writes the editable composition WITHOUT
            rendering/uploading, so leaving the builder never loses the layout;
          • every published figure ALSO gets a small `<name>.meta.json` SIDECAR
            next to its image, holding the label/stamp/`canvasData` — so the
            editable canvas (and the "back to the original graph" stamp) can be
            rebuilt from Drive alone, even after the browser was wiped;
          • the browser keys mirror (`_workspace/keys.json`, see
            workspaceKeyStore.js) merges the library LISTS entry by entry
            instead of letting a poorer copy overwrite a richer one.
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

/* ---- who may SEE a project's figures ----------------------------------------
   The figures of a project are private to that project's team (owner +
   authorizedPeople). This module does not know who is logged in, so the caller
   passes the projects the current user may open. ONLY the read paths that feed a
   list / grid / thumbnail go through the helper below: the raw read/write API
   (readProjectLibrary / writeProjectLibrary …) is deliberately left unfiltered,
   because a write built on a filtered list would erase the entries it cannot
   see. `null` means "no restriction asked" (internal callers, tests, the HTML
   backup snapshot). */
const allowedProjectFilter = (allowedProjectIds) => {
  if (allowedProjectIds == null) return null;
  if (typeof allowedProjectIds === 'function') return allowedProjectIds;
  const set = allowedProjectIds instanceof Set ? allowedProjectIds : new Set(allowedProjectIds);
  return (projectId) => set.has(projectId);
};

/** Read a project library for DISPLAY: [] when `projectId` is not among the
 *  projects the user may open (`allowedProjectIds`). The unassigned/global
 *  scope (null / '') is always readable — it belongs to no project. */
export const readVisibleProjectLibrary = (projectId, allowedProjectIds = null) => {
  if (projectId == null || projectId === '') return readProjectLibrary(projectId);
  const allowed = allowedProjectFilter(allowedProjectIds);
  if (!allowed) return readProjectLibrary(projectId);
  return allowed(projectId) ? readProjectLibrary(projectId) : [];
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
    metaName: item.metaName || null,  // name of the "<image>.meta.json" sidecar holding the snapshot
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
/* Supprimer une image est un geste EXPLICITE : l'id part dans les pierres
   tombales de la portée (voir rememberLibraryTrash), sinon la fusion par contenu
   la ramènerait du Drive au prochain démarrage. */
export const removeLibraryItem = (id) => {
  const list = readLibrary();
  const gone = list.find((i) => i && i.id === id);
  if (gone) rememberLibraryTrash('common', trashIdsOfEntry(gone));
  writeLibrary(list.filter((i) => !i || i.id !== id));
};
/* ── DÉPLACER UNE IMAGE DANS LA BIBLIOTHÈQUE (le glisser-déposer) ─────────────
   L'ORDRE de la liste EST celui qu'affichent la bibliothèque d'images (panneau
   « Image library » de Figures & Slides, modale 🖼 de l'Image Builder) et tous
   les sélecteurs qui la parcourent. La souris peut donc le réécrire : on fait
   glisser une vignette DEVANT une autre. Pur, pour que les deux écrans
   partagent le même geste — et pour être testable hors navigateur. */

/** La liste d'arrivée, `id` posé juste AVANT `beforeId` (à la fin quand
 *  `beforeId` est absent, vide ou introuvable). L'objet REÇU est renvoyé tel
 *  quel quand rien ne bouge (déjà à cette place) : l'appelant peut comparer les
 *  références et éviter une écriture inutile. */
export const reorderLibraryList = (list, id, beforeId = '') => {
  const src = Array.isArray(list) ? list : [];
  const at = src.findIndex((i) => i && i.id === id);
  if (at < 0 || id === beforeId) return list;
  const moved = src[at];
  const rest = src.filter((_, i) => i !== at);
  const dest = beforeId ? rest.findIndex((i) => i && i.id === beforeId) : -1;
  rest.splice(dest < 0 ? rest.length : dest, 0, moved);
  if (rest.length === src.length && rest.every((i, k) => i === src[k])) return list;
  return rest;
};

/** Le même déplacement, écrit dans la portée demandée ('common' = bibliothèque
 *  partagée, 'project' = celle d'un projet). @returns {boolean} true si la
 *  liste a réellement changé (donc si quelque chose a été écrit). */
export const reorderLibraryItem = (scope, projectId, id, beforeId = '') => {
  const current = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const next = reorderLibraryList(current, id, beforeId);
  if (next === current) return false;
  if (scope === 'project') writeProjectLibrary(projectId, next);
  else writeLibrary(next);
  return true;
};
export const renameLibraryItem = (id, label) =>
  writeLibrary(readLibrary().map((i) => (i.id === id ? { ...i, label } : i)));
export const removeProjectLibraryItem = (projectId, id) => {
  const list = readProjectLibrary(projectId);
  const gone = list.find((i) => i && i.id === id);
  if (gone) rememberLibraryTrash(projectId || 'common', trashIdsOfEntry(gone));
  return writeProjectLibrary(projectId, list.filter((i) => !i || i.id !== id));
};
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
/* ── Lire une bibliothèque depuis une sauvegarde : AJOUT/FUSION seulement ────

   La LISTE des images (libellés, vignettes, ordre, bibliothèque commune et
   bibliothèques de projet) vit dans CE navigateur (localStorage `labFiguresLibrary`
   / `labFiguresLib_<projet>`) ; seules les images elles-mêmes sont sur Google
   Drive / Nextcloud (<dataset>/projects/<projet>/images). Sur un autre poste la
   liste est donc vide même si les fichiers sont bien dans le Drive : elle voyage
   UNIQUEMENT dans les fichiers de sauvegarde (clés `_figuresLibrary` +
   `_figuresLibraryProjects`), relus ici.

   L'import REMPLAÇAIT autrefois la liste : charger la sauvegarde d'un poste à la
   bibliothèque vide effaçait donc les images de ce poste (et il n'existe AUCUN
   index de secours dans le Drive pour les retrouver). L'import est donc
   strictement ADDITIF, comme les papiers : les entrées absentes sont ajoutées,
   les champs vides des entrées déjà présentes sont complétés, rien n'est
   supprimé ni écrasé. */

/** Un champ « vide » peut être complété par la sauvegarde (false compte comme
 *  vide : `drive:false` redevient `true` quand la copie cloud existe). */
const isEmptyField = (v) => v === undefined || v === null || v === '' || v === false;

/** Champs recopiés d'une entrée de sauvegarde dans une entrée existante (les
 *  champs vides SEULEMENT — voir le commentaire ci-dessus). */
const LIB_MERGE_FIELDS = ['label', 'url', 'full', 'drive', 'driveUrl', 'src', 'canvasData', 'metaName'];

/**
 * Fusionne une liste de bibliothèque (`current`, celle du navigateur) avec une
 * liste de sauvegarde (`incoming`). Réponse : `{ list, added, filled }`.
 * • clé d'identité = `id` (les entrées relues d'un fichier gardent leur id, un
 *   même fichier réimporté n'ajoute donc jamais de doublon) ;
 * • les entrées nouvelles sont AJOUTÉES À LA FIN : l'ordre existant est
 *   conservé tel quel (la bibliothèque n'est pas réordonnée par un import) ;
 * • une entrée déjà présente n'est jamais remplacée, seulement complétée.
 * Les objets de `current` sont modifiés EN PLACE : le miroir mémoire
 * (readLibrary / readProjectLibrary) voit donc les champs complétés.
 */
export const mergeLibraryList = (current, incoming) => {
  const list = Array.isArray(current) ? current.slice() : [];
  const byId = new Map();
  list.forEach((it) => { if (it && it.id) byId.set(it.id, it); });
  let added = 0;
  let filled = 0;
  (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const item = { ...raw };
    if (!item.id) item.id = uid('lib');
    const prev = byId.get(item.id);
    if (!prev) {
      if (!item.addedAt) item.addedAt = new Date().toISOString();
      list.push(item);
      byId.set(item.id, item);
      added += 1;
      return;
    }
    let touched = false;
    LIB_MERGE_FIELDS.forEach((f) => {
      if (isEmptyField(prev[f]) && !isEmptyField(item[f])) { prev[f] = item[f]; touched = true; }
    });
    if (touched) filled += 1;
  });
  return { list, added, filled };
};

/* ─────────────────────────────────────────────────────────────────────────────
   LA LISTE D'UNE BIBLIOTHÈQUE NE SE PERD PLUS (fusion PAR CONTENU)

   `_workspace/keys.json` sur le Drive est la mémoire PARTAGÉE des clés du
   navigateur : chaque poste y dépose sa photographie. La règle « la copie la
   plus récente gagne » suffit pour un réglage, jamais pour une LISTE : un poste
   dont la bibliothèque est pauvre (magasin plein, navigateur vidé, autre
   appareil) écrasait la liste riche et les entrées de canvas disparaissaient —
   l'image restait sur le Drive, mais plus rien pour la rouvrir dans l'éditeur.

   Ces fonctions fusionnent deux listes ENTRÉE PAR ENTRÉE (union par `id`, puis
   par fichier Drive, puis par libellé+date) : l'entrée la plus RICHE gagne
   (celle qui porte un `canvasData` éditable, une copie cloud, une origine), et
   les champs vides sont complétés par l'autre. PUR et testable hors navigateur.
   ───────────────────────────────────────────────────────────────────────────── */

/** Identité d'une entrée de bibliothèque : deux copies de la MÊME figure que
 *  deux postes nomment différemment restent reconnues par leur fichier cloud. */
export const libraryEntryIdentity = (i) => {
  const id = String((i && i.id) || '');
  if (id) return `id:${id}`;
  const d = driveIdOfLibraryItem(i);
  if (d) return `drive:${d}`;
  return `label:${String((i && i.label) || '')}|${String((i && i.addedAt) || '')}`;
};

/** Score de richesse d'une entrée : ce qu'une copie peut apporter et que
 *  l'autre n'a pas. Un canvas éditable vaut plus que tout le reste — c'est
 *  exactement ce qu'une fusion ne doit jamais perdre. */
const libraryEntryScore = (i) => (
  (i && i.canvasData ? 4 : 0)
  + (i && i.drive ? 2 : 0)
  + (i && i.full && !String(i.full).startsWith('data:') ? 2 : 0)
  + (i && i.src ? 1 : 0)
  + (i && i.metaName ? 1 : 0)
  + (i && String(i.label || '').trim() ? 1 : 0)
);

/** Date « la plus récente » portée par une entrée (la composition sauvegardée
 *  porte sa propre date : deux canvas du même nom s'arbitrent par elle). */
const libraryEntryTime = (i) => {
  const t = Date.parse((i && (i.updatedAt || (i.canvasData && i.canvasData.updatedAt) || i.addedAt)) || '');
  return Number.isFinite(t) ? t : 0;
};

/** Deux copies de la MÊME entrée → une seule, la plus riche, complétée par les
 *  champs que l'autre possède. `a` garde son `id` (les liens des pages de projet
 *  pointent dessus) et, à richesse ÉGALE, c'est `a` (la copie locale) qui reste :
 *  une fusion ne réécrit jamais un libellé de ce poste. La seule exception est
 *  une COMPOSITION des deux côtés : la plus récente gagne (c'est le travail).
 *  PUR. */
export const mergeLibraryEntryPair = (a, b) => {
  const scoreA = libraryEntryScore(a);
  const scoreB = libraryEntryScore(b);
  let base = scoreB > scoreA ? b : a;
  // Égalité de richesse sur un canvas : la composition la plus récente gagne.
  if (scoreA === scoreB && a && b && a.canvasData && b.canvasData && libraryEntryTime(b) > libraryEntryTime(a)) base = b;
  const other = base === b ? a : b;
  const merged = { ...(other || {}), ...(base || {}) };
  LIB_MERGE_FIELDS.forEach((f) => {
    if (isEmptyField(merged[f]) && other && !isEmptyField(other[f])) merged[f] = other[f];
  });
  if (a && a.id) merged.id = a.id;
  return merged;
};

/** Union de deux listes de bibliothèque : l'ordre LOCAL est conservé, les
 *  entrées que seul le Drive a sont AJOUTÉES à la fin, et une même figure
 *  reconnue sous deux `id` (relecture du dossier Drive) est fusionnée, jamais
 *  dupliquée. `opts.trash` (ids supprimés à la main, voir rememberLibraryTrash)
 *  écarte ce qui a été EFFACÉ : une union ne doit pas ressusciter une image que
 *  l'utilisateur a retirée. PUR. */
export const mergeLibraryLists = (local, remote, { trash = null } = {}) => {
  const out = [];
  const byIdentity = new Map();
  const push = (item) => {
    if (!item || typeof item !== 'object') return;
    const key = libraryEntryIdentity(item);
    const at = byIdentity.get(key);
    if (at === undefined) { byIdentity.set(key, out.length); out.push(item); return; }
    out[at] = mergeLibraryEntryPair(out[at], item);
  };
  applyLibraryTrash(local, trash).forEach(push);
  applyLibraryTrash(remote, trash).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    // Même figure, autre identité : le fichier cloud tranche.
    const d = driveIdOfLibraryItem(raw);
    if (d) {
      const at = out.findIndex((i) => i && driveIdOfLibraryItem(i) === d);
      if (at >= 0) { out[at] = mergeLibraryEntryPair(out[at], raw); return; }
    }
    push(raw);
  });
  return out;
};

/** Valeur à écrire pour une clé de bibliothèque : l'UNION des deux copies (les
 *  suppressions explicites de cette portée en sont écartées). `''` quand la clé
 *  ne contient pas de listes JSON (l'appelant retombe alors sur la règle
 *  d'horodatage). PUR. */
export const mergeLibraryKeyValues = (key, localRaw, remoteRaw) => {
  const parse = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
  };
  /** Une liste de bibliothèque ne contient que des OBJETS : tout autre contenu
   *  (une liste de chaînes, par exemple) n'est pas à nous — on ne la touche pas. */
  const isEntryList = (arr) => Array.isArray(arr) && arr.every((i) => i && typeof i === 'object' && !Array.isArray(i));
  const local = parse(localRaw);
  const remote = parse(remoteRaw);
  if (!local && !remote) return '';
  if (local && !isEntryList(local)) return '';
  if (remote && !isEntryList(remote)) return '';
  const trash = readLibraryTrash(libraryScopeKeyOfKey(key) || 'common');
  if (!local) return JSON.stringify(applyLibraryTrash(remote, trash));
  if (!remote) return JSON.stringify(applyLibraryTrash(local, trash));
  const merged = mergeLibraryLists(local, remote, { trash });
  return JSON.stringify(merged) === JSON.stringify(local) ? String(localRaw) : JSON.stringify(merged);
};

/** Clés du navigateur qui portent une LISTE de bibliothèque d'images
 *  (`labFiguresLibrary`, `labFiguresLib_<projet>`). Les diapositives
 *  (`labFiguresDeck_*`) sont des objets, pas des listes : elles gardent la règle
 *  d'horodatage. */
export const isLibraryListKey = (key) => /^labFiguresLib/.test(String(key || ''));

// Enregistré ICI (le module connaît la forme des entrées) : le miroir des clés
// (workspaceKeyStore.js) l'appelle pour fusionner au lieu d'écraser.
registerKeyValueMerger(isLibraryListKey, mergeLibraryKeyValues);

/* ── LES SUPPRESSIONS EXPLICITES (pierres tombales) ──────────────────────────

   Une union d'entrées ne sait pas distinguer « ce poste n'a jamais eu cette
   image » (à compléter depuis le Drive) de « ce poste l'a SUPPRIMÉE » (à ne
   surtout pas ramener). Sans cette liste, la fusion par contenu ferait
   réapparaître une image que l'on vient de retirer de la bibliothèque — et une
   suppression ne se propagerait plus d'un poste à l'autre.

   Chaque portée (commune, ou un projet) note donc les identifiants supprimés à
   la main dans `labFiguresTrash_<portée>` : cette petite liste voyage dans le
   miroir des clés comme les autres (elle commence par « lab »), et les deux
   côtés d'une fusion la respectent. Elle est bornée, et un id enregistré est
   forcément celui d'une entrée que l'on ne veut plus voir. */

export const LIBRARY_TRASH_PREFIX = 'labFiguresTrash_';
const LIBRARY_TRASH_MAX = 500;

/** La portée d'une clé de bibliothèque (`labFiguresLibrary` → 'common'). */
export const libraryScopeKeyOfKey = (key) => {
  const k = String(key || '');
  if (k === 'labFiguresLibrary') return 'common';
  if (k.startsWith('labFiguresLib_')) return k.slice('labFiguresLib_'.length) || 'common';
  return '';
};
export const libraryTrashKey = (scopeKey) => `${LIBRARY_TRASH_PREFIX}${scopeKey || 'common'}`;
export const isLibraryTrashKey = (key) => String(key || '').startsWith(LIBRARY_TRASH_PREFIX);

export const readLibraryTrash = (scopeKey) => {
  try {
    const a = JSON.parse(localStorage.getItem(libraryTrashKey(scopeKey)) || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
  } catch { return []; }
};

/** Ce qu'il faut retenir d'une entrée supprimée : son `id`, ET l'identifiant de
 *  son fichier cloud (`d:<id>`) — la même image peut revenir d'un dossier Drive
 *  sous un autre id (`lib_drive_…`), et c'est CE fichier qu'on ne veut pas
 *  revoir dans la liste. */
export const trashIdsOfEntry = (entry) => {
  const out = [];
  if (entry && entry.id) out.push(String(entry.id));
  const d = driveIdOfLibraryItem(entry);
  if (d) out.push(`d:${d}`);
  return out;
};

/** Note des suppressions (union avec ce qui était déjà noté). @returns {string[]} */
export const rememberLibraryTrash = (scopeKey, ids) => {
  const add = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '')).filter(Boolean);
  if (!add.length) return readLibraryTrash(scopeKey);
  const next = [...new Set([...add, ...readLibraryTrash(scopeKey)])].slice(0, LIBRARY_TRASH_MAX);
  try { localStorage.setItem(libraryTrashKey(scopeKey), JSON.stringify(next)); } catch { /* quota : la fusion reste correcte, la suppression est juste locale */ }
  return next;
};

/** Retire les entrées tombstonées d'une liste (pur). */
export const applyLibraryTrash = (list, trash) => {
  const set = trash instanceof Set ? trash : new Set(Array.isArray(trash) ? trash : []);
  if (!set.size) return Array.isArray(list) ? list : [];
  return (Array.isArray(list) ? list : []).filter((i) => !i || !trashIdsOfEntry(i).some((id) => set.has(id)));
};

/** Union de deux listes d'ids supprimés (pour le miroir des clés). PUR. */
export const mergeLibraryTrashValues = (key, localRaw, remoteRaw) => {
  const parse = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : null; } catch { return null; }
  };
  const local = parse(localRaw);
  const remote = parse(remoteRaw);
  if (!local && !remote) return '';
  if (!local) return String(remoteRaw);
  if (!remote) return String(localRaw);
  const union = [...new Set([...local, ...remote])].slice(0, LIBRARY_TRASH_MAX);
  return JSON.stringify(union);
};

// Les pierres tombales sont l'UNION des deux côtés : une suppression faite sur
// un poste doit être connue des autres, sinon l'image reviendrait au prochain
// démarrage. (Enregistré APRÈS la définition des deux fonctions — le module les
// évalue dans l'ordre.)
registerKeyValueMerger(isLibraryTrashKey, mergeLibraryTrashValues);

/**
 * Applique la bibliothèque d'images d'une sauvegarde (`{ common, projects }`,
 * où `projects` est `{ <idProjet>: [...] }`) à CE navigateur, en AJOUT/FUSION.
 * Une liste absente ou vide ne fait RIEN : un fichier sans bibliothèque ne peut
 * pas effacer celle du poste (c'était la façon de perdre des images).
 * @returns {{added:number, filled:number, common:object,
 *            perProject:Object<string,object>, projectCount:number}}
 */
export const mergeLibraryFromSnapshot = (snap) => {
  const src = snap && typeof snap === 'object' ? snap : {};
  const out = { added: 0, filled: 0, common: { added: 0, filled: 0 }, perProject: {}, projectCount: 0 };
  const common = Array.isArray(src.common) ? src.common : [];
  if (common.length) {
    try {
      const res = mergeLibraryList(readLibrary(), common);
      if (res.added || res.filled) writeLibrary(res.list);
      out.common = { added: res.added, filled: res.filled };
      out.added += res.added;
      out.filled += res.filled;
    } catch { /* ignore */ }
  }
  const projects = src.projects && typeof src.projects === 'object' && !Array.isArray(src.projects)
    ? src.projects
    : {};
  Object.entries(projects).forEach(([pid, items]) => {
    if (!Array.isArray(items) || items.length === 0) return;
    try {
      const res = mergeLibraryList(readProjectLibrary(pid), items);
      if (res.added || res.filled) writeProjectLibrary(pid, res.list);
      out.perProject[pid] = { added: res.added, filled: res.filled };
      out.projectCount += 1;
      out.added += res.added;
      out.filled += res.filled;
    } catch { /* ignore */ }
  });
  return out;
};

/** Ancien nom de l'import d'une sauvegarde : il est désormais ADDITIF (voir
 *  mergeLibraryFromSnapshot) — l'appelant reçoit le compte-rendu de la fusion. */
export const restoreLibraryFromSnapshot = (snap) => mergeLibraryFromSnapshot(snap);

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

/* ── LA COMPOSITION ÉDITABLE, SANS RENDU NI ENVOI ────────────────────────────
   « 💾 Save canvas » rend l'image (lourd) et l'envoie au Drive. Ce raccourci-ci
   écrit SEULEMENT la composition éditable (`canvasData`) dans l'entrée de
   bibliothèque : c'est ce qui permet à la sauvegarde automatique de l'Image
   Builder — et au moment où l'on quitte la page — de ne rien perdre sans
   rendre une image à chaque frappe. L'aperçu (`url`) et les pixels sont posés
   par la passe complète (💾 Save canvas / sauvegarde automatique « cloud »),
   qui met la MÊME entrée à jour sur place.

   @returns {{ entry:object|null, updated:boolean }} */
export const saveCanvasSnapshot = ({
  scope = 'common', projectId = null, label = 'Canvas', updateId = null,
  canvasData = null, src = null, url = null
} = {}) => {
  if (!canvasData) return { entry: null, updated: false };
  const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const prev = updateId ? list.find((i) => i && i.id === updateId) : null;
  const name = String(label || 'Canvas').trim() || 'Canvas';
  // La date portée par la composition : deux canvas du même nom s'arbitrent par
  // elle (voir mergeLibraryEntryPair), et la fusion l'utilise pour choisir la
  // composition la plus récente.
  const stamped = { ...canvasData, updatedAt: new Date().toISOString() };
  if (prev) {
    // Les champs prévus pour la copie cloud (`url` / `full` / `drive`) sont
    // CONSERVÉS : le rendu n'a pas encore eu lieu, il ne faut pas effacer
    // l'aperçu ni le lien de la version publiée.
    const next = {
      ...prev,
      label: name,
      canvasData: stamped,
      updatedAt: stamped.updatedAt
    };
    if (src && !next.src) next.src = src;
    if (url && !next.url) next.url = url;
    if (scope === 'project') writeProjectLibrary(projectId, list.map((i) => (i && i.id === prev.id ? next : i)));
    else writeLibrary(list.map((i) => (i && i.id === prev.id ? next : i)));
    return { entry: next, updated: true };
  }
  const entry = scope === 'project'
    ? addProjectLibraryItem(projectId, { label: name, url: url || null, full: url || null, src, canvasData: stamped })
    : addLibraryItem({ label: name, url: url || null, full: url || null, src, canvasData: stamped });
  return { entry, updated: false };
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
  // Pourquoi la copie cloud a échoué, et si elle est DÉJÀ en file de reprise :
  // l'appelant peut ainsi dire « en attente, elle repartira toute seule » au
  // lieu du « drive upload failed — browser copy only » qui laissait croire
  // que rien n'était gardé.
  let driveError = '';
  let driveQueued = false;
  if (hi && String(hi).startsWith('data:')) {
    if (!cloudBackendAvailable()) {
      driveError = 'cloud storage is not connected';
    } else {
      try {
        drive = await uploadFigureToDrive({ full: hi, label, projectName });
      } catch (err) {
        drive = null;
        driveError = (err && err.message) || 'cloud upload failed';
      }
      if (!drive) {
        const q = takeLastUploadQueueInfo() || {};
        driveQueued = !!q.queued;
        if (!driveError) driveError = lastFigureUploadError()
          || (q.reason === 'too_large' ? 'the image is too large for the retry queue' : 'cloud upload failed');
      }
    }
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
  // La copie ÉDITABLE part À CÔTÉ de l'image (petit fichier `<image>.meta.json`
  // dans le même dossier) : la composition du canvas ET le repère « d'où vient
  // cette figure » se relisent ainsi depuis le Drive seul — donc sur un autre
  // ordinateur, ou après avoir vidé le navigateur. Sans elle, une bibliothèque
  // reconstruite depuis le Drive ne sait plus rouvrir un canvas dans l'éditeur.
  const metaName = (drive && drive.id)
    ? await uploadFigureMetaToDrive({
      meta: buildFigureMeta({ label, src, canvasData, imageName: drive.name || '' }),
      imageName: drive.name || '',
      projectName
    }).then((r) => (r && r.name) || '').catch(() => '')
    : '';
  const item = { url, full, label, src, canvasData, drive: !!drive, driveUrl: humanUrl, metaName: metaName || null };
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
      return { entry: updated, drive, driveUrl: humanUrl, driveError, driveQueued, metaName: metaName || null, updated: true, missing: false };
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
  return { entry, drive, driveUrl: humanUrl, driveError, driveQueued, metaName: metaName || null, updated: false, missing: !!updateId };
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
export const findRecaptureDuplicates = ({ allowedProjectIds = null } = {}) => {
  const out = [];
  const allowed = allowedProjectFilter(allowedProjectIds);
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
    Object.entries(readAllProjectLibraries()).forEach(([pid, items]) => {
      if (allowed && !allowed(pid)) return; // another team's project library
      scan('project', pid, items);
    });
  } catch { /* ignore */ }
  return out;
};

/** Total number of duplicate copies findRecaptureDuplicates() would remove. */
export const countRecaptureDuplicates = (opts = {}) => findRecaptureDuplicates(opts).reduce((n, g) => n + g.count, 0);

/** Remove them (keeps the NEWEST copy of each figure). Returns { removed, groups }. */
export const removeRecaptureDuplicates = (opts = {}) => {
  const groups = findRecaptureDuplicates(opts);
  let removed = 0;
  groups.forEach((g) => {
    const ids = new Set(g.removeIds);
    const list = g.scope === 'project' ? readProjectLibrary(g.projectId) : readLibrary();
    const next = list.filter((i) => !ids.has(i.id));
    removed += list.length - next.length;
    // Ces copies ne doivent pas revenir par la fusion : on les note.
    try {
      const dropped = list.filter((i) => i && ids.has(i.id)).flatMap(trashIdsOfEntry);
      if (dropped.length) rememberLibraryTrash(g.scope === 'project' ? (g.projectId || 'common') : 'common', dropped);
    } catch { /* la suppression reste faite */ }
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
/** Dernière erreur d'envoi d'une FIGURE (vide après un envoi réussi). Permet à
 *  l'appelant de dire POURQUOI la copie cloud manque (hors ligne, jeton expiré,
 *  dossier supprimé…) au lieu d'un « échec » muet. */
let lastFigureDriveError = '';
export const lastFigureUploadError = () => lastFigureDriveError;

export const uploadFigureToDrive = async ({ full, label = 'figure', projectName = '' }) => {
  lastFigureDriveError = '';
  // L'information « mis en file de reprise ? » est consommée par la tentative
  // précédente : la vider ici garantit que le compte-rendu lu juste après
  // concerne BIEN cet envoi-ci.
  takeLastUploadQueueInfo();
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
      lastFigureDriveError = (err && err.message) || 'upload failed';
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
    lastFigureDriveError = (err && err.message) || 'upload failed';
    console.warn('Figure → Drive upload failed:', err && err.message);
    return null;
  }
};

/* ── LA COPIE ÉDITABLE D'UNE FIGURE (« sidecar ») ─────────────────────────────

   L'image d'une figure se relit du Drive, mais rouvrir un CANVAS dans l'Image
   Builder demande bien plus que ses pixels : il faut sa composition (panneaux,
   positions, légendes, flèches). Ce petit fichier — `<image>.meta.json`, déposé
   DANS LE MÊME dossier que l'image — porte exactement cela (et le repère
   `src` « d'où vient cette figure » d'une capture).

   Il rend la bibliothèque d'images reconstructible DEPUIS LE DRIVE : c'est ce
   qui fait qu'une composition se retrouve et se rouvre même sur un ordinateur
   qui n'a jamais vu cette bibliothèque, ou après un navigateur vidé (voir
   libraryItemsFromDriveListing / pullLibraryFromDrive). */

export const FIGURE_META_KIND = 'lab-workspace/figure-meta';
export const FIGURE_META_SUFFIX = '.meta.json';
/** Combien de sidecars « ⬇ Add missing from Drive » relit au plus en un clic
 *  (un canvas pèse quelques centaines de Ko : le geste doit rester un clic). */
export const META_RESTORE_MAX = 40;
/** Nom du sidecar d'une image : `<image>.meta.json` (l'extension de l'image est
 *  conservée, la paire se retrouve donc sans deviner le format). */
export const sidecarNameOfImageName = (imageName) => (imageName ? `${String(imageName)}${FIGURE_META_SUFFIX}` : '');
/** Le nom d'image porté par un sidecar (`''` si ce n'est pas un sidecar). */
export const imageNameOfSidecarName = (name) => (/\.meta\.json$/i.test(String(name || '')) ? String(name).replace(/\.meta\.json$/i, '') : '');
/** Ce fichier est-il le sidecar d'une image (et non une image) ? */
export const isFigureMetaFileName = (name) => /\.meta\.json$/i.test(String(name || ''));

/** Contenu du sidecar — `null` quand il n'y a rien à sauver (une image sans
 *  composition ni origine n'a pas besoin de sidecar). PUR. */
export const buildFigureMeta = ({ label = 'Figure', src = null, canvasData = null, imageName = '' } = {}) => {
  if (!canvasData && !src) return null;
  return {
    kind: FIGURE_META_KIND,
    v: 1,
    label: String(label || 'Figure'),
    src: src || null,
    canvasData: canvasData || null,
    imageName: String(imageName || ''),
    savedAt: new Date().toISOString()
  };
};

/** Relit un sidecar (texte JSON) — jamais d'exception, `null` si illisible. */
export const parseFigureMeta = (text) => {
  if (!text) return null;
  try {
    const d = typeof text === 'string' ? JSON.parse(text) : text;
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
};

/** Dépose le sidecar à côté de l'image (même dossier `<project>/images`).
 *  Best-effort : un sidecar manquant ne fait jamais échouer la figure, l'image
 *  et l'entrée de bibliothèque de ce poste restent valables. */
export const uploadFigureMetaToDrive = async ({ meta = null, imageName = '', projectName = '' } = {}) => {
  if (!meta || !imageName || !cloudBackendAvailable()) return null;
  const name = sidecarNameOfImageName(imageName);
  const body = JSON.stringify(meta);
  if (getCloudProvider() === 'nextcloud') {
    const parts = ['Lab Workspace'];
    const ds = getDriveRootName();
    if (ds) parts.push(sanitizeSlug(ds));
    parts.push(...projectImagesFolderPath(projectName));
    try {
      return await ncUploadFile({ parts, name, mimeType: 'application/json', file: body });
    } catch (err) {
      console.warn('Figure meta → Nextcloud upload failed:', err && err.message);
      return null;
    }
  }
  try {
    const ctx = { section: 'images' };
    if (projectName) ctx.project = projectName;
    return await uploadLocalFile({
      name,
      mimeType: 'application/json',
      file: new Blob([body], { type: 'application/json' }),
      path: projectImagesFolderPath(projectName),
      ctx
    });
  } catch (err) {
    console.warn('Figure meta → Drive upload failed:', err && err.message);
    return null;
  }
};

/** Relit le sidecar d'une image depuis le Drive (par identifiant de fichier). */
export const fetchFigureMetaFromDrive = async (fileId) => {
  if (!fileId) return null;
  try {
    return parseFigureMeta(await downloadDriveFileText(fileId));
  } catch { return null; }
};

/* ────────────────────────────────────────────────────────────────────────────
   LA BIBLIOTHÈQUE ⇄ LE DRIVE : deux gestes symétriques, ADDITIFS tous les deux.

   « Mes images ne sont pas sur le Drive » a deux causes possibles, et une
   réponse pour chacune :
     • les images capturées/importées alors que le Drive n'était PAS connecté
       vivent en base64 dans le navigateur (`full: 'data:image/…'`) : elles ne
       survivent pas à un changement d'ordinateur → pushLibraryToDrive() les
       envoie dans <dataset>/projects/<projet>/images et remplace la copie
       locale par le lien Drive (la vignette locale est conservée).
     • les images SONT dans le Drive mais leur LISTE (localStorage) a été perdue
       (autre poste, navigateur vidé) → pullLibraryFromDrive() relit le dossier
       et AJOUTE les fichiers qui manquent à la bibliothèque.
   Ni l'un ni l'autre ne supprime ni n'écrase une entrée : ils complètent.
   ──────────────────────────────────────────────────────────────────────────── */

/** Entrées dont les PIXELS ne sont pas sur le cloud (base64 local seulement). */
export const localOnlyLibraryItems = (items) => (Array.isArray(items) ? items : [])
  .filter((i) => i && !i.drive && typeof i.full === 'string' && i.full.startsWith('data:'));

/** Nombre d'images d'une portée qui ne sont pas encore sur le cloud. */
export const localOnlyLibraryCount = ({ scope = 'common', projectId = null } = {}) =>
  localOnlyLibraryItems(scope === 'project' ? readProjectLibrary(projectId) : readLibrary()).length;

/** Envoie au cloud les images d'une portée dont les pixels n'y sont pas encore
 *  (voir l'en-tête ci-dessus) et remplace leur copie locale par le lien Drive.
 *  La liste est relue à chaque étape : une capture faite pendant l'envoi n'est
 *  jamais perdue par un tableau périmé.
 *  @returns {{ total:number, uploaded:number, failed:number, folder:string,
 *              results:Array<{id:string,ok:boolean,driveUrl?:string}> }} */
export const pushLibraryToDrive = async ({ scope = 'common', projectId = null, projectName = '' } = {}) => {
  const out = {
    total: 0,
    uploaded: 0,
    failed: 0,
    folder: projectImagesFolderPath(projectName).join('/'),
    results: []
  };
  if (!cloudBackendAvailable()) return out;
  const read = () => (scope === 'project' ? readProjectLibrary(projectId) : readLibrary());
  const write = (next) => (scope === 'project' ? writeProjectLibrary(projectId, next) : writeLibrary(next));
  const pending = localOnlyLibraryItems(read());
  out.total = pending.length;
  if (!pending.length) return out;
  for (const item of pending) {
    let drive = null;
    try {
      drive = await uploadFigureToDrive({ full: item.full, label: item.label || 'figure', projectName });
    } catch { drive = null; }
    const url = (drive && drive.id && (drive.driveUrl || drive.url)) || '';
    if (!url) { out.failed += 1; out.results.push({ id: item.id, ok: false }); continue; }
    write(read().map((i) => (i && i.id === item.id
      ? { ...i, drive: true, driveUrl: url, full: url, updatedAt: new Date().toISOString() }
      : i)));
    out.uploaded += 1;
    out.results.push({ id: item.id, ok: true, driveUrl: url });
  }
  return out;
};

/** Id d'une entrée construite depuis un fichier de Drive : DÉTERMINISTE, donc
 *  relire le dossier deux fois n'ajoute jamais de doublon (la fusion d'une
 *  bibliothèque se fait par `id`). */
export const driveLibraryItemId = (fileId) => `lib_drive_${String(fileId || '').replace(/[^\w-]/g, '')}`;

/** Id de fichier Drive porté par une entrée de bibliothèque (lien « view »,
 *  vignette lh3) — '' pour une entrée qui n'a jamais été envoyée au cloud. */
export const driveIdOfLibraryItem = (item) => {
  const urls = [item && item.driveUrl, item && item.full, item && item.url].filter(Boolean);
  for (const u of urls) {
    const found = driveFileIdFromUrl(u) || String(u).match(/lh3\.googleusercontent\.com\/d\/([^/?#]+)/);
    if (found) return Array.isArray(found) ? found[1] : String(found);
  }
  return '';
};

/* ── QUAND LE MAGASIN DU NAVIGATEUR EST PLEIN ───────────────────────────────
   Les listes de la bibliothèque (commune `labFiguresLibrary`, et une par projet
   `labFiguresLib_<projet>`) sont un CACHE : leurs pixels sont sur le cloud. Une
   fois le magasin du navigateur plein (~5 Mo par site), c'est le plus gros
   poste qu'on peut rendre SANS RIEN PERDRE — à une condition : n'oublier que
   les entrées dont les pixels sont DÉJÀ sur le cloud et dont l'identifiant de
   fichier Drive se relit de l'entrée (elles reviennent avec « ⬇ Add missing
   from Drive », pullLibraryFromDrive ré-AJOUTE ce qui manque). Une entrée dont
   les pixels ne vivent que dans ce navigateur (localOnlyLibraryItems) n'est
   JAMAIS touchée : elle serait perdue pour de bon.

   Les listes EN MÉMOIRE suivent le magasin : sans cela, la première écriture de
   la bibliothèque (une capture, un renommage…) remettrait tout le poids en
   place et l'écriture des projets échouerait à nouveau.

   @returns {{ forgotten:number, freed:number, left:number, keys:string[] }} */
export const pruneRecoverableLibraryCaches = ({ storage } = {}) => {
  const out = { forgotten: 0, freed: 0, left: 0, keys: [] };
  let ls = storage;
  if (!ls) { try { ls = typeof localStorage !== 'undefined' ? localStorage : null; } catch { ls = null; } }
  if (!ls) return out;
  const keys = [];
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const k = String(ls.key(i) || '');
      if (k === LIBRARY_KEY || k.startsWith('labFiguresLib_')) keys.push(k);
    }
  } catch { return out; }
  keys.forEach((k) => {
    let items = null;
    try {
      const parsed = JSON.parse(ls.getItem(k));
      items = Array.isArray(parsed) ? parsed : null;
    } catch { items = null; }
    if (!items || !items.length) return;
    const kept = items.filter((i) => !(i && i.drive === true && driveIdOfLibraryItem(i)));
    const forgotten = items.length - kept.length;
    out.left += kept.length;
    if (!forgotten) return;
    out.forgotten += forgotten;
    out.keys.push(k);
    const before = JSON.stringify(items).length;
    try { ls.setItem(k, JSON.stringify(kept)); } catch { /* le magasin refuse encore : la mémoire suit quand même */ }
    out.freed += Math.max(0, before - JSON.stringify(kept).length);
    if (k === LIBRARY_KEY) memCommon = kept;
    else memProjects.set(k, kept);
  });
  return out;
};

/** Le nom de fichier d'un dossier d'images → libellé lisible :
 *  « CD_spectrum_2026-04.png » → « CD spectrum 2026-04 » (les tirets internes
 *  sont conservés : ils portent souvent une date ou une référence). */
export const labelFromDriveFileName = (name) => String(name || '')
  .replace(/\.[^/.]+$/, '')
  .replace(/_+/g, ' ')
  .trim();

/** Transforme le CONTENU d'un dossier Drive d'images en entrées de
 *  bibliothèque (PUR : testable hors navigateur). Les dossiers et les fichiers
 *  qui ne sont pas des images sont ignorés — y compris les sidecars
 *  `<image>.meta.json` (voir buildFigureMeta), qui ne sont PAS des images mais
 *  la composition éditable de l'image à côté de laquelle ils vivent : ils sont
 *  signalés sur l'entrée par `metaName`. `url` = vignette affichable,
 *  `full`/`driveUrl` = le lien du fichier (dont l'application sait relire les
 *  vrais pixels avec son jeton OAuth). */
export const libraryItemsFromDriveListing = (listing, { addedAt = '' } = {}) => {
  const out = [];
  const files = (Array.isArray(listing) ? listing : []).filter((f) => f && f.id && !(f.mimeType === 'application/vnd.google-apps.folder'));
  const names = new Set(files.map((f) => String(f.name || '').trim()));
  files.forEach((raw) => {
    const id = String((raw && raw.id) || '').trim();
    if (!id) return;
    const mime = String((raw && raw.mimeType) || '');
    const name = String((raw && raw.name) || '').trim();
    // Le sidecar d'une image n'est pas une image : il est relu par
    // pullLibraryFromDrive pour rendre le canvas rouvable dans l'éditeur.
    if (isFigureMetaFileName(name)) return;
    if (mime && !mime.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return;
    const view = String((raw && raw.webViewLink) || '').trim() || `https://drive.google.com/file/d/${id}/view`;
    const sidecar = sidecarNameOfImageName(name);
    out.push({
      id: driveLibraryItemId(id),
      label: labelFromDriveFileName(name) || 'Figure',
      url: `https://lh3.googleusercontent.com/d/${id}`,
      full: view,
      drive: true,
      driveUrl: view,
      src: null,
      canvasData: null,
      metaName: sidecar && names.has(sidecar) ? sidecar : null,
      addedAt: (raw && raw.createdTime) || addedAt || new Date().toISOString()
    });
  });
  return out;
};

/** Relit <dataset>/projects/<projet>/images et AJOUTE à la bibliothèque de la
 *  portée les fichiers qui n'y sont pas encore (ceux dont la liste a été perdue
 *  sur ce poste). Aucune entrée existante n'est remplacée.
 *
 *  Les sidecars `<image>.meta.json` y sont relus aussi : la composition
 *  ÉDITABLE d'un canvas (`canvasData`) et le repère d'origine d'une capture
 *  reviennent donc avec l'image. Sans cela, « ⬇ Add missing from Drive »
 *  ramenait un canvas comme une simple image — reconnue, mais plus modifiable :
 *  c'était la seconde moitié du bug « je ne retrouve pas mes canvas ».
 *
 *  @returns {{ folder:string, found:number, added:number, filled:number,
 *              restored:number, error:string }} */
export const pullLibraryFromDrive = async ({ scope = 'common', projectId = null, projectName = '' } = {}) => {
  const out = {
    folder: projectImagesFolderPath(projectName).join('/'),
    found: 0, added: 0, filled: 0, restored: 0, error: ''
  };
  if (!cloudBackendAvailable()) { out.error = 'Cloud storage is not connected.'; return out; }
  let listing = [];
  try {
    const resolved = await resolveDrivePathFromNames(projectImagesFolderPath(projectName));
    if (!resolved || !resolved.leafId) { out.error = `Folder not found: ${out.folder}`; return out; }
    listing = await listDriveChildren(resolved.leafId);
  } catch (err) {
    out.error = (err && err.message) || 'Could not read the Drive folder';
    return out;
  }
  const items = libraryItemsFromDriveListing(listing);
  // Ce qui a été SUPPRIMÉ à la main ne revient pas : la lecture du dossier est
  // additive, mais pas au point de ressusciter une image retirée (voir
  // rememberLibraryTrash).
  const trash = new Set(readLibraryTrash(scope === 'project' ? (projectId || 'common') : 'common'));
  const tombstoned = (it) => trashIdsOfEntry(it).some((id) => trash.has(id));
  out.found = items.length;
  const current = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  // Un fichier déjà référencé par une entrée (même si celle-ci n'a pas d'id
  // `lib_drive_…`) ne crée pas de doublon.
  const known = new Set(current.map((i) => driveIdOfLibraryItem(i)).filter(Boolean));
  const missing = items.filter((i) => !known.has(driveIdOfLibraryItem(i)) && !tombstoned(i));
  // Les sidecars présents dans le dossier : { nom du sidecar → id de fichier }.
  const sidecarIdByName = new Map();
  const fileNameById = new Map();
  (Array.isArray(listing) ? listing : []).forEach((f) => {
    if (!f || !f.id) return;
    const name = String(f.name || '');
    if (name) fileNameById.set(String(f.id), name);
    if (isFigureMetaFileName(name)) sidecarIdByName.set(name, String(f.id));
  });
  if (!items.length && !sidecarIdByName.size) return out;
  if (sidecarIdByName.size) {
    // Ce qu'il faut compléter : les entrées qui arrivent SANS composition, plus
    // les entrées déjà présentes mais sans `canvasData` (liste reconstruite
    // depuis le Drive par une version précédente, ou perdue par ce poste).
    const candidates = [...missing, ...current.filter((i) => i && !i.canvasData && !tombstoned(i))];
    const seen = new Set();
    for (const it of candidates) {
      if (!it) continue;
      const imageName = isFigureMetaFileName(it.metaName || '')
        ? imageNameOfSidecarName(it.metaName)
        : String(fileNameById.get(driveIdOfLibraryItem(it)) || '');
      const metaName = it.metaName || (imageName ? sidecarNameOfImageName(imageName) : '');
      const fileId = metaName ? sidecarIdByName.get(metaName) : '';
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      if (seen.size > META_RESTORE_MAX) break;   // borné : le geste reste un clic
      const meta = await fetchFigureMetaFromDrive(fileId).catch(() => null);
      if (!meta) continue;
      if (meta.canvasData) { it.canvasData = meta.canvasData; out.restored += 1; }
      if (!it.src && meta.src) it.src = meta.src;
      if (meta.label && !it.label) it.label = meta.label;
      it.metaName = metaName;
    }
  }
  if (!missing.length && !out.restored) return out;
  const res = mergeLibraryList(current, missing);
  if (res.added || res.filled || out.restored) {
    if (scope === 'project') writeProjectLibrary(projectId, res.list);
    else writeLibrary(res.list);
  }
  out.added = res.added;
  out.filled = res.filled;
  return out;
};

