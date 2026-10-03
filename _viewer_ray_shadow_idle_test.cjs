/* ==========================================================================
   _viewer_ray_shadow_idle_test.cjs — L'OMBRE VIVANTE QUAND RIEN NE BOUGE.

   LE RAPPORT : « the auto mode for live rendering of ray is good but it
   reinitializes the view even if i move the mouse without moving the molecule ».

   CE QUE CETTE SONDE MESURE, ET POURQUOI ELLE EXISTE
   La politique du pilote se mesure sans navigateur
   (_viewer_ray_shadow_live_test.mjs) — mais elle ne peut pas dire QUELLES
   IMAGES NGL LUI PARVIENNENT. Le pilote s'accroche au signal `rendered` : si NGL
   rend une image alors que RIEN n'a bougé (la souris passe, un picking, un
   repaint de l'application), la politique doit répondre « rien à faire ». C'est
   cette chaîne-là — NGL → signal → pilote → masque — que la sonde met sur une
   VRAIE scène NGL 2.4 et de VRAIS événements de souris :

     1. LA SOURIS PASSE (mousemove sans bouton, avec des pauses qui franchissent
        `idleMs` ET `staleMs`) : la pose et les coordonnées des atomes sont
        comparées avant/après, et le compte des reconstructions du masque doit
        être ZÉRO. C'est la demande de la session, mesurée.

     2. LE TÉMOIN DU GESTE : la scène bouge vraiment (le groupe de translation,
        comme un glisser) → l'ombre DOIT être refaite, et repartir du BROUILLON
        (le régime `auto` pendant le geste), puis se durcir à l'arrêt.

     3. LE TÉMOIN DU FILET : des ATOMES bougent sans que la caméra ni la
        signature ne changent (le cas que le filet couvre) → l'ombre DOIT finir
        par les suivre — et dans le RÉGIME DU REPOS (`full`), pas en brouillon :
        une image rendue pour rien ne doit pas faire clignoter la qualité.

     4. LA DYNAMIQUE QUI ÉCRIT, ET QUI LE DIT (`moved()`). LE RAPPORT DE CETTE
        SESSION : « when I start a MD run the shadow detaches from the molecule and
        remains detached ». Une ▶ MD n'écrit que des COORDONNÉES : la pose et la
        signature de la scène ne bougent pas, donc l'image qu'elle demande était
        jugée « rendue pour rien », le filet ne la regardait qu'au plus une fois par
        `staleMs`, et la DERNIÈRE écriture tombait dans cette fenêtre — après quoi
        plus rien n'est rendu : la couche restait sur la géométrie d'avant. La page
        joue le geste comme le viewer (`pilot.moved()` après chaque écriture) et le
        verdict est le SEUL qui compte : le dernier masque peint tombe sur la
        géométrie d'ARRIVÉE (écart en pixels de son centre de gravité), la passe
        nette étant venue d'une MINUTERIE — aucune image n'étant rendue après la
        dernière écriture.

     5. LE TÉMOIN NÉGATIF : la MÊME dynamique, sans le mot du geste. Aucun
        brouillon, et la couche RESTE à côté : le défaut rapporté, mesuré.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert la page, `ngl.js` (le MÊME dist UMD 2.4.0 que charge
   src/utils/ngl.js) et le SOURCE des deux modules (jamais une copie) ; Chrome
   joue le geste et la page POSTe son verdict JSON ici.

   LANCEMENT : node _viewer_ray_shadow_idle_test.cjs   (~20 s)
   Sans Chrome ni Edge sur la machine, la sonde est SAUTÉE (exit 0) — jamais
   verte en silence.
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
  /* ⚠ LE MODULE VIVANT EST SERVI À SON CHEMIN DU DÉPÔT : son
     `import './viewerRayShadows.js'` doit résoudre tout seul — c'est le SOURCE
     qui est mesuré, jamais une copie recollée. */
  '/src/utils/viewerRayShadowLive.js': ['src/utils/viewerRayShadowLive.js', 'application/javascript; charset=utf-8'],
  '/src/utils/viewerRayShadows.js': ['src/utils/viewerRayShadows.js', 'application/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, '_viewer_ray_shadow_idle_page.html')));
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
  send(404, 'text/plain', 'nope');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHECKS = [];

async function main () {
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde NGL ne peut pas tourner');
    console.log('_viewer_ray_shadow_idle_test.cjs — 0 assertions (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglidle-'));
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
    if (last && last.log) console.log(last.log.slice(-12).join('\n'));
    process.exit(1);
  }
  if (!last || last.stage === 'fatal') {
    console.log("\nÉCHEC  la sonde a échoué :");
    if (last && last.log) console.log(last.log.slice(-12).join('\n'));
    if (last && last.errors && last.errors.length) console.log(last.errors.slice(-4).join('\n'));
    console.log(errs.slice(-6).join('\n'));
    process.exit(1);
  }

  const f = last.facts || {};
  const r = last.results || {};
  console.log('\n--- 1. LA SCÈNE ET LA PREMIÈRE OMBRE ---');
  check(f.atoms > 0, 'la scène porte des atomes', String(f.atoms));
  check(!!f.canvas && /^\d+x\d+$/.test(f.canvas), 'NGL a une toile de rendu', String(f.canvas));
  check(r.attach && r.attach.error === '', "le pilote peint la première ombre sans erreur", JSON.stringify(r.attach && r.attach.error));
  check(r.attach && r.attach.builds === 1 && r.attach.fulls === 1,
    'la première ombre est NETTE (aucun geste n a eu lieu)', JSON.stringify(r.attach));
  check(r.attach && r.attach.painted > 0, '…et elle couvre des pixels du masque', String(r.attach && r.attach.painted));

  console.log('\n--- 2. LA SOURIS PASSE, LA MOLÉCULE NE BOUGE PAS (le rapport) ---');
  const m = r.mouse || {};
  console.log('   images NGL rendues pendant le geste : ' + m.renders + ' · survols signalés : ' + m.hovers);
  check(m.poseMoved === false, 'la caméra n a PAS bougé pendant les mousemove', JSON.stringify({ poseMoved: m.poseMoved }));
  check(m.atomsMoved === false, '…et aucun atome n a bougé non plus', JSON.stringify({ atomsMoved: m.atomsMoved }));
  check(m.builds === 0,
    'AUCUNE reconstruction du masque : une souris qui passe ne réinitialise plus la vue',
    JSON.stringify({ builds: m.builds, drafts: m.drafts, fulls: m.fulls, renders: m.renders }));

  console.log('\n--- 3. LE TÉMOIN DU GESTE (la scène bouge vraiment) ---');
  const g = r.sceneMove || {};
  check(g.builds >= 1, 'la scène déplacée refait l ombre', JSON.stringify(g));
  check(g.drafts >= 1, '…en BROUILLON pendant le geste (le régime `auto`)', JSON.stringify(g));
  check(g.mode === 'full', '…puis la passe NETTE de l arrêt', String(g.mode));

  console.log('\n--- 4. LE TÉMOIN DU FILET (des atomes bougent sans la caméra) ---');
  const a = r.atomMove || {};
  check(a.earlyBuilds === 0,
    'dans la fenêtre du filet (staleMs), une image rendue ne regarde même pas',
    JSON.stringify({ earlyBuilds: a.earlyBuilds }));
  check(a.builds >= 1,
    'des atomes déplacés finissent par être suivis : le filet garde son travail',
    JSON.stringify(a));
  check(a.drafts === 0 && a.netMode === 'full',
    '…et il les suit DANS LE RÉGIME DU REPOS (aucun brouillon pour une image rendue hors geste)',
    JSON.stringify({ drafts: a.drafts, netMode: a.netMode }));

  /* ---- 5/6. LA DYNAMIQUE : le geste DIT par celui qui écrit, et son témoin
     négatif. Le rapport de cette session : « when I start a MD run the shadow
     detaches from the molecule and remains detached ». */
  console.log('\n--- 5. L\'ÉCRITURE DE LA DYNAMIQUE (le geste dit : moved()) ---');
  const md = r.mdWrite || {};
  check(md.atomsMoved === true && md.poseMoved === false,
    'la dynamique a écrit des COORDONNÉES sans toucher à la caméra (c\'est le cas du rapport)',
    JSON.stringify({ atomsMoved: md.atomsMoved, poseMoved: md.poseMoved }));
  check(md.renders > 0, 'ses écritures ont bien demandé des images', String(md.renders));
  check(md.drafts >= 1,
    'l\'image rendue qui suit une écriture est un GESTE : la couche est repeinte en BROUILLON pendant le mouvement',
    JSON.stringify({ drafts: md.drafts, builds: md.builds, fulls: md.fulls }));
  check(md.mode === 'full' && md.fulls >= 1,
    '…puis la passe NETTE de l\'arrêt arrive', JSON.stringify({ mode: md.mode, fulls: md.fulls }));
  check(md.sharpDelayMs !== null && md.sharpDelayMs >= md.idleWindow,
    '…et elle est arrivée APRÈS `idleMs` : c\'est la MINUTERIE de l\'arrêt, pas une image rendue (qui serait là dans la frame)',
    JSON.stringify({ sharpDelayMs: md.sharpDelayMs, idleMs: md.idleWindow, rendersAfterWrites: md.rendersAfterWrites }));
  check(md.gapPx !== null && md.gapPx <= 2,
    '…si bien que l\'ombre FINIT POSÉE sur la molécule (écart du centre de gravité du dernier masque peint, en px)',
    JSON.stringify({ gapPx: md.gapPx, painted: md.paintedSize, fresh: md.freshSize }));

  console.log('\n--- 6. LE TÉMOIN NÉGATIF (la même dynamique SANS le mot du geste) ---');
  const st = r.mdStale || {};
  check(st.atomsMoved === true && st.poseMoved === false,
    'les coordonnées ont bougé, la caméra non', JSON.stringify({ atomsMoved: st.atomsMoved, poseMoved: st.poseMoved }));
  check(st.ms < st.staleWindow,
    '⚠ le témoin négatif a tenu DANS la fenêtre du filet (sinon il ne mesurerait plus rien)',
    JSON.stringify({ ms: st.ms, staleMs: st.staleWindow }));
  check(st.drafts === 0,
    'sans le mot du geste, aucune image n\'est traitée comme un GESTE : aucun brouillon, la couche ne suit pas le mouvement',
    JSON.stringify({ builds: st.builds, drafts: st.drafts, fulls: st.fulls, renders: st.renders }));
  check(st.gapPx !== null && st.gapPx > 2,
    '…et elle RESTE détachée : la couche garde la géométrie d\'avant (le « remains detached » du rapport)',
    JSON.stringify({ gapPx: st.gapPx, painted: st.paintedSize, fresh: st.freshSize }));

  const bad = CHECKS.filter((c) => !c.ok);
  console.log('\n' + (bad.length
    ? `ÉCHEC  ${bad.length} assertion(s) rouge(s) sur ${CHECKS.length}`
    : 'OK    ' + CHECKS.length + ' assertions vertes'));
  console.log(`_viewer_ray_shadow_idle_test.cjs — ${CHECKS.length - bad.length}/${CHECKS.length} assertions OK (souris qui passe · geste · filet · la dynamique qui ÉCRIT (moved) · son témoin négatif)`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.log('ÉCHEC  ' + ((e && e.stack) || e));
  process.exit(1);
});

const check = (ok, label, detail) => {
  CHECKS.push({ ok: !!ok, label });
  process.stdout.write((ok ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};
