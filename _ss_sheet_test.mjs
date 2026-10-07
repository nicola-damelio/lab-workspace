/* =========================================================================
   _ss_sheet_test.mjs — LE TOUR IMPOSÉ, ET LES FEUILLETS β DÉCLARÉS.

   La demande, mot pour mot : « In the sequence definition, beyond, alpha helix right
   and left, coil and beta strands, add the possibility to impose turns and to
   associate beta strands to make a beta sheet, parallel or antiparallel. »

   Ce qui doit rester vrai :

     • LA LETTRE T EXISTE PARTOUT — la table des métadonnées (SS_META), la géométrie
       construite (SS_TORSIONS), la contrainte de dihèdre (SS_DIHEDRALS), les trois
       pages (pinceau, « All γ-Turn », getSSAt) ;
     • LES DEUX TABLEAUX S'ACCORDENT — SS_TORSIONS.T et SS_DIHEDRALS.T portent le
       MÊME couple (la règle déjà tenue pour E), et la conversion de la structure
       imposée le lit pour de bon (exécuté) ;
     • LE TOUR EXISTE VRAIMENT — mesuré sur le VRAI bâtisseur : un résidu T fait le
       pont C7 du tour γ (O(i)···N(i+2) ≈ 2,7 Å) et courbe la chaîne, là où une
       pelote laisse ≈ 3,8 Å et ne la courbe pas ;
     • LA DÉCLARATION EST RELUE, PAS DEVINÉE — betaSheetPairsOf appariera deux brins
       peints (les suites de E), et COMPTE tout ce qui ne correspond plus (fourchette
       hors séquence, brin trop court, deux fourchettes qui se recouvrent, sens
       inconnu, doublon) ;
     • LE REPLIEMENT — exécuté sur le VRAI bâtisseur : un feuillet déclaré fait
       vraiment se faire face les deux brins (échelons CA–CA mesurés, ponts N···O
       trouvés, axe des brins dans le SENS demandé), antiparallèle ET parallèle ;
     • DÉTERMINISTE — deux appels identiques rendent les mêmes torsions (graine fixe),
       et les résidus HORS fenêtre gardent exactement leurs φ/ψ ;
     • HONNÊTE — une déclaration impossible ne replie RIEN et le DIT (`no-pair`) ;
     • LE FICHIER — REMARK 950/951 et deux records SHEET dont le second porte le SENS
       signé (+1 parallèle / −1 antiparallèle), et la géométrie ANNONCÉE par les
       REMARK est celle des coordonnées ÉCRITES (relues dans le fichier) ;
     • SANS DÉCLARATION, RIEN NE CHANGE — le même modèle sort droit (les deux brins à
       plus de 8 Å), donc le feuillet déclaré est bien ce qui les rapproche ;
     • LES TROIS PAGES — pinceau T, « All γ-Turn » (NMR, MD), bande de séquence
       marquée par le MÊME lecteur, et le panneau 🧵 branché sur les TROIS pages
       (NMR, MD et Docking) depuis UNE seule définition — le crochet partagé
       `useSequenceStructureModel`, qui rend aussi le modèle PDB au viewer 3D.

   Run: node _ss_sheet_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SHEET_SENSES, SHEET_SENSE_LABELS, SHEET_SENSE_GLYPHS, SHEET_CA_DISTANCE, SHEET_HBOND_MAX,
  SHEET_PAIR_COLORS, SHEET_MIN_STRAND, SHEET_SEED, SHEET_EVALUATION_BUDGET, SHEET_LOOP_LIBRARY,
  sheetStrandsOf, betaSheetPairsOf, sheetMarkAt, sheetGeometryOf, foldBetaSheets,
  sheetPairColor, sheetFoldSentenceOf,
} from './src/utils/betaSheetFold.js';
import {
  SS_DIHEDRALS, SS_DIHEDRAL_LETTERS, secondaryDihedralRestraintsOf, backboneTorsionsOf,
} from './src/utils/structureCalc.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const near = (a, b, what, eps = 0.05) => {
  assert.ok(Math.abs(a - b) <= eps, `${what}\n  attendu ${b}, obtenu ${a}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/* ── LE BÂTISSEUR DE LA PAGE, EXTRAIT PUIS EXÉCUTÉ (le motif des autres suites) ──
   `proteinSequenceToPdbText` appelle maintenant le module du feuillet : ses trois
   fonctions lui sont donc passées en paramètres (le code extrait les lit comme des
   variables libres). Rien n'est simulé : c'est le VRAI écrivain PDB de la page. */
const SECTION = read('./src/components/NMRSections.jsx');
const builderOf = (name) => {
  const marker = `const ${name} = `;
  const start = SECTION.indexOf(marker);
  if (start === -1) throw new Error(`missing ${name}`);
  let depth = 0;
  let i = start + marker.length;
  for (; i < SECTION.length; i += 1) {
    const ch = SECTION[i];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) break;
  }
  return `${SECTION.slice(start, i + 1)}\n`;
};
const BUILDER_ORDER = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm',
  '_vecNormalize', '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum',
  'pdbAtomLine', 'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose',
  'placeSidechainAtoms', 'buildProteinBackbone', 'proteinSequenceToPdbText'];
const B = new Function('betaSheetPairsOf', 'foldBetaSheets', 'sheetGeometryOf',
  `${BUILDER_ORDER.map(builderOf).join('')}\nreturn { proteinSequenceToPdbText, buildProteinBackbone, SS_TORSIONS };`,
)(betaSheetPairsOf, foldBetaSheets, sheetGeometryOf);
const { proteinSequenceToPdbText, buildProteinBackbone, SS_TORSIONS } = B;

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const torsionsOf = (ss) => ss.split('').map((l) => SS_TORSIONS[l] || SS_TORSIONS.C);
const caOf = (residues) => residues.map((r) => r.CA);
const closestAcross = (a, b) => Math.min(...a.flatMap((x) => b.map((y) => dist(x, y))));

/* ════════════ 1 · LA LETTRE T — LES QUATRE TABLES ET LES TROIS PAGES ═══════════ */
const META_SRC = read('./src/components/NMRData.jsx');
const MD_SRC = read('./src/components/MDSections.jsx');
const DOCK_SRC = read('./src/components/DockingSections.jsx');
has(META_SRC, "T: { label: 'γ-Turn (C7)'", 'la lettre T a sa puce et son nom dans SS_META');
has(SECTION, 'T: { phi: _deg2rad(75), psi: _deg2rad(-65) },', 'la lettre T a SA géométrie dans SS_TORSIONS');
has(read('./src/utils/structureCalc.js'), 'T: { phi: 75, psi: -65 },',
  'la conversion SS → φ/ψ connaît T (SS_DIHEDRALS)');
eq([...SS_DIHEDRAL_LETTERS].sort(), ['E', 'H', 'L', 'T'],
  '⚠ LES QUATRE lettres qui IMPOSENT quelque chose sont H, L, E et T');
near(SS_DIHEDRALS.T.phi * Math.PI / 180, SS_TORSIONS.T.phi,
  '⚠ LE MÊME COUPLE dans la géométrie construite et dans la contrainte : un tour peint tombe à 0° de sa cible', 1e-9);
near(SS_DIHEDRALS.T.psi * Math.PI / 180, SS_TORSIONS.T.psi, '…et pour ψ aussi', 1e-9);
for (const [name, src] of [['DockingSections.jsx', DOCK_SRC], ['MDSections.jsx', MD_SRC], ['NMRSections.jsx', SECTION]]) {
  has(src, "'HESLT'.includes", `${name} accepte la lettre T dans getSSAt`);
  has(src, "{['C', 'H', 'L', 'E', 'T'].map((l) => (", `…et son pinceau la propose (${name})`);
}
has(SECTION, "setAllSS('T')", 'la page NMR a le bouton « All γ-Turn »');
has(MD_SRC, "setAllSS('T')", 'la page MD aussi');

/* ── LE TOUR, MESURÉ SUR LE VRAI BÂTISSEUR ───────────────────────────────────────
   Un résidu T doit COURBER la chaîne et porter le pont C7 du tour γ. Les deux
   chiffres sont ceux de la sonde, et ils sont comparés à une pelote. */
const nine = 'A'.repeat(9);
const turnRes = buildProteinBackbone(nine, 'T'.repeat(9));
const coilRes = buildProteinBackbone(nine, 'C'.repeat(9));
const c7Of = (res) => Math.min(...res.slice(0, 6).map((r, k) => Math.min(dist(r.O, res[k + 2].N), dist(res[k + 2].O, r.N))));
ok(c7Of(turnRes) <= 2.9,
  `⚠ LE TOUR γ FAIT SON PONT C7 sur le modèle bâti (O(i)···N(i+2) = ${c7Of(turnRes).toFixed(2)} Å ≤ 2,9 Å)`);
ok(c7Of(coilRes) > 3.5, `…qu'une pelote ne fait pas (${c7Of(coilRes).toFixed(2)} Å) : le tour est une conformation, pas un nom`);
ok(dist(turnRes[2].CA, turnRes[4].CA) < dist(coilRes[2].CA, coilRes[4].CA),
  `…et il COURBE la chaîne (CA(i)–CA(i+2) ${dist(turnRes[2].CA, turnRes[4].CA).toFixed(2)} Å contre ${dist(coilRes[2].CA, coilRes[4].CA).toFixed(2)} Å pour la pelote)`);
ok(dist(turnRes[0].CA, turnRes[8].CA) < dist(coilRes[0].CA, coilRes[8].CA),
  "…si bien que neuf tours ramènent la chaîne plus près qu'une pelote ne le fait");

/* ── LA CONTRAINTE DE DIHÈDRE, EXÉCUTÉE ──────────────────────────────────────────
   Une chaîne de sonde (bâtie au chiffre près, le motif de _ss_dihedral_test.mjs) est
   convertie : les résidus T portent la cible du tour γ, un C ne porte rien. */
const probeSpine = (() => {
  const els = []; const pts = []; const bonds = [];
  const push = (el, p) => { els.push(el); pts.push(p); return pts.length - 1; };
  const DEG = Math.PI / 180;
  const place = ({ a, b, c, length, angleDeg, dihDeg }) => {
    const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const norm = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
    const bc = norm(sub(c, b)); const ab = sub(b, a);
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = norm(cross(ab, bc)); const m = cross(n, bc);
    const t = dihDeg * DEG; const ang = angleDeg * DEG;
    const d = [-length * Math.cos(ang), length * Math.sin(ang) * Math.cos(t), length * Math.sin(ang) * Math.sin(t)];
    return [0, 1, 2].map((k) => c[k] + bc[k] * d[0] + m[k] * d[1] + n[k] * d[2]);
  };
  const N = [0, 0, 0]; const CA = [1.46, 0, 0];
  const C = [1.46 + 1.52 * Math.cos(69 * DEG), 1.52 * Math.sin(69 * DEG), 0];
  const iN = push('N', N); const iCA = push('C', CA); const iC = push('C', C);
  const iO = push('O', place({ a: N, b: CA, c: C, length: 1.23, angleDeg: 120.5, dihDeg: 180 }));
  bonds.push({ i: iN, j: iCA, order: 1 }, { i: iCA, j: iC, order: 1 }, { i: iC, j: iO, order: 2 });
  for (let k = 1; k < 6; k += 1) {
    const nPrev = pts[iN + (k - 1) * 4]; const caPrev = pts[iCA + (k - 1) * 4]; const cPrev = pts[iC + (k - 1) * 4];
    const nk = place({ a: nPrev, b: caPrev, c: cPrev, length: 1.33, angleDeg: 116, dihDeg: 135 });
    const iNk = push('N', nk);
    const cak = place({ a: caPrev, b: cPrev, c: nk, length: 1.46, angleDeg: 122, dihDeg: 180 });
    const iCAk = push('C', cak);
    const ck = place({ a: cPrev, b: nk, c: cak, length: 1.52, angleDeg: 111, dihDeg: -139 });
    const iCk = push('C', ck);
    const iOk = push('O', place({ a: nk, b: cak, c: ck, length: 1.23, angleDeg: 120.5, dihDeg: 315 }));
    bonds.push({ i: iC + (k - 1) * 4, j: iNk, order: 1 }, { i: iNk, j: iCAk, order: 1 },
      { i: iCAk, j: iCk, order: 1 }, { i: iCk, j: iOk, order: 2 });
  }
  return { count: els.length, elements: els, bonds };
})();
const probeBackbone = backboneTorsionsOf({ elements: probeSpine.elements, bonds: probeSpine.bonds, atomCount: probeSpine.count });
const turnRestraints = secondaryDihedralRestraintsOf({ secondaryStructure: 'TTTTTT', torsions: probeBackbone });
ok(turnRestraints.ok, 'la conversion accepte une séquence peinte de tours');
eq(turnRestraints.constraints.filter((c) => c.letter === 'T').length, 10,
  "⚠ LES TOURS PEINTS DONNENT LEURS ANGLES — 6 résidus lus, mais un BOUT de chaîne n'a qu'un des deux (5 φ + 5 ψ)");
ok(turnRestraints.constraints.filter((c) => c.letter === 'T').every((c) => c.target === 75 || c.target === -65),
  '…et la cible est bien celle du tour γ (φ +75°, ψ −65°)');
eq(secondaryDihedralRestraintsOf({ secondaryStructure: 'CCCCCC', torsions: probeBackbone }).ok, false,
  "⚠ une pelote n'impose toujours RIEN (le silence de C est intact)");

/* ════════════ 2 · LA DÉCLARATION, RELUE — LES BRINS PEINTS ET LES PAIRES ═══════ */
eq(SHEET_SENSES, ['antiparallel', 'parallel'], 'les deux sens offerts, dans cet ordre (les boutons du panneau)');
eq(SHEET_SENSE_LABELS, { antiparallel: 'Antiparallel', parallel: 'Parallel' }, '…chacun avec SON libellé, écrit une fois');
eq(SHEET_SENSE_GLYPHS, { antiparallel: '⇄', parallel: '⇉' }, '…et SON glyphe, lu par le panneau ET la bande de séquence');
near(SHEET_CA_DISTANCE, 4.85, 'la distance CA–CA visée est celle des manuels', 1e-9);
near(SHEET_HBOND_MAX, 3.6, '…et un pont doit être trouvé sous 3,6 Å', 1e-9);
eq(SHEET_MIN_STRAND, 2, "un brin d'UN résidu n'apparie rien");
ok(SHEET_SEED > 0, 'la graine du tirage est fixe (le repliement est donc reproductible)');
ok(SHEET_EVALUATION_BUDGET > 0 && SHEET_LOOP_LIBRARY.length >= 4,
  "le budget d'évaluations et la bibliothèque de boucles sont déclarés (aucun chiffre caché dans la recherche)");
ok(SHEET_LOOP_LIBRARY.every((e) => e.name && Array.isArray(e.pairs) && e.pairs.length),
  '…et chaque entrée de la bibliothèque porte son nom de tour et ses φ/ψ');
ok(SHEET_LOOP_LIBRARY.some((e) => e.name === "type I'") && SHEET_LOOP_LIBRARY.some((e) => e.name === 'type II'),
  '…(les tours β des manuels y sont, comme les conformations détendues)');

const painted = 'CCEEECCEEEEEE';
eq(sheetStrandsOf(painted), [{ index: 0, start: 3, end: 5, length: 3 }, { index: 1, start: 8, end: 13, length: 6 }],
  "les brins sont les SUITES de E de la peinture (deux ici), rien d'autre");
eq(sheetStrandsOf('CCCCCC'), [], 'une séquence sans E ne propose aucun brin');
eq(sheetStrandsOf('EEE'), [{ index: 0, start: 1, end: 3, length: 3 }], '…et un brin qui touche un bout compte aussi');

const good = { a: [3, 5], b: [8, 13], sense: 'antiparallel' };
const read1 = betaSheetPairsOf({ secondaryStructure: painted, sheets: [good], sequenceLength: painted.length });
eq(read1.pairs.length, 1, 'une déclaration valide devient UNE paire');
eq(read1.rejected, 0, "…et rien n'est refusé");
eq(read1.pairs[0].label, 'β1', 'la paire porte sa lettre (β1, β2, …)');
eq(read1.pairs[0].color, SHEET_PAIR_COLORS[0], '…et la couleur de son rang dans la table des paires');
eq(read1.pairs[0].sheetIndex, 0, "…et la place de sa DÉCLARATION (c'est par elle que le panneau la retire)");
eq([read1.pairs[0].a.start, read1.pairs[0].a.end, read1.pairs[0].a.paintedE], [3, 5, 3],
  'la fourchette du premier brin est celle déclarée, et ses résidus peints E sont COMPTÉS');
eq([read1.pairs[0].b.start, read1.pairs[0].b.end, read1.pairs[0].b.paintedE], [8, 13, 6],
  '…idem pour le second');
eq(betaSheetPairsOf({ secondaryStructure: painted, sheets: [{ a: [8, 13], b: [3, 5], sense: 'parallel' }], sequenceLength: painted.length })
  .pairs[0].a.start, 3, "⚠ l'ordre des deux fourchettes dans la déclaration est sans effet (le brin de séquence le plus tôt est A)");
eq(betaSheetPairsOf({ secondaryStructure: painted, sheets: [{ a: [3, 5], b: [8, 13], sense: 'parallel' }], sequenceLength: painted.length })
  .pairs[0].senseLabel, 'Parallel', '…mais le SENS demandé, lui, est porté tel quel');

const rejected = (sheets) => betaSheetPairsOf({ secondaryStructure: painted, sheets, sequenceLength: painted.length }).rejected;
eq(rejected([{ a: [3, 5], b: [8, 13], sense: 'sideways' }]), 1, '❌ un sens inconnu est REFUSÉ (compté)');
eq(rejected([{ a: [3, 5], b: [8, 40], sense: 'antiparallel' }]), 1, '❌ une fourchette hors séquence aussi');
eq(rejected([{ a: [3, 3], b: [8, 13], sense: 'antiparallel' }]), 1, "❌ un brin d'un résidu aussi");
eq(rejected([{ a: [3, 9], b: [8, 13], sense: 'antiparallel' }]), 1, "❌ deux fourchettes qui se RECOUVRENT aussi (un brin ne s'apparie pas à lui-même)");
eq(rejected([good, good]), 1, '❌ et la même déclaration deux fois (le doublon est compté, pas replié deux fois)');
eq(rejected([{ a: [3, 5], b: [8, 13] }]), 1, "❌ une déclaration sans sens n'est jamais devinée");
eq(rejected([good, { a: [3, 5], b: [8, 40] }]), 1,
  "⚠ UNE déclaration invalide n'empêche pas les autres : elle est comptée À CÔTÉ (`rejected`), et la valide reste");

const marks = read1.pairs;
eq(sheetMarkAt(marks, 1), null, "un résidu hors des brins déclarés n'a aucun repère");
eq(sheetMarkAt(marks, 3).strand, 1, 'le premier résidu du premier brin est « strand 1 »');
eq(sheetMarkAt(marks, 13).strand, 2, 'le dernier du second est « strand 2 »');
eq(sheetMarkAt(marks, 3).partner, '8–13', 'le repère nomme la fourchette PARTENAIRE');
eq(sheetMarkAt(marks, 3).glyph, '⇄', '…et le glyphe du sens');
eq(sheetMarkAt(marks, 3).color, sheetPairColor(0), '…dans la couleur de la paire');
eq(sheetMarkAt(marks, 5).last, true, '…et il sait si le résidu est le DERNIER de son brin');
eq(sheetMarkAt(marks, 4).last, false, '…(faux au milieu)');
eq(betaSheetPairsOf({ secondaryStructure: painted, sheets: [good], sequenceLength: painted.length }).strands.length, 2,
  'la relecture rend AUSSI les brins trouvés (le panneau les propose sans second lecteur)');
eq(sheetPairColor(0), SHEET_PAIR_COLORS[0], "la couleur d'une paire est celle de son rang");
eq(sheetPairColor(SHEET_PAIR_COLORS.length), SHEET_PAIR_COLORS[0], '…et la table tourne sans jamais sortir de ses bornes');
eq(sheetPairColor(-1), SHEET_PAIR_COLORS[SHEET_PAIR_COLORS.length - 1], '…même pour un rang négatif');

/* ════════════ 3 · LE REPLIEMENT — EXÉCUTÉ SUR LE VRAI BÂTISSEUR ═══════════════ */
const hairpin = (nA, loop, nB, sense) => {
  const ss = `${'E'.repeat(nA)}${loop}${'E'.repeat(nB)}`;
  const seq = 'A'.repeat(ss.length);
  const sheets = [{ a: [1, nA], b: [nA + loop.length + 1, ss.length], sense }];
  const pairs = betaSheetPairsOf({ secondaryStructure: ss, sheets, sequenceLength: seq.length }).pairs;
  const base = torsionsOf(ss);
  const fold = foldBetaSheets({ sequence: seq, torsions: base, pairs, build: (cand) => buildProteinBackbone(seq, cand) });
  return { ss, seq, sheets, base, fold, pair: fold.pairs[0] };
};

const anti = hairpin(4, 'CCC', 4, 'antiparallel');
ok(anti.fold.converged, `⚠ LE FEUILLET ANTIPARALLÈLE SE REFERME (${anti.fold.reason}, ${anti.fold.evaluations} évaluations)`);
ok(anti.pair.senseOk, '…et son sens est bien celui demandé (mesuré sur les axes)');
ok(anti.pair.hbonds.length >= 2, `…avec ${anti.pair.hbonds.length} ponts N···O (un feuillet en a au moins deux)`);
ok(anti.pair.hbonds.every((h) => h.distance <= SHEET_HBOND_MAX), '…tous sous le seuil de pont (3,6 Å)');
ok(anti.pair.paired >= anti.pair.registers - 1,
  `…et les échelons CA–CA sont appariés (${anti.pair.paired}/${anti.pair.registers} : ${[...anti.pair.ca, ...anti.pair.caB].map((d) => d.toFixed(1)).join(' ')})`);
ok(Math.max(...anti.pair.ca, ...anti.pair.caB) <= SHEET_CA_DISTANCE + 1.7,
  '…si bien que même le pire échelon reste au contact (≤ 6,6 Å)');
ok(anti.pair.direction <= -0.5, `…et les deux axes sont OPPOSÉS (cos = ${anti.pair.direction.toFixed(2)} ≤ −0,5)`);
ok(sheetFoldSentenceOf(anti.fold).includes('folded'), 'la phrase du rapport DIT que le feuillet est replié');
ok(sheetFoldSentenceOf(anti.fold).includes('H-bond'), '…avec le nombre de ponts et les échelons mesurés, jamais un slogan');

const par = hairpin(4, 'CCCC', 4, 'parallel');
ok(par.fold.converged, `⚠ LE FEUILLET PARALLÈLE AUSSI (${par.fold.reason}, ${par.fold.evaluations} évaluations)`);
ok(par.pair.direction >= 0.5, `…et les deux axes vont dans le MÊME sens (cos = ${par.pair.direction.toFixed(2)} ≥ 0,5)`);
ok(par.pair.hbonds.length >= 2, `…avec ses ${par.pair.hbonds.length} ponts N···O`);

/* ⚠ UNE BOUCLE TROP COURTE — le repliement ne referme pas TOUJOURS (deux résidus
   entre les brins ne suffisent pas à tourner), et c'est DIT : le rapport porte la
   meilleure conformation trouvée, la phrase ne promet rien, et les chiffres mesurés
   restent ceux du modèle réellement rendu. */
{
  const tight = hairpin(4, 'CC', 4, 'antiparallel');
  ok(['converged', 'best-effort'].includes(tight.fold.reason), 'la boucle de deux résidus rend un verdict CONNU (jamais autre chose)');
  if (!tight.fold.converged) {
    eq(tight.fold.reason, 'best-effort', '…et quand elle ne se referme pas, la raison est `best-effort`');
    ok(!sheetFoldSentenceOf(tight.fold).includes('— folded'), "…la phrase DIT « best conformation found » au lieu de se dire repliée");
    ok(tight.fold.pairs[0].converged === false, '…et le verdict de la paire est le même que celui du repliement');
    ok(tight.fold.pairs[0].ca.every((d) => Number.isFinite(d)), '…avec ses distances mesurées (aucun chiffre inventé)');
  }
}

/* ── DÉTERMINISTE, ET HORS FENÊTRE INTACT ──────────────────────────────────────── */
const again = foldBetaSheets({
  sequence: anti.seq, torsions: torsionsOf(anti.ss),
  pairs: betaSheetPairsOf({ secondaryStructure: anti.ss, sheets: anti.sheets, sequenceLength: anti.seq.length }).pairs,
  build: (cand) => buildProteinBackbone(anti.seq, cand),
});
eq(again.torsions, anti.fold.torsions, '⚠ DEUX APPELS IDENTIQUES DONNENT LES MÊMES TORSIONS (graine fixe)');
eq(again.pairs, anti.fold.pairs, '…et le même rapport, chiffre pour chiffre');
const far = 'HHHHHHHHCCEEEECCEEEE';
{
  const seq = 'A'.repeat(far.length);
  const sheets = [{ a: [11, 14], b: [17, 20], sense: 'antiparallel' }];
  const pairs = betaSheetPairsOf({ secondaryStructure: far, sheets, sequenceLength: seq.length }).pairs;
  const base = torsionsOf(far);
  const fold = foldBetaSheets({ sequence: seq, torsions: base, pairs, build: (cand) => buildProteinBackbone(seq, cand) });
  eq(fold.torsions.slice(0, 10), base.slice(0, 10),
    "⚠ LES HUIT HÉLICES D'AVANT LA FENÊTRE GARDENT EXACTEMENT LEURS φ/ψ (un feuillet ne défait pas une hélice qui vit ailleurs)");
  ok(fold.moved.every((i) => i >= 10 && i <= 19), "…la fenêtre déplacée est celle des deux brins et de leur boucle, rien d'autre");
}

/* ── HONNÊTE — CE QUI NE PEUT PAS SE REPLIER EST DIT, RIEN N'EST INVENTÉ ───────── */
{
  const seq = 'A'.repeat(10);
  const base = torsionsOf('EEEECCEEEE');
  const none = foldBetaSheets({ sequence: seq, torsions: base, pairs: [], build: (cand) => buildProteinBackbone(seq, cand) });
  eq(none.reason, 'no-pair', "❌ sans déclaration valide, le repliement s'arrête AVANT toute recherche");
  eq(none.evaluations, 0, '…sans même construire une seule conformation');
  eq(none.torsions, base, "…et rend les torsions d'entrée, telles quelles");
  const one = foldBetaSheets({
    sequence: seq, torsions: base,
    pairs: betaSheetPairsOf({ secondaryStructure: 'EEEECCEEEE', sheets: [{ a: [1, 1], b: [7, 10], sense: 'antiparallel' }], sequenceLength: seq.length }).pairs,
    build: (cand) => buildProteinBackbone(seq, cand),
  });
  eq(one.reason, 'no-pair', "❌ un brin d'un résidu est refusé par la RELECTURE — le repliement n'a donc rien à faire");
  const noBuild = foldBetaSheets({
    sequence: seq, torsions: base,
    pairs: betaSheetPairsOf({ secondaryStructure: 'EEEECCEEEE', sheets: [{ a: [1, 4], b: [7, 10], sense: 'antiparallel' }], sequenceLength: seq.length }).pairs,
    build: null,
  });
  eq(noBuild.reason, 'no-model', '❌ et sans constructeur, la raison est dite (`no-model`), pas simulée');
  ok(!noBuild.converged && noBuild.pairs.length === 0, "…avec un rapport vide plutôt qu'une promesse");
  const idem = foldBetaSheets({
    sequence: anti.seq, torsions: anti.fold.torsions,
    pairs: betaSheetPairsOf({ secondaryStructure: anti.ss, sheets: anti.sheets, sequenceLength: anti.seq.length }).pairs,
    build: (cand) => buildProteinBackbone(anti.seq, cand),
  });
  eq(idem.reason, 'already-sheeted', "⚠ UN MODÈLE DÉJÀ REPLIÉ N'EST PAS RETOUCHÉ (même graine, même déclaration)");
  eq(idem.evaluations, 1, "…une SEULE évaluation, celle qui juge la conformation d'entrée : aucune recherche n'est lancée");
  eq(idem.torsions, anti.fold.torsions, "…et les torsions rendues sont celles qu'on lui a données");
}

/* ── LA MESURE EST PARTAGÉE — sheetGeometryOf RELIT N'IMPORTE QUEL MODÈLE ──────── */
{
  const pairs = betaSheetPairsOf({ secondaryStructure: anti.ss, sheets: anti.sheets, sequenceLength: anti.seq.length }).pairs;
  const res = buildProteinBackbone(anti.seq, anti.fold.torsions);
  eq(sheetGeometryOf({ residues: res, pairs }), anti.fold.pairs,
    '⚠ LE LECTEUR PARTAGÉ ET LE REPLIEMENT LISENT LA MÊME GÉOMÉTRIE (le même chiffre, pas deux)');
  eq(sheetGeometryOf({ residues: [], pairs: [] }), [], '…et un modèle vide ne rend aucune ligne au lieu de jeter');
  eq(sheetGeometryOf({ residues: res, pairs: [] }), [], '…ni une déclaration sans paire');
  const badGeo = sheetGeometryOf({ residues: res, pairs: [{ ...pairs[0], sense: 'parallel' }] });
  ok(!badGeo[0].senseOk && !badGeo[0].converged,
    "…et un feuillet MESURÉ dans le mauvais sens est dit faux (`senseOk`), il n'est pas réputé bon parce que demandé");
}

/* ════════════ 4 · LE FICHIER — LES RECORDS, ET LA GÉOMÉTRIE ÉCRITE ═════════════ */
const parseAtoms = (text) => {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!/^(ATOM|HETATM)/.test(line)) continue;
    out.push({
      name: line.slice(12, 16).trim(),
      resName: line.slice(17, 20).trim(),
      resSeq: parseInt(line.slice(22, 26), 10),
      pos: [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))],
    });
  }
  return out;
};
const residuesFrom = (atoms) => {
  const bySeq = new Map();
  atoms.forEach((a) => {
    if (!['N', 'CA', 'C', 'O'].includes(a.name)) return;
    const r = bySeq.get(a.resSeq) || {};
    r[a.name] = a.pos;
    bySeq.set(a.resSeq, r);
  });
  return [...bySeq.keys()].sort((x, y) => x - y).map((k) => bySeq.get(k));
};

const ss11 = 'EEEECCCEEEE';
const seq11 = 'A'.repeat(ss11.length);
const decl = [{ a: [1, 4], b: [8, 11], sense: 'antiparallel' }];
const pdb = proteinSequenceToPdbText(seq11, ss11, 'TEST', { sheets: decl });
has(pdb, 'REMARK 950 BETA-SHEET(S) IMPOSED BY THE SEQUENCE DEFINITION: 1',
  'le fichier DIT le feuillet déclaré (REMARK 950)');
has(pdb, 'REMARK 951 β1: strand 1-4 / strand 8-11 ANTIPARALLEL',
  '…et chaque paire a SA ligne (REMARK 951), avec ses deux fourchettes et son sens');
const sheetLines = pdb.split(/\r?\n/).filter((l) => l.startsWith('SHEET'));
eq(sheetLines.length, 2, 'un record SHEET par brin déclaré (la convention PDB)');
eq(sheetLines[0].slice(9, 10), '1', "…l'identifiant du feuillet est en colonne 10");
eq(sheetLines[0].slice(15, 16), '2', '…le nombre de brins en colonne 16');
eq(sheetLines[0].slice(17, 21), 'ALAA', '…le premier résidu (nom + chaîne) en 18-21');
eq(sheetLines[0].slice(21, 25).trim(), '1', '…son numéro en 22-25');
eq(sheetLines[0].slice(31, 35).trim(), '4', '…le dernier résidu en 32-35');
eq(sheetLines[0].slice(35, 38).trim(), '0', "…et le SENS 0 (la première ligne d'un feuillet n'a pas d'antécédent)");
eq(sheetLines[1].slice(21, 25).trim(), '8', 'la seconde ligne décrit le SECOND brin (résidu 8)');
eq(sheetLines[1].slice(35, 38).trim(), '-1', '…et porte le sens SIGNÉ de la déclaration (−1 = antiparallèle)');
{
  const pairs = betaSheetPairsOf({ secondaryStructure: ss11, sheets: decl, sequenceLength: seq11.length }).pairs;
  const written = residuesFrom(parseAtoms(pdb));
  const geo = sheetGeometryOf({ residues: written, pairs });
  eq(geo.length, 1, "le fichier écrit un feuillet, donc il s'y lit");
  ok(geo[0].converged, `…refermé (${geo[0].paired}/${geo[0].registers} échelons appariés, ${geo[0].hbonds.length} ponts)`);
  has(pdb, `${geo[0].hbonds.length} N-H...O=C hydrogen bond(s)`,
    '⚠ LE REMARK ANNONCE EXACTEMENT LES PONTS QUE LE FICHIER CONTIENT (relus dans ses coordonnées)');
  has(pdb, [...geo[0].ca, ...geo[0].caB].map((d) => d.toFixed(1)).join(' '),
    '…et les échelons CA–CA annoncés sont les SIENS, mesurés sur ce qui est écrit');
}
{
  const plain = proteinSequenceToPdbText(seq11, ss11, 'TEST');
  ok(plain.split(/\r?\n/).filter((l) => l.startsWith('SHEET')).length === 0,
    "sans déclaration, AUCUN record SHEET n'est écrit");
  const plainRes = residuesFrom(parseAtoms(plain));
  const written = residuesFrom(parseAtoms(pdb));
  const farCA = closestAcross(caOf(plainRes.slice(0, 4)), caOf(plainRes.slice(7, 11)));
  const nearCA = closestAcross(caOf(written.slice(0, 4)), caOf(written.slice(7, 11)));
  ok(farCA > 8, `⚠ SANS DÉCLARATION LES DEUX BRINS SONT LOIN (${farCA.toFixed(1)} Å) : c'est bien le feuillet déclaré qui les rapproche`);
  ok(nearCA <= 6.2, `…et avec elle, le plus court contact CA–CA tombe à ${nearCA.toFixed(1)} Å (la face à face)`);
}
{
  const bad = proteinSequenceToPdbText(seq11, ss11, 'TEST', { sheets: [{ a: [1, 4], b: [8, 99], sense: 'antiparallel' }] });
  has(bad, '(+1 declaration(s) that no longer match the sequence)',
    '…et une déclaration devenue invalide est COMPTÉE dans le fichier, pas repliée en silence');
  ok(bad.split(/\r?\n/).filter((l) => l.startsWith('SHEET')).length === 0,
    '…sans le moindre record SHEET inventé (la ligne REMARK le mentionne, mais aucun record)');
  ok(!bad.includes('REMARK 951'), "…ni la ligne d'une paire qui n'existe pas");
}
{
  const parPdb = proteinSequenceToPdbText('A'.repeat(12), 'EEEECCCCEEEE', 'TEST', {
    sheets: [{ a: [1, 4], b: [9, 12], sense: 'parallel' }],
  });
  const lines = parPdb.split(/\r?\n/).filter((l) => l.startsWith('SHEET'));
  eq(lines.length, 2, "un feuillet parallèle s'écrit aussi en deux records");
  eq(lines[1].slice(35, 38).trim(), '+1', '…et son second brin porte « +1 » (parallèle) au lieu de −1');
  has(parPdb, 'PARALLEL', '…la note du fichier le dit en toutes lettres, elle aussi');
}

/* ════════════ 5 · LES TROIS PAGES — LE PINCEAU, LA BANDE, LE PANNEAU ═══════════ */
has(SECTION, 'SequencePaintStrip, BetaSheetEditor', 'la page NMR importe le panneau 🧵 avec la bande de séquence partagée');
has(SECTION, '<BetaSheetEditor', '…et le BRANCHE dans « Sequence and structure »');
has(SECTION, 'sheets={activeTest.betaSheets}', '…sur la déclaration du test (la même clé que les ponts disulfure)');
has(SECTION, 'onChange={(next) => updateActiveTest({ betaSheets: next })}', "…avec l'écriture qui la met à jour");
has(SECTION, 'residueNo={residueNoOf}', '…dans les NUMÉROS AFFICHÉS du 🔢, comme les autres panneaux');
has(SECTION, 'fold={sheetFold}', '…et le rapport du modèle RÉELLEMENT bâti, affiché sous les puces');
has(SECTION, 'const sheetFold = useMemo(() => {', '⚠ le repliement est un ÉTAT mémoïsé : il ne se refait pas à chaque rendu');
has(SECTION, "if (univTestMode || d.moleculeType !== 'protein' || !d.seq || !betaSheetRead.pairs.length) return null;",
  "…et le mode 🎓 University test n'en replie AUCUN (le modèle dirait la réponse)");
has(SECTION, 'sheets: activeTest.betaSheets,', 'la génération 3D passe la DÉCLARATION au modèle de séquence');
eq(SECTION.split('sheets: activeTest.betaSheets,').length - 1, 3,
  '…aux DEUX endroits qui fabriquent un PDB de protéine (le modèle servi et le téléchargement) ET à la relecture du panneau');
eq(SECTION.split('torsions: sheetFold ? sheetFold.torsions : null').length - 1, 2,
  '…avec les torsions du repliement, pour que le modèle et le fichier soient LE MÊME objet');
has(SECTION, 'sheetOf={(i) => sheetMarkAt(betaSheetRead.pairs, i + 1)}',
  'la bande NMR marque les brins déclarés (le MÊME lecteur que le panneau, sur les positions de séquence)');
has(META_SRC, '`sheetOf(i)` (optionnel)', 'la bande de séquence partagée DOCUMENTE le repère de feuillet');
has(META_SRC, '{sheet.glyph}{sheet.strand}', "…et l'écrit sur le chip (le glyphe du sens et le rang du brin)");
has(META_SRC, 'linkOf, sheetOf }) => {', '…en le recevant comme la prop `linkOf` des ponts disulfure');
/* ── LES TROIS PAGES, UNE SEULE DÉFINITION DE SÉQUENCE ──────────────────────────
   La demande : le panneau 🧵 — apparier deux brins E peints, la SECONDE MOITIÉ de la
   définition de séquence — doit être PRÉSENT sur les trois pages (NMR, MD, Docking),
   et la définition qui en sort doit se voir dans le viewer 3D. Une seule lecture,
   donc : le crochet `useSequenceStructureModel` de NMRSections.jsx, appelé par les
   trois pages, et le MÊME panneau branché dans les trois « Sequence and structure ». */
const HOOK_AT = SECTION.indexOf('export const useSequenceStructureModel =');
ok(HOOK_AT > 0, 'le crochet partagé useSequenceStructureModel vit avec le bâtisseur PDB');
const HOOK = SECTION.slice(HOOK_AT);
has(HOOK, 'const betaSheetRead = useMemo(() => betaSheetPairsOf({',
  '…il relit la déclaration UNE fois (les brins peints et les paires valides)');
has(HOOK, 'const sheetFold = useMemo(() => {', '…il replie le modèle de séquence une fois');
has(HOOK, 'const sequenceStructure = useMemo(() => {',
  '…et il fabrique le PDB du modèle (feuillets déclarés compris) une fois');
has(HOOK, 'return { betaSheetRead, sheetFold, sequenceStructure };', '…et rend les trois ensemble');
has(SECTION, 'const { betaSheetRead, sheetFold, sequenceStructure } = useSequenceStructureModel({',
  'la page NMR appelle le crochet (elle ne relit plus la déclaration elle-même)');
for (const [name, src] of [['MDSections.jsx', MD_SRC], ['DockingSections.jsx', DOCK_SRC]]) {
  has(src, 'const { betaSheetRead, sheetFold, sequenceStructure } = useSequenceStructureModel({',
    `${name} appelle le MÊME crochet — aucune seconde lecture de la définition`);
  has(src, 'BetaSheetEditor, useSequenceStructureModel,',
    `${name} importe le panneau 🧵 et le crochet par son module de données`);
  has(src, 'sheetOf={(i) => sheetMarkAt(betaSheetRead.pairs, i + 1)}',
    `${name} marque les brins de feuillet déclarés avec la MÊME lecture`);
  has(src, '<BetaSheetEditor', `${name} BRANCHE le panneau 🧵 dans « Sequence and structure »`);
  has(src, 'sheets={activeTest.betaSheets}', `${name} écrit la MÊME déclaration que la page NMR`);
  has(src, 'onChange={(next) => updateActiveTest({ betaSheets: next })}', `${name} …par la même écriture`);
  has(src, 'fold={sheetFold}', `${name} affiche le rapport du modèle RÉELLEMENT bâti`);
  has(src, 'sequenceStructureText={sequenceStructure?.text || null}',
    `${name} confie le modèle replié à son viewer 3D (le feuillet déclaré s y voit)`);
  has(src, 'sequenceStructureExt={sequenceStructure?.ext || null}', `${name} …avec son extension`);
}
has(read('./src/components/MDData.jsx'), "export { useSequenceStructureModel } from './NMRSections';",
  'le crochet partagé est ré-exporté par le module de données de la page MD');
has(read('./src/components/DockingData.jsx'), "export { useSequenceStructureModel } from './NMRSections';",
  '…et par celui de la page Docking');
has(read('./_run_all.cjs'), '/^_.*\\.(test\\.)?(cjs|mjs)$/',
  'la suite est reprise par le lanceur global (le glob des fichiers de sonde, aucun ajout à faire)');

console.log(`\n_ss_sheet_test.mjs — ${passed} assertions OK`);
