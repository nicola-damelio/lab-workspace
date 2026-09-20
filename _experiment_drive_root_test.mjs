/* =========================================================================
   _experiment_drive_root_test.mjs — OÙ ATTERRIT L'ARCHIVE D'UNE EXPÉRIENCE.

   Le défaut constaté le 19/09/2026 : en important deux spectres 1D dans une
   expérience rattachée à un projet, le Drive recevait
       <dataset>/<projet>/…                 ← un dossier de projet À CÔTÉ de projects/
   au lieu de
       <dataset>/projects/<projet>/<expérience>/<instance>/data/Bruker_1r/…
   L'expérience semblait donc n'appartenir à aucun projet. Le ssNMR avait le
   même défaut, ainsi que « ⬆ Import test images from Drive » ; l'import CD
   (Jasco), lui, était correct (il n'envoie que `ctx`).

   Vérifié ici :
     1. canonicalizeExperimentPath (PUR) : ancienne forme → conteneur
        « projects », chemin déjà canonique → seul le projet change, chemin
        non-expérimental → intact ;
     2. le chemin construit par l'import Bruker (mêmes entrées que
        NMRSections.jsx / ssNMRSections.jsx) ;
     3. sur un FAUX Drive : la chaîne créée est bien sous projects/, et AUCUN
        dossier du nom du projet n'apparaît à la racine du dataset ;
     4. les contrats de code des appelants (NMR 1D, ssNMR, CD, migration,
        uploadLocalFile).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const NAMING = await import('./src/utils/driveNaming.js');
const read = (p) => readFileSync(p, 'utf8');

/* ── 1. La tête canonique d'un chemin d'expérience ───────────────────────── */
const CTX = { project: 'CD project', test: 'Exp 1', scientist: 'Nicolas', section: 'Data', subsection: 'Bruker 1r' };

/* La forme historique, telle que driveFolderPath la produit (ni « projects », ni
   sous-section : le dossier s'arrêtait à la section). */
const LEGACY = NAMING.driveFolderPath({ ...CTX, instance: 'file1' });
eq(LEGACY, ['CD_project', 'Exp_1', 'file1', 'Data'], 'driveFolderPath : la forme historique, sans conteneur');
ok(!LEGACY.includes(NAMING.PROJECTS_CONTAINER), '…elle ne contient PAS « projects » (d’où le dossier parasite)');
eq(NAMING.PROJECTS_CONTAINER, 'projects', 'le conteneur canonique est nommé « projects »');
eq(NAMING.DATASET_FOLDER_DIRS[0], NAMING.PROJECTS_CONTAINER, '…et c’est le premier conteneur canonique du dataset');

eq(NAMING.canonicalizeExperimentPath(LEGACY, CTX),
  ['projects', 'CD_project', 'Exp_1', 'file1', 'Data'],
  'l’ancienne forme reçoit le conteneur « projects »');

eq(NAMING.canonicalizeExperimentPath(['Test_74', 'instance1', 'image'], { test: 'Test 74' }),
  ['projects', 'test', 'Test_74', 'instance1', 'image'],
  'sans projet : le projet par DÉFAUT « test » (le bac « unassigned » n’existe plus)');

eq(NAMING.canonicalizeExperimentPath(['projects', 'P1', 'Exp', 'i1', 'data'], { test: 'Exp', projectNames: ['P1', 'P2'] }),
  ['projects', 'P1', 'Exp', 'i1', 'data'], 'un chemin canonique du 1er projet lié reste inchangé');
eq(NAMING.canonicalizeExperimentPath(['projects', 'P1', 'Exp', 'i1', 'data'], { test: 'Exp', projectNames: ['P2'] }),
  ['projects', 'P2', 'Exp', 'i1', 'data'], 'la copie du 2e projet suit le projet visé (pas celui du chemin)');

eq(NAMING.canonicalizeExperimentPath(['library', 'nmrExperiments'], {}),
  ['library', 'nmrExperiments'], 'un envoi sans expérience n’est jamais touché (bibliothèque)');
eq(NAMING.canonicalizeExperimentPath(['protocols', 'CD'], { protocol: 'CD' }),
  ['protocols', 'CD'], 'un protocole garde son conteneur');
eq(NAMING.canonicalizeExperimentPath(['CD_project', 'Discussion'], { project: 'CD project', section: 'Discussion' }),
  ['CD_project', 'Discussion'], 'un document de section de projet garde son dossier');
eq(NAMING.canonicalizeExperimentPath(null, CTX), [], 'aucun chemin ⇒ aucun changement');
eq(NAMING.canonicalizeExperimentPath([], CTX), [], 'chemin vide ⇒ vide');

/* ── 2. Le chemin réellement construit par l'import Bruker ───────────────── */
const BRUKER = { project: 'CD project', test: 'Exp 1', scientist: 'Nicolas', section: 'Data', subsection: 'Bruker 1r' };
const base = NAMING.canonicalExperimentPath({ ...BRUKER, instance: 'file1' });
eq(base, ['projects', 'CD_project', 'Exp_1', 'file1', 'data', 'Bruker_1r'],
  'la base de l’archive Bruker (import NMR 1D / ssNMR)');
eq(base[0], NAMING.PROJECTS_CONTAINER, '…et elle commence par le conteneur « projects »');
/* Le dossier « 1r » de l'expno, exactement comme le compose l'importateur :
   [...basePath, expno, ...sous-dossiers]. */
const expPath = [...base, NAMING.sanitizeSlug('10'), 'pdata', '1'];
eq(expPath, ['projects', 'CD_project', 'Exp_1', 'file1', 'data', 'Bruker_1r', '10', 'pdata', '1'],
  'le chemin complet du fichier 1r');
eq(NAMING.canonicalizeExperimentPath([NAMING.canonicalPageSection(expPath[0]), ...expPath.slice(1)], BRUKER), expPath,
  'un chemin déjà canonique traverse uploadLocalFile sans être modifié');
eq(NAMING.canonicalPageSection(expPath[0]), 'projects', 'le premier segment n’est jamais pris pour une section de page');

/* ── 3. Sur un FAUX Drive : la chaîne créée ──────────────────────────────── */
/* Chaque scénario a son arbre : un id de dossier, son nom, son parent. */
const makeDrive = () => {
  const folders = new Map();
  const files = new Map();
  let seq = 0;
  const mkId = (p) => `${p}${String(++seq).padStart(9, '0')}abcdefghij`;
  const addFolder = (name, parent) => { const id = mkId('f'); folders.set(id, { id, name, parent }); return id; };
  const childFolder = (name, parent) => [...folders.values()].find((f) => f.name === name && f.parent === parent) || null;
  /* resolveDrivePathFromNames : le PREMIER segment canonique (« projects ») est
     le conteneur partagé du dataset, les suivants sont créés au besoin. */
  const resolveNames = (names) => {
    let parent = 'root';
    const chain = [];
    for (const raw of names) {
      const name = String(raw);
      const found = childFolder(name, parent);
      parent = found ? found.id : addFolder(name, parent);
      chain.push(name);
    }
    return { leafId: parent, chain };
  };
  /* Ce que fait uploadLocalFile : `path` explicite → noms canoniques, une copie
     par projet lié (le nom du projet est remplacé à chaque copie). */
  const simulateUpload = ({ ctx, path, file }) => {
    const projects = ctx.test
      ? (NAMING.projectNamesOf(ctx).length ? NAMING.projectNamesOf(ctx) : [NAMING.DEFAULT_PROJECT_NAME])
      : [''];
    const targets = [];
    for (const projectName of projects) {
      const single = projectName
        ? { ...ctx, project: projectName, projectNames: [projectName] }
        : { ...ctx, project: '', projectNames: [] };
      const folderNames = Array.isArray(path) && path.length > 0
        ? NAMING.canonicalizeExperimentPath([NAMING.canonicalPageSection(path[0]), ...path.slice(1)], single)
        : NAMING.canonicalExperimentPath(single);
      const { leafId, chain } = resolveNames(folderNames);
      const id = mkId('d');
      files.set(id, { id, name: String(file), parent: leafId, chain: chain.join('/') });
      targets.push(chain.join('/'));
    }
    return targets;
  };
  return {
    folders, files, resolveNames, simulateUpload,
    fileChains: () => [...files.values()].map((f) => f.chain),
    rootNames: () => [...folders.values()].filter((f) => f.parent === 'root').map((f) => f.name)
  };
};

/* 3a. Témoin : l'ANCIENNE règle (le `path` brut, sans normalisateur). */
const before = makeDrive();
eq(before.resolveNames([NAMING.canonicalPageSection(LEGACY[0]), ...LEGACY.slice(1)]).chain,
  ['CD_project', 'Exp_1', 'file1', 'Data'], 'témoin : le chemin d’avant le correctif');
eq(before.rootNames(), ['CD_project'], 'témoin : l’ancien envoi posait le dossier du projet à la racine du dataset');

/* 3b. Le code corrigé : le fichier « 1r » de l'expno. */
const drive = makeDrive();
eq(drive.simulateUpload({ ctx: BRUKER, path: expPath, file: '1r' }),
  ['projects/CD_project/Exp_1/file1/data/Bruker_1r/10/pdata/1'],
  'le fichier est déposé sous projects/<projet>/<expérience>/<instance>/data/Bruker_1r/<expno>/pdata/1');
eq(drive.rootNames(), ['projects'], 'la racine du dataset ne reçoit QUE le conteneur « projects »');
ok(!drive.rootNames().includes('CD_project'), 'AUCUN dossier du nom du projet à la racine du dataset');
eq(drive.fileChains()[0].split('/')[0], 'projects', 'la chaîne du fichier commence par « projects »');

/* 3c. Fichier partagé entre deux projets liés : une copie SOUS CHAQUE projet. */
const shared = makeDrive();
eq(shared.simulateUpload({
  ctx: { ...BRUKER, project: 'CD project', projectNames: ['CD project', 'NMR project'] },
  path: expPath, file: '1r'
}), [
  'projects/CD_project/Exp_1/file1/data/Bruker_1r/10/pdata/1',
  'projects/NMR_project/Exp_1/file1/data/Bruker_1r/10/pdata/1'
], 'un fichier partagé atterrit sous CHAQUE projet lié (jamais deux fois sous le premier)');
eq(shared.rootNames(), ['projects'], '…et toujours sous projects/');

/* 3d. Expérience sans projet : le projet par DÉFAUT « test », jamais la racine. */
const orphan = makeDrive();
eq(orphan.simulateUpload({
  ctx: { test: 'Test 74', scientist: 'Nicolas', section: 'Data', subsection: 'Bruker 1r', instance: 'file1' },
  path: ['Test_74', 'file1', 'Data', '10', 'pdata', '1'], file: '1r'
}), ['projects/test/Test_74/file1/Data/10/pdata/1'], 'une expérience sans projet va dans projects/test');
ok(!orphan.rootNames().includes('Test_74'), '…sans laisser la moindre trace à la racine');

/* ── 4. Les contrats de code (ce qui a été corrigé ne peut pas revenir) ──── */
const NMR_SRC = read('./src/components/NMRSections.jsx');
const SSNMR_SRC = read('./src/components/ssNMRSections.jsx');
const CD_SRC = read('./src/components/CDSections.jsx');
const UPLOAD_SRC = read('./src/utils/driveUpload.js');
const MIGRATE_SRC = read('./src/utils/migrateTestImages.js');
const NAMING_SRC = read('./src/utils/driveNaming.js');

ok(/export const canonicalizeExperimentPath = \(path, ctx = \{\}\) =>/.test(NAMING_SRC),
  'driveNaming expose canonicalizeExperimentPath');
ok(UPLOAD_SRC.includes('canonicalizeExperimentPath('), 'uploadLocalFile normalise les chemins explicites');
ok(/folderNames = canonicalizeExperimentPath\(\s*\n\s*\[canonicalPageSection\(path\[0\]\), \.\.\.path\.slice\(1\)\], singleCtx/.test(UPLOAD_SRC),
  '…en préfixant « projects » avant la résolution du chemin');

ok(!/import \{[^}]*\bdriveFolderPath\b/.test(NMR_SRC), 'l’import NMR 1D ne tire plus driveFolderPath');
ok(NMR_SRC.includes('canonicalExperimentPath({ ...driveCtx, instance: instanceForFile })'),
  'l’import NMR 1D part du chemin canonique');
ok(/ctx: \{ \.\.\.driveCtx, instance: instanceForFile, expno: expNum \},/.test(NMR_SRC),
  '…et garde le contexte complet (projet, test, instance, expno)');

ok(!/import \{[^}]*\bdriveFolderPath\b/.test(SSNMR_SRC), 'l’import ssNMR ne tire plus driveFolderPath');
ok(SSNMR_SRC.includes('canonicalExperimentPath({ ...driveCtx, instance: instanceForFile })'),
  'l’import ssNMR part du chemin canonique');

/* L'import CD (Jasco) n'a jamais eu le défaut : il ne passe que `ctx`. */
const CD_CALL = "await uploadLocalFile({ name, mimeType: file.type || 'application/octet-stream', file, ctx: { ...driveCtx, instance: instanceForFile, title: base, suffix } });";
const cdAt = CD_SRC.indexOf(CD_CALL);
ok(cdAt > 0, 'l’import CD (Jasco) envoie avec `ctx` seul — donc par canonicalExperimentPath');
ok(cdAt > 0 && !CD_SRC.slice(cdAt, cdAt + 300).includes('path:'), '…sans aucun `path` explicite');

ok(MIGRATE_SRC.includes('const folderPathOf = (ctx) =>'), 'la migration des images de test route par folderPathOf');
ok(MIGRATE_SRC.includes('const folderPath = folderPathOf(ctx);'), '…et l’utilise pour le dossier visé');
ok(!/\.\.\.driveFolderPath\(ctx\)/.test(MIGRATE_SRC), 'plus aucun chemin d’expérience direct par driveFolderPath');

console.log(`_experiment_drive_root_test: ${passed} passed`);
