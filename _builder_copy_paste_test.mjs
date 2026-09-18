/* =========================================================================
   _builder_copy_paste_test.mjs — « in the image builder allow me to copy and
   paste an object (text, figures) ».

   Un panneau de l'Image Builder se copie et se colle (Ctrl+C / Ctrl+V) avec SA
   figure (ou ses figures), SES textes libres et SES ombres. La charge utile du
   presse-papiers est construite ICI par le VRAI module utils/objectClipboard.js
   (importé, pas recopié), et les règles qu'il applique sont celles du builder :

     1. la copie ne part pas dans le presse-papiers avec les pixels pleine
        résolution (la vignette seulement — c'est `libId` qui ramène la finesse
        depuis la bibliothèque d'images) et elle est AUTONOME (JSON) ;
     2. un texte venu d'ailleurs n'est PAS notre copie : parseCopyPayload rend
        null, et le collage reste alors au navigateur ;
     3. le collage pose la copie dans la PREMIÈRE PLACE LIBRE de la grille — la
        règle de « + Add Object » — donc JAMAIS sur un panneau déjà là, avec des
        identifiants NEUFS et une taille bornée à la grille ;
     4. un lot de plusieurs panneaux garde sa disposition relative ;
     5. côté ImageBuilder.jsx : les événements copy/paste, les boutons « 📋 »,
        l'historique (Ctrl+Z), la sélection des copies et la renumérotation des
        lettres (A, B, C …) sont bien branchés.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBJECT_COPY_KIND, OBJECT_COPY_VERSION, firstFreeCellIn, lightweightPanel,
  buildCopyPayload, parseCopyPayload, payloadBounds, pastePanels
} from './src/utils/objectClipboard.js';

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
const sliceFn = (src, start, len = 1200) => {
  const at = src.indexOf(start);
  return at < 0 ? '' : src.slice(at, at + len);
};

const LARGE = 'data:image/png;base64,PLAINEFULRESOLUTION';
const THUMB = 'data:image/png;base64,VIGNETTE';
const FIG_RECT = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
const FIG_SHADOW = { dx: 0.5, dy: 0.5, blur: 0.5, color: '#111111', opacity: 0.4 };
const CROP = { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 };

const panel = (over = {}) => ({
  id: 'obj_1', x: 0, y: 0, w: 1, h: 1, letter: 'A',
  letterStyle: { fontSize: 14, color: '#000000', bold: true },
  caption: 'A: my sub-caption',
  imgFit: 'contain', imgScale: 1, imgPadding: 2, imgRotate: 0, imgCols: 2,
  shadow: { dx: 1, dy: 1, blur: 1, color: '#000000', opacity: 0.3 },
  images: [{ imgSrc: LARGE, imgThumb: THUMB, libId: 'lib_9', libScope: 'project', libProjectId: 'p1', rect: { ...FIG_RECT }, shadow: { ...FIG_SHADOW }, crop: { ...CROP } }],
  texts: [{ id: 'txt_1', x: 3, y: 4, text: 'WT', fontSize: 12, color: '#ff0000', bold: true, italic: false }],
  ...over
});

/* ── 1. La case libre : la règle de « + Add Object », une seule fois --------- */
eq(firstFreeCellIn([], 4, 5, 1, 1), { x: 0, y: 0 }, 'sur un canvas vide, la première case libre est la première de la grille');
eq(firstFreeCellIn([panel()], 4, 5, 1, 1), { x: 1, y: 0 }, 'le panneau A occupe (0,0) : la copie va à côté, jamais dessus');
eq(firstFreeCellIn([panel(), panel({ id: 'obj_2', x: 1, y: 0 })], 4, 5, 1, 1), { x: 2, y: 0 }, '…puis la case suivante, en lisant de gauche à droite');
eq(firstFreeCellIn([panel(), panel({ id: 'obj_2', x: 1, y: 0 })], 2, 5, 1, 1), { x: 0, y: 1 }, 'première ligne pleine : la ligne suivante');
eq(firstFreeCellIn([panel({ w: 2 })], 4, 5, 1, 1), { x: 2, y: 0 }, 'un panneau large occupe TOUTES ses cases (pas seulement son coin)');
eq(firstFreeCellIn([panel({ w: 2 })], 4, 5, 2, 1), { x: 2, y: 0 }, 'un bloc de 2 cases cherche 2 cases libres côte à côte');
eq(firstFreeCellIn([panel({ w: 3 })], 2, 5, 3, 1), null, 'un bloc plus large que la grille n’entre nulle part');
eq(firstFreeCellIn([panel(), panel({ id: 'b', x: 1, y: 0 }), panel({ id: 'c', x: 0, y: 1 }), panel({ id: 'd', x: 1, y: 1 })], 2, 2, 1, 1), null,
  'une grille pleine n’a plus de case libre');


/* ── 2. Ce que la copie emporte ---------------------------------------------- */
const copy = buildCopyPayload([panel()]);
eq(copy.kind, OBJECT_COPY_KIND, 'la charge utile se marque comme une copie de panneaux');
eq(copy.version, OBJECT_COPY_VERSION, '…à la version courante du format');
eq(copy.objects.length, 1, 'un panneau copié = un enregistrement');
const rec = copy.objects[0];
eq(rec.images[0].imgSrc, THUMB, 'la copie emporte la VIGNETTE, pas la capture pleine résolution');
ok(!JSON.stringify(copy).includes('PLAINEFULRESOLUTION'),
  'aucun pixel pleine résolution ne part dans le presse-papiers (des mégaoctets)');
eq(rec.images[0].libId, 'lib_9',
  '…mais la référence de bibliothèque voyage avec la copie : le collage retrouve la finesse');
eq(rec.images[0].rect, FIG_RECT, 'la boîte libre de la figure est copiée');
eq(rec.images[0].crop, CROP, '…son recadrage aussi');
eq(rec.images[0].shadow, FIG_SHADOW, '…et sa propre ombre');
eq(rec.texts.length, 1, 'les textes libres du panneau sont copiés');
eq(rec.texts[0].text, 'WT', '…avec leur contenu');
eq(rec.shadow, panel().shadow, 'l’ombre du PANNEAU suit la copie');
eq(rec.caption, 'A: my sub-caption', 'le sous-titre du panneau suit la copie');
eq(rec.imgCols, 2, 'la disposition des figures du panneau suit la copie');
ok(rec !== panel(), 'la copie est un objet NEUF (jamais le panneau vivant)');

/* La copie est AUTONOME : éditer le panneau après le Ctrl+C ne la change pas. */
const live = panel();
const frozen = buildCopyPayload([live]);
live.texts[0].text = 'MODIFIÉ APRÈS LA COPIE';
live.images[0].rect.w = 0.2;
eq(frozen.objects[0].texts[0].text, 'WT', 'la copie est autonome : retoucher le panneau ne la change pas');
eq(frozen.objects[0].images[0].rect.w, 0.8, '…idem pour la boîte de sa figure');

/* Un panneau de la forme HÉRITÉE (une figure dans imgSrc, pas dans images[]) se
   copie quand même : la copie écrit toujours la liste `images[]` que le builder
   relit (withImages / getObjImagesOf). */
const legacyCopy = lightweightPanel({ id: 'obj_L', x: 0, y: 0, w: 1, h: 1, imgSrc: LARGE, imgThumb: THUMB, libId: 'lib_L', texts: [] });
eq(legacyCopy.images.length, 1, 'un panneau hérité (imgSrc direct) donne bien une figure à la copie');
eq(legacyCopy.images[0].imgSrc, THUMB, '…avec la vignette comme pixels');
eq(legacyCopy.images[0].libId, 'lib_L', '…et sa référence de bibliothèque');

/* ── 3. La boîte englobante d'un lot ----------------------------------------- */
eq(payloadBounds([{ x: 2, y: 1, w: 1, h: 1 }]), { x: 2, y: 1, w: 1, h: 1 }, 'la boîte d’une copie d’un seul panneau est sa case');
eq(payloadBounds([{ x: 2, y: 1, w: 1, h: 1 }, { x: 3, y: 1, w: 2, h: 3 }]), { x: 2, y: 1, w: 3, h: 3 },
  'la boîte d’un lot englobe TOUS ses panneaux (les copies gardent leurs écarts)');
eq(payloadBounds([]), { x: 0, y: 0, w: 1, h: 1 }, 'un lot vide ne fait pas planter la boîte');
eq(payloadBounds([{ x: 0, y: 0 }]), { x: 0, y: 0, w: 1, h: 1 }, 'un panneau sans taille compte pour 1 × 1 case');

/* ── 4. Relire le presse-papiers : le nôtre, et pas celui des autres ---------- */
eq(parseCopyPayload('hello world'), null, 'un texte venu d’ailleurs n’est PAS une copie de panneaux');
eq(parseCopyPayload(''), null, 'un presse-papiers vide non plus');
eq(parseCopyPayload('{'), null, 'un JSON cassé non plus');
eq(parseCopyPayload(JSON.stringify({ kind: 'un-autre-format', objects: [{}] })), null, 'un autre format (kind inconnu) est refusé');
eq(parseCopyPayload(JSON.stringify({ kind: OBJECT_COPY_KIND, version: 99, objects: [{}] })), null,
  'une version plus récente du format est refusée (on n’invente pas ses champs)');
eq(parseCopyPayload(JSON.stringify({ kind: OBJECT_COPY_KIND, version: 1, objects: [] })), null, 'une copie sans panneau n’est pas une copie');
eq(parseCopyPayload([1, 2, 3]), null, 'un tableau n’est pas une charge utile');
const back = parseCopyPayload(JSON.stringify(copy));
eq(back.objects.length, 1, 'notre propre copie se relit (aller-retour complet par le presse-papiers)');
eq(back.kind, OBJECT_COPY_KIND, '…en gardant son type');
eq(back.objects[0].texts[0].text, 'WT', '…et son contenu');

/* ── 5. Le collage : la première place libre, des identifiants neufs ---------- */
const GRID = { gridCols: 4, gridRows: 5, seed: 7 };
const origin = panel();
const one = pastePanels([origin], copy, GRID);
eq(one.added.length, 1, 'le collage pose un panneau');
eq([one.added[0].x, one.added[0].y], [1, 0], 'il se pose dans la première case libre — PAS sur l’original');
ok(one.objects[0] === origin, 'le panneau qui était là n’est pas touché (même référence)');
ok(one.added[0] !== origin, 'le panneau collé est une copie, pas l’original');
eq(one.added[0].id, 'obj_cp_7_0', 'la copie reçoit un identifiant NEUF (aucune collision avec l’original)');
eq(one.ids, ['obj_cp_7_0'], 'l’appelant reçoit les identifiants collés — pour les sélectionner');
eq(one.objects.length, 2, 'la liste du canvas s’allonge d’un panneau');
eq(one.added[0].texts[0].id, 'txt_cp_7_0_0', 'les textes du panneau collé sont ré-identifiés (ils sont à lui)');
eq(one.added[0].texts[0].text, 'WT', '…sans perdre leur contenu');
eq(one.added[0].images[0].imgSrc, THUMB, 'la figure collée garde ses pixels (la vignette)');
eq(one.added[0].letter, 'A', 'la lettre est recopiée telle quelle — c’est renumberLetters qui la renumérote par POSITION');

/* Grille pleine : rien n'est collé, rien n'est écrasé, et la liste est rendue
   telle quelle (donc aucun historique, aucune écriture). */
const packed = [panel(), panel({ id: 'b', x: 1, y: 0 }), panel({ id: 'c', x: 0, y: 1 }), panel({ id: 'd', x: 1, y: 1 })];
const noRoom = pastePanels(packed, copy, { gridCols: 2, gridRows: 2, seed: 8 });
eq(noRoom.added, [], 'sur une grille pleine, rien n’est collé');
eq(noRoom.skipped, 1, '…et l’appelant sait combien de panneaux n’ont pas trouvé de place');
ok(noRoom.objects === packed, 'la liste reçue est rendue TELLE QUELLE : rien à écrire, rien à annuler');

/* Un LOT de deux panneaux côte à côte se recolle côte à côte. */
const twinList = [panel(), panel({ id: 'obj_2', x: 1, y: 0, letter: 'B', texts: [] })];
const twin = buildCopyPayload(twinList);
const two = pastePanels(twinList, twin, GRID);
eq(two.added.length, 2, 'un lot de deux panneaux se colle entier');
eq(two.added.map((o) => [o.x, o.y]), [[2, 0], [3, 0]], '…côte à côte : il garde la disposition du lot d’origine');
eq(two.skipped, 0, 'aucun panneau du lot n’est perdu');
eq(two.ids.length, 2, 'les deux copies sont rendues pour être sélectionnées');
ok(two.ids[0] !== two.ids[1], 'deux copies ne partagent jamais un identifiant');

/* Le lot n'entre plus d'un bloc (la grille d'arrivée est plus étroite que lui) :
   chaque panneau prend alors sa propre place libre, dans l'ordre du lot. */
const spread = buildCopyPayload([panel({ id: 's1', texts: [] }), panel({ id: 's2', x: 3, y: 0, texts: [] })]);
eq(payloadBounds(spread.objects).w, 4, 'la boîte de ce lot est plus large que la grille d’arrivée (3 colonnes)');
const fallback = pastePanels([panel({ id: 'keep', w: 3, h: 1 })], spread, { gridCols: 3, gridRows: 3, seed: 10 });
eq(fallback.added.map((o) => [o.x, o.y]), [[0, 1], [1, 1]],
  'lot qui n’entre pas d’un bloc : chaque panneau prend la première place libre, dans l’ordre');

/* Une seule place pour deux panneaux : un seul est collé, l'autre est signalé. */
const partial = pastePanels([panel({ id: 'a' }), panel({ id: 'b', x: 0, y: 1 })], twin,
  { gridCols: 1, gridRows: 3, seed: 11 });
eq(partial.added.length, 1, 'le panneau qui a trouvé une place est collé');
eq(partial.skipped, 1, '…l’autre est compté comme non placé (jamais posé par-dessus)');
eq([partial.added[0].x, partial.added[0].y], [0, 2], '…il prend la seule case restante');

/* Une copie venue d'un canvas plus grand est ramenée aux dimensions de la
   grille d'arrivée : un panneau doit tenir ENTIER sur le canvas. */
const wide = buildCopyPayload([panel({ id: 'wide', w: 3, h: 2, texts: [] })]);
const clamped = pastePanels([], wide, { gridCols: 2, gridRows: 2, seed: 12 });
eq([clamped.added[0].w, clamped.added[0].h], [2, 2], 'la taille collée est bornée à la grille (le format a pu changer)');

/* Un texte qui n'est pas notre copie ne colle rien du tout. */
const junk = pastePanels([panel()], 'bonjour', GRID);
eq(junk.added, [], 'coller un texte qui n’est pas notre copie ne fait rien');
eq(junk.skipped, 0, '…et ne rapporte aucun panneau perdu');
ok(junk.objects !== null, '…et rend la liste reçue');

/* ── 6. Le branchement dans ImageBuilder.jsx ---------------------------------- */
has(IB, "import {\n  firstFreeCellIn, buildCopyPayload, parseCopyPayload, pastePanels\n} from '../utils/objectClipboard';",
  'le builder importe le module du presse-papiers');
has(IB, 'const firstFreeCell = (list, w = 1, h = 1) => {\n    return firstFreeCellIn(list, gridCols, gridRows, w, h);',
  'une SEULE règle de placement : celle de « + Add Object » et celle du collage');
has(IB, 'const clipboardRef = useRef(null);', 'le presse-papiers interne (bouton « 📋 Paste » et repli)');
has(IB, "e.clipboardData.setData('text/plain', JSON.stringify(payload));",
  'Ctrl+C écrit notre copie dans le presse-papiers du navigateur');
has(IB, 'e.preventDefault();          // the copy is OURS, not the page selection',
  '…sans y mettre la sélection de la page');
has(IB, "document.addEventListener('copy', onCopy);", 'l’événement copy est écouté (aucune autorisation nécessaire)');
has(IB, "document.addEventListener('paste', onPaste);", 'l’événement paste aussi (la copie passe d’un onglet à l’autre)');
has(IB, "el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable",
  'un champ en cours d’édition garde le copier/coller du NAVIGATEUR (on ne vole jamais Ctrl+C)');
has(IB, 'const fromClipboard = parseCopyPayload(text);', 'le collage relit notre charge utile dans le presse-papiers');
has(IB, "if (String(text || '').trim()) return;   // text from elsewhere: not our copy, leave it alone",
  'un texte venu d’ailleurs n’est jamais remplacé par un panneau collé');
has(IB, 'const res = pastePanels(objects, payload, { gridCols, gridRows, seed: Date.now() });',
  'le collage passe par la fonction pure (identifiants neufs, première place libre)');

const pasteFn = sliceFn(IB, 'const pastePayload = (payload) => {');
ok(pasteFn.includes('commitHistory();'), 'coller est annulable (Ctrl+Z)');
ok(pasteFn.indexOf('commitHistory();') < pasteFn.indexOf('setObjects(res.objects);'),
  '…l’historique est pris AVANT l’écriture, comme partout ailleurs');
has(pasteFn, 'setSelectedIds(res.ids);', 'les panneaux collés sont sélectionnés, prêts à être placés');
has(pasteFn, 'renumberLetters();', 'les lettres sont renumérotées par POSITION après le collage');
has(pasteFn, "window.alert('The grid has no free cell left for the copied panel",
  'une grille sans place libre est DITE à l’utilisateur, jamais contournée');

has(IB, 'const copySelection = (ids = selectedIds) => {', 'la copie prend la sélection courante (ou celle qu’on lui passe)');
has(IB, 'clipboardRef.current = payload;', 'la copie est gardée en mémoire pour le bouton « 📋 Paste »');
has(IB, '>📋 Copy</button>', 'le bouton « 📋 Copy » de la bande « Panels »');
has(IB, ">📋 Paste{clipCount ? ` (${clipCount})` : ''}</button>", 'le bouton « 📋 Paste », avec le nombre de panneaux copiés');
has(IB, 'title="Copy this panel — its figure(s), its texts and its shadows — Ctrl+C does the same">⧉ Copy</button>',
  'les propriétés offrent « ⧉ Copy » à côté de Delete');
ok(times(IB, /onClick=\{\(\) => pasteClipboard\(\)\}/g) >= 2,
  'on peut coller depuis la barre d’outils ET depuis la bande « Panels »');
has(IB, '📋 Paste', 'le collage est visible dans l’interface');

console.log(`_builder_copy_paste_test.mjs — ${passed} assertions OK`);


