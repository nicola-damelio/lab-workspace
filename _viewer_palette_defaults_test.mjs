/* =========================================================================
   _viewer_palette_defaults_test.mjs — I DÉFAUT DE CHAQUE PALETTE SONO I SUOI.

   Le rapport de cette session, mot pour mot : « i colori attualmente definiti a mano da
   me nel setting wheel devono essere i colori di default (non quelli che avevi messo tu
   quando hai scritto il codice) ».

   Ce que cela veut dire, et que ce garde-fou mesure :

     • une palette ENREGISTRÉE par le navigateur EST son propre défaut : les ↺ de la roue
       ⚙ (et le « ↺ Defaults » de chaque section) ramènent aux couleurs de l'UTILISATEUR,
       jamais aux tables du code ;
     • ces tables ne servent plus qu'au TOUT PREMIER démarrage (aucune palette enregistrée)
       et aux clés qu'un poste n'a jamais touchées — la fusion garde, entrée par entrée,
       la valeur de l'utilisateur quand elle en est une ;
     • la photographie est prise UNE fois par chargement de page : appuyer sur ↺ après
       avoir bougé une pastille de la session revient bien aux couleurs ENREGISTRÉES (un
       ↺ qui ne ferait rien serait un bouton mort) ;
     • AUCUN ↺ ne rend plus la table du code — c'est la liste des anciennes formes que la
       §3 interdit nommément.

   Les helpers PURS sont EXTRAITS du viewer (un .jsx ne s'importe pas sous Node) puis
   EXÉCUTÉS sur un localStorage de test ; le câblage de la roue est vérifié SUR LA SOURCE.
   ========================================================================= */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const ok = (c, what) => { assert.ok(c, what); passed += 1; };
const eq = (a, b, what) => {
  assert.deepEqual(a, b, `${what}\n  attendu : ${JSON.stringify(b)}\n  obtenu  : ${JSON.stringify(a)}`);
  passed += 1;
};

const VIEW = readFileSync(new URL('./src/components/NMRMoleculeViewer.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const has = (needle, what) => ok(VIEW.includes(needle), `${what}\n  introuvable : ${needle}`);
const gone = (needle, what) => ok(!VIEW.includes(needle), `${what}\n  encore présent : ${needle}`);
const sliceBetween = (from, to, what) => {
  const i = VIEW.indexOf(from);
  assert.ok(i >= 0, `ancre « ${from} » introuvable (${what})`);
  const j = VIEW.indexOf(to, i + from.length);
  assert.ok(j > i, `fin « ${to} » introuvable (${what})`);
  return VIEW.slice(i, j);
};

/* ── 1. Le banc : les clés + les six fonctions de palette, EXÉCUTÉES ─────────── */
const store = new Map();
const PAL = new Function('localStorage', [
  sliceBetween("const ELEMENT_COLORS_KEY = 'labViewerElementColors';", '\n/* ---- Which NGL colour SCHEME', 'palettes'),
  'return { ELEMENT_COLORS_KEY, SUGAR_COLORS_KEY, NUCLEIC_FORM_COLORS_KEY, NUCLEIC_MOTIF_COLORS_KEY,',
  '  mergePalette, loadPalette, savePalette, mergePartPalette, loadPartPalette,',
  '  paletteUserDefaults, paletteDefaults };',
].join('\n'))({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
});

const CODE = { a: 0x111111, b: 0x222222 };
eq(PAL.paletteDefaults('k0', CODE), CODE,
  'sans rien d’enregistré : la table du code (le tout premier démarrage d’un navigateur)');
eq(PAL.paletteDefaults('k2', CODE), CODE, '…et une autre clé ne voit rien de celle-là');

store.set('k1', JSON.stringify({ a: 0xabcdef, x: 1 }));
eq(PAL.paletteDefaults('k1', CODE), { a: 0xabcdef, b: 0x222222 },
  'avec une palette enregistrée, le DÉFAUT devient la couleur de l’utilisateur — les clés qu’il n’a pas touchées gardent la table');
store.set('k1', JSON.stringify({ a: 0x999999 }));
eq(PAL.paletteDefaults('k1', CODE), { a: 0xabcdef, b: 0x222222 },
  'la photographie est prise UNE fois par chargement de page (un ↺ qui ne ferait rien serait un bouton mort)');
eq(PAL.paletteUserDefaults('k1', CODE), { a: 0x999999, b: 0x222222 },
  '…tandis que la fonction PURE, elle, relit le stockage à chaque appel');

store.set('k1', JSON.stringify({ a: 'bleu', b: 0x333333 }));
eq(PAL.paletteUserDefaults('k1', CODE), { a: 0x111111, b: 0x333333 },
  'une valeur qui n’est pas une couleur est ignorée (la garde des palettes est réutilisée)');
store.set('k1', '{oops');
eq(PAL.paletteUserDefaults('k1', CODE), CODE, 'une entrée illisible rend la table du code — jamais une exception');
store.delete('k1');

/* Les palettes IMBRIQUÉES (une couleur par part) gardent leur garde de profondeur. */
const PART_DEF = { PC: { head: 0x010101, glycerol: 0x020202, acyl: 0x030303 } };
store.set('parts', JSON.stringify({ PC: { head: 0xabcdef, nope: 5 }, ZZ: { head: 9 } }));
eq(PAL.paletteDefaults('parts', PART_DEF, PAL.mergePartPalette),
  { PC: { head: 0xabcdef, glycerol: 0x020202, acyl: 0x030303 } },
  'une palette imbriquée : classe connue, part connue, couleur finie — tout le reste est écarté');


/* ── 2. La règle, dite dans la roue ─────────────────────────────────────────── */
has('const paletteDefaults = (key, codeDefaults, merge = mergePalette) => {',
  'les défauts d’une palette sont calculés par UNE fonction');
has('if (!paletteDefaultCache.has(key)) {', '…dont la photographie est prise une fois par clé');
has("const raw = JSON.parse(localStorage.getItem(key) || 'null');",
  '…en relisant ce que CE navigateur a enregistré');
has('Every ↺ of this wheel gives YOUR colours back',
  'et la roue DIT la règle à l’utilisateur (une règle invisible est une règle qu’on croit fausse)');

/* ── 3. AUCUN ↺ ne rend plus la table du code ───────────────────────────────── */
[
  ['setElementColors({ ...ELEMENT_COLOR_PALETTE })', 'éléments'],
  ['setSugarColors({ ...SUGAR_IDENTITY_COLORS })', 'sucres'],
  ['setSectionTints({ ...DEFAULT_SECTION_TINTS })', 'fonds de la fenêtre'],
  ['setChainColors({ ...CHAIN_COLOR_PALETTE })', 'chaînes'],
  ['setSstrucColors({ ...SSTRUC_COLOR_DEFAULTS })', '2° structure'],
  ['setSugarTypeColors({ ...SUGAR_TYPE_COLORS })', 'types de sucres'],
  ['setBaseTypeColors({ ...BASE_IDENTITY_COLORS })', 'bases'],
  ['setChargeColors({ ...CHARGE_COLORS })', 'charges'],
  ['setNucleicFormColors({ ...DEFAULT_NUCLEIC_FORM_COLORS })', 'conformations'],
  ['setNucleicMotifColors({ ...DEFAULT_NUCLEIC_MOTIF_COLORS })', 'motifs'],
  ['setResidueColors({ ...RESIDUE_COLOR_PALETTE })', 'résidus'],
  ['setLipidTypeColors({ ...LIPID_CLASS_COLORS })', 'classes de lipides'],
  ['mergePartPalette(RESIDUE_PART_DEFAULTS, null)', 'parts des résidus'],
  ['mergePartPalette(LIPID_PART_DEFAULTS, null)', 'parts des lipides'],
].forEach(([needle, what]) => gone(needle, `l’ancien ↺ « ${what} » (les constantes du code) a disparu`));

const keys = [...new Set([...VIEW.matchAll(/paletteDefaults\('([^']+)'/g)].map((m) => m[1]))];
ok(keys.length >= 9, `les palettes nommées passent par paletteDefaults (${keys.length} clés)`);
keys.forEach((k) => ok(VIEW.includes(`loadPalette('${k}'`) || VIEW.includes(`loadPartPalette('${k}'`),
  `« ${k} » est bien la clé d’une palette LUE au montage (aucune faute de frappe possible)`));

// Les ↺ qui portent leur clé en CONSTANTE (les cinq du haut de la roue).
['paletteDefaults(ELEMENT_COLORS_KEY, ELEMENT_COLOR_PALETTE)',
  'paletteDefaults(SUGAR_COLORS_KEY, SUGAR_IDENTITY_COLORS)',
  'paletteDefaults(SECTION_TINT_KEY, DEFAULT_SECTION_TINTS)',
  'paletteDefaults(NUCLEIC_FORM_COLORS_KEY, DEFAULT_NUCLEIC_FORM_COLORS)',
  'paletteDefaults(NUCLEIC_MOTIF_COLORS_KEY, DEFAULT_NUCLEIC_MOTIF_COLORS)',
].forEach((needle) => has(needle, `le ↺ lit ${needle.split('(')[1].split(',')[0]}…`));
// …et les palettes IMBRIQUÉES relisent leur garde de profondeur.
["paletteDefaults('labViewerResiduePartColors', RESIDUE_PART_DEFAULTS, mergePartPalette)",
  "paletteDefaults('labViewerLipidPartColors', LIPID_PART_DEFAULTS, mergePartPalette)",
].forEach((needle) => has(needle, `un ↺ imbriqué garde la garde du fond : ${needle}`));

console.log(`_viewer_palette_defaults_test.mjs — ${passed} assertions OK`);
