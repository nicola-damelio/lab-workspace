/* =========================================================================
   _common_library_folder_test.mjs — OÙ VIT LA BIBLIOTHÈQUE COMMUNE, ET OÙ ELLE
   A DÉMÉNAGÉ.

   Avant : les figures sans projet vivaient dans `projects/unassigned/images` —
   un « projet » qui n'en était pas un, partagé avec les expériences sans projet.
   Maintenant :

       <dataset>/general_library_images   ← la bibliothèque COMMUNE : un dossier de
                                            PREMIER NIVEAU du dataset (à côté de
                                            `projects/`), qui porte les figures
                                            DIRECTEMENT — ce dossier EST le dossier
                                            d'images, il n'y a pas d'`images` dedans ;
       <dataset>/projects/test/<test>     ← une expérience sans projet (« le projet
                                            par défaut », `DEFAULT_PROJECT_NAME`).

   Ce que l'on vérifie ici (voir src/utils/figuresFolder.js et
   src/utils/commonLibraryMigrate.js) :
     a. les helpers PURS : les noms de la bibliothèque commune, le chemin tel que
        l'écran le montre, et la règle « on ne devine pas » ;
     b. une lecture la trouve par son NOM, sur un poste sans miroir, et lit ses
        figures (compositions comprises) — rien n'est créé ;
     c. l'ANCIEN emplacement (`projects/unassigned/images`) reste LU : aucune
        figure ne se perd entre le déménagement et la lecture ;
     d. quand les deux existent, c'est le dossier PEUPLÉ qui gagne ;
     e. la portée COMMUNE n'adopte JAMAIS le dossier d'un projet ;
     f. la forme des sources (le contrat que les écrans attendent) ;
     g. la MIGRATION : le dossier `images` du bac DEVIENT
        `<dataset>/general_library_images` (même identifiant, donc mêmes
        fichiers), les expériences du bac vont dans `projects/test/…`, le bac vidé
        part à la corbeille — et tout est rejouable sans rien écraser.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window minimaux (comme les autres sondes) ─────────────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { search: '' }
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };

/* ── Un faux Drive : dossier du dataset, `projects/`, un bac par scénario ──── */
let nodes = new Map();
let seq = 0;
const addFolder = (name, parent) => { const id = `F${++seq}`; nodes.set(id, { id, name, parent, kind: 'folder' }); return id; };
const addFile = (name, parent, mimeType = 'image/png') => { const id = `X${++seq}`; nodes.set(id, { id, name, parent, kind: 'file', mimeType }); return id; };
const childrenOf = (parent) => [...nodes.values()]
  .filter((n) => n.parent === parent)
  .map((n) => ({ id: n.id, name: n.name, mimeType: n.kind === 'folder' ? 'application/vnd.google-apps.folder' : n.mimeType }));
const folderIdNamed = (name, parent) => {
  const hit = [...nodes.values()].find((n) => n.parent === parent && n.name === name && n.kind === 'folder');
  return hit ? hit.id : '';
};

/* Les gestes d'écriture du Drive : ils sont COMPTÉS, donc vérifiables. */
let moves = [];
let renames = [];
let trashed = [];
let creations = [];

/* Le sidecar de chaque figure déposée (texte relu par downloadDriveFileText). */
const sidecarText = new Map();
const addFigure = (leaf, base) => {
  addFile(`${base}.jpg`, leaf, 'image/jpeg');
  const side = addFile(`${base}.jpg.meta.json`, leaf, 'application/json');
  sidecarText.set(side, JSON.stringify({
    kind: 'lab-workspace/figure-meta', v: 1, label: base, src: null,
    canvasData: { canvasW: 20, canvasH: 20, gridCols: 1, gridRows: 1, canvasKey: `cv_${base}`, objects: [] },
    imageName: `${base}.jpg`, savedAt: '2026-09-13T00:10:30.906Z'
  }));
};


/** Un dataset NEUF :
 *   • `common` — la bibliothèque COMMUNE : `['Fig1', …]` pose un dossier de
 *     premier niveau `general_library_images` avec ces figures dedans, `[]` le
 *     pose VIDE, `null` (défaut) ne le pose pas du tout ;
 *   • `buckets` — des dossiers sous `projects/` (`{ name, figures, tests }`) :
 *     chacun avec son dossier `images` et, pour `tests`, des dossiers
 *     d'expérience.
 *  @returns {{ leaves:Record<string,string>, common:string, root:string,
 *              projects:string }} les identifiants utiles. */
const buildDataset = ({ common = null, buckets = [] } = {}) => {
  nodes = new Map();
  seq = 0;
  sidecarText.clear();
  moves = [];
  renames = [];
  trashed = [];
  creations = [];
  const ds = addFolder('My_dataset', '');
  const projects = addFolder('projects', ds);
  const leaves = {};
  let commonLeaf = '';
  if (common) {
    commonLeaf = addFolder('general_library_images', ds);
    common.forEach((base) => addFigure(commonLeaf, base));
  }
  buckets.forEach((b) => {
    const folder = addFolder(String(b.name), projects);
    const images = addFolder('images', folder);
    (b.figures || []).forEach((base) => addFigure(images, base));
    (b.tests || []).forEach((t) => addFolder(String(t), folder));
    leaves[String(b.name)] = images;
  });
  return { leaves, common: commonLeaf, root: ds, projects };
};

let allowCreation = false;
globalThis.__driveTestMocks = {
  cloud: true,
  driveToken: 'tok',
  driveRootId: 'DS1',
  driveRootName: 'My dataset',
  dataUrlToBlob: () => ({}),
  ensureDriveFolder: async () => folderIdNamed('My_dataset', '') || addFolder('My_dataset', ''),
  ensureLabWorkspaceFolder: async () => 'WS',
  getDriveFileMeta: async (id) => {
    const n = nodes.get(String(id));
    return n ? { id: n.id, name: n.name, trashed: false, parents: [] } : { id: '', name: '', trashed: true, parents: [] };
  },
  findFolderByName: async (name, parent) => folderIdNamed(String(name), String(parent)),
  listFoldersByName: async (name, parent) => [...nodes.values()]
    .filter((n) => n.kind === 'folder' && n.parent === String(parent) && n.name === String(name))
    .map((n) => ({ id: n.id, name: n.name })),
  listDriveChildren: async (parent) => childrenOf(String(parent)),
  findDriveFileByName: async (name, parent) => {
    const hit = [...nodes.values()].find((n) => n.parent === String(parent) && n.name === String(name));
    return hit ? hit.id : '';
  },
  downloadDriveFileText: async (id) => sidecarText.get(String(id)) || '',
  canonicalDatasetDirId: async (dir, opts = {}) => {
    const root = String((opts && opts.rootId) || '');
    const id = folderIdNamed(String(dir), root);
    if (id) return id;
    if (!allowCreation) return '';
    creations.push(`+${String(dir)}`);
    return addFolder(String(dir), root);
  },
  findOrCreateFolder: async (name, parent) => {
    const found = folderIdNamed(String(name), String(parent));
    if (found) return found;
    creations.push(`+${String(name)}`);
    if (!allowCreation) throw new Error(`findOrCreateFolder appelé (${name}) — une LECTURE ne crée rien`);
    return addFolder(String(name), String(parent));
  },
  resolveDrivePathFromNames: async (names) => {
    const wanted = (names || []).map((n) => String(n));
    creations.push(wanted.join('/'));
    if (!allowCreation) throw new Error(`resolveDrivePathFromNames appelé (${wanted.join('/')}) — une LECTURE ne crée rien`);
    let parent = folderIdNamed('My_dataset', '') || addFolder('My_dataset', '');
    for (const name of wanted) {
      let id = folderIdNamed(name, parent);
      if (!id) id = addFolder(name, parent);
      parent = id;
    }
    return { leafId: parent, path: wanted.map((n) => ({ name: n, id: n })) };
  },
  /* Les gestes d'un DÉMÉNAGEMENT (utils/commonLibraryMigrate.js) : un
     déplacement et un renommage gardent l'IDENTIFIANT, donc les liens et les
     index qui visent le fichier / le dossier continuent de fonctionner. */
  moveDriveFile: async (id, parent) => {
    const n = nodes.get(String(id));
    if (!n) return false;
    moves.push(n.name);
    n.parent = String(parent);
    return true;
  },
  renameDriveFile: async (id, name) => {
    const n = nodes.get(String(id));
    if (!n) return false;
    renames.push(`${n.name}→${String(name)}`);
    n.name = String(name);
    return true;
  },
  trashDriveFile: async (id) => {
    const n = nodes.get(String(id));
    if (!n) return false;
    trashed.push(n.name);
    nodes.delete(String(id));
    return true;
  },
  uploadLocalFile: async (arg) => ({ id: `UP${arg && arg.name}`, name: arg && arg.name, driveUrl: 'https://drive.google.com/file/d/UP/view' })
};

const FOLDER = await import('./src/utils/figuresFolder.js');
const LIB = await import('./src/utils/figuresLibrary.js');
const NAMING = await import('./src/utils/driveNaming.js');
const MIG = await import('./src/utils/commonLibraryMigrate.js');
const FOLDER_SRC = readFileSync('src/utils/figuresFolder.js', 'utf8');
const NAMING_SRC = readFileSync('src/utils/driveNaming.js', 'utf8');

let checks = 0;
/* `deepEqual` (assert/strict = comparaison profonde STRICTE) : certaines
   vérifications portent sur des LISTES (`commonLibraryFolderNames()`,
   `projectImagesFolderPath('')`), et `assert.equal` comparerait leurs
   références. */
const eq = (a, b, msg) => { checks += 1; assert.deepStrictEqual(a, b, msg); };
const ok = (v, msg) => { checks += 1; assert.ok(v, msg); };

/* ── a. PUR : les noms de la bibliothèque COMMUNE, et son chemin ───────────── */
eq(FOLDER.commonLibraryFolderNames(), ['general_library_images', 'unassigned', '_unassigned'],
  'la bibliothèque commune se cherche sous son nom d’aujourd’hui, puis sous les anciens');
eq(FOLDER.commonLibraryFolderName(), 'general_library_images', 'le nom du dossier commun');
eq(FOLDER.legacyCommonFolderNames(), ['unassigned', '_unassigned'], 'les noms HISTORIQUES, encore lus');
eq(FOLDER.isCommonLibraryName('general_library_images'), true, 'le nom d’aujourd’hui est la bibliothèque commune');
eq(FOLDER.isCommonLibraryName('Unassigned'), true, '…et l’ancien nom, au séparateur/casse près');
eq(FOLDER.isCommonLibraryName('Projet_A'), false, 'un projet n’est pas la bibliothèque commune');
eq(FOLDER.isLegacyCommonFolderName('_unassigned'), true, '`_unassigned` est un nom HISTORIQUE');
eq(FOLDER.isLegacyCommonFolderName('general_library_images'), false, '…pas le nom d’aujourd’hui');
eq(FOLDER.imagesFolderPathOnDrive(''), 'general_library_images',
  'la bibliothèque commune vit à la RACINE du dataset — ce dossier EST le dossier d’images');
eq(FOLDER.imagesFolderPathOnDrive('CD project'), 'projects/CD_project/images', 'un projet garde le slug de son nom');
eq(NAMING.projectImagesFolderPath(''), ['general_library_images'], '…et c’est le chemin d’ÉCRITURE');
eq(NAMING.projectImagesFolderPath('CD project'), ['projects', 'CD_project', 'images'], 'celui d’un projet reste sous projects/');
eq(NAMING.projectImagesFolderLabel('', 'My dataset'), 'My_dataset / general_library_images',
  'l’écran montre le dossier de la bibliothèque commune, tel que le Drive le nomme');
eq(NAMING.projectImagesFolderLabel('CD project', 'My dataset'), 'My_dataset / projects / CD_project / images',
  'l’étiquette d’un projet ne change pas');
eq(NAMING.DEFAULT_PROJECT_NAME, 'test', 'le projet par défaut est « test »');
ok(NAMING.DATASET_FOLDER_DIRS.indexOf(NAMING.GENERAL_LIBRARY_DIR) > 0,
  'la bibliothèque commune fait partie de la structure du dataset');

/* La bibliothèque commune est une CONVENTION, pas une supposition : elle se
   reconnaît même sans nom de projet (score 3), mais deux candidats équivalents
   → on demande. */
eq(FOLDER.pickFiguresFolder(
  [{ name: 'Projet_A', imagesId: 'I1', files: 9 }, { name: 'general_library_images', imagesId: 'I2', files: 1 }], ''
).name, 'general_library_images', 'portée commune : la bibliothèque est retenue (score 3) même si elle a moins de fichiers');
eq(FOLDER.pickFiguresFolder(
  [{ name: 'unassigned', imagesId: 'I1', files: 1 }, { name: 'Projet_A', imagesId: 'I2', files: 9 }], ''
).name, 'unassigned', '…et son ANCIEN nom désigne le même dossier');
eq(FOLDER.pickFiguresFolder(
  [{ name: 'general_library_images', imagesId: 'I1', files: 1 }, { name: 'unassigned', imagesId: 'I2', files: 1 }], ''
), null, 'deux candidats équivalents → on montre la liste au lieu de deviner');
eq(FOLDER.pickFiguresFolder([{ name: 'Projet_A', imagesId: 'I1', files: 9 }], ''), null,
  'un dossier de projet n’est jamais pris pour la bibliothèque commune');
eq(FOLDER.pickFiguresFolder(
  [{ name: 'Canvas_18_09', imagesId: 'I1', files: 2 }, { name: 'Autre', imagesId: 'I2', files: 1 }], 'Canvas 19/09'
), null, 'la règle « on ne devine pas » des projets est intacte');

/* ── b. Un poste NEUF (aucun miroir) trouve la bibliothèque commune ────────── */
store.clear();
allowCreation = false;
const A = buildDataset({ common: ['Fig1', 'Fig2'], buckets: [{ name: 'Projet_A', figures: ['Autre'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
ok(!store.has('labDriveMirror'), 'poste neuf : le miroir du Drive est vide (rien n’a encore été retenu)');
const foundCommon = await FOLDER.findProjectFiguresFolder('');
eq(foundCommon.leafId, A.common, 'la bibliothèque commune est TROUVÉE par son nom, à la racine du dataset');
eq(foundCommon.via, 'name', '…par la recherche du nom réel');
eq(foundCommon.name, 'general_library_images', '…et son nom est celui du Drive');
eq(foundCommon.folder, 'general_library_images', 'le chemin annoncé est celui que le Drive montre');
eq(foundCommon.exact, true, 'le dossier est bien celui de cette portée');

const pulledCommon = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(pulledCommon.error, '', 'la lecture de la bibliothèque commune ne se plaint pas d’un dossier absent');
eq(pulledCommon.via, 'name', 'elle dit comment le dossier a été trouvé');
eq(pulledCommon.folder, 'general_library_images', '…et où il est vraiment');
eq(pulledCommon.found, 2, 'les deux figures de la bibliothèque sont vues');
eq(pulledCommon.added, 2, '…et ajoutées à la bibliothèque commune');
eq(pulledCommon.restored, 2, 'leurs compositions éditables reviennent avec elles');
eq(creations.length, 0, 'AUCUN dossier créé : cette lecture ne fabrique rien');
eq(childrenOf(A.common).length, 4, 'figures et sidecars sont bien DANS le dossier de la racine');

/* ── c. L’ANCIEN emplacement reste LU (rien ne se perd avant la migration) ─── */
store.clear();
const B = buildDataset({ buckets: [{ name: 'unassigned', figures: ['Ancienne'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const legacy = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(legacy.folder, 'projects/unassigned/images', 'un bac `unassigned` (emplacement d’avant) reste lu');
eq(legacy.added, 1, '…et ses figures aussi');
eq(creations.length, 0, 'toujours aucun dossier créé');
ok(B.leaves.unassigned.length > 0, 'le faux Drive porte bien le dossier historique');

store.clear();
buildDataset({ buckets: [{ name: '_unassigned', figures: ['Canonique'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const legacyCanonical = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(legacyCanonical.folder, 'projects/_unassigned/images', 'le nom CANONIQUE `_unassigned` aussi');
eq(legacyCanonical.added, 1, '…avec ses figures');

/* ── d. Les DEUX emplacements existent : le PEUPLÉ gagne ───────────────────── */
store.clear();
const C = buildDataset({ common: [], buckets: [{ name: 'unassigned', figures: ['Trainee'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const twin = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(twin.folder, 'projects/unassigned/images',
  'un dossier du nouveau nom mais VIDE ne fait pas oublier les figures de l’ancien');
eq(twin.added, 1, '…elles sont bien ramenées');
eq(childrenOf(C.common).length, 0, 'le dossier vide est bien vide');
ok(!!C.common, '…et il existe bel et bien sur le Drive');

store.clear();
const D = buildDataset({ common: ['Recente'], buckets: [{ name: 'unassigned', figures: ['Trainee'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const twin2 = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(twin2.folder, 'general_library_images', 'quand le nouveau dossier porte des figures, c’est LUI qui est lu');
eq(twin2.added, 1, '…et une seule figure est ramenée');
eq(LIB.readLibrary().map((i) => i.label), ['Recente'], '…celle du dossier lu, pas celle du bac historique');
eq(D.common === D.leaves.unassigned, false, 'les deux dossiers sont bien distincts dans le faux Drive');

/* ── e. La portée COMMUNE n’adopte JAMAIS le dossier d’un projet ──────────── */
store.clear();
buildDataset({ common: [], buckets: [{ name: 'Projet_A', figures: ['Fig_du_projet'] }] });
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const commonEmpty = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(commonEmpty.added, 0, 'aucune figure de projet n’entre dans la bibliothèque commune');
eq(LIB.readLibrary().length, 0, 'la bibliothèque commune reste vide');
eq(creations.length, 0, 'et aucun dossier n’est créé pour autant');
/* Le projet, lui, continue d’être lu par son nom. */
const projFolder = await FOLDER.findProjectFiguresFolder('Projet A');
eq(projFolder.via, 'name', 'le dossier du projet est toujours trouvé par son nom');
eq(projFolder.folder, 'projects/Projet_A/images', '…dans son propre dossier');
eq(projFolder.name, 'Projet_A', '…et non dans la bibliothèque commune');

/* ── f. Forme des sources (le contrat que les écrans attendent) ───────────── */
ok(FOLDER_SRC.includes('export const commonLibraryFolderNames = () =>'),
  'figuresFolder expose les noms de la bibliothèque commune');
ok(FOLDER_SRC.includes('export const legacyCommonFolderNames = () =>'),
  '…et ceux d’avant, encore LUS');
ok(FOLDER_SRC.includes('if (!wanted) return findCommonFiguresFolder();'),
  'la portée commune a son propre résolveur (elle n’est pas un dossier de projet)');
ok(!FOLDER_SRC.includes('unassignedFolderNames'),
  'plus aucun appel à l’ancien helper de nom (il a été remplacé, pas doublé)');
ok(NAMING_SRC.includes("export const GENERAL_LIBRARY_DIR = 'general_library_images'"),
  'le nom du dossier commun est une CONSTANTE du rangement');
ok(NAMING_SRC.includes("export const DEFAULT_PROJECT_NAME = 'test'"),
  '…comme le projet par défaut des expériences sans projet');
ok(NAMING_SRC.includes("? ['projects', sanitizeSlug(projectName), 'images']"),
  'la bibliothèque d’un projet est toujours projects/<projet>/images');

/* ── g. LA MIGRATION : le bac `unassigned` est vidé, une fois pour toutes ──── */
allowCreation = true;

/* g1. Le déménagement complet : la bibliothèque, les expériences, le bac. */
const A1 = buildDataset({ buckets: [{ name: 'unassigned', figures: ['Fig1'], tests: ['Test_74'] }] });
const rep = await MIG.migrateCommonLibrary();
eq(rep.reason, '', 'la migration va au bout');
eq(rep.libraryId, A1.leaves.unassigned, 'le dossier `images` du bac EST devenu la bibliothèque (même identifiant)');
eq(folderIdNamed('general_library_images', A1.root), A1.leaves.unassigned,
  '…il est à la racine du dataset, sous le nouveau nom');
eq(folderIdNamed('images', A1.leaves.unassigned), '', '…et il n’est plus un dossier `images` dans le bac');
eq(renames, ['images→general_library_images'], 'le renommage est explicite');
eq(childrenOf(A1.leaves.unassigned).length, 2, 'les figures et leur sidecar sont toujours DANS ce dossier');
const defaultProjectId = folderIdNamed('test', A1.projects);
ok(!!defaultProjectId, 'le projet par défaut `test` a été créé sous projects/');
eq(nodes.get(folderIdNamed('Test_74', defaultProjectId)).name, 'Test_74',
  'l’expérience du bac est passée dans projects/test');
eq(rep.moved, ['Test_74'], '…et la migration le dit');
eq(rep.trashedBucket, true, 'le bac, VIDE, part à la corbeille');
eq(trashed, ['unassigned'], '…c’est bien lui');
eq(creations.indexOf('+test') !== -1, true, 'projects/test est créé par le déménagement');

/* g2. Le dossier du nouveau nom existe mais il est VIDE : les fichiers du bac y
   entrent (un dossier vide n’est pas une bibliothèque), et le `images` vidé part
   à la corbeille. */
const A2 = buildDataset({ common: [], buckets: [{ name: 'unassigned', figures: ['Fig1'] }] });
const rep2 = await MIG.migrateCommonLibrary();
eq(rep2.libraryId, A2.common, 'la bibliothèque reste le dossier du nouveau nom');
eq(rep2.merged, 2, 'ses deux fichiers (la figure et son sidecar) sont rapatriés');
eq(childrenOf(A2.common).length, 2, '…et ils sont DANS le dossier de la racine');
eq(trashed.indexOf('images') !== -1, true, 'le dossier `images` vidé part à la corbeille');
eq(rep2.trashedBucket, true, '…et le bac, vidé lui aussi, aussi');

/* g3. Un nom DÉJÀ PRIS dans `projects/test` n’est jamais écrasé : l’expérience
   reste en place (et le bac, qui n’est donc pas vide, n’est pas jeté). */
const A3 = buildDataset({
  buckets: [
    { name: 'unassigned', figures: ['Fig1'], tests: ['Test_74'] },
    { name: 'test', tests: ['Test_74'] }
  ]
});
const testProjectBefore = folderIdNamed('test', A3.projects);
const existingTest74 = folderIdNamed('Test_74', testProjectBefore);
const rep3 = await MIG.migrateCommonLibrary();
eq(rep3.libraryId, A3.leaves.unassigned, 'la bibliothèque, elle, a bien déménagé');
eq(rep3.moved, [], 'un nom déjà pris dans projects/test n’est pas écrasé');
eq(rep3.kept, ['Test_74'], '…l’expérience est annoncée comme LAISSÉE en place');
eq(rep3.trashedBucket, false, 'un bac qui porte encore quelque chose n’est JAMAIS jeté');
eq(folderIdNamed('test', A3.projects), testProjectBefore, 'le projet `test` qui existait n’est pas recréé');
eq(folderIdNamed('Test_74', testProjectBefore), existingTest74, '…et l’expérience en place n’a pas bougé');

/* …et la migration est REJOUABLE : la deuxième passe n’a plus rien à faire. */
const rep3b = await MIG.migrateCommonLibrary();
eq(rep3b.libraryId, A3.leaves.unassigned, 'le dossier commun est déjà en place');
eq(rep3b.merged, 0, 'rien de plus à rapatrier');
eq(rep3b.moved, [], '…ni à déplacer');
eq(folderIdNamed('general_library_images', A3.root), A3.leaves.unassigned, '…et il n’y a qu’un seul dossier commun');

/* g4. Sans Drive, rien n’est touché (et la lecture continue de fonctionner). */
const before = nodes.size;
globalThis.__driveTestMocks.cloud = false;
eq((await MIG.migrateCommonLibrary()).reason, 'cloud-off', 'sans Drive, la migration ne touche à rien');
eq(nodes.size, before, '…le faux Drive est intact');
globalThis.__driveTestMocks.cloud = true;

/* g5. UNE FOIS par dataset : le drapeau évite de relire le Drive à chaque
   démarrage — et `force` permet de refaire le geste à la demande. */
store.clear();
buildDataset({ buckets: [{ name: 'unassigned', figures: ['Fig1'] }] });
const first = await MIG.migrateCommonLibraryOnce();
eq(first.skipped, undefined, 'le premier passage fait le déménagement');
eq(store.get('labCommonLibraryMigrated::DS1'), '1', '…et pose le drapeau du dataset');
const second = await MIG.migrateCommonLibraryOnce();
eq(second.skipped, true, 'le suivant est ESCAMOTÉ (aucune lecture du Drive de plus)');
const forced = await MIG.migrateCommonLibraryOnce({ force: true });
eq(forced.skipped, undefined, '…sauf si on le force');
ok(readFileSync('src/App.jsx', 'utf8').includes('.then(() => migrateCommonLibraryOnce())'),
  'App.jsx lance le déménagement quand le Drive du dataset est prêt');

console.log(`_common_library_folder_test : ${checks} vérifications passées (bibliothèque commune à la racine + migration)`);




