/* =========================================================================
   _viewer_selection_toggle_test.mjs — UN GESTE DANS LA BARRE SELECTIONS.

   Le rapport : « la fenêtre de gauche (selections) n'a aucun contrôle sur la
   molécule : si j'essaie de changer POPC, il reste en sphères ».

   La cause est visible dans la macro de référence (celle de
   _pymol_selections_test.mjs, qui est la forme réelle des macros utilisateur) :
   les MÊMES atomes sont dessinés par PLUSIEURS lignes.

     select headgroups, phosphate or POPC
     select upper_headgroups, headgroups and z>90
     hide all
     show sphere, resn POPC+POPE+…+PSM      ← ligne « ⌗ expression brute »
     show spheres, upper_headgroups         ← mêmes atomes de tête
     show sticks, headgroups                ← et POPC a aussi des sticks

   Or chaque ligne dessinait SA représentation, indépendamment : décocher
   « sphere » sur une ligne enlevait bien ses sphères, mais les billes
   identiques de l'autre ligne restaient à l'écran. L'utilisateur ne voyait donc
   RIEN changer — le curseur semblait mort.

   En PyMOL le geste est le DERNIER COMMANDÉ sur ces atomes : `hide spheres,
   POPC` les enlève pour de bon. Le viewer donne maintenant ce poids au geste :
   il écrit l'expression PyMOL de la ligne dans le `hideFor` de TOUTE AUTRE
   ligne qui dessine le même style, et le rendu les soustrait déjà atome par
   atome (`exclusionOf` → `and not (…)`).

   Et le geste jumeau « 🙈 Hide » : mêmes lignes-overlays, donc masquer POPC ne
   retirait que les représentations de SA ligne — les billes de
   upper_headgroups restaient à l'écran, et les sticks de headgroups avec elles
   (« je n'arrive pas à cacher POPC, hide ne marche pas dans la fenêtre de
   gauche »). Masquer une ligne vaut maintenant « hide everything, POPC » : ses
   atomes quittent TOUTES les autres lignes, quel que soit leur style.

   Ce garde-fou EXTRAIT `toggleSelStyle` et `hiddenRowExprs` du viewer et les
   EXÉCUTE sur les styles que la macro de référence produit, puis vérifie
   l'aller-retour (les deux gestes sont réversibles), l'indépendance des
   familles et la non-mutation des styles.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── Extraction : `const nom = (…) => { … }` (accolades comptées) ────────── */
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const offset = src.slice(arrow + 2).search(/\S/);
  const body = arrow + 2 + offset;
  assert.equal(src[body], '{', `${name} : corps bloc attendu`);
  let depth = 0;
  for (let i = body; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : corps non terminé`);
};
const CODE = sliceFn(VIEW, 'toggleSelStyle');

/* ── Les styles que la macro de référence produit (mêmes valeurs que ───────
   applyPyMOLScript : chaque `select` cité est remis à zéro, puis les `show` /
   `hide` / `set` de la macro s'appliquent dans l'ordre). */
const RAW = 'resn POPC+POPE+POPG+POPS+POPI+TOCL+CHL1+STIG+SITO+ERG+FOS*+ECL*+PSM';
const SELECTIONS = [
  { name: 'water', expr: 'resn TIP3+POT+SOD' },
  { name: 'phosphate', expr: 'name P* and resn POPC+POPE' },
  { name: 'headgroups', expr: 'phosphate or POPC' },
  { name: 'upper_headgroups', expr: 'headgroups and z>90' },
];
const OFF = { cartoon: false, ribbon: false, tube: false, ball: false, stick: false, sphere: false, surface: false };
const macroStyles = () => ({
  all: { ...OFF },
  water: { ...OFF },
  phosphate: { ...OFF },
  // « show sticks, headgroups » puis « hide sticks, name H* and headgroups »
  headgroups: { ...OFF, stick: true, hideFor: { stick: ['name H* and headgroups'] } },
  // « show spheres, upper_headgroups »
  upper_headgroups: { ...OFF, sphere: true },
  // « show sphere, resn POPC+… » puis « hide spheres, membrane and z>90 »
  [RAW]: { ...OFF, sphere: true, hideFor: { sphere: ['membrane and z>90'] } },
});

/* ── Le banc : la fonction RÉELLE, ses trois collaborateurs en doublure ──── */
const runToggle = (key, style, times = 1) => new Function('cfg', `${CODE}
  const selStylesRef = { current: cfg.styles };
  const selections = cfg.selections;
  let recorded = null;
  const setSelStyles = (next) => { recorded = next; selStylesRef.current = next; };
  for (let i = 0; i < cfg.times; i += 1) toggleSelStyle(cfg.key, cfg.style);
  return { next: recorded };`)({ styles: macroStyles(), selections: SELECTIONS, key, style, times });

/* ══ 1. LE GESTE DE L'UTILISATEUR, SUR LA MACRO DE RÉFÉRENCE ══════════════
   Il décoche « sphere » sur la ligne upper_headgroups : les mêmes atomes de
   tête sont aussi dessinés par la ligne ⌗ resn POPC+… — c'est de là que vient
   le « POPC reste en sphères ». */
const A = runToggle('upper_headgroups', 'sphere');
eq(A.next.upper_headgroups.sphere, false, 'la ligne cliquée perd bien SES sphères');
eq(A.next[RAW].hideFor.sphere, ['membrane and z>90', 'headgroups and z>90'],
  '…et ses atomes sont soustraits de l’autre ligne qui les dessinait aussi (le hide déjà présent est conservé)');
ok(/and z>90$/.test(A.next[RAW].hideFor.sphere[1]),
  'la clause rangée est le texte PyMOL de la ligne : le pont la ré-étendra au rendu');
eq(A.next.headgroups, macroStyles().headgroups,
  'une autre famille (les sticks de headgroups) n’est pas touchée du tout');
eq(A.next.water, macroStyles().water, 'une ligne qui ne dessine pas ce style n’est pas modifiée pour rien');
eq(A.next.phosphate, macroStyles().phosphate, '…idem pour phosphate');
eq(A.next.all, macroStyles().all, '…et pour « all »');

/* ══ 2. L'ALLER-RETOUR : le geste est RÉVERSIBLE ══════════════════════════ */
const A2 = runToggle('upper_headgroups', 'sphere', 2);
eq(A2.next, macroStyles(),
  'décocher puis recocher redonne EXACTEMENT les styles de la macro (aucune exclusion oubliée)');

/* ══ 3. L'AUTRE CÔTÉ : la ligne « ⌗ expression brute » (celle qui porte POPC) ═ */
const B = runToggle(RAW, 'sphere');
eq(B.next[RAW].sphere, false, 'la ligne brute perd ses sphères');
eq(B.next.upper_headgroups.hideFor.sphere, [RAW],
  '…et sa clause est soustraite des billes que upper_headgroups dessinait sur les MÊMES atomes');
ok(/^resn /.test(B.next.upper_headgroups.hideFor.sphere[0]),
  'la clause est bien l’expression brute de la ligne (pas une liste d’index NGL)');

/* ══ 4. LA LIGNE CLIQUÉE GARDE SES PROPRES HIDES ══════════════════════════ */
eq(B.next[RAW].hideFor, { sphere: ['membrane and z>90'] },
  'le « hide spheres, membrane and z>90 » de la macro n’est pas perdu par le geste');
const C = runToggle('headgroups', 'stick');
eq(C.next.headgroups.hideFor, { stick: ['name H* and headgroups'] },
  '…même chose pour les sticks de headgroups');

/* ══ 5. LES FAMILLES SONT INDÉPENDANTES ═══════════════════════════════════ */
eq(C.next[RAW], macroStyles()[RAW], 'décocher les sticks ne touche pas aux sphères');
eq(C.next.upper_headgroups, macroStyles().upper_headgroups, '…ni à la ligne des têtes');

/* ══ 6. LA LIGNE « all » N'ÉCRIT D'EXCLUSION NULLE PART ═══════════════════ */
const D = runToggle('all', 'sphere');
eq(D.next.all.sphere, true, 'la ligne all bascule normalement');
eq(Object.keys(D.next).length, Object.keys(macroStyles()).length, '…sans ajouter de ligne');
eq(D.next[RAW], macroStyles()[RAW], '…et sans écrire d’exclusion sur les autres lignes');

/* ══ 7. LES STYLES D'ORIGINE NE SONT PAS MUTÉS ════════════════════════════ */
const shared = macroStyles();
const snapshot = JSON.parse(JSON.stringify(shared));
new Function('cfg', `${CODE}
  const selStylesRef = { current: cfg.styles };
  const selections = cfg.selections;
  const setSelStyles = () => {};
  toggleSelStyle('upper_headgroups', 'sphere');`)({ styles: shared, selections: SELECTIONS });
eq(shared, snapshot,
  'le geste construit un NOUVEL objet : muter l’ancien ne ferait rien re-rendre par React');

/* ══ 8. LA SOURCE DU VIEWER ══════════════════════════════════════════════ */
has('const toggleSelStyle = (key, style) => {', 'le geste a sa propre fonction (donc testable)');
has('onClick={() => toggleSelStyle(s.name, style)}', '…et les boutons de style l’utilisent');
gone('onClick={() => setSelStyles({ ...selStylesRef.current, [s.name]: { ...(selStylesRef.current[s.name] || {}), [style]: !((selStylesRef.current[s.name] || {})[style]) } })}',
  'l’ancien gestionnaire — qui ne changeait qu’UNE ligne, donc rien à l’écran — a disparu');
has("if (!raw || raw === 'all')", '« all » n’écrit d’exclusion nulle part');
has('const named = selections.find((s) => s.name === key);',
  'la clause rangée est l’expression PyMOL de la ligne (celle que le pont ré-étend)');
has('if (!on && !st[style] && !list.length) return;',
  'seules les lignes qui DESSINENT le style sont touchées quand on le cache');
has("title={`${st[style] ? 'Hide' : 'Show'}", 'le bouton explique le geste et son effet sur les autres lignes');
has('const exclusionOf = (style) => {', 'le rendu sait déjà soustraire ces exclusions (and not (…))');

/* ══ 9. « 🙈 HIDE » : LES MÊMES LIGNES-OVERLAYS, LES MÊMES CONSÉQUENCES ═════
   Cacher une ligne ne retirait que les représentations de CETTE ligne : les
   billes de upper_headgroups et les sticks de headgroups, qui dessinent les
   mêmes atomes de POPC, restaient à l'écran. `hiddenRowExprs` rend les
   expressions des lignes masquées, que `exclusionOf` soustrait à TOUS les
   styles de la ligne qui se dessine. */
const HID = sliceFn(VIEW, 'hiddenRowExprs');
const EXPAND = {
  water: '@0-9',
  headgroups: '@100-299',
  upper_headgroups: '@100-199',
  [RAW]: '@300-999',
};
const runHidden = (styles, selfKey, exprOf = (k) => (EXPAND[k] ?? k)) =>
  new Function('cfg', `${HID}
  return hiddenRowExprs(cfg.styles, cfg.selfKey, cfg.exprOf);`)({ styles, selfKey, exprOf });
const hiddenRow = (key) => ({ ...macroStyles()[key], hidden: true });
const POPC_HIDDEN = { ...macroStyles(), [RAW]: hiddenRow(RAW) };

eq(runHidden(POPC_HIDDEN, 'headgroups'), ['@300-999'],
  'POPC masquée : les sticks de headgroups perdent ses atomes (c’était le « hide ne fait rien »)');
eq(runHidden(POPC_HIDDEN, 'upper_headgroups'), ['@300-999'],
  '…et les billes de upper_headgroups aussi, elles qui dessinaient les mêmes têtes');
eq(runHidden(POPC_HIDDEN, 'water'), ['@300-999'],
  '…dans TOUTE autre ligne, même une qui ne doit rien à POPC (soustraire n’y change aucun atome)');
eq(runHidden(POPC_HIDDEN, RAW), [],
  'la ligne masquée ne se soustrait pas elle-même : elle ne dessine déjà plus rien');
eq(runHidden(macroStyles(), 'headgroups'), [],
  '« 👁 Show » supprime l’exclusion partout : le geste est réversible');
eq(runHidden({ ...macroStyles(), water: hiddenRow('water') }, 'headgroups'), ['@0-9'],
  'une autre ligne masquée retire bien SES atomes : la règle est générale');
eq(runHidden({ ...macroStyles(), all: hiddenRow('all') }, 'headgroups'), [],
  '« all » ne compte pas : tout cacher est le travail du bouton 🙈 Hide all');

const TWO_ALIASES = { ...macroStyles(), water: hiddenRow('water'), phosphate: hiddenRow('phosphate') };
eq(runHidden(TWO_ALIASES, 'headgroups', (k) => (k === 'phosphate' ? '@0-9' : (EXPAND[k] ?? k))), ['@0-9'],
  'deux lignes masquées qui désignent les MÊMES atomes ne comptent qu’une fois (sélection NGL plus courte)');

const NO_ATOMS = {
  ...macroStyles(),
  water: hiddenRow('water'),
  phosphate: hiddenRow('phosphate'),
  headgroups: hiddenRow('headgroups'),
};
eq(runHidden(NO_ATOMS, 'upper_headgroups',
  (k) => (k === 'water' ? 'all' : k === 'phosphate' ? 'none' : k === 'headgroups' ? '' : (EXPAND[k] ?? k))), [],
  'une ligne masquée sans atome (all / none / vide) n’écrit pas de clause vide dans la sélection NGL');

/* ══ 10. LE RENDU CONSOMME BIEN CETTE RÈGLE ═══════════════════════════════ */
has('const hiddenRowExprs = (styles, selfKey, exprOf) => {', 'la règle a sa propre fonction pure (donc testable)');
has('const hiddenElsewhere = hiddenRowExprs(styles, key, selKeyExpr);',
  'le rendu l’appelle une fois par ligne, avec l’expression NGL de la ligne');
has('if (st.hidden) { selCompsRef.current[key] = []; return; }', 'une ligne masquée ne dessine plus rien elle-même');
has("if (!expr || expr === '' || expr === 'all' || expr === 'none' || seen.has(expr)) return;",
  'all / none / vide / doublon écartés AVANT d’écrire la clause');
has("const ex = style ? exclusionOf(style) : '';", 'chaque rep d’une ligne passe par exclusionOf');
has('const sele = ex ? `(${seleBase}) and not (${ex})` : seleBase;', '…et l’exclusion y est soustraite à l’ATOME');
eq((VIEW.match(/addWithOverrides\(/g) || []).length, 7,
  'les sept styles d’une ligne passent tous par le même chemin (donc tous par l’exclusion)');
has('are overlays (the same lipid is drawn by several of them at once)',
  'le bouton explique le geste : sans cela, « hide » semble ne rien faire');
gone("title={st.hidden ? 'Show this selection again' : 'Hide this selection (removes its representations)'}",
  'l’ancien libellé — qui laissait croire à une action locale — a disparu');
has('🙈 hidden — its atoms are removed from EVERY row that draws them',
  'la ligne masquée le dit sur son nom, d’où la disparition des atomes ailleurs');

/* ══ 11. LES COMMANDES D'UNE LIGNE SONT CELLES DE LA STYLING ══════════════
   Demande : « la selection window deve selezionare le stesse cose, quello che
   cambia sono i comandi che devono essere come quelli della styling (incluso i
   materiali) ». Les lignes gardent donc leurs sélections ET leurs styles (un
   macro dessine plusieurs styles à la fois), mais leurs commandes sont celles
   des lignes de la fenêtre « Molecules · styling » : « Color by » (vocabulaire
   et libellés PARTAGÉS, voir COLOR_LABELS), « Transp », R◯ / R—, et le 🎛
   matériau par famille (voir _viewer_materials_test.mjs). */
has("const SEL_COLOR_MODES = [...new Set(Object.values(COLORS).flat())]",
  'la liste des colorations d’une ligne est DÉRIVÉE des vocabulaires du styling (une seule source)');
has("const SEL_COLOR_ALIASES = { chainid: 'chain', resname: 'residue' };",
  'les deux valeurs d’hier (`chainid` / `resname`) gardent un sens : un setup enregistré continue de marcher');
const COLORCODE = sliceFn(VIEW, 'selColorMode');
// La liste que la dérivation produit pour les vocabulaires COLORS du viewer
// (l’extraction la vérifie par la source juste au-dessus).
const MODES = ['solid', 'element', 'chain', 'residue', 'sstruc', 'basetype', 'nucform', 'lipidtype', 'sugar', 'hydrophobicity', 'charge'];
const CM = new Function('SEL_COLOR_MODES', 'SEL_COLOR_ALIASES', `${COLORCODE}
  return { selColorMode };`)(MODES, { chainid: 'chain', resname: 'residue' });
eq(CM.selColorMode({ colorMode: 'chainid' }), 'chain', 'un ancien setup « chainid » s’affiche « Chain »');
eq(CM.selColorMode({ colorMode: 'resname' }), 'residue', '…et « resname » s’affiche « Residue »');
eq(CM.selColorMode({ colorMode: 'lipidtype' }), 'lipidtype', 'une coloration du styling passe telle quelle');
eq(CM.selColorMode({ colorMode: 'esp' }), 'solid',
  'une coloration qu’une ligne ne peut pas porter (esp = une surface) retombe sur Solid');
eq(CM.selColorMode({}), 'solid', 'sans choix : Solid');
eq(CM.selColorMode(null), 'solid', '…et une ligne sans état ne casse rien');
eq(CM.selColorMode({ colorMode: 'solid' }), 'solid', 'Solid reste Solid');
has("{SEL_COLOR_MODES.map((c) => <option key={c} value={c}>{COLOR_LABELS[c] || c}</option>)}",
  'le menu déroulant d’une ligne porte les LIBELLÉS du styling, pas sa propre liste');
has('const colorScheme = colorMode !== \'solid\' ? schemeForColorMode(colorMode) : undefined;',
  '…et le rendu passe par le MÊME mapping de coloration que tout le viewer');
has('const rS = Number.isFinite(st.radiusSphere) ? st.radiusSphere : 1;',
  'les deux rayons d’une ligne partent de 1.00 (taille du style)');
has('radiusSphere: Number(e.target.value)', '…le R◯ de la ligne écrit son multiplicateur');
has('radiusBond: Number(e.target.value)', '…et son R— le sien');
has('{ scale: (st.sphereScale || 1) * rS, colorScheme, opacity, multipleBond: true }',
  'R◯ multiplie la taille des sphères (un `set sphere_scale` du macro reste une propriété d’ATOMES qui multiplie celle-ci)');
has('aspectRatio: 1.3 * rS,', 'R◯ multiplie aussi les sphères des ball+stick');
has('radiusSize: LICORICE_BOND_RADIUS * rB }', 'R— multiplie l’épaisseur des bâtons (licorice)');
has('...(rB !== 1 ? { radiusSize: BALLSTICK_BOND_RADIUS * rB } : {}),',
  '…et ne touche aux ball+stick QUE si l’utilisateur a bougé le curseur (rien ne change par défaut)');

/* ── Bilan ──────────────────────────────────────────────────────────────── */
console.log(`_viewer_selection_toggle_test.mjs — ${passed} assertions OK (styles + hide)`);


