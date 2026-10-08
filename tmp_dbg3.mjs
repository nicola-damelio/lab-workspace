/* =========================================================================
   _workspace_resync_test.mjs — « RESYNC FROM DRIVE » : L'INVENTAIRE EN LECTURE.

   Le défaut réparé (voir src/utils/workspaceResync.js) : des datasets et des
   projets que le DRIVE portait toujours n'apparaissaient plus dans le programme,
   parce que la liste affichée venait du navigateur ; et quand un dossier était
   créé au mauvais endroit (racine du dataset au lieu de `projects/`), personne
   ne le voyait. Rien ne relisait le Drive EN ENTIER, et rien ne pouvait dire ce
   qui manquait ici.

   Ce qui est vérifié ici, sans navigateur ni réseau :
     • l'énumération d'un dossier suit TOUTES les pages (`nextPageToken`) et un
       arrêt anticipé n'est jamais silencieux (driveListPages.js) ;
     • les helpers purs (fusion des datasets connus, projets d'un dataset, texte
       du rapport) ;
     • l'inventaire lui-même, sur un faux Drive complet : jumeaux de `_workspace`,
       conteneurs égarés à la racine, projet hors de `projects/`, jumeaux de
       projet, dossier de projet sans fiche, dataset sans fiche, dataset vide,
       dataset renommé, copies récupérables — et les copies qui MANQUENT ;
     • un dataset supprimé n'est JAMAIS proposé à la récupération ;
     • l'inventaire NE TOUCHE À RIEN : aucune écriture, aucun déplacement, et ce
       qu'on lui donne (listes, miroir) ressort intact.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const R = await import('./src/utils/workspaceResync.js');
const PAGES = await import('./src/utils/driveListPages.js');
const W = await import('./src/utils/workspaceDrive.js');
const S = await import('./src/utils/driveMirrorStore.js');
const N = await import('./src/utils/driveNaming.js');
const UPSTUB = await import('./src/utils/driveUpload.js');

const RESYNC_SRC = readFileSync('./src/utils/workspaceResync.js', 'utf8');
const UPLOAD_SRC = readFileSync('./src/utils/driveUpload.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const folder = (id, name) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
const doc = (id, name) => ({ id, name, mimeType: 'application/json' });
const kinds = (report) => (report.issues || []).map((i) => i.kind);
const issue = (report, kind) => (report.issues || []).find((i) => i.kind === kind) || null;
const ISSUE = R.RESYNC_ISSUES;

/* ── 1. Un dossier se lit EN ENTIER (toutes les pages) ───────────────────────
   Le faux Drive rend des pages ; `collectDrivePages` doit les enchaîner,
   s'arrêter au bout, et ne JAMAIS faire passer une lecture partielle pour une
   liste complète. */
const pagerOf = (pages) => {
  const asked = [];
  const fetchPage = async (token) => {
    asked.push(token);
    const index = token ? Number(token) : 0;
    const files = pages[index] || [];
    const nextPageToken = index + 1 < pages.length ? String(index + 1) : '';
    return { files, nextPageToken };
  };
  return { asked, fetchPage };
};

const one = pagerOf([['a', 'b']]);
const singlePage = await PAGES.collectDrivePages(one.fetchPage);
eq(singlePage.files, ['a', 'b'], 'une seule page : toutes ses entrées sont rendues');
eq(singlePage.pages, 1, '…une page lue');
eq(singlePage.truncated, false, '…et l’énumération est complète');
eq(one.asked, [''], '…la première page se demande sans jeton');

const many = pagerOf([['a'], ['b'], ['c']]);
const allPages = await PAGES.collectDrivePages(many.fetchPage);
eq(allPages.files, ['a', 'b', 'c'], 'les pages suivantes sont ENCHAÎNÉES (nextPageToken suivi jusqu’au bout)');
eq(allPages.pages, 3, '…les trois pages sont lues');
eq(many.asked, ['', '1', '2'], '…chaque page est demandée avec le jeton de la précédente');
eq(allPages.truncated, false, '…rien n’a manqué');

const capped = pagerOf([['a'], ['b'], ['c']]);
const limited = await PAGES.collectDrivePages(capped.fetchPage, { maxPages: 2 });
eq(limited.files, ['a', 'b'], 'la borne de sécurité arrête l’énumération');
eq(limited.truncated, true, '…et l’arrêt ANTICIPÉ est AVOUÉ (jamais une liste tronquée en silence)');
eq(limited.token, '2', '…le jeton restant est rendu à l’appelant');

const broken = {
  asked: [],
  fetchPage: async (token) => {
    broken.asked.push(token);
    if (token) throw new Error('quota 403');
    return { files: ['a'], nextPageToken: '1' };
  }
};
const partial = await PAGES.collectDrivePages(broken.fetchPage);
eq(partial.files, ['a'], 'une page en échec n’efface pas ce qui a déjà été lu');
eq(partial.errors, 1, '…l’échec est compté');
eq(partial.truncated, true, '…et la lecture est déclarée INCOMPLÈTE');

eq(await PAGES.collectDrivePages(null), { files: [], pages: 0, truncated: false, token: '', pageTokens: [], errors: 0 },
  'sans lecteur de page, l’énumération est vide (aucune exception)');
eq(UPSTUB.MAX_DRIVE_LIST_PAGES, PAGES.MAX_DRIVE_LIST_PAGES,
  'la borne vit à UN SEUL endroit (driveListPages.js) et est ré-exportée');
has(UPLOAD_SRC, "from './driveListPages'", 'listDriveChildren s’appuie sur la boucle toutes-pages');
has(UPLOAD_SRC, 'nextPageToken', '…en demandant explicitement le jeton de page à Drive');
has(UPLOAD_SRC, 'pageToken=', '…et en le renvoyant à la page suivante');
has(UPLOAD_SRC, 'export const listDriveChildrenDetailed', '…et en AVOUANT la troncature (`truncated`)');

/* ── 2. Les helpers purs ───────────────────────────────────────────────────── */
const KNOWN_HERE = [
  { id: 'ds1', title: 'Pepper viruses', driveFolder: 'pepper-viruses' },
  { id: 'ds2', title: 'Rhodopsin' },
  { id: '', title: 'Sans identifiant' },
  { id: 'ds3', title: 'Chymotrypsin' }
];
const KNOWN_INDEX = [
  { id: 'ds3', title: 'Chymotrypsin (renommé)', driveFolder: 'chymotrypsin-old' },
  { id: 'ds9', title: 'Legacy dataset' }
];
const candidates = R.collectResyncCandidates([KNOWN_HERE, KNOWN_INDEX]);
eq(candidates.map((c) => c.id), ['ds1', 'ds2', 'ds3', 'ds9'],
  'les datasets connus sont fusionnés PAR IDENTIFIANT (jamais comptés deux fois)');
eq(candidates.find((c) => c.id === 'ds3'), { id: 'ds3', title: 'Chymotrypsin (renommé)', driveFolder: 'chymotrypsin-old' },
  'l’index du Drive est donné en dernier : c’est lui qui décrit quand ce poste a une vue périmée');
eq(R.collectResyncCandidates([]), [], 'sans liste, aucun candidat');
eq(R.collectResyncCandidates([KNOWN_HERE]).length, 3, 'une entrée sans identifiant n’est pas un dataset');

/* Les projets d’UN dataset : par identifiant quand on le connaît, par NOM de
   dataset pour les fiches historiques (sans datasetId), et jamais ceux d’un
   autre dataset. */
const PROJECTS_HERE = [
  { id: 'p1', name: 'Alpha', datasetId: 'ds1' },
  { id: 'p2', name: 'Beta', datasetId: 'ds2' },
  { id: 'p3', name: 'Legacy', datasetName: 'Pepper viruses' },
  { id: 'p4', name: 'Orphan' }
];
const PROJECTS_INDEX = [
  { id: 'p1', name: 'Alpha', datasetId: 'ds1' },
  { id: 'p5', name: 'Gamma', datasetId: 'ds1' }
];
const slugOf = (t) => N.sanitizeSlug(t);
eq(R.projectRecordsOf([PROJECTS_HERE, PROJECTS_INDEX], { datasetId: 'ds1', datasetSlug: slugOf('Pepper viruses') })
  .map((p) => p.id), ['p1', 'p3', 'p4', 'p5'],
'les projets du dataset sont ceux de ce poste ET de l’index, fusionnés par identifiant');
eq(R.projectRecordsOf([PROJECTS_HERE], { datasetId: 'ds2' }).map((p) => p.id), ['p2', 'p4'],
  '…un projet d’un AUTRE dataset n’est jamais attribué au mauvais dossier');
eq(R.projectRecordsOf([PROJECTS_HERE], { datasetId: 'ds1' }).map((p) => p.id), ['p1', 'p4'],
  '…et une fiche historique ne rejoint un dataset que si son NOM correspond');
eq(R.projectRecordsOf([PROJECTS_HERE], { datasetSlug: slugOf('Pepper viruses') }).map((p) => p.id), ['p3', 'p4'],
  'sans identifiant de dataset, seule la correspondance de nom rattache les fiches historiques');
eq(R.projectRecordsOf([], {}), [], 'sans liste, aucun projet');

eq(R.resyncReasonText('drive-offline'), 'Google Drive is not connected', 'la cause d’un inventaire impossible est dite en clair');
ok(R.resyncReasonText('no-workspace-folder').includes('none was created'),
  '…et la cause « pas de dossier de travail » précise qu’AUCUN dossier n’a été fabriqué');
eq(R.resyncReasonText('quota'), 'quota', 'une cause inconnue est rendue telle quelle');
eq(R.resyncReasonText(''), 'unknown reason', 'sans cause, une phrase générique (jamais du vide)');

const empty = R.emptyResyncReport({ at: 'X', reason: 'drive-offline' });
eq(empty.ok, false, 'un inventaire vide se déclare NON abouti');
eq(empty.reason, 'drive-offline', '…avec sa cause');
eq(empty.at, 'X', '…et son horodatage');
eq(empty.counts.datasetsOnDrive, 0, '…et des comptes à zéro (jamais `undefined`)');
eq(empty.recoverable.copyIds, [], '…et aucune copie à récupérer');

const offlineLines = R.resyncReportLines(R.emptyResyncReport({ reason: 'drive-offline' }));
eq(offlineLines.length, 1, 'un Drive injoignable tient en UNE phrase');
ok(offlineLines[0].startsWith('· Drive inventory unavailable:'), '…et cette phrase dit que l’inventaire n’a pas eu lieu');
const noReport = R.resyncReportLines(null);
ok(noReport.length === 1 && noReport[0].includes('Drive inventory unavailable'),
  'un rapport absent est traité comme un rapport sans Drive (jamais une exception)');

/* ── 3. L'INVENTAIRE, sur un faux Drive COMPLET ─────────────────────────────── */

/* Le faux Drive : un arbre de dossiers et de fichiers, indexé par identifiant.
   Chaque défaut réel y est représenté une fois — et le DRIVE reste la seule
   source : l'inventaire ne lit que ce que l'adaptateur veut bien rendre. */
const F = {
  WS: 'F_WS', WS_DIR: 'F_WS_DIR', WS_TWIN: 'F_WS_TWIN', COPIES: 'F_COPIES',
  DS1: 'F_DS1', DS1_TWIN: 'F_DS1_TWIN', DS1_PROJ: 'F_DS1_PROJ', ALPHA: 'F_ALPHA',
  ALPHA_ROOT: 'F_ALPHA_ROOT', DELTA: 'F_DELTA', MYSTERY_P1: 'F_MYSTERY_P1',
  DS2: 'F_DS2', DS2_PROJ: 'F_DS2_PROJ', BETA: 'F_BETA', EPSILON: 'F_EPSILON',
  MISPLACED_WS: 'F_MISPLACED_WS', NESTED_DS: 'F_NESTED_DS',
  DS3: 'F_DS3', DS3_PROJ: 'F_DS3_PROJ', ZETA: 'F_ZETA',
  DS4: 'F_DS4', DS4_PROJ: 'F_DS4_PROJ', ETA: 'F_ETA', MYSTERY_P4: 'F_MYSTERY_P4',
  DS7: 'F_DS7', NO_RECORD: 'F_NO_RECORD', NO_RECORD_PROJ: 'F_NO_RECORD_PROJ',
  ROOT_PROJECTS: 'F_ROOT_PROJECTS', ROOT_BACKUPS: 'F_ROOT_BACKUPS',
  ROOT_STRAY: 'F_ROOT_STRAY', ROOT_UNKNOWN: 'F_ROOT_UNKNOWN',
  IN_DS_UNKNOWN: 'F_IN_DS_UNKNOWN',
  FILE_STATE: 'X_STATE', FILE_CP1: 'X_CP1', FILE_CP3: 'X_CP3', FILE_CP7: 'X_CP7',
  FILE_DOC: 'X_DOC', FILE_STRAY_DOC: 'X_STRAY_DOC', FILE_NO_RECORD_DOC: 'X_NRD'
};

const TREE = new Map([
  [F.WS, [
    folder(F.WS_DIR, '_workspace'),
    folder(F.WS_TWIN, '_workspace'),
    folder(F.DS1, 'Pepper viruses'),
    folder(F.DS1_TWIN, 'Pepper viruses'),
    folder(F.DS2, 'Rhodopsin'),
    folder(F.DS3, 'NMR structure'),
    folder(F.DS4, 'Chymotrypsin old'),
    folder(F.DS7, 'Removed dataset'),
    folder(F.NO_RECORD, 'Mystery folder'),
    folder(F.ROOT_PROJECTS, 'projects'),
    folder(F.ROOT_BACKUPS, 'backups'),
    folder(F.ROOT_STRAY, 'Alpha'),
    folder(F.ROOT_UNKNOWN, 'Random notes')
  ]],
  /* Le vrai `_workspace` : l'index ET les copies de contenu. Le jumeau, lui,
     porte un dossier `datasets` mais AUCUN `state.json` : c'est ce qui dit
     lequel des deux est lu. */
  [F.WS_DIR, [doc(F.FILE_STATE, 'state.json'), folder(F.COPIES, 'datasets')]],
  [F.WS_TWIN, [folder(F.COPIES, 'datasets')]],
  /* Les copies de contenu portent le nom que le PROGRAMME leur donne : le test
     lit `workspaceDatasetFileName` au lieu de recopier un nom à la main — un
     nom figé ici pourrait diverger du fichier réellement écrit sur le Drive. */
  [F.COPIES, [
    doc(F.FILE_CP1, W.workspaceDatasetFileName('ds1')),
    doc(F.FILE_CP3, W.workspaceDatasetFileName('ds3')),
    doc(F.FILE_CP7, W.workspaceDatasetFileName('ds7')),
    doc('X_CP_OTHER', 'notes.json')
  ]],
  [F.DS1, [
    folder(F.DS1_PROJ, 'projects'),
    folder(F.ALPHA_ROOT, 'Alpha'),
    folder(F.IN_DS_UNKNOWN, 'Random'),
    doc(F.FILE_DOC, 'report.docx')
  ]],
  [F.DS1_PROJ, [
    folder(F.ALPHA, 'Alpha'),
    folder(F.DELTA, 'Delta'),
    folder(F.MYSTERY_P1, 'Mystery')
  ]],
  [F.DS1_TWIN, []],
  [F.DS2, [
    folder(F.DS2_PROJ, 'projects'),
    folder(F.MISPLACED_WS, '_workspace'),
    folder(F.NESTED_DS, 'Pepper viruses')
  ]],
  [F.DS2_PROJ, [folder(F.BETA, 'Beta'), folder(F.EPSILON, 'Epsilon')]],
  [F.DS3, [folder(F.DS3_PROJ, 'projects')]],
  [F.DS3_PROJ, [folder(F.ZETA, 'Zeta')]],
  [F.DS4, [folder(F.DS4_PROJ, 'projects')]],
  [F.DS4_PROJ, [folder(F.ETA, 'Eta'), folder(F.MYSTERY_P4, 'Mystery')]],
  [F.DS7, []],
  [F.NO_RECORD, [folder(F.NO_RECORD_PROJ, 'projects'), doc(F.FILE_NO_RECORD_DOC, 'x.txt')]],
  [F.ROOT_STRAY, [doc(F.FILE_STRAY_DOC, 'x.txt')]]
]);

/* Ce que CE POSTE affiche (la liste du navigateur). */
const HERE_DATASETS = [
  { id: 'ds1', title: 'Pepper viruses' },
  { id: 'ds2', title: 'Rhodopsin' }
];
const HERE_PROJECTS = [
  { id: 'p_alpha', name: 'Alpha', datasetId: 'ds1' },
  { id: 'p_delta', name: 'Delta', datasetId: 'ds1' },
  { id: 'p_beta', name: 'Beta', datasetId: 'ds2' }
];

/* L'index du Drive : ds5/ds6 sont listés mais aucun dossier ne les porte plus,
   ds7 est listé et supprimé (sa tombe est dans le registre), ds8 est supprimé
   ici (`known.deletedDatasetIds`). */
const INDEX_DATASETS = [
  { id: 'ds1', title: 'Pepper viruses' },
  { id: 'ds2', title: 'Rhodopsin' },
  { id: 'ds3', title: 'NMR structure' },
  { id: 'ds4', title: 'Chymotrypsin' },
  { id: 'ds5', title: 'Budget 2024' },
  { id: 'ds6', title: 'Ghost dataset' },
  { id: 'ds7', title: 'Removed dataset' }
];
const INDEX_PROJECTS = [
  { id: 'p_alpha', name: 'Alpha', datasetId: 'ds1' },
  { id: 'p_beta', name: 'Beta', datasetId: 'ds2' },
  { id: 'p_epsilon', name: 'Epsilon', datasetId: 'ds2' },
  { id: 'p_gamma', name: 'Gamma', datasetId: 'ds2' },
  { id: 'p_zeta', name: 'Zeta', datasetId: 'ds3' },
  { id: 'p_eta', name: 'Eta', datasetId: 'ds4' }
];

/* Le registre du miroir : le Drive l'écrit à chaque geste (création, renommage,
   suppression). Ses valeurs portent l'IDENTIFIANT du dossier Drive — c'est lui
   qui survit à un renommage, le nom non. */
const MIRROR = {
  tombstones: [{ id: 'ds7', name: 'Removed dataset', path: '', kind: 'dataset', deletedAt: 900 }],
  datasets: {
    'id:ds1': { name: 'Pepper viruses', folderId: F.DS1, at: 10 },
    'id:ds4': { name: 'Chymotrypsin', folderId: F.DS4, at: 10 }
  },
  projects: {
    'id:ds1::Alpha': { name: 'Alpha', dataset: 'ds1', folderId: F.ALPHA, at: 10 },
    'id:ds1::Alpha root copy': { name: 'Alpha', dataset: 'ds1', folderId: F.ALPHA_ROOT, at: 10 },
    'id:ds2::Beta': { name: 'Beta', dataset: 'ds2', folderId: F.BETA, at: 10 },
    'id:ds2::Epsilon': { name: 'Epsilon', dataset: 'ds2', folderId: F.EPSILON, at: 10 },
    'id:ds4::Eta': { name: 'Eta', dataset: 'ds4', folderId: F.ETA, at: 10 },
    'unknown::Stray project': { name: 'Alpha', dataset: '', folderId: F.ROOT_STRAY, at: 10 }
  }
};

/* L'index est fabriqué par le VRAI constructeur : le test lit exactement ce que
   le programme écrit sur le Drive, jamais une forme inventée ici. */
const STATE_JSON = W.workspaceStateJson(W.buildWorkspaceState({
  datasets: INDEX_DATASETS,
  projects: INDEX_PROJECTS,
  mirror: MIRROR,
  deletedProjects: [{ id: 'p_gone', name: 'Gone' }],
  at: '2026-01-02T00:00:00.000Z'
}));

/* Le faux Drive, avec ses espions : l'inventaire ne dispose QUE de gestes de
   lecture, et les gestes d'écriture — s'il en prenait un — le feraient échouer. */
const spy = { list: [], download: [], find: 0, writes: [] };
const fakeDrive = (tree = TREE, files = { [F.FILE_STATE]: STATE_JSON }) => ({
  available: async () => true,
  findWorkspaceFolder: async () => { spy.find += 1; return F.WS; },
  listChildren: async (id) => { spy.list.push(String(id)); return tree.get(String(id)) || []; },
  downloadText: async (id) => { spy.download.push(String(id)); return files[String(id)] || ''; },
  createFolder: async () => { spy.writes.push('createFolder'); throw new Error('write attempted'); },
  uploadText: async () => { spy.writes.push('uploadText'); throw new Error('write attempted'); },
  moveFile: async () => { spy.writes.push('moveFile'); throw new Error('write attempted'); },
  trashFile: async () => { spy.writes.push('trashFile'); throw new Error('write attempted'); }
});

const KNOWN = {
  datasets: HERE_DATASETS,
  projects: HERE_PROJECTS,
  deletedDatasetIds: [{ id: 'ds6', title: 'Ghost dataset' }]
};
const beforeInputs = JSON.stringify({ known: KNOWN, mirror: MIRROR });
const beforeTree = JSON.stringify(Array.from(TREE.entries()));
const REPORT = await R.sweepWorkspaceDrive({ adapter: fakeDrive(), known: KNOWN, mirror: MIRROR });
const K = kinds(REPORT);
ok(REPORT.ok, 'sur un faux Drive joignable, l’inventaire aboutit');
eq(REPORT.reason, '', '…sans cause d’échec');
eq(REPORT.workspaceFolderId, F.WS, '…et il dit dans quel dossier d’espace de travail il a regardé');
eq(REPORT.index.savedAt, '2026-01-02T00:00:00.000Z', '…en ayant relu l’index du Drive (sa date de sauvegarde)');
eq(REPORT.index.datasets.length, INDEX_DATASETS.length, '…et les datasets de cet index');
eq(REPORT.index.projects.length, INDEX_PROJECTS.length, '…ainsi que ses projets');
eq(REPORT.index.deletedProjects.length, 1, '…et les projets supprimés qu’il transporte');
eq(REPORT.counts.workspaceFolders, 2, 'les DEUX dossiers `_workspace` du Drive sont vus (le jumeau est signalé, pas ignoré)');
eq(REPORT.counts.datasetFolders, 7, 'sept dossiers de dataset sont portés par l’espace de travail');
eq(REPORT.counts.datasetsOnDrive, 6, '…dont six se rattachent à une fiche de dataset');
eq(REPORT.counts.datasetsWithoutRecord, 1, '…et un (« Mystery folder ») n’en a AUCUNE');
eq(REPORT.counts.datasetsWithoutFolder, 1, 'un dataset listé (« Budget 2024 ») n’a plus de dossier du tout');
eq(REPORT.counts.datasetsListedHere, 2, 'ce poste n’en affiche que deux');
eq(REPORT.counts.projectsListedHere, 3, '…et trois projets');
eq(REPORT.counts.copiesOnDrive, 3, 'trois copies de contenu vivent dans `_workspace/datasets/`');
eq(REPORT.counts.copiesToFetch, 2, '…dont deux peuvent rendre un contenu manquant (jamais les supprimés)');
eq(REPORT.counts.projectFoldersUnknown, 2, 'deux dossiers de projet ne correspondent à aucune fiche');

/* Le défaut rapporté, chacun de ses visages : le conteneur égaré, le dossier de
   projet hors de `projects/`, le jumeau, la fiche sans dossier — et l’inverse. */
ok(K.includes(ISSUE.TWIN_WORKSPACE), 'deux dossiers `_workspace` : c’est signalé');
ok(K.includes(ISSUE.STRAY_ROOT_CONTAINER), 'un conteneur `projects` posé à la racine de l’espace de travail : c’est signalé');
ok(K.includes(ISSUE.LEGACY_ROOT_CONTAINER), '…et un conteneur historique `backups` : c’est signalé aussi');
eq(K.filter((k) => k === ISSUE.STRAY_PROJECT_AT_ROOT).length, 2,
  'les deux dossiers de projet égarés (racine de l’espace de travail ET racine du dataset) sont signalés');
eq((REPORT.issues || []).map((i) => (i.kind === ISSUE.STRAY_PROJECT_AT_ROOT ? i.scope : null)).filter(Boolean).sort(),
  ['dataset-root', 'workspace-root'], '…et chaque constat dit À QUELLE racine il se trouve');
ok(K.includes(ISSUE.PROJECT_TWIN), 'un projet porté par DEUX dossiers (racine + `projects/`) : c’est signalé, rien n’est fusionné');
eq(K.filter((k) => k === ISSUE.UNKNOWN_PROJECT_FOLDER).length, 2,
  'deux dossiers de projet sans fiche : aucun n’est ignoré en silence');
ok(K.includes(ISSUE.PROJECT_FOLDER_MISSING), 'un projet LISTÉ sans dossier (« Gamma ») : c’est signalé (l’inverse du précédent)');
eq(K.filter((k) => k === ISSUE.PROJECT_FOLDER_MISSING).length, 1,
  'une seule fiche reste sans dossier : le dossier JUMEAU, vide, ne fait pas crier sur « Alpha » et « Delta », rangés dans l’autre');
ok(!(REPORT.issues || []).some((i) => i.kind === ISSUE.PROJECT_FOLDER_MISSING && i.datasetId === 'ds1'),
  '…et jamais pour un dataset porté par deux dossiers jumeaux quand le dossier du projet est dans l’un des deux');
ok(K.includes(ISSUE.DATASET_FOLDER_WITHOUT_RECORD), 'un dossier de dataset sans fiche : c’est signalé');
ok(K.includes(ISSUE.DATASET_FOLDER_INSIDE_DATASET), 'un dossier de dataset IMBRIQUÉ dans un autre : c’est signalé');
ok(K.includes(ISSUE.DATASET_TWIN), 'deux dossiers pour un seul dataset : c’est signalé, rien n’est fusionné');
ok(K.includes(ISSUE.DATASET_FOLDER_RENAMED), 'un dataset dont le dossier a été renommé : c’est signalé');
ok(K.includes(ISSUE.MISPLACED_WORKSPACE), 'un dossier `_workspace` dans un dataset : c’est signalé');
eq(issue(REPORT, ISSUE.MISPLACED_WORKSPACE).folderId, F.MISPLACED_WS,
  '…reconnaissable seulement via son nom SLUGÉ (sanitizeSlug de « _workspace » vaut « workspace ») : comparé au nom littéral, il ne serait jamais trouvé');
ok(!(REPORT.issues || []).some((i) => i.kind === ISSUE.UNKNOWN_FOLDER_IN_DATASET && i.folder === '_workspace'),
  '…et il n’est pas signalé deux fois (une fois pour sa forme, une fois comme dossier inconnu)');
ok(K.includes(ISSUE.UNKNOWN_FOLDER_IN_DATASET), 'un dossier inconnu DANS un dataset : c’est signalé');
ok(K.includes(ISSUE.UNKNOWN_FOLDER_AT_ROOT), 'un dossier inconnu à la racine : c’est signalé');
ok(K.includes(ISSUE.DATASET_FOLDER_MISSING), 'un dataset listé dont le dossier a disparu : c’est signalé');
ok(!K.includes(ISSUE.MISSING_STATE) && !K.includes(ISSUE.STATE_UNREADABLE),
  'l’index du Drive est lisible : aucun constat d’index absent ou abîmé');
ok(!K.includes(ISSUE.NO_WORKSPACE), 'le dossier d’espace de travail existe : aucun constat de dossier manquant');

/* Le dossier « Mystery folder » : sans fiche, l’inventaire le DIT et rappelle où
   le contenu reste lisible. */
const noRecord = issue(REPORT, ISSUE.DATASET_FOLDER_WITHOUT_RECORD);
ok(noRecord && noRecord.datasetFolder === 'Mystery folder', '…et le constat nomme le dossier sans fiche');
ok(noRecord.text.includes('_workspace/datasets/'), '…en indiquant le chemin de la copie qui peut encore lire son contenu');
eq(noRecord.container, 'projects', '…en se fondant sur ce qu’on a VU dedans : le conteneur « projects » qui lui donne sa forme de dossier de dataset');
const ghost = (REPORT.datasets || []).find((d) => !d.id) || null;
ok(ghost && ghost.folderName === 'Mystery folder',
  'un dossier de dataset sans fiche apparaît quand même dans l’inventaire : sinon ses projets resteraient invisibles deux fois');
eq(ghost.projects, [], '…sans projet inventé : personne ne compare ses dossiers à des fiches qui n’existent pas');
eq((REPORT.issues || []).filter((i) => i.kind === ISSUE.UNKNOWN_FOLDER_AT_ROOT).length, 1,
  'un SEUL dossier reste inconnu à la racine (« Random notes ») : `_workspace` est reconnu, et un dossier à forme de dataset n’est plus jamais rangé parmi les inconnus');

/* Ce que l’écran affichera : une fiche par dossier de dataset. */
const dsEntry = (id) => (REPORT.datasets || []).find((d) => d.id === id) || null;
const ds1 = dsEntry('ds1');
ok(!!ds1, 'l’inventaire rend une fiche par dossier de dataset');
eq(ds1.folderName, 'Pepper viruses', '…avec le nom que le Drive porte VRAIMENT');
eq(ds1.listedLocally, true, '…et dit si la liste de ce poste le connaît');
eq(ds1.listedInIndex, true, '…ainsi que celle de l’index');
eq(ds1.projects.map((p) => p.name).sort(), ['Alpha', 'Alpha', 'Delta'],
  'les dossiers de projet trouvés sont tous là — y compris celui posé à la racine du dataset');
ok(!ds1.projects.some((p) => !p.id),
  '…mais un dossier SANS fiche n’y figure pas : on ne présente pas un anonyme comme un projet (adopter un nom qu’on n’a pas su lire, c’est créer ce qu’on ne sait pas)');
eq(ds1.projectsAtRoot, 1, '…et ce dernier est compté comme égaré');
eq(ds1.copiesHere, true, 'la copie de contenu de ce dataset est vue sur le Drive');
eq(ds1.needsContent, true, 'le Drive porte PLUS de dossiers de projet que ce poste n’en connaît : le contenu doit être relu');
eq(ds1.deleted, false, '…et ce dataset n’est pas supprimé');

const ds4 = dsEntry('ds4');
eq(ds4.listedLocally, false, 'un dataset que ce poste ne liste plus est quand même rendu');
eq(ds4.needsContent, true, '…et son contenu est à relire');
eq(ds4.copiesHere, false, '…même si aucune copie ne peut le faire ici');
eq(ds4.projects.map((p) => p.name), ['Eta'],
  '…et son dossier de projet est reconnu par le REGISTRE : l’identifiant résiste au renommage du dataset');

const ds7 = dsEntry('ds7');
eq(ds7.deleted, true, 'un dataset supprimé est reconnu comme tel');
eq(ds7.needsContent, false, '…et son contenu n’est jamais proposé à la récupération');
eq(ds7.copiesHere, true, '…même quand une copie traîne sur le Drive');

/* Ce qui peut être récupéré — et ce qui ne peut pas. */
eq(REPORT.recoverable.copyIds, ['ds1', 'ds3'],
  'les copies à adopter : le dataset que le Drive connaît mieux que ce poste, et celui que ce poste ne connaît plus');
eq(REPORT.recoverable.missingCopyIds, ['ds4', 'ds5'],
  'ceux dont le contenu manque ET dont la copie manque sont dits séparément (on ne promet rien)');
ok(!REPORT.recoverable.copyIds.includes('ds7'),
  'un dataset SUPPRIMÉ n’est JAMAIS proposé à la récupération, même avec une copie à portée');
ok(!REPORT.recoverable.copyIds.includes('ds6'),
  '…ni un dataset supprimé qui n’a plus de dossier du tout');
eq(REPORT.recoverable.datasetsInIndex, INDEX_DATASETS.length, 'le compte des datasets de l’index voyage avec les copies');
eq(REPORT.recoverable.projectsInIndex, INDEX_PROJECTS.length, '…ainsi que celui des projets');
eq(REPORT.recoverable.projectsListedHere, HERE_PROJECTS.length, '…et ce que ce poste affiche');
eq(REPORT.recoverable.datasetsListedHere, HERE_DATASETS.length, '…des deux côtés');

/* L’inventaire NE TOUCHE À RIEN : ni écriture, ni déplacement, ni création. */
eq(spy.writes, [], 'aucun geste d’écriture n’est tenté — l’inventaire n’en a même pas les moyens');
eq(spy.find, 1, 'le dossier d’espace de travail est CHERCHÉ une fois, jamais fabriqué');
eq(spy.download, [F.FILE_STATE], 'seul l’INDEX est téléchargé : aucun fichier de contenu n’est lu par l’inventaire');
eq(spy.list, [
  F.WS, F.WS_DIR, F.WS_TWIN, F.COPIES,
  F.DS1, F.DS1_PROJ, F.DS1_TWIN, F.DS2, F.DS2_PROJ, F.DS3, F.DS3_PROJ,
  F.DS4, F.DS4_PROJ, F.DS7, F.NO_RECORD, F.ROOT_UNKNOWN
], 'il ne liste que des dossiers qui EXISTENT (aucune supposition) : chaque dossier de dataset, puis chaque dossier resté inconnu à la racine — ouvert UNE fois pour voir s’il s’agit d’un dataset sans fiche');
eq(JSON.stringify({ known: KNOWN, mirror: MIRROR }), beforeInputs,
  'ce qu’on lui donne ressort INTACT — listes et registre du miroir inchangés');
eq(JSON.stringify(Array.from(TREE.entries())), beforeTree,
  '…et l’arbre du Drive aussi : rien n’a bougé, rien n’a été renommé, rien n’a été créé');

has(RESYNC_SRC, 'findLabWorkspaceFolder', 'l’inventaire CHERCHE le dossier d’espace de travail');
ok(!RESYNC_SRC.includes('ensureLabWorkspaceFolder') && !RESYNC_SRC.includes('ensureDriveFolder'),
  '…et ne le CRÉE jamais : une resynchronisation ne fabrique aucun dossier vide');
/* Le corps de la RECHERCHE : depuis son `export` jusqu'à l'`export` SUIVANT —
   et pas depuis le début, sinon la recherche du prochain `export const` tombe
   sur celui-là même (index 0) et le corps reste vide. Le voisin,
   `ensureLabWorkspaceFolder`, est justement celui qui CRÉE. */
const FIND_HEAD = 'export const findLabWorkspaceFolder';
const findBody = UPLOAD_SRC.slice(UPLOAD_SRC.indexOf(FIND_HEAD) + FIND_HEAD.length);
const findBodyEnd = findBody.indexOf('export const ');
ok(findBodyEnd > 0 && !findBody.slice(0, findBodyEnd).includes('findOrCreateFolder'),
  'la recherche du dossier « Lab Workspace » n’envoie AUCUNE demande de création');
has(findBody.slice(0, findBodyEnd), "name='Lab Workspace'",
  '…elle cherche par NOM (une lecture), et rend `\'\'` quand elle ne trouve rien');
ok(UPLOAD_SRC.includes('export const ensureLabWorkspaceFolder'),
  'tandis que la CRÉATION vit dans un AUTRE geste (`ensureLabWorkspaceFolder`) : chercher et fabriquer ne sont pas le même acte');

/* Les phrases rendues à l’écran. */
const lines = R.resyncReportLines(REPORT);
ok(lines.some((l) => l.includes('7 dataset folder(s)')), 'la première ligne compte ce que le Drive porte VRAIMENT');
ok(lines.some((l) => l.includes('FEWER than the Drive index')),
  '…et dit quand ce poste en sait MOINS que l’index — la liste à croire est celle du Drive');
ok(lines.some((l) => l.includes('dataset copy(ies) on the Drive can restore')),
  '…et combien de copies peuvent restaurer un contenu manquant');
ok(lines.filter((l) => l.startsWith('⚠')).length >= 15, 'chaque constat tient en une ligne lisible');
ok(lines.some((l) => l.startsWith('⚠') && l.includes('Mystery folder')), '…y compris le dossier de dataset sans fiche');
ok(!lines.some((l) => l.includes('No misplaced or incomplete folder found')),
  '…et la phrase rassurante se TAIT dès qu’il y a un constat');

/* Le nombre de copies adoptées en une fois est borné : une resynchronisation ne
   doit pas aspirer le Drive entier d’un seul geste. */
const cappedCopies = await R.sweepWorkspaceDrive({ adapter: fakeDrive(), known: KNOWN, mirror: MIRROR, maxCopies: 1 });
eq(cappedCopies.recoverable.copyIds, ['ds1'], 'le nombre de copies proposées est BORNÉ quand on le demande');
eq(cappedCopies.counts.copiesToFetch, 1, '…et le compte suit la liste rendue, jamais un chiffre plus flatteur');

/* Sans le registre du miroir, l’inventaire ne DEVINE rien : il dit qu’il ne sait
   pas. C’est la différence entre reconnaître un dossier et le supposer. */
const noMirror = await R.sweepWorkspaceDrive({ adapter: fakeDrive(), known: KNOWN, mirror: {} });
const dump = (tag, rep) => {
  console.log(tag, 'reason', rep.reason || '-');
  console.log(tag, 'datasets', JSON.stringify((rep.datasets || []).map((d) => ({ f: d.folderName, id: d.id, slug: d.slug }))));
  console.log(tag, 'recoverable', JSON.stringify(rep.recoverable));
  (rep.issues || []).forEach((i) => console.log(tag, '  ', i.kind, '|folder:', i.folder || i.datasetFolder || '-', '|project:', i.projectName || '-', '|scope:', i.scope || '-', '|folderId:', i.folderId || '-', '|container:', i.container || '-'));
};
dump('MIRROR', REPORT);
dump('NOMIRROR', noMirror);
