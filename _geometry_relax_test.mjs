/* =========================================================================
   _geometry_relax_test.mjs — LE « MODEL BUILD » : UNE MOLÉCULE VALIDE APRÈS
   AVOIR DIT LES LIAISONS.

   La demande, mot pour mot : « in HyperChem there was a function “model build”
   that created a chemically valid model after the bonds had been specified ; that
   is what I was looking for after specifying the disulphide bridges. Changing the
   dihedral angles by hand is useful but it is a lot of work. Better still would be
   an energy minimisation in which the energy is a TARGET FUNCTION — the sum of the
   deviations of the distances and angles from the normal distances and angles of
   molecules (sp3 carbon with tetrahedral angles, sp2 with 120° and sp with 180°,
   and the typical C–C, C–N, C–H, C–O bond lengths). The user defines the distance
   between two atoms and the program starts moving the two atoms towards each other
   at every step, moving the atoms that no longer respect their angles and bonds,
   until the molecule has moved enough to bring together the atoms that must be
   close. »

   Ce qui doit rester vrai, § par § :

     §1 les tables (C–C 1.54, C–H 1.09, et le S–S 2.05 Å du pont disulfure) ;
     §2 l'hybridation lue sur les LIAISONS (sp3 109.47 · sp2 120 · sp 180) ;
     §3 les cycles — le benzène est PLAN, le cyclohexane et un sucre ne le sont pas ;
     §4 le graphe, les termes, et les angles de chaque sommet ;
     §5 le GRADIENT ANALYTIQUE vérifié par DIFFÉRENCES FINIES : une dérivée écrite
        à la main ne vaut rien tant qu'on ne l'a pas mesurée ;
     §6 la descente, exécutée : une chaîne étirée revient à 1.54 Å et 109.47°, une
        chaîne EXACTEMENT alignée en sort aussi (le col de l'angle plat), les atomes
        hors fenêtre ne bougent pas d'un chiffre, deux appels identiques donnent le
        MÊME résultat, l'argument reçu n'est jamais modifié ;
     §7 la distance DEMANDÉE : deux atomes rapprochés pas à pas, la contrainte
        atteinte, la géométrie tenue — et le rapport qui dit la VÉRITÉ quand il
        n'atteint pas la cible ;
     §8 un VRAI NGL : un PDB écrit à la main est parsé, ses liaisons viennent du
        fichier, la descente écrit dans la structure (positionFromArray), le PDB
        exporté est RELU et remesuré ;
     §9 le branchement du viewer (le bouton, la fenêtre, l'écriture, le journal ↺).

   Run: node _geometry_relax_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  HYBRID_ANGLES, IDEAL_BOND_LENGTHS, BOND_ORDER_SHORTENING, PLANAR_RING_SIZES,
  PLANAR_RING_MAX_BOND, RELAX_WEIGHTS, RELAX_PAIR_TOLERANCE,
  bondLengthTarget, bondGraphOf, ringSizeThrough, hybridOf, angleTargetOf,
  buildRelaxTerms, energyOf, pairReportOf, relaxWindow, relaxGeometry, flatPositions,
} from './src/utils/geometryRelax.js';
import { SS_BOND_LENGTH } from './src/utils/disulfideFold.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, tol = 1e-6) => {
  assert.ok(Math.abs(Number(a) - Number(b)) <= tol,
    `${what}\n  attendu : ${b} ± ${tol}\n  obtenu  : ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const MODULE = read('src/utils/geometryRelax.js');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');

const angleDeg = (a, b, c) => {
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const nu = Math.hypot(u[0], u[1], u[2]); const nv = Math.hypot(v[0], v[1], v[2]);
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
};
const atomAt = (flat, i) => [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
const distOf = (flat, i, j) => Math.hypot(
  flat[i * 3] - flat[j * 3], flat[i * 3 + 1] - flat[j * 3 + 1], flat[i * 3 + 2] - flat[j * 3 + 2],
);

/* ════════════ 1. LES TABLES — les chiffres que la demande cite ═══════════════
   Le module est PUR (aucun import), comme tous les utils du dossier, et ses
   longueurs sont celles qu'un chimiste écrit au tableau. */
ok(!/^import\s/m.test(MODULE), 'le module est PUR (aucun import), comme les autres utils');
eq(IDEAL_BOND_LENGTHS['C-C'], 1.54, 'C–C : 1.54 Å, la longueur du rapport');
eq(IDEAL_BOND_LENGTHS['C-N'], 1.47, 'C–N : 1.47 Å');
eq(IDEAL_BOND_LENGTHS['C-O'], 1.43, 'C–O : 1.43 Å');
eq(IDEAL_BOND_LENGTHS['C-H'], 1.09, 'C–H : 1.09 Å');
eq(IDEAL_BOND_LENGTHS['S-S'], SS_BOND_LENGTH,
  '⚠ S–S : LA MÊME longueur que le pont disulfure de utils/disulfideFold.js (2.05) — une seule vérité dans le dossier');
eq(HYBRID_ANGLES, { sp3: 109.47, sp2: 120, sp: 180 },
  'les trois angles de la demande : tétraèdre, triangle plan, ligne');
near(BOND_ORDER_SHORTENING[2], 0.2, 'une liaison double retire 0.20 Å (C–C 1.54 → 1.34)', 1e-9);
near(BOND_ORDER_SHORTENING[3], 0.34, '…une triple 0.34 Å (C≡C 1.20)', 1e-9);
eq([...PLANAR_RING_SIZES], [5, 6], 'seuls les cycles de 5 et 6 peuvent être plans');
eq(PLANAR_RING_MAX_BOND, 1.45, 'le seuil qui sépare le benzène (1.39) du cyclohexane (1.53)');
eq(RELAX_WEIGHTS.bond, 200, 'un écart de 0.1 Å sur une liaison coûte 2 (poids × écart²)');
eq(RELAX_WEIGHTS.angle, 0.2, '…un écart de 10° sur un angle coûte 20 — les deux familles se tiennent de près');
eq(RELAX_WEIGHTS.pair, 50, '…et la distance DEMANDÉE pèse un quart d’une liaison : elle pilote sans écraser');

eq(bondLengthTarget('C', 'C'), 1.54, 'un couple connu rend sa longueur simple');
eq(bondLengthTarget('H', 'O'), 0.96, '…dans n’importe quel ordre (H–O comme O–H)');
eq(bondLengthTarget('c', ' o '), 1.43, '…et sans se soucier de la casse ni des espaces');
near(bondLengthTarget('C', 'O', 2), 1.23, 'un ordre 2 raccourcit : C=O 1.23 Å (une cétone)', 1e-9);
near(bondLengthTarget('C', 'C', 3), 1.20, 'un ordre 3 : C≡C 1.20 Å', 1e-9);
eq(bondLengthTarget('C', 'ZN'), null, 'un couple absent de la table ne rend AUCUNE longueur inventée');
eq(bondLengthTarget('', 'C'), null, '…et un élément vide non plus');

/* ════════════ 2. L'HYBRIDATION, LUE SUR LES LIAISONS ════════════════════════ */
eq(hybridOf({ element: 'C', degree: 3 }), 'sp3',
  'un carbone à trois voisins (le CH du propane) est tétraédrique : 109.47°');
eq(hybridOf({ element: 'C', degree: 2 }), 'sp3',
  '…deux voisins sans cycle ni double liaison aussi (le CH₂ du propane)');
eq(hybridOf({ element: 'C', degree: 1 }), null, 'un atome terminal n’a aucun angle à respecter');
eq(hybridOf({ element: 'H', degree: 1 }), null, 'un hydrogène non plus');
eq(hybridOf({ element: 'C', degree: 3, maxOrder: 2 }), 'sp2',
  'une double liaison déclarée → 120°, quel que soit le nombre de voisins');
eq(hybridOf({ element: 'C', degree: 2, maxOrder: 3 }), 'sp',
  'une triple liaison déclarée → 180° (le carbone d’un alcyne)');
eq(hybridOf({ element: 'C', degree: 2, ringSize: 6, ringBondMean: 1.39 }), 'sp2',
  'un cycle de six dont les liaisons mesurent 1.39 Å : le benzène, plan (120°)');
eq(hybridOf({ element: 'C', degree: 2, ringSize: 6, ringBondMean: 1.53 }), 'sp3',
  '⚠ …mais un cycle de six à 1.53 Å est un CYCLOHEXANE : 109.47°, jamais 120°');
eq(hybridOf({ element: 'C', degree: 2, ringSize: 4, ringBondMean: 1.55 }), 'sp3',
  'un cycle de quatre est coudé, même court');
eq(hybridOf({ element: 'C', degree: 2, ringSize: 6 }), 'sp3',
  '⚠ SANS géométrie, un cycle n’est JAMAIS déclaré plan : mieux vaut un 109.47° prudent');
eq(angleTargetOf('sp3'), 109.47, 'la cible d’un sommet sp3');
eq(angleTargetOf('sp2'), 120, '…d’un sp2');
eq(angleTargetOf('sp'), 180, '…d’un sp');
eq(angleTargetOf(null), null, '…et rien du tout pour un atome sans hybridation');

/* ════════════ 3. LES CYCLES ═════════════════════════════════════════════════ */
/* Un graphe à la main : les anneaux d'une liste d'anneaux. */
const ringGraph = (rings) => {
  const adj = new Map();
  const link = (i, j) => { const l = adj.get(i); if (l) l.push(j); else adj.set(i, [j]); };
  rings.forEach((r) => r.forEach((a, i) => {
    const b = r[(i + 1) % r.length];
    link(a, b); link(b, a);
  }));
  return (i) => adj.get(i) || [];
};
const benzeneRing = ringGraph([[0, 1, 2, 3, 4, 5]]);
eq(ringSizeThrough({ neighbours: benzeneRing, atom: 0 }), 6, 'le cycle du benzène fait six atomes');
eq(ringSizeThrough({ neighbours: benzeneRing, atom: 3 }), 6, '…et chaque atome du cycle le voit');
eq(ringSizeThrough({ neighbours: ringGraph([[0, 2, 3, 6]]), atom: 0 }), 4, 'un cycle de quatre se compte aussi');
const chainOnly = (i) => (i > 0 && i < 9 ? [i - 1, i + 1] : [1]);
eq(ringSizeThrough({ neighbours: chainOnly, atom: 4 }), 0, 'une chaîne n’a aucun cycle');
eq(ringSizeThrough({ neighbours: (i) => (i === 0 ? [1] : [0]), atom: 0 }), 0,
  'un atome à un seul voisin non plus (aucun couple de voisins à relier)');
eq(ringSizeThrough({ neighbours: null, atom: 0 }), 0, 'sans graphe : aucun cycle, jamais une exception');
eq(ringSizeThrough({ neighbours: benzeneRing, atom: -1 }), 0, 'un indice invalide non plus');
const fused = ringGraph([[0, 1, 2, 3, 4, 5], [1, 6, 7, 8, 2]]);
eq(ringSizeThrough({ neighbours: fused, atom: 1 }), 5, 'dans un système fusionné, c’est le plus PETIT cycle qui compte');
/* Un sucre : le cycle de cinq atomes d'un furanose (C1'–C4'–O4') ne doit pas
   passer pour du benzène — la longueur de ses liaisons (1.52 Å) le dit (§2). */
const furanose = ringGraph([[0, 1, 2, 3, 4]]);
eq(ringSizeThrough({ neighbours: furanose, atom: 0 }), 5, 'le cycle d’un sucre fait cinq atomes');

/* ════════════ 4. LE GRAPHE ET LES TERMES ════════════════════════════════════ */
const g1 = bondGraphOf({ bonds: [[0, 1], [1, 2], [1, 2], [2, 2], ['a', 'b'], [3, 9]], atomCount: 3 });
eq(g1.list, [{ i: 0, j: 1, order: 1 }, { i: 1, j: 2, order: 1 }],
  'un doublon, une liaison d’un atome à lui-même et une liaison illisible sont écartés');
eq(g1.count, 2, '…et le compte est celui des liaisons réellement lues');
eq(bondGraphOf({ bonds: [[0, 1, 2]], atomCount: 3 }).list[0].order, 2, 'un ordre déclaré est lu');
eq(bondGraphOf({ bonds: [[0, 1, 7]] }).list[0].order, 1, '…un ordre absurde retombe sur 1');
eq(bondGraphOf({ bonds: [{ i: 0, j: 1, order: 3 }] }).list[0].order, 3, 'la forme objet est acceptée aussi');
eq(bondGraphOf({ bonds: [[0, 5]], atomCount: 3 }).list, [], 'un atome hors molécule est écarté');
eq(g1.neighbours(1), [0, 2], 'l’adjacence suit la même lecture');
eq(g1.neighbours(42), [], '…et un atome inconnu n’a aucun voisin');

const PROPANE = { elements: ['C', 'C', 'C'], bonds: [[0, 1], [1, 2]] };
const propTerms = buildRelaxTerms(PROPANE);
eq(propTerms.bonds.map((t) => t.target), [1.54, 1.54], 'les deux liaisons du propane visent 1.54 Å');
eq(propTerms.angles.map((t) => t.target), [109.47], '…et son angle C–C–C vise le tétraèdre');
eq(propTerms.angles[0].j, 1, '…au sommet du carbone central');
eq(propTerms.hybrids, [null, 'sp3', null],
  '⚠ le carbone CENTRAL est sp3 ; les deux terminaux n’ont qu’UNE liaison lourde (leurs H ne sont pas dans le graphe) — donc aucun angle à respecter, et le module le DIT au lieu de leur inventer une hybridation');
eq(propTerms.unknownBonds, 0, 'aucune liaison inconnue ici');
const withZinc = buildRelaxTerms({ elements: ['C', 'ZN', 'C'], bonds: [[0, 1], [1, 2]] });
eq(withZinc.unknownBonds, 2, '⚠ une liaison dont la table ne connaît pas le couple est COMPTÉE, pas inventée');
eq(withZinc.bonds.length, 0, '…et elle n’entre donc pas dans la fonction cible');
eq(buildRelaxTerms({ elements: ['C'], bonds: [] }).angles, [], 'sans liaison, aucun angle');
eq(buildRelaxTerms({ pairs: [[0, 1, 2.05]] }).pairs[0], { i: 0, j: 1, target: 2.05, weight: 50 },
  'une distance DEMANDÉE entre telle quelle, avec le poids des paires');
eq(buildRelaxTerms({ pairs: [[0, 0, 2], [0, 1, -1], [0, 1, 'x']] }).pairs, [],
  '⚠ une paire entre un atome et lui-même, une distance négative ou illisible sont écartées');
eq(buildRelaxTerms({ pairs: [{ i: 0, j: 1, distance: 2.6, weight: 7 }] }).pairs[0].weight, 7,
  'un poids propre à une paire est respecté');
/* ⚠ LE CYCLE NE SE DÉCLARE PLAN QU'AVEC LA GÉOMÉTRIE : le même graphe (un cycle de
   six carbones) donne un benzène à 1.39 Å et un cyclohexane à 1.53 Å. */
const hexaRing = { elements: Array(6).fill('C'), bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]] };
const hexagon = (r) => flatPositions(Array.from({ length: 6 }, (_, i) => [
  r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3), 0,
])).flat;
const benzene = buildRelaxTerms({ ...hexaRing, positions: hexagon(1.39) });
const cyclohexane = buildRelaxTerms({ ...hexaRing, positions: hexagon(1.53) });
eq(benzene.hybrids, Array(6).fill('sp2'), 'un hexagone à 1.39 Å : les six carbones sont sp2');
eq(benzene.bonds.map((t) => t.target), Array(6).fill(1.39), '…et ses six liaisons visent 1.39 Å (le benzène)');
eq(benzene.aromaticBonds, 6, 'le rapport dit combien de liaisons il a déclarées aromatiques');
eq(cyclohexane.hybrids, Array(6).fill('sp3'), 'le même graphe à 1.53 Å : les six carbones restent sp3');
eq(cyclohexane.bonds.map((t) => t.target), Array(6).fill(1.54), '…et ses liaisons visent 1.54 Å');
eq(cyclohexane.aromaticBonds, 0, '…sans une seule liaison aromatique');
eq(cyclohexane.angles.map((t) => t.target), Array(6).fill(109.47), '…et ses angles le tétraèdre');

/* Un atome à trois voisins porte TROIS angles (les trois couples), pas un. */
const tetra = buildRelaxTerms({ elements: ['C', 'C', 'C', 'C', 'C'], bonds: [[0, 1], [0, 2], [0, 3], [0, 4]] });
eq(tetra.angles.length, 6, 'un carbone à quatre voisins porte six angles (tous les couples)');
eq(tetra.angles.every((t) => t.j === 0 && t.target === 109.47), true, '…tous au sommet du carbone central');

/* ════════════ 5. LE GRADIENT, MESURÉ PAR DIFFÉRENCES FINIES ═════════════════
   Une molécule jouet qui porte les QUATRE familles de termes à la fois : trois
   liaisons, trois angles, une distance demandée et une longe. Le gradient
   analytique doit être le VRAI gradient, composante par composante. */
const toy = { elements: ['C', 'C', 'O', 'N'], bonds: [[0, 1], [1, 2], [1, 3]], pairs: [[0, 3, 2.6]] };
const toyX = [0, 0, 0, 1.9, 0.4, 0.1, 2.4, 1.5, -0.3, -0.6, 1.4, 0.2];
const toyRef = toyX.map((v, i) => v + (i % 3 === 0 ? 0.15 : -0.1));
const toyTerms = buildRelaxTerms({ ...toy, positions: toyX });
eq(toyTerms.bonds.length, 3, 'trois liaisons dans la fonction cible');
eq(toyTerms.angles.length, 3, '…trois angles autour du carbone central (les trois couples)');
eq(toyTerms.pairs.length, 1, '…et la distance demandée');
const movableAll = [0, 1, 2, 3];
const opts = { ref: toyRef, tether: 0.5, movable: movableAll };
const analytic = new Float64Array(toyX.length);
const hessian = new Float64Array(toyX.length);
const toyEnergy = energyOf(toyTerms, toyX, { ...opts, grad: analytic, hess: hessian });
near(toyEnergy.total, toyEnergy.bond + toyEnergy.angle + toyEnergy.pair + toyEnergy.tether,
  'l’énergie est la SOMME des quatre familles, sans rien d’autre', 1e-12);
ok(toyEnergy.tether > 0, 'la longe compte (son origine est ailleurs qu’aux coordonnées)');
const h = 1e-6;
let worstGrad = 0;
for (let k = 0; k < toyX.length; k += 1) {
  const up = toyX.slice(); up[k] += h;
  const dn = toyX.slice(); dn[k] -= h;
  const numeric = (energyOf(toyTerms, up, opts).total - energyOf(toyTerms, dn, opts).total) / (2 * h);
  worstGrad = Math.max(worstGrad, Math.abs(numeric - analytic[k]));
}
ok(worstGrad < 1e-5,
  `⚠ le gradient ANALYTIQUE est le vrai gradient : le pire écart aux différences finies est ${worstGrad.toExponential(2)}`);
ok(hessian.every((v) => v > 0), 'la diagonale de Gauss-Newton est positive partout (préconditionneur utilisable)');
const tetherOnly = energyOf(toyTerms, toyX, { ref: toyRef, tether: 2, movable: [1] });
const tdx = toyX[3] - toyRef[3]; const tdy = toyX[4] - toyRef[4]; const tdz = toyX[5] - toyRef[5];
near(tetherOnly.tether, 2 * (tdx * tdx + tdy * tdy + tdz * tdz),
  '⚠ la longe ne compte QUE les atomes autorisés à bouger', 1e-12);
eq(pairReportOf(toyTerms, toyX)[0].target, 2.6, 'le rapport d’une paire porte sa cible');
near(pairReportOf(toyTerms, toyX)[0].distance,
  Math.hypot(toyX[0] - toyX[9], toyX[1] - toyX[10], toyX[2] - toyX[11]),
  '…et la distance RÉELLE, relue sur les coordonnées', 1e-12);

/* ════════════ 6. LA DESCENTE, EXÉCUTÉE ══════════════════════════════════════
   « Une chaîne étirée doit revenir à des liaisons de 1.54 Å et des angles de
   109.47° » — et cela vaut AUSSI pour une chaîne exactement alignée, où le
   gradient d'un angle de 180° est nul dans toute direction. */
const chainAt = (n, d, bend) => {
  const flat = [];
  for (let i = 0; i < n; i += 1) flat.push(i * d, (i % 2 ? bend : -bend), 0);
  return flat;
};
const chainBonds = (n) => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
const bent = chainAt(5, 2.6, 0.5);
const straight = chainAt(5, 2.6, 0);
const spec5 = { elements: Array(5).fill('C'), bonds: chainBonds(5) };
const frozen = bent.slice();
const bentRun = relaxGeometry({ ...spec5, positions: bent });
eq(bent, frozen, '⚠ les coordonnées reçues ne sont JAMAIS modifiées (le module travaille sur une copie)');
ok(bentRun.ok, 'la descente tourne');
near(bentRun.after.bondRms, 0, '…et ramène toutes les liaisons à leur longueur', 0.02);
near(bentRun.after.angleRms, 0, '…et tous les angles au tétraèdre', 1);
ok(Math.abs(bentRun.after.worstBond.dev) < 0.05,
  `…la pire liaison est à ${bentRun.after.worstBond.distance.toFixed(3)} Å (cible ${bentRun.after.worstBond.target})`);
ok(Math.abs(bentRun.after.worstAngle.dev) < 1,
  `…le pire angle est à ${bentRun.after.worstAngle.deg.toFixed(2)}° (cible ${bentRun.after.worstAngle.target})`);
ok(bentRun.after.total < bentRun.before.total, 'l’énergie a BAISSÉ (c’est tout ce que la descente promet)');
eq(bentRun.moved, [0, 1, 2, 3, 4], 'les cinq atomes ont bougé');
eq(bentRun.pairs, [], 'sans distance demandée, le rapport des paires est vide');
ok(['converged', 'max-steps'].includes(bentRun.reason), `la descente s’explique (reason = ${bentRun.reason})`);
ok(bentRun.evaluations > 0 && bentRun.steps > 0, '…et elle dit ce qu’elle a coûté');

/* LE MÊME MODÈLE DONNE LE MÊME RÉSULTAT — aucune graine, aucun tirage. */
const bentAgain = relaxGeometry({ ...spec5, positions: bent });
eq(bentAgain.positions, bentRun.positions, '⚠ deux appels identiques rendent EXACTEMENT le même modèle');
eq(bentAgain.after.total, bentRun.after.total, '…et la même énergie, au dernier chiffre');

/* LA CHAÎNE EXACTEMENT ALIGNÉE — le col de l'angle plat. */
const straightRun = relaxGeometry({ ...spec5, positions: straight });
ok(straightRun.unstuck > 0,
  `un angle exactement plat reçoit son coup de pouce déterministe (${straightRun.unstuck} angles)`);
near(straightRun.after.angleRms, 0, '⚠ …et la chaîne EN SORT : les angles atteignent le tétraèdre', 1);
near(straightRun.after.bondRms, 0, '…et les liaisons leur longueur', 0.02);
const straightAgain = relaxGeometry({ ...spec5, positions: straight });
eq(straightAgain.positions, straightRun.positions,
  '…toujours sans le moindre tirage (même coup de pouce, même modèle)');

/* LA FENÊTRE : SEULS LES ATOMES DONNÉS BOUGENT — les autres au chiffre près. */
const halfRun = relaxGeometry({ ...spec5, positions: bent, movable: [1, 2, 3] });
eq(atomAt(halfRun.positions, 0), atomAt(bent, 0), '⚠ un atome hors fenêtre est rendu BIT À BIT (atome 0)');
eq(atomAt(halfRun.positions, 4), atomAt(bent, 4), '…idem à l’autre bout (atome 4)');
ok(halfRun.moved.every((i) => [1, 2, 3].includes(i)), '…et le rapport ne nomme que les atomes de la fenêtre');

/* ════════════ 7. LA FENÊTRE, LE RAYON, LE PLAFOND ═══════════════════════════ */
eq(relaxWindow({ bonds: chainBonds(5), seeds: [2], radius: 0, atomCount: 5 }).movable, [2],
  'une fenêtre de rayon 0 ne contient que les atomes choisis');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [2], radius: 1, atomCount: 5 }).movable, [1, 2, 3],
  '…de rayon 1, leurs voisins directs avec eux');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [0, 4], radius: 6, atomCount: 5 }).movable, [0, 1, 2, 3, 4],
  'deux graines relient toute la chaîne');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [0, 4], radius: 6, atomCount: 5, maxAtoms: 3 }).movable,
  [0, 1, 4], '⚠ une fenêtre plafonnée garde les atomes les plus PROCHE des graines (le parcours est en largeur)');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [0, 4], radius: 6, atomCount: 5, maxAtoms: 3 }).truncated, true,
  '…et elle DIT qu’elle a mordu (truncated)');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [0, 4], radius: 6, atomCount: 5 }).truncated, false,
  '…une fenêtre entière ne le dit pas');
eq(relaxWindow({ bonds: chainBonds(5), seeds: [0], radius: 99, atomCount: 5 }).radius, 12,
  'un rayon absurde est ramené au plafond du module');
eq(relaxWindow({ bonds: chainBonds(5), seeds: ['a', -3, 9], atomCount: 5 }).movable, [],
  '⚠ une graine illisible ou hors molécule ne fait pas planter la fenêtre');
eq(relaxWindow({ bonds: [], seeds: [] }).movable, [], 'sans graphe ni graine, aucune fenêtre');

/* ════════════ 8. LES REFUS, DITS AU LIEU D’ÊTRE INVENTÉS ═══════════════════ */
eq(relaxGeometry({ positions: null, elements: [] }).reason, 'bad-points',
  'sans coordonnées lisibles, le module refuse (bad-points)');
eq(relaxGeometry({ positions: [1, 2], elements: ['C'] }).reason, 'bad-points',
  '…une longueur qui n’est pas un multiple de trois non plus');
eq(relaxGeometry({ positions: bent, elements: Array(5).fill('C'), bonds: chainBonds(5), movable: [] }).reason,
  'no-movable', '…sans atome mobile, rien ne bouge : il le dit');
eq(relaxGeometry({ positions: [0, 0, 0, 1.6, 0, 0], elements: ['ZN', 'ZN'], bonds: [[0, 1]] }).reason, 'no-terms',
  '⚠ une molécule dont AUCUNE liaison n’est connue de la table : aucun terme, donc aucune descente');
const zeroSteps = relaxGeometry({ ...spec5, positions: bent, steps: 0 });
eq(zeroSteps.positions, bent, 'steps = 0 ne déplace rien');
eq(zeroSteps.moved, [], '…aucun atome déplacé');
eq(zeroSteps.unstuck, 0, '…et pas même le coup de pouce des angles plats');
eq(zeroSteps.reason, 'max-steps', '…la raison est celle-là, dite telle quelle');

/* ════════════ 9. UN VRAI NGL — ÉCRIRE, RELIRE, REMESURER ════════════════════
   Le chemin complet de l'écran, sans souris : un PDB écrit à la main est PARSÉ
   par NGL (ses liaisons viennent de ses CONECT), la descente lit la structure
   atome par atome, les coordonnées rentrent dans la structure par le MÊME
   `positionFromArray` qu'un geste du panneau, et le PDB exporté est RELU et
   remesuré. */
{
  const require = createRequire(import.meta.url);
  const NGL = require('ngl');
  /* NGL lit un Blob à travers FileReader : le navigateur l'a, node non. */
  if (typeof globalThis.FileReader !== 'function') {
    globalThis.FileReader = class {
      readAsText(blob) {
        Promise.resolve(blob.text()).then((text) => {
          this.result = text;
          if (typeof this.onload === 'function') this.onload({ target: this });
        });
      }
    };
  }
  ok(typeof NGL.autoLoad === 'function' && typeof NGL.PdbWriter === 'function',
    'NGL sait parser un PDB et en réécrire un : la sonde peut comparer l’écran et le fichier');

  /** Une ligne PDB aux colonnes que NGL lit (gabarit des sondes du dossier). */
  const pdbAtom = (serial, name, el, x, y, z) => `HETATM${String(serial).padStart(5)}  ${name.padEnd(4)}HEX A   1`
    + `${x.toFixed(3).padStart(12)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
  /* UN HEXANE ÉTIRÉ ET PARFAITEMENT ALIGNÉ : liaisons de 2.6 Å (au lieu de 1.54) et
     angles de 180° (au lieu de 109.47) — le fichier qu'aucun chimiste n'écrirait,
     et exactement le cas où le gradient d'angle est nul (le col de l'angle plat). */
  const hexane = [0, 1, 2, 3, 4, 5].map((i) => [2.6 * i, 0, 0]);
  const FILE = [
    ...hexane.map((p, i) => pdbAtom(i + 1, `C${i + 1}`, 'C', p[0], p[1], p[2])),
    ...hexane.map((_, i) => `CONECT${String(i + 1).padStart(5)}`
      + [i - 1, i + 1].filter((k) => k >= 0 && k < hexane.length).map((k) => String(k + 1).padStart(5)).join('')),
    'END',
  ].join('\n');
  const structure = await NGL.autoLoad(new Blob([FILE], { type: 'text/plain' }), { ext: 'pdb' });
  eq(structure.atomCount, 6, 'les six atomes du fichier sont là');
  eq(structure.bondStore.count, 5, '⚠ ses cinq liaisons viennent du FICHIER (CONECT)');

  /* CE QUE LE VIEWER LIT — les éléments et les coordonnées par AtomProxy, les
     liaisons par le bond store (l'ordre est celui que le fichier déclare, 1 ici). */
  const ap = structure.getAtomProxy();
  const elements = [];
  const start = [];
  for (let i = 0; i < structure.atomCount; i += 1) {
    ap.index = i;
    elements.push(ap.element);
    start.push(ap.x, ap.y, ap.z);
  }
  const bonds = [];
  for (let k = 0; k < structure.bondStore.count; k += 1) {
    bonds.push({
      i: Number(structure.bondStore.atomIndex1[k]),
      j: Number(structure.bondStore.atomIndex2[k]),
      order: structure.bondStore.bondOrder ? Number(structure.bondStore.bondOrder[k]) : 1,
    });
  }
  eq(elements, Array(6).fill('C'), 'les six éléments sont lus comme le viewer les lit');
  eq(bonds.map((b) => [b.i, b.j]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
    '…et le graphe est celui du fichier, dans son ordre');

  /* LA FENÊTRE AUTOUR DES DEUX ATOMES CHOISIS — puis la descente, SANS distance
     demandée : c'est le « model build » pur, rendre valide un modèle qui ne l'est
     pas. */
  const win = relaxWindow({ bonds, seeds: [0, 5], radius: 6, atomCount: structure.atomCount });
  eq(win.movable, [0, 1, 2, 3, 4, 5], 'la fenêtre couvre la chaîne entière');
  eq(win.truncated, false, '…sans être plafonnée');
  const before = relaxGeometry({ positions: start, elements, bonds, movable: win.movable, steps: 0 });
  ok(before.before.bondRms > 1,
    `le fichier de départ est bien invalide : ses liaisons s’écartent de ${before.before.bondRms.toFixed(2)} Å en moyenne`);
  const run = relaxGeometry({ positions: start, elements, bonds, movable: win.movable });
  ok(run.ok, 'la descente tourne sur la vraie molécule');
  near(run.after.bondRms, 0, 'elle a ramené les cinq liaisons de 2.6 Å à leur longueur', 0.05);
  ok(Math.abs(run.after.worstAngle.dev) <= 2,
    `…et les angles de 180° au tétraèdre (pire écart ${run.after.worstAngle.dev.toFixed(2)}°)`);
  ok(run.unstuck > 0, '…en franchissant le col des angles plats (le coup de pouce déterministe)');
  eq(run.moved.length, 6, 'les six atomes ont bougé');

  /* L'ÉCRITURE — le même `positionFromArray` que le panneau, sur les seuls atomes
     que le rapport nomme, puis une relecture par AtomProxy. */
  const flatRun = new Float32Array(run.moved.length * 3);
  run.moved.forEach((idx, k) => {
    flatRun[k * 3] = run.positions[idx * 3];
    flatRun[k * 3 + 1] = run.positions[idx * 3 + 1];
    flatRun[k * 3 + 2] = run.positions[idx * 3 + 2];
  });
  const sink = structure.getAtomProxy();
  run.moved.forEach((idx, k) => { sink.index = idx; sink.positionFromArray(flatRun, k * 3); });
  const readBack = [];
  for (let i = 0; i < structure.atomCount; i += 1) {
    ap.index = i;
    readBack.push(ap.x, ap.y, ap.z);
  }
  let worstWrite = 0;
  for (let i = 0; i < readBack.length; i += 1) {
    worstWrite = Math.max(worstWrite, Math.abs(readBack[i] - run.positions[i]));
  }
  ok(worstWrite < 1e-6,
    `la structure À L'ÉCRAN porte les coordonnées du rapport (pire écart ${worstWrite.toExponential(1)})`);
  eq(readBack.length, 18, '…les six atomes, trois coordonnées chacun');
  eq(structure.bondStore.count, 5, '…et le graphe de liaisons n’a pas été touché (toujours cinq)');

  /* LE FICHIER EXPORTÉ, RELU, REMESURÉ — des longueurs, un angle, la distance. */
  const pdb = new NGL.PdbWriter(structure).getString();
  const reloaded = await NGL.autoLoad(new Blob([pdb], { type: 'text/plain' }), { ext: 'pdb' });
  eq(reloaded.atomCount, 6, 'le PDB exporté se relit tout seul');
  const ap2 = reloaded.getAtomProxy();
  const at2 = (i) => { ap2.index = i; return [ap2.x, ap2.y, ap2.z]; };
  let worstBondFile = 0;
  for (let i = 0; i < 5; i += 1) {
    worstBondFile = Math.max(worstBondFile, Math.abs(distOf(readBack, i, i + 1) - 1.54));
  }
  ok(worstBondFile < 0.05,
    `⚠ dans le FICHIER, toutes les liaisons valent 1.54 Å ± 0.05 (pire écart ${worstBondFile.toFixed(4)})`);
  const angFile = angleDeg(at2(0), at2(1), at2(2));
  near(angFile, 109.47, `…et l’angle C1–C2–C3 du fichier vaut ${angFile.toFixed(2)}° (le tétraèdre)`, 2);
  const pairFile = Math.hypot(at2(0)[0] - at2(5)[0], at2(0)[1] - at2(5)[1], at2(0)[2] - at2(5)[2]);
  near(pairFile, distOf(readBack, 0, 5),
    '…et la distance C1⋯C6 relue du fichier est celle que l’écran porte', 1e-3);

  /* ══ 10. LA DISTANCE DEMANDÉE — « rapproche ces deux atomes » ══════════════
     Le geste exact de la demande : l'utilisateur définit la distance entre deux
     atomes (ici la liaison C–S d'un modèle où elle est étirée à 3.4 Å) et le
     programme commence à les rapprocher pas à pas, en déplaçant les atomes qui ne
     respectent plus leurs angles et leurs liaisons. */
  const C2 = [1.5, 0.4, 0];
  const C3 = [2.4, 1.6, 0.3];
  const axis = [C3[0] - C2[0], C3[1] - C2[1], C3[2] - C2[2]];
  const axisNorm = Math.hypot(axis[0], axis[1], axis[2]);
  const far = 3.4;
  const S1 = C3.map((v, c) => v + (axis[c] / axisNorm) * far);
  const stretched = [
    ...pdbAtom(1, 'C1', 'C', 0, 0, 0).split('\n'),
    ...pdbAtom(2, 'C2', 'C', C2[0], C2[1], C2[2]).split('\n'),
    ...pdbAtom(3, 'C3', 'C', C3[0], C3[1], C3[2]).split('\n'),
    ...pdbAtom(4, 'S1', 'S', S1[0], S1[1], S1[2]).split('\n'),
    'CONECT    1    2', 'CONECT    2    1    3', 'CONECT    3    2    4', 'CONECT    4    3', 'END',
  ].join('\n');
  const ss = await NGL.autoLoad(new Blob([stretched], { type: 'text/plain' }), { ext: 'pdb' });
  eq(ss.atomCount, 4, 'la molécule du second essai a quatre atomes');
  eq(ss.bondStore.count, 3, '…et trois liaisons, du fichier');
  const sap = ss.getAtomProxy();
  const sElements = [];
  const sPositions = [];
  for (let i = 0; i < ss.atomCount; i += 1) {
    sap.index = i;
    sElements.push(sap.element);
    sPositions.push(sap.x, sap.y, sap.z);
  }
  const sBonds = [];
  for (let k = 0; k < ss.bondStore.count; k += 1) {
    sBonds.push({ i: Number(ss.bondStore.atomIndex1[k]), j: Number(ss.bondStore.atomIndex2[k]) });
  }
  const relaxed = relaxGeometry({
    positions: sPositions, elements: sElements, bonds: sBonds,
    movable: [1, 2, 3], pairs: [{ i: 2, j: 3, target: bondLengthTarget('C', 'S') }],
  });
  ok(relaxed.pairs[0].before > 3, `la liaison C–S part étirée : ${relaxed.pairs[0].before.toFixed(2)} Å`);
  eq(relaxed.reached, true,
    `⚠ la distance DEMANDÉE est atteinte — pas « approchée » : ${relaxed.pairs[0].after.toFixed(3)} Å pour une cible de ${relaxed.pairs[0].target}`);
  near(relaxed.pairs[0].after, 1.82, '…et c’est bien la longueur C–S de la table', RELAX_PAIR_TOLERANCE);
  near(relaxed.after.bondRms, 0, '…les deux autres liaisons gardent leur longueur', 0.05);
  ok(Math.abs(relaxed.after.worstAngle.dev) <= 2,
    `…et les angles restent au tétraèdre (pire écart ${relaxed.after.worstAngle.dev.toFixed(2)}°)`);
  eq(atomAt(relaxed.positions, 0), atomAt(sPositions, 0), '⚠ l’atome 0, hors fenêtre, n’a pas bougé d’un chiffre');
  eq(relaxed.moved, [1, 2, 3], '…et le rapport nomme exactement les trois atomes de la fenêtre');
}

/* ════════════ 11. LE BRANCHEMENT DU VIEWER ══════════════════════════════════
   Le module ne sert à rien s'il n'est pas branché. Ce que la page DOIT dire : le
   bouton, le champ de la fenêtre, la façon dont la molécule est lue (le vrai
   graphe de NGL), la cible prise au champ A–D ou à la TABLE, le chemin d'écriture
   d'un geste (writeStructurePositions + le journal ↺), et un rapport qui dit ce
   qui est et ce qui n'est pas. */
has(VIEW, "} from '../utils/geometryRelax';", 'le viewer importe le module du model build');
has(VIEW, 'relaxGeometry, relaxWindow, bondLengthTarget, RELAX_DEFAULT_RADIUS, RELAX_MAX_RADIUS,',
  '…avec les quatre fonctions dont il se sert');
has(VIEW, 'const [relaxRadius, setRelaxRadius] = useState(RELAX_DEFAULT_RADIUS);',
  'la fenêtre du ⚒ a son état (le champ « ⇢ moves »)');
has(VIEW, 'const setRelaxRadiusText = (v) => {', '…et son lecteur, qui borne la valeur au plafond du module');
has(VIEW, 'const torsionPairOf = () => {', 'deux atomes suffisent : le couple du ⚒ a son propre lecteur');
has(VIEW, "const picked = slots.length >= 4 ? [slots[0], slots[3]] : [slots[0], slots[1]];",
  '⚠ QUATRE atomes piqués : le couple est A–D (celui du champ) ; DEUX seulement : A et B');
has(VIEW, 'return { ok: true, comp, structure, slots: picked, idx, points, label: picked.length >= 4 ? \'A–D\' : \'A–B\' };',
  '…et le rapport nomme ce qu’il a pris');
has(VIEW, 'const torsionPairReading = () => {', 'le panneau affiche la distance A–B / A–D « maintenant »');
has(VIEW, '{pairRead.label} {torsionAng(pairRead.dist)}', '…dans la ligne de lecture du panneau');
has(VIEW, 'const geometryOfStructure = (structure) => {',
  'la molécule est lue SUR la structure à l’écran (éléments, graphe, coordonnées)');
has(VIEW, 'bonds.push({ i, j, order: store.bondOrder ? Number(store.bondOrder[k]) || 1 : 1 });',
  '…le graphe de NGL tel quel, avec l’ordre quand le fichier en déclare un');
const RELAX_SLICE = VIEW.slice(VIEW.indexOf('const geometryOfStructure = (structure) => {'),
  VIEW.indexOf('const relaxReportOf = (pair, run, win) => {'));
ok(!/movingSideOf|planTorsion/.test(RELAX_SLICE),
  '⚠ le model build n’est PAS une rotation rigide : il ne se sert ni de movingSideOf ni de planTorsion');
has(VIEW, 'const buildModelNow = () => {', 'le geste a son handler');
has(VIEW, 'relaxWindow({ bonds: geom.bonds, seeds: [i, j], radius: relaxRadius, atomCount: geom.count });',
  'la fenêtre est construite sur le VRAI graphe, autour des deux atomes, au rayon du champ');
has(VIEW, 'const table = bondLengthTarget(geom.elements[i], geom.elements[j]);',
  'la longueur de la TABLE sert de cible quand rien n’est tapé (S–S 2.05, C–S 1.82…)');
has(VIEW, 'const target = Number.isFinite(typed) && typed > 0 ? typed : table;',
  '…et le chiffre du champ A–D l’emporte dès qu’il y en a un');
has(VIEW, 'pairs: [{ i, j, target }],', 'la distance DEMANDÉE entre dans la fonction cible');
has(VIEW, 'if (!run.moved.length) {', '⚠ quand rien n’a besoin de bouger, le panneau le dit au lieu d’écrire');
has(VIEW, 'if (!writeStructurePositions(comp, run.moved, flat)) {',
  'l’écriture passe par le MÊME chemin qu’une torsion (positionFromArray + redessin)');
has(VIEW, 'label: `⚒ model build ${pair.label} ${torsionAng(target)}`,',
  '…et le journal ↺ retient le geste sous son nom (le ↺ est celui de la torsion)');
has(VIEW, 'setTorsionMsg(`${relaxReportOf(pair, run, win)}${warn}`);', 'le rapport est affiché dans le panneau');
has(VIEW, 'const relaxReportOf = (pair, run, win) => {', 'le rapport est construit à part (énergie, rms, atomes, verdict)');
has(VIEW, '· energy ${run.before.total.toFixed(1)} → ${run.after.total.toFixed(1)}',
  '…il donne l’énergie avant et après');
has(VIEW, '· bonds ${torsionAng(run.after.bondRms)} rms over ${run.terms.bonds}',
  '…les écarts de liaisons qu’il a RELUS');
has(VIEW, "· angles ${run.after.angleRms.toFixed(1)}° rms over ${run.terms.angles}${worstAngle}",
  '…les écarts d’angles, et le pire des deux');
has(VIEW, '· ${run.moved.length} atom${run.moved.length === 1 ? \'\' : \'s\'} moved of ${win.movable.length}',
  '…le nombre d’atomes déplacés, sur ceux de la fenêtre');
has(VIEW, '· ⚠ the window was CAPPED at ${win.movable.length} atoms', '…et il DIT quand la fenêtre a mordu le plafond');
has(VIEW, '${run.unstuck} flat angle${run.unstuck === 1 ? \'\' : \'s\'} nudged before the descent',
  '…et quand des angles plats ont reçu leur coup de pouce');
has(VIEW, 'A geometric TARGET FUNCTION (ideal bond lengths and angles, the distances you asked for) — no charges,',
  '⚠ le rapport dit ce que le geste N’EST PAS : une cible géométrique, pas un champ de forces');
has(VIEW, 'no solvent, and a LOCAL descent: what it could not do, it says instead of pretending.',
  '…locale, et honnête sur ce qu’elle n’a pas su faire');
has(VIEW, 'const relaxWhy = (run) => ({', 'les raisons du module pur sont TRADUITES, jamais inventées');
has(VIEW, "'stalled': 'the descent found nowhere left to go (a LOCAL minimum", '…le palier d’un minimum local');
const BUILD_BTN = VIEW.slice(VIEW.indexOf('onClick={buildModelNow}'), VIEW.indexOf('>\n          ⚒ Model build'));
ok(BUILD_BTN.length > 0 && !/disabled/.test(BUILD_BTN),
  '⚠ le bouton n’est JAMAIS inactif : deux atomes piqués suffisent (il dit lui-même ce qui manque)');
has(VIEW, '>\n          ⚒ Model build\n        </button>', 'le bouton est nommé « ⚒ Model build »');
has(VIEW, '⇢ moves', '…et le champ de la fenêtre est nommé « ⇢ moves » bonds');
has(VIEW, 'onKeyDown={(e) => { if (e.key === \'Enter\') buildModelNow(); }}', '↵ dans le champ de la fenêtre construit aussi');
has(VIEW, '⚒ Model build is the same kind of edit — the same coordinates, the same ↺',
  'la note du panneau range le geste à côté de la torsion (mêmes coordonnées, même ↺)');

/* ── Bilan ─────────────────────────────────────────────────────────────────── */
console.log(`_geometry_relax_test.mjs — ${passed} assertions OK (les tables de la chimie, l'hybridation et les`
  + ' cycles, le gradient mesuré par différences finies, la descente exécutée pas à pas, la fenêtre,'
  + ' et un vrai PDB étiré reconstruit puis relu par NGL)');
