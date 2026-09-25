/* =========================================================================
   _viewer_shadow_backbone_test.mjs — UN TRAIT NE RÉPOND QUE DE CE QU'IL DESSINE.

   Le rapport : « in the ray button of the molecular viewer I have spheric
   shadows for bonds » — et sur l'image, les billes rondes tombent exactement sur
   les CYCLES et sur les RAMIFICATIONS des chaînes latérales.

   LA CAUSE, dans src/utils/viewerRayShadows.js : le Tube du squelette et le
   Licorice des chaînes latérales PARTAGENT UNE SEULE SÉLECTION (`sels.protein`),
   et NGL rend à une représentation la liste ENTIÈRE de sa sélection —
   `StructureView#getAtomIndices()` est `structure.getAtomIndices(selection)`
   (ngl 2.4, lu dans le dist installé, et MESURÉ ici : la sélection « protein »
   du banc rend les 12 atomes du peptide, chaînes latérales comprises). Le tube,
   lui, ne dessine QUE le squelette : par la règle « le dessin le plus épais
   gagne », chaque CB / CG recevait donc le trait du TUYAU (0,5 Å) au lieu des
   0,25 Å du bâton qui le dessine vraiment — deux fois son rayon réel, assez pour
   que les atomes d'un cycle ou d'une ramification, à une liaison les uns des
   autres, fusionnent en une seule bille ronde au lieu de se résoudre en bâtons.

   LA RÉPARATION : une représentation d'un genre « chaîne »
   (BACKBONE_ONLY_KINDS — spline / tube) ne répond plus que des atomes de
   squelette, en posant la question que NGL se pose lui-même
   (`AtomProxy#isBackbone()` → `residueType.backboneIndexList`, la liste dont le
   cartoon et le tube construisent leur géométrie). Le licorice est un trait de
   LIAISON : ses atomes restent liés et gardent leur propre rayon, donc les
   bâtons se remplissent normalement.

   CE QUI EST VÉRIFIÉ ICI :

     1. LE FAIT NGL, sur la bibliothèque INSTALLÉE (2.4.0) : `isBackbone()` dit
        vrai pour N · CA · C · O et faux pour CB · CG1 · CG2, sur UN SEUL proxy
        réindexé — et la sélection `protein` rend bien les 12 atomes du peptide,
        chaînes latérales comprises (c'est la liste partagée que le tube reçoit) ;
     2. LA RÉPARATION, EXÉCUTÉE : sur ce peptide réel, tube + licorice partageant
        la même StructureView → squelette 0,5 Å (le tuyau), chaînes latérales
        0,25 Å (le bâton), et TOUS les atomes dessinés liés ;
     3. L'ANCIEN DÉFAUT, REPRODUIT : la même liste partagée sur une structure qui
        ne sait pas répondre (aucun AtomProxy : un banc fabriqué, un NGL plus
        ancien) → 0,5 Å sur les chaînes latérales, la bille deux fois trop grosse
        du rapport ;
     4. LE GARDE-FOU : un tube posé sur une sélection SANS squelette (un ligand :
        `show tube, resn LIG`) garde son trait sur chaque atome qu'il liste —
        sinon le tuyau ne projette plus RIEN DU TOUT, la régression « un dessin
        fin ne fait aucune ombre » que le remplissage des liens répare ;
     5. DE BOUT EN BOUT, par `atomsFromStage`, et LA RÈGLE dans le module (la
        table des genres, la porte du filtre, le message du rapport cité).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/* LE MODULE ÉPROUVÉ. SHADOW_MODULE permet de rejouer cette suite sur une version
   d'AVANT le correctif — elle doit alors ÊTRE ROUGE (même idiome que
   _viewer_shadow_links_test.mjs) :
     git show <avant>:src/utils/viewerRayShadows.js > avant.js
     SHADOW_MODULE=./avant.js node _viewer_shadow_backbone_test.mjs
   Mesuré sur l'ancienne version : la 2e assertion du point 2 tombe — CG1 à
   0,50 Å au lieu de 0,25 Å (les 4 chaînes latérales du banc portent le trait du
   TUYAU), et le garde-fou du point 4 est vert « par accident » : sur cette
   version il n'y a aucun filtre à contourner. */
const MODULE_PATH = process.env.SHADOW_MODULE || './src/utils/viewerRayShadows.js';
const {
  atomsFromStage, drawnProxyRadiiOf, BACKBONE_ONLY_KINDS, LINKED_KINDS,
} = await import(MODULE_PATH);

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

const MODULE = readFileSync(new URL(MODULE_PATH, import.meta.url), 'utf8');


/* ── LE BANC : un dipeptide avec ses chaînes latérales, PLUS un ligand ───────
   ALA (N · CA · C · O · CB) et ILE (N · CA · C · O · CB · CG1 · CG2 — une
   RAMIFICATION, le motif de l'image), puis un ligand hétéro : le tube et le
   licorice partagent `protein` (indices 0-11), et le ligand (12, 13) n'est
   dessiné par aucune des deux. */
const ATOMS = [
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
const pdbLine = (i, [kind, resno, name, resname, x, y, z]) =>
  `${kind.padEnd(6)}${String(i + 1).padStart(5)} ${name.padEnd(4)} ${resname} A${String(resno).padStart(4)}`
  + `    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
  + `  1.00  0.00          ${name[0]}`;
const PDB = `${ATOMS.map((r, i) => pdbLine(i, r)).join('\n')}\nEND\n`;
const structure = await NGL.autoLoad(new Blob([PDB], { type: 'text/plain' }), { ext: 'pdb' });

const BACKBONE = [0, 1, 2, 3, 5, 6, 7, 8];   // N · CA · C · O des deux résidus
const SIDECHAIN = [4, 9, 10, 11];            // CB · CB · CG1 · CG2 (la ramification)
const LIGAND = [12, 13];
const ATOM_COUNT = ATOMS.length;

/* Une représentation RÉELLE de ngl 2.4 : l'élément porte le `name` (= le type),
   la représentation porte `type` + ses valeurs d'instance, et sa StructureView
   est celle qu'une représentation créée avec `sele: '<sélection>'` reçoit — elle
   rend TOUTE la sélection (le fait 1 ci-dessous). */
const view = (sele) => ({ getAtomIndices: () => structure.getAtomIndices(new NGL.Selection(sele)) });
const element = (type, rep) => ({ name: type, getType: () => type, type: 'representation', repr: rep });
const tubeOf = (sele = 'protein', radius = 0.5) => element('tube', {
  type: 'tube', visible: true, radiusType: 'size', radiusSize: radius, structureView: view(sele),
});
const stickOf = (sele = 'protein', radius = 0.25) => element('licorice', {
  type: 'licorice', visible: true, radiusType: 'size', radiusSize: radius, structureView: view(sele),
});
const cartoonOf = (sele = 'protein') => element('cartoon', {
  type: 'cartoon', visible: true, radiusScale: 0.7, radiusType: 'sstruc', structureView: view(sele),
});
const radiiOf = (comp) => drawnProxyRadiiOf(comp, ATOM_COUNT, new Float32Array(ATOM_COUNT).fill(1.7));


/* ── 1. LE FAIT NGL : LE SQUELETTE, ET LA LISTE QUE LE TUBE REÇOIT ─────────── */
eq(structure.atomCount, ATOM_COUNT, 'NGL a lu les 14 atomes du banc (dipeptide + ligand)');
eq(typeof structure.getAtomProxy, 'function',
  'une structure NGL expose `getAtomProxy()` : le correctif peut l’interroger');

const ap = structure.getAtomProxy();
const backboneFlags = [];
for (let i = 0; i < structure.atomCount; i += 1) {
  ap.index = i;
  backboneFlags.push(ap.isBackbone());
}
eq(backboneFlags, ATOMS.map((r) => ['N', 'CA', 'C', 'O'].includes(r[2])),
  'UN SEUL proxy réindexé : `isBackbone()` dit vrai pour N · CA · C · O et faux ailleurs');
ok(SIDECHAIN.every((i) => backboneFlags[i] === false),
  '…donc les 4 atomes des chaînes latérales (CB · CB · CG1 · CG2) sont « hors squelette »');
ok(LIGAND.every((i) => backboneFlags[i] === false),
  '…et le ligand aussi : il n’a aucun squelette à lui (c’est le cas du point 4)');

const selection = (sele) => [...structure.getAtomIndices(new NGL.Selection(sele))];
eq(selection('protein'), [...BACKBONE, ...SIDECHAIN].sort((a, b) => a - b),
  'LA LISTE PARTAGÉE : la sélection « protein » du tube rend les 12 atomes, CHAÎNES LATÉRALES COMPRISES');
eq(selection('sidechain'), SIDECHAIN, '…le licorice des chaînes latérales dessine exactement les 4 autres');
/* ── 2. LA RÉPARATION, EXÉCUTÉE : LE TUBE ET LE BÂTON PARTAGENT LA LISTE ─────
   L'ordre du viewer : le tube du squelette d'abord, puis les chaînes latérales
   en licorice, tous deux sur `sels.protein` — donc la MÊME liste de 12 atomes. */
const SHARED_LIST = [tubeOf(), stickOf()];
const links = new Uint8Array(ATOM_COUNT);
const shared = drawnProxyRadiiOf({ structure, reprList: SHARED_LIST }, ATOM_COUNT,
  new Float32Array(ATOM_COUNT).fill(1.7), links);
const plain = (f) => [...f].map((v) => (Number.isNaN(v) ? NaN : Number(v.toFixed(3))));
const expectFor = (v, idx) => ATOMS.map((_, i) => (idx.includes(i) ? v : NaN));

near(shared[0], 0.5, 1e-6, 'N1 (squelette) : 0,50 Å — le trait du TUYAU, comme avant');
near(shared[10], 0.25, 1e-6,
  'CG1 (chaîne latérale) : 0,25 Å — le trait du BÂTON, qui est ce que NGL dessine là');
near(shared[11], 0.25, 1e-6, '…idem CG2 : les deux branches de l’isoleucine ne sont plus des billes de 0,50 Å');
eq(plain(shared), ATOMS.map((_, i) => (LIGAND.includes(i) ? NaN : (BACKBONE.includes(i) ? 0.5 : 0.25))),
  'le vecteur entier : 0,50 Å sur le squelette, 0,25 Å sur les chaînes latérales, rien sur le ligand');
eq(plain(links), ATOMS.map((_, i) => (LIGAND.includes(i) ? 0 : 1)),
  '…et TOUS les atomes du dessin restent LIÉS : le licorice est un trait de liaison à lui seul');

/* Le tube seul : il ne répond plus que de son squelette — le reste n’est dessiné
   par personne dans cette composition, donc il ne projette rien (avant, chaque
   chaîne latérale recevait du tube une bille de 0,50 Å qu’il ne dessine pas). */
eq(plain(radiiOf({ structure, reprList: [tubeOf()] })), expectFor(0.5, BACKBONE),
  'un TUBE seul ne projette que son squelette : les chaînes latérales ne sont plus dessinées');
/* …et le bâton seul dessine tout ce qu’il liste, à son propre rayon. */
eq(plain(radiiOf({ structure, reprList: [stickOf()] })), expectFor(0.25, [...BACKBONE, ...SIDECHAIN]),
  'un LICORICE seul projette ses 12 atomes à 0,25 Å — c’est lui qui porte les chaînes latérales');
/* Le cartoon suit le tube (même genre « chaîne ») : ruban sur le squelette seul. */
eq(plain(radiiOf({ structure, reprList: [cartoonOf()] })), expectFor(0.45, BACKBONE),
  'un CARTOON (genre spline) ne répond lui aussi que du squelette — 0,45 Å de ruban');


/* ── 3. L'ANCIEN DÉFAUT, REPRODUIT : SANS AtomProxy, LA BILLE DOUBLE ─────────
   La même liste partagée sur un objet qui ne sait pas répondre (un banc
   fabriqué, un NGL plus ancien, un AtomProxy sans `isBackbone`) : le filtre
   n’est pas posé, le tube garde la liste entière et « le plus épais gagne »
   donne 0,50 Å à chaque chaîne latérale — exactement les billes du rapport. */
const legacyRadii = (structureLike) => plain(drawnProxyRadiiOf(
  { structure: structureLike, reprList: [tubeOf(), stickOf()] }, ATOM_COUNT,
  new Float32Array(ATOM_COUNT).fill(1.7),
));
eq(legacyRadii({ atomCount: ATOM_COUNT, getAtomData: () => ({ radius: 1.7 }) }),
  ATOMS.map((_, i) => (LIGAND.includes(i) ? NaN : 0.5)),
  'sans `getAtomProxy` : 0,50 Å sur TOUT le peptide — la chaîne latérale deux fois trop épaisse');
eq(legacyRadii({ getAtomProxy: () => ({ index: 0 }) }),
  ATOMS.map((_, i) => (LIGAND.includes(i) ? NaN : 0.5)),
  '…et un proxy qui ne sait pas répondre (aucun `isBackbone`) laisse le module exactement comme avant');


/* ── 4. LE GARDE-FOU : UN TUBE SANS SQUELETTE RESTE UN DESSIN ───────────────
   Un script PyMOL peut poser un tube sur un ligand (`show tube, resn LIG`) : sa
   liste ne contient AUCUN atome de squelette et `isBackbone()` est faux pour
   tous — et pourtant NGL dessine ce tube-là. Le filtre ne s'applique donc qu'aux
   représentations dont la liste porte AU MOINS UN atome de squelette : sans ce
   garde-fou, ce tube ne projetterait plus RIEN, la régression « un dessin fin ne
   fait aucune ombre » que le remplissage des liens répare. */
const ligandLinks = new Uint8Array(ATOM_COUNT);
const ligandTube = drawnProxyRadiiOf({ structure, reprList: [tubeOf('hetero')] }, ATOM_COUNT,
  new Float32Array(ATOM_COUNT).fill(1.7), ligandLinks);
eq(plain(ligandTube), expectFor(0.5, LIGAND),
  'un tube sur une sélection SANS squelette garde son trait sur tout ce qu’il liste (0,50 Å)');
eq(plain(ligandLinks), ATOMS.map((_, i) => (LIGAND.includes(i) ? 1 : 0)),
  '…et ses liens aussi : le tuyau reste rempli, il ne s’efface pas du masque');
eq(plain(drawnProxyRadiiOf({ structure, reprList: [tubeOf('hetero'), tubeOf('protein')] }, ATOM_COUNT,
  new Float32Array(ATOM_COUNT).fill(1.7))),
ATOMS.map((_, i) => (SIDECHAIN.includes(i) ? NaN : 0.5)),
  'la porte est posée PAR REPRÉSENTATION : le tube du ligand dessine, celui du peptide est filtré');


/* ── 5. DE BOUT EN BOUT : LES PROXIES, PAR `atomsFromStage` ────────────────── */
const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const stage = {
  compList: [{
    structure,                 // la VRAIE structure NGL : getAtomData, eachBond, atomCount…
    matrix: { elements: IDENT16 },
    reprList: SHARED_LIST,     // le tube du squelette ET les bâtons des chaînes latérales
  }],
};
const atoms = atomsFromStage(stage, 1e5);
eq(atoms.total, 12, 'les 12 atomes du dessin — le ligand n’est dessiné par personne, donc il ne projette rien');
eq(atoms.stride, 1, '…sans budget serré, donc un proxy par atome, dans l’ordre des indices');
eq(atoms.count - 12, atoms.filled, 'les atomes d’abord, puis les proxies qui bouchent leurs liens');
ok(atoms.filled > 0, '…et il y en a : le tube du squelette ET les bâtons se remplissent');
near(atoms.radii[0], 0.5, 1e-6, 'le 1er atome du dessin (N1) porte le trait du TUYAU');
near(atoms.radii[4], 0.25, 1e-6, '…le 5e (CB1, première chaîne latérale) celui du BÂTON');
near(atoms.radii[10], 0.25, 1e-6, '…et CG1 aussi : plus aucune chaîne latérale à 0,50 Å dans le proxy');


/* ── 6. LA TABLE DES GENRES, ET LA RÈGLE DANS LE MODULE ───────────────────── */
eq(BACKBONE_ONLY_KINDS, { spline: 1, tube: 1 },
  'la table des genres « chaîne » : spline (cartoon · ribbon · rope · trace) et tube');
ok(Object.isFrozen(BACKBONE_ONLY_KINDS), '…gelée, comme les autres tables du module');
eq(BACKBONE_ONLY_KINDS.bond, undefined,
  'un trait de LIAISON (licorice · base · backbone) ne filtre RIEN : il dessine les atomes qu’il liste');
eq(BACKBONE_ONLY_KINDS.ball, undefined, '…idem une bille (ball+stick) : elle est l’atome lui-même');
eq(BACKBONE_ONLY_KINDS.vdw, undefined, '…idem une sphère (sphere / spacefill / surface)');
eq(BACKBONE_ONLY_KINDS.hair, undefined, '…idem un trait fin (line / wireframe)');
eq(LINKED_KINDS.bond, 1, '…et les bâtons restent des traits LINÉAIRES : leurs liens sont bien remplis');

ok(MODULE.includes('export const BACKBONE_ONLY_KINDS = Object.freeze({ spline: 1, tube: 1 });'),
  'la table est exportée, donc lisible et testable');
ok(MODULE.includes('const chainOnly = BACKBONE_ONLY_KINDS[kind] === 1 && drawsBackboneOf(ap, idx);'),
  'la PORTE : le filtre n’est posé que si la représentation marche vraiment une chaîne');
ok(MODULE.includes('const drawsBackboneOf = (ap, idx) => {'),
  '…et cette porte est une fonction à part, donc lisible et testable');
ok(MODULE.includes('if (!ap.isBackbone()) continue;    // the spline does not draw here'),
  '…l’atome hors squelette sort du tour AVANT de concourir pour le rayon et pour le lien');
ok(MODULE.includes("const ap = atomProxyOf(comp && comp.structure);"),
  '…le proxy de la structure est lu UNE fois par composition, pas par atome');
ok(MODULE.includes("typeof structure.getAtomProxy !== 'function'"),
  '…et une structure qui ne l’expose pas (un banc fabriqué) ne change rien du tout');
ok(MODULE.includes("typeof ap.isBackbone === 'function'"),
  '…un AtomProxy sans `isBackbone` (NGL plus ancien) laisse le module exactement comme avant');
ok(MODULE.includes('spheric shadows for bonds'),
  '…et le module porte le rapport, pour que la prochaine lecture sache POURQUOI ce filtre existe');
ok(MODULE.includes('list it shares with the sticks are drawn by the sticks'),
  '…la règle est dite : les autres atomes de la liste partagée sont dessinés par les bâtons, à LEUR trait');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_viewer_shadow_backbone_test.mjs — ${passed} assertions OK (un trait ne répond que de ce qu'il dessine)`);




