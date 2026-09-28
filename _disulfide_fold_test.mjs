/* =========================================================================
   _disulfide_fold_test.mjs — LE PONT DISULFURE, DESSINÉ ET REFERMÉ.

   Ce qui doit rester vrai :

     • deux Cys définies ensemble dans « Cysteine states » (cysDisulfides)
       sortent du constructeur de modèle avec UN CONECT entre leurs deux Sγ —
       le SEUL record que NGL lit pour dessiner une liaison (ngl@2.4.0 parse
       CONECT ; il ne traite aucun SSBOND), plus un record SSBOND pour les
       autres outils ;
     • une Cys engagée dans un pont n'a PLUS d'hydrogène de thiol (HG) : un
       thiol oxydé n'a pas de proton ;
     • le bouton « ⚭ Fold for disulfides » du viewer DÉTEND φ/ψ des résidus
       entre les deux Cys et essaie les trois rotamères χ1 (utils/
       disulfideFold.js) jusqu'à ce que les deux Sγ soient à une distance de
       liaison (2.05 Å ± 0.35). Le modèle écrit alors porte RÉELLEMENT ce
       S–S : le test relit le PDB produit et mesure la distance en 3D ;
     • quand la fenêtre déplacée ne suffit pas, le module le DIT
       (`converged: false`) et rend la distance obtenue — il n'invente jamais
       un pont ;
     • la recherche est DÉTERMINISTE (graine fixe) et ne modifie JAMAIS les
       torsions qu'on lui donne ;
     • la DÉFINITION montre la liaison : la puce de paire porte un dessin S–S
       (deux atomes de soufre, la liaison, les deux numéros AFFICHÉS) et la
       bande de séquence marque les Cys appariées de la même couleur.

   Le module est pur : il est importé et EXÉCUTÉ. La géométrie réelle
   (buildProteinBackbone + placeSidechainAtoms) est extraite de NMRSections.jsx
   comme dans _protein_heavy_bonds_test.mjs. Les .jsx sont vérifiés sur le
   TEXTE, comme _residue_numbering_panels_test.mjs.

   Run: node _disulfide_fold_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  foldProteinForDisulfides, movableResiduesFor, scoreFold,
  SS_BOND_LENGTH, SS_BOND_TOLERANCE, MAX_MOVABLE_RESIDUES, CHI1_ROTAMERS, DEFAULT_FOLD_SEED,
} from './src/utils/disulfideFold.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SEC = read('src/components/NMRSections.jsx');
const DATA = read('src/components/NMRData.jsx');
const VIEW = read('src/components/NMRMoleculeViewer.jsx');

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const DEG = Math.PI / 180;

/* ════════════ 1. LA FENÊTRE DÉTENDUE (pure) ════════════ */
eq(movableResiduesFor([[3, 7]], 9), [2, 3, 4, 5, 6, 7, 8],
  'un pont proche ne détend que la chaîne entre les deux Cys (+ la marge après le second)');
ok(movableResiduesFor([[1, 400]], 400).length <= MAX_MOVABLE_RESIDUES + 1,
  'un pont entre deux Cys très éloignées est PLAFONNÉ (jamais 400 torsions à chercher)');
eq(movableResiduesFor([], 40), [], 'sans pont : rien à détendre');
eq(movableResiduesFor([[2, 6]], 0), [], 'sans modèle : rien à détendre');
eq(movableResiduesFor(null, 40), [], 'une liste absente ne fait pas planter');
ok(movableResiduesFor([[3, 7], [12, 20]], 40).every((i) => Number.isInteger(i) && i >= 0),
  'les indices rendus sont des entiers 0-based');

/* ════════════ 2. L'ÉNERGIE ════════════ */
const modelAt = (sg) => ({ sg, ca: [[1000, 0, 0], [2000, 0, 0], [3000, 0, 0]] });
eq(scoreFold({ pairs: [[1, 2]], model: modelAt([[0, 0, 0], [SS_BOND_LENGTH, 0, 0]]) }), 0,
  'deux Sγ à 2.05 Å : énergie nulle');
ok(scoreFold({ pairs: [[1, 2]], model: modelAt([[0, 0, 0], [6, 0, 0]]) }) > 0,
  '…et une paire étirée coûte');
eq(scoreFold({ pairs: [], model: modelAt([[0, 0, 0], [1, 0, 0]]) }), 0, 'sans pont : énergie nulle');


/* ════════════ 3. LA RECHERCHE, exécutée sur une géométrie JOUET ════════════
   Une chaîne droite dont les deux Sγ sont posés à la main : le second tourne
   sur un cercle de rayon 3 Å centré à 5 Å du premier, donc la distance peut
   VRAIMENT valoir 2.05 Å — le seul cas où le module doit dire « converged ». */
const toyGeometry = (n) => (ts) => {
  const sg = new Array(n).fill(null);
  sg[4] = [0, 0, 0];
  sg[7] = [5 + 3 * Math.cos(ts[6].psi), 3 * Math.sin(ts[6].psi), 0];
  return { sg, ca: ts.map((_, i) => [i * 40, 0, 40]) };    // des Cα au loin : aucun choc parasite
};
const toyBase = Array.from({ length: 12 }, () => ({ phi: Math.PI, psi: Math.PI / 2, chi1: -60 * DEG }));
const toyFrozen = JSON.parse(JSON.stringify(toyBase));
const toyFold = foldProteinForDisulfides({ torsions: toyBase, pairs: [[5, 8]], sgPositions: toyGeometry(12) });
ok(toyFold.converged, `la géométrie jouet est refermée (d = ${toyFold.pairs[0].distance.toFixed(2)} Å)`);
ok(Math.abs(toyFold.pairs[0].distance - SS_BOND_LENGTH) <= SS_BOND_TOLERANCE,
  '…à une distance de LIAISON, pas « quelque part en dessous »');
eq(toyFold.pairs[0].bonded, true, 'et le rapport dit que le pont peut se fermer');
eq(toyBase, toyFrozen, 'les torsions reçues ne sont JAMAIS modifiées (le module travaille sur des copies)');
eq(movableResiduesFor([[5, 8]], 12), toyFold.moved, 'la fenêtre détendue est celle annoncée');

const toyAgain = foldProteinForDisulfides({ torsions: toyBase, pairs: [[5, 8]], sgPositions: toyGeometry(12) });
eq(toyAgain.torsions, toyFold.torsions, 'deux appels identiques donnent le MÊME repliement (graine fixe)');
const otherSeed = foldProteinForDisulfides({ torsions: toyBase, pairs: [[5, 8]], sgPositions: toyGeometry(12), seed: 12345 });
ok(otherSeed.converged, 'une autre graine converge aussi (la recherche n’est pas un coup de chance)');

/* ════════════ 4. CE QU'ELLE DIT QUAND ELLE ÉCHOUE ════════════ */
const far = foldProteinForDisulfides({ torsions: toyBase, pairs: [[1, 12]], sgPositions: toyGeometry(12) });
ok(!far.converged, 'deux Sγ que la fenêtre ne peut pas réunir : converged = false');
ok(far.pairs[0].distance === null || Number.isFinite(far.pairs[0].distance),
  '…mais la distance rendue est un NOMBRE (ou null si le Sγ n’existe pas), jamais NaN');
eq(far.pairs[0].bonded, false, '…et le pont est déclaré non refermé');
const noModel = foldProteinForDisulfides({ torsions: toyBase, pairs: [[1, 2]] });
eq(noModel.reason, 'no-model', 'sans géométrie injectée, le module le dit au lieu de bouger des torsions');
eq(noModel.evaluations, 0, '…et ne coûte rien');
const noPair = foldProteinForDisulfides({ torsions: toyBase, pairs: [], sgPositions: toyGeometry(12) });
eq(noPair.reason, 'no-pair', 'sans paire, rien à faire');
eq(noPair.torsions, toyFrozen, '…et les torsions ressortent telles quelles');
const badPair = foldProteinForDisulfides({ torsions: toyBase, pairs: [[0, 99], ['a', 'b']], sgPositions: toyGeometry(12) });
eq(badPair.reason, 'no-pair', 'une paire hors séquence ou illisible est ignorée (aucun plantage)');
const chiOnly = foldProteinForDisulfides({ torsions: toyBase, pairs: [[5, 8]], sgPositions: toyGeometry(12), movable: [6] });
ok(chiOnly.torsions[6].chi1 !== undefined, 'un χ1 reste un χ1 après la détente');
ok(CHI1_ROTAMERS.every((r) => Number.isFinite(r)), 'les trois rotamères de cystéine sont des angles en degrés');


/* ════════════ 5. LA VRAIE GÉOMÉTRIE : le constructeur de la page ════════════ */
const src = read('src/components/NMRSections.jsx');
const extract = (name) => {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error('missing ' + name);
  const bodyStart = start + `const ${name} = `.length;
  let depth = 0;
  let i = bodyStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  if (i >= src.length) throw new Error('unterminated ' + name);
  return src.slice(start, i + 1) + '\n';
};
const order = ['_vecSub', '_vecAdd', '_vecScale', '_vecDot', '_vecCross', '_vecNorm', '_vecNormalize', '_deg2rad', 'nerfPlace', '_padLeft', '_padRight', '_formatAtomName', '_fmtNum', 'pdbAtomLine', 'AA_1_TO_3', 'PROTEIN_BB', 'SS_TORSIONS', 'ssTorsionAt', '_ringClose', 'placeSidechainAtoms', 'buildProteinBackbone', 'proteinSequenceToPdbText'];
let builderCode = '';
order.forEach((n) => { builderCode += extract(n); });
const B = new Function(builderCode + '\nreturn { proteinSequenceToPdbText, buildProteinBackbone, placeSidechainAtoms, SS_TORSIONS };')();

const parsePdb = (text) => {
  const atoms = [];
  const conectPairs = new Set();
  String(text || '').split(/\r?\n/).forEach((line) => {
    const rec = line.slice(0, 6).trim();
    if (rec === 'ATOM' || rec === 'HETATM') {
      atoms.push({
        serial: parseInt(line.slice(6, 11), 10),
        name: line.slice(12, 16).trim(),
        resName: line.slice(17, 20).trim(),
        resSeq: parseInt(line.slice(22, 26), 10),
        x: parseFloat(line.slice(30, 38)),
        y: parseFloat(line.slice(38, 46)),
        z: parseFloat(line.slice(46, 54)),
      });
    } else if (rec === 'CONECT') {
      const a = parseInt(line.slice(6, 11), 10);
      for (let i = 11; i + 5 <= line.length; i += 5) {
        const b = parseInt(line.slice(i, i + 5), 10);
        if (Number.isFinite(b)) conectPairs.add([a, b].sort((x, y) => x - y).join('|'));
      }
    }
  });
  return { atoms, conectPairs };
};
const position = (a) => [a.x, a.y, a.z];

/* Une hélice avec une Cys en 3 et une en 7 (i, i+4 — le motif classique d'un
   pont dans une hélice) : dans le modèle idéal leurs Sγ sont loin, et le
   repliement doit les réunir. */
const SEQ = 'AACAAACAAACAA';
const SS = 'HHHHHHHHHHHHH';
const helixTorsions = SEQ.split('').map((c, i) => {
  const t = B.SS_TORSIONS[SS[i]] || B.SS_TORSIONS.C;
  return { phi: t.phi, psi: t.psi, chi1: -60 * DEG };
});
const realGeometry = (ts) => {
  const residues = B.buildProteinBackbone(SEQ, ts);
  const sg = new Array(SEQ.length).fill(null);
  residues.forEach((r, i) => {
    if (SEQ[i] !== 'C') return;
    try {
      const sc = B.placeSidechainAtoms('C', r, ts[i]);
      const a = (sc.atoms || []).find((x) => x.name === 'SG');
      if (a) sg[i] = a.pos;
    } catch { /* une Cys sans Sγ ne bloque pas le repliement */ }
  });
  return { sg, ca: residues.map((r) => r.CA) };
};


const idealModel = realGeometry(helixTorsions);
const idealDist = dist(idealModel.sg[2], idealModel.sg[6]);
ok(idealDist > 4, `le modèle idéal laisse les deux Sγ à ${idealDist.toFixed(2)} Å : le pont n'existe pas encore`);

const folded = foldProteinForDisulfides({ torsions: helixTorsions, pairs: [[3, 7]], sgPositions: realGeometry });
ok(folded.converged, `la détente referme le pont de l'hélice (d = ${folded.pairs[0].distance.toFixed(2)} Å)`);
ok(Math.abs(folded.pairs[0].distance - SS_BOND_LENGTH) <= SS_BOND_TOLERANCE, '…à une distance de liaison');
eq(helixTorsions[2].chi1, -60 * DEG, 'et les torsions du modèle idéal restent intactes');

/* ════════════ 6. LE TEXTE PDB PORTE RÉELLEMENT CE S–S ════════════
   On ne croit pas le module sur parole : on RELIT le PDB écrit et on mesure la
   distance entre ses deux Sγ, coordonnées en main. */
const foldedPdb = B.proteinSequenceToPdbText(SEQ, '', 'TEST', { cysDisulfides: [[3, 7]], torsions: folded.torsions });
const foldedModel = parsePdb(foldedPdb);
const sgAt = (model, resSeq) => model.atoms.find((a) => a.name === 'SG' && a.resSeq === resSeq);
const sg3 = sgAt(foldedModel, 3);
const sg7 = sgAt(foldedModel, 7);
ok(!!sg3 && !!sg7, 'le modèle détendu porte bien les deux Sγ du pont');
const writtenSs = dist(position(sg3), position(sg7));
ok(Math.abs(writtenSs - SS_BOND_LENGTH) <= SS_BOND_TOLERANCE,
  `le PDB écrit porte un vrai S–S : ${writtenSs.toFixed(3)} Å`);
ok(foldedModel.conectPairs.has([sg3.serial, sg7.serial].sort((a, b) => a - b).join('|')),
  'les deux Sγ sont joints par un CONECT — le record que NGL dessine');
ok(!foldedModel.conectPairs.has([sgAt(foldedModel, 3).serial, sgAt(foldedModel, 11).serial].sort((a, b) => a - b).join('|')),
  'et la Cys LIBRE n’est jointe à personne');
has(foldedPdb, 'come within bonding distance (Fold for disulfides). Not a physical fold.',
  'le fichier dit lui-même qu’il a été détendu et que ce n’est pas un repliement physique');

/* ════════════ 7. SSBOND (pour les autres outils) ET HG RETIRÉ ════════════ */
const ssbond = foldedPdb.split('\n').find((l) => l.startsWith('SSBOND'));
ok(!!ssbond, 'un record SSBOND est écrit (ce sont les autres logiciels qui le lisent)');
has(ssbond, 'CYS A   3', '…avec le premier résidu du pont');
has(ssbond, 'CYS A   7', '…et le second');

const paired = parsePdb(B.proteinSequenceToPdbText(SEQ, '', 'TEST', { cysDisulfides: [[3, 7]] }));
eq(paired.atoms.filter((a) => a.name === 'HG').map((a) => a.resSeq), [11],
  'seule la Cys LIBRE (11) garde son proton de thiol : un thiol oxydé n’en a pas');
const unpaired = parsePdb(B.proteinSequenceToPdbText(SEQ, '', 'TEST'));
eq(unpaired.atoms.filter((a) => a.name === 'HG').map((a) => a.resSeq), [3, 7, 11],
  'sans pont défini, les trois Cys gardent leur HG (rien ne change pour les autres molécules)');
eq(unpaired.atoms.filter((a) => a.name === 'SG').length, 3, 'et leurs trois Sγ sont là');
ok(unpaired.conectPairs.size > 0, 'les CONECT intra-résidu habituels sont toujours écrits');
eq(parsePdb(B.proteinSequenceToPdbText(SEQ, '', 'TEST', { cysDisulfides: [[3, 7]] })).atoms.filter((a) => a.name === 'HG' && (a.resSeq === 3 || a.resSeq === 7)).length, 0,
  '…et aucune des deux Cys du pont n’en a');

/* Une paire qui ne concerne pas deux cystéines est ignorée par le constructeur
   (résidu qui n'est pas une Cys, position hors séquence) : le modèle doit
   rester celui d'avant, sans CONECT inventé. */
const bogus = parsePdb(B.proteinSequenceToPdbText(SEQ, '', 'TEST', { cysDisulfides: [[3, 4], [0, 99]] }));
eq(bogus.atoms.filter((a) => a.name === 'HG').length, 3, 'une paire illisible ne retire aucun HG');
eq(bogus.conectPairs.size, unpaired.conectPairs.size, '…et n’ajoute aucun CONECT');

/* ════════════ 8. LA DÉFINITION MONTRE LE PONT (et la bande de séquence le marque) ════════════ */
has(SEC, 'const DisulfideBondGlyph = ({ color', 'la définition dessine le pont (composant SVG dédié)');
has(SEC, '<circle cx="18" cy="9" r="4.6" fill={color} />', '…avec les DEUX atomes de soufre');
has(SEC, '<circle cx="28" cy="9" r="4.6" fill={color} />', '…des deux côtés de la liaison');
has(SEC, 'aria-label="Disulphide bond"', '…et le dessin est nommé pour les lecteurs d’écran');
has(SEC, '<DisulfideBondGlyph color={col} title={`Disulphide bond Cys ${noOf(pair[0])} — Cys ${noOf(pair[1])}`} />',
  'la puce d’une paire porte le dessin, entre les DEUX numéros affichés');
has(SEC, 'const pairColor = pairIdx >= 0 ? disulfidePairColor(pairIdx) : null;',
  'chaque Cys appariée connaît la couleur de SON pont');
has(SEC, 'boxShadow: `inset 3px 0 0 ${pairColor}`', '…et sa ligne est marquée de cette couleur');
has(SEC, '<DisulfideBondGlyph color={pairColor} title={`S–S with Cys ${noOf(partner)}`} />',
  'la ligne d’une Cys appariée montre la liaison ET le numéro du partenaire');
has(SEC, 'export const disulfidePairColor = (pairIndex) =>',
  'une seule table de couleurs pour la définition et la bande de séquence');
has(SEC, 'linkOf={(i) => {', 'la bande de séquence reçoit les résidus appariés');
has(SEC, 'return { pairIndex: pi, partner: residueNoOf(partner - 1), color: disulfidePairColor(pi) };',
  '…avec le numéro AFFICHÉ du partenaire (le 🔢, pas la position de séquence)');
has(SEC, 'buildDisulfideFoldedStructure={buildDisulfideFoldedStructure}',
  'la fabrique du modèle détendu part vers le viewer');
has(SEC, 'foldProteinForDisulfides({ torsions: base, pairs, sgPositions })',
  '…et c’est bien le module pur qui détend la chaîne');
has(SEC, 'buildProteinBackbone(d.seq, torsions)', '…en passant les torsions détendues au constructeur NeRF');
has(SEC, '{ cysDisulfides: activeTest.cysDisulfides }',
  'les ponts entrent aussi dans le modèle servi d’office (le CONECT est là sans clic)');

has(DATA, 'residueNo, linkOf }', 'la bande de séquence partagée accepte les ponts');
has(DATA, "const linkAt = typeof linkOf === 'function' ? linkOf : () => null;",
  'sans la prop, la bande ne marque rien (MD et Docking sont intacts)');
has(DATA, 'borderColor: link ? link.color : m.color', 'une Cys appariée prend la couleur de son pont');
has(DATA, '⚭ disulphide with ${link.partner}', 'son infobulle nomme le partenaire');

has(VIEW, 'buildDisulfideFoldedStructure = null,', 'le viewer reçoit la fabrique (optionnelle)');
has(VIEW, 'const foldForDisulfides = () => {', 'et le geste qui la sollicite');
has(VIEW, 'disabled={typeof buildDisulfideFoldedStructure !== \'function\'}',
  'le bouton est inactif quand la page n’a aucun pont à détendre');
has(VIEW, '⚭ Fold for disulfides', 'le bouton est nommé');
has(VIEW, 'flashDisulfideFoldMsg(`${built.note', 'le message affiché est CELUI DE LA PAGE (distance réelle comprise)');
has(VIEW, "'⚠️ Nothing to fold: this condition has no disulphide pair (or no protein sequence).'",
  'et il dit quand il n’y a rien à détendre au lieu de ne rien faire');

console.log(`_disulfide_fold_test.mjs — ${passed} assertions OK`);
