/* =========================================================================
   _drive_instance_level_test.mjs — UNE INSTANCE VIT TOUJOURS DANS UNE EXPÉRIENCE.

   Le défaut signalé, mot pour mot : « ho notato che in certi casi crei cartelle
   di instance in google drive dentro la cartella del progetto ma questo non é mai
   possibile. le instances vanno sempre dentro un esperimento. »

   LA CAUSE. `sanitizeSlug` ne garde que `\w`, c'est-à-dire l'ALPHABET LATIN : le
   nom d'un niveau (projet, expérience) peut donc être réduit à RIEN — un nom
   fait d'emoji, de symboles (« ①②③ », « →→ ») ou entièrement d'un autre
   alphabet (grec, cyrillique, CJK, arabe…). Le segment tombait alors de la
   chaîne produite par `canonicalExperimentPath` / `structurePathFor` /
   `pathLevelsFor`, et tout ce qui est DESSOUS remontait d'un cran : l'INSTANCE
   se retrouvait posée DANS le dossier du PROJET — `projects/<projet>/<instance>`,
   une forme qui n'existe pas dans l'application.

   LA RÉPARATION. Un niveau DÉCLARÉ ne peut plus disparaître : il porte son nom
   d'attente (`DEFAULT_EXPERIMENT_NAME`, le pendant de `DEFAULT_PROJECT_NAME`), si
   bien que l'expérience est TOUJOURS le 3e segment de `projects/<projet>/…`.
   `canonicalizeExperimentPath` REPOSE le niveau manquant sur un chemin déjà
   écrit dans cette forme fautive (sinon l'entonnoir le rangerait sous
   `projects/<projet>/…` et l'instance resterait dans le dossier du projet).

   Vérifié : les constructeurs purs, le plan du dépôt, l'EXÉCUTEUR RÉEL sur un
   faux Drive (aucun dossier d'instance ne naît dans le dossier du projet), la
   recherche par nom de `driveUpload` (qui doit retrouver ce que l'envoi crée), et
   le TEXTE annoncé par les boîtes de dialogue (bâti par la règle qui ÉCRIT : une
   copie écrite à la main avait perdu `projects/`).
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

const NAMING = await import('./src/utils/driveNaming.js');
const S = await import('./src/utils/driveStructure.js');
const NAMING_SRC = readFileSync('./src/utils/driveNaming.js', 'utf8');
const STRUCT_SRC = readFileSync('./src/utils/driveStructure.js', 'utf8');
const UPLOAD_SRC = readFileSync('./src/utils/driveUpload.js', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const paths = (list) => list.map((f) => f.path.join('/'));

/* ── Un FAUX Drive : dossiers, fichiers, corbeille, rien d'autre ─────────── */
const fakeDrive = () => {
  const nodes = new Map();
  let seq = 0;
  const newId = (prefix) => `${prefix}${++seq}`;
  const workspace = newId('ws');
  nodes.set(workspace, { id: workspace, name: 'Lab Workspace', folder: true, parent: '' });
  const mkFolder = (name, parent) => {
    const id = newId('f');
    nodes.set(id, { id, name, folder: true, parent, trashed: false });
    return id;
  };
  const dataset = mkFolder('Mon_dataset', workspace);
  const children = (parent) => [...nodes.values()].filter((n) => !n.trashed && n.parent === parent);
  const io = {
    available: () => true,
    workspaceId: async () => workspace,
    rootId: async () => dataset,
    ensureFolder: async (name, parentId) => {
      if (!name || !parentId) throw new Error('ensureFolder needs (name, parent)');
      if (!nodes.has(parentId)) throw new Error(`unknown parent ${parentId}`);
      const found = children(parentId).find((n) => n.folder && n.name === name);
      return found ? found.id : mkFolder(name, parentId);
    },
    findFolder: async (name, parentId) => {
      const found = children(parentId).find((n) => n.folder && n.name === name);
      return found ? found.id : '';
    },
    findFile: async (name, parentId) => {
      const found = children(parentId).find((n) => !n.folder && n.name === name);
      return found ? found.id : '';
    },
    list: async (folderId) => children(folderId).map((n) => ({
      id: n.id,
      name: n.name,
      mimeType: n.folder ? 'application/vnd.google-apps.folder' : 'application/json'
    })),
    listDetailed: async (folderId) => ({
      files: await io.list(folderId), pages: 1, truncated: false, errors: 0
    }),
    upload: async ({ name, mimeType, body, folderId }) => {
      const same = children(folderId).find((n) => !n.folder && n.name === name);
      if (same) { same.body = String(body); same.mimeType = mimeType; return same.id; }
      const id = newId('file');
      nodes.set(id, {
        id, name, mimeType, body: String(body), parent: folderId, folder: false, trashed: false
      });
      return id;
    },
    downloadText: async (fileId) => String((nodes.get(fileId) || {}).body || ''),
    rename: async (fileId, name) => {
      const node = nodes.get(fileId);
      if (!node) return false;
      node.name = name;
      return true;
    },
    move: async (fileId, newParentId) => {
      const node = nodes.get(fileId);
      if (!node || !nodes.has(newParentId)) return false;
      node.parent = newParentId;
      return true;
    },
    trash: async (fileId) => {
      const node = nodes.get(fileId);
      if (!node) return false;
      node.trashed = true;
      return true;
    }
  };
  const walk = (path) => {
    let parent = dataset;
    for (const seg of path) {
      const found = children(parent).find((n) => n.folder && n.name === seg);
      if (!found) return '';
      parent = found.id;
    }
    return parent;
  };
  return {
    io,
    nodes,
    children,
    datasetId: dataset,
    workspaceId: workspace,
    liveFolders: () => [...nodes.values()].filter((n) => n.folder && !n.trashed),
    walk,
    folderNamesUnder: (path) => {
      const id = walk(path);
      return id ? children(id).filter((n) => n.folder).map((n) => n.name).sort() : [];
    }
  };
};

/* ── 1. LE FAIT : un nom qui ne laisse PAS de slug ───────────────────────── */
eq(NAMING.sanitizeSlug('Exp 7'), 'Exp_7', 'un nom latin donne son slug');
eq(NAMING.sanitizeSlug('🧪'), '', 'un nom d’emoji est réduit à RIEN — d’où le nom d’attente');
eq(NAMING.sanitizeSlug('①②③'), '', '…comme un nom de symboles');
eq(NAMING.sanitizeSlug('Биохимия'), '', '…et un nom entièrement en alphabet non latin');
eq(NAMING.DEFAULT_EXPERIMENT_NAME, 'experiment',
  'le nom d’attente de l’expérience est celui que driveStructure utilise déjà');
eq(S.experimentCtxOf({ id: '' }).experiment, NAMING.DEFAULT_EXPERIMENT_NAME,
  'les deux modules parlent donc du MÊME dossier pour une expérience sans nom');

/* ── 2. LES CONSTRUCTEURS : rien ne change pour un nom NORMAL ───────────── */
const CTX = { project: 'p53H', test: 'interaction_pdbs', instance: '1YCR', section: 'Data' };
eq(NAMING.canonicalExperimentPath(CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  'le chemin canonique d’une expérience normale ne bouge pas');
eq(NAMING.canonicalExperimentPath({ ...CTX, instance: '' }),
  ['projects', 'p53H', 'interaction_pdbs', 'data'], '…ni celui d’une expérience sans instance');
eq(NAMING.driveFolderPath(CTX) , ['p53H', 'interaction_pdbs', '1YCR', 'Data'],
  'la forme HISTORIQUE de driveFolderPath ne bouge pas non plus');
eq(S.structurePathFor('instance', { project: 'p53H', experiment: 'interaction_pdbs', instance: '1YCR' }),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR'],
  'le dossier d’une instance est DANS celui de son expérience');
eq(S.structurePathFor('experiment', { project: 'p53H', experiment: 'interaction_pdbs' }),
  ['projects', 'p53H', 'interaction_pdbs'], '…celui d’une expérience dans celui de son projet');
eq(S.structurePathFor('project', { project: 'p53H' }), ['projects', 'p53H'],
  '…et celui d’un projet sous le conteneur `projects/`');
eq(S.structurePathFor('experiment', { experiment: 'Exp 1' }), ['projects', 'test', 'Exp_1'],
  'une expérience sans projet garde son bac `test` SOUS projects/');
eq(S.pathFromLevels(S.pathLevelsFor({ ...CTX, experiment: CTX.test })),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  '…et les niveaux du plan donnent exactement le chemin de l’envoi');
eq(NAMING.driveFolderPath({ project: 'CD project', section: 'Discussion' }),
  ['projects', 'CD_project', 'Discussion'],
  'la route d’un DOCUMENT de projet (projet + section) n’est pas touchée');

/* ── 3. LE NOM D'EXPÉRIENCE IMPRENABLE NE FAIT PLUS REMONTER L'INSTANCE ─── */
['🧪', '→→', '①②③', 'Биохимия', '日本'].forEach((name) => {
  const ctx = { ...CTX, test: name };
  const canonical = NAMING.canonicalExperimentPath(ctx);
  eq(canonical, ['projects', 'p53H', 'experiment', '1YCR', 'data'],
    `« ${name} » : l’instance reste SOUS une expérience (projects/<projet>/<expérience>/<instance>)`);
  ok(canonical[2] !== '1YCR', `« ${name} » : l’instance n’est JAMAIS le 3e segment`);
  eq(S.pathFromLevels(S.pathLevelsFor({ ...ctx, experiment: name })),
    ['projects', 'p53H', 'experiment', '1YCR', 'data'],
    `« ${name} » : le plan du dépôt donne le MÊME chemin que l’envoi`);
  ok(S.structurePathFor('instance', { project: 'p53H', experiment: name, instance: '1YCR' })
    .indexOf('1YCR') === 3, `« ${name} » : l’instance est le 4e segment de l’arbre`);
  eq(NAMING.driveFolderPath(ctx), ['p53H', 'experiment', '1YCR', 'Data'],
    `« ${name} » : même la forme historique garde le niveau de l’expérience`);
});

eq(S.structurePathFor('instance', { project: 'p53H', instance: '1YCR' }),
  ['projects', 'p53H', 'experiment', '1YCR'],
  'une instance dont le contexte ne porte AUCUNE expérience reçoit tout de même la sienne');
eq(S.pathFromLevels(S.pathLevelsFor({ project: 'p53H', instance: '1YCR' })),
  ['projects', 'p53H', 'experiment', '1YCR'], '…identiquement pour les niveaux du plan');


/* ── 4. LES CHEMINS DÉJÀ ÉCRITS DANS LA FORME FAUTIVE SONT REPOSÉS ──────── */
eq(NAMING.canonicalizeExperimentPath(['projects', 'p53H', '1YCR', 'data'], CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  'un chemin `projects/<projet>/<instance>/…` reçoit SON niveau d’expérience');
eq(NAMING.canonicalizeExperimentPath(['p53H', '1YCR', 'data'], CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  '…idem pour la forme historique `<projet>/<instance>/…` — celle que l’entonnoir rangeait sous le projet');
eq(NAMING.canonicalizeExperimentPath(['1YCR', 'data'], CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  '…et pour `<instance>/…` (ni projet ni expérience dans le chemin)');
eq(NAMING.canonicalizeExperimentPath([], CTX), [], 'un chemin vide reste vide (rien n’est inventé)');
eq(NAMING.canonicalizeExperimentPath(
  NAMING.canonicalizeExperimentPath(['p53H', '1YCR', 'data'], CTX), CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  'reposer le niveau est IDEMPOTENT (repasser le chemin ne le change plus)');
eq(NAMING.canonicalizeExperimentPath(['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'], CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR', 'data'],
  'un chemin DÉJÀ correct n’est pas touché (aucun dossier en double)');
eq(NAMING.canonicalizeExperimentPath(['projects', 'P2', 'interaction_pdbs', '1YCR'], CTX),
  ['projects', 'p53H', 'interaction_pdbs', '1YCR'],
  'seul le projet VISÉ change (un fichier partagé suit son projet)');
eq(NAMING.canonicalizeExperimentPath(['CD_project', 'Discussion'],
  { project: 'CD project', section: 'Discussion' }),
  ['CD_project', 'Discussion'],
  'un DOCUMENT de projet (aucune expérience dans le contexte) garde son chemin');
eq(NAMING.canonicalizeExperimentPath(['CD_project', 'Discussion'],
  { project: 'CD project', test: 'Exp', instance: '1YCR', section: 'Discussion' }),
  ['CD_project', 'Discussion'],
  '…et le nom d’une SECTION n’est jamais pris pour une instance');

/* ── 5. LE PLAN DU DÉPÔT, PUIS L'EXÉCUTEUR RÉEL SUR UN FAUX DRIVE ───────── */
const IMPOSSIBLE = {
  projects: [{ id: 'p1', name: 'p53H' }],
  tests: [{ id: 't1', name: '🧪', projectNames: ['p53H'], instanceName: '1YCR' }]
};
const PLAN = S.datasetMirrorPlan({ datasetId: 'ds1', datasetName: 'Mon Dataset', data: IMPOSSIBLE });
eq(paths(PLAN.folders.filter((f) => f.type === 'experiment')), ['projects/p53H/experiment'],
  'le plan porte bien le dossier de l’EXPÉRIENCE');
eq(paths(PLAN.folders.filter((f) => f.type === 'instance')), ['projects/p53H/experiment/1YCR'],
  '…et l’instance est DEDANS — jamais dans le dossier du projet');
ok(!paths(PLAN.folders).includes('projects/p53H/1YCR'),
  'aucun dossier d’instance n’est posé dans le dossier du projet');

const D = fakeDrive();
S.resetDriveStructureCache();
const pub = await S.publishDatasetStructure({
  datasetId: 'ds1', datasetName: 'Mon Dataset', data: IMPOSSIBLE, io: D.io, rootId: D.datasetId
});
ok(pub.ok, 'le dataset est publié sur le faux Drive');
eq(D.folderNamesUnder(['projects', 'p53H']), ['experiment'],
  'le dossier du PROJET ne porte QUE le dossier de l’expérience (aucune instance à côté)');
eq(D.folderNamesUnder(['projects', 'p53H', 'experiment']), ['1YCR'],
  '…c’est bien DANS l’expérience que l’instance apparaît');
eq(D.folderNamesUnder(['projects', 'p53H', '1YCR']), [],
  'le chemin fautif du rapport (`projects/<projet>/<instance>`) n’existe pas sur le Drive');
ok(D.liveFolders().some((n) => n.name === '1YCR'), '…et le dossier de l’instance a bien été créé');

/* ── 6. LE CÂBLAGE (une seule règle, aux deux bouts) ────────────────────── */
has(NAMING_SRC, 'export const DEFAULT_EXPERIMENT_NAME',
  'le nom d’attente est exporté — une seule source pour l’application');
has(NAMING_SRC, "const testSeg = test ? (sanitizeSlug(test) || DEFAULT_EXPERIMENT_NAME) : '';",
  'driveFolderPath (forme historique) ne perd plus le niveau de l’expérience');
has(NAMING_SRC, 'sanitizeSlug(test) || DEFAULT_EXPERIMENT_NAME];',
  'canonicalExperimentPath pose son 3e segment sans jamais le perdre');
has(STRUCT_SRC, "const { project, experiment, instance, section, subs } = pageLevelsOf(c);",
  'structurePathFor ET pathLevelsFor passent par la règle unique (pageLevelsOf)');
has(STRUCT_SRC, "|| ((instance || section || subs.length) ? DEFAULT_EXPERIMENT_NAME : '')",
  '…laquelle repose le niveau de l’expérience dès qu’un niveau plus bas existe');
has(UPLOAD_SRC, 'const testSlug = sanitizeSlug(testName) || DEFAULT_EXPERIMENT_NAME;',
  'la recherche par nom vise le dossier que l’envoi CRÉE (suppression de l’expérience, dossier d’une instance)');

/* ── 7. LE TEXTE ANNONCÉ EST LE CHEMIN ÉCRIT ─────────────────────────────
   Une boîte de dialogue recopiait le chemin à la main et avait perdu le conteneur
   `projects/` : elle annonçait « Lab Workspace/<dataset>/<project>/<test>/<instance>/
   Report », un dossier qui n'existe pas. Constaté le 08/10/2026 : « il percorso
   corretto è Lab workspace/<dataset>/projects/<projet>/<test>/<instance> ». Le texte
   est désormais BÂTI par la règle qui ÉCRIT
   (migrateTestImages.TEST_DRIVE_FOLDER_SHAPE ← canonicalExperimentPath). */
const MIG = await import('./src/utils/migrateTestImages.js');
const MIG_SRC = readFileSync('./src/utils/migrateTestImages.js', 'utf8');
const UI_SRC = readFileSync('./src/components/DriveImageMigration.jsx', 'utf8');
const SETTINGS_SRC = readFileSync('./src/components/AppModules/settingsModule.jsx', 'utf8');

const SHAPE = MIG.TEST_DRIVE_FOLDER_SHAPE.split('/');
eq(MIG.TEST_DRIVE_FOLDER_SHAPE,
  'Lab Workspace/<dataset>/projects/<project>/<test>/<instance>/report',
  'la forme annoncée porte le conteneur `projects/` ET l’instance DANS l’expérience');
const REAL = ['Lab Workspace', 'Mon Dataset', ...NAMING.canonicalExperimentPath({
  project: 'p53H', test: '🧪', instance: '1YCR', section: MIG.TEST_IMAGE_SECTION
})];
eq(SHAPE.length, REAL.length,
  '…autant de niveaux que le chemin réellement écrit (un niveau perdu dans le texte se verrait)');
eq(SHAPE[2], 'projects', '…le 3e segment est le conteneur des projets');
eq(REAL[2], 'projects', '…et le chemin écrit passe bien par lui');
eq(SHAPE[5], '<instance>', '…l’instance est annoncée au 6e segment, APRÈS l’expérience');
eq(REAL[5], '1YCR', '…là où le code la pose vraiment, même quand l’expérience est un emoji');
eq(SHAPE[SHAPE.length - 1], REAL[REAL.length - 1],
  '…la section annoncée est celle que la règle canonique écrit (« Report » → « report »)');
ok(!UI_SRC.includes('`(Lab Workspace/<dataset>/<project>/<test>/<instance>/'),
  'la boîte de dialogue n’écrit plus le chemin à la main');
has(UI_SRC, '(${TEST_DRIVE_FOLDER_SHAPE})',
  '…elle annonce la forme bâtie par la règle de la migration');
has(UI_SRC, "targets[0].folder.split('/').slice(2).join('/')",
  '…et elle montre la PREMIÈRE cible réelle (le même chemin que l’aperçu)');
has(SETTINGS_SRC, '${TEST_DRIVE_FOLDER_SHAPE}',
  'le sous-titre des Réglages annonce la même forme (aucune seconde copie)');
has(MIG_SRC, 'export const TEST_DRIVE_FOLDER_SHAPE',
  'la forme est construite une seule fois, dans le module qui écrit sur le Drive');

console.log(`_drive_instance_level_test.mjs — ${passed} assertions OK (une instance vit toujours dans une expérience)`);
