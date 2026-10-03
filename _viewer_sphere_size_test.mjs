/* =========================================================================
   _viewer_sphere_size_test.mjs — LA TAILLE D'UNE BILLE, ET SON OMBRE.

   LE RAPPORT DE CETTE SESSION, MOT POUR MOT : « it works well untill I select
   backbone in general and I see the white and black spheres appearing (i guess
   they are the sphere representations of the side chains). when I touch the style
   of the side chain they disappear but if I launch an MD i see the shadows on a
   back plane ».

   LES DEUX MOTIFS, ET LA MÊME CAUSE. Le viewer écrivait la taille de ses sphères
   en `scale` (`spacefill`, `scale: 0.6` / `0.25` / …) — un paramètre qu'NGL 2.4
   N'A PAS :

     · `StructureRepresentation#getRadiusParams()` ne rend que
       `{ type, scale: this.radiusScale, size: this.radiusSize, data }`, et
       `RadiusFactory#atomRadius` rend `return Math.min(r * this.scale, this.max)`
       — le rayon d'une bille est donc `min(rayonVdW × radiusScale, 10)` ;
     · `Representation#setParameters` SAUTE tout nom absent de la table de la
       représentation (`if (tp[name] == undefined) continue`) : `scale` n'est ni
       rangé ni transmis à un tampon ;
     · le shader d'une bille lit `attribute float radius` et son fragment ne
       déclare aucun uniforme `scale` — rien ne pourrait réduire la bille.

   Donc : un `addRepresentation('spacefill', { scale: 0.25 })` dessinait des billes
   de PLEIN rayon de van der Waals. C'est ce que voyait le rapport — « white and
   black spheres » (la couleur par élément : C sombre, H blanc) — sur le style léger
   « spheres » d'un GRAND SYSTÈME (au-delà de 25 000 atomes : un box MD, d'où « if I
   launch an MD »), qui disparaît dès qu'un geste de style quitte le rendu léger
   (« when I touch the style of the side chain they disappear »). Et l'ombre, elle,
   LISAIT ce `scale` : elle mesurait des billes de 0,425 Å sous un dessin de 1,7 Å →
   la nappe de billes du rapport, « shadows on a back plane ».

   LA RÈGLE, DONC : la taille d'une sphère s'écrit dans `radiusScale`, le seul champ
   qu'NGL lit ET que le proxy des ombres lit — les deux ne peuvent plus différer. Et
   les « pointillés » du viewer sont des `point` (NGL n'enregistre AUCUNE `dot` :
   la demander lève, et le `try` ne dessinait alors RIEN) : un point est un point
   écran, il porte un cheveu d'ombre, jamais le repli vdW.

   Mesuré ici : sur le PAQUET NGL INSTALLÉ (ses sources sont dans sa source-map),
   sur le module des ombres (exécuté), et sur le viewer (ses appels).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROXY_STROKE_BY_TYPE, atomsFromStage, maxStrokeRadiusOf, proxyRadiiOf, proxyRadiusOf,
} from './src/utils/viewerRayShadows.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const near = (a, b, eps, what) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu : ${b}\n  obtenu  : ${a}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8');

/* ── 1. CE QUE DIT NGL LUI-MÊME (le paquet installé) ──────────────────────── */
/* La mesure qui a motivé ce banc : les sources d'NGL 2.4 sont dans la source-map
   de son paquet. On y lit le rayon d'une bille et la table des paramètres d'une
   `spacefill` — c'est le SEUL juge, et il ne bougera pas sans qu'on le sache. */
let nglSources = null;
try {
  const map = JSON.parse(readFileSync(new URL('./node_modules/ngl/dist/ngl.esm.js.map', import.meta.url), 'utf8'));
  nglSources = (map.sources || []).map((n, i) => [n, (map.sourcesContent || [])[i] || '']);
} catch { nglSources = null; }
if (nglSources) {
  const find = (re) => nglSources.filter(([n]) => re.test(n));
  const radiusFactory = find(/radius-factory\.ts$/)[0];
  ok(!!radiusFactory, 'NGL livre la fabrique de rayons (radius-factory.ts)');
  ok(radiusFactory[1].includes('return Math.min(r * this.scale, this.max)'),
    '…et le rayon d’une bille y vaut `min(r × scale, 10)` — le `scale` d’ici ÉTANT `radiusScale`');
  ok(radiusFactory[1].includes("case 'vdw':") && radiusFactory[1].includes('r = a.vdw'),
    '…avec `r` = le rayon de van der Waals pour un `radiusType: vdw` (le défaut)');
  const spacefill = find(/representation\/spacefill-representation\.ts$/)[0];
  ok(!!spacefill, 'NGL livre la représentation spacefill');
  ok(!/p\.scale\b|radiusParams\.scale =/.test(spacefill[1]),
    '…et elle ne touche JAMAIS à un paramètre `scale`');
  const structureRep = find(/representation\/structure-representation\.ts$/)[0];
  ok(!!structureRep && structureRep[1].includes('scale: this.radiusScale,'),
    'la table de rayon d’une structure ne rend que `scale: this.radiusScale` — il n’y a pas de second `scale`');
  const parametersLine = find(/representation\/representation\.ts$/)[0];
  ok(!!parametersLine && parametersLine[1].includes('if (tp[ name ] == undefined ) continue'),
    '…et `Representation#setParameters` SAUTE un nom absent de la table (le `scale` du viewer était donc rangé nulle part)');
  const impostor = find(/buffer\/sphereimpostor-buffer\.ts$/)[0];
  ok(!!impostor, 'NGL livre le tampon des billes (sphereimpostor-buffer)');
  ok(impostor[1].includes("'radius': { type: 'f', value: null }"),
    '…dont le rayon est un ATTRIBUT (`radius`), pas un réglage du matériau');
  ok(!/['"]scale['"]/.test(impostor[1]),
    '…et qui n’ajoute AUCUN uniforme `scale` : rien ne peut réduire la bille au rendu');
} else {
  ok(true, 'paquet NGL absent : le fait mesuré reste cité dans l’en-tête de ce banc');
}

/* ── 2. LE MODULE DES OMBRES ──────────────────────────────────────────────── */
/* Le proxy suit le rayon d'NGL : `radiusScale` d'abord, et un `point` est un
   cheveu. Ces deux règles sont ce qui empêche l'ombre de mentir sur l'encre. */
eq(PROXY_STROKE_BY_TYPE.point, { kind: 'hair', min: 0.15 },
  'un `point` (les pointillés du viewer) est un CHEVEU dans la table, pas une bille');
eq(PROXY_STROKE_BY_TYPE.spacefill.kind, 'vdw',
  'une `spacefill` se mesure en rayons de van der Waals');
near(proxyRadiusOf({ parameters: { type: 'spacefill', radiusType: 'vdw', radiusScale: 0.25 } }, 1.7),
  1.7 * 0.25, 1e-9,
  'spacefill : `radiusScale: 0.25` projette 25 % du rayon de van der Waals — la valeur qu’NGL DESSINE');
eq(proxyRadiiOf({ parameters: { type: 'spacefill', radiusType: 'vdw', radiusScale: 0.25 } }, 1.7).link, 0,
  '…et aucune capsule : une bille ne dessine aucun bâton');

/* ── 3. LE VIEWER N'ÉCRIT PLUS UN `scale` QU'UNE `spacefill` IGNORE ──────── */
/* Le CODE, sans ses commentaires : les nombres cités dans la prose (« CPK
   demandait `scale: 0.6` depuis toujours » …) ne sont pas des appels, et une
   phrase ne doit jamais faire passer — ou échouer — une mesure. */
const MASKED = VIEW
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const codeLines = MASKED.split(/\r?\n/);
const sphereCallAt = codeLines
  .map((l, i) => [i, l])
  .filter(([, l]) => /'spacefill'/.test(l)
    && /(add\(|addRow\(|addRepresentation\(|reps\.push\(|addWithOverrides\(|type: 'spacefill')/.test(l));
ok(sphereCallAt.length >= 8,
  `le viewer pose des billes un peu partout (${sphereCallAt.length} appels à \`spacefill\`) : elles doivent TOUTES porter un rayon lisible`);
/* ⚠ DEUX FAÇONS HONNÊTES DE DIRE UN RAYON, ET UNE SEULE INERTE : `radiusScale`
   (une fraction du rayon de van der Waals — les styles « CPK » / « Sphere ») ou
   `radius` / `radiusSize` (des ångströms — les billes de surbrillance, 0,4 Å). Le
   paramètre `scale`, lui, n'est lu par personne. La lecture regarde la fenêtre de
   l'appel, parce qu'un objet de paramètres s'écrit sur plusieurs lignes. */
const radiuslessCalls = sphereCallAt
  .filter(([i]) => !/radiusScale:|radius:/.test(codeLines.slice(i, i + 4).join(' ')))
  .map(([, l]) => l.trim());
eq(radiuslessCalls, [],
  `chaque appel à \`spacefill\` dit un rayon qu’NGL sait lire : ${radiuslessCalls.join(' | ')}`);
const scaleOnly = sphereCallAt
  .filter(([i]) => /(^|[^A-Za-z])scale:/.test(codeLines.slice(i, i + 4).join(' '))
    && !/radiusScale:/.test(codeLines.slice(i, i + 4).join(' ')))
  .map(([, l]) => l.trim());
eq(scaleOnly, [],
  `…et aucun ne compte sur l’inertie d’un \`scale\` : ${scaleOnly.join(' | ')}`);
/* ⚠ `radiusScale:` et `colorScale:` ne comptent pas : on cherche le mot `scale`
   SEUL, celui qu'NGL saute (`if (tp[name] == undefined) continue`). */
const inertScale = codeLines
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /(^|[^A-Za-z])scale:/.test(l))
  .filter(([, l]) => !/radiusScale:|colorScale:|sphereScale/.test(l))
  .filter(([, l]) => l.trim().length > 0);
eq(inertScale, [],
  `aucun paramètre \`scale\` INERTE (NGL l'ignore) : ${inertScale.map(([n, l]) => `${n}: ${l.trim()}`).join(' | ')}`);
/* La coupe des sphères, telle que les libellés la promettent (« CPK » = 60 %, la
   rangée des ions 80 %, l'eau 25 %, les sucres 70 %) : ces nombres doivent être
   DANS le rayon. */
['radiusScale: g.sphere * 0.6', 'radiusScale: g.sphere * 0.7', 'radiusScale: g.sphere * 0.8',
  'radiusScale: g.sphere * 0.25', 'radiusScale: g.sphere * 0.4'].forEach((needle) => {
  ok(VIEW.includes(needle), `la coupe d’un style de sphères vit dans le rayon : « ${needle} »`);
});
ok(VIEW.includes("radiusScale: sphere * (kind === 'ion' ? 1 : 0.6)"),
  'la rangée « CPK » des sections écrit son 60 % dans `radiusScale`');
ok(VIEW.includes('radiusScale: sphere }'), '…et « Sphere » garde le plein rayon de van der Waals');

/* ── 4. LES POINTILLÉS SONT DES `point`, JAMAIS DES `dot` ─────────────────── */
/* NGL 2.4 n'enregistre AUCUNE représentation `dot` : la demander lève, et le
   `try`/`catch` d'`add` ne dessinait alors RIEN — les trois « pointillés » du
   viewer (le style léger « dots », les ions, l'eau) apparaissaient vides. */
ok(!/add(Representation)?\(\s*'dot'/.test(VIEW),
  'le viewer ne demande plus jamais `dot` (une représentation qu’NGL 2.4 n’a pas)');
ok(VIEW.includes("add('point', { sele: 'ion'"), 'les ions en pointillés demandent `point`');
ok(VIEW.includes("add('point', { sele: 'water'"), '…et l’eau aussi');
ok(VIEW.includes("addRepresentation('point', lightParams({ pointSize: 1.5, sizeAttenuation: true }))"),
  'le style léger « dots » d’un grand système demande `point` — avec sa taille en pixels');
ok(VIEW.includes("radiusScale: 0.25, quality: 'low'"),
  '…et son voisin « spheres » une VRAIE fraction du rayon de van der Waals');

/* ── 5. EXÉCUTÉ : LES SCÈNES DU RAPPORT ───────────────────────────────────── */
const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const POS = Float32Array.from([0, 0, 0, 1.5, 0.4, 0, 3.0, 0.8, 0, 4.5, 1.2, 0]);
const N = POS.length / 3;
const structure = {
  atomCount: N,
  getAtomData: () => ({ position: POS, radius: new Float32Array(N).fill(1.7) }),
  eachBond: (cb) => { for (let i = 0; i + 1 < N; i += 1) cb({ atomIndex1: i, atomIndex2: i + 1 }); },
  eachResidue: (cb) => { for (let i = 0; i < N; i += 1) cb({ traceAtomIndex: i }); },
};
const allAtoms = { getAtomIndices: () => Uint32Array.from({ length: N }, (_, i) => i) };
const el = (type, rep) => ({ name: type, getType: () => type, type: 'representation', repr: rep, parameters: {} });
const stageOf = (reprList) => ({ compList: [{ structure, matrix: { elements: IDENT16 }, reprList }] });

/* LE GRAND SYSTÈME EN « spheres » : la taille du rendu léger telle que le viewer
   l'écrit maintenant — et l'ombre qui en découle. */
const lightSpheres = atomsFromStage(stageOf([
  el('spacefill', {
    type: 'spacefill', visible: true, radiusType: 'vdw', radiusScale: 0.25,
    quality: 'low', structureView: allAtoms,
  }),
]), 100000);
eq(lightSpheres.count, N, 'la vue légère en sphères émet un proxy par atome dessiné');
[...lightSpheres.radii].forEach((r) => near(r, 1.7 * 0.25, 1e-6,
  '…de 0,425 Å : la taille DESSINÉE (25 % du rayon de van der Waals), pas 1,7 Å'));
ok(maxStrokeRadiusOf(lightSpheres) < 0.6,
  '…donc plus une seule bille de van der Waals dans l’ombre d’un grand système');

/* LE GRAND SYSTÈME EN « dots » : le style le plus léger, celui qui apparaissait
   VIDE (aucune représentation `dot`) — et, si un point gardait le repli vdW, la
   scène où l'ombre se remplissait d'une nuée de billes. */
const lightDots = atomsFromStage(stageOf([
  el('point', { type: 'point', visible: true, pointSize: 1.5, sizeAttenuation: true, structureView: allAtoms }),
]), 100000);
eq(lightDots.count, N, 'la vue légère en pointillés dessine ses atomes (et `point` existe, lui)');
ok(maxStrokeRadiusOf(lightDots) <= 0.2,
  `…et aucun ne prend le rayon de van der Waals : ${maxStrokeRadiusOf(lightDots).toFixed(2)} Å par point`);

console.log(`\n_viewer_sphere_size_test.mjs — ${passed} assertions OK ` +
  '(une bille se mesure en radiusScale, un point ne pèse rien)');
