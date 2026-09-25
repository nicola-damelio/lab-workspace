/* =========================================================================
   _recettes_actions_superuser_test.mjs — LES TROIS BOUTONS DE FIN DE LIGNE
   DE LA PAGE RECETTES SONT RÉSERVÉS AU SUPERUTILISATEUR.

   Demande : « only superuser can use and see the last three buttons in each
   line of the recettes page ».

   Chaque ligne de la table « Recettes » se termine par une colonne d'actions
   qui porte exactement TROIS boutons :
     🔗 lier la ligne aux dépenses / OM / achats prévus,
     ✎ modifier la ligne budgétaire,
     🗑 supprimer la ligne budgétaire.

   Ce qui doit rester vrai :
     • `isSuper` vient de la matrice d'accès (`access.isSuperuser`) et n'est
       défini qu'UNE fois dans la page (pas de seconde formule locale) ;
     • le rendu de la colonne SORT avant les trois boutons quand `!isSuper`
       (aucun bouton n'est monté pour les autres profils → ils ne les voient
       pas et ne peuvent donc pas les utiliser) ;
     • la suppression de ligne refuse l'écriture même si le bouton était forcé
       (seconde barrière) ;
     • les trois boutons restent bien présents dans la branche superutilisateur.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const PAGE = readFileSync('src/administration/recettesPage.jsx', 'utf8').replace(/\r\n/g, '\n');

const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};

/* ── 1. La source de vérité du rôle ─────────────────────────────────────── */
eq(count(PAGE, /const isSuper = /g), 1,
  'un seul `isSuper` dans la page (aucune seconde définition locale du rôle)');
has(PAGE, 'const isSuper = !!access.isSuperuser;',
  'le rôle vient de la matrice d’accès (access.isSuperuser)');

/* ── 2. La colonne d’actions sort AVANT de rendre le moindre bouton ────── */
const guard = 'if (!isSuper) return <span className="text-slate-300 text-xs">—</span>;';
has(PAGE, guard, 'les non-superusers voient un simple tiret, jamais les boutons');
const guardAt = PAGE.indexOf(guard);
const firstButtonAt = PAGE.indexOf('title="Lier dépenses / OM / desiderata (superutilisateur)"');
ok(guardAt > -1 && firstButtonAt > guardAt,
  'le gardien `!isSuper` est évalué AVANT tout rendu de bouton (layout inchangé pour les autres profils)');

/* ── 3. Les trois boutons existent (branche superutilisateur) ──────────── */
has(PAGE, 'title="Lier dépenses / OM / desiderata (superutilisateur)"',
  'le bouton 🔗 (lier dépenses / OM / desiderata) est présent');
has(PAGE, 'title="Modifier (superutilisateur)"',
  'le bouton ✎ (modifier la ligne) est présent');
has(PAGE, 'title="Supprimer (superutilisateur)"',
  'le bouton 🗑 (supprimer la ligne) est présent');
const branch = PAGE.slice(firstButtonAt);
ok(branch.includes('>🔗</button>') && branch.includes('>✎</button>') && branch.includes('>🗑</button>'),
  'les trois boutons (🔗 ✎ 🗑) sont bien dans la branche superutilisateur');

/* ── 4. Seconde barrière : la suppression refuse l’écriture sans le rôle ─ */
has(PAGE, 'const onRemoveLine = (rec) => {\n    if (!isSuper) return;',
  'supprimer une ligne refuse l’écriture sans le rôle superutilisateur');

/* ── Bilan ────────────────────────────────────────────────────────────── */
console.log(`_recettes_actions_superuser_test.mjs — ${passed} assertions OK (les 3 boutons de fin de ligne sont réservés au superutilisateur)`);
