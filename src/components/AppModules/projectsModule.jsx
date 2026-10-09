import React, { useState, useEffect, useMemo } from 'react';
import { markAttachmentsDeleted, getDriveRootName } from '../../utils/driveUpload';
import { mirrorDeleteProject } from '../../utils/driveMirror';
import { readLocalStoreUsage, storageFreedText, storageRefusedText } from '../../utils/localStoreRoom';
import { pruneRecoverableLibraryCaches } from '../../utils/figuresLibrary';
import {
  DELETED_PROJECTS_KEY, REVIVED_PROJECTS_KEY, normalizeTombstones, normalizeRevivals,
  mergeTombstones, tombstonesForDataset, isProjectDeleted, withoutDeletedProjects,
  addTombstone, withoutDatasetTombstones, protectUntombstoned,
  withoutRevivedProjects, addRevival, withoutRevival, revivalsForDataset
} from '../../utils/projectTombstones';
import { planProjectImport } from '../../utils/projectImport';
import { reconcileExperimentLinks, countExperimentsOfProject } from '../../utils/experimentRules';

/* =========================================================================
   PROJECTS — "Scientific background / Experiments / Results and Discussion /
   Conclusions / References" workspace pages.
   Data is persisted in localStorage (same pattern as journals/papers).
   Rights: superusers see everything (filterable by scientist); each user
   sees only their own projects.
   ========================================================================= */

export const PROJECTS_KEY = 'labWorkspace_projects';

export const genProjectId = () => `prj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Rough "how much content does this project hold" measure — used to keep the
 *  fullest copy when the same project (same id or same name) exists twice on a
 *  device (e.g. an empty duplicate created on a phone next to the real one from
 *  the PC). */
const projectSize = (p) => {
  try { return JSON.stringify(p).length; } catch { return 0; }
};

/** Collapse exact duplicates (same id) and same-name duplicates within the
 *  SAME dataset (different ids, e.g. the same project created once on the PC
 *  and once on a phone, each with its own generated id). For a duplicate pair
 *  the RICHER copy is kept at the position of the first occurrence (order is
 *  otherwise preserved). Same-named projects in DIFFERENT datasets stay apart:
 *  they are legitimate separate projects. */
const datasetNameKey = (p) =>
  `${String((p && p.datasetId) || '')}::${String((p && p.name) || '').trim().toLowerCase()}`;

const dedupeProjects = (list) => {
  const byId = new Map();      // id -> index in out
  const byName = new Map();    // dataset-scoped name key -> index in out
  const out = [];
  const add = (p) => { out.push(p); return out.length - 1; };
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const id = p.id;
    const nameKey = p && p.name ? datasetNameKey(p) : '';
    const idIdx = id ? byId.get(id) : -1;
    const nameIdx = nameKey ? byName.get(nameKey) : -1;
    if (idIdx >= 0) {
      if (projectSize(p) > projectSize(out[idIdx])) out[idIdx] = p;
      continue;
    }
    if (nameIdx >= 0) {
      if (projectSize(p) > projectSize(out[nameIdx])) {
        out[nameIdx] = p;
        if (id) byId.set(id, nameIdx);
      }
      continue;
    }
    const idx = add(p);
    if (id) byId.set(id, idx);
    if (nameKey) byName.set(nameKey, idx);
  }
  return out;
};

/* ------------------------------------------------------------------------
 * Per-dataset project scoping.
 *
 * Projects belong to the dataset they were created in. The localStorage store
 * below is a per-device cache of EVERY dataset's projects (all ids keep living
 * in the same key so nothing is lost when datasets are switched), but every
 * read is FILTERED to the active dataset scope: a project created in dataset A
 * can never show up in dataset B.
 *
 * App.jsx calls setProjectDatasetScope() whenever a dataset is opened, created
 * or left. When no dataset is open (explorer, bootstrap) the scope is null and
 * the historical global view is kept.
 * ------------------------------------------------------------------------ */
let activeProjectDataset = null;

/** Set (or clear, with null) the dataset whose projects are currently shown. */
export const setProjectDatasetScope = (datasetArg) => {
  activeProjectDataset = datasetArg ? String(datasetArg) : null;
};
/** Dataset id of the currently shown projects (null outside a dataset). */
export const getActiveProjectDataset = () => activeProjectDataset;

/* ------------------------------------------------------------------------
 * Projets SUPPRIMÉS (« pierres tombales », voir utils/projectTombstones.js).
 *
 * Un projet supprimé vit dans DEUX magasins : ce navigateur (`PROJECTS_KEY`)
 * et le document du dataset (payload cloud / sauvegarde HTML, clé `projects`).
 * La suppression n'effaçait que le premier : à la réouverture du dataset, la
 * copie du payload était ré-adoptée et le projet réapparaissait. On garde donc
 * ici la liste des projets supprimés (localStorage) — elle est appliquée à
 * CHAQUE lecture, CHAQUE écriture et CHAQUE fusion, et App.jsx la range dans
 * le payload du dataset pour que la suppression atteigne les autres postes.
 * ---------------------------------------------------------------------- */
const readRawTombstones = () => {
  try {
    const raw = localStorage.getItem(DELETED_PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};
const writeDeletedProjects = (list) => {
  try {
    localStorage.setItem(DELETED_PROJECTS_KEY, JSON.stringify(normalizeTombstones(list)));
  } catch { /* ignore */ }
};

/* ── LES LEVÉES DE TOMBE : « ce projet supprimé doit revenir » ──────────────
   Une suppression est définitive… sauf quand l'utilisateur dit le contraire. La
   levée (la date de restauration) est écrite ici et APPLIQUÉE PAR LA SEULE
   LECTURE des tombes (`readDeletedProjects`) : tous les chemins qui ramènent un
   projet d'une copie la respectent donc sans rien savoir d'elle. Voir le
   commentaire « une tombe peut être levée » de utils/projectTombstones.js. */
const readRevivals = () => {
  try {
    const raw = localStorage.getItem(REVIVED_PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};
const writeRevivals = (list) => {
  try {
    localStorage.setItem(REVIVED_PROJECTS_KEY, JSON.stringify(normalizeRevivals(list)));
  } catch { /* ignore */ }
};

/** LES TOMBES QUI TIENNENT ENCORE — la seule lecture des projets supprimés :
 *  celles que l'utilisateur n'a pas restaurées (voir projectTombstones.js). */
const readDeletedProjects = () => withoutRevivedProjects(readRawTombstones(), readRevivals());

/** Les projets supprimés sur ce navigateur (liste prête à être portée par le
 *  payload du dataset — voir App.jsx cloudProjectsPayload). */
export const loadDeletedProjects = () => normalizeTombstones(readDeletedProjects());

/** Les projets supprimés d'UN dataset : la liste que la page Projets montre
 *  (« 🗑 Recently deleted ») pour offrir le chemin de retour. Une tombe sans
 *  dataset est montrée partout (une suppression faite hors dataset supprime
 *  l'id partout — même règle que isProjectDeleted). */
export const loadDeletedProjectsForDataset = (datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : String(activeProjectDataset || '');
  return loadDeletedProjects()
    .filter((t) => !t.datasetId || !datasetId || t.datasetId === datasetId);
};

/** Les levées de tombe de ce navigateur : elles voyagent avec le payload du
 *  dataset, comme les suppressions — sinon un autre poste, qui garde la tombe,
 *  la re-publierait et le projet restauré disparaîtrait une seconde fois. */
export const loadRevivedProjects = () => normalizeRevivals(readRevivals());

/** Les levées portées par un payload de dataset : elles rejoignent celles de ce
 *  navigateur (une restauration faite ailleurs s'applique donc ici aussi). */
export const adoptRevivedProjects = (payloadRevivals, datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : (activeProjectDataset || '');
  const next = normalizeRevivals([
    ...readRevivals(),
    ...revivalsForDataset(payloadRevivals, datasetId)
  ]);
  writeRevivals(next);
  return next;
};

/** ↩ LE CHEMIN DE RETOUR D'UN PROJET SUPPRIMÉ — le geste qui manquait.
 *
 *  POURQUOI : la tombe d'un projet était DÉFINITIVE. Le rapport : « there was a
 *  project called “tmp” with figures and text. It looks gone. If I reload from
 *  HTML and select only to restore projects, nothing happens. » Rien ne pouvait
 *  se passer : aucun geste ne retirait la tombe, et les trois chemins de
 *  récupération (import d'une sauvegarde, fusion du payload, ré-adoption de
 *  l'index du Drive) l'appliquent tous — le projet ne revenait par AUCUN moyen,
 *  et sans un mot.
 *
 *  Ce que ce geste écrit : la LEVÉE (la date de restauration). La tombe n'est
 *  pas effacée — c'est la lecture qui compare les deux dates, la plus récente
 *  gagnant : la restauration est donc portée par le payload et par
 *  `_workspace/state.json`, et un poste qui garde la tombe ne peut plus la
 *  ré-imposer.
 *  @returns {{ lifted:number, list:Array }} `lifted` = tombes réellement
 *           annulées par ce geste (0 = le projet n'était pas supprimé). */
export const reviveDeletedProject = (id, datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : (activeProjectDataset || '');
  const before = readDeletedProjects().length;
  writeRevivals(addRevival(readRevivals(), { id, datasetId }));
  const list = readDeletedProjects();
  return { lifted: Math.max(0, before - list.length), list };
};

/** Enregistre la suppression d'un projet : elle ne sera plus jamais annulée
 *  par une copie locale, un payload ou une sauvegarde (utils/projectTombstones). */
export const recordProjectDeletion = (project, deletedAt) => {
  if (!project || !String(project.id || '').trim()) return loadDeletedProjects();
  const datasetId = String(project.datasetId || activeProjectDataset || '');
  /* Une suppression APRÈS une restauration l'emporte : la levée du projet part
     en même temps que la tombe arrive (la plus récente des deux gagne). */
  writeRevivals(withoutRevival(readRevivals(), { id: project.id, datasetId }));
  const next = addTombstone(readDeletedProjects(), {
    id: project.id,
    datasetId
  }, deletedAt);
  writeDeletedProjects(next);
  return next;
};

/** Les suppressions portées par un payload de dataset : elles rejoignent celles
 *  de ce navigateur (et sont donc appliquées à partir de maintenant). */
export const adoptDeletedProjects = (payloadTombstones, datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : (activeProjectDataset || '');
  const next = mergeTombstones(readDeletedProjects(), tombstonesForDataset(payloadTombstones, datasetId));
  writeDeletedProjects(next);
  return normalizeTombstones(next);
};

/** RÉCUPÉRER les projets qu'un état d'espace de travail rapporte (Drive
 *  `_workspace/state.json`, voir workspaceDrive.buildWorkspaceState).
 *
 *  POURQUOI : « all of my projects have disappeared from the program, even
 *  though they are still present in Google Drive ». Le Drive gardait la liste
 *  des projets depuis le début, mais RIEN ne la relisait : le magasin du
 *  navigateur était la seule copie utilisée, donc n'importe quelle perte locale
 *  (magasin vidé, écriture refusée, poste neuf, cache effacé) était définitive
 *  à l'écran alors que tout était encore sur le Drive.
 *
 *  RÈGLE : AJOUT SEUL. Un projet déjà présent garde la copie la PLUS RICHE
 *  (jamais remplacé par une version plus pauvre), un projet absent est remis
 *  avec son propre `datasetId` (donc visible dans son dataset, pas dans un
 *  autre), un projet tombstoned n'est jamais ré-adopté, et rien n'est jamais
 *  effacé. C'est la même règle d'identité que mergeProjectsFromCloud (id, puis
 *  nom dans le MÊME dataset).
 *  @returns {{ adopted:number, list:Array }} */
export const adoptWorkspaceProjects = (payloadProjects) => {
  const payload = (Array.isArray(payloadProjects) ? payloadProjects : [])
    .filter((p) => p && typeof p === 'object' && p.id);
  if (!payload.length) return { adopted: 0, list: loadProjects() };
  const tombstones = readDeletedProjects();
  const byId = new Map();       // id -> projet (le plus riche)
  const nameToId = new Map();   // <datasetId>::<nom> -> id
  readRawProjects().forEach((p) => {
    if (!p || !p.id) return;
    if (isProjectDeleted(p, tombstones)) return;
    byId.set(String(p.id), p);
    const nk = p.name ? datasetNameKey(p) : '';
    if (nk && !nameToId.has(nk)) nameToId.set(nk, String(p.id));
  });
  let adopted = 0;
  payload.forEach((p) => {
    if (isProjectDeleted(p, tombstones)) return;   // supprimé : jamais ré-adopté
    const id = String(p.id);
    const cur = byId.get(id);
    if (cur) {
      if (projectSize(p) > projectSize(cur)) { byId.set(id, p); adopted += 1; }
      return;
    }
    const nk = p.name ? datasetNameKey(p) : '';
    const twinId = nk ? nameToId.get(nk) : null;
    if (twinId && twinId !== id) {
      // Même nom dans le même dataset : la copie la plus riche gagne (un
      // homonyme vide ne prend pas la place du vrai projet).
      if (projectSize(byId.get(twinId) || {}) >= projectSize(p)) return;
      byId.delete(twinId);
      if (nk) nameToId.delete(nk);
    }
    byId.set(id, p);
    if (nk) nameToId.set(nk, id);
    adopted += 1;
  });
  if (adopted) writeRawProjects(Array.from(byId.values()));
  return { adopted, list: loadProjects() };
};

const readRawProjects = () => {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};
/* ⛔ LE VERROU — UNE ÉCRITURE NE PEUT PAS FAIRE DISPARAÎTRE UN PROJET SANS TOMBE.

   C'est la réparation de fond du rapport : « a user created a new project and
   then tried to delete it … now all of my projects have disappeared from the
   program, even though they are still present in Google Drive ».

   Le magasin du navigateur (`labWorkspace_projects`) est la SEULE copie que le
   programme relit : une écriture qui l'écourte efface donc des projets de
   l'écran. Or trois fonctions l'écrivent avec un TABLEAU reçu de l'extérieur —
   `saveProjects` (l'état d'une page), `saveProjectsRescued` (le même, allégé) et
   `mergeProjectsFromCloud` (une copie du payload) — et un tableau peut être
   plus court que le magasin pour cent raisons qui n'ont rien à voir avec une
   suppression : un état React périmé après un `await`, la portée d'un dataset,
   un filtre par scientifique, un payload qui ne portait que les projets d'un
   auteur, une sauvegarde restaurée…

   Une SUPPRESSION, elle, se reconnaît à sa TOMBE : « Delete project » écrit la
   tombe du projet visé AVANT d'écrire la liste (voir `recordProjectDeletion`).
   Le verrou compare donc les deux : ce qui manque à la liste ET n'a pas de
   tombe est REMIS. Supprimer un projet reste possible (sa tombe le sort) ;
   perdre un projet par accident ne l'est plus.
   `allowDrops` n'a qu'un appelant légitime — `removeProjectsOfDataset`, qui
   retire les projets d'un dataset lui-même supprimé (ses tombes viennent d'être
   effacées : la disparition est voulue). */
let lastUntombstonedRescue = [];

/** Les projets qu'une écriture a REFUSÉ de perdre (elle les a remis dans le
 *  magasin). L'appelant les affiche ; la lecture vide la note (un seul rapport
 *  par écriture). */
export const takeUntombstonedRescue = () => {
  const out = lastUntombstonedRescue;
  lastUntombstonedRescue = [];
  return out;
};

const writeRawProjects = (list, { allowDrops = false } = {}) => {
  try {
    /* Une copie d'un projet SUPPRIMÉ ne peut jamais rentrer dans le cache :
       c'est le dernier rempart contre la « résurrection » (un état React
       périmé, un payload rechargé, une sauvegarde restaurée…). */
    const tombstones = readDeletedProjects();
    const incoming = withoutDeletedProjects(Array.isArray(list) ? list : [], tombstones);
    /* …et son PENDANT : ce qui n'a PAS de tombe ne peut pas disparaître non
       plus (voir le verrou ci-dessus). */
    const guarded = allowDrops
      ? { list: incoming, rescued: [] }
      : protectUntombstoned(readRawProjects(), incoming, tombstones);
    if (guarded.rescued.length) {
      lastUntombstonedRescue = guarded.rescued;
      console.warn(
        `Projects: ${guarded.rescued.length} project(s) this write was about to drop WITHOUT a deletion were kept `
        + `(${guarded.rescued.slice(0, 5).map((p) => p && p.name).filter(Boolean).join(', ')}). `
        + 'Only “Delete project” — which writes a tombstone first — removes a project.'
      );
    }
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(dedupeProjects(guarded.list)));
    return { ok: true, error: '' };
  } catch (err) {
    /* ❗ UNE ÉCRITURE QUI ÉCHOUE DOIT SE SAVOIR.
       Le quota du navigateur (~5 Mo) est partagé par tout le poste de travail :
       un manuscrit importé avec ses figures peut le remplir. Jusqu'ici
       l'échec était avalé (`catch { }`) : la page projet affichait « ✓ 3
       section(s) filled · 12 numbered reference(s) » alors que RIEN n'avait
       été écrit — à la réouverture du projet le texte, les références et la
       bibliographie avaient disparu. Le résultat est maintenant renvoyé à
       l'appelant, qui peut vérifier (saveProjectsChecked) et le dire. */
    return { ok: false, error: String((err && err.message) || err || 'the browser refused the write') };
  }
};

/** Projects of one dataset — defaults to the currently open one. When no
 *  dataset scope is active the historical (global) list is returned. Legacy
 *  projects (not yet tagged to a dataset) only appear in that global view. */
export const loadProjects = (datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : activeProjectDataset;
  const all = withoutDeletedProjects(readRawProjects(), readDeletedProjects());
  if (!datasetId) return dedupeProjects(all);
  return dedupeProjects(all.filter((p) => p && String(p.datasetId) === datasetId));
};

/** Persist the projects of the ACTIVE dataset. The list is authoritative for
 *  that scope (a project removed from it is deleted), while projects of the
 *  other datasets and not-yet-adopted legacy projects are left untouched.
 *  @returns {{ ok:boolean, error:string }} — `ok:false` = the browser REFUSED
 *  the write (full quota, private mode…). Callers that must not lose data use
 *  saveProjectsChecked() instead, which relit ce qui a réellement été écrit. */
export const saveProjects = (list) => {
  const safe = dedupeProjects(Array.isArray(list) ? list : []);
  if (!activeProjectDataset) {
    return writeRawProjects(safe);
  }
  const all = readRawProjects();
  const tagged = safe.map((p) => ({
    ...p,
    datasetId: (p && String(p.datasetId)) || activeProjectDataset
  }));
  const merged = [
    ...all.filter((p) => !(p && String(p.datasetId) === activeProjectDataset)),
    ...tagged
  ];
  return writeRawProjects(merged);
};

/* 🔗 LE PROJET APPREND QUE L'EXPÉRIENCE LUI APPARTIENT — le lien écrit DU CÔTÉ
   DU PROJET, depuis le magasin.

   Le rapport, mot pour mot : « quando creo un esperimento esso viene forzato ad
   essere associato ad un progetto ma quando vado nella pagina dei progetti leggo
   0 esperimenti associati. é come se l'esperimento sa di essere associato al
   progetto ma il progetto non sa di avere l'esperimento associato a meno che non
   lo si definisca a mano. »

   Le lien test ↔ projet vit des DEUX côtés : le test porte `projectNames` (il
   « sait »), le projet porte une entrée par instance dans `experiments[]` (c'est
   cette liste que cette page COMPTE et que la page du projet AFFICHE, avec sa
   ligne ⇄ Move). La création forcée d'une expérience n'écrivait que le premier
   côté : l'expérience était donc introuvable dans son propre projet — compte à
   0, liste vide, et rien à déplacer non plus.

   Cette fonction est la RÉPARATION : elle relit le magasin, ajoute les entrées
   manquantes (règle pure `experimentRules.reconcileExperimentLinks`, AJOUT SEUL
   et idempotente), réécrit une seule fois si quelque chose manquait, et rend son
   compte rendu. Elle ne retire jamais rien : retirer une expérience d'un projet
   reste le ✕ de la page projet.

   @returns {{ ok:boolean, error:string, added:number, linked:number,
               unpaired:Array, projects:Array }}
     `added`    = entrées écrites (0 = le magasin était déjà d'aplomb) ;
     `unpaired` = expériences qui nomment un projet INEXISTANT (renommé ou
                  supprimé) : rien n'est écrit pour elles, et l'appelant le dit.
*/
export const reconcileProjectExperiments = (tests, opts = {}) => {
  const options = { labelOf: testTypeLabel, ...(opts || {}) };
  /* ⛔ HORS DATASET, ON NE RÉPARE RIEN. `loadProjects()` rend alors la vue
     « globale » (les projets de TOUS les datasets) : y relier les expériences
     d'un autre dataset écrirait un lien dans le projet homonyme d'un dataset
     voisin. La portée est la seule autorité (voir setProjectDatasetScope). */
  if (!getActiveProjectDataset()) {
    return { ok: true, error: '', added: 0, linked: 0, unpaired: [], projects: [] };
  }
  const projects = loadProjects();
  if (projects.length === 0) {
    return { ok: true, error: '', added: 0, linked: 0, unpaired: [], projects };
  }
  const res = reconcileExperimentLinks(projects, tests, options);
  if (!res.changed) {
    return { ok: true, error: '', added: 0, linked: res.linked, unpaired: res.unpaired, projects };
  }
  const written = saveProjects(res.projects);
  return {
    ok: !!(written && written.ok),
    error: String((written && written.error) || ''),
    added: res.added,
    linked: res.linked,
    unpaired: res.unpaired,
    projects: res.projects
  };
};

/** LE GESTE « LOAD HTML » — les projets venus d'un fichier de sauvegarde sont
 *  ADOPTÉS par le dataset qui les reçoit.
 *
 *  Sans ce geste, ils gardent l'étiquette de leur dataset D'ORIGINE (ils ont été
 *  exportés par `loadProjects()`, donc déjà étiquetés) : ils atterrissent bien
 *  dans le magasin du navigateur, mais `loadProjects()` — qui ne rend que les
 *  projets du dataset OUVERT — ne les voit pas. C'est le défaut réparé : « les
 *  expériences reviennent, les projets non ». La décision, elle, est pure et
 *  testable : voir `planProjectImport` (utils/projectImport.js).
 *
 *  @param {Array} fileProjects les projets du fichier de sauvegarde
 *  @param {{ datasetId?:string, replace?:boolean }} [arg]
 *    ⋅ `datasetId` — le dataset qui reçoit (défaut : celui qui est ouvert) ;
 *    ⋅ `replace` — `true` pour « Import everything » (la copie du fichier
 *      l'emporte), `false` pour « ➕ Add the selected elements » (on n'AJOUTE
 *      que ce qui manque : ce que le dataset a déjà n'est jamais écrasé).
 *  @returns {{ ok:boolean, error:string, adopted:Array, skippedDeleted:Array }}
 *    `adopted` = les projets réellement écrits (re-étiquetés au dataset qui les
 *    reçoit) ; `skippedDeleted` = les projets du fichier qui ont une TOMBE ici :
 *    ils ne reviennent pas, et l'appelant le dit (une restauration silencieuse
 *    qui « oublie » un projet est un mensonge). */
export const importProjectsFromFile = (fileProjects, { datasetId, replace = false } = {}) => {
  const target = datasetId != null ? String(datasetId) : (activeProjectDataset || '');
  const { list, adopted, skippedDeleted } = planProjectImport({
    store: readRawProjects(),
    tombstones: readDeletedProjects(),
    fileProjects,
    targetDatasetId: target,
    replace
  });
  /* RIEN N'ARRIVE → RIEN NE S'ÉCRIT. Un fichier dont l'élément « Projets » est
     vide (ou dont tous les projets ont une tombe) ne doit pas emporter la liste
     de ce dataset : le magasin reste tel quel, et l'appelant dit pourquoi
     (App.jsx : « the “Projets” item of this file is EMPTY »). */
  if (!adopted.length) return { ok: true, error: '', adopted, skippedDeleted };
  const written = writeRawProjects(list);
  return { ok: written.ok, error: written.error, adopted, skippedDeleted };
};

/** Poids approximatif d'un projet dans le magasin (octets JSON). */
export const projectFootprint = (project) => {
  try { return JSON.stringify(project).length; } catch { return Infinity; }
};

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

/* ---------------------------------------------------------------------------
 * LES DEUX FAÇONS D'ALLÉGER UNE FIGURE — séparées pour que l'urgence les
 * applique dans le bon ordre (voir saveProjectsRescued) :
 *   1. linkProjectFiguresToDrive — SANS PERTE : le Drive a la copie, on garde le
 *      lien au lieu de l'image encodée ;
 *   2. dropOneFigurePixels — DERNIER RECOURS : les pixels nés dans ce navigateur
 *      disparaissent, l'entrée garde sa place, son nom, sa légende et son ancre
 *      (`pixelsMissing`).
 * Le TEXTE, les références et la mise en page ne sont touchés par AUCUNE des
 * deux : le travail écrit ne se perd jamais pour faire de la place à des pixels,
 * qui eux se retéléchargent ou se réimportent.
 * ------------------------------------------------------------------------ */

/** Les sections de figures d'un projet ({ background: [...], results: [...] }). */
const figureSectionsOf = (project) => (
  project && project.figures && typeof project.figures === 'object' ? Object.keys(project.figures) : []
);

/** Applique `map(entrée, section, index)` à toutes les figures du projet.
 *  `map` renvoie la copie modifiée, ou null quand rien ne change.
 *  @returns {{ project:object, touched:number, changed:boolean }} */
const mapProjectFigures = (project, map) => {
  const sections = figureSectionsOf(project);
  if (!sections.length) return { project, touched: 0, changed: false };
  let touched = 0;
  let changed = false;
  const figures = {};
  sections.forEach((section) => {
    const list = Array.isArray(project.figures[section]) ? project.figures[section] : [];
    figures[section] = list.map((entry, index) => {
      if (!entry || typeof entry !== 'object') return entry;
      const out = map({ ...entry }, entry, section, index);
      if (!out) return entry;
      changed = true;
      touched += 1;
      return out;
    });
  });
  return { project: changed ? { ...project, figures } : project, touched, changed };
};

/** ÉTAPE 1 — le LIEN au lieu des pixels, quand le Drive a déjà la copie.
 *  Rien n'est perdu : le lien ouvre la même image.
 *  @returns {{ project:object, touched:number }} */
export const linkProjectFiguresToDrive = (project) => {
  const out = mapProjectFigures(project, (copy) => {
    let changed = false;
    if (isDataUrl(copy.full) && copy.driveUrl) { copy.full = copy.driveUrl; changed = true; }
    if (isDataUrl(copy.url) && copy.driveUrl) { copy.url = copy.driveUrl; changed = true; }
    return changed ? copy : null;
  });
  return { project: out.project, touched: out.touched };
};

/** ÉTAPE 2 — les pixels d'UNE SEULE figure (section + index) : l'allègement
 *  d'urgence ne jette que le nécessaire, du plus gros au plus petit. L'entrée
 *  garde sa place, son nom, sa légende et son ancre.
 *  @returns {{ project:object, dropped:number, bytes:number }} */
export const dropOneFigurePixels = (project, section, index) => {
  const list = Array.isArray(((project && project.figures) || {})[section]) ? project.figures[section] : null;
  const entry = list && list[index];
  if (!entry || typeof entry !== 'object') return { project, dropped: 0, bytes: 0 };
  const copy = { ...entry };
  let bytes = 0;
  let changed = false;
  if (isDataUrl(copy.url)) { bytes += copy.url.length; copy.url = copy.driveUrl || ''; changed = true; }
  if (isDataUrl(copy.full)) { bytes += copy.full.length; copy.full = copy.driveUrl || ''; changed = true; }
  if (!changed) return { project, dropped: 0, bytes: 0 };
  copy.pixelsMissing = true;
  const figures = {
    ...project.figures,
    [section]: [...list.slice(0, index), copy, ...list.slice(index + 1)]
  };
  return { project: { ...project, figures }, dropped: 1, bytes };
};

/**
 * LE POIDS D'UN PROJET QUAND LE NAVIGATEUR EST PRESQUE PLEIN.
 *
 * Un manuscrit importé avec ses figures peut dépasser les ~5 Mo de quota du
 * navigateur : l'écriture entière échouait alors, et TOUT était perdu (texte,
 * références, bibliographie). Elle rend une copie du projet plus légère, en
 * commençant par ce qui est le moins coûteux à perdre :
 *   1. les copies « pleine résolution » des figures qui ne vivent que dans ce
 *      navigateur (`data:` URL) — la vignette et/ou le lien Drive restent ;
 *   2. les vignettes elles-mêmes : l'entrée garde sa place, son nom et sa
 *      légende (`pixelsMissing: true`), le TEXTE, les RÉFÉRENCES et la mise en
 *      page du document sont intacts.
 * Le texte des sections n'est JAMAIS touché.
 *
 * ⚠ L'URGENCE N'ATTEND PAS CE BUDGET. Quand le navigateur REFUSE une écriture,
 *   c'est saveProjectsRescued qui prend la main et fait le strict minimum —
 *   les deux étapes ci-dessus, figure par figure, de la plus lourde à la plus
 *   légère — en réessayant après CHAQUE figure : c'est là que « ça enregistre
 *   quand même », et c'est ce qui manquait quand la page se contentait de dire
 *   « this browser refused to save this project ».
 * @returns {{ project:object, ok:boolean, footprint:number, dropped:string[] }}
 */
export const lightenProjectForStorage = (project, { budget = 900000 } = {}) => {
  const footprint = projectFootprint(project);
  if (!project || typeof project !== 'object' || footprint <= budget) {
    return { project, ok: true, footprint, dropped: [] };
  }
  if (!figureSectionsOf(project).length) return { project, ok: false, footprint, dropped: [] };
  const dropped = [];
  /* 1 — les copies pleine résolution gardées dans ce navigateur. */
  const linked = linkProjectFiguresToDrive(project);
  let next = linked.project;
  if (linked.touched) dropped.push(`${linked.touched} full-resolution figure copy(ies) kept only in this browser`);
  if (projectFootprint(next) > budget) {
    /* 2 — les pixels eux-mêmes : le document garde la figure à sa place (nom,
       légende, ancre) et le PDF est réparable en réimportant le document
       ou en connectant le Drive. */
    const bare = mapProjectFigures(next, (copy) => {
      let changed = false;
      if (isDataUrl(copy.url)) { copy.url = copy.driveUrl || ''; changed = true; }
      if (isDataUrl(copy.full)) { copy.full = copy.driveUrl || ''; changed = true; }
      if (!changed) return null;
      copy.pixelsMissing = true;
      return copy;
    });
    if (bare.changed) {
      next = bare.project;
      dropped.push('the figure images themselves (they existed in this browser only)');
    }
  }
  const after = projectFootprint(next);
  return { project: next, ok: after <= budget, footprint: after, dropped };
};

/**
 * ÉCRIRE PUIS RELIRE : la seule façon d'affirmer « c'est enregistré ».
 *
 * `fields` = ce qui doit se retrouver dans le projet RELU du magasin
 * ({ background: '…html…', references: [...] }) — la comparaison est faite sur
 * la valeur JSON, donc un tableau ou un objet se vérifient aussi.
 * @returns {{ ok:boolean, error:string, stored:object|null, missing:string[] }}
 *          `missing` = les champs absents ou différents après relecture.
 */
/** RELIRE LE MAGASIN et dire si `fields` y sont — la seule preuve d'une
 *  écriture. Aucune écriture ici : saveProjectsChecked l'appelle après avoir
 *  écrit, et saveProjectsRescued après CHACUNE de ses tentatives.
 *  @returns {{ ok:boolean, error:string, stored:object|null, missing:string[] }} */
const verifyStored = (projectId, fields) => {
  const ids = Object.keys(fields || {});
  if (!projectId) return { ok: true, error: '', stored: null, missing: [] };
  const stored = loadProjects().find((p) => p && String(p.id) === String(projectId)) || null;
  if (!stored) {
    return { ok: false, error: 'the project is not in the store after saving', stored: null, missing: ids };
  }
  const missing = ids.filter((k) => (
    JSON.stringify(stored[k] === undefined ? null : stored[k])
    !== JSON.stringify(fields[k] === undefined ? null : fields[k])
  ));
  return { ok: missing.length === 0, error: '', stored, missing };
};

export const saveProjectsChecked = (list, { projectId = '', fields = {} } = {}) => {
  const ids = Object.keys(fields || {});
  const written = saveProjects(list);
  if (!written.ok) return { ok: false, error: written.error, stored: null, missing: ids };
  return verifyStored(projectId, fields);
};

/**
 * ÉCRIRE MALGRÉ UN MAGASIN PLEIN — la place se fait DANS le navigateur, pas
 * dans le cloud.
 *
 * ⛔ LE DÉFAUT (signalé deux fois). Tout le travail de la page vit dans le
 *    magasin du navigateur : ~5 Mo PAR SITE, partagés par tous les datasets du
 *    poste. Une fois plein, CHAQUE modification était refusée et la page se
 *    contentait d'avertir — « this browser refused to save this project » — en
 *    conseillant de supprimer un dataset, c'est-à-dire de perdre du travail
 *    pour pouvoir en écrire. Drive et Firestore en gardent une COPIE, mais une
 *    copie ne rend pas un octet à ce magasin : d'où un message qui revenait
 *    quoi qu'on fasse.
 *
 * ✅ CE QUE FAIT CETTE FONCTION : écrire, VÉRIFIER, et si le navigateur refuse,
 *    refaire de la place par ordre de coût, en s'arrêtant DÈS que ça passe :
 *      1. une copie pleine résolution dont le Drive a déjà le fichier devient un
 *         LIEN (linkProjectFiguresToDrive) — rien n'est perdu ;
 *      2. les pixels d'une figure qui ne vivent que dans ce navigateur, de la
 *         plus lourde à la plus légère, UNE PAR UNE (dropOneFigurePixels) :
 *         l'entrée garde sa place, son nom, sa légende et son ancre ;
 *      3. les listes de figures dont les pixels sont déjà sur le cloud
 *         (pruneRecoverableLibraryCaches) : elles se relisent du Drive.
 *    Les projets des AUTRES datasets sont allégés eux aussi quand il le faut
 *    (c'est la SOMME qui doit rentrer) ; le TEXTE, les références, la
 *    bibliographie et la mise en page ne sont JAMAIS touchés.
 *
 * @returns {{ ok:boolean, error:string, list:Array, missing:string[],
 *             scopedChanged:boolean, linked:number, droppedImages:number,
 *             forgotten:number, usedBefore:number,
 *             usage:{total:number, keys:Array<{key:string,bytes:number}>} }}
 *   `list` = la liste de portée à adopter (allégée si besoin : l'état React doit
 *   suivre EXACTEMENT ce qui a été écrit, sinon l'écriture suivante ramène le
 *   poids qui vient d'être libéré). En échec, c'est la liste DONNÉE : rien n'a
 *   été écrit, la page garde ce qu'elle avait.
 */
export const saveProjectsRescued = (list, { projectId = '', fields = {} } = {}) => {
  const scoped = dedupeProjects(Array.isArray(list) ? list : []);
  const lightScoped = new Map();   // id → version allégée des projets DE CETTE LISTE
  const lightForeign = new Map();  // id → version allégée des projets DES AUTRES datasets
  const usedBefore = readLocalStoreUsage().total;
  let linked = 0;
  let droppedImages = 0;
  let forgotten = 0;

  /** La version courante (allégée si elle l'a déjà été) d'un projet du magasin. */
  const versionOf = (row) => (row.where === 'scope' ? lightScoped : lightForeign).get(row.project.id)
    || row.project;

  /** Les projets du magasin à examiner, du plus lourd au plus léger. */
  const heaviestFirst = () => {
    const rows = [];
    scoped.forEach((p) => { if (p && p.id) rows.push({ where: 'scope', project: p }); });
    readRawProjects().forEach((p) => {
      if (!p || !p.id) return;
      if (String(p.datasetId || '') === String(activeProjectDataset || '')) return;
      if (scoped.some((s) => s && s.id === p.id)) return;
      rows.push({ where: 'other', project: p });
    });
    return rows.sort((a, b) => projectFootprint(versionOf(b)) - projectFootprint(versionOf(a)));
  };

  /** La plus grosse figure dont les pixels sont encore encodés dans ce magasin. */
  const biggestInlineFigure = () => {
    let best = null;
    heaviestFirst().forEach((row) => {
      const project = versionOf(row);
      Object.keys(project.figures || {}).forEach((section) => {
        (project.figures[section] || []).forEach((entry, index) => {
          if (!entry || typeof entry !== 'object') return;
          const bytes = (isDataUrl(entry.url) ? entry.url.length : 0)
            + (isDataUrl(entry.full) ? entry.full.length : 0);
          if (!bytes || (best && bytes <= best.bytes)) return;
          best = {
            ...row, project, section, index, bytes
          };
        });
      });
    });
    return best;
  };

  /* LE MAGASIN ENTIER, EN UNE ÉCRITURE : la liste de portée (avec ses versions
     allégées) + les projets des autres datasets (remplacés par leur version
     allégée quand on en a une) — exactement la fusion de saveProjects. */
  const mergedStore = () => {
    const tagged = scoped.map((p) => ({
      ...(lightScoped.get(p && p.id) || p),
      datasetId: (p && String(p.datasetId)) || activeProjectDataset
    }));
    if (!activeProjectDataset) return tagged;
    const foreign = readRawProjects()
      .filter((p) => !(p && String(p.datasetId) === activeProjectDataset))
      .map((p) => (p && lightForeign.get(p.id)) || p);
    return [...foreign, ...tagged];
  };

  const writeOnce = () => {
    if (!lightForeign.size) {
      return saveProjectsChecked(scoped.map((p) => lightScoped.get(p && p.id) || p), { projectId, fields });
    }
    const written = writeRawProjects(mergedStore());
    if (!written.ok) return { ok: false, error: written.error, stored: null, missing: Object.keys(fields || {}) };
    return verifyStored(projectId, fields);
  };

  const done = (res) => ({
    ok: res.ok,
    error: res.ok ? '' : String(res.error || ''),
    missing: res.missing || [],
    list: res.ok ? scoped.map((p) => lightScoped.get(p && p.id) || p) : scoped,
    /* ⚠ SEULEMENT QUAND ÇA A ÉTÉ ÉCRIT. Après un échec, annoncer « la liste a
       changé » ferait adopter par la page une liste identique mais NOUVELLE :
       l'effet de sauvegarde repartirait, échouerait, ré-adopterait… une boucle
       sans fin. En échec on rend la liste DONNÉE et `scopedChanged` est faux. */
    scopedChanged: res.ok && lightScoped.size > 0,
    linked,
    droppedImages,
    forgotten,
    usedBefore,
    usage: readLocalStoreUsage()
  });

  let res = writeOnce();
  if (res.ok) return done(res);

  /* 1 — LE LIEN PLUTÔT QUE LES PIXELS (aucune perte : le Drive a la copie). */
  heaviestFirst().forEach((row) => {
    const out = linkProjectFiguresToDrive(versionOf(row));
    if (!out.touched) return;
    (row.where === 'scope' ? lightScoped : lightForeign).set(row.project.id, out.project);
    linked += out.touched;
  });
  if (linked) res = writeOnce();

  /* 2 — LES PIXELS, UNE FIGURE À LA FOIS, DE LA PLUS LOURDE À LA PLUS LÉGÈRE :
     l'écriture passe dès qu'elle peut, donc on ne jette que le nécessaire. */
  while (!res.ok) {
    const biggest = biggestInlineFigure();
    if (!biggest) break;
    const out = dropOneFigurePixels(biggest.project, biggest.section, biggest.index);
    if (!out.dropped) break;   // plus rien à jeter : aucune boucle sans fin
    (biggest.where === 'scope' ? lightScoped : lightForeign).set(biggest.project.id, out.project);
    droppedImages += out.dropped;
    res = writeOnce();
  }

  /* 3 — LES LISTES DE FIGURES DÉJÀ SUR LE CLOUD : elles se relisent du Drive
     (« ⬇ Add missing from Drive »), c'est le dernier poste qu'on peut rendre. */
  if (!res.ok) {
    const pruned = pruneRecoverableLibraryCaches();
    forgotten = pruned.forgotten;
    if (forgotten) res = writeOnce();
  }

  return done(res);
};

/** Remove every project of a dataset from this device's cache (dataset
 *  deletion). The dataset's own tombstones go with it: a dataset recreated
 *  with the same id must be able to show its projects again. */
export const removeProjectsOfDataset = (datasetArg) => {
  const datasetId = datasetArg != null ? String(datasetArg) : null;
  if (!datasetId) return;
  try {
    writeDeletedProjects(withoutDatasetTombstones(readDeletedProjects(), datasetId));
    /* …et ses LEVÉES aussi : un dataset recréé avec le même id ne doit pas
       hériter de restaurations de l'ancien (symétrique des tombes ci-dessus). */
    writeRevivals(readRevivals().filter((r) => String((r && r.datasetId) || '') !== datasetId));
    const kept = readRawProjects().filter((p) => !(p && String(p.datasetId) === datasetId));
    /* ICI la disparition est VOULUE (le dataset n'existe plus, et ses tombes
       viennent d'être effacées) : le verrou de `writeRawProjects` est donc
       explicitement ouvert — c'est son seul appelant légitime. */
    writeRawProjects(kept, { allowDrops: true });
  } catch { /* ignore */ }
};

/** Merge the projects carried by a dataset payload (cloud/HTML) into this
 *  device's cache without creating duplicates:
 *    • same id in the same dataset   → the richer copy wins
 *    • same name + dataset, diff. id → the same logical project → keep the
 *      RICHER of the two (an empty duplicate never replaces the full project)
 *  Projects already tagged to ANOTHER dataset are ignored here — they are
 *  re-added when that dataset is opened (they live in its own payload).
 *
 *  Legacy projects (created before per-dataset scoping, no `datasetId`) are
 *  attributed to a dataset as soon as one opens whose tests contain their
 *  linked experiment ids (`opts.testIds`). Projects that reference NO
 *  experiment at all cannot be attributed by their links: when
 *  `opts.adoptAllLegacy` is true they go to the first dataset opened after
 *  the upgrade (fallback chosen by the workspace owner). A legacy project
 *  with experiments that live in another dataset is left untagged until that
 *  dataset is opened. */
export const mergeProjectsFromCloud = (payloadProjects, opts = {}) => {
  const datasetId = opts.datasetId != null ? String(opts.datasetId) : activeProjectDataset;
  const testIds = opts.testIds instanceof Set
    ? opts.testIds
    : new Set((Array.isArray(opts.tests) ? opts.tests : []).map((t) => t && t.id).filter(Boolean));
  const adoptAllLegacy = !!opts.adoptAllLegacy;
  const payload = Array.isArray(payloadProjects) ? payloadProjects : [];
  /* Les SUPPRESSIONS : celles de ce navigateur + celles que le payload porte
     (`opts.deleted`, écrit par le poste qui a supprimé le projet). Elles sont
     appliquées ici — c'est exactement l'endroit où la copie du payload faisait
     « ressusciter » un projet supprimé. */
  const tombstones = adoptDeletedProjects(opts.deleted, datasetId);

  let changed = false;
  const byId = new Map();
  const nameToId = new Map(); // dataset-scoped name → id
  readRawProjects().forEach((p) => {
    if (!p || typeof p !== 'object' || !p.id) return;
    if (isProjectDeleted(p, tombstones)) { changed = true; return; } // copie locale d'un projet supprimé : effacée
    byId.set(p.id, p);
    const nk = p && p.name ? datasetNameKey(p) : '';
    if (nk && !nameToId.has(nk)) nameToId.set(nk, p.id);
  });

  const remember = (p) => {
    if (isProjectDeleted(p, tombstones)) return; // supprimé : jamais ré-adopté
    const nk = p && p.name ? datasetNameKey(p) : '';
    const cur = byId.get(p.id);
    if (cur) {
      // A project tagged to another dataset can never be moved by this dataset.
      if (cur.datasetId && p.datasetId && cur.datasetId !== p.datasetId) return;
      // A legacy (untagged) payload copy never re-tags an already-tagged project.
      if (cur.datasetId && !p.datasetId) return;
      if (!cur.datasetId && p.datasetId) {
        // Adopt the cached copy (keep the richer of the two) into this dataset.
        const richer = projectSize(p) > projectSize(cur) ? p : cur;
        byId.set(p.id, { ...richer, datasetId: p.datasetId });
        if (nk) nameToId.set(nk, p.id);
        changed = true;
        return;
      }
      // Same scope (both tagged to the same dataset, or both legacy): richer copy wins.
      if (projectSize(p) > projectSize(cur)) {
        byId.set(p.id, p);
        if (nk) nameToId.set(nk, p.id);
        changed = true;
      }
      return;
    }
    // Same name within the SAME dataset, different id (project created on two
    // devices): keep the richer copy at the first occurrence.
    const twinId = nk ? nameToId.get(nk) : null;
    if (twinId && twinId !== p.id) {
      const twin = byId.get(twinId);
      if (twin && projectSize(twin) >= projectSize(p)) return;
      byId.delete(twinId);
      if (nk) nameToId.delete(nk);
    }
    byId.set(p.id, p);
    if (nk) nameToId.set(nk, p.id);
    changed = true;
  };

  payload.forEach((p) => {
    if (!p || typeof p !== 'object' || !p.id) return;
    const pDs = p.datasetId != null ? String(p.datasetId) : null;
    if (!datasetId) {
      // Unscoped (legacy) merge: only untagged payload projects participate.
      if (!pDs) remember(p);
      return;
    }
    if (pDs) {
      // Already tagged: only projects of THIS dataset belong here.
      if (pDs === datasetId) remember(p);
      return;
    }
    // Legacy project (no dataset): decide where it belongs.
    const cached = byId.get(p.id);
    if (cached && String((cached && cached.datasetId) || '') !== '' && String(cached.datasetId) !== datasetId) {
      return; // already claimed by another dataset
    }
    const experiments = Array.isArray(p.experiments) ? p.experiments : [];
    const linkedHere = experiments.some((e) => e && e.testId && testIds.has(e.testId));
    if (linkedHere) {
      // Its linked experiments exist in THIS dataset's tests → it belongs here.
      remember({ ...p, datasetId });
      return;
    }
    // No link found here. If the project has linked experiments at all, leave it
    // untagged for now: the dataset that contains those experiments will claim it
    // when it is opened. Only projects with NO experiment reference use the
    // fallback (adoptAllLegacy = "first dataset opened after the upgrade").
    if (experiments.length === 0 && adoptAllLegacy) remember({ ...p, datasetId });
  });

  if (changed) writeRawProjects(Array.from(byId.values()));
};

/** Normalize a project's authorized-people list to [{ name, permission }].
 *  Legacy entries stored as plain strings had full access → 'modify'.
 *  permission is 'view' (read-only) or 'modify' (can see and edit). */
export const normalizeAuthorized = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((x) => {
    if (typeof x === 'string') return { name: x, permission: 'modify' };
    const perm = x && (x.permission === 'view' || x.permission === 'modify') ? x.permission : 'modify';
    return { name: x && x.name, permission: perm };
  }).filter((x) => x && String(x.name).trim());
};

/** Access level one user has on ONE project: 'modify' (owner, superuser or a
 *  coworker with edit rights), 'view' (read-only coworker) or null (no access
 *  at all). Mirrors what the Projects page (visible list / canManage) and the
 *  project page (canSee / canModify) already do, so every module — the figures
 *  of a project included — answers the same question the same way. */
export const projectAccessFor = (project, userName, isSuper = false) => {
  const name = String(userName || '');
  if (!project || !name.trim()) return null;
  if (isSuper || String(project.scientist || '') === name) return 'modify';
  const coworker = normalizeAuthorized(project.authorizedPeople || [])
    .find((c) => String(c.name) === name);
  if (!coworker) return null;
  return coworker.permission === 'view' ? 'view' : 'modify';
};

/** The projects of `projects` the user may OPEN (owner, any coworker — view or
 *  modify — or a superuser). Used to keep a project's own content (its image
 *  library figures, its saved canvases) visible only to its team. */
export const visibleProjectsFor = (projects, userName, isSuper = false) => {
  const list = Array.isArray(projects) ? projects.filter(Boolean) : [];
  if (isSuper) return list;
  return list.filter((p) => projectAccessFor(p, userName, false) !== null);
};

/** Map of projectName → permission ('view' | 'modify') for the given user,
 *  built from every project's authorizedPeople list. */
export const getProjectAccessForUser = (userName) => {
  const map = {};
  if (!userName) return map;
  try {
    loadProjects().forEach((p) => {
      if (!p || !p.name) return;
      normalizeAuthorized(p.authorizedPeople || []).forEach((a) => {
        if (String(a.name) === String(userName)) map[p.name] = a.permission || 'modify';
      });
    });
  } catch { /* ignore */ }
  return map;
};

/** The access level ('view' | 'modify') a user has on a test because it is
 *  linked to one of the projects they belong to, or null when none applies. */
export const testProjectAccess = (test, userName) => {
  if (!test || !userName) return null;
  const map = getProjectAccessForUser(userName);
  const names = Array.isArray(test.projectNames) ? test.projectNames : [];
  for (const pn of names) {
    if (map[pn]) return map[pn];
  }
  return null;
};

export const loadPublications = () => {
  try {
    const raw = localStorage.getItem('labWorkspace_publications');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore malformed */ }
  return [];
};

/* Test types that can be added to a project's Experiments subsection
   (mirrors the "+ New test" buttons of Experiments). */
export const TEST_TYPE_OPTIONS = [
  { type: 'nmr', label: 'NMR', color: 'bg-emerald-600 hover:bg-emerald-700' },
  { type: 'ssnmr', label: 'ssNMR', color: 'bg-indigo-600 hover:bg-indigo-700' },
  { type: 'nmr-fittings', label: 'NMR Fittings', color: 'bg-amber-600 hover:bg-amber-700' },
  { type: 'dosy', label: 'DOSY', color: 'bg-violet-600 hover:bg-violet-700' },
  { type: 'cd', label: 'CD', color: 'bg-purple-600 hover:bg-purple-700' },
  { type: 'plate-96', label: 'Multiwell Plate', color: 'bg-blue-600 hover:bg-blue-700' },
  { type: 'plate-384', label: 'Multiwell Plate 384', color: 'bg-blue-500 hover:bg-blue-600' },
  { type: 'flow_cytometry', label: 'Flow Cytometry', color: 'bg-pink-600 hover:bg-pink-700' },
  { type: 'cloning', label: 'Cloning', color: 'bg-teal-600 hover:bg-teal-700' },
  { type: 'protein_expression', label: 'Expression & Purification', color: 'bg-cyan-600 hover:bg-cyan-700' },
  { type: 'md_simulation', label: 'MD Simulations', color: 'bg-sky-600 hover:bg-sky-700' },
  { type: 'docking', label: 'Docking', color: 'bg-rose-600 hover:bg-rose-700' }
];

export const testTypeLabel = (type) => {
  const found = TEST_TYPE_OPTIONS.find((o) => o.type === type);
  return found ? found.label : type;
};

const inputCls = 'border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white outline-none focus:border-blue-500 w-full';

/* =====================  LIST VIEW ===================== */
export const ProjectsModule = ({
  currentUser, handlePrint,
  setCurrentModule, setCurrentProjectId, onRestoreProject, tests = []
}) => {
  const isSuper = currentUser?.role === 'superuser';
  const myName = currentUser?.name || '';
  const [projects, setProjects] = useState(loadProjects);
  const [scientistFilter, setScientistFilter] = useState('ALL');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  /* ⚠ UNE ÉCRITURE REFUSÉE SE DIT ICI — ET ELLE N'EST PLUS UN CUL-DE-SAC.
     saveProjectsRescued refait de la place DANS le magasin du navigateur (liens
     Drive, puis pixels, puis listes récupérables du cloud) avant de se résoudre
     à échouer ; l'échec, LUI, s'affiche avec la mesure du magasin. */
  const [storageWarning, setStorageWarning] = useState('');
  const [storageNote, setStorageNote] = useState('');
  /* 🗑 LES PROJETS SUPPRIMÉS DE CE DATASET (levée de tombe) et l'état du geste
     de retour — voir le panneau « Recently deleted » en bas de la liste. */
  const [deleted, setDeleted] = useState(loadDeletedProjectsForDataset);
  const [restoreBusy, setRestoreBusy] = useState('');
  const [restoreNote, setRestoreNote] = useState('');

  useEffect(() => {
    const res = saveProjectsRescued(projects);
    if (!res.ok) {
      setStorageWarning(storageRefusedText(res));
    } else {
      setStorageWarning('');
      if (res.linked || res.droppedImages || res.forgotten) setStorageNote(storageFreedText(res));
      /* ↩ UNE ÉCRITURE QUI AURAIT EFFACÉ DES PROJETS NON SUPPRIMÉS SE DIT.
         Le verrou de `writeRawProjects` les a remis dans le magasin ; l'écran
         l'annonce au lieu de laisser croire que la liste est ce qu'elle aurait
         dû être (et le rapport d'un utilisateur ne dit plus « tout a disparu »
         sans qu'on sache pourquoi). */
      const rescued = takeUntombstonedRescue();
      if (rescued.length) {
        const names = rescued.slice(0, 3).map((p) => p && p.name).filter(Boolean).join(', ');
        setStorageNote(
          `↩ ${rescued.length} project(s) were about to disappear WITHOUT being deleted`
          + `${names ? ` (${names}${rescued.length > 3 ? '…' : ''})` : ''} — they were kept. `
          + 'Deleting a project is the only way to remove one: the store refuses any other loss.'
        );
      }
    }
    /* ⚠ L'ÉTAT SUIT CE QUI A ÉTÉ ÉCRIT. Quand le magasin du navigateur est plein,
       l'écriture est sauvée en allégeant la liste (voir saveProjectsRescued) :
       repartir de la version NON allégée à l'écriture suivante remettrait le
       poids en place et l'écriture échouerait de nouveau, indéfiniment. */
    if (res.scopedChanged) setProjects(res.list);
  }, [projects]);

  /* Les projets SUPPRIMÉS de ce dataset sont relus à chaque mouvement de la
     liste : une suppression vient d'avoir lieu, ou une restauration vient de
     réussir — le panneau « Recently deleted » montre donc toujours l'état réel. */
  useEffect(() => { setDeleted(loadDeletedProjectsForDataset()); }, [projects]);

  /* ↩ LE RETOUR D'UN PROJET SUPPRIMÉ — le geste qui manquait.
     Le travail lourd vit dans App.jsx (`onRestoreProject` : lever la tombe PUIS
     ré-adopter la copie de l'index du Drive) ; ici on l'appelle, on relit la
     liste et on DIT ce qui s'est passé. Un bouton muet serait exactement le
     défaut réparé (« nothing happens »). */
  const restoreProject = async (id) => {
    if (!onRestoreProject) return;
    setRestoreBusy(id);
    setRestoreNote('');
    let res = { lifted: 0, adopted: 0, names: [] };
    try {
      res = (await onRestoreProject(id)) || res;
    } catch (err) {
      res = { lifted: 0, adopted: 0, names: [], error: String((err && err.message) || err) };
    }
    setRestoreBusy('');
    setProjects(loadProjects());
    setDeleted(loadDeletedProjectsForDataset());
    if (res.error) {
      setRestoreNote(`⚠ ${res.error}`);
      return;
    }
    if (!res.lifted) {
      setRestoreNote('ℹ This project was not deleted — nothing to lift (its copy is simply not in this dataset).');
      return;
    }
    setRestoreNote(res.adopted
      ? `✅ “${res.names.join('”, “') || 'the project'}” restored from the Drive index. Its text, references and `
        + 'figures come back with the dataset document when the dataset is reopened (🔄), or by restoring a backup file. '
        + 'If its Drive folder is in the Drive TRASH, restore it there too (right-click → Restore): this gesture reopens '
        + 'the path, but it cannot pull files out of Google’s trash.'
      : '✅ The deletion is lifted (it travels to the other devices). No copy was left in the Drive index: re-run '
        + '“📂 Load HTML” with “Projets” checked — the copy held by that file comes in now that the deletion is '
        + 'lifted — or reopen the dataset (🔄) if its document still carries the project. If its Drive folder is in the '
        + 'Drive TRASH, restore it there too: this gesture reopens the path, it does not empty the trash.');
  };

  const scientists = useMemo(() =>
    [...new Set(projects.map((p) => p.scientist).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  [projects]);

  const visible = useMemo(() => {
    let list = projects;
    if (!isSuper) {
      // The owner and every coworker (view OR modify) can see the project.
      list = list.filter((p) => {
        if (p.scientist === myName) return true;
        return normalizeAuthorized(p.authorizedPeople || []).some((c) => c.name === myName);
      });
    } else if (scientistFilter !== 'ALL') list = list.filter((p) => p.scientist === scientistFilter);
    return list;
  }, [projects, isSuper, myName, scientistFilter]);

  const createProject = () => {
    const name = newName.trim();
    if (!name) {
      /* Un clic qui ne fait RIEN est un cul-de-sac : il se dit. */
      setStorageWarning('⚠ Type the project name first — “Create project” only works once the name box is filled.');
      return;
    }
    /* ⚠ UN PROJET PORTE SON NOM DANS UN DATASET (voir dedupeProjects) : deux
       projets du même nom dans le même dataset sont UN SEUL projet — c'est
       ainsi que deux copies du même projet (un poste et un autre) se
       rejoignent, et c'est le nom qui nomme son dossier sur le Drive. Créer un
       jumeau ne créait donc RIEN DU TOUT : la liste relue ne contenait que
       l'ancien projet, l'id du nouveau n'existait nulle part, la page projet
       affichait « Project not found » et, de retour à la liste, la carte
       n'apparaissait jamais — exactement « le bouton ne crée plus de projet ».
       On OUVRE le projet existant, et on le dit. */
    const twin = projects.find(
      (p) => String((p && p.name) || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (twin) {
      setStorageWarning('');
      setNewName('');
      setShowNewForm(false);
      setCurrentProjectId(twin.id);
      setCurrentModule('project-detail');
      window.alert(`A project called “${twin.name}” already exists in this dataset — it has just been opened.\n\n`
        + 'Two projects of the same dataset cannot carry the same name: the name IS the project — its Drive folder is named '
        + 'after it (rename that one from its own page, or give this project a different name).');
      return;
    }
    const now = new Date().toISOString();
    const prj = {
      id: genProjectId(),
      name,
      scientist: myName,
      // Projects belong to the dataset they are created in.
      datasetId: getActiveProjectDataset() || '',
      createdAt: now,
      updatedAt: now,
      background: '',
      discussion: '',
      conclusions: '',
      experiments: [],
      // Project-level reference documents (Google Drive …/projects/<project>/useful_files).
      usefulFiles: [],
      usefulFilesFolderUrl: '',
      bibliography: [],
      references: [],
      figures: { background: [], discussion: [], conclusions: [] },
      docs: { background: [], discussion: [], conclusions: [] },
      authorizedPeople: [],
      comments: [],
      figureCaptionOverrides: {}
    };
    const nextProjects = [...projects, prj];
    /* L'ÉCRITURE PASSE PAR LE SAUVETAGE ET SE VÉRIFIE (saveProjectsRescued) : le
       projet créé est RELU du magasin, ce qui prouve qu'il y est vraiment. Un
       magasin plein ne peut donc plus faire disparaître un projet neuf — la
       place se fait ici, dans le navigateur. Le verdict est ensuite AFFICHÉ, et
       l'écriture est sous try/catch : même un magasin inaccessible (navigation
       privée) ne laisse pas le clic sans effet. */
    let res;
    try {
      res = saveProjectsRescued(nextProjects, { projectId: prj.id, fields: {} });
    } catch (err) {
      res = {
        ok: false,
        error: String((err && err.message) || err || 'the write failed'),
        linked: 0,
        droppedImages: 0,
        forgotten: 0,
        list: nextProjects,
        scopedChanged: false,
        usage: readLocalStoreUsage()
      };
    }
    if (res.ok) {
      /* L'état suit ce qui a été écrit (allégé s'il a fallu de la place) : comme
         l'effet ci-dessus, sinon l'écriture suivante remettrait le poids en place. */
      setProjects(res.scopedChanged ? res.list : nextProjects);
      setStorageWarning('');
      if (res.linked || res.droppedImages || res.forgotten) setStorageNote(storageFreedText(res));
      setNewName('');
      setShowNewForm(false);
      setCurrentProjectId(prj.id);
      setCurrentModule('project-detail');
      return;
    }
    /* LE MAGASIN N'A PAS GARDÉ LE PROJET : la carte reste à l'écran (elle est
       dans l'état de cette page) mais on NE VA PAS sur une page projet dont les
       données ne sont pas enregistrées — elle afficherait « Project not found »,
       le cul-de-sac signalé. On reste ICI, avec la mesure de ce qui occupe la
       place et la marche à suivre. */
    setProjects(nextProjects);
    setStorageWarning(storageRefusedText(res));
    setNewName('');
    setShowNewForm(false);
  };

  const deleteProject = (id) => {
    const target = projects.find((p) => p.id === id);
    const remaining = projects.filter((p) => p.id !== id);
    /* LA SUPPRESSION EST DÉFINITIVE : on note d'abord la « pierre tombale » du
       projet (localStorage + payload du dataset, voir projectTombstones.js).
       Sans elle, la copie du projet rangée dans le document du dataset était
       ré-adoptée à la réouverture et le projet réapparaissait. */
    recordProjectDeletion(target || { id, datasetId: activeProjectDataset });
    setProjects(remaining);
    saveProjects(remaining);
    setConfirmDelete(null);
    // Mark any Google Drive attachments of this project as deleted.
    if (target) markAttachmentsDeleted(target).catch(() => {});
    /* LE DRIVE EST LE MIROIR DU PROGRAMME : le dossier du projet
       (<dataset>/projects/<projet>, avec ses expériences, ses figures et son
       document) part à la corbeille, et son chemin est mis en pierre tombale —
       il ne se recrée donc pas et ne réapparaît pas sur les autres postes. */
    if (target) {
      mirrorDeleteProject({
        datasetId: target.datasetId || activeProjectDataset || '',
        datasetName: getDriveRootName(),
        projectName: target.name || ''
      }).catch(() => null);
    }
  };

  // Edit access: owner, superuser, or a coworker with 'modify' permission.
  const canManage = (p) => isSuper || p.scientist === myName
    || normalizeAuthorized(p.authorizedPeople || []).some((c) => c.name === myName && c.permission === 'modify');
  // Deleting a project stays reserved for the owner / superuser.
  const canDelete = (p) => isSuper || p.scientist === myName;

  return (
    <div className="p-4 md:p-6 h-full overflow-y-auto custom-scrollbar bg-slate-50">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-2 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-lg md:text-xl font-black text-slate-800">📁 Projects</h2>
            <p className="text-xs text-slate-500">
              Scientific projects collecting background, linked experiments, results and discussion, conclusions and bibliography.
              Each project is a page whose text sections accept bibliographic references from the
              “Project bibliography” and “Publications of the scientist”.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 no-print">
            <button onClick={handlePrint}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors shadow-sm">
              🖨️ PDF
            </button>
            {currentUser && (
              <button onClick={() => setShowNewForm((v) => !v)}
                      className={`font-bold py-1.5 px-3 rounded text-xs transition-colors ${showNewForm ? 'bg-slate-200 text-slate-700' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                {showNewForm ? 'Cancel' : '+ New Project'}
              </button>
            )}
          </div>
        </div>

        {/* Écriture REFUSÉE par le navigateur : la mesure de ce qui occupe la
            place, puis la marche à suivre (localStoreRoom.storageRefusedText).
            Un échec définitif n'est jamais silencieux. */}
        {storageWarning && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
            {storageWarning}
          </div>
        )}

        {/* Écriture SAUVÉE : de la place a été faite dans le magasin du
            navigateur — on le dit, et on dit ce que cela a coûté. */}
        {storageNote && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
            <span className="flex-1">
              <b>🧹 Saved — room had to be made in this browser’s store.</b> {storageNote}
            </span>
            <button type="button" onClick={() => setStorageNote('')}
                    className="shrink-0 font-bold text-amber-700 hover:text-amber-900"
                    title="Hide this note — the change is saved either way.">✕</button>
          </div>
        )}



        {!currentUser && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-3 text-sm font-semibold">
            ⚠️ Log in to create and manage projects. Each scientist sees only their own projects.
          </div>
        )}

        {showNewForm && (
          <div className="bg-white border border-blue-200 rounded-xl shadow-sm p-4">
            <label className="text-xs font-bold text-slate-600 mb-1.5 block">Project name *</label>
            <div className="flex flex-col md:flex-row gap-2">
              <input className={inputCls} value={newName}
                     onChange={(e) => setNewName(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter') createProject(); }}
                     placeholder="e.g. Structure and dynamics of SAAP-148 in lipid bilayers" />
              <button onClick={createProject} disabled={!newName.trim()}
                      className="px-4 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                Create project
              </button>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              👤 Owner: <strong>{myName || '—'}</strong> — the project and its “Project bibliography” are visible to you
              {isSuper ? ' and, as a superuser, to everyone (with scientist filter).' : ' only (superusers see everything).'}
            </div>
          </div>
        )}

        {isSuper && (
          <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2.5 no-print">
            <label className="text-xs font-bold text-slate-600">Filter by scientist:</label>
            <select value={scientistFilter} onChange={(e) => setScientistFilter(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white outline-none focus:border-blue-500 font-semibold text-slate-700">
              <option value="ALL">All scientists ({projects.length})</option>
              {scientists.map((s) => (
                <option key={s} value={s}>
                  {s} ({projects.filter((p) => p.scientist === s).length})
                </option>
              ))}
            </select>
          </div>
        )}

        {!isSuper && currentUser && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            🧪 Showing your projects — <strong>{myName}</strong>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center text-sm text-slate-400 italic">
            No projects yet{isSuper ? '' : ' for you'} — use “+ New Project” to create the first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800 leading-snug">{p.name}</div>
                    <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                      📅 {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                    👤 {p.scientist || 'Unassigned'}
                  </span>
                  {(() => {
                    const cws = normalizeAuthorized(p.authorizedPeople || []);
                    return cws.length > 0 ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5" title={cws.map((c) => `${c.name} (${c.permission === 'modify' ? 'modify' : 'view'})`).join(', ')}>
                        👥 {cws.length}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                  {/* 🧪 LE COMPTE NE PEUT PLUS DIRE « 0 » QUAND L'EXPÉRIENCE DIT
                      APPARTENIR AU PROJET. `countExperimentsOfProject` compte
                      l'UNION des deux moitiés du lien : les entrées de
                      `project.experiments[]` **∪** les expériences dont
                      `projectNames` nomme ce projet, groupées par NOM de test
                      (une expérience = un test avec ses instances) — la même
                      règle que la page du projet. Le défaut rapporté était
                      exactement cet écart : la création d'une expérience
                      n'écrivait que `projectNames`, et cette carte lisait
                      `experiments.length` = 0. Voir
                      `utils/experimentRules.reconcileExperimentLinks`, qui
                      répare la liste, et App.jsx, qui la relance. */}
                  <span className="bg-slate-100 rounded-full px-2 py-0.5"
                        title="Experiments of this project (its own list, plus the experiments that name this project — grouped by experiment name)">
                    🧪 {countExperimentsOfProject(p, tests)} experiments
                  </span>
                  <span className="bg-slate-100 rounded-full px-2 py-0.5">📚 {(p.references || []).length} references</span>
                  {(() => {
                    const open = (p.comments || []).filter((c) => !c.resolved).length;
                    return open > 0 ? (
                      <span className="bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">💬 {open} open</span>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-1.5 mt-auto pt-1 no-print">
                  <button onClick={() => { setCurrentProjectId(p.id); setCurrentModule('project-detail'); }}
                          className="flex-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                    Open project
                  </button>
                  {canManage(p) && (
                    <button onClick={() => { setCurrentProjectId(p.id); setCurrentModule('project-detail'); }}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                            title="Edit">✏️</button>
                  )}
                  {canDelete(p) && (
                    <button onClick={() => setConfirmDelete(p.id)}
                            className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-red-50 text-red-500 hover:bg-red-100"
                            title="Delete project">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 🗑 LES PROJETS SUPPRIMÉS DE CE DATASET — LE CHEMIN DE RETOUR.
            Jusqu'ici une suppression était DÉFINITIVE : le projet ne revenait ni
            par « Load HTML » (la tombe écartait sa copie, en silence), ni par
            l'index du Drive, ni par le document du dataset. Le rapport : « there
            was a project called “tmp” with figures and text. It looks gone. If I
            reload from HTML and select only to restore projects, nothing
            happens. » Le geste manquait : il est ici. */}
        {currentUser && deleted.length > 0 && (
          <div className="bg-white border border-amber-300 rounded-xl shadow-sm p-4 no-print">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-xs font-black text-slate-800">
                🗑 Recently deleted ({deleted.length})
              </div>
              <div className="text-[10px] font-semibold text-slate-400 max-w-xl">
                Restoring lifts the deletion: the project comes back from the dataset document and from the
                Drive index, on every device. Nothing else is touched.
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {deleted.map((t) => (
                <div key={`${t.datasetId}::${t.id}`}
                     className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-700 truncate">{t.id}</div>
                    <div className="text-[10px] text-slate-500 font-semibold">
                      deleted {t.deletedAt ? new Date(t.deletedAt).toLocaleString() : '(date unknown)'}
                      {t.datasetId && t.datasetId !== (getActiveProjectDataset() || '') ? ' · belongs to another dataset' : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => restoreProject(t.id)} disabled={restoreBusy === t.id}
                          className="shrink-0 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          title="Bring this deleted project back (lift the deletion).">
                    {restoreBusy === t.id ? '…' : '↩ Restore'}
                  </button>
                </div>
              ))}
            </div>
            {restoreNote && (
              <div className="mt-2 text-[11px] font-semibold text-slate-600">{restoreNote}</div>
            )}
          </div>
        )}

        {confirmDelete && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full">
              <h3 className="text-sm font-black text-slate-800 mb-1">Delete project?</h3>
              <p className="text-xs text-slate-500 mb-4">
                “{projects.find((p) => p.id === confirmDelete)?.name}” and its bibliography will be permanently removed.
                Linked tests are kept.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(null)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">Cancel</button>
                <button onClick={() => deleteProject(confirmDelete)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

