/* =========================================================================
   _cys_oxidized_ranges_test.mjs — LE ¹³C DE LA CYSTÉINE OXYDÉE DANS LA PAGE
   « THEORETICAL CHEMICAL SHIFT RANGES ».

   Ce qui doit rester vrai :

     • les barres « Theoretical ¹H Ranges » / « Theoretical ¹³C Ranges » du
       panneau Simulations ne montrent plus les valeurs de la cystéine RÉDUITE
       (¹³Cβ 26–32 ppm) pour une cystéine engagée dans un pont disulfure :
       l'état redox est résolu POSITION PAR POSITION, exactement comme les
       déplacements simulés (cysIsOxidized → CYS_OXIDIZED_RC ¹³Cβ = 39.6 ppm) ;
     • ¹³Cβ oxydée ≈ 40 ppm et ¹³Cα recule de ~5 ppm
       (CYS_OXIDIZED_CARBON_RANGE) contre 26–32 / 54.5–60 ppm pour la forme
       libre −SH (CARBON_RANGE_DB.C) ;
     • une séquence qui MÉLANGE thiols libres et disulfures reçoit l'UNION des
       deux fenêtres — aucune cystéine ne tombe hors de sa barre ;
     • le drapeau « oxydée » ne fuit NI sur les autres résidus (Ala, etc.) NI
       sur les autres atomes (¹³C′ inchangé), et les ¹H ne bougent pas ;
     • l'infobulle d'une barre nomme l'état pris en compte (note) ;
     • la référence RANDOM-COIL d'un résidu suit le MÊME état redox partout où
       elle est montrée ou soustraite : l'infobulle « 🧪 Random coil » sous les
       cellules de déplacements, la table / le graphe Δδ (CSI) et les
       déplacements simulés — une Cys oxydée est référencée sur ¹³Cβ 39.6 ppm,
       jamais sur la valeur réduite 28.0 ;
     • les deux tables + la résolution redox sont bien celles du rendu.

   Les tables et les fonctions pures sont RÉELLEMENT exécutées (extraction du
   source puis `new Function`, comme _compact_sections_test.mjs) : NMRData.jsx
   et NMRSections.jsx sont du JSX, ils ne s'importent pas sous Node.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const DATA = read('src/components/NMRData.jsx');
const SEC = read('src/components/NMRSections.jsx');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};
const has = (src, needle, what) => {
  assert.ok(src.includes(needle), `${what}\n  cherche : ${needle}`);
  passed += 1;
};

/* Le littéral `{ … }` qui suit un en-tête `export const X = {`. */
const grabObject = (src, name) => {
  const header = `export const ${name} = {`;
  const start = src.indexOf(header);
  assert.ok(start !== -1, `${name} introuvable dans NMRData.jsx`);
  let depth = 0;
  for (let i = start + header.length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1).replace(/^export\s+/, '')};`;
    }
  }
  assert.fail(`${name} non terminé`);
};

/* La déclaration complète `const f = … ;` (profondeur de crochets suivie). */
const grabFn = (src, name) => {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start !== -1, `${name} introuvable dans NMRSections.jsx`);
  let depth = 0;
  for (let i = start + `const ${name} = `.length; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  assert.fail(`${name} non terminé`);
};

const code = [
  grabObject(DATA, 'CARBON_RANGE_DB'),
  grabObject(DATA, 'CYS_OXIDIZED_CARBON_RANGE'),
  grabObject(DATA, 'CYS_OXIDIZED_RC'),
  grabObject(DATA, 'RANDOM_COIL_DB'),
  grabFn(SEC, 'getCarbonRangeFor'),
  grabFn(SEC, 'cysIsOxidized'),
  grabFn(SEC, 'cysCarbonRange'),
  grabFn(SEC, 'randomCoilRefOf')
].join('\n');
const {
  CARBON_RANGE_DB, CYS_OXIDIZED_CARBON_RANGE, CYS_OXIDIZED_RC, RANDOM_COIL_DB,
  getCarbonRangeFor, cysIsOxidized, cysCarbonRange, randomCoilRefOf
} = new Function(
  `${code}\nreturn { CARBON_RANGE_DB, CYS_OXIDIZED_CARBON_RANGE, CYS_OXIDIZED_RC, RANDOM_COIL_DB, getCarbonRangeFor, cysIsOxidized, cysCarbonRange, randomCoilRefOf };`
)();

/* ══ 1. Les deux fenêtres théoriques de la cystéine ════════════════════════ */

eq(CARBON_RANGE_DB.C.Cβ, [26, 32], 'la table carbone garde la cystéine RÉDUITE (−SH) : ¹³Cβ 26–32 ppm');
eq(CARBON_RANGE_DB.C.Cα, [54.5, 60], '…et ¹³Cα 54.5–60 ppm');
eq(CYS_OXIDIZED_CARBON_RANGE.Cβ, [36.5, 43], 'la cystéine OXYDÉE (S–S) a sa propre fenêtre ¹³Cβ ≈ 40 ppm');
eq(CYS_OXIDIZED_CARBON_RANGE.Cα, [50.5, 56.5], '…et ¹³Cα ≈ 53.5 ppm, plus haut champ que la forme libre');

const redCβ = getCarbonRangeFor('protein', 'C', 'Cβ');
const oxCβ = getCarbonRangeFor('protein', 'C', 'Cβ', true);
const redCα = getCarbonRangeFor('protein', 'C', 'Cα');
const oxCα = getCarbonRangeFor('protein', 'C', 'Cα', true);

eq(redCβ, { min: 26, max: 32 }, 'sans drapeau, getCarbonRangeFor rend la forme réduite');
eq(oxCβ, { min: 36.5, max: 43 }, 'avec le drapeau « oxydée », il rend la fenêtre du disulfure');
ok(CYS_OXIDIZED_RC.CB >= oxCβ.min && CYS_OXIDIZED_RC.CB <= oxCβ.max,
  `la barre oxydée ¹³Cβ contient la valeur random-coil ¹³Cβ = ${CYS_OXIDIZED_RC.CB} ppm des déplacements simulés`);
ok(!(CYS_OXIDIZED_RC.CB >= redCβ.min && CYS_OXIDIZED_RC.CB <= redCβ.max),
  '…et cette valeur tombe HORS de la barre réduite — d\'où le correctif');
ok(RANDOM_COIL_DB.C.CB >= redCβ.min && RANDOM_COIL_DB.C.CB <= redCβ.max,
  `la barre réduite contient la valeur random-coil ¹³Cβ = ${RANDOM_COIL_DB.C.CB} ppm`);
ok(!(RANDOM_COIL_DB.C.CB >= oxCβ.min && RANDOM_COIL_DB.C.CB <= oxCβ.max),
  '…et elle est exclue de la barre oxydée (les deux états ne partagent plus une barre)');
ok(CYS_OXIDIZED_RC.CA >= oxCα.min && CYS_OXIDIZED_RC.CA <= oxCα.max,
  `la barre oxydée ¹³Cα contient ¹³Cα = ${CYS_OXIDIZED_RC.CA} ppm`);
ok(oxCα.max < redCα.max && oxCα.min < redCα.min,
  '¹³Cα recule bien de ~5 ppm quand le pont disulfure se ferme');

/* ══ 2. Aucune fuite sur les autres résidus / atomes ══════════════════════ */

eq(getCarbonRangeFor('protein', 'A', 'Cβ', true), { min: 15.5, max: 20.5 },
  'le drapeau « oxydée » ne touche pas l\'alanine (seule la Cys change)');
eq(getCarbonRangeFor('protein', 'C', "C'", true), { min: 171, max: 178 },
  '¹³C′ (carbonyle) ne dépend pas de l\'état redox du thiol');
eq(getCarbonRangeFor('protein', 'A', 'Cβ'), { min: 15.5, max: 20.5 },
  'la forme réduite par défaut reste celle de CARBON_RANGE_DB');
eq(getCarbonRangeFor('dna', 'C', 'C2', true), { min: 147, max: 156 },
  'C = cytosine d\'un ADN : le drapeau cystéine ne s\'applique jamais aux acides nucléiques');

/* ══ 3. La résolution par position (cysIsOxidized) ════════════════════════ */

ok(cysIsOxidized(true, {}, [], 4), 'défaut global « oxydée » → toute Cys est oxydée');
ok(!cysIsOxidized(false, {}, [], 4), 'défaut global « réduite » → toute Cys est réduite');
ok(cysIsOxidized(false, { 4: 'oxidized' }, [], 4), 'l\'état par résidu (cysStates) force l\'oxydation');
ok(!cysIsOxidized(true, { 4: 'reduced' }, [], 4), '…et force aussi la réduction');
ok(cysIsOxidized(false, {}, [[3, 7]], 7), 'un pont disulfure (cysDisulfides) oxyde ses deux cystéines');
ok(!cysIsOxidized(false, {}, [[3, 7]], 4), '…sans toucher une cystéine hors paire');

/* ══ 4. La fenêtre retournée pour un atome donné ══════════════════════════ */

eq(cysCarbonRange('Cβ', { oxidized: false, reduced: true }), { min: 26, max: 32 },
  'séquence 100 % thiols libres → la barre reste réduite');
eq(cysCarbonRange('Cβ', { oxidized: true, reduced: false }),
  { min: 36.5, max: 43, note: 'oxidised Cys (S–S)' },
  'séquence 100 % disulfures → la barre est oxydée et l\'infobulle le dit');
eq(cysCarbonRange('Cβ', { oxidized: true, reduced: true }),
  { min: 26, max: 43, note: 'reduced + oxidised Cys (S–S)' },
  'séquence mixte → UNION des deux fenêtres, aucune Cys hors barre');
eq(cysCarbonRange('Cα', { oxidized: true, reduced: true }),
  { min: 50.5, max: 60, note: 'reduced + oxidised Cys (S–S)' },
  'l\'union vaut aussi pour ¹³Cα');
eq(cysCarbonRange("C'", { oxidized: true, reduced: false }), { min: 171, max: 178 },
  'un atome insensible au redox (¹³C′) n\'est pas annoté');

/* ══ 5. La référence random-coil d'UN résidu (infobulle 🧪, Δδ / CSI, shifts) ══
   Un point d'entrée UNIQUE (`randomCoilRefOf`) : l'infobulle « 🧪 Random coil »
   sous les cellules, la table/le graphe Δδ de la section Secondary Shifts et les
   déplacements simulés. Sans lui, une Cys oxydée était référencée sur la table
   RÉDUITE (¹³Cβ 28.0 au lieu de 39.6 : ~12 ppm d'erreur dans le CSI). */

ok(randomCoilRefOf('protein', 'C', true) === CYS_OXIDIZED_RC,
  'Cys oxydée → table CYS_OXIDIZED_RC (¹³Cβ 39.6 ppm)');
ok(randomCoilRefOf('protein', 'C', false) === RANDOM_COIL_DB.C,
  'Cys réduite → table random-coil habituelle (¹³Cβ 28.0 ppm)');
ok(Math.abs(randomCoilRefOf('protein', 'C', true).CB - 39.6) < 1e-9
  && Math.abs(randomCoilRefOf('protein', 'C', false).CB - 28.0) < 1e-9,
  '…~12 ppm d\'écart selon l\'état redox : plus aucun panneau ne montre la valeur réduite d\'une Cys oxydée');
ok(randomCoilRefOf('protein', 'A', true) === RANDOM_COIL_DB.A,
  'le drapeau « oxydée » ne fuite pas sur les autres résidus');
eq(randomCoilRefOf('dna', 'C', true), {},
  'une cytosine d\'ADN ne reçoit JAMAIS la table cystéine (la table est indexée par code 1 lettre d\'acide aminé)');
eq(randomCoilRefOf('protein', 'X', false), {}, 'une lettre hors table ne rend aucune valeur (jamais NaN dans le CSI)');

/* …et les TROIS panneaux passent bien par elle. */
has(SEC, 'const rcEntry = randomCoilRefOf(moleculeType, char, cysOxidizedHere);',
  'les déplacements simulés résolvent l\'état redox par résidu');
has(SEC, 'const rcEntry = randomCoilRefOf(d.moleculeType, res.char, res.cysOxidized);',
  'l\'infobulle 🧪 Random coil lit l\'état PORTÉ PAR LE RÉSIDU');
has(SEC, 'const rc = randomCoilRefOf(moleculeType, res.char, res.cysOxidized);',
  'la table Δδ / CSI aussi');
has(SEC, 'cysOxidized: cysOxidizedHere',
  '…l\'état redox voyage AVEC le résidu (estSeq), donc tous les panneaux voient le même');
has(SEC, 'const rc = randomCoilRefOf(moleculeType, res.char, res.cysOxidized);',
  '…sans qu\'aucun panneau ne relise la table à la main');
eq((SEC.match(/RANDOM_COIL_DB\[/g) || []).length, 1,
  'une SEULE lecture de la table random-coil subsiste dans la page : la fonction randomCoilRefOf');
has(SEC, "return char === 'C' && cysOxidized ? CYS_OXIDIZED_RC : (RANDOM_COIL_DB[char] || {});",
  '…et c\'est bien elle qui choisit la table');

/* ══ 6. La page affiche bien ces valeurs ══════════════════════════════════ */

has(SEC, 'CYS_OXIDIZED_RC, CYS_OXIDIZED_CARBON_RANGE,', 'la table oxydée est importée dans NMRSections.jsx');
has(SEC, "const rg = char === 'C' && cysRedox ? cysCarbonRange(cn, cysRedox) : getCarbonRangeFor(moleculeType, char, cn);",
  'le memo des ranges passe par la résolution redox de la cystéine');
has(SEC, "const cysPositions = moleculeType === 'protein' ? parsedSeq.map((res, i) => (res.char === 'C' ? i + 1 : 0)).filter(Boolean) : [];",
  '…après avoir résolu l\'état redox POSITION PAR POSITION dans la séquence');
has(SEC, 'note: rg.note', 'la note d\'état voyage avec la barre');
has(SEC, 'activeTest.cysOxidized, activeTest.cysStates, activeTest.cysDisulfides]);',
  'les trois réglages redox (défaut, par résidu, ponts) déclenchent le recalcul');
has(SEC, '{ranges[hover.idx].note && (', 'l\'infobulle des barres affiche la note d\'état redox');
has(SEC, 'title="Theoretical ¹³C Ranges"', 'le panneau « Theoretical ¹³C Ranges » existe toujours');
has(SEC, 'title="Theoretical ¹H Ranges"', '…comme celui des ¹H');

console.log(`_cys_oxidized_ranges_test.mjs : ${passed} assertions passées`);
