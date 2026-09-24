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
     • le look venait DÉJÀ de la section « 2 · Molecular Styling » — ce qui reste,
       c'est la barre « Molecules · styling » : le résultat actif ET toutes les
       molécules chargées sont dessinés par le MÊME constructeur par SECTION que le
       reste du viewer (buildSectionReps), sans aucun drapeau de docking à
       consulter ;
     • chaque molécule a son PROPRE espace dans la barre, avec les rangées de son
       type (une par partie de la molécule) et son Move ; une molécule chargée dont
       le style est « Auto » suit la barre.

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
// PART 4 a remplacé le constructeur par catégorie par un constructeur par SECTION
// (une section = une molécule / une chaîne : les deux protéines d'un fichier sont
// deux espaces), et c'est lui le SEUL rendu — la principale comme les molécules
// chargées. Il n'y a donc plus AUCUN style par molécule à consulter : ce que le
// mode de docking forçait autrefois, c'est la barre qui le décrit, molécule par
// molécule, rangée par rangée.
has('const buildSectionReps = (comp, sections, trees, opts = {}) => {',
  'le constructeur par SECTION est le seul constructeur du rendu');
has('const rebuildSectionsOf = (comp, molKey) => {',
  '…et le rebuild d’un composant passe par lui (les sections sont énumérées une fois)');
has('const applyCurrentStyleTo = useCallback((comp, baseReps) => {',
  '…par UNE porte d’entrée, pour la principale, une molécule chargée et une chaîne');
gone("if (!st.style || st.style === 'auto') {",
  'plus aucun style PAR MOLÉCULE à consulter : chaque molécule est dessinée par ses sections');
has("if (!style || style === 'auto') {",
  '…et une molécule chargée dont le style est « Auto » suit la barre (restyleExtraMol)');
gone('if (dockStyleRef.current || !st.style', 'plus aucun drapeau de docking dans ce choix');
gone('if (dockStyleRef.current || !style', '…ni dans celui des molécules chargées');
ok(count(/const baseReps = applyCurrentStyleTo\(comp, \[\]\);/g) === 3,
  'les trois chargements (chaîne, molécule supplémentaire, URL) passent par le rendu du §2');

/* ── 4. Les rangées de la barre font le geste de style du docking ───────── */
// Ce que le mode de docking faisait autrefois (faire quitter à un grand système
// son rendu léger), ce sont les rangées de la barre « Molecules · styling » qui le
// font maintenant : chaque geste de style — un menu de rangée, un ↺, le ✔ d'une
// molécule — appelle leaveLightMode() avant d'écrire.
const LINES = VIEWER.split('\n');
const blockAt = (anchor, span) => {
  const i = LINES.findIndex((l) => l.includes(anchor));
  return i < 0 ? '' : LINES.slice(i, i + span).join('\n');
};
const gesture = (anchor, what) => ok(blockAt(anchor, 3).includes('leaveLightMode();'), what);
gesture('const setSectionField = (id, kind, sub, field, value) => {',
  'un menu de rangée (style · Color by · rayons · matériau) quitte le rendu léger');
gesture('const resetSectionRowLook = (id, kind, sub) => {',
  'le ↺ d’une rangée aussi');
gesture('const resetSectionKindLook = (id, kind) => {',
  '…et le ↺ de la molécule entière');
gesture('const toggleSectionVisible = (id, kind) => {',
  '…et le ✔ qui dessine ou cache une molécule');
// La barre n'a qu'UNE implémentation des rangées : renderSection (l'espace d'une
// molécule) appelle renderSectionRow pour CHAQUE rangée de son type — la
// principale comme chaque molécule chargée. Le Move d'une molécule est le seul
// geste qui ne touche pas au style (il la déplace, il ne la redessine pas).
has('const renderSectionRow = (sec, sub) => {', 'UNE implémentation des rangées d’un espace');
has('const renderSection = (sec) => {', '…appelée par l’espace d’une molécule');
has('{(entry.sections || []).map((sec) => renderSection(sec))}',
  '[barre] chaque molécule (la principale comprise) rend ses rangées');
has('{shown && subsectionsOf(kind).map((s) => renderSectionRow(sec, s.sub))}',
  '…les rangées du type de molécule, et elles seules');
has('onChange={(e) => (extra ? setExtraMolPosition(extra.id, ai, e.target.value) : setMainPosition(ai, e.target.value))}',
  '[barre] le Move X · Y · Z d’une molécule (la principale comprise)');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_dock_style_test.mjs — ${passed} assertions OK`);
