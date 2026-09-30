/* =========================================================================
   _structure_restraints_test.mjs — LE FICHIER DES DISTANCES DU 🧬.

   La demande, mot pour mot : « Allow to save/upload from file the distance
   constraints in the structure calculation section. »

   Ce qui doit rester vrai :

     • LE FORMAT EST UN TEXTE LISIBLE — une ligne par distance, trois colonnes
       (atome A · atome B · cible en Å), une tête en commentaires qui dit comment
       le relire. Aucun format binaire, aucun JSON : un fichier qu'on peut ouvrir
       et corriger à la main ;
     • L'ALLER-RETOUR EST EXACT — ce qu'écrit `restraintsToText` est relu par
       `restraintsFromText` à l'identique (les deux atomes, la cible au chiffre
       près), quelle que soit la longueur des noms d'atomes ;
     • LA RELECTURE EST TOLÉRANTE MAIS PAS DEVINEUSE — les commentaires et les
       lignes vides sont ignorés, les séparateurs acceptés sont la tabulation, le
       « ; », le « , », le « | » et DEUX espaces ou plus (jamais une seule : un nom
       d'atome en contient), la virgule décimale est acceptée, et une ligne sans
       cible utilisable est RENDUE dans `skipped`, avec son numéro et sa raison ;
     • LE NOM D'UN ATOME SANS TEXTE SORT PAR SON NUMÉRO (« #12 ») — c'est ce que
       le viewer sait relire (`calcAtomOfText`, vérifié dans le source) ;
     • LE VIEWER BRANCHE CE MODULE — 💾 Save distances écrit la table par le
       format du module, 📂 Load distances la relit et résout les atomes SUR LA
       MOLÉCULE À L'ÉCRAN (aucune seconde table, aucun second parseur).

   Run: node _structure_restraints_test.mjs
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  restraintsToText, restraintsFromText, restraintRowOf, restraintLineOf,
  restraintWeightOf, RESTRAINT_FILE_EXT, RESTRAINT_FILE_MIME, RESTRAINT_FILE_HEADER,
} from './src/utils/structureRestraints.js';

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
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const VIEW = read('./src/components/NMRMoleculeViewer.jsx');
const MODULE = read('./src/utils/structureRestraints.js');
/* ════════════ 1. LE FORMAT, DIT PAR LE MODULE ═══════════════════════════════ */
eq(RESTRAINT_FILE_EXT, 'txt', 'le fichier est un .txt (un fichier qu’on ouvre partout)');
ok(RESTRAINT_FILE_MIME.startsWith('text/plain'), '…déclaré comme du texte (le navigateur ne le convertit pas)');
ok(RESTRAINT_FILE_HEADER.length >= 4, 'la tête dit ce qu’est le fichier et comment il se relit');
ok(RESTRAINT_FILE_HEADER.every((l) => l.startsWith('# ')), '…et chacune de ses lignes est un COMMENTAIRE');
ok(RESTRAINT_FILE_HEADER.some((l) => l.includes('TAB')), 'elle nomme le séparateur écrit (la tabulation)');
ok(RESTRAINT_FILE_HEADER.some((l) => l.includes('ignored')), '…et dit que les commentaires sont ignorés à la relecture');

/* ════════════ 2. UNE LIGNE — LES TROIS COLONNES ═════════════════════════════ */
eq(restraintLineOf({ a: 'ALA 12 CA', b: 'ALA 40 CA', target: 6 }), 'ALA 12 CA\tALA 40 CA\t6.00',
  'une ligne : les deux atomes, une tabulation, la cible à deux décimales');
eq(restraintLineOf({ a: 'ALA 12 CA', b: 'ALA 40 CA', target: 6.123456 }), 'ALA 12 CA\tALA 40 CA\t6.12',
  '…la cible est bornée à deux décimales (ce qu’un angström utile demande)');
eq(restraintLineOf({ la: 'GLY 3 N', lb: 'GLY 3 CA', target: 1.45 }), 'GLY 3 N\tGLY 3 CA\t1.45',
  'un atome SANS texte tapé sort par son ÉTIQUETTE (la colonne que la table affiche)');
eq(restraintLineOf({ i: 12, j: 40, target: 6 }), '#12\t#40\t6.00',
  '…et un atome sans aucun nom sort par son NUMÉRO (« #12 »), que le viewer sait relire');
eq(restraintLineOf({ a: ' ALA 12 CA ', b: '', target: 4 }).split('\t'), ['ALA 12 CA', '', '4.00'],
  'les espaces autour d’un nom sont nettoyés ; une colonne vide RESTE vide (jamais inventée)');
eq(restraintLineOf({ a: 'A', b: 'B', target: 0 }), 'A\tB\t', 'une cible nulle n’est pas écrite comme un chiffre');
eq(restraintLineOf({ a: 'A', b: 'B' }), 'A\tB\t', '…comme une cible absente');
eq(restraintLineOf(null), '\t\t', 'une ligne vide ne fait pas lever le module');

/* ════════════ 2bis · LA QUATRIÈME COLONNE — LE POIDS ⚖ (« w= ») ══════════════
   La demande de cette session : « enable this option allowing the user to give a weight to
   these constraints. This weight can be defined in the table. » Le poids est une propriété
   de la LIGNE : il voyage donc avec elle dans le fichier, sous une forme qui DIT ce qu'elle
   est (« w=2 »), et qui ne peut pas être prise pour une cible ni pour un nom d'atome. */
eq(restraintWeightOf({ weight: 2 }), 2, 'le module sait lire un poids');
eq([restraintWeightOf({}), restraintWeightOf({ weight: null }), restraintWeightOf({ weight: 'abc' })],
  [1, 1, 1], '⚠ un poids absent ou illisible vaut 1 — le défaut, exactement comme avant cette colonne');
eq([restraintWeightOf({ weight: 0 }), restraintWeightOf({ weight: '0.5' }), restraintWeightOf({ weight: false })],
  [0, 0.5, 1], '⚠ …un poids de 0 est une valeur (une ligne en pause), et un booléen n’est pas un poids de 0');
eq(restraintLineOf({ a: 'ALA 12 CA', b: 'ALA 40 CA', target: 6, weight: 2 }),
  'ALA 12 CA\tALA 40 CA\t6.00\tw=2',
  '⚠ une ligne pondérée ÉCRIT son poids dans un champ nommé « w= », à la suite des trois colonnes');
eq(restraintLineOf({ a: 'A', b: 'B', target: 2.05, weight: 0 }), 'A\tB\t2.05\tw=0',
  '…et un poids de 0 s’écrit aussi (c’est la mise en pause de la ligne, pas une absence)');
eq(restraintLineOf({ a: 'A', b: 'B', target: 2.05, weight: 1 }), 'A\tB\t2.05',
  '⚠ …tandis qu’un poids de 1 ne s’écrit PAS : une table sans poids reste un fichier à trois colonnes');
const w2 = restraintRowOf('ALA 12 CA\tALA 40 CA\t6.00\tw=2');
eq([w2.a, w2.b, w2.target, w2.weight], ['ALA 12 CA', 'ALA 40 CA', 6, 2],
  '…et la relecture rend le poids SANS toucher aux deux atomes ni à la cible');
eq(restraintRowOf('w=0.5 ; ALA 12 CA ; ALA 40 CA ; 6.00').weight, 0.5,
  '⚠ le champ « w= » est retiré AVANT toute autre lecture : il peut être n’importe où sur la ligne');
eq([restraintRowOf('ALA 12 CA\tALA 40 CA\t6.00\tw=2').target,
  restraintRowOf('ALA 12 CA\tALA 40 CA\t6.00\tw=abc').target], [6, 6],
  '…et il ne peut jamais être pris pour la cible, même écrit « w=abc »');
const badW = restraintRowOf('ALA 12 CA\tALA 40 CA\t6.00\tw=abc');
eq([badW.weight, badW.weightSay.length > 0], [null, true],
  '⚠ un « w= » illisible est DIT (`weightSay`) au lieu d’être tu : la ligne court au poids 1, elle n’est pas jetée');
eq(restraintRowOf('ALA 12 CA\tALA 40 CA\t6.00\tand a fourth column is ignored?').weight, null,
  '…et une quatrième colonne qui n’est pas un poids reste ignorée, comme avant');

/* ════════════ 3. LE FICHIER, PUIS SA RELECTURE — L’ALLER-RETOUR ═════════════ */
const rows = [
  { a: 'ALA 12 CA', b: 'ALA 40 CA', target: 6 },
  /* ⚖ UNE LIGNE PONDÉRÉE DANS LA LISTE — le poids fait partie de la distance, donc il
     doit survivre à l'aller-retour comme les atomes et la cible. */
  { a: 'ALA 13 N', b: 'ALA 41 O', target: 3.25, weight: 2 },
  { a: 'CYS 6 SG', b: 'CYS 127 SG', target: 2.05 },
];
const written = restraintsToText({ restraints: rows, note: 'three distances for « model 1 »' });
eq(written.count, 3, 'le module dit combien de distances il a écrites');
has(written.text, '# Lab Workspace', 'le fichier commence par sa tête en commentaires');
has(written.text, '# three distances for « model 1 »', '…où la note de l’appelant est écrite TELLE QUELLE');
has(written.text, 'ALA 13 N\tALA 41 O\t3.25\tw=2',
  '⚖ …la ligne pondérée écrit SON poids, et les deux autres restent à trois colonnes');
ok(written.text.endsWith('\n'), 'le fichier finit par une fin de ligne (un éditeur ne coupe pas la dernière)');
const back = restraintsFromText(written.text);
eq(back.count, 3, 'la relecture rend les trois distances');
eq(back.skipped, [], '…sans rien jeter');
eq(back.rows.map((r) => [r.a, r.b, r.target]),
  [['ALA 12 CA', 'ALA 40 CA', 6], ['ALA 13 N', 'ALA 41 O', 3.25], ['CYS 6 SG', 'CYS 127 SG', 2.05]],
  '⚠ L’ALLER-RETOUR EST EXACT : mêmes atomes, mêmes cibles (l’identité, pas une approximation)');
eq(back.rows.map((r) => r.weight), [null, 2, null],
  '⚖ …ET LES POIDS AUSSI : celui qui a été écrit revient, les autres restent « pas de poids » (donc 1)');
eq(back.weighted, 1, 'le module dit combien de lignes portaient un poids (le panneau le répète à l’utilisateur)');
const firstDataLine = RESTRAINT_FILE_HEADER.length + 3;
eq(back.rows.map((r) => r.line), [firstDataLine, firstDataLine + 1, firstDataLine + 2],
  'chaque ligne se souvient de SON numéro dans le fichier (la tête, la note et le compte passé)');
const again = restraintsFromText(written.text);
eq(restraintsToText({ restraints: again.rows, note: 'three distances for « model 1 »' }).text, written.text,
  '⚠ …et écrire ce qu’on vient de relire redonne LE MÊME fichier, au caractère près');
/* ════════════ 4. LA RELECTURE EST TOLÉRANTE (MAIS PAS DEVINEUSE) ════════════ */
const messy = [
  '',
  '# a comment',
  '   ',
  'ALA 12 CA\tALA 40 CA\t6.0',
  'ALA 12 CA ; ALA 40 CA ; 6,0        # virgule décimale, séparateur « ; », commentaire de fin',
  'ALA 12 CA   ALA 40 CA   6.0',
  'ALA 12 CA | ALA 40 CA | 6.0',
  'ALA 12 CA,ALA 40 CA,6.0',
  'ALA 12 CA\tALA 40 CA\t6.0\tand a fourth column is ignored?',
  'ALA 12 CA\tALA 40 CA\tnot-a-number',
  'ALA 12 CA\tALA 40 CA',
  'just one atom name',
  'ALA 12 CA\tALA 40 CA\t-3',
].join('\n');
const read2 = restraintsFromText(messy);
eq(read2.count, 6,
  'six lignes se lisent : tabulation, « ; », deux espaces, « | », « , » — et la quatrième colonne est ignorée');
eq(read2.rows.map((r) => r.target), [6, 6, 6, 6, 6, 6], '⚠ la virgule décimale donne LE MÊME nombre que le point');
eq(read2.rows[4].target, 6, '…et la ligne à quatre colonnes garde la cible de SA troisième colonne');
eq(read2.skipped.length, 4, 'quatre lignes sont RENDUES comme non comprises (aucun silence)');
eq(read2.skipped.map((s) => s.line), [10, 11, 12, 13], '…avec leur numéro dans le fichier');
ok(read2.skipped.every((s) => typeof s.say === 'string' && s.say.length > 0 && typeof s.text === 'string'),
  '…et leur texte plus une raison (le panneau n’a rien à inventer)');
eq(restraintsFromText('').count, 0, 'un fichier vide ne rend aucune distance (et ne lève pas)');
eq(restraintsFromText(null).count, 0, '…pas plus qu’un fichier absent');
eq(restraintsFromText('# only comments\n\n#\n').skipped, [], '…ni qu’un fichier de commentaires (rien à signaler)');
eq(restraintRowOf('# juste un commentaire'), null, 'une ligne qui n’est qu’un commentaire ne rend rien');
eq(restraintRowOf('ALA 12 CA  6.0').target, 6, '⚠ DEUX colonnes suffisent : une seule colonne d’atome et la cible');
eq(restraintRowOf('ALA 12 CA 6.0'), null,
  '❌ …mais UNE SEULE espace ne sépare rien : « ALA 12 CA » est un nom d’atome, pas trois champs');
eq(restraintRowOf('  '), null, 'une ligne blanche non plus');
/* ════════════ 5. LE VIEWER BRANCHE LE MODULE ════════════════════════════════ */
has(VIEW, "} from '../utils/structureRestraints';",
  'le viewer importe le format du fichier (le sien, pas un second)');
has(VIEW, 'restraintsToText, restraintsFromText, restraintWeightOf,',
  '…avec les deux gestes, les deux constantes du fichier ET le lecteur du poids ⚖ (le module, jamais une copie)');
has(VIEW, 'const calcSaveRestraints = () => {', '💾 Save distances a son handler');
has(VIEW, 'restraintsToText({\n      restraints: calcRestraints,',
  '…et il écrit LA TABLE DU PANNEAU, telle qu’elle est affichée (aucune copie refaite)');
has(VIEW, 'const weighted = calcRestraints.filter((r) => calcWeightOf(r) !== 1).length;',
  '⚖ …en comptant les lignes qui portent un poids, pour que la note du fichier le DISE');
has(VIEW, '${weighted ? `, ${weighted} with a ⚖ weight of their own',
  '…la note nomme les poids écrits (et celles qui sont en pause)');
has(VIEW, '+ \' three columns (atom A · atom B · target in Å) plus a “w=” field on the lines whose\'',
  '…et le rapport de sauvegarde dit ce que le fichier porte : trois colonnes + un champ « w= »');
has(VIEW, 'a.download = calcRestraintFileName();', '…dans un fichier nommé d’après la molécule à l’écran');
has(VIEW, 'const calcRestraintFileName = () => {', '…par une seule fonction de nommage');
has(VIEW, 'const url = URL.createObjectURL(blob);',
  '…par le chemin de téléchargement du dossier (Blob + <a download>, comme l’export des thèmes)');
has(VIEW, 'const calcLoadRestraintsFile = (file) => {', '📂 Load distances a son handler');
has(VIEW, "const { rows, count, skipped, weighted } = restraintsFromText(String(reader.result || ''));",
  '…et il lit le fichier par le MODULE (mêmes règles, aucune seconde analyse), poids compris');
has(VIEW, 'weight: row.weight == null ? null : row.weight,',
  '⚖ …le poids d’une ligne relue arrive dans la table telle quelle (1 quand le fichier n’en porte pas)');
has(VIEW, "w: row.weight == null ? '' : String(row.weight),",
  '…dans la case de la ligne, comme le texte de la cible');
has(VIEW, "row.weightSay || ''].filter(Boolean).join(' · ');",
  '⚠ …et un « w= » que le module n’a pas su lire est DIT sur la ligne (il n’est jamais tu)');
has(VIEW, "weighted ? ` ${weighted} of them carr${weighted === 1 ? 'ies' : 'y'} a ⚖ weight of their own",
  '…le rapport de lecture dit combien de lignes ont rapporté un poids');
has(VIEW, 'const hitA = calcAtomOfText(live.structure, row.a);',
  '⚠ …en résolvant chaque nom d’atome SUR LA MOLÉCULE À L’ÉCRAN (le lecteur de la frappe)');
has(VIEW, 'return { ...row, key: `row-${seq}` };',
  '…et en gardant une ligne non résolue, avec une clef de rang, pour être FINIE (comme ➕)');
has(VIEW, 'setCalcMsg(`✓ Read ${count} distance',
  'le rapport dit combien de distances ont été lues');
has(VIEW, '${unresolved} waiting for a name that this molecule does not have',
  '…combien attendent un nom que cette molécule n’a pas');
has(VIEW, 'not understood',
  '…et combien de lignes n’ont pas été comprises (jamais tues)');
has(VIEW, 'onClick={calcSaveRestraints}', 'le bouton 💾 est branché');
has(VIEW, '💾 Save distances', '…et nommé');
has(VIEW, '📂 Load distances', 'le bouton 📂 est nommé');
has(VIEW, 'accept=".txt,.csv,text/plain"', '…et n’accepte que du texte');
has(VIEW, "onChange={(e) => { calcLoadRestraintsFile(e.target.files && e.target.files[0]); e.target.value = ''; }}",
  '…et le champ est vidé après coup : le MÊME fichier peut être relu deux fois de suite');
has(VIEW, "const bare = asked.replace(/^#/, '');",
  '⚠ le lecteur d’atomes comprend « #123 », le numéro d’atome que le fichier écrit');
has(MODULE, 'export const restraintsFromText', '…le format reste dans le module pur (le viewer ne le réécrit pas)');
ok(!/const restraintsFromText = /.test(VIEW),
  '⚠ …et il n’est PAS recopié dans le viewer (un seul analyseur de fichier dans tout le dossier)');

console.log(`_structure_restraints_test.mjs — ${passed} assertions OK (le format du fichier des distances :`
  + ' trois colonnes lisibles, la tête qui dit comment le relire, l’aller-retour exact, la relecture'
  + ' tolérante mais jamais devineuse, le numéro d’atome « #123 », et les deux gestes du panneau 🧬'
  + ' — 💾 Save distances et 📂 Load distances — branchés sur ce seul module)');



