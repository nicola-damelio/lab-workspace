/* =========================================================================
   src/utils/passwordResets.js
   « I FORGOT MY PASSWORD » — LA DEMANDE EST UN RECORD, PAS UN MESSAGE PERDU.

   LE DÉFAUT RÉPARÉ ICI : un mot de passe ne peut pas être réinitialisé par le
   client (c'est le serveur de jetons qui les vérifie, voir
   server/token-server.js) et personne ne peut changer un mot de passe sans
   connaître l'ancien — pas même un superutilisateur. La seule chose que l'app
   peut faire honnêtement, c'est :
     1. ENREGISTRER la demande (ici, dans ce magasin daté) : c'est ce que le
        superutilisateur voit là où il pose le nouveau mot de passe
        (Setup → Team & access) ;
     2. PRÉVENIR les superutilisateurs par e-mail — le canal qui traverse les
        postes (voir sendAdminMail / emailNotify.js, avec le repli mailto:).

   La demande vit donc comme les autres records de l'application (tombes de
   projets et d'expériences) : une entrée par PERSONNE (identité = le nom,
   accents et ordre des mots ignorés — `opNameKey`), horodatée, avec son état
   « ouverte » ou « traitée ». Re-demander rafraîchit la demande et la ROUVRE
   (une demande plus récente qu'une clôture doit se voir) ; la clôture d'un
   superutilisateur, elle, l'emporte sur une demande plus ANCIENNE — sans quoi
   deux postes se renverraient indéfiniment « ouverte / traitée ».

   Tout est PUR ici, à l'exception du bloc « MAGASIN » en fin de fichier.
   Vérifié par _password_reset_test.mjs.
   ========================================================================= */
import { opNameKey } from './auth';

/** Clé localStorage des demandes. */
export const PASSWORD_RESETS_KEY = 'labWorkspace_passwordResets';
/** Nombre de demandes conservées (les plus récentes). */
export const MAX_RESET_REQUESTS = 200;

export const RESET_OPEN = 'open';
export const RESET_DONE = 'done';

const clean = (v) => String(v === undefined || v === null ? '' : v).trim();
const nameOf = (entry) => clean(entry && typeof entry === 'object' ? entry.name : entry);
const stampOf = (v) => Number(v) || 0;

/** L'identité d'une demande : la PERSONNE (une demande à la fois par personne). */
export const resetKey = (entry) => opNameKey(nameOf(entry));

const newId = (askedAt) => `pr_${askedAt}_${Math.random().toString(36).slice(2, 8)}`;

/** Une liste de demandes propre et utilisable : une entrée par personne (la
 *  demande la plus récente), l'état « traitée » l'emportant quand la clôture est
 *  POSTÉRIEURE à la demande, bornée, la plus récente d'abord. Accepte les
 *  entrées incomplètes d'une version ancienne (un nom seul devient une
 *  demande). */
export const normalizeResets = (list) => {
  const flat = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v) flat.push(v);
  };
  walk(list);
  const groups = new Map();
  flat.forEach((raw) => {
    const isObject = !!raw && typeof raw === 'object';
    const askedAt = stampOf(isObject ? raw.askedAt : 0);
    const entry = {
      id: clean(isObject ? raw.id : '') || newId(askedAt || Date.now()),
      name: nameOf(raw),
      key: resetKey(raw),
      note: clean(isObject ? raw.note : ''),
      askedAt,
      status: clean(isObject ? raw.status : '') === RESET_DONE ? RESET_DONE : RESET_OPEN,
      doneAt: stampOf(isObject ? raw.doneAt : 0)
    };
    if (!entry.key) return;
    const group = groups.get(entry.key) || [];
    group.push(entry);
    groups.set(entry.key, group);
  });
  const out = [];
  groups.forEach((group) => {
    const latest = group.slice().sort((a, b) => b.askedAt - a.askedAt)[0];
    const closed = group
      .filter((e) => e.status === RESET_DONE && e.doneAt >= latest.askedAt)
      .sort((a, b) => b.doneAt - a.doneAt)[0];
    out.push(closed
      ? { ...latest, status: RESET_DONE, doneAt: closed.doneAt }
      : { ...latest, status: RESET_OPEN, doneAt: 0 });
  });
  return out.sort((a, b) => b.askedAt - a.askedAt).slice(0, MAX_RESET_REQUESTS);
};

/** Enregistrer une demande : une personne n'a qu'une demande à la fois (la plus
 *  récente remplace la précédente, note comprise). Rend la liste à jour. */
export const addPasswordReset = (list, { name, note = '', askedAt = Date.now() } = {}) => {
  const at = stampOf(askedAt) || Date.now();
  const entry = {
    id: newId(at),
    name: clean(name),
    note: clean(note),
    askedAt: at,
    status: RESET_OPEN,
    doneAt: 0
  };
  const key = resetKey(entry);
  if (!key) return normalizeResets(list);
  const others = normalizeResets(list).filter((r) => r.key !== key);
  return normalizeResets([entry, ...others]);
};

/** Marquer une demande comme traitée (le superutilisateur a posé un nouveau mot
 *  de passe). Accepte l'id de la demande, la clé de la personne, ou son nom. */
export const markResetHandled = (list, idOrKey, doneAt = Date.now()) => {
  const at = stampOf(doneAt) || Date.now();
  const wanted = clean(idOrKey);
  return normalizeResets(normalizeResets(list).map((r) => (
    (r.id === wanted || r.key === wanted || opNameKey(r.name) === wanted)
      ? { ...r, status: RESET_DONE, doneAt: at }
      : r
  )));
};

/** Les demandes encore ouvertes (ce que le superutilisateur doit traiter). */
export const openResets = (list) => normalizeResets(list).filter((r) => r.status !== RESET_DONE);

/** Fusionner deux copies de la liste (deux postes, ou la copie partagée) : une
 *  entrée par personne, la clôture la plus récente décide (voir l'en-tête). */
export const mergeResets = (a, b) => normalizeResets([
  ...(Array.isArray(b) ? b : []),
  ...(Array.isArray(a) ? a : [])
]);

/** Le sujet et le corps de l'e-mail envoyé aux superutilisateurs. */
export const resetMailSubject = (entry, label = 'Lab Workspace') =>
  `[${label}] Password reset requested — ${nameOf(entry) || 'a team member'}`;

export const resetRequestText = (entry, { label = 'Lab Workspace' } = {}) => {
  const at = stampOf(entry && entry.askedAt);
  const when = at ? new Date(at).toLocaleString() : '';
  return [
    'Hello,',
    '',
    `${nameOf(entry) || 'A team member'} cannot sign in to ${label} (forgotten password) and asks for a reset.`,
    '',
    'What to do: open Setup → Team & access, find the account, press the pencil (✏️), type a new',
    'password and press Save — then tell the person that new password. A password can only be',
    'REPLACED (nobody, not even a superuser, can read the old one: it is the lab token server that',
    'checks it at sign-in).',
    '',
    `Requested: ${when}`,
    entry && entry.note ? `Note from the person: ${entry.note}` : '',
    '',
    `This request is also recorded in the app (${label} → Change My Password → 🔑 I forgot my password).`,
    '',
    `Message sent automatically by ${label}.`
  ].filter((line) => line !== '').join('\n');
};

/** Le compte-rendu affiché à la personne qui demande (jamais « c'est fait »
 *  quand ça ne l'est pas : l'e-mail part ou ne part pas, et on le dit). */
export const describeResetOutcome = (entry, mailResult) => {
  const at = stampOf(entry && entry.askedAt);
  const when = at ? new Date(at).toLocaleTimeString() : '';
  const asked = `Request recorded on this computer${when ? ` at ${when}` : ''}.`;
  if (mailResult && mailResult.ok) return `${asked} The superuser(s) were notified by e-mail.`;
  return asked;
};

/* ---------------------------------------------------------------------------
 * 💾 MAGASIN — la clé localStorage des demandes (les composants ne font que
 *    l'entrée / sortie, comme pour les autres records)
 * ------------------------------------------------------------------------ */

const storeOf = () => {
  try {
    return globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;   // navigation privée : la demande reste en mémoire pour la session
  }
};

export const loadPasswordResets = () => {
  const store = storeOf();
  if (!store) return [];
  try {
    return normalizeResets(JSON.parse(store.getItem(PASSWORD_RESETS_KEY) || '[]'));
  } catch {
    return [];
  }
};

export const savePasswordResets = (list) => {
  const out = normalizeResets(list);
  const store = storeOf();
  if (!store) return out;
  try { store.setItem(PASSWORD_RESETS_KEY, JSON.stringify(out)); } catch { /* plein / privé */ }
  return out;
};

/** LE GESTE : la personne demande un nouveau mot de passe. Rend l'entrée
 *  enregistrée (celle qui part dans l'e-mail et dans le panneau du
 *  superutilisateur). */
export const requestPasswordReset = ({ name, note = '', askedAt = Date.now() } = {}) => {
  const list = addPasswordReset(loadPasswordResets(), { name, note, askedAt });
  savePasswordResets(list);
  return list.find((r) => r.key === resetKey({ name })) || list[0] || null;
};

/** LA CLÔTURE : le superutilisateur a posé un nouveau mot de passe. */
export const closePasswordReset = (idOrKey, doneAt = Date.now()) =>
  savePasswordResets(markResetHandled(loadPasswordResets(), idOrKey, doneAt));

/** Adopter les demandes portées par une copie (une autre exécution, une
 *  sauvegarde) : elles s'ajoutent aux nôtres, la plus récente décidant. */
export const adoptPasswordResets = (list) => savePasswordResets(mergeResets(loadPasswordResets(), list));

