/* ============================================================================
   _docking_virgin_page_test.mjs — UNE PAGE DE DOCKING NE MONTRE QUE LA
   STRUCTURE QUE LE DATASET DÉCLARE (et rien du tout quand il n'en déclare
   aucune).

   LE DÉFAUT VISÉ, dit par le rapport : « some docking tests do not load
   automatically the structure they are supposed to load. By default the
   structure of a protein appears that has nothing to do with the dataset (its
   sequence starts with MQIFVKTL), sometimes after a while the correct
   structure appears but not always. a new docking page when data have not been
   loaded yet should not contain default data, it must be virgin ».

   `MQIFVKTL…` = l'UBIQUITINE du RCSB (`1UBQ`), la protéine de DÉMONSTRATION que
   DockingSections.jsx fabriquait dès qu'un récepteur était « défini » (une
   séquence tapée, un SMILES, un composé de la Librairie) sans qu'aucune
   structure ne soit chargée. Elle n'appartient à aucun dataset et venait du
   RÉSEAU : elle s'affichait donc parfois AVANT — ou À LA PLACE de — la bonne.

   Les DEUX règles vérifiées ici :
     1. la source de structure est CELLE DU DATASET (`utils/dockingStructureSrc.js`),
        sinon '' — la page est vierge (aucune structure par défaut) ;
     2. ce qui manque à la base du navigateur est RE-TÉLÉCHARGÉ par le lien que
        le dataset porte (`utils/dockingDeclaredFiles.js`) — l'archive
        `<instance>_docking_restore.json.gz` n'existe QUE depuis qu'un poste a
        importé le dossier de calcul, et sans elle un import ancien restait sans
        la structure qu'il devait montrer.

   Les modules sont IMPORTÉS pour de vrai (ils sont purs) ; le JSX est vérifié
   par analyse de source, comme _docking_viewer_restore_test.mjs.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dockingStructureSrcOf, isDirectStructureSrc, rcsbModelUrl, PDB_CODE_RE } from './src/utils/dockingStructureSrc.js';
import { declaredDockingFiles, fetchDeclaredDockingFiles, missingDeclaredDockingFiles, structureNameKey } from './src/utils/dockingDeclaredFiles.js';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (got, want, what) => {
  assert.deepEqual(got, want, `${what}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
  passed += 1;
};

const SRC = readFileSync('src/components/DockingSections.jsx', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. LA PAGE NE FABRIQUE PLUS AUCUNE STRUCTURE ───────────────────────────
   Les trois protéines de démonstration (ubiquitine 1UBQ, ADN 1BNA, ARN 1EHZ)
   et la condition qui les déclenchait (`hasDefinedSystem`) ont disparu. */
ok(!SRC.includes('models.rcsb.org/1UBQ'), 'plus d’ubiquitine de démonstration (1UBQ) sur la page docking');
ok(!SRC.includes('1BNA') && !SRC.includes('1EHZ'),
  '…ni les deux autres modèles du RCSB (1BNA / 1EHZ)');
ok(!SRC.includes('hasDefinedSystem'),
  '…et plus la condition « un système est défini → montrons une protéine générique »');
ok(SRC.includes('dockingStructureSrcOf({') && SRC.includes('structureSrc: activeTest.structureSrc, pdbId: activeTest.pdbId'),
  'la source de structure passe par le module PUR qui ne lit QUE le dataset');

/* ── 2. LE DATASET DÉCLARE, LA PAGE OBÉIT (règle pure) ───────────────────── */
eq(dockingStructureSrcOf({}), '', 'une expérience neuve n’a AUCUNE source de structure (page vierge)');
eq(dockingStructureSrcOf({ proteinSequence: 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQR', moleculeType: 'protein' }), '',
  '…même avec une séquence de récepteur : rien n’est fabriqué (c’était le défaut)');
eq(dockingStructureSrcOf({ smiles: 'CCO', selectedCompounds: ['Aspirine'] }), '',
  '…ni avec un SMILES / un composé de la Librairie');
eq(dockingStructureSrcOf({ structureSrc: '   ' }), '', 'un champ vidé de ses espaces vaut « rien »');
eq(dockingStructureSrcOf({ structureSrc: '5IF1' }), 'https://models.rcsb.org/5IF1.mmtf',
  'un code PDB déclaré (dataset réel : 5IF1, 4QVE, 2BZW…) charge CE code');
eq(dockingStructureSrcOf({ structureSrc: ' 5if1 ' }), 'https://models.rcsb.org/5IF1.mmtf',
  '…espaces et minuscules compris (le RCSB écrit en majuscules)');
eq(dockingStructureSrcOf({ pdbId: '2BZW' }), 'https://models.rcsb.org/2BZW.mmtf',
  'l’ancien nom du champ (pdbId) est honoré, lui aussi');
eq(dockingStructureSrcOf({ structureSrc: 'https://example.org/rec.pdb' }), 'https://example.org/rec.pdb',
  'une URL se charge telle quelle');
eq(dockingStructureSrcOf({ structureSrc: '/structures/template_amino_acid.pdb' }), '/structures/template_amino_acid.pdb',
  'un chemin du site se charge tel quel');
eq(dockingStructureSrcOf({ structureSrc: 'blob:http://x/9f1' }), 'blob:http://x/9f1', 'un blob (fichier déposé) aussi');
eq(dockingStructureSrcOf({ structureSrc: 'data:chemical/x-pdb;base64,AAAA' }), 'data:chemical/x-pdb;base64,AAAA',
  '…et une data URL');
eq(dockingStructureSrcOf({ structureSrc: 'run/data/0_topoaa/receptor.pdb' }), 'run/data/0_topoaa/receptor.pdb',
  'un chemin relatif reste lui-même');
eq(rcsbModelUrl('oops'), '', 'un code invalide ne fabrique AUCUNE URL (rien plutôt qu’une devinette)');
ok(PDB_CODE_RE.test('1ubq') && PDB_CODE_RE.test('9XYZ') && !PDB_CODE_RE.test('UBQ') && !PDB_CODE_RE.test('1UBQ2'),
  'la reconnaissance d’un code PDB est la même que celle de la page NMR');
ok(isDirectStructureSrc('https://a/b') && isDirectStructureSrc('/a/b') && !isDirectStructureSrc('1UBQ') && !isDirectStructureSrc(''),
  'une source « directe » est une URL / un chemin absolu — jamais un code nu ni du vide');

/* ── 3. LES FICHIERS QUE LE DATASET DÉCLARE (règle pure) ─────────────────── */
const TEST = {
  dockingStructures: [
    { name: 'cluster_1_model_1.pdb', driveUrl: 'https://drive.google.com/file/d/AAA/view' },
    { name: 'cluster_1_model_2.pdb', driveUrl: 'https://drive.google.com/file/d/BBB/view' },
    { name: 'cluster_2_model_1.pdb', driveUrl: '' }            // envoi Drive manqué : rien à télécharger
  ],
  dockingMolecules: [
    { name: 'TAC', fileName: 'conformers_TAC_-em_FILTRED.pdb', sourcePath: 'HADDOCK files/data/0_topoaa/conformers_TAC_-em_FILTRED.pdb', segid: 'A', driveUrl: 'https://drive.google.com/file/d/CCC/view' }
  ]
};
const ALL_STRUCTS_LOCAL = [
  { name: 'cluster_1_model_1.pdb', pdb: 'ATOM' },
  { name: 'cluster_1_model_2.pdb', pdb: 'ATOM' },
  { name: 'cluster_2_model_1.pdb', pdb: 'ATOM' }
];

eq(declaredDockingFiles({}), [], 'sans métadonnées d’import : aucun fichier déclaré');
const declared = declaredDockingFiles(TEST);
eq(declared.map((f) => `${f.kind}:${f.name}`),
  ['structure:cluster_1_model_1.pdb', 'structure:cluster_1_model_2.pdb', 'molecule:TAC'],
  'les structures ET les molécules sont déclarées, dans l’ordre du dataset');
ok(declared.every((f) => !!f.url), '…et chacune porte bien son lien (l’entrée sans lien est écartée)');
eq(declared[2].meta.segid, 'A', 'la molécule garde ses métadonnées (segid, fileName, sourcePath)');

eq(structureNameKey('8_seletopclusts/cluster_1_model_1.pdb'), 'cluster_1_model_1',
  'un nom est ramené à son radical (dossier et extension retirés)');
eq(structureNameKey('cluster_1_model_1.pdb.gz'), 'cluster_1_model_1', '…le `.gz` du dossier de calcul aussi');
eq(structureNameKey('CLUSTER_1_MODEL_1.PDB'), 'cluster_1_model_1', '…majuscules / minuscules ignorées');

eq(missingDeclaredDockingFiles({ test: TEST }).length, 3, 'rien en base → les 3 fichiers déclarés manquent');
const partiallyHave = missingDeclaredDockingFiles({
  test: TEST,
  structures: [{ name: '8_seletopclusts/cluster_1_model_1.pdb.gz', pdb: 'ATOM' }],
  molecules: []
});
eq(partiallyHave.map((f) => f.name), ['cluster_1_model_2.pdb', 'TAC'],
  'un PDB déjà en base (même écrit `…/cluster_1_model_1.pdb.gz`) n’est PAS re-téléchargé');
eq(missingDeclaredDockingFiles({ test: TEST, structures: ALL_STRUCTS_LOCAL, molecules: [{ name: 'TAC' }] }), [],
  'quand tout est là, plus rien ne manque (aucune requête inutile)');

/* ── 4. LE TÉLÉCHARGEMENT (faux réseau) ──────────────────────────────────── */
const ATOM = 'ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N';
const calls = [];
const fetchText = async (file) => {
  calls.push(file.name);
  if (file.name === 'TAC') throw new Error('réseau injoignable');
  return ATOM;
};

const fetchedAll = await fetchDeclaredDockingFiles({ test: TEST, have: {}, fetchText });
eq(fetchedAll.structures.map((s) => s.name), ['cluster_1_model_1.pdb', 'cluster_1_model_2.pdb'],
  'les structures déclarées sont ramenées');
eq(fetchedAll.structures[0], { name: 'cluster_1_model_1.pdb', pdb: ATOM, driveUrl: 'https://drive.google.com/file/d/AAA/view' },
  '…dans la forme EXACTE que l’import range en base ({ name, pdb, driveUrl })');
eq(fetchedAll.fetched, ['cluster_1_model_1.pdb', 'cluster_1_model_2.pdb'], '…et nommées comme récupérées');
eq(fetchedAll.failed, ['TAC'], 'un fichier injoignable est DIT (jamais compté comme récupéré)');
eq(fetchedAll.molecules, [], '…et n’entre pas dans la base (rien n’est inventé)');

const molOnly = await fetchDeclaredDockingFiles({
  test: { dockingMolecules: TEST.dockingMolecules }, have: {}, fetchText: async () => ATOM
});
eq(molOnly.molecules, [{
  segid: 'A', fileName: 'conformers_TAC_-em_FILTRED.pdb',
  sourcePath: 'HADDOCK files/data/0_topoaa/conformers_TAC_-em_FILTRED.pdb',
  name: 'TAC', driveUrl: 'https://drive.google.com/file/d/CCC/view', hasPdb: true, pdb: ATOM
}], 'une molécule ramenée porte ses métadonnées + son PDB (`hasPdb: true`)');

calls.length = 0;
await fetchDeclaredDockingFiles({
  test: TEST,
  have: { structures: [{ name: 'cluster_1_model_1.pdb' }], molecules: [{ name: 'TAC' }] },
  fetchText
});
eq(calls, ['cluster_1_model_2.pdb'], 'ce qui est déjà en base n’est PAS re-téléchargé (une seule requête)');

eq(await fetchDeclaredDockingFiles({ test: TEST, have: {} }), { structures: [], molecules: [], fetched: [], failed: [] },
  'sans téléchargeur injecté, la fonction ne tente rien et ne lève pas');
eq(await fetchDeclaredDockingFiles({ test: TEST, have: {}, fetchText: async () => '   ' }),
  { structures: [], molecules: [], fetched: [], failed: ['cluster_1_model_1.pdb', 'cluster_1_model_2.pdb', 'TAC'] },
  'une réponse VIDE vaut un échec (jamais un fichier vide rangé comme structure)');


/* ── 5. LE CÂBLAGE DANS LA PAGE (analyse de source) ──────────────────────── */
ok(SRC.includes("src={selectedStruct ? '' : structureSrc}"),
  'la structure du CLUSTER reste prioritaire sur la source du dataset');
ok(SRC.includes('structureText={selectedStruct ? selectedStruct.pdb : undefined}'),
  '…et c’est bien son texte PDB qui est servi au viewer');
ok(SRC.includes('fetchDeclaredDockingFiles({') && SRC.includes('fetchText: downloadDeclaredDockingText'),
  'la restauration télécharge les fichiers QUE LE DATASET DÉCLARE (le repli qui manquait)');
ok(SRC.includes('missingDeclaredDockingFiles({'),
  '…et « il manque quelque chose » tient compte des fichiers déclarés absents (2 sur 4 → il manque)');
ok(SRC.includes('downloadCloudFile(id ? { id } : { url }'),
  'le téléchargement passe par le noyau Drive/Nextcloud (jeton, corbeille, fournisseur)');
ok(SRC.includes('bytes[0] === 0x1f && bytes[1] === 0x8b'),
  'un `.pdb.gz` déposé sur le Drive est décompressé (octets magiques gzip)');
ok(SRC.includes('if (structs.length) await storeJson(dockingStructKey, structs);'),
  'la base du navigateur est réapprovisionnée (le viewer relit cette clé)');
ok(SRC.includes("dockingStructures: structs.map((s) => ({ name: s.name, driveUrl: s.driveUrl || '' }))"),
  '…et les métadonnées du test sont touchées, ce qui RÉVEILLE structList');
ok(SRC.includes('no copy was found on Google Drive') && SRC.includes('holds no structures — re-import the calculation directory.'),
  'les deux messages d’échec d’origine sont conservés mot pour mot (ils portent le geste à faire)');
ok(SRC.includes('const source = found ? found.name :'),
  'le message de réussite ne présume plus qu’une archive a été lue (elle peut manquer)');

console.log(`${passed} passed`);

