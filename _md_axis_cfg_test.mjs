/* =========================================================================
   _md_axis_cfg_test.mjs — LES COMMANDES 🎨 ATTEIGNENT VRAIMENT LES GRAPHES MD
   (et l'éditeur s'ouvre au double-clic sur le graphe de Data Analysis).

   Ce qui doit rester vrai :

     • `mdYAxisProps` (MDSections.jsx) est RÉELLEMENT exécuté ici, avec les
       helpers du panneau (cfgNumericAxis / cfgAxisDomain / cfgAxisTicks /
       cfgTickFormatter / cfgLogScale de SharedAnalysisTools.jsx) et `mdDom`
       (MDData.jsx) : Y Min/Max tapés → domaine concret, pas de graduation
       (yTickStep) → ticks, yLog → échelle log à bornes positives,
       yDecimals / ySci → format des nombres, et AUCUNE commande → 'auto'
       (l'aspect historique des graphes est conservé) ;
     • les axes X des graphes MD passent par `cfgNumericAxis` (le zoom reste la
       borne par défaut, X Min/Max tapés gagnent) ;
     • les titres tapés (ou écrits en double-cliquant sur le titre) gagnent sur
       le libellé par défaut de la page ;
     • CHAQUE courbe suit SA série (couleur, épaisseur, pointillés, masquage) et
       la légende obéit à `cfg.legend` — c'est ce que l'éditeur écrit ;
     • le corps des graphes est dans <ChartInspector> : c'est lui qui ouvre
       l'éditeur au double-clic (le reste est couvert par
       _chart_dblclick_test.cjs, la mise en cache par _md_analysis_cache_test.mjs).

   Les helpers purs sont RÉELLEMENT exécutés (extraction + new Function, comme
   _compact_sections_test.mjs / _docking_sanity.cjs) ; le câblage JSX est vérifié
   sur la source, comme les autres garde-fous du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const MD = read('src/components/MDSections.jsx');
const MDDATA = read('src/components/MDData.jsx');
const SAT = read('src/components/SharedAnalysisTools.jsx');

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};

/* ── extraction d'une fonction fléchée, corps bloc OU expression ───────────
   `export const name = (…) => { … };` → `const name = (…) => { … };`
   `export const name = (…) => expr;`   → `const name = (…) => expr;`
   (comptage d'accolades pour le corps bloc, donc les objets `{}` des
   paramètres — `cfg = {}` — et les objets imbriqués sont respectés). */
const sliceFn = (src, name, where) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `${where} : fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  assert.ok(arrow >= 0, `${where} : flèche de ${name} introuvable`);
  const offset = src.slice(arrow + 2).search(/\S/);
  assert.ok(offset >= 0, `${where} : corps de ${name} introuvable`);
  const body = arrow + 2 + offset;
  if (src[body] === '{') {
    let depth = 0;
    for (let i = body; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return `${src.slice(start, i + 1)};`;
      }
    }
    throw new Error(`${where} : corps de ${name} non terminé`);
  }
  const end = src.indexOf(';\n', body);
  assert.ok(end > body, `${where} : fin de ${name} introuvable`);
  return src.slice(start, end + 1);
};

const sandbox = [
  sliceFn(MDDATA, 'parseMDValue', 'MDData.jsx'),
  sliceFn(MDDATA, 'mdDom', 'MDData.jsx'),
  sliceFn(SAT, 'numOrNull', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'numericTicks', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'cfgLogScale', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'cfgAxisTicks', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'cfgAxisDomain', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'cfgTickFormatter', 'SharedAnalysisTools.jsx'),
  sliceFn(SAT, 'cfgNumericAxis', 'SharedAnalysisTools.jsx'),
  sliceFn(MD, 'mdYAxisProps', 'MDSections.jsx'),
  'return { mdDom, mdYAxisProps, cfgNumericAxis };'
].join('\n');
const H = new Function(sandbox)();

/* ══ 1. LES HELPERS EXTRAITS SONT BIEN CEUX DE L'APPLICATION ═══════════════ */
eq(H.mdDom(''), undefined, 'mdDom vide → aucune borne');
eq(H.mdDom('0,15'), 0.15, 'mdDom lit la virgule décimale (0,15)');
eq(H.mdDom('abc'), undefined, 'mdDom ignore une saisie non numérique');

/* ══ 2. SANS COMMANDE, L'AXE Y GARDE SON ASPECT HISTORIQUE ('auto') ════════ */
const auto = H.mdYAxisProps({}, [1, 2, 3]);
eq(auto.type, 'number', "l'axe Y reste numérique");
eq(auto.scale, 'auto', "sans yLog l'échelle reste 'auto'");
ok(!('domain' in auto), "sans Y Min/Max l'axe garde le domaine 'auto' de recharts");
ok(!('ticks' in auto), 'sans pas de graduation, recharts choisit ses ticks');
eq(auto.tickFormatter, undefined, 'sans yDecimals/ySci les nombres gardent leur format');
const empty = H.mdYAxisProps({ yMin: '', yMax: '' }, [1, 2]);
ok(!('domain' in empty), 'deux champs Min/Max vidés → retour au domaine auto');

/* ══ 3. Y MIN / MAX TAPÉS (panneau 🎨 ou double-clic sur l'axe) ════════════ */
eq(H.mdYAxisProps({ yMin: '0,15', yMax: '0.85' }, [0.1, 0.9]).domain, [0.15, 0.85],
  'Y Min/Max tapés deviennent le domaine de l’axe Y');
eq(H.mdYAxisProps({ yMin: 0.2 }, [0.1, 0.9]).domain, [0.2, 0.9],
  'un seul Y Min tapé : le max reste l’étendue des données');

/* ══ 4. PAS DE GRADUATION (yTickStep) : DOMAINE CONCRET + TICKS ════════════ */
const stepped = H.mdYAxisProps({ yMin: '0', yMax: '1', yTickStep: '0.25' }, [0.1, 1]);
eq(stepped.domain, [0, 1], 'un pas de graduation rend le domaine concret');
eq(stepped.ticks, [0, 0.25, 0.5, 0.75, 1], 'les ticks suivent yTickStep');

/* ══ 5. ÉCHELLE LOGARITHMIQUE : BORNES STRICTEMENT POSITIVES ══════════════ */
const loggy = H.mdYAxisProps({ yLog: true }, [1, 100]);
eq(loggy.scale, 'log', 'yLog met vraiment l’axe Y en log');
ok(loggy.domain[0] > 0 && loggy.domain[1] > 0, 'une échelle log exige des bornes > 0');
const loggyZero = H.mdYAxisProps({ yLog: true }, [0, 100]);
ok(loggyZero.domain[0] > 0, 'un minimum à 0 est remonté (recharts refuse un log à 0)');

/* ══ 6. DÉCIMALES / NOTATION EXPONENTIELLE ════════════════════════════════ */
const dec = H.mdYAxisProps({ yDecimals: '3' }, [0, 1]);
eq(dec.tickFormatter(0.5), '0.500', 'yDecimals formate les nombres de l’axe Y');
const sci = H.mdYAxisProps({ ySci: true }, [0, 1]);
eq(sci.tickFormatter(1234), '1.23e+3', 'ySci met les nombres de l’axe en exponentiel');

/* ══ 7. AXE X : LE ZOOM RESTE LA BORNE, X MIN/MAX GAGNENT ═════════════════ */
const xAuto = H.cfgNumericAxis({}, 'x', [0, 10]);
eq(xAuto.domain, [0, 10], 'le domaine X du zoom (drag) est conservé');
eq(xAuto.allowDataOverflow, true, 'le zoom garde son clip');
eq(xAuto.scale, 'auto', "sans xLog l'échelle X reste 'auto'");
const xPanel = H.cfgNumericAxis({ xMin: 2, xMax: 8, xDecimals: '0' }, 'x', [0, 10]);
eq(xPanel.domain, [2, 8], 'X Min/Max tapés gagnent sur le domaine du zoom');
ok(!('ticks' in xPanel), 'sans xTickStep les ticks X restent automatiques');
eq(xPanel.tickFormatter(3.4), '3', 'xDecimals formate les nombres de l’axe X');
eq(H.cfgNumericAxis({ xLog: true }, 'x', [0, 10]).scale, 'log', 'xLog met l’axe X en log');

/* ══ 8. LE CÂBLAGE DES GRAPHES MD (source) ════════════════════════════════ */
has(MD, "const xAxisProps = cfgNumericAxis(cfg, 'x', zoom.domain);",
  'les graphes MD passent le domaine X par cfgNumericAxis');
has(MD, 'const yAxisProps = brk.on ? brk.axisProps : mdYAxisProps(cfg, ys);',
  "l'axe Y des graphes MD passe par mdYAxisProps");
has(MD, 'const xLab = cfg.xAxisLabel || xLabel;', 'le titre X tapé gagne sur le libellé par défaut');
has(MD, 'const yLab = cfg.yAxisLabel || yLabel;', 'le titre Y tapé gagne sur le libellé par défaut');
has(MD, "label={cfgAxisLabel({ ...cfg, fontSize: fSize }, 'x', xLab)}",
  'le titre X du graphe est celui de cfg (xLab)');
has(MD, "label={cfgAxisLabel({ ...cfg, fontSize: fSize }, 'y', yLab)}",
  'le titre Y du graphe est celui de cfg (yLab)');
has(MD, "const lineColor = seriesColorOf(cfg, dataKey, 0, 1, color || '#3b82f6');",
  'la couleur de la courbe MD suit SA série (panneau / double-clic)');
has(MD, 'const lineWidth = seriesLineThickness(cfg, dataKey, cfg.lineThickness || 2);',
  "l'épaisseur de la courbe MD suit SA série");
has(MD, 'const lineDash = seriesDash(cfg, dataKey);', 'les pointillés de la courbe MD suivent SA série');
has(MD, 'hide={!seriesVisible(cfg, dataKey)}', 'une série masquée disparaît vraiment du graphe');
has(MD, "<ChartInspector containerRef={chartRef} containerProps={{ onMouseDown: chartType !== 'bar' ? zoom.onMouseDown : undefined }}\n        cfg={cfg} setCfg={setCfg}",
  'le corps du graphe MD est dans <ChartInspector> (double-clic → éditeur)');

/* les six endroits qui lisent les commandes du panneau dans la page MD */
has(MD, 'mdYAxisProps(cfg, chartData.flatMap(r => atomMeta.map(m => r[m.key])))',
  'le graphe per-atom (RMSF / Rg par résidu) lit mdYAxisProps');
has(MD, "{...cfgNumericAxis(cfg, 'x', series.flatMap(s => s.pts.map(p => p.x)).length",
  'le graphe de comparaison de conditions lit cfgNumericAxis');
has(MD, 'mdYAxisProps(cfg, series.flatMap(s => s.pts.map(p => p.y)))',
  'le graphe de comparaison de conditions lit mdYAxisProps');
has(MD, 'const energyYAxisProps = mdYAxisProps(cfg, energy.flatMap((e) => [e.potential, e.kinetic, e.total]));',
  "l'axe Y du graphe d'énergie (potentiel / cinétique / totale) lit mdYAxisProps");
has(MD, "const energyXAxisProps = cfgNumericAxis(cfg, 'x', energyTimes.length",
  "l'axe X du graphe d'énergie lit cfgNumericAxis");
has(MD, 'mdYAxisProps(cfg, series.flatMap((s) => rows.map((r) => r[s.key])))',
  'les ChartPanel de la page (DSSP, ordre, densité…) lisent mdYAxisProps');
has(MD, "cfgAxisLabel({ ...cfg, fontSize: fSize + 2 }, 'y', cfg.yAxisLabel || yLabel, 4)",
  'les ChartPanel utilisent le titre Y tapé');
const mdChartCalls = MD.split('<MDAnalysisChart').length - 1;
ok(mdChartCalls === 4, `les quatre courbes d'analyse MD (RMSD / RMSF / Rg / SASA) passent par MDAnalysisChart (${mdChartCalls} trouvées)`);
const nAxisProps = MD.split('mdYAxisProps(').length - 1;
ok(nAxisProps === 6, `mdYAxisProps équipe les cinq axes Y de la page MD + sa définition (${nAxisProps} occurrences)`);

/* la légende obéit au panneau (position / none) — c'est ce que le double-clic écrit */
has(MD, "{cfg.legend !== 'none' && (\n                <Legend verticalAlign={cfg.legend === 'bottom' ? 'bottom' : 'top'} wrapperStyle={legendTextStyle(cfg)} />",
  'la légende des graphes multi-séries suit cfg.legend (none / top / bottom)');
ok((MD.split("cfg.legend !== 'none'").length - 1) >= 3,
  'chaque graphe multi-séries de la page MD gère la légende');

console.log(`✅ _md_axis_cfg_test.mjs — ${passed} vérifications passées`);

