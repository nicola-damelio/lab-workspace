/* =========================================================================
   _builder_figshadow_test.mjs — l'ombre des figures, et LA RÈGLE QUI A SUIVI :
   « fix the shadow: now only cast shadows on panels and not on objects as it
   claims ».

   HISTORIQUE. L'ombre du panneau suivait son CADRE (le rectangle blanc) et
   l'utilisateur avait demandé celle des IMAGES : chaque figure a donc reçu son
   propre enregistrement `im.shadow` — le même que les panneaux et les flèches
   (`{ dx, dy, blur, color, opacity }`, mm) — peint par SON `<feDropShadow>`.

   CE QUI RESTE VRAI (et que ce test vérifie toujours) :
     • le filtre est posé sur un GROUPE QUI ENVELOPPE l'image, jamais sur
       l'image : `<feDropShadow>` travaille alors sur les PIXELS de la figure
       (son alpha) et non sur une boîte — un PNG à fond transparent est donc
       ombré autour de son contenu, comme si son fond était transparent ;
     • le masque de la 🧽 gomme, lui, est une propriété de l'image : il est
       appliqué AVANT le filtre du groupe, donc ce qui a été effacé ne projette
       aucune ombre (la matière enlevée n'existe plus) ;
     • la rotation reste sur l'image : dx/dy continuent de pointer bas-droite
       sur le CANVAS et ne tournent pas avec la figure ;
     • le filtre est dans la composition SVG, donc Export PNG / Save canvas /
       Insert into project le conservent (ces chemins rastérisent ce SVG-là).
   CE QUI A CHANGÉ : l'ombre est redevenue un réglage du PANNEAU. Les commandes
   par figure (bloc « 🌓 Figure shadow », pastille 🌓 de chaque ligne) ont été
   retirées de la fenêtre de l'objet : un canvas plus ancien qui porte une ombre
   de figure reste dessiné à l'identique, mais on ne peut plus la régler.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_SHADOW, SHADOW_LIMITS, shadowSpec, shadowFilterId, figureShadowFilterId
} from './src/utils/figureArrows.js';

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
const count = (hay, re) => (hay.match(re) || []).length;

/* ── 1. L'identifiant du filtre d'UNE figure ─────────────────────────────── */
eq(figureShadowFilterId('obj_1', 0), 'fshadow-obj_1-fig0', 'le filtre d’une figure est nommé d’après son panneau et son rang');
eq(figureShadowFilterId('obj_1', 2), 'fshadow-obj_1-fig2', '…et change avec le rang de la figure');
ok(figureShadowFilterId('obj_1', 0) !== figureShadowFilterId('obj_2', 0),
  'deux panneaux ne partagent jamais un filtre');
ok(figureShadowFilterId('obj_1', 0) !== figureShadowFilterId('obj_1', 1),
  'deux figures du MÊME panneau ne partagent jamais un filtre');
ok(figureShadowFilterId('obj_1', 0) !== shadowFilterId('obj_1'),
  'le filtre d’une figure ne peut pas écraser celui de son PANNEAU');
eq(figureShadowFilterId('obj_1', 0), shadowFilterId('obj_1-fig0'),
  'l’id d’une figure passe par shadowFilterId (donc il est échappé comme les autres)');
eq(figureShadowFilterId('obj #1 / x', 1), 'fshadow-obj__1___x-fig1', 'un id de panneau douteux est échappé (# et espaces)');
eq(figureShadowFilterId(null, 0), 'fshadow-null-fig0', 'un panneau sans id ne casse pas la référence');
eq(figureShadowFilterId('obj_1', -3), 'fshadow-obj_1-fig0', 'un rang négatif retombe sur 0');
eq(figureShadowFilterId('obj_1', 'x'), 'fshadow-obj_1-fig0', 'un rang non numérique retombe sur 0');
eq(figureShadowFilterId('obj_1', 2.6), 'fshadow-obj_1-fig3', 'un rang décimal est arrondi');
has(IB, 'figureShadowFilterId, DEFAULT_SHADOW\n} from \'../utils/figureArrows\';', 'le builder importe le module partagé (une seule source d’id)');
eq(count(IB, /fshadow-/g), 0, 'aucun id de filtre n’est écrit à la main dans le composant');

/* ── 2. L'enregistrement d'ombre d'une figure ────────────────────────────── */
/* C'est le MÊME record que celui d'un panneau (mêmes champs, mêmes bornes) :
   une ombre absente (null) veut dire « pas de filtre », jamais un filtre à zéro. */
eq(shadowSpec(null), null, 'une figure sans ombre n’a pas de filtre');
eq(shadowSpec(undefined), null, '…idem pour une figure d’un canvas enregistré avant cette option');
eq(shadowSpec({}), DEFAULT_SHADOW, 'une ombre activée sans valeur prend les défauts');
eq(shadowSpec({ dx: 500 }).dx, SHADOW_LIMITS.dx[1], 'les décalages restent bornés (pas de NaN dans le filtre)');
eq(shadowSpec({ color: '  ' }).color, DEFAULT_SHADOW.color, 'une couleur vide retombe sur le défaut');
ok(shadowSpec({ dx: 1 }) !== DEFAULT_SHADOW, 'le record rendu est une copie (pas la constante partagée)');

/* Deux figures peuvent porter DEUX ombres différentes, indépendantes du panneau. */
const panelShot = {
  shadow: { dx: 1.5, dy: 1.5, blur: 1.2, color: '#0f172a', opacity: 0.35 },
  images: [{ imgSrc: 'a', shadow: { dx: 3, dy: -1, blur: 2, color: '#111827', opacity: 0.5 } }, { imgSrc: 'b' }]
};
eq(shadowSpec(panelShot.images[0].shadow).dx, 3, 'l’ombre d’une figure est la sienne');
eq(shadowSpec(panelShot.images[1].shadow), null, 'une figure sans ombre n’en reçoit pas du panneau');
eq(shadowSpec(panelShot.shadow).dx, 1.5, 'l’ombre du panneau reste indépendante');

/* ── 3. Le filtre d'une figure dans le <defs> ────────────────────────────── */
const defsStart = IB.indexOf('<defs>');
const defsEnd = IB.indexOf('</defs>') + '</defs>'.length;
const defs = IB.slice(defsStart, defsEnd);
ok(defsStart > 0 && defsEnd > defsStart, 'le bloc <defs> est identifiable');
has(defs, '{objects.map(obj => getObjImages(obj).map((im, i) => {\n          const sp = shadowSpec(im.shadow);',
  'un filtre par FIGURE (et non un filtre par panneau)');
has(defs, 'if (!sp) return null;', 'une figure sans ombre n’a AUCUN filtre (comme les panneaux)');
has(defs, '<filter key={`fsf-${obj.id}-${i}`} id={figureShadowFilterId(obj.id, i)} x="-25%" y="-25%" width="150%" height="150%">',
  'la région du filtre est élargie (un grand décalage / flou n’est pas coupé)');
has(defs, '<feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />',
  'c’est un vrai <feDropShadow> (il suit l’alpha de la source), pas un rectangle gris');
eq(count(defs, /<feDropShadow /g), 4, 'les QUATRE ombres (panneau, flèche, figure, forme) partagent la même primitive');
ok(defs.indexOf('figureShadowFilterId') > defs.indexOf('shadowFilterId(a.id)'),
  'le filtre des figures est défini avec les autres (dans le MÊME <defs>)');
ok(defs.indexOf('fsf-') < defs.indexOf('</defs>'), '…et donc présent dans chaque export (le SVG est rastérisé tel quel)');

/* ── 4. La couche des figures : le filtre ENVELOPPE l'image ─────────────── */
/* C'est ici que se joue « comme si leur fond était transparent » : le filtre
   porte sur le groupe, donc <feDropShadow> voit les pixels de l'image (son
   alpha). Posé sur l'image elle-même, il aurait exactement le même effet sur
   l'alpha mais il serait appliqué APRÈS le masque de la gomme (l'ordre des
   propriétés SVG est filtre → clip → masque) : ce qui a été effacé aurait
   continué à projeter son ombre. */
const layerStart = IB.indexOf('{imgs.map((im, i) => {');
const layerEnd = IB.indexOf('{/* Single figure: shift + the FOUR corner handles (a plain');
ok(layerStart > 0 && layerEnd > layerStart, 'la couche des figures est identifiable');
const layer = IB.slice(layerStart, layerEnd);

has(layer, 'const figShadow = shadowSpec(im.shadow);', 'chaque figure lit SON ombre');
eq(count(layer, /filter=\{figShadow \? `url\(#\$\{figureShadowFilterId\(obj\.id, i\)\}\)` : undefined\}/g), 2,
  'le filtre est posé sur les DEUX chemins de dessin (figure libre et figure recadrée)');
eq(count(layer, /filter=\{figShadow \?/g), 2, '…et sur eux seuls');
eq(count(layer, /<g key=\{im\.libId \|\| i\} filter=\{figShadow \?/g), 2, 'le filtre est sur un GROUPE, deux fois');
eq(count(layer, /mask=\{eraseMask\}/g), 2, 'le masque de la gomme reste posé sur l’IMAGE, deux fois');
const imageEls = layer.match(/<image[\s\S]*?\/>/g) || [];
eq(imageEls.length, 2, 'la couche dessine toujours une <image> par chemin (libre, recadrée)');

/* Ordre SVG : le <g> filtré ouvre, l'image masquée est DEDANS, le groupe ferme.
   (Dans la source, le chemin RECADRÉ est écrit en premier — il ouvre un
   sous-groupe tourné —, puis le chemin normal.) */
const cropOpen = layer.indexOf('<g key={im.libId || i} filter={figShadow ?');
const plainOpen = layer.lastIndexOf('<g key={im.libId || i} filter={figShadow ?');
ok(plainOpen > cropOpen, 'les deux chemins (recadré, normal) portent chacun son groupe filtré');
const plain = layer.slice(plainOpen, layer.indexOf('</g>', plainOpen) + '</g>'.length);
ok(plain.indexOf('<image href={src}') > 0, 'l’image est bien dans le groupe filtré (chemin normal)');
ok(plain.indexOf('mask={eraseMask}') > plain.indexOf('<image href={src}'),
  'son masque de gomme est posé sur l’image, À L’INTÉRIEUR du groupe filtré');
ok(plain.indexOf('</g>') > plain.indexOf('mask={eraseMask}'),
  'le groupe filtré se referme APRÈS l’image masquée → le filtre voit ce qui reste');
ok(plain.indexOf('transform={rot ? `rotate(${rot} ${center})` : undefined}') > plain.indexOf('<image href={src}'),
  'la rotation reste sur l’IMAGE : dx/dy ne tournent pas avec la figure');
ok(imageEls.every((el) => !el.includes('filter={figShadow ?')),
  'l’ombre n’est JAMAIS posée sur une image directement (toujours sur son groupe qui l’enveloppe)');
ok(imageEls.every((el) => !el.includes('filter={`url(#${figureShadowFilterId')),
  '…et le filtre d’ombre d’une figure n’est jamais sur l’<image> elle-même');
/* Le filtre de RÉGLAGE d’image (contraste, luminosité, couleur — voir
   utils/figureAdjust), lui, EST sur l’<image> : il travaille les PIXELS, et il
   doit s’appliquer AVANT l’ombre du groupe qui l’enveloppe. */
ok(imageEls.some((el) => el.includes('filter={adjustFilter}')),
  'le réglage d’image, lui, est bien posé sur l’image (il travaille ses pixels)');

/* Le chemin RECADRÉ a, lui aussi, le groupe filtré au-dessus du groupe tourné. */
const cropSlice = layer.slice(cropOpen, layer.indexOf('</g>', cropOpen) + '</g>'.length);
ok(cropSlice.indexOf('<g transform={rot ?') > 0, 'figure recadrée : la rotation est dans un sous-groupe');
ok(cropSlice.indexOf('clipPath={`url(#figclip-${obj.id}-${i})`}') > 0, '…dont l’image garde la fenêtre de recadrage');
ok(!/\bshadow=\{[^}]/.test(layer), 'l’ombre d’une figure n’est jamais écrite dans le SVG exporté (seul le filtre l’est)');

/* Le reste de la figure (géométrie, gomme, recadrage) est intact : un filtre
   ajouté ne doit toucher ni aux pixels ni à la géométrie. */
has(layer, 'const g = objFigureGeom(obj, i);', 'la géométrie de la figure est inchangée');
has(layer, "const par = keepAspect ? 'xMidYMid meet'", 'l’ajustement de l’image est inchangé');
has(layer, 'if (g.crop) {', 'le chemin « figure recadrée » existe toujours');
has(layer, 'if (!src) return null;', 'une figure sans pixels n’est toujours pas dessinée');

/* ── 5. Le composant : les commandes d'ombre ─────────────────────────────── */
/* ── 4. DEUX OMBRES INDÉPENDANTES, CHACUNE AVEC SON BLOC DE CONTRÔLES ────────
   « fix the shadow: now only cast shadows on panels and not on objects as it
   claims » avait RETIRÉ la commande d'ombre par figure ; elle est revenue sur
   demande explicite — « allow to add a shadow (I am talking about the image and
   not about the panel of the object) ». Ce qui est vérifié ici, c'est la forme
   de ce retour :

     • l'ombre de la FIGURE vise la figure ACTIVE (celle des poignées, comme le
       recadrage et la gomme) : un bouton 🌓 sur la ligne des figures, et TOUS
       ses réglages dans « ▾ More options » — jamais une pastille 🌓 sur chaque
       ligne de la liste des figures, ni une commande « ombre de toutes les
       figures » ;
     • l'ombre du PANNEAU garde son bloc et son intitulé (« panel frame ») ;
     • le DESSIN est INCHANGÉ depuis le début (section 3 ci-dessus) : les deux
       ombres sont des filtres <feDropShadow> de la composition, donc elles
       sortent dans tous les exports. */
ok(!IB.includes('setFigureShadow(selectedObj.id, i, im.shadow'),
  'pas de pastille 🌓 sur chaque ligne de figure (la commande vise la figure active)');
ok(!IB.includes('const toggleFiguresShadow = () => {'), '…ni de commande groupée « ombre de toutes les figures »');
ok(!IB.includes('🌓 Figure shadow{'), '…ni de troisième bloc d’ombre ailleurs dans les propriétés');
ok(!IB.includes('Import a figure into this panel to give it its own shadow.'),
  '…ni de texte qui promettait une ombre par figure à l’ancienne');
has(IB, 'const toggleActiveFigureShadow = () => {',
  'l’ombre de la FIGURE se donne et s’enlève en un clic…');
has(IB, "patchFigure(selectedObj.id, cropPanelIdx, { shadow: shadowSpec(im.shadow) ? null : { ...DEFAULT_SHADOW } })",
  '…sur la figure ACTIVE (DEFAULT_SHADOW quand elle n’en a pas)');
has(IB, "onChange={(v) => patchFigure(selectedObj.id, cropPanelIdx, { shadow: v })}",
  'ses réglages fins s’écrivent DANS la figure, jamais dans le panneau');
has(IB, 'hint="The PICTURE casts its own drop shadow',
  '…et son texte dit que c’est l’IMAGE qui projette l’ombre (ses pixels, pas son rectangle)');
has(IB, "🌓 {figShadowOn ? 'Figure shadow ✓' : 'Figure shadow'}",
  'le bouton de la ligne des figures dit aussi si cette figure en a une');
has(IB, 'const figShadowOn = cropPanelIdx >= 0 && !!shadowSpec((selectedImgs[cropPanelIdx] || {}).shadow);',
  '…d’après l’ombre de la figure active, et d’elle seule');

has(IB, 'const moveObjInStack = (objId, to) => {', 'la fenêtre de l’objet empile toujours les panneaux');
has(IB, 'Shadow <span className="font-normal normal-case text-slate-400">(panel frame)</span>',
  'le bloc « Shadow » du panneau est explicitement étiqueté « panel frame »');
has(IB, 'hint="The whole PANEL casts this shadow — frame, figure, letter and texts — and every export keeps it." />',
  '…et il dit ce que l’ombre du panneau couvre, en UNE ligne (les longues descriptions mangeaient la fenêtre)');
ok(IB.indexOf('hint="The whole PANEL casts this shadow') < IB.indexOf('hint="The PICTURE casts its own drop shadow'),
  '…et les deux ombres se SUIVENT dans la même colonne du repli : plus rien ne s’intercale entre elles');
ok(!IB.includes('(a cut-out background gives the shadow of what the image shows, not of its rectangle)'),
  'plus le paragraphe qui allongeait l’ombre de la figure (son détail tient dans la même phrase)');
eq(count(IB, /<ShadowControls /g), 2,
  'DEUX blocs de contrôles partagent la MÊME primitive : le panneau et la figure (jamais un troisième)');
has(IB, '<feDropShadow dx={sp.dx} dy={sp.dy} stdDeviation={sp.blur} floodColor={sp.color} floodOpacity={sp.opacity} />',
  'les filtres d’ombre (panneau, flèche, figure) sont toujours définis de la même façon');

/* Les ombres de figure sont dans le SVG de composition : elles sortent donc
   dans les exports (le clone ne retire que l’outillage de sélection). */
has(IB, 'clone.querySelectorAll(\'[data-selection-ui="true"]\').forEach(el => el.remove());',
  'l’export ne retire que l’outillage marqué data-selection-ui');
eq(count(layer, /data-selection-ui/g), 0, 'la couche des figures ne porte aucun outillage : elle est TOUTE exportée');
has(IB, 'const images = getObjImagesOf(obj).map((im) => ({ ...im, imgSrc: im.imgThumb || im.imgSrc }));',
  'l’ombre d’une figure survit à la copie persistée / annulée (elle est dans l’image)');

console.log(`_builder_figshadow_test.mjs — ${passed} assertions OK`);
