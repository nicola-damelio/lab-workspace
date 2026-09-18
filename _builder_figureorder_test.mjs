/* =========================================================================
   _builder_figureorder_test.mjs — « with multiple images in an object, allow me
   to define which is on top of the others ».

   Un panneau de l'Image Builder porte plusieurs figures (`obj.images[]`). Elles
   sont PEINTES dans l'ordre de cette liste : la DERNIÈRE est donc celle du
   dessus — celle qu'on voit là où deux figures se chevauchent, et celle que le
   clic attrape en premier (la zone cliquable de la dernière est posée en
   dernier, et `figuresAt` renvoie la liste à l'envers, du dessus vers le
   dessous).

   Ré-empiler une figure = la DÉPLACER dans cette liste. C'est le rôle de
   `moveFigureInList` (utils/figureLayout.js, importé ICI pour de vrai) : pur,
   sans effet quand rien ne bouge (même tableau renvoyé, donc ni écriture ni
   entrée d'historique), et il rend l'index d'arrivée pour que la figure
   déplacée reste la figure ACTIVE (sinon les poignées sauteraient sur une
   autre figure).

   Vérifié ensuite dans ImageBuilder.jsx : le branchement des quatre commandes
   (⤒ ⬆ ⬇ ⤓), le badge « on top », l'annulation (commitHistory) et le fait que
   l'ordre survit à la copie persistée / annulée.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const FL = await import('./src/utils/figureLayout.js');
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
const ids = (list) => (list || []).map((im) => im.id);
/** Un panneau de `n` figures étiquetées a, b, c… */
const panel = (n) => Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), imgSrc: `src${i}` }));

/* ── 1. L'index d'arrivée ────────────────────────────────────────────────── */
eq(FL.figureStackIndex(3, 0, 'front'), 2, '⤒ : la première passe au-dessus de toutes');
eq(FL.figureStackIndex(3, 2, 'back'), 0, '⤓ : la dernière passe dessous');
eq(FL.figureStackIndex(3, 1, 'up'), 2, '⬆ : un cran vers le dessus');
eq(FL.figureStackIndex(3, 1, 'down'), 0, '⬇ : un cran vers le dessous');
eq(FL.figureStackIndex(5, 1, 3), 3, 'une destination numérique est respectée');
eq(FL.figureStackIndex(5, 1, 99), 4, '…et bornée à la dernière place');
eq(FL.figureStackIndex(5, 1, -3), 0, '…comme vers le bas');

/* Rien à faire : la commande ne doit RIEN écrire (d'où -1). */
eq(FL.figureStackIndex(3, 2, 'front'), -1, 'déjà au-dessus : rien à faire');
eq(FL.figureStackIndex(3, 0, 'back'), -1, 'déjà dessous : rien à faire');
eq(FL.figureStackIndex(3, 2, 'up'), -1, 'déjà au-dessus : ⬆ ne fait rien');
eq(FL.figureStackIndex(3, 0, 'down'), -1, 'déjà dessous : ⬇ ne fait rien');
eq(FL.figureStackIndex(3, 1, 1), -1, 'se déplacer sur sa propre place ne fait rien');
eq(FL.figureStackIndex(3, 1, 'garbage'), -1, 'une commande inconnue ne fait rien');
eq(FL.figureStackIndex(1, 0, 'front'), -1, 'une seule figure : aucun empilement');
eq(FL.figureStackIndex(3, -1, 'front'), -1, 'index négatif : rien');
eq(FL.figureStackIndex(3, 3, 'back'), -1, 'index hors liste : rien');
eq(FL.figureStackIndex(3, 1.5, 'up'), -1, 'index non entier : rien');
eq(FL.figureStackIndex(3, '2', 'back'), 0, 'un index en texte reste accepté (0…n-1)');

/* ── 2. La liste ré-empilée ──────────────────────────────────────────────── */
eq(ids(FL.moveFigureInList(panel(3), 0, 'front').list), ['b', 'c', 'a'], 'a passe au-dessus : elle est peinte en dernier');
eq(ids(FL.moveFigureInList(panel(3), 2, 'back').list), ['c', 'a', 'b'], 'c passe dessous');
eq(ids(FL.moveFigureInList(panel(4), 1, 'up').list), ['a', 'c', 'b', 'd'], '⬆ échange avec la figure du dessus');
eq(ids(FL.moveFigureInList(panel(4), 2, 'down').list), ['a', 'c', 'b', 'd'], '⬇ échange avec la figure du dessous');
eq(FL.moveFigureInList(panel(4), 3, 1).index, 1, 'l’index d’arrivée est rendu (la poignée suit la figure)');
eq(ids(FL.moveFigureInList(panel(4), 3, 1).list), ['a', 'd', 'b', 'c'], '…et la liste est celle du déplacement');

/* Les figures restent les mêmes OBJETS : un ré-empilement ne doit toucher ni
   aux pixels, ni au rectangle libre, ni au recadrage, ni à l'ombre. */
const before = panel(3);
before[0].rect = { x: 0, y: 0, w: 0.4, h: 1 };
before[0].shadow = { dx: 2, dy: 2, blur: 1, color: '#000', opacity: 0.4 };
const moved = FL.moveFigureInList(before, 0, 'front');
ok(moved.list[2] === before[0], 'la figure déplacée est le MÊME objet (rien n’est recopié)');
ok(moved.list[2].rect === before[0].rect && moved.list[2].shadow === before[0].shadow,
  'son rectangle et son ombre la suivent');
eq(ids(before), ['a', 'b', 'c'], 'la liste d’origine n’est PAS modifiée (React garde la main)');
ok(moved.list !== before, 'une nouvelle liste est rendue (l’état React change)');

/* Rien à faire → même référence : le composant s'arrête là (pas d'écriture,
   pas de commitHistory, pas de re-rendu inutile). */
const same = panel(3);
const idle = FL.moveFigureInList(same, 0, 'back');
ok(idle.changed === false && idle.list === same, 'rien ne bouge : la MÊME référence est rendue');
eq(idle.index, 0, '…et l’index rendu est celui de départ');
const top = FL.moveFigureInList(same, 2, 'front');
ok(top.changed === false && top.list === same, 'déjà au sommet : ni écriture ni historique');
const away = FL.moveFigureInList(same, 0, 'front');
ok(away.changed === true && away.list !== same && same[0].id === 'a', 'quand ça bouge : nouvelle liste, l’ancienne intacte');

/* Entrées tordues : jamais d'exception. */
ok(FL.moveFigureInList(undefined, 0, 'front').changed === false, 'liste absente : rien');
ok(Array.isArray(FL.moveFigureInList(null, 1, 'up').list), 'liste nulle : pas de plantage');
eq(FL.moveFigureInList([], 0, 'front').list, [], 'panneau vide : liste vide');
eq(FL.moveFigureInList(panel(2), 0, 'front').index, 1, 'deux figures : ⤒ marche encore');

/* ── 3. Peinture ET clic partent du dernier ──────────────────────────────── */
/* Miroir de la couche de figures (`imgs.map(...)` → le dernier est peint en
   dernier) et du cyclage du builder (`figuresAt` → liste à l'envers). */
const paintOrder = (list) => ids(list);                       // le dernier peint est au-dessus
const clickOrder = (list) => ids(list).slice().reverse();      // = figuresAt().reverse() : dessus d'abord
eq(paintOrder(moved.list).slice(-1)[0], 'a', 'la figure déplacée ⤒ est peinte la dernière (donc visible)');
eq(clickOrder(moved.list)[0], 'a', '…et c’est elle qu’un clic attrape en premier');
eq(clickOrder(panel(3))[0], 'c', 'sans rien toucher, c’est la DERNIÈRE de la liste qui est au-dessus');
eq(FL.moveFigureInList(panel(3), 0, 'front').list.length, 3, 'un ré-empilement ne perd aucune figure');

/* ── 4. Le composant s'en sert vraiment ─────────────────────────────────── */
has(IB, 'const moveFigure = (objId, idx, to) => {', 'le builder a une commande de ré-empilement');
has(IB, 'const res = moveFigureInList(getObjImages(obj), idx, to);', '…branchée sur la fonction pure testée ci-dessus');
has(IB, 'if (!res.changed) return;          // already there: nothing to undo, nothing to write',
  '…qui ne fait RIEN quand la figure est déjà à sa place');
has(IB, 'setObjects(prev => prev.map(o => (o.id === objId ? withImages(o, res.list) : o)));',
  '…et écrit la liste ré-empilée dans le panneau (donc persistée et annulable)');
has(IB, 'setActiveFig({ objId, idx: res.index });', '…en gardant ACTIVE la figure déplacée (les poignées la suivent)');
has(IB, "freeSlotFor, RECT_MIN, RECT_MAX, moveFigureInList\n} from '../utils/figureLayout';", '…importée du module partagé figureLayout');
ok(IB.indexOf('if (!res.changed) return;') < IB.indexOf('setObjects(prev => prev.map(o => (o.id === objId ? withImages(o, res.list) : o)));'),
  'l’historique n’est commité qu’APRÈS le test « rien ne bouge »');
has(IB, 'const moveFigure = (objId, idx, to) => {\n    const obj = (objects || []).find((o) => o.id === objId);',
  'le ré-empilement part de l’objet visé par l’id (jamais de l’index d’un autre panneau)');

has(IB, 'the list is the stacking: the last one is ON TOP of the others (⤒ ⬆ ⬇ ⤓ re-layer a figure)',
  'la liste dit lequel est au-dessus et comment le changer');
has(IB, 'title="This figure is on top of the others">on top</span>', 'la figure du dessus porte un badge « on top »');
has(IB, 'title="Click to make this figure the active one (crop / resize / eraser / shadow commands apply to the active figure)"',
  'cliquer une ligne rend sa figure active');
eq((IB.match(/moveFigure\(selectedObj\.id, i, '/g) || []).length, 4, 'les quatre commandes sont dans la liste des figures');
has(IB, 'onClick={(e) => { e.stopPropagation(); moveFigure(selectedObj.id, i, \'front\'); }}',
  'la commande n’active pas la figure au passage (le clic ne change pas la sélection)');
has(IB, '} disabled={i === getObjImages(selectedObj).length - 1}\n                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"\n                        title="Bring this figure to the front',
  '⤒ (et ⬆) sont désactivés sur la figure du dessus');
has(IB, '} disabled={i === 0}\n                        className="text-[10px] font-bold text-slate-500 border border-slate-200 rounded px-1 disabled:opacity-30 hover:bg-slate-100"\n                        title="One step down',
  '⬇ (et ⤓) sont désactivés sur la figure du dessous');
/* L'empilement est TOUJOURS affiché : il n'apparaissait qu'à partir de la
   DEUXIÈME figure, donc « mettre la figure sélectionnée par-dessus les autres »
   restait introuvable sur un panneau qui n'en porte qu'une. Les commandes
   impossibles sont simplement inactives. */
ok(IB.indexOf('{/* 🗂 STACKING — TOUJOURS VISIBLE.') > 0,
  'la liste des figures porte l’empilement dès la première figure');
has(IB, ' — the list is the stacking: the last one is ON TOP of the others (⤒ ⬆ ⬇ ⤓ re-layer a figure)',
  '…et la ligne des figures dit lequel est au-dessus');
has(IB, ' — ⤒ ⬆ ⬇ ⤓ re-layer it as soon as the panel holds several',
  '…même quand il n’y a qu’une figure (la commande se voit)');

/* ── 5. METTRE LE PANNEAU SÉLECTIONNÉ PAR-DESSUS LES AUTRES ──────────────── */
// Les panneaux sont PEINTS dans l'ordre de `objects` : le dernier couvre les
// autres là où ils se chevauchent (une figure qui déborde de son panneau). Ces
// deux commandes changent donc la PROFONDEUR, sans renommer les panneaux : les
// lettres suivent la POSITION (renumberLetters), pas l'ordre de la liste.
has(IB, 'const moveObjInStack = (objId, to) => {', 'le panneau sait passer devant / derrière');
has(IB, "const dst = to === 'front' ? objects.length - 1 : 0;",
  '…« front » = la fin de la liste (peinte en dernier → au-dessus)');
has(IB, 'if (dst === i) return;   // already there: nothing to undo, nothing to write',
  'ne fait RIEN quand le panneau y est déjà (ni écriture, ni historique)');
has(IB, "onClick={() => moveObjInStack(selectedObj.id, 'front')}", 'le bouton « ⤒ Front » de la fenêtre de l’objet');
has(IB, "onClick={() => moveObjInStack(selectedObj.id, 'back')}", '…et son « ⤓ Back »');
has(IB, 'title="Put this panel ON TOP of the others', '…dont l’infobulle dit ce qu’ils font');
{
  const block = IB.slice(IB.indexOf('const moveObjInStack'), IB.indexOf('const writeFigureRect'));
  ok(!block.includes('renumberLetters'), '…sans renuméroter les lettres (elles suivent la position, pas la liste)');
  ok(block.length > 0 && block.includes('setObjects'), '…et le nouvel ordre est bien écrit dans la liste du canvas');
}

/* Les commandes par figure (recadrage, gomme, ombre) visent la figure ACTIVE, et
   son index par défaut est la PLUS HAUTE — cohérent avec l'ordre de la liste. */
has(IB, 'const activeFigIdx = (obj) => {', 'les commandes par figure visent la figure active');
has(IB, ': imgs.length - 1;\n  };', '…qui, par défaut, est la dernière de la liste (celle du dessus)');
has(IB, 'return hits.reverse(); // last rendered = topmost', 'le clic part aussi du dessus (liste à l’envers)');
has(IB, 'const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));',
  'l’ordre (comme le reste de la figure) survit à la copie persistée / annulée');

console.log(`_builder_figureorder_test.mjs — ${passed} assertions OK`);
