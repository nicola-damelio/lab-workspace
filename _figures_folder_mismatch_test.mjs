/* =========================================================================
   _figures_folder_mismatch_test.mjs — « mes figures sont sur le Drive mais le
   programme ne les voit plus, et il y a DEUX dossiers images dont un vide »

   Le dossier d'images d'un projet est DÉRIVÉ DU NOM DU PROJET
   (`<dataset>/projects/<slug(projet)>/images`, voir driveNaming), et la
   résolution du chemin (`driveUpload.resolveDrivePathFromNames`) utilise
   `findOrCreateFolder` : elle CRÉE les dossiers. La lecture de la bibliothèque
   (`pullLibraryFromDrive`) passait par là… pour LIRE. Conséquence quand le dossier
   du projet porte un autre nom (projet renommé, dossier renommé sur le Drive,
   miroir `labDriveMirror` perdu parce que le navigateur a été vidé) :

     • un dossier VIDE est créé à côté des fichiers — « il y a deux dossiers
       images et l'un est vide » ;
     • c'est CE dossier vide qui est lu — « le programme ne voit plus mes
       figures » alors qu'elles sont bien sur le Drive ;
     • le jumeau créé est même retenu comme dossier du projet dans le miroir.

   Ce que l'on vérifie ici (voir src/utils/figuresFolder.js) :
     a. les helpers de comparaison de noms (PUR) et la règle « on ne devine pas » ;
     b. une LECTURE ne crée JAMAIS de dossier : dossier absent → erreur DITE +
        la liste des dossiers de projet du dataset (`candidates`) ;
     c. un dossier voisin au nom proche est adopté tout seul (`via: 'similar'`) et
        ses figures — compositions comprises — reviennent ;
     d. le miroir partagé gagne sur le nom : un projet renommé du tout au tout
        retrouve son dossier (`via: 'mirror'`) ;
     e. `fromFolderName` désigne le dossier, le retient pour le projet, et l'envoi
        suivant (image ET sidecar) va DANS CE dossier — jamais dans un jumeau.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── localStorage / window / canvas minimaux (comme les autres sondes) ────── */
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
globalThis.Image = class Image {
  constructor() { this.width = 40; this.height = 30; this.naturalWidth = 40; this.naturalHeight = 30; }
  set src(v) { this._src = v; if (typeof this.onload === 'function') this.onload(); }
  get src() { return this._src; }
};
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {}, fillRect() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255) })
    }),
    toDataURL: () => 'data:image/jpeg;base64,dGh1bWI='
  })
};


/* ── Un faux Drive : dossier du dataset, `projects/`, et des dossiers de projet
      DONT UN au nom d'avant le renommage. ─────────────────────────────────── */
const nodes = new Map();
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

const DS = addFolder('My_dataset', '');
const PROJECTS = addFolder('projects', DS);
/* Ancien nom du projet (« Canvas 18/09/2026 » a été renommé) : les figures y sont. */
const OLD = addFolder('Canvas_18_09', PROJECTS);
const OLD_IMG = addFolder('images', OLD);
addFile('Canvas.jpg', OLD_IMG, 'image/jpeg');
const SIDECAR_OLD = addFile('Canvas.jpg.meta.json', OLD_IMG, 'application/json');
/* Un autre projet, nom totalement différent : c'est là que sont les figures du
   projet « Projet bidon » après un renommage complet. */
const RENAMED = addFolder('Renamed_project', PROJECTS);
const RENAMED_IMG = addFolder('images', RENAMED);
addFile('Fig1.svg', RENAMED_IMG, 'image/svg+xml');
const SIDECAR_RENAMED = addFile('Fig1.svg.meta.json', RENAMED_IMG, 'application/json');
/* Un troisième projet, sans rapport : ne doit JAMAIS être adopté par erreur. */
const OTHER = addFolder('Autre_projet', PROJECTS);
const OTHER_IMG = addFolder('images', OTHER);
addFile('B.png', OTHER_IMG);

const sidecarText = new Map([
  [SIDECAR_OLD, JSON.stringify({
    kind: 'lab-workspace/figure-meta', v: 1, label: 'Canvas 18/09', src: null,
    canvasData: { canvasW: 240, canvasH: 300, gridCols: 2, gridRows: 2, canvasKey: 'cv_old', objects: [] },
    imageName: 'Canvas.jpg', savedAt: '2026-09-18T22:40:00.000Z'
  })],
  [SIDECAR_RENAMED, JSON.stringify({
    kind: 'lab-workspace/figure-meta', v: 1, label: 'Fig 1', src: { testId: 't1', elementKey: 'Chart · 2' },
    canvasData: { canvasW: 200, canvasH: 200, gridCols: 1, gridRows: 1, canvasKey: 'cv_fig1', objects: [] },
    imageName: 'Fig1.svg', savedAt: '2026-09-19T11:30:00.000Z'
  })]
]);

/* Les écritures sont INTERDITES par défaut : une lecture qui créerait un dossier
   doit faire ÉCHOUER ce test, pas seulement se voir dans une liste. */
let allowCreation = false;
const creations = [];
const uploads = [];
const creatingResolver = (names) => {
  const wanted = (names || []).map(String);
  creations.push(wanted.join('/'));
  if (!allowCreation) throw new Error(`resolveDrivePathFromNames appelé (${wanted.join('/')}) — une LECTURE ne crée rien`);
  let parent = DS;
  for (const name of wanted) {
    let id = folderIdNamed(name, parent);
    if (!id) id = addFolder(name, parent);
    parent = id;
  }
  return { leafId: parent, path: wanted.map((n) => ({ name: n, id: n })) };
};

globalThis.__driveTestMocks = {
  cloud: true,
  driveToken: 'tok',
  driveRootId: 'DS1',
  driveRootName: 'My dataset',
  dataUrlToBlob: () => ({}),
  ensureDriveFolder: async () => DS,
  ensureLabWorkspaceFolder: async () => 'WS',
  getDriveFileMeta: async (id) => {
    const n = nodes.get(String(id));
    return n ? { id: n.id, name: n.name, trashed: false } : { id: '', name: '', trashed: true };
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
  resolveDrivePathFromNames: async (names) => creatingResolver(names),
  uploadLocalFile: async (arg) => {
    uploads.push(arg);
    return { id: `UP${uploads.length}`, name: arg && arg.name, driveUrl: `https://drive.google.com/file/d/${uploads.length}/view` };
  }
};

const FOLDER_MOD = await import('./src/utils/figuresFolder.js');
const LIB = await import('./src/utils/figuresLibrary.js');
const MIRROR = await import('./src/utils/driveMirrorStore.js');
const FOLDER_SRC = readFileSync('src/utils/figuresFolder.js', 'utf8');
const LIB_SRC = readFileSync('src/utils/figuresLibrary.js', 'utf8');

let checks = 0;
const eq = (a, b, msg) => { checks += 1; assert.equal(a, b, msg); };
const ok = (v, msg) => { checks += 1; assert.ok(v, msg); };

/* ── a. Comparaison de noms (PUR) : le nom est un indice, pas une preuve ──── */
eq(FOLDER_MOD.projectFolderNameScore('Canvas_18_09', 'canvas 18 09'), 3, 'même nom au séparateur/casse près');
eq(FOLDER_MOD.projectFolderNameScore('Figure_p53H_old', 'Figure p53H'), 2, 'un nom contient l’autre');
eq(FOLDER_MOD.projectFolderNameScore('Canvas 18/09', 'Canvas 19/09'), 1, 'des mots communs ne suffisent pas');
eq(FOLDER_MOD.projectFolderNameScore('Renamed_project', 'Projet bidon'), 0, 'deux noms sans rapport');
const sample = [
  { name: 'Canvas_18_09', imagesId: 'IMG_A', files: 2, sidecars: 1 },
  { name: 'Autre_projet', imagesId: 'IMG_B', files: 1, sidecars: 0 }
];
eq(FOLDER_MOD.pickFiguresFolder(sample, 'Canvas 19/09'), null, 'un simple mot commun ne fait pas adopter un dossier');
eq(FOLDER_MOD.pickFiguresFolder(sample, 'Canvas 18/09/2026').name, 'Canvas_18_09', 'le dossier dont le nom contient le titre gagne');
eq(FOLDER_MOD.pickFiguresFolder(
  [{ name: 'A_b', imagesId: 'I1', files: 1 }, { name: 'A b', imagesId: 'I2', files: 9 }], 'A b'
), null, 'deux candidats équivalents → on demande au lieu de deviner');
eq(FOLDER_MOD.pickFiguresFolder([], 'A b'), null, 'aucun candidat → rien');

/* ── b. Une LECTURE ne crée RIEN (dossier du projet introuvable) ─────────── */
store.clear();
creations.length = 0;
LIB.writeProjectLibrary('P1', []);
const missing = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P1', projectName: 'Projet bidon' });
ok(!!missing.error, 'le dossier du projet est absent : le geste le DIT');
eq(missing.folder, 'projects/Projet_bidon/images', '…et nomme le dossier attendu');
eq(creations.length, 0, 'AUCUN dossier créé par une lecture (ni résolution, ni findOrCreateFolder)');
eq(missing.candidates.length, 3, 'les dossiers de projet du dataset sont rendus pour que l’on choisisse');
eq(missing.candidates.map((c) => c.name).sort().join(','), 'Autre_projet,Canvas_18_09,Renamed_project', '…avec leur nom réel');
eq(missing.candidates.find((c) => c.name === 'Canvas_18_09').sidecars, 1, '…et le nombre de compositions éditables');
eq(LIB.readProjectLibrary('P1').length, 0, 'rien n’est ajouté quand le dossier est introuvable');

/* ── c. Dossier voisin au nom proche : adopté, figures ET composition ───── */
store.clear();
creations.length = 0;
LIB.writeProjectLibrary('P2', []);
const near = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P2', projectName: 'Canvas 18/09/2026' });
eq(near.error, '', 'un dossier voisin au nom proche suffit : aucune erreur');
eq(near.via, 'similar', '…trouvé par son nom (via: similar)');
eq(near.folder, 'projects/Canvas_18_09/images', '…et c’est CE dossier qui est lu, pas un jumeau vide');
eq(near.added, 1, 'l’image est ajoutée à la bibliothèque');
eq(near.restored, 1, 'sa composition ÉDITABLE revient par le sidecar');
eq(near.noComposition, 0, 'aucune image sans copie éditable');
eq(creations.length, 0, 'toujours aucun dossier créé');
eq(LIB.readProjectLibrary('P2').length, 1, 'le sidecar n’est pas compté comme une image');
eq(LIB.readProjectLibrary('P2')[0].canvasData.canvasKey, 'cv_old', 'la composition relue est bien celle du canvas');

/* ── d. Le miroir partagé l’emporte sur le nom (renommage complet) ───────── */
store.clear();
creations.length = 0;
LIB.writeProjectLibrary('P3', []);
MIRROR.writeDriveMirror(MIRROR.rememberProjectFolder(MIRROR.readDriveMirror(), {
  datasetId: 'DS1', datasetName: 'My dataset', projectName: 'Projet bidon', folderId: RENAMED
}));
const viaMirror = await LIB.pullLibraryFromDrive({ scope: 'project', projectId: 'P3', projectName: 'Projet bidon' });
eq(viaMirror.via, 'mirror', 'dossier retrouvé par le registre partagé (dossier du projet par identifiant)');
eq(viaMirror.folder, 'projects/Renamed_project/images', '…malgré un nom qui n’a plus rien à voir avec le projet');
eq(viaMirror.added, 1, 'ses figures reviennent');
eq(viaMirror.restored, 1, 'avec leur composition éditable');
eq(creations.length, 0, 'aucune création : le dossier existant a été trouvé');
eq(LIB.projectFiguresFolderInfo !== undefined, true, 'le résolveur est exposé aux écrans');

/* ── e. Désigner le dossier : il est retenu, l’envoi suivant y va ─────────── */
store.clear();
creations.length = 0;
uploads.length = 0;
LIB.writeProjectLibrary('P4', []);
const chosen = await LIB.pullLibraryFromDrive({
  scope: 'project', projectId: 'P4', projectName: 'Projet bidon', fromFolderName: 'Renamed_project'
});
eq(chosen.adopted, 'Renamed_project', 'le dossier désigné est retenu pour ce projet');
eq(chosen.folder, 'projects/Renamed_project/images', '…et c’est lui qui est lu');
eq(chosen.added, 1, 'ses figures arrivent dans la bibliothèque');
allowCreation = true;
const pushed = await LIB.uploadFigureToDrive({
  full: 'data:image/png;base64,AAAA', label: 'Nouvelle figure', projectName: 'Projet bidon'
});
ok(!!pushed && !!pushed.id, 'l’image est envoyée au Drive');
eq(uploads[0].path.join('/'), 'projects/Renamed_project/images', 'elle rejoint le dossier EXISTANT (aucun jumeau créé)');
const meta = LIB.buildFigureMeta({
  label: 'Nouvelle figure', imageName: 'Nouvelle_figure.png',
  canvasData: { canvasW: 10, canvasH: 10, gridCols: 1, gridRows: 1, canvasKey: 'cv_new', objects: [] }
});
const sideSent = await LIB.uploadFigureMetaToDrive({
  meta, imageName: 'Nouvelle_figure.png', projectName: 'Projet bidon'
});
ok(!!sideSent, 'la composition est envoyée');
eq(uploads[1].path.join('/'), 'projects/Renamed_project/images', '…dans le MÊME dossier que l’image');
eq(creations.length, 0, 'aucun dossier créé : le dossier retenu a été réutilisé');
allowCreation = false;

/* ── f. Sans dossier du tout : là seulement, l’écriture crée l’emplacement ─ */
store.clear();
creations.length = 0;
uploads.length = 0;
allowCreation = true;
const fresh = await LIB.uploadFigureToDrive({
  full: 'data:image/png;base64,AAAA', label: 'Toute première figure', projectName: 'Projet neuf'
});
allowCreation = false;
ok(!!fresh, 'l’envoi aboutit pour un projet sans dossier');
eq(uploads[0].path.join('/'), 'projects/Projet_neuf/images', 'l’emplacement canonique est utilisé');
ok(creations.length > 0, '…et c’est la SEULE situation où un dossier est créé');

/* ── g. Contrats de code : ce qui a été corrigé ne peut pas revenir ──────── */
ok(FOLDER_SRC.includes('ne crée RIEN'), 'le résolveur documente qu’il ne crée rien');
ok(!/resolveDrivePathFromNames\s*\(/.test(FOLDER_SRC), 'il n’appelle même pas la résolution qui crée');
const pullAt = LIB_SRC.indexOf('export const pullLibraryFromDrive');
const pullBody = LIB_SRC.slice(pullAt, pullAt + 2600);
ok(pullAt > 0 && !/resolveDrivePathFromNames/.test(pullBody), 'la lecture ne passe plus par la résolution qui crée des dossiers');
ok(/figuresFolderFor\(projectName, \{ create: false \}\)/.test(pullBody), '…elle cherche le dossier existant (create: false)');
ok(pullBody.includes('fromFolderName'), 'le dossier peut être désigné à la main (fromFolderName)');
ok(LIB_SRC.includes('projectImagesFolderPath(target.name || projectName)'), 'les envois visent le dossier TROUVÉ, pas le nom du projet');
ok(LIB_SRC.includes('projectFiguresFolderChoices'), 'la liste des dossiers est exposée aux écrans');

console.log(`\n✓ ${checks} vérifications passées — le dossier d’images d’un projet est CHERCHÉ, jamais fabriqué.`);
