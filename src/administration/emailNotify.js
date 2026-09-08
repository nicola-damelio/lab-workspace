/* =========================================================================
   src/administration/emailNotify.js
   Notifications e-mail du module Administration (page « Approbation devis
   & BC ») : dépôt → superutilisateur, décision → gestionnaire(s).

   L'envoi passe en priorité par l'API Gmail du compte Google déjà connecté
   pour Drive (portée gmail.send — voir GOOGLE_MAIL_SEND_SCOPE) : l'e-mail
   part alors de l'adresse de ce compte, normalement celle de la fiche
   Personnel. En secours, l'app utilise le serveur partagé (server/token-
   server.js, endpoint POST /api/mail) puis un lien mailto: pré-rempli
   (aucun e-mail n'est jamais envoyé silencieusement sans adresse valide).
   NB configuration : pour que l'envoi automatique fonctionne, l'API « Gmail »
   doit être activée UNE FOIS dans le projet Google Cloud du client OAuth
   (console Google Cloud → « API Gmail »). Si Google répond « Gmail API has not
   been used in project … or it is disabled », une reconnexion de « Google
   Drive » ne corrige pas le problème : c'est l'activation de l'API dans la
   console qui débloque l'envoi (voir sendAdminGmail dans driveUpload.js).

   ========================================================================= */
import { GOOGLE_TOKEN_EXCHANGE_URL } from '../data/constants';
import { sendAdminGmail } from '../utils/driveUpload';
import { fonctionsOfPerson } from './adminSchema';

/** Adresse e-mail d'une fiche Personnel (la clé peut varier selon les bases). */
export const personEmailOf = (person) => {
  if (!person || typeof person !== 'object') return '';
  const keys = ['email', 'mail', 'courriel', 'emailPro', 'emailPerso', 'contact'];
  for (const k of keys) {
    const v = String(person[k] || '').trim();
    if (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return v;
  }
  return '';
};

/** E-mails des fiches Personnel correspondant à un critère ({ fonction?, type? }).
 *  Une fiche peut porter plusieurs fonctions : elle correspond dès qu’une de
 *  ses fonctions est la fonction demandée. */
export const personnelEmailsMatching = (personnel = [], { fonction = '', type = '' } = {}) => {
  const out = [];
  (Array.isArray(personnel) ? personnel : []).forEach((p) => {
    if (fonction && fonctionsOfPerson(p).indexOf(fonction) === -1) return;
    if (type && String(p.type || '').trim() !== type) return;
    const email = personEmailOf(p);
    if (email && out.indexOf(email) === -1) out.push(email);
  });
  return out;
};

/* ── Adresses des superutilisateurs (opérateurs → fiche Personnel) ─────── */

/** Normalise un nom pour comparaison tolérante (ordre des mots ignoré). */
const normName = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Deux noms correspondent si leurs mots triés sont identiques (ex. « Jean Dupont »). */
const samePersonName = (a, b) => {
  const ka = normName(a);
  const kb = normName(b);
  if (!ka || !kb) return false;
  const toks = (x) => x.split(/\s+/).sort().join(' ');
  return toks(ka) === toks(kb);
};

/** Fiche Personnel d'un opérateur : lien explicite (personnelId), sinon nom. */
const personOfOperator = (op, personnel = []) => {
  const list = Array.isArray(personnel) ? personnel : [];
  if (!op) return null;
  if (op.personnelId) {
    const byId = list.find((p) => p && p.id === op.personnelId);
    if (byId) return byId;
  }
  if (String(op.name || '').trim()) {
    return list.find((p) => p && samePersonName(p.nom, op.name)) || null;
  }
  return null;
};

/** E-mails des opérateurs « superuser », résolus via leur fiche Personnel. */
export const superuserEmailsOf = (operators = [], personnel = []) => {
  const out = [];
  (Array.isArray(operators) ? operators : []).forEach((op) => {
    if (!op || String(op.role || '').trim() !== 'superuser') return;
    const email = personEmailOf(personOfOperator(op, personnel));
    if (email && out.indexOf(email) === -1) out.push(email);
  });
  return out;
};

/** Fusionne plusieurs listes d'adresses e-mail (vidées, dédoublonnées). */
export const mergeEmails = (...lists) => {
  const out = [];
  lists.forEach((list) => {
    (Array.isArray(list) ? list : [list]).forEach((e) => {
      const s = String(e || '').trim();
      if (s && out.indexOf(s) === -1) out.push(s);
    });
  });
  return out;
};

/** URL de base du serveur partagé ('' quand non configuré). */
export const adminMailServerBase = () =>
  String(GOOGLE_TOKEN_EXCHANGE_URL || '').trim().replace(/\/+$/, '');

/** Lien mailto: pré-rempli (repli quand aucun serveur d'e-mail). */
export const buildMailto = (to = [], subject = '', body = '') => {
  const list = (Array.isArray(to) ? to : [to]).map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return '';
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const q = params.toString();
  return `mailto:${list.join(',')}${q ? `?${q}` : ''}`;
};

/**
 * Envoie un e-mail.
 * 1) Via l'API Gmail du compte Google connecté (envoi automatique, l'e-mail
 *    part de l'adresse de ce compte — idéalement celle de la fiche Personnel) ;
 * 2) sinon via le serveur partagé (/api/mail) quand GOOGLE_TOKEN_EXCHANGE_URL
 *    est configuré ;
 * 3) sinon un lien mailto: pré-rempli est renvoyé (aucun envoi silencieux).
 * @param {{to:string|string[], subject:string, text:string, fromName?:string, replyTo?:string}} msg
 * @returns {Promise<{ok:boolean, mode:'gmail'|'server'|'mailto'|'none', mailto?:string, reason?:string}>}
 */
export const sendAdminMail = async ({ to = [], subject = '', text = '', fromName = '', replyTo = '' } = {}) => {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((s) => String(s || '').trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const unique = [...new Set(recipients)];
  if (!unique.length) return { ok: false, mode: 'none', reason: 'Aucune adresse e-mail renseignée (fiche Personnel).' };
  const subjectText = String(subject || '').trim();
  const bodyText = String(text || '').trim();
  const mailto = buildMailto(unique, subjectText, bodyText);

  // 1) Envoi automatique via Gmail (compte Google déjà connecté pour Drive).
  const gmail = await sendAdminGmail({ to: unique, subject: subjectText, text: bodyText, fromName, replyTo })
    .catch((err) => ({ ok: false, reason: (err && err.message) || 'Gmail injoignable' }));
  if (gmail.ok) return { ok: true, mode: 'gmail' };

  // 2) Repli : relais e-mail du serveur partagé (si un endpoint est configuré).
  const base = adminMailServerBase();
  if (base) {
    try {
      const res = await fetch(`${base}/api/mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: unique, subject: subjectText, text: bodyText }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j && j.ok) return { ok: true, mode: 'server' };
      return { ok: false, mode: 'mailto', mailto, reason: (j && j.error_description) || (j && j.error) || `Serveur e-mail (HTTP ${res.status})` };
    } catch (err) {
      return { ok: false, mode: 'mailto', mailto, reason: (err && err.message) || 'Serveur e-mail injoignable' };
    }
  }

  // 3) Dernier repli : lien mailto: pré-rempli (l'utilisateur clique et envoie).
  return {
    ok: false,
    mode: 'mailto',
    mailto,
    ...(gmail && gmail.consoleUrl ? { consoleUrl: gmail.consoleUrl } : {}),
    reason: gmail.reason || 'Aucun serveur e-mail configuré (GOOGLE_TOKEN_EXCHANGE_URL vide).',
  };
};

/** Résumé lisible du résultat d’un envoi pour une bannière de confirmation
 *  (avec lien de repli mailto: quand le serveur d’e-mail est indisponible). */
export const summarizeMail = (res, label = 'Notification') => {
  if (res && res.ok) return { text: `${label} : e-mail envoyé ✓` };
  if (res && res.mode === 'mailto' && res.mailto) {
    return {
      text: `${label} : e-mail NON envoyé — ${res.reason || 'serveur e-mail indisponible'}. Cliquez pour l'envoyer depuis votre messagerie.`,
      mailto: res.mailto,
      ...(res.consoleUrl ? { consoleUrl: res.consoleUrl } : {}),
    };
  }
  return { text: `${label} : e-mail NON envoyé — ${(res && res.reason) || 'aucune adresse e-mail disponible (fiche Personnel).'}` };
};

/** Corps d’e-mail générique (préfixe/suffixe communs du module Administration). */
export const mailBodyText = (lines) =>
  `Bonjour,\n\n${(Array.isArray(lines) ? lines : [lines]).join('\n')}\n\nMessage envoyé automatiquement par Lab Workspace (module Administration).`;
