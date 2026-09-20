/* =========================================================================
   _library_move_test.mjs — « j'ai déplacé mes images dans la bibliothèque du
   projet et elles sont ENCORE dans la bibliothèque générale ».

   Constaté sur le Drive réel le 19/09/2026 (keys.json, dataset
   « GEC-UPJV-projects ») : trois images (`image5.png`, `image7.png`,
   « Figure 2. Zoom… ») étaient présentes à la fois dans `labFiguresLibrary` ET
   dans DEUX bibliothèques de projet — même `id`, même fichier Drive.

   Cause : les listes de bibliothèque voyagent dans `_workspace/keys.json` et
   leur fusion est une UNION (workspaceKeyStore → mergeLibraryKeyValues). Une
   union sait écarter ce qui a été SUPPRIMÉ (pierres tombales de la corbeille)
   mais pas ce qui a été DÉPLACÉ : la copie de l'autre poste, qui avait encore
   l'image dans la bibliothèque d'origine, la ramenait. Et le FICHIER, lui, ne
   suivait pas le déplacement (une image de la commune vit dans
   `projects/_unassigned/images`) : « ⬇ Add missing from Drive » sur le projet
   ne pouvait donc jamais la retrouver (le dossier lu n'est pas celui du
   fichier). Troisième défaut vérifié ici : les listes ADOPTÉES du Drive
   n'atteignaient pas l'écran, le miroir mémoire de figuresLibrary n'étant
   jamais relu du magasin après une adoption.

   Le module RÉEL est importé (src/utils/figuresLibrary.js, localStorage
   bouchonné, driveUpload remplacé par _esm_test_hook) et c'est la VRAIE fusion
   des clés (workspaceKeyStore) qui est exercée : c'est elle qui décidait.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* ── un localStorage minimal, et une fenêtre qui retient ses événements ────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
const events = [];
globalThis.window = {
  dispatchEvent: (e) => { events.push(e && e.type); return true; },
  addEventListener: () => {}, removeEventListener: () => {}
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };

const LIB = await import('./src/utils/figuresLibrary.js');
const KEYS = await import('./src/utils/workspaceKeyStore.js');
const NAMING = await import('./src/utils/driveNaming.js');
const LIB_SRC = readFileSync('./src/utils/figuresLibrary.js', 'utf8');
const APP = readFileSync('./src/App.jsx', 'utf8');
const FIG = readFileSync('./src/components/FiguresSlides.jsx', 'utf8').replace(/\r\n/g, '\n');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');
const DRIVE = readFileSync('./src/utils/driveUpload.js', 'utf8');
const HOOK = readFileSync('./_esm_test_hook.mjs', 'utf8');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(String(hay).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

const ids = (list) => (list || []).map((i) => i.id);
const COMMON = 'labFiguresLibrary';
const P1 = 'labFiguresLib_P1';
const TRASH_COMMON = 'labFiguresTrash_common';

const FILE_1 = 'FILE_1';
const driveUrl = (id) => `https://drive.google.com/file/d/${id}/view`;
/** L'image que l'on déplace : elle est DÉJÀ sur le Drive (cas du constat). */
const image = {
  id: 'lib_1', label: 'image5.png', drive: true, url: driveUrl(FILE_1), full: driveUrl(FILE_1)
};
const other = { id: 'lib_2', label: 'Ergosterol', drive: false, url: 'data:image/png;base64,ZZ' };
const canvas = { id: 'cv_1', label: 'Canvas 1', drive: true, url: driveUrl('FILE_C'), full: driveUrl('FILE_C') };
const common = () => LIB.readLibrary();
const projectList = () => LIB.readProjectLibrary('P1');
const reset = () => {
  store.clear();
  LIB.writeLibrary([]);
  LIB.writeProjectLibrary('P1', []);
  LIB.forgetLibraryTrash('common', LIB.readLibraryTrash('common'));
  LIB.forgetLibraryTrash('P1', LIB.readLibraryTrash('P1'));
};


/* ── 1. LE DÉPLACEMENT SE NOTE (sinon la fusion le défait) ────────────────── */
reset();
LIB.writeLibrary([image, other]);
LIB.writeProjectLibrary('P1', [canvas]);
eq(ids(common()), ['lib_1', 'lib_2'], 'la bibliothèque commune porte l’image au départ');

LIB.moveLibraryItem('common', 'project', 'P1', 'lib_1');
eq(ids(common()), ['lib_2'], 'le déplacement retire l’image de la bibliothèque commune');
eq(ids(projectList()), ['lib_1', 'cv_1'], '…et la pose dans celle du projet');
ok(LIB.readLibraryTrash('common').includes('lib_1'),
  'la portée QUITTÉE note l’identifiant de l’entrée (c’est cette note que la fusion respecte)');
ok(LIB.readLibraryTrash('common').includes(`d:${FILE_1}`),
  '…et l’identifiant de son FICHIER (une relecture du dossier la re-créerait sous un autre id)');
eq(LIB.readLibraryTrash('P1'), [], 'la portée REJOINTE n’a aucune note : l’image y est la bienvenue');

/* Rejouer le geste pour RÉPARER une image restée dans DEUX bibliothèques (le
   défaut d'union en laissait une copie dans chacune) ne fabrique pas de doublon. */
LIB.writeLibrary([image, other]);   // la copie que l'ancienne union avait laissée là
LIB.moveLibraryItem('common', 'project', 'P1', 'lib_1');
eq(ids(projectList()), ['lib_1', 'cv_1'], 'rejouer le déplacement remet l’image en tête, sans la dupliquer');
eq(ids(common()), ['lib_2'], '…et la copie laissée dans la commune repart (avec sa note)');

/* ── 2. LA FUSION DES CLÉS NE LA RAMÈNE PAS (le défaut constaté) ──────────── */
/* Ce que le Drive porte ENCORE : la copie d'AVANT le déplacement (c'est le cas
   réel — l'autre poste n'avait pas encore vu le déplacement). */
const before = {
  [COMMON]: JSON.stringify([image, other]),
  [P1]: JSON.stringify([canvas])
};
const remote = KEYS.buildKeyState({ values: before, meta: { [COMMON]: 1, [P1]: 1 } });
const local = KEYS.buildKeyState({
  values: KEYS.snapshotLocalKeys().values,
  meta: KEYS.snapshotLocalKeys().meta
});
const fused = KEYS.mergeKeyStates({ local, remote });

const publishedCommon = JSON.parse(fused.state.keys[COMMON].v);
eq(ids(publishedCommon), ['lib_2'],
  'l’union publiée ne CONTIENT PLUS l’image dans la bibliothèque commune (avant ce correctif : elle y revenait)');
const publishedProject = JSON.parse(fused.state.keys[P1].v);
eq(ids(publishedProject), ['lib_1', 'cv_1'], '…et elle est bien publiée dans la bibliothèque du projet');
const publishedTrash = JSON.parse(fused.state.keys[TRASH_COMMON].v);
ok(publishedTrash.includes('lib_1') && publishedTrash.includes(`d:${FILE_1}`),
  'la note du déplacement voyage avec les clés : l’autre poste l’appliquera');

/* Et le poste qui ADOPTE (l’autre fenêtre) ne la voit pas revenir non plus. */
reset();
LIB.writeLibrary([image, other]);
const adoptRemote = KEYS.buildKeyState({
  values: { [COMMON]: JSON.stringify([image, other]), [TRASH_COMMON]: JSON.stringify(publishedTrash) },
  meta: { [COMMON]: 1, [TRASH_COMMON]: 1 }
});
const adopted = KEYS.mergeKeyStates({
  local: KEYS.buildKeyState({ values: KEYS.snapshotLocalKeys().values, meta: KEYS.snapshotLocalKeys().meta }),
  remote: adoptRemote
});
eq(ids(JSON.parse(adopted.state.keys[COMMON].v)), ['lib_2'],
  'sur l’autre poste, la liste publiée est elle aussi débarrassée de l’image déplacée');

/* ── 3. LE DÉPLACEMENT INVERSE RESTE POSSIBLE ─────────────────────────────── */
reset();
LIB.writeLibrary([other]);
LIB.writeProjectLibrary('P1', [image]);
LIB.moveLibraryItem('project', 'common', 'P1', 'lib_1');
eq(ids(common()), ['lib_1', 'lib_2'], 'l’image revient dans la bibliothèque commune');
eq(ids(projectList()), [], '…et quitte celle du projet');
eq(LIB.readLibraryTrash('common'), [], 'la note de la commune est EFFACÉE (sinon le retour serait annulé)');
ok(LIB.readLibraryTrash('P1').includes('lib_1'), '…et celle du projet est posée');


/* ── 4. LA LISTE ADOPTÉE DU DRIVE ATTEINT L’ÉCRAN ─────────────────────────── */
reset();
LIB.writeLibrary([other]);
eq(ids(common()), ['lib_2'], 'la première lecture remplit le miroir mémoire du module…');
store.set(COMMON, JSON.stringify([image]));   // ce que fait adoptKeysFromDrive : écriture DIRECTE
eq(ids(common()), ['lib_2'],
  '…qui ne voit pas une écriture directe du magasin : l’écran restait sur l’ANCIENNE liste (le défaut)');
events.length = 0;
LIB.refreshLibraryFromStorage();
eq(ids(common()), ['lib_1'], 'après le rafraîchissement, la liste adoptée est visible');
ok(events.includes('lab:figures-library-restored'),
  '…et les panneaux ouverts sont prévenus (même événement qu’une restauration de sauvegarde)');

/* ── 5. LE FICHIER SUIT LE DÉPLACEMENT (une portée = un dossier) ──────────── */
reset();
globalThis.__driveTestMocks = { cloud: false };
LIB.writeProjectLibrary('P1', [image]);
eq((await LIB.moveLibraryItemOnDrive({ id: 'lib_1', toScope: 'project', projectId: 'P1', projectName: 'CD project' })).reason,
  'cloud-off', 'hors connexion, le geste le DIT (l’entrée, elle, est déjà déplacée)');

globalThis.__driveTestMocks = { cloud: true };
LIB.writeProjectLibrary('P1', [{ id: 'local_1', label: 'local', url: 'data:image/png;base64,AA', full: 'data:image/png;base64,AA' }]);
eq((await LIB.moveLibraryItemOnDrive({ id: 'local_1', toScope: 'project', projectId: 'P1', projectName: 'CD project' })).reason,
  'local-only', 'une image encore locale n’a rien à déplacer (☁ Save to Drive l’enverra)');

const moves = [];
const regs = [];
globalThis.__driveTestMocks = {
  cloud: true,
  resolveDrivePathFromNames: async (names) => ({ leafId: 'DEST_IMAGES', path: names.map((n) => ({ name: n, id: '' })) }),
  getDriveFileMeta: async (id) => ({ id, name: 'image5.png', trashed: false, parents: ['SRC_IMAGES'] }),
  findDriveFileByName: async (name, parent) => (parent === 'SRC_IMAGES' && /\.meta\.json$/.test(String(name)) ? 'SIDECAR_1' : ''),
  moveDriveFile: async (id, parent) => { moves.push([id, parent]); return true; },
  getDriveFileRegistry: () => ({ [FILE_1]: { name: 'image5.png' } }),
  registerDriveFile: (id, name, ctx, path) => { regs.push({ id, name, ctx, path: (path || []).map((s) => s.name) }); }
};
LIB.writeProjectLibrary('P1', [{ ...image, metaName: 'image5.png.meta.json' }]);
const moved = await LIB.moveLibraryItemOnDrive({ id: 'lib_1', toScope: 'project', projectId: 'P1', projectName: 'CD project' });
eq(moved.moved, true, 'le fichier de l’image est déplacé vers le dossier de la portée d’arrivée');
eq(moved.metaMoved, true, '…et son sidecar de composition avec lui (ils vivent côte à côte)');
eq(moves, [[FILE_1, 'DEST_IMAGES'], ['SIDECAR_1', 'DEST_IMAGES']],
  'l’image ET le sidecar atterrissent dans le dossier d’images du projet');
eq(moved.folder, `projects/${NAMING.sanitizeSlug('CD project')}/images`, '…et le geste annonce le chemin visé');
eq(regs[0].ctx.project, 'CD project',
  'le registre des fichiers suit le nouveau projet (un renommage de l’ANCIEN projet ne ramènera pas le fichier)');
eq(regs[0].name, 'image5.png', '…sans perdre le nom du fichier (son extension sert aux renommages suivants)');

moves.length = 0;
globalThis.__driveTestMocks.getDriveFileMeta = async (id) => ({ id, name: 'x', trashed: false, parents: ['DEST_IMAGES'] });
const same = await LIB.moveLibraryItemOnDrive({ id: 'lib_1', toScope: 'project', projectId: 'P1', projectName: 'CD project' });
eq(same.reason, 'already-there', 'déjà dans le bon dossier : rien à faire, et le geste le dit');
eq(moves, [], '…aucun appel de déplacement n’est fait');

/* Nextcloud : le WebDAV MOVE vise le dossier de la nouvelle portée. */
const dav = 'https://nc.example/remote.php/dav/files/me/Lab%20Workspace/DS/general_library_images/image5.png';
const tail = NAMING.projectImagesFolderPath('CD project').join('/');
eq(LIB.ncUrlInFiguresFolder(dav, 'CD project'),
  `https://nc.example/remote.php/dav/files/me/Lab%20Workspace/DS/${tail}/image5.png`,
  'Nextcloud : l’URL du fichier rangé dans la bibliothèque COMMUNE part dans le projet');
eq(LIB.ncUrlInFiguresFolder(
  'https://nc.example/remote.php/dav/files/me/Lab%20Workspace/DS/projects/_unassigned/images/image5.png', 'CD project'
),
  `https://nc.example/remote.php/dav/files/me/Lab%20Workspace/DS/${tail}/image5.png`,
  '…et un fichier resté dans l’ANCIEN bac commun suit aussi (l’emplacement d’avant est encore lu)');
eq(LIB.ncUrlInFiguresFolder(dav, 'CD project', 'image5.png.meta.json'),
  `https://nc.example/remote.php/dav/files/me/Lab%20Workspace/DS/${tail}/image5.png.meta.json`,
  '…et celle de son sidecar');
eq(LIB.ncUrlInFiguresFolder('https://nc.example/remote.php/dav/files/me/a.png', 'P'), '',
  'une URL sans /projects/ n’est pas devinée : le geste le DIT au lieu de déplacer n’importe quoi');

/* ── 6. LES SOURCES DISENT LA MÊME CHOSE ─────────────────────────────────── */
has(LIB_SRC, '  rememberLibraryTrash(leaving, ids);', 'le déplacement pose la note de la portée quittée');
has(LIB_SRC, 'if (arriving !== leaving) forgetLibraryTrash(arriving, ids);', '…et efface celle de la portée rejointe');
has(LIB_SRC, 'export const refreshLibraryFromStorage = () => {', 'le module sait relire ses listes du magasin');
has(LIB_SRC, 'memProjects.clear();', '…en vidant les miroirs mémoire');
has(APP, 'if (keys && Array.isArray(keys.adopted) && keys.adopted.length) refreshLibraryFromStorage();',
  'App.jsx rafraîchit les listes dès que des clés du Drive ont été adoptées');
has(APP, 'refreshLibraryFromStorage', '…(import de figuresLibrary)');
has(IB, "moveLibFileToScope(item.id, to, to === 'project' ? destProjectId : null);",
  'l’Image Builder fait suivre le fichier quand une image change de bibliothèque');
has(IB, 'moveLibFileToScope(d.id, scope, activeLibProjectId);', '…et au lâcher sur l’onglet de destination');
has(FIG, 'moveLibFileTo(d.id, scope);', 'Figures & Slides aussi (lâcher sur l’onglet)');
has(FIG, 'moveLibFileTo(id, to);', '…et au bouton 🌐 / 📁');
has(DRIVE, 'fields=id,name,trashed,parents', 'les métadonnées du fichier portent son dossier (`parents`)');
has(HOOK, 'export const moveDriveFile = async (id, parent)', 'le crochet de test expose le déplacement de fichier');

globalThis.__driveTestMocks = undefined;
console.log(`✅ ${passed} tests passés (un déplacement de bibliothèque survit au miroir des clés, et le fichier suit son entrée)`);

