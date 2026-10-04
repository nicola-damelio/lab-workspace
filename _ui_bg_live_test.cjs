/* ============================================================================
   _ui_bg_live_test.cjs — LE FOND DE PAGE, MESURÉ DANS LE VRAI PROGRAMME.

   POURQUOI ELLE EXISTE
   « changing the background color or pattern does not have any effect » : la
   question ne se tranche PAS en lisant source ou feuille. Les suites existantes
   vérifient les règles pures (uiBgStops, uiSkinCustomVars), le CSS compilé, et
   le câblage de ⚙ Settings — aucune ne charge l'application RÉELLE avec un
   réglage enregistré pour regarder ce que le moteur peint. Celle-ci le fait :
   elle sert dist/ (le build), amorce localStorage comme une session qui a déjà
   choisi sa page (couleur #22c55e + motif grid), ouvre l'app dans
   Chrome --headless=new, et lit les attributs, les variables EN LIGNE, et le
   `background-color` / `background-image` CALCULÉS sur le vrai cadre de page.

   Ce que la sonde rapporte est comparé ici ; `--shot` écrit en plus une capture
   (`_bg_shot_custom.png`) qui montre la page peinte.

   Usage : node _ui_bg_live_test.cjs custom     (le réglage amorcé)
           node _ui_bg_live_test.cjs none       (le témoin négatif : page livrée)
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const MODE = (process.argv[2] || 'custom').toLowerCase();
const SHOT = process.argv.includes('--shot');
const SEED = MODE === 'custom';
const PORT = 8791;

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter((p) => p && fs.existsSync(p))[0];

const CHOSEN_BG = '#22c55e';
const CHOSEN_PATTERN = 'grid';

const CHECKS = [];
const ok = (cond, label, detail) => {
  CHECKS.push({ ok: !!cond, label });
  process.stdout.write((cond ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};
const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* profil verrouillé */ } };

const BOOT = `<!doctype html><meta charset="utf-8"><title>boot</title><script>
  if (${SEED}) {
    localStorage.setItem('labWorkspace_uiSkin', 'custom');
    localStorage.setItem('labWorkspace_uiSkinCustom', JSON.stringify({
      accent: '#009689', neutral: 'stone', bg: '${CHOSEN_BG}', pattern: '${CHOSEN_PATTERN}'
    }));
  } else {
    localStorage.clear();
  }
  location.replace('/app.html');
<\/script>`;

const PROBE = `/* lit ce que le moteur calcule, et le renvoie au banc */
const measure = () => {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const synth = document.createElement('div');
  synth.className = 'bg-slate-50';
  document.body.appendChild(synth);
  const of = (el) => {
    const c = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 70),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
      color: c.backgroundColor,
      image: c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 70),
      size: c.backgroundSize
    };
  };
  const synthOut = of(synth);
  const pages = Array.from(document.querySelectorAll('[class~="bg-slate-50"]')).filter((el) => el !== synth);
  synth.remove();
  return {
    at: Math.round(performance.now()),
    dataset: Object.assign({}, html.dataset),
    inline: {
      slate50: html.style.getPropertyValue('--color-slate-50'),
      slate100: html.style.getPropertyValue('--color-slate-100'),
      blue600: html.style.getPropertyValue('--color-blue-600')
    },
    htmlImage: cs.getPropertyValue('--lab-page-image').trim().slice(0, 60),
    body: getComputedStyle(document.body).backgroundColor,
    synth: synthOut,
    pages: pages.slice(0, 8).map(of),
    pageCount: pages.length,
    rootKids: document.getElementById('root') ? document.getElementById('root').children.length : -1
  };
};
const send = () => fetch('/report', { method: 'POST', body: JSON.stringify(measure()) }).catch(() => {});
setTimeout(send, 700);
setTimeout(send, 3000);
setTimeout(send, 9000);
`;

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const reports = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { reports.push(JSON.parse(body)); } catch { /* ignore */ } res.writeHead(204); res.end(); });
    return;
  }
  if (u.pathname === '/' || u.pathname === '/boot.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(BOOT); return;
  }
  if (u.pathname === '/probe.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); res.end(PROBE); return;
  }
  if (u.pathname === '/app.html') {
    const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8')
      .replace('</body>', '<script src="/probe.js"><\/script></body>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return;
  }
  const dist = path.join(ROOT, 'dist');
  const file = path.join(dist, decodeURIComponent(u.pathname));
  if (file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res); return;
  }
  res.writeHead(404); res.end('not found');
});

const main = async () => {
  if (!CHROME) { console.log('_ui_bg_live_test.cjs — SAUTÉE (ni Chrome ni Edge sur cette machine)'); process.exit(0); }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.log('_ui_bg_live_test.cjs — SAUTÉE (pas de dist/ : `npm run build` d\u2019abord)'); process.exit(0); }
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(ROOT, '_chrome_profile_bg');
  rm(profile);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    ...(SHOT ? ['--window-size=1280,860', '--virtual-time-budget=12000', '--screenshot=' + path.join(ROOT, '_bg_shot_' + MODE + '.png')] : []),
    `http://127.0.0.1:${PORT}/boot.html`], { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < (SHOT ? 15000 : 60000) && (SHOT ? true : reports.length < 3)) await new Promise((r) => setTimeout(r, 250));
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
  rm(profile);
  server.close();

  const last = reports[reports.length - 1];
  fs.writeFileSync('_bg_live_' + MODE + '.json', JSON.stringify(reports, null, 2), 'utf8');
  ok(!!last, 'l\u2019application a rendu ses mesures', 'rapports=' + reports.length);
  if (!last) {
    console.log(`_ui_bg_live_test.cjs — 0/${CHECKS.length} assertions OK`);
    process.exit(1);
  }
  const painted = last.pages[0] || last.synth;   /* le vrai cadre de page, sinon l\u2019échantillon */

  /* ── CE QUI EST POSÉ SUR <html> ──────────────────────────────────────────── */
  if (SEED) {
    ok(last.dataset.skin === 'custom', 'la peau personnalisée est posée', String(last.dataset.skin));
    ok(last.dataset.pattern === CHOSEN_PATTERN, 'le motif choisi est sur <html>', String(last.dataset.pattern));
    ok(/^oklch\(95\.5% 0\.0\d+ 1\d\d/.test(last.inline.slate50), 'la couleur choisie est écrite EN LIGNE (' + CHOSEN_BG + ' ramené dans la bande)', String(last.inline.slate50));
    ok(last.inline.slate100.startsWith('oklch('), 'le second cran de la page en dérive', String(last.inline.slate100));
    ok(last.inline.blue600.startsWith('oklch('), 'l\u2019accent personnalisé voyage avec elle', String(last.inline.blue600));
  } else {
    ok(last.dataset.pattern === undefined, 'sans motif choisi, AUCUN attribut n\u2019est posé', String(last.dataset.pattern));
    ok(last.inline.slate50 === '', 'sans couleur choisie, aucune variable EN LIGNE', JSON.stringify(last.inline.slate50));
  }

  /* ── CE QUE LA PAGE PEINT ────────────────────────────────────────────────── */
  if (SEED) {
    ok(/gradient/.test(painted.image), 'la page est PEINTE du motif choisi (background-image calculé)', painted.image);
    ok(painted.size.indexOf('24px') === 0, '…à la trame du motif (grid = 24 px)', painted.size);
    ok(/0\.955/.test(painted.color), '…sur la couleur choisie (le plancher de la bande), pas celle livrée', painted.color);
    ok(/oklch|rgb\(/.test(last.body), 'le fond du document suit la même couleur', last.body);
  } else {
    ok(painted.image === 'none', 'aucun motif : la page reste intacte', painted.image);
    ok(!/0\.955/.test(painted.color), '…et garde la couleur livrée', painted.color);
  }
  ok(last.pageCount >= 1, 'le programme RÉEL a bien des surfaces de page à peindre', 'surfaces=' + last.pageCount);
  ok((painted.w || 0) > 0 && (painted.h || 0) > 0, '…et la première est réellement dessinée', painted.w + '×' + painted.h);

  const failed = CHECKS.filter((c) => !c.ok).length;
  if (failed) console.log('   mesures : ' + JSON.stringify(last));
  console.log(`_ui_bg_live_test.cjs — ${CHECKS.length - failed}/${CHECKS.length} assertions OK (mode ${MODE} : ce que le moteur peint sur les pages réelles — mesuré dans Chrome sur ${path.basename('dist')})`);
  if (failed) process.exit(1);
};

main().catch((e) => { console.log('   ✖ ' + String((e && e.stack) || e)); process.exit(1); });
