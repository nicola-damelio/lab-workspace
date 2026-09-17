#!/usr/bin/env node
/* =========================================================================
   server/token-server.js

   Token-mint server for the shared "Lab Workspace" Google Drive folder.

   WHY IT EXISTS
   The app saves every uploaded file into ONE shared Lab Workspace Drive
   folder. Google access tokens live ~1 hour and can only be refreshed with a
   "refresh token", which Google hands out ONLY to a server that owns the
   OAuth client secret. This zero-dependency Node server keeps a single
   permanent refresh token (the workspace owner's) and mints short-lived
   access tokens for every browser that opens the app. No user ever logs into
   Google — Drive simply always works, on any lab machine.

   ENDPOINTS  (all POST with Content-Type: application/json)
     { grant_type: 'workspace' }
         Mint { access_token, expires_in } from the stored workspace token.
         Until the owner has bootstrapped the credential this answers
         503 { error: 'workspace_not_initialized', ... } and the app shows a
         clear "one-time setup needed" message instead of failing silently.
     { grant_type: 'authorization_code', code }
         OWNER BOOTSTRAP: exchange the GIS code (redirect_uri=postmessage,
         access_type=offline, prompt=consent) with Google and STORE the
         refresh_token as the shared workspace credential. The refresh token is
         NEVER returned to the browser. Overwriting an existing credential is
         refused unless SHARED_EMAIL is set and the new account matches it.
     { grant_type: 'refresh_token', refresh_token }
         Legacy per-user refresh (used by older builds only — the shared app
         build never sends a refresh token to this server).
   GET /health
         { ok, service, initialized, email } — handy to verify deployment.
   POST /api/mail
         { to: string|string[], subject, text } — automatic e-mail relay for
         the administration notifications (devis/BC approval workflow). Sent
         through the HTTP mail service configured with MAIL_API_URL (see
         below); without it this answers 501 { error: 'mail_not_configured' }
         and the app falls back to a pre-filled mailto: link.

     POST /api/auth/login      { name, password }
         Verify the password SERVER-SIDE (PBKDF2-SHA256, legacy SHA-256 hashes
         are upgraded on first successful login) and answer
         { token } — a signed Firebase custom token carrying
         claims { lab: true, name, role }. The browser trades it with Firebase
         (signInWithCustomToken); the Firestore rules accept ONLY such tokens,
         so the workspace data is unreadable to anybody without an account.
     GET  /api/auth/roster
         { members: [{ id, name, role }] } — NO password, NO hash: only what
         the login screen needs to fill its name list before authentication.
     POST /api/auth/accounts   (header X-Admin-Token: <ADMIN_TOKEN>)
         { members: [{ id, name, role, passwordHash }] } — replaces the
         server-side copy of the team (the app publishes it from Setup).
         PBKDF2 upgrades already obtained are preserved when the published
         hash for a member is unchanged.
     GET  /api/auth/status
         { configured, accounts, savedAt, adminPushEnabled } — lets the app
         know whether server authentication is active.

   ENV VARS
     PORT                   HTTP port (default 8787).
     GOOGLE_CLIENT_ID       default: the app's OAuth Web client id.
     GOOGLE_CLIENT_SECRET   REQUIRED — never commit it; inject at deploy time.
     SHARED_EMAIL           optional: the workspace owner's Google email. When
                            set, the bootstrap refuses any other account
                            (protects the shared credential from being swapped).
     ALLOWED_ORIGINS        comma-separated browser origins allowed to call the
                            endpoint (CORS). Curl and same-origin requests are
                            always allowed. Example:
                            https://lab.example.com,http://localhost:5173
     CORS_ALLOW_HEADERS     comma-separated request headers the browser is
                            allowed to send (CORS preflight). Default:
                            'Content-Type, X-Admin-Token, Authorization'.
                            ⚠️ A header missing from this list is rejected by the
                            BROWSER: the request never reaches this server and the
                            app shows "Serveur de jetons injoignable (Failed to
                            fetch)". The app sends X-Admin-Token to publish the
                            team (POST /api/auth/accounts) — keep it listed.
     STORE_FILE             where the shared refresh token is persisted
                            (default ./workspace-shared-token.json, 0600).
     WORKSPACE_REFRESH_TOKEN  optional pre-seeded credential (alternative to
                            the browser bootstrap); not written to the file.
     MAIL_API_URL           HTTP mail-relay endpoint (JSON POST body
                            { from, to, subject, text }, Resend-compatible).
                            Empty = automatic e-mails disabled (501).
     MAIL_API_KEY           optional 'Authorization: Bearer …' key for the
                            relay above.
     MAIL_FROM              sender shown by the relay (default:
                            'Lab Workspace <no-reply@lab-workspace>').

     FIREBASE_SERVICE_ACCOUNT  the Firebase service-account JSON (one line) whose
                            key signs the custom tokens. Empty = /api/auth/*
                            answers 501 auth_not_configured. Alternatives:
                            FIREBASE_SERVICE_ACCOUNT_B64 (base64 of the same
                            JSON — easiest in a YAML env file) or
                            FIREBASE_SA_FILE=</path/to/serviceAccount.json>.
     ADMIN_TOKEN            shared secret required by POST /api/auth/accounts
                            (the app sends it as X-Admin-Token). Empty = the
                            endpoint is disabled.
     ACCOUNTS_FILE          where the server-side copy of the team is stored
                            (default ./workspace-accounts.json, 0600).
     PBKDF2_ITERATIONS      password-hardening cost (default 150000).

   RUN
     GOOGLE_CLIENT_SECRET=... [SHARED_EMAIL=...] [ALLOWED_ORIGINS=...] \
       node server/token-server.js

   A plain Node >= 18 process is all you need — run it on any always-on box
   (the lab machine, a small VPS, a Raspberry Pi...) behind a reverse proxy
   with HTTPS. The app then points GOOGLE_TOKEN_EXCHANGE_URL
   (src/data/constants.js) at the https URL of this server.
   ========================================================================= */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user';

const env = (k, dflt = '') => process.env[k] || dflt;
const port = parseInt(env('PORT', '8787'), 10) || 8787;
const GOOGLE_CLIENT_ID = env(
  'GOOGLE_CLIENT_ID',
  '763848765523-0i3rsljv2gpnke866r8kuih6s87l7n0u.apps.googleusercontent.com'
);
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const SHARED_EMAIL = env('SHARED_EMAIL').trim().toLowerCase();
// Code stamp (set by deploy-cloud-run.sh/.ps1 from `git rev-parse --short HEAD`)
// so that GET /health can prove which commit is actually running after a deploy.
const CODE_VERSION = env('CODE_VERSION').trim();
const STORE_FILE = path.resolve(process.cwd(), env('STORE_FILE', 'workspace-shared-token.json'));
const ALLOWED_ORIGINS = new Set(
  env('ALLOWED_ORIGINS')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
);
// Client headers the browser may send (CORS preflight). This is NOT the security
// boundary (that is ALLOWED_ORIGINS + ADMIN_TOKEN, verified server-side): it only
// tells the browser whether it is allowed to send the request at all. Any header
// missing here makes the browser abort with "Failed to fetch" — the app then
// displays "Serveur de jetons injoignable (Failed to fetch)" and this server
// never sees the call. The app sends X-Admin-Token when it publishes the team.
const CORS_ALLOW_HEADERS = env('CORS_ALLOW_HEADERS', 'Content-Type, X-Admin-Token, Authorization')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)
  .join(', ');

// ── E-mail relay (automatic admin notifications, see POST /api/mail) ──────
// MAIL_API_URL  endpoint of any HTTP mail service expecting a JSON body
//               { from, to: string[], subject, text } with an optional
//               Authorization: Bearer MAIL_API_KEY header (Resend-compatible).
// MAIL_FROM     sender shown by the relay.
const MAIL_API_URL = env('MAIL_API_URL').trim();
const MAIL_API_KEY = env('MAIL_API_KEY').trim();
const MAIL_FROM = env('MAIL_FROM', 'Lab Workspace <no-reply@lab-workspace>').trim();
const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

if (!GOOGLE_CLIENT_SECRET) {
  console.error('GOOGLE_CLIENT_SECRET is required. Set it before starting the server.');
  process.exit(1);
}

// ── Persisted workspace credential ──────────────────────────────────────────
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && j.refresh_token) {
      return { refresh_token: String(j.refresh_token), email: String(j.email || '') };
    }
  } catch { /* not bootstrapped yet */ }
  const preset = env('WORKSPACE_REFRESH_TOKEN').trim();
  if (preset) return { refresh_token: preset, email: SHARED_EMAIL };
  return null;
}

function saveStore(refreshToken, email) {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ refresh_token: refreshToken, email, savedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  fs.renameSync(tmp, STORE_FILE);
}

function deleteStore() {
  try { fs.unlinkSync(STORE_FILE); } catch { /* ignore */ }
}

/* ── AUTHENTIFICATION DE L'ÉQUIPE (jetons Firebase signés) ───────────────────
   Voir docs/SECURITY-SETUP.md. Principe — c'est ce qui rend le workspace
   réellement privé (les règles Firestore n'acceptent QUE ces jetons) :

     1. le navigateur envoie { name, password } à  POST /api/auth/login  ;
     2. CE serveur vérifie le mot de passe (PBKDF2-SHA256 ; repli SHA-256 pour
        les fiches créées par l'app, durcies automatiquement à la 1re connexion)
        contre sa propre copie de l'équipe (ACCOUNTS_FILE, hors Firestore) ;
     3. en cas de succès il SIGNE un jeton personnalisé Firebase (RS256) dont
        les revendications portent { lab: true, name, role } ;
     4. le client l'échange auprès de Firebase (signInWithCustomToken) et
        obtient une session ; les règles Firestore exigent
        request.auth.token.lab == true — donc personne d'autre ne peut lire ni
        modifier le workspace, et le rôle n'est plus falsifiable en local.

   Endpoints :
     POST /api/auth/login     { name, password }      → { token, name, role }
     GET  /api/auth/roster                            → { members:[{id,name,role}] }
     POST /api/auth/accounts  { members:[…] }         → remplace la copie serveur
                              (en-tête X-Admin-Token obligatoire)
     POST /api/auth/change-password { name, currentPassword, newPassword }
                              → SEUL le propriétaire du compte peut changer SON
                               mot de passe (ancien mot de passe exigé, vérifié
                               ici). Aucun ADMIN_TOKEN requis : sans cette route
                               un changement fait dans l'app restait sans effet
                               (l'app ne peut pas publier la liste, il faut le
                               jeton administrateur — l'ancien mot de passe
                               continuait donc de fonctionner).

     GET  /api/auth/status                            → { configured, accounts }

   Sans FIREBASE_SERVICE_ACCOUNT / FIREBASE_SA_FILE le serveur répond
   501 auth_not_configured et l'app garde son comportement actuel (aucune
   régression tant que les règles Firestore ne sont pas fermées). */

const FIREBASE_SA_JSON = env('FIREBASE_SERVICE_ACCOUNT').trim();
const FIREBASE_SA_B64 = env('FIREBASE_SERVICE_ACCOUNT_B64').trim();
const FIREBASE_SA_FILE = env('FIREBASE_SA_FILE').trim();
const ADMIN_TOKEN = env('ADMIN_TOKEN').trim();
const ACCOUNTS_FILE = path.resolve(process.cwd(), env('ACCOUNTS_FILE', 'workspace-accounts.json'));
const PBKDF2_ITERATIONS = parseInt(env('PBKDF2_ITERATIONS', '150000'), 10) || 150000;
const CUSTOM_TOKEN_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const CUSTOM_TOKEN_TTL = 3600;

let cachedServiceAccount;
let serviceAccountLoaded = false;

/** Clé de compte de service Firebase (JSON ou fichier) — sert UNIQUEMENT à
 *  signer les jetons. Jamais exposée au navigateur. */
function loadServiceAccount() {
  if (serviceAccountLoaded) return cachedServiceAccount;
  serviceAccountLoaded = true;
  let raw = FIREBASE_SA_JSON;
  if (!raw && FIREBASE_SA_B64) {
    // Variante base64 (JSON sur une seule ligne, sans guillemets à échapper
    // dans un fichier d'environnement YAML — voir deploy-cloud-run).
    try { raw = Buffer.from(FIREBASE_SA_B64, 'base64').toString('utf8'); } catch { raw = ''; }
  }
  if (!raw && FIREBASE_SA_FILE) {
    try { raw = fs.readFileSync(FIREBASE_SA_FILE, 'utf8'); } catch { raw = ''; }
  }
  if (!raw) { cachedServiceAccount = null; return null; }
  try {
    const j = JSON.parse(raw);
    const clientEmail = String(j.client_email || '').trim();
    const privateKey = String(j.private_key || '').replace(/\\n/g, '\n').trim();
    if (!clientEmail || !privateKey) throw new Error('client_email / private_key manquants');
    cachedServiceAccount = {
      clientEmail,
      privateKey,
      privateKeyId: String(j.private_key_id || '').trim(),
      projectId: String(j.project_id || '').trim(),
    };
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT illisible — auth serveur désactivée :', e.message);
    cachedServiceAccount = null;
  }
  return cachedServiceAccount;
}

/** Copie serveur de l'équipe : { members: [{ id, name, role, passwordHash, algo, salt, iterations }] }.
 *  Ce fichier vit sur le volume persistant du serveur (à côté du jeton Drive). */
function loadAccounts() {
  try {
    const j = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const members = Array.isArray(j && j.members) ? j.members : [];
    return { members: members.filter((m) => m && m.name), savedAt: String((j && j.savedAt) || '') };
  } catch {
    return { members: [], savedAt: '' };
  }
}

function saveAccounts(store) {
  const dir = path.dirname(ACCOUNTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${ACCOUNTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ members: store.members, savedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sha256Hex = (password) => crypto.createHash('sha256').update(String(password), 'utf8').digest('hex');

const pbkdf2Hex = (password, saltHex, iterations) =>
  crypto
    .pbkdf2Sync(String(password), Buffer.from(String(saltHex), 'hex'), iterations, 32, 'sha256')
    .toString('hex');

const safeEqualHex = (a, b) => {
  try {
    const A = Buffer.from(String(a || ''), 'hex');
    const B = Buffer.from(String(b || ''), 'hex');
    return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
  } catch { return false; }
};

const normName = (s) => String(s || '').trim().toLowerCase();

/**
 * Vérifie un mot de passe contre la fiche serveur.
 *   'ok'          → PBKDF2 valide
 *   'upgrade'     → hash SHA-256 hérité (créé par l'app) : valide, à durcir
 *   'no-password' → fiche sans mot de passe : connexion refusée
 *   'invalid'     → refusé
 */
function verifyMemberPassword(member, password) {
  if (!member || !password) return 'invalid';
  if (member.algo === 'pbkdf2-sha256' && member.salt) {
    const iterations = parseInt(member.iterations, 10) || PBKDF2_ITERATIONS;
    return safeEqualHex(pbkdf2Hex(password, member.salt, iterations), member.passwordHash) ? 'ok' : 'invalid';
  }
  const legacy = String(member.passwordHash || '').trim();
  if (!legacy) return 'no-password';
  return sha256Hex(password) === legacy ? 'upgrade' : 'invalid';
}

/** Combien d'empreintes remplacées une fiche garde en mémoire : de quoi
 *  absorber plusieurs publications parties d'un navigateur resté en retard. */
const SUPERSEDED_HASHES_KEPT = 4;

/** Installe un mot de passe sur une fiche (PBKDF2 salé — le mot de passe en clair
 *  ne quitte pas la mémoire du serveur) et retient l'empreinte SHA-256
 *  correspondante : c'est la seule forme que l'application sait calculer, donc la
 *  publier à nouveau ne doit pas écraser le durcissement.
 *  `superseded` = le(s) hash(s) du mot de passe REMPLACÉ. Il faut y mettre les
 *  DEUX formes possibles — la fiche stockée (PBKDF2 après une première connexion,
 *  ou SHA-256 hérité) ET le SHA-256 du mot de passe, seule forme qu'une liste
 *  publiée contiendra jamais : sans les deux, une publication tardive passerait
 *  inaperçue et rétablirait l'ancien mot de passe. */
function setMemberPassword(member, password, store, { superseded = [], upgraded = false } = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const replaced = (Array.isArray(superseded) ? superseded : [superseded])
    .map((h) => String(h || '').trim().toLowerCase())
    .filter(Boolean);
  if (replaced.length) {
    const known = Array.isArray(member.supersededHashes)
      ? member.supersededHashes.map((h) => String(h || '').trim().toLowerCase())
      : [];
    member.supersededHashes = [...new Set([...replaced, ...known])].slice(0, SUPERSEDED_HASHES_KEPT);
  }
  member.legacyHash = sha256Hex(password);
  member.passwordHash = pbkdf2Hex(password, salt, PBKDF2_ITERATIONS);
  member.algo = 'pbkdf2-sha256';
  member.salt = salt;
  member.iterations = PBKDF2_ITERATIONS;
  member.passwordChangedAt = new Date().toISOString();
  if (upgraded) member.upgradedAt = member.passwordChangedAt;
  saveAccounts(store);
}

/** Durcissement du hash SHA-256 hérité (créé par l'app) lors d'une connexion
 *  réussie : même opération, la fiche n'a simplement aucun mot de passe
 *  « remplacé » à retenir (le mot de passe n'a pas changé). */
const upgradeMemberHash = (member, password, store) =>
  setMemberPassword(member, password, store, { upgraded: true });

/** Jeton personnalisé Firebase (JWT RS256) — format officiel du SDK Admin. */
function mintCustomToken(member, sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (sa.privateKeyId) header.kid = sa.privateKeyId;
  const payload = {
    iss: sa.clientEmail,
    sub: sa.clientEmail,
    aud: CUSTOM_TOKEN_AUD,
    iat: now,
    exp: now + CUSTOM_TOKEN_TTL,
    uid: String(member.id || member.name || '').slice(0, 128),
    claims: {
      lab: true,
      name: String(member.name || ''),
      role: member.role === 'superuser' ? 'superuser' : 'user',
    },
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${b64url(signer.sign(sa.privateKey))}`;
}

// Anti-force brute : 12 tentatives par 5 min et par adresse.
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 12;
const loginAttempts = new Map();
const loginRateLimited = (ip) => {
  const now = Date.now();
  const hits = (loginAttempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  hits.push(now);
  loginAttempts.set(ip, hits);
  if (loginAttempts.size > 5000) loginAttempts.clear();
  return hits.length > LOGIN_MAX_ATTEMPTS;
};

const safeEqualText = (a, b) => {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  return A.length > 0 && A.length === B.length && crypto.timingSafeEqual(A, B);
};

/** Réponse d'échec unique : jamais d'indication sur l'existence du nom. */
const authRejected = () => ({
  http: 401,
  json: { ok: false, error: 'invalid_credentials', error_description: 'Nom ou mot de passe incorrect.' },
});

async function handleAuthLogin(body, ip) {
  const sa = loadServiceAccount();
  if (!sa) {
    return {
      http: 501,
      json: {
        ok: false,
        error: 'auth_not_configured',
        error_description: 'Authentification serveur non configurée : FIREBASE_SERVICE_ACCOUNT est absent du serveur.'
      }
    };
  }
  if (loginRateLimited(ip)) {
    return {
      http: 429,
      json: {
        ok: false,
        error: 'too_many_attempts',
        error_description: 'Trop de tentatives de connexion — réessayez dans quelques minutes.'
      }
    };
  }
  const store = loadAccounts();
  if (!store.members.length) {
    return {
      http: 503,
      json: {
        ok: false,
        error: 'accounts_not_initialized',
        error_description: "Aucun compte n'a encore été publié sur ce serveur — le superutilisateur doit presser « Publier les comptes » (Setup → Équipe & accès). Voir docs/SECURITY-SETUP.md."
      }
    };
  }
  const name = String((body && body.name) || '').trim();
  const password = String((body && body.password) || '');
  const member = store.members.find(
    (m) => normName(m.name) === normName(name) || String(m.id) === String(name)
  );
  const verdict = verifyMemberPassword(member, password);
  if (!member || verdict === 'invalid' || verdict === 'no-password') {
    console.warn(`[auth] connexion refusée pour « ${name || '(vide)'} » depuis ${ip}`);
    return authRejected();
  }
  if (verdict === 'upgrade') upgradeMemberHash(member, password, store);
  const role = member.role === 'superuser' ? 'superuser' : 'user';
  return {
    http: 200,
    json: {
      ok: true,
      token: mintCustomToken({ ...member, role }, sa),
      id: member.id || '',
      name: member.name,
      role,
      expires_in: CUSTOM_TOKEN_TTL
    }
  };
}

/** Changement de mot de passe par la personne elle-même (My Account → Change My
 *  Password dans l'app).
 *
 *  ⚠️ C'est LE point qui manquait : la route de publication
 *  (POST /api/auth/accounts) exige ADMIN_TOKEN, que seuls les superutilisateurs
 *  possèdent — et l'écran « My Account » s'adresse justement à tout le monde.
 *  Un changement fait dans l'app ne remplaçait donc que la copie locale : le
 *  serveur, seul vérificateur des mots de passe, gardait l'ancien — le nouveau
 *  était refusé et l'ancien continuait de fonctionner (« changer le mot de passe
 *  n'a aucun effet »). Ici le serveur vérifie L'ANCIEN mot de passe puis remplace
 *  SA fiche ; aucune empreinte n'est renvoyée au navigateur. */
function handleAuthChangePassword(body, ip) {
  const name = String((body && body.name) || '').trim();
  const currentPassword = String((body && body.currentPassword) || '');
  const newPassword = String((body && body.newPassword) || '');
  // Validation AVANT le compteur anti-force brute : une requête mal formée ne
  // doit pas consommer les tentatives de la personne.
  if (!newPassword) {
    return {
      http: 400,
      json: { ok: false, error: 'weak_password', error_description: 'Le nouveau mot de passe est vide.' }
    };
  }
  if (newPassword.length > 200) {
    return {
      http: 400,
      json: { ok: false, error: 'weak_password', error_description: 'Nouveau mot de passe trop long (200 caractères maximum).' }
    };
  }
  if (loginRateLimited(ip)) {
    return {
      http: 429,
      json: {
        ok: false,
        error: 'too_many_attempts',
        error_description: 'Trop de tentatives — réessayez dans quelques minutes.'
      }
    };
  }
  const store = loadAccounts();
  if (!store.members.length) {
    return {
      http: 503,
      json: {
        ok: false,
        error: 'accounts_not_initialized',
        error_description: "Aucun compte n'a encore été publié sur ce serveur (Setup → Équipe & accès → Publier les comptes)."
      }
    };
  }
  const member = store.members.find(
    (m) => normName(m.name) === normName(name) || String(m.id) === String(name)
  );
  const verdict = verifyMemberPassword(member, currentPassword);
  if (!member || (verdict !== 'ok' && verdict !== 'upgrade')) {
    console.warn(`[auth] changement de mot de passe refusé pour « ${name || '(vide)'} » depuis ${ip}`);
    return authRejected();
  }
  /* Les DEUX formes du mot de passe remplacé — la fiche stockée (PBKDF2 après une
     première connexion, ou SHA-256 hérité) et son SHA-256, la seule forme qu'une
     liste publiée par un navigateur contiendra (voir setMemberPassword). */
  setMemberPassword(member, newPassword, store, {
    superseded: [String(member.passwordHash || ''), sha256Hex(currentPassword)]
  });
  console.log(`[auth] mot de passe changé par « ${member.name} » depuis ${ip}`);
  return {
    http: 200,
    json: { ok: true, id: member.id || '', name: member.name, changedAt: member.passwordChangedAt }
  };
}

/** Liste des membres SANS mot de passe ni hash — sert à remplir la liste
 *  déroulante de l'écran de connexion avant toute authentification. */
function handleAuthRoster() {
  const store = loadAccounts();
  return {
    http: 200,
    json: {
      ok: true,
      members: store.members.map((m) => ({
        id: m.id || '',
        name: m.name,
        role: m.role === 'superuser' ? 'superuser' : 'user'
      }))
    }
  };
}

function handleAuthStatus() {
  const store = loadAccounts();
  return {
    http: 200,
    json: {
      ok: true,
      configured: !!loadServiceAccount(),
      accounts: store.members.length,
      savedAt: store.savedAt,
      adminPushEnabled: !!ADMIN_TOKEN,
      version: CODE_VERSION
    }
  };
}

/** Publication de la copie serveur de l'équipe (superutilisateur, via l'app) —
 *  protégée par ADMIN_TOKEN. Les hash PBKDF2 déjà obtenus sont conservés tant
 *  que le hash publié pour cette fiche ne change pas. */
function handleAuthAccounts(body, headers) {
  if (!ADMIN_TOKEN) {
    return {
      http: 501,
      json: {
        ok: false,
        error: 'admin_disabled',
        error_description: "ADMIN_TOKEN n'est pas défini sur le serveur : la publication des comptes est désactivée."
      }
    };
  }
  const provided = String((headers && (headers['x-admin-token'] || headers['X-Admin-Token'])) || '');
  if (!safeEqualText(provided, ADMIN_TOKEN)) {
    return {
      http: 401,
      json: { ok: false, error: 'invalid_admin_token', error_description: 'Jeton administrateur invalide.' }
    };
  }
  const raw = Array.isArray(body && body.members) ? body.members : [];
  const members = raw
    .map((m) => ({
      id: String((m && m.id) || '').trim(),
      name: String((m && m.name) || '').trim(),
      role: m && m.role === 'superuser' ? 'superuser' : 'user',
      passwordHash: String((m && m.passwordHash) || '').trim().toLowerCase()
    }))
    .filter((m) => m.name);
  if (!members.length) {
    return {
      http: 400,
      json: {
        ok: false,
        error: 'empty_roster',
        error_description: 'Liste vide refusée : publiez au moins un compte.'
      }
    };
  }
  const previous = loadAccounts();
  const staleIgnored = [];
  const next = members.map((m) => {
    const old =
      previous.members.find((p) => p.id && m.id && p.id === m.id) ||
      previous.members.find((p) => normName(p.name) === normName(m.name));
    const superseded = Array.isArray(old && old.supersededHashes)
      ? old.supersededHashes.map((h) => String(h || '').trim().toLowerCase())
      : [];
    if (old && m.passwordHash && superseded.includes(m.passwordHash)) {
      /* La liste publiée est en RETARD : elle propose un mot de passe déjà
         remplacé depuis (changement fait par la personne elle-même — voir
         POST /api/auth/change-password). La copie serveur fait foi : honorer
         cette publication rendrait le changement sans effet, et l'ancien mot de
         passe redeviendrait le bon. */
      staleIgnored.push(old.name || m.name);
      return { ...old, id: m.id || old.id, name: m.name, role: m.role };
    }
    const reference = old ? String(old.legacyHash || old.passwordHash || '') : '';
    if (old && reference && reference === m.passwordHash) {
      // Mot de passe inchangé : on garde le durcissement PBKDF2 déjà obtenu.
      return { ...old, id: m.id || old.id, name: m.name, role: m.role };
    }
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      passwordHash: m.passwordHash,
      algo: m.passwordHash ? 'sha256' : ''
    };
  });
  saveAccounts({ members: next });
  if (staleIgnored.length) {
    console.warn('[auth] publication ignorée pour', staleIgnored.join(', '),
      ': un mot de passe plus récent est déjà enregistré (changement fait par la personne elle-même).');
  }
  return {
    http: 200,
    json: {
      ok: true,
      accounts: next.length,
      withPassword: next.filter((m) => m.passwordHash).length,
      savedAt: new Date().toISOString(),
      staleIgnored
    }
  };
}

// ── Google API calls ────────────────────────────────────────────────────────
async function googleTokenCall(params) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { ok: res.ok, status: res.status, json: json || {} };
}

/** Which Google account does this freshly-minted access token belong to?
 *  NOTE: the Drive API v3 /about "user" object exposes the address as
 *  `emailAddress` (NOT `email` — reading `.email` always yields an empty
 *  string and made every bootstrap fail with email_check_failed). When the
 *  granted scopes hide the address, fall back to the OAuth tokeninfo
 *  endpoint, which answers with `email` for identity-capable tokens. */
async function accessTokenEmail(accessToken) {
  try {
    const res = await fetch(GOOGLE_DRIVE_ABOUT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const j = await res.json();
    const user = (j && j.user) || {};
    const email = String(user.emailAddress || user.email || '').trim().toLowerCase();
    if (res.ok && email) return { ok: true, email };
    // Fallback: OAuth tokeninfo may still expose the account email.
    try {
      const ti = await (
        await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)
      ).json();
      const tiEmail = String((ti && ti.email) || '').trim().toLowerCase();
      if (tiEmail) return { ok: true, email: tiEmail };
    } catch { /* keep the Drive error detail below */ }
    return {
      ok: false,
      email: '',
      detail: res.ok
        ? `Google Drive /about did not expose user.emailAddress${user.displayName ? ` for “${user.displayName}”` : ''}`
        : `Google Drive /about answered HTTP ${res.status}${j && j.error ? ` (${j.error})` : ''}`
    };
  } catch (err) {
    return { ok: false, email: '', detail: (err && err.message) || 'network error' };
  }
}

const refreshSharedToken = async () => {
  const store = loadStore();
  if (!store || !store.refresh_token) {
    return {
      http: 503,
      json: {
        error: 'workspace_not_initialized',
        error_description: 'No shared workspace credential is stored yet — the workspace owner must open the app once with ?drive-bootstrap=1 and click "Connect Drive".'
      }
    };
  }
  const t = await googleTokenCall({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: store.refresh_token,
    grant_type: 'refresh_token'
  });
  if (!t.ok) {
    if (t.json.error === 'invalid_grant') {
      // Revoked (password change, manual revoke, 7-day testing-mode expiry...):
      // drop the dead credential so the owner knows to re-bootstrap.
      deleteStore();
      return {
        http: 503,
        json: {
          error: 'workspace_not_initialized',
          error_description: 'The stored Drive credential was revoked or expired — the workspace owner must run the ?drive-bootstrap=1 flow once more.'
        }
      };
    }
    return {
      http: t.status || 500,
      json: {
        error: t.json.error || 'refresh_failed',
        error_description: t.json.error_description || 'Google rejected the refresh token.'
      }
    };
  }
  return { http: 200, json: { access_token: t.json.access_token, expires_in: t.json.expires_in || 3600 } };
};

async function handleBootstrap(code) {
  if (!code) {
    return { http: 400, json: { error: 'invalid_request', error_description: 'Missing authorization code.' } };
  }
  const exchange = await googleTokenCall({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
    access_type: 'offline',
    prompt: 'consent'
  });
  if (!exchange.ok) {
    return {
      http: exchange.status || 500,
      json: {
        error: exchange.json.error || 'code_exchange_failed',
        error_description: exchange.json.error_description || 'Google rejected the authorization code.'
      }
    };
  }
  const { access_token: accessToken, expires_in: expiresIn, refresh_token: newRefresh } = exchange.json;
  if (!newRefresh) {
    return {
      http: 400,
      json: {
        error: 'no_refresh_token',
        error_description: 'Google did not return a refresh token. The OAuth client must be a "Web application" client and the exchange must use access_type=offline&prompt=consent.'
      }
    };
  }
  // Only the workspace owner may (re)store the shared credential.
  let accountEmail = '';
  if (SHARED_EMAIL) {
    const who = await accessTokenEmail(accessToken);
    if (!who.ok) {
      return {
        http: 502,
        json: {
          error: 'email_check_failed',
          error_description: `Could not verify the consenting Google account against SHARED_EMAIL${who.detail ? ` — ${who.detail}` : ''}.`
        }
      };
    }
    accountEmail = who.email;
    if (accountEmail !== SHARED_EMAIL) {
      return {
        http: 403,
        json: {
          error: 'account_not_allowed',
          error_description: `The signed-in account (${accountEmail || 'unknown'}) is not the workspace owner configured in SHARED_EMAIL.`
        }
      };
    }
  }
  const existing = loadStore();
  if (existing && existing.refresh_token && !(SHARED_EMAIL && accountEmail === SHARED_EMAIL)) {
    return {
      http: 409,
      json: {
        error: 'already_initialized',
        error_description: 'A shared workspace credential already exists and may not be overwritten. Configure SHARED_EMAIL (matching owner) to rotate it, or delete the store file.'
      }
    };
  }
  saveStore(newRefresh, accountEmail || SHARED_EMAIL);
  console.log(`Shared workspace credential stored for ${accountEmail || 'the configured owner'} at ${new Date().toISOString()}`);
  return { http: 200, json: { access_token: accessToken, expires_in: expiresIn || 3600 } };
}

async function handlePost(body) {
  const grantType = String((body && body.grant_type) || '');
  switch (grantType) {
    case 'workspace':
      return refreshSharedToken();
    case 'authorization_code':
      return handleBootstrap(String(body.code || ''));
    case 'refresh_token': {
      const refresh = String((body && body.refresh_token) || '');
      if (!refresh) {
        return { http: 400, json: { error: 'invalid_request', error_description: 'Missing refresh_token.' } };
      }
      const t = await googleTokenCall({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refresh,
        grant_type: 'refresh_token'
      });
      if (!t.ok) {
        return {
          http: t.status || 500,
          json: {
            error: t.json.error || 'refresh_failed',
            error_description: t.json.error_description || 'Google rejected the refresh token.'
          }
        };
      }
      return { http: 200, json: { access_token: t.json.access_token, expires_in: t.json.expires_in || 3600 } };
    }
    case 'status': {
      const store = loadStore();
      return { http: 200, json: { ok: true, initialized: !!(store && store.refresh_token), email: store ? store.email : '', version: CODE_VERSION } };
    }
    default:
      return {
        http: 400,
        json: {
          error: 'unsupported_grant_type',
          error_description: `Unknown grant_type "${grantType}". Supported: workspace, authorization_code, refresh_token.`
        }
      };
  }
}

async function handleMail(body) {
  if (!MAIL_API_URL) {
    return {
      http: 501,
      json: {
        ok: false,
        error: 'mail_not_configured',
        error_description: 'MAIL_API_URL is not set on the token server — configure an HTTP mail-relay endpoint (e.g. Resend) to enable automatic e-mails.'
      }
    };
  }
  const raw = Array.isArray(body && body.to) ? body.to : (body && body.to !== undefined ? [body.to] : []);
  const toList = raw
    .map((v) => String(v || '').trim())
    .filter((v) => VALID_EMAIL.test(v))
    .filter((v, i, a) => a.indexOf(v) === i);
  if (!toList.length) {
    return {
      http: 400,
      json: { ok: false, error: 'no_recipients', error_description: 'No valid recipient e-mail addresses provided.' }
    };
  }
  const subject = String((body && body.subject) || '').trim().slice(0, 200);
  const text = String((body && body.text) || '').trim().slice(0, 20000);
  const payload = { from: MAIL_FROM, to: toList, subject, text };
  try {
    const res = await fetch(MAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(MAIL_API_KEY ? { Authorization: `Bearer ${MAIL_API_KEY}` } : {})
      },
      body: JSON.stringify(payload)
    });
    let relayJson = null;
    try { relayJson = await res.json(); } catch { relayJson = null; }
    if (res.ok) return { http: 200, json: { ok: true } };
    return {
      http: res.status || 502,
      json: {
        ok: false,
        error: 'mail_relay_error',
        error_description: (relayJson && (relayJson.message || relayJson.error_description || relayJson.error))
          || `Mail relay answered HTTP ${res.status}.`
      }
    };
  } catch (err) {
    return {
      http: 502,
      json: {
        ok: false,
        error: 'mail_relay_unreachable',
        error_description: `Cannot reach the mail relay: ${(err && err.message) || err}`
      }
    };
  }
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
const normalizeOrigin = (o) => String(o || '').trim().replace(/\/+$/, '');
const originAllowed = (origin) => !origin || ALLOWED_ORIGINS.has(normalizeOrigin(origin));

const send = (res, status, json, origin) => {
  // Vary: Origin — the CORS header below depends on the caller's origin, so
  // any cache in between must not reuse this answer for another origin.
  const headers = { 'Content-Type': 'application/json', Vary: 'Origin' };
  const o = normalizeOrigin(origin);
  if (o && ALLOWED_ORIGINS.has(o)) headers['Access-Control-Allow-Origin'] = o;
  res.writeHead(status, headers);
  res.end(JSON.stringify(json));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });

const server = http.createServer(async (req, res) => {
  res.on('error', () => {});
  const origin = req.headers.origin || '';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    // CORS preflight — only allow explicitly listed browser origins.
    // The header list below decides whether the BROWSER sends the real request:
    // without 'X-Admin-Token' the app's "⬆ Publier les comptes" is aborted before
    // reaching this server ("Serveur de jetons injoignable (Failed to fetch)").
    if (!originAllowed(origin)) { res.writeHead(204, { Vary: 'Origin' }); res.end(); return; }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': normalizeOrigin(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      // Volontairement court : si la liste ci-dessus est corrigée par un
      // redéploiement, le navigateur ne reste pas bloqué 24 h sur l'ancien avis.
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    });
    res.end();
    return;
  }

  if (!originAllowed(origin)) {
    send(res, 403, { error: 'origin_not_allowed', error_description: 'This origin is not in ALLOWED_ORIGINS.' }, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    const store = loadStore();
    const accounts = loadAccounts();
    send(res, 200, {
      ok: true,
      service: 'lab-workspace-token-server',
      initialized: !!(store && store.refresh_token),
      email: store ? store.email : '',
      authConfigured: !!loadServiceAccount(),
      authAccounts: accounts.members.length,
      version: CODE_VERSION
    }, origin);
    return;
  }

  /* ── Authentification de l'équipe (voir docs/SECURITY-SETUP.md) ───────── */
  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    const out = handleAuthStatus();
    send(res, out.http, out.json, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/roster') {
    const out = handleAuthRoster();
    send(res, out.http, out.json, origin);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const body = await readBody(req);
      const ip = String(req.socket && req.socket.remoteAddress || '');
      const out = await handleAuthLogin(body, ip);
      send(res, out.http, out.json, origin);
    } catch (err) {
      send(res, 400, { ok: false, error: 'bad_request', error_description: (err && err.message) || 'Invalid request.' }, origin);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/accounts') {
    try {
      const body = await readBody(req);
      const out = handleAuthAccounts(body, req.headers);
      send(res, out.http, out.json, origin);
    } catch (err) {
      send(res, 400, { ok: false, error: 'bad_request', error_description: (err && err.message) || 'Invalid request.' }, origin);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    try {
      const body = await readBody(req);
      const ip = String(req.socket && req.socket.remoteAddress || '');
      const out = handleAuthChangePassword(body, ip);
      send(res, out.http, out.json, origin);
    } catch (err) {
      send(res, 400, { ok: false, error: 'bad_request', error_description: (err && err.message) || 'Invalid request.' }, origin);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/mail') {
    // Automatic admin e-mails (Approbation devis & BC…). Relays to MAIL_API_URL.
    try {
      const body = await readBody(req);
      const result = await handleMail(body);
      send(res, result.http, result.json, origin);
    } catch (err) {
      send(res, 400, { error: 'bad_request', error_description: (err && err.message) || 'Invalid request.' }, origin);
    }
    return;
  }

  if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }, origin); return; }

  try {
    const body = await readBody(req);
    const result = await handlePost(body);
    send(res, result.http, result.json, origin);
  } catch (err) {
    send(res, 400, { error: 'bad_request', error_description: (err && err.message) || 'Invalid request.' }, origin);
  }
});

server.listen(port, () => {
  const store = loadStore();
  console.log(`Lab Workspace token server listening on http://0.0.0.0:${port}`);
  console.log(`  shared credential: ${store && store.refresh_token ? `STORED${store.email ? ` (${store.email})` : ''}` : 'NOT SET — owner must bootstrap (?drive-bootstrap=1)'}`);
  console.log(`  allowed origins:  ${[...ALLOWED_ORIGINS].join(', ') || '(same-origin / curl only)'}`);
  console.log(`  store file:       ${STORE_FILE}`);
  const sa = loadServiceAccount();
  const acc = loadAccounts();
  console.log(`  team auth:        ${sa ? `ENABLED (SA ${sa.clientEmail})` : 'disabled — FIREBASE_SERVICE_ACCOUNT absent'}`);
  console.log(`  team accounts:    ${acc.members.length}${acc.members.length ? ` (with password: ${acc.members.filter((m) => m.passwordHash).length})` : ' — owner must publish them from the app (Setup → Équipe & accès)'}`);
  console.log(`  accounts file:    ${ACCOUNTS_FILE}`);
  console.log(`  admin push:       ${ADMIN_TOKEN ? 'enabled (ADMIN_TOKEN set)' : 'disabled — ADMIN_TOKEN absent'}`);
});
