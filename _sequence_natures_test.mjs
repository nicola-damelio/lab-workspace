/* =========================================================================
   _sequence_natures_test.mjs — LA SÉQUENCE PAR NATURE : ouvrir un fichier qui
   contient une protéine ET un acide nucléique ne doit plus jeter la séquence de
   l'ADN / de l'ARN dans la case « Proteins ».

   Ce que ce fichier protège :

     • le viewer classe CHAQUE résidu polymère par NATURE — protéine · ADN · ARN —
       à partir du NOM du résidu, et pour les lettres de base nues (A · C · G · T ·
       U) ainsi que pour les nucléotides MODIFIÉS, à partir des atomes du résidu :
       le 2'-oxygène (O2') est là dans un ribose et absent d'un désoxyribose —
       c'est exactement la distinction ARN / ADN, sans table à maintenir ;
     • il remet à sa page UNE séquence PAR NATURE (`structureSequenceParts`) en
       même temps que la séquence complète : `onStructureSequence(seq, parts)` ;
     • la page range chaque nature dans SON champ (utils/sequenceNatures.js) :
       protéine → `proteinSequence`, ADN / ARN → `nucleicSequences.dna` / `.rna`,
       sans jamais écraser un champ déjà rempli, et sans jamais perdre la
       séquence d'une condition ancienne (repli, puis déplacement à la première
       modification qui la concerne) ;
     • la case de saisie ET les tableaux lisent la séquence DE LA NATURE
       affichée (`d.rawSequence` / `d.seq`), donc cliquer « DNA » montre la
       séquence d'ADN du fichier chargé ;
     • le bandeau de séquence groupe ses résidus par nature (Proteins · DNA ·
       RNA) quand le fichier en contient plusieurs ;
     • LE FICHIER RESTE UN SEUL OBJET DANS UN SEUL VIEWER : la répartition ne
       touche QUE l'endroit où une lettre est rangée, jamais ce qui est dessiné.

   Le classement est éprouvé sur de VRAIES structures : les gabarits que
   l'application embarque (template_amino_acid.pdb, template_nucleotide_dna.pdb,
   template_nucleotide_rna.pdb) réassemblés en un complexe protéine + ADN + ARN,
   parsé par le VRAI NGL (2.4.0) — comme le fait la page.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as NAT from './src/utils/sequenceNatures.js';

const require = createRequire(import.meta.url);
const NGL = require('ngl');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
const NMR = read('./src/components/NMRSections.jsx');
const MD = read('./src/components/MDSections.jsx');
const DOCK = read('./src/components/DockingSections.jsx');
const SHELL = read('./src/components/TestShellRenderer.jsx');
const NMRR = read('./src/components/NMRTestRenderer.jsx');
const NB = read('./src/components/LabNotebook.jsx');
const has = (src, needle, what) => ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (src, needle, what) => ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction des helpers du viewer (voir _viewer_scheme_test.mjs) ─────── */
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const offset = src.slice(arrow + 2).search(/\S/);
  const body = arrow + 2 + offset;
  assert.equal(src[body], '{', `${name} : corps bloc attendu`);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : corps non terminé`);
};
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : non terminé`);
};
// Une flèche à CORPS D'EXPRESSION (une ligne, sans point-virgule interne).
const sliceArrow = (name) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(VIEW);
  assert.ok(!!m, `flèche ${name} introuvable`);
  return `const ${name} = ${m[1]};`;
};

/* ══ 1. LA TABLE DES NATURES (utils/sequenceNatures.js, module réel) ═══════ */
eq(NAT.SEQUENCE_NATURES, ['protein', 'dna', 'rna'], 'les trois natures polymères, dans l’ordre d’affichage');
eq(NAT.NUCLEIC_SEQUENCES_KEY, 'nucleicSequences', 'le magasin des natures nucléiques');
eq(NAT.isNucleicType('DNA'), true, 'une nature se lit sans tenir compte de la casse');
eq(NAT.isNucleicType('fragment'), false, '…et rien d’autre n’est un acide nucléique');
ok(NAT.isPolymerType('protein') && NAT.isPolymerType('rna') && !NAT.isPolymerType('sugar'),
  'les seules conditions servies par une séquence sont les trois polymères');

// 1a. Lecture : la condition ancienne (un seul champ) reste lisible telle quelle.
eq(NAT.sequenceForMoleculeType({ proteinSequence: 'MKWV' }, 'protein'), 'MKWV', 'une protéine lit `proteinSequence`');
eq(NAT.sequenceForMoleculeType({ proteinSequence: 'ATGCC' }, 'dna'),
  'ATGCC', 'une condition ANCIENNE garde sa séquence d’ADN (repli, rien n’est perdu)');
eq(NAT.sequenceForMoleculeType({ proteinSequence: 'AUGCC' }, 'rna'), 'AUGCC', '…idem pour l’ARN');
eq(NAT.sequenceForMoleculeType({}, 'dna'), '', 'sans rien, une case vide');
// 1b. …mais dès que les natures ont été classées, chaque case dit la vérité :
//     une séquence protéique ne s'affiche JAMAIS sous DNA / RNA.
const classified = { proteinSequence: 'MKWV', nucleicSequences: { dna: 'ACGT' } };
eq(NAT.sequenceForMoleculeType(classified, 'dna'), 'ACGT', 'l’ADN classé a son propre champ');
eq(NAT.sequenceForMoleculeType(classified, 'rna'), '', 'une nature absente du fichier laisse la case VIDE');
eq(NAT.sequenceForMoleculeType(classified, 'protein'), 'MKWV', 'la protéine garde la sienne');

// 1c. Écriture : chaque nature écrit dans son champ.
eq(NAT.sequencePatchForMoleculeType({}, 'protein', 'MKWV'),
  { proteinSequence: 'MKWV' }, 'taper une protéine écrit `proteinSequence` (comme toujours)');
eq(NAT.sequencePatchForMoleculeType({}, 'dna', 'ACGT'),
  { nucleicSequences: { dna: 'ACGT' } }, 'taper un ADN écrit le magasin, pas la case des protéines');
eq(NAT.sequencePatchForMoleculeType(classified, 'rna', 'AUGC'),
  { nucleicSequences: { dna: 'ACGT', rna: 'AUGC' } }, '…et n’efface pas la nature déjà rangée');
// Une condition ancienne en ADN : la première modification DÉPLACE la séquence
// (même nature) vers le champ de sa nature — « Proteins » cesse de la montrer.
eq(NAT.sequencePatchForMoleculeType({ proteinSequence: 'ATGCC' }, 'dna', 'ATGCCA'),
  { nucleicSequences: { dna: 'ATGCCA' }, proteinSequence: '' },
  'la séquence d’ADN héritée est déplacée dans son champ');
// …mais une VRAIE séquence protéique n'est jamais effacée par une saisie d'ADN.
eq(NAT.sequencePatchForMoleculeType({ proteinSequence: 'MKWV' }, 'dna', 'ACGT'),
  { nucleicSequences: { dna: 'ACGT' } }, 'aucun champ protéique touché quand il ne contient pas d’ADN');

/* ══ 2. LE PATCH DE CHARGEMENT : UNE NATURE, UN CHAMP ═════════════════════ */
const partsMixed = {
  protein: { seq: 'MK', len: 2, chains: ['A'] },
  dna: { seq: 'ACGT', len: 4, chains: ['B', 'C'] },
  rna: { seq: 'AUGC', len: 4, chains: ['D'] },
};
const fresh = NAT.structureSequencePatch({}, 'protein', 'MKACGT', partsMixed);
eq(fresh.proteinSequence, 'MK', 'la partie protéique va dans `proteinSequence`');
eq(fresh.nucleicSequences, { dna: 'ACGT', rna: 'AUGC' }, 'chaque acide nucléique va dans son propre champ');
eq(fresh.structureSeqNatures, {
  protein: { len: 2, chains: ['A'] },
  dna: { len: 4, chains: ['B', 'C'] },
  rna: { len: 4, chains: ['D'] },
}, '…et la page sait ce que le fichier contenait (pour le dire à l’écran)');

// Rien n'est jamais écrasé : ce que l'utilisateur a tapé reste maître.
const filled = { proteinSequence: 'MKWVTF', nucleicSequences: { dna: 'AAAA' } };
eq(NAT.structureSequencePatch(filled, 'protein', 'MKACGT', partsMixed).proteinSequence, undefined,
  'un champ protéique déjà rempli n’est pas écrasé');
eq(NAT.structureSequencePatch(filled, 'protein', 'MKACGT', partsMixed).nucleicSequences.dna, 'AAAA',
  'un ADN déjà rangé n’est pas écrasé non plus');
eq(NAT.structureSequencePatch(filled, 'protein', 'MKACGT', partsMixed).nucleicSequences.rna, 'AUGC',
  '…mais la nature encore vide, si');

// Un fichier d'ADN SEUL ne met RIEN dans la case des protéines.
const dnaOnly = NAT.structureSequencePatch({}, 'protein', 'ACGT', { dna: { seq: 'ACGT', len: 4, chains: ['B'] } });
eq(dnaOnly.proteinSequence, undefined, 'une protéine absente du fichier laisse la case « Proteins » vide');
eq(dnaOnly.nucleicSequences, { dna: 'ACGT' }, 'la séquence d’ADN est rangée sous DNA');

// Les conditions non polymères ne reçoivent jamais de séquence.
eq(NAT.structureSequencePatch({}, 'sugar', 'ACGT', partsMixed), null, 'un sucre n’a pas de séquence');
eq(NAT.structureSequencePatch({}, 'organic', 'CC(=O)O', null), null, 'un SMILES non plus');

// Un viewer ancien (ou un fichier non classable) : comportement historique.
eq(NAT.structureSequencePatch({}, 'protein', 'MKWVACGT', null), { proteinSequence: 'MKWVACGT' },
  'sans classement, le texte entier va dans `proteinSequence` comme avant');
eq(NAT.structureSequencePatch({ proteinSequence: 'DEJA' }, 'protein', 'MKWVACGT', null), null,
  '…et seulement quand la case est vide');

/* ══ 3. LA PHRASE À L'ÉCRAN ═══════════════════════════════════════════════ */
eq(NAT.sequenceNaturesNote({}, 'protein'), null, 'aucun fichier classé : rien à expliquer');
eq(NAT.sequenceNaturesNote({ structureSeqNatures: { protein: { len: 2, chains: ['A'] } } }, 'protein'), null,
  'un fichier d’UNE nature déjà affichée : rien à expliquer');
const mixedNote = NAT.sequenceNaturesNote({ structureSeqNatures: partsMixed }, 'protein');
ok(mixedNote.includes('Proteins (2 aa)') && mixedNote.includes('DNA (4 nt)') && mixedNote.includes('RNA (4 nt)'),
  'la phrase nomme chaque nature avec sa longueur et son unité');
ok(mixedNote.includes('chain A') && mixedNote.includes('chains B, C') && mixedNote.includes('chain D'),
  '…et les chaînes de chaque nature (au singulier ou au pluriel)');
ok(mixedNote.includes('same view'), '…et rappelle que le viewer garde le fichier entier dans la même vue');
const dnaNote = NAT.sequenceNaturesNote({ structureSeqNatures: { dna: { len: 4, chains: ['B'] } } }, 'protein');
ok(dnaNote.includes('Click DNA'), 'un fichier d’ADN sur une condition « Proteins » indique la case à ouvrir');
eq(NAT.sequenceNaturesNote({ structureSeqNatures: { dna: { len: 4, chains: ['B'] } } }, 'dna'), null,
  '…et se tait quand on est déjà sur cette nature');

/* ══ 4. LE CLASSEMENT SUR DE VRAIES STRUCTURES (VRAI NGL 2.4) ═════════════ */

// NGL lit un Blob à travers FileReader : le navigateur l'a, node non — quatre
// lignes suffisent pour parser un PDB exactement comme la page le fait.
globalThis.FileReader = class {
  readAsText(blob) {
    Promise.resolve(blob.text()).then((t) => {
      this.result = t;
      if (typeof this.onload === 'function') this.onload({ target: this });
    });
  }
};

// Un complexe protéine + ADN + ARN réassemblé depuis les gabarits EMBARQUÉS :
//   A · ALA + GLY      protéine
//   B · DA   C · DC    ADN écrit DA / DC
//   D · U              ARN écrit U
//   E · A (désoxy)     F · A (ribose)   → lettres de base NUES : seule la
//                                       présence du 2'-oxygène les sépare
//   G · 5MC (désoxy)   nucléotide modifié (aucun code à 1 lettre : hors bandeau)
//   W · HOH   L · LIG  eau / ligand : jamais de la séquence
const atoms = (file) => read(`./public/structures/${file}`).split('\n').filter((l) => l.startsWith('ATOM'));
const recast = (lines, { resname, chain, resno, serial0 }) => lines.map((l, i) => (
  `ATOM  ${String(serial0 + i).padStart(5)} ${l.slice(12, 16)} ${(resname || l.slice(17, 20)).trim().padStart(3)} ${chain}${String(resno).padStart(4)}${l.slice(26)}`
));
// Le reconstructeur doit reproduire une ligne du gabarit À L'IDENTIQUE.
const prot = atoms('template_amino_acid.pdb');
const dna = atoms('template_nucleotide_dna.pdb');
const rna = atoms('template_nucleotide_rna.pdb');
eq(recast(prot, { chain: 'A', resno: 1, serial0: 1 })[0], prot[0], 'le reconstructeur réécrit un ATOM à l’identique');

const complexText = [
  ...recast(prot, { chain: 'A', resno: 1, serial0: 1 }),
  ...recast(prot, { resname: 'GLY', chain: 'A', resno: 2, serial0: 101 }),
  ...recast(dna, { chain: 'B', resno: 1, serial0: 201 }),
  ...recast(dna, { resname: 'DC', chain: 'C', resno: 1, serial0: 301 }),
  ...recast(rna, { chain: 'D', resno: 1, serial0: 401 }),
  ...recast(dna, { resname: 'A', chain: 'E', resno: 1, serial0: 501 }),
  ...recast(rna, { resname: 'A', chain: 'F', resno: 1, serial0: 601 }),
  ...recast(dna, { resname: '5MC', chain: 'G', resno: 1, serial0: 701 }),
  'ATOM    801  O   HOH W   1     200.000   0.000   0.000  1.00  0.00           O',
  'HETATM  802  C1  LIG L   1     300.000   0.000   0.000  1.00  0.00           C',
  'END',
].join('\n');

/* ── La sandbox : les helpers de classement du viewer, exécutés pour de vrai ── */
const H = new Function([
  `const SEQUENCE_NATURES = ${JSON.stringify(NAT.SEQUENCE_NATURES)};`,
  sliceObject(VIEW, 'AA3_TO_1'),
  sliceObject(VIEW, 'NUCLEIC_1_BY_NAME'),
  sliceFn(VIEW, 'atomNameSet'),
  sliceArrow('hasSugarRing'),
  sliceArrow('hasPhosphateLink'),
  sliceFn(VIEW, 'residueNatureOf'),
  sliceFn(VIEW, 'collectResidueTicks'),
  sliceFn(VIEW, 'structureSequenceParts'),
  `return { AA3_TO_1, NUCLEIC_1_BY_NAME, atomNameSet, hasSugarRing, hasPhosphateLink,
    residueNatureOf, collectResidueTicks, structureSequenceParts };`,
].join('\n'))();

// 4a. Le classificateur, seul : une protéine, un ADN, un ARN, rien du tout.
eq(H.residueNatureOf('ALA', ['N', 'CA', 'C', 'O']), 'protein', 'les vingt acides aminés sont des protéines');
eq(H.residueNatureOf('MSE', ['N', 'CA', 'C', 'SE']), 'protein', '…et un acide aminé modifié aussi (par ses atomes)');
eq(H.residueNatureOf('DA', ['P', "C1'", "C3'", "C2'", "O3'"]), 'dna', 'DA est un désoxyribonucléotide');
eq(H.residueNatureOf('U', ['P', "C1'", "C3'", "C2'", "O2'"]), 'rna', 'un U est un ribonucléotide');
eq(H.residueNatureOf('A', ['P', "C1'", "C2'", "C3'"]), 'dna', 'une lettre de base NUE sans 2’-oxygène est de l’ADN');
eq(H.residueNatureOf('A', ['P', "C1'", "C2'", "C3'", "O2'"]), 'rna',
  '…et avec le 2’-oxygène, de l’ARN (c’est la SEULE différence entre les deux)');
eq(H.residueNatureOf('5MC', ['P', "C1'", "C2'", "C3'"]), 'dna',
  'un nucléotide MODIFIÉ est classé sans aucune table : ses atomes parlent');
eq(H.residueNatureOf('5MC', ['P', "C1'", "C2'", "C3'", "O2'"]), 'rna', '…idem côté ARN');
eq(H.residueNatureOf('HOH', ['O']), '', 'l’eau n’est pas un polymère');
eq(H.residueNatureOf('LIG', ['C1', 'C2', 'O1']), '', 'un ligand non plus');
eq(H.residueNatureOf('', []), '', 'un résidu sans nom ne casse rien');
ok(H.hasSugarRing(H.atomNameSet(["C1'", "O4'"])) && !H.hasPhosphateLink(H.atomNameSet(["C1'", "O4'"])),
  'un cycle de sucre se reconnaît sans phosphate — un sucre de glycanne reste un sucre');

// 4b. Le complexe PARSÉ PAR NGL : le bandeau et la séquence disent la même chose.
const structure = await NGL.autoLoad(new Blob([complexText], { type: 'text/plain' }), { ext: 'pdb' });
const expectedAtoms = complexText.split('\n').filter((l) => /^(ATOM|HETATM)/.test(l)).length;
ok(structure && structure.atomCount === expectedAtoms, 'le complexe protéine + ADN + ARN est parsé par NGL');
const ticks = H.collectResidueTicks({ structure });
eq(ticks.length, 10, 'dix résidus dans le complexe');
const byChain = {};
const codesOfChain = {};
ticks.forEach((t) => {
  byChain[t.chainname] = t;
  if (!codesOfChain[t.chainname]) codesOfChain[t.chainname] = [];
  codesOfChain[t.chainname].push(t.code);
});
eq(codesOfChain.A, ['A', 'G'], 'la chaîne A porte deux résidus protéiques (ALA · GLY)');
eq(codesOfChain.B, ['A'], 'la chaîne B un seul nucléotide');
eq(byChain.A.nature, 'protein', 'la chaîne A est une protéine');
eq(byChain.B.nature, 'dna', 'la chaîne B est de l’ADN (DA)');
eq(byChain.C.code, 'C', 'la chaîne C lit sa base (DC → C)');
eq(byChain.D.nature, 'rna', 'la chaîne D est de l’ARN (U)');
eq(byChain.E.nature, 'dna', 'une adénine DÉSOXY (lettre nue) est de l’ADN');
eq(byChain.F.nature, 'rna', 'une adénine RIBO (lettre nue) est de l’ARN');
eq(byChain.G.polymer, false, 'un nucléotide modifié reste hors du bandeau (aucun code à 1 lettre)');
eq(byChain.W.polymer, false, 'l’eau n’est jamais dans la séquence');
eq(byChain.L.polymer, false, 'un ligand non plus');
ok(byChain.B.chainname === 'B' && byChain.B.chainid !== 'B',
  'la chaîne est nommée comme dans le PDB (NGL rend un INDEX dans `chainid`)');
// Chaque nature a SA séquence, et rien d'autre.
const parts = H.structureSequenceParts(ticks);
eq(parts.protein.seq, 'AG', 'la séquence protéique est celle de la protéine SEULE');
eq(parts.protein.chains, ['A'], '…avec sa chaîne');
eq(parts.dna.seq, 'ACA', 'la séquence d’ADN est celle de l’ADN seul');
eq(parts.dna.chains, ['B', 'C', 'E'], '…chaînes B · C · E');
eq(parts.rna.seq, 'UA', 'la séquence d’ARN est celle de l’ARN seul (les U et les riboses)');
eq(parts.rna.chains, ['D', 'F'], '…chaînes D · F');
eq(parts.protein.len, 2, 'la longueur annoncée est celle de la nature');
ok(!parts.dna.seq.includes('G') && !parts.rna.seq.includes('G'),
  'un nucléotide modifié ne fabrique aucune lettre inventée');

// 4c. LA FIN DE LA CHAÎNE : le patch du chargement, puis ce que chaque case
//     montre. C'est exactement le scénario rapporté : un PDB protéine + ADN.
const wholeSeq = ticks.filter((t) => t.polymer).map((t) => t.code).join('');
eq(wholeSeq, 'AGACUAA', 'la séquence complète reste disponible (compatibilité)');
const loaded = NAT.structureSequencePatch({}, 'protein', wholeSeq, parts);
eq(loaded.proteinSequence, 'AG', 'la case « Proteins » reçoit la PROTÉINE, pas le mélange');
eq(loaded.nucleicSequences, { dna: 'ACA', rna: 'UA' }, 'l’ADN et l’ARN sont rangés dans leurs propres champs');
const afterLoad = { ...loaded, structureSeqNatures: loaded.structureSeqNatures };
eq(NAT.sequenceForMoleculeType(afterLoad, 'protein'), 'AG', 'la case « Proteins » montre la protéine');
eq(NAT.sequenceForMoleculeType(afterLoad, 'dna'), 'ACA', 'cliquer « DNA » montre la séquence d’ADN du fichier');
eq(NAT.sequenceForMoleculeType(afterLoad, 'rna'), 'UA', 'cliquer « RNA » montre celle d’ARN');
ok(NAT.sequenceNaturesNote(afterLoad, 'protein').includes('same view'),
  'la page explique où chaque nature est allée ET que le viewer garde le fichier entier');

/* ══ 5. GARDES SUR LA SOURCE DES PAGES ET DU VIEWER ═══════════════════════ */
// Une seule table pour toute l'application : les trois pages importent le module.
[NMR, MD, DOCK].forEach((src, i) => {
  const name = ['NMR', 'MD', 'Docking'][i];
  has(src, "from '../utils/sequenceNatures'", `[${name}] la table des natures est importée (aucune règle recopiée)`);
  has(src, 'sequenceForMoleculeType(activeTest, moleculeType)', `[${name}] la séquence lue est celle de la nature affichée`);
  has(src, 'sequencePatchForMoleculeType(activeTest, d.moleculeType, e.target.value)',
    `[${name}] la case de saisie écrit dans le champ de sa nature`);
  has(src, 'structureSequencePatch(activeTest, d.moleculeType, seq, parts)',
    `[${name}] le fichier chargé remplit chaque champ par nature`);
  has(src, 'value={d.rawSequence}', `[${name}] la case affiche la séquence de la nature courante`);
  has(src, '{d.seqNaturesNote && (', `[${name}] l’écran explique où chaque séquence est allée`);
});
gone(NMR, 'updateActiveTest({ proteinSequence: e.target.value })', 'plus aucune case NMR n’écrit tout dans `proteinSequence`');
gone(MD, 'updateActiveTest({ proteinSequence: e.target.value })', '…côté MD non plus');
gone(DOCK, 'updateActiveTest({ proteinSequence: e.target.value })', '…côté Docking non plus');
// Les lecteurs de la séquence (rapports, notebook, tableaux d'atomes).
has(SHELL, 'sequenceForMoleculeType(t, t.moleculeType)', '[rapport] la table d’atomes lit la nature de la condition');
has(NMRR, 'sequenceForMoleculeType(t, t.moleculeType)', '[notebook NMR] la séquence affichée est celle de sa nature');
has(NB, 'sequenceForMoleculeType(localTest, localTest.moleculeType)', '[notebook] la formule suit la nature');
// Le viewer : classement, handshake et bandeau groupé.
has(VIEW, "import { SEQUENCE_NATURES } from '../utils/sequenceNatures';", '[viewer] la table des natures est partagée');
has(VIEW, "nature: code ? residueNatureOf(name, atomNames) : ''", '[viewer] chaque résidu polymère porte sa nature');
has(VIEW, 'const parts = structureSequenceParts(ticks);', '[viewer] une séquence par nature est construite');
has(VIEW, 'onStructureSequence(seq, parts)', '[viewer] …et remise à la page (2e argument)');
has(VIEW, "{ key: 'protein', label: 'Proteins' },", '[bandeau] un groupe par nature');
has(VIEW, "{ key: 'dna', label: 'DNA' },", '…ADN');
has(VIEW, "{ key: 'rna', label: 'RNA' },", '…ARN');
has(VIEW, 'const multiNature = polyGroups.length > 1;', '[bandeau] les titres n’apparaissent que sur un fichier MIXTE');
has(VIEW, '{ticksRow(g.ticks)}', '[bandeau] les résidus de chaque nature sont rendus par le MÊME bouton');
has(VIEW, 'strip collapsed — {polyTicks.length} residues', '[bandeau] le repli continue de dire combien de résidus sont masqués');

console.log(`_sequence_natures_test.mjs — ${passed} assertions OK`);
