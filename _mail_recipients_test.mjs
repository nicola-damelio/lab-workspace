/* =========================================================================
   _mail_recipients_test.mjs — qui reçoit quoi (module Administration).

   Le module RÉEL est importé (src/administration/emailNotify.js) : approuver
   une ligne (« Approuvé » / « Acceptée ») ne doit JAMAIS écrire à une fiche
   « Gestionnaire », même quand cette personne possède aussi un compte
   superutilisateur (son adresse est alors dans `superuserEmails`). Les
   transferts « pour signature » / « pour révision » et la signature d'un devis
   / BC continuent de la prévenir (cibles « Achats » / « Gestionnaire »).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

/* Les sources de src/ s'importent sans extension (résolues par Vite) : le
   crochet rend le module RÉEL importable par node (voir _esm_test_hook.mjs ;
   seul le téléversement Drive, navigateur, y est remplacé par un bouchon). */
register('./_esm_test_hook.mjs', import.meta.url);
const {
  superuserNoticeEmailsOf, personnelEmailsMatching, superuserEmailsOf, summarizeMailTo,
} = await import('./src/administration/emailNotify.js');

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

/* ── 1. Jeu de données : la gestionnaire est AUSSI un compte superutilisateur */
const personnel = [
  { id: 'p_dir', nom: 'Nicola Directeur', email: 'dir@lab.fr' },
  { id: 'p_gest', nom: 'Sophie Gestion', email: 'gestion@lab.fr', fonction: 'Gestionnaire' },
  { id: 'p_achats', nom: 'Paul Achats', email: 'achats@lab.fr', fonction: 'Responsable d’achats' },
];
const operators = [
  { name: 'Nicola Directeur', role: 'superuser', personnelId: 'p_dir' },
  { name: 'Sophie Gestion', role: 'superuser', personnelId: 'p_gest' },
  { name: 'Paul Achats', role: 'user', personnelId: 'p_achats' },
];

const superuserEmails = superuserEmailsOf(operators, personnel);
eq(superuserEmails, ['dir@lab.fr', 'gestion@lab.fr'], 'les DEUX comptes superutilisateur sont résolus (directeur + gestionnaire)');

const gestionnaireEmails = personnelEmailsMatching(personnel, { fonction: 'Gestionnaire' });
eq(gestionnaireEmails, ['gestion@lab.fr'], 'la fiche « Gestionnaire » est identifiée par sa fonction');

/* Le bug signalé : marquer « Approuvé » écrivait à ces deux adresses. */
eq(superuserNoticeEmailsOf(superuserEmails, gestionnaireEmails), ['dir@lab.fr'],
  'APPROBATION : la gestionnaire est retirée même si elle a un compte superutilisateur');

/* ── 2. Cas limites */
eq(superuserNoticeEmailsOf(['dir@lab.fr'], []), ['dir@lab.fr'], 'aucune fiche « Gestionnaire » → liste inchangée');
eq(superuserNoticeEmailsOf(['dir@lab.fr'], ['  ']), ['dir@lab.fr'], 'adresse vide (ou blanche) ignorée');
eq(superuserNoticeEmailsOf(['dir@lab.fr'], ['GESTION@LAB.FR']), ['dir@lab.fr'], 'comparaison insensible à la casse');
eq(superuserNoticeEmailsOf(['gestion@lab.fr'], ['gestion@lab.fr']), ['gestion@lab.fr'],
  'le superutilisateur EST la gestionnaire → liste complète conservée (jamais d’envoi vers personne)');
eq(superuserNoticeEmailsOf('dir@lab.fr', 'gestion@lab.fr'), ['dir@lab.fr'], 'une adresse seule (chaîne) est acceptée aussi');
eq(superuserNoticeEmailsOf([], ['gestion@lab.fr']), [], 'aucun superutilisateur → rien à envoyer');

/* ── 3. Bannière : elle nomme les destinataires RÉELS quand l’e-mail part */
const sent = summarizeMailTo({ ok: true, mode: 'gmail' }, 'Superutilisateur', ['dir@lab.fr']);
ok(sent.text.includes('e-mail envoyé') && sent.text.includes('destinataire(s) : dir@lab.fr'),
  `bannière d’un envoi réussi : « ${sent.text} »`);
const failed = summarizeMailTo({ ok: false, mode: 'none', reason: 'aucune adresse' }, 'Superutilisateur', ['dir@lab.fr']);
ok(failed.text.includes('NON envoyé'), `bannière d’un échec inchangée : « ${failed.text} »`);
const noList = summarizeMailTo({ ok: true, mode: 'server' }, 'Superutilisateur', ['', ' ']);
eq(noList.text, 'Superutilisateur : e-mail envoyé ✓', 'aucune adresse valide → bannière sans « destinataire(s) »');


/* ── 4. Câblage des pages (source) ─────────────────────────────────────────── */
const desi = readFileSync('src/administration/desiderataPage.jsx', 'utf8');
const om = readFileSync('src/administration/omPage.jsx', 'utf8');
const appr = readFileSync('src/administration/approbationPage.jsx', 'utf8');

[['desiderataPage.jsx', desi], ['omPage.jsx', om]].forEach(([name, src]) => {
  ok(/const superuserNoticeEmails = useMemo\(/.test(src) && /superuserNoticeEmailsOf\(superuserEmails, personnelEmailsMatching\(personnel, \{ fonction: 'Gestionnaire' \}\)\)/.test(src),
    `${name} : les notifications « superutilisateur » retirent les fiches « Gestionnaire »`);
  const i = src.indexOf('const notifyApproved');
  const approved = src.slice(i, i + 1400);
  ok(/to: superuserNoticeEmails,/.test(approved), `${name} : notifyApproved envoie à superuserNoticeEmails`);
  ok(/summarizeMailTo\(res, 'Superutilisateur', superuserNoticeEmails\)/.test(approved),
    `${name} : la bannière d’approbation nomme les destinataires`);
  /* Les NOUVELLES demandes (membre → superutilisateur) n’oublient pas la même exclusion. */
  ok(/summarizeMailTo\(res, 'Superutilisateur notifié', superuserNoticeEmails\)/.test(src),
    `${name} : la bannière de nouvelle demande nomme aussi les destinataires`);
  ok((src.match(/to: superuserNoticeEmails,/g) || []).length >= 2,
    `${name} : les deux notifications « superutilisateur » (nouvelle demande + approbation) visent la même liste`);
  ok(!/to: mergeEmails\(/.test(src), `${name} : plus aucun envoi fusionné superutilisateur + gestionnaire`);
  ok(!/'Superutilisateur & gestionnaire\(s\)'/.test(src), `${name} : libellé « Superutilisateur & gestionnaire(s) » supprimé`);
});

/* Le transfert « pour signature » / « pour révision » continue de prévenir la
   responsable d’achats avec les adresses de la cible (transferAchats.js). */
[['desiderataPage.jsx', desi], ['omPage.jsx', om]].forEach(([name, src]) => {
  ok(/to: cible\.emails,/.test(src), `${name} : le transfert notifie toujours les cibles (cible.emails)`);
  ok(/notificationTargetOf\(personnel, meta\.code\)/.test(src), `${name} : la cible du transfert reste résolue par fonction`);
});

/* La signature / les décisions de devis & BC (approbationPage.jsx) notifient
   toujours les gestionnaires — inchangé par ce correctif. */
ok(/const gestionnaireEmails = useMemo\(/.test(appr), 'approbationPage.jsx : gestionnaireEmails toujours utilisé');
ok(/personnelEmailsMatching\(personnel, \{ fonction: 'Gestionnaire' \}\)/.test(appr),
  'approbationPage.jsx : les e-mails de décision / signature visent toujours les gestionnaires');

console.log(`_mail_recipients_test: ${passed} passed`);
