/* =========================================================================
   _viewer_style_controls_test.mjs — les RÉGLAGES DE STYLE du viewer 3D (NMR /
   MD / Docking) portés par les RANGÉES de la barre « Molecules · styling ».

   Ce qui doit rester vrai :

     • chaque RANGÉE d'une molécule (une par partie : General · Backbone · Side
       chains, Bases · Ribose, têtes · glycérol · chaînes acyle…) porte le RAYON
       DES SPHÈRES (R◯) et le RAYON DES LIAISONS (R—) — deux multiplicateurs,
       1.00 = la taille NGL d'origine du style — sa TRANSPARENCE, sa COULEUR
       (« Color by » : élément · chaîne · résidu · 2° structure · type de lipide ou
       de sucre · base · ESP · dégradé · arc-en-ciel) et son MATÉRIAU (🎛) : elles
       sont TOUTES décrites par le MÊME tableau (SECTION_SUBSECTIONS) et rendues
       par la MÊME fonction (renderSectionRow), donc un contrôle ne peut plus
       manquer dans l'une et exister dans l'autre ;
     • les six menus de catégorie de l'ancien « 2 · Molecular Styling » ont DISPARU
       au profit de ces rangées : les mentions « Kept from the previous … menu » et
       leurs optgroups n'existent plus nulle part, et chaque rangée nomme le style
       LICORICE ;
     • NGL 2.4 ne connaît AUCUNE représentation `stick` : les anciens
       add('stick', …) ne dessinaient rien. Les bâtons sont licorice partout ;
     • les vieux panneaux 🎨 par catégorie (phosphate · pentose · bases, tête ·
       squelette · chaînes) ont disparu avec les menus : c'est le « Color by » de
       la rangée qui parle pour la partie qu'elle dessine — l'identité de la base
       (lab-base-type), le type de lipide (lab-lipid-class) ou une couleur unie.
       Les schémas maison restent TOUS enregistrés par registerColorScheme, car
       ColormakerRegistry.addScheme veut la DÉFINITION d'abord et le LIBELLÉ
       ensuite : l'ancien ordre inversé donnait une classe cassée dont l'id
       faisait disparaître la molécule (voir _viewer_scheme_test.mjs, qui exécute
       vraiment les schémas avec NGL) ;
     • le style « Stylized rings (filled plates) » reste : la rangée des bases
       remplit les anneaux et les colore par l'IDENTITÉ de la base (A · C · G · T ·
       U), avec un fin anneau de bâtons par-dessus ;
     • « ⚙️ Setup » (menu 1 · General) enregistre / recharge / exporte / importe
       TOUT le réglage de visualisation sous un nom (localStorage) ;
     • le fond de la scène se règle dans « 2 · Toolbar → 🌫 Scene »
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

/* ══ 1. LES RANGÉES DE LA BARRE PORTENT TOUTES LES MÊMES CONTRÔLES ════════ */
// PART 4 : les six menus de catégorie (A · Proteins … F · Others) ont été
// remplacés par un ESPACE par molécule dans la barre « Molecules · styling ».
// Chaque molécule y reçoit les rangées de son TYPE (une par partie : General ·
// Backbone · Side chains, Bases · Ribose, Phospholipid headgroups · Glycerol ·
// Acyl chains…), TOUTES décrites par le MÊME tableau et rendues par la MÊME
// fonction : un contrôle ne peut donc pas exister dans une rangée et manquer dans
// une autre — ce que les six menus ne tenaient que par des appels répétés.
has('const SECTION_SUBSECTIONS = {', 'UNE description des rangées de chaque type de molécule');
has('const subsectionsOf = (kind) => SECTION_SUBSECTIONS[kind] || SECTION_SUBSECTIONS.ligand;',
  'les rangées d’un type de molécule');
has('const subsectionSpec = (kind, sub) => subsectionsOf(kind).find((s) => s.sub === sub) || subsectionsOf(kind)[0];',
  'la spécification d’une rangée (styles · colorations · défaut)');
const KINDS = ['protein', 'nucleic', 'lipid', 'sugar', 'ligand', 'water', 'ion'];
KINDS.forEach((k) => ok(new RegExp(`^  ${k}: \\[`, 'm').test(VIEW), `[${k}] les rangées de ce type sont décrites`));
has('const renderSectionRow = (sec, sub) => {', '…et UNE seule fonction les rend');
has('{shown && subsectionsOf(kind).map((s) => renderSectionRow(sec, s.sub))}',
  '[barre] chaque rangée décrite est rendue, et elle seule');
// Les contrôles communs de toute rangée : la transparence, les DEUX rayons (R◯ /
// R—) et le matériau — le même JSX pour toutes, il n'y a plus rien à répéter.
has('title="Transparency regulator of THIS row: 0 % = opaque, 100 % = invisible (NGL opacity)"',
  'la transparence de la rangée');
has('title="Sphere radius — a multiplier of the style\'s own atom size (1.00 = untouched)"',
  'le rayon des sphères (R◯)');
has('title="Bond radius — a multiplier of the style\'s own stick thickness AND of a Tube\'s own tube radius (1.00 = untouched)"',
  'le rayon des bâtons (R—) — qui règle aussi le rayon du TUBE');
has('title={`Material of ${uid} — roughness (r) and metalness (m), NGL\'s own material parameters`}',
  'le matériau appartient à la rangée');
has('uid = `« ${spec.label} » of ${sec.name}`', '…et l’uid nomme LA rangée (sa partie + sa molécule)');
has('{MATERIAL_PRESET_KEYS.map((p) => <option key={p} value={p}>{p}</option>)}',
  '…et ses presets sont UNE seule liste');
has('onReset: () => resetSectionRowLook(sec.id, kind, sub),', 'le ↺ d’UNE rangée');
has('title={`${sec.name} — ${MOL_KIND_LABELS[kind]}', 'un espace par molécule, avec son type écrit');
has('<option value="custom">Custom colour…</option>', '[couleurs] « Custom… » dans les couleurs de surface ET d’atomes');
has('<option value="esp">Electrostatic Potential (ESP)</option>', '[couleurs] ESP conservé');
has('const [showNucleicColoursPanel, setShowNucleicColoursPanel] = useState(false);',
  '[B] un panneau de couleurs PROPRE au menu des acides nucléiques');
has('const [showLipidColoursPanel, setShowLipidColoursPanel] = useState(false);',
  '[C] …et un troisième, propre au menu des lipides');
has("const open = cat === 'nucleic' ? showNucleicColoursPanel",
  'le bouton 🎨 ouvre le panneau du menu (A → 2° structure, B → phosphate / pentose / bases, C → les trois parts d’un lipide)');
has(": cat === 'lipid' ? showLipidColoursPanel", '…en choisissant le panneau du menu qui le porte');

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
// Les chaînes latérales sont une RANGÉE de la protéine (licorice par défaut), et le
// rendeur les recolle au squelette avec la même règle qu'autrefois (sectionRowSele).
has("{ sub: 'sidechain', label: 'Side chains', styles: STYLES.sidechains, colors: COLORS.proteinSide, def: { style: 'licorice', colorBy: 'element' }, sele: 'sidechain' },",
  'la rangée « Side chains » (licorice, couleur par élément)');
has('return opts.anchorSideChains ? `${base} and (sidechain or .CA)` : `${base} and sidechain`;',
  '…et ses atomes sont recollés au squelette (CB–CA) quand les deux rangées sont en atomes');

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
// NGL 2.4 n'a AUCUNE représentation `stick` : le vocabulaire des styles est donc
// celui de NGL — « licorice » — et c'est UNE table de libellés qui le nomme.
has("licorice: 'Liquorice',", 'le style des bâtons (licorice) est proposé par toutes les rangées qui le peuvent');
has("base: 'Slabs',", '…et le style `base` de NGL garde son nom (Slabs)');
ok(CODE.includes("'licorice'"), 'le rendu ne demande jamais autre chose que licorice pour des bâtons');
// Le code SEUL (sans les commentaires, qui citent l'ancien appel) ne doit plus
// jamais demander à NGL une représentation `stick` : elle n'existe pas, l'appel
// était avalé par le try/catch et RIEN ne se dessinait.
ok(!CODE.includes("add('stick'"), 'plus aucun appel à une représentation `stick` (NGL n’en a pas)');
ok(!CODE.includes("addRepresentation('stick'"), '…y compris dans la barre Molecules');
has("else if (bases === 'sticks') add('licorice', { sele: 'nucleic and sidechain',", '[B] les bases en « Sticks » sont licorice');
has("else if (st === 'sticks') add('licorice', { sele: sugarSele,", '[D] les sucres en « Sticks » sont licorice');
has("else if (st === 'sticks') add('licorice', { sele: organicSele,", '[E] les ligands en « Sticks » sont licorice');
has("else if (style === 'sticks') reps.push(comp.addRepresentation('licorice', { ...opts, multipleBond: true, radiusSize: LICORICE_BOND_RADIUS }));",
  'la barre Molecules aussi : le « Sticks » d’une molécule chargée EST licorice');

/* ══ 5. LE MENU B RECOLORE phosphate / pentose / bases ════════════════════ */
// ⚠️ ColormakerRegistry.addScheme(DÉFINITION, LIBELLÉ) : la définition D'ABORD.
// L'ancien ordre inversé enregistrait une classe cassée (le libellé était
// `.call()`é à l'instanciation) dont l'id faisait échouer toute représentation
// qui s'en servait → « Colour by chemical group » vidait la molécule et
// « Stylized rings » n'affichait rien. Un SEUL enregistreur, qui vérifie en plus
// que le schéma s'instancie vraiment avant de donner son id.
has('const registerColorScheme = (NGL, label, define) => {', 'un SEUL enregistreur de schémas maison');
has('const key = NGL.ColormakerRegistry.addScheme(define, label);', 'définition d’ABORD, libellé ensuite (l’ordre NGL)');
has('const probe = NGL.ColormakerRegistry.getScheme({ scheme: key });', 'le schéma est instancié une fois avant d’être donné');
has('return probe && typeof probe.atomColor === \'function\' ? key : null;', 'un schéma inutilisable → id null (repli NGL)');
has("registerColorScheme(NGL, 'lab-sstruc'", '…pour les couleurs de structure secondaire');
has("registerColorScheme(NGL, 'lab-nucleic-groups'", 'un schéma NGL maison pour les trois groupes');
gone("addScheme('lab-", 'plus aucun addScheme(libellé, définition) — l’ordre inversé était le bug');
has('const nucleicColorStore = {', 'un store vivant (une pastille ne reconstruit rien)');
has('if (g === \'phosphate\') return nucleicColorStore.phosphate;', 'phosphate → sa couleur');
has('if (g === \'pentose\') return nucleicColorStore.pentose;', 'pentose → sa couleur');
has('return nucleicColorStore.base;', 'tout le reste (bases) → sa couleur');
has('registerNucleicScheme(NGL);', 'le schéma est enregistré avec la scène');
has('registerBaseIdentityScheme(NGL);', 'le schéma des bases stylisées aussi');
has("registerColorScheme(NGL, 'lab-base-identity'", 'un schéma par identité de base');
has('const [showNucleicColoursPanel, setShowNucleicColoursPanel] = useState(false);', 'l’état du panneau');
has('Colour by chemical group', 'l’interrupteur « Colour by chemical group »');
// Les couleurs par GROUPE chimique (phosphate · pentose · bases) ne sont plus un
// panneau du menu B : le rendu par PART est une RANGÉE (bases · ribose), et c'est
// le « Color by » de cette rangée qui parle pour elle — l'identité de la base
// (lab-base-type, la palette de la roue ⚙) ou une couleur unie. Les trois pastilles
// du vieux panneau, qui écrivaient catStyles.nucleic, ont disparu avec lui.
has("{ sub: 'bases', label: 'DNA/RNA bases', styles: STYLES.bases, colors: COLORS.nucleicParts, def: { style: 'rings', colorBy: 'basetype' }, sele: 'bases' },",
  'la rangée des BASES (plaques pleines, couleur par identité de base)');
has("{ sub: 'ribose', label: 'DNA/RNA ribose', styles: STYLES.ribose, colors: COLORS.nucleicParts, def: { style: 'plates', colorBy: 'basetype' }, sele: 'ribose' },",
  '…et celle du RIBOSE (plaques, même vocabulaire)');
has("case 'basetype': return schemeParam(baseTypeSchemeKey, 'resname');",
  'la couleur par base passe par le schéma maison lab-base-type (repli : la palette resname de NGL)');
gone('value={numToHex(catStyles.nucleic.phosphateColor)}', 'plus de pastille « phosphate » du vieux panneau');
gone('value={numToHex(catStyles.nucleic.pentoseColor)}', '…ni de pastille « pentose »');
gone('value={numToHex(catStyles.nucleic.baseColor)}', '…ni de pastille « bases »');
gone('Phosphate backbone', 'plus de panneau phosphate · pentose · bases');
gone('onClick={resetNucleicColours}', '…ni de son ↺ Reset colours');
has("const setNucleicColour = (key, hex) => setCatStyles((prev) => ({", 'une pastille allume le mode groupe (jamais invisible)');
has('phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,', 'les trois couleurs vivent dans catStyles.nucleic (donc persistées + setup)');
has('groupColour: false,', 'le mode groupe est OFF par défaut (l’aspect historique est conservé)');
has("const nucleicGroupsOn = () => !!(cs.nucleic && cs.nucleic.groupColour && nucleicSchemeKey);",
  'le rendu suit l’interrupteur');
has("const bbCol = nucleicGroupsOn() ? stickCol : backboneCol('nucleic');",
  'squelette : schéma des groupes, ou arc-en-ciel par résidu');
has("const baseSlabCol = nucleicGroupsOn() ? { color: nucleicSchemeKey } : { colorScheme: 'resname' };",
  'rungs : couleur des bases du panneau, ou palette resname de NGL');

/* ══ 5bis. LE MENU C RECOLORE la tête / le squelette / les chaînes ════════ */
// Le même contrat que le menu B, pour les trois PARTIES chimiques d'un lipide.
has('const lipidColorStore = {', 'un store vivant pour les trois parts (une pastille ne reconstruit rien)');
has("if (g === 'glycerol') return lipidColorStore.glycerol;", 'squelette → sa couleur');
has("if (g === 'acyl') return lipidColorStore.acyl;", 'chaînes acyle → leur couleur');
has('return lipidColorStore.head;', 'tout le reste (la tête) → sa couleur');
has("registerColorScheme(NGL, 'lab-lipid-groups'", 'un schéma NGL maison pour les trois parts');
has('registerLipidScheme(NGL);', 'enregistré avec la scène, comme les deux autres');
has('lipidColorStore.named = sub.named;', 'le schéma est lu avec le MÊME classificateur que le rendu');
has('Colour by chemical part', 'l’interrupteur « Colour by chemical part »');
// Le même contrat pour les trois PARTIES chimiques d'un lipide : le panneau du
// menu C a disparu, ses trois parts sont trois RANGÉES (têtes · glycérol · chaînes)
// et leur couleur vient du « Color by » de la rangée (le type de lipide) ou d'une
// couleur unie.
has("{ sub: 'head', label: 'Phospholipid headgroups', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'head' },",
  'la rangée des TÊTES de phospholipides');
has("{ sub: 'glycerol', label: 'Glycerol', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'glycerol' },",
  '…celle du GLYCÉROL');
has("{ sub: 'tail', label: 'Acyl chains', styles: STYLES.sidechains, colors: COLORS.lipidParts, def: { style: 'ball+stick', colorBy: 'lipidtype' }, sele: 'tail' },",
  '…et celle des CHAÎNES ACYLE');
gone('value={numToHex(catStyles.lipid.headColor)}', 'plus de pastille « tête » du vieux panneau');
gone('value={numToHex(catStyles.lipid.glycerolColor)}', '…ni de pastille « squelette »');
gone('value={numToHex(catStyles.lipid.tailColor)}', '…ni de pastille « chaînes »');
gone('onClick={resetLipidColours}', '…ni de son ↺ Reset colours');
has('const setLipidColour = (key, hex) => setCatStyles((prev) => ({', 'une pastille allume « Colour by chemical part » (jamais invisible)');
has('headColor: DEFAULT_LIPID_COLORS.head,', 'les trois couleurs vivent dans catStyles.lipid (donc persistées + setup)');
has('const lipidGroupsOn = () => !!(cs.lipid && cs.lipid.groupColour && lipidSchemeKey);',
  'le rendu suit l’interrupteur');
has('const col = lipidCol();', 'les trois sous-représentations prennent la couleur du schéma');
// ⚠️ Le ↺ du menu B déversait le PALETTE (clés phosphate / pentose / base) au lieu
// des clés réellement stockées (…Color) : les pastilles ne revenaient jamais.
has('phosphateColor: DEFAULT_NUCLEIC_COLORS.phosphate,', '↺ des acides nucléiques écrit bien les clés « …Color »');
has('pentoseColor: DEFAULT_NUCLEIC_COLORS.pentose,', '…le pentose aussi');
has('baseColor: DEFAULT_NUCLEIC_COLORS.base,', '…et les bases');

/* ══ 6. « Stylized rings » : les bases en PLAQUES PLEINES ═════════════════ */
// NGL n'a AUCUNE représentation « plaque pleine » (sa représentation `base` est un
// Ball & Stick sur les atomes du rung) : le viewer construit donc lui-même les
// plaques des anneaux (base ET ribose) en MeshBuffer, façon PyMOL
// `set cartoon_ring_mode, 1` — et n'en dessine le pourtour que sur ces anneaux.
// La rangée des bases dessine les plaques : `addPlates` passe par le vrai
// constructeur de plaques du viewer (nucleicRingPlates) et par le vrai MeshBuffer
// de NGL, et le style « Ring plates » fait la même chose pour l'anneau du ribose.
has("{ sub: 'bases', label: 'DNA/RNA bases', styles: STYLES.bases, colors: COLORS.nucleicParts, def: { style: 'rings', colorBy: 'basetype' }, sele: 'bases' },",
  'les bases sont des PLAQUES PLEINES par défaut de leur rangée');
has("if (look.style === 'rings' || look.style === 'plates') {", '…les deux styles de plaques partagent UNE branche');
has('const plates = addPlates(sele, look, spec.sub);', 'l’INTÉRIEUR des anneaux est une VRAIE plaque pleine');
has('const mesh = new NG.MeshBuffer({ position: data.position, normal: data.normal, color: data.color, index: data.index });',
  '…construite avec le vrai MeshBuffer de NGL');
has("const rep = comp.addBufferRepresentation(mesh, { opacity: sectionOpacity(look), side: 'double' });",
  '…confiée au composant de structure, avec la transparence de SA rangée');
has("sugarPlate: sub === 'ribose',", 'la plaque de l’anneau du RIBOSE est celle de la rangée « DNA/RNA ribose »');
has("addRow('licorice', { sele: `@${idx.join(',')}`", 'un fin anneau de bâtons dessine le pourtour — des ANNEAUX seulement');
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
has('🎨 Predefined styles', 'le bouton « 🎨 Predefined styles » (l’ex « ⚙️ Setup » de la demande)');
const iSec1 = VIEW.indexOf('<VSection title="1 · General"');
ok(iSec1 > 0 && VIEW.indexOf('🎨 Predefined styles', iSec1) > 0,
  'le bloc « Predefined styles » vit dans « 1 · General » (la ligne qui charge / nettoie)');

/* ══ 8. FOND DE LA SCÈNE DANS §2 SCENE ═══════════════════════════════════ */
has("const BG_DEFAULT = '#f8fafc';", 'le fond par défaut est nommé une fois');
has('🎨 Background', 'la ligne « 🎨 Background » du groupe Scene');
has('aria-label="Background colour"', 'un sélecteur de couleur accessible');
has('onChange={(e) => setBgColor(e.target.value)}', 'il écrit l’état du fond (le même que le panneau PyMOL)');
has('onClick={() => setBgColor(BG_DEFAULT)}', '↺ revient au fond par défaut');
has("try { localStorage.setItem('labViewerBg', bgColor); } catch { /* ignore */ }",
  'le fond est persistant (comme Fog / Shadows / Clipping)');
has('const v = localStorage.getItem(\'labViewerBg\');', '…et il est relu au chargement');
has('try { stage.setParameters({ backgroundColor: bgColor }); } catch {}', 'il est poussé à la scène NGL vivante');
// Les indices sont pris APRÈS le titre de « 2 · Toolbar » : la documentation
// d'en-tête du fichier cite elle aussi « 🎨 Background », à un tout autre endroit.
const iSec2 = VIEW.indexOf('<VSection title="2 · Toolbar"');
const iBg = VIEW.indexOf('🎨 Background', iSec2);
const iShadow = VIEW.indexOf('◐ Shadows', iSec2);
const iRayBtn = VIEW.indexOf('✨ RAY — the HIGH-RESOLUTION STILL', iSec2);
const iModify = VIEW.indexOf('✏️ Modify</span>', iSec2);
ok(iSec2 > 0 && iBg > iSec2, 'le réglage est bien DANS la rangée « 2 · Toolbar » (groupe 🌫 Scene)');
ok(iBg > 0 && iShadow > 0 && iBg < iShadow, '…à côté du brouillard, en tête du groupe Scene');
// LES COMMANDES DE LA « RAY » SONT DANS LE GROUPE SCENE (la demande : « i comandi
// ray e i suoi associati (alpha, shadow) devono essere spostati nella sezione
// scene ») — avec le curseur de force des ombres portées et son message.
ok(iRayBtn > iSec2 && iRayBtn < iModify,
  'le bloc ✨ Ray (résolution · ⬚ alpha · ◐ shadows · force · message) vit dans le groupe Scene');
ok(VIEW.indexOf('◐ shadows', iSec2) > 0 && VIEW.indexOf('cast shadow strength', iSec2) > 0,
  '…la case « ◐ shadows » et son curseur de force compris');
ok(VIEW.indexOf('const rayPlan = rayPlanOf(stageRef.current, rayFactor);') > 0,
  '…et le plan (pixels + tuiles) du facteur choisi est lu par le bouton, AVANT le clic');
ok(VIEW.indexOf('⚡ ESP — the electrostatic-potential surface') > iModify,
  'le bouton ⚡ ESP a rejoint le groupe ✏️ Modify (la demande)');


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
  `const RING_TRANSPARENCY_DEFAULT = ${sliceRaw('RING_TRANSPARENCY_DEFAULT')};`,
  `const DEFAULT_SURFACE_COLOR = ${sliceRaw('DEFAULT_SURFACE_COLOR')};`,
  sliceObject(VIEW, 'DEFAULT_ATOM_COLORS'),
  sliceObject(VIEW, 'DEFAULT_GRADIENT_COLORS'),
  sliceObject(VIEW, 'DEFAULT_NUCLEIC_COLORS'),
  sliceObject(VIEW, 'DEFAULT_LIPID_COLORS'),
  sliceObject(VIEW, 'BASE_IDENTITY_COLORS'),
  `const LIPID_GLYCEROL_NAMES = ${sliceRaw('LIPID_GLYCEROL_NAMES')};`,
  `const LIPID_ACYL_RE = ${sliceRaw('LIPID_ACYL_RE')};`,
  `const LIPID_POLAR_ELEMENTS = ${sliceRaw('LIPID_POLAR_ELEMENTS')};`,
  `const LIPID_NAMED_PROBE = ${sliceRaw('LIPID_NAMED_PROBE')};`,
  `const LIPID_CHAIN_PROBE_RE = ${sliceRaw('LIPID_CHAIN_PROBE_RE')};`,
  sliceFn(VIEW, 'catLook'),
  sliceObject(VIEW, 'DEFAULT_CAT_STYLES'),
  sliceFn(VIEW, 'catRadii'),
  // Les RANGÉES d'une molécule (PART 4) : leur description, leurs défauts, et la
  // hiérarchie de la barre — les six menus de catégorie n'existent plus.
  `const MOL_KINDS = ${sliceRaw('MOL_KINDS')};`,
  `const DEFAULT_ELEMENT_COLOR = ${sliceRaw('DEFAULT_ELEMENT_COLOR')};`,
  sliceObject(VIEW, 'KIND_CATEGORY'),
  sliceObject(VIEW, 'KIND_VISIBLE_BY_DEFAULT'),
  sliceObject(VIEW, 'STYLES'),
  sliceObject(VIEW, 'COLORS'),
  sliceObject(VIEW, 'SECTION_SUBSECTIONS'),
  sliceFn(VIEW, 'subsectionsOf'),
  sliceFn(VIEW, 'subsectionSpec'),
  sliceFn(VIEW, 'defaultLookOf'),
  sliceFn(VIEW, 'nucleicGroupOf'),
  // La lettre de la base (A · C · G · T · U) est lue par UN SEUL lecteur, que la
  // couleur des plaques ET le classificateur de conformation utilisent.
  sliceFn(VIEW, 'nucBaseOf'),
  // La couleur d'une base passe par le store que la roue ⚙ édite (lab-base-type) :
  // le sandbox doit donc le poser avant le lecteur qui s'en sert.
  sliceObject(VIEW, 'baseTypeColorStore'),
  sliceFn(VIEW, 'baseTypeColorOf'),
  sliceFn(VIEW, 'baseIdentityColorOf'),
  sliceFn(VIEW, 'atomElement'),
  sliceFn(VIEW, 'lipidGroupOf'),
  "const VIEWER_SETUP_KEY = 'labViewerSetups';",
  sliceFn(VIEW, 'loadViewerSetups'),
  sliceFn(VIEW, 'saveViewerSetups'),
  'return { catRadii, nucleicGroupOf, baseIdentityColorOf, atomElement, lipidGroupOf, DEFAULT_CAT_STYLES, DEFAULT_ATOM_COLORS, DEFAULT_LIPID_COLORS, BASE_IDENTITY_COLORS, DEFAULT_NUCLEIC_COLORS, loadViewerSetups, saveViewerSetups, MOL_KINDS, subsectionsOf, subsectionSpec, defaultLookOf, SECTION_SUBSECTIONS, KIND_VISIBLE_BY_DEFAULT, STYLES, COLORS };',
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

/* ── 9c2. Les trois parts d'un lipide (le classificateur du menu C) ══════
   Ce que le menu C DESSINE et ce que son panneau COLORIE sortent du même
   classificateur : la tête est le RESTE — ni chaîne acyle, ni squelette — donc un
   headgroup en Ball & Stick garde tous ses atomes et toutes ses liaisons. */
// Tête : tout ce qui n'est ni chaîne ni squelette — le phosphate et ses oxygènes,
// les carbones de la choline et TOUS leurs hydrogènes (l'ancienne règle positive
// « .P or .N or .O1* » les laissait tomber).
const LIPID_HEAD_ATOMS = ['P', 'O11', 'O12', 'O13', 'O14', 'N', 'C11', 'C12', 'C13', 'C14', 'C15',
  'H11A', 'H12A', 'H13A', 'H13B', 'H13C', 'H14A', 'H14B', 'H14C', 'H15A', 'H15B', 'H15C', 'HN'];
LIPID_HEAD_ATOMS.forEach((n) => eq(H.lipidGroupOf(n, 'C'), 'head', `${n} = la tête (par EXCLUSION)`));
// Squelette : les trois carbones, les deux oxygènes esters et leurs hydrogènes —
// y compris une nomenclature d'hydrogènes « H1A / H2 / H3A », qui RETOMBE sur le
// carbone que leur nom désigne.
const LIPID_GLY_ATOMS = ['C1', 'C2', 'C3', 'O21', 'O31', 'HA', 'HB', 'HS', 'HX', 'HY', 'H1A', 'H1B', 'H2', 'H3A', 'H3B'];
LIPID_GLY_ATOMS.forEach((n) => eq(H.lipidGroupOf(n, 'C'), 'glycerol', `${n} = le squelette glycérol`));
// Chaînes : les carbones sn-1 / sn-2, les carbonyles des esters et leurs
// hydrogènes (H21A → C21).
const LIPID_ACYL_ATOMS = ['C21', 'C22', 'C216', 'C31', 'C316', 'O22', 'O32', 'H21A', 'H21B', 'H216A', 'H31A', 'H316C'];
LIPID_ACYL_ATOMS.forEach((n) => eq(H.lipidGroupOf(n, 'C'), 'acyl', `${n} = une chaîne acyle`));
eq(H.lipidGroupOf('', '', true), 'head', 'un nom vide ne fait pas planter la coloration');
eq(H.lipidGroupOf(undefined, undefined, true), 'head', 'un atome sans nom non plus');
eq(H.lipidGroupOf('QQ7', 'C', true), 'head', 'un nom inconnu va du côté SÛR : la tête (jamais perdu)');
// Repli par élément : un fichier qui renomme ses atomes d'après l'élément
// (P8 / C12 / O9 …) n'a aucune nomenclature à lire.
eq(H.lipidGroupOf('P8', 'P', false), 'head', 'repli élément : le phosphore est la tête');
eq(H.lipidGroupOf('O9', 'O', false), 'head', '…l’oxygène aussi');
eq(H.lipidGroupOf('N4', 'N', false), 'head', '…l’azote aussi');
eq(H.lipidGroupOf('S1', 'S', false), 'head', '…et le soufre');
eq(H.lipidGroupOf('C12', 'C', false), 'acyl', '…tout carbone est une chaîne');
eq(H.lipidGroupOf('H0', 'H', false), 'acyl', '…y compris les hydrogènes');
eq(H.lipidGroupOf('C1', 'C', false), 'acyl', '…même un carbone nommé C1 (la nomenclature est ignorée)');
// L'élément vient de NGL quand il est là, du nom sinon.
eq(H.atomElement('C21', 'C'), 'C', 'l’élément de NGL est retenu');
eq(H.atomElement('C21', ''), 'C', '…sinon la première lettre du nom');
eq(H.atomElement('', ''), '', 'sans rien, aucun élément (jamais d’exception)');
eq(H.atomElement('o9', undefined), 'O', '…toujours en majuscules');

/* ── 9d. Les défauts des six menus ═════════════════════════════════════ */
H.MOL_KINDS.forEach((k) => {
  const subs = H.subsectionsOf(k);
  ok(subs.length > 0, `[${k}] ce type de molécule a des rangées`);
  eq(subs[0].sub, 'general', `[${k}] la première rangée est « General »`);
  subs.forEach((s) => {
    ok(!!s.label, `[${k}/${s.sub}] la rangée est nommée`);
    ok(s.styles.includes(s.def.style), `[${k}/${s.sub}] son style par défaut est un style de sa liste`);
    ok(s.colors.includes(s.def.colorBy), `[${k}/${s.sub}] …et sa coloration par défaut aussi`);
    const d = H.defaultLookOf(k, s.sub);
    ok(d.sphere === 1 && d.bond === 1, `[${k}/${s.sub}] les rayons démarrent au neutre (1.00)`);
    eq(d.material, 'auto', `[${k}/${s.sub}] le matériau démarre sur celui de NGL`);
    eq(d.opacity, 0, `[${k}/${s.sub}] la rangée démarre opaque`);
    ok(Number.isFinite(d.solidColor), `[${k}/${s.sub}] une couleur unie est proposée`);
    eq(d.follow, s.sub !== 'general', `[${k}/${s.sub}] seule « General » ne suit personne`);
  });
});
ok(!H.KIND_VISIBLE_BY_DEFAULT.water && !H.KIND_VISIBLE_BY_DEFAULT.ion,
  'l’eau et les ions démarrent NON dessinés (un solvant ne bloque pas la vue)');
eq(H.SECTION_SUBSECTIONS.protein.find((s) => s.sub === 'backbone').def, { style: 'cartoon', colorBy: 'sstruc' },
  'le style par défaut du squelette protéique ne change pas');
eq(H.SECTION_SUBSECTIONS.nucleic.find((s) => s.sub === 'bases').def.style, 'rings', 'les bases restent des plaques pleines');
eq(H.SECTION_SUBSECTIONS.nucleic.find((s) => s.sub === 'bases').def.colorBy, 'basetype', '…colorées par identité de base');
eq(H.SECTION_SUBSECTIONS.lipid.find((s) => s.sub === 'head').def.colorBy, 'lipidtype', 'les lipides se colorent par TYPE de lipide');
eq(H.SECTION_SUBSECTIONS.sugar[0].def.style, 'ball+stick', 'les sucres gardent leur style par défaut');
eq(H.SECTION_SUBSECTIONS.ion[0].def.style, 'spacefill', 'un ion est une sphère (spacefill)');

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






