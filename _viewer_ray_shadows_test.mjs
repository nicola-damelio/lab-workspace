/* =========================================================================
   _viewer_ray_shadows_test.mjs — les OMBRES PORTÉES du bouton « ✨ Ray ».

   La demande : « the ray button only takes a snapshot of the image but does
   not introduce casted shadows ». C'est un fait de NGL 2.4, pas du bouton :
   `Stage.makeImage` rend LA MÊME scène avec les MÊMES matériaux, et cette scène
   n'a jamais eu de shadow map (voir la note au-dessus de `flagMeshShadows` dans
   NMRMoleculeViewer.jsx : les meshes portent castShadow / receiveShadow, aucun
   shader de NGL 2.4 ne les lit).

   CE QUI EST VÉRIFIÉ ICI :

    1. LE MODULE (src/utils/viewerRayShadows.js) EST INDÉPENDANT : aucune
       dépendance à React, à NGL ou au DOM à l'import — la même règle que le
       module de la « ray ». L'ombre est calculée à partir des ATOMES.
    2. LES MATHS, EXÉCUTÉES : matrices (lookAt / orthographique / produit), la
       sphère englobante, le rasterizer de sphères (la plus proche gagne), le
       TEST de shadow map (un atome derrière un autre le long de la lampe est à
       l'ombre), le flou de pénombre, l'échantillonnage bilinéaire, la
       multiplication dans les pixels (le canal alpha n'est JAMAIS touché).
    3. LE CÂBLAGE : le module branché dans viewerRayImage.js (options `shadows`
       + `lightDir`, note dans le message) et dans le viewer (case ◐ shadows,
       force, persistance, la lampe étant celle du rig ◐ Shadows).
    4. LE FANTÔME SIGNALÉ ENSUITE : « dans les images de ray il y a une image
       projetée, mais je vois comme une membrane projetée alors que la membrane
       n'est PAS visible dans le programme (elle a été cachée) ». L'ombre ne lit
       plus les atomes de la STRUCTURE mais ceux de ses représentations VISIBLES :
       ce qui n'est pas dessiné ne projette plus rien.
    5. LE RIG (la demande suivante : l'ombre « plate et détachée »). La caméra
       d'ombre est AJUSTÉE à la boîte de la molécule — les huit coins tombent
       dans le frustum, les bords du frustum les touchent, et sa profondeur est
       celle de la molécule au lieu des 2000 Å du cube d'autrefois.
    6. LA PÉNOMBRE : un disque PCF d'échantillons dont le rayon grandit avec
       l'écart receveur / occulteur (PCSS) — vérifié sur une carte d'ombre
       fabriquée à la main, où la valeur attendue se calcule.
    7. L'ÉPAISSEUR DU PROXY suit le TRAIT de chaque représentation (van der Waals
       pour les sphères, tube fin pour un cartoon) : c'est ce qui recolle l'ombre
       sur ce qui est dessiné.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_SHADOW_DEFAULTS, rayShadowOptions, rayShadowMaskSize, mat4LookAt, mat4Multiply,
  mat4Orthographic, mat4TransformPoint, boundsOf, boundsBoxOf, boxCornersOf, clipToScreen,
  rasterizeSpheres, shadowMaskOf, softenMask, sampleMaskBilinear, applyShadowToPixels,
  lightDepthScale, lightMatricesOf, shadowRigOf, buildRayShadowMask, atomsFromStage,
  cameraFromViewer, rayShadowInputsOf, shadowImageData, addCastShadowsToBlob, rayShadowNote,
  pcfDiscOf, pcfRotationOf, PROXY_STROKE_BY_TYPE, repTypeOf, proxyRadiusOf, drawnProxyRadiiOf,
} from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, eps, what) => ok(Math.abs(a - b) <= eps, `${what}\n  ${a} vs ${b} (±${eps})`);

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MODULE = readFileSync(new URL('./src/utils/viewerRayShadows.js', import.meta.url), 'utf8');
const RAY = readFileSync(new URL('./src/utils/viewerRayImage.js', import.meta.url), 'utf8');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const hasRay = (needle, what) => ok(RAY.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── 1. LE MODULE EST PUR ──────────────────────────────────────────────── */
ok(!/from ['"][^'"]*ngl/.test(MODULE), 'le module des ombres n’importe PAS ngl : il ne lit que des nombres');
ok(!/useState|useRef|useEffect|React/.test(MODULE), 'aucun état React : le module s’exécute tel quel');
ok(MODULE.includes('decode = null, encode = null'),
  'les deux moitiés du rendu (décoder / encoder) sont INJECTABLES — donc testables hors navigateur');
ok(MODULE.includes("typeof document === 'undefined'"),
  'sans DOM, l’écriture de l’image est gardée au lieu d’exploser');
ok(MODULE.includes('The proxy is drawn from ATOM SPHERES'),
  'le module avoue que le proxy est fait de sphères d’atomes (une ombre de corps, pas un ruban exact)');

/* ── 2. LES OPTIONS ET LA TAILLE DU MASQUE ─────────────────────────────── */
eq(rayShadowOptions({}), { ...RAY_SHADOW_DEFAULTS }, 'sans option, ce sont les valeurs par défaut');
eq(rayShadowOptions({ strength: 5 }).strength, 1, 'une force au-dessus de 1 est ramenée à 1');
eq(rayShadowOptions({ strength: -3 }).strength, 0, '…et en dessous de 0 à 0');
eq(rayShadowOptions({ maskMaxWidth: 10 }).maskMaxWidth, 64, 'un masque ridiculement petit est relevé (jamais < 64)');
const big = rayShadowMaskSize(4800, 2700, {});
eq(big.width, RAY_SHADOW_DEFAULTS.maskMaxWidth, 'le masque est plafonné en largeur');
near(big.width / big.height, 4800 / 2700, 0.01,
  '…en GARDANT le rapport d’aspect de l’image (l’ombre doit tomber sur le bon pixel)');
const small = rayShadowMaskSize(400, 300, {});
eq([small.width, small.height], [400, 300], 'une petite image est masquée à sa propre taille, sans surcoût');
near(small.scale, 1, 1e-9, '…et l’échelle vaut 1');

/* ── 3. LES MATHS ──────────────────────────────────────────────────────── */
const look = mat4LookAt([10, 0, 0], [0, 0, 0], [0, 1, 0]);
const eyeInView = mat4TransformPoint(look, [10, 0, 0]);
for (let i = 0; i < 3; i += 1) near(eyeInView[i], 0, 1e-6, `lookAt met l’œil à l’origine (composante ${i})`);
near(mat4TransformPoint(look, [0, 0, 0])[2], -10, 1e-6, '…et la cible à 10 devant, sur −z');
const ident = mat4Multiply(mat4Orthographic(-1, 1, -1, 1, 0, 1), [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
near(ident[0], 1, 1e-9, 'm[0] = 2/(r−l) de l’orthographique, tel quel');
const scr = clipToScreen([0, 0, 0, 1], 200, 100);
eq([scr[0], scr[1], scr[2]], [100, 50, 0], 'le centre du clip tombe au centre de l’image, y compris vers le BAS');
ok(clipToScreen([0, 0, 0, 0], 200, 100) === null, 'un point derrière l’œil (w = 0) est écarté');
ok(clipToScreen([0, 0, 9, 1], 200, 100) === null, '…et un point hors du frustum aussi');
const bounds = boundsOf(new Float32Array([-1, -1, -1, 1, 1, 1]), 2);
eq(bounds.center, [0, 0, 0], 'la sphère englobante est centrée sur la scène');
near(bounds.radius, Math.sqrt(3), 1e-6, '…et couvre le coin le plus loin');
const lampe = lightMatricesOf({ dir: [0, 0, 1], center: [0, 0, 0], radius: 10, distance: 1000 });
ok(lampe.clip.length === 16 && lampe.view.length === 16, 'la lampe donne view / proj / clip');
near(lightDepthScale({ distance: 1000, radius: 10 }), 2 / (2000 + 20 - 0.01), 1e-9,
  'la profondeur NDC par ångström se déduit du frustum orthographique');

/* ── 4. LE SCÉNARIO : DEUX ATOMES, UNE LAMPE ─────────────────────────────
   A est entre la lampe (+z) et B : la lampe rencontre A en premier, donc B doit
   porter l'ombre de A. C'est LE test de la fonctionnalité. */
const camView = mat4LookAt([10, 0, 0], [0, 0, 0], [0, 1, 0]);
const fov = (50 * Math.PI) / 180;
const nPlane = 0.1;
const fPlane = 100;
const fp = 1 / Math.tan(fov / 2);
const camProj = [
  fp, 0, 0, 0,
  0, fp, 0, 0,
  0, 0, (fPlane + nPlane) / (nPlane - fPlane), -1,
  0, 0, (2 * fPlane * nPlane) / (nPlane - fPlane), 0,
];
const camera = {
  view: camView,
  projection: camProj,
  clip: mat4Multiply(camProj, camView),
  type: 'PerspectiveCamera',
};
const positions = new Float32Array([0, 0, 1, 0, 0, -1]);
const radii = new Float32Array([1, 1]);
const atoms = { positions, radii, count: 2 };
const scene = boundsOf(positions, 2);
const dir = [0, 0, 1];
const light = {
  dir, center: scene.center, radius: scene.radius, distance: scene.radius * 100,
  ...lightMatricesOf({ dir, center: scene.center, radius: scene.radius, distance: scene.radius * 100 }),
};

const shadow = buildRayShadowMask({ atoms, camera, light, width: 128, height: 128, options: { softness: 0 } });
const w = shadow.maskWidth;
const h = shadow.maskHeight;
ok(shadow.mask.length === w * h, 'le masque a la taille annoncée');
ok(shadow.spheres === 2, 'les deux atomes servent de proxy');

/* Où tombent les deux atomes sur l'image, et ce que le masque y dit. */
const pass = rasterizeSpheres({
  positions, radii, count: 2, clip: camera.clip, width: w, height: h,
  axisUp: [0, 1, 0],
});
let idxA = -1;
let idxB = -1;
for (let i = 0; i < w * h; i += 1) {
  if (!pass.hit[i]) continue;
  if (pass.world[i * 3 + 2] > 0) idxA = i; else idxB = i;
}
ok(idxA >= 0 && idxB >= 0, 'les deux atomes ont laissé des pixels (le rasterizer les a vus)');
eq([pass.world[idxA * 3], pass.world[idxA * 3 + 1], pass.world[idxA * 3 + 2]], [0, 0, 1],
  '…et le point du monde gardé est bien le centre de l’atome');
ok(shadow.mask[idxA] < 0.15, 'A, que la lampe voit en premier, est ÉCLAIRÉ');
near(shadow.mask[idxB], 1, 0.35, 'B, derrière A le long de la lampe, est À L’OMBRE');
ok(shadow.shadowed > 0, '…et le compte des pixels ombrés le dit');
/* La pénombre : le test brut donne 0 / 1, le flou donne des valeurs entre les deux. */
const blurred = softenMask(shadow.mask, w, h, 3);
const totalRaw = shadow.mask.reduce((a, v) => a + v, 0);
const totalBlur = blurred.reduce((a, v) => a + v, 0);
near(totalBlur / totalRaw, 1, 0.02, 'le flou CONSERVE la quantité d’ombre (il ne fait que l’étaler)');
ok(blurred.some((v) => v > 0.05 && v < 0.95), '…et il produit bien des valeurs intermédiaires (la pénombre)');

/* L'échantillonnage bilinéaire entre deux texels 0 et 1. */
near(sampleMaskBilinear(Float32Array.from([0, 1]), 2, 1, 0.5, 0.5), 0.5, 1e-6,
  'au milieu de deux texels 0 et 1, la lecture vaut 0,5');
near(sampleMaskBilinear(Float32Array.from([0, 1]), 2, 1, 0, 0), 0, 1e-6,
  '…et au bord gauche, exactement le premier');
near(sampleMaskBilinear(Float32Array.from([0, 1]), 2, 1, 1, 0), 1, 1e-6,
  '…au bord droit, exactement le dernier (jamais un débordement)');

/* ── 5. LA MULTIPLICATION DANS LES PIXELS ──────────────────────────────── */
const px = new Uint8ClampedArray([
  200, 200, 200, 255,
  200, 200, 200, 255,
  200, 200, 200, 255,
  200, 200, 200, 255,
]);
const touched = applyShadowToPixels(px, 4, 1, Float32Array.from([0, 1, 0, 1]), 4, 1, 0.5);
eq(touched, 2, 'seuls les deux pixels ombrés ont été touchés');
eq([px[0], px[4]], [200, 100], 'le pixel à l’ombre tombe à 200 × (1 − 0,5) = 100');
eq(px[3], 255, '…et son canal ALPHA n’est pas touché (un fond transparent reste transparent)');
eq(applyShadowToPixels(px, 1, 1, null, 1, 1, 1), 0, 'sans masque, aucun pixel n’est écrit');
eq(applyShadowToPixels(px, 1, 1, Float32Array.from([1]), 1, 1, 0), 0, 'à force nulle, aucun pixel non plus');

/* La moitié SANS DOM : c'est elle qu'un test peut exécuter. */
const fakeImage = { data: new Uint8ClampedArray([200, 200, 200, 255]), width: 1, height: 1 };
eq(shadowImageData(fakeImage, { mask: Float32Array.from([1]), maskWidth: 1, maskHeight: 1, strength: 1 }), 1,
  'shadowImageData écrit le masque dans une ImageData quelconque');
eq(fakeImage.data[0], 0, '…un pixel pleinement ombré et pleinement foncé devient noir');
eq(shadowImageData(fakeImage, null), 0, 'sans ombre, elle ne fait rien');

/* Le rendu complet : sans navigateur il rend l’image de NGL TELLE QUELLE. */
const blob = { name: 'ray.png' };
const withMask = { mask: Float32Array.from([1]), maskWidth: 1, maskHeight: 1, strength: 0.5, imageWidth: 1, imageHeight: 1 };
ok(await addCastShadowsToBlob(null, { shadow: withMask }) === null, 'sans image, rien à faire');
ok(await addCastShadowsToBlob(blob, {}) === blob, 'sans ombre, l’image est rendue telle quelle');
ok(await addCastShadowsToBlob(blob, { shadow: { mask: null } }) === blob, '…et un masque vide aussi');
ok(await addCastShadowsToBlob(blob, { shadow: { ...withMask, applied: true } }) === blob,
  'une ombre DÉJÀ appliquée n’est jamais appliquée deux fois');
ok(await addCastShadowsToBlob(blob, { shadow: withMask }) === blob,
  'sans navigateur (pas de canvas), la « ray » reste celle que NGL a dessinée — jamais une erreur');

/* ── 6. LA SCÈNE, LUE SUR LE STAGE (lecture seule) ─────────────────────── */
const ident16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moved = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];   // +5 en x
const fakeStage = {
  compList: [
    {
      structure: { getAtomData: () => ({ position: new Float32Array([0, 0, 0, 0, 1, 0]), radius: new Float32Array([1.7, 1.2]) }) },
      matrix: { elements: moved },
    },
    {
      structure: { getAtomData: () => ({ position: new Float32Array([9, 9, 9]), radius: new Float32Array([1]) }) },
      matrix: { elements: ident16 },
      visible: false,
    },
    { structure: null },
    { structure: { getAtomData: () => { throw new Error('boom'); } }, matrix: { elements: ident16 } },
  ],
};
const gathered = atomsFromStage(fakeStage, 1000);
eq(gathered.count, 2, 'deux atomes lus ; l’invisible, le sans-structure et celui qui explode sont écartés');
eq(Array.from(gathered.positions.slice(0, 3)), [5, 0, 0], 'la matrice du composant est appliquée (le « Move X » du viewer)');
near(gathered.radii[1], 1.2, 1e-6, 'le rayon de van der Waals de chaque atome est repris');
eq(gathered.stride, 1, 'sans contrainte, aucun échantillonnage : tous les atomes servent');
const strided = atomsFromStage(fakeStage, 1);
ok(strided.count <= 2 && strided.stride > 1, 'avec un plafond, les atomes sont échantillonnés (jamais des millions de sphères)');
eq(atomsFromStage({ compList: [] }, 10).count, 0, 'un stage vide ne donne aucun atome');

/* ── 6bis. UNE MOLÉCULE CACHÉE NE PROJETTE PLUS RIEN (le rapport) ──────── */
/* « dans les images de ray il y a une image projetée, mais je vois comme une
   membrane projetée alors que la membrane n'est PAS visible dans le programme
   (elle a été cachée) » : les atomes d'une molécule cachée sont toujours dans sa
   Structure, et ce viewer cache une molécule en ne construisant PAS ses
   représentations — le composant, lui, reste `visible`. L'ombre ne lit donc plus
   la structure : elle lit ce qui est DESSINÉ, les `structureView` des
   représentations vivantes. */
const view = (indices) => ({ getAtomIndices: () => Uint32Array.from(indices) });
const repEl = (indices, visible = true) => ({ repr: { visible, structureView: view(indices) } });
const deepStruct = {
  atomCount: 4,
  getAtomData: () => ({
    position: new Float32Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]),
    radius: new Float32Array([1.7, 1.7, 1.7, 1.7]),
  }),
};
const hiddenMolecule = { structure: deepStruct, matrix: { elements: ident16 }, reprList: [] };
eq(atomsFromStage({ compList: [hiddenMolecule] }, 100).count, 0,
  'une molécule cachée (aucune représentation construite) ne projette plus d’ombre — le fantôme du rapport');

const halfHidden = { ...hiddenMolecule, reprList: [repEl([0, 1]), repEl([2, 3], false)] };
const half = atomsFromStage({ compList: [halfHidden] }, 100);
eq(half.count, 2, 'seuls les atomes d’une représentation VISIBLE projettent une ombre');
eq(Array.from(half.positions.slice(0, 3)), [1, 1, 1], '…et ce sont bien les leurs (le StructureView donne les indices)');
eq(half.total, 2, 'le total compte ces atomes-là, donc l’échantillonnage aussi');

const meshOnly = { ...hiddenMolecule, reprList: [{ repr: { visible: true } }] };
eq(atomsFromStage({ compList: [meshOnly] }, 100).count, 0,
  'une représentation sans `structureView` (les plaques de cycles de ce viewer) ne projette rien');

const fullCover = { ...hiddenMolecule, reprList: [repEl([0, 1, 2, 3])] };
eq(atomsFromStage({ compList: [fullCover] }, 100).count, 4,
  'une représentation qui couvre TOUTE la structure rend tous ses atomes (aucun filtre inutile)');

const noRepInfo = { structure: deepStruct, matrix: { elements: ident16 } };
eq(atomsFromStage({ compList: [noRepInfo] }, 100).count, 4,
  'un composant qui ne dit RIEN de ses représentations garde son ancien comportement (jamais de trou)');
ok(MODULE.includes('const drawnAtomIndicesOf = (comp, atomCount) => {'),
  'la lecture « ce qui est dessiné » est une fonction à part, donc lisible et testable');
ok(MODULE.includes('const drawn = drawnAtomIndicesOf(comp, structure.atomCount || n);'),
  '…et c’est ELLE que la collecte des atomes appelle (la cause du fantôme est traitée à la source)');
ok(MODULE.includes('that has been hidden draws nothing, so it casts nothing'),
  'le module documente le rapport : une molécule cachée ne projette plus rien');

const fakeViewer = {
  camera: {
    projectionMatrix: { elements: camProj },
    matrixWorldInverse: { elements: camView },
    type: 'PerspectiveCamera',
  },
};
const cam = cameraFromViewer(fakeViewer);
eq(cam.projection.length, 16, 'la projection de la caméra vivante est reprise TELLE QUELLE (l’ombre tombe sur ses pixels)');
let threw = false;
try { cameraFromViewer(null); } catch { threw = true; }
ok(threw, 'sans caméra, l’ombre refuse de se faire plutôt que de mentir');

const inputs = rayShadowInputsOf({ ...fakeStage, viewer: fakeViewer }, { lightDir: [0, 0, 1] });
eq(inputs.atoms.count, 2, 'rayShadowInputsOf rassemble les atomes');
eq(inputs.light.dir, [0, 0, 1], '…la direction de la lampe du rig');
ok(inputs.light.distance >= inputs.light.radius * 4, '…et une lampe parquée loin (des rayons parallèles)');
threw = false;
try { rayShadowInputsOf({ compList: [], viewer: fakeViewer }, { lightDir: [0, 0, 1] }); } catch { threw = true; }
ok(threw, 'un stage sans atome ne peut pas porter d’ombre');

ok(rayShadowNote({ mask: Float32Array.from([1]), strength: 0.55 }).includes('55%'),
  'la note du message dit la force choisie');
ok(rayShadowNote({ mask: Float32Array.from([1]), strength: 0.5, imageWidth: 4, imageHeight: 1, reachedPixels: 1, spheres: 12 })
  .includes('25% of the pixels'), '…et la part de l’image réellement ombrée');
eq(rayShadowNote(null), '', 'sans ombre, aucune note');
eq(rayShadowNote({}), '', '…ni pour un masque vide');

/* ── 7. LE CÂBLAGE DANS viewerRayImage.js ──────────────────────────────── */
hasRay("from './viewerRayShadows.js'", 'le module des ombres est importé par la « ray » (extension .js comprise : Node l’exécute)');
hasRay('const wantsShadow = options.shadows !== false && !!options.lightDir;',
  'sans option, la « ray » reste le supersampling pur — l’ombre est ADDITIVE');
hasRay('const shadowTooBig = wantsShadow && pixels > shadowBudget;',
  '…et une image au-dessus du budget des ombres n’est JAMAIS décodée / parcourue / ré-encodée : la « ray » revient');
hasRay('inputs = rayShadowInputsOf(stage, {', '…la scène est lue sur le stage');
hasRay('buildRayShadowMask({', '…le masque est construit pour la taille RÉELLE de l’image (factor compris)');
/* ⚠ L’ORDRE EST LA CORRECTION DE LA TACHE DÉTACHÉE (voir §13) : `makeImage` laisse
   la caméra dans le sous-frustum de sa DERNIÈRE tuile, donc le rig se lit avant. */
const readAt = RAY.indexOf('rayShadowInputsOf(stage, {');
const renderAt = RAY.indexOf('await stage.makeImage({');
ok(readAt > 0 && renderAt > 0 && readAt < renderAt,
  'le rig (caméra + atomes) est lu AVANT `stage.makeImage` : la caméra ne peut pas être celle d’une tuile');
hasRay('blob = await addCastShadowsToBlob(blob, { shadow });',
  '…et multiplié dans les pixels que NGL vient d’écrire');
hasRay('catch { shadow = null; }', 'une ombre impossible laisse l’image de NGL, jamais une erreur');
hasRay("shadowNote: shadow ? rayShadowNote(shadow) : (shadowTooBig ? RAY_SHADOW_SKIP_NOTE : '')",
  'le message de la « ray » dit ce que l’ombre a coûté — ou POURQUOI il n’y en a pas');
hasRay('if (status) status(\'✨ Casting the shadows of the still…\');',
  'la seconde moitié du travail se DIT dans le message : c’est le silence qui ressemblait à un rendu bloqué');
ok(!/addRepresentation|removeRepresentation|setParameters/.test(RAY),
  'la « ray » ne touche TOUJOURS pas la scène : aucune rep, aucun paramètre du viewer');

/* ── 8. LE CÂBLAGE DANS LE VIEWER ──────────────────────────────────────── */
has("import { RAY_SHADOW_DEFAULTS } from '../utils/viewerRayShadows';", 'le viewer importe le module des ombres');
has("localStorage.setItem('labViewerRayShadows'", 'le choix est mémorisé, comme le factor et l’alpha');
has('const [rayShadows, setRayShadows] = useState', 'un état propre à l’ombre portée');
has('const [rayShadowStrength, setRayShadowStrength] = useState', '…et une force, elle aussi propre');
has('const lamp = nglKeyLightDirection(shadowAz, shadowEl);',
  'la lampe de l’ombre est CELLE DU RIG ◐ Shadows (Azimuth / Élévation)');
has('lightDir: [lamp.x, lamp.y, lamp.z],', '…passée au module en clair');
has('shadow: { strength: rayShadowStrength },', '…avec la force choisie dans la barre');
has('shadows: rayShadows,', '…et la case qui active l’ombre');
has('◐ shadows', 'la case porte le nom de l’ombre portée');
has('title={`Darkness of the cast shadow — ${Math.round(rayShadowStrength * 100)} %',
  '…et son curseur dit la force en pour-cent');
has("${out.shadowNote ? ` ${out.shadowNote}` : ''}", 'le message final dit que l’ombre est DANS le fichier');
has('⬚ alpha', 'la case du fond transparent n’a pas bougé (rien n’a été déplacé)');
has("window.addEventListener('resize', refresh);", 'le sélecteur de résolution est toujours rafraîchi avec la toile');

/* L'ADDITIVITÉ — le point le plus important de la demande du 📷. */
const bodyOf = (name) => {
  const start = VIEW.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} introuvable dans la source`);
  let depth = 0;
  for (let i = start; i < VIEW.length; i += 1) {
    const c = VIEW[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return VIEW.slice(start, i + 1);
  }
  throw new Error(`${name} : instruction non terminée`);
};
const rayBody = bodyOf('captureRay');
ok(!rayBody.includes('publishLibraryFigure'),
  '✨ Ray n’écrit toujours PAS dans la bibliothèque de figures (l’ombre ne change pas la destination)');
ok(rayBody.includes('nglKeyLightDirection(shadowAz, shadowEl)'),
  '…et la lampe est lue AU MOMENT du clic : elle suit les curseurs du rig ◐ Shadows');
ok(rayBody.includes('rayShadowStrength'), '…avec la force du moment');
ok(!rayBody.includes('addRepresentation') && !rayBody.includes('removeRepresentation'),
  'aucune représentation n’est ajoutée pour porter l’ombre : la scène n’est pas touchée');
ok(rayBody.includes('onStatus: (text) => {'),
  '…et l’attente des ombres est ANNONCÉE dans le message (plus de rendu silencieux)');
/* LE 📷 FIGURE N’EXISTE PLUS (la demande : « il pulsante figure é ridondante ») :
   le test qui gardait son handler est devenu le test de son DÉPART. */
ok(!VIEW.includes('const captureScene = async () => {'), 'le gestionnaire du 📷 a quitté le viewer');
ok(!VIEW.includes('📷 Figure — the high'), '…et son bouton avec lui');
has('const captureRay = async () => {', '✨ Ray reste le SEUL export d’image de la scène');

/* ── 9. LE RIG : LA CAMÉRA D’OMBRE AJUSTÉE À LA MOLÉCULE ──────────────────
   La demande : remplacer l’ombre « plate et détachée » par un rig à la PyMOL,
   dont la caméra d’ombre est AJUSTÉE aux bornes de la molécule. La propriété qui
   décide de tout se vérifie : les HUIT coins de la boîte de la molécule tombent
   DANS le frustum (aucun atome n’est oublié), les bords du frustum les TOUCHENT
   (aucun pixel payé pour du vide) et sa profondeur est celle de la molécule —
   plus les 2000 Å du cube autour de la sphère englobante. */
const molBox = boundsBoxOf(new Float32Array([-1, -2, -0.5, 1, 2, 0.5]), 2);
eq(molBox.min, [-1, -2, -0.5], 'la boîte de la molécule : ses minima');
eq(molBox.max, [1, 2, 0.5], '…et ses maxima (c’est ELLE que la caméra d’ombre couvre)');
const molCorners = boxCornersOf(molBox);
eq(molCorners.length, 8, 'une boîte a huit coins');
ok(molCorners.every((c) => c[0] >= -1 && c[0] <= 1 && c[1] >= -2 && c[1] <= 2 && c[2] >= -0.5 && c[2] <= 0.5),
  '…et ce sont bien les coins de la molécule');
const LAMPS = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 0.7], [0, -0.9, 0.436], [-0.3, 0.4, -0.86]];
LAMPS.forEach((dir) => {
  const rig = shadowRigOf({ dir, bounds: molBox, distance: 1000 });
  const ndc = molCorners.map((c) => mat4TransformPoint(rig.clip, c));
  ok(ndc.every((p) => Math.abs(p[0] / p[3]) <= 1.001 && Math.abs(p[1] / p[3]) <= 1.001 && Math.abs(p[2] / p[3]) <= 1.001),
    `le frustum ajusté CONTIENT toute la molécule (lampe ${dir.join(',')})`);
  ok(rig.far - rig.near < 100,
    `…et sa profondeur est celle de la molécule (${(rig.far - rig.near).toFixed(2)} Å), pas celle de l’espace`);
});
const tightRig = shadowRigOf({ dir: [0, 0, 1], bounds: molBox, distance: 1000 });
const tightNdc = molCorners.map((c) => {
  const p = mat4TransformPoint(tightRig.clip, c);
  return [Math.abs(p[0] / p[3]), Math.abs(p[1] / p[3])];
});
near(Math.max(...tightNdc.map((p) => p[0])), 1 / RAY_SHADOW_DEFAULTS.fitMargin, 0.01,
  'le frustum est SERRÉ : le bord de la boîte touche le bord du frustum à fitMargin près');
ok(Math.max(...tightNdc.map((p) => p[1])) > 0.9, '…et l’autre axe le touche aussi (aucun gaspillage)');
ok(Math.abs(tightRig.width * tightRig.height - 8 * RAY_SHADOW_DEFAULTS.fitMargin ** 2) < 0.9,
  '…la surface du frustum est celle de la boîte, plus la marge — rien d’autre');
/* Sans boîte (un appelant qui ne connaît qu’une sphère), le repli reste serré. */
const sphereRig = lightMatricesOf({ dir: [0, 0, 1], center: [0, 0, 0], radius: 10, distance: 1000 });
near(sphereRig.right, 10 * RAY_SHADOW_DEFAULTS.fitMargin, 1e-6,
  'sans boîte, la sphère donne un carré de son rayon (± fitMargin)');
ok(sphereRig.far - sphereRig.near < 30,
  '…et une profondeur de scène, plus les 2000 Å de l’ancien cube autour de la sphère englobante');
ok(inputs.light.bounds && inputs.light.width > 0.5,
  'rayShadowInputsOf passe la BOÎTE de la molécule à la caméra d’ombre (le rig est branché)');
ok(rayShadowNote({ mask: Float32Array.from([1]), strength: 0.5, rig: { width: 42.4, height: 38.1 } })
  .includes('rig 42×38 Å'), '…et la note du message dit la taille de ce que la caméra couvre');

/* ── 10. LA PÉNOMBRE : PCF PUIS PCSS ──────────────────────────────────────
   Une shadow map donne UNE profondeur par texel : la douceur vient d’un DISQUE
   d’échantillons autour du receveur (PCF), dont le rayon grandit avec l’écart
   entre le receveur et l’occulteur (PCSS). La carte d’ombre est FABRIQUÉE À LA
   MAIN ici — un mur occupe la moitié droite, le receveur est à deux pixels du
   bord — donc les valeurs attendues se CALCULENT. La caméra est uniforme (tous
   ses pixels portent le même point du monde) pour que le flou de pénombre ne
   dilue pas la valeur mesurée. */
const mapW = 32;
const mapH = 32;
const wallDepth = new Float32Array(mapW * mapH).fill(2);       // 2 = « la lampe n’a rien vu »
for (let y = 0; y < mapH; y += 1) {
  for (let x = 16; x < mapW; x += 1) wallDepth[y * mapW + x] = 0.5;
}
const wallClip = mat4Orthographic(-1, 1, -1, 1, 0, 2);         // monde [-1,1]² → NDC ; z = −2 → +1
const shadowAt = (world, options) => {
  const n = mapW * mapH;
  const camera = { hit: new Uint8Array(n).fill(1), world: new Float32Array(n * 3) };
  for (let i = 0; i < n; i += 1) {
    camera.world[i * 3] = world[0];
    camera.world[i * 3 + 1] = world[1];
    camera.world[i * 3 + 2] = world[2];
  }
  return shadowMaskOf({
    camera,
    light: { clip: wallClip, depth: wallDepth },
    width: mapW, height: mapH,
    biasNdc: 0, depthScale: 1,
    ...options,
  });
};
/* Deux pixels AVANT le bord du mur, mais bien DERRIÈRE lui (z = −1,95 → la
   profondeur NDC vaut 0,95, le mur est à 0,5). */
const atEdge = [-0.125, 0, -1.95];
eq(shadowAt(atEdge, { softness: 0 }).mask[0], 0,
  'la shadow map dure : à 2 px du bord du mur, le receveur est ÉCLAIRÉ');
const softEdge = shadowAt(atEdge, { softness: 4, taps: 8, penumbra: 0, penumbraMax: 8 });
ok(softEdge.mask[0] > 0.05 && softEdge.mask[0] < 0.95,
  `le disque PCF le rend PARTIELLEMENT ombré (${softEdge.mask[0].toFixed(2)}) : une pénombre, pas une marche`);
eq(softEdge.taps, 8, '…avec les 8 échantillons demandés');
near(softEdge.penumbraRadius, 4, 1e-9, '…et le disque garde le rayon demandé quand l’écart est nul');
/* DANS le mur, 0,45 Å derrière lui : le rayon grandit de `penumbra` par ångström
   d’écart (PCSS) — une ombre de contact reste nette, une ombre portée s’étale. */
const inWall = [0.125, 0, -1.95];
const growOff = shadowAt(inWall, { softness: 4, taps: 8, penumbra: 0, penumbraMax: 12 });
const growOn = shadowAt(inWall, { softness: 4, taps: 8, penumbra: 3, penumbraMax: 12 });
near(growOff.penumbraRadius, 4, 1e-9, 'sans PCSS, le disque garde le rayon demandé (softness)');
near(growOn.penumbraRadius, 4 + 3 * (0.95 - 0.5), 1e-6,
  '…et avec PCSS il grandit de penumbra × l’écart receveur / occulteur');
eq(shadowAt(inWall, { softness: 0 }).mask[0], 1, 'un receveur derrière le mur est pleinement ombré (test dur)');
ok(growOn.mask[0] < 1 && growOn.mask[0] > 0.3,
  '…mais un disque large voit la lumière qui frôle le bord du mur : c’est la pénombre');
/* Le disque lui-même, et sa rotation par pixel. */
const disc8 = pcfDiscOf(8);
eq(disc8.length, 16, 'un disque de 8 échantillons = 8 offsets (x, y)');
let inDisc = true;
for (let i = 0; i < 8; i += 1) if (Math.hypot(disc8[i * 2], disc8[i * 2 + 1]) > 1.0001) inDisc = false;
ok(inDisc, '…tous dans le disque unité (c’est le rayon de pénombre qui les met à l’échelle)');
eq(Array.from(pcfDiscOf(1)), [0, 0], 'un seul échantillon = le centre : le test dur d’une shadow map ordinaire');
const discAngle = pcfRotationOf(3, 7);
ok(discAngle >= 0 && discAngle < Math.PI * 2, 'la rotation du disque est un angle');
eq(pcfRotationOf(3, 7), discAngle, '…le même pour un même pixel (deux rendus donnent la même image)');
ok(pcfRotationOf(4, 7) !== discAngle, '…et différent du voisin : les échantillons ne font pas de rayures');

/* ── 11. L’ÉPAISSEUR DU PROXY SUIT LE TRAIT DE LA REPRÉSENTATION ──────────
   La cause n° 1 de l’ombre « plate et détachée » : chaque atome donnait une
   sphère de van der Waals de 1,7 Å même quand le dessin était un ruban de
   quelques dixièmes d’ångström — le volume d’ombre faisait plusieurs fois
   l’épaisseur du ruban, et le ruban s’assombrissait là où le VRAI ruban était
   éclairé. Le proxy (qui REÇOIT et qui PROJETTE) suit donc le trait. */
eq(proxyRadiusOf({ parameters: { type: 'spacefill' } }, 1.7), 1.7,
  'spacefill : la bille EST le rayon de van der Waals');
eq(proxyRadiusOf({ parameters: { type: 'sphere', scale: 0.6 } }, 1.7), 1.7 * 0.6,
  'sphere : « set sphere_scale, 0.6 » réduit le proxy comme il réduit le dessin');
eq(proxyRadiusOf({ parameters: { type: 'sphere', radius: 2.4 } }, 1.7), 2.4,
  '…et un rayon numérique l’emporte sur le rayon de van der Waals');
eq(proxyRadiusOf({ parameters: { type: 'ball+stick' } }, 1.7), 0.3,
  'ball+stick : la petite bille d’atome d’NGL (aspectRatio 2 × radiusSize 0,15 Å), pas la grosse sphère');
near(proxyRadiusOf({ parameters: { type: 'cartoon' } }, 1.7), 0.45, 1e-9,
  'cartoon : un tube fin, et surtout PAS 1,7 Å');
near(proxyRadiusOf({ parameters: { type: 'cartoon', radius: 0.8 } }, 1.7), 0.8, 1e-9,
  '…et le rayon de cartoon demandé est suivi');
near(proxyRadiusOf({ parameters: { type: 'licorice', radius: 0.4 } }, 1.7), 0.4, 1e-9,
  'licorice : le rayon du bâton');
eq(proxyRadiusOf({ parameters: { type: 'martini' } }, 1.7), null,
  'une représentation inconnue ne dit RIEN (le rayon de van der Waals est gardé)');
eq(proxyRadiusOf({}, 1.7), null, '…et une représentation sans paramètres non plus');
eq(PROXY_STROKE_BY_TYPE.spacefill.kind, 'vdw',
  'la table dit la NATURE du trait : une bille pleine se mesure en rayons de van der Waals');
eq(PROXY_STROKE_BY_TYPE.cartoon.kind, 'spline',
  '…et un ruban en unités de `radiusScale`, pas en rayons de van der Waals');
/* LE TUBE. La demande : « je voulais changer la représentation tube, parce que ce
   n’est pas un tube : pour moi un tube a une section SPHÉRIQUE, qu’on règle en
   changeant le rayon ». NGL’s TubeRepresentation est exactement cela (la spline du
   cartoon avec `aspectRatio: 1`), et son rayon est UNE valeur en ångströms —
   `radius`, que NGL convertit en radiusType 'size' + radiusSize. Le proxy d’un
   tube est donc ce rayon, tel quel : le tuyau que l’utilisateur règle est le
   tuyau de l’ombre. */
near(proxyRadiusOf({ type: 'tube', radiusType: 'size', radiusSize: 0.5, radius: 0.5 }, 1.7), 0.5, 1e-9,
  'tube : le proxy EST le rayon du tuyau (0,5 Å = le `cartoon_tube_radius` de PyMOL), jamais 1,7 Å');
near(proxyRadiusOf({ type: 'tube', radiusType: 'size', radiusSize: 1.5 }, 1.7), 1.5, 1e-9,
  '…et un tube réglé plus épais projette exactement ce qu’il dessine');
near(proxyRadiusOf({ type: 'tube', radiusType: 'sstruc', radiusScale: 1.5 }, 1.7), 0.75, 1e-9,
  'un tube qui mesure son rayon autrement garde une ligne de base fine (base 0,5 × radiusScale), jamais une bille');
eq(PROXY_STROKE_BY_TYPE.tube.kind, 'tube',
  '…et la table lui donne sa propre nature : un tuyau à section ronde, en ångströms');

const cartoonRep = { parameters: { type: 'cartoon' }, structureView: view([0, 1]) };
const ballRep = { parameters: { type: 'spacefill' }, structureView: view([1, 2]) };
const perAtom = drawnProxyRadiiOf({ reprList: [{ repr: cartoonRep }, { repr: ballRep }] }, 4,
  new Float32Array([1.7, 1.2, 1.5, 1.1]));
near(perAtom[0], 0.45, 1e-6, 'un atome dessiné par le seul cartoon projette le trait du cartoon');
near(perAtom[1], 1.2, 1e-6, 'un atome dessiné par les DEUX garde le dessin le PLUS ÉPAIS (la sphère)');
near(perAtom[2], 1.5, 1e-6, '…et un atome en sphères garde son rayon de van der Waals');
ok(Number.isNaN(perAtom[3]), 'un atome que rien ne dessine n’a aucun proxy');
eq(drawnProxyRadiiOf({ structure: {} }, 3, new Float32Array([1.7, 1.7, 1.7])), null,
  'une composition sans reprList ne dit RIEN (le rayon de van der Waals est gardé, comme avant)');
ok(Number.isNaN(drawnProxyRadiiOf(
  { reprList: [{ repr: { ...cartoonRep, visible: false } }] }, 1, new Float32Array([1.7]),
)[0]), 'une représentation cachée ne donne aucun proxy');
/* Et de bout en bout : le ruban pèse 0,45 Å, pas 1,7 Å. */
const ribbonStage = {
  compList: [{
    structure: {
      atomCount: 4,
      getAtomData: () => ({
        position: new Float32Array([0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0]),
        radius: new Float32Array([1.7, 1.7, 1.7, 1.7]),
      }),
    },
    matrix: { elements: ident16 },
    reprList: [{ repr: cartoonRep }],
  }],
};
const ribbon = atomsFromStage(ribbonStage, 100);
eq(ribbon.count, 2, 'seuls les atomes DESSINÉS sont lus (les deux autres ne sont dessinés par rien)');
near(ribbon.radii[0], 0.45, 1e-6, '…et leur proxy a l’épaisseur du RUBAN, plus celle d’une sphère de van der Waals');
near(ribbon.radii[1], 0.45, 1e-6, '…pour chaque atome du ruban');

/* ── 11bis. LA VRAIE FORME D’UNE REPRÉSENTATION NGL — LE BUG QUI RENDAIT LE ──
   CORRECTIF INVISIBLE DANS L’APPLICATION
   Le rapport : « je ne vois aucun changement : l’ombre est toujours loin et
   détachée de la molécule ». La table de traits ne se déclenchait JAMAIS en vrai :
   elle lisait `rep.parameters.type` et `rep.parameters.radius`, alors qu’une
   Representation de ngl 2.4 garde ses VALEURS sur l’INSTANCE (`this.type`,
   `this.radiusScale`, `this.radiusSize`, `this.aspectRatio`) et ne met dans
   `parameters` que les DESCRIPTEURS de ces valeurs
   (`radiusScale: { type: 'number', … }`) — aucun `type` là-dedans.
   `Number({ type: 'number' })` vaut NaN : toute représentation réelle était
   « inconnue », chaque atome gardait sa sphère de van der Waals de 1,7 Å et
   l’ombre restait la grosse tache détachée d’avant. Les cas ci-dessous prennent la
   forme EXACTE que ngl 2.4 produit (component.ts : `addRepresentation` renvoie un
   RepresentationElement et `reprList` contient CES éléments ;
   representation-element.ts : `name = repr.type`, `getType() = this.repr.type`,
   et son propre `type` est la constante 'representation'). */
const realElement = (type, repr, params = {}) => ({
  name: type,                        // RepresentationElement#name = repr.type
  getType: () => type,               // …et son getType() dit la même chose
  type: 'representation',            // la constante d’un ÉLÉMENT, pas un type de trait
  parameters: { visible: true, ...params },
  repr,
});
// Une Representation telle que ngl 2.4 la construit : les valeurs sur l’instance,
// les descripteurs dans `parameters` (aucun `type`).
const realRep = (type, values = {}, descriptors = {}) => ({
  type,
  parameters: {
    radiusScale: { type: 'number', precision: 3, max: 10, min: 0.001 },
    radiusSize: { type: 'number', precision: 3, max: 10, min: 0.001 },
    ...descriptors,
  },
  ...values,
});
eq(repTypeOf(realRep('cartoon'), realElement('cartoon', realRep('cartoon'))), 'cartoon',
  'le type se lit sur la représentation (`rep.type`)');
eq(repTypeOf({}, { name: 'licorice' }), 'licorice',
  '…ou sur le `name` de l’élément (ce que NGL y met : `repr.type`)');
eq(repTypeOf({}, { getType: () => 'tube' }), 'tube', '…ou sur son getType()');
eq(repTypeOf({ parameters: { type: 'spacefill' } }), 'spacefill',
  '…et l’ancien `parameters.type` d’un objet fabriqué à la main reste accepté en dernier');

// Le ruban : `radiusScale` 0,7 EST la valeur par défaut d’NGL pour un cartoon, donc
// la ligne de base de la table — et surtout PAS le rayon de van der Waals.
near(proxyRadiusOf(realRep('cartoon', { radiusScale: 0.7, radiusType: 'sstruc' }), 1.7,
  realElement('cartoon', realRep('cartoon'))), 0.45, 1e-9,
  'une VRAIE représentation cartoon donne le trait du ruban (0,45 Å), plus une sphère de 1,7 Å');
ok(proxyRadiusOf(realRep('cartoon', { radiusScale: 0.7 }), 1.7) < 1.7 / 2,
  '…et le proxy reste très en dessous du rayon de van der Waals de l’atome');
near(proxyRadiusOf(realRep('cartoon', { radiusScale: 1.4 }), 1.7), 0.9, 1e-9,
  'un ruban dessiné deux fois plus épais projette une ombre deux fois plus épaisse');
near(proxyRadiusOf(realRep('spacefill', { radiusType: 'vdw', radiusScale: 0.6 }), 1.7), 1.7 * 0.6, 1e-9,
  'spacefill : `radiusScale` d’NGL (le curseur « Sphere radius » des menus) suit le dessin');
near(proxyRadiusOf(realRep('spacefill', { radiusType: 'size', radiusSize: 0.6 }), 1.7), 0.6, 1e-9,
  '…et `radiusType: size` donne un rayon en ångströms, comme `setRadius(0,6)`');
near(proxyRadiusOf(realRep('licorice', { radiusType: 'size', radiusSize: 0.25 }), 1.7), 0.25, 1e-9,
  'licorice : le proxy EST le `radiusSize` du bâton (0,25 Å dans ce viewer)');
near(proxyRadiusOf(realRep('ball+stick', { radiusType: 'size', radiusSize: 0.15, aspectRatio: 1.1 }),
  1.7), 0.2, 1e-9,
  'ball+stick : la bille vaut aspectRatio × radiusSize (0,165 Å), planchée à 0,2 Å');
eq(PROXY_STROKE_BY_TYPE[repTypeOf(realRep('licorice'), realElement('licorice', realRep('licorice')))].kind,
  'bond', '…et c’est bien la table des traits qui répond à une représentation réelle');

/* La régression de bout en bout : un élément RÉEL dans `reprList` — descripteurs
   dans `parameters`, aucune trace de `type` — doit donner le trait du ruban, et
   pas 1,7 Å. C’est exactement le cas qui échouait dans l’application, y compris
   quand une SEULE représentation dessine TOUS les atomes (le cas courant : un
   cartoon sur toute la chaîne). */
const realCartoonRep = {
  ...realRep('cartoon', { radiusScale: 0.7, radiusType: 'sstruc' }),
  visible: true,
  structureView: view([0, 1]),
};
const realCartoonEl = realElement('cartoon', realCartoonRep);
const realPerAtom = drawnProxyRadiiOf({ reprList: [realCartoonEl] }, 2, new Float32Array([1.7, 1.7]));
near(realPerAtom[0], 0.45, 1e-6,
  'un élément NGL réel (name = cartoon, parameters = DESCRIPTEURS) projette le trait du ruban');
near(realPerAtom[1], 0.45, 1e-6, '…pour chacun des atomes que sa StructureView dessine');

const realStage = {
  compList: [{
    structure: {
      atomCount: 2,
      getAtomData: () => ({
        position: new Float32Array([0, 0, 0, 0, 1.5, 0]),
        radius: new Float32Array([1.7, 1.7]),
      }),
    },
    matrix: { elements: ident16 },
    reprList: [realCartoonEl],
  }],
};
const realRibbon = atomsFromStage(realStage, 100);
eq(realRibbon.count, 2, 'une représentation qui couvre TOUTE la structure dessine bien tous ses atomes');
near(realRibbon.radii[0], 0.45, 1e-6,
  'de bout en bout : un vrai cartoon donne des proxies de 0,45 Å — l’ombre colle au ruban');
near(realRibbon.radii[1], 0.45, 1e-6, '…et non des sphères de van der Waals de 1,7 Å');

/* ── 13. LA CAMÉRA D’UN « RAY » EN COURS DE RENDU — LE VRAI BUG DE LA TACHE ──
   « je ne vois aucun changement : l’ombre est toujours loin et détachée ». Les
   proxies n’étaient pas seuls en cause : la caméra avec laquelle le masque était
   construit n’était plus celle de la molécule. `Stage.makeImage` rend la « ray »
   TUILE PAR TUILE et pousse la caméra dans le sous-frustum de chaque tuile
   (`camera.setViewOffset(fullWidth, fullHeight, offsetX, offsetY, w, h)`), puis
   `_finalize()` remet `camera.view` à null SANS appeler `updateProjectionMatrix()` :
   la matrice de projection reste celle de la DERNIÈRE tuile jusqu’au rendu suivant.
   Un masque lu là-dessus est le masque d’une fenêtre 1/n × 1/n de l’image — grossi
   n× (n = le facteur, doublé par la passe antialias) et jeté dans le coin de cette
   tuile : la tache détachée, dans TOUTES les directions de lampe et quel que soit
   le poids des proxies. D’où les deux pièces ci-dessous : le rig se lit AVANT la
   « ray » (voir captureRayImage) et `cameraFromViewer` REFUSE une caméra restée
   dans une tuile. */
const NGLJS = readFileSync(new URL('./node_modules/ngl/dist/ngl.js', import.meta.url), 'utf8');
ok(NGLJS.includes('.camera.setViewOffset('),
  'le NGL livré met bien la caméra dans le sous-frustum de chaque tuile (TiledRenderer._renderTile)');
ok(NGLJS.includes('this._viewer.camera.view=null'),
  '…et `_finalize()` la laisse dedans : il remet `view` à null SANS updateProjectionMatrix');
ok(NGLJS.includes('this._width=this._viewer.width,this._height=this._viewer.height'),
  '…la taille rendue étant `viewer.width × factor` (le canevas est le drawing buffer, devicePixelRatio × plus grand)');

// La transformation NDC d’une tuile (i, j) d’une grille n × n : celle que
// setViewOffset installe (linéaire en NDC, dont x' = n·x + n − 2i − 1).
const tileNdc = (n, i, j) => [n, 0, 0, 0, 0, n, 0, 0, 0, 0, 1, 0, n - 2 * i - 1, 2 * j + 1 - n, 0, 1];
const staleCamera = { ...camera, clip: mat4Multiply(tileNdc(2, 1, 1), camera.clip) };
const cleanPx = clipToScreen(mat4TransformPoint(camera.clip, [0, 0, 1, 1]), 128, 128);
const stalePx = clipToScreen(mat4TransformPoint(staleCamera.clip, [0, 0, 1, 1]), 128, 128);
near(stalePx[0], 2 * cleanPx[0] - 128, 1e-6,
  'la dernière tuile d’une grille 2 × 2 grossit la scène 2× et la décale d’une demi-image en x');
near(stalePx[1], 2 * cleanPx[1] - 128, 1e-6,
  '…et d’autant en y : la tache DÉTACHÉE, dans n’importe quelle direction de lampe');

const bboxOf = (mask, w, h) => {
  let count = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!(mask[y * w + x] > 0.002)) continue;
      count += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { count, cx: (x0 + x1) / 2 / w, cy: (y0 + y1) / 2 / h };
};
const cleanMask = buildRayShadowMask({ atoms, camera, light, width: 128, height: 128, options: { softness: 0 } });
const staleMask = buildRayShadowMask({ atoms, camera: staleCamera, light, width: 128, height: 128, options: { softness: 0 } });
const cleanBox = bboxOf(cleanMask.mask, cleanMask.maskWidth, cleanMask.maskHeight);
const staleBox = bboxOf(staleMask.mask, staleMask.maskWidth, staleMask.maskHeight);
ok(cleanBox.count > 0 && staleBox.count > 0,
  'les deux masques ombrent bien quelque chose (deux ombres réelles sont comparées)');
ok(Math.abs(staleBox.cx - cleanBox.cx) > 0.25 || Math.abs(staleBox.cy - cleanBox.cy) > 0.25,
  `la tache de la caméra restée dans la tuile est DÉTACHÉE : centre ${staleBox.cx.toFixed(2)}/${staleBox.cy.toFixed(2)} contre ${cleanBox.cx.toFixed(2)}/${cleanBox.cy.toFixed(2)} sur la molécule`);
ok(staleBox.count > cleanBox.count * 1.5,
  '…et elle est plus GROSSE : le sous-frustum la magnifie (la « grosse tache » du rapport)');

// Le garde-fou : une caméra en pleine tuile est refusée, jamais lue en silence.
const throws = (fn, re, what) => {
  let msg = null;
  try { fn(); } catch (e) { msg = String((e && e.message) || e); }
  assert.ok(msg !== null, `${what}\n  aucune erreur levée`);
  assert.ok(re.test(msg), `${what}\n  message : ${msg}`);
  passed += 1;
};
const bareCamera = {
  projectionMatrix: { elements: camProj },
  matrixWorldInverse: { elements: camView },
  type: 'PerspectiveCamera',
};
eq(cameraFromViewer({ camera: bareCamera }).clip.length, 16,
  'une caméra au repos donne ses deux matrices (le cas normal)');
throws(() => cameraFromViewer({ camera: { ...bareCamera, view: { fullWidth: 4, fullHeight: 4 } } }),
  /inside a tile/, 'une caméra restée dans une tuile est REFUSÉE — jamais un masque faux en silence');

/* ── 12. CE QUE LE MODULE DIT DE LUI-MÊME ──────────────────────────────── */
ok(MODULE.includes('THE SHADOW CAMERA'), 'le module décrit sa caméra d’ombre ajustée (shadowRigOf)');
ok(MODULE.includes('PCSS'), '…la pénombre PCF élargie par l’écart receveur / occulteur (PCSS)');
ok(MODULE.includes('PROXY_STROKE_BY_TYPE'), '…et la table des épaisseurs de trait des représentations');
ok(MODULE.includes('SELF-SHADOWING ON THE MOLECULE ITSELF'),
  '…et l’auto-ombrage de la molécule : le receveur est la surface elle-même');
ok(MODULE.includes('WHAT A SHADOW CANNOT DO IN NGL 2.4'),
  '…en disant honnêtement ce que NGL 2.4 ne peut pas faire (aucune shadow map dans la toile interactive)');

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_ray_shadows_test.mjs — ${passed} assertions OK (ombres portées)`);
