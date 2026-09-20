/* =========================================================================
   _save_html_test.mjs — « Save HTML » / « Load HTML » : le contenu de la
   sauvegarde est-il À JOUR avec les nouveautés du dataset ?

   Ce qui est vérifié ici est ce qui doit rester vrai (domanda 5) :

     • la sauvegarde HTML contient TOUT l'état du dataset — le même objet que
       l'application synchronise sur Firestore (`latestDataRef`), donc toute
       nouveauté ajoutée à cet état est embarquée automatiquement ;
     • elle embarque en plus ce qui ne vit que dans le navigateur (bibliothèques
       d'images, projets, publications, « Relevant papers ») : sinon une
       restauration les perdrait ;
     • la fenêtre « Load HTML » propose une case par élément : TOUT l'état du
       dataset y figure SAUF les comptes et la configuration de sécurité, qui
       sont globaux à l'application (et documentés comme tels) ;
     • les éléments récents du dataset (protocoles, stockage, concentrations,
       champs obligatoires, couleurs de comparaison) sont bien proposés — c'est
       la question posée : « le texte des protocoles se récupère-t-il avec Load
       HTML ? » → oui.

   Comme App.jsx et loadSelection.js sont du JSX / du JS d'app, l'audit se fait
   SUR LA SOURCE (lecture + analyse des listes de clés), pas par exécution.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const eq = (actual, expected, what) => {
  assert.deepEqual(actual, expected, `${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  passed += 1;
};
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};

const APP = readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8');
const SEL = readFileSync(new URL('./src/utils/loadSelection.js', import.meta.url), 'utf8');

/* ── 1. L'état du dataset embarqué dans la sauvegarde ─────────────────────── */
const stateStart = APP.indexOf('latestDataRef.current = {');
ok(stateStart > 0, 'App.jsx construit bien latestDataRef (l’état du dataset)');
const stateBlock = APP.slice(stateStart, APP.indexOf('};', stateStart));
// Une clé par ligne dans cet objet littéral : on lit les lignes qui ne sont
// qu'un identifiant (avec ou sans virgule finale).
const stateKeys = stateBlock.split('\n')
  .map((l) => l.trim())
  .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*,?$/.test(l))
  .map((l) => l.replace(/,+$/, ''));
ok(stateKeys.length >= 25, `l’état du dataset expose ses clés (${stateKeys.length} trouvées)`);
['tests', 'datasetTitle', 'datasetSubtitle', 'datasetProtocols', 'protocolCategories', 'storages',
 'customConc', 'mandatoryFields', 'mandatoryRules', 'mandatoryBehavior', 'cmpColors', 'molecules',
 'compoundMeta', 'calculationEntries', 'cellLineMeta', 'plasmidMeta', 'nmrInstruments', 'nmrExperiments']
  .forEach((k) => ok(stateKeys.includes(k), `l’état du dataset contient « ${k} »`));

/* ── 2. La sauvegarde y ajoute ce qui vit dans le navigateur ──────────────── */
const payloadStart = APP.indexOf('const getCompressedPayload = () =>');
const payloadBlock = APP.slice(payloadStart, APP.indexOf('}));', payloadStart));
ok(/\.\.\.latestDataRef\.current/.test(payloadBlock), 'la sauvegarde part de TOUT l’état du dataset');
['_figuresLibrary', '_figuresLibraryProjects', 'projects', '_publications', '_excludedPubs', '_relevantPapers', '_relevantSubjects']
  .forEach((k) => ok(new RegExp(`${k}:`).test(payloadBlock), `la sauvegarde embarque « ${k} »`));

/* ── 3. Ce que « Load HTML » propose d'importer ──────────────────────────── */
const offered = new Set();
[...SEL.matchAll(/keys: \[([^\]]*)\]/g)].forEach((m) => {
  m[1].split(',').forEach((k) => {
    const name = k.trim().replace(/^['"]|['"]$/g, '');
    if (name) offered.add(name);
  });
});
ok(offered.size >= 25, `la fenêtre d’import propose les éléments du dataset (${offered.size} clés)`);
ok(offered.has('datasetProtocols'), 'les PROTOCOLES du dataset sont proposés (textes récupérables)');
ok(offered.has('protocolCategories'), 'les catégories de protocoles sont proposées');
ok(offered.has('storages'), 'les emplacements de stockage sont proposés');
ok(offered.has('tests') && offered.has('plates'), 'expériences + plaques sont proposées');
ok(offered.has('customConc'), 'les concentrations personnalisées (nouveauté) sont proposées');
ok(offered.has('mandatoryBehavior'), 'le comportement des champs obligatoires (nouveauté) est proposé');
ok(offered.has('_figuresLibrary') && offered.has('_publications'), 'les bibliothèques d’images et les publications aussi');

/* ── 4. Rien d'important n'est oublié ────────────────────────────────────── */
// Les seules clés d'état VOLONTAIREMENT non importables : les comptes et la
// sécurité. Elles sont globales à l'application (voir l'en-tête du module) et
// ne doivent JAMAIS être écrasées par un fichier de sauvegarde.
const NOT_IMPORTABLE = ['operators', 'authSettings'];
const missing = stateKeys.filter((k) => !offered.has(k) && !NOT_IMPORTABLE.includes(k));
eq(missing, [], 'aucune clé d’état n’est oubliée par la fenêtre d’import');
NOT_IMPORTABLE.forEach((k) => {
  ok(stateKeys.includes(k), `« ${k} » fait partie de l’état (donc de la sauvegarde)`);
  ok(!offered.has(k), `« ${k} » n’est jamais proposé à l’import (données globales)`);
});
ok(/operators\) et la configuration de sécurité \(authSettings\) ne\s+sont JAMAIS importés/.test(SEL),
  'le module d’import documente pourquoi les comptes ne sont pas importés');

/* ── 5. La liste d'import suit automatiquement les nouveautés ─────────────── */
ok(/export const loadSectionsOf/.test(SEL), 'les sections proposées sont DÉRIVÉES de l’état du fichier');
ok(/Object\.keys\(src\)/.test(SEL), 'les collections d’administration sont découvertes toutes seules');
ok(/filterLoadState/.test(SEL), 'la sélection ne garde que les éléments cochés (import partiel sans écrasement)');

/* ── Bilan ────────────────────────────────────────────────────────────────── */
console.log(`_save_html_test.mjs — ${passed} assertions OK`);

ok(/LZString\.compressToUTF16/.test(payloadBlock), 'la sauvegarde est compressée');
