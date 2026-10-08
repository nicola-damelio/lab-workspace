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
  [F.COPIES, [
    doc(F.FILE_CP1, 'ds_1.json'),
    doc(F.FILE_CP3, 'ds_3.json'),
    doc(F.FILE_CP7, 'ds_7.json'),
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
console.log('datasetFolders');
REPORT.datasets.forEach((d) => console.log('  ', JSON.stringify({ folderName: d.folderName, folderId: d.folderId, id: d.id, slug: d.slug, deleted: d.deleted, listedLocally: d.listedLocally, listedInIndex: d.listedInIndex, mirror: !!d.fromMirror })));
console.log('counts', JSON.stringify(REPORT.counts, null, 1));
console.log('issues');
REPORT.issues.forEach((i) => console.log('  ', JSON.stringify(i).slice(0, 200)));
console.log('recoverable', JSON.stringify(REPORT.recoverable));
console.log('index datasets', JSON.stringify(REPORT.index.datasets));
