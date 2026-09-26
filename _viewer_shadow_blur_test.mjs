/* =========================================================================
   _viewer_shadow_blur_test.mjs — LE FLOU D'UNE OMBRE EST UNE LARGEUR, PAS UN
   NOMBRE DE PIXELS DU MASQUE.

   Le rapport : « it didn't work? shadows are still spherical » — dit APRÈS le
   correctif qui rend aux chaînes latérales le trait du licorice (0,25 Å) au lieu
   de celui du tuyau (0,5 Å) qu'elles empruntaient sur la sélection partagée. Le
   correctif est juste et mesuré (dix points de proxy en moins)… et pourtant
   l'image ne change pas, parce que la RONDEUR ne vient pas du rayon :

     · le masque est PLAFONNÉ en largeur (`maskMaxWidth`, 1400 px) QUELLE QUE
       SOIT l'image — sur une toile large il couvre toute la toile à une fraction
       de sa résolution, et la molécule n'a plus que quelques pixels de masque par
       ångström ;
     · `softness` (1,6 px) et la pénombre PCSS (jusqu'à 8 px) sont comptés en
       PIXELS DU MASQUE : à 8,7 px/Å, c'est 9,6 px ≈ 1,1 Å de flou — aussi large
       que le bâton qu'il doit ombrer. Toute liaison, tout cycle, toute
       ramification s'effondre alors dans la MÊME BILLE RONDE, quel que soit le
       proxy : « spheric shadows for bonds ».

   LA RÉPARATION : le flou est rendu PHYSIQUE. Les valeurs par défaut sont lues à
   l'échelle où elles pèsent le demi-ångström qu'une pénombre « à la PyMOL »
   devrait faire (`SHADOW_BLUR_REF` = 20 px/Å : 1,6 px + 8 px ≈ 0,5 Å) et remises à
   l'échelle du masque de l'image (`maskScalePerAngstrom`, mesuré sur les coins de
   la boîte de la molécule), avec un plancher (`SHADOW_BLUR_MIN`) et JAMAIS plus
   de flou qu'avant. Une valeur POSÉE par l'appelant reste, elle, des pixels de
   masque — les tests de PCSS gardent leur sens.

   CE QUI EST VÉRIFIÉ ICI :

     1. LA RÈGLE, hors de tout rendu : l'échelle vaut 1 à la résolution réglée,
        ne monte jamais au-dessus, tombe avec la résolution, et un masque
        illisible (0, NaN) laisse le module exactement comme avant ;
     2. L'ÉCHELLE DU MASQUE, mesurée : le px par ångström lu sur une vraie
        caméra et la boîte de la molécule — elle double quand le masque double,
        et vaut 0 quand il n'y a rien à mesurer ;
     3. LE MASQUE, EXÉCUTÉ : sur une toile large (le cas du rapport) les défauts
        reçoivent un flou PLUS PETIT que les pixels réglés, et une valeur POSÉE
        reste intacte — le rayon de pénombre rendu le prouve ;
     4. LE DIAGNOSTIC : `proxyStrokeSummary` compte les traits — c'est lui qui
        répond « pourquoi mon ombre est-elle ronde ? » quand la réponse est
        « parce que ce dessin-là garde son rayon de vdW » ;
     5. LA SCÈNE DU VIEWER, sur la vraie structure ngl et les vraies
        StructureView : tube 0,5 Å + licorice 0,25 Å sur `protein` → AUCUN proxy
        au-dessus de 0,6 Å (plus une seule bille), alors qu'une représentation
        que la table ne connaît pas (`dot`) les FAIT APPARAÎTRE — le diagnostic
        dit donc vrai ;
     6. LA NOTE de la « ray » : elle ÉCRIT les rayons qu'elle a employés.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/* LE MODULE ÉPROUVÉ. SHADOW_MODULE permet de rejouer cette suite sur une version
   d'AVANT le correctif — elle doit alors ÊTRE ROUGE (même idiome que
   _viewer_shadow_backbone_test.mjs) :
     git show <avant>:src/utils/viewerRayShadows.js > avant.js
     SHADOW_MODULE=./avant.js node _viewer_shadow_blur_test.mjs
   Mesuré sur l'ancienne version : le point 3 tombe (aucun `blur` n'est rapporté
   et le masque garde ses 1,6 + 8 px de flou à 8,7 px/Å), et le point 6 aussi (la
   note ne dit pas les traits). */
const MODULE_PATH = process.env.SHADOW_MODULE || './src/utils/viewerRayShadows.js';
const SHADOWS = await import(MODULE_PATH);
const {
  RAY_SHADOW_DEFAULTS, SHADOW_BLUR_REF, SHADOW_BLUR_MIN, SHADOW_BLUR_STROKE_FRACTION, shadowBlurScale,
  maskScalePerAngstrom, proxyStrokeSummary, atomsFromStage, boundsOf, boundsBoxOf,
  shadowRigOf, mat4LookAt, mat4Multiply, buildRayShadowMask, rayShadowNote,
} = SHADOWS;

const MODULE = readFileSync(new URL(MODULE_PATH, import.meta.url), 'utf8');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, tol, what) => {
  assert.ok(Math.abs(a - b) <= tol, `${what}\n  attendu : ${b} ± ${tol}\n  obtenu  : ${a}`);
  passed += 1;
};

/* ── 1. LA RÈGLE, HORS DE TOUT RENDU ───────────────────────────────────────── */
eq(SHADOW_BLUR_REF, 20, 'l’échelle de référence : 20 px de masque par ångström, où 1,6 + 8 px pèsent le demi-ångström d’une pénombre « à la PyMOL »');
eq(SHADOW_BLUR_MIN, 0.25, 'le plancher : un masque minuscule garde un peu de douceur (jamais un flou éteint)');
eq(shadowBlurScale(SHADOW_BLUR_REF), 1, 'à la résolution réglée, le flou par défaut est EXACTEMENT celui d’avant');
eq(shadowBlurScale(40), 1, '…et un masque plus fin ne reçoit JAMAIS plus de flou qu’avant (l’échelle ne monte pas)');
eq(shadowBlurScale(10), 0.5, 'à 10 px/Å le flou est divisé par deux');
near(shadowBlurScale(8.7), 0.435, 1e-9, 'à 8,7 px/Å — une toile large : 4800 px d’image plafonnés à 1400 de masque — le flou vaut 0,435');
eq(shadowBlurScale(0.5), SHADOW_BLUR_MIN, 'en dessous du plancher l’échelle s’arrête (jamais 0 : une ombre reste douce)');
eq(shadowBlurScale(0), 1, 'sans échelle mesurable (0), le module reste celui d’avant');
eq(shadowBlurScale(Number.NaN), 1, '…idem NaN');
eq(shadowBlurScale(undefined), 1, '…et une échelle absente (un appelant qui ne la donne pas) aussi');
eq(shadowBlurScale(-3), 1, '…et une échelle négative ne retourne pas la question');
/* LE CALCUL DU RAPPORT, posé noir sur blanc : le flou réglé, à l'échelle du
   rapport, vaut un ångström — le bâton qu'il doit ombrer. */
const TUNED_PX = RAY_SHADOW_DEFAULTS.softness + RAY_SHADOW_DEFAULTS.penumbraMax;
near(TUNED_PX / 8.7, 1.1, 0.05,
  `le flou du rapport : (${RAY_SHADOW_DEFAULTS.softness} + ${RAY_SHADOW_DEFAULTS.penumbraMax}) px à 8,7 px/Å ≈ 1,1 Å, soit le bâton lui-même`);
near((shadowBlurScale(8.7) * TUNED_PX) / 8.7, 0.48, 0.05,
  '…et le flou rendu physique sur la même toile : ~0,5 Å, sous l’épaisseur d’une liaison');
eq(RAY_SHADOW_DEFAULTS.maskMaxWidth, 1400,
  'la cause est le PLAFOND du masque : 1400 px quelle que soit la largeur de l’image');

/* ── 2. L'ÉCHELLE DU MASQUE, MESURÉE SUR UNE VRAIE CAMÉRA ──────────────────── */
const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/* Une hélice de 40 Cα : le banc du module (mêmes coordonnées que
   _viewer_ray_shadows_test.mjs), pour que l'échelle mesurée soit comparable. */
const helix = (n = 40) => {
  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const t = (i * 100 * Math.PI) / 180;
    position[i * 3] = 2.3 * Math.cos(t);
    position[i * 3 + 1] = i * 1.5 - n * 0.75;
    position[i * 3 + 2] = 2.3 * Math.sin(t);
  }
  return position;
};
const cameraOf = ({ positions, count, width, height, zoom = 1 }) => {
  const scene = boundsOf(positions, count);
  const aspect = width / height;
  const dist = (scene.radius * 1.35 * zoom) / Math.tan((40 * Math.PI) / 360);
  const view = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
  /* Un vrai champ de 40° : `top` est la demi-hauteur du plan image à l'unité, et
     la distance a été calculée POUR ce champ (`radius × 1.35 / tan(20°)`) — le
     banc du module divise par 10 sans changer la distance, ce qui rend ses
     valeurs d'échelle inutilisables ici. */
  const top = Math.tan((40 * Math.PI) / 360);
  const proj = [
    1 / (aspect * top), 0, 0, 0,
    0, 1 / top, 0, 0,
    0, 0, -((dist * 4) + 0.1) / ((dist * 4) - 0.1), -1,
    0, 0, (-2 * (dist * 4) * 0.1) / ((dist * 4) - 0.1), 0,
  ];
  return { view, clip: mat4Multiply(proj, view), scene };
};
const HELIX = helix();
const HELIX_BOX = boundsBoxOf(HELIX, HELIX.length / 3);
const cam600 = cameraOf({ positions: HELIX, count: HELIX.length / 3, width: 600, height: 316 });
const scale600 = maskScalePerAngstrom({ ...cam600, bounds: HELIX_BOX, width: 600, height: 316 });
const scale1200 = maskScalePerAngstrom({ ...cam600, bounds: HELIX_BOX, width: 1200, height: 632 });
ok(scale600 > 0, `l’échelle du masque se mesure (${scale600.toFixed(2)} px/Å sur la scène du banc)`);
near(scale600, 316 / (2 * cam600.scene.radius * 1.35), 0.35,
  '…et c’est bien la résolution de la scène : la hauteur du masque sur celle du cadre en ångström');
near(scale1200 / scale600, 2, 0.02, '…et elle DOUBLE quand le masque double : c’est bien une résolution, pas une constante');
near(shadowBlurScale(scale600), Math.min(1, Math.max(SHADOW_BLUR_MIN, scale600 / SHADOW_BLUR_REF)), 1e-9,
  '…et l’échelle de flou qui en découle est celle de la règle (jamais plus de flou qu’avant)');
eq(maskScalePerAngstrom({}), 0, 'sans caméra, rien à mesurer : 0 (l’appelant garde alors les pixels réglés)');
eq(maskScalePerAngstrom({ clip: cam600.clip, bounds: HELIX_BOX, width: 600, height: 316 }), 0,
  '…et sans la vue (une caméra incomplète) non plus');
const beyond = { min: [1.2e3, 1.2e3, 1e6], max: [1.201e3, 1.201e3, 1.0001e6] };
const farScale = maskScalePerAngstrom({ ...cam600, bounds: beyond, width: 600, height: 316 });
ok(farScale <= scale600,
  'une boîte hors champ ne donne jamais une échelle PLUS GRANDE que celle de la molécule : le flou ne peut que diminuer');
eq(shadowBlurScale(farScale), SHADOW_BLUR_MIN,
  '…et le plancher garde l’ombre douce même sur une échelle absurde (le seul écart possible est un flou plus PETIT)');
ok(MODULE.includes('export const shadowBlurScale = (pxPerAngstrom, minStrokeRadius) => {'),
  'la règle est exportée, donc lisible et testable — avec, en second, le trait le plus fin RÉELLEMENT tiré');
ok(MODULE.includes('export const SHADOW_BLUR_REF = 20;'),
  '…avec l’échelle où les valeurs par défaut ont été réglées');
ok(MODULE.includes('export const maskScalePerAngstrom = ({ clip, view, bounds, width, height } = {}) => {'),
  '…et la mesure du masque, qui la nourrit');
ok(MODULE.includes('export const proxyStrokeSummary = (radii, count, max = 4) => {'),
  '…le diagnostic des traits, exporté lui aussi');

/* LE SECOND PLAFOND, TIRÉ DU DESSIN. Le « demi-ångström » de SHADOW_BLUR_REF est
   un demi-TUYAU (2 × 0,5 Å)… mais un licorice ENTIER (2 × 0,25 Å) : sur une scène
   qui n'a QUE du licorice, ce flou-là avale le trait qu'il doit ombrer, et toutes
   les ramifications s'effondrent dans la même bille. Le module lit donc le trait
   le plus fin RÉELLEMENT dessiné (`atoms.radii`, voir minStrokeRadiusOf) et borne
   la pénombre combinée à SHADOW_BLUR_STROKE_FRACTION de ce trait — en ne faisant
   jamais que RÉDUIRE le flou d'avant. */
eq(SHADOW_BLUR_STROKE_FRACTION, 0.6,
  'la pénombre combinée ne dépasse jamais 0,6 fois le trait le plus fin que le dessin tire');
const REF_PX = RAY_SHADOW_DEFAULTS.softness + RAY_SHADOW_DEFAULTS.penumbraMax;   // 9,6 px
ok(shadowBlurScale(8, 0.25) < shadowBlurScale(8, 0.5),
  `à la même résolution, un licorice (0,25 Å) reçoit MOINS de flou qu’un tuyau (0,5 Å) : ×${shadowBlurScale(8, 0.25).toFixed(3)} contre ×${shadowBlurScale(8, 0.5).toFixed(3)}`);
near(shadowBlurScale(8, 0.25) / shadowBlurScale(8, 0.5), 0.5, 1e-9,
  '…exactement la moitié, sous le plafond : le flou suit le trait, proportionnellement');
eq(shadowBlurScale(8, 0), shadowBlurScale(8),
  'un trait illisible (0 Å) laisse la règle d’avant — jamais un flou éteint');
eq(shadowBlurScale(8, Number.NaN), shadowBlurScale(8), '…idem NaN');
eq(shadowBlurScale(8, 5), shadowBlurScale(8),
  'un trait ÉPAIS ne donne jamais plus de flou qu’avant : le plafond ne fait que réduire');
near(shadowBlurScale(SHADOW_BLUR_REF, 0.25), (0.25 * SHADOW_BLUR_STROKE_FRACTION * SHADOW_BLUR_REF) / REF_PX, 1e-9,
  '…et à la résolution de référence, un licorice seul est ramené à ×0,31 : la cible « demi-ångström » valait pour le tuyau');
ok(MODULE.includes('const minStrokeRadiusOf = (atoms) => {') && MODULE.includes('if (v > 0 && v < min) min = v;'),
  '…le trait le plus fin est lu dans les rayons du proxy (un rayon nul ou absent ne compte pas)');


/* ── 3. LE MASQUE, EXÉCUTÉ : LES DÉFAUTS S'ACCOMMODENT À LA RÉSOLUTION ───────
   Une toile LARGE (4800 px : le cas du rapport) et le banc de la section 2 — un
   tube de 0,5 Å le long des 40 Cα. Les deux ombres comparées sont la même scène :
   les défauts (mis à l'échelle par la réparation) contre les pixels réglés,
   POSÉS par l'appelant comme le faisaient les tests d'avant. */
const stageOf = (positions, rep) => {
  const n = positions.length / 3;
  const radius = new Float32Array(n).fill(1.7);
  return {
    compList: [{
      structure: { atomCount: n, getAtomData: () => ({ position: positions, radius }) },
      matrix: { elements: IDENT16 },
      reprList: [{
        name: rep.type, getType: () => rep.type, type: 'representation', parameters: { visible: true },
        repr: {
          ...rep, visible: true,
          structureView: { getAtomIndices: () => Uint32Array.from({ length: n }, (_, i) => i) },
        },
      }],
    }],
  };
};
const TUBE_REP = { type: 'tube', radiusType: 'size', radiusSize: 0.5, radiusScale: 2 };
const helixAtoms = atomsFromStage(stageOf(HELIX, TUBE_REP), 100000);
const helixBounds = boundsBoxOf(helixAtoms.positions, helixAtoms.count);
const helixScene = boundsOf(helixAtoms.positions, helixAtoms.count);
const LAMP = [Math.cos(0.26) * Math.cos(2.09), Math.cos(0.26) * Math.sin(2.09), Math.sin(0.26)];
const lightOf = () => ({
  dir: LAMP, center: helixScene.center, radius: helixScene.radius,
  distance: helixScene.radius * 100, bounds: helixBounds,
  ...shadowRigOf({
    dir: LAMP, bounds: helixBounds, center: helixScene.center,
    radius: helixScene.radius, distance: helixScene.radius * 100,
  }),
});
const WIDE = { width: 4800, height: 1200 };
const wideCam = cameraOf({ positions: HELIX, count: HELIX.length / 3, ...WIDE });
const wideShadow = buildRayShadowMask({ atoms: helixAtoms, camera: wideCam, light: lightOf(), ...WIDE });
const pinnedShadow = buildRayShadowMask({
  atoms: helixAtoms, camera: wideCam, light: lightOf(), ...WIDE,
  options: {
    softness: RAY_SHADOW_DEFAULTS.softness,
    penumbra: RAY_SHADOW_DEFAULTS.penumbra,
    penumbraMax: RAY_SHADOW_DEFAULTS.penumbraMax,
  },
});
ok(wideShadow.blur.pxPerAngstrom > 0 && wideShadow.blur.pxPerAngstrom < SHADOW_BLUR_REF,
  `la toile large ne donne que ${wideShadow.blur.pxPerAngstrom.toFixed(2)} px de masque par ångström`);
ok(wideShadow.blur.scale < 1, `…donc son flou est mis à l’échelle (×${wideShadow.blur.scale.toFixed(3)} → ${wideShadow.blur.softness.toFixed(2)} px de douceur au lieu de ${RAY_SHADOW_DEFAULTS.softness})`);
near(wideShadow.blur.softness, RAY_SHADOW_DEFAULTS.softness * wideShadow.blur.scale, 1e-9,
  '…la douceur par défaut est bien celle qui est réduite (1,6 px × l’échelle)');
near(wideShadow.blur.penumbraMax, RAY_SHADOW_DEFAULTS.penumbraMax * wideShadow.blur.scale, 1e-9,
  '…et le plafond de la pénombre PCSS avec elle (8 px × l’échelle)');
/* …ET LE MASQUE A BIEN LU LE TRAIT DE SA SCÈNE : l'échelle rapportée est celle de
   la règle nourrie du plus fin rayon tiré — aucune constante devinée à sa place. */
const minRadiusOf = (radii, count) => {
  const n = Math.max(0, Math.min(Number(count) || 0, radii ? radii.length : 0));
  let min = Infinity;
  for (let i = 0; i < n; i += 1) if (radii[i] > 0 && radii[i] < min) min = radii[i];
  return Number.isFinite(min) ? min : 0;
};
const thinnest = minRadiusOf(helixAtoms.radii, helixAtoms.count);
near(wideShadow.blur.scale, shadowBlurScale(wideShadow.blur.pxPerAngstrom, thinnest), 1e-9,
  `le masque EXÉCUTÉ a lu le trait le plus fin de sa scène (${thinnest} Å) : l’échelle est celle de la règle, pas une constante`);
eq(wideShadow.penumbra.radius, wideShadow.blur.softness,
  'le rayon de pénombre RENDU est celui du flou réduit — le masque dit ce qu’il a vraiment reçu');
ok(wideShadow.penumbra.reached <= pinnedShadow.penumbra.reached,
  `…et le disque de la scène large (${wideShadow.penumbra.reached.toFixed(2)} px) est PLUS ÉTROIT que les pixels réglés (${pinnedShadow.penumbra.reached.toFixed(2)} px) : c’est le dé-floutage`);
eq(pinnedShadow.blur.scale, wideShadow.blur.scale,
  'une valeur POSÉE est rapportée avec la même échelle : le diagnostic reste honnête');
eq(pinnedShadow.blur.softness, RAY_SHADOW_DEFAULTS.softness,
  '…mais elle reste VERBATIM ce que l’appelant a donné : l’API en pixels du masque survit');
eq(pinnedShadow.penumbra.radius, RAY_SHADOW_DEFAULTS.softness,
  '…jusqu’au rayon rendu, qui ne bouge pas d’un pixel');
ok(MODULE.includes('const blurOf = (name, value) => (options && options[name] !== undefined ? value : value * blurScale);'),
  '…parce que la règle du module est écrite là : DÉFAUTS mis à l’échelle, valeurs posées intactes');
/* Une molécule PETITE, cadrée sur elle (la caméra d'un ligand : le viewer
   l'auto-cadre) : le masque a bien plus de pixels par ångström sur elle, donc son
   flou n'est presque plus réduit — l'échelle suit la résolution. */
const smallPositions = HELIX.slice(0, 8 * 3);
const smallAtoms = atomsFromStage(stageOf(smallPositions, TUBE_REP), 100000);
const smallCam = cameraOf({ positions: smallPositions, count: 8, ...WIDE });
const smallShadow = buildRayShadowMask({
  atoms: smallAtoms, camera: smallCam, light: lightOf(), ...WIDE,
});
ok(smallShadow.blur.pxPerAngstrom > wideShadow.blur.pxPerAngstrom,
  `une molécule plus petite reçoit un masque plus fin (${smallShadow.blur.pxPerAngstrom.toFixed(2)} contre ${wideShadow.blur.pxPerAngstrom.toFixed(2)} px/Å)`);
ok(smallShadow.blur.scale > wideShadow.blur.scale,
  '…et donc un flou moins réduit : l’échelle suit la résolution, elle ne la remplace pas');
ok(smallShadow.blur.scale <= 1, '…sans jamais dépasser 1 : aucune ombre ne reçoit plus de flou qu’avant');



/* ── 4. LE DIAGNOSTIC : LES TRAITS DU PROXY, COMPTÉS ────────────────────────── */
eq(proxyStrokeSummary(Float32Array.from([0.25, 0.25, 0.5]), 3),
  { list: [{ radius: 0.25, hits: 2 }, { radius: 0.5, hits: 1 }], rest: 0, count: 3 },
  'les traits sont comptés par rayon, du plus fréquent au moins fréquent');
eq(proxyStrokeSummary([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], 7, 3),
  { list: [{ radius: 0.1, hits: 1 }, { radius: 0.2, hits: 1 }, { radius: 0.3, hits: 1 }], rest: 4, count: 7 },
  'la liste est plafonnée (la note doit tenir sur une ligne) et le reste est COMPTÉ, jamais perdu');
eq(proxyStrokeSummary([0.5, Number.NaN, 0], 3),
  { list: [{ radius: 0.5, hits: 1 }], rest: 0, count: 3 },
  'un rayon absent (NaN) ou nul n’entre dans aucun trait');
eq(proxyStrokeSummary([0.5], 99),
  { list: [{ radius: 0.5, hits: 1 }], rest: 0, count: 1 },
  'un compte plus grand que le tableau est borné (jamais de lecture hors du proxy)');
eq(proxyStrokeSummary(null, 5), { list: [], rest: 0, count: 0 },
  'sans rayons du tout, la liste est vide — et le compte nul');
eq(proxyStrokeSummary([0.251, 0.249], 2),
  { list: [{ radius: 0.25, hits: 2 }], rest: 0, count: 2 },
  'deux rayons séparés d’un centième sont le même trait (le bruit du lerp des remplissages)');
eq(proxyStrokeSummary(Float32Array.from([1.7, 1.7, 1.7]), 3).list[0],
  { radius: 1.7, hits: 3 },
  'un proxy de billes de vdW se lit « 1,70 Å × 3 » : c’est la réponse à « pourquoi rond ? »');
ok(MODULE.includes('strokes: proxyStrokeSummary(atoms && atoms.radii, atoms && atoms.count),'),
  '…et le masque CONSTITUE cette liste à chaque construction (le message en hérite)');

/* ── 5. LA SCÈNE DU VIEWER, SUR LA VRAIE BIBLIOTHÈQUE ────────────────────────
   Un peptide réel (ALA · ILE, chaînes latérales comprises) et les VRAIES
   StructureView de ngl 2.4 : `structure.getView(Selection(...))`, exactement
   l'objet qu'une représentation reçoit de son composant — celui dont le module
   lit `getAtomIndices()`. Le tuyau du squelette et le licorice des chaînes
   latérales ne partagent donc pas la même sélection ici (c'est la disposition du
   viewer : la rangée « Backbone » et la rangée « Side chains »), mais le fait
   qui a rendu ce diagnostic nécessaire est le même : NGL rend à une
   représentation la liste ENTIÈRE de sa sélection. */
const require = createRequire(import.meta.url);
const NGL = require('ngl');   // le paquet installé : 2.4.0, exactement celui de la page
// NGL lit un Blob à travers FileReader : le navigateur l'a, node non.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};
const BENCH_ATOMS = [
  ['ATOM', 1, 'N', 'ALA', 0.0, 0.0, 0.0],
  ['ATOM', 1, 'CA', 'ALA', 1.46, 0.0, 0.0],
  ['ATOM', 1, 'C', 'ALA', 2.0, 1.4, 0.0],
  ['ATOM', 1, 'O', 'ALA', 1.6, 2.5, 0.0],
  ['ATOM', 1, 'CB', 'ALA', 2.0, -1.4, 0.6],
  ['ATOM', 2, 'N', 'ILE', 3.3, 1.5, 0.0],
  ['ATOM', 2, 'CA', 'ILE', 4.0, 0.1, 0.4],
  ['ATOM', 2, 'C', 'ILE', 5.4, 0.6, 0.4],
  ['ATOM', 2, 'O', 'ILE', 5.9, 1.7, 0.5],
  ['ATOM', 2, 'CB', 'ILE', 4.3, -1.2, -0.5],
  ['ATOM', 2, 'CG1', 'ILE', 3.5, -2.3, -0.9],
  ['ATOM', 2, 'CG2', 'ILE', 5.4, -1.6, -1.4],
  ['HETATM', 1, 'C1', 'LIG', 12.0, 0.0, 0.0],
  ['HETATM', 1, 'O1', 'LIG', 13.2, 0.0, 0.0],
];
const BENCH_LINE = (i, [kind, resno, name, resname, x, y, z]) =>
  `${kind.padEnd(6)}${String(i).padStart(5)} ${name.padEnd(4)} ${resname} A${String(resno).padStart(4)}`
  + `    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${name[0]}`;
const structure = await NGL.autoLoad(
  new Blob([`${BENCH_ATOMS.map((r, i) => BENCH_LINE(i + 1, r)).join('\n')}\nEND\n`], { type: 'text/plain' }),
  { ext: 'pdb' },
);
const bench = (reprList) => ({
  compList: [{ structure, matrix: { elements: IDENT16 }, reprList }],
});
const element = (type, rep) => ({ name: type, getType: () => type, type: 'representation', repr: rep, parameters: {} });
const viewOf = (sele) => structure.getView(new NGL.Selection(sele));
eq(typeof viewOf('sidechain').getAtomIndices, 'function',
  'la StructureView du paquet INSTALLÉ expose `getAtomIndices` : le module lit bien ce qu’il croit lire');

const appReps = [
  element('tube', {
    type: 'tube', visible: true, radiusType: 'size', radiusSize: 0.5, radiusScale: 2,
    structureView: viewOf('protein'),
  }),
  element('licorice', {
    type: 'licorice', visible: true, radiusType: 'size', radiusSize: 0.25, radiusScale: 1,
    structureView: viewOf('sidechain'),
  }),
];
const appAtoms = atomsFromStage(bench(appReps), 100000);
const appSummary = proxyStrokeSummary(appAtoms.radii, appAtoms.count, 64);
const appRadii = appSummary.list.map((e) => e.radius);
ok(appRadii.includes(0.5), `le squelette porte le trait du TUYAU (0,50 Å) : ${appRadii.join(' · ')}`);
ok(appRadii.includes(0.25), '…les chaînes latérales celui du LICORICE (0,25 Å)');
ok(appRadii.every((r) => r < 0.6),
  '…et AUCUN proxy au-dessus de 0,6 Å : la scène du viewer ne contient plus une seule bille de vdW');


/* Le MÊME peptide, dessiné par une représentation que la table ne connaît pas
   (`dot` — le style léger du viewer) : les atomes sont DESSINÉS, donc émis, mais
   aucun trait ne leur est reconnu — ils gardent leur rayon de vdW. C'est
   exactement la forme des « spheric shadows », et le diagnostic doit le DIRE. */
const dotAtoms = atomsFromStage(bench([element('dot', {
  type: 'dot', visible: true, radiusScale: 1, structureView: viewOf('protein'),
})]), 100000);
const dotSummary = proxyStrokeSummary(dotAtoms.radii, dotAtoms.count, 64);
const dotMax = Math.max(...dotSummary.list.map((e) => e.radius));
ok(dotMax > 0.6,
  `une représentation inconnue rend les atomes à leur rayon de vdW (${dotMax.toFixed(2)} Å) — et c’est ÉCRIT dans la note, plus jamais deviné`);

/* ── 6. LA NOTE DE LA « RAY » DIT LES TRAITS ───────────────────────────────── */
const noteOf = (strokes) => rayShadowNote({
  mask: Float32Array.from([1]), strength: 0.55, spheres: 468, filled: 392,
  imageWidth: 4800, imageHeight: 1200, reachedPixels: 1200, strokes,
});
const twoStrokes = noteOf(proxyStrokeSummary(Float32Array.from([0.25, 0.25, 0.5]), 3));
ok(twoStrokes.includes('strokes 0.25 Å×2 · 0.50 Å×1'),
  `la note écrit les rayons employés : « ${twoStrokes} »`);
ok(noteOf(proxyStrokeSummary(Float32Array.from([0.25, 0.5, 0.5, 0.5, 1.7]), 5)).includes('1.70 Å×1'),
  '…et une bille de vdW y apparaît noir sur blanc : c’est le diagnostic qui manquait au rapport');
ok(noteOf(proxyStrokeSummary(Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), 6, 2)).includes('+4'),
  '…avec le reste COMPTÉ quand la liste est plafonnée (jamais un trait muet)');
ok(!noteOf(null).includes(' Å×'),
  'sans liste de traits, aucune mention (« Å× » n’apparaît que si les rayons sont comptés) : la note d’avant reste la note d’avant');
const appBounds = boundsBoxOf(appAtoms.positions, appAtoms.count);
const appScene = boundsOf(appAtoms.positions, appAtoms.count);
const appCam = cameraOf({ positions: appAtoms.positions, count: appAtoms.count, width: 1786, height: 400 });
const appShadow = buildRayShadowMask({
  atoms: appAtoms,
  camera: appCam,
  light: {
    dir: LAMP, center: appScene.center, radius: appScene.radius,
    distance: appScene.radius * 100, bounds: appBounds,
    ...shadowRigOf({
      dir: LAMP, bounds: appBounds, center: appScene.center,
      radius: appScene.radius, distance: appScene.radius * 100,
    }),
  },
  width: 1786, height: 400,
});
const appNote = rayShadowNote({
  ...appShadow, strength: 0.55, imageWidth: 1786, imageHeight: 400, reachedPixels: 5000,
});
ok(appNote.includes('0.25 Å×') && appNote.includes('0.50 Å×'),
  `la note de la scène du viewer nomme ses DEUX traits : « ${appNote} »`);
ok(!/1\.\d\d Å×/.test(appNote),
  '…et n’annonce aucune bille : sur cette scène-là, les ombres rondes ne peuvent PAS venir du rayon');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_viewer_shadow_blur_test.mjs — ${passed} assertions OK (le flou est une largeur, pas un compte de pixels)`);
