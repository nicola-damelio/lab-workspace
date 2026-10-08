/* =========================================================================
   src/utils/workspaceResync.js
   « ☁ RESYNC FROM DRIVE » — L'INVENTAIRE DU DRIVE, EN LECTURE SEULE.

   Le défaut réparé : des datasets et des projets que le Drive porte TOUJOURS
   n'apparaissaient plus dans le programme — la liste affichée venait du
   navigateur et de Firestore, et l'index du Drive (`_workspace/state.json`)
   n'était relu qu'au démarrage. Rien ne répondait à la question « qu'y a-t-il
   réellement sur le Drive, et qu'est-ce qui manque ici ? », et rien ne pouvait
   RESTAURER ce qui avait été perdu localement.

   Ce module fait LA LECTURE — ni écriture, ni déplacement, ni création :
     • il énumère TOUT (toutes les pages de `/drive/v3/files`, pas seulement les
       1000 premiers éléments d'un dossier) ;
     • il confronte ce que le Drive porte à ce que ce poste connaît (liste du
       navigateur, `_workspace/state.json`, registre du miroir `labDriveMirror`)
       — un dossier est reconnu par son IDENTIFIANT quand le registre le
       connaît, et seulement sinon par son nom ;
     • il DIT ce qui est incomplet ou mal rangé (dossier de projet hors de
       `projects/`, doublons, conteneur égaré, index absent, dataset sans
       dossier…) SANS RIEN DÉPLACER : la réparation est un geste explicite, ce
       module n'en prend aucun ;
     • il rend la liste des CONTENUS à récupérer (`recoverable.copyIds`) — les
       copies `_workspace/datasets/ds_<id>.json` qui existent VRAIMENT sur le
       Drive — pour que l'appelant les adopte par les chemins normaux
       (`readDatasetCopy` → `mergeProjectsFromCloud`), jamais par un chemin
       parallèle.

   Vérifié hors navigateur par _workspace_resync_test.mjs (faux Drive complet :
   pagination, datasets, projets, jumeaux, dossiers égarés).
   ========================================================================= */

import { sanitizeSlug, datasetFolderSlug } from './driveNaming';
import { isCanonicalDatasetDir } from './datasetDirTwins';
import {
  WORKSPACE_DIR, WORKSPACE_STATE_FILE, workspaceDatasetFileName, parseWorkspaceState
} from './workspaceDrive';
import {
  normalizeDriveMirror, readDriveMirror, deletedDatasetMirrorIds
} from './driveMirrorStore';
import {
  cloudBackendAvailable, findLabWorkspaceFolder, listDriveChildren, downloadDriveFileText
} from './driveUpload';

/* Les conteneurs d'un dataset que le programme connaît : les canoniques
   (projects, backups, protocols, storage, publications,
   general_library_images — voir driveNaming.DATASET_FOLDER_DIRS) PLUS le
   conteneur d'une base d'administration, qui n'en fait pas partie (le budget
   vit dans Budget_labo/<année>/…). Sans cette liste, l'inventaire signalerait
   « dossier inconnu » sur un rangement parfaitement normal. */
export const ADMIN_DATASET_DIRS = ['Budget_labo'];

/* ── CE QUE L'INVENTAIRE PEUT SIGNALER ───────────────────────────────────────
   Chaque constat porte un identifiant stable (les tests et l'interface s'y
   accrochent) et une phrase lisible : un inventaire muet ne sert à rien. */
export const RESYNC_ISSUES = {
  NO_WORKSPACE: 'no-workspace-folder',
  TWIN_WORKSPACE: 'twin-workspace-folder',
  MISSING_STATE: 'missing-workspace-index',
  STATE_UNREADABLE: 'workspace-index-unreadable',
  STRAY_ROOT_CONTAINER: 'dataset-container-at-workspace-root',
  LEGACY_ROOT_CONTAINER: 'legacy-container-at-workspace-root',
  STRAY_PROJECT_AT_ROOT: 'project-folder-outside-projects',
  PROJECT_TWIN: 'project-folder-in-two-places',
  UNKNOWN_PROJECT_FOLDER: 'project-folder-without-record',
  PROJECT_FOLDER_MISSING: 'project-without-folder',
  DATASET_FOLDER_WITHOUT_RECORD: 'dataset-folder-without-record',
  DATASET_FOLDER_MISSING: 'dataset-without-folder',
  DATASET_FOLDER_EMPTY: 'dataset-folder-empty',
  DATASET_FOLDER_INSIDE_DATASET: 'dataset-folder-inside-a-dataset',
  DATASET_TWIN: 'two-folders-for-one-dataset',
  DATASET_FOLDER_RENAMED: 'dataset-folder-name-differs',
  MISPLACED_WORKSPACE: 'workspace-folder-inside-a-dataset',
  UNKNOWN_FOLDER_IN_DATASET: 'unknown-folder-inside-a-dataset',
  UNKNOWN_FOLDER_AT_ROOT: 'unknown-folder-at-workspace-root',
  UNREADABLE_FOLDER: 'folder-could-not-be-listed'
};

/* ── Petits utilitaires purs ────────────────────────────────────────────────── */
const asList = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const slugOf = (name) => sanitizeSlug(text(name));
const isFolder = (f) => !!(f && f.id) && text(f.mimeType) === 'application/vnd.google-apps.folder';
const foldersOf = (list) => asList(list).filter(isFolder);
const filesOf = (list) => asList(list).filter((f) => f && f.id && !isFolder(f));
const safeCall = async (fn, fallback = null) => {
  try { return await fn(); } catch { return fallback; }
};
/** Un dossier de conteneur connu (canonique ou d'administration) ? */
const isDatasetContainerName = (name) => isCanonicalDatasetDir(name)
  || ADMIN_DATASET_DIRS.map(slugOf).includes(slugOf(name));

/* ── L'ADAPTATEUR RÉEL (Google Drive) ────────────────────────────────────────
   Injecté dans les tests : le module ne connaît QUE ces quatre gestes, tous en
   lecture. `findWorkspaceFolder` CHERCHE (« Lab Workspace ») sans jamais le
   créer — une resynchronisation ne doit pas fabriquer de dossier vide. */
export const defaultDriveResyncAdapter = () => ({
  available: () => cloudBackendAvailable(),
  findWorkspaceFolder: () => findLabWorkspaceFolder(),
  listChildren: (id) => listDriveChildren(id),
  downloadText: (id) => downloadDriveFileText(id)
});

/** Toutes les entrées d'un dossier — `listDriveChildren` suit déjà
 *  `nextPageToken` (voir driveUpload.MAX_DRIVE_LIST_PAGES). Un dossier qui
 *  refuse de se laisser lire est CONSIGNÉ (`failures`) : un inventaire qui
 *  tairait une panne dirait « tout va bien » sur un dossier qu'il n'a pas vu. */
const listAll = async (drive, folderId, failures = null) => {
  try {
    return asList(await drive.listChildren(folderId));
  } catch (err) {
    if (failures) failures.push({ folderId: text(folderId), error: text(err && err.message) || 'unreadable' });
    return [];
  }
};

/** Le rapport vide d'un Drive injoignable — `reason` en dit la cause exacte. */
export const emptyResyncReport = ({ at = new Date().toISOString(), reason = '' } = {}) => ({
  ok: false,
  reason,
  at,
  workspaceFolderId: '',
  index: { savedAt: '', datasets: [], projects: [], deletedProjects: [], revivedProjects: [] },
  datasets: [],
  issues: [],
  counts: {
    workspaceFolders: 0,
    datasetFolders: 0,
    datasetsOnDrive: 0,
    datasetsWithoutRecord: 0,
    datasetsWithoutFolder: 0,
    datasetsListedHere: 0,
    datasetsListedInIndex: 0,
    projectsListedHere: 0,
    projectsListedInIndex: 0,
    projectFoldersOnDrive: 0,
    projectFoldersAtDatasetRoot: 0,
    projectFoldersUnknown: 0,
    copiesOnDrive: 0,
    copiesToFetch: 0,
    foldersUnreadable: 0,
    issues: 0
  },
  recoverable: {
    copyIds: [], missingCopyIds: [], datasetsInIndex: 0, projectsInIndex: 0,
    projectsListedHere: 0, datasetsListedHere: 0
  },
  text: ''
});

/** Les datasets connus, fusionnés par identifiant — `lists` est une liste de
 *  listes (liste du navigateur, index du Drive, …). La DERNIÈRE liste a le
 *  dernier mot pour un champ non vide : l'index du Drive est donné en dernier,
 *  donc c'est lui qui décrit quand ce poste a une vue périmée (un dataset
 *  renommé ailleurs). PUR. */
export const collectResyncCandidates = (lists = []) => {
  const out = new Map();
  asList(lists).forEach((list) => asList(list).forEach((d) => {
    const id = text(d && d.id);
    if (!id) return;
    const prev = out.get(id) || { id, title: '', driveFolder: '' };
    out.set(id, {
      id,
      title: text(d && d.title) || prev.title,
      driveFolder: text(d && d.driveFolder) || prev.driveFolder
    });
  }));
  return Array.from(out.values());
};

/** Les projets connus d'UN dataset : par identifiant de dataset quand on le
 *  connaît, par nom de dossier sinon (les projets créés avant le découpage par
 *  dataset n'ont pas de `datasetId` — ils ne doivent être attribués qu'au
 *  dataset dont le NOM correspond, jamais à tous). PUR. */
export const projectRecordsOf = (lists = [], { datasetId = '', datasetSlug = '' } = {}) => {
  const scopeId = text(datasetId);
  const out = new Map();
  asList(lists).forEach((list) => asList(list).forEach((p) => {
    const id = text(p && p.id);
    if (!id) return;
    const dsId = text(p && p.datasetId);
    const dsName = text(p && (p.datasetName || p.datasetTitle || p.datasetFolder));
    const scoped = scopeId
      ? (dsId === scopeId || (!dsId && !!datasetSlug && slugOf(dsName) === datasetSlug) || (!dsId && !dsName))
      /* Sans identifiant de dataset (dossier sans fiche), seules les fiches NON
         rattachées peuvent être attribuées — et par leur NOM quand elles en ont
         un. Une fiche qui porte l'identifiant d'un AUTRE dataset n'a rien à
         faire dans ce dossier-là : l'y compter ferait apparaître des projets
         « sans dossier » qui ont le leur ailleurs. */
      : (!dsId && (!dsName || slugOf(dsName) === datasetSlug));
    if (!scoped) return;
    const prev = out.get(id) || { id, name: '', datasetId: dsId };
    out.set(id, { id, name: text(p && p.name) || prev.name, datasetId: dsId || prev.datasetId });
  }));
  return Array.from(out.values());
};

/** La cause d'un rapport vide, en clair. PUR. */
export const resyncReasonText = (reason) => ({
  'no-adapter': 'no Drive reader is available here',
  'drive-offline': 'Google Drive is not connected',
  'no-workspace-folder': `no "${WORKSPACE_DIR}" folder was found on the Drive (none was created)`
}[text(reason)] || text(reason) || 'unknown reason');

/** Les phrases de l'inventaire — l'interface les affiche telles quelles. PUR. */
export const resyncReportLines = (report) => {
  const r = report && typeof report === 'object' ? report : emptyResyncReport();
  const c = r.counts || {};
  const lines = [];
  if (!r.ok) {
    lines.push(`· Drive inventory unavailable: ${resyncReasonText(r.reason)}.`);
    return lines;
  }
  lines.push(`· Drive: ${c.datasetFolders || 0} dataset folder(s), ${c.projectFoldersOnDrive || 0} project folder(s); `
    + `the index ${WORKSPACE_STATE_FILE} lists ${c.datasetsListedInIndex || 0} dataset(s) and ${c.projectsListedInIndex || 0} project(s).`);
  lines.push(`· This PC knows ${c.datasetsListedHere || 0} dataset(s) and ${c.projectsListedHere || 0} project(s)`
    + (c.datasetsListedHere >= c.datasetsListedInIndex && c.projectsListedHere >= c.projectsListedInIndex
      ? ' — at least as many as the Drive index.' : ' — FEWER than the Drive index: the list above is the one to trust.'));
  if (r.recoverable && r.recoverable.copyIds && r.recoverable.copyIds.length) {
    lines.push(`· ${r.recoverable.copyIds.length} dataset copy(ies) on the Drive can restore the missing content.`);
  }
  if (c.foldersUnreadable) {
    lines.push(`· ${c.foldersUnreadable} folder(s) could not be listed: this inventory is INCOMPLETE.`);
  }
  asList(r.issues).forEach((i) => lines.push(`⚠ ${text(i && i.text)}`));
  if (!asList(r.issues).length) lines.push('· No misplaced or incomplete folder found (nothing was moved).');
  return lines;
};

/* ── LE TEXTE DU COMPTE-RENDU DE LA REPRISE ──────────────────────────────────
   `resyncReportLines` dit l'état du Drive ; ce qui suit dit ce qui a été REMIS
   dans ce navigateur — les deux sont lus par le panneau « Resync from Drive »
   (src/components/WorkspaceResyncPanel.jsx), et les deux sont PURS : c'est ce
   qui permet de vérifier à l'écran sans navigateur (_workspace_resync_ui_test.mjs).
   Aucune phrase n'est fabriquée par le composant : le composant peint. */

/** Le goût d'une ligne du rapport : `⚠` = un défaut trouvé (peint en ambre),
 *  `·` = un constat (en gris). PUR. */
export const resyncLineTone = (line) => (String(line == null ? '' : line).trim().startsWith('⚠') ? 'warn' : 'note');

/** Les chiffres d'un compte-rendu, prêts à écrire — jamais de `undefined` à
 *  l'écran et jamais de soustraction négative (une adoption ne rend pas de
 *  projets « en moins »). PUR. */
export const resyncSummaryText = (summary) => {
  const s = summary && typeof summary === 'object' ? summary : {};
  const before = Number(s.projectsBefore || 0);
  const after = Number(s.projectsAfter || 0);
  const restored = after > before ? after - before : 0;
  const copies = Number(s.copiesAdopted || 0);
  const failed = Array.isArray(s.copiesFailed) ? s.copiesFailed.filter(Boolean).map(String) : [];
  return {
    restored,
    headline: s.error
      ? 'The Drive could not be read.'
      : (s.ok
        ? 'The Drive was read and this browser was brought back in line with it.'
        : 'The Drive inventory is unavailable — nothing was read.'),
    projects: restored
      ? `${restored} project(s) restored in this browser (${before} known before, ${after} now).`
      : `No project was missing here (${after} known).`,
    index: Number(s.projectsInIndex || 0)
      ? `The workspace index lists ${Number(s.projectsInIndex)} project(s); everything it lists is now here too.`
      : 'The workspace index lists no project.',
    copies: copies ? `${copies} dataset copy(ies) were re-read from the Drive.` : '',
    failed: failed.length
      ? `${failed.length} copy(ies) could not be read: ${failed.join(', ')} (the dataset folders themselves are still on the Drive).`
      : '',
    stateAdopted: !!s.stateAdopted,
    lines: Array.isArray(s.lines) ? s.lines.filter(Boolean).map(String) : []
  };
};

/* ── L'INVENTAIRE ────────────────────────────────────────────────────────────
   `known` = ce que CE poste affiche (`{ datasets, projects }` — la liste du
   navigateur) ; `mirror` = le registre `labDriveMirror` (injectable) ;
   `adapter` = le Drive (injectable). Rien n'est écrit, rien n'est déplacé :
   le rapport dit, l'appelant décide. */
export const sweepWorkspaceDrive = async ({
  adapter = null, known = {}, mirror = null, maxCopies = 25
} = {}) => {
  const at = new Date().toISOString();
  const drive = adapter || defaultDriveResyncAdapter();
  if (!drive || typeof drive.listChildren !== 'function' || typeof drive.findWorkspaceFolder !== 'function') {
    return emptyResyncReport({ at, reason: 'no-adapter' });
  }
  if (typeof drive.available === 'function' && !(await safeCall(() => drive.available(), false))) {
    return emptyResyncReport({ at, reason: 'drive-offline' });
  }
  const workspaceFolderId = text(await safeCall(() => drive.findWorkspaceFolder(), ''));
  if (!workspaceFolderId) return emptyResyncReport({ at, reason: 'no-workspace-folder' });

  const issues = [];
  /* Le constat se garde court : au-delà, l'interface cesse d'être lisible. Le
     compte total reste dans `counts.issues`, la phrase le dit. */
  const MAX_ISSUES = 40;
  const add = (kind, detail = {}) => {
    if (issues.length < MAX_ISSUES) issues.push({ kind, ...detail });
    else if (issues.length === MAX_ISSUES) {
      issues.push({ kind: 'more-issues', text: '…more findings were not listed (the counts are complete).' });
    }
    return detail;
  };
  const listFailures = [];
  const rootFolders = foldersOf(await listAll(drive, workspaceFolderId, listFailures));

  /* ── `_workspace` : l'index (`state.json`) ET les copies de contenu ─────── */
  /* ⚠ COMPARAISON DE SLUGS DES DEUX CÔTÉS : `sanitizeSlug('_workspace')` vaut
     `workspace` (il rogne les soulignés de tête et de queue), donc comparer au
     nom littéral `_workspace` ne trouverait JAMAIS le dossier — l'inventaire
     croirait le Drive vide et chercherait un index qui est sous ses yeux. */
  const wsDirSlug = slugOf(WORKSPACE_DIR);
  const workspaces = rootFolders.filter((f) => slugOf(f.name) === wsDirSlug);
  const wsChildren = new Map();
  for (const w of workspaces) wsChildren.set(text(w.id), await listAll(drive, w.id, listFailures));
  const ws = workspaces.find((w) => asList(wsChildren.get(text(w.id))).some((f) => text(f.name) === WORKSPACE_STATE_FILE))
    || workspaces[0] || null;
  const wsKids = ws ? asList(wsChildren.get(text(ws.id))) : [];
  if (workspaces.length > 1) {
    add(RESYNC_ISSUES.TWIN_WORKSPACE, {
      folderIds: workspaces.map((w) => text(w.id)),
      text: `${workspaces.length} "${WORKSPACE_DIR}" folders exist on the Drive; only ${text(ws && ws.id)} is read (it holds ${WORKSPACE_STATE_FILE}). Nothing was moved.`
    });
  }

  const stateFile = wsKids.find((f) => text(f.name) === WORKSPACE_STATE_FILE) || null;
  let state = null;
  if (!stateFile) {
    add(RESYNC_ISSUES.MISSING_STATE, {
      text: `No "${WORKSPACE_DIR}/${WORKSPACE_STATE_FILE}" on the Drive: the index that lists datasets and projects is missing. The dataset folders below are still counted, and this PC knows what it knows.`
    });
  } else {
    const raw = await safeCall(() => drive.downloadText(text(stateFile.id)), '');
    state = parseWorkspaceState(raw);
    if (!state) {
      add(RESYNC_ISSUES.STATE_UNREADABLE, {
        fileId: text(stateFile.id),
        text: `"${WORKSPACE_DIR}/${WORKSPACE_STATE_FILE}" could not be read (empty or invalid JSON); the folders themselves are still counted.`
      });
    }
  }
  const indexDatasets = state ? asList(state.datasets) : [];
  const indexProjects = state ? asList(state.projects) : [];
  const indexDeletedProjects = state ? asList(state.deletedProjects) : [];

  const copiesDir = foldersOf(wsKids).find((f) => slugOf(f.name) === 'datasets') || null;
  const copyFiles = copiesDir ? filesOf(await listAll(drive, copiesDir.id, listFailures)) : [];
  const copyNames = new Set(copyFiles.map((f) => text(f.name)));

  /* ── Les repères : registre du miroir (par IDENTIFIANT Drive), listes ───── */
  const mirrorState = normalizeDriveMirror(
    mirror || await safeCall(() => readDriveMirror(), null)
  );
  const mirrorDeletedIds = deletedDatasetMirrorIds(mirrorState);
  const mirrorDatasetByFolderId = new Map();
  Object.entries(mirrorState.datasets || {}).forEach(([key, val]) => {
    const folderId = text(val && val.folderId);
    if (folderId) {
      mirrorDatasetByFolderId.set(folderId, {
        key, folderId, name: text(val && val.name), id: text(key).startsWith('id:') ? text(key).slice(3) : ''
      });
    }
  });
  const mirrorProjectByFolderId = new Map();
  Object.entries(mirrorState.projects || {}).forEach(([key, val]) => {
    const folderId = text(val && val.folderId);
    if (!folderId) return;
    mirrorProjectByFolderId.set(folderId, {
      key, folderId, name: text(val && val.name), datasetKey: text(key).split('::')[0]
    });
  });

  const localDatasets = asList(known.datasets);
  const localProjects = asList(known.projects);
  const localDatasetIds = new Set(localDatasets.map((d) => text(d && d.id)).filter(Boolean));
  const indexDatasetIds = new Set(indexDatasets.map((d) => text(d && d.id)).filter(Boolean));
  const candidates = collectResyncCandidates([localDatasets, indexDatasets]);
  const candidateBySlug = new Map();
  candidates.forEach((c) => {
    /* `driveFolder` porte un IDENTIFIANT de dossier dans l'index ; on l'accepte
       aussi comme nom parce qu'un état HISTORIQUE peut y avoir écrit un nom.
       Le titre est la piste normale, l'autre ne coûte rien. */
    [datasetFolderSlug(c.title), slugOf(c.driveFolder)].filter(Boolean).forEach((s) => {
      if (!candidateBySlug.has(s)) candidateBySlug.set(s, c);
    });
  });

  /* Les projets connus d'un dataset : la liste de ce poste et celle de l'index
     du Drive, fusionnées par identifiant. */
  const recordsOfDataset = (datasetId, datasetSlug) => projectRecordsOf(
    [localProjects, indexProjects], { datasetId, datasetSlug }
  );

  /* ── La racine de l'espace de travail ───────────────────────────────────── */
  const knownDeletedIds = new Set(
    asList(known.deletedDatasetIds).map((v) => text(v && v.id) || text(v)).filter(Boolean)
  );
  const datasetFolders = [];
  const unclaimedRoots = [];
  const reports = [];
  const copyIds = [];
  const missingCopyIds = [];
  /* Les dossiers de projet vus, par dataset : deux dossiers jumeaux portent la
     MÊME fiche, donc la comparaison aux fiches se fait sur la réunion des deux
     (voir plus bas), jamais dossier par dossier. */
  const placesById = new Map();
  let projectFolderCount = 0;
  let workspaceRootStrays = 0;
  let unknownProjectFolders = 0;
  let datasetsWithoutFolder = 0;
  /** La fiche d'un dossier de dataset que RIEN ne décrit : sans elle, il
   *  n'apparaîtrait ni dans l'index ni à l'écran — des projets vivraient
   *  encore là que personne ne verrait. */
  const reportDatasetWithoutRecord = (entryName, entrySlug, entryFolderId) => reports.push({
    id: '',
    folderId: entryFolderId,
    folderName: entryName,
    slug: entrySlug,
    listedLocally: false,
    listedInIndex: false,
    deleted: false,
    copiesHere: false,
    needsContent: false,
    projectsAtRoot: 0,
    projects: []
  });

  rootFolders.forEach((f) => {
    const name = text(f.name);
    const slug = slugOf(name);
    const folderId = text(f.id);
    if (!slug || slug === wsDirSlug) return;
    if (isDatasetContainerName(name)) {
      add(slug === 'backups' ? RESYNC_ISSUES.LEGACY_ROOT_CONTAINER : RESYNC_ISSUES.STRAY_ROOT_CONTAINER, {
        container: name,
        folderId,
        text: `"${name}" is a dataset container sitting at the ROOT of the workspace instead of inside a dataset folder. It was NOT moved.`
      });
      return;
    }
    const asMirrorProject = mirrorProjectByFolderId.get(folderId) || null;
    if (asMirrorProject) {
      workspaceRootStrays += 1;
      add(RESYNC_ISSUES.STRAY_PROJECT_AT_ROOT, {
        scope: 'workspace-root',
        folderId,
        folder: name,
        projectName: text(asMirrorProject.name),
        text: `The project "${text(asMirrorProject.name)}" has its folder at the ROOT of the workspace ("${name}") instead of inside "<dataset>/projects/". It was NOT moved.`
      });
      return;
    }
    const mirrorEntry = mirrorDatasetByFolderId.get(folderId) || null;
    const candidate = candidateBySlug.get(slug)
      || (mirrorEntry && mirrorEntry.id ? candidates.find((c) => c.id === mirrorEntry.id) : null)
      || null;
    if (candidate || mirrorEntry) {
      datasetFolders.push({ folder: f, name, slug, folderId, candidate, mirrorEntry });
      return;
    }
    /* Ni dataset, ni projet, ni conteneur connu : on ne le déclare PAS inconnu
       avant d'avoir regardé dedans (voir plus bas). Un dossier qui porte un
       conteneur canonique EST un dossier de dataset dont la fiche s'est perdue
       — et c'est justement ce que l'inventaire doit trouver. */
    unclaimedRoots.push({ folderId, name, slug });
  });

  /* ── Chaque dossier de dataset, vu du Drive ─────────────────────────────── */
  for (const entry of datasetFolders) {
    const { folder, name, slug, folderId, candidate, mirrorEntry } = entry;
    const id = text(candidate && candidate.id) || text(mirrorEntry && mirrorEntry.id) || '';
    const children = await listAll(drive, folder.id, listFailures);
    const childFolders = foldersOf(children);
    const projectsContainer = childFolders.find((f) => slugOf(f.name) === 'projects') || null;
    const records = recordsOfDataset(id, slug);
    const listedLocally = !!id && localDatasetIds.has(id);
    const listedInIndex = !!id && indexDatasetIds.has(id);
    const deleted = !!id && (knownDeletedIds.has(id) || mirrorDeletedIds.has(id));
    const copiesHere = !!id && copyNames.has(workspaceDatasetFileName(id));

    /** Où vit un dossier de projet, et à quel projet il correspond : par le nom
     *  d'abord, puis par l'identifiant Drive du registre (`labDriveMirror`).
     *  L'identifiant résiste au renommage, le nom résiste au registre perdu. */
    const placeOf = (f, container) => {
      const pid = text(f.id);
      const pslug = slugOf(f.name);
      const mir = mirrorProjectByFolderId.get(pid) || null;
      const known = records.find((p) => slugOf(p.name) === pslug)
        || (mir ? records.find((p) => slugOf(p.name) === slugOf(mir.name)) : null)
        || null;
      return {
        container,
        folderId: pid,
        folderName: text(f.name),
        slug: pslug,
        projectId: text(known && known.id),
        projectName: text(known && known.name) || text(mir && mir.name) || text(f.name),
        fromMirror: !!mir
      };
    };

    const places = [];
    if (projectsContainer) {
      foldersOf(await listAll(drive, projectsContainer.id, listFailures)).forEach((f) => places.push(placeOf(f, 'projects')));
    }

    /* Les dossiers du dataset qui ne sont ni un conteneur connu ni un dossier de
       projet à sa place : c'est ICI que se voit le défaut rapporté (« un dossier
       de projet créé à la racine du dataset au lieu de projects/ »). Rien n'est
       déplacé : le constat est écrit, la comparaison reste à faire. */
    childFolders.forEach((f) => {
      const cname = text(f.name);
      const cslug = slugOf(cname);
      const cid = text(f.id);
      if (cslug === 'projects' || isDatasetContainerName(cname)) return;
      if (cslug === wsDirSlug) {
        add(RESYNC_ISSUES.MISPLACED_WORKSPACE, {
          datasetId: id,
          datasetFolder: name,
          folderId: cid,
          text: `A "${WORKSPACE_DIR}" folder sits INSIDE the dataset "${name}". It was NOT moved.`
        });
        return;
      }
      if (candidateBySlug.get(cslug)) {
        add(RESYNC_ISSUES.DATASET_FOLDER_INSIDE_DATASET, {
          datasetId: id,
          datasetFolder: name,
          folder: cname,
          folderId: cid,
          text: `"${cname}" (which looks like a dataset of its own) sits INSIDE the dataset "${name}". It was NOT moved.`
        });
        return;
      }
      const place = placeOf(f, 'root');
      if (place.projectId || place.fromMirror) {
        places.push(place);
        add(RESYNC_ISSUES.STRAY_PROJECT_AT_ROOT, {
          scope: 'dataset-root',
          datasetId: id,
          datasetFolder: name,
          folderId: place.folderId,
          folder: place.folderName,
          projectName: place.projectName,
          text: `The project folder "${place.folderName}" sits at the ROOT of the dataset "${name}" instead of inside "${name}/projects/". A copy may exist in both places — nothing was moved or deleted, compare them first.`
        });
        return;
      }
      add(RESYNC_ISSUES.UNKNOWN_FOLDER_IN_DATASET, {
        datasetId: id,
        datasetFolder: name,
        folder: cname,
        folderId: cid,
        text: `"${cname}" sits inside the dataset "${name}" and matches no known container and no known project. It was NOT touched.`
      });
    });

    /* Deux dossiers pour un même projet (racine + `projects/`, ou deux jumeaux
       dans `projects/`) : le Drive peut en porter deux, seul leur CONTENU
       tranche — la fusion est un geste, pas une déduction. */
    const byPlaceSlug = new Map();
    places.forEach((p) => {
      const arr = byPlaceSlug.get(p.slug) || [];
      arr.push(p);
      byPlaceSlug.set(p.slug, arr);
    });
    byPlaceSlug.forEach((arr) => {
      if (arr.length < 2) return;
      const shown = arr.map((p) => `"${name}/${p.container === 'root' ? '' : 'projects/'}${p.folderName}"`).join(' and ');
      add(RESYNC_ISSUES.PROJECT_TWIN, {
        datasetId: id,
        datasetFolder: name,
        projectName: arr[0].projectName,
        folderIds: arr.map((p) => p.folderId),
        folders: arr.map((p) => p.folderName),
        text: `The project "${arr[0].projectName}" has ${arr.length} folders: ${shown}. Nothing was merged — compare them before deleting either.`
      });
    });
    places.forEach((p) => {
      if (p.projectId || p.fromMirror) return;
      unknownProjectFolders += 1;
      add(RESYNC_ISSUES.UNKNOWN_PROJECT_FOLDER, {
        datasetId: id,
        datasetFolder: name,
        folder: p.folderName,
        folderId: p.folderId,
        text: `A folder "${p.folderName}" lives in "${name}/projects/" but no listed project matches it (this PC: ${localProjects.length}, Drive index: ${indexProjects.length}). Its record may have been lost while its files are still there.`
      });
    });

    /* Ce qui a été vu ICI, mis de côté par dataset : la comparaison aux fiches
       attend d'avoir lu TOUS les dossiers du dataset (voir plus bas). */
    if (id) {
      const seen = placesById.get(id) || { name, slug, slugs: new Set() };
      places.forEach((p) => seen.slugs.add(p.slug));
      placesById.set(id, seen);
    }

    /* Le dossier du dataset lui-même : sans fiche, il n'apparaît nulle part ;
       renommé, il est introuvable par les autres postes — les deux se disent. */
    if (!id) {
      add(RESYNC_ISSUES.DATASET_FOLDER_WITHOUT_RECORD, {
        datasetFolder: name,
        folderId: folder.id,
        text: `The folder "${name}" exists on the Drive but no dataset record matches it (this PC: ${localDatasets.length}, Drive index: ${indexDatasets.length}). Its content may still be readable through its copy in ${WORKSPACE_DIR}/datasets/.`
      });
      reportDatasetWithoutRecord(name, slug, text(folder.id));
    } else {
      /* Un dataset RENOMMÉ sur le Drive — mais on ne le dit que sur une PREUVE
         d'identité : l'identifiant Drive du dossier (celui que `driveFolder`
         porte dans l'index, ou celui du registre du miroir). Jamais sur une
         ressemblance de nom : `driveFolder` contient un IDENTIFIANT, pas un
         nom, et le confondre avec un nom ferait crier « renommé » sur chaque
         dataset à chaque resynchronisation. */
      const recordedId = text(candidate && candidate.driveFolder)
        || text(mirrorEntry && mirrorEntry.folderId);
      const recordedName = text(mirrorEntry && mirrorEntry.name)
        || text(candidate && candidate.title);
      const recordedSlug = slugOf(recordedName);
      if (recordedId && recordedId === folderId && recordedSlug && recordedSlug !== slug) {
        add(RESYNC_ISSUES.DATASET_FOLDER_RENAMED, {
          datasetId: id,
          datasetFolder: name,
          recordedFolder: recordedName,
          folderId,
          text: `The dataset "${id}" is recorded in the folder "${recordedName}" but the Drive folder (same folder, id ${folderId}) is now named "${name}". Nothing was renamed.`
        });
      }
    }
    if (!children.length) {
      add(RESYNC_ISSUES.DATASET_FOLDER_EMPTY, {
        datasetId: id,
        datasetFolder: name,
        text: `The dataset folder "${name}" is EMPTY on the Drive${copiesHere ? ` (its content is still readable through ${WORKSPACE_DIR}/datasets/${workspaceDatasetFileName(id)})` : ''}.`
      });
    }

    /* Ce qui a besoin d'être RE-LU depuis le Drive : un dataset absent de ce
       poste, absent de l'index, ou dont le Drive porte PLUS de dossiers de
       projets que ce poste n'en connaît. Sa copie `_workspace/datasets/ds_…`
       est le seul endroit qui peut rendre le contenu manquant. */
    const projectsAtRoot = places.filter((p) => p.container === 'root').length;
    const needsContent = !!id && !deleted
      && (!listedLocally || !listedInIndex || places.length > records.length);
    if (needsContent && !copyIds.includes(id) && !missingCopyIds.includes(id)) {
      if (copiesHere) {
        if (copyIds.length < maxCopies) copyIds.push(id);
      } else {
        missingCopyIds.push(id);
      }
    }
    projectFolderCount += places.length;
    reports.push({
      id,
      folderId: text(folder.id),
      folderName: name,
      slug,
      listedLocally,
      listedInIndex,
      deleted,
      copiesHere,
      needsContent,
      projectsAtRoot,
      /* Les dossiers RAPPROCHÉS d'une fiche — et eux seuls. Un dossier sans
         fiche (« Mystery ») est un DOSSIER, pas un projet : le compter ici
         ferait adopter un anonyme au nom d'une fiche, c'est-à-dire créer ce
         qu'on ne sait pas. Il est déjà signalé comme constat, pour un humain. */
      projects: places.filter((p) => p.projectId || p.fromMirror).map((p) => ({
        id: p.projectId,
        name: p.projectName,
        folderId: p.folderId,
        folderName: p.folderName,
        container: p.container
      }))
    });
  }

  /* ── Les fiches SANS dossier : dites UNE fois par dataset ───────────────────
     Un projet LISTÉ mais sans dossier sur le Drive : l'inverse du constat
     précédent — sa fiche a survécu, ses fichiers non (ou ils sont dans la copie
     du dataset). La comparaison se fait ICI, après la lecture de TOUS les
     dossiers du dataset : deux dossiers jumeaux portent la même fiche, et
     regarder l'un sans l'autre ferait crier « dossier perdu » sur un projet
     dont le dossier est rangé dans le jumeau. */
  placesById.forEach((info, id) => {
    recordsOfDataset(id, info.slug).forEach((p) => {
      const pslug = slugOf(p.name);
      if (!pslug || info.slugs.has(pslug)) return;
      add(RESYNC_ISSUES.PROJECT_FOLDER_MISSING, {
        datasetId: id,
        datasetFolder: info.name,
        projectId: p.id,
        projectName: p.name,
        text: `The project "${p.name}" is listed but no folder was found for it under "${info.name}/projects/".`
      });
    });
  });

  /* ── Les dossiers restés inconnus à la racine ───────────────────────────────
     Un dossier qui porte un conteneur canonique (`projects/`, `protocols/`…)
     A la forme d'un dataset. S'il n'a AUCUNE fiche, il n'apparaît ni dans
     l'index du Drive ni dans la liste du navigateur : c'est le visage le plus
     silencieux du défaut rapporté — des projets vivent encore sur le Drive et
     personne ne les voit. La forme se LIT (une lecture de plus, jamais une
     écriture) ; elle ne se devine pas d'après un nom. */
  for (const u of unclaimedRoots) {
    const shape = foldersOf(await listAll(drive, u.folderId, listFailures))
      .find((f) => isDatasetContainerName(text(f.name))) || null;
    if (!shape) {
      add(RESYNC_ISSUES.UNKNOWN_FOLDER_AT_ROOT, {
        folderId: u.folderId,
        folder: u.name,
        text: `"${u.name}" sits at the root of the workspace and matches no dataset, no project and no known container. Nothing was touched — open it in the Drive and decide.`
      });
      continue;
    }
    add(RESYNC_ISSUES.DATASET_FOLDER_WITHOUT_RECORD, {
      datasetFolder: u.name,
      folderId: u.folderId,
      container: text(shape.name),
      text: `"${u.name}" IS a dataset folder on the Drive (it holds a "${text(shape.name)}" container) but no dataset record matches it (this PC: ${localDatasets.length}, Drive index: ${indexDatasets.length}). Its content may still be readable through a copy in ${WORKSPACE_DIR}/datasets/ (one file per dataset there). Nothing was created or moved.`
    });
    reportDatasetWithoutRecord(u.name, u.slug, u.folderId);
  }

  /* Un dossier que le Drive n'a pas laissé lire : son contenu est ABSENT de cet
     inventaire. Le dire est la seule façon de ne pas prétendre « tout va bien »
     sur un dossier qu'on n'a pas vu. */
  listFailures.slice(0, 5).forEach((f) => add(RESYNC_ISSUES.UNREADABLE_FOLDER, {
    folderId: f.folderId,
    text: `The folder ${f.folderId} could not be listed on the Drive (${f.error}): what it holds is MISSING from this inventory. Nothing was moved.`
  }));

  /* Deux dossiers pour un même dataset (même titre slugé) : le programme en
     verrait deux datasets pour un seul. Rien n'est fusionné ici. */
  const datasetsBySlug = new Map();
  datasetFolders.forEach((d) => {
    const arr = datasetsBySlug.get(d.slug) || [];
    arr.push(d);
    datasetsBySlug.set(d.slug, arr);
  });
  datasetsBySlug.forEach((arr, s) => {
    if (arr.length < 2) return;
    add(RESYNC_ISSUES.DATASET_TWIN, {
      slug: s,
      folderIds: arr.map((d) => d.folderId),
      text: `${arr.length} folders claim the dataset "${arr[0].name}" (ids: ${arr.map((d) => d.folderId).join(', ')}). Nothing was merged.`
    });
  });

  /* L'INVERSE : un dataset listé ici ou dans l'index dont le dossier n'existe
     plus (ou pas encore) sur le Drive. C'est le cas le plus grave du défaut
     rapporté — la fiche survit, le dossier a disparu — et le seul qu'une copie
     `_workspace/datasets/ds_…` peut encore sauver. */
  const folderIdsOnDrive = new Set(datasetFolders
    .map((e) => text((e.candidate && e.candidate.id) || (e.mirrorEntry && e.mirrorEntry.id)))
    .filter(Boolean));
  candidates.forEach((c) => {
    const id = text(c.id);
    if (!id || folderIdsOnDrive.has(id)) return;
    if (knownDeletedIds.has(id) || mirrorDeletedIds.has(id)) return; // supprimé : pas de retour
    datasetsWithoutFolder += 1;
    const copyName = workspaceDatasetFileName(id);
    const copyThere = copyNames.has(copyName);
    add(RESYNC_ISSUES.DATASET_FOLDER_MISSING, {
      datasetId: id,
      datasetTitle: text(c.title),
      copyFileName: copyName,
      copyOnDrive: copyThere,
      text: `The dataset "${text(c.title) || id}" (id ${id}) is listed on this PC or in the index, `
        + 'but NO folder carries it in the workspace on the Drive. '
        + (copyThere
          ? `Its content is still readable through ${WORKSPACE_DIR}/datasets/${copyName}.`
          : `No copy ${WORKSPACE_DIR}/datasets/${copyName} was found either.`)
    });
    /* Le contenu est récupérable PAR LA COPIE : c'est le seul chemin qui reste
       quand le dossier a disparu, et l'appelant l'adopte par les chemins
       normaux (`readDatasetCopy` → `mergeProjectsFromCloud`). */
    if (copyThere) {
      if (copyIds.length < maxCopies && !copyIds.includes(id)) copyIds.push(id);
    } else if (!missingCopyIds.includes(id)) {
      missingCopyIds.push(id);
    }
  });

  const projectFoldersOnDrive = projectFolderCount + workspaceRootStrays;
  /* Un dossier de dataset sans fiche compte comme dossier de dataset : il EST
     sur le Drive. Ne pas le compter reviendrait à le cacher deux fois. */
  const datasetsWithoutRecord = reports.filter((d) => !d.id).length;
  const counts = {
    workspaceFolders: workspaces.length,
    datasetFolders: datasetFolders.length + datasetsWithoutRecord,
    datasetsOnDrive: reports.filter((d) => !!d.id).length,
    datasetsWithoutRecord,
    datasetsWithoutFolder,
    datasetsListedHere: localDatasets.length,
    datasetsListedInIndex: indexDatasets.length,
    projectsListedHere: localProjects.length,
    projectsListedInIndex: indexProjects.length,
    projectFoldersOnDrive,
    projectFoldersAtDatasetRoot: reports.reduce((n, d) => n + d.projectsAtRoot, 0) + workspaceRootStrays,
    projectFoldersUnknown: unknownProjectFolders,
    copiesOnDrive: copyFiles.filter((f) => /^ds_.*\.json$/i.test(text(f.name))).length,
    copiesToFetch: copyIds.length,
    foldersUnreadable: listFailures.length,
    issues: issues.length
  };
  return {
    ok: true,
    reason: '',
    at,
    workspaceFolderId,
    index: {
      savedAt: text(state && state.savedAt),
      datasets: indexDatasets,
      projects: indexProjects,
      deletedProjects: indexDeletedProjects,
      revivedProjects: state ? asList(state.revivedProjects) : []
    },
    datasets: reports,
    issues,
    counts,
    recoverable: {
      copyIds,
      missingCopyIds,
      datasetsInIndex: indexDatasets.length,
      projectsInIndex: indexProjects.length,
      projectsListedHere: localProjects.length,
      datasetsListedHere: localDatasets.length
    },
    text: ''
  };
};

