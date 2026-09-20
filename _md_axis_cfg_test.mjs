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
       borne par défaut, X Min/Max tapés gagnent) — y compris celui de la CARTE
       DSSP, une figure dessinée à la main : `mdHeatXAxis` lui donne la fenêtre,
       les graduations (xTickStep), le format des nombres (xDecimals / xSci),
       l'échelle log, la rotation des nombres et la place du titre, donc les
       commandes de son axe X (et l'éditeur du double-clic) agissent vraiment ;
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
  sliceFn(MD, 'mdHeatLogTicks', 'MDSections.jsx'),
  sliceFn(MD, 'mdHeatXAxis', 'MDSections.jsx'),
  'return { mdDom, mdYAxisProps, mdHeatLogTicks, mdHeatXAxis, cfgNumericAxis };'
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

/* ══ 8. LA CARTE DSSP : SON AXE X SUIT LE MÊME PANNEAU 🎨 ═════════════════ */
/* La carte (residue × frame) est une figure dessinée à la main : sa fenêtre,
   ses graduations et son échelle venaient d'elle seule, donc AUCUNE commande de
   l'axe X du panneau 🎨 (ni de l'éditeur qui s'ouvre en double-cliquant sur les
   nombres) ne la déplaçait — seuls les TITRES suivaient. `mdHeatXAxis` fait
   désormais la géométrie ; la voici, réellement exécutée. */
const heatOpts = { nSamples: 101, unit: 1, left: 50, plotW: 400 }; // 0…100 frames
const heatAuto = H.mdHeatXAxis({}, heatOpts);
eq([heatAuto.i0, heatAuto.i1], [0, 100], 'sans commande la carte montre toute la trajectoire');
eq(heatAuto.scale, 'auto', "sans xLog l'échelle X de la carte reste 'auto'");
eq(heatAuto.ticks, null, 'sans xTickStep la carte garde ses graduations par colonne');
eq(heatAuto.formatter, null, 'sans xDecimals/xSci les nombres gardent leur format');
eq(heatAuto.px(0), 50 + (0.5 / 101) * 400, 'la première colonne est posée exactement comme avant');
eq(heatAuto.px(50), 50 + (50.5 / 101) * 400, 'la colonne du milieu aussi');
eq(Math.round(heatAuto.sampleAt(0.5)), 50, 'le survol / le zoom retombent sur la colonne du milieu');
// le bord gauche tombe à −0,5 colonne (la boîte s'arrête au bord du 1er carré) :
// c'est le composant qui ramène l'indice dans les données (Math.max(0, …)).
eq(Math.max(0, Math.round(heatAuto.sampleAt(0))), 0, 'et sur la première au bord gauche');

const heatZoom = H.mdHeatXAxis({}, { ...heatOpts, zoom: { x0: 20, x1: 60 } });
eq([heatZoom.i0, heatZoom.i1], [20, 60], 'le zoom à la souris reste la fenêtre par défaut');
const heatWin = H.mdHeatXAxis({ xMin: '30', xMax: '50' }, { ...heatOpts, zoom: { x0: 20, x1: 60 } });
eq([heatWin.i0, heatWin.i1], [30, 50], 'X Min/Max tapés gagnent sur le zoom');
const heatNs = H.mdHeatXAxis({ xMin: '10', xMax: '20' }, { nSamples: 201, unit: 0.5, left: 0, plotW: 100 });
eq([heatNs.i0, heatNs.i1], [20, 40], 'les bornes sont lues dans l’unité de l’axe (ici des ns)');
const heatBroken = H.mdHeatXAxis({ xMin: '90', xMax: '10' }, heatOpts);
eq([heatBroken.i0, heatBroken.i1], [0, 100], 'une saisie incohérente ne vide jamais la carte');

eq(H.mdHeatXAxis({ xTickStep: '25' }, heatOpts).ticks, [0, 25, 50, 75, 100],
  'xTickStep devient les graduations de la carte (en unités de l’axe)');
eq(H.mdHeatXAxis({ xDecimals: '2' }, heatOpts).formatter(12.3), '12.30',
  'xDecimals formate les nombres de l’axe de la carte');
eq(H.mdHeatXAxis({ xSci: true }, heatOpts).formatter(1234), '1.23e+3',
  'xSci met les nombres de la carte en exponentiel');

const heatLog = H.mdHeatXAxis({ xLog: true }, heatOpts);
eq(heatLog.scale, 'log', 'xLog met vraiment l’axe X de la carte en log');
eq(heatLog.i0, 1, 'log(0) n’existe pas : la carte démarre à la première colonne > 0');
ok(heatLog.px(11) - heatLog.px(10) > heatLog.px(51) - heatLog.px(50),
  'en log les colonnes s’espacent au début de l’axe et se resserrent vers la droite');
eq(heatLog.ticks, [0.5, 1, 2, 5, 10, 20, 50, 100],
  'les graduations d’un axe log restent des valeurs rondes (1 / 2 / 5 × 10ⁿ)');

/* ══ 9. LE CÂBLAGE DES GRAPHES MD (source) ════════════════════════════════ */
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

/* la carte DSSP : une figure dessinée à la main, dont l'axe X obéit au panneau */
has(MD, 'const xAxis = mdHeatXAxis(cfg, { nSamples, unit: xUnit, zoom, left: margin.left, plotW });',
  'la carte DSSP construit son axe X avec le cfg du panneau (mdHeatXAxis)');
has(MD, 'const xUnit = dtPs > 0 ? (frameStride * dtPs) / 1000 : frameStride;',
  'les valeurs de l’axe de la carte sont en ns (ou en frames sans pas de temps)');
has(MD, 'const xTicks = xTickVals && xTickVals.length',
  'les graduations de la carte sont celles du panneau (xTickStep)');
has(MD, 'const colX = xAxis.px((s0 - 0.5) * xUnit);',
  'les colonnes de la carte sont posées par l’axe (échelle log comprise)');
has(MD, 'transform={tickAngle ? `rotate(${tickAngle} ${t.at} ${tickY})` : undefined}',
  'la rotation des nombres (tickAngle) s’applique à la carte');
has(MD, 'Number(cfg.xAxisLabelMove) || 0', 'le titre X de la carte prend son glissement');
has(MD, 'cfg={dsspCfg} xLabel={dsspCfg.xAxisLabel} yLabel={dsspCfg.yAxisLabel}',
  'la carte DSSP reçoit le cfg du panneau 🎨 (ses nombres, son échelle, sa fenêtre)');

console.log(`✅ _md_axis_cfg_test.mjs — ${passed} vérifications passées`);

