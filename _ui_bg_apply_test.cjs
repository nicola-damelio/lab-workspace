/* ============================================================================
   _ui_bg_apply_test.cjs — « SI JE CLIQUE SUR CUSTOM ET QUE JE CHANGE LES
   COULEURS, RIEN NE SE PASSE » — mesuré dans Chrome, sur le VRAI module.

   LE DÉFAUT (reproduit ici avant correction)
   `saveUiSkin` applique TOUJOURS la peau cliquée ; `saveUiCustomSkin`, lui,
   n'applique un réglage (accent, famille neutre, couleur de page, motif) QUE si
   une RElecture du stockage dit « la peau en service est custom ». Cette
   relecture peut échouer pour trois raisons très différentes — l'écriture du
   stockage refusée (quota, navigation privée), la clé qui contient une valeur
   que le module ne reconnaît pas (ex. « "custom" » entre guillemets, sync entre
   postes), ou une clé d'opérateur qui n'est pas la même au moment du clic —
   et le réglage tout juste choisi ne s'applique alors JAMAIS : les peaux
   livrées marchent, le custom semble mort. C'est exactement le symptôme décrit.

   CE QUI EST VÉRIFIÉ
     · le chemin sain applique les deux (peau livrée, réglage custom) ;
     · TÉMOIN : sur une peau livrée, un réglage custom ne repeint RIEN ;
     · et le réglage s'applique quand même dans les trois cas ci-dessus.

   Usage : node _ui_bg_apply_test.cjs      (démarre `vite` sur un port libre et
                                            le referme ; ~20 s)
   ========================================================================== */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = __dirname;
const PORT = 5175;
const HOST = 'localhost';

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter((p) => p && fs.existsSync(p))[0];

const CHECKS = [];
const ok = (cond, label, detail) => {
  CHECKS.push({ ok: !!cond, label });
  process.stdout.write((cond ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* verrouillé */ } };

const BG = '#22c55e';
const PATTERN = 'grid';
const chosen = (extra) => Object.assign({ accent: '#ef4444', neutral: 'stone', bg: BG, pattern: PATTERN }, extra);

const PROBE = `<!doctype html><meta charset="utf-8"><title>apply probe</title><body>
<pre id="out">running…</pre>
<script type="module">
  const out = [];
  const log = (s) => { out.push(s); document.getElementById('out').textContent = out.join('\\n'); };
  const done = (payload) => fetch('/report', { method: 'POST', body: JSON.stringify(payload) })
    .catch(() => {}).then(() => log('--- envoyé ---'));
  const snap = () => {
    const h = document.documentElement;
    return {
      skin: h.dataset.skin || '', tone: h.dataset.tone || '', pattern: h.dataset.pattern || '',
      s50: h.style.getPropertyValue('--color-slate-50')
    };
  };
  const UI_URL = 'http://${HOST}:${PORT}/src/utils/uiSkin.js';
  try {
    const UI = await import(UI_URL);
    const store = localStorage;
    const proto = Object.getPrototypeOf(store);
    const realSet = proto.setItem;
    const cases = {};

    /* ── 0 · le chemin sain ───────────────────────────────────────────────── */
    store.clear();
    UI.saveUiSkin('custom');
    cases['0a peau custom cliquée'] = snap();
    UI.saveUiCustomSkin(${JSON.stringify(chosen(null))});
    cases['0b réglage custom appliqué'] = snap();

    /* ── TÉMOIN · sur une peau livrée, un réglage custom ne repeint rien ──── */
    store.clear();
    UI.saveUiSkin('slate');
    UI.saveUiCustomSkin(${JSON.stringify(chosen(null))});
    cases['W témoin : peau livrée, aucun report'] = snap();

    /* ── A · le stockage refuse d'écrire (quota / navigation privée) ──────── */
    store.clear();
    UI.saveUiSkin('violet');
    cases['Aa peau livrée appliquée'] = snap();
    proto.setItem = function () { throw new DOMException('QuotaExceededError'); };
    UI.saveUiSkin('custom');
    cases['Ab peau custom cliquée (écriture refusée)'] = snap();
    UI.saveUiCustomSkin(${JSON.stringify(chosen(null))});
    cases['Ac réglage custom — DOIT s\\u2019appliquer'] = snap();
    proto.setItem = realSet;

    /* ── B · la clé contient une valeur que le module ne reconnaît pas ────── */
    store.clear();
    realSet.call(store, 'labWorkspace_uiSkin', '"custom"');
    UI.saveUiSkin('violet');
    cases['Ba peau livrée appliquée'] = snap();
    UI.saveUiSkin('custom');
    cases['Bb peau custom cliquée'] = snap();
    UI.saveUiCustomSkin(${JSON.stringify(chosen(null))});
    cases['Bc réglage custom — DOIT s\\u2019appliquer'] = snap();

    /* ── C · la clé d'opérateur n'est pas la même au moment du clic ───────── */
    store.clear();
    UI.saveUiSkin('custom', { id: 'u1', name: 'Alice' });
    cases['Ca peau custom cliquée (opérateur u1)'] = snap();
    UI.saveUiCustomSkin(${JSON.stringify(chosen(null))}, { name: 'Alice' });
    cases['Cb réglage custom — DOIT s\\u2019appliquer'] = snap();

    Object.entries(cases).forEach(([k, v]) => log(k + ' = ' + JSON.stringify(v)));
    done({ ok: true, cases });
  } catch (e) {
    log('ERR ' + ((e && e.stack) || e));
    done({ ok: false, error: String((e && e.stack) || e) });
  }
<\/script>`;

let verdict = null;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { verdict = JSON.parse(body); } catch { verdict = { ok: false }; } res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/probe.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PROBE); return;
  }
  res.writeHead(404); res.end('no');
});

const waitFor = (url, ms) => new Promise((resolve) => {
  const t0 = Date.now();
  const tick = () => {
    http.get(url, (res) => { res.resume(); resolve(true); }).on('error', () => {
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 400);
    });
  };
  tick();
});

const main = async () => {
  if (!CHROME) { console.log('_ui_bg_apply_test.cjs — SAUTÉE (ni Chrome ni Edge sur cette machine)'); process.exit(0); }
  await new Promise((r) => server.listen(8794, '127.0.0.1', r));
  const vite = spawn('cmd.exe', ['/c', 'npm', 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: ROOT });
  const moduleUrl = `http://${HOST}:${PORT}/src/utils/uiSkin.js`;
  if (!await waitFor(moduleUrl, 60000)) {
    spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
    server.close();
    console.log('_ui_bg_apply_test.cjs — SAUTÉE (le serveur Vite n\u2019est pas monté)');
    process.exit(0);
  }
  const profile = path.join(ROOT, '_chrome_profile_apply');
  rm(profile);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, 'http://127.0.0.1:8794/probe.html'], { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && verdict === null) await new Promise((r) => setTimeout(r, 250));
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  rm(profile);
  server.close();

  if (!verdict) { console.log('_ui_bg_apply_test.cjs — 0/0 : la sonde n\u2019a rien rendu'); process.exit(1); }
  if (verdict.error) console.log('   ✖ ' + verdict.error);
  fs.writeFileSync('_bg_apply_cases.json', JSON.stringify(verdict, null, 2), 'utf8');
  const c = verdict.cases || {};
  const g = (k) => c[k] || {};

  ok(g('0a peau custom cliquée').skin === 'custom', 'peau personnalisée cliquée : elle est posée', String(g('0a peau custom cliquée').skin));
  ok(g('0b réglage custom appliqué').pattern === PATTERN && !!g('0b réglage custom appliqué').s50,
    'réglage choisi (couleur + motif) appliqué', JSON.stringify(g('0b réglage custom appliqué')));
  ok(!g('W témoin : peau livrée, aucun report').skin
    && !g('W témoin : peau livrée, aucun report').pattern
    && !g('W témoin : peau livrée, aucun report').s50,
    'témoin : sur une peau livrée, un réglage custom ne repeint RIEN', JSON.stringify(g('W témoin : peau livrée, aucun report')));

  ok(g('Aa peau livrée appliquée').skin === 'violet', 'A — une peau livrée s\u2019applique toujours', String(g('Aa peau livrée appliquée').skin));
  ok(g('Ac réglage custom — DOIT s\u2019appliquer').pattern === PATTERN && !!g('Ac réglage custom — DOIT s\u2019appliquer').s50,
    'A — stockage refusé : le réglage s\u2019applique quand même', JSON.stringify(g('Ac réglage custom — DOIT s\u2019appliquer')));

  ok(g('Ba peau livrée appliquée').skin === 'violet', 'B — une peau livrée s\u2019applique toujours', String(g('Ba peau livrée appliquée').skin));
  ok(g('Bc réglage custom — DOIT s\u2019appliquer').pattern === PATTERN && !!g('Bc réglage custom — DOIT s\u2019appliquer').s50,
    'B — clé illisible (« "custom" ») : le réglage s\u2019applique quand même', JSON.stringify(g('Bc réglage custom — DOIT s\u2019appliquer')));

  ok(g('Ca peau custom cliquée (opérateur u1)').skin === 'custom', 'C — la peau custom s\u2019applique (clé de l\u2019opérateur u1)', String(g('Ca peau custom cliquée (opérateur u1)').skin));
  ok(g('Cb réglage custom — DOIT s\u2019appliquer').pattern === PATTERN && !!g('Cb réglage custom — DOIT s\u2019appliquer').s50,
    'C — clé d\u2019opérateur changée : le réglage s\u2019applique quand même', JSON.stringify(g('Cb réglage custom — DOIT s\u2019appliquer')));

  const failed = CHECKS.filter((x) => !x.ok).length;
  if (failed) console.log('   cas mesurés : ' + JSON.stringify(c));
  console.log(`_ui_bg_apply_test.cjs — ${CHECKS.length - failed}/${CHECKS.length} assertions OK (un clic dans ⚙ Settings s\u2019applique-t-il ? mesuré dans Chrome, sur le vrai module, chemin sain ET trois pannes de stockage)`);
  if (failed) process.exit(1);
};

main().catch((e) => { console.log('   ✖ ' + String((e && e.stack) || e)); process.exit(1); });
