/* ============================================================================
   _viewer_bg_live_test.cjs — LE FOND DU VIEWER, MESURÉ SUR LE COMPOSANT VIVANT.

   LE RAPPORT DE CETTE SESSION : « the gradient does not work and the program is
   slow even if it does not have processes to do. »

   POURQUOI IL EXISTE. Trois preuves existent déjà, et AUCUNE ne répond à ces
   deux-là :
     · `_viewer_background_test.mjs` RELIT le source : il prouve le câblage (le
       module, le panneau, l'effet, ses dépendances) — pas ce que le navigateur
       finit par peindre ;
     · `_viewer_background_pixels_test.cjs` MESURE le module et un canvas NGL
       monté à la main : il prouve que le fond est du CSS vu à travers une toile
       transparente — pas que LE COMPOSANT du viewer y arrive ;
     · `_viewer_style_*` prouvent ce qu'un style enregistré contient.
   Il manquait LE maillon : monter le VRAI `NMRMoleculeViewer`, cliquer sur le
   fond, appuyer sur l'interrupteur ⬚ Gradient, et lire le CSS que le navigateur
   compose RÉELLEMENT sur la toile. C'est ce que fait la sonde — et au passage
   elle MESURE le repos, parce que « the program is slow even if it does not have
   processes to do » est une durée, pas une opinion.

   COMMENT (zéro dépendance : ni Playwright ni Puppeteer dans ce dépôt)
   `_viewer_bg_live_probe.jsx` importe le composant réel ; Vite le construit
   (page navigateur : les VRAIES classes de Tailwind donnent sa boîte au canvas)
   dans _render_bg_live/ (ignoré par git), un serveur 127.0.0.1 le sert avec
   `ngl.js` (le dist UMD 2.4.0 du dépôt) ; Chrome le charge en --headless=new
   (WebGL par SwiftShader) et la sonde POSTe ses mesures ici — pas de CDP.

   CE QUI EST VÉRIFIÉ
     1. le clic sur le FOND ouvre le panneau du VRAI viewer (#viewer-background) ;
     2. l'interrupteur ⬚ Gradient écrit la rampe dans le CSS du canvas
        (`style.backgroundImage`, deux arrêts, exactement A et B) ET le
        navigateur la COMPOSE (`getComputedStyle(...).backgroundImage`) ;
     3. l'éteindre rend la couleur d'NGL telle quelle (aucune image de fond) ;
     4. LE REPOS : images rendues par NGL, images demandées, tâches longues et
        mutations du DOM pendant 2,5 s — avant la rampe, puis avec elle. NGL ne
        rend que sur demande : au repos le compte doit être ~0, et la rampe (du
        CSS) ne doit RIEN y ajouter.

   LANCEMENT : node _viewer_bg_live_test.cjs   (≈20 s)
   Sans Chrome ni Edge sur la machine, la sonde est SAUTÉE (exit 0) — jamais
   verte en silence.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const OUT_DIR = '_render_bg_live';
const TIMEOUT_MS = 150000;

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && fs.existsSync(p))[0];

const CHECKS = [];
const check = (ok, label, detail) => {
  CHECKS.push({ ok: !!ok, label });
  process.stdout.write((ok ? 'OK    ' : 'ÉCHEC ') + label + (detail === undefined ? '' : '   [' + detail + ']') + '\n');
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r?\n/g, '\n');

if (!CHROME) {
  console.log('SAUTÉ  aucun Chrome ni Edge trouvé — la sonde du fond vivant ne peut pas tourner');
  console.log('_viewer_bg_live_test.cjs — 0 assertions (SAUTÉ : aucun navigateur)');
  process.exit(0);
}

/* ── 1 · LA SONDE MONTE-T-ELLE LE VRAI COMPOSANT ? ──────────────────────────
   Le seul garde-fou qu'une sonde ne peut pas s'offrir elle-même : si elle
   recopiait la rampe ou le panneau, elle pourrait être verte sans rien mesurer.
   On exige donc l'import du composant réel ET l'absence de toute copie de la
   peinture (`paintViewerBackground`, `backgroundCss(`). */
const PROBE = read('_viewer_bg_live_probe.jsx');
check(PROBE.includes("import NMRMoleculeViewer from './src/components/NMRMoleculeViewer';"),
  'la sonde monte LE composant du viewer (aucun composant recopié)');
check(!/paintViewerBackground|backgroundCss\(|bgGradientOf\(/.test(PROBE),
  '…et elle ne recopie AUCUNE règle du fond : elle ne fait que le geste et la mesure');
check(PROBE.includes('getComputedStyle(canvas).backgroundImage'),
  '…la lecture passe par le CSS RÉELLEMENT COMPOSÉ par le navigateur');
check(PROBE.includes('sampleIdle') && PROBE.includes('longtask'),
  '…et le repos est mesuré (images, mutations du DOM, tâches longues)');
check(PROBE.includes("document.getElementById('viewer-background')"),
  '…sur le VRAI panneau (#viewer-background) du viewer');

let last = null;
let resolveResult = null;
/* TOUS les verdicts reçus pendant un passage : la phase « define » du scénario du
   rapport est POSTée PUIS la page se recharge (le verdict de la veille serait perdu
   avec l'état de la page) — c'est donc ici qu'on le garde. */
let posted = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const main = async () => {
  /* ── 2 · le build (Vite, page réelle : la feuille de style est liée) ─────── */
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
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
      rollupOptions: { input: path.join(ROOT, '_viewer_bg_live_probe.html') },
    },
  });
  const INDEX = path.join(ROOT, OUT_DIR, '_viewer_bg_live_probe.html');
  check(fs.existsSync(INDEX), 'la sonde est construite (page navigateur, Tailwind lié)');

  /* ── 3 · le serveur (les fichiers construits + ngl.js du dépôt + le verdict) ── */
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/result') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        try { last = JSON.parse(b); } catch (e) { last = { stage: 'fatal', parseError: String(e), raw: b.slice(0, 300) }; }
        posted.push(last);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        if (last.stage === 'done' || last.stage === 'fatal') { const r = resolveResult; resolveResult = null; if (r) r(last); }
      });
      return undefined;
    }
    /* LE MÊME dist UMD que le CDN de src/utils/ngl.js : `ensureNGL` prend
       `window.NGL` s'il est déjà là, la sonde ne dépend donc d'aucun réseau. */
    if (url.pathname === '/ngl.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(fs.readFileSync(path.join(ROOT, 'node_modules/ngl/dist/ngl.js')));
    }
    const rel = url.pathname === '/' ? '_viewer_bg_live_probe.html' : url.pathname.replace(/^\/+/, '');
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
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('chrome : ' + CHROME);
  console.log('sonde  : ' + url + '\n');

  /* ── 4 · Chrome headless — DEUX FOIS : le viewer par défaut, puis le même
     viewer SANS le volet d'ombre portée vivante (`?shadow=off`). La comparaison
     des deux repos ATTRIBUE le travail : c'est la seule façon honnête de dire
     d'où vient un « ça rame alors qu'il n'y a rien à faire ». ──────────────── */
  const runOnce = async (search) => {
    last = null;
    posted = [];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nglbglive-'));
    const errs = [];
    const done = new Promise((r) => { resolveResult = r; });
    const child = spawn(CHROME, [
      '--headless=new', '--force-device-scale-factor=1', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--no-sandbox',
      '--disable-extensions', '--disable-component-update', '--disable-background-networking',
      '--disable-sync', '--disable-default-apps', '--disable-features=Translate',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + tmp, '--window-size=2200,2700', url + search,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => {
      String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) { errs.push(l.trim()); if (errs.length > 60) errs.shift(); } });
    });
    const timedOut = await Promise.race([done.then(() => false), sleep(TIMEOUT_MS).then(() => true)]);
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* chrome tient encore le profil */ }
    return { verdict: last, errs, timedOut, search: search || '(défauts)', posted: posted.slice() };
  };

  const run1 = await runOnce('');
  if (run1.timedOut) {
    console.log('\nÉCHEC  la sonde n\'a pas rendu son verdict en ' + (TIMEOUT_MS / 1000) + ' s');
    console.log('       dernière étape vue : ' + (last ? last.stage : '(aucun POST reçu)'));
    if (last && last.log) console.log('       trace page :\n' + last.log.join('\n'));
    console.log('       stderr chrome :\n' + run1.errs.slice(-20).join('\n'));
    process.exit(1);
  }
  /* La seconde mesure (sans le volet d'ombre vivante) est un DIAGNOSTIC : elle
     n'ajoute pas d'assertion, elle chiffre la part du repos qui vient de lui. */
  console.log('--- seconde mesure : le même viewer sans le volet d’ombre vivante ---');
  const run2 = await runOnce('?shadow=off');

  /* ── ET LE SCÉNARIO DU RAPPORT : 📌 un style (rampe éteinte), rechargement, puis
     un ⬚ Gradient pressé pendant que le rappel automatique est encore en vol. ─── */
  console.log('--- troisième mesure : 📌 un style puis un ⬚ juste après l’ouverture ---');
  const run3 = await runOnce('?phase=define');
  server.close();

  /* ── 5 · le verdict (le PREMIER passage : le viewer tel qu'il s'ouvre) ───── */
  const d = run1.verdict;
  const d2 = run2.verdict || {};
  const cs = d.cases || [];
  const p = (cs.find((c) => c.id === 'probe') || {});
  const base = p.base || {};
  const gesture = p.gesture || {};
  const after = p.after || null;
  const off = p.off || null;
  const idleBefore = p.idleBefore || {};
  const idleAfter = p.idleAfter || {};
  const rgb = (hex) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : null;
  };
  let stored = null;
  try { stored = after && after.stored ? JSON.parse(after.stored) : null; } catch { stored = null; }
  const stops = (css) => (String(css).match(/rgb\([^)]*\)|rgba\([^)]*\)|#[0-9a-f]{3,8}/gi) || []);

  console.log('--- verdict ---');
  check(d.stage === 'done', 'la sonde va au bout (stage = done)', d.stage);
  /* ⚠ LA HAUTEUR DE LA TOILE EST UN RELEVÉ, PAS UNE EXIGENCE : la page de la
     sonde ne peut pas donner à la vue la hauteur que lui donne une page de
     l'application (le chrome du viewer — barre + fenêtres — mesure 2246 px sur
     cette page, et la colonne de la vue garde sa hauteur propre : la toile tombe
     donc à 1 px de haut). Ce que la sonde exige, c'est que la vue EXISTE et soit
     large ; les chiffres du repos sont donc un PLANCHER pour le coût des rendus. */
  check(Array.isArray(base.canvas) && base.canvas[0] > 200,
    'le viewer a monté une toile à l’échelle (largeur ≥ 200 px)',
    JSON.stringify(base.canvas) + ' · ' + JSON.stringify(base.boxes || {}));

  console.log('\n--- 1. le geste du fond, sur le VRAI viewer ---');
  check(gesture.opened === true, 'un clic sur le FOND ouvre le panneau du viewer (#viewer-background)', gesture.openedBy);
  check(gesture.switchFound === true, 'l’interrupteur ⬚ Gradient est bien dans le panneau', gesture.switchText);
  check(gesture.pressedBefore === 'false',
    'la rampe est ÉTEINTE au départ (le viewer s’ouvre sur sa couleur unie)', String(gesture.pressedBefore));
  check(/^none$/i.test(String(base.rampsBefore).trim()),
    '…et le canvas n’a donc aucune image de fond', String(base.rampsBefore));

  console.log('\n--- 2. l’interrupteur, et ce que le navigateur COMPOSE ---');
  check(!!after, 'l’interrupteur a été appuyé');
  if (after) {
    check(after.pressed === 'true', 'il se dit ALLUMÉ (aria-pressed)', String(after.pressed));
    check(!!stored && stored.on === true, 'la rampe est retenue allumée (« labViewerBgGradient »)',
      after.stored === null || after.stored === undefined ? '—' : String(after.stored).slice(0, 90));
    const a = String(base.cssBg || '');            // A = la couleur de la scène (NGL l'a écrite en CSS)
    const b = rgb(stored && stored.to);            // B = la seconde couleur de la rampe, lue du magasin
    check(!!stored && !!b, 'elle connaît la seconde couleur (B), lue du magasin du poste',
      stored ? `B ${stored.to} · angle ${stored.angle}°` : '—');
    check(!!a && /^rgb/.test(a),
      '…et A est la couleur de la scène elle-même (elle n’est pas recopiée dans le magasin)', a);
    check(/linear-gradient\(/.test(String(after.inlineCss)),
      'LE VIEWER A ÉCRIT LA RAMPE SUR LE CANVAS (`style.backgroundImage`)', String(after.inlineCss).slice(0, 90));
    check(a && b && String(after.inlineCss).includes(a) && String(after.inlineCss).includes(b),
      '…exactement A et B, aucune couleur inventée', String(after.inlineCss).slice(0, 110));
    check(/linear-gradient\(/.test(String(after.computedCss)),
      'ET LE NAVIGATEUR LA COMPOSE sur la toile (`getComputedStyle(canvas).backgroundImage`)',
      String(after.computedCss).slice(0, 110));
    check(a && b && String(after.computedCss).includes(a) && String(after.computedCss).includes(b),
      '…les deux arrêts sont bien A et B (le fond montré est celui demandé)',
      stops(after.computedCss).join(' · '));
    check(stops(after.computedCss).length === 2,
      '…deux arrêts, pas trois : la rampe est celle de nos deux couleurs', String(stops(after.computedCss).length));
    check(!!base.cssBg && after.cssBg === base.cssBg,
      'la couleur d’NGL reste SOUS la rampe (la scène n’a pas été touchée)', String(after.cssBg));
    check(Array.isArray(after.canvas) && after.canvas[0] === base.canvas[0] && after.canvas[1] === base.canvas[1],
      '…et la toile n’a pas été redimensionnée par la rampe (aucune reconstruction)', JSON.stringify(after.canvas));
  }

  console.log('\n--- 3. l’éteindre rend la couleur d’NGL telle quelle ---');
  check(off && off.pressed === 'false', 'le second appui l’éteint', off ? String(off.pressed) : '—');
  check(off && String(off.inlineCss) === '',
    '…le canvas ne porte plus d’image de fond dans son style', off ? JSON.stringify(off.inlineCss) : '—');
  check(off && /^none$/i.test(String(off.computedCss).trim()),
    '…et le navigateur n’en compose plus aucune', off ? String(off.computedCss) : '—');

  console.log('\n--- 4. LE REPOS (2,5 s sans rien demander) ---');
  const line = (n, i) => `   ${n} images NGL=${String(i.renderCalls).padStart(3)}  demandes=${String(i.requested).padStart(3)}`
    + `  rAF demandées=${String(i.rafSched).padStart(3)}`
    + `  rAF exécutées=${String(i.rafRan).padStart(3)}  tâches longues=${String(i.longTasks).padStart(2)}`
    + ` (${String(i.longTaskMs).padStart(4)} ms)  mutations DOM=${String(i.domMutations).padStart(4)}`
    + `  plus grand trou=${String(i.maxGapMs).padStart(6)} ms`;
  console.log(`   ngl=${d.ngl} · requestRender écouté=${d.watched} · volet d’ombre=${d.shadows || '?'}`);
  console.log(line('avant rampe', idleBefore));
  console.log(line('avec rampe ', idleAfter));
  /* QUI DEMANDE CES IMAGES — la pile, telle quelle (bundle non minifié). */
  const relSay = (tag, v) => {
    console.log(`   ${tag}`);
    (v.reqWho || []).forEach((w) => console.log(`      demande ×${String(w.n).padEnd(4)} ${w.stack}`));
    (v.renderCallWho || []).forEach((w) => console.log(`      image   ×${String(w.n).padEnd(4)} ${w.stack}`));
    (v.rafWho || []).forEach((w) => console.log(`      rAF     ×${String(w.n).padEnd(4)} ${w.stack}`));
    (v.renderWho || []).forEach((w) => console.log(`      rendu   ×${String(w.n).padEnd(4)} ${w.stack}`));
  };
  relSay('qui demande des images — AVANT rampe :', idleBefore);
  relSay('qui demande des images — AVEC rampe :', idleAfter);
  const p2 = ((d2.cases || []).find((c) => c.id === 'probe') || {});
  const idleOff = p2.idleBefore || {};
  console.log('\n--- 4bis. le MÊME viewer SANS le volet d’ombre vivante (`?shadow=off`) ---');
  console.log(line('sans ombre ', idleOff));
  relSay('qui demande des images — sans ombre :', idleOff);

  /* ── 5. LE REPOS VUE CACHÉE — ce que le rapport appelle « slow even if it does
     not have processes to do » : une page quittée qui reste montée. Les deux
     boucles éternelles d'NGL 2.4 demandaient ~120 images par seconde même
     cachées ; le viewer les met en veille (utils/nglStageParking.js). ─────── */
  const idleHidden = p.idleHidden || {};
  const idleShown = p.idleShown || {};
  const wake = p.wake || {};
  console.log('\n--- 5. LE REPOS, VUE CACHÉE (une page quittée reste montée) ---');
  console.log('   océan des boîtes du viewer : ' + JSON.stringify(base.boxes || {}));
  (base.children || []).forEach((c) => console.log('     enfant ' + String(c[1]) + '  ' + c[0]));
  console.log('   IntersectionObserver (témoin) : ' + JSON.stringify(p.ioSaw || []));
  console.log(line('vue cachée ', idleHidden));
  console.log(line('après réveil', idleShown));
  relSay('qui demande des images — VUE CACHÉE :', idleHidden);
  check(!!idleHidden.ms, 'la mesure de la vue cachée a bien eu lieu');
  check((idleHidden.rafSched || 0) <= 20,
    'VUE CACHÉE, plus AUCUNE image n’est demandée — les deux boucles éternelles d’NGL sont arrêtées',
    String(idleHidden.rafSched) + ' demande(s) en 2,5 s (≈300 avant la mise en veille)');
  check((idleHidden.renderCalls || 0) <= 1, '…et NGL ne peint plus rien du tout',
    String(idleHidden.renderCalls) + ' image(s)');
  check((idleShown.rafSched || 0) >= 20,
    'au RETOUR de la page, les boucles repartent — la vue n’est pas restée sourde',
    String(idleShown.rafSched) + ' demande(s) en 1,5 s');
  check(/linear-gradient\(/.test(String(wake.computedCss || '')),
    '…et la RAMPE est toujours là après le sommeil (le fond n’a pas été perdu)',
    String(wake.computedCss || '').slice(0, 90));
  check(Array.isArray(wake.visible) && wake.visible[0] > 200,
    '…la toile a retrouvé sa boîte (largeur ≥ 200 px)', JSON.stringify(wake.visible));

  /* ── 6. LE SCÉNARIO DU RAPPORT — le cas que l'utilisateur décrit, reproduit ──
     « nothing changes at all » : le viewer s'ouvre, il presse ⬚ Gradient, et la
     rampe disparaît — parce que le rappel automatique (400 ms après que la scène
     est prête) repose le style retenu par l'instance, rampe éteinte comprise.
     Le garde-fou : un geste sur la scène (une écriture de ses réglages) clôt le
     rappel — `sceneGesture`. */
  const d3cases = (run3.posted || []).reduce((acc, p) => acc.concat(p.cases || []), []);
  const define = d3cases.find((c) => c.id === 'define') || {};
  const rev = d3cases.find((c) => c.id === 'revert') || {};
  console.log('\n--- 6. LE SCÉNARIO DU RAPPORT : un ⬚ Gradient juste après l’ouverture ---');
  check(define.pressed === true,
    'phase 1 : 📌 Define style a été pressé (l’instance retient son style)', String(define.pressed));
  check((rev.stories && (rev.stories.snapshots || []).length || 0) >= 1,
    '…et le style retenu EXISTE (sinon ce scénario ne prouverait rien — c’est le rappel qui le repose)',
    JSON.stringify(rev.stories || {}));
  check(String(define.ramp || '').trim() === 'none',
    '…la rampe était ÉTEINTE au moment du 📌 : le style retenu dit « rampe éteinte »', String(define.ramp));
  check(!!rev.early && /linear-gradient\(/.test(String(rev.early.ramp)),
    'phase 2 : le ⬚ pressé tout de suite après l’ouverture ALLUME la rampe',
    String(rev.early && rev.early.ramp).slice(0, 84));
  check(!!rev.late && /linear-gradient\(/.test(String(rev.late.ramp)),
    '⚠⚠ …et elle est ENCORE là 2 s plus tard : le rappel automatique ne la repose plus',
    String(rev.late && rev.late.ramp).slice(0, 84));
  check(!!rev.late && rev.late.pressed === 'true',
    '…l’interrupteur reste allumé (aria-pressed)', String(rev.late && rev.late.pressed));
  check(idleAfter.requested === 0,
    'AU REPOS, LE VIEWER NE DEMANDE AUCUNE IMAGE (0 `requestRender` en 2,5 s) — le travail n’est donc pas dans nos règles',
    String(idleAfter.requested) + ' demande(s)');
  check(idleAfter.renderCalls <= 6,
    '…et NGL ne peint plus que ses rares images de repos (sa « still frame », la sienne)',
    String(idleAfter.renderCalls) + ' image(s) en 2,5 s');
  check(idleAfter.reqWho && idleAfter.reqWho.length === 0,
    '…aucun demandeur du tout, donc : la liste des piles est vide', JSON.stringify(idleAfter.reqWho || []).slice(0, 80));
  check(idleAfter.renderCalls <= (idleBefore.renderCalls || 0) + 2,
    '…et la rampe ALLUMÉE n’y ajoute aucun rendu (c’est du CSS, pas une scène)',
    'NGL ' + idleBefore.renderCalls + '→' + idleAfter.renderCalls);
  check(idleAfter.longTaskMs <= Math.max(idleBefore.longTaskMs, 50) + 50,
    '…et aucune tâche longue nouvelle ne vient du fond',
    idleBefore.longTaskMs + ' ms → ' + idleAfter.longTaskMs + ' ms');
  (d.log || []).forEach((l) => console.log('   [page] ' + l));

  const failed = CHECKS.filter((c) => !c.ok);
  failed.forEach((f) => console.log('   ÉCHEC ' + f.label));
  console.log('total ' + CHECKS.length + ', failed ' + failed.length);
  /* La dernière ligne est celle que lisent _verify.cjs et _run_all.cjs. */
  console.log('_viewer_bg_live_test.cjs — ' + (CHECKS.length - failed.length) + '/' + CHECKS.length + ' assertions OK'
    + (failed.length ? ' ← ÉCHECS AU-DESSUS'
      : ' (la rampe sur le canvas du VRAI viewer, composée par le navigateur, et le repos mesuré : Chrome/SwiftShader)'));
  /* Le dossier de build (_render_bg_live/) reste sur place, comme celui des autres
     sondes : il est ignoré par git ET par oxlint, et il permet de relire le
     bundle du jour si un chiffre étonne. */
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => { console.log('ÉCHEC pilote : ' + ((e && e.stack) || e)); process.exit(1); });
