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
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ws-token-test-'));
const port = 8879 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const allowed = 'http://localhost:5173';

const child = spawn(process.execPath, ['server/token-server.js'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PORT: String(port),
    GOOGLE_CLIENT_SECRET: 'self-test-secret',
    ALLOWED_ORIGINS: allowed,
    STORE_FILE: path.join(storeDir, 'ws-token.json')
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
