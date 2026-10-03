/* ==========================================================================
   _ui_skin_pixel_test.cjs — la peau, MESURÉE DANS UN VRAI NAVIGATEUR.

   POURQUOI IL EXISTE
   _ui_skin_test.cjs relit la feuille de style et refait les maths de contraste :
   elle prouve la PALETTE. Reste la promesse centrale du mécanisme, qui n'est
   qu'une chaîne de résolutions CSS et que rien d'autre ne peut prouver :
   Tailwind compile bien `bg-slate-800` en `var(--color-slate-800)`, le bloc
   `[data-skin="…"]` (non calqué sur une @layer) gagne bien sur `@layer theme`,
   et l'attribut posé sur un ÉLÉMENT ne repeint que son sous-arbre — c'est ce
   qui permet la miniature vivante de Settings. Ce fichier ouvre Chrome en
   `--headless=new`, charge le CSS COMPILÉ de l'application
   (dist/assets/index-*.css, celui de `npx vite build`) et demande au moteur ce
   qu'il a réellement calculé pour les classes de l'interface.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert la page de sonde et le CSS compilé. La page
   construit six éléments avec les VRAIES classes de l'interface (chrome, carte,
   légende, bouton d'accent, fond de page, plus une miniature imbriquée), lit
   `getComputedStyle` pour chaque peau, puis POSTe son verdict JSON.

   CE QUI EST VÉRIFIÉ, sans recopier une seule valeur de la palette :
     · pour chaque peau, la couleur calculée de `bg-slate-800` / `bg-white` /
       `bg-blue-600` est EXACTEMENT celle que le moteur rend pour
       `var(--color-slate-800)` / `var(--color-white)` / `var(--color-blue-600)`
       (c'est toute la chaîne « utile → variable → bloc ») ;
     · chaque peau CHANGE ce qu'elle annonce (une peau ne peut pas être un
       mensonge) : graphite/warm/dim/contrast bougent l'échelle neutre, indigo /
       violet bougent l'accent, dim est la seule à bouger le blanc ;
     · la RÉFÉRENCE (aucun attribut) rend la palette livrée, pixel pour pixel ;
     · la miniature imbriquée (`[data-skin]` sur un <div>) reprend la peau pour
       ELLE SEULE : un frère à côté garde la peau de <html> ;
     · les trois couleurs d'identité des peaux : le chrome « graphite » est gris
       neutre (r≈g≈b), le chrome « warm » est chaud (r>g>b), l'accent « violet »
       est plus rouge que le bleu livré.

   LANCEMENT : node _ui_skin_pixel_test.cjs   (≈4 s)
   Elle est SAUTÉE (exit 0) — jamais verte en silence — sans Chrome/Edge, et
   aussi si dist/ n'a pas été construit (`npx vite build`).
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const TIMEOUT_MS = 60000;

let last = null;
let resolveResult;
const resultDone = new Promise((r) => { resolveResult = r; });

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter((p) => p && fs.existsSync(p))[0];

/* le CSS COMPILÉ de l'application : c'est lui qui contient les utilitaires */
const distDir = path.join(ROOT, 'dist', 'assets');
const CSS_FILE = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => /^index-.*\.css$/.test(f))
    .map((f) => path.join(distDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  : null;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/skin.css"></head>
<body class="bg-slate-50">
  <div id="chrome" class="bg-slate-800 text-white">chrome</div>
  <div id="card" class="bg-white border border-slate-200"><span id="caption" class="text-slate-400">2026-10-03</span></div>
  <button id="accent" class="bg-blue-600 text-white">Save</button>
  <div id="pagebg" class="bg-slate-50"></div>
  <div id="outside" class="bg-slate-800"></div>
  <div id="preview" data-skin="dim"><div id="pcard" class="bg-white"></div><div id="pchrome" class="bg-slate-800"></div></div>
  <div id="probe" style="display:none"></div>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', PAGE.replace('</body>', PAGE_SCRIPT + '</body>'));
  if (url.pathname === '/skin.css') return send(200, 'text/css', fs.readFileSync(CSS_FILE));
  if (url.pathname === '/result') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      try { last = JSON.parse(raw); } catch (e) { last = { stage: 'fatal', error: String(e), raw: raw.slice(0, 300) }; }
      resolveResult(last);
      send(200, 'text/plain', 'ok');
    });
    return undefined;
  }
  return send(404, 'text/plain', 'nope');
});

/* le script de la page : pour chaque peau, ce que le MOTEUR a calculé */
const PAGE_SCRIPT = `
<script>
const SKINS = ['slate', 'graphite', 'warm', 'indigo', 'violet', 'dim', 'contrast'];
/* Le moteur rend la couleur CALCULÉE dans son espace d'origine — un oklch(…)
   pour tout ce qui vient des variables de Tailwind, et le canvas la redonne
   telle quelle. On va donc jusqu'au PIXEL : une toile 1×1 remplie de cette
   couleur, relue en ImageData. C'est le même verdict qu'une capture d'écran,
   sans écrire de PNG, et la comparaison « classe utilitaire » contre
   « var(--color-…) » reste une égalité de pixels. */
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 1;
const cx = canvas.getContext('2d', { willReadFrequently: true });
const px = (col) => {
  cx.fillStyle = '#000';
  cx.fillStyle = col;
  cx.fillRect(0, 0, 1, 1);
  const d = cx.getImageData(0, 0, 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
};
const bg = (id) => px(getComputedStyle(document.getElementById(id)).backgroundColor);
const fg = (id) => px(getComputedStyle(document.getElementById(id)).color);
const varOf = (name) => {
  const el = document.getElementById('probe');
  el.style.background = 'var(' + name + ')';
  const v = px(getComputedStyle(el).backgroundColor);
  el.style.background = '';
  return v;
};
const read = () => ({
  chrome: bg('chrome'), white: bg('card'), caption: fg('caption'), accent: bg('accent'), page: bg('pagebg'),
  vChrome: varOf('--color-slate-800'), vWhite: varOf('--color-white'), vAccent: varOf('--color-blue-600')
});
const out = {};
for (const s of SKINS) {
  if (s === 'slate') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = s;
  out[s] = read();
  /* la miniature : la peau du <html> laisse le <div data-skin="dim"> intact */
  out[s].preview = { card: bg('pcard'), chrome: bg('pchrome'), outside: bg('outside') };
}
delete document.documentElement.dataset.skin;
fetch('/result', { method: 'POST', body: JSON.stringify({ stage: 'done', skins: out }) });
</script>`;

const CHECKS = [];
const check = (ok, label, detail) => {
  CHECKS.push({ ok: !!ok, label });
  process.stdout.write((ok ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
  return ok;
};

/* ── petites aides couleur : #rrggbb (canvas) ou rgb(…) ──────────────────── */
const rgb = (s) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(s));
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  return (String(s).match(/\d+/g) || []).slice(0, 3).map(Number);
};
const lum = (s) => {
  const [r, g, b] = rgb(s).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

(async () => {
  if (!CSS_FILE) {
    console.log('SAUTÉ  dist/assets/index-*.css absent — lancez `npx vite build` puis relancez la sonde');
    console.log('_ui_skin_pixel_test.cjs — 0 assertion (SAUTÉ : pas de CSS compilé)');
    process.exit(0);
  }
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde des peaux ne peut pas tourner');
    console.log('_ui_skin_pixel_test.cjs — 0 assertion (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skinprobe-'));
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const url = 'http://127.0.0.1:' + port + '/probe';
  console.log('css    : ' + path.relative(ROOT, CSS_FILE));
  console.log('chrome : ' + CHROME);
  console.log('sonde  : ' + url + '\n');

  const errs = [];
  const child = spawn(CHROME, [
    '--headless=new', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-extensions', '--disable-component-update', '--disable-background-networking',
    '--disable-sync', '--disable-default-apps', '--disable-features=Translate',
    '--user-data-dir=' + tmp, '--window-size=900,700', url
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (d) => {
    String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) { errs.push(l.trim()); if (errs.length > 40) errs.shift(); } });
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timedOut = await Promise.race([resultDone.then(() => false), sleep(TIMEOUT_MS).then(() => true)]);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  server.close();

  if (timedOut) {
    console.log('\nÉCHEC  la sonde n\'a pas rendu son verdict en ' + (TIMEOUT_MS / 1000) + ' s');
    console.log('       stderr chrome :\n' + errs.slice(-20).join('\n'));
    process.exit(1);
  }
  const d = last;
  const S = d.skins || {};
  const need = ['slate', 'graphite', 'warm', 'indigo', 'violet', 'dim', 'contrast'];
  check(d.stage === 'done', 'la page a rendu son verdict', String(d.stage));
  check(need.every((s) => S[s]), 'les sept peaux ont été mesurées', need.filter((s) => !S[s]).join() || 'toutes');

  console.log('\n--- la chaîne « classe → variable → bloc » (aucune valeur recopiée) ---');
  for (const s of need) {
    const r = S[s] || {};
    check(r.chrome === r.vChrome, `${s} : bg-slate-800 rend exactement var(--color-slate-800)`,
      `${r.chrome} / ${r.vChrome}`);
    check(r.white === r.vWhite, `${s} : bg-white rend exactement var(--color-white)`,
      `${r.white} / ${r.vWhite}`);
    check(r.accent === r.vAccent, `${s} : bg-blue-600 rend exactement var(--color-blue-600)`,
      `${r.accent} / ${r.vAccent}`);
  }

  console.log('\n--- la référence (aucun attribut) rend la palette livrée ---');
  check(S.slate.white === '#ffffff', 'la carte est blanche, comme livrée', S.slate.white);
  check(S.slate.accent === '#155dfc', 'l’accent est le blue-600 livré (Tailwind v4)', S.slate.accent);
  check(S.slate.chrome === '#1d293d', 'le chrome est le slate-800 livré', S.slate.chrome);

  console.log('\n--- chaque peau change ce qu’elle annonce (jamais un mensonge) ---');
  check(S.graphite.chrome !== S.slate.chrome, 'graphite repeint le chrome',
    `${S.slate.chrome} → ${S.graphite.chrome}`);
  check(S.graphite.white === S.slate.white, '…sans toucher au blanc (échelle neutre seule)', S.graphite.white);
  check(S.warm.chrome !== S.slate.chrome, 'warm repeint le chrome', S.warm.chrome);
  check(S.dim.white !== S.slate.white, 'dim est la seule à repeindre le blanc',
    `${S.slate.white} → ${S.dim.white}`);
  check(S.dim.page !== S.slate.page, '…et le fond de page avec lui', `${S.slate.page} → ${S.dim.page}`);
  check(S.graphite.white === S.slate.white && S.contrast.white === S.slate.white,
    'les autres gardent le blanc livré', S.contrast.white);
  check(S.indigo.accent !== S.slate.accent, 'indigo repeint l’accent',
    `${S.slate.accent} → ${S.indigo.accent}`);
  check(S.violet.accent !== S.indigo.accent, 'violet aussi, autrement', S.violet.accent);
  check(S.indigo.chrome === S.slate.chrome, 'indigo laisse l’échelle neutre seule (les deux bleus SWAPPENT)',
    S.indigo.chrome);
  check(S.contrast.caption !== S.slate.caption, 'contrast fonce la légende du programme',
    `${S.slate.caption} → ${S.contrast.caption}`);
  check(lum(S.contrast.caption) < lum(S.slate.caption) * 0.7,
    '…et c’est une vraie amélioration de contraste (luminance de l’encre)',
    `${(lum(S.slate.caption) * 100).toFixed(0)} % → ${(lum(S.contrast.caption) * 100).toFixed(0)} %`);

  console.log('\n--- les trois identités de couleur ---');
  const [gr, gg, gb] = rgb(S.graphite.chrome);
  check(Math.max(gr, gg, gb) - Math.min(gr, gg, gb) <= 3, 'graphite est un gris NEUTRE (r≈g≈b)',
    `${gr}/${gg}/${gb}`);
  const [wr, wg, wb] = rgb(S.warm.chrome);
  check(wr > wg && wg >= wb, 'warm est CHAUD (r>g>b)', `${wr}/${wg}/${wb}`);
  check(rgb(S.violet.accent)[0] > rgb(S.slate.accent)[0] + 40,
    'l’accent violet porte beaucoup plus de rouge que le bleu livré', S.violet.accent);

  console.log('\n--- la miniature : la peau d’un <div> ne déborde pas ---');
  check(S.slate.preview.card === S.dim.white,
    'la miniature suit SA peau (dim), même sous la référence', `${S.slate.preview.card} / ${S.dim.white}`);
  check(S.slate.preview.chrome === S.dim.chrome,
    '…chrome compris', `${S.slate.preview.chrome} / ${S.dim.chrome}`);
  check(need.every((s) => S[s].preview.card === S[s].preview.card && S[s].preview.card === S.dim.white),
    '…et sous les six autres peaux (aucune ne la contamine)',
    need.map((s) => S[s].preview.card).join(' '));
  check(need.every((s) => S[s].preview.outside === S[s].chrome),
    'le frère SANS attribut, lui, suit la peau de <html> pour chaque peau');

  const failed = CHECKS.filter((c) => !c.ok);
  console.log(failed.length
    ? `\n❌ ${failed.length} vérification(s) en échec`
    : `\n_ui_skin_pixel_test.cjs — ${CHECKS.length} vérifications OK (les 7 peaux mesurées dans Chrome, sur le CSS compilé)`);
  process.exit(failed.length ? 1 : 0);
})();


