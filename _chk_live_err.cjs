/* SONDE — QUE JETTE LE PROGRAMME RÉEL ?
   On sert dist/, on ouvre l'app dans Chrome, on COLLECTE chaque faute
   (window.onerror, unhandledrejection, console.error), puis on clique les
   surfaces de navigation une par une pour voir quel écran jette
   « Cannot access 'x' before initialization ».
   Usage : node _chk_live_err.cjs [--clicks] [--wait=9000]                     */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const DO_CLICKS = process.argv.includes('--clicks');
const WAIT = Number((process.argv.find((a) => a.startsWith('--wait=')) || '--wait=9000').split('=')[1]);
const PORT = 8794;
const REPORTS = [];
const HITS = [];

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter((p) => p && fs.existsSync(p))[0];

const BOOT = `<!doctype html><meta charset="utf-8"><title>boot</title><script>
  localStorage.clear();
  localStorage.setItem('labWorkspace_uiSkin', 'custom');
  localStorage.setItem('labWorkspace_uiSkinCustom', JSON.stringify({
    accent: '#009689', neutral: 'stone', bg: '#22c55e', pattern: 'graph',
    ink: 'bold', scale: 'broad', pageMode: 'day'
  }));
  location.replace('/app.html');
<\/script>`;

const CLICKS = DO_CLICKS ? `
setTimeout(async () => {
  const clicked = [];
  const start = ERRS.length;
  const vis = (el) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 8;
  const targets = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(vis);
  const seen = new Set();
  for (const el of targets) {
    const lab = label(el);
    if (!lab || seen.has(lab)) continue;
    seen.add(lab);
    if (seen.size > 60) break;
    const before = ERRS.length;
    try { el.click(); } catch (e) { push('click-throw', lab + ' → ' + ((e && e.message) || e)); }
    await new Promise((r) => setTimeout(r, 500));
    clicked.push({ lab, newErrors: ERRS.slice(before).map((x) => x.text), painted: boot.painted() });
  }
  send({ phase: 'clicks', clicked, totalErrs: ERRS.length - start, errs: ERRS.slice(), labels: targets.map(label).slice(0, 60) });
}, ${WAIT + 1500});
` : '';

const PROBE = `/* ── la sonde : chaque faute, horodatée, avec la trace ─────────────────── */
const ERRS = [];
const push = (kind, text, extra) => ERRS.push(Object.assign({ t: Math.round(performance.now()), kind, text: String(text).slice(0, 400) }, extra || {}));
window.addEventListener('error', (e) => push('error', (e.message || 'error'), {
  file: String(e.filename || '').split('/').pop(), line: e.lineno, col: e.colno,
  stack: e.error && e.error.stack ? String(e.error.stack).split('\\n').slice(0, 4).join(' | ') : ''
}));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  push('rejection', (r && r.message) || r, { stack: r && r.stack ? String(r.stack).split('\\n').slice(0, 4).join(' | ') : '' });
});
const origErr = console.error.bind(console);
console.error = (...a) => { push('console', a.map((x) => (x && x.message) || String(x)).join(' ')); origErr(...a); };

const label = (el) => (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
const HREF = [];
const send = (payload) => {
  HREF.push(location.href);
  const body = JSON.stringify(Object.assign({ href: location.href }, payload));
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/report', new Blob([body], { type: 'text/plain' }))) return;
  } catch { /* repli */ }
  fetch('/report', { method: 'POST', body, keepalive: true }).catch(() => {});
};
const boot = {
  rootKids: () => (document.getElementById('root') ? document.getElementById('root').children.length : -1),
  screen: () => (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 260),
  painted: () => {
    const el = document.querySelector('[class~="bg-slate-50"]');
    return el ? Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height) : 'none';
  }
};

setTimeout(() => send({ phase: 'boot', after: ${WAIT}, painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), errs: ERRS.slice() }), ${WAIT});
setInterval(() => send({ phase: 'tick', painted: boot.painted(), rootKids: boot.rootKids(), screen: boot.screen(), hrefs: HREF.slice(), errs: ERRS.slice() }), 2500);
${CLICKS}`;



const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { HITS.push('POST /report ' + body.length); try { REPORTS.push(JSON.parse(body)); } catch { /* ignore */ } res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/boot.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(BOOT); return;
  }
  if (u.pathname === '/probe.js') {
    HITS.push('GET /probe.js');
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(PROBE); return;
  }
  if (u.pathname === '/app.html') {
    const raw = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
    const html = raw.replace('</body>', '<script src="/probe.js"></' + 'script></body>');
    HITS.push(`app.html  injecté=${html !== raw}  (${html.length} octets)`);
    fs.writeFileSync(path.join(ROOT, '_chk_app_out.html'), html, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return;
  }
  const dist = path.join(ROOT, 'dist');
  const file = path.join(dist, decodeURIComponent(u.pathname));
  HITS.push(`GET ${u.pathname}`);
  if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res); return;
  }
  res.writeHead(404); res.end('not found');
});

const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* verrouillé */ } };

(async () => {
  if (!CHROME) { console.log('SAUTÉE — pas de Chrome/Edge'); process.exit(0); }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.log('SAUTÉE — pas de dist/'); process.exit(0); }
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(ROOT, '_chrome_profile_err');
  rm(profile);
  const want = DO_CLICKS ? 2 : 1;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + profile, `http://127.0.0.1:${PORT}/boot.html`], { stdio: 'ignore' });
  const t0 = Date.now();
  const deadline = t0 + (DO_CLICKS ? 240000 : WAIT + 8000);
  while (Date.now() < deadline) {
    if (DO_CLICKS && REPORTS.some((r) => r.phase === 'clicks')) break;
    if (!DO_CLICKS && REPORTS.length >= want && Date.now() - t0 > WAIT + 3000) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  rm(profile);
  server.close();
  fs.writeFileSync(path.join(ROOT, '_chk_live_err.json'), JSON.stringify(REPORTS, null, 2), 'utf8');
  fs.writeFileSync(path.join(ROOT, '_chk_probe_out.js'), PROBE, 'utf8');
  fs.writeFileSync(path.join(ROOT, '_chk_hits.txt'), HITS.join('\r\n'), 'utf8');
  console.log('── REQUÊTES VUES ───────────────────────────────────────────────────');
  console.log('  ' + (HITS.slice(0, 25).join(' · ') || 'aucune') + (HITS.length > 25 ? ` … (${HITS.length})` : ''));
  const last = REPORTS[REPORTS.length - 1];
  const bootRep = REPORTS.find((r) => r.phase === 'boot') || last;
  console.log('── AU DÉMARRAGE ────────────────────────────────────────────────────');
  if (!last) console.log('  aucun rapport — la sonde n’a jamais répondu');
  else {
    console.log(`  ${REPORTS.length} rapports · peint ${last.painted} · #root enfants ${last.rootKids} · ${last.errs.length} faute(s)`);
    console.log(`  écran : ${last.screen}`);
    console.log(`  url(s) vues : ${[...new Set(REPORTS.map((r) => r.href))].join(' → ')}`);
    for (const e of (bootRep.errs || [])) console.log(`   [${e.kind}] ${e.text}  ${e.file || ''}${e.line ? ':' + e.line : ''} ${e.stack ? '\n        ' + e.stack : ''}`);
  }
  const clickRep = REPORTS.find((r) => r.phase === 'clicks');
  if (clickRep) {
    console.log('── APRÈS CLICS ─────────────────────────────────────────────────────');
    console.log(`  ${clickRep.clicked.length} surfaces cliquées · ${clickRep.totalErrs} faute(s) nouvelle(s)`);
    console.log('  surfaces vues : ' + (clickRep.labels || []).join(' · '));
    for (const c of clickRep.clicked) if (c.newErrors.length) console.log(`   « ${c.lab} » → ${c.newErrors.join(' / ')}`);
    for (const e of clickRep.errs) console.log(`   [${e.kind}] ${e.text}  ${e.file || ''}${e.line ? ':' + e.line : ''} ${e.stack ? '\n        ' + e.stack : ''}`);
  }
  const bad = (bootRep && bootRep.errs.length) || (clickRep && clickRep.totalErrs);
  console.log(bad ? '\n✖ des fautes ont été vues' : '\n✓ aucune faute vue');
})();
