/* ==========================================================================
   _viewer_ray_shadow_resize_test.cjs — L'OMBRE QUAND LE CADRE CHANGE DE TAILLE.

   LE RAPPORT DE CETTE SESSION : « as soon as I click on the MD window (without
   running it) or "structure calculation" (without even running it), this strange
   shadow detached from the molecule appears ».

   CE QUE CETTE SONDE MESURE, ET POURQUOI ELLE EXISTE
   La politique du pilote se mesure sans navigateur (_viewer_ray_shadow_live_test.mjs,
   §f : une image rendue sur une taille nouvelle refait le masque TOUT DE SUITE) —
   mais elle ne peut pas dire CE QUE L'ŒIL VOIT. Ici, une vraie scène NGL 2.4 dans
   une vraie rangée (un dock de gauche, la vue qui garde le reste) répond à la seule
   question qui compte : l'ombre tombe-t-elle encore SUR la molécule ?

   LA MESURE — deux centres de gravité dans les pixels AFFICHÉS de la boîte :
     · la MOLÉCULE, projetée par `camera.clip` (la même matrice que le masque) ;
     · L'OMBRE, le centre de gravité du dernier masque peint, ramené par la taille
       CSS de la couche (c'est là qu'elle est étirée).
   Leur écart est un décalage de projection (la lampe) : constant tant que la couche
   tombe juste. Ce qui juge, c'est sa STABILITÉ.

   LES TROIS INSTANTS (voir l'en-tête de la page) :
     1. la scène posée : la couche n'est pas étirée (stretchX = 1) ;
     2. le dock s'ouvre ET NGL est prévenu (le ResizeObserver du viewer, mesuré) :
        la toile se recale, le masque est REFAIT pour la nouvelle taille, et l'écart
        ne bouge pas (≤ 2 px) ;
     3. LE TÉMOIN NÉGATIF — la même ouverture, sans rien dire à NGL : la toile garde
        ses 900 px, la molécule ne bouge pas d'un pixel, le masque de 900 est étiré
        sur 700 (stretchX ≈ 0,78) et l'écart SAUTE de plus de 100 px. C'est le
        défaut rapporté, mesuré.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert la page, `ngl.js` (le MÊME dist UMD 2.4.0 que charge
   src/utils/ngl.js) et le SOURCE des deux modules (jamais une copie) ; Chrome joue
   le geste et la page POSTe son verdict JSON ici.

   LANCEMENT : node _viewer_ray_shadow_resize_test.cjs   (~20 s)
   Sans Chrome ni Edge sur la machine, la sonde est SAUTÉE (exit 0) — jamais verte
   en silence.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const TIMEOUT_MS = 180000;

let last = null;
let resolveResult;
const resultDone = new Promise((r) => { resolveResult = r; });

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && fs.existsSync(p))[0];

const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => res(b)); });

const SOURCES = {
  '/ngl.js': ['node_modules/ngl/dist/ngl.js', 'application/javascript'],
  /* ⚠ LES DEUX MODULES SONT SERVIS À LEUR CHEMIN DU DÉPÔT : l'import
     `./viewerRayShadows.js` de l'ombre vivante doit résoudre tout seul — c'est le
     SOURCE qui est mesuré, jamais une copie recollée. */
  '/src/utils/viewerRayShadowLive.js': ['src/utils/viewerRayShadowLive.js', 'application/javascript; charset=utf-8'],
  '/src/utils/viewerRayShadows.js': ['src/utils/viewerRayShadows.js', 'application/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, '_viewer_ray_shadow_resize_page.html')));
  if (SOURCES[url.pathname]) {
    const [file, type] = SOURCES[url.pathname];
    return send(200, type, fs.readFileSync(path.join(ROOT, file)));
  }
  if (url.pathname === '/result') {
    const raw = await readBody(req);
    try { last = JSON.parse(raw); } catch (e) { last = { stage: 'fatal', parseError: String(e), raw: raw.slice(0, 300) }; }
    process.stdout.write('   [sonde] ' + last.stage + '\n');
    if (last.stage === 'done' || last.stage === 'fatal') resolveResult(last);
    return send(200, 'text/plain', 'ok');
  }
  return send(404, 'text/plain', 'nope');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHECKS = [];
const check = (ok, label, detail) => {
  CHECKS.push({ ok: !!ok, label });
  process.stdout.write((ok ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']\n'));
};
const near = (a, b, eps) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps;
const isSize = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n));
const dist = (a, b) => (isSize(a) && isSize(b) ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null);
/* Deux listes de nombres identiques (une boîte projetée, quatre nombres) : c'est la
   preuve qu'un dessin n'a pas bougé d'un pixel — donc pas un `dist`, qui ne sait
   comparer que deux points. */
const sameBox = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => Math.abs(v - b[i]) <= 0.01);

// ---- le verdict, écrit une fois le POST 'done' reçu --------------------------
const verdict = (r) => {
  const facts = r.facts || {};
  const results = r.results || {};
  const ready = results.ready || {};
  const fix = results.fix || {};
  const back = results.back || {};
  const defect = results.defect || {};

  console.log('\n--- CE QUE LA SONDE A LU (les nombres, jamais un chiffre inventé) ---');
  ['ready', 'fix', 'back', 'defect'].forEach((k) => console.log('  ' + k.padEnd(7) + ' ' + JSON.stringify(results[k])));

  console.log('\n--- 0. LA SCÈNE ---');
  check(facts.atoms > 0, 'la scène est chargée (une molécule à ombrer)', `atoms=${facts.atoms} canvas=${facts.canvas}`);
  check(/^900x600$/.test(String(facts.canvas || '')), 'la toile vaut la boîte de la vue (900×600 au départ)', String(facts.canvas));
  check(isSize(ready.offset), 'la première ombre est peinte et son écart à la molécule se mesure', JSON.stringify(ready.offset));

  console.log('\n--- 1. LA COUCHE EST POSÉE (rien n’est étiré) ---');
  check(ready.mask && ready.mask[0] === ready.canvas[0] && ready.mask[1] === ready.canvas[1],
    'le masque peint fait la taille de la toile : rien n’est étiré, l’ombre tombe où elle a été calculée',
    JSON.stringify({ mask: ready.mask, canvas: ready.canvas }));
  check(near(ready.stretchX, 1, 0.01), 'la couche est exactement la boîte de la toile (facteur 1)', String(ready.stretchX));

  console.log('\n--- 2. LE CADRE SE RÉTRÉCIT, NGL EST PRÉVENU (le correctif) ---');
  check(near(fix.box && fix.box[0], 700, 2), 'le dock ouvert laisse 700 px à la vue (900 − 200)', JSON.stringify(fix.box));
  check(near(fix.canvas && fix.canvas[0], 700, 2),
    '⚠ la TOILE se recale sur la nouvelle boîte : c’est `handleResize`, celui que le ResizeObserver du viewer appelle',
    JSON.stringify({ canvas: fix.canvas, box: fix.box }));
  check(fix.mask && fix.mask[0] === fix.canvas[0], '…et le masque est REFAIT pour CETTE taille', JSON.stringify({ mask: fix.mask, canvas: fix.canvas }));
  check(fix.builds > ready.builds, '…le pilote a bien refait son masque (la taille est un témoin, comme la pose)',
    `${ready.builds} → ${fix.builds}`);
  /* LA MOLÉCULE, ELLE, N'A PAS CHANGÉ DE TAILLE : la même encre en px à 900 et à
     700 (donc la même échelle), simplement translatée de la moitié de la largeur
     perdue (100 px). C'est ce qui rend la comparaison des deux écarts honnête. */
  check(dist(fix.inkSize, ready.inkSize) !== null && dist(fix.inkSize, ready.inkSize) <= 1,
    'la molécule garde EXACTEMENT la même taille à l’écran (le cadre change, pas l’encre)',
    JSON.stringify({ a900: ready.inkSize, a700: fix.inkSize }));
  check(near(fix.ink && fix.ink[0], (ready.ink ? ready.ink[0] : 0) - 100, 1.5),
    '…et elle se translate de la demi-largeur perdue (900 → 700 : 100 px)',
    JSON.stringify({ a900: ready.ink, a700: fix.ink }));
  /* ⚠ LA TOLÉRANCE EST DE 10 px, ET ELLE EST DITE : le pinceau de la pénombre est
     calculé à l'échelle DU MASQUE (voir shadowBlurScale), donc un masque plus
     étroit redistribue quelques pixels — 7 px mesurés ici sur 700. Le défaut, lui,
     en décale PLUS DE 80 : deux ordres de grandeur, jamais une nuance. */
  check(dist(fix.offset, ready.offset) !== null && dist(fix.offset, ready.offset) <= 10,
    '⚠ L’OMBRE RESTE SUR LA MOLÉCULE : l’écart ombre − molécule ne bouge que de la poignée de pixels de la pénombre (≤ 10 px)',
    JSON.stringify({ avant: ready.offset, apres: fix.offset, ecart: dist(fix.offset, ready.offset) }));

  console.log('\n--- 3. LA VUE REPREND TOUTE LA LARGEUR (toujours prévenu) ---');
  check(near(back.canvas && back.canvas[0], 900, 2) && near(back.box && back.box[0], 900, 2),
    'la toile et la boîte reviennent à 900 px', JSON.stringify({ canvas: back.canvas, box: back.box }));
  check(dist(back.offset, ready.offset) !== null && dist(back.offset, ready.offset) <= 2,
    '…et l’ombre est toujours posée sur la molécule', JSON.stringify({ ready: ready.offset, back: back.offset }));

  console.log('\n--- 4. LE TÉMOIN NÉGATIF — la même ouverture SANS le dire à NGL ---');
  check(near(defect.box && defect.box[0], 700, 2) && near(defect.canvas && defect.canvas[0], 900, 2),
    'la boîte rétrécit mais la toile garde ses 900 px : c’est le comportement d’avant le correctif',
    JSON.stringify({ box: defect.box, canvas: defect.canvas }));
  check(sameBox(defect.inkBox, back.inkBox),
    '⚠ LA MOLÉCULE N’A PAS BOUGÉ D’UN PIXEL (même boîte, même centre) : c’est donc bien l’ombre qui se détache',
    JSON.stringify({ avant: back.inkBox, apres: defect.inkBox }));
  check(defect.stretchX < 0.9,
    '…et la couche, elle, est ÉTIRÉE sur la nouvelle boîte (le masque de 900 écrasé sur 700)',
    JSON.stringify({ stretchX: defect.stretchX, mask: defect.mask, layerCss: defect.layerCss }));
  check(defect.stretchX > 0.7,
    '…du rapport exact des deux largeurs (700/900 ≈ 0,78) : le masque est mis à l’échelle, pas déplacé',
    String(defect.stretchX));
  check(dist(defect.offset, back.offset) !== null && dist(defect.offset, back.offset) > 80,
    '⚠ …et L’OMBRE SE DÉTACHE DE LA MOLÉCULE : c’est le défaut rapporté, ici mesuré (plus de 80 px de côté)',
    JSON.stringify({ avant: back.offset, apres: defect.offset, decalage: dist(defect.offset, back.offset) }));
  check(near(defect.offset && defect.offset[0], (back.offset ? back.offset[0] : 0) - 100, 8),
    '…du décalage qu’impose l’étirement (≈ −100 px : le centre de la boîte perdue)',
    JSON.stringify({ avant: back.offset, apres: defect.offset }));

  if (r.errors && r.errors.length) console.log('\n[erreurs de la page]\n' + r.errors.join('\n'));
  const bad = CHECKS.filter((c) => !c.ok);
  console.log('\n' + (bad.length
    ? `ÉCHEC  ${bad.length} assertion(s) rouge(s) sur ${CHECKS.length}`
    : `OK    ${CHECKS.length} assertions vertes`));
  console.log(`_viewer_ray_shadow_resize_test.cjs — ${CHECKS.length - bad.length}/${CHECKS.length} assertions OK (le cadre change de taille · NGL prévenu (correctif) · témoin négatif : l’ombre détachée · la couche jamais étirée)`);
  process.exit(bad.length ? 1 : 0);
};

async function main () {
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde NGL ne peut pas tourner');
    console.log('_viewer_ray_shadow_resize_test.cjs — 0 assertion (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglresize-'));
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const url = 'http://127.0.0.1:' + port + '/probe';
  console.log('chrome : ' + CHROME);
  console.log('sonde  : ' + url + '\n');

  const errs = [];
  const child = spawn(CHROME, [
    '--headless=new', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-extensions', '--disable-component-update', '--disable-background-networking',
    '--disable-sync', '--disable-default-apps', '--disable-features=Translate',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--user-data-dir=' + tmp, '--window-size=980,700', url,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (d) => {
    String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) { errs.push(l.trim()); if (errs.length > 60) errs.shift(); } });
  });

  const timedOut = await Promise.race([resultDone.then(() => false), sleep(TIMEOUT_MS).then(() => true)]);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  server.close();

  if (timedOut) {
    console.log("\nÉCHEC  la sonde n'a pas rendu son verdict en " + (TIMEOUT_MS / 1000) + ' s');
    console.log('       dernière étape vue : ' + (last ? last.stage : '(aucun POST reçu)'));
    if (errs.length) console.log('--- stderr de Chrome ---\n' + errs.join('\n'));
    process.exit(1);
  }
  if (!last || last.stage === 'fatal') {
    console.log('\nÉCHEC  la sonde a échoué');
    if (last && last.errors && last.errors.length) console.log(last.errors.join('\n'));
    else if (errs.length) console.log('--- stderr de Chrome ---\n' + errs.join('\n'));
    process.exit(1);
  }
  verdict(last);
}

main().catch((e) => {
  console.log('ÉCHEC  ' + ((e && e.stack) || e));
  process.exit(1);
});
