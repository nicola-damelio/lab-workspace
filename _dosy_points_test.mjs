/* =========================================================================
   _dosy_points_test.mjs — la gestion des points de la page DOSY : exclusion
   par clic sur le graphe, ±SD imposé dans le tableau « Points & ±SD », et
   l'import de texte qui doit accepter les DEUX dispositions.

   Ce qui doit rester vrai :

     • le clic sur un point exclut / ré-inclut ce point — Chart.js n'appelle
       QUE `options.onClick` : un gestionnaire posé sur un dataset (ce que
       faisait la page) n'est jamais déclenché ;
     • « Show Excl. Points » (Error Management) décide si un point exclu reste
       VISIBLE, dessiné comme une croix grise, exactement comme sur une plaque ;
     • les deux tableaux (données et « Points & ±SD ») sont TRANSPOSÉS — un
       jeu d'intensités par ligne, un pourcentage de gradient par colonne — et
       un point exclu y apparaît barré et grisé ;
     • « Fixed » n'est proposé QU'UNE fois (le bloc « Fixed SD + » du panneau
       partagé est masqué) et un ±SD imposé arrive bien dans les barres
       d'erreur.

   Les fonctions pures d'import (`dosyLooksLikeGradients`, `parseDosyText`,
   `dosyLayoutFromMatrix`) sont RÉELLEMENT exécutées (extraction du JSX +
   `new Function`, comme _compact_sections_test.mjs) ; le reste est vérifié
   sur la source, comme les autres garde-fous du dépôt (les sections sont du
   JSX).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const DOSY = read('src/components/DOSYTestRenderer.jsx');
const SAT = read('src/components/SharedAnalysisTools.jsx');
const PLATE = read('src/components/PlateSections.jsx');

const results = [];
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true, got: '' }); }
  catch (e) { results.push({ name, ok: false, got: e.message }); }
};
const eq = (a, b, msg) => assert.deepEqual(a, b, msg || `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
const ok = (cond, msg) => assert.ok(cond, msg);

/* ══ 1. LES HELPERS D'IMPORT, VRAIMENT EXÉCUTÉS ════════════════════════════ */

const grab = (name, end) => {
  const m = DOSY.match(new RegExp(`const ${name} = [\\s\\S]*?${end}`));
  assert.ok(m, `DOSYTestRenderer.jsx : ${name} introuvable`);
  return m[0];
};
const dosy = new Function([
  grab('dosyLooksLikeGradients', '\n};'),
  grab('parseDosyText', '\n};'),
  grab('dosyLayoutFromMatrix', '\n};')
].join('\n') + '\nreturn { dosyLooksLikeGradients, parseDosyText, dosyLayoutFromMatrix };')();

const layoutOf = (text, orientation = 'auto') => {
  const p = dosy.parseDosyText(text, orientation);
  return { ...dosy.dosyLayoutFromMatrix(p.matrix, p.orientation), orientation: p.orientation, error: p.error };
};

/* Collage « tableur » : pourcentage de gradient en PREMIÈRE COLONNE. */
const COLUMN_PASTE = 'Gradient %\tIntensity 1\tIntensity 2\n0\t100\t50\n5\t98\t48\n10\t95\t45\n';

/* Collage de la table TRANSPOSÉE (celle de la page) : gradient en PREMIÈRE
   LIGNE, y compris la cellule d'angle « Intensity set \ Gradient % ». */
const ROW_PASTE = 'Intensity set \\ Gradient %\t0\t5\t10\nIntensity 1\t100\t98\t95\nIntensity 2\t50\t48\t45\n';

check('1 un axe de gradients est reconnu, un axe d’intensités non', () => {
  eq(dosy.dosyLooksLikeGradients([0, 5, 10, 100]), true);
  eq(dosy.dosyLooksLikeGradients([100, 98, 95]), false, 'une décroissance n’est pas un axe de gradients');
  eq(dosy.dosyLooksLikeGradients([0, 150]), false, 'au-delà de 100 % ce n’est plus un gradient');
  eq(dosy.dosyLooksLikeGradients([5]), false, 'un point isolé ne fait pas un axe');
});

check('2 disposition « première colonne » : le tableau d’origine passe encore', () => {
  const l = layoutOf(COLUMN_PASTE);
  eq(l.orientation, 'column');
  eq(l.error, null);
  eq(l.delays, [0, 5, 10]);
  eq(l.series, [[100, 98, 95], [50, 48, 45]]);
  eq([l.nGradients, l.nSeries], [3, 2]);
});

check('3 disposition « première ligne » : la table transposée est lue alignée', () => {
  const l = layoutOf(ROW_PASTE);
  eq(l.orientation, 'row');
  eq(l.delays, [0, 5, 10], 'la ligne des gradients (et sa cellule d’angle) est écartée du décalage');
  eq(l.series, [[100, 98, 95], [50, 48, 45]]);
});

check('4 les deux dispositions donnent le MÊME tableau', () => {
  const a = layoutOf(ROW_PASTE);
  const b = layoutOf(COLUMN_PASTE);
  eq([a.delays, a.series], [b.delays, b.series]);
});

check('5 une disposition imposée gagne sur la détection', () => {
  eq(layoutOf(ROW_PASTE, 'column').orientation, 'column');
  eq(layoutOf(COLUMN_PASTE, 'row').orientation, 'row');
});

check('6 une cellule non numérique devient vide, pas NaN', () => {
  // Intensités > 100 : c'est bien la première colonne qui porte les gradients.
  const l = layoutOf('0\t1250\t-\n5\tn.d.\t1140\n');
  eq(l.orientation, 'column');
  eq(l.delays, [0, 5]);
  eq(l.series, [[1250, ''], ['', 1140]]);
  ok(l.series.flat().every((v) => v === '' || Number.isFinite(v)), 'aucun NaN dans le tableau');
});

check('7 un texte sans nombre est refusé avec un message', () => {
  const p = dosy.parseDosyText('gradient\tintensity\n');
  eq(p.matrix, []);
  ok(!!p.error, 'un message d’erreur est renvoyé');
});


/* ══ 2. L'EXCLUSION PAR CLIC SUR LE GRAPHE ═════════════════════════════════ */

check('8 le clic est lu par options.onClick, jamais par un dataset', () => {
  // Chart.js (v4, node_modules/chart.js/dist/chart.js) n'appelle que
  // `options.onClick` : le gestionnaire posé sur le dataset ne partait JAMAIS.
  ok(DOSY.includes('onClick: (evt, elements, chart) => {'), 'options.onClick est absent');
  ok(!/\n\s{2,}onClick: \(event, elements\)/.test(DOSY),
    'un onClick de dataset traîne encore (il ne serait jamais appelé)');
  ok(DOSY.includes("interaction: { mode: 'nearest', intersect: false }"),
    'la cible de clic n’est pas celle des plaques (nearest / sans intersection)');
});

check('9 le clic bascule dosyExcluded pour la table et le point visés', () => {
  ok(DOSY.includes('const key = ds && ds._pointKeys && ds._pointKeys[el.index];'),
    'le point cliqué n’est pas retrouvé par sa clé');
  ok(DOSY.includes('update({ dosyExcluded: togglePointExcluded(excluded, ds._tableId, key) })'),
    'le clic n’écrit pas l’exclusion');
  ok(DOSY.includes('Math.max(Math.abs(pt.x - pos.x), Math.abs(pt.y - pos.y)) > 26'),
    'un clic au milieu du graphe exclurait un point lointain');
  // `Chart.helpers` n’est PAS exporté par 'chart.js/auto' (v4) : l’appel levait
  // une TypeError à chaque clic, donc l’exclusion ne partait jamais.
  ok(!/Chart\.helpers\./.test(DOSY), 'DOSY appelle encore Chart.helpers (inexistant en v4)');
  ok(!/Chart\.helpers\./.test(PLATE), 'PlateSections appelle encore Chart.helpers (inexistant en v4)');
  ok(DOSY.includes('chart.canvas.getBoundingClientRect()'),
    'la position du clic n’est plus convertie à la main (pixels du canvas)');
});

check('10 les points exclus suivent « Show Excl. Points », comme les plaques', () => {
  ok(DOSY.includes('showExcl={!!ctx.activeTest?.showExcl}'),
    'le graphe ne suit pas la case du panneau Error Management');
  ok(!DOSY.includes('showExcl={ctx.activeTest?.showExcl !== false}'),
    'l’ancien défaut (points exclus toujours visibles) est resté');
  ok(DOSY.includes('if (showExcl && excIdx.length) {'), 'le jeu « exclus » n’est pas conditionné');
  ok(DOSY.includes('label: `${label} [excl]`') && DOSY.includes("pointStyle: 'crossRot'") &&
     DOSY.includes("borderColor: '#cbd5e1'"),
    'les points exclus ne sont pas les croix grises des plaques');
  ok(DOSY.includes('const incIdx = rows.map((p, i) => (p.ex ? -1 : i)).filter((i) => i >= 0);'),
    'points inclus et exclus ne sont pas séparés en deux jeux');
});

/* ══ 3. LES DEUX TABLEAUX, TRANSPOSÉS ET BARRÉS ════════════════════════════ */

check('11 les deux tableaux sont transposés (gradients en colonnes)', () => {
  const corner = (DOSY.match(/>Intensity set \\ Gradient %<\/th>/g) || []).length;
  eq(corner, 2, 'une seule des deux tables a la cellule d’angle transposée');
  ok(DOSY.includes('>+ Add gradient<') && DOSY.includes('>+ Add Intensity Set<'),
    'l’ajout d’un gradient (colonne) et d’un jeu d’intensités (ligne) n’est pas offert');
  ok(!DOSY.includes('>+ Add Gradient Row<') && !DOSY.includes('>+ Add Col<'),
    'l’ancienne disposition (gradients en lignes) est encore proposée');
});

check('12 un point exclu est barré et grisé dans les deux tables', () => {
  const struck = (DOSY.match(/line-through text-slate-400/g) || []).length;
  ok(struck >= 2, 'le barré ne touche pas les deux tables (données + ±SD)');
  ok(DOSY.includes("${isExcl ? 'bg-slate-100' : ''}") &&
     DOSY.includes("${ex ? 'bg-slate-100 border-slate-300' : 'border-slate-200'}"),
    'le grisé de la ligne / du point exclu manque');
});

check('13 le tableau ±SD met valeur, ±SD et exclusion sur UNE ligne', () => {
  ok(DOSY.includes('<div className="flex items-center justify-center gap-1 whitespace-nowrap">'),
    'la cellule ±SD n’est plus sur une seule ligne');
  ok(!DOSY.includes('min-w-[120px]'), 'l’ancienne cellule à deux étages est restée');
});

check('14 l’export ⭐ de la table de données suit l’écran', () => {
  ok(DOSY.includes("columns: [\n                'Intensity set',"), 'l’export ne garde pas les gradients en colonnes');
});

/* ══ 4. UN SEUL « FIXED », ET IL FONCTIONNE ════════════════════════════════ */

check('15 le panneau partagé ne propose plus « Fixed SD + » sur la page DOSY', () => {
  ok(SAT.includes('showFixedSD = true') && SAT.includes('{showFixedSD && ('),
    'le panneau partagé n’a pas la sortie « pas de Fixed SD »');
  ok(DOSY.includes('showFixedSD={false}'), 'la page DOSY affiche encore deux fois « Fixed »');
  ok(DOSY.includes("dosyErrMode === 'fixed'") && DOSY.includes('dosyFixedSDStr'),
    'la seule commande « Fixed » restante ne lit plus la valeur saisie');
});

check('16 un ±SD imposé est enregistré et dessiné comme barre d’erreur', () => {
  ok(DOSY.includes('const DosySdInput = ({ value, isOverridden, onSave, onReset }) => {'),
    'le champ ±SD n’est pas un composant à état local');
  ok(DOSY.includes('onBlur={commit}') && DOSY.includes("e.key === 'Enter'"),
    'la valeur n’est pas validée à la sortie du champ / Entrée');
  ok(DOSY.includes('update({ dosyManualSD: { ...manualSDMap, [tableId]: series } })'),
    'le ±SD imposé n’est pas écrit dans dosyManualSD');
  ok(DOSY.includes('manualSD: manualSD && manualSD[tableId] && manualSD[tableId][p.key]'),
    'le graphe ne lit pas le ±SD imposé de ce point');
  ok(DOSY.includes("onReset={() => setManualSD(c, r, '')}") && DOSY.includes('🔄 Reset ±SD'),
    'aucun moyen de revenir au mode de barres d’erreur');
});

/* ══ 5. L'IMPORT DE TEXTE TIENT COMPTE DE LA DISPOSITION ═══════════════════ */

check('17 le modal choisit la disposition et l’impose à l’import', () => {
  ok(DOSY.includes("const [orientation, setOrientation] = useState('auto');"),
    'le modal n’offre pas la disposition');
  ok(DOSY.includes('DOSY_TEXT_ORIENTATIONS.map') && DOSY.includes('Detected automatically'),
    'ni la détection ni le forçage ne sont proposés');
  ok(DOSY.includes('onImport(layout, target)'), 'le modal n’envoie pas la disposition résolue');
  ok(DOSY.includes('const handleDosyImport = (layout, targetTableId) => {'),
    'l’import ne reçoit pas la disposition résolue');
  ok(DOSY.includes('Array.from({ length: nGrad }, (_, r) =>'),
    'la grille n’est pas reconstruite depuis la disposition');
});

/* ══ RAPPORT ══════════════════════════════════════════════════════════════ */

const failed = results.filter((r) => !r.ok);
console.table(results.map((r) => ({ name: r.name, ok: r.ok, error: r.ok ? '' : r.got })));
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} checks failed`);
  process.exit(1);
}
console.log(`\n✅ ${results.length}/${results.length} checks passed`);

