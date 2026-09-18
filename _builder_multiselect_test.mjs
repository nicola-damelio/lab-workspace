/* =========================================================================
   _builder_multiselect_test.mjs — « when selecting multiple images allow me to
   resize them all as the first selected ».

   L'Image Builder est une grille : un panneau est une boîte en CASES, et les
   gestes de la souris la bornent à la grille (un panneau ne sort jamais du
   canvas). Sélectionner PLUSIEURS panneaux (Ctrl+clic sur le canvas, ou les
   pastilles « Panels » des propriétés) ne change qu'une chose : le panneau TENU
   est la RÉFÉRENCE — le PREMIER sélectionné — et les autres le suivent :

     • le déplacer les déplace tous du même écart (borné par le panneau le plus
       contraint du groupe, sinon l'un d'eux quitterait la grille) ;
     • le redimensionner leur donne SA taille (chacun garde sa place — ramenée
       dans la grille si la nouvelle taille l'en ferait sortir).

   Les mêmes règles servent aux FIGURES d'un panneau : la figure ACTIVE (celle
   qui porte les poignées) est la première sélectionnée, et les figures cochées
   « ☑ » dans la liste « Figures in this panel » prennent sa taille.

   La géométrie est calculée par le VRAI module utils/panelSelection.js (importé,
   pas recopié) à partir d'un INSTANTANÉ pris au début du glissement : les
   écritures sont absolues, un long glissement n'accumule aucun arrondi. Le test
   vérifie aussi que le branchement d'ImageBuilder.jsx (Ctrl+clic, pastilles,
   poignées, badges de rang, cases à cocher des figures) est bien en place, et
   qu'une sélection SIMPLE retombe exactement sur la formule d'origine.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const PS = await import('./src/utils/panelSelection.js');
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
const times = (hay, re) => (String(hay).match(re) || []).length;
const sliceFn = (src, start, len = 1400) => {
  const at = src.indexOf(start);
  return at < 0 ? '' : src.slice(at, at + len);
};

/* ── 1. DÉPLACER : le même écart pour tous, borné par le panneau le plus
   contraint (une sélection simple retombe sur la formule d'origine :
   x = max(0, min(cols - w, x + dCols))). ───────────────────────────────────── */
const solo = { a: { x: 1, y: 1, w: 1, h: 1 } };
eq(PS.moveDeltaRange(solo, 4, 5), { dxMin: -1, dxMax: 2, dyMin: -1, dyMax: 3 },
  'un panneau seul peut aller jusqu’aux quatre bords de la grille');
eq(PS.moveSelectionPatches(solo, 1, 0, 4, 5).a, { x: 2, y: 1 }, '…un cran vers la droite');
eq(PS.moveSelectionPatches(solo, 99, 0, 4, 5).a, { x: 3, y: 1 }, '…borné par le bord DROIT (4 colonnes, panneau de 1 case)');
eq(PS.moveSelectionPatches(solo, -99, -99, 4, 5).a, { x: 0, y: 0 }, '…et par le coin haut-gauche');
eq(PS.moveSelectionPatches(solo, 0, 99, 4, 5).a, { x: 1, y: 4 }, '…et par le bord bas');

const pair = { a: { x: 1, y: 0, w: 1, h: 1 }, b: { x: 3, y: 2, w: 1, h: 1 } };
eq(PS.moveDeltaRange(pair, 4, 5).dxMax, 0, 'le groupe est borné par son panneau le plus à DROITE : personne ne sort');
eq(PS.moveSelectionPatches(pair, 9, 0, 4, 5), { a: { x: 1, y: 0 }, b: { x: 3, y: 2 } },
  '…donc un glissement de trop ne bouge rien du tout (aucun panneau ne saute)');
eq(PS.moveSelectionPatches(pair, -9, 1, 4, 5), { a: { x: 0, y: 1 }, b: { x: 2, y: 3 } },
  'vers la gauche : le groupe s’arrête au bord, et garde son écart');

/* ── 2. REDIMENSIONNER : la taille de la RÉFÉRENCE est écrite sur les autres ── */
eq(PS.resizedBox({ x: 1, y: 1, w: 1, h: 1 }, 2, 1, 4, 5), { w: 3, h: 2 }, 'la référence grandit de 2 colonnes et 1 ligne');
eq(PS.resizedBox({ x: 3, y: 1, w: 1, h: 1 }, 2, 0, 4, 5).w, 1,
  '…mais jamais au-delà du bord droit : elle garde son coin, donc sa taille est bornée par sa position');
eq(PS.resizedBox({ x: 0, y: 0, w: 1, h: 1 }, -9, -9, 4, 5), { w: 1, h: 1 }, '…et jamais moins d’une case');

const boxes = { ref: { x: 0, y: 0, w: 1, h: 1 }, f2: { x: 2, y: 0, w: 2, h: 1 }, f3: { x: 3, y: 3, w: 1, h: 1 } };
eq(PS.resizeSelectionPatches(boxes, 'ref', { w: 2, h: 2 }, 4, 5), {
  ref: { w: 2, h: 2 },
  f2: { w: 2, h: 2, x: 2, y: 0 },
  f3: { w: 2, h: 2, x: 2, y: 3 }
}, 'chaque panneau sélectionné prend la taille du premier — les autres gardent leur place, ramenée dans la grille s’il le faut');
eq(PS.resizeSelectionPatches({ a: { x: 1, y: 1, w: 1, h: 1 }, b: { x: 0, y: 0, w: 1, h: 1 } }, 'a', { w: 3, h: 3 }, 4, 5).b,
  { w: 3, h: 3, x: 0, y: 0 }, 'la référence garde son COIN (sa taille a été bornée par sa position) ; les autres sont replacés');
eq(PS.resizeSelectionPatches({ a: { x: 0, y: 0, w: 1, h: 1 } }, 'a', { w: 99, h: 99 }, 4, 5), { a: { w: 4, h: 5 } },
  'une taille plus grande que la grille est ramenée au canvas');
eq(Object.keys(PS.resizeSelectionPatches(boxes, 'ref', { w: 2, h: 2 }, 4, 5)).length, 3,
  '…et elle touche TOUS les panneaux de la sélection');

/* ── 3. LES FIGURES D'UN PANNEAU : la figure tenue donne sa taille ──────────── */
const freeFig = { idx: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, scale: 1 };
const gridFig = { idx: 0, rect: null, scale: 1 };
const geom = { cellW: 30, panelW: 2, imgCols: 2 };   // panneau de 60 mm, 2 figures par ligne
eq(PS.figureResizeFactor(freeFig, { ...geom, dxMm: 0 }), 1, 'sans glissement, le facteur d’une figure libre est 1');
eq(PS.figureResizeFactor(freeFig, { ...geom, dxMm: 30 }), 2, '…30 mm sur une boîte de 30 mm doublent sa taille');
eq(PS.figureResizeFactor(freeFig, { ...geom, dxMm: 1e6 }), 6, '…borné à 6 × : la boîte ne peut pas exploser');
eq(PS.figureResizeFactor(freeFig, { ...geom, dxMm: -1e6 }), 0.1, '…et à 10 % au minimum (sinon plus rien à attraper)');
eq(PS.figureResizeFactor(gridFig, { ...geom, dxMm: 30 }), 2, 'une figure encore en grille grandit du même glissement (sa boîte vient du panneau)');
eq(PS.figureResizeFactor(gridFig, { ...geom, dxMm: 1e6 }), 4, '…bornée à 4 × pour la grille');

const figs = [
  { idx: 0, rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, scale: 1 },   // tenue (la référence)
  { idx: 1, rect: { x: 0.5, y: 0.1, w: 0.2, h: 0.8 }, scale: 1 },   // cochée, libre
  { idx: 2, rect: null, scale: 1.5 }                                // cochée, encore en grille
];
const figPatches = PS.resizeFiguresPatches(figs, 0, 2);
eq(figPatches[0].rect, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 'la figure tenue grandit (sa boîte d’origine × le facteur)');
eq(figPatches[1].rect, { x: 0.5, y: 0.1, w: 0.8, h: 0.8 }, 'la figure cochée prend SA taille — en gardant SA place');
eq(figPatches[2].scale, 3, 'une figure encore en grille n’a pas de boîte : elle grandit du même facteur');
ok(figPatches[0].rect.x === figs[0].rect.x && figPatches[1].rect.x === figs[1].rect.x,
  'aucune figure ne change de place : on ne fait que leur donner la taille de la première');
eq(PS.resizeFiguresPatches(figs, 0, PS.figureResizeFactor(freeFig, { ...geom, dxMm: 15 }))[0].rect.w, 0.6,
  'la taille est écrite depuis l’instantané (0,4 × 1,5) : un long glissement n’accumule aucun arrondi');

const gridRef = [
  { idx: 0, rect: null, scale: 1 },
  { idx: 1, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, scale: 1 }
];
const gridPatches = PS.resizeFiguresPatches(gridRef, 0, 1.5);
eq(gridPatches[0].scale, 1.5, 'une référence en grille grandit par son échelle');
eq(gridPatches[1].rect.w, 0.75, '…et la figure libre cochée suit le même facteur (aucune taille à copier)');

eq(PS.resizeFiguresPatches([{ idx: 0, rect: { x: 0, y: 0, w: 2, h: 2 }, scale: 1 }], 0, 100)[0].rect.w, 4,
  'une boîte ne dépasse jamais RECT_MAX (4 × le panneau)');
eq(PS.resizeFiguresPatches([{ idx: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, scale: 1 }], 0, 0.001)[0].rect.w, 0.025,
  'un facteur ridiculement petit est lui-même borné (5 %), avant même la taille de la boîte');
eq(PS.resizeFiguresPatches([{ idx: 0, rect: { x: 0, y: 0, w: 0.3, h: 0.3 }, scale: 1 }], 0, 0.001)[0].rect.w, 0.02,
  '…et une boîte ne descend jamais sous RECT_MIN (2 % : plus petite, elle serait impossible à reprendre)');

/* ── 4. DÉPLACER des figures : le même écart, chacune dans SA coordonnée ────── */
const mm = { dxMm: 6, dyMm: -3, panelWmm: 60, panelHmm: 40 };
const figMove = PS.moveFiguresPatches([
  { idx: 0, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, dx: 0, dy: 0 },
  { idx: 1, rect: null, dx: 2, dy: 4 }
], mm);
eq(figMove[0].rect, { x: 0.6, y: 0.425, w: 0.2, h: 0.2 },
  'une boîte libre se déplace en fractions du panneau (6 mm sur 60 = 0,1 … et -3 mm sur 40 = -0,075)');
eq([figMove[1].dx, figMove[1].dy], [8, 1], 'une figure encore en grille se déplace en millimètres (dx/dy)');
eq(PS.moveFiguresPatches([{ idx: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
  { dxMm: -1e6, dyMm: -1e6, panelWmm: 60, panelHmm: 40 })[0].rect,
  { x: -0.48, y: -0.48, w: 0.5, h: 0.5 },
  'une boîte peut sortir du panneau… mais il en reste toujours une lisière attrapable (2 %)');

/* ── 5. Le branchement dans ImageBuilder.jsx : la sélection ORDONNÉE ────────── */
has(IB, 'const [selectedIds, setSelectedIds] = useState([]);', 'un panneau est sélectionné par une LISTE, pas par un seul id');
has(IB, 'const selectedId = selectedIds[0] || null;',
  'l’élément 0 est la RÉFÉRENCE : c’est lui que montrent les propriétés et qui porte les poignées');
has(IB, 'const setSelectedId = (id) => setSelectedIds(id ? [id] : []);',
  'toutes les commandes « je sélectionne ceci » ramènent la multi-sélection à UN panneau (comportement d’avant)');
has(IB, 'const toggleSelectedId = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));',
  'Ctrl+clic ajoute / retire un panneau, en gardant l’ORDRE (donc la référence)');
has(IB, 'const makeReference = (id) => setSelectedIds((prev) => [id, ...prev.filter((x) => x !== id)]);',
  'on peut désigner un autre premier sélectionné (bouton « 🎯 »)');
has(IB, 'const selectionWith = (id) => (selectedIds.includes(id) ? selectedIds : [id]);',
  'une poignée n’agit jamais sur des panneaux qui ne sont pas sélectionnés');
has(IB, 'if (e.ctrlKey || e.metaKey) toggleSelectedId(obj.id); else setSelectedId(obj.id);',
  'Ctrl/Cmd + clic sur le canvas = sélection multiple ; un clic simple = un seul panneau');
eq(times(IB, /orig: boxesOf\(selectionWith\(id\)\)/g), 2,
  'le déplacement ET le redimensionnement photographient la sélection au début du geste (mêmes deux gestes)');
has(IB, '? moveSelectionPatches(orig, dCols, dRows, gridCols, gridRows)',
  'le déplacement groupé passe par la fonction pure (même écart, borné pour tous)');
has(IB, ': resizeSelectionPatches(orig, id, resizedBox(orig[id], dCols, dRows, gridCols, gridRows), gridCols, gridRows);',
  'le redimensionnement groupé écrit la taille de la RÉFÉRENCE sur toute la sélection');
has(IB, 'setObjects(prev => prev.map(o => (patches[o.id] ? { ...o, ...patches[o.id] } : o)));',
  '…et la liste du canvas reçoit les nouvelles cases calculées d’un coup (un seul rendu, un seul historique)');
has(IB, 'gridCols, gridRows);', 'la grille est toujours la limite');
has(IB, 'const selRank = selectedIds.indexOf(obj.id);   // 0 = the FIRST selected (the reference)',
  'le canvas connaît le rang de chaque panneau dans la sélection');
has(IB, "strokeDasharray={isSelected ? undefined : '1.6,1.2'}",
  'la référence est encadrée en bleu plein, celles qui la suivent en pointillé');
has(IB, "{selRank === 0 ? '🎯 1st' : ordinalOf(selRank)}", 'chaque panneau sélectionné affiche son rang (écran seulement)');
has(IB, "const ORDINALS = ['1st', '2nd', '3rd'];", '…en clair : 1st, 2nd, 3rd…');
has(IB, '{inSelection && (\n              <rect data-selection-ui="true" x={ox} y={oy} width={ow} height={oh} fill="none"',
  'le cadre de sélection est celui de TOUTE la sélection (et reste hors des exports)');
has(IB, 'if (!prev.length) return prev;', 'la sélection est élaguée quand un panneau disparaît (rien ne reste « sélectionné » à vide)');

/* la bande « Panels » : pastilles + 🎯 + copier / coller */
has(IB, 'onClick={() => toggleSelectedId(o.id)}', 'les pastilles « Panels » ajoutent / retirent un panneau');
has(IB, 'onClick={() => makeReference(o.id)}', '…et le « 🎯 » d’une pastille la fait devenir la référence');
has(IB, 'title="Keep only the first selected panel: the others leave the selection">✕ Others</button>',
  'on peut revenir à la référence seule en un clic');
has(IB, '— {selectedIds.length} panels selected', 'l’en-tête des propriétés dit COMBIEN de panneaux sont réglés ensemble');
has(IB, "{selectedIds.length > 1 ? `Delete ${selectedIds.length} panels` : 'Delete'}",
  'Delete supprime toute la sélection, et le dit');

/* ── 6. Le branchement des FIGURES (la même règle, dans le panneau) ─────────── */
has(IB, 'const [figGroup, setFigGroup] = useState({ objId: null, idxs: [] });',
  'la liste des figures cochées à côté de la figure active');
has(IB, 'const figGroupOf = (objId) => (figGroup.objId === objId ? figGroup.idxs : []);',
  '…qui ne vaut que pour le panneau où elles ont été cochées');
has(IB, 'const toggleFigGroup = (objId, idx) => setFigGroup((prev) => {', 'la case « ☐ / ☑ » d’une figure');
has(IB, 'const ticked = isRefFig || figGroupOf(selectedObj.id).includes(i);',
  'la figure ACTIVE est celle qui porte les poignées : elle est déjà « cochée » (référence)');
has(IB, "{isRefFig ? '🎯 1st' : (ticked ? '☑' : '☐')}", 'chaque figure montre si elle suit la figure active');
has(IB, 'figures selected — the ACTIVE one is the first selected: resizing it gives EVERY selected figure its size',
  'la règle est dite là où on la déclenche');
has(IB, 'figs: figureSnapshot(obj, imgIdx)', 'le geste photographie les figures concernées (tenue + cochées)');
eq(times(IB, /figs: figureSnapshot\(obj, imgIdx\)/g), 2, '…au début du déplacement ET du redimensionnement');
has(IB, 'const patches = moveFiguresPatches(figs, { dxMm, dyMm, panelWmm: o.w * cellW, panelHmm: o.h * cellH });',
  'le déplacement groupé des figures passe par la fonction pure (même écart pour toutes)');
has(IB, 'const factor = figureResizeFactor(ref, { dxMm, cellW, panelW: o.w, imgCols: o.imgCols });',
  'le facteur est celui de la figure TENUE, lu sur l’instantané');
has(IB, 'const patches = resizeFiguresPatches(figs, imgIdx, factor);',
  '…et il est écrit sur TOUTES les figures de la sélection');
has(IB, 'setFigGroup((prev) => (prev.objId && prev.objId !== selectedId ? { objId: null, idxs: [] } : prev));',
  'changer de panneau remet la sélection de figures à zéro (les index n’y ont plus de sens)');

console.log(`_builder_multiselect_test.mjs — ${passed} assertions OK`);


