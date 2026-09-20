/* =========================================================================
   _viewer_style_controls_test.mjs — les RÉGLAGES DE STYLE du viewer 3D (NMR /
   MD / Docking) portés par les six menus de « 2 · Molecular Styling ».

   Ce qui doit rester vrai :

     • chaque menu A–F porte le RAYON DES SPHÈRES et le RAYON DES LIAISONS
       (deux multiplicateurs, 1.00 = la taille NGL d'origine du style), la
       COULEUR DES ATOMES (couleurs d'éléments, ou une couleur unie) et la
       COULEUR DE SURFACE (défaut · Custom… · ESP) — les six menus, lipides
       compris, alors que seuls trois d'entre eux avaient une couleur de surface ;
     • les mentions « Kept from the previous … menu » ont DISPARU des listes
       déroulantes (la fonction est conservée : plus aucun optgroup) et chaque
       menu nomme le style LICORICE ;
     • NGL 2.4 ne connaît AUCUNE représentation `stick` : les anciens
       add('stick', …) ne dessinaient rien. « Sticks » = licorice, partout ;
     • le menu B (acides nucléiques) a son PROPRE panneau de couleurs —
       phosphate backbone · pentose rings · bases — à la place du panneau
       « 2° structure » (une notion de protéine) ; ses trois pastilles passent
       par un schéma NGL maison (lab-nucleic-groups) qui lit un store vivant ;
     • la liste « Bases » gagne « Stylized rings (coloured inside) » : les rungs
       remplis sont colorés par l'IDENTITÉ de la base (A · C · G · T · U) avec un
       fin anneau de sticks par-dessus ;
     • « ⚙️ Setup » (menu 1 · General) enregistre / recharge / exporte / importe
       TOUT le réglage de visualisation sous un nom (localStorage) ;
     • le fond de la scène se règle dans « 3 · Toolbar → 🌫 Scene »
       (« 🎨 Background »), et il est persistant.

   Le viewer est un .jsx : il ne s'importe pas sous Node. Les règles sont donc
   vérifiées SUR LA SOURCE — et, pour les helpers purs (catRadii, nucleicGroupOf,
   baseIdentityColorOf, les setups), la fonction est EXTRAITE du fichier puis
   EXÉCUTÉE, comme dans _md_axis_cfg_test.mjs.
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

// CRLF → LF pour écrire les aiguilles multi-lignes naturellement.
const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
// Le CODE seul (commentaires retirés) : les commentaires du viewer CITENT
// l'ancien add('stick', …) pour expliquer justement pourquoi il a disparu.
const CODE = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ══ 1. LES SIX MENUS PORTENT LES MÊMES CONTRÔLES ═════════════════════════ */
const CATS = ['protein', 'nucleic', 'lipid', 'sugar', 'organic', 'other'];
has('const renderCatRadii = (cat) => {', 'un SEUL rendu des deux curseurs de rayon');
has('const renderAtomColour = (cat) => {', 'un SEUL rendu de la couleur des atomes');
has('const renderSurfaceColour = (cat, label) => {', 'un SEUL rendu de la couleur de surface');
has('const resetCatLook = (cat) => setCatStyles((prev) => ({', 'un ↺ qui remet rayons + couleurs par défaut');
CATS.forEach((c) => {
  has(`{renderCatRadii('${c}')}`, `[${c}] Sphere radius + Bond radius`);
  has(`{renderAtomColour('${c}')}`, `[${c}] Atom colour`);
  has(`{renderSurfaceColour('${c}',`, `[${c}] Surface colour`);
  has(`onClick={() => resetCatLook('${c}')}`, `[${c}] ↺ Reset radii & colours`);
});
has("{renderSurfaceOpacity('lipid')}", '[C] les lipides ont enfin une surface (donc une opacité)');
has('<option value="custom">Custom colour…</option>', '[couleurs] « Custom… » dans les couleurs de surface ET d’atomes');
has('<option value="esp">Electrostatic Potential (ESP)</option>', '[couleurs] ESP conservé');
has('const [showNucleicColoursPanel, setShowNucleicColoursPanel] = useState(false);',
  '[B] un panneau de couleurs PROPRE au menu des acides nucléiques');
has("const open = cat === 'nucleic' ? showNucleicColoursPanel : showColoursPanel;",
  'le bouton 🎨 ouvre le panneau du menu (A → 2° structure, B → phosphate / pentose / bases)');

/* ══ 2. LES RAYONS : multiplicateurs lus par le rendu ET par le panneau ═══ */
const numOf = (name) => {
  const m = new RegExp(`const ${name} = ([0-9.]+);`).exec(VIEW);
  ok(!!m, `constante ${name} introuvable`);
  return Number(m[1]);
};
const RADIUS_MIN = numOf('RADIUS_MIN');
const RADIUS_MAX = numOf('RADIUS_MAX');
ok(RADIUS_MIN > 0 && RADIUS_MIN < 1, 'le rayon minimal laisse rétrécir un style');
ok(RADIUS_MAX > 1, 'le rayon maximal laisse grossir un style');
has('const BALLSTICK_BOND_RADIUS = 0.15;', '0,15 Å = le radiusSize NGL de ball+stick');
has('const LICORICE_BOND_RADIUS = 0.25;', '0,25 Å = l’épaisseur de bâton du viewer (licorice)');
has('const BASE_BOND_RADIUS = 0.3;', '0,3 Å = le radiusSize NGL des rungs `base`');
has("const stickGeom = (cat, naturalBond) => ({ radiusSize: naturalBond * catRadii(cs[cat]).bond });",
  'le rayon des bâtons part dans NGL en radiusSize (Å), multiplié');
has("const lineGeom = (cat) => ({ linewidth: Math.max(1, Math.round(2 * catRadii(cs[cat]).bond)) });",
  'un style « Lines » suit le rayon des bâtons via linewidth');
has('radiusScale: g.sphere, scale: 0.6', 'spacefill : rayon des sphères = radiusScale (× le rayon de van der Waals)');
has('aspectRatio: 1.1 * g.sphere', 'ball+stick : rayon des sphères = aspectRatio');
has('const sideParams = sidechainStyle === \'ball+stick\'', 'les chaînes latérales suivent le menu A');

/* ══ 3. LES COULEURS D'ATOMES / DE SURFACE PARTENT BIEN DANS NGL ══════════ */
has('const flatHex = (v) => (Number.isFinite(v) ? v : null);', 'une couleur unie est un entier hexadécimal');
has("return hex != null ? { color: hex } : { colorScheme: 'element' };",
  'atomCol : Custom… → `color` (hex), sinon les couleurs d’éléments');
has("return hex != null ? { color: hex } : { color: 'residueindex' };",
  'backboneCol : l’arc-en-ciel par résidu reste le défaut des squelettes');
has('const DEFAULT_ATOM_COLORS = {', 'une couleur unie proposée par catégorie');
has('const DEFAULT_SURFACE_COLOR = 0xcbd5e1;', 'une couleur de surface proposée pour « Custom… »');
has("const customHex = m.surfaceColor === 'custom' ? flatHex(m.surfaceColorHex) : null;",
  'addSurface lit la couleur du menu (défaut / custom / ESP)');
has("if (r && m.surfaceColor === 'esp') {", 'les surfaces ESP sont toujours enregistrées pour ⚡ Range');

/* ══ 4. LES MENTIONS « Kept from the previous … menu » ONT DISPARU ════════ */
gone('Kept from the previous', 'plus aucune mention « Kept from the previous … menu »');
gone('<optgroup', 'plus aucun optgroup dans les listes déroulantes du viewer');
has('<option value="licorice">Licorice (sticks)</option>', 'le style Licorice est proposé (squelettes, chaînes latérales, têtes de lipides)');
has('<option value="sticks">Licorice (sticks)</option>', '« Sticks » nomme licorice (sucres, ligands, chaînes acyle, bases)');
// Le code SEUL (sans les commentaires, qui citent l'ancien appel) ne doit plus
// jamais demander à NGL une représentation `stick` : elle n'existe pas, l'appel
// était avalé par le try/catch et RIEN ne se dessinait.
ok(!CODE.includes("add('stick'"), 'plus aucun appel à une représentation `stick` (NGL n’en a pas)');
ok(!CODE.includes("addRepresentation('stick'"), '…y compris dans la barre Molecules');
has("else if (bases === 'sticks') add('licorice', { sele: 'nucleic and sidechain',", '[B] les bases en « Sticks » sont licorice');
has("else if (st === 'sticks') add('licorice', { sele: sugarSele,", '[D] les sucres en « Sticks » sont licorice');
has("else if (st === 'sticks') add('licorice', { sele: organicSele,", '[E] les ligands en « Sticks » sont licorice');
has("else if (st.style === 'sticks') add('licorice', { multipleBond: true, radiusSize: LICORICE_BOND_RADIUS });",
  'la barre Molecules aussi (style par molécule)');

/* ══ 5. LE MENU B RECOLORE phosphate / pentose / bases ════════════════════ */
has("NGL.ColormakerRegistry.addScheme('lab-nucleic-groups'", 'un schéma NGL maison pour les trois groupes');
has('const nucleicColorStore = {', 'un store vivant (une pastille ne reconstruit rien)');
has('if (g === \'phosphate\') return nucleicColorStore.phosphate;', 'phosphate → sa couleur');
has('if (g === \'pentose\') return nucleicColorStore.pentose;', 'pentose → sa couleur');
has('return nucleicColorStore.base;', 'tout le reste (bases) → sa couleur');
has('registerNucleicScheme(NGL);', 'le schéma est enregistré avec la scène');
has('registerBaseIdentityScheme(NGL);', 'le schéma des bases stylisées aussi');
has("NGL.ColormakerRegistry.addScheme('lab-base-identity'", 'un schéma par identité de base');
has('const [showNucleicColoursPanel, setShowNucleicColoursPanel] = useState(false);', 'l’état du panneau');
has('Colour by chemical group', 'l’interrupteur « Colour by chemical group »');
has('value={numToHex(catStyles.nucleic.phosphateColor)}', 'la pastille du phosphate lit catStyles.nucleic');
has('value={numToHex(catStyles.nucleic.pentoseColor)}', 'la pastille du pentose lit catStyles.nucleic');
has('value={numToHex(catStyles.nucleic.baseColor)}', 'la pastille des bases lit catStyles.nucleic');
has('Phosphate backbone', 'la pastille du squelette phosphate');
has('Pentose ring', 'la pastille du cycle pentose');
has('Bases', 'la pastille des bases');
has('onClick={resetNucleicColours}', '↺ Reset colours');
has("const setNucleicColour = (key, hex) => setCatStyles((prev) => ({", 'une pastille allume le mode groupe (jamais invisible)');
has('phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,', 'les trois couleurs vivent dans catStyles.nucleic (donc persistées + setup)');
has('groupColour: false,', 'le mode groupe est OFF par défaut (l’aspect historique est conservé)');
has("const nucleicGroupsOn = () => !!(cs.nucleic && cs.nucleic.groupColour && nucleicSchemeKey);",
  'le rendu suit l’interrupteur');
has("const bbCol = nucleicGroupsOn() ? stickCol : backboneCol('nucleic');",
  'squelette : schéma des groupes, ou arc-en-ciel par résidu');
has("const baseSlabCol = nucleicGroupsOn() ? { color: nucleicSchemeKey } : { colorScheme: 'resname' };",
  'rungs : couleur des bases du panneau, ou palette resname de NGL');

/* ══ 6. « Stylized rings » : les bases colorées DANS l’anneau ══════════════ */
has('<option value="rings">Stylized rings (coloured inside)</option>', 'la nouvelle représentation stylisée des bases');
has("else if (bases === 'rings') {", '…et son rendu');
has("add('base', { sele: sels.nucleic, ...baseIdentityCol(), ...stickGeom('nucleic', BASE_BOND_RADIUS) });",
  'l’INTÉRIEUR de l’anneau est rempli, couleur par base');
has("add('licorice', { sele: 'nucleic and sidechain', ...baseIdentityCol(), radiusSize: LICORICE_BOND_RADIUS * 0.6 * g.bond });",
  'un fin anneau de bâtons dessine le pourtour');
has("const baseIdentityCol = () => (baseIdentitySchemeKey ? { color: baseIdentitySchemeKey } : { colorScheme: 'resname' });",
  'repli sur la palette resname si le schéma n’a pas pu être enregistré');
has('const BASE_IDENTITY_COLORS = { A: 0x22c55e, C: 0x3b82f6, G: 0xf59e0b, T: 0xec4899, U: 0xef4444 };',
  'la palette A · C · G · T · U documentée');

/* ══ 7. ⚙️ SETUP : ENREGISTRER / RECHARGER TOUTE LA VISUALISATION ═════════ */
has("const VIEWER_SETUP_KEY = 'labViewerSetups';", 'une clé localStorage dédiée aux setups nommés');
has('const VIEWER_SETUP_VERSION = 1;', 'une version, pour qu’un vieux fichier ne casse rien');
has('const loadViewerSetups = () => {', 'lecture des setups (seuls les vrais sont gardés)');
has('const saveViewerSetups = (map) => {', 'écriture des setups');
has('const [viewerSetups, setViewerSetups] = useState(() => loadViewerSetups());', 'l’état des setups');
has('const captureViewerSetup = () => ({', 'capture de TOUT le réglage');
has('const applyViewerSetup = (s) => {', 'application d’un setup');
has('catStyles,', 'le setup contient les six menus (styles, rayons, couleurs)');
has('catLabels,', '…les étiquettes 3D par menu');
has('fog: fogEnabled,', '…le brouillard');
has('shadows: { on: shadowOn, darkness: shadowDarkness, az: shadowAz, el: shadowEl },', '…les ombres et leur lumière');
has('clip: { on: clipOn, near: clipNear, far: clipFar, dist: clipDist },', '…le plan de coupe');
has('background: bgColor,', '…le fond de la scène');
has('large: { style: largeStyle, water: showLargeWater },', '…le rendu léger des grands systèmes');
has('const nextStyles = cloneCatStyles();', 'application : on repart des défauts puis on fusionne');
has('saveCatLabels(nextLabels);', 'les étiquettes restaurées sont persistées');
has('const saveCurrentSetup = () => {', '💾 Save');
has('const loadSetup = (name) => {', '📂 Load');
has('const deleteSetup = (name) => {', '🗑 Delete');
has('const exportSetup = (name) => {', '⬇ Export (.json)');
has('const importSetupFile = (file) => {', '⬆ Import (.json)');
has('a.download = `viewer-setup-${name.replace(/[^\\w.-]+/g, \'_\')}.json`;', 'le fichier exporté est nommé d’après le setup');
has('if (!s || typeof s !== \'object\' || !s.catStyles) throw new Error(\'not a viewer setup\');',
  'un fichier étranger est refusé proprement');
has('📂 Load…', 'la liste déroulante des setups enregistrés');
has('⬆ Import', 'le bouton d’import');
has('⚙️ Setup', 'le bouton ⚙️ Setup');
const iSec1 = VIEW.indexOf('<VSection title="1 · General"');
ok(iSec1 > 0 && VIEW.indexOf('⚙️ Setup', iSec1) > 0,
  'le bloc Setup vit dans « 1 · General » (la ligne qui charge / nettoie)');

/* ══ 8. FOND DE LA SCÈNE DANS §3 SCENE ════════════════════════════════════ */
has("const BG_DEFAULT = '#f8fafc';", 'le fond par défaut est nommé une fois');
has('🎨 Background', 'la ligne « 🎨 Background » du groupe Scene');
has('aria-label="Background colour"', 'un sélecteur de couleur accessible');
has('onChange={(e) => setBgColor(e.target.value)}', 'il écrit l’état du fond (le même que le panneau PyMOL)');
has('onClick={() => setBgColor(BG_DEFAULT)}', '↺ revient au fond par défaut');
has("try { localStorage.setItem('labViewerBg', bgColor); } catch { /* ignore */ }",
  'le fond est persistant (comme Fog / Shadows / Clipping)');
has('const v = localStorage.getItem(\'labViewerBg\');', '…et il est relu au chargement');
has('try { stage.setParameters({ backgroundColor: bgColor }); } catch {}', 'il est poussé à la scène NGL vivante');
// Les indices sont pris APRÈS le titre de §3 : la documentation d'en-tête du
// fichier cite elle aussi « 🎨 Background », à un tout autre endroit.
const iSec3 = VIEW.indexOf('<VSection title="3 · Toolbar"');
const iBg = VIEW.indexOf('🎨 Background', iSec3);
const iShadow = VIEW.indexOf('◐ Shadows', iSec3);
ok(iBg > iSec3, 'le réglage est bien DANS la rangée §3 (groupe 🌫 Scene)');
ok(iBg > 0 && iShadow > 0 && iBg < iShadow, '…à côté du brouillard, en tête du groupe Scene');


/* ══ 9. LES HELPERS PURS, EXTRAITS DU FICHIER ET EXÉCUTÉS ═════════════════ */
const sliceFn = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  ok(start >= 0, `fonction ${name} introuvable`);
  const arrow = src.indexOf('=>', start);
  const offset = src.slice(arrow + 2).search(/\S/);
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
    throw new Error(`${name} : corps non terminé`);
  }
  const end = src.indexOf(';\n', body);
  return src.slice(start, end + 1);
};
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  ok(start >= 0, `constante ${name} introuvable`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`${name} : non terminé`);
};
const sliceRaw = (name) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(VIEW);
  ok(!!m, `constante ${name} introuvable`);
  return m[1];
};
// localStorage n'existe pas pour un fichier Node : on en pose un faux, comme le
// navigateur, pour ÉPROUVER la lecture / écriture des setups.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
const sandbox = [
  `const RADIUS_MIN = ${RADIUS_MIN}; const RADIUS_MAX = ${RADIUS_MAX};`,
  `const DEFAULT_SURFACE_COLOR = ${sliceRaw('DEFAULT_SURFACE_COLOR')};`,
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  sliceFn(VIEW, 'catLook'),
  sliceObject(VIEW, 'DEFAULT_CAT_STYLES'),
  sliceFn(VIEW, 'catRadii'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  sliceFn(VIEW, 'baseIdentityColorOf'),
  "const VIEWER_SETUP_KEY = 'labViewerSetups';",
  sliceFn(VIEW, 'loadViewerSetups'),
  sliceFn(VIEW, 'saveViewerSetups'),
  'return { catRadii, nucleicGroupOf, baseIdentityColorOf, DEFAULT_CAT_STYLES, DEFAULT_ATOM_COLORS, BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, loadViewerSetups, saveViewerSetups };',
].join('\n');
const H = new Function(sandbox)();

/* ── 9a. Rayons : neutre à 1.00, bornés, robustes ═─────────────────────── */
eq(H.catRadii({}), { sphere: 1, bond: 1 }, 'sans réglage, un menu garde exactement ses tailles NGL');
eq(H.catRadii({ sphereRadius: 1.5, bondRadius: 0.5 }), { sphere: 1.5, bond: 0.5 }, 'les multiplicateurs sont lus');
eq(H.catRadii({ sphereRadius: 99, bondRadius: -3 }), { sphere: RADIUS_MAX, bond: 1 },
  'une valeur absurde est bornée (99 → max, −3 → défaut)');
eq(H.catRadii({ sphereRadius: 'x', bondRadius: null }), { sphere: 1, bond: 1 },
  'une valeur non numérique retombe sur le défaut');

/* ── 9b. Classification des atomes d'un nucléotide ══════════════════════ */
const PHOSPHATE = ['P', 'OP1', 'OP2', 'OP3', 'O1P', 'O2P', 'O3P', 'HOP', 'HO1P', 'ho2p'];
PHOSPHATE.forEach((n) => eq(H.nucleicGroupOf(n), 'phosphate', `${n} = le groupe phosphate`));
const PENTOSE = ["C1'", "C2'", "C3'", "C4'", "C5'", "O2'", "O3'", "O4'", "O5'", "H1'", "H5''", "HO2'", 'C1*', 'O4*'];
PENTOSE.forEach((n) => eq(H.nucleicGroupOf(n), 'pentose', `${n} = le cycle pentose (nom primé)`));
const BASES = ['N1', 'N2', 'N3', 'N4', 'N6', 'N7', 'N9', 'C2', 'C4', 'C5', 'C6', 'C8', 'O2', 'O4', 'O6', 'C5M', 'CH3', 'H5T'];
BASES.forEach((n) => eq(H.nucleicGroupOf(n), 'base', `${n} = la base`));
eq(H.nucleicGroupOf(''), 'base', 'un nom vide ne fait pas planter la coloration');
eq(H.nucleicGroupOf(undefined), 'base', 'un atome sans nom non plus');

/* ── 9c. Couleur par identité de base ═══════════════════════════════════ */
eq(H.baseIdentityColorOf('A'), H.BASE_IDENTITY_COLORS.A, 'A → sa couleur');
eq(H.baseIdentityColorOf('DA'), H.BASE_IDENTITY_COLORS.A, 'DA (ADN) → la couleur de A');
eq(H.baseIdentityColorOf('RA'), H.BASE_IDENTITY_COLORS.A, 'RA (ARN) → la couleur de A');
eq(H.baseIdentityColorOf('DT'), H.BASE_IDENTITY_COLORS.T, 'DT → la couleur de T');
eq(H.baseIdentityColorOf('U'), H.BASE_IDENTITY_COLORS.U, 'U → sa couleur');
eq(H.baseIdentityColorOf('DG'), H.BASE_IDENTITY_COLORS.G, 'DG → la couleur de G');
eq(H.baseIdentityColorOf('CYT'), H.BASE_IDENTITY_COLORS.C, 'CYT → la couleur de C');
ok(!Object.values(H.BASE_IDENTITY_COLORS).includes(H.baseIdentityColorOf('HOH')),
  'une molécule qui n’est pas une base garde un gris neutre');
eq(H.baseIdentityColorOf(undefined), H.baseIdentityColorOf('HOH'), '…même sans nom de résidu');

/* ── 9d. Les défauts des six menus ═════════════════════════════════════ */
CATS.forEach((c) => {
  const d = H.DEFAULT_CAT_STYLES[c];
  ok(!!d, `le menu ${c} a des défauts`);
  ok(d.sphereRadius === 1 && d.bondRadius === 1, `[${c}] les rayons démarrent au neutre (1.00)`);
  ok(d.atomColor === 'default' && d.surfaceColor === 'default', `[${c}] les couleurs démarrent sur « défaut »`);
  eq(d.atomColorHex, H.DEFAULT_ATOM_COLORS[c], `[${c}] la couleur unie proposée est celle de la catégorie`);
  ok(d.surfaceOpacity > 0 && d.surfaceOpacity <= 1, `[${c}] une opacité de surface valide`);
});
eq(H.DEFAULT_CAT_STYLES.nucleic.groupColour, false, 'la coloration par groupe est OFF par défaut');
eq(H.DEFAULT_CAT_STYLES.nucleic.phosphateColor, H.DEFAULT_NUCLEIC_COLORS.phosphate, 'couleur phosphate par défaut');
eq(H.DEFAULT_CAT_STYLES.nucleic.pentoseColor, H.DEFAULT_NUCLEIC_COLORS.pentose, 'couleur pentose par défaut');
eq(H.DEFAULT_CAT_STYLES.nucleic.baseColor, H.DEFAULT_NUCLEIC_COLORS.base, 'couleur bases par défaut');
eq(H.DEFAULT_CAT_STYLES.protein.backbone, 'cartoon', 'le style par défaut du squelette protéique ne change pas');
eq(H.DEFAULT_CAT_STYLES.nucleic.bases, 'slab', 'les bases restent des rungs remplis par défaut');
eq(H.DEFAULT_CAT_STYLES.sugar.style, 'ball+stick', 'les sucres gardent leur style par défaut');
eq(H.DEFAULT_CAT_STYLES.other.water, 'hidden', 'l’eau reste cachée par défaut');

/* ── 9e. Les setups : aller-retour localStorage ════════════════════════ */
eq(H.loadViewerSetups(), {}, 'aucun setup au départ');
H.saveViewerSetups({ Fibrine: { v: 1, catStyles: { protein: { backbone: 'licorice' } } } });
eq(Object.keys(H.loadViewerSetups()), ['Fibrine'], 'un setup nommé se relit');
eq(H.loadViewerSetups().Fibrine.catStyles.protein.backbone, 'licorice', '…avec son contenu');
eq(H.loadViewerSetups().Fibrine.v, 1, '…et sa version');
// Un contenu étranger est ignoré au lieu de casser le panneau.
store.set('labViewerSetups', JSON.stringify({ bon: { catStyles: {} }, mauvais: { autre: 1 }, texte: 'x', liste: [1, 2] }));
eq(Object.keys(H.loadViewerSetups()), ['bon'], 'seules les entrées qui ressemblent à un setup sont gardées');
store.set('labViewerSetups', 'pas du json');
eq(H.loadViewerSetups(), {}, 'un localStorage corrompu ne fait pas planter le viewer');

/* ── Bilan ═════════════════════════════════════════════════════════════ */
console.log(`_viewer_style_controls_test.mjs — ${passed} assertions OK`);






