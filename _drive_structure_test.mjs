/* =========================================================================
   _drive_structure_test.mjs — LA RÈGLE DU DÉPÔT, VÉRIFIÉE SANS NAVIGATEUR.

   Ce que la règle promet, et ce qui est vérifié ici sur un FAUX Drive :
     • un objet de l'application = UN dossier (`datasetMirrorPlan` est PUR) ;
     • chaque dossier PORTE son `_meta.json` (identifiant, type, nom, parent,
       rang, dates) — et ce fichier n'est JAMAIS pris pour une donnée ;
     • UN SEUL créateur de dossier (aucun `POST …folder` ailleurs dans le
       module), donc jamais de doublon par « chercher-puis-créer » ;
     • un fichier PAR OBJET, et le texte d'une section est un FICHIER dans le
       dossier de CETTE section, sous-sections imbriquées comprises ;
     • les pixels (URL `data:`) ne montent pas : elles deviennent un marqueur,
       et les figures/fichiers bruts sont listés par leurs POINTEURS ;
     • renommer / déplacer un dossier se fait PAR IDENTIFIANT : aucun doublon ;
     • supprimer = corbeille du Drive (jamais de destruction) ;
     • republier le même contenu n'écrit rien (empreintes) ;
     • l'audit est en LECTURE SEULE et dit ce qui manque.
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

const S = await import('./src/utils/driveStructure.js');
const SRC = readFileSync('./src/utils/driveStructure.js', 'utf8');
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
  return {
    io,
    nodes,
    children,
    datasetId: dataset,
    workspaceId: workspace,
    liveFolders: () => [...nodes.values()].filter((n) => n.folder && !n.trashed),
    filesIn: (parentId) => children(parentId).filter((n) => !n.folder),
    folderNamed: (name, parentId) => children(parentId).filter((n) => n.folder && n.name === name)
  };
};

/* ── Le dataset d'essai : EXACTEMENT ce que la demande décrit ────────────── */
const TEST_DATA = {
  projects: [{ id: 'p1', name: 'CD_project', background: '<p>Le fond scientifique du projet.</p>' }],
  tests: [{
    id: 't1',
    name: 'NMR_p53H',
    projectNames: ['CD_project'],
    instanceName: 'Exp_7',
    plan: [{ date: '2026-10-12', title: 'Acquisition NMR', assignedTo: 'Nicola' }],
    sections: [
      { title: 'Experiment setup', html: '<p>Le montage de cette acquisition.</p>' },
      { title: 'Results', html: '<p>Les résultats obtenus.</p>', subsection: 'Integration' }
    ],
    commentary: 'Une remarque libre sur cette expérience.',
    figureDriveId: '1AbCdEfGhIjKlMnOpQrStUvWxYz01234',
    image: 'data:image/png;base64,AAAA'
  }],
  storages: [{
    id: 's1', name: 'Freezer -20', boxes: [{ id: 'b1', name: 'Box 12', note: 'Les échantillons de la série A.' }]
  }],
  datasetProtocols: [{ id: 'pr1', title: 'CD_spec_acquisition', text: 'Pas à pas de l’acquisition CD.' }]
};
const PLAN = S.datasetMirrorPlan({ datasetId: 'ds1', datasetName: 'Mon Dataset', data: TEST_DATA });
const PLAN_PATHS = paths(PLAN.folders);
const PLAN_FILES = PLAN.files.map((f) => `${f.path.join('/')}|${f.name}`);
if (process.env.DUMP_PLAN) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('tmp_plan_dbg.txt', `${planDump()}\n`, 'utf8');
  console.log('plan dumped');
  process.exit(0);
}
function planDump() {
  return `FOLDERS\n${PLAN_PATHS.join('\n')}\n\nFILES\n${PLAN_FILES.join('\n')}`;
}

/* ── 1. Chaque dossier se décrit lui-même ────────────────────────────────── */
const meta = S.folderMetaPayload({
  id: 'F1', type: S.STRUCTURE_TYPES.PROJECT, name: 'CD_project', parentId: 'DS1', order: 2,
  datasetId: 'ds1', datasetName: 'Mon Dataset', datasetFolder: 'Mon_Dataset',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z'
});
eq(meta.kind, 'lab-workspace/folder', 'une description dit de quel genre de fichier il s’agit');
eq(meta.version, 1, '…et sa version (une relecture de demain saura quoi faire)');
eq(meta.id, 'F1', 'l’IDENTIFIANT du dossier est dans sa description (jamais le nom comme vérité)');
eq(meta.parentId, 'DS1', '…et celui de son parent');
eq(meta.order, 2, '…et son rang entre frères (l’ordre de la page est donc relisible)');
eq(meta.dataset.folder, 'Mon_Dataset', '…et le dossier du dataset auquel il appartient');
eq([meta.createdAt, meta.updatedAt], ['2026-01-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z'],
  '…et ses dates de création et de modification');

const roundTrip = S.parseFolderMeta(S.metaJson(meta));
ok(roundTrip.ok, 'la description relue est acceptée');
eq(roundTrip.meta.id, 'F1', '…et son identifiant est intact après un aller-retour');
eq(S.parseFolderMeta('{"kind":"autre"}').ok, false, 'un fichier étranger n’est JAMAIS pris pour une description');
eq(S.parseFolderMeta('pas du json').ok, false, '…ni un fichier illisible');
eq(S.folderIdInMeta(S.metaJson(meta)), 'F1', 'l’identifiant se lit d’une description sans la relire à la main');

ok(S.isMetaFileName('_meta.json') && S.isMetaFileName('_META.JSON'), 'le nom du fichier de description est reconnu');
const nodeFolder = { id: 'F', name: 'images', mimeType: 'application/vnd.google-apps.folder' };
const nodeMeta = { id: 'M', name: '_meta.json', mimeType: 'application/json' };
const nodeFig = { id: 'G', name: 'figure.png', mimeType: 'image/png' };
eq(S.isMetaNode(nodeMeta), true, 'un `_meta.json` EST un fichier de description');
eq([S.isMetaNode(nodeFig), S.isMetaNode(nodeFolder)], [false, false],
  '…et une figure ou un dossier n’en sont pas');
eq(S.withoutMetaNodes([nodeMeta, nodeFig, nodeFolder]).map((n) => n.name), ['figure.png', 'images'],
  'la lecture d’un dossier écarte la description : elle n’est jamais prise pour une donnée');

/* ── 2. Deux objets ne sont jamais fusionnés dans un seul nom ────────────── */
eq(S.safeChildName('rapport.pdf', ['rapport.pdf']), 'rapport_2.pdf', 'un nom déjà pris reçoit une suite');
eq(S.safeChildName('rapport.pdf', ['rapport.pdf', 'rapport_2.pdf']), 'rapport_3.pdf', '…et la suite ne se répète pas');
eq(S.safeChildName('rapport.pdf', ['autre.pdf']), 'rapport.pdf', 'un nom libre est gardé tel quel');

/* ── 3. Les pixels ne montent pas, les pointeurs si ─────────────────────── */
const stripped = S.stripDataUrls({ a: { image: 'data:image/png;base64,AAAA' }, b: 'du texte' });
eq(stripped.omitted, 1, 'une seule image encodée en clair a été remplacée');
eq(stripped.value.a.image.__data_url__, 'image/png', '…par un marqueur qui dit ce qui n’est pas monté');
eq(stripped.value.b, 'du texte', 'le reste du contenu est copié verbatim');
ok(!JSON.stringify(stripped.value).includes('data:image'), 'aucune URL `data:` ne survit dans un fichier du Drive');
ok(isNaN(Number(stripped.value.a.image.bytes)) === false && stripped.value.a.image.bytes > 0,
  '…et le marqueur porte la taille, donc on sait ce qui manque');
const pointers = S.drivePointersIn(TEST_DATA.tests[0]);
eq(pointers.length, 1, 'un pointeur de figure est trouvé (identifiant Drive)');
eq(pointers[0].id, '1AbCdEfGhIjKlMnOpQrStUvWxYz01234', '…et c’est bien l’identifiant du fichier');
eq(pointers[0].kind, 'file', '…un fichier, pas un dossier');
ok(pointers[0].url.includes('/file/d/'), '…et son lien est prêt à cliquer dans le Drive');
eq(S.drivePointersIn({ a: 'https://drive.google.com/drive/folders/1ZzYyXxWwVvUuTtSsRrQ' })[0].kind, 'folder',
  'un lien de dossier est reconnu comme un dossier');

const texts = S.textsIn(TEST_DATA.tests[0]);
const textLabels = texts.map((t) => t.label);
ok(textLabels.includes('commentary'), 'un vrai texte est retenu');
eq(textLabels.filter((l) => l === 'html').length, 2, 'les textes portés par une section nommée sont vus eux aussi');
ok(!textLabels.includes('id') && !textLabels.includes('name') && !textLabels.includes('date'),
  'un identifiant, un nom, une date ne sont JAMAIS pris pour un texte');
ok(texts.every((t) => !S.isDataUrl(t.value)), '…et jamais une image encodée en clair');

/* ── 4. Un dossier par niveau, aussi profond que la page ────────────────── */
eq(S.subsectionChain('Integration'), ['Integration'], 'une sous-section donne un dossier');
eq(S.subsectionChain(['Data', 'Analysis', 'Peaks']), ['Data', 'Analysis', 'Peaks'],
  'des sous-sections imbriquées donnent AUTANT de dossiers, dans l’ordre');
eq(S.structurePathFor('project', { project: 'CD project' }), ['projects', 'CD_project'],
  'un projet vit sous le conteneur `projects/`');
eq(S.structurePathFor('box', { storage: 'Freezer -20', box: 'Box 12' }),
  ['storage', 'Freezer_-20', 'boxes', 'Box_12'], 'une boîte vit dans son storage');
eq(S.structurePathFor('protocol', { protocol: 'CD spec' }), ['protocols', 'CD_spec'],
  'un protocole a son dossier');
eq(S.structurePathFor('appointment', { date: '2026-10-12', title: 'Acquisition NMR' }),
  ['agenda', '2026-10-12_Acquisition_NMR'], 'un rendez-vous est un objet daté de l’agenda');
eq(S.structurePathFor('dataset', {}), [], 'le dataset est la racine de l’arbre (résolu par l’application)');

/* ── 4 bis. Le chemin COMPLET : le dataset est un NIVEAU du Drive ───────────
   La structure est `Lab Workspace/<dataset>/projects/<projet>/…` — jamais
   `<dataset>/<projet>/…` (le dossier du projet posé à côté de `projects/`), et
   jamais une expérience à la racine du dataset. Le dossier du dataset est résolu
   par l'application (`ensureDriveFolder`), mais il reste un niveau REEL du Drive :
   le plan et les étiquettes le montrent. */
eq(S.absoluteStructurePath('instance', {
  datasetName: 'Mon Dataset', project: 'CD project', experiment: 'NMR p53H', instance: 'Exp 7'
}), ['Lab Workspace', 'Mon_Dataset', 'projects', 'CD_project', 'NMR_p53H', 'Exp_7'],
'le chemin COMPLET est Lab Workspace / <dataset> / projects / <projet> / <expérience> / <instance>');
eq(S.structurePathLabel('experiment', { datasetName: 'Mon Dataset', project: 'CD', experiment: 'Exp 1' }),
  'Lab Workspace / Mon_Dataset / projects / CD / Exp_1', '…et l’étiquette le dit sans raccourci');
eq(S.structurePathFor('experiment', { experiment: 'Exp 1' }), ['projects', 'test', 'Exp_1'],
  'une expérience sans projet va dans le bac `test` SOUS projects/ (jamais à la racine du dataset)');
eq(S.pathFromLevels(S.pathLevelsFor({ experiment: 'Exp 1' })), ['projects', 'test', 'Exp_1'],
  '…et ses niveaux passent par le même conteneur `projects/`');
/* Les CONTENEURS canoniques d'un dossier de dataset (`driveNaming.DATASET_FOLDER_DIRS`
   + l'agenda des rendez-vous) : tout objet vit DEDANS, jamais à côté. */
const CONTAINERS = ['projects', 'general_library_images', 'backups', 'protocols', 'storage', 'publications', 'agenda'];
const inContainer = (p) => !p || CONTAINERS.some((c) => p === c || p.startsWith(`${c}/`));
ok(PLAN_PATHS.every(inContainer),
  'tout dossier du plan vit DANS un conteneur connu : aucun projet ni expérience posé à la racine du dataset');
ok(PLAN_PATHS.includes('projects/CD_project/NMR_p53H/Exp_7'),
  'le projet s’insère ENTRE le conteneur `projects/` et l’expérience');
ok(!PLAN_PATHS.some((p) => p.startsWith('CD_project') || p === 'NMR_p53H/Exp_7'),
  'aucun dossier de projet/expérience n’est posé directement dans le dossier du dataset');

const deepLevels = S.pathLevelsFor({
  project: 'CD', experiment: 'Exp', instance: 'Inst', section: 'Data', subsections: ['One', 'Two', 'Three']
});
eq(S.pathFromLevels(deepLevels),
  ['projects', 'CD', 'Exp', 'Inst', 'data', 'One', 'Two', 'Three'],
  'la profondeur ne s’arrête pas à trois : chaque sous-section est un niveau de plus');

/* ── 5. Le plan : un objet, un dossier, un fichier ──────────────────────── */
ok(PLAN_PATHS.includes('projects/CD_project/NMR_p53H/Exp_7/experiment_setup'),
  'le dossier de la SECTION « Experiment setup » existe dans le plan');
ok(PLAN_PATHS.includes('projects/CD_project/NMR_p53H/Exp_7/Results/Integration'),
  '…et la sous-section imbriquée « Integration » aussi');
ok(PLAN_PATHS.includes('storage/Freezer_-20/boxes/Box_12'), 'la boîte est un dossier');
ok(PLAN_PATHS.includes('protocols/CD_spec_acquisition'), 'le protocole est un dossier');
ok(PLAN_PATHS.includes('agenda/2026-10-12_Acquisition_NMR'), 'le rendez-vous est un dossier daté');
ok(PLAN.folders.every((f) => {
  const parent = f.path.slice(0, -1).join('/');
  return parent === '' || PLAN_PATHS.includes(parent);
}), 'chaque dossier a bien son parent DANS le plan (rien n’est créé dans le vide)');
ok(PLAN.folders.some((f) => f.type === 'container' && f.name === 'projects'),
  'les conteneurs (`projects/`, `storage/`, `protocols/`) sont décrits eux aussi');

ok(PLAN_FILES.some((f) => f === 'projects/CD_project/NMR_p53H/Exp_7/experiment_setup|Experiment_setup.html'),
  'le texte d’une section est un FICHIER dans le dossier de cette section');
ok(PLAN_FILES.some((f) => f === 'projects/CD_project/NMR_p53H/Exp_7/Results/Integration|Results.html'),
  '…et le texte d’une sous-section dans le dossier de la sous-section');
ok(PLAN_FILES.some((f) => f === 'projects/CD_project/NMR_p53H/Exp_7|NMR_p53H.json'),
  'l’expérience entière est UN fichier (jamais un JSON partagé pour tout le dataset)');
ok(PLAN_FILES.some((f) => f === 'storage/Freezer_-20/boxes/Box_12|Box_12.json'), 'la boîte est UN fichier');
ok(PLAN_FILES.some((f) => f === '|Mon_Dataset.json'),
  'le dataset a son fichier, à la racine de son dossier');
ok(PLAN_FILES.every((f) => !f.endsWith('|_meta.json')),
  'les descriptions ne sont PAS dans le plan des objets (c’est le rôle de la structure)');
ok(PLAN.files.every((f) => !String(f.body).includes('data:image')),
  'aucun fichier du plan ne porte de pixels encodés');
ok(!PLAN_FILES.includes('projects/CD_project/NMR_p53H/Exp_7|html.html'),
  'un texte rangé dans une section n’est PAS recopié à la racine de l’expérience');
ok(PLAN_FILES.includes('projects/CD_project/NMR_p53H/Exp_7|commentary.txt'),
  '…mais les autres textes de la page restent un fichier, dans le dossier de l’expérience');
ok(PLAN_FILES.includes('projects/CD_project/NMR_p53H/Exp_7|NMR_p53H.files.json'),
  'les figures et fichiers bruts sont listés par leurs POINTEURS, à côté de l’objet');
const planIndex = JSON.parse(PLAN.files.find((f) => f.name === 'Mon_Dataset.json').body);
eq(planIndex.counts, { projects: 1, experiments: 1, storages: 1, protocols: 1, appointments: 1 },
  'le fichier du dataset compte ce que le Drive porte (de quoi vérifier sans l’application)');
ok(planIndex.folders.includes('projects/CD_project/NMR_p53H/Exp_7/Results/Integration'),
  '…et il donne les dossiers, donc on sait où regarder');

/* ── 6. L'EXÉCUTION : le plan devient des dossiers et des fichiers ─────────
   Tout se vérifie sur un FAUX Drive : aucun réseau, aucun navigateur. */

/** Le dossier atteint en descendant une suite de noms depuis le dataset. */
const walk = (drive, names) => {
  let parent = drive.datasetId;
  for (const name of names) {
    const found = drive.children(parent).find((n) => n.folder && n.name === name);
    if (!found) return '';
    parent = found.id;
  }
  return parent;
};
const fileIdAt = (drive, names, fileName) => {
  const parent = walk(drive, names);
  if (!parent) return '';
  const found = drive.children(parent).find((n) => !n.folder && n.name === fileName);
  return found ? found.id : '';
};
const bodyAt = (drive, names, fileName) => {
  const id = fileIdAt(drive, names, fileName);
  return id ? String((drive.nodes.get(id) || {}).body || '') : '';
};

S.resetDriveStructureCache();
const D1 = fakeDrive();
const st1 = S.createDriveStructure({ io: D1.io });
const rep1 = await st1.publish(PLAN, { rootId: D1.datasetId });
ok(rep1.ok, 'le plan s’exécute sur le Drive sans une seule erreur');
eq([rep1.folders, rep1.metas], [PLAN.folders.length, PLAN.folders.length],
  'chaque dossier du plan existe ET porte sa description (le dossier du dataset compris)');
eq(rep1.files, PLAN.files.length, 'chaque fichier du plan est écrit');
eq(rep1.errors, [], '…et rien n’a échoué');
eq([...D1.nodes.values()].filter((n) => n.name === '_meta.json').length, PLAN.folders.length,
  'un `_meta.json` par dossier, aucun en trop');

const projectsId = walk(D1, ['projects']);
const projectId = walk(D1, ['projects', 'CD_project']);
ok(!!projectsId && !!projectId && projectsId !== D1.datasetId,
  '`projects/` est un dossier DU dataset, et le projet vit DEDANS');
eq(D1.children(D1.datasetId).filter((n) => n.folder).map((n) => n.name).sort(),
  ['agenda', 'projects', 'protocols', 'storage'],
  'le dossier du dataset ne contient QUE les conteneurs (aucun projet posé à la racine)');
const projectMeta = S.parseFolderMeta(bodyAt(D1, ['projects', 'CD_project'], '_meta.json'));
ok(projectMeta.ok, 'la description du projet se relit');
eq([projectMeta.meta.id, projectMeta.meta.parentId, projectMeta.meta.type],
  [projectId, projectsId, 'project'], '…et elle dit l’identifiant du dossier, son parent et son type');

ok(!!walk(D1, ['projects', 'CD_project', 'NMR_p53H', 'Exp_7', 'Results', 'Integration']),
  'une sous-section imbriquée existe vraiment sur le Drive, au fond du chemin');
ok(!!fileIdAt(D1, ['projects', 'CD_project', 'NMR_p53H', 'Exp_7', 'Results', 'Integration'], 'Results.html'),
  'le texte d’une sous-section est un FICHIER, dans le dossier de cette sous-section');
const expMeta = bodyAt(D1, ['projects', 'CD_project', 'NMR_p53H', 'Exp_7'], 'NMR_p53H.json');
ok(expMeta.includes('"kind": "lab-workspace/object"'), 'l’expérience est un fichier auto-descriptif');
ok(expMeta.includes('__data_url__') && !expMeta.includes('data:image'),
  '…dont les pixels encodés ont été remplacés par un marqueur');
const pointerFile = JSON.parse(bodyAt(D1, ['projects', 'CD_project', 'NMR_p53H', 'Exp_7'], 'NMR_p53H.files.json'));
eq(pointerFile.files.map((f) => f.id), ['1AbCdEfGhIjKlMnOpQrStUvWxYz01234'],
  'les figures restent des fichiers du Drive, désignés par leur pointeur');
const expChildren = (await D1.io.listDetailed(walk(D1, ['projects', 'CD_project', 'NMR_p53H', 'Exp_7']))).files;
eq(S.withoutMetaNodes(expChildren).map((n) => n.name).sort(),
  ['NMR_p53H.files.json', 'NMR_p53H.json', 'Results', 'commentary.txt', 'experiment_setup'],
  'la lecture d’un dossier écarte `_meta.json` et ne rend que les objets de cette expérience');

/* ── 7. Renommer / déplacer / supprimer : PAR IDENTIFIANT ────────────────── */
ok(await st1.renameObject({
  folderId: projectId, newName: 'CD project renamed', type: 'project',
  dataset: { id: PLAN.datasetId, name: PLAN.datasetName, folder: PLAN.datasetFolder }
}), 'renommer un objet se fait par identifiant de dossier');
eq(D1.folderNamed('CD_project', projectsId).length, 0, 'l’ancien nom a disparu');
eq(D1.folderNamed('CD_project_renamed', projectsId).length, 1,
  '…et le dossier n’existe qu’UNE fois, sous son nouveau nom (aucun jumeau)');
eq(walk(D1, ['projects', 'CD_project_renamed']), projectId, '…et c’est TOUJOURS le même dossier');
const renamedMeta = S.parseFolderMeta(bodyAt(D1, ['projects', 'CD_project_renamed'], '_meta.json'));
eq(renamedMeta.meta.name, 'CD_project_renamed', 'sa description suit le nouveau nom');

const boxId = walk(D1, ['storage', 'Freezer_-20', 'boxes', 'Box_12']);
ok(await st1.moveObject({ folderId: boxId, newParentId: walk(D1, ['storage', 'Freezer_-20']) }),
  'déplacer un objet se fait par identifiant');
eq(walk(D1, ['storage', 'Freezer_-20', 'Box_12']), boxId,
  '…le dossier a suivi, avec le même identifiant (rien n’a été recopié)');
ok(!walk(D1, ['storage', 'Freezer_-20', 'boxes', 'Box_12']), '…et il n’est plus à son ancien endroit');

ok(await st1.trashObject({ folderId: boxId }), 'supprimer un objet = le mettre à la CORBEILLE du Drive');
eq((D1.nodes.get(boxId) || {}).trashed, true, '…il est dans la corbeille, pas détruit');
eq(D1.folderNamed('Box_12', walk(D1, ['storage', 'Freezer_-20'])).length, 0,
  '…et il ne compte plus parmi les dossiers vivants');
ok(!(await st1.trashObject({ folderId: '' })), 'aucune corbeille sans identifiant');

/* ── 8. Republier n'écrit rien ; ce qui change est réécrit ──────────────── */
eq(S.fileFingerprint({ mimeType: 'application/json', body: '{\n  "kind": "x",\n  "savedAt": "2026-01-01T00:00:00.000Z",\n  "data": 1\n}\n' }),
  S.fileFingerprint({ mimeType: 'application/json', body: '{\n  "kind": "x",\n  "savedAt": "2026-02-02T00:00:00.000Z",\n  "data": 1\n}\n' }),
'deux sauvegardes du même contenu ne diffèrent que par l’horodate : aucun fichier n’est réécrit pour elle');
ok(S.fileFingerprint({ mimeType: 'application/json', body: '{\n  "data": 1\n}\n' })
  !== S.fileFingerprint({ mimeType: 'application/json', body: '{\n  "data": 2\n}\n' }),
'…mais un contenu réellement différent change l’empreinte');
const D2 = fakeDrive();
S.resetDriveStructureCache();
const opts2 = {
  datasetId: 'ds1', datasetName: 'Mon Dataset', data: TEST_DATA, io: D2.io, rootId: D2.datasetId
};
const first2 = await S.publishDatasetStructure(opts2);
ok(first2.ok && first2.report.files === PLAN.files.length, 'publier un dataset écrit tous ses fichiers');
has(S.publishReportText(first2.report), '✅', 'le compte-rendu dit que le Drive porte le dataset');
const second2 = await S.publishDatasetStructure(opts2);
ok(second2.ok, 'republier le même contenu réussit');
eq([second2.report.files, second2.report.skipped], [0, PLAN.files.length],
  'une charge identique n’est JAMAIS renvoyée (empreintes)');
eq(D2.folderNamed('projects', D2.datasetId).length, 1, '…et `projects/` n’existe qu’une fois');

const changed = {
  ...TEST_DATA,
  projects: [{ ...TEST_DATA.projects[0], background: '<p>Un autre fond scientifique.</p>' }]
};
const changedPlan = S.datasetMirrorPlan({ datasetId: 'ds1', datasetName: 'Mon Dataset', data: changed });
const beforeBodies = new Map(
  PLAN.files.map((f) => [`${f.path.join('/')}|${f.name}`, S.fileBodyStamp(f.body)])
);
const expectBodies = changedPlan.files.filter(
  (f) => beforeBodies.get(`${f.path.join('/')}|${f.name}`) !== S.fileBodyStamp(f.body)
).length;
ok(expectBodies > 0, 'un texte modifié change bien quelque chose dans le plan');
const third2 = await S.publishDatasetStructure({ ...opts2, data: changed });
eq(third2.report.files, expectBodies, 'seuls les fichiers dont le contenu a changé sont réécrits');
eq(third2.report.skipped, PLAN.files.length - expectBodies, '…les autres restent intacts');

/* ── 9. L'AUDIT est en LECTURE SEULE ────────────────────────────────────── */
const D3 = fakeDrive();
S.resetDriveStructureCache();
const opts3 = {
  datasetId: 'ds1', datasetName: 'Mon Dataset', data: TEST_DATA, io: D3.io, rootId: D3.datasetId
};
const emptyAudit = await S.auditDatasetStructure(opts3);
ok(!emptyAudit.ok, 'l’audit d’un dataset presque vide dit que quelque chose manque');
eq(emptyAudit.audit.foldersMissing.length, PLAN.folders.length - 1,
  '…tous les dossiers manquants (le dossier du dataset, lui, est là)');
eq(D3.children(D3.datasetId).filter((n) => n.folder).length, 0,
  'l’audit N’A RIEN créé : aucun dossier n’est apparu sous celui du dataset');
eq(D3.children(D3.workspaceId).filter((n) => n.folder).map((n) => n.name), ['Mon_dataset'],
  '…et la racine de l’application ne porte toujours que ce dataset');
const done3 = await S.publishDatasetStructure(opts3);
ok(done3.ok, 'le dataset est publié');
const audit3 = await S.auditDatasetStructure(opts3);
ok(audit3.ok, 'après publication, l’audit ne trouve plus rien à redire');
eq([audit3.audit.foldersMissing, audit3.audit.filesMissing, audit3.audit.metasMissing], [[], [], []],
  '…ni dossiers, ni fichiers, ni descriptions ne manquent');
has(S.auditReportText(audit3.audit), '✅', 'le rapport d’audit est une phrase');

const noCloud = await S.publishDatasetStructure({ ...opts3, io: { ...D3.io, available: () => false }, rootId: '' });
eq([noCloud.ok, noCloud.reason], [false, 'cloud-unavailable'],
  'un Drive injoignable se DIT (jamais un faux « enregistré »)');
has(S.publishReportText(noCloud.report), 'nothing was published',
  '…et le compte-rendu ne prétend rien avoir publié');

/* ── 10. UN SEUL CRÉATEUR DE DOSSIER, ET L'ADAPTATEUR DU NAVIGATEUR ─────── */
has(SRC, 'await drive.ensureFolder(name, parent)',
  'un seul créateur de dossier : l’adaptateur (`drive.ensureFolder`)');
ok(!SRC.includes("method: 'POST'"),
  'le module ne parle jamais directement à l’API Drive (aucun POST) — donc jamais de jumeau');
ok(!/^import .*driveUpload/m.test(SRC),
  'le module reste testable hors navigateur (driveUpload importé seulement à la demande)');
const adapterNames = [...new Set([...SRC.matchAll(/up\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
ok(adapterNames.length >= 10, 'l’adaptateur du navigateur s’appuie sur les helpers d’envoi existants');
adapterNames.forEach((name) => ok(
  new RegExp(`export (const|async function|function) ${name}\\b`).test(UPLOAD_SRC),
  `driveUpload exporte bien « ${name} » (utilisé par l’adaptateur du navigateur)`
));

/* ── 11. UNE SAUVEGARDE NE REDEMANDE RIEN POUR CE QUI EST DÉJÀ LÀ ───────── */
const D4 = fakeDrive();
const calls = { ensureFolder: 0, upload: 0 };
const io4 = {
  ...D4.io,
  ensureFolder: async (name, parentId) => {
    calls.ensureFolder += 1;
    return D4.io.ensureFolder(name, parentId);
  },
  upload: async (args) => {
    calls.upload += 1;
    return D4.io.upload(args);
  }
};
S.resetDriveStructureCache();
const opts4 = {
  datasetId: 'ds1', datasetName: 'Mon Dataset', data: TEST_DATA, io: io4, rootId: D4.datasetId
};
await S.publishDatasetStructure(opts4);
ok(calls.ensureFolder >= PLAN.folders.length - 1,
  'la première publication retrouve ou crée chaque dossier du plan');
const first4 = { ...calls };
await S.publishDatasetStructure(opts4);
eq([calls.ensureFolder - first4.ensureFolder, calls.upload - first4.upload], [0, 0],
  'la sauvegarde suivante ne redemande aucun dossier et n’écrit aucun fichier');

/* ── 12. L'APPLICATION APPELLE CETTE RÈGLE (App.jsx) ────────────────────── */
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const SIDEBAR = readFileSync('./src/components/AppModules/appSidebar.jsx', 'utf8').replace(/\r\n/g, '\n');
has(APP, "import { publishDatasetStructure, publishReportText } from './utils/driveStructure';",
  'App.jsx importe la règle du dépôt');
has(APP, 'publishDatasetStructure({\n        datasetId: currentDatasetId,\n        datasetName: datasetTitle || \'\',\n        data: rawData\n      })',
  '…et publie la structure du dataset à CHAQUE sauvegarde');
has(APP, "if (res.reason === 'publish-failed') setDriveMirrorMsg(publishReportText(res.report));",
  'une publication incomplète se DIT (jamais un faux « enregistré »)');
has(APP, 'driveMirrorMsg={driveMirrorMsg}', '…et le message part à la barre latérale');
has(SIDEBAR, 'driveMirrorMsg,', 'la barre latérale reçoit le message du miroir');
has(SIDEBAR, '{driveMirrorMsg}', '…et l’affiche');

console.log(`${passed} assertions passed — le Drive est le miroir complet du dataset.`);



