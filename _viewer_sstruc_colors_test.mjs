/* =========================================================================
   _viewer_sstruc_colors_test.mjs — LES COULEURS DE LA 2° STRUCTURE SONT ÉDITABLES.

   Le rapport, mot pour mot : « colors for secondary structure definition are not
   present in the setting wheel ». Vérifié sur le fichier : trois surfaces parlaient
   de la palette hélice / feuillet / boucle et AUCUNE ne permettait de la définir.

     1. la BARRE DE STYLE offre « Color by : Secondary structure » (les rangées
        « General » et « Backbone » d'une protéine, voir COLORS) sans montrer le
        moindre contrôle : ni pastille, ni ⚙ ;
     2. le menu §2 d'une protéine affichait un bouton « 🎨 Helix / Sheet / Loop
        colours » qui appelait setShowColoursPanel(true) — or le panneau 🎨 n'est
        plus rendu (renderColoursButton n'est même plus APPELÉ) : le bouton ne
        faisait donc rien, et son texte d'aide renvoyait à un panneau disparu ;
     3. dans la roue ⚙, les trois pastilles existaient bel et bien, mais enterrées
        dans la section « DNA/RNA bases · secondary structure · charge », sous un
        en-tête qui commence par « DNA/RNA bases » : un utilisateur de protéine ne
        les trouvait pas.

   Ce que cette suite empêche de revenir : les trois surfaces dessinent la MÊME liste
   (SSTRUC_COLOR_ITEMS), la roue a une section À ELLE, la rangée de la barre montre
   les pastilles dès que « Secondary structure » est choisi, l'écrivain reste UNIQUE
   (setSstrucColour) — et les trois valeurs par défaut n'existent qu'à UN endroit
   (SSTRUC_COLOR_DEFAULTS, un INSTANTANÉ du store), sans quoi le ↺ de la roue
   dériverait de la palette par défaut.

   La palette est VIVANTE : le schéma lab-sstruc est enregistré ICI dans le vrai NGL
   (2.4.0, celui que la page charge) et l'on vérifie qu'une pastille repeint vraiment
   les codes de NGL (h · g · i = hélice, e · b = feuillet, tout le reste = boucle).
   VIEWER_SRC rejoue la suite sur une version d'avant les correctifs : elle doit
   alors ÊTRE ROUGE (c'est ainsi que chaque défaut a été reproduit).
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const NGL = require('ngl');

let passed = 0;
const ok = (cond, what) => {
  assert.ok(cond, what);
  passed += 1;
};
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const SRC = process.env.VIEWER_SRC || new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url);
const VIEW = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const countOf = (re) => (VIEW.match(re) || []).length;

/* ── Extraction : `const name = (…) => { … };`, `const name = { … };`, ───────
   `const name = … ;` (corps d'expression : les crochets sont équilibrés). */
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
const sliceDecl = (src, name) => {
  const head = `const ${name} = `;
  const start = src.indexOf(head);
  assert.ok(start >= 0, `déclaration ${name} introuvable`);
  let depth = 0;
  for (let i = start + head.length; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} : déclaration non terminée`);
};

/* ══ 1. LES TROIS COULEURS N'EXISTENT QU'À UN ENDROIT ══════════════════════ */
has('const sstrucColorStore = { helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 };',
  'le store vivant du schéma lab-sstruc porte les trois couleurs par défaut');
has('const SSTRUC_COLOR_DEFAULTS = { ...sstrucColorStore };',
  'les DÉFAUTS sont un instantané de ce store — le ↺ de la roue ne peut pas en dériver');
has('const SSTRUC_COLOR_ITEMS = [', 'les trois couleurs sont UNE liste, partagée par les trois surfaces');
eq(countOf(/helix: 0xb44a90/g), 1, 'le magenta de l’hélice n’est écrit qu’UNE fois dans tout le viewer');
eq(countOf(/sheet: 0xf8d878/g), 1, 'le jaune du feuillet aussi');
eq(countOf(/loop: 0xe6e6e6/g), 1,
  'le gris clair de la boucle aussi (le gris 0xe6e6e6 du tableau des éléments est une AUTRE palette)');
eq(countOf(/const SSTRUC_COLOR_ITEMS/g), 1, 'la liste des pastilles n’est déclarée qu’une fois');
eq(countOf(/SSTRUC_COLOR_ITEMS\.map\(\(it\) => \(/g), 4,
  'la roue ⚙, la rangée de la barre de style, la rangée de la barre SÉLECTIONS (même série de commandes) et le menu §2 dessinent la MÊME liste');

/* ══ 2. LA ROUE ⚙ A UNE SECTION « SECONDARY STRUCTURE » À ELLE ════════════ */
has('Secondary structure · helix / sheet / loop',
  'la roue ⚙ a une section À ELLE (le rapport ne trouvait pas ces trois couleurs)');
gone('DNA/RNA bases · secondary structure · charge',
  'la section des bases ADN/ARN ne les enterre plus sous son en-tête');
has('DNA/RNA bases · charge', '…elle ne parle plus que des bases et de la charge');
has('onClick={() => setSstrucColors({ ...SSTRUC_COLOR_DEFAULTS })}',
  'le ↺ de la section réinitialise depuis les DÉFAUTS partagés');
has('title="Put these two palettes back to their defaults">',
  'le ↺ des bases / charges n’en réinitialise plus que deux');
has('What « Color by : Secondary structure » paints', 'la section dit ce que la palette peint');
has('title={`Colour of the ${it.what}`}', '…chaque pastille dit laquelle des trois elle écrit');
has('aria-label={`${it.label} colour`}', '…et elle est nommée pour les lecteurs d’écran');
has('{/* The 2°-structure palette gets a section of ITS OWN.',
  'la section est documentée dans le code (pourquoi elle existe)');
has('STRUCTURE (helix · sheet · loop — a SECTION OF ITS OWN',
  '…et le commentaire de la roue rappelle qu’elle était enterrée dans celle des bases');

/* ══ 3. LA RANGÉE DE LA BARRE MONTRE LES PASTILLES ════════════════════════ */
has("{look.colorBy === 'sstruc' && (",
  'la rangée affiche les pastilles DÈS QUE « Secondary structure » est choisi');
has('onChange={(e) => setSstrucColour(it.key, parseInt(e.target.value.slice(1), 16))}',
  '…et elles écrivent par le seul écrivain de la palette');
eq(countOf(/setSstrucColour\(it\.key,/g), 3,
  'trois surfaces écrivent par setSstrucColour : la barre de style, la barre SÉLECTIONS (même série de commandes) et le menu §2');
eq(countOf(/const setSstrucColour = \(key, hex\) => \{/g), 1, '…un seul écrivain, comme avant');
const COLORS = new Function(`${sliceObject(VIEW, 'COLORS')}\nreturn COLORS;`)();
['protein', 'proteinBackbone'].forEach((cat) => ok(COLORS[cat].includes('sstruc'),
  `la rangée « ${cat} » offre « Secondary structure » — les pastilles ont donc où s’afficher`));
ok(!COLORS.proteinSide.includes('sstruc'),
  'une rangée de chaînes latérales ne l’offre pas (la 2° structure n’y dit rien)');
ok(!COLORS.nucleic.includes('sstruc'),
  'la rangée des acides nucléiques non plus (leurs formes / motifs ont leurs palettes)');

/* ══ 4. LE MENU §2 N'OUVRE PLUS UN PANNEAU QUI N'EXISTE PAS ═══════════════ */
has("|| mode === 'sugar' || mode === 'nucform' || mode === 'motif' || mode === 'sstruc';",
  '« Secondary structure » ouvre aussi le ⚙ de la palette');
gone('🎨 Helix / Sheet / Loop colours', 'le bouton qui ouvrait le panneau 🎨 SUPPRIMÉ a disparu');
gone('setShowColoursPanel(true)', 'plus rien n’essaie d’ouvrir ce panneau (il n’est plus rendu)');
eq(countOf(/renderColoursButton\(/g), 0,
  'preuve du bouton mort : renderColoursButton n’est plus APPELÉ (le panneau 🎨 n’est plus rendu)');
eq(countOf(/const renderColoursButton = /g), 1, '…seule sa définition reste, jamais atteinte');
has('⚙ Colours…', '…le menu ouvre la roue ⚙ à la place');
gone('the three colours of the 🎨 Colours panel', 'le texte d’aide ne renvoie plus au panneau disparu');
has('« Secondary structure » paints the helices, the sheets and the loops with the three colours of the ⚙ settings wheel',
  '…il dit où sont les trois couleurs');

/* ══ 5. LA PALETTE EST VIVANTE : NGL PEINT CE QUE LA PASTILLE ÉCRIT ═══════ */
const H = new Function('NGL', `${[
  sliceObject(VIEW, 'sstrucColorStore'),
  sliceObject(VIEW, 'SSTRUC_COLOR_DEFAULTS'),
  sliceDecl(VIEW, 'SSTRUC_COLOR_ITEMS'),
  sliceFn(VIEW, 'sstrucAtomColorOf'),
  sliceFn(VIEW, 'defineSstrucScheme'),
  sliceFn(VIEW, 'registerColorScheme'),
  'let sstrucSchemeKey = null;',
].join('\n')}\nreturn { sstrucColorStore, SSTRUC_COLOR_DEFAULTS, SSTRUC_COLOR_ITEMS, defineSstrucScheme, registerColorScheme };`)(NGL);

const DEFAULTS = { helix: 0xb44a90, sheet: 0xf8d878, loop: 0xe6e6e6 };
eq(H.SSTRUC_COLOR_DEFAULTS, DEFAULTS,
  'les défauts sont ceux annoncés : hélice magenta · feuillet jaune · boucle gris clair');
ok(H.SSTRUC_COLOR_DEFAULTS !== H.sstrucColorStore,
  'ce sont bien des DÉFAUTS à part : muter la palette vivante ne les change pas');
eq(H.SSTRUC_COLOR_ITEMS.map((it) => it.key), ['helix', 'sheet', 'loop'],
  'la liste des pastilles couvre exactement les trois clés du store');
eq(H.SSTRUC_COLOR_ITEMS.map((it) => it.label), ['Helix', 'Sheet', 'Loop'],
  '…avec les trois libellés que la roue dessine');
H.SSTRUC_COLOR_ITEMS.forEach((it) => {
  ok(/^[0-9a-f]{6}$/.test(H.SSTRUC_COLOR_DEFAULTS[it.key].toString(16).padStart(6, '0')),
    `le défaut de « ${it.label} » est une couleur 0xRRGGBB valide`);
  ok(typeof it.what === 'string' && it.what.length > 0,
    `…et « ${it.label} » dit ce qu’elle peint (texte d’aide des pastilles)`);
});
const key = H.registerColorScheme(NGL, 'lab-test-sstruc-colors', H.defineSstrucScheme());
ok(typeof key === 'string' && key.length > 0, 'le schéma lab-sstruc s’enregistre dans NGL');
const cm = NGL.ColormakerRegistry.getScheme({ scheme: key });
const PROBE = { helix: 0x123456, sheet: 0x654321, loop: 0xabcdef };
const CODES_OF = { helix: ['h', 'g', 'i'], sheet: ['e', 'b'], loop: ['c', 't', 's', ' '] };
H.SSTRUC_COLOR_ITEMS.forEach((it) => {
  H.sstrucColorStore[it.key] = PROBE[it.key];
  CODES_OF[it.key].forEach((c) => eq(cm.atomColor({ sstruc: c }), PROBE[it.key],
    `une pastille « ${it.label} » repeint vraiment le code NGL « ${c} »`));
});
const OTHER = { helix: 'e', sheet: 'h', loop: 'h' };
H.SSTRUC_COLOR_ITEMS.forEach((it) => ok(cm.atomColor({ sstruc: OTHER[it.key] }) !== PROBE[it.key],
  `…et elle ne peint PAS le code d’une autre (${it.label} ≠ ${OTHER[it.key]})`));
eq(cm.atomColor({ sstruc: undefined }), PROBE.loop, 'un code absent retombe sur la boucle');
eq(cm.atomColor({}), PROBE.loop, 'un atome sans 2° structure aussi (jamais du noir)');
eq(cm.atomColor(null), PROBE.loop, '…même sans atome du tout');
eq(H.SSTRUC_COLOR_DEFAULTS, DEFAULTS,
  'après avoir bougé la palette, les DÉFAUTS n’ont pas bougé : le ↺ réinitialise VRAIMENT');
H.SSTRUC_COLOR_ITEMS.forEach((it) => {
  H.sstrucColorStore[it.key] = H.SSTRUC_COLOR_DEFAULTS[it.key];
});
H.SSTRUC_COLOR_ITEMS.forEach((it) => eq(cm.atomColor({ sstruc: CODES_OF[it.key][0] }), DEFAULTS[it.key],
  `le ↺ de la roue rend à « ${it.label} » sa couleur par défaut`));

console.log(`_viewer_sstruc_colors_test.mjs — ${passed} assertions OK`);
