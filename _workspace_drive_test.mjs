/* =========================================================================
   _workspace_drive_test.mjs — L'ESPACE DE TRAVAIL ENTIER SUR LE DRIVE.

   Le défaut réparé (voir src/utils/workspaceDrive.js) : la liste des datasets,
   les projets, les suppressions et les identifiants de dossiers vivaient dans
   le navigateur (localStorage) et, pour les datasets, dans Firestore. Résultat
   visible : un dataset créé sur le PC du bureau n'apparaissait pas sur le
   portable, et un dataset supprimé sur un poste revenait sur l'autre — avec son
   dossier Drive.

   Désormais l'espace de travail lui-même est écrit dans
     Lab Workspace/_workspace/state.json            (index + tombes + dossiers)
     Lab Workspace/_workspace/datasets/<id>.json    (le CONTENU du dataset)
   et relu au démarrage sur chaque poste.

   Ce qui est vérifié ici, avec le module RÉEL et un faux Drive :
     • l'index ne porte JAMAIS le contenu (il a son propre fichier) ;
     • une fusion ne perd aucune suppression, et le plus récent décrit ;
     • appliquer l'index ajoute les datasets connus du Drive et JAMAIS ceux qui
       ont une tombe ;
     • l'écriture / la relecture des deux fichiers (état et contenu) passent par
       le bon dossier et refusent un fichier étranger ;
     • l'écriture est regroupée (une requête après un temps de calme) ;
     • App.jsx appelle réellement tout cela au démarrage, à la sauvegarde et à
       l'ouverture d'un dataset qui n'est pas encore sur le poste.
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
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const W = await import('./src/utils/workspaceDrive.js');
const S = await import('./src/utils/driveMirrorStore.js');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. L'index : ce qui décrit un dataset, jamais son contenu ───────────── */
const DS = {
  id: 'ds1',
  title: 'Pepper viruses',
  subtitle: '2026 campaign',
  kind: 'scientific',
  date: '2026-01-05',
  testCount: 7,
  updatedAt: 1770000000000,
  payload: 'LZ_compressed_payload_string',
  isCompressed: true,
  access: { restricted: true, memberNames: ['Nicola', 'Sara'] },
  driveFolder: 'F1'
};
const entry = W.workspaceDatasetEntry(DS, { driveFolder: 'F1' });
ok(!('payload' in entry), 'l’index d’un dataset ne porte JAMAIS son contenu');
ok(!('isCompressed' in entry), '…ni la marque de compression du contenu');
eq(entry.title, 'Pepper viruses', 'l’index garde le titre');
eq(entry.driveFolder, 'F1', '…et l’identifiant Drive de son dossier');
eq(entry.access, { restricted: true, memberNames: ['Nicola', 'Sara'] }, '…et ses droits d’accès');
eq(W.workspaceDatasetEntry({}), null, 'un dataset sans id n’entre pas dans l’index');

const projectEntry = W.workspaceProjectEntry({ id: 'p1', name: 'Aphids', datasetId: 'ds1', scientist: 'Nicola' });
eq(projectEntry.id, 'p1', 'l’index des projets retient l’id');

/* ── 2. L'état complet : construit, relu, fusionné ──────────────────────── */
store.clear();
const mirror = S.addDriveTombstone(
  S.rememberDatasetFolder(S.emptyDriveMirror(), { id: 'ds1', name: 'Pepper viruses', folderId: 'F1' }, 9),
  { id: 'ds3', name: 'Deleted elsewhere', path: '' }, 11
);
const state = W.buildWorkspaceState({
  datasets: [DS, { id: 'ds3', title: 'Deleted elsewhere', updatedAt: 5 }],
  projects: [{ id: 'p1', name: 'Aphids', datasetId: 'ds1' }],
  mirror,
  deletedProjects: [{ id: 'prj_9', datasetId: 'ds1', deletedAt: 4 }],
  at: '2026-02-01T10:00:00.000Z'
});
eq(state.kind, W.WORKSPACE_STATE_KIND, 'l’état porte une marque reconnaissable');
eq(state.datasets.length, 2, 'les deux datasets sont indexés');
eq(state.mirror.tombstones.length, 1, 'les tombes voyagent avec l’état (suppression sur un autre poste)');
eq(state.deletedProjects.length, 1, '…ainsi que les projets supprimés');
eq(state.datasets[0].driveFolder, 'F1', 'l’index porte l’identifiant Drive du dossier du dataset');
eq(state.datasets[1].driveFolder, undefined, 'un dataset sans dossier connu n’en invente pas');

const round = W.parseWorkspaceState(W.workspaceStateJson(state));
eq(round.datasets.map((d) => d.id).sort(), ['ds1', 'ds3'], 'l’état écrit puis relu rend les mêmes datasets');
eq(round.mirror.tombstones.length, 1, '…et les mêmes tombes');
eq(W.parseWorkspaceState('pas du json'), null, 'un contenu illisible ne casse rien (null)');
eq(W.parseWorkspaceState('{"kind":"autre-app"}'), null,
  'un fichier d’une autre application est refusé (on n’écrase pas n’importe quoi)');
ok(W.parseWorkspaceState({ datasets: [{ id: 'x' }] }) !== null,
  'un état sans marque (version antérieure) reste accepté');

/* Fusion : aucune suppression perdue, le plus récent décrit. */
const localState = {
  kind: W.WORKSPACE_STATE_KIND,
  savedAt: '2026-02-02T00:00:00.000Z',
  datasets: [{ id: 'ds1', title: 'Pepper (local)', updatedAt: 200 }],
  projects: [],
  deletedProjects: [{ id: 'prj_local', datasetId: 'ds1', deletedAt: 1 }],
  mirror: { tombstones: [{ id: 'dsX', name: '', path: '', deletedAt: 1 }] }
};
const remoteState = {
  kind: W.WORKSPACE_STATE_KIND,
  savedAt: '2026-02-03T00:00:00.000Z',
  datasets: [
    { id: 'ds1', title: 'Pepper (Drive)', updatedAt: 100 },
    { id: 'ds9', title: 'Only on Drive', updatedAt: 50 }
  ],
  projects: [{ id: 'p9', name: 'Remote project', datasetId: 'ds9' }],
  deletedProjects: [{ id: 'prj_remote', datasetId: 'ds9', deletedAt: 2 }],
  mirror: { tombstones: [{ id: 'ds9', name: '', path: '', deletedAt: 3 }] }
};
const fused = W.mergeWorkspaceStates(localState, remoteState);
eq(fused.datasets.find((d) => d.id === 'ds1').title, 'Pepper (local)',
  'entre deux descriptions, la plus récemment modifiée gagne');
eq(fused.datasets.map((d) => d.id).sort(), ['ds1', 'ds9'], 'les datasets des deux côtés sont réunis');
eq(fused.projects.map((p) => p.id), ['p9'], 'les projets du Drive sont adoptés');
eq(fused.deletedProjects.length, 2, 'les suppressions de projets des deux côtés sont conservées');
eq(fused.mirror.tombstones.length, 2, '…et celles du miroir aussi');
ok(S.isDatasetMirrorDeleted(fused.mirror, { id: 'ds9' }),
  'un dataset supprimé sur le Drive l’est ici (il ne revient pas)');

/* ── 3. Compléter la liste du poste avec celle du Drive ─────────────────── */
const applied = W.applyWorkspaceIndex({
  datasets: [{ id: 'ds1', title: 'Pepper', updatedAt: 300, payload: 'LOCAL' }],
  state: fused
});
const byId = Object.fromEntries(applied.map((d) => [d.id, d]));
eq(Object.keys(byId).sort(), ['ds1'], 'un dataset supprimé (tombe) n’est JAMAIS ajouté à la liste');
eq(byId.ds1.payload, 'LOCAL', 'la copie locale (avec son contenu) est conservée telle quelle');
eq(byId.ds1.updatedAt, 300, '…et sa date de modification n’est pas écrasée par l’index');

const withoutTombstone = W.applyWorkspaceIndex({
  datasets: [],
  state: {
    ...fused,
    mirror: S.emptyDriveMirror()
  }
});
const ids = withoutTombstone.map((d) => d.id).sort();
eq(ids, ['ds1', 'ds9'], 'sans tombe, les datasets du Drive complètent la liste du poste');
eq(withoutTombstone.find((d) => d.id === 'ds9').fromDrive, true,
  '…et ceux qui manquent sont marqués « à relire du Drive »');
eq(withoutTombstone[0].updatedAt >= withoutTombstone[1].updatedAt, true,
  'la liste reste triée du plus récent au plus ancien');

/* ── 4. Les deux fichiers sur le Drive (état + contenu) ─────────────────── */
const fake = { uploads: [], folders: { 'Lab Workspace': 'ws', _workspace: 'W1', datasets: 'WD' }, files: {} };
globalThis.__driveTestMocks = {
  driveToken: 'tok',
  cloud: true,
  ensureLabWorkspaceFolder: async () => 'ws',
  findFolderByName: async (name) => fake.folders[String(name)] || '',
  findDriveFileByName: async (name) => fake.files[String(name)] || '',
  uploadWorkspaceFile: async (arg) => {
    const text = typeof arg.file === 'string'
      ? arg.file
      : (arg.file && typeof arg.file.text === 'function' ? await arg.file.text() : '');
    fake.uploads.push({ folder: arg.folder, name: arg.name, text });
    fake.files[arg.name] = `id_${arg.name}`;
    return { id: `id_${arg.name}`, name: arg.name };
  },
  downloadDriveFileText: async (id) => fake.downloads[id] || ''
};

const written = await W.writeWorkspaceState(state);
ok(written && written.id, 'l’état de l’espace de travail est écrit sur le Drive');
const stateUpload = fake.uploads.find((u) => u.name === W.WORKSPACE_STATE_FILE);
ok(!!stateUpload, '…dans un fichier nommé state.json');
eq(stateUpload.folder, '_workspace', '…Dans _workspace (jamais mêlé aux données du labo)');
ok(stateUpload.text.includes('workspace-state'), '…et le fichier est bien celui de l’application');

fake.downloads = { 'id_state.json': JSON.stringify(state) };
const readBack = await W.readWorkspaceState();
eq(readBack.datasets.map((d) => d.id).sort(), ['ds1', 'ds3'],
  'l’état déposé sur le Drive est relu par n’importe quel poste');

const copy = await W.writeDatasetCopy({ ...DS, id: 'ds1' });
ok(copy && copy.id, 'le CONTENU d’un dataset est déposé sur le Drive');
const copyUpload = fake.uploads.find((u) => u.name === W.workspaceDatasetFileName('ds1'));
ok(!!copyUpload, '…dans _workspace/datasets/ds_ds1.json');
eq(copyUpload.folder, '_workspace/datasets', '…au bon endroit');
ok(copyUpload.text.includes('LZ_compressed_payload_string'), '…avec la charge compressée (le contenu réel du dataset)');

fake.downloads = { id_a: JSON.stringify({ kind: W.WORKSPACE_STATE_KIND, record: { id: 'ds1', title: 'Pepper', payload: 'LZ' } }) };
fake.files[W.workspaceDatasetFileName('ds1')] = 'id_a';
const reread = await W.readDatasetCopy('ds1');
eq(reread.title, 'Pepper', 'le contenu relu depuis le Drive est celui du dataset');
eq(await W.readDatasetCopy('ds2'), null, 'un fichier qui décrit un AUTRE dataset est refusé (jamais de mélange)');

/* ── 5. L'écriture automatique est regroupée ────────────────────────────── */
fake.uploads.length = 0;
const getState = () => ({
  datasets: [{ id: 'ds1', title: 'Pepper', updatedAt: 1 }], projects: [], mirror: S.emptyDriveMirror()
});
const uninstall = W.installWorkspaceAutosave(getState, { delay: 60 });
globalThis.window.dispatchEvent = () => true;
await sleep(200);
const firstBatch = fake.uploads.filter((u) => u.name === W.WORKSPACE_STATE_FILE).length;
eq(firstBatch, 1, 'après un changement, l’état est écrit UNE fois sur le Drive');
await sleep(120);
eq(fake.uploads.filter((u) => u.name === W.WORKSPACE_STATE_FILE).length, firstBatch,
  '…et il n’est pas réécrit tant que rien ne change (pas de requêtes inutiles)');
uninstall();

/* ── 6. Adopter l'état du Drive : les tombes arrivent d'abord ───────────── */
store.clear();
const adopted = W.adoptWorkspaceState(state);
eq(adopted.datasets.length, 2, 'les datasets de l’état du Drive sont rendus à l’appelant');
ok(S.isDatasetMirrorDeleted(S.readDriveMirror(), { id: 'ds3' }),
  '…et ses suppressions sont IMMÉDIATEMENT actives sur ce poste (rien ne ressuscite)');

/* ── 7. App.jsx fait réellement le travail ──────────────────────────────── */
has(APP, 'const state = await readWorkspaceState();', 'App.jsx relit l’état du Drive au démarrage');
has(APP, 'const adopted = adoptWorkspaceState(state);', '…adopte ses suppressions avant tout le reste');
has(APP, 'adoptDeletedProjects(state.deletedProjects)', '…et les projets supprimés ailleurs');
has(APP, 'const adoptedList = readDatasetListCache();',
  '…et la liste que `keys.json` rapporte d’un AUTRE poste est relue (sinon elle n’atteint jamais l’écran)');
has(APP, 'datasets: [...(Array.isArray(prev) ? prev : []), ...adoptedList],',
  '…puis complète la liste des datasets avec celle du Drive');
has(APP, "window.addEventListener('lab:drive-connected'", '…et recommence dès que Drive se reconnecte');
has(APP, 'installWorkspaceAutosave(() => ({', 'chaque changement est renvoyé vers le Drive (en différé)');
has(APP, 'mirrorDatasetContent = (id, payload) => datasetCopyMirrorRef.current.schedule(id, payload)',
  'le CONTENU du dataset est déposé sur le Drive à chaque sauvegarde');
has(APP, 'writeDatasetCopy(body)',
  '…par la fabrique testable (utils/datasetCopyMirror.js), pas par une minuterie anonyme');
has(APP, "window.addEventListener('pagehide', flushDatasetCopy)",
  '…et ce qui attend part TOUT DE SUITE à la fermeture de l’onglet');
has(APP, 'const copy = await readDatasetCopy(id)', 'ouvrir un dataset absent du poste le relit du Drive');
has(APP, 'workspaceIndexRef.current = state;', '…et garde l’index pour que chaque rafraîchissement le ré-applique');
has(APP, 'setDatasetsList((prev) => withoutDeletedDatasets(', '…et la liste affichée écarte tout dataset supprimé');

console.log(`✅ ${passed} tests passés (l’espace de travail entier vit sur le Drive)`);

ok(projectEntry.size > 0, '…et de quoi savoir lequel est le plus complet');
eq(W.workspaceDatasetEntry({ ...DS, kind: 'autre chose' }).kind, 'scientific',
  'un genre inconnu retombe sur « scientific » (jamais de case vide)');
eq(W.workspaceDatasetFileName('ds 1/2'), 'ds_ds_12.json',
  'le fichier de contenu porte un nom de fichier sûr (id slugé)');
eq(W.workspaceDatasetPath('ds1'), '_workspace/datasets/ds_ds1.json',
  '…rangé sous _workspace/datasets (jamais mêlé aux données du labo)');
