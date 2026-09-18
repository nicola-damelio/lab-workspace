/* =========================================================================
   _builder_eraser_test.mjs — « implement a tool to remove parts (like a rubber
   whose size can be regulated) ».

   La gomme de l'Image Builder enlève de la MATIÈRE : les pixels qu'elle touche
   deviennent transparents (pas un rectangle blanc par-dessus). Comme le canvas
   ne persiste qu'une VIGNETTE de chaque image, une retouche raster serait
   perdue au premier rechargement : les traits de gomme sont donc enregistrés
   dans le repère de la SOURCE (comme un recadrage) et peints par un MASQUE SVG,
   qui suit la figure et sort à 300 DPI.

   Vérifié ici sur le module RÉEL (utils/figureErase.js) :
     • le pinceau (taille), les traits (points espacés, bornés) ;
     • la conversion millimètres du canvas → fractions de la source, en
       aller-retour (le trait doit tomber EXACTEMENT sous le curseur) ;
     • le chemin SVG et l'épaisseur du masque ;
   puis, dans ImageBuilder.jsx, que tout cela est bien branché à l'écran.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const FE = await import('./src/utils/figureErase.js');
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
const near = (a, b, what, eps = 1e-3) => {
  assert.ok(Math.abs(a - b) < eps, `${what}\n  attendu : ${b}\n  obtenu  : ${a}`);
  passed += 1;
};

/* ── 1. Le pinceau : une taille réglable, toujours valide ─────────────────── */
eq(FE.ERASE_DEFAULT_SIZE, 4, 'le pinceau démarre à 4 mm');
eq(FE.clampEraseSize(0), FE.ERASE_SIZE_MIN, 'un pinceau trop petit est remonté au minimum');
eq(FE.clampEraseSize(999), FE.ERASE_SIZE_MAX, 'un pinceau énorme est ramené au maximum');
eq(FE.clampEraseSize('abc'), FE.ERASE_DEFAULT_SIZE, 'une saisie non numérique retombe sur la valeur par défaut');
eq(FE.clampEraseSize(3.456), 3.46, 'la taille est arrondie au centième de millimètre');
ok(FE.ERASE_SIZE_MIN < FE.ERASE_DEFAULT_SIZE && FE.ERASE_DEFAULT_SIZE < FE.ERASE_SIZE_MAX,
  'la valeur par défaut est dans les bornes du réglage');

/* ── 2. Les traits stockés : relus sans jamais effacer n'importe quoi ─────── */
eq(FE.eraseStrokesOf({}), [], 'une figure sans trait de gomme ne peint aucun masque');
eq(FE.eraseStrokesOf({ erase: 'nope' }), [], 'une donnée abîmée est ignorée');
eq(FE.eraseStrokesOf({ erase: [{ s: 0, p: [[0.1, 0.1]] }] }), [], 'un pinceau de taille nulle n’efface rien');
eq(FE.eraseStrokesOf({ erase: [{ s: 0.9, p: [[0.1, 0.1]] }] }), [], 'un pinceau plus large que la moitié de l’image est refusé');
eq(FE.eraseStrokesOf({ erase: [{ s: 0.05, p: [['x', 0.1], [1.5, 0.2]] }] }), [], 'les points hors de l’image sont écartés');
eq(FE.eraseStrokesOf({ erase: [{ s: 0.05, p: [[0.25, 0.5]] }] }), [{ s: 0.05, p: [[0.25, 0.5]] }],
  'un trait d’un seul point (un CLIC) est valide');
const longStroke = { s: 0.02, p: Array.from({ length: 400 }, (_, i) => [i / 1000, 0.5]) };
eq(FE.eraseStrokesOf({ erase: [longStroke] })[0].p.length, FE.ERASE_MAX_POINTS,
  'un trait interminable est plafonné (le canvas persiste ces points)');

/* ── 3. Tracer : des points espacés, jamais des milliers ──────────────────── */
const start = FE.pushStrokePoint(null, 10, 10);
eq(start.pts, [[10, 10]], 'le premier point pose le trait');
ok(FE.pushStrokePoint(start, 10.05, 10.05) === start, 'un point collé au précédent est ignoré (même objet : pas de rendu inutile)');
const stepped = FE.pushStrokePoint(start, 12, 10);
ok(stepped !== start && stepped.pts.length === 2, 'un point assez loin est ajouté');
ok(stepped.pts[1][0] > 10.5, '…et il est bien plus loin que le pas du pinceau');
ok(FE.pushStrokePoint(start, NaN, 10) === start, 'un point invalide est ignoré');
let fat = { sizeMm: 20, pts: [] };
for (let i = 0; i < 400; i++) fat = FE.pushStrokePoint(fat, i * 20, 0);
eq(fat.pts.length, FE.ERASE_MAX_POINTS, 'le trait s’arrête au plafond (au lieu de gonfler le canvas)');

/* ── 4. Boîte d'un trait : savoir quelles figures il touche ───────────────── */
const box = FE.mmStrokeBox({ sizeMm: 4, pts: [[10, 20], [30, 20]] });
eq(box, { x: 8, y: 18, w: 24, h: 4 }, 'la boîte du trait est élargie du rayon du pinceau');

/* ── 5. Millimètres du canvas → repère de la figure, et RETOUR ─────────────── */
/* La figure est dessinée à 10 mm du bord, large de 100 mm : c'est le rectangle
   que objFigureGeom donne pour l'image ENTIÈRE (le chemin du masque). */
const geom = { iX: 10, iY: 20, iW: 100, iH: 50, vX: 10, vY: 20, vW: 100, vH: 50, crop: null };
const drawn = { sizeMm: 5, pts: [[60, 45], [70, 45]] };
const src = FE.mmStrokeToSource(drawn, geom);
eq(src.p, [[0.5, 0.5], [0.6, 0.5]], 'les points du pinceau deviennent des fractions de la source');
near(src.s, 0.05, 'le diamètre du pinceau devient une fraction de la largeur dessinée');
const back = FE.strokePathMm(src, geom);
eq(back, 'M 60 45 L 70 45', 'le chemin du masque RETOMBE exactement sous le curseur');
near(FE.strokeWidthMm(src, geom), 5, 'l’épaisseur du masque est le pinceau en millimètres');
eq(FE.mmStrokeToSource({ sizeMm: 5, pts: [[0, 0], [5, 10]] }, geom), null,
  'un trait à côté de la figure ne l’efface pas (aucun point dans l’image)');
const partial = FE.mmStrokeToSource({ sizeMm: 5, pts: [[5, 45], [60, 45]] }, geom);
eq(partial.p, [[0.5, 0.5]], 'les points hors de l’image sont écartés, les autres restent');
eq(FE.mmStrokeToSource({ sizeMm: 5, pts: [[60, 45]] }, geom).s, 0.05, 'un seul point suffit (un clic = un trou)');
eq(FE.strokePathMm({ s: 0.05, p: [[0.5, 0.5]] }, geom), 'M 60 45 l 0.01 0',
  'un point seul est peint par un segment minuscule (un point nul ne se dessinerait pas)');
eq(FE.strokePathMm({ s: 0.05, p: [] }, geom), '', 'sans point, pas de chemin');
/* Le pinceau est borné même si la figure est minuscule (masque inutilisable). */
ok(FE.mmStrokeToSource({ sizeMm: 30, pts: [[5, 5]] }, { iX: 0, iY: 0, iW: 10, iH: 10 }).s <= 0.5,
  'le pinceau stocké ne dépasse jamais la moitié de l’image');

/* ── 6. Le masque : les traits prêts à peindre ────────────────────────────── */
const mask = FE.maskStrokesMm([src], geom);
eq(mask.length, 1, 'un trait stocké donne une forme');
eq(mask[0].d, 'M 60 45 L 70 45', '…avec son chemin');
near(mask[0].w, 5, '…et son épaisseur');
eq(FE.maskStrokesMm([src], geom, FE.mmStrokeToSource({ sizeMm: 3, pts: [[20, 30], [30, 40]] }, geom)).length, 2,
  'le trait EN COURS de tracé est peint avec les autres (aperçu immédiat)');
eq(FE.maskStrokesMm([{ s: 0.05, p: [] }], geom), [], 'un trait vide ne produit pas de forme');
eq(FE.maskStrokesMm([src], { iX: 0, iY: 0, iW: 0, iH: 0 }), [], 'une géométrie nulle ne peint rien');
ok(FE.eraseMaskId('in', 'obj1', 0) !== FE.eraseMaskId('fs', 'obj1', 0),
  'les deux SVG de l’écran (normal et plein écran) ne partagent pas le même id de masque');
eq(FE.eraseMaskId('', 'obj1', 0), 'figerase-in-obj1-0', 'sans préfixe, le masque de la vue normale est utilisé');

/* ── 7. L'écran s'en sert vraiment (fragments d'ImageBuilder.jsx) ─────────── */
has(IB, 'const [eraseMode, setEraseMode] = useState(false);', 'la gomme est un mode de l’éditeur');
has(IB, 'const [eraseSize, setEraseSize] = useState(ERASE_DEFAULT_SIZE);', '…avec une taille de pinceau réglable');
has(IB, '{ type: \'erase\'', 'le glissement de la souris trace un trait de gomme');
has(IB, 'const stroke = { sizeMm: clampEraseSize(eraseSize), pts: [[+pt.x.toFixed(3), +pt.y.toFixed(3)]] };',
  'le trait part du point cliqué, avec la taille du pinceau');
has(IB, 'const next = pushStrokePoint(st.stroke, pt.x, pt.y);', '…et s’allonge tant que la souris bouge');
has(IB, 'if (st.stroke && st.stroke.pts.length) applyEraseStroke(st.stroke);',
  'relâcher la souris POSE le trait sur toutes les figures touchées');
has(IB, 'const src = mmStrokeToSource(stroke, objFigureGeom(o, i));',
  'chaque figure effacée le fait dans SON repère (un trait qui frôle un panneau ne le touche pas)');
has(IB, 'const eraseMask = eraseStrokesFor(obj, i).length ? `url(#${eraseMaskId(svgId, obj.id, i)})` : undefined;',
  'l’image ne reçoit un masque que si quelque chose a été effacé');
has(IB, 'mask={eraseMask}', 'le masque est posé sur l’image (et sur l’image recadrée)');
has(IB, 'maskUnits="userSpaceOnUse"', 'le masque travaille en millimètres du canvas');
has(IB, '<rect x={g.iX} y={g.iY} width={g.iW} height={g.iH} fill="#ffffff" />', 'le blanc garde les pixels…');
has(IB, 'stroke="#000000" strokeWidth={st.w} fill="none" strokeLinecap="round"', '…le trait du pinceau les enlève, rond');
has(IB, 'onMouseDown={startEraseDrag}', 'le canvas entier devient la zone de dessin');
has(IB, 'data-selection-ui="true">\n          <rect x={0} y={0} width={canvasW}', '…et cette zone ne sort JAMAIS dans un export');
has(IB, 'const mmAtPointer = (clientX, clientY, svgEl = activeSvgEl()) => {',
  'le pinceau connaît la position exacte du curseur');
has(IB, 'y: (clientY - r.top) * ((canvasH + captionH) / Math.max(1, r.height))',
  '…bande de légende comprise (le pinceau tombe sous le curseur)');
has(IB, '<circle cx={eraseCursor.x} cy={eraseCursor.y} r={clampEraseSize(eraseSize) / 2}',
  'un cercle montre la taille réelle du pinceau');
has(IB, 'min={ERASE_SIZE_MIN} max={ERASE_SIZE_MAX} step="0.5" value={eraseSize}',
  'la taille se règle au curseur…');
has(IB, 'title="Diameter of the brush in millimetres of the canvas (0.5 to 30 mm)"', '…et au clavier');
has(IB, '⟲ Clear erasures', 'les pixels enlevés peuvent revenir');
has(IB, 'const clearErase = (objId, idx) => {', '…par une commande qui efface les traits de gomme');
has(IB, 'setEraseMode(false);   // the two drawing tools never fight for the mouse',
  'la gomme et le recadrage ne se disputent pas la souris');
has(IB, 'return withImages(o, getObjImages(o).map((im, i) => (i === idx ? { ...im, erase: [] } : im)));',
  'vider la gomme garde tout le reste');
has(IB, 'const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));',
  'les traits de gomme survivent à la copie persistée / annulée (le canvas ne garde qu’une vignette)');

console.log(`_builder_eraser_test.mjs — ${passed} assertions OK`);

eq(FE.mmStrokeBox({ sizeMm: 4, pts: [] }), null, 'un trait sans point n’a pas de boîte');
ok(FE.mmStrokeHits({ sizeMm: 4, pts: [[10, 20], [30, 20]] }, { x: 0, y: 0, w: 40, h: 40 }), 'le trait touche cette figure');
ok(!FE.mmStrokeHits({ sizeMm: 4, pts: [[10, 20], [30, 20]] }, { x: 0, y: 100, w: 40, h: 40 }), '…pas celle-là');
