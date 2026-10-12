/* =========================================================================
   _budget_line_filter_test.mjs — sélecteur de LIGNE BUDGÉTAIRE de la page
   « Budget overview » (src/administration/budgetPage.jsx).

   La page pose un sélecteur en tête qui restreint TOUTES les sources
   (dépenses, lignes, OM, souhaits, remboursements, devis & BC) à UNE SEULE
   ligne budgétaire, « GEC NA » par défaut. Deux points sont vérifiés :

   1. le CÂBLAGE dans le source — le sélecteur existe, il est alimenté par les
      fiches Recettes, et le filtre est appliqué aux six sources ;
   2. le COMPORTEMENT des helpers purs — le test EXTRAIT du source réel les
      fonctions `lineKey` / `lineCore` / `lineMatcher` et les exécute (ce n’est
      donc pas une ré-écriture du code, mais le code expédié) sur les intitulés
      réels du module budget historique : « GEC NA (NA) » — en deux fiches
      jumelles Fonctionnement / Investissement —, « S2R01GEC (INTRUDE) »,
      « Valcelmat (FED25001) ».

   Repères retenus par l’implémentation :
     · la CLÉ d’une ligne est son intitulé exact normalisé (« gec na na »), si
       bien que les deux fiches jumelles d’une même ligne tombent sur la même
       entrée du menu, sans confondre des lignes aux codes différents ;
     · le CŒUR sans parenthèses (« gec na ») sert au nom court « GEC NA » et
       rattrape les enregistrements qui ne porteraient que ce nom court.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/administration/budgetPage.jsx', 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
const check = (fn, what) => { fn(); passed += 1; return what; };

/* ── 1. Câblage dans le source ───────────────────────────────────────────── */
const has = (needle, what) => check(
  () => assert.ok(src.includes(needle), `${what}\n  introuvable : ${needle}`),
  what,
);
has('const [lineFilter, setLineFilter] = useState(DEFAULT_LINE_KEY);', 'le sélecteur a un état, initialisé sur la ligne par défaut');
has('const activeLine = lineFilter === LINE_FILTER_ALL', 'la ligne active retombe sur le défaut quand la clé n’existe plus');
has('const defaultLineKey = useMemo(() => {', 'la ligne « GEC NA » est retrouvée dans les fiches Recettes');
has('lineOptions.find((o) => o.core === DEFAULT_LINE_KEY)', '…y compris par le nom court, sans la partie entre parenthèses');
has('id="budget-line-filter"', 'le <select> est présent dans la carte d’en-tête');
has('onChange={(e) => setLineFilter(e.target.value)}', 'le <select> pilote bien l’état du filtre');
has('<option value={LINE_FILTER_ALL}>📚 Toutes les lignes budgétaires</option>', 'une entrée « toutes les lignes » reste disponible');
has('{lineOptions.map((o) => (', 'les entrées du menu viennent des fiches Recettes');
has('const recettes = useMemo(() => keep(rawRecettes)', 'la source « lignes » passe par le filtre');
// Les cinq autres sources (dépenses, OM, souhaits, remboursements, devis & BC).
['depenses', 'om', 'desiderate', 'reimbursements', 'devisBc'].forEach((k) => {
  has(`const ${k} = useMemo(() => keep(Array.isArray(data.${k}) ? data.${k} : []), [keep, data]);`, `la source « ${k} » passe par le filtre`);
});

/* ── 2. Les helpers purs, extraits du source réel ────────────────────────── */
/* On prélève les définitions par ancrages textuels, puis on les évalue : si
   une définition disparaît ou change de forme, le test le dit clairement. */
const between = (from, to) => {
  const i = src.indexOf(from);
  const j = i < 0 ? -1 : src.indexOf(to, i + from.length);
  assert.ok(i >= 0 && j > i, `segment source « ${from} » → « ${to} » introuvable`);
  return src.slice(i, j);
};
const defLine = (name) => {
  const m = src.match(new RegExp(`^const ${name} = .*$`, 'm'));
  assert.ok(m, `définition d’une ligne « ${name} » introuvable`);
  return m[0];
};
const code = [
  between('const txt = ', 'const euroFull'),
  between('const normLabel = ', 'const isoDate'),
  defLine('LINE_FILTER_ALL'),
  defLine('DEFAULT_LINE_LABEL'),
  defLine('lineKey'),
  defLine('lineCore'),
  defLine('DEFAULT_LINE_KEY'),
  defLine('RECORD_LINE_ID_FIELDS'),
  defLine('RECORD_LINE_LABEL_FIELDS'),
  between('const lineMatcher = ', '\n\n/* '),
].join('\n\n');
const box = new Function(`${code}\nreturn { lineKey, lineCore, lineMatcher, DEFAULT_LINE_KEY, LINE_FILTER_ALL };`)();

/* 2a. Clé exacte et cœur sans parenthèses */
check(() => assert.equal(box.lineKey('GEC NA (NA)'), 'gec na na'), 'lineKey conserve le code projet');
check(() => assert.equal(box.lineKey('GEC NA'), 'gec na'), 'lineKey du nom court');
check(() => assert.equal(box.lineKey('  gec   na (NA) '), 'gec na na'), 'lineKey normalise espaces / casse');
check(() => assert.equal(box.lineCore('GEC NA (NA)'), 'gec na'), 'lineCore retire la partie entre parenthèses');
check(() => assert.equal(box.lineCore('GEC NA'), 'gec na'), 'lineCore du nom court');
check(() => assert.equal(box.lineCore('gec-na'), 'gec na'), 'lineCore normalise la ponctuation');
check(() => assert.equal(box.lineCore('S2R01GEC (INTRUDE)'), 's2r01gec'), 'lineCore d’une autre ligne');
check(() => assert.equal(box.DEFAULT_LINE_KEY, 'gec na'), 'le défaut « GEC NA » est bien le cœur recherché');
check(() => assert.notEqual(box.lineKey('GEC NA (NA)'), box.lineKey('S2R01GEC (INTRUDE)')), 'deux lignes distinctes restent distinctes');

/* 2b. Prédicat : ids des fiches jumelles, intitulé exact, nom court */
const recettes = [
  { id: 'r1', ligne: 'GEC NA (NA)', type: 'Fonctionnement' },
  { id: 'r2', ligne: 'GEC NA (NA)', type: 'Investissement' },
  { id: 'r3', ligne: 'S2R01GEC (INTRUDE)', type: 'Fonctionnement' },
  { id: 'r4', ligne: 'Valcelmat (FED25001)', type: 'Fonctionnement' },
];
const targetKey = box.lineKey('GEC NA (NA)');
const targetCore = box.lineCore('GEC NA (NA)');
const m = box.lineMatcher(recettes, targetKey, targetCore);
[
  [{ id: 'd1', recetteId: 'r1', ligneBudgetaire: 'GEC NA (NA)' }, true, 'dépense imputée à la fiche jumelle « Fonctionnement »'],
  [{ id: 'd2', recetteId: 'r2', ligneBudgetaire: 'GEC NA (NA)' }, true, 'dépense imputée à la fiche jumelle « Investissement »'],
  [{ id: 'd3', recetteId: 'r3', ligneBudgetaire: 'S2R01GEC (INTRUDE)' }, false, 'dépense d’une autre ligne (id)'],
  [{ id: 'd4', ligneBudgetaire: 'S2R01GEC (INTRUDE)' }, false, 'dépense d’une autre ligne (intitulé)'],
  [{ id: 'd5', ligneBudgetaire: 'GEC NA (NA)' }, true, 'dépense qui ne porte que l’intitulé exact'],
  [{ id: 'd6', ligneBudgetaire: 'GEC NA' }, true, 'dépense qui ne porte que le nom court'],
  [{ id: 'd7', recetteId: 'r1' }, true, 'enregistrement qui ne porte que l’id'],
  [{ id: 'd8', recetteSuggereeId: 'r2' }, true, 'souhait imputé via recetteSuggereeId'],
  [{ id: 'd9', recetteSuggereeId: 'r4' }, false, 'souhait d’une autre ligne'],
  [{ id: 'd10' }, false, 'enregistrement sans ligne du tout'],
  [null, false, 'valeur nulle'],
].forEach(([rec, expected, what]) => check(
  () => assert.equal(Boolean(m(rec)), expected, `${what} → attendu ${expected}`),
  what,
));

/* 2c. Les fiches Recettes (source « lignes ») : les jumelles restent ensemble */
check(
  () => assert.deepEqual(recettes.filter(m).map((r) => r.id), ['r1', 'r2'], 'seules les fiches « GEC NA » sont gardées'),
  'la source « lignes » est filtrée sur la ligne choisie',
);

/* 2d. Sélection par défaut : le nom court « GEC NA » mène à « GEC NA (NA) » */
const lineOptions = [...new Map(recettes.map((r) => {
  const key = box.lineKey(r.ligne);
  return [key, { key, label: r.ligne, core: box.lineCore(r.ligne) }];
})).values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
check(() => assert.equal(lineOptions.length, 3, 'les fiches jumelles sont fusionnées'), 'menu sans doublon de jumelles');
const defaultLineKey = (lineOptions.find((o) => o.key === box.DEFAULT_LINE_KEY)
  || lineOptions.find((o) => o.core === box.DEFAULT_LINE_KEY) || {}).key || null;
check(() => assert.equal(defaultLineKey, 'gec na na'), 'le défaut « GEC NA » tombe sur la fiche « GEC NA (NA) »');
check(() => assert.notEqual(defaultLineKey, box.LINE_FILTER_ALL), 'le défaut n’est pas « toutes les lignes »');

console.log(`_budget_line_filter_test.mjs — ${passed} assertions OK : sélecteur de ligne budgétaire de « Budget overview », « GEC NA » par défaut, filtre appliqué aux six sources.`);
