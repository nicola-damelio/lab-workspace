/* =========================================================================
   _library_reorder_test.mjs — « vorrei spostare le immagini anche nella
   libreria di immagini ».

   L'ORDRE de la liste de la bibliothèque (localStorage `labFiguresLibrary` /
   `labFiguresLib_<projet>`) est celui qu'affichent le panneau « Image library »
   de Figures & Slides et la modale 🖼 de l'Image Builder. La souris peut le
   réécrire — lâcher une vignette DEVANT une autre — et lâcher une vignette sur
   l'AUTRE ONGLET (Project ⇄ Dataset) range l'image dans cette bibliothèque.

   Le module RÉEL est importé (src/utils/figuresLibrary.js, localStorage
   bouchonné, driveUpload remplacé par _esm_test_hook) : ce sont les VRAIES
   listes qui sont déplacées, et les deux écrans sont vérifiés sur leurs
   fragments (draggable / drop / onglet-cible / phrase d'explication).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null
};
globalThis.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } };

const LIB = await import('./src/utils/figuresLibrary.js');
const FIG = readFileSync('./src/components/FiguresSlides.jsx', 'utf8').replace(/\r\n/g, '\n');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');

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

const it = (id) => ({ id, label: id.toUpperCase(), url: `data:image/png;base64,${id}` });
const ids = (list) => list.map((i) => i.id);
const COMMON_KEY = 'labFiguresLibrary';
const projectKey = (pid) => `labFiguresLib_${pid}`;

/* ── 1. Le déplacement pur : la vignette prend la place visée ─────────────── */
const list = [it('a'), it('b'), it('c'), it('d')];
eq(ids(LIB.reorderLibraryList(list, 'd', 'b')), ['a', 'd', 'b', 'c'], 'lâchée sur « b », « d » se pose devant elle');
eq(ids(LIB.reorderLibraryList(list, 'a', 'c')), ['b', 'a', 'c', 'd'], 'et remonter marche aussi');
eq(ids(LIB.reorderLibraryList(list, 'b', '')), ['a', 'c', 'd', 'b'], 'sans cible (fin de liste vide), elle va à la fin');
eq(ids(LIB.reorderLibraryList(list, 'b', 'zzz')), ['a', 'c', 'd', 'b'],
  'une cible inconnue (vignette disparue) ne perd pas l’image : elle va à la fin');
ok(LIB.reorderLibraryList(list, 'b', 'c') === list, 'déjà à cette place : la MÊME liste est renvoyée (aucune écriture)');
ok(LIB.reorderLibraryList(list, 'zzz', 'a') === list, 'un id inconnu ne change rien');
ok(LIB.reorderLibraryList(list, 'a', 'a') === list, 'se lâcher sur soi-même ne change rien');
eq(ids(LIB.reorderLibraryList([], 'a', 'b')), [], 'une liste vide reste vide');
ok(LIB.reorderLibraryList(undefined, 'a', 'b') === undefined,
  'une liste absente est renvoyée telle quelle (rien à enregistrer)');
const single = [it('a')];
eq(ids(LIB.reorderLibraryList(single, 'a', 'b')), ['a'], 'une seule image : rien à déplacer');

/* ── 2. L'écriture : dans la BONNE bibliothèque ───────────────────────────── */
store.clear();
LIB.writeLibrary([it('a'), it('b'), it('c')]);
LIB.writeProjectLibrary('P1', [it('p1'), it('p2')]);
eq(LIB.reorderLibraryItem('common', null, 'c', 'a'), true, 'le déplacement de la bibliothèque commune écrit');
eq(ids(LIB.readLibrary()), ['c', 'a', 'b'], '…et la liste commune est réordonnée');
eq(ids(JSON.parse(store.get(COMMON_KEY))), ['c', 'a', 'b'], '…jusque dans le navigateur (localStorage)');
eq(LIB.reorderLibraryItem('project', 'P1', 'p2', 'p1'), true, 'le déplacement de la bibliothèque de projet écrit');
eq(ids(LIB.readProjectLibrary('P1')), ['p2', 'p1'], '…dans SA liste');
eq(ids(JSON.parse(store.get(projectKey('P1')))), ['p2', 'p1'], '…et dans sa clé du navigateur');
eq(LIB.reorderLibraryItem('project', 'P1', 'p2', 'p1'), false, 'le même geste deux fois n’écrit plus rien');
eq(ids(LIB.readLibrary()), ['c', 'a', 'b'], 'la bibliothèque commune n’a pas bougé');

/* ── 3. Le geste complet : de l'autre bibliothèque, à la place visée ──────── */
LIB.moveLibraryItem('common', 'project', 'P1', 'c');
eq(ids(LIB.readProjectLibrary('P1')), ['c', 'p2', 'p1'], 'l’image arrive en tête de la bibliothèque de projet');
eq(LIB.reorderLibraryItem('project', 'P1', 'c', 'p1'), true, '…puis on la place là où on l’a lâchée');
eq(ids(LIB.readProjectLibrary('P1')), ['p2', 'c', 'p1'], 'elle est bien à la place visée');
eq(ids(LIB.readLibrary()), ['a', 'b'], 'et elle a QUITTÉ la bibliothèque commune');


/* ── 4. Les deux écrans offrent le geste (fragments) ──────────────────────── */
/* Figures & Slides — le panneau « Image library ». */
has(FIG, "onDragStart={onDragStart('lib', it.id, null, libScopeName)}", 'la vignette de la bibliothèque se prend à la souris');
has(FIG, 'onDrop={dropOnLibCard(it.id)}', '…et se lâche sur une AUTRE vignette');
has(FIG, 'const dropOnLibCard = (id) => (e) => {', 'le déplacement écrit la nouvelle place');
has(FIG, 'if (reorderLibraryItem(libScopeName, projectId, d.id, id) || d.scope !== libScopeName) {',
  '…dans la bibliothèque affichée');
has(FIG, "onDrop={dropOnLibTab('common')}", 'l’onglet 🌐 est une cible : on y lâche une image de projet');
has(FIG, "onDrop={dropOnLibTab('project')}", 'l’onglet 📁 aussi');
has(FIG, 'moveLibraryItem(d.scope, scope, projectId, d.id);', '…et l’image change alors de bibliothèque');
has(FIG, 'Drag a thumbnail onto another one', 'le geste est annoncé à l’écran (personne ne le devine)');
has(FIG, 'reorderLibraryItem,', 'le module de bibliothèque est bien importé');

/* Image Builder — la modale 🖼 (le même geste, là où l'on choisit ses images). */
has(IB, "const [libOver, setLibOver] = useState('');", 'la vignette survolée pendant le glissement est suivie');
has(IB, 'const libDragRef = useRef(null);', 'la vignette tenue est mémorisée avec sa bibliothèque');
has(IB, 'onDrop={dropOnLibCard(item)}', 'on peut lâcher une vignette sur une autre');
has(IB, 'if (reorderLibraryItem(scope, pid, d.id, item.id)) setLibVersion((v) => v + 1);',
  '…ce qui réordonne la vraie liste et rafraîchit la modale');
has(IB, "onDrop={dropOnLibTab('project')}", 'l’onglet Project Library accepte une image du Dataset');
has(IB, "onDrop={dropOnLibTab('common')}", '…et réciproquement');
has(IB, 'moveLibraryItem(d.scope, scope, activeLibProjectId, d.id);', 'le lâcher sur un onglet DÉPLACE l’image de bibliothèque');
has(IB, 'Drag a thumbnail onto <b>another one</b> to change its place in the library',
  'la modale explique le geste');
has(IB, 'libDragRef.current = { id: item.id, scope: libScopeOf(), projectId: libScopeProjectId() };',
  'le glissement part avec la portée de l’image');
has(IB, 'reorderLibraryItem,', 'la modale utilise le même util que le panneau');

console.log(`_library_reorder_test.mjs — ${passed} assertions OK`);
