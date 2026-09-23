/* =========================================================================
   _viewer_light_rig_test.mjs — le RIG DE LUMIÈRE du viewer 3D.

   La lumière ACTUELLE est la référence (« parfaite, ne pas la perdre ») :
   blanche (key et ambiante), key 1.15 / ambiante 0.34 hors ombres, key
   1.3 + 0.7·dark / ambiante max(0.12, 0.34 − 0.22·dark) avec les ombres,
   direction azimut/élévation, lampe à 100× la boîte englobante, sampleLevel 2
   pendant les ombres. Ce garde-fou vérifie deux choses :

     1. elle a été EXTRAITE sans bouger d'un iota dans src/utils/viewerLightRig.js
        (et le viewer ne la réécrit plus en clair, il la consomme) ;
     2. sa TRADUCTION vers Mol* (Molstar) — le moteur qui sait dessiner les
        ombres portées et l'ambient occlusion — est EXACTE : le vecteur NGL est
        reconverti en (inclination, azimuth) et la direction obtenue est
        recalculée avec la FONCTION DE MOL* ELLE-MÊME
        (Vec3.directionFromSpherical, molstar/lib/commonjs) ; la config est
        ensuite passée au VRAI schéma de paramètres de Mol* (PD.merge sur
        RendererParams / PostprocessingParams / Canvas3DParams) — une clé
        inventée ou mal placée y serait silencieusement ignorée, donc les
        assertions comparent les valeurs APRÈS fusion, jamais avant.

   Le viewer est un .jsx : il ne s'importe pas sous Node, ses réglages sont donc
   vérifiés SUR LA SOURCE (comme dans _pymol_selections_test.mjs). Le module de
   lumière, lui, est du JS pur et s'exécute vraiment.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
  LIGHT_RIG, MOLSTAR_HEADLIGHT, MOLSTAR_MULTISAMPLE_INTERACTIVE, MOLSTAR_MULTISAMPLE_STILL,
  MOLSTAR_OCCLUSION_PARAMS, MOLSTAR_SHADOW_PRESETS,
  ambientIntensity, clampDarkness, hexToInt, keyLightIntensity, molstarCanvasProps,
  molstarHeadlightFromCamera, molstarMultiSampleProps, molstarPostprocessingProps,
  molstarRendererProps, molstarSphericalFromDirection, nglKeyLightDirection, nglLightParams,
  sampleLevel,
} from './src/utils/viewerLightRig.js';

// Les modules de Mol* eux-mêmes (build commonjs, exécutable sous Node) : c'est
// eux qui valident, pas une copie de leur schéma.
const require = createRequire(import.meta.url);
const { ParamDefinition: PD } = require('molstar/lib/commonjs/mol-util/param-definition.js');
const { RendererParams } = require('molstar/lib/commonjs/mol-gl/renderer.js');
const { PostprocessingParams } = require('molstar/lib/commonjs/mol-canvas3d/passes/postprocessing.js');
const { Canvas3DParams } = require('molstar/lib/commonjs/mol-canvas3d/canvas3d.js');
const { Vec3 } = require('molstar/lib/commonjs/mol-math/linear-algebra/3d/vec3.js');

let passed = 0;
const ok = (c, what) => { assert.ok(c, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-12) => {
  assert.ok(Math.abs(a - b) <= eps, `${what} — attendu ${b} ± ${eps}, obtenu ${a}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Le module de lumière en source, lui aussi : une TRADUCTION fausse (« même nom,
// même sens ») est un bug qui ne se voit pas à l’exécution — seule sa source la
// montre, donc elle est vérifiée comme le reste.
const RIG = readFileSync(new URL('./src/utils/viewerLightRig.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── 1. Le rig lui-même : les nombres de la référence ────────────────────── */
eq(LIGHT_RIG.keyColor, 0xffffff, 'la key light est BLANCHE (aucune couleur ajoutée)');
eq(LIGHT_RIG.ambientColor, 0xffffff, 'l’ambiante est BLANCHE');
eq(LIGHT_RIG.off, { lightIntensity: 1.15, ambientIntensity: 0.34, sampleLevel: 0 },
  'sans ombres : key 1.15 / ambiante 0.34 / sampleLevel 0 (les valeurs du viewer)');
eq(LIGHT_RIG.on.lightIntensity, 1.3, 'avec ombres : la key part de 1.3');
eq(LIGHT_RIG.on.lightIntensitySpread, 0.7, '…et va jusqu’à 2.0 (1.3 + 0.7)');
eq(LIGHT_RIG.on.ambientIntensity, 0.34, '…l’ambiante part de 0.34');
eq(LIGHT_RIG.on.ambientIntensityDrop, 0.22, '…et descend de 0.22');
eq(LIGHT_RIG.on.ambientIntensityFloor, 0.12, '…avec un plancher à 0.12 (jamais tout noir)');
eq(LIGHT_RIG.on.sampleLevel, 2, '…et un sur-échantillonnage de 2 pendant la session d’ombres');
eq(LIGHT_RIG.lampDistanceInBoundingBoxes, 100, 'la lampe est parquée à 100× la boîte englobante');

/* ── 2. Le payload NGL est IDENTIQUE à celui écrit en clair avant ─────────── */
// Les deux expressions ci-dessous sont MOT POUR MOT celles qui étaient inline
// dans applyShadowSettings() : si l'extraction avait dérivé, elles diffèrent.
eq(nglLightParams(), {
  lightColor: 0xffffff,
  ambientColor: 0xffffff,
  lightIntensity: 1.15,
  ambientIntensity: 0.34,
  sampleLevel: 0,
}, 'hors ombres : exactement l’ancien stage.setParameters (blanc, 1.15, 0.34, 0)');
for (const dark of [0, 0.25, 0.5, 0.75, 1]) {
  eq(nglLightParams({ shadowOn: true, darkness: dark }), {
    lightColor: 0xffffff,
    ambientColor: 0xffffff,
    lightIntensity: 1.3 + dark * 0.7,
    ambientIntensity: Math.max(0.12, 0.34 - dark * 0.22),
    sampleLevel: 2,
  }, `avec ombres, darkness ${dark} : la même formule qu’avant, au chiffre près`);
}

/* ── 3. La direction : le vecteur d'avant, au bit près ───────────────────── */
// L'ancien calcul inline, recopié ici pour comparer.
const oldDirection = (az, el) => {
  const azRad = ((Number(az) || 0) * Math.PI) / 180;
  const elRad = ((Number(el) || 0) * Math.PI) / 180;
  const ce = Math.cos(elRad);
  const ux = ce * Math.sin(azRad);
  const uy = Math.sin(elRad);
  const uz = -ce * Math.cos(azRad);
  const inv = 1 / Math.sqrt(ux * ux + uy * uy + uz * uz + 1e-12);
  return { x: ux * inv, y: uy * inv, z: uz * inv };
};
for (const az of [-90, 0, 45, 90, 180, 270, 360]) {
  for (const el of [-90, -45, 0, 30, 90]) {
    const u = nglKeyLightDirection(az, el);
    const o = oldDirection(az, el);
    near(u.x, o.x, `vecteur clé az=${az} el=${el} (x)`, 1e-15);
    near(u.y, o.y, `vecteur clé az=${az} el=${el} (y)`, 1e-15);
    near(u.z, o.z, `vecteur clé az=${az} el=${el} (z)`, 1e-15);
    near(Math.hypot(u.x, u.y, u.z), 1, `vecteur clé az=${az} el=${el} unitaire`, 1e-12);
  }
}
const behind = nglKeyLightDirection(0, 0);
near(behind.z, -1, 'az=0 el=0 : la lampe est DERRIÈRE la caméra (z négatif, NGL regarde +z)');

/* ── 4. Le viewer CONSOMME le rig (il ne réécrit plus les nombres) ───────── */
has("import { LIGHT_RIG, nglKeyLightDirection, nglLightParams } from '../utils/viewerLightRig';",
  'le viewer importe le rig');
has('stage.setParameters(nglLightParams({ shadowOn: on, darkness: dark }));',
  'applyShadowSettings applique le payload du rig (les deux branches n’en font plus qu’une)');
has('const { x, y, z } = nglKeyLightDirection(d0.az, d0.el);',
  'installShadowLightRig oriente la lampe avec le rig');
has('* LIGHT_RIG.lampDistanceInBoundingBoxes;',
  '…et parque la lampe à la distance du rig (100× la boîte englobante)');
has('light.position.set(x * d, y * d, z * d);', '…en replaçant la lumière à ce vecteur exact');
gone('const AO_SAMPLE_LEVEL = 2;', 'la constante locale AO_SAMPLE_LEVEL a disparu (elle vit dans le rig)');
gone('lightIntensity: 1.3 + dark * 0.7,', 'les intensités ne sont plus écrites en clair dans le viewer');
gone('lightIntensity: 1.15,', '…y compris celles du mode sans ombres');
gone('ambientIntensity: Math.max(0.12, 0.34 - dark * 0.22),', '…ni la formule de l’ambiante');
has('LIGHT_RIG.on.sampleLevel', 'le commentaire du viewer renvoie au sampleLevel du rig');

/* ── 5. La traduction en (inclination, azimuth) est EXACTE ───────────────── */
// Mol* place ses lampes en coordonnées sphériques ; on repasse par SA formule
// et on doit retrouver le vecteur NGL — c'est la preuve que la direction, la
// position et l'orientation de la lumière sont conservées.
const molstarDirection = (inclination, azimuth) => {
  const out = Vec3();
  Vec3.directionFromSpherical(out, (inclination * Math.PI) / 180, (azimuth * Math.PI) / 180, 1);
  return Array.from(out);
};
for (const az of [-90, 0, 45, 90, 180, 270]) {
  for (const el of [-90, -45, 0, 30, 60, 90]) {
    const u = nglKeyLightDirection(az, el);
    const sph = molstarSphericalFromDirection(u);
    const back = molstarDirection(sph.inclination, sph.azimuth);
    const dev = Math.max(...[0, 1, 2].map((i) => Math.abs(back[i] - [u.x, u.y, u.z][i])));
    ok(dev < 1e-12, `la direction NGL az=${az} el=${el} survit au passage Mol* (écart ${dev})`);
    ok(sph.inclination >= 0 && sph.inclination <= 180, `inclination az=${az} el=${el} dans 0…180`);
    ok(sph.azimuth >= 0 && sph.azimuth < 360, `azimuth az=${az} el=${el} dans 0…360`);
  }
}
eq(MOLSTAR_HEADLIGHT, { inclination: 180, azimuth: 0 },
  'hors ombres : la lampe liée à la caméra NGL (0,0,-1) devient 180° / 0° chez Mol*');
eq(molstarHeadlightFromCamera({ x: 0, y: 0, z: -80 }), { inclination: 180, azimuth: 0 },
  '…et la caméra par défaut de NGL redonne le même calcul');
const fromCamera = molstarHeadlightFromCamera({ x: 40, y: 0, z: 0 });
eq(fromCamera, { inclination: 90, azimuth: 0 }, 'la caméra sur +x donne une lampe à 90° d’inclination');
eq(molstarSphericalFromDirection({ x: 0, y: 0, z: 1 }), { inclination: 0, azimuth: 0 },
  'la caméra sur +z place la lampe dans l’axe (inclination 0)');

near(keyLightIntensity(true, 0), 1.3, 'contraste minimal : la key est à 1.3');
near(keyLightIntensity(true, 1), 2.0, 'contraste maximal : la key monte à 2.0');
near(ambientIntensity(true, 0), 0.34, 'contraste minimal : l’ambiante est à 0.34');
near(ambientIntensity(true, 1), 0.12, 'contraste maximal : l’ambiante tombe à 0.12 (plancher)');
eq([clampDarkness(-3), clampDarkness(0), clampDarkness(0.5), clampDarkness(4), clampDarkness('x')],
  [0, 0, 0.5, 1, 0], 'darkness est borné à 0…1 (une valeur absurde ne casse pas la lumière)');
eq([sampleLevel(true), sampleLevel(false)], [2, 0], 'le sampleLevel suit le mode (2 / 0)');

/* ── 6. Lampes et ambiante validées par le VRAI RendererParams de Mol* ───── */
const mergedRenderer = (props) => PD.merge(RendererParams, PD.getDefaultValues(RendererParams), props);
const lamp = molstarRendererProps({ shadowOn: true, darkness: 0.5, az: 30, el: 25 });
const aimed = molstarSphericalFromDirection(nglKeyLightDirection(30, 25));
const mR = mergedRenderer(lamp);
eq(mR.light.length, 1, 'une seule lampe directionnelle, comme la key light de NGL');
eq(mR.light[0].color, LIGHT_RIG.keyColor, '…blanche, comme dans NGL');
near(mR.light[0].intensity, keyLightIntensity(true, 0.5), '…à l’intensité du rig (1.65 à mi-contraste)');
near(mR.light[0].inclination, aimed.inclination, '…inclinée selon « 💡 Light » (élévation)');
near(mR.light[0].azimuth, aimed.azimuth, '…et orientée selon « 💡 Light » (azimut)');
eq(mR.ambientColor, LIGHT_RIG.ambientColor, 'l’ambiante reste blanche');
near(mR.ambientIntensity, ambientIntensity(true, 0.5), '…à l’intensité du rig (0.23 à mi-contraste)');
near(mR.exposure, 1, 'exposure 1 : NGL n’en a pas, la valeur doit rester neutre');
ok(!('backgroundColor' in molstarRendererProps({ shadowOn: true })),
  'sans couleur de fond demandée, le rig n’impose pas la sienne (Mol* garde la sienne)');
near(mergedRenderer(molstarRendererProps({ shadowOn: true, backgroundColor: '#f8fafc' })).backgroundColor,
  0xf8fafc, '…et quand elle est demandée, #f8fafc devient l’entier attendu');
const mOff = mergedRenderer(molstarRendererProps({ shadowOn: false }));
near(mOff.light[0].intensity, 1.15, 'hors ombres : la key redescend à 1.15');
near(mOff.light[0].inclination, 180, '…et redevient la lampe liée à la caméra (180°)');
near(mOff.ambientIntensity, 0.34, '…avec l’ambiante de repos (0.34)');

/* ── 7. Ambient occlusion + ombres portées : « on », validé par Mol* ─────── */
const post = molstarPostprocessingProps();
eq(post.occlusion.name, 'on', "postprocessing.occlusion.name = 'on' — l'ambient occlusion est DEMANDÉE");
eq(post.shadow.name, 'on', "postprocessing.shadow.name = 'on' — les ombres directionnelles aussi");
eq(post.outline.name, 'off', 'aucun contour : NGL n’en dessinait pas, le look de référence ne change pas');
const mPost = PD.merge(PostprocessingParams, PD.getDefaultValues(PostprocessingParams), post);
eq([mPost.occlusion.name, mPost.shadow.name, mPost.outline.name], ['on', 'on', 'off'],
  'Mol* garde ces trois choix après fusion de son propre schéma');
const ao = mPost.occlusion.params;
eq([ao.samples, ao.radius, ao.bias, ao.blurKernelSize, ao.blurDepthBias, ao.resolutionScale],
  [32, 5, 0.8, 15, 0.5, 1], 'les réglages d’AO sont ceux de Mol*, pas des valeurs inventées');
eq(ao.color, 0x000000, 'la cavité est assombrie vers le noir');
near(ao.transparentThreshold, 0.4, '…avec le seuil de transparence du schéma Mol*');
eq(ao.multiScale.name, 'off', 'multi-échelle éteint par défaut (plus lent), activable par paramètre');
eq(mPost.shadow.params, { steps: 16, maxDistance: 12, tolerance: 1 }, 'les ombres prennent le préréglage « pymolRay »');
// Les bornes déclarées par Mol* (mol-canvas3d/passes/shadow.js) : un préréglage
// hors bornes serait ramené à la borne sans le dire.
for (const [name, preset] of Object.entries(MOLSTAR_SHADOW_PRESETS)) {
  ok(preset.steps >= 1 && preset.steps <= 64, `préréglage ${name} : steps dans 1…64`);
  ok(preset.maxDistance >= 0 && preset.maxDistance <= 256, `préréglage ${name} : maxDistance dans 0…256`);
  ok(preset.tolerance >= 0 && preset.tolerance <= 10, `préréglage ${name} : tolerance dans 0…10`);
}
ok(MOLSTAR_SHADOW_PRESETS.pymolRay.steps > MOLSTAR_SHADOW_PRESETS.molstarDefault.steps,
  '« pymolRay » échantillonne plus loin que le défaut de Mol* : des ombres vraiment visibles');
eq(MOLSTAR_OCCLUSION_PARAMS.radius, mPost.occlusion.params.radius, 'le rig publie bien le rayon d’AO qu’il applique');

/* ── 8. L’ensemble passe Canvas3DParams (et le piège de l’imbrication) ───── */
const cfg = molstarCanvasProps({ shadowOn: true, darkness: 0.5, az: 30, el: 25, backgroundColor: '#f8fafc' });
const mC = PD.merge(Canvas3DParams, PD.getDefaultValues(Canvas3DParams), cfg);
eq([mC.postprocessing.occlusion.name, mC.postprocessing.shadow.name], ['on', 'on'],
  'la config complète garde l’AO ET les ombres après fusion');
near(mC.postprocessing.shadow.params.steps, 16, '…avec les pas du préréglage');
eq(mC.renderer.light.length, 1, '…la lampe du rig');
near(mC.renderer.light[0].intensity, 1.65, '…à l’intensité du rig pour darkness 0.5');
eq(mC.renderer.backgroundColor, 0xf8fafc, '…et la couleur de fond du viewer (#f8fafc)');
eq(mC.multiSample.sampleLevel, 2, 'le sampleLevel du rig arrive dans multiSample');
/* LE PIÈGE QUE CETTE SUITE LAISSAIT PASSER. Les deux assertions qui étaient ici
   (sampleLevel 2, mode « temporal ») étaient VERTES et ne mesuraient rien : elles
   constataient le défaut de Mol* — « temporal » — et non une décision du rig, qui
   ne l’écrivait pas. Elles seraient restées vertes le jour où Mol* aurait changé
   son défaut pour « on », le mode qui paie tous les échantillons en une frame.
   On vérifie donc d’abord les quatre clés ÉCRITES, puis le canari. */
const mDef = PD.getDefaultValues(Canvas3DParams);
eq(cfg.multiSample, MOLSTAR_MULTISAMPLE_INTERACTIVE,
  'les 4 clés de multiSample sont ÉCRITES par le rig, pas héritées d’un défaut de bibliothèque');
eq(mDef.multiSample.mode, 'temporal',
  'Mol* 4.18.0 a bien « temporal » par défaut — la raison pour laquelle l’ancienne assertion semblait juste');
eq(mDef.multiSample.sampleLevel, 2, '…et 2 comme niveau, comme le rig quand les ombres sont allumées');
const hostile = PD.merge(Canvas3DParams, {
  ...mDef, multiSample: { ...mDef.multiSample, mode: 'on', sampleLevel: 4 },
}, cfg);
// PD.merge renvoie un objet SANS prototype : on compare donc les valeurs, jamais
// l’objet (deepStrictEqual y verrait deux prototypes différents).
eq(
  [hostile.multiSample.mode, hostile.multiSample.sampleLevel, hostile.multiSample.reduceFlicker, hostile.multiSample.reuseOcclusion],
  ['temporal', 2, true, true],
  'même avec un défaut de Mol* passé à « on »/4, l’interactif reste « temporal »/2 : aucune frame 4× plus lourde',
);
eq(MOLSTAR_MULTISAMPLE_INTERACTIVE.sampleLevel, LIGHT_RIG.on.sampleLevel,
  'le niveau de l’interactif est celui du rig (ombres allumées)');
/* La contrepartie FIXE-image, et son unique porte d’entrée. */
eq(MOLSTAR_MULTISAMPLE_STILL.mode, 'on', 'l’image fixe prend ses échantillons en UNE frame (déterministe, rien à accumuler)');
eq(molstarMultiSampleProps().mode, 'temporal', 'sans argument, le helper sert l’interactif — jamais « on » par accident');
eq(molstarMultiSampleProps({ still: true }), MOLSTAR_MULTISAMPLE_STILL,
  '« still: true » est le SEUL chemin vers « on »');
eq(molstarMultiSampleProps({ still: true, sampleLevelOverride: 4 }).sampleLevel, 4,
  'le niveau de l’image fixe se règle par paramètre (l’interactif garde celui du rig)');
const mStill = PD.merge(Canvas3DParams, mDef, { multiSample: molstarMultiSampleProps({ still: true }) });
eq([mStill.multiSample.mode, mStill.multiSample.sampleLevel], ['on', 3],
  'la config de l’image fixe traverse le schéma de Mol* intacte');
/* Et la formule fausse ne doit pas revenir dans le module. */
ok(!RIG.includes('le même nom et le même sens'),
  'la traduction fausse (« même nom et même sens ») a disparu du module de lumière');
ok(RIG.includes(`mode: 'temporal'`), '…remplacée par le mode écrit noir sur blanc');
// LE PIÈGE : `postprocessing` est un groupe FRÈRE de `renderer`. Imbriqué par
// erreur, il est ignoré en silence et Mol* retombe sur SES défauts (ombres
// éteintes) — cette assertion échouerait si quelqu’un « rangeait » la config.
const wrongNesting = PD.merge(Canvas3DParams, PD.getDefaultValues(Canvas3DParams), {
  renderer: { postprocessing: cfg.postprocessing, ...cfg.renderer },
});
eq(wrongNesting.postprocessing.shadow.name, 'off',
  'imbriqué sous renderer, le réglage des ombres est silencieusement perdu (d’où cette garde)');
eq(wrongNesting.renderer.postprocessing, undefined, '…car le renderer de Mol* n’a pas de clé postprocessing');

/* ── 9. Petits utilitaires ───────────────────────────────────────────────── */
eq([hexToInt('#f8fafc'), hexToInt('#fff'), hexToInt(0x123456), hexToInt('nope'), hexToInt(null)],
  [0xf8fafc, 0xffffff, 0x123456, 0xffffff, 0xffffff],
  'les couleurs du viewer deviennent les entiers de Mol* (et l’absurde ne casse rien)');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_viewer_light_rig_test.mjs — ${passed} assertions OK`);

