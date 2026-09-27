/* ============================================================================
   _page_parking_render_test.cjs — LE MOTIF DES PLACES DE PAGE, MESURÉ DANS UN
   VRAI NAVIGATEUR (≈10 s, Chrome en --headless=new).

   POURQUOI IL EXISTE
   La demande — « Keep alive EVERY page I leave (one at a time, hidden): nothing
   ever reloads when I come back » — tient à UNE propriété de React : entre
   frères d'un même parent, deux enfants qui échangent leur RANG mais gardent
   leur `key` sont DÉPLACÉS, pas reconstruits. Toutes les autres suites lisent le
   source ou exécutent les règles pures : aucune ne prouve ce que React fait
   vraiment. Si React remontait la page au lieu de la déplacer, l'état serait
   perdu EN SILENCE — le défaut d'origine, en pire : on croirait le mécanisme en
   place.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   `_page_parking_probe.jsx` est construit par Vite (mode navigateur, bundle
   autonome) dans _render_parking/ (ignoré par git), servi par un serveur
   127.0.0.1, et chargé par Chrome. La sonde joue elle-même le geste (partir,
   revenir) et POSTe ses mesures ici — pas de CDP, pas de socket. Elle monte
   AUSSI le motif naïf d'avant (`{shown === 'x' && …}`), le TÉMOIN NÉGATIF : sans
   lui, la sonde pourrait être verte sans rien mesurer.

   CE QUI EST VÉRIFIÉ
     1. une seule page est montée au départ, et elle est DESSINÉE
        (`display: contents` : sa boîte ne compte pas dans la mise en page) ;
     2. après le départ : deux places, la page quittée TOUJOURS MONTÉE, en
        `display: none`, et son compteur A AVANCÉ — elle vit ;
     3. au retour : c'est LE MÊME NŒUD DOM (===), il est redevenu visible, il a
        continué d'avancer, et les deux places ont échangé leur RANG (c'est ce
        déplacement qui prouve que rien n'a été reconstruit) ;
     4. le motif naïf, lui, a bien DÉTRUIT puis RECRÉÉ sa page (compteur remis à
        zéro) : la sonde distingue donc les deux comportements.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const OUT_DIR = '_render_parking';
const TIMEOUT_MS = 90000;

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && fs.existsSync(p))[0];

const CHECKS = [];
const ok = (cond, label, detail) => {
  CHECKS.push({ ok: !!cond, label });
  process.stdout.write((cond ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};

if (!CHROME) {
  console.log('_page_parking_render_test.cjs — SAUTÉE (ni Chrome ni Edge sur cette machine)');
  process.exit(0);
}

/* ── 1 · la sonde recopie-t-elle EXACTEMENT les règles de App.jsx ? ────────── */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const maskOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`déclaration ${name} introuvable`);
  const MASK = maskOf(src);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
const declOf = (src, name) => sliceDecl(src, name).replace(/\s+/g, ' ').trim();
const APP = read('src/App.jsx');
const PROBE = read('_page_parking_probe.jsx');
for (const name of ['parkedAfter', 'pageSlotIds', 'pageSlotClass']) {
  ok(declOf(APP, name) === declOf(PROBE, name),
    `la sonde recopie ${name}() à l’identique de src/App.jsx`,
    declOf(PROBE, name).slice(0, 60) + '…');
}

/* ── 2 · build du probe (Vite, page réelle : la feuille de style est liée) ─── */
const main = async () => {
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  // Tailwind EST nécessaire : c'est lui qui fabrique `.hidden` et `.contents`,
  // les deux classes sur lesquelles repose le mécanisme. Sans lui, la sonde
  // mesurerait une page sans style (`display: block`) et serait verte à tort.
  const tailwind = (await import('@tailwindcss/vite')).default;
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [react(), tailwind()],
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      minify: false,
      target: 'esnext',
      rollupOptions: { input: path.join(ROOT, '_page_parking_probe.html') },
    },
  });
  const INDEX = path.join(ROOT, OUT_DIR, '_page_parking_probe.html');
  ok(fs.existsSync(INDEX), 'le probe est construit (page navigateur)');

  /* ── 3 · serveur local (fichiers construits + le verdict) ─────────────────── */
  let result = null;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/result') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        try { result = JSON.parse(b); } catch (e) { result = { fatal: `verdict illisible (${e.message})` }; }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return undefined;
    }
    const rel = url.pathname === '/' ? '_page_parking_probe.html' : url.pathname.replace(/^\/+/, '');
    const file = path.join(ROOT, OUT_DIR, rel);
    if (!file.startsWith(path.join(ROOT, OUT_DIR)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  /* ── 4 · Chrome, en --headless=new, et le verdict de la sonde ─────────────── */
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'parking-probe-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT_MS && !result) await new Promise((r) => setTimeout(r, 200));
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  server.close();

  ok(!!result, 'la sonde a rendu son verdict');
  if (!result || result.fatal) {
    console.log('   ✖ ' + ((result && result.fatal) || 'aucun verdict (Chrome bloqué ?)'));
    console.log(`_page_parking_render_test.cjs — 0/${CHECKS.length} assertions OK`);
    process.exit(1);
  }
  const step = (name) => result.steps.find((s) => s.name === name) || {};
  const dep = step('depart');
  const away = step('pendant-qu-on-est-ailleurs');
  const back = step('au-retour');

  /* ── 5 · le départ : une seule page, et elle est DESSINÉE ─────────────────── */
  ok(dep.mounted === 1, 'au départ, UNE seule page est montée', `places=${dep.mounted}`);
  ok(dep.slotDisplay === 'contents',
    'la page affichée est en `display: contents` : sa boîte ne compte pas dans la mise en page',
    `${dep.slotClass} → ${dep.slotDisplay}`);

  /* ── 6 · ailleurs : la page quittée est TOUJOURS MONTÉE, cachée, VIVANTE ──── */
  ok(away.mounted === 2, 'après le départ, la page quittée est TOUJOURS MONTÉE', `places=${away.mounted}`);
  ok(JSON.stringify(away.slots) === JSON.stringify(['library', 'tests'])
    && JSON.stringify(back.slots) === JSON.stringify(['library', 'tests']),
    '…et chacune garde SA place dans l’ordre (la page quittée reste la 1re, la nouvelle la 2de) : c’est ce qui permet à React de réutiliser l’arbre au lieu de le reconstruire',
    `ailleurs=${JSON.stringify(away.slots)} retour=${JSON.stringify(back.slots)}`);
  ok(away.sameSlot === true && away.sameCounter === true,
    '…sans avoir été recréée : la place ET la page sont les mêmes nœuds DOM',
    `place=${away.sameSlot} page=${away.sameCounter}`);
  ok(away.slotDisplay === 'none', '…et elle est cachée (`display: none`)', `${away.slotClass} → ${away.slotDisplay}`);
  ok(away.counter > dep.counter,
    '…mais elle CONTINUE de vivre : son compteur a avancé pendant qu’on était ailleurs',
    `${dep.counter} → ${away.counter}`);
  ok(away.testsDisplay === 'contents', 'pendant ce temps, la page demandée est bien dessinée', String(away.testsDisplay));
  ok(away.naiveGone === true,
    'témoin : le motif d’avant (montage conditionnel) DÉTRUIT la page quittée', String(away.naiveGone));

  /* ── 7 · au retour : les MÊMES nœuds, vivants, et la visibilité échangée ──── */
  ok(back.sameSlot === true && back.sameCounter === true,
    'au retour, ce sont LES MÊMES nœuds DOM : la page n’a pas été reconstruite',
    `place=${back.sameSlot} page=${back.sameCounter}`);
  ok(back.slotDisplay === 'contents', '…elle est redevenue visible', `${back.slotClass} → ${back.slotDisplay}`);
  ok(back.counter > away.counter, '…et son compteur a continué d’avancer tout du long',
    `${away.counter} → ${back.counter}`);
  ok(back.testsParked === true, 'c’est maintenant l’autre page qui est gardée, cachée', String(back.testsParked));
  ok(back.naiveRebuilt === true && back.naiveCounter <= 8,
    'témoin : le motif d’avant RECRÉE sa page, compteur remis à zéro',
    `rebuilt=${back.naiveRebuilt} compteur=${back.naiveCounter}`);

  const failed = CHECKS.filter((c) => !c.ok).length;
  if (failed) console.log('   mesures : ' + JSON.stringify({ dep, away, back }));
  console.log(`_page_parking_render_test.cjs — ${CHECKS.length - failed}/${CHECKS.length} assertions OK (la page gardée survit au changement de page : même nœud DOM, état et minuteries vivants — mesuré par Chrome)`);
  if (failed) process.exit(1);
};

main().catch((e) => {
  console.log('   ✖ ' + String((e && e.stack) || e));
  process.exit(1);
});

