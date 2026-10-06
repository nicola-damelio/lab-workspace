/* =========================================================================
   _recettes_table_fit_test.cjs — la table « Lignes budgétaires » tient DANS la
   page : sa barre de défilement HORIZONTALE reste à l’écran.

   Demande : « la tabella lignes budgetaire va fatta entrare nella pagina perche
   non si vede la barra orizzontale di scorrimento ».

   Deux temps, comme les autres sondes du dépôt :
     1. LE SOURCE — la page « Recettes » n’a plus de plancher de hauteur (son
        enveloppe est `flex-1 min-h-0` : la table cède de la place au lieu de
        repousser le bas de sa boîte — et donc SA BARRE HORIZONTALE — sous
        l’écran) et la barre horizontale des SmartTable est rendue visible
        (classe `.st-scroll` : 14 px, pouce slate-400) ;
     2. LE MOTEUR — Chrome/Edge en `--headless=new` charge une page de sonde qui
        monte LA MÊME chaîne de classes que la page (racine, barre d’actions,
        onglets, enveloppe, carte SmartTable, bloc défilant, table à 19 colonnes
        `min-width` 1600 px) avec le CSS COMPILÉ de l’application, et rapporte
        ses mesures (comme _ui_skin_pixel_test.cjs). Ce qui est exigé : la
        rangée de la barre horizontale tombe DANS la fenêtre, et la page n’a
        aucun débordement vertical — à hauteur normale COMME sur une fenêtre
        courte. La sonde rejoue AUSSI l’ancien plancher de 280 px : le TÉMOIN
        NÉGATIF doit, lui, pousser la barre hors de l’écran — sans quoi le
        correctif ne prouverait rien.
   SAUTÉE, exit 0, sans Chrome/Edge ou sans CSS compilé (`npx vite build`).
   ========================================================================= */
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`);
  passed += 1;
};

const SRC = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PAGE = SRC('src/administration/recettesPage.jsx');
const TABLE = SRC('src/administration/smartTable.jsx');

/* ── 1. Le SOURCE : la table cède de la place, la barre est visible ───────── */
const grab = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `${what}\n  motif introuvable : ${re}`);
  passed += 1;
  return m[1];
};
const PAGE_ROOT = grab(PAGE, /<div className="(h-full min-h-0 w-full min-w-0 mx-auto flex flex-col gap-4)">/,
  'la racine de la page occupe exactement la hauteur de l’écran');
const ENVELOPE = grab(PAGE, /<div className="(flex-1 min-h-[^"]*flex flex-col)">/,
  'l’enveloppe de la table est le seul élément extensible');
const CARD = 'bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden '
  + grab(TABLE, /bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden \$\{fillHeight \? '([^']+)'/,
    'la carte SmartTable devient une colonne flex extensible en fillHeight');
const SCROLL = grab(TABLE, /(overflow-auto custom-scrollbar overscroll-contain [\w-]+) \$\{fillHeight \? '([^']+)'/,
  'le bloc défilant est le conteneur du défilement')
  + ' ' + grab(TABLE, /overflow-auto custom-scrollbar overscroll-contain [\w-]+ \$\{fillHeight \? '([^']+)'/,
    'en fillHeight, le bloc défilant prend la hauteur restante');
const MINW = grab(PAGE, /minWidth="([^"]+)"/, 'la table garde sa largeur minimale');

ok(!/min-h-\[/.test(ENVELOPE),
  'Recettes : plus aucun plancher de hauteur sur l’enveloppe de la table');
ok(ENVELOPE.includes('flex-1') && ENVELOPE.includes('min-h-0'),
  'Recettes : la table cède de la place (flex-1 min-h-0) au lieu de déborder');
has(TABLE, '.st-scroll::-webkit-scrollbar { height: 14px; }',
  'SmartTable : la barre horizontale des grands tableaux fait 14 px (elle ne passe plus inaperçue)');
has(TABLE, 'st-scroll ${fillHeight', 'SmartTable : le bloc défilant porte la classe .st-scroll');
has(TABLE, ".st-scroll::-webkit-scrollbar-thumb { background: #94a3b8;",
  'SmartTable : le pouce de la barre est contrasté');

/* ── 2. LE MOTEUR : la même chaîne de classes, mesurée par Chrome ─────────── */
const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => p && existsSync(p));
const CSS = (() => {
  const dir = 'dist/assets';
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((n) => /^index-.*\.css$/.test(n)).sort().pop();
  return f ? path.resolve(dir, f) : null;
})();

if (!CHROME || !CSS) {
  console.log('_recettes_table_fit_test.cjs — SAUTÉE (ni Chrome/Edge, ou pas de CSS compilé : `npx vite build`)');
  process.exit(0);
}

/* La page de sonde : la chaîne de classes réelle, un tableau de 19 colonnes
   `min-width` 1600 px et 30 lignes. Seule la barre d’outils de la SmartTable est
   recopiée en dur (mêmes classes que le composant) : sa hauteur ne déplace pas
   la barre horizontale, qui est au bas du bloc défilant. */
const probeShell = (envelope) => `<!doctype html>
<html lang="fr" class="h-full">
<head>
<meta charset="utf-8" />
<title>PROBE recettes fit</title>
<link rel="stylesheet" href="${CSS.replace(/\\/g, '/')}" />
<style>
  .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
</style>
</head>
<body class="h-full">
<div id="stage" class="flex flex-col" style="height:100vh">
  <div class="h-full min-h-0 flex flex-col bg-slate-50">
    <div class="shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <h1 class="text-lg font-black text-slate-800 flex items-center gap-2"><span class="text-xl">🏛️</span><span class="truncate">Base d’administration</span></h1>
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 -mt-0.5">Recettes · base d’administration (dataset unique)</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap shrink-0">
          <button class="flex items-center gap-1 text-[11px] font-black uppercase rounded-full border px-2.5 py-1.5 bg-white text-slate-600 border-slate-200">← <span class="hidden sm:inline">Retour</span></button>
          <button class="flex items-center gap-1 text-[11px] font-black uppercase rounded-full border px-2.5 py-1.5 bg-white text-slate-600 border-slate-200">↩ <span class="hidden sm:inline">Annuler</span></button>
          <span class="text-[10px] font-black uppercase text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">💾 Sauvegarde auto</span>
        </div>
      </div>
    </div>
    <div id="wrapper" class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
      <div id="page" class="${PAGE_ROOT}">
        <div class="flex items-center justify-end gap-3 flex-wrap">
          <button class="bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-sm px-4 py-2 rounded-xl shadow-sm flex items-center gap-1.5"><span class="text-base leading-none">📥</span> Importer</button>
          <button class="bg-blue-600 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm flex items-center gap-1.5"><span class="text-base leading-none">+</span> Nouvelle ligne budgétaire</button>
        </div>
        <div class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-sm w-fit flex-wrap">
          <button class="px-3 py-1.5 rounded-lg text-xs font-black bg-blue-600 text-white shadow-sm"><span class="mr-1.5">📈</span>Lignes budgétaires<span class="ml-1.5 font-mono text-[10px] text-blue-200">12</span></button>
          <button class="px-3 py-1.5 rounded-lg text-xs font-black text-slate-500"><span class="mr-1.5">👤</span>Salaires<span class="ml-1.5 font-mono text-[10px] text-slate-400">3</span></button>
        </div>
        <div id="tablewrap" class="${envelope}">
          <div id="card" class="${CARD}">
            <div class="shrink-0 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <div class="flex items-center gap-1.5 min-w-[220px] flex-1">
                <span class="text-slate-300 text-sm leading-none">🔍</span>
                <input placeholder="Rechercher une ligne, un porteur, une note…" class="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold text-slate-400 whitespace-nowrap">12 / 12</span>
                <button class="text-[11px] font-black px-2.5 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-500">Filtres <span class="text-[8px] text-slate-300">▾</span></button>
              </div>
            </div>
            <div id="scroll" class="${SCROLL}">
              <table id="table" class="w-full text-sm border-collapse" style="min-width:${MINW}"><thead><tr id="theadrow"></tr></thead><tbody id="tbody"></tbody></table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<pre id="report"></pre>
`;

/* Le script de mesure, embarqué dans la sonde : il rend une ligne PROBE|clé=valeur
   par mesure (lue ensuite dans le DOM vidé par --dump-dom). */
const probeScript = `<script>
(function () {
  var COLS = ['Ligne budgétaire','Type','Porteur','Budget total','Dispo université','Achats (BC signé)',
    'Prestations internes','OM payés','Rémunération stages','Remboursements','OM prévus','Achats prévus',
    'Devis en signature/signé','OM en signature/signé','Solde','Solde prévu','Fin d’engagement','Période',''];
  document.getElementById('theadrow').innerHTML = COLS.map(function (label, i) {
    var cls = 'px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 '
      + (i === 0 || i > 15 ? 'text-left' : 'text-right') + (i > 0 ? ' border-l border-slate-200/80' : '');
    return '<th class="' + cls + '"' + (i === 0 ? ' style="min-width:220px"' : '') + '>'
      + '<span class="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 font-black uppercase tracking-wide">' + label + '</span></th>';
  }).join('');
  var MONEY = ['12 345,67 €','98 765,43 €','—','1 250,00 €','345 678,90 €','0,00 €','54 321,09 €'];
  var html = '';
  for (var r = 0; r < 30; r += 1) {
    html += '<tr class="border-b border-slate-100 align-top">';
    for (var i = 0; i < COLS.length; i += 1) {
      var cls = 'px-3 py-2.5' + (i > 0 ? ' border-l border-slate-200/70' : '')
        + (i === 0 || i > 15 ? ' text-left' : ' text-right whitespace-nowrap');
      var inner;
      if (i === 0) inner = '<div class="min-w-[220px]"><div class="font-bold text-slate-800 leading-snug">Ligne budgétaire ' + (r + 1) + '</div><div class="text-[11px] text-slate-400 italic max-w-[220px]">note de la ligne</div></div>';
      else if (i === 1) inner = '<span class="inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">Fonctionnement</span>';
      else if (i === 2) inner = 'NOM Prénom';
      else if (i === 16) inner = '2026-12-31';
      else if (i === 17) inner = '2025-01-01 → 2026-12-31';
      else if (i === 18) inner = '—';
      else inner = '<span class="font-bold text-slate-800 whitespace-nowrap">' + MONEY[(r + i) % MONEY.length] + '</span>';
      html += '<td class="' + cls + '">' + inner + '</td>';
    }
    html += '</tr>';
  }
  document.getElementById('tbody').innerHTML = html;
  var wrapper = document.getElementById('wrapper');
  var page = document.getElementById('page');
  var scroll = document.getElementById('scroll');
  var table = document.getElementById('table');
  var scR = scroll.getBoundingClientRect();
  var L = [];
  var put = function (k, v) { L.push('PROBE|' + k + '=' + v); };
  put('vh', window.innerHeight);
  put('wrapper_voverflow', wrapper.scrollHeight - wrapper.clientHeight);
  put('page_voverflow', page.scrollHeight - page.clientHeight);
  put('scroll_clientW', scroll.clientWidth);
  put('scroll_scrollW', scroll.scrollWidth);
  put('table_w', table.offsetWidth);
  put('bar_row_y', Math.round((scR.bottom - 14) * 10) / 10);
  put('bar_visible', (scR.bottom - 14) <= window.innerHeight && (scR.bottom - 14) >= 0);
  put('hscroll_needed', scroll.scrollWidth > scroll.clientWidth);
  put('END', 'ok');
  document.getElementById('report').textContent = L.join('\\n');
})();
</script>
</body>
</html>
`;

const probeHtml = (envelope) => probeShell(envelope) + probeScript;

const runProbe = (html, size) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'recettes-fit-'));
  const file = path.join(dir, 'probe.html');
  writeFileSync(file, html, 'utf8');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'recettes-prof-'));
  const res = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files',
    '--window-size=' + size, '--virtual-time-budget=3000', '--dump-dom',
    'file:///' + file.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const dom = String(res.stdout || '');
  const m = dom.match(/PROBE\|[\s\S]*?PROBE\|END=ok/);
  assert.ok(m, `la sonde n’a rien mesuré (${size}) : ${String(res.stderr || '').slice(0, 300)}`);
  passed += 1;
  const out = {};
  m[0].split('\n').forEach((l) => {
    const i = l.indexOf('=');
    if (l.startsWith('PROBE|') && i > 0) out[l.slice(6, i).trim()] = l.slice(i + 1).trim();
  });
  return out;
};

const LEGACY = 'flex-1 min-h-[280px] flex flex-col';
const fixedNormal = runProbe(probeHtml(ENVELOPE), '1440,900');
const fixedShort = runProbe(probeHtml(ENVELOPE), '1280,560');
const legacyNormal = runProbe(probeHtml(LEGACY), '1440,900');
const legacyShort = runProbe(probeHtml(LEGACY), '1280,560');

/* La table est plus large que la page : la barre horizontale est le SEUL chemin
   vers les colonnes de droite (Solde, Solde prévu, Fin d’engagement, Période et
   les trois boutons de ligne). On ne peut donc PAS la faire tenir en largeur —
   ce qui doit tenir DANS la page, c’est sa boîte, et donc sa barre. */
ok(Number(fixedNormal.table_w) > Number(fixedNormal.scroll_clientW),
  `le tableau (${fixedNormal.table_w} px) est plus large que la page (${fixedNormal.scroll_clientW} px) : sa BOÎTE doit tenir dans la page, pas ses colonnes`);
ok(fixedNormal.hscroll_needed === 'true', 'la table déborde en largeur : la barre horizontale sert vraiment à quelque chose');

/* 1. Fenêtre normale : la barre est dans la fenêtre, la page ne déborde pas. */
ok(fixedNormal.bar_visible === 'true', `fenêtre normale (vh ${fixedNormal.vh}) : la barre horizontale est à l’écran`);
ok(fixedNormal.wrapper_voverflow === '0', `fenêtre normale (vh ${fixedNormal.vh}) : la page ne déborde pas`);
ok(fixedNormal.page_voverflow === '0', 'fenêtre normale : la racine de la page tient dans l’écran');

/* 2. Fenêtre COURTE — le cas de la demande : la table cède de la place et sa
   barre reste à l’écran (l’ancien plancher de 280 px, lui, la cachait). */
ok(fixedShort.bar_visible === 'true', `fenêtre courte (vh ${fixedShort.vh}) : la barre horizontale reste à l’écran`);
ok(fixedShort.wrapper_voverflow === '0', `fenêtre courte (vh ${fixedShort.vh}) : la page ne déborde plus`);
ok(fixedShort.page_voverflow === '0', 'fenêtre courte : la racine de la page tient dans l’écran');
ok(legacyShort.bar_visible === 'false',
  `TÉMOIN NÉGATIF — avec l’ancien plancher (min-h-[280px]), la barre est HORS de l’écran sur une fenêtre courte (vh ${legacyShort.vh})`);
ok(Number(legacyShort.wrapper_voverflow) > 0,
  `TÉMOIN NÉGATIF — et la page déborde de ${legacyShort.wrapper_voverflow} px : il fallait faire défiler la page pour rejoindre la barre`);
ok(legacyNormal.bar_visible === 'true',
  'le plancher ne se voyait pas sur une fenêtre haute (d’où un correctif invisible en apparence)');

console.log(`_recettes_table_fit_test.cjs — ${passed} assertions OK (la table « Lignes budgétaires » tient dans la page : barre horizontale à l’écran, vérifié dans Chrome à deux hauteurs de fenêtre, témoin négatif compris)`);
