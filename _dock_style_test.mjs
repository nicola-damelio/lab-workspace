/* =========================================================================
   _dock_style_test.mjs — plus AUCUN réglage de style « docking » dans le viewer.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • le docking n'a PLUS de menus de style à lui : les deux listes
       déroulantes « Prot: » / « Lig: » — et les boutons 📸 / ↺ qui les
       définissaient, avec le module src/utils/dockStyles.js — ont disparu ;
     • le bouton « 🧬 Docking » lui-même a DISPARU, des deux endroits où il
       vivait (section « 2 · Molecular Styling » et barre Molecules) : il n'y a
       plus de mode global à basculer, donc plus d'état `dockStyleMode`, plus de
       `dockStyleRef`, plus de `toggleDockStyle` ni d'`applyDockStylesNow` ;
     • le look venait DÉJÀ de la section « 2 · Molecular Styling » — c'est ce qui
       reste : le résultat actif ET toutes les molécules chargées sont dessinés
       par le MÊME constructeur par catégorie que le reste du viewer
       (buildCategoryReps), sans aucun drapeau de docking à consulter ;
     • chaque molécule garde son propre style (barre Molecules) et « Auto » suit
       les SIX menus A–F du §2.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Les règles sont donc
   vérifiées SUR LA SOURCE — comme les autres garde-fous du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

// CRLF → LF so the multi-line needles below can be written naturally.
const VIEWER = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEWER.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEWER.includes(needle), `${what}\n  encore présent : ${needle}`);
const count = (re) => (VIEWER.match(re) || []).length;

/* ── 1. Plus AUCUN menu de style propre au docking ───────────────────────── */
gone('renderDockRoleSelects', 'plus de listes Prot: / Lig: du docking');
gone('Prot: ', 'plus d’option « Prot: … »');
gone('Lig: ', 'plus d’option « Lig: … »');
gone('setDockRoleStyle', 'plus de définition d’un style de rôle');
gone('captureDockStylesFromViewer', 'plus de bouton 📸 « copier la vue »');
gone('resetDockStyles', 'plus de bouton ↺ « défaut » du docking');
gone('captureDockRoleStyles', 'plus de capture silencieuse de la vue');
gone('applyDockRoleStyle', 'plus de rendu « protéine + ligand » propre au docking');
gone('dockRoleStylesRef', 'plus de réglage de rôles en mémoire');
gone('DOCK_STYLE_', 'plus de jetons de style du docking');
gone('utils/dockStyles', 'le viewer n’importe plus de module de style du docking');
gone('labViewerDockStyle', 'plus aucune clé localStorage de style du docking');
ok(!existsSync(new URL('./src/utils/dockStyles.js', import.meta.url)),
  'le module src/utils/dockStyles.js a été supprimé (plus aucun utilisateur)');

/* ── 2. Le bouton de docking a disparu — partout ────────────────────────── */
// Le mode global n'existait que pour FORCER les six menus du §2 sur chaque
// résultat d'amarrage. Le style se règle maintenant molécule par molécule :
// il n'y a plus rien à basculer, donc plus aucun état ni fonction de docking.
gone('toggleDockStyle', 'plus de bouton « 🧬 Docking » (toolbar §2 et barre Molecules)');
gone('dockStyleMode', '…donc plus aucun mode global à basculer');
gone('dockStyleRef', '…ni la référence synchrone que le rendu consultait');
gone('applyDockStylesNow', '…ni la fonction qui ré-appliquait le look à chaque bascule');
gone('prevDockStyleRef', '…ni le suivi de son changement');
gone('}, [dockStyleMode]);', '…ni l’effet qui le surveillait');
gone('🧬 Docking', 'le libellé du bouton ne subsiste nulle part (infobulles comprises)');
gone('Standardize DOCKING', '…ni l’infobulle « Standardize DOCKING results »');
gone('}, [dockStyles]);', 'plus aucun état de style du docking à surveiller');

/* ── 3. Le rendu passe par le constructeur du §2 — sans drapeau ─────────── */
has('const buildCategoryReps = (comp) => {', 'le constructeur par catégorie du §2 est toujours là');
has("if (!st.style || st.style === 'auto') {",
  'la structure principale suit le §2 quand son style est « Auto » (aucun autre critère)');
has("if (!style || style === 'auto') {",
  '…et chaque molécule chargée aussi (restyleExtraMol)');
gone('if (dockStyleRef.current || !st.style', 'plus aucun drapeau de docking dans ce choix');
gone('if (dockStyleRef.current || !style', '…ni dans celui des molécules chargées');
ok(count(/const baseReps = applyCurrentStyleTo\(comp, \[\]\);/g) === 3,
  'les trois chargements (chaîne, molécule supplémentaire, URL) passent par le rendu du §2');

/* ── 4. Les réglages par molécule font le geste de style du docking ─────── */
// Ce que le mode de docking faisait autrefois (faire quitter à un grand système
// son rendu léger), ce sont les réglages par molécule de la barre Molecules qui
// le font maintenant : chaque setter appelle leaveLightMode().
has('const setExtraMolStyle = (id, style) => {\n  leaveLightMode();',
  'le style d’une molécule quitte le rendu léger');
has('const setExtraMolColorMode = (id, mode) => {\n  leaveLightMode();',
  '…son mode de coloration aussi');
// Les quatre groupes repliés de la barre (Style · Colour · Transp · Move) sont
// rendus par UNE seule implémentation pour la principale COMME pour chaque
// molécule chargée, et chacun passe par leaveLightMode() puis setMainMol.
has('onStyle: (v) => { leaveLightMode(); setMainMol((m) => ({ ...m, style: v })); },',
  '…et le style de la structure principale, dans la même barre');
has('onColorMode: (v) => { leaveLightMode(); setMainMol((m) => ({ ...m, colorMode: v })); },',
  '…son mode de coloration');
has('onTransparency: (v) => { leaveLightMode(); setMainMol((m) => ({ ...m, transparency: v })); },',
  '…sa transparence');
has('const renderMolFolds = (keyName, { name, style, color, colorMode, transparency, onStyle, onColor, onColorMode, onTransparency, moveFields }) => {',
  'UNE implémentation des quatre groupes repliés, partagée par la principale et les molécules chargées');
has('{renderMolFolds(\'main\', {', '[barre] la structure principale utilise ces groupes');
has('{renderMolFolds(m.id, {', '[barre] …et chaque molécule chargée aussi');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_dock_style_test.mjs — ${passed} assertions OK`);
