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
     • le module pur utils/disulfideFold.js DÉTEND φ/ψ des résidus entre les deux
       Cys et essaie les trois rotamères χ1 jusqu'à ce que les deux Sγ soient à
       une distance de liaison (2.05 Å ± 0.35). Le modèle écrit alors porte
       RÉELLEMENT ce S–S : le test relit le PDB produit et mesure la distance en
       3D. ⚠ LE BOUTON « ⚭ Fold for disulfides » DU VIEWER A ÉTÉ RETIRÉ cette
       session — la demande : « The “fold for disulphide” button does not work and
       you can eliminate it but keep the “disulphide:shown/hidden” button. » Le
       module et la fabrique de la page sont donc partis avec lui, et les
       assertions qui suivaient le bouton disent maintenant son ABSENCE ;
     • quand la fenêtre déplacée ne suffit pas, le module le DIT
       (`converged: false`) et rend la distance obtenue — il n'invente jamais
       un pont ;
     • la recherche est DÉTERMINISTE (graine fixe) et ne modifie JAMAIS les
       torsions qu'on lui donne ;
     • la DÉFINITION montre la liaison : la puce de paire porte un dessin S–S
       (deux atomes de soufre, la liaison, les deux numéros AFFICHÉS) et la
       bande de séquence marque les Cys appariées de la même couleur.
     • l'interrupteur « ⚭ Disulfides: shown / hidden » du viewer (le rapport :
       « In any case i need a button to switch the display on and off of the
       disulfide bonds ») ne touche QUE le graphe de liaisons de la structure
       affichée : utils/disulfideBonds.js retire les liaisons Sγ–Sγ de DEUX
       RÉSIDUS du bond store au chargement — là où passent les deux autres règles
       de liaisons — donc Sticks / Ball+stick / Lines ne les dessinent plus.
       Ni le fichier, ni le texte servi par la page, ni le 📥 Download, ni la
       copie Drive, ni « Cysteine states » ne perdent quoi que ce soit ; et le
       compte rendu DIT la distance Sγ–Sγ de chaque pont, un pont étiré compris
       (la réponse chiffrée à « you did not fold the structure to bring the
       cysteines at bond distance »).

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
  SS_BOND_LENGTH, SS_BOND_TOLERANCE, SS_DRIVE_WEIGHT, MAX_MOVABLE_RESIDUES, CHI1_ROTAMERS, DEFAULT_FOLD_SEED,
  stretchedDisulfideTermsOf, isStretchedDisulfideBond, withoutStretchedDisulfideBonds,
} from './src/utils/disulfideFold.js';
// Le lecteur des canaux de torsion : c'est lui qui mesure qu'un pont déclaré BLOQUE le
// rapprochement des deux Sγ (les charnières du segment passent pour des liaisons de cycle).
import { rotatableBondsOf } from './src/utils/structureCalc.js';
// ⚭ « Disulfides: shown / hidden » — la règle qui RETIRE un pont du graphe de
// liaisons de la structure affichée (module pur, aucun import).
import { applyDisulfideDisplay, disulfideBondIndices, SG_ATOM_NAME } from './src/utils/disulfideBonds.js';

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
/* ⚠ LE BOUTON « ⚭ Fold for disulfides » A ÉTÉ RETIRÉ (demande de la session) :
   la fabrique de la page appelait le module pur, ce bouton l'appelait, et les
   deux sont partis ensemble. Ce qui reste VRAI et continue d'être vérifié :
   le module pur (sections 1 à 8) et l'interrupteur du DESSIN (section 9). */
ok(!SEC.includes('const buildDisulfideFoldedStructure = useCallback'),
  'la page ne fabrique plus de modèle détendu (la fabrique est partie avec le bouton)');
ok(!SEC.includes('foldProteinForDisulfides({'),
  '…et n’importe donc plus utils/disulfideFold.js');
ok(!SEC.includes('buildDisulfideFoldedStructure={'),
  '…et ne passe plus aucune fabrique au viewer');
ok(!VIEW.includes('buildDisulfideFoldedStructure'),
  'le viewer ne reçoit plus cette fabrique');
ok(!VIEW.includes('foldForDisulfides'),
  '…et le geste qui la sollicitait a disparu');
ok(!VIEW.includes('⚭ Fold for disulfides\n'),
  'le bouton ⚭ Fold for disulfides n’est plus rendu\n');
has(SEC, '{ cysDisulfides: activeTest.cysDisulfides }',
  'les ponts entrent aussi dans le modèle servi d’office (le CONECT est là sans clic)');

has(DATA, 'residueNo, linkOf }', 'la bande de séquence partagée accepte les ponts');
has(DATA, "const linkAt = typeof linkOf === 'function' ? linkOf : () => null;",
  'sans la prop, la bande ne marque rien (MD et Docking sont intacts)');
has(DATA, 'borderColor: link ? link.color : m.color', 'une Cys appariée prend la couleur de son pont');
has(DATA, '⚭ disulphide with ${link.partner}', 'son infobulle nomme le partenaire');

/* ⚠ Les six assertions du BOUTON ⚭ Fold for disulfides ont disparu avec lui : il
   n'y a plus de prop `buildDisulfideFoldedStructure`, plus de `foldForDisulfides`,
   plus de `flashDisulfideFoldMsg` ni de bouton à désactiver. Le gesture est
   REDEVENU impossible — c'est la demande — et le module pur reste testé plus haut. */

/* ════════════ 9. ⚭ « Disulfides: shown / hidden » : LA RÈGLE DU GRAPHE ════════════
   Cacher un S–S ne peut pas passer par le TEXTE : la passe de distances de NGL
   (inferBonds:'all', le défaut du parseur PDB) redessinerait le pont dès que les
   deux Sγ sont dans la fenêtre covalente. La règle travaille donc sur le GRAPHE
   de la structure chargée — la compaction du bond store que la maison utilise
   déjà pour ses deux autres règles de liaisons. Ce que le test exécute : le cœur
   pur (disulfideBondIndices) sur les VRAIS modèles construits plus haut, puis
   l'enveloppe (applyDisulfideDisplay) sur une structure jouet dont on connaît le
   graphe, atome par atome. */
const RULE_SRC = read('src/utils/disulfideBonds.js');
ok(!/^import\s/m.test(RULE_SRC), 'le module de la règle est PUR (aucun import), comme les autres utils');

// Le graphe d'un modèle PDB lu par le test : les liaisons par INDICES d'atomes.
const graphOf = (model) => {
  const indexOf = new Map(model.atoms.map((a, i) => [a.serial, i]));
  return {
    atoms: model.atoms.map((a) => ({
      name: a.name, resno: a.resSeq, chain: 'A', icode: '', resname: a.resName, pos: position(a),
    })),
    bonds: [...model.conectPairs].map((k) => k.split('|').map((s) => indexOf.get(Number(s)))),
  };
};
const sgPairsOf = (g) => disulfideBondIndices(g.atoms, g.bonds).map((k) => g.bonds[k]);
const pairResnos = (g, bonds) => bonds.map(([i, j]) => [g.atoms[i].resno, g.atoms[j].resno].sort((a, b) => a - b));

// (a) le modèle qui porte le pont défini : UNE liaison Sγ–Sγ inter-résidus — et
//     elle seule (les trois Cys sont là, mais Cβ–Sγ n'est pas un pont).
const pairedGraph = graphOf(paired);
eq(sgPairsOf(pairedGraph).length, 1, 'le modèle de la page dessine EXACTEMENT un pont (Sγ–Sγ)');
eq(pairResnos(pairedGraph, sgPairsOf(pairedGraph)), [[3, 7]], '…entre les deux Cys définies (3 et 7), et aucune autre');
eq(pairedGraph.atoms.filter((a) => a.name === SG_ATOM_NAME).length, 3, 'les trois Sγ du modèle sont bien lus');
// (b) sans pont défini : aucun S–S à cacher, mêmes Sγ pourtant.
const unpairedGraph = graphOf(unpaired);
eq(sgPairsOf(unpairedGraph), [], 'sans paire définie, la règle ne trouve AUCUN pont (rien à cacher)');
// (c) ce qui n'est PAS un pont : le Sγ lié à son propre Cβ, et deux SG d'un
//     même résidu (le résidu, c'est chaîne + numéro + code d'insertion).
const cbsg = pairedGraph.bonds.findIndex(([i, j]) => {
  const a = pairedGraph.atoms[i];
  const b = pairedGraph.atoms[j];
  return a.resno === b.resno && [a.name, b.name].sort().join('|') === 'CB|SG';
});
ok(cbsg >= 0 && !disulfideBondIndices(pairedGraph.atoms, pairedGraph.bonds).includes(cbsg),
  'une liaison Cβ–Sγ n’est pas un pont (ses deux atomes ne sont pas deux Sγ)');
const sameResidue = { atoms: [{ name: 'SG', resno: 5, chain: 'A' }, { name: 'SG', resno: 5, chain: 'A' }], bonds: [[0, 1]] };
eq(disulfideBondIndices(sameResidue.atoms, sameResidue.bonds), [], 'deux SG du MÊME résidu ne sont pas un pont');
const twoChains = { atoms: [{ name: 'SG', resno: 5, chain: 'A' }, { name: 'SG', resno: 5, chain: 'B' }], bonds: [[0, 1]] };
eq(disulfideBondIndices(twoChains.atoms, twoChains.bonds), [0],
  'même numéro sur deux chaînes = deux résidus : un vrai pont');
const spreadNames = [{ name: ' sg ', resno: 1, chain: 'A' }, { name: 'SG', resno: 2, chain: 'A' }];
eq(disulfideBondIndices(spreadNames, [[0, 1]]), [0], 'le nom d’atome est lu comme PDB l’écrit (espaces compris)');
eq(disulfideBondIndices([], []), [], 'sans atome ni liaison, la règle ne rend rien');
eq(disulfideBondIndices(null, null), [], '…même quand ses arguments manquent');

/* ---- (d) l'enveloppe : le bond store d'une structure jouet -----------------
   Le même contrat que les deux autres règles : getAtomProxy pour les atomes, le
   bond store (tableau plat + count) pour les liaisons, finalizeBonds() pour les
   lecteurs qui passent par le bond set. */
const fakeStructure = (atoms, bonds) => {
  const store = {
    atomIndex1: new Int32Array(Math.max(4, bonds.length + 2)),
    atomIndex2: new Int32Array(Math.max(4, bonds.length + 2)),
    bondOrder: new Int32Array(Math.max(4, bonds.length + 2)).fill(1),
    count: bonds.length,
  };
  bonds.forEach(([i, j], k) => { store.atomIndex1[k] = i; store.atomIndex2[k] = j; });
  const proxy = {
    index: 0,
    get atomname() { return atoms[this.index].name; },
    get element() { return atoms[this.index].element || atoms[this.index].name[0]; },
    get resname() { return atoms[this.index].resname || 'CYS'; },
    get resno() { return atoms[this.index].resno; },
    get icode() { return atoms[this.index].icode || ''; },
    get chainname() { return atoms[this.index].chain || 'A'; },
    get x() { return atoms[this.index].pos[0]; },
    get y() { return atoms[this.index].pos[1]; },
    get z() { return atoms[this.index].pos[2]; },
  };
  return {
    atomCount: atoms.length,
    bondStore: store,
    bondCount: bonds.length,
    finalizeCount: 0,
    getAtomProxy: () => proxy,
    finalizeBonds() { this.finalizeCount += 1; },
  };
};
const storePairs = (s) => Array.from({ length: s.bondStore.count }, (_, k) => `${s.bondStore.atomIndex1[k]}|${s.bondStore.atomIndex2[k]}`);

const toyAtoms = [
  { name: 'CB', resno: 3, chain: 'A', pos: [0, 0, 0] },
  { name: 'SG', resno: 3, chain: 'A', pos: [1, 0, 0] },
  { name: 'CB', resno: 7, chain: 'A', pos: [0, 5, 0] },
  { name: 'SG', resno: 7, chain: 'A', pos: [1, 5, 0] },
];
const toyBonds = [[0, 1], [1, 3], [2, 3]];        // Cβ–Sγ · LE PONT Sγ–Sγ · Cβ–Sγ
const shownToy = fakeStructure(toyAtoms, toyBonds);
const shownReport = applyDisulfideDisplay(shownToy, { hidden: false });
eq(shownReport.removed, 0, 'montrés : la règle ne retire RIEN du graphe');
eq(shownReport.bonds.length, 1, '…mais elle rapporte le pont (le bouton sait ce qu’il cachera)');
eq([shownReport.bonds[0].resno1, shownReport.bonds[0].resno2], [3, 7], '…avec ses deux résidus');
eq(shownReport.bonds[0].distance, 5, '…et la distance Sγ–Sγ RÉELLE de la géométrie servie (5 Å ici)');
eq(storePairs(shownToy), ['0|1', '1|3', '2|3'], '…et le graphe est intact');
const hiddenToy = fakeStructure(toyAtoms, toyBonds);
const hiddenReport = applyDisulfideDisplay(hiddenToy, { hidden: true });
eq(hiddenReport.removed, 1, 'cachés : le pont sort du graphe');
eq(hiddenReport.bonds.length, 1, '…le compte rendu le nomme quand même (on peut donc le remettre)');
eq(storePairs(hiddenToy), ['0|1', '2|3'], '…et seules les deux liaisons Cβ–Sγ restent');
eq(hiddenToy.bondStore.count, 2, 'le compte du store est baissé (c’est lui qu’un lecteur voit)');
eq(hiddenToy.bondCount, 2, '…et celui de la structure aussi');
eq(hiddenToy.finalizeCount, 1, '…et le bond set est remis d’aplomb (finalizeBonds)');
const noBridge = fakeStructure(toyAtoms, [[0, 1], [2, 3]]);
eq(applyDisulfideDisplay(noBridge, { hidden: true }), { bonds: [], removed: 0 },
  'sans pont, cacher ne change RIEN — et le dit');
eq(storePairs(noBridge).length, 2, '…le graphe restant est intact');
eq(applyDisulfideDisplay(null), { bonds: [], removed: 0 }, 'une structure absente ne fait pas planter la règle');
eq(applyDisulfideDisplay({ atomCount: 0, bondStore: { count: 0 } }), { bonds: [], removed: 0 },
  'une structure vide est ignorée');

/* ---- (d2) LE PONT ÉTIRÉ, CONDUIT À SA LONGUEUR DE LIAISON ──────────────────
   La demande de cette session, mot pour mot : « … When I do MD or energy minimization or
   structure calculation this long non realistic bond does not change and forces the
   structure in an elongated form. I only want the disulphide to be at the default bond
   length after minimization. »

   POURQUOI CE TERME EXISTE : les moteurs du champ FIGENT la famille « liaisons » (une
   torsion rigide ne change pas une longueur — `engine.constants` de
   utils/structureCalc.js), donc un pont à 10 Å pèse dans le score sans qu'aucun mouvement
   ne rapproche jamais les deux Sγ. Le pont est donc porté par un terme de DISTANCE, celui
   que les moteurs relisent à chaque image — et c'est ce que cette fonction rend. */
const bridgesOf = (list) => list.map((b) => ({ atomIndex1: b[0], atomIndex2: b[1], distance: b[2] }));
eq(stretchedDisulfideTermsOf(), [], 'sans pont : aucun terme — rien à conduire');
eq(stretchedDisulfideTermsOf({ bridges: null }), [], 'une liste absente ne fait pas planter la règle');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[4, 300, 10.4]]) }),
  [{ i: 4, j: 300, target: SS_BOND_LENGTH, weight: SS_DRIVE_WEIGHT }],
  '⚠ un pont à 10,4 Å rend UN terme de distance visé à la LONGUEUR DE LA LIAISON (2.05 Å) — jamais à la distance trouvée');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[4, 300, SS_BOND_LENGTH]]) }), [],
  '…et un pont DÉJÀ fermé n’en rend aucun : sa vraie liaison le tient, le conduire serait compter deux fois');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[4, 300, SS_BOND_LENGTH + SS_BOND_TOLERANCE - 0.01]]) }), [],
  'la fenêtre de fermeture est celle du repliement : un cheveu SOUS la limite de tolérance, le pont est encore un pont');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[4, 300, SS_BOND_LENGTH + SS_BOND_TOLERANCE + 0.01]]) }).length, 1,
  '…un cheveu au-delà, il est ÉTIRÉ et se conduit (donc les deux Sγ se rapprochent)');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[4, 300, null], [4, 4, 9], ['a', 2, 9], [4, 300, 9]]) }),
  [{ i: 4, j: 300, target: SS_BOND_LENGTH, weight: SS_DRIVE_WEIGHT }],
  '⚠ un pont sans distance, un atome sur lui-même et un indice illisible sont ÉCARTÉS — il ne reste que le pont étiré');
eq(stretchedDisulfideTermsOf({ bridges: bridgesOf([[1, 2, 9]]), length: 1.5, tolerance: 0.1, weight: 3 }),
  [{ i: 1, j: 2, target: 1.5, weight: 3 }],
  'la longueur, la fenêtre et le poids sont ceux qu’on donne (le module n’impose rien)');

/* ---- (e) le viewer : le bouton, le geste, le compte rendu ------------------ */
has(VIEW, "import { applyDisulfideDisplay } from '../utils/disulfideBonds';", 'le viewer importe la règle');
has(VIEW, 'SS_BOND_LENGTH, SS_BOND_TOLERANCE, stretchedDisulfideTermsOf,',
  '⚠ …ET la fonction qui CONDUIT un pont étiré : la fenêtre de liaison est CELLE du repliement (une seule définition de « pont fermé », un seul conducteur)');
has(VIEW, "} from '../utils/disulfideFold';", '…du module du pont, avec le reste de ses lectures');
/* ⚠ LE PONT ÉTIRÉ EST CONDUIT PAR LES QUATRE GESTES — « I only want the disulphide to be at
   the default bond length after minimization. » Le terme ajouté l'est dans la fabrique
   UNIQUE des contraintes (voir _structure_calculation_test.mjs §la table), donc ▶ Run,
   ▶ MD, ⚒ Minimise et ⟳ Energy le reçoivent ensemble, sans qu'aucun ne le recopie. */
has(VIEW, 'stretchedDisulfideTermsOf({ bridges: disulfideDrawnRef.current.bonds })',
  '⚠ le pont étiré entre dans les contraintes par un terme de distance (les moteurs FIGENT la famille « liaisons » : sans ce terme, les deux Sγ ne se rapprocheraient jamais)');
has(VIEW, 'const disulfideConductedNote = () => {',
  '…et les gestes qui le conduisent le DISENT (le rapport compte alors une distance de plus que la table)');
has(VIEW, 'applyDisulfideDisplay(component, { hidden: !disulfidesShownRef.current })',
  'la règle est appliquée au CHARGEMENT, avant qu’une représentation ne lise le graphe');
ok(VIEW.indexOf('applyDisulfideDisplay(component') > VIEW.indexOf('try { enforceCovalentProteinBonds(component); }'),
  '…à la suite des deux autres règles de liaisons, dans le même entonnoir de chargement');
has(VIEW, 'const [disulfidesShown, setDisulfidesShown] = useState(true);',
  'le pont est AFFICHÉ par défaut (rien ne bouge tant que le bouton n’est pas cliqué)');
has(VIEW, 'const toggleDisulfideBonds = () => {', 'le geste existe');
has(VIEW, "{disulfidesShown ? '⚭ Disulfides: shown' : '⚭ Disulfides: hidden'}", 'le bouton dit SON état');
has(VIEW, 'disabled={disulfideDrawn.bonds.length === 0}',
  'le bouton est inactif quand la structure à l’écran ne dessine aucun pont');
has(VIEW, "flashDisulfideShowMsg('⚠️ No disulphide bond is drawn in this model — nothing to hide.",
  '…et le geste le DIT au lieu de ne rien faire');
has(VIEW, 'requestStructureLoad({ ...(loadRequest || {}), ts: Date.now() });',
  'cacher — puis remontrer — ressert LE MÊME modèle (l’entonnoir du ⚗️ rebuild des hydrogènes)');
has(VIEW, '⚠️ drawn but stretched (the two Sγ are not at bonding distance)',
  'un pont dessiné mais ÉTIRÉ est dit tel : sa distance réelle, pas une promesse');
has(VIEW, 'drawn but STRETCHED: the two Sγ are further apart than the S–S bond length',
  '…et le compte rendu dit qu’un pont étiré n’est PAS une liaison (le bouton qui essayait de le fermer a été retiré)');
has(VIEW, 'const describeDisulfideBond = (b) => {', '…par une seule description, pont par pont');
// La DÉFINITION reste à la page : le viewer ne touche pas au modèle qu’elle écrit.
has(SEC, 'cysDisulfides.forEach(([a, b]) => emitBond(`SG@${a - 1}`, `SG@${b - 1}`));',
  'la page écrit toujours le CONECT du pont : l’interrupteur ne touche que le DESSIN');

/* ---- (d3) LA FAUSSE LIAISON DU PONT ÉTIRÉ, RETIRÉE DU GRAPHE DES MOTEURS ------------
   Le second rapport de cette session : « when a disulphide is declared this long bond
   created by two far cysteines seems blocked and can never approach the custom
   disulphide distance ». Le terme de distance de (d2) ne suffisait donc PAS, et voici
   pourquoi : le CONECT SG–SG que la page écrit pour qu'NGL DESSINE le pont REFERME le
   graphe sur un macrocycle — toutes les charnières du segment entre les deux Cys passent
   pour des liaisons de CYCLE (`rotatableBondsOf`), sortent du tirage, et plus AUCUN canal
   ne peut changer la distance Sγ–Sγ. `withoutStretchedDisulfideBonds` rend le graphe des
   moteurs : les deux Cys peuvent enfin se rapprocher. */
const gBond = (i, j) => ({ i, j, order: 1 });
const plainBonds = [gBond(0, 1), gBond(1, 2), gBond(2, 3)];
/* La chaîne refermée par la « liaison » du pont déclaré : c'est CETTE arête-là (0–3) que
   le filtre doit retirer, et c'est elle qui fait tout passer pour un cycle. */
const ringBonds = plainBonds.concat([gBond(0, 3)]);
ok(withoutStretchedDisulfideBonds({ bonds: plainBonds }) === plainBonds,
  'sans pont : la liste reçue est rendue TELLE QUELLE (aucune copie dans le cas ordinaire)');
eq(withoutStretchedDisulfideBonds({
  bonds: ringBonds, bridges: bridgesOf([[3, 0, 12.4]]),
}), plainBonds,
  '⚠ la liaison SG–SG d’un pont ÉTIRÉ est RETIRÉE — quel que soit l’ordre des deux atomes');
eq(withoutStretchedDisulfideBonds({ bonds: ringBonds, bridges: bridgesOf([[0, 3, SS_BOND_LENGTH]]) }),
  ringBonds, '⚠ …et un pont FERMÉ garde la sienne : c’est une VRAIE liaison S–S, elle tient les deux Sγ');
eq(withoutStretchedDisulfideBonds({ bonds: [[0, 1], [1, 2], [0, 2]], bridges: bridgesOf([[2, 0, 9]]) }),
  [[0, 1], [1, 2]],
  'les liaisons écrites [[i, j]] sont filtrées comme les {i, j} (les deux écritures du dossier)');
eq(withoutStretchedDisulfideBonds({ bonds: [[0, 1, 2], [1, 2, 1], [0, 2, 1]], bridges: bridgesOf([[0, 2, 9]]) }),
  [[0, 1, 2], [1, 2, 1]],
  '…et celles qui portent leur ordre aussi');
eq(withoutStretchedDisulfideBonds({ bonds: ringBonds, bridges: [{ atomIndex1: 0, atomIndex2: 3, distance: null }] }),
  ringBonds, 'un pont SANS coordonnées ne retire rien : il n’y a aucune distance à juger');
eq(withoutStretchedDisulfideBonds({ bonds: ringBonds, bridges: bridgesOf([[9, 9, 9]]) }), ringBonds,
  '…et un pont dégénéré (deux fois le même atome) non plus');
eq([isStretchedDisulfideBond(bridgesOf([[0, 2, 20]])[0]), isStretchedDisulfideBond(bridgesOf([[0, 2, 2.0]])[0]),
  isStretchedDisulfideBond(null), isStretchedDisulfideBond({ atomIndex1: 0 })], [true, false, false, false],
  'le prédicat « ce pont est ÉTIRÉ » est UN seul, partagé par le terme de conduite et par le filtre');

/* ---- (d4) LE VRAI MODÈLE DE LA PAGE, MESURÉ ----------------------------------------
   Deux Cys LOIN l'une de l'autre (3 et 11 d'une chaîne couchée) : le modèle de la page
   porte alors un CONECT SG–SG de plus de vingt ångströms. On relit le PDB ÉCRIT (son
   graphe de liaisons compris) et on COMPTE les canaux de torsion qui séparent les deux
   Sγ — avec la liaison, puis avec le graphe des moteurs. */
const farPdb = B.proteinSequenceToPdbText(SEQ, 'CCCCCCCCCCCCC', 'TEST', { cysDisulfides: [[3, 11]] });
const farModel = parsePdb(farPdb);
const farIndex = new Map(farModel.atoms.map((a, k) => [a.serial, k]));
const farBonds = [];
farModel.conectPairs.forEach((pair) => {
  const [a, b] = pair.split('|').map(Number);
  if (farIndex.has(a) && farIndex.has(b)) farBonds.push(gBond(farIndex.get(a), farIndex.get(b)));
});
const sgFarI = farModel.atoms.findIndex((a) => a.name === 'SG' && a.resSeq === 3);
const sgFarJ = farModel.atoms.findIndex((a) => a.name === 'SG' && a.resSeq === 11);
const farAtoms = farModel.atoms.length;
const farElements = farModel.atoms.map((a) => a.name.replace(/[^A-Za-z]/g, '')[0]);
const farSpan = dist(position(farModel.atoms[sgFarI]), position(farModel.atoms[sgFarJ]));
ok(farSpan > 10, `le modèle de la page déclare un pont ÉTIRÉ : les deux Sγ sont à ${farSpan.toFixed(2)} Å`);
ok(farBonds.some((b) => (b.i === sgFarI && b.j === sgFarJ) || (b.i === sgFarJ && b.j === sgFarI)),
  '…et sa liaison SG–SG est bien dans le graphe relu (c’est ce CONECT qui fait dessiner le pont)');
const farReadOf = (list) => rotatableBondsOf({ elements: farElements, bonds: list, atomCount: farAtoms });
const separates = (read) => read.channels
  .filter((c) => c.moving.includes(sgFarI) !== c.moving.includes(sgFarJ)).length;
const farWith = farReadOf(farBonds);
const farEngineBonds = withoutStretchedDisulfideBonds({
  bonds: farBonds, bridges: [{ atomIndex1: sgFarI, atomIndex2: sgFarJ, distance: farSpan }],
});
eq(farEngineBonds.length, farBonds.length - 1, 'le filtre retire UNE arête, et c’est celle du pont');
const farWithout = farReadOf(farEngineBonds);
eq(separates(farWith), 0,
  '⚠ AVEC elle, AUCUN canal ne sépare les deux Sγ : le pont ne peut pas se rapprocher, quelle que soit la contrainte');
ok(separates(farWithout) > 0,
  `…SANS elle, ${separates(farWithout)} canaux les séparent : les charnières du segment redeviennent des dièdres`);
ok(farWithout.count > farWith.count,
  `…et le graphe des moteurs a plus de charnières que celui du dessin (${farWith.count} → ${farWithout.count})`);

console.log(`_disulfide_fold_test.mjs — ${passed} assertions OK`);


