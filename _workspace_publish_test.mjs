/* =========================================================================
   _workspace_publish_test.mjs — UNE SUPPRESSION NE SE PERD JAMAIS À L'ÉCRITURE.

   Le défaut réparé (voir src/utils/workspaceDrive.js) : un dataset supprimé sur
   un poste « revenait » en ouvrant l'application sur l'autre. L'index partagé
   (`_workspace/state.json`) portait bien la tombe, mais le poste qui s'ouvrait
   RÉÉCRIVAIT cet index avant d'avoir lu celui du Drive — et avec SA SEULE
   mémoire (le miroir `labDriveMirror`, vide de cette suppression) : la tombe de
   l'autre poste était EFFACÉE du Drive, et le dataset ressuscitait partout.

   Deux garde-fous, vérifiés ici avec les modules RÉELS et un faux Drive :
     ① l'état publié n'est jamais plus pauvre que le dernier état LU du Drive —
       les tombes (et le registre des dossiers) s'ADDITIONNENT
       (`publishableWorkspaceState`, PUR) ;
     ② chaque rafale d'écriture RELIT l'index du Drive avant de le réécrire
       (`installWorkspaceAutosave.flush`) ; le vidage de fermeture d'onglet, qui
       n'a pas le temps de relire, garde la mémoire déjà acquise.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un vrai Storage de test, un window qui RELAIE les événements (le vidage de
   fermeture d'onglet est branché dessus) et un document minimal. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};
const winHandlers = new Map();
const docHandlers = new Map();
const addTo = (map) => (type, fn) => {
  if (!map.has(type)) map.set(type, new Set());
  map.get(type).add(fn);
};
const removeFrom = (map) => (type, fn) => { if (map.has(type)) map.get(type).delete(fn); };
globalThis.window = {
  addEventListener: addTo(winHandlers),
  removeEventListener: removeFrom(winHandlers),
  dispatchEvent: (event) => {
    (winHandlers.get(event && event.type) || new Set()).forEach((fn) => fn(event));
    return true;
  }
};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: addTo(docHandlers),
  removeEventListener: removeFrom(docHandlers),
  dispatchEvent: (event) => {
    (docHandlers.get(event && event.type) || new Set()).forEach((fn) => fn(event));
    return true;
  }
};
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

/* ── Un faux Drive : des fichiers réels, et un JOURNAL lu/écrit ─────────── */
const fake = {
  folders: { 'Lab Workspace': 'ws', _workspace: 'W1' },
  files: {},
  contents: {},
  uploads: [],
  journal: []
};
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
    const id = `id_${arg.name}`;
    fake.files[arg.name] = id;
    fake.contents[id] = text;
    fake.uploads.push({ folder: arg.folder, name: arg.name, text });
    fake.journal.push({ type: 'write', name: arg.name });
    return { id, name: arg.name };
  },
  downloadDriveFileText: async (id) => {
    fake.journal.push({ type: 'read', id });
    return fake.contents[id] || '';
  }
};

/** Déposer un état sur le Drive (le fichier `_workspace/state.json`). */
const seedState = (state) => {
  fake.files[W.WORKSPACE_STATE_FILE] = 'id_state.json';
  fake.contents['id_state.json'] = W.workspaceStateJson(state);
};
const uploadsOfState = () => fake.uploads.filter((u) => u.name === W.WORKSPACE_STATE_FILE);

/* ── 1. La règle PURE : jamais moins que ce qu'on a lu ──────────────────── */

/* Ce poste ne connaît QUE sa tombe (il vient de supprimer un dataset local). */
const localOnly = {
  kind: W.WORKSPACE_STATE_KIND,
  datasets: [{ id: 'ds1', title: 'Pepper', updatedAt: 300 }],
  mirror: S.addDriveTombstone(S.emptyDriveMirror(), { id: 'dsLocal', name: '', path: '' }, 5)
};
/* Le Drive, lui, porte la tombe d'un AUTRE poste — et un dossier connu de lui seul. */
const remoteOnly = {
  kind: W.WORKSPACE_STATE_KIND,
  datasets: [{ id: 'ds9', title: 'Only on Drive', updatedAt: 50 }],
  mirror: S.addDriveTombstone(
    S.rememberDatasetFolder(S.emptyDriveMirror(), { id: 'ds1', name: 'Pepper', folderId: 'F1' }, 9),
    { id: 'ds3', name: 'Deleted elsewhere', path: '' }, 11)
};

const published = W.publishableWorkspaceState(localOnly, remoteOnly);
ok(S.isDatasetMirrorDeleted(published.mirror, { id: 'ds3' }),
  'la tombe du Drive entre dans l’état publié (elle ne peut pas être effacée)');
ok(S.isDatasetMirrorDeleted(published.mirror, { id: 'dsLocal' }),
  '…et celle de ce poste reste (une tombe ne s’oublie jamais)');
eq(published.mirror.datasets['id:ds1'].folderId, 'F1',
  'le registre des dossiers du Drive est adopté (le poste n’oublie pas où viser)');
eq(published.datasets.map((d) => d.id), ['ds1'],
  'la liste publiée reste celle de CE poste (le Drive la complète, ne la remplace pas)');

const other = W.publishableWorkspaceState(remoteOnly, localOnly);
ok(S.isDatasetMirrorDeleted(other.mirror, { id: 'ds3' }) && S.isDatasetMirrorDeleted(other.mirror, { id: 'dsLocal' }),
  'la règle tient dans les DEUX sens (l’ordre des arguments ne perd rien)');
eq(W.publishableWorkspaceState(localOnly, null).mirror.tombstones.length, 1,
  'sans état du Drive, l’état du poste part tel quel');
eq(W.publishableWorkspaceState(null, remoteOnly), null,
  'un état local qui n’en est pas un ne se publie pas (on n’écrit pas n’importe quoi)');
eq(typeof W.lastRemoteWorkspaceState, 'function',
  'ce que ce poste a lu du Drive est RETENU (et donc inspectable)');
eq(typeof W.rememberRemoteWorkspaceState, 'function', '…et mémorisable sans réseau');

/* ── 2. LE DÉFAUT : deux postes, une suppression, et une copie périmée ──── */
/* Ce poste vient de s'ouvrir et n'a ENCORE RIEN lu du Drive : c'est dans cet
   état précis — mémoire vide — que sa première réécriture effaçait les tombes
   de l'autre poste. La relecture juste avant écriture est donc la seule chose
   qui puisse l'en informer. */
eq(W.lastRemoteWorkspaceState(), null,
  'mémoire du Drive VIDE à l’ouverture (c’est là que le défaut naissait)');
/* PC1 a supprimé « ds3 » : la tombe est DANS l'index du Drive. */
seedState(W.buildWorkspaceState({
  datasets: [{ id: 'ds1', title: 'Pepper', updatedAt: 300 }],
  mirror: S.addDriveTombstone(S.emptyDriveMirror(), { id: 'ds3', name: 'Deleted on PC1', path: '' }, 42),
  at: '2026-10-09T09:00:00.000Z'
}));
/* PC2 s'ouvre : sa copie locale est PÉRIMÉE — elle ne connaît pas la tombe, et
   sa liste affiche encore le dataset supprimé (c'est le cache du navigateur).
   C'est exactement l'état dans lequel le défaut se produisait. */
store.clear();
const pc2List = [
  { id: 'ds1', title: 'Pepper', updatedAt: 300 },
  { id: 'ds3', title: 'Deleted on PC1', updatedAt: 5 }
];
const staleState = () => ({
  datasets: pc2List,
  projects: [],
  deletedProjects: [],
  revivedProjects: [],
  mirror: S.emptyDriveMirror() // PC2 n'a encore rien adopté du Drive
});
fake.uploads.length = 0;
fake.journal.length = 0;
const uninstall = W.installWorkspaceAutosave(staleState, { delay: 200 });
await sleep(600);
uninstall();

const readAt = fake.journal.findIndex((e) => e.type === 'read');
const writeAt = fake.journal.findIndex((e) => e.type === 'write');
ok(readAt !== -1, 'avant d’écrire, l’index du Drive est RELU');
ok(writeAt === -1 || readAt < writeAt, '…et la relecture PRÉCÈDE l’écriture (jamais l’inverse)');

const uploads = uploadsOfState();
eq(uploads.length, 1, 'la rafale écrit l’index UNE fois');
const publishedState = W.parseWorkspaceState(uploads[0].text);
ok(S.isDatasetMirrorDeleted(publishedState.mirror, { id: 'ds3' }),
  'la réécriture d’un poste périmé N’EFFACE PAS la suppression de l’autre poste');
eq(W.applyWorkspaceIndex({ datasets: pc2List, state: publishedState, mirror: publishedState.mirror })
  .map((d) => d.id), ['ds1'],
  '…et le dataset supprimé ailleurs reste absent de la liste que les postes relisent');

/* ── 3. Lire l'index du Drive, c'est le RETENIR ─────────────────────────── */
store.clear();
seedState(remoteOnly);
const readBack = await W.readWorkspaceState();
ok(readBack && S.isDatasetMirrorDeleted(readBack.mirror, { id: 'ds3' }), 'l’index du Drive est relu');
ok(S.isDatasetMirrorDeleted(W.lastRemoteWorkspaceState().mirror, { id: 'ds3' }),
  '…et ce qui vient d’être lu RESTE en mémoire (la prochaine écriture en héritera)');

/* ── 4. Fermer l'onglet : pas le temps de relire, mais rien ne se perd ──── */
fake.uploads.length = 0;
fake.journal.length = 0;
const uninstall2 = W.installWorkspaceAutosave(() => ({
  ...staleState(),
  datasets: [{ id: 'ds1', title: 'Pepper (renamed)', updatedAt: 301 }]
}), { delay: 60000 });
globalThis.window.dispatchEvent({ type: 'pagehide' });
await sleep(150);
uninstall2();

eq(fake.journal.some((e) => e.type === 'read'), false,
  'le vidage de fermeture d’onglet ne fait AUCUNE relecture (le temps manque)');
const pagehideUpload = uploadsOfState().pop();
const pagehideState = W.parseWorkspaceState(pagehideUpload.text);
ok(S.isDatasetMirrorDeleted(pagehideState.mirror, { id: 'ds3' }),
  '…et pourtant il ne publie pas moins que ce que le poste a lu (la mémoire suffit)');
eq(pagehideState.datasets.map((d) => d.id), ['ds1'],
  '…le renommage de ce poste, lui, part bien (on n’oublie pas ce qu’on vient de faire)');

/* ── 5. App.jsx passe réellement par ce chemin ──────────────────────────── */
has(APP, 'installWorkspaceAutosave(() => ({',
  'App.jsx arme l’écriture différée de l’index partagé');
has(APP, 'mirror: readDriveMirror()',
  '…avec le miroir de CE poste — que l’adoption a complété des tombes des autres');
has(APP, 'const adopted = adoptWorkspaceState(state);',
  '…adoption qui, au démarrage, précède toute réécriture');

console.log(`✅ ${passed} tests passés (une suppression ne se perd jamais à l’écriture)`);
