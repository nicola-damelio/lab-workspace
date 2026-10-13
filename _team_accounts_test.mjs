/* =========================================================================
   _team_accounts_test.mjs — « UN COMPTE CRÉÉ SUR UN AUTRE PC A DISPARU ».

   LE RAPPORT : un compte (collègue) ajouté sur un poste n'existe plus sur les
   autres, et « les mots de passe des collègues ne marchaient plus ». La liste
   des comptes vit ENTIÈRE dans le document partagé
   (`appConfig/global.operators`) et chaque poste l'écrit d'un bloc : un poste
   resté sur une copie plus ancienne publiait une liste PLUS COURTE. Le
   garde-fou existant ne se déclenchait que si la liste locale était VIDE.

   La réparation vérifiée ici, en PUR (src/utils/teamAccounts.js) :
     1. `mergeOperators(local, distant, removed)` — la copie partagée fait foi
        pour les comptes qu'elle porte, ceux que ce poste a et qu'elle ne porte
        pas sont AJOUTÉS ;
     2. l'identité d'un compte est la PERSONNE (le nom, accents et ordre des
        mots ignorés) : deux id différents ne font donc pas deux collègues ;
     3. `removedOperators` — la suppression est un RECORD daté qui voyage, et
        recréer la personne le lève (`reviveOperator`).
   Le CÂBLAGE suit (App.jsx et definitionsManagers.jsx).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

/* Un localStorage de poche : le magasin du module est lu et écrit pour de vrai
   (c'est lui qui fait voyager une suppression d'une session à l'autre). */
const fakeStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => { fakeStore.set(k, String(v)); },
  removeItem: (k) => { fakeStore.delete(k); },
  clear: () => fakeStore.clear(),
};

const T = await import('./src/utils/teamAccounts.js');
const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const DEFS = readFileSync('./src/components/AppModules/definitionsManagers.jsx', 'utf8').replace(/\r\n/g, '\n');
const DOC = readFileSync('./docs/DRIVE-MIRROR.md', 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(String(src).includes(needle), `${what}\n  fragment absent : ${needle}`);
  passed += 1;
};

const names = (list) => list.map((op) => op.name);
const op = (id, name, extra = {}) => ({ id, name, role: 'user', passwordHash: '', personnelId: null, ...extra });

/* ── 1. LE SCÉNARIO DU RAPPORT ───────────────────────────────────────────── */
const marie = op('op_a1', 'Marie Curie', { passwordHash: 'h_marie' });
const cintia = op('op_c5', 'Cintia LEAL', { passwordHash: 'h_cintia' });
const nicola = op('op_n9', 'Nicola Rossi', { passwordHash: 'h_nicola' });

/* Poste A : vieille copie (Marie seule). Copie partagée : deux collègues
   ajoutés ailleurs depuis. C'est CETTE écriture qui les effaçait. */
const merged = T.mergeOperators([marie], [marie, cintia, nicola], []);
eq(names(merged.list), ['Cintia LEAL', 'Marie Curie', 'Nicola Rossi'],
  'la liste publiée garde les collègues ajoutés ailleurs (le défaut du rapport)');
eq(names(merged.saved), ['Cintia LEAL', 'Nicola Rossi'],
  '…et ils sont nommés : l’écran peut dire qui a été sauvé');
ok(merged.changed, 'publier change bien quelque chose (la liste locale était plus courte)');
eq(T.describeTeamMerge(merged).includes('Cintia LEAL'), true,
  'le compte-rendu nomme les comptes sauvés');

/* Sens inverse : ce poste apporte un compte neuf — il survit (aucun signalement,
   c'est un ajout normal). */
const added = T.mergeOperators([marie, cintia], [marie], []);
eq(names(added.list), ['Cintia LEAL', 'Marie Curie'], 'un compte ajouté ICI est publié');
eq(names(added.added), ['Cintia LEAL'], '…et compté comme un AJOUT (pas comme un sauvetage)');
eq(added.saved.length, 0, 'aucun sauvetage : il n’y avait rien à sauver');
eq(T.describeTeamMerge(added), '', 'aucun compte sauvé : aucun compte-rendu');

/* La copie partagée fait foi quand elle CHANGE une personne (mot de passe posé
   ailleurs) : un poste en retard ne renverse pas le travail d'un autre. */
const reset = T.mergeOperators(
  [{ ...marie, role: 'user', passwordHash: 'h_old' }],
  [{ ...marie, role: 'superuser', passwordHash: 'h_new', personnelId: 'p_1' }],
  []
);
eq(reset.list[0].passwordHash, 'h_new', 'le mot de passe le plus récent (copie partagée) gagne');
eq(reset.list[0].role, 'superuser', '…et le rôle aussi');
eq(reset.list[0].personnelId, 'p_1', '…et la liaison de fiche Personnel');
eq(reset.changed, true, 'un vrai changement est signalé');

/* ── 2. L'IDENTITÉ EST LA PERSONNE, PAS L'ID ─────────────────────────────── */
const dup = T.mergeOperators(
  [op('op_pc2', 'LEAL Cintia', { passwordHash: 'h2' })],
  [op('op_pc1', 'Cintia Leal', { passwordHash: 'h1' })],
  []
);
eq(dup.list.length, 1, 'deux postes, deux id, UNE seule personne : aucun doublon');
eq(T.samePerson({ name: 'Cintia LEAL' }, { name: 'Cintia Leal' }), true, 'les accents/casse ne changent pas la personne');
eq(T.samePerson({ name: 'Marie Curie' }, { name: 'Curie Marie' }), true, 'l’ordre des mots non plus');
eq(T.samePerson({ name: 'Marie Curie' }, { name: 'Marie Durand' }), false, 'deux personnes différentes restent distinctes');
eq(T.personKey({ name: '' }), '', 'une entrée sans nom ni id n’a pas d’identité');

/* ── 3. LA SUPPRESSION EST UN RECORD QUI VOYAGE ──────────────────────────── */
fakeStore.clear();
T.removeOperatorRecord(cintia);
eq(T.isOperatorRemoved(cintia, T.loadRemovedOperators()), true, 'un compte retiré laisse sa tombe');
const afterDelete = T.mergeOperators([marie], [marie, cintia], T.loadRemovedOperators());
eq(names(afterDelete.list), ['Marie Curie'],
  'la tombe empêche un poste en retard de republier le compte retiré');
T.adoptRemovedOperators([{ name: 'Nicola Rossi', removedAt: Date.now() }]);
eq(T.isOperatorRemoved(nicola, T.loadRemovedOperators()), true,
  'une tombe lue dans la copie partagée vaut ici aussi (adoption)');
T.reviveOperator(cintia);
eq(T.isOperatorRemoved(cintia, T.loadRemovedOperators()), false, 'recréer la personne LÈVE sa tombe');
eq(T.mergeOperators([marie], [marie, cintia], T.loadRemovedOperators()).list.length, 2,
  '…et elle peut donc revenir dans la fusion');

/* Deux tombes du même nom n'en font qu'une, la plus récente gagne ; une chaîne
   seule (version ancienne) reste comprise. */
eq(T.normalizeRemovedOperators([{ name: 'Marie Curie', removedAt: 1 }, { name: 'curie marie', removedAt: 9 }]).length, 1,
  'deux records de la même personne n’en font qu’un');
eq(T.normalizeRemovedOperators([{ name: 'Marie Curie', removedAt: 1 }, { name: 'curie marie', removedAt: 9 }])[0].removedAt, 9,
  '…la date la plus récente décide');
eq(T.normalizeRemovedOperators(['Marie Curie']).length, 1, 'un record écrit par une version ancienne (nom seul) reste compris');
eq(T.normalizeRemovedOperators([{}, null, '  ']).length, 0, 'un record sans identité est écarté (jamais une suppression aveugle)');
eq(T.normalizeRemovedOperators(Array.from({ length: 260 }, (_, i) => ({ name: `P${i}`, removedAt: i }))).length,
  T.MAX_REMOVED_OPERATORS, 'la liste des tombes est bornée');
eq(T.sameTeamList([marie, cintia], [cintia, marie]), true,
  'l’ordre d’affichage n’est pas une donnée : deux listes identiques sont égales');
eq(T.sameTeamList([marie], [marie, cintia]), false, 'un compte de plus, c’est une équipe différente');

/* ── 4. LE CÂBLAGE ───────────────────────────────────────────────────────── */
has(APP, 'loadRemovedOperators, mergeOperators, adoptRemovedOperators,',
  'App.jsx importe la fusion (une règle juste que personne n’appelle ne répare rien)');
has(APP, 'const merged = mergeOperators(operators, distant, loadRemovedOperators());',
  'la liste est FUSIONNÉE avec la copie partagée avant d’être publiée');
has(APP, 'if (!sameTeamList(listToPublish, operators)) setOperators(listToPublish);',
  'l’écran suit ce qui a été publié (sinon la fusion se referait à chaque enregistrement)');
has(APP, 'removedOperators: publishedRemoved,',
  'les tombes voyagent AVEC la liste (c’est ce record qui protège un compte retiré)');
has(APP, 'adoptRemovedOperators(JSON.parse(data.removedOperators))',
  'une tombe lue dans la copie partagée est adoptée sur ce poste aussi');
has(APP, 'Team list: the shared copy could not be re-read before writing',
  'une relecture impossible est DITE (et n’empêche pas d’écrire, comme avant)');
has(DEFS, 'const gone = normalizeOperators(operators).find((op) => op.id === id) || null;\n    if (gone) { try { removeOperatorRecord(gone); } catch { /* magasin indisponible */ } }',
  'la tombe est écrite AVANT la liste (l’ordre est la règle, comme pour les projets)');
has(DEFS, 'try { reviveOperator(newOp); } catch { /* magasin indisponible */ }',
  'recréer un compte lève sa tombe');
has(DEFS, 'if (current) { try { reviveOperator(current); } catch { /* magasin indisponible */ } }',
  'rééditer un compte aussi (on vient de lui écrire ici)');
has(DOC, 'la liste des comptes est FUSIONNÉE', 'docs/DRIVE-MIRROR.md documente la règle de la liste des comptes');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_team_accounts_test.mjs — ${passed} assertions OK`);

