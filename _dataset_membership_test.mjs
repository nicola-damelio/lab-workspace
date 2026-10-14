/* =========================================================================
   _dataset_membership_test.mjs — « QUI VOIT QUEL DATASET » (la matrice).

   Le besoin : les comptes se définissaient à DEUX endroits (réglages d'un
   dataset scientifique, Setup d'une base d'administration) alors que la liste
   est UNE, et l'attribution des datasets se faisait par la porte de CHAQUE
   dataset (« 👥 Membres »). Elle se fait désormais sur la page d'accueil, dans
   le panneau 👥 Équipe & accès (superutilisateur), en lisant la matrice dans
   l'autre sens : une ligne = un compte, une colonne = un dataset.

   Ce qui est vérifié ici, avec les modules RÉELS :
     • la règle d'identité d'un membre est CELLE de utils/datasetAccess.js
       (minuscules / espaces) — une matrice menteuse serait pire que rien ;
     • cocher une personne RESTREINT le dataset (la promesse « ces datasets sont
       ceux qu'elle voit » serait fausse si 🌐 gardait tout le monde) ;
     • décocher la dernière personne ne rouvre PAS le dataset (geste explicite) ;
     • les patches rendus sont ceux qui changent vraiment (aucune écriture inutile) ;
     • LA PROMESSE = LA RÈGLE : les datasets calculés pour une personne sont
       exactement ceux que `canUserOpenDataset` lui ouvrira ;
     • un nom de membre sans compte est SIGNALÉ (sinon « ajouté » ne voudrait
       rien dire pour personne) ;
     • le câblage : le panneau est sur la page d'accueil, le geste personnel
       (My Account) est resté dans les réglages, et les deux anciennes portes de
       la définition de l'équipe n'en portent plus aucune trace.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const M = await import('./src/utils/datasetMembership.js');
const A = await import('./src/utils/datasetAccess.js');

const APP = readFileSync('./src/App.jsx', 'utf8').replace(/\r\n/g, '\n');
const PANEL = readFileSync('./src/components/AppModules/teamAccessPanel.jsx', 'utf8').replace(/\r\n/g, '\n');
const MATRIX = readFileSync('./src/components/AppModules/datasetMembershipMatrix.jsx', 'utf8').replace(/\r\n/g, '\n');
const DEFS = readFileSync('./src/components/AppModules/definitionsManagers.jsx', 'utf8').replace(/\r\n/g, '\n');
const SET = readFileSync('./src/components/AppModules/settingsModule.jsx', 'utf8').replace(/\r\n/g, '\n');
const SETUP = readFileSync('./src/administration/settingsPage.jsx', 'utf8').replace(/\r\n/g, '\n');

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

const OPS = [
  { id: 'op_1', name: 'Nicola Rossignol', role: 'superuser' },
  { id: 'op_2', name: 'Cintia Leal', role: 'user', passwordHash: 'abc' },
  { id: 'op_3', name: 'Marie Curie', role: 'user', passwordHash: '' },
  { id: 'op_4', name: '', role: 'user' },
];
/* Deux datasets : une base d’administration ouverte à tous (🌐) et un dataset
   scientifique déjà restreint à une personne. */
const DATASETS = () => ([
  { id: 'd_adm', title: 'Base d’administration', kind: 'administration' },
  { id: 'd_sci', title: 'Dataset scientifique', kind: 'scientific', access: { restricted: true, memberNames: ['Cintia Leal'] } },
]);

/* ── 1. L'IDENTITÉ D'UN MEMBRE EST CELLE DE datasetAccess.js ─────────────── */
eq(M.memberKey('  Cintia   LEAL '), 'cintia   leal', 'la clé d’un membre = minuscules + espaces autour retirés');
ok(M.sameMember('cintia leal', 'Cintia Leal'), '« Cintia Leal » et « cintia leal » sont la même personne');
ok(!M.sameMember('', ''), 'un nom vide ne désigne jamais personne');
eq(A.normalizeMemberNames(['Cintia Leal']).length, 1, 'la liste des membres passe par la normalisation existante');
ok(M.isMemberOfDataset(DATASETS()[1], 'cintia leal'), 'la matrice reconnaît un membre sans tenir compte de la casse');

/* ── 2. QUI PEUT ÊTRE MEMBRE ─────────────────────────────────────────────── */
eq(M.invitableOperators(OPS).map((op) => op.name), ['Cintia Leal', 'Marie Curie'],
  'les comptes proposés sont les personnes réelles : superutilisateur exclu (il voit tout), entrée sans nom exclue');

/* ── 3. COCHER RESTREINT, DÉCOCHER NE ROUVRE PAS ─────────────────────────── */
const adm = DATASETS()[0];
const added = M.addMember(adm, 'Marie Curie');
eq([added.restricted, added.memberNames, added.changed], [true, ['Marie Curie'], true],
  'cocher une personne sur un dataset 🌐 le RESTREINT et l’y nomme');
eq(M.addMember({ access: { restricted: true, memberNames: ['Marie Curie'] } }, 'marie curie').changed, false,
  'cocher une personne déjà membre ne change rien (aucune écriture inutile)');
const removed = M.removeMember({ access: { restricted: true, memberNames: ['Cintia Leal', 'Marie Curie'] } }, 'CINTIA LEAL');
eq([removed.restricted, removed.memberNames, removed.changed], [true, ['Marie Curie'], true],
  'décocher retire le nom (casse ignorée) et CONSERVE la restriction');
eq(M.removeMember({ access: { restricted: false, memberNames: [] } }, 'Marie Curie').changed, false,
  'décocher quelqu’un qui n’est pas membre ne change rien');
eq(M.setDatasetRestriction({ access: { restricted: true, memberNames: ['Cintia Leal'] } }, false),
  { restricted: false, memberNames: ['Cintia Leal'] },
  '🌐 rouvre le dataset SANS perdre la liste des membres (refermer la retrouve)');

/* ── 4. LES PATCHES : SEULEMENT CE QUI CHANGE ────────────────────────────── */
const list = DATASETS();
eq(M.memberPatchesForUser(list, 'Marie Curie', ['d_sci']),
  [{ id: 'd_sci', access: { restricted: true, memberNames: ['Cintia Leal', 'Marie Curie'] } }],
  'cocher un dataset rend UN patch, les autres n’en rendent aucun');
eq(M.memberPatchesForUser(list, 'Cintia Leal', ['d_sci']), [],
  'une personne déjà membre de tout ce qu’on lui donne ne produit aucune écriture');
eq(M.memberPatchesForUser(list, 'Cintia Leal', []),
  [{ id: 'd_sci', access: { restricted: true, memberNames: [] } }],
  'tout décocher retire son nom, en gardant le dataset restreint');
eq(M.memberPatchesForUser(list, 'Marie Curie', ['d_sci', 'inconnu']),
  [{ id: 'd_sci', access: { restricted: true, memberNames: ['Cintia Leal', 'Marie Curie'] } }],
  'un identifiant de dataset qui n’existe pas ne fabrique pas de patch fantôme');

/* ── 5. LA PROMESSE = LA RÈGLE (ce que la personne verra vraiment) ───────── */
const patched = list.map((d) => {
  const patch = M.memberPatchesForUser(list, 'Marie Curie', ['d_sci']).find((p) => p.id === d.id);
  return patch ? { ...d, access: patch.access } : d;
});
const marie = { id: 'op_3', name: 'Marie Curie', role: 'user' };
eq(M.datasetsOfUser(patched, marie).map((d) => d.id), ['d_adm', 'd_sci'],
  'les datasets calculés pour Marie sont ceux qu’on lui a cochés (plus le dataset 🌐)');
eq(patched.filter((d) => A.canUserOpenDataset(d, marie)).map((d) => d.id),
  M.datasetsOfUser(patched, marie).map((d) => d.id),
  'la matrice et la règle appliquée par l’application donnent EXACTEMENT la même liste');
ok(A.canUserOpenDataset(patched[1], { name: 'Jean Perrin', role: 'user' }) === false,
  'une personne non cochée ne voit pas un dataset restreint');
ok(A.canUserOpenDataset(patched[1], { name: 'Nicola Rossignol', role: 'superuser' }) === true,
  'le superutilisateur voit tout, listé ou non');

/* ── 6. LES NOMS SANS COMPTE SONT DITS ───────────────────────────────────── */
const orphan = { id: 'd_old', title: 'Ancienne base', kind: 'scientific', access: { restricted: true, memberNames: ['Jean Perrin', 'Cintia Leal'] } };
eq(M.unknownMembersOf(orphan, OPS), ['Jean Perrin'],
  'un nom de membre qui ne correspond à aucun compte est signalé (il n’ouvre le dataset à personne)');
const summary = M.membershipSummary([...DATASETS(), orphan], OPS);
eq([summary.datasets, summary.accounts, summary.restricted, summary.unknown],
  [3, 2, 2, ['Jean Perrin']],
  'le compte-rendu compte les datasets, les comptes, les datasets restreints et les noms sans compte');

/* ── 7. LE CÂBLAGE ───────────────────────────────────────────────────────── */
has(PANEL, "import { ScientistsOperatorsManager } from './definitionsManagers';",
  'le panneau d’équipe reprend le gestionnaire de comptes (une seule définition)');
has(PANEL, "import { DatasetMembershipMatrix } from './datasetMembershipMatrix';",
  '…et la matrice « qui voit quel dataset »');
has(PANEL, 'const bootstrap = !hasDefinedSuperuser(team);',
  'sans superutilisateur défini (bootstrap), le panneau reste ouvert — sinon la première équipe ne peut plus être créée');
has(PANEL, 'const allowed = isSuper || bootstrap;',
  'la définition de l’équipe est réservée au superutilisateur (bootstrap excepté)');
has(PANEL, 'Promise.resolve(onLoadPersonnel())',
  'les fiches Personnel (liaison compte ↔ fiche) sont relues à l’ouverture, pas à l’affichage de la page');
has(APP, "import { TeamAccessPanel } from './components/AppModules/teamAccessPanel';",
  'App.jsx importe le panneau d’équipe');
has(APP, 'onSaveAccess={saveDatasetAccess}',
  '…et enregistre les accès par le geste EXISTANT (saveDatasetAccess : index + Firestore)');
has(APP, 'const showTeamPanel = currentUser',
  'la page d’accueil décide qui voit le panneau (une règle, pas un affichage nu)');
has(APP, '{showTeamPanel && (', 'le panneau est bien monté dans la page d’accueil');
has(APP, 'const loadTeamPersonnel = useCallback(async () => {',
  'les fiches des bases d’administration sont lues pour la liaison compte ↔ fiche');
has(MATRIX, '.then(() => onSaveAccess(patch.id, patch.access))',
  'la matrice n’écrit que les datasets modifiés (les patches du brouillon)');
has(MATRIX, "datasetsOfUser(withDraft, { name: op.name, role: 'user' })",
  'chaque ligne annonce le nombre de datasets que la personne VERRA (la même règle que l’application)');
has(MATRIX, 'unknownMembersOf({ ...dset, access }, operators)',
  'un nom de membre sans compte est affiché dans l’en-tête de la colonne');
has(DEFS, 'export const MyAccountPanel = ({', 'le geste personnel (mot de passe) est un composant à part');
has(DEFS, 'export const ScientistsOperatorsManager = ({',
  'le gestionnaire d’équipe reste exporté (il vit dans le panneau de la page d’accueil)');
ok(!/export const ScientistsOperatorsManager[\s\S]*?if \(selfServiceOp\) \{/.test(DEFS),
  'le gestionnaire d’équipe ne porte plus la vue « My Account » (séparation faite, pas seulement annoncée)');
has(SET, "import { CustomMetadataFieldsManager, MandatoryParametersManager, MyAccountPanel } from './definitionsManagers';",
  'les réglages d’un dataset scientifique montent My Account');
ok(!SET.includes('<ScientistsOperatorsManager'),
  '…et plus la définition de l’équipe (elle a quitté le dataset scientifique)');
has(SETUP, '<MyAccountPanel', 'le Setup d’une base d’administration monte My Account');
ok(!SETUP.includes('<ScientistsOperatorsManager'),
  '…et plus la définition de l’équipe (elle a quitté la base d’administration)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_dataset_membership_test.mjs — ${passed} assertions OK`);
