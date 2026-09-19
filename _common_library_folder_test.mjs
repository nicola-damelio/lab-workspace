/* =========================================================================
   _common_library_folder_test.mjs — « où sont les images de la bibliothèque
   GÉNÉRALE (commune) ? le programme me dit `_unassigned`, mon Drive montre
   `unassigned` »

   Le nom d'un dossier de chemin est SANITISÉ à la création
   (`driveUpload.resolveDrivePathFromNames` → `sanitizeSlug`), et
   `sanitizeSlug('_unassigned')` vaut `unassigned` (le `_` de tête tombe) : sur
   Google Drive, le seau « aucune figure de projet » — c'est-à-dire le dossier de
   la bibliothèque COMMUNE — s'appelle donc `unassigned`, alors que la LECTURE ne
   cherchait que le nom canonique `_unassigned`. Conséquence : la bibliothèque
   commune n'était retrouvée que sur un poste où le miroir `labDriveMirror`
   l'avait déjà retenue ; ailleurs (autre navigateur, poste neuf, ☁/⬇ dans une
   session vierge) le dossier était déclaré introuvable et « Add missing from
   Drive » ne pouvait rien ramener.

   Ce que l'on vérifie ici (voir src/utils/figuresFolder.js) :
     a. les helpers PURS : les noms du seau commun, et le chemin tel que le Drive
        le nomme (`projects/unassigned/images`) ;
     b. une lecture trouve le dossier `unassigned` par son NOM, sur un poste sans
        miroir, et lit ses figures (compositions comprises) — rien n'est créé ;
     c. le nom canonique `_unassigned` reste lu (Drive/Nextcloud d'avant) ;
     d. quand LES DEUX existent, c'est `unassigned` — le dossier réel — qui est lu ;
     e. la portée COMMUNE n'adopte JAMAIS le dossier d'un projet ;
     f. l'écran affiche le nom que le Drive montre (le canonique reste celui des
        chemins d'écriture et de Nextcloud).
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

/* ── Un faux Drive : dossier du dataset, `projects/`, un seau par scénario ─── */
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

/** Un dataset NEUF : `projects/` puis un dossier par entrée de `buckets`
 *  (`{ name, figures: ['Fig1', …] }`), chacun avec son dossier `images`.
 *  @returns {{ leaves:Record<string,string> }} l'id du dossier `images` de
 *  chaque seau. */
const buildDataset = (buckets = []) => {
  nodes = new Map();
  seq = 0;
  sidecarText.clear();
  const ds = addFolder('My_dataset', '');
  const projects = addFolder('projects', ds);
  const leaves = {};
  buckets.forEach((b) => {
    const folder = addFolder(String(b.name), projects);
    const images = addFolder('images', folder);
    (b.figures || []).forEach((base) => addFigure(images, base));
    leaves[String(b.name)] = images;
  });
  return { leaves };
};

let allowCreation = false;
const creations = [];
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
  listDriveChildren: async (parent) => childrenOf(String(parent)),
  findDriveFileByName: async (name, parent) => {
    const hit = [...nodes.values()].find((n) => n.parent === String(parent) && n.name === String(name));
    return hit ? hit.id : '';
  },
  downloadDriveFileText: async (id) => sidecarText.get(String(id)) || '',
  findOrCreateFolder: async (name, parent) => {
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
  uploadLocalFile: async (arg) => ({ id: `UP${arg && arg.name}`, name: arg && arg.name, driveUrl: 'https://drive.google.com/file/d/UP/view' })
};

const FOLDER = await import('./src/utils/figuresFolder.js');
const LIB = await import('./src/utils/figuresLibrary.js');
const NAMING = await import('./src/utils/driveNaming.js');
const FOLDER_SRC = readFileSync('src/utils/figuresFolder.js', 'utf8');
const NAMING_SRC = readFileSync('src/utils/driveNaming.js', 'utf8');

let checks = 0;
/* `deepEqual` (assert/strict = comparaison profonde STRICTE) : certaines
   vérifications portent sur des LISTES (`unassignedFolderNames()`,
   `projectImagesFolderPath('')`), et `assert.equal` comparerait leurs
   références. */
const eq = (a, b, msg) => { checks += 1; assert.deepEqual(a, b, msg); };
const ok = (v, msg) => { checks += 1; assert.ok(v, msg); };
/* ── a. PUR : les noms du seau commun, et le chemin tel que le Drive le nomme ─ */
eq(FOLDER.unassignedFolderNames(), ['unassigned', '_unassigned'],
  'le seau commun se cherche d’abord sous son nom RÉEL sur le Drive, puis sous le nom canonique');
eq(FOLDER.isUnassignedFolderName('_unassigned'), true, '`_unassigned` est le seau commun');
eq(FOLDER.isUnassignedFolderName('unassigned'), true, '`unassigned` aussi (le même dossier)');
eq(FOLDER.isUnassignedFolderName('Unassigned'), true, 'au séparateur/casse près');
eq(FOLDER.isUnassignedFolderName('Projet_A'), false, 'un projet n’est pas le seau commun');
eq(FOLDER.imagesFolderPathOnDrive(''), 'projects/unassigned/images',
  'la bibliothèque COMMUNE vit dans projects/unassigned/images sur le Drive (le `_` tombe à la création)');
eq(FOLDER.imagesFolderPathOnDrive('CD project'), 'projects/CD_project/images', 'un projet garde le slug de son nom');
eq(NAMING.projectImagesFolderPath(''), ['projects', '_unassigned', 'images'],
  'le nom CANONIQUE reste `_unassigned` (chemins d’écriture + Nextcloud, qui ne re-sanitise pas)');
eq(NAMING.projectImagesFolderLabel('', 'My dataset'), 'My_dataset / projects / unassigned / images',
  '…mais l’écran montre le nom que le DRIVE affiche');
eq(NAMING.projectImagesFolderLabel('CD project', 'My dataset'), 'My_dataset / projects / CD_project / images',
  'l’étiquette d’un projet ne change pas');

/* Le seau commun est une CONVENTION, pas une supposition : il se reconnaît même
   sans nom de projet (score 3), mais deux candidats équivalents → on demande. */
eq(FOLDER.pickFiguresFolder(
  [{ name: 'Projet_A', imagesId: 'I1', files: 9 }, { name: 'unassigned', imagesId: 'I2', files: 1 }], ''
).name, 'unassigned', 'portée commune : le seau `unassigned` est retenu (score 3) même s’il a moins de fichiers');
eq(FOLDER.pickFiguresFolder(
  [{ name: 'unassigned', imagesId: 'I1', files: 1 }, { name: '_unassigned', imagesId: 'I2', files: 1 }], ''
), null, 'deux seaux du même nom → on montre la liste au lieu de deviner');
eq(FOLDER.pickFiguresFolder([{ name: 'Projet_A', imagesId: 'I1', files: 9 }], ''), null,
  'un dossier de projet n’est jamais pris pour la bibliothèque commune');
eq(FOLDER.pickFiguresFolder(
  [{ name: 'Canvas_18_09', imagesId: 'I1', files: 2 }, { name: 'Autre', imagesId: 'I2', files: 1 }], 'Canvas 19/09'
), null, 'la règle « on ne devine pas » des projets est intacte');


/* ── b. Un poste NEUF (aucun miroir) retrouve la bibliothèque commune ──────── */
store.clear();
creations.length = 0;
const A = buildDataset([{ name: 'unassigned', figures: ['Fig1', 'Fig2'] }, { name: 'Projet_A', figures: ['Autre'] }]);
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
ok(!store.has('labDriveMirror'), 'poste neuf : le miroir du Drive est vide (rien n’a encore été retenu)');
const foundCommon = await FOLDER.findProjectFiguresFolder('');
eq(foundCommon.leafId, A.leaves.unassigned, 'le dossier `unassigned` est TROUVÉ par son nom, sans miroir');
eq(foundCommon.via, 'name', '…par la recherche du nom réel');
eq(foundCommon.name, 'unassigned', '…et son nom est celui du Drive');
eq(foundCommon.folder, 'projects/unassigned/images', 'le chemin annoncé est celui que le Drive montre');
eq(foundCommon.exact, true, 'le dossier est bien celui de cette portée');

const pulledCommon = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(pulledCommon.error, '', 'la lecture de la bibliothèque commune ne se plaint plus d’un dossier absent');
eq(pulledCommon.via, 'name', 'elle dit comment le dossier a été trouvé');
eq(pulledCommon.folder, 'projects/unassigned/images', '…et où il est vraiment');
eq(pulledCommon.found, 2, 'les deux figures du seau sont vues');
eq(pulledCommon.added, 2, '…et ajoutées à la bibliothèque commune');
eq(pulledCommon.restored, 2, 'leurs compositions éditables reviennent avec elles');
eq(creations.length, 0, 'AUCUN dossier créé : cette lecture ne fabrique rien');

/* ── c. Le nom CANONIQUE `_unassigned` reste lu (Drive/Nextcloud d’avant) ─── */
store.clear();
creations.length = 0;
const B = buildDataset([{ name: '_unassigned', figures: ['Ancienne'] }]);
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const legacy = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(legacy.folder, 'projects/_unassigned/images', 'un seau `_unassigned` (nom canonique) reste lu');
eq(legacy.added, 1, '…et ses figures aussi');
eq(creations.length, 0, 'toujours aucun dossier créé');
ok(B.leaves._unassigned.length > 0, 'le faux Drive porte bien le dossier historique');

/* ── d. Les DEUX noms existent : c’est le dossier RÉEL (`unassigned`) qui est lu */
store.clear();
creations.length = 0;
const C = buildDataset([
  { name: 'unassigned', figures: ['Recente'] },
  { name: '_unassigned', figures: ['Traine'] }
]);
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const both = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(both.folder, 'projects/unassigned/images', 'le dossier que la création fabrique (`unassigned`) passe en premier');
eq(both.added, 1, 'une seule figure est ramenée (celle du dossier lu)');
eq(LIB.readLibrary().map((i) => i.label), ['Recente'], '…celle de `unassigned`, pas celle du dossier historique');
eq(C.leaves.unassigned === C.leaves._unassigned, false, 'les deux dossiers sont bien distincts dans le faux Drive');

/* ── e. La portée COMMUNE n’adopte JAMAIS le dossier d’un projet ──────────── */
store.clear();
creations.length = 0;
buildDataset([
  { name: 'unassigned', figures: [] },                    // le seau commun est VIDE
  { name: 'Projet_A', figures: ['Fig_du_projet'] }         // un projet PEUPLÉ, à côté
]);
LIB.refreshLibraryFromStorage();
LIB.writeLibrary([]);
const commonEmpty = await LIB.pullLibraryFromDrive({ scope: 'common', projectId: null, projectName: '' });
eq(commonEmpty.via, 'name', 'le seau commun vide reste le dossier de la portée commune');
eq(commonEmpty.found, 0, 'il est vide : rien n’est « retrouvé » chez le projet voisin');
eq(commonEmpty.added, 0, 'aucune figure de projet n’entre dans la bibliothèque commune');
eq(LIB.readLibrary().length, 0, 'la bibliothèque commune reste vide');
eq(creations.length, 0, 'et aucun dossier n’est créé pour autant');
/* Le projet, lui, continue d’être lu par son nom. */
const projFolder = await FOLDER.findProjectFiguresFolder('Projet A');
eq(projFolder.via, 'name', 'le dossier du projet est toujours trouvé par son nom');
eq(projFolder.folder, 'projects/Projet_A/images', '…dans son propre dossier');

/* ── f. Forme des sources (le contrat que les écrans attendent) ───────────── */
ok(FOLDER_SRC.includes('export const unassignedFolderNames = () =>'), 'figuresFolder expose les noms du seau commun');
ok(FOLDER_SRC.includes('for (const wantedName of wantedNames)'), 'la recherche par nom essaie les deux noms du seau');
ok(FOLDER_SRC.includes('export const imagesFolderPathOnDrive'), '…et expose le chemin tel que le Drive le nomme');
ok(NAMING_SRC.includes('projectImagesFolderPath(projectName).map((s) => sanitizeSlug(s) || s)'),
  'l’étiquette Drive affiche les noms réels des dossiers');
ok(readFileSync('src/components/ChartStarLayer.jsx', 'utf8').includes('imagesFolderPathOnDrive('),
  'la capture ⭐ annonce le même dossier que le Drive');

globalThis.__driveTestMocks = undefined;
console.log(`\n_common_library_folder_test : ${checks} vérifications passées`);

