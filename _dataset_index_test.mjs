/* =========================================================================
   _dataset_index_test.mjs — LA LISTE DES DATASETS A SA PROPRE COPIE.

   Le défaut réparé : un dataset créé sur un PC n'existait, pour les autres
   fenêtres, que si Firestore l'avait publié. Or une écriture Firestore peut être
   acquittée LOCALEMENT (le SDK « compat » garde ses écritures en attente) ou
   refusée (session expirée) : la fenêtre neuve — navigation privée, autre poste —
   n'avait alors AUCUNE liste à lire, puisque `lab_datasets_local_v2` n'était
   écrit que par le mode « sans Firestore » alors que le code le relit toujours.
   Et l'index du Drive (`_workspace/state.json`) n'était vidé qu'après 2,5 s de
   calme : un dataset créé juste avant la fermeture de l'onglet n'y entrait
   jamais.

   Ce qui est vérifié ici, avec les modules RÉELS :
     • la copie gardée est un INDEX (jamais le contenu — sinon `keys.json`
       dépasse son plafond et PLUS RIEN ne voyage) ;
     • la fusion est une UNION par identifiant : le « [] » d'un navigateur neuf
       ne peut pas effacer la liste des autres postes, et un dataset connu d'un
       seul côté n'est jamais perdu ;
     • le fusionneur est bien celui enregistré pour `lab_datasets_local_v2`
       (les autres clés gardent la règle d'horodatage) ;
     • fermer l'onglet écrit l'index de l'espace de travail TOUT DE SUITE ;
     • App.jsx appelle réellement tout cela (écriture de la copie, relecture de
       la liste adoptée, création d'un dataset publiée et CONFIRMÉE).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un vrai Storage de test, un window qui RELAIE les événements, et un document
   minimal (l'état de l'espace de travail se vide à la fermeture de l'onglet). */
const store = new Map();
const ls = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};
globalThis.localStorage = ls;
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

const D = await import('./src/utils/datasetListIndex.js');
const K = await import('./src/utils/workspaceKeyStore.js');
const W = await import('./src/utils/workspaceDrive.js');
const S = await import('./src/utils/driveMirrorStore.js');
const APP = readFileSync('./src/App.jsx', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 1. Ce qui est gardé : la description, jamais le contenu ─────────────── */
const DS = {
  id: 'ds1',
  title: 'Pepper viruses',
  subtitle: '2026 campaign',
  kind: 'scientific',
  date: '2026-01-05',
  testCount: 7,
  updatedAt: 100,
  payload: 'LZ_compressed_payload_string',
  isCompressed: true,
  access: { restricted: true, memberNames: ['Nicola'] },
  driveFolder: 'F1'
};
const entry = D.datasetListEntry(DS);
ok(!('payload' in entry), 'la copie de la liste ne garde JAMAIS le contenu d’un dataset');
ok(!('isCompressed' in entry), '…ni la marque de compression du contenu');
eq(entry.title, 'Pepper viruses', '…mais bien son titre');
eq(entry.testCount, 7, '…son nombre d’expériences');
eq(entry.driveFolder, 'F1', '…et le dossier Drive qui permet de le renommer/supprimer ailleurs');
eq(D.datasetListEntry({}), null, 'un dataset sans identifiant n’entre pas dans la liste');
eq(D.datasetListEntry({ id: 'a', kind: 'administration' }).kind, 'administration',
  'le genre d’une base d’administration est gardé tel quel');
eq(D.datasetListEntry({ id: 'a', kind: 'autre chose' }).kind, 'scientific',
  'un genre inconnu retombe sur « scientific » (jamais de case vide)');
eq(D.datasetListEntry(DS, { keepContent: true }).payload, 'LZ_compressed_payload_string',
  'sans Firestore la liste EST le contenu : il est gardé');
eq(D.datasetListEntry(DS, { keepContent: true }).isCompressed, true,
  '…avec sa marque de compression (sinon la relecture échoue)');

/* ── 2. L'union : un dataset créé sur un AUTRE poste ne peut pas être perdu ─ */
const here = [{ id: 'ds1', title: 'Pepper (ici)', updatedAt: 300 }];
const elsewhere = [
  { id: 'ds1', title: 'Pepper (Drive)', updatedAt: 100 },
  { id: 'ds9', title: 'Créé sur l’autre poste', updatedAt: 50 }
];
const union = D.mergeDatasetLists(here, elsewhere);
eq(union.map((d) => d.id), ['ds1', 'ds9'], 'l’union réunit les datasets des deux côtés');
eq(union.find((d) => d.id === 'ds1').title, 'Pepper (ici)',
  'entre deux fiches, la plus récemment modifiée décrit le dataset');
eq(D.mergeDatasetLists([], union).length, 2,
  'une liste VIDE (navigateur neuf) n’efface RIEN de la liste partagée');
eq(D.mergeDatasetLists(union, []).map((d) => d.id), ['ds1', 'ds9'],
  '…et réciproquement : le poste qui a la liste ne perd rien');
const contentKept = D.mergeDatasetLists(
  [{ id: 'ds1', updatedAt: 10, payload: 'LZ' }],
  [{ id: 'ds1', title: 'Pepper', updatedAt: 99 }]
);
eq(contentKept[0].payload, 'LZ',
  'une fiche plus récente mais sans contenu ne fait pas perdre le contenu');
eq(contentKept[0].title, 'Pepper', '…et elle apporte sa description');
eq(D.parseDatasetList('pas du json'), [], 'une copie illisible ne casse rien (liste vide)');
eq(D.parseDatasetList(null), [], '…y compris une copie absente');
eq(D.parseDatasetList([{ id: 'x' }, null, 'oups']).map((d) => d.id), ['x'],
  'les entrées sans identifiant sont écartées');

/* ── 3. Le fusionneur est celui du miroir des clés ───────────────────────── */
ok(D.isDatasetListKey('lab_datasets_local_v2'), 'la clé de la liste est reconnue par le fusionneur');
ok(!D.isDatasetListKey('labFiguresLib_global'), '…et les autres clés ne sont pas prises pour elle');
const published = K.mergedKeyValue('lab_datasets_local_v2', JSON.stringify(here), JSON.stringify(elsewhere));
eq(JSON.parse(published).map((d) => d.id), ['ds1', 'ds9'],
  'ce qui part sur _workspace/keys.json est l’UNION (le poste neuf récupère toute la liste)');
eq(K.mergedKeyValue('lab_datasets_local_v2', JSON.stringify(here), JSON.stringify(here)), JSON.stringify(here),
  'deux copies identiques ⇒ aucune réécriture inutile');
eq(K.mergedKeyValue('lab_datasets_local_v2', JSON.stringify(here), '[]'), JSON.stringify(here),
  'une copie vide n’efface pas la liste de ce poste');
eq(K.mergedKeyValue('lab_datasets_local_v2', '[]', JSON.stringify(elsewhere)), JSON.stringify(elsewhere),
  '…et la liste du Drive est adoptée telle quelle quand ce poste n’a rien');
eq(K.mergedKeyValue('labWorkspace_publications', '["a"]', '[]'), null,
  'les autres clés gardent la règle d’horodatage (aucun détournement)');

/* ── 4. La copie du navigateur, écrite à chaque changement ───────────────── */
store.clear();
const written = D.writeDatasetListCache([DS], { storage: ls });
eq(written.map((d) => d.id), ['ds1'], 'la liste est écrite dans le magasin du navigateur');
ok(!JSON.parse(store.get('lab_datasets_local_v2'))[0].payload,
  'en mode Firestore, la copie ne garde pas le contenu (keys.json doit rester petit)');
D.writeDatasetListCache([{ id: 'ds9', title: 'Créé ailleurs', updatedAt: 5 }], { storage: ls });
eq(D.readDatasetListCache(ls).map((d) => d.id).sort(), ['ds1', 'ds9'],
  'un dataset déjà connu ici n’est pas effacé par la liste du moment (UNION)');
eq(D.readDatasetListCache(ls).find((d) => d.id === 'ds9').title, 'Créé ailleurs',
  '…et celui qui arrive y est ajouté, avec sa description');
store.clear();
D.writeDatasetListCache([DS], { keepContent: true, storage: ls });
eq(D.readDatasetListCache(ls)[0].payload, 'LZ_compressed_payload_string',
  'sans Firestore, le contenu reste dans cette liste (c’est la seule copie)');
eq(D.readDatasetListCache({ getItem: () => { throw new Error('magasin inaccessible'); } }), [],
  'un magasin refusé (navigation privée, quota) ne casse jamais la page');
store.clear();
eq(D.writeDatasetListCache([{ id: 'dsX' }]).map((d) => d.id), ['dsX'],
  'sans autre copie, la liste écrite est bien celle du moment');
const savedLocalStorage = globalThis.localStorage;
delete globalThis.localStorage;
eq(D.writeDatasetListCache([{ id: 'dsZ' }]).map((d) => d.id), ['dsZ'],
  'sans magasin du tout (module chargé hors navigateur), la liste est rendue sans erreur');
globalThis.localStorage = savedLocalStorage;
eq(D.writeDatasetListCache([{ id: 'dsY' }], { storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } })
  .map((d) => d.id), ['dsY'],
  'un magasin PLEIN ne casse rien (l’application continue, seule la copie est perdue)');

/* ── 5. L'index du Drive est vidé à la fermeture de l'onglet ─────────────── */
const fake = { uploads: [], folders: { 'Lab Workspace': 'ws', _workspace: 'W1' }, files: {} };
globalThis.__driveTestMocks = {
  driveToken: 'tok',
  cloud: true,
  ensureLabWorkspaceFolder: async () => 'ws',
  findFolderByName: async (name) => fake.folders[String(name)] || '',
  findDriveFileByName: async (name) => fake.files[String(name)] || '',
  uploadWorkspaceFile: async (arg) => {
    fake.uploads.push({ folder: arg.folder, name: arg.name });
    fake.files[arg.name] = `id_${arg.name}`;
    return { id: `id_${arg.name}`, name: arg.name };
  },
  downloadDriveFileText: async () => ''
};
const stateWrites = () => fake.uploads.filter((u) => u.name === W.WORKSPACE_STATE_FILE).length;

const uninstall1 = W.installWorkspaceAutosave(() => ({
  datasets: [{ id: 'ds1', title: 'Pepper', updatedAt: 1 }],
  projects: [],
  mirror: S.emptyDriveMirror()
}), { delay: 5000 });
eq(stateWrites(), 0, 'le premier envoi de l’index est DIFFÉRÉ (le délai de calme court)');
globalThis.document.visibilityState = 'visible';
globalThis.document.dispatchEvent({ type: 'visibilitychange' });
await sleep(30);
eq(stateWrites(), 0, 'un onglet qui reste VISIBLE n’écrit rien d’anticipé');
globalThis.window.dispatchEvent({ type: 'pagehide' });
await sleep(30);
eq(stateWrites(), 1,
  'fermer l’onglet écrit l’index TOUT DE SUITE — un dataset créé une seconde avant y est donc');
uninstall1();
ok((winHandlers.get('pagehide') || new Set()).size === 0,
  '…et la désinstallation retire ce vidage (plus rien ne part après)');
ok((docHandlers.get('visibilitychange') || new Set()).size === 0,
  '…ainsi que l’écoute du passage en arrière-plan');

// Le passage en arrière-plan (mobile, changement d'application) vide lui aussi.
const uninstall2 = W.installWorkspaceAutosave(() => ({
  datasets: [{ id: 'ds2', title: 'Autre', updatedAt: 2 }],
  projects: [],
  mirror: S.emptyDriveMirror()
}), { delay: 5000 });
globalThis.document.visibilityState = 'hidden';
globalThis.document.dispatchEvent({ type: 'visibilitychange' });
await sleep(30);
eq(stateWrites(), 2, 'passer en arrière-plan écrit l’index sans attendre le délai');
uninstall2();

/* ── 6. App.jsx câble réellement tout cela ───────────────────────────────── */
has(APP, "import { writeDatasetListCache, readDatasetListCache } from './utils/datasetListIndex'",
  'App.jsx importe la copie de la liste');
has(APP, 'writeDatasetListCache(datasetsList, { keepContent: !db })',
  'la liste est écrite à CHAQUE changement (sans Firestore : avec son contenu)');
has(APP, 'const adoptedList = readDatasetListCache();',
  'la liste adoptée du Drive est relue (sinon elle n’atteint jamais l’écran)');
has(APP, 'datasets: [...(Array.isArray(prev) ? prev : []), ...adoptedList],',
  '…en COMPLÉTANT la liste du poste, jamais en la remplaçant');
has(APP, 'writeDatasetListCache([localEntry], { keepContent: !db });',
  'un dataset créé existe TOUT DE SUITE dans ce navigateur (sans attendre Firestore)');
has(APP, 'const published = typeof db.waitForPendingWrites ===',
  '…et la création VÉRIFIE que le serveur l’a reçue (sinon ça ne voyage pas)');
has(APP, 'New dataset: Firestore write error:',
  '…et le dit au lieu d’échouer en silence');
has(APP, 'setSaveErrorMsg(`The dataset was created on THIS device',
  '…dans la barre de statut (c’est ce qui manquait pour comprendre)');

console.log(`✅ ${passed} tests passés (la liste des datasets a sa propre copie et voyage)`);
