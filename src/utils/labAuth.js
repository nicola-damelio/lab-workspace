/* =========================================================================
   src/utils/labAuth.js
   Authentification SERVEUR de l'équipe (voir docs/SECURITY-SETUP.md).

   Le mot de passe n'est plus vérifié uniquement dans le navigateur : il est
   vérifié par le serveur de jetons (server/token-server.js) qui, en cas de
   succès, renvoie un jeton personnalisé Firebase. Les règles Firestore
   (firestore.rules) n'acceptent QUE les jetons portant la revendication
   « lab » — donc sans compte valide, personne ne peut lire ni modifier le
   workspace, même en connaissant l'URL de l'application.

   Toutes les fonctions renvoient un objet { ok, … } et N'ÉMETTENT JAMAIS
   d'exception : un serveur injoignable ne doit pas casser l'application.
   ========================================================================= */
import { GOOGLE_TOKEN_EXCHANGE_URL } from '../data/constants';

/** URL de base du serveur de jetons ('' quand non configuré). */
export const authServerBase = () =>
  String(GOOGLE_TOKEN_EXCHANGE_URL || '').trim().replace(/\/+$/, '');

export const authServerConfigured = () => !!authServerBase();

// Jeton administrateur (ADMIN_TOKEN du serveur) : saisi une fois par le
// superutilisateur dans Setup → Équipe & accès. Il ne permet QUE de publier la
// liste de l'équipe ; il ne donne aucun accès aux données.
const ADMIN_TOKEN_KEY = 'labWorkspace_serverAdminToken';
export const serverAdminToken = () => {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
};
export const setServerAdminToken = (token) => {
  try {
    const t = String(token || '').trim();
    if (t) localStorage.setItem(ADMIN_TOKEN_KEY, t);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch { /* quota — ignoré */ }
};

const REQUEST_TIMEOUT_MS = 15000;

const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const base = authServerBase();
  if (!base) return { ok: false, status: 0, error: 'no_server', message: 'Aucun serveur de jetons configuré.' };
  let timer = null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${base}${path}`, {
      method,
      signal: controller ? controller.signal : undefined,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return {
      ok: res.ok,
      status: res.status,
      json: json || {},
      error: (json && json.error) || (res.ok ? '' : `HTTP ${res.status}`),
      message: (json && json.error_description) || ''
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: 'unreachable',
      message: (err && err.name === 'AbortError')
        ? 'Le serveur de jetons n’a pas répondu à temps.'
        : `Serveur de jetons injoignable (${(err && err.message) || 'erreur réseau'}).`
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** État de l'authentification serveur : { configured, accounts, … }.
 *  `ready` = serveur prêt ET équipe publiée → la connexion DOIT passer par lui. */
export const fetchAuthStatus = async () => {
  const res = await request('/api/auth/status');
  if (!res.ok) {
    return { ok: false, configured: false, accounts: 0, ready: false, error: res.error, message: res.message };
  }
  const accounts = Number(res.json.accounts || 0);
  return {
    ok: true,
    configured: !!res.json.configured,
    accounts,
    adminPushEnabled: !!res.json.adminPushEnabled,
    /* Le serveur annonce les routes qu'il connaît : un déploiement antérieur à
       POST /api/auth/change-password ne renvoie pas ce marqueur (voir
       serverChangePassword, qui s'en sert pour expliquer l'échec). */
    changePasswordEnabled: res.json.authChangePassword === true,
    version: res.json.version || '',
    savedAt: res.json.savedAt || '',
    ready: !!res.json.configured && accounts > 0
  };
};

/** Liste des membres (id, name, role) — SANS mot de passe ni hash. */
export const fetchRoster = async () => {
  const res = await request('/api/auth/roster');
  if (!res.ok || !Array.isArray(res.json && res.json.members)) {
    return { ok: false, members: [], error: res.error, message: res.message };
  }
  return { ok: true, members: res.json.members };
};

/** Connexion : { name, password } → { token, name, role, id }. */
export const serverLogin = async (name, password) => {
  const res = await request('/api/auth/login', { method: 'POST', body: { name, password } });
  if (!res.ok || !res.json || !res.json.token) {
    return {
      ok: false,
      error: res.error,
      message: res.message || 'Connexion refusée par le serveur.',
      status: res.status
    };
  }
  return {
    ok: true,
    token: res.json.token,
    id: res.json.id || '',
    name: res.json.name || name,
    role: res.json.role === 'superuser' ? 'superuser' : 'user'
  };
};

/** Publie la copie serveur de l'équipe (superutilisateur). Les hash SHA-256 de
 *  l'application sont acceptés : le serveur les durcit en PBKDF2 dès la
 *  première connexion réussie. `staleIgnored` = fiches dont l'empreinte publiée
 *  est PLUS ANCIENNE que celle enregistrée (la personne a changé son mot de
 *  passe entre-temps) : le serveur a gardé la sienne. */
export const publishAccounts = async (operators, adminToken) => {
  const token = String(adminToken || serverAdminToken() || '').trim();
  if (!token) {
    return {
      ok: false,
      error: 'no_admin_token',
      message: 'Jeton administrateur manquant (Setup → Équipe & accès).'
    };
  }
  const members = (Array.isArray(operators) ? operators : [])
    .map((op) => ({
      id: String((op && op.id) || '').trim(),
      name: String((op && op.name) || '').trim(),
      role: op && op.role === 'superuser' ? 'superuser' : 'user',
      passwordHash: String((op && op.passwordHash) || '').trim().toLowerCase()
    }))
    .filter((m) => m.name);
  if (!members.length) return { ok: false, error: 'empty_roster', message: 'Aucun compte à publier.' };
  const res = await request('/api/auth/accounts', {
    method: 'POST',
    body: { members },
    headers: { 'X-Admin-Token': token }
  });
  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      message: res.message || 'Publication refusée par le serveur.',
      status: res.status
    };
  }
  return {
    ok: true,
    accounts: Number(res.json.accounts || members.length),
    withPassword: Number(res.json.withPassword || 0),
    staleIgnored: Array.isArray(res.json.staleIgnored) ? res.json.staleIgnored : []
  };
};

/** Changement du mot de passe de la personne CONNECTÉE : le serveur vérifie
 *  l'ancien mot de passe puis remplace SA fiche. Indispensable — la publication
 *  de l'équipe (publishAccounts) exige le jeton administrateur, réservé aux
 *  superutilisateurs ; sans cet appel, un changement fait dans l'application ne
 *  touchait pas la copie du serveur, seul vérificateur des mots de passe : le
 *  nouveau mot de passe était refusé et l'ancien continuait de fonctionner. */
export const serverChangePassword = async (name, currentPassword, newPassword) => {
  const res = await request('/api/auth/change-password', {
    method: 'POST',
    body: { name, currentPassword, newPassword }
  });
  if (!res.ok) {
    /* Serveur ANTÉRIEUR à cette route : le POST n'a été reconnu par personne et
       est retombé sur l'échange de jeton, qui ne trouve aucun « grant_type »
       dans notre corps → « Unknown grant_type "" ». (Une fois le garde-fou du
       serveur en place, le même cas répond 404 not_found.) Le message affiché
       doit dire QUOI FAIRE : redéployer le serveur de jetons. */
    const staleDeployment = res.error === 'unsupported_grant_type'
      || res.error === 'not_found' || res.status === 404;
    return {
      ok: false,
      error: res.error,
      needsRedeploy: staleDeployment,
      message: staleDeployment
        ? `Le serveur de jetons (${authServerBase()}) ne connaît pas encore POST /api/auth/change-password : `
          + 'il est ANTÉRIEUR à cette fonctionnalité. Redéployez server/token-server.js '
          + '(voir server/README.md) — sans cela, la connexion continuera d\'accepter l\'ancien mot de passe.'
        : (res.message || 'Changement de mot de passe refusé par le serveur.'),
      status: res.status
    };
  }
  return { ok: true, name: res.json.name || name, changedAt: res.json.changedAt || '' };
};

/** Échange le jeton du serveur contre une session Firebase (l'identité et le
 *  rôle deviennent signés : plus falsifiables en localStorage). */
export const applyServerSession = async (customToken) => {
  const fb = typeof window !== 'undefined' ? window.firebase : null;
  if (!fb || !fb.auth) return { ok: false, message: 'SDK Firebase indisponible dans cette page.' };
  try {
    await fb.auth().signInWithCustomToken(customToken);
    const user = fb.auth().currentUser;
    let claims = {};
    try {
      const tok = await user.getIdTokenResult();
      claims = (tok && tok.claims) || {};
    } catch { /* revendications illisibles : Firestore refusera de toute façon */ }
    return { ok: true, claims, uid: (user && user.uid) || '' };
  } catch (err) {
    return {
      ok: false,
      message: `Firebase a refusé le jeton du serveur (${(err && err.code) || (err && err.message) || 'erreur inconnue'}). `
        + 'Vérifiez que FIREBASE_SERVICE_ACCOUNT appartient bien au projet Firebase de cette application.'
    };
  }
};

/** Ferme la session Firebase : Firestore redevient inaccessible. */
export const clearFirebaseSession = async () => {
  const fb = typeof window !== 'undefined' ? window.firebase : null;
  try { if (fb && fb.auth) await fb.auth().signOut(); } catch { /* ignoré */ }
};
