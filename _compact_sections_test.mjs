/* =========================================================================
   _compact_sections_test.mjs — LA MISE EN PAGE COMPACTE DES PAGES D'EXPÉRIENCE
   et LA LECTURE DU TABLEAU PAR LES GRAPHIQUES DE DOCKING.

   Ce qui doit rester vrai :

     • « Classification » et « Compounds & Biological Models » vivent dans le
       MÊME bloc GENERAL, côte à côte sur un écran large (une colonne chacun) ;
     • « Bruker Import » (NMR) tient sur UNE ligne : la phrase d'aide sous le
       bouton, le sous-volet « From Google Drive link » et les champs
       « Manual SW (ppm) / Centre O1 (ppm) » ont disparu ;
     • « Bruker Import » (ssNMR) tient sur une ligne AVEC les trois champs de
       recadrage « From (kHz) / To (kHz) / Number of points » — ces trois
       paramètres n'existent QUE là —, et les champs « Manual SW (kHz) » /
       « Carrier offset (kHz) » ont disparu ;
     • le volet 3D de la page NMR n'a plus son champ « PDB ID / URL / local
       file » : la source de structure s'écrit à UN SEUL endroit, les commandes
       du viewer 3D (📂 PDB file(s) / « PDB ID or URL ») ;
     • les valeurs numériques d'un spectre (ssNMR, CD) ne sont plus une section
       à part : elles sont des COLONNES à côté de l'axe des x, juste sous les
       boutons d'import ;
     • « Jasco Import » (CD) tient sur une ligne : plus de phrase d'aide sous le
       bouton, plus de zone de collage « Import pasted data » ;
     • « Ellipticity conversion » / « Blank Subtraction » / « Math Operations »
       sont sur une seule rangée ;
     • page Docking : les graphiques sont rendus DIRECTEMENT dans « Data
       Analysis » (plus de sous-section « Per Atom Plot ») et ils tracent LE
       TABLEAU DE RÉSULTATS (valeurs éditées + colonnes CAPRI brutes), pas la
       liste brute des poses qui les laissait vides.

   Les fonctions pures de DockingData.jsx sont RÉELLEMENT exécutées (extraction
   + new Function, comme _docking_sanity.cjs) ; le reste est vérifié sur la
   source, comme les autres garde-fous du dépôt (les sections sont du JSX).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const DATA = read('src/components/DockingData.jsx');
const SEC = read('src/components/DockingSections.jsx');
const RENDER = read('src/components/DockingTestRenderer.jsx');
const SHELL = read('src/components/TestShellRenderer.jsx');
const NMR = read('src/components/NMRSections.jsx');
const SSN = read('src/components/ssNMRSections.jsx');
const CD = read('src/components/CDSections.jsx');

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
const countOf = (src, needle) => src.split(needle).length - 1;
/* ══ 1. LE TSV CAPRI REMPLIT LE TABLEAU DE RÉSULTATS ═══════════════════════ */

const grab = (name, end) => {
  const m = DATA.match(new RegExp(`export const ${name} = [\\s\\S]*?${end}`));
  assert.ok(m, `DockingData.jsx : ${name} introuvable`);
  return m[0].replace(/^export\s+/, '');
};
const { parseCapriTsv, posesFromCapri, parseDockingValue, normMetricColumn,
  DOCKING_METRICS, dockingMetricOf, dockingMetricLabel, dockingMetricUnit,
  poseBindingEnergy, poseDeviation, haddockScoreTerms } = new Function(
  [grab('parseCapriTsv', '\n};'), grab('CAPRI_METRIC_SYNONYMS', '\n};'),
   grab('normMetricColumn', ';'), grab('posesFromCapri', '\n};'),
   grab('parseDockingValue', '\n};'), grab('DOCKING_METRICS', '\n];'),
   grab('dockingMetricOf', '\n};'), grab('dockingMetricLabel', ';'),
   grab('dockingMetricUnit', ';'), grab('poseBindingEnergy', '\n};'),
   grab('poseDeviation', '\n};'), grab('haddockScoreTerms', '\n};')].join('\n')
  + '\nreturn { parseCapriTsv, posesFromCapri, parseDockingValue, normMetricColumn,'
  + ' DOCKING_METRICS, dockingMetricOf, dockingMetricLabel, dockingMetricUnit,'
  + ' poseBindingEnergy, poseDeviation, haddockScoreTerms };'
)();

eq(normMetricColumn('RMSD l.b.'), 'rmsdlb', 'les noms de colonnes sont comparés sous forme canonique');
eq(normMetricColumn('HADDOCK score'), normMetricColumn('haddock_score'),
  '« HADDOCK score » et « haddock_score » sont la même colonne');

/* Un capri_ss.tsv de HADDOCK3 : en-tête tabulé, scores et termes de score. */
const CAPRI = [
  'structure\tmodel\tcaprieval_rank\tscore\tlrmsd\tilrmsd\tair\tbsa\tvdw\telec\tdesolv\tcluster_id',
  'run1/data/structures/it1/cluster_1_1.pdb\tcluster_1_1.pdb\t1\t-52.31\t0.000\t0.000\t-15.2\t1240.5\t-42.6\t-210.8\t8.4\t1',
  'run1/data/structures/it1/cluster_1_2.pdb\tcluster_1_2.pdb\t2\t-48.90\t1.234\t2.015\t-12.9\t1188.0\t-38.1\t-198.4\t7.1\t1'
].join('\n');

const parsedCapri = parseCapriTsv(CAPRI);
ok(parsedCapri && parsedCapri.columns.length === 12, 'le TSV CAPRI est lu (12 colonnes)');
const poses = posesFromCapri(parsedCapri);
eq(poses.length, 2, 'deux poses sortent du TSV — le tableau de résultats est rempli');
eq(poses[0].mode, 1, 'le rang CAPRI devient le mode');
eq(poses[0].label, 'cluster_1_1.pdb', 'le nom de modèle (dernier segment du chemin) devient le label');
eq(poses[0].program, 'haddock', 'le programme est HADDOCK');
eq(poses[0].affinity, -52.31, 'la colonne « score » alimente le score du programme (graphique de liaison)');
eq(poses[0].lrmsd, 0, 'la colonne « lrmsd » alimente l-RMSD (Å) — l’abscisse du nuage Énergie vs RMSD');
eq(poses[0].ilrmsd, 0, 'la colonne « ilrmsd » alimente l’i-l-RMSD (Å)');
eq(poses[0].energy_air, -15.2, 'la colonne « air » alimente AIR (termes HADDOCK)');
eq(poses[0].bsa, 1240.5, 'la colonne « bsa » alimente BSA (termes HADDOCK)');
eq(poses[0].energy_vdw, -42.6, 'la colonne « vdw » alimente vdW');
eq(poses[0].energy_elec, -210.8, 'la colonne « elec » alimente Electrostatic');
eq(poses[0].energy_desolv, 8.4, 'la colonne « desolv » alimente Desolvation');
eq(poses[0].capri_cluster_id, '1', 'les colonnes brutes restent disponibles pour le tableau');
eq(poses[1].affinity, -48.9, 'la deuxième pose suit la même conversion');
/* Autres orthographes (HADDOCK 2.4 / exports retravaillés) + virgule décimale. */
const POSES2 = posesFromCapri(parseCapriTsv([
  'Model\tHADDOCK score\tRMSD l.b.\tRMSD u.b.\tE_vdw\tE_elec\tE_desolv\tAIR\tBSA\tFraction of common contacts',
  'cluster_2_1.pdb\t-45,20\t1.5\t2.5\t-30.1\t-150.2\t6.3\t-10.1\t980.0\t0.42'
].join('\n')));
eq(POSES2[0].affinity, -45.2, '« HADDOCK score » avec virgule décimale → Affinity');
eq(POSES2[0].rmsd_lb, 1.5, '« RMSD l.b. » → RMSD l.b.');
eq(POSES2[0].rmsd_ub, 2.5, '« RMSD u.b. » → RMSD u.b.');
eq(POSES2[0].energy_vdw, -30.1, '« E_vdw » → vdW');
eq(POSES2[0].energy_elec, -150.2, '« E_elec » → Electrostatic');
eq(POSES2[0].energy_desolv, 6.3, '« E_desolv » → Desolvation');
eq(POSES2[0].energy_air, -10.1, '« AIR » → AIR');
eq(POSES2[0].bsa, 980, '« BSA » → BSA');
eq(POSES2[0].fcc, 0.42, '« Fraction of common contacts » → FCC');
eq(POSES2[0].mode, 1, 'sans colonne de rang, le mode est l’ordre de la ligne');

/* Une métrique ABSENTE vaut '' — jamais 0 : un zéro de complaisance ferait
   croire à une barre nulle dans le graphique au lieu d'un manque. */
const POSES3 = posesFromCapri(parseCapriTsv('score\tlrmsd\n-8.5\t1.2'));
eq(POSES3[0].affinity, -8.5, 'les colonnes présentes sont converties');
eq(POSES3[0].energy_vdw, '', 'une colonne absente reste vide');
eq(parseDockingValue(POSES3[0].energy_vdw), null, '…et ne devient pas 0 dans un graphique');
eq(parseDockingValue(POSES3[0].affinity), -8.5, 'les valeurs présentes sont tracées');
eq(posesFromCapri(null), [], 'un TSV illisible ne produit aucune pose');
eq(posesFromCapri({ columns: ['score'], rows: [] }), [], 'un TSV sans ligne ne produit aucune pose');

/* ══ 2. LES DEUX IMPORTS REMPLISSENT LE MÊME TABLEAU ══════════════════════ */
has(DATA, 'poses: posesFromCapri(capri),', '[capri_ss.tsv] un fichier importé seul remplit AUSSI le tableau');
ok(!DATA.includes('poses: [], capri,'), '[capri_ss.tsv] le tableau n’est plus laissé vide');
has(SEC, 'const poses = posesFromCapri(parsed);', '[répertoire de calcul] même conversion que l’import seul');
ok(!SEC.includes('const metricMap = {'), '[répertoire de calcul] la correspondance locale a disparu (une seule source de vérité)');
has(SEC, 'if (poses.length) onPoses(poses, parsed.program);', 'le collage/import pose les poses');
has(SEC, 'if (updateCount) updateActiveTest(parsed.updates);', '…ET les paramètres du même fichier (les deux, plus l’un ou l’autre)');

/* ══ 3. LES GRAPHIQUES LISENT LE TABLEAU ══════════════════════════════════ */
has(SEC, 'const raw = d.activeValues[`${i}-${m.key}`];', 'les graphiques partent des cellules éditées du tableau');
has(SEC, 'const fallback = capriFallback(p, m.key);', '…avec les colonnes CAPRI brutes en repli');
has(SEC, 'const affinityData = rows.map((p, i) => ({', 'le graphique d’affinité lit les lignes du tableau');
has(SEC, 'const rmsdData = rows', 'le nuage Affinity vs RMSD lit les lignes du tableau');
has(SEC, 'const energyBreakdownData = rows.slice(0, 10).map(', 'la décomposition d’énergie aussi');
has(SEC, 'const termRows = rows.slice(0, 15).map(', 'les termes HADDOCK aussi');
has(SEC, 'data={termRows}', '…et le graphique des termes les trace UNE barre par terme présent');
has(SEC, '{rows.length} poses', 'le compteur de poses suit le tableau');
ok(!SEC.includes('const affinityData = d.poses'), 'plus aucun graphique branché sur la liste brute des poses');
ok(!SEC.includes('data={d.poses.slice(0, 15)'), '…ni les termes HADDOCK');
has(SEC, 'rmsd: poseDeviation(p)', 'l’écart à la référence passe par la lecture CAPRI partagée (l-RMSD, puis i-RMSD…)');
has(SEC, '.filter((r) => r.affinity !== null && r.rmsd !== null);', 'un RMSD vide ne se transforme pas en point à 0');

/* ══ 4. « DATA ANALYSIS » SANS SOUS-SECTION « PER ATOM PLOT » ═════════════ */
has(RENDER, 'analysisPlain: true,', '[docking] le contenu de Data Analysis est rendu directement');
has(SHELL, 'custom.analysisPlain ? (', '[shell] analysisPlain est bien ce qui supprime la sous-section');
/* ══ 5. GENERAL : CLASSIFICATION + COMPOUNDS CÔTE À CÔTE ═════════════════ */
has(SHELL, "grid grid-cols-1 items-start gap-0 ${(showCompoundsSection || CompoundsSection) ? 'xl:grid-cols-2 xl:gap-x-4' : ''}",
  'les deux sous-sections courtes de GENERAL partagent une grille à deux colonnes');
ok(SHELL.indexOf('title="Classification"') < SHELL.indexOf('title="Compounds & Biological Models"'),
  'Classification reste la première colonne');

/* ══ 6. « BRUKER IMPORT » (NMR) SUR UNE LIGNE ════════════════════════════ */
ok(!NMR.includes('0x1F517)} From Google Drive link'), '[NMR] le sous-volet « From Google Drive link » a disparu');
ok(!NMR.includes('nmrBrukerDataUrl') && !NMR.includes('nmrBrukerAcqusUrl') && !NMR.includes('nmrBrukerImagUrl'),
  '[NMR] …avec ses états et son handler');
ok(!NMR.includes('Import from links'), '[NMR] …et son bouton');
ok(!NMR.includes('This will automatically locate the 1r file(s)'),
  '[NMR] la phrase d’aide sous le bouton d’upload a disparu');
ok(!NMR.includes('Manual SW (ppm)') && !NMR.includes('Centre O1 (ppm)'),
  '[NMR] les champs « Manual SW (ppm) » / « Centre O1 (ppm) » ont disparu');
ok(!NMR.includes('From (kHz)') && !NMR.includes('Number of points'),
  '[NMR] les trois paramètres de recadrage ne sont PAS sur la page NMR (ssNMR seulement)');
ok(!NMR.includes('manualSWppm:'), '[NMR] l’import ne passe plus de valeurs manuelles au lecteur 1r');

const nmrH4 = NMR.indexOf('Bruker Import — 1r processed spectrum (ppm axis)');
const nmrMsg = NMR.indexOf('{nmrBrukerMsg &&');
const nmrCard = NMR.slice(NMR.lastIndexOf('<div className="bg-sky-50', nmrH4), nmrMsg);
ok(nmrH4 > 0 && nmrMsg > nmrH4, '[NMR] le bloc Bruker Import est identifiable');
ok(!nmrCard.includes('Manual SW') && !nmrCard.includes('From Google Drive link'),
  '[NMR] plus rien d’autre que la ligne d’import');
ok(nmrCard.includes('Choose Bruker Folder'), '[NMR] le bouton d’upload est sur la ligne du titre');
ok(countOf(nmrCard, '\n        <div className="flex flex-wrap items-center gap-2">') === 1,
  '[NMR] le bloc n’a qu’UNE ligne de commande');
ok(nmrCard.includes('nmr1dRestore.attempt'), '[NMR] l’état / la restauration du spectre restent accessibles');

/* ══ 7. « BRUKER IMPORT » (ssNMR) : UNE LIGNE + VALEURS EN COLONNES ══════ */
ok(!SSN.includes('From Google Drive link'), '[ssNMR] le sous-volet « From Google Drive link » a disparu');
ok(!SSN.includes('brukerDataUrl') && !SSN.includes('brukerAcqusUrl'), '[ssNMR] …avec ses états');
ok(!SSN.includes('Import from links'), '[ssNMR] …et son bouton');
ok(!SSN.includes('Manual SW (kHz)') && !SSN.includes('Carrier offset (kHz)'),
  '[ssNMR] les champs « Manual SW (kHz) » / « Carrier offset (kHz) » ont disparu');
ok(!SSN.includes('This will automatically locate the 1r file(s)'),
  '[ssNMR] la phrase d’aide sous le bouton d’upload a disparu');
has(SSN, 'From (kHz)', '[ssNMR] « From (kHz) » est là (et seulement là)');
has(SSN, 'To (kHz)', '[ssNMR] « To (kHz) » est là');
has(SSN, 'Number of points', '[ssNMR] « Number of points » est là');
ok(countOf(SSN, 'Crop & resample upon import') === 1, '[ssNMR] un seul bloc de recadrage');

const ssnUpload = SSN.indexOf('Choose Bruker Folder');
const ssnCrop = SSN.indexOf('Number of points');
const ssnAxis = SSN.indexOf('Frequencies (kHz) — comma, space or newline separated');
ok(ssnUpload > 0 && ssnCrop > ssnUpload, '[ssNMR] le recadrage suit les boutons d’import');
ok(ssnAxis > ssnCrop, '[ssNMR] les valeurs numériques viennent JUSTE SOUS les boutons d’import');
ok(countOf(SSN, 'Spectra — condition') === 1, '[ssNMR] une seule carte de spectres (dans l’import, plus de section dédiée)');
ok(SSN.indexOf('Spectra — condition') > ssnUpload, '[ssNMR] …et elle est dans la carte d’import');
ok(!SSN.includes('import a Bruker 1r folder below'), '[ssNMR] l’ancienne carte « Spectra — condition » a disparu');
has(SSN, 'flex flex-wrap items-stretch gap-2', '[ssNMR] l’axe et les spectres sont des COLONNES côte à côte');
has(SSN, 'same order as the frequencies', '[ssNMR] chaque colonne de spectre suit l’axe des fréquences');
/* ══ 8. « JASCO IMPORT » (CD) SUR UNE LIGNE + VALEURS EN COLONNES ════════ */
ok(!CD.includes('jascoText'), '[CD] la zone de collage des données a disparu (état compris)');
ok(!CD.includes('Import pasted data'), '[CD] …et son bouton « Import pasted data »');
ok(!CD.includes('or paste the file content below'), '[CD] la phrase d’aide sous le bouton d’upload a disparu');
ok(!CD.includes('handlePasteImport'), '[CD] …avec son handler');

const cdUpload = CD.indexOf('Choose Jasco file(s)');
const cdAxis = CD.indexOf('Wavelengths (nm) — comma, space or newline separated');
ok(cdUpload > 0 && cdAxis > cdUpload, '[CD] les valeurs numériques viennent JUSTE SOUS les boutons d’import');
ok(countOf(CD, 'Spectra — condition') === 1, '[CD] une seule carte de spectres (dans l’import, plus de section dédiée)');
ok(CD.indexOf('Spectra — condition') > cdUpload, '[CD] …et elle est dans la carte d’import');
ok(!CD.includes('import a Jasco file below'), '[CD] l’ancienne carte « Spectra — condition » a disparu');
has(CD, 'flex flex-wrap items-stretch gap-2', '[CD] l’axe et les spectres sont des COLONNES côte à côte');
has(CD, 'same order as the wavelengths', '[CD] chaque colonne de spectre suit l’axe des longueurs d’onde');

/* La ligne d'import porte l'upload ET l'état du spectre, sans description. */
const cdRow = CD.slice(cdUpload - 400, CD.indexOf('{jascoMsg &&'));
ok(cdRow.includes('cdRestore.attempt'), '[CD] la restauration Drive est sur la même ligne');

/* ══ 9. LES TROIS CARTES DE TRAITEMENT SUR UNE RANGÉE ════════════════════ */
has(CD, 'grid grid-cols-1 xl:grid-cols-3 gap-3 items-start',
  '[CD] « Ellipticity conversion / Blank Subtraction / Math Operations » sur une rangée');
const cdGrid = CD.indexOf('grid grid-cols-1 xl:grid-cols-3 gap-3 items-start');
const cdEll = CD.indexOf('🧮 Ellipticity conversion — [θ] / Δε');
const cdBlank = CD.indexOf('🧹 Blank Subtraction');
const cdMath = CD.indexOf('🔧 Math Operations');
ok(cdGrid > 0 && cdGrid < cdEll && cdEll < cdBlank && cdBlank < cdMath,
  '[CD] les trois cartes sont dans la grille, dans l’ordre attendu');
ok(CD.indexOf('</div>\n\n        <SpectraVisualization ctx={ctx} />') > cdMath,
  '[CD] la grille se referme après la troisième carte (le graphique reste dessous)');

/* ══ 10. RIEN N'A ÉTÉ PERDU ══════════════════════════════════════════════ */
has(SSN, 'Archive spectra to Drive', '[ssNMR] l’archivage Drive reste disponible');
has(SSN, 'DriveUploadButton', '[ssNMR] …par le même bouton');
has(NMR, '⬇️ Restore from Drive', '[NMR] la restauration manuelle du spectre reste possible');
has(SSN, '⬇️ Restore from Drive', '[ssNMR] la restauration manuelle des colonnes reste possible');
has(CD, '⬇️ Restore from Drive', '[CD] la restauration manuelle des colonnes reste possible');
has(SSN, 'manualSWkHz', '[ssNMR] le lecteur 1r accepte toujours un SW manuel (pour les appels internes)');
has(CD, '+ Add Spectrum', '[CD] l’ajout manuel de spectre existe toujours');
has(SSN, '+ Add Spectrum', '[ssNMR] l’ajout manuel de spectre existe toujours');
has(CD, 'Export CSV (all conditions)', '[CD] l’export CSV existe toujours');
has(SSN, 'Export CSV (all conditions)', '[ssNMR] l’export CSV existe toujours');

/* ══ 11. « PDB ID / URL / local file » (NMR, volet 3D) A DISPARU ═════════ */

/* Ce champ vivait sur la page NMR, juste au-dessus du viewer 3D, et recopiait
   dans `activeTest.structureSrc` ce que les commandes du viewer écrivent déjà
   (📂 PDB file(s) / « PDB ID or URL » → `onStructureSrc`). Deux champs pour une
   même adresse finissent par diverger — et c'est celui du viewer qui est
   RÉELLEMENT chargé. Partis avec lui : son état de frappe « découplé » (celui
   qui évitait de re-rendre le WebGL à chaque touche) et son bouton Load.
   Les assertions visent l'étiquette JSX et l'espace réservé, jamais l'identifiant
   seul : le commentaire qui raconte la disparition cite le libellé, il ne doit
   pas faire passer un test qui, lui, parle du code. */
ok(!NMR.includes('>PDB ID / URL / local file</label>'),
  '[NMR] l’étiquette « PDB ID / URL / local file » du volet 3D a disparu');
ok(!NMR.includes('e.g. 1UBQ or /structures/POPC.pdb'),
  '[NMR] …et son champ de saisie (l’invite qui allait avec)');
ok(!NMR.includes('value={localPdbInput}') && !NMR.includes('setLocalPdbInput')
  && !NMR.includes('applyPdbInput'),
  '[NMR] …ni son état de frappe découplé, ni son bouton Load');
has(NMR, 'onStructureSrc={(v) => updateActiveTest({ structureSrc: v })}',
  '[NMR] le viewer 3D reste le SEUL à écrire activeTest.structureSrc');
has(NMR, 'const structureSrc = useMemo(() => {',
  '[NMR] la source du viewer est toujours calculée à partir de la condition');
has(NMR, 'activeTest.structureSrc || activeTest.pdbId',
  '[NMR] …code PDB, URL, fichier déposé ou PDB de page : tous au même endroit');

console.log(`_compact_sections_test.mjs — ${passed} assertions passées ✔`);
