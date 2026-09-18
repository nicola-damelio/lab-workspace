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

/* ── 7. ⇹ ALIGNER / RÉPARTIR LES FIGURES SÉLECTIONNÉES ────────────────────────
   « when I select multiple figures of objects allow me to align them
   horizontally, vertically or center them. Allow me to distribute them
   horizontally or vertically. » — les MÊMES figures cochées que ci-dessus, mais
   rangées les unes par rapport aux autres. La géométrie est calculée par le VRAI
   module (PS.alignFiguresPatches / PS.distributeFiguresPatches, importé plus
   haut), et le branchement est vérifié dans ImageBuilder.jsx. */
const trio = [
  { idx: 0, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
  { idx: 1, rect: { x: 0.5, y: 0.4, w: 0.2, h: 0.2 } },
  { idx: 2, rect: { x: 0.9, y: 0.7, w: 0.1, h: 0.1 } }
];
eq(PS.ALIGN_MODES, ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'], 'les six alignements');
eq(PS.DISTRIBUTE_AXES, ['h', 'v'], '…et les deux axes de répartition');

/* Aligner à GAUCHE : tout le monde au bord gauche du GROUPE, et le plus à
   gauche ne bouge pas (0.1). */
eq(PS.alignFiguresPatches(trio, 'left'), {
  1: { rect: { ...trio[1].rect, x: 0.1 } },
  2: { rect: { ...trio[2].rect, x: 0.1 } }
}, 'aligner à gauche met tout au bord gauche de la sélection (l’extrême ne bouge pas)');
/* Aligner à DROITE : le bord droit du groupe est 0.9 + 0.1 = 1.0. */
eq(PS.alignFiguresPatches(trio, 'right'), {
  0: { rect: { ...trio[0].rect, x: 0.8 } },
  1: { rect: { ...trio[1].rect, x: 0.8 } }
}, '…à droite, sur le bord droit du groupe (1.0)');
/* Centrer HORIZONTALEMENT : le milieu du groupe — (0.1 + 1.0) / 2 = 0.55. */
eq(PS.alignFiguresPatches(trio, 'hcenter'), {
  0: { rect: { ...trio[0].rect, x: 0.45 } },
  1: { rect: { ...trio[1].rect, x: 0.45 } },
  2: { rect: { ...trio[2].rect, x: 0.5 } }
}, 'centrer horizontalement : les milieux tombent sur l’axe du groupe');
eq(PS.alignFiguresPatches(trio, 'top'), {
  1: { rect: { ...trio[1].rect, y: 0.1 } },
  2: { rect: { ...trio[2].rect, y: 0.1 } }
}, 'aligner en haut : tout au bord haut du groupe');
eq(PS.alignFiguresPatches(trio, 'bottom'), {
  0: { rect: { ...trio[0].rect, y: 0.6 } },
  1: { rect: { ...trio[1].rect, y: 0.6 } }
}, '…en bas (le bord bas du groupe est 0.8, moins la hauteur de chacun)');
eq(PS.alignFiguresPatches(trio, 'vcenter'), {
  0: { rect: { ...trio[0].rect, y: 0.35 } },
  1: { rect: { ...trio[1].rect, y: 0.35 } },
  2: { rect: { ...trio[2].rect, y: 0.4 } }
}, 'centrer verticalement : les milieux tombent sur l’axe horizontal du groupe');
/* Une commande ne touche QUE l’axe qu’elle vise : le côté opposé (et la taille)
   des boîtes ne bouge jamais. */
{
  const left = PS.alignFiguresPatches(trio, 'left');
  ok(Math.abs(left[1].rect.w - trio[1].rect.w) < 1e-9 && left[1].rect.y === trio[1].rect.y,
    'aligner ne change ni la taille ni l’autre axe des figures');
}
/* Un groupe déjà aligné ne bouge pas : aucune écriture, aucune étape d’histoire. */
eq(PS.alignFiguresPatches([
  { idx: 0, rect: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } },
  { idx: 1, rect: { x: 0.2, y: 0.5, w: 0.1, h: 0.1 } }
], 'left'), {}, 'déjà alignées → rien à faire');
eq(PS.alignFiguresPatches(trio, 'nowhere'), {}, 'un mode inconnu ne fait rien');
eq(PS.alignFiguresPatches([{ idx: 0, rect: trio[0].rect }], 'left'), {}, 'une figure seule n’a rien à aligner');

/* RÉPARTIR : même intervalle entre voisines, les deux extrêmes intacts.
   0.1 → 1.0 de bord à bord, 0.5 de matière, 2 intervalles → 0.2 : le groupe
   `trio` est donc DÉJÀ réparti, on décale d'abord sa figure du milieu pour voir
   la commande travailler. */
const spread = [
  { idx: 0, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
  { idx: 1, rect: { x: 0.32, y: 0.4, w: 0.2, h: 0.2 } },
  { idx: 2, rect: { x: 0.9, y: 0.7, w: 0.1, h: 0.1 } }
];
eq(PS.distributeFiguresPatches(spread, 'h'), { 1: { rect: { ...spread[1].rect, x: 0.5 } } },
  'répartir horizontalement : même intervalle, les extrêmes ne bougent pas');
eq(PS.distributeFiguresPatches(trio, 'h'), {}, 'un groupe déjà réparti ne bouge pas');
{
  /* [0.1→0.3] 0.2 [0.5→0.7] 0.2 [0.8→0.9] : les deux intervalles sont ÉGAUX. */
  const p = PS.distributeFiguresPatches(spread, 'h');
  const xs = [spread[0].rect, p[1].rect, spread[2].rect];
  const gaps = [xs[1].x - (xs[0].x + xs[0].w), xs[2].x - (xs[1].x + xs[1].w)];
  ok(Math.abs(gaps[0] - gaps[1]) < 1e-9, '…et les intervalles mesurés après coup sont identiques');
}
eq(PS.distributeFiguresPatches([
  { idx: 0, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
  { idx: 1, rect: { x: 0.6, y: 0.1, w: 0.2, h: 0.2 } }
], 'h'), {}, 'répartir DEUX figures n’a pas de sens (un seul intervalle à régler)');
{
  /* Une figure qui dépasse du panneau peut y être ramenée mais jamais rendue
     inatteignable : elle garde toujours une lisière (RECT_MIN) dedans. */
  const out = PS.distributeFiguresPatches([
    { idx: 0, rect: { x: -0.5, y: 0.1, w: 0.6, h: 0.2 } },
    { idx: 1, rect: { x: 0.2, y: 0.4, w: 0.2, h: 0.2 } },
    { idx: 2, rect: { x: 0.9, y: 0.7, w: 0.1, h: 0.1 } }
  ], 'v');
  ok(!out[1] || out[1].rect.y <= 1 - 0.02 + 1e-9, 'la répartition garde chaque boîte attrapable à la souris');
}

/* ── 4bis. LE GROUPE MIXTE : FIGURES **ET** TEXTES D'UN PANNEAU ──────────────
   « the alignment and distribute tool should not be for panels but for figures
   or text in a panel » : les mêmes commandes rangent les deux. Les boîtes sont
   en FRACTIONS du panneau — l'appelant (ImageBuilder) convertit la position mm
   d'un texte et sa largeur estimée, la figure apporte son rectangle. ─────── */
const duoMix = [
  { id: 'f0', box: { x: 0.10, y: 0.20, w: 0.30, h: 0.30 } },
  { id: 'tcap', box: { x: 0.55, y: 0.24, w: 0.20, h: 0.05 } }
];
eq(PS.alignGroupPatches(duoMix, 'left'), { tcap: { x: 0.1, y: 0.24 } },
  'une figure et un texte s’alignent sur leur bord gauche (seul le texte se déplace)');
eq(PS.alignGroupPatches(duoMix, 'vcenter'), { tcap: { x: 0.55, y: 0.325 } },
  '…et sur leur milieu vertical (le texte descend au milieu de la figure)');
eq(PS.alignGroupPatches(duoMix, 'nowhere'), {}, 'un mode inconnu ne fait rien');
eq(PS.alignGroupPatches([duoMix[0]], 'left'), {}, 'une boîte seule n’a rien à aligner');
eq(PS.alignGroupPatches([], 'left'), {}, 'un groupe vide ne fait rien');
eq(PS.alignGroupPatches([{ id: '', box: { x: 1, y: 1, w: 1, h: 1 } }, duoMix[0]], 'left'), {},
  'une boîte sans identifiant est ignorée (jamais d’écriture sur une clé vide)');
const trioMix = [
  { id: 'f0', box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
  { id: 't1', box: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 } },
  { id: 'f1', box: { x: 0.9, y: 0.8, w: 0.1, h: 0.2 } }
];
eq(PS.distributeGroupPatches(trioMix, 'v'), { t1: { y: 0.45 } },
  'répartir verticalement ne déplace que ce qui est ENTRE les deux extrêmes (le texte)');
eq(PS.distributeGroupPatches(trioMix.slice(0, 2), 'v'), {},
  'sous trois éléments, répartir ne fait rien (il n’y a qu’un intervalle)');
eq(PS.distributeGroupPatches([...trioMix, { id: 'f2', box: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }], 'v'),
  { t1: { y: 0.3333 }, f2: { y: 0.5667 } },
  'quatre éléments : les voisins du milieu se partagent les intervalles égaux');
/* Les boîtes des FIGURES passent toujours par les mêmes fonctions pures : ce que
   `alignFiguresPatches` rend, c’est `alignGroupPatches` remballé en `{ rect }`. */
{
  const grp = PS.alignGroupPatches(trio.map((f) => ({ id: String(f.idx), box: f.rect })), 'right');
  const wrap = PS.alignFiguresPatches(trio, 'right');
  eq(Object.keys(wrap).sort(), Object.keys(grp).sort(),
    'l’enveloppe des figures ne touche que les boîtes du groupe (mêmes index)');
  ok(Object.keys(wrap).every((k) => wrap[k].rect.x === grp[String(k)].x && wrap[k].rect.y === grp[String(k)].y),
    '…et leur écrit EXACTEMENT les mêmes x / y que la fonction de groupe');
}

/* Le branchement dans ImageBuilder : une seule commande, les huit boutons, et le
   GEL du panneau avant (une figure en grille reçoit d'abord sa boîte exacte). */
has(IB, 'const figGroupIdxs = (obj) => {', 'le groupe = la figure ACTIVE + les figures cochées');
has(IB, 'return [ref, ...figGroupOf(obj.id).filter((i) => i !== ref)].filter((i) => i >= 0);',
  '…sans doublon et sans index invalide');
has(IB, 'const applyFigureLayout = (kind, mode) => {', 'une seule commande pour aligner / répartir');
has(IB, "return kind === 'align' ? alignFiguresPatches(figs, mode) : distributeFiguresPatches(figs, mode);",
  '…qui passe par les fonctions PURES (mêmes chiffres que ci-dessus)');
has(IB, 'const pinned = freezeFigures(o, getObjImages(o));',
  'le panneau est GELÉ avant : rien n’est re-flowé, chaque figure garde la boîte qu’elle montre');
has(IB, 'if (!Object.keys(patchesOn(freezeFigures(obj, getObjImages(obj)))).length) return;',
  'déjà rangées → ni écriture, ni étape d’historique');
eq(times(IB, /applyFigureLayout\('align', '/g), 6, 'six boutons d’alignement (les deux bords, les deux centres, haut et bas)');
eq(times(IB, /applyFigureLayout\('distribute', '/g), 2, '…et deux de répartition (horizontale / verticale)');
has(IB, '>⬅</button>', 'le bord gauche est là');
has(IB, '>⬌</button>', 'le centre horizontal aussi');
has(IB, '>➡</button>', 'le bord droit');
has(IB, '>⬆</button>', 'le bord haut');
has(IB, '>⬍</button>', 'le centre vertical');
has(IB, '>⬇</button>', 'et le bord bas');
has(IB, "onClick={() => applyFigureLayout('distribute', 'v')} disabled={n < 3}",
  'la répartition verticale est désactivée sous trois figures (comme l’horizontale)');
has(IB, 'title={`Align the ${what} on the LEFT edge of the selection',
  'chaque bouton dit ce qu’il fait et sur quoi il s’aligne (figures, textes, ou les deux)');
has(IB, 'Aligned on the BOXES they have now',
  '…et que les figures en grille sont gelées pour y arriver (rien n’est perdu)');
has(IB, 'const what = nt && nf',
  '…le libellé du groupe dit EXACTEMENT ce qui va être rangé (figures, textes, les deux)');
has(IB, 'selectedTextGroup(selectedObj).length',
  'les TEXTES cochés « ☑ » du panneau font partie du groupe (demande : figures OU textes)');
has(IB, '☑ {textGroupOf(selectedObj.id).length} text',
  '…et une pastille dit combien de textes sont cochés');

console.log(`_builder_multiselect_test.mjs — ${passed} assertions OK`);


