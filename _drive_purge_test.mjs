/* =========================================================================
   _drive_purge_test.mjs — UNE SUPPRESSION INACHEVÉE EST REPRISE.

   LE DÉFAUT (constaté sur le Drive réel) : le dossier d'un dataset SUPPRIMÉ
   dans le programme était encore là — `GEC-UPJV-pp`, portant des projets
   (`p53H`) et une expérience (`pdbs_interactions`) d'un autre dataset. Le
   programme et le Drive ne se ressemblaient plus : « ce que j'élimine dans le
   programme doit être éliminé sur le Drive, autrement ce n'est pas un miroir ».

   DEUX CAUSES, deux réparations :
     1. le geste de suppression ne visait qu'UN dossier (le premier que la
        recherche rendait) : un jumeau, un dossier resté sous un ancien titre ou
        l'ancrage `dataset_<id>` gardaient leurs fichiers. La suppression
        rassemble maintenant TOUS les dossiers du dataset ;
     2. quand la mise à la corbeille n'aboutissait pas (Drive éteint, jeton
        expiré, quota, recherche en échec), la tombe était écrite — donc la
        suppression était actée — mais RIEN ne reprenait jamais le geste : le
        dossier restait pour toujours. La tombe retient maintenant le dossier
        visé (`folderId`) ET l'état de sa corbeille (`purgedAt`), et
        `mirrorPurgeDeletedDatasets` reprend les tombes inachevées au démarrage
        et à la reconnexion.

   Vérifié ici avec les modules RÉELS et un faux Drive : les parties PURES
   (folderId/purgedAt, fusion entre postes, file de reprise), la suppression
   exhaustive, l'échec PUIS la reprise, et l'idempotence.
   ========================================================================= */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage minimal : les modules testés sont ceux du navigateur. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => { store.set(String(k), String(v)); },
  removeItem: (k) => { store.delete(String(k)); }
};
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const S = await import('./src/utils/driveMirrorStore.js');
const DRIVE = await import('./src/utils/driveMirror.js');
const APP = readFileSync('./src/App.jsx', 'utf8');
const MIRROR_SRC = readFileSync('./src/utils/driveMirror.js', 'utf8');
const STORE_SRC = readFileSync('./src/utils/driveMirrorStore.js', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);

/* ── 1. La tombe RETIENT de quoi finir le travail ────────────────────────── */

const tomb = S.addDriveTombstone(S.emptyDriveMirror(),
  { id: 'ds1', name: 'GEC-UPJV-pp', path: '', folderId: 'PP1' }, 10);
eq(tomb.tombstones[0].folderId, 'PP1', 'la tombe retient le dossier qu’elle a visé');
eq(tomb.tombstones[0].purgedAt, 0, '…et dit que sa mise à la corbeille RESTE à faire');
eq(S.unpurgedDatasetTombstones(tomb).map((t) => t.id), ['ds1'],
  'une suppression inachevée est dans la file de reprise');

const done = S.markDriveTombstonePurged(tomb, { id: 'ds1', name: 'GEC-UPJV-pp', path: '' }, 20);
eq(done.tombstones[0].purgedAt, 20, 'une corbeille réussie se note');
eq(S.unpurgedDatasetTombstones(done).length, 0, '…et sort de la file de reprise');
eq(S.markDriveTombstonePurged(done, { id: 'ds1' }, 30).tombstones[0].purgedAt, 20,
  'une corbeille déjà faite n’est pas redatée (idempotent)');
eq(S.markDriveTombstonePurged(done, { id: 'inconnu', path: '' }, 30).tombstones.length, 1,
  'marquer une tombe qui n’existe pas n’en crée pas une (le marqueur suit une suppression, il ne la crée pas)');

const folderTomb = S.addDriveTombstone(S.emptyDriveMirror(),
  { id: 'ds1', name: 'Pepper', path: 'projects/Aphids' }, 5);
eq(S.unpurgedDatasetTombstones(folderTomb).length, 0,
  'la tombe d’un DOSSIER n’est pas une suppression de dataset (rien à reprendre)');

/* ── 2. Le fait VOYAGE entre postes ──────────────────────────────────────── */

const here = S.addDriveTombstone(S.emptyDriveMirror(),
  { id: 'ds1', name: 'Pepper', path: '', folderId: 'F1', purgedAt: 42 }, 10);
const there = S.addDriveTombstone(S.emptyDriveMirror(), { id: 'ds1', name: 'Pepper', path: '' }, 99);
const fused = S.mergeDriveMirrors(there, here);
eq(fused.tombstones[0].folderId, 'F1',
  'le dossier connu d’un poste n’est pas perdu par la tombe plus récente d’un autre');
eq(fused.tombstones[0].purgedAt, 42, '…ni le fait que sa corbeille a abouti');
eq(S.unpurgedDatasetTombstones(S.mergeDriveMirrors(here, S.emptyDriveMirror())).length, 0,
  'l’état du Drive (sans le fait) ne rouvre pas une corbeille déjà faite');

/* ── 3. Le faux Drive : jumeaux, ancrage, panne ──────────────────────────── */

let calls = [];
let folders = new Map();
let metaThrows = false;
let listThrows = false;
let trashWorks = true;

const TRASHED = () => calls.filter((c) => c[0] === 'trash').map((c) => c[1]).sort();

globalThis.__driveTestMocks = {
  driveToken: 'tok',
  cloud: true,
  ensureLabWorkspaceFolder: async () => 'ws',
  findFolderByName: async (name, parent) => {
    calls.push(['findFolder', name, parent]);
    return folders.get(`${parent}/${name}`) || '';
  },
  listFoldersByName: async (name, parent) => {
    calls.push(['listFolders', name, parent]);
    if (listThrows) throw new Error('Drive muet (5xx)');
    return (folders.get(`twins/${parent}/${name}`) || [])
      .map((id) => ({ id, name, createdTime: '2026-01-01T00:00:00.000Z' }));
  },
  getDriveFileMeta: async (id) => {
    calls.push(['meta', id]);
    if (metaThrows) throw new Error('quota');
    return { id: String(id), name: 'x', trashed: false };
  },
  trashDriveFile: async (id) => { calls.push(['trash', id]); return trashWorks; }
};

/* ── 4. La suppression prend TOUS les dossiers du dataset ────────────────── */

store.clear();
/* F1 = le dossier du titre courant ; F2 = un JUMEAU du même nom (resté d'une
   recherche qui avait échoué) ; F3 = l'ancrage `dataset_<id>` d'avant que le
   titre soit connu. Le défaut ne prenait QUE F1 : F2 et F3 gardaient leurs
   fichiers, donc le Drive cessait d'être le miroir du programme. */
folders = new Map([
  ['ws/Pepper_viruses', 'F1'],
  ['twins/ws/Pepper_viruses', ['F1', 'F2']],
  ['twins/ws/dataset_ds1', ['F3']]
]);
calls = [];
const del = await DRIVE.mirrorDeleteDataset({ id: 'ds1', name: 'Pepper viruses', extraNames: ['old title'] });
ok(del.ok, 'supprimer un dataset se termine correctement');
eq(TRASHED(), ['F1', 'F2', 'F3'],
  'TOUS les dossiers du dataset partent à la corbeille (jumeau et ancrage `<id>` compris)');
eq(del.folderIds.slice().sort(), ['F1', 'F2', 'F3'], '…et tous sont annoncés');
ok(S.isDatasetMirrorDeleted(S.readDriveMirror(), { id: 'ds1' }), '…et la tombe est écrite');
ok(S.unpurgedDatasetTombstones(S.readDriveMirror()).length === 0,
  '…avec la corbeille marquée FAITE (rien à reprendre)');

/* ── 5. Une corbeille qui ÉCHOUE est REPRISE, même longtemps après ───────── */

store.clear();
metaThrows = true;   // le Drive ne répond pas au moment du geste (quota…)
trashWorks = false;  // …et refuse la mise à la corbeille
folders = new Map([
  ['ws/GEC-UPJV-pp', 'PP1'],
  ['twins/ws/GEC-UPJV-pp', ['PP1']]
]);
calls = [];
const del2 = await DRIVE.mirrorDeleteDataset({ id: 'ds2', name: 'GEC-UPJV-pp' });
ok(del2.ok, 'supprimer un dataset avec un Drive muet ne lève pas (on rend un compte rendu)');
eq(del2.trashed, false, '…rien n’est annoncé comme rangé à la corbeille');
eq(del2.folderIds, [], '…et aucun dossier réglé n’est annoncé');
eq(S.unpurgedDatasetTombstones(S.readDriveMirror()).map((t) => t.id), ['ds2'],
  '…et la suppression reste À FAIRE — c’est ce qui manquait');
eq(S.readDriveMirror().tombstones[0].folderId, 'PP1',
  '…la tombe retient le dossier trouvé, même si le Drive n’a pas répondu depuis');

metaThrows = false;  // le Drive revient (autre session, autre poste, plus tard)
trashWorks = true;
calls = [];
const purge = await DRIVE.mirrorPurgeDeletedDatasets();
eq(purge.trashed, 1, 'la reprise met à la corbeille le dossier resté derrière');
eq(TRASHED(), ['PP1'], '…le bon dossier (retrouvé par son identifiant)');
eq(S.unpurgedDatasetTombstones(S.readDriveMirror()).length, 0, '…et la tombe est réglée');
const again = await DRIVE.mirrorPurgeDeletedDatasets();
eq(again.checked, 0, 'une reprise qui n’a plus rien à faire ne fait AUCUNE requête');

/* Un Drive muet au moment de la REPRISE aussi : rien n’est marqué fait. */
S.writeDriveMirror(S.addDriveTombstone(S.emptyDriveMirror(), { id: 'ds3', name: 'Muette' }, 1), { notify: false });
listThrows = true;
calls = [];
const mute = await DRIVE.mirrorPurgeDeletedDatasets();
eq(mute.trashed, 0, 'un Drive muet ne fait rien croire');
eq(mute.left, 1, '…la tombe reste à reprendre');
eq(S.unpurgedDatasetTombstones(S.readDriveMirror()).length, 1, '…et n’est pas marquée faite');
listThrows = false;

/* ── 6. Le branchement RÉEL ──────────────────────────────────────────────── */

has(STORE_SRC, 'export const unpurgedDatasetTombstones',
  'la file des suppressions inachevées est exportée par le magasin du miroir');
has(STORE_SRC, 'export const markDriveTombstonePurged', '…avec le marqueur de corbeille faite');
has(MIRROR_SRC, 'export const mirrorPurgeDeletedDatasets', 'la reprise existe');
has(MIRROR_SRC, 'const deletedDatasetFolderIds = async',
  'la suppression rassemble TOUS les dossiers du dataset');
has(MIRROR_SRC, 'const twins = await listFoldersByName(candidate, workspaceId);',
  '…en listant les jumeaux par leur nom EXACT (jamais une recherche approximative)');
has(MIRROR_SRC, 'markDriveTombstonePurged(mirror, { ...scope',
  '…et une tombe n’est réglée que si le geste a abouti');
has(APP, 'import { mirrorDeleteDataset, mirrorRenameDataset, mirrorPurgeDeletedDatasets }',
  'App.jsx connaît la reprise des suppressions inachevées');
has(APP, 'return mirrorPurgeDeletedDatasets();',
  '…et la relance au démarrage / à chaque reconnexion au Drive');
has(APP, "window.addEventListener('lab:drive-connected'", '…sans perdre la reconnexion au Drive');
ok(existsSync('./_purge_orphan_datasets.mjs'),
  'un outil met à la corbeille les dossiers des datasets supprimés restés sur le Drive');
const tool = readFileSync('./_purge_orphan_datasets.mjs', 'utf8');
has(tool, '--apply-unknown',
  '…qui ne touche à un dossier INCONNU de l’index que sur demande explicite');
has(tool, 'trashed: true', '…et ne supprime jamais définitivement (tout part à la corbeille)');

console.log(`✅ ${passed} tests passés (une suppression inachevée est REPRISE : le Drive reste le miroir du programme)`);

