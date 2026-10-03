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
    8. LA MOLÉCULE N'EST PAS À L'ORIGINE. La caméra de NGL ne bouge jamais : elle
       est parquée à z = −80 et regarde l'ORIGINE de la scène, et c'est la
       molécule qui est déplacée sous elle par deux groupes du viewer
       (`rotationGroup` du clic, `translationGroup` du recentrage). Un proxy placé
       avec le seul `component.matrix` tombe donc À CÔTÉ dès qu'un `autoView` a
       recentré la molécule — la « tache plate » des rapports, et, hors frustum,
       aucune ombre du tout (§15).
    9. LA CAMÉRA APRÈS UNE PASSE DE SUPER-ÉCHANTILLONNAGE porte un `view.enabled`
       à false pour toujours (three ne retire jamais l'objet : `clearViewOffset()`
       ne fait que le désactiver). Refuser la caméra sur la simple présence de
       `view` refusait TOUTES les caméras vivantes de l'application, et l'erreur
       était avalée en silence : la « ray » revenait sans ombre et sans un mot.
       Le message DIT désormais pourquoi (§13 bis, §16).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_SHADOW_DEFAULTS, rayShadowOptions, rayShadowMaskSize, mat4LookAt, mat4Multiply,
  mat4Orthographic, mat4TransformPoint, boundsOf, boundsBoxOf, boxCornersOf, clipToScreen,
  rasterizeSpheres, shadowMaskOf, softenMask, sampleMaskBilinear, applyShadowToPixels,
  lightDepthScale, lightMatricesOf, shadowRigOf, buildRayShadowMask, atomsFromStage,
  cameraFromViewer, viewerMatrixOf, rayShadowInputsOf, shadowImageData, addCastShadowsToBlob, rayShadowNote,
  pcfDiscOf, pcfRotationOf, PROXY_STROKE_BY_TYPE, repTypeOf, proxyRadiusOf, proxyRadiiOf,
  drawnProxyRadiiOf, capsuleRadiiOf, STROKE_FLOOR, unionBoxOf,
  opacityOf, INVISIBLE_OPACITY, IMPOSTOR_TYPES, compactAttribute, trianglesOfGeometry,
  worldTrianglesOf, viewAxesOf, expandBoxOf, rasterizeCapsules, rasterizeTriangles,
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
ok(MODULE.includes('a SPHERE per atom and a CAPSULE per bond, ANALYTIC'),
  'le module dit ce que le proxy est vraiment : une bille par atome, une capsule par liaison — un tuyau continu, pas une poussière de billes');
ok(MODULE.includes('LINKED_KINDS') && MODULE.includes('rasterizeCapsules'),
  '…et il nomme les deux moitiés de l’ombre d’un dessin fin : la capsule qui bouche le lien, et le rasterizer qui la dessine');
ok(MODULE.includes('a buffer with normals is a surface'),
  '…avec le discriminant MESURÉ des surfaces : un tampon qui porte des normales est une surface, un tampon sans normales est un imposteur');

/* ── 2. LES OPTIONS ET LA TAILLE DU MASQUE ─────────────────────────────── */
eq(rayShadowOptions({}), { ...RAY_SHADOW_DEFAULTS }, 'sans option, ce sont les valeurs par défaut');
eq(rayShadowOptions({ strength: 5 }).strength, 1, 'une force au-dessus de 1 est ramenée à 1');
eq(rayShadowOptions({ strength: -3 }).strength, 0, '…et en dessous de 0 à 0');
/* LA DOUCEUR DU CONTOUR (le curseur « blur » de la barre, à côté de la noirceur) :
   un MULTIPLICATEUR des trois réglages de pénombre — la noirceur, elle, ne bouge
   pas, et à 1 RIEN ne change (aucun rendu existant n'est modifié). */
eq([rayShadowOptions({ blur: 1 }).softness, rayShadowOptions({ blur: 1 }).penumbra],
  [RAY_SHADOW_DEFAULTS.softness, RAY_SHADOW_DEFAULTS.penumbra],
  'blur = 1 rend EXACTEMENT les valeurs d’avant (aucune image ne change)');
eq(rayShadowOptions({ blur: 2 }).softness, RAY_SHADOW_DEFAULTS.softness * 2,
  'blur = 2 élargit la pénombre (le disque PCF, donc le contour de l’ombre)');
eq(rayShadowOptions({ blur: 0 }).softness, 0,
  'blur = 0 donne un contour net (l’ombre dure d’une simple carte d’ombre)');
eq(rayShadowOptions({ blur: 99 }).blur, 4, 'un blur démesuré est ramené à son maximum (4)');
eq(rayShadowOptions({ blur: 2, softness: 3 }).softness, 3,
  'un `softness` donné en clair garde la main sur le curseur (le module reste seul maître de ses réglages)');
eq(rayShadowOptions({ blur: 2 }).strength, RAY_SHADOW_DEFAULTS.strength,
  'le blur ne touche PAS la noirceur : les deux curseurs sont indépendants');
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
const positions = new Float32Array([0, 0, 2, 0, 0, -1]);
/* A est une GROSSE bille (2 Å) et B une petite (0,5 Å) : l'ombre de A couvre
   largement B, donc la mesure ne dépend pas d'un pixel pris sur une silhouette. */
const radii = new Float32Array([2, 0.5]);
const atoms = { positions, radii, count: 2 };
const dir = [0, 0, 1];
const light = {
  dir, distance: 100,
  ...lightMatricesOf({
    dir,
    /* ⚠ LA BOÎTE CONTIENT LES SOLIDES, PAS SEULEMENT LEURS CENTRES (expandBoxOf) :
       sans elle, la calotte AVANT de A tombait hors du frustum de la lampe — un
       occluteur que la lampe n'a pas rasterisé est une ombre qui disparaît. */
    bounds: expandBoxOf(boundsBoxOf(positions, 2), 2),
    distance: 100,
  }),
};

const shadow = buildRayShadowMask({ atoms, camera, light, width: 128, height: 128, options: { softness: 0, penumbra: 0 } });
const w = shadow.maskWidth;
const h = shadow.maskHeight;
ok(shadow.mask.length === w * h, 'le masque a la taille annoncée');
ok(shadow.spheres === 2, 'les deux atomes servent de proxy');

/* Où tombent les deux billes sur l'image, et ce que le masque y dit. Le pixel retenu
   est celui qui est le plus près du centre PROJETÉ de chaque bille : les deux disques
   ne se recouvrent pas, donc chacun a le sien. */
const camAxes = viewAxesOf(camera.view);
const pass = rasterizeSpheres({
  positions, radii, count: 2, clip: camera.clip, width: w, height: h,
  right: camAxes.right, up: camAxes.up, back: camAxes.back,
});
const projA = clipToScreen(mat4TransformPoint(camera.clip, [0, 0, 2, 1]), w, h);
const projB = clipToScreen(mat4TransformPoint(camera.clip, [0, 0, -1, 1]), w, h);
let idxA = -1;
let idxB = -1;
let bestA = Infinity;
let bestB = Infinity;
for (let i = 0; i < w * h; i += 1) {
  if (!pass.hit[i]) continue;
  const px = i % w;
  const py = Math.floor(i / w);
  const dA = Math.hypot(px + 0.5 - projA[0], py + 0.5 - projA[1]);
  const dB = Math.hypot(px + 0.5 - projB[0], py + 0.5 - projB[1]);
  if (dA < bestA) { bestA = dA; idxA = i; }
  if (dB < bestB) { bestB = dB; idxB = i; }
}
ok(idxA >= 0 && idxB >= 0, 'les deux billes ont laissé des pixels (le rasterizer les a vues)');
/* ⚠ LE POINT DU MONDE EST CELUI DE LA SURFACE, PAS LE CENTRE DE LA BILLE. C'est la
   correction qui rend l'ombre honnête : c'est le morceau de peau que la caméra
   filme qui est interrogé, jamais le milieu de l'atome (l'ancien « billboard », qui
   faisait s'auto-ombrer le bord d'une bille). */
near(Math.hypot(pass.world[idxA * 3], pass.world[idxA * 3 + 1], pass.world[idxA * 3 + 2] - 2), 2, 1e-3,
  '…et le point du monde gardé est SUR la bille A (à son rayon du centre)');
ok(pass.world[idxA * 3] > 0,
  '…du côté que la caméra voit : un vrai point de surface, pas le centre de l’atome');
ok(shadow.mask[idxA] < 0.15, 'A, que la lampe voit en premier, est ÉCLAIRÉ');
/* ⚠ L’OMBRE EST PONDÉRÉE PAR LA PART DE LAMPE QUE LA SURFACE REÇOIT (voir
   `facingFloor`) : B est franchement ombré, mais la paroi mesurée reçoit encore la
   part plancher — une face rasante sous la lampe n’a pas de lumière à perdre. */
ok(shadow.mask[idxB] > 0.3,
  `B, derrière A le long de la lampe, est À L’OMBRE (${shadow.mask[idxB].toFixed(2)} — la part de lampe que sa paroi reçoit encore)`);
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
ok(atomsFromStage({ compList: [fullCover] }, 100).radii[0] > 1,
  '…et quand AUCUN trait n’est mesurable (un genre que la table ne connaît pas), les rayons de van der Waals sont gardés');

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
   la caméra dans le sous-frustum de sa DERNIÈRE tuile, donc le rig se lit avant.
   Le rendu passe désormais par `makeImageGuarded` (le chien de garde de RAY_STALL_MS,
   défini plus haut dans le fichier) : c’est son APPEL qui doit venir après la lecture
   du rig, et `stage.makeImage` n’a qu’UN seul appelant — le chien de garde. */
const readAt = RAY.indexOf('rayShadowInputsOf(stage, {');
const renderAt = RAY.indexOf('makeImageGuarded(stage, {');
ok(readAt > 0 && renderAt > 0 && readAt < renderAt,
  'le rig (caméra + atomes) est lu AVANT le rendu : la caméra ne peut pas être celle d’une tuile');
hasRay('stage.makeImage({', '…et `stage.makeImage` n’est appelée QUE par le chien de garde (un seul point d’entrée vers NGL)');
hasRay('blob = await addCastShadowsToBlob(blob, { shadow });',
  '…et multiplié dans les pixels que NGL vient d’écrire');
hasRay("shadowSkip = (err && err.message) || 'the mask could not be applied to the still';",
  'une ombre impossible laisse l’image de NGL, jamais une erreur — mais elle DIT pourquoi (l’erreur est gardée, pas avalée)');
hasRay('(shadowTooBig ? RAY_SHADOW_SKIP_NOTE : rayShadowNote(null, shadowSkip)),',
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
/* LE GRAPHE QUE CES BANCS DÉCLARENT : une CHAÎNE — les atomes voisins du banc sont
   liés, ce qu'une structure réelle porte toujours (`eachBond`, voir
   _viewer_shadow_links_test.mjs). Sans lui, un banc ne déclare AUCUNE topologie et
   le remplissage n'a plus rien à suivre : la règle « l'atome suivant de la liste »
   a été retirée du module (c'était ELLE, les liens fantômes du rapport). */
const chainOf = (n) => ({
  bondCount: Math.max(0, n - 1),
  eachBond: (cb) => { for (let i = 0; i + 1 < n; i += 1) cb({ atomIndex1: i, atomIndex2: i + 1 }); },
});
/* Et de bout en bout : le ruban pèse 0,45 Å, pas 1,7 Å. */
const ribbonStage = {
  compList: [{
    structure: {
      atomCount: 4,
      ...chainOf(4),
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
/* ⚠ LE PROXY EST LA GÉOMÉTRIE DESSINÉE, pas une poussière de billes. Il a
   désormais DEUX moitiés, toutes deux rasterisées dans les DEUX passes : une BILLE
   (`count` : un sommet par atome dessiné) et une CAPSULE PAR LIAISON (`edges` :
   les deux atomes qu’elle relie — aucune position n’est inventée entre eux). La
   capsule EST le remplissage : un cartoon marche la chaîne comme un TUYAU continu
   (le banc DÉCLARE cette chaîne — voir `chainOf`). Sans ce trait, un dessin fin ne
   projette RIEN DU TOUT — mesuré dans un vrai navigateur : 0 pixel ombré sur 3655. */
eq(ribbon.count, 2, 'seuls les atomes DESSINÉS sont lus : une bille par atome, rien de plus');
eq(ribbon.filled, 1, '…et le lien qui les joint est UNE capsule (le tuyau est continu, pas troué)');
eq(ribbon.edges.length, 2, '…décrite par les DEUX atomes qu’elle relie, jamais par une position inventée');
near(ribbon.radii[0], 0.45, 1e-6, '…et le proxy a l’épaisseur du RUBAN, plus celle d’une sphère de van der Waals');
near(ribbon.radii[1], 0.45, 1e-6, '…pour chaque atome du ruban');
/* LA CAPSULE PORTE L’ÉPAISSEUR DE SES DEUX BOUTS : `rasterizeCapsules` interpole
   le rayon le long de l’axe, donc le trait ne s’amincit ni ne s’évase. */
const capPass = rasterizeCapsules({
  positions: ribbon.positions, radii: ribbon.radii, edges: ribbon.edges,
  clip: mat4Orthographic(-2, 2, -2, 2, -10, 10),
  width: 64, height: 64,
});
ok(capPass.hit.some((v) => v === 1),
  '…et cette capsule couvre vraiment des pixels : c’est elle qui bouche le lien entre les deux atomes');
/* Une BILLE n’est pas une ligne : un spacefill ne remplit rien. */
const ballStage = {
  compList: [{
    structure: {
      atomCount: 2,
      getAtomData: () => ({ position: new Float32Array([0, 0, 0, 0, 1, 0]), radius: new Float32Array([1.7, 1.7]) }),
    },
    matrix: { elements: ident16 },
    reprList: [{ repr: { parameters: { type: 'spacefill' }, structureView: view([0, 1]) } }],
  }],
};
eq(atomsFromStage(ballStage, 100).count, 2,
  'un spacefill reste une poussière de billes : aucune bille n’est reliée à sa voisine');
/* …et le budget des proxies est respecté : un plafond plus serré élargit le pas,
   et un plafond impossible rend les trous (les atomes seuls). */
const capped = atomsFromStage(ribbonStage, 3);
ok(capped.count <= 3, `un plafond de 3 proxies n’est jamais dépassé (count ${capped.count})`);
/* …et les CAPSULES NE COÛTENT RIEN AU BUDGET DES BILLES : elles réutilisent les
   sommets des atomes qu’elles relient (`edges`), donc un plafond serré sur les
   billes laisse quand même le trait entier — un budget n’ouvre plus de trou. */
const jammed = atomsFromStage(ribbonStage, 2);
ok(jammed.count <= 2,
  `sans place du tout, les BILLES tiennent dans le budget (count ${jammed.count})`);
eq(jammed.filled, 1,
  '…et le lien reste entier : une capsule ne consomme pas un proxy (elle relie des atomes déjà émis)');
/* …et UN ATOME QUE RIEN NE DESSINE NE PROJETTE PLUS DE BILLE. Le rapport : « the cast
   shadows appear as large spheres (1,7 Å Van der Waals radius) for all atoms in the
   selection (including side chains), instead of just following the thin ribbon
   backbone ». Un ruban LISTE les chaînes latérales et n'en dessine aucune : elles
   gardaient leur rayon de van der Waals et l'ombre du ruban devenait une chaîne de
   grosses billes. Le proxy d'un atome dont le trait est illisible (NaN — voir
   drawnProxyRadiiOf) est maintenant LAISSÉ DE CÔTÉ : le dessin qui l'atteint VRAIMENT
   apporte son propre trait. */
const unreadableRep = { repr: { visible: true, structureView: view([2, 3]) } };   // un genre absent de la table des traits
const listedStage = {
  compList: [{
    structure: {
      atomCount: 4,
      getAtomData: () => ({
        position: new Float32Array([0, 0, 0, 0, 1.5, 0, 0, 3, 0, 0, 4.5, 0]),
        radius: new Float32Array([1.7, 1.7, 1.7, 1.7]),
      }),
    },
    matrix: { elements: ident16 },
    reprList: [{ repr: cartoonRep }, unreadableRep],
  }],
};
const listed = atomsFromStage(listedStage, 100);
eq(listed.count, 2,
  'un atome LISTÉ par une sélection mais dessiné par personne n’entre plus dans le proxy (2 atomes, pas 4)');
near(listed.radii[0], 0.45, 1e-6, '…seul le trait du ruban reste : 0,45 Å');
near(listed.radii[1], 0.45, 1e-6, '…pour chacun des atomes que le ruban dessine vraiment');
ok([...listed.radii].every((r) => !(r > 1)),
  '…plus une seule bille de van der Waals dans l’ombre d’un ruban (c’était la tache du rapport)');
ok(MODULE.includes('if (surface && measurable && !(Number.isFinite(stroke) && stroke > 0)) continue;'),
  '…c’est la règle de layOut : un atome dont le trait est illisible est laissé hors du proxy');
ok(MODULE.includes('measurable = Number.isFinite(surface[i]) && surface[i] > 0;'),
  '…et elle ne touche PAS le repli : `measurable` garde les rayons de van der Waals quand rien n’est mesurable');
// …et le repli reste : quand AUCUN trait n'est mesurable (une représentation dont la
// table ne connaît pas le genre), les rayons de van der Waals sont gardés — un dessin
// illisible ne perd pas son ombre (voir `measurable` dans layOut).


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
  1.7), 0.165, 1e-9,
  'ball+stick : la bille vaut aspectRatio × radiusSize (0,165 Å) — SANS planchement : l’ombre suit l’encre');
/* ⚠ DEUX RAYONS, DEUX FORMES. Le rapport « la grosseur de la liaison ne reflète pas
   la grosseur de l’ombre » vient d’ici : un seul rayon répondait pour la BILLE et
   pour le BÂTON, si bien que les bâtons de l’ombre prenaient la largeur des billes
   (et son planchement de 0,2 Å) — et, les deux formes étant alors identiques, « en
   boules et bâtons, seuls les bâtons ont une ombre ». */
const twoShapes = proxyRadiiOf(realRep('ball+stick', { radiusType: 'size', radiusSize: 0.15, aspectRatio: 1.1 }), 1.7);
near(twoShapes.ball, 0.165, 1e-9, 'ball+stick : la BILLE dessinée vaut aspectRatio × radiusSize (0,165 Å)');
near(twoShapes.link, 0.15, 1e-9, '…et son BÂTON vaut radiusSize : 0,15 Å, pas le rayon de la bille');
eq(proxyRadiiOf(realRep('ball+stick'), 1.7), { ball: 0.3, link: 0.15, min: 0.2 },
  '…aux défauts d’NGL (radiusSize 0,15 et aspectRatio 2), exactement ce que son `getAtomRadius` dessine');
near(proxyRadiiOf(realRep('licorice', { radiusType: 'size', radiusSize: 0.25 }), 1.7).ball, 0, 1e-9,
  'un licorice n’a AUCUNE bille : il ne dessine que des bâtons');
near(proxyRadiiOf(realRep('spacefill', { radiusType: 'vdw', radiusScale: 0.6 }), 1.7).link, 0, 1e-9,
  '…et un spacefill aucun bâton : deux formes qui ne se confondent plus');
near(proxyRadiiOf(realRep('licorice', {}), 1.7).link, 0.25, 1e-9,
  '…un licorice sans réglage garde le `core` de la table (0,25 Å), pas un planchement');
ok(STROKE_FLOOR === 0.05 && proxyRadiiOf(realRep('licorice', { radiusSize: 0.01 }), 1.7).link === STROKE_FLOOR,
  'un trait plus fin que le plancher de sécurité (0,05 Å) y est ramené — et c’est le seul planchement qui reste');
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
      ...chainOf(2),
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
eq(realRibbon.count, 2,
  'une représentation qui couvre TOUTE la structure dessine ses atomes : une bille chacun, rien de plus');
eq(realRibbon.filled, 1, '…et le lien d’1,5 Å du tube est UNE capsule (le tuyau est continu, pas une poussière)');
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
   n× (n = le facteur, doublé par la passe antialias) et posé au centre de cette
   tuile : une ombre énorme qui remplit le masque, au lieu de l’empreinte de la
   molécule (mesuré plus bas), quel que soit le poids des proxies. D’où les deux
   pièces ci-dessous : le rig se lit AVANT la
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
/* ⚠ CE QUE LA CAMÉRA D'UNE TUILE FAIT VRAIMENT, mesuré (et non supposé) : elle
   MONTRE une fenêtre de la scène, grossie n× et posée au centre de l'image. Le
   masque du module suit cette fenêtre — et comme il n'existe QUE sur le dessin de
   SA caméra (voir §15), la carte d'une tuile est une AUTRE carte : mesuré, 295
   pixels ombrés au lieu de 1206, et surtout un centre à (0,21 ; 0,05) au lieu de
   (0,48 ; 0,50). C'est la « tache détachée » du rapport : l'ombre tombe au mauvais
   endroit parce que la caméra n'est plus celle de l'image. D'où le garde-fou qui
   suit, et qui REFUSE une caméra restée dans une tuile. */
ok(staleBox.count !== cleanBox.count,
  `la carte d’une tuile n’est pas celle de l’image (${staleBox.count} pixels ombrés contre ${cleanBox.count})`);
ok(Math.abs(staleBox.cx - cleanBox.cx) > 0.02 && Math.abs(staleBox.cy - cleanBox.cy) > 0.02,
  `…et surtout elle est DÉCALÉE : centre (${staleBox.cx.toFixed(2)} ; ${staleBox.cy.toFixed(2)}) au lieu de (${cleanBox.cx.toFixed(2)} ; ${cleanBox.cy.toFixed(2)}) sur la molécule`);

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

/* ── 13 bis. LA CAMÉRA APRÈS UNE PASSE DE SUPER-ÉCHANTILLONNAGE — LE « view » ──
   QUI N’EN FINIT JAMAIS
   LE rapport le plus coûteux : « there is no cast shadow ». Le garde-fou
   ci-dessus refusait la caméra sur la simple PRÉSENCE de `cam.view` — or three
   ne retire JAMAIS cet objet : `clearViewOffset()` ne fait que
   `view.enabled = false` (vérifié dans le three livré, Camera#clearViewOffset).
   Et NGL super-échantillonne tout seul : `Viewer.__renderSuperSample` fait
   `setViewOffset` par échantillon et `clearViewOffset()` à la fin — passe
   demandée par le rig ◐ Shadows (`sampleLevel` 2) et rejouée au niveau 3 sur
   chaque image immobile. Donc après la PREMIÈRE image rendue, toute caméra
   vivante porte un `view` VRAI dont `enabled` est faux : le garde-fou levait à
   CHAQUE clic de ✨ Ray, `rayShadowInputsOf` levait avec lui, `captureRayImage`
   avalait l’erreur — la « ray » revenait sans ombre ET sans un mot sur l’ombre.
   La question est celle que three se pose lui-même dans updateProjectionMatrix :
   `view !== null && view.enabled`. Une caméra laissée dans une TUILE reste
   refusée (c’est une sous-fenêtre) ; une caméra que le super-échantillonneur a
   désactivée est INERTE (sa matrice de projection est celle de l’image entière)
   et doit être lue, sinon la fonctionnalité n’existe simplement pas. */
const THREEJS = readFileSync(new URL('./node_modules/three/build/three.module.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
ok(/clearViewOffset\(\)\s*\{\s*if \( this\.view !== null \)\s*\{\s*this\.view\.enabled = false;/.test(THREEJS),
  'three livré : `clearViewOffset()` ne fait que `view.enabled = false` — l’objet `view` reste sur la caméra');
ok(NGLJS.includes('__renderSuperSample') && NGLJS.includes('clearViewOffset'),
  'NGL livré : la passe de super-échantillonnage encadre ses échantillons par setViewOffset / clearViewOffset — d’où le `view` résiduel');
const supersampledView = { enabled: false, fullWidth: 4, fullHeight: 4, offsetX: 0, offsetY: 0, width: 2, height: 2 };
eq(cameraFromViewer({ camera: { ...bareCamera, view: supersampledView } }).clip.length, 16,
  'une caméra déjà super-échantillonnée (view.enabled false) EST LUE : c’est l’état NORMAL de l’application');
throws(() => cameraFromViewer({ camera: { ...bareCamera, view: { ...supersampledView, enabled: true } } }),
  /inside a tile/, '…mais une caméra réellement dans une TUILE (view.enabled true) reste REFUSÉE — une sous-fenêtre n’est pas l’image');

/* ── 14. UN DESSIN FIN PROJETTE VRAIMENT QUELQUE CHOSE ───────────────────────
   LE rapport : « the ray doesn't do anything ». Mesuré, et c'était exact : un
   peptide en hélice dessiné en tube de 0,5 Å, éclairé par la lampe du rig, donnait
   ZÉRO pixel ombré — parce que (a) les proxies n'étaient que les ATOMES (des billes
   de 1 Å à 3,8 Å les unes des autres, un dessin troué que le rayon de la lampe
   traverse) et (b) le test ne lisait que le RAYON CENTRAL de chaque pixel, comme si
   le receveur était un point. Une ombre est une affaire de SURFACES : le proxy suit
   donc la géométrie dessinée (les liens sont bouchés, voir LINKED_KINDS) et le test
   échantillonne la surface du receveur (sa largeur en pixels, `camera.reach`).
   Les deux moitiés sont figées ici, sur le scénario et la lampe de l'application. */
const lampOf = (az, el) => {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const ce = Math.cos(e);
  return [ce * Math.sin(a), Math.sin(e), -ce * Math.cos(a)];
};
const helixStage = (rep) => {
  const n = 40;
  const position = new Float32Array(n * 3);
  const radius = new Float32Array(n).fill(1.7);
  for (let i = 0; i < n; i += 1) {
    const t = (i * 100 * Math.PI) / 180;
    position[i * 3] = 2.3 * Math.cos(t);
    position[i * 3 + 1] = i * 1.5 - n * 0.75;
    position[i * 3 + 2] = 2.3 * Math.sin(t);
  }
  return {
    compList: [{
      structure: { atomCount: n, ...chainOf(n), getAtomData: () => ({ position, radius }) },
      matrix: { elements: ident16 },
      reprList: [{
        name: rep.type, getType: () => rep.type, type: 'representation',
        parameters: { visible: true },
        repr: { ...rep, visible: true, structureView: view(Array.from({ length: n }, (_, i) => i)) },
      }],
    }],
  };
};
const helixShadow = (rep, az, el) => {
  const atoms = atomsFromStage(helixStage(rep), 100000);
  const bounds = boundsBoxOf(atoms.positions, atoms.count);
  const scene = boundsOf(atoms.positions, atoms.count);
  const W = 600;
  const aspect = 1.9;
  const H = Math.round(W / aspect);
  const dist = (scene.radius * 1.35) / Math.tan((40 * Math.PI) / 360);
  const view = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
  const top = 0.1 * Math.tan((40 * Math.PI) / 360);
  const proj = [
    1 / (aspect * top), 0, 0, 0,
    0, 1 / top, 0, 0,
    0, 0, -((dist * 4) + 0.1) / ((dist * 4) - 0.1), -1,
    0, 0, (-2 * (dist * 4) * 0.1) / ((dist * 4) - 0.1), 0,
  ];
  const cam = { view, projection: proj, clip: mat4Multiply(proj, view), type: 'PerspectiveCamera' };
  const dir = lampOf(az, el);
  const light = {
    dir, center: scene.center, radius: scene.radius, distance: scene.radius * 100, bounds,
    ...shadowRigOf({ dir, bounds, center: scene.center, radius: scene.radius, distance: scene.radius * 100 }),
  };
  const mask = buildRayShadowMask({ atoms, camera: cam, light, width: W, height: H, options: {} });
  const cover = rasterizeSpheres({
    positions: atoms.positions, radii: atoms.radii, count: atoms.count,
    clip: cam.clip, width: mask.maskWidth, height: mask.maskHeight, needWorld: false,
  });
  let drawn = 0;
  let occ = 0;
  for (let i = 0; i < cover.hit.length; i += 1) {
    if (!cover.hit[i]) continue;
    drawn += 1;
    occ += mask.mask[i];
  }
  return { atoms, shadowed: mask.shadowed, drawn, mean: drawn ? occ / drawn : 0 };
};
const tubeRep = { type: 'tube', radiusType: 'size', radiusSize: 0.5 };
const tubeFlat = helixShadow(tubeRep, 25, 28);        // la lampe par défaut du rig
const tubeGrazing = helixShadow(tubeRep, 120, 15);    // une lampe rasante
ok(tubeFlat.atoms.filled > 0,
  'le tube est un proxy CONTINU : les liens entre ses atomes sont bouchés');
ok(tubeFlat.drawn > 0 && tubeFlat.shadowed > 0,
  `un tube de 0,5 Å projette une ombre RÉELLE (${tubeFlat.shadowed} pixels à l’ombre sur ${tubeFlat.drawn} dessinés)`);
ok(tubeFlat.mean > 0.05,
  `…et elle assombrit vraiment le dessin (occlusion moyenne ${tubeFlat.mean.toFixed(3)} → ${(100 * 0.55 * tubeFlat.mean).toFixed(1)} % de lumière perdue)`);
ok(tubeGrazing.shadowed > tubeFlat.shadowed,
  `une lampe rasante ombre PLUS qu’une lampe de face (${tubeGrazing.shadowed} contre ${tubeFlat.shadowed}) : c’est la géométrie qui décide`);

/* ── 15. LA MOLÉCULE N'EST PAS À L'ORIGINE — LE REPÈRE DE LA SCÈNE ──────────
   LE rapport : « l'ombre est une tache plate posée À CÔTÉ de la molécule » et,
   dans les « ray », aucune ombre portée du tout. La caméra de NGL ne bouge
   JAMAIS : elle est parquée à `cameraZ` (−80) et regarde l'ORIGINE de la scène,
   et c'est la MOLÉCULE qui est déplacée sous elle par deux groupes du viewer —
   lus dans le NGL livré, `Viewer._initScene` :
       scene → rotationGroup → translationGroup → modelGroup → component.group
   Le recentrage (`autoView`) écrit `translationGroup.position`, le clic écrit
   `rotationGroup.matrix`, et NGL applique exactement cette chaîne partout où il a
   besoin d'une position à l'écran — `getPositionOnCanvas(p)` est
   `p.add(translationGroup.position).applyMatrix4(rotationGroup.matrix)
   .project(camera)`, et le pick des contrôles de transformation finit par
   `…add(translationGroup.position); …applyMatrix4(rotationGroup.matrix)`.
   `Component.updateMatrix()`, lui, ne construit que la place du composant DANS
   SON FICHIER : ni le recentrage ni la rotation n'y sont. Un proxy bâti avec le
   seul `component.matrix` tombe donc à côté dès qu'un autoView a recentré la
   molécule — et si la molécule est loin de l'origine il peut sortir du frustum :
   le masque est construit et ne touche AUCUN pixel (le « no cast shadow » du
   rapport). Le test prend des coordonnées de fichier banales — centre
   (12, −7, 25) Å — un recentrage, un quart de tour, et une molécule déplacée par
   la barre de style. */
const rotY = (deg) => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Colonnes, la disposition de three : m11 c, m13 s, m31 −s, m33 c.
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const rotXv = mat4TransformPoint(rotY(90), [1, 0, 0, 1]);
near(rotXv[0], 0, 1e-9, '+X tourné de 90° autour de Y tombe sur…');
near(rotXv[2], -1, 1e-9, '…−Z : la matrice de ce test est bien une rotation de three');
const translateOf = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const FILE_CENTER = [12, -7, 25];               // des coordonnées de fichier banales
/* La caméra de NGL telle que le viewer la construit — `cameraFov` 40° à
   `cameraZ` −80, regardant l'origine — ET l'état RÉEL d'une caméra vivante, avec
   le `view` désactivé que le super-échantillonneur lui a laissé (§13 bis). */
const nglCameraOf = (aspect = 1.9) => {
  const dist = 80;
  const nearPlane = 0.1;
  const far = dist * 4;
  const viewMatrix = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
  const top = nearPlane * Math.tan((40 * Math.PI) / 360);
  const proj = [
    1 / (aspect * top), 0, 0, 0,
    0, 1 / top, 0, 0,
    0, 0, -((far + nearPlane) / (far - nearPlane)), -1,
    0, 0, (-2 * far * nearPlane) / (far - nearPlane), 0,
  ];
  return {
    projectionMatrix: { elements: proj },
    matrixWorldInverse: { elements: viewMatrix },
    type: 'PerspectiveCamera',
    view: { enabled: false, fullWidth: 1, fullHeight: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 },
    clip: mat4Multiply(proj, viewMatrix),
  };
};
const viewerChain = () => mat4Multiply(rotY(90),
  translateOf(-FILE_CENTER[0], -FILE_CENTER[1], -FILE_CENTER[2]));
const sceneAtoms = () => {
  const n = 40;
  const position = new Float32Array(n * 3);
  const radius = new Float32Array(n).fill(1.7);
  for (let i = 0; i < n; i += 1) {
    const t = (i * 100 * Math.PI) / 180;
    position[i * 3] = 2.3 * Math.cos(t) + FILE_CENTER[0];
    position[i * 3 + 1] = i - n / 2 + FILE_CENTER[1];
    position[i * 3 + 2] = 2.3 * Math.sin(t) + FILE_CENTER[2];
  }
  return { n, position, radius };
};
/* `groups` : ce que le viewer DONNE au module (les deux groupes de NGL). Sans
   eux c'est le chemin d'autrefois — le module ne les lisait pas. */
const sceneStage = ({ groups, compShift = [0, 0, 0] }) => {
  const { n, position, radius } = sceneAtoms();
  return {
    compList: [{
      structure: { atomCount: n, ...chainOf(n), getAtomData: () => ({ position, radius }) },
      matrix: { elements: translateOf(compShift[0], compShift[1], compShift[2]) },
      reprList: [{
        name: tubeRep.type, getType: () => tubeRep.type, type: 'representation',
        parameters: { visible: true },
        repr: { ...tubeRep, visible: true, structureView: view(Array.from({ length: n }, (_, i) => i)) },
      }],
    }],
    viewer: {
      camera: nglCameraOf(),
      ...(groups ? {
        rotationGroup: { matrix: { elements: rotY(90) } },
        translationGroup: { position: { x: -FILE_CENTER[0], y: -FILE_CENTER[1], z: -FILE_CENTER[2] } },
      } : {}),
    },
  };
};

/* Le masque du module, ET le dessin que la caméra a vraiment filmé — la chaîne
   complète de NGL, écrite ici à la main (R · T · matrice du composant). On mesure
   ce qui compte : de l'ombre, combien tombe SUR le dessin, et quelle part du
   dessin est ombrée. */
const sceneShadowOf = ({ groups, compShift = [0, 0, 0], az = 120, el = 15 }) => {
  const inputs = rayShadowInputsOf(sceneStage({ groups, compShift }), {
    lightDir: lampOf(az, el), options: { softness: 0 },
  });
  const mask = buildRayShadowMask({ ...inputs, width: 600, height: 316, options: { softness: 0 } });
  /* LE DESSIN, indépendamment du module : les atomes DU FICHIER, avec le tube que
     NGL dessine (chaque lien rempli au même pas de 0,3 Å et au même trait de
     0,5 Å), passés par la chaîne vraie — c'est ce que la caméra a filmé. */
  const chain = mat4Multiply(viewerChain(), translateOf(compShift[0], compShift[1], compShift[2]));
  const { n, position } = sceneAtoms();
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    pts.push(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
    if (i + 1 >= n) continue;
    const dx = position[(i + 1) * 3] - position[i * 3];
    const dy = position[(i + 1) * 3 + 1] - position[i * 3 + 1];
    const dz = position[(i + 1) * 3 + 2] - position[i * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fills = Math.max(0, Math.ceil(d / 0.3) - 1);
    for (let k = 1; k <= fills; k += 1) {
      const u = k / (fills + 1);
      pts.push(position[i * 3] + dx * u, position[i * 3 + 1] + dy * u, position[i * 3 + 2] + dz * u);
    }
  }
  const drawnCount = pts.length / 3;
  const world = new Float32Array(pts.length);
  const radii = new Float32Array(drawnCount).fill(tubeRep.radiusSize);
  for (let i = 0; i < drawnCount; i += 1) {
    const p = mat4TransformPoint(chain, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], 1]);
    world[i * 3] = p[0];
    world[i * 3 + 1] = p[1];
    world[i * 3 + 2] = p[2];
  }
  const draw = rasterizeSpheres({
    positions: world, radii, count: drawnCount,
    clip: inputs.camera.clip, width: mask.maskWidth, height: mask.maskHeight,
    needWorld: false,
  });
  let drawn = 0;
  let onDrawing = 0;
  let shadowAll = 0;
  for (let i = 0; i < draw.hit.length; i += 1) {
    const inked = mask.mask[i] > 0.002;
    if (inked) {
      shadowAll += 1;
      if (draw.hit[i]) onDrawing += 1;
    }
    if (draw.hit[i]) drawn += 1;
  }
  /* LA COUVERTURE DU MODULE ELLE-MÊME — les balles ET les capsules, la passe
     caméra telle qu'il la construit. Le receveur EST cette couverture : un pixel
     qu'elle ne touche pas n'a pas de point du monde, donc ne peut pas être ombré.
     C'est ce qui rend impossible la « salissure » du rapport (le fond, un liseré). */
  const cov = rasterizeSpheres({
    positions: inputs.atoms.positions, radii: inputs.atoms.radii, count: inputs.atoms.count,
    clip: inputs.camera.clip, width: mask.maskWidth, height: mask.maskHeight,
  });
  if (inputs.atoms.edges.length) {
    rasterizeCapsules({
      positions: inputs.atoms.positions, radii: inputs.atoms.radii, edges: inputs.atoms.edges,
      clip: inputs.camera.clip, width: mask.maskWidth, height: mask.maskHeight,
    }, cov);
  }
  let dust = 0;
  for (let i = 0; i < mask.mask.length; i += 1) {
    if (mask.mask[i] > 0.002 && !cov.hit[i]) dust += 1;
  }
  return { drawn, onDrawing, shadowAll, dust, shadowed: mask.shadowed, proxies: inputs.atoms.count };
};
const noFrame = sceneShadowOf({ groups: false });
const withFrame = sceneShadowOf({ groups: true });
ok(noFrame.onDrawing === 0,
  `sans le repère de la scène, le masque ne touche AUCUN pixel du dessin (${noFrame.onDrawing} sur ${noFrame.drawn} dessinés ; ${noFrame.shadowAll} pixels d'ombre au total, ${noFrame.proxies} proxies) — le « no cast shadow » du rapport`);
ok(withFrame.drawn > 0 && withFrame.shadowAll > 0,
  `avec le repère, l'ombre existe ET le dessin est dans le cadre (${withFrame.shadowAll} pixels d'ombre pour ${withFrame.drawn} dessinés)`);
/* ⚠ LE MASQUE EST ZÉRO HORS DU DESSIN — c'est la fin du « ça salit la molécule ».
   La première version multipliait le masque PARTOUT où il était > 0,002 : le fond
   recevait un liseré sombre, et un flou « ambiant » de 4 Å étalait une tache
   au-delà de la silhouette. Le masque d'aujourd'hui n'existe QUE sur les pixels que
   la passe caméra a couverts (`camera.hit`) : le receveur est la surface
   elle-même, donc un pixel que la molécule ne possède pas n'a pas de point du monde
   et ne peut pas être ombré. Ce qui doit être vrai, et qui l'est : le DESSIN reçoit
   son ombre EN ENTIER, et RIEN d'autre n'est touché. */
ok(withFrame.onDrawing >= 0.99 * withFrame.shadowAll && withFrame.shadowAll > 0,
  `…et l’ombre tombe ENTIÈREMENT sur le dessin (${withFrame.onDrawing}/${withFrame.shadowAll} pixels d’ombre, sur les ${withFrame.drawn} pixels dessinés)`);
eq(withFrame.dust, 0,
  `…et AUCUN pixel ombré n’est hors de la silhouette du module (${withFrame.dust} poussières) : le fond reste intact`);
ok(withFrame.shadowAll / withFrame.drawn > 0.1,
  `…le dessin reçoit donc une vraie ombre portée : ${(100 * withFrame.shadowAll / withFrame.drawn).toFixed(1)} % de ses pixels (az 120 / el 15, tube de 0,5 Å)`);
const movedComp = sceneShadowOf({ groups: true, compShift: [3, 1, -2] });
ok(movedComp.shadowAll > 0 && movedComp.onDrawing >= 0.99 * movedComp.shadowAll,
  `une molécule DÉPLACÉE par la barre de style reste dans le repère (${movedComp.onDrawing}/${movedComp.shadowAll} pixels d’ombre sur le dessin)`);
eq(viewerMatrixOf({}), null, 'sans viewer, viewerMatrixOf ne change rien (les anciens cas gardent leur chemin)');
eq(viewerMatrixOf({ viewer: {} }), null, '…et un viewer au repos aussi');
const centredPt = mat4TransformPoint(viewerChain(), [FILE_CENTER[0], FILE_CENTER[1], FILE_CENTER[2], 1]);
near(centredPt[0], 0, 1e-6, 'R · T appliqué au centre du fichier ramène la molécule à l’ORIGINE de la scène');
near(centredPt[1], 0, 1e-6, '…en y,');
near(centredPt[2], 0, 1e-6, '…et en z — exactement ce que fait le recentrage d’NGL');

/* ── 12. CE QUE LE MODULE DIT DE LUI-MÊME ──────────────────────────────── */
/* ── 16. LE SILENCE ÉTAIT LE BUG — LE MESSAGE DIT POURQUOI ───────────────────
   Les deux pannes des §13 bis et §15 ont coûté plusieurs allers-retours pour une
   seule raison : elles ne disaient RIEN. `captureRayImage` avalait l'erreur
   (`catch { inputs = null }`, `catch { shadow = null }`), la « ray » revenait
   sans ombre et le message ne parlait pas d'ombre du tout — la fonctionnalité
   semblait absente alors qu'elle levait. La raison voyage maintenant jusqu'au
   message, et un `reachedPixels` de 0 est REPORTÉ comme un résultat (« 0 % des
   pixels ») au lieu d'être pris pour une absence de donnée : c'est exactement le
   diagnostic qui manquait pour trouver ces deux bugs. */
eq(rayShadowNote(null), '', 'sans ombre et sans raison, la note reste vide (l’appelant décide du message)');
eq(rayShadowNote(null, 'the camera is inside a tile'),
  '· no cast shadows — the camera is inside a tile',
  'quand l’ombre n’a pas pu être construite, la note DIT POURQUOI');
const zeroReach = {
  mask: new Float32Array(4), maskWidth: 2, maskHeight: 2,
  strength: 0.55, spheres: 12, filled: 4, imageWidth: 100, imageHeight: 100, reachedPixels: 0,
};
ok(rayShadowNote(zeroReach).includes('(0% of the pixels)'),
  'une ombre construite qui n’atteint AUCUN pixel le dit (« 0 % des pixels ») — le diagnostic du masque vide');
eq(rayShadowNote({ ...zeroReach, failed: 'the still could not be shadowed' }),
  '· no cast shadows — the still could not be shadowed',
  'un masque qui n’a pas pu être appliqué à l’image le dit aussi : la dernière porte par laquelle une ombre pouvait disparaître sans un mot');
ok(MODULE.includes("console.warn('✨ Ray: no cast shadows —', shadow.failed);"),
  '…et cette porte-là est TRACÉE comme les autres');
hasRay('console.warn(\'✨ Ray: no cast shadows —\', shadowSkip)',
  'une ombre impossible est TRACÉE, plus jamais avalée en silence');
hasRay('rayShadowNote(null, shadowSkip)',
  '…et la raison de l’échec voyage jusqu’au message de la « ray »');
has('{(shadowOn || rayShadows || rayLiveOn) && (',
  'les curseurs 💡 Light (Azimuth / Elevation) sont atteignables dès que les ombres du « ray » sont allumées : c’est la lampe que l’ombre utilise');
/* ⚠ LE MÊME BLOC SERT MAINTENANT AUSSI L'OMBRE VIVANTE (`|| rayLiveOn`, la
   demande de cette session : la voir « while the molecule is moving ») : les
   curseurs pilotent sa lampe comme celle du PNG, donc ils doivent être là dans
   les deux cas. Le bloc d'origine (◐ Shadows / ✨ ray) est ce que la ligne
   ci-dessus mesure — avec le troisième terme. */
has('{(shadowOn || rayShadows || rayLiveOn) && (', '…et cette lampe est AUSSI celle de la couche vivante');


ok(MODULE.includes('PCSS'), '…la pénombre PCF élargie par l’écart receveur / occulteur (PCSS)');
ok(MODULE.includes('PROXY_STROKE_BY_TYPE'), '…et la table des épaisseurs de trait des représentations');
ok(MODULE.includes('SELF-SHADOWING ON THE MOLECULE ITSELF'),
  '…et l’auto-ombrage de la molécule : le receveur est la surface elle-même');
ok(MODULE.includes('WHAT A SHADOW CANNOT DO IN NGL 2.4'),
  '…en disant honnêtement ce que NGL 2.4 ne peut pas faire (aucune shadow map dans la toile interactive)');

/* ── 17. LE RUBAN PROJETTE SA BANDE, ET UN CYCLE AROMATIQUE SON HEXAGONE ────
   LE RAPPORT : « les ombres générées par « ray » sont laides, elles salissent la
   molécule, et les cycles aromatiques ne projettent pas leurs hexagones sur les
   rubans voisins. » Les versions précédentes reconstruisaient une APPROXIMATION de
   la scène à partir des atomes (une bille par atome, une brosse de billes
   « re-dérivée » des sections d'une bande) et multipliaient le résultat dans tous
   les pixels de l'image. Mesuré contre NGL 2.4 dans un vrai navigateur, trois de
   ses prémisses étaient fausses :

     • LE CARTOON N'ÉTAIT JAMAIS LU. La géométrie d'un cartoon est un maillage
       INDEXÉ — 3 flottants par sommet (2430 pour 810 sommets), un attribut
       `normal`, et une table d'indices `Uint16Array` de 4728 entrées. L'ancien
       lecteur la croyait « 12 flottants par sommet » ; `2430 % 12 !== 0` faisait
       donc rendre `null` à la lecture : UN CARTOON NE PROJETAIT RIEN DU TOUT.
     • LE RUBAN PROJETAIT N'IMPORTE QUOI. 936 flottants est un multiple de 12 par
       accident : position / dir / size étaient lus au mauvais pas, et la brosse
       partait dans une direction INVENTÉE — les taches. (Mesuré : 49 remplissages
       fantômes ET 5 liaisons réelles restées ouvertes, à la fois.)
     • LES PLAQUES DE CYCLES ÉTAIENT INVISIBLES. Les hexagones pleins du style
       « Stylized rings » sont des `MeshBuffer` posés par
       `addBufferRepresentation` : ils vivent dans `reprList` avec
       `rep.type === 'buffer'` et AUCUN `structureView`. L'ancien lecteur ne
       connaissait que des TYPES de représentation : un hexagone n'était donc ni
       occulteur ni receveur, et aucun cycle ne pouvait rien projeter.

   LA MÉTHODE, MAINTENANT : les TRIANGLES RÉELS sont rasterisés, dans les deux
   passes, comme le GPU les dessinerait (aire d'écran + profondeur NDC + poids
   barycentriques CORRIGÉS EN PERSPECTIVE). Le discriminant est MESURÉ, pas deviné :
   un tampon qui porte un attribut `normal` est une SURFACE (cartoon, ruban, tube,
   rope, surface, plaque de cycle) ; un tampon sans `normal` est un IMPOSTEUR
   (bille, bâton, fil : sa forme est découpée dans le fragment shader) et n'est
   JAMAIS lu comme des triangles. */

/* ── (a) QUEL TAMPON EST UNE SURFACE, ET QUEL TAMPON EST UN IMPOSTEUR ─────── */
/* Un maillage INDEXÉ avec ses normales, la forme EXACTE d'un cartoon d'NGL. */
const indexedSurface = ({ verts = 4, tris = 2, withIndex = true, withNormal = true } = {}) => {
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  for (let i = 0; i < verts; i += 1) {
    position[i * 3] = i;
    position[i * 3 + 1] = i % 2;
    position[i * 3 + 2] = 0;
    normal[i * 3 + 2] = 1;                      // la surface regarde +z
  }
  const idx = new Uint16Array(tris * 3);
  for (let t = 0; t < tris; t += 1) {
    idx[t * 3] = 0; idx[t * 3 + 1] = 1 + t; idx[t * 3 + 2] = 2 + t;
  }
  const attributes = { position: { array: position, count: verts } };
  if (withNormal) attributes.normal = { array: normal, count: verts };
  return { attributes, ...(withIndex ? { index: { array: idx } } : {}) };
};
const mesh = indexedSurface();
eq(trianglesOfGeometry(mesh, 'cartoon').count, 2,
  'un maillage INDEXÉ avec ses normales est lu : ses 2 triangles sont des surfaces');
eq(Array.from(trianglesOfGeometry(mesh, 'cartoon').indices), [0, 1, 2, 0, 2, 3],
  '…et sa table d’indices est reprise TELLE QUELLE (le maillage est celui qui est dessiné)');
eq(trianglesOfGeometry(indexedSurface({ tris: 3 }), 'ribbon').count, 3,
  '…quel que soit le NOM de la représentation : c’est le tampon qui décide');
eq(trianglesOfGeometry(indexedSurface({ withNormal: false }), 'cartoon'), null,
  'SANS `normal`, le même maillage est un IMPOSTEUR : ses quads sont des formes découpées dans le fragment shader, jamais une molécule');
eq(trianglesOfGeometry(indexedSurface({ withIndex: false }), 'cartoon'), null,
  'sans table d’indices, il n’y a pas de triangle à rasteriser');
eq(trianglesOfGeometry(indexedSurface(), 'licorice'), null,
  '…et la porte des imposteurs ne laisse passer AUCUN genre de la liste, même avec des normales');
eq(IMPOSTOR_TYPES.licorice, 1, 'la table des imposteurs nomme un bâton');
eq(IMPOSTOR_TYPES['ball+stick'], 1, '…une bille de ball+stick');
eq(IMPOSTOR_TYPES.cartoon, undefined, '…et PAS un cartoon : lui est une surface');
eq(IMPOSTOR_TYPES.buffer, undefined, '…pas une plaque de cycle non plus : c’est une surface, elle aussi');
eq(trianglesOfGeometry(null, 'cartoon'), null, 'sans géométrie, rien');

/* L'ATTRIBUT ENTRELACÉ : NGL range parfois plusieurs valeurs par sommet dans un
   seul tampon. Un lecteur qui suppose `array[i * 3]` lit alors l'attribut du
   VOISIN — c'est exactement ainsi que la première version a inventé une direction.
   `compactAttribute` DÉSENTRELELACE, une fois, dans un tableau plat. */
const packed = {
  array: Float32Array.from([0, 0, 0, 9, 9, 1, 0, 0, 9, 9, 2, 0, 0, 9, 9]),
  count: 3, data: { stride: 5 }, offset: 0,
};
const packedPos = compactAttribute(packed, 3);
eq(Array.from(packedPos.array), [0, 0, 0, 1, 0, 0, 2, 0, 0],
  'un attribut entrelacé est désentrelacé : les 3 positions sortent de leurs 3 pas');
eq(packedPos.stride, 3, '…et l’attribut compacté se lit ensuite comme un tableau plat');
eq(Array.from(compactAttribute({ array: Float32Array.from([1, 2, 3]), count: 1 }, 3).array), [1, 2, 3],
  'un attribut déjà plat est rendu tel quel (aucune copie inutile)');
eq(compactAttribute(null, 3), null, 'un attribut absent ne se devine pas');
/* …ET LE RASTERIZER LUI-MÊME, sur DEUX triangles superposés : la surface la plus
   proche de la caméra gagne le pixel, et le point du monde gardé est interpolé SUR
   le plan (poids barycentriques corrigés en perspective). */
const triClip = mat4Orthographic(-2, 2, -2, 2, -10, 10);
const triPass = rasterizeTriangles({
  positions: Float32Array.from([
    -1, -1, -1, 1, -1, -1, 0, 1, -1,          // le triangle ARRIÈRE (z = −1)
    -1, -1, 1, 1, -1, 1, 0, 1, 1,             // le même, DEVANT (z = +1)
  ]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2, 3, 4, 5]),
  count: 2,
  clip: triClip, width: 64, height: 64,
});
eq(triPass.drawn, 2, 'les deux triangles sont rasterisés');
const triCentre = 32 * 64 + 32;
ok(triPass.hit[triCentre] === 1 && Math.abs(triPass.world[triCentre * 3 + 2] - 1) < 1e-3,
  '…et celui de DEVANT gagne le pixel du centre : son point du monde est à z = +1');
near(triPass.normal[triCentre * 3 + 2], 1, 1e-6, '…avec la normale que le tampon porte');


/* ── (b) LES TRIANGLES D'UN COMPOSANT, EN COORDONNÉES DU MONDE ─────────────── */
const idMatrix = { elements: ident16 };
const worldOf = (comp) => worldTrianglesOf(comp);
const ribbonComp = {
  matrix: idMatrix,
  reprList: [
    { repr: { type: 'cartoon', visible: true, bufferList: [{ geometry: indexedSurface() }] } },
    { repr: { type: 'ribbon', visible: true, bufferList: [{ geometry: indexedSurface({ tris: 1 }) }] } },
  ],
};
const world = worldOf(ribbonComp);
eq(world.count, 3, 'les triangles de TOUTES les surfaces dessinées sont réunis (2 + 1)');
eq(world.reps, 2, '…et chaque surface compte pour une représentation');
eq(world.plates, 0, 'aucune plaque de cycle dans cette composition');
eq(world.kinds, 'cartoon·ribbon', '…et les genres sont NOMMÉS, pour que le message de la « ray » le dise');

/* L'HEXAGONE D'UN CYCLE AROMATIQUE — le cas du rapport. Une plaque n'a AUCUN
   `structureView` (on ne la lit pas sur les atomes) et son genre est `buffer` :
   c'est la marque `__plates` du viewer qui la désigne, et elle doit compter pour
   une PLAQUE et fournir ses triangles. */
const hexGeo = (r = 1) => {
  const verts = [];
  const nor = [];
  for (let k = 0; k < 6; k += 1) {
    const a = (k * Math.PI) / 3;
    verts.push(r * Math.cos(a), r * Math.sin(a), 0);
    nor.push(0, 0, 1);
  }
  verts.push(0, 0, 0); nor.push(0, 0, 1);        // le centre, pour le triangle fan
  const idx = new Uint16Array(6 * 3);
  for (let k = 0; k < 6; k += 1) {
    idx[k * 3] = 6; idx[k * 3 + 1] = k; idx[k * 3 + 2] = (k + 1) % 6;
  }
  return {
    attributes: {
      position: { array: Float32Array.from(verts), count: 7 },
      normal: { array: Float32Array.from(nor), count: 7 },
    },
    index: { array: idx },
  };
};
const plateGeo = hexGeo(1);
const plateComp = {
  matrix: idMatrix,
  reprList: [{ repr: { type: 'buffer', visible: true }, __plates: { mesh: { geometry: plateGeo } } }],
};
const ringWorld = worldOf(plateComp);
eq(ringWorld.count, 6, 'la plaque d’un cycle est un FAN de 6 triangles — l’hexagone, tel qu’il est dessiné');
eq(ringWorld.plates, 1, '…et elle est comptée comme une PLAQUE DE CYCLE (le rapport : « les hexagones »)');
eq(ringWorld.kinds, 'buffer', '…son genre est celui que NGL lui donne (`buffer`), pas un genre inventé');
/* LA MATRICE DU COMPOSANT S'APPLIQUE : les plaques sont posées dans le repère du
   composant, comme tout ce qu'il dessine. */
const shifted = worldOf({ ...plateComp, matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] } });
near(shifted.positions[0], plateGeo.attributes.position.array[0] + 5, 1e-6,
  'les triangles d’une plaque suivent le « Move X » du composant');
/* …et une surface ne compte qu'UNE fois, même posée dans deux `bufferList` : la
   géométrie est dédoublonnée par identité. */
eq(worldOf({ matrix: idMatrix, reprList: [
  { repr: { type: 'cartoon', visible: true, bufferList: [{ geometry: mesh }] } },
  { repr: { type: 'cartoon', visible: true, bufferList: [{ geometry: mesh }] } },
] }).count, 2, 'la MÊME géométrie posée deux fois ne compte qu’une fois');

/* ── (c) DE BOUT EN BOUT : L'HEXAGONE D'UN CYCLE SUR LE RUBAN VOISIN ─────────
   C'EST LA DEMANDE DU RAPPORT. Un ruban (un grand quad dans le plan z = 0, de
   normale +z) reçoit l'ombre d'une PLAQUE HEXAGONALE de rayon 1 posée 2 Å devant
   lui, éclairée par une lampe oblique (dir [1, 0, 1] : la lampe est en haut à
   droite). La lumière descend donc en biais, et l'ombre de la plaque tombe À CÔTÉ
   d'elle, sur le ruban — un endroit que la plaque ne couvre PAS dans l'image. La
   caméra regarde le ruban de face (orthographique, le long de −z).

   Ce qui doit être vrai : le ruban est ombré LÀ OÙ l'hexagone le recouvre le long
   de la lumière, et PAS ailleurs — la tache a le CONTOUR de l'hexagone. Une bille
   (l'ancien proxy) donnerait une tache RONDE ; l'ancienne brosse de ruban n'en
   donnerait aucune, puisqu'un quad n'est pas une bande. */
const quadGeo = ({ size = 3 } = {}) => {
  const p = Float32Array.from([-size, -size, 0, size, -size, 0, size, size, 0, -size, size, 0]);
  const n = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    attributes: { position: { array: p, count: 4 }, normal: { array: n, count: 4 } },
    index: { array: Uint16Array.from([0, 1, 2, 0, 2, 3]) },
  };
};
const PLATE_Z = 2;                              // la plaque est DEVANT le ruban
const hexAt = (z) => {                          // le même hexagone, posé à z
  const g = hexGeo(1);
  const pos = g.attributes.position.array;
  for (let i = 2; i < pos.length; i += 3) pos[i] = z;
  return g;
};
const plateSceneTris = worldOf({
  matrix: idMatrix,
  reprList: [
    { repr: { type: 'ribbon', visible: true, bufferList: [{ geometry: quadGeo({ size: 3 }) }] } },
    { repr: { type: 'buffer', visible: true }, __plates: { mesh: { geometry: hexAt(PLATE_Z) } } },
  ],
});
eq(plateSceneTris.count, 8, 'la scène du rapport : 2 triangles de ruban + 6 de l’hexagone');
eq(plateSceneTris.plates, 1, '…dont UNE plaque de cycle aromatique');
const SIDE = 3.5;                               // le demi-cadre de la caméra, en Å
const HW = 240;                                 // la carte d'ombre, en pixels
const plateProj = mat4Orthographic(-SIDE, SIDE, -SIDE, SIDE, -20, 20);
const plateCam = { view: ident16, projection: plateProj, clip: plateProj };
const plateBounds = boundsBoxOf(plateSceneTris.positions, plateSceneTris.vertexCount);
const plateCenter = [
  (plateBounds.min[0] + plateBounds.max[0]) / 2,
  (plateBounds.min[1] + plateBounds.max[1]) / 2,
  (plateBounds.min[2] + plateBounds.max[2]) / 2,
];
const plateRadius = Math.max(1e-3, 0.5 * Math.hypot(
  plateBounds.max[0] - plateBounds.min[0],
  plateBounds.max[1] - plateBounds.min[1],
  plateBounds.max[2] - plateBounds.min[2],
));
const obliqueLamp = (() => { const l = Math.hypot(1, 0, 1); return [1 / l, 0, 1 / l]; })();
const plateMask = buildRayShadowMask({
  atoms: {
    positions: new Float32Array(0), radii: new Float32Array(0), count: 0,
    edges: new Int32Array(0), tris: { ...plateSceneTris, stride: 1 },
  },
  camera: plateCam,
  light: {
    dir: obliqueLamp, center: plateCenter, radius: plateRadius,
    distance: plateRadius * 100, bounds: plateBounds,
    ...shadowRigOf({
      dir: obliqueLamp, bounds: plateBounds, center: plateCenter,
      radius: plateRadius, distance: plateRadius * 100,
    }),
  },
  width: HW, height: HW,
  options: { softness: 0, penumbra: 0, bias: 0.35 },
});
eq(plateMask.triangles, 8, 'les 8 triangles de la scène sont ceux qui projettent (aucune bille)');
eq(plateMask.plates, 1, '…et la note sait qu’il y a UNE plaque de cycle');
/* Le monde → le pixel de la carte : la caméra est orthographique et couvre
   [−SIDE, +SIDE]², donc l'échelle est exacte. */
const maskAt = (x, y) => {
  const mw = plateMask.maskWidth;
  const px = Math.min(mw - 1, Math.max(0, Math.round(((x + SIDE) / (2 * SIDE)) * mw)));
  const py = Math.min(mw - 1, Math.max(0, Math.round(((SIDE - y) / (2 * SIDE)) * mw)));
  return plateMask.mask[py * mw + px];
};
/* L'OMBRE EST DÉCALÉE : la lumière descend suivant −dir, donc un point de la plaque
   à z = 2 tombe sur le ruban 2 Å plus loin en x — au point (−2, 0, 0). */
ok(maskAt(-2, 0) > 0.3,
  `le ruban est OMBRÉ sous l’hexagone (${maskAt(-2, 0).toFixed(2)} au centre de l’ombre projetée)`);
ok(maskAt(-2 + 0.95, 0) > 0.3, '…et il l’est encore à 0,95 Å du centre, vers un SOMMET de l’hexagone');
/* LE CONTOUR, C'EST CELUI DE L'HEXAGONE — pas un disque. Un point à 0,95 Å du centre
   suivant l'axe d'un SOMMET (0°) est DEDANS ; le même à 30°, face au MILIEU d'un
   côté (dont la distance est 0,866 Å), est DEHORS. C'est exactement l'écart entre un
   hexagone et le disque de même rayon — la forme que ni une bille ni une brosse ne
   donnaient. */
ok(maskAt(-2 + 0.95 * Math.cos(Math.PI / 6), 0.95 * Math.sin(Math.PI / 6)) < 0.05,
  '…mais à la MÊME distance vers le MILIEU d’un côté (0,95 > 0,866), il est ÉCLAIRÉ : la tache a le contour de l’hexagone');
/* …ET RIEN AUTOUR : ni le reste du ruban, ni le fond. */
ok(maskAt(2, 2) < 0.05, '…et le ruban, loin de l’ombre, reste éclairé');
let plateDust = 0;
for (let i = 0; i < plateMask.mask.length; i += 1) if (plateMask.mask[i] > 0.002) plateDust += 1;
ok(plateDust > 0 && plateDust < 0.25 * HW * HW,
  `…l’ombre ne couvre qu’une petite part de l’image (${plateDust} pixels sur ${HW * HW}) : c’est une tache, pas un voile`);

/* ── (d) CE QUE L'ŒIL NE VOIT PAS NE PROJETTE RIEN ────────────────────────── */
eq(opacityOf({ opacity: 0 }), 0, 'l’opacité d’une représentation se lit là où ngl la garde');
eq(opacityOf({ opacity: 0.4 }), 0.4, '…et elle peut être partielle');
eq(opacityOf({}), 1, 'une représentation qui n’en parle pas est opaque (les bancs, les vieux objets)');
eq(opacityOf(null), 1, '…même quand il n’y a rien à lire');
eq(INVISIBLE_OPACITY < 0.05, true, 'un dessin à moins de 5 % est tenu pour invisible');
near(drawnProxyRadiiOf({ reprList: [{ repr: { ...cartoonRep, opacity: 0.4 } }] }, 1, new Float32Array([1.7]))[0],
  0.18, 1e-6, 'un dessin à 40 % ne projette que 40 % de son trait (l’ombre d’une surface translucide)');
ok(Number.isNaN(drawnProxyRadiiOf({ reprList: [{ repr: { ...cartoonRep, opacity: 0 } }] }, 1, new Float32Array([1.7]))[0]),
  'un dessin à `opacity: 0` ne projette AUCUNE bille');
eq(worldOf({ matrix: idMatrix, reprList: [{ repr: { type: 'cartoon', visible: true, opacity: 0, bufferList: [{ geometry: indexedSurface() }] } }] }).count, 0,
  '…ni aucun TRIANGLE : un dessin effacé ne projette rien du tout, ni bille ni surface');
eq(worldOf({ matrix: idMatrix, reprList: [{ repr: { type: 'cartoon', visible: false, bufferList: [{ geometry: indexedSurface() }] } }] }).count, 0,
  'une surface CACHÉE ne projette rien non plus');

/* ── (e) LE BUDGET DES TRIANGLES : ÉCHANTILLONNER, PAS DISPARAÎTRE ────────── */
const triOnly = {
  matrix: idMatrix,
  reprList: [{ repr: { type: 'cartoon', visible: true, bufferList: [{ geometry: indexedSurface({ verts: 400, tris: 300 }) }] } }],
};
const cappedTris = atomsFromStage({ compList: [triOnly] }, 1000, 10);
ok(cappedTris.tris.count <= 10 && cappedTris.tris.stride >= 30,
  `un budget de 10 triangles ÉCHANTILLONNE la géométrie (${cappedTris.tris.count} gardés sur ${cappedTris.tris.total}, pas de 1 sur ${cappedTris.tris.stride})`);
eq(cappedTris.count, 0, '…et sans atome dessiné, aucune bille n’est inventée');
const fullTris = atomsFromStage({ compList: [triOnly] }, 1000, 1000);
eq(fullTris.tris.count, 300, 'sans plafond serré, LES 300 triangles sont gardés (aucun échantillonnage inutile)');

/* ── (f) LE MESSAGE DIT CE QUI A SERVI : LES SURFACES, LES PLAQUES, LA LAMPE ─ */
const surfNote = rayShadowNote({
  mask: new Float64Array(4), spheres: 12, filled: 34, triangles: 904,
  plates: 6, kinds: 'cartoon·ribbon·buffer', strength: 0.5,
  reachedPixels: 0, imageWidth: 10, imageHeight: 10, strokes: null,
  facing: { floor: 0.35, mean: 0.72, sampled: 812 },
});
ok(surfNote.includes('34 link capsules'),
  `…le trait est dit : « ${surfNote} »`);
ok(surfNote.includes('904 triangles (6 ring plates)') && surfNote.includes('cartoon·ribbon·buffer'),
  '…les SURFACES aussi, avec les plaques de cycles appelées par leur nom (le rapport : « les hexagones »)');
ok(surfNote.includes('lamp facing 0.72 (floor 0.35)'),
  '…et la part de lampe que les pixels ombrés reçoivent encore : c’est elle qui adoucit une ombre sur une paroi rasante');
ok(!rayShadowNote({
  mask: new Float64Array(4), spheres: 12, strength: 0.5,
  reachedPixels: 0, imageWidth: 10, imageHeight: 10, strokes: null,
}).includes('triangles'), '…et il n’en parle pas quand aucune surface n’a projeté');
/* …et les rouages sont ceux du module : le discriminant, la géométrie, et la porte
   qui rend le fond intouchable. */
ok(MODULE.includes('export const rasterizeTriangles = ({'), 'les triangles sont rasterisés par UNE fonction (rasterizeTriangles)');
ok(MODULE.includes("export const trianglesOfGeometry = (geometry, type = '') => {"),
  '…lus dans LA géométrie, par une seule lecture (trianglesOfGeometry)');
ok(MODULE.includes('export const worldTrianglesOf = (comp, viewerM = null) => {'),
  '…rassemblés une fois par composant (worldTrianglesOf)');
ok(MODULE.includes('const nor = compactAttribute(geometry.attributes.normal, 3);'),
  '…et le discriminant est LA PRÉSENCE DES NORMALES, pas une table de types de représentation');
ok(MODULE.includes('if (!pos || !pos.array || !nor || !nor.array) return null;'),
  '…donc un tampon sans normales (une bille, un bâton, un fil) n’est JAMAIS lu comme des triangles');
ok(MODULE.includes('if (!camera.hit[idx]) continue;'),
  '…et la carte d’ombre n’existe QUE sur les pixels du dessin : le fond n’est jamais touché');
ok(MODULE.includes('facingFloor'), '…avec la part de lampe, planchée, pour qu’une paroi rasante garde son ombre');
ok(MODULE.includes('if (opacityOf(rep, el) <= INVISIBLE_OPACITY) return;'),
  'la règle « ce que l’œil ne voit pas ne projette rien » est appliquée aux surfaces comme aux atomes');
ok(MODULE.includes('the aromatic rings do not project their'),
  '…et le module porte le rapport, pour que la prochaine lecture sache POURQUOI les triangles sont là');


/* ── 22. LA GROSSEUR DE L'OMBRE EST CELLE DU BÂTON ─────────────────────────────
   LE rapport, mesuré comme l'œil le voit : un bâton de 0,15 Å projette une bande de
   2 × 0,15 Å sur un plateau (34,3 pixels par ångström, caméra orthographique), et
   quand la BILLE des mêmes atomes fait 0,6 Å, la bande ne doit PAS prendre 1,2 Å.
   Avant, `rasterizeCapsules` lisait `atoms.radii` — le rayon de la bille : les
   bâtons de l'ombre étaient donc aussi gras que les billes, et « en boules et
   bâtons, seuls les bâtons ont une ombre ». */
const BOND_ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const BOND_SIDE = 3.5;                        // le demi-cadre de la caméra, en Å
const BOND_PX = 240;                          // la carte d'ombre, en pixels
const BOND_PER_A = BOND_PX / (2 * BOND_SIDE); // l'échelle EXACTE d'une caméra ortho
const bondProj = mat4Orthographic(-BOND_SIDE, BOND_SIDE, -BOND_SIDE, BOND_SIDE, -20, 20);
/* Le plateau (le receveur) : un quad dans le plan z = −2, face à la caméra. */
const bondPlate = {
  positions: Float32Array.from([-4, -3, -2, 4, -3, -2, 4, 3, -2, -4, 3, -2]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  count: 2, vertexCount: 4, stride: 1, plates: 0, kinds: 'buffer', reps: 1,
};
/* Le bâton : deux atomes écartés sur l'axe x, une BILLE large (0,6 Å) et un BÂTON
   fin (0,15 Å). La lampe est à 45° dans le plan y–z, donc l'ombre du bâton tombe
   2 Å PLUS BAS — À L'ÉCART de sa propre silhouette, où rien ne la recouvre. */
const BOND_POS = Float32Array.from([-2, 0, 0, 2, 0, 0]);
const BOND_EDGES = Int32Array.from([0, 1]);
const bondMaskOf = ({ balls, tubes }) => {
  const atoms = {
    positions: BOND_POS, radii: balls, linkRadii: tubes, count: 2,
    edges: BOND_EDGES, tris: bondPlate,
  };
  const box = unionBoxOf(
    boundsBoxOf(bondPlate.positions, 4),
    expandBoxOf(boundsBoxOf(BOND_POS, 2), balls[0]),
  );
  const center = [
    (box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2,
  ];
  const radius = Math.max(1e-3, 0.5 * Math.hypot(
    box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2],
  ));
  const dir = (() => { const l = Math.hypot(1, 1); return [0, 1 / l, 1 / l]; })();
  const light = {
    dir, center, radius, distance: radius * 100, bounds: box,
    ...shadowRigOf({ dir, bounds: box, center, radius, distance: radius * 100 }),
  };
  return buildRayShadowMask({
    atoms,
    camera: { projection: bondProj, view: BOND_ID, clip: bondProj },
    light,
    width: BOND_PX, height: BOND_PX,
    options: { softness: 0, penumbra: 0, penumbraMax: 0, bias: 0.35 },
  });
};
/* La PLUS LONGUE bande sombre d'une COLONNE — celle du milieu, à 2 Å de l'axe des
   atomes : elle ne coupe que l'ombre du bâton (les billes, à ±2 Å, n'y sont pas),
   et la face sombre du bâton lui-même est un second trait, plus court. */
const longestBand = (mask) => {
  const mw = mask.maskWidth;
  const mh = mask.maskHeight;
  const x = Math.round(mw / 2);
  let best = 0;
  let run = 0;
  for (let y = 0; y < mh; y += 1) {
    if (mask.mask[y * mw + x] > 0.002) { run += 1; if (run > best) best = run; } else run = 0;
  }
  return best;
};
const thinBond = bondMaskOf({ balls: Float32Array.from([0.6, 0.6]), tubes: Float32Array.from([0.15, 0.15]) });
const fatBond = bondMaskOf({ balls: Float32Array.from([0.6, 0.6]), tubes: Float32Array.from([0.6, 0.6]) });
const noTubes = bondMaskOf({ balls: Float32Array.from([0.6, 0.6]), tubes: undefined });
const thinBand = longestBand(thinBond);
const fatBand = longestBand(fatBond);
/* LA LARGEUR ATTENDUE EST CELLE DE LA GÉOMÉTRIE, pas une constante : la lampe est à
   45° dans le plan y–z, donc l'ombre d'un bâton de rayon r est étirée de
   1/cos 45° = √2 — 2√2·r en pixels. Pour 0,15 Å à 34,3 px/Å : 14,6 px. */
const wantedBand = 2 * Math.SQRT2 * 0.15 * BOND_PER_A;
ok(thinBond.shadowed > 0,
  `le bâton projette bien une ombre sur le plateau (${thinBond.shadowed} pixels ombrés)`);
ok(Math.abs(thinBand - wantedBand) <= 3,
  `l’ombre d’un bâton de 0,15 Å est large de 2√2 × 0,15 Å : ${thinBand} px mesurés contre ${wantedBand.toFixed(1)} attendus (34,3 px/Å)`);
ok(fatBand > 3.5 * thinBand,
  `…avec le rayon de la BILLE (0,6 Å) la bande quadruple (${fatBand} px) : c’est le bug du rapport, et il est bien mesuré`);
eq(Array.from(noTubes.mask), Array.from(fatBond.mask),
  'un appelant qui ne fournit que `radii` (les sondes, les bancs) garde le masque d’avant, pixel pour pixel');
ok(MODULE.includes('const tubeRadii = capsuleRadiiOf(atoms);')
  && MODULE.includes('positions: atoms.positions, radii: tubeRadii, edges: atoms.edges,')
  && MODULE.includes('linkRadii[k] = lay.wradLink ? lay.wradLink[e] : lay.wrad[e];'),
  '…et les capsules des DEUX passes lisent ce rayon-là, du proxy à la carte');
console.log(`bâton de 0,15 Å : bande d’ombre ${thinBand} px (2√2 × 0,15 Å = ${wantedBand.toFixed(1)} px à ${BOND_PER_A.toFixed(1)} px/Å)`
  + ` · bille de 0,6 Å : ${fatBand} px (l’ancien rayon, celui du rapport)`);


console.log(`_viewer_ray_shadows_test.mjs — ${passed} assertions OK (ombres portées · deux rayons : bille et bâton)`);

