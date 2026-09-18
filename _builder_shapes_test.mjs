/* =========================================================================
   _builder_shapes_test.mjs — LIGNES, RECTANGLES, CERCLES · ALIGNER/RÉPARTIR LES
   PANNEAUX · CONTRASTE / LUMINOSITÉ / COULEUR.

   Ce qui a été demandé (et n'existait pas) :

     • « Third column called objects: put here arrows, lines, rectangles and
       circles in the first line … in the second line put the distribute object
       and align object commands » ;
     • « In the 'Modify image' section can you add … a way to regulate the
       contrast and the luminosity and recolouring? »

   Ce que ce test vérifie :
     1. la GÉOMÉTRIE des formes (src/utils/figureShapes.js importé POUR DE VRAI :
        coins, boîte, courbe, pointillés, poignées, redimensionnement, ombre) ;
     2. ALIGNER / RÉPARTIR les panneaux sur la grille (utils/panelSelection.js) ;
     3. le RÉGLAGE D'IMAGE (utils/figureAdjust.js) → la description EXACTE des
        primitives du <filter> ;
     4. le BRANCHEMENT : les trois colonnes titrées, la fenêtre repliable, les
        boutons des formes, la ligne aligner/répartir, la ligne de réglage, et
        la persistance (canvas sauvegardé, annulation, « New image ») ;
     5. les DEUX boutons retirés de la barre du haut (« ↗ Add arrow »,
        « 🌓 Shadow panels ») et le « ⛶ Fullscreen on object » qui remplace
        « 📋 Paste » : une seule porte d'entrée par commande.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const SH = await import('./src/utils/figureShapes.js');
const PS = await import('./src/utils/panelSelection.js');
const AJ = await import('./src/utils/figureAdjust.js');
const AR = await import('./src/utils/figureArrows.js');
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');
const PANEL = readFileSync('./src/components/FigureArrowPanel.jsx', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const near = (a, b, what, tol = 1e-6) => { assert.ok(Math.abs(a - b) <= tol, `${what} — ${a} ≉ ${b}`); passed += 1; };
const has = (hay, needle, what) => {
  assert.ok(hay.includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};
const times = (hay, re) => (hay.match(re) || []).length;

/* ══ 1. LA GÉOMÉTRIE DES FORMES (le module PUR, importé pour de vrai) ═════ */
eq(SH.SHAPE_KINDS, ['line', 'rect', 'ellipse'], 'les trois formes demandées : ligne, rectangle, cercle');
eq(Object.keys(SH.SHAPE_LABELS), ['line', 'rect', 'ellipse'], '…et leurs libellés');
eq(Object.keys(SH.DEFAULT_SHAPE).sort(),
  ['curve', 'dash', 'fill', 'fillOpacity', 'shadow', 'stroke', 'style', 'width'],
  'une forme neuve porte sa couleur, son épaisseur, ses pointillés, son remplissage, sa courbure et son ombre');

{
  const s = SH.newShape('circle', 'sh1');       // un genre inconnu → rectangle
  eq(s.kind, 'rect', 'un genre inconnu retombe sur un rectangle (jamais un objet cassé)');
  eq(SH.newShape('line', 'sh2').kind, 'line', 'une ligne est une ligne');
  const patched = SH.newShape('rect', 'sh3', { x1: 10, y1: 20, x2: 40, y2: 60, stroke: '#00ff00' });
  eq([patched.x1, patched.y1, patched.x2, patched.y2], [10, 20, 40, 60], 'les coins passés en patch sont repris');
  eq(patched.stroke, '#00ff00', '…comme la couleur');
}

{
  /* UNE FICHE ÉCRITE À LA MAIN ne doit jamais produire de NaN dans le SVG. */
  const dirty = SH.normalizeShape({ id: 7, kind: 'nope', x1: 'abc', y1: null, x2: NaN, y2: '12.5', width: 999, fillOpacity: -3, curve: 'x' });
  eq(dirty.kind, 'rect', 'genre inconnu → rectangle');
  eq(dirty.id, '7', 'l’identifiant devient une chaîne');
  eq([dirty.x1, dirty.y1, dirty.x2], [0, 0, 0], 'les coins illisibles retombent sur 0 (jamais NaN)');
  eq(dirty.y2, 12.5, '…un coin lisible est gardé');
  eq(dirty.width, 6, 'l’épaisseur est bornée');
  eq(dirty.fillOpacity, 0, 'l’opacité de remplissage est bornée');
  eq(dirty.curve, 0, 'une courbure illisible vaut 0 (ligne droite)');
  eq(dirty.stroke, SH.DEFAULT_SHAPE.stroke, 'une couleur vide reprend celle par défaut');
}

{
  eq(SH.shapeBox({ x1: 40, y1: 60, x2: 10, y2: 20 }), { x: 10, y: 20, w: 30, h: 40, cx: 25, cy: 40 },
    'la boîte est toujours positive, quel que soit l’ordre des coins tirés');
  const g = SH.shapeGeometry({ kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0 });
  eq(g.path, 'M 0 0 L 30 0', 'une ligne droite se dessine d’un coin à l’autre');
  eq(g.curved, false, '…et n’est pas courbée');
  const curved = SH.shapeGeometry({ kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0, style: 'curved', curve: 10 });
  ok(curved.curved && curved.path.startsWith('M 0 0 Q '), 'une ligne courbée est une vraie quadratique');
  const apex = AR.quadPoint(curved.p0, curved.pc, curved.p1, 0.5);
  near(apex.y, 10, 'la COURBE passe à 10 mm de la corde (le point de contrôle, lui, est à 2 × 10)');
  near(curved.pc.y, 20, '…le contrôle est donc posé à 20 mm (une quadratique ne va qu’à la moitié)');
  near(curved.pc.x, 15, '…et au milieu, le long de la corde');
  const flipped = SH.shapeGeometry({ kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0, style: 'curved', curve: -10 });
  near(AR.quadPoint(flipped.p0, flipped.pc, flipped.p1, 0.5).y, -10, 'une courbure négative bombe de l’autre côté');
  eq(SH.normalizeShape({ kind: 'rect', style: 'curved' }).style, 'straight',
    'un rectangle n’a pas de courbure : la fiche garde « straight »');
}

{
  eq(SH.shapeDashArray({ width: 1, dash: true }), '3 2', 'les pointillés suivent l’épaisseur du trait (×3 / ×2, comme une flèche)');
  eq(SH.shapeDashArray({ width: 1, dash: false }), undefined, 'sans pointillés : aucune valeur');
  eq(SH.shapeFillOf({ fill: 'none' }), null, 'un cadre n’a pas de fond');
  eq(SH.shapeFillOf({ fill: '#ffcc00' }), '#ffcc00', 'un rectangle teinté a le sien');
  eq(SH.shapeShadowFilterId('sh1'), 'fshadow-shape-sh1', 'chaque forme a son propre filtre d’ombre');
  eq(SH.shapeShadowFilterId('a b/c'), 'fshadow-shape-a_b_c', 'un identifiant est nettoyé avant de servir de référence');
}

{
  const handles = SH.shapeHandles({ x1: 10, y1: 20, x2: 40, y2: 60 });
  eq(handles.map((h) => h.key), ['p0', 'p1'], 'deux poignées : les deux coins de la forme');
  eq([handles[0].x, handles[1].y], [10, 60], '…posées sur les coins enregistrés');
  ok(SH.isDrawnShape({ kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0 }), 'une ligne de 5 mm est dessinable');
  ok(SH.isDrawnShape({ kind: 'line', x1: 0, y1: 0, x2: 5, y2: 2 }), '…une ligne oblique aussi');
  ok(!SH.isDrawnShape({ kind: 'rect', x1: 0, y1: 0, x2: 0.2, y2: 0.2 }), 'un clic sans glissement n’est pas une forme');
  ok(!SH.isDrawnShape({ kind: 'ellipse', x1: 0, y1: 0, x2: 20, y2: 0.2 }), 'un cercle écrasé non plus');
}

{
  const rect = SH.defaultShapeRect('rect', 200, 100);
  eq(rect, { x1: 75, y1: 35, x2: 125, y2: 65 }, 'une forme neuve se pose au milieu du canvas (un quart de sa largeur, 30 % de sa hauteur)');
  const line = SH.defaultShapeRect('line', 200, 100);
  eq([line.y1, line.y2], [50, 50], 'une ligne neuve est horizontale, au milieu');
  eq([line.x1, line.x2], [75, 125], '…et traverse la même largeur qu’un rectangle');
}

{
  /* REDIMENSIONNEMENT : le coin OPPOSÉ ne bouge JAMAIS. */
  const s = { kind: 'rect', x1: 10, y1: 10, x2: 50, y2: 40 };
  const grown = SH.resizedShapeCorners(s, 'p1', 10, 5);
  eq([grown.x1, grown.y1], [10, 10], 'le coin opposé (p0) reste exactement où il était');
  eq([grown.x2, grown.y2], [60, 45], 'le coin tenu suit le curseur');
  const shrunk = SH.resizedShapeCorners(s, 'p0', 10, 10);
  eq([shrunk.x2, shrunk.y2], [50, 40], 'tenir p0 ne bouge pas p1');
  eq([shrunk.x1, shrunk.y1], [20, 20], '…et p0 suit le curseur');
  const squashed = SH.resizedShapeCorners(s, 'p1', -39, -29.9);   // le coin arrive à 1 mm de l’ancre
  eq([squashed.x2, squashed.y2], [10 + SH.SHAPE_MIN_MM, 10 + SH.SHAPE_MIN_MM],
    'un rectangle ne descend jamais sous la taille minimale (la poignée reste attrapable)');
  const flippedOver = SH.resizedShapeCorners(s, 'p1', -100, -100);
  eq([flippedOver.x2, flippedOver.y2], [-50, -60],
    'un glissement qui TRAVERSE l’ancre retourne la forme : elle grandit de l’autre côté (rien ne se bloque)');
  const flatLine = SH.resizedShapeCorners({ kind: 'line', x1: 0, y1: 0, x2: 30, y2: 0 }, 'p1', -30, 0);
  eq([flatLine.x2, flatLine.y2], [0, 0], 'une LIGNE a le droit d’être aplatie (ou verticale) : aucune taille minimale');
}

/* ══ 2. ALIGNER / RÉPARTIR LES PANNEAUX (la grille, en cellules) ══════════ */
{
  const boxes = [
    { id: 'A', x: 0, y: 0, w: 2, h: 1 },
    { id: 'B', x: 1, y: 2, w: 2, h: 1 },
    { id: 'C', x: 3, y: 1, w: 2, h: 1 }
  ];
  eq(PS.alignBoxesPatches(boxes, 'left', { gridCols: 6, gridRows: 4 }),
    { B: { x: 0, y: 2 }, C: { x: 0, y: 1 } }, 'aligner à gauche : tous prennent la première colonne de la sélection');
  eq(PS.alignBoxesPatches(boxes, 'right', { gridCols: 6, gridRows: 4 }),
    { A: { x: 3, y: 0 }, B: { x: 3, y: 2 } },
    'aligner à droite : les bords droits sur une même verticale (le plus à droite — C — ne bouge pas)');
  eq(PS.alignBoxesPatches(boxes, 'top', { gridCols: 6, gridRows: 4 }),
    { B: { x: 1, y: 0 }, C: { x: 3, y: 0 } }, 'aligner en haut : tous prennent la première ligne');
  eq(PS.alignBoxesPatches(boxes, 'hcenter', { gridCols: 6, gridRows: 4 }),
    { A: { x: 2, y: 0 }, B: { x: 2, y: 2 }, C: { x: 2, y: 1 } },
    'centrer horizontalement : les milieux sur une même verticale (arrondi à la cellule)');
  eq(PS.alignBoxesPatches([boxes[0]], 'left', {}), {}, 'un seul panneau : rien à aligner');
  eq(PS.alignBoxesPatches(boxes, 'nope', {}), {}, 'un mode inconnu ne fait rien');
  eq(Object.keys(PS.alignBoxesPatches([{ id: 'A', x: 0, y: 0, w: 1, h: 1 }, { id: 'B', x: 0, y: 1, w: 1, h: 1 }], 'left', {})).length, 0,
    'déjà alignés : aucun patch (donc ni écriture, ni étape d’historique)');
  eq(PS.alignBoxesPatches([{ id: 'A', x: 0, y: 0, w: 1, h: 1 }, { id: 'B', x: 5, y: 1, w: 1, h: 1 }], 'right', { gridCols: 3, gridRows: 3 }),
    { A: { x: 2, y: 0 }, B: { x: 2, y: 1 } },
    'les positions sont RAMENÉES dans la grille : un panneau aligné ne sort jamais du canvas');
}

{
  const boxes = [
    { id: 'A', x: 0, y: 0, w: 1, h: 1 },
    { id: 'B', x: 1, y: 0, w: 1, h: 1 },
    { id: 'C', x: 5, y: 0, w: 1, h: 1 }
  ];
  eq(PS.distributeBoxesPatches(boxes, 'h', { gridCols: 6, gridRows: 2 }),
    { B: { x: 3 } }, 'répartir : le même intervalle entre voisins, arrondi à la cellule (les deux extrêmes ne bougent pas)');
  eq(PS.distributeBoxesPatches(boxes.slice(0, 2), 'h', {}), {}, 'répartir deux panneaux n’a aucun sens (il faut trois)');
  eq(PS.distributeBoxesPatches([{ id: 'A', x: 0, y: 0, w: 3, h: 1 }, { id: 'B', x: 3, y: 0, w: 3, h: 1 }, { id: 'C', x: 6, y: 0, w: 3, h: 1 }], 'h', { gridCols: 9, gridRows: 2 }),
    {}, 'déjà répartis (aucun trou) : aucun patch — la commande ne coûte rien');
  const spread = PS.distributeBoxesPatches([
    { id: 'A', x: 0, y: 0, w: 1, h: 1 },
    { id: 'B', x: 0, y: 1, w: 1, h: 1 },
    { id: 'C', x: 0, y: 9, w: 1, h: 1 }
  ], 'v', { gridCols: 4, gridRows: 12 });
  eq(spread, { B: { y: 5 } }, 'répartir verticalement : le panneau du milieu prend la place qu’il faut (5, arrondi de 4,5)');
}

/* ══ 3. LE RÉGLAGE D'IMAGE (contraste, luminosité, couleur) ═══════════════ */
eq(AJ.ADJUST_FIELDS.map((f) => f.key), ['contrast', 'brightness', 'saturation', 'hue'],
  'les quatre curseurs : contraste, luminosité, saturation, teinte (la coloration est à côté)');
eq(AJ.adjustSpec(null), null, 'aucun réglage : AUCUN filtre n’est dessiné');
eq(AJ.adjustSpec({ ...AJ.ADJUST_NEUTRAL }), null, 'la fiche neutre non plus');
eq(AJ.isNeutralAdjust({ contrast: 0, brightness: 0 }), true, '…et le bouton « ↺ Reset » le sait');

{
  const contrast = AJ.adjustSpec({ contrast: 50 });
  eq(contrast.slope, 1.5, 'le contraste remonte la pente de la droite (feFunc linear)');
  eq(contrast.intercept, -0.25, '…autour du gris moyen (0,5 ne se décale pas)');
  const bright = AJ.adjustSpec({ brightness: 50 });
  eq(bright.slope, 1, 'la luminosité ne touche pas la pente');
  eq(bright.intercept, 0.25, '…elle DÉCALE les niveaux (intercept)');
  const both = AJ.adjustSpec({ contrast: 100, brightness: 100 });
  eq(both.slope, 2, 'les deux se composent');
  eq(both.intercept, 0, '…contraste ×2 autour du gris, luminosité +0,5 : le gris reste au milieu');
  eq(AJ.adjustSpec({ saturation: 40 }).saturate, 1.4, 'la saturation est un <feColorMatrix type="saturate">');
  eq(AJ.adjustSpec({ hue: 90 }).hueRotate, 90, 'la teinte est un <feColorMatrix type="hueRotate">');
  const tint = AJ.adjustSpec({ tint: '#ff0000', tintAmount: 0.4 });
  eq([tint.tint, tint.tintAmount], ['#ff0000', 0.4], 'la COLORATION garde sa couleur et son dosage');
  eq(AJ.adjustSpec({ tint: 'pas-une-couleur', tintAmount: 1 }), null, 'une couleur illisible ne colore rien');
  eq(AJ.adjustSpec({ tint: '#ff0000', tintAmount: 0 }), null, 'un dosage nul ne colore rien');
  const clamped = AJ.adjustSpec({ contrast: 9999, brightness: -9999, saturation: -9999, hue: 9999, tintAmount: 9 });
  eq([clamped.contrast, clamped.brightness, clamped.saturation, clamped.hue, clamped.tintAmount],
    [100, -100, -100, 180, 1], 'toutes les valeurs sont bornées aux limites des curseurs');
  eq(clamped.saturate, 0, '…la désaturation totale vaut 0');
}

eq(AJ.adjustFilterId('obj_1', 0), 'fadjust-obj_1-fig0', 'chaque FIGURE a son propre filtre de réglage');
eq(AJ.adjustFilterId('a b/c', 2), 'fadjust-a_b_c-fig2', 'un identifiant est nettoyé avant de servir de référence');
eq(AJ.adjustRecordOf({ adjust: { contrast: 10 } }), { contrast: 10 }, 'la fiche rangée sur une figure est relue');
eq(AJ.adjustRecordOf({ adjust: { ...AJ.ADJUST_NEUTRAL } }), null, 'une fiche neutre est traitée comme « aucun réglage »');
eq(AJ.adjustRecordOf({}), null, 'une figure sans réglage n’en a pas');

/* ══ 4. LE BRANCHEMENT : LES TROIS COLONNES, LES FORMES, LES COMMANDES ═══ */
/* ── 4a. Les trois colonnes titrées et la fenêtre repliable ─────────────── */
has(IB, "const [panelOpen, setPanelOpen] = useState(true);", 'la fenêtre de l’objet sait se replier');
has(IB, "{panelOpen ? '▾' : '▸'} Object window", '…son titre EST le pli (▾ / ▸)');
has(IB, 'onClick={() => setPanelOpen((v) => !v)}', '…et il se referme en un clic');
has(IB, "'grid grid-cols-1 md:grid-cols-3 grid-flow-row-dense items-start gap-x-4 gap-y-1.5'",
  'la fenêtre est une GRILLE DE TROIS COLONNES, remplie en dense');
has(IB, "{panelTitle('Figures', bar ? 'order-1 md:col-start-1' : '')}", '…colonne FIGURES');
has(IB, "{panelTitle('Modify image', bar ? 'order-1 md:col-start-2' : '')}", '…colonne MODIFY IMAGE');
has(IB, "{panelTitle('Objects', bar ? 'order-1 md:col-start-3' : '')}", '…colonne OBJECTS');
eq(times(IB, /<div className="basis-full flex flex-wrap items-center gap-x-1\.5 gap-y-1 max-h-\[8rem\] overflow-y-auto custom-scrollbar min-w-0">/g), 2,
  'les deux LISTES (figures et textes) défilent chez elles : une longue liste n’étire pas la ligne partagée');

/* ── 4b. La colonne OBJETS : les formes ─────────────────────────────────── */
has(IB, 'const [shapes, setShapes] = useState([]);', 'les formes sont une liste de CANVAS (comme les flèches)');
has(IB, 'const [selectedShapeId, setSelectedShapeId] = useState(null);', '…avec SA sélection (jamais deux fenêtres ouvertes)');
has(IB, 'const selectedShape = (shapes || []).find((sh) => sh.id === selectedShapeId) || null;',
  'la forme sélectionnée est retrouvée comme la flèche');
has(IB, 'const addShape = (kind) => {', '« ╱ Line · ▭ Rectangle · ◯ Circle » déposent une forme');
has(IB, 'const sh = newShape(k, id, defaultShapeRect(k, canvasW, canvasH));',
  '…de la forme demandée, posée au milieu du canvas');
has(IB, 'const updateShape = (patch) => setShapes(prev => prev.map(sh => (sh.id === selectedShapeId ? { ...sh, ...patch } : sh)));',
  'la fiche de la forme se modifie champ par champ');
has(IB, 'const removeShape = (id = selectedShapeId) => {', 'la forme se supprime (annulable)');
has(IB, "const target = typeof id === 'string' ? id : selectedShapeId;",
  '…jamais sur un ÉVÉNEMENT de clic (le défaut déjà corrigé pour les flèches)');
has(IB, 'setShapes(prev => prev.filter(sh => sh.id !== target));', '…et c’est bien CETTE forme qui part');
has(IB, 'const startShapeDrag = (e, id, corner = null) => {', 'on attrape une forme ou l’un de ses coins');
has(IB, "type: corner ? 'shapeCorner' : 'shapeMove',", '…deux gestes distincts (déplacer / redimensionner)');
has(IB, "if (type === 'shapeMove') {", 'le glissement suit le curseur (positions absolues, comme une flèche)');
has(IB, 'const corners = resizedShapeCorners(st.sh, st.corner, dxMm, dyMm);',
  '…et un coin se tire sans bouger le coin opposé');
[['╱ Line', 'une ligne'], ['▭ Rectangle', 'un rectangle'], ['◯ Circle', 'un cercle']].forEach(([btn, what]) => {
  has(IB, btn, `…le bouton « ${what} » est offert dans la colonne OBJETS`);
});

/* ── 4c. Les formes sur le canvas, dans la composition, dans les exports ── */
has(IB, '{shapes.map(sh => {', 'les formes sont dessinées sur le canvas');
has(IB, 'const g = shapeGeometry(sh);', '…avec la géométrie du module PUR (celle testée plus haut)');
has(IB, "filter={sp ? `url(#${shapeShadowFilterId(sh.id)})` : undefined}",
  '…chacune avec SON filtre d’ombre (comme un panneau, une flèche, une figure)');
has(IB, "{g.shape.kind === 'line' && (", 'une ligne se dessine en <path>');
has(IB, "{g.shape.kind === 'rect' && (", 'un rectangle en <rect>');
has(IB, "{g.shape.kind === 'ellipse' && (", 'un cercle en <ellipse>');
has(IB, "pointerEvents={tint ? 'all' : 'stroke'}",
  'une forme VIDE se saisit par son contour (elle ne vole pas un clic au panneau dessous)');
has(IB, 'strokeDasharray: shapeDashArray(g.shape)', 'les pointillés suivent l’épaisseur du trait');
has(IB, '{isShapeSelected && (', 'la forme sélectionnée montre ses poignées');
has(IB, '{shapeHandles(g.shape).map((h) => (', '…une par coin');
has(IB, 'id={shapeShadowFilterId(sh.id)} x="-25%" y="-25%" width="150%" height="150%"',
  'le filtre d’ombre d’une forme est défini dans le MÊME <defs> (donc dans chaque export)');

/* ── 4d. L'OUTIL ⇹ SERT AUX FIGURES **ET** AUX TEXTES D'UN PANNEAU — PLUS AUX
   PANNEAUX (demande : « the alignment and distribute tool should not be for
   panels but for figures or text in a panel ») ──────────────────────────── */
ok(!IB.includes('const applyPanelLayout'), 'aligner / répartir les PANNEAUX n’est plus une commande du builder');
ok(!IB.includes("applyPanelLayout('align'") && !IB.includes('⇹ panels {n}'),
  '…ni ses huit boutons, ni sa ligne « ⇹ panels » : la colonne OBJECTS ne les propose plus');
ok(!IB.includes('? alignBoxesPatches(') && !IB.includes(': distributeBoxesPatches('),
  '…plus aucun APPEL aux fonctions de PANNEAUX dans le builder (elles restent dans utils/panelSelection)');
eq(PS.alignBoxesPatches([{ id: 'A', x: 0, y: 0, w: 3, h: 1 }, { id: 'B', x: 6, y: 1, w: 3, h: 1 }],
  'left', { gridCols: 12, gridRows: 3 }),
  { B: { x: 0, y: 1 } },
  '…mais les fonctions PURES de panneaux restent dans utils/panelSelection (testées, disponibles)');
has(IB, 'alignGroupPatches', 'l’alignement du builder passe maintenant par les fonctions de GROUPE (figures + textes)');
has(IB, 'distributeGroupPatches', '…les deux, aligner et répartir');
has(IB, 'const [textGroup, setTextGroup] = useState({ objId: null, ids: [] });',
  'les TEXTES d’un panneau se cochent « ☑ », comme les figures');
has(IB, 'toggleTextGroup(selectedObj.id, tx.id)', '…et rejoignent le groupe que ⇹ range');
has(IB, 'const selectedTextGroup = (obj) => (obj', 'seuls les textes qui existent encore entrent dans le groupe');
has(IB, 'const textBoxOf = (obj, tx) => {',
  'la boîte d’un texte est calculée (position en mm + largeur estimée × hauteur de ligne)');
has(IB, 'const layoutGroupSize = (obj) =>',
  'le groupe = figures sélectionnées + textes cochés (deux éléments suffisent à ranger)');
has(IB, '{layoutGroupSize(selectedObj) >= 2 && (() => {', '…et les commandes ⇹ apparaissent dès qu’il y a deux choses à ranger');
has(IB, 'disabled={n < 3}', '…les répartitions restant inactives sous trois éléments');

/* ── 4e. La colonne MODIFY IMAGE : le réglage d'image ──────────────────── */
has(IB, 'const activeAdjust = cropPanelIdx >= 0 ? ((selectedImgs[cropPanelIdx] || {}).adjust || null) : null;',
  'le réglage porte sur la figure ACTIVE');
has(IB, 'const activeAdjustSpec = adjustSpec(activeAdjust);', '…et sa description vient du module PUR');
has(IB, 'const setFigAdjust = (patch) => {', 'un seul point d’écriture pour les cinq réglages');
has(IB, 'patchFigure(selectedObj.id, cropPanelIdx, { adjust: { ...ADJUST_NEUTRAL, ...(activeAdjust || {}), ...patch } });',
  '…qui écrit la fiche complète sur la figure (jamais un champ à moitié)');
has(IB, '{ADJUST_FIELDS.map((f) => (', 'les quatre curseurs (contraste, luminosité, saturation, teinte) viennent de la liste');
has(IB, 'onChange={(e) => setFigAdjust({ [f.key]: Number(e.target.value) })}', '…chacun avec son curseur ET sa valeur tapable');
has(IB, 'Tint', 'la COLORATION a sa couleur');
has(IB, 'onChange={(e) => setFigAdjust({ tint: e.target.value })}', '…et son dosage');
has(IB, 'onClick={() => setFigAdjust({ ...ADJUST_NEUTRAL })}', '« ↺ Reset » remet la fiche neutre');
has(IB, 'disabled={!activeAdjustSpec}', '…et ne s’active que s’il y a quelque chose à reprendre');
has(IB, 'Add a figure to this panel to adjust contrast, brightness, colours…',
  'sans figure, la ligne le dit au lieu de rester muette');
has(IB, 'const figAdjust = adjustSpec(adjustRecordOf(im));', 'le filtre est préparé pour chaque FIGURE');
has(IB, 'const adjustFilter = figAdjust ? `url(#${adjustFilterId(obj.id, i)})` : undefined;',
  '…et vaut `undefined` quand rien n’est demandé (le SVG reste celui d’avant)');
eq(times(IB, /filter=\{adjustFilter\}/g), 2, 'il est posé sur l’IMAGE des deux chemins de dessin (recadré, normal)');
has(IB, '<feColorMatrix type="saturate" values={adj.saturate} />', 'saturation : un <feColorMatrix>');
has(IB, '<feColorMatrix type="hueRotate" values={adj.hueRotate} />', 'teinte : un <feColorMatrix type="hueRotate">');
has(IB, '<feComponentTransfer>', 'contraste et luminosité : un <feComponentTransfer>');
has(IB, '<feFuncR type="linear" slope={adj.slope} intercept={adj.intercept} />', '…par canal (R, G, B)');
has(IB, '<feFlood floodColor={adj.tint} floodOpacity={adj.tintAmount} result="adjTint" />', 'coloration : un <feFlood>');
has(IB, '<feComposite in="adjTint" in2="SourceGraphic" operator="in" result="adjTintClipped" />',
  '…détouré sur les pixels de la figure');
eq(times(IB, /<feFuncG type="linear" slope=\{adj\.slope\} intercept=\{adj\.intercept\} \/>/g), 1,
  'un seul jeu de primitives par figure (pas de doublon)');

/* ── 4f. La persistance : le canvas sauvé, l'annulation, les remises à zéro ── */
has(IB, 'if (data.shapes) setShapes((data.shapes || []).map(normalizeShape));', 'les formes reviennent avec le canvas de la session');
has(IB, 'objects: persisted, arrows, shapes, focusObjId, globalCaption, isFullScreen, canvasKey, canvasEntries, canvasHome, canvasLabel };', '…et sont enregistrées avec lui (avec l’identité du canvas : voir _canvas_identity_test)');
has(IB, 'shapes: shapes || []', 'la composition sauvée (💾 Save canvas / 📤 Insert) porte aussi les formes');
has(IB, 'setShapes((cd.shapes || []).map(normalizeShape));', '…et elles sont rechargées à la réouverture');
has(IB, 'shapes: JSON.parse(JSON.stringify(shapes || []))', 'l’annulation garde les formes dans son instantané');
has(IB, 'if (!Array.isArray(prev)) setShapes((prev.shapes || []).map(normalizeShape));', '…et les remet en place');
has(IB, 'setShapes([]);                   // …nor a line / rectangle / circle', '« New image » repart sans forme');
has(IB, 'setObjects([]); setArrows([]); setSelectedId(null); setSelectedArrowId(null); setShapes([]); setSelectedShapeId(null);',
  '« Clear Canvas » vide aussi les formes');

/* ── 4g. Le panneau d'une forme, et les barres du haut ─────────────────── */
has(PANEL, 'export const ShapePropertiesPanel = ({ shape, isFloating = false, onChange, onDelete }) => {',
  'le panneau d’une forme est un composant de MODULE (jamais remonté à chaque frappe)');
['Colour', 'Thickness (mm)', 'Fill opacity', 'Dashed', 'Curve (mm)', '⇅ Flip', '↺ Defaults', 'Shadow', 'Delete']
  .forEach((label) => has(PANEL, label, `…il porte « ${label} »`));
has(PANEL, "'no fill'", '…et un interrupteur « no fill / filled » pour le rectangle et le cercle');
has(PANEL, '<ShadowControls value={shadowSpec(sh.shadow)} onChange={(v) => onChange({ shadow: v })}',
  '…avec le MÊME bloc d’ombre que les panneaux et les flèches');
has(PANEL, 'onClick={() => onDelete()}', '…et son bouton Delete n’est jamais passé à un gestionnaire nu');
has(IB, '<ShapePropertiesPanel shape={selectedShape} onChange={updateShape} onDelete={() => removeShape()} />',
  'la forme montre ses propriétés dans la vue normale');
has(IB, '<ShapePropertiesPanel shape={selectedShape} isFloating onChange={updateShape} onDelete={() => removeShape()} />',
  '…et en plein écran');
has(IB, '{!selectedObj && !selectedArrow && selectedShape && (', 'une seule fenêtre à la fois (panneau, flèche, forme)');
has(IB, '↗ Arrow', 'la flèche est offerte par la colonne OBJETS');
eq(times(IB, /↗ Add arrow\{arrows\.length/g), 0, '…et plus par les barres du haut');
eq(times(IB, /🌓 Shadow panels<\/button>/g), 0, '« 🌓 Shadow panels » a aussi quitté les barres');
eq(times(IB, /⛶ Fullscreen on object/g), 3,
  '« ⛶ Fullscreen on object » est dans les DEUX barres du haut (vue normale + plein écran) ET dans la section PANELS de la fenêtre de l’objet');
eq(times(IB, />⛶ Zoom Object<\/button>/g), 0, '…et il n’y a plus deux boutons pour la même chose (le commentaire, lui, l’explique)');
eq(times(IB, /📋 Paste\{clipCount/g), 1, '« 📋 Paste » ne vit plus que dans la section PANELS (la barre du haut est libérée)');
has(IB, '🌓 {panelsShadowed ? \'Remove the shadow from every panel\' : \'Same shadow on every panel\'}',
  '…et l’ombre de tous les panneaux reste atteignable dans « ▾ More options »');

console.log(`\n_builder_shapes_test : ${passed} vérifications passées`);

console.log(`\n_builder_shapes_test : ${passed} vérifications passées`);
