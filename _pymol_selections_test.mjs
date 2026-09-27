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
has('const ngl = geo || measured || expandSelectionExpr(text);',
  'un feuillet MESURÉ (ou un nom de têtes corrigé) gagne sur la définition du script (`membrane and z>90`)');
/* …ET LA MESURE GAGNE MÊME QUAND LA CARTE MÉMOÏSÉE N’A PAS ENCORE LES QUATRE
   CLAUSES : la carte se mémoïse sur les sélections du script et la clause des
   têtes, si bien qu'un appel fait dans le commit de la mesure la figeait sans
   elles — les quatre noms retombaient alors sur les définitions du script, et la
   rangée du feuillet se vidait de ses chaînes acyle (le rapport, rejoué par
   _viewer_membrane_chains_test.mjs). */
has('const measured = membraneSeleRef.current[key] || membraneSeleRef.current[String(key).toLowerCase()];',
  '…la clause MESURÉE est donc relue à la source, et pas seulement dans la carte');
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
has('delete nx[name];\n  setSelStyles(nx);', 'le ✕ d’une ligne enlève son look');
has('const removeSelectionRow = (name) => {', '…par un geste dédié (le rapport : « allow deleting selection window by hand »)');
has('setSelections((prev) => prev.filter((s) => s.name !== name));',
  '…qui retire AUSSI la sélection : une sélection nommée revenait sinon de `selections`, et le ✕ semblait sans effet');
has('onClick={() => removeSelectionRow(s.name)}', '…et la ligne de la barre appelle CE geste');
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

/* ── 9. LA SESSION SURVIT À UN RECHARGEMENT ────────────────────────────────
   La demande : « When you reload an experiment which contains the viewer, remember
   the last visualization settings and selection windows if it was created by
   “selections and pymol” (allow deleting selection window by hand). » Les réglages
   de style survivaient déjà (mémoire d’un type de molécule, palettes du ⚙) ; ce qui
   mourait avec le montage du viewer, c’est la SESSION d’un script : ses sélections,
   leurs looks, les `set` posés sur les atomes, la macro et le drapeau « le script
   tient la scène ». Elle est donc écrite dans UNE entrée et relue au montage —
   EXÉCUTÉ ici sur les fonctions livrées, avec un faux localStorage. */
const store = new Map();
const SESSION = new Function('localStorage', [
  // Les deux seules dépendances extérieures du bloc : la liste des presets de
  // matériau (un look de sélection en porte un) et un `localStorage` de test.
  "const MATERIAL_PRESET_KEYS = ['auto', 'matte', 'gloss', 'metallic', 'glass'];",
  sliceBetween("const PYMOL_SESSION_KEY = 'labViewerPymolSession';", '\n/* ---- Which leaflet is which', 'session'),
  'return { PYMOL_SESSION_KEY, loadPymolSession, savePymolSession, loadPymolSessionFor, pymolSessionKey, pymolSessionKeys, pymolSessionExperimentSlug, pymolSessionInstanceSlug };',
].join('\n'))({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
});

eq(SESSION.loadPymolSession().selections, [], 'aucune session au départ : le viewer démarre vierge');
SESSION.savePymolSession({
  selections: [{ name: 'water', expr: 'resn TIP3' }, { name: 'heads', expr: 'resn POPC' }],
  selStyles: { water: { sphere: true, colorMode: 'residue', mat: { spheres: { preset: 'gloss' } } } },
  selOverrides: [{ kind: 'sphereScale', value: 0.6, sel: 'heads' }],
  script: 'show spheres, water',
  active: true,
  autoShow: false,
  name: 'Membrane setup',
});
const back = SESSION.loadPymolSession();
eq(back.selections, [{ name: 'water', expr: 'resn TIP3' }, { name: 'heads', expr: 'resn POPC' }],
  'les FENÊTRES DE SÉLECTION du script reviennent au rechargement');
eq(back.selStyles.water, { sphere: true, colorMode: 'residue', mat: { spheres: { preset: 'gloss' } } },
  '…avec leurs looks (styles · coloration · matériau)');
eq(back.selOverrides, [{ kind: 'sphereScale', value: 0.6, sel: 'heads' }],
  '…et les `set` que la macro a posés sur les atomes');
eq([back.script, back.active, back.autoShow, back.name], ['show spheres, water', true, false, 'Membrane setup'],
  '…la macro elle-même, le drapeau « le script tient la scène », l’auto-affichage et le nom de la macro');

// Un localStorage bricolé (ou une version d’une autre build) ne peut rien inventer.
store.set(SESSION.PYMOL_SESSION_KEY, JSON.stringify({
  v: 1,
  selections: [{ name: 'x', expr: 'all' }, { name: '', expr: 'all' }, 'junk'],
  selStyles: { x: { sphere: true, colorMode: 42, transparency: 99, preset: 'LOL', mat: { spheres: { preset: 'inconnu' } } } },
  selOverrides: [{ kind: 'nope', value: 1, sel: 'x' }],
  active: 'yes',
}));
const dirty = SESSION.loadPymolSession();
eq(dirty.selections, [{ name: 'x', expr: 'all' }], 'une sélection vide ou d’un autre type est écartée');
eq(dirty.selStyles.x, { sphere: true, transparency: 99 },
  'un champ inconnu ou d’un mauvais type est écarté (aucun preset « LOL », aucun mode de coloration numérique)');
eq(dirty.selOverrides, [], '…et un `set` d’un genre inconnu aussi');
eq(dirty.active, false, '…« active » n’est vrai que s’il vaut VRAIMENT true');
store.set(SESSION.PYMOL_SESSION_KEY, JSON.stringify({ v: 99, selections: [{ name: 'x', expr: 'all' }] }));
eq(SESSION.loadPymolSession().selections, [], 'une entrée d’une autre version n’est pas relue du tout');

/* ══ §2bis. LA SESSION EST CELLE DE L'EXPÉRIENCE — SES INSTANCES LA PARTAGENT ═══
   Deux demandes, à deux sessions, et la seconde précise la première :

     · « Saving the selection window in each session was meant at each instance level,
       not general. » — plus de clé UNIQUE pour l'application : une condition ne
       voyait plus les fenêtres de sélection d'une autre ;
     · « keep the selection generated by “selections and pymol” window in all
       instances of one experiment. » — la mémoire est celle de l'EXPÉRIENCE (projet ·
       expérience), donc ses CONDITIONS (ses instances) la PARTAGENT : c'est la même
       expérience, la même question, les mêmes fenêtres.

   La clé d'instance reste LUE en second (les sessions déjà écrites restent lisibles),
   la générale en dernier. Tout est EXÉCUTÉ ici, sur les fonctions livrées. */
eq(SESSION.pymolSessionKey(null, null), 'labViewerPymolSession',
  'sans expérience ni instance connue, la clé GÉNÉRALE reste utilisée (rien n’est perdu)');
eq(SESSION.pymolSessionKey(null, { project: 'GEC', test: 'Mutant X', instance: '2026-01-05' }),
  'labViewerPymolSession::exp_GEC_Mutant_X',
  'l’expérience (projet · expérience) porte la clé — la CONDITION n’y entre plus');
eq(SESSION.pymolSessionKey(null, { project: 'GEC', test: 'Mutant X', instance: '2026-02-11' }),
  SESSION.pymolSessionKey(null, { project: 'GEC', test: 'Mutant X', instance: '2026-03-02' }),
  '…donc DEUX CONDITIONS d’une même expérience partagent la même session');
ok(SESSION.pymolSessionKey(null, { project: 'GEC', test: 'Mutant Y', instance: '2026-01-05' })
  !== SESSION.pymolSessionKey(null, { project: 'GEC', test: 'Mutant X', instance: '2026-01-05' }),
  '…et deux EXPÉRIENCES du même projet gardent chacune la sienne');
eq(SESSION.pymolSessionKey('exp_7', null), 'labViewerPymolSession::exp_7',
  'sans contexte Drive, l’instance que la page donne reste la clé (la mémoire d’avant)');
eq(SESSION.pymolSessionKeys(null, { project: 'GEC', test: 'Mutant X', instance: '2026-01-05' }),
  ['labViewerPymolSession::exp_GEC_Mutant_X', 'labViewerPymolSession::GEC_Mutant_X_2026-01-05', 'labViewerPymolSession'],
  'les clés LUES DANS L’ORDRE : l’expérience, puis l’instance (une session écrite par la version précédente), puis la générale');
eq(SESSION.pymolSessionKey('exp 7/2', null), 'labViewerPymolSession::exp_7_2',
  'les séparateurs sont neutralisés (aucune clé ne peut être détournée)');
// LA RELECTURE : la PREMIÈRE clé qui porte une session gagne.
SESSION.savePymolSession({ selections: [{ name: 'water', expr: 'resn TIP3' }] },
  SESSION.pymolSessionKeys(null, { project: 'GEC', test: 'Mutant X', instance: 'A' })[0]);
eq(SESSION.loadPymolSessionFor(SESSION.pymolSessionKeys(null, { project: 'GEC', test: 'Mutant X', instance: 'B' })).selections,
  [{ name: 'water', expr: 'resn TIP3' }],
  'une AUTRE CONDITION de la même expérience retrouve les fenêtres de sélection — c’était la demande');
eq(SESSION.loadPymolSessionFor(SESSION.pymolSessionKeys(null, { project: 'GEC', test: 'Mutant Y', instance: 'B' })).selections, [],
  '…mais une autre EXPÉRIENCE démarre vierge');
SESSION.savePymolSession({ selections: [{ name: 'heads', expr: 'resn POPC' }] }, SESSION.pymolSessionKey('exp_9', null));
eq(SESSION.loadPymolSessionFor(SESSION.pymolSessionKeys('exp_9', { project: 'GEC', test: 'Mutant Z', instance: 'C' })).selections,
  [{ name: 'heads', expr: 'resn POPC' }],
  'une session enregistrée sous l’ANCIENNE clé d’instance est lue en second — rien n’est perdu');

// Le câblage : relue au montage, réécrite à chaque geste, et dite dans le journal.
has("const PYMOL_SESSION_KEY = 'labViewerPymolSession';", 'la session a UNE clé de stockage — sa BASE');
has('const pymolSessionKeysRef = useRef(null);',
  'les clés de la session sont FIGÉES au montage (deux viewers montés ne se les volent pas)');
has('pymolSessionKeys(instanceKey, driveNaming)',
  '…et dérivées de l’EXPÉRIENCE que la page donne au viewer (projet · expérience)');
has('const pymolSessionKeyRef = useRef(null);', 'la clé où l’on ÉCRIT est la première de la liste');
has('const [pymolSession] = useState(() => loadPymolSessionFor(pymolSessionKeysRef.current));',
  'elle est relue au montage, dans la première clé qui porte une session');
has('instanceKey = null,', 'la page peut nommer son instance (les trois pages y passent l’expérience ouverte)');
has('const [selections, setSelections] = useState(() => pymolSession.selections);',
  '…et les fenêtres de sélection en partent');
has('const [selStyles, setSelStyles] = useState(() => pymolSession.selStyles);', '…leurs looks aussi');
has('const [pymolActive, setPymolActive] = useState(() => pymolSession.active);',
  '…le drapeau « le script tient la scène » compris (c’est LUI qui fait la scène telle qu’elle était)');
has('const [pymolScript, setPymolScript] = useState(() => pymolSession.script);', '…la macro est retrouvée dans son panneau');
has('  savePymolSession({', '…et la session est réécrite à chaque geste');
has('Session restored from your last', 'le journal du panneau dit que la session a été relue, et comment reprendre la main (§2 ou Clear)');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_pymol_selections_test.mjs — ${passed} assertions OK`);
