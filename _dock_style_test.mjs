/* =========================================================================
   _dock_style_test.mjs — le STYLE du bouton « 🧬 Docking » du viewer 3D.

   Ce qui est vérifié ici est ce qui doit rester vrai :

     • le docking n'a PLUS de menus de style à lui : les deux listes
       déroulantes « Prot: » / « Lig: » — et les boutons 📸 / ↺ qui les
       définissaient, avec le module src/utils/dockStyles.js — ont disparu ;
     • le look d'amarrage EST celui de la section « 2 · Molecular Styling » :
       tant que « 🧬 Docking » est ON, le résultat actif ET tous les autres
       (clusters / poses, présents et futurs) sont redessinés par le MÊME
       constructeur par catégorie que le reste du viewer (buildCategoryReps),
       même quand une molécule porte un style choisi dans la barre Molecules ;
     • quand le mode est OFF, chaque molécule retrouve son propre style ;
     • le bouton existe aux DEUX endroits (toolbar §2 et barre Molecules) et
       ré-applique le look à chaque bascule.

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

/* ── 2. Le look n'est défini QU'UNE fois : la section §2 ────────────────── */
has('const toggleDockStyle = () => setDockStyleMode((v) => !v);',
  'le toggle ne fait que basculer le mode — il n’a plus de look à définir');
ok(count(/onClick=\{toggleDockStyle\}/g) === 2,
  'le bouton « 🧬 Docking » existe en §2 ET dans la barre Molecules');
has('title="Standardize DOCKING results: every cluster/pose — current and future — is drawn with the styles of the menus A–F below',
  'l’infobulle du §2 dit que le look vient des menus A–F');
has('is drawn with the styles of section « 2 · Molecular Styling » of the toolbar',
  '…et celle de la barre Molecules renvoie à la même section');
// Le bloc Docking lui-même n'a plus de menu déroulant : c'est TOUT ce qui est
// vérifié ici (les menus A–F vivent plus bas dans la même section).
const iDock = VIEWER.indexOf('{/* 🧬 Docking — STANDARDIZE');
const dockBlock = iDock >= 0 ? VIEWER.slice(iDock, VIEWER.indexOf('\n)}', iDock)) : '';
ok(dockBlock.length > 0 && !dockBlock.includes('<select'),
  'le bloc Docking ne contient plus aucun menu déroulant de style');

/* ── 3. Le rendu d'amarrage passe par le constructeur du §2 ─────────────── */
has('const buildCategoryReps = (comp) => {', 'le constructeur par catégorie du §2 est toujours là');
has("if (dockStyleRef.current || !st.style || st.style === 'auto') {",
  'en mode Docking, la structure principale suit le §2 (même si un style par molécule existe)');
has("if (dockStyleRef.current || !style || style === 'auto') {",
  '…et chaque molécule chargée aussi (restyleExtraMol)');
ok(count(/const baseReps = applyCurrentStyleTo\(comp, \[\]\);/g) === 3,
  'les trois chargements (chaîne, molécule supplémentaire, URL) passent par le rendu du §2');

/* ── 4. Basculer le mode redessine tout ─────────────────────────────────── */
has('const [dockStyleMode, setDockStyleMode] = useState(false);', 'le mode est un simple booléen');
has('const prevDockStyleRef = useRef(dockStyleMode);', 'le changement de mode est suivi');
has('const applyDockStylesNow = () => {', 'une seule fonction ré-applique le look');
has('}, [dockStyleMode]);', '…appelée quand le mode bascule');
gone('}, [dockStyles]);', 'plus aucun état de style du docking à surveiller');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_dock_style_test.mjs — ${passed} assertions OK`);
