/* =========================================================================
   _library_csv_roundtrip_test.mjs — LA LIBRAIRIE EXPORTÉE SE REMPORTE.

   LE RAPPORT, MOT POUR MOT : « quando esporto la libreria poi non la posso
   reimportare in un altro dataset? se la importo con il tasto import CSV la
   legge ma con i campi sbagliati. »

   Ce que ce banc protège, en éprouvant le VRAI module des DEUX côtés
   (src/utils/libraryCsv.js, celui que la page Librairie et la fiche du composé
   appellent — il n'y a pas de seconde copie à tenir à jour) :

     • L'ALLER-RETOUR — `parseLibraryCsv(libraryCsvText({…}))` rend les mêmes
       composés : nom, type, séquence, MASSE, NOTES. C'était le défaut : l'export
       écrivait « Name,Type,Sequence/Formula,MW,Notes » et la relecture lisait
       nom, séquence, type — le type et la séquence étaient ÉCHANGÉS, et le nom
       gardait ses guillemets (les valeurs exportées sont CITÉES) ;
     • LES VALEURS CITÉES — une virgule, un point-virgule, une tabulation, un
       guillemet doublé ou un retour à la ligne dans un champ ne coupent plus la
       ligne ;
     • LES SECTIONS — un export complet ne déverse QUE la section « COMPOUNDS » :
       les lignées cellulaires, les plasmides, les solvants, les tampons, les
       additifs, les instruments, les sondes et les programmes NMR ne deviennent
       jamais des composés ;
     • LES FICHIERS D'AVANT — sans en-tête, l'ordre historique (nom, séquence,
       type) reste lu ; un type absent retombe sur « protein » ;
     • LA FICHE RETROUVE SES CHAMPS — une formule revient dans `sequence` (c'est
       là que la fiche la relit), un SMILES dans `smiles`, et les libellés du
       menu (« Protein / Peptide ») se ramènent au type du menu ;
     • LE CONTRAT DE LA CASE DE SÉQUENCE — `SequenceField` donne le TEXTE tapé à
       `onChange`, jamais l'Événement React : c'est lui qui faisait écrire
       « [object Object] » dans la condition (ce texte s'affichait à la place de
       la séquence, et le bandeau 🖌️ de la structure secondaire — qui lit
       `parsedSeq` — n'avait plus de résidus à peindre).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as CSV from './src/utils/libraryCsv.js';
import * as NAT from './src/utils/sequenceNatures.js';

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
const has = (src, needle, what) => ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (src, needle, what) => ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);

const LIBRARY = read('./src/components/AppModules/libraryDirectory.jsx');
const CARD = read('./src/components/AppModules/compoundDefinitionSection.jsx');
const FIELD = read('./src/components/SequenceField.jsx');
const NMR = read('./src/components/NMRSections.jsx');
const MD = read('./src/components/MDSections.jsx');
const DOCK = read('./src/components/DockingSections.jsx');

/* ── 1. L'ALLER-RETOUR, SUR DES CHAMPS QUI SE DÉFENDENT ───────────────────────
   Un nom, un type, une séquence HTML (la fiche du composé est un RichTextEditor),
   une masse, des notes ; une séquence avec un point-virgule ET un guillemet ; des
   notes avec une virgule ET un retour à la ligne ; une masse absente. */
const META = {
  'Peptide-01': { name: 'Peptide-01', type: 'protein', sequence: '<div>MKWVTFISLL</div>', modifications: 'Acetylation', molecularWeight: 1234.5, notes: 'Lyophilised, keep cold' },
  'ADN-1': { name: 'ADN-1', type: 'dna', sequence: 'ATGCCGTA', molecularWeight: 2480, notes: '' },
  'ARN-1': { name: 'ARN-1', type: 'rna', sequence: 'AUGCCGUA', molecularWeight: 2560, notes: 'in vitro transcript' },
  'Cafeine': { name: 'Cafeine', type: 'smiles', smiles: 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C', molecularWeight: 194.19, notes: 'C8H10N4O2' },
  'Glucose': { name: 'Glucose', type: 'formula', sequence: 'C6H12O6', molecularWeight: 180.16, notes: '' },
  'HeLa-lysat': { name: 'HeLa-lysat', type: 'protein', sequence: 'MKWV;TF"IS', molecularWeight: 0, notes: 'ligne 1\nligne 2, avec virgule' },
};
const NAMES = Object.keys(META);
const text = CSV.libraryCsvText({ compounds: NAMES, compoundMeta: META });
const back = CSV.parseLibraryCsv(text);
const byName = Object.fromEntries(back.compounds.map((c) => [c.name, c]));

eq(back.compounds.map((c) => c.name), NAMES,
  '⚠ les six composés reviennent, dans l’ordre, SANS guillemets autour du nom');
eq(byName['Peptide-01'].type, 'protein',
  '⚠ le type EST le type — et pas la séquence (c’était le défaut : les colonnes glissaient)');
eq(byName['Peptide-01'].sequence, 'MKWVTFISLL',
  '…la séquence revient, sans les balises HTML du RichTextEditor');
eq(byName['Peptide-01'].molecularWeight, 1234.5, '…la masse du fichier suit');
eq(byName['Peptide-01'].notes, 'Lyophilised, keep cold', '…et ses notes aussi');
eq(byName['ADN-1'].type, 'dna', 'un ADN reste un ADN');
eq(byName['ARN-1'].type, 'rna', 'un ARN reste un ARN');
eq(byName['Cafeine'].smiles, 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C', 'un SMILES revient dans son champ');
eq(byName['Cafeine'].sequence, '', '…et jamais dans la séquence');
eq(byName['Glucose'].sequence, 'C6H12O6',
  '⚠ une formule revient dans `sequence` — c’est LÀ que la fiche la relit (`type === formula`)');
eq(byName['Glucose'].formula, 'C6H12O6', '…et dans `formula` pour les lecteurs d’avant');
eq(byName['HeLa-lysat'].sequence, 'MKWV;TF"IS',
  'un point-virgule ET un guillemet dans une séquence ne coupent pas la ligne');
eq(byName['HeLa-lysat'].notes, 'ligne 1\nligne 2, avec virgule',
  '⚠ un champ cité garde ses retours à la ligne ET ses virgules');
eq(byName['HeLa-lysat'].molecularWeight, null, 'une masse absente (0) ne s’invente pas');

/* ── 2. LE FICHIER N'A PAS CHANGÉ DE FORME ─────────────────────────────────── */
const lines = text.split('\n');
eq(lines[0], '--- COMPOUNDS ---', 'le fichier ouvre sur la même section');
eq(lines[1], 'Name,Type,Sequence/Formula,MW,Notes',
  '…avec le même en-tête de colonnes — c’est LUI qui décide des champs à la relecture');
has(text, '"Peptide-01","protein","MKWVTFISLL","1234.5","Lyophilised, keep cold"',
  'la ligne d’un composé : nom, TYPE, séquence, masse, notes — dans cet ordre, citée');
const SECTIONS = ['--- COMPOUNDS ---', '--- CELL LINES ---', '--- PLASMIDS ---', '--- SOLVENTS ---',
  '--- BUFFERS ---', '--- ADDITIVES ---', '--- NMR INSTRUMENTS ---', '--- NMR PROBES ---',
  '--- NMR EXPERIMENTS / PULSE PROGRAMS ---'];
eq(SECTIONS.filter((s) => lines.includes(s)).length, SECTIONS.length,
  'les neuf sections de la page Librairie sont toujours écrites');
eq(lines.filter((l) => l === '').length, 8, '…séparées comme avant par une ligne vide');
eq(CSV.libraryCsvText().split('\n').slice(0, 2), lines.slice(0, 2),
  'sans composés à écrire, la section et son en-tête sont les mêmes');

/* ── 3. LES FICHIERS D'AVANT : SANS EN-TÊTE, SANS SECTION ────────────────────
   L'ordre historique (nom, séquence, type) reste lu : une liste de trois
   colonnes ne peut pas se mettre à se relire autrement aujourd'hui. */
const legacy = CSV.parseLibraryCsv('Peptide-01,MKWVTFISLL,protein\nADN-1,ATGCCGTA,dna\nSel,NaCl,formula\n');
eq(legacy.sections, [], 'un fichier sans section se relit en entier');
eq(legacy.compounds.map((c) => [c.name, c.type, c.sequence]), [
  ['Peptide-01', 'protein', 'MKWVTFISLL'],
  ['ADN-1', 'dna', 'ATGCCGTA'],
  ['Sel', 'formula', 'NaCl'],
], 'l’ordre historique (nom, séquence, type) est conservé');

const noType = CSV.parseLibraryCsv('Peptide-02,MKWVTFISLL').compounds[0];
eq(noType.type, 'protein', 'un type absent retombe sur « protein » (le défaut de la fiche)');
eq(noType.notes, 'Imported from CSV', '…et seule une note absente dit « Imported from CSV »');

// Un second en-tête (deux tableaux dans un même fichier) est un en-tête, pas un
// composé nommé « Name ».
eq(CSV.parseLibraryCsv('Name,Type,Sequence/Formula,MW,Notes\nA,protein,MK,1,\nName,Type,Sequence/Formula,MW,Notes\nB,dna,ACGT,2,\n').compounds.map((c) => c.name),
  ['A', 'B'], 'un en-tête répété est reconnu comme tel');

// Deux fois le même nom : la dernière ligne gagne (un import qui réécrit).
eq(CSV.parseLibraryCsv('A,MK,protein\nA,MKWV,protein\n').compounds.map((c) => c.sequence), ['MKWV'],
  'un nom = un composé — la dernière ligne gagne');

/* ── 4. LES COLONNES SONT RECONNUES PAR LEUR EN-TÊTE ───────────────────────── */
const swapped = CSV.parseLibraryCsv('Name,Sequence/Formula,MW,Type,Notes\nSel,NaCl,58.44,formula,sel de table\n').compounds[0];
eq([swapped.name, swapped.type, swapped.sequence, swapped.molecularWeight, swapped.notes],
  ['Sel', 'formula', 'NaCl', 58.44, 'sel de table'],
  '⚠ un fichier dont les colonnes sont dans un AUTRE ordre se relit quand même');

eq(CSV.parseLibraryCsv('Name,Type\nP1,Protein / Peptide\nD1,DNA\nS1,SMILES small molecule\n').compounds.map((c) => c.type),
  ['protein', 'dna', 'smiles'], 'les libellés du menu (« Protein / Peptide ») se ramènent au type du menu');

eq(CSV.parseLibraryCsv('Name;Type;Sequence/Formula;MW;Notes\nSel;formula;NaCl;58,44;sel de table\n').compounds[0].molecularWeight,
  58.44, '⚠ un point-virgule comme séparateur (Excel italien / français) et une VIRGULE DÉCIMALE : « 58,44 » reste un nombre');
eq(CSV.delimiterOf('Name;Type\nA;protein\n'), ';', '…le séparateur du fichier est reconnu');
eq(CSV.delimiterOf('Name,Type\nA,protein\n'), ',', '…la virgule aussi');
eq(CSV.delimiterOf('"a,b";c\n'), ';', '…et une virgule CITÉE ne compte pas comme séparateur');
eq(CSV.parseLibraryCsv('Name\tType\tSequence/Formula\tMW\tNotes\nSel\tformula\tNaCl\t58.44\t\n').compounds[0].molecularWeight,
  58.44, 'un collage en TABULATIONS se relit aussi');

eq(CSV.parseCsvRows('\uFEFFName,Type\nA,protein\n'), [['Name', 'Type'], ['A', 'protein']],
  'un BOM en tête de fichier ne colle pas au premier en-tête');



/* ── 5. UN EXPORT COMPLET N'IMPORTE QUE LES COMPOSÉS ─────────────────────────
   Le bouton « Import CSV » vit dans la fiche du COMPOSÉ : les huit autres listes
   du fichier ne doivent pas devenir des composés (c'était le second défaut). */
const full = CSV.libraryCsvText({
  compounds: ['Pep-1'],
  compoundMeta: { 'Pep-1': { type: 'protein', sequence: 'MKWV', molecularWeight: 500, notes: 'ok' } },
  cellLines: ['HeLa'],
  cellLineMeta: { HeLa: { organism: 'Human', tissue: 'cervix', cultureMedium: 'DMEM', notes: 'adherent' } },
  plasmids: ['pUC19'],
  plasmidMeta: { pUC19: { backbone: 'pUC', promoter: 'lac', marker: 'Amp', molecularWeight: 1750, notes: 'high copy' } },
  solvents: [{ name: 'D2O', density: 1.1, molecularWeight: 20, comments: 'NMR' }],
  buffers: [{ name: 'PBS', description: 'phosphate', molecularWeight: 0, comments: 'pH 7.4' }],
  additives: [{ name: 'DTT', description: 'reducing', molecularWeight: 154, comments: '-20 °C' }],
  nmrInstruments: [{ name: 'Bruker 600', frequency: 600, manufacturer: 'Bruker', comments: 'cryo' }],
  nmrProbes: [{ name: 'CPQCI', type: 'HCN', subtype: 'cryo', field: 600, comments: '' }],
  nmrExperiments: [{ name: 'hsqc', dimensions: '2D', nuclei: ['H', 'N'], comments: '' }],
});
const fullBack = CSV.parseLibraryCsv(full);
eq(fullBack.compounds.map((c) => c.name), ['Pep-1'], '⚠ seuls les composés sont importés');
eq(fullBack.sectioned, true, '…et le fichier se dit « à sections » (l’écran peut l’expliquer)');
eq(fullBack.sections.length, 9, 'les neuf sections sont reconnues');
gone(fullBack.compounds.map((c) => c.name).join('|').concat(JSON.stringify(fullBack.compounds)), 'HeLa',
  'une lignée cellulaire ne devient pas un composé');
eq(CSV.parseLibraryCsv('--- CELL LINES ---\nName,Organism,Tissue,Medium,Notes\nHeLa,Human,cervix,DMEM,adherent\n').compounds, [],
  'un fichier sans section « COMPOUNDS » ne rend AUCUN composé (et le dit à l’écran)');

/* ── 6. LES DEUX MOITIÉS SONT CELLES DU MODULE PARTAGÉ ─────────────────────── */
has(LIBRARY, "import { libraryCsvText } from '../../utils/libraryCsv';",
  'la page Librairie écrit son fichier avec le module partagé');
has(LIBRARY, 'const text = libraryCsvText({', '…et lui passe ses listes');
gone(LIBRARY, 'csv.push(', '…plus une seule ligne de CSV fabriquée à la main dans la page');
gone(LIBRARY, 'const escapeCsv =', '…ni son propre échappement de CSV');
has(CARD, "import { parseLibraryCsv } from '../../utils/libraryCsv';",
  'la fiche du composé relit avec le MÊME module (un seul contrat)');
has(CARD, 'const { compounds: rows, sections, sectioned } = parseLibraryCsv(event.target.result);',
  '…elle lit le fichier par ce qu’il contient, pas à la position');
gone(CARD, 'line.split(/[,;\\t]/)', '⚠ l’ancienne lecture colonne par colonne a disparu');
gone(CARD, "notes: 'Imported from CSV',", '…et la note n’est plus écrasée sur chaque ligne lue');

/* ── 7. LA CASE DE SÉQUENCE DONNE LE TEXTE, PAS L'ÉVÉNEMENT ──────────────────
   Le défaut : React donne un Événement au `<textarea>`, la case le repassait tel
   quel, et `sequencePatchForMoleculeType` faisait `String(événement)` → la
   condition recevait « [object Object] ». */
has(FIELD, 'onChange={emitValue}', '⚠ la case passe le TEXTE à onChange');
gone(FIELD, 'onChange={onChange}', '…l’Événement ne descend plus jusqu’au patch de la condition');
const start = FIELD.indexOf('const emitValue = (');
ok(start > 0, 'le helper `emitValue` de la case est extractible');
const cut = FIELD.indexOf('\n  };', start) + '\n  };'.length;
const makeEmitValue = new Function('onChange', `${FIELD.slice(start, cut)}\nreturn emitValue;`);
const got = [];
const emitValue = makeEmitValue((v) => got.push(v));
ok(emitValue({ target: { value: 'MKWVTF' } }) === undefined, 'la conversion ne rend rien (comme avant)');
emitValue('ACGT');
eq(got, ['MKWVTF', 'ACGT'], 'un Événement donne sa VALEUR, un texte déjà écrit passe tel quel');

const patch = NAT.sequencePatchForMoleculeType({}, 'protein', got[0]);
eq(patch, { proteinSequence: 'MKWVTF' }, '⚠ le patch de nature écrit la séquence TAPÉE');
gone(JSON.stringify(patch), '[object Object]', '…jamais « [object Object] » (le texte qui s’affichait)');
[[NMR, 'NMR'], [MD, 'MD'], [DOCK, 'Docking']].forEach(([page, name]) => {
  has(page, 'onChange={(v) => updateActiveTest(sequencePatchForMoleculeType(activeTest, d.moleculeType, v))}',
    `la page ${name} branche le patch de nature sur la VALEUR reçue (l’autre moitié du contrat)`);
  has(page, '<SequenceField', `la page ${name} pose bien la case partagée`);
});

console.log(`_library_csv_roundtrip_test.mjs — ${passed} assertions OK (export → relecture de la Librairie : colonnes par en-tête, valeurs citées, seule la section COMPOUNDS, formule/SMILES dans leurs champs ; et la case de séquence qui donne le TEXTE tapé à onChange)`);

