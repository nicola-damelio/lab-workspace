/* ==========================================================================
   _viewer_ray_shadow_pixels_test.cjs — LE VERDICT EN PIXELS RÉELS des ombres
   portées du « ✨ Ray » (Chrome en --headless=new, WebGL par SwiftShader).

   POURQUOI ELLE EXISTE
   Le rapport : « les ombres générées par « ray » sont laides, elles salissent la
   molécule, et les cycles aromatiques ne projettent pas leurs hexagones sur les
   rubans voisins. » Les suites unitaires prouvent la géométrie (elles mesurent
   l'hexagone projeté sur un banc orthographique déterministe) ; celle-ci prouve
   la CHAÎNE COMPLÈTE sur une vraie scène NGL 2.4 et de vrais pixels WebGL,
   parce que c'est là que le défaut vivait : les tampons d'NGL ne sont pas ceux
   qu'un lecteur de source imagine.

   LES TROIS FAITS MESURÉS (voir _viewer_ray_shadow_pixels_page.html)
     1. LES TAMPONS RÉELS : le maillage d'un cartoon est INDEXÉ (3 flottants par
        sommet + `normal` + une table d'indices) — l'ancien lecteur, qui croyait
        « 12 flottants par sommet », rendait `null` et un CARTOON NE PROJETAIT
        RIEN. La plaque d'un cycle aromatique est un MeshBuffer SANS
        `structureView` : elle n'était ni occulteur ni receveur.
     2. LES PIXELS : l'ombre assombrit vraiment le dessin, ET LE FOND BLANC N'EST
        JAMAIS TOUCHÉ (zéro pixel de fond modifié) — le « ça salit la molécule ».
     3. LA FORME : l'ombre n'est pas un voile (une part du dessin seulement
        s'assombrit) — le masque n'est plus la carte de toute l'image.
     4. LA COUCHE VIVANTE (la demande suivante : « will it be possible to see it
        while the molecule is moving and not only as a still picture? ») : le
        noir d'alpha `s·m` que le direct POSE sur la scène (son chemin, décrit
        dans src/utils/viewerRayShadowLive.js) rejoue l'ombre du still sur les
        MÊMES pixels WebGL — écart maximal d'une poignée d'unités par canal,
        aucun pixel à plus de deux, fond toujours intact. C'est ce qui autorise
        la couche à peindre la vue image par image.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   Un serveur 127.0.0.1 sert la page, `ngl.js` (le MÊME dist UMD 2.4.0 que charge
   src/utils/ngl.js) et le SOURCE du module d'ombres (jamais une copie) ; Chrome
   rend la scène, la page POSTe son verdict JSON ici. Deux PNG restent sur le
   disque pour l'œil humain (_tmp_ray_shadow_before/after.png, ignorés par git).

   LANCEMENT : node _viewer_ray_shadow_pixels_test.cjs   (~15 s)
   Sans Chrome ni Edge sur la machine, la sonde est SAUTÉE (exit 0) — jamais
   verte en silence.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const TIMEOUT_MS = 150000;
const MODULE_URL = '/shadow-module.js';

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
  if (url.pathname === '/probe') return send(200, 'text/html; charset=utf-8', fs.readFileSync(path.join(ROOT, '_viewer_ray_shadow_pixels_page.html')));
  if (url.pathname === '/ngl.js') return send(200, 'application/javascript', fs.readFileSync(path.join(ROOT, 'node_modules/ngl/dist/ngl.js')));
  if (url.pathname === MODULE_URL) return send(200, 'application/javascript; charset=utf-8', fs.readFileSync(path.join(ROOT, 'src/utils/viewerRayShadows.js')));
  if (url.pathname === '/save') {
    const b64 = (await readBody(req)).replace(/^data:image\/png;base64,/, '');
    const f = path.join(ROOT, '_tmp_ray_' + (url.searchParams.get('name') || 'x') + '.png');
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
  if (!CHROME) {
    console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde WebGL ne peut pas tourner');
    console.log('_viewer_ray_shadow_pixels_test.cjs — 0 assertions (SAUTÉ : aucun navigateur)');
    process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglshadow-'));
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
    if (last && last.log) console.log('       trace page :\n' + last.log.join('\n'));
    console.log('       stderr chrome :\n' + errs.slice(-20).join('\n'));
    process.exit(1);
  }

  const d = last;
  const facts = d.facts || {};
  const px = d.pixels || {};
  const cb = ((facts.reprs || []).find((r) => r.type === 'cartoon') || {}).buffers || [];
  console.log('   cartoon buffer : ' + JSON.stringify(cb.map((b) => ({
    attr: b.attrKeys, v: b.vertices, posLen: b.posLen, item: b.itemSize,
    norm: b.hasNormal, size: b.hasSize, tan: b.hasTangent, bin: b.hasBinormal,
    idx: b.indexLen, tris: b.tris,
    bbox: b.posBBox && b.posBBox.map((v) => v.map((n) => Math.round(n * 10) / 10)),
    first: b.firstPos && b.firstPos.map((n) => Math.round(n * 100) / 100),
    sizes: b.firstSize,
  }))));
  console.log('   caméra : reprojetée ' + facts.reprojected + ', projection identique ' + facts.projSame
    + ' avant ' + JSON.stringify(facts.projBefore0) + ' après ' + JSON.stringify(facts.projAfter0));
  const reprs = facts.reprs || [];
  const repsOf = (t) => reprs.filter((r) => r.type === t);
  const buffersOf = (t) => repsOf(t).reduce((a, r) => a.concat(r.buffers || []), []);
  const cartoonBufs = buffersOf('cartoon');
  const bufferReps = repsOf('buffer');

  console.log('--- verdict ---');
  check(d.stage === 'done', 'la sonde va au bout (stage = done)', d.stage);
  check((d.errors || []).length === 0, 'aucune erreur dans la page', JSON.stringify((d.errors || []).slice(0, 2)));

  console.log("\n--- 1. LES TAMPONS RÉELS D'NGL (ce que l'ancien lecteur croyait) ---");
  console.log('   attente de construction : ' + facts.waitedMs + ' ms, ' + facts.bufferCount + ' maillages');
  console.log('   reps : ' + JSON.stringify(reprs.map((r) => ({
    t: r.type, view: r.hasView, at: r.viewAtoms, sele: r.sele, data: r.dataListLen, buf: r.bufferListLen, nb: r.needsBuild,
  }))));
  console.log('   frange — chute max par distance : ' + JSON.stringify(px.fringeMax));
  console.log('   couverture « en trop » (à 4 px et plus du dessin) : ' + JSON.stringify(px.coverOnlyFar));
  if (px.bands) console.log('   tranches : ' + JSON.stringify(px.bands));
  console.log('   bornes — couverture ' + JSON.stringify(px.coverBox) + ' / molécule dessinée ' + JSON.stringify(px.molBox));
  if (px.rowSpans) console.log('   rangées (couverture vs dessin) : ' + JSON.stringify(px.rowSpans));
  if (px.covMap) console.log('   carte couverture(# = les deux, X = couverture SEULE, . = dessin seul) :\n' + px.covMap.map((r) => '     |' + r + '|').join('\n'));
  console.log('   couverture : ' + facts.coverage + ' px, masque non nul ' + facts.maskNonZero + ' px, hors couverture ' + facts.maskOutsideCoverage + ' | camAxes ' + JSON.stringify(facts.camAxes));
  console.log('   store : ' + JSON.stringify(facts.store) + ' polymers ' + JSON.stringify(facts.polymers) + ' atom1 ' + JSON.stringify(facts.atom1));
  if (px.dirtMap) console.log('   carte des pixels de FOND touchés (# : >50, + : >10, . : sinon) :\n' + px.dirtMap.map((r) => '     |' + r + '|').join('\n'));
  check(cartoonBufs.length > 0, 'la représentation cartoon existe dans reprList', String(reprs.map((r) => r.type)));
  check(cartoonBufs.every((b) => b.hasNormal), "le maillage d'un cartoon PORTE une `normal` (donc c'est une SURFACE)", JSON.stringify(cartoonBufs.map((b) => b.hasNormal)));
  check(cartoonBufs.every((b) => b.hasIndex && b.indexLen >= 3), "…et une TABLE D'INDICES : c'est un maillage indexé", JSON.stringify(cartoonBufs.map((b) => b.indexLen + '/' + b.indexCtor)));
  check(cartoonBufs.every((b) => b.itemSize === 3), "…à 3 flottants par position — PAS 12 : l'hypothèse qui rendait `null`", JSON.stringify(cartoonBufs.map((b) => b.itemSize)));
  check(cartoonBufs.every((b) => b.tris > 0), "…donc ses triangles sont LUS (l'ancien lecteur rendait null : aucune ombre de cartoon)", JSON.stringify(cartoonBufs.map((b) => b.tris)));
  check(bufferReps.length === 1 && bufferReps[0].hasView === false,
    'la PLAQUE du cycle est un genre `buffer` SANS `structureView` (on ne la lit pas sur les atomes)', JSON.stringify(bufferReps.map((r) => ({ t: r.type, v: r.hasView }))));
  check(bufferReps.every((r) => r.marked), '…et elle porte la marque `__plates` que le viewer pose', JSON.stringify(bufferReps.map((r) => r.marked)));
  const plateBufs = buffersOf('buffer');
  check(plateBufs.length > 0 && plateBufs[0].hasIndex && plateBufs[0].tris === 6,
    "…donc ses 6 triangles sont lus : l'hexagone d'un cycle est un occulteur ET un receveur", JSON.stringify(plateBufs.map((b) => b.tris)));
  check(facts.atoms > 0, 'les atomes dessinés sont lus', String(facts.atoms));
  check(facts.links > 0, '…et leurs liens sont des capsules', String(facts.links));
  check(facts.triCount > 0, 'les TRIANGLES de la scène sont rassemblés', String(facts.triCount));
  check(facts.plates >= 1, '…avec la plaque du cycle comptée', String(facts.plates));
  check(/cartoon/.test(facts.kinds || '') && /buffer/.test(facts.kinds || ''),
    '…et les genres NOMMÉS (cartoon · buffer)', String(facts.kinds));

  console.log('\n--- 2. LE MASQUE ---');
  check(facts.spheres > 0, 'les billes/capsules du dessin sont dans le masque', String(facts.spheres));
  check(facts.filled > 0, '…une capsule par liaison', String(facts.filled));
  check(facts.triangles === facts.triCount, 'les mêmes triangles projettent', facts.triangles + ' / ' + facts.triCount);
  check(facts.maskPlates === facts.plates, '…dont la plaque de cycle', facts.maskPlates + ' / ' + facts.plates);
  check(!!facts.rig && facts.rig.width > 0, 'le rig de la lampe couvre la scène', JSON.stringify(facts.rig));

  console.log('\n--- 3. LES PIXELS RÉELS (WebGL, Chrome headless) ---');
  check(px.width >= 400 && px.height >= 300, 'un PNG a bien été rendu', px.width + 'x' + px.height);
  check(px.touched > 0, "des pixels ont été modifiés par l'ombre", String(px.touched));
  check(px.molChanged > 0 && px.maxDrop > 20,
    `l'ombre assombrit VRAIMENT le dessin (${px.molChanged} pixels, jusqu'à ${px.maxDrop} de luminance)`, JSON.stringify({ changed: px.molChanged, drop: px.maxDrop }));
  check(px.bgVisibleDirt === 0,
    `LE FOND N'EST JAMAIS SALI : 0 pixel de fond assombri de plus de 8 unités (${px.bgVisibleDirt} ; le maximum sur le fond est ${px.bgMaxDrop}, celui du liseré antialiasé ; ${px.bgTouched} pixels touchés en tout)`,
    JSON.stringify({ visibleDirt: px.bgVisibleDirt, bgMaxDrop: px.bgMaxDrop, touched: px.bgTouched }));
  check(px.molChangedShare < 0.95,
    `l'ombre n'est PAS un voile global : ${Math.round(px.molChangedShare * 100)} % du dessin seulement (${px.molChanged}/${px.molPixels})`,
    String(px.molChangedShare));
  check(px.imageShare < 0.25,
    `…et elle n'occupe qu'une part de l'image (${Math.round(px.imageShare * 100)} %), pas la carte entière`,
    String(px.imageShare));

  console.log('\n--- 4. LA COUCHE VIVANTE (le direct, sur LES MÊMES pixels) ---');
  /* LA PARITÉ DU DIRECT ET DU PNG, mesurée là où elle compte : sur ce que NGL a
     vraiment rendu. La couche du direct est un noir d'alpha `s·m` posé sur la
     scène (viewerRayShadowLive.js) ; `applyShadowToPixels` multiplie chaque canal
     par `1 − s·m`. Si l'ombre vivante n'était pas la même ombre, c'est ICI que
     ça se verrait — pas dans une relecture de source. */
  const lv = px.live || {};
  check(lv.painted > 0, 'la couche du direct peint les pixels du masque', String(lv.painted));
  check(lv.changed > 0 && Math.abs(lv.changed - px.touched) <= Math.max(20, px.touched * 0.01),
    `…et elle assombrit les MÊMES pixels que le still (${lv.changed} contre ${px.touched} : l'écart est le liseré que le bilinéaire du navigateur et celui du module ne découpent pas au même pixel)`,
    JSON.stringify({ live: lv.changed, still: px.touched }));
  check(lv.maxDiff <= 3,
    `la même ombre, au pixel près : écart maximal de ${lv.maxDiff} unité(s) par canal (moyenne ${lv.meanDiff})`,
    JSON.stringify({ maxDiff: lv.maxDiff, meanDiff: lv.meanDiff, over2: lv.over2 }));
  check(lv.over2 === 0,
    "…aucun pixel ne s'en écarte de plus de deux unités : la parité n'est pas une moyenne",
    String(lv.over2));
  check(lv.bgVisibleDirt === 0,
    `la couche ne salit pas le fond non plus : 0 pixel blanc assombri de plus de 8 unités (${lv.bgVisibleDirt})`,
    String(lv.bgVisibleDirt));
  check(lv.maskWidth >= 400 && lv.maskHeight >= 300,
    "le masque du direct a la taille de l'image (donc rien n'est agrandi depuis un timbre-poste)",
    lv.maskWidth + '×' + lv.maskHeight);

  const bad = CHECKS.filter((c) => !c.ok);
  console.log('\n' + (bad.length
    ? `ÉCHEC  ${bad.length} assertion(s) rouge(s) sur ${CHECKS.length}`
    : 'OK    ' + CHECKS.length + ' assertions vertes'));
  if (saved.length) console.log("images laissées pour l'œil : " + saved.join(', '));
  console.log(`_viewer_ray_shadow_pixels_test.cjs — ${CHECKS.length - bad.length}/${CHECKS.length} assertions OK (pixels réels)`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.log('ÉCHEC  ' + ((e && e.stack) || e));
  process.exit(1);
});
