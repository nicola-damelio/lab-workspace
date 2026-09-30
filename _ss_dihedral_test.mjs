/* =========================================================================
   _ss_dihedral_test.mjs — LA STRUCTURE SECONDAIRE IMPOSÉE → DES CONTRAINTES DE
   DIHÈDRE (φ et ψ).

   La demande, mot pour mot : « In MD and “structure calculation” allow the
   conversion of the secondary structure imposed in the “sequence and structure”
   subsection into dihedral angle constraints. »

   Ce qui doit rester vrai :

     • LA TABLE DES LETTRES — H (hélice α) donne φ −57° / ψ −47°, E (feuillet β)
       donne φ −139° / ψ +135°, et C/S n'imposent RIEN (une pelote est le silence) ;
     • LE CHAMP DE FORCES A UNE FAMILLE DE PLUS — `ffDihedralCostOf` est le puits
       plat des distances transposé aux degrés (zéro dans la fenêtre, k·(écart −
       tolérance)² au-delà, l'écart étant le plus court sur le cercle), sa ligne est
       écrite par le module (`ffKcalRowsOf`), et `ffKcalEnergyOf` la SOMME dans
       `enthalpy` comme les autres ;
     • LA CONVERSION APPARIE PAR ORDRE — la k-ième lettre pour le k-ième résidu lu
       (CA croissants), φ et ψ SÉPARÉMENT, un bout de chaîne ne portant que l'angle
       qu'il a ; une longueur qui ne correspond pas est DITE, jamais devinée ;
     • LES MOTEURS LA RESPECTENT — exécuté : une chaîne construite au chiffre près
       avec les φ/ψ d'un feuillet, convertie en 'HHHHHH', est RAMENÉE dans les
       fenêtres de l'hélice par la minimisation dihédrale, et sa pénalité tombe ;
     • LE PANNEAU LA BRANCHE — la même liste part au ▶ MD, au ⚒ Minimise, au ▶ Run
       et à la lecture du champ, et les trois pages l'alimentent (`imposedSecondaryStructure`).

   Run: node _ss_dihedral_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dihedralDeg } from './src/utils/torsionDrive.js';
import {
  backboneTorsionsOf, secondaryDihedralRestraintsOf, dihedralPenaltyOf,
  SS_DIHEDRALS, SS_DIHEDRAL_LETTERS, SS_DIHEDRAL_TOLERANCE,
  forceFieldEnergyOf, forceFieldRowsOf, scoreStructureOf,
  mdFrames, minimizeTorsionsOf, minimizeFrames,
  STRUCTURE_CALC_SEED,
} from './src/utils/structureCalc.js';
import {
  FF_DIHEDRAL_K, FF_DIHEDRAL_TOLERANCE, ffDihedralCostOf, FORCE_FIELD_KCAL_FAMILIES, ffKcalEnergyOf,
} from './src/utils/forceFieldKcal.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/* ── LA CHAÎNE DE SONDE — UN PEPTIDE CONSTRUIT AU CHIFFRE PRÈS ────────────────
   `placeWith` RÈGLE le dièdre mesuré par `dihedralDeg` (la même béquille que
   _structure_calculation_test.mjs) : N · CA · C · O par résidu, les longueurs et les
   angles du dossier, et les φ/ψ qu'on lui demande. C'est ce squelette que
   `backboneTorsionsOf` relit — donc les contraintes de dihèdre portent sur des φ/ψ
   VRAIS, pas sur une géométrie inventée. */
const DEG = Math.PI / 180;
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const placeWith = ({ a, b, c, length, angleDeg, dihDeg }) => {
  const bc = unit3(sub3(c, b));
  const n = unit3(cross3(sub3(b, a), bc));
  const m = cross3(bc, n);
  const th = angleDeg * DEG; const ph = dihDeg * DEG;
  const v = [-length * Math.cos(th), length * Math.sin(th) * Math.cos(ph), length * Math.sin(th) * Math.sin(ph)];
  const p = [0, 1, 2].map((k) => c[k] + v[0] * bc[k] + v[1] * m[k] + v[2] * n[k]);
  let delta = dihDeg - dihedralDeg(a, b, c, p);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  const r = delta * DEG; const cs = Math.cos(r); const sn = Math.sin(r);
  const w = sub3(p, c);
  const d = bc[0] * w[0] + bc[1] * w[1] + bc[2] * w[2];
  const rot = [
    w[0] * cs + (bc[1] * w[2] - bc[2] * w[1]) * sn + bc[0] * d * (1 - cs),
    w[1] * cs + (bc[2] * w[0] - bc[0] * w[2]) * sn + bc[1] * d * (1 - cs),
    w[2] * cs + (bc[0] * w[1] - bc[1] * w[0]) * sn + bc[2] * d * (1 - cs),
  ];
  return [0, 1, 2].map((k) => c[k] + rot[k]);
};

/** UN PEPTIDE DE `n` RÉSIDUS, aux φ/ψ demandés (deux tableaux, un par résidu). */
const peptideOf = (n, { phi = -139, psi = 135 } = {}) => {
  const phis = Array.from({ length: n }, (_, k) => (Array.isArray(phi) ? phi[k] : phi));
  const psis = Array.from({ length: n }, (_, k) => (Array.isArray(psi) ? psi[k] : psi));
  const els = []; const pts = []; const bonds = [];
  const push = (el, p) => { els.push(el); pts.push(p); return pts.length - 1; };
  const N = [0, 0, 0];
  const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos((180 - 111) * DEG), 1.52 * Math.sin((180 - 111) * DEG), 0];
  const iN = push('N', N); const iCA = push('C', CA); const iC = push('C', C);
  const iO = push('O', placeWith({ a: N, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: psis[0] + 180 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iO, order: 2 });
  for (let k = 1; k < n; k += 1) {
    const nPrev = pts[iN + (k - 1) * 4]; const caPrev = pts[iCA + (k - 1) * 4]; const cPrev = pts[iC + (k - 1) * 4];
    const nk = placeWith({ a: nPrev, b: caPrev, c: cPrev, length: 1.33, angleDeg: 116, dihDeg: psis[k - 1] });
    const iNk = push('N', nk);
    const cak = placeWith({ a: caPrev, b: cPrev, c: nk, length: 1.46, angleDeg: 122, dihDeg: 180 });
    const iCAk = push('C', cak);
    const ck = placeWith({ a: cPrev, b: nk, c: cak, length: 1.52, angleDeg: 111, dihDeg: phis[k] });
    const iCk = push('C', ck);
    const ok2 = placeWith({ a: nk, b: cak, c: ck, length: 1.23, angleDeg: 120.5, dihDeg: psis[k] + 180 });
    const iOk = push('O', ok2);
    bonds.push({ i: iC + (k - 1) * 4, j: iNk, order: 1 }, { i: iNk, j: iCAk, order: 1 },
      { i: iCAk, j: iCk, order: 1 }, { i: iCk, j: iOk, order: 2 });
  }
  return { count: els.length, elements: els, bonds, positions: pts.flat(), phis, psis };
};
const spine = peptideOf(6, { phi: -139, psi: 135 });
const backbone = backboneTorsionsOf({ elements: spine.elements, bonds: spine.bonds, atomCount: spine.count });
/* ════════════ 1. LES LETTRES, ET LA FENÊTRE ═════════════════════════════════ */
eq(SS_DIHEDRAL_LETTERS.sort(), ['E', 'H', 'L'],
  'les TROIS lettres qui IMPOSENT quelque chose sont H, L et E — les deux MAINS de l’hélice α et le feuillet');
eq(SS_DIHEDRALS.H, { phi: -57, psi: -47 }, 'l’hélice α : φ −57° / ψ −47° (Pauling–Corey)');
eq(SS_DIHEDRALS.E, { phi: -139, psi: 135 }, 'le feuillet β : φ −139° / ψ +135°');
eq(SS_DIHEDRALS.L, { phi: 57, psi: 47 },
  '⚠ l’hélice α GAUCHE : le MIROIR exact de H (φ +57° / ψ +47°) — la demande : « il bottone alfa elica'
  + ' impone una struttura elicacea left-handed. aggiungi anche la right-handed. » Les deux mains sont peignables');
eq(SS_DIHEDRAL_LETTERS.includes('C'), false, '⚠ C (pelote) N’IMPOSE RIEN : une pelote est le silence');
eq(SS_DIHEDRAL_TOLERANCE, FF_DIHEDRAL_TOLERANCE,
  '⚠ la fenêtre est CELLE DU CHAMP : un seul chiffre dans tout le dossier');
eq(FF_DIHEDRAL_K, 0.02, '…et son poids est celui du champ (kcal·mol⁻¹·deg⁻²)');

/* ════════════ 2. LE PUITS PLAT, EN DEGRÉS ═══════════════════════════════════ */
near(ffDihedralCostOf(-57, { target: -57 }), 0, 'un angle PILE sur sa cible ne coûte rien');
near(ffDihedralCostOf(-57 + FF_DIHEDRAL_TOLERANCE, { target: -57 }), 0,
  '…ni au bord de la fenêtre (le plateau va jusqu’à ± la tolérance, compris)');
near(ffDihedralCostOf(-57 + FF_DIHEDRAL_TOLERANCE + 10, { target: -57 }),
  FF_DIHEDRAL_K * 10 * 10, '⚠ …et AU-DELÀ, c’est k·(écart − tolérance)², exactement');
near(ffDihedralCostOf(-57 + FF_DIHEDRAL_TOLERANCE + 30, { target: -57 }),
  FF_DIHEDRAL_K * 900, '…un écart de trente degrés de plus (≈ 18 kcal/mol)');
near(ffDihedralCostOf(303, { target: -57 }), 0,
  '⚠ L’ÉCART EST LE PLUS COURT SUR LE CERCLE : +303° est à −57° (zéro, pas 360°)');
near(ffDihedralCostOf(-57 - FF_DIHEDRAL_TOLERANCE - 5, { target: -57 }),
  FF_DIHEDRAL_K * 25, '…et de l’autre côté de la cible, la même forme');
near(ffDihedralCostOf(0, { target: 0, tolerance: 0 }), 0, 'une fenêtre nulle reste nulle pile sur la cible');
near(ffDihedralCostOf(5, { target: 0, tolerance: 0, k: 1 }), 25,
  '…et devient le puit carré ordinaire (k·écart²) dès qu’on la resserre');
eq(ffDihedralCostOf(NaN, { target: -57 }), 0, 'un angle illisible ne coûte rien (il n’est pas inventé)');

/* ════════════ 3. LA FAMILLE DU CHAMP — SOMMÉE COMME LES AUTRES ══════════════ */
ok(FORCE_FIELD_KCAL_FAMILIES.includes('dihedral'),
  'le champ de forces a UNE FAMILLE DE PLUS : « dihedral »');
const rows = forceFieldRowsOf();
const row = rows.find((r) => r.id === 'dihedral');
ok(!!row, '…et sa ligne est écrite par le module (`ffKcalRowsOf`)');
eq(row.k, FF_DIHEDRAL_K, 'la ligne porte le POIDS du module (aucun chiffre recopié dans le JSX)');
eq(row.unit, 'kcal·mol⁻¹·deg⁻²', '…et son unité');
has(row.rule, 'FLAT-BOTTOM window', '…et la règle du puits plat');
has(row.rule, `± ${FF_DIHEDRAL_TOLERANCE}°`, '…avec LA fenêtre, chiffrée par le module');
has(row.rule, 'H: φ −57°, ψ −47°', '…et les deux recettes de la peinture');
has(row.of, 'imposed secondary structure', 'elle dit d’où viennent ces contraintes');
eq(rows.length, FORCE_FIELD_KCAL_FAMILIES.length, 'une ligne par famille, ni plus ni moins');
/* ════════════ 4. LA CONVERSION — APPARIÉE PAR ORDRE ═════════════════════════ */
const conv = secondaryDihedralRestraintsOf({ secondaryStructure: 'HHHHHH', torsions: backbone });
eq(conv.ok, true, 'une séquence peinte tout en hélice se convertit');
eq(conv.letters, 6, 'six lettres peintes');
eq(conv.residues, 6, '…et six résidus lisibles sur la molécule (par leurs CA)');
eq(conv.matched, 6, 'les six sont appariés par ORDRE');
eq(conv.unmatched, 0, '…et aucun ne reste sans lettre');
eq(conv.reason, 'ok', 'la raison est celle du succès');
eq(conv.constraints.length, 10,
  '⚠ DIX contraintes pour six résidus : les deux bouts de chaîne n’ont qu’UN angle (φ pour le dernier, ψ pour le premier)');
eq(conv.constraints.filter((c) => c.kind === 'phi').length, 5, 'cinq φ (le premier résidu n’en a pas)');
eq(conv.constraints.filter((c) => c.kind === 'psi').length, 5, 'cinq ψ (le dernier résidu n’en a pas)');
eq(conv.constraints.filter((c) => c.letter === 'H').length, 10, 'chaque contrainte garde SA lettre');
eq(conv.constraints.filter((c) => c.target === -57).length, 5, '…et les φ visent −57°');
eq(conv.constraints.filter((c) => c.target === -47).length, 5, '…et les ψ visent −47°');
eq(conv.constraints.every((c) => c.atoms.length === 4), true, '⚠ chaque contrainte porte QUATRE atomes (un vrai dièdre)');
eq(conv.constraints.every((c) => c.tolerance === FF_DIHEDRAL_TOLERANCE), true,
  '…et la fenêtre du champ, telle quelle');
const cas = conv.constraints.map((c) => c.ca);
eq(cas.every((v, k) => k === 0 || v >= cas[k - 1]), true,
  '⚠ les CA SORTENT DANS L’ORDRE CROISSANT (chaque résidu porte SES deux angles, côte à côte)');
/* UNE PELOTE N'IMPOSE RIEN — et un mélange suit les lettres, une par une. */
const mixed = secondaryDihedralRestraintsOf({ secondaryStructure: 'HHCCEE', torsions: backbone });
eq(mixed.matched, 4, 'un motif HHC CEE n’apparie que les quatre résidus qui imposent quelque chose');
eq(mixed.unmatched, 2, '⚠ …et les deux pelotes du milieu sont COMPTÉES non appariées, jamais devinées');
eq(mixed.constraints.length, 6,
  '…soit SIX contraintes : le résidu 1 (H, début de chaîne) n’a que son ψ, le résidu 6 (E, fin) que son φ');
eq(mixed.constraints.filter((c) => c.letter === 'E').every((c) => c.target === -139 || c.target === 135), true,
  'les E visent φ −139° / ψ +135°');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'CCCCCC', torsions: backbone }).ok, false,
  '❌ une séquence de pelote ne produit RIEN (et le dit)');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'CCCCCC', torsions: backbone }).reason,
  'no-letter-imposes', '…avec sa raison propre');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'HHHHHH', torsions: null }).reason, 'no-backbone',
  '❌ une molécule sans squelette lisible est refusée (aucune lettre ne s’attache à rien)');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: '', torsions: backbone }).reason, 'no-structure',
  '❌ et sans aucune lettre peinte, il n’y a rien à convertir');
const short = secondaryDihedralRestraintsOf({ secondaryStructure: 'HHH', torsions: backbone });
eq(short.reason, 'length-mismatch', '⚠ TROIS lettres pour SIX résidus : la longueur ne correspond pas');
eq(short.constraints.length, 5, '…et les trois premières lettres sont converties quand même (le reste reste libre)');
eq(short.unmatched, 3, '…les trois résidus sans lettre sont comptés');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'h h\nh h h h', torsions: backbone }).constraints.length, 10,
  '⚠ les minuscules et les espaces sont normalisés (la peinture est ce qu’elle est)');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'HHHHHH', torsions: backbone, tolerance: 5 })
  .constraints.every((c) => c.tolerance === 5), true,
  'la fenêtre peut être resserrée par l’appelant (le défaut du champ reste la règle)');

/* ════════════ 5. LA LECTURE, SUR LES COORDONNÉES ════════════════════════════ */
const sheetNow = dihedralPenaltyOf({ positions: spine.positions, dihedrals: conv.constraints });
eq(sheetNow.count, 10, 'la lecture voit les dix contraintes');
eq(sheetNow.satisfied, 0, '⚠ la chaîne est un FEUILLET : aucune de ses φ/ψ n’est dans la fenêtre de l’hélice');
const manual = sheetNow.list
  .reduce((s, l) => s + ffDihedralCostOf(l.deg, { target: l.target, tolerance: l.tolerance }), 0);
near(sheetNow.penalty, manual,
  '…et la pénalité est la SOMME des dix, terme par terme (aucun chiffre avalé)', 1e-6);
ok(sheetNow.penalty > 0, '⚠ une chaîne de feuillet soumise à une hélice coûte quelque chose, et c’est dit');
ok(sheetNow.worst.over > 0, 'le rapport dit de combien le PIRE sort de sa fenêtre');
eq(typeof sheetNow.worst.kind, 'string', '…en nommant l’angle (φ ou ψ)');
const fieldSheet = forceFieldEnergyOf({
  positions: spine.positions, elements: spine.elements, bonds: spine.bonds, dihedrals: conv.constraints,
});
near(fieldSheet.dihedral, sheetNow.penalty,
  '⚠ LA LECTURE DU MODULE ET LA FAMILLE DU CHAMP DONNENT LE MÊME CHIFFRE (deux façons de lire, une seule physique)', 1e-6);
near(fieldSheet.dihedralReport.penalty, sheetNow.penalty, '…et le rapport de la famille aussi', 1e-6);
eq(fieldSheet.dihedralReport.count, 10, '…avec le même compte de contraintes');
eq(fieldSheet.dihedralReport.violations, 10, '…et les mêmes hors fenêtre');
eq(fieldSheet.dihedralReport.worst.letter, 'H', 'la pire contrainte garde sa lettre (le panneau peut la nommer)');
/* ════════════ 6. EXÉCUTÉ — LA MINIMISATION RAMÈNE LA CHAÎNE DANS LES FENÊTRES ═
   La chaîne de sonde est un feuillet (φ −139° / ψ +135°) ; on lui impose les six
   lettres H, et on laisse la DESCENTE DU MODULE faire son travail. Ce qui est mesuré :
   la pénalité des φ/ψ imposés, avant et après, et le fait que la descente SANS les
   contraintes ne fait pas le même chemin (sinon le test ne prouverait rien). */
const minWith = minimizeTorsionsOf({
  positions: spine.positions, elements: spine.elements, bonds: spine.bonds,
  dihedrals: conv.constraints, rounds: 6, seed: STRUCTURE_CALC_SEED,
});
eq(minWith.ok, true, 'la minimisation dihédrale tourne avec des contraintes de dihèdre');
const afterWith = dihedralPenaltyOf({ positions: minWith.positions, dihedrals: conv.constraints });
ok(afterWith.penalty < sheetNow.penalty * 0.5,
  `⚠ LA PÉNALITÉ TOMBE : ${sheetNow.penalty.toFixed(1)} → ${afterWith.penalty.toFixed(1)} kcal/mol`);
ok(afterWith.satisfied > sheetNow.satisfied,
  `…et le nombre de φ/ψ DANS leur fenêtre monte (${sheetNow.satisfied} → ${afterWith.satisfied} sur 10)`);
/* LE CONTRÔLE — sans les contraintes, la même descente ne va PAS vers l'hélice (elle
   ne sait pas qu'on lui demande quelque chose) : sans ce contrôle, « la descente a
   bougé » ne dirait pas que c'est LA CONTRAINTE qui l'a fait bouger. */
const minWithout = minimizeTorsionsOf({
  positions: spine.positions, elements: spine.elements, bonds: spine.bonds,
  rounds: 6, seed: STRUCTURE_CALC_SEED,
});
const afterWithout = dihedralPenaltyOf({ positions: minWithout.positions, dihedrals: conv.constraints });
ok(afterWithout.penalty > afterWith.penalty,
  '⚠ …et SANS les contraintes, la même descente laisse une pénalité PLUS GRANDE :'
  + ` c’est bien la contrainte qui l’a amenée dans les fenêtres (${afterWithout.penalty.toFixed(1)}`
  + ` contre ${afterWith.penalty.toFixed(1)} kcal/mol)`);
/* LA MÊME CHOSE PAR LA DYNAMIQUE — le rapport rend `before.dihedral` et `after.dihedral`
   (le `readAll` du moteur porte la famille), donc le panneau chiffre le geste. */
const mdWith = mdFrames({
  positions: spine.positions, elements: spine.elements, bonds: spine.bonds,
  dihedrals: conv.constraints, steps: 120, temperature: 900, seed: STRUCTURE_CALC_SEED,
});
const mdRun = (() => { let n = mdWith.next(); while (!n.done) n = mdWith.next(); return n.value; })();
eq(mdRun.ok, true, 'la dynamique tourne avec les contraintes');
eq(mdRun.before.dihedral.count, 10, '⚠ son rapport AVANT compte les dix contraintes');
eq(mdRun.after.dihedral.count, 10, '…et son rapport APRÈS aussi');
ok(mdRun.after.dihedral.penalty < mdRun.before.dihedral.penalty,
  `…la pénalité baisse au fil de la trajectoire (${mdRun.before.dihedral.penalty.toFixed(1)}`
  + ` → ${mdRun.after.dihedral.penalty.toFixed(1)} kcal/mol)`);
/* LA NOTE — le score d'un modèle compte la famille, et le rend comme les autres. */
const scored = scoreStructureOf({
  positions: minWith.positions, elements: spine.elements, bonds: spine.bonds, dihedrals: conv.constraints,
});
eq(scored.dihedralWells.count, 10, 'la note d’un modèle porte les dix contraintes');
eq(scored.dihedralPenalty, scored.forceField.dihedral, '…et son chiffre est celui du champ, pas un second calcul');
ok(scored.forceField.enthalpy >= scored.forceField.dihedral, '…compté DANS l’enthalpie, comme les autres familles');
ok(forceFieldRowsOf().some((r) => r.id === 'dihedral'),
  '⚠ …et le panneau peut l’afficher : la famille est dans la liste du module');
/* ════════════ 7. LE PANNEAU 🧬 DU VIEWER BRANCHE LA CONVERSION ══════════════ */
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
has(VIEW, 'backboneTorsionsOf, secondaryDihedralRestraintsOf, dihedralPenaltyOf,',
  'le viewer importe la conversion ET sa lecture (pas un second lecteur de φ/ψ)');
has(VIEW, 'SS_DIHEDRALS, SS_DIHEDRAL_LETTERS, SS_DIHEDRAL_TOLERANCE,',
  '…avec les lettres et la fenêtre du module (aucun chiffre de φ/ψ recopié dans le JSX)');
has(VIEW, 'imposedSecondaryStructure = \'\',', 'la structure peinte par la page arrive par une prop');
has(VIEW, 'const [calcDihedrals, setCalcDihedrals] = useState([]);',
  '⚠ les contraintes sont un ÉTAT : la conversion ne se refait pas à chaque rendu');
has(VIEW, 'const calcConvertSecondaryStructure = () => {', 'la conversion a son handler');
has(VIEW, 'const read = secondaryDihedralRestraintsOf({\n    secondaryStructure: structure, torsions: backbone, tolerance: SS_DIHEDRAL_TOLERANCE,',
  '…elle appelle le module PUR, sur le squelette DE LA MOLÉCULE À L’ÉCRAN');
has(VIEW, 'const backbone = backboneTorsionsOf({ elements: geom.elements, bonds: geom.bonds, atomCount: geom.count });',
  '…lu une fois, par le lecteur du dossier');
has(VIEW, 'setCalcDihedrals(read.constraints);', '…et la liste du module est celle que le panneau garde');
has(VIEW, 'if (calcDihedrals.length) {', '⚠ le bouton est un INTERRUPTEUR : un second clic rend la liberté');
has(VIEW, 'read.reason === \'length-mismatch\'', '…et un appariement qui ne correspond pas est DIT, pas deviné');
has(VIEW, 'the letters are matched to the',
  '…et le refus dit que l’appariement se fait sur le squelette AFFICHÉ');
/* LES QUATRE GESTES PORTENT LA MÊME LISTE. */
has(VIEW, 'dihedrals: calcDihedrals,', '⚠ la liste part au ▶ MD, au ⚒ Minimise et au ▶ Run');
eq(VIEW.split('dihedrals: calcDihedrals,').length - 1, 4,
  '…dans les QUATRE endroits qui la portent (dynamique, minimisation, calcul, lecture du champ)');
has(VIEW, 'const dh = dihedralPenaltyOf({ positions: run.positions, dihedrals: calcDihedrals });',
  '…et les deux gestes RELISENT les φ/ψ imposés sur les coordonnées qu’ils viennent d’écrire');
eq(VIEW.split('const dh = dihedralPenaltyOf(').length - 1, 2,
  '…une fois pour la dynamique, une fois pour la minimisation (la même lecture)');
has(VIEW, '⛓ φ/ψ imposed: ${dh.satisfied}/${dh.count} within ± ${dh.tolerance}°',
  'le rapport du ▶ MD chiffre les φ/ψ dans leur fenêtre');
has(VIEW, 'a.dihedralWells && a.dihedralWells.count', 'la ligne d’un départ fini les chiffre aussi');
has(VIEW, 'const dh = field.dihedralReport;', 'la lecture ⟳ Energy les compte par la famille du champ');
has(VIEW, 'the φ/ψ you imposed ${field.dihedral.toFixed(2)}', '…et son total entre dans la somme affichée');
/* LE BOUTON VIT MAINTENANT DANS « STRUCTURE CALCULATION », ET NULLE PART AILLEURS.
   La demande : « Il pulsante “SS to phi, psi” deve andare dentro la sezione “structure
   calculation”. Quest'ultimo deve riempire la tabella di constraints. » UN seul bouton —
   celui du panneau 🧬 — et la conversion ÉCRIT la table des contraintes de φ/ψ. */
eq(VIEW.split('onClick={calcConvertSecondaryStructure}').length - 1, 1,
  '⚠ UN SEUL bouton : celui du panneau 🧬 (la rangée ▶ MD n’en porte plus : elle porte la fenêtre de la dynamique)');
has(VIEW, 'Secondary structure → φ/ψ', '…et c’est sous ce nom qu’il vit dans le panneau du calcul');
eq(VIEW.includes("'SS → φ/ψ'"), false,
  '⚠ …et le libellé « SS → φ/ψ » de la rangée ▶ MD n’existe plus (un seul bouton, dans 🧬)');
has(VIEW, '{calcDihedrals.map((c, k) => (', '⚠ il REMPLIT la table des contraintes : une ligne par φ et par ψ');
eq(VIEW.split('setCalcDihedrals((list) => list.filter((x) => x !== c))').length - 1, 1,
  '…dont chaque ligne se retire seule, par un geste écrit UNE fois (φ et ψ sont jugés séparément)');
has(VIEW, 'const [mdDock, setMdDock] = useState(false);',
  '⚠ …et la FENÊTRE MD de la demande existe : « Il pulsante MD deve aprire una finestra collapsable a sinistra' +
  ' all’interno del viewer »');
has(VIEW, 'const renderMdOptions = () => (', '…ses paramètres sont écrits une fois');
has(VIEW, 'const renderMdWindow = () => (', '…et elle-même suit le dock 🪢 (⇤, onglet vertical, même rangée)');
has(VIEW, 'each φ and ψ is judged on its own', 'l’infobulle explique que φ et ψ sont jugés séparément');
has(VIEW, 'a coil imposes nothing', '…et qu’une pelote n’impose rien');
/* LES TROIS PAGES ALIMENTENT LA PROP. */
const NMR = read('./src/components/NMRSections.jsx');
const MDS = read('./src/components/MDSections.jsx');
const DOCK = read('./src/components/DockingSections.jsx');
has(NMR, "imposedSecondaryStructure={univTestMode ? '' : (activeTest.secondaryStructure || '')}",
  'la page NMR passe la structure peinte (et rien en mode « universal test », comme son modèle)');
has(MDS, 'imposedSecondaryStructure={activeTest.secondaryStructure || \'\'}',
  'la page MD aussi — c’est SA sous-section « Sequence and structure »');
has(DOCK, 'imposedSecondaryStructure={activeTest.secondaryStructure || \'\'}',
  'la page Docking aussi (elle a la même sous-section)');

console.log(`_ss_dihedral_test.mjs — ${passed} assertions OK (les deux recettes de la peinture — H α −57/−47,`
  + ' E β −139/+135 —, le puits plat en degrés avec son écart circulaire, la famille « dihedral » du champ'
  + ' (sa ligne, son poids, son unité et son addition dans l’enthalpie), la conversion appariée PAR ORDRE'
  + ' (φ et ψ séparément, un bout de chaîne n’ayant que son angle, une longueur qui ne correspond pas DITE),'
  + ' et l’effet EXÉCUTÉ : une chaîne de feuillet imposée en hélice voit sa pénalité tomber par la'
  + ' minimisation (contrôle sans contraintes compris), le rapport de la dynamique la chiffrer avant/après,'
  + ' et le panneau 🧬 la brancher sur ▶ MD, ⚒ Minimise, ▶ Run et ⟳ Energy — avec la structure peinte qui'
  + ' arrive des trois pages)')
;





