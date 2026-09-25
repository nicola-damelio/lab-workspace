import { getDriveToken, uploadLocalFile, dataUrlToBlob, cloudBackendAvailable, getDriveRootName, resolveDrivePathFromNames, listDriveChildren, downloadDriveFileText, takeLastUploadQueueInfo, renameDriveFile, getDriveFileMeta, findDriveFileByName, moveDriveFile, registerDriveFile, getDriveFileRegistry } from './driveUpload';
import { sanitizeSlug, projectImagesFolderPath } from './driveNaming';
/* Où est VRAIMENT le dossier d'images d'un projet (voir utils/figuresFolder.js) :
   l'emplacement canonique est dérivé du NOM du projet, donc un renommage — ou un
   dossier renommé à la main — laissait les fichiers ailleurs pendant que
   l'application en créait un jumeau vide. Ce résolveur cherche, ne crée rien, et
   sait demander à l'utilisateur plutôt que de deviner. */
import { findProjectFiguresFolder, adoptProjectFiguresFolder, listProjectFiguresFolders, imagesFolderPathOnDrive, commonLibraryFolderName, commonLibraryFolderNames } from './figuresFolder';
import { getCloudProvider, isNextcloudUrl, ncFetchBlob, ncMove, ncUploadFile } from './nextcloud';
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
/** Les NOMS de canvas gardés À PART (voir plus bas) : `{ <id d'entrée>: <nom> }`. */
const CANVAS_NAMES_KEY = 'labCanvasNames';

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
/** @returns {boolean} true quand le NAVIGATEUR a réellement gardé la liste
 *  (donc qu'elle survivra à un rafraîchissement), false quand le magasin a
 *  refusé TOUT (liste gardée en mémoire pour la session seulement). L'appelant
 *  peut alors le DIRE au lieu de laisser croire que c'est enregistré — un
 *  renommage qui « ne marche pas » est presque toujours cette écriture-là. */
/** Sort de la DERNIÈRE écriture de liste (voir saveLS ci-dessous) : `kept:false`
 *  = le navigateur a REFUSÉ la liste (elle ne vit que dans cette session). Les
 *  appelants qui doivent avertir (« magasin plein ») le lisent ici — c'est utile
 *  quand le geste lui-même a pu aboutir par un autre chemin (un renommage garde
 *  le NOM à part, voir rememberCanvasName). */
let lastListWrite = { key: '', kept: true };
export const lastLibraryListWrite = () => ({ ...lastListWrite });

const saveLSRaw = (k, items) => {
  try { localStorage.setItem(k, JSON.stringify(items)); return true; }
  catch { /* magasin plein → on essaie de faire de la place, sans rien perdre (ci-dessous) */ }
  /* ── UN MAGASIN PLEIN NE DOIT PLUS FAIRE DISPARAÎTRE UNE LISTE ──────────────
     ⛔ LE DÉFAUT. `catch { }` avalait le refus du navigateur : la liste restait
        en MÉMOIRE, donc complète jusqu'au rechargement… puis vide. C'est très
        exactement « je sauve, je quitte, mon travail n'y est plus, il faut
        aller le rechercher dans la bibliothèque », et le seul recours était
        « ⬇ Add missing from Drive ».
     ✅ CE QUI EST FAIT ICI. On libère d'abord ce qui est DÉJÀ ailleurs, en
        gardant TOUTES les entrées (libellé, ordre, `canvasData`, lien Drive) :
          1. la copie haute résolution (`full`) des entrées dont le FICHIER EST
             SUR LE CLOUD devient son lien — les pixels se relisent du Drive
             (voir resolveImageToDataUrl), c'est le chemin prévu ;
          2. si ça ne suffit pas, la vignette (`url`) de ces mêmes entrées —
             elles s'affichent alors depuis le cloud.
        Une entrée dont les pixels ne vivent que dans ce navigateur (pas de lien
        cloud) n'est JAMAIS touchée : elle serait perdue pour de bon.
        Un refus définitif laisse la liste en mémoire, comme avant. */
  const slim = shrinkLibraryEntryPixels(items);
  if (slim.freed) {
    rememberLibraryList(k, slim.items);
    try { localStorage.setItem(k, JSON.stringify(slim.items)); return true; } catch { /* encore plein */ }
  }
  const thinner = shrinkLibraryEntryPixels(slim.items, { dropThumbs: true });
  if (thinner.freed) {
    rememberLibraryList(k, thinner.items);
    try { localStorage.setItem(k, JSON.stringify(thinner.items)); return true; } catch { /* mémoire seulement */ }
  }
  return false;
};
/** L'écriture RÉELLE, avec son sort retenu (voir lastLibraryListWrite). */
const saveLS = (k, items) => {
  const kept = saveLSRaw(k, items);
  lastListWrite = { key: k, kept };
  return kept;
};
/** La liste EN MÉMOIRE suit exactement ce qui a pu être écrit (sinon la
 *  première écriture suivante remettrait le poids qui vient d'être libéré). */
const rememberLibraryList = (k, items) => {
  if (k === LIBRARY_KEY) memCommon = items;
  else memProjects.set(k, items);
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

/* ── LES NOMS DE CANVAS, DANS UN COIN À PART ──────────────────────────────────
   « the rename function does not work » : le nom changeait à l'écran, puis
   revenait tout seul. La cause n'est pas le renommage — c'est le magasin du
   navigateur, plein (des mégaoctets de pixels y sont écrits plusieurs fois par
   composition), qui REFUSE de réécrire TOUTE la liste. La liste ne survit alors
   que dans cette session, et le prochain rafraîchissement repart du libellé
   écrit la dernière fois.

   Un nom pèse quelques octets : on le garde donc AUSSI dans une petite clé
   dédiée (`labCanvasNames`, `{ <id d'entrée>: <nom> }`) — celle-là rentre même
   quand la liste ne rentre plus — et on l'APPLIQUE À LA LECTURE des listes. La
   liste reste la source quand son écriture passe (un renommage réussi efface la
   ligne de l'overlay : c'est la liste qui fait foi), et l'overlay ne couvre que
   ce que le magasin a refusé. Un renommage ne se perd donc plus au
   rafraîchissement, même avec un magasin saturé.

   Cette clé commence par « lab » : elle voyage dans le miroir des clés comme les
   autres, et la fusion est l'union des deux copies (voir plus bas). */
let memNames = null;
let namesVersion = 0;               // change à chaque écriture de l'overlay
const namedCache = new WeakMap();   // liste d'entrée → liste nommée (même version)
const nameOverlay = () => {
  if (memNames === null) {
    try {
      const o = JSON.parse(localStorage.getItem(CANVAS_NAMES_KEY));
      memNames = (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch { memNames = {}; }
  }
  return memNames;
};
/** Garde un nom à part (quelques octets : ça rentre même dans un magasin plein).
 *  @returns {boolean} true quand le NAVIGATEUR l'a gardé (donc qu'il survit au
 *  rafraîchissement). */
export const rememberCanvasName = (id, label) => {
  const k = String(id || '').trim();
  const v = String(label || '').trim();
  if (!k || !v) return false;
  memNames = { ...nameOverlay(), [k]: v };
  namesVersion += 1;   // les listes déjà nommées seront recalculées (cache par version)
  try { localStorage.setItem(CANVAS_NAMES_KEY, JSON.stringify(memNames)); return true; }
  catch { return false; }
};
/** Oublie le nom gardé à part d'une entrée : quand la liste elle-même a été
 *  écrite (elle fait foi), ou quand l'entrée est supprimée. */
export const forgetCanvasName = (id) => {
  const k = String(id || '').trim();
  const map = nameOverlay();
  if (!k || !(k in map)) return;
  const next = { ...map };
  delete next[k];
  memNames = next;
  namesVersion += 1;
  try { localStorage.setItem(CANVAS_NAMES_KEY, JSON.stringify(next)); } catch { /* la liste reste juste */ }
};
/** Applique les noms gardés à part à une liste. PUR, et de plus STABLE : la même
 *  liste (même référence) et le même overlay rendent la MÊME liste — les écrans
 *  qui lisent la bibliothèque pendant leur rendu ne sont donc pas secoués par un
 *  tableau neuf à chaque appel. */
export const withCanvasNames = (items) => {
  if (!Array.isArray(items) || !items.length) return items;
  const map = nameOverlay();
  if (!Object.keys(map).length) return items;
  const hit = namedCache.get(items);
  if (hit && hit.version === namesVersion) return hit.list;
  let touched = false;
  const out = items.map((i) => {
    const want = i ? map[i.id] : null;
    if (!want || want === i.label) return i;
    touched = true;
    return { ...i, label: want };
  });
  const list = touched ? out : items;
  namedCache.set(items, { version: namesVersion, list });
  return list;
};
/** Union de deux copies de l'overlay (miroir des clés). Pour un même id il n'y a
 *  pas d'horodatage à comparer : la copie LOCALE gagne (c'est le nom que l'on
 *  vient de taper sur ce poste), l'autre poste adopte le résultat. PUR. */
export const mergeCanvasNameValues = (key, localRaw, remoteRaw) => {
  const parse = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { const v = JSON.parse(raw); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; } catch { return null; }
  };
  const local = parse(localRaw);
  const remote = parse(remoteRaw);
  if (!local && !remote) return '';
  if (!local) return String(remoteRaw);
  if (!remote) return String(localRaw);
  const out = { ...remote, ...local };
  return JSON.stringify(out) === JSON.stringify(local) ? String(localRaw) : JSON.stringify(out);
};
export const isCanvasNamesKey = (key) => String(key || '') === CANVAS_NAMES_KEY;
registerKeyValueMerger(isCanvasNamesKey, mergeCanvasNameValues);

// ---- active project context (kept in sync by App.jsx) -----------------------
// Lets the molecule viewer / experiment pages know which project's library an
// exported image should go to without threading a prop through every section.
let activeProjectId = null;
export const setActiveProjectId = (id) => { activeProjectId = id || null; };
export const getActiveProjectId = () => activeProjectId;

// ---- common (app-wide) library ----------------------------------------------
// Les noms gardés à part s'appliquent ICI : c'est le SEUL chemin de lecture des
// listes, donc tout l'écran (page projet, modale 🖼 Library, panneau Image
// library) voit le nom renommé, même quand la liste n'a pas pu être réécrite.
export const readLibrary = () => withCanvasNames(memCommonList());
export const writeLibrary = (items) => {
  memCommon = Array.isArray(items) ? items : [];
  return saveLS(LIBRARY_KEY, memCommon);
};

// ---- project-scoped library ---------------------------------------------------
export const readProjectLibrary = (projectId) => withCanvasNames(memProjectList(projectId));
export const writeProjectLibrary = (projectId, items) => {
  const k = projectLibraryKey(projectId);
  memProjects.set(k, Array.isArray(items) ? items : []);
  return saveLS(k, memProjects.get(k));
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
  forgetCanvasName(id);   // l'entrée n'existe plus : son nom à part n'a plus d'objet
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
/** Renommer une entrée de la bibliothèque partagée.
 *  Le nom est écrit DANS la liste ; si le magasin refuse cette écriture (plein),
 *  il est gardé à part (`rememberCanvasName`) et s'appliquera à la lecture : le
 *  nom survit donc au rafraîchissement dans les deux cas.
 *  @returns {boolean} true quand le nom est GARDÉ (liste ou nom à part), false
 *  quand le magasin a refusé LES DEUX (le nom ne vit que dans cette session —
 *  l'appelant doit le dire : c'est le « le renommage ne marche pas »). */
export const renameLibraryItem = (id, label) => {
  const kept = writeLibrary(readLibrary().map((i) => (i.id === id ? { ...i, label } : i)));
  // La liste fait foi quand elle a pu être écrite ; sinon le nom tient seul.
  if (kept) { forgetCanvasName(id); return true; }
  return rememberCanvasName(id, label);
};
export const removeProjectLibraryItem = (projectId, id) => {
  const list = readProjectLibrary(projectId);
  const gone = list.find((i) => i && i.id === id);
  if (gone) rememberLibraryTrash(projectId || 'common', trashIdsOfEntry(gone));
  forgetCanvasName(id);   // l'entrée n'existe plus : son nom à part n'a plus d'objet
  return writeProjectLibrary(projectId, list.filter((i) => !i || i.id !== id));
};
/** Renommer l'entrée d'un canvas (ou de n'importe quelle image) dans la
 *  bibliothèque d'un projet. L'id, la composition (`canvasData`) et la clé de
 *  canvas ne bougent pas : les liens des figures continuent de viser cette
 *  entrée-là.
 *  @returns {boolean} true quand le nom est GARDÉ (la liste, ou le nom gardé à
 *  part quand le magasin est plein), false quand RIEN n'a pu être écrit. */
export const renameProjectLibraryItem = (projectId, id, label) => {
  const kept = writeProjectLibrary(projectId, readProjectLibrary(projectId).map((i) => (i.id === id ? { ...i, label } : i)));
  if (kept) { forgetCanvasName(id); return true; }
  return rememberCanvasName(id, label);
};
// Move an item between scopes (e.g. save a common figure into a project).
export const moveLibraryItem = (fromScope, toScope, projectId, id) => {
  const src = fromScope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const it = src.find((i) => i.id === id);
  if (!it) return;
  /* Le déplacement est IDEMPOTENT : si l'entrée est DÉJÀ dans la bibliothèque
     d'arrivée (c'est le cas d'une image que l'ancien défaut d'union avait
     laissée dans deux bibliothèques à la fois), elle y est remise en tête au
     lieu d'être empilée deux fois — rejouer le geste pour réparer ne fabrique
     donc pas un doublon. */
  const keepId = (list) => (Array.isArray(list) ? list : []).filter((i) => !i || String(i.id || '') !== String(id));
  if (toScope === 'project') writeProjectLibrary(projectId, [it, ...keepId(readProjectLibrary(projectId))]);
  else writeLibrary([it, ...keepId(readLibrary())]);
  if (fromScope === 'project') writeProjectLibrary(projectId, src.filter((i) => i.id !== id));
  else writeLibrary(src.filter((i) => i.id !== id));
  /* ── UN DÉPLACEMENT SE NOTE — sinon il ne survit pas au miroir des clés ──────
     ⛔ LE DÉFAUT. Les listes de bibliothèque voyagent dans `_workspace/keys.json`
     et leur fusion est une UNION (voir mergeLibraryKeyValues / mergeLibraryLists).
     Une union sait écarter ce qui a été SUPPRIMÉ (les pierres tombales de la
     corbeille) mais pas ce qui a été DÉPLACÉ : la copie de l'autre poste, qui a
     encore l'image dans la bibliothèque d'origine, la faisait revenir au
     démarrage suivant. C'est très exactement « j'ai déplacé des images de la
     bibliothèque générale vers celle d'un projet, et sur l'autre poste elles
     sont ENCORE dans la générale » — et la même image se retrouvait alors dans
     deux, puis trois portées à la fois.
     ✅ CE QUI EST FAIT ICI. La note de la portée QUITTÉE est posée (même
     mécanisme que la corbeille : elle écarte l'entrée des DEUX côtés d'une
     fusion) et celle de la portée REJOINTE est effacée — un déplacement en sens
     inverse reste donc possible, et une image déplacée peut être relue du
     dossier Drive de sa nouvelle portée (voir moveLibraryItemOnDrive). */
  const leaving = fromScope === 'project' ? (projectId || 'common') : 'common';
  const arriving = toScope === 'project' ? (projectId || 'common') : 'common';
  const ids = trashIdsOfEntry(it);
  rememberLibraryTrash(leaving, ids);
  if (arriving !== leaving) forgetLibraryTrash(arriving, ids);
};

/** ⛔ LA LISTE ADOPTÉE DU DRIVE N'ATTEIGNAIT PAS L'ÉCRAN.
 *
 *  `adoptKeysFromDrive` (workspaceKeyStore) écrit les valeurs adoptées DIRECTEMENT
 *  dans `localStorage`. Or les listes de bibliothèque vivent D'ABORD dans le
 *  miroir mémoire de ce module (`memCommon`, `memProjects`) : remplies une fois,
 *  elles ne sont plus relues du magasin de la session. Un poste qui avait déjà
 *  affiché sa bibliothèque (le cas courant : le Drive se connecte APRÈS
 *  l'ouverture de la page, ou l'adoption se termine après le premier rendu)
 *  gardait donc l'ANCIENNE liste jusqu'au rechargement suivant — « les images
 *  déplacées ne sont pas dans la bibliothèque du projet », même quand le Drive
 *  les y avait bien mises.
 *
 *  Cette fonction vide les miroirs (la prochaine lecture repart du magasin, donc
 *  des valeurs adoptées) et prévient les écrans (même événement qu'une
 *  restauration de sauvegarde, que les panneaux écoutent déjà). Appelée par
 *  App.jsx dès que des clés ont été adoptées. */
export const refreshLibraryFromStorage = () => {
  memCommon = null;
  memProjects.clear();
  memNames = null;       // les noms de canvas adoptés, eux aussi, doivent se voir
  namesVersion += 1;
  try { window.dispatchEvent(new CustomEvent('lab:figures-library-restored')); } catch { /* hors navigateur */ }
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
 * • clé d'identité = `id`, puis la clé de COMPOSITION (`canvasData.canvasKey`)
 *   puis le fichier cloud : un même canvas relu d'un autre poste, ou repris
 *   d'un dossier Drive sous un autre id, complète son entrée au lieu d'en créer
 *   une seconde (c'est ce qui remplissait « 🖼 Saved canvases » de copies) ;
 * • les entrées nouvelles sont AJOUTÉES À LA FIN : l'ordre existant est
 *   conservé tel quel (la bibliothèque n'est pas réordonnée par un import) ;
 * • une entrée déjà présente n'est jamais remplacée, seulement complétée.
 * Les objets de `current` sont modifiés EN PLACE : le miroir mémoire
 * (readLibrary / readProjectLibrary) voit donc les champs complétés.
 */
export const mergeLibraryList = (current, incoming) => {
  const list = Array.isArray(current) ? current.slice() : [];
  const byId = new Map();
  const byCanvas = new Map();   // même composition (canvasData.canvasKey)
  const byDrive = new Map();    // même fichier cloud
  const remember = (it) => {
    if (!it || !it.id) return;
    byId.set(it.id, it);
    const k = canvasKeyOfEntry(it);
    if (k && !byCanvas.has(k)) byCanvas.set(k, it);
    const d = driveIdOfLibraryItem(it);
    if (d && !byDrive.has(d)) byDrive.set(d, it);
  };
  list.forEach(remember);
  let added = 0;
  let filled = 0;
  (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const item = { ...raw };
    if (!item.id) item.id = uid('lib');
    // Même `id`, même COMPOSITION (canvas), même fichier cloud : c'est la même
    // entrée, on la complète. Seul ce qui n'a ni l'un ni l'autre est un ajout —
    // c'est ce qui empêche une liste d'un autre poste ou une relecture du Drive
    // d'empiler des copies du même canvas.
    const key = canvasKeyOfEntry(item);
    const d = driveIdOfLibraryItem(item);
    const prev = byId.get(item.id)
      || (key ? byCanvas.get(key) : null)
      || (d ? byDrive.get(d) : null);
    if (!prev) {
      if (!item.addedAt) item.addedAt = new Date().toISOString();
      list.push(item);
      remember(item);
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

/** Clé de COMPOSITION d'une entrée : l'identité que la composition porte
 *  ELLE-MÊME (`canvasData.canvasKey`, posée par l'Image Builder). Deux copies du
 *  même canvas — deux postes, une liste de navigateur allégée, une relecture du
 *  dossier Drive — la partagent même quand leurs `id` diffèrent : c'est ce qui
 *  les fait se FUSIONNER au lieu de s'empiler. `''` pour tout ce qui n'est pas
 *  un canvas (ou pour un canvas enregistré avant cette clé). PUR. */
export const canvasKeyOfEntry = (i) => String((i && i.canvasData && i.canvasData.canvasKey) || '').trim();

/** Identité d'une entrée de bibliothèque : deux copies de la MÊME figure que
 *  deux postes nomment différemment restent reconnues par leur composition
 *  (clé de canvas) ou, à défaut, par leur fichier cloud. */
export const libraryEntryIdentity = (i) => {
  const cv = canvasKeyOfEntry(i);
  if (cv) return `canvas:${cv}`;
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
export const mergeLibraryKeyValues = (key, localRaw, remoteRaw, ctx = null) => {
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
  /* Les notes de CETTE portée — celles du magasin local ET celles qui arrivent
     dans cette fusion (déplacement ou suppression faits sur un autre poste). */
  const trash = effectiveLibraryTrash(libraryScopeKeyOfKey(key) || 'common', ctx);
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

/** EFFACER des pierres tombales — réservé à un geste EXPLICITE de restauration.
 *
 *  Une suppression notée est respectée par les deux côtés d'une fusion (voir
 *  mergeLibraryLists / pullLibraryFromDrive) : c'est ce qui empêche une image
 *  retirée à la main de revenir. Mais un nettoyage de copies (`🧹 Remove
 *  duplicate canvases`, qui ne supprime RIEN sur le Drive) note aussi les
 *  fichiers des copies fusionnées — et quand le poste, plus tard, a perdu sa
 *  liste (magasin plein, navigateur vidé), plus rien ne peut ramener le canvas
 *  depuis le Drive : « restore missing from Drive did not revive it ».
 *
 *  Quand l'utilisateur dit lui-même « c'est CE canvas que je veux retrouver »
 *  (📥 Restore a canvas file, ou une entrée que l'on vient de réécrire), ces
 *  pierres tombales-là n'ont plus de sens : elles partent. @returns {string[]} */
export const forgetLibraryTrash = (scopeKey, ids) => {
  const drop = new Set((Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '')).filter(Boolean));
  const kept = readLibraryTrash(scopeKey).filter((id) => !drop.has(id));
  try { localStorage.setItem(libraryTrashKey(scopeKey), JSON.stringify(kept)); } catch { /* quota : la liste en mémoire reste juste */ }
  return kept;
};

/** TOUTES les pierres tombales d'une portée, y compris celles qui viennent
 *  d'ARRIVER dans la fusion en cours (`ctx.rawValuesOf`, voir
 *  workspaceKeyStore.mergedKeyValue), en plus de celles du magasin local.
 *
 *  ⛔ POURQUOI. `mergeLibraryKeyValues` filtrait avec les seules notes LOCALES.
 *  Un poste qui recevait un déplacement pour la PREMIÈRE fois (autre navigateur,
 *  navigateur vidé, Drive qui se connecte après coup) fusionnait donc sa liste
 *  AVANT d'avoir enregistré la note correspondante — et republiait une fois
 *  l'image dans la bibliothèque qu'elle venait de quitter (« les images
 *  déplacées sont encore dans la bibliothèque générale sur l'autre poste »),
 *  jusqu'à un second tour de synchronisation. Les deux côtés d'une fusion
 *  respectent maintenant la MÊME union de notes, comme le fait déjà la clé de
 *  corbeille elle-même (mergeLibraryTrashValues).
 *  @returns {string[]} identifiants à écarter de cette portée */
export const effectiveLibraryTrash = (scopeKey, ctx = null) => {
  const ids = new Set(readLibraryTrash(scopeKey));
  const raws = (ctx && typeof ctx.rawValuesOf === 'function') ? ctx.rawValuesOf(libraryTrashKey(scopeKey)) : [];
  (Array.isArray(raws) ? raws : []).forEach((raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    try {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) a.forEach((x) => { if (typeof x === 'string' && x) ids.add(x); });
    } catch { /* note illisible : le magasin local fait foi */ }
  });
  return [...ids];
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
//
// `opts.fresh` = « les VRAIS pixels d'AUJOURD'HUI, même si le navigateur en a
// une copie » (`cache: 'no-store'`). Une figure réécrite SUR PLACE sur le Drive
// garde son identifiant, donc la MÊME URL : c'est ce qu'il faut quand les pixels
// vont être INSÉRÉS dans un canvas (la vignette cliquée doit être l'image
// obtenue), et ce qu'il ne faut PAS pour un simple affichage — d'où l'option
// plutôt qu'un réglage global.
export const resolveImageToDataUrl = async (src, { fresh = false } = {}) => {
  const s = String(src || '');
  if (s.startsWith('data:image/')) return s;
  if (!/^https?:\/\//i.test(s)) return s;
  const cacheOpt = fresh ? { cache: 'no-store' } : {};
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
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, ...cacheOpt });
      if (res && res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) return await blobToDataUrl(blob);
      }
    }
    const res2 = await fetch(s, { mode: 'cors', ...cacheOpt });
    if (res2 && res2.ok) {
      const blob = await res2.blob();
      if (blob && blob.size > 0) return await blobToDataUrl(blob);
    }
  } catch { /* keep the original URL */ }
  return s;
};

// Une image VECTORIELLE (SVG) ne se pose pas telle quelle dans un .docx : Word y
// attend des pixels (il sait lire un SVG, mais seulement accompagné d'une image de
// repli qu'il n'appartient pas à ce programme de fabriquer). On la dessine donc
// dans un canvas — elle vient d'un `data:` URL, la toile n'est donc jamais
// « teintée » — et le PNG qui en sort la remplace. Tout ce qui n'est pas un SVG
// est rendu tel quel ; un échec rend une chaîne vide (l'image ne partira pas).
export const rasterizeSvgImage = (src) => new Promise((resolve) => {
  const s = String(src || '');
  if (!s.startsWith('data:image/svg+xml')) { resolve(s); return; }
  try {
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.max(1, img.naturalWidth || img.width || 1200);
        const h = Math.max(1, img.naturalHeight || img.height || 800);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = s;
  } catch { resolve(''); }
});

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

   `canvasKey` = la clé de composition de ce canvas (voir canvasKeyOfEntry) :
   elle est posée dans la composition écrite ET sert à retrouver l'entrée quand
   `updateId` n'est pas connu (page rechargée, autre ordinateur) — sans elle,
   chaque sauvegarde ajoutait une copie du même canvas.

   @returns {{ entry:object|null, updated:boolean }} */
export const saveCanvasSnapshot = ({
  scope = 'common', projectId = null, label = 'Canvas', updateId = null,
  canvasKey = '', canvasData = null, src = null, url = null
} = {}) => {
  if (!canvasData) return { entry: null, updated: false };
  const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const key = String(canvasKey || canvasData.canvasKey || '').trim();
  // L'entrée de CE canvas : celle dont l'éditeur se souvient, sinon celle que sa
  // clé de composition retrouve dans la bibliothèque.
  const prev = (updateId ? list.find((i) => i && i.id === updateId) : null)
    || (key ? list.find((i) => canvasKeyOfEntry(i) === key) : null);
  const name = String(label || 'Canvas').trim() || 'Canvas';
  // La date portée par la composition : deux canvas du même nom s'arbitrent par
  // elle (voir mergeLibraryEntryPair), et la fusion l'utilise pour choisir la
  // composition la plus récente.
  const stamped = { ...canvasData, ...(key ? { canvasKey: key } : {}), updatedAt: new Date().toISOString() };
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

/** L'entrée de bibliothèque qui porte DÉJÀ cette composition (`canvasKey`), dans
 *  la portée demandée — ou null. C'est ce que l'Image Builder interroge avant de
 *  sauver : un canvas a UNE entrée par bibliothèque, jamais plusieurs. */
export const findCanvasEntryByKey = ({ scope = 'common', projectId = null, canvasKey = '' } = {}) => {
  const key = String(canvasKey || '').trim();
  if (!key) return null;
  try {
    const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
    return (list || []).find((i) => canvasKeyOfEntry(i) === key) || null;
  } catch { return null; }
};

/** L'ENTRÉE de bibliothèque qui possède DÉJÀ le fichier cloud de cette FIGURE :
 *  son identité (`figureFileIdentity` : la clé de composition d'un canvas, ou
 *  l'origine d'une capture — expérience, instance, graphe ET image capturée) est
 *  celle qui donne le NOM du fichier envoyé par publishLibraryFigure. Deux
 *  captures de la MÊME image écrivent donc LE MÊME fichier : la seconde DOIT
 *  mettre à jour cette entrée-là, sinon l'ancienne garderait sa vignette et ses
 *  pixels d'hier en pointant sur un fichier qui n'est plus elle — c'est
 *  exactement le « la vignette de la bibliothèque ne correspond pas à l'image
 *  que j'insère : je crois prendre l'un et j'obtiens l'autre ».
 *
 *  Deux images DIFFÉRENTES du même graphe (l'axe X passé de DAPI à l'annexine)
 *  n'ont pas la même identité (l'empreinte du contenu en fait partie) : elles ne
 *  se retrouvent pas ici, et la seconde devient une figure de plus au lieu
 *  d'écraser la première. `null` quand rien ne correspond : la figure n'a jamais
 *  été capturée, elle crée alors son entrée comme avant. PUR (lecture seule). */
export const findLibraryEntryByIdentity = ({ scope = 'common', projectId = null, identity = '' } = {}) => {
  const ident = String(identity || '').trim();
  if (!ident) return null;
  try {
    const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
    return (list || []).find((i) => i && figureFileIdentity(i) === ident) || null;
  } catch { return null; }
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
export const publishLibraryFigure = async ({ scope = 'common', projectId = null, projectName = '', dataUrl, label = 'Figure', src = null, canvasData = null, updateId = null, insertIfMissing = true, identity = '' }) => {
  const srcData = await resolveImageToDataUrl(dataUrl);
  const isSvg = typeof srcData === 'string' && (srcData.startsWith('data:image/svg+xml') || srcData.includes('<svg'));
  // High-resolution copy (uploaded to Drive / kept as fallback): capped raster,
  // vector SVGs stay untouched.
  let hi = srcData;
  if (!isSvg) {
    const keepAlpha = await hasTransparency(srcData);
    hi = await downscaleImage(srcData, 2400, keepAlpha ? 'image/png' : 'image/jpeg', keepAlpha ? 0.92 : 0.88, !keepAlpha);
  }
  // L'identité de fichier de CETTE publication : le nom du fichier en dépend, et
  // le renommage préalable doit viser EXACTEMENT le même nom que l'envoi.
  const ident = String(identity || '').trim() || figureFileIdentity({ src, canvasData });
  /* L'ENTRÉE VISÉE, LUE AVANT L'ENVOI : son fichier cloud porte peut-être encore
     le nom d'AVANT (une toile renommée — voir renameFigureOnDrive). On le
     renomme D'ABORD, sinon l'envoi ci-dessous ne retrouve plus le fichier par
     son nom : il en dépose un SECOND et laisse l'ancien dans le dossier. C'est
     aussi ce qui rattrape les envois d'avant cette correction (nom sans
     empreinte) : la prochaine sauvegarde les ramène au nom d'aujourd'hui, avec
     leur identifiant de fichier — donc sans casser les liens des figures. */
  let prevEntry = null;
  if (updateId) {
    const before = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
    const key = canvasData && String(canvasData.canvasKey || '').trim();
    prevEntry = (before || []).find((i) => i && i.id === updateId)
      || (key ? (before || []).find((i) => canvasKeyOfEntry(i) === key) : null)
      || null;
    // Rien à faire quand l'entrée s'appelle déjà comme on le demande ET que rien
    // ne nous dit qu'elle porte un autre nom sur le cloud (son sidecar, lui, le
    // dit gratuitement) : aucune requête n'est faite dans ce cas-là.
    if (prevEntry && prevEntry.driveUrl
      && (String(prevEntry.label || '') !== String(label || '')
        || !!imageNameOfSidecarName(prevEntry.metaName || ''))) {
      try {
        await renameFigureOnDrive({ scope, projectId, projectName, id: prevEntry.id, label, identity: ident });
      } catch { /* le nom actuel reste celui de l'envoi ci-dessous */ }
    }
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
        // Le nom du fichier porte l'identité de la figure (clé de composition du
        // canvas, ou origine du graphe capturé) : sans elle, deux figures du même
        // libellé écrites dans le même dossier seraient LE MÊME fichier — la
        // seconde capture remplaçant la première (« la même image quel que soit
        // le graphe cliqué »). Voir « UNE FIGURE = UN FICHIER ».
        drive = await uploadFigureToDrive({
          full: hi,
          label,
          projectName,
          identity: ident
        });
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
    // `prev` = l'entrée visée, sinon — l'id est perdu mais la COMPOSITION est là
    // (même clé de canvas) — celle qui porte déjà cette composition : on la met à
    // jour au lieu d'ajouter une copie de plus (c'est ainsi qu'une bibliothèque
    // se remplissait de dizaines de copies du même canvas).
    const prevByKey = canvasData && String(canvasData.canvasKey || '').trim()
      ? list.find((i) => canvasKeyOfEntry(i) === String(canvasData.canvasKey).trim())
      : null;
    const prev = list.find((i) => i.id === updateId) || prevByKey;
    if (prev) {
      const updated = { ...prev, ...item, id: prev.id, addedAt: prev.addedAt, updatedAt: new Date().toISOString() };
      // ⚠ C'est `prev.id` — PAS `updateId` — qui désigne la ligne à réécrire :
      // quand l'entrée a été retrouvée par sa COMPOSITION (l'id était perdu), le
      // filtre sur `updateId` ne remplaçait RIEN et la fonction annonçait pourtant
      // « mise à jour » : les pixels et la vignette d'aujourd'hui n'arrivaient
      // jamais dans la liste (« la vignette de la bibliothèque ne se met pas à
      // jour »), alors que le fichier cloud, lui, avait bien été réécrit.
      const next = list.map((i) => (i.id === prev.id ? updated : i));
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
// the same origin stamp (experiment + condition + element + IMAGE), and they
// were added within this window: a runaway loop writes its copies seconds apart,
// while a user working on one figure over days/weeks does not.
// ⚠ L'empreinte de l'IMAGE en fait partie : deux captures du même graphe dont on
// a changé les axes sont deux figures DISTINCTES (une par image, voir
// figureContentTag), pas les copies d'une boucle — le 🧹 ne doit pas en jeter une.
const RECAPTURE_DUP_WINDOW_MS = 10 * 60 * 1000;
// …and they must be at least this many. Two copies are a normal re-do.
const RECAPTURE_DUP_MIN = 3;

const duplicateKeyOf = (i) => [
  (i && i.label) || '',
  (i && i.src && i.src.testId) || '',
  (i && i.src && i.src.elementKey) || '',
  (i && i.src && i.src.instanceName) || '',
  (i && i.src && i.src.contentTag) || ''
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

/* ─────────────────────────────────────────────────────────────────────────────
   PLUSIEURS COPIES DU MÊME CANVAS DANS UNE BIBLIOTHÈQUE

   La sauvegarde automatique de l'Image Builder écrit la composition dans
   l'entrée de bibliothèque de son canvas et la met à jour SUR PLACE… tant que
   l'éditeur se souvient de cet id. Une page rechargée, un autre poste, une liste
   de navigateur allégée : le souvenir était perdu et chaque passage ajoutait une
   copie de plus — « the canvas is saved periodically but not overwritten so I
   have in the project many saved canvases ». Les compositions portent désormais
   leur propre clé (`canvasData.canvasKey`) et se fusionnent au lieu de s'empiler
   (voir canvasKeyOfEntry / libraryEntryIdentity).

   Ces trois fonctions nettoient ce qu'une version précédente a laissé. Aucune
   copie n'est retirée sans un clic EXPLICITE : elles se contentent de dire
   combien il y en a, et le retrait garde toujours la composition la plus récente
   ainsi que les entrées que des figures référencent.
   ──────────────────────────────────────────────────────────────────────────── */
// Sans clé de composition (canvas enregistré avant), deux copies portant le même
// nom comptent comme la même toile À PARTIR DE TROIS : deux copies, c'est un
// travail refait à la main, pas une boucle.
const CANVAS_DUP_MIN = 3;

/**
 * Groupes de copies d'un même canvas :
 * `[{ scope, projectId, label, keepId, newestId, removeIds, count }]`.
 * `keepIds` = entrées à ne JAMAIS retirer (une figure pointe dessus) ;
 * `allowedProjectIds` limite l'analyse aux projets que l'utilisateur peut ouvrir.
 * Rien n'est supprimé ici. PUR (lecture seule).
 */
export const findCanvasDuplicates = ({ allowedProjectIds = null, keepIds = null } = {}) => {
  const keep = keepIds instanceof Set ? keepIds : new Set(Array.isArray(keepIds) ? keepIds : []);
  const allowed = allowedProjectFilter(allowedProjectIds);
  const out = [];
  const scan = (scope, projectId, items) => {
    const groups = new Map();
    (items || []).forEach((i) => {
      if (!i || !i.id || !i.canvasData) return;
      const key = canvasKeyOfEntry(i);
      const label = String(i.label || '').trim();
      if (!key && !label) return;              // sans clé ni nom : jamais regroupé
      const g = key ? `k:${key}` : `l:${label}`;
      if (!groups.has(g)) groups.set(g, { keyed: !!key, list: [] });
      groups.get(g).list.push(i);
    });
    groups.forEach((group, key) => {
      if (group.list.length < (group.keyed ? 2 : CANVAS_DUP_MIN)) return;
      const sorted = group.list.slice().sort((a, b) => libraryEntryTime(b) - libraryEntryTime(a));
      const newest = sorted[0];
      // Une copie qu'une figure référence est GARDÉE (son id est le lien
      // « ✏️ Modify in Image Builder ») : elle recevra la composition la plus
      // récente, voir removeCanvasDuplicates.
      const kept = sorted.find((i) => keep.has(i.id)) || newest;
      const remove = sorted.filter((i) => i.id !== kept.id && !keep.has(i.id));
      if (!remove.length) return;
      out.push({
        scope,
        projectId: projectId || null,
        key,
        label: newest.label || 'Canvas',
        keepId: kept.id,
        newestId: newest.id,
        removeIds: remove.map((i) => i.id),
        count: remove.length
      });
    });
  };
  try { scan('common', null, readLibrary()); } catch { /* ignore */ }
  try {
    Object.entries(readAllProjectLibraries()).forEach(([pid, items]) => {
      if (allowed && !allowed(pid)) return;   // la bibliothèque d'une autre équipe
      scan('project', pid, items);
    });
  } catch { /* ignore */ }
  return out;
};

/** Nombre de copies que removeCanvasDuplicates() retirerait. */
export const countCanvasDuplicates = (opts = {}) => findCanvasDuplicates(opts).reduce((n, g) => n + g.count, 0);

/** Retire ces copies : une seule entrée reste par canvas, avec la composition la
 *  plus récente. Les repères des copies retirées partent dans les pierres
 *  tombales (elles ne reviennent ni par la fusion ni par la relecture du Drive).
 *  @returns {{ removed:number, groups:number }} */
export const removeCanvasDuplicates = (opts = {}) => {
  const groups = findCanvasDuplicates(opts);
  let removed = 0;
  groups.forEach((g) => {
    const list = g.scope === 'project' ? readProjectLibrary(g.projectId) : readLibrary();
    const kept = list.find((i) => i && i.id === g.keepId);
    const newest = list.find((i) => i && i.id === g.newestId);
    if (!kept) return;
    const ids = new Set(g.removeIds);
    // Le TRAVAIL le plus récent ne part pas avec les copies : l'entrée gardée
    // reçoit la composition la plus récente (et les champs que l'autre portait,
    // comme son lien cloud). Son `id`, lui, ne change pas.
    const merged = newest && newest.id !== kept.id ? mergeLibraryEntryPair(kept, newest) : kept;
    const next = list.filter((i) => i && !ids.has(i.id)).map((i) => (i && i.id === kept.id ? merged : i));
    removed += list.length - next.length;
    try {
      const stillThere = new Set(trashIdsOfEntry(merged));
      const dropped = [...new Set(list.filter((i) => i && ids.has(i.id))
        .flatMap(trashIdsOfEntry).filter((id) => !stillThere.has(id)))];
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
// (the dataset's COMMON library — <dataset>/general_library_images — when the
// figure has no project). The folder is decided by the explicit PATH below — for
// Google Drive AND Nextcloud — so a figure never lands in a stray
// <dataset>/<project> folder beside the canonical projects container. SVG figures
// keep their vector form; raster figures keep their actual type (PNG/JPEG/WebP…).
// Returns the upload result (Drive-like { id, name, driveUrl }) or null when the
// provider is not available / the source is not a self-contained data URL.
/** Dernière erreur d'envoi d'une FIGURE (vide après un envoi réussi). Permet à
 *  l'appelant de dire POURQUOI la copie cloud manque (hors ligne, jeton expiré,
 *  dossier supprimé…) au lieu d'un « échec » muet. */
let lastFigureDriveError = '';
export const lastFigureUploadError = () => lastFigureDriveError;

/* ── UNE FIGURE = UN FICHIER (le nom déposé sur le cloud) ─────────────────────

   « the same image whatever graph I click ». Le nom du fichier déposé n'était
   fait QUE du libellé (`sanitizeSlug(label)`) — et le libellé d'une capture est
   le TITRE de sa section : les graphes de « 1D Histogram (Data Analysis) »
   s'appellent donc tous pareil, comme deux canvas nommés « Canvas 18/09/2026 ».
   Or l'envoi ÉCRASE le fichier qui porte déjà ce nom dans le dossier (voir
   uploadDriveFileToFolderOnce : il cherche `name='…'` AVANT d'écrire, pour ne
   pas empiler des doublons). La seconde capture remplaçait donc la première :
   toutes les entrées de cette section pointaient vers LE MÊME fichier — la
   même image partout, quel que soit le graphe cliqué — et, comme la fusion des
   listes reconnaît une figure à son id de fichier (driveIdOfLibraryItem),
   plusieurs figures distinctes finissaient même par n'en faire qu'une.

   Le nom porte donc, APRÈS le libellé lisible, une empreinte COURTE de
   l'identité de la figure :

       1D_Histogram_Data_Analysis-1f3k9a2b.svg

   Deux figures différentes ne peuvent plus se recouvrir. L'empreinte est STABLE
   pour une même figure (le même graphe de la même page, la même composition de
   canvas) : une re-capture, un « 💾 Save canvas » répété ou un « ☁ Save to
   Drive » réécrivent bien LEUR fichier au lieu d'en empiler un nouveau.

   ⚠ « LE MÊME GRAPHE » VEUT DIRE LA MÊME IMAGE. Le titre d'une section ne
   distingue pas deux captures d'un graphique dont on a CHANGE LES AXES : le
   conteneur de « Cell Count vs DAPI » et celui de « Cell Count vs Annexin »
   sont le MÊME élément, donc la même origine, donc le même nom de fichier — la
   seconde capture écrasait la première (et son entrée de bibliothèque gardait
   la vignette d'hier : « la vignette montre un graphe, le fichier en porte un
   autre »). L'identité porte donc aussi l'empreinte du CONTENU de la capture
   (`figureContentTag`, posée par le 📷 de ChartStarLayer dans `src.contentTag`) :
   une autre image devient une AUTRE figure — un fichier de plus, une entrée de
   plus, chacune avec SA vignette — tandis que re-capturer la même image garde
   la même empreinte et met à jour l'entrée existante au lieu de la dupliquer.

   Sans identité connue (une image sans origine, un appelant qui n'en fournit
   pas), le nom reste celui d'avant : rien ne change pour ces envois-là. PUR. */

/** Empreinte courte (base 36) d'une chaîne — même famille que le hash djb2 de
 *  driveUpload (payloadTagOf), assez courte pour un nom de fichier. */
export const fileTagOf = (s) => {
  let h = 5381;
  const t = String(s || '');
  for (let i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** L'empreinte du CONTENU d'une capture : deux images identiques la partagent,
 *  deux images différentes ne l'ont JAMAIS. `''` quand il n'y a rien à lire (un
 *  appelant qui ne capture pas d'image — toiles, envois d'un fichier importé).
 *
 *  C'est ce qui distingue deux captures d'un MÊME graphique dont on a changé les
 *  axes (« Cell Count vs DAPI » puis « Cell Count vs Annexin ») : sans elle,
 *  elles partageaient l'origine de l'élément — donc le même nom de fichier cloud
 *  et la même entrée de bibliothèque — et la seconde écrasait la première, en
 *  laissant l'ancienne vignette sur le nouveau graphe. PUR (le hash coûte un
 *  passage sur la chaîne, une seule fois, au moment de la capture). */
export const figureContentTag = (dataUrl) => {
  const s = typeof dataUrl === 'string' ? dataUrl : '';
  return s ? fileTagOf(`${s.length}:${s}`) : '';
};

/** L'identité de FICHIER d'une figure : la clé de composition d'un canvas,
 *  sinon l'origine d'une capture (expérience + instance + graphe + image).
 *  `''` quand rien de stable n'est connu — le nom reste alors le libellé seul.
 *
 *  L'empreinte du contenu (`src.contentTag`, voir figureContentTag) n'est
 *  ajoutée QUE si elle est là : une entrée écrite avant cette correction, ou un
 *  appelant qui n'en pose pas, garde exactement l'identité — donc le nom de
 *  fichier — qu'elle avait. PUR. */
export const figureFileIdentity = ({ src = null, canvasData = null } = {}) => {
  const canvas = canvasKeyOfEntry({ canvasData });
  if (canvas) return `canvas:${canvas}`;
  const s = src && typeof src === 'object' ? src : null;
  if (!s) return '';
  const where = String(s.elementKey || s.elementLabel || '').trim();
  if (!where) return '';
  const who = String(s.testId || s.testName || '').trim();
  const when = String(s.instanceName || s.date || '').trim();
  const content = String(s.contentTag || '').trim();
  const base = [who, when, where].join('|');
  return content ? `${base}|${content}` : base;
};

/** Le nom du fichier déposé pour une figure : `<libellé>[-<empreinte>].<ext>`. PUR.
 *
 *  IDEMPOTENT — c'est le défaut qui a coûté cinq empreintes au même fichier :
 *  quand le libellé d'une entrée vient du NOM DU FICHIER sur le Drive
 *  (`labelFromDriveFileName`, une bibliothèque reconstruite par une lecture), il
 *  porte DÉJÀ l'empreinte d'hier ; l'écriture suivante la rajoutait à la fin,
 *  puis la lecture suivante relisait ce nom-là, et ainsi de suite :
 *
 *      Fig2-1b5tpha-1b5tpha-1b5tpha-1b5tpha-1b5tpha.jpg.meta.json
 *
 *  Une empreinte déjà présente à la FIN du libellé n'est donc jamais répétée, et
 *  un nom déjà abîmé est RAMENÉ au bon dès la prochaine écriture (l'empreinte est
 *  stable pour une même figure : même composition, même origine, même image). */
export const figureFileName = (label, ext, identity = '') => {
  const tag = String(identity || '').trim() ? `-${fileTagOf(identity)}` : '';
  let base = sanitizeSlug(label) || 'figure';
  while (tag && base.endsWith(tag)) base = base.slice(0, -tag.length);
  return `${base || 'figure'}${tag}.${ext}`;
};

/** LE dossier d'images à utiliser pour ce projet — celui qui EXISTE.
 *
 *  `create:false` (toutes les LECTURES : relire la bibliothèque, retrouver un
 *  sidecar) ne crée jamais rien : quand aucun dossier n'est identifié, on
 *  retourne `leafId:''` et l'appelant dit ce qu'il a vu (`candidates`) au lieu de
 *  fabriquer un dossier vide à côté des fichiers.
 *
 *  `create:true` (les ÉCRITURES : publier une figure, déposer son sidecar)
 *  rejoint le dossier existant — sous son ancien nom s'il a été renommé — et ne
 *  crée l'emplacement canonique que s'il n'y a vraiment rien.
 *
 *  @returns {Promise<{ name:string, leafId:string, exact:boolean, via:string,
 *                      folder:string, candidates:Array }>} */
const figuresFolderFor = async (projectName, { create = false } = {}) => {
  /* Le chemin annoncé est celui qui EXISTE sur le Drive — `projects/<projet>/images`,
     ou `general_library_images` pour la bibliothèque COMMUNE (voir
     imagesFolderPathOnDrive) : l'écran dit alors exactement ce que le Drive montre. */
  const wanted = imagesFolderPathOnDrive(projectName);
  const found = await findProjectFiguresFolder(projectName).catch(() => null);
  if (found && found.leafId) return found;
  if (!create) {
    return {
      name: '', leafId: '', exact: false, via: '', folder: wanted,
      candidates: (found && found.candidates) || []
    };
  }
  const resolved = await resolveDrivePathFromNames(projectImagesFolderPath(projectName)).catch(() => null);
  /* La résolution rend les noms RÉELS de chaque segment : `projects`, puis le nom
     du dossier de projet, puis `images` — ou, pour la bibliothèque COMMUNE, le
     nom de son dossier de premier niveau (`general_library_images`). */
  const realPath = (resolved && Array.isArray(resolved.path) ? resolved.path : [])
    .map((p) => String((p && p.name) || '')).filter(Boolean);
  const name = realPath.length > 1
    ? realPath[1]
    : (sanitizeSlug(projectName) || commonLibraryFolderName());
  return {
    name, leafId: (resolved && resolved.leafId) || '', exact: true, via: 'created',
    folder: realPath.length ? realPath.join('/') : wanted, candidates: []
  };
};

/** Où le dossier d'images d'un projet a été trouvé ('' = nulle part).
 *  Sert aux écrans : ils peuvent DIRE quel dossier sera lu, et proposer les
 *  autres quand le renommage a été total. */
export const projectFiguresFolderInfo = async (projectName = '') => figuresFolderFor(projectName, { create: false });

/** Tous les dossiers de projet du dataset avec leur contenu — pour laisser
 *  l'utilisateur désigner celui qui porte ses figures. */
export const projectFiguresFolderChoices = async () => listProjectFiguresFolders();

/** Désigner ce dossier comme LE dossier d'images de ce projet (le miroir
 *  partagé le retient : lectures et envois suivants l'utilisent). */
export const chooseProjectFiguresFolder = async ({ projectName = '', folderName = '' } = {}) =>
  adoptProjectFiguresFolder({ projectName, folderName });

export const uploadFigureToDrive = async ({ full, label = 'figure', projectName = '', identity = '' }) => {
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
  // Le nom porte l'identité de la figure (voir « UNE FIGURE = UN FICHIER ») :
  // deux graphes du même titre ne s'écrasent plus l'un l'autre.
  const name = figureFileName(label, ext, identity);

  // ── Nextcloud ──────────────────────────────────────────────────────────────
  if (getCloudProvider() === 'nextcloud') {
    const parts = ['Lab Workspace'];
    const ds = getDriveRootName();
    if (ds) parts.push(sanitizeSlug(ds));
    // Canonical location: inside the projects container for a project,
    //   <dataset>/projects/<project>/images
    // or the COMMON library at the dataset root when there is no project:
    //   <dataset>/general_library_images
    parts.push(...projectImagesFolderPath(projectName));
    try {
      return await ncUploadFile({
        parts,
        name,
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
    /* LE DOSSIER QUI EXISTE D'ABORD (voir utils/figuresFolder.js) : si ce projet
       a déjà un dossier d'images sur le Drive — fût-ce sous un ancien nom, après
       un renommage ou un miroir perdu — la figure y entre. Résoudre par le seul
       nom canonique ouvrait un dossier PARALLÈLE : les nouvelles figures
       arrivaient dans un dossier vide pendant que les anciennes restaient dans
       l'autre, invisibles.
       Le contexte de nommage garde le VRAI nom du projet : c'est lui que le
       registre compare pour suivre un renommage plus tard. */
    const target = await figuresFolderFor(projectName, { create: true });
    const ctx = { section: 'images' };
    if (projectName) ctx.project = projectName;
    return await uploadLocalFile({
      name,
      mimeType: isSvg ? 'image/svg+xml' : (mime || 'image/png'),
      file: dataUrlToBlob(src),
      path: projectImagesFolderPath(target.name || projectName),
      ctx,
      /* Le dossier RETENU par identifiant : deux dossiers `images` du même nom
         peuvent coexister sur le Drive, et une résolution par nom écrirait dans
         l'autre — celui que personne ne lit (voir utils/figuresFolder.js). */
      folderId: target.leafId || ''
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

/* ── RESTAURER UN CANVAS DEPUIS SON FICHIER (« <image>.meta.json ») ───────────

   « j'ai fait un rafraîchissement forcé et j'ai perdu mon canvas, et je venais
   de le finir » — la composition que l'on vient de finir pèse plusieurs
   mégaoctets (chaque panneau garde ses pixels EN CLAIR dans la composition), et
   le magasin du navigateur est plafonné (~10 Mo par site, partagé avec les
   projets, les publications et toutes les bibliothèques). Quand elle ne rentre
   pas, l'entrée ne vit QUE en mémoire : le rafraîchissement l'emporte, et le
   seul exemplaire complet qui reste est le sidecar déposé À CÔTÉ de l'image sur
   le Drive.

   Ces fonctions rendent ce fichier utilisable directement — c'est le dernier
   recours, et il ne dépend d'aucun jeton, d'aucune liste, d'aucun horodatage :
   le fichier EST la composition. */

/** Composition éditable portée par un sidecar, en forme utilisable par l'Image
 *  Builder (les trois listes existent toujours, comme dans toute composition).
 *  `null` quand le fichier n'en porte pas — un sidecar de simple figure n'est
 *  pas un canvas. PUR. */
export const canvasDataOfFigureMeta = (meta) => {
  const cd = meta && typeof meta === 'object' ? meta.canvasData : null;
  if (!cd || typeof cd !== 'object') return null;
  return {
    ...cd,
    objects: Array.isArray(cd.objects) ? cd.objects : [],
    arrows: Array.isArray(cd.arrows) ? cd.arrows : [],
    shapes: Array.isArray(cd.shapes) ? cd.shapes : []
  };
};

/** L'APERÇU d'un canvas reconstruit depuis son fichier : le PREMIER panneau qui
 *  a des pixels (sa vignette, sa source, ou son lien cloud). `''` quand la
 *  composition n'en porte aucun. C'est ce qui rend la carte d'un canvas
 *  restauré RECONNAISSABLE au lieu du cadre vide « no preview » — sans lui on
 *  ne peut pas dire « c'est le mien » dans la bibliothèque. PUR. */
export const canvasPreviewFromComposition = (canvasData) => {
  const objs = (canvasData && Array.isArray(canvasData.objects)) ? canvasData.objects : [];
  const candidates = [];
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const im of (Array.isArray(o.images) ? o.images : [])) {
      if (im && typeof im === 'object') candidates.push(im.imgThumb, im.imgSrc);
    }
    candidates.push(o.imgThumb, o.imgSrc);
  }
  return candidates
    .map((c) => String(c || '').trim())
    .find((c) => c.startsWith('data:image/') || /^https?:\/\//.test(c)) || '';
};

/** Allège les pixels d'une composition avant de la ranger dans le magasin du
 *  navigateur : les MÊMES pixels y sont écrits plusieurs fois (le panneau garde
 *  `imgSrc`, `imgThumb` ET son tableau `images[]`, tous remplis de la même
 *  image), et un canvas de quatre panneaux atteint ainsi les 4 Mo. Chaque image
 *  n'est réduite QU'UNE fois (même source → même copie), les SVG restent
 *  vectoriels, et une copie qui ne gagne rien est laissée telle quelle : on ne
 *  dégrade jamais une image pour rien. La composition complète, elle, reste
 *  entière sur le Drive (le sidecar n'est jamais touché).
 *  @returns {{ canvasData:object|null, changed:boolean, bytes:number }} */
export const lightenCanvasDataPixels = async (canvasData, { maxSide = 1200, quality = 0.85 } = {}) => {
  const cd = canvasData && typeof canvasData === 'object' ? canvasData : null;
  if (!cd) return { canvasData: null, changed: false, bytes: 0 };
  const before = JSON.stringify(cd).length;
  const done = new Map();  // source → copie allégée (faite une fois par source)
  const shrink = async (src) => {
    const s = String(src || '');
    if (!s.startsWith('data:image/') || s.startsWith('data:image/svg+xml')) return s;
    if (done.has(s)) return done.get(s);
    const keepAlpha = s.startsWith('data:image/png');
    let out = s;
    try {
      const next = await downscaleImage(s, maxSide, keepAlpha ? 'image/png' : 'image/jpeg', quality, true);
      if (next && next.length < s.length) out = next;
    } catch { /* on garde la source */ }
    done.set(s, out);
    return out;
  };
  const objects = [];
  for (const o of (Array.isArray(cd.objects) ? cd.objects : [])) {
    if (!o || typeof o !== 'object') { objects.push(o); continue; }
    const one = { ...o };
    if (Array.isArray(o.images) && o.images.length) {
      const images = [];
      for (const im of o.images) {
        if (!im || typeof im !== 'object') { images.push(im); continue; }
        const imgSrc = await shrink(im.imgSrc);
        images.push({
          ...im,
          imgSrc,
          imgThumb: String(im.imgThumb || '') === String(im.imgSrc || '') ? imgSrc : await shrink(im.imgThumb)
        });
      }
      one.images = images;
      const first = images[0] || {};
      one.imgSrc = first.imgSrc != null ? first.imgSrc : one.imgSrc;
      one.imgThumb = first.imgThumb || first.imgSrc || one.imgThumb;
    } else {
      const imgSrc = await shrink(o.imgSrc);
      one.imgSrc = imgSrc;
      one.imgThumb = String(o.imgThumb || '') === String(o.imgSrc || '') ? imgSrc : await shrink(o.imgThumb);
    }
    objects.push(one);
  }
  const next = { ...cd, objects };
  const bytes = JSON.stringify(next).length;
  return { canvasData: next, changed: bytes < before, bytes };
};

/** LA RESTAURATION D'UN CANVAS depuis le fichier de sa composition.
 *
 *  Le fichier vient de n'importe où (Téléchargements, une copie du Drive, le
 *  poste d'un collègue) : il est relu, allégé, puis rangé dans la bibliothèque de
 *  la portée demandée sous la MÊME forme que n'importe quel canvas — avec une clé
 *  de composition (`canvasData.canvasKey`), donc « 💾 Save now » met à jour
 *  cette entrée-là au lieu d'en ajouter une autre. Réimporter le même fichier met
 *  l'entrée à jour (elle est reconnue par son sidecar), et les pierres tombales
 *  de cette entrée sont effacées : l'utilisateur vient de dire qu'il la veut.
 *
 *  @returns {{ ok:boolean, entry:object|null, created:boolean, lightened:boolean,
 *              bytes:number, persisted:boolean, error:string }} */
export const restoreCanvasFromFigureMeta = async ({
  text = '', fileName = '', scope = 'project', projectId = null, label = '', maxSide = 1200
} = {}) => {
  const fail = (error) => ({ ok: false, entry: null, created: false, lightened: false, bytes: 0, persisted: false, error });
  const meta = parseFigureMeta(text);
  const canvasData = canvasDataOfFigureMeta(meta);
  if (!canvasData) {
    /* ✅ DIRE CE QUE LE FICHIER EST — pas seulement ce qu'il n'est pas.
       « J'ai trouvé un `.meta.json` et il ne s'ouvre pas » : un sidecar de
       CAPTURE (le graphe aplati d'une figure, décrit par `src`) n'a JAMAIS
       porté de composition ; sans le dire, on le croit perdu et on le
       réessaie. Les deux fichiers portent le même nom — c'est le CONTENU qui
       tranche (`canvasData` pour un canvas, `src` pour une capture). */
    const s = (meta && meta.src) || null;
    const when = meta && meta.savedAt ? ` (saved ${String(meta.savedAt).slice(0, 16).replace('T', ' ')})` : '';
    const what = s
      ? `This is the sidecar of a CAPTURED FIGURE — “${s.elementLabel || s.elementKey || 'figure'}”`
        + `${s.testName ? ` of ${s.testName}${s.instanceName ? ` · ${s.instanceName}` : ''}` : ''}${when}.`
      : 'This file carries no canvas composition.';
    return fail(`${what} A capture keeps that picture’s origin and no canvas composition: there is nothing to reopen in the Image Builder. The editable canvas file is the OTHER “<image>.meta.json” — the one written next to a canvas image saved by the Image Builder (its content has a “canvasData” key).`);
  }
  const imageName = imageNameOfSidecarName(fileName) || String((meta && meta.imageName) || '');
  const metaName = isFigureMetaFileName(fileName) ? String(fileName) : (imageName ? sidecarNameOfImageName(imageName) : '');
  const name = String(label || (meta && meta.label) || imageName || 'Canvas').trim() || 'Canvas';
  const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  // L'entrée de CE canvas : celle que son sidecar désigne (réimporter le même
  // fichier ne fabrique donc pas une seconde copie).
  const key = canvasKeyOfEntry(meta);
  const prev = (metaName ? list.find((i) => i && String(i.metaName || '') === metaName) : null)
    || (key ? list.find((i) => canvasKeyOfEntry(i) === key) : null)
    || null;
  const light = await lightenCanvasDataPixels(canvasData, { maxSide });
  const stamped = {
    ...light.canvasData,
    canvasKey: canvasKeyOfEntry(prev) || uid('cv'),
    updatedAt: new Date().toISOString()
  };
  const entry = {
    ...(prev || {}),
    id: (prev && prev.id) || uid('lib'),
    label: name,
    /* Un sidecar ne porte PAS l'image rendue du canvas (c'est le fichier voisin,
       sur le Drive) : la carte restait donc un cadre vide — impossible de
       reconnaître SON canvas dans la bibliothèque (« ce n'est pas le mien »).
       Une entrée NEUVE montre le premier panneau de la composition ; une entrée
       déjà là garde son image. `full` n'est jamais inventé : les pixels haute
       résolution du canvas restent ceux du Drive, que « 💾 Save now » réécrit. */
    url: (prev && prev.url) || (prev && prev.full) || canvasPreviewFromComposition(stamped) || null,
    full: (prev && prev.full) || null,
    src: (prev && prev.src) || (meta && meta.src) || null,
    canvasData: stamped,
    metaName: metaName || (prev && prev.metaName) || null,
    addedAt: (prev && prev.addedAt) || String((meta && meta.savedAt) || '') || new Date().toISOString(),
    updatedAt: stamped.updatedAt
  };
  const next = prev ? list.map((i) => (i && i.id === prev.id ? entry : i)) : [entry, ...list];
  if (scope === 'project') writeProjectLibrary(projectId, next);
  else writeLibrary(next);
  // Un geste EXPLICITE : les pierres tombales de cette entrée ne doivent plus
  // empêcher ni la fusion des clés ni la relecture du dossier Drive.
  forgetLibraryTrash(scope === 'project' ? (projectId || 'common') : 'common', trashIdsOfEntry(entry));
  /* CE QUI A ÉTÉ ÉCRIT EST-IL VRAIMENT GARDÉ ? Le magasin du navigateur est
     plafonné (~10 Mo par site, partagé) : une liste trop lourde reste en MÉMOIRE
     — donc perdue au prochain rafraîchissement, exactement le défaut d'origine.
     On le DIT à l'appelant (la page projet prévient et propose de faire de la
     place) au lieu de laisser croire que c'est enregistré. */
  let persisted = false;
  try {
    const raw = localStorage.getItem(scope === 'project' ? projectLibraryKey(projectId) : LIBRARY_KEY) || '';
    persisted = raw.includes(entry.id);
  } catch { persisted = false; }
  return { ok: true, entry, created: !prev, lightened: !!light.changed, bytes: light.bytes, persisted, error: '' };
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
    // Le sidecar va DANS LE MÊME DOSSIER que l'image : celui que le résolveur a
    // trouvé pour ce projet (voir figuresFolderFor) — sinon une composition
    // atterrirait dans un dossier et son image dans un autre.
    const target = await figuresFolderFor(projectName, { create: true });
    const ctx = { section: 'images' };
    if (projectName) ctx.project = projectName;
    return await uploadLocalFile({
      name,
      mimeType: 'application/json',
      file: new Blob([body], { type: 'application/json' }),
      path: projectImagesFolderPath(target.name || projectName),
      ctx,
      // Le MÊME dossier que l'image, par identifiant (voir uploadFigureToDrive).
      folderId: target.leafId || ''
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

/* ── LE NOM SUR LE DRIVE SUIT LE NOM DU CANVAS ────────────────────────────────

   « I cannot find my renamed canvas in Drive ». Renommer une toile ne changeait
   que le LIBELLÉ de son entrée : le fichier du Drive, lui, gardait le nom de sa
   première écriture. On cherchait donc dans le dossier un nom que le Drive ne
   connaissait pas — et, le nom ayant changé, la sauvegarde suivante ne
   retrouvait plus le fichier à écraser : elle en déposait un SECOND et laissait
   l'ancien, orphelin, sous son ancien nom.

   `figureRenameTarget` dit quel nom le fichier doit porter (LA MÊME règle que
   l'envoi : voir figureFileName, empreinte d'identité comprise), et
   `renameFigureOnDrive` renomme le fichier ET son sidecar de composition
   `<image>.meta.json` EN GARDANT L'IDENTIFIANT du fichier : les liens des
   figures continuent de viser le même fichier, la composition reste trouvée à
   côté, et le dossier ne se remplit pas de copies. Appelé par les gestes
   « ✏️ Rename » (page projet, barre de l'éditeur, modale 🖼 Library) et, en
   filet de sécurité, AVANT chaque envoi qui réécrit une entrée déjà sur le
   cloud (voir publishLibraryFigure) — c'est là que l'ancienne version laissait
   le doublon. */

/** Extension d'un nom de fichier (`''` s'il n'en porte pas). PUR. */
export const fileExtensionOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
};

/** Le nom de fichier que porte une URL (dernier segment, décodé). Un lien
 *  Nextcloud/WebDAV porte son nom, un lien Drive non (il n'a qu'un id). PUR. */
export const fileNameOfUrl = (url) => {
  const clean = String(url || '').split(/[?#]/)[0];
  const seg = clean.slice(clean.lastIndexOf('/') + 1);
  try { return decodeURIComponent(seg); } catch { return seg; }
};

/** La même URL avec un autre nom de fichier (dernier segment). PUR. */
export const urlWithFileName = (url, name) => {
  const s = String(url || '');
  const cut = s.search(/[?#]/);
  const head = cut >= 0 ? s.slice(0, cut) : s;
  const tail = cut >= 0 ? s.slice(cut) : '';
  const at = head.lastIndexOf('/');
  if (at < 0 || !name) return s;
  return `${head.slice(0, at + 1)}${encodeURIComponent(name)}${tail}`;
};

/** Nom de fichier visé pour une figure renommée : le libellé + l'empreinte de
 *  son identité (même règle que l'envoi), et l'extension du fichier qu'elle a
 *  DÉJÀ sur le cloud — un PNG reste un PNG. `from` = le nom actuel connu ('' si
 *  on ne le connaît pas encore : voir renameFigureOnDrive). PUR. */
export const figureRenameTarget = ({ label = '', previousName = '', identity = '' } = {}) => {
  const from = String(previousName || '').trim();
  return { from, name: figureFileName(label, fileExtensionOf(from) || 'png', identity) };
};

/** Renomme le fichier cloud de CETTE entrée de bibliothèque (et son sidecar de
 *  composition) pour qu'il porte le libellé donné. L'identifiant du fichier ne
 *  bouge pas : les figures qui pointent dessus continuent de le viser.
 *
 *  @returns {Promise<{ ok:boolean, reason?:string, from:string, name:string,
 *                      unchanged?:boolean, metaName?:string|null,
 *                      metaMoved?:boolean }>} `from` = nom actuel, `name` = nom
 *  visé (toujours calculé, même quand le renommage est refusé : l'appelant peut
 *  le DIRE au lieu de laisser croire que le Drive a suivi). */
export const renameFigureOnDrive = async ({
  scope = 'common', projectId = null, projectName = '', id = '', label = '', identity = ''
} = {}) => {
  const name = String(label || '').trim();
  const list = scope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const entry = (list || []).find((i) => i && i.id === id);
  if (!entry) return { ok: false, reason: 'no-entry', from: '', name };
  if (!name) return { ok: false, reason: 'no-name', from: '', name };
  if (!cloudBackendAvailable()) return { ok: false, reason: 'cloud-off', from: '', name };
  const fileId = driveIdOfLibraryItem(entry);
  const ncUrl = (getCloudProvider() === 'nextcloud' && isNextcloudUrl(entry.full)) ? String(entry.full) : '';
  if (!fileId && !ncUrl) return { ok: false, reason: 'no-cloud-file', from: '', name };
  /* Le nom ACTUEL du fichier : le sidecar le porte (`<image>.meta.json`) — donc
     gratuitement pour toute entrée qui a une composition. Sinon on le DEMANDE au
     cloud (un appel, seulement quand il faut vraiment renommer). */
  let from = imageNameOfSidecarName(entry.metaName || '');
  if (!from && fileId) {
    try { from = String((await getDriveFileMeta(fileId)).name || ''); } catch { from = ''; }
  }
  if (!from && ncUrl) from = fileNameOfUrl(ncUrl);
  const to = figureRenameTarget({
    label: name,
    previousName: from,
    identity: String(identity || '').trim() || figureFileIdentity(entry)
  }).name;
  if (!from) return { ok: false, reason: 'name-unknown', from: '', name: to };
  if (from === to) return { ok: true, unchanged: true, from, name: to };
  // 1. LE FICHIER de l'image (Drive : PATCH du nom ; Nextcloud : MOVE WebDAV).
  let moved = false;
  try {
    moved = fileId
      ? await renameDriveFile(fileId, to)
      : await ncMove(ncUrl, urlWithFileName(ncUrl, to));
  } catch { moved = false; }
  if (!moved) return { ok: false, reason: 'rename-refused', from, name: to };
  // 2. LE SIDECAR DE COMPOSITION, juste à côté : sans lui, « ⬇ Add missing from
  //    Drive » relirait plus tard une composition pour un fichier disparu — la
  //    toile paraîtrait alors modifiable mais son image serait introuvable.
  const fromMeta = sidecarNameOfImageName(from);
  const toMeta = sidecarNameOfImageName(to);
  let metaMoved = false;
  try {
    if (fileId) {
      // Le dossier est CHERCHÉ, jamais créé : renommer une figure ne doit pas
      // fabriquer un dossier d'images vide (voir utils/figuresFolder.js).
      const folder = await figuresFolderFor(projectName, { create: false });
      const sidecarId = folder.leafId ? await findDriveFileByName(fromMeta, folder.leafId) : '';
      metaMoved = !!sidecarId && await renameDriveFile(sidecarId, toMeta);
    } else {
      metaMoved = await ncMove(urlWithFileName(ncUrl, fromMeta), urlWithFileName(ncUrl, toMeta));
    }
  } catch { metaMoved = false; }
  // 3. L'ENTRÉE (mémoire + cache du navigateur) : c'est elle que l'app relit
  //    pour retrouver le sidecar de cette composition.
  if (metaMoved) {
    const next = (list || []).map((i) => (i && i.id === id
      ? { ...i, metaName: toMeta, updatedAt: new Date().toISOString() }
      : i));
    if (scope === 'project') writeProjectLibrary(projectId, next);
    else writeLibrary(next);
  }
  return { ok: true, from, name: to, metaName: metaMoved ? toMeta : (entry.metaName || null), metaMoved };
};

/* ── LE FICHIER SUIT SON ENTRÉE (déplacement entre bibliothèques) ─────────────

   Une entrée de bibliothèque et le FICHIER qui la porte ne vivent PAS dans le
   même dossier selon la portée :

       bibliothèque commune      →  <dataset>/general_library_images
                                    (les figures y sont DIRECTEMENT)
       bibliothèque d'un projet  →  <dataset>/projects/<slug>/images

   `moveLibraryItem` ne déplace que la LISTE (geste local, immédiat). Sans le
   déplacement du fichier, une image passée dans la bibliothèque d'un projet
   gardait son fichier dans le dossier de la commune :

     • « ⬇ Add missing from Drive » sur ce projet ne la retrouvait JAMAIS — le
       dossier lu n'est pas celui qui la contient. C'est la seconde moitié du
       « et même en cliquant Add missing from Drive, ça ne se règle pas » ;
     • un poste neuf (liste perdue, navigateur vidé) ne pouvait la reconstruire
       que depuis la commune, où elle n'est plus censée être.

   Le geste est BEST-EFFORT et ne touche RIEN d'autre : l'identifiant du fichier
   ne change pas (les figures qui pointent dessus continuent de le viser), le
   sidecar `<image>.meta.json` suit l'image (la composition éditable vit à côté
   d'elle), et le registre des fichiers suit le nouveau contexte — sans quoi un
   renommage de l'ANCIEN projet ramènerait le fichier dans son ancien dossier.
   Un échec réseau laisse l'entrée déplacée : l'appelant le DIT (voir les écrans)
   au lieu de laisser croire que le Drive a suivi.

   @returns {Promise<{ moved:boolean, reason:string, folder:string,
                       metaMoved:boolean, fileId:string }>}
            `reason` : '' quand tout a suivi, 'local-only' (les pixels ne sont
            encore que dans le navigateur — c'est ☁ Save to Drive qui les
            enverra), 'cloud-off', 'no-entry', 'no-folder', 'already-there'
            (déjà dans le bon dossier), 'move-refused', 'nc-shape'. */

/** URL WebDAV du même fichier, rangée dans le dossier d'images d'une portée.
 *  Le segment du DATASET est repris de l'URL d'origine (c'est le même dataset) :
 *  seule la fin — `projects/<projet>/images/<fichier>` ou le dossier de la
 *  bibliothèque COMMUNE — est réécrite. '' quand l'URL n'a pas la forme attendue
 *  (l'appelant le DIT au lieu de deviner). PUR. */
export const ncUrlInFiguresFolder = (url, projectName, fileName = '') => {
  const s = String(url || '');
  const name = String(fileName || fileNameOfUrl(s) || '');
  if (!name) return '';
  const at = figuresPathStartInUrl(s);
  if (at <= 0) return '';
  const tail = projectImagesFolderPath(projectName).map((seg) => encodeURIComponent(seg)).join('/');
  return `${s.slice(0, at)}/${tail}/${encodeURIComponent(name)}`;
};

/** Où commence le chemin d'un dossier d'images dans une URL Nextcloud :
 *  le conteneur `/projects/…` (dossier d'un projet) ou le dossier de la
 *  bibliothèque COMMUNE (`/general_library_images/…`, ou son ancien nom
 *  `/unassigned/…`). -1 quand l'URL n'est ni l'un ni l'autre. PUR. */
const figuresPathStartInUrl = (url) => {
  const s = String(url || '');
  const at = s.search(/\/projects\//i);
  if (at > 0) return at;
  for (const seg of commonLibraryFolderNames()) {
    const m = s.search(new RegExp(`/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'i'));
    if (m > 0) return m;
  }
  return -1;
};

export const moveLibraryItemOnDrive = async ({ id = '', toScope = 'project', projectId = null, projectName = '' } = {}) => {
  const out = { moved: false, reason: '', folder: '', metaMoved: false, fileId: '' };
  const list = toScope === 'project' ? readProjectLibrary(projectId) : readLibrary();
  const entry = (list || []).find((i) => i && i.id === id);
  if (!entry) { out.reason = 'no-entry'; return out; }
  const ncUrl = (getCloudProvider() === 'nextcloud' && isNextcloudUrl(entry.full)) ? String(entry.full) : '';
  const fileId = ncUrl ? '' : driveIdOfLibraryItem(entry);
  out.fileId = fileId;
  if (!fileId && !ncUrl) { out.reason = 'local-only'; return out; }
  if (!cloudBackendAvailable()) { out.reason = 'cloud-off'; return out; }

  /* ── Nextcloud : WebDAV MOVE (le segment du dataset est repris de l'URL) ──── */
  if (ncUrl) {
    out.folder = projectImagesFolderPath(projectName).join('/');
    try {
      const to = ncUrlInFiguresFolder(ncUrl, projectName);
      if (!to) { out.reason = 'nc-shape'; return out; }
      out.moved = await ncMove(ncUrl, to);
      if (!out.moved) { out.reason = 'move-refused'; return out; }
      const metaName = String(entry.metaName || '').trim();
      if (metaName) {
        const toMeta = ncUrlInFiguresFolder(ncUrl, projectName, metaName);
        if (toMeta) out.metaMoved = await ncMove(urlWithFileName(ncUrl, metaName), toMeta);
      }
      return out;
    } catch (err) { out.reason = (err && err.message) || 'nc-error'; return out; }
  }

  /* ── Google Drive : le dossier d'arrivée est CRÉÉ (c'est là qu'on range),
        l'ancien dossier n'est pas touché par ce geste. ─────────────────────── */
  let from = '';
  let toFolderId = '';
  let targetName = '';
  try {
    const target = await figuresFolderFor(projectName, { create: true });
    targetName = target.name || projectName;
    out.folder = target.folder || projectImagesFolderPath(projectName).join('/');
    toFolderId = target.leafId || '';
    if (!toFolderId) { out.reason = 'no-folder'; return out; }
    /* Le dossier d'ORIGINE : demandé au fichier lui-même (`parents`) — c'est là
       que vit le sidecar, et il n'y a pas d'autre moyen de le retrouver sans
       supposer un nom de projet (que l'entrée ne porte pas). */
    from = ((await getDriveFileMeta(fileId).catch(() => ({}))).parents || [])[0] || '';
    if (from && from === toFolderId) { out.moved = true; out.reason = 'already-there'; return out; }
    out.moved = await moveDriveFile(fileId, toFolderId);
    if (!out.moved) { out.reason = 'move-refused'; return out; }
  } catch (err) { out.reason = (err && err.message) || 'drive-error'; return out; }

  const metaName = String(entry.metaName || '').trim();
  let sidecarId = '';
  if (metaName && from) {
    try {
      sidecarId = await findDriveFileByName(metaName, from);
      if (sidecarId) out.metaMoved = await moveDriveFile(sidecarId, toFolderId);
    } catch { /* le sidecar reste où il est : l'image, elle, a suivi */ }
  }
  /* Le REGISTRE des fichiers suit le nouveau contexte (dossier du projet visé) :
     sinon un renommage de l'ancien projet déplacerait le fichier… dans l'ancien
     dossier (voir driveUpload.renameDriveFilesFor), et la portée ne
     correspondrait plus à son dossier. Best-effort : jamais bloquant. */
  try {
    const ctx = { section: 'images' };
    if (projectName) ctx.project = projectName;
    const path = projectImagesFolderPath(targetName).map((n) => ({ name: n, id: '' }));
    const reg = getDriveFileRegistry() || {};
    registerDriveFile(fileId, (reg[fileId] || {}).name || '', ctx, path);
    if (sidecarId) registerDriveFile(sidecarId, (reg[sidecarId] || {}).name || metaName, ctx, path);
  } catch { /* registre local indisponible : le déplacement du fichier reste acquis */ }
  return out;
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
 *  `queued` compte les fichiers mis EN FILE DE REPRISE (l'envoi a été refusé
 *  sur le moment mais il repartira tout seul — voir utils/pendingUploads.js) :
 *  ce ne sont PAS des échecs, et les trois écrans qui affichent ce compte-rendu
 *  le disent ainsi au lieu d'envoyer chercher une connexion qui va bien.
 *  @returns {{ total:number, uploaded:number, failed:number, queued:number,
 *              folder:string,
 *              results:Array<{id:string,ok:boolean,queued?:boolean,driveUrl?:string}> }} */
export const pushLibraryToDrive = async ({ scope = 'common', projectId = null, projectName = '' } = {}) => {
  const out = {
    total: 0,
    uploaded: 0,
    failed: 0,
    queued: 0,
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
      // Même règle de nom que la publication (voir « UNE FIGURE = UN FICHIER ») :
      // l'entrée garde son fichier, deux figures ne se recouvrent pas.
      drive = await uploadFigureToDrive({
        full: item.full,
        label: item.label || 'figure',
        projectName,
        identity: figureFileIdentity({ src: item.src, canvasData: item.canvasData })
      });
    } catch { drive = null; }
    const url = (drive && drive.id && (drive.driveUrl || drive.url)) || '';
    if (!url) {
      // « Mis en file de reprise » n'est pas « échoué » : le fichier repartira
      // seul dès que le fournisseur répondra. On le compte À PART.
      const q = takeLastUploadQueueInfo() || {};
      if (q.queued) {
        out.queued += 1;
        out.results.push({ id: item.id, ok: false, queued: true, reason: q.reason || 'queued' });
        continue;
      }
      out.failed += 1;
      out.results.push({ id: item.id, ok: false });
      continue;
    }
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

/* ── ALLÉGER UNE LISTE SANS RIEN PERDRE ──────────────────────────────────────
   Le magasin du navigateur (~5 Mo par site) est partagé par TOUT le poste : les
   listes de figures y pèsent vite plus de 4 Mo parce qu'une entrée garde ses
   pixels encodés (`full` — la copie haute résolution — et parfois `url`). Or
   une entrée dont le FICHIER EST SUR LE CLOUD n'a pas besoin de les garder :
   `resolveImageToDataUrl` les relit du Drive avec le jeton OAuth, exactement
   comme n'importe quelle autre image de la bibliothèque.

   Cette fonction rend donc une liste où, pour CES entrées-là seulement :
     1. `full` (haute résolution) devient le lien du fichier ;
     2. avec `dropThumbs`, `url` (la vignette) aussi — l'entrée s'affiche alors
        depuis le cloud.
   RIEN d'autre ne bouge : libellé, `id`, ordre, `canvasData` (la composition
   éditable) et l'horodatage restent — une entrée ne disparaît jamais d'ici
   (pruneRecoverableLibraryCaches, lui, oublie des entrées : c'est un autre
   métier, réservé au dernier recours de l'écriture des projets).

   Une entrée dont les pixels ne vivent QUE dans ce navigateur (aucun
   identifiant de fichier cloud) est renvoyée TELLE QUELLE : la toucher serait
   la perdre pour de bon.

   @returns {{ items:Array, freed:number }} `freed` en CARACTÈRES — l'unité du
   quota du navigateur (voir utils/localStoreRoom.js). */
export const shrinkLibraryEntryPixels = (items, { dropThumbs = false } = {}) => {
  let freed = 0;
  const list = Array.isArray(items) ? items : [];
  const next = list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    if (!driveIdOfLibraryItem(item)) return item;
    const link = [item.driveUrl, item.full, item.url]
      .find((v) => typeof v === 'string' && /^https?:\/\//i.test(v));
    if (!link) return item;
    let copy = null;
    const shrink = (field) => {
      const v = (copy || item)[field];
      if (typeof v !== 'string' || v.indexOf('data:') !== 0) return;
      if (!copy) copy = { ...item };
      freed += v.length;
      copy[field] = link;
    };
    shrink('full');
    if (dropThumbs) shrink('url');
    return copy || item;
  });
  return { items: next, freed };
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
    /* ⛔ ON N'OUBLIE QUE CE QUI REVIENT VRAIMENT DU DRIVE.
       Les pixels reviennent par « ⬇ Add missing from Drive », mais l'entrée
       RÉ-AJOUTÉE ne porte que ce que le sidecar `<image>.meta.json` lui rend
       (voir buildFigureMeta) : sans sidecar, elle revient comme une simple image
       — sans sa composition (`canvasData`) ni son origine de capture (`src`).
       Ces deux-là ne vivent QUE dans ce navigateur : les oublier ici les
       détruisait pour de bon (l'image restait sur le Drive, la copie ÉDITABLE
       non — le canvas ne se rouvrait plus dans l'éditeur). `metaName` non vide
       = la copie éditable EST sur le Drive, posée par publishLibraryFigure :
       c'est la seule entrée dont on peut vraiment se passer ici. */
    const recoverable = (i) => !!(i && i.drive === true && driveIdOfLibraryItem(i)
      && (!(i.canvasData || i.src) || !!String(i.metaName || '').trim()));
    const kept = items.filter((i) => !recoverable(i));
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
 *  LE DOSSIER EST CHERCHÉ, JAMAIS CRÉÉ (voir utils/figuresFolder.js). Le chemin
 *  canonique est dérivé du NOM du projet : quand le dossier du projet a été
 *  renommé, cette lecture créait autrefois un dossier vide à côté des fichiers et
 *  lisait celui-là — « mes figures sont sur le Drive mais le programme ne les voit
 *  plus, il y a deux dossiers images et l'un est vide ». On lit maintenant le
 *  dossier qui EXISTE (miroir partagé → nom canonique → dossier voisin au nom
 *  proche) ; quand aucun n'est identifiable avec certitude, le geste ne devine
 *  pas : il rend `candidates` (tous les dossiers de projet du dataset et ce qu'ils
 *  contiennent) et l'écran laisse choisir, `fromFolderName` désignant le bon
 *  dossier pour de bon (il est retenu pour ce projet).
 *
 *  @returns {{ folder:string, found:number, added:number, filled:number,
 *              restored:number, noComposition:number, error:string,
 *              via:string, adopted:string, candidates:Array }}
 *            `noComposition` = images ramenées du Drive SANS sidecar : il n'y a
 *            RIEN à rouvrir dans l'éditeur (ni composition de canvas, ni origine
 *            de capture). Le geste le DIT (page projet) : sans ce chiffre,
 *            l'image « revient » et l'on ne comprend pas pourquoi elle ne
 *            s'ouvre plus.
 *            `folder` = le dossier RÉELLEMENT lu (`via` dit comment il a été
 *            trouvé : 'mirror', 'name', 'similar', 'chosen'). */
export const pullLibraryFromDrive = async ({
  scope = 'common', projectId = null, projectName = '', fromFolderName = ''
} = {}) => {
  const out = {
    folder: imagesFolderPathOnDrive(projectName),
    found: 0, added: 0, filled: 0, restored: 0, noComposition: 0, error: '',
    /* Ce que le geste a vu d'autre : les autres dossiers de projet du dataset,
       avec leur contenu. Ils ne sont PAS lus d'office (un renommage complet ne se
       devine pas), mais l'écran les propose — et `fromFolderName` fait le
       contraire : lire celui-là et le retenir pour ce projet. */
    via: '', adopted: '', candidates: []
  };
  if (!cloudBackendAvailable()) { out.error = 'Cloud storage is not connected.'; return out; }
  let listing = [];
  try {
    let target = null;
    if (fromFolderName) {
      // CHOIX EXPLICITE : l'utilisateur a désigné le dossier (page projet →
      // « Read from this folder »). On le retient pour ce projet, puis on le lit.
      const imagesId = await chooseProjectFiguresFolder({ projectName, folderName: fromFolderName });
      if (!imagesId) { out.error = `Folder not found: ${fromFolderName}`; return out; }
      target = { name: fromFolderName, leafId: imagesId, exact: true, via: 'chosen', folder: `projects/${fromFolderName}/images` };
      out.adopted = fromFolderName;
    } else {
      // LECTURE : le dossier qui EXISTE (miroir → nom canonique → dossier voisin
      // au nom proche). Rien n'est créé — c'est ce qui évitait de fabriquer un
      // dossier vide à côté des fichiers qu'on cherchait.
      target = await figuresFolderFor(projectName, { create: false });
    }
    out.folder = target.folder || out.folder;
    out.via = target.via || '';
    out.candidates = target.candidates || [];
    if (!target.leafId) {
      // Aucun dossier identifié : on le DIT, et on montre ce qui existe pour que
      // l'utilisateur désigne le bon dossier (fromFolderName) au lieu de laisser
      // l'application en fabriquer un vide.
      out.error = `Folder not found: ${out.folder}`;
      return out;
    }
    listing = await listDriveChildren(target.leafId);
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
    /* Les entrées DÉCOUVERTES par cette lecture : leur libellé vient du NOM DU
       FICHIER (voir libraryItemsFromDriveListing), donc l'empreinte d'identité y
       est comprise — « Fig2-1b5tpha ». Le sidecar, lui, porte le libellé VRAI
       (« Fig2 ») : c'est lui qu'il faut adopter, sinon l'écriture suivante
       remettait cette empreinte dans le nom (voir figureFileName). */
    const freshIds = new Set(missing.map((i) => String((i && i.id) || '')));
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
      // Une entrée DÉJÀ connue de ce poste garde son libellé : l'utilisateur a pu
      // la renommer (voir freshIds).
      if (meta.label && (freshIds.has(String(it.id || '')) || !it.label)) it.label = meta.label;
      it.metaName = metaName;
    }
  }
  // Ce qui revient SANS rien à rouvrir (aucun sidecar dans le dossier) : le
  // geste le dit — c'est la différence entre « mon canvas est revenu » et
  // « l'image est revenue, la composition n'existe nulle part ».
  out.noComposition = missing.filter((i) => i && !i.canvasData && !i.src).length;
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

