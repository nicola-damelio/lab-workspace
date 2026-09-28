/* =========================================================================
   _viewer_molecule_parts_test.mjs — 🧬 CHAQUE MOLÉCULE EST UNE ENTITÉ.

   LA DEMANDE DE CETTE SESSION : « you assign main to the composition of all
   molecules in a group and that means that I cannot do anything. Let me select
   molecule by molecule, even if these molecules are in the same pdb they are
   separate entities. »

   Une entité de la barre EST une composante NGL : une molécule ajoutée ne peut avoir
   son ★ set main, son ☑, son style et son 🎯 Fit que si elle A sa composante.
   ⚠⚠ LA STRUCTURE CHARGÉE, ELLE, RESTE **UNE** COMPOSANTE — le rapport de cette
   session : « I do not understand what you did to move the molecules now I have
   twice as much of molecules. » La découpe la dessinait DEUX FOIS (sa composante
   entière ET une composante par entité), et le moindre déplacement ne faisait que
   séparer les deux copies. Ses molécules vivent dans la BARRE, comme sections de son
   espace. Ce qu'on mesure ici :
     §1 LA RÈGLE (src/utils/viewerMoleculeParts) — les fragments connexes, jamais
        à travers deux MODEL, divisés par chaîne, l'eau pure ignorée, 30 au plus ;
     §2 LE NOM — une petite molécule dit ce qu'elle est (« Chain A · LIG ») et un
        nom qui se répéterait reçoit son numéro d'ordre (deux molécules de la même
        chaîne ne sont plus confondues) ;
     §3 L'ÉCRITURE — le PDB d'une entité : les lignes d'origine recopiées quand
        l'entité vient d'un texte, sinon des records écrits dans les colonnes que
        le lecteur lit (chaîne en 22, coordonnées en 31-54, élément en 77-78) ;
     §4 LE BRANCHEMENT — le viewer découpe AUSSI la structure chargée par NGL :
        une seule règle pour le fichier, le code PDB, l'URL et la molécule ajoutée.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fragmentMolecules, moleculePartNames, pdbTextForMolecule, pdbLineOfAtom,
  isWaterResname, isPolymerResname, resnameSummaryOf,
  MOLECULE_PART_CAP, MOLECULE_PART_MAX_ATOMS, MOLECULE_BOND_DIST,
} from './src/utils/viewerMoleculeParts.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); passed += 1; };
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => {
  assert.ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const hasNot = (needle, what) => {
  assert.ok(!VIEW.includes(needle), `${what}\n  encore là : ${needle}`);
  passed += 1;
};

/** Un atome comme les deux lectures en produisent (texte PDB / structure NGL). */
const atom = (o) => ({
  chain: 'A', resname: 'ALA', resno: 1, model: 0, x: 0, y: 0, z: 0, atomname: 'CA', element: 'C', ...o,
});

/* ── 1. LA RÈGLE : LES FRAGMENTS CONNEXES ─────────────────────────────────── */
eq(fragmentMolecules([]), [], 'aucun atome : aucune molécule');
eq(fragmentMolecules([atom({ x: 0 }), atom({ x: 40 })]).length, 2, 'deux atomes à 40 Å : deux molécules');
eq(fragmentMolecules([atom({ x: 0 }), atom({ x: 1.4 })]).length, 1,
  `…et à ${MOLECULE_BOND_DIST} Å ou moins, une seule (la liaison covalente implicite)`);
eq(fragmentMolecules([atom({ x: 0 }), atom({ x: 3 })], [[0, 1]]).length, 1,
  'une liaison DÉCLARÉE (CONECT · liaison NGL) unit même au-delà de la distance');
eq(fragmentMolecules([atom({ x: 0 }), atom({ x: 0, model: 1 })]).length, 2,
  'deux MODEL ne se recouvrent pas : deux conformères restent DEUX molécules');
eq(fragmentMolecules([atom({ x: 0 }), atom({ x: 0, model: 1 })], [[0, 1]]).length, 2,
  '…et une liaison déclarée entre deux MODEL ne les fusionne pas non plus');

const twoInOneChain = fragmentMolecules([
  atom({ x: 0, resname: 'ALA' }), atom({ x: 1.4, resname: 'ALA' }),
  atom({ x: 30, resname: 'LIG', resno: 501, atomname: 'C1' }), atom({ x: 31.4, resname: 'LIG', resno: 501, atomname: 'C2' }),
]);
eq(twoInOneChain.length, 2, 'un récepteur et son ligand dans la MÊME chaîne : deux molécules');
eq(twoInOneChain.map((p) => p.chain), ['A', 'A'], '…les deux dans la chaîne A');
eq(twoInOneChain.map((p) => p.atomCount), [2, 2], '…chacune avec ses atomes');
eq(twoInOneChain.map((p) => p.polymer), [true, false], 'la protéine est un polymère, le ligand non');
eq(twoInOneChain[1].resnoMin, 501, 'le numéro de résidu de l’entité est connu (501)');

const withWater = fragmentMolecules([
  atom({ x: 0 }), atom({ x: 1.4 }),
  atom({ x: 50, resname: 'HOH', atomname: 'O', element: 'O' }),
  atom({ x: 70, resname: 'WAT', atomname: 'O', element: 'O' }),
]);
eq(withWater.length, 1, 'une protéine hydratée ne donne pas une entité par molécule d’eau');
ok(isWaterResname('hoh') && isWaterResname(' TIP3P ') && !isWaterResname('LIG'),
  '…et l’eau se reconnaît quelle que soit la casse');
ok(isPolymerResname('ala') && isPolymerResname('DA') && !isPolymerResname('LIG'),
  'un polymère se reconnaît aussi (protéine · acide nucléique)');

const many = [];
for (let i = 0; i < MOLECULE_PART_CAP + 5; i++) many.push(atom({ x: i * 20, resname: 'LIG', resno: 500 + i }));
eq(fragmentMolecules(many).length, MOLECULE_PART_CAP, `la barre s’arrête à ${MOLECULE_PART_CAP} entités`);
eq(fragmentMolecules([atom({ x: 100, chain: 'B', resname: 'LIG' }), atom({ x: 0, chain: 'A' })]).map((p) => p.chain),
  ['B', 'A'], 'les entités suivent l’ordre du fichier (pas la chaîne triée)');
ok(MOLECULE_PART_MAX_ATOMS > 1000, 'une scène énorme n’est pas découpée (le seuil existe)');

/* ── 2. LE NOM : ON SAIT LAQUELLE ON DÉPLACE ──────────────────────────────── */
const named = moleculePartNames(twoInOneChain, {});
eq(named.map((p) => p.label), ['Chain A', 'Chain A · LIG'],
  'le ligand dit ce qu’il est : « Chain A · LIG » (le nom de la chaîne seule ne suffisait pas)');
const twins = moleculePartNames([
  { chain: 'A', model: 0, resnames: ['LIG'], polymer: false },
  { chain: 'A', model: 0, resnames: ['LIG'], polymer: false },
], {});
eq(twins.map((p) => p.label), ['Chain A · LIG', 'Chain A · LIG #2'],
  'deux copies du même ligand dans la même chaîne : deux noms différents');
eq(moleculePartNames([{ chain: '_', model: 0, resnames: ['LIG'], polymer: false }], {})[0].label, 'Molecule 1 · LIG',
  'sans chaîne, l’entité est numérotée');
eq(moleculePartNames([
  { chain: 'B', model: 1, resnames: ['ALA'], polymer: true },
  { chain: 'A', model: 2, resnames: ['ALA'], polymer: true },
], { multiModel: true, onePartPerModel: true }).map((p) => p.label), ['Model 2 · B', 'Model 3 · A'],
  'un ensemble NMR nomme chaque conformère par son MODEL (et garde sa chaîne)');
eq(moleculePartNames([{ chain: 'A', model: 0, resnames: ['ALA'], polymer: true }],
  { multiModel: true, onePartPerModel: false })[0].label, 'Molecule 1 (Model 1) · A',
  'plusieurs molécules par MODEL : « Molecule i (Model n) »');
eq(moleculePartNames([{ chain: 'A', model: 0, resnames: ['NA', 'CL'], polymer: false }], {})[0].label, 'Chain A · NA·CL',
  'un fragment qui n’est qu’un assemblage d’ions dit lesquels');
eq(resnameSummaryOf(['A', 'B', 'C', 'D']), 'A·B·C·…', 'un résumé de résidus s’arrête à trois');

/* ── 3. L’ÉCRITURE : LE PDB D’UNE ENTITÉ ─────────────────────────────────── */
const LINES = [
  'ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00  0.00           C',
  'ATOM      2  CB  ALA A   1       4.000   5.000   6.000  1.00  0.00           C',
];
eq(pdbTextForMolecule(LINES.map((line) => atom({ line })), [0, 1]), `${LINES.join('\n')}\nEND\n`,
  'l’entité d’un TEXTE garde les records du fichier, mot pour mot');
const generated = pdbTextForMolecule([
  atom({ x: 20, y: 0, z: 0, atomname: 'C1', resname: 'LIG', resno: 501 }),
  atom({ x: 21.4, resname: 'LIG', resno: 501 }),
], [0, 1]);
const gen = generated.trimEnd().split('\n');
eq(gen.length, 3, 'deux atomes et « END »');
eq(generated.slice(-4), 'END\n', 'le fichier se termine par END');
ok(gen[0].startsWith('HETATM'), 'un ligand s’écrit en HETATM…');
ok(pdbTextForMolecule([atom({ resname: 'ALA' })], [0]).startsWith('ATOM  '), '…et une protéine en ATOM');
const line0 = pdbLineOfAtom(atom({ x: -1.5, y: 2.25, z: 3, chain: 'A', resname: 'LIG', resno: 501, atomname: 'C1', element: 'C' }), 7);
eq(line0.slice(21, 22), 'A', 'la chaîne est en colonne 22 (ce que le lecteur lit)');
eq(Number(line0.slice(22, 26)), 501, '…le numéro de résidu en 23-26');
eq([Number(line0.slice(30, 38)), Number(line0.slice(38, 46)), Number(line0.slice(46, 54))], [-1.5, 2.25, 3],
  '…et les coordonnées en 31-54 (les mêmes indices que la découpe)');
eq(line0.slice(76, 78).trim(), 'C', 'l’élément est en 77-78');
ok(line0.length <= 80, 'un record PDB ne dépasse pas 80 colonnes');
ok(gen[0].includes('    1 ') && gen[1].includes('    2 '), 'les numéros de série repartent de 1 dans chaque entité');

/* ── 4. LE BRANCHEMENT : LA MÊME RÈGLE POUR TOUTES LES SOURCES ───────────── */
has("} from '../utils/viewerMoleculeParts';", 'le viewer importe la règle de découpe (module pur, exécutable ici)');
has('const namedPartsOf = (atoms, bonds, modelCount = 1) => {', 'une seule fabrique d’entités pour les deux lectures');
has('return namedPartsOf(atoms, conectBonds, modelCount);', 'la découpe du TEXTE PDB passe par la règle');
has('const splitStructureIntoMolecules = (comp, modelCountHint = 0) => {', '…et la STRUCTURE CHARGÉE par NGL aussi');
has('a.eachBondedAtom((b) => {', 'les liaisons que la structure déclare sont lues (CONECT · NGL)');
has('structure.chainStore.modelIndex[a.chainIndex]', 'le MODEL d’un atome vient de sa chaîne (un ensemble NMR reste séparé)');
has('if (!atoms.length || atoms.length > MOLECULE_PART_MAX_ATOMS) return [];',
  'une scène énorme n’est pas découpée : elle reste une entité');
has("UN ATOME N'EST DESSINÉ QUE PAR UNE COMPOSANTE",
  'la STRUCTURE CHARGÉE reste UNE composante (le rapport : « now I have twice as much of molecules » — la découpe la dessinait deux fois)');
hasNot('moleculeParts = await splitPdbFileIntoMolecules(srcForSplit);', '…son texte n’est plus recopié molécule par molécule');
hasNot('await loadChainMolecule(moleculeParts[ci].blob, moleculeParts[ci].label, ci);',
  '…et aucune entité du fichier chargé n’a sa propre composante (aucun atome dessiné deux fois)');
has('const registerExtraComponent = useCallback(async (comp, name, n) => {', 'une molécule AJOUTÉE passe par la même fabrique');
has('const parts = splitStructureIntoMolecules(comp);', '…on découpe la structure de la molécule ajoutée');
has('stageRef.current.removeComponent(comp);', 'la composante du fichier ENTIER n’est pas gardée en double');
has('await loadChainMolecule(parts[i].blob, `${name} · ${parts[i].label}`, i);', '…une entité par molécule, nommée');
has("await registerExtraComponent(comp, label.replace(/\\.[^.]+$/, ''), n);",
  'un code PDB / une URL expose aussi ses molécules (le chemin qui manquait)');
has('pending.forEach(({ file }) => { loadExtraStructureFile(file); });',
  'les fichiers chargés avec la structure passent par le chemin qui découpe');
has('}, [status, loadExtraStructureFile]);', '…et l’effet dépend de la fonction qui découpe');
has('await loadChainMolecule(parts[i].blob, `${baseName} · ${parts[i].label}`, i);',
  'le même nom, préfixé du fichier, pour une molécule ajoutée');
has('Every ␣ below is ONE molecule', 'la barre DIT que chaque espace est une molécule, même PDB partagé');
hasNot('pending.forEach(({ file, n }) => { loadExtraMolecule(file, n); });', 'l’ancien chemin (un espace par fichier) a disparu');

console.log(`_viewer_molecule_parts_test.mjs — ${passed} assertions OK (fragments · noms · PDB écrit · branchement)`);


