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
ok(/\{isOpen && <div className="p-3">\{children\}<\/div>\}/.test(UI),
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

console.log(`${passed} passed`);
