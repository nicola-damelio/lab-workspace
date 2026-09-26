/* ==========================================================================
   _viewer_surface_seethrough_pixels_test.cjs — LE SEUL GARDE-FOU QUI REGARDE DE
   VRAIS PIXELS WebGL (≈8 s, Chrome en --headless=new).

   POURQUOI IL EXISTE
   Toutes les autres suites du viewer lisent le source, ou exécutent les
   fonctions pures sur une doublure : elles prouvent la chaîne
   paramètre → rep → buffer → define GLSL. Aucune ne prouve le PIXEL, et c'est
   exactement là que le défaut vivait : NGL 2.4 dessine chaque surface
   moléculaire avec un SurfaceBuffer — un DoubleSidedBuffer (doublesided-
   buffer.ts:19-20), donc DEUX parois, avant et arrière — et
   MolecularSurfaceRepresentation met `opaqueBack` à TRUE par défaut
   (molecularsurface-representation.ts:160) ; le Buffer en tire le define
   OPAQUE_BACK (buffer.ts:553-555) dont le chunk GLSL force `gl_FragColor.a` à 1
   sur les faces détournées de la caméra. Une surface à opacity 0.4 mélangeait
   donc sa paroi proche sur une paroi lointaine OPAQUE : elle restait un objet
   plein et le curseur Opacity ── la surface « transparente » ── n'y changeait
   rien. Le seul verdict qui compte est un pixel ; ce fichier le prend.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert trois choses à Chrome/Edge lancé en
   `--headless=new` (WebGL par SwiftShader) : _viewer_surface_seethrough_
   pixels_page.html, `ngl.js` (le MÊME dist UMD 2.4.0 que le CDN que charge
   src/utils/ngl.js) et le source du viewer — pour que la page LISE la constante
   SEE_THROUGH_SURFACE au lieu de la recopier. La page rend huit fois une même
   molécule avec la même caméra et POSTe son verdict JSON ici — pas de CDP, pas
   de socket. Les huit PNG restent sur le disque pour l'œil humain
   (_tmp_surface_probe_<cas>.png, ignorés par git).

   LES QUATRE CAS HISTORIQUES (même molécule, même caméra)
     opaque1           opacity 1                        → la surface pleine
     transparent40     opacity .4 (+ transparent)       → le défaut NGL (OPAQUE_BACK)
     seeThrough40      opacity .4 + SEE_THROUGH_SURFACE → ce que le viewer demande
     opaqueBackTrue40  opacity .4 + opaqueBack:true     → témoin du défaut
   Le verdict tient dans trois mesures : la luminance du centre (le blanc du
   fond traverse la paroi arrière — 184.4 contre 161.9), le bleu délavé vers le
   blanc (écart bleu−rouge 97 contre 128) et la luminance de TOUT le blob
   (165.8 contre 118.1) ; plus l'égalité stricte entre le témoin
   `opaqueBack: true` et le défaut NGL, qui prouve que la sonde mesure bien ce
   qu'elle croit mesurer. Le define OPAQUE_BACK est relu sur le buffer ARRIÈRE
   (le DoubleSidedBuffer délègue `.parameters` et garde `.frontBuffer` /
   `.backBuffer`), c'est là qu'il opacifiait le fond.

   …ET DEUX PAIRES POUR « TRANSP 0 % », qui est le SECOND rapport de la même
   famille : « it is now very good for transparency but even if I set
   transparency to 0 %, it remains a bit transparent ». À 0 % la rangée demande
   opacity 1, mais le preset « glass » réécrivait 0.45 sur ses reps
   (applyMaterialToRep) APRÈS le curseur et à chaque reconstruction : le fond
   traversait encore la surface. Chaque paire rend LE MÊME cas deux fois, même
   molécule, même caméra, seul le FOND change (blanc puis rouge) — un écart du
   centre entre les deux est donc l'alpha qui reste :
     glassImposed_white / _red    opacity 1 PUIS l'opacité du preset (TÉMOIN du
                                  défaut : écart 112)
     glassMaterial_white / _red   opacity 1 puis la seule FORME du preset
                                  (« glass » = roughness 0.08 / metalness 0.0) →
                                  ce que le viewer envoie maintenant : écart 0

   LANCEMENT : node _viewer_surface_seethrough_pixels_test.cjs
   Elle tourne en ~8 s, donc elle est AUSSI dans _verify.cjs (la liste rapide des
   suites du viewer) et _run_all.cjs la reprend. Sans Chrome ni Edge sur la
   machine, la sonde est SAUTÉE (exit 0) — jamais verte en silence.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
/* Plafond volontairement sous les 180 s de _run_all.cjs : une sonde bloquée doit
   se plaindre ELLE-MÊME (dernière étape vue + stderr de Chrome), pas être tuée
   par le lanceur avec un exit code muet. */
const TIMEOUT_MS = 150000;

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
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, '_viewer_surface_seethrough_pixels_page.html')));
  if (url.pathname === '/ngl.js') return send(200, 'application/javascript', fs.readFileSync(path.join(ROOT, 'node_modules/ngl/dist/ngl.js')));
  if (url.pathname === '/viewer-source') return send(200, 'text/plain; charset=utf-8', fs.readFileSync(path.join(ROOT, 'src/components/NMRMoleculeViewer.jsx')));
  if (url.pathname === '/save') {
    const b64 = (await readBody(req)).replace(/^data:image\/png;base64,/, '');
    const f = path.join(ROOT, '_tmp_surface_probe_' + (url.searchParams.get('name') || 'x') + '.png');
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
     reste vert sur une machine sans Chrome, mais on le dit en clair — un saut
     silencieux ferait croire que les pixels ont été vérifiés. */
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde WebGL ne peut pas tourner');
    console.log('_viewer_surface_seethrough_pixels_test.cjs — 0 assertions (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglprobe-'));
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
  const o = byId('opaque1');
  const b = byId('transparent40');
  const s = byId('seeThrough40');
  const t = byId('opaqueBackTrue40');
  const img = (c) => c.image || {};
  const def = (c) => (c.buffer && c.buffer.defines) || {};
  const cnt = (c) => (c.buffer ? c.buffer.count : 'absente');

  console.log('--- verdict ---');
  check(d.stage === 'done', 'la sonde va au bout (stage = done)', d.stage);
  check(!!d.source && d.source.opaqueBack === false, 'SEE_THROUGH_SURFACE.opaqueBack lu à false dans NMRMoleculeViewer.jsx', JSON.stringify(d.source));
  check(cs.length === 8, 'les 8 cas ont été rendus (4 cas historiques + les 2 paires « glass » sur fond blanc et rouge)', String(cs.length));
  cs.forEach((c) => {
    check(!c.error, 'cas ' + c.id + ' : aucun jet', c.error);
    check(c.built === true, 'cas ' + c.id + ' : la rep a fini de s\'attacher au viewer', String(c.built));
    check(cnt(c) > 0, 'cas ' + c.id + ' : la surface est construite (sommets)', String(cnt(c)));
    check(img(c).w >= 200 && img(c).h >= 200, 'cas ' + c.id + ' : PNG rendu', img(c).w + 'x' + img(c).h);
  });

  console.log('\n--- paramètre → define GLSL (le défaut que la sonde corrige) ---');
  check(def(o).OPAQUE_BACK === 1, 'surface OPAQUE (opacity 1) : define OPAQUE_BACK = 1 (défaut NGL)', JSON.stringify(def(o)));
  check(def(b).OPAQUE_BACK === 1, 'surface translucide SANS option : define OPAQUE_BACK = 1', JSON.stringify(def(b)));
  check(def(s).OPAQUE_BACK === undefined, 'surface AVEC SEE_THROUGH_SURFACE : plus de define OPAQUE_BACK', JSON.stringify(def(s)));
  check(def(t).OPAQUE_BACK === 1, 'témoin opaqueBack:true explicite : define OPAQUE_BACK = 1', JSON.stringify(def(t)));
  check(b.buffer && b.buffer.opaqueBack === true, 'cas translucide par défaut : le buffer porte opaqueBack = true', String(b.buffer && b.buffer.opaqueBack));
  check(s.buffer && s.buffer.opaqueBack === false, 'cas SEE_THROUGH : le buffer porte opaqueBack = false', String(s.buffer && s.buffer.opaqueBack));
  check(o.buffer && o.buffer.transparent === false, 'opacity 1 → matérial opaque', String(o.buffer && o.buffer.transparent));
  check(b.buffer && b.buffer.transparent === true, 'opacity 0.4 → matérial transparent', String(b.buffer && b.buffer.transparent));
  check(cs.every((c) => c.buffer && c.buffer.kind === 'doubleSided(front+back)'),
    'la rep attache un buffer double-face : DEUX maillages (front et back) rendus séparément, c\'est là que le fond s\'opacifie',
    JSON.stringify(cs.map((c) => c.buffer && c.buffer.kind)));
  check(cs.every((c) => c.added >= 1), 'chaque cas a bien attaché son buffer au viewer (attrape au passage)',
    JSON.stringify(cs.map((c) => c.added)));
  check((t.buffer.backDefines || {}).OPAQUE_BACK === 1, 'le buffer ARRIÈRE du témoin porte OPAQUE_BACK', JSON.stringify(t.buffer.backDefines));
  check((s.buffer.backDefines || {}).OPAQUE_BACK === undefined, 'le buffer ARRIÈRE du cas viewer n\'a plus OPAQUE_BACK', JSON.stringify(s.buffer.backDefines));

  console.log('\n--- les pixels (makeImage → PNG → luminance du centre) ---');
  check(img(o).blueSpread > img(b).blueSpread + 15, 'opacity 0.4 délave déjà la surface pleine (bleu moins saturé)', img(o).blueSpread + ' vs ' + img(b).blueSpread);
  check(img(s).centerLuma > img(b).centerLuma + 20, 'le FOND traverse la paroi arrière : centre plus clair de plus de 20', img(s).centerLuma + ' vs ' + img(b).centerLuma);
  check(Math.abs(img(t).centerLuma - img(b).centerLuma) < 4, 'opaqueBack:true explicite équivaut au défaut NGL (mêmes pixels)', img(t).centerLuma + ' vs ' + img(b).centerLuma);
  check(img(s).blueSpread < img(b).blueSpread - 10, 'le fond délave la paroi : le bleu du centre se délaie vers le blanc', img(s).blueSpread + ' vs ' + img(b).blueSpread);
  check(img(s).centerPixel[0] > img(b).centerPixel[0] + 3, 'le rouge du pixel central remonte (blanc derrière)', JSON.stringify(img(s).centerPixel) + ' vs ' + JSON.stringify(img(b).centerPixel));
  check(img(s).blobLuma > img(b).blobLuma + 8, 'sur TOUT le blob, la version du viewer laisse passer plus de blanc', img(s).blobLuma + ' vs ' + img(b).blobLuma);
  check(Math.abs(img(t).blobLuma - img(b).blobLuma) < 2, '…et le témoin reste collé au défaut sur tout le blob', img(t).blobLuma + ' vs ' + img(b).blobLuma);
  check(img(s).blobFrac > 0.05 && img(s).blobFrac < 0.95, 'le blob occupe bien une partie de l\'image (le fond est vu à côté)', String(img(s).blobFrac));
  check(saved.length === 8, 'les 8 PNG sont sur le disque pour l\'œil humain', saved.join(' '));

  /* ── « Transp 0 % » DOIT ÊTRE OPAQUE — MATÉRIAU COMPRIS ──────────────────
     Rapport : « even if I set transparency to 0 %, it remains a bit
     transparent ». À 0 % la rangée demande opacity 1 (`1 − 0`, sectionOpacity),
     mais le preset « glass » réécrivait 0.45 sur ses reps (applyMaterialToRep)
     APRÈS le curseur et à chaque reconstruction : le fond traversait encore la
     surface. Le MÊME cas est donc rendu deux fois, même molécule, même caméra,
     seul le FOND change (blanc puis rouge) : si la surface est opaque, les deux
     pixels du centre sont IDENTIQUES — le fond ne les touche pas — et s'il reste
     de l'alpha, le rouge passe et l'écart le dit. */
  const rgbOf = (c) => (c.image && c.image.centerRGB) || [0, 0, 0];
  const bleed = (a, b) => Math.max(...[0, 1, 2].map((i) => Math.abs(rgbOf(a)[i] - rgbOf(b)[i])));
  const giw = byId('glassImposed_white');
  const gir = byId('glassImposed_red');
  const gmw = byId('glassMaterial_white');
  const gmr = byId('glassMaterial_red');
  check(giw.applied === true && gmw.applied === true,
    'les deux cas « glass » ont bien reçu leur matériau sur LEUR représentation (reprOfElement → repr.setParameters)',
    JSON.stringify([giw.applied, gmw.applied]));
  check(bleed(giw, gir) > 40,
    'TÉMOIN : l’opacité du preset écrite sur la rep laisse passer le FOND — c’est le défaut du rapport, mesuré',
    'écart blanc/rouge = ' + bleed(giw, gir));
  check(bleed(gmw, gmr) === 0,
    'le matériau ne règle plus l’opacité : à Transp 0 % (« glass » compris) le fond ne traverse PLUS la surface',
    JSON.stringify(rgbOf(gmw)) + ' vs ' + JSON.stringify(rgbOf(gmr)));
  check(img(gmw).centerLuma > 0,
    '…et la surface reste bien dessinée (un cas vide passerait aussi le test d’égalité)', String(img(gmw).centerLuma));

  console.log('\n--- relevé ---');
  cs.forEach((c) => {
    const i = img(c);
    console.log('   ' + c.id.padEnd(18) + ' attache=' + String(c.built).padEnd(6) + ' ajoutes=' + String(c.added).padEnd(3) +
      ' rep.opaqueBack=' + String(c.rep && c.rep.opaqueBack).padEnd(6) + ' define=' + JSON.stringify(def(c)).padEnd(18) +
      ' defineArriere=' + JSON.stringify(c.buffer && c.buffer.backDefines).padEnd(18));
    console.log('   ' + ''.padEnd(18) + ' centre=' + JSON.stringify(i.centerRGB).padEnd(18) + ' pixel=' + JSON.stringify(i.centerPixel).padEnd(20) +
      ' luma=' + String(i.centerLuma).padEnd(7) + ' ecartBleu=' + String(i.blueSpread).padEnd(5) +
      ' lumaBlob=' + String(i.blobLuma).padEnd(7) + ' partBlob=' + i.blobFrac);
  });
  (d.log || []).forEach((l) => console.log('   [page] ' + l));

  const failed = CHECKS.filter((c) => !c.ok);
  failed.forEach((f) => console.log('   ÉCHEC ' + f.label));
  console.log('total ' + CHECKS.length + ', failed ' + failed.length);
  /* La dernière ligne est celle que lisent _verify.cjs et _run_all.cjs. */
  console.log('_viewer_surface_seethrough_pixels_test.cjs — ' + (CHECKS.length - failed.length) + '/' + CHECKS.length + ' assertions OK' +
    (failed.length ? ' ← ÉCHECS AU-DESSUS' : ' (opaqueBack:false vs défaut NGL — et « Transp 0 % » opaque, matériau compris : pixels réels Chrome/SwiftShader)'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* chrome tient encore le profil */ }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.log('ÉCHEC pilote : ' + (e && e.stack || e)); process.exit(1); });
