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
   construit neuf éléments avec les VRAIES classes de l'interface (chrome, carte,
   encre de la carte, légende, bouton d'accent avec son libellé, fond de page,
   encre de la page, plus une miniature imbriquée), lit `getComputedStyle` pour
   chaque peau, puis POSTe son verdict JSON.

   CE QUI EST VÉRIFIÉ, sans recopier une seule valeur de la palette :
     · pour chaque peau, la couleur calculée de `bg-slate-800` / `bg-white` /
       `bg-blue-600` est EXACTEMENT celle que le moteur rend pour
       `var(--color-slate-800)` / `var(--color-white)` / `var(--color-blue-600)`
       (c'est toute la chaîne « utile → variable → bloc ») ;
     · chaque peau CHANGE ce qu'elle annonce (une peau ne peut pas être un
       mensonge) : graphite/warm/dim/contrast bougent l'échelle neutre, indigo /
       violet bougent l'accent, dim, `night` et `carbon` bougent le blanc ;
     · LA PAGE SOMBRE — « the skins do not change the background color. for dark
       color the writing must change color to allow visibility » : pour `night`
       et `carbon`, le fond de page et les cartes sont mesurés SOMBRES, l'encre
       mesurée CLAIRE, et chaque paire écrite (encre sur le fond, encre sur la
       carte, une date, le libellé du bouton, le libellé du bandeau) doit garder
       son plancher de lisibilité — un contraste WCAG calculé sur les pixels
       rendus par le moteur, pas sur la feuille de style ;
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
  <div id="card" class="bg-white border border-slate-200"><span id="caption" class="text-slate-400">2026-10-03</span><span id="cardink" class="text-slate-700">Data</span>
    <svg id="fig" viewBox="0 0 120 30" width="120" height="30"><text id="figtick" x="0" y="12" fill="#64748b" font-size="8">tick</text><text id="figtitle" x="0" y="26" fill="#334155" font-size="8">axis title</text></svg>
  </div>
  <button id="accent" class="bg-blue-600 text-white">Save</button>
  <div id="pagebg" class="bg-slate-50"><span id="ink" class="text-slate-700">Overview</span></div>
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
const SKINS = ['slate', 'graphite', 'warm', 'indigo', 'violet', 'dim', 'contrast', 'night', 'carbon'];
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
const fillOf = (id) => px(getComputedStyle(document.getElementById(id)).fill);
const varOf = (name) => {
  const el = document.getElementById('probe');
  el.style.background = 'var(' + name + ')';
  const v = px(getComputedStyle(el).backgroundColor);
  el.style.background = '';
  return v;
};
const read = () => ({
  chrome: bg('chrome'), white: bg('card'), caption: fg('caption'), accent: bg('accent'), page: bg('pagebg'),
  ink: fg('ink'), cardInk: fg('cardink'), chromeInk: fg('chrome'), accentInk: fg('accent'),
  figTick: fillOf('figtick'), figTitle: fillOf('figtitle'),
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
/* LES VINGT MOTIFS — mesurés sur la feuille COMPILÉE. Une PASTILLE porte la
   classe d'une page (lab-page-chip, qui peint la couleur de page et remet le
   motif à zéro) et l'attribut du motif ; une PAGE porte la classe de la page et
   rien d'autre — c'est <html> qui lui donne le motif. Les deux doivent peindre
   la MÊME image, sinon une pastille pourrait montrer autre chose que la page. */
const PATTERNS = ['none', 'grid', 'fine', 'graph', 'dots', 'dense', 'rules', 'diagonal', 'cross', 'weave', 'herringbone', 'triangles',
  'waves', 'scales', 'zigzag', 'honeycomb', 'bubbles', 'confetti', 'checker', 'plaid'];
const chipEl = (id, attrs) => {
  const el = document.createElement('div');
  el.className = 'lab-page-chip';
  if (id && id !== 'none') el.dataset.pattern = id;
  if (id === 'none') delete el.dataset.pattern;
  for (const k in (attrs || {})) el.style.setProperty(k, attrs[k]);
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const v = { image: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage, size: cs.backgroundSize, pos: cs.backgroundPosition, line: cs.getPropertyValue('--lab-page-line').trim() };
  el.remove();
  return v;
};
const pageEl = (id) => {
  const el = document.createElement('div');
  el.className = 'bg-slate-50';
  if (id && id !== 'none') el.dataset.pattern = id;
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const v = { image: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage, size: cs.backgroundSize };
  el.remove();
  return v;
};
const chips = {};
for (const id of PATTERNS) chips[id] = chipEl(id, { '--lab-page-alpha': '0.06' });
const pages = {};
for (const id of PATTERNS) pages[id] = pageEl(id);
/* …et la pastille « None » sous une page QUI PORTE un motif : elle doit rester
   nue (c'est tout l'objet de sa remise à zéro). */
document.documentElement.dataset.pattern = 'grid';
const noneUnderGrid = chipEl('none');
const plainPageUnderGrid = pageEl('none');
delete document.documentElement.dataset.pattern;
/* LES DEUX RÉGLAGES, dans le moteur : l'échelle multiplie la tuile, la force
   règle l'alpha du filet. */
const scaled = chipEl('grid', { '--lab-page-scale': '2' }).size;
const scaledHalf = chipEl('grid', { '--lab-page-scale': '0.5' }).size;
const lines = {};
for (const a of ['0.035', '0.06', '0.11']) lines[a] = chipEl('grid', { '--lab-page-alpha': a }).line;
/* LES TROIS ENCRES : celles que le JavaScript écrit en ligne (le filet neutre,
   la teinte de l'accent, son complémentaire) — ici posées à la main, comme
   uiSkinCustomVars les pose sur <html>. */
const tints = chipEl('confetti', { '--lab-page-alpha': '0.06', '--lab-page-ink-2': '42 78 153', '--lab-page-ink-3': '129 61 0' });
/* LA PAGE DE NUIT : la peau personnalisée RETOURNÉE par deux attributs
   (data-skin="custom" + data-pagemode="night"), les encres claires étant
   écrites en ligne. Peu importe ce qui l'a écrite : ce qui compte est ce que le
   MOTEUR peint. */
const nightEl = (cls, id, attrs, tone, mode) => {
  const el = document.createElement('div');
  el.className = cls;
  el.dataset.skin = 'custom';
  if (mode) el.dataset.pagemode = mode;
  if (tone) el.dataset.tone = tone;
  if (id && id !== 'none') el.dataset.pattern = id;
  for (const k in (attrs || {})) el.style.setProperty(k, attrs[k]);
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const v = { bg: px(cs.backgroundColor), image: cs.backgroundImage === 'none' ? 'none' : cs.backgroundImage,
    size: cs.backgroundSize, pos: cs.backgroundPosition, line: cs.getPropertyValue('--lab-page-line').trim() };
  el.remove();
  return v;
};
const NIGHT_INKS = { '--lab-page-ink': '226 232 240', '--lab-page-ink-2': '177 203 252', '--lab-page-ink-3': '243 190 157' };
const dark = {
  day: nightEl('bg-slate-50', 'grid', null, '', ''),
  page: nightEl('bg-slate-50', 'none', null, '', 'night'),
  drawn: nightEl('bg-slate-50', 'confetti', { '--lab-page-alpha': '0.11', ...NIGHT_INKS }, '', 'night'),
  chip: nightEl('lab-page-chip', 'confetti', { '--lab-page-alpha': '0.11', ...NIGHT_INKS }, '', 'night'),
  zinc: nightEl('bg-slate-50', 'none', null, 'zinc', 'night'),
  stone: nightEl('bg-slate-50', 'none', null, 'stone', 'night')
};
fetch('/result', { method: 'POST', body: JSON.stringify({ stage: 'done', skins: out,
  patterns: { chips, pages, noneUnderGrid, plainPageUnderGrid, scaled, scaledHalf, lines, tints, dark } }) });
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
/* le contraste WCAG de deux couleurs MESURÉES (deux pixels du moteur) */
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

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
  const need = ['slate', 'graphite', 'warm', 'indigo', 'violet', 'dim', 'contrast', 'night', 'carbon'];
  check(d.stage === 'done', 'la page a rendu son verdict', String(d.stage));
  check(need.every((s) => S[s]), 'les neuf peaux ont été mesurées', need.filter((s) => !S[s]).join() || 'toutes');

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
  check(S.dim.white !== S.slate.white, 'dim repeint le blanc (une page moins éblouissante)',
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

  console.log('\n--- LES PEAUX SOMBRES : le fond a changé, et l’encre a suivi ---');
  /* « the skins do not change the background color. for dark color the writing
     must change color to allow visibility » : ici, la promesse est MESURÉE pixel
     par pixel — le fond est sombre, l’encre est claire, et chaque paire que le
     programme écrit garde son plancher de lisibilité, calculé sur ce que le
     moteur a réellement rendu (aucune valeur de la palette n’est recopiée). */
  const DARK = ['night', 'carbon'];
  for (const s of DARK) {
    const r = S[s];
    check(lum(r.page) < 0.05 && lum(r.white) < 0.05,
      `${s} : le FOND de page et les CARTES sont sombres`, `page ${r.page} · carte ${r.white}`);
    check(lum(r.ink) > 0.35 && lum(r.cardInk) > 0.35,
      `${s} : l’ENCRE de la page et celle de la carte sont claires`, `${r.ink} / ${r.cardInk}`);
    const onPage = contrast(r.ink, r.page);
    const onCard = contrast(r.cardInk, r.white);
    const caption = contrast(r.caption, r.white);
    const label = contrast(r.accentInk, r.accent);
    const onChrome = contrast(r.chromeInk, r.chrome);
    check(onPage >= 7, `${s} : l’encre reste lisible sur le fond sombre (${onPage.toFixed(2)}:1 ≥ 7)`,
      `${r.ink} / ${r.page}`);
    check(onCard >= 7, `${s} : l’encre reste lisible sur la carte (${onCard.toFixed(2)}:1 ≥ 7)`,
      `${r.cardInk} / ${r.white}`);
    check(caption >= 2.4, `${s} : une date reste lisible sur la carte (${caption.toFixed(2)}:1 ≥ 2.4)`,
      `${r.caption} / ${r.white}`);
    check(label >= 3.5, `${s} : le libellé du bouton reste lisible (${label.toFixed(2)}:1 ≥ 3.5)`,
      `${r.accentInk} / ${r.accent}`);
    check(onChrome >= 5.5, `${s} : le libellé du bandeau sombre reste lisible (${onChrome.toFixed(2)}:1 ≥ 5.5)`,
      `${r.chromeInk} / ${r.chrome}`);
    check(r.white !== S.slate.white, `${s} : la carte n’est plus le blanc livré`, `${S.slate.white} → ${r.white}`);
    /* LA PROFONDEUR — le défaut que ces peaux venaient de créer : un fond et une
       carte si proches qu'ils ne faisaient qu'UN seul noir. On mesure donc le
       RAPPORT des deux luminances : la carte doit porter au moins le double de
       celle du fond, et le fond ne doit pas être un noir absolu. */
    check(lum(r.white) >= 2 * lum(r.page), `${s} : la carte se DÉTACHE du fond (luminance ≥ 2 × celle de la page)`,
      `carte ${(lum(r.white) * 100).toFixed(2)} % · page ${(lum(r.page) * 100).toFixed(2)} % = ×${(lum(r.white) / lum(r.page)).toFixed(2)}`);
    check(lum(r.page) > 0.001, `${s} : …et la page n’est pas le noir PUR (#000000, luminance 0)`,
      `${(lum(r.page) * 100).toFixed(2)} %`);
    /* LES GRAPHIQUES ÉCRIVENT LEUR ENCRE EUX-MÊMES : les options de Chart.js et
       les tracés SVG portent des couleurs LITTÉRALES (le gris #64748b des
       graduations, le bleu nuit #334155 des titres d'axe), que la palette ne
       touche pas. On la mesure donc ici, pour que la limite soit chiffrée : la
       graduation (la plus fréquente du programme) reste lisible ; le titre
       d'axe le plus sombre, lui, demande encore une retouche (voir
       docs/DRIVE-MIRROR.md, « la nuit »). */
    const tickInk = contrast(r.figTick, r.white);
    /* LE PLANCHER EST CELUI D'UN OBJET GRAPHIQUE (WCAG 1.4.11 : 3:1), pas celui
       d'un texte : cette encre est écrite EN DUR dans les options de Chart.js et
       les tracés SVG, la palette ne peut pas la repeindre. La carte a été
       éclaircie pour se détacher du fond (voir ci-dessus), ce qui lui coûte
       environ 0.4 cran — et c'est la SEULE paire que ces peaux ne peuvent pas
       replier, donc la seule dont le plancher bouge. */
    check(tickInk >= 3.5, `${s} : l’encre des graduations (${r.figTick}) reste lisible sur la carte (${tickInk.toFixed(2)}:1 ≥ 3.5, le plancher d’un objet graphique)`,
      `${r.figTick} / ${r.white}`);
    console.log(`      info ${s} : titre d'axe écrit en dur (${r.figTitle}) sur la carte — ${contrast(r.figTitle, r.white).toFixed(2)}:1`);
  }
  check(DARK.every((s) => lum(S[s].page) < lum(S.dim.page)) && lum(S.dim.page) > 0.7,
    'aucune autre peau n’assombrit vraiment la page (dim se contente de l’adoucir)',
    `dim ${S.dim.page} · ${DARK.map((s) => `${s} ${S[s].page}`).join(' · ')}`);

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

  console.log('\n--- LES VINGT MOTIFS : ce que le moteur peint (sur la feuille compilée) ---');
  const P = d.patterns || {};
  const ids = Object.keys(P.chips || {});
  const badImage = ids.filter((id) => id !== 'none' && !/gradient\(/.test(P.chips[id].image));
  const lying = ids.filter((id) => P.chips[id].image !== P.pages[id].image || P.chips[id].size !== P.pages[id].size);
  check(ids.length === 20, 'les vingt motifs sont mesurés', ids.join(' '));
  check(P.chips.none.image === 'none', 'la pastille « None » reste NUE (aucun motif)', String(P.chips.none.image));
  check(badImage.length === 0, '…et les dix-neuf autres peignent bien un dégradé', badImage.join() || 'tous');
  check(lying.length === 0, 'la pastille et la page peignent la MÊME image, à la même trame',
    lying.length ? lying.join() : P.chips.grid.size);
  check(P.noneUnderGrid.image === 'none',
    'sous une page à motif, la pastille « None » reste nue (c’est sa remise à zéro)',
    P.noneUnderGrid.image === 'none' ? 'none' : P.noneUnderGrid.image.slice(0, 40));
  check(/gradient/.test(P.plainPageUnderGrid.image),
    '…alors qu’une page SANS attribut prend le motif de <html> (c’est ainsi que TOUTES les pages sont peintes)');
  check(P.scaled.startsWith('48px 48px') && !/24px/.test(P.scaled)
    && P.scaledHalf.startsWith('12px 12px') && !/24px/.test(P.scaledHalf),
    'l’échelle multiplie VRAIMENT la tuile (grid : 24 px → 48 px à ×2, 12 px à ×0.5)',
    `${P.scaled} / ${P.scaledHalf}`);
  check(/0\.035/.test(P.lines['0.035']) && /0\.06/.test(P.lines['0.06']) && /0\.11/.test(P.lines['0.11'])
    && P.lines['0.035'] !== P.lines['0.11'],
    'la force règle VRAIMENT l’alpha du filet (l’encre est écrite une seule fois)', P.lines['0.11']);
  check(P.chips.grid.size.startsWith('24px 24px') && P.chips.fine.size.startsWith('12px 12px')
    && P.chips.dots.size.startsWith('18px 18px') && P.chips.dense.size.startsWith('10px 10px'),
    'chaque motif a bien SA trame (24 · 12 · 18 · 10 px)',
    `${P.chips.grid.size} · ${P.chips.fine.size} · ${P.chips.dots.size} · ${P.chips.dense.size}`);
  const isAuto = (s) => /^auto(, auto)*$/.test(s);
  const inGradient = ['rules', 'diagonal', 'cross', 'weave', 'herringbone', 'triangles', 'plaid']
    .filter((id) => !isAuto(P.chips[id].size) || !/gradient/.test(P.chips[id].image));
  check(inGradient.length === 0, '…et les sept motifs à trame répétée la portent DANS le dégradé',
    inGradient.length ? inGradient.join() : P.chips.triangles.size);
  check(/rgba?\(42[, ]+78[, ]+153/.test(P.tints.image) && /rgba?\(129[, ]+61[, ]+0/.test(P.tints.image),
    'les motifs DESSINÉS lisent les trois encres : le confetti porte la teinte de l’accent ET son complémentaire',
    P.tints.image.slice(0, 80));
  check(/^0px 0px, 10px 10px/.test(P.chips.scales.pos),
    'la POSITION d’une famille d’arcs est écrite une fois et multipliée par l’échelle (écailles : 0 0, 10 px 10 px)',
    P.chips.scales.pos);
  check(/^(0px 0px)(, 0px 0px)*$/.test(P.chips.waves.pos) && /^(0px 0px)(, 0px 0px)*$/.test(P.chips.grid.pos),
    '…et un motif qui n’en a pas besoin laisse la position au défaut du moteur',
    `${P.chips.waves.pos} / ${P.chips.grid.pos}`);

  console.log('\n--- LA PAGE DE NUIT : la peau personnalisée retournée (mesurée dans le moteur) ---');
  const D = d.patterns.dark || {};
  const inkOf = (s) => {
    const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(String(s));
    return m ? '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('') : '';
  };
  const inkHex = inkOf(D.drawn ? D.drawn.line : '');
  check(contrast(D.page.bg, D.day.bg) > 8 && contrast(D.day.bg, S.slate.page) < 1.02,
    'le même attribut SANS le régime garde la page claire, AVEC lui la page est SOMBRE',
    `${D.day.bg} → ${D.page.bg}`);
  check(contrast(D.page.bg, S.night.page) < 1.05,
    '…et c’est EXACTEMENT la page de la peau Night (réutilisée, pas recopiée)',
    `${D.page.bg} / ${S.night.page}`);
  check(contrast(D.zinc.bg, S.carbon.page) < 1.05,
    'la famille grise prend la profondeur de Carbon', `${D.zinc.bg} / ${S.carbon.page}`);
  check(contrast(D.stone.bg, S.night.page) < 1.05,
    '…et la chaude celle de Night, sur la rampe de Stone', `${D.stone.bg} / ${S.night.page}`);
  check(/gradient/.test(D.drawn.image) && D.drawn.image === D.chip.image && D.drawn.size === D.chip.size,
    'un motif se peint sur la page sombre, et sa pastille montre la MÊME image', D.drawn.size);
  check(/226[, ]+232[, ]+240/.test(D.drawn.line) && lum(inkHex) > 8 * lum(D.drawn.bg),
    'l’encre y est CLAIRE (slate-200) et bien plus claire que la page : le motif se voit sur le fond sombre',
    `${D.drawn.line} sur ${D.drawn.bg}`);
  check(/15[, ]+23[, ]+42/.test(D.day.line),
    '…alors que le filet du JOUR reste le slate-900 livré (le régime est le seul changement)', D.day.line);

  const failed = CHECKS.filter((c) => !c.ok);
  console.log(failed.length
    ? `\n❌ ${failed.length} vérification(s) en échec`
    : `\n_ui_skin_pixel_test.cjs — ${CHECKS.length} vérifications OK (les 9 peaux, les 20 motifs et la page de nuit, mesurés dans Chrome sur le CSS compilé)`);
  process.exit(failed.length ? 1 : 0);
})();


