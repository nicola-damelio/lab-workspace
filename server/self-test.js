/* =========================================================================
   server/self-test.js  —  run with:  node server/self-test.js

   Starts token-server.js as a child process (dummy secret, no real Google
   credential) and verifies the HTTP contract the app relies on: /health,
   the workspace-not-initialized answer, CORS preflight, origin allow-list,
   and error passthroughs. Exits non-zero on any failure.
   ========================================================================= */
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ws-token-test-'));
const port = 8879 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const allowed = 'http://localhost:5173';

/* ── Jeu de données pour l'authentification serveur ─────────────────────────
   Une vraie paire de clés RSA tient lieu de clé de compte de service : le test
   signe/vérifie donc exactement le même JWT RS256 que la production. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const serviceAccountJson = JSON.stringify({
  type: 'service_account',
  project_id: 'self-test-project',
  client_email: 'self-test@self-test-project.iam.gserviceaccount.com',
  private_key_id: 'self-test-key-id',
  private_key: privateKey
});
const adminToken = 'self-test-admin-token';
const ACCOUNTS_FILE = path.join(storeDir, 'ws-accounts.json');
const MEMBER = 'Alice Test';
const PASSWORD = 'Secret-1234';
const legacyHash = crypto.createHash('sha256').update(PASSWORD).digest('hex');

const decodeJwtPart = (part) => JSON.parse(Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const verifyJwt = (token) => {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return { ok: false, header: null, payload: null };
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  verifier.end();
  const ok = verifier.verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  return { ok, header: decodeJwtPart(h), payload: decodeJwtPart(p) };
};

const child = spawn(process.execPath, ['server/token-server.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    GOOGLE_CLIENT_SECRET: 'self-test-secret',
    ALLOWED_ORIGINS: allowed,
    STORE_FILE: path.join(storeDir, 'ws-token.json'),
    FIREBASE_SERVICE_ACCOUNT: serviceAccountJson,
    ADMIN_TOKEN: adminToken,
    ACCOUNTS_FILE
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitForServer = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('Server did not start in time');
};

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  —  ${extra}` : ''}`);
};

try {
  await waitForServer();

  let res = await fetch(`${base}/health`);
  let json = await res.json();
  check('GET /health → 200 + initialized:false', res.status === 200 && json.ok === true && json.initialized === false, JSON.stringify(json));

  res = await fetch(`${base}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'workspace' })
  });
  json = await res.json();
  check('POST workspace → 503 workspace_not_initialized', res.status === 503 && json.error === 'workspace_not_initialized', JSON.stringify(json));

  res = await fetch(`${base}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'status' })
  });
  json = await res.json();
  check('POST status → 200 initialized:false', res.status === 200 && json.initialized === false, JSON.stringify(json));

  res = await fetch(`${base}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'bogus' })
  });
  json = await res.json();
  check('POST unknown grant → 400 unsupported_grant_type', res.status === 400 && json.error === 'unsupported_grant_type', JSON.stringify(json));

  res = await fetch(`${base}/`, { method: 'OPTIONS', headers: { Origin: allowed, 'Access-Control-Request-Method': 'POST' } });
  check('OPTIONS preflight (allowed origin) → 204 + ACAO', res.status === 204 && res.headers.get('access-control-allow-origin') === allowed);

  res = await fetch(`${base}/health`, { headers: { Origin: 'http://evil.example' } });
  json = await res.json();
  check('Origin not in allow-list → 403 origin_not_allowed', res.status === 403 && json.error === 'origin_not_allowed', JSON.stringify(json));

  // Hits Google (invalid_client with the dummy secret, or a network-error
  // answer if offline) — we only require a clean 4xx/5xx JSON passthrough.
  res = await fetch(`${base}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'bogus' })
  });
  json = await res.json().catch(() => null);
  check('POST refresh_token bogus → clean error JSON passthrough', res.status >= 400 && res.status < 600 && json && typeof json.error === 'string', `HTTP ${res.status} ${JSON.stringify(json)}`);

  /* ── Authentification de l'équipe (docs/SECURITY-SETUP.md) ─────────────── */
  res = await fetch(`${base}/api/auth/status`);
  json = await res.json();
  check('GET /api/auth/status → configured + 0 compte', res.status === 200 && json.configured === true && json.accounts === 0, JSON.stringify(json));

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: PASSWORD })
  });
  json = await res.json();
  check('login avant publication → 503 accounts_not_initialized', res.status === 503 && json.error === 'accounts_not_initialized', JSON.stringify(json));

  res = await fetch(`${base}/api/auth/accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members: [{ id: 'op_1', name: MEMBER, role: 'superuser', passwordHash: legacyHash }] })
  });
  json = await res.json();
  check('publication sans jeton admin → 401 invalid_admin_token', res.status === 401 && json.error === 'invalid_admin_token', JSON.stringify(json));

  res = await fetch(`${base}/api/auth/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ members: [{ id: 'op_1', name: MEMBER, role: 'superuser', passwordHash: legacyHash }] })
  });
  json = await res.json();
  check('publication avec jeton admin → 200 (1 compte)', res.status === 200 && json.ok === true && json.accounts === 1 && json.withPassword === 1, JSON.stringify(json));

  res = await fetch(`${base}/api/auth/roster`);
  const rosterRaw = await res.clone().text();
  json = await res.json();
  check('roster : 1 membre, AUCUN mot de passe/hash exposé',
    res.status === 200 && json.members.length === 1 && json.members[0].name === MEMBER && json.members[0].role === 'superuser'
      && !/passwordHash|legacyHash|salt|algo/i.test(rosterRaw) && !rosterRaw.includes(legacyHash),
    rosterRaw);

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: 'mauvais-mot-de-passe' })
  });
  json = await res.json();
  check('login mot de passe incorrect → 401 invalid_credentials', res.status === 401 && json.error === 'invalid_credentials', JSON.stringify(json));

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Inconnu', password: PASSWORD })
  });
  json = await res.json();
  check('login nom inconnu → 401 (même message, pas d’énumération)', res.status === 401 && json.error === 'invalid_credentials', JSON.stringify(json));

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: PASSWORD })
  });
  json = await res.json();
  const verified = verifyJwt(json.token);
  check('login valide → jeton Firebase signé (RS256) + claims { lab, name, role }',
    res.status === 200 && json.ok === true && json.role === 'superuser'
      && verified.ok === true
      && verified.header.alg === 'RS256'
      && verified.payload.claims && verified.payload.claims.lab === true
      && verified.payload.claims.name === MEMBER && verified.payload.claims.role === 'superuser'
      && verified.payload.uid === 'op_1'
      && typeof verified.payload.exp === 'number' && verified.payload.exp > Math.floor(Date.now() / 1000)
      && String(verified.payload.aud).includes('identitytoolkit'),
    JSON.stringify(verified.payload));

  let stored = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const afterUpgrade = stored.members[0];
  check('le hash hérité SHA-256 est durci en PBKDF2 au 1er succès',
    afterUpgrade.algo === 'pbkdf2-sha256' && !!afterUpgrade.salt
      && afterUpgrade.passwordHash.length === 64 && afterUpgrade.passwordHash !== legacyHash
      && afterUpgrade.legacyHash === legacyHash,
    `algo=${afterUpgrade.algo} salt=${String(afterUpgrade.salt).slice(0, 8)}…`);

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: PASSWORD })
  });
  json = await res.json();
  check('login suivant → vérifié en PBKDF2 (200)', res.status === 200 && json.ok === true, JSON.stringify(json));

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: 'Secret-1234 ' })
  });
  json = await res.json();
  check('PBKDF2 : mot de passe presque identique → 401', res.status === 401 && json.error === 'invalid_credentials', JSON.stringify(json));

  // Re-publication du même hash hérité (mot de passe inchangé) : ne doit PAS
  // écraser le durcissement PBKDF2 déjà obtenu.
  res = await fetch(`${base}/api/auth/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ members: [{ id: 'op_1', name: MEMBER, role: 'superuser', passwordHash: legacyHash }] })
  });
  json = await res.json();
  stored = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  check('re-publication du même hash → le PBKDF2 est conservé (pas de régression)',
    res.status === 200 && stored.members[0].algo === 'pbkdf2-sha256', JSON.stringify(json));

  // Nouveau mot de passe publié : le nouveau hash remplace l'ancien (et le rôle suit).
  const newPassword = 'NouveauMotDePasse-9';
  const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  res = await fetch(`${base}/api/auth/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ members: [{ id: 'op_1', name: MEMBER, role: 'user', passwordHash: newHash }] })
  });
  json = await res.json();
  stored = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  check('nouveau hash publié → remplace l’ancien (rôle mis à jour aussi)',
    res.status === 200 && stored.members[0].passwordHash === newHash && stored.members[0].role === 'user',
    JSON.stringify(json));

  res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: MEMBER, password: newPassword })
  });
  json = await res.json();
  check('login avec le nouveau mot de passe → 200 role:user', res.status === 200 && json.role === 'user', JSON.stringify(json));

  res = await fetch(`${base}/api/auth/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ members: [] })
  });
  json = await res.json();
  check('publication d’une liste vide → 400 empty_roster (garde-fou)', res.status === 400 && json.error === 'empty_roster', JSON.stringify(json));

  res = await fetch(`${base}/health`);
  json = await res.json();
  check('GET /health expose l’état de l’auth serveur', json.authConfigured === true && json.authAccounts === 1, JSON.stringify(json));
} catch (err) {
  console.error('Self-test crashed:', err && err.message);
  results.push({ name: 'self-test run', ok: false });
} finally {
  child.kill();
  fs.rmSync(storeDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
