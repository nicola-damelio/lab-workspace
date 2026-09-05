/* =========================================================================
   src/administration/emailNotify.js
   Notifications e-mail du module Administration (page « Approbation devis
   & BC ») : dépôt → superutilisateur, décision → gestionnaire(s).

   L'envoi se fait par le serveur partagé (server/token-server.js, endpoint
   POST /api/mail) qui relaie vers l'API mail configurée par variables
   d'environnement (MAIL_API_URL / MAIL_API_KEY / MAIL_FROM). Si aucun
   endpoint n'est configuré côté app (GOOGLE_TOKEN_EXCHANGE_URL vide) ou si
   le serveur répond « mail_not_configured », l'app retombe sur un lien
   mailto: pré-rempli que l'utilisateur peut ouvrir (aucun e-mail n'est
   jamais envoyé silencieusement sans adresse valide).
   ========================================================================= */
import { GOOGLE_TOKEN_EXCHANGE_URL } from '../data/constants';

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

/** E-mails des fiches Personnel correspondant à un critère ({ fonction?, type? }). */
export const personnelEmailsMatching = (personnel = [], { fonction = '', type = '' } = {}) => {
  const out = [];
  (Array.isArray(personnel) ? personnel : []).forEach((p) => {
    if (fonction && String(p.fonction || '').trim() !== fonction) return;
    if (type && String(p.type || '').trim() !== type) return;
    const email = personEmailOf(p);
    if (email && out.indexOf(email) === -1) out.push(email);
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
 * Envoie un e-mail via le serveur partagé.
 * @param {{to:string|string[], subject:string, text:string}} msg
 * @returns {Promise<{ok:boolean, mode:'server'|'mailto'|'none', mailto?:string, reason?:string}>}
 */
export const sendAdminMail = async ({ to = [], subject = '', text = '' } = {}) => {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((s) => String(s || '').trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const unique = [...new Set(recipients)];
  if (!unique.length) return { ok: false, mode: 'none', reason: 'Aucune adresse e-mail renseignée (fiche Personnel).' };
  const subjectText = String(subject || '').trim();
  const bodyText = String(text || '').trim();
  const mailto = buildMailto(unique, subjectText, bodyText);

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
  return { ok: false, mode: 'mailto', mailto, reason: 'Aucun serveur e-mail configuré (GOOGLE_TOKEN_EXCHANGE_URL vide).' };
};

/** Résumé lisible du résultat d’un envoi pour une bannière de confirmation
 *  (avec lien de repli mailto: quand le serveur d’e-mail est indisponible). */
export const summarizeMail = (res, label = 'Notification') => {
  if (res && res.ok) return { text: `${label} : e-mail envoyé ✓` };
  if (res && res.mode === 'mailto' && res.mailto) {
    return {
      text: `${label} : e-mail NON envoyé — ${res.reason || 'serveur e-mail indisponible'}. Cliquez pour l'envoyer depuis votre messagerie.`,
      mailto: res.mailto,
    };
  }
  return { text: `${label} : e-mail NON envoyé — ${(res && res.reason) || 'aucune adresse e-mail disponible (fiche Personnel).'}` };
};

/** Corps d’e-mail générique (préfixe/suffixe communs du module Administration). */
export const mailBodyText = (lines) =>
  `Bonjour,\n\n${(Array.isArray(lines) ? lines : [lines]).join('\n')}\n\nMessage envoyé automatiquement par Lab Workspace (module Administration).`;
