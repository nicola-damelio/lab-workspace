/* =========================================================================
   _experiment_folder_files_test.mjs — LIRE LE DOSSIER DE L'EXPÉRIENCE.

   Défaut visé (signalé) : un fichier BIEN PRÉSENT dans le dossier de
   l'expérience sur le Drive — topologie `.gro` / `.pdb`, trajectoire `.xtc` /
   `.trr` — n'était jamais vu si son NOM ne correspondait pas à ce qui était
   déclaré : la reprise automatique cherche par nom
   (`name contains '<radical>'`), par nom déposé et par pointeur (voir
   utils/driveRestore.js). Un fichier DÉPOSÉ À LA MAIN n'a aucun de ces noms.

   Ce que vérifie cette suite :

     • la LECTURE DU DOSSIER (utils/driveExperimentFiles.js) : on résout les
       dossiers canoniques de l'expérience — exactement ceux que l'archivage
       crée — et on remonte d'un cran à la fois (sous-section → section →
       instance → expérience) ;
     • RIEN N'EST CRÉÉ (`{ create: false }`) et on ne sort JAMAIS de
       l'expérience (jamais `projects/`, jamais une expérience voisine) ;
     • seuls les FICHIERS des extensions voulues : les dossiers et les autres
       fichiers de la même boîte sont écartés ;
     • le fichier choisi devient le DÉFAUT de la condition : la page écrit le
       nom déclaré ET le pointeur (`…DriveName` + `…Drive`), et n'oublie pas de
       vider l'ancien `structureFileData` / `structureSrc`.

   Les VRAIS modules sont importés contre un FAUX Drive (le crochet
   _esm_test_hook.mjs remplace src/utils/driveUpload.js).
   ========================================================================= */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

const NAMING = await import('./src/utils/driveNaming.js');
const slug = NAMING.sanitizeSlug;

/* ── UN FAUX DRIVE : des dossiers par CHEMIN (slugué comme sur le Drive) ──── */
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const childrenOf = new Map();     // chemin slugué → ses enfants
const requested = [];             // les chemins demandés, dans l'ordre
const createFlags = [];           // le drapeau `create` reçu à chaque résolution
const listed = [];                // les dossiers réellement lus
const folderNode = (id, name) => ({ id, name, mimeType: FOLDER_MIME });
const fileNode = (id, name, size = 0, modifiedTime = '') => ({ id, name, size, modifiedTime, mimeType: 'application/octet-stream' });
const addFolder = (path, children = []) => {
  childrenOf.set(path.map(slug).join('/'), children);
  return path.map(slug).join('/');
};

/* 1. L'ARCHIVAGE NORMAL : …/cond1/experiment_setup/Structure */
addFolder(['projects', 'MD project', 'Exp 1', 'cond1', 'experiment setup', 'Structure'], [
  folderNode('DIR1', 'archive'),                       // un dossier n'est pas un fichier
  fileNode('TXT1', 'notes.txt', 40, '2026-02-01T00:00:00Z'),   // mauvaise extension
  fileNode('GRO1', 'sim1_Nicola.gro', 16, '2026-01-01T00:00:00Z')
]);
/* 2. LA MÊME TOPOLOGIE UN CRAN PLUS HAUT : …/cond2/experiment_setup */
addFolder(['projects', 'MD project', 'Exp 1', 'cond2', 'experiment setup'], [
  fileNode('GRO2', 'byhand.gro', 19, '2026-01-03T00:00:00Z')
]);
/* 3. LA TRAJECTOIRE POSÉE À LA MAIN dans le dossier de la CONDITION :
      …/cond3, sous un nom qui ne ressemble à RIEN de déclaré */
addFolder(['projects', 'MD project', 'Exp 1', 'cond3'], [
  fileNode('XTC1', 'run3.xtc', 900000, '2026-01-04T00:00:00Z')
]);
/* 4. LA BRANCHE DU VIEWER 3D : …/cond4/data/Structure */
addFolder(['projects', 'MD project', 'Exp 1', 'cond4', 'data', 'Structure'], [
  fileNode('PDB1', 'viewer_upload.pdb', 2200, '2026-01-05T00:00:00Z')
]);
/* 5. LE DOSSIER DE L'EXPÉRIENCE, et L'EXPÉRIENCE VOISINE (jamais lue) */
addFolder(['projects', 'MD project', 'Exp 1'], [
  fileNode('XTC2', 'exp_level.xtc', 500000, '2026-01-06T00:00:00Z')
]);
addFolder(['projects', 'MD project', 'Other exp', 'cond3'], [
  fileNode('OTHER', 'other.xtc', 1, '2026-01-07T00:00:00Z')
]);

globalThis.__driveTestMocks = {
  driveToken: 'fake-token',
  cloud: true,
  resolveDrivePathFromNames: async (names, opts) => {
    const key = (names || []).map(slug).join('/');
    requested.push(key);
    createFlags.push(!!(opts && opts.create));
    if (!childrenOf.has(key)) return { leafId: '', path: [] };
    return { leafId: `F_${key}`, path: names.map((n) => ({ name: slug(n), id: `F_${key}` })) };
  },
  listDriveChildren: async (folderId) => {
    const key = String(folderId || '').replace(/^F_/, '');
    listed.push(key);
    return childrenOf.get(key) || [];
  },
  // AUCUNE recherche par nom ne donne quoi que ce soit : le fichier déposé à la
  // main n'a aucun nom à reconnaître (c'est tout le défaut signalé).
  driveFetch: async () => ({ ok: true, status: 200, json: async () => ({ files: [] }) })
};

const FILES = await import('./src/utils/driveExperimentFiles.js');
const MDSRC = readFileSync('src/components/MDSections.jsx', 'utf8');
const PICKER_SRC = readFileSync('src/components/DriveExperimentFiles.jsx', 'utf8');
const NMRSRC = readFileSync('src/components/NMRSections.jsx', 'utf8');
const MODULE_SRC = readFileSync('src/utils/driveExperimentFiles.js', 'utf8');

/* ══ 1. LA LOGIQUE PURE ════════════════════════════════════════════════════ */

eq(FILES.driveFileExt('sim1.xtc'), 'xtc', 'l’extension est lue telle quelle');
eq(FILES.driveFileExt('SIM1.XTC'), 'xtc', '…sans tenir compte de la casse');
eq(FILES.driveFileExt('run.tar.gz'), 'gz', 'seule la DERNIÈRE extension compte');
eq(FILES.driveFileExt('noext'), '', 'un nom sans extension n’en a pas');
eq(FILES.driveFileExt(''), '', '…même vide');

eq(FILES.normalizeFileExts(['.XTC', 'trr', 'trr', '', '.gro']), ['xtc', 'trr', 'gro'],
  'les extensions voulues sont normalisées une fois : point tombé, minuscules, sans doublon');
eq(FILES.fileHasExt('sim1_Nicola.gro', FILES.MD_TOPOLOGY_EXTS), true, 'une topologie est reconnue par son extension');
eq(FILES.fileHasExt('run3.xtc', FILES.MD_TOPOLOGY_EXTS), false, '…et une trajectoire n’est PAS proposée comme topologie');
eq(FILES.fileHasExt('run3.xtc', FILES.MD_TRAJECTORY_EXTS), true, 'la trajectoire est reconnue comme trajectoire');
eq(FILES.fileHasExt('notes.txt', FILES.MD_TRAJECTORY_EXTS), false, 'un fichier de notes n’est jamais proposé');

eq(FILES.isDriveFolderNode({ id: 'D', mimeType: FILES.GOOGLE_FOLDER_MIME }), true, 'un dossier est reconnu comme dossier');
eq(FILES.isDriveFolderNode({ id: 'F', mimeType: 'application/octet-stream' }), false, 'un fichier n’en est pas un');
eq(FILES.isDriveFolderNode(null), false, '…et rien du tout non plus');

/* Les dossiers candidats : ceux de l'archivage, du plus précis au plus large. */
const MD_CTX = { project: 'MD project', test: 'Exp 1', instance: 'cond1', scientist: 'Nico', section: 'Setup', subsection: 'Structure' };
eq(FILES.experimentFolderPathsOf(MD_CTX), [
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'experiment setup', 'Structure'],
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'experiment setup'],
  ['projects', 'MD_project', 'Exp_1', 'cond1'],
  ['projects', 'MD_project', 'Exp_1']
], 'la lecture part du dossier canonique (celui que l’archivage fabrique) et remonte UN CRAN à la fois');
eq(FILES.experimentFolderPathsOf({ project: 'MD project' }), [], 'sans expérience, aucun dossier d’expérience');
ok(FILES.experimentFolderPathsOf(MD_CTX).every((p) => p.length >= 3),
  '…et aucun cran ne sort de l’expérience (le conteneur projects/ n’est jamais un candidat)');
eq(FILES.experimentFolderPathsOf(MD_CTX, { levels: 1 }).length, 1, 'on peut demander le dossier exact seulement');

/* Les DEUX branches de nommage (page MD « Setup » / viewer 3D « Data »). */
const DATA_CTX = { ...MD_CTX, section: 'Data' };
eq(FILES.experimentFolderCandidates({ ctx: MD_CTX, ctxs: [DATA_CTX] }), [
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'experiment setup', 'Structure'],
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'experiment setup'],
  ['projects', 'MD_project', 'Exp_1', 'cond1'],
  ['projects', 'MD_project', 'Exp_1'],
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'data', 'Structure'],
  ['projects', 'MD_project', 'Exp_1', 'cond1', 'data']
], 'un fichier déposé sous « Setup » OU sous « Data » est vu : les deux branches sont lues, sans doublon');

eq(FILES.sortExperimentFiles([
  { name: 'a.gro', modifiedTime: '2025-01-01T00:00:00Z' },
  { name: 'c.gro', modifiedTime: '2026-01-01T00:00:00Z' },
  { name: 'b.gro', modifiedTime: '2025-06-01T00:00:00Z' }
]).map((f) => f.name), ['c.gro', 'b.gro', 'a.gro'], 'le plus récent d’abord (le fichier qu’on vient de déposer)');
eq(FILES.sortExperimentFiles([
  { name: 'b.gro', modifiedTime: '' }, { name: 'a.gro', modifiedTime: '' }
]).map((f) => f.name), ['a.gro', 'b.gro'], 'à date égale, l’ordre alphabétique');

eq(FILES.describeDriveFileSize(900), '900 B', 'une petite taille est lisible telle quelle');
eq(FILES.describeDriveFileSize(2048), '2.0 KB', '…et une grosse en Ko / Mo / Go');
eq(FILES.describeDriveFileSize(500000000), '477 MB', 'une trajectoire de 500 Mo s’annonce en MB');

eq(FILES.experimentFilePointer({ id: 'X1', name: 'run3.xtc', url: 'https://drive.google.com/file/d/X1/view' }),
  { id: 'X1', name: 'run3.xtc', url: 'https://drive.google.com/file/d/X1/view' },
  'le pointeur d’un fichier choisi garde son id EXACT (insensible à un renommage)');
eq(FILES.experimentFilePointer({ name: 'run3.xtc' }), null, 'sans identifiant, aucun pointeur n’est posé');
eq(FILES.experimentFilePointer(null), null, '…et rien du tout ne pose rien');

/* ══ 2. LA LECTURE DU DOSSIER, SUR UN FAUX DRIVE ═══════════════════════════ */

const mdCtx = (instance, subsection, section = 'Setup') => ({ ...MD_CTX, instance, section, subsection });
const keyOf = (path) => path.map(slug).join('/');
const trace = () => { requested.length = 0; createFlags.length = 0; listed.length = 0; };
const STRUCT1 = keyOf(['projects', 'MD project', 'Exp 1', 'cond1', 'experiment setup', 'Structure']);

/* (a) Le dossier canonique porte le fichier : UNE lecture suffit. */
trace();
const exact = await FILES.listExperimentFiles({ ctx: mdCtx('cond1', 'Structure'), exts: FILES.MD_TOPOLOGY_EXTS });
eq(exact.files.map((f) => f.name), ['sim1_Nicola.gro'], 'le fichier DÉPOSÉ dans le dossier canonique est trouvé');
eq(exact.path, ['projects', 'MD_project', 'Exp_1', 'cond1', 'experiment setup', 'Structure'], '…et la page sait DE QUEL dossier il vient');
eq(exact.folderId, `F_${STRUCT1}`, '…identifiant du dossier compris');
eq(exact.files[0].folderPathText, STRUCT1, 'chaque ligne porte son dossier (c’est là qu’on dépose les suivants)');
eq(exact.files[0].size, 16, 'la taille reçue est rendue telle quelle');
eq(requested, [STRUCT1], 'UNE seule lecture : le dossier exact portait une correspondance');
eq(createFlags, [false], 'le dossier est CHERCHÉ, jamais créé (create:false)');
eq(listed, [STRUCT1], '…et rien d’autre n’a été lu');
ok(!exact.files.some((f) => f.name === 'notes.txt' || f.name === 'archive' || f.id === 'DIR1'),
  'les autres fichiers du dossier et les SOUS-DOSSIERS ne sont pas proposés');

/* (b) Le dossier exact n'existe pas : on remonte d'un cran. */
trace();
const oneUp = await FILES.listExperimentFiles({ ctx: mdCtx('cond2', 'Structure'), exts: FILES.MD_TOPOLOGY_EXTS });
eq(oneUp.files.map((f) => f.name), ['byhand.gro'], 'un fichier posé UN CRAN plus haut (le dossier de la section) est trouvé');
eq(oneUp.path, ['projects', 'MD_project', 'Exp_1', 'cond2', 'experiment setup'], '…et la ligne dit que c’est le dossier de la section');
eq(requested, [
  keyOf(['projects', 'MD project', 'Exp 1', 'cond2', 'experiment setup', 'Structure']),
  keyOf(['projects', 'MD project', 'Exp 1', 'cond2', 'experiment setup'])
], '…après avoir cherché le dossier exact, puis remonté d’un cran');
eq(createFlags, [false, false], 'aucun dossier n’est créé pour autant');

/* (c) LE DÉFAUT SIGNALÉ : une trajectoire déposée à la main, sous un nom qui
   ne ressemble à rien de déclaré. Aucune recherche par nom ne la donne
   (driveFetch du faux Drive ne rend JAMAIS rien). */
trace();
const traj = await FILES.listExperimentFiles({ ctx: mdCtx('cond3', 'Trajectory'), exts: FILES.MD_TRAJECTORY_EXTS });
eq(traj.files.map((f) => f.name), ['run3.xtc'], 'une trajectoire DÉPOSÉE À LA MAIN est trouvée — la recherche par nom, elle, n’en sait rien');
eq(traj.path, ['projects', 'MD_project', 'Exp_1', 'cond3'], '…elle est prise dans le dossier de la CONDITION');
eq(requested.length, 3, 'trois crans : sous-section absente, section absente, condition trouvée');
ok(!requested.includes(keyOf(['projects', 'MD project', 'Exp 1'])), 'le dernier cran (dossier de l’expérience) n’est même pas atteint');

/* (d) Les deux nommages de l'app : la page archive sous « Setup », les
   commandes du viewer 3D sous « Data ». Un fichier de la branche « Data »
   doit se voir aussi. */
trace();
const viaData = await FILES.listExperimentFiles({
  ctx: mdCtx('cond4', 'Structure'),
  ctxs: [mdCtx('cond4', 'Structure', 'Data')],
  exts: FILES.MD_TOPOLOGY_EXTS
});
eq(viaData.files.map((f) => f.name), ['viewer_upload.pdb'], 'la branche « Data » du viewer 3D est regardée aussi');
eq(viaData.path, ['projects', 'MD_project', 'Exp_1', 'cond4', 'data', 'Structure'], '…et le fichier est pris là où il est');
eq(requested[requested.length - 1], keyOf(['projects', 'MD project', 'Exp 1', 'cond4', 'data', 'Structure']),
  '…après avoir épuisé la branche « Setup »');

/* (e) LA LIMITE : on ne sort jamais de l'expérience. */
trace();
const wide = await FILES.listExperimentFiles({ ctx: mdCtx('cond5', 'Trajectory'), exts: FILES.MD_TRAJECTORY_EXTS });
eq(wide.files.map((f) => f.name), ['exp_level.xtc'], 'un fichier posé dans le dossier de l’EXPÉRIENCE est trouvé (dernier cran)');
eq(requested.length, 4, '4 crans au plus : sous-section, section, instance, expérience');
ok(requested.every((p) => p.split('/').length >= 3), 'on ne lit JAMAIS au-dessus de l’expérience (projects/ n’est pas demandé)');
ok(!listed.some((p) => p.includes('Other_exp')), 'l’expérience VOISINE n’est jamais lue (ses fichiers ne sont pas proposés)');

/* (f) Rien à faire : Drive éteint, aucune extension voulue, Nextcloud. */
trace();
globalThis.__driveTestMocks.driveToken = null;
const noToken = await FILES.listExperimentFiles({ ctx: mdCtx('cond1', 'Structure'), exts: FILES.MD_TOPOLOGY_EXTS });
globalThis.__driveTestMocks.driveToken = 'fake-token';
eq(noToken.files, [], 'Drive non connecté : aucune liste (jamais une erreur)');
const noExts = await FILES.listExperimentFiles({ ctx: mdCtx('cond1', 'Structure'), exts: [] });
eq(noExts.files, [], 'sans extension voulue, il n’y a rien à chercher');
eq(requested, [], '…et aucune requête n’est tentée dans ces deux cas');
globalThis.localStorage = { getItem: () => 'nextcloud', setItem: () => {}, removeItem: () => {} };
const onNextcloud = await FILES.listExperimentFiles({ ctx: mdCtx('cond1', 'Structure'), exts: FILES.MD_TOPOLOGY_EXTS });
delete globalThis.localStorage;
eq(onNextcloud.files, [], 'Nextcloud : la lecture de dossier n’existe pas — aucune liste inventée');
eq(requested, [], '…et aucune requête Drive n’est tentée');

/* (g) Le même fichier vu dans deux dossiers de la remontée : UNE seule fois,
   du plus récent au plus ancien. */
addFolder(['projects', 'MD project', 'Exp 1', 'cond1', 'experiment setup'], [
  fileNode('GRO1', 'sim1_Nicola.gro', 16, '2026-01-01T00:00:00Z'),   // le MÊME fichier
  fileNode('GRO3', 'older.gro', 10, '2025-12-01T00:00:00Z')
]);
trace();
const whole = await FILES.listExperimentFiles({
  ctx: mdCtx('cond1', 'Structure'), exts: FILES.MD_TOPOLOGY_EXTS, stopWhenFound: false
});
eq(whole.files.map((f) => f.name), ['sim1_Nicola.gro', 'older.gro'],
  'sans arrêt au premier dossier : les fichiers de toute la remontée, du plus récent au plus ancien');
eq(whole.files.filter((f) => f.id === 'GRO1').length, 1, 'le même fichier vu dans DEUX dossiers n’est proposé qu’une fois');
eq(whole.path, exact.path, 'le dossier affiché reste le plus PRÉCIS où le fichier a été vu');
eq(whole.files[0].folderPathText, STRUCT1, '…et la ligne garde ce dossier-là');

/* ══ 3. LE CÂBLAGE DES MODULES ══════════════════════════════════════════════ */

ok(MODULE_SRC.includes('export const listExperimentFiles = async ({'),
  'le module rend la lecture du dossier d’une expérience');
ok(MODULE_SRC.includes('const resolved = await resolveDrivePathFromNames(path, { create: false });'),
  '…en CHERCHANT le dossier, jamais en le créant');
ok(MODULE_SRC.includes("if (getCloudProvider() === 'nextcloud') return empty;"),
  '…et sans rien inventer pour Nextcloud (pas de lecture de dossier là-bas)');
ok(MODULE_SRC.includes('export const experimentFilePointer = (file = null) => ('),
  'le POINTEUR du fichier choisi est fabriqué par le module (id + nom + url)');

ok(existsSync('src/components/DriveExperimentFiles.jsx'), 'le geste a son composant');
ok(PICKER_SRC.includes("import { downloadCloudFile, sameRawFileFor } from '../utils/driveRestore';"),
  'il télécharge par le noyau partagé (corbeille et jeton compris)…');
ok(PICKER_SRC.includes('const res = await listExperimentFiles({ ctx, ctxs, exts: wanted })'),
  '…après avoir LISTÉ le dossier de l’expérience');
ok(PICKER_SRC.includes('await onPick?.(downloaded, file);'),
  '…et il rend le fichier téléchargé À LA PAGE (avec sa ligne de Drive)');
ok(PICKER_SRC.includes('↻ Reload'),
  'la liste se recharge à la demande (un fichier déposé après coup est vu sans recharger la page)');
ok(PICKER_SRC.includes('Google Drive is not connected in this browser'),
  '…et dit quand Drive est éteint (une lecture impossible ne se lit pas « le dossier est vide »)');

ok(MDSRC.includes("import { DriveExperimentFilePicker } from './DriveExperimentFiles';"),
  'la page MD monte le geste');
ok(MDSRC.includes('import { experimentFilePointer, MD_TOPOLOGY_EXTS, MD_TRAJECTORY_EXTS } from \'../utils/driveExperimentFiles\';'),
  '…avec les extensions de topologie et de trajectoire du module');
eq((MDSRC.match(/<DriveExperimentFilePicker/g) || []).length, 2,
  'DEUX boutons : un pour la topologie, un pour la trajectoire');
ok(MDSRC.includes('const pickStructureFromFolder = async (file, meta) => {'), 'la topologie choisie est installée par la page');
ok(MDSRC.includes('const pickTrajectoryFromFolder = async (file, meta) => {'), '…la trajectoire aussi');
ok(MDSRC.includes('wantedName: \'\', file, paint })'),
  'le fichier choisi garde SON nom (on ne le renomme pas au nom déclaré d’hier)');
ok(MDSRC.includes('structureDriveName: meta.name || restored.name,'),
  'le NOM DÉCLARÉ devient celui du fichier choisi (c’est lui que la reprise cherchera)');
ok(MDSRC.includes('trajectoryDriveName: meta.name || restored.name,'), '…pour la trajectoire aussi');
ok(MDSRC.includes('...(pointer ? { structureDrive: pointer } : {})'),
  'le POINTEUR du fichier choisi est posé sur la condition (id exact)');
ok(MDSRC.includes('...(pointer ? { trajectoryDrive: pointer } : {})'), '…et pour la trajectoire');
ok(/structureFileData: null,\s+\/\/ le fichier déclaré a changé/.test(MDSRC),
  'l’ancien data URL (petite topologie) est écarté : il ne décrit plus le fichier déclaré');
ok(/structureSrc: null,\s+\/\/ un PDB ID/.test(MDSRC),
  'un PDB ID / une URL d’hier ne l’emporte pas sur le fichier choisi');
ok(MDSRC.includes("const mdFolderCtxs = (subsection) => [mdFolderCtx(subsection, 'Data')];"),
  'les deux nommages de l’app sont lus (Setup de la page, Data du viewer 3D)');

/* Non-régression : la reprise AUTOMATIQUE ne bouge pas d'un pouce. */
ok(MDSRC.includes("const restoreMDFile = async ({ pointer = null, driveName = '', nameStem = '', suffix = '', ctx = {} }) => {"),
  'la reprise par nom / pointeur reste en place');
ok(MDSRC.includes('await restoreTrajectoryFromDrive();') && MDSRC.includes('await restoreStructureFromDrive();'),
  '…et les deux reprises automatiques sont toujours branchées');

/* La MÊME lecture sert le PDB de la page NMR (structure). */
ok(NMRSRC.includes("import { DriveExperimentFilePicker } from './DriveExperimentFiles';"),
  'la page NMR monte le même geste (le PDB de la condition)');
eq((NMRSRC.match(/<DriveExperimentFilePicker/g) || []).length, 1, 'un bouton : le PDB, sous la vue 3D');
ok(NMRSRC.includes('const pickNmrStructureFromFolder = async (file, meta) => {'),
  '…et la page NMR installe le PDB choisi');
ok(/pickNmrStructureFromFolder = async[\s\S]{0,2000}?structureDriveName: meta.name \|\| restored.name,/.test(NMRSRC),
  '…en le DÉCLARANT (nom) sur la condition');
ok(/pickNmrStructureFromFolder = async[\s\S]{0,2000}?structureDrive: pointer/.test(NMRSRC),
  '…et en posant son pointeur (id exact)');
ok(/pickNmrStructureFromFolder = async[\s\S]{0,2000}?await blobStore\.save\(nmrStructBlobKey\(testId\), restored\)/.test(NMRSRC),
  '…et en le rangeant dans la base du navigateur (il survit au rechargement)');
ok(NMRSRC.includes('ctx={nmrStructDriveCtx(activeTest)}'),
  'la lecture part du dossier canonique de l’expérience NMR (Data/Structure)');

const TESTS = readFileSync('probe_tests.txt', 'utf8');
ok(TESTS.includes('_experiment_folder_files_test.mjs'),
  'la suite est inscrite dans probe_tests.txt (elle est rejouée avec les autres)');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
ok(pkg.scripts && typeof pkg.scripts.lint === 'string', 'oxlint reste le linter du dépôt');

console.log(`_experiment_folder_files_test: ${passed} passed`);




