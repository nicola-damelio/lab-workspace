/* =========================================================================
   _docking_viewer_restore_test.mjs — LE VIEWER 3D DOCKING DOIT RESTAURER.

   Le défaut visé : sur un poste vierge (ou cache vidée), la page de docking
   montrait une structure GÉNÉRÉE / 2D au lieu des PDB « 8_seletopclusts »
   restaurés du Drive.

   Cause : les textes PDB vivent dans la base du NAVIGATEUR (IndexedDB, LOCALE).
   Le déclencheur de restauration (useDriveAutoRestore) était branché dans
   DockingDataSection — rendue DANS la section « Data », repliée par défaut
   (`defaultOpen={false}`), dont CollapsibleSection ne monte PAS les enfants
   (ui.jsx : `{isOpen && <div>{children}</div>}`). La restauration ne partait
   donc jamais tant que l'utilisateur n'ouvrait pas « Data ».

   Pendant ce temps, la section « Molecular structure » (DockingExperimentSetup
   Section) s'ouvre TOUTE SEULE (openWhen sur dockDockingStructures) et affiche
   le viewer : structList vide → hasDockStructs faux → structureMode '2d' →
   formule 2D dérivée de la séquence.

   Le correctif : un hook PARTAGÉ (useDockingDriveRestore) appelé par la section
   « structure » (celle qui montre le viewer, donc montée dès qu'un import est
   attendu) — et, pour le bouton de secours, par la section « Data ». Le
   portillon claimRestore garantit une seule tentative par expérience/session.

   Vérifié ici par analyse de source (les composants sont du JSX, non importables
   en Node) : le câblage exact décrit ci-dessus.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };

const SRC = readFileSync('src/components/DockingSections.jsx', 'utf8');
const TYPE = readFileSync('src/components/DockingTestRenderer.jsx', 'utf8');
const SHELL = readFileSync('src/components/TestShellRenderer.jsx', 'utf8');
const UI = readFileSync('src/components/ui.jsx', 'utf8');

// Découpe un composant / hook : de son en-tête au prochain `export const`.
const bodyOf = (startAnchor) => {
  const start = SRC.indexOf(startAnchor);
  assert.ok(start >= 0, `ancre introuvable : ${startAnchor}`);
  const rest = SRC.slice(start + startAnchor.length);
  const nextExport = rest.indexOf('\nexport const ');
  return nextExport >= 0 ? rest.slice(0, nextExport) : rest;
};

/* ── 1. La cause : CollapsibleSection ne MONTE PAS ses enfants repliés ────── */
ok(/isOpen && <div className="p-3">\{children\}<\/div>/.test(UI),
  'CollapsibleSection ne monte ses enfants que quand la section est OUVERTE');

ok(/title="Data" icon="🔢" defaultOpen=\{false\}/.test(SHELL),
  'la section « Data » (qui portait la restauration) est repliée par défaut');
ok(/title="Molecular structure and visualization"[\s\S]*?openWhen=\{!!\(t\.dockingStructures && t\.dockingStructures\.length\)\}/.test(SHELL),
  'la section « Molecular structure » (le viewer) s’ouvre TOUTE SEULE dès qu’un import est attendu');

/* ── 2. Le viewer 3D vit bien dans DockingExperimentSetupSection ─────────── */
ok(TYPE.includes('MolecularStructure: DockingExperimentSetupSection'),
  'docking : MolecularStructure = DockingExperimentSetupSection (le viewer)');
const setup = bodyOf('export const DockingExperimentSetupSection = ({ ctx }) => {');
ok(setup.includes('<NMRMoleculeViewer'), 'c’est bien la section qui rend le viewer 3D');
ok(setup.includes('hasDockStructs ? \'3d\' : \'2d\''),
  '…et c’est structList (base du navigateur) qui choisit 2D vs 3D');

/* ── 3. Le correctif : un hook partagé, appelé par le VIEWER ─────────────── */
const hook = bodyOf('const useDockingDriveRestore = ({ activeTest, updateActiveTest }) => {');
ok(hook.includes('const dockingRestore = useDriveAutoRestore({'),
  'le hook partagé branche le déclencheur automatique');
ok(hook.includes('restore: restoreDockingFromDrive'),
  '…avec sa restauration métier');
ok(hook.includes('const structs = await loadJson(dockingStructKey).catch(() => null);'),
  'la restauration regarde la base du navigateur (IndexedDB) avant de télécharger');
ok(hook.includes('if (structs.length) await storeJson(dockingStructKey, structs);'),
  '…et y remet les structures restaurées (le viewer relit la base)');
ok(hook.includes('dockingStructures: structs.map((s) => ({ name: s.name, driveUrl: s.driveUrl || \'\' }))'),
  '…et met à jour les métadonnées du test (ce qui RÉVEILLE structList)');
ok(hook.includes("takePendingRestorePointer({ field: 'dockingDrive', key: activeTest.id || 'global' })"),
  'un pointeur arrivé après un changement d’expérience attend son tour');

ok(setup.includes('const dockingRestore = useDockingDriveRestore({ activeTest, updateActiveTest });'),
  'LA SECTION DU VIEWER déclenche la restauration (le correctif)');
ok(setup.includes("dockingRestore.attempt('manual')"),
  '…et offre le bouton de secours « Restore from Drive » là où l’on voit les structures');

/* ── 4. La section « Data » garde le bouton, sans redéclarer la mécanique ── */
const data = bodyOf('export const DockingDataSection = ({ ctx }) => {');
ok(data.includes('const dockingRestore = useDockingDriveRestore({ activeTest, updateActiveTest });'),
  'la section « Data » réutilise le MÊME hook (bouton de secours de l’import)');
ok(!data.includes('useDriveAutoRestore('),
  'plus de SECONDE mécanique dans « Data » : une seule source de vérité');

/* ── 5. L'IMPORT LIT AUSSI LES STRUCTURES ENFERMÉES DANS UN .zip ─────────────
   Le défaut rapporté : « les pdb de 8_seletopclusts sont parfois dans un zip ;
   le programme récupère/convertit les fichiers mais le viewer ne les montre PAS
   et régénère la structure depuis la séquence. » L'import ouvre donc les
   archives .zip du dossier de calcul et en lit les entrées .pdb[.gz], comme
   les fichiers posés à plat. */
const importer = bodyOf('const DockingImportPanel = ({ ctx, onPoses }) => {');
ok(SRC.includes("import { gunzipSync, unzipSync } from 'fflate';"),
  'fflate fournit aussi le désarchiveur (unzipSync)');
ok(importer.includes('const zipFiles = list'),
  'l’import recense les archives .zip du dossier de calcul');
ok(importer.includes('const structByName = new Map()'),
  '…en dédoublonnant par nom de structure');
ok(importer.includes('unzipSync(new Uint8Array(await readArrayBuffer(zf)))'),
  '…et OUVRE chaque archive (fflate unzipSync)');
ok(importer.includes('0x1f && bytes[1] === 0x8b'),
  '…en reconnaissant une entrée gzip (magic) comme une entrée .pdb simple');
ok(importer.includes('keepStruct(entryName, pdbText, null)'),
  '…pour nourrir le MÊME chemin de stockage que les .pdb posés à plat');
ok(importer.includes('const inStructDir ='),
  'les .zip de 8_seletopclusts/ sont examinés en premier');

/* ── 6. LE MODÈLE DE LA SÉQUENCE NE REMPLACE PLUS LA STRUCTURE DU CLUSTER ────
   Défaut rapporté : même quand les PDB « 8_seletopclusts » sont bien captés et
   rangés, le viewer montrait ENCORE la protéine linéarisée. Cause : le viewer a
   DEUX effets de chargement — le texte servi par la page (`structureText`, le PDB
   du cluster) puis le modèle de la séquence (`sequenceStructureText`) — qui
   s'exécutent dans le MÊME rendu, dans cet ordre. Le premier marque l'origine
   « generated » (JAMAIS « external »), donc le second ne le voyait pas comme une
   structure posée et écrasait le cluster (les deux posent le même `loadRequest`).
   Le viewer doit donc CÉDER au texte de la page : c'est la règle « un PDB chargé
   reste prioritaire » promise par les pages MD et Docking. */
const VIEWER = readFileSync('src/components/NMRMoleculeViewer.jsx', 'utf8');
ok(VIEWER.includes('if (structureText && structureText === lastLoadedTextRef.current) return;'),
  'le modèle de la séquence CÈDE à la structure servie par la page (cluster 8_seletopclusts / PDB chargé)');
ok(/}, \[structOrigin, sequenceStructureText, sequenceStructureExt, loadRequest, structureText\]\);/.test(VIEWER),
  '…et l’effet suit aussi ce texte (structureText ajouté aux dépendances)');
ok(VIEWER.includes("if (structOrigin === 'external') return;"),
  '…sans retirer le garde existant (un PDB chargé par l’utilisateur garde la priorité)');

/* ── 7. LE POINT DE VUE SURVIT AU SWITCH DE STRUCTURE (« 8_seletopclusts structure ») ──
   Demande : « quand je passe d'une structure à la suivante via le dropdown, le zoom ne
   doit pas se réinitialiser — je veux continuer à voir la macromolécule à la même
   position et le ligand qui change. »

   Les PDB « 8_seletopclusts » d'un même run partagent le repère du récepteur : aucun
   alignement (fit RMSD) n'est nécessaire pour les superposer. Ce qui faisait « sauter »
   le zoom était le recadrage `component.autoView()` du chargement principal, exécuté à
   chaque nouveau `loadRequest`. Le viewer CAPTURE donc le point de vue (les mêmes
   helpers que les poses de film, cameraPose / applyCameraPose) AVANT de vider la scène,
   et le REPOSE après — à la place d'autoView — quand la page REMPLACE sa propre
   structure (switch), jamais au tout premier chargement. */
ok(VIEWER.includes('const lastStructureTextRef = useRef(null);'),
  'le viewer retient le texte de structure actuellement servi par la page');
ok(VIEWER.includes('const preserveViewOnNextLoadRef = useRef(false);'),
  '…et un vœu « garder la caméra » porté jusqu’au chargement principal');
ok(VIEWER.includes('preserveViewOnNextLoadRef.current = !!lastStructureTextRef.current;'),
  'seul un SWITCH (une structure de page était déjà affichée) garde la caméra — le 1er texte se cadre');
ok(VIEWER.includes('lastStructureTextRef.current = null;'),
  '…et quand la page ne sert plus de structure, le prochain texte recadre');
ok(VIEWER.includes('const keepView = preserveViewOnNextLoadRef.current ? cameraPose() : null;'),
  'le chargement principal capture la caméra AVANT de vider la scène (cameraPose)');
ok(VIEWER.includes('preserveViewOnNextLoadRef.current = false;'),
  '…et consomme le vœu (aucun chargement ultérieur n’en hérite)');
ok(VIEWER.includes('if (keepView) applyCameraPose(keepView);'),
  '…puis repose le point de vue (orientation + position + zoom) au lieu d’autoView');
ok(VIEWER.includes('else { try { component.autoView(); } catch {} }'),
  '…autoView ne s’exécute plus que quand la caméra n’a PAS à être gardée');

console.log(`${passed} passed`);
