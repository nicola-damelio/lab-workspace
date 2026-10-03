/* =========================================================================
   _viewer_shadow_ghost_test.mjs — LE MAILLAGE LU N'EST PAS UNE BILLE DE vdW.

   Le rapport de cette session : « the problem is still there and now is worse
   because if I change the style of the side chain I have a shadow on a plane » —
   une nuée de sphères grises, détachée du ruban.

   LE DÉFAUT, ET POURQUOI IL A SURVÉCU AU CORRECTIF DU NOM (rayname). Une
   représentation dont les TRIANGLES ont été lus (`covered`, voir
   `worldTrianglesOf`) n'a pas besoin de proxy : ses formes SONT le maillage.
   `drawnProxyRadiiOf` sortait donc sans rien écrire, et ses atomes restaient
   `NaN` — exactement comme ceux d'un genre que la table ne sait pas mesurer
   (le `dot` du viewer), que `layOut` repliait sur le rayon de van der Waals.
   Tant qu'UN atome de la scène était mesurable, ces NaN étaient écartés et tout
   allait bien ; mais dans une scène où le RUBAN EST LA SEULE REPRÉSENTATION
   DESSINÉE — exactement ce qu'on obtient en changeant le style des chaînes
   latérales (`hide`) — plus rien n'était mesurable, et le repli s'appliquait à
   TOUT : une bille de 1,7 Å sur chaque atome, que rien ne dessine.

   MESURÉ ICI (banc : 4 atomes, un ruban dont le maillage est lisible) :
     · AVANT : 4 proxies de 1,70 Å, 3 644 pixels d'ombre — TOUS hors du ruban ;
     · APRÈS : AUCUN proxy, 0 pixel d'ombre hors du ruban.
   Les contrôles qui ne doivent PAS bouger sont mesurés avec :
     · le MÊME ruban dont le maillage n'est pas encore lisible (le build est
       encore dans la file d'NGL) → le trait du ruban, 0,45 Å ;
     · le ruban (maillage lu) PLUS un licorice des chaînes latérales → 0,25 Å ;
     · un genre que la table ne connaît pas (`dot`), seul → le repli vdW reste.
   …et deux scènes de plus gardent la règle intacte (sections 7 et 8) :
     · L'ORDRE DES REPRÉSENTATIONS NE COMPTE PAS — le licorice AVANT le ruban donne
       le même proxy que l'inverse : le zéro du maillage ne mange jamais un trait
       mesuré (il ne s'écrit que sur un `NaN`) ;
     · LA SCÈNE DU VIEWER — ruban (protéine) + les POINTILLÉS des eaux / ions
       (`point`, `sele: 'ion'` / `'water'`, deux ensembles DISJOINTS) : les
       pointillés portent leur CHEVEU, jamais la bille de vdW, et le ruban n'y
       ajoute aucune bille de 1,7 Å. C'est la règle du style léger « dots » d'un
       grand système (§8b), où TOUT est en points.
   ⚠ CE QUE LA TABLE NE CONNAÎT PAS garde le repli vdW (une `dot` d'un vieux
   script — NGL 2.4 n'enregistre aucune représentation `dot`). Les sections 4 et 5
   mesurent ce repli-là, avec un genre qui n'existe pas, exprès.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  atomsFromStage, buildRayShadowMask, boundsBoxOf, expandBoxOf, mat4LookAt, mat4Multiply,
  maxStrokeRadiusOf, proxyStrokeSummary, rasterizeTriangles, rayShadowMaskSize, shadowRigOf,
} from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); passed += 1; };
const near = (a, b, eps, what) => { assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu : ${b}\n  obtenu  : ${a}`); passed += 1; };

const MODULE = readFileSync(new URL('./src/utils/viewerRayShadows.js', import.meta.url), 'utf8');
const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const POS = Float32Array.from([0, 0, 0, 1.5, 0.4, 0, 3.0, 0.8, 0, 4.5, 1.2, 0]);
const N = POS.length / 3;

/* LE MAILLAGE RÉEL D'UN CARTOON — INDEXÉ, AVEC DES NORMALES : c'est ce que NGL
   attache à la représentation une fois construite, et sa seule présence suffit
   à ce que `worldTrianglesOf` la compte parmi les surfaces lues. */
const indexedSurface = () => {
  const p = Float32Array.from([-0.6, -0.6, 0, 5.1, -0.6, 0, -0.6, 0.6, 0, 5.1, 0.6, 0]);
  const nn = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    attributes: { position: { array: p, count: 4 }, normal: { array: nn, count: 4 } },
    index: { array: Uint16Array.from([0, 1, 2, 2, 1, 3]) },
  };
};
const structure = {
  atomCount: N,
  getAtomData: () => ({ position: POS, radius: new Float32Array(N).fill(1.7) }),
  eachBond: (cb) => { for (let i = 0; i + 1 < N; i += 1) cb({ atomIndex1: i, atomIndex2: i + 1 }); },
  eachResidue: (cb) => { for (let i = 0; i < N; i += 1) cb({ traceAtomIndex: i }); },
};
const allAtoms = { getAtomIndices: () => Uint32Array.from({ length: N }, (_, i) => i) };
const el = (type, rep) => ({ name: type, getType: () => type, type: 'representation', repr: rep, parameters: {} });
const stageOf = (reprList) => ({ compList: [{ structure, matrix: { elements: IDENT16 }, reprList }] });
const cartoon = (extra = {}) => el('cartoon', {
  type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc',
  structureView: allAtoms, ...extra,
});
const summary = (atoms) => proxyStrokeSummary(atoms.radii, atoms.count, 64);


/* ── 1. LE DÉFAUT : UN RUBAN SEUL, SON MAILLAGE LU ────────────────────────── */
const covered = atomsFromStage(stageOf([cartoon({ bufferList: [{ geometry: indexedSurface() }] })]), 100000);
eq(covered.count, 0, 'un cartoon dont le MAILLAGE est lu n’émet AUCUN proxy : ses formes sont ses triangles');
eq(summary(covered).list.length, 0, '…donc aucune bille dans le résumé des traits — plus de « 1.70 Å × N »');
eq(covered.tris.count, 2, '…et ses triangles, eux, sont bien là : la scène projette par le maillage (2 triangles)');
ok(covered.filled === 0, '…et aucune capsule : un ruban ne se remplit pas de bâtons entre ses atomes');

/* ── 2. LE CONTRÔLE : LE MÊME RUBAN DONT LE MAILLAGE N'EST PAS LISIBLE ────── */
const unread = atomsFromStage(stageOf([cartoon()]), 100000);
eq(unread.count, N, 'un cartoon dont le maillage n’est pas encore lu garde ses atomes (le build est en file)');
[...unread.radii].forEach((r, i) => near(r, 0.45, 1e-6,
  `…et le trait du RUBAN (0,45 Å), pour l’atome ${i} — jamais sa bille de vdW`));

/* ── 3. LE CONTRÔLE : LE RUBAN (maillage lu) PLUS UN LICORICE ─────────────── */
const mixed = atomsFromStage(stageOf([
  cartoon({ bufferList: [{ geometry: indexedSurface() }] }),
  el('licorice', {
    type: 'licorice', visible: true, radiusType: 'size', radiusSize: 0.25,
    structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) },
  }),
]), 100000);
eq(mixed.count, 2, 'un ruban lu PLUS ses chaînes latérales : seules les chaînes latérales portent un proxy');
[...mixed.radii].forEach((r) => near(r, 0.25, 1e-6, '…au trait du licorice (0,25 Å), pas au rayon du ruban'));

/* ── 4. LE REPLI QUI DOIT RESTER : UN GENRE QUE LA TABLE NE CONNAÎT PAS ───── */
/* ⚠ `dot` EST ICI UN GENRE *FICTIF* — NGL 2.4 n'enregistre aucune représentation
   de ce nom, et le viewer demande donc `point` partout où il veut des pointillés
   (voir §8 et PROXY_STROKE_BY_TYPE). Ce qu'on mesure ici est la RÈGLE, pas le
   viewer : un genre dont la table ne dit rien garde le rayon de van der Waals de
   l'atome — le repli d'un dessin qu'on ne sait pas mesurer. */
const dot = atomsFromStage(stageOf([el('dot', {
  type: 'dot', visible: true, radiusScale: 1, structureView: allAtoms,
})]), 100000);
eq(dot.count, N, 'un genre inconnu (`dot`) dessine quand même ses atomes');
ok(maxStrokeRadiusOf(dot) > 1,
  '…et il garde le repli des rayons de van der Waals : un dessin illisible ne perd pas son ombre');

/* ── 5. LA RÈGLE D'AVANT, INTACTE : LISTÉ MAIS DESSINÉ PAR PERSONNE ───────── */
/* ⚠ LE RUBAN NE DESSINE ICI QUE [0, 1] (comme `cartoonRep` du banc historique) :
   c'est ce qui laisse [2, 3] « LISTÉS mais dessinés par personne ». Un ruban qui
   couvrirait les quatre atomes les dessinerait tous, et le compte serait 4 — ce
   que le banc ne cherche PAS à mesurer. */
const listed = atomsFromStage(stageOf([
  cartoon({ structureView: { getAtomIndices: () => Uint32Array.from([0, 1]) } }),
  { repr: { visible: true, structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) } } },
]), 100000);
eq(listed.count, 2,
  'un atome LISTÉ par une sélection que personne ne dessine n’entre pas dans le proxy (2 atomes, pas 4)');
ok([...listed.radii].every((r) => !(r > 1)),
  '…donc plus une seule bille de vdW dans l’ombre d’un ruban');

/* ── 6. LE MASQUE : LES PIXELS QUI TOMBAIENT HORS DU RUBAN ────────────────── */
/* Le banc du rapport : la caméra et la lampe de `rayShadowInputsOf`, le masque
   de `buildRayShadowMask`, et une passe caméra des SEULS TRIANGLES. Un pixel du
   masque que les triangles n'ont pas couvert est une ombre posée là où RIEN
   n'est dessiné — le fantôme. C'est le chiffre du rapport : 3 644 avant. */
const box = expandBoxOf(boundsBoxOf(covered.positions, covered.count), maxStrokeRadiusOf(covered) || 1);
const triBox = boundsBoxOf(covered.tris.positions, covered.tris.vertexCount);
const bounds = {
  min: [Math.min(box.min[0], triBox.min[0]), Math.min(box.min[1], triBox.min[1]), Math.min(box.min[2], triBox.min[2])],
  max: [Math.max(box.max[0], triBox.max[0]), Math.max(box.max[1], triBox.max[1]), Math.max(box.max[2], triBox.max[2])],
};
const center = [
  (bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2,
];
const radius = Math.max(1e-3, 0.5 * Math.sqrt(
  (bounds.max[0] - bounds.min[0]) ** 2 + (bounds.max[1] - bounds.min[1]) ** 2 + (bounds.max[2] - bounds.min[2]) ** 2,
));
const W = 400, H = 300;
const tan = Math.tan((40 * Math.PI) / 360);
const dist = (radius * 1.35) / tan;
const proj = [
  1 / ((W / H) * tan), 0, 0, 0,
  0, 1 / tan, 0, 0,
  0, 0, -((dist * 4) + 0.1) / ((dist * 4) - 0.1), -1,
  0, 0, (-2 * (dist * 4) * 0.1) / ((dist * 4) - 0.1), 0,
];
const cview = mat4LookAt([0, 0, -dist], [0, 0, 0], [0, 1, 0]);
const camera = { view: cview, clip: mat4Multiply(proj, cview) };
const LAMP = [Math.cos(0.26) * Math.cos(2.09), Math.cos(0.26) * Math.sin(2.09), Math.sin(0.26)];
const light = {
  dir: LAMP, center, radius, distance: radius * 100, bounds,
  ...shadowRigOf({ dir: LAMP, bounds, center, radius, distance: radius * 100 }),
};
/* ⚠ LE CONTRÔLE MESURE L'OMBRE DU RUBAN NON LU CONTRE LE MAILLAGE DU RUBAN LU.
   Le banc « non lu » n'a par définition AUCUN triangle à lui (le build est encore
   dans la file d'NGL) : rasteriser ses propres `tris` ne couvrirait rien et le
   contrôle serait vide par construction. La bande de référence est donc celle du
   MÊME ruban une fois lu — c'est elle qui porte le trait de 0,45 Å. */
const measure = (atoms, trisOf = atoms.tris) => {
  const shadow = buildRayShadowMask({ atoms, camera, light, width: W, height: H });
  const size = rayShadowMaskSize(W, H, {});
  const tris = trisOf;
  const triPass = tris.count ? rasterizeTriangles({
    positions: tris.positions, normals: tris.normals, indices: tris.indices, count: tris.count,
    clip: camera.clip, width: size.width, height: size.height, stride: tris.stride || 1,
  }) : { hit: new Uint8Array(size.width * size.height), drawn: 0 };
  let maskPx = 0, ghostPx = 0, onRibbon = 0;
  for (let i = 0; i < shadow.mask.length; i += 1) {
    if (!(shadow.mask[i] > 0.02)) continue;
    maskPx += 1;
    if (triPass.hit[i]) onRibbon += 1; else ghostPx += 1;
  }
  return {
    maskPx, ghostPx, onRibbon, drawn: triPass.drawn,
    covered: triPass.hit.reduce((a, v) => a + (v ? 1 : 0), 0),
  };
};
const ghostRead = measure(covered);
const unreadRead = measure(unread, covered.tris);
console.log(`RUBAN SEUL — maillage lu : ${ghostRead.maskPx} px d’ombre (${ghostRead.ghostPx} HORS du ruban)`);
console.log(`             maillage NON lu : ${unreadRead.maskPx} px d’ombre ` +
  `(${unreadRead.onRibbon} sur le ruban, ${unreadRead.covered} px couverts par lui)`);
eq(ghostRead.drawn, 2, 'les 2 triangles du ruban sont bien rasterisés : le banc regarde une vraie surface');
eq(ghostRead.ghostPx, 0,
  'AUCUN pixel d’ombre hors du ruban quand son maillage est lu — c’était 3 644 (la nuée de billes)');
ok(unreadRead.covered > 200,
  `…alors que le contrôle (maillage NON lu) projette bien sur le ruban : ${unreadRead.onRibbon} px d’ombre, ` +
  `${unreadRead.covered} px de couverture`);
ok(unreadRead.onRibbon > 0,
  '…et cette ombre-là est SUR la bande : le trait de 0,45 Å reste un occulteur, il n’est pas éteint');

/* ── 7. L'ORDRE DES REPRÉSENTATIONS NE COMPTE PAS ─────────────────────────── */
/* Le ZÉRO du maillage n'écrase JAMAIS un trait MESURÉ par une autre
   représentation — `drawnProxyRadiiOf` ne l'écrit que sur un `NaN` (ligne
   `if (!(out[a] >= 0)) out[a] = 0;`), et les traits s'y cumulent au MAXIMUM. Le
   licorice mis AVANT le ruban doit donc donner le même proxy que l'inverse :
   une scène dont l'ombre dépendrait de l'ordre d'empilement des styles serait un
   piège pour l'utilisateur qui réordonne ses représentations. */
const mixedReversed = atomsFromStage(stageOf([
  el('licorice', {
    type: 'licorice', visible: true, radiusType: 'size', radiusSize: 0.25,
    structureView: { getAtomIndices: () => Uint32Array.from([2, 3]) },
  }),
  cartoon({ bufferList: [{ geometry: indexedSurface() }] }),
]), 100000);
eq(mixedReversed.count, mixed.count,
  'licorice AVANT le ruban : le même nombre de proxies que ruban AVANT licorice');
[...mixedReversed.radii].forEach((r) => near(r, 0.25, 1e-6,
  '…et le même trait de 0,25 Å : le zéro du maillage ne mange pas un trait mesuré'));

/* ── 8. LA SCÈNE RÉELLE : LE RUBAN LU PLUS LES « DOTS » DES EAUX / IONS ───── */
/* Le viewer met des POINTILLÉS sur `sele: 'ion'` / `sele: 'water'` (voir
   NMRMoleculeViewer, bloc « Others ») et un cartoon sur la protéine : deux
   ENSEMBLES D'ATOMES DISJOINTS. ⚠ CES POINTILLÉS SONT DES `point`, PAS DES `dot` :
   NGL 2.4 n'enregistre aucune représentation `dot` (demander `dot` LÈVE, et le
   `try` du viewer ne dessinait alors RIEN), et un point est un POINT ÉCRAN — sans
   rayon en ångströms. Sa seule ombre honnête est donc un cheveu (0,15 Å), JAMAIS
   la bille de 1,7 Å du repli vdW, qui remplissait l'ombre d'une nuée de billes sur
   un dessin de points à peine visibles (« a shadow on a plane »). Le ruban, lui,
   ne double plus ses atomes d'une bille. Les deux règles vivent dans la MÊME scène
   sans se contredire. */
const waters = { getAtomIndices: () => Uint32Array.from([2, 3]) };
const ribbonPlusDots = atomsFromStage(stageOf([
  cartoon({
    structureView: { getAtomIndices: () => Uint32Array.from([0, 1]) },
    bufferList: [{ geometry: indexedSurface() }],
  }),
  el('point', { type: 'point', visible: true, pointSize: 2, structureView: waters }),
]), 100000);
eq(ribbonPlusDots.count, 2,
  'ruban lu + pointillés des eaux : seuls les pointillés émettent un proxy (2 atomes), pas le ruban');
[...ribbonPlusDots.radii].forEach((r) => near(r, 0.15, 1e-6,
  '…et ce proxy est un CHEVEU (0,15 Å) : un point ne pèse rien, il ne se replie jamais sur 1,7 Å'));
ok([...ribbonPlusDots.radii].every((r) => !(Number.isFinite(r) && r > 1)),
  '…donc aucune bille de vdW : ni celle du point, ni celle du ruban');

/* 8b. LE MÊME POINTILLÉ SEUL — le style léger « dots » d'un GRAND SYSTÈME (tout
   est en points, et rien d'autre : voir `ls === 'dots'` d'addDefaultReps). C'est
   la scène où le repli vdW faisait le plus de dégâts : 100 % des atomes y
   tombaient, et l'ombre d'un nuage de points devenait une nappe de billes de
   1,7 Å. Le cheveu est la seule réponse qui ne mente pas sur l'encre. */
const dotsOnly = atomsFromStage(stageOf([
  el('point', { type: 'point', visible: true, pointSize: 2, structureView: allAtoms }),
]), 100000);
eq(dotsOnly.count, N, 'un système tout en pointillés émet quand même ses atomes (ils sont dessinés)');
ok(maxStrokeRadiusOf(dotsOnly) <= 0.2,
  '…et AUCUN d’eux ne prend le rayon de van der Waals : l’ombre d’un point reste un point');

/* ── 9. LA RÈGLE, ÉCRITE DANS LE MODULE ───────────────────────────────────── */
ok(MODULE.includes('const coveredHere = !!(covered && covered.has(el));'),
  'le module NOMME le cas « maillage lu » au lieu de sortir en silence');
ok(MODULE.includes('if (!(out[a] >= 0)) out[a] = 0;'),
  '…et il écrit le ZÉRO qui dit « aucun proxy » (fini et nul, jamais un NaN) — sans écraser un trait mesuré');
ok(MODULE.includes('if (surface && measured && !(stroke > 0)) continue;'),
  'layOut écarte ces atomes-là : le maillage les dessine, aucune bille ne les double');
ok(MODULE.includes('if (surface && !measured && measurable) continue;'),
  '…et garde la règle d’avant pour un atome LISTÉ que personne ne dessine');

console.log(`\n_viewer_shadow_ghost_test.mjs — ${passed} assertions OK ` +
  '(un maillage lu ne se double pas d’une bille de vdW)');

