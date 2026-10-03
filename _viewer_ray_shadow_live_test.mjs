/* =========================================================================
   _viewer_ray_shadow_live_test.mjs — L'OMBRE VIVANTE DU « ✨ Ray ».

   La demande : « wow! it works! will it be possible to see it while the
   molecule is moving and not only as a still picture? » OUI — et ce fichier
   mesure ce qui le rend vrai :

     1. LE MODULE EST PUR : il n'importe ni NGL ni React, il ne touche pas au
        DOM à l'import, et il réutilise le module des ombres (donc LA MÊME
        ombre : aucune seconde méthode n'est née ici).
     2. LES TROIS RÉGIMES : `auto` est le défaut (la réponse B et C de la barre
        restent sélectionnables), et la politique d'une image est mesurée sur
        toutes les combinaisons (geste / arrêt / image déjà nette).
     3. LE BROUILLON S'ADAPTE : une image trop chère rétrécit le masque suivant,
        une image bon marché le regrandit — et jamais hors des bornes.
     4. LA COUCHE EST LE PNG : sur toute une plage de valeurs et de forces,
        `dst·(1 − a)` (la toile noire d'alpha `s·m`) et le `v·(1 − s·m)` du still
        diffèrent d'AU PLUS UNE UNITÉ. C'est la parité, calculée ici, et mesurée
        sur de vrais pixels WebGL par _viewer_ray_shadow_pixels_test.cjs.
     5. LA POSE : elle se lit dans `matrixWorldInverse` (PAS dans `camera.view`,
        qui est le view-offset d'NGL), et deux poses immobiles sont « la même ».
     6. LA SIGNATURE DE LA SCÈNE : elle change quand une trajectoire avance
        (`currentFrame`), quand le groupe de la vue glisse, quand un composant
        est caché — sans elle, l'ombre d'une molécule qui JOUE serait figée.
     7. LE PILOTE, conduit avec des doublures : brouillon pendant le geste,
        UNE passe nette à l'arrêt, rien tant que rien ne bouge, et la couche
        effacée (jamais une ombre périmée) quand la scène ne projette rien.
     7b. LA SIGNATURE DES ENTRÉES DU MASQUE (maskInputsSignatureOf) : c'est ce
        que le filet LIT pour décider s'il doit repeindre — un atome glissé, un
        rayon de bille ou de bâton, une arête, un maillage reconstruit, la lampe
        ou la taille de la toile changent l'empreinte ; deux lectures des mêmes
        entrées ne la changent pas. Le rapport de cette session (« the auto mode
        for live rendering of ray is good but it reinitializes the view even if i
        move the mouse without moving the molecule ») est mesuré en pixels réels
        par _viewer_ray_shadow_idle_test.cjs : 40 images rendues pour 40
        `mousemove`, molécule immobile, ZÉRO reconstruction du masque.
     8. LE CÂBLAGE DANS LE VIEWER : la couche dans le JSX (`pointer-events:
        none`, au-dessus de la toile d'NGL), le pilote attaché au signal
        `rendered`, la préférence mémorisée, et la composition dans les DEUX
        films (`filmCanvasFor`), comme la vignette 🌑.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_LIVE_DEFAULTS, RAY_LIVE_QUALITIES, RAY_LIVE_SETTINGS,
  rayLiveQualityOf, rayLiveSettingOf, rayLiveShadowOptions, rayLiveDecision,
  nextDraftWidth, maskAlphaInto, poseOf, samePose, sceneSignatureOf,
  maskInputsSignatureOf, createRayShadowOverlay, attachRayShadowLive,
} from './src/utils/viewerRayShadowLive.js';
import { rayShadowOptions, applyShadowToPixels } from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const MODULE = readFileSync(new URL('./src/utils/viewerRayShadowLive.js', import.meta.url), 'utf8');
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── 1. LE MODULE EST PUR ────────────────────────────────────────────────── */
ok(!/from ['"][^'"]*ngl/.test(MODULE), 'le module ne connaît PAS ngl : il ne lit que la pose, la signature et le masque');
ok(!/useState|useRef|useEffect|React/.test(MODULE), 'aucun état React : la politique est une fonction du temps');
ok(!/\bdocument\b/.test(MODULE), 'aucun DOM : la toile de la couche est FOURNIE par l’appelant');
ok(MODULE.includes("from './viewerRayShadows.js'"),
  'il réutilise le module des ombres : le direct et le PNG ne peuvent pas diverger');
ok(MODULE.includes("typeof element.getContext !== 'function'"),
  'sans toile 2D la couche est refusée (`null`) au lieu d’exploser');
ok(MODULE.includes("typeof signal.add === 'function'"), 'le pilote s’accroche au signal `rendered` s’il existe');
ok(MODULE.includes('readInputs = rayShadowInputsOf') && MODULE.includes('buildMask = buildRayShadowMask'),
  'les deux moitiés (le rig, le masque) sont INJECTABLES — la politique se mesure donc sans navigateur');

/* ── 2. LES TROIS RÉGIMES, ET LE DÉFAUT ──────────────────────────────────── */
eq(RAY_LIVE_QUALITIES, ['auto', 'full', 'draft'], 'trois régimes : le direct (auto), la qualité du PNG, le brouillon');
eq(RAY_LIVE_DEFAULTS.quality, 'auto', 'le DÉFAUT est `auto` : brouillon pendant le geste, net à l’arrêt');
eq(RAY_LIVE_SETTINGS, ['off', 'auto', 'full', 'draft'], '…et la barre peut l’éteindre (`off`) sans perdre le régime mémorisé');
eq(rayLiveQualityOf('n’importe quoi'), 'auto', 'une qualité inconnue retombe sur le défaut');
eq(rayLiveQualityOf('draft'), 'draft', '…et une qualité connue est rendue telle quelle');
eq(rayLiveSettingOf('off'), 'off', 'le réglage `off` de la barre survit à la lecture');
eq(rayLiveSettingOf(undefined), 'auto', 'un réglage absent vaut le défaut (donc un premier lancement est en `auto`)');

/* ── 3. LES OPTIONS : LE NET EST CELUI DU PNG, LE BROUILLON EST MOINS CHER ── */
const stillOptions = rayShadowOptions({ strength: 0.55, blur: 1.5 });
eq(rayLiveShadowOptions({ strength: 0.55, blur: 1.5 }, 'full'), stillOptions,
  'en `full`, les options sont EXACTEMENT celles du still (même masque, même force, même douceur)');
const draft = rayLiveShadowOptions({ strength: 0.55, blur: 1.5 }, 'draft');
eq(draft.maskMaxWidth, RAY_LIVE_DEFAULTS.draftMaskWidth, 'en brouillon, le masque est plafonné (420 px ; le still plafonne à 1400)');
eq(draft.pcfTaps, RAY_LIVE_DEFAULTS.draftTaps, '…et la lampe est échantillonnée 4 fois au lieu de 8');
eq(draft.strength, stillOptions.strength, 'la noirceur ne bouge PAS : seule la finesse change');
eq(draft.softness, stillOptions.softness, 'la douceur ne bouge pas non plus');
eq(draft.penumbra, stillOptions.penumbra, '…ni la pénombre');
eq(rayLiveShadowOptions({ maskMaxWidth: 300 }, 'draft').maskMaxWidth, 300,
  'un appelant qui demande MOINS garde le moins des deux (jamais plus que le still)');
eq(rayLiveShadowOptions({ pcfTaps: 2 }, 'draft').pcfTaps, 2, '…idem pour les échantillons');


/* ── 4. LA DÉCISION D'UNE IMAGE (toutes les combinaisons) ────────────────── */
const idleMs = RAY_LIVE_DEFAULTS.idleMs;
eq(rayLiveDecision({ quality: 'auto', moving: true, sinceMoveMs: 0, idleMs, lastMode: null }),
  { mode: 'draft', rebuild: true, why: 'moving' },
  'en `auto`, un geste se peint en BROUILLON');
eq(rayLiveDecision({ quality: 'auto', moving: false, sinceMoveMs: idleMs + 1, idleMs, lastMode: 'draft' }),
  { mode: 'full', rebuild: true, why: 'idle-refine' },
  '…et l’arrêt (idleMs) déclenche UNE passe NETTE');
eq(rayLiveDecision({ quality: 'auto', moving: false, sinceMoveMs: idleMs + 1, idleMs, lastMode: 'full' }),
  { mode: 'full', rebuild: false, why: 'idle-sharp' },
  '…qui ne se répète PAS quand la couche est déjà nette');
eq(rayLiveDecision({ quality: 'auto', moving: false, sinceMoveMs: 10, idleMs, lastMode: 'draft' }),
  { mode: 'draft', rebuild: false, why: 'idle-wait' },
  'avant l’échéance, on attend le prochain signe de vie');
eq(rayLiveDecision({ quality: 'full', moving: true, sinceMoveMs: 0, idleMs, lastMode: null }).mode, 'full',
  'en `full`, même un geste est peint en qualité PNG');
eq(rayLiveDecision({ quality: 'draft', moving: false, sinceMoveMs: idleMs + 1, idleMs, lastMode: 'draft' }).mode, 'draft',
  'en `draft`, l’arrêt ne durcit RIEN (c’est la réponse C de la barre)');
ok(rayLiveDecision({}).rebuild, 'sans indication, la politique répond quelque chose (jamais un silence)');

/* ── 5. LE BROUILLON S'ADAPTE AU BUDGET ─────────────────────────────────── */
const D = RAY_LIVE_DEFAULTS;
eq(nextDraftWidth(Number.NaN, 420), 420, 'sans mesure, la largeur ne bouge pas');
ok(nextDraftWidth(200, 420) < 420, `une image de 200 ms RÉTRÉCIT le masque suivant (${nextDraftWidth(200, 420)} px)`);
ok(nextDraftWidth(45, 420) === 420, '…une image pile dans le budget ne le change pas');
ok(nextDraftWidth(10, 300) > 300, '…une image bon marché le regrandit');
ok(nextDraftWidth(10, 300) <= 300 * 1.25 + 1, '…mais d’un quart au plus par image (pas d’oscillation)');
ok(nextDraftWidth(5000, 420) >= D.minDraftWidth, 'jamais sous le plancher du module');
ok(nextDraftWidth(1, 100000) <= D.maxDraftWidth, 'jamais au-dessus du plafond');
ok(nextDraftWidth(200, 420) < nextDraftWidth(20, 420), 'plus la scène est lente, plus le masque est petit');
eq(nextDraftWidth(180, 420, { ...D, targetMs: 180 }), 420, 'le budget est réglable (une machine plus lente garde sa pleine largeur)');
ok(nextDraftWidth(200, 420, { ...D, targetMs: 180 }) < 420, '…et une image AU-DESSUS de ce budget rétrécit quand même');

/* ── 6. LA COUCHE EST LE PRODUIT DU PNG (parité calculée) ────────────────── */
const MW = 8;
const MH = 4;
const mask = new Float64Array(MW * MH);
for (let i = 0; i < mask.length; i += 1) mask[i] = (i % 5) / 4;   // 0 · ¼ · ½ · ¾ · 1
const STRENGTH = 0.55;
const base = new Uint8ClampedArray(MW * MH * 4);
for (let i = 0; i < MW * MH; i += 1) {
  base[i * 4] = 200; base[i * 4 + 1] = 40; base[i * 4 + 2] = 120; base[i * 4 + 3] = 255;
}
/* a) le still : chaque canal × (1 − s·m) */
const stillPix = Uint8ClampedArray.from(base);
const touched = applyShadowToPixels(stillPix, MW, MH, mask, MW, MH, STRENGTH);
/* b) le direct : un noir d'alpha s·m, composé `source-over` */
const layer = { width: MW, height: MH, data: Uint8ClampedArray.from(base) };
const painted = maskAlphaInto(layer, mask, STRENGTH);
let maxDiff = 0;
let wiped = 0;
for (let i = 0; i < MW * MH; i += 1) {
  const a = layer.data[i * 4 + 3] / 255;
  for (let k = 0; k < 3; k += 1) {
    const composited = Math.round(base[i * 4 + k] * (1 - a));
    maxDiff = Math.max(maxDiff, Math.abs(stillPix[i * 4 + k] - composited));
    if (stillPix[i * 4 + k] === 0 && base[i * 4 + k] > 0) wiped += 1;
  }
}
ok(touched > 0 && painted > 0, 'les deux chemins assombrissent vraiment des pixels');
eq(wiped, 0, 'aucun canal n’est mis à ZÉRO (une ombre assombrit, elle ne creuse pas)');
ok(maxDiff <= 1, `la couche du direct et le produit du PNG diffèrent d’au plus 1 unité (mesuré : ${maxDiff})`);
eq(maskAlphaInto(layer, new Float64Array(MW * MH), STRENGTH), 0, 'un masque NUL ne peint aucun pixel');
ok(layer.data[3] === 0, '…donc l’alpha est nul : le compositeur ne touche pas le fond');


/* ── 7. LA POSE ET LA SIGNATURE DE LA SCÈNE ─────────────────────────────── */
const mat16 = (v) => { const a = new Array(16).fill(0); a[0] = v; a[5] = 1; a[10] = 1; a[15] = 1; return a; };
eq(poseOf(null), null, 'sans viewer, aucune pose');
eq(poseOf({ camera: { view: { enabled: false } } }), null,
  '⚠ `camera.view` d’NGL est le VIEW-OFFSET, pas la pose : elle ne la donne jamais');
eq(poseOf({ camera: { matrixWorldInverse: { elements: mat16(1) } } }), mat16(1),
  'la pose se lit dans `matrixWorldInverse` — ce que `cameraFromViewer` lit aussi');
eq(poseOf({ camera: { matrix: { elements: mat16(3) } } }), mat16(3), '…ou dans `matrix` quand c’est tout ce qu’il y a');
ok(samePose(mat16(1), mat16(1)), 'deux fois la même matrice : la même pose (donc rien à repeindre)');
ok(samePose(mat16(1), mat16(1.00005)), '…une différence sous la tolérance est une caméra AU REPOS');
ok(!samePose(mat16(1), mat16(1.5)), 'une caméra qui a tourné est une AUTRE pose');
ok(!samePose(null, mat16(1)) && !samePose(mat16(1), null), 'une pose inconnue n’est jamais « la même » : on repeint');

const stageWith = (over = {}) => {
  const comp = { visible: true, currentFrame: 0, matrix: { elements: mat16(1) }, reprList: [1] };
  const stage = {
    compList: [comp],
    viewer: {
      rotationGroup: { matrix: { elements: mat16(1) } },
      translationGroup: { position: { x: 0, y: 0, z: 0 } },
    },
  };
  Object.assign(stage, over);
  return { stage, comp };
};
const sig0 = sceneSignatureOf(stageWith().stage);
eq(sceneSignatureOf(stageWith().stage), sig0, 'deux lectures d’une scène immobile donnent la MÊME signature');
{
  const { stage, comp } = stageWith();
  comp.currentFrame = 3;
  ok(sceneSignatureOf(stage) !== sig0, 'une image de trajectoire en plus change la signature (l’ombre suit la molécule qui JOUE)');
}
{
  const { stage } = stageWith();
  stage.viewer.rotationGroup.matrix.elements = mat16(2);
  ok(sceneSignatureOf(stage) !== sig0, 'un glissement de la vue (rotationGroup) change la signature');
}
{
  const { stage, comp } = stageWith();
  comp.matrix.elements[12] = 5;
  ok(sceneSignatureOf(stage) !== sig0, 'un composant déplacé (sa propre matrice) change la signature');
}
{
  const { stage, comp } = stageWith();
  comp.visible = false;
  ok(sceneSignatureOf(stage) !== sig0, 'un composant caché change la signature');
}
eq(sceneSignatureOf(null), '0', 'sans stage, la signature est vide mais stable (jamais d’exception)');


/* ── 7b. LA SIGNATURE DES ENTRÉES DU MASQUE ─────────────────────────────────
   CE QUE LE FILET LIT (le rapport de cette session : « the auto mode for live
   rendering of ray is good but it reinitializes the view even if i move the
   mouse without moving the molecule »). Une image rendue par NGL n’est pas un
   geste : au lieu de refaire le masque parce que le temps a passé, le pilote
   demande aux entrées si elles ont changé — et cette empreinte-ci est ce qu’il
   compare. Elle doit donc voir TOUT ce qui change une ombre sans la caméra, et
   RIEN d’autre. */
const atomsIn = (over = {}) => ({
  count: 2, filled: 1,
  positions: new Float32Array([0, 0, 0, 1, 0, 0]),
  radii: new Float32Array([1.5, 1.5]),
  linkRadii: new Float32Array([0.2, 0.2]),
  edges: new Int32Array([0, 1]),
  tris: {
    count: 6, vertexCount: 4, reps: 1, plates: 1, kinds: 'cartoon',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  },
  ...over,
});
const lightIn = (over = {}) => ({ dir: [0, 0, 1], center: [0, 0, 0], radius: 10, distance: 1000, ...over });
const SIZE900 = [900, 600];
const sigOf = (atoms, light = lightIn(), size = SIZE900) => maskInputsSignatureOf({ atoms, light }, size);
const sigBase = sigOf(atomsIn());
eq(sigOf(atomsIn()), sigBase, 'deux lectures des mêmes entrées donnent la MÊME empreinte (donc rien à repeindre)');
{
  const slide = atomsIn();
  slide.positions = Float32Array.from(slide.positions);
  slide.positions[3] = 0.5;                     // un seul atome, sur un seul axe
  ok(sigOf(slide) !== sigBase,
    'UN atome déplacé de 0,5 Å change l’empreinte : la « torsion pincée » se voit, elle');
}
ok(sigOf(atomsIn({ radii: new Float32Array([2.5, 1.5]) })) !== sigBase,
  '…un rayon de BILLE aussi (un style qui change la silhouette)');
ok(sigOf(atomsIn({ linkRadii: new Float32Array([0.6, 0.2]) })) !== sigBase,
  '…un rayon de BÂTON aussi : les deux rayons d’un atome comptent');
ok(sigOf(atomsIn({ count: 1 })) !== sigBase, '…un atome en plus (ou en moins) aussi');
ok(sigOf(atomsIn({ edges: new Int32Array([0, 1, 1, 2]) })) !== sigBase,
  '…une arête en plus (le graphe des liaisons) aussi');
{
  const rebuilt = atomsIn();
  rebuilt.tris = { ...rebuilt.tris, positions: new Float32Array([9, 9, 9, 1, 0, 0, 0, 1, 0, 1, 1, 0]) };
  ok(sigOf(rebuilt) !== sigBase, 'un maillage RECONSTRUIT (les triangles) change l’empreinte');
  const bigger = atomsIn();
  bigger.tris = { ...bigger.tris, count: 12, vertexCount: 8, positions: new Float32Array(24), indices: new Uint32Array(12) };
  ok(sigOf(bigger) !== sigBase, '…et un maillage plus gros aussi');
}
ok(sigOf(atomsIn(), lightIn({ dir: [0, 0.2, 1] })) !== sigBase, 'la LAMPE entre dans l’empreinte (sa direction)');
ok(sigOf(atomsIn(), lightIn({ radius: 12 })) !== sigBase, '…et son rayon (la boîte a changé)');
ok(sigOf(atomsIn(), lightIn(), [900, 601]) !== sigBase,
  'la TAILLE de la toile aussi : un redimensionnement refait le masque');
eq(sigOf(atomsIn(), lightIn(), null) === sigBase, false, '« pas de taille » n’est pas « la même taille »');
ok(maskInputsSignatureOf({}, null).length > 0, 'des entrées vides donnent quand même une empreinte (jamais une exception)');


/* ── 8. LE PILOTE, CONDUIT AVEC DES DOUBLURES ──────────────────────────────
   Ni NGL ni navigateur : le rig et le masque sont injectés (comme le décodeur
   et l'encodeur du module du « Ray »), le temps est une variable, et la couche
   est un tableau. C'est donc la POLITIQUE qu'on mesure ici — celle qui décide
   ce qui est peint, quand, et à quelle finesse. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let clock = 1000;
const makePilot = ({
  quality = 'auto', idleMs = 0, staleMs = 0, costMs = 0, fail = false, pose = mat16(1), reported = null,
} = {}) => {
  const handlers = [];
  const stage = {
    compList: [{ visible: true, currentFrame: 0, matrix: { elements: mat16(1) }, reprList: [] }],
    viewer: {
      camera: { matrixWorldInverse: { elements: pose.slice() } },
      renderer: { domElement: { width: 40, height: 20 } },
      signals: { rendered: { add: (f) => handlers.push(f), remove: (f) => { const i = handlers.indexOf(f); if (i >= 0) handlers.splice(i, 1); } } },
    },
  };
  const paints = [];
  /* LES ENTRÉES DU MASQUE, MUABLES : c’est ce que le filet LIT pour décider. Un
     atome glissé, un rayon changé ou un maillage reconstruit se mesurent donc ici
     sans NGL (voir §8, le filet). */
  const atoms = {
    count: 1, filled: 0,
    positions: new Float32Array([0, 0, 0]),
    radii: new Float32Array([1.5]),
    linkRadii: new Float32Array([0.2]),
  };
  const inputs = { atoms, camera: {}, light: { dir: [0, 0, 1], center: [0, 0, 0], radius: 10, distance: 1000 } };
  /* UNE LECTURE QUI ÉCHOUE PUIS RÉUSSIT (le §8 la fait basculer) : la caméra
     d'un still « ✨ Ray » fait jeter `cameraFromViewer`, et le filet doit s'en
     remettre — une lecture ratée une fois ne peut pas laisser la vue sans ombre. */
  let failing = false;
  const overlay = {
    paint: (shadow) => { paints.push(shadow); return shadow && shadow.mask ? shadow.mask.length : 0; },
    clear: () => { paints.push('clear'); },
    dispose: () => { paints.push('clear'); },
    size: () => [0, 0],
  };
  const pilot = attachRayShadowLive({
    stage,
    overlay,
    quality,
    defaults: { ...RAY_LIVE_DEFAULTS, idleMs, staleMs },
    now: () => clock,
    onStats: reported ? (s) => reported.push(s) : null,
    readInputs: () => {
      if (fail || failing) throw new Error('nothing to cast a shadow from');
      return inputs;
    },
    buildMask: ({ width, height, options }) => {
      clock += costMs;
      return { mask: new Float64Array(width * height), maskWidth: width, maskHeight: height, strength: options.strength };
    },
  });
  return {
    stage,
    pilot,
    paints,
    handlers,
    inputs,
    turn: (v) => { stage.viewer.camera.matrixWorldInverse.elements = mat16(v); },
    frame: (v) => { stage.compList[0].currentFrame = v; },
    /* LE GESTE DU FILET : des atomes qui bougent SANS que la caméra ni la
       signature ne changent (c’est exactement ce que le filet doit attraper). */
    slide: (dx) => { atoms.positions[0] += dx; },
    failReads: (v) => { failing = v; },
    render: () => [...handlers].forEach((h) => h()),
  };
};


const A = makePilot();
eq(A.pilot.stats().builds, 0, 'un pilote fraîchement attaché n’a rien peint tout seul');
A.pilot.refresh({ force: true });
eq(A.pilot.stats().mode, 'full', 'la première ombre est déjà NETTE : aucun geste n’a eu lieu');
eq(A.pilot.stats().builds, 1, '…et c’est la seule construction');
eq(A.paints.length, 1, '…donc une seule peinture de couche');
eq(A.handlers.length, 1, 'le pilote s’accroche au signal `rendered` de NGL');
{
  /* LE DIAGNOSTIC PUBLIÉ (onStats) : c'est lui qu'une barre lirait pour dire ce
     que la dernière image a coûté — donc il est mesuré, pas laissé mort. */
  const reported = [];
  const R = makePilot({ reported });
  R.pilot.refresh({ force: true });
  ok(reported.length > 0 && reported[reported.length - 1].builds === 1,
    'le pilote PUBLIE son état à chaque ombre peinte (mode, temps, pixels)');
  ok(reported[reported.length - 1].mode === 'full' && reported[reported.length - 1].painted > 0,
    '…et ce qu’il publie dit le régime ET la surface peinte');
}

const B = makePilot({ idleMs: 0 });
B.pilot.refresh({ force: true });
B.turn(1.5);
B.render();
eq(B.pilot.stats().mode, 'draft', 'pendant le geste, c’est le BROUILLON qui est peint');
const drafts = B.pilot.stats().drafts;
B.render();
eq(B.pilot.stats().drafts, drafts, 'une image rendue à la MÊME pose ne recalcule RIEN');
await sleep(15);
eq(B.pilot.stats().mode, 'full', '…et la passe NETTE arrive toute seule à l’arrêt (la minuterie d’idleMs)');
const fulls = B.pilot.stats().fulls;
await sleep(15);
eq(B.pilot.stats().fulls, fulls, '…une seule fois : une couche nette ne se refait pas');
B.frame(2);
B.render();
eq(B.pilot.stats().mode, 'draft', 'une trajectoire qui avance (currentFrame) repeint la couche, caméra immobile');

const C = makePilot({ quality: 'draft', idleMs: 0 });
C.pilot.refresh({ force: true });
eq(C.pilot.stats().mode, 'draft', 'en régime `draft`, même la première ombre est un brouillon');
C.turn(1.5);
C.render();
await sleep(15);
eq(C.pilot.stats().mode, 'draft', '…et l’arrêt ne la durcit pas : le régime `draft` reste doux');
eq(C.pilot.stats().fulls, 0, 'aucune passe nette n’a jamais eu lieu dans ce régime');

const F = makePilot({ quality: 'full' });
F.pilot.refresh({ force: true });
F.turn(1.5);
F.render();
eq(F.pilot.stats().mode, 'full', 'en régime `full`, chaque geste est peint en qualité PNG');
eq(F.pilot.stats().drafts, 0, '…sans jamais passer par le brouillon');

const S = makePilot({ costMs: 240 });
S.pilot.refresh({ force: true });
const width0 = S.pilot.stats().draftWidth;
S.turn(1.5);
S.render();
ok(S.pilot.stats().draftWidth < width0,
  `une image de brouillon trop chère RÉTRÉCIT le masque suivant (${width0} → ${S.pilot.stats().draftWidth} px)`);
const narrow = S.pilot.stats().draftWidth;
clock += 10;                                  // la scène redevient bon marché
S.turn(2.5);
S.render();
ok(S.pilot.stats().draftWidth >= narrow, '…et une scène redevenue rapide le regrandit');

const E = makePilot({ fail: true });
E.pilot.refresh({ force: true });
eq(E.pilot.stats().error, 'nothing to cast a shadow from', 'une scène sans rien à projeter est DITE, pas avalée');
ok(E.paints.includes('clear'), '…et la couche est EFFACÉE : jamais l’ombre de l’image d’avant');
eq(E.pilot.stats().builds, 0, '…sans compter comme une construction');

/* LE FILET — CE QU'IL DEMANDE, ET CE QU'IL NE DEMANDE PLUS. Le rapport de cette
   session : « the auto mode for live rendering of ray is good but it
   reinitializes the view even if i move the mouse without moving the molecule ».
   NGL rend une image pour un survol, un picking, un repaint de la barre — la
   MESURE est dans _viewer_ray_shadow_idle_test.cjs (40 images rendues pour 40
   `mousemove`, molécule immobile). Une image rendue n'étant pas un geste, le
   filet ne juge plus sur l'horloge seule : il LIT les entrées du masque. */
const N = makePilot({ staleMs: 400 });
N.pilot.refresh({ force: true });
const buildsN = N.pilot.stats().builds;
N.render();
eq(N.pilot.stats().builds, buildsN, 'dans la fenêtre du filet, une image rendue POUR RIEN ne recalcule pas');
clock += 1000;
N.render();
eq(N.pilot.stats().builds, buildsN,
  '…et même PASSÉE la fenêtre (staleMs), une image rendue alors que RIEN n’a changé ne recalcule pas : c’est le survol, et c’est exactement lui qui « réinitialisait la vue »');
eq(N.pilot.stats().mode, 'full', '…la couche reste dans le RÉGIME DU REPOS : aucun brouillon parasite');
eq(N.pilot.stats().drafts, 0, '…donc aucun brouillon n’a été peint pour une image qui n’était pas un geste');

/* …ET LE FILET GARDE SON TRAVAIL : ce qui bouge sans changer ni la pose ni la
   signature (un atome glissé, une représentation reconstruite) est vu. */
const ND = makePilot({ staleMs: 400 });
ND.pilot.refresh({ force: true });
const nd0 = ND.pilot.stats();
ND.slide(0.6);                                    // des atomes ont bougé, la caméra non
clock += 1000;
ND.render();
eq(ND.pilot.stats().builds, nd0.builds + 1,
  'passée la fenêtre, des ATOMES glissés sont rattrapés : le filet fait bien son travail');
eq(ND.pilot.stats().mode, 'full', '…et il les rattrape DANS LE RÉGIME DU REPOS');
eq(ND.pilot.stats().drafts, nd0.drafts, '…sans AUCUN brouillon : la qualité ne clignote pas hors geste');
eq(ND.pilot.stats().fulls, nd0.fulls + 1, '…et par UNE seule passe nette (l’ancien filet en faisait deux : un brouillon, puis le net)');

/* LE FILET SE SOIGNE TOUT SEUL. Une lecture qui échoue (la caméra d’un still
   « ✨ Ray », un rig refusé) VIDE la couche — jamais l’ombre de l’image d’avant —
   et OUBLIE ce qui était peint : la lecture suivante, réussie, doit donc
   repeindre. Sans cela, une seule lecture ratée laisserait la vue sans ombre
   pour toujours. */
const NH = makePilot({ staleMs: 400 });
NH.pilot.refresh({ force: true });
const nh0 = NH.pilot.stats();
NH.failReads(true);
clock += 1000;
NH.render();
eq(NH.pilot.stats().error, 'nothing to cast a shadow from', 'une lecture qui échoue est DITE, pas avalée');
ok(NH.paints.includes('clear'), '…et la couche est effacée (aucune ombre périmée ne reste)');
NH.failReads(false);
clock += 1000;
NH.render();
eq(NH.pilot.stats().builds, nh0.builds + 1,
  '…et la lecture RÉUSSIE suivante repeint toute seule : le filet ne reste pas muet');
eq(NH.pilot.stats().error, '', '…en effaçant l’erreur d’avant');

const Q = makePilot();
Q.pilot.refresh({ force: true });
Q.pilot.setQuality('draft');
eq(Q.pilot.stats().quality, 'draft', 'la qualité change à chaud (le menu de la barre)');
eq(Q.pilot.stats().mode, 'draft', '…et la couche est tout de suite repeinte dans le nouveau régime');
Q.pilot.setQuality('n’importe quoi');
eq(Q.pilot.stats().quality, 'auto', '…une valeur inconnue retombe sur le défaut, jamais sur un régime inventé');

const Z = makePilot();
Z.pilot.refresh({ force: true });
Z.pilot.stop();
eq(Z.handlers.length, 0, 'à l’arrêt, le pilote se retire du signal (aucune fuite de gestionnaire)');
ok(Z.paints.includes('clear'), '…en effaçant la couche');



/* ── 9. LA COUCHE ELLE-MÊME (avec un faux contexte 2D) ───────────────────── */
{
  const puts = [];
  let images = 0;
  const element = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (w, h) => { images += 1; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData: (img) => puts.push([img.width, img.height]),
    }),
  };
  const overlay = createRayShadowOverlay(element);
  ok(!!overlay, 'une toile pourvue d’un contexte 2D donne une couche');
  const shadow = { mask: new Float64Array(4 * 2).fill(1), maskWidth: 4, maskHeight: 2, strength: 0.5 };
  eq(overlay.paint(shadow), 8, 'la couche peint chaque pixel du masque (ici 8)');
  eq([element.width, element.height], [4, 2], '…et la toile prend la TAILLE DU MASQUE (le CSS l’étire : bilinéaire, comme le still)');
  eq(puts[puts.length - 1], [4, 2], '…en UN `putImageData` (remplacer, pas composer)');
  eq(images, 1, '…avec une seule image RGBA réutilisée tant que la taille ne change pas');
  overlay.paint(shadow);
  eq(images, 1, '…et pas une de plus au coup suivant');
  eq(overlay.size(), [4, 2], 'la taille de la couche est lisible (le film s’en sert)');
  overlay.paint({ mask: new Float64Array(4), maskWidth: 0, maskHeight: 0 });
  eq([element.width, element.height], [1, 1], 'un masque vide VIDE la couche (1×1) au lieu de laisser l’ombre d’avant');
  overlay.clear();
  eq(overlay.size(), [1, 1], '…et `clear` laisse la même chose : rien à peindre');
  eq(createRayShadowOverlay(null), null, 'sans élément, pas de couche');
  eq(createRayShadowOverlay({ getContext: () => null }), null, 'sans contexte 2D, pas de couche non plus');
}

/* ── 10. LE CÂBLAGE DANS LE VIEWER ───────────────────────────────────────── */
has("import {\n  RAY_LIVE_DEFAULTS, rayLiveSettingOf, createRayShadowOverlay, attachRayShadowLive,\n} from '../utils/viewerRayShadowLive';",
  'le viewer importe le module de l’ombre vivante');
has("const RAY_LIVE_KEY = 'labViewerRayShadowLive';", 'le réglage a sa propre clé de mémoire');
has('try { return rayLiveSettingOf(localStorage.getItem(RAY_LIVE_KEY)); }',
  '…et il se relit au lancement (donc le défaut `auto` est bien celui du premier lancement)');
has("try { localStorage.setItem(RAY_LIVE_KEY, rayShadowLive); }", '…et il est écrit quand il change');
has('ref={rayShadowCanvasRef}', 'la couche est une toile du viewer lui-même');
has('className="absolute inset-0 w-full h-full pointer-events-none"',
  '…posée au-dessus de la vue, sans jamais prendre un clic');
has('const overlay = createRayShadowOverlay(canvas);', '…transformée en couche par le module');
has('const pilot = attachRayShadowLive({', '…et confiée au pilote');
has('light: () => { const p = rayLiveParamsRef.current;', 'la lampe est lue VIVANTE (par référence) : un curseur ne recrée pas le pilote');
has('options: () => { const p = rayLiveParamsRef.current; return { strength: p.strength, blur: p.blur }; },',
  '…et la noirceur / la douceur aussi');
has('if (pilot) pilot.refresh({ force: true });', 'la première ombre n’attend pas un geste');
has('}, [status, rayLiveOn, rayShadowLive]);', 'le pilote n’est recréé que quand le RÉGLAGE change ou que la scène arrive');
has('if (rayShadowLiveRef.current) rayShadowLiveRef.current.stop();',
  '…et il est arrêté au démontage (aucune fuite de gestionnaire)');
has("if (rayShadowLiveRef.current) rayShadowLiveRef.current.refresh({ force: true });",
  'un curseur de lampe / de force / de flou repeint la couche vivante');
has('<option value="auto">auto</option>', 'la barre propose `auto` (la réponse A, et le défaut)');
has('<option value="full">sharp</option>', '…`sharp` (la réponse B : la qualité du PNG)');
has('<option value="draft">draft</option>', '…et `draft` (la réponse C : le brouillon toujours)');
has('<option value="off">off</option>', '…et `off`, pour l’éteindre sans rien perdre');
has('onChange={(e) => setRayShadowLive(rayLiveSettingOf(e.target.value))}',
  'le choix passe par le module : jamais un régime inventé');
has('{(shadowOn || rayShadows || rayLiveOn) && (', 'les curseurs de la lampe s’affichent aussi pour la couche vivante');
has("if (typeof ry.live === 'string') setRayShadowLive(rayLiveSettingOf(ry.live));",
  'une figure enregistrée emporte l’ombre vivante');
has('live: rayShadowLive', '…et la sauvegarde de la figure l’écrit');
/* ⚠ LA ZONE MORTE, DÉJÀ MORDUE UNE FOIS : la référence des réglages vivants
   lit `shadowAz` / `shadowEl`, qui sont déclarées BIEN PLUS BAS dans le corps
   du composant. Remplie à côté de ses états, elle lèverait
   « Cannot access 'shadowAz' before initialization » à chaque rendu — le viewer
   ne s'afficherait plus du tout. C'est donc mesuré, pas espéré. */
{
  const assignAt = VIEW.indexOf('rayLiveParamsRef.current = { az: shadowAz');
  const azAt = VIEW.indexOf('const [shadowAz, setShadowAz] = useState');
  ok(assignAt > 0 && azAt > 0 && assignAt > azAt,
    'la référence des réglages vivants est remplie APRÈS la déclaration de `shadowAz` (sinon : zone morte au rendu)');
}
has('filmCanvasFor = (source, vignetteDarkness, background, shadowLayer = null) => {',
  'la toile de film accepte la couche — le 🎬 la portera donc aussi');
has('if (shadowLayer && shadowLayer.width > 1 && shadowLayer.height > 1) {',
  '…et une couche vidée (1×1) n’est pas peinte dans le film');
has('ctx.drawImage(shadowLayer, 0, 0, w, h);', '…par le même geste que la vignette : un drawImage par image');
has('filmCanvasFor(canvas, vignetteDarkness, bgColor, rayLiveOn ? rayShadowCanvasRef.current : null)',
  'le 🎬 de la trajectoire compose l’ombre vivante');
has(': Number.NaN, bgColor, rayLiveOn ? rayShadowCanvasRef.current : null);',
  '…et le film de poses aussi (les deux films se ressemblent)');

console.log(`_viewer_ray_shadow_live_test.mjs — ${passed} assertions OK (ombre vivante : parité PNG · 3 régimes · politique auto · pose · signature de la scène · signature des entrées du masque · couche · films)`);

