/* =========================================================================
   _viewer_color_settings_test.mjs — la ROUE ⚙ du viewer 3D (barre Molecules) :
   les deux palettes qu'elle édite, et la hiérarchie « look général ⇄ look d'un
   menu » qui les relie aux six menus de §2.

   Ce qui doit rester vrai :

     • la roue ⚙ vit dans la barre Molecules et édite DEUX palettes réelles :
       les TYPES D'ATOMES (une couleur par élément) et les TYPES DE SUCRES (une
       couleur par résidu de sucre) — plus les deux bouts du dégradé et le look
       général. Chaque pastille est persistée et repeint les représentations ;
     • les deux schémas maison qui lisent ces palettes (lab-elements ·
       lab-sugar-identity) sont ENREGISTRÉS au démarrage ET CONSOMMÉS :
       « Atom type » (barre Molecules) et « Atom-type palette (⚙) » / « Sugar
       type » (menus) passent leur id à NGL, et retombent sur les couleurs
       d'éléments de NGL si l'enregistrement a échoué — jamais de molécule vide ;
     • la grille des sucres est construite sur la MÊME liste que celle sur
       laquelle le menu des sucres sélectionne (SUGAR_IDENTITY_CODES) : les deux
       ne peuvent pas dériver l'une de l'autre ;
     • la hiérarchie : un champ qu'un menu n'a jamais touché SUIT le look général
       (changer le général l'écrit dans ce menu), un champ changé DANS un menu le
       surcharge (il garde sa valeur quand le général bouge) et le petit ↺ de ce
       champ le rend au général ; ↺ Reset radii & colours d'un menu = tous ses
       champs suivent le général ;
     • les quatre groupes repliés de la barre Molecules (Style · Colour · Transp ·
       Move) sont rendus par UNE seule implémentation, pour la structure
       principale comme pour chaque molécule chargée, et chacun dit sa valeur
       courante (un groupe replié n'est jamais muet) ;
     • le SMILES de la molécule / du LIGAND est affiché (replié) dans cette barre,
       avec son bouton 📋 — il était reçu mais jamais montré.

   Le viewer est un .jsx : les helpers purs sont EXTRAITS du fichier puis
   EXÉCUTÉS (comme dans _viewer_style_controls_test.mjs).
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
const DOCK = readFileSync(new URL('./src/components/DockingSections.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);

/* ── Extraction : `const name = (…) => { … };` et `const name = { … };` ──── */
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
const sliceObject = (src, name) => {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `objet ${name} introuvable`);
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
  assert.ok(!!m, `constante ${name} introuvable`);
  return m[1];
};

/* ══ 1. LA ROUE ⚙ : DEUX PALETTES, UNE SEULE IMPLÉMENTATION ═══════════════ */
has('const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);', '[⚙] la roue a son état');
has('onClick={() => setSettingsPanelOpen(true)}', '[⚙] elle s’ouvre depuis la barre Molecules');
has('const [elementColors, setElementColors] = useState(() => loadPalette(ELEMENT_COLORS_KEY, ELEMENT_COLOR_PALETTE));',
  '[⚙] la palette des éléments est un état (la grille n’est jamais périmée)');
has('const [sugarColors, setSugarColors] = useState(() => loadPalette(SUGAR_COLORS_KEY, SUGAR_IDENTITY_COLORS));',
  '[⚙] idem pour les sucres');
has('{Object.keys(ELEMENT_COLOR_PALETTE).map((el) => (', '[⚙] une pastille par élément');
has('{SUGAR_IDENTITY_CODES.map((res) => (', '[⚙] une pastille par sucre, sur la liste du menu des sucres');
has('onChange={(e) => setElementColor(el, parseInt(e.target.value.slice(1), 16))}', '[⚙] la pastille écrit la table');
has('onChange={(e) => setSugarColor(res, parseInt(e.target.value.slice(1), 16))}', '[⚙] …et celle des sucres aussi');
has('const resetElementColors = () => setElementColors({ ...ELEMENT_COLOR_PALETTE });', '[⚙] ↺ des éléments');
has('const resetSugarColors = () => setSugarColors({ ...SUGAR_IDENTITY_COLORS });', '[⚙] ↺ des sucres');
// Les palettes sont le CONTENU des schémas : un effet les copie dans les stores
// vivants que lisent lab-elements / lab-sugar-identity, puis les persiste.
has('Object.assign(elementColorStore, elementColors);', '[⚙] la table vivante des éléments est alimentée');
has('Object.assign(sugarColorStore, sugarColors);', '[⚙] …celle des sucres aussi');
has('savePalette(ELEMENT_COLORS_KEY, elementColors);', '[⚙] la palette des éléments est persistée');
has('savePalette(SUGAR_COLORS_KEY, sugarColors);', '[⚙] …celle des sucres aussi');
has("const ELEMENT_COLORS_KEY = 'labViewerElementColors';", '[⚙] clé localStorage des éléments');
has("const SUGAR_COLORS_KEY = 'labViewerSugarColors';", '[⚙] clé localStorage des sucres');
// ── 1bis. Les DEUX palettes NUCLEIC de PART 3 (formes · motifs) ────────────
// Même contrat que les deux premières : un état React (la grille n'est jamais
// périmée), un store vivant lu par le schéma, une clé localStorage, et une
// pastille par forme / par motif.
has("const NUCLEIC_FORM_COLORS_KEY = 'labViewerNucleicFormColors';", '[⚙] clé localStorage des formes');
has("const NUCLEIC_MOTIF_COLORS_KEY = 'labViewerNucleicMotifColors';", '[⚙] clé localStorage des motifs');
has('const [nucleicFormColors, setNucleicFormColors] = useState(() => loadPalette(NUCLEIC_FORM_COLORS_KEY, DEFAULT_NUCLEIC_FORM_COLORS));',
  '[⚙] les six couleurs de forme sont un état, chargé de localStorage');
has('const [nucleicMotifColors, setNucleicMotifColors] = useState(() => loadPalette(NUCLEIC_MOTIF_COLORS_KEY, DEFAULT_NUCLEIC_MOTIF_COLORS));',
  '[⚙] …et les deux couleurs de motif aussi');
has('Object.assign(nucleicFormColorStore, nucleicFormColors);', '[⚙] la table vivante des formes est alimentée');
has('Object.assign(nucleicMotifColorStore, nucleicMotifColors);', '[⚙] …celle des motifs aussi');
has('savePalette(NUCLEIC_FORM_COLORS_KEY, nucleicFormColors);', '[⚙] la palette des formes est persistée');
has('savePalette(NUCLEIC_MOTIF_COLORS_KEY, nucleicMotifColors);', '[⚙] …celle des motifs aussi');
has('const setNucleicFormColor = (form, hex) => setNucleicFormColors((prev) => ({ ...prev, [form]: hex }));',
  '[⚙] une pastille écrit la table des formes');
has('const setNucleicMotifColor = (motif, hex) => setNucleicMotifColors((prev) => ({ ...prev, [motif]: hex }));',
  '[⚙] …et une pastille la table des motifs');
has('const resetNucleicFormColors = () => setNucleicFormColors({ ...DEFAULT_NUCLEIC_FORM_COLORS });', '[⚙] ↺ des formes');
has('const resetNucleicMotifColors = () => setNucleicMotifColors({ ...DEFAULT_NUCLEIC_MOTIF_COLORS });', '[⚙] ↺ des motifs');
has('{NUC_FORM_LABELS.map((form) => (', '[⚙] une pastille par forme (la liste des six formes)');
has("{['gquad', 'hairpin'].map((motif) => (", '[⚙] …et une par motif (G4 · hairpin)');
has('onChange={(e) => setNucleicFormColor(form, parseInt(e.target.value.slice(1), 16))}', '[⚙] la pastille d’une forme écrit la table');
has('onChange={(e) => setNucleicMotifColor(motif, parseInt(e.target.value.slice(1), 16))}', '[⚙] …celle d’un motif aussi');

/* ══ 2. LES DEUX SCHÉMAS SONT ENREGISTRÉS **ET** CONSOMMÉS ════════════════ */
// C'EST LE CŒUR DU CORRECTIF : ces deux schémas existaient mais n'étaient ni
// enregistrés ni lus — les palettes ne peignaient donc rien du tout.
has('registerElementScheme(NGL);', '[schémas] lab-elements est enregistré au démarrage');
has('registerSugarScheme(NGL);', '[schémas] lab-sugar-identity aussi');
has("elementSchemeKey = registerColorScheme(NGL, 'lab-elements', defineElementScheme());",
  '[schémas] …par registerColorScheme (définition d’abord, libellé ensuite)');
has("sugarSchemeKey = registerColorScheme(NGL, 'lab-sugar-identity', defineSugarIdentityScheme());",
  '[schémas] …idem pour les sucres');
has('const schemeForColorMode = (mode) => {', '[schémas] UNE correspondance « Color by » → schéma NGL');
has("if (mode === 'element') return elementSchemeKey || 'element';",
  '[schémas] « Atom type » → la palette ⚙ (repli : les couleurs d’éléments de NGL)');
has("if (mode === 'sugar') return sugarSchemeKey || 'element';",
  '[schémas] « Sugar type » → l’identité des sucres (même repli)');
eq((VIEW.match(/\? schemeForColorMode\(st\.colorMode\)/g) || []).length, 3,
  'les trois chemins de coloration par molécule (principale · molécules chargées · sélections) passent par elle');
has('<option value="element">Atom-type palette (⚙)</option>', '[menus] la palette des éléments est proposée dans les menus');
has("{showSugar && <option value=\"sugar\">Sugar type (⚙ palette)</option>}", '[menus] le type de sucre n’est proposé que là où des sucres sont dessinés');
has("const showSugar = cat === 'sugar';", '[menus] …c’est-à-dire le menu des sucres');
has('⚙ Palette…', '[menus] le menu renvoie vers la roue');
has("if (mode === 'element' && elementSchemeKey) return { color: elementSchemeKey };",
  '[lecture] le sélecteur d’atomes passe l’id du schéma des éléments');
has("if (mode === 'sugar' && sugarSchemeKey) return { color: sugarSchemeKey };",
  '[lecture] …et celui des sucres');
ok(VIEW.includes('Atom-type palette (⚙)') && DOCK.includes('ligandSmiles'),
  'les deux palettes vivent de bout en bout (menus · barre · page)');

/* ══ 3. LA BARRE MOLECULES : QUATRE GROUPES REPLIÉS, UNE IMPLÉMENTATION ═══ */
has('const [molFold, setMolFold] = useState({});', '[barre] l’état de repli par molécule');
has('const toggleMolFold = (key, section) => setMolFold((prev) => ({ ...prev, [key]: prev[key] === section ? null : section }));',
  '[barre] un seul groupe ouvert à la fois, par molécule');
has('const MolFold = ({ open, onToggle, label, summary }) => (', '[barre] le composant de repli');
has('const renderMolFolds = (keyName, { name, style, color, colorMode, transparency, onStyle, onColor, onColorMode, onTransparency, moveFields }) => {',
  '[barre] UNE implémentation des quatre groupes');
has("{renderMolFolds('main', {", '[barre] la structure principale l’utilise');
has('{renderMolFolds(m.id, {', '[barre] …chaque molécule chargée aussi');
has('<MolFold {...fold(\'style\')} label="Style"', '[barre] le groupe Style');
has('<MolFold {...fold(\'color\')} label="Colour"', '[barre] le groupe Colour');
has('label={`Transp ${transp}%`}', '[barre] …la transparence, qui dit sa valeur courante');
has('<MolFold {...fold(\'move\')} label="Move"', '[barre] le groupe Move');
has('const MOL_STYLE_OPTIONS = (', '[barre] une seule liste de styles pour toutes les lignes');
has('const MOL_COLOR_OPTIONS = (', '[barre] …et une seule liste de colorations');
has('setMolFold((prev) => { const n = { ...prev }; delete n[id]; return n; });',
  '[barre] supprimer une molécule oublie son repli');

/* ══ 4. LE SMILES DE LA MOLÉCULE / DU LIGAND EST AFFICHÉ ══════════════════ */
has("ligandSmiles = '',", '[SMILES] le SMILES du ligand amarré arrive par la page');
has("const ligandSmilesText = String(smiles || ligandSmiles || '').trim();",
  '[SMILES] `smiles` (la molécule de la page) l’emporte sur celui du docking');
has('{ligandSmilesText && (', '[SMILES] la ligne n’existe que s’il y a un SMILES');
has('onClick={copyLigandSmiles}', '[SMILES] le bouton 📋');
has('await navigator.clipboard.writeText(ligandSmilesText);', '[SMILES] la copie passe par le presse-papiers');
has('const molBarOpen = extraMols.length > 0 || !!ligandSmilesText;',
  '[SMILES] la barre s’ouvre aussi pour un SMILES seul');
has("${molBarOpen ? 'right-[21rem]' : 'right-2'}", '[SMILES] …et la barre des sélections se décale');
ok(DOCK.includes('ligandSmiles={d.ligandSmiles || \'\'}'),
  '[SMILES] DockingSections passe le SMILES du ligand au viewer');

/* ══ 5. LE LOOK GÉNÉRAL ⇄ LES SIX MENUS (la hiérarchie) ═══════════════════ */
has("const GENERAL_LOOK_KEY = 'labViewerGeneralLook';", '[général] le look général est persistant');
has('const [generalLook, setGeneralLook] = useState(() => loadGeneralLook());', '[général] son état');
has('const setGeneralLookField = (key, value) => {', '[général] UNE écriture, qui atteint les six menus');
has('setCatStyles((prev) => applyGeneralField(prev, key, value));', '[général] …par la fonction pure de propagation');
has('useEffect(() => { try { localStorage.setItem(GENERAL_LOOK_KEY, JSON.stringify(generalLook)); } catch { /* ignore */ } }, [generalLook]);',
  '[général] il est écrit dans localStorage');
has('const renderFollowGeneral = (cat, key, label) => (', '[général] le ↺ par champ');
has('followsGeneral(cat, key)', '[général] …qui suit l’état réel du champ');
ok(VIEW.includes('· General') && VIEW.includes('↺ General'),
  '[général] les deux états (suit / surcharge) sont lisibles dans l’interface');
has("{renderFollowGeneral(cat, 'sphereRadius', 'sphere radius')}", '[général] les rayons disent leur état');
has("{renderFollowGeneral(cat, 'bondRadius', 'bond radius')}", '[général] …les deux rayons');
has("{renderFollowGeneral(cat, 'atomColor', 'atom colour')}", '[général] …la couleur d’atomes');
has("{renderFollowGeneral(cat, 'surfaceColor', 'surface colour')}", '[général] …et la couleur de surface');
has('⚙ General look', '[général] la ligne « General look » de §2');
has('onClick={resetGeneralLook}', '[général] ↺ Default du look général');
has('onClick={swapGeneralGradient}', '[général] ⇄ du dégradé (une seule paire, un seul schéma)');
has('const resetCatLook = (cat) => setCatStyles((prev) => adoptGeneralLook(prev, cat, generalLook));',
  '[général] ↺ d’un menu = ses champs suivent le général');
// Un champ changé DANS un menu devient une SURCHARGE : c'est ce que setCatStyle
// inscrit, champ par champ, pour les seuls champs du look général.
has('if (isLookKey(key)) next.ovr = { ...(cur.ovr || DEFAULT_LOOK_OVERRIDES), [key]: true };',
  '[général] changer un champ dans un menu le marque comme surchargé');
has('next.ovr = { ...(cur.ovr || DEFAULT_LOOK_OVERRIDES), surfaceColor: true };',
  '[général] …la couleur de surface comprise');
// Le PREMIER état ne bouge pas : seul l'aplat par catégorie est une surcharge.
has('const DEFAULT_LOOK_OVERRIDES = { atomColorHex: true };',
  '[général] au départ, seul l’aplat de la catégorie est une surcharge (aucun menu ne bouge)');
has('if (isLookKey(field)) ovr[field] = true;',
  '[général] un réglage déjà enregistré (localStorage) compte comme une surcharge');

/* ══ 6. LES FONCTIONS PURES, EXÉCUTÉES POUR DE VRAI ═══════════════════════ */
// Un localStorage de laboratoire : loadPalette / savePalette sont vraiment joués.
const makeStorage = (initial = {}) => {
  const m = { ...initial };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    dump: () => m,
  };
};
const buildHelpers = (keys = {}, stored = {}) => {
  const body = [
    `const CAT_STYLE_CATS = ${sliceRaw('CAT_STYLE_CATS')};`,
    `const LOOK_KEYS = ${sliceRaw('LOOK_KEYS')};`,
    `const isLookKey = ${sliceRaw('isLookKey')};`,
    sliceObject(VIEW, 'DEFAULT_LOOK_OVERRIDES'),
    `const DEFAULT_SURFACE_COLOR = ${sliceRaw('DEFAULT_SURFACE_COLOR')};`,
    `const DEFAULT_ELEMENT_COLOR = ${sliceRaw('DEFAULT_ELEMENT_COLOR')};`,
    sliceObject(VIEW, 'DEFAULT_GRADIENT_COLORS'),
    sliceObject(VIEW, 'DEFAULT_GENERAL_LOOK'),
    sliceObject(VIEW, 'ELEMENT_COLOR_PALETTE'),
    sliceObject(VIEW, 'SUGAR_IDENTITY_COLORS'),
    sliceObject(VIEW, 'DEFAULT_NUCLEIC_FORM_COLORS'),
    sliceObject(VIEW, 'DEFAULT_NUCLEIC_MOTIF_COLORS'),
    `const SUGAR_RES_SEL = ${sliceRaw('SUGAR_RES_SEL')};`,
    `const SUGAR_IDENTITY_CODES = ${sliceRaw('SUGAR_IDENTITY_CODES')};`,
    'const elementColorStore = { ...ELEMENT_COLOR_PALETTE };',
    'const sugarColorStore = { ...SUGAR_IDENTITY_COLORS };',
    sliceFn(VIEW, 'overridesLook'),
    sliceFn(VIEW, 'applyGeneralField'),
    sliceFn(VIEW, 'yieldLookField'),
    sliceFn(VIEW, 'adoptGeneralLook'),
    sliceFn(VIEW, 'defaultGeneralLookIn'),
    sliceFn(VIEW, 'mergePalette'),
    sliceFn(VIEW, 'loadPalette'),
    sliceFn(VIEW, 'savePalette'),
    sliceFn(VIEW, 'elementColorOf'),
    sliceFn(VIEW, 'sugarColorOf'),
    sliceFn(VIEW, 'schemeForColorMode'),
    `let sstrucSchemeKey = ${keys.sstruc === undefined ? 'null' : JSON.stringify(keys.sstruc)};`,
    `let elementSchemeKey = ${keys.elements === undefined ? 'null' : JSON.stringify(keys.elements)};`,
    `let sugarSchemeKey = ${keys.sugar === undefined ? 'null' : JSON.stringify(keys.sugar)};`,
    `let glycanSchemeKey = ${keys.glycan === undefined ? 'null' : JSON.stringify(keys.glycan)};`,
    `let lipidClassSchemeKey = ${keys.lipidclass === undefined ? 'null' : JSON.stringify(keys.lipidclass)};`,
    `let nucleicFormSchemeKey = ${keys.nucform === undefined ? 'null' : JSON.stringify(keys.nucform)};`,
    `let nucleicMotifSchemeKey = ${keys.motif === undefined ? 'null' : JSON.stringify(keys.motif)};`,
    `return { CAT_STYLE_CATS, LOOK_KEYS, isLookKey, DEFAULT_LOOK_OVERRIDES, DEFAULT_GENERAL_LOOK,
      DEFAULT_GRADIENT_COLORS, ELEMENT_COLOR_PALETTE, SUGAR_IDENTITY_COLORS, SUGAR_IDENTITY_CODES,
      DEFAULT_NUCLEIC_FORM_COLORS, DEFAULT_NUCLEIC_MOTIF_COLORS,
      DEFAULT_ELEMENT_COLOR, overridesLook, applyGeneralField, yieldLookField, adoptGeneralLook,
      defaultGeneralLookIn, mergePalette, loadPalette, savePalette, elementColorOf, sugarColorOf,
      schemeForColorMode };`,
  ].join('\n');
  const storage = makeStorage(stored);
  const api = new Function('localStorage', body)(storage);
  api.storage = storage;
  return api;
};
const H = buildHelpers();
const HK = buildHelpers({ sstruc: 'lab-sstruc', elements: 'lab-elements', sugar: 'lab-sugar-identity' });

/* ── 6a. Les deux palettes : lecture, écriture, et la garde des entrées ──── */
eq(H.loadPalette('rien', { C: 1, N: 2 }), { C: 1, N: 2 }, 'aucune entrée enregistrée → les défauts');
const storedH = buildHelpers({}, { pal: JSON.stringify({ C: 0x123456, N: 'bleu', Xx: 0x999999 }) });
eq(storedH.loadPalette('pal', { C: 1, N: 2 }), { C: 0x123456, N: 2 },
  'seules les clés CONNUES et les couleurs finies sont reprises (ni Xx, ni « bleu »)');
const brokenH = buildHelpers({}, { pal: '{pas du json' });
eq(brokenH.loadPalette('pal', { C: 1 }), { C: 1 }, 'un localStorage illisible retombe sur les défauts (aucun plantage)');
storedH.savePalette('pal2', { C: 7 });
eq(JSON.parse(storedH.storage.dump().pal2), { C: 7 }, 'savePalette écrit la palette en JSON');
// La MÊME règle de validation sert à un ⚙️ setup importé (mergePalette).
eq(H.mergePalette({ C: 1, N: 2 }, { C: 0x123456, N: 'bleu', Xx: 9 }), { C: 0x123456, N: 2 },
  'une palette importée ne peut pas ajouter de clé ni poser une couleur non finie');
eq(H.mergePalette({ C: 1 }, null), { C: 1 }, 'une palette absente (setup d’une ancienne version) = les défauts');
has('    nucleicForms: nucleicFormColors,', '[⚙] les palettes voyagent dans un ⚙️ setup');
has('    nucleicMotifs: nucleicMotifColors,', '[⚙] …y compris les six formes et les deux motifs de PART 3');
has('if (pal.elements) setElementColors((p) => mergePalette(ELEMENT_COLOR_PALETTE, { ...p, ...pal.elements }));',
  '[⚙] …et elles sont rechargées et validées à l’application d’un setup');
has('if (pal.sugars) setSugarColors((p) => mergePalette(SUGAR_IDENTITY_COLORS, { ...p, ...pal.sugars }));',
  '[⚙] …les sucres avec elles');
has('if (pal.nucleicForms) setNucleicFormColors((p) => mergePalette(DEFAULT_NUCLEIC_FORM_COLORS, { ...p, ...pal.nucleicForms }));',
  '[⚙] …et les couleurs de conformation, validées par la MÊME règle (mergePalette)');
has('if (pal.nucleicMotifs) setNucleicMotifColors((p) => mergePalette(DEFAULT_NUCLEIC_MOTIF_COLORS, { ...p, ...pal.nucleicMotifs }));',
  '[⚙] …ainsi que celles des motifs');
has('if (s.generalLook && typeof s.generalLook === \'object\') {', '[général] le look général voyage aussi');
has('  generalLook,', '[général] …dans la capture du setup');

/* ── 6b. Suivre ou surcharger : les deux états d'un champ ────────────────── */
eq(H.LOOK_KEYS, ['atomColor', 'atomColorHex', 'surfaceColor', 'surfaceColorHex', 'sphereRadius', 'bondRadius', 'gradientFrom', 'gradientTo'],
  'les huit champs du look général');
ok(H.LOOK_KEYS.every((k) => H.isLookKey(k)), 'isLookKey() reconnaît les huit');
ok(!H.isLookKey('style') && !H.isLookKey('bases'), '…et rien d’autre : les STYLES ne suivent pas le look général');
eq(H.overridesLook({}, 'atomColorHex'), true, 'au départ, l’aplat de la catégorie est sa propre couleur (surcharge)');
eq(H.overridesLook({}, 'sphereRadius'), false, '…et les rayons suivent le général');
eq(H.overridesLook({ ovr: { sphereRadius: true } }, 'sphereRadius'), true, 'un menu peut surcharger n’importe quel champ du look');
eq(H.overridesLook({ ovr: {} }, 'atomColorHex'), false, 'après le ↺ d’un menu, plus AUCUN champ ne surcharge');

/* ── 6c. La propagation : le général écrit dans les menus qui le suivent ── */
const lookOf = (hex) => ({
  atomColor: 'default', atomColorHex: hex, surfaceColor: 'default', surfaceColorHex: 0xcbd5e1,
  sphereRadius: 1, bondRadius: 1, gradientFrom: 0x111111, gradientTo: 0x222222,
});
const base = {};
H.CAT_STYLE_CATS.forEach((c, i) => { base[c] = lookOf(0xa0 + i); });
base.nucleic.ovr = { ...H.DEFAULT_LOOK_OVERRIDES, sphereRadius: true };   // ce menu-là a son propre rayon
const after = H.applyGeneralField(base, 'sphereRadius', 1.5);
eq(after.protein.sphereRadius, 1.5, 'changer le général écrit dans un menu qui l’écoute');
eq(after.nucleic.sphereRadius, 1, '…et jamais dans celui qui surcharge ce champ');
eq(base.protein.sphereRadius, 1, 'la fonction est pure : l’objet d’entrée n’est pas modifié');
eq(after.sugar.surfaceColor, 'default', 'les autres champs ne bougent pas');
// Le ↺ d'UN champ le rend au général…
const back = H.yieldLookField(after, 'nucleic', 'sphereRadius', 1.5);
eq(back.nucleic.sphereRadius, 1.5, '↺ General : ce champ prend la valeur générale');
eq(H.overridesLook(back.nucleic, 'sphereRadius'), false, '…et il se remet à suivre');
eq(back.nucleic.ovr.atomColorHex, true, '…sans toucher aux autres surcharges du menu');
// …preuve : la valeur générale suivante l'atteint (comme elle atteint les autres).
const again = H.applyGeneralField(back, 'sphereRadius', 2.05);
eq(again.nucleic.sphereRadius, 2.05, 'la valeur générale suivante atteint le champ rendu');
eq(again.protein.sphereRadius, 2.05, '…comme elle atteint les menus qui suivaient déjà');
// Le ↺ d'un MENU ENTIER : tout le look général entre dans ce menu.
const general = { ...H.DEFAULT_GENERAL_LOOK, sphereRadius: 1.7, atomColor: 'element' };
const adopted = H.adoptGeneralLook(base, 'nucleic', general);
ok(H.LOOK_KEYS.every((k) => adopted.nucleic[k] === general[k]),
  '↺ Reset radii & colours : les HUIT champs du look général entrent dans ce menu');
eq(H.overridesLook(adopted.nucleic, 'atomColorHex'), false, '…et plus aucun d’eux ne surcharge');
eq(adopted.protein.sphereRadius, 1, 'les autres menus ne sont pas touchés');
// Le ↺ du look GÉNÉRAL : les champs qui suivent reprennent les défauts.
const def = H.defaultGeneralLookIn(adopted);
eq(def.nucleic.sphereRadius, H.DEFAULT_GENERAL_LOOK.sphereRadius, '↺ Default : un champ qui suit reprend le défaut');
eq(def.nucleic.atomColor, H.DEFAULT_GENERAL_LOOK.atomColor, '…la couleur d’atomes comprise');
eq(def.protein.sphereRadius, H.DEFAULT_GENERAL_LOOK.sphereRadius, '…dans tous les menus qui suivent');
const kept = { ...adopted, protein: { ...adopted.protein, sphereRadius: 2.5, ovr: { ...(adopted.protein.ovr || H.DEFAULT_LOOK_OVERRIDES), sphereRadius: true } } };
eq(H.defaultGeneralLookIn(kept).protein.sphereRadius, 2.5, '…mais un menu qui surcharge garde sa valeur');
// Les défauts du général SONT ceux des menus : rien ne bouge au premier lancement.
eq([H.DEFAULT_GENERAL_LOOK.sphereRadius, H.DEFAULT_GENERAL_LOOK.bondRadius], [1, 1],
  'les rayons généraux partent au neutre (1.00×)');
eq([H.DEFAULT_GENERAL_LOOK.atomColor, H.DEFAULT_GENERAL_LOOK.surfaceColor], ['default', 'default'],
  'les couleurs générales partent sur « Default » (couleurs d’éléments)');
eq([H.DEFAULT_GENERAL_LOOK.gradientFrom, H.DEFAULT_GENERAL_LOOK.gradientTo],
  [H.DEFAULT_GRADIENT_COLORS.from, H.DEFAULT_GRADIENT_COLORS.to],
  'le dégradé général = la paire par défaut (une seule rampe pour tout le viewer)');

/* ── 6d. La correspondance « Color by » → schéma NGL ────────────────────── */
eq(HK.schemeForColorMode('chainid'), 'chainid', 'les métaphores NGL natives passent telles quelles');
eq(HK.schemeForColorMode('hydrophobicity'), 'hydrophobicity', '…toutes');
eq(HK.schemeForColorMode('sstruc'), 'lab-sstruc', '2° structure → le schéma des couleurs configurables');
eq(HK.schemeForColorMode('element'), 'lab-elements', 'Atom type → la palette ⚙ des éléments');
eq(HK.schemeForColorMode('sugar'), 'lab-sugar-identity', 'Sugar type → la palette ⚙ des sucres');
eq(H.schemeForColorMode('element'), 'element', 'schéma non enregistré → repli NGL natif');
eq(H.schemeForColorMode('sugar'), 'element', '…idem pour les sucres : jamais de molécule sans couleur');
eq(H.schemeForColorMode('sstruc'), 'sstruc', '…et le schéma de structure secondaire aussi');
// Les QUATRE lectures de PART 2 / PART 3 passent par la même correspondance — et
// les deux lectures NUCLEIC retombent sur la 2° structure, jamais sur un aplat.
const HK2 = buildHelpers({
  sstruc: 'lab-sstruc', elements: 'lab-elements', sugar: 'lab-sugar-identity',
  glycan: 'lab-glycans', lipidclass: 'lab-lipid-class', nucform: 'lab-nuc-form', motif: 'lab-nuc-motif',
});
eq(HK2.schemeForColorMode('glycan'), 'lab-glycans', 'Glycan (linked sugars) → le schéma des glycanes liés');
eq(HK2.schemeForColorMode('lipidclass'), 'lab-lipid-class', 'Lipid class → le schéma des classes de lipides');
eq(HK2.schemeForColorMode('nucform'), 'lab-nuc-form', 'DNA/RNA conformation → le schéma des formes');
eq(HK2.schemeForColorMode('motif'), 'lab-nuc-motif', '2° structure + motifs → le schéma des motifs');
eq(H.schemeForColorMode('nucform'), 'sstruc', 'une conformation, sans schéma enregistré, retombe sur la 2° structure');
eq(H.schemeForColorMode('motif'), 'sstruc', '…et un motif aussi (jamais un aplat d’éléments : c’est une notion STRUCTURELLE)');
eq(H.schemeForColorMode('glycan'), 'element', '…tandis qu’un glycanne retombe sur les couleurs d’éléments');

/* ── 6e. Les deux tables de couleurs, exécutées ─────────────────────────── */
eq(H.elementColorOf('C'), H.ELEMENT_COLOR_PALETTE.C, 'la couleur d’un élément vient de la table que la roue édite');
eq(H.elementColorOf(' cl '), H.ELEMENT_COLOR_PALETTE.Cl, 'l’élément est normalisé (casse et espaces)');
eq(H.elementColorOf('Xx'), H.DEFAULT_ELEMENT_COLOR, 'un élément inconnu garde le gris lisible (jamais noir)');
eq(H.elementColorOf(null), H.DEFAULT_ELEMENT_COLOR, 'un atome sans élément aussi');
eq(H.sugarColorOf('glc'), H.SUGAR_IDENTITY_COLORS.GLC, 'la couleur d’un sucre vient de la table des sucres');
eq(H.sugarColorOf(' XXX '), H.DEFAULT_ELEMENT_COLOR, 'un sucre hors liste garde le gris lisible');
eq([...H.SUGAR_IDENTITY_CODES].sort(), Object.keys(H.SUGAR_IDENTITY_COLORS).sort(),
  'la grille de la roue et la table des sucres couvrent EXACTEMENT les mêmes résidus (aucune dérive)');
ok(H.SUGAR_IDENTITY_CODES.every((r) => Number.isFinite(H.SUGAR_IDENTITY_COLORS[r])),
  'chaque résidu que la roue propose a bien une couleur à éditer');
ok(['GLC', 'NAG', 'MAN', 'BMA', 'SIA', 'GAL', 'FUC'].every((r) => H.SUGAR_IDENTITY_CODES.includes(r)),
  'le menu des sucres sélectionne bien sur ces sept résidus');
ok(Object.keys(H.ELEMENT_COLOR_PALETTE).length >= 18,
  'la palette des éléments couvre les éléments des protéines / lipides / sels');
// Les six formes et les deux motifs de PART 3 ont chacun leur couleur, et elles
// sont DISTINCTES (un A-DNA de la même couleur qu'un B-DNA ne montrerait rien).
eq(Object.keys(H.DEFAULT_NUCLEIC_FORM_COLORS).sort(), ['a-dna', 'a-rna', 'b-dna', 'loop-rna', 'z-dna', 'z-rna'],
  'les six formes de PART 3 ont chacune leur couleur');
eq(Object.keys(H.DEFAULT_NUCLEIC_MOTIF_COLORS).sort(), ['gquad', 'hairpin'],
  '…et les deux motifs la leur');
eq(new Set(Object.values(H.DEFAULT_NUCLEIC_FORM_COLORS)).size, 6, 'les six couleurs de forme sont DISTINCTES');
eq(new Set(Object.values(H.DEFAULT_NUCLEIC_FORM_COLORS).concat(Object.values(H.DEFAULT_NUCLEIC_MOTIF_COLORS))).size, 8,
  'les huit couleurs (formes + motifs) sont distinctes entre elles');
// Les deux nouvelles palettes se lisent / s'écrivent par le MÊME mécanisme que
// les deux premières (loadPalette / savePalette, avec la garde des clés).
const savedForms = buildHelpers({}, { nf: JSON.stringify({ 'a-dna': 0x111111, 'b-dna': 'bleu', 'x-dna': 9 }) });
eq(savedForms.loadPalette('nf', H.DEFAULT_NUCLEIC_FORM_COLORS),
  { ...H.DEFAULT_NUCLEIC_FORM_COLORS, 'a-dna': 0x111111 },
  'une forme enregistrée est reprise ; une clé inconnue ou non finie est ignorée');
eq(H.loadPalette('rien2', H.DEFAULT_NUCLEIC_MOTIF_COLORS), H.DEFAULT_NUCLEIC_MOTIF_COLORS,
  'sans entrée enregistrée, les motifs gardent leurs défauts');

/* ── Bilan ───────────────────────────────────────────────────────────────── */
console.log(`_viewer_color_settings_test.mjs — ${passed} assertions OK`);




