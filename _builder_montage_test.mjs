/* =========================================================================
   _builder_montage_test.mjs — « in the image builder when I add a figure in an
   object that contains already other objects, these latter are moved and
   resized and I have to do all the work again ».

   Un panneau de l'Image Builder (« object ») peut porter PLUSIEURS figures.
   Elles étaient rangées dans une GRILLE recalculée à chaque rendu à partir du
   NOMBRE de figures : en ajouter une re-flowait tout — les figures déjà mises
   changeaient de taille et de place, échelle / décalages / recadrages à
   refaire. La GÉOMÉTRIE LIBRE (utils/figureLayout.js, importée ICI pour de
   vrai) écrit sur chaque figure déjà présente le rectangle exact de ce qu'elle
   occupe à l'écran : plus rien ne bouge, et la nouvelle figure se range dans le
   plus grand espace libre.

   Le test rejoue la géométrie d'objFigureGeom (ImageBuilder.jsx) — chemin
   « rect » comme chemin « grille » — et vérifie que les deux donnent la MÊME
   boîte visible : c'est la promesse faite à l'utilisateur.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const FL = await import('./src/utils/figureLayout.js');
// CRLF → LF : les fragments vérifiés plus bas contiennent des sauts de ligne.
const IB = readFileSync('./src/components/ImageBuilder.jsx', 'utf8').replace(/\r\n/g, '\n');
// La géométrie d'une sélection multiple (déplacer / redimensionner PLUSIEURS
// panneaux ou figures d'un coup) vit dans utils/panelSelection.js : quelques
// formules vérifiées ici sont donc lues là-bas.
const PS = readFileSync('./src/utils/panelSelection.js', 'utf8').replace(/\r\n/g, '\n');

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
/* Les rectangles sont écrits au 1/10 000 du panneau (comme le recadrage) :
   1/100 mm d'écart est déjà très au-delà de la précision réelle et reste
   invisible — c'est la tolérance des comparaisons. */
const near = (a, b, what, eps = 0.01) => {
  assert.ok(Math.abs(a - b) < eps, `${what}\n  attendu : ${b}\n  obtenu  : ${a}`);
  passed += 1;
};

/* ── miroir de objFigureGeom (ImageBuilder.jsx) — chemin grille ET chemin rect
   `aspect` = 0 (ratio inconnu) : la figure remplit sa boîte, comme dans le
   builder quand l'image n'est pas encore mesurée. */
const geomOf = ({ obj, imgs, i, cellW = 60, cellH = 40, aspect = 0 }) => {
  const im = imgs[i] || {};
  const single = imgs.length === 1;
  const cols = single ? 1 : Math.max(1, obj.imgCols || 2);
  const rows = single ? 1 : Math.ceil(imgs.length / cols);
  const cw = (obj.w * cellW) / cols;
  const ch = (obj.h * cellH) / rows;
  const pad = obj.imgPadding || 0;
  const rect = FL.freeRectOf(im);
  const baseX = rect ? (obj.x * cellW) + rect.x * obj.w * cellW : obj.x * cellW + (i % cols) * cw + pad;
  const baseY = rect ? (obj.y * cellH) + rect.y * obj.h * cellH : obj.y * cellH + Math.floor(i / cols) * ch + pad;
  const baseW = rect ? rect.w * obj.w * cellW : cw - pad * 2;
  const baseH = rect ? rect.h * obj.h * cellH : ch - pad * 2;
  const figScale = rect ? 1 : (obj.imgScale || 1) * (im.scale || 1);
  let iW = baseW * figScale;
  let iH = baseH * figScale;
  if (aspect > 0 && iW > 0 && iH > 0) {
    if (iW / iH > aspect) iW = iH * aspect; else iH = iW / aspect;
  }
  return {
    vX: baseX + (baseW - iW) / 2 + (rect ? 0 : (obj.imgOffsetX || 0) + (im.dx || 0)),
    vY: baseY + (baseH - iH) / 2 + (rect ? 0 : (obj.imgOffsetY || 0) + (im.dy || 0)),
    vW: iW, vH: iH
  };
};
/* La boîte visible d'un panneau en mm — ce que « geler » convertit en rect. */
const panelBox = (obj, cellW = 60, cellH = 40) => ({ x: obj.x * cellW, y: obj.y * cellH, w: obj.w * cellW, h: obj.h * cellH });
/* Ce que fait `freezeFigures` du builder. */
const freeze = (obj, imgs, cellW = 60, cellH = 40) => imgs.map((im, i) => {
  if (FL.freeRectOf(im)) return im;
  const g = geomOf({ obj, imgs, i, cellW, cellH });
  return { ...im, rect: FL.pinRectOf({ x: g.vX, y: g.vY, w: g.vW, h: g.vH }, panelBox(obj, cellW, cellH)), scale: 1, dx: 0, dy: 0 };
});


/* ── 1. Le rectangle d'une figure libre : borné, jamais absurde ────────────── */
eq(FL.freeRectOf({}), null, 'une figure sans rectangle est rangée par la grille');
eq(FL.freeRectOf({ rect: { x: 0, y: 0, w: 0, h: 0 } }), { x: 0, y: 0, w: 0.02, h: 0.02 },
  'un rectangle trop petit est remonté au minimum (une vignette doit rester prenable)');
eq(FL.freeRectOf({ rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }), { x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
  'un rectangle qui DÉBORDE du panneau est conservé (c’est ainsi qu’on cache une partie de la figure)');
const clip = FL.panelClipRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
near(clip.w, 0.1, '…mais seule sa part qui tombe dans le panneau occupe une place (largeur)');
near(clip.h, 0.1, '…(hauteur)');
eq(FL.panelClipRect({ x: -1, y: 0, w: 0.5, h: 1 }), null, 'une figure entièrement hors du panneau n’occupe aucune place');
eq(FL.normFreeRect({ x: 0, y: 0, w: 99, h: 99 }), { x: 0, y: 0, w: 4, h: 4 }, 'les côtés restent bornés (4 × le panneau)');
eq(FL.freeRectOf({ rect: { x: 'a', y: 0, w: 1, h: 1 } }), null, 'des nombres invalides ne font pas un rectangle');
eq(FL.isFreeLayout([{ imgSrc: 'a' }, { rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }]), true,
  'le panneau est en géométrie libre dès qu’une figure porte un rectangle');
eq(FL.isFreeLayout([{ imgSrc: 'a' }]), false, 'sans rectangle, le panneau suit la grille');

/* ── 2. GELER une figure ne la déplace pas d'un pixel ─────────────────────── */
/* Le cas qui a coûté du travail : une figure réglée (échelle, décalages,
   marge) dans un panneau, puis une DEUXIÈME figure ajoutée. */
const panel = { id: 'o1', x: 1, y: 1, w: 1, h: 1, imgPadding: 2, imgScale: 1.4, imgOffsetX: 3, imgOffsetY: -2, imgCols: 2 };
const first = { imgSrc: 'data:image/png;base64,one', scale: 1.1, dx: 1.5, dy: -0.5 };
const before = geomOf({ obj: panel, imgs: [first], i: 0 });
const pinnedFirst = freeze(panel, [first])[0];
ok(!!pinnedFirst.rect, 'la figure déjà là reçoit son rectangle');
eq([pinnedFirst.scale, pinnedFirst.dx, pinnedFirst.dy], [1, 0, 0],
  'échelle et décalages sont REPRIS dans le rectangle (sinon ils compteraient deux fois)');
const afterGeom = geomOf({ obj: panel, imgs: [pinnedFirst], i: 0 });
near(afterGeom.vX, before.vX, 'la figure gelée ne bouge pas (X)');
near(afterGeom.vY, before.vY, 'la figure gelée ne bouge pas (Y)');
near(afterGeom.vW, before.vW, 'la figure gelée garde sa largeur');
near(afterGeom.vH, before.vH, 'la figure gelée garde sa hauteur');

/* ── 3. …et l'ajout de la nouvelle ne la déplace toujours pas ─────────────── */
const slot = FL.freeSlotFor([pinnedFirst.rect]);
const withNew = [...freeze(panel, [first]), { imgSrc: 'data:image/png;base64,two', rect: slot }];
const stillThere = geomOf({ obj: panel, imgs: withNew, i: 0 });
near(stillThere.vX, before.vX, 'après l’ajout, la première figure est TOUJOURS au même endroit');
near(stillThere.vY, before.vY, '…et à la même hauteur');
near(stillThere.vW, before.vW, '…et à la même taille');
const newGeom = geomOf({ obj: panel, imgs: withNew, i: 1 });
const pb = panelBox(panel);
ok(newGeom.vW > 0 && newGeom.vH > 0, 'la nouvelle figure a bien une boîte');
ok(newGeom.vX >= pb.x - 0.01 && newGeom.vY >= pb.y - 0.01
  && newGeom.vX + newGeom.vW <= pb.x + pb.w + 0.01 && newGeom.vY + newGeom.vH <= pb.y + pb.h + 0.01,
  'la nouvelle figure reste dans son panneau');
/* Un panneau REMPLI par sa première figure n'a plus d'espace libre : la
   nouvelle se pose par-dessus, centrée — elle ne pousse personne. */
eq(slot, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, 'panneau plein : la nouvelle se pose au centre, par-dessus');

/* ── 4. Un vrai espace libre est utilisé (deux figures côte à côte) ───────── */
eq(FL.freeSlotFor([{ rect: { x: 0, y: 0, w: 0.5, h: 1 } }]), { x: 0.5, y: 0, w: 0.5, h: 1 },
  'la moitié droite libre est prise');
eq(FL.freeSlotFor([{ rect: { x: 0.5, y: 0, w: 0.5, h: 1 } }]), { x: 0, y: 0, w: 0.5, h: 1 },
  'symétriquement, la moitié gauche');
eq(FL.freeSlotFor([]), { x: 0, y: 0, w: 1, h: 1 }, 'panneau vide : la figure prend toute la place');
const many = [{ rect: { x: 0, y: 0, w: 0.5, h: 1 } }, { rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } }];
eq(FL.freeSlotFor(many), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'la dernière case libre est trouvée');
const quarter = FL.freeSlotFor([{ rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }]);
ok(quarter.w * quarter.h >= 0.25 && !(quarter.x < 0.5 && quarter.y < 0.5),
  'le plus grand espace libre est choisi et il ne recouvre pas la figure déjà là');

/* ── 5. Le retour à la grille (« ⊞ Lay the figures out in a grid ») ───────── */
const cleared = [{ ...pinnedFirst, rect: null }, { imgSrc: 'x', rect: null }];
eq(FL.isFreeLayout(cleared), false, 'rectangle remis à null : la grille reprend la main');
eq(FL.freeRectOf(cleared[0]), null, 'plus aucun rectangle libre');
const gridGeom = geomOf({ obj: panel, imgs: cleared, i: 0 });
ok(gridGeom.vW < before.vW, 'en grille à deux colonnes, la figure est re-flowée — ce que l’utilisateur CHOISIT maintenant');

/* ── 6. Le composant s'en sert vraiment (fragments de l'écran) ────────────── */
has(IB, 'const freezeFigures = (obj, imgs) => {', 'l’ajout gèle les figures déjà présentes');
has(IB, 'const pinned = freezeFigures(o, getObjImages(o));', '…avant d’ajouter la nouvelle');
has(IB, 'const slot = freeSlotFor(pinned.map(freeRectOf));', '…qui prend le plus grand espace libre');
has(IB, 'rect: slot', 'la nouvelle figure porte SON rectangle');
has(IB, 'setActiveFig({ objId: obj.id, idx: wasCount });', 'elle devient la figure active (ses poignées sont là)');
has(IB, 'const rect = freeRectOf(im);', 'objFigureGeom tient compte du rectangle');
has(IB, 'const baseW = rect ? rect.w * obj.w * cellW : cw - pad * 2;', '…qui remplace la cellule de la grille');
has(IB, 'const figScale = rect ? 1 : (obj.imgScale || 1) * (im.scale || 1);',
  '…l’échelle du panneau est déjà dans le rectangle (pas comptée deux fois)');
has(IB, 'const rect = freeRectOf(im);\n    const baseX', 'la géométrie libre est lue avant la boîte');
has(IB, 'const patches = moveFiguresPatches(figs, { dxMm, dyMm, panelWmm: o.w * cellW, panelHmm: o.h * cellH });',
  'une figure gelée se déplace par son rectangle — même geste, mêmes chiffres (le calcul vit dans utils/panelSelection)');
has(PS, 'x: round4(Math.max(RECT_MIN - num(r.w), Math.min(1 - RECT_MIN, num(r.x) + dx / pw))),',
  '…et la formule est bien celle d’avant (bornée à la lisière de 2 % qui reste attrapable)');
has(PS, 'out[fig.idx] = { dx: +(num(fig.dx) + dx).toFixed(2), dy: +(num(fig.dy) + dy).toFixed(2) };',
  'une figure restée en grille se déplace toujours en dx/dy millimètres (le repli d’avant)');
has(IB, 'const patches = resizeFiguresPatches(figs, imgIdx, factor);',
  'idem pour la poignée de redimensionnement');
has(IB, 'if (r && imgs.length === 1)', 'un panneau à une seule figure gelée se déplace aussi par son rectangle');
has(IB, '⊞ Free layout — every figure of this panel keeps its own place', 'l’écran explique la géométrie libre');
has(IB, '⊞ Lay the figures out in a grid', '…et offre le retour à la grille');
has(IB, 'onClick={() => relayoutInGrid(selectedObj)}', 'le bouton du retour à la grille est branché');
has(IB, 'const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));',
  'le rectangle survit à la copie persistée / annulée (thumbnailOf garde l’image entière)');
has(IB, 'disabled={selectedFreeLayout}', 'en géométrie libre, échelle et marge du panneau sont désactivées (elles n’agissent plus)');
has(IB, 'title="Add another figure to this same object/panel: the figures already there are FROZEN',
  'le bouton « ➕ Add figure » annonce le nouveau comportement');

console.log(`_builder_montage_test.mjs — ${passed} assertions OK`);
