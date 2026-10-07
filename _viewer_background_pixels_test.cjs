/* ==========================================================================
   _viewer_background_pixels_test.cjs — LE FOND DU VIEWER, MESURÉ.

   LA DEMANDE DE CETTE SESSION : « in the background of the viewer allow gradients
   of two colors and their direction (clicking on background should display the
   options underneath and disappear when background is clicked again) ».

   POURQUOI IL EXISTE. _viewer_background_test.mjs relit le source et exécute les
   fonctions pures : il prouve la RAMPE et le CÂBLAGE. Trois faits, pourtant, ne
   se lisent nulle part — il faut les MESURER, dans un vrai navigateur :
     1. le fond d'un canvas NGL est bien du CSS : `setBackground` pose la couleur
        en `style.backgroundColor` et vide la toile d'ALPHA ZÉRO. C'est ce fait
        qui rend un dégradé CSS gratuit (aucune scène touchée, aucune
        représentation rebâtie) — et c'est tout l'argument de la fonctionnalité ;
     2. un clic sur le FOND arrive à `stage.signals.clicked` avec un pickingProxy
        SANS atome : c'est la branche du viewer qui ouvre (puis, une seconde fois,
        referme) le panneau. Si NGL n'y dispatchait rien, le panneau ne
        s'ouvrirait jamais ;
     3. la rampe PEINTE est celle des deux couleurs et de la direction demandées :
        le module peint une toile 2D (le fond d'un film 🎬🎞) et pose la rampe SOUS
        un PNG transparent (le fond du ✨ Ray). Les pixels le disent.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert à Chrome en `--headless=new` (WebGL par SwiftShader)
   _viewer_background_pixels_page.html, `ngl.js` (le MÊME dist UMD 2.4.0 que le
   CDN que charge src/utils/ngl.js) et src/utils/viewerBackground.js SERVI COMME
   MODULE — c'est le vrai fichier qui peint, jamais une copie. La page POSTe son
   verdict JSON ici ; les deux PNG de la sonde restent sur le disque pour l'œil
   (_tmp_bg_probe_film.png / _tmp_bg_probe_still.png, ignorés par git).

   LANCEMENT : node _viewer_background_pixels_test.cjs   (≈10 s)
   Sans Chrome ni Edge sur la machine, la sonde est SAUTÉE (exit 0) — jamais
   verte en silence.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
/* Plafond sous les 180 s de _run_all.cjs : une sonde bloquée doit se plaindre
   ELLE-MÊME (dernière étape vue + stderr de Chrome), pas être tuée sans un mot. */
const TIMEOUT_MS = 120000;

let last = null;
const saved = [];
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, '_viewer_background_pixels_page.html')));
  if (url.pathname === '/ngl.js') return send(200, 'application/javascript', fs.readFileSync(path.join(ROOT, 'node_modules/ngl/dist/ngl.js')));
  /* LE VRAI MODULE, servi tel quel : c'est lui qui peint dans la page. */
  if (url.pathname === '/bg.js') return send(200, 'application/javascript; charset=utf-8', fs.readFileSync(path.join(ROOT, 'src/utils/viewerBackground.js')));
  if (url.pathname === '/save') {
    const b64 = (await readBody(req)).replace(/^data:image\/png;base64,/, '');
    const f = path.join(ROOT, '_tmp_bg_probe_' + (url.searchParams.get('name') || 'x') + '.png');
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    saved.push(path.basename(f));
    return send(200, 'text/plain', 'ok');
  }
  if (url.pathname === '/result') {
    const raw = await readBody(req);
    try { last = JSON.parse(raw); } catch (e) { last = { stage: 'fatal', parseError: String(e), raw: raw.slice(0, 300) }; }
    process.stdout.write('   [sonde] ' + last.stage + '\n');
    if (last.stage === 'done' || last.stage === 'fatal') resolveResult(last);
    return send(200, 'text/plain', 'ok');
  }
  send(404, 'text/plain', 'nope');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHECKS = [];
const check = (ok, label, detail) => {
  CHECKS.push({ ok: !!ok, label });
  process.stdout.write((ok ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};

async function main () {
  /* Pas de navigateur, pas de sonde : on SAUTE (exit 0) pour que _run_all.cjs
     reste vert sur une machine sans Chrome, mais on le DIT — un saut silencieux
     ferait croire que les pixels ont été vérifiés. */
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde du fond ne peut pas tourner');
    console.log('_viewer_background_pixels_test.cjs — 0 assertions (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglbg-'));
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
    '--user-data-dir=' + tmp, '--window-size=520,560', url,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (d) => {
    String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) { errs.push(l.trim()); if (errs.length > 60) errs.shift(); } });
  });

  const timedOut = await Promise.race([resultDone.then(() => false), sleep(TIMEOUT_MS).then(() => true)]);
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  server.close();

  if (timedOut) {
    console.log('\nÉCHEC  la sonde n\'a pas rendu son verdict en ' + (TIMEOUT_MS / 1000) + ' s');
    console.log('       dernière étape vue : ' + (last ? last.stage : '(aucun POST reçu)'));
    if (last && last.log) console.log('       trace page :\n' + last.log.join('\n'));
    console.log('       stderr chrome :\n' + errs.slice(-20).join('\n'));
    process.exit(1);
  }

  const d = last;
  const cs = d.cases || [];
  const byId = (id) => cs.find((c) => c.id === id) || {};
  const film = byId('film').film || {};
  const canvasProbe = byId('canvas').probe || {};
  const click = byId('click').click || {};
  const still = byId('still').still || {};
  const px = (p) => (p ? p.slice(0, 3).join(',') : '—');
  const nearHex = (p, hex, tol = 2) => {
    if (!p || !hex) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return Math.max(Math.abs(p[0] - r), Math.abs(p[1] - g), Math.abs(p[2] - b)) <= tol;
  };

  console.log('--- verdict ---');
  check(d.stage === 'done', 'la sonde va au bout (stage = done)', d.stage);
  check(cs.length === 4, 'les quatre cas ont été mesurés (film · canvas · clic · still)', String(cs.length));

  console.log('\n--- 1. la rampe PEINTE (une toile 2D = le fond d’un film 🎬🎞) ---');
  check(film.painted === true, 'le module PEINT une rampe allumée', String(film.painted));
  check(nearHex(film.top, '#ff0000'), 'le bord du HAUT est la couleur A (rouge)', px(film.top));
  check(nearHex(film.bottom, '#0000ff'), 'le bord du BAS est la couleur B (bleu)', px(film.bottom));
  check(film.middle && film.middle[0] > 100 && film.middle[0] < 155 && film.middle[2] > 100 && film.middle[2] < 155,
    'le MILIEU est entre les deux (la rampe est continue, pas deux aplats)', px(film.middle));
  check(nearHex(film.left, '#ff0000') && nearHex(film.right, '#0000ff'),
    'LA DIRECTION est bien celle demandée : à 90° c’est la gauche qui est A', px(film.left) + ' → ' + px(film.right));
  check(film.solidPainted === false, 'sans rampe, le module ne peint RIEN (le film uni d’avant)');
  check(film.solidPixel && film.solidPixel[3] === 0, '…la toile reste VIDÉE (alpha 0, aucun pixel écrit)', px(film.solidPixel));

  console.log('\n--- 2. le canvas NGL : le fond est du CSS, la toile est transparente ---');
  check(canvasProbe.clearAlpha === 0,
    'la toile WebGL est vidée d’ALPHA ZÉRO — c’est ce qui laisse voir le fond derrière elle', String(canvasProbe.clearAlpha));
  check(canvasProbe.cssBgHex === '#ff0000',
    'NGL a posé sa couleur en CSS sur le canvas (`style.backgroundColor`)', String(canvasProbe.cssBg));
  check(String(canvasProbe.canvasCss).replace(/\s/g, '') === 'rgb(255,0,0)',
    '…et c’est bien la couleur demandée (la couleur A du viewer)', String(canvasProbe.canvasCss));
  check(String(canvasProbe.computed).indexOf('linear-gradient') === 0,
    'la rampe du module devient une `background-image` du moteur', String(canvasProbe.computed).slice(0, 70));
  /* ⚠ 180° est la direction PAR DÉFAUT du CSS : Chrome peut l'écrire ou l'omettre
     (« linear-gradient(rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%) » = le bas). Les
     deux formes disent la même chose — et le cas à 90° ci-dessous prouve que
     l'angle n'est PAS perdu quand il n'est pas le défaut. */
  check(canvasProbe.computedAngle === '180' || canvasProbe.computedAngle == null,
    '…la direction d’origine (180° : du haut vers le bas), écrite ou omise (Chrome l’omet : c’est son défaut)',
    String(canvasProbe.computedAngle) + ' · ' + String(canvasProbe.computed));
  check(String(canvasProbe.computedRightAngle) === '90',
    '…et une direction NON par défaut arrive TELLE QUELLE au moteur (90° : de gauche à droite)',
    String(canvasProbe.computedRight));
  check((canvasProbe.computedColours || []).join(' ') === '#ff0000 #0000ff'
    && (canvasProbe.rightColours || []).join(' ') === '#ff0000 #0000ff',
    '…et ses DEUX extrémités sont exactement A et B, dans les deux directions',
    JSON.stringify(canvasProbe.computedColours) + ' / ' + JSON.stringify(canvasProbe.rightColours));
  check(canvasProbe.computedCount === 2, '…deux arrêts, pas trois : la rampe est celle de nos deux couleurs', String(canvasProbe.computedCount));
  check(canvasProbe.offComputed === 'none',
    'rampe ÉTEINTE : aucune image de fond, la couleur d’NGL reste seule', String(canvasProbe.offComputed));

  console.log('\n--- 3. le CLIC sur le fond (le geste du panneau) ---');
  check(click.clicks === 2, 'les deux clics sur le FOND arrivent au signal `clicked` d’NGL', String(click.clicks));
  check(click.emptyClicks === 2 && click.atomsClicked === 0,
    '…tous les deux SANS atome : c’est la branche qui ouvre le panneau (puis le referme)',
    click.emptyClicks + ' vide(s) / ' + click.atomsClicked + ' sur un atome');
  check(click.afterFirst && click.afterFirst.clicks === 1 && click.afterFirst.emptyClicks === 1,
    'le PREMIER clic ouvre donc bien le panneau (un état, un clic, un basculement)', JSON.stringify(click.afterFirst));
  check(Array.isArray(click.rect) && click.rect[2] > 0 && click.rect[3] > 0,
    'la vue avait une taille au moment du clic', JSON.stringify(click.rect));

  console.log('\n--- 4. la still ✨ RAY : la rampe SOUS un PNG transparent ---');
  check(still.made === true, 'la composition rend un NOUVEAU PNG', String(still.made));
  check(still.type === 'image/png', '…au bon type', String(still.type));
  check(still.moleculeOk === true, 'la « molécule » garde ses pixels (la rampe ne la recouvre pas)', px(still.molecule));
  check(still.topOk === true, 'le fond transparent a pris la couleur A (rouge)', px(still.top));
  check(still.bottomOk === true, '…et la couleur B en bas (bleu)', px(still.bottom));
  check(still.plain === true, 'sans rampe, la composition ne fait rien (la still reste celle du rendu)', String(still.plain));
  check(saved.length === 2, 'les deux PNG sont sur le disque pour l’œil humain', saved.join(' '));

  console.log('\n--- relevé ---');
  console.log('   film   haut=' + px(film.top).padEnd(14) + ' milieu=' + px(film.middle).padEnd(14) + ' bas=' + px(film.bottom).padEnd(14) +
    ' gauche=' + px(film.left).padEnd(14) + ' droite=' + px(film.right));
  console.log('   canvas clearAlpha=' + String(canvasProbe.clearAlpha).padEnd(4) + ' css=' + String(canvasProbe.cssBg).padEnd(18) +
    ' computed=' + String(canvasProbe.computed).slice(0, 60));
  console.log('   clic   ' + JSON.stringify(click));
  console.log('   still  ' + px(still.molecule).padEnd(14) + ' haut=' + px(still.top).padEnd(14) + ' bas=' + px(still.bottom).padEnd(14) + ' type=' + String(still.type));
  (d.log || []).forEach((l) => console.log('   [page] ' + l));

  const failed = CHECKS.filter((c) => !c.ok);
  failed.forEach((f) => console.log('   ÉCHEC ' + f.label));
  console.log('total ' + CHECKS.length + ', failed ' + failed.length);
  /* La dernière ligne est celle que lisent _verify.cjs et _run_all.cjs. */
  console.log('_viewer_background_pixels_test.cjs — ' + (CHECKS.length - failed.length) + '/' + CHECKS.length + ' assertions OK' +
    (failed.length ? ' ← ÉCHECS AU-DESSUS' : ' (la rampe peinte, le fond CSS à travers une toile transparente, le clic de fond, la still du ✨ Ray : pixels réels Chrome/SwiftShader)'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* chrome tient encore le profil */ }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.log('ÉCHEC pilote : ' + (e && e.stack || e)); process.exit(1); });

