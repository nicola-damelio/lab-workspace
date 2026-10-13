/* =========================================================================
   _password_reset_test.mjs — « I FORGOT MY PASSWORD ».

   Le besoin : un mot de passe oublié ne peut PAS être réinitialisé par l'app.
   La liste ne porte qu'un hash (SHA-256) et c'est le serveur de jetons qui
   vérifie les mots de passe (server/token-server.js) : personne — pas même un
   superutilisateur — ne peut lire l'ancien, et le changement de mot de passe de
   quelqu'un exige son ancien mot de passe.

   La seule mécanique honnête, vérifiée ici :
     1. la demande est un RECORD daté, une par personne
        (src/utils/passwordResets.js, clé `labWorkspace_passwordResets`) ;
     2. elle est NOTIFIÉE aux superutilisateurs par e-mail (`sendAdminMail`,
        avec le repli `mailto:` — jamais un envoi silencieux) ;
     3. le superutilisateur voit les demandes OUVERTES là où il pose le nouveau
        mot de passe, et les referme (`closePasswordReset`).
   Les vérifications de CÂBLAGE suivent (definitionsManagers.jsx) : la demande
   doit être accessible AUSSI depuis l'écran de connexion — c'est là qu'est la
   personne qui ne peut plus entrer.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./_esm_test_hook.mjs', import.meta.url);

const fakeStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (fakeStore.has(k) ? fakeStore.get(k) : null),
  setItem: (k, v) => { fakeStore.set(k, String(v)); },
  removeItem: (k) => { fakeStore.delete(k); },
  clear: () => fakeStore.clear(),
};

const R = await import('./src/utils/passwordResets.js');
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

/* ── 1. LA DEMANDE EST UN RECORD, UNE PAR PERSONNE ───────────────────────── */
const one = R.addPasswordReset([], { name: 'Cintia LEAL', note: 'at the bench', askedAt: 1000 });
eq(one.length, 1, 'une demande = une entrée');
eq([one[0].name, one[0].note, one[0].status, one[0].doneAt], ['Cintia LEAL', 'at the bench', 'open', 0],
  'la demande garde son nom, sa note et son état « ouverte »');
eq(one[0].askedAt, 1000, '…et la date du geste (jamais « à l’instant » plus tard)');
eq(R.resetKey({ name: 'Cintia LEAL' }), R.resetKey({ name: 'leal cintia' }),
  'l’identité est la personne (accents et ordre des mots ignorés)');

const again = R.addPasswordReset(one, { name: 'leal cintia', note: 'urgent', askedAt: 2000 });
eq(again.length, 1, 're-demander ne crée pas une seconde demande pour la même personne');
eq([again[0].askedAt, again[0].note], [2000, 'urgent'], '…elle RAFRAÎCHIT la demande (la note aussi)');

const handled = R.markResetHandled(again, again[0].id, 3000);
eq([handled[0].status, handled[0].doneAt], ['done', 3000], 'le superutilisateur peut la marquer traitée');
eq(R.openResets(handled).length, 0, '…et elle sort des demandes ouvertes');
eq(R.openResets(again).length, 1, 'tant qu’elle n’est pas traitée, elle reste ouverte');

const reopened = R.addPasswordReset(handled, { name: 'Cintia LEAL', askedAt: 4000 });
eq([reopened[0].status, reopened[0].doneAt], ['open', 0],
  'une demande PLUS RÉCENTE que la clôture la rouvre (sinon la personne resterait sans réponse)');

/* ── 2. DEUX COPIES SE FUSIONNENT SANS SE CONTREDIRE ─────────────────────── */
eq(R.mergeResets([{ name: 'Marie Curie', askedAt: 1000 }], [{ name: 'curie marie', askedAt: 1000, status: 'done', doneAt: 1500 }])[0].status,
  'done', 'la clôture postérieure à la demande gagne (deux postes ne se renvoient pas « ouverte / traitée »)');
eq(R.mergeResets([{ name: 'Marie Curie', askedAt: 1000 }], [{ name: 'Marie Curie', askedAt: 1000, status: 'done', doneAt: 500 }])[0].status,
  'open', 'une clôture ANTÉRIEURE à la demande ne la ferme pas');
eq(R.mergeResets([{ name: 'Marie Curie' }], [{ name: 'Nicola Rossi' }]).length, 2,
  'deux personnes, deux demandes (aucune n’est perdue)');
eq(R.normalizeResets(['Marie Curie']).length, 1, 'une demande écrite par une version ancienne (nom seul) reste comprise');
eq(R.normalizeResets([{}, null, '  ']).length, 0, 'une demande sans nom est écartée (on ne saurait pas pour qui)');
eq(R.normalizeResets(R.markResetHandled(one, R.resetKey({ name: 'Cintia Leal' }), 5000))[0].status, 'done',
  'la clôture accepte aussi la CLÉ de la personne (le panneau n’a pas toujours l’id sous la main)');

/* ── 3. LE MESSAGE : CE QUI PART, ET CE QUI EST DIT ──────────────────────── */
const entry = R.addPasswordReset([], { name: 'Cintia LEAL', note: 'Sono al banco', askedAt: 1700000000000 })[0];
ok(R.resetMailSubject(entry).includes('Cintia LEAL'), 'le sujet de l’e-mail nomme la personne');
ok(R.resetMailSubject(entry).includes('Password reset'), '…et dit de quoi il s’agit');
const body = R.resetRequestText(entry);
ok(body.includes('Setup → Team & access'), 'le corps dit OÙ poser le nouveau mot de passe');
ok(body.includes('Sono al banco'), 'le corps reprend la note de la personne');
ok(body.includes('cannot sign in'), 'le corps explique le problème');
ok(/REPLACED/.test(body), 'le corps dit qu’un mot de passe ne peut être que REMPLACÉ (jamais lu)');
ok(R.describeResetOutcome(entry, { ok: true }).includes('notified by e-mail'),
  'compte-rendu : quand l’e-mail part, on le dit');
ok(!R.describeResetOutcome(entry, { ok: false }).includes('notified by e-mail'),
  'compte-rendu : quand il ne part pas, on ne prétend PAS qu’il est parti');
ok(R.describeResetOutcome(entry, { ok: false }).includes('recorded on this computer'),
  '…mais on dit ce qui EST vrai : la demande est enregistrée ici');

/* ── 4. LE MAGASIN : LA DEMANDE SURVIT À LA SESSION ─────────────────────── */
fakeStore.clear();
const stored = R.requestPasswordReset({ name: 'Cintia LEAL', note: 'n', askedAt: 4242 });
eq(R.loadPasswordResets().length, 1, 'la demande est écrite dans le magasin du navigateur');
eq(R.loadPasswordResets()[0].name, 'Cintia LEAL', '…avec le nom, pour que le superutilisateur sache pour qui');
eq(stored.id, R.loadPasswordResets()[0].id, 'le geste rend l’entrée enregistrée (celle qui part dans l’e-mail)');
R.closePasswordReset(stored.id, 9999);
eq(R.openResets(R.loadPasswordResets()).length, 0, 'la clôture est enregistrée, elle aussi');
R.adoptPasswordResets([{ name: 'Nicola Rossi', askedAt: 5000 }]);
eq(R.loadPasswordResets().length, 2, 'une copie apportée (autre exécution, sauvegarde) est ADOPTÉE');
/* ── 5. LE CÂBLAGE ───────────────────────────────────────────────────────── */
has(DEFS, "import {\n  loadPasswordResets, requestPasswordReset, openResets, closePasswordReset,",
  'le composant importe le magasin des demandes (une règle non importée ne sert à rien)');
has(DEFS, "import { sendAdminMail, superuserEmailsOf, summarizeMail, buildMailto } from '../../administration/emailNotify';",
  'l’e-mail passe par le module existant (Gmail → relais serveur → mailto:)');
has(DEFS, 'const entry = requestPasswordReset({ name: who, note });',
  'le geste ENREGISTRE la demande avant toute autre chose');
has(DEFS, 'const to = superuserEmailsOf(normalizeOperators(operators), Array.isArray(personnel) ? personnel : []);',
  'les destinataires sont les superutilisateurs, résolus par leur fiche Personnel (comme les autres notifications)');
has(DEFS, 'const mail = await sendAdminMail({ to, subject, text })',
  'la demande est NOTIFIÉE (jamais un record muet)');
has(DEFS, 'buildMailto([], result.subject, result.text)',
  'quand rien ne peut partir, un message prêt à envoyer est proposé (jamais un faux « envoyé »)');
has(DEFS, 'export const PasswordResetRequest = ({',
  'un seul composant porte le formulaire, le compte-rendu et le repli');
has(DEFS, 'export const PasswordResetRequestsPanel = () => {',
  'le superutilisateur a un panneau des demandes ouvertes');
has(DEFS, 'setList(openResets(closePasswordReset(r.id)))',
  '…et peut les refermer quand le mot de passe est posé');
has(DEFS, '<PasswordResetRequestsPanel />',
  'le panneau est bien monté dans la page « Team & access » (avant la liste des comptes)');
has(DEFS, 'defaultName={selfServiceOp.name}',
  'la personne connectée n’a pas à retaper son nom : « Change My Password » le pré-remplit');
has(DEFS, 'triggerClassName="text-xs text-blue-300/70 hover:text-blue-200 underline transition-colors"',
  'l’ÉCRAN DE CONNEXION porte aussi la demande — c’est là qu’est la personne qui ne peut plus entrer');
has(DEFS, 'A superuser sets a new password (nobody can read the old one).',
  '…et le dit sans promettre un envoi automatique');
has(DEFS, 'triggerLabel="🔑 I forgot my password (ask another superuser)"',
  'un superutilisateur peut, lui aussi, enregistrer une demande (son collègue la traite)');
has(DOC, 'I forgot my password', 'docs/DRIVE-MIRROR.md documente la mécanique de la demande');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_password_reset_test.mjs — ${passed} assertions OK`);

