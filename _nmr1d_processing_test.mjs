/* =========================================================================
   _nmr1d_processing_test.mjs — le RÉGLAGE du spectre 1D NMR survit à tout.

   Le défaut signalé : écrire une valeur dans la table, ou phaser / calibrer le
   spectre, puis quitter et revenir → spectre « revenu non phasé » ; et rien de
   tout cela non plus sur un autre poste (navigation privée).

   La cause tenait à trois nombres : la calibration et la phase PH0/PH1 étaient
   écrites DANS la copie d'affichage `nmr1dSpectrum`. Or cette copie est une
   « unité lourde » pour compressDatasetForSave (trois tableaux de plus de 400
   nombres, plus de 50 Ko au total) : Stage 5 la remplace ENTIÈREMENT par le
   marqueur « [nmr1dSpectrum omitted …] » dès que le document du dataset doit
   maigrir. La copie d'affichage manquante déclenchait alors la restauration
   Drive automatique, qui réinjectait l'archive **figée à l'import** —
   `calibration: 0, phaseDeg: 0, phase1Deg: 0`. D'où le spectre droit.

   Ce qui doit rester vrai :

     • le réglage vit dans SON PROPRE champ, fait de quelques NOMBRES
       (`nmr1dProcessing`) : la compression ne touche jamais un scalaire, donc
       il voyage avec le dataset et se retrouve d'un poste à l'autre ;
     • AUCUNE écriture d'interface ne passe plus par la copie d'affichage ;
     • la restauration Drive ne remet JAMAIS le réglage à zéro : l'archive est
       plus ancienne que le travail de l'utilisateur ;
     • le rendu applique le réglage DU TEST à la copie qu'il dessine (cache du
       navigateur ou archive restaurée), partout : page NMR, overlay des
       conditions, aperçu du cahier de laboratoire ;
     • la copie d'affichage absente n'empêche plus d'afficher le spectre quand la
       version plein format est encore dans la cache du navigateur.

   NMRSections.jsx est un .jsx : les règles sont vérifiées SUR LA SOURCE, comme
   les autres garde-fous du dépôt.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.equal(a, b, what);
  passed += 1;
};

// CRLF → LF so the multi-line needles below can be written naturally.
const NMR = readFileSync(new URL('./src/components/NMRSections.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const BOOK = readFileSync(new URL('./src/components/LabNotebook.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const APP = readFileSync(new URL('./src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(NMR.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!NMR.includes(needle), `${what}\n  encore présent : ${needle}`);
const count = (src, re) => (src.match(re) || []).length;

/* ── 1. Le réglage a SON champ, déclaré une fois ─────────────────────────── */
has("const NMR1D_PROCESSING = 'nmr1dProcessing';",
  'le champ du réglage est déclaré une seule fois, sous un nom unique');
has('export const nmr1dProcessingOf = (spec, test = null) => {',
  'le réglage effectif se lit par une fonction unique');
has(`const src = isNmr1dProcessing(stored)
    ? stored
    : (isNmr1dProcessing(spec) ? spec : null);`,
  'le réglage DU TEST gagne sur celui porté par la copie de spectre (archive Drive incluse)');
has('export const nmr1dProcessingPatch = (test = {}, patch = {}) => {',
  'les écritures passent par un seul constructeur de patch');
/* Le patch ne réécrit la copie d'affichage que si elle est VRAIMENT là :
   sinon « {...'[nmr1dSpectrum omitted …]'} » recréerait un spectre en texte. */
has('if (isNmr1dProcessing(spec) && !isMissingValue(spec)) {',
  'le patch refuse d’écrire dans une copie d’affichage absente ou remplacée par un marqueur');

/* ── 2. Plus AUCUNE écriture de phase / calibration dans la copie d'affichage */
eq(count(NMR, /nmr1dSpectrum: \{ \.\.\.spec/g), 0,
  'plus aucune écriture « nmr1dSpectrum: { ...spec, phase / calibration } } »');
eq(count(NMR, /updateActiveTest\(nmr1dProcessingPatch\(activeTest,/g), 8,
  'les huit réglages (calibrer, offset, reset calibration, PH0 curseur/saisie, PH1 curseur/saisie, reset phase) passent par le champ du test');
has('updateActiveTest(nmr1dProcessingPatch(activeTest, { phaseDeg: 0, phase1Deg: 0 }))',
  'le « reset » de phase efface le réglage enregistré, pas seulement l’affichage');

/* ── 3. La restauration Drive ne remet plus le réglage à zéro ─────────────── */
has('const proc = nmr1dProcessingOf(full, activeTest);',
  'la restauration relit le réglage du test (et ne repart pas de l’archive)');
has('nmr1dProcessing: { ...proc, at: Date.now() },',
  '…et le réécrit tel quel sur le test, en même temps que la copie restaurée');
gone('phaseDeg: Number(full.phaseDeg) || 0,',
  'l’archive (figée à l’import) n’écrase plus la phase de l’utilisateur');
gone('calibration: Number(full.calibration) || 0,',
  '…ni sa calibration');


/* ── 4. Le rendu applique le réglage DU TEST ─────────────────────────────── */
has('export const getNmr1dDisplay = (spec, processing = null) => {',
  'l’affichage accepte le réglage en second argument');
has("const proc = (processing && typeof processing === 'object') ? processing : spec;",
  '…et retombe sur les champs portés par la copie quand il n’y en a pas (rétrocompatibilité)');
has('const disp = getNmr1dDisplay(dispBase, proc) || { xs: dispBase.xs, ys: dispBase.ys };',
  'la page NMR dessine avec le réglage du test');
has('const disp = getNmr1dDisplay(spec, inst.test && inst.test.nmr1dProcessing);',
  'l’overlay des conditions applique le réglage de CHAQUE condition');
ok(BOOK.includes('getNmr1dDisplay(spec, localTest.nmr1dProcessing)'),
  'l’aperçu du cahier de laboratoire applique le réglage du test');
eq(count(BOOK, /getNmr1dDisplay\(spec\)/g), 0,
  '…aucun appel du cahier ne reste sans réglage');

/* ── 5. La copie d'affichage absente ne cache plus le spectre ────────────── */
has('const nmr1dLightHere = isNmr1dProcessing(nmr1dSpecRaw) && !isMissingValue(nmr1dSpecRaw);',
  'la page sait si la copie d’affichage est là ou remplacée par un marqueur');
has('const nmr1dFullHere = !!(fullNmrSpec && Array.isArray(fullNmrSpec.xs) && fullNmrSpec.xs.length);',
  '…et si la version plein format est dans la cache du navigateur');
has(`    if (nmr1dLightHere && !nmr1dSpecRaw.fullStore) { setFullNmrSpec(null); return; }
    if (!activeTest.id) return;`,
  'la cache plein format est lue même quand le document ne porte plus la copie légère');
has('      : (nmr1dFullHere ? { ...fullNmrSpec, fullStore: true } : null);',
  'le rendu part de la copie complète quand la copie d’affichage manque');
has('const nmr1dDrawable = () => (', 'l’état « spectre chargé » de la page suit la même règle');
has('{nmr1dDrawable() && <span className="text-[9px] bg-green-100 text-green-800 px-2 py-0.5 rounded font-bold">Spectrum loaded</span>}',
  '…et la page ne dit plus « pas de spectre » au-dessus d’un spectre dessiné');
has('full copy from this browser', '…elle dit d’où vient la copie affichée');

/* ── 6. Les deux imports sèment le réglage, le retrait l'efface ──────────── */
eq(count(NMR, /nmr1dProcessing: \{ calibration: 0, phaseDeg: 0, phase1Deg: 0, at: Date\.now\(\) \}/g), 1,
  'l’import fichier/URL pose le réglage du nouveau spectre (zéro) sur le test');
has('cloned.nmr1dProcessing = { calibration: 0, phaseDeg: 0, phase1Deg: 0, at: Date.now() };',
  'l’import dossier (clones) donne à CHAQUE condition son propre réglage à zéro');
has('updateActiveTest({nmr1dSpectrum: null, nmr1dProcessing: null})',
  '« × Remove » efface le spectre ET son réglage');

/* ── 7. POURQUOI un champ à part : la règle de compression, relue à la source */
/* Stage 5 de compressDatasetForSave remplace une valeur par un marqueur quand
   ses tableaux numériques dépassent 400 nombres et que l'unité dépasse 50 Ko.
   La règle est relue à la source (si elle change, ce test le dit) puis
   appliquée aux deux formes : la copie d'affichage EST lourde, le réglage ne
   l'est JAMAIS. */
ok(APP.includes('const isBigNumericArray = (v) => Array.isArray(v) && v.length > 400 && v.every(isFiniteNumber);'),
  'App.jsx borne toujours un « grand » tableau numérique à 400 nombres');
ok(APP.includes('if (total > 50000) { out.push({ path, size: total }); return; }'),
  '…et une « unité » à 50 Ko');
const isBigNumericArray = (v) => Array.isArray(v) && v.length > 400
  && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const approxSizeOf = (v) => {
  if (typeof v === 'string') return v.length;
  if (typeof v === 'number') return 8;
  if (Array.isArray(v)) return v.reduce((s, x) => s + approxSizeOf(x), 0);
  if (v && typeof v === 'object') return Object.keys(v).reduce((s, k) => s + approxSizeOf(v[k]), 0);
  return 4;
};
const unitDroppable = (node) => {
  const vals = Object.values(node);
  const heavyNumeric = vals.filter(isBigNumericArray).length;
  return heavyNumeric > 0 && heavyNumeric >= Math.min(2, Math.ceil(vals.length / 2))
    && approxSizeOf(node) > 50000;
};
const specCopy = (n) => ({
  xs: new Array(n).fill(1.5), ys: new Array(n).fill(0), ysImag: new Array(n).fill(0),
  meta: { nucleus: '1H', swPpm: 12.5 }, title: 'Sample 1',
  calibration: 0, phaseDeg: 0, phase1Deg: 0, fullStore: true
});
ok(unitDroppable(specCopy(4000)),
  'la copie d’affichage (3 × 4000 points) EST une unité lourde : Stage 5 la remplace par son marqueur');
ok(!unitDroppable(specCopy(400)),
  '…une copie bornée à 400 points ne le serait plus (la borne d’un tableau « grand » est 400)');
const PROC = { calibration: 0.31, phaseDeg: 27, phase1Deg: -4, at: Date.now() };
ok(!Object.values(PROC).some(isBigNumericArray),
  'le réglage ne contient AUCUN grand tableau numérique : il n’est jamais un marqueur');
ok(approxSizeOf(PROC) < 200,
  '…quelques dizaines d’octets : il voyage TOUJOURS avec le dataset (autre poste, navigation privée)');
ok(Object.values(PROC).every((v) => typeof v === 'number'),
  '…et rien que des nombres : la forme que la compression ne touche jamais');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_nmr1d_processing_test.mjs — ${passed} assertions OK (le réglage du spectre 1D suit le dataset)`);
