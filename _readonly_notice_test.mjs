/* =========================================================================
   _readonly_notice_test.mjs — UN REFUS D'ÉCRITURE EST TOUJOURS AFFICHÉ.

   Défaut signalé : une valeur tapée dans une table (déplacement chimique) et le
   réglage du spectre 1D disparaissaient ensemble, à la recharge de la MÊME
   condition. Une des causes possibles de ce scénario : la page refusait
   l'écriture SANS RIEN DIRE. Deux raisons indépendantes font ça :

     • l'utilisateur n'a que « view » sur le projet qui décide de l'accès
       (`projectViewOnly`) ;
     • la donnée de la condition est gelée par un superuser (`dataReadOnly`).

   Dans les deux cas `updateActiveTest` sortait sans écrire — et React ne remet
   jamais la valeur stockée par-dessus le texte tapé : la valeur RESTE à l'écran,
   paraît enregistrée, et disparaît au rechargement. Le refus était donc
   invisible pour qui vient de perdre son travail.

   Ce qui doit rester vrai :
     • la règle vit dans UNE fonction pure (src/utils/readOnly.js), testée ici
       sur sa table de vérité — pas seulement cherchée dans le source ;
     • la règle reproduit le premier projet qui décide de l'accès
       (projectsModule.testProjectAccess), et le nom de ce projet est affiché ;
     • les deux cas rendent un AVIS à l'écran, et un badge dans la barre fine
       (la seule ligne toujours visible, même « ▸ More details » replié) ;
     • les boutons STRUCTURELS (supprimer l'expérience, ajouter une condition,
       supprimer une condition, glisser une condition, copier sous gel) ne
       peuvent plus écrire pour un membre en lecture seule : un avis qui dit
       « rien n'est enregistré » au-dessus d'un bouton qui enregistre serait
       pire que pas d'avis du tout.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decidingProjectAccess, experimentReadOnly, readOnlyLabel } from './src/utils/readOnly.js';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};
const count = (src, re) => (src.match(re) || []).length;

const ACT = readFileSync('src/components/AppModules/activeTestModule.jsx', 'utf8').replace(/\r\n/g, '\n');
const PM = readFileSync('src/components/AppModules/projectsModule.jsx', 'utf8').replace(/\r\n/g, '\n');
const ICONS = readFileSync('src/components/Icons.jsx', 'utf8').replace(/\r\n/g, '\n');
const DOC = readFileSync('src/utils/readOnly.js', 'utf8').replace(/\r\n/g, '\n');

const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

/* ── 1. La table de vérité de la règle (code réel, pas du texte) ──────────── */
const NORMAL = {
  isSuperuser: false, isAssignedScientist: false, projectPerm: 'view',
  isUnlocked: false, hasOperator: true, isDataLocked: false
};
const viewOnly = (over = {}) => experimentReadOnly({ ...NORMAL, ...over });

/* La cause du défaut : lecture seule POUR CE MEMBRE, et la raison est nommée. */
eq(viewOnly().projectViewOnly, true, 'un membre « view » non scientifique, sur un test assigné, est en lecture seule');
eq(viewOnly().reason, 'project', '…et la raison retournée est « project »');
eq(viewOnly().readOnly, true, '…« readOnly » résume la décision');
eq(viewOnly().dataReadOnly, false, '…sans confondre les deux causes');
eq(experimentReadOnly().reason, '', 'sans contexte, la page est éditable (appel par défaut)');

/* Chaque exception de la règle, une par une (elles doivent toutes rester). */
eq(viewOnly({ isSuperuser: true }).projectViewOnly, false, 'un superuser écrit toujours');
eq(viewOnly({ isAssignedScientist: true }).projectViewOnly, false, 'un scientifique assigné (ou co-scientifique) édite son test');
eq(viewOnly({ isUnlocked: true }).projectViewOnly, false, 'un test déverrouillé pour cet utilisateur est éditable');
eq(viewOnly({ hasOperator: false }).projectViewOnly, false, 'un test SANS scientifique assigné (boîte, non assigné) est éditable');
eq(viewOnly({ projectPerm: 'modify' }).projectViewOnly, false, 'les droits « modify » du projet suffisent');
eq(viewOnly({ projectPerm: null }).projectViewOnly, false, 'aucun droit de projet (accès par un autre chemin) n’enferme la page');

/* Le gel de la donnée : seconde cause, indépendante des droits du projet. */
const locked = experimentReadOnly({ isDataLocked: true });
eq(locked.dataReadOnly, true, 'une donnée gelée est en lecture seule');
eq(locked.reason, 'data-lock', '…avec sa propre raison');
eq(locked.projectViewOnly, false, '…et sans confondre avec les droits du projet');
eq(experimentReadOnly({ isDataLocked: true, isSuperuser: true }).dataReadOnly, false,
  'seul un superuser écrit sur une donnée gelée');
/* Les deux à la fois : la raison affichée est celle sur laquelle l'utilisateur
   peut agir (demander des droits), et l'écriture est refusée de toute façon. */
const both = experimentReadOnly({ ...NORMAL, isDataLocked: true });
eq(both.reason, 'project', 'les deux causes → c’est « project » qui est annoncé (la seule actionnable)');
eq(both.readOnly, true, '…et la page reste en lecture seule');
eq(both.dataReadOnly, true, '…sans perdre l’autre cause au passage');

/* Le libellé prêt pour un `title=` / un badge. */
ok(readOnlyLabel('project', 'Cryo-EM').includes('Cryo-EM'), 'le libellé de la cause nomme le projet concerné');
ok(readOnlyLabel('project').includes('linked project'), '…et retombe sur « linked project » sans nom');
eq(readOnlyLabel(''), '', 'aucun libellé quand la page est éditable');
eq(readOnlyLabel('data-lock'), 'Data locked by a superuser', 'le gel a son propre libellé');

/* ── 2. Le projet qui DÉCIDE est celui de projectsModule ─────────────────── */
/* Miroir exact de la boucle de testProjectAccess : premier nom connu de la
   carte d'accès. Si l'une des deux boucles change, ce test le dit. */
has(PM, 'for (const pn of names) {\n    if (map[pn]) return map[pn];\n  }',
  'projectsModule décide toujours par le premier projet connu de la liste');
has(DOC, "reason: projectViewOnly ? 'project'", 'la règle locale annonce la même cause « project »');
const mirrored = (projectNames, accessMap) => {
  for (const pn of Array.isArray(projectNames) ? projectNames : []) {
    if (accessMap && accessMap[pn]) return accessMap[pn];
  }
  return null;
};
const MAP = { 'Cryo-EM': 'view', 'Lab A': 'modify' };
eq(decidingProjectAccess(['Cryo-EM', 'Lab A'], MAP).permission, mirrored(['Cryo-EM', 'Lab A'], MAP),
  'la permission retenue est celle de testProjectAccess');
eq(decidingProjectAccess(['Cryo-EM', 'Lab A'], MAP).project, 'Cryo-EM',
  '…et le premier projet connu est celui qui est affiché à l’utilisateur');
eq(decidingProjectAccess(['Lab A', 'Cryo-EM'], MAP).project, 'Lab A',
  'l’ordre de `projectNames` décide, comme dans testProjectAccess');
eq(decidingProjectAccess(['Unknown'], MAP).project, '', 'un projet sans droit ne décide de rien');
eq(decidingProjectAccess(null, MAP).permission, null, 'une liste absente ne décide de rien');
eq(decidingProjectAccess(['Cryo-EM'], null).permission, null, 'une carte d’accès absente ne décide de rien');

/* ── 3. La page tire son état de la règle, il n'y a qu'une formule ───────── */
has(ACT, 'const access = experimentReadOnly({', 'la page demande l’état à la règle');
has(ACT, 'const projectViewOnly = access.projectViewOnly;', '…sans recalculer le cas « projet »');
has(ACT, 'const dataReadOnly = access.dataReadOnly;', '…ni le cas « donnée gelée »');
has(ACT, 'const readOnlyReason = access.reason;', '…et retient la raison à afficher');
has(ACT, 'const projectPerm = decidingProject.permission;', 'la permission vient du projet qui décide');
has(ACT, 'getProjectAccessForUser(currentUser.name)', '…relu une fois pour toute la page');
gone(ACT, "const projectViewOnly = projectPerm === 'view' && !(isSuperuserSession",
  'l’ancienne formule locale a disparu (une seule définition de la règle)');

/* ── 4. Les portillons d'écriture refusent, tous autant qu'ils sont ──────── */
ok(count(ACT, /if \(projectViewOnly\) return;/g) >= 3,
  'chaque portillon d’écriture refuse pour un membre « view » (édition, renommage, structure)');
has(ACT, 'if (dataReadOnly) return;', 'le gel refuse toujours les écritures de section');
has(ACT, 'if (projectViewOnly || dataReadOnly) return; // read-only (project view / frozen data)',
  'le renommage de l’expérience refuse les deux cas');

/* ── 5. Les DEUX causes sont affichées (avis + badge toujours visible) ───── */
eq(count(ACT, /\{projectViewOnly && \(/g), 1, 'un avis est rendu pour le membre en lecture seule');
has(ACT, 'NOTHING YOU CHANGE HERE IS SAVED', '…qui dit en clair que rien n’est enregistré');
has(ACT, 'View-only project', '…et le titre de l’avis');
has(ACT, 'You have view-only rights on ${decidingProject.project ?',
  '…en nommant le projet à qui demander les droits');
has(ACT, '{activeInstanceLocked && (', 'l’avis de gel existant reste en place');
has(ACT, 'Read-only for you: the results stay visible, but nothing you change here is saved',
  '…avec sa propre explication (copie vers une nouvelle instance)');
has(ACT, '{readOnlyReason && (', 'la barre FINE porte un badge : le chrome replié ne cache pas la lecture seule');
has(ACT, "title={`${readOnlyLabel(readOnlyReason, decidingProject.project)}",
  '…dont l’infobulle réutilise le libellé de la règle');
ok(/^\s{2}'?key'?:\s*\(/m.test(ICONS), 'l’icône « key » du badge existe (sinon le badge afficherait son nom)');
has(ACT, "<Icon name={readOnlyReason === 'project' ? 'key' : 'lock'} size={11}",
  '…et le badge distingue les droits du projet d’une donnée gelée');

/* ── 6. Aucun bouton STRUCTUREL n'écrit pour un membre en lecture seule ──── */
has(ACT, 'disabled={dataReadOnly || projectViewOnly}', 'supprimer l’expérience est désactivé pour les deux causes');
has(ACT, 'disabled={projectViewOnly}', 'ajouter une condition est désactivé pour un membre « view »');
has(ACT, 'draggable={siblingTests.length > 1 && !projectViewOnly}',
  'une condition ne peut plus être glissée (réordonner = écrire)');
has(ACT, '{!isFrozenForMe(t.id) && !projectViewOnly && (', 'le ✕ d’une condition disparaît pour un membre « view »');
eq(count(ACT, /\{!projectViewOnly && \(/g), 1,
  'la copie « sous gel » n’est plus offerte à un membre « view » (la copie retombe dans les mêmes projets)');
has(ACT, '// A view-only project member cannot write, and a copy would land', '…la raison est écrite à la source');
has(ACT, 'if (projectViewOnly) return; // read-only: creating a condition is a write (disabled below)',
  'créer une condition refuse l’écriture même si le bouton était forcé');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_readonly_notice_test.mjs — ${passed} assertions OK (un refus d’écriture est toujours affiché)`);
