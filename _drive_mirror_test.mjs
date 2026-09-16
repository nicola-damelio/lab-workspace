/* =========================================================================
   _drive_mirror_test.mjs — LE DRIVE EST LE MIROIR DU PROGRAMME.

   Les deux défauts réparés (voir src/utils/driveMirrorStore.js et
   src/utils/driveMirror.js) :
     1. supprimer un dataset / un projet ne supprimait RIEN sur le Drive — le
        dossier (et ses fichiers) restait, et l'application le recréait ensuite
        à côté : « je vois réapparaître des dossiers que j'avais supprimés » ;
     2. renommer un dataset / un projet ne renommait le dossier que sur le poste
        qui avait gardé son identifiant en mémoire ; ailleurs un SECOND dossier
        était créé, donc deux postes ne voyaient plus la même chose.

   Ce qui est vérifié ici, avec les modules RÉELS et un faux Drive :
     • les pierres tombales (id/chemin) : unicité, descendance, « le dataset
       entier » vs « un dossier » ;
     • elles VOYAGENT (fusion) — une suppression faite sur un poste vaut sur
       l'autre, et le registre des dossiers garde l'entrée la plus récente ;
     • supprimer un dataset / un projet met bien le dossier à la corbeille ;
     • renommer renomme le dossier (jamais d'écriture dans un dossier fantôme)
       et le document <projet>_document.json suit le projet ;
     • un dossier supprimé n'est JAMAIS recréé (ensureDriveFolder /
       ensureDatasetFolderStructure / resolveDrivePathFromNames) ;
     • les pages appellent réellement tout cela.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage minimal : les modules testés sont ceux du navigateur. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};
const dispatched = [];
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (e) => { dispatched.push(e && e.type); return true; }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const S = await import('./src/utils/driveMirrorStore.js');
const DRIVE = await import('./src/utils/driveMirror.js');
const UPLOAD = readFileSync('./src/utils/driveUpload.js', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');
const PROJECTS = readFileSync('./src/components/AppModules/projectsModule.jsx', 'utf8');
const DETAIL = readFileSync('./src/components/AppModules/projectDetailModule.jsx', 'utf8');
const NEXTCLOUD = readFileSync('./src/utils/nextcloud.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. La tombe : identité, unicité, portée ────────────────────────────── */
eq(S.mirrorDatasetKey({ id: 'ds1' }), 'id:ds1', 'l’identité d’un dataset est son id quand on le connaît');
eq(S.mirrorDatasetKey({ name: 'Pepper viruses' }), 'name:Pepper_viruses',
  '…et le nom slugé pour les datasets historiques (sans id)');
eq(S.mirrorDatasetKey({}), '', 'un dataset sans id ni nom n’a pas d’identité');

let m = S.emptyDriveMirror();
m = S.addDriveTombstone(m, { id: 'ds1', name: 'Pepper', path: '' }, 10);
eq(m.tombstones.length, 1, 'supprimer un dataset laisse une tombe');
ok(S.isDatasetMirrorDeleted(m, { id: 'ds1' }), '…et ce dataset est bien « supprimé »');
ok(!S.isDatasetMirrorDeleted(m, { name: 'Pepper' }),
  'un dataset SANS id n’est pas confondu avec une suppression faite sur un id (deux datasets peuvent porter le même titre)');
const sameTitleNew = S.addDriveTombstone(S.emptyDriveMirror(), { id: 'ds1', name: 'Pepper', path: '' }, 3);
ok(!S.isDatasetMirrorDeleted(sameTitleNew, { id: 'ds2', name: 'Pepper' }),
  'recréer un dataset du même titre après suppression n’est PAS bloqué : il doit pouvoir créer son dossier');
const legacy = S.addDriveTombstone(S.emptyDriveMirror(), { name: 'Old dataset', path: '' }, 4);
ok(S.isDatasetMirrorDeleted(legacy, { name: 'Old dataset' }),
  '…alors qu’une tombe HISTORIQUE (sans id, des deux côtés) compare bien les noms');
ok(!S.isDatasetMirrorDeleted(m, { id: 'ds2' }), 'un autre dataset n’est pas emporté');
ok(S.isDrivePathMirrorDeleted(m, { dataset: { id: 'ds1' }, path: 'projects/Aphids' }),
  'dataset supprimé ⇒ tout chemin à l’intérieur l’est aussi (le dossier ne se recrée pas)');
ok(!S.isDrivePathMirrorDeleted(m, { dataset: { id: 'ds1' }, path: '' }),
  '…mais la racine n’est pas « un dossier supprimé » (elle a sa propre tombe)');

const folderTomb = S.addDriveTombstone(S.emptyDriveMirror(),
  { id: 'ds1', name: 'Pepper', path: 'projects/Aphids', kind: 'project' }, 20);
ok(S.isDrivePathMirrorDeleted(folderTomb, { dataset: { id: 'ds1' }, path: 'projects/Aphids' }),
  'un dossier supprimé est protégé');
ok(S.isDrivePathMirrorDeleted(folderTomb, { dataset: { id: 'ds1' }, path: 'projects/Aphids/data' }),
  '…et tous ses descendants aussi');
ok(!S.isDrivePathMirrorDeleted(folderTomb, { dataset: { id: 'ds1' }, path: 'projects/Other' }),
  'un dossier voisin reste utilisable');
ok(!S.isDatasetMirrorDeleted(folderTomb, { id: 'ds1' }),
  'supprimer un DOSSIER ne supprime pas le dataset');

const twice = S.addDriveTombstone(S.addDriveTombstone(S.emptyDriveMirror(),
  { id: 'ds1', path: 'projects/A' }, 10), { id: 'ds1', path: 'projects/A' }, 30);
eq(twice.tombstones.length, 1, 'deux tombes de même identité n’en font qu’une');
eq(twice.tombstones[0].deletedAt, 30, '…et c’est la suppression la plus récente qui compte');
eq(S.normalizeDriveMirror({ tombstones: [[{ id: 'ds9', path: '' }]] }).tombstones.map((t) => t.id), ['ds9'],
  'une liste imbriquée (état abîmé) est comprise : une suppression ne se perd jamais en silence');

/* ── 2. Le registre des dossiers (renommer depuis n’importe quel poste) ─── */
let reg = S.rememberDatasetFolder(S.emptyDriveMirror(), { id: 'ds1', name: 'Pepper', folderId: 'F1' }, 5);
eq(S.findDatasetFolderId(reg, { id: 'ds1' }), 'F1', 'l’identifiant Drive du dossier est retenu par id');
reg = S.rememberProjectFolder(reg, {
  datasetId: 'ds1', datasetName: 'Pepper', projectName: 'Aphids', folderId: 'P1'
}, 6);
eq(S.findProjectFolderId(reg, { datasetId: 'ds1', projectName: 'Aphids' }), 'P1',
  '…et celui d’un dossier de projet est retenu lui aussi');
eq(S.findProjectFolderId(reg, { datasetId: 'ds1', datasetName: 'Pepper', projectName: 'Autre' }), '',
  'un projet inconnu n’a pas d’identifiant inventé');
eq(S.findProjectFolderId(S.forgetProjectFolder(reg, { datasetId: 'ds1', projectName: 'Aphids' }),
  { datasetId: 'ds1', projectName: 'Aphids' }), '',
  'oublier un dossier renommé est possible (sinon on écrirait dans le dossier invisible)');

const afterDelete = S.addDriveTombstone(reg, { id: 'ds1', name: 'Pepper', path: '' }, 40);
eq(Object.keys(afterDelete.datasets).length, 0, 'supprimer le dataset oublie son dossier');
eq(Object.keys(afterDelete.projects).length, 0, '…et ceux de ses projets');
const afterFolder = S.addDriveTombstone(reg, { id: 'ds1', name: 'Pepper', path: 'projects/Aphids' }, 41);
eq(S.findProjectFolderId(afterFolder, { datasetId: 'ds1', projectName: 'Aphids' }), '',
  'supprimer le dossier d’un projet oublie son identifiant (il est à la corbeille)');
eq(S.projectFolderPaths('Aphids'), ['projects/Aphids', 'Aphids'],
  'un projet a DEUX dossiers sur le Drive : projects/<projet> et <projet> (documents de section)');
eq(S.projectFolderPaths(''), ['projects/_unassigned'],
  'un projet sans nom ne désigne jamais la racine du dataset (aucune tombe en trop)');
eq(S.projectFolderPaths('projects'), ['projects/projects'],
  'un projet nommé comme un dossier PARTAGÉ du dataset ne met jamais le conteneur commun en tombe');
const afterRootFolder = S.addDriveTombstone(reg, { id: 'ds1', name: 'Pepper', path: 'Aphids' }, 42);
eq(S.findProjectFolderId(afterRootFolder, { datasetId: 'ds1', projectName: 'Aphids' }), '',
  '…et supprimer le dossier de SECTION oublie lui aussi l’identifiant du dossier de projet');

/* ── 3. Les tombes VOYAGENT : la fusion ne perd rien ────────────────────── */
const remote = S.normalizeDriveMirror({
  tombstones: [{ id: 'ds2', name: 'Aphids', path: '', deletedAt: 100 }],
  datasets: { 'id:ds2': { name: 'Aphids', folderId: 'F2', at: 100 } },
  projects: {}
});
const merged = S.mergeDriveMirrors(m, remote);
eq(merged.tombstones.map((t) => t.id).sort(), ['ds1', 'ds2'],
  'les suppressions de deux postes s’ADDITIONNENT (aucune n’est perdue)');
ok(S.isDatasetMirrorDeleted(merged, { id: 'ds2' }),
  'un dataset supprimé sur l’autre poste l’est ici aussi (même jamais vu)');
eq(S.findDatasetFolderId(merged, { id: 'ds2' }), 'F2',
  'le registre du Drive est adopté : on sait où vit le dossier, même jamais ouvert ici');
const older = S.normalizeDriveMirror({ datasets: { 'id:ds2': { name: 'Aphids', folderId: 'F9', at: 50 } } });
eq(S.findDatasetFolderId(S.mergeDriveMirrors(merged, older), { id: 'ds2' }), 'F2',
  'entre deux identifiants, le PLUS RÉCENT gagne');
eq(S.deletedDatasetMirrorIds(merged).has('ds2'), true,
  'les ids supprimés sont listables (pour filtrer une liste)');

/* ── 4. Lecture / écriture locales + notification ───────────────────────── */
S.writeDriveMirror(S.addDriveTombstone(S.emptyDriveMirror(), { id: 'ds7', path: '' }, 1), { notify: false });
eq(S.readDriveMirror().tombstones.map((t) => t.id), ['ds7'],
  'le miroir survit à un rechargement du navigateur');
dispatched.length = 0;
S.writeDriveMirror(S.emptyDriveMirror());
ok(dispatched.includes(S.DRIVE_MIRROR_EVENT),
  'une modification prévient l’application (le fichier d’état du Drive sera réécrit)');


/* ── 5. Le Drive suit : suppression et renommage d’un dataset ─────────────
   Le faux Drive est ARBORESCENT (« <parent>/<nom> »), comme le vrai : un projet
   y a bien DEUX dossiers — <dataset>/projects/<projet> pour ses expériences,
   ses figures et son document, et <dataset>/<projet> pour les documents de
   section (le dossier affiché sous « 📁 Drive location »). */
const fake = {
  calls: [],
  folders: new Map([
    ['ws/Pepper_viruses', 'F1'],
    ['F1/projects', 'PF'],
    ['PF/Aphids', 'P1'],          // <dataset>/projects/<projet>
    ['F1/Aphids', 'SEC1'],        // <dataset>/<projet> : documents de section
    ['F1/Submissions', 'SUB1']    // un autre dossier du dataset, à ne pas toucher
  ]),
  files: new Map([['P1/Aphids_document.json', 'DOC1']])
};
globalThis.__driveTestMocks = {
  driveToken: 'tok',
  cloud: true,
  ensureLabWorkspaceFolder: async () => 'ws',
  findFolderByName: async (name, parent) => {
    fake.calls.push(['findFolder', name, parent]);
    return fake.folders.get(`${parent}/${name}`) || '';
  },
  findDriveFileByName: async (name, parent) => {
    fake.calls.push(['findFile', name, parent]);
    return fake.files.get(`${parent}/${name}`) || '';
  },
  getDriveFileMeta: async (id) => ({ id: String(id), name: 'x', trashed: false }),
  trashDriveFile: async (id) => { fake.calls.push(['trash', id]); return true; },
  renameDriveFile: async (id, name) => { fake.calls.push(['rename', id, name]); return true; },
  uploadWorkspaceFile: async (arg) => (fake.calls.push(['upload', arg.folder, arg.name]), { id: 'u1', name: arg.name })
};

store.clear();
const del = await DRIVE.mirrorDeleteDataset({ id: 'ds1', name: 'Pepper viruses', extraNames: ['old title'] });
ok(del.ok, 'supprimer un dataset se termine correctement');
ok(fake.calls.some((c) => c[0] === 'trash' && c[1] === 'F1'),
  '…et le dossier Drive du dataset part à la corbeille');
ok(S.isDatasetMirrorDeleted(S.readDriveMirror(), { id: 'ds1' }),
  '…avec une tombe locale (donc aussi écrite dans l’état du Drive)');

fake.calls.length = 0;
store.clear();
const ren = await DRIVE.mirrorRenameDataset({ id: 'ds1', oldName: 'Pepper viruses', newName: 'Pepper 2026' });
ok(ren.ok, 'renommer un dataset se termine correctement');
ok(fake.calls.some((c) => c[0] === 'rename' && c[1] === 'F1' && c[2] === 'Pepper_2026'),
  '…le dossier est RENOMMÉ en place (jamais un second dossier créé à côté)');
eq(S.findDatasetFolderId(S.readDriveMirror(), { id: 'ds1' }), 'F1',
  '…et son identifiant reste connu pour les prochains postes');

/* Un dataset supprimé : plus de dossier, mais un compte rendu clair (jamais
   d’exception qui remonterait à l’interface). */
store.clear();
S.writeDriveMirror(S.addDriveTombstone(S.emptyDriveMirror(), { id: 'dsX', path: '' }, 1), { notify: false });
const renDeleted = await DRIVE.mirrorRenameDataset({ id: 'dsX', oldName: 'Gone', newName: 'New' });
ok(renDeleted.ok === false && !!renDeleted.reason,
  'renommer un dataset supprimé échoue proprement (aucune exception)');

/* ── 6. Projets : LES DEUX dossiers, leur document, suppression et renommage ─
   Le défaut réparé ici : seul <dataset>/projects/<projet> partait à la
   corbeille, et le dossier des DOCUMENTS DE SECTION (<dataset>/<projet>)
   restait sur le Drive — « si je supprime un projet, son dossier reste ». */
store.clear();
fake.calls.length = 0;
const projectDel = await DRIVE.mirrorDeleteProject({
  datasetId: 'ds1', datasetName: 'Pepper viruses', projectName: 'Aphids'
});
ok(projectDel.ok, 'supprimer un projet se termine correctement');
ok(fake.calls.some((c) => c[0] === 'trash' && c[1] === 'P1'),
  '…le dossier du projet part à la corbeille');
ok(fake.calls.some((c) => c[0] === 'trash' && c[1] === 'SEC1'),
  '…ET le dossier des documents de section (celui qui restait sur le Drive)');
eq(projectDel.folderIds.slice().sort(), ['P1', 'SEC1'], 'les deux dossiers mis à la corbeille sont annoncés');
ok(!fake.calls.some((c) => c[0] === 'trash' && c[1] === 'SUB1'),
  'un autre dossier du dataset n’est jamais emporté');
ok(S.isDrivePathMirrorDeleted(S.readDriveMirror(), { dataset: { id: 'ds1' }, path: 'projects/Aphids' }),
  '…et son chemin devient une tombe (il ne se recrée pas à la prochaine résolution)');
ok(S.isDrivePathMirrorDeleted(S.readDriveMirror(), { dataset: { id: 'ds1' }, path: 'Aphids' }),
  '…le dossier de section aussi : il ne réapparaît pas au prochain envoi');
ok(S.isDrivePathMirrorDeleted(S.readDriveMirror(), { dataset: { id: 'ds1' }, path: 'Aphids/Discussion' }),
  '…y compris les dossiers de section qu’il contient (la tombe couvre la descendance)');
ok(!S.isDrivePathMirrorDeleted(S.readDriveMirror(), { dataset: { id: 'ds1' }, path: 'Submissions' }),
  '…sans transformer les autres dossiers du dataset en dossiers fantômes');

store.clear();
fake.calls.length = 0;
const projectRen = await DRIVE.mirrorRenameProject({
  datasetId: 'ds1', datasetName: 'Pepper viruses', oldName: 'Aphids', newName: 'Aphids 2026'
});
ok(projectRen.ok, 'renommer un projet se termine correctement');
ok(fake.calls.some((c) => c[0] === 'rename' && c[1] === 'P1' && c[2] === 'Aphids_2026'),
  '…le dossier du projet est renommé');
ok(fake.calls.some((c) => c[0] === 'rename' && c[1] === 'DOC1' && c[2] === 'Aphids_2026_document.json'),
  '…et le document du projet (<projet>_document.json) suit le renommage');
ok(fake.calls.some((c) => c[0] === 'rename' && c[1] === 'SEC1' && c[2] === 'Aphids_2026'),
  '…et le dossier des documents de section suit lui aussi (sinon un second dossier apparaîtrait et les documents sembleraient perdus)');

/* Un projet nommé comme un dossier PARTAGÉ du dataset : seul SON dossier part à
   la corbeille — jamais le conteneur commun « projects ». */
store.clear();
fake.calls.length = 0;
const trickyDel = await DRIVE.mirrorDeleteProject({
  datasetId: 'ds1', datasetName: 'Pepper viruses', projectName: 'projects'
});
ok(trickyDel.ok && !fake.calls.some((c) => c[0] === 'trash' && c[1] === 'PF'),
  'supprimer un projet nommé « projects » ne met pas le conteneur commun à la corbeille');
ok(!S.isDrivePathMirrorDeleted(S.readDriveMirror(), { dataset: { id: 'ds1' }, path: 'projects/Aphids' }),
  '…et les autres projets du dataset restent visibles');


/* ── 7. Les branchements réels dans le code ─────────────────────────────── */
has(UPLOAD, "if (currentDatasetDeleted()) return '';",
  'driveUpload ne recrée pas le dossier d’un dataset supprimé');
has(UPLOAD, "if (datasetDirDeleted(dir)) { map[dir] = ''; continue; }",
  '…ni un sous-dossier (projects/, backups/…) supprimé — fini les dossiers qui réapparaissent');
has(UPLOAD, "throwCode('PATH_DELETED'",
  '…ni une branche de projet supprimée (le fichier n’est pas écrit dans un dossier fantôme)');
has(UPLOAD, '&& !deletedTarget', '…et la file de reprise ignore une cible supprimée');
has(UPLOAD, 'rememberProjectFolder(readDriveMirror(), {', 'le dossier d’un projet est enregistré (registre partagé)');
has(UPLOAD, 'rememberDatasetFolderId(saved, name);', 'le dossier du dataset est enregistré à chaque résolution');
has(APP, 'await mirrorDeleteDataset({', 'App.jsx met le dossier Drive à la corbeille quand un dataset est supprimé');
has(APP, 'await mirrorRenameDataset({ id, oldName: currentTitle, newName: clean })',
  'App.jsx renomme le dossier Drive quand un dataset est renommé');
has(APP, 'setDatasetsList((prev) => withoutDeletedDatasets(applyWorkspaceIndex({',
  'la liste des datasets écarte ceux qui ont une tombe, à chaque rafraîchissement');
has(PROJECTS, 'mirrorDeleteProject({', 'la liste des projets met le dossier Drive du projet à la corbeille');
has(DETAIL, 'mirrorDeleteProject({', 'la page projet aussi');
has(DETAIL, 'mirrorRenameProject({', 'renommer un projet renomme son dossier ET son document');
has(NEXTCLOUD, 'export const ncMove = async (fromUrl, toUrl)',
  'Nextcloud sait aussi renommer (WebDAV MOVE) : le miroir y est identique');

console.log(`✅ ${passed} tests passés (le Drive est le miroir du programme : rien ne ressuscite)`);
