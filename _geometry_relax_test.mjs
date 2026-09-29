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
     §3bis la PLANÉITÉ TENUE — le cycle ORDONNÉ (ringCycleThrough), les cycles que le
        fichier dit plans (planarRingsOf), et le TERME qui les tient plats : un benzène
        plissé que la descente redresse, un cycle qu'une contrainte ne peut plus plier
        (et le rapport qui dit alors la distance RÉELLE au lieu de plier le cycle) ;
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
     §7bis LE PAS À PAS ET LA REPRISE — un rapprochement lointain (7.35 → 3.00 Å) qui
        n'aboutit PAS d'un seul tenant et qui aboutit par paliers de 2 Å, chacun suivi
        d'une reprise qui relâche la fenêtre entière à la distance obtenue ;
     §7ter LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE — « since you limit the number of
        bonds and atoms to move, the molecules get stretched » : les atomes que la
        fenêtre n'ancre pas sont REPOSÉS à chaque pas depuis la géométrie standard
        (longueur de la table, angle de l'hybridation, DIÈDRES gardés au chiffre près),
        donc ils bougent, la molécule se RESSERRE au lieu de rester étirée au-delà de la
        fenêtre — et l'ancre est rendue bit à bit, la molécule tournée donne le rebâtiment
        tourné, une liaison hors des tables n'est jamais rebâtie ;
     §8 un VRAI NGL : un PDB écrit à la main est parsé, ses liaisons viennent du
        fichier, la descente écrit dans la structure (positionFromArray), le PDB
        exporté est RELU et remesuré ;
     §9 LES ÉCHAPPÉES — un rapprochement que la descente seule ne sait pas replier :
        la botte de torsion (`torsionKickOf`) est une rotation RIGIDE (longueurs et
        angles préservés au chiffre près), elle refuse une liaison de CYCLE, elle
        est tirée à GRAINE FIXE, et la « Monte Carlo minimization » garde le
        MEILLEUR modèle — jamais moins bon que la descente ordinaire. Le rapport
        dit combien de bottes ont été essayées et gardées, et les CONTACTS TROP
        COURTS du modèle rendu (`clashReportOf` : « la géométrie est-elle
        réalisable ? » — c'est le « geometrie irrealizzabili » de la demande) ;
     §10 LE PAS VU DE L'EXTÉRIEUR — `onStep` : l'ordre des phases (descente,
        reprises, bottes), les chiffres de chaque pas, le dernier état toujours
        annoncé, et un rapport qui se plaint sans arrêter la descente ;
     §11 LE BRANCHEMENT DU VIEWER (le bouton, les champs « ⇢ moves », « ⇉ stages »
        et « 🎲 escapes », la case « ⟳ rebuild » et son rapport, l'écriture du geste, le
        journal ↺, et l'animation : la molécule change à chaque pas au lieu du résultat
        de but en blanc — les atomes reposés compris) ;
     §12 LE CONSTRUIT AUTOMATIQUE — les longueurs fausses trouvées tout seul, conduites
        une après l'autre, le second balayage quand le premier en a créé d'autres ;
     §13 LE CŒUR DUR — « in the calculation you did not consider steric clashes along
        atoms and now they are one on top of each other » : les rayons de Bondi, la
        distance de contact (0.6 × la somme), le terme dans la fonction cible avec son
        gradient mesuré, le REBALAYAGE pendant la descente, le coup de pouce des atomes
        confondus, et le construit automatique qui désempile la molécule.

   Run: node _geometry_relax_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  HYBRID_ANGLES, IDEAL_BOND_LENGTHS, BOND_ORDER_SHORTENING, PLANAR_RING_SIZES,
  PLANAR_RING_MAX_BOND, PLANAR_RING_KEEP_MAX_BOND, RELAX_WEIGHTS, RELAX_PAIR_TOLERANCE,
  RELAX_PLANAR_TOLERANCE, RELAX_STAGE_STEP, RELAX_MAX_STAGE_STEP, RELAX_RESTORE_STEPS,
  RELAX_RESTORE_STIFFNESS, RELAX_MAX_STAGES, RELAX_REBUILD, RELAX_DEFAULT_REBUILD,
  RELAX_ESCAPES, RELAX_DEFAULT_ESCAPES, RELAX_MAX_ESCAPES, RELAX_ESCAPE_STEPS,
  RELAX_KICK_DEG, RELAX_MIN_KICK_DEG, RELAX_ESCAPE_SEED, RELAX_CLASH_DISTANCE, RELAX_CLASH_WEIGHT,
  RELAX_BOND_TOLERANCE, RELAX_BAD_BOND_TOLERANCE, RELAX_AUTO_PASSES, RELAX_AUTO_MAX_DISTANCES,
  VDW_RADII, VDW_RADIUS_FALLBACK, RELAX_CONTACT_SCALE, RELAX_CONTACT_WEIGHT,
  RELAX_CONTACT_MARGIN, RELAX_CONTACT_LINK_DISTANCE, RELAX_CONTACT_TOLERANCE,
  RELAX_AUTO_MAX_CONTACTS,
  bondLengthTarget, bondGraphOf, ringSizeThrough, ringCycleThrough, hybridOf, angleTargetOf,
  planarRingsOf, buildRelaxTerms, energyOf, pairReportOf, relaxWindow, relaxGeometry, flatPositions,
  makeRelaxRandom, bondSideOf, torsionKickOf, clashReportOf, rebuildStandardGeometry,
  badDistancesOf, buildModelGeometry, vdwRadiusOf, contactDistanceOf, contactPairsOf, badContactsOf,
  unstickContacts, CONTACT_UNSTICK_STEP,
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
/* LE DIÈDRE i–j–k–l, SIGNÉ (« signed IUPAC ») — la même lecture que les χ/δ du viewer,
   écrite ici à la main pour que le rebâtiment soit jugé par un lecteur INDÉPENDANT de
   celui qui l'a construit. */
const dihedralDeg = (flat, i, j, k, l) => {
  const b = (p, q) => [flat[p * 3] - flat[q * 3], flat[p * 3 + 1] - flat[q * 3 + 1], flat[p * 3 + 2] - flat[q * 3 + 2]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const b1 = b(j, i); const b2 = b(k, j); const b3 = b(l, k);
  const n1 = cross(b1, b2); const n2 = cross(b2, b3);
  const n = Math.hypot(b2[0], b2[1], b2[2]);
  const m = cross(n1, [b2[0] / n, b2[1] / n, b2[2] / n]);
  return (Math.atan2(dot(m, n2), dot(n1, n2)) * 180) / Math.PI;
};

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

/* ════════════ 3bis. LE CYCLE, EN ORDRE — ET LA PLANÉITÉ TENUE ═══════════════
   Le dièdre d'un cycle a besoin de ses atomes DANS L'ORDRE (`ringCycleThrough`), et
   le terme qui tient un cycle plat a besoin de savoir QUELLES liaisons sont courtes
   (`planarRingsOf`). Puis la descente, exécutée : un benzène plissé se redresse avec
   le terme, RESTE plissé sans lui, et un cycle qu'une contrainte veut plier tient
   bon — le rapport dit alors la distance RÉELLE au lieu de tordre le cycle. */
const RING6 = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
const ring6Graph = ringGraph([[0, 1, 2, 3, 4, 5]]);
const cycle = ringCycleThrough({ neighbours: ring6Graph, atom: 3 });
eq(cycle.length, 6, 'le plus petit cycle qui traverse un atome, avec sa taille');
eq(cycle[0], 3, '…il COMMENCE par l’atome demandé (c’est cet ordre qui donne les dièdres)');
eq([...cycle].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], '…et il porte les six atomes du cycle, chacun une fois');
ok(cycle.every((a, i) => ring6Graph(a).includes(cycle[(i + 1) % cycle.length])),
  '⚠ consécutifs dans la liste = LIÉS dans le graphe : le cycle se referme sur lui-même');
eq(ringCycleThrough({ neighbours: (i) => (i > 0 && i < 9 ? [i - 1, i + 1] : [1]), atom: 4 }), [],
  'une chaîne n’a aucun cycle (liste vide, jamais une exception)');
eq(ringCycleThrough({ neighbours: null, atom: 0 }), [], 'sans graphe non plus');
eq(ringCycleThrough({ neighbours: ring6Graph, atom: -1 }), [], 'un indice invalide non plus');

/* LES CYCLES QUE LE FICHIER DIT PLANS — la géométrie décide, et elle seule. */
const graphOf = (bonds, n) => {
  const adj = Array.from({ length: n }, () => []);
  for (const [i, j] of bonds) { adj[i].push(j); adj[j].push(i); }
  return (i) => adj[i] || [];
};
const flatRing = (r) => Array.from({ length: 6 }, (_, i) => [
  r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3), 0,
]);
const buckledRing = (r, z) => flatRing(r).map((p, i) => [p[0], p[1], i % 2 ? z : -z]);
const meanRing = (pos) => {
  let sum = 0;
  for (let k = 0; k < pos.length; k += 1) {
    sum += Math.hypot(...[0, 1, 2].map((c) => pos[k][c] - pos[(k + 1) % pos.length][c]));
  }
  return sum / pos.length;
};
const ringsOf = (pos) => planarRingsOf({ neighbours: graphOf(RING6, 6), positions: pos.flat(), atomCount: 6 });
eq(ringsOf(flatRing(1.39)).map((r) => r.atoms), [[0, 1, 2, 3, 4, 5]], 'un benzène (1.39 Å) est le cycle plan du fichier');
near(ringsOf(flatRing(1.39))[0].meanBond, 1.39, '…et sa moyenne de liaisons est celle qu’on a lue', 1e-9);
eq(ringsOf(flatRing(1.53)), [], '⚠ un cyclohexane (1.53 Å) n’est JAMAIS déclaré plan');
eq(ringsOf(flatRing(1.52)), [], '…ni un sucre (1.52 Å)');
const buckled = buckledRing(1.39, 0.25);
ok(ringsOf(buckled).length === 1,
  `⚠ un benzène DÉJÀ PLISSÉ est encore reconnu (liaisons ${meanRing(buckled).toFixed(3)} Å) — sinon il ne serait jamais redressé`);
ok(PLANAR_RING_KEEP_MAX_BOND > PLANAR_RING_MAX_BOND,
  'la mesure qui TIENT un cycle est un cheveu plus large que celle qui le lit (1.48 contre 1.45)');
eq(planarRingsOf({ neighbours: graphOf(RING6, 6), atomCount: 6 }), [],
  '⚠ sans géométrie, aucun cycle n’est déclaré plan (la règle de hybridOf, §2)');

/* LES TERMES — un dièdre par quadruple consécutif du cycle, tous visés à zéro. */
const pinchTerms = buildRelaxTerms({ elements: Array(6).fill('C'), bonds: RING6, positions: buckled.flat() });
eq(pinchTerms.planarRings.length, 1, 'la fonction cible porte UN cycle plan');
eq(pinchTerms.planars.length, 6, '…et six dièdres (les six quadruples consécutifs du cycle)');
ok(pinchTerms.planars.every((t) => t.target === 0 && t.weight === RELAX_WEIGHTS.planar),
  '…visés à zéro, au poids des cycles plans');
eq(buildRelaxTerms({ elements: Array(6).fill('C'), bonds: RING6, positions: flatRing(1.53).flat() }).planars, [],
  '⚠ un cyclohexane ne porte AUCUN terme de ce genre : ses 109.47° restent son affaire');
eq(RELAX_PLANAR_TOLERANCE, 2, 'la tolérance du rapport : « le cycle est resté plan » à 2° près');

/* LE CYCLE PLISSÉ QU'ON RELÂCHE — avec le terme, et sans lui. */
const relaxRing = (pos, planar) => relaxGeometry({
  positions: pos, elements: Array(6).fill('C'), bonds: RING6,
  weights: { ...RELAX_WEIGHTS, planar },
});
const mildPucker = buckledRing(1.39, 0.05);
const mildFree = relaxRing(mildPucker.flat(), 0);
const mildHeld = relaxRing(mildPucker.flat(), RELAX_WEIGHTS.planar);
ok(mildFree.after.planarRms > 2,
  `⚠ SANS le terme, un benzène plissé reste hors du plan : ${mildFree.after.planarRms.toFixed(2)}°`);
ok(mildHeld.after.planarRms <= RELAX_PLANAR_TOLERANCE,
  `…AVEC lui, la descente le redresse : ${mildHeld.after.planarRms.toFixed(2)}° hors du plan`);
near(mildHeld.after.angleRms, 0, '…sans rien perdre des angles (120°)', 0.5);
near(mildHeld.after.bondRms, 0, '…ni des liaisons', 0.01);
const hardFree = relaxRing(buckled.flat(), 0);
const hardHeld = relaxRing(buckled.flat(), RELAX_WEIGHTS.planar);
ok(hardFree.after.planarRms > 20,
  `⚠ …et un cycle franchement plissé reste plissé : ${hardFree.after.planarRms.toFixed(1)}°`);
ok(hardHeld.after.planarRms <= RELAX_PLANAR_TOLERANCE,
  `AVEC le terme il revient dans le plan (${hardHeld.after.planarRms.toFixed(2)}°) — au prix d’angles à ${hardHeld.after.angleRms.toFixed(1)}° de leur cible, ce que le rapport affiche`);

/* LE CYCLE QU'UNE CONTRAINTE VEUT PLIER — le cas de la demande : un cycle est dans la
   fenêtre d'un rapprochement, et il perdait sa planéité sans que rien ne le dise. */
const ringAndChain = [...flatRing(1.39), [2.90, 0, 0], [4.43, 0, 0], [5.96, 0, 0]];
const ringChainBonds = [...RING6, [0, 6], [6, 7], [7, 8]];
const squeeze = (planar) => relaxGeometry({
  positions: ringAndChain.flat(), elements: Array(9).fill('C'), bonds: ringChainBonds,
  pairs: [{ i: 3, j: 8, target: 3 }], weights: { ...RELAX_WEIGHTS, planar },
});
const bowed = squeeze(0);
const held = squeeze(RELAX_WEIGHTS.planar);
ok(bowed.after.planarRms > 15,
  `⚠ SANS le terme, le rapprochement PLIE le cycle de ${bowed.after.planarRms.toFixed(1)}° (angles à ${bowed.after.angleRms.toFixed(2)}° près : rien ne l’en empêchait)`);
ok(held.after.planarRms <= RELAX_PLANAR_TOLERANCE,
  `AVEC lui, le cycle reste plan (${held.after.planarRms.toFixed(2)}°) et la distance demandée s’arrête à ${held.pairs[0].after.toFixed(2)} Å (${bowed.pairs[0].after.toFixed(2)} sans le terme)`);
ok(held.pairs[0].after > bowed.pairs[0].after,
  '…le cycle tenu est bien ce qui coûte la distance — et le rapport la DIT au lieu de tordre le cycle');
ok(bowed.reached === true && held.reached === false,
  '⚠ sans le terme la cible est « atteinte » (en pliant le cycle) ; avec lui elle ne l’est PLUS — et c’est DIT, plutôt que caché');
near(bowed.after.bondRms, 0, 'les deux modèles gardent leurs liaisons', 0.05);

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
near(toyEnergy.total, toyEnergy.bond + toyEnergy.angle + toyEnergy.planar + toyEnergy.pair
  + toyEnergy.tether + toyEnergy.contact,
  'l’énergie est la SOMME des six familles, sans rien d’autre', 1e-12);
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

/* LE GRADIENT DES CYCLES PLANS, MESURÉ DE LA MÊME FAÇON — c'est la seule famille dont
   la dérivée ne s'écrit pas d'un trait : elle passe par deux scalaires (X = A·B et
   Y = |v|·u·(v×w), la règle du quotient d'un atan2) et par les dérivées de CES deux
   scalaires, atome par atome. La formule « de la littérature » essayée d'abord ne
   tombait juste que pour deux des quatre atomes d'un dièdre ; celle-ci se mesure. */
const ringX = buckled.flat();
const ringTerms = buildRelaxTerms({ elements: Array(6).fill('C'), bonds: RING6, positions: ringX });
const planarOnly = { bonds: [], angles: [], pairs: [], planars: ringTerms.planars };
const ringGrad = new Float64Array(ringX.length);
const ringEnergy = energyOf(planarOnly, ringX, { grad: ringGrad });
ok(ringEnergy.planar > 0,
  `un cycle plissé coûte ${ringEnergy.planar.toFixed(0)} d’énergie de planéité (${ringEnergy.planarRms.toFixed(1)}° hors du plan)`);
near(ringEnergy.total, ringEnergy.planar + ringEnergy.bond + ringEnergy.angle + ringEnergy.pair + ringEnergy.tether,
  '…et cette famille entre dans le total comme les autres', 1e-12);
let worstRing = 0;
for (let k = 0; k < ringX.length; k += 1) {
  const up = ringX.slice(); up[k] += h;
  const dn = ringX.slice(); dn[k] -= h;
  const numeric = (energyOf(planarOnly, up).total - energyOf(planarOnly, dn).total) / (2 * h);
  worstRing = Math.max(worstRing, Math.abs(numeric - ringGrad[k]));
}
const ringScale = Math.max(...Array.from(ringGrad, Math.abs));
ok(worstRing < 1e-6 * ringScale + 1e-9,
  `⚠ le gradient des cycles est le VRAI gradient : pire écart ${worstRing.toExponential(2)} pour des dérivées qui montent à ${ringScale.toFixed(0)}`);
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

/* ════════════ 7ter. LE REBÂTIMENT DE LA PARTIE HORS FENÊTRE ═════════════════
   La demande, mot pour mot : « since you limit the number of bonds and atoms to move,
   the molecules get stretched. At every step, the relaxation should also imply forcing
   resetting of standard distance so that the molecule can shrink because atoms not
   included in the calculation can move. In other words it would be like rebuilding from
   scratch the part of the molecule not included in the calculation. »

   Ce qui doit rester vrai : la partie que la fenêtre n'ancre pas est REPOSÉE À CHAQUE
   PAS (longueur et angle STANDARD, DIÈDRE gardé au chiffre près), donc ses atomes
   BOUGENT et la molécule se RESSERRE au lieu de rester étirée au-delà de la fenêtre ;
   l'ancre est rendue bit à bit ; la molécule tournée donne le rebâtiment tourné ; une
   liaison hors des tables n'est jamais rebâtie ; et le rapport dit tout cela. */

/* LE REBÂTIMENT PUR — une chaîne ÉTIRÉE (2.6 Å de pas), ancre = atome 0. */
const stretched6 = chainAt(6, 2.6, 0.5);
const pureReb = rebuildStandardGeometry({
  positions: stretched6, elements: Array(6).fill('C'), bonds: chainBonds(6), keep: [0],
});
ok(pureReb.ok, 'le rebâtiment tourne');
eq(pureReb.anchors, [0], 'l’ancre demandée est celle-là');
eq(pureReb.placed, [1, 2, 3, 4, 5], '…et tous les autres atomes sont REPOSÉS');
eq(pureReb.kept, [], '…aucun n’est laissé de côté (toutes les liaisons sont dans les tables)');
eq(pureReb.roots, [], '…et aucune composante détachée : le graphe est d’un seul tenant');
eq(pureReb.steps, 5, '…le rapport dit combien d’atomes il a posés');
eq(atomAt(pureReb.positions, 0), atomAt(stretched6, 0), '⚠ l’ancre est rendue BIT À BIT');
eq(stretched6, chainAt(6, 2.6, 0.5), '⚠ …et la géométrie reçue n’est JAMAIS modifiée');
[0, 1, 2, 3, 4].forEach((i) => near(distOf(pureReb.positions, i, i + 1), 1.54,
  `…la liaison ${i}–${i + 1} revient à la longueur de la table (1.54 Å)`, 1e-9));
[1, 2, 3, 4].forEach((i) => near(angleDeg(
  atomAt(pureReb.positions, i - 1), atomAt(pureReb.positions, i), atomAt(pureReb.positions, i + 1),
), 109.47, `…l’angle en ${i} revient au tétraèdre`, 0.01));
/* LES DIÈDRES SONT GARDÉS — c’est ce qui distingue un rebâtiment d’un démêlage : la
   conformation ne bouge pas, seules les longueurs et les angles reviennent au standard. */
[0, 1, 2].forEach((i) => near(dihedralDeg(pureReb.positions, i, i + 1, i + 2, i + 3), 180,
  `…le dièdre ${i}–${i + 3} de la source (plan, 180°) est GARDÉ`, 1e-6));
/* LE RAPPORT CHIFFRÉ — ce qu’il a trouvé, ce qu’il laisse. */
eq(pureReb.bonds.count, 5, 'les cinq liaisons de la chaîne sont comptées');
eq(pureReb.angles.count, 4, '…et ses quatre angles');
near(pureReb.bonds.rms.before, 1.2457,
  '…l’écart de liaison qu’il a TROUVÉ est mesuré (1.2457 Å rms sur cette chaîne)', 1e-4);
near(pureReb.bonds.rms.after, 0, '…et celui qu’il laisse est nul', 1e-9);
near(pureReb.bonds.worst.before, 1.2457, '…la pire liaison étirée est nommée', 1e-4);
near(pureReb.bonds.worst.after, 0, '…avec ce qu’elle mesure sur le modèle rendu', 1e-9);
eq([pureReb.bonds.worst.i, pureReb.bonds.worst.j], [0, 1], '…et c’est bien la première');
near(pureReb.angles.rms.before, 28.455, 'l’écart d’angle de départ est mesuré (28.455°)', 0.01);
near(pureReb.angles.rms.after, 0, '…et il est nul au bout', 1e-9);
/* IDEMPOTENT — rebâtir un modèle déjà rebâti ne le change pas d’un chiffre. */
const twiceReb = rebuildStandardGeometry({
  positions: pureReb.positions, elements: Array(6).fill('C'), bonds: chainBonds(6), keep: [0],
});
ok(twiceReb.positions.every((v, k) => Math.abs(v - pureReb.positions[k]) < 1e-12),
  '⚠ rebâtir un modèle DÉJÀ rebâti ne le change pas (le rebâtiment est une projection)');

/* LES DIÈDRES NON NULS AUSSI — une hélice, jugée par le lecteur de dièdres du dossier. */
const helixAt = (n) => {
  const flat = [];
  for (let i = 0; i < n; i += 1) flat.push(2.2 * Math.cos(i * 0.9), 2.2 * Math.sin(i * 0.9), 1.3 * i);
  return flat;
};
const helix = helixAt(12);
const helixReb = rebuildStandardGeometry({
  positions: helix, elements: Array(12).fill('C'), bonds: chainBonds(12), keep: [0],
});
let worstDihedral = 0;
for (let i = 0; i + 3 < 12; i += 1) {
  const before = dihedralDeg(helix, i, i + 1, i + 2, i + 3);
  const after = dihedralDeg(helixReb.positions, i, i + 1, i + 2, i + 3);
  worstDihedral = Math.max(worstDihedral, Math.abs(((before - after + 540) % 360) - 180));
}
near(dihedralDeg(helix, 0, 1, 2, 3), -30.37, 'l’hélice de la sonde a bien des dièdres NON nuls', 0.01);
ok(worstDihedral < 1e-9,
  `⚠ tous les dièdres de la partie rebâtie sont GARDÉS (pire écart ${worstDihedral.toExponential(2)}°)`);
[0, 1, 2].forEach((i) => near(distOf(helixReb.positions, i, i + 1), 1.54,
  '…et ses liaisons sont à la table, elles aussi', 1e-9));
/* AUCUNE DIRECTION PRIVILÉGIÉE — la molécule tournée donne le rebâtiment tourné. */
const spinX = (flat, deg) => {
  const t = (deg * Math.PI) / 180; const c = Math.cos(t); const s = Math.sin(t);
  const out = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push(flat[i], flat[i + 1] * c - flat[i + 2] * s, flat[i + 1] * s + flat[i + 2] * c);
  }
  return out;
};
const spunReb = rebuildStandardGeometry({
  positions: spinX(helix, 90), elements: Array(12).fill('C'), bonds: chainBonds(12), keep: [0],
});
const spun = spinX(helixReb.positions, 90);
ok(spun.every((v, k) => Math.abs(v - spunReb.positions[k]) < 1e-12),
  '⚠ tourner la molécule tourne le rebâtiment : le dièdre gardé n’est pas une convention devinée');

/* ════════════ 7quater. CE QUI NE SUIT PAS — ET QUI LE DIT ═════════════════════ */
const znChain = [0, 0, 0, 2.4, 0, 0, 4.8, 0, 0];
const znReb = rebuildStandardGeometry({
  positions: znChain, elements: ['ZN', 'ZN', 'ZN'], bonds: [[0, 1], [1, 2]], keep: [],
});
eq(znReb.placed, [], '⚠ une liaison que la table ne connaît pas n’est JAMAIS rebâtie');
eq(znReb.kept, [0, 1, 2], '…ses atomes sont laissés tels quels');
eq(znReb.positions, znChain, '…au chiffre près (rien n’est inventé pour un métal)');
const detached = rebuildStandardGeometry({
  positions: [...chainAt(3, 2.0, 0.3), 20, 0, 0, 22.0, 0, 0],
  elements: Array(5).fill('C'), bonds: [[0, 1], [1, 2], [3, 4]], keep: [0],
});
eq(detached.placed, [1, 2, 4],
  '⚠ une composante qu’AUCUNE liaison ne relie à la fenêtre est rebâtie, elle aussi');
eq(detached.roots, [3], '…depuis son PREMIER atome, qui sert de racine');
eq(detached.kept, [], '…et rien n’est laissé de côté dans cette composante');
const water = [0, 0, 0, 1.9, 0, 0, -0.9, 1.6, 0];
const waterReb = rebuildStandardGeometry({
  positions: water, elements: ['O', 'H', 'H'], bonds: [[0, 1], [0, 2]], keep: [0],
});
near(distOf(waterReb.positions, 0, 1), 0.96, 'une eau étirée revient à O–H 0.96 Å', 1e-9);
near(distOf(waterReb.positions, 0, 2), 0.96, '…des deux côtés', 1e-9);
near(angleDeg(atomAt(waterReb.positions, 1), atomAt(waterReb.positions, 0), atomAt(waterReb.positions, 2)),
  109.47, '…et l’angle H–O–H à l’angle de l’hybridation du sommet', 0.01);
eq(rebuildStandardGeometry({
  positions: chainAt(3, 2.0, 0.3), elements: Array(3).fill('C'), bonds: chainBonds(3),
}).placed, [1, 2], 'sans `keep` du tout, chaque composante est rebâtie depuis son premier atome');
eq(rebuildStandardGeometry({ positions: null }).reason, 'bad-points',
  'sans coordonnées lisibles, le rebâtiment refuse — comme la descente');
eq(rebuildStandardGeometry({ positions: [0, 0, 0], source: [1, 2] }).reason, 'bad-source',
  '…et une géométrie de référence d’une autre taille aussi');

/* ════════════ 7quinquies. LE REBÂTIMENT DANS LA DESCENTE ═════════════════════
   LE cas de la demande : une chaîne étirée, une fenêtre étroite autour des atomes à
   rapprocher — et la molécule qui RESTE ÉTIRÉE au-delà de la fenêtre, puisque rien n'y
   bouge. Avec le rebâtiment, la même fenêtre resserre la molécule ENTIÈRE. */
const wide8 = chainAt(8, 2.9, 0.6);
const spec8 = { elements: Array(8).fill('C'), bonds: chainBonds(8) };
const win3 = [0, 1, 2];
const rebRun = relaxGeometry({
  ...spec8, positions: wide8, movable: win3, rebuild: true, steps: 60, stageStep: 0, escapes: 0,
});
const noRebRun = relaxGeometry({
  ...spec8, positions: wide8, movable: win3, steps: 60, stageStep: 0, escapes: 0,
});
ok(rebRun.ok, 'le geste AVEC rebâtiment tourne');
eq(noRebRun.rebuild, null, '⚠ sans le demander, le rapport ne porte AUCUN rebâtiment (le geste d’avant)');
eq(rebRun.rebuild.used, true, '…et demandé, il est là');
eq(rebRun.rebuild.atoms, 5, 'il a reposé les cinq atomes hors fenêtre');
eq(rebRun.rebuild.untouched, 0, '…et n’en a laissé aucun (toutes les liaisons sont dans les tables)');
eq(rebRun.rebuild.parts, 0, '…aucune composante détachée');
ok(rebRun.rebuild.passes > 0, `…il a tourné à chaque pas (${rebRun.rebuild.passes} passes)`);
ok(rebRun.rebuild.moved > 0, `…et ses atomes ont VRAIMENT bougé (${rebRun.rebuild.moved})`);
eq(atomAt(noRebRun.positions, 7), atomAt(wide8, 7),
  '⚠ sans rebâtiment, le dernier atome est rendu BIT À BIT (rien ne bouge hors fenêtre)');
ok(Math.abs(distOf(noRebRun.positions, 6, 7) - 1.54) > 0.9,
  '⚠ …donc la molécule reste ÉTIRÉE au-delà de la fenêtre (la demande, mot pour mot)');
near(distOf(rebRun.positions, 6, 7), 1.54,
  '…la MÊME fenêtre, avec le rebâtiment, ramène la liaison la plus lointaine à la table', 1e-9);
[3, 4, 5, 6].forEach((i) => near(distOf(rebRun.positions, i, i + 1), 1.54,
  `…toute la partie hors fenêtre est au standard (liaison ${i}–${i + 1})`, 1e-9));
ok(rebRun.moved.includes(7) && rebRun.moved.includes(5),
  '⚠ le rapport nomme les atomes HORS fenêtre comme déplacés (ils suivent le geste)');
ok(rebRun.rebuild.bonds.rms.before > 1 && rebRun.rebuild.bonds.rms.after < 1e-9,
  `…et il chiffre ce qu’ils ont gagné (${rebRun.rebuild.bonds.rms.before.toFixed(3)} →`
  + ` ${rebRun.rebuild.bonds.rms.after.toFixed(9)} Å rms)`);
/* LE MÊME MODÈLE, DEUX FOIS — le rebâtiment ne tire rien, il ne peut pas dériver. */
const rebAgain = relaxGeometry({
  ...spec8, positions: wide8, movable: win3, rebuild: true, steps: 60, stageStep: 0, escapes: 0,
});
eq(rebAgain.positions, rebRun.positions, '⚠ deux gestes identiques rendent EXACTEMENT le même modèle');
eq(rebAgain.rebuild.passes, rebRun.rebuild.passes, '…au même nombre de passes près');
eq(RELAX_REBUILD, false, 'le défaut du MODULE reste le geste d’avant (les sondes du dossier le mesurent)');
eq(RELAX_DEFAULT_REBUILD, true, '…et celui du PANNEAU est le rebâtiment (la demande, mot pour mot)');
/* `steps: 0` NE REBÂTIT RIEN — une lecture ne touche à rien, même la case cochée. */
const dryRun = relaxGeometry({ ...spec8, positions: wide8, movable: win3, rebuild: true, steps: 0 });
eq(dryRun.positions, wide8, 'steps = 0 : aucune coordonnée n’est touchée, même avec le rebâtiment');
eq(dryRun.rebuild.passes, 0, '…et le rebâtiment n’a pas tourné une seule fois');
/* LE PAS ANNONCÉ PORTE LES ATOMES QUE LE GESTE PEUT DÉPLACER — c’est ce que l’animation
   du panneau écrit à l’écran (si elle ne portait que la fenêtre, la molécule se replierait
   d’un coup à la dernière image). */
const looseSteps = [];
relaxGeometry({
  ...spec8, positions: wide8, movable: win3, rebuild: true, steps: 20, stageStep: 0, escapes: 0,
  onStep: (v) => looseSteps.push(v),
});
eq(looseSteps[looseSteps.length - 1].loose, [0, 1, 2, 3, 4, 5, 6, 7],
  '⚠ `onStep.loose` = la fenêtre + les atomes reposés : c’est ce que l’animation écrit');
eq(looseSteps[looseSteps.length - 1].movable, win3, '…et `movable` reste la fenêtre, telle quelle');
const plainSteps = [];
relaxGeometry({
  ...spec8, positions: wide8, movable: win3, steps: 20, stageStep: 0, escapes: 0,
  onStep: (v) => plainSteps.push(v),
});
eq(plainSteps[plainSteps.length - 1].loose, win3,
  '…et sans rebâtiment, `loose` EST la fenêtre (le geste d’avant ne change pas)');

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

/* ════════════ 10bis. LE PAS À PAS ET LA REPRISE ═════════════════════════════
   « Le programme commence à rapprocher les deux atomes pas à pas. » Mesuré sur un
   cycle portant une chaîne dont deux atomes doivent passer de 7.35 Å à 3.00 Å : d'un
   seul tenant la descente n'aboutit PAS (la tension de la contrainte la bloque), par
   paliers de 2 Å elle arrive au bout de ce que la géométrie peut donner — et chaque
   palier se termine par une REPRISE qui relâche la fenêtre entière, la distance
   obtenue tenue par un ressort plus raide. C'est la demande, mot pour mot : « starts
   with 18, relax, then 16, relax… ». */
eq(RELAX_STAGE_STEP, 2, 'le palier par défaut du rapprochement : 2 Å');
ok(RELAX_MAX_STAGE_STEP > RELAX_STAGE_STEP, '…et le plafond du champ du panneau est plus large');
ok(RELAX_RESTORE_STEPS > 0, 'la reprise a ses propres pas');
ok(RELAX_RESTORE_STIFFNESS > 1,
  '⚠ le ressort de la reprise est plus raide que celui de la descente : la distance obtenue ne repart pas');
const pullStages = (stageStep, restoreSteps) => relaxGeometry({
  positions: ringAndChain.flat(), elements: Array(9).fill('C'), bonds: ringChainBonds,
  pairs: [{ i: 3, j: 8, target: 3 }], stageStep, restoreSteps,
});
const startGap = Math.hypot(...[0, 1, 2].map((c) => ringAndChain[3][c] - ringAndChain[8][c]));
const oneGo = pullStages(0, 0);
const staged = pullStages(RELAX_STAGE_STEP, RELAX_RESTORE_STEPS);
ok(oneGo.pairs[0].after > startGap - 1,
  `⚠ d’UN SEUL tenant, la descente reste à ${oneGo.pairs[0].after.toFixed(2)} Å sur les ${startGap.toFixed(2)} Å du départ (elle ne bouge presque pas) : c’est le geste d’AVANT`);
ok(staged.pairs[0].after < oneGo.pairs[0].after - 2,
  `…par paliers de ${staged.stageStep} Å elle atteint ${staged.pairs[0].after.toFixed(2)} Å`);
eq(oneGo.stages, 1, 'un palier de 0 Å : aucune découpe (le geste d’avant)');
eq(staged.stages, Math.ceil((startGap - 3) / RELAX_STAGE_STEP),
  '…et le nombre de paliers est celui que la distance à couvrir demande (18 → 16 → 14…)');
const gaps = staged.stagePlan.map((s) => s.distance[0]);
ok(gaps.every((d, i) => i === 0 || d <= gaps[i - 1] + 0.001),
  `la distance DESCEND palier après palier : ${gaps.map((d) => d.toFixed(1)).join(' → ')}`);
ok(gaps.every((d) => d >= 3 - 0.001), '⚠ …sans jamais repasser SOUS la cible demandée');
eq(staged.restorations, staged.stages + 1,
  'chaque palier a sa reprise, plus celle du dernier rapprochement (le geste referme)');
ok(staged.restore && staged.restore.passes === staged.restorations,
  '…et le rapport porte une entrée par reprise (`restore.passes`)');
ok(staged.restore.pairDrift < 0.05,
  `⚠ la reprise ne repart PAS avec la distance obtenue : ${staged.restore.pairDrift.toFixed(3)} Å de dérive au plus (ressort ${RELAX_RESTORE_STIFFNESS}×)`);
ok(staged.restore.bondRms.after !== staged.restore.bondRms.before
  || staged.restore.angleRms.after !== staged.restore.angleRms.before,
  `…et elle a bel et bien travaillé : liaisons ${staged.restore.bondRms.before.toFixed(4)} → ${staged.restore.bondRms.after.toFixed(4)} Å rms, angles ${staged.restore.angleRms.before.toFixed(2)}° → ${staged.restore.angleRms.after.toFixed(2)}°`);
const noRestore = pullStages(RELAX_STAGE_STEP, 0);
eq(noRestore.restorations, 0, 'restoreSteps = 0 : aucune reprise, et le rapport le dit');
ok(noRestore.after.bondRms > staged.after.bondRms,
  `…la tension reste alors dans le modèle : ${noRestore.after.bondRms.toFixed(4)} Å rms contre ${staged.after.bondRms.toFixed(4)} avec les reprises`);
const noPairStaged = relaxGeometry({ ...spec5, positions: bent, stageStep: RELAX_STAGE_STEP });
eq(noPairStaged.positions, bentRun.positions,
  '⚠ sans distance demandée, le pas à pas ne change RIEN : la descente reste celle d’avant');
eq(noPairStaged.stages, 0, '…et le rapport ne compte aucun palier');

/* ════════════ 9. LES ÉCHAPPÉES — SORTIR D'UNE BUCHE LOCALE ══════════════════
   « Non funziona […] finisce sempre per geometrie irrealizzabili. » Deux
   questions, deux réponses mesurables : QU'EST-CE qu'une géométrie irréalisable
   (deux atomes que le graphe ne relie pas et qui se touchent), et COMMENT sortir
   d'une buche locale (une botte de torsion, puis une descente, en gardant le
   meilleur modèle). Rien n'est imprévisible pour autant : la graine est FIXE, donc
   le même geste redonne le même construit au chiffre près. */

/* ── 9a · LES CONTACTS TROP COURTS ─────────────────────────────────────────── */
eq(RELAX_CLASH_DISTANCE, 1.45, 'deux atomes non liés à moins de 1.45 Å : un contact trop court');
ok(RELAX_CLASH_WEIGHT >= RELAX_WEIGHTS.pair,
  '⚠ une échappée qui en crée un est refusée : il pèse au moins un écart de 0.1 Å sur la distance demandée');
const touch = clashReportOf({ positions: [0, 0, 0, 0.8, 0, 0], bonds: [], atomCount: 2 });
eq(touch.count, 1, 'deux atomes à 0.8 Å sans liaison : UN contact trop court');
eq(touch.worst, { i: 0, j: 1, distance: 0.8 }, '…le rapport nomme le couple et sa distance');
near(touch.severity, (1.45 - 0.8) ** 2, '…et porte sa gravité Σ (seuil − d)², le chiffre des échappées', 1e-12);
eq(touch.pairs.length, 1, '…ainsi que la liste nommée');
eq(clashReportOf({ positions: [0, 0, 0, 0.8, 0, 0], bonds: [[0, 1]], atomCount: 2 }).count, 0,
  '⚠ deux atomes LIÉS ne sont jamais un contact : c’est le graphe qui décide, pas une distance imaginée');
eq(clashReportOf({ positions: [0, 0, 0, 1.5, 0, 0], bonds: [], atomCount: 2 }).count, 0,
  '…et 1.5 Å, au-dessus du seuil, n’en est pas un');
const crowd = [0, 0, 0, 0.5, 0, 0, 1.0, 0, 0, 1.4, 0, 0];
eq(clashReportOf({ positions: crowd, bonds: [], atomCount: 4 }).count, 6,
  'quatre atomes empilés : TOUS les couples non liés sont comptés (six)');
eq(clashReportOf({ positions: crowd, bonds: [], atomCount: 4, maxReported: 2 }).pairs.length, 2,
  '…mais le rapport n’en NOMME que ce qu’on lui demande');
eq(clashReportOf({ positions: crowd, bonds: [], atomCount: 4, movable: [0] }).count, 3,
  '⚠ la mesure est LOCALE : avec un seul atome mobile, seuls SES contacts comptent');
eq(clashReportOf({ positions: crowd, bonds: [], atomCount: 4, movable: [0, 2] }).count, 5,
  '…et un couple dont les DEUX atomes bougent n’est compté qu’une fois');
eq(clashReportOf({ positions: crowd, bonds: [], atomCount: 4, movable: [0] }).checked, 1,
  '…`checked` dit combien d’atomes ont été regardés');
eq(clashReportOf({ positions: null, bonds: [] }).count, 0, 'sans coordonnées, aucun contact — jamais une exception');

/* ── 9b · LE TIRAGE, LE CÔTÉ, LA BOTTE ─────────────────────────────────────── */
const rndA = makeRelaxRandom(RELAX_ESCAPE_SEED);
const rndB = makeRelaxRandom(RELAX_ESCAPE_SEED);
const rndC = makeRelaxRandom(7);
const seqA = [rndA(), rndA(), rndA()];
eq(seqA, [rndB(), rndB(), rndB()], '⚠ deux tirages de MÊME graine donnent la même suite : le construit est reproductible');
ok(seqA.every((v) => v >= 0 && v < 1), '…des nombres dans [0, 1)');
ok(seqA.join() !== [rndC(), rndC(), rndC()].join(), '…et une autre graine, une autre suite');

const kickGraph = bondGraphOf({ bonds: chainBonds(6), atomCount: 6 });
eq(bondSideOf({ neighbours: kickGraph.neighbours, atom: 1, other: 2, atomCount: 6 }), [0],
  'le côté de la liaison 1–2 d’une chaîne, c’est l’atome 0 (l’axe, lui, ne bouge pas)');
eq(bondSideOf({ neighbours: kickGraph.neighbours, atom: 1, other: 0, atomCount: 6 }), [2, 3, 4, 5],
  '…et de l’autre côté de la même liaison, le reste de la chaîne');
eq(bondSideOf({ neighbours: kickGraph.neighbours, atom: 0, other: 1, atomCount: 6 }), [],
  '⚠ du côté du PREMIER atome il n’y a personne d’autre : la liste est vide, pas inventée');
const kickRingGraph = bondGraphOf({ bonds: RING6, atomCount: 6 });
eq(bondSideOf({ neighbours: kickRingGraph.neighbours, atom: 0, other: 1, atomCount: 6 }), null,
  '⚠ une liaison de CYCLE n’a AUCUN côté : ce n’est pas une charnière, la botte la refusera');
eq(bondSideOf({ neighbours: kickGraph.neighbours, atom: 1, other: 1 }), null, 'un axe dégénéré n’a pas de côté non plus');
eq(bondSideOf({ neighbours: null, atom: 0, other: 1 }), null, '…ni un graphe absent');

const kickN = 12;
const kickBonds = chainBonds(kickN);
const kickStart = chainAt(kickN, 1.54, 0.4);
const kickFrozen = kickStart.slice();
const kickAll = [...Array(kickN).keys()];
const kick = torsionKickOf({
  positions: kickStart, bonds: kickBonds, atomCount: kickN,
  movable: kickAll, seeds: [0, kickN - 1], angleDeg: RELAX_KICK_DEG,
});
ok(kick.ok, 'une botte tourne sur une chaîne (une liaison sépare toujours un arbre)');
eq(kickStart, kickFrozen, '⚠ les coordonnées reçues ne sont JAMAIS modifiées (la botte travaille sur une copie)');
ok(kickBonds.some(([a, b]) => (a === kick.bond.a && b === kick.bond.b)
  || (a === kick.bond.b && b === kick.bond.a)), '…et la liaison tournée est une VRAIE liaison du graphe');
near(Math.abs(kick.angle), RELAX_KICK_DEG, '…tournée de l’angle demandé (le signe, lui, est tiré)', 1e-9);
eq(kick.turned, 1,
  '⚠ UN SEUL des deux atomes de la paire est du côté tourné : la distance DEMANDÉE change forcément');
eq([kick.bond.a, kick.bond.b].some((i) => kick.side.includes(i)), false,
  '⚠ aucun atome de l’AXE ne tourne : ils sont sur l’axe, par construction');
eq(atomAt(kick.positions, kick.bond.a), atomAt(kickStart, kick.bond.a), '…l’ancrage est immobile, au chiffre près');
let kickWorstBond = 0;
for (let i = 0; i < kickN - 1; i += 1) {
  kickWorstBond = Math.max(kickWorstBond,
    Math.abs(distOf(kick.positions, i, i + 1) - distOf(kickStart, i, i + 1)));
}
ok(kickWorstBond < 1e-12,
  `⚠ toutes les liaisons sont préservées (pire écart ${kickWorstBond.toExponential(1)} Å) : une botte est une rotation RIGIDE, elle ne casse aucune géométrie`);
const sideSet = new Set(kick.side);
let kickWorstAngle = 0;
for (let j = 1; j < kickN - 1; j += 1) {
  const trio = [j - 1, j, j + 1];
  const inside = trio.every((i) => sideSet.has(i));
  const outside = trio.every((i) => !sideSet.has(i));
  if (!inside && !outside) continue;        // cet angle ENJAMBE l’axe : le seul qui a le droit de changer
  kickWorstAngle = Math.max(kickWorstAngle, Math.abs(
    angleDeg(atomAt(kick.positions, trio[0]), atomAt(kick.positions, trio[1]), atomAt(kick.positions, trio[2]))
    - angleDeg(atomAt(kickStart, trio[0]), atomAt(kickStart, trio[1]), atomAt(kickStart, trio[2])),
  ));
}
ok(kickWorstAngle < 1e-9,
  '…et les angles INTERNES au côté tourné ne bougent pas non plus (seuls ceux qui enjambent l’axe changent)');
const kickPairBefore = distOf(kickStart, 0, kickN - 1);
const kickPairAfter = distOf(kick.positions, 0, kickN - 1);
ok(Math.abs(kickPairAfter - kickPairBefore) > 1e-6,
  `…donc la distance DEMANDÉE a bougé (${kickPairBefore.toFixed(3)} → ${kickPairAfter.toFixed(3)} Å) : c’est tout l’intérêt de la botte`);
const kickAgain = torsionKickOf({
  positions: kickStart, bonds: kickBonds, atomCount: kickN,
  movable: kickAll, seeds: [0, kickN - 1], angleDeg: RELAX_KICK_DEG,
});
eq(kickAgain.positions, kick.positions, '⚠ deux appels identiques donnent la MÊME botte (graine fixe)');
const smallWin = torsionKickOf({
  positions: kickStart, bonds: kickBonds, atomCount: kickN, movable: [0, 1, 2], seeds: [0, kickN - 1], angleDeg: 60,
});
ok(!smallWin.ok || smallWin.side.every((i) => [0, 1, 2].includes(i)),
  '⚠ une fenêtre étroite ne fait tourner QUE les atomes qu’on lui donne — ou refuse la botte');
eq(torsionKickOf({ positions: flatRing(1.39).flat(), bonds: RING6, atomCount: 6, seeds: [0, 3] }).reason, 'no-bridge',
  '⚠ six liaisons de cycle : aucune charnière — la botte refuse au lieu de déformer le cycle');
eq(torsionKickOf({ positions: kickStart, bonds: [], atomCount: kickN }).reason, 'no-bond', 'sans liaison, aucune botte');
eq(torsionKickOf({ positions: null }).reason, 'bad-points', '…sans coordonnées non plus');
eq(torsionKickOf({ positions: kickStart, bonds: kickBonds, atomCount: kickN, movable: [] }).reason, 'no-movable',
  '…ni sans un seul atome mobile');

/* ── 9c · LES ÉCHAPPÉES, EXÉCUTÉES — LE REPLIEMENT QUE LA DESCENTE NE SAIT PAS FAIRE ─
   Le cas du rapport : soixante carbones en zigzag (2.6 Å entre voisins, 153 Å d'un
   bout à l'autre) et les deux BOUTS à rapprocher à 3 Å. La descente seule laisse la
   molécule étirée ; les 🎲 bottes de torsion la replient. Tout est mesuré ici. */
eq(RELAX_ESCAPES, 0, '⚠ le défaut du MODULE reste le geste d’avant : aucune botte (les sondes du dossier le mesurent)');
eq(RELAX_DEFAULT_ESCAPES, 6, '…et le panneau du viewer, lui, en envoie six');
ok(RELAX_MAX_ESCAPES >= RELAX_DEFAULT_ESCAPES, '…sous un plafond plus grand que lui');
eq(RELAX_ESCAPE_STEPS, 60, 'chaque botte est suivie d’une descente COURTE (60 pas)');
ok(RELAX_KICK_DEG > RELAX_MIN_KICK_DEG,
  '⚠ l’amplitude DÉCROÎT d’une botte à l’autre : les premières explorent, les dernières ajustent');
const LONG_N = 60;
const longEls = Array(LONG_N).fill('C');
const longStart = chainAt(LONG_N, 2.6, 0.5);
const longBonds = chainBonds(LONG_N);
const longPairs = [{ i: 0, j: LONG_N - 1, target: 3 }];
const longGap = distOf(longStart, 0, LONG_N - 1);
const longSpec = { positions: longStart, elements: longEls, bonds: longBonds, pairs: longPairs };
const plainRun = relaxGeometry(longSpec);
ok(!plainRun.reached,
  `la descente seule n’atteint pas 3 Å sur ${longGap.toFixed(1)} Å d’écart (elle finit à ${plainRun.pairs[0].after.toFixed(2)} Å) : c’est le « non funziona » du rapport`);
eq(plainRun.stages, RELAX_MAX_STAGES,
  '⚠ …et les paliers sont PLAFONNÉS (24) au lieu d’être tronqués : le voyage entier est planifié');
ok(plainRun.stageStep > RELAX_STAGE_STEP,
  `…avec un pas PLUS GRAND que les 2 Å du champ (${plainRun.stageStep.toFixed(2)} Å) — c’est ce qui fait arriver la cible au bout`);
ok(plainRun.pairs[0].after < longGap / 3,
  `…donc elle va beaucoup plus loin qu’un arrêt au 24ᵉ palier : ${plainRun.pairs[0].after.toFixed(2)} Å obtenus pour ${longGap.toFixed(1)} Å de départ`);
eq(plainRun.escapes.skip, 'off', 'sans 🎲 bottes demandées, le rapport DIT que le geste est celui d’avant');
eq(plainRun.escapes.tried, 0, '…aucune botte essayée');
ok(plainRun.reason !== 'escaped', '…et sa raison est celle de la descente, jamais celle d’une botte');
const zeroRun = relaxGeometry({ ...longSpec, escapes: 0 });
eq(zeroRun.positions, plainRun.positions, '⚠ escapes: 0 est EXACTEMENT l’ancien geste : mêmes coordonnées, au chiffre près');
const escapedRun = relaxGeometry({ ...longSpec, escapes: RELAX_DEFAULT_ESCAPES });
eq(escapedRun.escapes.wanted, RELAX_DEFAULT_ESCAPES, 'les six bottes demandées sont bien celles du rapport');
eq(escapedRun.escapes.tried, RELAX_DEFAULT_ESCAPES, '…toutes essayées');
ok(escapedRun.escapes.improved > 0, `…et ${escapedRun.escapes.improved} GARDÉES (chacune un autre pli)`);
eq(escapedRun.escapes.rejected, escapedRun.escapes.tried - escapedRun.escapes.improved,
  '…les autres REFUSÉES : le meilleur modèle ne recule jamais');
eq(escapedRun.escapes.plan.length, escapedRun.escapes.tried, 'le rapport porte une entrée par botte');
ok(escapedRun.escapes.plan.every((p) => p.bond && Number.isInteger(p.bond.a) && Number.isInteger(p.bond.b)),
  '…avec la liaison réellement tournée');
ok(escapedRun.escapes.plan.every((p) => Math.abs(p.angle) <= RELAX_KICK_DEG + 1e-9),
  '…et son angle, jamais au-delà de l’amplitude demandée');
ok(Math.abs(escapedRun.escapes.plan[0].angle)
  >= Math.abs(escapedRun.escapes.plan[escapedRun.escapes.plan.length - 1].angle),
  '⚠ …et cette amplitude DÉCROÎT bien d’une botte à la suivante');
ok(escapedRun.escapes.plan.filter((p) => p.accepted).length === escapedRun.escapes.improved,
  '…les entrées gardées sont celles qui ont amélioré la fonction cible');
ok(escapedRun.pairs[0].after < plainRun.pairs[0].after,
  `⚠ LES BOTTES RAPPROCHENT VRAIMENT LA CIBLE : ${plainRun.pairs[0].after.toFixed(2)} Å → ${escapedRun.pairs[0].after.toFixed(2)} Å`);
ok(escapedRun.after.total < plainRun.after.total,
  `…et la fonction cible BAISSE : ${plainRun.after.total.toFixed(0)} → ${escapedRun.after.total.toFixed(0)}`);
ok(escapedRun.clashes.count <= plainRun.clashes.count,
  `⚠ les contacts trop courts ne sont jamais PIRE qu’avant les bottes (${plainRun.clashes.count} → ${escapedRun.clashes.count})`);
eq(escapedRun.clashes.minDistance, RELAX_CLASH_DISTANCE, '…et le rapport dit à quel seuil il les a comptés');
ok(escapedRun.reason === 'escaped' || escapedRun.reason === 'max-steps' || escapedRun.reason === 'stalled'
  || escapedRun.reason === 'converged', `la raison rendue est une raison connue (${escapedRun.reason})`);
const escapedAgain = relaxGeometry({ ...longSpec, escapes: RELAX_DEFAULT_ESCAPES });
eq(escapedAgain.positions, escapedRun.positions,
  '⚠ deux gestes identiques donnent le MÊME construit, bottes comprises (la graine est fixe)');
const noPairRun = relaxGeometry({ positions: longStart, elements: longEls, bonds: longBonds, escapes: 4 });
eq(noPairRun.escapes.skip, 'no-pair', '⚠ sans distance demandée, les bottes n’ont RIEN à rapprocher : le rapport le dit');
eq(noPairRun.escapes.tried, 0, '…et aucune ne tourne');
const doneRun = relaxGeometry({
  ...spec5, positions: bent, pairs: [{ i: 0, j: 1, target: 1.54 }], escapes: 4,
});
eq(doneRun.escapes.skip, 'reached',
  '⚠ quand la descente n’est PAS coincée, il n’y a rien à fuir : les bottes ne tournent pas non plus');
eq(doneRun.reached, true, '…et la cible est bien atteinte (le rapport le dit aussi)');
const zeroStepRun = relaxGeometry({ ...longSpec, escapes: 4, steps: 0 });
eq(zeroStepRun.escapes.skip, 'no-steps', '…et sans le moindre pas, aucune botte non plus');

/* ════════════ 10. LE PAS VU DE L'EXTÉRIEUR — `onStep` ══════════════════════
   « Sarebbe bello vedere la molecola che cambia ad ogni passo. » Le module annonce
   chaque pas — la phase, les chiffres, les coordonnées de travail — et l'écran s'en
   sert pour ANIMER le geste (voir §11). Ce qui suit vérifie l'ordre, les chiffres et
   les garanties : le dernier état est toujours annoncé, un rapport qui se plaint
   n'arrête rien, et `stepEvery` allège sans rien perdre de la fin. */
const walk = [];
const walked = relaxGeometry({
  ...longSpec, escapes: 2,
  onStep: (v) => { walk.push(v); },
});
ok(walk.length > 100, `le module annonce chaque pas (${walk.length} annonces pour ce geste)`);
eq(walk[walk.length - 1].phase, 'final', '…le DERNIER est l’état final, toujours annoncé');
near(walk[walk.length - 1].energy, walked.after.total, '…avec l’énergie exacte du rapport', 1e-9);
eq(walk[0].phase, 'descend', 'le premier pas annoncé est celui de la descente');
eq(walk[0].stage, 1, '…du premier palier du rapprochement');
eq(walk[0].stages, walked.stages, '…qui annonce le nombre de paliers à venir');
ok(walk.every((v, i) => i === 0 || v.step > walk[i - 1].step), '⚠ les numéros de pas montent, un par un');
ok(walk.every((v) => v.positions.length === LONG_N * 3),
  'chaque annonce porte les coordonnées de TRAVAIL (à copier, jamais à écrire)');
ok(walk.every((v) => v.movable.length === LONG_N && Array.isArray(v.movable)),
  '…et la fenêtre qui a le droit de bouger');
ok(walk.some((v) => v.phase === 'restore'),
  'les REPRISES sont annoncées aussi : la géométrie se détend sous nos yeux, pas seulement à la fin');
ok(walk.some((v) => v.phase === 'kick'), '…et chaque 🎲 botte des échappées');
ok(walk.some((v) => v.phase === 'escape'), '…avec le verdict de la botte');
ok(walk.filter((v) => v.phase === 'kick').length === 2,
  '…autant de kicks que de bottes demandées (2 ici)');
ok(walk.some((v) => v.attempt > 0), '…et la botte en cours est numérotée dans chaque annonce');
near(walk[0].distances[0], longGap, 'la première annonce porte la distance de DÉPART', 1);
ok(walk[walk.length - 1].distances[0] <= walk[0].distances[0],
  '…et la dernière une distance plus courte : le geste a bien rapproché');
const few = [];
relaxGeometry({
  ...spec5, positions: bent, pairs: [{ i: 0, j: 4, target: 2.6 }],
  steps: 40, stageStep: 0, restoreSteps: 0, stepEvery: 8,
  onStep: (v) => { few.push(v); },
});
ok(few.length >= 2 && few.length <= 8,
  `…un pas sur huit n’annonce que ${few.length} états (l’animation reste légère)`);
eq(few[few.length - 1].phase, 'final',
  '⚠ …mais le dernier état est TOUJOURS annoncé : l’animation ne peut pas finir ailleurs');
const noisy = relaxGeometry({
  ...spec5, positions: bent, pairs: [{ i: 0, j: 4, target: 2.6 }], steps: 40, stageStep: 0, restoreSteps: 0,
  onStep: () => { throw new Error('rapport en panne'); },
});
ok(noisy.ok && noisy.steps > 0,
  '⚠ un onStep qui lève ne fait PAS échouer le geste : la descente va au bout');

/* ════════════ 11. LE BRANCHEMENT DU VIEWER ══════════════════════════════════
   bouton, les champs de la fenêtre (« ⇢ moves », « ⇉ stages », « 🎲 escapes »), la
   façon dont la molécule est lue (le vrai graphe de NGL), la cible prise au champ
   A–D ou à la TABLE, le chemin d'écriture d'un geste (writeStructurePositions + le
   journal ↺), un rapport qui dit ce qui est et ce qui n'est pas — et l'ANIMATION :
   la molécule change à chaque pas au lieu du résultat de but en blanc. */
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
has(VIEW, 'if (!writeStructurePositions(comp, movable, flat)) {',
  'chaque image du geste passe par le MÊME chemin d’écriture qu’une torsion (positionFromArray + redessin)');
has(VIEW, 'label: `⚒ model build ${pair.label} ${torsionAng(target)}`,',
  '…et le journal ↺ retient le geste sous son nom (le ↺ est celui de la torsion)');
has(VIEW, 'const report = `${relaxReportOf(pair, run, win)}${warn}`;',
  'le rapport du module est calculé UNE fois, et c’est lui que l’animation affiche à la fin');
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
has(VIEW, 'const [relaxStageStep, setRelaxStageStep] = useState(RELAX_STAGE_STEP);',
  'le pas à pas du ⚒ a son état (le champ « ⇉ stages »)');
has(VIEW, 'const setRelaxStageStepText = (v) => {', '…et son lecteur, borné au plafond du module');
has(VIEW, 'stageStep: relaxStageStep,', '⚠ le champ du pas à pas entre dans la descente');
has(VIEW, '⇉ stages', '…et le champ est nommé « ⇉ stages »');
has(VIEW, '· ${run.terms.rings} planar ring${run.terms.rings === 1 ? ', 'le rapport dit les cycles plans qu’il a tenus plats');
has(VIEW, '· ⇉ ${run.stages} stages of ${run.stageStep} Å', '…et les paliers du rapprochement');
has(VIEW, '· the restores brought bonds ${torsionAng(run.restore.bondRms.before)} → ${torsionAng(run.restore.bondRms.after)} rms',
  '…avec ce que les reprises ont redressé');
has(VIEW, ', moving the distance by ${run.restore.pairDrift.toFixed(3)} Å at most',
  '…et de combien la distance a bougé au passage (le ressort de la reprise, mesuré)');
has(VIEW, 'RELAX_STAGE_STEP, RELAX_MAX_STAGE_STEP, RELAX_PLANAR_TOLERANCE,',
  '…et les trois constantes du pas à pas et de la planéité sont importées');
has(VIEW, 'held at zero, so a ring cannot lose its planarity without the report saying so.',
  '⚠ le bouton ⚒ dit que les cycles du fichier sont tenus plats (le défaut de la demande)');
has(VIEW, 'The pair is brought together BY STAGES', '…et que le rapprochement se fait par paliers');
has(VIEW, 'which is why a benzene no longer comes out of a build slightly plucked',
  'la note du panneau dit ce que le geste corrige (un benzène plissé, 21.6° mesurés)');
has(VIEW, 'A geometric TARGET FUNCTION (ideal bond lengths and angles, the distances you asked for, the planarity of the rings the file itself reads as planar, and ONE HARD CORE — two atoms the file does not bond may not pass through each other) — no charges,',
  '⚠ le rapport dit ce que le geste N’EST PAS : une cible géométrique (la planéité des cycles comprise), pas un champ de forces — et il nomme le CŒUR DUR, la seule chose qui y ressemble (§2bis)');

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

/* ── 11bis · LES ÉCHAPPÉES ET L'ANIMATION — la demande, mot pour mot ──────────
   « Non funziona […] se usassi un metodo di minimizzazione che esce dalle buche
   locali? Sarebbe bello vedere la molecola che cambia ad ogni passo invece che il
   risultato finale di botto. » Le panneau, donc : un champ de plus, un module qui
   annonce chaque pas, et une écriture image par image. */
has(VIEW, 'RELAX_DEFAULT_ESCAPES, RELAX_MAX_ESCAPES, RELAX_CLASH_DISTANCE,',
  'le viewer importe les constantes des 🎲 échappées et des contacts trop courts');
has(VIEW, 'const [relaxEscapes, setRelaxEscapes] = useState(RELAX_DEFAULT_ESCAPES);',
  'le champ « 🎲 escapes » a son état (six bottes par défaut)');
has(VIEW, 'const setRelaxEscapesText = (v) => {', '…et son lecteur, borné au plafond du module');
has(VIEW, 'escapes: relaxEscapes,', '⚠ le nombre de bottes entre dans la descente');
has(VIEW, '🎲 escapes', '…et le champ est nommé « 🎲 escapes » kicks');
has(VIEW, 'onStep,', '…et le module est chargé d’annoncer chaque pas');
has(VIEW, "if (v.phase === 'kick' || v.phase === 'escape' || v.phase === 'final') { keep(v); return; }",
  '⚠ les bottes et le dernier état sont TOUJOURS gardés : on voit le saut d’une buche à l’autre');
has(VIEW, 'const RELAX_ANIM_FRAMES = 240;', 'l’animation est plafonnée en images (≈ 4 s à 60 i/s)');
has(VIEW, 'stride *= 2;',
  '…au-delà du plafond, une image sur deux est jetée et le pas double : la chronologie tient');
has(VIEW, 'const playRelaxFrames = ({', 'l’animation a sa fonction');
has(VIEW, 'window.requestAnimationFrame(tick);', '…et joue une image par image affichée');
has(VIEW, 'const finishRelaxPlayback = () => {', 'un geste en train de jouer se termine D’UN COUP');
has(VIEW, 'finishRelaxPlayback();\n  const pair = torsionPairOf();',
  '…et le ⚒ lui-même le termine avant de recommencer : jamais deux animations sur la même structure');
has(VIEW, 'finalIdxs: run.moved,',
  '…la géométrie finale écrite est celle du rapport, à l’image près');
has(VIEW, 'progressOf: (frame, at, total) => `⚒ building — image ${at}/${total} · step ${frame.step}`',
  '…et la ligne du panneau suit les images, les paliers et les bottes');
has(VIEW, '🎲 ${run.escapes.tried} torsion kick${run.escapes.tried === 1 ? \'\' : \'s\'} of ${run.escapes.wanted}',
  'le rapport dit combien de bottes ont été essayées et combien gardées');
has(VIEW, '` · 🎲 no kick: ${run.escapes.skip}`',
  '…et POURQUOI aucune n’a tourné quand c’est le cas (jamais un silence)');
has(VIEW, "'escaped': 'the descent was stuck in a local minimum",
  'la raison « escaped » du module est traduite, comme les autres');
has(VIEW, 'no atom pair closer than ${torsionAng(run.clashes.minDistance)}',
  '⚠ le rapport dit les contacts trop courts du modèle rendu — le « geometrie irrealizzabili » de la demande');
has(VIEW, 'atom pair${run.clashes.count === 1 ? \'\' : \'s\'} closer than ${torsionAng(RELAX_CLASH_DISTANCE)}',
  '…et quand il en reste, il dit COMBIEN et à quelle distance (le plus court)');
has(VIEW, 'The 🎲 escapes are torsion kicks drawn from a FIXED seed',
  '…en rappelant que les tirages sont à graine fixe : même geste, même construit');
has(VIEW, 'the molecule you are looking at CHANGES at every step',
  'la note du panneau dit que la molécule CHANGE à chaque pas au lieu du résultat de but en blanc');
has(VIEW, 'the gesture is WATCHED: the molecule CHANGES on screen at every step',
  '…et l’infobulle du ⚒ le répète');
has(VIEW, 'clicking ⚒ again while it plays finishes the gesture at once',
  '…avec la façon de sauter l’animation (un clic de plus)');
has(VIEW, 'a rigid rotation of a part of the window about a drawn bond',
  'l’infobulle du champ 🎲 dit ce qu’est une botte : une rotation RIGIDE autour d’une liaison tirée');
has(VIEW, 'a bond inside a ring is refused, so no cycle is ever bent',
  '⚠ …et qu’une liaison de cycle est refusée : aucune botte ne déforme un cycle');

/* ── 11ter · LE REBÂTIMENT DANS LE PANNEAU — la demande, mot pour mot ──────────
   « since you limit the number of bonds and atoms to move, the molecules get
   stretched. At every step, the relaxation should also imply forcing resetting of
   standard distance so that the molecule can shrink because atoms not included in the
   calculation can move. » Le panneau, donc : une case, le réglage qui entre dans la
   descente, un rapport qui dit ce qui a été reposé — et une animation qui porte AUSSI
   les atomes reposés (sinon la molécule se replierait d'un coup à la dernière image). */
has(VIEW, 'RELAX_DEFAULT_ESCAPES, RELAX_MAX_ESCAPES, RELAX_CLASH_DISTANCE, RELAX_DEFAULT_REBUILD,',
  'le viewer importe le réglage du rebâtiment');
has(VIEW, 'const [relaxRebuild, setRelaxRebuild] = useState(RELAX_DEFAULT_REBUILD);',
  'la case « ⟳ rebuild » a son état (le défaut du module : cochée)');
has(VIEW, 'rebuild: relaxRebuild,', '⚠ le rebâtiment entre dans la descente');
has(VIEW, 'onChange={(e) => setRelaxRebuild(e.target.checked)}', '…et la case le commande');
has(VIEW, '⟳ rebuild', '…elle est nommée « ⟳ rebuild »');
has(VIEW, 'the window alone moves and every other atom is returned BIT-FOR-BIT',
  '⚠ la case dit ce qu’elle change : le geste d’avant, la fenêtre seule, le reste au chiffre près');
has(VIEW, 'OUTSIDE the window re-built from scratch',
  'le rapport dit combien d’atomes hors fenêtre ont été rebâtis');
has(VIEW, 'and their angles from ${run.rebuild.angles.rms.before.toFixed(1)}° to ${run.rebuild.angles.rms.after.toFixed(1)}°',
  '…ce que leurs liaisons ET leurs angles ont gagné');
has(VIEW, 'left alone (no bond the tables know)',
  '…et ce qui n’a PAS pu suivre (une liaison que la table ne connaît pas)');
has(VIEW, 'OUTSIDE the window is re-built from scratch at every step',
  'la note du rapport redit le geste, et comment revenir à celui d’avant');
has(VIEW, 'so the molecule can re-compact around the window instead of being stretched by it.',
  'le champ « ⇢ moves » dit que la fenêtre borne ce qui PILOTE, pas ce qui bouge');
has(VIEW, 'Array.isArray(v.loose)', '⚠ l’animation lit `loose` : les atomes que le module peut déplacer');
has(VIEW, 'movable: collector.atoms(),', '…et c’est LEUR liste qui est écrite à chaque image');
has(VIEW, 'let frameAtoms = fallback;', '…la fenêtre restant le point de départ de l’animation');

/* ════════════ 12. LE CONSTRUIT AUTOMATIQUE ══════════════════════════════════
   La demande, mot pour mot : « model build should also work without defining the
   atoms to bring closer and their distance : the function should find the wrong
   distances by itself and apply the “bring them closer step by step”/“relax”/
   “rebuild” protocol (the one already defined for two atoms) to impose the right
   distances until everything is back. If the protocol on the first distance has
   generated other wrong distances, move on to the second. »

   §12a LE BALAYAGE (`badDistancesOf`) : les longueurs fausses sont trouvées sans
        que personne ne désigne rien, les cibles sont celles de la DESCENTE
        (aromatique comprise), la plus fausse vient en tête, et ce que la table ne
        connaît pas est COMPTÉ, jamais deviné ;
   §12b LE PROTOCOLE, UNE DISTANCE APRÈS L'AUTRE (`buildModelGeometry`) : une chaîne
        étirée revient à ses longueurs, la molécule reçue n'est jamais modifiée, et
        deux appels identiques donnent le même modèle ;
   §12c « SI PASSA ALLA SECONDA » — la demande, chiffrée : la première distance
        conduite CRÉE des longueurs fausses (1 → 3, 1.46 → 2.45 Å d'erreur), le
        balayage suivant les conduit, une longueur qu'un geste a déjà remise est
        ANNONCÉE (`already-there`) au lieu d'être reconduite, et ce qui reste faux à
        la fin est MESURÉ (`left`), jamais tu ;
   §12d LES PLAFONDS, LA RESTRICTION ET LE PAS VU DE L'EXTÉRIEUR : `maxDistances` et
        `passes` bornent la boucle (`truncated` le dit), la restriction de l'appelant
        est respectée, chaque pas annonce la distance en cours et une liste d'atomes
        STABLE, et un `onStep` qui lève n'arrête pas le construit ;
   §12e LE BRANCHEMENT DU VIEWER : le ⚒ sans aucun atome piqué, le rapport, la ligne
        qui nomme la longueur en cours, le journal ↺ et les textes du panneau. */

/* ── 12a · LE BALAYAGE ──────────────────────────────────────────────────────── */
const CHAIN_ELS = ['C', 'C', 'C', 'C', 'C', 'C'];
const CHAIN_BONDS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]];
/** Une chaîne de six carbones dont la liaison 1–2 est ÉTIRÉE à 3 Å : exactement le
 *  modèle qu'un geste laisse derrière lui (une S–S déclarée sans géométrie, un
 *  glisser de molécule) — la molécule RÉELLE du geste automatique. */
const stretchedChain = () => {
  const flat = [];
  let x = 0;
  for (let i = 0; i < 6; i += 1) { flat.push(x, 0, 0); x += i === 1 ? 3 : 1.54; }
  return flat;
};

const scan = badDistancesOf({ elements: CHAIN_ELS, bonds: CHAIN_BONDS, positions: stretchedChain() });
ok(scan && scan.count === 1, 'le balayage trouve UNE longueur fausse sur la chaîne étirée, sans qu’on lui désigne rien');
eq([scan.distances[0].i, scan.distances[0].j], [1, 2], '…c’est la liaison étirée, nommée par ses deux atomes');
near(scan.distances[0].target, 1.54, 'sa cible vient de la table (C–C 1.54 Å), pas d’une seconde table');
near(scan.distances[0].distance, 3, 'sa longueur MESURÉE est celle de la géométrie reçue (3 Å)');
near(scan.distances[0].dev, 1.46, 'son écart est SIGNÉ (d − d₀)');
near(scan.severity, 1.46, '…et `severity` est la somme des |écart| : ce que la boucle regarde pour savoir si elle avance');
eq(scan.checked, 5, 'les cinq liaisons que la table connaît sont lues');
eq(scan.unknownBonds, 0, '…et aucune n’est hors des tables');
ok(scan.worst && scan.worst.i === 1 && scan.worst.j === 2, 'la PIRE est nommée à part (le classement la met en tête)');
ok(badDistancesOf({ elements: CHAIN_ELS, bonds: CHAIN_BONDS, positions: null }) === null,
  '⚠ sans coordonnées lisibles, le balayage rend null — jamais « zéro » (une lecture sans réponse n’est pas une réponse)');
eq(badDistancesOf({ elements: CHAIN_ELS, bonds: CHAIN_BONDS, positions: stretchedChain(), tolerance: 1.5 }).count, 0,
  'une tolérance de 1.5 Å ne trouve plus rien (l’écart est de 1.46)');
eq(badDistancesOf({ elements: CHAIN_ELS, bonds: CHAIN_BONDS, positions: stretchedChain(), tolerance: 1.4 }).count, 1,
  '…et à 1.4 Å la même longueur est fausse : c’est la tolérance qui décide, et elle se règle');
near(badDistancesOf({ elements: CHAIN_ELS, bonds: CHAIN_BONDS, positions: stretchedChain(), tolerance: 1.4 }).tolerance, 1.4,
  '…la tolérance reçue est rendue telle quelle dans le rapport');

/* LE CLASSEMENT — deux longueurs fausses, et la PLUS fausse d'abord : c'est elle qui
   a le plus de chances d'être la CAUSE des autres. */
const RANKED_POSITIONS = [0, 0, 0, 2.2, 0, 0, 4, 0, 0, 5.54, 0, 0];
const RANKED_ELS = ['C', 'C', 'C', 'C'];
const RANKED_BONDS = [[0, 1], [1, 2], [2, 3]];
const ranked = badDistancesOf({ elements: RANKED_ELS, bonds: RANKED_BONDS, positions: RANKED_POSITIONS });
eq(ranked.count, 2, 'deux longueurs fausses (2.20 et 1.80 Å pour un C–C de 1.54)');
eq([ranked.distances[0].i, ranked.distances[0].j], [0, 1], '…la PLUS fausse vient en tête (2.20 Å)');
eq([ranked.distances[1].i, ranked.distances[1].j], [1, 2], '…puis la moins fausse (1.80 Å)');
near(ranked.severity, 0.66 + 0.26, '…et `severity` les additionne (0.66 + 0.26 Å)');

/* LA MÊME TABLE QUE LA DESCENTE — un benzène est attendu à 1.39 Å, jamais à 1.54 :
   le balayage ne peut donc pas déclarer fausse une liaison que la descente tient. */
const autoBenzene = [];
for (let i = 0; i < 6; i += 1) {
  const a = (i * Math.PI) / 3;
  autoBenzene.push(1.39 * Math.cos(a), 1.39 * Math.sin(a), 0);
}
const ringScan = badDistancesOf({
  elements: CHAIN_ELS, bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], positions: autoBenzene,
});
eq(ringScan.count, 0, '⚠ un benzène (1.39 Å) n’est PAS déclaré faux : la cible du balayage est celle de la descente');
eq(ringScan.aromaticBonds, 6, '…ses six liaisons sont lues comme AROMATIQUES (le fichier parle lui-même)');
const unknownScan = badDistancesOf({
  elements: ['C', 'C', 'X'], bonds: [[0, 1], [1, 2]],
  positions: [0, 0, 0, 1.54, 0, 0, 6, 0, 0],
});
eq(unknownScan.count, 0, 'une liaison dont la table ne connaît pas le couple n’est JAMAIS déclarée fausse');
eq(unknownScan.unknownBonds, 1, '…elle est COMPTÉE (`unknownBonds`), et le rapport peut le dire');

/* ── 12b · LE PROTOCOLE, UNE DISTANCE APRÈS L'AUTRE ─────────────────────────── */
const fixed = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2,
});
ok(fixed.ok, 'le construit automatique tourne sans qu’aucun atome ne soit désigné');
eq(fixed.reason, 'converged', 'il s’arrête quand plus rien n’est faux, et il le DIT');
eq(fixed.converged, true, '…`converged` est vrai');
eq(fixed.found, 1, 'il a trouvé UNE longueur fausse tout seul');
eq(fixed.distances.length, 1, '…il en a conduit une');
ok(fixed.distances[0].reached, '…et elle est arrivée à sa cible');
eq(fixed.distances[0].stages, 1, '…avec le protocole de §8 : ses paliers (un seul, la cible était proche)');
eq(fixed.distances[0].restores, 1, '…et SA reprise, qui relâche la fenêtre entière après le rapprochement');
eq(fixed.left.length, 0, 'il ne reste RIEN de faux');
near(fixed.leftSeverity, 0, '…et l’erreur totale qui reste est nulle');
eq(fixed.passCount, 1, 'un seul balayage a suffi');
eq(fixed.passes[0].after.count, 0, '…et le balayage qui suit ne trouve plus rien');
eq(fixed.passes[0].reached, 1, '…une distance conduite, une arrivée');
ok(fixed.moved.length > 0, 'des atomes ont bougé');
ok(Math.abs(distOf(fixed.positions, 1, 2) - 1.54) <= RELAX_BOND_TOLERANCE,
  'la liaison étirée est revenue à 1.54 Å, à la tolérance du module près');
ok(fixed.after.total < fixed.before.total, 'l’énergie de la fonction cible a baissé');
ok(fixed.terms && fixed.terms.bonds === 5 && fixed.terms.positions === 6,
  'le rapport donne les termes qu’il a lus (les mêmes champs que `relaxGeometry`)');
ok(fixed.clashes && fixed.clashes.count === 0, '…et les contacts trop courts du modèle rendu, mesurés');
ok(fixed.escapes && fixed.escapes.tried >= 0, '…et le compte des 🎲 échappées de tous ses gestes');
eq(fixed.tolerance, RELAX_BAD_BOND_TOLERANCE, '…et le seuil du balayage, tel qu’il l’a employé');
const chainInput = stretchedChain();
const chainCopy = chainInput.slice();
buildModelGeometry({ positions: chainInput, elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2 });
eq(chainInput, chainCopy, '⚠ les coordonnées REÇUES ne sont jamais modifiées (le module n’écrit que sa copie)');
const again = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2,
});
eq(again.positions, fixed.positions, 'deux appels identiques donnent le MÊME modèle (déterministe, graine fixe des 🎲)');
eq(buildModelGeometry({ positions: null, elements: CHAIN_ELS, bonds: CHAIN_BONDS }).reason, 'bad-points',
  'sans coordonnées lisibles, le construit REFUSE au lieu de croire');
eq(buildModelGeometry({ positions: stretchedChain(), elements: ['X', 'X', 'X', 'X', 'X', 'X'], bonds: CHAIN_BONDS }).reason,
  'no-terms', '…et sans aucune liaison que les tables connaissent, il refuse aussi (rien n’est inventé)');

/* ── 12c · « SI PASSA ALLA SECONDA » — LA DEMANDE, CHIFFRÉE ─────────────────── */
const local = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 0, rebuild: false,
});
eq(local.passes[0].count, 1, '⚒ LE PREMIER BALAYAGE ne trouve qu’une longueur fausse (la liaison 1–2, 3 Å)');
eq(local.passes[1].count, 3, '⚠ LE PROTOCOLE SUR CETTE PREMIÈRE DISTANCE EN A CRÉÉ DEUX AUTRES (1 → 3)');
ok(local.passes[1].severity > local.passes[0].severity,
  '…l’erreur totale a AUGMENTÉ au passage (1.46 → 2.45 Å) : le geste a déplacé le problème');
near(local.passes[1].severity, 2.4457, '…et le chiffre est celui de la géométrie, RELUE (2.4457 Å)', 0.01);
eq(local.distances[0].pass, 1, 'la première distance conduite est celle du premier balayage');
eq([local.distances[0].i, local.distances[0].j], [1, 2], '…la plus fausse d’abord (le classement du balayage)');
ok(local.distances.some((d) => d.pass === 2), 'SI PASSA ALLA SECONDA : le balayage suivant conduit les nouvelles');
const keptAside = local.skipped.filter((s) => s.why === 'already-there');
ok(keptAside.length > 0, '⚠ une longueur qu’un geste précédent a DÉJÀ remise est ANNONCÉE, pas reconduite pour rien');
eq(keptAside[0].pass, 2, '…et c’est au balayage suivant qu’elle est relue');
ok(local.passes.length >= 3, 'la boucle a tourné plusieurs fois (radius 0 : seuls les deux atomes d’une liaison bougent)');
eq(local.reason, 'max-passes', '⚠ elle s’arrête en le DISANT : le plafond de balayages (`RELAX_AUTO_PASSES`) a mordu');
eq(local.converged, false, '…donc `converged` est faux : le rapport ne prétend pas que tout est réglé');
eq(local.left.length, 3, 'ce qui reste faux est MESURÉ : trois longueurs');
ok(local.leftSeverity < local.passes[0].severity,
  '…et l’erreur qui reste (0.98 Å) est plus PETITE que celle du départ (1.46 Å) : la boucle a bien progressé');
ok(local.left.every((d) => d.abs > RELAX_BAD_BOND_TOLERANCE),
  'chaque reste est au-dessus du seuil du balayage — sinon il ne serait pas dans la liste');
ok(local.worst && Math.abs(local.worst.after - 1.911) < 0.01,
  'la pire distance du DÉPART est RELUE à la fin (3.00 → 1.91 Å) : mesurée, jamais promise');
eq(local.worst.reached, false, '…et le rapport dit qu’elle n’est PAS arrivée');
eq(local.worst.driven, true, '…qu’elle a bien été conduite, elle');
near(local.distances[0].after, 2.4016,
  'la première distance, conduite par ses deux atomes SEULS, s’arrête à 2.40 Å — et c’est ce chiffre-là que le rapport donne', 0.02);
eq(local.distances.filter((d) => d.reached).length, local.passes.reduce((s, p) => s + p.reached, 0),
  'le compte des distances arrivées est le même dans les gestes et dans le journal des balayages');
eq(local.passes.reduce((s, p) => s + p.driven, 0), local.distances.length,
  '…et le journal des balayages compte EXACTEMENT les gestes conduits');

/* ── 12d · LES PLAFONDS, LA RESTRICTION ET LE PAS VU DE L'EXTÉRIEUR ─────────── */
const heldAtoms = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2, movable: [0, 1],
});
eq(heldAtoms.moved, [0, 1], '⚠ la restriction de l’appelant est RESPECTÉE : deux atomes bougent, pas un de plus');
eq(heldAtoms.left.length, 0, '…et le protocole suffit quand même à refermer la liaison (l’atome 1 suit la fenêtre)');
ok(heldAtoms.converged, '…la molécule est d’aplomb sans que le reste ait été touché');
const onePass = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 0, rebuild: false, passes: 1,
});
eq(onePass.passCount, 1, '`passes: 1` = un seul balayage, celui qu’on lui accorde');
eq(onePass.reason, 'max-passes', '…et le rapport dit que c’est ce plafond qui l’a arrêté');
ok(onePass.left.length > 0, '…avec ce qui restait faux, mesuré');
const capped = buildModelGeometry({
  positions: RANKED_POSITIONS, elements: RANKED_ELS, bonds: RANKED_BONDS,
  radius: 0, rebuild: false, maxDistances: 1,
});
ok(capped.truncated, '⚠ `maxDistances` a mordu, et le rapport le DIT (`truncated`)');
eq(capped.found, 2, '…le balayage en avait trouvé deux');
eq(capped.passes[0].driven, 1, '…un seul geste a été conduit dans le premier balayage');
eq(capped.distances.length, 1, '…une seule distance a donc été CONDUITE');
eq(capped.reason, 'converged',
  '…et la molécule est revenue quand même : la seconde longueur partageait l’atome du geste (le rapport ne s’en vante pas, il le compte)');
const oneAtATime = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS,
  radius: 0, rebuild: false, maxDistances: 1,
});
ok(oneAtATime.truncated, 'le même plafond, sur une chaîne où chaque distance est indépendante');
eq(oneAtATime.passes.length, oneAtATime.distances.length,
  '⚠ un geste par balayage : le plafond ne fait perdre aucune distance, il les fait attendre');
eq(oneAtATime.passCount, RELAX_AUTO_PASSES, '…et la boucle va jusqu’au plafond de balayages en prenant le reste à chaque fois');
eq(oneAtATime.reason, 'max-passes', '…jusqu’à ce que ce plafond-là l’arrête, et le rapport le dit');
ok(oneAtATime.left.length > 0 && oneAtATime.left.length <= 3, '…avec ce qui reste faux, MESURÉ');
const framesAuto = [];
buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2,
  onStep: (v) => framesAuto.push(v),
});
ok(framesAuto.length > 1, 'le geste ANNONCE chaque pas (`onStep`), comme celui à deux atomes');
const firstFrame = framesAuto[0];
eq(firstFrame.pass, 1, '…chaque pas dit de QUEL balayage il vient');
ok(firstFrame.distance && firstFrame.distance.i === 1 && firstFrame.distance.target === 1.54,
  '…et QUELLE longueur il est en train de conduire');
eq(firstFrame.distance.index, 1, '…sa place dans la file du balayage (1 sur 1 ici)');
eq(firstFrame.distance.total, 1, '…la file entière est annoncée');
eq(firstFrame.loose, [0, 1, 2, 3, 4, 5],
  '⚠ les images portent TOUT le modèle : le geste automatique balaye la molécule, donc n’importe quel atome peut bouger');
eq(framesAuto[framesAuto.length - 1].phase, 'final', '…et le dernier état est toujours annoncé');
const noisyAuto = buildModelGeometry({
  positions: stretchedChain(), elements: CHAIN_ELS, bonds: CHAIN_BONDS, radius: 2,
  onStep: () => { throw new Error('rapport en panne'); },
});
ok(noisyAuto.ok && noisyAuto.found === 1, '⚠ un `onStep` qui lève n’arrête PAS le construit automatique');

/* ── 12e · LE BRANCHEMENT DU VIEWER — LE ⚒ SANS AUCUN ATOME PIOUÉ ─────────────
   La demande, mot pour mot : « model build should also work without defining the
   atoms to bring closer and their distance ». Le panneau, donc : le même bouton,
   aucun atome piqué, le module qui cherche tout seul — et un rapport qui dit ce
   qu’il a trouvé, conduit, fixé, et ce qui reste. */
has(VIEW, 'buildModelGeometry, RELAX_AUTO_PASSES, RELAX_AUTO_MAX_DISTANCES,',
  'le viewer importe le construit automatique et ses deux plafonds');
has(VIEW, 'RELAX_BOND_TOLERANCE, RELAX_ANGLE_TOLERANCE, RELAX_BAD_BOND_TOLERANCE,',
  '…et le seuil à partir duquel une longueur est dite fausse');
has(VIEW, 'const buildModelAuto = () => {', 'le geste automatique a son handler');
has(VIEW, 'if (!pair.ok && torsionAtomsRef.current.length < 2) { buildModelAuto(); return; }',
  '⚠ AUCUN atome piqué : le ⚒ part en construit automatique — c’est la demande');
has(VIEW, 'const collector = relaxFrameCollector();',
  '…il ramasse ses images avec le MÊME ramasseur que le geste à deux atomes');
has(VIEW, 'const run = buildModelGeometry({', '…et c’est le module qui conduit tout');
has(VIEW, 'radius: relaxRadius,', '…la fenêtre du champ « ⇢ moves » sert pour CHAQUE longueur fausse');
has(VIEW, 'if (!run.found && !run.foundContacts) {', '⚠ quand le balayage ne trouve ni longueur fausse ni atome empilé, le panneau le dit au lieu d’écrire');
has(VIEW, 'Nothing to build: the ${run.terms.bonds} bond', '…« rien à construire », avec le nombre de liaisons lues');
has(VIEW, 'but the window around', '⚠ …et quand la fenêtre est vide, il dit quel réglage monter');
has(VIEW, 'label: `⚒ model build (automatic: ${run.found} length',
  'le journal ↺ retient le geste automatique sous son nom (le même ↺ que la torsion)');
has(VIEW, 'const relaxAutoReportOf = (run, win) => {', 'le rapport du construit automatique a sa fonction');
has(VIEW, 'Model build (automatic)', '…il se nomme (le panneau ne peut pas confondre les deux gestes)');
has(VIEW, 'const passes = run.passCount > 1', '…il compte les BALAYAGES');
has(VIEW, 'the moves of the first one left ${created} wrong length',
  '…et DIT que le premier geste a laissé des longueurs fausses : la demande, mot pour mot');
has(VIEW, 'were already at their length when their turn came',
  '…et annonce celles qu’un geste précédent avait déjà remises d’aplomb');
has(VIEW, 'const left = run.left.length', '…et ce qui RESTE faux n’est jamais tu');
has(VIEW, 'of total error left', '…avec l’erreur totale qui reste, chiffrée');
has(VIEW, 'NO atom pair had to be picked: the scan reads the GRAPH the file declares',
  '…et le rapport rappelle que personne n’a rien désigné');
has(VIEW, 'a pair the file does not declare bonded is never pulled together',
  '⚠ …ni qu’il n’invente aucune liaison (un couple non déclaré n’est jamais rapproché)');
has(VIEW, 'const relaxFrameCollector = (fallback = []) => {',
  'le ramasseur d’images est commun aus DEUX gestes du ⚒ (une seule façon de filmer le module)');
has(VIEW, 'onStep: collector.onStep,', '…les deux le branchent de la même façon');
has(VIEW, 'length ${frame.pair.index}/${frame.pair.total}',
  'la ligne du panneau NOMME la longueur en cours de conduite');
has(VIEW, '· ⟳ pass ${frame.pass}', '…et le balayage d’où elle vient');
has(VIEW, "'max-passes': `the ${RELAX_AUTO_PASSES} scans", 'la raison « max-passes » du module est traduite, comme les autres');
has(VIEW, 'With NOTHING picked at all, ⚒ Model build works all the same',
  'le panneau le dit en clair : le ⚒ marche sans aucun atome piqué');
has(VIEW, '⚒ WITH NO ATOM PICKED, the same button builds ON ITS OWN', '…l’infobulle du bouton aussi');
has(VIEW, '⚒ And it needs NO atom picked: press it with nothing selected', '…et la note du panneau aussi');

/* ════════════ 13. LE CŒUR DUR — DEUX ATOMES NE SONT PAS AU MÊME ENDROIT ═══════
   La demande, mot pour mot : « In the calculation you did not consider steric
   clashes along atoms and now they are one on top of each other. » Ce qui est
   vérifié ici, dans l'ordre :

     a) LA TABLE — les rayons de Bondi, la distance de contact (0.6 × la somme), et
        ce qui se passe quand la table ne connaît pas l'élément ;
     b) LA CIBLE MESURÉE SUR LES CYCLES — les couples 1-3/1-4/1-5 d'un benzène et
        d'un pentagone sont PLUS LOIN que le cœur dur : c'est ce qui permet à un
        cycle de rester plan sans que le nouveau terme l'arrache ;
     c) LA MARCHE — ce qu'elle exclut (1-2, 1-3), ce qu'elle retient (1-4 et plus),
        et son MARGIN (un couple pas encore serré y est, et son terme y vaut zéro) ;
     d) LE TERME — w·(d₀ − d)² exactement, zéro au-delà, borné en dessous, son
        gradient ANALYTIQUE vérifié par DIFFÉRENCES FINIES (comme tous les autres),
        sa diagonale de Gauss-Newton, et le pire couple du rapport ;
     e) LA DESCENTE, EXÉCUTÉE — deux atomes empilés s'ÉCARTENT (0.50 → 2.03 Å) même
        quand personne ne demande rien, une demande qui traverserait un atome est
        REFUSÉE (et le rapport dit l'équilibre réellement obtenu) ;
     f) LE BALAYAGE DES CONTACTS TROP COURTS — le classement, la tolérance (0.05 Å,
        pour que la boucle descende au lieu d'osciller), la restriction `movable`,
        les éléments inconnus comptés ;
     g) LE CONSTRUIT AUTOMATIQUE — une molécule EMPILÉE mais aux longueurs justes
        est désempilée ; et quand il y a les deux à faire, les LONGUEURS passent
        d'abord, les contacts ensuite ;
     h) LE BRANCHEMENT DU VIEWER — la lecture du panneau (⛔), le rapport, et
        l'infobulle qui dit que le cœur dur EST dans la fonction cible. */
eq(RELAX_CONTACT_SCALE, 0.6, 'le cœur dur est à 0.6 × la somme des deux rayons');
eq(RELAX_CONTACT_WEIGHT, 30, '…et son poids est 30');
eq(RELAX_WEIGHTS.contact, RELAX_CONTACT_WEIGHT,
  '⚠ le poids du cœur dur est CELUI de RELAX_WEIGHTS : une seule table, jamais deux');
eq(RELAX_CONTACT_LINK_DISTANCE, 2, 'deux liaisons ou moins : le couple est exclu de la marche');
eq(RELAX_CONTACT_TOLERANCE, 0.05, '…et un contact est DIT trop court au-delà de 0.05 Å');
eq(RELAX_CONTACT_MARGIN, 1.2, 'la marche du terme porte 1.2 Å de margin au-dessus du seuil');
eq(RELAX_AUTO_MAX_CONTACTS, 8, 'un balayage du construit automatique conduit au plus 8 contacts');
eq(VDW_RADII.C, 1.70, 'le rayon de van der Waals du carbone (Bondi 1964)');
eq(VDW_RADII.H, 1.20, '…celui de l’hydrogène');
eq(VDW_RADII.S, 1.80, '…celui du soufre');
eq(VDW_RADIUS_FALLBACK, 1.70, 'un élément absent de la table prend le rayon du carbone');
near(contactDistanceOf('C', 'C').distance, 2.04, 'deux carbones se touchent à 2.04 Å', 1e-12);
near(contactDistanceOf('C', 'H').distance, 1.74, '…un carbone et un hydrogène à 1.74 Å', 1e-12);
near(contactDistanceOf('H', 'H').distance, 1.44, '…deux hydrogènes à 1.44 Å', 1e-12);
near(contactDistanceOf('O', 'O').distance, 1.824, '…deux oxygènes à 1.824 Å', 1e-12);
near(contactDistanceOf('S', 'C').distance, 2.1, '…un soufre et un carbone à 2.10 Å', 1e-12);
eq(contactDistanceOf('C', 'C').known, true, 'la table CONNAÎT le carbone');
eq(contactDistanceOf('ZN', 'C').known, false, '⚠ …mais pas le zinc : le repli le DIT, il ne le tait pas');
near(vdwRadiusOf('zn').radius, VDW_RADIUS_FALLBACK, '…et le rayon de repli est bien celui-là', 1e-12);
near(vdwRadiusOf('CL').radius, 1.75, 'un élément de la table rend SON rayon', 1e-12);

/* ── b) LA CIBLE, MESURÉE SUR LES CYCLES QU'ELLE NE DOIT PAS CONTREDIRE ─────── */
const coreRing = {
  elements: new Array(6).fill('C'), bonds: RING6, positions: flatRing(1.39).flat(),
};
near(distOf(coreRing.positions, 0, 2), 2.408, 'un benzène : le couple 1-3 est à 2.408 Å', 5e-4);
near(distOf(coreRing.positions, 0, 4), 2.408,
  '⚠ …et le couple 1-5 (QUATRE liaisons) à la même distance : la symétrie de l’hexagone', 5e-4);
near(distOf(coreRing.positions, 0, 3), 2.780, '…le 1-4 à 2.780 Å', 5e-4);
ok(distOf(coreRing.positions, 0, 4) > contactDistanceOf('C', 'C').distance
  && distOf(coreRing.positions, 0, 3) > contactDistanceOf('C', 'C').distance,
  '⚠ AUCUN de ces couples n’entre dans le cœur dur (2.04 Å) : c’est POURQUOI 0.6, et pas 1.0 — '
  + 'à 3.40 Å (un vrai van der Waals) le terme arracherait le benzène que la planéité tient plat');
const ringSpec = {
  elements: coreRing.elements, bonds: coreRing.bonds, positions: coreRing.positions,
};
ok(contactPairsOf(ringSpec).length > 0,
  'la MARCHE voit quand même ces couples (le margin) : le terme y vaut zéro, mais il mordra s’ils se resserrent');
eq(energyOf(buildRelaxTerms(ringSpec), ringSpec.positions).contact, 0,
  '…et leur énergie est EXACTEMENT nulle : le benzène reste plan, au chiffre près');
const pentagon = (side, n = 5) => {
  const R = side / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, k) => {
    const t = (k * 2 * Math.PI) / n + Math.PI / 2;
    return [R * Math.cos(t), R * Math.sin(t), 0];
  }).flat();
};
near(distOf(pentagon(1.54), 0, 2), 2.492, 'un pentagone plan (côté 1.54) : le 1-3 à 2.492 Å', 5e-4);
near(distOf(pentagon(1.54), 0, 3), 2.492,
  '⚠ …et son 1-4 à la MÊME distance (la diagonale d’un pentagone) : encore au-dessus du cœur dur', 5e-4);
ok(distOf(pentagon(1.54), 0, 3) > contactDistanceOf('C', 'C').distance,
  '…donc un cycle à cinq reste plan lui aussi');

/* ── c) LA MARCHE — CE QU'ELLE EXCLUT, CE QU'ELLE RETIENT, SON MARGIN ───────── */
const jamTwo = { elements: ['C', 'C'], bonds: [], positions: [0, 0, 0, 1.0, 0, 0] };
eq(contactPairsOf(jamTwo).length, 1, 'deux carbones NON liés à 1.00 Å : un couple à cœur dur');
eq(contactPairsOf({ ...jamTwo, bonds: [[0, 1]] }).length, 0,
  '⚠ un couple LIÉ est exclu : sa distance est l’affaire du terme de liaison (1.54 Å est sous tout cœur dur)');
eq(contactPairsOf({
  elements: ['C', 'C', 'C'], bonds: [[0, 1], [1, 2]], positions: [0, 0, 0, 1.5, 0, 0, 1.5, 1.0, 0],
}).length, 0, '…et un couple 1-3 aussi : c’est le terme d’ANGLE qui répond de la sienne');
eq(contactPairsOf({
  elements: ['C', 'C', 'C', 'C'], bonds: [[0, 1], [1, 2], [2, 3]],
  positions: [0, 0, 0, 1.5, 0, 0, 1.5, 1.0, 0, 0, 1.0, 0],
}).map((t) => `${t.i}-${t.j}`).includes('0-3'), true,
  '⚠ un couple 1-4 EST regardé : à quatre atomes, le graphe ne dit plus rien de leur distance');
const atGap = (g) => ({
  elements: ['C', 'C'], bonds: [], positions: [0, 0, 0, contactDistanceOf('C', 'C').distance + g, 0, 0],
});
eq(contactPairsOf(atGap(1.19)).length, 1, 'un couple juste DANS le margin (d₀ + 1.19 Å) est dans la liste');
eq(contactPairsOf(atGap(1.21)).length, 0, '…et au-delà du margin (1.2 Å) il n’y est plus');
eq(energyOf(buildRelaxTerms(atGap(0.5)), atGap(0.5).positions).contact, 0,
  '⚠ au-dessus de son cœur dur son énergie est EXACTEMENT zéro : un PLANCHER, pas un van der Waals '
  + '(la cible ne préfère pas deux atomes écartés, elle refuse seulement qu’ils se traversent)');

/* ── d) LE TERME — SA VALEUR, SA BORNE, SON GRADIENT MESURÉ ─────────────────── */
const jamTerms = buildRelaxTerms(jamTwo);
const jamEnergy = energyOf(jamTerms, jamTwo.positions);
near(jamEnergy.contact, RELAX_CONTACT_WEIGHT * 1.04 * 1.04,
  'l’énergie du cœur dur est EXACTEMENT w·(d₀ − d)² = 30 · 1.04² = 32.448', 1e-9);
near(jamEnergy.contact, 32.448, '…le chiffre, écrit', 1e-3);
near(jamEnergy.total, jamEnergy.bond + jamEnergy.angle + jamEnergy.planar + jamEnergy.pair
  + jamEnergy.tether + jamEnergy.contact, '…et il entre dans le total comme les autres familles', 1e-12);
near(jamEnergy.worstContact.overlap, 1.04, 'le rapport nomme le couple et son recouvrement', 1e-12);
near(jamEnergy.contactRms, 1.04, '…et le recouvrement rms avec lui', 1e-12);
const jamHess = new Float64Array(6);
energyOf(jamTerms, jamTwo.positions, { hess: jamHess });
near(jamHess[0], 2 * RELAX_CONTACT_WEIGHT,
  'la diagonale de Gauss-Newton d’un couple couché sur x vaut 2w = 60', 1e-9);
ok(jamHess.every((v) => v >= 0), '…et elle est positive partout (le préconditionneur ne recule jamais)');

/* le gradient ANALYTIQUE, par différences finies — sur TROIS atomes empilés, pour que
   la dérivée ne soit pas seulement le long d’un axe */
const jamTrio = {
  elements: ['C', 'C', 'C'], bonds: [], positions: [0, 0, 0, 1.0, 0.3, 0.2, 0.4, 0.5, 0.9],
};
const trioTerms = buildRelaxTerms(jamTrio);
const trioGrad = new Float64Array(9);
energyOf(trioTerms, jamTrio.positions, { grad: trioGrad });
eq(trioTerms.contacts.length, 3, 'trois carbones empilés : leurs TROIS couples sont sous le cœur dur');
let worstContactGrad = 0;
for (let k = 0; k < jamTrio.positions.length; k += 1) {
  const up = jamTrio.positions.slice(); up[k] += h;
  const dn = jamTrio.positions.slice(); dn[k] -= h;
  const numeric = (energyOf(trioTerms, up).total - energyOf(trioTerms, dn).total) / (2 * h);
  worstContactGrad = Math.max(worstContactGrad, Math.abs(numeric - trioGrad[k]));
}
ok(worstContactGrad < 1e-5,
  `⚠ le gradient ANALYTIQUE du cœur dur est le vrai gradient : le pire écart aux différences finies est ${worstContactGrad.toExponential(2)}`);
/* LA BORNE — deux atomes au MÊME endroit coûtent w·d₀², jamais l’infini (là où le 1/d¹²
   d’un vrai van der Waals enverrait la descente au ciel) */
const samePlace = { elements: ['C', 'C'], bonds: [], positions: [0, 0, 0, 0, 0, 0] };
const sameTerms = buildRelaxTerms(samePlace);
near(energyOf(sameTerms, samePlace.positions).contact,
  RELAX_CONTACT_WEIGHT * contactDistanceOf('C', 'C').distance ** 2,
  '⚠ deux atomes CONFONDUS coûtent w·d₀² = 124.848 : l’énergie est BORNÉE', 1e-6);
/* LE COUP DE POUCE — sans lui un couple confondu n’a AUCUNE direction à suivre (le
   gradient du terme est nul en 0) : `unstickContacts` lui en donne une, déterministe. */
const nudged = samePlace.positions.slice();
eq(unstickContacts(sameTerms, nudged), 1, 'un couple confondu reçoit son coup de pouce');
eq(nudged.slice(3), [CONTACT_UNSTICK_STEP, 0, 0],
  '…d’un pas FIXE le long d’une direction déterministe (ici (1, 0, 0) : l’atome est seul)');
near(distOf(nudged, 0, 1), CONTACT_UNSTICK_STEP, '…le couple a donc une distance, donc une direction', 1e-12);
const nudgedAgain = samePlace.positions.slice();
unstickContacts(sameTerms, nudgedAgain);
eq(nudgedAgain, nudged, '⚠ deux appels donnent le MÊME coup de pouce (aucun tirage)');
eq(unstickContacts(sameTerms, samePlace.positions.slice(), { movable: [] }), 0,
  '…et sans atome mobile, aucun coup de pouce (une constante ne se corrige pas)');

/* ── e) LA DESCENTE, EXÉCUTÉE — DEUX ATOMES EMPILÉS S’ÉCARTENT ─────────────── */
const runJam = relaxGeometry({ ...jamTwo, steps: 400 });
near(distOf(runJam.positions, 0, 1), 2.0314,
  '⚠ LA DESCENTE SEULE écarte deux atomes empilés (1.00 → 2.03 Å) sans qu’aucune distance lui soit demandée : '
  + 'le cœur dur EST un terme de la fonction cible', 5e-3);
eq(runJam.contacts.count, 0, '…et le rapport dit qu’il n’en reste aucun');
ok(runJam.after.contact < 5e-3,
  `…l’énergie du cœur dur retombe à ${runJam.after.contact.toExponential(1)} (le couple s’arrête 0.009 Å `
  + 'DANS son cœur dur : sous la tolérance de 0.05 Å, donc plus compté comme trop court)');
eq(runJam.reason, 'converged', '…la descente a convergé');
const runSame = relaxGeometry({ ...samePlace, steps: 400 });
eq(runSame.unstuckContacts, 1, '⚠ deux atomes CONFONDUS : le rapport dit le coup de pouce du départ');
near(distOf(runSame.positions, 0, 1), 2.0235,
  '…et la descente les écarte complètement (0.00 → 2.02 Å)', 5e-3);
eq(runSame.contacts.count, 0, '…sans qu’il reste un couple sous son cœur dur');
/* UNE DEMANDE NE TRAVERSE PAS UN ATOME : les deux termes ont leur mot à dire, et le
   rapport dit l’équilibre RÉELLEMENT obtenu au lieu de franchir un atome */
const ask1 = relaxGeometry({
  elements: ['C', 'C'], bonds: [], positions: [0, 0, 0, 2.5, 0, 0],
  pairs: [{ i: 0, j: 1, target: 1.5 }], steps: 400,
});
eq(ask1.pairs[0].reached, false,
  '⚠ demander 1.50 Å entre deux carbones NON liés n’est PAS atteint : on ne traverse pas un atome');
near(distOf(ask1.positions, 0, 1), 1.7288,
  '…la descente s’arrête à l’équilibre des deux termes (1.73 Å, entre le 1.50 demandé et le 2.04 du cœur dur)', 3e-3);
eq(ask1.contacts.count, 1, '…et le rapport DIT que le couple est resté dans son cœur dur');
ok(ask1.after.contact > 0, '…avec l’énergie du cœur dur qui a tenu tête à la demande');
const ask2 = relaxGeometry({
  elements: ['C', 'C'], bonds: [], positions: [0, 0, 0, 1.2, 0, 0],
  pairs: [{ i: 0, j: 1, target: contactDistanceOf('C', 'C').distance }], steps: 400,
});
eq(ask2.pairs[0].reached, true, '…tandis que la DISTANCE DE CONTACT, elle, est atteinte');
near(distOf(ask2.positions, 0, 1), 2.0371, '…à 0.003 Å près', 4e-3);
eq(ask2.contacts.count, 0, '…et le couple n’est plus compté comme trop court (0.05 Å de tolérance)');

/* ── f) LE BALAYAGE DES CONTACTS TROP COURTS, LUI-MÊME ─────────────────────── */
const crowd4 = [0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.6];
const crowdSpec = { positions: crowd4, bonds: [], elements: new Array(4).fill('C') };
const badCrowd = badContactsOf(crowdSpec);
eq(badCrowd.count, 6, 'un paquet de quatre carbones : les SIX couples sont trop courts');
near(badCrowd.worst.overlap, 2.04 - 0.5, '…le pire est nommé, avec son recouvrement (1.54 Å)', 1e-9);
ok(badCrowd.contacts.every((c, i) => i === 0 || badCrowd.contacts[i - 1].overlap >= c.overlap),
  '⚠ le classement est par recouvrement DÉCROISSANT : le plus empilé d’abord');
near(badCrowd.severity, badCrowd.contacts.reduce((s, c) => s + c.overlap * c.overlap, 0),
  '…et `severity` est la somme des recouvrements AU CARRÉ : exactement ce que le terme ajoute à la fonction cible, par unité de poids', 1e-9);
near(badCrowd.severity, 11.7634, '…le chiffre, écrit', 1e-3);
eq(badCrowd.contacts.length, badCrowd.count, 'tous les couples trop courts sont rendus, pas seulement le pire');
eq(badContactsOf({ positions: [0, 0, 0, 2.0, 0, 0], bonds: [], elements: ['C', 'C'] }).count, 0,
  '⚠ un recouvrement PLUS PETIT que la tolérance (0.04 Å) n’est pas signalé : un contact que le protocole vient '
  + 'de conduire n’est jamais relu comme trop court, donc la boucle DESCEND au lieu d’osciller');
eq(badContactsOf({ positions: [0, 0, 0, 1.9, 0, 0], bonds: [], elements: ['C', 'C'] }).count, 1,
  '…à 0.14 Å de recouvrement, il l’est');
eq(badContactsOf({ ...crowdSpec, movable: [] }).count, 0,
  '⚠ deux atomes FIGÉS ne comptent pas : une constante ne se corrige pas (même règle que `clashReportOf`)');
eq(badContactsOf({
  positions: [0, 0, 0, 0.5, 0, 0], bonds: [], elements: ['C', 'ZN'],
}).unknownElements, 1, 'un élément absent de la table de Bondi est COMPTÉ (le rayon de repli ne se tait pas)');
eq(badContactsOf({ positions: null }), null, 'sans coordonnées, aucun balayage — et jamais une exception');
eq(badContactsOf({ positions: [0, 0, 0, 5, 0, 0], bonds: [], elements: ['C', 'C'] }).count, 0,
  '…et deux atomes loin l’un de l’autre ne sont pas un contact');
eq(badContactsOf({ positions: [0, 0, 0, 5, 0, 0], bonds: [], elements: ['C', 'C'] }).worst, null,
  '…`worst` reste vide alors (aucun couple nommé à tort)');

/* ── g) LE CONSTRUIT AUTOMATIQUE DÉSEMPILE ──────────────────────────────────── */
const jammedSpec = {
  elements: ['C', 'C', 'C', 'C', 'C'],
  bonds: [[0, 1], [1, 2]],
  positions: [0, 0, 0, 1.54, 0, 0, 2.4, 1.2, 0, 8, 0, 0, 8.9, 0, 0],
};
const autoJam = buildModelGeometry({ ...jammedSpec, radius: 4 });
eq(autoJam.found, 0, '⚠ la chaîne est aux longueurs de la table : aucune longueur fausse à conduire');
eq(autoJam.foundContacts, 1, '…mais le second balayage trouve UN couple empilé (0.90 Å pour un cœur dur de 2.04)');
eq(autoJam.contactsDriven.length, 1, '…et il le CONDUIT, avec le protocole de §8 tel quel');
eq(autoJam.converged, true, '⚠ le construit converge : la molécule est désempilée');
near(distOf(autoJam.positions, 3, 4), 2.036,
  '…les deux carbones sont écartés à leur distance de contact', 5e-3);
eq(badContactsOf({ ...jammedSpec, positions: autoJam.positions }).count, 0,
  '…et il ne reste aucun contact trop court — RELU sur les coordonnées rendues, pas supposé');
eq(autoJam.moved.length, 2, '…deux atomes ont bougé, ni plus ni moins');
near(distOf(autoJam.positions, 0, 1), 1.54, 'les longueurs de la chaîne, elles, n’ont pas bougé', 1e-9);
eq(autoJam.leftContacts.length, 0, 'ce qui RESTE empilé sort du dernier balayage (`leftContacts`)');
eq(autoJam.leftContactSeverity, 0, '…et son recouvrement total est nul');
eq(autoJam.contactTolerance, RELAX_CONTACT_TOLERANCE, '…le seuil employé est dit dans le rapport');
eq(autoJam.contactsDriven[0].cleared, true, '…et le couple conduit est annoncé comme dégagé');
/* LES LONGUEURS D’ABORD, LES CONTACTS ENSUITE — « la chimie avant le rangement » */
const bothSpec = {
  elements: ['C', 'C', 'C', 'C', 'C'],
  bonds: [[0, 1], [1, 2]],
  positions: [0, 0, 0, 3.0, 0, 0, 3.86, 1.2, 0, 9, 0, 0, 9.9, 0, 0],
};
const autoBoth = buildModelGeometry({ ...bothSpec, radius: 4 });
eq([...autoBoth.distances.map((d) => `b${d.i}-${d.j}`),
  ...autoBoth.contactsDriven.map((c) => `c${c.i}-${c.j}`)],
  ['b0-1', 'c3-4'],
  '⚠ LES LONGUEURS D’ABORD, LES CONTACTS ENSUITE : la chimie passe avant le rangement');
near(distOf(autoBoth.positions, 0, 1), 1.5422, '…la liaison étirée (3.00 Å) est revenue', 2e-3);
near(distOf(autoBoth.positions, 3, 4), 2.036, '…et les deux atomes empilés sont écartés', 5e-3);
eq(autoBoth.converged, true, '…le balayage suivant ne trouve plus rien, ni longueur ni contact');
eq(autoBoth.passCount, 1, '…un seul balayage a suffi');
ok(autoBoth.after.contact < 1e-3, '…et l’énergie du cœur dur du modèle rendu est retombée à zéro');
const cleanAuto = buildModelGeometry({
  positions: [0, 0, 0, 1.54, 0, 0], elements: ['C', 'C'], bonds: [[0, 1]],
});
eq(cleanAuto.found + cleanAuto.foundContacts, 0, 'une molécule propre : rien à trouver');
eq(cleanAuto.reason, 'clean', '…et la raison le dit (`clean`)');
eq(cleanAuto.moved.length, 0, '…aucun atome ne bouge');

/* ── h) LE BRANCHEMENT DU VIEWER ────────────────────────────────────────────── */
has(VIEW, 'badContactsOf, contactDistanceOf, RELAX_CONTACT_SCALE, RELAX_CONTACT_TOLERANCE,',
  'le viewer importe la marche, la cible et la tolérance du cœur dur');
has(VIEW, 'const relaxContactReading = (structure) => {',
  '…et il relit la molécule à l’écran avec la MÊME marche (aucune seconde table)');
has(VIEW, 'inside their hard core right now',
  '⚠ le panneau MONTRE les couples empilés avant tout geste — la demande : on les voit');
has(VIEW, 'the ⚒ button with NO atom picked un-jams them',
  '…et il dit quel bouton les écarte (le ⚒ sans atome piqué)');
has(VIEW, 'no atom pair inside its hard core',
  '…tandis que la molécule propre est annoncée propre');
has(VIEW, 'inside their HARD CORE',
  'le rapport du ⚒ à deux atomes nomme le couple qui reste empilé');
has(VIEW, 'inside their hard core at the first scan',
  '…et celui du construit automatique dit combien il en a trouvés, conduits, et ce qui reste');
has(VIEW, 'It ALSO un-jams the molecule', '…en nommant le second travail du bouton');
has(VIEW, 'contacts: the scan was capped', '…avec le plafond des contacts DIT, comme celui des longueurs');
has(VIEW, 'the ⛔ line above tells you how many pairs of the molecule on screen are inside theirs RIGHT NOW',
  'la note du panneau explique la ligne ⛔ et ce que le ⚒ en fait');
has(VIEW, 'ONE HARD CORE, and it IS in the target function',
  '⚠ l’infobulle du bouton dit que le cœur dur EST dans la fonction cible');
has(VIEW, 'at the SAME place',
  '…et le rapport dit les atomes CONFONDUS que la descente a dû écarter d’un coup de pouce');
has(MODULE, 'export const unstickContacts = (terms, x,',
  'le coup de pouce des contacts confondus vit dans le module, pas dans le panneau');
has(MODULE, 'if (contactWalk(x)) rescore();',
  '⚠ …et le module REBALAYE le cœur dur pendant la descente (sinon un repli crée des empilements invisibles)');

console.log(`_geometry_relax_test.mjs — ${passed} assertions OK (les tables de la chimie, l'hybridation, les`
  + ' cycles et la PLANÉITÉ tenue, le gradient mesuré par différences finies (les cycles compris),'
  + ' la descente exécutée pas à pas, le PAS À PAS du rapprochement et ses reprises, la fenêtre,'
  + ' le REBÂTIMENT de la partie hors fenêtre (la molécule se resserre au lieu de s’étirer),'
  + ' les 🎲 ÉCHAPPÉES (la botte de torsion, les contacts trop courts, le meilleur modèle gardé),'
  + ' le PAS VU DE L’EXTÉRIEUR (onStep), le CONSTRUIT AUTOMATIQUE (les longueurs fausses trouvées'
  + ' tout seul, conduites une après l’autre, le second balayage quand le premier en a créé'
  + ' d’autres, et ce qui reste mesuré), le CŒUR DUR (Bondi, le terme, son gradient mesuré,'
  + ' le rebalayage pendant la descente, et le construit automatique qui désempile la molécule),'
  + ' et un vrai PDB étiré reconstruit puis relu par NGL)');

