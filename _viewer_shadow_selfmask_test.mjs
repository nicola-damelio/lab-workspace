/* =========================================================================
   _viewer_shadow_selfmask_test.mjs — UNE BILLE NE S'OMBRE PAS ELLE-MÊME.

   Le rapport de cette session : « when I put cartoon on the general of the styling
   window, on top of cartoons there are white and black spheres » et « CPK and
   sphere representations have strange shadows, they look as transparent with
   inside smaller white and black spheres ». Les deux captures ont la même
   signature : des BILLES de verre — un anneau sombre, un centre intact.

   UNE BILLE ISOLÉE EST LE BANC QUI TRANCHE. Rien dans la scène ne peut
   l'ombrager : sa propre ombre tombe DERRIÈRE elle, jamais sur la peau que la
   caméra regarde. Le masque doit donc valoir ZÉRO partout où la passe caméra a
   vu la bille. S'il y a du noir, il ne peut venir que de l'auto-ombrage — le
   disque PCF qui échantillonne la bille elle-même, ou le biais qui ne couvre pas
   l'écart entre le point vu et la surface que la lampe rencontre au même pixel.

   MESURÉ ICI :
     1. la bille SEULE : le masque doit être VIDE (mesuré AVANT le correctif :
        3 849 pixels noircis — max 0,997 — tous sur la moitié opposée à la lampe,
        tous occulturés par la bille elle-même) ;
     2. la même bille SANS flou (blur 0), puis SANS pénombre : le défaut n'était
        ni le disque PCF ni le biais, c'était le receveur compté comme son propre
        occulteur ;
     3. DEUX billes à 10 Å (elles ne se touchent pas) : aucune ombre entre elles ;
     4. LA SCÈNE DE LA CAPTURE : une hélice de 40 billes de vdW qui se touchent
        (le « cartoon + sphere » du rapport) — les ombres de CONTACT, elles,
        doivent rester ;
     5. LE TÉMOIN : une paire ALIGNÉE AVEC LA LAMPE — la bille du fond reçoit
        l'ombre de celle du devant (une AUTRE forme, donc du noir doit rester) ;
     6. le compteur du module (`shadow.selfShadow`) qui dit combien de pixels ont
        rencontré leur propre forme et n'ont donc pas été noircis.

   LA RÈGLE ÉPROUVÉE (src/utils/viewerRayShadows.js) : les deux passes écrivent le
   NOM de la forme qui gagne chaque pixel, et un receveur n'est jamais ombré par
   son propre nom — ni par le rayon central, ni par un échantillon du disque PCF.
   ========================================================================= */
import assert from 'node:assert/strict';
import {
  RAY_SHADOW_DEFAULTS, atomsFromStage, buildRayShadowMask, boundsOf, boundsBoxOf,
  clipToScreen, expandBoxOf, mat4LookAt, mat4Multiply, mat4TransformPoint,
  maxStrokeRadiusOf, shadowRigOf, viewAxesOf,
} from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const stageOf = (positions, rep, vdw = 1.7) => {
  const n = positions.length / 3;
  const radius = new Float32Array(n).fill(vdw);
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
const SPHERE_REP = { type: 'spacefill', radiusType: 'vdw', radiusScale: 1 };
const cameraOf = ({ positions, count, width, height, zoom = 1, radius = null }) => {
  const scene = boundsOf(positions, count);
  /* ⚠ UNE BILLE SEULE N'A PAS DE TAILLE : `boundsOf` d'un point vaut 1e-3, donc
     la caméra se retrouvait DANS la bille (aucun pixel vu) et le rig de la lampe
     était un point (rien de rasterisé). Le banc donne donc l'échelle à la main. */
  const r = Number.isFinite(Number(radius)) && Number(radius) > 0 ? Number(radius) : scene.radius;
  const aspect = width / height;
  const dist = (r * 1.35 * zoom) / Math.tan((40 * Math.PI) / 360);
  const view = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
  const top = Math.tan((40 * Math.PI) / 360);
  const proj = [
    1 / (aspect * top), 0, 0, 0,
    0, 1 / top, 0, 0,
    0, 0, -((dist * 4) + 0.1) / ((dist * 4) - 0.1), -1,
    0, 0, (-2 * (dist * 4) * 0.1) / ((dist * 4) - 0.1), 0,
  ];
  return { view, clip: mat4Multiply(proj, view), scene: { center: scene.center, radius: r } };
};
const LAMP = (() => {
  const az = 2.09, el = 0.26;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
})();
/* La lampe, NORMALISÉE : c'est la direction qu'on avance pour mettre une bille
   « devant » une autre dans le témoin de la section 5. */
const L = (() => {
  const l = Math.sqrt(LAMP[0] ** 2 + LAMP[1] ** 2 + LAMP[2] ** 2);
  return [LAMP[0] / l, LAMP[1] / l, LAMP[2] / l];
})();
const lightOf = (atoms) => {
  /* LE RIG DE `rayShadowInputsOf`, à la lettre : la boîte des centres ÉLARGIE du
     plus gros trait (une bille est un solide, sa surface dépasse son centre). */
  const bounds = expandBoxOf(boundsBoxOf(atoms.positions, atoms.count), maxStrokeRadiusOf(atoms));
  const center = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.max(1e-3, 0.5 * Math.sqrt(
    (bounds.max[0] - bounds.min[0]) ** 2
    + (bounds.max[1] - bounds.min[1]) ** 2
    + (bounds.max[2] - bounds.min[2]) ** 2,
  ));
  const distance = radius * 100;
  return {
    dir: LAMP, center, radius, distance, bounds,
    ...shadowRigOf({ dir: LAMP, bounds, center, radius, distance }),
  };
};
/* LA LECTURE D'UN MASQUE, EN CLAIR : combien de pixels sont noircis, où ils
   tombent par rapport au centre de la bille, et jusqu'où va le disque vu. */
const readMask = (shadow, camera, width, height, center, radius) => {
  const c = clipToScreen(mat4TransformPoint(camera.clip, center), width, height, [0, 0, 0]);
  const axes = viewAxesOf(camera.view || IDENT16);
  const edge = clipToScreen(mat4TransformPoint(camera.clip, [
    center[0] + axes.right[0] * radius,
    center[1] + axes.right[1] * radius,
    center[2] + axes.right[2] * radius,
  ]), width, height, [0, 0, 0]);
  let over = 0, sum = 0, max = 0, minD = Infinity, maxD = 0, near = 0, nearMax = 0;
  const disc = edge ? Math.abs(edge[0] - c[0]) : 0;
  for (let y = 0; y < shadow.maskHeight; y += 1) {
    for (let x = 0; x < shadow.maskWidth; x += 1) {
      const v = shadow.mask[y * shadow.maskWidth + x];
      if (!(v > 0.02)) continue;
      over += 1;
      sum += v;
      if (v > max) max = v;
      const d = Math.sqrt((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
      /* LES PIXELS DE CE DISQUE-LÀ : le masque d'une scène entière se lit bille
         par bille, sans confondre l'ombre d'une voisine avec la sienne. */
      if (d <= disc * 1.15) { near += 1; if (v > nearMax) nearMax = v; }
    }
  }
  return {
    over, max, mean: over ? sum / over : 0, disc, near, nearMax,
    minD: over ? minD : 0, maxD: over ? maxD : 0,
  };
};

/* ── 1. LA BILLE SEULE ─────────────────────────────────────────────────────── */
const W = 400, H = 300;
const lonePos = Float32Array.from([0, 0, 0]);
const loneAtoms = atomsFromStage(stageOf(lonePos, SPHERE_REP), 100000);
const loneCam = cameraOf({ positions: lonePos, count: 1, width: W, height: H, radius: 3.5 });
const loneLight = lightOf(loneAtoms);
const lone = buildRayShadowMask({ atoms: loneAtoms, camera: loneCam, light: loneLight, width: W, height: H });
const loneRead = readMask(lone, loneCam, W, H, [0, 0, 0], 1.7);
console.log('BILLE SEULE — défauts : softness', RAY_SHADOW_DEFAULTS.softness,
  '· penumbra', RAY_SHADOW_DEFAULTS.penumbra, '· max', RAY_SHADOW_DEFAULTS.penumbraMax,
  '· bias', RAY_SHADOW_DEFAULTS.bias, '· taps', RAY_SHADOW_DEFAULTS.pcfTaps);
const say = (label, r) => console.log(`  ${label} : disque ${r.disc.toFixed(1)} px · sur le disque ` +
  `${r.near} px noircis (max ${r.nearMax.toFixed(3)}) · partout ${r.over} px (max ${r.max.toFixed(3)}) · ` +
  `rayon du noir ${r.minD.toFixed(1)}→${r.maxD.toFixed(1)} px`);
say('défauts      ', loneRead);

/* ── 2. QUEL TERME FABRIQUE L'ANNEAU ──────────────────────────────────────── */
const noBlur = buildRayShadowMask({
  atoms: loneAtoms, camera: loneCam, light: loneLight, width: W, height: H, options: { blur: 0 },
});
const noBlurRead = readMask(noBlur, loneCam, W, H, [0, 0, 0], 1.7);
const noPenumbra = buildRayShadowMask({
  atoms: loneAtoms, camera: loneCam, light: loneLight, width: W, height: H,
  options: { softness: 0, penumbra: 0 },
});
const noPenumbraRead = readMask(noPenumbra, loneCam, W, H, [0, 0, 0], 1.7);
say('blur 0       ', noBlurRead);
say('sans pénombre', noPenumbraRead);

/* ── 3. DEUX BILLES QUI NE SE TOUCHENT PAS ─────────────────────────────────── */
const pairPos = Float32Array.from([-5, 0, 0, 5, 0, 0]);
const pairAtoms = atomsFromStage(stageOf(pairPos, SPHERE_REP), 100000);
const pairCam = cameraOf({ positions: pairPos, count: 2, width: W, height: H });
const pairLight = lightOf(pairAtoms);
const pair = buildRayShadowMask({ atoms: pairAtoms, camera: pairCam, light: pairLight, width: W, height: H });
const pairA = readMask(pair, pairCam, W, H, [-5, 0, 0], 1.7);
const pairB = readMask(pair, pairCam, W, H, [5, 0, 0], 1.7);
console.log('DEUX BILLES (10 Å, disjointes) :');
say('gauche       ', pairA);
say('droite       ', pairB);

/* ── 4. LA SCÈNE DE LA CAPTURE : HÉLICE DE 40 BILLES DE vdW ────────────────── */
const N = 40;
const helix = new Float32Array(N * 3);
for (let i = 0; i < N; i += 1) {
  const t = (i * 100 * Math.PI) / 180;
  helix[i * 3] = 2.3 * Math.cos(t);
  helix[i * 3 + 1] = i * 1.5 - N * 0.75;
  helix[i * 3 + 2] = 2.3 * Math.sin(t);
}
const ballAtoms = atomsFromStage(stageOf(helix, SPHERE_REP), 100000);
const ballCam = cameraOf({ positions: helix, count: N, width: W, height: H });
const ballLight = lightOf(ballAtoms);
const ballMask = buildRayShadowMask({ atoms: ballAtoms, camera: ballCam, light: ballLight, width: W, height: H });
let ballAll = 0;
for (let i = 0; i < ballMask.mask.length; i += 1) if (ballMask.mask[i] > 0.02) ballAll += 1;
console.log('HÉLICE 40 BILLES (vdW 1,7 Å) : pixels du masque', ballAll, '· max',
  Math.max(...ballMask.mask).toFixed(3), '·', `${Math.round((ballAll / ballMask.mask.length) * 1000) / 10}% de la toile`);

/* ── 5. LE TÉMOIN : UNE OMBRE QUI EXISTE VRAIMENT ───────────────────────────
   La règle du nom ne doit rien éteindre d'autre que l'auto-ombrage. Le témoin
   est une PAIRE ALIGNÉE AVEC LA LAMPE : la bille du fond, à 3,4 Å (les deux se
   touchent) dans la direction de la lampe, doit recevoir l'ombre de celle du
   devant — c'est-à-dire d'une AUTRE forme, donc du noir doit rester. */
const ahead = (d) => [L[0] * d, L[1] * d, L[2] * d];
const alignedPos = Float32Array.from([0, 0, 0, ...ahead(3.4)]);
const alignedAtoms = atomsFromStage(stageOf(alignedPos, SPHERE_REP), 100000);
const alignedCam = cameraOf({ positions: alignedPos, count: 2, width: W, height: H });
const alignedLight = lightOf(alignedAtoms);
const aligned = buildRayShadowMask({
  atoms: alignedAtoms, camera: alignedCam, light: alignedLight, width: W, height: H,
});
const behind = readMask(aligned, alignedCam, W, H, [0, 0, 0], 1.7);
const front = readMask(aligned, alignedCam, W, H, ahead(3.4), 1.7);
console.log('PAIRE ALIGNÉE AVEC LA LAMPE (3,4 Å : elles se touchent) :');
say('celle du fond', behind);
say('celle devant  ', front);

/* ── 6. QUI OCCULTE LA BILLE SEULE ──────────────────────────────────────────
   Le chiffre que le module compte lui-même : les pixels dont le rayon central a
   rencontré LEUR PROPRE forme. Sur la bille seule ils sont nombreux (c'était le
   défaut) et le masque, lui, doit être vide. */
console.log('RÈGLE DU NOM, comptée par le module :');
console.log(`  bille seule : ${lone.selfShadow} pixel(s) ont rencontré leur propre forme · masque ${loneRead.over} px`);
console.log(`  paire alignée : ${aligned.selfShadow} (le reste — ${aligned.shadowed} px ombrés — vient d'une AUTRE forme)`);
console.log(`  hélice de 40 : ${ballMask.selfShadow} (ombre réelle gardée : ${ballAll} px)`);

/* ── 7. LE VERDICT, ÉCRIT PAR LE BANC ─────────────────────────────────────── */
ok(loneRead.over === 0,
  `une bille SEULE ne s'ombre pas elle-même (mesuré AVANT la règle : 3 849 px de sa propre moitié ; ici ${loneRead.over}, max ${loneRead.max.toFixed(3)})`);
ok(noBlurRead.over === 0 && noPenumbraRead.over === 0,
  '…ni sans flou, ni sans pénombre : le défaut n’était pas le disque PCF, c’était le receveur compté comme son propre occulteur');
ok(lone.selfShadow > 0,
  `…et la règle a bien servi (${lone.selfShadow} pixels de la bille ont rencontré leur propre forme et n'ont PAS été noircis)`);
ok(pairA.over === 0 && pairB.over === 0,
  'DEUX billes disjointes ne s’ombrent pas non plus (elles ne se touchent pas : aucune ombre n’existe entre elles)');
ok(behind.over > 0 && behind.nearMax > 0.5,
  `LE TÉMOIN : une bille DERRIÈRE une autre, alignée avec la lampe, reçoit son ombre (${behind.over} px, max ${behind.nearMax.toFixed(3)}) — la règle n’éteint que l’auto-ombrage`);
ok(ballAll > 0 && ballMask.selfShadow > 0,
  `une grappe qui se touche projette encore ses ombres (${ballAll} px sur 40 billes de vdW, ${ballMask.selfShadow} pixels refusés comme auto-ombrage)`);
console.log(`mesures : ${passed}`);
