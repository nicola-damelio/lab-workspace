/* =========================================================================
   _refresh_shared_read_test.mjs — « 🔄 Refresh NE FAIT PAS SON TRAVAIL »

   Rapporté tel quel : « ho su due schermi lo stesso esperimento ma uno è in una
   finestra normale del browser e l'altra su una finestra in incognito. se su una
   tabella dell'esperimento normale scrivo un numero e clicco refresh su quella
   in incognito non succede niente; se invece ricarico il programma il numero
   appare ».

   Le bouton « 🔄 Refresh » d'une page d'expérience ne faisait que RE-MONTER le
   contenu de la page (clé React) : les sections repartaient donc des données
   EN MÉMOIRE. Or une fenêtre de navigation privée ne partage NI localStorage NI
   la mémoire du programme : tout ce qu'une AUTRE fenêtre venait d'enregistrer
   n'existait pour elle qu'après un rechargement complet (F5), qui relit, lui, la
   source partagée. D'où le symptôme exact : « Refresh ne fait rien, F5 oui ».

   Ce que ce fichier verrouille :

     1. le geste RELIT d'abord la source partagée — le document du dataset dans
        le cloud (Firestore), sinon sa copie sur le Drive
        (`_workspace/datasets/ds_<id>.json`, la même que openDatasetFromDrive) —
        et l'ADOPTE, PUIS re-monte la page (l'ordre inverse ferait repartir les
        sections sur les données d'AVANT) ;
     2. l'adoption passe par le SEUL chemin d'adoption du contenu
        (`openDataset(…, { keepPlace: true })`), donc aucune divergence avec une
        ouverture, et l'utilisateur ne bouge pas : ni module, ni page
        d'administration, ni historique, ni expérience ouverte ;
     3. le résultat est DIT (« ⟳ re-reading… », « shared data re-read », « re-read
        from the Drive copy », ou la raison de l'échec en orange) : un
        rafraîchissement muet est précisément le défaut d'origine.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync('./src/App.jsx', 'utf8');
const ATM = readFileSync('./src/components/AppModules/activeTestModule.jsx', 'utf8');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (actual, expected, what) => { assert.deepEqual(actual, expected, what); passed += 1; };
const has = (src, needle, what) => ok(src.includes(needle), what);
const hasNot = (src, needle, what) => ok(!src.includes(needle), what);

/* Le corps d'une fonction, du `const x = …` jusqu'à la ligne de fermeture. */
const bodyBetween = (src, startNeedle, endNeedle, what) => {
  const from = src.indexOf(startNeedle);
  ok(from >= 0, `${what} : « ${startNeedle.slice(0, 44)}… » est présent`);
  const to = src.indexOf(endNeedle, from);
  ok(to > from, `${what} : la fin de la fonction est trouvable`);
  return src.slice(from, to);
};

/* ── 1. La relecture : le cloud d'abord, la copie du Drive ensuite ─────────── */
const READ = bodyBetween(
  APP,
  'const readSharedDatasetRecord = useCallback(async () => {',
  '}, [currentDatasetId]);',
  'readSharedDatasetRecord',
);
has(READ, 'db.collection(`artifacts/${appId}/public/data/datasets`).doc(id).get()',
  'la relecture lit le DOCUMENT DU DATASET dans le cloud (ce qu’un F5 relit)');
has(READ, "if (data && data.payload) return { record: { ...data, id }, source: 'cloud' }",
  '…et le payload du cloud est rendu tel quel (même forme qu’à l’ouverture)');
ok(READ.indexOf('doc(id).get()') < READ.indexOf('readDatasetCopy(id)'),
  'le cloud est essayé EN PREMIER (écrit ~1,5 s après le calme, la copie Drive ~8 s)');
has(READ, 'const copy = await readDatasetCopy(id).catch(() => null);',
  'sinon la copie du Drive est relue (comme openDatasetFromDrive)');
has(READ, "if (copy && copy.payload) return { record: { ...copy, id }, source: 'drive' };",
  '…et rendue avec sa provenance, pour que la note le dise');
has(READ, "console.warn('Refresh: reading the dataset from the cloud failed",
  'un cloud qui refuse (règles / hors ligne) laisse une trace avant de basculer sur le Drive');
has(READ, "return { record: null, reason: 'shared-copy-unreachable' };",
  'aucune copie lisible est SIGNALÉE (jamais confondue avec « rien à relire »)');
hasNot(READ, 'localStorage',
  'la relecture ne se contente pas du localStorage (une fenêtre privée n’a pas celui de l’autre)');

/* ── 2. L'adoption : un seul chemin, et sans déplacer l'utilisateur ────────── */
const RELOAD = bodyBetween(
  APP,
  'const reloadOpenDatasetFromSharedSource = useCallback(async () => {',
  '}, [readSharedDatasetRecord]);',
  'reloadOpenDatasetFromSharedSource',
);
has(RELOAD, 'if (!openDatasetRef.current(record, { keepPlace: true })) {',
  'la copie relue est adoptée par openDataset avec keepPlace (un SEUL chemin d’adoption)');
has(APP, 'openDatasetRef.current = openDataset;',
  'openDataset est tenu par une ref (il change à chaque rendu — aucun useCallback ne le mémoriserait)');
hasNot(RELOAD, 'openDataset,}', '…et n’est donc pas une dépendance de useCallback (avertissement de lint)');
has(APP, 'const openDataset = (dset, { keepPlace = false } = {}) => {',
  'openDataset accepte keepPlace (défaut false : les ouvertures ne changent pas)');
/* Les sauts de ligne d'App.jsx sont des CRLF : on vise la FORME, pas le octets. */
const GUARD = (body) => new RegExp(`if \\(!keepPlace\\) \\{\\s*\\r?\\n\\s*${body}`);
ok(GUARD("setCurrentModule\\('dashboard'\\);").test(APP),
  'keepPlace garde le MODULE courant (aucun renvoi au dashboard)');
ok(GUARD("setCurrentModule\\('administration'\\);").test(APP),
  '…et garde la page d’administration ouverte (bases administratives)');
eq((APP.match(/if \(!keepPlace\) \{/g) || []).length, 2,
  'exactement les DEUX navigations du chemin d’ouverture sont mises sous condition');
has(APP, 'keepPlace && loadedTests.some((t) => t && t.id === prev) ? prev : loadedTests[0].id',
  'l’expérience ouverte est GARDÉE (rafraîchir la 3ᵉ condition ne ramène pas sur la première)');
has(RELOAD, "return { ok: true, text: source === 'drive' ? 're-read from the Drive copy' : 'shared data re-read' };",
  'la réussite dit D’OÙ viennent les données (cloud ou copie du Drive)');
has(RELOAD, "return { ok: false, text: 'shared data not re-read (cloud / Drive unreachable) — rebuilt from this browser' };",
  'un échec est DIT (et dit aussi que la page a été reconstruite avec les données locales)');
has(RELOAD, "return { ok: false, text: 'shared data unreadable — rebuilt from this browser' };",
  'une charge illisible se distingue d’une source injoignable');

/* ── 3. Le geste : relire AVANT de re-monter ──────────────────────────────── */
const FUNNEL = bodyBetween(
  APP,
  'const refreshTestPage = useCallback(() => {',
  '}, [reloadOpenDatasetFromSharedSource]);',
  'refreshTestPage',
);
has(FUNNEL, 'setTestPageRefresh({ busy: true });',
  'la relecture se dit pendant qu’elle dure (pas de bouton muet)');
has(FUNNEL, 'reloadOpenDatasetFromSharedSource().then((note) => {',
  'le contenu partagé est relu…');
ok(FUNNEL.indexOf('reloadOpenDatasetFromSharedSource().then') < FUNNEL.indexOf('setTestPageNonce((n) => n + 1);'),
  '…AVANT le re-montage (sinon les sections repartent sur les données d’avant)');
ok(FUNNEL.indexOf('reloadOpenDatasetFromSharedSource().then') < FUNNEL.indexOf('setTestPageRefreshedAt(Date.now());'),
  '…et la confirmation est horodatée APRÈS la relecture (l’ancien code la posait seul)');

/* ── 4. Le câblage : la note atteint la barre fine de la page ─────────────── */
has(APP, 'refreshState={testPageRefresh}', 'la note de relecture est passée à la page');
has(APP, 'key={`test-page-${testPageNonce}`}', 'le re-montage par clé React est conservé');
has(APP, 'setTimeout(() => setTestPageRefresh(null), 8000)',
  'la note s’efface toute seule (elle décrit un geste, pas un état)');
has(ATM, 'refreshState = null', 'la page accepte la note (prop par défaut)');
has(ATM, '⟳ re-reading the shared data…', 'la page DIT que la source partagée est en cours de relecture');
has(ATM, "{refreshState.ok ? '↻ ' : '⚠ '}{refreshState.text}",
  '…puis dit ce qui a été relu, ou POURQUOI rien n’a pu l’être');
has(ATM, "? 'text-slate-600 bg-slate-50 border-slate-200' : 'text-amber-700 bg-amber-50 border-amber-300'",
  'un échec est visuellement distinct d’une réussite (orange)');
has(ATM, 'the experiment is FIRST re-read from the shared copy',
  'l’infobulle du bouton annonce la relecture (et non plus un simple re-montage)');
hasNot(ATM, "rebuilt from the experiment's data",
  'l’ancienne promesse (« rebuilt from the experiment’s data ») ne décrit plus le bouton');
has(ATM, '✓ page refreshed', 'la confirmation « ✓ page refreshed » est toujours là');
has(ATM, 'onClick={onRefreshPage}', 'le bouton est toujours branché sur App');

console.log(`✅ _refresh_shared_read_test : ${passed} vérifications passées`
  + ' (🔄 Refresh relit la source partagée avant de reconstruire la page)');
