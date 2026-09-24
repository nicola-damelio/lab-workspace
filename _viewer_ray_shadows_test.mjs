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
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAY_SHADOW_DEFAULTS, rayShadowOptions, rayShadowMaskSize, mat4LookAt, mat4Multiply,
  mat4Orthographic, mat4TransformPoint, boundsOf, clipToScreen, rasterizeSpheres,
  shadowMaskOf, softenMask, sampleMaskBilinear, applyShadowToPixels, lightDepthScale,
  lightMatricesOf, buildRayShadowMask, atomsFromStage, cameraFromViewer,
  rayShadowInputsOf, shadowImageData, addCastShadowsToBlob, rayShadowNote,
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
hasRay('const inputs = rayShadowInputsOf(stage, {', '…la scène est lue sur le stage');
hasRay('buildRayShadowMask({', '…le masque est construit pour la taille RÉELLE de l’image (factor compris)');
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

/* ── Bilan ─────────────────────────────────────────────────────────────── */
console.log(`_viewer_ray_shadows_test.mjs — ${passed} assertions OK (ombres portées)`);
