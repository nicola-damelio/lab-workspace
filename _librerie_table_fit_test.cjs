/* =========================================================================
   _librerie_table_fit_test.cjs — la table « Lignes budgétaires » de la page
   « Librairie » tient DANS la page, et la page s’ouvre sans commentaires en tête.

   Demande : « quando ti ho detto che la tabella ligne budgétaires non stava
   nella pagina e di togliere i commenti in cima mi riferivo alla tabella ligne
   budgétaire della pagina librairie » — c’est la MÊME passe que la page
   « Recettes » (voir _recettes_no_totals_banner_test.mjs et
   _recettes_table_fit_test.cjs), appliquée à la sous-table de la Librairie.

   Deux temps, comme les autres sondes du dépôt :
     1. LE SOURCE — la page « Librairie » occupe exactement la hauteur de
        l’écran (`h-full min-h-0`) et CHAQUE table de ses deux onglets cède de
        la place (`flex-1 min-h-0` + `fillHeight`) au lieu de repousser le bas
        de sa boîte — donc sa BARRE HORIZONTALE — sous l’écran ; les pavés
        d’explication de tête (onglet Fournisseurs ET onglet Lignes
        budgétaires) ont disparu, pavé d’en-tête du fichier compris ;
     2. LE MOTEUR — Chrome/Edge en `--headless=new` charge une page de sonde qui
        monte LA MÊME chaîne de classes que l’onglet « Lignes budgétaires »
        (racine, en-tête, onglets, enveloppe, carte SmartTable, bloc défilant,
        table à 10 colonnes `min-width` 1400 px) avec le CSS COMPILÉ de
        l’application, et rapporte ses mesures (comme _ui_skin_pixel_test.cjs).
        Ce qui est exigé : la rangée de la barre horizontale tombe DANS la
        fenêtre, et la page n’a aucun débordement vertical — à hauteur normale
        COMME sur une fenêtre courte. La sonde rejoue AUSSI l’ancien plancher de
        280 px : le TÉMOIN NÉGATIF doit, lui, pousser la barre hors de l’écran,
        sans quoi le correctif ne prouverait rien.
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
const gone = (src, needle, what) => {
  assert.ok(!src.includes(needle), `${what}\n  encore présent : ${needle}`);
  passed += 1;
};

const SRC = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const PAGE = SRC('src/administration/libreriePage.jsx');
const TABLE = SRC('src/administration/smartTable.jsx');

/* ── 1. Le SOURCE : la page occupe l’écran, ses DEUX tables cèdent la place ── */
const grab = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `${what}\n  motif introuvable : ${re}`);
  passed += 1;
  return m[1];
};
const PAGE_ROOT = grab(PAGE, /<div className="(h-full min-h-0 w-full min-w-0 mx-auto flex flex-col gap-4)">/,
  'la racine de la page occupe exactement la hauteur de l’écran');
const ENVELOPE = 'flex-1 min-h-0 flex flex-col';
ok(PAGE.split(`<div className="${ENVELOPE}">`).length - 1 === 2,
  'Librairie : les DEUX tables (fournisseurs et lignes budgétaires) vivent dans une enveloppe extensible');
ok(!/flex-1 min-h-\[/.test(PAGE) && !/min-h-\[280px\]/.test(PAGE),
  'Librairie : plus aucun plancher de hauteur — la table cède de la place au lieu de déborder');
ok((PAGE.match(/\n\s+fillHeight\n/g) || []).length === 2,
  'Librairie : les DEUX SmartTable sont en fillHeight (le bloc défilant prend la hauteur restante)');
const MINW = grab(PAGE, /minWidth="(1400px)"[\s\S]{0,80}?fillHeight/,
  'la table des lignes budgétaires garde sa largeur minimale');
has(TABLE, '.st-scroll::-webkit-scrollbar { height: 14px; }',
  'SmartTable : la barre horizontale des grands tableaux fait 14 px (elle ne passe plus inaperçue)');
has(TABLE, 'st-scroll ${fillHeight', 'SmartTable : le bloc défilant porte la classe .st-scroll');

/* ── 2. Les pavés d’explication de tête ont disparu ────────────────────────
   Le pavé se reconnaît à sa classe (bordure claire + fond très clair + texte
   11px « leading-relaxed ») : la page n’en porte plus aucun, et l’en-tête du
   FICHIER a été ramené à sa seule bannière (comme recettesPage.jsx). */
gone(PAGE, 'rounded-xl border border-indigo-100 bg-indigo-50/60',
  'Librairie : le pavé « Fonctionnement » de l’onglet Fournisseurs a disparu');
gone(PAGE, 'rounded-xl border border-blue-100 bg-blue-50/60',
  'Librairie : le pavé « Lignes budgétaires » de la sous-table a disparu');
gone(PAGE, 'Fonctionnement :</b>', 'Librairie : …et sa première phrase');
gone(PAGE, 'catalogue des lignes (Fonctionnement / Investissement / Salaire)',
  'Librairie : …et la phrase qui décrivait les lignes budgétaires');
gone(PAGE, '💡 « ＋ Nouvelle ligne budgétaire »',
  'Librairie : …et son aide (l’infobulle du bouton dit déjà ce qu’il fait)');
gone(PAGE, 'depuis la page Dépenses, un fournisseur ou une ligne budgétaire cliquable',
  'Librairie : l’en-tête ne porte plus l’explication du clic inter-pages');
gone(PAGE, 'text-slate-400 max-w-2xl', 'Librairie : …et la largeur qui allait avec');
gone(PAGE, '{/* En-tête */}', 'Librairie : plus de commentaire d’en-tête JSX');
gone(PAGE, '{/* Onglets', 'Librairie : plus de commentaire au-dessus des onglets');
gone(PAGE, 'Page « Librerie » — catalogue des fournisseurs',
  'Librairie : le pavé d’en-tête du FICHIER a été retiré lui aussi');
has(PAGE, 'src/administration/libreriePage.jsx',
  'Librairie : la bannière du fichier (son chemin) est conservée');

/* ── 3. Ce qui RESTE : compteurs, boutons, onglets, colonnes, états vides ─── */
has(PAGE, 'au catalogue · ', 'Librairie : le compteur « fournisseurs au catalogue · lignes budgétaires » reste');
has(PAGE, '<span aria-hidden="true">📇</span> Fournisseurs', 'Librairie : l’onglet « Fournisseurs » reste');
has(PAGE, '<span aria-hidden="true">📈</span> Lignes budgétaires', 'Librairie : l’onglet « Lignes budgétaires » reste');
has(PAGE, '＋</span> Nouvelle ligne budgétaire', 'Librairie : le bouton « ＋ Nouvelle ligne budgétaire » reste');
has(PAGE, '＋</span> Ajouter un fournisseur', 'Librairie : le bouton « ＋ Ajouter un fournisseur » reste');
has(PAGE, '↻</span> Créer depuis les Dépenses', 'Librairie : le bouton de synchronisation des Dépenses reste');
has(PAGE, "key: 'ligne', label: 'Ligne budgétaire'", 'Librairie : la colonne « Ligne budgétaire » reste');
has(PAGE, 'minWidth="1750px"', 'Librairie : la table des fournisseurs garde sa largeur minimale');
has(PAGE, 'searchPlaceholder="Rechercher une ligne, un acronyme, un porteur…"',
  'Librairie : la recherche de la sous-table reste');
has(PAGE, "key: 'fournisseur', label: 'Fournisseur'", 'Librairie : les colonnes du catalogue restent');
has(PAGE, 'Aucune ligne budgétaire', 'Librairie : l’état vide des lignes budgétaires reste');
has(PAGE, 'Catalogue des fournisseurs vide', 'Librairie : l’état vide du catalogue reste');
has(PAGE, 'Rechercher un fournisseur, contact, email, adresse, référence SIFAC…',
  'Librairie : la recherche du catalogue reste');
/* La notification (ligne budgétaire enregistrée / supprimée, fournisseur créé)
   est remontée AU-DESSUS des onglets : elle s’affiche sur les deux onglets. */
ok(PAGE.indexOf('{notice &&') > 0
  && PAGE.indexOf('{notice &&') < PAGE.indexOf("{tab === 'fournisseurs' ? ("),
  'Librairie : le bandeau de notification est rendu AVANT les onglets (il s’affiche donc aussi dans l’onglet Lignes budgétaires)');

/* ── 4. LE MOTEUR : la même chaîne de classes, mesurée par Chrome ─────────── */
const CARD = 'bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden '
  + grab(TABLE, /bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden \$\{fillHeight \? '([^']+)'/,
    'la carte SmartTable devient une colonne flex extensible en fillHeight');
const SCROLL = grab(TABLE, /(overflow-auto custom-scrollbar overscroll-contain [\w-]+) \$\{fillHeight \? '([^']+)'/,
  'le bloc défilant est le conteneur du défilement')
  + ' ' + grab(TABLE, /overflow-auto custom-scrollbar overscroll-contain [\w-]+ \$\{fillHeight \? '([^']+)'/,
    'en fillHeight, le bloc défilant prend la hauteur restante');

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
  console.log(`_librerie_table_fit_test.cjs — ${passed} assertions OK (SOURCE seul : ni Chrome/Edge, ou pas de CSS compilé \`npx vite build\`)`);
  process.exit(0);
}

/* La page de sonde : la chaîne de classes réelle de l’onglet « Lignes
   budgétaires » — racine, en-tête (compteurs + bouton), onglets, enveloppe,
   carte SmartTable, bloc défilant et table à 10 colonnes `min-width` 1400 px,
   30 lignes. Seule la barre d’outils de la SmartTable est recopiée en dur
   (mêmes classes que le composant) : sa hauteur ne déplace pas la barre
   horizontale, qui est au bas du bloc défilant. */
const probeShell = (envelope) => `<!doctype html>
<html lang="fr" class="h-full">
<head>
<meta charset="utf-8" />
<title>PROBE librairie fit</title>
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
          <p class="text-[10px] font-bold uppercase tracking-wide text-slate-400 -mt-0.5">Librairie · base d’administration (dataset unique)</p>
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
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <p class="text-xs font-bold text-slate-400">12 fournisseurs au catalogue · 34 lignes budgétaires</p>
          <div class="flex items-center gap-2 flex-wrap">
            <button class="bg-blue-600 text-white font-bold text-sm px-4 py-2 rounded-xl shadow-sm flex items-center gap-1.5"><span class="text-base leading-none">＋</span> Nouvelle ligne budgétaire</button>
          </div>
        </div>
        <div class="flex items-center gap-1.5 bg-slate-200/60 border border-slate-200 rounded-xl p-1 w-fit">
          <button class="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg text-slate-500 border border-transparent"><span aria-hidden="true">📇</span> Fournisseurs<span class="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">12</span></button>
          <button class="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg bg-white text-slate-800 shadow-sm border border-slate-200"><span aria-hidden="true">📈</span> Lignes budgétaires<span class="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">34</span></button>
        </div>
        <div id="tablewrap" class="${envelope}">
          <div id="card" class="${CARD}">
            <div class="shrink-0 px-3 py-2 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <div class="flex items-center gap-1.5 min-w-[220px] flex-1">
                <span class="text-slate-300 text-sm leading-none">🔍</span>
                <input placeholder="Rechercher une ligne, un acronyme, un porteur…" class="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold text-slate-400 whitespace-nowrap">34 / 34</span>
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
  var COLS = ['Ligne budgétaire','Acronyme','Type','Porteur du projet','Budget total',
    'Mis à dispo (université)','Période','Date de fin d’engagement','Commentaires',''];
  document.getElementById('theadrow').innerHTML = COLS.map(function (label, i) {
    var cls = 'px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b-2 border-slate-200 '
      + (i === 0 || i >= 6 ? 'text-left' : 'text-right') + (i > 0 ? ' border-l border-slate-200/80' : '');
    return '<th class="' + cls + '"' + (i === 0 ? ' style="min-width:180px"' : '')
      + '><span class="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 font-black uppercase tracking-wide">' + label + '</span></th>';
  }).join('');
  var MONEY = ['345 678,90 €','98 765,43 €','—','1 250,00 €','12 345,67 €','0,00 €','54 321,09 €'];
  var html = '';
  for (var r = 0; r < 30; r += 1) {
    html += '<tr class="border-b border-slate-100 align-top">';
    for (var i = 0; i < COLS.length; i += 1) {
      var cls = 'px-3 py-2.5' + (i > 0 ? ' border-l border-slate-200/70' : '')
        + (i === 0 || i >= 6 ? ' text-left' : ' text-right whitespace-nowrap');
      var inner;
      if (i === 0) inner = '<div class="min-w-[180px] max-w-[260px]"><div class="font-mono text-[11px] font-bold text-indigo-700 leading-snug break-words">S2R0' + (r + 1) + 'GEC (INTRUDE)</div></div>';
      else if (i === 1) inner = '<span class="inline-block font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600">S2R0' + (r + 1) + '</span>';
      else if (i === 2) inner = '<span class="inline-block text-[10px] font-black uppercase px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700">Fonctionnement</span>';
      else if (i === 3) inner = 'NOM Prénom';
      else if (i === 6) inner = '2025-01-01 → 2026-12-31';
      else if (i === 7) inner = '2026-12-31';
      else if (i === 8) inner = '<span class="text-xs text-slate-500">note de la ligne budgétaire</span>';
      else if (i === 9) inner = '<div class="flex items-center gap-1 whitespace-nowrap"><button class="text-[11px] font-black px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">🔗</button><button class="text-[11px] font-black px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700">✎</button><button class="text-[11px] font-black px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-500">🗑</button></div>';
      else inner = '<span class="whitespace-nowrap text-xs font-black text-slate-700 tabular-nums">' + MONEY[(r + i) % MONEY.length] + '</span>';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'librairie-fit-'));
  const file = path.join(dir, 'probe.html');
  writeFileSync(file, html, 'utf8');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'librairie-prof-'));
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
   vers les colonnes de droite (Période, Fin d’engagement, Commentaires et les
   trois actions de ligne). On ne peut donc PAS la faire tenir en largeur — ce
   qui doit tenir DANS la page, c’est sa boîte, et donc sa barre. */
ok(Number(fixedNormal.table_w) >= 1400,
  `le tableau respecte son min-width (${fixedNormal.table_w} px) : sa BOÎTE doit tenir dans la page, pas ses colonnes`);
ok(fixedShort.hscroll_needed === 'true',
  'sur une fenêtre courte, la table déborde en largeur : la barre horizontale sert vraiment à quelque chose');

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

console.log(`_librerie_table_fit_test.cjs — ${passed} assertions OK (la table « Lignes budgétaires » de la page Librairie tient dans la page : barre horizontale à l’écran, vérifié dans Chrome à deux hauteurs de fenêtre, témoin négatif compris ; et les pavés d’explication de tête ont disparu)`);
