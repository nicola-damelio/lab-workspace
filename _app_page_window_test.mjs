/* =========================================================================
   _app_page_window_test.mjs — OUVRIR UNE PAGE DANS UNE AUTRE FENÊTRE.

   La demande, mot pour mot : « When clicking in different pages or instance, it
   should be possible to open that page in another window, not to loose the
   content of that page and having to wait to reload it when I'm back on that
   page. »

   CE QUI EST VÉRIFIÉ ICI :

     §1 `pageFromUrl` — la page qu'une URL réclame (`?mod=…`), EXÉCUTÉE : seules
        les pages de la barre (APP_PAGE_IDS) sont acceptées, tout le reste rend
        null (une valeur inventée n'ouvre pas une page vide).
     §2 `urlWithoutMod` — la même URL nettoyée de `&mod=`, EXÉCUTÉE : la base
        (`?dataset=…`) et les autres paramètres restent, et sans requête il ne
        reste que le chemin.
     §3 `openPageInNewWindow` (App.jsx) — le geste du ⧉, EXÉCUTÉ avec un faux
        `window` : l'URL porte la base ET la page, une page inconnue retombe sur
        « dashboard », et une fenêtre bloquée par le navigateur est DITE.
     §4 LE CÂBLAGE : la barre latérale offre ⧉ pour chaque page, App.jsx relit
        `?mod=` au démarrage d'une base et lui passe le geste ; la liste des pages
        n'existe qu'une fois (APP_NAV_ITEMS → APP_PAGE_IDS).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu : ${JSON.stringify(a)}`);
  passed += 1;
};

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const APP = read('./src/App.jsx');
const SIDEBAR = read('./src/components/AppModules/appSidebar.jsx');
const maskOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
const MASK = maskOf(APP);
const hasApp = (needle, what) => ok(APP.includes(needle), `${what}\n  introuvable : ${needle}`);
const hasSide = (needle, what) => ok(SIDEBAR.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── Extraction : `const name = (…) => …;`, `const name = useCallback((…) => { … }, […]);` ── */
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = MASK[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};
/** Le CORPS (sans les accolades) de la flèche qui suit `anchor` — ça marche pour
 *  une fonction simple comme pour un `useCallback(() => { … }, [deps])`. */
const arrowBody = (src, anchor) => {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `ancre introuvable : ${anchor}`);
  const open = src.indexOf('{', src.indexOf('=>', i));
  assert.ok(open >= 0, `corps introuvable : ${anchor}`);
  let depth = 0;
  for (let k = open; k < src.length; k += 1) {
    if (MASK[k] === '{') depth += 1;
    else if (MASK[k] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, k); }
  }
  throw new Error(`${anchor} : corps non terminé`);
};

const PAGE_IDS = ['dashboard', 'projects', 'tests', 'notebook', 'library', 'agenda',
  'protocols', 'storage', 'calculations', 'publications', 'image-builder', 'settings'];

/* ══ §1. LA PAGE QU'UNE URL RÉCLAME ═══════════════════════════════════════════ */
const { pageFromUrl, urlWithoutMod } = new Function('APP_PAGE_IDS', [
  sliceDecl(APP, 'pageFromUrl'),
  sliceDecl(APP, 'urlWithoutMod'),
  'return { pageFromUrl, urlWithoutMod };',
].join('\n'))(PAGE_IDS);

eq(pageFromUrl('?dataset=ds_1&mod=tests'), 'tests', '« ?mod=tests » ouvre la page des expériences');
eq(pageFromUrl('?mod=image-builder&dataset=ds_1'), 'image-builder', 'l’ordre des paramètres n’a pas d’importance');
eq(pageFromUrl('?mod=laboratory'), null, 'une page que la barre ne propose pas n’ouvre rien');
eq(pageFromUrl('?mod=administration'), null, 'la base d’administration a sa propre navigation : sa page ne se demande pas par une URL');
eq(pageFromUrl('?dataset=ds_1'), null, 'sans « mod », la page reste celle du démarrage');
eq(pageFromUrl(''), null, 'sans requête du tout non plus');
eq(pageFromUrl(null), null, 'et une valeur absente ne fait pas lever la lecture');
PAGE_IDS.forEach((id) => ok(pageFromUrl(`?mod=${id}`) === id, `[${id}] la page de la barre se demande par son identifiant`));

/* ══ §2. LA MÊME URL SANS `&mod=` ═════════════════════════════════════════════ */
eq(urlWithoutMod('?dataset=ds_1&mod=tests', '/'), '/?dataset=ds_1',
  'la fenêtre neuve retire « mod » et GARDE la base qu’elle vient d’ouvrir');
eq(urlWithoutMod('?mod=tests', '/'), '/', '…et s’il ne restait que « mod », il ne reste que le chemin');
eq(urlWithoutMod('?dataset=ds_1&drive-bootstrap=1&mod=library', '/'), '/?dataset=ds_1&drive-bootstrap=1',
  'les autres paramètres de l’adresse sont conservés (le marqueur de démarrage du Drive compris)');
eq(urlWithoutMod('', '/index.html'), '/index.html', 'sans requête, le chemin est rendu tel quel');

/* ══ §3. LE GESTE DU ⧉, EXÉCUTÉ ═══════════════════════════════════════════════ */
// Un faux `window` complet (open + alert), pour chaque scénario.
const scenario = (moduleId, datasetId, opts = {}) => {
  const calls = { opened: [], alerts: [] };
  const window = {
    location: { origin: 'https://lab.example', pathname: '/index.html' },
    open: (url, target, features) => { calls.opened.push({ url, target, features }); return opts.blocked ? null : { url }; },
    alert: (m) => calls.alerts.push(m),
  };
  const fn = new Function(
    'moduleId', 'currentDatasetId', 'APP_PAGE_IDS', 'appPageLabel', 'window',
    `${arrowBody(APP, 'const openPageInNewWindow = useCallback((moduleId) => {')}\nreturn openPageInNewWindow(moduleId);`,
  )(moduleId, datasetId, PAGE_IDS, (id) => `page:${id}`, window);
  return { calls, returned: fn };
};

const win = scenario('tests', 'ds_42');
eq(win.calls.opened.length, 1, '⧉ ouvre UNE fenêtre');
eq(win.calls.opened[0].url, 'https://lab.example/index.html?dataset=ds_42&mod=tests',
  '…sur la MÊME base et sur la page demandée');
eq(win.calls.opened[0].target, '_blank', '…dans un nouvel onglet / une nouvelle fenêtre');
ok(String(win.calls.opened[0].features).includes('noopener'),
  '…sans donner à la fenêtre neuve la main sur celle-ci (noopener)');
ok(win.returned && win.returned.url, 'le geste rend la fenêtre ouverte (l’appelant peut la suivre)');

eq(scenario('inventée', 'ds_42').calls.opened[0].url, 'https://lab.example/index.html?dataset=ds_42&mod=dashboard',
  'une page inconnue retombe sur la page d’accueil (jamais une page vide)');
eq(scenario('library', null).calls.opened[0].url, 'https://lab.example/index.html?mod=library',
  'sans base ouverte, la fenêtre neuve ne porte que la page demandée');
const blocked = scenario('publications', 'ds_7', { blocked: true });
eq(blocked.returned, null, 'une fenêtre refusée par le navigateur est rendue telle quelle (null)');
eq(blocked.calls.alerts.length, 1, '…et l’utilisateur est PRÉVENU (jamais un bouton qui ne fait rien)');
ok(blocked.calls.alerts[0].includes('page:publications'),
  '…le message nomme la page et rappelle que CETTE fenêtre garde ce qu’elle a chargé');

/* ══ §4. LE CÂBLAGE ═══════════════════════════════════════════════════════════ */
// La liste des pages n'existe qu'UNE fois : la navigation et APP_PAGE_IDS en
// dérivent, donc ⧉ et `?mod=` ne peuvent pas diverger de ce que la barre propose.
hasSide("export const ADMIN_PAGE_ID = 'administration';", 'la page d’administration a son identifiant nommé');
hasSide('export const APP_NAV_ITEMS = [', 'la barre décrit ses pages à UN seul endroit');
hasSide('.filter((n) => n.id !== ADMIN_PAGE_ID)', '…et APP_PAGE_IDS est dérivé de cette liste');
ok(SIDEBAR.includes("{ id: ADMIN_PAGE_ID, icon: '🏛️', label: 'Administration' }"),
  'l’entrée de la base d’administration reste dans la liste unique');
hasSide('onOpenPageInNewWindow,', 'la barre reçoit le geste en propriété (composant sans état)');
hasSide('onClick={() => onOpenPageInNewWindow(nav.id)}', '…et chaque entrée de la navigation le propose');
hasSide('aria-label={`Open ${nav.label} in a new window`}', '…avec un libellé lisible par un lecteur d’écran');
hasSide("title={`Open “${nav.label}” in a SECOND browser window", '…et une infobulle qui dit ce que la fenêtre garde');
hasSide("isSidebarOpen && !adminOnly && typeof onOpenPageInNewWindow === 'function'",
  'le geste n’est offert que sur les pages d’une base scientifique, barre ouverte');

hasApp("import { AppSidebar, APP_PAGE_IDS, appPageLabel } from './components/AppModules/appSidebar';",
  'App.jsx partage la liste des pages et le libellé avec la barre');
hasApp('const openPageInNewWindow = useCallback((moduleId) => {', 'le geste est défini dans App (il connaît la base ouverte)');
hasApp('onOpenPageInNewWindow={openPageInNewWindow}', '…et passé à la barre latérale');
hasApp('const wanted = pageFromUrl(window.location.search);', 'la fenêtre neuve relit `?mod=` au démarrage');
hasApp('setCurrentModule(wanted);', '…et ouvre la page demandée');
hasApp("window.history.replaceState({}, '', urlWithoutMod(window.location.search, window.location.pathname));",
  '…puis efface `mod` de son adresse (la navigation qui suit reste celle de l’utilisateur)');
hasApp('}, [currentDatasetId]);', 'la relecture s’applique à l’ouverture d’une base, une fois');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_app_page_window_test.mjs — ${passed} assertions OK (⧉ une page dans une autre fenêtre · ?mod= relu au démarrage)`);

