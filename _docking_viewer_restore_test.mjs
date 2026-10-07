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

/* ── 7bis. LE REGARD SURVIT AU SWITCH, PAS SEULEMENT LE ZOOM ─────────────────
   Rapport suivant : « when I change the molecule not only the zoom must be
   conserved but also the style (style of the molecule, the background etc.) ».
   La caméra était tenue ; le REGARD ne l'était pas : une section ne retrouvait son
   arbre de la barre que si le fichier suivant lui donnait le MÊME ID GLOBAL
   (`main::protein|A`), et un fichier qui nomme autrement ses chaînes, ses molécules
   ou ses ligands repartait des défauts du TYPE — exactement ce que la barre montre.
   Le viewer photographie donc, au MÊME moment que la caméra, les trois choses qu'un
   geste de la barre écrit (l'arbre de chaque section, son ✔, ses étiquettes 🏷), et
   les repose sur la molécule chargée : le lecteur est celui des poses de film
   (poseStylesForSections), qui retrouve une section par son id PUIS par sa CLÉ
   LOCALE. Le FOND, lui, n'est pas un réglage d'une molécule : il n'a jamais bougé. */
ok(VIEWER.includes('const carryLookOnNextLoadRef = useRef(null);'),
  'le viewer retient un SECOND vœu : le regard de la molécule qui s’en va (styles de la barre, ✔, étiquettes)');
ok(VIEWER.includes('carryLookOnNextLoadRef.current = preserveViewOnNextLoadRef.current ? captureSwitchLook() : null;'),
  'la photographie est prise au MÊME moment que celle de la caméra — donc AVANT que la scène ne soit vidée');
ok(VIEWER.includes('const captureSwitchLook = () => ({'), 'la capture du regard est UNE fonction');
ok(VIEWER.includes('looks: captureSectionLooksForPose(),'), '…elle prend l’arbre EFFECTIF de chaque section');
ok(VIEWER.includes('vis: captureSectionVisForPose(),'), '…le ✔ effectif de chaque section (ce qui est caché voyage aussi)');
ok(VIEWER.includes('if (!carry || !comp) return false;'),
  'sans vœu — un premier chargement, un fichier choisi à la main — RIEN n’est touché');
ok(VIEWER.includes('carryLookOnNextLoadRef.current = null;'),
  '…et le vœu est CONSOMMÉ : aucun chargement suivant n’en hérite');
ok(VIEWER.includes('try { sections = ensureSections(comp, molKeyOfComp(comp)); } catch { sections = []; }'),
  'les sections de la molécule qui arrive sont énumérées par la MÊME porte que la barre');
ok(VIEWER.includes('const pose = poseStylesForSections(carry.looks, carry.vis, sections);'),
  'le lecteur est CELUI des poses (par id, puis par CLÉ LOCALE) : un fichier qui renomme ses chaînes garde ses styles');
ok(VIEWER.includes('byKey[localKeyOfSectionId(id)] = one;'),
  '…et les étiquettes 🏷 se retrouvent par clé locale, elles aussi');
ok(VIEWER.includes('sectionLooksRef.current = { ...sectionLooksRef.current, ...pose.looks };'),
  'les REFS d’abord : le constructeur des représentations les lit hors du rendu');
ok(VIEWER.includes('if (labels) setSectionLabels((prev) => ({ ...prev, ...labels }));'),
  '…puis l’état, pour que la barre le montre');
ok(VIEWER.includes('applySwitchLook(component);'), '…et le geste est appelé au chargement de la molécule');
ok(VIEWER.indexOf('applySwitchLook(component);') < VIEWER.indexOf('if (keepView) applyCameraPose(keepView);'),
  '…juste AVANT la caméra : le switch repose le regard ET le point de vue');

/* ── 8. LA VRAIE CAUSE DU ZOOM PERDU : LE VIEWER ÉTAIT REMONTÉ ───────────────
   Rapport suivant : « je prends la première structure, je zoome, je passe à la
   suivante → la première disparaît, écran vide un moment, puis la seconde apparaît
   NON zoomée. » Diagnostic : la clé React du viewer portait le NOM de la structure
   choisie. Changer de structure changeait donc la clé, React démontait puis
   remontait tout le viewer (nouvelle scène WebGL) : aucune ref de caméra ne survit
   à un remontage, et le premier montage recadre (`autoView()`). Le correctif de la
   section 7 (preserveViewOnNextLoadRef) était donc inopérant tant que le viewer
   était remonté. La clé ne doit dépendre QUE de l'expérience, jamais de la
   structure : le MÊME viewer reçoit le nouveau `structureText`. */
ok(!SRC.includes("+ (selectedStruct ? '::' + selectedStruct.name : '')"),
  'la clé du viewer ne suit PLUS la structure choisie (sinon remontage → zoom perdu)');
ok(SRC.includes("key={((activeTest && activeTest.id) || 'docking')}"),
  '…elle ne dépend que de l’expérience : le MÊME viewer reçoit le nouveau structureText');

/* ── 9. UNE EXPÉRIENCE NEUVE EST VIERGE ──────────────────────────────────────
   Rapport : « quand je crée un nouvel essai de docking, il n'est pas vierge mais
   contient déjà des données — mieux vaudrait le vider. »

   Cause : la page d'expérience n'est re-montée que par la clé
   `test-page-${testPageNonce}` (App.jsx) — jamais par l'id. Changer d'expérience
   ne change PAS cette clé, donc DockingSections reste MONTÉE et ses états LOCAUX
   (structList, structIdx, molecules, ligandInfo, rapport d'import) survivent au
   changement. Pire : les effets de relecture de la base ne remettaient RIEN à
   zéro quand la valeur lue n'était pas un tableau (nouvelle clé → null), donc la
   liste des structures de l'expérience PRÉCÉDENTE restait affichée dans le viewer.

   Correctif : les deux relectures écrasent désormais l'état même quand la valeur
   lue est absente (→ [] / null), ET des effets keyés sur `structKey` / `molKey`
   (qui contiennent l'id) remettent à zéro la sélection, la lecture du ligand,
   l'ouverture de la formule et le rapport d'import. */
const APP = readFileSync('src/App.jsx', 'utf8');
ok(APP.includes('key={`test-page-${testPageNonce}`}'),
  'la page d’expérience est re-montée par le NONCE — pas par l’id (changer d’expérience ne remonte donc rien)');

ok(SRC.includes('.then((list) => { if (!cancelled) setStructList(Array.isArray(list) ? list : []); })'),
  'la liste des structures est REMISE À VIDE quand la nouvelle expérience n’a rien importé');
ok(SRC.includes('.then((list) => { if (!cancelled) setMolecules(Array.isArray(list) ? list : null); })'),
  'idem pour les « Molecules to be docked »');
ok(SRC.includes('useEffect(() => { setOpenIdx(null); }, [molKey]);'),
  'changer d’expérience referme le « show structure » des molécules');
ok(/useEffect\(\(\) => \{\s*setStructIdx\(0\);[\s\S]*?\}, \[structKey\]\);/.test(SRC),
  '…et remet la sélection de structure / le ligand à zéro au moment EXACT où l’id change');
ok(SRC.includes('setStructIdx(0);') && SRC.includes('setLigandInfo(null);'),
  '…avec la lecture du ligand (SMILES) de la nouvelle expérience, pas de la précédente');

const importPanel = SRC.slice(SRC.indexOf('const DockingImportPanel = ({ ctx, onPoses }) => {'));
ok(importPanel.includes('setReport(null);') && importPanel.includes('}, [activeTestId]);'),
  'le rapport d’import ne suit pas non plus la nouvelle expérience');


/* ── 10. « UNE PAGE DE DOCKING NEUVE EST VIERGE » — LES POSES D'EXEMPLE AUSSI ──
   La section 9 vide les états LOCAUX, mais la TABLE des scores restait remplie : tant
   qu'aucun run n'était importé, `poses` valait une liste INVENTÉE
   (generateHADDOCKPoses(12) / generateDockingPoses(9)), donc toute la moitié « Data »
   de la page (table, nuage « énergie vs. écart », cartes de métriques) affichait des
   nombres qui n'existent nulle part. La demande de cette session : « when I create a
   docking page it is never virgin because there are example data but I would prefer it
   to be empty. » */
ok(!SRC.includes('generateHADDOCKPoses') && !SRC.includes('generateDockingPoses'),
  'la page ne connaît plus les générateurs de poses d’exemple (ni importés, ni appelés)');
ok(SRC.includes('() => (Array.isArray(activeTest.dockingPoses) ? activeTest.dockingPoses : []),'),
  '…elle ne lit QUE `activeTest.dockingPoses` : absent veut dire « rien à montrer »');
ok(!/return dockingProgram === 'haddock'/.test(SRC),
  '…et plus aucune branche ne fabrique neuf poses selon le programme choisi');


console.log(`${passed} passed`);
