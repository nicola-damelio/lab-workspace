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

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user';

const env = (k, dflt = '') => process.env[k] || dflt;
const port = parseInt(env('PORT', '8787'), 10) || 8787;
const GOOGLE_CLIENT_ID = env(
  'GOOGLE_CLIENT_ID',
  '763848765523-kvjohq6qv8oifb2n86ibh6m4vm4057ej.apps.googleusercontent.com'
);
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const SHARED_EMAIL = env('SHARED_EMAIL').trim().toLowerCase();
const STORE_FILE = path.resolve(process.cwd(), env('STORE_FILE', 'workspace-shared-token.json'));
const ALLOWED_ORIGINS = new Set(
  env('ALLOWED_ORIGINS')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
);

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

/** Which Google account does this freshly-minted access token belong to? */
async function accessTokenEmail(accessToken) {
  try {
    const res = await fetch(GOOGLE_DRIVE_ABOUT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const j = await res.json();
    const email = String(((j && j.user) || {}).email || '').trim().toLowerCase();
    return { ok: res.ok && !!email, email };
  } catch {
    return { ok: false, email: '' };
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
      return { http: 502, json: { error: 'email_check_failed', error_description: 'Could not verify the consenting Google account against SHARED_EMAIL.' } };
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
      return { http: 200, json: { ok: true, initialized: !!(store && store.refresh_token), email: store ? store.email : '' } };
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
  const headers = { 'Content-Type': 'application/json' };
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
    if (!originAllowed(origin)) { res.writeHead(204); res.end(); return; }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': normalizeOrigin(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
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
    send(res, 200, {
      ok: true,
      service: 'lab-workspace-token-server',
      initialized: !!(store && store.refresh_token),
      email: store ? store.email : ''
    }, origin);
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
});
