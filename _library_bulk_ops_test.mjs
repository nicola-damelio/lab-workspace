/* =========================================================================
   _library_bulk_ops_test.mjs — LA LIBRAIRIE SE SÉLECTIONNE, S'EXPORTE ENTIÈRE,
   ET S'IMPORTE PAR SOUS-CATÉGORIE.

   LA DEMANDE, MOT POUR MOT : « The scientific dataset allows me to select
   multiple entries in the library to delete them in one go. When I export the
   library all elements must be exported and when i load a library I must be
   able to choose which subcategory or even elements I decide to upload. »

   Ce que ce banc protège, en éprouvant le VRAI module (src/utils/libraryCsv.js)
   et le VRAI texte des quatre fichiers de la page :

     • L'EXPORT PORTE TOUT — chaque élément de chaque sous-catégorie est écrit,
       dans SA section (et les neuf sections sont là) ;
     • LA RELECTURE PAR SOUS-CATÉGORIE — `parseLibrarySections` rend les neuf
       sections dans la forme des FICHES (nombres, listes, type/sous-type), et
       un fichier sans section reste lu comme des composés (le cas d'avant) ;
     • L'IMPORT EST SÉLECTIF ET ADDITIF — `libraryPlanPatch` n'écrit QUE les
       listes cochées, complète par nom, ne supprime jamais, ne vide pas un
       champ que le fichier ne porte pas, et garde l'identifiant en place ;
     • LA SÉLECTION ET LES BOUTONS — la table porte une colonne de cases à
       cocher et son « Delete selected », la page un « Delete selected » global
       et le bouton « Import Library (CSV) », et c'est la PAGE qui écrit
       (`onDeleteResources` / `onImportLibrary`), pas la table ;
     • LA FICHE DU COMPOSÉ GARDE SON CONTRAT — son « Import CSV » n'importe
       toujours QUE les composés (voir _library_csv_roundtrip_test.mjs) : le
       nouveau lecteur ne l'a pas remplacé.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as CSV from './src/utils/libraryCsv.js';

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

const LIB = read('./src/components/AppModules/libraryDirectory.jsx');
const TABLES = read('./src/components/AppModules/librarySections.jsx');
const MODAL = read('./src/components/AppModules/libraryImportModal.jsx');
const MODULE = read('./src/components/AppModules/libraryModule.jsx');
const CARD = read('./src/components/AppModules/compoundDefinitionSection.jsx');
const APP = read('./src/App.jsx');

/* LA LIBRAIRIE D'ÉPREUVE — un élément (au moins) dans CHACUNE des neuf
   sous-catégories de la page, et deux là où la sélection doit distinguer. */
const FIXTURE = {
  compounds: ['Pep-1', 'Cafeine'],
  compoundMeta: {
    'Pep-1': { name: 'Pep-1', type: 'protein', sequence: '<div>MKWV</div>', molecularWeight: 500, notes: 'ok', links: [{ url: 'https://x', description: 'map' }] },
    Cafeine: { name: 'Cafeine', type: 'smiles', smiles: 'CN1C=NC2', molecularWeight: 194.19, notes: 'C8H10N4O2' },
  },
  cellLines: ['HeLa', 'CHO'],
  cellLineMeta: {
    HeLa: { organism: 'Human', tissue: 'cervix', cultureMedium: 'DMEM', notes: 'adherent' },
    CHO: { organism: 'Hamster', tissue: 'ovary', cultureMedium: 'F12', notes: 'suspension' },
  },
  plasmids: ['pUC19'],
  plasmidMeta: { pUC19: { backbone: 'pUC', promoter: 'lac', marker: 'Amp', molecularWeight: 1750, notes: 'high copy' } },
  solvents: [
    { name: 'D2O', density: 1.1, molecularWeight: 20, comments: 'NMR' },
    { name: 'CDCl3', density: 1.49, molecularWeight: 119.38, comments: '' },
  ],
  buffers: [{ name: 'PBS', description: 'phosphate', molecularWeight: 0, comments: 'pH 7.4' }],
  additives: [{ name: 'DTT', description: 'reducing', molecularWeight: 154, comments: '-20 C' }],
  nmrInstruments: [{ name: 'Bruker 600', frequency: 600, manufacturer: 'Bruker', comments: 'cryo' }],
  nmrProbes: [{ name: 'CPQCI', type: 'HCN', subtype: 'cryo', field: 600, comments: '' }],
  nmrExperiments: [{ name: 'hsqc', dimensions: '2D', nuclei: ['H', 'N'], comments: '' }],
};

const TEXT = CSV.libraryCsvText(FIXTURE);

/* ── 1. L'EXPORT PORTE TOUS LES ÉLÉMENTS ────────────────────────────────────
   « When I export the library all elements must be exported. » Chaque nom écrit
   est cherché dans le fichier, cité (c'est la forme de l'export), et l'on
   vérifie EN PLUS qu'il retombe dans SA section à la relecture — pas seulement
   « quelque part » dans le fichier. */
const EVERY = ['Pep-1', 'Cafeine', 'HeLa', 'CHO', 'pUC19', 'D2O', 'CDCl3', 'PBS', 'DTT', 'Bruker 600', 'CPQCI', 'hsqc'];
EVERY.forEach((name) => ok(TEXT.includes(`"${name}"`), `l'export porte « ${name} »`));
eq(CSV.parseLibraryCsv(TEXT).sections.length, 9, 'les neuf sections de la page sont écrites');

const READ = CSV.parseLibrarySections(TEXT);
eq(READ.sections.map((s) => s.key),
  ['compounds', 'cellLines', 'plasmids', 'solvents', 'buffers', 'additives', 'nmrInstruments', 'nmrProbes', 'nmrExperiments'],
  '⚠ les neuf sous-catégories, dans l’ordre du fichier');
eq(READ.sections.map((s) => s.rows.length), [2, 2, 1, 2, 1, 1, 1, 1, 1],
  '⚠ chaque sous-catégorie rend TOUS ses éléments');
eq(READ.total, 12, '…et le total des éléments exportés');
eq(READ.sectioned, true, 'le fichier se dit « à sections »');
const namesIn = (key) => READ.sections.find((s) => s.key === key).rows.map((r) => r.name);
eq(namesIn('compounds'), ['Pep-1', 'Cafeine'], 'les composés sont DANS les composés');
eq(namesIn('cellLines'), ['HeLa', 'CHO'], 'les lignées cellulaires dans les lignées');
eq(namesIn('solvents'), ['D2O', 'CDCl3'], 'les solvants dans les solvants');
eq(namesIn('nmrProbes'), ['CPQCI'], 'la sonde dans les sondes');

/* ── 2. LA RELECTURE DONNE LA FORME DES FICHES, PAS CELLE DU FICHIER ─────────
   « …choose which subcategory or even elements » : le panneau montre ces
   lignes-là, donc elles doivent déjà être des éléments de la page (un champ
   RMN est un NOMBRE, les noyaux sont une LISTE, une sonde a son type ET son
   sous-type séparés). */
const rowOf = (key) => READ.sections.find((s) => s.key === key).rows[0];
const probe = rowOf('nmrProbes');
eq([probe.name, probe.type, probe.subtype, probe.field], ['CPQCI', 'HCN', 'cryo', 600],
  '⚠ une sonde : type et sous-type SÉPARÉS, le champ en NOMBRE');
const exp = rowOf('nmrExperiments');
eq([exp.name, exp.dimensions, exp.nuclei], ['hsqc', '2D', ['H', 'N']],
  '⚠ une expérience RMN : les noyaux reviennent en LISTE');
const solvent = rowOf('solvents');
eq([solvent.name, solvent.density, solvent.molecularWeight], ['D2O', 1.1, 20],
  'un solvant : densité et masse en NOMBRES');
const buffer = rowOf('buffers');
eq([buffer.name, buffer.description, buffer.molecularWeight], ['PBS', 'phosphate', null],
  'un tampon : sa description — et une masse « 0 » n’est pas une masse');
const line = rowOf('cellLines');
eq([line.name, line.organism, line.tissue, line.cultureMedium], ['HeLa', 'Human', 'cervix', 'DMEM'],
  'une lignée : les champs de SA fiche (medium → cultureMedium)');
const plasmid = rowOf('plasmids');
eq([plasmid.name, plasmid.backbone, plasmid.marker, plasmid.molecularWeight], ['pUC19', 'pUC', 'Amp', 1750],
  'un plasmide : squelette, marqueur et masse');
const instrument = rowOf('nmrInstruments');
eq([instrument.name, instrument.frequency, instrument.manufacturer], ['Bruker 600', 600, 'Bruker'],
  'un instrument : sa fréquence, en NOMBRE');
const compound = rowOf('compounds');
eq([compound.name, compound.type, compound.sequence, compound.smiles, compound.molecularWeight],
  ['Pep-1', 'protein', 'MKWV', '', 500],
  'un composé : la séquence sans ses balises HTML, et la masse du fichier');

/* LE FICHIER D'AVANT — sans section du tout, c'est une liste de composés (et le
   panneau le dit) ; une section INCONNUE ne se déverse jamais dans les
   composés : elle est simplement ignorée. */
const bare = CSV.parseLibrarySections('Name,Type\nA,protein\n');
eq(bare.sections.map((s) => [s.key, s.rows.length]), [['compounds', 1]],
  '⚠ un fichier sans section reste une liste de composés');
eq(bare.sectioned, false, '…et le fichier le dit (le panneau l’explique)');
eq(CSV.parseLibrarySections('--- MOLECULES ---\nName,Type\nX,protein\n').sections, [],
  '⚠ une sous-catégorie inconnue ne se déverse pas dans les composés');

/* ── 3. L'IMPORT CHOISI : SEULES LES LIGNES COCHÉES, ET ON COMPLÈTE ──────────
   Le panneau (LibraryImportModal) rend un « plan » : { clé de section : lignes
   cochées }. Ici on fabrique ce plan comme lui, puis on l'applique à un état
   avec `libraryPlanPatch` — le morceau que la page appelle vraiment. */
const pickFrom = (parsed, wanted) => {
  const plan = {};
  parsed.sections.forEach((s) => {
    const rows = s.rows.filter((r) => wanted.includes(r.name));
    if (rows.length) plan[s.key] = rows;
  });
  return plan;
};

/* L'ÉTAT D'AVANT — un composé (avec des liens que le fichier NE PORTE PAS), un
   solvant déjà là (avec un identifiant), rien d'autre. */
const STATE = {
  compoundMeta: { 'Pep-1': { type: 'protein', sequence: 'OLD', notes: 'keep', links: [{ url: 'https://old', description: 'map' }] } },
  customCmpds: ['Pep-1'],
  cellLineMeta: {},
  customCellLines: [],
  plasmidMeta: {},
  solvents: [{ id: 'solv-1', name: 'D2O', density: 0.9, comments: 'old comment' }],
  buffers: [],
  additives: [],
  nmrInstruments: [],
  nmrProbes: [],
  nmrExperiments: [],
};

const partial = pickFrom(READ, ['Cafeine', 'PBS', 'D2O']);
eq(Object.keys(partial).sort(), ['buffers', 'compounds', 'solvents'],
  'le plan ne porte QUE les trois sous-catégories touchées par les lignes cochées');
const patch = CSV.libraryPlanPatch(STATE, partial);
eq(Object.keys(patch).sort(), ['buffers', 'compoundMeta', 'customCmpds', 'solvents'],
  '⚠ seules ces listes changent — une sous-catégorie non cochée n’est pas touchée');
gone(JSON.stringify(Object.keys(patch)), 'cellLine', 'une lignée non cochée du fichier n’entre pas');
eq(patch.buffers.map((b) => b.name), ['PBS'], 'le tampon coché entre, seul');
eq(patch.solvents, [{ id: 'solv-1', name: 'D2O', density: 1.1, molecularWeight: 20, comments: 'NMR' }],
  '⚠ un solvant déjà là est COMPLÉTÉ — et garde son identifiant');
eq(patch.compoundMeta['Pep-1'], STATE.compoundMeta['Pep-1'],
  '⚠ un composé du fichier NON coché reste EXACTEMENT tel qu’il était (même objet de valeurs)');
eq(patch.compoundMeta.Cafeine.name, 'Cafeine', 'le composé coché, lui, entre');
eq(patch.compoundMeta.Cafeine.smiles, 'CN1C=NC2', '…avec son SMILES dans SON champ');
eq(patch.customCmpds, ['Pep-1', 'Cafeine'], 'la liste des composés personnalisés l’accueille, sans doublon');

/* L'ADDITIF, JAMAIS DESTRUCTEUR — c'est la règle de l'import d'une sauvegarde,
   et elle doit valoir ici : le fichier COMPLÈTE, il ne vide pas. */
const again = CSV.libraryPlanPatch(STATE, pickFrom(READ, ['Pep-1']));
eq(again.compoundMeta['Pep-1'].notes, 'ok', 'un composé déjà là est mis à jour par le fichier');
eq(again.compoundMeta['Pep-1'].links, STATE.compoundMeta['Pep-1'].links,
  '⚠ …et ses liens (que le fichier ne porte pas) sont GARDÉS');
eq(again.customCmpds, ['Pep-1'], 'un nom déjà présent n’est pas ajouté deux fois');

/* UNE CELLULE VIDE N'EFFACE RIEN — le fichier d'un tampon sans commentaire ne
   vide pas le commentaire en place ; ce qu'il porte, en revanche, remplace. */
const thin = CSV.parseLibrarySections(CSV.libraryCsvText({ buffers: [{ name: 'PBS', description: 'phosphate', molecularWeight: 0 }] }));
const kept = CSV.libraryPlanPatch({ buffers: [{ id: 'buf-1', name: 'PBS', description: 'old', comments: 'pH 7.4' }] }, { buffers: thin.sections[0].rows });
eq(kept.buffers[0], { id: 'buf-1', name: 'PBS', description: 'phosphate', comments: 'pH 7.4' },
  '⚠ l’identifiant et le commentaire en place survivent, la description du fichier remplace');

/* UNE ENTRÉE NOUVELLE PREND SON NOM POUR IDENTIFIANT — c’est ce qui la rend
   retrouvable à l’écran et sélectionnable dans sa table. */
const added = CSV.libraryPlanPatch({ buffers: [] }, { buffers: READ.sections.find((s) => s.key === 'buffers').rows });
eq(added.buffers, [{ id: 'PBS', name: 'PBS', description: 'phosphate', comments: 'pH 7.4' }],
  'un tampon inconnu est AJOUTÉ, identifié par son nom');
eq(added.buffers.length, 1, '…une seule fois');

/* RIEN DE COCHÉ = AUCUNE ÉCRITURE (le bouton reste inerte). */
eq(CSV.libraryPlanPatch(STATE, {}), {}, 'aucun plan → aucun changement');
eq(CSV.libraryPlanPatch(STATE, null), {}, '…et un plan absent non plus');
eq(CSV.libraryPlanPatch(null, partial).compoundMeta.Cafeine.name, 'Cafeine',
  'un état vide se remplit comme un autre (import dans une librairie neuve)');

/* ── 4. LES QUATRE FICHIERS DE LA PAGE ──────────────────────────────────────
   Le module est éprouvé ci-dessus ; il reste à tenir les BRANCHEMENTS : c'est
   la page qui écrit (elle seule a les setters), la table qui coche, le panneau
   qui choisit. */

/* 4a. L'EXPORT — les neuf listes partent au module, et rien n'est fabriqué à la
   main (le contrat d'écriture reste celui de utils/libraryCsv.js). */
has(LIB, 'const text = libraryCsvText({', 'la page écrit son fichier avec le module partagé');
has(LIB, 'compounds, compoundMeta, cellLines, cellLineMeta, plasmids, plasmidMeta,',
  'l’export reçoit les composés, les lignées et les plasmides');
has(LIB, 'solvents, buffers, additives, nmrInstruments, nmrProbes, nmrExperiments,',
  '…et les six autres sous-catégories : TOUS les éléments sont écrits');
gone(LIB, 'csv.push(', 'la page ne fabrique plus une seule ligne de CSV à la main');

/* 4b. LA SÉLECTION — une colonne de cases dans la table, une confirmation, et
   c'est la PAGE qui supprime (par son callback). */
has(TABLES, 'selectable = false, selectedNames = [], onToggleSelect, onToggleAll, onDeleteSelected',
  'la table de la Librairie sait être sélectionnable');
has(TABLES, 'onChange={() => onToggleAll && onToggleAll(!allOn)}',
  '…sa case d’en-tête coche / décoche toute la table');
has(TABLES, 'checked={selected.has(row.name)}',
  '…et chaque ligne se coche PAR SON NOM (le nom est la clé de la sélection)');
has(TABLES, 'onChange={() => onToggleSelect && onToggleSelect(row.name)}', '…sans ouvrir la fiche au passage');
has(TABLES, '🗑 Delete selected ({picked})', '…et la table montre son « Delete selected »');
has(TABLES, 'colSpan={cols}', '⚠ la ligne vide couvre la colonne de cases ajoutée');
has(LIB, 'const togglePick = (type, name) =>', 'la sélection est tenue par la page, pas par la table');
has(LIB, 'window.confirm(', 'supprimer en bloc demande confirmation');
has(LIB, 'onDeleteResources(type, names);', '⚠ c’est la page qui supprime (onDeleteResources)');
has(LIB, 'groups.forEach(([type, list]) => onDeleteResources(type, list));',
  '…et le bouton global traverse PLUSIEURS sous-catégories d’un coup');
has(LIB, '🗑 Delete selected ({totalPicked})', 'le « Delete selected » de l’en-tête compte toute la sélection');

/* 4c. LES SOUS-CATÉGORIES — chaque table a son type, ce type a ses libellés ET
   sa branche de suppression : pas de type orphelin. */
const TYPES = [...LIB.matchAll(/tableSelection\('([a-zA-Z]+)'/g)].map((m) => m[1]);
eq(TYPES.sort(), ['additive', 'buffer', 'cellLine', 'compound', 'nmrExperiment', 'nmrInstrument', 'nmrProbe', 'plasmid', 'solvent'],
  '⚠ les neuf sous-catégories ont chacune une table sélectionnable');
TYPES.forEach((type) => {
  has(MODULE, `type === '${type}'`, `la page sait supprimer « ${type} » EN BLOC`);
  has(LIB, `${type}: '`, `le libellé de « ${type} » existe (message de confirmation)`);
});
has(MODULE, "if (type === 'compound') { setCompoundMeta(dropMeta); setCustomCmpds(dropNames); return; }",
  '⚠ un composé quitte AUSSI sa liste personnalisée (la règle de sa fiche)');
has(MODULE, "if (type === 'solvent') { setSolvents(dropNames); return; }",
  'un solvant se retire de sa liste — comme le fait son gestionnaire');

/* 4d. L'IMPORT CHOISI — le panneau montre les sous-catégories, laisse cocher
   les éléments, et rend un plan que la page applique. */
has(MODAL, '▸ choose entries', 'le panneau ouvre la liste des éléments d’une sous-catégorie');
has(MODAL, 'onChange={() => toggleSection(s)}', 'sa case de sous-catégorie coche / décoche le tout');
has(MODAL, 'onChange={() => toggleRow(s, row.name)}', '…et une case d’élément prend chaque ligne une par une');
has(MODAL, '/** LE PLAN — les lignes cochées, par sous-catégorie',
  '⚠ le panneau rend un plan par sous-catégorie');
has(MODAL, 'if (rows.length) out[s.key] = rows;', '…où une sous-catégorie vidée de ses cases ne figure pas');
has(MODAL, 'disabled={pickedCount === 0}', 'rien de coché → le bouton d’import est inerte');
has(MODAL, 'useState(() => new Set())', 'au départ, TOUT est coché (l’import par défaut reste « tout »)');
has(LIB, 'parseLibrarySections(event.target.result)', 'la page relit le fichier PAR SOUS-CATÉGORIE');
has(LIB, '<LibraryImportModal', '…puis ouvre le panneau de sélection');
has(LIB, 'if (onImportLibrary) onImportLibrary(plan);', '⚠ …dont le plan part vers la page');
has(MODULE, 'const patch = libraryPlanPatch({', 'la page applique la fusion du module partagé');
has(MODULE, 'alert(`Imported into the library:', '…et dit à l’écran ce qui est entré');
has(APP, 'solvents={solvents} setSolvents={setSolvents} buffers={buffers} setBuffers={setBuffers}',
  '⚠ l’application passe bien les setters des listes à la page Librairie');

/* 4e. LA FICHE DU COMPOSÉ GARDE SON CONTRAT — le bouton « Import CSV » de la
   fiche n’importe toujours QUE les composés (les huit autres sections ne
   deviennent pas des composés) : c’est _library_csv_roundtrip_test.mjs qui le
   prouve en détail, ici on tient seulement que le nouveau lecteur ne l’a pas
   remplacée. */
has(CARD, 'const { compounds: rows, sections, sectioned } = parseLibraryCsv(event.target.result);',
  'la fiche du composé relit toujours avec SON lecteur (composés seulement)');
gone(CARD, 'parseLibrarySections', '…le lecteur par sous-catégorie n’a pas débordé sur la fiche');

console.log(`_library_bulk_ops_test.mjs — ${passed} assertions OK (la Librairie se sélectionne et se supprime EN BLOC, s'exporte ENTIÈRE — les neuf sous-catégories, tous leurs éléments — et se recharge PAR SOUS-CATÉGORIE ou par éléments : fusion additive, par nom, jamais destructrice)`);





