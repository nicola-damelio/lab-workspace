/* =========================================================================
   _workspace_keys_test.mjs — TOUT CE QUI VIVAIT DANS LE NAVIGATEUR EST SUR LE
   DRIVE AUSSI (voir src/utils/workspaceKeyStore.js).

   Le défaut réparé : publications des scientifiques, bibliothèque de figures,
   éléments étoilés, presets… ne vivaient que dans le navigateur. Deux postes
   n'affichaient donc pas la même chose, et vider le navigateur (ou changer de
   PC) faisait disparaître des données sans copie.

   Les règles testées ici sont celles qui rendent cette synchronisation SÛRE :
     • jamais de secret ni de jeton dans le fichier (_workspace/keys.json) ;
     • une clé absente est adoptée, une clé présente n'est remplacée que si la
       copie du Drive est PLUS RÉCENTE (horodatage par clé) ;
     • rien n'est jamais supprimé du navigateur ;
     • l'observateur d'écritures date chaque clé, et l'envoi est regroupé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage de test (Object avec setItem/getItem/key/length, comme le
   vrai Storage) et un window qui RELAIE vraiment les événements. */
const store = new Map();
const ls = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};
globalThis.localStorage = ls;
const handlers = new Map();
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
  },
  removeEventListener: (type, fn) => { if (handlers.has(type)) handlers.get(type).delete(fn); },
  dispatchEvent: (event) => {
    (handlers.get(event && event.type) || new Set()).forEach((fn) => fn(event));
    return true;
  }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const K = await import('./src/utils/workspaceKeyStore.js');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. Ce qui voyage, et ce qui ne voyage JAMAIS ───────────────────────── */
ok(K.isSyncableKey('labWorkspace_publications'), 'les listes de l’application voyagent');
ok(K.isSyncableKey('labFiguresLib_global'), '…la bibliothèque de figures aussi');
ok(!K.isSyncableKey('labDriveAccessToken'), 'un jeton Google ne voyage JAMAIS');
ok(!K.isSyncableKey('labNcAppPassword'), '…ni un mot de passe Nextcloud');
ok(!K.isSyncableKey('labDriveMirror'), '…ni ce qui est déjà synchronisé par un autre fichier');
ok(!K.isSyncableKey('autre-app-data'), '…ni une clé d’une autre application');
ok(!K.isSyncableKey('labKeySyncMeta'), '…ni les horodatages eux-mêmes');

store.clear();
installObserver();
function installObserver() { K.installKeyObserver(); }

store.set('labWorkspace_publications', '["p1"]');
store.set('labDriveAccessToken', 'secret');
store.set('autre-app-data', 'x');

/* ── 2. La photographie et son horodatage ───────────────────────────────── */
const snap = K.localKeyState(ls, '2026-03-01T00:00:00.000Z');
eq(Object.keys(snap.keys).sort(), ['labWorkspace_publications'],
  'la photographie ne contient que les clés synchronisables');
eq(snap.keys.labWorkspace_publications.v, '["p1"]', '…avec leur valeur brute (jamais modifiée)');
eq(snap.keys.labWorkspace_publications.at, 0,
  'une clé écrite avant l’observateur n’a pas encore d’horodatage (0 = la plus ancienne)');
eq(K.buildKeyState({ values: { labX: 'a', secret: 'b' }, meta: { labX: 12 } }).keys.labX.at, 12,
  'l’horodatage de chaque clé est conservé');
ok(!('secret' in K.buildKeyState({ values: { secret: 'b' } }).keys), 'une clé étrangère est écartée');
eq(K.parseKeyState('pas du json'), null, 'un fichier illisible est ignoré (null)');
eq(K.parseKeyState('{"kind":"autre-app"}'), null, 'un fichier d’une autre application est refusé');
const dangerous = K.parseKeyState(JSON.stringify({
  kind: K.KEY_STATE_KIND, keys: { labDriveAccessToken: { v: 'secret', at: 1 }, labX: { v: 'ok', at: 2 } }
}));
eq(Object.keys(dangerous.keys), ['labX'],
  'un secret glissé dans le fichier du Drive n’est JAMAIS importé dans le navigateur');

/* ── 3. La fusion : le plus récent gagne, rien ne disparaît ─────────────── */
const local = { kind: K.KEY_STATE_KIND, keys: { a: { v: 'local', at: 100 }, b: { v: 'local-only', at: 5 } } };
const remote = {
  kind: K.KEY_STATE_KIND,
  keys: { a: { v: 'remote-old', at: 50 }, c: { v: 'remote-new', at: 200 }, d: { v: 'never-seen', at: 0 } }
};
const fused = K.mergeKeyStates({ local, remote });
eq(fused.adopt, { c: 'remote-new', d: 'never-seen' },
  'seules les clés absentes ici ou plus récentes sur le Drive sont adoptées');
eq(fused.state.keys.a.v, 'local', 'une copie locale plus récente n’est pas écrasée');
eq(Object.keys(fused.state.keys).sort(), ['a', 'b', 'c', 'd'],
  'l’union des deux postes est conservée (aucune clé perdue sur le Drive)');

const newerRemote = K.mergeKeyStates({
  local: { keys: { a: { v: 'local', at: 10 } } },
  remote: { keys: { a: { v: 'remote-newer', at: 99 } } }
});
eq(newerRemote.adopt, { a: 'remote-newer' },
  'une clé modifiée sur l’autre poste après la nôtre est bien adoptée');

/* ── 4. Adoption + observateur d’écritures ─────────────────────────────── */
store.clear();
const written = K.applyAdoptedKeys({ labWorkspace_publications: '["adopted"]', labDriveAccessToken: 'x' },
  { meta: { labWorkspace_publications: { at: 42 } } });
eq(written, ['labWorkspace_publications'], 'une clé adoptée est écrite… et un secret est refusé');
eq(store.get('labWorkspace_publications'), '["adopted"]', '…avec la valeur du Drive');
eq(K.readKeyMeta(ls).labWorkspace_publications, 42, '…et datée, pour la prochaine comparaison');

ls.setItem('labWorkspace_publications', '["edited"]');
ok(K.readKeyMeta(ls).labWorkspace_publications > 42,
  'l’observateur date toute écriture d’une clé synchronisable (c’est ce qui arbitre entre deux postes)');
const before = K.readKeyMeta(ls).labDriveAccessToken;
ls.setItem('labDriveAccessToken', 'secret2');
eq(K.readKeyMeta(ls).labDriveAccessToken, before, '…et jamais une clé secrète');

/* ── 5. Le fichier du Drive : _workspace/keys.json ─────────────────────── */
const fake = { uploads: [], files: { 'Lab Workspace': 'ws', _workspace: 'W1' }, downloads: {} };
globalThis.__driveTestMocks = {
  driveToken: 'tok',
  cloud: true,
  ensureLabWorkspaceFolder: async () => 'ws',
  findFolderByName: async (name) => fake.files[String(name)] || '',
  findDriveFileByName: async (name) => (fake.downloads[`name:${name}`] ? `id_${name}` : ''),
  uploadWorkspaceFile: async (arg) => {
    const text = typeof arg.file === 'string'
      ? arg.file
      : (arg.file && typeof arg.file.text === 'function' ? await arg.file.text() : '');
    fake.uploads.push({ folder: arg.folder, name: arg.name, text });
    fake.downloads[`name:${arg.name}`] = true;
    return { id: `id_${arg.name}`, name: arg.name };
  },
  downloadDriveFileText: async (id) => fake.downloads[String(id)] || ''
};

const state = K.localKeyState(ls);
const put = await K.writeKeyState(state);
ok(put && put.id, 'les clés du navigateur sont déposées sur le Drive');
const upload = fake.uploads.find((u) => u.name === K.KEY_STATE_FILE);
ok(!!upload, '…dans un fichier nommé keys.json');
eq(upload.folder, '_workspace', '…dans le dossier réservé à l’application');
ok(!upload.text.includes('secret2'), '…et JAMAIS avec un jeton dedans');

fake.downloads['id_keys.json'] = JSON.stringify(state);
const back = await K.readKeyState();
eq(back.keys.labWorkspace_publications.v, '["edited"]', 'le fichier du Drive est relu correctement');

const adoptedRun = await K.adoptKeysFromDrive();
ok(Array.isArray(adoptedRun.adopted), 'adopter les clés du Drive rend la liste de ce qui a changé');
ok(!!adoptedRun.state, '…et la photographie à renvoyer (l’union des deux postes)');

/* ── 6. L'envoi est regroupé (une requête après un temps de calme) ──────── */
await sleep(2500);                        // la fenêtre anti-rafale est libre
fake.uploads.length = 0;
const uninstall = K.installKeyAutosave({ delay: 50 });
ls.setItem('labWorkspace_publications', '["changed"]');
ls.setItem('labWorkspace_publications', '["changed again"]');
await sleep(700);       // le regroupement laisse 500 ms de calme avant d'écrire
const batch = fake.uploads.filter((u) => u.name === K.KEY_STATE_FILE).length;
eq(batch, 1, 'deux modifications rapprochées ne font qu’UN envoi (regroupement)');
const sent = fake.uploads.filter((u) => u.name === K.KEY_STATE_FILE)[0];
ok(sent.text.includes('changed again'), '…et c’est bien la DERNIÈRE valeur qui part sur le Drive');
uninstall();

/* ── 7. App.jsx branche réellement tout cela ───────────────────────────── */
has(APP, 'installKeyObserver();', 'App.jsx installe l’observateur d’écritures');
has(APP, 'const keys = await adoptKeysFromDrive()', 'App.jsx adopte les clés du Drive au démarrage');
has(APP, 'writeKeyState(keys.state)', '…et renvoie l’union des deux postes vers le Drive');
has(APP, 'return installKeyAutosave({ delay: 4000 });', '…puis les renvoie à chaque changement');

console.log(`✅ ${passed} tests passés (les clés du navigateur vivent aussi sur le Drive)`);

eq(K.syncableKeysIn(ls).sort(), ['labWorkspace_publications'],
  'la photographie ne retient que les clés de l’application (aucun secret)');
