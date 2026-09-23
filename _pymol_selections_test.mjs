/* =========================================================================
   _pymol_selections_test.mjs — les MACROS PyMOL du viewer 3D : ce qu'une macro
   doit dessiner, et ce que l'utilisateur doit pouvoir défaire à la main.

   Les trois rapports que ce garde-fou empêche de revoir :

     • « tout est dessiné en sphères » — une macro dit `hide all` (elle dit par
       là qu'elle POSSÈDE la scène) : le viewer n'ajoute alors AUCUNE sphère
       automatique par-dessus ses 70+ sélections d'aide (scriptHidesAll) ;
     • « les sphères restent même quand je les enlève » — un look créé sur une
       EXPRESSION BRUTE (« show sphere, resn POPC+POPE+… », sans `select`) a
       maintenant sa ligne dans la barre Selections, avec ✕ ; et un
       « hide spheres, <expr> » POSTÉRIEUR soustrait vraiment ses atomes
       (exclusionOf → `(expr) and not (…)`), comme PyMOL où le dernier gagne ;
     • « après la macro le molecular styling n'a plus d'effet » — §2 reprend la
       main dès qu'un de ses réglages bouge (pymolOwnSigRef) au lieu de rester
       gelé jusqu'à « Clear » ;
     • la barre Selections est à GAUCHE et se replie : le styling garde la droite.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Ses helpers PURS sont
   donc EXTRAITS du fichier puis EXÉCUTÉS (comme dans _md_axis_cfg_test.mjs et
   _viewer_style_controls_test.mjs) ; le reste est vérifié SUR LA SOURCE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (c, what) => { assert.ok(c, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

// CRLF → LF pour écrire les aiguilles multi-lignes naturellement.
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);

/* ── 0. Extrait une déclaration entre deux ancres du viewer ─────────────── */
// (Compter les accolades ne suffit pas : un regex comme /[^\]]+/ contient des
// crochets ÉCHAPPÉS que le compteur prendrait pour la fin de la déclaration.)
const sliceBetween = (from, to, what) => {
  const i = VIEW.indexOf(from);
  assert.ok(i >= 0, `ancre « ${from} » introuvable (${what})`);
  const j = VIEW.indexOf(to, i + from.length);
  assert.ok(j > i, `fin « ${to} » introuvable (${what})`);
  return VIEW.slice(i, j);
};
const DECLS = [
  sliceBetween('const pymolStyleToken = ', '\nconst parsePyMOL', 'pymolStyleToken'),
  sliceBetween('const parsePyMOL = ', '\n/* ---- Ordered « show »', 'parsePyMOL'),
  sliceBetween('const styleHidesAfter = ', '\n// Does the script OWN the scene?', 'styleHidesAfter'),
  sliceBetween('const scriptHidesAll = ', '\nconst applyPyMOLScript', 'scriptHidesAll'),
].join('\n');
// Le pont PyMOL → NGL a son PROPRE fichier (_pymol_selection_bridge_test.mjs) :
// il a besoin d'une structure (vocabulaire, coordonnées) pour être exécuté.
const H = new Function(
  `${DECLS}\nreturn { pymolStyleToken, parsePyMOL, styleHidesAfter, scriptHidesAll };`,
)();

/* ── 1. La macro de référence (les lignes qui posaient problème) ─────────── */
const MACRO = `
select water, resn TIP3+POT+SOD
select phosphate, name P* and resn POPC+POPE
select headgroups, phosphate or POPC
select upper_headgroups, headgroups and z>90
hide all
show sphere, resn POPC+POPE+POPG+POPS+POPI+TOCL+CHL1+STIG+SITO+ERG+FOS*+ECL*+PSM
set sphere_scale, 1.0, POPC
hide spheres, membrane and z>90
show spheres, upper_headgroups
set sphere_scale, 0.6, upper_headgroups
set sphere_transparency, 0.3, upper_headgroups
show sticks, headgroups
hide sticks, name H* and headgroups
show cartoon, peptide
bg_color white
util.ray_shadows heavy
`.trim();

const parsed = H.parsePyMOL(MACRO);
eq(parsed.sels.map((s) => s.name), ['water', 'phosphate', 'headgroups', 'upper_headgroups'],
  'les quatre `select` de la macro sont lus dans l’ordre');
eq(parsed.sels[0].expr, 'resn TIP3+POT+SOD', '…avec leur expression');
eq(parsed.colorDefs, {}, 'aucun set_color dans cette macro');

/* ── 2. Les tokens de style sont NORMALISÉS (spheres / sticks) ───────────── */
eq(H.pymolStyleToken('spheres'), 'sphere', 'le pluriel PyMOL « spheres » devient LE style sphere');
eq(H.pymolStyleToken('STICKS'), 'stick', '…« sticks » → stick (insensible à la casse)');
eq(H.pymolStyleToken('ball+stick'), 'ball', '…« ball+stick » → ball');
eq(H.pymolStyleToken('everything'), null, '« everything » n’est pas un style : le parser garde son nom');
eq(H.pymolStyleToken('all'), null, '…et « all » non plus');

/* ── 3. `hide all` dit que la macro possède la scène ─────────────────────── */
const sph1 = parsed.acts.findIndex((a) => a.type === 'show' && a.style === 'sphere');
const sph2 = parsed.acts.findIndex((a, i) => i > sph1 && a.type === 'show' && a.style === 'sphere');
const stk = parsed.acts.findIndex((a) => a.type === 'show' && a.style === 'stick');
ok(sph1 >= 0 && sph2 > sph1 && stk > 0, 'les trois `show` de la macro sont bien parsés');
ok(H.scriptHidesAll(parsed.acts), '« hide all » est reconnu : la macro possède la scène');
ok(!H.scriptHidesAll(parsed.acts.filter((a) => a.type === 'sphere_scale')),
  'un script sans « hide all » n’est pas déclaré propriétaire');

/* ── 4. L’ORDRE des commandes (le dernier gagne, comme PyMOL) ────────────── */
eq(H.styleHidesAfter(parsed.acts, sph1, 'sphere'), ['membrane and z>90'],
  'un « hide spheres, … » POSTÉRIEUR est soustrait du « show sphere, resn POPC+… »');
eq(H.styleHidesAfter(parsed.acts, sph2, 'sphere'), [],
  '…mais pas du « show spheres, upper_headgroups » qui vient APRÈS');
eq(H.styleHidesAfter(parsed.acts, sph1, 'stick'), ['name H* and headgroups'],
  'seul le même style compte : un hide de sticks n’enlève rien aux sphères');
eq(H.styleHidesAfter(parsed.acts, stk, 'stick'), ['name H* and headgroups'],
  'et « show sticks » est bien atteint par le « hide sticks » (pluriel normalisé)');
eq(H.styleHidesAfter(parsed.acts, parsed.acts.length - 1, 'sphere'), [],
  'après la dernière commande, plus rien à soustraire');

/* ── 5. L'expression NGL est confiée au PONT PyMOL → NGL ─────────────────── */
/* Le pont a son propre garde-fou (_pymol_selection_bridge_test.mjs, 65
   assertions) : il EXÉCUTE la traduction sur une structure simulée et vérifie
   que le vrai NGL accepte tout ce qu'elle produit. Ici on protège le BRANCHEMENT
   et le fait que `z>90` ne peut plus être lu comme un nom de résidu. */
gone('translateSelection', 'l’ancienne traduction naïve a disparu (elle laissait `z>90` ne rien sélectionner)');
has('const ngl = pymolSeleForStructure(structure, namedSeleMap(), text, (m) => warns.push(m), reservedOverrides().map);',
  'une expression passe par le pont, avec la structure ET les feuillets mesurés — la MÊME carte nom → clause pour chaque expansion (lignes, styles, hideFor)');
has('const ngl = geo || expandSelectionExpr(text);',
  'un feuillet MESURÉ (ou un nom de têtes corrigé) gagne sur la définition du script (`membrane and z>90`)');
has('pymolSeleToNgl = (raw, ctx = {})', 'le pont a un point d’entrée pur (testable sans rendu)');
has('if (!names.length) { warn(', 'une sélection qui ne trouve rien est SIGNALÉE, plus jamais silencieuse');
has('resnoRangesClause', 'les feuillets sont écrits en plages de résidus (compact)');

/* ── 6. La barre Selections : à GAUCHE, repliable, SANS ligne fantôme ────── */
has('const [selBarCollapsed, setSelBarCollapsed] = useState(', 'la barre Selections se replie (état dédié)');
has("localStorage.setItem('labViewerSelBarCollapsed'", '…et son repli est mémorisé');
has('className="absolute top-11 left-2 bottom-2 w-64 z-30', 'la barre Selections vit à GAUCHE du canvas');
gone("molBarOpen ? 'right-[21rem]'", '…elle ne se décale plus à droite du styling');
has('absolute top-2 right-2 bottom-2 w-96 z-40', 'la barre de styling garde la DROITE');
has('▶ Selections', 'un onglet ▶ la ramène quand elle est repliée');
has('title="Collapse the selections bar (▶ brings it back)', '…et un ◀ la replie');
// Chaque look a sa ligne : ceux des `select` ET ceux des expressions brutes.
has('{ ...s, raw: false }', 'les sélections nommées sont listées');
has(".filter((k) => k !== 'all' && !selections.some((s) => s.name === k))", '…et les looks créés sur une expression brute AUSSI');
has("s.raw ? '⌗ ' : ''", '…marqués comme expressions brutes (⌗)');
has('delete nx[s.name]; setSelStyles(nx);', 'chaque ligne porte un ✕ qui enlève vraiment le look');
has("{st.hidden ? '👁 Show' : '🙈 Hide'}", '…et le 🙈 Hide d’origine reste');
has('title={`Open the selections bar — ${selections.length} selection(s)', 'l’onglet annonce le nombre de sélections');

/* ── 7. Les deux causes du « tout en sphères » sont fermées ──────────────── */
has('const scriptHidesAll = (acts)', 'la règle « le script possède la scène » est une fonction pure');
has('const ownsScene = scriptHidesAll(acts);', '…et le parser d’une macro la consulte');
has('auto-show skipped (the script owns the scene)', '…pour NE PAS auto-afficher 70 sélections en sphères');
has('const exclusionOf = (style) => {', 'les « hide » ordonnés sont soustraits au rendu');
has('const sele = ex ? `(${seleBase}) and not (${ex})` : seleBase;', '…avec `and not (…)` sur l’expression NGL');
has("if (st.sphere) addWithOverrides('spacefill', 'sphere',", 'le style sphère passe son nom pour l’exclusion');
has("if (st.cartoon) addWithOverrides('cartoon', 'cartoon', { colorScheme, opacity }, false);", 'comme chaque autre style');
has('const ovs = [];', 'les `set … , <sélection>` d’une macro sont des propriétés d’ATOMES, gardées à part');
has('setSelOverrides(ovs);', '…et installées par le script qui vient de tourner');
has('const overrideSlicesFor = (beads) => {', 'le rendu DÉCOUPE une représentation par override de `set`');
has("ovs.push({ kind: 'sphereScale'", 'un `set sphere_scale, 0.6, headgroups` atteint enfin les billes dessinées ailleurs');
has("const hideFor = a.type === 'show'", 'un « show » retient les « hide » qui le suivent');
has('styleHidesAfter(acts, ai, st)', '…calculés par la fonction pure testée plus haut');

/* ── 8. §2 n’est plus gelé par une macro ─────────────────────────────────── */
has('const pymolOwnSigRef = useRef(null);', 'le viewer sait quelle signature de style appartient au script');
has('if (pymolOwnSigRef.current == null) pymolOwnSigRef.current = catSig;', 'un script peut écrire ses propres valeurs §2 sans être délogé');
has('else if (pymolOwnSigRef.current !== catSig) {', 'un changement ULTÉRIEUR, lui, n’est pas de lui');
has('takes the main structure back', '…et le journal de la macro explique à l’utilisateur que §2 reprend la main');
has("• §2 styling changed →", '…par une ligne de journal explicite');
has('◀ collapses it', 'l’aide de la macro dit où est la barre (à gauche, repliable)');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_pymol_selections_test.mjs — ${passed} assertions OK`);
