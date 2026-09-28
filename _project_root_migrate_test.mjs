/* =========================================================================
   _project_root_migrate_test.mjs — PLUS AUCUN DOSSIER DE PROJET À LA RACINE DU
   DATASET.

   Le défaut visé (signalé le 25/09/2026) : « je trouve des dossiers au nom d'un
   projet en dehors du dossier projects ». Les DOCUMENTS DE SECTION d'une page
   projet étaient envoyés dans `<dataset>/<projet>/<section>` — un SECOND dossier
   de projet, à côté de `projects/`, alors que la structure déclarée du dataset
   n'admet que projects / general_library_images / backups / protocols / storage /
   publications.

   Vérifié ici :
     1. la ROUTE des documents de section : `projects/<projet>/<section>`, dans
        le dossier du projet comme ses expériences, ses figures et son document,
        et l'étiquette affichée qui suit (aucun dossier hors de `projects/`) ;
     2. la RECONNAISSANCE d'un dossier de projet resté à la racine (nom d'un
        dossier déjà dans `projects/`, ou contenu fait de sections de projet) et
        le refus de toucher un conteneur partagé ou un dossier incompris ;
     3. le DÉMÉNAGEMENT sur un FAUX Drive : déplacement des dossiers de section,
        FUSION dans un dossier déjà existant, non-écrasement d'un fichier en
        double, dossier vidé mis à la corbeille + PIERRE TOMBALE du chemin
        abandonné (donc plus jamais recréé) ;
     4. le câblage : App.jsx lance le geste une fois par dataset.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage / window minimaux : les modules testés sont ceux du
   navigateur, et la pierre tombale du chemin abandonné se vérifie en le relisant
   (voir _drive_mirror_test.mjs, même bouchon). */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

/* ── 1. La route des documents de section ────────────────────────────────── */
const NAMING = await import('./src/utils/driveNaming.js');
const NAMING_SRC = readFileSync('src/utils/driveNaming.js', 'utf8');
const PROJ = readFileSync('src/components/AppModules/projectDetailModule.jsx', 'utf8');
const APP = readFileSync('src/App.jsx', 'utf8');

eq(NAMING.projectSectionFolderPath('CD project', 'Discussion'), ['projects', 'CD_project', 'Discussion'],
  'un document de section vit DANS projects/<projet>/<section>');
eq(NAMING.projectSectionFolderPath('CD project', 'Results and Discussion'), ['projects', 'CD_project', 'Discussion'],
  '…et l’alias historique du dossier de section est conservé (un seul dossier par section)');
eq(NAMING.projectSectionFolderLabel('CD project', 'Discussion', 'My dataset'),
  'My_dataset / projects / CD_project / Discussion',
  'l’emplacement affiché ne peut donc plus désigner un dossier hors de projects/');
eq(NAMING.driveFolderPath({ project: 'CD project', section: 'Discussion' }), ['projects', 'CD_project', 'Discussion'],
  'la route de l’envoi (driveFolderPath) est la même que celle de l’étiquette');
eq(NAMING.driveFolderPath({ project: 'CD project', test: 'Exp 1', section: 'data' }), ['CD_project', 'Exp_1', 'data'],
  'un chemin d’EXPÉRIENCE par cette fonction ne bouge pas (canonicalExperimentPath est sa route)');
eq(NAMING.driveFolderPath({ project: '', section: 'Discussion' }), ['Discussion'],
  'sans projet connu, rien n’est inventé');
ok(!NAMING.projectSectionFolderPath('CD project', 'Discussion').includes('CD_project__'),
  'aucun segment mal formé dans la route');

/* ── 2. Reconnaître un dossier de projet resté à la racine ───────────────── */
eq(NAMING.isProjectSectionFolderName('Discussion'), true, '« Discussion » est un dossier de section de projet');
eq(NAMING.isProjectSectionFolderName('🔬 Scientific background'), true,
  '…comme le titre complet de « Scientific background » (emoji compris)');
eq(NAMING.isProjectSectionFolderName('Supporting information'), true, '…et « Supporting information »');
eq(NAMING.isProjectSectionFolderName('Random'), false, 'un dossier quelconque n’en est pas un');
eq(NAMING.isProjectSectionFolderName(''), false, 'un nom vide non plus');

const MIG = await import('./src/utils/projectRootMigrate.js');
eq(MIG.looksLikeProjectSectionFolder({ name: 'CD_project', childNames: [], isKnownProject: true }), true,
  'un dossier du même nom qu’un dossier de projects/ est le doublon du projet');
eq(MIG.looksLikeProjectSectionFolder({ name: 'CD_project', childNames: ['Discussion'] }), true,
  '…et un dossier dont le contenu est fait de sections de projet aussi');
eq(MIG.looksLikeProjectSectionFolder({ name: 'Random_folder', childNames: ['misc'] }), false,
  'un dossier incompris n’est PAS touché (on ne range pas au hasard)');
eq(MIG.looksLikeProjectSectionFolder({ name: 'projects', childNames: ['CD_project'], isKnownProject: true }), false,
  'un conteneur partagé du dataset n’est jamais candidat');
eq(MIG.looksLikeProjectSectionFolder({ name: 'general_library_images', childNames: ['Background'] }), false,
  '…même quand il contient un dossier de section par hasard');
eq(MIG.looksLikeProjectSectionFolder({ name: '', childNames: ['Background'] }), false, 'un dossier sans nom non plus');
eq(MIG.projectRootMigratedFlagKey('ds1'), 'labProjectRootMigrated::ds1',
  'le drapeau « déjà fait » est propre à chaque dataset');

/* ── 3. Le déménagement sur un FAUX Drive ────────────────────────────────── */
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT = 'ds_root';

/** Un faux Drive arborescent : dossiers, fichiers, corbeille (récursive).
 *  `datasetId`/`datasetName` changent de dataset d'un scénario à l'autre — les
 *  tombes d'un dataset ne concernent QUE lui (voir la fin du scénario 4). */
const makeDrive = ({ datasetId = 'ds1', datasetName = 'My_dataset' } = {}) => {
  const nodes = new Map();
  let seq = 0;
  const mkId = (p) => `${p}${String(++seq).padStart(6, '0')}`;
  const folder = (name, parent) => {
    const id = mkId('d');
    nodes.set(id, { id, name, mimeType: FOLDER_MIME, parent, trashed: false });
    return id;
  };
  const file = (name, parent) => {
    const id = mkId('f');
    nodes.set(id, { id, name, mimeType: 'application/pdf', parent, trashed: false });
    return id;
  };
  const live = (parentId) => [...nodes.values()].filter((n) => n.parent === parentId && !n.trashed);
  const api = {
    driveToken: 'fake-token',
    cloud: true,
    ensureDriveFolder: async () => ROOT,
    // ⚠ Le bouchon du crochet lit ces deux-là comme des VALEURS (voir
    // _esm_test_hook.mjs : `getDriveRootId = () => M().driveRootId || ''`).
    driveRootId: datasetId,
    driveRootName: datasetName,
    listDriveChildren: async (parentId) => live(parentId).map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType })),
    findFolderByName: async (name, parentId) => {
      const hit = live(parentId).find((n) => n.mimeType === FOLDER_MIME && n.name === name);
      return hit ? hit.id : '';
    },
    findDriveFileByName: async (name, parentId) => {
      const hit = live(parentId).find((n) => n.mimeType !== FOLDER_MIME && n.name === name);
      return hit ? hit.id : '';
    },
    findOrCreateFolder: async (name, parentId) => (await api.findFolderByName(name, parentId)) || folder(name, parentId),
    canonicalDatasetDirId: async (dir) => (await api.findFolderByName(dir, ROOT)) || folder(dir, ROOT),
    moveDriveFile: async (id, parentId) => {
      const node = nodes.get(id);
      if (!node) return false;
      node.parent = parentId;
      return true;
    },
    trashDriveFile: async (id) => {
      const node = nodes.get(id);
      if (!node) return false;
      node.trashed = true;
      live(id).forEach((child) => { nodes.get(child.id).trashed = true; });
      return true;
    }
  };
  globalThis.__driveTestMocks = api;
  return { nodes, folder, file, live, api, pathOf: (id) => {
    const names = [];
    let node = nodes.get(id);
    while (node && node.id !== ROOT) { names.unshift(node.name); node = nodes.get(node.parent); }
    return names.join('/');
  } };
};
globalThis.__driveTestMocks = {};

/* ── 4. Les sections d'un projet rentrent dans `projects/` ──────────────── */
/** Le dataset tel qu'il est sur un Drive touché par le défaut :
 *    <dataset>/projects/                                  ← le conteneur
 *    <dataset>/projects/CD_project/images, Exp_1          ← le projet
 *    <dataset>/CD_project/Discussion, Background          ← LE DÉFAUT
 *    <dataset>/Random_folder/misc.pdf                     ← incompris
 *    + des conteneurs partagés (à ne jamais toucher) */
const buildTouchyDataset = () => {
  const drive = makeDrive();
  const projectsId = drive.folder('projects', ROOT);
  const projectId = drive.folder('CD_project', projectsId);
  drive.folder('images', projectId);
  drive.folder('Exp_1', projectId);
  const general = drive.folder('general_library_images', ROOT);
  const protocols = drive.folder('protocols', ROOT);
  const legacyRoot = drive.folder('CD_project', ROOT);
  const legacyDiscussion = drive.folder('Discussion', legacyRoot);
  const legacyDoc = drive.file('report_CD_project_Nicolas.pdf', legacyDiscussion);
  const legacyBackground = drive.folder('Background', legacyRoot);
  const legacyIntro = drive.file('intro.docx', legacyBackground);
  const randomFolder = drive.folder('Random_folder', ROOT);
  const randomFile = drive.file('misc.pdf', randomFolder);
  return { drive, ids: {
    projectsId, projectId, general, protocols, legacyRoot, legacyDiscussion, legacyDoc,
    legacyBackground, legacyIntro, randomFolder, randomFile
  } };
};

const first = buildTouchyDataset();
const report1 = await MIG.migrateProjectRootFolders();
eq(report1.reason, '', 'le déménagement aboutit');
eq(report1.moved, ['CD_project/Discussion', 'CD_project/Background'],
  'les dossiers de section du projet sont DÉPLACÉS (dans l’ordre du Drive)');
eq(report1.kept, ['Random_folder'], 'un dossier incompris est LAISSÉ en place — et annoncé');
eq(report1.trashed, ['CD_project'], 'la racine vidée part à la corbeille');
eq(first.drive.nodes.get(first.ids.legacyDiscussion).parent, first.ids.projectId,
  'le dossier « Discussion » est maintenant DANS le dossier du projet');
eq(first.drive.nodes.get(first.ids.legacyBackground).parent, first.ids.projectId,
  '…comme « Background »');
eq(first.drive.pathOf(first.ids.legacyDoc), 'projects/CD_project/Discussion/report_CD_project_Nicolas.pdf',
  'le document reste à sa place relative (les liens enregistrés continuent de viser le même fichier)');
eq(first.drive.pathOf(first.ids.legacyIntro), 'projects/CD_project/Background/intro.docx',
  '…et le second dossier de section suit le même chemin');
eq(first.drive.nodes.get(first.ids.legacyRoot).trashed, true, 'le dossier au nom du projet a disparu de la racine');
eq(first.drive.nodes.get(first.ids.general).trashed, false, 'les conteneurs partagés du dataset sont intacts');
eq(first.drive.nodes.get(first.ids.protocols).trashed, false, '…tous');
eq(first.drive.nodes.get(first.ids.projectsId).trashed, false, '…y compris projects/');
eq(first.drive.live(ROOT).map((n) => n.name).sort(), ['Random_folder', 'general_library_images', 'projects', 'protocols'],
  'à la racine ne restent que les conteneurs — et ce qui n’a pas été compris');

/* Le chemin abandonné est mis en PIERRE TOMBALE : un envoi qui le recalculerait
   est refusé (c’est ce test-là qu’applique le vrai resolveDrivePathFromNames). */
const MIRROR = await import('./src/utils/driveMirrorStore.js');
const mirror = MIRROR.readDriveMirror();
eq(MIRROR.isDrivePathMirrorDeleted(mirror, { dataset: { id: 'ds1', name: 'My_dataset' }, path: 'CD_project' }), true,
  'le chemin abandonné est une tombe : plus rien ne le recrée');
eq(MIRROR.isDrivePathMirrorDeleted(mirror, { dataset: { id: 'ds1', name: 'My_dataset' }, path: 'projects' }), false,
  '…mais le dossier du projet, lui, reste bien vivant');
eq(first.drive.nodes.get(first.ids.randomFile).trashed, false,
  'le contenu du dossier incompris n’est ni déplacé ni supprimé');

/* ── 5. Un dossier de section déjà présent dans le projet : FUSION ──────── */
/** Même dataset, mais le projet a DÉJÀ un dossier « Discussion » (des documents
 *  envoyés après le correctif) : les fichiers de la racine l’y rejoignent, en
 *  écrasant rien. */
const merger = () => {
  // Un AUTRE dataset : les tombes du précédent ne le concernent pas.
  const drive = makeDrive({ datasetId: 'ds2', datasetName: 'Other_dataset' });
  const projectsId = drive.folder('projects', ROOT);
  const projectId = drive.folder('CD_project', projectsId);
  const keptFolder = drive.folder('Discussion', projectId);
  const existing = drive.file('another-Nicolas.pdf', keptFolder);
  const legacyRoot = drive.folder('CD_project', ROOT);
  const legacySection = drive.folder('Discussion', legacyRoot);
  const legacyDoc = drive.file('report_CD_project_Nicolas.pdf', legacySection);
  return { drive, ids: { projectId, keptFolder, existing, legacyRoot, legacySection, legacyDoc } };
};

const mix = merger();
const report2 = await MIG.migrateProjectRootFolders();
eq(report2.merged, ['CD_project/Discussion/report_CD_project_Nicolas.pdf'],
  'un fichier d’un dossier déjà présent est FUSIONNÉ dans celui du projet');
eq(report2.moved, [], '…sans déplacer le dossier lui-même');
eq(mix.drive.nodes.get(mix.ids.legacyDoc).parent, mix.ids.keptFolder,
  'le document est maintenant dans le dossier « Discussion » du projet');
eq(mix.drive.nodes.get(mix.ids.existing).trashed, false, 'le document déjà en place est INTACT');
eq(report2.trashed, ['CD_project/Discussion', 'CD_project'],
  'le dossier de section vidé et la racine vidée partent à la corbeille');

/* ── 6. Un fichier en double : on n’écrase JAMAIS ───────────────────────── */
/** Cette fois le projet a déjà un `report.pdf` portant le MÊME nom : le fichier
 *  de la racine est LAISSÉ, annoncé — et son dossier ne peut donc pas partir. */
const clashMaker = () => {
  const drive = makeDrive({ datasetId: 'ds3', datasetName: 'Third_dataset' });
  const projectsId = drive.folder('projects', ROOT);
  const projectId = drive.folder('CD_project', projectsId);
  const keptFolder = drive.folder('Discussion', projectId);
  const keptDoc = drive.file('report.pdf', keptFolder);
  const legacyRoot = drive.folder('CD_project', ROOT);
  const legacySection = drive.folder('Discussion', legacyRoot);
  const legacyDoc = drive.file('report.pdf', legacySection);
  return { drive, ids: { projectId, keptFolder, keptDoc, legacyRoot, legacySection, legacyDoc } };
};

const clash = clashMaker();
const report3 = await MIG.migrateProjectRootFolders();
eq(report3.kept, ['CD_project/Discussion/report.pdf', 'CD_project/Discussion', 'CD_project'],
  'un nom déjà pris est LAISSÉ, et ce qui reste est annoncé (dossier puis racine)');
eq(report3.moved, [] , 'rien n’a été déplacé');
eq(clash.drive.nodes.get(clash.ids.legacyDoc).parent, clash.ids.legacySection,
  'le fichier en double est resté où il était');
eq(clash.drive.nodes.get(clash.ids.keptDoc).trashed, false, '…et le document du projet est intact');
eq(clash.drive.nodes.get(clash.ids.legacyRoot).trashed, false,
  'un dossier qui porte encore quelque chose n’est JAMAIS mis à la corbeille');

/* ── 7. Sans Drive : rien n’est tenté, et le rapport le dit ─────────────── */
globalThis.__driveTestMocks = { cloud: false };
const offline = await MIG.migrateProjectRootFolders();
eq(offline.reason, 'no-drive', 'hors connexion, le geste est reporté — et annoncé');
eq(offline.moved, [], '…et rien n’est déplacé');

/* ── 8. Le câblage (sources) ─────────────────────────────────────────────── */
const MIG_SRC = readFileSync('src/utils/projectRootMigrate.js', 'utf8');
ok(APP.includes("import { migrateProjectRootFoldersOnce } from './utils/projectRootMigrate';"),
  'App.jsx importe le déménagement');
ok(APP.includes('.then(() => migrateProjectRootFoldersOnce())'),
  '…et le lance quand le Drive est prêt, une fois par dataset');
ok(MIG_SRC.includes('lastUploadQueueInfo') === false, 'le module ne touche pas à la file de reprise');
ok(MIG_SRC.includes('addDriveTombstone('), 'le chemin abandonné est mis en pierre tombale');
ok(MIG_SRC.includes('isDrivePathMirrorDeleted(readDriveMirror()'),
  '…et un chemin déjà supprimé n’est pas « réparé »');
ok(MIG_SRC.includes('export const projectRootMigratedFlagKey'), 'le drapeau « déjà fait » est exposé (vérifiable)');
ok(NAMING_SRC.includes('export const isProjectSectionFolderName'),
  'driveNaming sait reconnaître un dossier de section de projet');
ok(NAMING_SRC.includes("segs.push(PROJECTS_CONTAINER, projectSeg);"),
  'un document de projet (sans expérience) reçoit le conteneur « projects/ »');
ok(PROJ.includes("const sectionDrivePath = (label) => projectSectionFolderPath(project.name || '', label);"),
  'la page projet calcule le dossier Drive d’une section avec la MÊME route que l’envoi');

console.log(`_project_root_migrate_test: ${passed} passed`);
