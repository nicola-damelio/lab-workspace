/* =========================================================================
   _dataset_dir_twins_test.mjs — UN SEUL `projects/`, UN SEUL `protocols/`.

   Le défaut constaté sur le Drive RÉEL le 19/09/2026 (dataset
   « GEC-UPJV-projects ») :
     • deux dossiers `projects` à la racine du dataset — celui du 11/09 (4
       sous-dossiers : bianca, p53H, tests, unassigned) et un JUMEAU créé le
       19/09 à 11:42 (2 sous-dossiers) ;
     • deux dossiers `protocols`, tous les deux vides ;
     • la bibliothèque d'images du projet p53H ÉPARPILLÉE entre les deux :
       figures jusqu'à 11:29 dans l'ancien, 38 fichiers de 13:48 à 17:55 dans le
       nouveau — donc « mes figures sont sur le Drive mais le programme ne les
       voit plus ».
   Cause : une RECHERCHE qui échoue (quota 403, 5xx, délai) était confondue avec
   « le dossier n'existe pas », car `findOrCreateFolder` créait après un `catch`
   qui rendait ''. Voir src/utils/datasetDirTwins.js et docs/DRIVE-MIRROR.md.

   Ce qui est vérifié ici :
     1. la décision PURE entre jumeaux (contenu d'abord, puis ancienneté) et la
        règle de sécurité : un jumeau REMPLI — ou de contenu INCONNU — n'est
        jamais mis à la corbeille ;
     2. le registre des conteneurs (identité retenue, fusion entre postes,
        oublié quand le conteneur / le dataset est supprimé) ;
     3. le branchement RÉEL : la recherche stricte, l'absence de création après
        un échec, et le résolveur unique utilisé partout où un conteneur
        canonique est visé.
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
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};

const S = await import('./src/utils/driveMirrorStore.js');
const TWINS = await import('./src/utils/datasetDirTwins.js');
/* Les sources sont relues avec des fins de ligne NORMALISÉES : quelques
   assertions portent sur deux lignes consécutives (le dépôt est en CRLF). */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const UPLOAD = read('./src/utils/driveUpload.js');
const FIGURES = read('./src/utils/figuresFolder.js');
const MIRROR = read('./src/utils/driveMirror.js');
const DOC = read('./docs/DRIVE-MIRROR.md');

let passed = 0;
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);


/* ── 1. La décision entre jumeaux (PUR) ──────────────────────────────────── */

eq(TWINS.CANONICAL_DATASET_DIRS, ['projects', 'backups', 'protocols', 'storage', 'publications'],
  'seuls ces conteneurs peuvent vivre directement dans un dataset');
ok(TWINS.isCanonicalDatasetDir('projects') && TWINS.isCanonicalDatasetDir('protocols'),
  'projects / protocols sont des conteneurs canoniques');
ok(!TWINS.isCanonicalDatasetDir('p53H') && !TWINS.isCanonicalDatasetDir('images'),
  'un projet ou un dossier d’images n’en est pas un (il ne passe pas par ce résolveur)');

/* LE CAS RÉEL : `projects` du 11/09 (4 éléments) contre le jumeau du 19/09 (2). */
const realProjects = [
  { id: '1-77Jv9', createdTime: '2026-09-19T11:42:30.517Z', items: 2 },
  { id: '1kYVKE', createdTime: '2026-09-11T15:29:33.104Z', items: 4 }
];
eq(TWINS.pickCanonicalFolder(realProjects).id, '1kYVKE',
  'le conteneur qui PORTE le plus de contenu est retenu (même s’il est plus ancien)');
eq(TWINS.emptyTwinIds(realProjects, '1kYVKE'), [],
  'un jumeau REMPLI n’est jamais mis à la corbeille (ses figures seraient perdues)');

/* LES DEUX `protocols` SONT VIDES : le plus ancien reste, l’autre part. */
const emptyProtocols = [
  { id: 'P19', createdTime: '2026-09-19T11:44:08.770Z', items: 0 },
  { id: 'P11', createdTime: '2026-09-11T15:29:35.362Z', items: 0 }
];
eq(TWINS.pickCanonicalFolder(emptyProtocols).id, 'P11',
  'à contenu égal, c’est le PLUS ANCIEN (l’arborescence d’origine) qui reste');
eq(TWINS.emptyTwinIds(emptyProtocols, 'P11'), ['P19'],
  'le jumeau CONNU VIDE part à la corbeille');

/* SÉCURITÉ : un contenu INCONNU (Drive muet) ne fait ni gagner ni perdre un
   conteneur — sans quoi une panne de liste ferait mettre à la corbeille un
   dossier plein. */
const unknown = [{ id: 'U1', createdTime: '2026-09-11T00:00:00Z', items: null }];
eq(TWINS.knownItemsOf(unknown[0]), null, 'un contenu inconnu se distingue de « vide »');
eq(TWINS.emptyTwinIds(unknown, 'OTHER'), [], 'un contenu INCONNU n’est jamais « vide » : rien à la corbeille');
const mixed = [
  { id: 'FULL', createdTime: '2026-09-19T00:00:00Z', items: 7 },
  { id: 'MUTE', createdTime: '2026-09-10T00:00:00Z', items: null },
  { id: 'EMPTY', createdTime: '2026-09-20T00:00:00Z', items: 0 }
];
eq(TWINS.pickCanonicalFolder(mixed).id, 'FULL', 'le contenu connu le plus rempli gagne');
eq(TWINS.emptyTwinIds(mixed, 'FULL'), ['EMPTY'],
  'seul le jumeau CONNU VIDE est proposé à la corbeille (pas celui dont on ignore le contenu)');
eq(TWINS.pickCanonicalFolder([]), null, 'aucun candidat → aucun conteneur');
eq(TWINS.emptyTwinIds([], 'X'), [], '…et rien à ranger');

/* ── 2. Le registre des conteneurs (miroir partagé) ──────────────────────── */

const scope = { datasetId: 'ds1', datasetName: 'Pepper', dir: 'projects' };
let m = S.emptyDriveMirror();
eq(S.findDatasetDirId(m, scope), '', 'un conteneur jamais résolu n’a pas d’identifiant');
m = S.rememberDatasetDir(m, { ...scope, folderId: 'PR1' }, 10);
eq(S.findDatasetDirId(m, scope), 'PR1', 'l’identifiant de `projects` est retenu');
eq(S.findDatasetDirId(m, { datasetId: 'ds2', dir: 'projects' }), '',
  '…et il ne se confond pas avec le `projects` d’un AUTRE dataset');
eq(S.findDatasetDirId(m, { datasetId: 'ds1', dir: 'protocols' }), '',
  '…ni avec un autre conteneur du même dataset');

/* Deux postes : l’entrée la plus récente gagne (comme pour les dossiers). */
const other = S.rememberDatasetDir(S.emptyDriveMirror(), { ...scope, folderId: 'PR9' }, 50);
eq(S.findDatasetDirId(S.mergeDriveMirrors(m, other), scope), 'PR9',
  'entre deux postes, l’identifiant le PLUS RÉCENT gagne');
eq(S.findDatasetDirId(S.mergeDriveMirrors(m, S.rememberDatasetDir(
  S.emptyDriveMirror(), { ...scope, folderId: 'PR0' }, 5
)), scope), 'PR1', '…et un poste en retard ne fait pas revenir l’ancien');

/* Conteneur supprimé dans le programme → son identifiant est oublié. */
m = S.rememberDatasetDir(m, { datasetId: 'ds1', datasetName: 'Pepper', dir: 'protocols', folderId: 'PO1' });
const afterFolderDelete = S.addDriveTombstone(m, { id: 'ds1', name: 'Pepper', path: 'protocols' }, 60);
eq(S.findDatasetDirId(afterFolderDelete, { datasetId: 'ds1', dir: 'protocols' }), '',
  'un conteneur supprimé ne garde pas son identifiant (on n’écrit pas dans l’invisible)');
eq(S.findDatasetDirId(afterFolderDelete, scope), 'PR1',
  '…mais les autres conteneurs du dataset restent connus');
const afterDatasetDelete = S.addDriveTombstone(m, { id: 'ds1', name: 'Pepper', path: '' }, 70);
eq(S.findDatasetDirId(afterDatasetDelete, scope), '',
  'dataset supprimé : tout le registre des conteneurs s’en va avec lui');

/* Un miroir abîmé (ancienne version, identifiant vide) est nettoyé. */
eq(S.normalizeDriveMirror({ datasetDirs: { k: { dir: 'projects' }, j: { dir: 'backups', folderId: 42 } } }).datasetDirs,
  { j: { dir: 'backups', folderId: '42', at: 0 } },
  'une entrée sans identifiant est écartée, un identifiant abîmé est nettoyé');
eq(S.emptyDriveMirror().datasetDirs, {}, 'un miroir neuf porte le registre des conteneurs');
S.writeDriveMirror(S.emptyDriveMirror(), { notify: false });
eq(S.readDriveMirror().datasetDirs, {}, '…et il survit à un rechargement du navigateur');

/* ── 3. Plus JAMAIS de création après une recherche qui échoue ───────────── */

has(UPLOAD, 'export const listFoldersByName = async (name, parentId) =>',
  'driveUpload sait lister TOUS les dossiers d’un même nom (les jumeaux)');
has(UPLOAD, 'fields=files(id,name,createdTime)&pageSize=100',
  '…avec la date de création (départage à contenu égal)');
has(UPLOAD, 'export const findOrCreateFolder = async (name, parentId) => {\n  const all = await listFoldersByName(name, parentId);',
  'findOrCreateFolder cherche STRICTEMENT : un échec remonte, donc rien n’est créé');
has(UPLOAD, 'if (all.length) return String(all[0].id);',
  '…et il rend le dossier existant au lieu d’en fabriquer un second');
ok(!UPLOAD.includes('const existing = await findFolderByName(name, parentId);'),
  'l’ancienne recherche « qui rendait toujours quelque chose » a disparu de findOrCreateFolder');

/* ── 4. Le résolveur unique des conteneurs canoniques ────────────────────── */

has(UPLOAD, 'export const canonicalDatasetDirId = async (dir, {',
  'un seul résolveur de conteneur canonique (projects / protocols / backups / …)');
has(UPLOAD, 'const remembered = findDatasetDirId(readDriveMirror(), scope);',
  'il repart de l’identifiant RETENU (qui suit un renommage)');
has(UPLOAD, 'const twins = await listFoldersByName(name, parent);',
  '…sinon il compare TOUS les jumeaux');
has(UPLOAD, 'const keep = pickCanonicalFolder(scored);',
  '…retient celui qui porte le contenu (datasetDirTwins.js)');
has(UPLOAD, 'for (const twinId of emptyTwinIds(scored, keep.id)) {',
  '…et ne range à la corbeille que les jumeaux CONNUS VIDES');
has(UPLOAD, 'items = await strictChildCount(twin.id);',
  'le contenu d’un jumeau est lu STRICTEMENT (une panne ⇒ contenu inconnu ⇒ rien n’est supprimé)');
has(UPLOAD, 'if (!create || datasetDirDeletedFor(name, scope.datasetId, scope.datasetName)) return \'\';',
  'un conteneur supprimé dans le programme n’est pas recréé (et `create:false` = lecture seule)');

/* Branché là où un conteneur canonique est visé — plus « le premier du nom ». */
has(UPLOAD, 'map[dir] = await canonicalDatasetDirId(dir, { rootId: datasetRootId });',
  'la structure du dataset passe par le résolveur (plus de jumeau à l’ouverture)');
has(UPLOAD, 'isCanonicalDatasetDir(name)',
  'un envoi dont le chemin commence par projects/ ou protocols/ aussi');
has(UPLOAD, "canonicalDatasetDirId('projects', { rootId: root })",
  'lier un test à un projet vise le BON `projects`');
has(UPLOAD, "canonicalDatasetDirId('backups', { rootId, create: false })",
  'les sauvegardes se lisent dans le `backups` canonique (sans rien créer)');
has(FIGURES, "canonicalDatasetDirId('projects', { rootId: root, create: false })",
  'la bibliothèque d’images d’un projet passe par le `projects` canonique (lecture seule)');
has(MIRROR, "canonicalDatasetDirId('projects', {",
  'renommer / supprimer un projet vise le `projects` canonique');
has(MIRROR, "return canonical || findFolderByName('projects', datasetFolderId);",
  '…avec repli sur la recherche par nom si le registre ne connaît rien');

/* ── 5. Le conteneur n’est créé que s’il n’existe VRAIMENT aucun jumeau ──── */

const creation = UPLOAD.slice(UPLOAD.indexOf('const twins = await listFoldersByName(name, parent);'));
has(creation.slice(0, 400), 'if (!twins.length) {',
  'la création n’arrive que quand la liste est VIDE (jamais après un échec)');
has(UPLOAD, "throwCode('PATH_DELETED'",
  'un chemin supprimé dans le programme reste protégé (aucune recréation)');
has(DOC, 'jumeau', 'la documentation explique les jumeaux (docs/DRIVE-MIRROR.md)');

/* ── 6. Le script de réparation (_repair_drive_twins.mjs) ────────────────── */

const REPAIR = read('./_repair_drive_twins.mjs');
has(REPAIR, 'to: toId, path:', 'le plan sépare l’IDENTIFIANT de la cible (`to`) du chemin lisible (`path`)');
has(REPAIR, 'await moveFile(op.id, op.to);',
  'l’exécution passe l’IDENTIFIANT au Drive, jamais le chemin');
ok(!/to: toId, to: /.test(REPAIR),
  'aucune clé `to` dupliquée : un chemin ne peut pas écraser silencieusement la cible (404 garanti)');
has(REPAIR, 'if (!/^[A-Za-z0-9_-]{5,}$/.test(String(toFolderId',
  'une cible qui n’est pas un identifiant fait ÉCHOUER le déplacement au lieu de ne rien faire');
has(REPAIR, 'await trashFile(extra.id); trashed += 1;',
  'un jumeau n’est mis à la corbeille que lorsqu’il est VIDE');
has(REPAIR, 'if (!APPLY) {', 'sans --apply, le script n’écrit rien (plan seulement)');

console.log(`✅ ${passed} tests passés (un seul projects/ et un seul protocols/ par dataset, jamais de jumeau)`);

