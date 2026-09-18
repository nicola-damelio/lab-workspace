/* ============================================================================
   _builder_arrows_test.mjs — the Image Builder's ARROW ANNOTATIONS and DROP
   SHADOWS.

   What the user asked for: “in the image builder allow to add arrows, straight,
   curved, with double ends. Allow to add shadows.”

   The geometry of an arrow (straight shaft, quadratic bow, one head or two, the
   head triangles) and the shadow record are PURE functions of
   src/utils/figureArrows.js, which is IMPORTED HERE FOR REAL — so the maths
   verified below is exactly the maths the canvas draws (ImageBuilder calls
   arrowGeometry / arrowHeadPath / shadowSpec / shadowFilterId, and the export
   rasterizes that very SVG, which is why a drop shadow survives Export PNG,
   Save canvas and Insert into project).

   The wiring of the component (state, persistence, undo, the two toolbars, the
   properties panels, the export-safe tagging of the selection handles) is
   checked on the source, since ImageBuilder is a JSX module node cannot import.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ARROW, DEFAULT_SHADOW, SHADOW_LIMITS,
  ARROW_HEAD_TRIM, ARROW_HEAD_HALF,
  newArrow, normalizeArrow, arrowControl, arrowGeometry, arrowPathData, arrowHeads,
  arrowHeadPath, quadPoint, quadLength, shadowSpec, shadowFilterId
} from './src/utils/figureArrows.js';

const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');
const PANEL = readFileSync('./src/components/FigureArrowPanel.jsx', 'utf8').replace(/\r\n/g, '\n');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-9), msg || `${a} ≉ ${b}`);
const frag = (name, hay, needle) => check(name, () => assert.ok(hay.includes(needle), `missing: ${needle.slice(0, 70)}`));
const times = (hay, re) => (hay.match(re) || []).length;
/** The numbers of a path (`M 30 20 L 27 21.26 Z` → [30, 20, 27, 21.26]). */
const nums = (d) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

/* ══ 1. SHADOWS ═══════════════════════════════════════════════════════════ */
check('1 no shadow = no filter (null, not an empty record)', () => {
  eq(shadowSpec(null), null);
  eq(shadowSpec(undefined), null);
  eq(shadowSpec(false), null);
});
check('2 a switched-on shadow with no values falls back to the defaults', () => {
  eq(shadowSpec({}), DEFAULT_SHADOW);
  eq(Object.keys(DEFAULT_SHADOW), ['dx', 'dy', 'blur', 'color', 'opacity']);
});
check('3 the offsets are clamped to the slider range', () => {
  eq(shadowSpec({ dx: 999 }).dx, SHADOW_LIMITS.dx[1]);
  eq(shadowSpec({ dy: -999 }).dy, SHADOW_LIMITS.dy[0]);
  eq(shadowSpec({ dx: '4.5' }).dx, 4.5);
});
check('4 the blur is never negative (and is clamped)', () => {
  eq(shadowSpec({ blur: -3 }).blur, 0);
  eq(shadowSpec({ blur: 99 }).blur, SHADOW_LIMITS.blur[1]);
  eq(shadowSpec({ blur: 'x' }).blur, DEFAULT_SHADOW.blur);
});
check('5 the opacity stays inside 0…1', () => {
  eq(shadowSpec({ opacity: 5 }).opacity, 1);
  eq(shadowSpec({ opacity: 0 }).opacity, SHADOW_LIMITS.opacity[0]);
});
check('6 the colour is trimmed, and a blank one falls back to the default', () => {
  eq(shadowSpec({ color: ' #ff0000 ' }).color, '#ff0000');
  eq(shadowSpec({ color: '   ' }).color, DEFAULT_SHADOW.color);
  eq(shadowSpec({ color: 12 }).color, DEFAULT_SHADOW.color);
});
check('7 every shadowed element gets its OWN filter id', () => {
  const a = shadowFilterId('obj_1');
  const b = shadowFilterId('arr_1');
  assert.notEqual(a, b);
  eq(a, 'fshadow-obj_1');
  eq(shadowFilterId(null), 'fshadow-');
});
check('8 an id that would break an url(#…) reference is sanitised', () => {
  eq(shadowFilterId('a#b c'), 'fshadow-a_b_c');
  eq(shadowFilterId('x"y'), 'fshadow-x_y');
  assert.ok(!shadowFilterId('a b').includes(' '));
});

/* ══ 2. THE ARROW RECORD ══════════════════════════════════════════════════ */
check('9 a new arrow is a straight, single-headed red arrow', () => {
  const a = newArrow('arr_1');
  eq(a.id, 'arr_1');
  eq([a.x1, a.y1, a.x2, a.y2], [0, 0, 0, 0]);
  eq(a.style, 'straight');
  eq(a.double, false);
  eq(a.color, DEFAULT_ARROW.color);
  eq(a.width, DEFAULT_ARROW.width);
  eq(a.headSize, DEFAULT_ARROW.headSize);
  eq(a.dash, false);
  eq(a.shadow, null);
});
check('10 the patch of newArrow overrides the defaults (the ends are set)', () => {
  const a = newArrow('x', { x1: 4, y1: 5, x2: 6, y2: 7, double: true });
  eq([a.x1, a.y1, a.x2, a.y2], [4, 5, 6, 7]);
  eq(a.double, true);
});
check('11 a stored arrow is repaired field by field', () => {
  const a = normalizeArrow({ id: 'x', style: 'zig', width: 0, headSize: -4, curve: '9', double: 1, dash: 0 });
  eq(a.style, 'straight');          // an unknown shape is the plain one
  eq(a.width, 0.05);                // a hairline is the floor, not "invisible"
  eq(a.headSize, 0.2);
  eq(a.curve, 9);
  eq(a.double, true);
  eq(a.dash, false);
});
check('12 a missing arrow record is still drawable', () => {
  const a = normalizeArrow(null);
  eq(a.style, 'straight');
  eq([a.x1, a.y1, a.x2, a.y2], [0, 0, 0, 0]);
  eq(arrowGeometry(undefined).heads.length, 0);
});
check('13 the two switches cover the three shapes asked for', () => {
  // straight · curved · double-ended (and any combination of them)
  const shapes = [];
  for (const style of ['straight', 'curved']) {
    for (const double of [false, true]) shapes.push({ style, double });
  }
  eq(shapes.length, 4);
  for (const s of shapes) {
    const g = arrowGeometry({ x1: 0, y1: 0, x2: 20, y2: 0, ...s });
    eq(g.heads.length, s.double ? 2 : 1);
    eq(g.curved, s.style === 'curved');
  }
});

/* ══ 3. THE STRAIGHT ARROW ════════════════════════════════════════════════ */
const STRAIGHT = { x1: 10, y1: 20, x2: 30, y2: 20, headSize: 3, width: 0.7 };
check('14 the shaft stops short of the head (the head covers the tip)', () => {
  eq(arrowPathData(STRAIGHT), 'M 10 20 L 27.6 20');
  near(30 - 27.6, STRAIGHT.headSize * ARROW_HEAD_TRIM);   // the tip is left to the head
});
check('15 a double arrow is trimmed at BOTH ends', () => {
  eq(arrowPathData({ ...STRAIGHT, double: true }), 'M 12.4 20 L 27.6 20');
});
check('16 one head by default, at the second end, tip exactly on that end', () => {
  const g = arrowGeometry(STRAIGHT);
  eq(g.heads.length, 1);
  eq(g.heads[0].tip, { x: 30, y: 20 });
  eq(g.heads[0].dir, { x: 1, y: 0 });          // outward
  eq(g.startDir, { x: -1, y: 0 });
});
check('17 a double arrow has two heads pointing outwards', () => {
  const g = arrowGeometry({ ...STRAIGHT, double: true });
  eq(g.heads.map((h) => h.tip), [{ x: 10, y: 20 }, { x: 30, y: 20 }]);
  eq(g.heads.map((h) => h.dir), [{ x: -1, y: 0 }, { x: 1, y: 0 }]);
});
check('18 a very short double arrow never turns its shaft around', () => {
  const g = arrowGeometry({ x1: 0, y1: 0, x2: 2, y2: 0, double: true, headSize: 3 });
  eq(g.path, 'M 0.8 0 L 1.2 0');              // the two trims meet, they do not cross
  assert.ok(g.shaft.from.x < g.shaft.to.x);
});
check('19 a zero-length arrow stays drawable (no head, no NaN)', () => {
  const g = arrowGeometry({ x1: 5, y1: 5, x2: 5, y2: 5, headSize: 3 });
  eq(g.path, 'M 5 5 L 5 5');
  eq(g.heads, []);
  assert.ok(!g.path.includes('NaN'));
});

/* ══ 4. THE CURVED ARROW ══════════════════════════════════════════════════ */
const CURVED = { x1: 0, y1: 0, x2: 20, y2: 0, style: 'curved', curve: 5, headSize: 3 };
check('20 the bow is the number the user typed (not half of it)', () => {
  // A quadratic only reaches HALF way to its control point, so the control sits
  // at twice the bulge: the apex must be exactly `curve` mm from the chord.
  const g = arrowGeometry(CURVED);
  eq(arrowControl(CURVED), { x: 10, y: 10 });
  const apex = quadPoint(g.p0, g.control, g.p2, 0.5);
  eq(apex, { x: 10, y: 5 });
  near(Math.hypot(apex.x - 10, apex.y - 0), 5);
});
check('21 a negative bow bows the other way', () => {
  const g = arrowGeometry({ ...CURVED, curve: -5 });
  const apex = quadPoint(g.p0, g.control, g.p2, 0.5);
  eq(apex, { x: 10, y: -5 });
});
check('22 a vertical arrow bows sideways (the bow is perpendicular)', () => {
  eq(arrowControl({ x1: 0, y1: 0, x2: 0, y2: 20, curve: 5 }), { x: -10, y: 10 });
});
check('23 the shaft is a quadratic, and the heads sit on the curve', () => {
  const g = arrowGeometry(CURVED);
  assert.ok(g.path.startsWith('M 0 0 Q 10 10 '), g.path);
  eq(g.path.split(' ')[0], 'M');
  eq(g.path.split(' ')[3], 'Q');
  eq(g.heads.length, 1);
  eq(g.heads[0].tip, { x: 20, y: 0 });         // the tip is the end the user set
});
check('24 the head follows the TANGENT of the curve, not the chord', () => {
  const g = arrowGeometry(CURVED);
  near(g.endDir.x, Math.SQRT1_2);
  near(g.endDir.y, -Math.SQRT1_2);
  near(g.startDir.x, -Math.SQRT1_2);
  near(g.startDir.y, -Math.SQRT1_2);
  eq(arrowGeometry({ x1: 0, y1: 0, x2: 20, y2: 0, style: 'curved', curve: 0 }).heads[0].dir, { x: 1, y: 0 });
});
check('25 a curved arrow can be double-headed too', () => {
  const g = arrowGeometry({ ...CURVED, double: true });
  eq(g.heads.length, 2);
  eq(g.heads[1].tip, { x: 20, y: 0 });
  eq(g.heads[0].tip, { x: 0, y: 0 });
  assert.ok(g.path.split(' ')[3] === 'Q');
});
check('26 curve = 0 on a “curved” arrow is just a straight arrow', () => {
  const g = arrowGeometry({ x1: 0, y1: 0, x2: 20, y2: 0, style: 'curved', curve: 0, headSize: 3 });
  eq(g.curved, false);
  assert.ok(g.path.includes(' L '), g.path);
});
check('27 the quadratic helpers are the real Bézier ones', () => {
  const p0 = { x: 0, y: 0 }, pc = { x: 10, y: 10 }, p2 = { x: 20, y: 0 };
  eq(quadPoint(p0, pc, p2, 0), p0);
  eq(quadPoint(p0, pc, p2, 1), p2);
  near(quadLength(p0, pc, p2), Math.hypot(10, 10) * 2);
});

/* ══ 5. THE HEAD TRIANGLE ═════════════════════════════════════════════════ */
check('28 the head is a closed triangle whose tip is the arrow end', () => {
  const d = arrowHeadPath({ x: 30, y: 20 }, { x: 1, y: 0 }, 3);
  eq(d, 'M 30 20 L 27 21.26 L 27 18.74 Z');
  assert.ok(d.trim().endsWith('Z'));
  const n = nums(d);
  eq([n[0], n[1]], [30, 20]);
});
check('29 its base is headSize behind the tip and half as wide as it is long', () => {
  const n = nums(arrowHeadPath({ x: 30, y: 20 }, { x: 1, y: 0 }, 3));
  const tip = { x: n[0], y: n[1] };
  const b1 = { x: n[2], y: n[3] };
  const b2 = { x: n[4], y: n[5] };
  const baseCenter = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
  near(Math.hypot(baseCenter.x - tip.x, baseCenter.y - tip.y), 3);
  near(Math.hypot(b1.x - baseCenter.x, b1.y - baseCenter.y), 3 * ARROW_HEAD_HALF);
});
check('30 a head turns with its direction, whatever it is', () => {
  const up = nums(arrowHeadPath({ x: 0, y: 0 }, { x: 0, y: -1 }, 2));
  eq([up[0], up[1]], [0, 0]);                       // the tip never moves
  near(up[3], 2);                                   // the base sits 2 mm BEHIND it…
  near(up[2], 2 * ARROW_HEAD_HALF);                 // …and half a head to the side
  const diag = arrowHeadPath({ x: 1, y: 1 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 2);
  assert.ok(!diag.includes('NaN'));
});
check('31 a head size of 0 cannot produce a broken path', () => {
  const d = arrowHeadPath({ x: 0, y: 0 }, { x: 0, y: 1 }, 0);
  assert.ok(!d.includes('NaN') && d.endsWith('Z'));
});
check('32 arrowHeads() is the head list of arrowGeometry()', () => {
  eq(arrowHeads(STRAIGHT), arrowGeometry(STRAIGHT).heads);
  eq(arrowHeads({ ...STRAIGHT, double: true }).length, 2);
});

/* ══ 6. THE CANVAS: how the builder is wired ══════════════════════════════ */
frag('33 the builder imports the geometry from the shared module', IB, "from '../utils/figureArrows'");
frag('34 …and the controls of the two annotation panels', IB, "import { ShadowControls, ArrowPropertiesPanel, ShapePropertiesPanel } from './FigureArrowPanel';");
frag('35 the arrow panel imports the same module', PANEL, "from '../utils/figureArrows'");
check('36 the shadow filter id only ever comes from shadowFilterId()', () => {
  eq(times(IB, /fshadow-/g), 0);                       // a hard-coded id could drift from the <filter>
  eq(times(IB, /shadowFilterId\(/g), 4);               // 2 <filter> defs + 1 panel + 1 arrow usage
  eq(times(PANEL, /fshadow-/g), 0);
});
check('37 arrows are their own canvas-level list (they are not panels)', () => {
  frag('state', IB, 'const [arrows, setArrows] = useState([]);');
  frag('selection', IB, 'const [selectedArrowId, setSelectedArrowId] = useState(null);');
  // …so they never take a letter / a cell: the panel factory knows nothing of them
  eq(times(IB, /blankObject[\s\S]{0,400}arrows/g), 0);
});
check('38 a panel and an arrow are never selected at the same time', () => {
  frag('clicking a panel clears the arrow', IB, 'setSelectedArrowId(null);   // one selection at a time (arrow ↔ panel)');
  frag('clicking an arrow clears the panel', IB, "onClick={(e) => { e.stopPropagation(); setSelectedId(null); setSelectedArrowId(a.id); }}");
  frag('the empty canvas clears both (normal view)', IB, '      setSelectedId(null);\n      setSelectedArrowId(null);');
  frag('the empty canvas clears both (fullscreen)', IB, 'onClick={() => { setSelectedId(null); setSelectedArrowId(null); setSelectedShapeId(null); }}');
});
check('39 “+ Add arrow” drops a default arrow across the canvas, selected', () => {
  frag('the handler', IB, 'const addArrow = () => {');
  frag('it looks at the canvas size (mm)', IB, 'x1: +(canvasW * 0.4).toFixed(1), y1: +(canvasH * 0.5).toFixed(1),');
  frag('and at the other end', IB, 'x2: +(canvasW * 0.62).toFixed(1), y2: +(canvasH * 0.5).toFixed(1)');
  frag('it becomes the selection', IB, 'setSelectedArrowId(id);');
  frag('the change is undoable', IB, 'const addArrow = () => {\n    commitHistory();');
});
check('40 dragging moves the whole arrow, or ONE end', () => {
  frag('the drag starter takes the end', IB, 'const startArrowDrag = (e, id, end = null) => {');
  frag('…snapshotting both ends (absolute maths)', IB, 'a1x: a.x1, a1y: a.y1, a2x: a.x2, a2y: a.y2');
  frag('the whole arrow', IB, "if (type === 'arrowMove') {");
  frag('one end', IB, "if (type === 'arrowEnd') {");
  frag('the arrow is selected as soon as it is grabbed', IB, 'setSelectedArrowId(id);\n    dragState.current = end');
});
check('41 the shadow filters are real drop shadows, one per element', () => {
  frag('panel filter def', IB, 'id={shadowFilterId(obj.id)} x="-25%" y="-25%" width="150%" height="150%"');
  frag('arrow filter def', IB, 'id={shadowFilterId(a.id)} x="-25%" y="-25%" width="150%" height="150%"');
  frag('figure filter def', IB, 'id={figureShadowFilterId(obj.id, i)} x="-25%" y="-25%" width="150%" height="150%"');
  frag('shape filter def', IB, 'id={shapeShadowFilterId(sh.id)} x="-25%" y="-25%" width="150%" height="150%"');
  eq(times(IB, /<feDropShadow dx=\{sp\.dx\} dy=\{sp\.dy\} stdDeviation=\{sp\.blur\} floodColor=\{sp\.color\} floodOpacity=\{sp\.opacity\} \/>/g), 4);
  frag('the panel group is filtered', IB, '<g filter={panelShadow ? `url(#${shadowFilterId(obj.id)})` : undefined}>');
  frag('a panel with no shadow gets NO filter', IB, 'const panelShadow = shadowSpec(obj.shadow);');
  frag('the arrow group is filtered', IB, 'filter={sp ? `url(#${shadowFilterId(a.id)})` : undefined}');
  frag('a FIGURE with a shadow gets its own filter', IB, 'filter={figShadow ? `url(#${figureShadowFilterId(obj.id, i)})` : undefined}');
  frag('a SHAPE with a shadow gets its own filter', IB, 'filter={sp ? `url(#${shapeShadowFilterId(sh.id)})` : undefined}');
});
check('42 the whole panel is shadowed (frame, figure, letter, texts)', () => {
  const open = IB.indexOf('<g filter={panelShadow ?');
  const close = IB.indexOf('{/* — end of the shadowed panel content — */}');
  assert.ok(open > 0 && close > open, 'the shadow wrapper is not closed');
  const inside = IB.slice(open, close);
  frag('the panel frame', inside, 'onMouseDown={(e) => startDrag(e, obj.id)}');
  frag('the letter', inside, '{obj.letter && (');
  frag('the free texts', inside, '{(obj.texts || []).map(tx => {');
  assert.ok(!inside.includes('startResize(e, obj.id)'), 'the resize handle must stay OUT of the shadow');
});
check('43 the arrows are drawn ON TOP of the panels and below the caption', () => {
  const objects = IB.indexOf('{objects.map(obj => {');
  // the ARROW LAYER (the <defs> block has an `arrows.map` of its own, for the
  // shadow filters — the layer is the one that references the filter)
  const arrows = IB.indexOf('filter={sp ? `url(#${shadowFilterId(a.id)})` : undefined}');
  const caption = IB.indexOf('{captionH > 0 && (');
  assert.ok(objects > 0 && arrows > objects && caption > arrows,
    `order objects=${objects} arrows=${arrows} caption=${caption}`);
  frag('the geometry is the shared one', IB, 'const g = arrowGeometry(a);');
  frag('the shaft carries the colour and the width', IB, 'stroke={g.arrow.color} strokeWidth={g.arrow.width}');
  frag('the heads are filled triangles', IB, 'd={arrowHeadPath(h.tip, h.dir, g.arrow.headSize)}');
  frag('dashed is a real dash', IB, 'strokeDasharray={g.arrow.dash ?');
});
check('44 the arrow IS exported, the handles never are', () => {
  const start = IB.indexOf('filter={sp ? `url(#${shadowFilterId(a.id)})` : undefined}');
  const slice = IB.slice(start, IB.indexOf('{captionH > 0 && (', start));
  eq(times(slice, /data-selection-ui="true"/g), 1);     // exactly the handles group
  const tagged = slice.indexOf('data-selection-ui="true"');
  assert.ok(tagged > slice.indexOf('stroke={g.arrow.color}'), 'the visible arrow must be outside the tagged group');
  assert.ok(tagged > slice.indexOf('arrowHeadPath(h.tip'), 'the heads must be outside the tagged group');
  assert.ok(tagged < slice.indexOf("startArrowDrag(e, a.id, 'start')"), 'the handles ARE the tagged group');
  frag('a wide invisible shaft makes it grabbable', slice, 'stroke="transparent" strokeWidth={Math.max(4, g.arrow.width * 3)}');
});

check('45 the arrow lives in the object window, not in the toolbars', () => {
  /* « ↗ Add arrow » et « 🌓 Shadow panels » ont quitté les DEUX barres du haut :
     les deux commandes sont dans la fenêtre de l'objet (colonne OBJETS pour la
     flèche, « ▾ More options » pour l'ombre des panneaux) — une seule porte
     d'entrée, au même endroit dans les deux affichages. */
  eq(times(IB, /↗ Add arrow\{arrows\.length/g), 0);
  eq(times(IB, /🌓 Shadow panels<\/button>/g), 0);
  frag('the arrow is offered by the object window', IB, '↗ Arrow{arrows.length ? ` (${arrows.length})` : \'\'}');
  frag('…in the OBJECTS column', IB, "{panelTitle('Objects', bar ? 'order-1 md:col-start-3' : '')}");
  frag('the panel-shadow command is still there (More options)', IB, "panelsShadowed ? 'Remove the shadow from every panel' : 'Same shadow on every panel'");
  frag('the one-click command exists', IB, 'const togglePanelsShadow = () => {');
  frag('…and it writes the default record', IB, 'setObjects(prev => prev.map(o => ({ ...o, shadow: on ? { ...DEFAULT_SHADOW } : null })));');
});
check('46 the panel properties carry the Shadow block', () => {
  frag('the section', IB, '<h5 className="text-xs font-bold text-slate-500 uppercase" title="Shadow of the whole PANEL');
  frag('wired to THIS panel', IB, '<ShadowControls value={shadowSpec(selectedObj.shadow)} onChange={(v) => updateObj({ shadow: v })}');
  frag('…and to every panel in one click', IB, "panelsShadowed ? 'Remove the shadow from every panel' : 'Same shadow on every panel'");
});
check('47 the arrow properties panel is shown in BOTH views', () => {
  eq(times(IB, /<ArrowPropertiesPanel /g), 2);
  frag('normal view', IB, '<ArrowPropertiesPanel arrow={selectedArrow} onChange={updateArrow} onDelete={() => removeArrow()} />');
  frag('fullscreen', IB, '<ArrowPropertiesPanel arrow={selectedArrow} isFloating onChange={updateArrow} onDelete={() => removeArrow()} />');
  frag('the selection is looked up', IB, 'const selectedArrow = (arrows || []).find((a) => a.id === selectedArrowId) || null;');
  frag('delete is undoable', IB, 'const removeArrow = (id = selectedArrowId) => {');
});
check('47b a Delete click in “Arrow properties” really removes the arrow', () => {
  /* ⛔ LE DÉFAUT SIGNALÉ : « when I add an arrow in the panel I cannot delete
     it ». `onClick={onDelete}` passait l'ÉVÉNEMENT DE CLIC comme premier
     argument de removeArrow(id = selectedArrowId) : `id` devenait un objet React
     (toujours vrai, donc jamais le `return`), `a.id !== id` était vrai pour
     TOUTES les flèches, et le panneau se refermait sans rien supprimer. */
  frag('the panel calls the handler with NO argument', PANEL, 'onClick={() => onDelete()}');
  check('…and no button receives that handler directly', () => {
    /* `onClick={onDelete}` ferait de l'ÉVÉNEMENT DE CLIC le premier argument —
       donc l'identifiant de la flèche à supprimer (voir le commentaire de la
       source). On teste la STRUCTURE (un <button … onClick={onDelete}>) et non
       la simple présence du texte : le commentaire, lui, doit pouvoir le citer. */
    assert.ok(!/<button[^>]*onClick=\{onDelete\}/.test(PANEL),
      'a button must never be handed the handler directly');
  });
  frag('removeArrow only accepts a real id', IB, "const target = typeof id === 'string' ? id : selectedArrowId;");
  frag('…and filters on THAT id', IB, 'setArrows(prev => prev.filter(a => a.id !== target));');
});
check('48 the shadow controls are defined ONCE, at module level (focus!)', () => {
  eq(times(PANEL, /export const ShadowControls = /g), 1);
  eq(times(IB, /const ShadowControls = /g), 0);
  eq(times(PANEL, /export const ArrowPropertiesPanel = /g), 1);
  eq(times(IB, /const ArrowPropertiesPanel = /g), 0);
});
check('49 the arrow panel offers the shapes that were asked for', () => {
  for (const s of ['➡ Straight', '⤴ Curved', '→ One head', '↔ Double', 'Curve (mm)', '⇅ Flip the bow',
    'Thickness (mm)', 'Head size (mm)', 'Dashed', '↗ Arrow properties', 'Delete']) {
    assert.ok(PANEL.includes(s), `the arrow panel is missing “${s}”`);
  }
  frag('the ends are the draggable ones', PANEL, "{[['x1', 'X1 (mm)'], ['y1', 'Y1 (mm)'], ['x2', 'X2 (mm)'], ['y2', 'Y2 (mm)']].map(");
  frag('the bow is only editable when the arrow is curved', PANEL, "disabled={a.style !== 'curved'}");
});
frag('50 the shadow block is shared by both panels', PANEL, '<ShadowControls value={shadowSpec(a.shadow)} onChange={(v) => onChange({ shadow: v })}');
frag('51 a blank shadow is switched ON with the defaults', PANEL, 'onChange(e.target.checked ? { ...DEFAULT_SHADOW } : null)');

/* ══ 7. PERSISTENCE, UNDO AND THE OTHER CANVAS PATHS ═════════════════════ */
check('52 the localStorage payload keeps the annotations', () => {
  frag('saved', IB, 'objects: persisted, arrows, shapes, focusObjId, globalCaption, isFullScreen };');
  frag('re-read', IB, 'if (data.arrows) setArrows((data.arrows || []).map(normalizeArrow));');
  frag('the effect re-runs when they change', IB, 'keepAspect, objects, arrows, shapes, focusObjId, globalCaption, isFullScreen, storageKey]);');
});
check('53 a saved canvas carries its annotations', () => {
  frag('stored', IB, 'arrows: arrows || []');
  frag('restored', IB, 'setArrows((cd.arrows || []).map(normalizeArrow));');
});
check('54 undo restores the arrows with the panels', () => {
  frag('snapshotted', IB, 'arrows: JSON.parse(JSON.stringify(arrows || []))');
  frag('put back', IB, 'if (!Array.isArray(prev)) setArrows((prev.arrows || []).map(normalizeArrow));');
  frag('the selection is dropped', IB, 'setSelectedId(null);\n    setSelectedArrowId(null);\n    setSelectedShapeId(null);\n    setHistTick((t) => t + 1);');
});
check('55 emptying the canvas empties the annotations too', () => {
  frag('Clear Canvas', IB, 'commitHistory(); setObjects([]); setArrows([]); setSelectedId(null); setSelectedArrowId(null);');
  frag('New image', IB, 'setArrows([]);                   // a NEW image starts with no annotation either');
});

/* ══ 8. report ═══════════════════════════════════════════════════════════ */
const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);


