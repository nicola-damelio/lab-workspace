/* =========================================================================
   _drive_rename_test.mjs — RENOMMER N'EST PAS RECRÉER (et ne renomme que ce
   qu'il faut).

   LES DEUX DÉFAUTS, constatés sur le Drive réel le 08/10/2026 (dataset
   « GEC-UPJV-projects »), avec la preuve que lit la sonde `_diag_tree.mjs` :

     1. `projects/p53H/interaction_pdbs` portait CINQ dossiers d'instance
        (`1YCR`, `3LNZ`, `instance1`, `New_Instance_2`, `New_Instance_3`) pour
        TROIS instances : `1YCR` et `instance1` ont le MÊME `extra.id`, donc
        renommer une instance créait un dossier au nouveau nom et laissait
        l'ancien (avec tous ses fichiers) derrière lui. Même chose pour les
        expériences (`NMR_tests/New_Instance_4`, `tests/Test_66/New_Instance_2`).
     2. le fichier de style du viewer — déposé sous SON nom canonique
        (`viewer-style-snapshot.json`) — ressortait rebaptisé
        `Nicola_DAMELIO.json` (le nom du scientifique), donc plus personne ne le
        retrouvait : `renameDriveFilesFor` recalculait le nom de TOUS les
        fichiers depuis le contexte, alors que seuls les fichiers NOMMÉS PAR LA
        CONVENTION doivent suivre un renommage.

   Vérifié ici :
     A. la règle PURE du frère à adopter (`pickRenamedSibling`) ;
     B. l'EXÉCUTEUR de structure (le module réel, un faux Drive injecté) : un
        objet renommé voit son dossier RENOMMÉ — un seul dossier, ses fichiers
        suivent, aucune création —, avec en TÉMOIN l'ancienne règle qui, elle,
        fabrique le jumeau ;
     C. `renameDriveFilesFor` (module réel, jeton et Drive bouchonnés) : le
        dossier d'instance est renommé (pas recréé), le style du viewer garde son
        nom canonique, le registre suit ;
     D. les contrats de code (le défaut ne peut pas revenir).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

register('./_esm_test_hook.mjs', import.meta.url);

const STRUCTURE = await import('./src/utils/driveStructure.js');
const { pickRenamedSibling, planEntryIdentity, createDriveStructure } = STRUCTURE;

/* ── A. LA RÈGLE PURE ────────────────────────────────────────────────────── */
const META_OF = (id) => ({ ok: true, type: 'instance', extra: { id } });
const siblings = [
  { id: 'F_OLD', name: '1YCR', meta: META_OF('t17914951876631134') },
  { id: 'F_OTHER', name: '3LNZ', meta: META_OF('t17914952328471224') }
];
eq(pickRenamedSibling(siblings, { appId: 't17914951876631134' }), 'F_OLD',
  'le frère adopté est celui dont la DESCRIPTION porte l’identifiant de l’objet');
eq(pickRenamedSibling(siblings, { appId: 'inconnu' }), '',
  'aucun frère du même identifiant → rien à adopter (l’appelant créera, comme avant)');
eq(pickRenamedSibling(siblings, { appId: '' }), '',
  'sans identifiant à chercher, on ne devine rien');
eq(pickRenamedSibling([], { appId: 't17914951876631134' }), '', 'un parent sans frère n’adopte rien');
eq(pickRenamedSibling([{ id: 'F1', name: 'x' }], { appId: 'a' }), '',
  'un frère SANS description lisible n’est jamais pris pour un autre');
eq(planEntryIdentity({ name: 'instance1', extra: { id: 'i1' } }), { name: 'instance1', appId: 'i1' },
  'l’identité d’une entrée de plan : son nom et l’identifiant qu’elle porte');
eq(planEntryIdentity(null), { name: '', appId: '' }, '…et rien du tout quand il n’y a pas d’entrée');

/* ── B. L'EXÉCUTEUR — le module RÉEL, un faux Drive injecté ────────────────
   Le faux Drive garde les NŒUDS et un JOURNAL : c'est lui qui dit si un dossier
   a été CRÉÉ (le jumeau) ou RENOMMÉ (le seul geste juste), et si les fichiers
   sont restés dedans. */
const FOLDER = 'application/vnd.google-apps.folder';
const makeIoDrive = () => {
  const nodes = new Map();
  const log = [];
  let seq = 0;
  const put = ({ id = '', name, parent = '', mimeType = 'application/json', text = '' }) => {
    const nid = id || `N${++seq}`;
    nodes.set(nid, { id: nid, name, parent, mimeType, text });
    log.push({ op: 'create', name, id: nid, parent });
    return nid;
  };
  const logRename = (id, name) => log.push({ op: 'rename', id, name, parent: (nodes.get(id) || {}).parent || '' });
  const drive = {
    put,
    logRename,
    folder: (name, parent = '') => put({ name, parent, mimeType: FOLDER }),
    /** La DESCRIPTION qu'un dossier porte (`_meta.json` : type + `extra.id`). */
    meta: (folderId, { type = 'folder', appId = '', name = '' } = {}) => put({
      name: '_meta.json',
      parent: folderId,
      mimeType: 'application/json',
      text: JSON.stringify({
        kind: 'lab-workspace/folder', id: folderId, type,
        name: name || (nodes.get(folderId) || {}).name || '',
        extra: appId ? { id: appId } : {}
      })
    }),
    node: (id) => nodes.get(id) || null,
    childrenOf: (parent) => [...nodes.values()].filter((n) => n.parent === parent),
    byPath: (p) => {
      let parent = '';
      let node = null;
      for (const seg of String(p).split('/').filter(Boolean)) {
        node = drive.childrenOf(parent).find((n) => n.name === seg) || null;
        if (!node) return null;
        parent = node.id;
      }
      return node;
    },
    idOf: (p) => ((drive.byPath(p) || {}).id || ''),
    parentOf: (id) => ((nodes.get(id) || {}).parent || ''),
    creations: (name) => log.filter((e) => e.op === 'create' && e.name === name).length,
    renamesOf: (id) => log.filter((e) => e.op === 'rename' && e.id === id).map((e) => e.name),
    metaName: (folderId) => {
      const meta = drive.childrenOf(folderId).find((n) => n.name === '_meta.json');
      if (!meta) return '';
      try { return JSON.parse(meta.text).name || ''; } catch { return ''; }
    }
  };
  return drive;
};


/** L'adaptateur que `createDriveStructure` attend, branché sur ce faux Drive. */
const ioOf = (drive) => ({
  workspaceId: async () => 'dsRoot',
  rootId: async () => 'dsRoot',
  ensureFolder: async (name, parentId) => {
    const found = drive.childrenOf(parentId).find((n) => n.name === name && n.mimeType === FOLDER);
    return found ? found.id : drive.folder(name, parentId);
  },
  findFolder: async (name, parentId) => {
    const found = drive.childrenOf(parentId).find((n) => n.name === name && n.mimeType === FOLDER);
    return found ? found.id : '';
  },
  list: async (parentId) => drive.childrenOf(parentId)
    .map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType })),
  listDetailed: async (parentId) => drive.childrenOf(parentId)
    .map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType })),
  findFile: async (name, parentId) => {
    const found = drive.childrenOf(parentId).find((n) => n.name === name && n.mimeType !== FOLDER);
    return found ? found.id : '';
  },
  upload: async ({ name, mimeType = 'application/json', body = '', folderId }) => {
    const existing = drive.childrenOf(folderId).find((n) => n.name === name && n.mimeType !== FOLDER);
    if (existing) { existing.text = String(body); return existing.id; }
    return drive.put({ name, parent: folderId, mimeType, text: String(body) });
  },
  downloadText: async (fileId) => ((drive.node(fileId) || {}).text || ''),
  rename: async (fileId, name) => {
    const node = drive.node(fileId);
    if (!node) return false;
    node.name = String(name);
    drive.logRename(fileId, name);
    return true;
  },
  move: async (fileId, parentId) => {
    const node = drive.node(fileId);
    if (!node) return false;
    node.parent = parentId;
    return true;
  },
  trash: async (fileId) => {
    const node = drive.node(fileId);
    if (!node) return false;
    node.parent = '__trash';
    return true;
  },
  available: () => true
});

/* L'arbre d'AVANT le renommage : l'expérience s'appelle `Exp_7`, son instance
   `instance1` (c'est l'état que le Drive réel montrait encore sous le nom
   `1YCR`), et elle porte un fichier à elle — c'est lui qu'on doit retrouver dans
   le dossier renommé. */
const seedTree = (drive) => {
  drive.put({ id: 'dsRoot', name: 'GEC-UPJV-projects', mimeType: FOLDER });
  const projectsId = drive.folder('projects', 'dsRoot');
  const projectId = drive.folder('CD_project', projectsId);
  const expId = drive.folder('Exp_7', projectId);
  const instId = drive.folder('instance1', expId);
  drive.meta(projectId, { type: 'project', appId: 'prj_CD' });
  drive.meta(expId, { type: 'experiment', appId: 't_Exp7' });
  drive.meta(instId, { type: 'instance', appId: 'i_Exp7_1' });
  const pdbId = drive.put({ name: '1YCR_Nicola_DAMELIO.pdb', parent: instId, mimeType: 'chemical/x-pdb', text: 'ATOM' });
  return { projectsId, projectId, expId, instId, pdbId };
};

/** Le plan d'APRÈS le renommage (expérience `Exp_7` → `Test_7`, instance
 *  `instance1` → `New_Instance_2`) : mêmes identités, nouveaux noms. */
const planAfterRename = () => ({
  datasetId: 'ds', datasetName: 'GEC-UPJV-projects', datasetFolder: 'GEC-UPJV-projects',
  folders: [
    { path: ['projects'], name: 'projects', type: 'dir', order: 0, extra: null },
    { path: ['projects', 'CD_project'], name: 'CD_project', type: 'project', order: 0, extra: { id: 'prj_CD' } },
    { path: ['projects', 'CD_project', 'Test_7'], name: 'Test_7', type: 'experiment', order: 0, extra: { id: 't_Exp7' } },
    {
      path: ['projects', 'CD_project', 'Test_7', 'New_Instance_2'],
      name: 'New_Instance_2', type: 'instance', order: 0, extra: { id: 'i_Exp7_1' }
    }
  ],
  files: []
});

/* LE TÉMOIN — l'ANCIENNE règle, reproduite à la main : « chercher ce nom, sinon
   CRÉER ». Elle ne peut pas savoir que le dossier d'à côté EST le même objet :
   elle fabrique donc le second dossier et laisse le premier avec son fichier. */
const witnessDrive = makeIoDrive();
const W = seedTree(witnessDrive);
for (const entry of planAfterRename().folders) {
  const parent = entry.path.length > 1 ? witnessDrive.idOf(`GEC-UPJV-projects/${entry.path.slice(0, -1).join('/')}`) : 'dsRoot';
  const found = witnessDrive.childrenOf(parent).find((n) => n.name === entry.name && n.mimeType === FOLDER);
  if (!found) witnessDrive.folder(entry.name, parent);
}
ok(witnessDrive.idOf('GEC-UPJV-projects/projects/CD_project/Exp_7'),
  'témoin : le dossier du VIEUX nom reste (rien ne l’a emporté)');
ok(witnessDrive.idOf('GEC-UPJV-projects/projects/CD_project/Test_7'),
  '…et un SECOND dossier naît au nouveau nom — les deux à la fois, c’est le défaut du 08/10/2026');
ok(witnessDrive.idOf('GEC-UPJV-projects/projects/CD_project/Exp_7') !== W.expId
  || witnessDrive.idOf('GEC-UPJV-projects/projects/CD_project/Test_7') !== W.expId,
  '…avec DEUX identifiants différents pour le même objet');


/* ── B (suite). LE CORRECTIF — l'objet renommé est ADOPTÉ et RENOMMÉ ──────── */
const real = makeIoDrive();
const R = seedTree(real);
const structure = createDriveStructure({ io: ioOf(real) });
const report = await structure.publish(planAfterRename(), { rootId: 'dsRoot' });
ok(report.ok, 'la publication passe (aucune erreur de dossier)');
eq(report.folders, 4, 'les quatre dossiers du plan sont servis');
eq(real.idOf('GEC-UPJV-projects/projects/CD_project/Test_7'), R.expId,
  'l’expérience renommée est LE MÊME dossier (son identifiant ne change pas)');
eq(real.idOf('GEC-UPJV-projects/projects/CD_project/Test_7/New_Instance_2'), R.instId,
  '…et l’instance renommée aussi');
eq(real.byPath('GEC-UPJV-projects/projects/CD_project/Exp_7'), null,
  'le dossier du VIEUX nom n’existe plus (il a été renommé, pas laissé derrière)');
eq(real.byPath('GEC-UPJV-projects/projects/CD_project/Test_7/instance1'), null,
  '…pas plus pour l’instance');
eq(real.creations('Test_7'), 0, 'AUCUN dossier créé au nouveau nom de l’expérience (aucun jumeau)');
eq(real.creations('New_Instance_2'), 0, '…ni au nouveau nom de l’instance');
eq(real.renamesOf(R.expId), ['Test_7'], 'le dossier a été RENOMMÉ (le geste juste, par identifiant)');
eq(real.renamesOf(R.instId), ['New_Instance_2'], '…et celui de l’instance aussi');
eq(real.parentOf(R.pdbId), R.instId,
  'le fichier de l’instance est resté DANS son dossier (un renommage emporte ses enfants)');
eq(real.metaName(R.expId), 'Test_7', 'la description du dossier dit le nom d’AUJOURD’HUI');
eq(real.metaName(R.instId), 'New_Instance_2', '…et celle de l’instance aussi');
/* Le geste est IDEMPOTENT : un plan qui redit les noms EXISTANTS ne renomme rien
   (c'est le cas de toutes les publications ordinaires). */
const same = makeIoDrive();
const S = seedTree(same);
/* Le compte d'AVANT : la graine a déjà créé les dossiers — ce qui compte est
   qu'aucun dossier de PLUS ne naisse. */
const createdBefore = same.creations('Exp_7');
const structure2 = createDriveStructure({ io: ioOf(same) });
await structure2.publish({
  datasetId: 'ds', datasetName: 'GEC-UPJV-projects', datasetFolder: 'GEC-UPJV-projects',
  folders: [
    { path: ['projects'], name: 'projects', type: 'dir', order: 0, extra: null },
    { path: ['projects', 'CD_project'], name: 'CD_project', type: 'project', order: 0, extra: { id: 'prj_CD' } },
    { path: ['projects', 'CD_project', 'Exp_7'], name: 'Exp_7', type: 'experiment', order: 0, extra: { id: 't_Exp7' } },
    {
      path: ['projects', 'CD_project', 'Exp_7', 'instance1'],
      name: 'instance1', type: 'instance', order: 0, extra: { id: 'i_Exp7_1' }
    }
  ],
  files: []
}, { rootId: 'dsRoot' });
eq(same.renamesOf(S.expId), [], 'un plan qui redit le nom EXISTANT ne renomme rien');
eq(same.renamesOf(S.instId), [], '…ni celui de l’instance');
eq(same.creations('Exp_7'), createdBefore, '…et ne recrée aucun dossier');
eq(same.idOf('GEC-UPJV-projects/projects/CD_project/Exp_7'), S.expId, 'le dossier est celui qu’on avait');


/* ── C. `renameDriveFilesFor` — LE MODULE RÉEL (jeton + Drive bouchonnés) ───
   Le dossier d'instance était renommé au MAUVAIS nom (l'index venait du chemin
   canonique, le nom du chemin HISTORIQUE — un cran d'écart), donc le renommage
   échouait et chaque fichier partait dans une arborescence REFABRIQUÉE : le
   vieux dossier restait, le nouveau naissait. Et les fichiers au nom CANONIQUE
   (le style du viewer) étaient rebaptisés du nom du scientifique. */
const makeFetchDrive = () => {
  const nodes = new Map();
  const log = [];
  let seq = 0;
  const put = ({ id = '', name, parent = '', mimeType = 'application/json', text = '' }) => {
    const nid = id || `F${++seq}`;
    nodes.set(nid, { id: nid, name, parent, mimeType, trashed: false, text });
    log.push({ op: 'create', name, id: nid, parent, mimeType });
    return nid;
  };
  const res = (json, status = 200, text = null) => ({
    ok: status < 400, status, json: async () => json, text: async () => (text === null ? JSON.stringify(json) : text)
  });
  const fetchLike = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = String(init.method || 'GET').toUpperCase();
    const q = u.searchParams.get('q') || '';
    if (u.pathname.endsWith('/permissions')) return res({ id: 'perm' });
    const byId = /^\/drive\/v3\/files\/([^/?]+)$/.exec(u.pathname);
    if (byId) {
      const node = nodes.get(decodeURIComponent(byId[1]));
      if (!node) return res({ error: { message: 'not found' } }, 404);
      if (method === 'PATCH') {
        const meta = JSON.parse(String(init.body || '{}'));
        if (meta.name) { node.name = String(meta.name); log.push({ op: 'rename', id: node.id, name: node.name }); }
        if (meta.trashed !== undefined) { node.trashed = !!meta.trashed; log.push({ op: 'trash', id: node.id }); }
        const add = u.searchParams.get('addParents');
        if (add) { node.parent = add; log.push({ op: 'move', id: node.id, parent: add }); }
        return res({ id: node.id, name: node.name });
      }
      if (u.searchParams.get('alt') === 'media') return res({}, 200, node.text);
      return res({
        id: node.id, name: node.name, mimeType: node.mimeType, trashed: node.trashed,
        parents: node.parent ? [node.parent] : []
      });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const id = put({
        name: body.name, parent: (body.parents || [])[0] || '',
        mimeType: body.mimeType || FOLDER
      });
      return res({ id, name: body.name });
    }
    const wanted = (/name='((?:[^'\\]|\\.)*)'/.exec(q) || [])[1];
    const name = wanted ? wanted.replace(/\\'/g, "'") : '';
    const parent = (/'(?:([A-Za-z0-9_-]+))' in parents/.exec(q) || [])[1] || '';
    const folderOnly = q.includes(`mimeType='${FOLDER}'`);
    let out = [...nodes.values()].filter((n) => !n.trashed);
    if (parent) out = out.filter((n) => n.parent === parent);
    if (name) out = out.filter((n) => n.name === name);
    if (folderOnly) out = out.filter((n) => n.mimeType === FOLDER);
    return res({ files: out.map((n) => ({ id: n.id, name: n.name, mimeType: n.mimeType })) });
  };
  return {
    fetch: fetchLike, put, nodes,
    node: (id) => nodes.get(id) || null,
    creations: (name) => log.filter((e) => e.op === 'create' && e.name === name && e.mimeType === FOLDER).length,
    renamesOf: (id) => log.filter((e) => e.op === 'rename' && e.id === id).map((e) => e.name),
    moves: () => log.filter((e) => e.op === 'move')
  };
};

const makeStorage = (seed = {}) => {
  const store = new Map([['labDriveAccessToken', 'fake-token'], ...Object.entries(seed)]);
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear()
  };
};


const CTX_OLD = {
  project: 'CD_project', test: 'Exp_7', instance: '1YCR',
  scientist: 'Nicola DAMELIO', section: 'Data', subsection: 'Structure'
};
const CHAIN = [
  { name: 'projects', id: 'p1' }, { name: 'CD_project', id: 'c1' }, { name: 'Exp_7', id: 'e1' },
  { name: '1YCR', id: 'i1' }, { name: 'data', id: 'd1' }, { name: 'Structure', id: 's1' }
];
const REGISTRY = {
  F_STYLE: { name: 'viewer-style-snapshot.json', ctx: { ...CTX_OLD }, path: CHAIN.map((s) => ({ ...s })), at: 0 },
  F_PDB: {
    name: '1YCR_Nicola_DAMELIO.pdb', ctx: { ...CTX_OLD, title: '1YCR', suffix: 'structure' },
    path: CHAIN.map((s) => ({ ...s })), at: 0
  },
  F_CSV: { name: 'spectrum_Nicola_DAMELIO.csv', ctx: { ...CTX_OLD, title: 'spectrum' }, path: CHAIN.map((s) => ({ ...s })), at: 0 }
};

const fd = makeFetchDrive();
fd.put({ id: 'wsRoot', name: 'Lab Workspace', parent: '', mimeType: FOLDER });
fd.put({ id: 'dsRoot', name: 'GEC-UPJV-projects', parent: 'wsRoot', mimeType: FOLDER });
CHAIN.forEach((seg, i) => fd.put({
  id: seg.id, name: seg.name, parent: i === 0 ? 'dsRoot' : CHAIN[i - 1].id, mimeType: FOLDER
}));
fd.put({ id: 'F_STYLE', name: REGISTRY.F_STYLE.name, parent: 's1', mimeType: 'application/json', text: '{}' });
fd.put({ id: 'F_PDB', name: REGISTRY.F_PDB.name, parent: 's1', mimeType: 'chemical/x-pdb', text: 'ATOM' });
fd.put({ id: 'F_CSV', name: REGISTRY.F_CSV.name, parent: 'd1', mimeType: 'text/csv', text: 'a,b' });

globalThis.localStorage = makeStorage({ labDriveFileRegistry: JSON.stringify(REGISTRY) });
globalThis.fetch = fd.fetch;
const U = await import('./src/utils/driveUpload.js?rename-instance');
U.setDriveRootContext({ id: 'dsRoot', name: 'GEC-UPJV-projects' });

const n = await U.renameDriveFilesFor({ field: 'instance', oldValue: '1YCR', newValue: 'instance1' });
eq(n, 3, 'les trois fichiers de l’instance suivent le renommage');
eq(fd.node('i1').name, 'instance1', 'le DOSSIER de l’instance a été renommé');
eq(fd.renamesOf('i1'), ['instance1'], '…par un renommage (PATCH), le geste juste');
eq(fd.creations('instance1'), 0, 'AUCUN dossier « instance1 » créé : plus de jumeau (le défaut du 08/10/2026)');
eq(fd.moves(), [], 'et aucun fichier n’a été DÉPLACÉ dans une arborescence refabriquée');
eq(fd.node('F_STYLE').name, 'viewer-style-snapshot.json',
  'le style du viewer garde son nom CANONIQUE (jamais rebaptisé Nicola_DAMELIO.json)');
eq(fd.node('F_PDB').name, '1YCR_Nicola_DAMELIO.pdb', 'le .pdb garde le nom de la convention');
eq(fd.node('F_CSV').name, 'spectrum_Nicola_DAMELIO.csv', 'un fichier de donnée garde le sien aussi');
const after = JSON.parse(globalThis.localStorage.getItem('labDriveFileRegistry'));
eq(after.F_STYLE.ctx.instance, 'instance1', 'le registre dit le nom d’AUJOURD’HUI');
eq(after.F_STYLE.path[3].name, 'instance1', '…et la chaîne du dossier a suivi');
eq(after.F_STYLE.path[3].id, 'i1', '…sans avoir changé de dossier');

/* Le même geste sur l'EXPÉRIENCE (autre niveau de dossier) : même règle. */
const ne = await U.renameDriveFilesFor({ field: 'test', oldValue: 'Exp_7', newValue: 'Test_7' });
eq(ne, 3, 'les trois fichiers suivent aussi le renommage de l’expérience');
eq(fd.node('e1').name, 'Test_7', 'le dossier de l’expérience est renommé (pas recréé)');
eq(fd.creations('Test_7'), 0, '…et aucun dossier « Test_7 » n’est créé');
eq(fd.renamesOf('F_STYLE'), [], 'le style du viewer n’est jamais renommé par ces gestes');


/* ── D. LES CONTRATS DE CODE (le défaut ne peut pas revenir) ─────────────── */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const UPLOAD = read('src/utils/driveUpload.js');
const STRUCT = read('src/utils/driveStructure.js');
const ACTIVE = read('src/components/AppModules/activeTestModule.jsx');

has(UPLOAD, 'const newFolderName = (pathIndex >= 0 && String(newValue || \'\')) ? (ctxPathOf(newCtx)[pathIndex] || \'\') : \'\';',
  'le nom du dossier renommé se lit dans le MÊME chemin que son index (ctxPathOf)');
ok(!UPLOAD.includes('driveFolderPath(newCtx)[pathIndex]'),
  '…jamais dans l’ordre HISTORIQUE de driveFolderPath (l’écart d’un cran du 08/10/2026)');
has(UPLOAD, 'const oldFolderName = pathIndex >= 0 ? (ctxPathOf(oldCtx)[pathIndex] || \'\') : \'\';',
  '…et l’ancien nom vient du même tableau');
has(UPLOAD, 'const renamed = (entry.name === suggestDriveFileName(oldCtx) + ext)',
  'un fichier n’est renommé que si son nom ÉTAIT celui de la convention');
has(UPLOAD, 'export const deleteInstanceDriveFolder = async (test) => {',
  'le dossier d’une instance supprimée part à la corbeille (deleteInstanceDriveFolder)');
has(UPLOAD, 'const findInstanceFolder = async (root, test, instanceName) => {',
  '…en retrouvant le dossier de l’instance par son chemin réel');
has(ACTIVE, 'deleteInstanceDriveFolder(t).catch(() => {});',
  'le geste de suppression d’une condition l’appelle');
has(ACTIVE, "if (isLast) deleteTestDriveFolder(t).catch(() => {});",
  '…et la DERNIÈRE emporte aussi le dossier de l’expérience (elle la supprime entièrement)');
has(STRUCT, 'export const pickRenamedSibling = (candidates = [], { appId = \'\' } = {}) => {',
  'la règle du frère à adopter est PURE et nommée');
has(STRUCT, 'const existingObjectFolder = async ({ names = [], parentId = \'\', appId = \'\', skipNames = null, scanStore = null } = {}) => {',
  'l’exécuteur cherche le dossier par son nom PUIS par l’identité');
has(STRUCT, 'if (adopted.name !== name) {', '…et le renomme seulement si son nom a changé');
has(STRUCT, 'const existing = parentKnown ? await existingObjectFolder({',
  'publish adopte le dossier renommé (le plan porte l’identité dans extra.id)');
eq(STRUCT.split('pickRenamedSibling(entry.candidates').length - 1, 1,
  'un seul endroit décide quel frère est le même objet');
/* Une recherche par nom sous un parent INCONNU pourrait tomber sur un dossier
   homonyme d'une autre branche : c'est ce que la garde `parentKnown` empêche. */
has(STRUCT, 'const parentKnown = entry.path.length === 0 || parentPath === \'\' || idByPath.has(parentPath);',
  'la recherche n’a lieu que sous un parent CONNU (jamais sous un parent deviné)');

console.log(`_drive_rename_test: ${passed} passed`);

